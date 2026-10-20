/**
 * `rig-parts remesh --delta` (issue #526): the reader of rig-c/review's mesh edit, `rig-review-mesh-edit/1` — a typed
 * list of vertex and edge ops a person drew over one part's mesh in review's Edit Mesh — and the producer half of that
 * loop: the ops replayed, in order, over the input part's own triangulation, retriangulated here (review never
 * retriangulates; its document says "the producer retriangulates"), and written back as a `mesh` attachment in this
 * package's form. Pure: no I/O; `src/remesh.ts` reads the files and splices the result.
 *
 * ## The document
 *
 * `{ schema, slot, skin, attachment, source: { vertexCount, triangleCount, hullLength, hash }, units, basis, preview,
 * ops }` as review writes it (`src/mesh-edit.ts`, `meshEditDocument`). Positions are crop px of the rig canvas, x
 * right, y down: a vertex's crop position is its part-local px (`uv × (width, height)`) plus the part's origin
 * (`parts.json` x − {@link PAD}, y − PAD, the origin `rig` placed the image at). Vertex ids are the attachment's
 * indices; an added vertex takes the next id; a removed id is never reused. `basis` must be `"setup"` (rig-c/review
 * #100): a posed basis would put setup vertices where a pose drew them, so it is refused rather than posed back.
 *
 * ## The ops, as the producer applies them
 *
 * - `move {v, from, to}`: `from` must be the live position (within {@link FROM_TOLERANCE_PX}); the uv and every
 *   binding's bone-local x, y are recomputed from `to` through the setup frames; the shares are kept. Then the
 *   Delaunay condition is restored by edge flips around it, never flipping a hull or constraint edge.
 * - `add {at, onEdge}`: the edge split (two triangles to four; one to two on a hull edge, the hull loop gaining the
 *   vertex), weights the two ends' shares blended by the parameter along the edge; `add {at}` without `onEdge`: the
 *   triangle that holds it split in three (on an edge, as `onEdge`), weights the corners' shares by barycentric blend.
 * - `remove {v}`: the vertex and its triangles dropped and the ring ear-clipped by exact orientation, then flipped;
 *   a hull vertex's two hull neighbours become adjacent.
 * - `edge {a, b}`: a constraint — the edge marked, or made by flipping the edges it crosses (edge recovery); one that
 *   crosses the hull or another constraint is refused.
 * - `unedge {a, b}`: only an edge this delta constrained; the producer owns every other edge of the triangulation.
 *
 * Every op that does not apply is refused by name with its index (`REMESH_DELTA_OP`), and the result is held to the
 * outline rules and the Delaunay count by {@link contourTopologyProblems} and {@link delaunayViolations}
 * (`REMESH_DELTA_TOPOLOGY`) — measured on the result, not trusted from the replay.
 *
 * ## Coordinates
 *
 * Two copies of every position are kept: the exact one (part-local px, a double), which the uv, the bindings and the
 * `from` comparison read, and its snap to {@link GRID} units, which every predicate reads, so orientation and the
 * in-circle test are exact (`src/contour.ts`). A vertex the delta neither moves nor removes keeps its uv pair and its
 * weight entries byte for byte; only its index may change, since the hull loop is written first.
 */
import { contourTopologyProblems, delaunayViolations, GRID, inCircle } from './contour.ts';
import { type BoneTransform, cropToSpineY, toBoneLocal } from './coords.ts';
import type { Problem } from './errors.ts';
import { type MeshAttachment, OFFSET_PLACES, PAD, roundShares, type WeightEntry } from './rig.ts';
import { pyRound } from './round.ts';
import type { Influence } from './weights.ts';

/** The schema review writes (rig-c/review `src/mesh-edit.ts`, `MESH_EDIT_SCHEMA`). */
export const MESH_EDIT_SCHEMA = 'rig-review-mesh-edit/1';

/** The basis the reader accepts (rig-c/review #100: the editor works in setup space). */
export const MESH_EDIT_BASIS = 'setup';

/** Review's own cap on one attachment's ops (`MESH_EDIT_MAX_OPS`: the draft rides in one form field). */
export const MESH_EDIT_MAX_OPS = 300;

/**
 * How far `move.from` may sit from the live position, in crop px: the uv is written to 6 places, which moves a
 * vertex by up to 2.5e-4 px on the parts measured (the public demo's 9 meshes, 1,192 vertices), so 1e-3 holds every
 * honest `from` and refuses a delta drawn over another mesh. The same tolerance holds the input's own bindings to
 * the position its uv states ({@link applyMeshEdit}'s reading of the part's origin).
 */
export const FROM_TOLERANCE_PX = 1e-3;

export type Vec = [number, number];
export type MeshEditOp =
  | { op: 'move'; v: number; from: Vec; to: Vec }
  | { op: 'add'; at: Vec; onEdge?: [number, number] }
  | { op: 'remove'; v: number }
  | { op: 'edge'; a: number; b: number }
  | { op: 'unedge'; a: number; b: number };

