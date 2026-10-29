#!/usr/bin/env bun
/**
 * rigc#1271 Q8, measured on the public examples, and Q1 option (ii) tried, by
 * one command:
 *
 *     bun run fetch-examples          # once: examples/{reference-demo,reference-sample,scarf}/inputs
 *     bun tools/auto_boundary_survey.ts > docs/evidence/auto-boundary-survey.md
 *
 * **Q8** (rig-c's docs/MESH_REDUCTION.md §8, *Questions for parts*): whether
 * the boundary half of the automatic mode's density is §8's two-tolerance
 * mechanism — an outline simplified at 1 px, held to a deviation bound of 1 px
 * measured against that same outline. Two readings, on the unreduced source
 * hull (alpha 1 and above) the rig stage hands `reduceMesh`:
 *
 * - **The sagitta of a hull vertex** ({@link sagittas}): the distance from the
 *   vertex to the chord joining its two neighbours on the hull, as a segment
 *   (rig-c's `distanceToSegment`, clamped to its ends). §8 reads it as the
 *   deviation one removal from the source leaves ("the measured deviation
 *   equals the removed vertex's sagitta over its neighbours' chord"), so a
 *   vertex whose sagitta exceeds `maxBoundaryDeviation` cannot be the first
 *   removal of its run. Reported as P10 / P50 / P90 (nearest rank: the value
 *   at sorted index `ceil(q n) - 1`) and the count at or under the declared
 *   deviation, over the hull's vertex count.
 * - **B\*** ({@link bStar}): §8's "fewest source-hull vertices a closed outline
 *   can keep with every static row held". §8 states the definition, not the
 *   search; the search here is this tool's, and is stated so it can be
 *   checked: a chord from hull vertex i to j skipping the vertices between is
 *   *admissible* when, on the chord's own cap (the polygon i, i+1, ..., j),
 *   (1) every skipped vertex lies within the deviation bound of the chord and
 *   every point of the chord within it of the skipped polyline (sampled every
 *   1/64 px along the chord — a sampled reading, not a bound; the global
 *   verification below is what certifies the cycle), (2) no art pixel centre the source
 *   covers leaves the outline (coverage 1 / undercut 0), and (3) no pixel
 *   centre the outline newly covers lies outside the 8-connected filled
 *   silhouette further than `maxOvershoot` from it. B\* is the fewest
 *   vertices of a cycle of admissible chords (every start, a shortest path
 *   once round), at most {@link MAX_SKIP} vertices skipped per chord. Each
 *   condition is local to the cap and, but for the sampling, no looser than
 *   the global row (a point's distance to the whole outline is at most its
 *   distance to the cap's part of it, so a chord the global row would allow
 *   may be refused here, never the reverse: the count is an upper bound on
 *   the true minimum), and the cycle found is then **verified globally**: its
 *   outline must not cross itself, and the mesh of that outline alone,
 *   ear-clipped (rig-c's `earClip`, wound counter-clockwise in Spine world),
 *   must pass every bounded row of rig-c's `measureMeshQuality` with the
 *   input's own targets against the source hull — the test §8 states its B\*
 *   outlines passed. A cycle that fails it is printed with the rows that
 *   failed, never as B\*.
 *
 * B\* is set beside the boundary the reduction kept: the full reduction's, and
 * the replayed candidate's (the step the acceptance loop chose, #141) where
 * there is one.
 *
 * **Q1 option (ii)**: the eight parts item 2 accepted, under the motion
 * survey's policy (`withPolicyMotion(examplePolicy(spacing))`) with only
 * `source.tolerance` lowered ({@link finerSourcePolicy}) — every declared bound
 * unchanged — through the real rig stage, the motion gate and the acceptance
 * loop (`motionCell`, `tools/auto_motion_survey.ts`), with the tolerance-1 rows
 * beside them.
 *
 * Each (part, tolerance) cell runs in a process of its own (this file,
 * `--cell`), killed at `--cell-cap` seconds (default 600): a cell past its cap
 * is printed as stopped, with the Q8 readings it wrote before its reduction
 * started, and the run moves on.
 *
 * Output: Markdown. Every number is read from rig-c's reports, from the
 * stage's rows, or computed here from the input the stage made; no path, no
 * time and no machine is printed, so two runs of one tree print the same
 * bytes (a cell stopped at its cap excepted). Each cell's wall time goes to
 * standard error. Exit 1 when an
 * example's inputs are missing or a re-run comparison disagrees with the
 * stage; 0 otherwise — a refusal is a result.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  artOf,
  distanceToSegment,
  earClip,
  fillEnclosed,
  findSelfIntersection,
  measureMeshQuality,
  type MeshReductionInput,
  rasteriseTriangles,
  squaredDistanceToSet,
  windCounterClockwiseInSpineWorld,
} from '@rig-c/core/mesh';
import { terminationText } from '../src/automesh.ts';
import { findRigc } from '../src/check.ts';
import { type AutoSpec, loadConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { readParts } from '../src/parts.ts';
import { readPng, type Raster } from '../src/raster/index.ts';
import { buildRig } from '../src/rig.ts';
import { examplePolicy, finerSourcePolicy } from '../fixtures/automesh.ts';
import { withPolicyMotion } from '../fixtures/automotion.ts';
import { assembleExample, cell, installedRigc, missingInputs, type MotionCell, motionCell, pinnedInputs, rowOf, trackedSpacing, verdictOf, writeSwitchedConfig } from './auto_motion_survey.ts';

const ROOT = resolve(import.meta.dir, '..');

/** Q8's parts: the three the motion gate refuses in full (docs/evidence/auto-motion-survey.md) and two it accepts outright, for contrast. */
export const Q8_PARTS: ReadonlyArray<readonly [string, string]> = [
  ['reference-demo', 'bottomwear'],
  ['reference-sample', 'sleeves'],
  ['reference-sample', 'bottomwear'],
  ['reference-demo', 'neck'],
  ['scarf', 'handwear_l'],
];

