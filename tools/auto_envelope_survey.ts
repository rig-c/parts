#!/usr/bin/env bun
/**
 * Issue #165, Stage A: the skinning envelope's reference bone, measured on the public parts before any mechanism.
 * One command writes the evidence page and its picture:
 *
 *     bun run fetch-examples          # once: examples/*\/inputs
 *     bun tools/auto_envelope_survey.ts --picture docs/evidence/auto-envelope-reference.png > docs/evidence/auto-envelope-reference.md
 *
 * In Stage A, `src/autoenvelope.ts` derived the envelope `targets.skinning` carries with the slot's bone as the
 * reference, and a bound bone not below it stopped the part (`ENVELOPE_BONE_NOT_BELOW_REFERENCE`): no target was
 * sent and the veto was not applied. The derivation under test lives here, not under `src/`: {@link lcaEnvelope} takes the reference to be the
 * lowest common ancestor of the slot's bone and every bound bone ({@link lowestCommonAncestor}) and hands the slot's
 * bone to `deriveEnvelope` as one more bound bone, so it enters with its own range when it is not the reference.
 * `deriveEnvelope` already takes the reference as a parameter; nothing under `src/` was changed by Stage A.
 *
 * Since Stage B (issue #165) the rig stage itself derives the envelope against the lowest common ancestor
 * (`slotEnvelope` in `src/autoenvelope.ts`, the {@link lowestCommonAncestor} measured here, moved there), so the stage's
 * `skinning_residual` row on the three parts whose reference moves is no longer the slot's-bone derivation, and this
 * tool's reproduction check ({@link reproduces}) refuses those three by design. The page it wrote,
 * `docs/evidence/auto-envelope-reference.md`, is Stage A's record at the commit that added it; "today" there is the
 * stage before Stage B.
 *
 * The parts are the Stage B survey's eight (`tools/auto_motion_survey.ts`), each switched alone to `auto` in its
 * example's own config under the `residual` configuration (`STAGE_B_CONFIGS`: the policy plus
 * `motion.residual.maxResidual` 1). Per part, each in a process of its own under the cap:
 *
 * - **today** — the real rig stage as it stood in Stage A (`motionCell`): the slot's bone as reference, the target sent
 *   or not. Since Stage B the stage sends the LCA envelope itself (see above).
 *   The tool re-derives the stage's envelope from its own reading of the rig ({@link basisOf}) and refuses to go on
 *   when that does not reproduce the row the stage wrote (`skinning_residual`) — so the LCA derivation below reads the
 *   same rig the stage read.
 * - **lca** — the same stage with the LCA envelope sent: the reductions go through a reducer that replaces the part's
 *   `targets.skinning` with it (`withSkinning`), and nothing else. Run only when the LCA is not the slot's bone; where
 *   it is, the two derivations are compared byte for byte and the reduction input is today's.
 * - **veto** — `tools/veto_tally.ts` on the LCA run's full input: the steps the residual refused.
 *
 * The same-bound question ({@link sameBound}) is read on every written mesh whose residual was measured: the residual
 * (drawing px) against the largest posed displacement rig-c's `compareMeshesInMotion` read on the same mesh
 * (`MQ_LOCAL_DEFORMATION`, rig px; one drawing px is one rig px here — no bone scale, page scale 1). A residual below
 * the displacement is a counter-example and the page says so with the numbers.
 *
 * Output: Markdown on standard output; each cell's wall time on standard error. `--json` prints each part's result as
 * one line (`ENVELOPE_SURVEY <json>`) instead, and `--from <file>…` renders the page from such lines — so the parts
 * can run as separate jobs and the page be written where the inputs are. Exit 1 when the inputs are missing, a cell
 * did not finish, or the tool's derivation does not reproduce the stage's; 0 otherwise — a counter-example is a result.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { MeshReductionInput, SkinningEnvelopeBone } from '@rig-c/core/mesh';
import { Plate, type RGBA } from '@rig-c/core/plate';
import { type Reducer, type ReductionResult, runReduction } from '../src/automesh.ts';
import { deriveEnvelope, type EnvelopeBasis, type EnvelopeDerivation, type EnvelopeStop, lowestCommonAncestor, residualRow, withSkinning } from '../src/autoenvelope.ts';
import { findRigc } from '../src/check.ts';
import { loadConfig } from '../src/config.ts';
import { computeExactFrameTransforms, cropToSpineY } from '../src/coords.ts';
import { PartsError } from '../src/errors.ts';
import { readParts } from '../src/parts.ts';
import { readPng, type Raster } from '../src/raster/index.ts';
import { buildRig, PAD } from '../src/rig.ts';
import { examplePolicy } from '../fixtures/automesh.ts';
import { withPolicyMotion } from '../fixtures/automotion.ts';
import { assembleExample, extraOf, installedRigc, missingInputs, type MotionCell, motionCell, pinnedInputs, rowOf, trackedSpacing, verdictOf, withExtra } from './auto_motion_survey.ts';
import { type VetoTally, vetoTally } from './veto_tally.ts';

const ROOT = resolve(import.meta.dir, '..');

/** The Stage B survey's eight parts, in its order. */
export const PARTS: ReadonlyArray<readonly [string, string]> = [
  ['reference-demo', 'neck'],
  ['reference-demo', 'bottomwear'],
  ['reference-sample', 'neck'],
  ['reference-sample', 'sleeves'],
  ['reference-sample', 'topwear'],
  ['reference-sample', 'bottomwear'],
  ['scarf', 'hair_front'],
  ['scarf', 'handwear_l'],
];

