/**
 * The instruments behind `check`'s six judgement lines (issue #11, and #31
 * for texture stretch): what an eye used to be asked about a rendered idle,
 * turned into figures read off rigc's frames, its `geometry.json`,
 * `parts.json` and `motion.json`.
 *
 * Everything here is pure: frames, part records and specs in, figures out.
 * `src/check.ts` owns the rigc renders that produce the frames and the bars
 * the figures are held to.
 *
 * ⭐ **A region is chosen by the See-through tag a part came from, never by a
 * part's name** (`parts.json`'s `from`, read through `src/tags.ts`). The
 * torso is `topwear`, the feet `footwear`, the eyes `eyewhite`, the swinging
 * cloth `handwear` and `bottomwear`, the face `face` less the parts drawn on
 * it (`eyewhite`, `irides`, `eyelash`, `eyebrow`, `mouth`). A part is drawn by
 * the slot of its own name — the rig stage's contract, which `check` holds
 * with `CHECK_PART_SLOT_PRESENT` — so a region's slots follow from its parts.
 *
 * A chain is read off the rig's bone TREE and the idle's rotate tracks, not
 * off link names: a keyed bone's chain parent is its nearest ancestor that is
 * itself keyed, which is also how the control bones `<bone>_ctl` fall into
 * place without being recognised by their suffix.
 */
import type { StageBox, Viewport } from './check.ts';
import { cropToSpineY } from './coords.ts';
import { edgeLength } from './length.ts';
import { OPAQUE_ALPHA_ABOVE } from './layers.ts';
import { type PartRecord, type PartsFile, tagOf } from './parts.ts';
import type { Raster } from './raster/types.ts';
import { type BaseTag, readTag } from './tags.ts';

// ---------------------------------------------------------------------------
// regions, by tag
// ---------------------------------------------------------------------------

/**
 * The v3 base tag a part came from, or null for a `painting:` patch — which no
 * tag classifies, so no region picks it — or a `from` that is neither
 * (readParts already refused that).
 */
export function baseTagOf(p: PartRecord): BaseTag | null {
  const t = tagOf(p.from);
  return t === null ? null : (readTag(t)?.base ?? null);
}

export function partsTagged(parts: PartsFile, tags: readonly BaseTag[]): PartRecord[] {
  return parts.parts.filter((p) => {
    const t = baseTagOf(p);
    return t !== null && tags.includes(t);
  });
}

export const TORSO_TAGS: readonly BaseTag[] = ['topwear'];
export const FEET_TAGS: readonly BaseTag[] = ['footwear'];
export const EYE_TAGS: readonly BaseTag[] = ['eyewhite'];
export const SWING_TAGS: readonly BaseTag[] = ['handwear', 'bottomwear'];
export const FACE_TAGS: readonly BaseTag[] = ['face'];
/** Drawn on the face and moved by the blink or the mouth: left out of the face-outline region. */
export const FACE_FEATURE_TAGS: readonly BaseTag[] = ['eyewhite', 'irides', 'eyelash', 'eyebrow', 'mouth'];

/** A box in frame pixels, half-open: x0 <= x < x1, y0 <= y < y1, clipped to the frame. */
export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Frame pixel x of rig (crop) pixel column u: crop -> world through the stage box, world -> frame through the viewport. */
function frameX(u: number, stage: StageBox, vp: Viewport): number {
  return (stage.x + u - vp.x) * vp.scale;
}

/** Frame pixel y of rig (crop) pixel row v; world y goes through `cropToSpineY`, the one door. */
function frameY(v: number, H: number, stage: StageBox, vp: Viewport): number {
  return (vp.y + vp.height - (stage.y + cropToSpineY(v, H))) * vp.scale;
}

/**
 * The frame-pixel box covering the union of parts' rig boxes: every frame
 * pixel any of them touches (floor of the near edge, ceil of the far one),
 * clipped to the frame. Null for no part or a box entirely off the frame.
 *
 * {@link frameX} and {@link frameY} carry pixel EDGES, continuous positions,
 * so they take no `0.5 (s - 1)` term: that term belongs to a map between
 * pixel indices, centre to centre (`rigToFrameMap` in check.ts, issue #209).
 * Rig pixel u's left edge is frame position s (stage.x + u - vp.x), and the
 * frame pixel holding it is that position's floor.
 */
export function frameBox(ps: readonly PartRecord[], rigH: number, stage: StageBox, vp: Viewport): PixelBox | null {
  if (ps.length === 0) return null;
  const x0 = Math.max(0, Math.floor(Math.min(...ps.map((p) => frameX(p.x, stage, vp)))));
  const x1 = Math.min(vp.pixelWidth, Math.ceil(Math.max(...ps.map((p) => frameX(p.x + p.w, stage, vp)))));
  const y0 = Math.max(0, Math.floor(Math.min(...ps.map((p) => frameY(p.y, rigH, stage, vp)))));
  const y1 = Math.min(vp.pixelHeight, Math.ceil(Math.max(...ps.map((p) => frameY(p.y + p.h, rigH, stage, vp)))));
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

export function boxLabel(b: PixelBox): string {
  return `${b.x0},${b.y0} ${b.x1 - b.x0}x${b.y1 - b.y0}`;
}

/**
 * Which part is on top at every rig pixel of the flat stack: the index (in
 * parts.json order) of the last part whose alpha there is above
 * `OPAQUE_ALPHA_ABOVE`, or -1. `alphaOf(i)` is part i's PNG.
 */
export function topmostIndex(parts: PartsFile, alphaOf: (i: number) => Raster): Int32Array {
  const [W, H] = parts.rig_size;
  const top = new Int32Array(W * H).fill(-1);
  parts.parts.forEach((p, i) => {
    const im = alphaOf(i);
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) if (im.data[(y * p.w + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE) top[(p.y + y) * W + p.x + x] = i;
    }
  });
  return top;
}

// ---------------------------------------------------------------------------
// heat
// ---------------------------------------------------------------------------

/** Each pixel's largest per-channel RGB change from frame 0 across the frames — the red channel `motion_heat.png` blends in. */
export function heatField(frames: readonly Raster[]): Uint8Array {
  const f0 = frames[0];
  const n = f0.width * f0.height;
  const d = new Uint8Array(n);
  for (const f of frames) {
    for (let p = 0; p < n; p++) {
      for (let c = 0; c < 3; c++) {
        const v = Math.abs(f.data[p * 4 + c] - f0.data[p * 4 + c]);
        if (v > d[p]) d[p] = v;
      }
    }
  }
  return d;
}

/**
 * The breath alone (issue #411): each pixel's largest per-channel RGB change
 * that the breath makes, read off the idle rendered twice on one grid — with
 * its breath tracks (`withBreath`) and without them (`withoutBreath`). At
 * frame t the breath's own change at a pixel is (with_t - with_0) -
 * (without_t - without_0): motion that is the same in both renders (a keyed
 * cloth swing, a physics response to the world, a head turn) cancels, and so
 * does a constant offset the breath holds from frame 0 on, while physics that
 * the breath sets moving stays. The field is that change's largest magnitude
 * over the frames and the three channels, capped at 255 — {@link heatField}'s
 * reading when the render without the breath does not move. Both lists hold
 * the same number of frames of one size; the caller holds the grid.
 */
export function breathHeat(withBreath: readonly Raster[], withoutBreath: readonly Raster[]): Uint8Array {
  const w0 = withBreath[0].data;
  const o0 = withoutBreath[0].data;
  const n = withBreath[0].width * withBreath[0].height;
  const d = new Uint8Array(n);
  withBreath.forEach((f, i) => {
    const w = f.data;
    const o = withoutBreath[i].data;
    for (let p = 0; p < n; p++) {
      for (let c = 0; c < 3; c++) {
        const k = p * 4 + c;
        const v = Math.min(255, Math.abs(w[k] - w0[k] - (o[k] - o0[k])));
        if (v > d[p]) d[p] = v;
      }
    }
  });
  return d;
}

export interface RegionHeat {
  /** Pixels measured. */
  px: number;
  mean: number;
  max: number;
}

/** Heat over a box, or over the pixels of `mask` inside it. */
export function regionHeat(heat: Uint8Array, width: number, box: PixelBox, mask?: Uint8Array): RegionHeat {
  let px = 0;
  let sum = 0;
  let max = 0;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = y * width + x;
      if (mask !== undefined && mask[i] === 0) continue;
      px++;
      sum += heat[i];
      if (heat[i] > max) max = heat[i];
    }
  }
  return { px, mean: px === 0 ? 0 : sum / px, max };
}

