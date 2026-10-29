/** Source-space waist subdivision. Exact predicates identify shared edges; emitted bindings keep OFFSET6/f32. */
import { computeExactFrameTransforms, computeWorldTransforms, cropToSpineY, toBoneLocal, toWorld, type BoneTransform } from './coords.ts';
import { PartsError } from './errors.ts';
import { counterClockwiseInSpineWorld, type LatticeMesh } from './mesh.ts';
import type { MeshAttachment, RegionAttachment, RigBone, WeightEntry } from './rig.ts';
import { pyRound } from './round.ts';
import { f32 } from '@rig-c/core/compile';

type Q = readonly [bigint, bigint];
type P = readonly [Q, Q];
type Line = readonly [Q, Q, Q];
function fail(code: string, object: string, detail: string): never { throw new PartsError([{ code, object, detail }]); }
const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b !== 0n) [a, b] = [b, a % b]; return a; };
const q = (n: bigint, d = 1n): Q => { if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return [n / g, d / g]; };
const add = (a: Q, b: Q): Q => q(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const sub = (a: Q, b: Q): Q => q(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const mul = (a: Q, b: Q): Q => q(a[0] * b[0], a[1] * b[1]);
const div = (a: Q, b: Q): Q => q(a[0] * b[1], a[1] * b[0]);
const number = (a: Q): number => Number(a[0]) / Number(a[1]);
const decimal = (v: number): Q => {
  if (!Number.isFinite(v)) fail('RIG_WAIST_GEOMETRY', 'waist arrangement', `coordinate ${v} is not finite`);
  const [m, e = '0'] = String(v).split('e'), places = (m.split('.')[1] ?? '').length - Number(e);
  const n = BigInt(m.replace('.', ''));
  return places >= 0 ? q(n, 10n ** BigInt(places)) : q(n * 10n ** BigInt(-places));
};
const point = (x: number, y: number): P => [decimal(x), decimal(y)];
const key = (p: P): string => p.map((v) => `${v[0]}/${v[1]}`).join(',');
const cross = (a: P, b: P, c: P): Q => sub(mul(sub(b[0], a[0]), sub(c[1], a[1])), mul(sub(b[1], a[1]), sub(c[0], a[0])));
const lineOf = (a: P, b: P): Line => [sub(a[1], b[1]), sub(b[0], a[0]), sub(mul(a[0], b[1]), mul(b[0], a[1]))];
const at = (l: Line, p: P): Q => add(add(mul(l[0], p[0]), mul(l[1], p[1])), l[2]);
const lineKey = (l: Line): string => { const first = l.find((x) => x[0] !== 0n); return first === undefined ? '' : l.map((x) => div(x, first).join('/')).join(','); };
function clip(poly: readonly P[], line: Line, side: bigint): P[] {
  const out: P[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = at(line, a), db = at(line, b);
    if (da[0] * side >= 0n) out.push(a);
    if (da[0] * db[0] < 0n) {
      const t = div(da, sub(da, db));
      out.push([add(a[0], mul(t, sub(b[0], a[0]))), add(a[1], mul(t, sub(b[1], a[1])))]);
    }
  }
  return out.filter((p, i) => key(p) !== key(out[(i + out.length - 1) % out.length]));
}
function split(polys: P[][], line: Line): P[][] {
  return polys.flatMap((poly) => {
    const sides = poly.map((p) => at(line, p)[0]);
    return sides.some((n) => n < 0n) && sides.some((n) => n > 0n) ? [clip(poly, line, 1n), clip(poly, line, -1n)] : [poly];
  });
}
/** Metadata needed to invert a native page UV into the original drawing, in texels. */
export interface StoredWaistAtlas {
  pageWidth: number; pageHeight: number; scale: number | null | undefined;
  x: number; y: number; width: number; height: number;
  offsetX: number; offsetY: number; originalWidth: number; originalHeight: number; degrees: number;
}

/** Exact binary64 value, including the float32 values native UV arrays hold. */
function binary(value: number): Q {
  if (!Number.isFinite(value)) fail('RIG_WAIST_STORED_UV', 'native waist UV', `non-finite value ${value}`);
  const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, value);
  const bits = v.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n), fraction = bits & ((1n << 52n) - 1n);
  let n = exponent === 0 ? fraction : fraction | (1n << 52n);
  if ((bits >> 63n) !== 0n) n = -n;
  const e = (exponent === 0 ? -1022 : exponent - 1023) - 52;
  return e >= 0 ? q(n << BigInt(e)) : q(n, 1n << BigInt(-e));
}
const twiceArea = (poly: readonly P[]): Q => {
  const a = poly.reduce((sum, p, i) => add(sum, sub(mul(p[0], poly[(i + 1) % poly.length][1]), mul(p[1], poly[(i + 1) % poly.length][0]))), q(0n));
  return a[0] < 0n ? q(-a[0], a[1]) : a;
};

/**
 * Whole last-row pixel cells, using ACTUAL native page UVs, never nominal row positions.
 * Exact clipping and coverage leave no epsilon that could swallow a positive mixed-support sliver.
 * The caller supplies stored H-only support from the gated compiled bindings in the same vertex order.
 */
