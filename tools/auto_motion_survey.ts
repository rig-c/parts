#!/usr/bin/env bun
/**
 * The motion gate of the automatic mesh mode (`src/automotion.ts`, issue #126
 * item 3) over the public examples, by one command:
 *
 *     bun run fetch-examples          # once: examples/{reference-demo,reference-sample,scarf}/inputs
 *     bun tools/auto_motion_survey.ts
 *
 * Which parts: the eight that item 2 accepted on geometry (issue #126, the
 * item-2 comment: demo `neck`, `bottomwear`; sample `neck`, `sleeves`,
 * `topwear`, `bottomwear`; scarf `hair_front`, `handwear_l`), each switched
 * **alone** to `auto` in its example's own config. The policy, stated before
 * any comparison ran and not tuned per part: `examplePolicy(spacing)`
 * (`fixtures/automesh.ts`, with the part's tracked spacing — its lattice
 * `grid`, or the contour spacing of a part already in that mode) plus
 * `policyMotion` (`fixtures/automotion.ts`: `maxLocalDeformation` = the
 * policy's `maxBoundaryDeviation`, no stretch bounds, no `deformMayFold`).
 *
 * What runs: `assembleStage` on the example's fetched inputs, then the real
 * `rigStage` — the gate build, the reference build and rig-c's
 * `compareMeshesInMotion` — through the installed rigc, in a temporary
 * directory that is removed afterwards. The stage's verdict decides the
 * verdict column; the rows of a refused part, which the stage does not write,
 * are read from the same comparison re-run on the two model documents the
 * stage's builds wrote (the stage's own function, `runComparison`), and the
 * tool refuses to print a row whose re-run verdict disagrees with the
 * stage's. The case is rebuilt by `buildRig` with the stage's own reduction
 * handed back (`reuseReductions`, keyed by the whole input), so each part's
 * `reduceMesh` runs once (issue #135). One part's run is {@link motionCell},
 * which `tools/auto_weightjump_survey.ts` runs too.
 *
 * Since rig-c 2.24.0 the stage runs the acceptance loop (`src/autoreplay.ts`)
 * on a part whose full result the gate refuses: the first table stays the full
 * result's comparison (the stage's first two builds), and a second table reads
 * the loop off the row the stage wrote (`replay`) or off its refusal.
 *
 * ## `--config <name>[,<name>…]`: the Stage B matrix (rigc#1271, rig-c 2.25.0–2.28.0)
 *
 * With `--config`, each named configuration ({@link STAGE_B_CONFIGS}) is run
 * over the same eight parts — the policy above plus that configuration's
 * opt-ins and nothing else — and one document is printed: per part and
 * configuration, the source, full and chosen counts, the operations N (I),
 * the chosen step, the replays and the candidates of the full run and of the
 * replays, the full run's termination, the chosen row's
 * `MQ_BOUNDARY_DEVIATION`, the motion readings with their worst frames, the
 * verdict, what each opt-in did, and the five allocation rows rig-c 2.26.0
 * added — with, since rig-c 2.29.0, the load measured under the derived
 * amplitude (gradation null), economy E beside Δ, and the comparison's setup
 * load on the source and the full result. `baseline` is no opt-in: the same
 * calls as the default document. `gradation` is the baseline with
 * `motion.gradation` 0.75, the one value rig-c's contract names, so Δ and E
 * appear once; it is an author's number written for the evidence, no default.
 *
 * `residual` and `allResidual` (rig-c 2.31.0, rigc#1295) are the baseline and `all` with
 * `motion.residual.maxResidual` 1; with either, a third table prints per part whether the envelope
 * was sent (or every stop that left it not measurable), the envelope, the steps the veto refused on
 * the full run (`tools/veto_tally.ts`, which re-runs that run's own input after the stage's wall time
 * was taken), the written mesh's `MQ_SKINNING_RESIDUAL` with its worst sample, and the comparison.
 *
 * Output: Markdown — two tables, one schedule line per part, and the refusal
 * text of every refused part. Every number is read from rig-c's report;
 * no path, no time and no machine is printed, so two runs of one tree print
 * the same bytes. Each part's wall time and rigc build count go to standard
 * error instead. Exit 1 when an example's inputs are missing (it names
 * them) or a re-run disagrees with the stage; 0 otherwise, refused parts
 * included — a refusal is a result.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { MeasureRow, MeshQualityReport, MeshReductionInput } from '@rig-c/core/mesh';
import { DEFAULT_PROJECT_RULE, DEFAULT_SEAM_RULE } from '../src/assemble.ts';
import { type Reducer, type ReductionResult, reductionKey, reuseReductions, runReduction } from '../src/automesh.ts';
import { motionInput, motionVerdict, runComparison } from '../src/automotion.ts';
import { assembleStage, RIGC_MODEL_DOCUMENT, rigStage } from '../src/build.ts';
import { findRigc, type RigcRunner } from '../src/check.ts';
import { loadConfig } from '../src/config.ts';
import { PartsError, problemLine } from '../src/errors.ts';
import { readParts } from '../src/parts.ts';
import { readPng, type Raster } from '../src/raster/index.ts';
import { type AutoMeshReport, buildRig } from '../src/rig.ts';
import { examplePolicy } from '../fixtures/automesh.ts';
import { withPolicyMotion } from '../fixtures/automotion.ts';
import { type VetoTally, vetoTally } from './veto_tally.ts';

const ROOT = resolve(import.meta.dir, '..');

/**
 * The Stage B configurations (rigc#1271), each the opt-ins it adds to the policy and nothing else. `boundaryRuns`
 * takes `maxVertices` 8: the one figure every recorded Stage B measurement used (rig-c docs/MESH_REDUCTION.md §8 —
 * the stage-A prototype's runs of "up to 8", and #1279's and #1283's tables at `maxVertices: 8`), stated before any
 * part was run here and not tuned per part.
 */