/** The eight parts item 2 accepted on geometry (the motion survey's set), by example. */
export const ITEM2_PARTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['reference-demo', ['neck', 'bottomwear']],
  ['reference-sample', ['neck', 'sleeves', 'topwear', 'bottomwear']],
  ['scarf', ['hair_front', 'handwear_l']],
];

/** The stated policy's source tolerance and the finer ones option (ii) tries. */
export const DEFAULT_TOLERANCES: readonly number[] = [1, 0.5, 0.25];

/** The most hull vertices one chord of a B\* search may skip; a cycle that uses a chord this long is flagged. */
export const MAX_SKIP = 128;

/** The step along a chord at which its distance to the skipped polyline is sampled, px. */
export const CHORD_SAMPLE = 1 / 64;

type Pt = readonly [number, number];

/** The sagitta of every hull vertex: its distance to the segment joining its two neighbours (cyclic). */
export function sagittas(hull: readonly Pt[]): number[] {
  const n = hull.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(distanceToSegment(hull[i], hull[(i + n - 1) % n], hull[(i + 1) % n]));
  return out;
}

/** The nearest-rank quantile: the value at sorted index `ceil(q n) - 1` (clamped to the list). */
export function nearestRank(values: readonly number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** The sagitta distribution of a hull: P10 / P50 / P90 (nearest rank, 6 decimals) and the count at or under `bound`. */
export interface SagittaSummary {
  vertices: number;
  p10: number;
  p50: number;
  p90: number;
  atOrUnder: number;
  bound: number;
}

export function sagittaSummary(hull: readonly Pt[], bound: number): SagittaSummary {
  const s = sagittas(hull);
  return { vertices: s.length, p10: r6(nearestRank(s, 0.1)), p50: r6(nearestRank(s, 0.5)), p90: r6(nearestRank(s, 0.9)), atOrUnder: s.filter((v) => v <= bound).length, bound };
}

/** Even-odd: is the point inside the closed polygon? */
function insideEvenOdd(px: number, py: number, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, ya] = poly[a];
    const [xb, yb] = poly[b];
    if (ya > py !== yb > py && px < ((xb - xa) * (py - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}

/** The distance from `p` to the polyline `pts` (open). */
function toPolyline(p: Pt, pts: readonly Pt[]): number {
  let d = Infinity;
  for (let k = 0; k + 1 < pts.length; k++) d = Math.min(d, distanceToSegment(p, pts[k], pts[k + 1]));
  return d;
}

/** What a B\* search returns: the count, the hull indices kept, and the global verification. */
export interface BStar {
  /** The fewest vertices of a cycle of admissible chords; null when no cycle closed. */
  count: number | null;
  kept: number[];
  /** The longest skip any chord of the cycle used; equal to {@link MAX_SKIP} means the cap may have bound. */
  longestSkip: number;
  /** The cycle's outline crosses itself (edge pair), or null. */
  crossing: [number, number] | null;
  /** Bounded rows of `measureMeshQuality` the cycle's ear-clipped outline fails, as `code value`; empty when it passes. */
  failing: string[];
  /** Rows the verification read with a declared bound, as `code state value`. */
  rows: string[];
}

/**
 * B\* of a reduction input's source hull under its own targets (module header).
 * Refuses (throws) a policy whose art rows the cap-local test cannot read:
 * coverage below 1 or an undercut bound other than 0.
 */
export function bStar(input: MeshReductionInput, maxSkip: number = MAX_SKIP): BStar {
  const fit = input.targets.artFit;
  if (fit === null || fit.minCoverage !== 1 || fit.maxUndercut !== 0) {
    throw new Error(`bStar: the cap-local test reads coverage 1 with undercut 0; this input declares minCoverage ${fit?.minCoverage}, maxUndercut ${fit?.maxUndercut}`);
  }
  const dev = input.targets.maxBoundaryDeviation;
  if (dev === null) throw new Error('bStar: the input declares no maxBoundaryDeviation, so no chord has a deviation to be held to');
  const { mask, threshold } = input.art;
  const w = mask.width;
  const h = mask.height;
  const art = artOf(mask, threshold);
  const fill = fillEnclosed(art, w, h, 8).filled;
  const dist2 = squaredDistanceToSet(fill, w, h);
  const covered = rasteriseTriangles(input.source.points, input.source.triangles, w, h);
  const H = input.source.hull;
  const hull: Pt[] = input.source.points.slice(0, H);
  const over = fit.maxOvershoot;

  const admissible = (i: number, skip: number): boolean => {
    const cap: Pt[] = [];
    for (let k = 0; k <= skip + 1; k++) cap.push(hull[(i + k) % H]);
    const a = cap[0];
    const b = cap[cap.length - 1];
    for (let k = 1; k <= skip; k++) if (distanceToSegment(cap[k], a, b) > dev) return false;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / CHORD_SAMPLE));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (toPolyline([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], cap) > dev) return false;
    }
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [x, y] of cap) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    for (let py = Math.max(0, Math.floor(y0 - 1)); py <= Math.min(h - 1, Math.ceil(y1 + 1)); py++) {
      for (let px = Math.max(0, Math.floor(x0 - 1)); px <= Math.min(w - 1, Math.ceil(x1 + 1)); px++) {
        if (!insideEvenOdd(px + 0.5, py + 0.5, cap)) continue;
        const p = py * w + px;
        if (covered[p]) {
          if (art[p]) return false;
        } else if (!fill[p] && over !== null && r6(Math.sqrt(dist2[p])) > over) {
          return false;
        }
      }
    }
    return true;
  };

  // edges[i] = the skips admissible from vertex i (0 = the hull's own edge).
  const edges: number[][] = [];
  for (let i = 0; i < H; i++) {
    const list = [0];
    for (let skip = 1; skip <= Math.min(maxSkip, H - 3); skip++) if (admissible(i, skip)) list.push(skip);
    edges.push(list);
  }
  let best: number[] | null = null;
  for (let s = 0; s < H; s++) {
    const dist = new Array<number>(H + 1).fill(Infinity);
    const from = new Array<number>(H + 1).fill(-1);
    dist[0] = 0;
    for (let d = 0; d < H; d++) {
      if (dist[d] === Infinity) continue;
      for (const skip of edges[(s + d) % H]) {
        const e = d + skip + 1;
        if (e <= H && dist[d] + 1 < dist[e]) {
          dist[e] = dist[d] + 1;
          from[e] = d;
        }
      }
    }
    if (dist[H] === Infinity || (best !== null && dist[H] >= best.length)) continue;
    const path: number[] = [];
    for (let e = H; e > 0; e = from[e]) path.push((s + from[e]) % H);
    best = path.reverse();
  }
  if (best === null) return { count: null, kept: [], longestSkip: 0, crossing: null, failing: ['no cycle of admissible chords closes'], rows: [] };
  const kept = [...best].sort((a, b) => a - b);
  let longestSkip = 0;
  for (let k = 0; k < kept.length; k++) longestSkip = Math.max(longestSkip, (kept[(k + 1) % kept.length] - kept[k] + H) % H - 1);
  const outline: Array<[number, number]> = kept.map((v) => [hull[v][0], hull[v][1]]);
  const crossing = findSelfIntersection(outline);
  if (crossing !== null) return { count: kept.length, kept, longestSkip, crossing, failing: ['the outline crosses itself'], rows: [] };
  const triangles = windCounterClockwiseInSpineWorld(outline, earClip(outline));
  const report = measureMeshQuality({
    id: 'b-star',
    attachment: input.attachment,
    art: input.art,
    source: { points: outline, uvs: kept.flatMap((v) => [input.source.uvs[2 * v], input.source.uvs[2 * v + 1]]), triangles, hull: kept.length, weights: null },
    targets: { artFit: fit, maxBoundaryDeviation: dev, regions: [] },
    referenceHull: hull.map(([x, y]) => [x, y] as [number, number]),
    minArtSamples: input.minArtSamples,
    regionArtSamples: [],
    protect: null,
    influences: null,
    boneOrder: null,
    preset: null,
  });
  const bounded = (report.candidates[0]?.geometry?.rows ?? []).filter((r) => r.bound !== null);
  return {
    count: kept.length,
    kept,
    longestSkip,
    crossing: null,
    failing: bounded.filter((r) => r.state !== 'pass').map((r) => `${r.code} ${r.state} ${r.value}`),
    rows: bounded.map((r) => `${r.code} ${r.state} ${r.value}`),
  };
}

