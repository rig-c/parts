#!/usr/bin/env bun
/**
 * The production trial (issue #172 unit 1, #126 item 6): every mesh part of the public examples demo, sample and
 * scarf switched to the automatic mode through the real `build` (`src/build.ts`: assemble, the rig stage's gate
 * build, reference build, motion comparison and acceptance loop, then `check`), under one declared policy
 * ({@link trialPolicy}) written down before any part was run and not changed after.
 *
 *     bun run fetch-examples                                        # once: examples/{reference-demo,reference-sample,scarf}/inputs
 *     bun tools/production_trial.ts --cell <key>/<part> [--set <path>=<json>] > <key>-<part>.json
 *     bun tools/production_trial.ts --example <key> --cells <file.json>… --keep <dir> > <key>.json
 *     bun tools/production_trial.ts --page --examples <key.json>… --cells <file.json>… --picture-dir docs/evidence > docs/evidence/production-trial.md
 *
 * `--cell` runs one part alone: the example's own config with that one mesh entry replaced by `{ auto, r, segments }`,
 * `auto` the policy at the part's tracked spacing (its lattice `grid`, or the contour spacing of a part already in that
 * mode — the one authored number the policy reads, and a spacing, not a count). `--set` changes one named setting
 * over the policy for a retry; the row carries it as a manual setting and it is never folded into the policy. The cell
 * prints one JSON row: the stage that stopped the build, or the written mesh's figures, the step written, the motion
 * reading by phase, whether the skinning residual's target was sent, and the settings the stage echoed — held to the
 * declared policy ({@link policyEcho}) before the row is printed.
 *
 * `--example` runs one example twice through the same `build`: first with every part a cell accepted switched at once
 * (each under the setting its accepted cell ran with), then with the config as tracked. Only after both builds are on
 * disk is the tracked mesh read ({@link TrialLedger}: reading a tracked mesh before the automatic build of its example
 * is refused by name, `TRIAL_TRACKED_BEFORE_BUILD`). Both builds' artifacts are copied under `--keep`
 * (`<key>/{tracked,auto}/`) with a `figures.json` per set.
 *
 * `--page` renders the Markdown page and one picture per example from those JSON files; it runs nothing. The per-example
 * totals are summed by {@link exampleTotals}, never typed.
 *
 * No authored vertex count is read before a build, nowhere is a vertex count a target, and nothing under `src/` is
 * changed: what is measured is the package as a consumer installs it.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { Plate, type RGBA } from '@rig-c/core/tools/plate.ts';
import { DEFAULT_PROJECT_RULE, DEFAULT_SEAM_RULE } from '../src/assemble.ts';
import { build, type BuildResult, RIGC_MODEL_DOCUMENT } from '../src/build.ts';
import { DEFAULT_PAGE_EDGES, findRigc, type RigcRunner } from '../src/check.ts';
import type { AutoSpec } from '../src/config.ts';
import { IDLE_FPS } from '../src/motion.ts';
import { readPng, type Raster } from '../src/raster/index.ts';
import { installedRigc, pinnedInputs, writeSwitchedConfig } from './auto_motion_survey.ts';

const ROOT = resolve(import.meta.dir, '..');

/** The examples and the order the page reads them in. */
export const TRIAL_EXAMPLES = ['reference-demo', 'reference-sample', 'scarf'] as const;

// ---------------------------------------------------------------------------
// 1. the policy, declared before any part was run
// ---------------------------------------------------------------------------

/**
 * The one policy every mesh part is switched to, at the part's tracked spacing `spacing`. It is the spacing survey's
 * tolerance-2 rung with the art-fit overshoot widened with the rung (docs/evidence/auto-spacing-survey.md, the
 * `--ladder --artfit widened` table, tol 2 at the part's own spacing: source tolerance = margin = 2,
 * maxBoundaryDeviation 2, every overshoot bound 2·2 + 1 = 5), with three differences, each stated before the run:
 * `sourceBounds.maxUndercut` is declared absent (null) — the source's undercut is measured and reported, not bounded;
 * the Stage B survey's `all` opt-ins (boundaryRuns 8, Delaunay retriangulation, deformation-load order); and
 * `motion.residual.maxResidual` 1, the motion bound (the Stage B survey's `residual`). Everything else is the strict
 * public policy's (`examplePolicy`, fixtures/automesh.ts): artFit coverage 1 and undercut 0, influences 4 with no
 * floor, 5000 candidates, one art sample, no stray, no region, `protect` absent. The motion bound is 1 rig px on the
 * idle the rig stage compares on (grid frames, and the irr frames held out), the surveys' schedule.
 */
export function trialPolicy(spacing: number): AutoSpec {
  return {
    source: { tolerance: 2, margin: 2, spacing },
    sourceBounds: { minCoverage: 1, maxOvershoot: 5, maxUndercut: null },
    targets: { artFit: { minCoverage: 1, maxOvershoot: 5, maxUndercut: 0 }, maxBoundaryDeviation: 2 },
    influences: { maxInfluences: 4, minWeight: 0 },
    budget: { maxCandidates: 5000 },
    minArtSamples: 1,
    motion: { maxLocalDeformation: 1, residual: { maxResidual: 1 } },
    boundaryRuns: { maxVertices: 8 },
    retriangulate: 'delaunay',
    removalOrder: 'deformation-load',
  };
}

/** The policy's text as the page prints it, from {@link trialPolicy} itself (`<spacing>` standing for the part's). */
export function policyBlock(): string {
  return JSON.stringify(trialPolicy(0), null, 1).replace('"spacing": 0', '"spacing": "<the part\'s tracked spacing>"');
}

/** The part's tracked spacing: its lattice `grid`, or the contour spacing of a part already in that mode, and which. */
export function trackedSpacing(mesh: { grid?: number; contour?: { spacing: number } }, where: string): { spacing: number; from: 'grid' | 'contour' } {
  if (mesh.grid !== undefined) return { spacing: mesh.grid, from: 'grid' };
  if (mesh.contour !== undefined) return { spacing: mesh.contour.spacing, from: 'contour' };
  throw new Error(`production_trial: ${where} has neither grid nor contour.spacing`);
}

/** One named setting over the policy (`--set source.spacing=24`): a path into the spec and its JSON value. Unknown paths are refused by name. */
export function withSetting(spec: AutoSpec, path: string, value: unknown): AutoSpec {
  const out = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
  const keys = path.split('.');
  let at: Record<string, unknown> = out;
  for (const k of keys.slice(0, -1)) {
    const next = at[k];
    if (next === null || typeof next !== 'object') throw new Error(`production_trial: --set ${path}: "${k}" is not an object of the policy`);
    at = next as Record<string, unknown>;
  }
  at[keys[keys.length - 1]] = value;
  return out as unknown as AutoSpec;
}

