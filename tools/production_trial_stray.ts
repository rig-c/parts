#!/usr/bin/env bun
/**
 * The production trial's nine parts left on their tracked mesh (issue #172, the measurement after unit 1): can a
 * declared `source.stray` build them when the art the reduction reads is the art the trace read?
 *
 * Under `stray`, `contourMesh` (src/contour.ts) takes the islands it leaves out out of the mask it traces, but the rig
 * stage hands rig-c's `reduceMesh` the part's whole alpha (`autoReductionInput`, src/automesh.ts: `art: { mask, … }`), so
 * the source's `MQ_COVERAGE` row reads the crumbs the trace dropped and the reduction ends
 * `REDUCE_SOURCE_FAILS_ITS_ART_BOUNDS`. This tool measures the other reading — ONE mask for both readers — without a
 * line of `src/` changed: it runs `build`'s three stages itself (`assembleStage`, `rigStage`, `checkStage`, in the order
 * and with the inputs `build` gives them) and hands the rig stage a copy of the assembled parts in which the part's
 * image has the islands `stray` leaves out cleared to alpha 0 ({@link strayCleared}, the same `connectedComponents` and
 * `strayIslands` the trace runs). The check reads the parts as assembled.
 *
 *     bun run fetch-examples                                                 # once: examples/{reference-demo,reference-sample,scarf}/inputs
 *     bun tools/production_trial_stray.ts --cell <key>/<part> [--set <path>=<json>] [--path build|one-mask] > <row>.json
 *     bun tools/production_trial_stray.ts --cell <key>/<part> [--set <path>=<json>] --mask-only --art <dir> > <mask>.json
 *     bun tools/production_trial_stray.ts --compare <a.json> <b.json>        # the fields two rows differ in (wall seconds aside)
 *     bun tools/production_trial_stray.ts --page --six <row>… --controls <row>… --masks <mask>… --ladder <row>… --art <dir> --picture <png> --machine <label> > <page.md>
 *
 * `--path build` is the trial's own cell (`runCell` with `build`), byte for byte; `--path one-mask` (the default) is the
 * staged run above. When nothing is cleared — no `stray` declared, or none of the part's islands left out — the mask the
 * rig stage reads is asserted unchanged by its md5 before the stage runs (`STRAY_MASK_MOVED` otherwise). Rows carry the
 * islands cleared (count, px, box) and the part's art px at alpha 1 and above, so the loss is summed by program
 * ({@link lossOf}).
 *
 * The policy is the trial's (`trialPolicy`), unchanged; the one manual setting per row is the trial's `--set`.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Plate, type RGBA } from '@rig-c/core/plate';
import type { AlphaMask } from '@rig-c/core/mesh';
import { DEFAULT_PROJECT_RULE, DEFAULT_SEAM_RULE } from '../src/assemble.ts';
import { AUTO_THRESHOLD } from '../src/automesh.ts';
import { assembleStage, type BuildResult, checkStage, rigStage } from '../src/build.ts';
import { type CheckReport, DEFAULT_PAGE_EDGES, findRigc } from '../src/check.ts';
import { loadConfig } from '../src/config.ts';
import { strayIslands } from '../src/contour.ts';
import { PartsError, problemLine } from '../src/errors.ts';
import { connectedComponents, fillHoles, readPng, type Raster, writePng } from '../src/raster/index.ts';
import { DEFAULT_IDLE_KEYS } from '../src/rig.ts';
import { installedRigc, pinnedInputs, writeSwitchedConfig } from './auto_motion_survey.ts';
import { type Built, type CellRow, rigcRunner, runCell, specFor, switchedConfig } from './production_trial.ts';

const ROOT = resolve(import.meta.dir, '..');

// ---------------------------------------------------------------------------
// 1. the one mask: the islands the trace leaves out, cleared
// ---------------------------------------------------------------------------

/** One island cleared: its pixels at alpha 1 and above and its box in the part's padded image. */
export interface Island {
  px: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What {@link strayCleared} cleared, and the md5 of the mask before and after. */
export interface Cleared {
  stray: number | null;
  /** The part's art px at alpha 1 and above, as the source reads it (crumbs included). */
  artPx: number;
  islands: Island[];
  clearedPx: number;
  md5Before: string;
  md5After: string;
}

/** The md5 of a mask: its width, height and alpha bytes. */
export function maskMd5(mask: AlphaMask): string {
  return createHash('md5').update(`${mask.width}x${mask.height}:`).update(mask.alpha).digest('hex');
}

/**
 * The mask the trace reads under `stray`: the art at alpha above `threshold` (AUTO_THRESHOLD − 1, as `autoSource`
 * hands `contourMesh` its threshold), its 4-connected islands numbered by `connectedComponents`, and every island
 * `strayIslands` leaves out set to alpha 0 — the same two functions, in the same order, `contourMesh` runs. Nothing else
 * moves. `stray` undefined, or a split that refuses (`CONTOUR_ONE_ISLAND` stays the trace's to say), clears nothing and
 * returns the mask itself.
 */
export function strayCleared(mask: AlphaMask, stray: number | undefined, threshold: number = AUTO_THRESHOLD - 1): { mask: AlphaMask; cleared: Cleared } {
  const art = new Uint8Array(mask.width * mask.height);
  let artPx = 0;
  for (let i = 0; i < art.length; i++) if (mask.alpha[i] > threshold) (art[i] = 1), artPx++;
  const comp = connectedComponents({ width: mask.width, height: mask.height, data: art }, 4);
  const split = comp.count > 1 ? strayIslands(comp.stats.map((s) => s.area), stray) : { leave: [] as number[], refused: null };
  const before = maskMd5(mask);
  const leave = split.refused === null ? split.leave : [];
  if (leave.length === 0) return { mask, cleared: { stray: stray ?? null, artPx, islands: [], clearedPx: 0, md5Before: before, md5After: before } };
  const out = new Set(leave);
  const alpha = new Uint8Array(mask.alpha);
  for (let i = 0; i < alpha.length; i++) if (out.has(comp.labels[i])) alpha[i] = 0;
  const cleared = { width: mask.width, height: mask.height, alpha };
  const islands = [...leave].sort((a, b) => a - b).map((l) => ({ px: comp.stats[l].area, left: comp.stats[l].left, top: comp.stats[l].top, width: comp.stats[l].width, height: comp.stats[l].height }));
  return { mask: cleared, cleared: { stray: stray ?? null, artPx, islands, clearedPx: islands.reduce((n, s) => n + s.px, 0), md5Before: before, md5After: maskMd5(cleared) } };
}

/**
 * The crumbs a mask still holds under `stray`: every island besides the largest at `stray` px or fewer, each as
 * `STRAY_CRUMB_LEFT: <px> px at (<left>, <top>)`. Empty on a mask {@link strayCleared} returned; a builder that left one
 * is named here.
 */
export function crumbsLeft(mask: AlphaMask, stray: number, threshold: number = AUTO_THRESHOLD - 1): string[] {
  const art = new Uint8Array(mask.width * mask.height);
  for (let i = 0; i < art.length; i++) art[i] = mask.alpha[i] > threshold ? 1 : 0;
  const comp = connectedComponents({ width: mask.width, height: mask.height, data: art }, 4);
  if (comp.count <= 2) return [];
  const split = strayIslands(comp.stats.map((s) => s.area), stray);
  return split.leave.map((l) => `STRAY_CRUMB_LEFT: ${comp.stats[l].area} px at (${comp.stats[l].left}, ${comp.stats[l].top})`);
}

/** The md5 rule: when nothing is cleared the mask the rig stage reads is the mask assembled, or `STRAY_MASK_MOVED` names the part. */
export function assertUnchanged(part: string, c: Cleared): void {
  if (c.islands.length === 0 && c.md5After !== c.md5Before) throw new Error(`STRAY_MASK_MOVED: part "${part}" — nothing was cleared, yet the mask's md5 moved from ${c.md5Before} to ${c.md5After}`);
}

/**
 * The loss of one row, summed by program: the px of the islands cleared and their share of the part's art px.
 * `LOSS_NOT_SUMMED` when the row's `clearedPx` is not the sum of its islands (a figure typed, or an island dropped).
 */
export function lossOf(c: Cleared): { px: number; ratio: number } {
  const px = c.islands.reduce((n, s) => n + s.px, 0);
  if (px !== c.clearedPx) throw new Error(`LOSS_NOT_SUMMED: the row says ${c.clearedPx} px cleared; its ${c.islands.length} island(s) hold ${px} px`);
  return { px, ratio: c.artPx === 0 ? 0 : px / c.artPx };
}

/** The alpha of the pixels {@link strayCleared} clears from a part's image under `stray`: their mean and their largest (0 to 255), or null when none is cleared. */
export function clearedAlpha(art: Raster, stray: number | undefined): { mean: number; max: number } | null {
  const alpha = new Uint8Array(art.width * art.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = art.data[i * 4 + 3];
  const cut = strayCleared({ width: art.width, height: art.height, alpha }, stray).mask.alpha;
  let n = 0;
  let sum = 0;
  let max = 0;
  for (let i = 0; i < alpha.length; i++) if (alpha[i] !== cut[i]) (n += 1), (sum += alpha[i]), (max = Math.max(max, alpha[i]));
  return n === 0 ? null : { mean: sum / n, max };
}

/** The loss over several parts, each row's px summed by {@link lossOf}: cleared px, art px, and their ratio. */
export function lossTotal(rows: readonly Cleared[]): { px: number; artPx: number; ratio: number } {
  const px = rows.reduce((n, c) => n + lossOf(c).px, 0);
  const artPx = rows.reduce((n, c) => n + c.artPx, 0);
  return { px, artPx, ratio: artPx === 0 ? 0 : px / artPx };
}

// ---------------------------------------------------------------------------
// 2. the staged build: build's three stages, the rig stage reading the cleared part
// ---------------------------------------------------------------------------

/** One-mask cell: the row the trial prints, the path it ran on, and what was cleared. */
export interface StrayRow {
  path: 'build' | 'one-mask';
  cell: CellRow;
  cleared: Cleared | null;
}

/**
 * The builder `runCell` calls on the one-mask path: assemble into `out` exactly as `build` does, then a copy of
 * `parts.json` and `parts/` with `part`'s image cleared by {@link strayCleared} (alpha 0 at every pixel of an island
 * left out; nothing else of the image moves) for the rig stage, then the check over the parts as assembled. The log
 * lines carry `build`'s stage prefixes, so the trial's `failLines` reads them.
 */
function oneMaskBuilder(part: string, stray: number | undefined, sink: { cleared: Cleared | null }, art: string | null) {
  return (key: string, config: string, out: string, scratch: string): Built => {
    const ex = join(ROOT, 'examples', key, 'inputs');
    const bin = findRigc(ROOT, process.env.PATH ?? '');
    const calls = { n: 0 };
    const lines: string[] = [];
    const log = (stage: string) => (l: string) => lines.push(`[${stage}] ${l}`);
    const t0 = performance.now();
    const done = (result: BuildResult): Built => ({ result, lines, wallS: Math.round((performance.now() - t0) / 100) / 10, rigcCalls: calls.n });
    const refused = (stage: 'assemble' | 'rig' | 'check', err: unknown, check: CheckReport | null = null): Built => {
      if (!(err instanceof PartsError)) throw err;
      for (const p of err.problems) log(stage)(`  FAIL  ${problemLine(p)}`);
      return done({ stoppedAt: stage, check, artifact: [] });
    };
    mkdirSync(out, { recursive: true });
    try {
      loadConfig(config);
      assembleStage(
        { source: join(ex, 'painting.png'), full: join(ex, 'layers', 'full'), head: join(ex, 'layers', 'head'), config, seam: DEFAULT_SEAM_RULE, project: DEFAULT_PROJECT_RULE },
        { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, 'recomposite_error_rig.png') },
        log('assemble'),
      );
    } catch (err) {
      return refused('assemble', err);
    }
    // The rig stage's parts: parts.json and parts/ copied, the one part's image cleared.
    const rigIn = join(scratch, '..', 'rig-in');
    mkdirSync(join(rigIn, 'parts'), { recursive: true });
    copyFileSync(join(out, 'parts.json'), join(rigIn, 'parts.json'));
    for (const n of readdirSync(join(out, 'parts'))) copyFileSync(join(out, 'parts', n), join(rigIn, 'parts', n));
    const img: Raster = readPng(join(out, 'parts', `${part}.png`));
    const alpha = new Uint8Array(img.width * img.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
    const mask = { width: img.width, height: img.height, alpha };
    const c = strayCleared(mask, stray);
    sink.cleared = c.cleared;
    assertUnchanged(part, c.cleared);
    if (art !== null) {
      mkdirSync(art, { recursive: true });
      copyFileSync(join(out, 'parts', `${part}.png`), join(art, `${key}-${part}.png`));
    }
    if (c.cleared.islands.length > 0) {
      const data = new Uint8ClampedArray(img.data);
      for (let i = 0; i < c.mask.alpha.length; i++) data[i * 4 + 3] = c.mask.alpha[i];
      writePng(join(rigIn, 'parts', `${part}.png`), { width: img.width, height: img.height, data });
    }
    const run = rigcRunner(bin, calls);
    try {
      rigStage({ config, parts: rigIn, out: join(out, 'rig'), idleKeys: DEFAULT_IDLE_KEYS, pageEdges: DEFAULT_PAGE_EDGES, command: 'build' }, run, scratch, log('rig'));
    } catch (err) {
      return refused('rig', err);
    }
    let report: CheckReport;
    try {
      report = checkStage({ rig: join(out, 'rig'), parts: out, out: join(out, 'check'), pageEdges: DEFAULT_PAGE_EDGES }, run, bin, log('check'));
    } catch (err) {
      return refused('check', err);
    }
    // The check prints its own FAIL lines; `build` adds none.
    if (!report.figures.PASS) return done({ stoppedAt: 'check', check: report, artifact: [] });
    return done({ stoppedAt: null, check: report, artifact: [] });
  };
}

/** One part through the path named, under the trial's policy (with the trial's one manual setting). */
export function runStrayCell(key: string, part: string, manual: { path: string; value: unknown } | null, path: 'build' | 'one-mask', art: string | null): StrayRow {
  if (path === 'build') return { path, cell: runCell(key, part, manual), cleared: null };
  const { spec } = specFor(key, part, manual);
  const sink: { cleared: Cleared | null } = { cleared: null };
  const cell = runCell(key, part, manual, oneMaskBuilder(part, spec.source.stray, sink, art));
  return { path, cell, cleared: sink.cleared };
}

/**
 * The mask alone, no rig stage: the example assembled as `build` assembles it (the config with the part switched,
 * under the trial's policy and the one manual setting), the part's image read, and {@link strayCleared} run on it —
 * the islands cleared, the art px and both md5s, the md5 rule asserted ({@link assertUnchanged}). The part's image is
 * copied to `art` as `<key>-<part>.png` when named (the picture's input).
 */
export function maskOnly(key: string, part: string, manual: { path: string; value: unknown } | null, art: string | null): { example: string; part: string; manual: typeof manual; cleared: Cleared } {
  const { spec } = specFor(key, part, manual);
  const work = mkdtempSync(join(tmpdir(), 'rig-parts-stray-'));
  try {
    const ex = join(ROOT, 'examples', key, 'inputs');
    const config = writeSwitchedConfig(key, switchedConfig(key, new Map([[part, spec]])), work);
    const out = join(work, 'out');
    loadConfig(config);
    assembleStage(
      { source: join(ex, 'painting.png'), full: join(ex, 'layers', 'full'), head: join(ex, 'layers', 'head'), config, seam: DEFAULT_SEAM_RULE, project: DEFAULT_PROJECT_RULE },
      { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, 'recomposite_error_rig.png') },
      () => {},
    );
    const img = readPng(join(out, 'parts', `${part}.png`));
    const alpha = new Uint8Array(img.width * img.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
    const c = strayCleared({ width: img.width, height: img.height, alpha }, spec.source.stray);
    assertUnchanged(part, c.cleared);
    if (art !== null) {
      mkdirSync(art, { recursive: true });
      copyFileSync(join(out, 'parts', `${part}.png`), join(art, `${key}-${part}.png`));
    }
    return { example: key, part, manual, cleared: c.cleared };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The fields two rows differ in, wall seconds aside: `path: a vs b`, by JSON path. */
export function rowDiff(a: unknown, b: unknown, at = ''): string[] {
  if (at === 'wallS') return [];
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b) ? [] : [`${at}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`];
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.flatMap((k) => rowDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], at === '' ? k : `${at}.${k}`));
}

// ---------------------------------------------------------------------------
// 3. the picture and the page
// ---------------------------------------------------------------------------

const INK: RGBA = [20, 20, 20, 255];
const CRUMB: RGBA = [210, 30, 30, 255];
const PAPER: RGBA = [255, 255, 255, 255];

/** The percentage a ratio prints as on the page and the picture: three significant figures. */
export const percent = (ratio: number): string => `${(ratio * 100).toPrecision(3)} %`;

/**
 * One picture of what a declared stray costs: per part, its image as assembled (lightened), every cleared island's
 * pixels in red and a red ring around each, the caption its islands, px and share of the art ({@link lossOf}).
 * Panels flow left to right and wrap at `maxW`.
 */
export function strayPicture(panels: ReadonlyArray<{ name: string; art: Raster; cleared: Cleared }>, maxW = 1600): Plate {
  const gap = 16;
  const capH = 2 * 10 + 6;
  const boxes = panels.map((p) => {
    const l = lossOf(p.cleared);
    // The plate's font has no per-cent sign; the caption spells it.
    const caption = [`${p.name.toUpperCase()}: ${p.cleared.islands.length} ISLAND(S) CLEARED UNDER STRAY ${p.cleared.stray ?? '-'}`, `${l.px} PX OF ${p.cleared.artPx} ART PX (${percent(l.ratio).replace(' %', ' PER CENT')})`];
    const w = Math.max(p.art.width, ...caption.map((c) => c.length * 6));
    return { p, caption, w, h: p.art.height + capH };
  });
  const place: Array<{ x: number; y: number }> = [];
  let x = gap;
  let y = gap + 14;
  let rowH = 0;
  for (const b of boxes) {
    if (x > gap && x + b.w > maxW) (x = gap), (y += rowH + gap), (rowH = 0);
    place.push({ x, y });
    x += b.w + gap;
    rowH = Math.max(rowH, b.h);
  }
  const W = Math.max(...boxes.map((b, i) => place[i].x + b.w + gap), 400);
  const H = y + rowH + gap;
  const plate = new Plate(Math.ceil(W), Math.ceil(H));
  plate.rect(0, 0, plate.width, plate.height, PAPER);
  plate.text('WHAT A DECLARED STRAY COSTS: THE ISLANDS CLEARED FROM THE MASK BOTH READERS READ, IN RED AND RINGED', gap, gap, 1, INK);
  boxes.forEach((b, i) => {
    const { x: ox, y: oy } = place[i];
    const { width: w, height: h, data } = b.p.art;
    const alpha = new Uint8Array(w * h);
    for (let k = 0; k < alpha.length; k++) alpha[k] = data[k * 4 + 3];
    const cut = strayCleared({ width: w, height: h, alpha }, b.p.cleared.stray ?? undefined).mask.alpha;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const k = py * w + px;
        if (alpha[k] < AUTO_THRESHOLD) continue;
        if (cut[k] === 0) plate.set(ox + px, oy + py, CRUMB);
        else plate.set(ox + px, oy + py, [Math.round((data[k * 4] + 2 * 255) / 3), Math.round((data[k * 4 + 1] + 2 * 255) / 3), Math.round((data[k * 4 + 2] + 2 * 255) / 3), 255]);
      }
    }
    for (const s of b.p.cleared.islands) plate.ring(ox + s.left + s.width / 2, oy + s.top + s.height / 2, Math.max(6, Math.ceil(Math.hypot(s.width, s.height) / 2) + 4), 0.8, CRUMB);
    b.caption.forEach((c, j) => plate.text(c, ox, oy + h + 6 + j * 10, 1, j === 1 ? CRUMB : INK));
  });
  return plate;
}