export const STAGE_B_CONFIGS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['baseline', {}],
  ['boundaryRuns', { boundaryRuns: { maxVertices: 8 } }],
  ['retriangulate', { retriangulate: 'delaunay' }],
  ['removalOrder', { removalOrder: 'deformation-load' }],
  ['all', { boundaryRuns: { maxVertices: 8 }, retriangulate: 'delaunay', removalOrder: 'deformation-load' }],
  // The baseline with a declared gradation (rigc#1291): 0.75, the one value rig-c's contract names — §8's fixtures'
  // ("it is a value those fixtures chose, not a default rigc holds"). An author's number written here for the
  // evidence so Δ and E appear once; it is no default of this package and no claim that 0.75 suits these parts.
  ['gradation', { motion: { gradation: 0.75 } }],
  // The multi-interval selection (issue #148): the baseline, and `all`, with `motion.selection`. maxProbes 18 is twice
  // ⌈log₂ 275⌉ = 9, the longest bisection the tracked Stage B survey can take (its largest N is 275 operations) —
  // stated before any part was run under it and not tuned per part; it is an author's number written for the evidence.
  ['multiInterval', { motion: { selection: { policy: 'multi-interval', maxProbes: 18 } } }],
  ['allMultiInterval', { boundaryRuns: { maxVertices: 8 }, retriangulate: 'delaunay', removalOrder: 'deformation-load', motion: { selection: { policy: 'multi-interval', maxProbes: 18 } } }],
  // The skinning residual as a per-step veto (issue #126, rig-c 2.31.0, rigc#1295): the baseline, and `all`, with
  // `motion.residual.maxResidual` 1 — the policy's motion bound (policyMotion: 1 rig px = 1 drawing px, pageScale 1).
  // The residual bounds the same quantity the motion row measures — how far a UV is drawn from where the source draws
  // it — so the bound the author already accepts for the posed reading is the first reading of the pose-free one; it
  // is an author's number written for the evidence, stated before any part was run under it and not tuned per part.
  ['residual', { motion: { residual: { maxResidual: 1 } } }],
  ['allResidual', { boundaryRuns: { maxVertices: 8 }, retriangulate: 'delaunay', removalOrder: 'deformation-load', motion: { residual: { maxResidual: 1 } } }],
];

/** A configuration's opt-ins by name; an unknown name is `configsFromArgs`'s to refuse, so none reaches here. */
export function extraOf(name: string): Record<string, unknown> {
  return STAGE_B_CONFIGS.find(([n]) => n === name)?.[1] ?? {};
}

/** The policy with a configuration's fields over it; a `motion` field is merged into the policy's motion, key by key. */
export function withExtra(auto: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  const { motion, ...rest } = extra;
  return motion === undefined ? { ...auto, ...rest } : { ...auto, ...rest, motion: { ...(auto.motion as Record<string, unknown>), ...(motion as Record<string, unknown>) } };
}

/** The five allocation rows rig-c 2.26.0 reports, every one `undeclared` or `not-measurable` (rigc#1280). */
export const ALLOCATION_ROWS = ['MQ_GRADE', 'MQ_MIN_ANGLE_P10', 'MQ_ALLOCATION_CONTRAST', 'MQ_DEFORM_LOAD', 'MQ_BOUNDARY_NECESSARY'] as const;

/** The parts item 2 accepted on geometry, by example (issue #126, the item-2 comment). */
const PARTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['reference-demo', ['neck', 'bottomwear']],
  ['reference-sample', ['neck', 'sleeves', 'topwear', 'bottomwear']],
  ['scarf', ['hair_front', 'handwear_l']],
];

/** One part switched alone to `auto` and run through the real rig stage: what the stage said and what its comparison read. */
export interface MotionCell {
  example: string;
  part: string;
  /** `source hull+interior → result hull+interior`, or `not built`. */
  counts: string;
  /** The stage's refusal, every problem line, or null when it accepted. */
  refusal: string | null;
  /** rig-c's comparison report (re-run on the two documents the stage's builds wrote), or null when none ran. */
  report: MeshQualityReport | null;
  /** The part's `mesh_report.json` row as the stage built it, or undefined when it built none. */
  row: AutoMeshReport | undefined;
  /** The reduction input the stage handed rig-c first (the part's own), or null when it made no call. */
  input: MeshReductionInput | null;
  /** A re-run whose verdict disagrees with the stage's, in words; null when they agree or no comparison ran. */
  disagreement: string | null;
  /** The part's row as the stage wrote it (`mesh_report.json`) — a replayed step's when the acceptance loop chose one — or undefined when nothing was written. */
  written: AutoMeshReport | undefined;
  /** rigc builds the stage ran for this part's rig (the gate, the reference, one per replay, and the gate and reference of a replayed rig). */
  builds: number;
  /** Wall time of the stage, ms. Never printed into the Markdown (it is not reproducible); the tool prints it to standard error. */
  wallMs: number;
  /** Every reduction the stage ran, by its input's `reductionKey` (the full run and each replay), so a caller can read the written mesh without running it again. */
  reductions: ReadonlyMap<string, ReductionResult>;
}