/** The configuration every cell runs: the Stage B survey's `residual`. */
export const CONFIG = 'residual';

/** Its bound, read off the configuration rather than typed. */
export function maxResidualOf(): number {
  const m = (extraOf(CONFIG).motion as { residual?: { maxResidual?: unknown } } | undefined)?.residual?.maxResidual;
  if (typeof m !== 'number') throw new Error(`auto_envelope_survey: STAGE_B_CONFIGS "${CONFIG}" carries no motion.residual.maxResidual`);
  return m;
}

// ---------------------------------------------------------------------------
// 1. the reference
// ---------------------------------------------------------------------------

// The reference's rule moved into the package in Stage B (src/autoenvelope.ts: `lowestCommonAncestor`, the function this
// tool measured, unchanged); the tool reads it from there and re-exports it for the selftest's EV controls.
export { ancestry, lowestCommonAncestor, type TreeBone } from '../src/autoenvelope.ts';

/** The LCA derivation: the reference, the bones handed to `deriveEnvelope` (the bound bones and the slot's), and its result. */
export interface LcaDerivation {
  reference: string | null;
  handed: string[];
  derivation: EnvelopeDerivation;
}

/** {@link lowestCommonAncestor} as the reference, the slot's bone handed as one more bound bone (it is dropped when it is the reference). */
export function lcaEnvelope(basis: EnvelopeBasis, slot: string, bound: readonly string[], origin: readonly [number, number]): LcaDerivation {
  const handed = [...new Set([...bound, slot])].sort();
  const lca = lowestCommonAncestor(basis.bones, slot, bound);
  if ('stop' in lca) return { reference: null, handed, derivation: { stops: [lca.stop] } };
  return { reference: lca.reference, handed, derivation: deriveEnvelope(basis, lca.reference, handed, origin) };
}

// ---------------------------------------------------------------------------
// 2. the bound
// ---------------------------------------------------------------------------

/** The same-bound reading of one written mesh. */
export interface BoundReading {
  verdict: 'holds' | 'counter-example' | 'not measured';
  text: string;
}

/**
 * Whether the residual is still an upper bound of the posed displacement on one written mesh: `holds` when residual ≥
 * displacement, `counter-example` naming both numbers when it is below, `not measured` when either is missing or not
 * finite — never a pass.
 */
export function sameBound(residual: number | null, displacement: number | null): BoundReading {
  if (residual === null || displacement === null || !Number.isFinite(residual) || !Number.isFinite(displacement)) {
    return { verdict: 'not measured', text: `not measured (residual ${residual ?? 'none'}, displacement ${displacement ?? 'none'})` };
  }
  if (residual >= displacement) return { verdict: 'holds', text: `holds: residual ${residual} >= displacement ${displacement}` };
  return { verdict: 'counter-example', text: `counter-example: residual ${residual} < displacement ${displacement}` };
}

// ---------------------------------------------------------------------------
// 3. the rig the stage reads
// ---------------------------------------------------------------------------

/** The slot's bone of a mesh entry: its first segment's bone, as the rig stage writes it on the slot. */
export function slotBoneOf(segments: unknown): string {
  const first = Array.isArray(segments) ? (segments[0] as unknown) : undefined;
  const name = typeof first === 'string' ? first : Array.isArray(first) && typeof first[0] === 'string' ? first[0] : undefined;
  if (name === undefined) throw new Error(`auto_envelope_survey: a mesh entry's first segment names no bone (${JSON.stringify(first)})`);
  return name;
}

/** The part's padded origin in crop px (the drawing frame's (0, 0)), as the rig stage takes it. */
export function originOf(asm: string, part: string): [number, number] {
  const p = readParts(join(asm, 'parts.json')).parts.find((x) => x.name === part);
  if (p === undefined) throw new Error(`auto_envelope_survey: parts.json has no part "${part}"`);
  return [p.x - PAD, p.y - PAD];
}

/**
 * What `deriveEnvelope` reads, off the example's own build (its tracked config, every mesh in its tracked mode): the
 * rig's bones, each bone's setup joint in crop px (the rig stage's reading: x back across the root, y through the
 * one door), the idle as written, the constraints. Checked, not assumed, against the stage: {@link reproduces}.
 */
export function basisOf(key: string, asm: string): EnvelopeBasis {
  const cfg = loadConfig(join(ROOT, 'examples', key, 'config.json'));
  const partsFile = readParts(join(asm, 'parts.json'));
  const images = new Map<string, Raster>();
  for (const p of partsFile.parts) images.set(p.name, readPng(join(asm, 'parts', `${p.name}.png`)));
  const out = buildRig(cfg, partsFile, images);
  const [W, H] = partsFile.rig_size;
  const world = computeExactFrameTransforms(out.rig.bones);
  const joints = new Map<string, readonly [number, number]>();
  for (const b of out.rig.bones) {
    const m = world.get(b.name);
    if (m !== undefined) joints.set(b.name, [m.worldX + W / 2, cropToSpineY(m.worldY, H)] as const);
  }
  return { bones: out.rig.bones.map((b) => ({ name: b.name, ...(b.parent === undefined ? {} : { parent: b.parent }) })), joints, motion: out.motion, constraints: cfg.constraints ?? [] };
}