// ---------------------------------------------------------------------------
// 2. the ledger: no tracked mesh is read before its example's automatic build
// ---------------------------------------------------------------------------

/**
 * Who may read the tracked mesh, and when. The trial's one authored input besides the config's skeleton is the
 * tracked spacing; the tracked mesh's counts are a comparison column, read only after the automatic build of the same
 * example is on disk. `read` before `built` throws, naming the example and the rule.
 */
export class TrialLedger {
  private readonly done = new Set<string>();
  built(key: string): void {
    this.done.add(key);
  }
  read<T>(key: string, what: string, load: () => T): T {
    if (!this.done.has(key)) throw new Error(`TRIAL_TRACKED_BEFORE_BUILD: ${key} — ${what} was asked for before the automatic build of "${key}" ran; the tracked mesh is a comparison column, read only after the build`);
    return load();
  }
}

// ---------------------------------------------------------------------------
// 3. the build, as the CLI runs it
// ---------------------------------------------------------------------------

/** The rigc process exactly as `cli.ts` spawns it, counting the calls. */
export function rigcRunner(bin: string, calls: { n: number }): RigcRunner {
  return (args) => {
    calls.n++;
    const r = spawnSync(bin, [...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.error !== undefined) return { status: 127, out: `could not start ${bin}: ${r.error.message}` };
    return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
}

/** What a builder hands `runCell`: the build's result, its log lines (each `[stage] …`), wall seconds and rigc calls. */
export interface Built {
  result: BuildResult;
  lines: string[];
  wallS: number;
  rigcCalls: number;
}

/** `build` on an example's fetched inputs with the config `config`, into `out`. */
export function runBuild(key: string, config: string, out: string, scratch: string): Built {
  const ex = join(ROOT, 'examples', key, 'inputs');
  const bin = findRigc(ROOT, process.env.PATH ?? '');
  const calls = { n: 0 };
  const lines: string[] = [];
  const t0 = performance.now();
  const result = build(
    { config, source: join(ex, 'painting.png'), full: join(ex, 'layers', 'full'), head: join(ex, 'layers', 'head'), out, seam: DEFAULT_SEAM_RULE, project: DEFAULT_PROJECT_RULE, loop: false, pageEdges: DEFAULT_PAGE_EDGES },
    { rig: rigcRunner(bin, calls), check: rigcRunner(bin, calls), checkBin: bin, scratch },
    (l) => lines.push(l),
  );
  return { result, lines, wallS: Math.round((performance.now() - t0) / 100) / 10, rigcCalls: calls.n };
}

// ---------------------------------------------------------------------------
// 4. what a build wrote
// ---------------------------------------------------------------------------

/** One mesh attachment's figures read off a skeleton JSON: vertices, triangles, bone bindings; and its points in image px. */
export interface MeshFigures {
  vertices: number;
  triangles: number;
  bindings: number;
}

interface SpineMesh {
  type?: string;
  uvs: number[];
  triangles: number[];
  vertices: number[];
  hull?: number;
  width?: number;
  height?: number;
}

/** The mesh attachments of slot `slot` in a skeleton JSON's skins. */
function meshOf(doc: { skins?: Array<{ attachments?: Record<string, Record<string, SpineMesh>> }> }, slot: string): SpineMesh | null {
  for (const skin of doc.skins ?? []) {
    const atts = skin.attachments?.[slot];
    if (atts === undefined) continue;
    for (const a of Object.values(atts)) if (a.type === 'mesh') return a;
  }
  return null;
}

/**
 * The figures of a Spine weighted (or unweighted) mesh: `uvs` has two numbers per vertex; `triangles` three indices
 * per triangle; a weighted `vertices` array is, per vertex, a count n then n × (bone, x, y, weight), and the bindings
 * are the sum of the n. An unweighted mesh (`vertices.length` = 2 × vertex count) binds nothing.
 */
export function figuresOf(m: { uvs: number[]; triangles: number[]; vertices: number[] }): MeshFigures {
  const vertices = m.uvs.length / 2;
  let bindings = 0;
  if (m.vertices.length !== vertices * 2) {
    for (let i = 0, v = 0; v < vertices; v++) {
      const n = m.vertices[i];
      bindings += n;
      i += 1 + n * 4;
    }
  }
  return { vertices, triangles: m.triangles.length / 3, bindings };
}

/** The skeleton JSON a green build packed (`check/build/`), parsed, or null when the build stopped before it. */
function skeletonOf(out: string): Record<string, unknown> | null {
  const dir = join(out, 'check', 'build');
  if (!existsSync(dir)) return null;
  const json = readdirSync(dir).filter((n) => n.endsWith('.json') && n !== RIGC_MODEL_DOCUMENT);
  return json.length === 1 ? (JSON.parse(readFileSync(join(dir, json[0]), 'utf8')) as Record<string, unknown>) : null;
}

/** The mesh_report.json row of `part` the rig stage wrote, or undefined. */
function reportRow(out: string, part: string): Record<string, unknown> | undefined {
  const p = join(out, 'rig', 'mesh_report.json');
  if (!existsSync(p)) return undefined;
  return (JSON.parse(readFileSync(p, 'utf8')) as Array<Record<string, unknown>>).find((r) => r.part === part);
}

// ---------------------------------------------------------------------------
// 5. one part alone
// ---------------------------------------------------------------------------

/** A phase's reading of the local-deformation row: its value and the frame it is worst at. */
export interface PhaseReading {
  value: number | null;
  frame: string | null;
}

/** One part's row, as `--cell` prints it. */
export interface CellRow {
  example: string;
  part: string;
  spacing: number;
  spacingFrom: 'grid' | 'contour';
  /** The one setting changed over the policy for a retry, or null on the policy itself. */
  manual: { path: string; value: unknown } | null;
  /** The auto block the config carried. */
  declared: AutoSpec;
  verdict: 'accepted' | 'refused';
  /** The stage that stopped the build, or null. */
  stoppedAt: string | null;
  /** The refusal's problem lines, each `CODE: object — detail`; empty when accepted. */
  problems: string[];
  /** The figures of the mesh written into the packed skeleton, or null when nothing was written. */
  auto: MeshFigures | null;
  /** The step written: the full result, or the acceptance loop's replayed step. */
  step: { kind: 'full' } | { kind: 'replayed'; chosen: number; of: number } | null;
  motion: { bound: number | null; grid: PhaseReading | null; irr: PhaseReading | null } | null;
  /** The skinning residual's target: declared (always, under the policy), sent or not, its reference bone, why not. */
  residual: { declared: boolean; sent: boolean | null; reference: string | null; stops: string[]; value: number | null } | null;
  /** The settings the stage echoed for the part, held to `declared` (empty when they agree, or when nothing was written). */
  echoDiffers: string[];
  checkPass: boolean | null;
  wallS: number;
  rigcCalls: number;
}

/** The fields of the declared policy the written row must echo, each as `path: declared vs echoed` when they differ. */
export function policyEcho(declared: AutoSpec, row: Record<string, unknown>): string[] {
  const s = (row.settings ?? {}) as Record<string, unknown>;
  const src = (s.source ?? {}) as Record<string, unknown>;
  const differ: string[] = [];
  const same = (path: string, a: unknown, b: unknown): void => {
    if (JSON.stringify(a) !== JSON.stringify(b)) differ.push(`${path}: declared ${JSON.stringify(a)}, echoed ${JSON.stringify(b)}`);
  };
  same('source.tolerance', declared.source.tolerance, src.tolerance);
  same('source.margin', declared.source.margin, src.margin);
  same('source.spacing', declared.source.spacing, src.spacing);
  same('source.stray', declared.source.stray ?? null, src.stray);
  same('sourceBounds', declared.sourceBounds, s.sourceBounds);
  same('targets.artFit', declared.targets.artFit, (s.targets as Record<string, unknown> | undefined)?.artFit);
  same('targets.maxBoundaryDeviation', declared.targets.maxBoundaryDeviation, (s.targets as Record<string, unknown> | undefined)?.maxBoundaryDeviation);
  same('influences', declared.influences, s.influences);
  same('budget', declared.budget, s.budget);
  same('minArtSamples', declared.minArtSamples, s.minArtSamples);
  same('boundaryRuns', declared.boundaryRuns ?? null, s.boundaryRuns ?? null);
  same('retriangulate', declared.retriangulate ?? null, s.retriangulate ?? null);
  same('removalOrder', declared.removalOrder ?? null, s.removalOrder ?? null);
  const def = row.deformation as { bounds?: { maxLocalDeformation?: number } } | string | undefined;
  same('motion.maxLocalDeformation', declared.motion?.maxLocalDeformation, typeof def === 'object' ? def.bounds?.maxLocalDeformation : undefined);
  same('motion.residual.maxResidual', declared.motion?.residual?.maxResidual ?? null, (row.skinning_residual as { max_residual?: number } | undefined)?.max_residual ?? null);
  return differ;
}

/** The local-deformation row's reading per phase, read off the comparison document the stage wrote (`motion_report`). */
function phasesOf(row: Record<string, unknown>): CellRow['motion'] {
  const rep = row.motion_report as { candidates?: Array<{ motion?: { rows?: Array<{ code: string; object: { region: string | null }; bound: { value: number } | null; motion?: { byPhase?: Array<{ phase: string | null; value: number | null; frame?: string | null; worst?: { frame?: { id?: string } } }> } }> } }> } | undefined;
  const r = rep?.candidates?.[0]?.motion?.rows?.find((x) => x.code === 'MQ_LOCAL_DEFORMATION' && x.object.region === null);
  if (r === undefined) return null;
  const of = (phase: string): PhaseReading | null => {
    const p = r.motion?.byPhase?.find((x) => x.phase === phase);
    if (p === undefined) return null;
    const frame = (p as { frame?: string | null }).frame ?? (p as { worst?: { frame?: { id?: string } } }).worst?.frame?.id ?? null;
    return { value: p.value, frame };
  };
  return { bound: r.bound?.value ?? null, grid: of('grid'), irr: of('irr') };
}

/** The config of `key` with `parts` switched to `auto` (each its own spec), the rest as tracked; mesh entries keep r and segments. */
export function switchedConfig(key: string, specs: ReadonlyMap<string, AutoSpec>): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(join(ROOT, 'examples', key, 'config.json'), 'utf8')) as { meshes: Record<string, { r: number; segments: unknown }> };
  for (const [part, auto] of specs) {
    const m = raw.meshes[part];
    if (m === undefined) throw new Error(`production_trial: examples/${key}/config.json has no mesh "${part}"`);
    (raw.meshes as Record<string, unknown>)[part] = { auto, r: m.r, segments: m.segments };
  }
  return raw;
}