export interface MeshEditDocument {
  schema: typeof MESH_EDIT_SCHEMA;
  slot: string;
  skin: string;
  attachment: string;
  source: { vertexCount: number; triangleCount: number; hullLength: number; hash: string };
  units: string;
  basis: string;
  preview: string;
  ops: MeshEditOp[];
}

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isVec = (v: unknown): v is Vec => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const OP_FIELDS: Record<MeshEditOp['op'], readonly string[]> = { move: ['op', 'v', 'from', 'to'], add: ['op', 'at', 'onEdge'], remove: ['op', 'v'], edge: ['op', 'a', 'b'], unedge: ['op', 'a', 'b'] };

/**
 * The document, read and held to its shape: `schema` (`REMESH_DELTA_JSON`), `basis` (`REMESH_DELTA_BASIS`), `ops` an
 * array of at most {@link MESH_EDIT_MAX_OPS} (`REMESH_DELTA_OPS`), each op of a known kind with finite numbers and
 * whole ids (`REMESH_DELTA_OP`). Every problem is collected and thrown once; whether an id is live is the replay's.
 */
export function readMeshEdit(text: string, object: string): { doc: MeshEditDocument | null; problems: Problem[] } {
  const problems: Problem[] = [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { doc: null, problems: [{ code: 'REMESH_DELTA_JSON', object, detail: `does not parse as JSON: ${(err as Error).message}` }] };
  }
  if (!isRecord(value)) return { doc: null, problems: [{ code: 'REMESH_DELTA_JSON', object, detail: `is ${Array.isArray(value) ? 'an array' : JSON.stringify(value)}; one ${MESH_EDIT_SCHEMA} document is required` }] };
  if (value.schema !== MESH_EDIT_SCHEMA) problems.push({ code: 'REMESH_DELTA_JSON', object: `${object} schema`, detail: `is ${JSON.stringify(value.schema)}; "${MESH_EDIT_SCHEMA}" (rig-c/review's mesh edit) is required` });
  for (const k of ['slot', 'skin', 'attachment']) if (typeof value[k] !== 'string') problems.push({ code: 'REMESH_DELTA_JSON', object: `${object} ${k}`, detail: `is ${JSON.stringify(value[k])}; a string is required` });
  const src = value.source;
  if (!isRecord(src) || !isId(src.vertexCount) || !isId(src.triangleCount) || !isId(src.hullLength) || typeof src.hash !== 'string') {
    problems.push({ code: 'REMESH_DELTA_JSON', object: `${object} source`, detail: `is ${JSON.stringify(src)}; { vertexCount, triangleCount, hullLength: whole numbers, hash: a string } is required` });
  }
  if (value.basis !== MESH_EDIT_BASIS) {
    problems.push({ code: 'REMESH_DELTA_BASIS', object: `${object} basis`, detail: `is ${JSON.stringify(value.basis)}; "${MESH_EDIT_BASIS}" is required — the producer binds setup positions, and a delta drawn over a pose (review before rig-c/review #100) is refused rather than posed back` });
  }
  const ops = value.ops;
  if (!Array.isArray(ops)) problems.push({ code: 'REMESH_DELTA_OPS', object: `${object} ops`, detail: `is ${JSON.stringify(ops)}; an array of ops is required` });
  else if (ops.length > MESH_EDIT_MAX_OPS) problems.push({ code: 'REMESH_DELTA_OPS', object: `${object} ops`, detail: `holds ${ops.length} ops; at most ${MESH_EDIT_MAX_OPS} (review's own cap per attachment) are read` });
  else {
    ops.forEach((op: unknown, i: number) => {
      const bad = (why: string): void => {
        problems.push({ code: 'REMESH_DELTA_OP', object: `${object} ops[${i}]`, detail: `${JSON.stringify(op)} ${why}` });
      };
      if (!isRecord(op) || typeof op.op !== 'string' || !(op.op in OP_FIELDS)) {
        bad(`has an unknown op kind ${isRecord(op) ? JSON.stringify(op.op) : ''}; one of move, add, remove, edge, unedge is required`);
        return;
      }
      const kind = op.op as MeshEditOp['op'];
      const extra = Object.keys(op).filter((k) => !OP_FIELDS[kind].includes(k));
      if (extra.length > 0) bad(`carries ${extra.join(', ')}, which a ${kind} op does not take`);
      if (kind === 'move') {
        if (!isId(op.v)) bad('needs a whole vertex id v');
        if (!isVec(op.from) || !isVec(op.to)) bad('needs finite from and to pairs');
      } else if (kind === 'add') {
        if (!isVec(op.at)) bad('needs a finite at pair');
        if (op.onEdge !== undefined && !(Array.isArray(op.onEdge) && op.onEdge.length === 2 && op.onEdge.every(isId))) bad('needs onEdge as a pair of whole vertex ids, when it is given');
      } else if (kind === 'remove') {
        if (!isId(op.v)) bad('needs a whole vertex id v');
      } else if (!isId(op.a) || !isId(op.b)) bad('needs whole vertex ids a and b');
      else if (op.a === op.b) bad('joins a vertex to itself');
    });
  }
  return { doc: problems.length === 0 ? (value as unknown as MeshEditDocument) : null, problems };
}

