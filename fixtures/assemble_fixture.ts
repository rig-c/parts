/**
 * The assemble stage's generated fixture: a painting and two See-through runs
 * made of flat rectangles, placed so that every resample is exact and every
 * figure in `parts.json` can be computed by hand. Nothing here is art.
 *
 * ## Why every number below is exact
 *
 * The painting is 128x128, `seethrough.resolution` 64 and `rig_scale` 0.5, so
 * the rig is 64x64 and:
 *
 * - the FULL run maps run pixel (x, y) to rig pixel (x, y): `k = (128 / 64) *
 *   0.5 = 1`, no pad (the painting is square), and cv2's bicubic at an integer
 *   position has the weights (0, 1, 0, 0) — the warp is the identity;
 * - the HEAD run, cropped from source box [32, 0, 96, 64], maps run (x, y) to
 *   rig (x / 2 + 16, y / 2): `k = (64 / 64) * 0.5 = 0.5`, so `warpAffine`
 *   samples run pixel (2X - 32, 2Y) with a zero fraction — every rig pixel is
 *   one run pixel, and a run rectangle [x0, x1) maps to [x0 / 2 + 16, x1 / 2 + 16);
 * - the painting is ONE colour `C` everywhere (flat fixture), and a Lanczos
 *   resample of a constant image is that constant: its 22-bit weights sum to
 *   within a few units of 2^22, far inside the rounding.
 *
 * Every layer is opaque `C` or opaque `Z`. `C` agrees with the painting, so
 * projection takes it; `Z` differs by 210 in a channel, over the drift limit
 * (90), so projection refuses it and the seam override (limit 60) recolours it.
 *
 * ## The expected parts.json, derived
 *
 * Rig-space rectangles are [x0, x1) x [y0, y1). A 5x5 erosion of a rectangle
 * away from the image edge removes 2 pixels on each side.
 *
 * - `hair_back` (head:back hair, run [44, 60) x [20, 64) -> rig [38, 46) x [10, 32)):
 *   core = [40, 44) x [12, 30) = 4 x 18 = 72; the head window is
 *   [16 + 3, 48 - 3) x [0 + 3, 32 - 3) = [19, 45) x [3, 29), so taken = 4 x 17 = 68.
 *   Below the crop line (row 32 - 4 = 28), the full run's back hair
 *   [38, 44) x [22, 44) has one component, seeded because the head part has
 *   alpha 255 on row 26 in columns 38..45: sel = [38, 44) x [28, 44) = 96 px.
 *   The rim: the 3x3 dilation of sel is [37, 45) x [27, 45) = 144 px, of which
 *   the part is already opaque on [38, 45) x [27, 32) (35 px) and on
 *   [38, 44) x [32, 44) (72 px), leaving 37; no later part reaches that box
 *   (bottomwear starts at column 48).
 *   merged = 96 + 37 = 133. The part is the head hair (176) + sel below row 32
 *   (72) + the rim (37) = 285 opaque px, box x 37..45, y 10..44 -> 37,10 9x35.
 * - `topwear` (full, [10, 30) x [20, 50), `C`): 600 px, core 16 x 26 = 416, all taken.
 * - `bottomwear` (full, [48, 62) x [30, 54), `Z`): 336 px, core 10 x 20 = 200,
 *   all refused, none taken; every one of its 336 pixels is top-most, opaque and
 *   210 off a painting whose min channel is 40, so seam_override_px = 336.
 * - `shoes` (full:footwear, [10, 30) x [54, 60) plus a 2x2 speck): 120 px after
 *   the speck (4 px, under the 40-px floor) is removed as a ghost; core 16 x 2 = 32.
 * - `face` (head, run [0, 24) x [16, 40) -> rig [16, 28) x [8, 20)): 144 px,
 *   core [18, 26) x [10, 18) = 64, of which the head window (from column 19)
 *   keeps 7 x 8 = 56 as taken.
 * - ghost_px: full:neck 9 (a lone 3x3 speck), full:footwear 4, every other layer 0.
 *
 * Visibility: no two layers of one run overlap (the full run's rectangles are
 * disjoint, and so are the head run's), and every pixel the merge writes lies
 * in columns 37..45, which no later full-run layer reaches — so every opaque
 * pixel is visible, `occluded_px` is 0 and `visible_px = opaque_px`
 * throughout. `visible_not_projected_px = visible_px - projected`, where
 * projected is the pixels whose colour came from projection:
 *
 * - `hair_back`: of its own 68 taken, row 28 (columns 40..43, 4 px) is
 *   overwritten by the merge, which starts on that row; the full run's back
 *   hair [38, 44) x [22, 44) was projected on its own core [40, 42) x [24, 42)
 *   (36 px, no head window in the full run) before it was copied, and rows
 *   28..41 of that core are inside sel: 28 px. The rim's 37 are growRim's,
 *   not projection. Projected = 64 + 28 = 92, so 285 - 92 = 193.
 * - `topwear` 600 - 416 = 184; `bottomwear` 336 - 0 = 336; `shoes`
 *   120 - 32 = 88; `face` 144 - 56 = 88.
 *
 * ## The recomposite block, derived
 *
 * Every part pixel is opaque and ends exactly `C` (projected, copied, a rim
 * taken from the painting, or — `bottomwear` — recoloured by the seam
 * override), and the resample of a flat painting is exactly `C`, so every
 * covered pixel differs by 0 and every one of the 64 x 64 - 1,485 = 2,611
 * uncovered pixels is white page over `C`: |255 - 100| + |255 - 60| +
 * |255 - 40| = 565, mean channel 565 / 3, max channel 215 > 40.
 *
 * - `mean_abs` = 2,611 x 565 / 3 / 4,096 = 120.0533… -> 120.053;
 *   `within_share` = 1,485 / 4,096 = 0.36254… -> 0.3625; `error_px` =
 *   `uncovered_error_px` = 2,611.
 * - No part touches the canvas edge and none encloses a pocket, so the
 *   uncovered pixels are ONE 8-connected hole of 2,611 px whose box is the
 *   whole rig, 0,0 64x64.
 * - Its borders are each part's pixels with an uncovered 8-neighbour. A
 *   w x h rectangle alone has w h - (w - 2)(h - 2) of them: `bottomwear`
 *   14 x 24 -> 72, `shoes` 20 x 6 -> 48. `face` [16, 28) x [8, 20) sits on
 *   `topwear` [10, 30) x [20, 50): the face's bottom row and the topwear's top
 *   row lose columns 17..26 (10 px each), whose every neighbour is the other
 *   part — `face` 44 - 10 = 34, `topwear` 96 - 10 = 86. `hair_back` is rows
 *   10..26 at columns 38..45, rows 27..31 at 37..45, rows 32..44 at 37..44;
 *   its rim is 8 (row 10) + 2 x 16 (rows 11..26) + 3 (row 27: 37, 38, 45) +
 *   2 x 3 (rows 28..30) + 3 (row 31: 37, 44, 45) + 2 (row 32) + 2 x 11 (rows
 *   33..43) + 8 (row 44) = 84. Most first: topwear 86, hair_back 84,
 *   bottomwear 72, shoes 48, face 34.
 *
 * ## The thin-strip fixture (`--project`)
 *
 * `STRIP_FULL`: a full-run `topwear` [10, 40) x [10, 40) with a 3-pixel
 * `neckwear` strip [20, 23) x [5, 50) drawn in front of it, both `C` on the
 * flat painting, planned `topwear` then `neckwear`, no extend.
 *
 * - `neckwear`: 3 x 45 = 135 px, nothing in front, so visible 135. Under
 *   `core` its 5x5 erosion is empty: taken 0, visible_not_projected 135.
 *   Under `visible` nothing is in front of it, so its core is all 135: taken
 *   135, visible_not_projected 0.
 * - `topwear`: 900 px, of which the strip covers [20, 23) x [10, 40) = 90:
 *   occluded 90, visible 810. Under `core` the two blocks either side of the
 *   strip erode to [12, 18) x [12, 38) = 156 and [25, 38) x [12, 38) = 338:
 *   taken 494, visible_not_projected 316. Under `visible` only the rim along
 *   the strip is kept off — the 5x5 dilation of the strip is columns 18..24,
 *   so columns 18, 19, 23 and 24 over rows 10..39 (120 px) — and the outer
 *   edge is projected: taken 690, visible_not_projected 120.
 *
 * ## The silhouette fixture
 *
 * `framedPainting`: white, with a `C` block over source [16, 96)^2 holding a
 * white hole over [40, 72)^2 — rig block [8, 48)^2, hole [20, 36)^2 — and a
 * thin `C` line over source [104, 108) x [16, 96), two rig pixels wide.
 *
 * - A rig pixel's Lanczos support at a 2x reduction is 6 source pixels either
 *   side of its centre 2X + 1, so rig pixels 23..32 of the hole are exactly
 *   white. A navy full-run `topwear` over rig [24, 32)^2 (64 px) sits on that
 *   white: the reference's near-white rule leaves all 64 alone, the silhouette
 *   rule (the hole is enclosed by the block, so it is figure) recolours all 64
 *   white, and the recomposite's error px (> 40) drop by exactly 64.
 * - The line is under 5 rig pixels wide however the resample spreads it, so
 *   the silhouette's two 3x3 erosions remove it: it is painted (not
 *   near-white) but OUTSIDE the silhouette. A `Z` full-run `bottomwear` over
 *   it is recoloured by the near-white rule wherever the line is painted, and
 *   the silhouette rule must recolour at least those — it widens the
 *   reference's rule, it does not replace it.
 *
 * ## The hem fixture (`assemble.patches`)
 *
 * `hemPainting`: white, with a `C` block over source [16, 112)^2 — rig
 * [8, 56)^2. At a 2x reduction a rig pixel X reads source pixels 2X - 5 ..
 * 2X + 6 (the Lanczos support above), so the rig pixels whose whole support
 * lies in the block, and which are therefore exactly `C`, are X in [11, 53)
 * each way.
 *
 * `HEM_FULL`: a full-run `topwear` over rig [8, 56) x [8, 36) — the block's
 * own width — and a narrower `bottomwear` over rig [24, 40) x [40, 56), both
 * `C`, so rows 36..39 are a gap no layer holds across the figure: the planted
 * hem hole. (The skirt is 16 px square rather than the block's width because
 * `check`'s TIP_OVER_ROOT reads a part that hangs: rotated about its top
 * centre, a 48x16 skirt was measured moving its upper half's centroid further
 * than its lower half's, ratio 0.702 at 2 degrees and 0.565 at 8.) Over it the recomposite is the
 * white page, so every gap pixel whose painting colour is more than 40 off
 * white is an uncovered error pixel. The plan is those two parts; the head
 * run (`FRAMED_HEAD`) is read and planned from by nothing.
 *
 * - A patch `{box: [11, 36, 53, 40], alpha: "box"}` takes 42 x 4 = 168
 *   pixels, all exactly `C`, all uncovered error pixels before it (C is 215
 *   off white in its blue channel); after it the recomposite there is the
 *   painting, so error px and uncovered error px each drop by exactly 168,
 *   and its record is 168 in every count that is not 0.
 * - With `alpha: "silhouette"` over the whole gap row band [0, 36, 64, 40)
 *   the patch is `figureSilhouette` inside the box, pixel for pixel, and the
 *   uncovered error px drop by the gap pixels it holds that were error px.
 * - `HEM_UNDER` [11, 34, 53, 42], drawn `"back"`, reaches two rows under the
 *   topwear and two into the skirt's rows: 42 x 8 = 336 pixels, all exactly
 *   `C`. Rows 34..35 were covered by the topwear already; rows 36..39 are
 *   the gap (168); rows 40..41 are uncovered beside the 16-px skirt, columns
 *   11..23 and 40..52, 2 x 26 = 52. So the uncovered error px drop by 220.
 *   This is the shape to author: a patch drawn behind its neighbours and
 *   overlapping them, so the render has no edge between them (on the build
 *   fixture the abutting box raised `check`'s seam from 0.323 to 0.86 with
 *   16 px over 40; the overlapping one measured 0.267 with none).
 *
 * ## The landscape twin (issue #78)
 *
 * The same figure on a painting wider than tall: `landscapePainting()` is the
 * flat `C` painting at 128 x 124, so `inputs` pads it to a 128-px square
 * vertically — `squarePad(128, 124)`: top floor(4 / 2) = 2 source px, bottom
 * 2 — and the full run's canvas is that square at 64 px. Its layers are the
 * portrait fixture's moved down by the pad in run pixels, 2 x (64 / 128) = 1
 * row (`LANDSCAPE_FULL_LAYERS`); the head run is cut from the painting, not
 * from the square, so it is the portrait's unchanged.
 *
 * - The full run's map is rig = run x 1 + (0, -2 x 0.5) = run - (0, 1): every
 *   moved layer lands on exactly the rig pixels the portrait's did. Nothing
 *   reaches the canvas edge after the move (the lowest rectangle, the
 *   footwear speck, ends on run row 62 of 64), so the ghost counts hold too.
 * - The rig is 64 x 62 (128 x 0.5, 124 x 0.5). Every part ends at or above
 *   rig row 59 (`shoes`, rows 54..59), so no part reaches the new bottom edge
 *   and every part record, box, count and ghost figure is the portrait's.
 * - Only the recomposite moves, by the rig's area: 64 x 62 = 3,968 pixels,
 *   1,485 covered, 2,483 uncovered white page over `C`. `mean_abs` =
 *   2,483 x 565 / 3 / 3,968 = 117.8507… -> 117.851; `within_share` =
 *   1,485 / 3,968 = 0.37424… -> 0.3742; `error_px` = `uncovered_error_px` =
 *   2,483, one hole of 2,483 px whose box is the whole rig, 0,0 64x62, with
 *   the portrait's borders (no part touches an edge, so none changes).
 *
 * ## The uncovered-body twins (issue #233)
 * The flat fixture with only the back hair changed. The full run maps 1:1 to
 * the rig, so `bodyMinPx` is `PROPOSE_MIN_PX` x 1 x 1 = 150 rig px, and the
 * crop line is rig row 28 (probe row 26).
 * - `TAIL_FULL_LAYERS` / `TAIL_HEAD_LAYERS`, the positive: the head run's back
 *   hair is a bob, run [44, 60) x [20, 40) -> rig [38, 46) x [10, 20), which
 *   stops 8 rows above the probe row. The full run's back hair is the same bob
 *   at rig [38, 46) x [10, 20) and a tail [36, 44) x [22, 52) that does not
 *   touch it (rows 20..21 lie between). The proposer still extends the hair
 *   (the full layer ends on rig row 51, 52 > 28 + 8), but `belowCrop` seeds
 *   nothing: the bob has no pixel on row 26. So the tail, 8 x 30 = 240 px,
 *   is covered by no part; a 5x5 opening keeps an 8-wide block whole, and
 *   240 >= 150: one body, 240 px at 36,22 8x30. The plan, its extend entry and
 *   the headwear note are the flat fixture's (`EXPECTED_PROPOSAL`): the bob
 *   is 16 x 20 = 320 run px, above the 150 floor, and nothing else moved.
 *   Assembled on that plan, the parts cover hair_back 80 (the bob) + hairpin
 *   192 + bottomwear 336 + topwear 600 + face 144, less the 4 x 6 = 24 px
 *   where the face [16, 28) x [8, 20) overlaps the hairpin [4, 20) x [2, 14):
 *   1,328 px, so 4,096 - 1,328 = 2,768 uncovered error px (white page over
 *   `C`), of which the tail's 240 are one body. The shoes (120 px, under the
 *   150 floor) are not planned and are no body.
 * - `BAND_FULL_LAYERS`, the negative beside the flat fixture's continued
 *   hair: the full run's back hair is the head part's footprint grown by 4 px
 *   at the sides and 2 px on top, [34, 50) x [8, 44). Below the crop line the
 *   whole component is continued (the head part reaches row 26 in columns
 *   38..45), so what no part covers is two 4-px side bands, rows 8..27
 *   (2 x 4 x 20 = 160), joined by a 2-row top band over columns 38..45 (16):
 *   one 8-connected component of 176 px, over the 150 bar — and no 5x5 square
 *   fits inside it, so its opening is empty and there is no body. It is the
 *   seam the two runs' silhouettes leave round a part, which is not hair.
 * - The flat fixture itself on its own `PLAN`, which takes no part from the
 *   full run's headwear: [4, 20) x [2, 14) less the face's 24 px is 168 px,
 *   whose opening keeps all 168 (the 12 x 12 block and the 4 x 6 strip right
 *   of it are each 5 wide or more where they join), so the assemble summary
 *   names it: 168 of the 2,611 uncovered error px, one body at 4,2 16x12.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ControlSkeleton } from '../src/config.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { scaledPoints } from '../src/skeleton.ts';

export type RGB = [number, number, number];

export const C: RGB = [100, 60, 40];
export const Z: RGB = [250, 250, 250];
export const NAVY: RGB = [20, 20, 60];
export const WHITE: RGB = [255, 255, 255];

/** A rectangle [x0, x1) x [y0, y1) of one opaque colour. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  colour: RGB;
}

export interface RunLayerSpec {
  name: string;
  /** `depth_median`; null for a hidden-art layer (issue #359), which is never drawn. */
  depth: number | null;
  rects: Rect[];
}