/** The examples of `keys` with no fetched painting, so a caller can refuse by name before anything runs. */
export function missingInputs(keys: readonly string[]): string[] {
  return keys.filter((k) => !existsSync(join(ROOT, 'examples', k, 'inputs', 'painting.png')));
}

/** `assemble` on an example's fetched inputs, into `<work>/<key>/asm`; returns that directory. */
export function assembleExample(work: string, key: string): string {
  const ex = join(ROOT, 'examples', key);
  const asm = join(work, key, 'asm');
  assembleStage(
    { source: join(ex, 'inputs', 'painting.png'), full: join(ex, 'inputs', 'layers', 'full'), head: join(ex, 'inputs', 'layers', 'head'), config: join(ex, 'config.json'), seam: DEFAULT_SEAM_RULE, project: DEFAULT_PROJECT_RULE },
    { partsJson: join(asm, 'parts.json'), partsDir: join(asm, 'parts'), recomposite: join(asm, 'recomposite_rig.png'), errorMap: join(asm, 'recomposite_error_rig.png') },
    () => {},
  );
  return asm;
}

/** The part's tracked spacing: its lattice `grid`, or the contour spacing of a part already in that mode. */
export function trackedSpacing(key: string, part: string): number {
  const raw = JSON.parse(readFileSync(join(ROOT, 'examples', key, 'config.json'), 'utf8')) as { meshes: Record<string, { grid?: number; contour?: { spacing: number } }> };
  const m = raw.meshes[part];
  const spacing = m.grid ?? m.contour?.spacing;
  if (spacing === undefined) throw new Error(`examples/${key}/config.json meshes.${part} has neither grid nor contour.spacing`);
  return spacing;
}

/**
 * The switched config of example `key` written as `<dir>/config.json`, with the files the config names beside it carried
 * into `dir`: `motion.animations_from` (issue #183) resolves against the config's own directory, so a config copied alone
 * refuses with `CONFIG_FILE_PRESENT` (issue #311). Every JSON file of `examples/<key>/` but the config is copied, as
 * `tools/density_survey.ts`, `tools/tear_survey.ts`, `tools/edge_survey.ts` and `tools/auto_policy_survey.ts` do; the
 * config keeps the relative name it tracks, so no machine's path enters what the config reads or what a refusal prints.
 * `text` is the config's bytes when a caller writes them its own way (`tools/auto_matrix.ts` writes two-space JSON).
 */
export function writeSwitchedConfig(key: string, raw: unknown, dir: string, text: string = JSON.stringify(raw, null, 1)): string {
  mkdirSync(dir, { recursive: true });
  const from = join(ROOT, 'examples', key);
  for (const f of readdirSync(from)) {
    const p = join(from, f);
    if (f.endsWith('.json') && f !== 'config.json' && statSync(p).isFile()) copyFileSync(p, join(dir, f));
  }
  const at = join(dir, 'config.json');
  writeFileSync(at, text);
  return at;
}

/**
 * One part of one example switched alone to `auto` — `auto` is the block written into the example's own config — and run
 * through the real rig stage in `dir`, `asm` holding the example's assembled parts. Returns the stage's verdict, the
 * comparison's rows (re-run on the two model documents the stage's builds wrote, with the stage's own function), the
 * part's row and its reduction input. The stage's reductions are handed back to the rebuild (`reuseReductions`), so
 * `reduceMesh` runs once per input. `run` is the call each reduction goes through — `runReduction` unless a caller
 * hands another (`tools/auto_envelope_survey.ts` hands one that sends a different envelope); the reductions are kept
 * under the stage's own input either way, so the rebuild reuses them.
 */