export function storedWaistHem(
  uvs: readonly number[], triangles: readonly number[], onlyLower: readonly boolean[],
  art: { width: number; height: number; data: ArrayLike<number> }, atlas: StoredWaistAtlas,
): { pass: boolean; hem: number; pixels: number; uncovered: number[]; mixed: number[] } {
  const ints = [atlas.pageWidth, atlas.pageHeight, atlas.x, atlas.y, atlas.width, atlas.height, atlas.offsetX, atlas.offsetY, atlas.originalWidth, atlas.originalHeight, atlas.degrees];
  if (ints.some((n) => !Number.isSafeInteger(n)) || atlas.pageWidth < 1 || atlas.pageHeight < 1 || atlas.pageWidth > 2048 || atlas.pageHeight > 2048 || atlas.width < 1 || atlas.height < 1 || atlas.originalWidth !== art.width || atlas.originalHeight !== art.height || art.width < 1 || art.height < 1 || art.width > 2048 || art.height > 2048 || (atlas.scale !== null && atlas.scale !== 1) || ![0, 90, 180, 270].includes(atlas.degrees)) {
    fail('RIG_WAIST_STORED_METADATA', 'native waist atlas', 'requires integral unscaled metadata, positive original/page dimensions at most 2048, matching source drawing dimensions, and a right-angle rotation');
  }
  if (art.data.length !== art.width * art.height || uvs.length !== 2 * onlyLower.length || uvs.length === 0 || uvs.some((n) => !Number.isFinite(n) || Math.fround(n) !== n) || triangles.length === 0 || triangles.length % 3 !== 0 || triangles.some((n) => !Number.isInteger(n) || n < 0 || n >= onlyLower.length)) fail('RIG_WAIST_STORED_UV', 'native waist mesh', 'requires nonempty native float32 page UVs, matching support and valid complete triangles');
  let hem = -1;
  for (let y = 0; y < art.height; y++) for (let x = 0; x < art.width; x++) if (art.data[y * art.width + x] !== 0) hem = y;
  if (hem < 0) fail('RIG_WAIST_STORED_EMPTY', 'native waist hem', 'no painted row; an empty read cannot pass');
  const integer = (n: number): Q => q(BigInt(n));
  const vertices: P[] = [];
  for (let i = 0; i < uvs.length; i += 2) {
    const u = sub(mul(binary(uvs[i]), integer(atlas.pageWidth)), integer(atlas.x));
    const v = sub(mul(binary(uvs[i + 1]), integer(atlas.pageHeight)), integer(atlas.y));
    const ow = integer(atlas.originalWidth), oh = integer(atlas.originalHeight);
    switch (atlas.degrees) {
      case 90: vertices.push([sub(ow, add(v, integer(atlas.originalWidth - atlas.offsetX - atlas.width))), add(u, integer(atlas.originalHeight - atlas.offsetY - atlas.height))]); break;
      case 180: vertices.push([sub(ow, add(u, integer(atlas.originalWidth - atlas.offsetX - atlas.width))), sub(oh, add(v, integer(atlas.offsetY)))]); break;
      case 270: vertices.push([add(v, integer(atlas.offsetX)), sub(oh, add(u, integer(atlas.offsetY)))]); break;
      default: vertices.push([add(u, integer(atlas.offsetX)), add(v, integer(atlas.originalHeight - atlas.offsetY - atlas.height))]);
    }
  }
  const uncovered: number[] = [], mixed: number[] = [];
  let pixels = 0;
  for (let x = 0; x < art.width; x++) {
    if (art.data[hem * art.width + x] === 0) continue;
    pixels++;
    let covered = q(0n), hasMixed = false, overlap = false;
    const pieces: P[][] = [];
    for (let t = 0; t < triangles.length; t += 3) {
      const ids = triangles.slice(t, t + 3);
      let poly = ids.map((v) => vertices[v]);
      for (const [axis, low, high] of [[0, x, x + 1], [1, hem, hem + 1]]) {
        const a = axis === 0 ? q(1n) : q(0n), b = axis === 1 ? q(1n) : q(0n);
        poly = clip(poly, [a, b, integer(-low)], 1n);
        poly = clip(poly, [a, b, integer(-high)], -1n);
      }
      const area = twiceArea(poly);
      if (area[0] === 0n) continue;
      for (const previous of pieces) {
        let intersection = poly;
        const orientation = previous.map((a, i) => cross(a, previous[(i + 1) % previous.length], previous[(i + 2) % previous.length])[0]).find((n) => n !== 0n);
        if (orientation === undefined) continue;
        for (let k = 0; k < previous.length; k++) intersection = clip(intersection, lineOf(previous[k], previous[(k + 1) % previous.length]), orientation > 0n ? 1n : -1n);
        if (twiceArea(intersection)[0] !== 0n) overlap = true;
      }
      pieces.push(poly);
      covered = add(covered, area);
      if (ids.some((v) => !onlyLower[v])) hasMixed = true;
    }
    if (overlap || covered[0] !== 2n * covered[1]) uncovered.push(x);
    if (hasMixed) mixed.push(x);
  }
  return { pass: pixels > 0 && uncovered.length === 0 && mixed.length === 0, hem, pixels, uncovered, mixed };
}

