/**
 * Limbs cut at their joints (issue #349): the geometry `assemble` cuts a
 * declared limb's layer by, and the cap each lower segment carries past its
 * joint. Pure arithmetic on rig pixels (y down, origin top-left, the space of
 * `parts.json` and of `config.bones`); no clock, no randomness.
 *
 * - **Where a bone is.** A single bone sits at its `at` and ends at its `tip`
 *   (no tip: no end); a chain's link `k` sits at `points[k]` and ends at
 *   `points[k + 1]`, the last link at `tip` ({@link bonePlaces}).
 * - **Which limb a pixel belongs to.** Every pixel of a part a limb takes
 *   goes to one limb: the one whose polyline — its segments' bone origins in
 *   order, then the last bone's end when it has one — passes nearest the
 *   pixel's centre, by squared Euclidean distance to the polyline's pieces; a
 *   tie goes to the limb `config.limbs` declares first ({@link nearestLimb}).
 *   Two legs in one `legwear` layer are split this way, with no polygon.
 * - **The joint line.** The joint between segments `k − 1` and `k` is the
 *   origin of segment `k`'s bone. Its line runs through that point,
 *   perpendicular to the limb's axis there: the sum of the unit directions of
 *   the upper bone (its origin to the joint) and the lower bone (the joint to
 *   its end, when it has one; the upper's alone when it has none) — on a
 *   straight limb the plain perpendicular, on a bent one the bisector
 *   ({@link jointLine}). A pixel is past the line when its centre's dot
 *   product with the axis, from the joint, is above 0; a centre on the line
 *   stays on the upper side.
 * - **Which segment a pixel belongs to.** Among the consecutive segments of a
 *   limb that take one part, a pixel starts on the first and moves down one
 *   segment for each joint line it is past, in order, stopping at the first it
 *   is not past ({@link segmentOf}). A segment whose part is not the previous
 *   segment's takes its limb's share of its own part whole: no line is cut
 *   between two layers (the shin's legwear and the foot's footwear).
 * - **The limb's width at a joint.** The pixels of the limb's art (alpha above
 *   8, both segments' parts) whose centre lies within half a pixel of the
 *   joint line, read along the line: the run of them through the joint — the
 *   pixel nearest the joint must lie within 1 px of it, and the run grows while
 *   neighbours along the line are at most 1.5 px apart (a diagonal line's
 *   centres are up to sqrt(2) apart) — from its first to its last, plus one
 *   pixel ({@link limbWidth}). The cap's radius is half of it.
 * - **The cap.** The pixels whose centre lies within the radius of the joint
 *   and on the upper side of its line, inside the box
 *   {@link capBox} prints: the overlap the lower segment carries so a bend
 *   shows no gap. The tool invents none of them: each is the config's cap
 *   image's where that image is not transparent, else the layer's where the
 *   limb has art there, else missing — counted, and named in the limb line.
 * - **`cap_shape: "disc"`** (issue #360, items 10 and 12; opt-in on the
 *   segment below the joint). The radius is the limb's half-width about the
 *   joint, not half its width: the distance from the joint to the nearer end
 *   of the same run along the joint line, each end half a pixel past its
 *   centre ({@link halfWidthAbout}) — so the disc lies on the limb's art
 *   across the line however far off the run's middle the bone sits. The cap
 *   takes, after the image's and the layer's, the upper segment's art at a
 *   pixel the lower's layer has none of: the whole half-disc comes from the
 *   art. The upper piece's corner at the cut is kept where it is: on a joint
 *   off the limb's middle, a corner trimmed to the disc leaves a notch at
 *   rest when nothing takes it, or a stub out of the bent lower piece's
 *   outline when the lower takes it (issue #360, unit B's sheets).
 * - **`edge: "feather"`** (issue #360, item 9; opt-in on the segment below the
 *   joint). The overlap band is the disc about the joint that the lower
 *   piece covers at every turn ({@link coveredRadius}: the cap's disc, less
 *   any pixel the cap is missing and a bilinear sample's reach). Inside it,
 *   on the upper side of the line, the upper piece's alpha is scaled by
 *   {@link featherWeight}: 0 on the line, 1 on the band's arc. The band fades
 *   out across its width over art that stays opaque under it at any angle,
 *   so at rest the two pieces composite to what they did and a bend never
 *   shows through it what lies behind the limb.
 * - **`cut_band: N`** (issue #360, item 14; opt-in on the segment below a
 *   joint between two segments that take one part). The cut is placed, not
 *   moved by hand: of the lines parallel to the joint line at whole-pixel
 *   offsets `-N .. N` along the axis, the one that crosses the fewest stroke
 *   pixels ({@link placeCut}). A line crosses the pixels a joint line runs
 *   through, as {@link limbRun} reads them: the limb's art whose centre lies
 *   within half a pixel of it, across the run of art through its point. A
 *   **stroke pixel** is one of those, over the whole band, whose luma (the
 *   integer BT.601 `(299 R + 587 G + 114 B + 500) / 1000` truncated, the
 *   luma `recompositeErrorMap` in `src/assemble.ts` reads) is at or below the
 *   Otsu split of their luma histogram ({@link otsuDarkMax}: the dark class
 *   of the two that maximise the between-class variance). The split is
 *   derived from the band's own art and no number is typed: art of one luma
 *   has no split and so no stroke. A tie goes to the line nearer the joint,
 *   then to the one on the upper side, so with no stroke in the band the
 *   joint line itself is chosen. The bone does not move: the joint, the
 *   cap's disc and the limb's width stay where the bone's origin puts them;
 *   only the line that splits the pixels between the two pieces moves, and
 *   the cap takes the disc's pixels on the upper side of that line.
 * - **Overlapping hands** (issue #400, {@link assignOverlappingHands}). When
 *   two forearm segments (`joint: "elbow"`, with a wrist end) share a part,
 *   each hand's keypoint region is the disc of radius half its forearm's
 *   length (`L / 2`) about its wrist, and its cuff is the line across the
 *   forearm at `L - L / 2 = L / 2` from the elbow, where that disc meets the
 *   bone's axis. When the two hand discs overlap, the overlapping hand region
 *   goes to the front piece (the limb `config.limbs` declares later, which
 *   `limbOrder` draws in front) in one piece, and the back piece ends at its
 *   cuff; any 4-connected island on a forearm piece that leaves its own hand's
 *   keypoint region is transferred to the other forearm piece, so no slivers
 *   are cut out of the front hand for the back arm.
 * - **Crossed limbs** (issue #446, {@link limbCrossing},
 *   {@link assignCrossedLimbs}). When two limbs share a part and cross in an X,
 *   the covering limb may declare `split` (`line` or `edge: "painting"`):
 *   under `line`, rays from the covering limb's bone polyline split pixels at
 *   the declared polyline (and its matching half-width on the opposite side
 *   when one edge is given); under `edge: "painting"`, each ray from the
 *   covering limb's bone polyline walks outward through the covering limb's
 *   interior fill and stops at the outer edge of its dark stroke (`luma <=` the
 *   part's Otsu split) or transparent silhouette. Without `split`,
 *   {@link nearestLimb} stays as it was and `propose`'s `LINT` names the
 *   crossing.
 */
