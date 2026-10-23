#!/usr/bin/env bun
/**
 * The evaluation matrix of the automatic mesh mode (issue #126, items 4-5),
 * written to `docs/evidence/auto-mesh-matrix.md` by one command so it can be
 * regenerated when rig-c moves:
 *
 *     bun tools/auto_matrix.ts --work <dir> [--out <file.md>] [--examples <key>,...]
 *                              [--no-builds] [--no-timing] [--quiet-wait <s>]
 *
 * Every figure in the document is written by this tool; none is typed. What it
 * measures, in order:
 *
 * 1. **Timing** (the owner's condition 4), before anything else loads the
 *    machine: the inputs of the #131 timing rows — demo `bottomwear`, sample
 *    `sleeves` and `bottomwear`, scarf `handwear_l` under the strict policy,
 *    weighted exactly as the rig stage weights them, and the synthetic strip
 *    with its region — each timed by a wrapper around rig-c's exported
 *    `measureMeshQuality` (the source measured once, three times) and around
 *    `reduceMesh` (twice), with `uptime` read before and after each. A figure
 *    is labelled quiet only when both one-minute load averages are under 2
 *    ({@link quietLabel}). Nothing inside rig-c is instrumented, so the
 *    granularity is those two calls.
 * 2. **Synthetic rows**: the cases of `fixtures/automesh.ts` under the
 *    synthetic policy and its permissive twin, geometry only (unweighted).
 * 3. **Example rows**: every mesh part of every fetched public example, under
 *    the strict policy (`examplePolicy`, #131's, unchanged) and the permissive
 *    one (`permissivePolicy`), each part switched alone. Per row the three
 *    counts — (a) the tracked mesh, (b) the automatic mode's unreduced source,
 *    (c) the result — the residuals rig-c reports at alpha 1 and above,
 *    the loss figure ({@link lossAgainstOriginal}: art pixels at alpha 1 and
 *    above the mesh leaves uncovered, read against the ORIGINAL padded image,
 *    specks included), the termination, the verdict ({@link classify}), and for
 *    an accepted part the full `rig` + `check` with the part switched alone; then
 *    one more build per example and policy with every accepted part switched.
 *    The rig stage's own `mesh_report.json` row is held to this tool's direct
 *    call (counts and candidates tried), so both read the same inputs.
 * 4. **The region condition**: the skirt parts (`bottomwear`) with the
 *    declared region of `matrixRegion` (fixtures/automesh.ts) on the circle
 *    `tools/real_compare.ts`'s `testRegion` rule places, under both policies.
 * 5. **#115 on `sample/sleeves`**: the alpha threshold separated from the
 *    weighting rule — the unreduced auto source at alpha 1 and above, with and
 *    without the 0.03 floor, at tolerance 1 and 0.5, beside the contour mode
 *    at alpha above 8 (whose weights carry the 0.03 floor), each switched alone
 *    and read off `check`'s `TEXTURE_STRETCH` row for the part.
 *
 * `--work` holds the builds (`base-<key>`, the tracked build each variant
 * reads its parts from) and every variant's config, so a row can be re-run by
 * hand. `--no-builds` and `--no-timing` leave those sections out and say so in
 * the document. `--cell <part>:<strict|permissive>` runs that one row of each
 * named example and nothing else (no synthetic rows, no region condition, no
 * switched-at-once build, no #115 variants), and the document says so.
 * Timing is the one clock this repository's tools read, and is not a claim
 * about another machine.
 *
 * **What the run costs** (issue #135): the stages run in this process —
 * `build` for a tracked example, then `rigStage` and `checkStage` for every
 * variant — through one counting rigc runner, so the document's header states
 * the run's wall time, every rigc call by kind, and every `reduceMesh` call by
 * who made it. A variant's rig stage is handed `reuseReductions` over the
 * reductions this tool's geometry rows already ran, keyed by the whole input
 * (`reductionKey`): an accepted part's reduction runs once, in its geometry
 * row, and the stage reuses it; an input no row ran (a #115 variant with
 * budget 0) is run by the stage and counted as the stage's.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  type AlphaMask,
  measureAuthoredMeshFit,
  measureMeshQuality,
  type MeasureRow,
  type MeshCounts,
  type MeshMeasureInput,
  type MeshQualityReport,
  type MeshReductionInput,
  type ReducedMesh,
  reduceMesh,
} from 'rig-c/mesh';
import { pinnedExamplesCommit } from '../scripts/example_inputs.ts';
import { DEFAULT_PROJECT_RULE, DEFAULT_SEAM_RULE } from '../src/assemble.ts';
import { type AmplitudeBasis, partAmplitude, withAmplitude } from '../src/autoamplitude.ts';
import type { MotionSpec } from '../src/motion.ts';
import { AUTO_THRESHOLD, autoReductionInput, autoSource, autoVerdict, type Reducer, reductionKey, type ReductionResult, reuseReductions, runReduction, sourceWeights, terminationText } from '../src/automesh.ts';
import { build, checkStage, rigStage } from '../src/build.ts';
import { DEFAULT_PAGE_EDGES, findRigc, type RigcRunner } from '../src/check.ts';
import { type AutoSpec, type CharacterConfig, parseConfig, weightsABone } from '../src/config.ts';
import { PartsError, type Problem, problemLine } from '../src/errors.ts';
import { readParts } from '../src/parts.ts';
import { pad, readPng, type Raster } from '../src/raster/index.ts';
import { type AutoMeshReport, buildRig, type MeshReport, PAD } from '../src/rig.ts';
import { pyRound } from '../src/round.ts';
import type { Segment } from '../src/weights.ts';
import {
  AUTO_CASES,
  examplePolicy,
  MATRIX_REGION_BONE,
  matrixRegion,
  PERMISSIVE_MIN_COVERAGE,
  permissivePolicy,
  permissiveSyntheticPolicy,
  SPECK_RULE_PX,
  speckMask,
  syntheticPolicy,
  TWO_PIECES_MASK,
} from '../fixtures/automesh.ts';
import { policyMotion, withPolicyMotion } from '../fixtures/automotion.ts';
import { writeSwitchedConfig } from './auto_motion_survey.ts';
import { placedMask, resolveSegments, testRegion } from './real_compare.ts';

const ROOT = resolve(import.meta.dir, '..');

/** The markers `--timing-only` prints its section between, which `--timing-from` reads back. */
const TIMING_OPEN = '<<<AUTO_MATRIX_TIMING';
const TIMING_CLOSE = 'AUTO_MATRIX_TIMING>>>';
/** The markers `--print-doc` prints the document between, for a run on a machine whose files do not come back. */
const DOC_OPEN = '<<<AUTO_MATRIX_DOC';
const DOC_CLOSE = 'AUTO_MATRIX_DOC>>>';

// ---------------------------------------------------------------------------
// the definitions (held by the auto-mesh suite, AM30-AM39)
// ---------------------------------------------------------------------------

/** The row label of a refinement the installed rig-c stops by name (P16): a limit of that version, not a refusal on the part's merits. */
export const BLOCKED_LABEL = "stopped by rig-c's refinement (P16)";

export type Verdict = { kind: 'accepted' } | { kind: 'refused'; code: string; detail: string } | { kind: 'blocked'; detail: string } | { kind: 'stopped'; detail: string };

/**
 * The code of a cell this tool stopped at its cap (`--cell-cap`): no result,
 * and not a refusal on the part's merits. Every single reduction or build of a
 * run is held to the cap; a cell past it is recorded and the run moves on.
 */
export const STOPPED_CODE = 'AUTO_MATRIX_CELL_STOPPED';

/**
 * The verdict of one row from the part's problem (null when accepted):
 * `blocked` exactly when the problem is `AUTO_MESH_ACCEPTED` and its detail
 * carries rig-c's named refinement stop — an edge's end "beyond region …
 * band" and "P16". rig-c 2.19.1 implemented option 1 (an edge leaving the
 * band at a single point is exempt), which lifted the stop on the cases 2.19.0
 * refused; the stop that remains in 2.20.1 carries the same words and is
 * classed the same. Every other problem is `refused` by its code. The
 * transition-0 stop ("found no point of edge …") is not P16's band case and
 * stays `refused`.
 */
export function classify(problem: Problem | null): Verdict {
  if (problem === null) return { kind: 'accepted' };
  if (problem.code === STOPPED_CODE) return { kind: 'stopped', detail: problem.detail };
  if (problem.code === 'AUTO_MESH_ACCEPTED' && problem.detail.includes('P16') && problem.detail.includes('beyond region')) return { kind: 'blocked', detail: problem.detail };
  return { kind: 'refused', code: problem.code, detail: problem.detail };
}

export function verdictText(v: Verdict): string {
  if (v.kind === 'accepted') return 'accepted';
  if (v.kind === 'blocked') return BLOCKED_LABEL;
  if (v.kind === 'stopped') return v.detail;
  return `refused ${v.code}`;
}

/** One of the three counts: boundary / interior vertices, triangles, bindings, mean influences per vertex. */
export interface Counts {
  boundary: number;
  interior: number;
  triangles: number;
  bindings: number;
  meanInfluences: number;
}

export function countsOf(c: MeshCounts): Counts {
  const v = c.boundaryVertices + c.interiorVertices;
  return { boundary: c.boundaryVertices, interior: c.interiorVertices, triangles: c.triangles, bindings: c.bindings, meanInfluences: v === 0 ? 0 : pyRound(c.bindings / v, 2) };
}

export function countsCell(c: Counts | null): string {
  return c === null ? '—' : `${c.boundary}+${c.interior} / ${c.triangles} / ${c.bindings}`;
}

/**
 * What one run of the tool cost (issue #135 item 3), counted as it happens:
 * every rigc call by kind (`build`, `render`, anything else) through
 * {@link countingRunner}, and every `reduceMesh` call by who made it — a
 * geometry row ({@link geometryRow}), the timing section, or a rig stage on
 * an input no geometry row ran — beside the reductions a rig stage reused.
 */
export interface RunCost {
  rigcBuilds: number;
  rigcRenders: number;
  rigcOther: number;
  reduceGeometry: number;
  reduceTiming: number;
  reduceStage: number;
  reusedByStage: number;
}

export function emptyCost(): RunCost {
  return { rigcBuilds: 0, rigcRenders: 0, rigcOther: 0, reduceGeometry: 0, reduceTiming: 0, reduceStage: 0, reusedByStage: 0 };
}

/** The run's own tally; the selftest hands {@link countingRunner} and {@link costLine} one of its own. */
const COST: RunCost = emptyCost();

/** `run`, counting each call into `cost` by its first argument. */
export function countingRunner(run: RigcRunner, cost: RunCost): RigcRunner {
  return (args) => {
    if (args[0] === 'build') cost.rigcBuilds++;
    else if (args[0] === 'render') cost.rigcRenders++;
    else cost.rigcOther++;
    return run(args);
  };
}

/** The document's cost line: the wall time, rounded to the second, then the counts, every figure from `cost`. */
export function costLine(cost: RunCost, wallMs: number): string {
  const reduce = cost.reduceGeometry + cost.reduceTiming + cost.reduceStage;
  return (
    `Cost of this run: wall time ${Math.round(wallMs / 1000)} s; rigc builds ${cost.rigcBuilds}, renders ${cost.rigcRenders}, other rigc calls ${cost.rigcOther}; ` +
    `reduceMesh calls ${reduce} (${cost.reduceGeometry} by the geometry rows, ${cost.reduceTiming} by the timing section, ${cost.reduceStage} by a rig stage on an input no geometry row ran); ` +
    `reductions a rig stage reused from a geometry row on the same input: ${cost.reusedByStage}.`
  );
}

