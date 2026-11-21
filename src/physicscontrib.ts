/**
 * `PHYSICS_CONTRIBUTES` (issue #1320): whether physics moves a part at all, read on the idle — **a report, never a
 * bar**. The compiled build is posed twice over the idle's frames, once with physics stepping and once with the
 * poser's physics off (spine-core's `Physics.none`, rig-c's `physicsMode: 'off'`); the same compile, the same frames,
 * the same declarations. It is not the spec with its physics constraints stripped and built again, which is what
 * `loop` and the physics-off side of `ANIMATIONS_DO_NOT_FOLD` read.
 *
 * Why it exists: `TIP_OVER_ROOT` certifies that a part's lower band travels further than its upper band against the
 * bone it hangs from, which ordinary carrier motion does with physics off (issue #1318), so a PASS there says nothing
 * about physics. This line measures the contribution itself: for every part under a physics constraint, each vertex
 * of a triangle that holds the part's art, its travel from frame 0 with physics on less its travel from frame 0 with
 * physics off, at the same frame:
 *
 *     r_f(v) = (on_f(v) − on_0(v)) − (off_f(v) − off_0(v)),   |r| = sqrt(dx² + dy²), rig px
 *
 * read as the largest |r| over those vertices on each frame 1..N−1, and over frames as its max, p95 (nearest rank)
 * and mean. Measured for issue #1320 on the public examples (15 builds): a part no physics constraint reaches reads
 * exactly 0, and so does a physics part whose constraints take up nothing (`inertia` 0 with no wind or gravity),
 * while every part physics moves reads above 0 (the smallest shipped one 0.0244 rig px). The line therefore draws
 * one edge, the definition's own: a part under physics that reads exactly 0 is a `WARN` — physics does nothing to it.
 * There is no visibility bar; how much is enough is the author's to say. The verdict does not move: the line adds no
 * problem, and `check: PASS` stays PASS.
 *
 * "Under physics" is read off rig.json and motion.json: a part bound to a bone a physics constraint drives, to a
 * descendant of one, or to a bone a transform constraint drives from such a bone (and its descendants).
 */
import { type CheckRowLabels, checkRow } from './checkrow.ts';
import { edgeLength } from './length.ts';
import type { PlacedArt } from './requirements.ts';
import type { StageBox } from './check.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PHYSICS_CONTRIBUTES_LINE = 'PHYSICS_CONTRIBUTES';

/** What the line poses "off" as, written into the line. */
export const PHYSICS_OFF_TEXT = "the same compiled build posed with the poser's physics off (spine-core Physics.none, rig-c physicsMode 'off') over the same frames — not the rig spec with its physics constraints stripped and built again";

/** Which points the residual reads, written into the line. */
export const PHYSICS_POINTS_TEXT = 'every vertex of a rest triangle that holds a pixel centre of the part\'s art (alpha above the mesh threshold); per frame the largest residual over them, frames 1..N-1';

/** The fields that make physics move a part, as the warning names them; no value is prescribed. */
export const PHYSICS_LEVERS_TEXT = "physics moves a part through its constraints' inertia (how much of its carrier's motion it takes up), wind and gravity (a force from the world) and mix, and only while something moves its carrier or the world pushes it";

/** A physics constraint as the line reads it off rig.json and motion.json. */
export interface PhysicsDecl {
  name: string;
  bone: string;
  /** True when the constraint declares a nonzero `wind` or `gravity`: it answers a force from the world. */
  force: boolean;
}

/** One part's row: its figures, or why it was not measured. */
export type PhysicsContributionRow = CheckRowLabels & {
  part: string;
  /** The physics constraints the part is under, in declaration order. */
  constraints: string[];
  /** Of those, the ones that declare wind or gravity: external force is present on them. */
  external_force: string[];
} & (
  | {
    vertices: number;
    frames_read: number;
    max_rig_px: number;
    p95_rig_px: number;
    mean_rig_px: number;
    /** `max_rig_px` over the part's box diagonal, four significant figures. */
    max_of_diagonal: number;
    /** Whether the unrounded max is above 0; false is the warning. */
    moves: boolean;
  }
  | { unmeasured: string }
);