import type { BoneEntry, Limb, LimbSplit } from './config.ts';
import { pyRound } from './round.ts';

export type Pt = [number, number];

/** A bone's origin and, when it has one, its end, in rig px. */
export interface BonePlace {
  at: Pt;
  end: Pt | null;
}

/** Where every bone `bones` declares sits and ends (module comment). */
export function bonePlaces(bones: readonly BoneEntry[]): Map<string, BonePlace> {
  const out = new Map<string, BonePlace>();
  for (const b of bones) {
    if ('chain' in b) {
      b.points.forEach((p, k) => out.set(`${b.chain}${k}`, { at: [p[0], p[1]], end: k + 1 < b.points.length ? [b.points[k + 1][0], b.points[k + 1][1]] : [b.tip[0], b.tip[1]] }));
    } else out.set(b.name, { at: [b.at[0], b.at[1]], end: b.tip === undefined ? null : [b.tip[0], b.tip[1]] });
  }
  return out;
}

/**
 * Issue #476: pose `bones` (in rig pixels, y down) so every bone named in
 * `drawn` takes that world angle (in Spine degrees, CCW, y up) while keeping
 * its base length and parent-to-child joint offsets. Used by `assemble` when
 * an alternate set covers a limb chain at its own `drawn` angles, so `cutLimbs`
 * cuts the set's painting at the base's joints posed to `drawn`.
 */
export function poseBoneEntriesForDrawn(bones: readonly BoneEntry[], drawn: Readonly<Record<string, number>>): BoneEntry[] {
  if (Object.keys(drawn).length === 0) return [...bones];
  interface FlatNode {
    name: string;
    parent: string;
    at0: Pt;
    end0: Pt | null;
    theta0: number;
    length: number;
    inherit?: string;
  }
  const flat = new Map<string, FlatNode>();
  for (const b of bones) {
    if ('chain' in b) {
      b.points.forEach((p, k) => {
        const name = `${b.chain}${k}`;
        const parent = k === 0 ? b.parent : `${b.chain}${k - 1}`;
        const at0: Pt = [p[0], p[1]];
        const end0: Pt = k + 1 < b.points.length ? [b.points[k + 1][0], b.points[k + 1][1]] : [b.tip[0], b.tip[1]];
        const dx = end0[0] - at0[0];
        const dy = end0[1] - at0[1];
        const theta0 = (Math.atan2(-dy, dx) * 180) / Math.PI;
        const length = Math.sqrt(dx * dx + dy * dy);
        flat.set(name, { name, parent, at0, end0, theta0, length, inherit: b.link_inherit?.[name] });
      });
    } else {
      const at0: Pt = [b.at[0], b.at[1]];
      const end0: Pt | null = b.tip === undefined ? null : [b.tip[0], b.tip[1]];
      const dx = end0 === null ? 0 : end0[0] - at0[0];
      const dy = end0 === null ? 0 : end0[1] - at0[1];
      const theta0 = end0 === null ? 0 : (Math.atan2(-dy, dx) * 180) / Math.PI;
      const length = end0 === null ? 0 : Math.sqrt(dx * dx + dy * dy);
      flat.set(b.name, { name: b.name, parent: b.parent, at0, end0, theta0, length, inherit: b.inherit });
    }
  }
  const posed = new Map<string, { at: Pt; end: Pt | null; theta: number }>();
  const solve = (name: string): { at: Pt; end: Pt | null; theta: number } => {
    const cached = posed.get(name);
    if (cached !== undefined) return cached;
    const node = flat.get(name);
    if (node === undefined) return { at: [0, 0], end: null, theta: 0 };
    let at: Pt = [node.at0[0], node.at0[1]];
    let dParent = 0;
    const pNode = flat.get(node.parent);
    if (pNode !== undefined) {
      const pPosed = solve(node.parent);
      dParent = pPosed.theta - pNode.theta0;
      const rad = (dParent * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx0 = node.at0[0] - pNode.at0[0];
      const dy0 = node.at0[1] - pNode.at0[1];
      at = [pPosed.at[0] + dx0 * cos + dy0 * sin, pPosed.at[1] - dx0 * sin + dy0 * cos];
    }
    const inheritsRot = node.inherit !== 'noRotationOrReflection' && node.inherit !== 'onlyTranslation';
    const theta = drawn[name] !== undefined ? drawn[name] : node.theta0 + (inheritsRot ? dParent : 0);
    let end: Pt | null = null;
    if (node.end0 !== null) {
      const rad = (theta * Math.PI) / 180;
      end = [at[0] + node.length * Math.cos(rad), at[1] - node.length * Math.sin(rad)];
    }
    const res = { at, end, theta };
    posed.set(name, res);
    return res;
  };
  for (const name of flat.keys()) solve(name);
  return bones.map((b): BoneEntry => {
    if ('chain' in b) {
      const points = b.points.map((_, k): Pt => {
        const s = solve(`${b.chain}${k}`);
        return [s.at[0], s.at[1]];
      });
      const last = solve(`${b.chain}${b.points.length - 1}`);
      const tip: Pt = last.end === null ? [b.tip[0], b.tip[1]] : [last.end[0], last.end[1]];
      return { ...b, points, tip };
    }
    const s = solve(b.name);
    return {
      ...b,
      at: [s.at[0], s.at[1]],
      ...(b.tip === undefined || s.end === null ? {} : { tip: [s.end[0], s.end[1]] }),
    };
  });
}

/** A limb's polyline: its segments' bone origins in order, then the last bone's end when it has one. */
export function limbPolyline(limb: Limb, places: ReadonlyMap<string, BonePlace>): Pt[] {
  const pts = limb.segments.map((s) => (places.get(s.bone) as BonePlace).at);
  const last = places.get(limb.segments[limb.segments.length - 1].bone) as BonePlace;
  return last.end === null ? pts : [...pts, last.end];
}

/** The squared distance from `(x, y)` to the polyline `pts` (one point: to that point). */
export function polylineDist2(pts: readonly Pt[], x: number, y: number): number {
  if (pts.length === 1) return (x - pts[0][0]) ** 2 + (y - pts[0][1]) ** 2;
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const dx = pts[i + 1][0] - ax;
    const dy = pts[i + 1][1] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const d = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
    if (d < best) best = d;
  }
  return best;
}