/** The bones a reduction input's source weights bind. */
export function boundOf(input: MeshReductionInput): string[] {
  return [...new Set((input.source.weights ?? []).flatMap((v) => v.map((e) => e.bone)))].sort();
}

/** Whether the tool's derivation with the slot's bone as reference is the row the stage wrote: the envelope when sent, the stops (bone and code) when not. */
export function reproduces(mine: EnvelopeDerivation, stage: { sent: boolean; envelope: SkinningEnvelopeBone[] | null; stops: EnvelopeStop[] } | undefined): boolean {
  if (stage === undefined) return false;
  if ('envelope' in mine) return stage.sent && JSON.stringify(mine.envelope.bones) === JSON.stringify(stage.envelope);
  return !stage.sent && JSON.stringify(mine.stops.map((s) => [s.bone, s.code])) === JSON.stringify(stage.stops.map((s) => [s.bone, s.code]));
}

// ---------------------------------------------------------------------------
// 4. one cell
// ---------------------------------------------------------------------------

/** One reduction the stage made: the input rig-c was handed and what came back. */
export interface Recorded {
  sent: MeshReductionInput;
  result: ReductionResult;
}

/** A reducer that hands the part's reductions through `inject` (null: unchanged) to `reduce` (rig-c's, through `runReduction`) and records every call. */
export function recorder(part: string, inject: ((input: MeshReductionInput) => MeshReductionInput) | null, reduce: Reducer = runReduction): { run: Reducer; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const run: Reducer = (object, given) => {
    const sent = inject !== null && object === `config.meshes.${part}.auto` ? inject(given) : given;
    const result = reduce(object, sent);
    calls.push({ sent, result });
    return result;
  };
  return { run, calls };
}

/** What one cell read: the stage's verdict and search, the written mesh and its counts, its residual and its posed displacement. */
export interface CellReading {
  verdict: string;
  /** The full run's accepted operations N, or null when the stage made no reduction. */
  steps: number | null;
  /** The written step: N for the full result, the replayed step, or null when nothing was written. */
  chosen: number | null;
  written: { hull: number; interior: number } | null;
  wallS: number;
  /** The largest MQ_LOCAL_DEFORMATION rig-c read on the written mesh over the whole idle (rig px), and where. */
  displacement: number | null;
  displacementAt: string;
  /** The written mesh's MQ_SKINNING_RESIDUAL as its own report reads it, under the envelope that run sent; null when none was sent. */
  residual: number | null;
  residualState: string;
  /** The written mesh, part-local drawing px, for the picture. */
  mesh: { points: Array<[number, number]>; triangles: number[] } | null;
  refusal: string | null;
}

/** The reduction that wrote the mesh: the replay of the chosen step, or the full run. */
function writtenRun(calls: readonly Recorded[], chosenReplay: number | null): Recorded | undefined {
  return calls.find((c) => (chosenReplay === null ? c.sent.stopAfterAccepted === undefined : c.sent.stopAfterAccepted === chosenReplay));
}

/** The cell's reading, off the stage's cell, its recorded reductions and the derivation it sent (null: none). */
export function readCell(c: MotionCell, calls: readonly Recorded[], sentWith: { reference: string; derivation: EnvelopeDerivation } | null, maxResidual: number): CellReading {
  const rp = c.written?.replay;
  const replayStep = rp === undefined ? null : rp.chosen_step;
  const full = calls.find((x) => x.sent.stopAfterAccepted === undefined);
  const fullReport = full !== undefined && !('code' in full.result) ? full.result.report : null;
  const steps = fullReport?.candidates[0]?.changes?.acceptedAt?.length ?? null;
  const w = c.written === undefined ? undefined : writtenRun(calls, replayStep);
  const wr = w === undefined || 'code' in w.result ? null : w.result;
  let displacement: number | null = null;
  let displacementAt = 'not measured';
  if (c.refusal === null && c.written !== undefined) {
    if (rp !== undefined) {
      const roles = 'selection' in rp ? [rp.selection, rp.held_out] : [];
      const read = roles.filter((x): x is NonNullable<typeof x> => x !== null && x !== undefined && x.value !== null);
      if (read.length > 0) {
        const worst = read.reduce((a, b) => ((b.value as number) > (a.value as number) ? b : a));
        displacement = worst.value;
        displacementAt = `${worst.frame ?? 'every frame'} (max of selection and held out)`;
      }
    } else {
      const row = rowOf(c.report, 'MQ_LOCAL_DEFORMATION');
      displacement = row?.value ?? null;
      displacementAt = row?.worst?.frame?.id ?? 'not measured';
    }
  }
  let residual: number | null = null;
  let residualState = 'not sent';
  if (sentWith !== null && 'envelope' in sentWith.derivation && wr !== null) {
    const m = residualRow(maxResidual, sentWith.reference, sentWith.derivation, wr.report).measured;
    residual = m?.value ?? null;
    residualState = m === null ? 'absent' : m.value === null ? `${m.state}: ${m.reason ?? ''}` : m.state;
  }
  const counts = c.written?.result.counts;
  return {
    verdict: verdictOf(c),
    steps,
    chosen: c.written === undefined ? null : replayStep ?? steps,
    written: counts === undefined ? null : { hull: counts.boundaryVertices, interior: counts.interiorVertices },
    wallS: Math.round(c.wallMs / 100) / 10,
    displacement,
    displacementAt,
    residual,
    residualState,
    mesh: wr?.mesh === null || wr?.mesh === undefined ? null : { points: wr.mesh.points.map((p) => [p[0], p[1]]), triangles: [...wr.mesh.triangles] },
    refusal: c.refusal,
  };
}

