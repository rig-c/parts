import { OPAQUE_ALPHA_ABOVE } from './layers.ts';
import { connectedComponents } from './raster/components.ts';
import { type Ground } from './projectrule.ts';
import { type Mask, newMask, type Raster, RasterError } from './raster/types.ts';

/**
 * Issue #953, under `projectRule: 'visible'` only: the parts' visible edges are
 * resolved from the painting, at the rig's own density, and See-through keeps
 * what lies under another part (its hidden surface) and the partition into
 * parts. Not in the reference.
 *
 * Why: a See-through run is capped at its resolution (1024 on the public
 * examples, over the padded square of the painting), so every run layer is
 * enlarged into the rig and its alpha edge is a soft ramp the painting does not
 * have; where two parts meet along a painted line each layer repaints the line
 * on its own side of its own ramp, which reads as a doubled line, a stair-step
 * and, where neither layer is opaque, the background through a gap. Projection
 * (`projectSource`) recolours only a layer's opaque area, so it cannot reach
 * either.
 *
 * The step reads the final stack (every part on the full rig canvas, in draw
 * order) and the painting resampled into the rig, and writes alpha and colour
 * at the pixels near a visible outline. Everything else is unchanged.
 *
 * ⚖️ Invariant. Let OWNER(p) be the top-most part with alpha above
 * {@link EDGE_OWNER_ALPHA} at p, or the background (-1): See-through's own
 * half-coverage line, which says which parts meet and roughly where. A pixel
 * is an EDGE pixel when another owner lies within {@link EDGE_RADIUS}
 * (Chebyshev) — the nearest one, ties to the part drawn in front. Of the pair
 * (p's owner, that nearest other), FRONT is the one drawn in front and BEHIND
 * the other (the background is behind every part). Inside the
 * `(2 * EDGE_RADIUS + 1)²` window around p:
 *
 * - the behind colour `Cb` is the per-channel median of the painting over the
 *   window's BEHIND-owned pixels farthest from FRONT (the window pixels least
 *   likely to be the edge), so a painted line between the two never sets it;
 * - the front reference `Cf` is the painting at the window's FRONT-owned pixel
 *   farthest from `Cb` (max channel, the distance every other assemble limit
 *   is in; first in scan order on a tie) — a painted line along FRONT's
 *   outline counts as FRONT, which gives the line to the part drawn in front,
 *   the part whose outline it is in the rig;
 * - FRONT's coverage at p is P's position along `Cb -> Cf` (integer dot
 *   products), normalised by a trimap: 0 at the highest position among the
 *   BEHIND-side pixels above, 1 at the lowest among FRONT's window pixels
 *   farthest from BEHIND. Where those two sides do not separate along the axis
 *   (a side is all edge, or the textures overlap) — counted as `unseparated` —
 *   the ends are `Cb` and `Cf` themselves. On a mix of the two colours it is
 *   the mixing weight, and a texture of BEHIND across that axis reads as 0
 *   rather than as FRONT (measured: a distance-only weight left a 10–27 % halo
 *   of the face over the hair at 3–4 rig px from the face's edge on
 *   reference-sample);
 * - on FRONT's side of See-through's line, a pixel whose colour FRONT itself
 *   holds deeper in (within half of {@link EDGE_CONTRAST}, and nearer that
 *   than any BEHIND-side pixel) is FRONT's interior — a lining, a highlight —
 *   and reads 1, however it falls along the axis.
 *
 * A painted pixel no part covers above the owner floor — the gap between two
 * soft rims — is owned by the nearest part (within `2 * EDGE_RADIUS + 2`), so
 * the gap is never read as the background's colour.
 *
 * The ring rule. Rings are counted in Chebyshev distance from the other owner.
 * FRONT's coverage never rises going away from FRONT and never falls going
 * into it: on the inner ring (FRONT-owned, next to the line) it is at least
 * that of its resolved outer-ring neighbours (a painted line just outside
 * See-through's line is FRONT's outline, so what lies between is FRONT's too);
 * deeper inside it is the greater of See-through's own alpha and the
 * painting's (the ramp past the half line is filled; a light interior is never
 * holed); farther out it is no more than its neighbour one ring nearer.
 * Resolved ring by ring, outer before inner.
 *
 * FRONT's alpha becomes that coverage (as 0..255, rounded; within
 * {@link OPAQUE_ALPHA_ABOVE} of 0 or 255 it is snapped there), and its colour
 * the painting unmixed from `Cb` (`Cb + (P - Cb) / a`, clamped); at `a = 1` that
 * is the painting's pixel. Where that colour clamps so the composite would
 * miss the painting by more than half of {@link EDGE_CONTRAST} (a painted line
 * darker or lighter than both colours), FRONT's alpha rises to the least that
 * brings it within. Where FRONT does not cover p fully and BEHIND is a
 * part, BEHIND is made opaque there in `Cb` (in the painting's own colour
 * where FRONT's alpha is 0), so the flat composite at p is the painting, the
 * rim stays FRONT's, and BEHIND's hidden surface past the window is untouched.
 * Where BEHIND already has alpha at least {@link EDGE_OWNER_ALPHA}, its own
 * pre-step RGB is the fill colour. FRONT is unmixed against that same colour,
 * including the clamping error calculation, to preserve the pair's composite.
 *
 * A pixel is left as it was — and counted, by reason — when a part drawn in
 * front of FRONT, or between BEHIND and FRONT, has alpha above
 * {@link OPAQUE_ALPHA_ABOVE} there (its coverage is not modelled: a
 * translucent part is never erased; at or below that floor a part is not
 * opaque anywhere in this package, and it is left as it was); when
 * `|Cf - Cb|` (max channel) is below {@link EDGE_CONTRAST} (the painting draws
 * no edge between the two: a pair under the recomposite's error limit cannot
 * hold an error pixel); when
 * either part may not be edited (`editable`: a painting patch is the painting
 * already); when either part keeps the pixel (`keep`, issue #637), feathers it
 * (`feathered`, a limb's authored soft edge) or the two are a turn's moving
 * pair; or when the window holds no BEHIND-owned pixel.
 *
 * A part's art (alpha above {@link OPAQUE_ALPHA_ABOVE}) keeps its pieces,
 * read 4-connected as `CONTOUR_ONE_ISLAND` reads them: where the step would
 * split a piece, each cut-off part is joined back to the piece's largest part
 * along the path that restores the fewest lowered pixels, and those are not
 * written; a new piece
 * holding none of the part's art is not written (`pieces`, counted per part
 * and pixel). Where that leaves out BEHIND's fill under FRONT, FRONT takes the
 * painting's pixel at full alpha instead, under the same rule.
 *
 * ⚖️ A busy ground (`ground: 'busy'`, issue #996). The two premises above —
 * `painted` separates figure from ground, and BEHIND is one colour `Cb` across
 * the window — hold only where the ground is one colour. On an opaque ground of
 * many colours `paintedFigure` marks the ground as figure, so the gap rule hands
 * ground pixels to the nearest part, and a ground pixel that is not `Cb`
 * projects along `Cb -> Cf` as FRONT. Under a busy ground three rules bound what
 * a part may take:
 *
 * - a part's alpha rises at a pixel only where its own alpha before the step is
 *   above 0 (its support, the reach of See-through's layer through the
 *   resampling into the rig) — FRONT's coverage, BEHIND's fill and the
 *   painting's pixel FRONT takes where BEHIND's fill is held back alike;
 *   a write that would raise one is not made (counted as `support`);
 * - the gap rule takes a pixel only where the supports of at least two parts
 *   meet (a gap between two soft rims, which is what it is for), and gives it
 *   to the nearest of those parts;
 * - a pixel on BEHIND's side of See-through's line is read only where it is a
 *   mix of `Cb` and `Cf`: the painting differs from the nearest point of the
 *   segment `Cb..Cf` by at most half of {@link EDGE_CONTRAST} (max channel, the
 *   tolerance the composite is held to above); otherwise it is left as it was
 *   (counted as `mix`).
 *
 * Under a plain ground (the default) none of the three applies, and the step is
 * the one described above, byte for byte.
 *
 * Every decision is read off the stack as it stood before the step, then
 * applied, so the result does not depend on the order pixels are visited.
 * Deterministic: integer rig arithmetic, medians by sort, no float reduction
 * whose order varies.
 */
