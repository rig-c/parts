/** Opt-in scalar boundary projection. No sheet, anchor or art is rewritten. */
import { extendDepthSilhouette, sampleDepthFloat, type PartDepthReference } from './depthsheets.ts';
import { PartsError } from './errors.ts';
import type { Raster } from './raster/types.ts';

export type BoundaryDepths = Record<string, { neighbour: string; band: string }>;
type Part = { name: string; x: number; y: number; w: number; h: number; depth?: PartDepthReference };
type Point = readonly [number, number];
type Edge = readonly [Point, Point];

/** Alpha support is the union of closed native pixel cells with alpha > 0.
 * Projection is onto shared cell edges, not an inferred seam width. Distinct
 * equidistant projections contribute once each, with their arithmetic mean.
 * Outside the band the original extended target sample is returned exactly.
 */
export function boundaryDepthSamplers(
  declarations: BoundaryDepths | undefined,
  parts: readonly Part[],
  images: ReadonlyMap<string, Raster>,
  roles: Readonly<Record<string, string>>,
  prefix: string,
): Map<string, (x: number, y: number) => number> {
  const result = new Map<string, (x: number, y: number) => number>();
  if (declarations === undefined || Object.keys(declarations).length === 0) return result;
  const records = new Map(parts.map(p => [p.name, p]));
  const fail = (target: string, detail: string): never => {
    throw new PartsError([{ code: 'RIG_TURN_BOUNDARY_DEPTH', object: `${prefix}.boundaryDepths.${target}`, detail }]);
  };
  const support = (p: Part, art: Raster, x: number, y: number): boolean => {
    const u = x - p.x, v = y - p.y;
    return Number.isInteger(u) && Number.isInteger(v) && u >= 0 && v >= 0 && u < p.w && v < p.h && art.data[(v * art.width + u) * 4 + 3] > 0;
  };
  const contains = (p: Part, art: Raster, x: number, y: number): boolean => {
    for (const u of new Set([Math.floor(x), Math.ceil(x) - 1])) for (const v of new Set([Math.floor(y), Math.ceil(y) - 1])) if (support(p, art, u, v)) return true;
    return false;
  };
  for (const target of Object.keys(declarations)) {
    const seen = new Set<string>();
    for (let next: string | undefined = target; next !== undefined; next = declarations[next]?.neighbour) {
      if (seen.has(next)) fail(target, `cycle reaches "${next}"; remove reciprocal or cyclic boundary declarations`);
      seen.add(next);
    }
  }
  for (const [target, declaration] of Object.entries(declarations)) {
    const p = records.get(target), n = records.get(declaration.neighbour), b = records.get(declaration.band);
    for (const [field, record] of [['target', p], ['neighbour', n], ['band', b]] as const) if (record === undefined) fail(target, `${field} "${field === 'target' ? target : declaration[field]}" names no parts.json part; use an exact existing part name`);
    // The loop above has checked all three records; keep the type narrowing explicit.
    if (p === undefined || n === undefined || b === undefined) continue;
    if (target === n.name || roles[target] !== 'surface' || roles[n.name] !== 'surface') fail(target, `"${target}" and neighbour "${n.name}" require different surface parts in this same turn group`);
    const pa = images.get(p.name), na = images.get(n.name), ba = images.get(b.name);
    const ps = p.depth === undefined ? undefined : images.get(p.depth.image), ns = n.depth === undefined ? undefined : images.get(n.depth.image);
    if (pa === undefined || na === undefined || ba === undefined || ps === undefined || ns === undefined || p.depth === undefined || n.depth === undefined) fail(target, `target "${target}", neighbour "${n.name}" and band "${b.name}" require resolved art and both original surface sheets`);
    if (pa === undefined || na === undefined || ba === undefined || ps === undefined || ns === undefined || p.depth === undefined || n.depth === undefined) continue;
    if (p.depth.near !== n.depth.near || p.depth.zScale !== n.depth.zScale) fail(target, `neighbour "${n.name}" requires the target's near and zScale in this turn group`);
    const edges: Edge[] = [];
    let overlap = false;
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
      if (!support(p, pa, x, y)) continue;
      if (support(n, na, x, y)) overlap = true;
      if (support(n, na, x - 1, y)) edges.push([[x, y], [x, y + 1]]);
      if (support(n, na, x + 1, y)) edges.push([[x + 1, y], [x + 1, y + 1]]);
      if (support(n, na, x, y - 1)) edges.push([[x, y], [x + 1, y]]);
      if (support(n, na, x, y + 1)) edges.push([[x, y + 1], [x + 1, y + 1]]);
    }
    if (overlap || edges.length === 0) fail(target, `neighbour "${n.name}" does not abut without overlap along opaque pixel-cell edges; declare an abutting surface`);
    let count = 0;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (support(b, ba, x, y)) {
      count++;
      if (!support(p, pa, x, y)) fail(target, `band "${b.name}" has support outside target "${target}" at [${x},${y}]; require contained alpha support`);
    }
    if (count === 0 || !edges.some(([a, z]) => contains(b, ba, (a[0] + z[0]) / 2, (a[1] + z[1]) / 2))) fail(target, `band "${b.name}" is empty or does not reach the shared boundary with "${n.name}"; require a nonempty boundary-reaching band`);
    const original = extendDepthSilhouette(ps, pa), neighbour = extendDepthSilhouette(ns, na);
    const seeds: Point[] = [];
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (support(p, pa, x, y)) seeds.push([x + 0.5, y + 0.5]);
    result.set(target, (x, y) => {
      const rawX = x, rawY = y;
      // Transparent silhouette/PAD samples inherit their nearest opaque target
      // cell, just as the original scalar extension does. This also retains
      // boundary ownership when setup float encoding lands just outside art.
      if (!contains(p, pa, x, y)) {
        let nearest = Infinity;
        for (const q of seeds) {
          const d = (q[0] - rawX) ** 2 + (q[1] - rawY) ** 2;
          if (d < nearest) { nearest = d; x = q[0]; y = q[1]; }
        }
      }
      if (!contains(b, ba, x, y)) return sampleDepthFloat(original, rawX - p.x, rawY - p.y);
      let distance = Infinity;
      const closest = new Map<string, Point>();
      for (const [a, z] of edges) {
        const q: Point = [Math.max(a[0], Math.min(z[0], x)), Math.max(a[1], Math.min(z[1], y))];
        const d = (q[0] - x) ** 2 + (q[1] - y) ** 2;
        if (d < distance) { closest.clear(); distance = d; }
        if (d === distance) closest.set(`${q[0]},${q[1]}`, q);
      }
      let sum = 0;
      for (const q of closest.values()) sum += sampleDepthFloat(neighbour, q[0] - n.x, q[1] - n.y);
      return sum / closest.size;
    });
  }
  return result;
}