/** The source hull of a reduction input: its first `hull` points. */
export function sourceHullOf(input: MeshReductionInput): Pt[] {
  return input.source.points.slice(0, input.source.hull);
}

/** Hull and interior vertex counts. */
export interface HullInterior {
  hull: number;
  interior: number;
}

/**
 * One (part, tolerance) cell as plain data — what a cell's child process
 * writes and {@link render} reads. Every field is read off the stage's rows,
 * rig-c's reports or the input the stage made; none is typed.
 */
export interface CellRow {
  example: string;
  part: string;
  tolerance: number;
  /** Q8 parts only: the sagitta distribution of the source hull, and B\*. */
  sagitta: SagittaSummary | null;
  bStar: BStar | null;
  /** The source the rig stage built, or null when it built none (the contour gate refused it). */
  source: HullInterior | null;
  /** The full reduction's result, or null. */
  full: HullInterior | null;
  /** What the stage wrote (the replayed step's when the loop chose one), or null when it wrote nothing. */
  chosen: HullInterior | null;
  /** MQ_BOUNDARY_DEVIATION of the full result and of the chosen row, as `value (state)`. */
  deviationFull: string;
  deviationChosen: string;
  /** The full result's MQ_LOCAL_DEFORMATION, every frame held out, as `value / bound @ frame`. */
  fullMotion: string;
  /** The acceptance loop's figures when it chose a replayed step, or null. */
  replay: { chosenStep: number; acceptedSteps: number; replays: number; candidatesTried: number; selection: string; heldOut: string } | null;
  /** The full reduction's candidates tried, or `n/a`. */
  reductionCandidates: string;
  termination: string;
  verdict: string;
  refusal: string | null;
  disagreement: string | null;
  /** Set by the parent when the cell's child passed its cap; the other fields are then what the child wrote before it was stopped. */
  stopped: string | null;
}