/** One part's result, as `--json` prints it and `--from` reads it. */
export interface PartResult {
  example: string;
  part: string;
  slot: string;
  bound: string[];
  origin: [number, number];
  art: { width: number; height: number };
  /** The tool's slot-bone derivation is the row the stage wrote. */
  reproduced: boolean;
  today: { sent: boolean; envelope: SkinningEnvelopeBone[] | null; stops: EnvelopeStop[]; cell: CellReading };
  lca: {
    reference: string | null;
    handed: string[];
    envelope: SkinningEnvelopeBone[] | null;
    stops: EnvelopeStop[];
    /** The LCA derivation is today's byte for byte (the LCA is the slot's bone): the reduction input is today's, not re-run. */
    sameAsToday: boolean;
    cell: CellReading | null;
    /** rig-c's reading of the envelope as given: the written mesh's residual row state, or the refusal of the input. */
    accepted: string;
    veto: VetoTally | { refused: string } | null;
  };
}

/** The `residual` configuration's auto block for one part. */
function autoOf(key: string, part: string): Record<string, unknown> {
  return withExtra(withPolicyMotion(examplePolicy(trackedSpacing(key, part))) as unknown as Record<string, unknown>, extraOf(CONFIG));
}

/** The raw mesh entry's segments of a part in its example's config. */
function segmentsOf(key: string, part: string): unknown {
  const raw = JSON.parse(readFileSync(join(ROOT, 'examples', key, 'config.json'), 'utf8')) as { meshes: Record<string, { segments?: unknown }> };
  return raw.meshes[part]?.segments;
}