/** rig-c's CLI as `cli.ts` spawns it (its `rigcRunner`): the binary `findRigc` locates, stdout then stderr. */
function cliRunner(bin: string): RigcRunner {
  return (args) => {
    const r = spawnSync(bin, [...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.error !== undefined) return { status: 127, out: `could not start ${bin}: ${r.error.message}` };
    return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
}

/** `--cell-cap <s>`: the cap on any single reduction (in a child) and on any single build's rigc calls together; null = no cap. */
let CELL_CAP: number | null = null;

/**
 * {@link cliRunner} held to one deadline, `capSeconds` from its creation: every
 * rigc call gets what remains, and a call killed there (or never started
 * because nothing remains) returns exit 124 and is named by `stopped()`.
 */
export function deadlineRunner(bin: string, capSeconds: number): { run: RigcRunner; stopped: () => string | null } {
  const deadline = clock() + capSeconds * 1000;
  let stopped: string | null = null;
  return {
    run: (args) => {
      const left = deadline - clock();
      const what = `rigc ${args[0]}`;
      if (left <= 0) {
        stopped ??= what;
        return { status: 124, out: `auto_matrix: stopped at ${capSeconds} s (the per-cell cap) before ${what}` };
      }
      const r = spawnSync(bin, [...args], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: Math.ceil(left), killSignal: 'SIGKILL' });
      if (r.signal !== null || (r.error as { code?: string } | undefined)?.code === 'ETIMEDOUT') {
        stopped ??= what;
        return { status: 124, out: `auto_matrix: stopped at ${capSeconds} s (the per-cell cap) during ${what}` };
      }
      if (r.error !== undefined) return { status: 127, out: `could not start ${bin}: ${r.error.message}` };
      return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    },
    stopped: () => stopped,
  };
}

/**
 * The loss figure (the owner's condition 1): of the art pixels at alpha 1 and
 * above of `original` — the padded part image as drawn, every speck included —
 * how many have no triangle over their centre (rig-c's
 * `measureAuthoredMeshFit`, the reading `contourFit` and the compiler use), and
 * that count's share. The mask is never the one the source traced with its
 * specks erased: erasing them would hide exactly this loss.
 */
export function lossAgainstOriginal(original: AlphaMask, points: ReadonlyArray<readonly [number, number]>, triangles: readonly number[]): { artPixels: number; uncovered: number; share: number } {
  const fit = measureAuthoredMeshFit(
    original,
    AUTO_THRESHOLD,
    points.map(([x, y]) => [x, y] as [number, number]),
    [...triangles],
  );
  const uncovered = fit.artPixels - fit.coveredArt;
  return { artPixels: fit.artPixels, uncovered, share: fit.artPixels === 0 ? 0 : uncovered / fit.artPixels };
}

// ---------------------------------------------------------------------------
// the per-cell cap (--cell-cap): a reduction in a child process, killed at the cap
// ---------------------------------------------------------------------------

type Typed = Uint8Array | Uint8ClampedArray | Float32Array | Float64Array;
const TYPED: Record<string, (data: number[]) => Typed> = {
  Uint8Array: (d) => Uint8Array.from(d),
  Uint8ClampedArray: (d) => Uint8ClampedArray.from(d),
  Float32Array: (d) => Float32Array.from(d),
  Float64Array: (d) => Float64Array.from(d),
};

/**
 * A value as JSON that {@link fromWire} reads back as the same value: a typed
 * array (the art mask's alpha) tagged with its type, and a number JSON cannot
 * hold exactly (non-finite, or -0) refused by name rather than written as
 * something else.
 */
export function toWire(value: unknown): string {
  return JSON.stringify(value, (_k, x: unknown) => {
    if (x instanceof Uint8Array || x instanceof Uint8ClampedArray || x instanceof Float32Array || x instanceof Float64Array) return { $typed: x.constructor.name, data: Array.from(x) };
    if (typeof x === 'number' && (!Number.isFinite(x) || Object.is(x, -0))) throw new Error(`auto_matrix: the number ${Object.is(x, -0) ? '-0' : String(x)} cannot cross a process boundary as JSON`);
    return x;
  });
}

export function fromWire(text: string): unknown {
  return JSON.parse(text, (_k, x: unknown) => {
    if (x !== null && typeof x === 'object' && !Array.isArray(x) && '$typed' in x && 'data' in x) {
      const make = TYPED[String((x as { $typed: unknown }).$typed)];
      if (make === undefined) throw new Error(`auto_matrix: unknown typed array ${String((x as { $typed: unknown }).$typed)}`);
      return make((x as { data: number[] }).data);
    }
    return x;
  });
}

/** The reduceMesh wall time the last capped child measured for itself, read once by {@link geometryRow}. */
let childMs: number | null = null;

function takeChildMs(): number | null {
  const v = childMs;
  childMs = null;
  return v;
}

/**
 * A {@link Reducer} that runs `runReduction` in a child process (this file,
 * `--reduce-child`) and kills it at `capSeconds`: a cell past the cap comes
 * back as {@link STOPPED_CODE}, never as a wait. The child times its own
 * `reduceMesh` call, so a row's ms is the call's and not the process's.
 */
export function cappedReducer(capSeconds: number, dir: string, run: string[] = ['bun', join(ROOT, 'tools', 'auto_matrix.ts')]): Reducer {
  return (object, input) => {
    mkdirSync(dir, { recursive: true });
    const inFile = join(dir, 'reduce-in.json');
    const outFile = join(dir, 'reduce-out.json');
    rmSync(outFile, { force: true });
    writeFileSync(inFile, toWire({ object, input }));
    const r = spawnSync(run[0], [...run.slice(1), '--reduce-child', inFile, outFile], { encoding: 'utf8', timeout: capSeconds * 1000, killSignal: 'SIGKILL', maxBuffer: 1 << 26 });
    rmSync(inFile, { force: true });
    if (r.signal !== null || (r.error as { code?: string } | undefined)?.code === 'ETIMEDOUT') {
      rmSync(outFile, { force: true });
      return { code: STOPPED_CODE, object, detail: `stopped at ${capSeconds} s (the per-cell cap); reduceMesh returned nothing` };
    }
    if (r.status !== 0 || !existsSync(outFile)) throw new Error(`auto_matrix: the reduction child for ${object} exited ${r.status}: ${`${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(-600)}`);
    const back = fromWire(readFileSync(outFile, 'utf8')) as { ms: number; ran: ReductionResult };
    rmSync(outFile, { force: true });
    childMs = back.ms;
    return back.ran;
  };
}

/** `--reduce-child <in> <out>`: one `runReduction` on the input the parent wrote, its result and its own wall time written back. */
function reduceChild(inFile: string, outFile: string): void {
  const { object, input } = fromWire(readFileSync(inFile, 'utf8')) as { object: string; input: MeshReductionInput };
  const t0 = clock();
  const ran = runReduction(object, input);
  writeFileSync(outFile, toWire({ ms: clock() - t0, ran }));
}

/** One geometry row: the three counts, the residuals, the loss, the termination and the verdict of one call. */
export interface GeometryRow {
  name: string;
  /** (a) the tracked mesh, when there is one. */
  tracked: Counts | null;
  /** (b) the unreduced source after its own gate — rig-c's count of it. */
  source: Counts | null;
  /** (c) the result, when rig-c returned a mesh (accepted or not). */
  result: Counts | null;
  /** The reduction's whole result as rig-c returned it (null when no call ran), which a rig stage on the same input reuses. */
  ran?: ReductionResult | null;
  /** Vertices the reduction removed and the refinement inserted: (c) = (b) - removed + inserted. */
  removed: number | null;
  inserted: number | null;
  rows: MeasureRow[];
  lossSource: { artPixels: number; uncovered: number; share: number } | null;
  lossResult: { artPixels: number; uncovered: number; share: number } | null;
  strayIslands: number | null;
  strayPixels: number | null;
  termination: string;
  candidatesTried: number | null;
  blocking: string | null;
  verdict: Verdict;
  /** Result vertices bound to the region's bone, and the bindings to it, when a region was declared. */
  regionBound: { vertices: number; bindings: number } | null;
  /** The call's wall time, ms (the tool's clock; null where no call was made). */
  ms: number | null;
  input: MeshReductionInput | null;
  mesh: ReducedMesh | null;
  report: MeshQualityReport | null;
}

/** The weighting a row is built with: null for the synthetic rows (geometry only, unweighted). */
export interface Weighting {
  ox: number;
  oy: number;
  segs: Segment[];
  r: number;
  boneOrder: string[];
  /**
   * What the motion amplitude is derived from (rig-c 2.29.0): the bones, idle and constraint count of a build of the
   * same config, read as the rig stage reads them, so the row's input — amplitude included — is the one the stage
   * builds and `reductionKey` matches it whole (issue #135's reuse).
   */
  idle: AmplitudeBasis;
}

/** The spec the rig stage is handed for a part (`switched`): the policy's motion block added when the spec has none. */
export function stageSpec(spec: AutoSpec): AutoSpec {
  return spec.motion === undefined ? withPolicyMotion(spec) : spec;
}

/** The reduction input the rig stage builds for a weighted part: the geometry input with the amplitude it derives. */
export function stageInput(base: MeshReductionInput, spec: AutoSpec, w: Weighting, weights: ReadonlyArray<ReadonlyArray<{ bone: string }>>): MeshReductionInput {
  return withAmplitude(base, partAmplitude(w.idle, weights, stageSpec(spec).motion));
}

/** The time `f` takes, ms, from a clock the caller hands in (the selftest hands a fixed one). */
export type Clock = () => number;

/**
 * Every step the rig stage's `autoAttachment` takes for one part (`src/rig.ts`),
 * in its order, with the reduction timed: the source, its weights, the call,
 * the verdict; then the loss of the source and of the result against the
 * original image. `tracked` is set beside it as count (a).
 */
export function geometryRow(name: string, mask: AlphaMask, spec: AutoSpec, w: Weighting | null, tracked: Counts | null, clock: Clock, reduce: Reducer = runReduction): GeometryRow {
  const empty: GeometryRow = {
    name,
    tracked,
    source: null,
    result: null,
    removed: null,
    inserted: null,
    rows: [],
    lossSource: null,
    lossResult: null,
    strayIslands: null,
    strayPixels: null,
    termination: 'no call',
    candidatesTried: null,
    blocking: null,
    verdict: { kind: 'accepted' },
    regionBound: null,
    ms: null,
    input: null,
    mesh: null,
    report: null,
  };
  const source = autoSource(name, mask, spec);
  if (Array.isArray(source)) return { ...empty, termination: 'the source is refused before the call', verdict: classify(source[0]) };
  let weights = null;
  if (w !== null) {
    const sw = sourceWeights(source.vertices, w.ox, w.oy, w.segs, w.r, spec);
    if ('overlap' in sw) return { ...empty, termination: 'the source weights are refused before the call', verdict: { kind: 'refused', code: 'RIG_CONTOUR_REGIONS_OVERLAP', detail: `source vertex ${sw.vertex}` } };
    weights = sw.weights;
  }
  const geometryInput = autoReductionInput({ part: name, mask, ox: w?.ox ?? 0, oy: w?.oy ?? 0, spec, source, weights, boneOrder: w?.boneOrder ?? [] });
  const input = w === null || weights === null ? geometryInput : stageInput(geometryInput, spec, w, weights);
  const t0 = clock();
  COST.reduceGeometry++;
  const ran = reduce(name, input);
  const ms = takeChildMs() ?? clock() - t0;
  const lossSource = lossAgainstOriginal(mask, input.source.points, input.source.triangles);
  const base = { ...empty, input, ran, ms, lossSource, strayIslands: source.report.strayIslands, strayPixels: source.report.strayPixels };
  if ('code' in ran) return { ...base, ms: ran.code === STOPPED_CODE ? null : ms, termination: ran.code === STOPPED_CODE ? 'stopped at the cap, no result' : 'rig-c threw', verdict: classify(ran) };
  const v = autoVerdict(name, ran);
  const t = ran.report.termination;
  const cand = ran.report.candidates[0];
  const mesh = ran.mesh;
  let regionBound: GeometryRow['regionBound'] = null;
  if ((spec.regions ?? []).length > 0 && mesh !== null && mesh.weights !== null) {
    const bones = new Set((spec.regions ?? []).filter(weightsABone).map((rg) => rg.bone));
    let vertices = 0;
    let bindings = 0;
    for (const list of mesh.weights) {
      const n = list.filter((e) => bones.has(e.bone)).length;
      if (n > 0) vertices++;
      bindings += n;
    }
    regionBound = { vertices, bindings };
  }
  return {
    ...base,
    source: ran.report.sourceCounts === null ? null : countsOf(ran.report.sourceCounts),
    result: cand?.counts === null || cand === undefined ? null : countsOf(cand.counts),
    removed: cand?.changes?.removedVertices ?? null,
    inserted: cand?.changes?.insertedVertices ?? null,
    rows: cand?.geometry?.rows ?? [],
    lossResult: mesh === null ? null : lossAgainstOriginal(mask, mesh.points, mesh.triangles),
    termination: terminationText(t),
    candidatesTried: t !== null && (t.reason === 'no-further-valid-reduction' || t.reason === 'budget-exhausted') ? t.candidatesTried : null,
    blocking: t !== null && t.reason === 'no-further-valid-reduction' ? t.blockingConstraint : null,
    verdict: v.accepted ? { kind: 'accepted' } : classify(v.problem),
    regionBound,
    mesh,
    report: ran.report,
  };
}

/**
 * A residual row's value by code (and region), or null: the first such row in
 * report order. For `MQ_OVERSHOOT` that is the 8-connected reading rig-c gates;
 * its 4-connected twin, reported after it where a diagonal pinch makes the
 * fills differ, is never read here. (Not "the one that is not undeclared":
 * under `maxOvershoot: null` the gated reading is undeclared too.)
 */
export function rowValue(rows: readonly MeasureRow[], code: string, region: string | null = null): MeasureRow | null {
  return rows.find((r) => r.code === code && r.object.region === region) ?? null;
}

const num = (v: number | null | undefined, places = 3): string => (v === null || v === undefined ? '—' : `${pyRound(v, places)}`);

function residualCell(rows: readonly MeasureRow[], code: string, region: string | null = null): string {
  const r = rowValue(rows, code, region);
  if (r === null) return '—';
  if (r.value === null) return r.state;
  return `${num(r.value, 4)}${r.state === 'fail' ? ' FAIL' : r.state === 'undeclared' ? ' not bounded' : ''}`;
}

/** The source measured as one reduction step measures a candidate: the same art, targets, regions and samples, against the source's own hull. */
export function sourceMeasureInput(input: MeshReductionInput): MeshMeasureInput {
  return {
    id: 'source',
    attachment: input.attachment,
    art: input.art,
    source: input.source,
    targets: { artFit: input.targets.artFit, maxBoundaryDeviation: input.targets.maxBoundaryDeviation, ...(input.targets.minAngle === undefined ? {} : { minAngle: input.targets.minAngle }), regions: input.targets.regions },
    referenceHull: input.source.points.slice(0, input.source.hull),
    minArtSamples: input.minArtSamples,
    regionArtSamples: input.regionArtSamples,
    protect: input.protect,
    influences: input.influences,
    boneOrder: input.boneOrder,
    preset: input.preset,
  };
}

/** The one-minute load average out of an `uptime` line (the first of the three figures), or null when the line has none. */
export function oneMinuteLoad(uptime: string): number | null {
  const m = /load averages?:\s*([0-9]+[.,][0-9]+)/.exec(uptime);
  return m === null ? null : Number(m[1].replace(',', '.'));
}

/** The owner's condition 4: quiet only when the one-minute load is under 2 before AND after; anything else (an unread figure included) is loaded. */
export function quietLabel(before: string, after: string): 'quiet' | 'loaded' {
  const a = oneMinuteLoad(before);
  const b = oneMinuteLoad(after);
  return a !== null && b !== null && a < 2 && b < 2 ? 'quiet' : 'loaded';
}

/** The nine bars of a check.json (the gate, the loop, the seam and the six judgement lines): how many passed and the names of those that did not. */
export const NINE_BARS = ['gate', 'loop', 'seam', 'BREATH_VISIBLE', 'BLINK_NO_HOLE', 'CHAIN_LAG', 'TIP_OVER_ROOT', 'STILL_REGIONS_DARK', 'TEXTURE_STRETCH'] as const;

export function barsOf(check: Record<string, unknown>): { passed: number; failing: string[]; skipped: string[] } {
  const failing: string[] = [];
  const skipped: string[] = [];
  for (const bar of NINE_BARS) {
    if (bar === 'gate') {
      if (check.gate_spine_html_green !== true) failing.push(bar);
    } else if (bar === 'loop') {
      if (check.loop_max_diff !== 0) failing.push(bar);
    } else if (bar === 'seam') {
      if (!(typeof check.seam_mean === 'number' && check.seam_mean <= 1 && typeof check.seam_px_over_40 === 'number' && check.seam_px_over_40 <= 50)) failing.push(bar);
    } else {
      const s = (check[bar] as { status?: string } | undefined)?.status;
      if (s === 'SKIP') skipped.push(bar);
      else if (s !== 'PASS') failing.push(bar);
    }
  }
  return { passed: NINE_BARS.length - failing.length - skipped.length, failing, skipped };
}

/** `TEXTURE_STRETCH`'s severity for one slot, and where its worst edge was, off check.json. */
export function stretchOf(check: Record<string, unknown>, slot: string): { severity: number; at: string } | null {
  const ts = check.TEXTURE_STRETCH as { per_mesh?: Array<{ slot: string; severity: number; min_ratio: number; min_at: string; max_ratio: number; max_at: string }> } | undefined;
  const row = ts?.per_mesh?.find((m) => m.slot === slot);
  if (row === undefined) return null;
  const at = 1 / row.min_ratio >= row.max_ratio ? `min ${row.min_ratio} at ${row.min_at}` : `max ${row.max_ratio} at ${row.max_at}`;
  return { severity: row.severity, at };
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

interface Example {
  key: string;
  raw: { [k: string]: Json };
  cfg: CharacterConfig;
  base: string;
  parts: ReturnType<typeof readParts>;
  boneOrder: string[];
  /** The tracked build's bones, idle and constraint count: what the stage derives an automatic part's amplitude from. */
  idle: AmplitudeBasis;
  trackedReport: MeshReport[];
  trackedRig: { skins: { default: Record<string, Record<string, { type?: string; weights?: unknown[][]; uvs?: number[]; width?: number; height?: number }>> } };
  check: Record<string, unknown>;
}

function sh(cmd: string[], log: string): number {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8', maxBuffer: 1 << 28, cwd: ROOT });
  writeFileSync(log, `${r.stdout ?? ''}${r.stderr ?? ''}`);
  return r.status ?? 1;
}

function uptime(): string {
  const r = spawnSync('uptime', [], { encoding: 'utf8' });
  return (r.stdout ?? '').trim();
}

/** The packing every variant's `rig` and `check` run with: the flags the CLI calls took, `--page-edges free --pack-shape polygon`. */
const PACK_MODE = { pageEdges: 'free', packShape: 'polygon' } as const;

/**
 * The tracked example: its full build (assemble, rig, check) in `<work>/base-<key>`, or, with `partsOnly` (the
 * timing on a machine with no Node for rig-c's CLI), its assemble alone and the bone order the rig stage
 * computes in-process (`buildRig`, no rig-c gate), which is all the timed inputs read.
 */
function loadExample(key: string, work: string, partsOnly = false): Example {
  const config = join(ROOT, 'examples', key, 'config.json');
  const base = join(work, partsOnly ? `parts-${key}` : `base-${key}`);
  const inputs = join(ROOT, 'examples', key, 'inputs');
  const runs = ['--source', join(inputs, 'painting.png'), '--full', join(inputs, 'layers', 'full'), '--head', join(inputs, 'layers', 'head')];
  const fail = (what: string, s: number): never => {
    throw new Error(`auto_matrix: the tracked ${key} ${what} exited ${s}; ${base}.log ends:\n${readFileSync(`${base}.log`, 'utf8').trim().split('\n').slice(-15).join('\n')}`);
  };
  const raw = JSON.parse(readFileSync(config, 'utf8')) as { [k: string]: Json };
  if (partsOnly) {
    // `assemble --out <dir>` writes <dir>/rig/parts.json and <dir>/rig/parts/.
    const asm = join(base, 'rig');
    if (!existsSync(join(asm, 'parts.json'))) {
      const s = sh(['bun', join(ROOT, 'cli.ts'), 'assemble', '--config', config, ...runs, '--out', base], `${base}.log`);
      if (s !== 0) fail('assemble', s);
    }
    const parts = readParts(join(asm, 'parts.json'));
    const images = new Map<string, Raster>();
    for (const p of parts.parts) images.set(p.name, readPng(join(asm, 'parts', `${p.name}.png`)));
    const out = buildRig(parseConfig(raw), parts, images);
    return { key, raw, cfg: parseConfig(raw), base: asm, parts, boneOrder: out.rig.bones.map((b) => b.name), idle: basisOf(out, parseConfig(raw)), trackedReport: out.meshReport, trackedRig: { skins: { default: {} } }, check: {} };
  }
  if (!existsSync(join(base, 'check', 'check.json'))) {
    // `cli.ts build` with its defaults, run in this process so its rigc calls are counted (issue #135).
    const runner = countingRunner(cliRunner(findRigc(ROOT, process.env.PATH ?? '')), COST);
    const scratch = mkdtempSync(join(work, 'build-scratch-'));
    const lines: string[] = [];
    let stopped: string | null = 'crash';
    try {
      stopped = build(
        { config, source: join(inputs, 'painting.png'), full: join(inputs, 'layers', 'full'), head: join(inputs, 'layers', 'head'), out: base, seam: DEFAULT_SEAM_RULE, project: DEFAULT_PROJECT_RULE, loop: false, pageEdges: DEFAULT_PAGE_EDGES },
        { rig: runner, check: runner, checkBin: findRigc(ROOT, process.env.PATH ?? ''), scratch: join(scratch, 'rig-gate') },
        (l) => lines.push(l),
      ).stoppedAt;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
      writeFileSync(`${base}.log`, `${lines.join('\n')}\n`);
    }
    if (stopped !== null) fail('build', 1);
  }
  const tracked = JSON.parse(readFileSync(join(base, 'check', 'check.json'), 'utf8')) as Record<string, unknown>;
  rememberTracked(key, tracked);
  const rig = JSON.parse(readFileSync(join(base, 'rig', 'rig.json'), 'utf8')) as Example['trackedRig'] & { bones: Array<{ name: string; parent?: string }> };
  const idleMotion = JSON.parse(readFileSync(join(base, 'rig', 'motion.json'), 'utf8')) as MotionSpec;
  return {
    key,
    raw,
    cfg: parseConfig(raw),
    base,
    parts: readParts(join(base, 'parts.json')),
    boneOrder: rig.bones.map((b) => b.name),
    idle: { bones: rig.bones, motion: idleMotion, constraints: parseConfig(raw).constraints?.length ?? 0 },
    trackedReport: JSON.parse(readFileSync(join(base, 'rig', 'mesh_report.json'), 'utf8')) as MeshReport[],
    trackedRig: rig,
    check: tracked,
  };
}

/** The padded part image's alpha, as the rig stage hands it to the automatic mode. */
function partMask(ex: Example, part: string): { mask: AlphaMask; ox: number; oy: number; box: { x: number; y: number; w: number; h: number }; img: Raster } {
  const p = ex.parts.parts.find((q) => q.name === part);
  if (p === undefined) throw new Error(`auto_matrix: no part ${part} in ${ex.base}`);
  const raw = readPng(join(ex.base, 'parts', `${part}.png`));
  const img = pad(raw, PAD, PAD, PAD, PAD, [0, 0, 0, 0]);
  const alpha = new Uint8Array(img.width * img.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
  return { mask: { width: img.width, height: img.height, alpha }, ox: p.x - PAD, oy: p.y - PAD, box: { x: p.x, y: p.y, w: p.w, h: p.h }, img: raw };
}

function trackedCounts(ex: Example, part: string): Counts | null {
  const row = ex.trackedReport.find((r) => r.part === part);
  const att = ex.trackedRig.skins.default[part]?.[part];
  if (row === undefined || att?.weights === undefined) return null;
  let bindings = 0;
  for (const v of att.weights) bindings += v.length;
  return { boundary: row.hull, interior: row.vertices - row.hull, triangles: row.triangles, bindings, meanInfluences: pyRound(bindings / row.vertices, 2) };
}

function spacingOf(m: { [k: string]: Json }): number {
  if (typeof m.grid === 'number') return m.grid;
  return (m.contour as { spacing: number }).spacing;
}

/** The motion gate's outcome in a full build (main #134, `src/automotion.ts`): the rig stage writes the part only when it passes. */
export interface MotionOutcome {
  verdict: 'pass' | 'refused';
  /** `MQ_LOCAL_DEFORMATION`'s value, bound and worst frame as the gate stated them, or the refusal's own words. */
  text: string;
}

/**
 * The motion gate's outcome for `slot` off one `rig` run: on a written rig, the
 * part's `deformation.rows` in `mesh_report.json`; on a refused one, the
 * `AUTO_MESH_MOTION` (or `AUTO_MESH_MOTION_INPUT`, `AUTO_MESH_NO_STIMULUS`)
 * line of the stage's log. Null when the rig was refused for another reason
 * or the part carries no motion row.
 */
export function motionOutcome(log: string, report: MeshReport[] | null, slot: string): MotionOutcome | null {
  if (report !== null) {
    const row = report.find((r) => r.part === slot && 'mode' in r && r.mode === 'auto') as AutoMeshReport | undefined;
    const d = row?.deformation;
    if (d === undefined || typeof d === 'string') return null;
    const m = d.rows.find((r) => r.code === 'MQ_LOCAL_DEFORMATION' && r.region === null);
    return { verdict: 'pass', text: m === undefined ? `${d.verdict}` : `${m.state} ${m.value} against ${m.bound?.op} ${m.bound?.value}${m.worst_frame === null ? '' : ` at ${m.worst_frame}`}` };
  }
  const line = log.split('\n').find((l) => /AUTO_MESH_(MOTION|MOTION_INPUT|NO_STIMULUS)\b/.test(l) && l.includes(`meshes.${slot}.`));
  if (line === undefined) return null;
  const m = /MQ_LOCAL_DEFORMATION fail [^;]*?(?: at [^;)]+)?(?=;|\)|$)/.exec(line);
  return { verdict: 'refused', text: m === null ? line.trim().slice(0, 240) : m[0] };
}

interface Built {
  motion: MotionOutcome | null;
  bars: { passed: number; failing: string[]; skipped: string[] } | null;
  stretch: { severity: number; at: string } | null;
  overall: number | null;
  detail: string;
  check: Record<string, unknown> | null;
  rig: string;
}

/** Every reduction a geometry row ran, by its input's `reductionKey`: what a rig stage on the same input reuses. */
const REDUCED = new Map<string, ReductionResult>();

/** Keep a geometry row's reduction for the rig stages that follow (nothing when no call ran). */
function remember(g: GeometryRow): void {
  if (g.input !== null && g.ran !== undefined && g.ran !== null && !('code' in g.ran && g.ran.code === STOPPED_CODE)) REDUCED.set(reductionKey(g.input), g.ran);
}

/** A stage's refusal as `cli.ts` prints it (`printRefusal`): each problem's FAIL line, then the count. */
function refusalLines(err: unknown): string[] {
  if (!(err instanceof PartsError)) throw err;
  return [...err.problems.map((p) => `  FAIL  ${problemLine(p)}`), `refused: ${err.problems.length} problem(s)`];
}

/**
 * `rig` then `check` on a config written to `dir`, the parts read from the
 * tracked build — the stages `cli.ts rig` and `cli.ts check` run, called in
 * this process with the CLI's flags (`PACK`) so their rigc calls are counted,
 * and the rig stage handed `reuseReductions` over {@link REDUCED} (issue #135).
 * `rig.log` and `check.log` hold the lines the commands print.
 */
function rigAndCheck(ex: Example, raw: { [k: string]: Json }, dir: string, slot: string): Built {
  const config = writeSwitchedConfig(ex.key, raw, dir, `${JSON.stringify(raw, null, 2)}\n`);
  const rig = join(dir, 'rig');
  const bin = findRigc(ROOT, process.env.PATH ?? '');
  const capped = CELL_CAP === null ? null : deadlineRunner(bin, CELL_CAP);
  const runner = countingRunner(capped === null ? cliRunner(bin) : capped.run, COST);
  const stoppedDetail = (): string | null => (capped === null || capped.stopped() === null ? null : `stopped at ${CELL_CAP} s (the per-cell cap) during ${capped.stopped()}`);
  const reuse = reuseReductions(REDUCED, (object, input) => {
    COST.reduceStage++;
    return CELL_CAP === null ? runReduction(object, input) : cappedReducer(CELL_CAP, join(dir, 'reduce'))(object, input);
  });
  const rigLog: string[] = [];
  const scratch = mkdtempSync(join(dir, 'rig-scratch-'));
  let r = 0;
  try {
    rigStage({ config, parts: ex.base, out: rig, pageEdges: PACK_MODE.pageEdges, packShape: PACK_MODE.packShape, reduce: reuse.reduce }, runner, scratch, (l) => rigLog.push(l));
  } catch (err) {
    rigLog.push(...refusalLines(err));
    r = 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    COST.reusedByStage += reuse.reused();
  }
  writeFileSync(join(dir, 'rig.log'), `${rigLog.join('\n')}\n`);
  const stoppedInRig = stoppedDetail();
  if (stoppedInRig !== null) return { motion: null, bars: null, stretch: null, overall: null, detail: stoppedInRig, check: null, rig };
  if (r !== 0) {
    const log = readFileSync(join(dir, 'rig.log'), 'utf8');
    // The refusal's own FAIL line (refusalLines writes one per problem); a progress line that merely holds an underscore
    // (a part name such as hair_back) is not the reason.
    const fail = log.split('\n').find((l) => l.trimStart().startsWith('FAIL')) ?? `exit ${r}`;
    return { motion: motionOutcome(log, null, slot), bars: null, stretch: null, overall: null, detail: `rig exit ${r}: ${fail.trim().slice(0, 200)}`, check: null, rig };
  }
  const motion = motionOutcome('', JSON.parse(readFileSync(join(rig, 'mesh_report.json'), 'utf8')) as MeshReport[], slot);
  const out = join(dir, 'check');
  const checkLog: string[] = [];
  try {
    checkStage({ rig, parts: ex.base, source: join(ROOT, 'examples', ex.key, 'inputs', 'painting.png'), out, pageEdges: PACK_MODE.pageEdges, packShape: PACK_MODE.packShape }, runner, bin, (l) => checkLog.push(l));
  } catch (err) {
    checkLog.push(...refusalLines(err));
  }
  writeFileSync(join(dir, 'check.log'), `${checkLog.join('\n')}\n`);
  const stoppedInCheck = stoppedDetail();
  if (stoppedInCheck !== null) return { motion, bars: null, stretch: null, overall: null, detail: stoppedInCheck, check: null, rig };
  if (!existsSync(join(out, 'check.json'))) return { motion, bars: null, stretch: null, overall: null, detail: 'check wrote no check.json', check: null, rig };
  const check = JSON.parse(readFileSync(join(out, 'check.json'), 'utf8')) as Record<string, unknown>;
  const bars = barsOf(check);
  return { motion, bars, stretch: stretchOf(check, slot), overall: (check.TEXTURE_STRETCH as { severity?: number } | undefined)?.severity ?? null, detail: '', check, rig };
}

/** The rig stage's auto row must be this tool's direct call: same counts, same candidates tried. */
function holdToDirect(rig: string, part: string, g: GeometryRow): string {
  const rows = JSON.parse(readFileSync(join(rig, 'mesh_report.json'), 'utf8')) as MeshReport[];
  const row = rows.find((r) => r.part === part && 'mode' in r && r.mode === 'auto') as AutoMeshReport | undefined;
  if (row === undefined) throw new Error(`auto_matrix: ${rig}/mesh_report.json has no auto row for ${part}`);
  const t = row.termination;
  const tried = t.reason === 'no-further-valid-reduction' || t.reason === 'budget-exhausted' ? t.candidatesTried : null;
  const same = JSON.stringify(row.result.counts) === JSON.stringify(g.mesh?.counts) && tried === g.candidatesTried && JSON.stringify(row.source.counts) === JSON.stringify(g.report?.sourceCounts);
  if (!same) throw new Error(`auto_matrix: the rig stage's row for ${part} (${JSON.stringify(row.result.counts)}, ${tried} tried) is not this tool's direct call (${JSON.stringify(g.mesh?.counts)}, ${g.candidatesTried} tried); the two did not read the same inputs`);
  return 'same as the rig stage';
}

const clock: Clock = () => performance.now();

interface PartResult {
  example: string;
  part: string;
  policy: 'strict' | 'permissive';
  region: 'none' | 'declared';
  regionSpec: string | null;
  g: GeometryRow;
  alone: Built | null;
  load: string;
}

interface Section {
  title: string;
  lines: string[];
}

function parseArgs(argv: string[]): { work: string; out: string; examples: string[] | null; builds: boolean; timing: boolean; quietWait: number; timingOnly: boolean; timingFrom: string | null; machine: string; fetch: boolean; printDoc: boolean; cell: { part: string; policy: 'strict' | 'permissive' } | null; cellCap: number | null; commit: string | null } {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i < 0 ? null : (argv[i + 1] ?? null);
  };
  const work = get('--work');
  if (work === null) {
    console.log('usage: bun tools/auto_matrix.ts --work <dir> [--out <file.md>] [--examples <key>,...] [--cell <part>:<strict|permissive>] [--cell-cap <s>] [--no-builds] [--no-timing] [--quiet-wait <s>] [--machine <label>] [--commit <id>] [--timing-only | --timing-from <file>] [--fetch] [--print-doc]');
    process.exit(2);
  }
  const ex = get('--examples');
  const capArg = get('--cell-cap');
  if (capArg !== null && !(Number.isInteger(Number(capArg)) && Number(capArg) > 0)) {
    console.log(`auto_matrix: --cell-cap ${capArg}; a whole number of seconds above 0 is required`);
    process.exit(2);
  }
  const cellArg = get('--cell');
  const cellMatch = cellArg === null ? null : /^([^:]+):(strict|permissive)$/.exec(cellArg);
  if (cellArg !== null && cellMatch === null) {
    console.log(`auto_matrix: --cell ${cellArg}; <part>:strict or <part>:permissive is required`);
    process.exit(2);
  }
  return {
    work: resolve(work),
    out: resolve(get('--out') ?? join(ROOT, 'docs', 'evidence', 'auto-mesh-matrix.md')),
    examples: ex === null ? null : ex.split(',').filter((k) => k !== ''),
    builds: !argv.includes('--no-builds'),
    timing: !argv.includes('--no-timing'),
    quietWait: Number(get('--quiet-wait') ?? '0'),
    timingOnly: argv.includes('--timing-only'),
    timingFrom: get('--timing-from'),
    machine: get('--machine') ?? 'local',
    fetch: argv.includes('--fetch'),
    printDoc: argv.includes('--print-doc'),
    cell: cellMatch === null ? null : { part: cellMatch[1], policy: cellMatch[2] as 'strict' | 'permissive' },
    cellCap: capArg === null ? null : Number(capArg),
    commit: get('--commit'),
  };
}

function regionText(rg: { cx: number; cy: number; r: number; band: number; maxEdgeLength: number; transition: number; grade: number }): string {
  return `circle (${rg.cx}, ${rg.cy}) r ${rg.r}, band ${rg.band}; L0 ${rg.maxEdgeLength}, transition ${rg.transition}, grade ${pyRound(rg.grade, 6)}`;
}

function weighting(ex: Example, part: string, ox: number, oy: number, basis: { boneOrder: string[]; idle: AmplitudeBasis } = ex): Weighting {
  const m = ex.cfg.meshes[part];
  if (m === undefined) throw new Error(`auto_matrix: ${part} is not a mesh of ${ex.key}`);
  if ('influence' in m) throw new Error(`auto_matrix: ${part} of ${ex.key} is an influence mesh, which the distance rule's r does not weight`);
  return { ox, oy, segs: resolveSegments(ex.cfg, m.segments), r: m.r, boneOrder: basis.boneOrder, idle: basis.idle };
}

/** What the amplitude derives from on a built rig: its bones, its idle as written, the config's constraint count. */
export function basisOf(out: { rig: { bones: ReadonlyArray<{ name: string; parent?: string }> }; motion: MotionSpec }, cfg: CharacterConfig): AmplitudeBasis {
  return { bones: out.rig.bones, motion: out.motion, constraints: cfg.constraints?.length ?? 0 };
}

/** The bone order the rig stage hands rig-c for a config, and the amplitude's basis: read off a lattice build of that config (no reduction run). */
function rigBasisOf(raw: { [k: string]: Json }, ex: Example): { boneOrder: string[]; idle: AmplitudeBasis } {
  const images = new Map<string, Raster>();
  for (const p of ex.parts.parts) images.set(p.name, readPng(join(ex.base, 'parts', `${p.name}.png`)));
  const cfg = parseConfig(raw);
  const out = buildRig(cfg, ex.parts, images);
  return { boneOrder: out.rig.bones.map((b) => b.name), idle: basisOf(out, cfg) };
}

function withRegionBone(raw: { [k: string]: Json }, t: { cx: number; cy: number; parent: string }): { [k: string]: Json } {
  const c = JSON.parse(JSON.stringify(raw)) as { [k: string]: Json };
  (c.bones as Json[]).push({ name: MATRIX_REGION_BONE, parent: t.parent, at: [t.cx, t.cy] });
  return c;
}

function switched(raw: { [k: string]: Json }, part: string, spec: AutoSpec): { [k: string]: Json } {
  const c = JSON.parse(JSON.stringify(raw)) as { [k: string]: Json };
  const meshes = c.meshes as { [k: string]: { [k: string]: Json } };
  const m = meshes[part];
  meshes[part] = { auto: JSON.parse(JSON.stringify(stageSpec(spec))) as Json, r: m.r, segments: m.segments };
  return c;
}

function main(argv: string[]): void {
  const child = argv.indexOf('--reduce-child');
  if (child >= 0) {
    reduceChild(argv[child + 1], argv[child + 2]);
    return;
  }
  const started = clock();
  const args = parseArgs(argv);
  CELL_CAP = args.cellCap;
  const reducerFor = (dir: string): Reducer => (CELL_CAP === null ? runReduction : cappedReducer(CELL_CAP, dir));
  mkdirSync(args.work, { recursive: true });
  if (args.fetch) {
    // `--fetch`: the pinned example inputs, by the repository's own script (a machine with a fresh copy of the tree has none).
    const f = spawnSync('bash', [join(ROOT, 'scripts', 'fetch-examples.sh')], { cwd: ROOT, encoding: 'utf8' });
    console.log(`${f.stdout ?? ''}${f.stderr ?? ''}`.trim());
    if (f.status !== 0) process.exit(2);
  }
  const fetched = readdirSync(join(ROOT, 'examples'))
    .sort()
    .filter((k) => existsSync(join(ROOT, 'examples', k, 'config.json')) && existsSync(join(ROOT, 'examples', k, 'inputs', 'painting.png')));
  const keys = args.examples ?? fetched;
  const missing = keys.filter((k) => !fetched.includes(k));
  if (missing.length > 0 || keys.length === 0) {
    console.log(`auto_matrix: ${keys.length === 0 ? 'no fetched example' : `${missing.join(', ')} not fetched`}; run bun run fetch-examples`);
    process.exit(2);
  }
  const rigcVersion = (JSON.parse(readFileSync(join(ROOT, 'node_modules', 'rig-c', 'package.json'), 'utf8')) as { version: string }).version;
  // The commit: `--commit` when given (a copy of the tree with no .git, as the remote runner uploads), else git's own reading.
  const head = args.commit ?? (spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout ?? '').trim();
  const dirty = args.commit === null && (spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, encoding: 'utf8' }).stdout ?? '').trim() !== '';
  const pinned = pinnedExamplesCommit(readFileSync(join(ROOT, 'scripts', 'fetch-examples.sh'), 'utf8'));
  const examples = new Map<string, Example>();
  for (const k of keys) {
    console.log(`auto_matrix: tracked build of ${k}`);
    examples.set(k, loadExample(k, args.work, args.timingOnly || !args.builds));
  }
  const sections: Section[] = [];
  const loadsSeen: string[] = [];

  // ---- 1. timing --------------------------------------------------------
  if (args.timing && args.timingFrom !== null) {
    // read at the end, when the document is rendered: the section may still be being taken on another machine
  } else if (args.timing) {
    const lines: string[] = [];
    lines.push(`Machine: ${args.machine}; rig-c ${rigcVersion}.`, '');
    let waited = 0;
    while (args.quietWait > 0 && waited < args.quietWait && (oneMinuteLoad(uptime()) ?? 99) >= 2) {
      spawnSync('sleep', ['30']);
      waited += 30;
    }
    lines.push(`Waited ${waited} s for a one-minute load under 2 before the first timing (limit ${args.quietWait} s).`, '');
    lines.push('| input | source V (hull) / T | mask px (art at alpha >= 1) | candidates tried | measureMeshQuality on the source, 3 runs (ms) | reduceMesh, 2 runs (ms) | ms per candidate (run 2) | uptime before | uptime after | label |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    const timed: Array<{ label: string; build: () => { input: MeshReductionInput } | string }> = [];
    const exampleInput = (key: string, part: string): { input: MeshReductionInput } | string => {
      const ex = examples.get(key);
      if (ex === undefined) return `${key} not fetched`;
      const m = ex.raw.meshes as { [k: string]: { [k: string]: Json } };
      const { mask, ox, oy } = partMask(ex, part);
      const spec = examplePolicy(spacingOf(m[part]));
      const source = autoSource(part, mask, spec);
      if (Array.isArray(source)) return source.map((p) => p.code).join('+');
      const w = weighting(ex, part, ox, oy);
      const sw = sourceWeights(source.vertices, ox, oy, w.segs, w.r, spec);
      if ('overlap' in sw) return 'overlap';
      return { input: stageInput(autoReductionInput({ part, mask, ox, oy, spec, source, weights: sw.weights, boneOrder: w.boneOrder }), spec, w, sw.weights) };
    };
    // The region condition's input (section 4) under the strict policy: the same part, its control bone added, the region declared.
    const regionInput = (key: string): { input: MeshReductionInput } | string => {
      const ex = examples.get(key);
      if (ex === undefined) return `${key} not fetched`;
      const part = 'bottomwear';
      const m = ex.raw.meshes as { [k: string]: { [k: string]: Json } };
      const { mask, ox, oy, box, img } = partMask(ex, part);
      const t = testRegion(ex.cfg, part, placedMask(box.x, box.y, img), box);
      if (typeof t === 'string') return `the region rule passes over it: ${t}`;
      const grid = spacingOf(m[part]);
      const spec = { ...examplePolicy(grid), regions: [matrixRegion(t, grid)] };
      const source = autoSource(part, mask, spec);
      if (Array.isArray(source)) return source.map((p) => p.code).join('+');
      const w = weighting(ex, part, ox, oy, rigBasisOf(withRegionBone(ex.raw, t), ex));
      const sw = sourceWeights(source.vertices, ox, oy, w.segs, w.r, spec);
      if ('overlap' in sw) return 'overlap';
      return { input: stageInput(autoReductionInput({ part, mask, ox, oy, spec, source, weights: sw.weights, boneOrder: w.boneOrder }), spec, w, sw.weights) };
    };
    timed.push({ label: 'demo / bottomwear', build: () => exampleInput('reference-demo', 'bottomwear') });
    timed.push({ label: 'demo / bottomwear + the declared region', build: () => regionInput('reference-demo') });
    timed.push({ label: 'sample / sleeves', build: () => exampleInput('reference-sample', 'sleeves') });
    timed.push({ label: 'sample / bottomwear', build: () => exampleInput('reference-sample', 'bottomwear') });
    timed.push({ label: 'scarf / handwear_l', build: () => exampleInput('scarf', 'handwear_l') });
    const strip = AUTO_CASES.find((c) => c.name === 'tiny region, source at L0');
    if (strip !== undefined) {
      timed.push({
        label: 'synthetic strip, spacing 2, one region (unweighted)',
        build: () => {
          const source = autoSource(strip.name, strip.mask, strip.spec);
          if (Array.isArray(source)) return source.map((p) => p.code).join('+');
          return { input: autoReductionInput({ part: strip.name, mask: strip.mask, ox: 0, oy: 0, spec: strip.spec, source, weights: null, boneOrder: [] }) };
        },
      });
    }
    for (const t of timed) {
      const b = t.build();
      if (typeof b === 'string') {
        lines.push(`| ${t.label} | refused: ${b} | | | | | | | | |`);
        continue;
      }
      const before = uptime();
      loadsSeen.push(before);
      const mq: number[] = [];
      for (let k = 0; k < 3; k++) {
        const t0 = clock();
        measureMeshQuality(sourceMeasureInput(b.input));
        mq.push(Math.round(clock() - t0));
      }
      const rd: number[] = [];
      let tried: number | null = null;
      for (let k = 0; k < 2; k++) {
        const t0 = clock();
        COST.reduceTiming++;
        const ran = reduceMesh(b.input);
        rd.push(Math.round(clock() - t0));
        const term = ran.report.termination;
        tried = term !== null && (term.reason === 'no-further-valid-reduction' || term.reason === 'budget-exhausted') ? term.candidatesTried : null;
      }
      const after = uptime();
      loadsSeen.push(after);
      const art = b.input.art.mask.alpha.reduce((n, a) => n + (a >= AUTO_THRESHOLD ? 1 : 0), 0);
      const src = b.input.source;
      lines.push(
        `| ${t.label} | ${src.points.length} (${src.hull}) / ${src.triangles.length / 3} | ${b.input.art.mask.width}x${b.input.art.mask.height} = ${b.input.art.mask.width * b.input.art.mask.height} (${art}) | ${tried ?? '—'} | ${mq.join(', ')} | ${rd.join(', ')} | ${tried === null || tried === 0 ? '—' : pyRound(rd[1] / tried, 1)} | ${loadText(before)} | ${loadText(after)} | ${quietLabel(before, after)} |`,
      );
      console.log(lines[lines.length - 1]);
    }
    sections.push({ title: 'timing', lines });
    if (args.timingOnly) {
      console.log(`${TIMING_OPEN}\n${lines.join('\n')}\n${TIMING_CLOSE}`);
      return;
    }
  }

  // ---- 2. synthetic -----------------------------------------------------
  if (args.cell === null) {
    const lines: string[] = [];
    lines.push('| case | policy | (b) source B+I / T | (c) result B+I / T | inserted | coverage / overshoot / undercut / boundary dev | loss (c) px (share) | region MQ_MAX_EDGE | termination | verdict |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    const cases: Array<{ name: string; mask: AlphaMask; spec: AutoSpec; policy: string }> = [];
    for (const c of AUTO_CASES) {
      cases.push({ name: c.name, mask: c.mask, spec: c.spec, policy: 'synthetic strict' });
      const perm = { ...permissiveSyntheticPolicy(c.spacing), ...(c.spec.regions === undefined ? {} : { regions: c.spec.regions }), budget: c.spec.budget };
      cases.push({ name: c.name, mask: c.mask, spec: perm, policy: 'synthetic permissive' });
    }
    for (const n of [SPECK_RULE_PX - 1, SPECK_RULE_PX, SPECK_RULE_PX + 1]) {
      cases.push({ name: `block + ${n} px speck`, mask: speckMask(n), spec: syntheticPolicy(8), policy: 'synthetic strict' });
      cases.push({ name: `block + ${n} px speck`, mask: speckMask(n), spec: permissiveSyntheticPolicy(8), policy: 'synthetic permissive' });
    }
    cases.push({ name: 'two pieces (400, 256 px)', mask: TWO_PIECES_MASK, spec: permissiveSyntheticPolicy(8), policy: 'synthetic permissive' });
    for (const c of cases) {
      const g = geometryRow(c.name, c.mask, c.spec, null, null, clock);
      const rg = (c.spec.regions ?? [])[0];
      lines.push(
        `| ${c.name} | ${c.policy} | ${shortCounts(g.source)} | ${shortCounts(g.result)} | ${g.inserted ?? '—'} | ${fitCells(g.rows)} | ${lossCell(g.lossResult)} | ${rg === undefined ? '—' : residualCell(g.rows, 'MQ_MAX_EDGE', rg.name)} | ${g.termination.slice(0, 160).replace(/\|/g, '/')} | ${verdictText(g.verdict)}${g.verdict.kind === 'refused' ? `: ${g.verdict.detail.slice(0, 140).replace(/\|/g, '/')}` : ''} |`,
      );
    }
    sections.push({ title: 'synthetic', lines });
  }

  // ---- 3 & 4. examples --------------------------------------------------
  const results: PartResult[] = [];
  const policies: Array<['strict' | 'permissive', (s: number) => AutoSpec]> = [
    ['strict', (sp) => withPolicyMotion(examplePolicy(sp))],
    ['permissive', (sp) => withPolicyMotion(permissivePolicy(sp))],
  ];
  const cell = args.cell;
  for (const [key, ex] of examples) {
    const meshes = ex.raw.meshes as { [k: string]: { [k: string]: Json } };
    for (const [policy, make] of policies) {
      if (cell !== null && cell.policy !== policy) continue;
      for (const part of Object.keys(meshes)) {
        if (cell !== null && cell.part !== part) continue;
        const { mask, ox, oy } = partMask(ex, part);
        const spec = make(spacingOf(meshes[part]));
        const load = uptime();
        loadsSeen.push(load);
        const g = geometryRow(part, mask, spec, weighting(ex, part, ox, oy), trackedCounts(ex, part), clock, reducerFor(join(args.work, 'reduce')));
        remember(g);
        console.log(`${key}/${part} ${policy}: ${verdictText(g.verdict)} ${g.termination.slice(0, 100)} (${Math.round(g.ms ?? 0)} ms)`);
        let alone: Built | null = null;
        if (args.builds && g.verdict.kind === 'accepted') {
          alone = rigAndCheck(ex, switched(ex.raw, part, spec), join(args.work, `${key}-${policy}-${part}`), part);
          if (alone.bars !== null) holdToDirect(alone.rig, part, g);
        }
        results.push({ example: key, part, policy, region: 'none', regionSpec: null, g, alone, load });
      }
    }
    // the region condition: the skirt (bottomwear), the circle testRegion places
    if ('bottomwear' in meshes && cell === null) {
      const part = 'bottomwear';
      const { mask, ox, oy, box, img } = partMask(ex, part);
      const t = testRegion(ex.cfg, part, placedMask(box.x, box.y, img), box);
      if (typeof t === 'string') {
        console.log(`${key}/${part}: the region rule passes over it: ${t}`);
      } else {
        const withBone = withRegionBone(ex.raw, t);
        const order = rigBasisOf(withBone, ex);
        const grid = spacingOf(meshes[part]);
        const region = matrixRegion(t, grid);
        for (const [policy, make] of policies) {
          const spec = { ...make(grid), regions: [region] };
          const load = uptime();
          loadsSeen.push(load);
          const g = geometryRow(part, mask, spec, weighting(ex, part, ox, oy, order), trackedCounts(ex, part), clock, reducerFor(join(args.work, 'reduce')));
          remember(g);
          console.log(`${key}/${part} ${policy} + region: ${verdictText(g.verdict)} ${g.termination.slice(0, 100)} (${Math.round(g.ms ?? 0)} ms)`);
          let alone: Built | null = null;
          if (args.builds && g.verdict.kind === 'accepted') {
            alone = rigAndCheck(ex, switched(withBone, part, spec), join(args.work, `${key}-${policy}-region-${part}`), part);
            if (alone.bars !== null) holdToDirect(alone.rig, part, g);
          }
          results.push({ example: key, part, policy, region: 'declared', regionSpec: regionText(region), g, alone, load });
        }
      }
    }
  }

  // every accepted part of a policy switched at once, per example
  const together: string[] = [];
  if (args.builds && cell === null) {
    together.push('| example | policy | parts switched | bars passed (of 9) | failing | `TEXTURE_STRETCH` severity, tracked -> switched | worst slot |');
    together.push('|---|---|---|---|---|---|---|');
    for (const [key, ex] of examples) {
      for (const [policy] of policies) {
        const acc = results.filter((r) => r.example === key && r.policy === policy && r.region === 'none' && r.g.verdict.kind === 'accepted' && r.alone?.motion?.verdict !== 'refused');
        if (acc.length === 0) {
          together.push(`| ${key} | ${policy} | none accepted | — | — | — | — |`);
          continue;
        }
        let raw = ex.raw;
        for (const r of acc) raw = switched(raw, r.part, specOf(policy, ex.raw, r.part));
        const b = rigAndCheck(ex, raw, join(args.work, `${key}-${policy}-all`), acc[0].part);
        const worst = ((b.check?.TEXTURE_STRETCH as { worst?: { slot: string } } | undefined)?.worst?.slot) ?? '—';
        together.push(
          `| ${key} | ${policy} | ${acc.map((r) => r.part).join(', ')} | ${b.bars === null ? b.detail : b.bars.passed} | ${b.bars === null ? '—' : b.bars.failing.join(', ') || 'none'} | ${num((ex.check.TEXTURE_STRETCH as { severity: number }).severity)} -> ${num(b.overall)} | ${worst} |`,
        );
        console.log(together[together.length - 1]);
      }
    }
  }

  // ---- 5. #115 on sample/sleeves -----------------------------------------
  const sep: string[] = [];
  const sample = examples.get('reference-sample');
  if (args.builds && sample !== undefined && cell === null) {
    const meshes = sample.raw.meshes as { [k: string]: { [k: string]: Json } };
    const grid = spacingOf(meshes.sleeves);
    const strict = examplePolicy(grid);
    const variants: Array<{ label: string; raw: { [k: string]: Json } }> = [
      { label: 'tracked lattice (alpha above 8, grid, 0.03 floor)', raw: sample.raw },
      { label: 'auto, strict policy as stated (alpha >= 1, tolerance 1, reduced, minWeight 0)', raw: switched(sample.raw, 'sleeves', strict) },
      { label: 'auto source unreduced (budget 0), alpha >= 1, tolerance 1, minWeight 0', raw: switched(sample.raw, 'sleeves', { ...strict, budget: { maxCandidates: 0 } }) },
      { label: 'auto source unreduced, alpha >= 1, tolerance 1, minWeight 0.03', raw: switched(sample.raw, 'sleeves', { ...strict, budget: { maxCandidates: 0 }, influences: { maxInfluences: 4, minWeight: 0.03 } }) },
      { label: 'auto source unreduced, alpha >= 1, tolerance 0.5, minWeight 0.03', raw: switched(sample.raw, 'sleeves', { ...strict, source: { ...strict.source, tolerance: 0.5 }, budget: { maxCandidates: 0 }, influences: { maxInfluences: 4, minWeight: 0.03 } }) },
      {
        label: 'contour mode: alpha above 8, tolerance 1, margin 1, spacing = grid, stray 4 (its weights: 0.03 floor)',
        raw: (() => {
          const c = JSON.parse(JSON.stringify(sample.raw)) as { [k: string]: Json };
          const m = (c.meshes as { [k: string]: { [k: string]: Json } }).sleeves;
          (c.meshes as { [k: string]: Json }).sleeves = { contour: { tolerance: 1, margin: 1, spacing: grid, stray: SPECK_RULE_PX }, r: m.r, segments: m.segments };
          return c;
        })(),
      },
      {
        label: 'contour mode: alpha above 8, tolerance 0.5, margin 1, spacing = grid, stray 4',
        raw: (() => {
          const c = JSON.parse(JSON.stringify(sample.raw)) as { [k: string]: Json };
          const m = (c.meshes as { [k: string]: { [k: string]: Json } }).sleeves;
          (c.meshes as { [k: string]: Json }).sleeves = { contour: { tolerance: 0.5, margin: 1, spacing: grid, stray: SPECK_RULE_PX }, r: m.r, segments: m.segments };
          return c;
        })(),
      },
    ];
    sep.push('| variant (sample, `sleeves` switched alone) | sleeves V (hull) | `TEXTURE_STRETCH` severity (sleeves) | worst | worst edge rest length (px) | check bars passed (of 9) |');
    sep.push('|---|---|---|---|---|---|');
    variants.forEach((v, k) => {
      const b = rigAndCheck(sample, v.raw, join(args.work, `sample-115-${k}`), 'sleeves');
      let counts = '—';
      let edge = '—';
      if (b.bars !== null) {
        const rows = JSON.parse(readFileSync(join(b.rig, 'mesh_report.json'), 'utf8')) as MeshReport[];
        const row = rows.find((r) => r.part === 'sleeves');
        if (row !== undefined) counts = `${row.vertices} (${row.hull})`;
        edge = worstEdgeLength(b.rig, b.stretch?.at ?? '');
      }
      sep.push(`| ${v.label} | ${counts} | ${b.stretch === null ? b.detail || '—' : num(b.stretch.severity)} | ${b.stretch?.at ?? '—'} | ${edge} | ${b.bars === null ? '—' : b.bars.passed} |`);
      console.log(sep[sep.length - 1]);
    });
  }

  // ---- the document ------------------------------------------------------
  if (args.timing && args.timingFrom !== null) {
    // Timing sections taken elsewhere (`--timing-only` on another machine), comma-separated files, each read back
    // between its markers as it printed them and set one after another, each carrying its own machine and version line.
    const lines: string[] = [];
    for (const file of args.timingFrom.split(',')) {
      const text = readFileSync(resolve(file), 'utf8');
      const a = text.indexOf(TIMING_OPEN);
      const b = text.indexOf(TIMING_CLOSE);
      if (a < 0 || b < a) throw new Error(`auto_matrix: ${file} holds no timing section between ${TIMING_OPEN} and ${TIMING_CLOSE}`);
      if (lines.length > 0) lines.push('');
      lines.push(...text.slice(a + TIMING_OPEN.length, b).trim().split('\n'));
    }
    sections.push({ title: 'timing', lines });
  }
  const cost = costLine(COST, clock() - started);
  console.log(cost);
  const doc = renderDocument({ rigcVersion, head, dirty, keys, pinned, machine: args.machine, cellCap: args.cellCap, sections, results, together, sep, loadsSeen, builds: args.builds, timing: args.timing, cost, cell: cell === null ? null : `${cell.part}:${cell.policy}` });
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, doc);
  if (args.printDoc) console.log(`${DOC_OPEN}\n${doc}\n${DOC_CLOSE}`);
  writeFileSync(join(args.work, 'matrix-rows.json'), `${JSON.stringify(results.map((r) => ({ example: r.example, part: r.part, policy: r.policy, region: r.region, verdict: verdictText(r.g.verdict), source: r.g.source, result: r.g.result, tracked: r.g.tracked, termination: r.g.termination })), null, 1)}\n`);
  console.log(`wrote ${args.out}`);
}

function specOf(policy: 'strict' | 'permissive', raw: { [k: string]: Json }, part: string): AutoSpec {
  const m = (raw.meshes as { [k: string]: { [k: string]: Json } })[part];
  const spacing = spacingOf(m);
  return withPolicyMotion(policy === 'strict' ? examplePolicy(spacing) : permissivePolicy(spacing));
}

/** The rest length, px, of the edge a `TEXTURE_STRETCH` location names ("edge a-b"), off the rig's sleeves attachment UVs. */
function worstEdgeLength(rig: string, at: string): string {
  const m = /edge (\d+)-(\d+)/.exec(at);
  if (m === null) return '—';
  const r = JSON.parse(readFileSync(join(rig, 'rig.json'), 'utf8')) as Example['trackedRig'];
  const att = r.skins.default.sleeves?.sleeves;
  if (att?.uvs === undefined || att.width === undefined || att.height === undefined) return '—';
  const a = Number(m[1]);
  const b = Number(m[2]);
  const dx = (att.uvs[2 * a] - att.uvs[2 * b]) * att.width;
  const dy = (att.uvs[2 * a + 1] - att.uvs[2 * b + 1]) * att.height;
  return `${pyRound(Math.hypot(dx, dy), 3)}`;
}

function loadText(uptimeLine: string): string {
  const m = /load averages?:\s*(.*)$/.exec(uptimeLine);
  return m === null ? 'unread' : m[1].trim();
}

function shortCounts(c: Counts | null): string {
  return c === null ? '—' : `${c.boundary}+${c.interior} / ${c.triangles}`;
}

function fitCells(rows: readonly MeasureRow[]): string {
  return `${residualCell(rows, 'MQ_COVERAGE')} / ${residualCell(rows, 'MQ_OVERSHOOT')} / ${residualCell(rows, 'MQ_UNDERCUT')} / ${residualCell(rows, 'MQ_BOUNDARY_DEVIATION')}`;
}

function lossCell(l: { artPixels: number; uncovered: number; share: number } | null): string {
  return l === null ? '—' : `${l.uncovered} of ${l.artPixels} (${pyRound(l.share, 6)})`;
}

interface DocInput {
  rigcVersion: string;
  head: string;
  dirty: boolean;
  keys: string[];
  /** The rig-c/examples commit `scripts/fetch-examples.sh` pins. */
  pinned: string;
  /** `--machine`'s label (never an address). */
  machine: string;
  /** `--cell-cap`'s seconds, or null. */
  cellCap: number | null;
  sections: Section[];
  results: PartResult[];
  together: string[];
  sep: string[];
  loadsSeen: string[];
  builds: boolean;
  timing: boolean;
  /** {@link costLine} of this run, taken just before the document is rendered. */
  cost: string;
  /** `--cell`'s value, or null for the whole matrix. */
  cell: string | null;
}

/** The document, every figure from the run; nothing typed. */
export function renderDocument(d: DocInput): string {
  const L: string[] = [];
  const loads = d.loadsSeen.map(oneMinuteLoad).filter((v): v is number => v !== null);
  const strictOf = examplePolicy(0);
  const permOf = permissivePolicy(0);
  L.push('# The automatic mesh mode — evaluation matrix (issue #126, items 4-5)');
  L.push('');
  L.push(`Generated by \`bun tools/auto_matrix.ts\`; every figure below is the tool's, none typed. rig-c ${d.rigcVersion}; rig-parts commit ${d.head === '' ? 'unread (no git checkout and no --commit)' : d.head}${d.dirty ? ' with uncommitted changes to tracked files' : ''}; examples ${d.keys.join(', ')} from spine-parts-examples at ${d.pinned} (\`bun run fetch-examples\`); machine ${d.machine}; per-cell cap ${d.cellCap === null ? 'none' : `${d.cellCap} s (any single reduction, and any single build's rigc calls together; a cell past it is recorded as stopped)`}. The geometry columns come from this tool's own call to \`reduceMesh\` (no pose); the motion column is the rig stage's motion gate (\`src/automotion.ts\`, rig-c's \`compareMeshesInMotion\` on the idle) in the full build of a part accepted on geometry, and \`check\` is the whole rig's.`);
  L.push('');
  L.push(`Machine load (one-minute average, \`uptime\`) over the ${loads.length} readings this run took: ${loads.length === 0 ? 'none read' : `${pyRound(Math.min(...loads), 2)} to ${pyRound(Math.max(...loads), 2)}`}. Wall times are this machine's and are not a claim about another.`);
  L.push('');
  L.push(d.cost);
  L.push('');
  if (d.cell !== null) {
    L.push(`Single cell (\`--cell ${d.cell}\`): only that row of each named example ran; the synthetic rows, the region condition, the every-part build and the #115 variants were not run.`);
    L.push('');
  }
  L.push('## The two policies, stated before any part was measured (`fixtures/automesh.ts`)');
  L.push('');
  L.push('| | strict (`examplePolicy`, #131, unchanged) | permissive (`permissivePolicy`) |');
  L.push('|---|---|---|');
  L.push(`| source | tolerance ${strictOf.source.tolerance}, margin ${strictOf.source.margin}, spacing = the part's tracked spacing, no \`stray\` | the same, \`stray\` ${SPECK_RULE_PX} (the speck rule: an island other than the largest with ${SPECK_RULE_PX} px or fewer at alpha >= 1; a larger one is a piece and refuses the part) |`);
  L.push(`| minCoverage (source and result) | ${strictOf.targets.artFit.minCoverage} | ${PERMISSIVE_MIN_COVERAGE} (rig-c's \`CONTOUR_MIN_COVERAGE\`) |`);
  L.push(`| maxOvershoot | ${strictOf.targets.artFit.maxOvershoot} | ${strictOf.targets.artFit.maxOvershoot} |`);
  L.push(`| maxUndercut | ${strictOf.targets.artFit.maxUndercut} | ${String(permOf.targets.artFit.maxUndercut)} (declared absent: rig-c measures it and reports the row \`undeclared\`, \`not bounded\` in the cells below; it gates nothing, AM40) |`);
  L.push(`| maxBoundaryDeviation | ${strictOf.targets.maxBoundaryDeviation} | ${strictOf.targets.maxBoundaryDeviation} |`);
  L.push(`| influences | cap ${strictOf.influences.maxInfluences}, minWeight ${strictOf.influences.minWeight} | the same |`);
  const motionOf = policyMotion(strictOf);
  L.push(`| motion (\`withPolicyMotion\`, fixtures/automotion.ts) | maxLocalDeformation ${motionOf.maxLocalDeformation} rig px (= maxBoundaryDeviation); stretch not gated; folds refused | the same |`);
  L.push(`| budget.maxCandidates | ${strictOf.budget.maxCandidates} | ${strictOf.budget.maxCandidates} |`);
  L.push(`| minArtSamples | ${strictOf.minArtSamples} | ${strictOf.minArtSamples} |`);
  L.push('');
  L.push('Both are measured against the original padded image at alpha >= 1: rig-c reads the mask with every speck in it, and the loss columns count art pixels at alpha >= 1 with no triangle over their centre (`lossAgainstOriginal`). The region condition adds the declared region of `matrixRegion` (fixtures/automesh.ts) on the circle `tools/real_compare.ts`\'s `testRegion` rule places: L0 = grid / 2, transition = band = radius, grade = (grid - L0) / transition, one art sample; its control bone `test_region` is added to the config, parented to the part\'s first segment bone, and nothing keys it.');
  L.push('');
  L.push('Counts are `boundary+interior / triangles / bindings`: (a) the tracked mesh (`rig.json` of the tracked build), (b) the automatic mode\'s unreduced source after its own gate (rig-c\'s `sourceCounts`), (c) the result. (a) -> (b) is the source\'s choice; (b) -> (c) is the reducer\'s.');
  L.push('');
  const timing = d.sections.find((s) => s.title === 'timing');
  L.push('## Timing (condition 4)');
  L.push('');
  if (!d.timing || timing === undefined) L.push('Not run (`--no-timing`).');
  else {
    L.push('Each table below opens with the machine and the rig-c version it was taken on. ' + 'The inputs of the #131 timing rows: strict policy, weighted as the rig stage weights them (the synthetic strip unweighted, under its own synthetic policy). Granularity: a wrapper timer around rig-c\'s exported `measureMeshQuality` (the source, one measurement as every reduction step makes one) and around `reduceMesh`; nothing inside rig-c is instrumented. A row is `quiet` only when the one-minute load is under 2 before and after it. The #131 figures (demo `bottomwear` 81-141 s over 1101 candidates) were read with load averages 10-90 and are loaded figures.');
    L.push('');
    L.push(...timing.lines);
  }
  L.push('');
  L.push('## Synthetic fixtures (`fixtures/automesh.ts`, geometry only)');
  L.push('');
  L.push(...(d.sections.find((s) => s.title === 'synthetic')?.lines ?? []));
  L.push('');
  for (const policy of ['strict', 'permissive'] as const) {
    L.push(`## Public examples, ${policy} policy, each part switched alone`);
    L.push('');
    L.push('| example / part | region | (a) tracked | (b) source | (c) result | removed / inserted | mean infl. (a) -> (c) | coverage / overshoot / undercut / boundary dev (alpha >= 1) | loss (b) px | loss (c) px (share) | specks left out (px) | termination | verdict (geometry, then the motion gate) | motion gate: MQ_LOCAL_DEFORMATION (full build) | alone: bars (of 9), failing | `TEXTURE_STRETCH` (part), tracked -> switched | call ms (load) |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of d.results.filter((x) => x.policy === policy)) {
      const g = r.g;
      const tr = stretchOfTracked(r);
      const alone = r.alone === null ? (r.g.verdict.kind === 'accepted' ? (d.builds ? '—' : 'not built (--no-builds)') : 'not built (not accepted)') : r.alone.bars === null ? r.alone.detail : `${r.alone.bars.passed}${r.alone.bars.failing.length > 0 ? `, ${r.alone.bars.failing.join(', ')}` : ''}`;
      const stretch = r.alone?.stretch === null || r.alone === null ? '—' : `${num(tr)} -> ${num(r.alone.stretch.severity)}`;
      const motionRefused = r.alone?.motion?.verdict === 'refused';
      const verdict = g.verdict.kind === 'refused' ? `refused \`${g.verdict.code}\`: ${g.verdict.detail.slice(0, 180).replace(/\|/g, '/')}` : motionRefused ? 'refused (motion)' : verdictText(g.verdict);
      const motion = r.alone?.motion === null || r.alone === null ? (g.verdict.kind === 'accepted' ? 'not read' : '—') : `${r.alone.motion.verdict}: ${r.alone.motion.text.replace(/\|/g, '/')}`;
      L.push(
        `| ${r.example} / ${r.part} | ${r.region === 'none' ? 'none' : `declared: ${r.regionSpec}; MQ_MAX_EDGE ${residualCell(g.rows, 'MQ_MAX_EDGE', 'hem')}, MQ_TRANSITION ${residualCell(g.rows, 'MQ_TRANSITION', 'hem')}; bound to \`test_region\`: ${g.regionBound === null ? '—' : `${g.regionBound.vertices} vertices, ${g.regionBound.bindings} bindings`}`} | ${countsCell(g.tracked)} | ${countsCell(g.source)} | ${countsCell(g.result)} | ${g.removed ?? '—'} / ${g.inserted ?? '—'} | ${g.tracked?.meanInfluences ?? '—'} -> ${g.result?.meanInfluences ?? '—'} | ${fitCells(g.rows)} | ${g.lossSource === null ? '—' : g.lossSource.uncovered} | ${lossCell(g.lossResult)} | ${g.strayIslands === null ? '—' : `${g.strayIslands} (${g.strayPixels})`} | ${g.termination.slice(0, 200).replace(/\|/g, '/')} | ${verdict} | ${motion} | ${alone} | ${stretch} | ${g.ms === null ? '—' : Math.round(g.ms)} (${pyRound(oneMinuteLoad(r.load) ?? -1, 2)}) |`,
      );
    }
    const mine = d.results.filter((x) => x.policy === policy && x.region === 'none');
    const acc = mine.filter((x) => x.g.verdict.kind === 'accepted');
    const kept = acc.filter((x) => x.alone?.motion?.verdict === 'pass');
    const motionOut = acc.filter((x) => x.alone?.motion?.verdict === 'refused');
    const blocked = d.results.filter((x) => x.policy === policy && x.g.verdict.kind === 'blocked');
    const stopped = d.results.filter((x) => x.policy === policy && (x.g.verdict.kind === 'stopped' || (x.alone?.detail ?? '').startsWith('stopped at')));
    const sumV = (f: (x: PartResult) => Counts | null): number => acc.reduce((n, x) => n + ((f(x)?.boundary ?? 0) + (f(x)?.interior ?? 0)), 0);
    L.push('');
    L.push(
      `${policy}: ${acc.length} of ${mine.length} parts accepted with no region, ${mine.length - acc.length} ${stopped.length > 0 ? `refused or stopped (${stopped.length} row(s) stopped at the cap: ${stopped.map((x) => `${x.example}/${x.part}${x.region === 'none' ? '' : ' + region'}`).join(', ')})` : 'refused'}; over the accepted parts (a) ${sumV((x) => x.g.tracked)} -> (b) ${sumV((x) => x.g.source)} -> (c) ${sumV((x) => x.g.result)} vertices; interior vertices in the results: ${acc.reduce((n, x) => n + (x.g.result?.interior ?? 0), 0)}; rows ${BLOCKED_LABEL}: ${blocked.length}. Of the ${acc.length} accepted on geometry, the motion gate kept ${kept.length} in a full build and refused ${motionOut.length}${motionOut.length > 0 ? ` (${motionOut.map((x) => `${x.example}/${x.part}`).join(', ')})` : ''}.`,
    );
    L.push('');
  }
  L.push('## Every accepted part of a policy switched at once (full `rig` + `check`)');
  L.push('');
  if (!d.builds) L.push('Not run (`--no-builds`).');
  else if (d.cell !== null) L.push('Not run (`--cell`).');
  else L.push(...d.together);
  L.push('');
  L.push('## #115 on `sample/sleeves`: the alpha threshold against the weighting rule');
  L.push('');
  if (d.sep.length === 0) L.push('Not run (needs the sample example and builds).');
  else {
    L.push('Each variant switches `sleeves` alone; the severity is `check`\'s `TEXTURE_STRETCH` for that slot (ceiling 1.926544). The two "0.03 floor" auto rows and the contour rows share the weighting rule (`localInfluences` with cap 4 and the 0.03 floor; the auto rows round with `roundShares`, the contour rows as the lattice rounds, a difference of at most one 5-place unit on the closing entry); what separates them is the outline\'s alpha threshold (alpha >= 1 against alpha above 8) and the vertices that outline produces.');
    L.push('');
    L.push(...d.sep);
  }
  L.push('');
  L.push(...rerunSection(d));
  return `${L.join('\n')}`;
}

/** The commit `scripts/fetch-examples.sh` pins: one reader, `scripts/example_inputs.ts`'s, which the fetch's hash check also uses. */
export { pinnedExamplesCommit };

/**
 * "Re-running this evidence": the inputs, the policies by name and number, the
 * commands with their caps, and where every report lands, written from the same
 * values the run used, so a later session reruns it unchanged.
 */
export function rerunSection(d: Pick<DocInput, 'rigcVersion' | 'pinned' | 'keys'>): string[] {
  const strictOf = examplePolicy(0);
  const permOf = permissivePolicy(0);
  const motionOf = policyMotion(strictOf);
  return [
    '## Re-running this evidence',
    '',
    `Inputs: the public examples ${d.keys.join(', ')} of https://github.com/firejune/spine-parts-examples at commit ${d.pinned} (the pin in \`scripts/fetch-examples.sh\`; \`bun run fetch-examples\` copies them into the gitignored \`examples/<key>/inputs\`), each with its tracked \`examples/<key>/config.json\`; rig-c ${d.rigcVersion} as \`bun install --frozen-lockfile\` installs it from \`bun.lock\`. No other input is read.`,
    '',
    'Policies (`fixtures/automesh.ts`, `fixtures/automotion.ts`), stated before any part was measured and not tuned per part:',
    '',
    `- **strict** = \`withPolicyMotion(examplePolicy(spacing))\`: tolerance ${strictOf.source.tolerance}, margin ${strictOf.source.margin}, spacing = the part's tracked spacing, no stray; minCoverage ${strictOf.targets.artFit.minCoverage}, maxOvershoot ${strictOf.targets.artFit.maxOvershoot}, maxUndercut ${strictOf.targets.artFit.maxUndercut} (source and result); maxBoundaryDeviation ${strictOf.targets.maxBoundaryDeviation}; influences cap ${strictOf.influences.maxInfluences}, minWeight ${strictOf.influences.minWeight}; budget ${strictOf.budget.maxCandidates}; minArtSamples ${strictOf.minArtSamples}; motion maxLocalDeformation ${motionOf.maxLocalDeformation}.`,
    `- **permissive** = \`withPolicyMotion(permissivePolicy(spacing))\`: the strict policy with exactly three changes — stray ${SPECK_RULE_PX}, minCoverage ${PERMISSIVE_MIN_COVERAGE}, maxUndercut ${String(permOf.targets.artFit.maxUndercut)} (declared absent: measured and reported \`undeclared\`, not bounded; selftest \`AM40\`).`,
    '- **region condition** = either policy plus `matrixRegion` on the circle `tools/real_compare.ts`\'s `testRegion` places on `bottomwear`, its control bone `test_region` added to the config.',
    '',
    'Commands, from the repository root (the caps are the ones this document was generated under: 600 s for any single reduction or build, 2700 s for the whole matrix):',
    '',
    '```sh',
    'bun install --frozen-lockfile',
    'bun run fetch-examples',
    'timeout 2700 bun tools/auto_matrix.ts --work <scratch dir> --cell-cap 600 --machine <label> [--commit <id>]',
    'timeout 600 bun tools/auto_motion_survey.ts > docs/evidence/auto-motion-survey.md',
    '```',
    '',
    'Where the reports land: this document (`--out`, default `docs/evidence/auto-mesh-matrix.md`; `--print-doc` also prints it between markers for a machine whose files do not come back); every cell\'s config, `rig/` (with `mesh_report.json` and the motion report) and `check/check.json` under `<scratch dir>/<example>-<policy>-<part>` (`-region-` for the region condition, `-all` for every accepted part at once, `sample-115-<n>` for the #115 variants), the tracked builds under `<scratch dir>/base-<example>`, and one row per cell in `<scratch dir>/matrix-rows.json`. The motion survey prints Markdown to stdout and writes nothing; `docs/evidence/auto-motion-survey.md` is that output, byte for byte. A machine without GNU `timeout` (macOS) runs the same commands without it and keeps to the caps by `--cell-cap` alone.',
    '',
  ];
}

function stretchOfTracked(r: PartResult): number | null {
  return TRACKED_STRETCH.get(`${r.example}/${r.part}`) ?? null;
}

/** The tracked build's per-slot severity, filled once per example before the document is rendered. */
const TRACKED_STRETCH = new Map<string, number>();

export function rememberTracked(key: string, check: Record<string, unknown>): void {
  const ts = check.TEXTURE_STRETCH as { per_mesh?: Array<{ slot: string; severity: number }> } | undefined;
  for (const m of ts?.per_mesh ?? []) TRACKED_STRETCH.set(`${key}/${m.slot}`, m.severity);
}

if (import.meta.main) main(process.argv.slice(2));
