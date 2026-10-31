#!/usr/bin/env bun
/**
 * The automatic mesh's policy measured on the public parts (issue #266, Stage A): how blunt the outline may be,
 * what counts as art, and what the reduction is bounded by — one change at a time over the production trial's
 * policy (`trialPolicy`, tools/production_trial.ts), on every mesh part of `demo`, `scarf` and the trailer inputs
 * (https://github.com/rig-c/trailer) that the automatic path can build.
 *
 *     bun run fetch-examples                                                  # once: examples/{demo,scarf}/inputs
 *     bun tools/auto_policy_survey.ts --run --example <key> --arm <arm> --evidence <dir> [--trailer <dir>]
 *     bun tools/auto_policy_survey.ts --tracked --example <key> --evidence <dir> [--trailer <dir>]
 *     bun tools/auto_policy_survey.ts --sheet --example <key> --evidence <dir> --out <png> [--trailer <dir>]
 *     bun tools/auto_policy_survey.ts --page --evidence <dir> [--trailer <dir>] > docs/evidence/auto-policy-survey.md
 *
 * `--run` builds each mesh part alone under the arm (the example's own config with that one mesh entry replaced by
 * `{ auto, r, segments }`, as the production trial does), through `build`'s own stages (`assembleStage`, `rigStage`),
 * then the example once more with every part that built alone switched at once, through `checkStage` as well — the
 * rig a consumer would build under that arm, and the one whose `check` bars the page reads. It writes
 * `<evidence>/<key>-<arm>.json` and keeps that build's packed skeleton under `<evidence>/<key>-<arm>/`.
 *
 * The arms ({@link ARMS}; the card's table, and two readings of the card's ambiguous "dev" row beside it):
 *
 * - `base`: `trialPolicy` as it is.
 * - `art`: the art read at alpha above {@link ART_ARM_ALPHA}: every pixel of the part at alpha
 *   {@link ART_ARM_ALPHA} or less is cleared to alpha 0 in the image the rig stage reads — the mask the trace,
 *   the reduction's coverage and the motion gate all read — and no field is added. The texture is not the
 *   policy's: after the rig stage the part's image as assembled is written back, so the check renders the same
 *   pixels as every other arm, and only the mesh moves.
 * - `dev4`, `dev8`: `targets.maxBoundaryDeviation` 4, 8, the source traced as `base` traces it (tolerance =
 *   margin = 2). One change.
 * - `cover`: `targets.artFit.minCoverage` 0.99 and `targets.artFit.maxUndercut` null (unbounded).
 * - `res2`, `res4`: `motion.residual.maxResidual` and `motion.maxLocalDeformation` 2, 4.
 * - `both`: `dev8`, the result's overshoot bound to match, `cover` and `res4`. "To match" is derived, not chosen:
 *   the source's own overshoot bound (5) plus the deviation (8) = 13, the furthest a boundary within the deviation
 *   of a source that passes its bound can sit past the art.
 * - `trace4`, `trace8` (beside the card's table): the other reading of "with the source traced at the same
 *   tolerance and margin" — source tolerance = margin = maxBoundaryDeviation = N, every overshoot bound
 *   2·N + 1, the production trial's own widening rule (its tol-2 rung: 2·2 + 1 = 5).
 *
 * A part whose art at the threshold the arm's trace reads is several 4-connected islands is given
 * `source.stray` = the second largest island's px — the production trial's manual retry (docs/evidence/
 * production-trial.md, *refusals*), here applied by rule so every arm reads the same way — and the row carries the
 * islands cleared and their share of the art.
 *
 * What a row carries, per part and arm: the verdict (or the stage and every problem that stopped it), the written
 * mesh's triangles and its outline (hull) and interior vertices, the step written, the motion reading, and what
 * refused the kept vertices in the reduction's final pass, by row: rig-c's report does not carry it, so the
 * reducer the rig stage is handed ({@link recordingReducer}) runs the same input through `reduceMeshWith` with an
 * attempt observer (tools/veto_tally.ts's instrument), checks the observed run writes `reduceMesh`'s report and
 * mesh byte for byte, and hands the stage `reduceMesh`'s own result; a run that differs is named and nothing is
 * counted. The final pass is the highest `pass` any removal attempt carries; each single removal refused in it is
 * one kept vertex, counted under the row its refusal names (the text before the first colon), outline or interior
 * by the source's hull.
 *
 * Nothing under `src/` is changed and no default moves: what is measured is the package as a consumer installs it,
 * with a config each arm writes.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { type AttemptRecord, type MeshReductionInput, reduceMeshWith, writeMeshQualityReport } from '@rig-c/core/mesh';
import { artRastersOf, stepRastersOf } from '@rig-c/core/meshrasters';
import { Plate, type RGBA } from '@rig-c/core/plate';
import { DEFAULT_PROJECT_RULE, DEFAULT_SEAM_RULE } from '../src/assemble.ts';
import { type ReductionResult, runReduction } from '../src/automesh.ts';
import { assembleStage, checkStage, rigStage } from '../src/build.ts';
import { barsNotMet, BARS, type CheckReport, DEFAULT_PAGE_EDGES, findRigc, JUDGEMENT_LINES, requirementsNotPass } from '../src/check.ts';
import { type AutoSpec, loadConfig } from '../src/config.ts';
import { PartsError, problemLine } from '../src/errors.ts';
import { connectedComponents, readPng, type Raster, writePng } from '../src/raster/index.ts';
import { DEFAULT_IDLE_KEYS, PAD } from '../src/rig.ts';
import { installedRigc, pinnedInputs } from './auto_motion_survey.ts';
import { policyEcho, rigcRunner, trackedSpacing, trialPolicy } from './production_trial.ts';

const ROOT = resolve(import.meta.dir, '..');

// ---------------------------------------------------------------------------
// 1. the arms, each one change over trialPolicy
// ---------------------------------------------------------------------------

export const ARMS = ['base', 'art', 'dev4', 'dev8', 'cover', 'res2', 'res4', 'both', 'trace4', 'trace8'] as const;
export type Arm = (typeof ARMS)[number];

/** The card's art threshold for the `art` arm: art is alpha above 8. */
export const ART_ARM_ALPHA = 8;

/** The card's arms, in its table's order; `trace4`/`trace8` are this tool's second reading of the "dev" row. */
export const CARD_ARMS: readonly Arm[] = ['base', 'art', 'dev4', 'dev8', 'cover', 'res2', 'res4', 'both'];

/** What each arm changes, in words, for the page. */
export const ARM_TEXT: Record<Arm, string> = {
  base: '`trialPolicy` as it is',
  art: `the art at alpha > ${ART_ARM_ALPHA}: the rig stage reads the part with every pixel at alpha <= ${ART_ARM_ALPHA} cleared; the texture written back before the check`,
  dev4: '`targets.maxBoundaryDeviation` 4; source traced as base (tolerance = margin = 2)',
  dev8: '`targets.maxBoundaryDeviation` 8; source traced as base (tolerance = margin = 2)',
  cover: '`targets.artFit.minCoverage` 0.99, `targets.artFit.maxUndercut` null',
  res2: '`motion.residual.maxResidual` 2, `motion.maxLocalDeformation` 2',
  res4: '`motion.residual.maxResidual` 4, `motion.maxLocalDeformation` 4',
  both: 'dev8 + `targets.artFit.maxOvershoot` 13 (the source bound 5 + the deviation 8) + cover + res4',
  trace4: 'source tolerance = margin = 4, `maxBoundaryDeviation` 4, every overshoot bound 9 (2·4 + 1)',
  trace8: 'source tolerance = margin = 8, `maxBoundaryDeviation` 8, every overshoot bound 17 (2·8 + 1)',
};

