/**
 * `mesh-stats` (issue #566): the vertices and triangles of every mesh a config states, against an assembled parts
 * directory, before a build.
 *
 * It is the rig stage without rigc: the same inputs ({@link readRigInputs}) through the same `buildRig`, whose
 * `meshReport` rows are what `rig/mesh_report.json` is written from. Nothing triangulates a second time, so a count
 * printed here is the count the rig stage writes for the same config and parts — with one exception, which the line
 * says: an `auto` part whose motion gate refuses the full reduction is replayed by the rig stage to an earlier
 * accepted step (`rigStage`, `src/autoreplay.ts`), and that search runs rigc, so it does not run here. A problem
 * `buildRig` refuses is the build's own refusal, by the same name. Nothing is written: no skeleton data leaves memory,
 * no image, no report; rigc's gate is the gate of the commands that emit, and this one emits nothing.
 */
import { readRigInputs } from './build.ts';
import { buildRig, DEFAULT_IDLE_KEYS, type MeshReport } from './rig.ts';

/** One mesh's counts, as the rig stage's `mesh_report.json` row holds them; `mode` is `lattice` for a `grid` entry, whose row carries no mode. */
export interface MeshStatsRow {
  part: string;
  mode: 'lattice' | 'contour' | 'auto' | 'influence';
  vertices: number;
  triangles: number;
}

/** The counts of each row of a mesh report, in its order (parts.json's, the order the rig stage writes). */
export function meshStatsRows(report: readonly MeshReport[]): MeshStatsRow[] {
  return report.map((m) => ({ part: m.part, mode: 'mode' in m ? m.mode : 'lattice', vertices: m.vertices, triangles: m.triangles }));
}

/** What `auto` adds to its line: the count is the reduction's, before the motion gate that may replay it. */
export const AUTO_BEFORE_GATE = "the reduction's result; when rigc's motion gate refuses it, the rig stage replays an earlier accepted step, which this command does not run";

/** The printed lines: one per mesh, then the total. No budget line: the tree holds no triangle budget. */
export function meshStatsLines(rows: readonly MeshStatsRow[]): string[] {
  const out = rows.map((r) => `mesh-stats: ${r.part} — ${r.mode} ${r.vertices} vertices, ${r.triangles} triangles${r.mode === 'auto' ? ` (${AUTO_BEFORE_GATE})` : ''}`);
  const total = rows.reduce((n, r) => n + r.triangles, 0);
  out.push(`mesh-stats: total ${total} triangles over ${rows.length} mesh(es)`);
  return out;
}

export interface MeshStatsInput {
  /** The config, as `rig --config` reads it. */
  config: string;
  /** The directory holding parts.json and parts/<name>.png, as `rig --parts` reads it. */
  parts: string;
}

/**
 * The counts of every mesh `buildRig` makes from the config and the parts, printed through `log`. The idle's keys
 * go where `rig` puts them by default (`ctl`): where they go moves no vertex and no triangle, since a control bone
 * stands at its bone's origin and no mesh is weighted to it. Throws the rig stage's own `PartsError` on a refusal.
 */
export function meshStatsStage(input: MeshStatsInput, log: (line: string) => void): MeshStatsRow[] {
  const { cfg, parts, images } = readRigInputs(input.config, input.parts);
  const rows = meshStatsRows(buildRig(cfg, parts, images, undefined, DEFAULT_IDLE_KEYS).meshReport);
  for (const l of meshStatsLines(rows)) log(l);
  return rows;
}