/** The index, among `lines`, of the polyline nearest the pixel `(px, py)`'s centre; the first wins a tie. */
export function nearestLimb(lines: ReadonlyArray<readonly Pt[]>, px: number, py: number): number {
  let best = 0;
  let bestD = Infinity;
  lines.forEach((l, i) => {
    const d = polylineDist2(l, px + 0.5, py + 0.5);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** A joint's line: through `at`, perpendicular to the unit `axis` (pointing from the upper segment to the lower). */
export interface JointLine {
  at: Pt;
  axis: Pt;
}

/** The unit vector along `(x, y)`, or null when it has no length. */
function unit(x: number, y: number): Pt | null {
  const l = Math.sqrt(x * x + y * y);
  return l === 0 ? null : [x / l, y / l];
}

/**
 * The joint line between a bone whose origin is `upper` and one whose origin
 * is `at` and whose end is `end` (null: none) — module comment. Null when no
 * axis exists: the upper bone has no length, or the limb folds straight back
 * on itself.
 */
export function jointLine(upper: Pt, at: Pt, end: Pt | null): JointLine | null {
  const u = unit(at[0] - upper[0], at[1] - upper[1]);
  if (u === null) return null;
  const w = end === null ? null : unit(end[0] - at[0], end[1] - at[1]);
  const a = w === null ? u : unit(u[0] + w[0], u[1] + w[1]);
  return a === null ? null : { at, axis: a };
}

/** Whether the pixel `(px, py)`'s centre lies past the line (on the lower segment's side); on the line is not past. */
export function pastJoint(line: JointLine, px: number, py: number): boolean {
  return (px + 0.5 - line.at[0]) * line.axis[0] + (py + 0.5 - line.at[1]) * line.axis[1] > 0;
}

/**
 * The segment, among `first .. last` (consecutive segments taking one part),
 * a pixel belongs to: `first`, moved down one for each joint line in order it
 * is past, stopping at the first it is not. `lines[k]` is the line above
 * segment `k`.
 */
export function segmentOf(lines: ReadonlyArray<JointLine | null>, first: number, last: number, px: number, py: number): number {
  let k = first;
  while (k < last && pastJoint(lines[k + 1] as JointLine, px, py)) k++;
  return k;
}

/**
 * The limb's run of art along a joint line (module comment): the offsets
 * along the line, from the joint, of the first and the last pixel centre of
 * the run through the joint, `[first, last]` with `first <= last`. Null when
 * no pixel of the run lies within 1 px of the joint.
 */
export function limbRun(line: JointLine, art: (x: number, y: number) => boolean, box: readonly [number, number, number, number]): [number, number] | null {
  const [ax, ay] = line.axis;
  const ts: number[] = [];
  for (let y = box[1]; y <= box[3]; y++) {
    for (let x = box[0]; x <= box[2]; x++) {
      const dx = x + 0.5 - line.at[0];
      const dy = y + 0.5 - line.at[1];
      if (Math.abs(dx * ax + dy * ay) > 0.5 || !art(x, y)) continue;
      ts.push(-dx * ay + dy * ax);
    }
  }
  return runOfOffsets(ts);
}

/**
 * The pixel of the limb's art on a joint line nearest the joint (issue #517):
 * among the pixels {@link limbRun} reads (centre within half a pixel of the
 * line), the one whose offset along the line is smallest in size — that
 * distance from the joint, and the pixel; the first in row order wins a tie.
 * Null when the line crosses none of the art. Where {@link limbRun} is null
 * this is how far off the art the joint sits along its own line, the figure
 * `ASSEMBLE_LIMB_JOINT_ON_ART` and propose's `limb-joint-off-art` LINT print.
 */
export function nearestOnLine(line: JointLine, art: (x: number, y: number) => boolean, box: readonly [number, number, number, number]): { distance: number; at: Pt } | null {
  const [ax, ay] = line.axis;
  let best: { distance: number; at: Pt } | null = null;
  for (let y = box[1]; y <= box[3]; y++) {
    for (let x = box[0]; x <= box[2]; x++) {
      const dx = x + 0.5 - line.at[0];
      const dy = y + 0.5 - line.at[1];
      if (Math.abs(dx * ax + dy * ay) > 0.5 || !art(x, y)) continue;
      const d = Math.abs(-dx * ay + dy * ax);
      if (best === null || d < best.distance) best = { distance: d, at: [x, y] };
    }
  }
  return best;
}

/** {@link nearestOnLine}'s figure as the refusal and the LINT word it: the pixel and its distance to 3 places, or that the line crosses none of the art. */
export function offLineFigure(n: { distance: number; at: Pt } | null): string {
  return n === null ? 'the line crosses none of it' : `the nearest of it on that line is the pixel [${n.at.join(', ')}], ${pyRound(n.distance, 3)} px from the joint`;
}

/** The run through 0 of the offsets `ts` along a line ({@link limbRun}): sorted, the nearest within 1 px, grown while neighbours are at most 1.5 apart. Sorts `ts` in place. */
function runOfOffsets(ts: number[]): [number, number] | null {
  if (ts.length === 0) return null;
  ts.sort((a, b) => a - b);
  let near = 0;
  ts.forEach((t, i) => {
    if (Math.abs(t) < Math.abs(ts[near])) near = i;
  });
  if (Math.abs(ts[near]) > 1) return null;
  let lo = near;
  let hi = near;
  while (lo > 0 && ts[lo] - ts[lo - 1] <= 1.5) lo--;
  while (hi + 1 < ts.length && ts[hi + 1] - ts[hi] <= 1.5) hi++;
  return [ts[lo], ts[hi]];
}

/** The limb's width at a joint (module comment): its run's first to last pixel centre, plus one pixel. Null with no run. */
export function limbWidth(line: JointLine, art: (x: number, y: number) => boolean, box: readonly [number, number, number, number]): number | null {
  const r = limbRun(line, art, box);
  return r === null ? null : r[1] - r[0] + 1;
}

/**
 * The limb's half-width about the joint (issue #360, `cap_shape: "disc"`): the
 * distance from the joint to the nearer end of its run, each end half a pixel
 * past its centre — `min(last + 0.5, 0.5 - first)`. Half the width when the
 * joint sits in the middle of the run; less when it sits off it. Zero or below
 * when the joint sits on the run's edge.
 */
export function halfWidthAbout(run: readonly [number, number]): number {
  return Math.min(run[1] + 0.5, 0.5 - run[0]);
}

/** Where a pixel's centre lies from a joint: `along` the axis (above 0 past the line), and `across` it (the run's offset). */
export function jointOffsets(line: JointLine, px: number, py: number): { along: number; across: number } {
  const dx = px + 0.5 - line.at[0];
  const dy = py + 0.5 - line.at[1];
  return { along: dx * line.axis[0] + dy * line.axis[1], across: -dx * line.axis[1] + dy * line.axis[0] };
}

/**
 * The radius the feathered edge fades over (issue #360, `edge: "feather"`):
 * the disc about the joint the lower piece covers at every turn. It is the
 * distance from the joint to the nearest pixel centre the lower piece does not
 * hold at alpha 255 (`opaque` false; searched out to `radius` + 2), less
 * sqrt(2), the farthest a bilinear sample reaches to its four texels — so a
 * pixel within it, turned by any angle about the joint, still samples only
 * the lower's opaque art — and at most `radius`. Zero or below: no pixel is
 * covered at every turn, and nothing is feathered.
 */
export function coveredRadius(at: Pt, radius: number, opaque: (x: number, y: number) => boolean): number {
  const [x0, y0, w, h] = capBox(at, radius + 2);
  let near = radius + 2;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (opaque(x, y)) continue;
      const d = Math.sqrt((x + 0.5 - at[0]) ** 2 + (y + 0.5 - at[1]) ** 2);
      if (d < near) near = d;
    }
  }
  return Math.min(radius, near - Math.SQRT2);
}

/**
 * The feathered edge's weight on the upper piece (issue #360, `edge:
 * "feather"`) at a pixel inside the joint's disc on the upper side of its line:
 * its distance above the line over the disc's height there,
 * `-along / sqrt(radius² - across²)` — 0 on the line, 1 on the disc's arc, so
 * the overlap band fades out across its width. 1 where the disc has no height.
 */
export function featherWeight(radius: number, along: number, across: number, offset = 0): number {
  const h2 = radius * radius - across * across;
  if (h2 <= 0) return 1;
  // Issue #360 (cut_band): with the cut `offset` px along the axis, the fade runs from the cut's line to the arc.
  if (offset !== 0) {
    const span = offset + Math.sqrt(h2);
    return span <= 0 ? 1 : Math.max(0, Math.min(1, (offset - along) / span));
  }
  return Math.max(0, Math.min(1, -along / Math.sqrt(h2)));
}

/** The integer BT.601 luma of a colour, `(299 R + 587 G + 114 B + 500) / 1000` truncated (the one `recompositeErrorMap` reads). */
export function luma601(r: number, g: number, b: number): number {
  return Math.floor((299 * r + 587 * g + 114 * b + 500) / 1000);
}

/**
 * The Otsu split of a luma histogram (`hist[v]` pixels of luma `v`): the
 * largest luma of the dark class, among the splits `luma <= T | luma > T`
 * with a pixel on each side, that maximises the between-class variance
 * `(T's dark sum · n − dark count · total sum)² / (dark count · light count)`
 * (the variance times n², which ranks the splits alike). Compared exactly, in
 * integers; a tie goes to the lower `T`. Null when no split has a pixel on
 * each side — every pixel of one luma — or when every split's variance is 0.
 */
export function otsuDarkMax(hist: ArrayLike<number>): number | null {
  let n = 0;
  let sum = 0;
  for (let v = 0; v < hist.length; v++) {
    n += hist[v];
    sum += v * hist[v];
  }
  const N = BigInt(n);
  const S = BigInt(sum);
  let best: number | null = null;
  let bestNum = 0n;
  let bestDen = 1n;
  let n0 = 0;
  let s0 = 0;
  for (let t = 0; t + 1 < hist.length; t++) {
    n0 += hist[t];
    s0 += t * hist[t];
    const n1 = n - n0;
    if (n0 === 0 || n1 === 0) continue;
    const d = BigInt(s0) * N - BigInt(n0) * S;
    const num = d * d;
    const den = BigInt(n0) * BigInt(n1);
    if (num === 0n) continue;
    if (best === null || num * bestDen > bestNum * den) {
      best = t;
      bestNum = num;
      bestDen = den;
    }
  }
  return best;
}

/** A joint line moved `offset` px along its axis (issue #360, `cut_band`): the same axis, through `at + offset · axis`. */
export function shiftedLine(line: JointLine, offset: number): JointLine {
  return offset === 0 ? line : { at: [line.at[0] + offset * line.axis[0], line.at[1] + offset * line.axis[1]], axis: line.axis };
}

/** One line of a cut's band (issue #360, `cut_band`): its offset along the axis from the joint, and the stroke pixels it crosses. */
export interface CutCandidate {
  offset: number;
  crossed: number;
}

/** Where `cut_band` put the cut (module comment), or why it could not. */
export type CutPlacement =
  | {
      ok: true;
      /** The chosen line's offset along the axis from the joint (above 0: past it, toward the lower segment). */
      offset: number;
      line: JointLine;
      crossed: number;
      /** The stroke pixels the joint line itself crosses. */
      jointCrossed: number;
      /** The Otsu split's dark class's largest luma, or null when the band's art has no split (no stroke). */
      strokeLumaMax: number | null;
      /** The art pixels the band's lines cross, counted once each. */
      bandPx: number;
      candidates: CutCandidate[];
    }
  | { ok: false; offset: number };

/**
 * Place a joint's cut within `band` px of its line (module comment, `cut_band`):
 * every whole offset `-band .. band` is a candidate line; each crosses the
 * art pixels (`art`) whose centre lies within half a pixel of it, across the
 * run of art through its point ({@link limbRun}); the stroke pixels are those
 * at or below the Otsu split of the luma (`luma`) of every pixel the band's
 * lines cross. The fewest stroke pixels wins, then the smaller offset, then the
 * negative one (the upper side). `{ok: false, offset}` names the offset nearest
 * the joint (the negative one on a tie) whose line crosses no run of art: the
 * band reaches past the limb there, and a band of `|offset| - 1` would not.
 */
export function placeCut(
  line: JointLine,
  band: number,
  art: (x: number, y: number) => boolean,
  luma: (x: number, y: number) => number,
  box: readonly [number, number, number, number],
): CutPlacement {
  const W = box[2] - box[0] + 1;
  // One pass over the box: the art within band + 1 px of the joint line, a margin past every candidate's half pixel.
  const near: Array<[number, number]> = [];
  for (let y = box[1]; y <= box[3]; y++) {
    for (let x = box[0]; x <= box[2]; x++) {
      if (Math.abs(jointOffsets(line, x, y).along) <= band + 1 && art(x, y)) near.push([x, y]);
    }
  }
  const crossedBy: Array<number[] | null> = [];
  for (let t = -band; t <= band; t++) {
    const l = shiftedLine(line, t);
    // The pixels limbRun reads on this line, with their offsets across it.
    const on = near.map(([x, y]) => ({ x, y, o: jointOffsets(l, x, y) })).filter((q) => Math.abs(q.o.along) <= 0.5);
    const run = runOfOffsets(on.map((q) => q.o.across));
    crossedBy.push(run === null ? null : on.filter((q) => q.o.across >= run[0] && q.o.across <= run[1]).map((q) => (q.y - box[1]) * W + (q.x - box[0])));
  }
  // A line off the limb's art is no candidate: the one nearest the joint is named (the upper side first on a tie).
  const off = crossedBy.map((px, i) => (px === null ? i - band : null)).filter((t): t is number => t !== null);
  if (off.length > 0) return { ok: false, offset: off.reduce((a, t) => (Math.abs(t) < Math.abs(a) ? t : a)) };
  const lines = crossedBy as number[][];
  const lumaAt = (p: number): number => luma(box[0] + (p % W), box[1] + Math.floor(p / W));
  const seen = new Set<number>();
  const hist = new Array<number>(256).fill(0);
  for (const px of lines) {
    for (const p of px) {
      if (seen.has(p)) continue;
      seen.add(p);
      hist[lumaAt(p)]++;
    }
  }
  const split = otsuDarkMax(hist);
  const candidates = lines.map((px, i) => ({ offset: i - band, crossed: split === null ? 0 : px.filter((p) => lumaAt(p) <= split).length }));
  let best = candidates[band];
  for (const c of candidates) {
    if (c.crossed < best.crossed || (c.crossed === best.crossed && (Math.abs(c.offset) < Math.abs(best.offset) || (Math.abs(c.offset) === Math.abs(best.offset) && c.offset < best.offset)))) best = c;
  }
  return { ok: true, offset: best.offset, line: shiftedLine(line, best.offset), crossed: best.crossed, jointCrossed: candidates[band].crossed, strokeLumaMax: split, bandPx: seen.size, candidates };
}

/** The box `[x, y, w, h]` (rig px) of the pixels whose centre lies within `radius` of `at`: the cap image's size and place. */
export function capBox(at: Pt, radius: number): [number, number, number, number] {
  const x0 = Math.ceil(at[0] - radius - 0.5);
  const y0 = Math.ceil(at[1] - radius - 0.5);
  const x1 = Math.floor(at[0] + radius - 0.5);
  const y1 = Math.floor(at[1] + radius - 0.5);
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

/** Whether the pixel `(px, py)`'s centre lies within `radius` of `at`. */
export function inDisc(at: Pt, radius: number, px: number, py: number): boolean {
  return (px + 0.5 - at[0]) ** 2 + (py + 0.5 - at[1]) ** 2 <= radius * radius;
}

/** A forearm segment on a shared part, for {@link assignOverlappingHands} (issue #400). */
export interface ForearmShare {
  /** The limb's index in `Object.keys(limbs)`. */
  limb: number;
  /** The forearm segment's index in `limbs[limb].segments`. */
  seg: number;
  /** The elbow bone origin, in rig px. */
  elbow: Pt;
  /** The wrist bone end (`tip`), in rig px. */
  wrist: Pt;
  /** Whether pixel `(x, y)` on `limb` falls on this forearm segment (`segmentOf === seg`). */
  isSeg: (x: number, y: number) => boolean;
}

/**
 * Issue #400: when two forearm segments (`back` and `front`, in `config.limbs`
 * order so `front` is drawn over `back`) share a part, each hand's keypoint
 * region is the disc of radius `r = L / 2` about its wrist (`L` the forearm
 * bone's length), and `back`'s cuff is the line across the forearm at
 * `L - r = L / 2` from `back.elbow`. When the two wrist discs overlap, `back`'s
 * pixels past its cuff (or inside `front`'s hand disc) go to `front`'s forearm
 * in one piece so `back` ends at its cuff; and any 4-connected island on a
 * forearm piece that leaves its own hand's keypoint region goes to the other
 * forearm piece. Mutates `own` and `segOverride` in place.
 */
export function assignOverlappingHands(back: ForearmShare, front: ForearmShare, W: number, H: number, own: Int32Array, segOverride: Int32Array): void {
  const dx0 = back.wrist[0] - back.elbow[0];
  const dy0 = back.wrist[1] - back.elbow[1];
  const L0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
  const dx1 = front.wrist[0] - front.elbow[0];
  const dy1 = front.wrist[1] - front.elbow[1];
  const L1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
  if (L0 === 0 || L1 === 0) return;
  const r0 = L0 / 2;
  const r1 = L1 / 2;
  const u0x = dx0 / L0;
  const u0y = dy0 / L0;
  const cuff0 = L0 - r0;
  const proj0 = (x: number, y: number): number => (x + 0.5 - back.elbow[0]) * u0x + (y + 0.5 - back.elbow[1]) * u0y;
  const onSeg = (f: ForearmShare, p: number): boolean => own[p] === f.limb && (segOverride[p] === f.seg || (segOverride[p] === -1 && f.isSeg(p % W, Math.floor(p / W))));
  const wristsOverlap = (back.wrist[0] - front.wrist[0]) ** 2 + (back.wrist[1] - front.wrist[1]) ** 2 <= (r0 + r1) ** 2;
  if (wristsOverlap) {
    let cuffHasArt = false;
    for (let y = 0; y < H && !cuffHasArt; y++) {
      for (let x = 0; x < W && !cuffHasArt; x++) {
        if (onSeg(back, y * W + x) && proj0(x, y) <= cuff0) cuffHasArt = true;
      }
    }
    if (cuffHasArt) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const p = y * W + x;
          if (onSeg(back, p) && (proj0(x, y) > cuff0 || inDisc(front.wrist, r1, x, y)) && !inDisc(back.elbow, r0 / 2, x, y)) {
            own[p] = front.limb;
            segOverride[p] = front.seg;
          } else if (own[p] === back.limb && inDisc(front.wrist, r1, x, y) && !inDisc(back.elbow, r0, x, y)) {
            own[p] = front.limb;
            segOverride[p] = front.seg;
          }
        }
      }
    }
  }
  const componentsOf = (f: ForearmShare): number[][] => {
    const seen = new Uint8Array(W * H);
    const comps: number[][] = [];
    for (let p = 0; p < W * H; p++) {
      if (seen[p] === 1 || !onSeg(f, p)) continue;
      seen[p] = 1;
      const comp: number[] = [p];
      for (let h = 0; h < comp.length; h++) {
        const q = comp[h];
        const x = q % W;
        const y = (q - x) / W;
        for (const [nx, ny] of [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ]) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const np = ny * W + nx;
          if (seen[np] === 0 && onSeg(f, np)) {
            seen[np] = 1;
            comp.push(np);
          }
        }
      }
      comps.push(comp);
    }
    return comps;
  };
  const elbowDist2 = (comp: readonly number[], elbow: Pt): number => {
    let best = Infinity;
    for (const p of comp) {
      const x = p % W;
      const y = (p - x) / W;
      const d = (x + 0.5 - elbow[0]) ** 2 + (y + 0.5 - elbow[1]) ** 2;
      if (d < best) best = d;
    }
    return best;
  };
  const backComps = componentsOf(back);
  if (backComps.length > 1) {
    let main = 0;
    let mainD = elbowDist2(backComps[0], back.elbow);
    for (let i = 1; i < backComps.length; i++) {
      const d = elbowDist2(backComps[i], back.elbow);
      if (d < mainD) {
        mainD = d;
        main = i;
      }
    }
    backComps.forEach((comp, i) => {
      if (i === main) return;
      const leavesBack = comp.some((p) => !inDisc(back.wrist, r0, p % W, Math.floor(p / W)));
      const inFront = comp.some((p) => inDisc(front.wrist, r1, p % W, Math.floor(p / W)));
      if (wristsOverlap || leavesBack || inFront) {
        for (const p of comp) {
          own[p] = front.limb;
          segOverride[p] = front.seg;
        }
      }
    });
  }
  const frontComps = componentsOf(front);
  if (frontComps.length > 1) {
    let main = 0;
    let mainD = elbowDist2(frontComps[0], front.elbow);
    for (let i = 1; i < frontComps.length; i++) {
      const d = elbowDist2(frontComps[i], front.elbow);
      if (d < mainD) {
        mainD = d;
        main = i;
      }
    }
    frontComps.forEach((comp, i) => {
      if (i === main) return;
      const leavesFront = comp.some((p) => !inDisc(front.wrist, r1, p % W, Math.floor(p / W)));
      const touchesBack = comp.some((p) => {
        const x = p % W;
        const y = (p - x) / W;
        return (
          (x > 0 && onSeg(back, p - 1)) ||
          (x + 1 < W && onSeg(back, p + 1)) ||
          (y > 0 && onSeg(back, p - W)) ||
          (y + 1 < H && onSeg(back, p + W))
        );
      });
      if (leavesFront && touchesBack) {
        for (const p of comp) {
          own[p] = back.limb;
          segOverride[p] = back.seg;
        }
      }
    });
  }
}