export interface Correspondence { indices: number[]; barycentric: number[] }
interface Arrangement { exact: P[]; vertices: Array<[number, number]>; triangles: number[]; hull: number }
const exactVertices = new WeakMap<object, P[]>();
function arrangement(polys: P[][]): Arrangement {
  const pts: P[] = [], ids = new Map<string, number>(), triangles: number[] = [];
  const id = (p: P): number => { const k = key(p), old = ids.get(k); if (old !== undefined) return old; const v = pts.length; pts.push(p); ids.set(k, v); return v; };
  for (let poly of polys) {
    if (poly.length < 3) continue;
    const area = poly.reduce((sum, p, i) => add(sum, sub(mul(p[0], poly[(i + 1) % poly.length][1]), mul(p[1], poly[(i + 1) % poly.length][0]))), q(0n));
    if (area[0] === 0n) continue;
    if (area[0] < 0n) poly = [...poly].reverse();
    const collinear = poly.some((p, i) => cross(poly[(i + poly.length - 1) % poly.length], p, poly[(i + 1) % poly.length])[0] === 0n);
    if (collinear) {
      const centre: P = [div(poly.reduce((s, p) => add(s, p[0]), q(0n)), q(BigInt(poly.length))), div(poly.reduce((s, p) => add(s, p[1]), q(0n)), q(BigInt(poly.length)))];
      for (let i = 0; i < poly.length; i++) triangles.push(id(centre), id(poly[i]), id(poly[(i + 1) % poly.length]));
    } else for (let i = 1; i + 1 < poly.length; i++) triangles.push(id(poly[0]), id(poly[i]), id(poly[i + 1]));
  }
  const edges = new Map<string, { a: number; b: number; n: number }>();
  for (let t = 0; t < triangles.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = triangles[t + k], b = triangles[t + (k + 1) % 3], ek = `${Math.min(a, b)},${Math.max(a, b)}`, old = edges.get(ek);
    if (old === undefined) edges.set(ek, { a, b, n: 1 }); else old.n++;
  }
  const adj = new Map<number, number[]>();
  for (const e of edges.values()) {
    if (e.n > 2) fail('RIG_WAIST_TOPOLOGY', 'waist arrangement', `edge ${e.a}/${e.b} belongs to ${e.n} triangles, expected one or two`);
    if (e.n === 1) { adj.set(e.a, [...(adj.get(e.a) ?? []), e.b]); adj.set(e.b, [...(adj.get(e.b) ?? []), e.a]); }
  }
  if (adj.size === 0 || [...adj.values()].some((v) => v.length !== 2)) fail('RIG_WAIST_TOPOLOGY', 'waist arrangement', 'boundary is not a closed non-pinched loop');
  const order: number[] = [], seen = new Set<number>();
  let cur = adj.keys().next().value as number;
  while (!seen.has(cur)) { seen.add(cur); order.push(cur); cur = (adj.get(cur) as number[]).find((n) => !seen.has(n)) ?? order[0]; }
  if (seen.size !== adj.size) fail('RIG_WAIST_TOPOLOGY', 'waist arrangement', `has more than one boundary loop (${seen.size}/${adj.size} boundary vertices reached)`);
  const hull = order.length;
  for (let i = 0; i < pts.length; i++) if (!seen.has(i)) order.push(i);
  const remap = new Map(order.map((v, i) => [v, i]));
  const exact = order.map((i) => pts[i]);
  const vertices = exact.map((p) => [number(p[0]), number(p[1])] as [number, number]);
  exactVertices.set(vertices, exact);
  return { exact, vertices, triangles: counterClockwiseInSpineWorld(triangles.map((i) => remap.get(i) as number)), hull };
}
function polygons(vertices: readonly (readonly [number, number])[], triangles: readonly number[]): P[][] {
  const pts = exactVertices.get(vertices) ?? vertices.map(([x, y]) => point(x, y)), out: P[][] = [];
  for (let t = 0; t < triangles.length; t += 3) out.push(triangles.slice(t, t + 3).map((i) => pts[i]));
  return out;
}
function locate(p: P, vertices: readonly (readonly [number, number])[], triangles: readonly number[]): Correspondence | null {
  const pts = exactVertices.get(vertices) ?? vertices.map(([x, y]) => point(x, y));
  for (let t = 0; t < triangles.length; t += 3) {
    const indices = triangles.slice(t, t + 3), [a, b, c] = indices.map((i) => pts[i]), area = cross(a, b, c);
    const bary = [div(cross(b, c, p), area), div(cross(c, a, p), area), div(cross(a, b, p), area)];
    if (bary.every((v) => v[0] >= 0n)) return { indices, barycentric: bary.map(number) };
  }
  return null;
}
/** Subdivide ORIGINAL triangles at the driver rows, retaining their diagonal/UV partition. */
export function refineWaistMesh(old: LatticeMesh, rows: readonly number[]): LatticeMesh {
  let polys = polygons(old.vertices, old.triangles);
  for (const y of [...new Set(rows)]) polys = split(polys, [q(0n), q(1n), mul(q(-1n), decimal(y))]);
  const a = arrangement(polys);
  return { ...old, vertices: a.vertices, triangles: a.triangles, hull: a.hull };
}
export function waistCorrespondence(vertices: readonly (readonly [number, number])[], old: LatticeMesh): Correspondence[] {
  return vertices.map(([x, y], i) => {
    const hit = locate(exactVertices.get(vertices)?.[i] ?? point(x, y), old.vertices, old.triangles);
    if (hit === null) fail('RIG_WAIST_CORRESPONDENCE', 'topwear subdivision', `point [${x}, ${y}] is outside its original supplied triangle domain`);
    return hit;
  });
}
export const storedWorld = (bones: readonly RigBone[]): Map<string, BoneTransform> => computeWorldTransforms(bones.map((b) => ({ ...b, x: Math.fround(b.x), y: Math.fround(b.y), ...(b.rotation === undefined ? {} : { rotation: Math.fround(b.rotation) }) })));
export function nativePoint(weights: readonly WeightEntry[], world: ReadonlyMap<string, BoneTransform>): [number, number] {
  let x = 0, y = 0;
  for (const w of weights) { const p = toWorld(world.get(w.bone) as BoneTransform, Math.fround(w.x), Math.fround(w.y)); x += p[0] * Math.fround(w.weight); y += p[1] * Math.fround(w.weight); }
  return [x, y];
}
const interpolate = (map: Correspondence, values: readonly number[]): number => map.indices.reduce((s, v, i) => s + map.barycentric[i] * values[v], 0);
export interface WaistMapping { old: MeshAttachment; current: MeshAttachment; source: Correspondence[]; positions: Array<[number, number]>; maxRestResidual: number; maxUvStorageResidual: number }
const mappings = new WeakMap<MeshAttachment, WaistMapping>();
const bottomLayouts = new WeakMap<MeshAttachment, LatticeMesh>();
export const waistMappingOf = (mesh: MeshAttachment): WaistMapping | undefined => mappings.get(mesh);
export const waistBottomLayoutOf = (mesh: MeshAttachment): LatticeMesh | undefined => bottomLayouts.get(mesh);
/** Alternative1: inverse-bind the old native point, OFFSET6, then ordinary runtime f32. No image-dependent search. */
export function preserveWaistRest(old: MeshAttachment, oldLm: LatticeMesh, mesh: MeshAttachment, lm: LatticeMesh, world: ReadonlyMap<string, BoneTransform>, anchor: number): WaistMapping {
  const source = waistCorrespondence(lm.vertices, oldLm), before = old.weights.map((w) => nativePoint(w, world));
  let maxRestResidual = 0, maxUvStorageResidual = 0;
  for (let i = 0; i < source.length; i++) {
    const map = source[i], target: [number, number] = [interpolate(map, before.map((p) => p[0])), interpolate(map, before.map((p) => p[1]))];
    const original = oldLm.vertices.findIndex(([x, y]) => x === lm.vertices[i][0] && y === lm.vertices[i][1]);
    if (original >= 0 && lm.vertices[i][1] <= anchor) mesh.weights[i] = old.weights[original].map((w) => ({ ...w }));
    else mesh.weights[i] = mesh.weights[i].map((w) => { const p = toBoneLocal(world.get(w.bone) as BoneTransform, ...target); return { ...w, x: pyRound(p[0], 6), y: pyRound(p[1], 6) }; });
    for (const k of [0, 1]) {
      const uv = interpolate(map, old.weights.map((_, v) => old.uvs[2 * v + k]));
      mesh.uvs[2 * i + k] = uv;
      maxUvStorageResidual = Math.max(maxUvStorageResidual, Math.abs(Math.fround(uv) - uv));
    }
    const actual = nativePoint(mesh.weights[i], world);
    maxRestResidual = Math.max(maxRestResidual, Math.abs(actual[0] - target[0]), Math.abs(actual[1] - target[1]));
  }
  const mapping = { old, current: mesh, source, positions: lm.vertices, maxRestResidual, maxUvStorageResidual };
  mappings.set(mesh, mapping);
  return mapping;
}
/** Actual STORED per-bone moments, not independently recomputed distance shares or recapped weights. */
export function waistMoments(mesh: MeshAttachment, source: Correspondence): WeightEntry[] {
  const common = source.barycentric.findIndex((n) => n === 1);
  if (common >= 0 && source.barycentric.every((n, i) => i === common || n === 0)) return mesh.weights[source.indices[common]].map((w) => ({ ...w }));
  const moments = new Map<string, { w: number; x: number; y: number }>();
  source.indices.forEach((vi, k) => {
    const lambda = source.barycentric[k];
    if (lambda === 0) return;
    for (const v of mesh.weights[vi]) {
      const w = lambda * Math.fround(v.weight), m = moments.get(v.bone) ?? { w: 0, x: 0, y: 0 };
      m.w += w; m.x += w * Math.fround(v.x); m.y += w * Math.fround(v.y); moments.set(v.bone, m);
    }
  });
  return [...moments].filter(([, m]) => m.w > 0).map(([bone, m]) => ({ bone, weight: m.w, x: pyRound(m.x / m.w, 6), y: pyRound(m.y / m.w, 6) }));
}
/** Extend the top's actual triangle arrangement over the supplied bottom rectangle. No inferred waistband extent. */
export function waistBottomMesh(top: MeshAttachment, lm: LatticeMesh, topOrigin: readonly [number, number], bottom: RegionAttachment, bottomOrigin: readonly [number, number], size: readonly [number, number], lower: string, bones: readonly RigBone[]): MeshAttachment {
  const vertices = lm.vertices.map(([x, y]) => [x + topOrigin[0], y + topOrigin[1]] as [number, number]);
  exactVertices.set(vertices, (exactVertices.get(lm.vertices) ?? lm.vertices.map(([x,y])=>point(x,y))).map(([x,y])=>[add(x,decimal(topOrigin[0])),add(y,decimal(topOrigin[1]))]));
  const [ox, oy] = bottomOrigin, [w, h] = size;
  let polys: P[][] = [[point(ox, oy), point(ox + w, oy), point(ox + w, oy + h), point(ox, oy + h)]];
  const lines = new Map<string, Line>();
  for (const poly of polygons(vertices, top.triangles)) for (let i = 0; i < 3; i++) { const l = lineOf(poly[i], poly[(i + 1) % 3]); lines.set(lineKey(l), l); }
  for (const line of lines.values()) polys = split(polys, line);
  const a = arrangement(polys), world = storedWorld(bones);
  // A private frame evaluates the existing region centre/counterrotation through the coordinate door; never emitted.
  let marker = '__waist_region_frame';
  while (bones.some((b) => b.name === marker)) marker += '_';
  const regionWorld = computeWorldTransforms([...bones.map((b) => ({ ...b, x: Math.fround(b.x), y: Math.fround(b.y), ...(b.rotation === undefined ? {} : { rotation: Math.fround(b.rotation) }) })), { name: marker, parent: lower, x: bottom.x, y: bottom.y, rotation: bottom.rotation ?? 0 }]).get(marker) as BoneTransform;
  const weights = a.exact.map((p, i) => {
    const hit = locate(p, vertices, top.triangles);
    if (hit !== null) return waistMoments(top, hit);
    const [x, y] = a.vertices[i], target = toWorld(regionWorld, x - ox - w / 2, cropToSpineY(y - oy, h) - h / 2);
    const local = toBoneLocal(world.get(lower) as BoneTransform, ...target);
    return [{ bone: lower, x: pyRound(local[0], 6), y: pyRound(local[1], 6), weight: 1 }];
  });
  const mesh: MeshAttachment = { type: 'mesh', image: bottom.image, width: w, height: h, uvs: a.vertices.flatMap(([x, y]) => [(x - ox) / w, (y - oy) / h]), triangles: a.triangles, hull: a.hull, weights };
  bottomLayouts.set(mesh, { vertices: a.vertices.map(([x,y])=>[x-ox,y-oy]), triangles:a.triangles,hull:a.hull,loops:1,pinchedVertices:0,cells:polys.length,passes:0 });
  return mesh;
}