export interface PhysicsContributionLine {
  status: 'WARN' | 'CLEAR' | 'SKIP';
  reason?: string;
  off: string;
  points: string;
  world: string;
  poser: string;
  fps: number;
  frames: number;
  warnings: number;
  rows: PhysicsContributionRow[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasForce(c: Record<string, unknown>): boolean {
  return (typeof c.wind === 'number' && c.wind !== 0) || (typeof c.gravity === 'number' && c.gravity !== 0);
}

/** The physics constraints of rig.json's `constraints` and motion.json's `physics` table, in that order. */
export function physicsDecls(rig: Record<string, unknown>, motion: Record<string, unknown>): PhysicsDecl[] {
  const out: PhysicsDecl[] = [];
  for (const c of Array.isArray(rig.constraints) ? rig.constraints : []) {
    if (isRecord(c) && c.type === 'physics' && typeof c.name === 'string' && typeof c.bone === 'string') out.push({ name: c.name, bone: c.bone, force: hasForce(c) });
  }
  if (isRecord(motion.physics)) {
    for (const [name, e] of Object.entries(motion.physics)) if (isRecord(e) && typeof e.bone === 'string') out.push({ name, bone: e.bone, force: hasForce(e) });
  }
  return out;
}

/**
 * Every bone a physics constraint reaches, with the constraints that reach it: the constraint's own bone, every
 * descendant, and every bone a transform constraint drives from a reached source bone (and its descendants), read
 * to a fixpoint.
 */
export function physicsReach(rig: Record<string, unknown>, decls: readonly PhysicsDecl[]): Map<string, Set<string>> {
  const bones = (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord).filter((b) => typeof b.name === 'string');
  const reach = new Map<string, Set<string>>();
  const add = (bone: string, names: Iterable<string>): boolean => {
    const set = reach.get(bone) ?? new Set<string>();
    const before = set.size;
    for (const n of names) set.add(n);
    reach.set(bone, set);
    return set.size !== before;
  };
  for (const d of decls) add(d.bone, [d.name]);
  const transforms = (Array.isArray(rig.constraints) ? rig.constraints : []).filter(isRecord).filter((c) => c.type === 'transform' && typeof c.source === 'string');
  for (let changed = true; changed;) {
    changed = false;
    for (const b of bones) {
      const p = typeof b.parent === 'string' ? reach.get(b.parent) : undefined;
      if (p !== undefined && add(String(b.name), p)) changed = true;
    }
    for (const t of transforms) {
      const s = reach.get(String(t.source));
      if (s === undefined) continue;
      for (const target of Array.isArray(t.bones) ? t.bones : []) if (typeof target === 'string' && add(target, s)) changed = true;
    }
  }
  return reach;
}

/** The constraints a part is under, by the bones it is bound to, in declaration order; empty when none. */
export function partConstraints(bound: ReadonlySet<string>, reach: ReadonlyMap<string, ReadonlySet<string>>, decls: readonly PhysicsDecl[]): PhysicsDecl[] {
  const names = new Set<string>();
  for (const b of bound) for (const n of reach.get(b) ?? []) names.add(n);
  return decls.filter((d) => names.has(d.name));
}

/**
 * The vertices of the rest triangles that hold at least one pixel centre of the art, ascending. `rest` is the
 * attachment's rest vertices in the world (y up), `art` the part's art on the stage (crop px, y down).
 */
export function artVertices(rest: readonly number[], triangles: readonly number[], art: PlacedArt, stage: StageBox): number[] {
  const H = stage.height;
  const held = new Set<number>();
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const i = triangles[t], j = triangles[t + 1], k = triangles[t + 2];
    const x0 = rest[2 * i], y0 = rest[2 * i + 1];
    const ex1 = rest[2 * j] - x0, ey1 = rest[2 * j + 1] - y0, ex2 = rest[2 * k] - x0, ey2 = rest[2 * k + 1] - y0;
    const det = ex1 * ey2 - ex2 * ey1;
    if (det === 0) continue;
    const xs = [x0, rest[2 * j], rest[2 * k]], ys = [y0, rest[2 * j + 1], rest[2 * k + 1]];
    // Crop column X has its centre at world x stage.x + X + 0.5; crop row Y at world y stage.y + H - (Y + 0.5).
    const X0 = Math.max(art.x, Math.floor(Math.min(...xs) - stage.x - 0.5));
    const X1 = Math.min(art.x + art.width - 1, Math.ceil(Math.max(...xs) - stage.x - 0.5));
    const Y0 = Math.max(art.y, Math.floor(H - (Math.max(...ys) - stage.y) - 0.5));
    const Y1 = Math.min(art.y + art.height - 1, Math.ceil(H - (Math.min(...ys) - stage.y) - 0.5));
    let found = false;
    for (let Y = Y0; Y <= Y1 && !found; Y++) {
      for (let X = X0; X <= X1; X++) {
        if (art.data[(Y - art.y) * art.width + (X - art.x)] !== 1) continue;
        const dx = stage.x + X + 0.5 - x0, dy = stage.y + H - (Y + 0.5) - y0;
        const l1 = (dx * ey2 - ex2 * dy) / det, l2 = (ex1 * dy - dx * ey1) / det;
        if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) {
          found = true;
          break;
        }
      }
    }
    if (found) held.add(i).add(j).add(k);
  }
  return [...held].sort((a, b) => a - b);
}