export const EDGE_RADIUS = 3;
/** The owner's alpha floor: above it a part covers a pixel. Equal to `COVERED_ALPHA` in `src/assemble.ts` (held by the selftest). */
export const EDGE_OWNER_ALPHA = 128;
/** The least front contrast resolved, max channel. Equal to `ERROR_LIMIT` in `src/assemble.ts` (held by the selftest). */
export const EDGE_CONTRAST = 40;

/** Why an edge pixel was left as it was; see {@link paintingEdges}. */
export interface PaintingEdgeSkips {
  cover: number;
  contrast: number;
  locked: number;
  noBehind: number;
  /** Part writes left out so a part's art keeps its 4-connected pieces (counted per part and pixel, not per edge pixel). */
  pieces: number;
  /** Busy ground only (issue #996): BEHIND-side pixels that are not a mix of the two reference colours. */
  mix: number;
  /** Busy ground only (issue #996): part writes left out because they would raise a part's alpha outside its own support (per part and pixel). */
  support: number;
}

export interface PaintingEdgeResult {
  /** Per part (stack index), the pixels whose RGBA the step changed. */
  changed: Mask[];
  /** Edge pixels resolved (whether or not a value changed), and the ones left. */
  resolved: number;
  /** Of `resolved`, the pixels whose two far sides did not separate along the axis, read against `Cb` and `Cf` themselves. */
  unseparated: number;
  skipped: PaintingEdgeSkips;
}