/** Targeted numeric deformation only. Sparse/odd runs are expanded against OLD per-influence indexing. */
export function remapWaistDeforms(motion: { animations: Record<string, unknown> }, targets: ReadonlyMap<string, WaistMapping>, regionTargets: ReadonlySet<string> = new Set(), beforeRebind: ReadonlyMap<string, string> = new Map()): void {
  const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  for (const [animation, value] of Object.entries(motion.animations)) {
    if (!record(value) || !Array.isArray(value.deform)) continue;
    if (!value.deform.some((t) => record(t) && (targets.has(`${String(t.skin ?? 'default')}/${String(t.slot)}/${String(t.attachment)}`) || regionTargets.has(`${String(t.skin ?? 'default')}/${String(t.slot)}/${String(t.attachment)}`)))) continue;
    const tracks: unknown[] = value.deform.map((t) => record(t) && targets.has(`${String(t.skin ?? 'default')}/${String(t.slot)}/${String(t.attachment)}`) && Array.isArray(t.keys) ? { ...t, keys: t.keys.map((k) => record(k) ? { ...k } : k) } : t);
    motion.animations[animation] = { ...value, deform: tracks };
    for (const track of tracks) {
      if (!record(track)) continue;
      const name = `${String(track.skin ?? 'default')}/${String(track.slot)}/${String(track.attachment)}`, map = targets.get(name);
      if (regionTargets.has(name)) fail('RIG_WAIST_DEFORM_REGION', `animation "${animation}" deform ${name}`, 'the authored bottomwear was a rigid region without a deform array; conversion cannot reinterpret an authored mesh timeline');
      if (map === undefined || !Array.isArray(track.keys)) continue;
      for (const key of track.keys) {
        if (!record(key)) continue;
        const object = `animation "${animation}" deform ${name} t=${String(key.t)}`;
        if (key.transform !== undefined) fail('RIG_WAIST_DEFORM_MODEL', object, 'whole-attachment transform on a subdivided waist mesh is not proven equivalent to the old evaluated field; supply a representable numeric old-topology run');
        if (key.vertices === undefined || key.vertices === null) continue;
        if (!Array.isArray(key.vertices) || !key.vertices.every((n): n is number => typeof n === 'number' && Number.isFinite(n))) fail('RIG_WAIST_DEFORM_RUN', object, 'requires a finite numeric old-topology run');
        const old = map.old.weights, offsets = [0];
        for (const v of old) offsets.push(offsets[offsets.length - 1] + 2 * v.length);
        if (key.offset !== undefined && key.fromVertex !== undefined) fail('RIG_WAIST_DEFORM_RUN', object, 'offset and fromVertex cannot coexist');
        const start = key.fromVertex === undefined ? key.offset ?? 0 : typeof key.fromVertex === 'number' ? offsets[key.fromVertex] : undefined;
        if (typeof start !== 'number' || !Number.isInteger(start) || start < 0 || start + key.vertices.length > offsets[offsets.length - 1] || key.vertices.length === 0) fail('RIG_WAIST_DEFORM_RUN', object, `old deform length is ${offsets[offsets.length - 1]}; sparse run start ${String(start)}, length ${key.vertices.length} does not fit`);
        const run = new Array<number>(offsets[offsets.length - 1]).fill(0);
        key.vertices.forEach((v, i) => { run[start + i] = Math.fround(v); });
        if (run.some((n) => n !== 0) && beforeRebind.has(name) && JSON.stringify(map.current.weights) !== beforeRebind.get(name)) fail('RIG_WAIST_DEFORM_REBIND', object, 'stops/turn changed the waist binding frames; old numeric local offsets have no proved rebind correspondence');
        const result: number[] = [];
        for (const [vi, source] of map.source.entries()) {
          const moments = new Map<string, [number, number]>();
          source.indices.forEach((oi, k) => old[oi].forEach((w, j) => {
            const n = source.barycentric[k] * Math.fround(w.weight), d = moments.get(w.bone) ?? [0, 0];
            d[0] += n * run[offsets[oi] + 2*j]; d[1] += n * run[offsets[oi] + 2*j + 1]; moments.set(w.bone, d);
          }));
          const bindings = map.current.weights[vi];
          for (const [bone, d] of moments) if (!bindings.some((w) => w.bone === bone) && (d[0] !== 0 || d[1] !== 0)) fail('RIG_WAIST_DEFORM_SUPPORT', object, `new vertex ${vi} has no "${bone}" influence but its old barycentric deform moment is [${d.join(', ')}]; arbitrary bone motion cannot carry that moment through another bone`);
          for (const w of bindings) { const d = moments.get(w.bone) ?? [0, 0]; result.push(d[0] / Math.fround(w.weight), d[1] / Math.fround(w.weight)); }
        }
        delete key.offset; delete key.fromVertex; key.vertices = result;
      }
    }
  }
}

