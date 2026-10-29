#!/usr/bin/env bun
/**
 * rigc#1266 Q7, measured on the public examples: `protect.weightJump` on the
 * parts the automatic mode's motion gate refuses under the stated policy, by
 * one command:
 *
 *     bun run fetch-examples          # once: examples/{reference-demo,reference-sample}/inputs
 *     bun tools/auto_weightjump_survey.ts > docs/evidence/auto-motion-weightjump.md
 *
 * Which parts: the three `docs/evidence/auto-motion-survey.md` records as
 * refused `AUTO_MESH_MOTION` — demo `bottomwear`, sample `sleeves`, sample
 * `bottomwear` — each switched **alone** to `auto` in its example's own
 * config, under exactly the motion survey's policy
 * (`withPolicyMotion(examplePolicy(spacing))`, `fixtures/automesh.ts` and
 * `fixtures/automotion.ts`) and nothing else changed but `protect.weightJump`.
 *
 * **The largest source edge jump**, as rig-c's `MQ79` derives it (rig-c's
 * `selftest.ts`, `mvEdgeJump`; {@link edgeJumps} reproduces it): over every
 * edge of every source triangle, the L1 difference of the two endpoints'
 * weight vectors over the bones they name — `protect.weightJump`'s own
 * measure (`weightJump`, rig-c `src/meshreduce.ts`) — read on the source
 * exactly as the rig stage hands it to `reduceMesh` (`input.source.weights`:
 * `localInfluences` under the policy's influences, unrounded). It is read off
 * the stated-policy run's own input, so no pose and no comparison chose it.
 *
 * The rules, one per run, every one derived from that figure J and none from
 * a comparison: `none` (the stated policy: the motion survey's run, repeated
 * here so its row sits beside the others); `x1.1` — just above J, J × 1.1
 * rounded UP to 6 decimals ({@link ruleValue}), the same rule for every part;
 * `x1.5` — the contract's reproducer's (`MQ79`: 1.5 × J), rounded up the same
 * way; `= J` — J exactly, the double itself. rig-c protects a source edge
 * whose jump is ABOVE the value and refuses a step adding an edge whose jump
 * is above it, so at `= J` no source edge is protected by condition (a).
 *
 * What runs per (part, rule): `motionCell` (`tools/auto_motion_survey.ts`) —
 * the real rig stage, its gate build, reference build and rig-c's
 * `compareMeshesInMotion`, through the installed rigc, in a temporary
 * directory removed afterwards. The schedule's selection is empty, so every
 * frame is held out: no value here was chosen by looking at a frame.
 *
 * Output: Markdown. Every number is read from rig-c's report or computed by
 * {@link edgeJumps} from the input the stage made; no path, no time and no
 * machine is printed, so two runs of one tree print the same bytes. Exit 1 when
 * an example's inputs are missing or a re-run comparison disagrees with the
 * stage; 0 otherwise — a refusal is a result.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { MeasureRow, SourceMesh } from '@rig-c/core/mesh';
import { terminationText } from '../src/automesh.ts';
import { findRigc } from '../src/check.ts';
import { examplePolicy } from '../fixtures/automesh.ts';
import { withPolicyMotion } from '../fixtures/automotion.ts';
import { assembleExample, cell, installedRigc, missingInputs, type MotionCell, motionCell, rowOf, trackedSpacing } from './auto_motion_survey.ts';

const ROOT = resolve(import.meta.dir, '..');

/** The parts the motion survey records as refused `AUTO_MESH_MOTION`, by example. */
const PARTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['reference-demo', ['bottomwear']],
  ['reference-sample', ['sleeves', 'bottomwear']],
];

/** The thresholds the distribution counts edges above. */
export const JUMP_STEPS: readonly number[] = [0.1, 0.2, 0.5];

/** The L1 difference of two weight vectors over the bones they name — rig-c's `weightJump` measure. */
export function weightL1(a: ReadonlyArray<{ bone: string; weight: number }>, b: ReadonlyArray<{ bone: string; weight: number }>): number {
  const shares = new Map<string, number>();
  for (const x of a) shares.set(x.bone, (shares.get(x.bone) ?? 0) + x.weight);
  for (const x of b) shares.set(x.bone, (shares.get(x.bone) ?? 0) - x.weight);
  let sum = 0;
  for (const d of shares.values()) sum += Math.abs(d);
  return sum;
}

