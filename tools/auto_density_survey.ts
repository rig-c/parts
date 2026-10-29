#!/usr/bin/env bun
/**
 * Issue #155, measured on one public part: a density-only region (no `bone`,
 * no `band`) added to the automatic mode, against the same part without it, by
 * one command:
 *
 *     bun run fetch-examples          # once: examples/reference-demo/inputs
 *     bun tools/auto_density_survey.ts > docs/evidence/auto-density-region.md
 *
 * **The part**: demo `bottomwear`, the one the Stage B survey
 * (`docs/evidence/auto-stageb-survey.md`) records with the largest accepted
 * reduction of the public parts under the baseline, switched alone to `auto` in
 * the example's own config under exactly that survey's baseline policy —
 * `withPolicyMotion(examplePolicy(spacing))` (`fixtures/automesh.ts`,
 * `fixtures/automotion.ts`) — and run through the real rig stage
 * (`motionCell`, `tools/auto_motion_survey.ts`): as is, and with one
 * density-only region added and nothing else changed, once per region below.
 *
 * **The regions**, by rule. Both start from the circle
 * `tools/real_compare.ts`'s `testRegion` places on the part (the art pixel
 * nearest the midpoint of the last link of the first chain the mesh names,
 * radius `floor(min(w, h) / 10)`) with `fixtures/automesh.ts`'s `matrixRegion`
 * density (L0 = grid / 2, transition = the radius, grade = (grid − L0) /
 * transition, one art sample) — the region the evaluation matrix declares on
 * this part in its bone-band form (`docs/evidence/auto-mesh-matrix.md`):
 *
 * - **square** — the polygon first stated for this evidence: the square
 *   inscribed in that circle ({@link densitySquare}), its half side the radius
 *   over √2 rounded down to the 1/256 px grid. Kept as run: rig-c's refinement
 *   ends it with `MQ_DEGENERATE` before any removal, a geometry outcome no
 *   weight takes part in (the bone-band form hands rig-c the same region, AM53);
 * - **circle** — the matrix's circle itself, which the matrix records refined and
 *   accepted on geometry in its bone-band form; rig-c is handed it as the
 *   regular polygon `circlePolygon` names (P17).
 *
 * Both have no `bone` and no `band`. The weight diff is taken on every run the
 * stage wrote a mesh for.
 *
 * **The diff**, by program ({@link weightDiff}), on the reductions the stage
 * ran (re-run here with the stage's own input, `runReduction`; rig-c is
 * deterministic, and the tool refuses a re-run whose counts differ from the
 * stage's row):
 *
 * 1. every source vertex's weights with the region against without it, as the
 *    stage handed them to `reduceMesh` (`input.source.weights`, unrounded):
 *    the same bone names, order and doubles;
 * 2. every vertex of the written mesh (the full result, or the replayed step
 *    the acceptance loop chose) that is a surviving source vertex: its weights
 *    the source's, bit for bit (order-free by bone name, as rig-c keeps them);
 * 3. every vertex rig-c inserted: its weights exactly rig-c's §6 rule —
 *    the barycentric mix of the source triangle that holds it, the first by
 *    index whose smallest coordinate is the largest ({@link sectionSixMix}),
 *    then pruned under the input's cap, floor, guarded bones and bone order
 *    and written on the 6-decimal grid ({@link pruneShares}) — bone by bone,
 *    the same doubles;
 * 4. every source vertex that survives in both written meshes: the same weights
 *    in both.
 *
 * Output: Markdown. Every number is read from the stage's row, rig-c's report
 * or {@link weightDiff}; no path, no time and no machine is printed. Exit 1 when
 * the inputs are missing, a re-run disagrees with the stage, or any vertex of
 * the diff fails; 0 otherwise.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { MeshReductionInput, ReducedMesh } from '@rig-c/core/mesh';
import { runReduction, terminationText } from '../src/automesh.ts';
import { findRigc } from '../src/check.ts';
import { type AutoDensityRegionSpec, type AutoSpec, loadConfig, type Point } from '../src/config.ts';
import { PartsError, problemLine } from '../src/errors.ts';
import { readParts } from '../src/parts.ts';
import { readPng } from '../src/raster/index.ts';
import { densityOnly, examplePolicy, matrixRegion } from '../fixtures/automesh.ts';
import { withPolicyMotion } from '../fixtures/automotion.ts';
import { assembleExample, cell, installedRigc, missingInputs, type MotionCell, motionCell, pinnedInputs, rowOf, trackedSpacing, verdictOf } from './auto_motion_survey.ts';
import { placedMask, testRegion } from './real_compare.ts';

const ROOT = resolve(import.meta.dir, '..');
const EXAMPLE = 'reference-demo';
const PART = 'bottomwear';

type Lists = ReadonlyArray<ReadonlyArray<{ bone: string; weight: number }>>;

/** The square inscribed in a circle, as a density-only polygon region with the matrix region's density (module header). */
export function densitySquare(t: { cx: number; cy: number; r: number }, grid: number): AutoDensityRegionSpec {
  const m = matrixRegion({ ...t, band: t.r }, grid);
  const h = Math.floor((t.r / Math.SQRT2) * 256) / 256;
  return {
    name: 'density',
    shape: 'polygon',
    points: [
      [t.cx - h, t.cy - h],
      [t.cx + h, t.cy - h],
      [t.cx + h, t.cy + h],
      [t.cx - h, t.cy + h],
    ],
    maxEdgeLength: m.maxEdgeLength,
    transition: m.transition,
    grade: m.grade,
    minArtSamples: m.minArtSamples,
  };
}