// ---------------------------------------------------------------------------
// swing: how far a band of a part's art travels
// ---------------------------------------------------------------------------

/** One attachment on one frame as `rigc-geometry/1` writes it: rest vertices (the setup pose's bones, no deform), posed vertices (world, y up) and triangles. */
export interface PosedTriangles {
  rest: readonly number[];
  posed: readonly number[];
  triangles: readonly number[];
}

/** A part's art on the stage: its box's top-left in stage px and, per pixel, 1 where it is art. */
export interface ArtMask {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;
}

/** How far each half of a part's box sees its art travel, in rig px (world units); null where frame 0 shows no art in that half. */
export interface HalfTravels {
  root: number | null;
  tip: number | null;
}

/** Where a chain's tip lies from its root on the screen (issue #231). */
export type Toward = 'down' | 'up' | 'left' | 'right';

/**
 * Which way a vector in the world (y up) runs (issue #231), read along
 * whichever axis it runs further on — `down`/`up` when |dy| > |dx|,
 * `left`/`right` when |dx| > |dy|. Null when it runs as far on both, which
 * includes the zero vector. `check` holds a part the scene declares `rises` to
 * it: the last link of the chain carrying it, at the setup pose, must read
 * `up` (issue #322; until then the vector was the first link's origin to the
 * last's).
 */
export function chainToward(dx: number, dy: number): Toward | null {
  if (Math.abs(dy) > Math.abs(dx)) return dy < 0 ? 'down' : 'up';
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return null;
}

/** A polygon as x, y pairs. */
type Polygon = number[];

/** Sutherland-Hodgman against one half-plane: keeps a x + b y + c >= 0. */
function clipHalfPlane(poly: Polygon, a: number, b: number, c: number): Polygon {
  const out: Polygon = [];
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const x1 = poly[2 * i];
    const y1 = poly[2 * i + 1];
    const x2 = poly[2 * j];
    const y2 = poly[2 * j + 1];
    const d1 = a * x1 + b * y1 + c;
    const d2 = a * x2 + b * y2 + c;
    if (d1 >= 0) out.push(x1, y1);
    if (d1 >= 0 !== d2 >= 0) {
      const t = d1 / (d1 - d2);
      out.push(x1 + t * (x2 - x1), y1 + t * (y2 - y1));
    }
  }
  return out;
}

/** A polygon clipped to the rectangle x0 <= x <= x1, y0 <= y <= y1. */
function clipRect(poly: Polygon, x0: number, y0: number, x1: number, y1: number): Polygon {
  let p = clipHalfPlane(poly, 1, 0, -x0);
  if (p.length >= 6) p = clipHalfPlane(p, -1, 0, x1);
  if (p.length >= 6) p = clipHalfPlane(p, 0, 1, -y0);
  if (p.length >= 6) p = clipHalfPlane(p, 0, -1, y1);
  return p;
}

/** A polygon's area and first moments (shoelace), signed by its winding: [A, A cx, A cy]. */
function polygonMoments(poly: Polygon): [number, number, number] {
  let a = 0;
  let mx = 0;
  let my = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const cr = poly[2 * i] * poly[2 * j + 1] - poly[2 * j] * poly[2 * i + 1];
    a += cr;
    mx += (poly[2 * i] + poly[2 * j]) * cr;
    my += (poly[2 * i + 1] + poly[2 * j + 1]) * cr;
  }
  return [a / 2, mx / 6, my / 6];
}

/**
 * The art of one attachment cut by its rest triangles, frame-independent:
 * for each triangle, every piece of an art pixel's square inside it, as the
 * barycentric coordinates (l1, l2 per corner) of the piece's corners, and the
 * triangle's art area and the barycentric coordinates of its art centroid.
 */
interface ArtPieces {
  /** Per triangle: the art area inside it at rest (rig px²), and its centroid as (l1, l2). */
  area: Float64Array;
  centroid: Float64Array;
  /** Per triangle: its pieces, each a flat list of (l1, l2) corner pairs. */
  pieces: Polygon[][];
}