/**
 * Every edge of a source mesh's triangles, once (the pair `min,max`), with its
 * weight jump; and the largest, as `MQ79` takes it — the maximum over each
 * triangle's three edges in the order `[t+k, t+(k+1)%3]`, which is the same
 * maximum as over the unique edges. Null for an unweighted source.
 */
export function edgeJumps(source: Pick<SourceMesh, 'triangles' | 'weights'>): { largest: number; edges: number[] } | null {
  const w = source.weights;
  if (w === null) return null;
  const seen = new Map<string, number>();
  let largest = 0;
  for (let t = 0; t < source.triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = source.triangles[t + k];
      const b = source.triangles[t + ((k + 1) % 3)];
      const d = weightL1(w[a], w[b]);
      largest = Math.max(largest, d);
      seen.set(a < b ? `${a},${b}` : `${b},${a}`, d);
    }
  }
  return { largest, edges: [...seen.values()] };
}

/** A rule's value from J: `x<f>` is J × f rounded UP to 6 decimals (so strictly above J whenever J > 0), `=J` is J. */
export function ruleValue(rule: Rule, j: number): number {
  if (rule.factor === null) return j;
  const v = Math.ceil(j * rule.factor * 1e6) / 1e6;
  return v;
}

export interface Rule {
  label: string;
  /** null: J itself. */
  factor: number | null;
}

const RULES: readonly Rule[] = [
  { label: 'x1.1 (just above J)', factor: 1.1 },
  { label: 'x1.5 (the reproducer\'s)', factor: 1.5 },
  { label: '= J', factor: null },
];

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

interface Run {
  example: string;
  part: string;
  rule: string;
  weightJump: number | null;
  cell: MotionCell;
}

function geometryText(c: MotionCell): string {
  const row = c.row;
  if (row === undefined) return 'no row (refused before a result)';
  const bounded = row.residuals.filter((r) => r.bound !== null);
  return bounded.map((r) => `${r.code}${r.region === null ? '' : `[${r.region}]`} ${r.state} ${r.value}`).join('; ');
}