/** The tracked mesh entries of `key`, by part, in config order. */
export function trackedMeshes(key: string): Array<[string, { grid?: number; contour?: { spacing: number } }]> {
  const raw = JSON.parse(readFileSync(join(ROOT, 'examples', key, 'config.json'), 'utf8')) as { meshes: Record<string, { grid?: number; contour?: { spacing: number } }> };
  return Object.entries(raw.meshes);
}

/** The spec a part runs under: the policy at its tracked spacing, with the one manual setting when given. */
export function specFor(key: string, part: string, manual: { path: string; value: unknown } | null): { spec: AutoSpec; spacing: number; from: 'grid' | 'contour' } {
  const m = trackedMeshes(key).find(([p]) => p === part)?.[1];
  if (m === undefined) throw new Error(`production_trial: examples/${key}/config.json has no mesh "${part}"`);
  const { spacing, from } = trackedSpacing(m, `examples/${key}/config.json meshes.${part}`);
  const base = trialPolicy(spacing);
  return { spec: manual === null ? base : withSetting(base, manual.path, manual.value), spacing, from };
}

/** Problem lines out of the build's log (`[stage]   FAIL  CODE: …`). */
const failLines = (lines: readonly string[]): string[] => lines.filter((l) => /\]\s+FAIL\s/.test(l)).map((l) => l.replace(/^\[[a-z]+\]\s+FAIL\s+/, ''));

/** How a cell's build runs: {@link runBuild} (`build` itself), or another path that prints the same stage-prefixed lines (tools/production_trial_stray.ts). */
export type CellBuilder = (key: string, config: string, out: string, scratch: string) => Built;

