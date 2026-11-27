/** Opt-in scalar boundary projection. No sheet, anchor or art is rewritten. */
import { extendDepthSilhouette, sampleDepthFloat, type PartDepthReference } from './depthsheets.ts';
import type { Problem } from './errors.ts';
import type { Raster } from './raster/types.ts';

export type BoundaryDepthContact = 'overlap';
export type BoundaryDepths = Record<string, { neighbour: string; band: string; contact?: BoundaryDepthContact }>;
type Part = { name: string; x: number; y: number; w: number; h: number; depth?: PartDepthReference };
type Point = readonly [number, number];
type Edge = readonly [Point, Point];

/** Alpha support is the union of closed native pixel cells with alpha > 0.
 * Under default abutting contact, projection is onto shared cell edges without
 * overlap. Under `contact: "overlap"`, band samples inside the closed overlap
 * cells read the extended original neighbour sheet at the same world point and
 * band samples outside the overlap project onto the neighbour's outline inside
 * (or abutting) the target. Distinct equidistant projections contribute once
 * each, with their arithmetic mean. Outside the band the original extended
 * target sample is returned exactly.
 */
export function boundaryDepthSamplers(
  declarations: BoundaryDepths | undefined,
  parts: readonly Part[],
  images: ReadonlyMap<string, Raster>,
  roles: Readonly<Record<string, string>>,
  prefix: string,
): { samplers: Map<string, (x: number, y: number) => number>; problems: Problem[] } {
  const samplers = new Map<string, (x: number, y: number) => number>();
  const problems: Problem[] = [], result = { samplers, problems };
  if (declarations === undefined || Object.keys(declarations).length === 0) return result;
  const records = new Map(parts.map(p => [p.name, p]));
  const fail = (target: string, detail: string): void => {
    problems.push({ code: 'RIG_TURN_BOUNDARY_DEPTH', object: `${prefix}.boundaryDepths.${target}`, detail });
  };
  const support = (p: Part, art: Raster, x: number, y: number): boolean => {
    const u = x - p.x, v = y - p.y;
    return Number.isInteger(u) && Number.isInteger(v) && u >= 0 && v >= 0 && u < p.w && v < p.h && art.data[(v * art.width + u) * 4 + 3] > 0;
  };
  const both = (p: Part, pa: Raster, n: Part, na: Raster, x: number, y: number): boolean => support(p, pa, x, y) && support(n, na, x, y);
  const contains = (p: Part, art: Raster, x: number, y: number): boolean => {
    for (const u of new Set([Math.floor(x), Math.ceil(x) - 1])) for (const v of new Set([Math.floor(y), Math.ceil(y) - 1])) if (support(p, art, u, v)) return true;
    return false;
  };
  const containsOverlap = (p: Part, pa: Raster, n: Part, na: Raster, x: number, y: number): boolean => {
    for (const u of new Set([Math.floor(x), Math.ceil(x) - 1])) for (const v of new Set([Math.floor(y), Math.ceil(y) - 1])) if (both(p, pa, n, na, u, v)) return true;
    return false;
  };
  const cyclic = new Set<string>();
  for (const target of Object.keys(declarations)) {
    const seen = new Set<string>();
    for (let next: string | undefined = target; next !== undefined; next = declarations[next]?.neighbour) {
      if (seen.has(next)) { fail(target, `cycle reaches "${next}"; remove reciprocal or cyclic boundary declarations`); cyclic.add(target); break; }
      seen.add(next);
    }
  }
  for (const [target, declaration] of Object.entries(declarations)) {
    const startProblems = problems.length;
    const wantOverlap = declaration.contact === 'overlap';
    const p = records.get(target), n = records.get(declaration.neighbour), b = records.get(declaration.band);
    for (const [field, record] of [['target', p], ['neighbour', n], ['band', b]] as const) if (record === undefined) fail(target, `${field} "${field === 'target' ? target : declaration[field]}" names no parts.json part; use an exact existing part name`);
    if (p !== undefined && n !== undefined && (target === n.name || roles[target] !== 'surface' || roles[n.name] !== 'surface')) fail(target, `"${target}" and neighbour "${n.name}" require different surface parts in this same turn group`);
    const pa = p === undefined ? undefined : images.get(p.name), na = n === undefined ? undefined : images.get(n.name), ba = b === undefined ? undefined : images.get(b.name);
    const ps = p?.depth === undefined ? undefined : images.get(p.depth.image), ns = n?.depth === undefined ? undefined : images.get(n.depth.image);
    if (p !== undefined && n !== undefined && b !== undefined && (pa === undefined || na === undefined || ba === undefined || ps === undefined || ns === undefined || p.depth === undefined || n.depth === undefined)) fail(target, `target "${target}", neighbour "${n.name}" and band "${b.name}" require resolved art and both original surface sheets`);
    if (p?.depth !== undefined && n?.depth !== undefined && (p.depth.near !== n.depth.near || p.depth.zScale !== n.depth.zScale)) fail(target, `neighbour "${n.name}" requires the target's near and zScale in this turn group`);
    const edges: Edge[] = [];
    const overlapCells: Point[] = [];
    let overlap = false;
    const canAbut = p !== undefined && n !== undefined && pa !== undefined && na !== undefined;
    if (canAbut) {
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
        if (!support(p, pa, x, y)) continue;
        if (support(n, na, x, y)) {
          overlap = true;
          overlapCells.push([x, y]);
        } else {
          if (support(n, na, x - 1, y)) edges.push([[x, y], [x, y + 1]]);
          if (support(n, na, x + 1, y)) edges.push([[x + 1, y], [x + 1, y + 1]]);
          if (support(n, na, x, y - 1)) edges.push([[x, y], [x + 1, y]]);
          if (support(n, na, x, y + 1)) edges.push([[x, y + 1], [x + 1, y + 1]]);
        }
      }
      if (!wantOverlap && (overlap || edges.length === 0)) fail(target, `neighbour "${n.name}" does not abut without overlap along opaque pixel-cell edges; declare contact: "overlap" or an abutting surface`);
      if (wantOverlap && !overlap) fail(target, `neighbour "${n.name}" has no overlapping opaque pixel cells with "${target}"; remove contact: "overlap" or supply overlapping art`);
    }
    // Containment depends on target/band art, not on neighbour depth or abutment.
    // Report the first outside cell once; the remaining declarations still run.
    if (p !== undefined && b !== undefined && pa !== undefined && ba !== undefined) {
      let count = 0, outside = false, bandOutsideOverlap = false;
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (support(b, ba, x, y)) {
        count++;
        if (!outside && !support(p, pa, x, y)) { fail(target, `band "${b.name}" has support outside target "${target}" at [${x},${y}]; require contained alpha support`); outside = true; }
        else if (canAbut && support(p, pa, x, y) && !support(n, na, x, y)) bandOutsideOverlap = true;
      }
      // A missing shared edge cannot establish whether an otherwise valid band
      // reaches it; retain the abutment failure instead of cascading a refusal.
      if (!wantOverlap) {
        if (n !== undefined && (count === 0 || (canAbut && !overlap && edges.length > 0 && !edges.some(([a, z]) => contains(b, ba, (a[0] + z[0]) / 2, (a[1] + z[1]) / 2))))) fail(target, `band "${b.name}" is empty or does not reach the shared boundary with "${n.name}"; require a nonempty boundary-reaching band`);
      } else if (n !== undefined) {
        const missed = overlapCells.find(([ox, oy]) => !support(b, ba, ox, oy));
        if (missed !== undefined) fail(target, `band "${b.name}" misses overlap cell [${missed[0]},${missed[1]}] with "${n.name}"; cover every overlapping pixel cell`);
        else if (count === 0) fail(target, `band "${b.name}" is empty or does not reach the shared boundary with "${n.name}"; require a nonempty boundary-reaching band`);
        if (canAbut && overlap && bandOutsideOverlap && edges.length === 0) fail(target, `band "${b.name}" extends outside the overlap with "${n.name}" where no neighbour boundary crosses "${target}"; restrict the band to the overlap`);
      }
    }
    // Cycles prevent sampler emission, not independent declaration checks.
    if (cyclic.has(target) || problems.length > startProblems || p === undefined || n === undefined || b === undefined || pa === undefined || na === undefined || ba === undefined || ps === undefined || ns === undefined || p.depth === undefined || n.depth === undefined) continue;
    const original = extendDepthSilhouette(ps, pa), neighbour = extendDepthSilhouette(ns, na);
    const seeds: Point[] = [];
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (support(p, pa, x, y)) seeds.push([x + 0.5, y + 0.5]);
    samplers.set(target, (x, y) => {
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
      if (wantOverlap && containsOverlap(p, pa, n, na, x, y)) return sampleDepthFloat(neighbour, x - n.x, y - n.y);
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
