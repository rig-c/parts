#!/usr/bin/env bun
/**
 * Issue #159 Stage A: the automatic mode's `source.spacing` swept on the public
 * parts, everything else held, by one command:
 *
 *     bun run fetch-examples          # once: examples/{reference-demo,reference-sample,scarf}/inputs
 *     bun tools/auto_spacing_survey.ts > docs/evidence/auto-spacing-survey.md
 *
 * **The parts**: the eight the Stage B survey measures
 * (`docs/evidence/auto-stageb-survey.md`, `tools/auto_motion_survey.ts --config`;
 * the parts item 2 accepted on geometry), in that survey's order, each switched
 * **alone** to `auto` in its example's own config.
 *
 * **The policy**: the Stage B survey's baseline, `withPolicyMotion(examplePolicy(p))`
 * (`fixtures/automesh.ts`, `fixtures/automotion.ts`) with `p` the part's tracked
 * spacing (`trackedSpacing`: its lattice `grid`, or the contour spacing of a part
 * already in that mode) — with only `source.spacing` replaced ({@link spacingPolicy}).
 * No region, no Stage B opt-in. The spacings are {@link SWEEP_SPACINGS} and the
 * part's own `p` (the "unchanged" cell, which is the survey's baseline cell),
 * ascending ({@link spacingsFor}).
 *
 * **What runs**: the real rig stage — the gate build, the reference build, rig-c's
 * `compareMeshesInMotion` on the substitute idle, and the acceptance loop with its
 * replay — through the installed rigc (`motionCell`, `tools/auto_motion_survey.ts`).
 * Each (part, spacing) cell runs in a process of its own (this file, `--cell`),
 * killed at `--cell-cap` seconds (default 600) or at what is left of `--budget`
 * seconds (default 3000) for the whole sweep, whichever is less; a cell the budget
 * does not reach is listed as not measured, never dropped.
 *
 * **The invariant**: only the source moves. Each cell's spec is held to the
 * policy's with `source.spacing` alone different ({@link specDifferences}), and
 * each cell's reduction input — everything `reduceMesh` is handed except
 * `source` — is digested field by field ({@link inputDigest}) and compared with
 * the unchanged cell's of the same part ({@link digestDifferences}). A field that
 * differs is named on the page and the tool exits 1: the sweep would no longer be
 * the one field it claims to vary.
 *
 * **The summary** ({@link summarise}): per part the fewest kept vertices among the
 * cells the stage accepted and at which spacing(s); whether that is fewer than at
 * 18 and fewer than at the policy's spacing (the card's "reproduces" criterion);
 * and the first spacing, ascending, whose cell the stage refused on a static row
 * ({@link staticRefusal}: any refusal that is not the motion gate's, nor rig-c refusing the
 * comparison's input, which is read apart: {@link comparisonInputRefusal}), or "none up to
 * the coarsest spacing run".
 *
 * **`--ladder`** (the card's addendum): a second axis, the outline tolerance
 * tol ∈ {@link LADDER_TOLERANCES} ({@link ladderPolicy}: `source.tolerance` =
 * `source.margin` = tol, `targets.maxBoundaryDeviation` = tol,
 * `sourceBounds.maxOvershoot` = 2·tol + 1, everything else the strict policy's),
 * in the budget's order ({@link ladderPlan}: tol 1–4 at the policy's spacing and
 * at 48 for every part first, then the remaining spacings), with each written
 * mesh's {@link overdraw}. Its page ({@link renderLadder}) is appended to the
 * spacing page.
 *
 * Output: Markdown. Every number is read from the stage's rows, rig-c's reports
 * or the summary; no path and no machine is printed. The one column that is not
 * reproducible to the byte is each cell's wall seconds (the stage's own, measured
 * in the cell's process). Exit 1 when an example's inputs are missing, a re-run
 * comparison disagrees with the stage, or any field but the source moves; 0
 * otherwise — a refusal is a result.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type AlphaMask, artOf, type MeshReductionInput, rasteriseTriangles } from '@rig-c/core/mesh';
import { reductionKey, terminationText } from '../src/automesh.ts';
import { findRigc } from '../src/check.ts';
import type { AutoSpec } from '../src/config.ts';
import { PartsError, problemLine } from '../src/errors.ts';
import { examplePolicy } from '../fixtures/automesh.ts';
import { withPolicyMotion } from '../fixtures/automotion.ts';
import { ITEM2_PARTS } from './auto_boundary_survey.ts';
import { assembleExample, cell, installedRigc, missingInputs, type MotionCell, motionCell, pinnedInputs, rowOf, trackedSpacing, verdictOf } from './auto_motion_survey.ts';

const ROOT = resolve(import.meta.dir, '..');

/** The spacings the card names (issue #159), rig px; 18 is one of them, not the policy's. */
export const SWEEP_SPACINGS: readonly number[] = [12, 18, 24, 30, 36, 48];

/** The spacing the card's criterion compares against. */
export const CARD_SPACING = 18;

/** The motion gate's codes (`src/automotion.ts`, `src/autoreplay.ts`): a refusal under one of these is not a static row's. */
export const MOTION_CODES: readonly string[] = ['AUTO_MESH_MOTION', 'AUTO_MESH_SELECTION_BUDGET', 'AUTO_MESH_SELECTION_ROLES', 'AUTO_MESH_NO_STIMULUS'];

/**
 * The code under which rig-c's `compareMeshesInMotion` refused the comparison's input (`src/automotion.ts`): neither
 * a static row nor a motion verdict — no comparison ran — so it is read apart from both ({@link comparisonInputRefusal}).
 */
export const COMPARISON_INPUT_CODE = 'AUTO_MESH_MOTION_INPUT';

/** The spacings a part runs at: the card's and the policy's own, ascending, each once. */
export function spacingsFor(policySpacing: number): number[] {
  return [...new Set([...SWEEP_SPACINGS, policySpacing])].sort((a, b) => a - b);
}