/** The residual's figures over frames 1..N−1 from the two series of posed vertices (null where the slot shows another attachment or nothing). */
export function residualFigures(on: ReadonlyArray<readonly number[] | null>, off: ReadonlyArray<readonly number[] | null>, vertices: readonly number[]): { frames_read: number; max: number; p95: number; mean: number } | null {
  const a0 = on[0], b0 = off[0];
  if (a0 === null || b0 === null || a0 === undefined || b0 === undefined) return null;
  const per: number[] = [];
  for (let f = 1; f < Math.min(on.length, off.length); f++) {
    const a = on[f], b = off[f];
    if (a === null || b === null) continue;
    let m = 0;
    for (const v of vertices) {
      const dx = (a[2 * v] - a0[2 * v]) - (b[2 * v] - b0[2 * v]);
      const dy = (a[2 * v + 1] - a0[2 * v + 1]) - (b[2 * v + 1] - b0[2 * v + 1]);
      m = Math.max(m, edgeLength(dx, dy));
    }
    per.push(m);
  }
  if (per.length === 0) return { frames_read: 0, max: 0, p95: 0, mean: 0 };
  const sorted = [...per].sort((x, y) => x - y);
  return { frames_read: per.length, max: sorted[sorted.length - 1], p95: sorted[Math.ceil(0.95 * sorted.length) - 1], mean: per.reduce((s, x) => s + x, 0) / per.length };
}

/** Python's `round(x, 3)`, the line's precision for rig px. */
function round3(x: number): number {
  return Number(x.toFixed(3));
}

/** Four significant figures, keeping a small fraction's size. */
function sig4(x: number): number {
  return x === 0 ? 0 : Number(x.toPrecision(4));
}

/** One measured row. `figures` null is a part whose slot shows nothing on frame 0. */
export function physicsRow(part: string, decls: readonly PhysicsDecl[], diagonal: number, vertices: number, figures: { frames_read: number; max: number; p95: number; mean: number } | null, unmeasured?: string): PhysicsContributionRow {
  const head = { part, constraints: decls.map((d) => d.name), external_force: decls.filter((d) => d.force).map((d) => d.name) };
  if (figures === null || unmeasured !== undefined) return { ...checkRow('PHYSICS_CONTRIBUTES.rows', 'part', false, [part]), ...head, unmeasured: unmeasured ?? 'its slot shows no attachment on idle frame 0' };
  const moves = figures.max > 0;
  return {
    ...checkRow('PHYSICS_CONTRIBUTES.rows', 'part', !moves, [part]),
    ...head,
    vertices,
    frames_read: figures.frames_read,
    max_rig_px: round3(figures.max),
    p95_rig_px: round3(figures.p95),
    mean_rig_px: round3(figures.mean),
    max_of_diagonal: sig4(diagonal > 0 ? figures.max / diagonal : 0),
    moves,
  };
}

/** The line from its rows: WARN when a part under physics reads exactly 0, CLEAR when none does, SKIP with the reason. */
export function physicsLine(rows: PhysicsContributionRow[], fps: number, frames: number, poser: string, world: string, reason?: string): PhysicsContributionLine {
  const warnings = rows.filter((r) => 'moves' in r && !r.moves).length;
  return {
    status: reason !== undefined ? 'SKIP' : warnings > 0 ? 'WARN' : 'CLEAR',
    ...(reason === undefined ? {} : { reason }),
    off: PHYSICS_OFF_TEXT,
    points: PHYSICS_POINTS_TEXT,
    world,
    poser,
    fps,
    frames,
    warnings,
    rows,
  };
}

/** One warning as the console prints it. */
export function physicsWarnText(r: PhysicsContributionRow): string {
  const frames = 'frames_read' in r ? r.frames_read : 0;
  const vertices = 'vertices' in r ? r.vertices : 0;
  const force = r.external_force.length === 0 ? '' : `; external force is declared on ${r.external_force.map((n) => `"${n}"`).join(', ')}`;
  return `WARN ${PHYSICS_CONTRIBUTES_LINE}: part "${r.part}" is under physics constraint(s) ${r.constraints.map((n) => `"${n}"`).join(', ')} and reads 0 over ${frames} frame(s): none of its ${vertices} art vertices is moved by physics on the idle${force}; ${PHYSICS_LEVERS_TEXT}`;
}

