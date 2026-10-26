/** Deterministic constrained subdivision. No depth target, part name or raster IO. */
import { depthRefuse, insideDepthTriangle } from './depthinput.ts';
import type { DeformMeshAttachment } from './turn.ts';

export type DepthUV = [number, number];
export interface DepthSample { uv: DepthUV; z: number; }
export interface DepthMeshResult { mesh: DeformMeshAttachment; beforeVertices: number; beforeTriangles: number; samples: number; rms: number; max: number; exhausted: boolean; rejectedSplits: Array<{ sample: number; uv: DepthUV; error: number; reason: string }>; }
const EPS = 1e-10; // Numerical coincidence only, not a relief acceptance threshold.
const cross = (a: DepthUV, b: DepthUV, c: DepthUV): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export const depthUV = (mesh: DeformMeshAttachment, i: number): DepthUV => [mesh.uvs[i * 2], mesh.uvs[i * 2 + 1]];
export function locateDepthUV(mesh: DeformMeshAttachment, uv: DepthUV): { ids: number[]; w: [number, number, number] } | null {
  for (let t = 0; t < mesh.triangles.length; t += 3) { const ids = mesh.triangles.slice(t, t + 3), w = insideDepthTriangle(uv[0], uv[1], mesh.uvs, ids, 1, 1); if (w) return { ids, w }; }
  return null;
}
/** Acceleration only: stable triangle order and the same material hit operator. */
export function indexDepthUV(mesh: DeformMeshAttachment): (uv: DepthUV) => { ids: number[]; w: [number, number, number] } | null {
  const side = Math.max(1, Math.ceil(Math.sqrt(mesh.triangles.length / 3))), bins = new Map<number, number[]>(), cell = (v: number): number => Math.max(0, Math.min(side - 1, Math.floor(v * side)));
  for (let t = 0; t < mesh.triangles.length; t += 3) { const ids = mesh.triangles.slice(t, t + 3), p = ids.map(i => depthUV(mesh, i)); for (let y = cell(Math.min(...p.map(v => v[1]))); y <= cell(Math.max(...p.map(v => v[1]))); y++) for (let x = cell(Math.min(...p.map(v => v[0]))); x <= cell(Math.max(...p.map(v => v[0]))); x++) { const key = y * side + x; if (!bins.has(key)) bins.set(key, []); bins.get(key)!.push(t); } }
  return uv => {
    const candidates = new Set<number>(), cx = cell(uv[0]), cy = cell(uv[1]);
    for (let y = Math.max(0, cy - 1); y <= Math.min(side - 1, cy + 1); y++) for (let x = Math.max(0, cx - 1); x <= Math.min(side - 1, cx + 1); x++) for (const t of bins.get(y * side + x) ?? []) candidates.add(t);
    for (const t of [...candidates].sort((a, b) => a - b)) { const ids = mesh.triangles.slice(t, t + 3), w = insideDepthTriangle(...uv, mesh.uvs, ids, 1, 1); if (w) return { ids, w }; } return null;
  };
}
/** Exact construction coordinates for mandatory partition incidence only.
 * Existing seed UVs and weights are retained; generated points are converted
 * once from canonical fractions, never proximity-welded or snapped.
 */