/** A child: one mode of one part, written to `out` as JSON. */
function runChild(key: string, part: string, mode: 'today' | 'lca', asm: string, out: string): void {
  const work = mkdtempSync(join(tmpdir(), 'rig-parts-auto-envelope-cell-'));
  try {
    const maxResidual = maxResidualOf();
    const basis = basisOf(key, asm);
    const slot = slotBoneOf(segmentsOf(key, part));
    const origin = originOf(asm, part);
    const img = readPng(join(asm, 'parts', `${part}.png`));
    const rigc = findRigc(ROOT, '');
    // The derivation needs the bound bones, which are the stage's source weights: today's run supplies them, and the
    // LCA run derives from the same first input before any reduction runs (the stage's input does not depend on it).
    let lca: LcaDerivation | null = null;
    let inject: ((input: MeshReductionInput) => MeshReductionInput) | null = null;
    if (mode === 'lca') {
      inject = (given) => {
        lca ??= lcaEnvelope(basis, slot, boundOf(given), origin);
        return 'envelope' in lca.derivation ? withSkinning(given, lca.derivation, maxResidual) : given;
      };
    }
    const rec = recorder(part, inject);
    const c = motionCell(key, part, autoOf(key, part), asm, join(work, 'cell'), rigc, rec.run);
    const first = c.input;
    if (first === null) throw new Error(`auto_envelope_survey: ${key}/${part}: the stage made no reduction call`);
    const bound = boundOf(first);
    const stageRow = (c.written ?? c.row)?.skinning_residual;
    const mine = deriveEnvelope(basis, slot, bound, origin);
    const lcaD: LcaDerivation = lca ?? lcaEnvelope(basis, slot, bound, origin);
    const todayEnv = 'envelope' in mine ? mine.envelope.bones : null;
    const sameAsToday = JSON.stringify(lcaD.derivation) === JSON.stringify(mine);
    const lcaSent = lcaD.reference !== null && 'envelope' in lcaD.derivation ? { reference: lcaD.reference, derivation: lcaD.derivation } : null;
    const cell = readCell(c, rec.calls, mode === 'today' ? (stageRow?.sent === true ? { reference: slot, derivation: mine } : null) : lcaSent, maxResidual);
    const veto = mode === 'lca' && lcaSent !== null ? vetoTally(withSkinning(first, lcaSent.derivation, maxResidual)) : null;
    const fullSent = rec.calls.find((x) => x.sent.stopAfterAccepted === undefined);
    const accepted =
      mode !== 'lca' || lcaSent === null
        ? 'not run'
        : fullSent !== undefined && 'code' in fullSent.result
          ? `refused: ${fullSent.result.detail}`
          : cell.residualState;
    const result = {
      mode,
      slot,
      bound,
      origin,
      art: { width: img.width, height: img.height },
      reproduced: reproduces(mine, stageRow),
      today: { sent: stageRow?.sent === true, envelope: todayEnv, stops: 'stops' in mine ? mine.stops : [] },
      lca: { reference: lcaD.reference, handed: lcaD.handed, envelope: 'envelope' in lcaD.derivation ? lcaD.derivation.envelope.bones : null, stops: 'stops' in lcaD.derivation ? lcaD.derivation.stops : [], sameAsToday, accepted, veto },
      cell,
      disagreement: c.disagreement,
    };
    writeFileSync(out, JSON.stringify(result));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

type ChildOut = {
  mode: string;
  slot: string;
  bound: string[];
  origin: [number, number];
  art: { width: number; height: number };
  reproduced: boolean;
  today: Omit<PartResult['today'], 'cell'>;
  lca: Omit<PartResult['lca'], 'cell'>;
  cell: CellReading;
  disagreement: string | null;
};

/** Runs one child under the cap; returns what it wrote, or the reason it wrote nothing. */
function runChildProcess(key: string, part: string, mode: 'today' | 'lca', asm: string, work: string, capSeconds: number): ChildOut | string {
  const out = join(work, `${key}-${part}-${mode}.json`);
  const t0 = performance.now();
  const run = spawnSync(process.execPath, [join(ROOT, 'tools', 'auto_envelope_survey.ts'), '--cell', `${key}/${part}`, '--mode', mode, '--asm', asm, '--out', out], { stdio: ['ignore', 'ignore', 'inherit'], timeout: capSeconds * 1000, killSignal: 'SIGKILL' });
  const wall = ((performance.now() - t0) / 1000).toFixed(1);
  if (run.error !== undefined || run.signal !== null) return `stopped at ${capSeconds} s (the per-cell cap)`;
  if (run.status !== 0 || !existsSync(out)) return `the cell's process exited ${run.status}`;
  const got = JSON.parse(readFileSync(out, 'utf8')) as ChildOut;
  console.error(`auto_envelope_survey: ${key}/${part} ${mode}: ${wall} s wall (process), stage ${got.cell.wallS} s, ${got.cell.verdict}`);
  return got;
}

/** One part: today's cell, and the LCA cell when the LCA is not the slot's bone. */
function runPart(key: string, part: string, asm: string, work: string, capSeconds: number): PartResult | string {
  const today = runChildProcess(key, part, 'today', asm, work, capSeconds);
  if (typeof today === 'string') return `${key}/${part} today: ${today}`;
  if (today.disagreement !== null) return `${key}/${part} today: ${today.disagreement}`;
  let lcaCell: CellReading | null = null;
  let lca = today.lca;
  if (!today.lca.sameAsToday && today.lca.envelope !== null) {
    const got = runChildProcess(key, part, 'lca', asm, work, capSeconds);
    if (typeof got === 'string') return `${key}/${part} lca: ${got}`;
    if (got.disagreement !== null) return `${key}/${part} lca: ${got.disagreement}`;
    lcaCell = got.cell;
    lca = got.lca;
  }
  return {
    example: key,
    part,
    slot: today.slot,
    bound: today.bound,
    origin: today.origin,
    art: today.art,
    reproduced: today.reproduced,
    today: { ...today.today, cell: today.cell },
    lca: { ...lca, accepted: today.lca.sameAsToday ? `today's: ${today.cell.residualState}` : lca.accepted, cell: lcaCell },
  };
}

// ---------------------------------------------------------------------------
// 5. the picture
// ---------------------------------------------------------------------------

const INK: RGBA = [20, 20, 20, 255];
const WIRE: RGBA = [40, 90, 200, 255];
const PAPER: RGBA = [255, 255, 255, 255];

/** One panel: the art washed towards white, the written mesh's wireframe over it, the caption under it. */
function panel(plate: Plate, ox: number, oy: number, art: Raster, mesh: CellReading['mesh'], caption: readonly string[]): void {
  const { width: w, height: h, data } = art;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 1) continue;
      plate.set(ox + x, oy + y, [Math.round((data[i] + 255) / 2), Math.round((data[i + 1] + 255) / 2), Math.round((data[i + 2] + 255) / 2), 255]);
    }
  }
  if (mesh !== null) {
    for (let t = 0; t + 2 < mesh.triangles.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = mesh.points[mesh.triangles[t + k]];
        const b = mesh.points[mesh.triangles[t + ((k + 1) % 3)]];
        plate.line(ox + a[0], oy + a[1], ox + b[0], oy + b[1], 1, WIRE);
      }
    }
  }
  caption.forEach((line, i) => plate.text(line, ox, oy + h + 6 + i * 10, 1, INK));
}

/** A cell's caption: what was sent, the written vertices, the step, the residual and the displacement. */
export function caption(head: string, c: CellReading | null): string[] {
  if (c === null) return [head, 'NOT RUN'];
  const v = c.written === null ? 'NOTHING WRITTEN' : `${c.written.hull + c.written.interior} V (${c.written.hull}+${c.written.interior})`;
  const step = c.chosen === null ? 'NO STEP' : `STEP ${c.chosen} OF ${c.steps ?? '-'}`;
  const num = (x: number | null): string => (x === null ? '-' : String(Number(x.toFixed(3))));
  return [head, v, step, `RESIDUAL ${num(c.residual)}`, `MOTION ${num(c.displacement)} PX`];
}