/** The spec of `arm` at the part's tracked spacing: `trialPolicy(spacing)` with the arm's one change. */
export function armSpec(arm: Arm, spacing: number): AutoSpec {
  const s = trialPolicy(spacing);
  const motion = (n: number): AutoSpec['motion'] => ({ ...s.motion, maxLocalDeformation: n, residual: { maxResidual: n } });
  switch (arm) {
    case 'base':
    case 'art':
      return s;
    case 'dev4':
    case 'dev8':
      return { ...s, targets: { ...s.targets, maxBoundaryDeviation: arm === 'dev4' ? 4 : 8 } };
    case 'cover':
      return { ...s, targets: { ...s.targets, artFit: { ...s.targets.artFit, minCoverage: 0.99, maxUndercut: null } } };
    case 'res2':
    case 'res4':
      return { ...s, motion: motion(arm === 'res2' ? 2 : 4) };
    case 'both': {
      const src = s.sourceBounds.maxOvershoot;
      if (src === null) throw new Error('auto_policy_survey: the both arm derives its overshoot from the source bound, and trialPolicy declares none');
      return {
        ...s,
        targets: { ...s.targets, maxBoundaryDeviation: 8, artFit: { minCoverage: 0.99, maxOvershoot: src + 8, maxUndercut: null } },
        motion: motion(4),
      };
    }
    case 'trace4':
    case 'trace8': {
      const n = arm === 'trace4' ? 4 : 8;
      const o = 2 * n + 1;
      return {
        ...s,
        source: { ...s.source, tolerance: n, margin: n },
        sourceBounds: { ...s.sourceBounds, maxOvershoot: o },
        targets: { ...s.targets, maxBoundaryDeviation: n, artFit: { ...s.targets.artFit, maxOvershoot: o } },
      };
    }
  }
}

/** The leaf paths at which two specs differ, in key order (a value of a different type at a path counts once). */
export function specPaths(a: unknown, b: unknown, at = ''): string[] {
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return keys.flatMap((k) => specPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], at === '' ? k : `${at}.${k}`));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [at];
}

/** Each distance bound of a spec, drawing px (= rig px: the parts are cut at the rig's scale and its bones carry none). */
export function boundsOf(s: AutoSpec): Array<[string, number]> {
  return [
    ['source tolerance', s.source.tolerance],
    ['source margin', s.source.margin],
    ['maxBoundaryDeviation', s.targets.maxBoundaryDeviation],
    ['artFit.maxOvershoot', s.targets.artFit.maxOvershoot ?? Number.NaN],
    ['motion.maxLocalDeformation', s.motion?.maxLocalDeformation ?? Number.NaN],
    ['motion.residual.maxResidual', s.motion?.residual?.maxResidual ?? Number.NaN],
  ];
}

// ---------------------------------------------------------------------------
// 2. the examples
// ---------------------------------------------------------------------------

export const EXAMPLES = ['demo', 'scarf', 'trailer'] as const;
export type ExampleKey = (typeof EXAMPLES)[number];

export interface Example {
  key: ExampleKey;
  config: string;
  painting: string;
  full: string;
  head: string;
  requirements: string | null;
}

/** Where an example's inputs are: `examples/<key>/` for demo and scarf, the trailer checkout's `inputs/` for the trailer. */
export function exampleOf(key: string, trailer: string | null): Example {
  if (key === 'demo' || key === 'scarf') {
    const ex = join(ROOT, 'examples', key, 'inputs');
    return { key, config: join(ROOT, 'examples', key, 'config.json'), painting: join(ex, 'painting.png'), full: join(ex, 'layers', 'full'), head: join(ex, 'layers', 'head'), requirements: null };
  }
  if (key === 'trailer') {
    if (trailer === null) throw new Error('auto_policy_survey: --example trailer needs --trailer <dir>, a checkout of https://github.com/rig-c/trailer');
    const ex = join(resolve(trailer), 'inputs');
    return { key, config: join(ex, 'config.json'), painting: join(ex, 'painting.png'), full: join(ex, 'layers', 'full'), head: join(ex, 'layers', 'head'), requirements: join(ex, 'requirements.json') };
  }
  throw new Error(`auto_policy_survey: --example ${key}: one of ${EXAMPLES.join(', ')} is required`);
}

type MeshEntry = { grid?: number; contour?: { spacing: number }; r: number; segments: unknown };

function meshesOf(ex: Example): Array<[string, MeshEntry]> {
  return Object.entries((JSON.parse(readFileSync(ex.config, 'utf8')) as { meshes: Record<string, MeshEntry> }).meshes);
}

/** The example's config with `specs` switched to `auto` (each `{ auto, r, segments }`, as the production trial switches), the rest as tracked. */
export function switchedConfig(ex: Example, specs: ReadonlyMap<string, AutoSpec>): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(ex.config, 'utf8')) as { meshes: Record<string, MeshEntry> };
  for (const [part, auto] of specs) {
    const m = raw.meshes[part];
    if (m === undefined) throw new Error(`auto_policy_survey: ${ex.key} has no mesh "${part}"`);
    (raw.meshes as Record<string, unknown>)[part] = { auto, r: m.r, segments: m.segments };
  }
  return raw;
}

// ---------------------------------------------------------------------------
// 3. masks: the art arm's clearing, and the stray rule
// ---------------------------------------------------------------------------

/** The part's image with every pixel at alpha `at` or less cleared to (0, 0, 0, 0), and how many were. */
export function clearFaint(img: Raster, at: number): { image: Raster; cleared: number } {
  const data = new Uint8ClampedArray(img.data);
  let cleared = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0 || data[i + 3] > at) continue;
    data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
    cleared++;
  }
  return { image: { width: img.width, height: img.height, data }, cleared };
}

/** The 4-connected islands of the art at alpha 1 and above, largest first, px each, and the art px. */
export function islandsOf(img: Raster): { areas: number[]; artPx: number } {
  const n = img.width * img.height;
  const art = new Uint8Array(n);
  let artPx = 0;
  for (let i = 0; i < n; i++) if (img.data[i * 4 + 3] > 0) (art[i] = 1), artPx++;
  const comp = connectedComponents({ width: img.width, height: img.height, data: art }, 4);
  return { areas: comp.stats.slice(1).map((s) => s.area).sort((a, b) => b - a), artPx };
}

/** The stray rule: none for one island; the second largest island's px otherwise, and what that leaves out. */
export function strayFor(img: Raster): { stray: number | null; islands: number; leftOutPx: number; artPx: number } {
  const { areas, artPx } = islandsOf(img);
  if (areas.length <= 1) return { stray: null, islands: areas.length, leftOutPx: 0, artPx };
  return { stray: areas[1], islands: areas.length, leftOutPx: areas.slice(1).reduce((a, b) => a + b, 0), artPx };
}

// ---------------------------------------------------------------------------
// 4. the reducer that also reads the final pass
// ---------------------------------------------------------------------------

/** What refused the kept vertices in a reduction's final pass. */
export interface FinalPass {
  /** The highest removal pass any attempt carries; null when no attempt was made. */
  pass: number | null;
  /** Single removals refused in that pass, by the row their refusal names: outline (source hull) and interior. */
  byRow: Record<string, { outline: number; interior: number }>;
  /** Of those, how many the deviation floor decided without a measurement (the row is then read in full). */
  floored: number;
  /** Single removals taken in that pass (a pass that takes one is followed by another unless the budget ends it). */
  taken: number;
  /** Boundary-run attempts in that pass, refused, by row. */
  runs: Record<string, number>;
  /** The source's vertex and hull counts, which the outline split reads. */
  source: { vertices: number; hull: number };
}

/** One recorded reduction: the part, the final pass, or why nothing was counted. */
export interface Recorded {
  object: string;
  final: FinalPass | null;
  refused: string | null;
}