export const SOURCE_SIDE = 128;
export const RESOLUTION = 64;
export const RIG_SCALE = 0.5;
export const HEAD_BOX: [number, number, number, number] = [32, 0, 96, 64];

const rect = (x0: number, y0: number, x1: number, y1: number, colour: RGB): Rect => ({ x0, y0, x1, y1, colour });

export const FULL_LAYERS: RunLayerSpec[] = [
  { name: 'headwear', depth: 0.95, rects: [rect(4, 2, 20, 14, C)] },
  { name: 'back hair', depth: 0.9, rects: [rect(38, 22, 44, 44, C)] },
  { name: 'bottomwear', depth: 0.6, rects: [rect(48, 30, 62, 54, Z)] },
  { name: 'topwear', depth: 0.5, rects: [rect(10, 20, 30, 50, C)] },
  { name: 'footwear', depth: 0.4, rects: [rect(10, 54, 30, 60, C), rect(60, 60, 62, 62, C)] },
  { name: 'neck', depth: 0.3, rects: [rect(2, 2, 5, 5, C)] },
];

export const HEAD_LAYERS: RunLayerSpec[] = [
  { name: 'back hair', depth: 0.9, rects: [rect(44, 20, 60, 64, C)] },
  { name: 'face', depth: 0.5, rects: [rect(0, 16, 24, 40, C)] },
];