function artPieces(art: ArtMask, a: PosedTriangles, stage: StageBox): ArtPieces {
  const H = stage.height;
  const R = a.rest;
  const T = a.triangles;
  const nt = T.length / 3;
  const area = new Float64Array(nt);
  const centroid = new Float64Array(2 * nt);
  const pieces: Polygon[][] = [];
  // World y of each row edge of the art's box: row v's square spans [wy[v + 1 - y0], wy[v - y0]].
  const wy: number[] = [];
  for (let v = art.y; v <= art.y + art.height; v++) wy.push(stage.y + cropToSpineY(v, H));
  for (let t = 0; t < nt; t++) {
    const i = T[3 * t];
    const j = T[3 * t + 1];
    const k = T[3 * t + 2];
    const x0 = R[2 * i];
    const y0 = R[2 * i + 1];
    const ex1 = R[2 * j] - x0;
    const ey1 = R[2 * j + 1] - y0;
    const ex2 = R[2 * k] - x0;
    const ey2 = R[2 * k + 1] - y0;
    const det = ex1 * ey2 - ex2 * ey1;
    const list: Polygon[] = [];
    pieces.push(list);
    if (det === 0) continue;
    const s = det > 0 ? 1 : -1;
    const xs = [x0, R[2 * j], R[2 * k]];
    const ys = [y0, R[2 * j + 1], R[2 * k + 1]];
    const u0 = Math.max(art.x, Math.floor(Math.min(...xs) - stage.x));
    const u1 = Math.min(art.x + art.width, Math.ceil(Math.max(...xs) - stage.x));
    const yLo = Math.min(...ys);
    const yHi = Math.max(...ys);
    let A = 0;
    let L1 = 0;
    let L2 = 0;
    for (let r = 0; r < art.height; r++) {
      const top = wy[r];
      const bottom = wy[r + 1];
      if (bottom >= yHi || top <= yLo) continue;
      for (let u = u0; u < u1; u++) {
        if (art.data[r * art.width + (u - art.x)] !== 1) continue;
        const left = stage.x + u;
        let poly: Polygon = [left, bottom, left + 1, bottom, left + 1, top, left, top];
        for (let e = 0; e < 3 && poly.length >= 6; e++) {
          const ax = xs[e];
          const ay = ys[e];
          const bx = xs[(e + 1) % 3];
          const by = ys[(e + 1) % 3];
          // inside: (b - a) x (q - a) has the triangle's winding
          poly = clipHalfPlane(poly, -(by - ay) * s, (bx - ax) * s, ((by - ay) * ax - (bx - ax) * ay) * s);
        }
        if (poly.length < 6) continue;
        const [pa, pmx, pmy] = polygonMoments(poly);
        if (pa === 0) continue;
        const bary: Polygon = [];
        for (let q = 0; q < poly.length; q += 2) {
          const dx = poly[q] - x0;
          const dy = poly[q + 1] - y0;
          bary.push((dx * ey2 - ex2 * dy) / det, (ex1 * dy - dx * ey1) / det);
        }
        list.push(bary);
        // The rest pieces are counter-clockwise (y up), so their area is positive.
        A += pa;
        const cx = pmx / pa - x0;
        const cy = pmy / pa - y0;
        L1 += pa * ((cx * ey2 - ex2 * cy) / det);
        L2 += pa * ((ex1 * cy - cx * ey1) / det);
      }
    }
    area[t] = A;
    centroid[2 * t] = A === 0 ? 0 : L1 / A;
    centroid[2 * t + 1] = A === 0 ? 0 : L2 / A;
  }
  return { area, centroid, pieces };
}

/**
 * How far the art in each half of a part's box travels over the frames
 * (issue #118): the centroid of the art's AREA inside the half — a fixed
 * band of the stage, the box's upper or lower half, cut at h / 2 — on each
 * frame, and the largest distance of that centroid from frame 0's, in rig px.
 *
 * It is the figure `check` read off a render of the part alone until #118 (a
 * binary-coverage centroid per half of the frame box, frame px), taken in its
 * continuous limit from the posed geometry instead. A centroid rather than
 * the band's heat, as before: heat is texture times motion, and the question
 * is how far the cloth moves. It is a proxy for displacement, not a
 * displacement — art crossing a half's fixed edge moves the centroid too, by
 * design: a band fixed on the stage is the definition. Every art pixel's square (art = the
 * part's alpha above the threshold its mesh is built from) is cut by the
 * attachment's rest triangles, carried by each triangle's own affine map to
 * its posed vertices — the map the runtime draws the texture with — and
 * clipped to the band, exactly (polygon clipping, no sampling). No render
 * grid enters it, so the figure does not change with `--max`, and a travel
 * well under one frame pixel is measured as exactly as a large one.
 *
 * Art outside every rest triangle is not drawn by the runtime and is not
 * counted. A frame on which the slot shows nothing (null) is skipped; a half
 * with no art on frame 0 is null. Each distinct rest attachment is cut once.
 *
 * `toward` is where the tip is from the root (issue #231): `down` — the upper
 * half is the root's and the lower the tip's, the reading before #231 and the
 * default — or `up`, the two swapped, for a part the scene declares `rises`.
 */
export function halfTravels(art: ArtMask, box: { x: number; y: number; w: number; h: number }, stage: StageBox, frames: ReadonlyArray<PosedTriangles | null>, toward: 'down' | 'up' = 'down'): HalfTravels {
  const H = stage.height;
  const bx0 = stage.x + box.x;
  const bx1 = stage.x + box.x + box.w;
  const top = stage.y + cropToSpineY(box.y, H);
  const mid = stage.y + cropToSpineY(box.y + box.h / 2, H);
  const bottom = stage.y + cropToSpineY(box.y + box.h, H);
  // Each band is a rectangle of the world, [x0, y0, x1, y1] (y up).
  const upper = [bx0, mid, bx1, top] as const;
  const lower = [bx0, bottom, bx1, mid] as const;
  const bands = toward === 'down' ? { root: upper, tip: lower } : { root: lower, tip: upper };
  const cut = new Map<readonly number[], ArtPieces>();
  const centroidIn = (a: PosedTriangles, x0: number, y0: number, x1: number, y1: number): [number, number] | null => {
    let pc = cut.get(a.rest);
    if (pc === undefined) {
      pc = artPieces(art, a, stage);
      cut.set(a.rest, pc);
    }
    const P = a.posed;
    const T = a.triangles;
    let A = 0;
    let MX = 0;
    let MY = 0;
    for (let t = 0; t < pc.area.length; t++) {
      if (pc.area[t] === 0) continue;
      const i = T[3 * t];
      const j = T[3 * t + 1];
      const k = T[3 * t + 2];
      const px = P[2 * i];
      const py = P[2 * i + 1];
      const e1x = P[2 * j] - px;
      const e1y = P[2 * j + 1] - py;
      const e2x = P[2 * k] - px;
      const e2y = P[2 * k + 1] - py;
      const xmin = Math.min(px, px + e1x, px + e2x);
      const xmax = Math.max(px, px + e1x, px + e2x);
      const ymin = Math.min(py, py + e1y, py + e2y);
      const ymax = Math.max(py, py + e1y, py + e2y);
      if (xmax <= x0 || xmin >= x1 || ymax <= y0 || ymin >= y1) continue;
      const R = a.rest;
      const restDet = (R[2 * j] - R[2 * i]) * (R[2 * k + 1] - R[2 * i + 1]) - (R[2 * k] - R[2 * i]) * (R[2 * j + 1] - R[2 * i + 1]);
      const posedDet = e1x * e2y - e2x * e1y;
      // The posed area of a rest area: |posed det / rest det| times it.
      const scale = Math.abs(posedDet / restDet);
      if (xmin >= x0 && xmax <= x1 && ymin >= y0 && ymax <= y1) {
        const w = pc.area[t] * scale;
        const l1 = pc.centroid[2 * t];
        const l2 = pc.centroid[2 * t + 1];
        A += w;
        MX += w * (px + l1 * e1x + l2 * e2x);
        MY += w * (py + l1 * e1y + l2 * e2y);
        continue;
      }
      for (const bary of pc.pieces[t]) {
        const poly: Polygon = [];
        for (let q = 0; q < bary.length; q += 2) poly.push(px + bary[q] * e1x + bary[q + 1] * e2x, py + bary[q] * e1y + bary[q + 1] * e2y);
        const c = clipRect(poly, x0, y0, x1, y1);
        if (c.length < 6) continue;
        const [pa, pmx, pmy] = polygonMoments(c);
        // A triangle the pose turns over winds its pieces the other way; what is drawn is the area either way.
        const sg = pa < 0 ? -1 : 1;
        A += sg * pa;
        MX += sg * pmx;
        MY += sg * pmy;
      }
    }
    return A > 0 ? [MX / A, MY / A] : null;
  };
  const travel = (band: readonly [number, number, number, number]): number | null => {
    const first = frames[0];
    const c0 = first === null ? null : centroidIn(first, ...band);
    if (c0 === null) return null;
    let max = 0;
    for (const f of frames) {
      const c = f === null ? null : centroidIn(f, ...band);
      if (c === null) continue;
      max = Math.max(max, edgeLength(c[0] - c0[0], c[1] - c0[1]));
    }
    return max;
  };
  return { root: travel(bands.root), tip: travel(bands.tip) };
}