/** The row a refusal names: its text up to the first colon (rig-c writes `<ROW>: <value> against <bound>`). */
export const rowOf = (refusal: string): string => refusal.split(':')[0].trim();

/** Tally a list of observed attempts into the final pass (exported for the selftest's hand-built attempts). */
export function finalPassOf(attempts: ReadonlyArray<{ kind: AttemptRecord['kind']; pass: number; sourceVertices: readonly number[]; refusal: string | null; floored: boolean }>, source: { vertices: number; hull: number }): FinalPass {
  const pass = attempts.length === 0 ? null : Math.max(...attempts.map((a) => a.pass));
  const out: FinalPass = { pass, byRow: {}, floored: 0, taken: 0, runs: {}, source };
  for (const a of attempts) {
    if (a.pass !== pass) continue;
    if (a.kind !== 'removal') {
      if (a.refusal !== null) out.runs[rowOf(a.refusal)] = (out.runs[rowOf(a.refusal)] ?? 0) + 1;
      continue;
    }
    if (a.refusal === null) {
      out.taken++;
      continue;
    }
    const row = (out.byRow[rowOf(a.refusal)] ??= { outline: 0, interior: 0 });
    if (a.sourceVertices[0] < source.hull) row.outline++;
    else row.interior++;
    if (a.floored) out.floored++;
  }
  return out;
}

/**
 * A reducer for `rigStage` that hands back `reduceMesh`'s own result (`runReduction`) and records, per object, the
 * final pass of the same input run through `reduceMeshWith` with an observer — counted only when that run wrote
 * `reduceMesh`'s report and mesh byte for byte.
 */
export function recordingReducer(sink: Recorded[]): (object: string, input: MeshReductionInput) => ReductionResult {
  return (object, input) => {
    // The acceptance loop's replays (`stopAfterAccepted`, src/autoreplay.ts) stop the same run at an earlier step;
    // they are run as the stage runs them and not counted: the final pass is the full run's.
    if (input.stopAfterAccepted !== undefined) return runReduction(object, input);
    const plain = runReduction(object, input);
    if ('code' in plain) {
      sink.push({ object, final: null, refused: `rig-c refused the input: ${plain.code}` });
      return plain;
    }
    const seen: Array<{ kind: AttemptRecord['kind']; pass: number; sourceVertices: number[]; refusal: string | null; floored: boolean }> = [];
    try {
      const rasters = artRastersOf(input.art);
      const observed = reduceMeshWith(input, rasters, stepRastersOf(rasters), null, (a) => {
        seen.push({ kind: a.kind, pass: a.pass, sourceVertices: [...a.sourceVertices], refusal: a.refusedBy === null ? null : a.refusedBy(), floored: a.decidedByFloor });
      });
      const same = writeMeshQualityReport(observed.report) === writeMeshQualityReport(plain.report) && JSON.stringify(observed.mesh) === JSON.stringify(plain.mesh);
      if (!same) sink.push({ object, final: null, refused: 'the observed run wrote a report or mesh that reduceMesh does not write for the same input; no count is claimed' });
      else sink.push({ object, final: finalPassOf(seen, { vertices: input.source.points.length, hull: input.source.hull }), refused: null });
    } catch (err) {
      sink.push({ object, final: null, refused: err instanceof Error ? err.message : String(err) });
    }
    return plain;
  };
}

// ---------------------------------------------------------------------------
// 5. the staged build
// ---------------------------------------------------------------------------

interface Staged {
  stoppedAt: 'assemble' | 'rig' | 'check' | null;
  problems: string[];
  check: CheckReport | null;
  out: string;
  wallS: number;
}

/** Strays and clearings each switched part was built with. */
export interface PartMask {
  stray: number | null;
  islands: number;
  leftOutPx: number;
  artPx: number;
  /** Pixels the art arm cleared (alpha 1 to 8); 0 on every other arm. */
  faintCleared: number;
}

/**
 * `build`'s stages on `ex` with `parts` switched under `arm` (`specs` without stray): assemble; per switched part the
 * mask the arm's trace reads (the art arm's clearing) and the stray rule on it; the rig stage over a copy of the
 * parts holding those masks; for the art arm the assembled images written back over the rig's; then, with `check`,
 * the check over the parts as assembled.
 */
function staged(ex: Example, arm: Arm, specs: ReadonlyMap<string, AutoSpec>, work: string, check: boolean, sink: Recorded[], masks: Map<string, PartMask>): Staged {
  const bin = findRigc(ROOT, process.env.PATH ?? '');
  const lines: string[] = [];
  const log = (stage: string) => (l: string) => lines.push(`[${stage}] ${l}`);
  const t0 = performance.now();
  const out = join(work, 'out');
  mkdirSync(out, { recursive: true });
  const done = (stoppedAt: Staged['stoppedAt'], problems: string[], report: CheckReport | null): Staged => ({ stoppedAt, problems, check: report, out, wallS: Math.round((performance.now() - t0) / 100) / 10 });
  const fail = (stage: 'assemble' | 'rig' | 'check', err: unknown): Staged => {
    if (!(err instanceof PartsError)) throw err;
    return done(stage, err.problems.map(problemLine), null);
  };
  const config = join(work, 'config.json');
  // A config names files beside it (`motion.animations_from`, a pose file): every JSON file of its directory is copied beside the switched one.
  for (const n of readdirSync(dirname(ex.config))) if (n.endsWith('.json') && n !== 'config.json') copyFileSync(join(dirname(ex.config), n), join(work, n));
  writeFileSync(config, JSON.stringify(switchedConfig(ex, specs), null, 1));
  try {
    loadConfig(config);
    assembleStage(
      { source: ex.painting, full: ex.full, head: ex.head, config, seam: DEFAULT_SEAM_RULE, project: DEFAULT_PROJECT_RULE },
      { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, 'recomposite_error_rig.png') },
      log('assemble'),
    );
  } catch (err) {
    return fail('assemble', err);
  }
  const rigIn = join(work, 'rig-in');
  mkdirSync(join(rigIn, 'parts'), { recursive: true });
  copyFileSync(join(out, 'parts.json'), join(rigIn, 'parts.json'));
  for (const n of readdirSync(join(out, 'parts'))) copyFileSync(join(out, 'parts', n), join(rigIn, 'parts', n));
  const withStray = new Map<string, AutoSpec>();
  for (const [part, spec] of specs) {
    let img = readPng(join(out, 'parts', `${part}.png`));
    let faintCleared = 0;
    if (arm === 'art') {
      const c = clearFaint(img, ART_ARM_ALPHA);
      img = c.image;
      faintCleared = c.cleared;
      writePng(join(rigIn, 'parts', `${part}.png`), img);
    }
    const st = strayFor(img);
    masks.set(part, { ...st, faintCleared });
    withStray.set(part, st.stray === null ? spec : { ...spec, source: { ...spec.source, stray: st.stray } });
  }
  writeFileSync(config, JSON.stringify(switchedConfig(ex, withStray), null, 1));
  const run = rigcRunner(bin, { n: 0 });
  try {
    rigStage({ config, parts: rigIn, out: join(out, 'rig'), idleKeys: DEFAULT_IDLE_KEYS, pageEdges: DEFAULT_PAGE_EDGES, command: 'build', reduce: recordingReducer(sink) }, run, join(work, 'scratch'), log('rig'));
  } catch (err) {
    return fail('rig', err);
  }
  if (arm === 'art') {
    // The texture is not the policy's: the image as assembled, padded as the rig stage pads it, written back.
    for (const part of specs.keys()) {
      const a = readPng(join(out, 'parts', `${part}.png`));
      const w = a.width + 2 * PAD;
      const h = a.height + 2 * PAD;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < a.height; y++) data.set(a.data.subarray(y * a.width * 4, (y + 1) * a.width * 4), ((y + PAD) * w + PAD) * 4);
      writePng(join(out, 'rig', 'images', `${part}.png`), { width: w, height: h, data });
    }
  }
  if (!check) return done(null, [], null);
  let report: CheckReport;
  try {
    report = checkStage({ rig: join(out, 'rig'), parts: out, out: join(out, 'check'), pageEdges: DEFAULT_PAGE_EDGES, ...(ex.requirements === null ? {} : { requirements: ex.requirements }) }, run, bin, log('check'));
  } catch (err) {
    return fail('check', err);
  }
  return done(report.figures.PASS ? null : 'check', report.problems.map(problemLine), report);
}