export const PLAN: Array<[string, 'full' | 'head', string]> = [
  ['hair_back', 'head', 'back hair'],
  ['topwear', 'full', 'topwear'],
  ['bottomwear', 'full', 'bottomwear'],
  ['shoes', 'full', 'footwear'],
  ['face', 'head', 'face'],
];

export const EXTEND = [{ part: 'hair_back', run: 'full' as const, tag: 'back hair' }];

/** The parts.json the module doc derives. */
export const EXPECTED_PARTS = {
  rig_size: [64, 64] as [number, number],
  scale_rig_per_source: 0.5,
  parts: [
    { name: 'hair_back', from: 'head:back hair', x: 37, y: 10, w: 9, h: 35, opaque_px: 285, visible_px: 285, occluded_px: 0, projected_core_px: 72, source_px_taken: 68, visible_not_projected_px: 193, refused_drift_px: 0, merged_px: 133, seam_override_px: 0 },
    { name: 'topwear', from: 'full:topwear', x: 10, y: 20, w: 20, h: 30, opaque_px: 600, visible_px: 600, occluded_px: 0, projected_core_px: 416, source_px_taken: 416, visible_not_projected_px: 184, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 },
    { name: 'bottomwear', from: 'full:bottomwear', x: 48, y: 30, w: 14, h: 24, opaque_px: 336, visible_px: 336, occluded_px: 0, projected_core_px: 200, source_px_taken: 0, visible_not_projected_px: 336, refused_drift_px: 200, merged_px: 0, seam_override_px: 336 },
    { name: 'shoes', from: 'full:footwear', x: 10, y: 54, w: 20, h: 6, opaque_px: 120, visible_px: 120, occluded_px: 0, projected_core_px: 32, source_px_taken: 32, visible_not_projected_px: 88, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 },
    { name: 'face', from: 'head:face', x: 16, y: 8, w: 12, h: 12, opaque_px: 144, visible_px: 144, occluded_px: 0, projected_core_px: 64, source_px_taken: 56, visible_not_projected_px: 88, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 },
  ],
  ghost_px: {
    'full:back hair': 0,
    'full:bottomwear': 0,
    'full:footwear': 4,
    'full:headwear': 0,
    'full:neck': 9,
    'full:topwear': 0,
    'head:back hair': 0,
    'head:face': 0,
  },
  recomposite: {
    mean_abs: 120.053,
    within_limit: 8,
    within_share: 0.3625,
    error_limit: 40,
    error_px: 2611,
    covered_alpha: 128,
    uncovered_error_px: 2611,
    hole_count: 1,
    holes_listed: 5,
    holes: [
      {
        px: 2611,
        x: 0,
        y: 0,
        w: 64,
        h: 64,
        borders: [
          { part: 'topwear', px: 86 },
          { part: 'hair_back', px: 84 },
          { part: 'bottomwear', px: 72 },
          { part: 'shoes', px: 48 },
          { part: 'face', px: 34 },
        ],
      },
    ],
  },
};