// ---------------------------------------------------------------------------
// sines and chains, off motion.json
// ---------------------------------------------------------------------------

export interface SineReading {
  period: number;
  /** |amplitude|: a sine's sign is a half-cycle of phase, and the keys cannot tell the two apart. */
  amp: number;
  /** Cycles, in [0, 1): `v = base + amp sin(2 pi (t / period - phase))`. */
  phase: number;
}

interface Key {
  t: number;
  v: number[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function keysOf(track: Record<string, unknown>): Key[] | null {
  const ks = track.keys;
  if (!Array.isArray(ks)) return null;
  const out: Key[] = [];
  for (const k of ks) {
    if (!isRecord(k) || typeof k.t !== 'number' || !Array.isArray(k.v) || typeof k.v[0] !== 'number') return null;
    out.push({ t: k.t, v: k.v as number[] });
  }
  return out;
}

/**
 * Read a track as the sampled sine `src/motion.ts` writes: keys at equal steps
 * from 0 to the idle's duration, last equal to first. The fundamental is the
 * strongest bin of the discrete Fourier transform of the first n keys; its
 * magnitude is the amplitude and its argument the phase. Null for a track that
 * is not sampled that way (a hand-authored curve) — it is listed as unread,
 * never guessed at.
 */
export function readSine(keys: readonly Key[], duration: number): SineReading | null {
  const n = keys.length - 1;
  if (n < 3 || keys[0].t !== 0 || Math.abs(keys[n].t - duration) > 1e-6) return null;
  for (let k = 0; k <= n; k++) if (Math.abs(keys[k].t - (duration * k) / n) > 1e-6) return null;
  const v = keys.slice(0, n).map((k) => k.v[0]);
  let best = { j: 0, a: 0, b: 0, mag: 0 };
  for (let j = 1; j < n / 2; j++) {
    let a = 0;
    let b = 0;
    for (let k = 0; k < n; k++) {
      a += v[k] * Math.sin((2 * Math.PI * j * k) / n);
      b += v[k] * Math.cos((2 * Math.PI * j * k) / n);
    }
    a *= 2 / n;
    b *= 2 / n;
    const mag = edgeLength(a, b);
    if (mag > best.mag) best = { j, a, b, mag };
  }
  if (best.j === 0) return null;
  // v = A sin(x - psi) = A cos(psi) sin x - A sin(psi) cos x, so a = A cos psi and b = -A sin psi.
  const psi = Math.atan2(-best.b, best.a);
  const phase = (((psi / (2 * Math.PI)) % 1) + 1) % 1;
  return { period: duration / best.j, amp: best.mag, phase };
}

/** A phase difference in cycles, folded into (-1/4, 1/4]: the sign of a sine is half a cycle, so a lag is only readable modulo half a cycle. */
export function lagStep(from: number, to: number): number {
  let d = (((to - from) % 0.5) + 0.5) % 0.5;
  if (d > 0.25) d -= 0.5;
  return d;
}

export interface ChainLink {
  bone: string;
  reading: SineReading;
}

export interface ChainEdge {
  parent: string;
  child: string;
  /** {@link lagStep} of the two phases below. */
  step: number;
  /** The phases the step was folded from, as {@link readSine} returns them (issue #580): a negative amplitude already read as amplitude > 0 at phase + 0.5. */
  parentPhase: number;
  childPhase: number;
}

export interface ChainFigures {
  /** Unbranched runs of rotate-keyed bones, each link the keyed child of the one before at the same period. */
  chains: ChainLink[][];
  /** Every keyed bone under a keyed ancestor of the same period: the lag from that ancestor. */
  edges: ChainEdge[];
  /** Keyed bones under a keyed ancestor of another period: their phases are not comparable. */
  otherPeriod: Array<{ parent: string; child: string }>;
  /** Rotate-keyed bones whose track is not a sampled sine, or that carry more than one rotate track. */
  unread: string[];
}

/**
 * The rotate channels of the idle, read as sines and arranged by the rig's
 * bone tree. Only bone tracks and group tracks with property `rotate` are
 * read; a group track keys each of its members.
 */
export function chainFigures(rig: Record<string, unknown>, motion: Record<string, unknown>): ChainFigures {
  const bones = (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord).filter((b) => typeof b.name === 'string') as Array<Record<string, unknown> & { name: string }>;
  const order = new Map(bones.map((b, i) => [b.name, i]));
  const parent = new Map(bones.map((b) => [b.name, typeof b.parent === 'string' ? b.parent : null]));
  const anims = isRecord(motion.animations) ? motion.animations : {};
  const idle = isRecord(anims.idle) ? anims.idle : {};
  const duration = typeof idle.duration === 'number' ? idle.duration : 0;
  const groups = isRecord(motion.groups) ? motion.groups : {};
  const tracksOn = new Map<string, Key[][]>();
  const unreadable = new Set<string>();
  for (const t of Array.isArray(idle.tracks) ? idle.tracks.filter(isRecord) : []) {
    if (t.property !== 'rotate') continue;
    const targets = typeof t.bone === 'string' ? [t.bone] : typeof t.group === 'string' && Array.isArray(groups[t.group]) ? (groups[t.group] as unknown[]).filter((m): m is string => typeof m === 'string') : [];
    const keys = keysOf(t);
    for (const b of targets) {
      if (keys === null) unreadable.add(b);
      else tracksOn.set(b, [...(tracksOn.get(b) ?? []), keys]);
    }
  }
  const reading = new Map<string, SineReading>();
  for (const [b, ts] of tracksOn) {
    const r = ts.length === 1 ? readSine(ts[0], duration) : null;
    if (r === null) unreadable.add(b);
    else reading.set(b, r);
  }
  const byOrder = (a: string, b: string): number => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || (a < b ? -1 : a > b ? 1 : 0);
  const keyed = [...reading.keys()].sort(byOrder);
  const keyedParent = new Map<string, string | null>();
  for (const b of keyed) {
    let p = parent.get(b) ?? null;
    const seen = new Set<string>();
    while (p !== null && !reading.has(p) && !seen.has(p)) {
      seen.add(p);
      p = parent.get(p) ?? null;
    }
    keyedParent.set(b, p !== null && reading.has(p) ? p : null);
  }
  const kids = new Map<string, string[]>();
  for (const b of keyed) {
    const p = keyedParent.get(b) ?? null;
    if (p !== null) kids.set(p, [...(kids.get(p) ?? []), b]);
  }
  const samePeriod = (a: string, b: string): boolean => Math.abs((reading.get(a) as SineReading).period - (reading.get(b) as SineReading).period) < 1e-9;
  const edges: ChainEdge[] = [];
  const otherPeriod: Array<{ parent: string; child: string }> = [];
  for (const b of keyed) {
    const p = keyedParent.get(b) ?? null;
    if (p === null) continue;
    if (samePeriod(p, b)) {
      const from = (reading.get(p) as SineReading).phase;
      const to = (reading.get(b) as SineReading).phase;
      edges.push({ parent: p, child: b, step: lagStep(from, to), parentPhase: from, childPhase: to });
    } else otherPeriod.push({ parent: p, child: b });
  }
  const continues = (b: string): string | null => {
    const k = kids.get(b) ?? [];
    return k.length === 1 && samePeriod(b, k[0]) ? k[0] : null;
  };
  const chains: ChainLink[][] = [];
  for (const b of keyed) {
    const p = keyedParent.get(b) ?? null;
    if (p !== null && continues(p) === b) continue;
    const links: ChainLink[] = [];
    let cur: string | null = b;
    while (cur !== null) {
      links.push({ bone: cur, reading: reading.get(cur) as SineReading });
      cur = continues(cur);
    }
    chains.push(links);
  }
  return { chains, edges, otherPeriod, unread: [...unreadable].sort(byOrder) };
}

// ---------------------------------------------------------------------------
// the blink
// ---------------------------------------------------------------------------

export interface BlinkTrack {
  /** How the track names what it keys, as motion.json spells it. */
  target: { bone: string } | { group: string };
  /** The smallest `scaley` it keys — the closed eye. */
  closed: number;
  /** The first and last key time at that value. */
  window: [number, number];
}

/**
 * The bones an eye part's slot is moved by through `scaley` without changing
 * shape: the slot's bone, and each ancestor it sits at the origin of (local
 * x = y = 0) — which is how a control bone is attached, so a blink moved to a
 * control is found without reading its name.
 */
export function eyeBones(rig: Record<string, unknown>, slotBones: readonly string[]): Set<string> {
  const bones = new Map((Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord).map((b) => [String(b.name), b]));
  const out = new Set<string>();
  for (const s of slotBones) {
    let cur: string | null = s;
    while (cur !== null && !out.has(cur)) {
      out.add(cur);
      const b = bones.get(cur);
      if (b === undefined || (b.x ?? 0) !== 0 || (b.y ?? 0) !== 0) break;
      cur = typeof b.parent === 'string' ? b.parent : null;
    }
  }
  return out;
}

/** The idle's `scaley` tracks on the eye bones (directly or through a group) that go below their first key: the blink. */
export function blinkTracks(motion: Record<string, unknown>, eyes: ReadonlySet<string>): BlinkTrack[] {
  const anims = isRecord(motion.animations) ? motion.animations : {};
  const idle = isRecord(anims.idle) ? anims.idle : {};
  const groups = isRecord(motion.groups) ? motion.groups : {};
  const out: BlinkTrack[] = [];
  for (const t of Array.isArray(idle.tracks) ? idle.tracks.filter(isRecord) : []) {
    if (t.property !== 'scaley') continue;
    let target: BlinkTrack['target'] | null = null;
    if (typeof t.bone === 'string' && eyes.has(t.bone)) target = { bone: t.bone };
    else if (typeof t.group === 'string' && Array.isArray(groups[t.group]) && (groups[t.group] as unknown[]).some((m) => typeof m === 'string' && eyes.has(m))) target = { group: t.group };
    const keys = keysOf(t);
    if (target === null || keys === null || keys.length === 0) continue;
    const closed = Math.min(...keys.map((k) => k.v[0]));
    if (!(closed < keys[0].v[0])) continue;
    const at = keys.filter((k) => k.v[0] === closed).map((k) => k.t);
    out.push({ target, closed, window: [at[0], at[at.length - 1]] });
  }
  return out;
}

export interface BlinkFigures {
  /** Pixels in the box that show the background with the eyes closed and showed art with them open. */
  holePx: number;
  /** Of the box's pixels with the eyes closed, the largest max-channel distance to the nearest colour the open-eye box holds. */
  patchMax: number;
  /** How many exceed `patchLevel`. */
  patchOver: number;
  px: number;
}

/**
 * The closed-eye frame against the open-eye frame on the same grid, inside
 * the eye box. A hole is background where there was art — the rasteriser
 * paints the background exactly where nothing is drawn. A colour patch is a
 * pixel far from every colour the open eye's box held; that half is a
 * reported figure, not a bar (see AUTHORING §7).
 */
export function blinkFigures(open: Raster, closed: Raster, bg: readonly number[], box: PixelBox, patchLevel: number): BlinkFigures {
  const w = open.width;
  const isBg = (r: Raster, i: number): boolean => r.data[i] === bg[0] && r.data[i + 1] === bg[1] && r.data[i + 2] === bg[2];
  const colours = new Map<number, [number, number, number]>();
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = (y * w + x) * 4;
      colours.set((open.data[i] << 16) | (open.data[i + 1] << 8) | open.data[i + 2], [open.data[i], open.data[i + 1], open.data[i + 2]]);
    }
  }
  const palette = [...colours.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  let holePx = 0;
  let patchMax = 0;
  let patchOver = 0;
  let px = 0;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = (y * w + x) * 4;
      px++;
      if (isBg(closed, i) && !isBg(open, i)) holePx++;
      let near = 255;
      for (const c of palette) {
        const d = Math.max(Math.abs(closed.data[i] - c[0]), Math.abs(closed.data[i + 1] - c[1]), Math.abs(closed.data[i + 2] - c[2]));
        if (d < near) near = d;
        if (near === 0) break;
      }
      if (near > patchMax) patchMax = near;
      if (near > patchLevel) patchOver++;
    }
  }
  return { holePx, patchMax, patchOver, px };
}