/** One part alone through `build` (or through `builder`, the same config and directories). */
export function runCell(key: string, part: string, manual: { path: string; value: unknown } | null, builder: CellBuilder = runBuild): CellRow {
  const { spec, spacing, from } = specFor(key, part, manual);
  const work = mkdtempSync(join(tmpdir(), 'rig-parts-trial-'));
  try {
    const config = writeSwitchedConfig(key, switchedConfig(key, new Map([[part, spec]])), work);
    const out = join(work, 'out');
    const b = builder(key, config, out, join(work, 'scratch'));
    const row = reportRow(out, part);
    const auto = row !== undefined && row.mode === 'auto' ? row : undefined;
    const green = b.result.stoppedAt === null;
    const skel = green ? skeletonOf(out) : null;
    const mesh = skel === null ? null : meshOf(skel as Parameters<typeof meshOf>[0], part);
    const replay = auto?.replay as { chosen_step?: number; accepted_steps?: number } | undefined;
    const sk = auto?.skinning_residual as { sent: boolean; reference: string; stops: Array<{ bone: string; code: string }>; measured: { value: number | null } | null } | undefined;
    return {
      example: key,
      part,
      spacing,
      spacingFrom: from,
      manual,
      declared: spec,
      verdict: green ? 'accepted' : 'refused',
      stoppedAt: b.result.stoppedAt,
      problems: green ? [] : failLines(b.lines),
      auto: green && mesh !== null ? figuresOf(mesh) : null,
      step: auto === undefined || !green ? null : replay?.chosen_step !== undefined ? { kind: 'replayed', chosen: replay.chosen_step, of: replay.accepted_steps ?? 0 } : { kind: 'full' },
      motion: auto === undefined ? null : phasesOf(auto),
      residual: auto === undefined ? null : { declared: spec.motion?.residual !== undefined, sent: sk?.sent ?? null, reference: sk?.reference ?? null, stops: (sk?.stops ?? []).map((s) => `${s.bone} ${s.code}`), value: sk?.measured?.value ?? null },
      echoDiffers: auto === undefined ? [] : policyEcho(spec, auto),
      checkPass: b.result.check === null ? null : b.result.check.figures.PASS,
      wallS: b.wallS,
      rigcCalls: b.rigcCalls,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 6. one example, all accepted parts at once, then tracked; both kept
// ---------------------------------------------------------------------------

export interface SetFigures {
  /** The build's verdict: null when green, else the stage that stopped it. */
  stoppedAt: string | null;
  problems: string[];
  wallS: number;
  parts: Array<{ part: string; mode: 'auto' | 'tracked'; figures: MeshFigures | null; step: CellRow['step']; manual: CellRow['manual']; fallback: string | null }>;
}

export interface ExampleRow {
  example: string;
  auto: SetFigures;
  tracked: SetFigures;
}

/** The artifacts of a green build (skeleton JSON, model document, atlas, every page) copied into `dest`, with `figures`. */
function keep(out: string, dest: string, figures: SetFigures): void {
  mkdirSync(dest, { recursive: true });
  const dir = join(out, 'check', 'build');
  if (existsSync(dir)) for (const n of readdirSync(dir)) if (n.endsWith('.json') || n.endsWith('.atlas') || n.endsWith('.png')) copyFileSync(join(dir, n), join(dest, n));
  const imgs = join(out, 'rig', 'images');
  if (existsSync(imgs)) {
    mkdirSync(join(dest, 'images'), { recursive: true });
    for (const n of readdirSync(imgs)) copyFileSync(join(imgs, n), join(dest, 'images', n));
  }
  writeFileSync(join(dest, 'figures.json'), `${JSON.stringify(figures, null, 1)}\n`);
}

/** The cells' rows of one example: per part, the accepted row (a manual retry when the policy refused), and why not. */
export function chosenCells(key: string, cells: readonly CellRow[]): Map<string, { accepted: CellRow | null; tried: CellRow[] }> {
  const out = new Map<string, { accepted: CellRow | null; tried: CellRow[] }>();
  for (const [part] of trackedMeshes(key)) {
    const tried = cells.filter((c) => c.example === key && c.part === part).sort((a, b) => (a.manual === null ? 0 : 1) - (b.manual === null ? 0 : 1));
    out.set(part, { accepted: tried.find((c) => c.verdict === 'accepted') ?? null, tried });
  }
  return out;
}

/** One example: the automatic build first (every accepted part at once), then the tracked one; the tracked mesh read last. */
export function runExample(key: string, cells: readonly CellRow[], keepDir: string, ledger: TrialLedger): ExampleRow {
  const chosen = chosenCells(key, cells);
  const specs = new Map<string, AutoSpec>();
  for (const [part, c] of chosen) if (c.accepted !== null) specs.set(part, c.accepted.declared);
  const work = mkdtempSync(join(tmpdir(), 'rig-parts-trial-'));
  try {
    const autoCfg = writeSwitchedConfig(key, switchedConfig(key, specs), join(work, 'auto-config'));
    const ao = join(work, 'auto');
    const ab = runBuild(key, autoCfg, ao, join(work, 'scratch-a'));
    ledger.built(key);
    const askel = ab.result.stoppedAt === null ? skeletonOf(ao) : null;
    const autoSet: SetFigures = {
      stoppedAt: ab.result.stoppedAt,
      problems: ab.result.stoppedAt === null ? [] : failLines(ab.lines),
      wallS: ab.wallS,
      parts: [...chosen].map(([part, c]) => {
        const mesh = askel === null ? null : meshOf(askel as Parameters<typeof meshOf>[0], part);
        const row = c.accepted === null ? undefined : reportRow(ao, part);
        const replay = row?.replay as { chosen_step?: number; accepted_steps?: number } | undefined;
        return {
          part,
          mode: c.accepted === null ? 'tracked' : 'auto',
          figures: mesh === null ? null : figuresOf(mesh),
          step: c.accepted === null || row === undefined ? null : replay?.chosen_step !== undefined ? { kind: 'replayed', chosen: replay.chosen_step, of: replay.accepted_steps ?? 0 } : { kind: 'full' },
          manual: c.accepted?.manual ?? null,
          fallback: c.accepted === null ? `left on its tracked mesh: ${c.tried.map((t) => `${t.manual === null ? 'policy' : `${t.manual.path}=${JSON.stringify(t.manual.value)}`} refused at ${t.stoppedAt} ${t.problems.map((p) => p.split(':')[0]).join(', ')}`).join('; ')}` : null,
        };
      }),
    };
    keep(ao, join(keepDir, key, 'auto'), autoSet);
    const to = join(work, 'tracked');
    const tb = runBuild(key, join(ROOT, 'examples', key, 'config.json'), to, join(work, 'scratch-t'));
    const tskel = ledger.read(key, 'the tracked build\'s skeleton', () => (tb.result.stoppedAt === null ? skeletonOf(to) : null));
    const trackedSet: SetFigures = {
      stoppedAt: tb.result.stoppedAt,
      problems: tb.result.stoppedAt === null ? [] : failLines(tb.lines),
      wallS: tb.wallS,
      parts: trackedMeshes(key).map(([part]) => {
        const mesh = tskel === null ? null : meshOf(tskel as Parameters<typeof meshOf>[0], part);
        return { part, mode: 'tracked', figures: mesh === null ? null : figuresOf(mesh), step: null, manual: null, fallback: null };
      }),
    };
    keep(to, join(keepDir, key, 'tracked'), trackedSet);
    return { example: key, auto: autoSet, tracked: trackedSet };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 7. totals, the page and the pictures
// ---------------------------------------------------------------------------

/** Per example, the vertices summed over every mesh part: tracked, and as the automatic build wrote them (a part left on its tracked mesh counts its tracked vertices). Null when a set wrote no figure for some part. */
export function exampleTotals(ex: ExampleRow): { tracked: number | null; automatic: number | null; switched: number; parts: number } {
  const sum = (s: SetFigures): number | null => (s.parts.some((p) => p.figures === null) ? null : s.parts.reduce((n, p) => n + (p.figures as MeshFigures).vertices, 0));
  return { tracked: sum(ex.tracked), automatic: sum(ex.auto), switched: ex.auto.parts.filter((p) => p.mode === 'auto').length, parts: ex.auto.parts.length };
}

const INK: RGBA = [20, 20, 20, 255];
const WIRE: RGBA = [40, 90, 200, 255];
const GREY: RGBA = [150, 150, 150, 255];
const RED: RGBA = [200, 40, 40, 255];
const PAPER: RGBA = [255, 255, 255, 255];

interface Wire {
  points: Array<[number, number]>;
  triangles: number[];
}

/** A mesh's wires in its image's px (uvs × the image size). */
function wireOf(m: SpineMesh, img: Raster): Wire {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < m.uvs.length; i += 2) points.push([m.uvs[i] * img.width, m.uvs[i + 1] * img.height]);
  return { points, triangles: m.triangles };
}

function drawWire(plate: Plate, ox: number, oy: number, w: Wire, colour: RGBA): void {
  for (let t = 0; t + 2 < w.triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = w.points[w.triangles[t + k]];
      const b = w.points[w.triangles[t + ((k + 1) % 3)]];
      plate.line(ox + a[0], oy + a[1], ox + b[0], oy + b[1], 1, colour);
    }
  }
}

function drawArt(plate: Plate, ox: number, oy: number, art: Raster): void {
  const { width: w, height: h, data } = art;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 1) continue;
      plate.set(ox + x, oy + y, [Math.round((data[i] + 255) / 2), Math.round((data[i + 1] + 255) / 2), Math.round((data[i + 2] + 255) / 2), 255]);
    }
  }
}