const residualOf = (row: MotionCell['row'] | MotionCell['written'], code: string): string => {
  const r = row?.residuals.find((x) => x.code === code && x.region === null);
  return r === undefined ? 'n/a' : `${r.value} (${r.state})`;
};

const roleText = (x: { value: number | null; frame: string | null } | null | undefined): string => (x === null || x === undefined ? 'n/a' : `${x.value} @ ${x.frame ?? 'every frame'}`);

/** A cell before its reduction ran: the Q8 readings only, every stage field unread. */
export function pendingRow(example: string, part: string, tolerance: number, sagitta: SagittaSummary | null, b: BStar | null, source: HullInterior | null): CellRow {
  return {
    example,
    part,
    tolerance,
    sagitta,
    bStar: b,
    source,
    full: null,
    chosen: null,
    deviationFull: 'n/a',
    deviationChosen: 'n/a',
    fullMotion: 'not measured',
    replay: null,
    reductionCandidates: 'n/a',
    termination: 'no reduction finished',
    verdict: 'not finished',
    refusal: null,
    disagreement: null,
    stopped: null,
  };
}

/** A finished cell from the stage's {@link MotionCell}. */
export function cellRow(r: MotionCell, tolerance: number, sagitta: SagittaSummary | null, b: BStar | null): CellRow {
  const src = r.row?.source.counts;
  const full = r.row?.result.counts;
  const w = r.written?.result.counts;
  const rp = r.written?.replay;
  const t = r.row?.termination;
  return {
    example: r.example,
    part: r.part,
    tolerance,
    sagitta,
    bStar: b,
    source: src === undefined || src === null ? null : { hull: src.boundaryVertices, interior: src.interiorVertices },
    full: full === undefined ? null : { hull: full.boundaryVertices, interior: full.interiorVertices },
    chosen: w === undefined ? null : { hull: w.boundaryVertices, interior: w.interiorVertices },
    deviationFull: residualOf(r.row, 'MQ_BOUNDARY_DEVIATION'),
    deviationChosen: residualOf(r.written, 'MQ_BOUNDARY_DEVIATION'),
    fullMotion: cell(rowOf(r.report, 'MQ_LOCAL_DEFORMATION')),
    replay: rp === undefined ? null : { chosenStep: rp.chosen_step, acceptedSteps: rp.accepted_steps, replays: rp.replays, candidatesTried: rp.candidates_tried, selection: roleText(rp.selection), heldOut: roleText(rp.held_out) },
    reductionCandidates: t !== undefined && 'candidatesTried' in t ? `${t.candidatesTried}` : 'n/a',
    termination: t === undefined ? 'no reduction ran' : terminationText(t),
    verdict: verdictOf(r),
    refusal: r.refusal,
    disagreement: r.disagreement,
    stopped: null,
  };
}