/**
 * The background a 4-connected hole fill closes (`fillHoles`, the trace's silhouette) but an 8-connected flood from the
 * image border reaches (rig-c's `MQ_OVERSHOOT` fill, `AUTO_SOURCE_FIT_CONNECTIVITY` 8): a pocket joined to the outside
 * only at a corner, which the source covers and the overshoot row counts as outside. Its px, its box, and the furthest
 * any of its pixels sits from the nearest art pixel (centre to centre) — the overshoot such a pocket alone forces on
 * any source that fills it, whatever its tolerance and margin. Alpha above `threshold` is art; the image is read with
 * a transparent border of `pad` px (the rig stage's padding), so the box is in the padded frame.
 */
export function cornerPockets(img: Raster, pad = 4, threshold: number = AUTO_THRESHOLD - 1): { holePx: number; pocketPx: number; box: [number, number, number, number] | null; furthest: number } {
  const w = img.width + 2 * pad;
  const h = img.height + 2 * pad;
  const art = new Uint8Array(w * h);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (img.data[(y * img.width + x) * 4 + 3] > threshold) art[(y + pad) * w + x + pad] = 1;
  const filled = fillHoles({ width: w, height: h, data: art }).data;
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number): void => {
    if (!art[i] && !outside[i]) (outside[i] = 1), stack.push(i);
  };
  for (let x = 0; x < w; x++) seed(x), seed((h - 1) * w + x);
  for (let y = 0; y < h; y++) seed(y * w), seed(y * w + w - 1);
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h) seed((y + dy) * w + x + dx);
  }
  const arts: Array<[number, number]> = [];
  for (let i = 0; i < w * h; i++) if (art[i]) arts.push([i % w, (i - (i % w)) / w]);
  let holePx = 0;
  let pocketPx = 0;
  let box: [number, number, number, number] | null = null;
  let furthest = 0;
  for (let i = 0; i < w * h; i++) {
    if (!filled[i] || art[i]) continue;
    holePx++;
    if (!outside[i]) continue;
    pocketPx++;
    const x = i % w;
    const y = (i - x) / w;
    box = box === null ? [x, y, x, y] : [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
    let d = Infinity;
    for (const [ax, ay] of arts) d = Math.min(d, Math.hypot(ax - x, ay - y));
    furthest = Math.max(furthest, d);
  }
  return { holePx, pocketPx, box, furthest };
}