/** The line as the console prints it: the status and what was read, then one WARN line per part that reads 0. A SKIP prints its reason alone. */
export function physicsLines(line: PhysicsContributionLine): string[] {
  if (line.status === 'SKIP') return [`${PHYSICS_CONTRIBUTES_LINE}: SKIP — ${String(line.reason)}`];
  const forced = line.rows.filter((r) => r.external_force.length > 0).length;
  const read = `${line.rows.length} part(s) under physics posed with physics on and off (${line.frames} frame(s) at ${line.fps} fps, ${line.poser} poser, ${line.world})${forced === 0 ? '' : `, ${forced} of them under a constraint that declares wind or gravity`}`;
  return [
    `${PHYSICS_CONTRIBUTES_LINE}: ${line.status} — ${read}: ${line.warnings} of them read 0 — ${line.warnings} warning(s), never a bar; off is ${line.off}`,
    ...line.rows.filter((r) => 'moves' in r && !r.moves).map(physicsWarnText),
  ];
}

/** What {@link measurePhysicsContribution} reads for one part: its box, its art on the stage, the bones it is bound to and its rest triangles. */
export interface PhysicsPartInput {
  name: string;
  w: number;
  h: number;
  art: () => PlacedArt;
  bound: ReadonlySet<string>;
  rest: { vertices: readonly number[]; triangles: readonly number[] } | undefined;
}

type Renderer = typeof import('@rig-c/core/render-shared');

/**
 * The line on a packed build (`<build>/skeleton.json` and `.atlas`): the idle posed twice through rig-c's read facade,
 * physics on and physics off, at `fps`, under rig-c's default environment; one row per part under physics. Null
 * figures — a rig with no physics constraint — are the caller's SKIP.
 */
export function measurePhysicsContribution(api: Renderer, build: string, rig: Record<string, unknown>, motion: Record<string, unknown>, parts: readonly PhysicsPartInput[], stage: StageBox, fps: number): PhysicsContributionLine {
  const world = "rig-c's default environment";
  const decls = physicsDecls(rig, motion);
  if (decls.length === 0) return physicsLine([], fps, 0, 'none', world, "the rig declares no physics constraint (rig.json's constraints, motion.json's physics), so no part is under physics");
  const reach = physicsReach(rig, decls);
  const under = parts.map((p) => ({ p, decls: partConstraints(p.bound, reach, decls) })).filter((x) => x.decls.length > 0);
  if (under.length === 0) return physicsLine([], fps, 0, 'none', world, `no part is bound to a bone the rig's ${decls.length} physics constraint(s) reach`);
  const skeleton = join(build, 'skeleton.json'), atlas = join(build, 'skeleton.atlas');
  const candidate = api.loadCandidate({ skeletonText: readFileSync(skeleton, 'utf8'), atlasText: readFileSync(atlas, 'utf8'), atlasDir: build, label: PHYSICS_CONTRIBUTES_LINE }, { skeleton, atlas }, undefined);
  const on = api.throughPoser(candidate.choice, (p) => api.sampleAnimation(p, 'idle', fps, { geometry: true }));
  const off = api.throughPoser(candidate.choice, (p) => api.sampleAnimation(p, 'idle', fps, { geometry: true, physicsMode: 'off' }));
  const series = (frames: typeof on.value, slot: string): Array<number[] | null> => {
    const first = frames[0]?.attachments?.find((a) => a.slot === slot)?.attachment;
    return frames.map((f) => {
      const a = f.attachments?.find((x) => x.slot === slot);
      return a === undefined || a.attachment !== first ? null : a.vertices;
    });
  };
  const rows = under.map(({ p, decls: ds }) => {
    if (p.rest === undefined) return physicsRow(p.name, ds, 0, 0, null, 'its slot shows no attachment in the idle geometry');
    const vs = artVertices(p.rest.vertices, p.rest.triangles, p.art(), stage);
    const a = series(on.value, p.name), b = series(off.value, p.name);
    if (a[0] !== null && a[0].length !== p.rest.vertices.length) return physicsRow(p.name, ds, 0, 0, null, `its posed attachment has ${a[0].length / 2} vertices and its rest ${p.rest.vertices.length / 2}`);
    return physicsRow(p.name, ds, edgeLength(p.w, p.h), vs.length, residualFigures(a, b, vs));
  });
  return physicsLine(rows, fps, on.value.length, on.poser, world);
}