// ---------------------------------------------------------------------------
// texture stretch (issue #31)
// ---------------------------------------------------------------------------

/** One mesh attachment's rest shape and topology, as rigc's `geometry.json` `rest` table carries it: world units, the setup pose's bones with no deform. */
export interface MeshRest {
  slot: string;
  attachment: string;
  /** x, y per vertex. */
  vertices: readonly number[];
  /** Vertex index triplets. */
  triangles: readonly number[];
}

/** One frame's skinned attachments, as `geometry.json`'s `frames[i].attachments` carries them. */
export interface GeometryPose {
  index: number;
  attachments: ReadonlyArray<{ slot: string; attachment: string; vertices: readonly number[] }>;
}

/** Where one edge ratio was found: the triangle, its three vertex indices, the edge's two, the frame, and deformed length over rest length. */
export interface StretchAt {
  triangle: number;
  vertices: [number, number, number];
  edge: [number, number];
  frame: number;
  ratio: number;
}

export interface MeshStretch {
  slot: string;
  attachment: string;
  triangles: number;
  /** Frames that show this attachment; 0 leaves `max` and `min` null. */
  frames: number;
  /** The largest edge ratio over every triangle and every frame. */
  max: StretchAt | null;
  /** The smallest. */
  min: StretchAt | null;
  /** Rest edges of length 0, which no ratio can be read off: `triangle`, the edge's two vertices. */
  degenerate: Array<{ triangle: number; edge: [number, number] }>;
}