/** The input the replay reads: the part's attachment, where `rig` placed it, and the setup frames of the rig's bones. */
export interface DeltaInput {
  part: string;
  attachment: MeshAttachment;
  /** `parts.json`'s box corner (x, y) for the part: the image sits at (x − PAD, y − PAD). */
  box: Vec;
  /** `parts.json`'s `rig_size`. */
  rigSize: Vec;
  /** Every bone's setup frame, as `computeExactFrameTransforms` gives it over `rig.json`'s bones. */
  world: ReadonlyMap<string, BoneTransform>;
}

/** Planted faults for the selftest (issue #526) — never set by the CLI. */
export interface DeltaPlant {
  /** A move keeps its bindings' x, y (the bone-local recompute skipped). */
  skipBind?: boolean;
  /** The output keeps id order instead of writing the hull loop first. */
  skipHullOrder?: boolean;
  /** The result's topology gate is skipped. */
  skipTopology?: boolean;
}

export interface DeltaApplied {
  ops: number;
  moved: number;
  added: number;
  removed: number;
  constrained: number;
}

export interface DeltaResult {
  attachment: MeshAttachment;
  counts: { vertices: number; triangles: number; hull: number };
  applied: DeltaApplied;
  /** Source ids the delta neither moved nor removed: their uv pair and weight entries are the input's bytes. */
  untouched: number[];
  /** Interior edges not locally Delaunay, before and after (constraint edges not asked). */
  delaunay: { before: number; after: number };
  /** The output index of every live id, in id order (removed ids absent). */
  index: Array<[number, number]>;
}

const placed6 = (v: number): number => {
  const r = pyRound(v, OFFSET_PLACES);
  return r === 0 ? 0 : r;
};
const ekey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** Thrown inside the replay; caught once by {@link applyMeshEdit} and turned into its problem. */
class OpRefused extends Error {
  constructor(
    readonly code: string,
    readonly at: string,
    readonly why: string,
  ) {
    super(why);
  }
}

/**
 * The source checks a document is held to before any op is replayed: it names this part's attachment in the default
 * skin, and its source counts are this attachment's (`REMESH_DELTA_SOURCE`, naming the field and both figures).
 */
export function deltaSourceProblems(doc: MeshEditDocument, part: string, att: MeshAttachment, object: string): Problem[] {
  const out: Problem[] = [];
  for (const k of ['slot', 'attachment'] as const) if (doc[k] !== part) out.push({ code: 'REMESH_DELTA_SOURCE', object: `${object} ${k}`, detail: `is "${doc[k]}"; the delta must name --part "${part}", whose slot and attachment the rig stage names after the part` });
  if (doc.skin !== 'default') out.push({ code: 'REMESH_DELTA_SOURCE', object: `${object} skin`, detail: `is "${doc.skin}"; this package writes every mesh into the default skin, so "default" is required` });
  const counts: Array<[string, number, number]> = [
    ['vertexCount', doc.source.vertexCount, att.uvs.length / 2],
    ['triangleCount', doc.source.triangleCount, att.triangles.length / 3],
    ['hullLength', doc.source.hullLength, att.hull],
  ];
  for (const [k, said, is] of counts) if (said !== is) out.push({ code: 'REMESH_DELTA_SOURCE', object: `${object} source.${k}`, detail: `is ${said}; the input's ${part} has ${is} — the delta was drawn over another mesh` });
  return out;
}

/**
 * The replay: the document's ops over the input's mesh, in order, and the result held to the outline and Delaunay
 * rules. Returns the problems (the first op that does not apply ends the replay, since every later op reads its
 * state) or the new attachment.
 */