/**
 * Issue #446: the crossing point `[x, y]` (rig px) where two limb polylines `a`
 * and `b` cross in an X, or `null` when they do not cross. Two polylines cross
 * when a segment of `a` and a segment of `b` intersect in their interiors
 * (`0 < ta < 1` and `0 < tb < 1`), or meet at an interior joint vertex while
 * the two polylines' start-to-end chords cross in their interiors.
 */
export function limbCrossing(a: readonly Pt[], b: readonly Pt[]): Pt | null {
  if (a.length < 2 || b.length < 2) return null;
  const segHit = (p0: Pt, p1: Pt, q0: Pt, q1: Pt): { at: Pt; ta: number; tb: number } | null => {
    const dax = p1[0] - p0[0];
    const day = p1[1] - p0[1];
    const dbx = q1[0] - q0[0];
    const dby = q1[1] - q0[1];
    const denom = dax * dby - day * dbx;
    if (Math.abs(denom) <= 1e-9) return null;
    const rx = q0[0] - p0[0];
    const ry = q0[1] - p0[1];
    const ta = (rx * dby - ry * dbx) / denom;
    const tb = (rx * day - ry * dax) / denom;
    if (ta < -1e-6 || ta > 1 + 1e-6 || tb < -1e-6 || tb > 1 + 1e-6) return null;
    return { at: [p0[0] + ta * dax, p0[1] + ta * day], ta, tb };
  };
  const chordHit = segHit(a[0], a[a.length - 1], b[0], b[b.length - 1]);
  if (chordHit === null || chordHit.ta <= 1e-6 || chordHit.ta >= 1 - 1e-6 || chordHit.tb <= 1e-6 || chordHit.tb >= 1 - 1e-6) return null;
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      const hit = segHit(a[i], a[i + 1], b[j], b[j + 1]);
      if (hit !== null) return hit.at;
    }
  }
  return chordHit.at;
}

