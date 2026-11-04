import { runEdgeResidualChecks } from './check_edge_residual.ts';
/**
 * Issue #953: `paintingEdges` on hand-computable two-part strips. Each control
 * is read against the definition (the flat composite at a resolved pixel is the
 * painting; a skipped pixel is left as it was), and each skip reason has a
 * planted case next to the positive one.
 */
import { COVERED_ALPHA, ERROR_LIMIT } from '../src/assemble.ts';
import { OPAQUE_ALPHA_ABOVE } from '../src/layers.ts';
import { connectedComponents } from '../src/raster/components.ts';
import { EDGE_CONTRAST, EDGE_OWNER_ALPHA, EDGE_RADIUS, paintingEdges, type PaintingEdgeOptions } from '../src/paintingedges.ts';
import { newMask, newRaster, type Raster } from '../src/raster/types.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
type RGB = readonly [number, number, number];

const W = 24;
const H = 9;
const RED: RGB = [200, 0, 0];
const BLUE: RGB = [0, 0, 200];

/** A layer whose column x has colour `colour(x)` and alpha `alpha(x)` on every row. */
function columns(colour: (x: number) => RGB, alpha: (x: number) => number): Raster {
  const r = newRaster(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4;
      const [cr, cg, cb] = colour(x);
      r.data[s] = cr;
      r.data[s + 1] = cg;
      r.data[s + 2] = cb;
      r.data[s + 3] = alpha(x);
    }
  }
  return r;
}

/** Straight-alpha "over" of the stack, back to front, in float; returns RGB and coverage per pixel. */
function composite(stack: readonly Raster[]): Float64Array {
  const out = new Float64Array(W * H * 4);
  for (const layer of stack) {
    for (let p = 0; p < W * H; p++) {
      const a = layer.data[p * 4 + 3] / 255;
      for (let c = 0; c < 3; c++) out[p * 4 + c] = layer.data[p * 4 + c] * a + out[p * 4 + c] * (1 - a);
      out[p * 4 + 3] = a + out[p * 4 + 3] * (1 - a);
    }
  }
  return out;
}

/** The largest max-channel distance between the composite and the painting, and the least coverage. */
function against(stack: readonly Raster[], painting: Raster): { error: number; coverage: number } {
  const c = composite(stack);
  let error = 0;
  let coverage = 1;
  for (let p = 0; p < W * H; p++) {
    for (let k = 0; k < 3; k++) error = Math.max(error, Math.abs(c[p * 4 + k] - painting.data[p * 4 + k]));
    coverage = Math.min(coverage, c[p * 4 + 3]);
  }
  return { error: Math.round(error), coverage: Math.round(coverage * 1000) / 1000 };
}

const copy = (r: Raster): Raster => ({ width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) });
const options = (extra: Partial<PaintingEdgeOptions> = {}): PaintingEdgeOptions => ({ painted: new Uint8Array(W * H).fill(1), editable: [true, true], ...extra });
const same = (a: Raster, b: Raster): boolean => a.data.every((v, i) => v === b.data[i]);
const count = (masks: ReadonlyArray<{ data: Uint8Array }>): number => masks.reduce((t, m) => t + m.data.reduce((u, v) => u + v, 0), 0);

/** Painting: FRONT colour left of `cut`, BEHIND colour from it. FRONT ramps down over See-through's soft rim; BEHIND is opaque everywhere. */
function strip(front: RGB, behind: RGB, frontAlpha: (x: number) => number, behindAlpha: (x: number) => number = () => 255) {
  const cut = 10;
  const painting = columns((x) => (x < cut ? front : behind), () => 255);
  const stack = [columns(() => behind, behindAlpha), columns(() => front, frontAlpha)];
  return { painting, stack };
}
/** See-through's soft rim: opaque to x = 7, a ramp over 8..11 (its half line between 8 and 9), nothing from 12. */
const RAMP = (x: number): number => (x <= 7 ? 255 : x === 8 ? 200 : x === 9 ? 140 : x === 10 ? 100 : x === 11 ? 50 : 0);