/**
 * The flat fixture's layers in no plan row (issue #308), one note each, in the
 * full run's draw order: `footwear` holds 20 x 6 = 120 run px once its 2 x 2
 * speck is cleaned as a ghost, under the 150-px floor, and the head run has
 * no footwear; `neck` is a head tag, which the proposer takes from the head
 * run only, and the full run's 3 x 3 neck is all ghost (0 px) — the head run
 * has no neck. Every other tag either run holds is in a row.
 */
export const EXPECTED_UNPLANNED_NOTES: string[] = [
  "footwear: in no plan row — full run: 120 px, empty: below the proposer's floor of 150 (PROPOSE_MIN_PX, src/assemble.ts); head run: no layer (px: run pixels of alpha above 8 after ghost clean-up)",
  'neck: in no plan row — full run: 0 px, but the proposer takes neck from the head run only (PROPOSE_HEAD_TAGS, src/assemble.ts); head run: no layer (px: run pixels of alpha above 8 after ghost clean-up)',
];

/** The flat fixture's one note before the layers in no row: the head run lacks headwear (0 rig px) while the full run has 192. */
export const EXPECTED_HEADWEAR_NOTE = 'headwear: head run 0 rig px < 0.8 x full run 192 -> full-run layer, drawn behind the face';

/** What `--propose-plan` must say for the flat fixture, derived in `selftest.ts` beside the control. */
export const EXPECTED_PROPOSAL = {
  plan: [
    ['hair_back', 'head', 'back hair'],
    ['hairpin', 'full', 'headwear'],
    ['bottomwear', 'full', 'bottomwear'],
    ['topwear', 'full', 'topwear'],
    ['face', 'head', 'face'],
  ],
  extend_below_crop: [{ part: 'hair_back', run: 'full', tag: 'back hair' }],
  notes: [EXPECTED_HEADWEAR_NOTE, ...EXPECTED_UNPLANNED_NOTES],
};