/** A kept boundary count with its distance above B\*, or the count alone when B\* was not verified. */
function keptText(kept: number | undefined, b: BStar | null): string {
  if (kept === undefined) return 'n/a';
  if (b === null || b.count === null || b.failing.length > 0) return `${kept}`;
  return `${kept} (${kept - b.count >= 0 ? '+' : ''}${kept - b.count})`;
}

const hiText = (c: HullInterior | null, none: string): string => (c === null ? none : `${c.hull}+${c.interior}`);

/** The Markdown for a list of cells, Q8 first then the trial; no clock, path or machine is read. */
export function render(cells: readonly CellRow[], rigcVersion: string, pinned: string, tolerances: readonly number[], capSeconds: number): string[] {
  const out: string[] = [];
  out.push('# The boundary half of the automatic mesh on the public examples (rigc#1271 Q8, Q1 option ii)', '');
  out.push(
    `Generated by \`bun tools/auto_boundary_survey.ts\`; every figure below is the tool's, none typed. The installed rig-c ${rigcVersion}. The parts are the public examples' (demo, sample, scarf), not private art. Policy: withPolicyMotion(examplePolicy(spacing)) (fixtures/automesh.ts, fixtures/automotion.ts) — the motion survey's — and, for option (ii), the same with only \`source.tolerance\` lowered (finerSourcePolicy); each part switched alone; the real rig stage, the motion gate and the acceptance loop (src/autoreplay.ts). Each cell runs in a process of its own, stopped at ${capSeconds} s.`,
    '',
  );
  out.push('## Q8 — the sagitta of the source hull, and B\\*', '');
  out.push(
    `Sagitta: each source-hull vertex's distance to the segment joining its two neighbours (rig-c distanceToSegment), the deviation one removal from the source leaves; P10 / P50 / P90 by nearest rank; "≤ bound" counts vertices at or under the declared maxBoundaryDeviation. B\\*: the fewest source-hull vertices of a cycle of chords each admissible on its own cap (deviation, coverage 1 / undercut 0, overshoot), at most ${MAX_SKIP} vertices skipped per chord, verified globally — the cycle's ear-clipped outline passes every bounded row of measureMeshQuality against the source hull with the input's own targets (the tool's module header). Kept counts are followed by their distance above B\\*.`,
    '',
  );
  out.push('| part | tolerance | source hull (+interior) | sagitta P10 / P50 / P90 | ≤ bound / hull | B\\* | B\\* verified (bounded rows) | full reduction kept boundary (above B\\*) | replayed candidate kept boundary (above B\\*) | removed from the hull: full / replayed |');
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const c of cells) {
    if (c.sagitta === null) continue;
    const s = c.sagitta;
    const b = c.bStar;
    const bText = b === null ? 'not run' : b.count === null ? 'none' : `${b.count}${b.longestSkip >= MAX_SKIP ? ` (a chord at the ${MAX_SKIP}-vertex cap: an upper bound)` : ''}`;
    const verified = b === null ? 'not run' : b.crossing !== null ? `no — the outline crosses itself at edges ${b.crossing.join(', ')}` : b.failing.length > 0 ? `no — ${b.failing.join('; ')}` : `yes — ${b.rows.join('; ')}`;
    const full = c.full?.hull;
    const replayed = c.replay === null ? undefined : c.chosen?.hull;
    const removed = `${full === undefined ? 'n/a' : s.vertices - full} / ${replayed === undefined ? 'no replay' : s.vertices - replayed}`;
    const noReplay = c.stopped !== null ? 'stopped' : 'no replay (accepted outright, or refused)';
    out.push(
      `| ${c.example}/${c.part} | ${c.tolerance} | ${c.source === null ? 'unread' : `${c.source.hull} (+${c.source.interior})`} | ${s.p10} / ${s.p50} / ${s.p90} | ${s.atOrUnder} / ${s.vertices} (bound ${s.bound}) | ${bText} | ${verified} | ${keptText(full, b)} | ${replayed === undefined ? noReplay : keptText(replayed, b)} | ${removed} |`,
    );
  }
  out.push('', '## Q1 option (ii) — the source sampled finer than the declared bound', '');
  out.push(
    `Every declared bound is the stated policy's (coverage 1, overshoot ≤ 3, undercut 0, maxBoundaryDeviation 1, influences {4, 0}, budget 5000, one art sample, the motion gate's local deformation ≤ 1); only source.tolerance moves (${tolerances.join(', ')}). "full" is the reduction's whole result, "chosen" the row the stage wrote (the replayed step's when the acceptance loop chose one). Motion values are MQ_LOCAL_DEFORMATION in px at the worst frame.`,
    '',
  );
  out.push('| part | tolerance | source → full → chosen (hull+interior) | boundary kept: full / chosen | MQ_BOUNDARY_DEVIATION: full / chosen | full result\'s motion (every frame held out) | chosen step (of N): selection / held out | reduction candidates | replays (candidates tried) | verdict |');
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const c of cells) {
    const counts = `${hiText(c.source, 'not built')} → ${hiText(c.full, 'not built')} → ${hiText(c.chosen, 'nothing')}`;
    const sel = c.replay === null ? 'n/a (no replay)' : `${c.replay.chosenStep} of ${c.replay.acceptedSteps}: ${c.replay.selection} / ${c.replay.heldOut}`;
    const replays = c.replay === null ? '0' : `${c.replay.replays} (${c.replay.candidatesTried})`;
    out.push(
      `| ${c.example}/${c.part} | ${c.tolerance} | ${counts} | ${c.full?.hull ?? 'n/a'} / ${c.chosen?.hull ?? 'n/a'} | ${c.deviationFull} / ${c.deviationChosen} | ${c.fullMotion} | ${sel} | ${c.reductionCandidates} | ${replays} | ${c.stopped ?? c.verdict} |`,
    );
  }
  out.push('', '### Terminations of the full reductions', '');
  for (const c of cells) out.push(`- ${c.example}/${c.part} at tolerance ${c.tolerance}: ${c.stopped ?? c.termination}`);
  const refused = cells.filter((c) => c.refusal !== null);
  if (refused.length > 0) {
    out.push('', '### Refusals', '');
    for (const c of refused) out.push(`- ${c.example}/${c.part} at tolerance ${c.tolerance}: ${c.refusal}`);
  }
  out.push(...rerunSection(rigcVersion, pinned, tolerances, capSeconds));
  return out;
}