export interface PaintingEdgeOptions {
  /**
   * Per rig pixel, 1 where the painting shows figure (`paintedFigure` in
   * `src/assemble.ts`). A figure pixel no part covers above
   * {@link EDGE_OWNER_ALPHA} — a gap between two parts' soft rims — is owned by
   * the nearest part within the cap, not the background: the painting holds
   * figure there, and taking the behind colour from it would take a painted line.
   */
  painted: Uint8Array;
  /** Canonical painted figure domain for completing allocated gaps and interior translucency. */
  figure?: Mask;
  /** Per part: whether the step may write it (false for a painting patch). */
  editable: readonly boolean[];
  keep?: ReadonlyArray<Mask | null>;
  feathered?: ReadonlyArray<Mask | null>;
  /** Two parts a turn moves against each other; their shared edge is left alone. */
  movingPair?: ((a: number, b: number) => boolean) | null;
  /** Called once per part and pixel whose RGBA changed. */
  written?: (part: number, pixel: number) => void;
  /** Issue #996: the painting's ground; absent, `plain` (see the invariant above {@link EDGE_RADIUS}). */
  ground?: Ground;
}

/** Chebyshev distance to the nearest set pixel, capped at `cap` (two-pass, exact for the 8-neighbour metric). */
function chebyshev(set: Uint8Array, W: number, H: number, cap: number): Uint8Array {
  const d = new Uint8Array(W * H).fill(cap);
  for (let p = 0; p < W * H; p++) if (set[p] === 1) d[p] = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      let v = d[p];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[p - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[p - W] + 1);
        if (x > 0) v = Math.min(v, d[p - W - 1] + 1);
        if (x < W - 1) v = Math.min(v, d[p - W + 1] + 1);
      }
      d[p] = Math.min(v, cap);
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const p = y * W + x;
      let v = d[p];
      if (v === 0) continue;
      if (x < W - 1) v = Math.min(v, d[p + 1] + 1);
      if (y < H - 1) {
        v = Math.min(v, d[p + W] + 1);
        if (x < W - 1) v = Math.min(v, d[p + W + 1] + 1);
        if (x > 0) v = Math.min(v, d[p + W - 1] + 1);
      }
      d[p] = Math.min(v, cap);
    }
  }
  return d;
}

function maxChannel(a: Uint8ClampedArray, i: number, c: readonly number[]): number {
  return Math.max(Math.abs(a[i] - c[0]), Math.abs(a[i + 1] - c[1]), Math.abs(a[i + 2] - c[2]));
}

/** Lower median of a list of integers (sorted copy; deterministic). */
function median(v: number[]): number {
  const s = v.slice().sort((a, b) => a - b);
  return s[(s.length - 1) >> 1];
}

interface Decision {
  p: number;
  front: number;
  behind: number;
  /** FRONT's coverage read off the painting (0..255, before the ring rule), and FRONT's own alpha there before the step. */
  matte: number;
  own: number;
  /** Which side of See-through's half-coverage line p is on (FRONT-owned or not), and its distance to the other owner. */
  inside: boolean;
  ring: number;
  cb: [number, number, number];
}