const figText = (f: MeshFigures | null): string => (f === null ? 'NOT WRITTEN' : `${f.vertices} V ${f.triangles} T ${f.bindings} B`);
const stepText = (s: CellRow['step']): string => (s === null ? '-' : s.kind === 'full' ? 'FULL' : `STEP ${s.chosen} OF ${s.of}`);

/**
 * The frame index of a grid frame id `idle@grid@<t>` — `t` the frame's time in seconds, `t · IDLE_FPS` a whole number
 * on the grid to within the 1e-3 the id's six printed decimals leave (3.916667 s is frame 47) — or null for any other
 * id (an irr frame lies between grid frames, where the render never draws).
 */
export function gridFrame(id: string | null, fps: number = IDLE_FPS): number | null {
  const m = id === null ? null : /^[^@]+@grid@([0-9.]+)$/.exec(id);
  if (m === null) return null;
  const f = Number(m[1]) * fps;
  return Math.abs(f - Math.round(f)) < 1e-3 ? Math.round(f) : null;
}

/**
 * The picture of one example: per mesh part a row — the tracked mesh and the automatic one, wires over the part's
 * padded image as each build packed it, counts under each — then the idle's worst grid frame for the example's three
 * parts with the largest motion reading, posed through rig-c's `@rig-c/core/render` (`spinePoser`, spine-core) from the kept
 * builds: the tracked mesh in grey and the automatic one in blue at that frame, the frame's reading under it.
 */