/** Source-derived stations for an explicit, single-pivot waist candidate. */
export interface WaistPivotProfile {
  columns: number[];
  topRows: number[];
  centre: [number, number];
  lower: number;
  hem: number;
}
export interface WaistPivotRequest {
  top: string; bottom: string; upper: string; lower: string;
  bone: string; constraint: string;
  topOrigin: readonly [number, number]; bottomOrigin: readonly [number, number];
  canvas: readonly [number, number];
}
interface PivotArt { width: number; height: number; data: ArrayLike<number> }
export function waistPivotProfile(top: PivotArt, bottom: PivotArt, topOrigin: readonly [number, number], bottomOrigin: readonly [number, number]): WaistPivotProfile {
  for (const [name, art] of [['top', top], ['bottom', bottom]] as const) if (!Number.isSafeInteger(art.width) || !Number.isSafeInteger(art.height) || art.width < 1 || art.height < 1 || art.data.length !== art.width * art.height) fail('RIG_WAIST_PIVOT_SOURCE', name, 'requires the original nonempty alpha mask and integral dimensions');
  const columns: number[] = [], topRows: number[] = [];
  const painted = (a: PivotArt, origin: readonly [number, number], x: number, y: number): boolean => x >= origin[0] && x < origin[0] + a.width && y >= origin[1] && y < origin[1] + a.height && a.data[(y - origin[1]) * a.width + x - origin[0]] !== 0;
  let hem = -1;
  for (let y = 0; y < bottom.height; y++) for (let x = 0; x < bottom.width; x++) if (bottom.data[y * bottom.width + x] !== 0) hem = Math.max(hem, y + bottomOrigin[1]);
  for (let x = Math.max(topOrigin[0], bottomOrigin[0]); x < Math.min(topOrigin[0] + top.width, bottomOrigin[0] + bottom.width); x++) {
    let contact = false, first = -1;
    for (let y = bottomOrigin[1]; y < bottomOrigin[1] + bottom.height; y++) if (painted(bottom, bottomOrigin, x, y)) { if (first < 0) first = y; if (painted(top, topOrigin, x, y)) contact = true; }
    if (contact) { columns.push(x); topRows.push(first); }
  }
  if (columns.length === 0 || columns.some((x, i) => i > 0 && x !== columns[i - 1] + 1)) fail('RIG_WAIST_PIVOT_SOURCE', 'waist contact', `requires one contiguous original shared-alpha column run; found [${columns.join(',')}]`);
  const left = columns[0], right = columns.at(-1) as number, full = Math.max(...topRows);
  let lower = -1;
  for (let y = full + 1; y < hem; y++) {
    const xs: number[] = [];
    for (let x = bottomOrigin[0]; x < bottomOrigin[0] + bottom.width; x++) if (painted(bottom, bottomOrigin, x, y)) xs.push(x);
    if (xs.length > 0 && xs[0] < left && xs[xs.length - 1] > right) { lower = y; break; }
  }
  if (lower <= full || hem <= lower) fail('RIG_WAIST_PIVOT_SOURCE', 'waist lower span', `first full top row ${full}, first bilateral source expansion ${lower}, last painted hem ${hem}; require full < lower < hem, without a guessed band height`);
  const cx = (left + right + 1) / 2, centreColumn = Math.floor(cx), cy = topRows[columns.indexOf(centreColumn)];
  return { columns, topRows, centre: [cx, cy], lower, hem };
}
export interface WaistPivotResult {
  mesh: MeshAttachment; bone: RigBone; constraint: Record<string, unknown>;
  profile: WaistPivotProfile; mapping: WaistMapping; layout: LatticeMesh;
  anchorWorld: [number, number];
}
const pivots = new WeakMap<MeshAttachment, WaistPivotResult>();
export const waistPivotOf = (mesh: MeshAttachment): WaistPivotResult | undefined => pivots.get(mesh);
/** The explicit 4.3 rotate-to-rotate contract; missing properties are not rotation. */
export function waistPivotConstraint(name: string, source: string, bone: string): Record<string, unknown> {
  return { type: 'transform', name, source, bones: [bone], localSource: false, localTarget: false, additive: false,
    properties: { rotate: { to: { rotate: {} } } }, mixRotate: 1, mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 };
}
/** Rebind only the supplied bottom. Original top, bones, motion and art are not mutated. */
export function pivotWaistMesh(old: MeshAttachment, oldLm: LatticeMesh, topArt: PivotArt, bottomArt: PivotArt, bones: readonly RigBone[], request: WaistPivotRequest): WaistPivotResult {
  if (bones.some((b) => b.name === request.bone) || request.bone.length === 0 || request.constraint.length === 0) fail('RIG_WAIST_PIVOT_NAME', 'waist pivot', `bone "${request.bone}" must be new and constraint "${request.constraint}" nonempty`);
  const world = storedWorld(bones), upper = world.get(request.upper), lower = world.get(request.lower);
  // Eligibility measures the authored frame; inverse binding below keeps runtime arithmetic.
  const authored = computeExactFrameTransforms(bones), frames = [authored.get(request.upper), authored.get(request.lower)];
  if (upper === undefined || lower === undefined || frames.some((w) => w === undefined || w.a !== 1 || w.b !== 0 || w.c !== 0 || w.d !== 1)) fail('RIG_WAIST_PIVOT_FRAME', 'waist pivot', `requires declared unturned unit rest frames "${request.upper}"/"${request.lower}"; found authored ${JSON.stringify(frames)}; no constraint-blind inverse or baked animation adapter`);
  const profile = waistPivotProfile(topArt, bottomArt, request.topOrigin, request.bottomOrigin);
  const anchorWorld: [number, number] = [profile.centre[0] - request.canvas[0] / 2, cropToSpineY(profile.centre[1], request.canvas[1])];
  const local = toBoneLocal(upper, ...anchorWorld), bone: RigBone = { name: request.bone, parent: request.upper, x: pyRound(local[0], 6), y: pyRound(local[1], 6) };
  const layout = refineWaistMesh(oldLm, [profile.lower - request.bottomOrigin[1], profile.hem - request.bottomOrigin[1]]);
  const mesh: MeshAttachment = { ...old, uvs: [], triangles: layout.triangles, hull: layout.hull, weights: layout.vertices.map(([, y]) => {
    const t = pyRound(Math.max(0, Math.min(1, (y + request.bottomOrigin[1] - profile.lower) / (profile.hem - profile.lower))), 6);
    return [{ bone: request.bone, x: 0, y: 0, weight: 1 - t }, { bone: request.lower, x: 0, y: 0, weight: t }].filter((w) => w.weight > 0);
  }) };
  const mapping = preserveWaistRest(old, oldLm, mesh, layout, storedWorld([...bones, bone]), -Infinity);
  bottomLayouts.set(mesh, layout);
  const result = { mesh, bone, constraint: waistPivotConstraint(request.constraint, request.lower, request.bone), profile, mapping, layout, anchorWorld };
  pivots.set(mesh, result);
  return result;
}