/** The tracked V / T / B per `<key>/<part>` as docs/evidence/production-trial.md prints it (its "tracked" column), for the comparison column. */
export function trackedFromTrialPage(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^\| ([a-z]+\/[a-z_]+) \| [^|]+ \| [^|]+ \| [^|]+ \| ([0-9]+ \/ [0-9]+ \/ [0-9]+) \|/.exec(line);
    if (m !== null && !out.has(m[1])) out.set(m[1], m[2]);
  }
  return out;
}

type MaskRow = ReturnType<typeof maskOnly>;

const fig = (f: CellRow['auto']): string => (f === null ? '—' : `${f.vertices} / ${f.triangles} / ${f.bindings}`);
const ph = (r: { value: number | null; frame: string | null } | null | undefined): string => (r === null || r === undefined ? '—' : `${r.value ?? '—'} @ ${r.frame ?? '—'}`);
const verdictOf = (c: CellRow): string => (c.verdict === 'accepted' ? 'accepted' : `refused at ${c.stoppedAt}: ${[...new Set(c.problems.map((p) => p.split(':')[0]))].join(', ')}`);
const residualOf = (c: CellRow): string => (c.residual === null ? '—' : c.residual.sent === null ? 'no row' : c.residual.sent ? `sent, ref ${c.residual.reference}, ${c.residual.value ?? '—'}` : `not sent (ref ${c.residual.reference}): ${c.residual.stops.join(', ')}`);
const islandsText = (c: Cleared): string => c.islands.map((s) => `${s.px} px at (${s.left}, ${s.top}) ${s.width}x${s.height}`).join('; ');