export async function examplePicture(ex: ExampleRow, cells: readonly CellRow[], keepDir: string): Promise<Plate> {
  const gap = 14;
  const capH = 3 * 10 + 6;
  const posedCapH = 4 * 10 + 6;
  const textW = (lines: readonly string[]): number => Math.max(...lines.map((l) => l.length * 6));
  const tDir = join(keepDir, ex.example, 'tracked');
  const aDir = join(keepDir, ex.example, 'auto');
  const tSkel = JSON.parse(readFileSync(join(tDir, jsonIn(tDir)), 'utf8')) as Parameters<typeof meshOf>[0];
  const aSkel = JSON.parse(readFileSync(join(aDir, jsonIn(aDir)), 'utf8')) as Parameters<typeof meshOf>[0];
  const chosen = chosenCells(ex.example, cells);
  const rows = ex.auto.parts.map((p) => {
    const tImg = readPng(join(tDir, 'images', `${p.part}.png`));
    const aImg = readPng(join(aDir, 'images', `${p.part}.png`));
    const tm = meshOf(tSkel, p.part);
    const am = meshOf(aSkel, p.part);
    const t = ex.tracked.parts.find((x) => x.part === p.part);
    const tf = t?.figures ?? null;
    const caption = [`TRACKED ${figText(tf)}`, p.mode === 'auto' ? `AUTO ${figText(p.figures)}` : 'AUTO: LEFT ON TRACKED MESH', p.mode === 'auto' ? `${stepText(p.step)}${p.manual === null ? '' : ` MANUAL ${p.manual.path}=${JSON.stringify(p.manual.value)}`.toUpperCase()}` : ''];
    return { p, tImg, aImg, tw: tm === null ? null : wireOf(tm, tImg), aw: am === null ? null : wireOf(am, aImg), tf, caption };
  });
  // The three parts with the largest motion reading (max of grid and irr), automatic parts only.
  const motionOf = (c: CellRow | null): number => Math.max(c?.motion?.grid?.value ?? -1, c?.motion?.irr?.value ?? -1);
  const top = [...chosen].filter(([, c]) => c.accepted !== null).sort((a, b) => motionOf(b[1].accepted) - motionOf(a[1].accepted) || (a[0] < b[0] ? -1 : 1)).slice(0, 3);
  const posed = await worstFrames(ex.example, top.map(([part, c]) => ({ part, cell: c.accepted as CellRow })), tDir, aDir);
  const W = Math.max(...rows.map((r) => Math.max(r.tImg.width + r.aImg.width + 3 * gap, textW(r.caption) + 2 * gap)), posed.reduce((n, f) => n + f.w + gap, gap), 520);
  const H = rows.reduce((n, r) => n + 12 + Math.max(r.tImg.height, r.aImg.height) + capH + gap, gap + 14) + (posed.length === 0 ? 0 : 12 + Math.max(...posed.map((f) => f.h)) + posedCapH + gap);
  const plate = new Plate(Math.ceil(W), Math.ceil(H));
  plate.rect(0, 0, plate.width, plate.height, PAPER);
  plate.text(`${ex.example.toUpperCase()}: TRACKED (LEFT) AND AUTOMATIC (RIGHT) - V VERTICES, T TRIANGLES, B BINDINGS`, gap, gap, 1, INK);
  let oy = gap + 14;
  for (const r of rows) {
    plate.text(r.p.part.toUpperCase(), gap, oy, 1, INK);
    oy += 12;
    drawArt(plate, gap, oy, r.tImg);
    if (r.tw !== null) drawWire(plate, gap, oy, r.tw, GREY);
    const ax = gap + r.tImg.width + gap;
    drawArt(plate, ax, oy, r.aImg);
    if (r.aw !== null) drawWire(plate, ax, oy, r.aw, r.p.mode === 'auto' ? WIRE : GREY);
    const h = Math.max(r.tImg.height, r.aImg.height);
    r.caption.forEach((line, i) => plate.text(line, gap, oy + h + 6 + i * 10, 1, i === 1 && r.p.mode !== 'auto' ? RED : INK));
    oy += h + capH + gap;
  }
  if (posed.length > 0) {
    plate.text(`IDLE WORST GRID FRAME, THE THREE LARGEST MOTION READINGS: TRACKED GREY, AUTOMATIC BLUE`, gap, oy, 1, INK);
    oy += 12;
    let ox = gap;
    for (const f of posed) {
      drawWire(plate, ox - f.x0, oy - f.y0, f.tracked, GREY);
      drawWire(plate, ox - f.x0, oy - f.y0, f.auto, WIRE);
      f.caption.forEach((line, i) => plate.text(line, ox, oy + f.h + 6 + i * 10, 1, INK));
      ox += f.w + gap;
    }
  }
  return plate;
}

function jsonIn(dir: string): string {
  const json = readdirSync(dir).filter((n) => n.endsWith('.json') && n !== RIGC_MODEL_DOCUMENT && n !== 'figures.json');
  if (json.length !== 1) throw new Error(`production_trial: ${dir} holds ${json.length} skeleton JSON file(s)`);
  return json[0];
}

/** Both kept builds posed at each part's worst grid frame through rig-c's spine-core poser; the part's world vertices, y down. */
async function worstFrames(key: string, parts: ReadonlyArray<{ part: string; cell: CellRow }>, tDir: string, aDir: string): Promise<Array<{ tracked: Wire; auto: Wire; x0: number; y0: number; w: number; h: number; caption: string[] }>> {
  if (parts.length === 0) return [];
  const { loadPosedSkeleton, spinePoser } = await import('@rig-c/core/render');
  const atlas = (dir: string): string => join(dir, readdirSync(dir).find((n) => n.endsWith('.atlas')) as string);
  const poseAt = (dir: string, frame: number): Map<string, number[]> => {
    const poser = spinePoser(loadPosedSkeleton(join(dir, jsonIn(dir)), atlas(dir), `production_trial poses ${key}`));
    const got = new Map<string, number[]>();
    poser.animation('idle', undefined, IDLE_FPS, frame, (i, posed) => {
      if (i === frame) for (const a of posed.attachments()) got.set(a.slot, [...a.vertices]);
    });
    return got;
  };
  const tSkel = JSON.parse(readFileSync(join(tDir, jsonIn(tDir)), 'utf8')) as Parameters<typeof meshOf>[0];
  const aSkel = JSON.parse(readFileSync(join(aDir, jsonIn(aDir)), 'utf8')) as Parameters<typeof meshOf>[0];
  const out: Array<{ tracked: Wire; auto: Wire; x0: number; y0: number; w: number; h: number; caption: string[] }> = [];
  for (const { part, cell } of parts) {
    const frame = gridFrame(cell.motion?.grid?.frame ?? null);
    if (frame === null) throw new Error(`production_trial: ${key}/${part} — the worst grid frame id ${JSON.stringify(cell.motion?.grid?.frame ?? null)} names no frame of the idle grid`);
    const tv = poseAt(tDir, frame).get(part);
    const av = poseAt(aDir, frame).get(part);
    const tm = meshOf(tSkel, part);
    const am = meshOf(aSkel, part);
    if (tv === undefined || av === undefined || tm === null || am === null) throw new Error(`production_trial: ${key}/${part} — not drawn at idle frame ${frame} in both kept builds, or no mesh attachment in both skeletons`);
    const pts = (v: number[]): Array<[number, number]> => {
      const p: Array<[number, number]> = [];
      for (let i = 0; i < v.length; i += 2) p.push([v[i], -v[i + 1]]);
      return p;
    };
    const tracked = { points: pts(tv), triangles: tm.triangles };
    const auto = { points: pts(av), triangles: am.triangles };
    const all = [...tracked.points, ...auto.points];
    const x0 = Math.floor(Math.min(...all.map((p) => p[0])));
    const y0 = Math.floor(Math.min(...all.map((p) => p[1])));
    const w = Math.ceil(Math.max(...all.map((p) => p[0]))) - x0 + 1;
    const h = Math.ceil(Math.max(...all.map((p) => p[1]))) - y0 + 1;
    const g = cell.motion?.grid;
    const ir = cell.motion?.irr;
    const caption = [`${part.toUpperCase()} GRID FRAME ${frame}`, `GRID ${g?.value ?? '-'} PX`, `HELD OUT ${ir?.value ?? '-'} PX`, `BOUND ${cell.motion?.bound ?? '-'} PX VS OWN SOURCE`];
    out.push({ tracked, auto, x0, y0, w: Math.max(w, ...caption.map((l) => l.length * 6)), h, caption });
  }
  return out;
}