/**
 * The author-made layer twin (issue #256): the flat fixture's full run plus one
 * layer the author made, `author:hand`, run [31, 44) x [46, 59) — 13 x 13 =
 * 169 opaque px, at or above the proposer's 150-px floor, and disjoint from
 * every other full-run layer (topwear ends at x 30, back hair at y 44,
 * bottomwear starts at x 48, footwear's two rectangles are x [10, 30) and
 * [60, 62)). Depth 0.45 lies between topwear (0.5) and footwear (0.4), so it
 * is fifth in the run's draw order. The full run maps 1:1 onto the rig (the
 * 128-px painting at rig scale 0.5 is 64 rig px over 64 run px, no pad), so the
 * part is rig [31, 44) x [46, 59), 169 px, and nothing is drawn in front of it.
 * `tag` lets the same rectangle stand for the borrowed-tag workaround.
 */
export function authorFullLayers(tag = 'author:hand'): RunLayerSpec[] {
  return [...FULL_LAYERS, { name: tag, depth: 0.45, rects: [rect(31, 46, 44, 59, C)] }];
}
/** The author layer's part as `assemble` writes it: the box and the opaque count derived above. */
export const AUTHOR_PART = { name: 'hand', x: 31, y: 46, w: 13, h: 13, opaque_px: 169 };
/** The flat fixture's proposed plan with the author layer's part where the proposer puts it: after topwear, before the head run's face. */
export function authorPlan(tag = 'author:hand'): Array<[string, 'full' | 'head', string]> {
  const p = EXPECTED_PROPOSAL.plan as Array<[string, 'full' | 'head', string]>;
  return [...p.slice(0, 4), [AUTHOR_PART.name, 'full', tag], p[4]];
}

/** The full run with the back hair a bob and a tail that does not touch it (issue #233), as the module doc derives it. */
export const TAIL_FULL_LAYERS: RunLayerSpec[] = FULL_LAYERS.map((l) => (l.name === 'back hair' ? { ...l, rects: [rect(38, 10, 46, 20, C), rect(36, 22, 44, 52, C)] } : l));
/** The head run whose back hair stops above the crop line: run [44, 60) x [20, 40), rig [38, 46) x [10, 20). */
export const TAIL_HEAD_LAYERS: RunLayerSpec[] = HEAD_LAYERS.map((l) => (l.name === 'back hair' ? { ...l, rects: [rect(44, 20, 60, 40, C)] } : l));
/** The tail's body, rig px, and the uncovered error px of the tail twin assembled on its proposed plan. */
export const TAIL_BODY = { px: 240, x: 36, y: 22, w: 8, h: 30 };
export const TAIL_UNCOVERED_ERROR_PX = 2768;
/** The full run with the back hair grown by a band no 5x5 square fits in, as the module doc derives it. */
export const BAND_FULL_LAYERS: RunLayerSpec[] = FULL_LAYERS.map((l) => (l.name === 'back hair' ? { ...l, rects: [rect(34, 8, 50, 44, C)] } : l));
/** The band's uncovered pixels before the opening: one component, over the 150-px bar. */
export const BAND_PX = 176;
/** The flat fixture's headwear on its own plan, which takes no part from it. */
export const HEADWEAR_BODY = { px: 168, x: 4, y: 2, w: 16, h: 12 };

/** The landscape twin's painting height and its derived pads, as the module doc derives them. */
export const LANDSCAPE_H = 124;
export const LANDSCAPE_PAD_TOP = 2;
export const LANDSCAPE_RUN_DY = 1;

/** A run's layers moved down `dy` run pixels. */
export function shiftRun(layers: RunLayerSpec[], dy: number): RunLayerSpec[] {
  return layers.map((l) => ({ ...l, rects: l.rects.map((q) => ({ ...q, y0: q.y0 + dy, y1: q.y1 + dy })) }));
}

/** The portrait full run moved down by the landscape twin's pad in run pixels. */
export const LANDSCAPE_FULL_LAYERS: RunLayerSpec[] = shiftRun(FULL_LAYERS, LANDSCAPE_RUN_DY);

/** The landscape twin's parts.json: the portrait's parts and ghosts, and the recomposite over a 64 x 62 rig, as derived above. */
export const LANDSCAPE_EXPECTED_PARTS = {
  ...EXPECTED_PARTS,
  rig_size: [64, 62] as [number, number],
  recomposite: {
    ...EXPECTED_PARTS.recomposite,
    mean_abs: 117.851,
    within_share: 0.3742,
    error_px: 2483,
    uncovered_error_px: 2483,
    holes: [{ ...EXPECTED_PARTS.recomposite.holes[0], px: 2483, h: 62 }],
  },
};

export function paint(w: number, h: number, background: RGB | null, rects: Rect[]): Raster {
  const r = newRaster(w, h);
  if (background !== null) for (let i = 0; i < w * h; i++) r.data.set([...background, 255], i * 4);
  for (const q of rects) for (let y = q.y0; y < q.y1; y++) for (let x = q.x0; x < q.x1; x++) r.data.set([...q.colour, 255], (y * w + x) * 4);
  return r;
}

export function flatPainting(side = SOURCE_SIDE, width = side): Raster {
  return paint(width, side, C, []);
}

/** The flat painting, 128 wide and 124 tall: the landscape twin's. */
export function landscapePainting(): Raster {
  return paint(SOURCE_SIDE, LANDSCAPE_H, C, []);
}

/** Rectangles are painted in order, so the white hole goes over the block. */
export function framedPainting(): Raster {
  return paint(SOURCE_SIDE, SOURCE_SIDE, WHITE, [rect(16, 16, 96, 96, C), rect(40, 40, 72, 72, WHITE), rect(104, 16, 108, 96, C)]);
}