/** "Re-running this evidence": the inputs at their pinned commit, rig-c as the lock installs it, the command and its caps. */
export function rerunSection(rigcVersion: string, pinned: string, tolerances: readonly number[], capSeconds: number): string[] {
  return [
    '',
    '## Re-running this evidence',
    '',
    `Inputs: the public examples demo, sample and scarf of https://github.com/firejune/spine-parts-examples at commit ${pinned} (the pin in \`scripts/fetch-examples.sh\`; \`bun run fetch-examples\` copies them into the gitignored \`examples/<key>/inputs\`), each with its tracked \`examples/<key>/config.json\`; rig-c ${rigcVersion} as \`bun install --frozen-lockfile\` installs it from \`bun.lock\`; source tolerances ${tolerances.join(', ')}; each cell stopped at ${capSeconds} s. No other input is read, and nothing is written but standard output (the cells run in a temporary directory, removed afterwards). Each cell's wall time goes to standard error and is not part of this document.`,
    '',
    '```sh',
    'bun install --frozen-lockfile',
    'bun run fetch-examples',
    `timeout 2700 bun tools/auto_boundary_survey.ts --tolerances ${tolerances.join(',')} --cell-cap ${capSeconds} > docs/evidence/auto-boundary-survey.md`,
    '```',
  ];
}