// ---------------------------------------------------------------------------
// 6. one part alone, one arm
// ---------------------------------------------------------------------------

/** A written mesh, in the part's own image px (the padding taken off): points, triangles, hull. */
export interface Wire {
  points: Array<[number, number]>;
  triangles: number[];
  hull: number;
}

export interface CellRow {
  example: string;
  arm: Arm;
  part: string;
  spacing: number;
  declared: AutoSpec;
  mask: PartMask | null;
  verdict: 'accepted' | 'refused';
  stoppedAt: string | null;
  problems: string[];
  /** The written mesh: triangles, outline (hull) and interior vertices. */
  figures: { triangles: number; outline: number; interior: number } | null;
  /** The source the reduction started from, off the report (vertices, hull). */
  source: { vertices: number; hull: number } | null;
  step: { kind: 'full' } | { kind: 'replayed'; chosen: number; of: number } | null;
  motion: { bound: number | null; grid: number | null; irr: number | null } | null;
  residual: { sent: boolean | null; value: number | null } | null;
  final: FinalPass | null;
  finalRefused: string | null;
  echoDiffers: string[];
  wire: Wire | null;
  wallS: number;
}

type RigMesh = { type?: string; uvs: number[]; triangles: number[]; hull: number; width: number; height: number };

function rigMeshOf(out: string, part: string): RigMesh | null {
  const p = join(out, 'rig', 'rig.json');
  if (!existsSync(p)) return null;
  const rig = JSON.parse(readFileSync(p, 'utf8')) as { skins: { default: Record<string, Record<string, RigMesh>> } };
  const a = rig.skins.default[part]?.[part];
  return a !== undefined && a.type === 'mesh' ? a : null;
}

function wireOf(m: RigMesh): Wire {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < m.uvs.length; i += 2) points.push([Math.round((m.uvs[i] * m.width - PAD) * 1000) / 1000, Math.round((m.uvs[i + 1] * m.height - PAD) * 1000) / 1000]);
  return { points, triangles: [...m.triangles], hull: m.hull };
}

function reportRow(out: string, part: string): Record<string, unknown> | undefined {
  const p = join(out, 'rig', 'mesh_report.json');
  if (!existsSync(p)) return undefined;
  return (JSON.parse(readFileSync(p, 'utf8')) as Array<Record<string, unknown>>).find((r) => r.part === part);
}

function motionOf(row: Record<string, unknown>): CellRow['motion'] {
  type Phase = { phase: string | null; value: number | null };
  const rep = row.motion_report as { candidates?: Array<{ motion?: { rows?: Array<{ code: string; object: { region: string | null }; bound: { value: number } | null; motion?: { byPhase?: Phase[] } }> } }> } | undefined;
  const r = rep?.candidates?.[0]?.motion?.rows?.find((x) => x.code === 'MQ_LOCAL_DEFORMATION' && x.object.region === null);
  if (r === undefined) return null;
  const of = (phase: string): number | null => r.motion?.byPhase?.find((x) => x.phase === phase)?.value ?? null;
  return { bound: r.bound?.value ?? null, grid: of('grid'), irr: of('irr') };
}