/** The picture: one row per part whose LCA is not its slot's bone — today's written mesh beside the LCA run's, wires over the art. */
export function picture(rows: ReadonlyArray<{ r: PartResult; art: Raster }>): Plate {
  const gap = 14;
  const captionH = 5 * 10 + 8;
  const W = Math.max(...rows.map(({ art }) => 2 * (art.width + gap))) + gap;
  const H = rows.reduce((n, { art }) => n + 12 + art.height + captionH + gap, gap);
  const plate = new Plate(W, H);
  plate.rect(0, 0, W, H, PAPER);
  let oy = gap;
  for (const { r, art } of rows) {
    plate.text(`${r.example}/${r.part}`.toUpperCase(), gap, oy, 1, INK);
    oy += 12;
    panel(plate, gap, oy, art, r.today.cell.mesh, caption(`TODAY: REF ${r.slot}, ${r.today.sent ? 'SENT' : 'NOT SENT'}`.toUpperCase(), r.today.cell));
    panel(plate, gap + art.width + gap, oy, art, r.lca.cell?.mesh ?? null, caption(`LCA: REF ${r.lca.reference ?? '-'}, ${r.lca.envelope === null ? 'NOT SENT' : 'SENT'}`.toUpperCase(), r.lca.cell));
    oy += art.height + captionH + gap;
  }
  return plate;
}

// ---------------------------------------------------------------------------
// 6. the page
// ---------------------------------------------------------------------------

const envText = (e: SkinningEnvelopeBone[] | null): string => (e === null ? 'none' : e.map((b) => b.bone).join(', '));
const stopsText = (s: readonly EnvelopeStop[]): string => (s.length === 0 ? 'none' : s.map((x) => `${x.bone} ${x.code}`).join(', '));
const vText = (c: CellReading | null): string => (c === null || c.written === null ? '—' : `${c.written.hull + c.written.interior} (${c.written.hull}+${c.written.interior})`);
const stepText = (c: CellReading | null): string => (c === null || c.chosen === null ? '—' : `${c.chosen} of ${c.steps ?? 'n/a'}`);
const num = (x: number | null): string => (x === null ? '—' : String(x));
const vetoText = (v: PartResult['lca']['veto']): string => (v === null ? 'n/a' : 'refused' in v ? `not counted: ${v.refused}` : `${v.removals} / ${v.runs} of ${v.attempts}; post-pass ${v.postPass ?? 'none'}`);