/** The page, from the cells and the examples, with the picture paths it links. */
export function page(cells: readonly CellRow[], examples: readonly ExampleRow[], pictures: readonly string[], machine: string): string[] {
  const L: string[] = [];
  const num = (x: number | null | undefined): string => (x === null || x === undefined ? '—' : String(x));
  const fig = (f: MeshFigures | null | undefined): string => (f === null || f === undefined ? '—' : `${f.vertices} / ${f.triangles} / ${f.bindings}`);
  L.push('# The production trial: every public mesh part switched to the automatic mode (issue #172, #126 item 6)');
  L.push('');
  L.push(`Generated by \`bun tools/production_trial.ts\`; every figure below is the tool's, none typed. The installed rig-c ${installedRigc()}. The public examples demo, sample and scarf at commit ${pinnedInputs()} (\`bun run fetch-examples\`), each with its tracked \`examples/<key>/config.json\`. Every mesh part of the three configs, each switched alone to \`auto\` in its example's own config and run through the real \`build\` (\`src/build.ts\`: assemble, the rig stage — gate build, reference build, rig-c's \`compareMeshesInMotion\` on the idle, the acceptance loop — and \`check\`); then each example with every part a cell accepted switched at once, which is what a consumer builds, beside the example as tracked. Cells ran on: ${machine}.`);
  L.push('');
  L.push('## The policy, declared before the run');
  L.push('');
  L.push('Every part runs under `trialPolicy(spacing)` (the tool), `spacing` the part\'s tracked spacing — its lattice `grid`, or the contour spacing of a part already in that mode. No authored vertex count is read anywhere: the tool reads a tracked mesh only after the automatic build of its example is on disk (`TrialLedger`; selftest `PD01`), for the comparison columns.');
  L.push('');
  L.push('```json');
  for (const l of policyBlock().split('\n')) L.push(l);
  L.push('```');
  L.push('');
  L.push('It is the tolerance-2 rung of the spacing survey\'s widened ladder (docs/evidence/auto-spacing-survey.md, `--ladder --artfit widened`, tol 2 at each part\'s own spacing: tolerance = margin = 2, maxBoundaryDeviation 2, every overshoot bound 5), with the Stage B survey\'s `all` opt-ins and `motion.residual.maxResidual` 1 (docs/evidence/auto-stageb-survey.md, `allResidual`), and `sourceBounds.maxUndercut` declared absent (null; the ladder bounds it at 0). Everything else is the strict public policy\'s. No region, no multi-interval selection, `protect` absent, replay on (the rig stage\'s acceptance loop, which has no switch). The motion bound is 1 rig px on the idle the rig stage compares on: the grid frames, and the irr frames held out. Every written row\'s echoed settings are held to the declared block before it is printed (`policyEcho`; selftest `PD02`).');
  L.push('');
  L.push('A part the policy refuses is retried at most once with one named setting changed; that retry is a manual setting, listed below, and is never part of the policy.');
  L.push('');
  L.push('## Each part alone');
  L.push('');
  L.push('V / T / B = vertices / triangles / bone bindings (the `{bone, weight}` entries over all vertices), read off the packed skeleton JSON of each build; "tracked" is the example\'s tracked build. Motion = the local-deformation row (MQ_LOCAL_DEFORMATION, rig px, against the part\'s own unreduced source) by phase: grid (the frames the render draws; the acceptance loop selects on them) and irr (held out), each with its worst frame. Residual = whether `targets.skinning` was sent, its reference bone, and the written mesh\'s MQ_SKINNING_RESIDUAL.');
  L.push('');
  L.push('| part | spacing | setting | verdict | tracked V / T / B | automatic V / T / B | step written | motion grid | motion irr (held out) | residual target | check | wall s |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const order = (c: CellRow): number => TRIAL_EXAMPLES.indexOf(c.example as (typeof TRIAL_EXAMPLES)[number]) * 1000 + trackedMeshes(c.example).findIndex(([p]) => p === c.part) * 2 + (c.manual === null ? 0 : 1);
  for (const c of [...cells].sort((a, b) => order(a) - order(b))) {
    const t = examples.find((e) => e.example === c.example)?.tracked.parts.find((p) => p.part === c.part)?.figures;
    const verdict = c.verdict === 'accepted' ? 'accepted' : `refused at ${c.stoppedAt}: ${[...new Set(c.problems.map((p) => p.split(':')[0]))].join(', ')}`;
    const ph = (r: PhaseReading | null | undefined): string => (r === null || r === undefined ? '—' : `${num(r.value)} @ ${r.frame ?? '—'}`);
    const res = c.residual === null ? '—' : c.residual.sent === null ? 'no row' : c.residual.sent ? `sent, ref ${c.residual.reference}, ${num(c.residual.value)}` : `not sent (ref ${c.residual.reference}): ${c.residual.stops.join(', ')}`;
    L.push(`| ${c.example}/${c.part} | ${c.spacing} (${c.spacingFrom}) | ${c.manual === null ? 'policy' : `manual: ${c.manual.path} = ${JSON.stringify(c.manual.value)}`} | ${verdict} | ${fig(t)} | ${fig(c.auto)} | ${c.step === null ? '—' : c.step.kind === 'full' ? 'full' : `replayed, step ${c.step.chosen} of ${c.step.of}`} | ${ph(c.motion?.grid)} | ${ph(c.motion?.irr)} | ${res} | ${c.checkPass === null ? '—' : c.checkPass ? 'PASS' : 'FAIL'} | ${c.wallS} |`);
  }
  L.push('');
  const accepted = cells.filter((c) => c.verdict === 'accepted');
  const declaring = cells.filter((c) => c.residual !== null && c.residual.declared);
  const sent = declaring.filter((c) => c.residual?.sent === true);
  L.push(`Accepted: ${accepted.length} of ${cells.length} cells (${accepted.filter((c) => c.manual === null).length} under the policy, ${accepted.filter((c) => c.manual !== null).length} under a manual setting). The skinning residual's target: ${declaring.length} written row(s) declare \`motion.residual\`; ${sent.length} had the target sent${declaring.length === sent.length ? ' — every one' : `; not sent: ${declaring.filter((c) => c.residual?.sent !== true).map((c) => `${c.example}/${c.part}`).join(', ')}`}. A refused cell writes no row, so its target is not read.`);
  L.push('');
  L.push('### Refusals, verbatim');
  L.push('');
  for (const c of cells.filter((x) => x.verdict === 'refused')) {
    L.push(`- ${c.example}/${c.part} (${c.manual === null ? 'policy' : `manual ${c.manual.path} = ${JSON.stringify(c.manual.value)}`}):`);
    for (const p of c.problems) L.push(`  - \`${p.replace(/`/g, "'")}\``);
  }
  L.push('');
  L.push('## Each example, every accepted part at once');
  L.push('');
  L.push('| example | parts switched | automatic build | tracked build | vertices tracked | vertices automatic | change |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const ex of examples) {
    const t = exampleTotals(ex);
    const ch = t.tracked === null || t.automatic === null ? '—' : `${t.automatic - t.tracked >= 0 ? '+' : ''}${t.automatic - t.tracked} (${(((t.automatic - t.tracked) / t.tracked) * 100).toFixed(1)} %)`;
    L.push(`| ${ex.example} | ${t.switched} of ${t.parts} | ${ex.auto.stoppedAt === null ? 'green' : `stopped at ${ex.auto.stoppedAt}`}, ${ex.auto.wallS} s | ${ex.tracked.stoppedAt === null ? 'green' : `stopped at ${ex.tracked.stoppedAt}`}, ${ex.tracked.wallS} s | ${num(t.tracked)} | ${num(t.automatic)} | ${ch} |`);
  }
  L.push('');
  L.push('Totals are summed by the tool over every mesh part (selftest `PD03`); a part left on its tracked mesh counts its tracked vertices in the automatic column.');
  L.push('');
  for (const ex of examples) {
    const left = ex.auto.parts.filter((p) => p.fallback !== null);
    if (left.length > 0) {
      L.push(`Left on the tracked mesh in ${ex.example}:`);
      for (const p of left) L.push(`- ${p.part} — ${p.fallback}`);
      L.push('');
    }
    if (ex.auto.problems.length > 0) {
      L.push(`The automatic build of ${ex.example} stopped:`);
      for (const p of ex.auto.problems) L.push(`- \`${p}\``);
      L.push('');
    }
  }
  L.push('## The pictures');
  L.push('');
  for (const p of pictures) L.push(`- [${basename(p)}](${basename(p)})`);
  L.push('');
  L.push('Each: per mesh part, the tracked mesh (grey wires) beside the automatic one (blue; grey when the part was left on its tracked mesh), over the part\'s padded image as each build packed it, counts under each; then, for the example\'s three automatic parts with the largest motion reading, both builds posed through rig-c\'s `@rig-c/core/render` (`spinePoser`, spine-core) at the part\'s worst grid frame of the idle (tracked grey, automatic blue). The motion reading is the automatic mesh against its own unreduced source, not against the tracked mesh.');
  L.push('');
  L.push('## Re-running this evidence');
  L.push('');
  L.push(`Inputs: the public examples demo, sample and scarf of https://github.com/firejune/spine-parts-examples at commit ${pinnedInputs()} (the pin in \`scripts/fetch-examples.sh\`), each with its tracked \`examples/<key>/config.json\`; rig-c ${installedRigc()} as \`bun install --frozen-lockfile\` installs it from \`bun.lock\`. One cell per part (and per manual retry), each a process of its own, stopped at 600 s; then one process per example; then the page. Builds run in temporary directories, removed afterwards, except what \`--keep\` names.`);
  L.push('');
  L.push('```sh');
  L.push('bun install --frozen-lockfile');
  L.push('bun run fetch-examples');
  L.push('# each mesh part <key>/<part> of the three configs, and each manual retry the tables name (--set <path>=<json>):');
  L.push('bun tools/production_trial.ts --cell <key>/<part> > <key>-<part>.json');
  L.push('bun tools/production_trial.ts --example <key> --cells <every cell json> --keep <dir> > <key>.json');
  L.push('bun tools/production_trial.ts --page --examples demo.json sample.json scarf.json --cells <every cell json> --keep <dir> --picture-dir docs/evidence --machine "<where the cells ran>" > docs/evidence/production-trial.md');
  L.push('```');
  return L;
}