/** One part alone under one arm. */
export function runCell(ex: Example, arm: Arm, part: string): CellRow {
  const entry = meshesOf(ex).find(([p]) => p === part)?.[1];
  if (entry === undefined) throw new Error(`auto_policy_survey: ${ex.key} has no mesh "${part}"`);
  const { spacing } = trackedSpacing(entry, `${ex.key} meshes.${part}`);
  const spec = armSpec(arm, spacing);
  const work = mkdtempSync(join(tmpdir(), 'rig-parts-policy-'));
  try {
    const sink: Recorded[] = [];
    const masks = new Map<string, PartMask>();
    const b = staged(ex, arm, new Map([[part, spec]]), work, false, sink, masks);
    const mask = masks.get(part) ?? null;
    const declared = mask?.stray === null || mask === null ? spec : { ...spec, source: { ...spec.source, stray: mask.stray } };
    const row = reportRow(b.out, part);
    const auto = row !== undefined && row.mode === 'auto' ? row : undefined;
    const green = b.stoppedAt === null;
    const m = green ? rigMeshOf(b.out, part) : null;
    const replay = auto?.replay as { chosen_step?: number; accepted_steps?: number } | undefined;
    const sk = auto?.skinning_residual as { sent: boolean; measured: { value: number | null } | null } | undefined;
    const rec = sink.filter((r) => r.object === `config.meshes.${part}.auto`);
    const last = rec.length === 0 ? null : rec[rec.length - 1];
    return {
      example: ex.key,
      arm,
      part,
      spacing,
      declared,
      mask,
      verdict: green ? 'accepted' : 'refused',
      stoppedAt: b.stoppedAt,
      problems: b.problems,
      figures: m === null ? null : { triangles: m.triangles.length / 3, outline: m.hull, interior: m.uvs.length / 2 - m.hull },
      source: rec.length === 1 ? (last?.final?.source ?? null) : null,
      step: auto === undefined || !green ? null : replay?.chosen_step !== undefined ? { kind: 'replayed', chosen: replay.chosen_step, of: replay.accepted_steps ?? 0 } : { kind: 'full' },
      motion: auto === undefined ? null : motionOf(auto),
      residual: auto === undefined ? null : { sent: sk?.sent ?? null, value: sk?.measured?.value ?? null },
      final: rec.length === 1 ? (last?.final ?? null) : null,
      finalRefused: rec.length === 0 ? 'no reduction ran' : rec.length > 1 ? `${rec.length} full reductions ran for the part; none is counted` : last?.refused ?? null,
      echoDiffers: auto === undefined ? [] : policyEcho(declared, auto),
      wire: m === null ? null : wireOf(m),
      wallS: b.wallS,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 7. the example under one arm: every part that built alone, at once, checked
// ---------------------------------------------------------------------------

export interface BarReading {
  bar: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  /** The bar's headline figure, as check.json writes it. */
  figure: string;
}

export interface ExampleRun {
  example: string;
  arm: Arm;
  switched: string[];
  stoppedAt: string | null;
  problems: string[];
  bars: BarReading[];
  requirements: Array<{ name: string; status: string }>;
  barsNotMet: string[];
  /** The figure's height in rig px: the union of every part's box in parts.json. */
  figureHeight: number | null;
  /** Every mesh's triangles in the build, by part (switched or tracked). */
  triangles: Record<string, number>;
  wallS: number;
}

/** The headline figure of each bar, read off check.json. */
export function barReadings(fig: Record<string, unknown>): BarReading[] {
  const out: BarReading[] = [];
  out.push({ bar: 'gate', status: fig.gate_spine_html_green === true ? 'PASS' : 'FAIL', figure: String(fig.gate_spine_html_green) });
  out.push({ bar: 'loop', status: fig.loop_max_diff === null ? 'SKIP' : fig.loop_max_diff === 0 ? 'PASS' : 'FAIL', figure: `max |d| ${String(fig.loop_max_diff)}` });
  const notMet = barsNotMet(fig);
  out.push({ bar: 'seam', status: fig.seam_mean === null ? 'SKIP' : notMet.includes('seam') ? 'FAIL' : 'PASS', figure: `mean ${String(fig.seam_mean)}, ${String(fig.seam_px_over_40)} px over 40 at s ${String(fig.seam_frame_scale)}` });
  const headline: Record<string, string[]> = {
    BREATH_VISIBLE: ['torso_heat_mean', 'torso_floor'],
    BLINK_NO_HOLE: ['hole_px', 'patch_px_over_40'],
    CHAIN_LAG: ['first_violation'],
    TIP_OVER_ROOT: ['parts'],
    STILL_REGIONS_DARK: ['face', 'feet'],
    TEXTURE_STRETCH: ['severity', 'severity_ceiling', 'max_ratio', 'min_ratio'],
  };
  for (const n of JUDGEMENT_LINES) {
    const l = fig[n] as Record<string, unknown> | undefined;
    const status = (l?.status ?? 'SKIP') as BarReading['status'];
    const keys = headline[n] ?? [];
    const figure = l === undefined ? '' : status === 'SKIP' ? String(l.reason) : keys.map((k) => `${k} ${headlineText(l[k])}`).join('; ');
    out.push({ bar: n, status, figure });
  }
  return out;
}

function headlineText(v: unknown): string {
  if (v === undefined) return '-';
  if (typeof v === 'number' || typeof v === 'string' || v === null || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    // TIP_OVER_ROOT parts: each part's ratio.
    return v.map((x) => (typeof x === 'object' && x !== null && 'part' in x ? `${String((x as { part: unknown }).part)} ${String((x as { ratio?: unknown }).ratio)}` : JSON.stringify(x))).join(' | ');
  }
  const o = v as Record<string, unknown>;
  if ('max_rig_px' in o) return `max ${String(o.max_rig_px)} rig px`;
  return JSON.stringify(v);
}

function figureHeight(out: string): number | null {
  const p = join(out, 'parts.json');
  if (!existsSync(p)) return null;
  const parts = (JSON.parse(readFileSync(p, 'utf8')) as { parts: Array<{ y: number; h: number }> }).parts;
  if (parts.length === 0) return null;
  return Math.max(...parts.map((q) => q.y + q.h)) - Math.min(...parts.map((q) => q.y));
}

function trianglesOf(out: string): Record<string, number> {
  const p = join(out, 'rig', 'rig.json');
  if (!existsSync(p)) return {};
  const rig = JSON.parse(readFileSync(p, 'utf8')) as { skins: { default: Record<string, Record<string, { type?: string; triangles?: number[] }>> } };
  const t: Record<string, number> = {};
  for (const [slot, atts] of Object.entries(rig.skins.default)) for (const a of Object.values(atts)) if (a.type === 'mesh' && a.triangles !== undefined) t[slot] = a.triangles.length / 3;
  return t;
}

/** The example once with `cells`' accepted parts switched at once (each under the spec its cell declared), checked; its packed build kept under `keep`. */
export function runExample(ex: Example, arm: Arm, cells: readonly CellRow[], keep: string | null): ExampleRun {
  const specs = new Map<string, AutoSpec>();
  for (const c of cells) if (c.verdict === 'accepted') specs.set(c.part, armSpec(arm, c.spacing));
  const work = mkdtempSync(join(tmpdir(), 'rig-parts-policy-'));
  try {
    const b = staged(ex, arm, specs, work, true, [], new Map());
    const fig = b.check === null ? null : (b.check.figures as unknown as Record<string, unknown>);
    if (keep !== null && b.check !== null) {
      mkdirSync(keep, { recursive: true });
      const dir = join(b.out, 'check', 'build');
      if (existsSync(dir)) for (const n of readdirSync(dir)) if (n.endsWith('.json') || n.endsWith('.atlas') || n.endsWith('.png')) copyFileSync(join(dir, n), join(keep, n));
      copyFileSync(join(b.out, 'check', 'check.json'), join(keep, 'check.json'));
    }
    return {
      example: ex.key,
      arm,
      switched: [...specs.keys()],
      stoppedAt: b.stoppedAt,
      problems: b.problems,
      bars: fig === null ? [] : barReadings(fig),
      requirements: fig === null ? [] : Object.entries(((fig.requirements as { lines?: Record<string, { status: string }> } | undefined)?.lines ?? {})).map(([name, l]) => ({ name, status: l.status })),
      barsNotMet: fig === null ? [] : [...barsNotMet(fig), ...requirementsNotPass(fig).map((n) => `requirement ${n}`)],
      figureHeight: figureHeight(b.out),
      triangles: trianglesOf(b.out),
      wallS: b.wallS,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The example as tracked (no part switched), checked: the reference column. */
export function runTracked(ex: Example, keep: string | null): ExampleRun & { parts: string } {
  const work = mkdtempSync(join(tmpdir(), 'rig-parts-policy-'));
  try {
    const b = staged(ex, 'base', new Map(), work, true, [], new Map());
    const fig = b.check === null ? null : (b.check.figures as unknown as Record<string, unknown>);
    if (keep !== null) {
      mkdirSync(join(keep, 'parts'), { recursive: true });
      for (const n of readdirSync(join(b.out, 'parts'))) copyFileSync(join(b.out, 'parts', n), join(keep, 'parts', n));
      copyFileSync(join(b.out, 'parts.json'), join(keep, 'parts.json'));
      const dir = join(b.out, 'check', 'build');
      if (existsSync(dir)) for (const n of readdirSync(dir)) if (n.endsWith('.json') || n.endsWith('.atlas') || n.endsWith('.png')) copyFileSync(join(dir, n), join(keep, n));
      // the lattice build's own check figures, beside its skeleton, as runExample keeps its arm's (density_survey --auto-table reads them)
      if (existsSync(join(b.out, 'check', 'check.json'))) copyFileSync(join(b.out, 'check', 'check.json'), join(keep, 'check.json'));
    }
    return {
      example: ex.key,
      arm: 'base',
      switched: [],
      stoppedAt: b.stoppedAt,
      problems: b.problems,
      bars: fig === null ? [] : barReadings(fig),
      requirements: fig === null ? [] : Object.entries(((fig.requirements as { lines?: Record<string, { status: string }> } | undefined)?.lines ?? {})).map(([name, l]) => ({ name, status: l.status })),
      barsNotMet: fig === null ? [] : [...barsNotMet(fig), ...requirementsNotPass(fig).map((n) => `requirement ${n}`)],
      figureHeight: figureHeight(b.out),
      triangles: trianglesOf(b.out),
      wallS: b.wallS,
      parts: 'tracked',
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 8. the contact sheet
// ---------------------------------------------------------------------------

const INK: RGBA = [20, 20, 20, 255];
const WIRE: RGBA = [30, 80, 210, 255];
const HULL: RGBA = [210, 40, 40, 255];
const FAINT: RGBA = [250, 170, 40, 255];
const PAPER: RGBA = [255, 255, 255, 255];
const GREY: RGBA = [150, 150, 150, 255];

/** The largest side a part is drawn at on the sheet, px; a larger part is scaled down by a whole-number step. */
export const SHEET_CELL = 240;

/**
 * The contact sheet of one example: a row per mesh part, a column per arm; in each cell the part's art (lightened,
 * the pixels at alpha 1 to 8 in orange so the art arm's reading shows), the written mesh's edges in blue and its
 * outline in red, and the counts under it — or the refusal's code in place of the mesh.
 */
export function sheet(ex: Example, arms: readonly Arm[], cells: readonly CellRow[], partsDir: string): Plate {
  const gap = 10;
  const parts = meshesOf(ex).map(([p]) => p);
  const imgs = new Map(parts.map((p) => [p, readPng(join(partsDir, `${p}.png`))] as const));
  const step = (img: Raster): number => Math.max(1, Math.ceil(Math.max(img.width, img.height) / SHEET_CELL));
  const colW = Math.max(SHEET_CELL, 130) + gap;
  const capH = 4 * 10 + 4;
  const rowH = parts.map((p) => Math.ceil((imgs.get(p) as Raster).height / step(imgs.get(p) as Raster)) + capH + 12 + gap);
  const W = 90 + arms.length * colW + gap;
  const H = 40 + rowH.reduce((a, b) => a + b, 0);
  const plate = new Plate(W, H);
  plate.rect(0, 0, W, H, PAPER);
  plate.text(`${ex.key.toUpperCase()}: EACH PART ALONE UNDER EACH ARM. BLUE EDGES, RED OUTLINE, ORANGE ART AT ALPHA 1-${ART_ARM_ALPHA}. T TRIANGLES, O OUTLINE V, I INTERIOR V`, gap, gap, 1, INK);
  arms.forEach((a, k) => plate.text(a.toUpperCase(), 90 + k * colW, 26, 1, INK));
  let oy = 40;
  parts.forEach((part, r) => {
    const img = imgs.get(part) as Raster;
    const s = step(img);
    plate.text(part.toUpperCase(), gap, oy + 12, 1, INK);
    arms.forEach((arm, k) => {
      const ox = 90 + k * colW;
      for (let y = 0; y < img.height; y += s) {
        for (let x = 0; x < img.width; x += s) {
          const i = (y * img.width + x) * 4;
          const a = img.data[i + 3];
          if (a === 0) continue;
          plate.set(ox + x / s, oy + 12 + y / s, a <= ART_ARM_ALPHA ? FAINT : [Math.round((img.data[i] + 3 * 255) / 4), Math.round((img.data[i + 1] + 3 * 255) / 4), Math.round((img.data[i + 2] + 3 * 255) / 4), 255]);
        }
      }
      const c = cells.find((x) => x.arm === arm && x.part === part);
      const caption: string[] = [];
      if (c === undefined) caption.push('NOT RUN');
      else if (c.wire === null || c.figures === null) {
        caption.push('REFUSED');
        caption.push(...[...new Set(c.problems.map((p) => p.split(':')[0]))].slice(0, 2).map((p) => p.slice(0, 22)));
      } else {
        const w = c.wire;
        for (let t = 0; t + 2 < w.triangles.length; t += 3) {
          for (let e = 0; e < 3; e++) {
            const p = w.points[w.triangles[t + e]];
            const q = w.points[w.triangles[t + ((e + 1) % 3)]];
            plate.line(ox + p[0] / s, oy + 12 + p[1] / s, ox + q[0] / s, oy + 12 + q[1] / s, 1, WIRE);
          }
        }
        for (let v = 0; v < w.hull; v++) {
          const p = w.points[v];
          const q = w.points[(v + 1) % w.hull];
          plate.line(ox + p[0] / s, oy + 12 + p[1] / s, ox + q[0] / s, oy + 12 + q[1] / s, 1, HULL);
        }
        caption.push(`T ${c.figures.triangles} O ${c.figures.outline} I ${c.figures.interior}`);
        caption.push(c.step === null ? '' : c.step.kind === 'full' ? 'FULL' : `STEP ${c.step.chosen}/${c.step.of}`);
        if (c.mask !== null && c.mask.stray !== null) caption.push(`STRAY ${c.mask.stray}`);
      }
      if (s > 1) caption.push(`DRAWN 1/${s}`);
      const ih = Math.ceil(img.height / s);
      caption.slice(0, 4).forEach((l, i) => plate.text(l, ox, oy + 12 + ih + 4 + i * 10, 1, c === undefined || c.verdict === 'refused' ? HULL : INK));
    });
    oy += rowH[r];
    plate.line(gap, oy - gap / 2, W - gap, oy - gap / 2, 1, GREY);
  });
  return plate;
}

// ---------------------------------------------------------------------------
// 9. the page
// ---------------------------------------------------------------------------

/** One example's evidence as the page reads it: the cells and the checked build per arm, and the tracked build. */
export interface ExampleEvidence {
  key: ExampleKey;
  arms: Map<Arm, { cells: CellRow[]; example: ExampleRun | null }>;
  tracked: ExampleRun | null;
}

/** The evidence of `key` under `dir`: every `<key>-<arm>.json` present, and `<key>-tracked.json`. */
export function readEvidence(dir: string, key: ExampleKey): ExampleEvidence {
  const arms = new Map<Arm, { cells: CellRow[]; example: ExampleRun | null }>();
  for (const a of ARMS) {
    const p = join(dir, `${key}-${a}.json`);
    if (existsSync(p)) arms.set(a, JSON.parse(readFileSync(p, 'utf8')) as { cells: CellRow[]; example: ExampleRun | null });
  }
  const t = join(dir, `${key}-tracked.json`);
  return { key, arms, tracked: existsSync(t) ? (JSON.parse(readFileSync(t, 'utf8')) as { example: ExampleRun }).example : null };
}

const codes = (c: CellRow): string => [...new Set(c.problems.map((p) => p.split(':')[0]))].join(', ');

/** A cell's figures in a table: `T / O / I`, the step when replayed, or the refusal's codes. */
export function cellText(c: CellRow | undefined): string {
  if (c === undefined) return 'not run';
  if (c.figures === null) return `refused (${c.stoppedAt}): ${codes(c)}`;
  return `${c.figures.triangles} / ${c.figures.outline} / ${c.figures.interior}${c.step !== null && c.step.kind === 'replayed' ? ` (step ${c.step.chosen} of ${c.step.of})` : ''}`;
}

/** The final pass in a table: each row's kept vertices, outline + interior, the most first. */
export function finalText(c: CellRow | undefined): string {
  if (c === undefined) return '—';
  if (c.final === null) return c.finalRefused === null ? '—' : `not counted: ${c.finalRefused}`;
  const rows = Object.entries(c.final.byRow).sort((a, b) => b[1].outline + b[1].interior - (a[1].outline + a[1].interior) || (a[0] < b[0] ? -1 : 1));
  const t = rows.map(([r, n]) => `${r} ${n.outline}+${n.interior}`).join(', ');
  return `${t === '' ? 'none' : t}${c.final.taken > 0 ? `; ${c.final.taken} taken` : ''}`;
}

/** Parts that built alone under every arm in `arms`. */
export function commonParts(ev: ExampleEvidence, arms: readonly Arm[]): string[] {
  const first = ev.arms.get(arms[0]);
  if (first === undefined) return [];
  return first.cells.map((c) => c.part).filter((p) => arms.every((a) => ev.arms.get(a)?.cells.find((c) => c.part === p)?.verdict === 'accepted'));
}

/** Σ triangles / outline / interior over `parts` under `arm`. */
export function totals(ev: ExampleEvidence, arm: Arm, parts: readonly string[]): { triangles: number; outline: number; interior: number } {
  const cells = ev.arms.get(arm)?.cells ?? [];
  const out = { triangles: 0, outline: 0, interior: 0 };
  for (const p of parts) {
    const f = cells.find((c) => c.part === p)?.figures;
    if (f === undefined || f === null) continue;
    out.triangles += f.triangles;
    out.outline += f.outline;
    out.interior += f.interior;
  }
  return out;
}

/** The bars of the arm's checked build that differ from base's, by status or figure, each `bar: base → arm`. */
export function barsMoved(ev: ExampleEvidence, arm: Arm): string[] {
  const b = ev.arms.get('base')?.example;
  const a = ev.arms.get(arm)?.example;
  if (b === null || b === undefined || a === null || a === undefined) return ['not comparable: a checked build is missing'];
  const out: string[] = [];
  for (const r of a.bars) {
    const q = b.bars.find((x) => x.bar === r.bar);
    if (q === undefined || q.status !== r.status || q.figure !== r.figure) out.push(`${r.bar}: ${q === undefined ? '—' : `${q.status} (${q.figure})`} → ${r.status} (${r.figure})`);
  }
  for (const r of a.requirements) {
    const q = b.requirements.find((x) => x.name === r.name);
    if (q === undefined || q.status !== r.status) out.push(`requirement ${r.name}: ${q?.status ?? '—'} → ${r.status}`);
  }
  return out;
}

const pct = (x: number, of: number): string => `${((100 * x) / of).toFixed(2)} %`;

/** The Markdown page from the evidence of every example. */
export function page(evidence: readonly ExampleEvidence[], provenance: { machine: string; trailer: string; rigc: string }): string[] {
  const L: string[] = [];
  L.push('# The automatic mesh policy on the public parts: outline, art threshold and reduction bounds (issue #266, Stage A)');
  L.push('');
  L.push(`Generated by \`bun tools/auto_policy_survey.ts\`; every figure below is the tool's, none typed. The installed rig-c ${provenance.rigc}. The parts are \`demo\` and \`scarf\` (parts-examples at commit ${pinnedInputs()}, \`bun run fetch-examples\`, each with its tracked \`examples/<key>/config.json\`) and the trailer (https://github.com/rig-c/trailer at commit ${provenance.trailer}, its \`inputs/\` and \`inputs/requirements.json\`). Every mesh part of each config, switched alone to \`auto\` (\`{ auto, r, segments }\`, as the production trial switches; a tracked region is not carried) under each arm, through \`assembleStage\` and \`rigStage\`; then each example with every part that built alone under the arm switched at once, through \`checkStage\` too. Cells ran on: ${provenance.machine}.`);
  L.push('');
  L.push('The contact sheets are read before the tables: [demo](auto-policy-survey-demo.png), [scarf](auto-policy-survey-scarf.png), [trailer](auto-policy-survey-trailer.png) — each part alone under each arm, the mesh over the part\'s art, the outline in red, the art at alpha 1 to 8 in orange.');
  L.push('');
  L.push('## The arms');
  L.push('');
  L.push('Each arm is one change over `trialPolicy` (tools/production_trial.ts: source tolerance = margin = 2, maxBoundaryDeviation 2, every overshoot bound 5, coverage 1, undercut 0 on the result, motion and residual 1 rig px, the Stage B opt-ins). `trace4`/`trace8` are not the card\'s: they read its "dev" row the other way (the source traced at N) and stand beside it. A part whose art is several 4-connected islands is given `source.stray` = its second largest island, on every arm alike (the production trial\'s manual retry, here by rule).');
  L.push('');
  L.push('| arm | change |');
  L.push('| --- | --- |');
  for (const a of ARMS) L.push(`| ${a} | ${ARM_TEXT[a]} |`);
  L.push('');
  L.push('## The bounds in rig px over the figure');
  L.push('');
  L.push('Every bound is in the part\'s drawing px, which are rig px (the parts are cut at the rig\'s scale; no bone carries a scale). The figure\'s height is the union of every part\'s box in the assembled `parts.json`, rig px.');
  L.push('');
  const heights = evidence.map((e) => ({ key: e.key, h: e.tracked?.figureHeight ?? null }));
  L.push(`| arm | bound | rig px | ${heights.map((h) => `share of ${h.key} (${h.h ?? '—'} px)`).join(' | ')} |`);
  L.push(`| --- | --- | ---: | ${heights.map(() => '---:').join(' | ')} |`);
  for (const a of ARMS) {
    for (const [name, v] of boundsOf(armSpec(a, 0))) {
      const base = boundsOf(armSpec('base', 0)).find(([n]) => n === name)?.[1];
      if (a !== 'base' && base === v) continue;
      L.push(`| ${a} | ${name} | ${v} | ${heights.map((h) => (h.h === null ? '—' : pct(v, h.h))).join(' | ')} |`);
    }
  }
  L.push('');
  for (const ev of evidence) {
    L.push(`## ${ev.key}`);
    L.push('');
    const armsRun = ARMS.filter((a) => ev.arms.has(a));
    const parts = ev.arms.get(armsRun[0])?.cells.map((c) => c.part) ?? [];
    L.push('### Each part alone: triangles / outline vertices / interior vertices');
    L.push('');
    L.push(`| part | ${armsRun.join(' | ')} |`);
    L.push(`| --- | ${armsRun.map(() => '---').join(' | ')} |`);
    for (const p of parts) L.push(`| ${p} | ${armsRun.map((a) => cellText(ev.arms.get(a)?.cells.find((c) => c.part === p))).join(' | ')} |`);
    const card = CARD_ARMS.filter((a) => ev.arms.has(a));
    const common = commonParts(ev, card);
    L.push(`| **Σ over the ${common.length} part(s) built under every card arm** | ${armsRun.map((a) => {
      if (!common.every((p) => ev.arms.get(a)?.cells.find((c) => c.part === p)?.verdict === 'accepted')) return '— (a part of the set refused)';
      const t = totals(ev, a, common);
      return `${t.triangles} / ${t.outline} / ${t.interior}`;
    }).join(' | ')} |`);
    L.push('');
    const strays = parts.flatMap((p) => {
      const c = ev.arms.get('base')?.cells.find((x) => x.part === p);
      return c?.mask === null || c?.mask === undefined || c.mask.stray === null ? [] : [`${p} ${c.mask.stray} (${c.mask.islands} islands, ${c.mask.leftOutPx} of ${c.mask.artPx} art px left out, ${pct(c.mask.leftOutPx, c.mask.artPx)})`];
    });
    L.push(`Stray under base: ${strays.length === 0 ? 'none' : strays.join('; ')}.`);
    const faint = parts.flatMap((p) => {
      const c = ev.arms.get('art')?.cells.find((x) => x.part === p);
      return c?.mask === null || c?.mask === undefined ? [] : [`${p} ${c.mask.faintCleared}`];
    });
    if (faint.length > 0) L.push(`Pixels at alpha 1 to ${ART_ARM_ALPHA} the art arm cleared: ${faint.join(', ')}.`);
    L.push('');
    L.push('### What refused the kept vertices in the final pass');
    L.push('');
    L.push('Per row: the kept vertices it refused, outline + interior (the source\'s hull splits them). The full run\'s final pass; a part written at a replayed step was cut short of it by the acceptance loop.');
    L.push('');
    L.push(`| part | ${armsRun.join(' | ')} |`);
    L.push(`| --- | ${armsRun.map(() => '---').join(' | ')} |`);
    for (const p of parts) L.push(`| ${p} | ${armsRun.map((a) => finalText(ev.arms.get(a)?.cells.find((c) => c.part === p))).join(' | ')} |`);
    L.push('');
    L.push('### Every `check` bar of the rig built with the arm\'s meshes');
    L.push('');
    L.push(`| bar | tracked | ${armsRun.join(' | ')} |`);
    L.push(`| --- | --- | ${armsRun.map(() => '---').join(' | ')} |`);
    const barNames = ev.arms.get('base')?.example?.bars.map((b) => b.bar) ?? [];
    for (const n of barNames) {
      const t = ev.tracked?.bars.find((b) => b.bar === n);
      L.push(`| ${n} | ${t === undefined ? '—' : `${t.status}: ${t.figure}`} | ${armsRun.map((a) => {
        const r = ev.arms.get(a)?.example?.bars.find((b) => b.bar === n);
        return r === undefined ? '—' : `${r.status}: ${r.figure}`;
      }).join(' | ')} |`);
    }
    const reqNames = ev.tracked?.requirements.map((r) => r.name) ?? [];
    for (const n of reqNames) L.push(`| requirement ${n} | ${ev.tracked?.requirements.find((r) => r.name === n)?.status ?? '—'} | ${armsRun.map((a) => ev.arms.get(a)?.example?.requirements.find((r) => r.name === n)?.status ?? '—').join(' | ')} |`);
    L.push(`| parts switched | 0 (tracked) | ${armsRun.map((a) => ev.arms.get(a)?.example?.switched.length ?? '—').join(' | ')} |`);
    L.push(`| verdict | ${ev.tracked === null ? '—' : ev.tracked.stoppedAt ?? 'PASS'} | ${armsRun.map((a) => {
      const e = ev.arms.get(a)?.example;
      return e === null || e === undefined ? '—' : e.stoppedAt === null ? 'PASS' : `stopped at ${e.stoppedAt}${e.barsNotMet.length > 0 ? `: ${e.barsNotMet.join(', ')}` : ''}`;
    }).join(' | ')} |`);
    L.push(`| Σ mesh triangles in the build | ${ev.tracked === null ? '—' : Object.values(ev.tracked.triangles).reduce((x, y) => x + y, 0)} | ${armsRun.map((a) => {
      const e = ev.arms.get(a)?.example;
      return e === null || e === undefined ? '—' : Object.values(e.triangles).reduce((x, y) => x + y, 0);
    }).join(' | ')} |`);
    L.push('');
    L.push('Bars that moved against base (status or headline figure):');
    L.push('');
    for (const a of armsRun.filter((x) => x !== 'base')) {
      const m = barsMoved(ev, a);
      L.push(`- ${a}: ${m.length === 0 ? 'none' : m.join('; ')}`);
    }
    L.push('');
    L.push('### Refusals, verbatim (the first problem of each)');
    L.push('');
    for (const a of armsRun) {
      for (const c of ev.arms.get(a)?.cells ?? []) if (c.verdict === 'refused') L.push(`- ${a} ${c.part}: \`${(c.problems[0] ?? '').replace(/`/g, "'").slice(0, 600)}\``);
      const e = ev.arms.get(a)?.example;
      if (e !== null && e !== undefined && e.stoppedAt !== null && e.stoppedAt !== 'check') L.push(`- ${a}, the example: \`${(e.problems[0] ?? '').replace(/`/g, "'").slice(0, 600)}\``);
    }
    L.push('');
  }
  L.push('## Re-running this evidence');
  L.push('');
  L.push('```');
  L.push('bun run fetch-examples');
  L.push('git clone https://github.com/rig-c/trailer <dir>   # the commit above');
  L.push('bun tools/auto_policy_survey.ts --tracked --example <key> --evidence <dir> [--trailer <dir>]');
  L.push('bun tools/auto_policy_survey.ts --run --example <key> --arm <arm> --evidence <dir> [--trailer <dir>]   # every key and arm');
  L.push('bun tools/auto_policy_survey.ts --sheet --example <key> --evidence <dir> --out docs/evidence/auto-policy-survey-<key>.png');
  L.push('bun tools/auto_policy_survey.ts --page --evidence <dir> --trailer-commit <sha> --machine <text> > docs/evidence/auto-policy-survey.md');
  L.push('```');
  return L;
}

// ---------------------------------------------------------------------------
// 10. the command line
// ---------------------------------------------------------------------------

function arg(argv: readonly string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i < 0 ? null : (argv[i + 1] ?? null);
}

function must(argv: readonly string[], name: string): string {
  const v = arg(argv, name);
  if (v === null) throw new Error(`auto_policy_survey: ${name} <value> is required`);
  return v;
}

function main(argv: readonly string[]): void {
  const trailer = arg(argv, '--trailer');
  if (argv.includes('--run')) {
    const ex = exampleOf(must(argv, '--example'), trailer);
    const arm = must(argv, '--arm') as Arm;
    if (!ARMS.includes(arm)) throw new Error(`auto_policy_survey: --arm ${arm}: one of ${ARMS.join(', ')} is required`);
    const evidence = resolve(must(argv, '--evidence'));
    mkdirSync(evidence, { recursive: true });
    const only = arg(argv, '--parts');
    const parts = meshesOf(ex).map(([p]) => p).filter((p) => only === null || only.split(',').includes(p));
    const cells: CellRow[] = [];
    for (const part of parts) {
      const c = runCell(ex, arm, part);
      process.stderr.write(`${ex.key}/${arm}/${part}: ${c.verdict}${c.figures === null ? ` ${c.stoppedAt} ${c.problems.map((p) => p.split(':')[0]).join(',')}` : ` T ${c.figures.triangles} O ${c.figures.outline} I ${c.figures.interior}`} ${c.wallS}s\n`);
      cells.push(c);
      writeFileSync(join(evidence, `${ex.key}-${arm}.json`), `${JSON.stringify({ rigc: installedRigc(), cells, example: null }, null, 1)}\n`);
    }
    const run = argv.includes('--no-example') ? null : runExample(ex, arm, cells, join(evidence, `${ex.key}-${arm}`));
    if (run !== null) process.stderr.write(`${ex.key}/${arm}: example ${run.stoppedAt ?? 'PASS'} not met ${run.barsNotMet.join(',') || 'none'} ${run.wallS}s\n`);
    writeFileSync(join(evidence, `${ex.key}-${arm}.json`), `${JSON.stringify({ rigc: installedRigc(), cells, example: run }, null, 1)}\n`);
    return;
  }
  if (argv.includes('--tracked')) {
    const ex = exampleOf(must(argv, '--example'), trailer);
    const evidence = resolve(must(argv, '--evidence'));
    const run = runTracked(ex, join(evidence, `${ex.key}-tracked`));
    process.stderr.write(`${ex.key}/tracked: ${run.stoppedAt ?? 'PASS'} not met ${run.barsNotMet.join(',') || 'none'} ${run.wallS}s\n`);
    writeFileSync(join(evidence, `${ex.key}-tracked.json`), `${JSON.stringify({ rigc: installedRigc(), example: run }, null, 1)}\n`);
    return;
  }
  if (argv.includes('--sheet')) {
    const ex = exampleOf(must(argv, '--example'), trailer);
    const evidence = resolve(must(argv, '--evidence'));
    const cells = ARMS.flatMap((a) => {
      const p = join(evidence, `${ex.key}-${a}.json`);
      return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as { cells: CellRow[] }).cells : [];
    });
    sheet(ex, ARMS, cells, join(evidence, `${ex.key}-tracked`, 'parts')).writePng(must(argv, '--out'));
    return;
  }
  if (argv.includes('--page')) {
    const evidence = resolve(must(argv, '--evidence'));
    const ev = EXAMPLES.map((k) => readEvidence(evidence, k));
    const rigc = ev.flatMap((e) => [...e.arms.keys()].map((a) => (JSON.parse(readFileSync(join(evidence, `${e.key}-${a}.json`), 'utf8')) as { rigc: string }).rigc));
    if (new Set(rigc).size !== 1) throw new Error(`auto_policy_survey: the evidence was run on rig-c ${[...new Set(rigc)].join(', ')}; one version is required`);
    process.stdout.write(`${page(ev, { machine: must(argv, '--machine'), trailer: must(argv, '--trailer-commit'), rigc: rigc[0] }).join('\n')}\n`);
    return;
  }
  throw new Error('auto_policy_survey: one of --run, --tracked, --sheet, --page is required');
}

export { BARS, pinnedInputs };

if (import.meta.main) main(process.argv.slice(2));