export const FRAMED_FULL: RunLayerSpec[] = [
  { name: 'topwear', depth: 0.5, rects: [rect(24, 24, 32, 32, NAVY)] },
  { name: 'bottomwear', depth: 0.6, rects: [rect(52, 20, 54, 40, Z)] },
];
export const FRAMED_PLAN: Array<[string, 'full' | 'head', string]> = [
  ['bottomwear', 'full', 'bottomwear'],
  ['topwear', 'full', 'topwear'],
];
export const STRIP_FULL: RunLayerSpec[] = [
  { name: 'topwear', depth: 0.5, rects: [rect(10, 10, 40, 40, C)] },
  { name: 'neckwear', depth: 0.3, rects: [rect(20, 5, 23, 50, C)] },
];
export const STRIP_PLAN: Array<[string, 'full' | 'head', string]> = [
  ['topwear', 'full', 'topwear'],
  ['neckwear', 'full', 'neckwear'],
];
/** Per rule, per part: [visible_px, occluded_px, source_px_taken, visible_not_projected_px], as derived above. */
export const STRIP_EXPECTED: Record<'core' | 'visible', Record<string, [number, number, number, number]>> = {
  core: { topwear: [810, 90, 494, 316], neckwear: [135, 0, 0, 135] },
  visible: { topwear: [810, 90, 690, 120], neckwear: [135, 0, 135, 0] },
};
export function hemPainting(): Raster {
  return paint(SOURCE_SIDE, SOURCE_SIDE, WHITE, [rect(16, 16, 112, 112, C)]);
}

export const HEM_FULL: RunLayerSpec[] = [
  { name: 'topwear', depth: 0.5, rects: [rect(8, 8, 56, 36, C)] },
  { name: 'bottomwear', depth: 0.6, rects: [rect(24, 40, 40, 56, C)] },
];
export const HEM_PLAN: Array<[string, 'full' | 'head', string]> = [
  ['topwear', 'full', 'topwear'],
  ['bottomwear', 'full', 'bottomwear'],
];
/** The rig pixels of the gap that are exactly the painting's `C`, as derived above. */
export const HEM_BOX: [number, number, number, number] = [11, 36, 53, 40];
export const HEM_BOX_PX = 42 * 4;
/** The same patch reaching under both neighbours, and what it takes and uncovers, as derived above. */
export const HEM_UNDER: [number, number, number, number] = [11, 34, 53, 42];
export const HEM_UNDER_PX = 42 * 8;
export const HEM_UNDER_DROP = 42 * 4 + 2 * 26;
/** The whole gap band, through the figure's edge and the white page either side. */
export const HEM_BAND: [number, number, number, number] = [0, 36, 64, 40];

/**
 * Issue #255: See-through's depth and the plan's draw order disagree over a
 * shared region. On the flat `C` painting, legwear (`C`, run [10, 40) x
 * [10, 40)) is BEHIND bottomwear (`NAVY`, [10, 40) x [30, 54)) by depth,
 * and the plan draws legwear in front. The shared region is [10, 40) x
 * [30, 40), 300 px. `NAVY` is 80 off `C` in its worst channel, inside the
 * drift limit (90): See-through's skirt colour is close enough to the thigh
 * the painting shows that projection would take the thigh into the skirt —
 * the issue's patchwork.
 *
 * - By the plan, legwear owns the shared region: its top set is its whole
 *   900 px rectangle, core [12, 38) x [12, 38) = 676, all taken; bottomwear's
 *   top set is [10, 40) x [40, 54) = 420, core [12, 38) x [42, 52) = 260, all
 *   taken, and its 300 shared pixels are occluded and keep `NAVY`.
 * - By depth (the reference's rule), bottomwear owns it: its top set is
 *   [10, 40) x [30, 54) = 720, core [12, 38) x [32, 52) = 520; legwear's is
 *   [10, 40) x [10, 30) = 600, core [12, 38) x [12, 28) = 416. Bottomwear's
 *   core rows 32..39 lie in the shared region, 8 x 26 = 208 px, each
 *   blended towards the painting's `C` with a weight above 0.4 (a Gaussian of
 *   sigma 1 over an accepted set it lies inside), so none of them stays `NAVY`.
 */
export const OVERLAP_FULL: RunLayerSpec[] = [
  { name: 'legwear', depth: 0.6, rects: [rect(10, 10, 40, 40, C)] },
  { name: 'bottomwear', depth: 0.4, rects: [rect(10, 30, 40, 54, NAVY)] },
];
export const OVERLAP_PLAN: Array<[string, 'full' | 'head', string]> = [
  ['bottomwear', 'full', 'bottomwear'],
  ['legwear', 'full', 'legwear'],
];
export const OVERLAP_SHARED: [number, number, number, number] = [10, 30, 40, 40];
/** Per owner rule, per part: [source_px_taken, visible_px, occluded_px], and the bottomwear pixels of the shared region that are no longer `NAVY` — as derived above. */
export const OVERLAP_EXPECTED = {
  plan: { legwear: [676, 900, 0], bottomwear: [260, 420, 300], stolen: 0 },
  depth: { legwear: [416, 600, 300], bottomwear: [520, 720, 0], stolen: 208 },
} as const;

/**
 * Issue #255's refused body: topwear (`C`, run [10, 40) x [10, 50)) carries a
 * `Z` block over [16, 30) x [12, 26), 196 px inside its core [12, 38) x
 * [12, 48), so projection refuses all 196 (`Z` is 210 off `C`). A 14 x 14
 * block survives a 5 x 5 opening whole: one body of 196 px at 16,12 14x14,
 * over the full run's bar of 150 rig px (k = 1). The head run's face, run
 * [0, 28) x [24, 52), lands on rig [16, 30) x [12, 26) — exactly the block —
 * and the plan draws it after topwear, so the face holds all 196 px.
 * The scattered twin puts `Z` on every pixel of topwear's core with x + y
 * even: 26 x 36 / 2 = 468 refusals, more than the bar, and no 5 x 5 square
 * of them, so no body.
 */
export const DRIFT_FULL: RunLayerSpec[] = [{ name: 'topwear', depth: 0.5, rects: [rect(10, 10, 40, 50, C), rect(16, 12, 30, 26, Z)] }];
export const DRIFT_HEAD: RunLayerSpec[] = [{ name: 'face', depth: 0.5, rects: [rect(0, 24, 28, 52, C)] }];
export const DRIFT_PLAN: Array<[string, 'full' | 'head', string]> = [
  ['topwear', 'full', 'topwear'],
  ['face', 'head', 'face'],
];
export const DRIFT_BODY = { px: 196, x: 16, y: 12, w: 14, h: 14 };
const checker: Rect[] = [];
for (let y = 12; y < 48; y++) for (let x = 12; x < 38; x++) if ((x + y) % 2 === 0) checker.push(rect(x, y, x + 1, y + 1, Z));
export const DRIFT_SCATTER_FULL: RunLayerSpec[] = [{ name: 'topwear', depth: 0.5, rects: [rect(10, 10, 40, 50, C), ...checker] }];
export const DRIFT_SCATTER_PX = 468;