/**
 * How far a ratio is from 1 in either direction: `max(r, 1/r)`. Compression
 * distorts a texture as much as stretch does — an edge at half its rest length
 * squeezes the texels on it by the factor an edge at twice its rest length
 * spreads them — so the one figure held to a bar reads both, as |ln r| does.
 */
export function stretchSeverity(ratio: number): number {
  return ratio >= 1 ? ratio : 1 / ratio;
}

/** An edge's length: {@link edgeLength} of `src/length.ts` (issues #270, #279), re-exported where the stretch reader first used it. */
export { edgeLength } from './length.ts';

/**
 * For every mesh in `rest`, every triangle's three edges in every frame that
 * shows the attachment: deformed length over rest length, the largest and the
 * smallest, each with the triangle, its vertices, the edge and the frame.
 * Frames are walked in the order given and triangles in index order, and a
 * later value replaces the kept one only when strictly more extreme, so a tie
 * names the earliest frame and then the lowest triangle.
 */
export function stretchFigures(rest: readonly MeshRest[], frames: readonly GeometryPose[]): MeshStretch[] {
  return rest.map((m) => {
    const t = m.triangles;
    const v0 = m.vertices;
    const len = (v: readonly number[], a: number, b: number): number => edgeLength(v[2 * a] - v[2 * b], v[2 * a + 1] - v[2 * b + 1]);
    const out: MeshStretch = { slot: m.slot, attachment: m.attachment, triangles: t.length / 3, frames: 0, max: null, min: null, degenerate: [] };
    const restLen: number[] = [];
    for (let i = 0; i < t.length; i += 3) {
      for (const [a, b] of [[t[i], t[i + 1]], [t[i + 1], t[i + 2]], [t[i + 2], t[i]]] as const) {
        const l = len(v0, a, b);
        restLen.push(l);
        if (l === 0) out.degenerate.push({ triangle: i / 3, edge: [a, b] });
      }
    }
    for (const f of frames) {
      const pose = f.attachments.find((a) => a.slot === m.slot && a.attachment === m.attachment);
      if (pose === undefined) continue;
      out.frames++;
      for (let i = 0; i < t.length; i += 3) {
        const edges = [[t[i], t[i + 1]], [t[i + 1], t[i + 2]], [t[i + 2], t[i]]] as const;
        for (let e = 0; e < 3; e++) {
          const l0 = restLen[i + e];
          if (l0 === 0) continue;
          const [a, b] = edges[e];
          const ratio = len(pose.vertices, a, b) / l0;
          const at = (): StretchAt => ({ triangle: i / 3, vertices: [t[i], t[i + 1], t[i + 2]], edge: [a, b], frame: f.index, ratio });
          if (out.max === null || ratio > out.max.ratio) out.max = at();
          if (out.min === null || ratio < out.min.ratio) out.min = at();
        }
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// the face in the head's own frame (issue #33)
// ---------------------------------------------------------------------------

/** A bone's world transform as rigc's `geometry.json` records it: world = [a b; c d] local + (worldX, worldY), Spine's y-up world units. */
export interface BoneWorld {
  a: number;
  b: number;
  c: number;
  d: number;
  worldX: number;
  worldY: number;
}

/** One bone's world transform at the setup pose and on every frame of a render, in frame order, with each frame's time in seconds. */
export interface BoneTrack {
  bone: string;
  setup: BoneWorld;
  frames: BoneWorld[];
  times: number[];
}

/**
 * The world -> world map that carries the bone from its setup pose to a
 * frame: `frame * setup^-1`, as a {@link BoneWorld} (matrix and translation).
 * Null when the setup transform is singular.
 */
export function setupToFrame(setup: BoneWorld, frame: BoneWorld): BoneWorld | null {
  const det = setup.a * setup.d - setup.b * setup.c;
  if (!(Math.abs(det) > 1e-12)) return null;
  const ia = setup.d / det;
  const ib = -setup.b / det;
  const ic = -setup.c / det;
  const id = setup.a / det;
  const a = frame.a * ia + frame.b * ic;
  const b = frame.a * ib + frame.b * id;
  const c = frame.c * ia + frame.d * ic;
  const d = frame.c * ib + frame.d * id;
  return { a, b, c, d, worldX: frame.worldX - (a * setup.worldX + b * setup.worldY), worldY: frame.worldY - (c * setup.worldX + d * setup.worldY) };
}

/** A box in Spine world units at the setup pose (y up): x0 <= x <= x1, y0 <= y <= y1. */
export interface WorldBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Where a part's art can be, in the head's frame, over the frames: the part's
 * setup-pose box carried by the bone its slot rides to each frame and back
 * through the head's transform, as the bounding box of every corner on every
 * frame (the setup box included). For a feature the head carries rigidly it is
 * the setup box; for one its own bone moves on the face — a brow the blink
 * drops — it is the whole of where it goes. Null when a transform is singular.
 */
export function sweptBox(box: WorldBox, part: BoneTrack, head: BoneTrack): WorldBox | null {
  const corners: Array<[number, number]> = [
    [box.x0, box.y0],
    [box.x1, box.y0],
    [box.x1, box.y1],
    [box.x0, box.y1],
  ];
  let out: WorldBox = { ...box };
  for (let k = 0; k < part.frames.length; k++) {
    const f = setupToFrame(part.setup, part.frames[k]);
    const g = setupToFrame(head.setup, head.frames[k]);
    if (f === null || g === null) return null;
    const det = g.a * g.d - g.b * g.c;
    if (!(Math.abs(det) > 1e-12)) return null;
    for (const [x, y] of corners) {
      // world at frame k, then back through the head's setup -> frame map
      const wx = f.a * x + f.b * y + f.worldX - g.worldX;
      const wy = f.c * x + f.d * y + f.worldY - g.worldY;
      const hx = (g.d * wx - g.b * wy) / det;
      const hy = (-g.c * wx + g.a * wy) / det;
      out = { x0: Math.min(out.x0, hx), y0: Math.min(out.y0, hy), x1: Math.max(out.x1, hx), y1: Math.max(out.y1, hy) };
    }
  }
  return out;
}

/** A part's rig box (crop pixels, y down) as a world box at the setup pose, through the stage box and `cropToSpineY`. */
export function partWorldBox(p: PartRecord, rigH: number, stage: StageBox): WorldBox {
  return { x0: stage.x + p.x, x1: stage.x + p.x + p.w, y0: stage.y + cropToSpineY(p.y + p.h, rigH), y1: stage.y + cropToSpineY(p.y, rigH) };
}

// ---------------------------------------------------------------------------
// still: art that keeps its place in a bone's frame (issue #123)
// ---------------------------------------------------------------------------

/**
 * How many floating-point roundings stand between the rig and one coordinate
 * of a displacement {@link stillReading} returns, on its longest path. Every
 * number on it is a double: rigc's core poser (`@rig-c/core/core`,
 * rig-c 2.15.0) reads a vertex's local coordinates and weights through
 * `Math.fround` and does the arithmetic in doubles, and `geometry.json` carries
 * those doubles. The float32 inputs are the same numbers in the rest vertex and
 * in the posed one, so they cancel. Per coordinate:
 *
 * - rigc's rest vertex, `a x + b y + worldX` (a mesh wholly on one bone
 *   multiplies by its weight 1 and adds the product to 0, both exact): 2
 *   products and 2 sums, **4**;
 * - the posed vertex, the same way, **4**;
 * - {@link setupToFrame}: each entry of the map takes the setup determinant
 *   (3), one division by it (1) and a two-term product sum (3), 7 roundings
 *   relative to the entry; the map's translation `worldX - (a sx + b sy)` adds
 *   4 to those, **11**;
 * - carrying the posed vertex back through the map ({@link stillReading}):
 *   the translation taken off (1), the map's determinant (3), `d wx - b wy`
 *   (3) and the division (1), with the entries' 7, **15**;
 * - the difference with the rest vertex, **1**.
 *
 * That is 35. Each rounding is at most the unit roundoff u = 2^-53 of a
 * quantity no larger than a two-term sum of entries times coordinates,
 * 2 M^2 C (M the largest matrix entry, at least 1; C the largest coordinate),
 * and 2 u C <= 2 ulp(C). So one coordinate is off by at most 70 M^2 ulp(C),
 * and a displacement, the length of two of them, by sqrt(2) times that
 * ({@link stillTolerance}). It is a numerical tolerance and nothing else: no
 * visual allowance is in it.
 */
export const STILL_ROUNDINGS = 35;

/** The spacing of doubles at `x` (> 0): 2^(e - 52) for 2^e <= x < 2^(e + 1). */
export function ulpOf(x: number): number {
  let e = Math.floor(Math.log2(x));
  if (2 ** e > x) e--;
  if (2 ** (e + 1) <= x) e++;
  return 2 ** (e - 52);
}

/** The largest displacement the arithmetic alone can produce ({@link STILL_ROUNDINGS}): sqrt(2) x 2 x 35 x M^2 x ulp(C), with M and C at least 1. */
export function stillTolerance(coordMax: number, entryMax: number): number {
  const m = Math.max(1, entryMax);
  return Math.SQRT2 * 2 * STILL_ROUNDINGS * m * m * ulpOf(Math.max(1, coordMax));
}

/** A frame's map from the setup pose into it, carried back into the reference frame: a bone's {@link setupToFrame}, or null for the screen (the identity). */
export type FrameMap = BoneWorld | null;

/** What {@link stillReading} measures of one slot. */
export interface StillReading {
  /** The largest displacement of any point of its art, rig px, and the frame (index into the set) it is on; null when no frame shows the slot. */
  max: number | null;
  frame: number | null;
  /** Over the frames that show it and each rest triangle with art: that art's area times its centroid's squared displacement, summed, and the areas summed — the RMS's two halves. */
  sumSq: number;
  weight: number;
  /** The largest |coordinate| of its rest and posed vertices, for {@link stillTolerance}. */
  coordMax: number;
}

function backInto(m: FrameMap, x: number, y: number): [number, number] {
  if (m === null) return [x, y];
  const det = m.a * m.d - m.b * m.c;
  const wx = x - m.worldX;
  const wy = y - m.worldY;
  return [(m.d * wx - m.b * wy) / det, (-m.c * wx + m.a * wy) / det];
}

/**
 * How far one slot's art moves relative to a reference frame over the frames
 * (issue #123): on each frame every vertex of the attachment the slot shows is
 * carried back through that frame's map — the reference bone's
 * {@link setupToFrame}, or the screen for null — and compared with its rest
 * position, the setup pose's. Inside a rest triangle the displacement is
 * affine, so its largest length over the art is reached at a corner of an art
 * piece ({@link artPieces}: each art pixel's square cut by the triangle); the
 * RMS weights each triangle's art centroid by its art area. A slot its
 * reference bone carries rigidly reads its arithmetic's rounding and nothing
 * else ({@link stillTolerance}). No render grid enters it.
 */
export function stillReading(art: ArtMask, stage: StageBox, frames: ReadonlyArray<PosedTriangles | null>, maps: readonly FrameMap[]): StillReading {
  const cut = new Map<readonly number[], ArtPieces>();
  let max: number | null = null;
  let frame: number | null = null;
  let sumSq = 0;
  let weight = 0;
  let coordMax = 0;
  frames.forEach((a, k) => {
    if (a === null) return;
    let pc = cut.get(a.rest);
    if (pc === undefined) {
      pc = artPieces(art, a, stage);
      cut.set(a.rest, pc);
    }
    const n = a.rest.length / 2;
    const d = new Float64Array(2 * n);
    for (let v = 0; v < n; v++) {
      const [qx, qy] = backInto(maps[k], a.posed[2 * v], a.posed[2 * v + 1]);
      d[2 * v] = qx - a.rest[2 * v];
      d[2 * v + 1] = qy - a.rest[2 * v + 1];
      coordMax = Math.max(coordMax, Math.abs(a.rest[2 * v]), Math.abs(a.rest[2 * v + 1]), Math.abs(a.posed[2 * v]), Math.abs(a.posed[2 * v + 1]));
    }
    const T = a.triangles;
    let fmax = 0;
    for (let t = 0; t < pc.area.length; t++) {
      if (pc.area[t] === 0) continue;
      const i = T[3 * t];
      const j = T[3 * t + 1];
      const l = T[3 * t + 2];
      const x0 = d[2 * i];
      const y0 = d[2 * i + 1];
      const e1x = d[2 * j] - x0;
      const e1y = d[2 * j + 1] - y0;
      const e2x = d[2 * l] - x0;
      const e2y = d[2 * l + 1] - y0;
      for (const bary of pc.pieces[t]) {
        for (let q = 0; q < bary.length; q += 2) fmax = Math.max(fmax, edgeLength(x0 + bary[q] * e1x + bary[q + 1] * e2x, y0 + bary[q] * e1y + bary[q + 1] * e2y));
      }
      const cx = x0 + pc.centroid[2 * t] * e1x + pc.centroid[2 * t + 1] * e2x;
      const cy = y0 + pc.centroid[2 * t] * e1y + pc.centroid[2 * t + 1] * e2y;
      sumSq += pc.area[t] * (cx * cx + cy * cy);
      weight += pc.area[t];
    }
    if (max === null || fmax > max) {
      max = fmax;
      frame = k;
    }
  });
  return { max, frame, sumSq, weight, coordMax };
}

/** A set of the stage's pixels (crop coordinates, y down): 1 where the pixel is in. */
export interface RigRegion {
  width: number;
  height: number;
  data: Uint8Array;
}

/** How far another slot's art reaches into a region — reported, never a bar (issue #123). */
export interface Crossing {
  /** The largest distance from a point of its art inside the region to the region's edge, rig px. */
  depth: number;
  /** The most of the region its art covers on one frame, rig px², and that frame (index into the set). */
  area: number;
  frame: number;
}

/**
 * How far a slot's art swings into `region` (the stage's pixels at the setup
 * pose) in the reference frame: each art piece carried through its posed
 * triangle and back through the frame's map, clipped exactly to the region's
 * pixel squares. Null when it never enters. The depth is read at the corners
 * of the clipped pieces, each inside one rig pixel, so it can fall short of the
 * true depth by at most a pixel's diagonal; a point that starts outside the
 * region and travels s is never deeper than s.
 */
export function crossingOf(art: ArtMask, stage: StageBox, frames: ReadonlyArray<PosedTriangles | null>, maps: readonly FrameMap[], region: RigRegion): Crossing | null {
  const { width: W, height: H } = region;
  const inR = (u: number, v: number): boolean => u >= 0 && u < W && v >= 0 && v < H && region.data[v * W + u] === 1;
  // The region's box in world units, to pass over the triangles nowhere near it.
  let rx0 = Infinity;
  let rx1 = -Infinity;
  let ry0 = Infinity;
  let ry1 = -Infinity;
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      if (region.data[v * W + u] !== 1) continue;
      rx0 = Math.min(rx0, stage.x + u);
      rx1 = Math.max(rx1, stage.x + u + 1);
      ry0 = Math.min(ry0, stage.y + cropToSpineY(v + 1, H));
      ry1 = Math.max(ry1, stage.y + cropToSpineY(v, H));
    }
  }
  if (rx0 === Infinity) return null;
  // Distance from a world point to the nearest pixel outside the region: rings of pixels around the one holding it.
  const depthAt = (x: number, y: number): number => {
    const u0 = Math.floor(x - stage.x);
    const v0 = Math.floor(H - (y - stage.y));
    let best = Infinity;
    for (let r = 0; r - 1 < best; r++) {
      for (let v = v0 - r; v <= v0 + r; v++) {
        for (let u = u0 - r; u <= u0 + r; u++) {
          if (Math.max(Math.abs(u - u0), Math.abs(v - v0)) !== r || inR(u, v)) continue;
          const sx0 = stage.x + u;
          const sy1 = stage.y + cropToSpineY(v, H);
          best = Math.min(best, edgeLength(Math.max(sx0 - x, 0, x - sx0 - 1), Math.max(sy1 - 1 - y, 0, y - sy1)));
        }
      }
    }
    return best;
  };
  const cut = new Map<readonly number[], ArtPieces>();
  let out: Crossing | null = null;
  frames.forEach((a, k) => {
    if (a === null) return;
    let pc = cut.get(a.rest);
    if (pc === undefined) {
      pc = artPieces(art, a, stage);
      cut.set(a.rest, pc);
    }
    const P = a.posed;
    const T = a.triangles;
    let area = 0;
    let depth = 0;
    for (let t = 0; t < pc.area.length; t++) {
      if (pc.area[t] === 0) continue;
      const [px, py] = backInto(maps[k], P[2 * T[3 * t]], P[2 * T[3 * t] + 1]);
      const [qx, qy] = backInto(maps[k], P[2 * T[3 * t + 1]], P[2 * T[3 * t + 1] + 1]);
      const [sx, sy] = backInto(maps[k], P[2 * T[3 * t + 2]], P[2 * T[3 * t + 2] + 1]);
      if (Math.max(px, qx, sx) <= rx0 || Math.min(px, qx, sx) >= rx1 || Math.max(py, qy, sy) <= ry0 || Math.min(py, qy, sy) >= ry1) continue;
      for (const bary of pc.pieces[t]) {
        const poly: Polygon = [];
        for (let q = 0; q < bary.length; q += 2) poly.push(px + bary[q] * (qx - px) + bary[q + 1] * (sx - px), py + bary[q] * (qy - py) + bary[q + 1] * (sy - py));
        let bx0 = Infinity;
        let bx1 = -Infinity;
        let by0 = Infinity;
        let by1 = -Infinity;
        for (let q = 0; q < poly.length; q += 2) {
          bx0 = Math.min(bx0, poly[q]);
          bx1 = Math.max(bx1, poly[q]);
          by0 = Math.min(by0, poly[q + 1]);
          by1 = Math.max(by1, poly[q + 1]);
        }
        for (let u = Math.floor(bx0 - stage.x); u <= Math.floor(bx1 - stage.x); u++) {
          for (let v = Math.floor(H - (by1 - stage.y)); v <= Math.floor(H - (by0 - stage.y)); v++) {
            if (!inR(u, v)) continue;
            const sx0 = stage.x + u;
            const sy1 = stage.y + cropToSpineY(v, H);
            const c = clipRect(poly, sx0, sy1 - 1, sx0 + 1, sy1);
            if (c.length < 6) continue;
            const pa = Math.abs(polygonMoments(c)[0]);
            if (pa === 0) continue;
            area += pa;
            for (let q = 0; q < c.length; q += 2) depth = Math.max(depth, depthAt(c[q], c[q + 1]));
          }
        }
      }
    }
    if (area === 0) return;
    if (out === null) out = { depth, area, frame: k };
    else {
      out.depth = Math.max(out.depth, depth);
      if (area > out.area) {
        out.area = area;
        out.frame = k;
      }
    }
  });
  return out;
}