/** The tool's arguments: `--tolerances 1,0.5` (default {@link DEFAULT_TOLERANCES}), `--cell-cap <s>` (default 600), `--parts q8`; or a child's `--cell <key>/<part> --tolerance <t> --out <file>`. */
export interface Args {
  tolerances: number[];
  capSeconds: number;
  q8Only: boolean;
  child: { example: string; part: string; tolerance: number; out: string } | null;
}

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = { tolerances: [...DEFAULT_TOLERANCES], capSeconds: 600, q8Only: false, child: null };
  let cellName: string | null = null;
  let tol: number | null = null;
  let outFile: string | null = null;
  const num = (v: string | undefined, what: string): number => {
    const n = Number(v);
    if (v === undefined || v === '' || !Number.isFinite(n) || n < 0) throw new Error(`${what} needs a number 0 or more, got "${v}"`);
    return n;
  };
  for (let k = 0; k < argv.length; k++) {
    const f = argv[k];
    if (f === '--tolerances') a.tolerances = (argv[++k] ?? '').split(',').map((v) => num(v, '--tolerances'));
    else if (f === '--cell-cap') a.capSeconds = num(argv[++k], '--cell-cap');
    else if (f === '--parts' && argv[k + 1] === 'q8') {
      a.q8Only = true;
      k++;
    } else if (f === '--cell') cellName = argv[++k] ?? '';
    else if (f === '--tolerance') tol = num(argv[++k], '--tolerance');
    else if (f === '--out') outFile = argv[++k] ?? '';
    else throw new Error(`unknown argument "${f}"; usage: auto_boundary_survey.ts [--tolerances 1,0.5,0.25] [--cell-cap 600] [--parts q8]`);
  }
  if (cellName !== null) {
    const [example, part] = cellName.split('/');
    if (example === undefined || part === undefined || tol === null || outFile === null || outFile === '') throw new Error('a child needs --cell <key>/<part>, --tolerance <t> and --out <file>');
    a.child = { example, part, tolerance: tol, out: outFile };
  }
  return a;
}

/** The policy one (part, tolerance) cell runs under: the motion survey's at the stated tolerance, otherwise {@link finerSourcePolicy}. */
export function policyAt(spacing: number, tolerance: number): AutoSpec {
  const stated = examplePolicy(spacing);
  return tolerance === stated.source.tolerance ? stated : finerSourcePolicy(spacing, tolerance);
}