export const FRAMED_HEAD: RunLayerSpec[] = [{ name: 'face', depth: 0.5, rects: [rect(0, 0, 8, 8, C)] }];

/** One run in the wrapper form: `layers.json` plus one PNG per layer, each cut to its rectangles' bounding box. */
export function writeRun(dir: string, layers: RunLayerSpec[], canvas = RESOLUTION): void {
  mkdirSync(join(dir, 'parts'), { recursive: true });
  const entries = layers.map((l) => {
    const left = Math.min(...l.rects.map((q) => q.x0));
    const top = Math.min(...l.rects.map((q) => q.y0));
    const right = Math.max(...l.rects.map((q) => q.x1));
    const bottom = Math.max(...l.rects.map((q) => q.y1));
    const shifted = l.rects.map((q) => ({ ...q, x0: q.x0 - left, x1: q.x1 - left, y0: q.y0 - top, y1: q.y1 - top }));
    writeFileSync(join(dir, 'parts', `${l.name}.png`), encodePngBytes(paint(right - left, bottom - top, null, shifted)));
    return { name: l.name, filename: `asm_${l.name.replace(' ', '_')}.png`, left, top, right, bottom, depth_median: l.depth };
  });
  writeFileSync(join(dir, 'layers.json'), `${JSON.stringify({ layers: entries, width: canvas, height: canvas }, null, 2)}\n`);
}

/** A config the loader accepts, carrying the stage's fields and one-bone placeholders for the rest. */
export function assembleConfig(
  overrides: { plan?: unknown; extend?: unknown; patches?: Array<Record<string, unknown>>; headBox?: unknown; resolution?: number; rigScale?: number; seethrough?: boolean } = {},
): Record<string, unknown> {
  const plan = (overrides.plan ?? PLAN) as Array<[string, string, string]>;
  const assemble: Record<string, unknown> = { rig_scale: overrides.rigScale ?? RIG_SCALE, plan, extend_below_crop: overrides.extend ?? EXTEND };
  if (overrides.patches !== undefined) assemble.patches = overrides.patches;
  const cfg: Record<string, unknown> = {
    key: 'assemble-fixture',
    assemble,
    bones: [{ name: 'anchor', parent: 'root', at: [0, 0] }],
    meshes: {},
    regions: Object.fromEntries([...plan.map((p) => p[0]), ...(overrides.patches ?? []).map((q) => String(q.name))].map((n) => [n, 'anchor'])),
    motion: { duration: 1, tracks: [] },
  };
  if (overrides.seethrough !== false) {
    cfg.seethrough = { resolution: overrides.resolution ?? RESOLUTION, steps: 1, seed: 0, offload: false, head_box: overrides.headBox ?? HEAD_BOX };
  }
  return cfg;
}

/** The whole flat fixture in `dir`: `painting.png`, `full/`, `head/`, `config.json`. */
export function writeAssembleFixture(dir: string, config: Record<string, unknown> = assembleConfig(), painting: Raster = flatPainting(), runs: { full: RunLayerSpec[]; head: RunLayerSpec[] } = { full: FULL_LAYERS, head: HEAD_LAYERS }): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'painting.png'), encodePngBytes(painting));
  writeRun(join(dir, 'full'), runs.full);
  writeRun(join(dir, 'head'), runs.head);
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Issue #349: limbs cut at their joints, on the 64x64 flat painting at scale 1 (a run pixel is a rig pixel), every
 * layer colour C. Each count below is derived in the assemble suite's limb controls (AS234 on).
 *
 * - `handwear-r`, one arm: the upper arm x 12..17, y 10..29 (6 x 20 = 120 px), the forearm x 10..19, y 30..49
 *   (10 x 20 = 200 px). Chain `sleeve_r` (15, 10) -> (15, 30), tip (15, 50): the elbow at (15, 30), its line y = 30.
 * - `legwear`, two legs in one layer: x 30..37 and x 44..51, y 10..49 (8 x 40 = 320 px each). Chains `leg_r` (34, 10)
 *   -> (34, 30), tip (34, 50) and `leg_l` (48, 10) -> (48, 30), tip (48, 50).
 * - `footwear`, two shoes in one layer: x 29..38 and x 43..52, y 50..54 (10 x 5 = 50 px each). Bones `foot_r` at
 *   (34, 50) under `leg_r1` and `foot_l` at (48, 50) under `leg_l1`, both `noRotationOrReflection`.
 */
export const LIMB_FULL: RunLayerSpec[] = [
  { name: 'legwear', depth: 0.6, rects: [rect(30, 10, 38, 50, C), rect(44, 10, 52, 50, C)] },
  { name: 'footwear', depth: 0.6, rects: [rect(29, 50, 39, 55, C), rect(43, 50, 53, 55, C)] },
  { name: 'handwear-r', depth: 0.5, rects: [rect(12, 10, 18, 30, C), rect(10, 30, 20, 50, C)] },
];
export const LIMB_PLAN: Array<[string, 'full' | 'head', string]> = [
  ['legs', 'full', 'legwear'],
  ['shoes', 'full', 'footwear'],
  ['arm', 'full', 'handwear-r'],
];
export const LIMB_BONES: Array<Record<string, unknown>> = [
  { name: 'hip', parent: 'root', at: [32, 8] },
  { chain: 'sleeve_r', parent: 'hip', points: [[15, 10], [15, 30]], tip: [15, 50] },
  { chain: 'leg_r', parent: 'hip', points: [[34, 10], [34, 30]], tip: [34, 50] },
  { chain: 'leg_l', parent: 'hip', points: [[48, 10], [48, 30]], tip: [48, 50] },
  { name: 'foot_r', parent: 'leg_r1', at: [34, 50], inherit: 'noRotationOrReflection' },
  { name: 'foot_l', parent: 'leg_l1', at: [48, 50], inherit: 'noRotationOrReflection' },
];
export const LIMBS: Record<string, { segments: Array<Record<string, unknown>> }> = {
  arm_r: {
    segments: [
      { part: 'upperarm_r', from: 'arm', bone: 'sleeve_r0' },
      { part: 'forearm_r', from: 'arm', bone: 'sleeve_r1', joint: 'elbow' },
    ],
  },
  leg_r: {
    segments: [
      { part: 'thigh_r', from: 'legs', bone: 'leg_r0' },
      { part: 'shin_r', from: 'legs', bone: 'leg_r1', joint: 'knee' },
      { part: 'foot_r', from: 'shoes', bone: 'foot_r', joint: 'ankle' },
    ],
  },
  leg_l: {
    segments: [
      { part: 'thigh_l', from: 'legs', bone: 'leg_l0' },
      { part: 'shin_l', from: 'legs', bone: 'leg_l1', joint: 'knee' },
      { part: 'foot_l', from: 'shoes', bone: 'foot_l', joint: 'ankle' },
    ],
  },
};