/** The page: the six parts on one mask, the controls, the loss and its picture, the ladder; every figure from the rows. */
export function strayPage(a: { six: readonly StrayRow[]; controls: readonly StrayRow[]; masks: readonly MaskRow[]; ladder: readonly StrayRow[]; pocket: ReturnType<typeof cornerPockets>; alphaOf: (r: StrayRow) => { mean: number; max: number } | null; tracked: ReadonlyMap<string, string>; picture: string; machine: string }): string[] {
  const L: string[] = [];
  const name = (c: CellRow): string => `${c.example}/${c.part}`;
  L.push('# The nine parts the production trial left on their tracked mesh: one mask for both readers (issue #172)');
  L.push('');
  L.push(`Generated by \`bun tools/production_trial_stray.ts\`; every figure below is the tool's, none typed. The installed rig-c ${installedRigc()}. The public examples demo, sample and scarf at commit ${pinnedInputs()} (\`bun run fetch-examples\`), each with its tracked \`examples/<key>/config.json\`. The policy is the production trial's (\`trialPolicy\`, docs/evidence/production-trial.md), unchanged; each row's one manual setting is the trial's retry. Cells ran on: ${a.machine}.`);
  L.push('');
  L.push('## What is measured');
  L.push('');
  L.push('Under a declared `source.stray`, `contourMesh` (src/contour.ts) takes the islands it leaves out out of the mask it traces, but the rig stage hands rig-c\'s `reduceMesh` the part\'s whole alpha (`autoReductionInput`, src/automesh.ts, `art: { mask, … }`): the source\'s `MQ_COVERAGE` reads the crumbs the trace dropped, and the trial\'s six `stray` retries ended `REDUCE_SOURCE_FAILS_ITS_ART_BOUNDS`. This page runs the other reading — one mask for both readers — with `src/` unchanged: the tool runs `build`\'s three stages itself (`assembleStage`, `rigStage`, `checkStage`, with the inputs `build` gives them) and hands the rig stage a copy of the assembled parts in which the part\'s image has the islands `stray` leaves out set to alpha 0 (`strayCleared`: the same `connectedComponents` at 4-connectivity and `strayIslands` the trace runs, on alpha 1 and above; selftest `SM01`). The check reads the parts as assembled. The rig stage\'s image of the part is the cleared one too, so a cleared pixel is not drawn even where the mesh would reach it; the islands below are in the part\'s own image (parts/<part>.png), 4 px up and left of the padded image the trial\'s refusal lines name.');
  L.push('');
  L.push('## The six parts, one mask');
  L.push('');
  L.push('V / T / B = vertices / triangles / bone bindings off the packed skeleton JSON; "tracked" is the trial page\'s tracked column. Motion = MQ_LOCAL_DEFORMATION (rig px, against the part\'s own unreduced source) by phase, grid and irr (held out), each with its worst frame; bound 1. Residual = `targets.skinning` sent, its reference bone, the written mesh\'s MQ_SKINNING_RESIDUAL.');
  L.push('');
  L.push('| part | setting | islands cleared | verdict | tracked V / T / B | automatic V / T / B | step written | motion grid | motion irr (held out) | residual target | check | wall s |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of a.six) {
    const c = r.cell;
    const cl = r.cleared as Cleared;
    L.push(`| ${name(c)} | ${c.manual === null ? 'policy' : `${c.manual.path} = ${JSON.stringify(c.manual.value)}`} | ${cl.islands.length}, ${cl.clearedPx} px | ${verdictOf(c)} | ${a.tracked.get(name(c)) ?? '—'} | ${fig(c.auto)} | ${c.step === null ? '—' : c.step.kind === 'full' ? 'full' : `replayed, step ${c.step.chosen} of ${c.step.of}`} | ${ph(c.motion?.grid)} | ${ph(c.motion?.irr)} | ${residualOf(c)} | ${c.checkPass === null ? '—' : c.checkPass ? 'PASS' : 'FAIL'} | ${c.wallS} |`);
  }
  L.push('');
  L.push(`Accepted: ${a.six.filter((r) => r.cell.verdict === 'accepted').length} of ${a.six.length}.`);
  for (const r of a.six.filter((x) => x.cell.verdict === 'refused')) for (const p of r.cell.problems) L.push(`- ${name(r.cell)}: \`${p.replace(/`/g, "'")}\``);
  L.push('');
  L.push('Islands cleared, per part (px at (left, top) in the part\'s image, box):');
  L.push('');
  for (const r of a.six) L.push(`- ${name(r.cell)}: ${islandsText(r.cleared as Cleared)}`);
  L.push('');
  L.push('## Controls');
  L.push('');
  L.push('Each part on both paths: `build` (the trial\'s own cell, `build` itself) and one mask (the staged run above); the rows compared field by field, wall seconds aside (`--compare`). For the parts without `stray`, the mask the rig stage reads is asserted unchanged by its md5 before the stage runs (`STRAY_MASK_MOVED` otherwise; selftest `SM02`).');
  L.push('');
  L.push('| part | setting | islands cleared | mask md5 | build | one mask | rows |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  const keys = [...new Set(a.controls.map((r) => name(r.cell)))];
  for (const k of keys) {
    const b = a.controls.find((r) => name(r.cell) === k && r.path === 'build');
    const o = a.controls.find((r) => name(r.cell) === k && r.path === 'one-mask');
    if (b === undefined || o === undefined) throw new Error(`production_trial_stray: control ${k} lacks a path (build ${b !== undefined}, one mask ${o !== undefined})`);
    const cl = o.cleared as Cleared;
    const d = rowDiff(b.cell, o.cell);
    L.push(`| ${k} | ${o.cell.manual === null ? 'policy' : `${o.cell.manual.path} = ${JSON.stringify(o.cell.manual.value)}`} | ${cl.islands.length}, ${cl.clearedPx} px | ${cl.md5Before === cl.md5After ? 'equal' : 'moved'} | ${verdictOf(b.cell)}, ${fig(b.cell.auto)} | ${verdictOf(o.cell)}, ${fig(o.cell.auto)} | ${d.length === 0 ? 'identical' : d.join('; ')} |`);
  }
  L.push('');
  L.push('The masks alone (assemble, then `strayCleared`; no rig stage), every part above and every part of the trial\'s policy:');
  L.push('');
  L.push('| part | setting | islands cleared | art px | mask md5 before | after |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const m of a.masks) L.push(`| ${m.example}/${m.part} | ${m.manual === null ? 'policy' : `${m.manual.path} = ${JSON.stringify(m.manual.value)}`} | ${m.cleared.islands.length}, ${m.cleared.clearedPx} px | ${m.cleared.artPx} | ${m.cleared.md5Before} | ${m.cleared.md5After === m.cleared.md5Before ? 'equal' : m.cleared.md5After} |`);
  L.push('');
  L.push('## What is lost');
  L.push('');
  L.push('The cleared pixels are not drawn. Per part, the cleared px against the part\'s art px at alpha 1 and above as the source reads it (crumbs included), summed by the tool (`lossOf`, `lossTotal`; selftest `SM03`); and the alpha those pixels carry in the part\'s image (`clearedAlpha`).');
  L.push('');
  L.push('| part | islands | cleared px | art px | share | cleared alpha, mean / max (of 255) |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of a.six) {
    const cl = r.cleared as Cleared;
    const l = lossOf(cl);
    const al = a.alphaOf(r);
    L.push(`| ${name(r.cell)} | ${cl.islands.length} | ${l.px} | ${cl.artPx} | ${percent(l.ratio)} | ${al === null ? '—' : `${al.mean.toFixed(1)} / ${al.max}`} |`);
  }
  const t = lossTotal(a.six.map((r) => r.cleared as Cleared));
  L.push(`| all six | ${a.six.reduce((n, r) => n + (r.cleared as Cleared).islands.length, 0)} | ${t.px} | ${t.artPx} | ${percent(t.ratio)} | — |`);
  L.push('');
  L.push(`The picture: [${a.picture.split('/').pop()}](${a.picture.split('/').pop()}) — each part's image as assembled, lightened, the cleared pixels in red with a red ring around each island; the caption is the row above.`);
  L.push('');
  L.push('## reference-sample/hair_back: the tolerance and margin ladder');
  L.push('');
  L.push('The trial refused it at the source, `CONTOUR_OVERSHOOT`, under the policy (tolerance 2, margin 2) and at tolerance 1. Here: tolerance {0.5, 1, 1.5} × margin {1, 2}, each one `source` setting over the policy (spacing 21, the part\'s tracked grid), on `build` itself; the part has one island, so no `stray` is declared.');
  L.push('');
  L.push('| tolerance | margin | verdict | overshoot reached (px) | bound (px) | automatic V / T / B | check |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of a.ladder) {
    const s = (r.cell.manual?.value ?? {}) as { tolerance?: number; margin?: number };
    const over = r.cell.problems.map((p) => /reaches ([0-9.]+) px past the art.*?at most (.*?) px is required/.exec(p)).find((m) => m !== null);
    L.push(`| ${s.tolerance} | ${s.margin} | ${verdictOf(r.cell)} | ${over?.[1] ?? '—'} | ${over?.[2] ?? '—'} | ${fig(r.cell.auto)} | ${r.cell.checkPass === null ? '—' : r.cell.checkPass ? 'PASS' : 'FAIL'} |`);
  }
  L.push('');
  for (const r of a.ladder.filter((x) => x.cell.verdict === 'refused')) {
    const s = (r.cell.manual?.value ?? {}) as { tolerance?: number; margin?: number };
    for (const p of r.cell.problems) L.push(`- tolerance ${s.tolerance}, margin ${s.margin}: \`${p.replace(/`/g, "'")}\``);
  }
  const pk = a.pocket;
  const reached = [...new Set(a.ladder.map((r) => r.cell.problems.map((p) => /reaches ([0-9.]+) px/.exec(p)?.[1]).find((v) => v !== undefined) ?? 'none'))];
  L.push(`${reached.length === 1 ? `Every cell reaches the same ${reached[0]} px` : `The cells reach ${reached.join(', ')} px`}, so the overshoot is not the outline's: the part's art (alpha 1 and above, read with the rig stage's 4 px padding; \`cornerPockets\`) holds ${pk.holePx} px of background that the 4-connected hole fill closes, and ${pk.pocketPx} px of them, box (${pk.box?.slice(0, 2).join(', ') ?? '—'})-(${pk.box?.slice(2).join(', ') ?? '—'}) in the padded image, are reached by an 8-connected flood from the border — a pocket joined to the outside only at a corner, which the source fills and rig-c's \`MQ_OVERSHOOT\` (8-connected) reads as outside. The furthest of its pixels sits ${pk.furthest.toFixed(5)} px from the nearest art pixel.`);
  L.push('');
  L.push('## Re-running this evidence');
  L.push('');
  L.push(`Inputs as above; rig-c ${installedRigc()} as \`bun install --frozen-lockfile\` installs it from \`bun.lock\`. One cell per part and path, each a process of its own, stopped at 600 s. Builds run in temporary directories, removed afterwards.`);
  L.push('');
  L.push('```sh');
  L.push('bun install --frozen-lockfile');
  L.push('bun run fetch-examples');
  L.push('# the six, one mask, with the trial\'s stray retry (reference-demo/hair_back 6, reference-demo/sleeves 7, reference-demo/topwear 7, reference-sample/hair_front 2, scarf/hair_back 3, scarf/topwear 13):');
  L.push('bun tools/production_trial_stray.ts --cell <key>/<part> --set source.stray=<n> > om-<key>-<part>.json');
  L.push('# the controls, both paths (the three stray = 1 parts with --set source.stray=1; the eight policy parts without):');
  L.push('bun tools/production_trial_stray.ts --cell <key>/<part> [--set source.stray=1] --path build > b-<key>-<part>.json');
  L.push('bun tools/production_trial_stray.ts --cell <key>/<part> [--set source.stray=1] > om-<key>-<part>.json');
  L.push('# the masks alone, with the art the picture reads:');
  L.push('bun tools/production_trial_stray.ts --cell <key>/<part> [--set source.stray=<n>] --mask-only --art <dir> > mask-<key>-<part>.json   # and reference-sample/hair_back, whose image the ladder\'s pocket line reads');
  L.push('# the ladder:');
  L.push('bun tools/production_trial_stray.ts --cell reference-sample/hair_back --path build --set \'source={"tolerance":<t>,"margin":<m>,"spacing":21}\' > ladder-<t>-<m>.json');
  L.push('bun tools/production_trial_stray.ts --page --six <om rows> --controls <b and om rows> --masks <mask rows> --ladder <ladder rows> --art <dir> --picture docs/evidence/production-trial-stray.png --machine "<where the cells ran>" > docs/evidence/production-trial-stray.md');
  L.push('```');
  return L;
}