export interface WaistCopyResult {
  mesh: MeshAttachment;
  layout: LatticeMesh;
  mapping: WaistMapping;
  profile: WaistPivotProfile;
  anchor: number;
  oldToNew: number[];
  upperTriangles: number[][];
  storage: WaistCopyStorage;
}
const copies = new WeakMap<MeshAttachment, WaistCopyResult>();
export const waistCopyOf = (mesh: MeshAttachment): WaistCopyResult | undefined => copies.get(mesh);

/** The original stored UV field is the source domain; no regenerated lattice. */
export function suppliedWaistLayout(mesh: MeshAttachment): LatticeMesh {
  const vertices = mesh.weights.map((_, i) => [mesh.uvs[2*i] * mesh.width, mesh.uvs[2*i+1] * mesh.height] as [number, number]);
  return { vertices, triangles: mesh.triangles, hull: mesh.hull, loops: 1, pinchedVertices: 0, cells: 0, passes: 0 };
}
function copyPoints(profile: WaistPivotProfile, origin: readonly [number, number]): P[] {
  return profile.columns.map((x, i) => point(x + 0.5 - origin[0], profile.topRows[i] - origin[1]));
}
function copyLine(x: Q, points: readonly P[]): Line {
  if (sub(x, points[0][0])[0] <= 0n) return [q(0n), q(1n), mul(q(-1n), points[0][1])];
  for (let i = 1; i < points.length; i++) if (sub(x, points[i][0])[0] <= 0n) return lineOf(points[i-1], points[i]);
  return [q(0n), q(1n), mul(q(-1n), points.at(-1)![1])];
}
function copyHeight(x: number, points: readonly P[]): number {
  const l = copyLine(decimal(x), points);
  return number(div(mul(q(-1n), add(mul(l[0], decimal(x)), l[2])), l[1]));
}
/** Stronger than painted-cell sampling: no mixed triangle has positive area below C. */
export function waistCopyCoverage(vertices: readonly (readonly [number, number])[], triangles: readonly number[], onlyWaist: readonly boolean[], profile: WaistPivotProfile, origin: readonly [number, number]): { mixedTriangles: number[] } {
  const pts = exactVertices.get(vertices) ?? vertices.map(([x,y]) => point(x,y)), points = copyPoints(profile, origin), mixedTriangles: number[] = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const ids = triangles.slice(t,t+3);
    if (ids.every(i => onlyWaist[i])) continue;
    const poly = ids.map(i => pts[i]), xs = poly.map(p => p[0]).sort((a,b) => sub(a,b)[0] < 0n ? -1 : sub(a,b)[0] > 0n ? 1 : 0);
    const cuts = [xs[0], ...points.map(p => p[0]).filter(x => sub(x,xs[0])[0] > 0n && sub(x,xs[2])[0] < 0n), xs[2]];
    for (let i = 1; i < cuts.length; i++) {
      let region = clip(poly, [q(1n),q(0n),mul(q(-1n),cuts[i-1])], 1n);
      region = clip(region, [q(1n),q(0n),mul(q(-1n),cuts[i])], -1n);
      region = clip(region, copyLine(div(add(cuts[i-1],cuts[i]),q(2n)),points), 1n);
      if (twiceArea(region)[0] !== 0n) { mixedTriangles.push(t/3); break; }
    }
  }
  return { mixedTriangles };
}