function main(): void {
  const missing = missingInputs(PARTS.map(([k]) => k));
  if (missing.length > 0) {
    console.error(`auto_weightjump_survey: no fetched inputs for ${missing.map((k) => `examples/${k}/inputs`).join(', ')}; run \`bun run fetch-examples\` first`);
    process.exit(1);
  }
  const rigcBin = findRigc(ROOT, '');
  const work = mkdtempSync(join(tmpdir(), 'rig-parts-auto-weightjump-survey-'));
  const runs: Run[] = [];
  const jumps: Array<{ example: string; part: string; source: string; j: { largest: number; edges: number[] } | null }> = [];
  let disagreements = 0;
  const note = (c: MotionCell): void => {
    if (c.disagreement === null) return;
    disagreements++;
    console.error(`auto_weightjump_survey: ${c.disagreement}`);
  };
  try {
    for (const [key, parts] of PARTS) {
      const asm = assembleExample(work, key);
      for (const part of parts) {
        const policy = withPolicyMotion(examplePolicy(trackedSpacing(key, part)));
        const base = motionCell(key, part, policy, asm, join(work, key, part, 'none'), rigcBin);
        note(base);
        runs.push({ example: key, part, rule: 'none (the stated policy)', weightJump: null, cell: base });
        const j = base.input === null ? null : edgeJumps(base.input.source);
        const src = base.input === null ? 'no source' : `${base.input.source.hull}+${base.input.source.points.length - base.input.source.hull}`;
        jumps.push({ example: key, part, source: src, j });
        if (j === null) continue;
        for (const rule of RULES) {
          const value = ruleValue(rule, j.largest);
          const auto = { ...policy, protect: { weightJump: value } };
          const c = motionCell(key, part, auto, asm, join(work, key, part, rule.factor === null ? 'eq' : `x${rule.factor}`), rigcBin);
          note(c);
          runs.push({ example: key, part, rule: rule.label, weightJump: value, cell: c });
        }
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  console.log('# `protect.weightJump` on the motion-refused parts (rigc#1266 Q7)\n');
  console.log(`Generated by \`bun tools/auto_weightjump_survey.ts\`; every figure below is the tool's, none typed. The installed rig-c ${installedRigc()}. Policy: withPolicyMotion(examplePolicy(spacing)) (fixtures/automesh.ts, fixtures/automotion.ts) — the motion survey's, unchanged — with only \`protect.weightJump\` set; each part switched alone; the real rig stage (gate build, reference build, rig-c's compareMeshesInMotion on the idle). Every frame is held out (selection empty): each value is derived from the source's own weights, none from a comparison.\n`);
  console.log('## The largest source edge jump (as `MQ79` derives it)\n');
  console.log('J = the largest L1 difference of the two endpoints\' weight vectors over any edge of the source\'s triangles, on the source weights the rig stage hands `reduceMesh` (unrounded). Edges are counted once each.\n');
  console.log(`| part | source (hull+interior) | source edges | J | ${JUMP_STEPS.map((s) => `edges > ${s}`).join(' | ')} | edges at J |`);
  console.log(`| --- | --- | --- | --- | ${JUMP_STEPS.map(() => '---').join(' | ')} | --- |`);
  for (const r of jumps) {
    if (r.j === null) {
      console.log(`| ${r.example}/${r.part} | ${r.source} | — | not measured: no weighted source | ${JUMP_STEPS.map(() => '—').join(' | ')} | — |`);
      continue;
    }
    const { largest, edges } = r.j;
    console.log(`| ${r.example}/${r.part} | ${r.source} | ${edges.length} | ${r6(largest)} | ${JUMP_STEPS.map((s) => String(edges.filter((d) => d > s).length)).join(' | ')} | ${edges.filter((d) => d === largest).length} |`);
  }
  console.log('\n## The runs\n');
  console.log('Rules: `none` is the stated policy; `x1.1` and `x1.5` are J times the factor rounded up to 6 decimals; `= J` is J exactly (the value printed is J to 6 decimals; the config carries the double).\n');
  console.log('| part | rule | weightJump | source → result (hull+interior) | removed / inserted | candidates tried | termination | bounded geometry rows (state value) | MQ_LOCAL_DEFORMATION value / bound @ worst frame | verdict |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of runs) {
    const c = r.cell;
    const t = c.row?.termination ?? null;
    const tried = t !== null && 'candidatesTried' in t ? String(t.candidatesTried) : '—';
    const changes = c.row === undefined ? '—' : `${c.row.result.removedVertices} / ${c.row.result.insertedVertices}`;
    const local: MeasureRow | undefined = rowOf(c.report, 'MQ_LOCAL_DEFORMATION');
    const verdict = c.refusal === null ? 'accepted' : `refused ${c.refusal.split(':')[0]}`;
    console.log(`| ${r.example}/${r.part} | ${r.rule} | ${r.weightJump === null ? 'null' : r6(r.weightJump)} | ${c.counts} | ${changes} | ${tried} | ${c.row === undefined ? '—' : terminationText(t)} | ${geometryText(c)} | ${cell(local)} | ${verdict} |`);
  }
  const refused = runs.filter((r) => r.cell.refusal !== null && r.cell.row === undefined);
  if (refused.length > 0) {
    console.log('\n### Refused before a result\n');
    for (const r of refused) console.log(`- ${r.example}/${r.part}, ${r.rule}: ${r.cell.refusal}`);
  }
  console.log('\n## In aggregate\n');
  for (const rule of ['none (the stated policy)', ...RULES.map((x) => x.label)]) {
    const of = runs.filter((r) => r.rule === rule);
    const reduced = of.filter((r) => r.cell.row !== undefined && r.cell.row.result.removedVertices > 0);
    const passed = of.filter((r) => r.cell.refusal === null);
    const both = of.filter((r) => r.cell.refusal === null && r.cell.row !== undefined && r.cell.row.result.removedVertices > 0);
    console.log(`- ${rule}: ${of.length} part(s); ${reduced.length} reduced (a vertex removed), ${passed.length} accepted in motion, ${both.length} both.`);
  }
  console.log('\n## Re-running this evidence\n');
  console.log('Inputs: the public examples demo and sample of https://github.com/firejune/spine-parts-examples at the commit `scripts/fetch-examples.sh` pins (`bun run fetch-examples` copies them into the gitignored `examples/<key>/inputs`), each with its tracked `examples/<key>/config.json`; rig-c as `bun install --frozen-lockfile` installs it from `bun.lock`. No other input is read, and nothing is written but standard output (the stages run in a temporary directory, removed afterwards).\n');
  console.log('```sh\nbun install --frozen-lockfile\nbun run fetch-examples\ntimeout 600 bun tools/auto_weightjump_survey.ts > docs/evidence/auto-motion-weightjump.md\n```');
  if (disagreements > 0) process.exit(1);
}

if (import.meta.main) main();