/** A weight list in its own order, every double printed exactly. */
const ordered = (l: ReadonlyArray<{ bone: string; weight: number }>): string => l.map((e) => `${e.bone}:${e.weight}`).join(',');
/** A weight list by bone name. */
const byBone = (l: ReadonlyArray<{ bone: string; weight: number }>): string => ordered([...l].sort((p, q) => (p.bone < q.bone ? -1 : p.bone > q.bone ? 1 : 0)));

/** rig-c's §6 mix at `p`: the barycentric interpolation of the source triangle that holds it (the first by index whose smallest coordinate is the largest), coordinates clamped at 0 and renormalised. */
export function sectionSixMix(p: Point, points: ReadonlyArray<readonly [number, number]>, triangles: readonly number[], weights: Lists): Map<string, number> {
  let best = -1;
  let bestMin = -Infinity;
  let bestL: number[] = [0, 0, 0];
  for (let t = 0; t * 3 + 2 < triangles.length; t++) {
    const [A, B, C] = [points[triangles[t * 3]], points[triangles[t * 3 + 1]], points[triangles[t * 3 + 2]]];
    const det = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
    if (Math.abs(det) < 1e-12) continue;
    const l0 = ((B[1] - C[1]) * (p[0] - C[0]) + (C[0] - B[0]) * (p[1] - C[1])) / det;
    const l1 = ((C[1] - A[1]) * (p[0] - C[0]) + (A[0] - C[0]) * (p[1] - C[1])) / det;
    const l = [l0, l1, 1 - l0 - l1];
    const m = Math.min(...l);
    if (m > bestMin + 1e-12) {
      best = t;
      bestMin = m;
      bestL = l;
    }
  }
  const clamped = bestL.map((v) => Math.max(0, v));
  const sum = clamped[0] + clamped[1] + clamped[2];
  const shares = new Map<string, number>();
  if (best < 0) return shares;
  for (let i = 0; i < 3; i++) {
    for (const e of weights[triangles[best * 3 + i]]) shares.set(e.bone, (shares.get(e.bone) ?? 0) + (clamped[i] / sum) * e.weight);
  }
  return shares;
}