export function runPaintingEdgeChecks(say: Say): void {
  runEdgeResidualChecks(say);
  say(
    'ED9530_CONSTANTS_ARE_THE_ASSEMBLE_LIMITS',
    EDGE_OWNER_ALPHA === COVERED_ALPHA && EDGE_CONTRAST === ERROR_LIMIT && EDGE_RADIUS === 3,
    `EDGE_OWNER_ALPHA ${EDGE_OWNER_ALPHA} vs COVERED_ALPHA ${COVERED_ALPHA}; EDGE_CONTRAST ${EDGE_CONTRAST} vs ERROR_LIMIT ${ERROR_LIMIT}; EDGE_RADIUS ${EDGE_RADIUS}`,
  );

  // A painted contour on the far BEHIND side must not replace the existing
  // surface beneath a partially covered FRONT pixel.
  {
    const darkBlue: RGB = [0, 0, 100];
    const mixed: RGB = [100, 0, 50];
    const painting = columns((x) => x === 9 ? mixed : x < 10 ? RED : darkBlue, () => 255);
    const stack = [columns(() => BLUE, () => 255), columns(() => RED, RAMP)];
    const run = stack.map(copy);
    paintingEdges(run, painting, options());
    const s = (4 * W + 9) * 4;
    const colour = [...run[0].data.slice(s, s + 3)];
    const alpha = run[1].data[s + 3];
    say(
      'ED9553_EXISTING_BEHIND_COLOUR_IS_KEPT_UNDER_PARTIAL_FRONT',
      colour.join(',') === BLUE.join(',') && alpha > 0 && alpha < 255,
      `BEHIND ${colour.join(',')}, FRONT alpha ${alpha}`,
    );
    const blended = composite(run);
    const error = Math.max(...[0, 1, 2].map((c) => Math.abs(blended[s + c] - painting.data[s + c])));
    say(
      'ED9554_FRONT_UNMIX_USES_THE_RETAINED_BEHIND_COLOUR',
      error <= EDGE_CONTRAST / 2 && blended[s + 3] === 1,
      `partial pixel composite error ${error}, coverage ${blended[s + 3]}`,
    );
  }

  // Positive: a sharp painted edge under a soft rim. Before, the ramp past the painting's edge shows FRONT over BEHIND (error above the limit);
  // after, the composite is the painting at every pixel, FRONT's alpha is binary at the painting's edge, and BEHIND stays opaque.
  {
    const { painting, stack } = strip(RED, BLUE, RAMP);
    const before = against(stack, painting);
    const run = stack.map(copy);
    const r = paintingEdges(run, painting, options());
    const after = against(run, painting);
    const row = [...Array(W).keys()].map((x) => run[1].data[(4 * W + x) * 4 + 3]);
    const binary = row.every((a, x) => a === (x < 10 ? 255 : 0));
    say(
      'ED9531_A_SOFT_RIM_TAKES_THE_PAINTINGS_EDGE',
      before.error > ERROR_LIMIT && after.error === 0 && after.coverage === 1 && binary && run[0].data.every((v, i) => i % 4 !== 3 || v === 255),
      `before: max error ${before.error}; after: max error ${after.error}, least coverage ${after.coverage}, FRONT alpha on row 4 ${row.join(',')}; ${r.resolved} resolved, ${count(r.changed)} part px changed`,
    );
    const again = stack.map(copy);
    paintingEdges(again, painting, options());
    say('ED9532_DETERMINISTIC', again.every((l, i) => same(l, run[i])), 'two runs on the same input write the same bytes');
  }

  // Positive: two soft rims leave a gap neither part covers above the owner floor. Before, the background shows through; after, it does not.
  {
    const behindRamp = (x: number): number => (x >= 13 ? 255 : x === 12 ? 120 : x === 11 ? 60 : 0);
    const frontRamp = (x: number): number => (x <= 7 ? 255 : x === 8 ? 120 : x === 9 ? 100 : x === 10 ? 60 : 0);
    const { painting, stack } = strip(RED, BLUE, frontRamp, behindRamp);
    const before = against(stack, painting);
    const run = stack.map(copy);
    paintingEdges(run, painting, options());
    const after = against(run, painting);
    say(
      'ED9533_A_GAP_BETWEEN_TWO_RIMS_IS_CLOSED',
      before.coverage < 1 && after.coverage === 1 && after.error <= ERROR_LIMIT,
      `before: least coverage ${before.coverage}, max error ${before.error}; after: least coverage ${after.coverage}, max error ${after.error}`,
    );
    // Planted: the same gap read as background (no painted figure there) is not closed — the `painted` owner is what closes it.
    const unpainted = new Uint8Array(W * H).fill(1);
    for (let y = 0; y < H; y++) for (const x of [9, 10, 11]) unpainted[y * W + x] = 0;
    const bare = stack.map(copy);
    paintingEdges(bare, painting, options({ painted: unpainted }));
    const left = against(bare, painting);
    say('ED9534_PLANTED_A_GAP_NOT_PAINTED_STAYS_OPEN', left.coverage < 1, `with the gap columns marked as unpainted: least coverage ${left.coverage}`);
  }

  // Positive: a light highlight inside FRONT, two rig px from the line, is FRONT's interior, not a mix with BEHIND: it keeps alpha 255 and its colour.
  {
    const WHITE: RGB = [255, 255, 255];
    const painting = columns((x) => (x === 7 ? WHITE : x < 10 ? RED : BLUE), () => 255);
    const stack = [columns(() => BLUE, () => 255), columns((x) => (x === 7 ? WHITE : RED), RAMP)];
    const run = stack.map(copy);
    paintingEdges(run, painting, options());
    const s = (4 * W + 7) * 4;
    const px = [...run[1].data.slice(s, s + 4)];
    say('ED9535_A_LIGHT_INTERIOR_IS_NOT_HOLED', px.join(',') === '255,255,255,255', `FRONT at the highlight (x 7, row 4): ${px.join(',')}`);
  }

  // Planted: the painting draws no edge between the two (contrast below the floor): every edge pixel is skipped and nothing is written.
  {
    const near: RGB = [20, 0, 180];
    const { painting, stack } = strip(near, BLUE, RAMP);
    const run = stack.map(copy);
    const r = paintingEdges(run, painting, options());
    say('ED9536_PLANTED_NO_PAINTED_EDGE_IS_LEFT', r.resolved === 0 && r.skipped.contrast > 0 && count(r.changed) === 0 && run.every((l, i) => same(l, stack[i])), `resolved ${r.resolved}, skipped for contrast ${r.skipped.contrast}, changed ${count(r.changed)}`);
  }

  // Planted: a third part drawn in front with alpha above the floor across the edge; the two-layer model does not carry it, so the pixels under it are left.
  // Control: the same part at the floor itself is not opaque and does not stop the step.
  for (const [alpha, expectSkip] of [[OPAQUE_ALPHA_ABOVE + 1, true], [OPAQUE_ALPHA_ABOVE, false]] as const) {
    const { painting, stack } = strip(RED, BLUE, RAMP);
    const veil = columns(() => [0, 200, 0], (x) => (x >= 8 && x <= 11 ? alpha : 0));
    const run = [...stack, veil].map(copy);
    const r = paintingEdges(run, painting, options({ editable: [true, true, true] }));
    const veilKept = same(run[2], veil);
    const ok = expectSkip ? r.skipped.cover > 0 && veilKept : r.skipped.cover === 0 && r.resolved > 0 && veilKept;
    say(
      expectSkip ? 'ED9537_PLANTED_A_PART_IN_FRONT_ABOVE_THE_FLOOR_IS_LEFT' : 'ED9538_A_PART_IN_FRONT_AT_THE_FLOOR_DOES_NOT_STOP_IT',
      ok,
      `veil alpha ${alpha}: skipped for cover ${r.skipped.cover}, resolved ${r.resolved}, the veil ${veilKept ? 'untouched' : 'written'}`,
    );
  }

  // A part's art keeps its 4-connected pieces. FRONT is two blocks joined on one row by a one-pixel bridge at alpha 140.
  // Planted: the painting draws no bridge, so the step would erase it and split FRONT in two; the bridge is left as it was.
  // Control: the painting draws the bridge in FRONT's colour; it is resolved (made opaque) and nothing is held back.
  for (const drawn of [false, true]) {
    const onBridge = (x: number, y: number): boolean => y === 4 && x >= 6 && x <= 15;
    const block = (x: number): boolean => x <= 5 || x >= 16;
    const front = newRaster(W, H);
    const painting = newRaster(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const s = (y * W + x) * 4;
        front.data.set([...RED, block(x) ? 255 : onBridge(x, y) ? 140 : 0], s);
        painting.data.set([...(block(x) || (drawn && onBridge(x, y)) ? RED : BLUE), 255], s);
      }
    }
    const stack = [columns(() => BLUE, () => 255), front];
    const run = stack.map(copy);
    const r = paintingEdges(run, painting, options());
    const art = newMask(W, H);
    for (let p = 0; p < W * H; p++) art.data[p] = run[1].data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE ? 1 : 0;
    const pieces = connectedComponents(art, 4).count - 1;
    const bridge = [...Array(10).keys()].map((k) => run[1].data[(4 * W + 6 + k) * 4 + 3]);
    say(
      drawn ? 'ED9540_A_DRAWN_BRIDGE_IS_RESOLVED_AND_NOTHING_IS_HELD' : 'ED9541_PLANTED_A_SPLIT_IS_NOT_WRITTEN',
      pieces === 1 && (drawn ? r.skipped.pieces === 0 && bridge.every((a) => a === 255) : r.skipped.pieces > 0 && bridge.every((a) => a === 140)),
      `painting ${drawn ? 'draws' : 'does not draw'} the bridge: FRONT in ${pieces} 4-connected piece(s), bridge alpha ${bridge.join(',')}, ${r.skipped.pieces} part px held back`,
    );
  }

  // A painting patch reaches the step as its cut, placed at record.x / record.y; the step reads every part as the rig canvas.
  // Positive: the patch placed on the canvas covers the edge, so FRONT under it is left (0 px changed there).
  // Planted: the cropped image read as the canvas (its bytes from the canvas's first pixel, as `p * 4` indexes them) misses
  // the edge, and FRONT under the patch is rewritten; the cropped image itself is refused.
  {
    const { painting, stack } = strip(RED, BLUE, RAMP);
    const px = 7, py = 2, pw = 6, ph = 5;
    const cut = newRaster(pw, ph);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) cut.data.set([...painting.data.slice(((py + y) * W + px + x) * 4, ((py + y) * W + px + x) * 4 + 3), 255], (y * pw + x) * 4);
    const placed = newRaster(W, H);
    for (let y = 0; y < ph; y++) placed.data.set(cut.data.subarray(y * pw * 4, (y + 1) * pw * 4), ((py + y) * W + px) * 4);
    const misread = newRaster(W, H);
    misread.data.set(cut.data);
    const underPatch = (run: Raster[]): number => {
      let n = 0;
      for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) if ([0, 1, 2, 3].some((c) => run[1].data[(y * W + x) * 4 + c] !== stack[1].data[(y * W + x) * 4 + c])) n++;
      return n;
    };
    const opts = options({ editable: [true, true, false] });
    const good = [...stack, placed].map(copy);
    paintingEdges(good, painting, opts);
    const bad = [...stack, misread].map(copy);
    paintingEdges(bad, painting, opts);
    let refused = '';
    try {
      paintingEdges([...stack, cut].map(copy), painting, opts);
    } catch (e) {
      refused = e instanceof Error ? e.message : String(e);
    }
    say('ED9542_A_PLACED_PATCH_KEEPS_THE_EDGE_UNDER_IT', underPatch(good) === 0, `patch ${pw}x${ph} at (${px}, ${py}) placed on the canvas: ${underPatch(good)} FRONT px changed under it`);
    say(
      'ED9543_PLANTED_A_CROPPED_PATCH_IS_MISREAD_AND_REFUSED',
      underPatch(bad) > 0 && refused.includes('rig canvas'),
      `the cut read as the canvas: ${underPatch(bad)} FRONT px changed under the patch; the cut itself: ${refused === '' ? 'accepted' : `refused (${refused})`}`,
    );
  }

  // A source-visible gap has an existing allocation even when no edge colour
  // separates. The canonical figure and a four-neighbour witness bound its fill.
  {
    const p = 4 * W + 16, offset = p * 4;
    const painting = columns(() => RED, () => 255);
    const layer = columns(() => RED, x => x < 18 && x !== 16 ? 255 : 0);
    const figure = newMask(W, H);
    figure.data[p] = 1;
    const run = [copy(layer)];
    const calls: number[] = [];
    paintingEdges(run, painting, options({ editable: [true], figure, written: (_i, q) => calls.push(q) }));
    say('ED9555_ALLOCATED_EMPTY_FIGURE_PIXEL_RECEIVES_THE_PAINTING',
      [...run[0].data.slice(offset, offset + 4)].join(',') === '200,0,0,255' && calls.filter(q => q === p).length === 1,
      `allocated gap alpha ${run[0].data[offset + 3]}; writer callbacks ${calls.filter(q => q === p).length}`);
    const omitted = [copy(layer)], outside = [copy(layer)];
    paintingEdges(omitted, painting, options({ editable: [true] }));
    paintingEdges(outside, painting, options({ editable: [true], figure: newMask(W, H) }));
    say('ED9556_OMITTED_OR_EMPTY_FIGURE_PRESERVES_THE_OPEN_GAP',
      omitted[0].data[offset + 3] === 0 && same(omitted[0], outside[0]),
      `omitted alpha ${omitted[0].data[offset + 3]}; outside-domain bytes identical ${same(omitted[0], outside[0])}`);
    const keep = newMask(W, H); keep.data[p] = 1;
    const guarded = [
      options({ editable: [false], figure }),
      options({ editable: [true], figure, keep: [keep] }),
      options({ editable: [true], figure, feathered: [keep] }),
    ];
    const held = guarded.map(opts => { const q = [copy(layer)]; paintingEdges(q, painting, opts); return q[0].data[offset + 3]; });
    say('ED9557_GAP_FILL_RESPECTS_EDITABLE_KEEP_AND_FEATHER', held.every(alpha => alpha === 0), `guarded alphas ${held.join(',')}`);
    const distant = columns(() => RED, x => x < 14 ? 255 : 0);
    const detached = [copy(distant)];
    paintingEdges(detached, painting, options({ editable: [true], figure }));
    say('ED9558_A_GAP_WITHOUT_FOUR_CONNECTED_ART_STAYS_EMPTY', detached[0].data[offset + 3] === 0,
      `detached gap alpha ${detached[0].data[offset + 3]}`);
  }
  {
    const p = 4 * W + 9, offset = p * 4;
    const painting = columns(x => x < 9 ? RED : BLUE, () => 255);
    const layer = columns(() => RED, x => x < 9 ? 255 : x === 9 ? 29 : 0);
    const figure = newMask(W, H); figure.data[p] = 1;
    const run = [copy(layer)], bare = [copy(layer)];
    const calls: number[] = [];
    paintingEdges(bare, painting, options({ editable: [true], painted: figure.data }));
    paintingEdges(run, painting, options({ editable: [true], painted: figure.data, figure, written: (_i,q) => calls.push(q) }));
    say('ED9559_A_ZERO_MATTE_CLEAR_IS_COMPLETED_ON_THE_FIGURE',
      bare[0].data[offset + 3] === 0 && [...run[0].data.slice(offset,offset+4)].join(',') === '0,0,200,255' && calls.filter(q => q === p).length === 1,
      `without domain ${bare[0].data[offset + 3]}; restored ${run[0].data[offset + 3]}; callbacks ${calls.filter(q => q === p).length}`);
  }
  {
    const p = 4 * W + 9, offset = p * 4;
    const painting = columns(x => x < 10 ? RED : BLUE, () => 255);
    const back = columns(() => BLUE, x => x >= 10 ? 255 : 0);
    const front = columns(() => RED, x => x < 9 ? 255 : 0);
    const figure = newMask(W,H); figure.data[p] = 1;
    const run = [back,front].map(copy);
    paintingEdges(run,painting,options({ figure,movingPair: () => true }));
    say('ED9560_A_MOVING_PAIR_GAP_IS_LEFT_FOR_ITS_AUTHORED_SEAM',run.every(q => q.data[offset+3] === 0),
      `moving-pair gap alphas ${run.map(q => q.data[offset+3]).join(',')}`);
  }

  // Interior translucency uses final four-neighbour ownership, frozen before
  // any completion writes, and the existing gap distances and draw-order ties.
  {
    const p = 4 * W + 16, offset = p * 4;
    const painting = columns(() => RED, () => 255);
    const figure = newMask(W, H); figure.data.fill(1);
    const layer = columns(() => RED, x => x < 18 ? (x === 16 ? 64 : 255) : 0);
    const run = [copy(layer)];
    const calls: number[] = [];
    paintingEdges(run, painting, options({ editable: [true], figure, written: (_i, q) => calls.push(q) }));
    say('ED9561_OWNED_INTERIOR_TRANSLUCENCY_RECEIVES_THE_PAINTING',
      [...run[0].data.slice(offset, offset + 4)].join(',') === '200,0,0,255' && calls.filter(q => q === p).length === 1,
      `completed alpha ${run[0].data[offset + 3]}; writer callbacks ${calls.filter(q => q === p).length}`);
    const rim = newMask(W, H); rim.data.set(figure.data); rim.data[p - 1] = 0;
    const keep = newMask(W, H); keep.data[p] = 1;
    const transparentPainting = copy(painting); transparentPainting.data[(p - W) * 4 + 3] = 0;
    const guarded = [
      { opts: options({ editable: [true] }), painting },
      { opts: options({ editable: [true], figure: rim }), painting },
      { opts: options({ editable: [false], figure }), painting },
      { opts: options({ editable: [true], figure, keep: [keep] }), painting },
      { opts: options({ editable: [true], figure, feathered: [keep] }), painting },
      { opts: options({ editable: [true], figure, ground: 'busy' }), painting },
      { opts: options({ editable: [true], figure }), painting: transparentPainting },
    ];
    const held = guarded.map(test => {
      const q = [copy(layer)]; paintingEdges(q, test.painting, test.opts); return q[0].data[offset + 3];
    });
    say('ED9562_TRANSLUCENCY_RESPECTS_DOMAIN_LOCK_KEEP_FEATHER_AND_BUSY', held.every(a => a === 64),
      `omitted figure, rim, locked part, keep, feather, busy, transparent neighbour alphas ${held.join(',')}`);

    const isolated = newRaster(W, H);
    isolated.data.set([...RED, 255], (p - 3) * 4);
    isolated.data.set([...RED, 64], offset);
    const absent = [copy(isolated)];
    paintingEdges(absent, painting, options({ editable: [true], figure }));
    const faint = copy(isolated); faint.data.set([...RED, 1], (p - 1) * 4);
    const witnessed = [faint];
    paintingEdges(witnessed, painting, options({ editable: [true], figure }));
    say('ED9563_OWNER_REQUIRES_FINAL_NEIGHBOUR_ALPHA_ABOVE_ZERO',
      absent[0].data[offset + 3] === 64 && witnessed[0].data[offset + 3] === 255,
      `no neighbour alpha ${absent[0].data[offset + 3]}; alpha-1 neighbour completes to ${witnessed[0].data[offset + 3]}`);

    const back = columns(() => RED, x => x >= 17 ? 255 : 0);
    const front = columns(() => RED, x => x < 16 ? 255 : x === 16 ? 64 : 0);
    const moving = [back, front].map(copy);
    paintingEdges(moving, painting, options({ figure, movingPair: () => true }));
    say('ED9564_MOVING_PAIR_INTERIOR_TRANSLUCENCY_IS_LOCKED',
      moving[0].data[offset + 3] === 0 && moving[1].data[offset + 3] === 64,
      `moving-pair target alphas ${moving.map(q => q.data[offset + 3]).join(',')}`);

    const tieBack = copy(isolated), tieFront = newRaster(W, H);
    tieBack.data.set([...RED, 255], (p - 1) * 4);
    tieFront.data.set([...RED, 255], (p - 1) * 4);
    const tie = [tieBack, tieFront];
    paintingEdges(tie, painting, options({ figure }));
    say('ED9565_FINAL_OWNER_TIES_USE_THE_GAP_FRONT_FIRST_RULE',
      tie[0].data[offset + 3] === 64 && tie[1].data[offset + 3] === 255,
      `equal-distance owners, target alphas ${tie.map(q => q.data[offset + 3]).join(',')}`);

    const covered = [columns(() => RED, () => 80), columns(() => RED, () => 80)];
    const before = covered.map(copy);
    paintingEdges(covered, painting, options({ figure }));
    say('ED9566_STACK_COVERAGE_ABOVE_THE_TRANSLUCENT_RANGE_IS_UNCHANGED',
      covered.every((q, i) => same(q, before[i])),
      `two alpha-80 layers remain ${covered.map(q => q.data[offset + 3]).join(',')}`);

    const frozen = newRaster(W, H);
    frozen.data.set([...RED, 255], (p - 2) * 4);
    frozen.data.set([...RED, 64], offset);
    const snapshot = [frozen];
    paintingEdges(snapshot, painting, options({ editable: [true], figure }));
    say('ED9567_NEW_GAP_WRITES_CANNOT_SUPPLY_AN_INTERIOR_OWNER',
      snapshot[0].data[(p - 1) * 4 + 3] === 255 && snapshot[0].data[offset + 3] === 64,
      `new gap alpha ${snapshot[0].data[(p - 1) * 4 + 3]}; originally isolated translucency alpha ${snapshot[0].data[offset + 3]}`);
  }

  // Planted: FRONT may not be edited (a painting patch): nothing is written.
  {
    const { painting, stack } = strip(RED, BLUE, RAMP);
    const run = stack.map(copy);
    const r = paintingEdges(run, painting, options({ editable: [true, false] }));
    say('ED9539_PLANTED_A_LOCKED_PART_IS_LEFT', r.resolved === 0 && r.skipped.locked > 0 && run.every((l, i) => same(l, stack[i])), `resolved ${r.resolved}, skipped as locked ${r.skipped.locked}`);
  }
}

if (import.meta.main) {
  let failed = 0;
  runPaintingEdgeChecks((name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
    if (!ok) failed++;
  });
  process.exit(failed ? 1 : 0);
}
