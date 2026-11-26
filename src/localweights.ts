/**
 * Local deformation regions' weights (issue #84, step 2): a declared region
 * takes a share of a vertex for its own control bone, and the rest of the
 * vertex is shared among the mesh's segment bones by `influences()`
 * (`src/weights.ts`) exactly as the lattice shares it.
 *
 * ## The falloff, as a definition
 *
 * The nominal linear share is
 *
 *     g = 1                      inside the region (its boundary included)
 *     g = 1 − d / band           at a distance d from the region, 0 < d < band
 *     g = 0                      at d ≥ band (for band 0: everywhere outside)
 *
 * where d is the Euclidean distance to the circle (|p − c| − r) or to the
 * nearest point of the polygon's edges. The two decisions that are not a value in
 * between — "inside" (g = 1) and "at or past the band" (g = 0) — are made
 * EXACTLY: every region number is a multiple of 1/256 px (the config loader
 * refuses anything else) and every vertex this package writes is too
 * (`src/contour.ts`'s grid, moved by a whole-pixel offset), so both run on
 * integers — squared distances compared without a square root, the polygon's
 * inside by the crossing rule on integer orientations, its distance to an edge
 * compared squared in `BigInt`. Only a value strictly in between is computed
 * in doubles (`Math.sqrt` and the reference's segment arithmetic), and it is
 * clamped to [0, 1]. Contour weighting applies `4 * g * g * (1 - g)` for
 * `0 < g < 0.5` after the overlap check (issue #1578). The cubic reaches the
 * cutoff with zero slope and meets the inner half at the same value and slope.
 * Declaring `falloff: 'linear'` keeps the nominal share throughout the band,
 * as automatic weighting does.
 *
 * ## The vertex's weights (see {@link localInfluences})
 *
 * With `S = influences(p, segments, r, limits, exponent)` — today's, under the
 * mesh's declared exponent (issue #161; 2 where none is declared). The
 * cap and the floor are `limits`: `MAX_INFLUENCES` (4) and `MIN_WEIGHT`
 * (0.03) for the contour mode, the author's `influences` for the automatic
 * mode (issue #126, P19):
 *
 * - **no region reaches the vertex** (every g = 0): the weights are `S`, and
 *   the rig stage rounds them exactly as the lattice does — a contour mesh
 *   with no region is weighted as the lattice would weight the same points;
 * - **g = 1**: the region's bone alone, weight 1;
 * - **0 < g < 1**: the region's bone takes g and the segment bones share
 *   1 − g in `S`'s proportions. A region bone that is also a segment bone
 *   takes g + (1 − g)·S(bone), one entry. **The cap:** when the region's bone
 *   is not in `S` and `S` already holds the cap's count of bones, `S`'s
 *   lightest bone (its last) is dropped and the rest renormalised before the
 *   scaling, so g itself is never cut. **The floor:** the minimum weight is
 *   applied inside `S` (as today) and not again to the scaled shares — a
 *   share (1 − g)·S(b) under 0.03 is part of the blend, and dropping it would
 *   put a step into the ramp.
 *   The rounding: see `roundShares` in `src/rig.ts`.
 *
 * ## Overlapping regions
 *
 * Refused where it would decide a weight: a vertex that two regions both give
 * g > 0 is named, with both regions and both g (`RIG_CONTOUR_REGIONS_OVERLAP`
 * in the rig stage). Rejected: (a) a geometric test that two supports
 * (region ∪ band) are disjoint — exact for two circles, but for a polygon the
 * band's outer edge is a curve at every convex corner, and comparing it with
 * another region is a sum of square roots, not decidable exactly on the grid;
 * (b) a combination (a sum renormalised when it passes 1, or the larger g) —
 * definable, but either rewrites the declared g = 1 inside one region wherever
 * another's band reaches it. The rule as tested is what the weights need:
 * each vertex holds one region's falloff. Two supports that overlap only
 * between vertices are not refused, and there the mesh interpolates between
 * vertices that each hold one region.
 */
import type { ContourRegionSpec, Point } from './config.ts';
import { GRID } from './contour.ts';
import { DEFAULT_LIMITS, DISTANCE_EXPONENT, type Influence, influences, type InfluenceLimits, type Segment, segmentDistance } from './weights.ts';

/**
 * A region as the weights read it: rig px (or any frame, as long as the point
 * is in the same one), y down — the fields a contour region and an automatic
 * mode's weight-and-density region (`src/automesh.ts`) both carry; a
 * density-only automatic region (issue #155) has no bone and is never read here.
 */
export type WeightRegion =
  | { name: string; shape: 'circle'; cx: number; cy: number; r: number; band: number; bone: string }
  | { name: string; shape: 'polygon'; points: Point[]; band: number; bone: string };

const units = (v: number, what: string): number => {
  const u = v * GRID;
  if (!Number.isInteger(u) || !Number.isSafeInteger(u * u * 4)) throw new Error(`localweights: ${what} ${v} is not a multiple of 1/${GRID} px within the exact range; the config loader refuses such a region`);
  return u;
};

/** Twice the signed area of a, b, c on integer units: exact while every difference is under 2^25. */
function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Is p on the segment a–b (exact, integer units)? */
function onSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean {
  if (orient(ax, ay, bx, by, px, py) !== 0) return false;
  return px >= Math.min(ax, bx) && px <= Math.max(ax, bx) && py >= Math.min(ay, by) && py <= Math.max(ay, by);
}