/** Actual runtime source UVs, kept as exact binary values for the coverage proof. */
export function nativeWaistCopyCoverage(uvs: readonly number[], triangles: readonly number[], onlyWaist: readonly boolean[], width: number, height: number, profile: WaistPivotProfile, origin: readonly [number, number]): { mixedTriangles: number[] } {
  if(uvs.length!==2*onlyWaist.length)fail('RIG_WAIST_COPY_COVERAGE','native copy field','source UV/support populations differ');
  const exact:P[]=onlyWaist.map((_,i)=>[mul(binary(uvs[2*i]),q(BigInt(width))),mul(binary(uvs[2*i+1]),q(BigInt(height)))]);
  const vertices=exact.map(p=>p.map(number) as [number,number]);exactVertices.set(vertices,exact);
  return waistCopyCoverage(vertices,triangles,onlyWaist,profile,origin);
}

export interface WaistCopyStorage {
  normalizedCellBound: number;
  sourceXBound: number;
  sourceYBound: number;
  maxSlope: number;
  inward: number;
}
/**
 * Core's f32 spelling and its input round to the SAME binary32. On [0,1],
 * a complete rounding cell is at most 2^-23 wide (including the cell at 1).
 * Thus |dx|<=width*2^-23 and |dy|<=height*2^-23. For Lipschitz C with
 * constant L, y<=C(x)-(dyBound+L*dxBound) implies stored y'<=C(x').
 * This moves support inward; it does not relax the proof's original C.
 */
export function waistCopyStorage(profile: WaistPivotProfile, width: number, height: number): WaistCopyStorage {
  const normalizedCellBound=2**-23;
  const maxSlope=Math.max(0,...profile.topRows.slice(1).map((y,i)=>Math.abs(y-profile.topRows[i])/(profile.columns[i+1]-profile.columns[i])));
  const sourceXBound=width*normalizedCellBound,sourceYBound=height*normalizedCellBound;
  return{normalizedCellBound,sourceXBound,sourceYBound,maxSlope,inward:sourceYBound+maxSlope*sourceXBound};
}
/** Verify the precondition exactly for EVERY actual UV, including arithmetic before f32. */
export function waistCopyStorageViolations(vertices: readonly (readonly [number,number])[], uvs: readonly number[], width: number, height: number): number[] {
  const pts=exactVertices.get(vertices)??vertices.map(([x,y])=>point(x,y)),outside:number[]=[];
  for(let i=0;i<pts.length;i++)for(const k of[0,1]){
    const uv=uvs[2*i+k],size=k===0?width:height;
    if(!Number.isFinite(uv)||uv<0||uv>1){outside.push(i);break;}
    const delta=sub(mul(binary(f32(uv)),q(BigInt(size))),pts[i][k]);
    const abs=q(delta[0]<0n?-delta[0]:delta[0],delta[1]);
    if(sub(abs,q(BigInt(size),1n<<23n))[0]>0n){outside.push(i);break;}
  }
  return outside;
}

/** Only lower polygons are subdivided. Interface points are propagated below A. */
function copyArrangement(old: LatticeMesh, anchor: number, points: readonly P[]): Arrangement {
  const upper: P[][] = [], blend: P[][] = [], lower: P[][] = [];
  const floor = points.reduce((a,p) => sub(p[1],a)[0] < 0n ? p[1] : a, points[0][1]);
  const horizontal: Line = [q(0n),q(1n),mul(q(-1n),floor)];
  for (const poly of polygons(old.vertices,old.triangles)) {
    const ys = poly.map(p => number(p[1]));
    if (Math.max(...ys) <= anchor) { upper.push(poly); continue; }
    if (Math.min(...ys) < anchor) fail('RIG_WAIST_COPY_SOURCE', 'stored upper boundary', `triangle ${JSON.stringify(poly.map(p=>p.map(number)))} crosses existing row ${anchor}; no upper field refinement is allowed`);
    for (const part of split([poly],horizontal)) {
      if (part.every(p => sub(p[1],floor)[0] >= 0n)) lower.push(part); else blend.push(part);
    }
  }
  let slabs = lower;
  for (const p of points) slabs = split(slabs,[q(1n),q(0n),mul(q(-1n),p[0])]);
  const below = slabs.flatMap(poly => {
    const x = div(poly.reduce((sum,p)=>add(sum,p[0]),q(0n)),q(BigInt(poly.length)));
    return split([poly],copyLine(x,points));
  });
  const interfacePoints = new Map<string,P>();
  for (const poly of below) for (const p of poly) if (sub(p[1],floor)[0] === 0n) interfacePoints.set(key(p),p);
  const stitched = blend.map(poly => poly.flatMap((p,i) => {
    const next=poly[(i+1)%poly.length];
    if (sub(p[1],floor)[0] !== 0n || sub(next[1],floor)[0] !== 0n) return [p];
    const direction=sub(next[0],p[0])[0];
    const inside=[...interfacePoints.values()].filter(v=>sub(v[0],p[0])[0]*direction>0n && sub(next[0],v[0])[0]*direction>0n);
    inside.sort((a,b)=>sub(a[0],b[0])[0]*direction<0n?-1:sub(a[0],b[0])[0]*direction>0n?1:0);
    return [p,...inside];
  }));
  return arrangement([...upper,...stitched,...below]);
}