/** The page, from the parts' results. */
export function page(results: readonly PartResult[], machine: string, picturePath: string | null): string[] {
  const out: string[] = [];
  const moved = results.filter((r) => !r.lca.sameAsToday);
  const sending = results.filter((r) => r.today.sent);
  out.push('# The skinning envelope\'s reference bone on the public parts (issue #165, Stage A)', '');
  out.push(
    `Generated by \`bun tools/auto_envelope_survey.ts\`; every figure below is the tool's, none typed. The installed rig-c ${installedRigc()}. The parts are the Stage B survey's eight (docs/evidence/auto-stageb-survey.md), each switched alone to \`auto\` in its example's own config under its \`${CONFIG}\` configuration — the policy plus \`motion.residual.maxResidual\` ${maxResidualOf()} — through the real rig stage (gate build, reference build, rig-c's compareMeshesInMotion on the idle, the acceptance loop). "today" is the stage as it stood in Stage A, before Stage B (issue #165) moved the LCA into src/autoenvelope.ts: the envelope derived with the slot's bone as reference (src/autoenvelope.ts). "LCA" is the derivation under test, in the tool: the reference is the lowest common ancestor of the slot's bone and every bone the part's source weights bind, and the slot's bone is handed to the same deriveEnvelope as one more bound bone, so it enters with its own range when it is not the reference. The LCA run is the same stage with only the part's targets.skinning replaced (a reducer that hands every reduction of the part the LCA envelope); nothing under src/ is changed. Before any figure is read, the tool's own slot-bone derivation is held to the row the stage wrote (skinning_residual): ${results.every((r) => r.reproduced) ? 'it reproduced every part\'s' : `it did NOT reproduce ${results.filter((r) => !r.reproduced).map((r) => `${r.example}/${r.part}`).join(', ')}`}.`,
  );
  if (picturePath !== null) out.push('', `The picture, read first: [${picturePath.split('/').pop()}](${picturePath.split('/').pop()}) — per part whose reference moves, today's written mesh (left) beside the LCA run's (right), wires over the art, counts in the captions.`);
  out.push('', '## 1. The reference, the bones sent, the stops', '');
  out.push('Bound bones are the source weights\' bones (the slot\'s bone among them when the weights bind it). "Sent" is the envelope\'s bones, every one but the reference; "stops" are the derivation\'s, by bone and code. "rig-c\'s reading" is the written mesh\'s MQ_SKINNING_RESIDUAL state under the envelope sent (pass or fail is a measurement: rig-c took the envelope as given), or the refusal of the reduction\'s input; where the LCA is the slot\'s bone the derivations are compared byte for byte and the input is today\'s.', '');
  out.push('| part | slot\'s bone | bound bones | today: sent / stops | LCA reference | LCA: sent / stops | LCA derivation = today\'s | rig-c\'s reading of the LCA envelope |');
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    out.push(
      `| ${r.example}/${r.part} | ${r.slot} | ${r.bound.join(', ')} | ${r.today.sent ? envText(r.today.envelope) : `not sent: ${stopsText(r.today.stops)}`} | ${r.lca.reference ?? 'none'} | ${r.lca.envelope !== null ? envText(r.lca.envelope) : `not sent: ${stopsText(r.lca.stops)}`} | ${r.lca.sameAsToday ? 'yes' : 'no'} | ${r.lca.accepted} |`,
    );
  }
  out.push('', '## 2. The same bound? The parts that already send', '');
  out.push(
    `The residual is the written mesh's MQ_SKINNING_RESIDUAL (drawing px) — a pose-free bound, under the envelope, on how far the candidate draws a UV from where the source draws it. The displacement is the largest MQ_LOCAL_DEFORMATION rig-c's compareMeshesInMotion read on the same written mesh against its source over the whole idle (rig px; one drawing px is one rig px here — no bone scale, page scale 1): the full result's comparison, or for a replayed step the larger of its selection and held-out readings. The residual has to stay at or above the displacement; a residual below it is a counter-example.`,
    '',
  );
  out.push('| part | residual, slot\'s bone | residual, LCA | posed displacement @ frame | slot\'s bone | LCA |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of sending) {
    const t = r.today.cell;
    const l = r.lca.sameAsToday ? t : r.lca.cell;
    out.push(`| ${r.example}/${r.part} | ${num(t.residual)} (${t.residualState}) | ${l === null ? 'not run' : `${num(l.residual)} (${l.residualState})${r.lca.sameAsToday ? ', the same input' : ''}`} | ${num(t.displacement)} @ ${t.displacementAt} | ${sameBound(t.residual, t.displacement).verdict} | ${l === null ? 'not run' : sameBound(l.residual, l.displacement).verdict} |`);
  }
  const counter = results.flatMap((r) => [
    ...(r.today.sent ? [[r, 'slot\'s bone', r.today.cell] as const] : []),
    ...(r.lca.cell !== null ? [[r, 'LCA', r.lca.cell] as const] : []),
  ]).filter(([, , c]) => sameBound(c.residual, c.displacement).verdict === 'counter-example');
  out.push('', counter.length === 0 ? `**No counter-example.** On every written mesh whose residual was measured (${sending.length} parts against the slot's bone, ${moved.filter((r) => r.lca.cell !== null).length} against the LCA below) the residual is at or above the posed displacement.` : `**Counter-example.** ${counter.map(([r, ref, c]) => `${r.example}/${r.part} (${ref}): ${sameBound(c.residual, c.displacement).text} @ ${c.displacementAt}`).join('; ')}.`);
  out.push('', '## 3. The target sent where the reference moves', '');
  out.push(
    `Today's row is the stage with no target sent (the veto not applied: the stage's \`${CONFIG}\` row, which sends nothing on these parts); the LCA row is the same stage with the LCA envelope sent. Vertices are the written mesh's, hull+interior; the step is the written one of the full run's N accepted operations. Wall seconds are the stage's (assembled parts in, the verdict out), measured on ${machine}; an order of magnitude, not a timing. Vetoed steps are counted on the LCA run's full input by tools/veto_tally.ts (removals / boundary runs of attempts).`,
    '',
  );
  out.push('| part | reference today → LCA | today: step / vertices / displacement / wall s | LCA: step / vertices / wall s | LCA: residual / displacement | same bound | vetoed (LCA) | verdict today → LCA |');
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of moved) {
    const t = r.today.cell;
    const l = r.lca.cell;
    out.push(
      `| ${r.example}/${r.part} | ${r.slot} → ${r.lca.reference ?? 'none'} | ${stepText(t)} / ${vText(t)} / ${num(t.displacement)} @ ${t.displacementAt} / ${t.wallS} | ${l === null ? 'not run' : `${stepText(l)} / ${vText(l)} / ${l.wallS}`} | ${l === null ? '—' : `${num(l.residual)} (${l.residualState}) / ${num(l.displacement)} @ ${l.displacementAt}`} | ${l === null ? 'not run' : sameBound(l.residual, l.displacement).verdict} | ${vetoText(r.lca.veto)} | ${t.verdict} → ${l?.verdict ?? 'not run'} |`,
    );
  }
  const refusals = results.flatMap((r) => [r.today.cell, r.lca.cell].filter((c): c is CellReading => c !== null && c.refusal !== null).map((c) => `- ${r.example}/${r.part}: ${c.refusal?.replace(/\n/g, ' / ')}`));
  if (refusals.length > 0) out.push('', '## Refusals', '', ...refusals);
  out.push(
    '',
    '## Re-running this evidence',
    '',
    `Inputs: the public examples demo, sample and scarf of https://github.com/firejune/spine-parts-examples at commit ${pinnedInputs()} (the pin in \`scripts/fetch-examples.sh\`; \`bun run fetch-examples\` copies them into the gitignored \`examples/<key>/inputs\`), each with its tracked \`examples/<key>/config.json\`; rig-c ${installedRigc()} as \`bun install --frozen-lockfile\` installs it from \`bun.lock\`. Each cell runs in a process of its own, stopped at 600 s. Nothing is written but standard output and the picture (the stages run in a temporary directory, removed afterwards).`,
    '',
    '```sh',
    'bun install --frozen-lockfile',
    'bun run fetch-examples',
    'bun tools/auto_envelope_survey.ts --picture docs/evidence/auto-envelope-reference.png > docs/evidence/auto-envelope-reference.md',
    '# or one part per job, rendered where the inputs are:',
    'bun tools/auto_envelope_survey.ts --only <key>/<part> --json > <part>.jsonl',
    'bun tools/auto_envelope_survey.ts --from <part>.jsonl… --machine "<where the jobs ran>" --picture docs/evidence/auto-envelope-reference.png > docs/evidence/auto-envelope-reference.md',
    '```',
  );
  return out;
}

