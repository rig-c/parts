/**
 * The head-box proposer: `seethrough.head_box`, the square crop of the source
 * painting the second, head-only See-through run is fed, read off the FULL
 * run's layers.
 *
 * The rule is the reference's (`gen_painting.py --propose-head-box`): take the
 * union of the `face`, `back hair`, `front hair`, `headwear` and `earwear`
 * layers after the ghost clean-up, cut it off 0.35 face heights below the chin
 * (a long lock must not drag the box down), add a 12 % margin, square it on
 * the union's centre, and map it from the full run's canvas to source pixels
 * through the run's own pad (`squarePad`: the source is centred on a square of
 * its longer side, so a portrait painting's x carries the pad and a landscape
 * one's y does; the reference took x only, its paintings being portrait).
 *
 * Two departures, both because the reference's box could not be fed back in:
 *
 * - 🔲 **The box is square by construction.** The reference rounded each edge
 *   on its own, so the two sides could come out a pixel apart (measured: 3 of
 *   the reference's 10 corpus boxes, e.g. 502x503), and the config loader
 *   refuses a non-square head box. Here the near edges are rounded as the
 *   reference rounds them and the side is the larger of its two rounded
 *   extents: square, never smaller than the reference's box, and equal to it
 *   wherever that was already square.
 * - 📐 **The box is held inside the painting.** The reference's box on the
 *   public `demo` character started 118 px above the canvas, and the crop
 *   filled that band with black, which See-through then decomposed. A box that
 *   leaves the canvas is shifted back inside at the same size, and the shift is
 *   reported; a box larger than the painting's short side cannot be held
 *   inside at that size and is refused.
 */
import { type Problem, refuseIfAny } from './errors.ts';
import { squarePad } from './inputs.ts';
import { type LayerSet, OPAQUE_ALPHA_ABOVE } from './layers.ts';
import { pyRound } from './pyfmt.ts';
import { connectedComponents } from './raster/components.ts';
import { newMask } from './raster/types.ts';

/** The layers whose union is the head. */
export const HEAD_LAYERS = ['face', 'back hair', 'front hair', 'headwear', 'earwear'] as const;
/** A layer with fewer opaque pixels than this after the clean-up is not counted as present. */
export const HEAD_LAYER_MIN_PX = 150;

export type Box = [number, number, number, number];

/** Non-empty painting-space crop containment, shared with assemble and preflight. */
export function headBoxInside(box: Box, w: number, h: number): boolean {
  const [x0, y0, x1, y1] = box;
  return x0 >= 0 && y0 >= 0 && x1 <= w && y1 <= h && x1 > x0 && y1 > y0;
}


export interface HeadBoxOptions {
  /** Whether `"back hair"` is included in the union (issue #351); default `true`. */
  backHair?: boolean;
}

export interface HeadBoxWithoutBackHair {
  /** The square box's side in source px without `"back hair"`. */
  edge: number;
  /** The box without `"back hair"` before clamping to the painting. */
  unclamped: Box;
  /** The box without `"back hair"` held inside the painting, or `null` when `edge` exceeds a canvas side. */
  head_box: Box | null;
}

export interface HeadBoxProposal {
  /** The square box, inside the painting: what goes into `seethrough.head_box`. */
  head_box: Box;
  /** The same box before it was held inside the painting (equal to `head_box` when no shift was needed). */
  unclamped: Box;
  /** How far the box was moved to stay inside, in source px. */
  shift: [number, number];
  /** The layers that contributed, with their opaque pixel counts after the ghost clean-up. */
  layers: Array<[string, number]>;
  /** Present when `"back hair"` contributed (with `backHair !== false`, issue #351): the box without `"back hair"`. */
  without_back_hair?: HeadBoxWithoutBackHair;
}

/**
 * The reference assembler's ghost rule, on one layer: keep the 8-connected
 * components of alpha > 8 whose area is at least 40 px and at least 1 % of the
 * largest; zero the rest. Returns the kept opaque pixels as (x, y) lists in the
 * layer's own coordinates.
 *
 * ⚠️ The assemble stage owns the same rule for the parts it writes; this copy
 * reads only which pixels survive, for the box, and says so rather than
 * reaching into a stage that is not this one.
 */
function cleanedOpaque(pixels: { width: number; height: number; data: Uint8ClampedArray }): { xs: number[]; ys: number[] } {
  const m = newMask(pixels.width, pixels.height);
  for (let i = 0; i < m.data.length; i++) m.data[i] = pixels.data[i * 4 + 3] > OPAQUE_ALPHA_ABOVE ? 1 : 0;
  const cc = connectedComponents(m, 8);
  const xs: number[] = [];
  const ys: number[] = [];
  if (cc.count <= 1) return { xs, ys };
  let big = 0;
  for (let i = 1; i < cc.count; i++) big = Math.max(big, cc.stats[i].area);
  const floor = Math.max(40, 0.01 * big);
  const keep = cc.stats.map((s, i) => i > 0 && s.area >= floor);
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (keep[cc.labels[y * m.width + x]]) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  return { xs, ys };
}

/**
 * Propose the head box from the full run's layers for a painting of
 * `source.w` x `source.h` pixels. Every refusal names the value found and the
 * value required.
 */