/** The limb fixture's config: the plan, the bones and the limbs, every limb part a region on its segment's bone. */
export function limbConfig(limbs: Record<string, unknown> = LIMBS, bones: Array<Record<string, unknown>> = LIMB_BONES): Record<string, unknown> {
  const cfg = assembleConfig({ plan: LIMB_PLAN, extend: [] });
  const regions: Record<string, string> = {};
  for (const l of Object.values(limbs) as Array<{ segments: Array<Record<string, unknown>> }>) for (const s of l.segments) regions[String(s.part)] = String(s.bone);
  return { ...cfg, limbs, bones, regions };
}

/**
 * Issue #490: a hanging arm layer (`handwear-r`) that merges sleeve, bare hand
 * and overgarment drape into one full-run layer on the 64x64 run canvas (latent
 * 128x128, scale 1:1 to the 64x64 rig).
 *
 * - `MERGED_ARM_KEY_SKELETON` places `r_shoulder` at `(30, 12)`, `r_elbow` at
 *   `(30, 24)` and `r_wrist` at `(30, 48)` in 128x128 latent px — `(15, 6)`,
 *   `(15, 12)` and `(15, 24)` in run px, so `forearm = |r_wrist - r_elbow| = 12.0`
 *   run px.
 * - The sleeve is `[8, 22) x [4, 20)` (`14 x 16 = 224` px, `rgb(40, 60, 180)`),
 *   the bare hand is `[10, 20) x [20, 26)` (`10 x 6 = 60` skin px >= `GHOST_MIN_AREA = 40`,
 *   `rgb(220, 175, 145)`, rows `y = 20..25` at `r_wrist`), and the overgarment
 *   drape is `[8, 22) x [26, 42)` (`14 x 16 = 224` px, rows `y = 26..41`, so
 *   `spanBelowWrist = 41 - 24 = 17.0` px = `1.42x` the `12.0` px forearm,
 *   above the `1.0x` forearm threshold).
 * - In `MERGED_ARM_SPLIT_FULL`, the drape is `rgb(180, 50, 50)` (Euclidean RGB
 *   distance `192.6 >= 80` from the sleeve), so `handwear-r` splits into
 *   `drape_r` (`224` px), `sleeves` (`224` px) and `hand_r` (`60` px).
 * - In `MERGED_ARM_REFUSED_FULL`, the drape is `rgb(45, 65, 175)` (Euclidean
 *   RGB distance `8.7 < 80` from the sleeve), so both `proposePlan` and
 *   `assemble` refuse with `SEETHROUGH_ARM_RUN_MERGED`.
 * - Without `keySkeleton` (the detector-off mutant), all three rectangles stay
 *   merged in one `sleeves` part of `224 + 60 + 224 = 508` px.
 */
export const MERGED_ARM_KEY_SKELETON: ControlSkeleton = {
  latent: [SOURCE_SIDE, SOURCE_SIDE],
  points: {
    ...scaledPoints('stand_sides', SOURCE_SIDE, SOURCE_SIDE),
    r_shoulder: [30, 12],
    r_elbow: [30, 24],
    r_wrist: [30, 48],
  },
};
export const MERGED_ARM_SLEEVE_RGB: RGB = [40, 60, 180];
export const MERGED_ARM_HAND_RGB: RGB = [220, 175, 145];
export const MERGED_ARM_DISTINCT_DRAPE_RGB: RGB = [180, 50, 50];
export const MERGED_ARM_SAME_DRAPE_RGB: RGB = [45, 65, 175];
export const MERGED_ARM_SPLIT_FULL: RunLayerSpec[] = [
  ...FULL_LAYERS,
  {
    name: 'handwear-r',
    depth: 0.35,
    rects: [
      rect(8, 4, 22, 20, MERGED_ARM_SLEEVE_RGB),
      rect(10, 20, 20, 26, MERGED_ARM_HAND_RGB),
      rect(8, 26, 22, 42, MERGED_ARM_DISTINCT_DRAPE_RGB),
    ],
  },
];
export const MERGED_ARM_REFUSED_FULL: RunLayerSpec[] = [
  ...FULL_LAYERS,
  {
    name: 'handwear-r',
    depth: 0.35,
    rects: [
      rect(8, 4, 22, 20, MERGED_ARM_SLEEVE_RGB),
      rect(10, 20, 20, 26, MERGED_ARM_HAND_RGB),
      rect(8, 26, 22, 42, MERGED_ARM_SAME_DRAPE_RGB),
    ],
  },
];
export const MERGED_ARM_EXPECTED_SPLIT_PARTS: ReadonlyArray<readonly [string, string, number]> = [
  ['drape_r', 'full:drape-r', 224],
  ['sleeves', 'full:handwear-r', 224],
  ['hand_r', 'full:hand-r', 60],
];
export const MERGED_ARM_EXPECTED_MUTANT_PARTS: ReadonlyArray<readonly [string, string, number]> = [['sleeves', 'full:handwear-r', 508]];