export function motionCell(key: string, part: string, auto: unknown, asm: string, dir: string, rigcBin: string, run: Reducer = runReduction): MotionCell {
  const raw = JSON.parse(readFileSync(join(ROOT, 'examples', key, 'config.json'), 'utf8')) as { meshes: Record<string, { r: number; segments: unknown }> };
  const m = raw.meshes[part];
  (raw.meshes as Record<string, unknown>)[part] = { auto, r: m.r, segments: m.segments };
  writeSwitchedConfig(key, raw, dir);
  // The documents the stage's builds wrote: 0 is the gate build (the candidate), 1 the reference.
  const models: Array<string | null> = [];
  const runner: RigcRunner = (args) => {
    const r = spawnSync(rigcBin, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (args[0] === 'build') {
      const path = join(args[args.indexOf('--out') + 1], RIGC_MODEL_DOCUMENT);
      models.push(r.status === 0 && existsSync(path) ? readFileSync(path, 'utf8') : null);
    }
    return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  let refusal: string | null = null;
  // The stage's reductions, kept by input so the rebuild below reuses them instead of running them again.
  const reduced = new Map<string, ReductionResult>();
  let input: MeshReductionInput | null = null;
  const recording: Reducer = (object, given) => {
    const r = run(object, given);
    reduced.set(reductionKey(given), r);
    input ??= given;
    return r;
  };
  const t0 = performance.now();
  try {
    rigStage({ config: join(dir, 'config.json'), parts: asm, out: join(dir, 'rig'), reduce: recording }, runner, join(dir, 'scratch'), () => {});
  } catch (err) {
    if (!(err instanceof PartsError)) throw err;
    refusal = err.problems.map(problemLine).join('\n');
  }
  const wallMs = performance.now() - t0;
  const writtenPath = join(dir, 'rig', 'mesh_report.json');
  const writtenRow = refusal === null && existsSync(writtenPath) ? (JSON.parse(readFileSync(writtenPath, 'utf8')) as AutoMeshReport[]).find((x) => x.part === part) : undefined;
  const written = writtenRow !== undefined && 'mode' in writtenRow && writtenRow.mode === 'auto' ? writtenRow : undefined;
  // The case the stage compared, rebuilt from the same config and parts (buildRig is pure: the same bytes).
  const images = new Map<string, Raster>();
  const partsFile = readParts(join(asm, 'parts.json'));
  for (const p of partsFile.parts) images.set(p.name, readPng(join(asm, 'parts', `${p.name}.png`)));
  const rig = buildRig(loadConfig(join(dir, 'config.json')), partsFile, images, undefined, undefined, reuseReductions(reduced).reduce);
  const c = rig.autoMotion[0];
  const found = rig.meshReport.find((x) => x.part === part);
  const row = found !== undefined && 'mode' in found && found.mode === 'auto' ? found : undefined;
  const counts = row !== undefined && row.source.counts !== null ? `${row.source.counts.boundaryVertices}+${row.source.counts.interiorVertices} → ${row.result.counts.boundaryVertices}+${row.result.counts.interiorVertices}` : 'not built';
  let report: MeshQualityReport | null = null;
  let disagreement: string | null = null;
  // models[0] and models[1] are the full result's gate and its reference; any later build is the acceptance loop's.
  if (c !== undefined && c.motion !== undefined && models.length >= 2 && models[0] !== null && models[1] !== null) {
    const ran = runComparison(c.object, motionInput(c, c.motion, models[1], models[0]));
    if (!('code' in ran)) {
      report = ran;
      // The full result is accepted outright exactly when the stage wrote the part with no replay.
      const outright = refusal === null && written?.replay === undefined;
      if ((motionVerdict(c.object, ran) === null) !== outright) {
        disagreement = `${key}/${part}: the re-run comparison of the full result ${outright ? 'refuses' : 'accepts'} what the stage ${outright ? 'accepted outright' : 'refused or replayed'}`;
      }
    }
  }
  return { example: key, part, counts, refusal, report, row, input, disagreement, written, builds: models.length, wallMs, reductions: reduced };
}

/** The part-wide motion row `code` of a comparison, or undefined. */
export const rowOf = (r: MeshQualityReport | null, code: string): MeasureRow | undefined => r?.candidates[0]?.motion?.rows.find((x) => x.code === code && x.object.region === null);
/** A motion row as `value / op bound @ worst frame`, or `not measured`. */
export const cell = (x: MeasureRow | undefined): string => (x === undefined || x.value === null ? 'not measured' : `${x.value}${x.bound === null ? '' : ` / ${x.bound.op} ${x.bound.value}`}${x.worst?.frame === undefined ? '' : ` @ ${x.worst.frame.id}`}`);

/** The installed rig-c's version, as its package says. */
export function installedRigc(): string {
  return (JSON.parse(readFileSync(join(ROOT, 'node_modules', '@rig-c', 'core', 'package.json'), 'utf8')) as { version: string }).version;
}

/** The stage's verdict on one part in a few words: accepted outright, accepted at a replayed step, or the refusal's code. */
export function verdictOf(r: MotionCell): string {
  if (r.refusal !== null) return `refused ${r.refusal.split(':')[0]}`;
  const rp = r.written?.replay;
  return rp === undefined ? 'accepted' : `accepted at replayed step ${rp.chosen_step} of ${rp.accepted_steps}`;
}

/** The commit `scripts/fetch-examples.sh` pins, read off the script (`PINNED_COMMIT=`), or a named absence. */
export function pinnedInputs(): string {
  const m = /^PINNED_COMMIT=([0-9a-f]{40})\s*$/m.exec(readFileSync(join(ROOT, 'scripts', 'fetch-examples.sh'), 'utf8'));
  return m === null ? 'unread (no 40-character PINNED_COMMIT in scripts/fetch-examples.sh)' : m[1];
}

/** "Re-running this evidence": the inputs at their pinned commit, rig-c as the lock installs it, the command and its cap. */
export function rerunFooter(rigcVersion: string, pinned: string): string[] {
  return [
    '',
    '## Re-running this evidence',
    '',
    `Inputs: the public examples ${PARTS.map(([k]) => k).join(', ')} of https://github.com/firejune/spine-parts-examples at commit ${pinned} (the pin in \`scripts/fetch-examples.sh\`; \`bun run fetch-examples\` copies them into the gitignored \`examples/<key>/inputs\`), each with its tracked \`examples/<key>/config.json\`; rig-c ${rigcVersion} as \`bun install --frozen-lockfile\` installs it from \`bun.lock\`. No other input is read, and nothing is written but standard output (the stages run in a temporary directory, removed afterwards). Each part's wall time and rigc build count go to standard error and are not part of this document.`,
    '',
    '```sh',
    'bun install --frozen-lockfile',
    'bun run fetch-examples',
    'timeout 2700 bun tools/auto_motion_survey.ts > docs/evidence/auto-motion-survey.md',
    '```',
  ];
}

function print(results: readonly MotionCell[]): void {
  console.log('## The motion gate on the public examples (tools/auto_motion_survey.ts)\n');
  console.log(
    `Policy: examplePolicy(spacing) (fixtures/automesh.ts) + policyMotion (fixtures/automotion.ts); each part switched alone; the real rig stage, the acceptance loop with a replay included (src/autoreplay.ts), through the installed rig-c ${installedRigc()}. The first table is the full reduction's comparison on the whole idle, every frame held out; the second is the acceptance loop's.\n`,
  );
  console.log('| part | source → full result (hull+interior) | MQ_LOCAL_DEFORMATION value / bound @ worst frame | samples (art) | MQ_STRETCH | MQ_SQUASH | MQ_INVERSION | verdict |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    const local = rowOf(r.report, 'MQ_LOCAL_DEFORMATION');
    const samples = local?.sampling === undefined ? 'not measured' : `${local.sampling.count} (${local.art?.samples ?? 'n/a'})`;
    console.log(`| ${r.example}/${r.part} | ${r.counts} | ${cell(local)} | ${samples} | ${cell(rowOf(r.report, 'MQ_STRETCH'))} | ${cell(rowOf(r.report, 'MQ_SQUASH'))} | ${cell(rowOf(r.report, 'MQ_INVERSION'))} | ${verdictOf(r)} |`);
  }
  console.log('\n### The acceptance loop (rigc#1266 mechanism 2: a bisection over acceptedAt by stopAfterAccepted)\n');
  console.log(
    'N is the full run\'s accepted steps (acceptedAt\'s length), I the refinement\'s insertions among them; the bisection probes removal steps strictly between I and N, chooses on the idle\'s grid frames, and the chosen step is accepted only on the whole idle with the irr frames held out. A part the gate accepts outright runs no replay. Probes are `step verdict value` on the grid frames.\n',
  );
  console.log('| part | source → full → written (hull+interior) | N (I) | chosen step | replays (at most) | candidates tried in replays | selection @ worst frame | held out @ worst frame | probes | outcome |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    const rp = r.written?.replay;
    const full = r.row?.result.counts;
    const w = r.written?.result.counts;
    const counts = `${r.row?.source.counts === null || r.row === undefined ? 'unread' : `${r.row.source.counts.boundaryVertices}+${r.row.source.counts.interiorVertices}`} → ${full === undefined ? 'not built' : `${full.boundaryVertices}+${full.interiorVertices}`} → ${w === undefined ? 'nothing' : `${w.boundaryVertices}+${w.interiorVertices}`}`;
    const n = r.row?.quality_report as { candidates?: Array<{ changes?: { acceptedAt?: number[]; insertedVertices?: number } }> } | undefined;
    const ch = n?.candidates?.[0]?.changes;
    const nI = ch?.acceptedAt === undefined ? 'n/a' : `${ch.acceptedAt.length} (${ch.insertedVertices ?? 0})`;
    const role = (x: { value: number | null; frame: string | null } | null | undefined): string => (x === null || x === undefined ? 'n/a' : `${x.value} @ ${x.frame ?? 'every frame'}`);
    if (rp !== undefined) {
      const probes = rp.probes.map((p) => `${p.step} ${p.verdict}${p.value === null ? '' : ` ${p.value}`}`).join(', ');
      console.log(`| ${r.example}/${r.part} | ${counts} | ${nI} | ${rp.chosen_step} | ${rp.replays} (${'max_replays' in rp ? rp.max_replays : rp.max_probes}) | ${rp.candidates_tried} | ${role(rp.selection)} | ${role(rp.held_out)} | ${probes} | ${verdictOf(r)} |`);
    } else if (r.refusal === null) {
      console.log(`| ${r.example}/${r.part} | ${counts} | ${nI} | ${ch?.acceptedAt?.length ?? 'n/a'} (the full result) | 0 | 0 | n/a | n/a | none | ${verdictOf(r)} |`);
    } else {
      const probes = /kept none \(([^)]*)\)/.exec(r.refusal)?.[1] ?? 'no search (see the refusal)';
      console.log(`| ${r.example}/${r.part} | ${counts} | ${nI} | none | ${probes.startsWith('step ') ? probes.split(', ').length : 0} | n/a | n/a | n/a | ${probes} | ${verdictOf(r)} |`);
    }
  }
  console.log('\n### The schedule walked\n');
  for (const r of results) {
    const s = r.report?.candidates[0]?.motion?.schedule;
    if (s === undefined) {
      console.log(`- ${r.example}/${r.part}: no comparison ran`);
      continue;
    }
    const rates = s.frames.map((f) => (f === 'setup' ? 'setup' : 'fps' in f ? `${f.animation} at ${f.fps} fps` : `${f.animation} at ${f.times.length} explicit time(s)`)).join(', ');
    const perPhase = s.phases.map((p) => `${p} ${s.walked.filter((w) => w.phase === p).length}`).join(', ');
    const physics = s.physics.mode === 'step' ? `step dt ${s.physics.dt}, warmupSteps ${s.physics.warmupSteps}` : 'none';
    console.log(`- ${r.example}/${r.part}: ${rates}; frames ${perPhase}; physics ${physics}; held out ${s.heldOutClaim}, selection [${s.selection.join(', ')}]`);
    const d = r.written?.replay === undefined ? undefined : r.written.deformation;
    if (d !== undefined && typeof d !== 'string') {
      console.log(`  - the replayed step's acceptance: frames grid ${d.schedule.frames.grid}, irr ${d.schedule.frames.irr}; held out ${d.schedule.held_out}, selection ${d.schedule.selection.length} frame(s), every one a grid frame: ${d.schedule.selection.every((id) => id.startsWith('idle@grid@'))}`);
    }
  }
  const refused = results.filter((r) => r.refusal !== null);
  if (refused.length > 0) {
    console.log('\n### Refusals\n');
    for (const r of refused) console.log(`- ${r.example}/${r.part}: ${r.refusal}`);
  }
  const replayed = results.filter((r) => r.refusal === null && r.written?.replay !== undefined).length;
  console.log(`\n${results.length - refused.length} of ${results.length} accepted (${results.length - refused.length - replayed} outright, ${replayed} at a replayed step), ${refused.length} refused.`);
  for (const l of rerunFooter(installedRigc(), pinnedInputs())) console.log(l);
}

/** A residual of a row in a few words: the value, or the state when there is none. */
function residualText(row: AutoMeshReport | undefined, code: string): string {
  const r = row?.residuals.find((x) => x.code === code && x.region === null);
  return r === undefined ? 'absent' : r.value === null ? r.state : `${r.value}${r.state === 'undeclared' ? '' : ` (${r.state})`}`;
}

/** Economy E of `MQ_ALLOCATION_CONTRAST`, from the row's rig-c document (`allocation.contrast.economy`), or the row's state. */
function economyText(row: AutoMeshReport | undefined): string {
  const doc = row?.quality_report as { candidates?: Array<{ geometry?: { rows?: Array<{ code: string; state: string; allocation?: { contrast?: { economy: number } } }> } }> } | undefined;
  const r = doc?.candidates?.[0]?.geometry?.rows?.find((x) => x.code === 'MQ_ALLOCATION_CONTRAST');
  return r === undefined ? 'absent' : r.allocation?.contrast === undefined ? r.state : String(r.allocation.contrast.economy);
}

/** The comparison's setup section (each build's `geometry`) `MQ_DEFORM_LOAD` on the reference (the source) or the candidate (the full result). */
function setupLoad(report: MeshQualityReport | null, which: 'reference' | 'candidate'): string {
  if (report === null) return 'no comparison';
  const section = which === 'reference' ? report.reference?.geometry : report.candidates[0]?.geometry;
  const r = section?.rows.find((x) => x.code === 'MQ_DEFORM_LOAD' && x.object.region === null);
  return r === undefined ? 'absent' : r.value === null ? r.state : String(r.value);
}

/** What the Stage B opt-ins did on the full run, from its row: runs taken, the post-pass, the order. */
function stageBText(row: AutoMeshReport | undefined): string {
  if (row === undefined) return 'not built';
  const out: string[] = [];
  const b = row.result.boundary_runs;
  if (b !== undefined) out.push(`${b.runs} run(s), ${b.vertices} vertex(es)`);
  const rt = row.result.retriangulation;
  if (rt !== undefined) out.push(rt === null ? 'post-pass not reported' : rt.taken ? `post-pass taken, ${rt.flips} flip(s)` : `post-pass refused by ${rt.refusedBy}`);
  if (row.settings.removalOrder !== undefined) out.push(`order ${row.settings.removalOrder}`);
  return out.length === 0 ? 'none' : out.join('; ');
}

/** The Stage B matrix document (module header, `--config`). */
function printMatrix(results: ReadonlyArray<{ config: string; cell: MotionCell; tally: VetoTally | { refused: string } | null }>): void {
  const configs = [...new Set(results.map((r) => r.config))];
  console.log('## Stage B on the public examples (tools/auto_motion_survey.ts --config)\n');
  console.log(
    `Policy: examplePolicy(spacing) (fixtures/automesh.ts) + policyMotion (fixtures/automotion.ts) — maxBoundaryDeviation 1, source tolerance 1, motion bound 1 rig px — plus each configuration's opt-ins and nothing else (STAGE_B_CONFIGS in the tool: ${configs.map((c) => `${c} ${JSON.stringify(extraOf(c))}`).join(', ')}); each part switched alone; the real rig stage with the motion gate and the acceptance loop (src/autoreplay.ts), through the installed rig-c ${installedRigc()}. N is the full run's accepted operations (acceptedAt's length; a boundary run is one), I the refinement's insertions among them. "chosen" is the row the stage wrote — a replayed step's when the acceptance loop chose one.\n`,
  );
  console.log('### Counts, search and motion\n');
  console.log('| part | config | source → full → chosen (hull+interior) | N (I) | chosen step | replays (at most) | candidates: full run / replays | full run\'s termination | MQ_BOUNDARY_DEVIATION (chosen) | full result\'s motion (every frame held out) | chosen: selection / held out | verdict |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const { config, cell: r } of results) {
    const full = r.row?.result.counts;
    const w = r.written?.result.counts;
    const counts = `${r.row === undefined || r.row.source.counts === null ? 'unread' : `${r.row.source.counts.boundaryVertices}+${r.row.source.counts.interiorVertices}`} → ${full === undefined ? 'not built' : `${full.boundaryVertices}+${full.interiorVertices}`} → ${w === undefined ? 'nothing' : `${w.boundaryVertices}+${w.interiorVertices}`}`;
    const n = r.row?.quality_report as { candidates?: Array<{ changes?: { acceptedAt?: Array<{ kind: string }> } }> } | undefined;
    const acc = n?.candidates?.[0]?.changes?.acceptedAt;
    const nI = acc === undefined ? 'n/a' : `${acc.length} (${acc.filter((o) => o.kind === 'insertion').length})`;
    const rp = r.written?.replay;
    const t = r.row?.termination;
    const tried = t !== undefined && (t.reason === 'no-further-valid-reduction' || t.reason === 'budget-exhausted') ? t.candidatesTried : 'n/a';
    const term = t === undefined ? 'n/a' : t.reason === 'no-further-valid-reduction' ? `no-further-valid-reduction, blocked by ${t.blockingConstraint}` : t.reason;
    const role = (x: { value: number | null; frame: string | null } | null | undefined): string => (x === null || x === undefined ? 'n/a' : `${x.value} @ ${x.frame ?? 'every frame'}`);
    const chosenStep = rp !== undefined ? `${rp.chosen_step}` : r.refusal === null ? `${acc?.length ?? 'n/a'} (the full result)` : 'none';
    const replays = rp !== undefined ? `${rp.replays} (${'max_replays' in rp ? rp.max_replays : rp.max_probes})` : r.refusal === null ? '0' : `${/kept none \(([^)]*)\)/.exec(r.refusal)?.[1]?.split(', ').length ?? 0}`;
    const motion = rp !== undefined ? `${role(rp.selection)} / ${role(rp.held_out)}` : 'n/a (no replay)';
    console.log(`| ${r.example}/${r.part} | ${config} | ${counts} | ${nI} | ${chosenStep} | ${replays} | ${tried} / ${rp?.candidates_tried ?? 0} | ${term} | ${residualText(r.written ?? r.row, 'MQ_BOUNDARY_DEVIATION')} | ${cell(rowOf(r.report, 'MQ_LOCAL_DEFORMATION'))} | ${motion} | ${verdictOf(r)} |`);
  }
  console.log('\n### What each opt-in did, and the five allocation rows\n');
  console.log(
    'Read off the full run\'s row (what the opt-ins did) and the chosen row (the five rows; the full run\'s when nothing was written). The five rows are rig-c\'s, every one undeclared — no bound, never required, never the worst residual. MQ_ALLOCATION_CONTRAST and MQ_DEFORM_LOAD read the motion amplitude the stage derives from the idle (src/autoamplitude.ts: θ per pair of bound bones, ε the motion bound) with the author\'s gradation, or null when the config leaves it out (rig-c 2.29.0, rigc#1291). MQ_DEFORM_LOAD is the largest L · Δshare · θ / 4, px — a location reading, not predicted motion; it never reads the gradation. MQ_ALLOCATION_CONTRAST (Δ) and its economy E are measured only with a gradation declared; without one Δ reads not-measurable naming it. The comparison\'s setup load is the same amplitude read on the source and on the full result inside the motion gate (each build\'s setup section); Δ stays not-measurable there, naming targets.maxBoundaryDeviation, which a comparison does not declare.\n',
  );
  console.log(`| part | config | opt-ins on the full run | ${ALLOCATION_ROWS.join(' | ')} | E | comparison setup MQ_DEFORM_LOAD: source / full result | amplitude |`);
  console.log(`| --- | --- | --- | ${ALLOCATION_ROWS.map(() => '---').join(' | ')} | --- | --- | --- |`);
  for (const { config, cell: r } of results) {
    const chosen = r.written ?? r.row;
    const amp = chosen?.motion_amplitude;
    const sent = chosen?.settings.motionAmplitude;
    const ampText = amp === undefined ? 'n/a' : amp.sent ? `sent, gradation ${sent?.gradation === undefined ? 'left out' : String(sent.gradation)}` : `not sent: ${amp.stops.map((x) => x.term).join(', ')}`;
    console.log(
      `| ${r.example}/${r.part} | ${config} | ${stageBText(r.row)} | ${ALLOCATION_ROWS.map((code) => residualText(chosen, code)).join(' | ')} | ${economyText(chosen)} | ${setupLoad(r.report, 'reference')} / ${setupLoad(r.report, 'candidate')} | ${ampText} |`,
    );
  }
  const residual = results.filter((r) => r.tally !== null);
  if (residual.length > 0) {
    console.log('\n### The skinning residual as a per-step veto (rig-c 2.31.0, rigc#1295)\n');
    console.log(
      "Configurations with `motion.residual.maxResidual` 1 (STAGE_B_CONFIGS). The envelope is derived from the idle (src/autoenvelope.ts) through rig-c's skinningEnvelopeBone with the lowest common ancestor of the slot's bone and every bound bone as reference (issue #165: the slot's bone itself when every bound bone hangs below it; otherwise the bone they share, the slot's bone then sent as a bone when the weights bind it); `sent` says whether targets.skinning reached reduceMesh (no = not measurable, the veto not applied, the comparison deciding alone). Vetoed steps are counted on the full run by tools/veto_tally.ts — rig-c's report does not carry them — over removal-phase attempts refused by the residual (removals / boundary runs) of all attempts, and the post-pass when the residual refused it. The residual and its worst sample are the written mesh's own measurement (the chosen row: a replayed step's when the acceptance loop chose one). The residual is a pose-free bound under the envelope, not the motion verdict: the last two columns are the comparison's, which decides.\n",
    );
    console.log('| part | config | sent | reference | envelope (bone linear / translation px) | vetoed: removals / runs of attempts; post-pass | MQ_SKINNING_RESIDUAL (written) @ worst sample | full result\'s motion | verdict |');
    console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const { config, cell: r, tally } of residual) {
      const row = (r.written ?? r.row)?.skinning_residual;
      const env = row?.envelope === null || row?.envelope === undefined ? `not sent: ${(row?.stops ?? []).map((x) => `${x.bone} ${x.code}`).join(', ') || 'no row'}` : row.envelope.map((b) => `${b.bone} ${b.linear} / ${b.translation}`).join('; ');
      const vetoed = tally === null ? 'n/a' : 'refused' in tally ? `not counted: ${tally.refused}` : `${tally.removals} / ${tally.runs} of ${tally.attempts}; ${tally.postPass ?? 'none'}`;
      const m = row?.measured;
      const at = m?.worst === null || m?.worst === undefined ? '' : ` @ ${m.worst.pixel === undefined ? `uv ${JSON.stringify(m.worst.uv)}` : `pixel ${JSON.stringify(m.worst.pixel)}`}`;
      const reading = m === null || m === undefined ? 'not measured' : m.value === null ? `${m.state}: ${m.reason ?? ''}` : `${m.value} / ${m.bound === null ? 'no bound' : `${m.bound.op} ${m.bound.value}`} (${m.state})${at}`;
      console.log(`| ${r.example}/${r.part} | ${config} | ${row === undefined ? 'no row' : row.sent ? 'yes' : 'no'} | ${row?.reference ?? 'n/a'} | ${env} | ${vetoed} | ${reading} | ${cell(rowOf(r.report, 'MQ_LOCAL_DEFORMATION'))} | ${verdictOf(r)} |`);
    }
  }
  const refused = results.filter((r) => r.cell.refusal !== null);
  if (refused.length > 0) {
    console.log('\n### Refusals\n');
    for (const { config, cell: r } of refused) console.log(`- ${r.example}/${r.part} (${config}): ${r.refusal}`);
  }
  console.log('');
  for (const c of configs) {
    const of = results.filter((r) => r.config === c).map((r) => r.cell);
    const nRef = of.filter((r) => r.refusal !== null).length;
    const nRep = of.filter((r) => r.refusal === null && r.written?.replay !== undefined).length;
    console.log(`- ${c}: ${of.length - nRef} of ${of.length} accepted (${of.length - nRef - nRep} outright, ${nRep} at a replayed step), ${nRef} refused.`);
  }
  const footer = rerunFooter(installedRigc(), pinnedInputs());
  footer[footer.length - 2] = `timeout 2700 bun tools/auto_motion_survey.ts --config ${configs.join(',')} > docs/evidence/auto-stageb-survey.md`;
  for (const l of footer) console.log(l);
}