export function proposeHeadBox(full: LayerSet, source: { w: number; h: number }, opts?: HeadBoxOptions): HeadBoxProposal {
  const problems: Problem[] = [];
  if (!(Number.isInteger(source.w) && Number.isInteger(source.h) && source.w > 0 && source.h > 0)) {
    problems.push({ code: 'HEADBOX_CANVAS_SIZE', object: '--canvas', detail: `is ${source.w}x${source.h}; the painting's size in positive integer pixels is required` });
  }
  if (full.canvas.w !== full.canvas.h) {
    problems.push({ code: 'HEADBOX_RUN_SQUARE', object: full.source, detail: `the full run's canvas is ${full.canvas.w}x${full.canvas.h}; See-through's full run is square` });
  }
  refuseIfAny(problems);

  const pad = squarePad(source.w, source.h);
  const k = pad.side / full.canvas.w;
  const includeBackHair = opts?.backHair !== false;
  // The union does not depend on the order the layers are read in; a name
  // that appears twice is last-wins in draw order (the reference's dict was
  // last-wins in manifest order, and no wrapper output read so far repeats one).
  const boxes = new Map<string, { left: number; top: number; xs: number[]; ys: number[] }>();
  for (const L of full.layers) {
    if (!(HEAD_LAYERS as readonly string[]).includes(L.name)) continue;
    if (!includeBackHair && L.name === 'back hair') continue;
    const { xs, ys } = cleanedOpaque(L.pixels);
    if (xs.length < HEAD_LAYER_MIN_PX) continue;
    boxes.set(L.name, { left: L.left, top: L.top, xs, ys });
  }
  const face = boxes.get('face');
  if (face === undefined) {
    refuseIfAny([
      {
        code: 'HEADBOX_FACE_PRESENT',
        object: full.source,
        detail: `holds no "face" layer with at least ${HEAD_LAYER_MIN_PX} opaque px after the ghost clean-up (found: ${[...boxes.keys()].join(', ') || 'none of the head layers'}); the cut below the chin is measured from it, so the box is not guessed`,
      },
    ]);
  }
  const f = face as { left: number; top: number; xs: number[]; ys: number[] };
  let fy0 = Infinity;
  let fy1 = -Infinity;
  for (const y of f.ys) {
    if (f.top + y < fy0) fy0 = f.top + y;
    if (f.top + y > fy1) fy1 = f.top + y;
  }
  const cut = fy1 + 0.35 * (fy1 - fy0);
  const measureUnion = (entries: Iterable<{ left: number; top: number; xs: number[]; ys: number[] }>): { edge: number; unclamped: Box; shift: [number, number]; head_box: Box | null } => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const b of entries) {
      for (let i = 0; i < b.xs.length; i++) {
        const y = b.top + b.ys[i];
        if (y > cut) continue;
        const x = b.left + b.xs[i];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    const size = Math.max(x1 - x0, y1 - y0) * 1.12;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    // Each edge rounded as the reference rounds it; then the side is the larger
    // of the two rounded extents, so the box is square, never holds less than
    // the reference's, and equals it wherever the reference's was square.
    const ex = [pyRound((cx - size / 2) * k), pyRound((cx + size / 2) * k)];
    const ey = [pyRound((cy - size / 2) * k), pyRound((cy + size / 2) * k)];
    const edge = Math.max(ex[1] - ex[0], ey[1] - ey[0]);
    const bx = ex[0] - pad.left;
    const by = ey[0] - pad.top;
    const unclamped: Box = [bx, by, bx + edge, by + edge];
    if (edge > source.w || edge > source.h) return { edge, unclamped, shift: [0, 0], head_box: null };
    const hold = (lo: number, extent: number): number => (lo < 0 ? -lo : lo + edge > extent ? extent - edge - lo : 0);
    const shift: [number, number] = [hold(bx, source.w), hold(by, source.h)];
    const head_box: Box = [bx + shift[0], by + shift[1], bx + shift[0] + edge, by + shift[1] + edge];
    return { edge, unclamped, shift, head_box };
  };
  const main = measureUnion(boxes.values());
  const without = includeBackHair && boxes.has('back hair') ? measureUnion([...boxes.entries()].filter(([n]) => n !== 'back hair').map(([, b]) => b)) : null;
  if (main.head_box === null) {
    const hairNote =
      without !== null && without.edge < main.edge
        ? ` ("back hair" grew the side from ${without.edge} to ${main.edge} px; without it${without.head_box !== null ? `, [${without.head_box.join(', ')}] (${without.edge}x${without.edge}) fits —` : ''} pass --no-back-hair)`
        : '';
    refuseIfAny([
      {
        code: 'HEADBOX_FITS_CANVAS',
        object: 'head box',
        detail: `is ${main.edge}x${main.edge} source px, proposed at [${main.unclamped.join(', ')}]; the ${source.w}x${source.h} painting cannot hold it at that size, and shrinking it would cut the head${hairNote}`,
      },
    ]);
  }
  return {
    head_box: main.head_box as Box,
    unclamped: main.unclamped,
    shift: main.shift,
    layers: [...boxes.entries()].map(([n, b]) => [n, b.xs.length]),
    ...(without === null ? {} : { without_back_hair: { edge: without.edge, unclamped: without.unclamped, head_box: without.head_box } }),
  };
}