/** The Stage B baseline policy at the part's own spacing, with only `source.spacing` replaced. */
export function spacingPolicy(policySpacing: number, spacing: number): AutoSpec {
  const stated = withPolicyMotion(examplePolicy(policySpacing));
  return { ...stated, source: { ...stated.source, spacing } };
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Every leaf path at which two JSON values differ (`a.b[2]`), in a fixed order; a key on one side only is a difference. */
export function jsonDifferences(a: unknown, b: unknown, path = ''): string[] {
  const x = JSON.parse(JSON.stringify(a ?? null)) as Json;
  const y = JSON.parse(JSON.stringify(b ?? null)) as Json;
  if (x !== null && y !== null && typeof x === 'object' && typeof y === 'object' && Array.isArray(x) === Array.isArray(y)) {
    if (Array.isArray(x) && Array.isArray(y)) {
      const out: string[] = [];
      for (let i = 0; i < Math.max(x.length, y.length); i++) out.push(...jsonDifferences(x[i], y[i], `${path}[${i}]`));
      return out;
    }
    const xo = x as { [k: string]: Json };
    const yo = y as { [k: string]: Json };
    const keys = [...new Set([...Object.keys(xo), ...Object.keys(yo)])].sort();
    const out: string[] = [];
    for (const k of keys) {
      const p = path === '' ? k : `${path}.${k}`;
      if (!(k in xo) || !(k in yo)) out.push(p);
      else out.push(...jsonDifferences(xo[k], yo[k], p));
    }
    return out;
  }
  return JSON.stringify(x) === JSON.stringify(y) ? [] : [path === '' ? '(the whole value)' : path];
}

/** Where a cell's spec differs from the stated policy's other than `source.spacing`; empty when only the spacing moved. */
export function specDifferences(policySpacing: number, cellSpec: AutoSpec): string[] {
  return jsonDifferences(withPolicyMotion(examplePolicy(policySpacing)), cellSpec).filter((p) => p !== 'source.spacing');
}

/** A reduction input's fields but `source`, each as the SHA-256 of its `reductionKey` bytes, in key order. */
export function inputDigest(input: MeshReductionInput): Record<string, string> {
  const out: Record<string, string> = {};
  const fields = input as unknown as Record<string, unknown>;
  for (const k of Object.keys(fields).sort()) {
    if (k === 'source') continue;
    const bytes = reductionKey({ [k]: fields[k] } as unknown as MeshReductionInput);
    out[k] = createHash('sha256').update(bytes).digest('hex');
  }
  return out;
}

/** The fields whose digest differs between two cells (a field on one side only included), in key order. */
export function digestDifferences(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().filter((k) => a[k] !== b[k]);
}

/** A refusal's static rows: each problem line whose code is not the motion gate's, as its code and any `MQ_*` row it names failing; null when there is none. */
export function staticRefusal(refusal: string | null): string | null {
  if (refusal === null) return null;
  const named: string[] = [];
  for (const line of refusal.split('\n')) {
    const code = /^([A-Z][A-Z0-9_]*):/.exec(line)?.[1];
    if (code === undefined || MOTION_CODES.includes(code) || code === COMPARISON_INPUT_CODE) continue;
    const rows = [...new Set([...line.matchAll(/(MQ_[A-Z0-9_]+)(?: \[region "[^"]*"\])? fail/g)].map((m) => m[1]))];
    named.push(rows.length === 0 ? code : `${code} (${rows.join(', ')})`);
  }
  return named.length === 0 ? null : named.join('; ');
}

/** A refusal's comparison-input lines: rig-c's own code for each (`(COMPARE_…)` in the detail), or null when there is none. */
export function comparisonInputRefusal(refusal: string | null): string | null {
  if (refusal === null) return null;
  const named: string[] = [];
  for (const line of refusal.split('\n')) {
    if (!line.startsWith(`${COMPARISON_INPUT_CODE}:`)) continue;
    const inner = /refused the comparison's input \(([A-Z][A-Z0-9_]*)\)/.exec(line)?.[1];
    named.push(inner === undefined ? COMPARISON_INPUT_CODE : `${COMPARISON_INPUT_CODE} (${inner})`);
  }
  return named.length === 0 ? null : named.join('; ');
}

/** Hull and interior vertex counts. */
export interface HullInterior {
  hull: number;
  interior: number;
}

/** One (part, spacing) cell as the page prints it. */
export interface SpacingRow {
  example: string;
  part: string;
  spacing: number;
  policySpacing: number;
  /** Where the cell's spec differs from the policy's other than `source.spacing` (empty: only the spacing moved). */
  specMoved: string[];
  source: HullInterior | null;
  full: HullInterior | null;
  /** The mesh the stage wrote: the full result, or the replayed step its acceptance loop chose. */
  kept: HullInterior | null;
  /** The full run's accepted operations (acceptedAt's length). */
  steps: number | null;
  /** The replayed step the acceptance loop chose, or null when the full result was written or nothing was. */
  chosenStep: number | null;
  termination: string;
  /** The full result's MQ_LOCAL_DEFORMATION on the whole idle (value / bound @ worst frame) and its state. */
  fullMotion: string;
  fullMotionState: string;
  /** The written replayed step's held-out reading (value @ worst frame), or a word when there is none. */
  chosenMotion: string;
  verdict: string;
  /** Every problem line of the stage's refusal, or null when it accepted. */
  refusal: string | null;
  /** The inputs' fields but `source`, digested ({@link inputDigest}), or null when the stage made no reduction call. */
  digest: Record<string, string> | null;
  /** The stage's wall time in the cell's process, s; null when the cell did not finish. */
  wallSeconds: number | null;
  disagreement: string | null;
  /** Why the cell has no result: stopped at its cap, the budget, or its process failing; null when it finished. */
  stopped: string | null;
}

/** A row before (or without) a result. */
export function pendingRow(example: string, part: string, spacing: number, policySpacing: number): SpacingRow {
  return {
    example,
    part,
    spacing,
    policySpacing,
    specMoved: specDifferences(policySpacing, spacingPolicy(policySpacing, spacing)),
    source: null,
    full: null,
    kept: null,
    steps: null,
    chosenStep: null,
    termination: 'no reduction finished',
    fullMotion: 'not measured',
    fullMotionState: 'not measured',
    chosenMotion: 'not measured',
    verdict: 'not finished',
    refusal: null,
    digest: null,
    wallSeconds: null,
    disagreement: null,
    stopped: null,
  };
}

/** A finished cell from the stage's {@link MotionCell}. */
export function rowOfCell(r: MotionCell, spacing: number, policySpacing: number): SpacingRow {
  const hi = (c: { boundaryVertices: number; interiorVertices: number } | null | undefined): HullInterior | null => (c === null || c === undefined ? null : { hull: c.boundaryVertices, interior: c.interiorVertices });
  const q = r.row?.quality_report as { candidates?: Array<{ changes?: { acceptedAt?: unknown[] } }> } | undefined;
  const rp = r.written?.replay;
  const local = rowOf(r.report, 'MQ_LOCAL_DEFORMATION');
  const held = rp?.held_out;
  return {
    ...pendingRow(r.example, r.part, spacing, policySpacing),
    source: hi(r.row?.source.counts),
    full: hi(r.row?.result.counts),
    kept: hi(r.written?.result.counts),
    steps: q?.candidates?.[0]?.changes?.acceptedAt?.length ?? null,
    chosenStep: rp === undefined ? null : rp.chosen_step,
    termination: r.row === undefined ? 'no reduction ran' : terminationText(r.row.termination),
    fullMotion: cell(local),
    fullMotionState: local === undefined ? 'not measured' : local.state,
    chosenMotion: rp === undefined ? (r.written === undefined ? 'nothing written' : 'the full result') : held === null || held === undefined ? 'n/a' : `${held.value} @ ${held.frame ?? 'every frame'}`,
    verdict: verdictOf(r),
    refusal: r.refusal,
    digest: r.input === null ? null : inputDigest(r.input),
    wallSeconds: Math.round(r.wallMs / 100) / 10,
    disagreement: r.disagreement,
  };
}

/** Whether the stage accepted the cell (it wrote a mesh). */
const passed = (r: SpacingRow): boolean => r.stopped === null && r.refusal === null && r.kept !== null;
const total = (c: HullInterior): number => c.hull + c.interior;

/** One part's summary (module header). */
export interface PartSummary {
  example: string;
  part: string;
  policySpacing: number;
  /** The fewest kept vertices among accepted cells, or null when none was accepted. */
  fewest: number | null;
  /** Every spacing whose accepted cell kept that many, ascending. */
  fewestAt: number[];
  /** Kept vertices at 18 and at the policy's spacing, or null when that cell was not accepted. */
  atCard: number | null;
  atPolicy: number | null;
  /** Whether the fewest is strictly below the 18 cell's count and below the policy cell's (null when that cell was not accepted). */
  belowCard: boolean | null;
  belowPolicy: boolean | null;
  /** The first spacing, ascending, whose cell refused on a static row, and the rows; null when none did. */
  firstStatic: { spacing: number; rows: string } | null;
  /** Every finished spacing whose refusal is the comparison refusing its input, ascending, with rig-c's code. */
  comparisonInput: Array<{ spacing: number; codes: string }>;
  /** The coarsest spacing a cell finished at (accepted or refused), or null when none finished. */
  coarsestRun: number | null;
  /** Spacings with no result (stopped, budget, process), ascending. */
  unmeasured: number[];
}

/** The per-part summary of a part's rows (in any order). */
export function summarise(rows: readonly SpacingRow[]): PartSummary {
  const sorted = [...rows].sort((a, b) => a.spacing - b.spacing);
  const first = sorted[0];
  const ok = sorted.filter(passed);
  const fewest = ok.length === 0 ? null : Math.min(...ok.map((r) => total(r.kept as HullInterior)));
  const at = (s: number): number | null => {
    const r = ok.find((x) => x.spacing === s);
    return r === undefined ? null : total(r.kept as HullInterior);
  };
  const atCard = at(CARD_SPACING);
  const atPolicy = at(first.policySpacing);
  const finished = sorted.filter((r) => r.stopped === null);
  const statics = finished.map((r) => ({ spacing: r.spacing, rows: staticRefusal(r.refusal) }));
  const st = statics.find((s) => s.rows !== null);
  return {
    example: first.example,
    part: first.part,
    policySpacing: first.policySpacing,
    fewest,
    fewestAt: fewest === null ? [] : ok.filter((r) => total(r.kept as HullInterior) === fewest).map((r) => r.spacing),
    atCard,
    atPolicy,
    belowCard: fewest === null || atCard === null ? null : fewest < atCard,
    belowPolicy: fewest === null || atPolicy === null ? null : fewest < atPolicy,
    firstStatic: st === undefined || st.rows === null ? null : { spacing: st.spacing, rows: st.rows },
    comparisonInput: finished.flatMap((r) => {
      const codes = comparisonInputRefusal(r.refusal);
      return codes === null ? [] : [{ spacing: r.spacing, codes }];
    }),
    coarsestRun: finished.length === 0 ? null : finished[finished.length - 1].spacing,
    unmeasured: sorted.filter((r) => r.stopped !== null).map((r) => r.spacing),
  };
}

/** Whether the finding reproduces on a part: its fewest passing count is below the 18 cell's. */
export const reproduces = (s: PartSummary): boolean => s.belowCard === true;

/** For each cell, the input fields (but `source`) that differ from the unchanged cell's of the same part; a cell with no digest compares as none. */
export function inputMoved(rows: readonly SpacingRow[]): Map<SpacingRow, string[]> {
  const out = new Map<SpacingRow, string[]>();
  for (const r of rows) {
    const base = rows.find((x) => x.example === r.example && x.part === r.part && x.spacing === x.policySpacing);
    out.set(r, r.digest === null || base === undefined || base.digest === null ? [] : digestDifferences(base.digest, r.digest));
  }
  return out;
}

const hiText = (c: HullInterior | null, none: string): string => (c === null ? none : `${c.hull}+${c.interior}`);
const yn = (b: boolean | null, none: string): string => (b === null ? none : b ? 'yes' : 'no');

/** The first paragraph's verdict, from the summaries alone. */
export function reproductionText(sums: readonly PartSummary[]): string {
  const yes = sums.filter(reproduces).map((s) => `${s.example}/${s.part}`);
  const no = sums.filter((s) => s.belowCard === false).map((s) => `${s.example}/${s.part}`);
  const open = sums.filter((s) => s.belowCard === null).map((s) => `${s.example}/${s.part}`);
  const word = yes.length === 0 ? 'No' : no.length === 0 && open.length === 0 ? 'Yes' : 'Partly';
  const list = (l: string[]): string => (l.length === 0 ? 'none' : l.join(', '));
  return (
    `**Does the finding reproduce on the public parts? ${word}.** The criterion is the card's: the fewest vertices the stage accepted is strictly below the count it accepted at spacing ${CARD_SPACING}. ` +
    `Below it: ${list(yes)}. Not below it (a coarser lattice kept no fewer vertices than ${CARD_SPACING}): ${list(no)}. Not decidable (the ${CARD_SPACING} cell or every cell not accepted, or not measured): ${list(open)}.`
  );
}

/** The second paragraph: the relation to issue #148, argued from what each varies; no measured figure. */
export const RELATION_148 =
  "**Relation to #148 (multi-interval replay selection).** They compose; neither subsumes the other. #148's selection varies which accepted step of one reduction run is written — a prefix of that run's acceptedAt, every candidate a mesh on the one path the reduction took from one source — so it can never write a vertex that source does not have. `source.spacing` varies the source itself, and with it the lattice every kept interior vertex sits on (the reduction removes vertices and never moves them) and the path the reduction then takes. A search over spacing is therefore the outer loop and the step selection the inner one: each spacing tried yields its own run, over whose steps the replay selection (bisection or #148's multi-interval) picks the written step.";

/** The Markdown for a list of cells (in the order run); no clock but each finished cell's wall seconds, no path, no machine. */
export function render(rows: readonly SpacingRow[], rigcVersion: string, pinned: string, capSeconds: number, budgetSeconds: number): string[] {
  const out: string[] = [];
  const parts: Array<[string, string]> = [];
  for (const r of rows) if (!parts.some(([k, p]) => k === r.example && p === r.part)) parts.push([r.example, r.part]);
  const moved = inputMoved(rows);
  out.push('# The automatic source spacing swept on the public parts (issue #159, Stage A)', '');
  out.push(
    `Generated by \`bun tools/auto_spacing_survey.ts\`; every figure below is the tool's, none typed. The installed rig-c ${rigcVersion}. The parts are the public examples' (demo, sample, scarf), the eight the Stage B survey measures (docs/evidence/auto-stageb-survey.md), in its order, each switched alone to \`auto\` in its example's own config. Policy: withPolicyMotion(examplePolicy(p)) (fixtures/automesh.ts, fixtures/automotion.ts) — the Stage B survey's baseline, p the part's tracked spacing — with only \`source.spacing\` replaced; no region, no Stage B opt-in. The real rig stage: gate build, reference build, rig-c's compareMeshesInMotion on the idle, and the acceptance loop with its replay (src/autoreplay.ts). Each cell runs in a process of its own, stopped at ${capSeconds} s or at what is left of the sweep's ${budgetSeconds} s budget, whichever is less.`,
    '',
  );
  out.push('## The policy\'s spacing today', '');
  out.push('The public policy takes each part\'s spacing from its tracked mesh entry (`trackedSpacing`: the lattice `grid`, or the contour spacing of a part already in that mode); it is not one number across the parts. The "unchanged" cell of each part is that value.', '');
  out.push('| part | policy spacing (rig px) | from | spacings run |');
  out.push('| --- | --- | --- | --- |');
  for (const [k, p] of parts) {
    const of = rows.filter((r) => r.example === k && r.part === p);
    out.push(`| ${k}/${p} | ${of[0].policySpacing} | examples/${k}/config.json meshes.${p} | ${of.map((r) => r.spacing).join(', ')} |`);
  }
  out.push('', '## The sweep', '');
  out.push(
    '"full" is the reduction\'s whole result, "kept" the mesh the stage wrote (the replayed step\'s when the acceptance loop chose one); N is the full run\'s accepted operations. Motion values are MQ_LOCAL_DEFORMATION in rig px at the worst frame: the full result on the whole idle with every frame held out, and the chosen step\'s held-out reading. "static refusal" names each refusal line that is not the motion gate\'s, by its code and the MQ rows it names failing; "comparison refused its input" is rig-c\'s compareMeshesInMotion refusing the motion comparison\'s input (no comparison ran, so neither a static row nor a motion verdict), with rig-c\'s code. "only the source moved" compares the cell\'s spec with the policy\'s (only `source.spacing` may differ) and every field of its reduction input but `source` with the unchanged cell\'s, by SHA-256 of their bytes. Wall seconds are the stage\'s, in the cell\'s own process, on the machine that ran the sweep — the one column not reproducible to the byte.',
    '',
  );
  out.push('| part | spacing | source → full → kept (hull+interior) | kept vertices | full run\'s termination | chosen step (of N) | full result\'s motion (state) | chosen step\'s motion (held out) | static refusal | comparison refused its input | only the source moved | verdict | wall s |');
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    const mark = r.spacing === r.policySpacing ? `${r.spacing} (unchanged)` : `${r.spacing}`;
    const counts = `${hiText(r.source, 'not built')} → ${hiText(r.full, 'not built')} → ${hiText(r.kept, 'nothing')}`;
    const chosen = r.chosenStep === null ? (r.kept === null ? 'none' : `${r.steps ?? 'n/a'} of ${r.steps ?? 'n/a'} (the full result)`) : `${r.chosenStep} of ${r.steps ?? 'n/a'}`;
    const m = [...r.specMoved.map((p) => `spec ${p}`), ...(moved.get(r) ?? []).map((f) => `input ${f}`)];
    const only = r.stopped !== null && r.digest === null ? (r.specMoved.length === 0 ? 'spec: yes; input: not read' : `no — ${m.join(', ')}`) : m.length === 0 ? 'yes' : `no — ${m.join(', ')}`;
    out.push(
      `| ${r.example}/${r.part} | ${mark} | ${counts} | ${r.kept === null ? '—' : total(r.kept)} | ${r.stopped ?? r.termination} | ${chosen} | ${r.fullMotion} (${r.fullMotionState}) | ${r.chosenMotion} | ${staticRefusal(r.refusal) ?? 'none'} | ${comparisonInputRefusal(r.refusal) ?? 'none'} | ${only} | ${r.stopped ?? r.verdict} | ${r.wallSeconds ?? '—'} |`,
    );
  }
  const sums = parts.map(([k, p]) => summarise(rows.filter((r) => r.example === k && r.part === p)));
  out.push('', '## Per part', '');
  out.push(`"fewest" is the fewest vertices among the cells the stage accepted; "below ${CARD_SPACING}" and "below the policy's" ask whether it is strictly fewer than that cell's own accepted count (— when that cell was not accepted). "first static refusal" is the first spacing, ascending over every finished cell, whose refusal names a static row.`, '');
  out.push(`| part | policy spacing | fewest kept (at spacing) | at ${CARD_SPACING} | at the policy's | below ${CARD_SPACING} | below the policy's | first static refusal | comparison refused its input at | not measured |`);
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of sums) {
    const fewest = s.fewest === null ? 'none accepted' : `${s.fewest} (at ${s.fewestAt.join(', ')})`;
    const st = s.firstStatic === null ? (s.coarsestRun === null ? 'no cell finished' : `none up to ${s.coarsestRun}`) : `${s.firstStatic.spacing}: ${s.firstStatic.rows}`;
    out.push(
      `| ${s.example}/${s.part} | ${s.policySpacing} | ${fewest} | ${s.atCard ?? '—'} | ${s.atPolicy ?? '—'} | ${yn(s.belowCard, '—')} | ${yn(s.belowPolicy, '—')} | ${st} | ${s.comparisonInput.length === 0 ? 'none' : s.comparisonInput.map((x) => `${x.spacing}: ${x.codes}`).join('; ')} | ${s.unmeasured.length === 0 ? 'none' : s.unmeasured.join(', ')} |`,
    );
  }
  out.push('', reproductionText(sums), '', RELATION_148);
  const unmeasured = rows.filter((r) => r.stopped !== null);
  if (unmeasured.length > 0) {
    out.push('', '## Cells not measured', '');
    for (const r of unmeasured) out.push(`- ${r.example}/${r.part} at spacing ${r.spacing}: ${r.stopped}`);
  }
  const refused = rows.filter((r) => r.refusal !== null);
  if (refused.length > 0) {
    out.push('', '## Refusals', '');
    for (const r of refused) out.push(`- ${r.example}/${r.part} at spacing ${r.spacing}: ${r.refusal?.replace(/\n/g, ' / ')}`);
  }
  out.push(...rerunSection(rigcVersion, pinned, capSeconds, budgetSeconds));
  return out;
}

/** "Re-running this evidence": the inputs at their pinned commit, rig-c as the lock installs it, the command and its caps. */
export function rerunSection(rigcVersion: string, pinned: string, capSeconds: number, budgetSeconds: number): string[] {
  return [
    '',
    '## Re-running this evidence',
    '',
    `Inputs: the public examples demo, sample and scarf of https://github.com/firejune/spine-parts-examples at commit ${pinned} (the pin in \`scripts/fetch-examples.sh\`; \`bun run fetch-examples\` copies them into the gitignored \`examples/<key>/inputs\`), each with its tracked \`examples/<key>/config.json\`; rig-c ${rigcVersion} as \`bun install --frozen-lockfile\` installs it from \`bun.lock\`; spacings ${SWEEP_SPACINGS.join(', ')} and each part's own; each cell stopped at ${capSeconds} s, the sweep at ${budgetSeconds} s. No other input is read, and nothing is written but standard output (the cells run in a temporary directory, removed afterwards).`,
    '',
    '```sh',
    'bun install --frozen-lockfile',
    'bun run fetch-examples',
    `bun tools/auto_spacing_survey.ts --cell-cap ${capSeconds} --budget ${budgetSeconds} > docs/evidence/auto-spacing-survey.md`,
    '```',
  ];
}

// ---------------------------------------------------------------------------
// `--ladder`: the outline tolerance ladder (issue #159 addendum), with overdraw per cell.
// ---------------------------------------------------------------------------

/** The ladder's outline tolerances, rig px; 1 is the strict policy as it is. */
export const LADDER_TOLERANCES: readonly number[] = [1, 2, 3, 4];

/** The spec fields a ladder cell may move from the stated policy (the addendum's rule, and the spacing). */
export const LADDER_FIELDS: readonly string[] = ['source.margin', 'source.spacing', 'source.tolerance', 'sourceBounds.maxOvershoot', 'targets.maxBoundaryDeviation'];

/** The reduction-input fields a ladder cell may move from the tol-1 cell of the same part, besides `source`. */
export const LADDER_INPUT_FIELDS: readonly string[] = ['sourceBounds.maxOvershoot', 'targets.maxBoundaryDeviation'];

/**
 * The two readings of the rung's overshoot. `held`: the addendum as written — only `sourceBounds.maxOvershoot` moves
 * with the rung, `targets.artFit.maxOvershoot` stays the strict policy's 3. `widened`: every overshoot bound moves —
 * `targets.artFit.maxOvershoot` = 2·tol + 1 as well. `targets.artFit.minCoverage` (1) and `maxUndercut` (0) are left
 * in both: a wider margin moves the outline outward, which can only cover more of the art, so neither bound is the
 * one a wider outline runs into.
 */
export type ArtFitReading = 'held' | 'widened';

/** The spec and input fields a rung may move beyond {@link LADDER_FIELDS} / {@link LADDER_INPUT_FIELDS} under a reading. */
const extraSpecFields = (artFit: ArtFitReading): string[] => (artFit === 'widened' ? ['targets.artFit.maxOvershoot'] : []);
const extraInputFields = (artFit: ArtFitReading): string[] => (artFit === 'widened' ? ['targets.artFit'] : []);

/**
 * One rung of the ladder (the addendum): the stated policy at the part's spacing with `source.spacing` replaced, and
 * at tolerance `tol` the outline's own three numbers moved together — `source.tolerance` = `source.margin` = `tol`
 * (the outline the source is traced at), `targets.maxBoundaryDeviation` = `tol`, `sourceBounds.maxOvershoot` =
 * `2·tol + 1` (the contour mode's own bound, margin + tolerance + 1). Everything else is the strict policy's,
 * `targets.artFit` (overshoot 3) and the motion bound (1 rig px) included. At tol 1 it is {@link spacingPolicy}.
 */
export function ladderPolicy(policySpacing: number, spacing: number, tol: number, artFit: ArtFitReading = 'held'): AutoSpec {
  const s = spacingPolicy(policySpacing, spacing);
  return {
    ...s,
    source: { ...s.source, tolerance: tol, margin: tol },
    sourceBounds: { ...s.sourceBounds, maxOvershoot: 2 * tol + 1 },
    targets: { ...s.targets, maxBoundaryDeviation: tol, ...(artFit === 'widened' ? { artFit: { ...s.targets.artFit, maxOvershoot: 2 * tol + 1 } } : {}) },
  };
}

/** Where a ladder cell's spec differs from its rung, and every field it moves from the stated policy outside {@link LADDER_FIELDS}. */
export function ladderSpecDifferences(policySpacing: number, spacing: number, tol: number, cellSpec: AutoSpec, artFit: ArtFitReading = 'held'): string[] {
  const off = jsonDifferences(ladderPolicy(policySpacing, spacing, tol, artFit), cellSpec).map((p) => `not the rung: ${p}`);
  const allowed = [...LADDER_FIELDS, ...extraSpecFields(artFit)];
  const outside = jsonDifferences(withPolicyMotion(examplePolicy(policySpacing)), cellSpec).filter((p) => !allowed.includes(p));
  return [...off, ...outside];
}

/** {@link inputDigest} one level deeper: a plain-object field is digested key by key (`targets.maxBoundaryDeviation`). */
export function inputDigestDeep(input: MeshReductionInput): Record<string, string> {
  const out: Record<string, string> = {};
  const fields = input as unknown as Record<string, unknown>;
  const digest = (v: unknown): string => createHash('sha256').update(reductionKey({ v } as unknown as MeshReductionInput)).digest('hex');
  for (const k of Object.keys(fields).sort()) {
    if (k === 'source') continue;
    const v = fields[k];
    const plain = v !== null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v) && Object.getPrototypeOf(v) === Object.prototype;
    if (!plain) {
      out[k] = digest(v);
      continue;
    }
    for (const sub of Object.keys(v as Record<string, unknown>).sort()) out[`${k}.${sub}`] = digest((v as Record<string, unknown>)[sub]);
  }
  return out;
}

/**
 * Overdraw: of the pixels the written mesh draws over — rig-c's `rasteriseTriangles`, a pixel inside when its centre
 * (x + 0.5, y + 0.5) is in or on a triangle, degenerate triangles skipped, the union of the triangles — those that are
 * transparent (alpha below the art threshold), over the art pixels (alpha at or above it), both on the part's padded
 * image grid the reduction was handed.
 */
export function overdraw(mask: AlphaMask, threshold: number, points: ReadonlyArray<readonly [number, number]>, triangles: readonly number[]): { transparent: number; art: number } {
  const art = artOf(mask, threshold);
  const drawn = rasteriseTriangles(
    points.map(([x, y]) => [x, y] as [number, number]),
    [...triangles],
    mask.width,
    mask.height,
  );
  let transparent = 0;
  let artPixels = 0;
  for (let i = 0; i < art.length; i++) {
    if (art[i]) artPixels++;
    else if (drawn[i]) transparent++;
  }
  return { transparent, art: artPixels };
}

/** Overdraw as the page prints it: the percentage to two places and its two counts. */
export function overdrawText(o: { transparent: number; art: number } | null, none: string): string {
  if (o === null) return none;
  if (o.art === 0) return `no art pixels (${o.transparent} transparent drawn)`;
  return `${(Math.round((o.transparent / o.art) * 10000) / 100).toFixed(2)} % (${o.transparent} / ${o.art})`;
}

/** The mesh the stage wrote for a cell, read off the stage's own reductions (the full run, or the replay at the chosen step). */
export function writtenMesh(c: MotionCell): { points: ReadonlyArray<readonly [number, number]>; triangles: readonly number[] } | string {
  if (c.input === null) return 'the stage made no reduction call';
  if (c.written === undefined) return 'nothing written';
  const chosen = c.written.replay?.chosen_step;
  const key = reductionKey(chosen === undefined ? c.input : { ...c.input, stopAfterAccepted: chosen });
  const r = c.reductions.get(key);
  if (r === undefined) return `the stage ran no reduction at ${chosen === undefined ? 'the full input' : `stopAfterAccepted ${chosen}`}`;
  if ('code' in r || r.mesh === null) return 'that reduction returned no mesh';
  const w = c.written.result.counts;
  if (r.mesh.counts.boundaryVertices !== w.boundaryVertices || r.mesh.counts.interiorVertices !== w.interiorVertices || r.mesh.counts.triangles !== w.triangles) {
    return `the stage's reduction counts ${r.mesh.counts.boundaryVertices}+${r.mesh.counts.interiorVertices} are not the written row's ${w.boundaryVertices}+${w.interiorVertices}`;
  }
  return { points: r.mesh.points, triangles: r.mesh.triangles };
}

/** One ladder cell: the spacing row, its tolerance, the phase it was planned in, and its overdraw. */
export interface LadderRow extends SpacingRow {
  tol: number;
  phase: 1 | 2 | 3;
  overdraw: { transparent: number; art: number } | null;
  /** Why there is no overdraw, when there is none. */
  overdrawNote: string | null;
  /** The finer digest ({@link inputDigestDeep}), or null when the stage made no reduction call. */
  deep: Record<string, string> | null;
}

/** One planned ladder cell. */
export interface LadderCell {
  example: string;
  part: string;
  policySpacing: number;
  spacing: number;
  tol: number;
  phase: 1 | 2 | 3;
}

/**
 * The ladder's order (the addendum's budget): phase 1, every part in the survey's order, tol 1 to 4 at the policy's
 * spacing and at 48 (tol 1 included, so overdraw is read on the cells the rungs are compared with); phase 2, tol 2 to 4
 * at the remaining spacings; phase 3, tol 1 at the remaining spacings (the spacing sweep's cells, re-run for overdraw).
 * Within a part and phase: tolerance, then spacing, ascending.
 */
export function ladderPlan(parts: ReadonlyArray<readonly [string, string, number]>): LadderCell[] {
  const out: LadderCell[] = [];
  const first = (p: number): number[] => [...new Set([p, 48])].sort((a, b) => a - b);
  for (const [example, part, policySpacing] of parts) for (const tol of LADDER_TOLERANCES) for (const spacing of first(policySpacing)) out.push({ example, part, policySpacing, spacing, tol, phase: 1 });
  for (const [example, part, policySpacing] of parts) {
    for (const tol of LADDER_TOLERANCES.filter((t) => t !== 1)) for (const spacing of spacingsFor(policySpacing).filter((s) => !first(policySpacing).includes(s))) out.push({ example, part, policySpacing, spacing, tol, phase: 2 });
  }
  for (const [example, part, policySpacing] of parts) for (const spacing of spacingsFor(policySpacing).filter((s) => !first(policySpacing).includes(s))) out.push({ example, part, policySpacing, spacing, tol: 1, phase: 3 });
  return out;
}

/** The widened reading's plan: {@link ladderPlan} without phase 3 (tol 1 is the same policy under both readings, and the held ladder measured it at every spacing); tol 1 at the policy's spacing and at 48 is kept as each part's base cell. */
export function widenedPlan(parts: ReadonlyArray<readonly [string, string, number]>): LadderCell[] {
  return ladderPlan(parts).filter((c) => c.phase !== 3);
}

/** A ladder row before (or without) a result. */
export function pendingLadderRow(c: LadderCell, artFit: ArtFitReading = 'held'): LadderRow {
  return { ...pendingRow(c.example, c.part, c.spacing, c.policySpacing), specMoved: ladderSpecDifferences(c.policySpacing, c.spacing, c.tol, ladderPolicy(c.policySpacing, c.spacing, c.tol, artFit), artFit), tol: c.tol, phase: c.phase, overdraw: null, overdrawNote: 'no mesh written', deep: null };
}

/** For each ladder cell, the input fields (but `source`) it moves from the tol-1 cell at the policy's spacing of the same part, outside {@link LADDER_INPUT_FIELDS}. */
export function ladderInputMoved(rows: readonly LadderRow[], artFit: ArtFitReading = 'held'): Map<LadderRow, string[]> {
  const allowed = [...LADDER_INPUT_FIELDS, ...extraInputFields(artFit)];
  const out = new Map<LadderRow, string[]>();
  for (const r of rows) {
    const base = rows.find((x) => x.example === r.example && x.part === r.part && x.tol === 1 && x.spacing === x.policySpacing);
    const moved = r.deep === null || base === undefined || base.deep === null ? [] : digestDifferences(base.deep, r.deep);
    out.set(r, moved.filter((f) => !(r.tol !== 1 && allowed.includes(f))));
  }
  return out;
}

/** The ladder's Markdown (in the order run): the cells, then per part and tolerance the summary; no path, no machine. */
export function renderLadder(rows: readonly LadderRow[], rigcVersion: string, pinned: string, capSeconds: number, budgetSeconds: number, artFit: ArtFitReading = 'held'): string[] {
  const widened = artFit === 'widened';
  const out: string[] = [];
  const parts: Array<[string, string]> = [];
  for (const r of rows) if (!parts.some(([k, p]) => k === r.example && p === r.part)) parts.push([r.example, r.part]);
  const moved = ladderInputMoved(rows, artFit);
  if (widened) {
    out.push('# The outline tolerance ladder, artFit widened with the rung, and overdraw on the public parts (issue #159, Stage A addendum)', '');
    out.push(
      `Generated by \`bun tools/auto_spacing_survey.ts --ladder --artfit widened\`; every figure below is the tool's, none typed. The installed rig-c ${rigcVersion}. The parts and the stage are the spacing sweep's. Each rung tol ∈ {${LADDER_TOLERANCES.join(', ')}} is the strict policy with source.tolerance = source.margin = tol, targets.maxBoundaryDeviation = tol, and every overshoot bound at 2·tol + 1 — sourceBounds.maxOvershoot and targets.artFit.maxOvershoot both; targets.artFit's coverage (1) and undercut (0) are left as the strict policy's (a wider margin moves the outline outward, which can only cover more art), and so is the motion bound (MQ_LOCAL_DEFORMATION ≤ 1 rig px) — so tol 1 is the spacing sweep's policy unchanged. Each cell runs in a process of its own, stopped at ${capSeconds} s or at what is left of the ladder's ${budgetSeconds} s budget, whichever is less.`,
      '',
      'Order (the budget\'s priority): phase 1 — every part in the survey\'s order, tol 1 to 4 at the policy\'s spacing and at 48 (tol 1 is each part\'s base cell); phase 2 — tol 2 to 4 at the remaining spacings. Tol 1 at the remaining spacings is the held ladder\'s phase 3 (the same policy) and is not run again. A cell the budget did not reach is listed, never dropped.',
      '',
    );
  } else {
    out.push('# The outline tolerance ladder, artFit held at 3, and overdraw on the public parts (issue #159, Stage A addendum)', '');
    out.push(
      `Generated by \`bun tools/auto_spacing_survey.ts --ladder\`; every figure below is the tool's, none typed. The installed rig-c ${rigcVersion}. The parts and the stage are the spacing sweep's. Each rung tol ∈ {${LADDER_TOLERANCES.join(', ')}} is the strict policy with source.tolerance = source.margin = tol, targets.maxBoundaryDeviation = tol and sourceBounds.maxOvershoot = 2·tol + 1; everything else the strict policy's — targets.artFit (coverage 1, overshoot ≤ 3, undercut 0) and the motion bound (MQ_LOCAL_DEFORMATION ≤ 1 rig px) included — so tol 1 is the spacing sweep's policy unchanged. Each cell runs in a process of its own, stopped at ${capSeconds} s or at what is left of the ladder's ${budgetSeconds} s budget, whichever is less.`,
      '',
      'Order (the budget\'s priority): phase 1 — every part in the survey\'s order, tol 1 to 4 at the policy\'s spacing and at 48; phase 2 — tol 2 to 4 at the remaining spacings; phase 3 — tol 1 at the remaining spacings (the spacing sweep\'s own cells, re-run here for their overdraw). A cell the budget did not reach is listed, never dropped.',
      '',
    );
  }
  out.push(
    'Overdraw: of the pixels the written mesh draws over, those that are transparent (alpha below 1), over the art pixels (alpha 1 and above), on the part\'s padded image grid the reduction was handed. Rasteriser: rig-c\'s `rasteriseTriangles` (the `@rig-c/core/mesh` entry), a pixel inside when its centre (x + 0.5, y + 0.5) is in or on a triangle, the union of the triangles, degenerate triangles skipped; the mesh is the one the stage wrote (the full result, or the replayed step the acceptance loop chose), read off the stage\'s own reduction. This package\'s `src/raster/poly.ts` `fillPoly` is cv2\'s fill on integer vertices, not a centre rule, so it is not used here.',
    '',
  );
  out.push('## The cells', '');
  out.push('| part | tol | spacing | phase | source → full → kept (hull+interior) | kept vertices | full run\'s termination | chosen step (of N) | full result\'s motion (state) | chosen step\'s motion (held out) | static refusal | comparison refused its input | only the rung\'s fields moved | overdraw | verdict | wall s |');
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    const mark = r.spacing === r.policySpacing ? `${r.spacing} (policy)` : `${r.spacing}`;
    const counts = `${hiText(r.source, 'not built')} → ${hiText(r.full, 'not built')} → ${hiText(r.kept, 'nothing')}`;
    const chosen = r.chosenStep === null ? (r.kept === null ? 'none' : `${r.steps ?? 'n/a'} of ${r.steps ?? 'n/a'} (the full result)`) : `${r.chosenStep} of ${r.steps ?? 'n/a'}`;
    const m = [...r.specMoved.map((p) => `spec ${p}`), ...(moved.get(r) ?? []).map((f) => `input ${f}`)];
    const only = r.digest === null && r.deep === null ? (r.specMoved.length === 0 ? 'spec: yes; input: not read' : `no — ${m.join(', ')}`) : m.length === 0 ? 'yes' : `no — ${m.join(', ')}`;
    out.push(
      `| ${r.example}/${r.part} | ${r.tol} | ${mark} | ${r.phase} | ${counts} | ${r.kept === null ? '—' : total(r.kept)} | ${r.stopped ?? r.termination} | ${chosen} | ${r.fullMotion} (${r.fullMotionState}) | ${r.chosenMotion} | ${staticRefusal(r.refusal) ?? 'none'} | ${comparisonInputRefusal(r.refusal) ?? 'none'} | ${only} | ${overdrawText(r.overdraw, r.overdrawNote ?? 'not measured')} | ${r.stopped ?? r.verdict} | ${r.wallSeconds ?? '—'} |`,
    );
  }
  out.push('', '## Per part and tolerance', '');
  out.push('Over the cells measured at that tolerance: "fewest" is the fewest vertices among the cells the stage accepted, with its hull and its overdraw; "at the policy\'s" and "at 48" are those cells\' accepted counts (— when not accepted or not measured); "first static refusal" as on the spacing page.', '');
  out.push('| part | tol | fewest kept (hull+interior, at spacing) | overdraw at the fewest | at the policy\'s | at 48 | first static refusal | comparison refused its input at | not measured |');
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [k, p] of parts) {
    for (const tol of LADDER_TOLERANCES) {
      const of = rows.filter((r) => r.example === k && r.part === p && r.tol === tol);
      if (of.length === 0) continue;
      const s = summarise(of);
      const ok = of.filter((r) => passed(r) && r.kept !== null && total(r.kept) === s.fewest).sort((a, b) => a.spacing - b.spacing);
      const best = ok[0];
      const fewest = s.fewest === null || best === undefined || best.kept === null ? 'none accepted' : `${s.fewest} (${hiText(best.kept, '')}, at ${s.fewestAt.join(', ')})`;
      const at48 = of.find((r) => r.spacing === 48 && passed(r));
      const st = s.firstStatic === null ? (s.coarsestRun === null ? 'no cell finished' : `none up to ${s.coarsestRun}`) : `${s.firstStatic.spacing}: ${s.firstStatic.rows}`;
      out.push(
        `| ${k}/${p} | ${tol} | ${fewest} | ${best === undefined ? '—' : overdrawText(best.overdraw, best.overdrawNote ?? 'not measured')} | ${s.atPolicy ?? '—'} | ${at48 === undefined || at48.kept === null ? '—' : total(at48.kept)} | ${st} | ${s.comparisonInput.length === 0 ? 'none' : s.comparisonInput.map((x) => `${x.spacing}: ${x.codes}`).join('; ')} | ${s.unmeasured.length === 0 ? 'none' : s.unmeasured.join(', ')} |`,
      );
    }
  }
  const unmeasured = rows.filter((r) => r.stopped !== null);
  if (unmeasured.length > 0) {
    out.push('', '## Cells not measured', '');
    for (const r of unmeasured) out.push(`- ${r.example}/${r.part} at tol ${r.tol}, spacing ${r.spacing} (phase ${r.phase}): ${r.stopped}`);
  }
  const refused = rows.filter((r) => r.refusal !== null);
  if (refused.length > 0) {
    out.push('', '## Refusals', '');
    for (const r of refused) out.push(`- ${r.example}/${r.part} at tol ${r.tol}, spacing ${r.spacing}: ${r.refusal?.replace(/\n/g, ' / ')}`);
  }
  out.push(
    '',
    '## Re-running this evidence',
    '',
    `Inputs as the spacing page's: the public examples demo, sample and scarf at commit ${pinned} (\`scripts/fetch-examples.sh\`), each with its tracked \`examples/<key>/config.json\`; rig-c ${rigcVersion} from \`bun.lock\`; tolerances ${LADDER_TOLERANCES.join(', ')}; spacings ${SWEEP_SPACINGS.join(', ')} and each part's own;${widened ? ' the artFit overshoot widened with the rung;' : ''} each cell stopped at ${capSeconds} s, the ladder at ${budgetSeconds} s. Nothing is written but standard output.`,
    '',
    '```sh',
    'bun install --frozen-lockfile',
    'bun run fetch-examples',
    `bun tools/auto_spacing_survey.ts --ladder${widened ? ' --artfit widened' : ''} --cell-cap ${capSeconds} --budget ${budgetSeconds} >> docs/evidence/auto-spacing-survey.md`,
    '```',
  );
  return out;
}

/** The tool's arguments: `--cell-cap <s>` (default 600), `--budget <s>` (default 3000), `--only <key>/<part>`, `--ladder`; or a child's `--cell <key>/<part> --spacing <s> --out <file> --asm <dir>` (and `--tol <t>` under `--ladder`). */
export interface Args {
  capSeconds: number;
  budgetSeconds: number;
  only: string | null;
  ladder: boolean;
  artFit: ArtFitReading;
  child: { example: string; part: string; spacing: number; out: string; asm: string; tol: number } | null;
}

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = { capSeconds: 600, budgetSeconds: 3000, only: null, ladder: false, artFit: 'held', child: null };
  let cellName: string | null = null;
  let spacing: number | null = null;
  let outFile: string | null = null;
  let asmDir: string | null = null;
  let tol = 1;
  const num = (v: string | undefined, what: string): number => {
    const n = Number(v);
    if (v === undefined || v === '' || !Number.isFinite(n) || n <= 0) throw new Error(`${what} needs a number above 0, got "${v}"`);
    return n;
  };
  for (let k = 0; k < argv.length; k++) {
    const f = argv[k];
    if (f === '--cell-cap') a.capSeconds = num(argv[++k], '--cell-cap');
    else if (f === '--budget') a.budgetSeconds = num(argv[++k], '--budget');
    else if (f === '--only') a.only = argv[++k] ?? '';
    else if (f === '--ladder') a.ladder = true;
    else if (f === '--artfit') {
      const v = argv[++k];
      if (v !== 'held' && v !== 'widened') throw new Error(`--artfit takes held or widened, got "${v}"`);
      a.artFit = v;
    }
    else if (f === '--tol') tol = num(argv[++k], '--tol');
    else if (f === '--cell') cellName = argv[++k] ?? '';
    else if (f === '--spacing') spacing = num(argv[++k], '--spacing');
    else if (f === '--out') outFile = argv[++k] ?? '';
    else if (f === '--asm') asmDir = argv[++k] ?? '';
    else throw new Error(`unknown argument "${f}"; usage: auto_spacing_survey.ts [--ladder [--artfit held|widened]] [--cell-cap 600] [--budget 3000] [--only <key>/<part>]`);
  }
  if (cellName !== null) {
    const [example, part] = cellName.split('/');
    if (example === undefined || part === undefined || spacing === null || outFile === null || outFile === '' || asmDir === null || asmDir === '') throw new Error('a child needs --cell <key>/<part>, --spacing <s>, --out <file> and --asm <dir>');
    a.child = { example, part, spacing, out: outFile, asm: asmDir, tol };
  }
  return a;
}