/** The configurations `--config` names, in the order written; an unknown name exits 2 naming the known ones. */
function configsFromArgs(argv: readonly string[]): string[] | null {
  const i = argv.indexOf('--config');
  if (i < 0) return null;
  const names = (argv[i + 1] ?? '').split(',').filter((x) => x !== '');
  const known = STAGE_B_CONFIGS.map(([n]) => n);
  const bad = names.filter((n) => !known.includes(n));
  if (names.length === 0 || bad.length > 0) {
    console.error(`auto_motion_survey: --config takes one or more of ${known.join(', ')}, comma-separated; got "${argv[i + 1] ?? ''}"`);
    process.exit(2);
  }
  return names;
}

function main(): void {
  const missing = missingInputs(PARTS.map(([k]) => k));
  if (missing.length > 0) {
    console.error(`auto_motion_survey: no fetched inputs for ${missing.map((k) => `examples/${k}/inputs`).join(', ')}; run \`bun run fetch-examples\` first`);
    process.exit(1);
  }
  const rigcBin = findRigc(ROOT, '');
  const configs = configsFromArgs(process.argv.slice(2));
  const work = mkdtempSync(join(tmpdir(), 'rig-parts-auto-motion-survey-'));
  const results: MotionCell[] = [];
  const matrix: Array<{ config: string; cell: MotionCell; tally: VetoTally | { refused: string } | null }> = [];
  let disagreements = 0;
  try {
    for (const [key, parts] of PARTS) {
      const asm = assembleExample(work, key);
      for (const part of parts) {
        if (configs !== null) {
          for (const name of configs) {
            const extra = extraOf(name);
            const r = motionCell(key, part, withExtra(withPolicyMotion(examplePolicy(trackedSpacing(key, part))) as unknown as Record<string, unknown>, extra), asm, join(work, key, part, name), rigcBin);
            if (r.disagreement !== null) {
              disagreements++;
              console.error(`auto_motion_survey: ${r.disagreement} (${name})`);
            }
            console.error(`auto_motion_survey: ${key}/${part} ${name}: ${(r.wallMs / 1000).toFixed(1)} s wall, ${r.builds} rigc build(s), ${verdictOf(r)}`);
            // The residual's vetoes, counted on the full run's own input (tools/veto_tally.ts) after the stage's wall time was taken.
            const residual = (extra.motion as { residual?: unknown } | undefined)?.residual !== undefined;
            matrix.push({ config: name, cell: r, tally: residual ? (r.input === null ? { refused: 'the stage made no reduction call' } : vetoTally(r.input)) : null });
          }
          continue;
        }
        const r = motionCell(key, part, withPolicyMotion(examplePolicy(trackedSpacing(key, part))), asm, join(work, key, part), rigcBin);
        if (r.disagreement !== null) {
          disagreements++;
          console.error(`auto_motion_survey: ${r.disagreement}`);
        }
        // Wall time and rigc builds go to standard error: the Markdown holds no clock, so two runs print the same bytes.
        console.error(`auto_motion_survey: ${key}/${part}: ${(r.wallMs / 1000).toFixed(1)} s wall, ${r.builds} rigc build(s), ${verdictOf(r)}`);
        results.push(r);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (configs !== null) printMatrix(matrix);
  else print(results);
  if (disagreements > 0) process.exit(1);
}

if (import.meta.main) main();