/** rig-c's 6-decimal grid (`r6`, rig-c `src/mesh.ts`): `Math.round(n · 1e6) / 1e6`, never -0. */
const r6 = (n: number): number => {
  const v = Math.round(n * 1e6) / 1e6;
  return v === 0 ? 0 : v;
};

/** What §6's "then prune" is handed: the cap and floor (`influences`), the guarded bones (`protect.influences`), and the bone order ties are broken by. */
export interface PruneRules {
  maxInfluences: number;
  minWeight: number;
  guarded: readonly string[];
  boneOrder: readonly string[];
}

/**
 * §6's "then prune", reproduced to check rig-c's output, not to replace it (rig-c 2.31.0 `prune`, `src/meshreduce.ts`):
 * shares above 0, strongest first (ties by bone order); the guarded kept, then the strongest others up to the cap;
 * normalised; under `minWeight` dropped (a guarded bone never) and normalised; a share 0 on the 6-decimal grid dropped
 * and the rest normalised, until none is; then each share on the grid, the last closing at 1 − others, a closing share
 * at or below 0 dropped and the rest normalised again. A guarded share the grid cannot hold is rig-c's refusal, not
 * reproduced: this returns null there.
 */
export function pruneShares(shares: ReadonlyMap<string, number>, rules: PruneRules): Array<{ bone: string; weight: number }> | null {
  const rank = (b: string): number => {
    const i = rules.boneOrder.indexOf(b);
    return i < 0 ? 0 : i;
  };
  const guarded = new Set(rules.guarded);
  let entries = [...shares.entries()].filter(([, s]) => s > 0).map(([bone, share]) => ({ bone, share }));
  entries.sort((p, q) => q.share - p.share || rank(p.bone) - rank(q.bone));
  const kept = entries.filter((e) => guarded.has(e.bone));
  if (kept.length > rules.maxInfluences) return null;
  for (const e of entries) if (!guarded.has(e.bone) && kept.length < rules.maxInfluences) kept.push(e);
  entries = kept.sort((p, q) => q.share - p.share || rank(p.bone) - rank(q.bone));
  const normalise = (): void => {
    const total = entries.reduce((s, e) => s + e.share, 0);
    for (const e of entries) e.share /= total;
  };
  normalise();
  if (rules.minWeight > 0) {
    entries = entries.filter((e) => guarded.has(e.bone) || e.share >= rules.minWeight);
    normalise();
  }
  for (;;) {
    const zero = entries.find((e) => r6(e.share) === 0);
    if (zero === undefined) break;
    if (guarded.has(zero.bone)) return null;
    entries = entries.filter((e) => e !== zero);
    normalise();
  }
  for (;;) {
    const out: Array<{ bone: string; weight: number }> = [];
    let others = 0;
    entries.forEach((e, k) => {
      const w = k === entries.length - 1 ? r6(1 - others) : r6(e.share);
      others += w;
      out.push({ bone: e.bone, weight: w });
    });
    if (out[out.length - 1].weight > 0) return out;
    if (guarded.has(entries[entries.length - 1].bone)) return null;
    entries = entries.slice(0, -1);
    normalise();
  }
}

/** The four counts of the module header's diff, each with how many vertices it checked. */
export interface WeightDiff {
  sourceVertices: number;
  sourceIdentical: number;
  survivors: number;
  survivorsIdentical: number;
  inserted: number;
  insertedInterpolated: number;
}

/**
 * Items 1–3 of the module header's diff for one written mesh: `off` and `on` the source weights without and with the
 * region (one list per source vertex), `source` the source the reduction was handed, `mesh` what it returned.
 */