/** A child: one cell through the real rig stage on the example the parent assembled once (`--asm`); a refusal before a comparison is a row, not a crash. Under `--ladder` the row carries the rung and the overdraw. */
function runChild(c: NonNullable<Args['child']>, ladder: boolean, artFit: ArtFitReading): void {
  const work = mkdtempSync(join(tmpdir(), 'rig-parts-auto-spacing-cell-'));
  const policySpacing = trackedSpacing(c.example, c.part);
  try {
    const spec = ladder ? ladderPolicy(policySpacing, c.spacing, c.tol, artFit) : spacingPolicy(policySpacing, c.spacing);
    let row: SpacingRow | LadderRow;
    try {
      const mc = motionCell(c.example, c.part, spec, c.asm, join(work, 'cell'), findRigc(ROOT, ''));
      row = rowOfCell(mc, c.spacing, policySpacing);
      if (ladder) {
        const mesh = writtenMesh(mc);
        const od = typeof mesh === 'string' || mc.input === null ? null : overdraw(mc.input.art.mask, mc.input.art.threshold, mesh.points, mesh.triangles);
        row = { ...row, specMoved: ladderSpecDifferences(policySpacing, c.spacing, c.tol, spec, artFit), tol: c.tol, phase: 1, overdraw: od, overdrawNote: typeof mesh === 'string' ? mesh : null, deep: mc.input === null ? null : inputDigestDeep(mc.input) };
      }
    } catch (err) {
      if (!(err instanceof PartsError)) throw err;
      const base = { ...pendingRow(c.example, c.part, c.spacing, policySpacing), refusal: err.problems.map(problemLine).join('\n'), verdict: `refused ${err.problems[0]?.code ?? ''}`, termination: 'no reduction ran' };
      row = ladder ? { ...base, specMoved: ladderSpecDifferences(policySpacing, c.spacing, c.tol, spec, artFit), tol: c.tol, phase: 1, overdraw: null, overdrawNote: 'no mesh written', deep: null } : base;
    }
    writeFileSync(c.out, JSON.stringify(row));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Runs one cell's child under the cap and what is left of the budget; returns the row it wrote, marked when it did not finish. */
function runCell(args: Args, t0: number, key: string, part: string, spacing: number, tol: number, asm: string, work: string, pending: SpacingRow): SpacingRow {
  const left = args.budgetSeconds - (performance.now() - t0) / 1000;
  if (left <= 0) return { ...pending, stopped: `not started: the ${args.ladder ? 'ladder' : 'sweep'}'s ${args.budgetSeconds} s budget was spent` };
  const cap = Math.min(args.capSeconds, left);
  const out = join(work, `${key}-${part}-${spacing}-${tol}.json`);
  const c0 = performance.now();
  const argv = [join(ROOT, 'tools', 'auto_spacing_survey.ts'), '--cell', `${key}/${part}`, '--spacing', `${spacing}`, '--out', out, '--asm', asm];
  if (args.ladder) argv.push('--ladder', '--tol', `${tol}`, '--artfit', args.artFit);
  const run = spawnSync(process.execPath, argv, { stdio: ['ignore', 'ignore', 'inherit'], timeout: Math.max(1, Math.floor(cap * 1000)), killSignal: 'SIGKILL' });
  const wrote = existsSync(out) ? (JSON.parse(readFileSync(out, 'utf8')) as SpacingRow) : { ...pending };
  if (run.error !== undefined || run.signal !== null) wrote.stopped = cap < args.capSeconds ? `stopped at ${Math.round(cap)} s (what was left of the ${args.ladder ? 'ladder' : 'sweep'}'s budget)` : `stopped at ${args.capSeconds} s (the per-cell cap)`;
  else if (run.status !== 0) wrote.stopped = `the cell's process exited ${run.status}`;
  console.error(`auto_spacing_survey: ${key}/${part}${args.ladder ? ` at tol ${tol}` : ''} at spacing ${spacing}: ${((performance.now() - c0) / 1000).toFixed(1)} s wall, ${wrote.stopped ?? wrote.verdict}`);
  return wrote;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.child !== null) {
    runChild(args.child, args.ladder, args.artFit);
    return;
  }
  const plan: Array<[string, string]> = [];
  for (const [key, parts] of ITEM2_PARTS) for (const part of parts) if (args.only === null || args.only === `${key}/${part}`) plan.push([key, part]);
  if (plan.length === 0) {
    console.error(`auto_spacing_survey: --only ${args.only} names none of the surveyed parts`);
    process.exit(2);
  }
  const missing = missingInputs([...new Set(plan.map(([k]) => k))]);
  if (missing.length > 0) {
    console.error(`auto_spacing_survey: no fetched inputs for ${missing.map((k) => `examples/${k}/inputs`).join(', ')}; run \`bun run fetch-examples\` first`);
    process.exit(1);
  }
  const work = mkdtempSync(join(tmpdir(), 'rig-parts-auto-spacing-survey-'));
  const t0 = performance.now();
  let failed = 0;
  const assembled = new Map<string, string>();
  const asmOf = (key: string): string => {
    if (!assembled.has(key)) assembled.set(key, assembleExample(work, key));
    return assembled.get(key) as string;
  };
  try {
    if (args.ladder) {
      const rows: LadderRow[] = [];
      const parts = plan.map(([k, p]) => [k, p, trackedSpacing(k, p)] as const);
      for (const c of args.artFit === 'widened' ? widenedPlan(parts) : ladderPlan(parts)) {
        const r = runCell(args, t0, c.example, c.part, c.spacing, c.tol, asmOf(c.example), work, pendingLadderRow(c, args.artFit)) as LadderRow;
        r.phase = c.phase;
        if (r.disagreement !== null) {
          failed++;
          console.error(`auto_spacing_survey: ${r.disagreement}`);
        }
        rows.push(r);
      }
      for (const [r, m] of ladderInputMoved(rows, args.artFit)) {
        if (m.length > 0 || r.specMoved.length > 0) {
          failed++;
          console.error(`auto_spacing_survey: ${r.example}/${r.part} at tol ${r.tol}, spacing ${r.spacing}: more than the rung moved: ${[...r.specMoved, ...m].join(', ')}`);
        }
      }
      for (const l of renderLadder(rows, installedRigc(), pinnedInputs(), args.capSeconds, args.budgetSeconds, args.artFit)) console.log(l);
    } else {
      const rows: SpacingRow[] = [];
      for (const [key, part] of plan) {
        const policySpacing = trackedSpacing(key, part);
        const asm = asmOf(key);
        for (const spacing of spacingsFor(policySpacing)) {
          const r = runCell(args, t0, key, part, spacing, 1, asm, work, pendingRow(key, part, spacing, policySpacing));
          if (r.disagreement !== null) {
            failed++;
            console.error(`auto_spacing_survey: ${r.disagreement}`);
          }
          rows.push(r);
        }
      }
      for (const [r, m] of inputMoved(rows)) {
        if (m.length > 0 || r.specMoved.length > 0) {
          failed++;
          console.error(`auto_spacing_survey: ${r.example}/${r.part} at spacing ${r.spacing}: more than the source moved: ${[...r.specMoved, ...m].join(', ')}`);
        }
      }
      for (const l of render(rows, installedRigc(), pinnedInputs(), args.capSeconds, args.budgetSeconds)) console.log(l);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (failed > 0) process.exit(1);
}

if (import.meta.main) main();