/** Transfer only the supplied top to an existing waist frame, preserving original moments. */
export function sharedWaistCopy(old: MeshAttachment, topArt: PivotArt, bottomArt: PivotArt, bones: readonly RigBone[], request: WaistPivotRequest): WaistCopyResult {
  const world=storedWorld(bones),W=world.get(request.bone),oldLm=suppliedWaistLayout(old),profile=waistPivotProfile(topArt,bottomArt,request.topOrigin,request.bottomOrigin),originalPoints=copyPoints(profile,request.topOrigin),storage=waistCopyStorage(profile,old.width,old.height);
  const points:P[]=originalPoints.map(p=>[p[0],sub(p[1],binary(storage.inward))]);
  if (W===undefined || old.weights.some(ws=>ws.some(w=>w.bone===request.bone))) fail('RIG_WAIST_COPY_FRAME','shared waist copy',`existing frame "${request.bone}" is required and original top must not already use it`);
  const authored=computeExactFrameTransforms(bones);
  for(const name of[request.upper,request.lower,request.bone]){const f=authored.get(name);if(!f||f.a!==1||f.b!==0||f.c!==0||f.d!==1)fail('RIG_WAIST_COPY_FRAME','shared waist copy',`requires original authored unit rest frame "${name}", found ${JSON.stringify(f)}`);}
  const first=Math.min(...profile.topRows)-request.topOrigin[1],rows=oldLm.vertices.map(p=>p[1]).filter(y=>y<first);
  if (!rows.length) fail('RIG_WAIST_COPY_SOURCE','shared waist copy',`no existing source row strictly above copy edge ${first+request.topOrigin[1]}`);
  const anchor=Math.max(...rows),a=copyArrangement(oldLm,anchor,points),layout={...oldLm,vertices:a.vertices,triangles:a.triangles,hull:a.hull};
  if(Math.min(...points.map(p=>number(p[1])))<=anchor)fail('RIG_WAIST_COPY_SOURCE','copy storage support',`derived inward boundary no longer lies above existing upper anchor ${anchor}`);
  const oldIds=new Map(oldLm.vertices.map((p,i)=>[key(point(...p)),i])),oldToNew=oldLm.vertices.map(()=>-1),source:Correspondence[]=[],before=old.weights.map(ws=>nativePoint(ws,world)),uvs:number[]=[],weights:WeightEntry[][]=[],positions=layout.vertices;
  let maxRestResidual=0,maxUvStorageResidual=0;
  for (let i=0;i<a.exact.length;i++) {
    const p=a.exact[i],original=oldIds.get(key(p)),hit=original===undefined?locate(p,oldLm.vertices,oldLm.triangles):{indices:[original],barycentric:[1]};
    if (hit===null) fail('RIG_WAIST_COPY_SOURCE','shared waist copy',`derived point ${JSON.stringify(p.map(number))} is outside original triangles`);
    source.push(hit);if(original!==undefined)oldToNew[original]=i;
    const target:[number,number]=[interpolate(hit,before.map(p=>p[0])),interpolate(hit,before.map(p=>p[1]))];
    const x=number(p[0]),y=number(p[1]),edge=copyHeight(x,points),l=copyLine(p[0],points);
    const t=y<=anchor?0:at(l,p)[0]>=0n?1:(y-anchor)/(edge-anchor),s=t*t*(3-2*t),moments=waistMoments(old,hit);
    const local=toBoneLocal(W,...target);
    const bound=original!==undefined&&y<=anchor?old.weights[original].map(w=>({...w})):s===0?moments:[...moments.map(w=>({...w,weight:w.weight*(1-s)})).filter(w=>w.weight>0),{bone:request.bone,x:pyRound(local[0],6),y:pyRound(local[1],6),weight:s}];
    weights.push(bound);
    for(const axis of[0,1]){const uv=original===undefined?interpolate(hit,old.weights.map((_,v)=>old.uvs[2*v+axis])):old.uvs[2*original+axis];uvs.push(uv);maxUvStorageResidual=Math.max(maxUvStorageResidual,Math.abs(Math.fround(uv)-uv));}
    const actual=nativePoint(bound,world);maxRestResidual=Math.max(maxRestResidual,Math.abs(actual[0]-target[0]),Math.abs(actual[1]-target[1]));
  }
  if(oldToNew.some(i=>i<0))fail('RIG_WAIST_COPY_SOURCE','shared waist copy','an original support vertex was lost');
  const storageOutside=waistCopyStorageViolations(positions,uvs,old.width,old.height);
  if(storageOutside.length)fail('RIG_WAIST_COPY_COVERAGE','copy storage contract',`source UV vertex(s) ${storageOutside.join(',')} exceed the core float32 rounding-cell bound`);
  const mesh:MeshAttachment={...old,uvs,weights,triangles:a.triangles,hull:a.hull},proof=waistCopyCoverage(positions,a.triangles,weights.map(ws=>ws.length===1&&ws[0].bone===request.bone&&ws[0].weight===1),profile,request.topOrigin);
  if(proof.mixedTriangles.length)fail('RIG_WAIST_COPY_COVERAGE','shared waist copy',`non-W triangle(s) ${proof.mixedTriangles.join(',')} overlap copy support below source C`);
  const upperTriangles:number[][]=[];
  for(let t=0;t<old.triangles.length;t+=3){const ids=old.triangles.slice(t,t+3);if(ids.every(i=>oldLm.vertices[i][1]<=anchor))upperTriangles.push(ids);}
  const actualTriangles=new Set(Array.from({length:a.triangles.length/3},(_,t)=>a.triangles.slice(3*t,3*t+3).sort((x,y)=>x-y).join(',')));
  for(const ids of upperTriangles)if(!actualTriangles.has(ids.map(i=>oldToNew[i]).sort((x,y)=>x-y).join(',')))fail('RIG_WAIST_COPY_SOURCE','upper field',`original triangle [${ids.join(',')}] was changed above row ${anchor}`);
  for(let i=0;i<old.weights.length;i++)if(oldLm.vertices[i][1]<=anchor){const n=oldToNew[i];if(JSON.stringify(old.weights[i])!==JSON.stringify(weights[n])||old.uvs[2*i]!==uvs[2*n]||old.uvs[2*i+1]!==uvs[2*n+1])fail('RIG_WAIST_COPY_SOURCE','upper field',`original vertex ${i} binding or UV changed above row ${anchor}`);}
  const mapping={old,current:mesh,source,positions,maxRestResidual,maxUvStorageResidual},result={mesh,layout,mapping,profile,anchor:anchor+request.topOrigin[1],oldToNew,upperTriangles,storage};
  mappings.set(mesh,mapping);copies.set(mesh,result);return result;
}
