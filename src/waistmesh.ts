/** Source-space waist subdivision. Exact predicates identify shared edges; emitted bindings keep OFFSET6/f32. */
import { computeWorldTransforms, cropToSpineY, toBoneLocal, toWorld, type BoneTransform } from './coords.ts';
import { PartsError } from './errors.ts';
import { counterClockwiseInSpineWorld, type LatticeMesh } from './mesh.ts';
import type { MeshAttachment, RegionAttachment, RigBone, WeightEntry } from './rig.ts';
import { pyRound } from './round.ts';

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