export interface DepthFraction { n: bigint; d: bigint; }
export type DepthExactUV = [DepthFraction, DepthFraction];
/** Positive GCD; power-of-two denominators are common exact binary inputs. */
function fractionGcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a; if (b < 0n) b = -b;
  if (a === 0n) return b; if (b === 0n || a === b) return a;
  if (a === 1n || b === 1n) return 1n;
  if ((a & (a - 1n)) === 0n) { const low = b & -b; return low < a ? low : a; }
  if ((b & (b - 1n)) === 0n) { const low = a & -a; return low < b ? low : b; }
  while (b) { const r = a % b; a = b; b = r; } return a;
}
function fraction(n: bigint, d = 1n): DepthFraction {
  if (d === 0n) return depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', 'partition construction', 'zero exact divisor');
  if (d < 0n) { n = -n; d = -d; }
  if (n === 0n) return { n: 0n, d: 1n };
  if (d === 1n || n === 1n || n === -1n) return { n, d };
  if (n === d) return { n: 1n, d: 1n }; if (n === -d) return { n: -1n, d: 1n };
  const g = fractionGcd(n, d); return { n: n / g, d: d / g };
}
function qSum(a: DepthFraction, b: DepthFraction, subtract: boolean): DepthFraction {
  if (a.d === 0n || b.d === 0n) return fraction(0n, 0n);
  const bn = subtract ? -b.n : b.n;
  if (a.n === 0n) return fraction(bn, b.d); if (bn === 0n) return fraction(a.n, a.d);
  if (a.d === b.d) return fraction(a.n + bn, a.d);
  if (a.n === a.d) return fraction(b.d + bn, b.d); if (a.n === -a.d) return fraction(bn - b.d, b.d);
  if (bn === b.d) return fraction(a.n + a.d, a.d); if (bn === -b.d) return fraction(a.n - a.d, a.d);
  if (a.d === 1n) return fraction(a.n * b.d + bn, b.d); if (b.d === 1n) return fraction(a.n + bn * a.d, a.d);
  const g = fractionGcd(a.d, b.d), ad = a.d / g, bd = b.d / g;
  return fraction(a.n * bd + bn * ad, ad * b.d);
}
const qAdd = (a: DepthFraction, b: DepthFraction): DepthFraction => qSum(a, b, false);
const qSub = (a: DepthFraction, b: DepthFraction): DepthFraction => qSum(a, b, true);
function qMul(a: DepthFraction, b: DepthFraction): DepthFraction {
  if (a.d === 0n || b.d === 0n) return fraction(0n, 0n);
  if (a.n === 0n || b.n === 0n) return fraction(0n);
  if (a.n === a.d) return fraction(b.n, b.d); if (a.n === -a.d) return fraction(-b.n, b.d);
  if (b.n === b.d) return fraction(a.n, a.d); if (b.n === -b.d) return fraction(-a.n, a.d);
  const g = fractionGcd(a.n, b.d), h = fractionGcd(b.n, a.d);
  return fraction((a.n / g) * (b.n / h), (a.d / h) * (b.d / g));
}
function qDiv(a: DepthFraction, b: DepthFraction): DepthFraction {
  // Preserve the effective divisor of the original product formula before
  // applying zero/identity shortcuts (including 0/0).
  if (a.d === 0n || b.n === 0n) return fraction(0n, 0n);
  if (a.n === 0n || b.d === 0n) return fraction(0n);
  if (b.n === b.d) return fraction(a.n, a.d); if (b.n === -b.d) return fraction(-a.n, a.d);
  if (a.n === a.d) return fraction(b.d, b.n); if (a.n === -a.d) return fraction(-b.d, b.n);
  const g = fractionGcd(a.n, b.n), h = fractionGcd(b.d, a.d);
  return fraction((a.n / g) * (b.d / h), (a.d / h) * (b.n / g));
}
const qFrom = (x: number): DepthFraction => { const a = dyadic(x); return a.e < 0 ? fraction(a.n, 1n << BigInt(-a.e)) : fraction(a.n << BigInt(a.e)); };
const qCross = (a: DepthExactUV, b: DepthExactUV, c: DepthExactUV): DepthFraction => qSub(qMul(qSub(b[0], a[0]), qSub(c[1], a[1])), qMul(qSub(b[1], a[1]), qSub(c[0], a[0])));
const qNumber = (a: DepthFraction): number => dyadicRatio({ n: a.n, e: 0 }, { n: a.d, e: 0 });
const qPoint = (a: DepthUV): DepthExactUV => [qFrom(a[0]), qFrom(a[1])];
const qLerp = (a: DepthExactUV, b: DepthExactUV, t: DepthFraction): DepthExactUV => [0, 1].map(i => qAdd(a[i], qMul(t, qSub(b[i], a[i])))) as DepthExactUV;
export const depthRational = { add: qAdd, sub: qSub, mul: qMul, div: qDiv, from: qFrom, cross: qCross, number: qNumber, point: qPoint, lerp: qLerp, key: (p: DepthExactUV): string => p.map(a => `${a.n}/${a.d}`).join(',') };
/** Premultiplied bone-local interpolation preserves every affine bone pose. */
export function depthWeights(mesh: DeformMeshAttachment, ids: readonly number[], w: readonly number[]): DeformMeshAttachment['weights'][number] {
  const sums = new Map<string, { x: number; y: number; weight: number }>();
  ids.forEach((id, k) => { for (const a of mesh.weights[id]) { let s = sums.get(a.bone); if (!s) { s = { x: 0, y: 0, weight: 0 }; sums.set(a.bone, s); } const q = w[k] * a.weight; s.x += q * a.x; s.y += q * a.y; s.weight += q; } });
  return [...sums].filter(([, a]) => a.weight > 0).map(([bone, a]) => ({ bone, x: a.x / a.weight, y: a.y / a.weight, weight: a.weight }));
}
function budget(mesh: DeformMeshAttachment, cap: number): void {
  if (!Number.isInteger(cap) || cap < 1 || cap > 2048 || mesh.triangles.length / 3 > cap) depthRefuse('RIG_DEPTH_MESH_BUDGET', mesh.image, `mandatory ${mesh.triangles.length / 3} triangles exceed declared ${cap} (supported cap 2048); no escalation`);
}
/** Rebuild the single boundary ring and put it before all interior vertices. */
function boundaryFirst(mesh: DeformMeshAttachment): void {
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (let t = 0; t < mesh.triangles.length; t += 3) for (let k = 0; k < 3; k++) { const a = mesh.triangles[t + k], b = mesh.triangles[t + (k + 1) % 3], key = [Math.min(a, b), Math.max(a, b)].join(','); const e = edges.get(key); if (e) e.count++; else edges.set(key, { a, b, count: 1 }); }
  const next = new Map<number, number>();
  for (const e of edges.values()) { if (e.count > 2) depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', mesh.image, 'an edge has more than two incident triangles'); if (e.count === 1) { if (next.has(e.a)) depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', mesh.image, 'boundary branches'); next.set(e.a, e.b); } }
  const ring: number[] = []; let at = 0;
  do { if (ring.includes(at) || !next.has(at)) depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', mesh.image, 'one closed boundary containing original vertex zero is required'); ring.push(at); at = next.get(at) as number; } while (at !== 0);
  if (ring.length !== next.size) depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', mesh.image, 'multiple boundary loops are unsupported');
  const order = [...ring, ...Array.from({ length: mesh.weights.length }, (_, i) => i).filter(i => !next.has(i))], remap = new Map(order.map((id, i) => [id, i]));
  mesh.uvs = order.flatMap(i => depthUV(mesh, i)); mesh.weights = order.map(i => mesh.weights[i]); mesh.triangles = mesh.triangles.map(i => remap.get(i) as number); mesh.hull = ring.length;
}
/** Triangulate convex overlap cells, preserving all seed edges and shared cuts.
 * Every cell belongs to one seed triangle. Collinear edge points are retained.
 */