// ---------------------------------------------------------------------------
// 9. the command line
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  const get = (f: string): string | undefined => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  const cell = get('--cell');
  if (cell !== undefined) {
    const [key, part] = cell.split('/');
    const set = get('--set');
    const manual = set === undefined ? null : { path: set.slice(0, set.indexOf('=')), value: JSON.parse(set.slice(set.indexOf('=') + 1)) as unknown };
    const art = get('--art');
    if (argv.includes('--mask-only')) {
      const m = maskOnly(key, part, manual, art === undefined ? null : resolve(art));
      console.error(`production_trial_stray: ${cell} [mask only]: cleared ${m.cleared.islands.length} island(s), ${m.cleared.clearedPx} px of ${m.cleared.artPx}; md5 ${m.cleared.md5Before === m.cleared.md5After ? 'equal' : 'moved'}`);
      console.log(JSON.stringify(m));
      return 0;
    }
    const path = get('--path') ?? 'one-mask';
    if (path !== 'build' && path !== 'one-mask') throw new Error(`production_trial_stray: --path ${path}; build or one-mask is required`);
    const row = runStrayCell(key, part, manual, path, art === undefined ? null : resolve(art));
    if (row.cell.echoDiffers.length > 0) {
      console.error(`production_trial_stray: ${cell} — the written row does not echo the declared policy: ${row.cell.echoDiffers.join('; ')}`);
      return 1;
    }
    const c = row.cleared;
    console.error(`production_trial_stray: ${cell}${manual === null ? '' : ` (${set})`} [${path}]: ${row.cell.verdict}${row.cell.stoppedAt === null ? '' : ` at ${row.cell.stoppedAt}`}, ${row.cell.wallS} s${c === null ? '' : `; cleared ${c.islands.length} island(s), ${c.clearedPx} px of ${c.artPx}`}`);
    console.log(JSON.stringify(row));
    return 0;
  }
  const cmp = argv.indexOf('--compare');
  if (cmp >= 0) {
    const [a, b] = [argv[cmp + 1], argv[cmp + 2]].map((f) => (JSON.parse(readFileSync(f, 'utf8')) as StrayRow).cell);
    const d = rowDiff(a, b);
    console.log(d.length === 0 ? 'IDENTICAL (wall seconds aside)' : d.join('\n'));
    return 0;
  }
  if (argv.includes('--page')) {
    const list = (flag: string): string[] => {
      const i = argv.indexOf(flag);
      const out: string[] = [];
      if (i >= 0) for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) out.push(argv[j]);
      return out;
    };
    const rows = (flag: string): StrayRow[] => list(flag).map((f) => JSON.parse(readFileSync(f, 'utf8')) as StrayRow);
    const six = rows('--six');
    const art = get('--art');
    const picture = get('--picture');
    if (art === undefined || picture === undefined) throw new Error('production_trial_stray: --page needs --art <dir> and --picture <png>');
    strayPicture(six.map((r) => ({ name: `${r.cell.example}/${r.cell.part}`, art: readPng(join(art, `${r.cell.example}-${r.cell.part}.png`)), cleared: r.cleared as Cleared }))).writePng(picture);
    const tracked = trackedFromTrialPage(readFileSync(join(ROOT, 'docs', 'evidence', 'production-trial.md'), 'utf8'));
    const masks = list('--masks').map((f) => JSON.parse(readFileSync(f, 'utf8')) as MaskRow);
    const pocket = cornerPockets(readPng(join(art, 'reference-sample-hair_back.png')));
    const alphaOf = (r: StrayRow) => clearedAlpha(readPng(join(art, `${r.cell.example}-${r.cell.part}.png`)), r.cleared?.stray ?? undefined);
    for (const l of strayPage({ six, controls: rows('--controls'), masks, ladder: rows('--ladder'), pocket, alphaOf, tracked, picture, machine: get('--machine') ?? 'local' })) console.log(l);
    return 0;
  }
  console.error('usage: bun tools/production_trial_stray.ts --cell <key>/<part> [--set <path>=<json>] [--path build|one-mask] [--art <dir>] | --compare <a.json> <b.json> | --page …');
  return 2;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