/** See the invariant above {@link EDGE_RADIUS}. Modifies `parts` (full rig canvases, draw order) in place. */
export function paintingEdges(parts: Raster[], srcr: Raster, options: PaintingEdgeOptions): PaintingEdgeResult {
  const W = srcr.width;
  const H = srcr.height;
  const n = parts.length;
  // Every part is read as the whole rig canvas; a cropped image would be read at the wrong place.
  parts.forEach((r, i) => {
    if (r.width !== W || r.height !== H) throw new RasterError(`paintingEdges: part ${i} is ${r.width}x${r.height}; the rig canvas ${W}x${H} is required (place a cropped part on it first)`);
  });
  const R = EDGE_RADIUS;
  const cap = 2 * R + 2;
  const busy = options.ground === 'busy';
  /** A part's support before the step: where its own alpha is above 0. */
  const supports = (i: number, p: number): boolean => parts[i].data[p * 4 + 3] > 0;
  const owner = new Int16Array(W * H).fill(-1);
  for (let p = 0; p < W * H; p++) {
    for (let i = n - 1; i >= 0; i--) {
      if (parts[i].data[p * 4 + 3] > EDGE_OWNER_ALPHA) {
        owner[p] = i;
        break;
      }
    }
  }
  const fill: Array<[number, number]> = [];
  const near: Uint8Array[] = [];
  // A painted pixel no part covers goes to the nearest part (ties to the one drawn in front); farther than the cap, it stays background.
  {
    for (let k = 0; k < n; k++) {
      const set = new Uint8Array(W * H);
      for (let p = 0; p < W * H; p++) if (owner[p] === k) set[p] = 1;
      near.push(chebyshev(set, W, H, cap));
    }
    for (let p = 0; p < W * H; p++) {
      if (owner[p] !== -1 || options.painted[p] !== 1) continue;
      // Busy ground: only where two parts' supports meet, and only to a part whose support holds the pixel.
      if (busy) {
        let holders = 0;
        for (let k = 0; k < n && holders < 2; k++) if (supports(k, p)) holders++;
        if (holders < 2) continue;
      }
      let best = -1;
      let bd = cap;
      for (let k = n - 1; k >= 0; k--) if (near[k][p] < bd && (!busy || supports(k, p))) { best = k; bd = near[k][p]; }
      if (best >= 0) fill.push([p, best]);
    }
    for (const [p, k] of fill) owner[p] = k;
  }
  // Distance to each owner, the background at index n.
  const dist: Uint8Array[] = [];
  for (let k = 0; k <= n; k++) {
    const set = new Uint8Array(W * H);
    const label = k === n ? -1 : k;
    let any = false;
    for (let p = 0; p < W * H; p++) {
      if (owner[p] === label) {
        set[p] = 1;
        any = true;
      }
    }
    dist.push(any ? chebyshev(set, W, H, cap) : new Uint8Array(W * H).fill(cap));
  }
  const distOf = (label: number): Uint8Array => dist[label < 0 ? n : label];
  const skipped: PaintingEdgeSkips = { cover: 0, contrast: 0, locked: 0, noBehind: 0, pieces: 0, mix: 0, support: 0 };
  const decisions: Decision[] = [];
  const locked = new Uint8Array(W * H);
  let resolved = 0;
  let unseparated = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const a = owner[p];
      // The nearest other owner within R; ties to the one drawn in front (the background is behind every part).
      let b = -2;
      let bd = R + 1;
      for (let k = n; k >= 0; k--) {
        const label = k === n ? -1 : k;
        if (label === a) continue;
        const d = dist[k][p];
        if (d < bd || (d === bd && b !== -2 && label > b)) {
          if (d <= R) {
            b = label;
            bd = d;
          }
        }
      }
      if (b === -2) continue;
      const front = Math.max(a, b);
      const behind = Math.min(a, b);
      // Coverage the two-layer model cannot carry: anything in front of FRONT, or between BEHIND and FRONT.
      let covered = false;
      for (let j = behind + 1; j < n && !covered; j++) if (j !== front && parts[j].data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE) covered = true;
      if (covered) {
        skipped.cover++;
        continue;
      }
      if (
        !options.editable[front] ||
        (behind >= 0 && !options.editable[behind]) ||
        options.keep?.[front]?.data[p] === 1 ||
        (behind >= 0 && options.keep?.[behind]?.data[p] === 1) ||
        options.feathered?.[front]?.data[p] === 1 ||
        (behind >= 0 && options.feathered?.[behind]?.data[p] === 1) ||
        (behind >= 0 && options.movingPair?.(front, behind) === true)
      ) {
        locked[p] = 1;
        skipped.locked++;
        continue;
      }
      const df = distOf(front);
      const db = distOf(behind);
      // BEHIND's and FRONT's window pixels farthest from the other: the two sides least likely to be the edge itself.
      let farB = -1;
      let farF = -1;
      const sideB: number[] = [];
      const sideF: number[] = [];
      for (let qy = Math.max(0, y - R); qy <= Math.min(H - 1, y + R); qy++) {
        for (let qx = Math.max(0, x - R); qx <= Math.min(W - 1, x + R); qx++) {
          const q = qy * W + qx;
          if (owner[q] === behind) {
            if (df[q] > farB) {
              farB = df[q];
              sideB.length = 0;
            }
            if (df[q] === farB) sideB.push(q);
          } else if (owner[q] === front) {
            if (db[q] > farF) {
              farF = db[q];
              sideF.length = 0;
            }
            if (db[q] === farF) sideF.push(q);
          }
        }
      }
      if (sideB.length === 0) {
        skipped.noBehind++;
        continue;
      }
      const channel = (c: number): number[] => sideB.map((q) => srcr.data[q * 4 + c]);
      const cb = [median(channel(0)), median(channel(1)), median(channel(2))];
      // The front reference: the window's FRONT-owned pixel farthest from Cb (max channel), first in scan order on a tie.
      let contrast = 0;
      let ref = -1;
      for (let qy = Math.max(0, y - R); qy <= Math.min(H - 1, y + R); qy++) {
        for (let qx = Math.max(0, x - R); qx <= Math.min(W - 1, x + R); qx++) {
          const q = qy * W + qx;
          if (owner[q] !== front) continue;
          const c = maxChannel(srcr.data, q * 4, cb);
          if (c > contrast) {
            contrast = c;
            ref = q;
          }
        }
      }
      // Every pixel's position along Cb -> Cf, as an integer dot product.
      const axis = ref < 0 ? [0, 0, 0] : [0, 1, 2].map((c) => srcr.data[ref * 4 + c] - cb[c]);
      const along = (q: number): number => (srcr.data[q * 4] - cb[0]) * axis[0] + (srcr.data[q * 4 + 1] - cb[1]) * axis[1] + (srcr.data[q * 4 + 2] - cb[2]) * axis[2];
      if (ref < 0 || contrast < EDGE_CONTRAST) {
        skipped.contrast++;
        continue;
      }
      // The trimap: BEHIND's far side reads 0 up to its highest position, FRONT's far side 1 from its lowest.
      // Where the two far sides do not separate along the axis (a side is all edge, or the texture overlaps), Cb and Cf themselves.
      const sideLo = Math.max(...sideB.map(along));
      const sideHi = sideF.length === 0 ? -Infinity : Math.min(...sideF.map(along));
      const separate = sideHi > sideLo;
      if (!separate) unseparated++;
      // Busy ground: a pixel on BEHIND's side is read only where it is a mix of Cb and Cf (its distance, max channel, from
      // the nearest point of the segment Cb..Cf within half the contrast floor); a ground of many colours is not Cb.
      if (busy && a !== front) {
        const ax2 = axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2];
        const t = Math.min(1, Math.max(0, along(p) / ax2));
        const off = Math.max(...[0, 1, 2].map((c) => Math.abs(srcr.data[p * 4 + c] - (cb[c] + t * axis[c]))));
        if (2 * off > EDGE_CONTRAST) {
          skipped.mix++;
          continue;
        }
      }
      const lo = separate ? sideLo : 0;
      const hi = separate ? sideHi : along(ref);
      resolved++;
      let matte = Math.round((255 * Math.min(hi - lo, Math.max(0, along(p) - lo))) / (hi - lo));
      // On FRONT's side of the line, a colour FRONT itself holds deeper in (within half the contrast floor, and nearer FRONT than
      // BEHIND) is FRONT's interior — a light lining, a highlight — not a mix with BEHIND, however it falls along the axis.
      if (a === front && matte < 255) {
        let dF = Infinity;
        let dFdeep = Infinity;
        for (let qy = Math.max(0, y - R); qy <= Math.min(H - 1, y + R); qy++) {
          for (let qx = Math.max(0, x - R); qx <= Math.min(W - 1, x + R); qx++) {
            const q = qy * W + qx;
            if (q === p || owner[q] !== front) continue;
            const d = Math.max(Math.abs(srcr.data[q * 4] - srcr.data[p * 4]), Math.abs(srcr.data[q * 4 + 1] - srcr.data[p * 4 + 1]), Math.abs(srcr.data[q * 4 + 2] - srcr.data[p * 4 + 2]));
            dF = Math.min(dF, d);
            if (db[q] >= 2) dFdeep = Math.min(dFdeep, d);
          }
        }
        const dOwn = dFdeep === Infinity ? dF : dFdeep;
        let dB = Infinity;
        for (const q of sideB) dB = Math.min(dB, Math.max(Math.abs(srcr.data[q * 4] - srcr.data[p * 4]), Math.abs(srcr.data[q * 4 + 1] - srcr.data[p * 4 + 1]), Math.abs(srcr.data[q * 4 + 2] - srcr.data[p * 4 + 2])));
        if (2 * dOwn <= EDGE_CONTRAST && dOwn < dB) matte = 255;
      }
      const own = parts[front].data[p * 4 + 3];
      decisions.push({ p, front, behind, matte, own, inside: a === front, ring: bd, cb: [cb[0], cb[1], cb[2]] });
    }
  }
  // The ring rule (see the invariant above), resolved ring by ring, the outer ring before the inner one.
  const at = new Int32Array(W * H).fill(-1);
  decisions.forEach((q, k) => { at[q.p] = k; });
  const alphaOf = new Int16Array(decisions.length);
  const stage = (q: Decision): number => (q.inside ? 2 * q.ring : 2 * q.ring - 1);
  const order = decisions.map((_, k) => k).sort((u, v) => stage(decisions[u]) - stage(decisions[v]) || u - v);
  /** The greatest coverage already resolved for the same FRONT among p's 8 neighbours on the given side and ring. */
  const neighbours = (q: Decision, inside: boolean, ring: number): number => {
    let best = 0;
    const x = q.p % W;
    const y = (q.p - x) / W;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = at[ny * W + nx];
        if (j >= 0 && decisions[j].front === q.front && decisions[j].inside === inside && decisions[j].ring === ring) best = Math.max(best, alphaOf[j]);
      }
    }
    return best;
  };
  for (const k of order) {
    const q = decisions[k];
    let alpha = q.matte;
    if (q.inside && q.ring > 1) alpha = Math.max(q.own, q.matte);
    else if (q.inside) alpha = Math.max(alpha, neighbours(q, false, 1));
    else if (q.ring > 1) alpha = Math.min(alpha, neighbours(q, false, q.ring - 1));
    if (alpha <= OPAQUE_ALPHA_ABOVE) alpha = 0;
    else if (alpha >= 255 - OPAQUE_ALPHA_ABOVE) alpha = 255;
    alphaOf[k] = alpha;
  }
  // Every write is planned first, per part, so a part's pieces can be held before anything lands.
  const planned: Array<Map<number, readonly [number, number, number, number]>> = parts.map(() => new Map());
  const plan = (i: number, p: number, r: number, g: number, bl: number, al: number): void => {
    const d = parts[i].data;
    const s = p * 4;
    if (d[s] === r && d[s + 1] === g && d[s + 2] === bl && d[s + 3] === al) return;
    if (busy && al > d[s + 3] && !supports(i, p)) {
      skipped.support++;
      return;
    }
    planned[i].set(p, [r, g, bl, al]);
  };
  /** Per part, the pixels it fills as BEHIND, with the FRONT part over them. */
  const fills: Array<Map<number, number>> = parts.map(() => new Map());
  decisions.forEach((q, k) => {
    const s = q.p * 4;
    const P = [srcr.data[s], srcr.data[s + 1], srcr.data[s + 2]];
    // An existing BEHIND surface keeps its own colour. Unmix FRONT against
    // that same surface so the pair still reconstructs the painting.
    const cb = q.behind >= 0 && parts[q.behind].data[s + 3] >= EDGE_OWNER_ALPHA
      ? [parts[q.behind].data[s], parts[q.behind].data[s + 1], parts[q.behind].data[s + 2]]
      : q.cb;
    const unmixAt = (c: number, a: number): number => Math.min(255, Math.max(0, Math.round(cb[c] + ((P[c] - cb[c]) * 255) / a)));
    // FRONT's colour is clamped to 0..255, so a pixel the two colours cannot mix at that coverage (a painted line darker or
    // lighter than both) would miss the painting: FRONT's coverage rises to the least that brings the composite within half
    // the contrast floor of it (at full coverage it is the painting).
    const miss = (a: number): number => Math.max(...[0, 1, 2].map((c) => Math.abs(Math.round((unmixAt(c, a) * a + cb[c] * (255 - a)) / 255) - P[c])));
    let alpha = alphaOf[k];
    if (alpha > 0 && alpha < 255) while (alpha < 255 && 2 * miss(alpha) > EDGE_CONTRAST) alpha++;
    if (alpha >= 255 - OPAQUE_ALPHA_ABOVE) alpha = 255;
    const unmix = (c: number): number => unmixAt(c, alpha);
    // Busy ground: a BEHIND raise outside BEHIND's own support is refused in `plan`, so FRONT is not lowered there either —
    // FRONT keeps the coverage it had, and a seam whose two supports do not overlap is never left transparent.
    // The refused BEHIND raise below is the one counted in `skipped.support`.
    const behindRefused = busy && q.behind >= 0 && alpha < 255 && parts[q.behind].data[s + 3] < 255 && !supports(q.behind, q.p);
    const keepFront = behindRefused && alpha < parts[q.front].data[s + 3];
    if (keepFront) {
      // FRONT keeps its coverage: nothing is planned for it here.
    } else if (alpha === 0) plan(q.front, q.p, 0, 0, 0, 0);
    else if (alpha === 255) plan(q.front, q.p, P[0], P[1], P[2], 255);
    else plan(q.front, q.p, unmix(0), unmix(1), unmix(2), alpha);
    if (q.behind >= 0 && alpha < 255) {
      if (alpha === 0) plan(q.behind, q.p, P[0], P[1], P[2], 255);
      else plan(q.behind, q.p, cb[0], cb[1], cb[2], 255);
      fills[q.behind].set(q.p, q.front);
    }
  });
  // A part's art (alpha above the floor) keeps its pieces: rigc takes one closed outline per mesh, read 4-connected
  // (`CONTOUR_ONE_ISLAND`). A new piece holding none of the part's art is not written.
  planned.forEach((writes, i) => {
    if (writes.size === 0) return;
    const before = newMask(W, H);
    for (let p = 0; p < W * H; p++) before.data[p] = parts[i].data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE ? 1 : 0;
    const after = (): Mask => {
      const m = newMask(W, H);
      m.data.set(before.data);
      for (const [p, v] of writes) m.data[p] = v[3] > OPAQUE_ALPHA_ABOVE ? 1 : 0;
      return m;
    };
    const was = connectedComponents(before, 4);
    let now = connectedComponents(after(), 4);
    const pieces = new Map<number, Set<number>>();
    for (let p = 0; p < W * H; p++) {
      const o = was.labels[p];
      const l = now.labels[p];
      if (o === 0 || l === 0) continue;
      const set = pieces.get(o) ?? new Set<number>();
      set.add(l);
      pieces.set(o, set);
    }
    // A piece of art the step would split: each cut-off part of it is joined back to its largest part along the path that
    // restores the fewest lowered pixels (a 0-1 search inside the piece as it was), and only those are not written.
    for (const [o, set] of pieces) {
      if (set.size < 2) continue;
      const labels = [...set].sort((u, v) => now.stats[v].area - now.stats[u].area || u - v);
      const main = labels[0];
      const cost = new Int32Array(W * H).fill(-1);
      const from = new Int32Array(W * H).fill(-1);
      const deque = new Int32Array(2 * W * H + 2);
      let head = W * H + 1;
      let tail = head;
      const nowOver = after();
      for (let p = 0; p < W * H; p++) {
        if (now.labels[p] === main && was.labels[p] === o) {
          cost[p] = 0;
          deque[tail++] = p;
        }
      }
      while (head < tail) {
        const p = deque[head++];
        const x = p % W;
        for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]) {
          if (q < 0 || q >= W * H || was.labels[q] !== o) continue;
          const step = nowOver.data[q] === 1 ? 0 : 1;
          if (cost[q] !== -1 && cost[q] <= cost[p] + step) continue;
          cost[q] = cost[p] + step;
          from[q] = p;
          if (step === 0) deque[--head] = q;
          else deque[tail++] = q;
        }
      }
      for (const l of labels.slice(1)) {
        let best = -1;
        for (let p = 0; p < W * H; p++) if (now.labels[p] === l && cost[p] >= 0 && (best < 0 || cost[p] < cost[best])) best = p;
        for (let p = best; p >= 0 && cost[p] > 0; p = from[p]) {
          if (nowOver.data[p] === 0 && writes.delete(p)) skipped.pieces++;
        }
      }
    }
    now = connectedComponents(after(), 4);
    const holdsArt = new Uint8Array(now.count);
    for (let p = 0; p < W * H; p++) if (before.data[p] === 1) holdsArt[now.labels[p]] = 1;
    for (const [p] of [...writes]) {
      const l = now.labels[p];
      if (l !== 0 && holdsArt[l] === 0) {
        writes.delete(p);
        skipped.pieces++;
        // A fill BEHIND cannot take: FRONT takes the painting's pixel whole, so the composite there is still the painting
        // (FRONT is later in draw order, so its own pieces are held after this).
        const front = fills[i].get(p);
        if (front !== undefined) {
          if (busy && !supports(front, p)) skipped.support++;
          else planned[front].set(p, [srcr.data[p * 4], srcr.data[p * 4 + 1], srcr.data[p * 4 + 2], 255]);
        }
      }
    }
  });
  const changed = parts.map(() => newMask(W, H));
  planned.forEach((writes, i) => {
    const d = parts[i].data;
    for (const [p, v] of writes) {
      d.set(v, p * 4);
      changed[i].data[p] = 1;
    }
  });
  // Complete the existing allocation only where the final stack draws nothing.
  // Read every candidate before writes, retaining a four-connected witness in
  // the receiver's existing art and all authored soft/locked boundaries.
  const restore = fill.filter(([p, front]) => {
    if (options.figure?.data[p] !== 1 || !options.editable[front] || locked[p] === 1 ||
      options.keep?.some(m => m?.data[p] === 1) || options.feathered?.some(m => m?.data[p] === 1) ||
      (busy && !supports(front, p)) || parts.some(r => r.data[p * 4 + 3] > 0)) return false;
    const d = parts[front].data, x = p % W;
    return (x > 0 && d[(p - 1) * 4 + 3] > OPAQUE_ALPHA_ABOVE) ||
      (x + 1 < W && d[(p + 1) * 4 + 3] > OPAQUE_ALPHA_ABOVE) ||
      (p >= W && d[(p - W) * 4 + 3] > OPAQUE_ALPHA_ABOVE) ||
      (p + W < W * H && d[(p + W) * 4 + 3] > OPAQUE_ALPHA_ABOVE);
  });
  // Freeze the final rest witnesses before filling: a new write cannot supply
  // another pixel's owner. Keep the existing allocation and all soft boundaries.
  // Busy-ground figure/support policy is a separate contract.
  const figure = options.figure;
  if (!busy && figure !== undefined) {
    for (let y = 1; y + 1 < H; y++) {
      for (let x = 1; x + 1 < W; x++) {
        const p = y * W + x;
        if (locked[p] === 1 ||
          options.keep?.some(m => m?.data[p] === 1) || options.feathered?.some(m => m?.data[p] === 1)) continue;
        const neighbours = [p - 1, p + 1, p - W, p + W];
        if (![p, ...neighbours].every(q => figure.data[q] === 1 && srcr.data[q * 4 + 3] > 0)) continue;
        // PIL's integer source-over alpha, including divide-by-255 rounding.
        let alpha = 0;
        for (const part of parts) {
          const a = part.data[p * 4 + 3];
          const t = a * 255 + alpha * (255 - a) + 128;
          alpha = ((t >>> 8) + t) >>> 8;
        }
        if (alpha === 0 || alpha >= 128) continue;
        // The gap rule's distances and front-first ties, restricted to owners
        // with a four-connected witness in the assembled rest output.
        let front = -1;
        let distance = cap;
        for (let k = n - 1; k >= 0; k--) {
          if (near[k][p] < distance && neighbours.some(q => parts[k].data[q * 4 + 3] > 0)) {
            front = k;
            distance = near[k][p];
          }
        }
        // Complete an existing surface in front before adding opaque paint
        // beneath it. Without a witnessed holder, retain the gap allocation.
        for (let k = n - 1; k >= 0; k--) {
          if (parts[k].data[p * 4 + 3] > 0 && neighbours.some(q => parts[k].data[q * 4 + 3] > 0)) {
            front = k;
            break;
          }
        }
        if (front < 0 || !options.editable[front]) continue;
        // A covered edge decision can return before setting locked[p].
        if (parts.some((part, k) => k !== front && part.data[p * 4 + 3] > 0 && options.movingPair?.(front, k) === true)) continue;
        restore.push([p, front]);
      }
    }
  }
  for (const [p, front] of restore) {
    const s = p * 4;
    parts[front].data.set([srcr.data[s], srcr.data[s + 1], srcr.data[s + 2], 255], s);
    changed[front].data[p] = 1;
  }
  planned.forEach((writes, i) => {
    for (const p of writes.keys()) options.written?.(i, p);
  });
  for (const [p, front] of restore) if (!planned[front].has(p)) options.written?.(front, p);
  return { changed, resolved, unseparated, skipped };
}