export function applyMeshEdit(input: DeltaInput, doc: MeshEditDocument, object: string, plant: DeltaPlant = {}): DeltaResult | Problem[] {
  const att = input.attachment;
  const { width: w, height: h } = att;
  const ox = input.box[0] - PAD;
  const oy = input.box[1] - PAD;
  const CX = input.rigSize[0] / 2;
  const H = input.rigSize[1];
  const V0 = att.uvs.length / 2;
  // Exact positions (part px) and their grid snaps, by id; the uv and weights to write, by id.
  const PX: number[] = [];
  const PY: number[] = [];
  const X: number[] = [];
  const Y: number[] = [];
  const uv: Vec[] = [];
  const wt: WeightEntry[][] = [];
  const live: boolean[] = [];
  const moved = new Set<number>();
  const added = new Set<number>();
  const removed = new Set<number>();
  const snap = (v: number): number => Math.round(v * GRID);
  const setPos = (id: number, x: number, y: number): void => {
    PX[id] = x;
    PY[id] = y;
    X[id] = snap(x);
    Y[id] = snap(y);
  };
  const bind = (shares: ReadonlyArray<{ bone: string; weight: number }>, x: number, y: number): WeightEntry[] =>
    shares.map(({ bone, weight }) => {
      const m = input.world.get(bone);
      if (m === undefined) throw new OpRefused('REMESH_DELTA_SOURCE', `${input.part}'s weights`, `name bone "${bone}", which rig.json does not declare`);
      const [bx, by] = toBoneLocal(m, ox + x - CX, cropToSpineY(oy + y, H));
      return { bone, x: placed6(bx), y: placed6(by), weight };
    });
  const problems: Problem[] = [];
  for (let i = 0; i < V0; i++) {
    setPos(i, att.uvs[2 * i] * w, att.uvs[2 * i + 1] * h);
    uv.push([att.uvs[2 * i], att.uvs[2 * i + 1]]);
    wt.push(att.weights[i]);
    live.push(true);
  }
  // The part's origin is read, not trusted: every input binding must be what its uv states at (ox, oy).
  try {
    for (let i = 0; i < V0 && problems.length === 0; i++) {
      const again = bind(att.weights[i], PX[i], PY[i]);
      const off = again.findIndex((e, k) => Math.abs(e.x - att.weights[i][k].x) > FROM_TOLERANCE_PX || Math.abs(e.y - att.weights[i][k].y) > FROM_TOLERANCE_PX);
      if (off >= 0) {
        const e = att.weights[i][off];
        problems.push({ code: 'REMESH_DELTA_SOURCE', object: `rig.json skins.default.${input.part}.${input.part} vertex ${i}`, detail: `binds to "${e.bone}" at (${e.x}, ${e.y}); its uv at the part's origin (${ox}, ${oy}) binds at (${again[off].x}, ${again[off].y}) — the input's placement is not the one parts.json states, so no position the delta names can be bound` });
      }
    }
  } catch (err) {
    if (!(err instanceof OpRefused)) throw err;
    problems.push({ code: err.code, object: err.at, detail: err.why });
  }
  if (problems.length > 0) return problems;

  // Triangles in the replay's winding: orient > 0 in y-down grid units. The input's winding is measured and kept.
  const orient = (a: number, b: number, c: number): number => (X[b] - X[a]) * (Y[c] - Y[a]) - (Y[b] - Y[a]) * (X[c] - X[a]);
  let sign = 0;
  for (let t = 0; t < att.triangles.length; t += 3) {
    const s = Math.sign(orient(att.triangles[t], att.triangles[t + 1], att.triangles[t + 2]));
    if (s === 0 || (sign !== 0 && s !== sign)) {
      return [{ code: 'REMESH_DELTA_TOPOLOGY', object: `rig.json skins.default.${input.part}.${input.part} triangle ${t / 3}`, detail: s === 0 ? 'has zero area in the input; the replay needs every input triangle wound one way' : 'is wound against the triangles before it in the input; the replay needs every input triangle wound one way' }];
    }
    sign = s;
  }
  const tris: Array<[number, number, number] | null> = [];
  const owner = new Map<string, number>();
  const dkey = (a: number, b: number): string => `${a},${b}`;
  const link = (t: number): void => {
    const r = tris[t] as [number, number, number];
    owner.set(dkey(r[0], r[1]), t);
    owner.set(dkey(r[1], r[2]), t);
    owner.set(dkey(r[2], r[0]), t);
  };
  const unlink = (t: number): void => {
    const r = tris[t];
    if (r === null || r === undefined) return;
    // a key the triangle no longer owns (a flip's partner took it first) is left to its owner.
    for (const k of [dkey(r[0], r[1]), dkey(r[1], r[2]), dkey(r[2], r[0])]) if (owner.get(k) === t) owner.delete(k);
  };
  const setTri = (t: number, a: number, b: number, c: number): void => {
    unlink(t);
    tris[t] = [a, b, c];
    link(t);
  };
  for (let t = 0; t < att.triangles.length; t += 3) {
    const [a, b, c] = [att.triangles[t], att.triangles[t + 1], att.triangles[t + 2]];
    if (sign > 0) setTri(t / 3, a, b, c);
    else setTri(t / 3, a, c, b);
  }
  const freeSlots: number[] = [];
  const newTri = (a: number, b: number, c: number): number => {
    const t = freeSlots.length > 0 ? (freeSlots.shift() as number) : tris.length;
    setTri(t, a, b, c);
    return t;
  };
  const dropTri = (t: number): void => {
    unlink(t);
    tris[t] = null;
    freeSlots.push(t);
    freeSlots.sort((p, q) => p - q);
  };
  const third = (t: number, a: number, b: number): number => {
    const r = tris[t] as [number, number, number];
    return r.find((x) => x !== a && x !== b) as number;
  };
  const hull: number[] = Array.from({ length: att.hull }, (_, i) => i);
  const constrained = new Set<string>();
  const isEdge = (a: number, b: number): boolean => owner.has(dkey(a, b)) || owner.has(dkey(b, a));
  const isHullEdge = (a: number, b: number): boolean => isEdge(a, b) && (!owner.has(dkey(a, b)) || !owner.has(dkey(b, a)));
  const starOf = (v: number): number[] => tris.flatMap((r, t) => (r !== null && r.includes(v) ? [t] : []));
  const violations = (): number => {
    const n = (r: readonly number[]): Vec[] => r.map((id) => [X[id] / GRID, Y[id] / GRID] as Vec);
    const ids = X.map((_, i) => i);
    const flat = tris.flatMap((r) => (r === null ? [] : r));
    return delaunayViolations(n(ids), flat, [...constrained].map((k) => k.split(':').map(Number) as [number, number]));
  };
  const before = violations();

  /** Lawson flips from the queued edges: an interior, unconstrained edge whose far vertex lies inside the circle is flipped. */
  const legalize = (queue: Array<[number, number]>): void => {
    let guard = 0;
    while (queue.length > 0) {
      if (++guard > 1_000_000) throw new Error('remeshdelta: edge flips did not settle');
      const [a, b] = queue.pop() as [number, number];
      if (constrained.has(ekey(a, b))) continue;
      const t = owner.get(dkey(a, b));
      const u = owner.get(dkey(b, a));
      if (t === undefined || u === undefined) continue;
      const c = third(t, a, b);
      const d = third(u, b, a);
      if (inCircle(X[a], Y[a], X[b], Y[b], X[c], Y[c], X[d], Y[d]) <= 0n) continue;
      if (!(orient(a, d, c) > 0 && orient(b, c, d) > 0)) continue;
      setTri(t, a, d, c);
      setTri(u, b, c, d);
      queue.push([a, d], [d, b], [b, c], [c, a]);
    }
  };
  const edgesOf = (ts: readonly number[]): Array<[number, number]> =>
    ts.flatMap((t) => {
      const r = tris[t];
      return r === null || r === undefined ? [] : ([[r[0], r[1]], [r[1], r[2]], [r[2], r[0]]] as Array<[number, number]>);
    });
  const liveCount = (): number => live.filter((x) => x).length;
  const crop = (id: number): Vec => [PX[id] + ox, PY[id] + oy];
  const inImage = (x: number, y: number): boolean => x >= 0 && x <= w && y >= 0 && y <= h;
  const mustLive = (id: number, what: string): void => {
    if (id >= live.length) throw new OpRefused('REMESH_DELTA_OP', '', `names ${what} ${id}, which is out of range (ids 0..${live.length - 1} exist at this op)`);
    if (!live[id]) throw new OpRefused('REMESH_DELTA_OP', '', `names ${what} ${id}, which an earlier op removed`);
  };
  const blend = (parts: ReadonlyArray<readonly [number, number]>): Influence[] => {
    const by = new Map<string, number>();
    for (const [id, f] of parts) for (const e of wt[id]) by.set(e.bone, (by.get(e.bone) ?? 0) + e.weight * f);
    const sum = [...by.values()].reduce((s, x) => s + x, 0);
    return roundShares([...by].map(([bone, weight]) => ({ bone, weight: weight / sum })));
  };
  const addVertex = (x: number, y: number, shares: Influence[]): number => {
    const id = live.length;
    setPos(id, x, y);
    live.push(true);
    uv.push([pyRound(x / w, 6), pyRound(y / h, 6)]);
    wt.push(bind(shares, x, y));
    added.add(id);
    return id;
  };
  /** The split of edge a–b at (x, y): its one or two triangles become two or four. */
  const splitEdge = (a: number, b: number, x: number, y: number): void => {
    const t = owner.get(dkey(a, b));
    const u = owner.get(dkey(b, a));
    const dx = PX[b] - PX[a];
    const dy = PY[b] - PY[a];
    const s = Math.min(1, Math.max(0, ((x - PX[a]) * dx + (y - PY[a]) * dy) / (dx * dx + dy * dy)));
    const sx = snap(x);
    const sy = snap(y);
    const sides: Array<[number, number, number]> = [];
    if (t !== undefined) sides.push([a, b, third(t, a, b)]);
    if (u !== undefined) sides.push([b, a, third(u, b, a)]);
    for (const [p, q, c] of sides) {
      // the new point must be strictly inside the triangles' union on each side: (p, new, c) and (new, q, c) wound > 0.
      const o1 = (sx - X[p]) * (Y[c] - Y[p]) - (sy - Y[p]) * (X[c] - X[p]);
      const o2 = (X[q] - sx) * (Y[c] - sy) - (Y[q] - sy) * (X[c] - sx);
      if (!(o1 > 0 && o2 > 0)) throw new OpRefused('REMESH_DELTA_OP', '', `puts the vertex at crop (${pyRound(x + ox, 4)}, ${pyRound(y + oy, 4)}), outside the triangles on edge ${a}-${b} (it would fold triangle ${p}, ${q}, ${c})`);
    }
    const id = addVertex(x, y, blend([[a, 1 - s], [b, s]]));
    const made: number[] = [];
    if (t !== undefined) {
      const c = third(t, a, b);
      setTri(t, a, id, c);
      made.push(t, newTri(id, b, c));
    }
    if (u !== undefined) {
      const d = third(u, b, a);
      setTri(u, b, id, d);
      made.push(u, newTri(id, a, d));
    }
    if (t === undefined || u === undefined) {
      const ia = hull.indexOf(a);
      const ib = hull.indexOf(b);
      const n = hull.length;
      if (ia < 0 || ib < 0 || ((ia + 1) % n !== ib && (ib + 1) % n !== ia)) throw new Error(`remeshdelta: boundary edge ${a}-${b} is not consecutive on the hull loop`);
      const first = (ia + 1) % n === ib ? ia : ib;
      hull.splice(first + 1, 0, id);
    }
    legalize(edgesOf(made));
  };

  const ops = doc.ops;
  let constrainedCount = 0;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      if (op.op === 'move') {
        mustLive(op.v, 'vertex');
        const [fx, fy] = crop(op.v);
        if (Math.abs(fx - op.from[0]) > FROM_TOLERANCE_PX || Math.abs(fy - op.from[1]) > FROM_TOLERANCE_PX) {
          throw new OpRefused('REMESH_DELTA_OP', '', `moves vertex ${op.v} from (${op.from[0]}, ${op.from[1]}); its live position is (${pyRound(fx, 4)}, ${pyRound(fy, 4)}) — from does not match within ${FROM_TOLERANCE_PX} px, so the delta was made over another mesh`);
        }
        const x = op.to[0] - ox;
        const y = op.to[1] - oy;
        if (!inImage(x, y)) throw new OpRefused('REMESH_DELTA_OP', '', `moves vertex ${op.v} to crop (${op.to[0]}, ${op.to[1]}), outside the part's image (crop ${ox}..${ox + w} x ${oy}..${oy + h}); the texture has no sample there`);
        const keep: Vec = [PX[op.v], PY[op.v]];
        const keepG: Vec = [X[op.v], Y[op.v]];
        setPos(op.v, x, y);
        const star = starOf(op.v);
        const folded = star.find((t) => {
          const r = tris[t] as [number, number, number];
          return orient(r[0], r[1], r[2]) <= 0;
        });
        if (folded !== undefined) {
          PX[op.v] = keep[0];
          PY[op.v] = keep[1];
          X[op.v] = keepG[0];
          Y[op.v] = keepG[1];
          throw new OpRefused('REMESH_DELTA_OP', '', `moves vertex ${op.v} across an edge of its own ring: triangle ${(tris[folded] as number[]).join(', ')} would fold; move it in smaller steps, or remove and add it`);
        }
        uv[op.v] = [pyRound(x / w, 6), pyRound(y / h, 6)];
        if (plant.skipBind !== true) wt[op.v] = bind(wt[op.v], x, y);
        moved.add(op.v);
        legalize(edgesOf(star));
      } else if (op.op === 'add') {
        const x = op.at[0] - ox;
        const y = op.at[1] - oy;
        if (!inImage(x, y)) throw new OpRefused('REMESH_DELTA_OP', '', `adds a vertex at crop (${op.at[0]}, ${op.at[1]}), outside the part's image (crop ${ox}..${ox + w} x ${oy}..${oy + h}); the texture has no sample there`);
        const sx = snap(x);
        const sy = snap(y);
        if (op.onEdge !== undefined) {
          const [a, b] = op.onEdge;
          mustLive(a, 'vertex');
          mustLive(b, 'vertex');
          if (a === b) throw new OpRefused('REMESH_DELTA_OP', '', `splits edge ${a}-${b}, which joins a vertex to itself`);
          if (!isEdge(a, b)) throw new OpRefused('REMESH_DELTA_OP', '', `splits a missing edge ${a}-${b}: the producer's triangulation has no such edge at this op`);
          splitEdge(a, b, x, y);
        } else {
          let placedIn = false;
          for (let t = 0; t < tris.length && !placedIn; t++) {
            const r = tris[t];
            if (r === null) continue;
            const [a, b, c] = r;
            const ob = (p: number, q: number): number => (X[q] - X[p]) * (sy - Y[p]) - (Y[q] - Y[p]) * (sx - X[p]);
            const o1 = ob(a, b);
            const o2 = ob(b, c);
            const o3 = ob(c, a);
            if (o1 < 0 || o2 < 0 || o3 < 0) continue;
            const zeros = [o1, o2, o3].filter((z) => z === 0).length;
            if (zeros >= 2) {
              const at = [a, b, c].find((id) => X[id] === sx && Y[id] === sy);
              throw new OpRefused('REMESH_DELTA_OP', '', `adds a vertex at crop (${op.at[0]}, ${op.at[1]}), on vertex ${at ?? a}; distinct positions are required`);
            }
            placedIn = true;
            if (zeros === 1) {
              const [p, q] = o1 === 0 ? [a, b] : o2 === 0 ? [b, c] : [c, a];
              splitEdge(p, q, x, y);
              break;
            }
            const area = orient(a, b, c);
            const id = addVertex(x, y, blend([[a, o2 / area], [b, o3 / area], [c, o1 / area]]));
            setTri(t, a, b, id);
            const t2 = newTri(b, c, id);
            const t3 = newTri(c, a, id);
            legalize(edgesOf([t, t2, t3]));
          }
          if (!placedIn) throw new OpRefused('REMESH_DELTA_OP', '', `adds a free vertex at crop (${op.at[0]}, ${op.at[1]}), outside every triangle of the mesh; a vertex outside the mesh is added on a hull edge (onEdge)`);
        }
      } else if (op.op === 'remove') {
        const v = op.v;
        mustLive(v, 'vertex');
        const held = [...constrained].find((k) => k.split(':').map(Number).includes(v));
        if (held !== undefined) throw new OpRefused('REMESH_DELTA_OP', '', `removes vertex ${v}, an end of constraint edge ${held.replace(':', '-')}; unedge it first`);
        const onHull = hull.includes(v);
        if (liveCount() - 1 < 3 || (onHull && hull.length - 1 < 3)) throw new OpRefused('REMESH_DELTA_OP', '', `removes vertex ${v}, which would leave ${onHull && hull.length - 1 < 3 ? `a hull of ${hull.length - 1}` : `${liveCount() - 1} vertices`}; at least 3 are required`);
        const star = starOf(v);
        const next = new Map<number, number>();
        for (const t of star) {
          const r = tris[t] as [number, number, number];
          const k = r.indexOf(v);
          next.set(r[(k + 1) % 3], r[(k + 2) % 3]);
        }
        const ys = new Set(next.values());
        const starts = [...next.keys()].filter((x) => !ys.has(x));
        const start = onHull ? starts[0] : (tris[star[0]] as number[])[((tris[star[0]] as number[]).indexOf(v) + 1) % 3];
        if (start === undefined || (onHull && starts.length !== 1) || (!onHull && starts.length !== 0)) throw new OpRefused('REMESH_DELTA_OP', '', `removes vertex ${v}, whose ring is not one ${onHull ? 'open' : 'closed'} fan`);
        const ring: number[] = [start];
        for (let cur = start; next.has(cur); ) {
          cur = next.get(cur) as number;
          if (cur === start) break;
          ring.push(cur);
          if (ring.length > star.length + 1) throw new Error(`remeshdelta: the ring of vertex ${v} does not close`);
        }
        if (onHull) {
          const n = hull.length;
          const k = hull.indexOf(v);
          if (ring[0] !== hull[(k + 1) % n] || ring[ring.length - 1] !== hull[(k - 1 + n) % n]) throw new OpRefused('REMESH_DELTA_OP', '', `removes hull vertex ${v}, whose fan does not run from one hull neighbour to the other`);
        }
        // ear clipping, exact: the polygon is wound > 0; the first ear in ring order is cut each time.
        const poly = [...ring];
        const made: Array<[number, number, number]> = [];
        while (poly.length > 3) {
          let cut = -1;
          for (let j = 0; j < poly.length && cut < 0; j++) {
            const p = poly[(j - 1 + poly.length) % poly.length];
            const c = poly[j];
            const q = poly[(j + 1) % poly.length];
            if (orient(p, c, q) <= 0) continue;
            const blocked = poly.some((r) => r !== p && r !== c && r !== q && orient(p, c, r) >= 0 && orient(c, q, r) >= 0 && orient(q, p, r) >= 0);
            if (!blocked) cut = j;
          }
          if (cut < 0) throw new OpRefused('REMESH_DELTA_OP', '', `removes vertex ${v}, whose ring (${poly.join(', ')}) has no ear to clip: it cannot be triangulated without the vertex`);
          made.push([poly[(cut - 1 + poly.length) % poly.length], poly[cut], poly[(cut + 1) % poly.length]]);
          poly.splice(cut, 1);
        }
        if (poly.length === 3) {
          if (orient(poly[0], poly[1], poly[2]) <= 0) throw new OpRefused('REMESH_DELTA_OP', '', `removes vertex ${v}, whose ring closes on a flat triangle (${poly.join(', ')})`);
          made.push([poly[0], poly[1], poly[2]]);
        }
        for (const t of star) dropTri(t);
        live[v] = false;
        removed.add(v);
        moved.delete(v);
        if (onHull) hull.splice(hull.indexOf(v), 1);
        const ts = made.map(([a, b, c]) => newTri(a, b, c));
        legalize(edgesOf(ts));
      } else if (op.op === 'edge') {
        const { a, b } = op;
        mustLive(a, 'vertex');
        mustLive(b, 'vertex');
        const key = ekey(a, b);
        if (constrained.has(key)) throw new OpRefused('REMESH_DELTA_OP', '', `duplicates constraint edge ${a}-${b}`);
        if (isHullEdge(a, b)) throw new OpRefused('REMESH_DELTA_OP', '', `constrains hull edge ${a}-${b}, which no flip ever removes`);
        if (!isEdge(a, b)) {
          const on = live.findIndex((l, k) => l && k !== a && k !== b && orient(a, b, k) === 0 && (X[k] - X[a]) * (X[b] - X[k]) + (Y[k] - Y[a]) * (Y[b] - Y[k]) > 0);
          if (on >= 0) throw new OpRefused('REMESH_DELTA_OP', '', `constrains ${a}-${b}, whose segment runs through vertex ${on}; constrain ${a}-${on} and ${on}-${b}`);
          const changed = new Set<number>();
          let guard = 0;
          for (;;) {
            if (isEdge(a, b)) break;
            if (++guard > 4 * tris.length + 16) throw new OpRefused('REMESH_DELTA_OP', '', `constrains ${a}-${b}, which edge flips could not recover`);
            let crossing: { t: number; u: number; p: number; q: number } | null = null;
            let flipped = false;
            for (let t = 0; t < tris.length && !flipped; t++) {
              const r = tris[t];
              if (r === null) continue;
              for (let k = 0; k < 3 && !flipped; k++) {
                const p = r[k];
                const q = r[(k + 1) % 3];
                if (p === a || p === b || q === a || q === b) continue;
                if (!(Math.sign(orient(a, b, p)) * Math.sign(orient(a, b, q)) < 0 && Math.sign(orient(p, q, a)) * Math.sign(orient(p, q, b)) < 0)) continue;
                const u = owner.get(dkey(q, p));
                if (u === undefined) throw new OpRefused('REMESH_DELTA_OP', '', `constrains ${a}-${b}, whose segment crosses hull edge ${p}-${q}: it would leave the mesh`);
                if (constrained.has(ekey(p, q))) throw new OpRefused('REMESH_DELTA_OP', '', `constrains ${a}-${b}, whose segment crosses constraint edge ${p}-${q}`);
                crossing ??= { t, u, p, q };
                const c = third(t, p, q);
                const d = third(u, q, p);
                if (!(orient(p, d, c) > 0 && orient(q, c, d) > 0)) continue;
                setTri(t, p, d, c);
                setTri(u, q, c, d);
                changed.add(t).add(u);
                flipped = true;
              }
            }
            if (!flipped) throw new OpRefused('REMESH_DELTA_OP', '', crossing === null ? `constrains ${a}-${b}, whose segment crosses no edge and is no edge: it runs outside the mesh` : `constrains ${a}-${b}: no edge it crosses can be flipped`);
          }
          constrained.add(key);
          legalize(edgesOf([...changed]));
        } else constrained.add(key);
        constrainedCount++;
      } else {
        const { a, b } = op;
        mustLive(a, 'vertex');
        mustLive(b, 'vertex');
        if (isHullEdge(a, b)) throw new OpRefused('REMESH_DELTA_OP', '', `unedges hull edge ${a}-${b}; the hull is the mesh's outline and is never removed`);
        if (!constrained.has(ekey(a, b))) throw new OpRefused('REMESH_DELTA_OP', '', `unedges ${a}-${b}: unedge names an edge this delta did not constrain; the producer owns the triangulation`);
        constrained.delete(ekey(a, b));
        constrainedCount--;
        legalize([[a, b]]);
      }
    } catch (err) {
      if (!(err instanceof OpRefused)) throw err;
      return [{ code: err.code, object: err.at === '' ? `${object} ops[${i}]` : err.at, detail: `${JSON.stringify(op)} ${err.why}` }];
    }
  }

  // The output: the hull loop first, in order, then every other live vertex in id order.
  const ids = X.map((_, i) => i).filter((i) => live[i]);
  const order = plant.skipHullOrder === true ? ids : [...hull, ...ids.filter((i) => !hull.includes(i))];
  const at = new Map(order.map((id, k) => [id, k]));
  const triangles: number[] = [];
  for (const r of tris) {
    if (r === null) continue;
    const [a, b, c] = r.map((id) => at.get(id) as number);
    if (sign > 0) triangles.push(a, b, c);
    else triangles.push(a, c, b);
  }
  const attachment: MeshAttachment = {
    type: 'mesh',
    image: att.image,
    width: w,
    height: h,
    uvs: order.flatMap((id) => uv[id]),
    triangles,
    hull: hull.length,
    weights: order.map((id) => wt[id]),
  };
  const after = violations();
  if (plant.skipTopology !== true) {
    const verts = order.map((id) => [X[id] / GRID, Y[id] / GRID] as Vec);
    const topo = contourTopologyProblems(input.part, verts, triangles, hull.length);
    const out: Problem[] = topo.map((p) => ({ code: 'REMESH_DELTA_TOPOLOGY', object: `the replayed ${input.part}`, detail: `${p.code}: ${p.detail}; the result is measured, not trusted, and nothing is written` }));
    if (after > before) out.push({ code: 'REMESH_DELTA_TOPOLOGY', object: `the replayed ${input.part}`, detail: `has ${after} interior edge(s) not locally Delaunay (constraint edges not asked) where the input has ${before}; the replay may not add one, and nothing is written` });
    if (out.length > 0) return out;
  }
  const untouched = X.map((_, i) => i).filter((i) => i < V0 && live[i] && !moved.has(i));
  for (const id of untouched) {
    if (JSON.stringify(uv[id]) !== JSON.stringify([att.uvs[2 * id], att.uvs[2 * id + 1]]) || JSON.stringify(wt[id]) !== JSON.stringify(att.weights[id])) throw new Error(`remeshdelta: untouched vertex ${id} changed`);
  }
  return {
    attachment,
    counts: { vertices: order.length, triangles: triangles.length / 3, hull: hull.length },
    applied: { ops: ops.length, moved: moved.size, added: added.size, removed: removed.size, constrained: constrainedCount },
    untouched,
    delaunay: { before, after },
    index: ids.map((id) => [id, at.get(id) as number]),
  };
}