export function constrainDepthMesh(seed: DeformMeshAttachment, cells: readonly DepthUV[][], cap: number, exact?: ReadonlyMap<DepthUV, DepthExactUV>): DeformMeshAttachment {
  const mesh = structuredClone(seed), polygons: number[][] = [], coords = Array.from({ length: seed.weights.length }, (_, i) => qPoint(depthUV(seed, i)));
  const keys = new Map(coords.map((p, i) => [depthRational.key(p), i]));
  const orient = (a: number, b: number, c: number): number => { const n = qCross(coords[a], coords[b], coords[c]).n; return n === 0n ? 0 : n > 0n ? 1 : -1; };
  for (const cell of cells) {
    const ids: number[] = [];
    for (const uv of cell) {
      const q = exact?.get(uv) ?? qPoint(uv), key = depthRational.key(q); let id = keys.get(key) ?? -1;
      if (id < 0) { const hit = locateDepthUV(seed, uv); if (!hit) depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', seed.image, 'constraint lies outside the original UV domain'); id = mesh.weights.length; mesh.uvs.push(...uv); mesh.weights.push(depthWeights(seed, hit.ids, hit.w)); coords.push(q); keys.set(key, id); }
      if (ids.at(-1) !== id) ids.push(id);
    }
    if (ids[0] === ids.at(-1)) ids.pop(); if (ids.length >= 3) polygons.push(ids);
  }
  mesh.triangles = [];
  for (const polygon of polygons) {
    const ring: number[] = [];
    for (let j = 0; j < polygon.length; j++) {
      const a = polygon[j], b = polygon[(j + 1) % polygon.length], axis = qSub(coords[b][0], coords[a][0]).n !== 0n ? 0 : 1, delta = qSub(coords[b][axis], coords[a][axis]);
      const edge: Array<{ id: number; t: number }> = [{ id: a, t: 0 }];
      for (let id = 0; id < mesh.weights.length; id++) { if (id === a || id === b || orient(a, b, id) !== 0) continue; const t = qDiv(qSub(coords[id][axis], coords[a][axis]), delta); if (t.n > 0n && t.n < t.d) edge.push({ id, t: qNumber(t) }); }
      edge.sort((x, y) => x.t - y.t || x.id - y.id); ring.push(...edge.map(e => e.id));
    }
    const area = ring.slice(1, -1).reduce((s, a, i) => qAdd(s, qCross(coords[ring[0]], coords[a], coords[ring[i + 2]])), qFrom(0)), winding = area.n === 0n ? 0 : area.n > 0n ? 1 : -1;
    while (ring.length > 3) {
      let cut = false;
      for (let i = 0; i < ring.length; i++) {
        const ids = [ring[(i + ring.length - 1) % ring.length], ring[i], ring[(i + 1) % ring.length]];
        if (winding * orient(ids[0], ids[1], ids[2]) <= 0) continue;
        if (ring.some(id => !ids.includes(id) && ids.every((a, k) => winding * orient(a, ids[(k + 1) % 3], id) >= 0))) continue;
        mesh.triangles.push(...ids); ring.splice(i, 1); cut = true; break;
      }
      if (!cut) depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', mesh.image, 'constrained cell cannot be triangulated without a degenerate triangle');
    }
    if (ring.length === 3) mesh.triangles.push(...ring);
    budget(mesh, cap);
  }
  boundaryFirst(mesh); return mesh;
}

type Dyadic = { n: bigint; e: number };
const floatBits = new DataView(new ArrayBuffer(8));
/** Exact binary64 integer * power-of-two representation; finite UVs only. */
function dyadic(x: number): Dyadic {
  if (!Number.isFinite(x)) return depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', 'adaptive UV', 'finite coordinates are required');
  floatBits.setFloat64(0, x); const bits = floatBits.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
  const n = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  return { n: bits >> 63n ? -n : n, e: exponent ? exponent - 1075 : -1074 };
}
function subtract(a: Dyadic, b: Dyadic): Dyadic { const e = Math.min(a.e, b.e); return { n: (a.n << BigInt(a.e - e)) - (b.n << BigInt(b.e - e)), e }; }
function exactCross(a: DepthUV, b: DepthUV, c: DepthUV): Dyadic {
  const x = subtract(dyadic(b[0]), dyadic(a[0])), y = subtract(dyadic(b[1]), dyadic(a[1])), u = subtract(dyadic(c[0]), dyadic(a[0])), v = subtract(dyadic(c[1]), dyadic(a[1]));
  return subtract({ n: x.n * v.n, e: x.e + v.e }, { n: y.n * u.n, e: y.e + u.e });
}
/** Six differences/products and one subtraction: 32 eps M^2 conservatively
 * bounds normal-range roundoff for |coordinate| <= M. Ambiguous/subnormal or
 * overflowing bounds use exact dyadic arithmetic, never a geometric tolerance.
 */
function filteredCross(a: DepthUV, b: DepthUV, c: DepthUV): number | null {
  const value = cross(a, b, c), m = Math.max(...a.map(Math.abs), ...b.map(Math.abs), ...c.map(Math.abs)), bound = 32 * Number.EPSILON * m * m;
  return bound > 0 && Number.isFinite(bound) && Math.abs(value) > bound ? value : null;
}
function orientation(a: DepthUV, b: DepthUV, c: DepthUV): number {
  const value = filteredCross(a, b, c); if (value !== null) return Math.sign(value);
  const n = exactCross(a, b, c).n; return n === 0n ? 0 : n > 0n ? 1 : -1;
}
function dyadicRatio(a: Dyadic, b: Dyadic): number {
  const head = (v: Dyadic): Dyadic => { const bits = (v.n < 0n ? -v.n : v.n).toString(2).length, shift = Math.max(0, bits - 53); return { n: v.n < 0n ? -((-v.n) >> BigInt(shift)) : v.n >> BigInt(shift), e: v.e + shift }; };
  const x = head(a), y = head(b); return Number(x.n) / Number(y.n) * 2 ** (x.e - y.e);
}
/** Topological incidence has no raster halo. Zero means the SAME shared edge
 * for every adjacent triangle; a nearby point remains in its true interior.
 */
function adaptiveHit(mesh: DeformMeshAttachment, ids: readonly number[], uv: DepthUV): { w: [number, number, number]; edge: number } | null {
  const [a, b, c] = ids.map(i => depthUV(mesh, i)), sign = orientation(a, b, c);
  if (!sign) return depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', mesh.image, 'adaptive triangle has exactly zero UV area');
  const triples: Array<[DepthUV, DepthUV, DepthUV]> = [[b, c, uv], [c, a, uv], [a, b, uv]], sides = triples.map(t => orientation(...t));
  if (sides.some(v => v !== 0 && v !== sign)) return null;
  const d = cross(a, b, c), raw = triples.map(t => cross(...t));
  const exact = filteredCross(a, b, c) === null || triples.some((t, i) => sides[i] !== 0 && filteredCross(...t) === null);
  const divisor = exact ? exactCross(a, b, c) : undefined;
  const values = raw.map((v, i) => sides[i] === 0 ? 0 : divisor ? dyadicRatio(exactCross(...triples[i]), divisor) : v / d), sum = values.reduce((total, v) => total + v, 0);
  if (!(sum > 0) || values.some(v => !Number.isFinite(v) || v < 0)) return depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', mesh.image, 'adaptive barycentric weights are not representable');
  return { w: values.map(v => v / sum) as [number, number, number], edge: sides.indexOf(0) };
}

export function refineDepthMesh(seed: DeformMeshAttachment, samples: readonly DepthSample[], query: (uv: DepthUV) => number, cap: number, observe?: (mesh: Readonly<DeformMeshAttachment>) => void, eligible?: (mesh: DeformMeshAttachment, children: readonly number[][]) => string | null): DepthMeshResult {
  budget(seed, cap); boundaryFirst(structuredClone(seed)); const mesh = structuredClone(seed), zs = mesh.weights.map((_, i) => query(depthUV(mesh, i)));
  const rejectedSplits: DepthMeshResult['rejectedSplits'] = [], ineligible = new Set<number>();
  if (eligible) { const reason = eligible(mesh, Array.from({ length: mesh.triangles.length / 3 }, (_, i) => mesh.triangles.slice(i * 3, i * 3 + 3))); if (reason) depthRefuse('RIG_DEPTH_MESH_PRECISION', mesh.image, `invalid seed: ${reason}`); }
  type Leaf = { ids: number[]; samples: number[]; best: number; error: number };
  const leaf = (ids: number[], indices: number[]): Leaf => { let best = -1, error = 0; for (const i of indices) { const s = samples[i], hit = adaptiveHit(mesh, ids, s.uv); if (!hit) return depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', mesh.image, 'adaptive sample lost its owning triangle'); const w = hit.w; const e = Math.abs(s.z - ids.reduce((v, id, k) => v + zs[id] * w[k], 0)); if (!ineligible.has(i) && e > error) { best = i; error = e; } } return { ids, samples: indices, best, error }; };
  const buckets = Array.from({ length: mesh.triangles.length / 3 }, () => [] as number[]);
  let seedOrientation = 0;
  for (let t = 0; t < mesh.triangles.length; t += 3) { const sign = orientation(...mesh.triangles.slice(t, t + 3).map(i => depthUV(mesh, i)) as [DepthUV, DepthUV, DepthUV]); if (!sign || (seedOrientation && sign !== seedOrientation)) return depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', mesh.image, 'adaptive seed triangles require consistent nonzero UV orientation'); seedOrientation = sign; }
  observe?.(mesh);
  samples.forEach((s, i) => { for (let t = 0; t < buckets.length; t++) if (adaptiveHit(mesh, mesh.triangles.slice(t * 3, t * 3 + 3), s.uv)) { buckets[t].push(i); return; } depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', mesh.image, 'adaptive sample is outside the exact seed domain'); });
  let leaves = buckets.map((indices, i) => leaf(mesh.triangles.slice(i * 3, i * 3 + 3), indices)), exhausted = false;
  while (true) {
    let best: Leaf | undefined; for (const l of leaves) if (l.error > EPS && (!best || l.error > best.error)) best = l;
    if (!best) break;
    const uv = samples[best.best].uv, affected = leaves.filter(l => adaptiveHit(mesh, l.ids, uv));
    // Only identical represented UVs coincide; inconsistent duplicate targets refuse.
    if (mesh.weights.some((_, i) => { const p = depthUV(mesh, i); return p[0] === uv[0] && p[1] === uv[1]; })) return depthRefuse('RIG_DEPTH_FIELD_SAMPLE', mesh.image, 'represented source UV retains a nonzero interpolation residual');
    if (affected.length > 2 || !affected.length || (affected.length === 2 && affected.some(l => adaptiveHit(mesh, l.ids, uv)?.edge === -1))) return depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', mesh.image, 'adaptive insertion has overlapping interiors or unsupported incidence');
    const replacements: number[][] = [], id = mesh.weights.length;
    for (const l of affected) {
      const zero = adaptiveHit(mesh, l.ids, uv)!.edge;
      if (zero >= 0) { const a = l.ids[(zero + 1) % 3], b = l.ids[(zero + 2) % 3], c = l.ids[zero]; replacements.push([a, id, c], [id, b, c]); }
      else { const [a, b, c] = l.ids; replacements.push([a, b, id], [b, c, id], [c, a, id]); }
    }
    if (leaves.length - affected.length + replacements.length > cap) { exhausted = true; break; }
    const hit = { ids: affected[0].ids, w: adaptiveHit(mesh, affected[0].ids, uv)!.w };
    const row = depthWeights(mesh, hit.ids, hit.w);
    // Rejection changes only one sample's eligibility. Leaf sample indices
    // form a partition, so every other leaf's residual cache stays valid.
    if (eligible) {
      const candidate = { ...mesh, uvs: [...mesh.uvs, ...uv], weights: [...mesh.weights, row] }, reason = eligible(candidate, replacements);
      if (reason) { rejectedSplits.push({ sample: best.best, uv: [...uv], error: best.error, reason }); ineligible.add(best.best); leaves = leaves.map(l => l === best ? leaf(l.ids, l.samples) : l); continue; }
    }
    mesh.weights.push(row); mesh.uvs.push(...uv); zs.push(query(uv));
    const indices = [...new Set(affected.flatMap(l => l.samples))]; for (const i of indices) ineligible.delete(i); const bags = replacements.map(() => [] as number[]);
    for (const i of indices) { let assigned = false; for (let k = 0; k < replacements.length; k++) if (adaptiveHit(mesh, replacements[k], samples[i].uv)) { bags[k].push(i); assigned = true; break; } if (!assigned) return depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', mesh.image, 'adaptive subdivision lost a source sample'); }
    leaves = [...leaves.filter(l => !affected.includes(l)), ...replacements.map((ids, k) => leaf(ids, bags[k]))]; mesh.triangles = leaves.flatMap(l => l.ids); observe?.(mesh);
  }
  let square = 0, max = 0, count = 0;
  for (const l of leaves) for (const i of l.samples) { const w = adaptiveHit(mesh, l.ids, samples[i].uv)!.w, e = Math.abs(samples[i].z - l.ids.reduce((s, id, k) => s + zs[id] * w[k], 0)); square += e * e; max = Math.max(max, e); count++; }
  boundaryFirst(mesh);
  return { mesh, beforeVertices: seed.weights.length, beforeTriangles: seed.triangles.length / 3, samples: count, rms: count ? Math.sqrt(square / count) : 0, max, exhausted, rejectedSplits };
}

/** Sparse source-area least squares with hard linear no-fold halfspaces. */
export interface DepthLinear { ids: number[]; values: number[]; }
export interface DepthHalfspace extends DepthLinear { upper: number; object: string; }
export interface DepthSolveReport { variables: number; observations: number; sourceArea: number; iterations: number; cgIterations: number; primal: number; stationarity: number; complementarity: number; objective: number; method: string; }
/** Portable Euclidean row norm: fixed-order multiply/add/sqrt, as length.ts.
 * Scale first so finite large/small components do not overflow/underflow their
 * squares. This is mathematical row scaling, not a solver tolerance or gain.
 */
export function depthRowNorm(values: readonly number[]): number {
  const scale = values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (!(scale > 0) || !Number.isFinite(scale)) return scale;
  return scale * Math.sqrt(values.reduce((sum, v) => sum + (v / scale) * (v / scale), 0));
}
export class DepthLeastSquares {
  private h: Array<Map<number, number>>;
  private rhs: Float64Array;
  private constant = 0;
  private area = 0;
  private observations = 0;
  constructor(readonly size: number) { this.h = Array.from({ length: size }, () => new Map()); this.rhs = new Float64Array(size); }
  add(row: DepthLinear, target: number, area: number): void {
    if (!(area > 0) || !Number.isFinite(target)) depthRefuse('RIG_DEPTH_FIELD_SOLVE', 'source objective', 'finite source target and positive neutral pixel area required');
    this.area += area; this.constant += area * target * target; this.observations++;
    row.ids.forEach((i, a) => { const v = row.values[a]; this.rhs[i] += area * v * target; row.ids.forEach((j, b) => this.h[i].set(j, (this.h[i].get(j) ?? 0) + area * v * row.values[b])); });
  }
  solve(halfspaces: readonly DepthHalfspace[]): { values: number[]; report: DepthSolveReport } {
    const n = this.size;
    if (!n || !(this.area > 0)) return depthRefuse('RIG_DEPTH_FIELD_SOLVE', 'source objective', 'no independently sampled core objective');
    const scale = Array.from({ length: n }, (_, i) => Math.sqrt((this.h[i].get(i) ?? 0) / this.area) || 1);
    const h = this.h.map((row, i) => [...row].sort(([a], [b]) => a - b).map(([j, v]) => [j, v / this.area / scale[i] / scale[j]] as const));
    const rhs = Float64Array.from(this.rhs, (v, i) => v / this.area / scale[i]);
    const a = halfspaces.map(row => { const values = row.values.map((v, k) => v / scale[row.ids[k]]), norm = depthRowNorm(values); if (!(norm > 0) || !Number.isFinite(norm)) return depthRefuse('RIG_DEPTH_FIELD_SOLVE', row.object, 'empty or nonfinite no-fold row'); return { ids: row.ids, values: values.map(v => v / norm), upper: row.upper / norm }; });
    const dot = (row: DepthLinear, x: ArrayLike<number>): number => row.ids.reduce((s, id, k) => s + row.values[k] * x[id], 0);
    const mulH = (x: ArrayLike<number>): Float64Array => Float64Array.from(h, row => row.reduce((s, [j, v]) => s + v * x[j], 0));
    const transpose = (y: ArrayLike<number>): Float64Array => { const out = new Float64Array(n); a.forEach((row, i) => row.ids.forEach((id, k) => { out[id] += row.values[k] * y[i]; })); return out; };
    const diagonal = Float64Array.from({ length: n }, (_, i) => h[i].find(([j]) => j === i)?.[1] ?? 0);
    const fullDiagonal = Float64Array.from(diagonal); a.forEach(row => row.ids.forEach((id, k) => { fullDiagonal[id] += row.values[k] ** 2; }));
    const mulFull = (x: ArrayLike<number>): Float64Array => { const out = mulH(x), at = transpose(a.map(row => dot(row, x))); for (let i = 0; i < n; i++) out[i] += at[i]; return out; };
    const max = (x: ArrayLike<number>): number => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); return m; };
    let cgIterations = 0;
    const cg = (multiply: (x: ArrayLike<number>) => Float64Array, b: Float64Array, start: Float64Array, diag: Float64Array): Float64Array => {
      const x = Float64Array.from(start), ax = multiply(x), r = Float64Array.from(b, (v, i) => v - ax[i]), z = Float64Array.from(r, (v, i) => v / (diag[i] || 1)), p = Float64Array.from(z);
      let rz = r.reduce((s, v, i) => s + v * z[i], 0); const tol = 2 ** -40 * (1 + max(b));
      for (let iteration = 0; iteration < Math.min(4096, 4 * n + 64); iteration++) {
        if (max(r) <= tol) return x;
        const ap = multiply(p), denominator = p.reduce((s, v, i) => s + v * ap[i], 0);
        if (!(denominator > 0) || !Number.isFinite(denominator)) return depthRefuse('RIG_DEPTH_FIELD_SOLVE', 'PCG', `nonpositive curvature with residual ${max(r)}`);
        const alpha = rz / denominator;
        for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * ap[i]; z[i] = r[i] / (diag[i] || 1); }
        const next = r.reduce((s, v, i) => s + v * z[i], 0), beta = next / rz; for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i]; rz = next; cgIterations++;
      }
      return depthRefuse('RIG_DEPTH_FIELD_SOLVE', 'PCG', `iteration bound; residual ${max(r)}`);
    };
    let x = cg(mulH, rhs, new Float64Array(n), diagonal), dual = new Float64Array(a.length), slack = Float64Array.from(a, row => Math.min(dot(row, x), row.upper));
    let primal = Infinity, stationarity = Infinity, complementarity = Infinity, iterations = 0;
    for (; iterations <= 2000; iterations++) {
      const hx = mulH(x), aty = transpose(dual); primal = 0; stationarity = 0; complementarity = 0;
      a.forEach((row, i) => { const d = dot(row, x) - row.upper; primal = Math.max(primal, d); complementarity = Math.max(complementarity, Math.abs(dual[i] * d)); });
      for (let i = 0; i < n; i++) stationarity = Math.max(stationarity, Math.abs(hx[i] - rhs[i] + aty[i]));
      const tolerance = 2 ** -30 * (1 + Math.max(max(x), max(rhs)));
      if (primal <= tolerance && stationarity <= tolerance && complementarity <= tolerance) break;
      if (iterations === 2000) return depthRefuse('RIG_DEPTH_FIELD_SOLVE', 'ADMM', `iteration bound; primal ${primal}, stationarity ${stationarity}, complementarity ${complementarity}`);
      const at = transpose(Float64Array.from(slack, (v, i) => v - dual[i])), right = Float64Array.from(rhs, (v, i) => v + at[i]);
      x = cg(mulFull, right, x, fullDiagonal);
      a.forEach((row, i) => { const v = dot(row, x); slack[i] = Math.min(v + dual[i], row.upper); dual[i] += v - slack[i]; });
    }
    const values = Array.from(x, (v, i) => v / scale[i]), hv = mulH(x), objective = Math.max(0, x.reduce((s, v, i) => s + v * hv[i] - 2 * v * rhs[i], this.constant / this.area));
    return { values, report: { variables: n, observations: this.observations, sourceArea: this.area, iterations, cgIterations, primal, stationarity, complementarity, objective, method: 'source-area core LS; eliminated coupling; column-scaled ADMM rho1 / Jacobi-PCG; deterministic binding/vertex/sample order' } };
  }
}