/** Is the squared distance from p to a–b at least `r2`? Exact, integer units, `BigInt` where a product could pass 2^53. */
function atLeast(px: number, py: number, ax: number, ay: number, bx: number, by: number, r2: bigint): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const vx = px - ax;
  const vy = py - ay;
  const along = BigInt(vx) * BigInt(dx) + BigInt(vy) * BigInt(dy);
  const len2 = BigInt(dx) * BigInt(dx) + BigInt(dy) * BigInt(dy);
  const sq = (x: number, y: number): bigint => BigInt(x) * BigInt(x) + BigInt(y) * BigInt(y);
  if (along <= 0n) return sq(vx, vy) >= r2;
  if (along >= len2) return sq(px - bx, py - by) >= r2;
  const cross = BigInt(dx) * BigInt(vy) - BigInt(dy) * BigInt(vx);
  return cross * cross >= r2 * len2;
}

/** Strictly inside the ring by the crossing rule, on integer units (a point on an edge is asked separately). */
function insideRing(px: number, py: number, xs: readonly number[], ys: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    if (ys[j] > py === ys[i] > py) continue;
    const o = orient(xs[j], ys[j], xs[i], ys[i], px, py);
    if (ys[i] > ys[j] ? o > 0 : o < 0) inside = !inside;
  }
  return inside;
}

/**
 * The nominal linear share at `p` (same frame as the region), used to decide
 * support. `p` must be on the 1/256 px grid. See the module header for
 * which decisions are exact.
 */
export function regionWeight(p: Point, reg: WeightRegion): number {
  const px = units(p[0], 'point x');
  const py = units(p[1], 'point y');
  const B = units(reg.band, 'band');
  if (reg.shape === 'circle') {
    const dx = px - units(reg.cx, 'cx');
    const dy = py - units(reg.cy, 'cy');
    const R = units(reg.r, 'r');
    const d2 = BigInt(dx) * BigInt(dx) + BigInt(dy) * BigInt(dy);
    if (d2 <= BigInt(R) * BigInt(R)) return 1;
    if (B === 0 || d2 >= BigInt(R + B) * BigInt(R + B)) return 0;
    const d = Math.sqrt(Number(d2)) / GRID - reg.r;
    return Math.min(1, Math.max(0, 1 - d / reg.band));
  }
  const xs = reg.points.map((q) => units(q[0], 'polygon x'));
  const ys = reg.points.map((q) => units(q[1], 'polygon y'));
  const n = xs.length;
  for (let i = 0; i < n; i++) if (onSegment(px, py, xs[i], ys[i], xs[(i + 1) % n], ys[(i + 1) % n])) return 1;
  if (insideRing(px, py, xs, ys)) return 1;
  if (B === 0) return 0;
  const B2 = BigInt(B) * BigInt(B);
  let far = true;
  for (let i = 0; i < n && far; i++) far = atLeast(px, py, xs[i], ys[i], xs[(i + 1) % n], ys[(i + 1) % n], B2);
  if (far) return 0;
  let d = Infinity;
  for (let i = 0; i < n; i++) d = Math.min(d, segmentDistance(p, reg.points[i], reg.points[(i + 1) % n]));
  return Math.min(1, Math.max(0, 1 - d / reg.band));
}

/** A vertex that two regions both reach: the two, by index in the mesh's list, with each one's g. */
export interface RegionOverlap {
  first: number;
  second: number;
  g1: number;
  g2: number;
}

export interface LocalInfluence {
  /** Unrounded; they sum to 1 up to the doubles' rounding. Order: see {@link localInfluences}. */
  influences: Influence[];
  /** The region that reached the vertex (g > 0), by index, or -1. */
  region: number;
  /** The unrounded region share used in the blend. */
  g: number;
}

/**
 * A vertex's weights under the mesh's regions (module header). `shares`, when
 * given, is `S` from another rule — bone heat's shares at the vertex
 * (`src/heat.ts`, issue #161), already capped and floored by `limits` — and
 * the regions apply to it exactly as to the distance rule's. Returns the
 * nominal overlap when two regions both reach the vertex. With `context`
 * set to `contour`, the chosen region's outer half is eased by default.
 * Order: with no
 * region, `S`'s own order; with a region, the region's bone first, then `S`'s
 * bones in `S`'s order.
 */
export function localInfluences(
  p: Point,
  segments: readonly Segment[],
  r: number,
  regions: readonly (WeightRegion & Pick<ContourRegionSpec, 'falloff'>)[],
  limits: InfluenceLimits = DEFAULT_LIMITS,
  exponent: number = DISTANCE_EXPONENT,
  shares?: Influence[],
  context?: 'contour',
): LocalInfluence | RegionOverlap {
  let region = -1;
  let g = 0;
  for (let k = 0; k < regions.length; k++) {
    const gk = regionWeight(p, regions[k]);
    if (gk <= 0) continue;
    if (region >= 0) return { first: region, second: k, g1: g, g2: gk };
    region = k;
    g = gk;
  }
  const S = shares ?? influences(p, segments, r, limits, exponent);
  if (region < 0) return { influences: S, region, g: 0 };
  const { bone, falloff } = regions[region];
  if (context === 'contour' && falloff !== 'linear' && g < 0.5) g = 4 * g * g * (1 - g);
  if (g >= 1) return { influences: [{ bone, weight: 1 }], region, g };
  let base = S;
  if (!S.some((e) => e.bone === bone) && S.length >= limits.maxInfluences) {
    const kept = S.slice(0, limits.maxInfluences - 1);
    let s = 0;
    for (const e of kept) s += e.weight;
    base = kept.map((e) => ({ bone: e.bone, weight: e.weight / s }));
  }
  const out: Influence[] = [{ bone, weight: g }];
  for (const e of base) {
    if (e.bone === bone) out[0] = { bone, weight: out[0].weight + (1 - g) * e.weight };
    else out.push({ bone: e.bone, weight: (1 - g) * e.weight });
  }
  return { influences: out, region, g };
}