/** The reduction input the rig stage makes for one part under `auto`, without running the reduction (the reducer stops the stage at its first call). */
export function stageInput(example: string, part: string, auto: unknown, asm: string, dir: string): MeshReductionInput | null {
  const raw = JSON.parse(readFileSync(join(ROOT, 'examples', example, 'config.json'), 'utf8')) as { meshes: Record<string, { r: number; segments: unknown }> };
  const m = raw.meshes[part];
  (raw.meshes as Record<string, unknown>)[part] = { auto, r: m.r, segments: m.segments };
  writeSwitchedConfig(example, raw, dir);
  const images = new Map<string, Raster>();
  const partsFile = readParts(join(asm, 'parts.json'));
  for (const p of partsFile.parts) images.set(p.name, readPng(join(asm, 'parts', `${p.name}.png`)));
  let input: MeshReductionInput | null = null;
  try {
    buildRig(loadConfig(join(dir, 'config.json')), partsFile, images, undefined, undefined, (object, given) => {
      input ??= given;
      return { code: 'AUTO_BOUNDARY_SURVEY_INPUT_ONLY', object, detail: 'the reduction input was read; the reduction runs in the stage' };
    });
  } catch (err) {
    if (!(err instanceof PartsError)) throw err;
  }
  return input;
}

/** A child: one cell, its Q8 readings written first (so a cell stopped at its cap still carries them), then the stage's. */
function runChild(c: NonNullable<Args['child']>): void {
  const work = mkdtempSync(join(tmpdir(), 'rig-parts-auto-boundary-cell-'));
  try {
    const asm = assembleExample(work, c.example);
    const auto = withPolicyMotion(policyAt(trackedSpacing(c.example, c.part), c.tolerance));
    const q8 = Q8_PARTS.some(([k, p]) => k === c.example && p === c.part);
    const input = stageInput(c.example, c.part, auto, asm, join(work, 'input'));
    const sagitta = q8 && input !== null ? sagittaSummary(sourceHullOf(input), input.targets.maxBoundaryDeviation ?? Number.NaN) : null;
    const b = q8 && input !== null ? bStar(input) : null;
    const source = input === null ? null : { hull: input.source.hull, interior: input.source.points.length - input.source.hull };
    writeFileSync(c.out, JSON.stringify(pendingRow(c.example, c.part, c.tolerance, sagitta, b, source)));
    const r = motionCell(c.example, c.part, auto, asm, join(work, 'cell'), findRigc(ROOT, ''));
    writeFileSync(c.out, JSON.stringify(cellRow(r, c.tolerance, sagitta, b)));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.child !== null) {
    runChild(args.child);
    return;
  }
  const missing = missingInputs(ITEM2_PARTS.map(([k]) => k));
  if (missing.length > 0) {
    console.error(`auto_boundary_survey: no fetched inputs for ${missing.map((k) => `examples/${k}/inputs`).join(', ')}; run \`bun run fetch-examples\` first`);
    process.exit(1);
  }
  const work = mkdtempSync(join(tmpdir(), 'rig-parts-auto-boundary-survey-'));
  const cells: CellRow[] = [];
  let disagreements = 0;
  try {
    for (const [key, parts] of ITEM2_PARTS) {
      for (const part of parts) {
        if (args.q8Only && !Q8_PARTS.some(([k, p]) => k === key && p === part)) continue;
        for (const tolerance of args.tolerances) {
          const out = join(work, `${key}-${part}-${tolerance}.json`);
          const t0 = performance.now();
          const run = spawnSync(process.execPath, [join(ROOT, 'tools', 'auto_boundary_survey.ts'), '--cell', `${key}/${part}`, '--tolerance', `${tolerance}`, '--out', out], { stdio: ['ignore', 'ignore', 'inherit'], timeout: args.capSeconds * 1000, killSignal: 'SIGKILL' });
          const wrote = existsSync(out) ? (JSON.parse(readFileSync(out, 'utf8')) as CellRow) : pendingRow(key, part, tolerance, null, null, null);
          if (run.error !== undefined || run.signal !== null) wrote.stopped = `stopped at ${args.capSeconds} s (the per-cell cap)`;
          else if (run.status !== 0) wrote.stopped = `the cell's process exited ${run.status}`;
          if (wrote.disagreement !== null) {
            disagreements++;
            console.error(`auto_boundary_survey: ${wrote.disagreement}`);
          }
          console.error(`auto_boundary_survey: ${key}/${part} at tolerance ${tolerance}: ${((performance.now() - t0) / 1000).toFixed(1)} s wall, ${wrote.stopped ?? wrote.verdict}`);
          cells.push(wrote);
        }
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  for (const l of render(cells, installedRigc(), pinnedInputs(), args.tolerances, args.capSeconds)) console.log(l);
  if (disagreements > 0) process.exit(1);
}

if (import.meta.main) main();