// ---------------------------------------------------------------------------
// 7. the command
// ---------------------------------------------------------------------------

/** The `--json` line's prefix. */
export const JSON_PREFIX = 'ENVELOPE_SURVEY ';

function main(): void {
  const argv = process.argv.slice(2);
  const val = (f: string): string | null => {
    const i = argv.indexOf(f);
    return i >= 0 ? (argv[i + 1] ?? '') : null;
  };
  const cellName = val('--cell');
  if (cellName !== null) {
    const [key, part] = cellName.split('/');
    const mode = val('--mode');
    const asm = val('--asm');
    const out = val('--out');
    if (key === undefined || part === undefined || (mode !== 'today' && mode !== 'lca') || asm === null || out === null) throw new Error('a child needs --cell <key>/<part> --mode today|lca --asm <dir> --out <file>');
    runChild(key, part, mode, asm, out);
    return;
  }
  const picturePath = val('--picture');
  const machine = val('--machine') ?? 'the machine this command ran on';
  const from: string[] = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--from') for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) from.push(argv[j]);
  let results: PartResult[] = [];
  let failed = 0;
  if (from.length > 0) {
    for (const f of from) for (const line of readFileSync(f, 'utf8').split('\n')) if (line.startsWith(JSON_PREFIX)) results.push(JSON.parse(line.slice(JSON_PREFIX.length)) as PartResult);
    results = PARTS.flatMap(([k, p]) => results.filter((r) => r.example === k && r.part === p).slice(0, 1));
  } else {
    const only = val('--only');
    const plan = PARTS.filter(([k, p]) => only === null || only === `${k}/${p}`);
    if (plan.length === 0) {
      console.error(`auto_envelope_survey: --only ${only} names none of the surveyed parts`);
      process.exit(2);
    }
    const missing = missingInputs([...new Set(plan.map(([k]) => k))]);
    if (missing.length > 0) {
      console.error(`auto_envelope_survey: no fetched inputs for ${missing.map((k) => `examples/${k}/inputs`).join(', ')}; run \`bun run fetch-examples\` first`);
      process.exit(1);
    }
    const work = mkdtempSync(join(tmpdir(), 'rig-parts-auto-envelope-survey-'));
    try {
      const asmOf = new Map<string, string>();
      for (const [k, p] of plan) {
        if (!asmOf.has(k)) asmOf.set(k, assembleExample(work, k));
        const r = runPart(k, p, asmOf.get(k) as string, work, 600);
        if (typeof r === 'string') {
          failed++;
          console.error(`auto_envelope_survey: ${r}`);
          continue;
        }
        if (!r.reproduced) {
          failed++;
          console.error(`auto_envelope_survey: ${k}/${p}: the tool's slot-bone derivation does not reproduce the stage's row; its basis is not the stage's`);
        }
        results.push(r);
        if (argv.includes('--json')) console.log(`${JSON_PREFIX}${JSON.stringify(r)}`);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    if (argv.includes('--json')) process.exit(failed > 0 ? 1 : 0);
  }
  if (picturePath !== null) {
    const rows = results.filter((r) => !r.lca.sameAsToday && r.lca.cell !== null);
    if (rows.length > 0) {
      const work = mkdtempSync(join(tmpdir(), 'rig-parts-auto-envelope-picture-'));
      try {
        const asmOf = new Map<string, string>();
        const drawn = rows.map((r) => {
          if (!asmOf.has(r.example)) asmOf.set(r.example, assembleExample(work, r.example));
          const art = readPng(join(asmOf.get(r.example) as string, 'parts', `${r.part}.png`));
          if (art.width !== r.art.width || art.height !== r.art.height) throw new Error(`auto_envelope_survey: ${r.example}/${r.part}: the assembled part is ${art.width}x${art.height}, the run's was ${r.art.width}x${r.art.height}`);
          return { r, art };
        });
        picture(drawn).writePng(picturePath);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    }
  }
  console.log(page(results, machine, picturePath).join('\n'));
  if (failed > 0) process.exit(1);
}

if (import.meta.main) main();