/** The point on polyline `pts` nearest `(x, y)`. */
function closestOnPolyline(pts: readonly Pt[], x: number, y: number): Pt {
  if (pts.length === 1) return [pts[0][0], pts[0][1]];
  let bestD = Infinity;
  let best: Pt = [pts[0][0], pts[0][1]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const dx = pts[i + 1][0] - ax;
    const dy = pts[i + 1][1] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    const d = (x - qx) ** 2 + (y - qy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = [qx, qy];
    }
  }
  return best;
}

/**
 * Issue #446: assign pixels of a shared part `r` between the covering limb
 * (`coverIdx`, polyline `coverPoly`, declaring `split`) and the covered limb(s)
 * (`underIndices`, polylines `underPolys`). Mutates `own` in place.
 */
export function assignCrossedLimbs(
  coverIdx: number,
  coverPoly: readonly Pt[],
  split: LimbSplit,
  underIndices: readonly number[],
  underPolys: ReadonlyArray<readonly Pt[]>,
  r: { width: number; height: number; data: ArrayLike<number> },
  opaqueAlphaAbove: number,
  own: Int32Array,
): void {
  if (underIndices.length === 0 || coverPoly.length === 0) return;
  const W = r.width;
  const H = r.height;
  const nearestOwn = new Int32Array(own);
  const underOf = (x: number, y: number): number => underIndices[underIndices.length === 1 ? 0 : nearestLimb(underPolys, x, y)];

  if (split.line !== undefined) {
    const line = split.line;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (r.data[p * 4 + 3] === 0) continue;
        const px = x + 0.5;
        const py = y + 0.5;
        const c = closestOnPolyline(coverPoly, px, py);
        const dx = px - c[0];
        const dy = py - c[1];
        const dP = Math.sqrt(dx * dx + dy * dy);
        if (dP <= 1e-9) {
          own[p] = coverIdx;
          continue;
        }
        const ux = dx / dP;
        const uy = dy / dP;
        let hitPos: number | null = null;
        let hitNeg: number | null = null;
        for (let j = 0; j + 1 < line.length; j++) {
          const sx = line[j + 1][0] - line[j][0];
          const sy = line[j + 1][1] - line[j][1];
          const denom = ux * sy - uy * sx;
          if (Math.abs(denom) <= 1e-9) continue;
          const rx = line[j][0] - c[0];
          const ry = line[j][1] - c[1];
          const s = (rx * sy - ry * sx) / denom;
          const v = (rx * uy - ry * ux) / denom;
          if (v < -1e-6 || v > 1 + 1e-6) continue;
          if (s > 1e-6 && (hitPos === null || s < hitPos)) hitPos = s;
          else if (s < -1e-6 && (hitNeg === null || -s < hitNeg)) hitNeg = -s;
        }
        if (hitPos !== null) {
          own[p] = dP <= hitPos + 1e-9 ? coverIdx : underOf(x, y);
        } else if (hitNeg !== null) {
          own[p] = dP <= hitNeg + 1e-9 ? coverIdx : underOf(x, y);
        }
      }
    }
    return;
  }

  const hist = new Array<number>(256).fill(0);
  for (let p = 0; p < W * H; p++) {
    if (r.data[p * 4 + 3] > opaqueAlphaAbove) {
      hist[luma601(r.data[p * 4], r.data[p * 4 + 1], r.data[p * 4 + 2])]++;
    }
  }
  const strokeLumaMax = otsuDarkMax(hist);

  const hasGapAlong = (c: Pt, px: number, py: number, dP: number): boolean => {
    const steps = Math.max(1, Math.ceil(dP * 2));
    const dx = px - c[0];
    const dy = py - c[1];
    for (let s = 0; s <= steps; s++) {
      const sx = Math.min(W - 1, Math.max(0, Math.floor(c[0] + (dx * s) / steps)));
      const sy = Math.min(H - 1, Math.max(0, Math.floor(c[1] + (dy * s) / steps)));
      if (r.data[(sy * W + sx) * 4 + 3] <= opaqueAlphaAbove) return true;
    }
    return false;
  };

  let maxUncrossedHalfWidth = 0;
  let maxFallbackHalfWidth = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (r.data[p * 4 + 3] <= opaqueAlphaAbove || nearestOwn[p] !== coverIdx) continue;
      const px = x + 0.5;
      const py = y + 0.5;
      const c = closestOnPolyline(coverPoly, px, py);
      const dP = Math.sqrt((px - c[0]) ** 2 + (py - c[1]) ** 2);
      if (hasGapAlong(c, px, py, dP)) continue;
      if (dP > maxFallbackHalfWidth) maxFallbackHalfWidth = dP;
      const dUnder = Math.sqrt(Math.min(...underPolys.map((up) => polylineDist2(up, px, py))));
      if (dUnder > dP + 1.5 && dP > maxUncrossedHalfWidth) maxUncrossedHalfWidth = dP;
    }
  }
  if (maxUncrossedHalfWidth === 0) maxUncrossedHalfWidth = maxFallbackHalfWidth;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (r.data[p * 4 + 3] === 0) continue;
      const px = x + 0.5;
      const py = y + 0.5;
      const c = closestOnPolyline(coverPoly, px, py);
      const dx = px - c[0];
      const dy = py - c[1];
      const dP = Math.sqrt(dx * dx + dy * dy);
      if (dP <= 0.5) {
        own[p] = coverIdx;
        continue;
      }
      const steps = Math.max(1, Math.ceil(dP * 2));
      let hitGap = false;
      let seenFill = false;
      let inStroke = false;
      let exitedStroke = false;
      for (let s = 0; s <= steps; s++) {
        const sx = Math.min(W - 1, Math.max(0, Math.floor(c[0] + (dx * s) / steps)));
        const sy = Math.min(H - 1, Math.max(0, Math.floor(c[1] + (dy * s) / steps)));
        const sp = sy * W + sx;
        if (r.data[sp * 4 + 3] <= opaqueAlphaAbove) {
          hitGap = true;
          break;
        }
        if (strokeLumaMax !== null) {
          const l = luma601(r.data[sp * 4], r.data[sp * 4 + 1], r.data[sp * 4 + 2]);
          if (l > strokeLumaMax) {
            if (inStroke) {
              exitedStroke = true;
              break;
            }
            seenFill = true;
          } else if (seenFill) {
            inStroke = true;
          }
        }
      }
      if (hitGap) {
        own[p] = nearestOwn[p];
      } else if (strokeLumaMax !== null) {
        own[p] = !exitedStroke && dP <= maxUncrossedHalfWidth + 1e-6 ? coverIdx : underOf(x, y);
      } else {
        own[p] = dP <= maxUncrossedHalfWidth + 1e-6 ? coverIdx : underOf(x, y);
      }
    }
  }
}