export function weightDiff(off: Lists, on: Lists, source: { points: ReadonlyArray<readonly [number, number]>; triangles: readonly number[] }, mesh: Pick<ReducedMesh, 'points' | 'weights' | 'indexMap' | 'inserted'>, rules: PruneRules): WeightDiff {
  const sourceIdentical = on.filter((l, v) => v < off.length && ordered(l) === ordered(off[v])).length;
  const out = (mesh.weights ?? []) as Lists;
  let survivors = 0;
  let survivorsIdentical = 0;
  mesh.indexMap.forEach((r, v) => {
    if (r === null) return;
    survivors++;
    if (out[r] !== undefined && byBone(out[r]) === byBone(on[v])) survivorsIdentical++;
  });
  let insertedInterpolated = 0;
  for (const r of mesh.inserted) {
    const p = mesh.points[r];
    const want = pruneShares(sectionSixMix([p[0], p[1]], source.points, source.triangles, on), rules);
    if (out[r] !== undefined && want !== null && byBone(out[r]) === byBone(want)) insertedInterpolated++;
  }
  return { sourceVertices: Math.max(off.length, on.length), sourceIdentical: off.length === on.length ? sourceIdentical : 0, survivors, survivorsIdentical, inserted: mesh.inserted.length, insertedInterpolated };
}

/** Item 4: source vertices surviving in both written meshes, and how many carry the same weights in both. */
export function commonSurvivors(a: Pick<ReducedMesh, 'weights' | 'indexMap'>, b: Pick<ReducedMesh, 'weights' | 'indexMap'>): { both: number; identical: number } {
  let both = 0;
  let identical = 0;
  const wa = (a.weights ?? []) as Lists;
  const wb = (b.weights ?? []) as Lists;
  a.indexMap.forEach((ra, v) => {
    const rb = b.indexMap[v];
    if (ra === null || rb === null || rb === undefined) return;
    both++;
    if (byBone(wa[ra]) === byBone(wb[rb])) identical++;
  });
  return { both, identical };
}

/** The mesh the stage wrote for a cell: the full result, or the replayed step its acceptance loop chose; re-run from the stage's own input. */
function writtenMesh(c: MotionCell): { mesh: ReducedMesh; step: string } | string {
  if (c.input === null) return 'the stage made no call';
  if (c.written === undefined) return 'the stage wrote no row';
  const chosen = c.written.replay?.chosen_step;
  const input: MeshReductionInput = chosen === undefined ? c.input : { ...c.input, stopAfterAccepted: chosen };
  const ran = runReduction(`config.meshes.${PART}.auto`, input);
  if ('code' in ran) return `the re-run refused: ${ran.code}`;
  if (ran.mesh === null) return `the re-run returned no mesh: ${terminationText(ran.report.termination)}`;
  const w = c.written.result.counts;
  if (ran.mesh.counts.boundaryVertices !== w.boundaryVertices || ran.mesh.counts.interiorVertices !== w.interiorVertices || ran.mesh.counts.triangles !== w.triangles) {
    return `the re-run's counts ${ran.mesh.counts.boundaryVertices}+${ran.mesh.counts.interiorVertices} (${ran.mesh.counts.triangles} t) are not the written row's ${w.boundaryVertices}+${w.interiorVertices} (${w.triangles} t)`;
  }
  return { mesh: ran.mesh, step: chosen === undefined ? 'the full result' : `replayed step ${chosen}` };
}

/** One run: the stage's cell, or the refusal that stopped the tool's rebuild of a part the stage refused before a comparison. */
type Run = { label: string; region: AutoDensityRegionSpec | null; cell: MotionCell | null; refused: string | null };

function runOne(label: string, region: AutoDensityRegionSpec | null, policy: AutoSpec, asm: string, dir: string, rigcBin: string): Run {
  try {
    const c = motionCell(EXAMPLE, PART, region === null ? policy : { ...policy, regions: [region] }, asm, dir, rigcBin);
    return { label, region, cell: c, refused: c.refusal };
  } catch (err) {
    if (!(err instanceof PartsError)) throw err;
    return { label, region, cell: null, refused: err.problems.map(problemLine).join(' / ') };
  }
}

const listText = (l: ReadonlyArray<{ bone: string; weight: number }>): string => l.map((e) => `${e.bone}:${e.weight}`).join(',');