// ---------------------------------------------------------------------------
// 8. the command line
// ---------------------------------------------------------------------------

function listAfter(argv: readonly string[], flag: string): string[] {
  const i = argv.indexOf(flag);
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) out.push(argv[j]);
  return out;
}

const readCells = (files: readonly string[]): CellRow[] => files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as CellRow);

async function main(argv: string[]): Promise<number> {
  const get = (f: string): string | undefined => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  const cell = get('--cell');
  if (cell !== undefined) {
    const [key, part] = cell.split('/');
    const set = get('--set');
    const manual = set === undefined ? null : { path: set.slice(0, set.indexOf('=')), value: JSON.parse(set.slice(set.indexOf('=') + 1)) as unknown };
    const row = runCell(key, part, manual);
    if (row.echoDiffers.length > 0) {
      console.error(`production_trial: ${cell} — the written row does not echo the declared policy: ${row.echoDiffers.join('; ')}`);
      return 1;
    }
    console.error(`production_trial: ${cell}${manual === null ? '' : ` (${set})`}: ${row.verdict}${row.stoppedAt === null ? '' : ` at ${row.stoppedAt}`}, ${row.wallS} s, ${row.rigcCalls} rigc call(s)`);
    console.log(JSON.stringify(row));
    return 0;
  }
  const example = get('--example');
  if (example !== undefined) {
    const keepDir = get('--keep');
    if (keepDir === undefined) throw new Error('production_trial: --example needs --keep <dir>');
    const row = runExample(example, readCells(listAfter(argv, '--cells')), resolve(keepDir), new TrialLedger());
    console.log(JSON.stringify(row));
    return 0;
  }
  if (argv.includes('--page')) {
    const keepDir = resolve(get('--keep') ?? '');
    const dir = get('--picture-dir');
    const cells = readCells(listAfter(argv, '--cells'));
    const examples = listAfter(argv, '--examples').map((f) => JSON.parse(readFileSync(f, 'utf8')) as ExampleRow);
    const pictures: string[] = [];
    for (const ex of examples) {
      if (dir === undefined || ex.auto.stoppedAt !== null || ex.tracked.stoppedAt !== null) continue;
      const path = join(dir, `production-trial-${ex.example}.png`);
      (await examplePicture(ex, cells, keepDir)).writePng(path);
      pictures.push(path);
    }
    for (const l of page(cells, examples, pictures, get('--machine') ?? 'local')) console.log(l);
    return 0;
  }
  console.error('usage: bun tools/production_trial.ts --cell <key>/<part> [--set <path>=<json>] | --example <key> --cells <file>… --keep <dir> | --page --examples <file>… --cells <file>… --keep <dir> [--picture-dir <dir>] [--machine <label>]');
  return 2;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