function main(): void {
  const missing = missingInputs([EXAMPLE]);
  if (missing.length > 0) {
    console.error(`auto_density_survey: no fetched inputs for examples/${EXAMPLE}/inputs; run \`bun run fetch-examples\` first`);
    process.exit(1);
  }
  const rigcBin = findRigc(ROOT, '');
  const work = mkdtempSync(join(tmpdir(), 'rig-parts-auto-density-survey-'));
  let failed = 0;
  const fail = (why: string): void => {
    failed++;
    console.error(`auto_density_survey: ${why}`);
  };
  const lines: string[] = [];
  try {
    const asm = assembleExample(work, EXAMPLE);
    const grid = trackedSpacing(EXAMPLE, PART);
    const policy = withPolicyMotion(examplePolicy(grid));
    const cfg = loadConfig(join(ROOT, 'examples', EXAMPLE, 'config.json'));
    const p = readParts(join(asm, 'parts.json')).parts.find((q) => q.name === PART);
    if (p === undefined) throw new Error(`auto_density_survey: no part ${PART} in the assembled ${EXAMPLE}`);
    const t = testRegion(cfg, PART, placedMask(p.x, p.y, readPng(join(asm, 'parts', `${PART}.png`))), { w: p.w, h: p.h });
    if (typeof t === 'string') throw new Error(`auto_density_survey: the region rule passes over ${EXAMPLE}/${PART}: ${t}`);
    const square = densitySquare(t, grid);
    const circle = densityOnly(matrixRegion(t, grid));
    const runs: Run[] = [
      runOne('without a region', null, policy, asm, join(work, 'off'), rigcBin),
      runOne('square, density only', square, policy, asm, join(work, 'square'), rigcBin),
      runOne('circle, density only', circle, policy, asm, join(work, 'circle'), rigcBin),
    ];
    for (const r of runs) {
      if (r.cell === null) {
        console.error(`auto_density_survey: ${r.label}: refused before a comparison`);
        continue;
      }
      console.error(`auto_density_survey: ${r.label}: ${Math.round(r.cell.wallMs)} ms, ${r.cell.builds} rigc build(s)`);
      if (r.cell.disagreement !== null) fail(r.cell.disagreement);
    }
    const off = runs[0];
    const offCell = off.cell;
    if (offCell === null || offCell.input === null) throw new Error(`auto_density_survey: the run without a region made no call: ${off.refused ?? 'no input'}`);
    const offInput = offCell.input;
    const wOff = writtenMesh(offCell);
    if (typeof wOff === 'string') fail(`without a region: ${wOff}`);

    lines.push('# A density-only region on one public part (issue #155)', '');
    lines.push(
      `Generated by \`bun tools/auto_density_survey.ts\`; every figure below is the tool's, none typed. The installed rig-c ${installedRigc()}. Part: ${EXAMPLE}/${PART}, switched alone to \`auto\` in the example's own config. Policy: withPolicyMotion(examplePolicy(${grid})) (fixtures/automesh.ts, fixtures/automotion.ts) — the Stage B survey's baseline, unchanged. The real rig stage: gate build, reference build, rig-c's compareMeshesInMotion on the idle, the acceptance loop with its replay.`,
      '',
    );
    lines.push('## The regions', '');
    lines.push(
      `Both from the circle tools/real_compare.ts's \`testRegion\` places on the part — centre (${t.cx}, ${t.cy}) rig px, radius ${t.r} (the art pixel nearest the midpoint of the last link of chain "${t.chain}", radius floor(min(${p.w}, ${p.h}) / 10)) — with matrixRegion's density for grid ${grid}: maxEdgeLength ${circle.maxEdgeLength}, transition ${circle.transition}, grade ${circle.grade}, minArtSamples ${circle.minArtSamples}; neither has a \`bone\` or a \`band\`. The square (the polygon first stated for this evidence) is inscribed in the circle, half side floor(${t.r} / √2 × 256) / 256; the circle is the region the evaluation matrix declares on this part in its bone-band form (docs/evidence/auto-mesh-matrix.md), handed to rig-c as the regular polygon circlePolygon names.`,
      '',
      '```json',
      JSON.stringify(square),
      JSON.stringify(circle),
      '```',
      '',
    );
    lines.push('## The runs', '');
    lines.push('| run | source → full result → written (hull+interior) | written vertices / triangles | removed / inserted (full run) | termination (full run) | MQ_LOCAL_DEFORMATION (full result, every frame held out) | written mesh | verdict |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    const written = new Map<string, { mesh: ReducedMesh; step: string } | string>();
    for (const r of runs) {
      const c = r.cell;
      if (c === null) {
        lines.push(`| ${r.label} | — | — | — | — | — | — | refused ${(r.refused ?? '').split(':')[0]} |`);
        continue;
      }
      const w = r === off ? wOff : c.written === undefined ? 'nothing written' : writtenMesh(c);
      written.set(r.label, w);
      const src = c.row?.source.counts;
      const full = c.row?.result.counts;
      const wr = c.written?.result.counts;
      const counts = `${src === undefined || src === null ? 'unread' : `${src.boundaryVertices}+${src.interiorVertices}`} → ${full === undefined ? 'not built' : `${full.boundaryVertices}+${full.interiorVertices}`} → ${wr === undefined ? 'nothing' : `${wr.boundaryVertices}+${wr.interiorVertices}`}`;
      const vt = wr === undefined ? '—' : `${wr.boundaryVertices + wr.interiorVertices} / ${wr.triangles}`;
      const changes = c.row === undefined ? '—' : `${c.row.result.removedVertices} / ${c.row.result.insertedVertices}`;
      lines.push(`| ${r.label} | ${counts} | ${vt} | ${changes} | ${c.row === undefined ? '—' : terminationText(c.row.termination)} | ${cell(rowOf(c.report, 'MQ_LOCAL_DEFORMATION'))} | ${typeof w === 'string' ? w : w.step} | ${verdictOf(c)} |`);
    }
    for (const r of runs) if (r.refused !== null) lines.push('', `${r.label}, refused: ${r.refused.replace(/\n/g, ' / ')}`);
    for (const r of runs) {
      if (r === off || r.cell === null || r.cell.row === undefined) continue;
      const row = r.cell.written ?? r.cell.row;
      const set = r.cell.row.settings.regions[0];
      lines.push(
        '',
        `${r.label}, the row: \`regions\` ${JSON.stringify(row.regions)}; \`settings.regions[0]\` bone ${JSON.stringify(set?.bone)}, band ${JSON.stringify(set?.band)}; \`settings.protect.influences\` ${JSON.stringify(r.cell.row.settings.protect.influences)} (without a region: ${JSON.stringify(offCell.row?.settings.protect.influences ?? 'unread')}); \`bones\` ${JSON.stringify(r.cell.row.bones)} (without a region: ${JSON.stringify(offCell.row?.bones ?? 'unread')}).`,
      );
    }
    lines.push('', '## The weights, by program', '');
    lines.push(
      `Checked by \`weightDiff\` and \`commonSurvivors\` (this tool; the selftest's AM56 holds them to the synthetic strip and plants a failure for each). The rule for an inserted vertex is rig-c's contract §6: the barycentric interpolation of the source triangle that holds it (the first by index whose smallest coordinate is the largest), then pruned under the input's \`influences\` (cap, floor), its \`protect.influences\` and its bone order, on the 6-decimal grid — reproduced by \`sectionSixMix\` and \`pruneShares\` and compared bone by bone, the same doubles required. The withdrawn rule (the lattice's \`influences()\` at the vertex's position) is not checked here: it is not linear in position, and AM52 shows it missing every inserted vertex of the synthetic strip.`,
      '',
    );
    lines.push('| run | check | vertices checked | holding | not holding |');
    lines.push('| --- | --- | --- | --- | --- |');
    let diffed = 0;
    for (const r of runs) {
      if (r === off) continue;
      const c = r.cell;
      const w = written.get(r.label);
      if (c === null || c.input === null) {
        lines.push(`| ${r.label} | source vertex: weights with the region = without | not measured: the stage refused the part on geometry before a comparison, and the tool keeps no input from a refused run | — | — |`);
        continue;
      }
      const samePoints = JSON.stringify(offInput.source.points) === JSON.stringify(c.input.source.points) && JSON.stringify(offInput.source.triangles) === JSON.stringify(c.input.source.triangles);
      if (!samePoints) fail(`${r.label}: the source differs from the run without a region in its points or triangles`);
      const offW = offInput.source.weights;
      const onW = c.input.source.weights;
      if (offW === null || onW === null) {
        fail(`${r.label}: an unweighted source`);
        continue;
      }
      const row = (what: string, n: number, ok: number): void => {
        lines.push(`| ${r.label} | ${what} | ${n} | ${ok} | ${n - ok} |`);
        if (ok !== n) fail(`${r.label}, ${what}: ${n - ok} of ${n} do not hold`);
      };
      const sameLength = onW.length === offW.length;
      const sourceSame = onW.filter((l, v) => v < offW.length && listText(l) === listText(offW[v])).length;
      row(`1. source vertex: weights with the region = without (same bones, order and doubles; the same points and triangles: ${samePoints})`, Math.max(onW.length, offW.length), sameLength ? sourceSame : 0);
      if (w === undefined || typeof w === 'string') {
        lines.push(`| ${r.label} | 2.–4. the written mesh | not measured: ${w ?? 'no mesh written'} | — | — |`);
        continue;
      }
      diffed++;
      const lim = c.input.influences;
      if (lim === undefined || lim === null || c.input.boneOrder === undefined || c.input.boneOrder === null) {
        fail(`${r.label}: the input carries no influences or no bone order, so §6's prune cannot be reproduced`);
        continue;
      }
      const d = weightDiff(offW, onW, { points: c.input.source.points, triangles: c.input.source.triangles }, w.mesh, { maxInfluences: lim.maxInfluences, minWeight: lim.minWeight, guarded: c.input.protect.influences, boneOrder: c.input.boneOrder });
      row(`2. written mesh (${w.step}): surviving source vertex = its source weights, bit for bit`, d.survivors, d.survivorsIdentical);
      row(`3. written mesh (${w.step}): inserted vertex = rig-c §6 interpolation of its source triangle`, d.inserted, d.insertedInterpolated);
      if (typeof wOff === 'string') lines.push(`| ${r.label} | 4. (not measured: no written mesh without a region) | — | — | — |`);
      else {
        const both = commonSurvivors(wOff.mesh, w.mesh);
        row('4. source vertex surviving in both written meshes: the same weights in both', both.both, both.identical);
      }
    }
    if (diffed === 0) fail('no run with a region wrote a mesh, so no written mesh was diffed');
    lines.push('', '## Re-running this evidence', '');
    lines.push(
      `Inputs: the public example ${EXAMPLE} of https://github.com/firejune/spine-parts-examples at commit ${pinnedInputs()} (the pin in \`scripts/fetch-examples.sh\`; \`bun run fetch-examples\` copies it into the gitignored \`examples/${EXAMPLE}/inputs\`), with its tracked \`examples/${EXAMPLE}/config.json\`; rig-c ${installedRigc()} as \`bun install --frozen-lockfile\` installs it from \`bun.lock\`. No other input is read, and nothing is written but standard output (the stages run in a temporary directory, removed afterwards). Each run's wall time and rigc build count go to standard error and are not part of this document.`,
      '',
      '```sh',
      'bun install --frozen-lockfile',
      'bun run fetch-examples',
      'timeout 600 bun tools/auto_density_survey.ts > docs/evidence/auto-density-region.md',
      '```',
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(lines.join('\n'));
  if (failed > 0) process.exit(1);
}

if (import.meta.main) main();

