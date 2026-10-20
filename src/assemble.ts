/**
 * The assemble stage: two See-through runs over one painting — a FULL-body run
 * and a HEAD-crop run — merged into one set of rig-space parts, each part one
 * RGBA image cropped to its own alpha box, plus the `parts.json` measurement
 * record (`src/parts.ts`) and a flat recomposite to compare with the painting.
 *
 * Rig space is source pixels times `assemble.rig_scale`, y down, origin
 * top-left; the rig canvas is `trunc(w * s) x trunc(h * s)`. The painting is
 * resampled into it once (`sourceInRig`) and every "source" pixel below is a
 * pixel of that resample.
 *
 * Each See-through layer goes through five steps, each its own function with
 * its invariant stated where it is written:
 *
 *   1. `cleanGhosts`      — drop sub-threshold specks from a run-space layer;
 *   2. `layerToRig`       — resample the layer into rig space through its run's geometry;
 *   3. `projectSource`    — where the layer is the top-most opaque layer of its run,
 *                           take the painting's pixel instead of See-through's repaint;
 *   4. `mergeBelowCrop`   — a head-run part below the head crop is continued from a
 *                           full-run layer (whole components, `belowCrop`), and its
 *                           seam closed by `growRim`;
 *   4b. `pushBackFringe`  — a fringe below alpha 250 that keeps the stack off the
 *                           painting where a part beneath holds the pixel in the
 *                           painting's colour is cleared (not in the reference);
 *   5. `seamOverride`     — where the flat composite of the parts still differs from
 *                           the painting, the top-most part takes the painting's colour.
 *
 * This is a port of a reference implementation, and it is faithful to it by
 * default — measured against its outputs (ORACLE_assemble.md at the root of
 * the change that added this file). The places it deliberately is NOT are
 * named here, so none is found by accident:
 *
 * - **Refusals where the reference guessed or skipped.** A plan or extend
 *   entry naming a tag its run does not hold (the reference raised a KeyError),
 *   a part left with no opaque pixel (the reference printed `EMPTY` and wrote a
 *   `parts.json` without it), a head box outside the painting (the reference
 *   read row `-1` as the last row), a run whose canvas is not the configured
 *   resolution (the reference assumed 1024).
 * - **A landscape painting is mapped back, not refused.** The reference
 *   refused one as a bare exit; here the full run's input is the painting on a
 *   square of its longer side (`squarePad`, `src/inputs.ts`), and the full
 *   run's map carries the vertical pad exactly as it carries the horizontal
 *   one. A portrait painting's vertical pad is 0, so its map is the
 *   reference's.
 * - **One run's file need not be square** (issue #366): with no head run the
 *   file is padded to the `resolution` square by the same centring
 *   (`padToSquare`, `padSingleRun`) and mapped back one run pixel to one
 *   source pixel, so the rig is the file with no pad in it; `parts.json`
 *   records the pad (`single_run_pad`) and the painting must be the file's
 *   size. A file that is the square is read as it was.
 * - **`seamRule: 'silhouette'`** is available beside the faithful
 *   `'near-white'` rule. The reference's seam override skips every pixel whose
 *   painting colour is near-white (min channel above 235), which protects the
 *   background and also every white garment. The silhouette rule skips a
 *   near-white pixel only OUTSIDE the figure (`figureSilhouette`). Which one
 *   is the default is decided by measurement, recorded beside
 *   `DEFAULT_SEAM_RULE`.
 * - **`projectRule: 'visible'`** is available beside the faithful `'core'`
 *   rule (`ProjectRule`): the reference erodes every layer's top-most opaque
 *   area before projecting, so a part a few pixels wide takes nothing from the
 *   painting; `visible` erodes only along a rim with a later layer in front.
 * - **The visibility counts** (`visible_px`, `occluded_px`,
 *   `visible_not_projected_px`) are this port's, derived from the masks
 *   `projectSource` and `mergeBelowCrop` already build (`visibilityCounts`).
 * - **The recomposite's holes and error map** (`uncoveredHoles`,
 *   `recompositeErrorMap`) are this port's: the reference printed the
 *   uncovered count alone, which says a hole exists but not where.
 * - **The fringe push-back** (`pushBackFringe`, issue #119) is this port's,
 *   and it is on by default: the reference left a fringe below alpha 250 in
 *   another part's colour on the rig, where neither projection nor the seam
 *   override (both at alpha >= 250) could reach it. Its effect on the public
 *   examples is counted in the pull request that added it; a stack it does
 *   not touch assembles to the reference's bytes.
 * - **Patches** (`assemble.patches`, `cutPatch`) are this port's: an extra
 *   part cut from the painting itself, for a piece of the figure no layer
 *   holds, recorded as `painting:<name>` and 100 % source.
 * - **Cuts** (`assemble.cuts`, `cutPart`, issue #170) are this port's: a
 *   declared polygon takes a plan part's pixels out of it into a new part,
 *   recorded with the same `<run>:<tag>` (its pixels came from that layer).
 *   The cut is made after step 4, so the new part takes the merged pixels and
 *   every later step treats it as a part of its own.
 * - **The owner of a pixel follows the plan** (`pixelOwners`, issue #255):
 *   where two planned layers of one run are both opaque, the one the plan
 *   draws in front owns the pixel for projection; the reference went by
 *   See-through's depth alone. The proposer writes each run's parts in depth
 *   order, so the two differ only where an author reorders a plan; on the
 *   public examples no pixel changes owner, and they assemble to the bytes
 *   they did.
 * - **The drift line** (`driftBodies`, issue #255) is this port's: a part
 *   whose `DRIFT_LIMIT` refusals hold a body another part holds in the draw
 *   order is named, with the body and that part; the reference printed the
 *   refused count alone.
 * - **What lies under a piece** (`cuts[].under`, `fillUnder`, issue #193) is
 *   this port's: an authored image the base takes where the cut removed its
 *   pixels, so a piece that swings away leaves no hole. The stage reads that
 *   image only there and never invents a pixel. With `under_fill: "colour"`
 *   (issue #360) the base takes the image's colour only and keeps the alpha
 *   the cut removed, so the part's silhouette is the uncut layer's.
 *
 * Pure: no clock, no randomness, no file access. The CLI reads and writes.
 */
import { type ArmSplit, type BoneEntry, type CharacterConfig, type ControlSkeleton, controlSkeletonOf, type Cut, type EarlyConfig, type Extend, type Limb, type Patch, type PlanEntry, type Run, type SeeThrough } from './config.ts';
import { type Problem, refuseIfAny } from './errors.ts';
import { figuresPhrase, implausibleRules, type Layer, type LayerFigures, layerFigures, type LayerSet, NEAR_WHITE_MIN, OPAQUE_ALPHA_ABOVE, ruleSummary } from './layers.ts';
import { padToSquare, squarePad } from './inputs.ts';
import { type CapRecord, type LimbRecord, PAINTING_RUN, type PartRecord, type PartsFile, type RecompositeRecord, type SceneRecord, type SingleRunPad } from './parts.ts';
import { assignCrossedLimbs, assignOverlappingHands, type BonePlace, bonePlaces, capBox, coveredRadius, type CutPlacement, featherWeight, halfWidthAbout, inDisc, jointLine, type JointLine, jointOffsets, limbPolyline, limbRun, luma601, nearestLimb, nearestOnLine, offLineFigure, pastJoint, placeCut, segmentOf } from './limbs.ts';
import {
  alphaComposite,
  connectedComponents,
  crop,
  dilate,
  erode,
  fillHoles,
  gaussianBlur,
  type Mask,
  morphClose,
  newFloatImage,
  newMask,
  newRaster,
  type Raster,
  resize,
  warpAffine,
} from './raster/index.ts';
import { pyRound } from './round.ts';
import { ARM_MERGED_SPLIT_TAGS, AUTHOR_NO_ROLE, type LayerTagReading, readAuthorTag, readLayerTag } from './tags.ts';

const f32 = Math.fround;

// ---------------------------------------------------------------------------
// the reference's constants, each named once
// ---------------------------------------------------------------------------

/** Alpha at or above this is "opaque" for ownership, projection cores and the seam override. `>= 250`, not `== 255`: See-through leaves alpha-254 speckle. */
export const CORE_ALPHA = 250;
/** A ghost component is kept when its area is at least this many pixels … */
export const GHOST_MIN_AREA = 40;
/** … and at least this fraction of the layer's largest component. */
export const GHOST_MIN_FRACTION = 0.01;
/** The side of the square erosion that makes a projection core, and of the closing that fills speckle refusals. */
export const CORE_KERNEL = 5;
/** Projection is refused where See-through's pixel and the painting's differ by more than this, max channel. */
export const DRIFT_LIMIT = 90;
/** The Gaussian sigma that feathers the projection weight. */
export const FEATHER_SIGMA = 1.0;
/** Head-run projection stays this many rig pixels inside the head crop. */
export const HEAD_WINDOW_INSET = 3;
/** The head crop's bottom line in rig pixels is `trunc(y1 * s) - HEAD_BOTTOM_INSET`. */
export const HEAD_BOTTOM_INSET = 4;
/** `belowCrop` probes the head part this many rows above the crop line … */
export const CROP_PROBE_ROWS = 2;
/** … seeds components in this many rows from the crop line down … */
export const CROP_SEED_ROWS = 6;
/** … within this many columns of a column where the head part reaches the line. */
export const CROP_SEED_COLUMNS = 12;
/** Alpha above this counts as "the head part reaches the crop line". */
export const CROP_PROBE_ALPHA = 128;
/** Alpha at or above this in a later plan part keeps `growRim`'s ring off the pixel. */
export const FRONT_ALPHA = 128;
/** A painting pixel whose min channel is above this is "near-white" (the faithful rim and seam guard). Defined beside the layer reader, which applies the same test to a layer's colour (`layerFigures`). */
export { NEAR_WHITE_MIN };
/** The seam override acts where the flat composite differs from the painting by more than this, max channel. */
export const SEAM_LIMIT = 60;
/** `--propose-plan` drops a tag with fewer run-space opaque pixels than this after ghost clean-up. */
export const PROPOSE_MIN_PX = 150;
/** The recomposite's "error pixel": max-channel difference from the painting above this. */
export const ERROR_LIMIT = 40;
/** The recomposite's "within" figure: mean-channel difference at or below this. */
export const WITHIN_LIMIT = 8;
/**
 * An error pixel is "uncovered" when no part has alpha above this there. The
 * definition is the one the reference's own demo report measured with, and it
 * reproduces that report's figure exactly (1,564 on the reference's demo
 * output; with "no part has alpha above 0" the same output reads 105).
 */
export const COVERED_ALPHA = 128;
/** `figureSilhouette`: the border ring whose median colour is the background, in rig pixels. */
export const SILHOUETTE_BORDER = 8;
/** `figureSilhouette`: a pixel is figure where it differs from that median by more than this, max channel. */
export const SILHOUETTE_LIMIT = 40;

export type SeamRule = 'near-white' | 'silhouette';
export const SEAM_RULES: readonly SeamRule[] = ['near-white', 'silhouette'];

/**
 * The seam rule a run uses when none is named. Set by measurement, not taste:
 * the silhouette rule ships as the default only if it lowers the error pixel
 * count on every oracle character without raising mean |d| on any
 * (ORACLE_assemble.md, *faithful vs silhouette*).
 */
export const DEFAULT_SEAM_RULE: SeamRule = 'near-white';

/**
 * Where a layer may take the painting's pixel (`projectSource`). `core` is the
 * reference's rule: the layer's top-most `alpha >= 250` pixels eroded by a 5x5
 * square, so a part a few pixels wide has no core and none of its visible
 * pixels is projected. `visible` keeps the erosion only where it guards
 * something — along a rim where a later layer of the run is in front — and
 * projects every other top-most `alpha >= 250` pixel of the layer.
 */
export type ProjectRule = 'core' | 'visible';
export const PROJECT_RULES: readonly ProjectRule[] = ['core', 'visible'];

/**
 * The projection rule a run uses when none is named: the reference's, so the
 * examples stay comparable with it. `visible` was measured on both public
 * examples against it (the change that added the flag); it is opt-in.
 */
export const DEFAULT_PROJECT_RULE: ProjectRule = 'core';

// ---------------------------------------------------------------------------
// inputs
// ---------------------------------------------------------------------------

export interface Geometry {
  /** The painting's size in source pixels. */
  sourceW: number;
  sourceH: number;
  /** `seethrough.resolution`: both runs' canvas side. */
  resolution: number;
  /** `seethrough.head_box`, source pixels. */
  headBox: [number, number, number, number];
  /** `assemble.rig_scale`: rig pixels per source pixel. */
  rigScale: number;
  /**
   * One run, no head crop (issue #359): `headBox` is {@link singleRunHeadBox},
   * the full run's own frame, and is not held inside the painting (on a
   * non-square painting the frame reaches past it). Absent: two runs.
   *
   * Issue #366: the run is the artist's file itself, so its frame is the file
   * centred on the `resolution` square ({@link padToSquare}) at one run pixel
   * per source pixel, and the painting must be the file's size.
   */
  single?: boolean;
  /** `seethrough.arm_split` (issue #439): separates overlapping arms on the full run into `handwear-r` and `handwear-l` in the declared order. */
  armSplit?: ArmSplit;
  /** `generation.control.skeleton` (issue #490): the pose keypoints on the `latent` canvas, read for merged arm layers (`splitMergedArmRuns`). */
  keySkeleton?: ControlSkeleton;
  /** `assemble.head_face_underfill` (issue #492): composite `full:face` under `head:face` on the head canvas to fill transparent bare-skin holes. */
  headFaceUnderfill?: boolean;
}

/**
 * Issue #492: minimum share of the full run's hole-filled `face` silhouette
 * (mapped onto the head canvas) that the head run's `face` layer must cover
 * (`alpha > OPAQUE_ALPHA_ABOVE = 8`). Across the 5 public examples the ratio is
 * `0.804..0.986` and across the 6 non-hollow standees `0.816..0.974`, whereas
 * the 3 hollow standee runs sit at `0.000..0.486` — a `0.486 ↔ 0.804` gap of
 * `31.8` percentage points.
 */
export const HEAD_FACE_COVERAGE_FLOOR = 0.75;

/**
 * The tags a single run must hold, each as a layer with an opaque pixel
 * (issue #359): `face`, which places the face box, and the eye group
 * (`EYE_GROUP_TAGS` in `src/propose.ts`, held equal to this list's tail by
 * the selftest), from which the eye bones, the eye line and the blink come.
 * The head run exists because See-through cannot separate these at
 * full-figure scale; a file that already separates them needs no second run.
 */
export const SINGLE_RUN_FACE_TAGS: readonly string[] = ['face', 'eyewhite-r', 'eyewhite-l'];

/**
 * The head box of a single run (issue #359): the full run's own frame on the
 * painting, `[-left, -top, side - left, side - top]` from {@link padToSquare},
 * so the head run's map is the full run's, pixel for pixel. On a square
 * painting it is `[0, 0, w, h]`. Derived, never read from the config: a
 * single run has no crop.
 *
 * `side` is the square the file is padded to, `seethrough.resolution` (issue
 * #366); left out, it is the longer side, {@link squarePad}'s square — the two
 * agree whenever the longer side is the resolution.
 */
export function singleRunHeadBox(w: number, h: number, side: number = Math.max(w, h)): [number, number, number, number] {
  const { left, top } = padToSquare(w, h, side);
  return [-left, -top, side - left, side - top];
}

/**
 * A single run's file padded to the `resolution` square (issue #366): every
 * drawn and hidden-art layer moved by the frame's pad, the canvas the square.
 * No pixel changes; the pad holds none, so it is transparent. The same set
 * comes back when there is no pad, so a square file at the resolution is read
 * exactly as it was.
 */
export function padSingleRun(set: LayerSet, frame: Pick<Frame, 'fullPad' | 'fullPadTop'>, resolution: number): LayerSet {
  const dx = frame.fullPad;
  const dy = frame.fullPadTop;
  if (dx === 0 && dy === 0 && set.canvas.w === resolution && set.canvas.h === resolution) return set;
  return {
    ...set,
    canvas: { w: resolution, h: resolution },
    layers: set.layers.map((l) => ({ ...l, left: l.left + dx, top: l.top + dy, right: l.right + dx, bottom: l.bottom + dy })),
    hidden: set.hidden.map((l) => ({ ...l, left: l.left + dx, top: l.top + dy, right: l.right + dx, bottom: l.bottom + dy })),
  };
}

/**
 * What `parts.json` records of a single run's pad (issue #366), or null when
 * there is none — two runs, or a file that is the resolution square — so that
 * every such `parts.json` keeps its bytes. Run pixel `(x, y)` is file pixel
 * `(x - left, y - top)`; the rig is the file times `scale_rig_per_source`.
 */
export function singleRunPadRecord(single: boolean, sourceW: number, sourceH: number, resolution: number, frame: Pick<Frame, 'fullPad' | 'fullPadTop'>): SingleRunPad | null {
  if (!single || (sourceW === resolution && sourceH === resolution)) return null;
  return { file_size: [sourceW, sourceH], side: resolution, left: frame.fullPad, top: frame.fullPadTop };
}

export interface AssembleInput {
  /** The painting. Its alpha is ignored, as the reference's `convert("RGB")` drops it. */
  source: Raster;
  full: LayerSet;
  head: LayerSet;
  resolution: number;
  headBox: [number, number, number, number];
  rigScale: number;
  plan: PlanEntry[];
  extend: Extend[];
  /** `assemble.patches`: extra parts cut from the painting, placed per their `draw` (`placePatches`). */
  patches: Patch[];
  /** `assemble.cuts`: plan parts' pixels taken into new parts by polygon (`cutPart`), placed per their `draw`. */
  cuts: Cut[];
  /**
   * `cuts[i].under`'s image, decoded by the caller (the stage reads no file),
   * at the cut's index: null for a cut without `under`. Absent = every cut
   * without one. A cut that names `under` with no image here is refused
   * (`ASSEMBLE_UNDER_PRESENT`), never assembled as if it named none.
   */
  under?: ReadonlyArray<Raster | null>;
  seamRule: SeamRule;
  projectRule: ProjectRule;
  /** `config.scene` (issue #242): the painting is a scene, so the recomposite is read inside the figure ({@link sceneFigure}). Absent or false: nothing changes. */
  scene?: boolean;
  /** `config.limbs` (issue #349): the parts cut at their joints ({@link LimbCount}). Absent or empty: nothing changes. */
  limbs?: Record<string, Limb>;
  /** `config.bones`, read for the limbs' joints; required with `limbs`. */
  bones?: BoneEntry[];
  /** Each segment's `cap` image, decoded by the caller, keyed `<limb>/<segment index>`; a segment naming a cap with none here is refused (`ASSEMBLE_LIMB_CAP_PRESENT`). */
  caps?: ReadonlyMap<string, Raster>;
  /** One run (issue #359): `head` is `full`, `headBox` {@link singleRunHeadBox}, and {@link checkSingleRun} holds the plan to it. Absent: two runs. */
  single?: boolean;
  /** `seethrough.arm_split` (issue #439): separates overlapping arms on the full run into `handwear-r` and `handwear-l` in the declared order. */
  armSplit?: ArmSplit;
  /** `generation.control.skeleton` (issue #490): the pose keypoints on the `latent` canvas, read for merged arm layers (`splitMergedArmRuns`). */
  keySkeleton?: ControlSkeleton;
  /** `assemble.head_face_underfill` (issue #492): composite `full:face` under `head:face` on the head canvas to fill transparent bare-skin holes. */
  headFaceUnderfill?: boolean;
}

/** The derived numbers of the two runs' geometry. */
interface Frame {
  W: number;
  H: number;
  S: number;
  /** Full run: the painting was centred on a white `side x side` square (`squarePad`), padded this much on the left… */
  fullPad: number;
  /** …and this much on top, in source px. At most one of the two is non-zero. */
  fullPadTop: number;
  fullK: number;
  headBox: [number, number, number, number];
  headK: number;
  /** The crop line in rig pixels. */
  headBottom: number;
}

/**
 * Check the geometry and derive the frame, refusing by name what the
 * reference would have mis-read. Every problem is collected.
 */
export function checkGeometry(g: Geometry, runs?: { full: LayerSet; head: LayerSet }): Frame {
  const problems: Problem[] = [];
  const fail = (code: string, object: string, detail: string): void => {
    problems.push({ code, object, detail });
  };
  const { sourceW: w, sourceH: h, resolution, headBox, rigScale: S } = g;
  // Issue #366: one run is the file itself, centred on the resolution square at one run px per source px.
  const pad = g.single === true ? padToSquare(w, h, resolution) : squarePad(w, h);
  const W = Math.trunc(w * S);
  const H = Math.trunc(h * S);
  if (W < 1 || H < 1) fail('ASSEMBLE_RIG_SIZE', 'config.assemble.rig_scale', `${S} makes a ${W}x${H} rig from a ${w}x${h} painting; at least 1x1 is required`);
  const [x0, y0, x1, y1] = headBox;
  // A single run (issue #359) has no crop: its box is the full run's frame, derived, and may reach past the painting.
  if (g.single !== true && !(x0 >= 0 && y0 >= 0 && x1 <= w && y1 <= h && x1 > x0 && y1 > y0)) {
    fail('ASSEMBLE_HEAD_BOX_INSIDE', 'config.seethrough.head_box', `is [${headBox.join(', ')}]; a non-empty box inside the ${w}x${h} painting is required`);
  }
  const headBottom = Math.trunc(y1 * S) - HEAD_BOTTOM_INSET;
  if (g.single !== true && headBottom - CROP_PROBE_ROWS < 0 && y1 > y0) {
    fail(
      'ASSEMBLE_HEAD_BOX_INSIDE',
      'config.seethrough.head_box',
      `bottom ${y1} is rig row ${Math.trunc(y1 * S)}; the crop line (that row - ${HEAD_BOTTOM_INSET}) probes ${CROP_PROBE_ROWS} rows above itself, so a bottom at rig row ${HEAD_BOTTOM_INSET + CROP_PROBE_ROWS} or further down is required`,
    );
  }
  if (runs !== undefined && g.single === true) {
    // Issue #366: a single run's file is padded to the resolution square, so a side below it is fixed; a side above it
    // is not, and a painting of another size would map no part back to the file.
    const c = runs.full.canvas;
    if (c.w > resolution || c.h > resolution) {
      fail(
        'ASSEMBLE_RUN_CANVAS',
        `the full run (${runs.full.source})`,
        `has a ${c.w}x${c.h} canvas; with one run the file is padded to the ${resolution}x${resolution} square config.seethrough.resolution ${resolution} makes, and padding cannot shrink a canvas, so no side above ${resolution} is required — a resolution of at least ${Math.max(c.w, c.h)}, the file's longer side`,
      );
    }
    if (c.w !== w || c.h !== h) {
      fail(
        'ASSEMBLE_SINGLE_RUN_SOURCE',
        `the painting (--source, ${w}x${h})`,
        `is not the size of the full run's file (${runs.full.source}), ${c.w}x${c.h}; with one run the painting is that file flattened, and every part's box maps back to the file through it, so a ${c.w}x${c.h} painting is required`,
      );
    }
  } else if (runs !== undefined) {
    for (const run of ['full', 'head'] as const) {
      const c = runs[run].canvas;
      if (c.w !== resolution || c.h !== resolution) {
        fail('ASSEMBLE_RUN_CANVAS', `the ${run} run (${runs[run].source})`, `has a ${c.w}x${c.h} canvas; config.seethrough.resolution ${resolution} makes ${resolution}x${resolution} required`);
      }
    }
  }
  refuseIfAny(problems);
  return {
    W,
    H,
    S,
    fullPad: pad.left,
    fullPadTop: pad.top,
    fullK: pad.side / resolution,
    headBox,
    headK: (x1 - x0) / resolution,
    headBottom,
  };
}

// ---------------------------------------------------------------------------
// step 1 — ghost clean-up
// ---------------------------------------------------------------------------

/**
 * Place a layer's pixels on its run's `resolution x resolution` canvas.
 * `readWrapperLayers`/`readPsdLayers` already refused a box outside it.
 */
export function placeLayer(layer: Pick<Layer, 'pixels' | 'left' | 'top'>, resolution: number): Raster {
  const out = newRaster(resolution, resolution);
  const p = layer.pixels;
  for (let y = 0; y < p.height; y++) {
    out.data.set(p.data.subarray(y * p.width * 4, (y + 1) * p.width * 4), ((layer.top + y) * resolution + layer.left) * 4);
  }
  return out;
}

/**
 * Step 1. See-through writes every tag, and an empty tag still carries a few
 * dozen sub-threshold pixels scattered at the canvas edge.
 *
 * ⚖️ Invariant: afterwards the layer's alpha is non-zero only on the 8-connected
 * components of `alpha > 8` whose area is at least `GHOST_MIN_AREA` and at
 * least `GHOST_MIN_FRACTION` of the largest component's; every other pixel —
 * including every pixel of alpha 8 or less — has alpha 0. Colour channels are
 * untouched. `ghostPx` counts the `alpha > 8` pixels removed. A layer with no
 * `alpha > 8` pixel comes back fully transparent with `ghostPx` 0.
 * (`assemble_parts.py` `clean`.)
 */
export function cleanGhosts(canvas: Raster): { canvas: Raster; ghostPx: number } {
  const { width: w, height: h } = canvas;
  const out: Raster = { width: w, height: h, data: new Uint8ClampedArray(canvas.data) };
  const m = newMask(w, h);
  let any = false;
  for (let i = 0; i < w * h; i++) {
    if (canvas.data[i * 4 + 3] > OPAQUE_ALPHA_ABOVE) {
      m.data[i] = 1;
      any = true;
    }
  }
  if (!any) {
    for (let i = 0; i < w * h; i++) out.data[i * 4 + 3] = 0;
    return { canvas: out, ghostPx: 0 };
  }
  const cc = connectedComponents(m, 8);
  let big = 0;
  for (let l = 1; l < cc.count; l++) big = Math.max(big, cc.stats[l].area);
  const keep = new Uint8Array(cc.count);
  for (let l = 1; l < cc.count; l++) keep[l] = cc.stats[l].area >= Math.max(GHOST_MIN_AREA, GHOST_MIN_FRACTION * big) ? 1 : 0;
  let ghostPx = 0;
  for (let i = 0; i < w * h; i++) {
    const l = cc.labels[i];
    if (keep[l] === 0) {
      if (m.data[i] === 1) ghostPx++;
      out.data[i * 4 + 3] = 0;
    }
  }
  return { canvas: out, ghostPx };
}

export interface RunLayer {
  tag: string;
  /** The cleaned run-space canvas. */
  canvas: Raster;
  drawOrder: number;
  ghostPx: number;
  /** `alpha > 8` pixels after clean-up, in run pixels. */
  opaqueRunPx: number;
}

/** Every layer of a run, placed and cleaned, in draw order (back to front). */
export function runLayers(set: LayerSet, resolution: number): RunLayer[] {
  return set.layers.map((layer) => {
    const { canvas, ghostPx } = cleanGhosts(placeLayer(layer, resolution));
    let opaqueRunPx = 0;
    for (let i = 3; i < canvas.data.length; i += 4) if (canvas.data[i] > OPAQUE_ALPHA_ABOVE) opaqueRunPx++;
    return { tag: layer.name, canvas, drawOrder: layer.drawOrder, ghostPx, opaqueRunPx };
  });
}

/**
 * The integer split column(s) `armSplit` defines on run row `y`: pixels with
 * `x < col` lie on the `handwear-r` side (left of the split in the image) and
 * pixels with `x >= col` lie on the `handwear-l` side.
 */
function splitColumnsAtRow(y: number, armSplit: ArmSplit): number[] {
  if (armSplit.x !== undefined) return [Math.ceil(armSplit.x)];
  const pts = armSplit.line ?? [];
  if (pts.length === 0) return [0];
  const cols: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [xA, yA] = pts[i];
    const [xB, yB] = pts[i + 1];
    if (y < Math.min(yA, yB) || y > Math.max(yA, yB)) continue;
    if (yA === yB) {
      cols.push(Math.ceil(Math.min(xA, xB)));
      if (xA !== xB) cols.push(Math.ceil(Math.max(xA, xB)));
    } else {
      cols.push(Math.ceil(xA + ((y - yA) * (xB - xA)) / (yB - yA)));
    }
  }
  if (cols.length === 0) {
    let minY = pts[0][1];
    let minX = pts[0][0];
    let maxY = pts[0][1];
    let maxX = pts[0][0];
    for (const [px, py] of pts) {
      if (py < minY) {
        minY = py;
        minX = px;
      }
      if (py > maxY) {
        maxY = py;
        maxX = px;
      }
    }
    cols.push(Math.ceil(y < minY ? minX : maxX));
  }
  return [...new Set(cols)].sort((a, b) => a - b);
}

/**
 * Separate an overlapping handwear layer of the full run into `handwear-r` and
 * `handwear-l` along `seethrough.arm_split` (issue #439), placed in the draw
 * order `armSplit.order` declares.
 *
 * Refuses under `ASSEMBLE_ARM_SPLIT_CUTS_ARM` when:
 * - the polyline crosses a single horizontal opaque run at two or more columns;
 * - on a row where the two arms already have separate horizontal opaque runs,
 *   the split falls strictly inside one of those runs;
 * - either resulting arm layer is left with 0 opaque pixels, or an arm is cut
 *   into disconnected components.
 */
export function applyArmSplit(set: LayerSet, resolution: number, armSplit: ArmSplit): LayerSet {
  const handLayers = set.layers.filter((l) => l.name === 'handwear-r' || l.name === 'handwear-l');
  if (handLayers.length === 0) {
    refuseIfAny([
      {
        code: 'ASSEMBLE_ARM_SPLIT_CUTS_ARM',
        object: 'config.seethrough.arm_split',
        detail: `the full run (${set.source}) holds neither "handwear-r" nor "handwear-l"; a handwear layer with opaque pixels on both sides of the split is required`,
      },
    ]);
  }
  const combinedRaw = newRaster(resolution, resolution);
  for (const l of handLayers) {
    const { canvas } = cleanGhosts(placeLayer(l, resolution));
    for (let p = 0; p < resolution * resolution; p++) {
      if (canvas.data[p * 4 + 3] > 0) combinedRaw.data.set(canvas.data.subarray(p * 4, p * 4 + 4), p * 4);
    }
  }
  const { canvas: combined } = cleanGhosts(combinedRaw);
  const rightCanvas = newRaster(resolution, resolution);
  const leftCanvas = newRaster(resolution, resolution);
  let firstCutRun: { y: number; rx0: number; rx1: number; col: number } | null = null;
  for (let y = 0; y < resolution; y++) {
    const runs: Array<[number, number]> = [];
    let x = 0;
    while (x < resolution) {
      if (combined.data[(y * resolution + x) * 4 + 3] <= OPAQUE_ALPHA_ABOVE) {
        x++;
        continue;
      }
      const rx0 = x;
      while (x + 1 < resolution && combined.data[(y * resolution + x + 1) * 4 + 3] > OPAQUE_ALPHA_ABOVE) x++;
      runs.push([rx0, x]);
      x++;
    }
    const cols = splitColumnsAtRow(y, armSplit);
    for (const [rx0, rx1] of runs) {
      const cutting = cols.filter((c) => rx0 < c && c <= rx1);
      if (cutting.length >= 2) {
        refuseIfAny([
          {
            code: 'ASSEMBLE_ARM_SPLIT_CUTS_ARM',
            object: 'config.seethrough.arm_split',
            detail: `cuts the pixel run x = ${rx0}..${rx1} on run row ${y} at columns ${cutting.join(', ')}, splitting one arm's pixel run into multiple parts; a line that crosses each horizontal pixel run at most once is required`,
          },
        ]);
      }
      if (runs.length >= 2 && cutting.length > 0) {
        refuseIfAny([
          {
            code: 'ASSEMBLE_ARM_SPLIT_CUTS_ARM',
            object: 'config.seethrough.arm_split',
            detail: `cuts the pixel run x = ${rx0}..${rx1} on run row ${y} at column ${cutting[0]} into ${rx0}..${cutting[0] - 1} and ${cutting[0]}..${rx1} (row ${y} holds separate arm runs ${runs.map(([a, b]) => `${a}..${b}`).join(', ')}); a split between the arms (${runs[0][1] + 1} <= x <= ${runs[runs.length - 1][0]}) is required so no pixel run of one arm is cut into two parts`,
          },
        ]);
      }
      if (cutting.length === 1 && firstCutRun === null) firstCutRun = { y, rx0, rx1, col: cutting[0] };
    }
    const col = (runs.length === 1 ? cols.find((c) => runs[0][0] < c && c <= runs[0][1]) : undefined) ?? cols[0];
    for (let cx = 0; cx < resolution; cx++) {
      const p = (y * resolution + cx) * 4;
      if (combined.data[p + 3] === 0) continue;
      const dst = cx < col ? rightCanvas.data : leftCanvas.data;
      dst.set(combined.data.subarray(p, p + 4), p);
    }
  }
  const maskOf = (r: Raster): { mask: Mask; opaque: number; x0: number; y0: number; x1: number; y1: number } => {
    const mask = newMask(resolution, resolution);
    let opaque = 0;
    let x0 = resolution;
    let y0 = resolution;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const a = r.data[(y * resolution + x) * 4 + 3];
        if (a > OPAQUE_ALPHA_ABOVE) {
          mask.data[y * resolution + x] = 1;
          opaque++;
        }
        if (a > 0) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return { mask, opaque, x0, y0, x1, y1 };
  };
  const mr = maskOf(rightCanvas);
  const ml = maskOf(leftCanvas);
  if (mr.opaque === 0 || ml.opaque === 0) {
    const emptyTag = mr.opaque === 0 ? 'handwear-r' : 'handwear-l';
    const fullTag = mr.opaque === 0 ? 'handwear-l' : 'handwear-r';
    refuseIfAny([
      {
        code: 'ASSEMBLE_ARM_SPLIT_CUTS_ARM',
        object: 'config.seethrough.arm_split',
        detail: `leaves "${emptyTag}" with 0 opaque pixels and "${fullTag}" with ${mr.opaque + ml.opaque}; a split that separates the overlapping handwear into two non-empty arm layers is required`,
      },
    ]);
  }
  const ccR = connectedComponents(mr.mask, 8);
  const ccL = connectedComponents(ml.mask, 8);
  for (const [tag, cc] of [
    ['handwear-r', ccR],
    ['handwear-l', ccL],
  ] as const) {
    const comps = cc.count - 1;
    if (comps > 1) {
      const cutNote = firstCutRun !== null ? ` (cutting pixel run x = ${firstCutRun.rx0}..${firstCutRun.rx1} on run row ${firstCutRun.y} at column ${firstCutRun.col})` : '';
      refuseIfAny([
        {
          code: 'ASSEMBLE_ARM_SPLIT_CUTS_ARM',
          object: 'config.seethrough.arm_split',
          detail: `cuts "${tag}" into ${comps} disconnected components${cutNote}; a split that separates the two arms without cutting one arm into two parts is required`,
        },
      ]);
    }
  }
  const refLayer = handLayers.reduce((best, l) => (l.opaquePx > best.opaquePx ? l : best), handLayers[0]);
  const makeLayer = (name: 'handwear-r' | 'handwear-l', canvas: Raster, m: ReturnType<typeof maskOf>): Layer => ({
    name,
    tag: readLayerTag(name) as LayerTagReading,
    file: refLayer.file,
    pixels: crop(canvas, m.x0, m.y0, m.x1 - m.x0 + 1, m.y1 - m.y0 + 1),
    left: m.x0,
    top: m.y0,
    right: m.x1 + 1,
    bottom: m.y1 + 1,
    depth: refLayer.depth,
    drawOrder: 0,
    opaquePx: m.opaque,
  });
  const byTag = {
    'handwear-r': makeLayer('handwear-r', rightCanvas, mr),
    'handwear-l': makeLayer('handwear-l', leftCanvas, ml),
  };
  const insertAt = set.layers.findIndex((l) => l === refLayer);
  const nextLayers: Layer[] = [];
  set.layers.forEach((l, i) => {
    if (i === insertAt) nextLayers.push(byTag[armSplit.order[0]], byTag[armSplit.order[1]]);
    if (l.name !== 'handwear-r' && l.name !== 'handwear-l') nextLayers.push({ ...l });
  });
  nextLayers.forEach((l, i) => {
    l.drawOrder = i;
  });
  return { ...set, layers: nextLayers };
}

/**
 * Apply `seethrough.arm_split`'s draw order to `assemble.plan` (issue #439):
 * a lone `full:handwear-*` row is expanded into `[handwear_r, handwear_l]` in
 * `armSplit.order`, and two `full:handwear-*` rows are ordered as `armSplit.order`
 * declares.
 */
function armSplitPlan(plan: readonly PlanEntry[], armSplit: ArmSplit | undefined): PlanEntry[] {
  if (armSplit === undefined) return [...plan];
  const fullHwIndices = plan.map((e, i) => (e[1] === 'full' && (e[2] === 'handwear-r' || e[2] === 'handwear-l') ? i : -1)).filter((i) => i >= 0);
  if (fullHwIndices.length === 1) {
    const idx = fullHwIndices[0];
    const [t0, t1] = armSplit.order;
    return [...plan.slice(0, idx), [aliasOf(t0), 'full', t0], [aliasOf(t1), 'full', t1], ...plan.slice(idx + 1)];
  }
  if (fullHwIndices.length === 2) {
    const [i0, i1] = fullHwIndices;
    const e0 = plan[i0];
    const e1 = plan[i1];
    if (e0[2] !== e1[2] && e0[2] !== armSplit.order[0]) {
      const out = [...plan];
      out[i0] = e1;
      out[i1] = e0;
      return out;
    }
  }
  return [...plan];
}

/**
 * Issue #490: the minimum Euclidean RGB distance between the sleeve above the
 * wrist and the non-skin overgarment drape extending more than one forearm
 * length below the wrist for `splitMergedArmRuns` to split the merged
 * `handwear-r` / `handwear-l` layer into `drape-<s>`, `handwear-<s>` and
 * `hand-<s>` instead of refusing with `SEETHROUGH_ARM_RUN_MERGED`.
 *
 * Measured across the 9-standee corpus (issue #490, `forearm = 211.3` run px):
 * the 6 clean standees hold `spanBelowWrist <= 94.9` px (`<= 0.45x` forearm) and
 * the 3 merged standees hold `264.9..425.9` px (`1.25x..2.02x` forearm), placing
 * the `1.0x` forearm threshold inside the `0.45x..1.25x` gap; on the 3 merged
 * standees (`780..4,787` skin hand px vs the `GHOST_MIN_AREA = 40` px floor),
 * the two with distinct sleeve and drape colours measure Euclidean RGB distance
 * `103.6 / 106.9` (`standee-1`) and `215.7 / 236.0` (`standee-2`), while the
 * one whose outer robe shares the sleeve's colour measures `20.8 / 28.2`
 * (`standee-5`), placing `80` between `28.2` and `103.6`.
 */
export const ARM_DRAPE_COLOR_DISTANCE = 80;

function medianChannelRgb(pixels: ReadonlyArray<readonly [number, number, number]>): [number, number, number] | null {
  if (pixels.length === 0) return null;
  const rs = pixels.map((p) => p[0]).sort((a, b) => a - b);
  const gs = pixels.map((p) => p[1]).sort((a, b) => a - b);
  const bs = pixels.map((p) => p[2]).sort((a, b) => a - b);
  const mid = Math.floor(pixels.length / 2);
  return [rs[mid], gs[mid], bs[mid]];
}

function rgbDist(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function faceMedianRgb(set: LayerSet, resolution: number): [number, number, number] {
  const face = set.layers.find((l) => l.name === 'face');
  if (face === undefined) return [250, 225, 210];
  const { canvas } = cleanGhosts(placeLayer(face, resolution));
  const px: Array<[number, number, number]> = [];
  for (let i = 0; i < resolution * resolution; i++) {
    const a = canvas.data[i * 4 + 3];
    if (a < CORE_ALPHA) continue;
    const r = canvas.data[i * 4];
    const g = canvas.data[i * 4 + 1];
    const b = canvas.data[i * 4 + 2];
    if (Math.min(r, g, b) > NEAR_WHITE_MIN) continue;
    px.push([r, g, b]);
  }
  return medianChannelRgb(px) ?? [250, 225, 210];
}

/**
 * Issue #490: inspect `handwear-r` and `handwear-l` in the full run against the
 * pose keypoints (`generation.control.skeleton`). When an arm layer holds a
 * skin-coloured hand cluster at `<s>_wrist` (`>= GHOST_MIN_AREA` = `40` opaque
 * run px) and its non-skin pixels reach more than `1.0x` the forearm length
 * (`|wrist - elbow|`) below `<s>_wrist`, See-through merged the sleeve, the
 * hand and the overgarment drape into one arm layer.
 *
 * - When the Euclidean RGB distance between the sleeve above the wrist and the
 *   drape below the wrist is at least {@link ARM_DRAPE_COLOR_DISTANCE} (`80`),
 *   splits `handwear-<s>` into three layers in draw order (back to front):
 *   `drape-<s>` (overgarment below the cut), `handwear-<s>` (the sleeve above
 *   the cut) and `hand-<s>` (the skin hand cluster at the wrist).
 * - When that distance is below {@link ARM_DRAPE_COLOR_DISTANCE}, refuses with
 *   `SEETHROUGH_ARM_RUN_MERGED` naming the layer, the span below the wrist vs
 *   the forearm length, the sleeve and drape RGBs and their Euclidean distance.
 */
export function splitMergedArmRunsWithNotes(
  set: LayerSet,
  resolution: number,
  frame: Pick<Frame, 'fullPad' | 'fullPadTop' | 'fullK'>,
  sourceW: number,
  sourceH: number,
  keySkeleton: ControlSkeleton,
): { set: LayerSet; notes: string[] } {
  const [latentW, latentH] = keySkeleton.latent;
  const sx = sourceW / latentW;
  const sy = sourceH / latentH;
  const toRun = (pt: readonly [number, number]): { x: number; y: number } => ({
    x: (pt[0] * sx + frame.fullPad) / frame.fullK,
    y: (pt[1] * sy + frame.fullPadTop) / frame.fullK,
  });
  const fRGB = faceMedianRgb(set, resolution);
  const problems: Problem[] = [];
  const notes: string[] = [];
  const replacements = new Map<'handwear-r' | 'handwear-l', Layer[]>();

  for (const s of ['r', 'l'] as const) {
    const tag = `handwear-${s}` as const;
    const hwLayer = set.layers.find((l) => l.name === tag);
    if (hwLayer === undefined) continue;
    const { canvas: cleaned } = cleanGhosts(placeLayer(hwLayer, resolution));
    const sh = toRun(keySkeleton.points[`${s}_shoulder`]);
    const el = toRun(keySkeleton.points[`${s}_elbow`]);
    const wr = toRun(keySkeleton.points[`${s}_wrist`]);
    const fdx = wr.x - el.x;
    const fdy = wr.y - el.y;
    const forearm = Math.sqrt(fdx * fdx + fdy * fdy);
    if (!(forearm > 0)) continue;

    // 1. Skin-coloured hand cluster in the wrist window.
    const skinRaw = newMask(resolution, resolution);
    const winX0 = Math.max(0, Math.floor(wr.x - 0.45 * forearm));
    const winX1 = Math.min(resolution - 1, Math.ceil(wr.x + 0.45 * forearm));
    const winY0 = Math.max(0, Math.floor(wr.y - 0.65 * forearm));
    const winY1 = Math.min(resolution - 1, Math.ceil(wr.y + 0.35 * forearm));
    for (let y = winY0; y <= winY1; y++) {
      for (let x = winX0; x <= winX1; x++) {
        const idx = (y * resolution + x) * 4;
        const a = cleaned.data[idx + 3];
        if (a <= OPAQUE_ALPHA_ABOVE) continue;
        const r = cleaned.data[idx];
        const g = cleaned.data[idx + 1];
        const b = cleaned.data[idx + 2];
        if (Math.min(r, g, b) > NEAR_WHITE_MIN) continue;
        const fDist = rgbDist([r, g, b], fRGB);
        const warmOrder = r >= g && g >= b && r - b >= 12 && g - b <= 45;
        if (warmOrder && (fDist < 65 || (r > 145 && g > 95 && b > 55 && r - b <= 95))) {
          skinRaw.data[y * resolution + x] = 1;
        }
      }
    }
    const skinClosed = fillHoles(morphClose(skinRaw, CORE_KERNEL));
    const cc = connectedComponents(skinClosed, 8);
    const keepHand = new Uint8Array(cc.count);
    for (let c = 1; c < cc.count; c++) {
      const st = cc.stats[c];
      if (st.area < GHOST_MIN_AREA) continue;
      const dx = wr.x < st.left ? st.left - wr.x : wr.x > st.left + st.width - 1 ? wr.x - (st.left + st.width - 1) : 0;
      const dy = wr.y < st.top ? st.top - wr.y : wr.y > st.top + st.height - 1 ? wr.y - (st.top + st.height - 1) : 0;
      if (Math.sqrt(dx * dx + dy * dy) <= 0.35 * forearm) keepHand[c] = 1;
    }
    const handMask = newMask(resolution, resolution);
    let handPx = 0;
    let handMinY = resolution;
    let handMaxY = -1;
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const i = y * resolution + x;
        if (keepHand[cc.labels[i]] === 1 && cleaned.data[i * 4 + 3] > OPAQUE_ALPHA_ABOVE) {
          handMask.data[i] = 1;
          handPx++;
          if (y < handMinY) handMinY = y;
          if (y > handMaxY) handMaxY = y;
        }
      }
    }
    if (handPx < GHOST_MIN_AREA) continue;

    // 2. Non-skin span below the wrist vs forearm length.
    let nonSkinMaxY = -1;
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const i = y * resolution + x;
        if (cleaned.data[i * 4 + 3] > OPAQUE_ALPHA_ABOVE && handMask.data[i] === 0) {
          if (y > nonSkinMaxY) nonSkinMaxY = y;
        }
      }
    }
    const spanBelowWrist = nonSkinMaxY - wr.y;
    if (!(spanBelowWrist > forearm)) continue;

    // 3. Sleeve vs drape colour distance.
    const midArmY = Math.round((sh.y + wr.y) / 2);
    const band1Px: Array<[number, number, number]> = [];
    const band2Px: Array<[number, number, number]> = [];
    const drapePx: Array<[number, number, number]> = [];
    const wrFloor = Math.floor(wr.y);
    const drapeStart = Math.floor(wr.y + 0.15 * forearm);
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const i = y * resolution + x;
        if (handMask.data[i] === 1) continue;
        const a = cleaned.data[i * 4 + 3];
        if (a < CORE_ALPHA) continue;
        const r = cleaned.data[i * 4];
        const g = cleaned.data[i * 4 + 1];
        const b = cleaned.data[i * 4 + 2];
        if (Math.min(r, g, b) > NEAR_WHITE_MIN) continue;
        if (y <= wrFloor) {
          if (y < midArmY) band1Px.push([r, g, b]);
          else band2Px.push([r, g, b]);
        } else if (y >= drapeStart) {
          drapePx.push([r, g, b]);
        }
      }
    }
    const c1 = medianChannelRgb(band1Px);
    const c2 = medianChannelRgb(band2Px);
    const drapeRGB = medianChannelRgb(drapePx);
    const d1 = c1 !== null && drapeRGB !== null ? rgbDist(c1, drapeRGB) : 0;
    const d2 = c2 !== null && drapeRGB !== null ? rgbDist(c2, drapeRGB) : 0;
    const bestDist = Math.max(d1, d2);
    const sleeveRGB = (d1 >= d2 ? c1 ?? c2 : c2 ?? c1) ?? [0, 0, 0];
    const drapeShown = drapeRGB ?? [0, 0, 0];

    if (drapeRGB === null || (c1 === null && c2 === null) || bestDist < ARM_DRAPE_COLOR_DISTANCE) {
      problems.push({
        code: 'SEETHROUGH_ARM_RUN_MERGED',
        object: `the full run (${set.source}) layer "${tag}"`,
        detail:
          `merges the sleeve, the hand (${handPx} skin px around ${s}_wrist at (${Math.round(wr.x)}, ${Math.round(wr.y)}), rows y=${handMinY}..${handMaxY}) and the overgarment into one arm layer: non-skin pixels reach y=${nonSkinMaxY}, ${spanBelowWrist.toFixed(1)} px (${(spanBelowWrist / forearm).toFixed(2)}x the forearm length ${forearm.toFixed(1)} px from ${s}_elbow to ${s}_wrist) below ${s}_wrist, and the sleeve above ${s}_wrist (rgb(${sleeveRGB.join(', ')})) and the drape below ${s}_wrist (rgb(${drapeShown.join(', ')})) have Euclidean RGB distance ${bestDist.toFixed(1)} (< ${ARM_DRAPE_COLOR_DISTANCE}); ` +
          `non-skin pixels reaching at most 1.0x the forearm length (${forearm.toFixed(1)} px) below ${s}_wrist, or a sleeve-to-drape Euclidean RGB distance of at least ${ARM_DRAPE_COLOR_DISTANCE} so the stage can split "${tag}" into "drape-${s}", "${tag}" and "hand-${s}", is required — re-seed config.seethrough.seed, split the merged layer into author: layers in the full run, or cut the overgarment from the sleeve in config.assemble.cuts`,
      });
      continue;
    }

    // 4. Split into drape-<s>, handwear-<s> and hand-<s> (back to front).
    const cutY = Math.max(Math.round(wr.y), handMaxY);
    const elY = Math.round(el.y);
    const drapeCanvas = newRaster(resolution, resolution);
    const sleeveCanvas = newRaster(resolution, resolution);
    const handCanvas = newRaster(resolution, resolution);
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const i = y * resolution + x;
        const p = i * 4;
        if (cleaned.data[p + 3] === 0) continue;
        if (handMask.data[i] === 1) {
          handCanvas.data.set(cleaned.data.subarray(p, p + 4), p);
        } else if (y > cutY) {
          drapeCanvas.data.set(cleaned.data.subarray(p, p + 4), p);
        } else if (d2 < ARM_DRAPE_COLOR_DISTANCE && y > elY) {
          const px: [number, number, number] = [cleaned.data[p], cleaned.data[p + 1], cleaned.data[p + 2]];
          const dst = rgbDist(px, drapeRGB) < rgbDist(px, sleeveRGB) ? drapeCanvas.data : sleeveCanvas.data;
          dst.set(cleaned.data.subarray(p, p + 4), p);
        } else {
          sleeveCanvas.data.set(cleaned.data.subarray(p, p + 4), p);
        }
      }
    }
    const buildSplitLayer = (name: string, canvas: Raster): Layer | null => {
      let opaque = 0;
      let x0 = resolution;
      let y0 = resolution;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          const a = canvas.data[(y * resolution + x) * 4 + 3];
          if (a > OPAQUE_ALPHA_ABOVE) opaque++;
          if (a > 0) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (opaque === 0 || x1 < x0) return null;
      return {
        name,
        tag: readLayerTag(name) as LayerTagReading,
        file: hwLayer.file,
        pixels: crop(canvas, x0, y0, x1 - x0 + 1, y1 - y0 + 1),
        left: x0,
        top: y0,
        right: x1 + 1,
        bottom: y1 + 1,
        depth: hwLayer.depth,
        drawOrder: 0,
        opaquePx: opaque,
      };
    };
    const drapeLayer = buildSplitLayer(`drape-${s}`, drapeCanvas);
    const sleeveLayer = buildSplitLayer(tag, sleeveCanvas);
    const handLayer = buildSplitLayer(`hand-${s}`, handCanvas);
    if (drapeLayer !== null && sleeveLayer !== null && handLayer !== null) {
      replacements.set(tag, [drapeLayer, sleeveLayer, handLayer]);
      notes.push(
        `${tag}: merged arm layer (${handPx} skin hand px at ${s}_wrist y=${handMinY}..${handMaxY}, non-skin reaching y=${nonSkinMaxY}, ${(spanBelowWrist / forearm).toFixed(2)}x forearm ${forearm.toFixed(1)} px; sleeve rgb(${sleeveRGB.join(', ')}) vs drape rgb(${drapeRGB.join(', ')}) Euclidean distance ${bestDist.toFixed(1)} >= ${ARM_DRAPE_COLOR_DISTANCE}) -> split into drape-${s} (${drapeLayer.opaquePx} px), ${tag} (${sleeveLayer.opaquePx} px) and hand-${s} (${handLayer.opaquePx} px)`,
      );
    }
  }

  refuseIfAny(problems);
  if (replacements.size === 0) return { set, notes };

  const nextLayers: Layer[] = [];
  for (const l of set.layers) {
    const rep = (l.name === 'handwear-r' || l.name === 'handwear-l') ? replacements.get(l.name) : undefined;
    if (rep !== undefined) nextLayers.push(...rep);
    else nextLayers.push({ ...l });
  }
  nextLayers.forEach((l, i) => {
    l.drawOrder = i;
  });
  return { set: { ...set, layers: nextLayers }, notes };
}

export function splitMergedArmRuns(
  set: LayerSet,
  resolution: number,
  frame: Pick<Frame, 'fullPad' | 'fullPadTop' | 'fullK'>,
  sourceW: number,
  sourceH: number,
  keySkeleton: ControlSkeleton,
): LayerSet {
  return splitMergedArmRunsWithNotes(set, resolution, frame, sourceW, sourceH, keySkeleton).set;
}

/**
 * Issue #490: when `splitMergedArmRuns` split `full:handwear-<s>` into
 * `drape-<s>`, `handwear-<s>` and `hand-<s>`, expand a lone `full:handwear-<s>`
 * row in `assemble.plan` (when `drape-<s>` and `hand-<s>` are not already in
 * `plan`) into `[["drape_<s>", "full", "drape-<s>"], [name, "full", "handwear-<s>"], ["hand_<s>", "full", "hand-<s>"]]`.
 */
export function mergedArmSplitPlan(plan: readonly PlanEntry[], full: LayerSet): PlanEntry[] {
  const fullTags = new Set(full.layers.map((l) => l.name));
  const plannedFullTags = new Set(plan.filter(([, run]) => run === 'full').map(([, , tag]) => tag));
  const out: PlanEntry[] = [];
  for (const entry of plan) {
    const [name, run, tag] = entry;
    if (run === 'full' && (tag === 'handwear-r' || tag === 'handwear-l')) {
      const s = tag === 'handwear-r' ? 'r' : 'l';
      const drapeTag = `drape-${s}`;
      const handTag = `hand-${s}`;
      if (fullTags.has(drapeTag) && fullTags.has(handTag) && !plannedFullTags.has(drapeTag) && !plannedFullTags.has(handTag)) {
        out.push([aliasOf(drapeTag), 'full', drapeTag], [name, 'full', tag], [aliasOf(handTag), 'full', handTag]);
        continue;
      }
    }
    out.push(entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// step 2 — resample into rig space
// ---------------------------------------------------------------------------

/** The run-to-rig map: `rig = k * run + (tx, ty)`, in float32 as the reference's `np.float32` matrix holds it. */
export function runMap(frame: Frame, run: Run): { k: number; sx: number; tx: number; ty: number } {
  if (run === 'full') {
    const k = frame.fullK * frame.S;
    // A portrait painting's top pad is 0, and its ty is the reference's literal 0 rather than f32(-0).
    return { k, sx: f32(k), tx: f32(-frame.fullPad * frame.S), ty: frame.fullPadTop === 0 ? 0 : f32(-frame.fullPadTop * frame.S) };
  }
  const k = frame.headK * frame.S;
  return { k, sx: f32(k), tx: f32(frame.headBox[0] * frame.S), ty: f32(frame.headBox[1] * frame.S) };
}

/**
 * Step 2. Warp a run-space layer into the `W x H` rig, premultiplied.
 *
 * ⚖️ Invariant: the result is `cv2.warpAffine` of the premultiplied layer
 * through `runMap` — bicubic when the map enlarges (`k >= 1`), and the
 * reference's `INTER_AREA` otherwise, which `warpAffine` answers with its
 * bilinear filter (`src/raster/warp.ts` measured that) — clipped to 0..255,
 * un-premultiplied, and truncated to 8 bits. Premultiplying and
 * un-premultiplying are done in float32, as numpy does them on a float32
 * array. A layer with no non-zero alpha maps to a fully transparent rig layer
 * without being warped: every tap would read 0.
 * (`assemble_parts.py` `to_rig`.)
 */
export function layerToRig(canvas: Raster, frame: Frame, run: Run): Raster {
  const { W, H } = frame;
  const n = canvas.width * canvas.height;
  let any = false;
  for (let i = 0; i < n && !any; i++) if (canvas.data[i * 4 + 3] !== 0) any = true;
  if (!any) return newRaster(W, H);
  const pre = newFloatImage(canvas.width, canvas.height, 4);
  for (let i = 0; i < n; i++) {
    const a = canvas.data[i * 4 + 3];
    const af = f32(a / 255);
    for (let c = 0; c < 3; c++) pre.data[i * 4 + c] = f32(canvas.data[i * 4 + c] * af);
    pre.data[i * 4 + 3] = a;
  }
  const m = runMap(frame, run);
  const wr = warpAffine(pre, { sx: m.sx, sy: m.sx, tx: m.tx, ty: m.ty }, W, H, m.k < 1 ? 'bilinear' : 'bicubic');
  const out = newRaster(W, H);
  const eps = f32(1e-3);
  const clip = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let i = 0; i < W * H; i++) {
    const a = f32(clip(wr.data[i * 4 + 3]));
    for (let c = 0; c < 3; c++) {
      const v = f32(clip(wr.data[i * 4 + c]));
      out.data[i * 4 + c] = a > 0 ? Math.trunc(clip(f32(f32(v * 255) / Math.max(a, eps)))) : 0;
    }
    out.data[i * 4 + 3] = Math.trunc(a);
  }
  return out;
}

/**
 * Issue #492: warp a full-run layer (`resolution x resolution`) onto the head
 * run's `resolution x resolution` canvas using the same premultiplied float32
 * `warpAffine` round-trip as {@link layerToRig} (`head = (fullK / headK) * full
 * - (headBox + fullPad) / headK`).
 */
export function fullLayerToHead(
  canvas: Raster,
  frame: Pick<Frame, 'fullK' | 'fullPad' | 'fullPadTop' | 'headBox' | 'headK'>,
  resolution: number,
): Raster {
  const n = canvas.width * canvas.height;
  let any = false;
  for (let i = 0; i < n && !any; i++) if (canvas.data[i * 4 + 3] !== 0) any = true;
  if (!any) return newRaster(resolution, resolution);
  const pre = newFloatImage(canvas.width, canvas.height, 4);
  for (let i = 0; i < n; i++) {
    const a = canvas.data[i * 4 + 3];
    const af = f32(a / 255);
    for (let c = 0; c < 3; c++) pre.data[i * 4 + c] = f32(canvas.data[i * 4 + c] * af);
    pre.data[i * 4 + 3] = a;
  }
  const k = frame.fullK / frame.headK;
  const sx = f32(k);
  const tx = f32(-(frame.headBox[0] + frame.fullPad) / frame.headK);
  const ty = frame.fullPadTop === 0 && frame.headBox[1] === 0 ? 0 : f32(-(frame.headBox[1] + frame.fullPadTop) / frame.headK);
  const wr = warpAffine(pre, { sx, sy: sx, tx, ty }, resolution, resolution, k < 1 ? 'bilinear' : 'bicubic');
  const out = newRaster(resolution, resolution);
  const eps = f32(1e-3);
  const clip = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let i = 0; i < resolution * resolution; i++) {
    const a = f32(clip(wr.data[i * 4 + 3]));
    for (let c = 0; c < 3; c++) {
      const v = f32(clip(wr.data[i * 4 + c]));
      out.data[i * 4 + c] = a > 0 ? Math.trunc(clip(f32(f32(v * 255) / Math.max(a, eps)))) : 0;
    }
    out.data[i * 4 + 3] = Math.trunc(a);
  }
  return out;
}

/**
 * Issue #492: compare the head run's `face` layer against the full run's
 * hole-filled `face` silhouette on the head canvas (`resolution x resolution`),
 * optionally compositing `full:face` under `head:face` when
 * `config.assemble.head_face_underfill: true` is declared and the head run
 * provides a `face` outline (`opaqueRunPx >= minPx`), and refusing with
 * `SEETHROUGH_HEAD_RUN_HOLLOW` when the head run's `face` covers less than
 * {@link HEAD_FACE_COVERAGE_FLOOR} (`0.75`) of the full run's face silhouette.
 */
function prepareHeadFace(
  full: LayerSet,
  head: LayerSet,
  frame: Pick<Frame, 'fullK' | 'fullPad' | 'fullPadTop' | 'headBox' | 'headK'>,
  resolution: number,
  underfill: boolean,
  minPx = PROPOSE_MIN_PX,
): { head: LayerSet; underfillPx: number; underfillNote: string | null } {
  if (full.source !== '' && full.source === head.source) return { head, underfillPx: 0, underfillNote: null };
  const fullFaceLayer = full.layers.find((l) => l.name === 'face');
  if (fullFaceLayer === undefined) return { head, underfillPx: 0, underfillNote: null };
  const cleanedFull = cleanGhosts(placeLayer(fullFaceLayer, resolution));
  let fullOpaqueRunPx = 0;
  for (let i = 3; i < cleanedFull.canvas.data.length; i += 4) {
    if (cleanedFull.canvas.data[i] > OPAQUE_ALPHA_ABOVE) fullOpaqueRunPx++;
  }
  if (fullOpaqueRunPx < minPx) return { head, underfillPx: 0, underfillNote: null };

  const warpedFull = fullLayerToHead(cleanedFull.canvas, frame, resolution);
  const rawFullMask = newMask(resolution, resolution);
  for (let p = 0; p < resolution * resolution; p++) {
    if (warpedFull.data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE) rawFullMask.data[p] = 1;
  }
  const fullSil = fillHoles(rawFullMask);
  let fullPx = 0;
  let minY = resolution;
  let maxY = -1;
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      if (fullSil.data[y * resolution + x] === 1) {
        fullPx++;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (fullPx < minPx) return { head, underfillPx: 0, underfillNote: null };

  const headFaceLayer = head.layers.find((l) => l.name === 'face');
  const cleanedHead =
    headFaceLayer === undefined
      ? { canvas: newRaster(resolution, resolution), ghostPx: 0 }
      : cleanGhosts(placeLayer(headFaceLayer, resolution));
  let headRawOpaquePx = 0;
  for (let i = 3; i < cleanedHead.canvas.data.length; i += 4) {
    if (cleanedHead.canvas.data[i] > OPAQUE_ALPHA_ABOVE) headRawOpaquePx++;
  }

  const measureCoverage = (canvas: Raster): { headOv: number; cov: number; upCov: number; loCov: number } => {
    const midY = (minY + maxY) / 2;
    let fullUpPx = 0;
    let fullLoPx = 0;
    let headOv = 0;
    let headUpOv = 0;
    let headLoOv = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = 0; x < resolution; x++) {
        const p = y * resolution + x;
        if (fullSil.data[p] !== 1) continue;
        if (y <= midY) fullUpPx++;
        else fullLoPx++;
        if (canvas.data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE) {
          headOv++;
          if (y <= midY) headUpOv++;
          else headLoOv++;
        }
      }
    }
    return {
      headOv,
      cov: headOv / fullPx,
      upCov: fullUpPx > 0 ? headUpOv / fullUpPx : 0,
      loCov: fullLoPx > 0 ? headLoOv / fullLoPx : 0,
    };
  };

  const rawStats = measureCoverage(cleanedHead.canvas);
  let activeHead = head;
  let activeCanvas = cleanedHead.canvas;
  let underfillPx = 0;
  let underfillNote: string | null = null;

  if (underfill && headFaceLayer !== undefined && headRawOpaquePx >= minPx) {
    const comp = newRaster(resolution, resolution);
    let compOpaquePx = 0;
    let x0 = resolution;
    let y0 = resolution;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const p = y * resolution + x;
        const i = p * 4;
        const ta = cleanedHead.canvas.data[i + 3];
        const ua = warpedFull.data[i + 3];
        const a = Math.max(ta, ua);
        if (a === 0) continue;
        const tf = ta / 255;
        for (let c = 0; c < 3; c++) {
          comp.data[i + c] = Math.trunc(cleanedHead.canvas.data[i + c] * tf + warpedFull.data[i + c] * (1 - tf));
        }
        comp.data[i + 3] = a;
        if (ta <= OPAQUE_ALPHA_ABOVE && a > OPAQUE_ALPHA_ABOVE) underfillPx++;
        if (a > OPAQUE_ALPHA_ABOVE) compOpaquePx++;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    if (x1 >= x0 && y1 >= y0) {
      activeCanvas = comp;
      const postStats = measureCoverage(comp);
      const replacedLayer: Layer = {
        ...headFaceLayer,
        pixels: crop(comp, x0, y0, x1 - x0 + 1, y1 - y0 + 1),
        left: x0,
        top: y0,
        right: x1 + 1,
        bottom: y1 + 1,
        opaquePx: compOpaquePx,
      };
      activeHead = {
        ...head,
        layers: head.layers.map((l) => (l.name === 'face' ? replacedLayer : l)),
      };
      if (underfillPx > 0) {
        underfillNote = `face: head_face_underfill composited full:face under head:face on the head canvas, filling ${underfillPx} transparent px (${rawStats.headOv} / ${fullPx} px, ${(rawStats.cov * 100).toFixed(1)}% -> ${postStats.headOv} / ${fullPx} px, ${(postStats.cov * 100).toFixed(1)}%)`;
      }
    }
  }

  const finalStats = activeCanvas === cleanedHead.canvas ? rawStats : measureCoverage(activeCanvas);
  if (finalStats.cov < HEAD_FACE_COVERAGE_FLOOR) {
    const covStr = `${finalStats.headOv} / ${fullPx} px (${(finalStats.cov * 100).toFixed(1)}%, upper half ${(finalStats.upCov * 100).toFixed(1)}%, lower half ${(finalStats.loCov * 100).toFixed(1)}%)`;
    const floorStr = `${(HEAD_FACE_COVERAGE_FLOOR * 100).toFixed(1)}% (HEAD_FACE_COVERAGE_FLOOR = ${HEAD_FACE_COVERAGE_FLOOR})`;
    const detail =
      headFaceLayer === undefined || headRawOpaquePx < minPx
        ? `${headFaceLayer === undefined ? 'holds no layer "face"' : `holds ${headRawOpaquePx} opaque px (alpha > ${OPAQUE_ALPHA_ABOVE}, below PROPOSE_MIN_PX = ${minPx})`}, covering ${covStr} of the full run's "face" silhouette on the head canvas (${fullOpaqueRunPx} full-run px); at least ${floorStr} is required — the head run omitted the face layer (so config.assemble.head_face_underfill cannot supply a jawline); re-run See-through with a different config.seethrough.seed`
        : `covers ${covStr} of the full run's "face" silhouette on the head canvas (${headRawOpaquePx} head-run px vs ${fullOpaqueRunPx} full-run px) — See-through left bare skin inside the face silhouette transparent; at least ${floorStr} is required — re-run See-through with a different config.seethrough.seed, or set "head_face_underfill": true in config.assemble to composite full:face under head:face on the head canvas`;
    refuseIfAny([
      {
        code: 'SEETHROUGH_HEAD_RUN_HOLLOW',
        object: `the head run (${head.source}) layer "face"`,
        detail,
      },
    ]);
  }

  return { head: activeHead, underfillPx, underfillNote };
}

/**
 * The painting in rig space: `PIL.Image.resize(..., LANCZOS)` of its RGB, as
 * an opaque raster. (`src/raster/resize.ts` `lanczos3` is PIL's, bit-exact;
 * with alpha 255 its premultiply round trip is the identity.)
 */
export function sourceInRig(source: Raster, W: number, H: number): Raster {
  const rgb: Raster = { width: source.width, height: source.height, data: new Uint8ClampedArray(source.data) };
  for (let i = 3; i < rgb.data.length; i += 4) rgb.data[i] = 255;
  return resize(rgb, W, H, 'lanczos3');
}

// ---------------------------------------------------------------------------
// step 3 — source projection
// ---------------------------------------------------------------------------

export interface ProjectionStats {
  core: number;
  taken: number;
  refused: number;
  /**
   * Where no layer of the run in front of this one (`frontOf`) owns the
   * pixel (`pixelOwners`): the owner is this layer, one behind it, or none. A
   * pixel of this layer with alpha above 8 is VISIBLE exactly where this is
   * set, and OCCLUDED everywhere else.
   */
  clear: Mask;
  /** The pixels counted in `taken`: the accepted set, cut to the core. */
  takenMask: Mask;
  /** The pixels counted in `core`, and in `refused`; null when the layer has no top-most pixel (both counts 0). A cut splits the counts by these. */
  coreMask: Mask | null;
  refusedMask: Mask | null;
}

function maxDiff(a: Uint8ClampedArray, i: number, b: Uint8ClampedArray, j: number): number {
  return Math.max(Math.abs(a[i] - b[j]), Math.abs(a[i + 1] - b[j + 1]), Math.abs(a[i + 2] - b[j + 2]));
}

/**
 * The plan's rank of each layer of one run (issue #255): the index of the
 * last plan entry that takes the layer from this run, or -1 for a layer no
 * plan entry takes (an `extend_below_crop` layer included: its pixels are
 * copied into another part, and it keeps See-through's depth).
 */
export function planRanks(tags: readonly string[], run: Run, plan: readonly PlanEntry[]): number[] {
  return tags.map((tag) => {
    let r = -1;
    plan.forEach(([, ru, tg], i) => {
      if (ru === run && tg === tag) r = i;
    });
    return r;
  });
}

/**
 * Whether layer `o` of a run is in front of layer `i` of the same run: by the
 * plan when both are planned (`rank` >= 0 for both; the later plan entry is
 * drawn in front), by See-through's depth (the run's own order) otherwise.
 * `rank` null is depth throughout, the reference's rule.
 */
export function frontOf(o: number, i: number, rank: readonly number[] | null): boolean {
  if (rank !== null && rank[o] >= 0 && rank[i] >= 0) return rank[o] > rank[i];
  return o > i;
}

/**
 * Who owns each rig pixel of one run, for projection (issue #255).
 *
 * ⚖️ Invariant: per pixel, the DEPTH owner is the run's top-most layer with
 * alpha >= `CORE_ALPHA` there (-1: none), the reference's rule. When `rank`
 * is given and the depth owner is a planned layer, the owner is instead the
 * planned layer at alpha >= `CORE_ALPHA` there with the greatest rank: where
 * two planned parts both hold a pixel, the one the plan draws in front takes
 * it, whatever See-through's depth says. A depth owner no plan entry takes is
 * kept — the painting there shows a layer the rig does not draw, and no
 * planned part may take it. Where plan and depth agree the owner is the
 * reference's, pixel for pixel.
 */
export function pixelOwners(rigLayers: readonly Raster[], rank: readonly number[] | null): Int32Array {
  const n = rigLayers.length === 0 ? 0 : rigLayers[0].width * rigLayers[0].height;
  const owner = new Int32Array(n).fill(-1);
  for (let p = 0; p < n; p++) {
    let depth = -1;
    let best = -1;
    for (let i = 0; i < rigLayers.length; i++) {
      if (rigLayers[i].data[p * 4 + 3] < CORE_ALPHA) continue;
      depth = i;
      if (rank !== null && rank[i] >= 0 && (best < 0 || rank[i] > rank[best])) best = i;
    }
    owner[p] = rank !== null && depth >= 0 && rank[depth] >= 0 ? best : depth;
  }
  return owner;
}

/**
 * Step 3, over one run's layers in draw order. Modifies each rig layer's
 * colour in place and returns its counts.
 *
 * ⚖️ Invariant: a layer's CORE is where it is the pixel's owner
 * (`pixelOwners`: the top-most `alpha >= 250` layer of its own run, or, with
 * `rank`, the planned one the plan draws in front — issue #255, not in the
 * reference, which is the same wherever plan and depth agree), eroded by a
 * 5x5 square. Inside the core, the pixels
 * that agree with the painting (max channel difference <= `DRIFT_LIMIT`),
 * closed by 5x5 and cut back to the core — and, for the head run, kept
 * `HEAD_WINDOW_INSET` pixels inside the head crop — are the ACCEPTED set. The
 * colour becomes `w * painting + (1 - w) * layer`, truncated, with `w` the
 * accepted set blurred by a Gaussian of sigma 1 and zeroed outside the core;
 * outside the core nothing changes, alpha never changes, and occluded pixels
 * keep See-through's synthesis. `core`, `taken` (accepted) and `refused` (core
 * pixels over the drift limit, before closing) are counted.
 * (`assemble_parts.py` `main`, the per-run loop.)
 *
 * With `rule: 'visible'` (NOT in the reference) the core is the top-most
 * `alpha >= 250` set less every pixel within the 5x5 square of a pixel where a
 * layer in front of it (`frontOf`) is the owner — the erosion kept only along a rim with
 * a neighbour in front, where the painting's pixel may be that neighbour's
 * edge. Every other step is the same. Fringe pixels (alpha below 250) are not
 * projected under either rule: the painting there is this layer blended with
 * what is behind it.
 *
 * Both rules return `clear` (no layer in front of this one, by `frontOf`, is the owner) and `takenMask`, the
 * masks the part counts in `parts.json` are derived from; `takenMask` is a
 * subset of the top-most set, and so of `clear`.
 */
export function projectSource(rigLayers: Raster[], srcr: Raster, frame: Frame, run: Run, rule: ProjectRule = DEFAULT_PROJECT_RULE, rank: readonly number[] | null = null): ProjectionStats[] {
  const { W, H } = frame;
  const owner = pixelOwners(rigLayers, rank);
  const inFront = (o: number, i: number): boolean => frontOf(o, i, rank);
  let win: Mask | null = null;
  if (run === 'head') {
    win = newMask(W, H);
    const [bx0, by0, bx1, by1] = frame.headBox;
    const x0 = Math.max(0, Math.trunc(bx0 * frame.S) + HEAD_WINDOW_INSET);
    const y0 = Math.max(0, Math.trunc(by0 * frame.S) + HEAD_WINDOW_INSET);
    const x1 = Math.min(W, Math.trunc(bx1 * frame.S) - HEAD_WINDOW_INSET);
    const y1 = Math.min(H, Math.trunc(by1 * frame.S) - HEAD_WINDOW_INSET);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) win.data[y * W + x] = 1;
  }
  return rigLayers.map((r, i) => {
    const top = newMask(W, H);
    const clear = newMask(W, H);
    const takenMask = newMask(W, H);
    let anyTop = false;
    for (let p = 0; p < W * H; p++) {
      if (owner[p] === -1 || owner[p] === i || !inFront(owner[p], i)) clear.data[p] = 1;
      if (owner[p] === i && r.data[p * 4 + 3] >= CORE_ALPHA) {
        top.data[p] = 1;
        anyTop = true;
      }
    }
    if (!anyTop) return { core: 0, taken: 0, refused: 0, clear, takenMask, coreMask: null, refusedMask: null };
    let core: Mask;
    if (rule === 'core') core = erode(top, CORE_KERNEL);
    else {
      const front = newMask(W, H);
      for (let p = 0; p < W * H; p++) if (owner[p] >= 0 && owner[p] !== i && inFront(owner[p], i)) front.data[p] = 1;
      const rim = dilate(front, CORE_KERNEL);
      core = newMask(W, H);
      for (let p = 0; p < W * H; p++) if (top.data[p] === 1 && rim.data[p] === 0) core.data[p] = 1;
    }
    const ok = newMask(W, H);
    const refusedMask = newMask(W, H);
    let coreN = 0;
    let refused = 0;
    for (let p = 0; p < W * H; p++) {
      if (core.data[p] === 0) continue;
      coreN++;
      if (maxDiff(r.data, p * 4, srcr.data, p * 4) <= DRIFT_LIMIT) ok.data[p] = 1;
      else {
        refused++;
        refusedMask.data[p] = 1;
      }
    }
    const closed = morphClose(ok, CORE_KERNEL);
    const okf = newFloatImage(W, H, 1);
    let taken = 0;
    for (let p = 0; p < W * H; p++) {
      const v = closed.data[p] === 1 && core.data[p] === 1 && (win === null || win.data[p] === 1) ? 1 : 0;
      okf.data[p] = v;
      takenMask.data[p] = v;
      taken += v;
    }
    const blurred = gaussianBlur(okf, FEATHER_SIGMA);
    for (let p = 0; p < W * H; p++) {
      if (core.data[p] === 0) continue;
      const w = blurred.data[p];
      const rest = f32(1 - w);
      for (let c = 0; c < 3; c++) {
        const v = f32(f32(w * srcr.data[p * 4 + c]) + f32(rest * r.data[p * 4 + c]));
        r.data[p * 4 + c] = Math.trunc(v < 0 ? 0 : v > 255 ? 255 : v);
      }
    }
    return { core: coreN, taken, refused, clear, takenMask, coreMask: core, refusedMask };
  });
}

// ---------------------------------------------------------------------------
// step 4 — merge below the head crop
// ---------------------------------------------------------------------------

/**
 * The pixels of `extra` (a full-run layer in rig space) that continue `part`
 * below the crop line.
 *
 * ⚖️ Invariant: the result is every 8-connected component of `extra`'s
 * `alpha > 8` pixels at or below row `headBottom` that has a pixel in rows
 * `headBottom .. headBottom + 5` within `CROP_SEED_COLUMNS` columns of a column
 * where `part` has alpha above 128 on row `headBottom - 2`. Whole components,
 * so a long lock keeps its own outline to the tip. Empty when `part` does not
 * reach the line or `extra` has nothing below it.
 * (`assemble_parts.py` `below_crop`.)
 */
export function belowCrop(part: Raster, extra: Raster, headBottom: number): Mask {
  const { width: W, height: H } = part;
  const sel = newMask(W, H);
  const below = newMask(W, H);
  let anyBelow = false;
  for (let y = Math.max(0, headBottom); y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (extra.data[(y * W + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE) {
        below.data[y * W + x] = 1;
        anyBelow = true;
      }
    }
  }
  const probe = headBottom - CROP_PROBE_ROWS;
  const near = new Uint8Array(W);
  let anyCol = false;
  for (let x = 0; x < W; x++) {
    if (part.data[(probe * W + x) * 4 + 3] > CROP_PROBE_ALPHA) {
      anyCol = true;
      for (let c = Math.max(0, x - CROP_SEED_COLUMNS); c <= Math.min(W - 1, x + CROP_SEED_COLUMNS); c++) near[c] = 1;
    }
  }
  if (!anyCol || !anyBelow) return sel;
  const cc = connectedComponents(below, 8);
  const chosen = new Uint8Array(cc.count);
  for (let y = Math.max(0, headBottom); y < Math.min(H, headBottom + CROP_SEED_ROWS); y++) {
    for (let x = 0; x < W; x++) {
      const l = cc.labels[y * W + x];
      if (l > 0 && near[x] === 1) chosen[l] = 1;
    }
  }
  for (let p = 0; p < W * H; p++) if (chosen[cc.labels[p]] === 1 && extra.data[p * 4 + 3] > 0) sel.data[p] = 1;
  return sel;
}

/**
 * Close the half-pixel seam round a merged-in piece: the full run's silhouette
 * is a few pixels narrower than the painting, and a renderer's sub-pixel
 * resample shows the layer beneath along that edge.
 *
 * ⚖️ Invariant: the RING is the 3x3 dilation of `sel`'s `alpha >= 250` pixels,
 * restricted to pixels where `part` has alpha below 250, the painting is not
 * near-white (min channel <= 235) and no later plan part covers
 * (`front`, alpha >= 128). Every ring pixel takes the painting's colour at
 * alpha 255, so the flat composite there equals the painting; the count is
 * returned. Nothing changes when `sel` is empty. When `touched` is given,
 * every ring pixel written is set in it.
 * (`assemble_parts.py` `grow_rim`.)
 */
export function growRim(part: Raster, sel: Mask, srcr: Raster, front: Mask | null, touched?: Mask): number {
  const { width: W, height: H } = part;
  const core = newMask(W, H);
  let anySel = false;
  for (let p = 0; p < W * H; p++) {
    if (sel.data[p] === 1) {
      anySel = true;
      if (part.data[p * 4 + 3] >= CORE_ALPHA) core.data[p] = 1;
    }
  }
  if (!anySel) return 0;
  const ring = dilate(core, 3);
  let grown = 0;
  for (let p = 0; p < W * H; p++) {
    if (ring.data[p] === 0 || part.data[p * 4 + 3] >= CORE_ALPHA) continue;
    const s = p * 4;
    if (Math.min(srcr.data[s], srcr.data[s + 1], srcr.data[s + 2]) > NEAR_WHITE_MIN) continue;
    if (front !== null && front.data[p] === 1) continue;
    part.data[s] = srcr.data[s];
    part.data[s + 1] = srcr.data[s + 1];
    part.data[s + 2] = srcr.data[s + 2];
    part.data[s + 3] = 255;
    if (touched !== undefined) touched.data[p] = 1;
    grown++;
  }
  return grown;
}

/**
 * Step 4 for one part. Modifies `part` in place and returns `merged_px`.
 *
 * ⚖️ Invariant: for each `extend_below_crop` entry naming this part, the
 * `belowCrop` pixels are copied from the extend layer (colour and alpha), then
 * `growRim` closes their seam against the later plan parts. `merged_px` is the
 * copied pixels plus the ring of the LAST such entry — the reference assigns
 * rather than adds, and that is kept (a part with one entry, the only case the
 * reference's corpus has, is unaffected).
 *
 * When `trace` is given, every pixel an entry wrote (copied or ring) has
 * `trace.from` set to that entry's index in `extras`, a later entry
 * overwriting an earlier one — the layer whose run says whether the pixel is
 * visible — and `trace.ring` set when the last write was the ring's.
 */
export function mergeBelowCrop(part: Raster, extras: Raster[], front: Mask, srcr: Raster, headBottom: number, trace?: MergeTrace): number {
  let merged = 0;
  extras.forEach((extra, e) => {
    const sel = belowCrop(part, extra, headBottom);
    let copied = 0;
    for (let p = 0; p < sel.data.length; p++) {
      if (sel.data[p] === 0) continue;
      copied++;
      part.data.set(extra.data.subarray(p * 4, p * 4 + 4), p * 4);
      if (trace !== undefined) {
        trace.from[p] = e;
        trace.ring.data[p] = 0;
      }
    }
    const ring = newMask(part.width, part.height);
    merged = copied + growRim(part, sel, srcr, front, ring);
    if (trace !== undefined) {
      trace.lastSel = sel;
      trace.lastRing = ring;
      for (let p = 0; p < ring.data.length; p++) {
        if (ring.data[p] === 1) {
          trace.from[p] = e;
          trace.ring.data[p] = 1;
        }
      }
    }
  });
  return merged;
}

/** Which extend entry last wrote each pixel (-1: none), and whether that write was the ring's. */
export interface MergeTrace {
  from: Int32Array;
  ring: Mask;
  /**
   * The last entry's copied pixels and its ring: `merged_px` is their two
   * counts added (the reference assigns per entry), so a cut splits it by
   * where these lie. Absent when no entry ran.
   */
  lastSel?: Mask;
  lastRing?: Mask;
}

export interface VisibilityCounts {
  visible_px: number;
  occluded_px: number;
  visible_not_projected_px: number;
  /** The part's projected pixels, the part layer's and any a merge copied in. */
  projected: number;
}

/**
 * The visibility counts of one part, from the masks its pixels were made
 * with, refusing — as a bug, not a report — when they do not add up.
 *
 * ⚖️ Invariant: `opaque` is the part's `alpha > 8` pixels; `visible` the pixels
 * set in `visible`; `occluded` the opaque pixels NOT set in it; `projected` the
 * pixels set in `projected`. Required: `visible + occluded = opaque` (so every
 * visible pixel is opaque) and every projected pixel is visible;
 * `visible_not_projected = visible - projected`. The assembler builds
 * `visible` as the opaque pixels no later layer of their run is in front of,
 * and `projected` as the accepted set of `projectSource`, so both hold by
 * construction and a refusal here names a mask that escaped its definition.
 */
export function visibilityCounts(object: string, part: Raster, visible: Mask, projected: Mask): VisibilityCounts {
  const n = part.width * part.height;
  let opaque = 0;
  let vis = 0;
  let occ = 0;
  let proj = 0;
  let projHidden = 0;
  for (let p = 0; p < n; p++) {
    const o = part.data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE;
    if (o) opaque++;
    if (visible.data[p] === 1) vis++;
    else if (o) occ++;
    if (projected.data[p] === 1) {
      proj++;
      if (visible.data[p] !== 1) projHidden++;
    }
  }
  const problems: Problem[] = [];
  if (vis + occ !== opaque) {
    problems.push({
      code: 'ASSEMBLE_COUNTS_ADD_UP',
      object,
      detail: `visible ${vis} + occluded ${occ} = ${vis + occ}, opaque (alpha above ${OPAQUE_ALPHA_ABOVE}) ${opaque}; equal is required — the visible mask holds ${vis + occ - opaque} pixel(s) that are not opaque (a bug in the assembler, not in the inputs)`,
    });
  }
  if (projHidden > 0) {
    problems.push({
      code: 'ASSEMBLE_COUNTS_ADD_UP',
      object,
      detail: `${projHidden} of ${proj} projected pixel(s) are not visible; projected <= visible, pixel by pixel, is required — a pixel a later layer covers was taken from the painting (a bug in the assembler, not in the inputs)`,
    });
  }
  refuseIfAny(problems);
  return { visible_px: vis, occluded_px: occ, visible_not_projected_px: vis - proj, projected: proj };
}

// ---------------------------------------------------------------------------
// step 5 — seam override
// ---------------------------------------------------------------------------

/**
 * The figure, as a mask over the rig: the pixels whose colour differs from
 * the median colour of the painting's outer `SILHOUETTE_BORDER`-pixel ring by
 * more than `SILHOUETTE_LIMIT` (max channel), opened twice by a 3x3 square
 * (erode twice, dilate twice) to drop edge noise, with every enclosed hole
 * filled — so a white blouse inside the figure's outline is figure, and the
 * white page round it is not. Computed once, from the painting alone.
 *
 * This is NOT in the reference. It is the input of `seamRule: 'silhouette'`.
 */
export function figureSilhouette(srcr: Raster): Mask {
  const { width: W, height: H } = srcr;
  const ring: number[][] = [[], [], []];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (y >= SILHOUETTE_BORDER && y < H - SILHOUETTE_BORDER && x >= SILHOUETTE_BORDER && x < W - SILHOUETTE_BORDER) continue;
      for (let c = 0; c < 3; c++) ring[c].push(srcr.data[(y * W + x) * 4 + c]);
    }
  }
  const median = ring.map((v) => {
    const s = [...v].sort((a, b) => a - b);
    const n = s.length;
    return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  });
  const fig = newMask(W, H);
  for (let p = 0; p < W * H; p++) {
    const d = Math.max(...[0, 1, 2].map((c) => Math.abs(srcr.data[p * 4 + c] - median[c])));
    if (d > SILHOUETTE_LIMIT) fig.data[p] = 1;
  }
  const opened = dilate(dilate(erode(erode(fig, 3), 3), 3), 3);
  return fillHoles(opened);
}

export interface PlacedPart {
  record: PartRecord;
  image: Raster;
}

/** The seam pass's view of a stack of parts, before anything is recoloured (`seamCandidates`). */
export interface SeamCandidates {
  /** Per rig pixel: the index of the top-most part with alpha above 0 there, or -1. */
  top: Int32Array;
  /** Per rig pixel: the index of the top-most part with alpha >= `CORE_ALPHA` there, or -1. */
  holder: Int32Array;
  /** Per rig pixel: 1 where the seam rule admits the pixel as a candidate (`seamOverride`'s invariant). */
  cand: Uint8Array;
}

/**
 * The candidates of the seam pass over `parts` in draw order, exactly as
 * `seamOverride` defines them (its invariant): the flat composite on white,
 * in float as the reference composites; a candidate differs from the
 * painting by more than `SEAM_LIMIT` (max channel), is covered by some part
 * (alpha > 0) and is admitted by the rule. Also returned: which part is the
 * top-most cover of each pixel, and which is the top-most at alpha >=
 * `CORE_ALPHA` — the part that holds the pixel.
 */
export function seamCandidates(parts: PlacedPart[], srcr: Raster, rule: SeamRule, silhouette: Mask | null): SeamCandidates {
  const { width: W, height: H } = srcr;
  const top = new Int32Array(W * H).fill(-1);
  const holder = new Int32Array(W * H).fill(-1);
  const can = new Float64Array(W * H * 3).fill(255);
  parts.forEach(({ record: p, image }, i) => {
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const s = (y * p.w + x) * 4;
        const d = (p.y + y) * W + p.x + x;
        const alpha = image.data[s + 3];
        if (alpha > 0) top[d] = i;
        if (alpha >= CORE_ALPHA) holder[d] = i;
        const a = f32(alpha / 255);
        const one = f32(1 - a);
        for (let c = 0; c < 3; c++) can[d * 3 + c] = can[d * 3 + c] * one + f32(image.data[s + c] * a);
      }
    }
  });
  const cand = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) {
    if (top[p] < 0) continue;
    const s = p * 4;
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(can[p * 3 + c] - srcr.data[s + c]));
    if (!(d > SEAM_LIMIT)) continue;
    const painted = Math.min(srcr.data[s], srcr.data[s + 1], srcr.data[s + 2]) <= NEAR_WHITE_MIN;
    const admitted = rule === 'near-white' ? painted : painted || (silhouette !== null && silhouette.data[p] === 1);
    if (admitted) cand[p] = 1;
  }
  return { top, holder, cand };
}

/** Pixels of one part's fringe that `pushBackFringe` cleared, counted by the part that holds them. */
export interface FringePushed {
  /** The part drawn beneath, at alpha >= `CORE_ALPHA`, that the painting shows there. */
  part: string;
  px: number;
}

/** The art mask the contour mesher reads (alpha above 8), and its 4-connected islands. */
function artIslands(image: Raster): { labels: Int32Array; count: number; core: Uint8Array; area: Int32Array } {
  const n = image.width * image.height;
  const art = newMask(image.width, image.height);
  for (let q = 0; q < n; q++) if (image.data[q * 4 + 3] > OPAQUE_ALPHA_ABOVE) art.data[q] = 1;
  const cc = connectedComponents(art, 4);
  const core = new Uint8Array(cc.count);
  const area = new Int32Array(cc.count);
  for (let q = 0; q < n; q++) {
    const l = cc.labels[q];
    if (l === 0) continue;
    area[l]++;
    if (image.data[q * 4 + 3] >= CORE_ALPHA) core[l] = 1;
  }
  return { labels: cc.labels, count: cc.count, core, area };
}

/** One pixel `pushBackFringe` cleared: its index in the part's box, its RGBA before, its holder's index in the stack, and whether it is still clear. */
interface Cleared {
  q: number;
  rgba: number[];
  h: number;
  on: boolean;
}

/**
 * `pushBackFringe`'s after-step on one part: clearing a fringe never splits
 * an island of the part's art. The art is the contour mesher's reading —
 * alpha above 8, 4-connected (`src/contour.ts`, `CONTOUR_ONE_ISLAND`) — and
 * the islands before the clearing are the part's islands with every cleared
 * pixel put back.
 *
 * ⚖️ Invariant: afterwards every island the part had before is at most one
 * island. Where the clearing left one in several pieces, the largest piece
 * (by area; the first in scan order on a tie) stays, and each other piece is
 * either
 * - a CRUMB — every pixel below `CORE_ALPHA`, and every pixel either held
 *   by some part at alpha >= `CORE_ALPHA` (`holderAt` >= 0) or not covering
 *   (alpha <= `COVERED_ALPHA`), so clearing it uncovers nothing — which is
 *   cleared too: a piece of the same fringe, cut off from its part. Its
 *   pixels are counted against the holder of the first cleared pixel beside
 *   it, the clearing that cut it off; or
 * - anything else (it holds a pixel at alpha >= `CORE_ALPHA`, or a covering
 *   pixel nothing holds), in which case every cleared pixel 4-adjacent to it
 *   is put back as it was.
 * Repeated until no island is split: the pieces were joined only through
 * cleared pixels, and each round clears a crumb or puts a pixel back, so the
 * loop ends.
 * So the part's island count never rises, and `CONTOUR_ONE_ISLAND` reads
 * the islands it read before. Without the bridge put back, the clearing cut a
 * 7 px piece of opaque art off demo's `sleeves` (the pull request that added
 * this step); a fringe cleared along a long edge leaves a crumb wherever the
 * edge was two pixels wide, and selftest `AS47` plants both.
 */
function keepArtWhole(part: PlacedPart, cleared: Cleared[], holderAt: (q: number) => number): void {
  if (cleared.length === 0) return;
  const { image } = part;
  const { width: w, height: h } = image;
  const n = w * h;
  const whole: Raster = { width: w, height: h, data: new Uint8ClampedArray(image.data) };
  for (const c of cleared) whole.data.set(c.rgba, c.q * 4);
  const before = artIslands(whole);
  for (;;) {
    const after = artIslands(image);
    // Per piece: its island before, and whether it is a crumb; per island before: its pieces and the largest.
    const islandOf = new Int32Array(after.count).fill(-1);
    const crumb = new Uint8Array(after.count).fill(1);
    const pieces = new Int32Array(before.count);
    const largest = new Int32Array(before.count).fill(-1);
    for (let q = 0; q < n; q++) {
      const l = after.labels[q];
      if (l === 0) continue;
      if (islandOf[l] < 0) {
        const b = before.labels[q];
        islandOf[l] = b;
        pieces[b]++;
        if (largest[b] < 0 || after.area[l] > after.area[largest[b]]) largest[b] = l;
      }
      const a = image.data[q * 4 + 3];
      if (a >= CORE_ALPHA || (a > COVERED_ALPHA && holderAt(q) < 0)) crumb[l] = 0;
    }
    const split = (l: number): boolean => l > 0 && pieces[islandOf[l]] > 1 && largest[islandOf[l]] !== l;
    const beside = (c: Cleared): number[] => {
      const x = c.q % w;
      const y = (c.q - x) / w;
      return [x > 0 ? c.q - 1 : -1, x < w - 1 ? c.q + 1 : -1, y > 0 ? c.q - w : -1, y < h - 1 ? c.q + w : -1].filter((m) => m >= 0 && split(after.labels[m])).map((m) => after.labels[m]);
    };
    // A crumb is counted against the holder of the first cleared pixel beside it: the clearing that cut it off.
    const cutBy = new Int32Array(after.count).fill(-1);
    for (const c of cleared) if (c.on) for (const l of beside(c)) if (crumb[l] === 1 && cutBy[l] < 0) cutBy[l] = c.h;
    for (let l = 1; l < after.count; l++) if (cutBy[l] < 0) crumb[l] = 0;
    const restore = cleared.filter((c) => c.on && beside(c).some((l) => crumb[l] === 0));
    let changed = 0;
    for (let q = 0; q < n; q++) {
      const l = after.labels[q];
      if (!split(l) || crumb[l] === 0) continue;
      cleared.push({ q, rgba: Array.from(image.data.subarray(q * 4, q * 4 + 4)), h: cutBy[l], on: true });
      image.data.fill(0, q * 4, q * 4 + 4);
      changed++;
    }
    for (const c of restore) {
      image.data.set(c.rgba, c.q * 4);
      c.on = false;
      changed++;
    }
    if (changed === 0) break;
  }
}

/**
 * Step 4b (issue #119), over every part in draw order, before the seam
 * override. Modifies the part images in place and returns, per part, the
 * pixels it cleared, by holder.
 *
 * ⚖️ Invariant: a pixel is PUSHED BACK in a part when, over the stack as it
 * stands (`seamCandidates`): (1) the pixel is a seam candidate — the flat
 * composite differs from the painting by more than `SEAM_LIMIT` (max
 * channel) and the seam rule admits it; (2) this part is drawn after the
 * pixel's HOLDER — the top-most part at alpha >= `CORE_ALPHA` there — with
 * alpha above 0, which makes it a fringe (below `CORE_ALPHA`, or it would be
 * the holder) that the seam override, recolouring only at alpha >=
 * `CORE_ALPHA`, cannot reach; and (3) the holder is in the painting's colour
 * — its own RGB within `SEAM_LIMIT` of the painting's (max channel): the
 * painting shows the holder there. Every such pixel becomes transparent (all
 * four channels 0). Then `keepArtWhole` holds each part's art to the islands
 * it had: a crumb the clearing cut off is cleared too, and a cleared bridge
 * to opaque art is put back. No constant is new: (1) and (2) are the seam
 * override's own candidate set and alpha, (3) is the seam override's own
 * limit, applied to the part the pixel falls back to, and the islands are the
 * contour mesher's reading of the art. Where the holder is itself the top
 * cover, nothing is drawn after it and nothing is cleared: a pixel at alpha
 * >= `CORE_ALPHA` is the seam override's, as before.
 *
 * Why (3) asks for the holder's colour: without it a fringe that is too
 * faint rather than the wrong colour — an earring's edge over hair, where the
 * painting shows the earring — is cleared too, and the seam override then
 * paints the earring's colour onto the hair beneath, which moves with the
 * hair: the sliver this rule exists to remove, moved to the other part.
 * Measured on the public examples (the pull request that closed issue #119):
 * without (3) the holders' `seam_override_px` rose from 47 to 617 on demo's
 * `hair_back` and from 20 to 222 on sample's `bottomwear`; with it, and with
 * the crumbs `keepArtWhole` clears, no part's `seam_override_px` moved by
 * more than 1 on either example under either seam rule.
 *
 * Why it is right to clear rather than to recolour: the holder is opaque
 * there, so no pixel loses cover (`COVERED_ALPHA` is below `CORE_ALPHA`) and
 * no uncovered error pixel appears; and the colour the painting shows there
 * belongs to the holder, which moves with the holder's bones. A fringe
 * recoloured to the painting would carry the holder's colour on the part in
 * front, as a translucent rim that leaves the holder when the two move apart.
 *
 * Left alone: a pixel whose stack composites to within `SEAM_LIMIT` of the
 * painting (an anti-aliased edge that is the painting's edge); a fringe no
 * part holds beneath (the figure's outline over the page — nothing would
 * hold the pixel after it); and every pixel at alpha >= `CORE_ALPHA`, which
 * is the seam override's.
 */
export function pushBackFringe(parts: PlacedPart[], srcr: Raster, rule: SeamRule, silhouette: Mask | null, feathered: ReadonlyArray<Mask | null> | null = null): FringePushed[][] {
  const { width: W } = srcr;
  const { holder, cand } = seamCandidates(parts, srcr, rule, silhouette);
  const at = (i: number, d: number): number => {
    const p = parts[i].record;
    const x = (d % W) - p.x;
    const y = Math.floor(d / W) - p.y;
    return x >= 0 && x < p.w && y >= 0 && y < p.h ? (y * p.w + x) * 4 : -1;
  };
  /** The holder shows the painting at rig pixel `d`: it exists and its own colour is within `SEAM_LIMIT` of the painting's. */
  const shows = (d: number): boolean => holder[d] >= 0 && maxDiff(parts[holder[d]].image.data, at(holder[d], d), srcr.data, d * 4) <= SEAM_LIMIT;
  /** Per part, every pixel cleared: its index in the part's box, its colour before, its holder, and whether it is still clear. */
  const cleared: Cleared[][] = parts.map(() => []);
  for (let d = 0; d < cand.length; d++) {
    // Every part drawn after the holder is below CORE_ALPHA there, by the holder's definition; when the holder is the top
    // cover itself the loop below has nothing to clear, and the seam override acts on the pixel as before.
    if (cand[d] === 0 || !shows(d)) continue;
    for (let i = holder[d] + 1; i < parts.length; i++) {
      if (feathered?.[i]?.data[d] === 1) continue;
      const s = at(i, d);
      if (s < 0) continue;
      const img = parts[i].image.data;
      if (img[s + 3] === 0) continue;
      cleared[i].push({ q: s / 4, rgba: Array.from(img.subarray(s, s + 4)), h: holder[d], on: true });
      img.fill(0, s, s + 4);
    }
  }
  parts.forEach((part, i) => keepArtWhole(part, cleared[i], (q) => {
    const d = (part.record.y + Math.floor(q / part.record.w)) * W + part.record.x + (q % part.record.w);
    return holder[d];
  }));
  const counts: Array<Map<number, number>> = parts.map(() => new Map());
  cleared.forEach((list, i) => {
    for (const c of list) if (c.on) counts[i].set(c.h, (counts[i].get(c.h) ?? 0) + 1);
  });
  return counts.map((m) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([h, px]) => ({ part: parts[h].record.name, px })),
  );
}

/**
 * Step 5, over every part in plan order. Modifies the part images in place and
 * sets each record's `seam_override_px`.
 *
 * ⚖️ Invariant: over the flat composite of the parts on white (float, as the
 * reference composites), a CANDIDATE is a pixel differing from the painting by
 * more than `SEAM_LIMIT` (max channel) that some part covers (alpha > 0) and
 * that the rule admits — `near-white` (the reference's): the painting's min
 * channel is <= 235; `silhouette`: that, OR the pixel is inside
 * `figureSilhouette` — so a near-white painting pixel is protected only
 * outside the figure, which is the background the reference's guard exists
 * to protect. (Replacing the whiteness test by the silhouette outright was
 * measured and rejected: the opened mask loses figure-edge pixels the
 * whiteness test admits, and error px rose on eight of ten oracle
 * characters — ORACLE_assemble.md.)
 * Each candidate is recoloured to the painting's colour in the TOP-MOST part
 * covering it, and only where that part's alpha is >= 250; alpha never
 * changes. Candidates are chosen once, before any recolouring.
 * (`assemble_parts.py` `main`, "5. seam override".)
 */
export function seamOverride(parts: PlacedPart[], srcr: Raster, rule: SeamRule, silhouette: Mask | null): void {
  const { width: W } = srcr;
  const { top, cand } = seamCandidates(parts, srcr, rule, silhouette);
  parts.forEach(({ record: p, image }, i) => {
    let n = 0;
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const d = (p.y + y) * W + p.x + x;
        const s = (y * p.w + x) * 4;
        if (cand[d] === 0 || top[d] !== i || image.data[s + 3] < CORE_ALPHA) continue;
        image.data[s] = srcr.data[d * 4];
        image.data[s + 1] = srcr.data[d * 4 + 1];
        image.data[s + 2] = srcr.data[d * 4 + 2];
        n++;
      }
    }
    p.seam_override_px = n;
  });
}

// ---------------------------------------------------------------------------
// the recomposite
// ---------------------------------------------------------------------------

export interface RecompositeFigures {
  /** Mean over pixels of the mean-channel |recomposite - painting|. */
  meanAbs: number;
  /** Fraction of pixels whose mean-channel difference is <= `WITHIN_LIMIT`. */
  within: number;
  /** Pixels whose max-channel difference is > `ERROR_LIMIT`. */
  errorPx: number;
  /** Of those, the ones no part covers (no part has alpha above `COVERED_ALPHA`). */
  uncoveredErrorPx: number;
  /** The 8-connected components of the uncovered error pixels: how many there are … */
  holeCount: number;
  /** … and the largest `HOLES_LISTED` of them, largest first (`uncoveredHoles`). */
  holes: RecompositeHole[];
}

/** How many uncovered holes the assemble summary and `parts.json` list, largest first. */
export const HOLES_LISTED = 5;

/** A part beside an uncovered hole: how many of its covered pixels touch the hole. */
export interface HoleBorder {
  part: string;
  px: number;
}

/** One 8-connected component of the uncovered error pixels, in rig pixels (y down, origin top-left). */
export interface RecompositeHole {
  px: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Every part bordering the hole, most border pixels first, then plan order; empty when it borders none. */
  borders: HoleBorder[];
}

/** The parts composited in plan order onto opaque white, as `PIL.Image.alpha_composite` does it. */
export function recomposite(parts: PlacedPart[], W: number, H: number): Raster {
  let can = newRaster(W, H);
  can.data.fill(255);
  for (const { record: p, image } of parts) can = alphaComposite(can, image, p.x, p.y);
  return can;
}

/** Per rig pixel: 1 where some part has alpha above `COVERED_ALPHA`. */
function coveredMask(parts: PlacedPart[], W: number, H: number): Uint8Array {
  const covered = new Uint8Array(W * H);
  for (const { record: p, image } of parts) {
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (image.data[(y * p.w + x) * 4 + 3] > COVERED_ALPHA) covered[(p.y + y) * W + p.x + x] = 1;
  }
  return covered;
}

/** Per rig pixel: 1 where the recomposite's max-channel difference from the painting is above `ERROR_LIMIT` — and, with `inside` (a scene, issue #242), the pixel is the figure's. */
function errorMask(can: Raster, srcr: Raster, inside: Uint8Array | null = null): Uint8Array {
  const n = srcr.width * srcr.height;
  const err = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (inside !== null && inside[p] === 0) continue;
    let m = 0;
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(can.data[p * 4 + c] - srcr.data[p * 4 + c]));
    if (m > ERROR_LIMIT) err[p] = 1;
  }
  return err;
}

/**
 * The uncovered error pixels as holes: every 8-connected component of the
 * pixels whose recomposite differs from the painting by more than
 * `ERROR_LIMIT` (max channel) and that no part covers (alpha above
 * `COVERED_ALPHA`) — the pixels `uncoveredErrorPx` counts, so the components'
 * areas sum to it.
 *
 * ⚖️ Invariant: a hole's box is its pixels' bounding box; its `borders` are
 * the parts with a covered pixel 8-adjacent to one of its pixels, each with
 * the number of such pixels it covers (a pixel two parts cover counts for
 * both), most first and then in plan order. Holes are sorted by area, largest
 * first, then by the box's top row and left column, so the order is a
 * function of the pixels and not of a labelling scan. 8-connectivity is the
 * reference's own for blobs (`cv2.connectedComponentsWithStats(…, 8)` in
 * ghost clean-up): a hole joined only at a corner is one hole.
 *
 * This is not in the reference, whose report stopped at the count. The count
 * cannot say where to look; a box and the parts round it can.
 */
export function uncoveredHoles(can: Raster, srcr: Raster, parts: PlacedPart[], inside: Uint8Array | null = null): { count: number; holes: RecompositeHole[] } {
  const { width: W, height: H } = srcr;
  const covered = coveredMask(parts, W, H);
  const err = errorMask(can, srcr, inside);
  const mask = newMask(W, H);
  for (let p = 0; p < W * H; p++) if (err[p] === 1 && covered[p] === 0) mask.data[p] = 1;
  const cc = connectedComponents(mask, 8);
  const all = cc.stats.slice(1).filter((s) => s.area > 0);
  all.sort((a, b) => b.area - a.area || a.top - b.top || a.left - b.left);
  const listed = all.slice(0, HOLES_LISTED);
  const holes = listed.map((s): RecompositeHole => {
    const borders: HoleBorder[] = [];
    parts.forEach(({ record: p, image }) => {
      let n = 0;
      // A part pixel can touch the hole only inside the hole's box grown by one.
      const x0 = Math.max(p.x, s.left - 1);
      const x1 = Math.min(p.x + p.w - 1, s.left + s.width);
      const y0 = Math.max(p.y, s.top - 1);
      const y1 = Math.min(p.y + p.h - 1, s.top + s.height);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (image.data[((y - p.y) * p.w + (x - p.x)) * 4 + 3] <= COVERED_ALPHA) continue;
          let touches = false;
          for (let dy = -1; dy <= 1 && !touches; dy++) {
            for (let dx = -1; dx <= 1 && !touches; dx++) {
              const u = x + dx;
              const v = y + dy;
              if (u >= 0 && u < W && v >= 0 && v < H && cc.labels[v * W + u] === s.label) touches = true;
            }
          }
          if (touches) n++;
        }
      }
      if (n > 0) borders.push({ part: p.name, px: n });
    });
    // Array.prototype.sort is stable, so equal counts keep plan order.
    borders.sort((a, b) => b.px - a.px);
    return { px: s.area, x: s.left, y: s.top, w: s.width, h: s.height, borders };
  });
  return { count: all.length, holes };
}

/**
 * The recomposite's four figures and its holes. With `inside` (a scene, issue
 * #242; {@link sceneFigure}) every one is read over the figure's pixels alone:
 * the mean and the within share are over them, and a pixel outside is neither an
 * error pixel nor a hole's. Without it, over the whole rig, as always.
 */
export function measureRecomposite(can: Raster, srcr: Raster, parts: PlacedPart[], inside: Uint8Array | null = null): RecompositeFigures {
  const { width: W, height: H } = srcr;
  const covered = coveredMask(parts, W, H);
  let sum = 0;
  let within = 0;
  let errorPx = 0;
  let uncoveredErrorPx = 0;
  let read = 0;
  for (let p = 0; p < W * H; p++) {
    if (inside !== null && inside[p] === 0) continue;
    read++;
    let s = 0;
    let m = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(can.data[p * 4 + c] - srcr.data[p * 4 + c]);
      s += d;
      m = Math.max(m, d);
    }
    const mean = s / 3;
    sum += mean;
    if (mean <= WITHIN_LIMIT) within++;
    if (m > ERROR_LIMIT) {
      errorPx++;
      if (covered[p] === 0) uncoveredErrorPx++;
    }
  }
  const { count, holes } = uncoveredHoles(can, srcr, parts, inside);
  // Over the whole rig `read` is W * H, and the two quotients are the ones they always were.
  return { meanAbs: inside === null ? sum / (W * H) : read === 0 ? 0 : sum / read, within: inside === null ? within / (W * H) : read === 0 ? 0 : within / read, errorPx, uncoveredErrorPx, holeCount: count, holes };
}

/** The figure mask's file name, beside the recomposite (issue #242): `recomposite_rig.png` -> `figure_rig.png`. */
export const FIGURE_MASK_FILE = 'figure_rig.png';

/**
 * The figure of a scene painting (issue #242): per rig pixel, 1 where any
 * full-run layer — See-through's decomposition of the whole figure, each layer
 * placed on the rig as the stage places it — has alpha above
 * `OPAQUE_ALPHA_ABOVE` (8), the cut this package already reads a layer's
 * painted pixels by (ghost clean-up, the sheets, every part's opaque count).
 * The threshold is that one, not a new one: a pixel no layer paints is the
 * scene's, and a pixel any layer paints is the figure's, by the same rule that
 * says what a layer holds. The head run is not read: it is a crop of the same
 * figure, inside the full run's.
 */
export function sceneFigure(fullRig: readonly Raster[], W: number, H: number): Uint8Array {
  const inside = new Uint8Array(W * H);
  for (const r of fullRig) for (let p = 0; p < W * H; p++) if (r.data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE) inside[p] = 1;
  return inside;
}

/** The figure as an image, the mask `assemble` writes beside the recomposite: opaque white where the figure is, opaque black elsewhere. */
export function figureImage(inside: Uint8Array, W: number, H: number): Raster {
  const r = newRaster(W, H);
  for (let p = 0; p < W * H; p++) {
    const v = inside[p] === 1 ? 255 : 0;
    r.data.set([v, v, v, 255], p * 4);
  }
  return r;
}

/** What a scene declaration says first on each recomposite line (issue #242): where it was read, and the figure's size against the rig's. */
export function scenePhrase(s: SceneRecord, rigPx: number): string {
  return `inside the figure (config.scene: the union of the full run's layers at alpha above ${s.figure_alpha_above}, ${s.figure_px} of ${rigPx} rig px)`;
}

/** The error map's colour for an uncovered error pixel: no part is there, so the page shows through. */
export const MAP_UNCOVERED: readonly [number, number, number] = [255, 0, 0];
/** … for a covered error pixel: a part is there, in a colour more than `ERROR_LIMIT` off the painting's. */
export const MAP_MISMATCHED: readonly [number, number, number] = [0, 0, 255];

/**
 * The error map, `recomposite_error_rig.png`: the rig canvas, opaque, with
 * every uncovered error pixel `MAP_UNCOVERED` (red), every covered error pixel
 * `MAP_MISMATCHED` (blue), and every other pixel the painting in grey, dimmed
 * to the top quarter of the range — `192 + floor(luma / 4)`, luma the integer
 * BT.601 `(299 R + 587 G + 114 B + 500) / 1000` truncated.
 *
 * Why the painting dimmed rather than transparent: the map is read at contact-
 * sheet size, and a red blob on nothing says a hole exists but not where on
 * the figure it is; on a faint grey figure it sits between the legs it falls
 * between. Why grey and light: no pixel of the dimmed painting can be either
 * flag colour (a grey has equal channels, and at 192..255 it is lighter than
 * both), so the two colours mean exactly the two masks. Integer arithmetic
 * only, so the bytes are deterministic.
 */
export function recompositeErrorMap(can: Raster, srcr: Raster, parts: PlacedPart[], inside: Uint8Array | null = null): Raster {
  const { width: W, height: H } = srcr;
  const covered = coveredMask(parts, W, H);
  const err = errorMask(can, srcr, inside);
  const map = newRaster(W, H);
  for (let p = 0; p < W * H; p++) {
    const s = p * 4;
    let rgb: readonly [number, number, number];
    if (err[p] === 1) rgb = covered[p] === 0 ? MAP_UNCOVERED : MAP_MISMATCHED;
    else {
      const luma = Math.floor((299 * srcr.data[s] + 587 * srcr.data[s + 1] + 114 * srcr.data[s + 2] + 500) / 1000);
      const g = 192 + Math.floor(luma / 4);
      rgb = [g, g, g];
    }
    map.data[s] = rgb[0];
    map.data[s + 1] = rgb[1];
    map.data[s + 2] = rgb[2];
    map.data[s + 3] = 255;
  }
  return map;
}

export function figuresLine(f: RecompositeFigures, scene: string | null = null): string {
  return (
    `${scene === null ? '' : `${scene}: `}recomposite vs source: mean |d|=${f.meanAbs.toFixed(2)}, within ${WITHIN_LIMIT}: ${(100 * f.within).toFixed(1)}%, ` +
    `error px > ${ERROR_LIMIT}: ${f.errorPx}, uncovered error px: ${f.uncoveredErrorPx}`
  );
}

/** A hole's box as the part lines and refusals print a box: `x,y wxh`. */
export function holeBox(h: RecompositeHole): string {
  return `${h.x},${h.y} ${h.w}x${h.h}`;
}

/**
 * The hole lines under `figuresLine`: the count, then one line per listed
 * hole — `uncovered hole 1: 2340 px at 412,1088 30x78 (between "legwear_r"
 * 120 px, "legwear_l" 96 px)`, or `(borders no part)`.
 */
export function holeLines(f: RecompositeFigures, scene: string | null = null): string[] {
  const head = `${scene === null ? '' : `${scene}: `}uncovered holes (8-connected): ${f.holeCount}${f.holeCount > f.holes.length ? `, the largest ${f.holes.length} listed` : ''}`;
  return [
    head,
    ...f.holes.map(
      (h, i) =>
        `  uncovered hole ${i + 1}: ${h.px} px at ${holeBox(h)} (${h.borders.length === 0 ? 'borders no part' : `between ${h.borders.map((b) => `"${b.part}" ${b.px} px`).join(', ')}`})`,
    ),
  ];
}

/** One kind of uncovered error pixel (issue #351): total pixel count, 8-connected component count, and largest component box. */
export interface HoleKindSummary {
  px: number;
  count: number;
  largest: { px: number; x: number; y: number; w: number; h: number } | null;
}

/**
 * The partition of uncovered error pixels into two disjoint causes (issue #351):
 * - `noLayer`: pixels where no See-through layer in either run has `alpha > OPAQUE_ALPHA_ABOVE` (an `assemble.patches` box from the painting is the only repair).
 * - `betweenLayers`: pixels where at least one See-through layer has `alpha > OPAQUE_ALPHA_ABOVE`, but no placed part covers the pixel at `alpha > COVERED_ALPHA`.
 */
export interface HoleKinds {
  noLayer: HoleKindSummary;
  betweenLayers: HoleKindSummary;
}

function summarizeKindMask(mask: Mask): HoleKindSummary {
  let px = 0;
  for (let p = 0; p < mask.data.length; p++) px += mask.data[p];
  if (px === 0) return { px: 0, count: 0, largest: null };
  const cc = connectedComponents(mask, 8);
  const all = cc.stats.slice(1).filter((s) => s.area > 0);
  all.sort((a, b) => b.area - a.area || a.top - b.top || a.left - b.left);
  const s = all[0];
  return { px, count: all.length, largest: s === undefined ? null : { px: s.area, x: s.left, y: s.top, w: s.width, h: s.height } };
}

export function holeKinds(err: Uint8Array, covered: Uint8Array, anyLayer: Uint8Array, W: number, H: number): HoleKinds {
  const noLayerMask = newMask(W, H);
  const betweenMask = newMask(W, H);
  for (let p = 0; p < W * H; p++) {
    if (err[p] !== 1 || covered[p] !== 0) continue;
    if (anyLayer[p] === 0) noLayerMask.data[p] = 1;
    else betweenMask.data[p] = 1;
  }
  return { noLayer: summarizeKindMask(noLayerMask), betweenLayers: summarizeKindMask(betweenMask) };
}

/**
 * The summary line under `holeLines` (issue #351): partitions `uncoveredErrorPx`
 * into pixels where no See-through layer has `alpha > 8` (`noLayer`, repaired
 * only by `assemble.patches`) and pixels where a layer has `alpha > 8` (`betweenLayers`).
 */
export function holeKindsLine(k: HoleKinds, scene: string | null = null): string {
  const fmt = (s: HoleKindSummary): string =>
    s.px === 0 || s.largest === null
      ? '0 px'
      : `${s.px} px in ${s.count} component(s) (largest ${s.largest.px} px at ${s.largest.x},${s.largest.y} ${s.largest.w}x${s.largest.h})`;
  return (
    `${scene === null ? '' : `${scene}: `}uncovered error by cause: no layer (alpha <= ${OPAQUE_ALPHA_ABOVE} on every layer; only assemble.patches from the painting can cover): ${fmt(k.noLayer)}; ` +
    `on a layer (alpha > ${OPAQUE_ALPHA_ABOVE} on a layer, below covered alpha ${COVERED_ALPHA} in the parts): ${fmt(k.betweenLayers)}`
  );
}

/** The `parts.json` `recomposite` block: the four figures, the limits they were measured at, and the listed holes. */
export function recompositeRecord(f: RecompositeFigures): RecompositeRecord {
  return {
    mean_abs: pyRound(f.meanAbs, 3),
    within_limit: WITHIN_LIMIT,
    within_share: pyRound(f.within, 4),
    error_limit: ERROR_LIMIT,
    error_px: f.errorPx,
    covered_alpha: COVERED_ALPHA,
    uncovered_error_px: f.uncoveredErrorPx,
    hole_count: f.holeCount,
    holes_listed: HOLES_LISTED,
    holes: f.holes.map((h) => ({ px: h.px, x: h.x, y: h.y, w: h.w, h: h.h, borders: h.borders.map((b) => ({ part: b.part, px: b.px })) })),
  };
}

// ---------------------------------------------------------------------------
// patches — extra parts cut from the painting
// ---------------------------------------------------------------------------

/**
 * One `assemble.patches` entry as a part: the painting's own pixels over its
 * box, taken where its alpha rule says.
 *
 * ⚖️ Invariant: a pixel of the rig is in the patch exactly when it lies in
 * `box` (`[x0, y0, x1, y1]`, rig pixels, `x1`/`y1` exclusive) and, for
 * `alpha: "silhouette"`, `figureSilhouette(srcr)` holds it; there its colour
 * is the painting's (`srcr`) and its alpha 255, everywhere else the pixel is
 * transparent. The silhouette is the painting's, not the union of the
 * layers' alpha: the pixels a patch exists for are exactly the ones no layer
 * holds, so the layers' union is empty over them by definition. The record is
 * the patch's alpha box and its counts, all of them `opaque_px` or 0 — a
 * patch is 100 % source (`src/parts.ts`). `seam_override_px` is set later by
 * `seamOverride`, as for every part.
 */
export function cutPatch(patch: Patch, srcr: Raster, silhouette: Mask | null): { record: PartRecord; image: Raster } | null {
  const { width: W, height: H } = srcr;
  const [bx0, by0, bx1, by1] = patch.box;
  const r = newRaster(W, H);
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  let n = 0;
  for (let y = by0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++) {
      const p = y * W + x;
      if (patch.alpha === 'silhouette' && (silhouette === null || silhouette.data[p] === 0)) continue;
      r.data.set(srcr.data.subarray(p * 4, p * 4 + 3), p * 4);
      r.data[p * 4 + 3] = 255;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (n === 0) return null;
  const record: PartRecord = {
    name: patch.name,
    from: `${PAINTING_RUN}:${patch.name}`,
    x: x0,
    y: y0,
    w: x1 - x0 + 1,
    h: y1 - y0 + 1,
    opaque_px: n,
    visible_px: n,
    occluded_px: 0,
    projected_core_px: n,
    source_px_taken: n,
    visible_not_projected_px: 0,
    refused_drift_px: 0,
    merged_px: 0,
    seam_override_px: 0,
  };
  return { record, image: crop(r, x0, y0, record.w, record.h) };
}

/** One place in the draw order: a plan part, a patch or a cut's new part, by its index in its list. */
export type PlanSlot = { plan: number } | { patch: number } | { cut: number };

/** A slot of the draw order once the limbs are in it (issue #349, {@link limbOrder}). */
export type DrawSlot = PlanSlot | { limb: number };

/**
 * The draw order of plan parts, patches and cuts together, back to front:
 * every `"back"` patch in `patches` order, then every `"back"` cut in `cuts`
 * order; then each plan part preceded by the patches drawn `{before: <that
 * part>}` in `patches` order and then the cuts drawn so in `cuts` order; then
 * every `"front"` patch, then every `"front"` cut. With no cuts it is the
 * order of plan parts and patches it always was. The loader has already
 * refused a `before` that names no plan part.
 */
export function drawOrder(plan: readonly string[], patches: readonly Patch[], cuts: readonly Cut[] = []): PlanSlot[] {
  const out: PlanSlot[] = [];
  const place = (at: (draw: Patch['draw']) => boolean): void => {
    patches.forEach((q, i) => {
      if (at(q.draw)) out.push({ patch: i });
    });
    cuts.forEach((q, i) => {
      if (at(q.draw)) out.push({ cut: i });
    });
  };
  place((d) => d === 'back');
  plan.forEach((name, pi) => {
    place((d) => typeof d === 'object' && d.before === name);
    out.push({ plan: pi });
  });
  place((d) => d === 'front');
  return out;
}

// ---------------------------------------------------------------------------
// cuts — a plan part's pixels taken into a new part by a declared polygon
// ---------------------------------------------------------------------------

/**
 * The rig pixels a polygon holds: pixel `(x, y)` is inside when its centre
 * `(x + 0.5, y + 0.5)` is inside the polygon by the even-odd rule: on each
 * row, the polygon's edges cross the centre line at sorted x, and the centres
 * strictly between the first and second crossing, the third and fourth, …
 * are inside. An edge crosses when exactly one of its ends lies below the
 * line; the vertices are integers and the line is at a half, so no vertex
 * lies on it and a horizontal edge never crosses. A centre exactly on a
 * crossing is outside. Pure arithmetic on the declared integers: the same
 * polygon holds the same pixels on every machine.
 */
export function pixelsInPolygon(polygon: ReadonlyArray<readonly [number, number]>, W: number, H: number): Mask {
  const m = newMask(W, H);
  const n = polygon.length;
  for (let y = 0; y < H; y++) {
    const cy = y + 0.5;
    // The crossings of this row's centre line, sorted; pixels between pairs are inside.
    const xs: number[] = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      if (yi > cy !== yj > cy) xs.push(xi + ((cy - yi) * (xj - xi)) / (yj - yi));
    }
    if (xs.length === 0) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Centres x + 0.5 with xs[k] < x + 0.5 < xs[k + 1]; a centre exactly on a crossing is outside.
      const from = Math.max(0, Math.floor(xs[k] - 0.5) + 1);
      const to = Math.min(W - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let x = from; x <= to; x++) m.data[y * W + x] = 1;
    }
  }
  return m;
}

/** What one cut did, counted when it was made: the from part's opaque pixels before, what it kept, what the cut took. */
export interface CutCount {
  from: string;
  into: string;
  /** The from part's `alpha > 8` pixels before any of its cuts. */
  before: number;
  /** What the from part kept after all its cuts; the same on every cut of one part. */
  kept: number;
  /** What this cut took. */
  taken: number;
  /** Of `taken`, the band the from part keeps as well (`cutBand`); counted in neither `kept` nor `before` twice. */
  band: number;
  /** With `under` only (issue #193): the base pixels filled from the under image (`fillUnder`); absent without it. */
  under?: number;
  /** With `under` only: the removed pixels the image left empty (its alpha below the alpha removed); `under + underEmpty` is the removed count. */
  underEmpty?: number;
  /** With `under_fill: "colour"` only (issue #360): the `under` pixels took the image's colour at the alpha the cut removed; absent without it. */
  underFill?: 'colour';
  /** Issue #564, only on a cut from a part a limb takes, lying past the limb: the joint it lies past and the segment below it, with its bone. */
  limb?: { limb: string; joint: string; part: string; bone: string };
}

/**
 * The cut lines the assemble stage prints, one per plan part with cuts, in
 * the `pixels:` line's shape: `  cut: "<from>" opaque <before> = "<from>"
 * <kept> + "<into>" <taken> …`. Empty without cuts, so a config with none
 * prints what it printed before. With a cut of `under_fill: "colour"`
 * (issue #360) the filled count says how many of its pixels took the colour
 * only; without one the line is issue #193's.
 */
export function cutLines(cuts: readonly CutCount[]): string[] {
  const byFrom = new Map<string, CutCount[]>();
  for (const c of cuts) byFrom.set(c.from, [...(byFrom.get(c.from) ?? []), c]);
  return [...byFrom.entries()].map(([from, cs]) => {
    const colour = cs.some((c) => c.underFill === 'colour') ? ` (${cs.reduce((a, c) => a + (c.underFill === 'colour' ? (c.under ?? 0) : 0), 0)} colour only, at the alpha the cut removed)` : '';
    return (
      `  cut: "${from}" opaque ${cs[0].before} = "${from}" ${cs[0].kept} + ${cs.map((c) => `"${c.into}" ${c.taken}`).join(' + ')}; band ${cs.reduce((a, c) => a + c.band, 0)} px held by both` +
      (cs.some((c) => c.under !== undefined) ? `; under ${cs.reduce((a, c) => a + (c.under ?? 0), 0)} px filled${colour}, ${cs.reduce((a, c) => a + (c.underEmpty ?? 0), 0)} px left empty` : '') +
      cs.map((c) => (c.limb === undefined ? '' : `; "${c.into}" lies past joint "${c.limb.joint}" of limb "${c.limb.limb}", in the band of "${c.limb.part}" on bone "${c.limb.bone}"`)).join('')
    );
  });
}

/**
 * The box a cut's `under` image covers (issue #193): the polygon's bounding
 * box in rig pixels, its corners the polygon's least and greatest x and y —
 * the image is `x1 - x0` by `y1 - y0` and its pixel `(i, j)` is rig pixel
 * `(x0 + i, y0 + j)`. Every pixel the polygon holds lies in it: a pixel is
 * held by its centre, and the centres inside lie strictly between the
 * extreme vertices.
 */
export function underBox(polygon: ReadonlyArray<readonly [number, number]>): { x0: number; y0: number; w: number; h: number } {
  const xs = polygon.map((q) => q[0]);
  const ys = polygon.map((q) => q[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x0, y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

/**
 * Fill the base where a cut removed its pixels (issue #193). The removed
 * pixels are those the piece holds (alpha above 0) and the band does not —
 * the pixels the cut cleared in the base. At each, when the under image's
 * alpha is at least the alpha the cut removed there, the base takes the
 * image's pixel, colour and alpha (filled); otherwise the base stays cleared
 * there (left empty): a transparent pixel is the author's "nothing lies under
 * here", and a pixel less opaque than the layer was is not half-filled. That
 * is the only place the image is read: its pixels over the band, over pixels
 * the layer never had, and over the box outside the polygon change nothing.
 * `filled + empty` is the removed count.
 *
 * With `fill` `"colour"` (issue #360, `cuts[].under_fill`) the same pixels are
 * filled and left empty, and a filled pixel takes the image's colour at the
 * alpha the cut removed there instead of the image's alpha: the part's alpha
 * is the uncut layer's wherever the image fills, so its silhouette does not
 * grow over a soft edge an opaque image covers.
 */
export function fillUnder(base: Raster, piece: Raster, band: Mask, under: Raster, box: { x0: number; y0: number }, fill?: 'colour'): { filled: number; empty: number } {
  const W = base.width;
  let filled = 0;
  let empty = 0;
  for (let p = 0; p < W * base.height; p++) {
    const a = piece.data[p * 4 + 3];
    if (a === 0 || band.data[p] === 1) continue;
    const u = ((Math.floor(p / W) - box.y0) * under.width + (p % W) - box.x0) * 4;
    if (under.data[u + 3] < a) {
      empty++;
      continue;
    }
    if (fill === 'colour') {
      base.data.set(under.data.subarray(u, u + 3), p * 4);
      base.data[p * 4 + 3] = a;
    } else base.data.set(under.data.subarray(u, u + 4), p * 4);
    filled++;
  }
  return { filled, empty };
}

/**
 * A cut's band (issue #170, `overlap`): the polygon's pixels within `overlap`
 * rig px of its edge, distance read as Chebyshev distance — a pixel of the
 * polygon is in the band when the `(2 * overlap + 1)`-square centred on it
 * holds a pixel the polygon does not, i.e. the polygon's mask less its
 * `erode` by that square (`cv2.erode`'s border: the rig's edge is not the
 * polygon's edge). Empty at `overlap` 0. The base part keeps its pixels there
 * as well as the piece, so the piece's resampled edge has art under it.
 */
export function cutBand(polygonMask: Mask, overlap: number): Mask {
  const band = newMask(polygonMask.width, polygonMask.height);
  if (overlap === 0) return band;
  const inner = erode(polygonMask, 2 * overlap + 1);
  for (let p = 0; p < band.data.length; p++) band.data[p] = polygonMask.data[p] === 1 && inner.data[p] === 0 ? 1 : 0;
  return band;
}

/** One layer's part as the stage builds it, before it is placed: its key, pixels, projection figures, merge trace and, when the layer is cut, the rig pixels it owns. */
interface Built {
  key: string;
  r: Raster;
  st: ProjectionStats;
  extendKeys: string[];
  trace: MergeTrace;
  merged: number;
  /** The rig pixels this piece of the layer owns when the layer is cut, null when it is not: the counts are split by it. */
  region: Mask | null;
  /** The rig pixels on an upper limb segment whose alpha `edge: "feather"` scaled down (issue #444). */
  feathered?: Mask;
}

// ---------------------------------------------------------------------------
// limbs — a declared limb's parts cut at its joints (issue #349, src/limbs.ts)
// ---------------------------------------------------------------------------

/** One part a limb segment makes, in `config.limbs` order (limb, then segment). */
export interface LimbPart {
  limb: string;
  segment: number;
  part: string;
  /** The part whose pixels it takes. */
  of: string;
  /** Issue #446: true when this limb declares `split` and covers the other limb(s) taking `of`. */
  covering?: boolean;
  record: LimbRecord;
}

/** What the limbs did to one part they took: its opaque pixels and each segment's share (`limbLines`). */
export interface LimbCount {
  of: string;
  before: number;
  shares: Array<{ part: string; px: number }>;
  /** The joints whose cap this part's segments carry, in `config.limbs` order. */
  joints: Array<{
    limb: string;
    joint: string;
    part: string;
    upper: string;
    cap: CapRecord;
    /** Issue #557: the parts the lower and the upper segment take, the half-width about the joint, and the short pixels within it. */
    from?: string;
    upperFrom?: string;
    half?: number;
    shortInHalf?: number;
  }>;
}

/**
 * What `cut_band` did at a joint (issue #360, item 14), for the `limb cap:`
 * line: the line chosen — its offset from the joint line and a point it
 * passes through — the stroke pixels it crosses, those the joint line
 * crosses, and the split that made a pixel a stroke.
 */
function cutPhrase(k: CapRecord, upper: string, lower: string): string {
  const off = k.cut_offset ?? 0;
  const where = off === 0 ? 'on the joint line' : `${Math.abs(off)} px ${off < 0 ? `before the joint line (toward "${upper}")` : `past the joint line (toward "${lower}")`}`;
  const stroke =
    k.stroke_luma_max === undefined
      ? `no stroke: the ${k.band_px ?? 0} px of the limb's art the band's lines cross hold one luma, so nothing splits from it`
      : `stroke: luma ${k.stroke_luma_max} or below, the Otsu split of the ${k.band_px ?? 0} px of the limb's art the band's lines cross`;
  return `cut_band ${k.cut_band ?? 0}: the cut ${where}, through [${(k.cut_at ?? k.at).join(', ')}], crosses ${k.cut_crossed ?? 0} stroke px; the joint line crosses ${k.joint_crossed ?? 0} (${stroke})`;
}

/**
 * Issue #557: the `LINT` line of a short cap — one whose disc, on the upper
 * side of the cut, holds pixels no layer of the limb gives (`short_px`, by
 * side of the limb's axis: `left` where a pixel centre's offset across the
 * axis is 0 or above, the side toward smaller x when the limb hangs down the
 * rig, `right` the other) — naming the limb, the joint, the part, both
 * figures, the radius and what filled the rest; with the half-disc, how many
 * of them `cap_shape: "disc"` would keep. Null for a cap that is not short.
 */
export function shortCapLint(j: LimbCount['joints'][number]): string | null {
  const k = j.cap;
  if (k.short_px === undefined) return null;
  const n = k.short_px.left + k.short_px.right;
  const where =
    j.from === undefined || j.upperFrom === undefined || j.upperFrom === j.from
      ? `the layer of "${j.from ?? j.part}" has no pixel of the limb`
      : `neither the layer of "${j.from}" nor that of "${j.upperFrom}" has a pixel of the limb`;
  const filled = [
    ...(k.image_px === undefined ? [] : [`${k.image_px} px from ${k.image_layer === undefined ? 'the cap image' : `the hidden-art layer ${k.image_layer}`}`]),
    `${k.layer_px} px from "${j.part}"'s layer`,
    `${k.upper_px ?? 0} px from "${j.upper}"`,
  ].join(', ');
  const half = j.half ?? 0;
  const disc =
    k.shape === 'disc' || j.shortInHalf === undefined
      ? ''
      : j.shortInHalf === 0
        ? `; under cap_shape "disc" the disc is the half-width about the joint, ${half} px, and none of them lies within it`
        : `; under cap_shape "disc" the disc is the half-width about the joint, ${half} px, and ${j.shortInHalf} of them lie within it`;
  return (
    `  LINT "${j.part}" cap at [${k.at[0]}, ${k.at[1]}] (limb "${j.limb}", joint "${j.joint}", radius ${k.radius} px): short_px left ${k.short_px.left}, right ${k.short_px.right}: ` +
    `no layer gives them — ${n} px of the disc on the upper side of the cut, where ${where}; the rest of the disc is filled, ${filled}${disc}`
  );
}

/**
 * The lines `assemble` prints for the limbs (issue #349), one per part a limb
 * took — `  limb cut: "<of>" opaque <n> = "<part>" <px> + …` — and one per
 * joint, its cap's pixels by where they came from. Empty without limbs.
 */
export function limbLines(counts: readonly LimbCount[]): string[] {
  const out: string[] = [];
  for (const c of counts) {
    out.push(`  limb cut: "${c.of}" opaque ${c.before} = ${c.shares.map((q) => `"${q.part}" ${q.px}`).join(' + ')}`);
    for (const j of c.joints) {
      const k = j.cap;
      const base = k.image_px === undefined ? `${k.layer_px} px from the layer` : `${k.image_px} px from ${k.image_layer === undefined ? 'the cap image' : `the hidden-art layer ${k.image_layer}`}, ${k.layer_px} px from the layer`;
      // Issue #360: what cap_shape "disc" and edge "feather" did, said only when declared, so a limb without them prints what it did.
      // Issue #557: the half-disc says it only when the neighbouring segment gave a pixel, so a full cap prints what it printed.
      const from = k.upper_px === undefined ? base : `${base}, ${k.upper_px} px from "${j.upper}"`;
      const radius =
        k.shape === undefined
          ? `a disc of radius ${k.radius} px (the limb ${k.width} px across the joint line)`
          : `a disc of radius ${k.radius} px (cap_shape "disc": the joint's distance to the nearer side of the limb, ${k.width} px across the joint line)`;
      const shaped = [
        ...(k.edge === undefined ? [] : [`edge "feather": ${k.feathered_px ?? 0} px of "${j.upper}" faded across the ${k.feather_radius ?? 0} px about the joint that "${j.part}" covers at every turn`]),
        ...(k.cut_band === undefined ? [] : [cutPhrase(k, j.upper, j.part)]),
      ];
      const miss =
        k.missing_px === 0
          ? 'none missing'
          : `${k.missing_px} px missing — the layer has no pixel there (hidden in the painting, or past the limb's outline), and the tool invents none: paint them into a ${k.box[2]}x${k.box[3]} image whose pixel (i, j) is rig pixel (${k.box[0]} + i, ${k.box[1]} + j), and name it in the segment's "cap"`;
      out.push(
        `  limb cap: "${j.limb}" joint "${j.joint}" at [${k.at[0]}, ${k.at[1]}], on "${j.part}": ${radius}, box [${k.box.join(', ')}] — on the upper side of the line ${from}, ${miss}${shaped.map((q) => `; ${q}`).join('')}`,
      );
      const lint = shortCapLint(j);
      if (lint !== null) out.push(lint);
    }
  }
  return out;
}

/**
 * The draw order with the limbs in it (issue #349): each part a limb takes
 * leaves the order, and each limb's parts stand where its first segment's
 * part stood, lowest segment first (drawn behind), so the upper is drawn over
 * the lower at every joint; limbs whose first segment takes one part stand
 * there in `config.limbs` order (or with the `split` covering limb drawn in
 * front, issue #446). Without limbs, `order` as it was.
 */
export function limbOrder(order: readonly DrawSlot[], plan: readonly PlanEntry[], cuts: readonly Cut[], parts: readonly LimbPart[]): DrawSlot[] {
  if (parts.length === 0) return [...order];
  const nameOf = (d: DrawSlot): string | null => ('plan' in d ? plan[d.plan][0] : 'cut' in d ? cuts[d.cut].into : null);
  const taken = new Set(parts.map((q) => q.of));
  const out: DrawSlot[] = [];
  for (const d of order) {
    const n = nameOf(d);
    if (n === null || !taken.has(n)) {
      out.push(d);
      continue;
    }
    const limbs = [...new Set(parts.filter((q) => q.segment === 0 && q.of === n).map((q) => q.limb))].sort(
      (a, b) => (parts.some((q) => q.limb === a && q.of === n && q.covering === true) ? 1 : 0) - (parts.some((q) => q.limb === b && q.of === n && q.covering === true) ? 1 : 0),
    );
    for (const l of limbs) {
      const mine = parts.map((q, i) => ({ q, i })).filter(({ q }) => q.limb === l);
      for (const { i } of [...mine].reverse()) out.push({ limb: i });
    }
  }
  return out;
}

/** The point a joint line moved `offset` px along its axis passes through, to 3 places (issue #360, `cut_band`). */
function shiftedAt(line: JointLine, offset: number): [number, number] {
  return [pyRound(line.at[0] + offset * line.axis[0], 3), pyRound(line.at[1] + offset * line.axis[1], 3)];
}

/**
 * Issue #564: where an `assemble.cuts` entry from a part a limb takes lies
 * against that limb. The segments of a limb that take the part are a run
 * `k0 .. k1` (`CONFIG_LIMB_FROM_RUN` keeps them consecutive), and the run's
 * pixels lie between two joint lines: the line of the joint above `k0` when
 * `k0` sits below one (a joint between two layers), and the line of the joint
 * below `k1` when a segment follows it (the ankle under a shin that takes the
 * legwear). A pixel the cut takes (alpha above 0 in its piece) is outside the
 * run when it lies past the lower line, or not past the upper line and — read
 * after the limbs are cut, with `caps` — outside the disc of that joint's cap,
 * which the run's own layer fills there first. Anything else lies in a
 * segment's band, and the cut is refused: the pixels would leave a segment
 * that holds them, and the bend would open where the layer was cut. Every
 * limb taking the part is read. `past` is the segment a taken pixel lies in
 * when every one lies past the lower line — the one below that joint, or
 * below the deepest joint line all of them are past — and is what the `cut:`
 * line names. Without `caps` the lines alone are read; with them only the
 * discs, for the pixels the lines let through.
 */
function limbBands(
  cuts: readonly Cut[],
  pieces: ReadonlyArray<Built | null>,
  limbs: Readonly<Record<string, Limb>>,
  bones: readonly BoneEntry[],
  W: number,
  H: number,
  caps: ((limb: string, segment: number) => CapRecord | undefined) | null,
): { problems: Problem[]; past: Map<number, { limb: string; joint: string; part: string; bone: string }> } {
  const problems: Problem[] = [];
  const past = new Map<number, { limb: string; joint: string; part: string; bone: string }>();
  const places = bonePlaces(bones);
  const lineAbove = (l: string, k: number): JointLine | null => {
    const segs = limbs[l].segments;
    const up = places.get(segs[k - 1].bone);
    const me = places.get(segs[k].bone);
    if (up === undefined || me === undefined) return null;
    const end = me.end ?? (k + 1 < segs.length ? (places.get(segs[k + 1].bone)?.at ?? null) : null);
    return jointLine(up.at, me.at, end);
  };
  const fmt = (q: readonly number[]): string => `[${q.map((n) => pyRound(n, 3)).join(', ')}]`;
  cuts.forEach((q, i) => {
    const piece = pieces[i];
    if (piece === null) return;
    const taken: number[] = [];
    for (let p = 0; p < W * H; p++) if (piece.r.data[p * 4 + 3] > 0) taken.push(p);
    for (const l of Object.keys(limbs)) {
      const segs = limbs[l].segments;
      const k0 = segs.findIndex((sg) => sg.from === q.from);
      if (k0 < 0) continue;
      let k1 = k0;
      while (k1 + 1 < segs.length && segs[k1 + 1].from === q.from) k1++;
      const upper = k0 > 0 ? lineAbove(l, k0) : null;
      const lower = k1 + 1 < segs.length ? lineAbove(l, k1 + 1) : null;
      // A joint with no line is ASSEMBLE_LIMB_JOINT, refused by cutLimbs by name; nothing is read about it here.
      if ((k0 > 0 && upper === null) || (k1 + 1 < segs.length && lower === null)) continue;
      const cap = caps === null || upper === null ? undefined : caps(l, k0);
      const inside: number[] = [];
      let below = 0;
      for (const p of taken) {
        const x = p % W;
        const y = Math.floor(p / W);
        if (lower !== null && pastJoint(lower, x, y)) {
          below++;
          continue;
        }
        if (upper !== null && !pastJoint(upper, x, y)) {
          if (caps === null || cap === undefined || !inDisc(cap.at, cap.radius, x, y)) continue;
        } else if (caps !== null) continue;
        inside.push(p);
      }
      const object = `config.assemble.cuts[${i}] (part "${q.into}")`;
      const wanted = [
        ...(lower === null ? [] : [`past joint "${String(segs[k1 + 1].joint)}"'s line (through ${fmt(lower.at)}, axis ${fmt(lower.axis)})`]),
        ...(upper === null ? [] : [`before joint "${String(segs[k0].joint)}"'s line (through ${fmt(upper.at)}, axis ${fmt(upper.axis)})${cap === undefined ? '' : ` and outside its cap's disc, radius ${cap.radius} px about ${fmt(cap.at)}`}`]),
      ];
      if (inside.length > 0) {
        const f = inside[0];
        const fx = f % W;
        const fy = Math.floor(f / W);
        let k = k0;
        if (caps === null) {
          for (let ln = k < k1 ? lineAbove(l, k + 1) : null; ln !== null && pastJoint(ln, fx, fy); ln = k < k1 ? lineAbove(l, k + 1) : null) k++;
        }
        const band =
          caps !== null
            ? `the cap of joint "${String(segs[k0].joint)}" on "${segs[k0].part}" (radius ${(cap as CapRecord).radius} px about ${fmt((cap as CapRecord).at)}), which "${q.from}"'s pixels fill there`
            : `the band of "${segs[k].part}"${k > 0 ? ` below joint "${String(segs[k].joint)}"` : ''}${k + 1 < segs.length ? `${k > 0 ? ' and' : ''} above joint "${String(segs[k + 1].joint)}"` : ' to the limb\'s end'}`;
        problems.push({
          code: 'ASSEMBLE_CUT_CROSSES_LIMB',
          object,
          detail: `takes ${inside.length} of its ${taken.length} pixel(s) of "${q.from}" inside limb "${l}", the first at ${fx},${fy}, in ${band}; "${q.from}" is the layer config.limbs.${l} cuts at its joints, and a cut from it may lie only where no segment of the limb holds it — every pixel it takes ${wanted.length === 0 ? `outside the limb, and the limb has no joint before or past its segments that take "${q.from}" (they are all of it), so no pixel is` : wanted.join(', or ')} is required: move the polygon, or give the pixels to a segment of the limb instead`,
        });
      } else if (caps === null && lower !== null && below === taken.length && taken.length > 0) {
        let j = k1 + 1;
        for (let ln = j + 1 < segs.length ? lineAbove(l, j + 1) : null; ln !== null && taken.every((p) => pastJoint(ln as JointLine, p % W, Math.floor(p / W))); ln = j + 1 < segs.length ? lineAbove(l, j + 1) : null) j++;
        if (!past.has(i)) past.set(i, { limb: l, joint: String(segs[j].joint), part: segs[j].part, bone: segs[j].bone });
      }
    }
  });
  return { problems, past };
}

/**
 * Cut every declared limb (module comment of `src/limbs.ts`): each part a limb
 * takes is split among the limbs that take it (nearest polyline), then each
 * limb's share among its segments (the joint lines), and each segment below a
 * joint gets its cap. Every refusal is collected and thrown at once:
 * `ASSEMBLE_LIMB_TAKES` (a limb takes a part with no pixel), `ASSEMBLE_LIMB_JOINT`
 * (no joint line: the upper bone has no length, or the limb folds back on
 * itself), `ASSEMBLE_LIMB_JOINT_ON_ART` (the joint is not on the limb's art,
 * so it has no width), `ASSEMBLE_LIMB_PIXELS` (a segment gets no opaque
 * pixel), `ASSEMBLE_LIMB_CAP_PRESENT`, `ASSEMBLE_LIMB_CAP_SIZE` and
 * `ASSEMBLE_LIMB_CAP_EMPTY` (a cap image the caller did not hand over, not the
 * box's size, or transparent over every cap pixel).
 */
function cutLimbs(
  limbs: Readonly<Record<string, Limb>>,
  bones: readonly BoneEntry[],
  caps: ReadonlyMap<string, Raster>,
  W: number,
  H: number,
  builtOf: (name: string) => Built | null,
  opaqueOf: (r: Raster) => number,
  mergedIn: (b: Built, region: Mask) => number,
  count: (m: Mask | null, region: Mask) => number,
  hiddenOf: (part: string) => HiddenArt | null = () => null,
  readHidden: (layer: string, by: string) => void = () => undefined,
): { parts: LimbPart[]; pieces: Built[]; counts: LimbCount[] } {
  const names = Object.keys(limbs);
  if (names.length === 0) return { parts: [], pieces: [], counts: [] };
  const problems: Problem[] = [];
  const places = bonePlaces(bones);
  const parts: LimbPart[] = [];
  for (const l of names) {
    const covering = limbs[l].split !== undefined;
    limbs[l].segments.forEach((sg, k) =>
      parts.push({ limb: l, segment: k, part: sg.part, of: sg.from, ...(covering ? { covering: true } : {}), record: { name: l, segment: k, of: sg.from, bone: sg.bone, ...(k === 0 ? {} : { joint: sg.joint as string, ...(sg.range === undefined ? {} : { range: [sg.range[0], sg.range[1]] as [number, number] }) }) } }),
    );
  }
  const polylines = new Map(names.map((l) => [l, limbPolyline(limbs[l], places)]));
  // The joint line above each segment (null above the first).
  const lines = new Map<string, Array<JointLine | null>>();
  for (const l of names) {
    const segs = limbs[l].segments;
    lines.set(
      l,
      segs.map((sg, k) => {
        if (k === 0) return null;
        const up = places.get(segs[k - 1].bone) as BonePlace;
        const me = places.get(sg.bone) as BonePlace;
        const end = me.end ?? (k + 1 < segs.length ? (places.get(segs[k + 1].bone) as BonePlace).at : null);
        const line = jointLine(up.at, me.at, end);
        if (line === null) {
          problems.push({
            code: 'ASSEMBLE_LIMB_JOINT',
            object: `config.limbs.${l}.segments[${k}] (joint "${String(sg.joint)}")`,
            detail: `has no joint line: "${segs[k - 1].bone}" at [${up.at.join(', ')}] and "${sg.bone}" at [${me.at.join(', ')}]${end === null ? '' : ` ending at [${end.join(', ')}]`} ${up.at[0] === me.at[0] && up.at[1] === me.at[1] ? 'stand on one point, so the upper bone has no direction' : 'point straight back at each other, so the two directions cancel'}; bones that give the limb an axis at the joint are required`,
          });
        }
        return line;
      }),
    );
  }
  refuseIfAny(problems);
  // The line each segment's pixels are split by: the joint line, or where cut_band placed the cut (issue #360).
  const cutLines = new Map([...lines].map(([l, ls]) => [l, [...ls]]));
  const placements = new Map<string, Extract<CutPlacement, { ok: true }>>();
  // Each part a limb takes, in the order the limbs first take them.
  const sources = [...new Set(parts.map((q) => q.of))];
  const pieces: Array<Built | null> = parts.map(() => null);
  const rasters = parts.map(() => newRaster(W, H));
  const regions = parts.map(() => newMask(W, H));
  /** For each part taken, which limb (index into names) owns each pixel, -1 where it has none. */
  const owners = new Map<string, Int32Array>();
  const counts: LimbCount[] = [];
  for (const src of sources) {
    const b = builtOf(src);
    if (b === null) continue;
    const on = names.filter((l) => limbs[l].segments.some((sg) => sg.from === src));
    const own = new Int32Array(W * H).fill(-1);
    const before = opaqueOf(b.r);
    if (before === 0) {
      problems.push({ code: 'ASSEMBLE_LIMB_TAKES', object: `part "${src}" (config.limbs.${on[0]})`, detail: 'has no opaque pixel to cut; a part with art is required — the limb takes its pixels' });
      continue;
    }
    const lns = on.map((l) => polylines.get(l) as Array<[number, number]>);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (b.r.data[p * 4 + 3] === 0) continue;
        own[p] = names.indexOf(on[on.length === 1 ? 0 : nearestLimb(lns, x, y)]);
      }
    }
    // Issue #446: when a covering limb on `src` declares `split` (`line` or `edge: "painting"`), reassign `own` so
    // the covering limb's pixels across the crossing stay on the covering limb and the seam follows the declared split.
    const coverLimb = on.find((l) => limbs[l].split !== undefined);
    if (coverLimb !== undefined && on.length >= 2) {
      const coverIdx = names.indexOf(coverLimb);
      const underNames = on.filter((l) => l !== coverLimb);
      const underIndices = underNames.map((l) => names.indexOf(l));
      const underPolys = underNames.map((l) => polylines.get(l) as Array<[number, number]>);
      assignCrossedLimbs(coverIdx, polylines.get(coverLimb) as Array<[number, number]>, limbs[coverLimb].split as NonNullable<Limb['split']>, underIndices, underPolys, b.r, OPAQUE_ALPHA_ABOVE, own);
    }
    // Issue #360 (item 14): each joint of this part that declares cut_band has its cut placed, on the limb's own art.
    for (const l of on) {
      const li = names.indexOf(l);
      limbs[l].segments.forEach((sg, k) => {
        if (k === 0 || sg.cut_band === undefined || sg.from !== src || limbs[l].segments[k - 1].from !== src) return;
        const line = (lines.get(l) as Array<JointLine | null>)[k] as JointLine;
        const art = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && own[y * W + x] === li && b.r.data[(y * W + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE;
        const luma = (x: number, y: number): number => luma601(b.r.data[(y * W + x) * 4], b.r.data[(y * W + x) * 4 + 1], b.r.data[(y * W + x) * 4 + 2]);
        // The joint line on no art is ASSEMBLE_LIMB_JOINT_ON_ART at the caps; nothing is placed about it.
        if (limbRun(line, art, [0, 0, W - 1, H - 1]) === null) return;
        const placed = placeCut(line, sg.cut_band, art, luma, [0, 0, W - 1, H - 1]);
        if (!placed.ok) {
          problems.push({
            code: 'ASSEMBLE_LIMB_CUT_BAND',
            object: `config.limbs.${l}.segments[${k}] (joint "${String(sg.joint)}", part "${sg.part}").cut_band`,
            detail: `is ${sg.cut_band}, and the line ${Math.abs(placed.offset)} px ${placed.offset < 0 ? 'before' : 'past'} the joint line, through [${shiftedAt(line, placed.offset).join(', ')}], crosses none of the limb's art within 1 px of that point — the band reaches past the limb there, and a cut placed off the art is no cut; a band whose every line crosses the limb is required — ${Math.abs(placed.offset) > 1 ? `cut_band ${Math.abs(placed.offset) - 1} or less` : 'leave cut_band out'}`,
          });
          return;
        }
        (cutLines.get(l) as Array<JointLine | null>)[k] = placed.line;
        placements.set(`${l}/${k}`, placed);
      });
    }
    const segOverride = new Int32Array(W * H).fill(-1);
    const segAt = (l: string, x: number, y: number): number => {
      const segs = limbs[l].segments;
      const first = segs.findIndex((sg) => sg.from === src);
      let last = first;
      while (last + 1 < segs.length && segs[last + 1].from === src) last++;
      return segmentOf(cutLines.get(l) as Array<JointLine | null>, first, last, x, y);
    };
    // Issue #400: when two forearm segments share `src` and their hand regions overlap, the overlap goes to the front
    // piece (the limb later in config.limbs) in one piece, and the back piece ends at its cuff.
    const forearms = on.flatMap((l) => {
      const li = names.indexOf(l);
      return limbs[l].segments.flatMap((sg, k) => {
        if (k === 0 || sg.joint !== 'elbow' || sg.from !== src) return [];
        const me = places.get(sg.bone) as BonePlace;
        return me.end === null ? [] : [{ limb: li, seg: k, elbow: me.at, wrist: me.end, isSeg: (x: number, y: number): boolean => segAt(l, x, y) === k }];
      });
    });
    for (let i = 0; i < forearms.length; i++) {
      for (let j = i + 1; j < forearms.length; j++) {
        assignOverlappingHands(forearms[i], forearms[j], W, H, own, segOverride);
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (b.r.data[p * 4 + 3] === 0) continue;
        const l = names[own[p]];
        const k = segOverride[p] >= 0 ? segOverride[p] : segAt(l, x, y);
        const at = parts.findIndex((q) => q.limb === l && q.segment === k);
        rasters[at].data.set(b.r.data.subarray(p * 4, p * 4 + 4), p * 4);
        if (b.region === null || b.region.data[p] === 1) regions[at].data[p] = 1;
      }
    }
    owners.set(src, own);
    const shares = parts.map((q, i) => ({ q, i })).filter(({ q }) => q.of === src);
    const counted = shares.map(({ q, i }) => ({ part: q.part, px: opaqueOf(rasters[i]) }));
    const sum = counted.reduce((a, c) => a + c.px, 0);
    if (sum !== before) {
      problems.push({ code: 'ASSEMBLE_COUNTS_ADD_UP', object: `part "${src}" (config.limbs)`, detail: `opaque px: ${before} before the limbs, ${sum} over their parts; equal is required (a bug in the assembler, not in the inputs)` });
    }
    for (const { q, i } of shares) {
      pieces[i] = { ...b, r: rasters[i], region: regions[i], merged: mergedIn(b, regions[i]) };
      if (count(regions[i], regions[i]) === 0 && opaqueOf(rasters[i]) === 0) {
        problems.push({
          code: 'ASSEMBLE_LIMB_PIXELS',
          object: `config.limbs.${q.limb}.segments[${q.segment}] (part "${q.part}")`,
          detail: `takes 0 of "${src}"'s ${before} opaque pixel(s); a segment with art is required — the joint lines through the bones' origins put none of the limb's pixels on this segment, or another limb's polyline lies nearer every one: move the bones onto the limb's art`,
        });
      }
    }
    counts.push({ of: src, before, shares: counted, joints: [] });
  }
  refuseIfAny(problems);
  // The caps, after every part is split, so a cap reads the limb's art in the layer as the painting has it.
  for (const l of names) {
    const segs = limbs[l].segments;
    segs.forEach((sg, k) => {
      if (k === 0) return;
      const line = (lines.get(l) as Array<JointLine | null>)[k] as JointLine;
      const li = names.indexOf(l);
      const upFrom = segs[k - 1].from;
      const art = (x: number, y: number): boolean => {
        if (x < 0 || y < 0 || x >= W || y >= H) return false;
        const p = y * W + x;
        for (const src of new Set([upFrom, sg.from])) {
          const b = builtOf(src);
          if (b !== null && owners.get(src)?.[p] === li && b.r.data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE) return true;
        }
        return false;
      };
      const sharedArt = (x: number, y: number): boolean => {
        if (x < 0 || y < 0 || x >= W || y >= H) return false;
        const p = y * W + x;
        for (const src of new Set([upFrom, sg.from])) {
          const b = builtOf(src);
          if (b !== null && b.r.data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE) return true;
        }
        return false;
      };
      const hasCoverSplit = names.some((other) => other !== l && limbs[other].split !== undefined && limbs[other].segments.some((osg) => osg.from === upFrom || osg.from === sg.from));
      const object = `config.limbs.${l}.segments[${k}] (joint "${String(sg.joint)}", part "${sg.part}")`;
      const run = limbRun(line, art, [0, 0, W - 1, H - 1]) ?? (hasCoverSplit ? limbRun(line, sharedArt, [0, 0, W - 1, H - 1]) : null);
      if (run === null) {
        problems.push({
          code: 'ASSEMBLE_LIMB_JOINT_ON_ART',
          object,
          detail: `the joint, "${sg.bone}"'s origin at [${line.at.join(', ')}], lies on none of the limb's art within 1 px along its joint line (${offLineFigure(nearestOnLine(line, art, [0, 0, W - 1, H - 1]))}), so the limb has no width there to size the cap by; a bone origin on the limb's art (alpha above ${OPAQUE_ALPHA_ABOVE}) is required — move the bone onto the joint`,
        });
        return;
      }
      // The width to 3 places (src/round.ts): a measured length, and a radius the line and the record print as read.
      const w3 = pyRound(run[1] - run[0] + 1, 3);
      // Issue #360: under cap_shape "disc" the radius is the half-width about the joint (src/limbs.ts), to 3 places as well.
      const disc = sg.cap_shape === 'disc';
      const half = halfWidthAbout(run);
      if (disc && half <= 0) {
        problems.push({
          code: 'ASSEMBLE_LIMB_JOINT_ON_ART',
          object,
          detail: `the joint, "${sg.bone}"'s origin at [${line.at.join(', ')}], lies on the edge of the limb's art along its joint line — the run of art reaches ${pyRound(run[1] + 0.5, 3)} px from it one way and ${pyRound(0.5 - run[0], 3)} px the other — so cap_shape "disc" has no half-width about it; a bone origin inside the limb's art is required — move the bone onto the joint`,
        });
        return;
      }
      const radius = disc ? pyRound(half, 3) : w3 / 2;
      const box = capBox(line.at, radius);
      const at = parts.findIndex((q) => q.limb === l && q.segment === k);
      const upAt = parts.findIndex((q) => q.limb === l && q.segment === k - 1);
      const upper = rasters[upAt];
      // Issue #359: the lower segment's part's hidden-art layer is its cap when the segment names no cap image; with one named, a refusal.
      const hidden = hiddenOf(sg.from);
      if (hidden !== null && sg.cap !== undefined) {
        problems.push({ code: 'ASSEMBLE_HIDDEN_ONE_SOURCE', object: `${object}.cap`, detail: `names ${sg.cap}, and "${sg.from}" also has the hidden-art layer ${hidden.layer}; one source of the cap's art is required — remove cap, or the hidden-art layer` });
        return;
      }
      const img = sg.cap === undefined ? (hidden === null ? null : boxOf(hidden.raster, box[0], box[1], box[2], box[3])) : (caps.get(`${l}/${k}`) ?? null);
      if (sg.cap !== undefined && img === null) {
        problems.push({ code: 'ASSEMBLE_LIMB_CAP_PRESENT', object: `${object}.cap`, detail: `names ${sg.cap}, and no image was handed to the stage for it; the decoded PNG is required (a caller of assemble() reads the file)` });
        return;
      }
      if (img !== null && (img.width !== box[2] || img.height !== box[3])) {
        problems.push({
          code: 'ASSEMBLE_LIMB_CAP_SIZE',
          object: `${object}.cap`,
          detail: `${String(sg.cap)} is ${img.width}x${img.height}; the cap's box is ${box[2]}x${box[3]} at ${box[0]},${box[1]} (the pixels within ${radius} px of the joint, in rig pixels), and an image of exactly that size is required — its pixel (i, j) is rig pixel (${box[0]} + i, ${box[1]} + j)`,
        });
        return;
      }
      const lower = rasters[at];
      const lowerSrc = builtOf(sg.from) as Built;
      // Issue #360 (cut_band): the cap's pixels are the disc's on the upper side of the cut, wherever it was placed.
      const cut = (cutLines.get(l) as Array<JointLine | null>)[k] as JointLine;
      const placed = placements.get(`${l}/${k}`);
      const ownLower = owners.get(sg.from) as Int32Array;
      let layerPx = 0;
      let imagePx = 0;
      let upperPx = 0;
      let missing = 0;
      // Issue #557: the cap's shortfall by side of the limb's axis (left: across >= 0), and how much of it lies within
      // the half-width about the joint, the disc cap_shape "disc" would keep.
      let shortLeft = 0;
      let shortRight = 0;
      let shortInHalf = 0;
      for (let y = Math.max(0, box[1]); y < Math.min(H, box[1] + box[3]); y++) {
        for (let x = Math.max(0, box[0]); x < Math.min(W, box[0] + box[2]); x++) {
          if (!inDisc(line.at, radius, x, y) || pastJoint(cut, x, y)) continue;
          const p = y * W + x;
          const u = img === null ? -1 : ((y - box[1]) * img.width + (x - box[0])) * 4;
          if (img !== null && img.data[u + 3] > 0) {
            lower.data.set(img.data.subarray(u, u + 4), p * 4);
            imagePx++;
          } else if (ownLower[p] === li && lowerSrc.r.data[p * 4 + 3] > 0) {
            lower.data.set(lowerSrc.r.data.subarray(p * 4, p * 4 + 4), p * 4);
            layerPx++;
          } else if (upper.data[p * 4 + 3] > 0) {
            // Issue #360: the disc is filled from the art — the upper segment's, where the lower's layer has none.
            // Issue #557: under either shape — the half-disc too takes the neighbouring segment's pixels, so a cap is
            // short only where no layer of the limb gives a pixel.
            lower.data.set(upper.data.subarray(p * 4, p * 4 + 4), p * 4);
            upperPx++;
          } else {
            missing++;
            if (jointOffsets(line, x, y).across >= 0) shortLeft++;
            else shortRight++;
            if (inDisc(line.at, half, x, y)) shortInHalf++;
          }
        }
      }
      if (img !== null && imagePx === 0 && hidden === null) {
        problems.push({ code: 'ASSEMBLE_LIMB_CAP_EMPTY', object: `${object}.cap`, detail: `${String(sg.cap)} is transparent over every one of the cap's pixels; an image that gives at least one is required — to keep the layer's cap, drop cap` });
        return;
      }
      // Issue #360: under edge "feather", the upper piece fades out across the cap, over the lower's opaque pixels only.
      let featheredPx = 0;
      let band = 0;
      if (sg.edge === 'feather') {
        const upperRegion = regions[upAt];
        const upPiece = pieces[upAt] as Built;
        const featheredMask = (upPiece.feathered ??= newMask(W, H));
        band = pyRound(Math.max(0, coveredRadius(line.at, radius, (x, y) => x >= 0 && y >= 0 && x < W && y < H && lower.data[(y * W + x) * 4 + 3] === 255)), 3);
        const fb = capBox(line.at, band);
        for (let y = Math.max(0, fb[1]); y < Math.min(H, fb[1] + fb[3]); y++) {
          for (let x = Math.max(0, fb[0]); x < Math.min(W, fb[0] + fb[2]); x++) {
            if (band === 0 || !inDisc(line.at, band, x, y) || pastJoint(cut, x, y)) continue;
            const p = y * W + x;
            const ua = upper.data[p * 4 + 3];
            if (ua === 0) continue;
            const o = jointOffsets(line, x, y);
            const na = Math.floor(ua * featherWeight(band, o.along, o.across, placed?.offset ?? 0) + 0.5);
            if (na === ua) continue;
            if (na === 0) upper.data.fill(0, p * 4, p * 4 + 4);
            else upper.data[p * 4 + 3] = na;
            // Issue #444: a pixel the feather ramp fades to alpha <= OPAQUE_ALPHA_ABOVE is no longer opaque on the
            // upper piece (its opacity is carried by the lower segment's opaque cap beneath), so it leaves the upper
            // piece's region and its remaining ramp is marked feathered so pushBackFringe does not clear the fade.
            if (na <= OPAQUE_ALPHA_ABOVE) upperRegion.data[p] = 0;
            else featheredMask.data[p] = 1;
            featheredPx++;
          }
        }
      }
      const cap: CapRecord = {
        at: [line.at[0], line.at[1]],
        width: w3,
        radius,
        box,
        layer_px: layerPx,
        ...(img === null ? {} : { image_px: imagePx }),
        ...(hidden === null ? {} : { image_layer: hidden.layer }),
        missing_px: missing,
        ...(missing === 0 ? {} : { short_px: { left: shortLeft, right: shortRight } }),
        ...(disc ? { shape: 'disc' as const, upper_px: upperPx } : upperPx === 0 ? {} : { upper_px: upperPx }),
        ...(sg.edge === 'feather' ? { edge: 'feather' as const, feather_radius: band, feathered_px: featheredPx } : {}),
        ...(placed === undefined
          ? {}
          : {
              cut_band: sg.cut_band as number,
              cut_offset: placed.offset,
              cut_at: shiftedAt(line, placed.offset),
              cut_crossed: placed.crossed,
              joint_crossed: placed.jointCrossed,
              band_px: placed.bandPx,
              ...(placed.strokeLumaMax === null ? {} : { stroke_luma_max: placed.strokeLumaMax }),
            }),
      };
      if (hidden !== null) readHidden(hidden.layer, `config.limbs.${l}.segments[${k}].cap (part "${sg.part}")`);
      parts[at].record.cap = cap;
      const c = counts.find((q) => q.of === sg.from);
      if (c !== undefined) c.joints.push({ limb: l, joint: String(sg.joint), part: sg.part, upper: segs[k - 1].part, cap, from: sg.from, upperFrom: upFrom, half: pyRound(half, 3), shortInHalf });
    });
  }
  refuseIfAny(problems);
  return { parts, pieces: pieces as Built[], counts };
}

// ---------------------------------------------------------------------------
// the stage
// ---------------------------------------------------------------------------

export interface AssembleResult {
  parts: PartsFile;
  /** In plan order, each cropped to its record's box. */
  images: PlacedPart[];
  recomposite: Raster;
  /** `recompositeErrorMap`: uncovered error pixels red, covered ones blue, the painting dimmed grey. */
  errorMap: Raster;
  /** Under `config.scene` (issue #242), the figure the recomposite was read inside ({@link figureImage}); null otherwise. */
  figure: Raster | null;
  figures: RecompositeFigures;
  /** What each `assemble.cuts` entry took, counted when it was made (`cutLines`); empty without cuts. */
  cuts: CutCount[];
  /** What each `config.limbs` limb cut, per part it took and per joint (`limbLines`); empty without limbs (issue #349). */
  limbs: LimbCount[];
  /** The full-run layers the plan does not take from the full run whose uncovered error holds a body (`uncoveredErrorLayers`); empty otherwise. */
  uncovered: UncoveredErrorLayer[];
  /** The partition of uncovered error pixels into no-layer and on-a-layer components (`holeKinds`, issue #351). */
  holeKinds: HoleKinds;
  /** The parts whose `DRIFT_LIMIT` refusals hold a body another part holds in the draw order (`driftBodies`), in draw order; empty otherwise. */
  drift: DriftBodies[];
  /** Every hidden-art layer of the runs read (issue #359) and what read it (`hiddenLines`); empty when the runs hold none. */
  hidden: HiddenArtUse[];
  seamRule: SeamRule;
  projectRule: ProjectRule;
  /** Issue #492: head-canvas pixels filled by `config.assemble.head_face_underfill: true` when > 0. */
  headFaceUnderfillPx?: number;
}

/** A hidden-art layer of a run (issue #359) and what read it: `cuts[i].under`, or a limb segment's cap; none is said. */
export interface HiddenArtUse {
  /** `<run>:<layer>:hidden`. */
  layer: string;
  readBy: string[];
}

/** A part's hidden art in rig space (issue #359): the layer's `<run>:<name>`, and the layer warped as its run's layers are. */
interface HiddenArt {
  layer: string;
  raster: Raster;
}

/**
 * The hidden art each part may read (issue #359, `HIDDEN_SUFFIX` in
 * `src/tags.ts`), by part name: a plan part takes the hidden-art layer of
 * the layer its row takes, from the same run, and a cut's piece takes its
 * base's. The layer is placed and warped into the rig exactly as its run's
 * drawn layers are (`placeLayer`, `layerToRig`) — no ghost clean-up, because
 * it is the artist's own art, not See-through's.
 */
export function hiddenArtByPart(plan: readonly PlanEntry[], cuts: readonly Cut[], sets: { full: LayerSet; head: LayerSet }, frame: Frame, resolution: number): Map<string, HiddenArt> {
  const out = new Map<string, HiddenArt>();
  const warped = new Map<string, HiddenArt>();
  for (const [name, run, tag] of plan) {
    const h = sets[run].hidden.find((x) => x.of === tag);
    if (h === undefined) continue;
    const key = `${run}:${h.name}`;
    let art = warped.get(key);
    if (art === undefined) {
      art = { layer: key, raster: layerToRig(placeLayer(h, resolution), frame, run) };
      warped.set(key, art);
    }
    out.set(name, art);
  }
  for (const q of cuts) {
    const art = out.get(q.from);
    if (art !== undefined) out.set(q.into, art);
  }
  return out;
}

/** `r`'s pixels over the box `[x0, y0, w, h]`, transparent where the box reaches past `r`. */
function boxOf(r: Raster, x0: number, y0: number, w: number, h: number): Raster {
  const out = newRaster(w, h);
  for (let y = 0; y < h; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= r.height) continue;
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      if (sx < 0 || sx >= r.width) continue;
      out.data.set(r.data.subarray((sy * r.width + sx) * 4, (sy * r.width + sx) * 4 + 4), (y * w + x) * 4);
    }
  }
  return out;
}

/**
 * One line per hidden-art layer (issue #359), in the runs' order:
 * `  hidden art: full:topwear:hidden -> cuts[0].under (part "tail")`, or,
 * read by nothing, the two places that would read it. No line when the runs
 * hold none, so an input without one prints what it printed before.
 */
export function hiddenLines(uses: readonly HiddenArtUse[]): string[] {
  return uses.map((u) =>
    u.readBy.length > 0
      ? `  hidden art: ${u.layer} -> ${u.readBy.join(', ')}`
      : `  hidden art: ${u.layer} -> read by nothing: no cut takes a piece of its layer's part and no limb segment below a joint takes that part, so it fills no under and no cap`,
  );
}

function tagsOf(set: LayerSet): Set<string> {
  return new Set(set.layers.map((l) => l.name));
}

/**
 * Refuse, by name, every plan and extend entry whose tag its run does not
 * hold. Collected before any pixel work.
 */
export function checkPlanAgainstRuns(plan: PlanEntry[], extend: Extend[], full: LayerSet, head: LayerSet): void {
  const tags = { full: tagsOf(full), head: tagsOf(head) };
  const problems: Problem[] = [];
  const known = (run: Run): string => [...tags[run]].sort().join(', ');
  plan.forEach(([name, run, tag], i) => {
    if (!tags[run].has(tag)) {
      problems.push({
        code: 'ASSEMBLE_PLAN_TAG_IN_RUN',
        object: `config.assemble.plan[${i}] (part "${name}")`,
        detail: `takes ${run}:${tag}; the ${run} run has no layer "${tag}" — it holds ${known(run)}`,
      });
    }
  });
  extend.forEach((e, i) => {
    if (!tags[e.run].has(e.tag)) {
      problems.push({
        code: 'ASSEMBLE_EXTEND_TAG_IN_RUN',
        object: `config.assemble.extend_below_crop[${i}] (part "${e.part}")`,
        detail: `takes ${e.run}:${e.tag}; the ${e.run} run has no layer "${e.tag}" — it holds ${known(e.run)}`,
      });
    }
  });
  refuseIfAny(problems);
}

/**
 * What a single run (issue #359, no `--head`) is held to, every refusal at
 * once:
 *
 * - `ASSEMBLE_SINGLE_RUN_FACE`: the run holds no layer with an opaque pixel
 *   for one of {@link SINGLE_RUN_FACE_TAGS} — the parts the head run exists
 *   to separate. One problem per tag missing.
 * - `ASSEMBLE_SINGLE_RUN_PLAN`: a plan row takes the head run, or an
 *   `extend_below_crop` entry continues a part below a head crop. There is
 *   no head run and no crop; every row takes `full`.
 *
 * `plan` and `extend` are null for `--propose-plan`, which writes them.
 */
export function checkSingleRun(full: LayerSet, plan: readonly PlanEntry[] | null, extend: readonly Extend[] | null): void {
  const problems: Problem[] = [];
  for (const tag of SINGLE_RUN_FACE_TAGS) {
    const l = full.layers.find((x) => x.name === tag);
    if (l === undefined || l.opaquePx === 0) {
      problems.push({
        code: 'ASSEMBLE_SINGLE_RUN_FACE',
        object: `the full run (${full.source})`,
        detail: `${l === undefined ? `holds no layer "${tag}"` : `holds a layer "${tag}" with no opaque pixel (alpha above ${OPAQUE_ALPHA_ABOVE})`}; with no --head, one run must hold the face parts — ${SINGLE_RUN_FACE_TAGS.join(', ')}, each painted — or a head run (--head) is required`,
      });
    }
  }
  (plan ?? []).forEach(([name, run], i) => {
    if (run === 'head') problems.push({ code: 'ASSEMBLE_SINGLE_RUN_PLAN', object: `config.assemble.plan[${i}] (part "${name}")`, detail: 'takes the head run, and with no --head there is none; "full" is required — the one run holds every layer' });
  });
  (extend ?? []).forEach((e, i) => {
    problems.push({ code: 'ASSEMBLE_SINGLE_RUN_PLAN', object: `config.assemble.extend_below_crop[${i}] (part "${e.part}")`, detail: 'continues a part below the head crop, and with no --head there is no crop; no extend_below_crop entry is required — remove it' });
  });
  refuseIfAny(problems);
}

/**
 * Run the stage in memory. Everything that can be refused is refused before
 * this returns; nothing here writes a file, so a caller that writes only
 * after this returned writes only after green.
 */
export function assemble(input: AssembleInput): AssembleResult {
  const { source, extend, patches, seamRule, projectRule } = input;
  const single = input.single === true;
  const frame = checkGeometry(
    { sourceW: source.width, sourceH: source.height, resolution: input.resolution, headBox: input.headBox, rigScale: input.rigScale, ...(single ? { single: true } : {}) },
    { full: input.full, head: input.head },
  );
  // Issue #366: one run's file, padded to the resolution square; read as both runs, as before.
  const fullPadded = single ? padSingleRun(input.full, frame, input.resolution) : input.full;
  // Issue #439: when seethrough.arm_split is declared, split the full run's overlapping handwear into handwear-r and handwear-l.
  const fullArmSplit = input.armSplit === undefined ? fullPadded : applyArmSplit(fullPadded, input.resolution, input.armSplit);
  // Issue #490: when generation.control.skeleton is present, split merged arm layers (or refuse when sleeve and drape share one colour).
  const full = input.keySkeleton === undefined ? fullArmSplit : splitMergedArmRuns(fullArmSplit, input.resolution, frame, source.width, source.height, input.keySkeleton);
  const plan = mergedArmSplitPlan(armSplitPlan(input.plan, input.armSplit), full);
  // Issue #492: in two-run mode, check that head:face covers >= 75% of full:face's silhouette on the head canvas
  // (after applying head_face_underfill when declared). Skip only on a single-run subset (a mouth-only or clothes-only alternate).
  const checkHeadFace =
    !single &&
    (plan.some(([, r, t]) => r === 'head' && t === 'face') || (plan.some(([, r]) => r === 'full') && plan.some(([, r]) => r === 'head')));
  const headFacePrep = checkHeadFace
    ? prepareHeadFace(full, input.head, frame, input.resolution, input.headFaceUnderfill === true)
    : { head: single ? full : input.head, underfillPx: 0, underfillNote: null };
  const head = headFacePrep.head;
  const padRecord = singleRunPadRecord(single, source.width, source.height, input.resolution, frame);
  if (single) checkSingleRun(full, plan, extend);
  checkPlanAgainstRuns(plan, extend, full, head);
  const { W, H } = frame;
  const srcr = sourceInRig(source, W, H);
  // Issue #359: a part's hidden-art layer is the under of a cut that names none — and, with one named, a refusal, since
  // reading either would be a guess. Its uses are counted for `hiddenLines`.
  const hiddenArt = hiddenArtByPart(plan, input.cuts, { full, head }, frame, input.resolution);
  const hiddenUses = new Map<string, string[]>();
  for (const [run, set] of single ? ([['full', full]] as const) : ([['full', full], ['head', head]] as const)) for (const h of set.hidden) hiddenUses.set(`${run}:${h.name}`, []);
  const hiddenProblems: Problem[] = [];
  const unders = input.cuts.map((q, i) => {
    const art = hiddenArt.get(q.from);
    if (art === undefined) return input.under?.[i] ?? null;
    if (q.under !== undefined) {
      hiddenProblems.push({ code: 'ASSEMBLE_HIDDEN_ONE_SOURCE', object: `config.assemble.cuts[${i}].under (part "${q.into}")`, detail: `names ${q.under}, and "${q.from}" also has the hidden-art layer ${art.layer}; one source of what lies under the piece is required — remove under, or the hidden-art layer` });
      return null;
    }
    const box = underBox(q.polygon);
    hiddenUses.get(art.layer)?.push(`cuts[${i}].under (part "${q.into}")`);
    return boxOf(art.raster, box.x0, box.y0, box.w, box.h);
  });
  const cuts = input.cuts.map((q): Cut => {
    const art = hiddenArt.get(q.from);
    return art === undefined || q.under !== undefined ? q : { ...q, under: `the hidden-art layer ${art.layer}` };
  });
  refuseIfAny(hiddenProblems);

  const rig = new Map<string, Raster>();
  const stats = new Map<string, ProjectionStats>();
  const ghost: Record<string, number> = {};
  /** The full run's layers with an opaque pixel, in draw order: the candidates `uncoveredErrorLayers` reads. */
  const fullTags: string[] = [];
  // A single run (issue #359) is read once: there is no head run to place, project or count ghosts for.
  for (const [run, set] of single ? ([['full', full]] as const) : ([['full', full], ['head', head]] as const)) {
    const layers = runLayers(set, input.resolution);
    if (run === 'full') fullTags.push(...layers.filter((l) => l.opaqueRunPx > 0).map((l) => l.tag));
    const rigLayers = layers.map((l) => layerToRig(l.canvas, frame, run));
    const st = projectSource(rigLayers, srcr, frame, run, projectRule, planRanks(layers.map((l) => l.tag), run, plan));
    layers.forEach((l, i) => {
      rig.set(`${run}:${l.tag}`, rigLayers[i]);
      stats.set(`${run}:${l.tag}`, st[i]);
      ghost[`${run}:${l.tag}`] = l.ghostPx;
    });
  }

  // Patches are checked against the rig before any pixel work, like the plan.
  const patchProblems: Problem[] = [];
  patches.forEach((q, i) => {
    const [, , bx1, by1] = q.box;
    if (bx1 > W || by1 > H) {
      patchProblems.push({
        code: 'ASSEMBLE_PATCH_BOX_INSIDE',
        object: `config.assemble.patches[${i}] (patch "${q.name}")`,
        detail: `box is [${q.box.join(', ')}]; the rig is ${W}x${H} (the painting times rig_scale ${frame.S}), so x1 <= ${W} and y1 <= ${H} are required — the box is in rig pixels, x1 and y1 exclusive`,
      });
    }
  });
  // Cuts too: a polygon past the rig is in some other space (source pixels,
  // most likely), and two cuts of one part that share a pixel would give it
  // to both. Every pair is named.
  const cutMasks = cuts.map((q) => pixelsInPolygon(q.polygon, W, H));
  cuts.forEach((q, i) => {
    const out = q.polygon.filter(([x, y]) => x > W || y > H);
    if (out.length > 0) {
      patchProblems.push({
        code: 'ASSEMBLE_CUT_INSIDE',
        object: `config.assemble.cuts[${i}] (part "${q.into}")`,
        detail: `polygon point(s) ${out.map(([x, y]) => `[${x}, ${y}]`).join(', ')} lie past the ${W}x${H} rig (the painting times rig_scale ${frame.S}); x <= ${W} and y <= ${H} are required — the polygon is in rig pixels, the space of parts.json`,
      });
    }
    for (let j = 0; j < i; j++) {
      if (cuts[j].from !== q.from) continue;
      let shared = 0;
      let first = -1;
      for (let p = 0; p < W * H; p++) {
        if (cutMasks[i].data[p] === 1 && cutMasks[j].data[p] === 1) {
          shared++;
          if (first < 0) first = p;
        }
      }
      if (shared > 0) {
        patchProblems.push({
          code: 'ASSEMBLE_CUT_OVERLAP',
          object: `config.assemble.cuts[${i}] (part "${q.into}")`,
          detail: `shares ${shared} rig pixel(s) with cuts[${j}] (part "${cuts[j].into}"), the first at ${first % W},${Math.floor(first / W)}; both cut "${q.from}", and a pixel goes to one part — polygons of one part that do not overlap are required`,
        });
      }
    }
  });
  // A cut's under image (issue #193), before any pixel work too: it must have
  // been read, be exactly the polygon's bounding box, and the piece must be
  // drawn in front of the part it fills — drawn behind, the fill would hide
  // the piece where it was painted.
  const order0 = drawOrder(
    plan.map((e) => e[0]),
    patches,
    cuts,
  );
  cuts.forEach((q, i) => {
    if (q.under === undefined) {
      // Issue #360: under_fill says how an under fills; a cut with no under (no file, no hidden-art layer) has nothing it could say it of.
      if (q.under_fill !== undefined) {
        patchProblems.push({
          code: 'ASSEMBLE_UNDER_FILL_SOURCE',
          object: `config.assemble.cuts[${i}].under_fill (part "${q.into}")`,
          detail: `is "${q.under_fill}", and the cut has no under: it names no under file and "${q.from}" has no hidden-art layer; under_fill says how an under fills the pixels the cut removed, so one is required — name under, or drop under_fill`,
        });
      }
      return;
    }
    const object = `config.assemble.cuts[${i}].under (part "${q.into}")`;
    const u = unders[i];
    if (u === null) {
      patchProblems.push({ code: 'ASSEMBLE_UNDER_PRESENT', object, detail: `names ${q.under}, and no image was handed to the stage for it; the decoded PNG is required (a caller of assemble() reads the file)` });
      return;
    }
    const box = underBox(q.polygon);
    if (u.width !== box.w || u.height !== box.h) {
      patchProblems.push({
        code: 'ASSEMBLE_UNDER_SIZE',
        object,
        detail: `${q.under} is ${u.width}x${u.height}; the polygon's bounding box is ${box.w}x${box.h} at ${box.x0},${box.y0} (least and greatest polygon x and y, in rig pixels), and an image of exactly that size is required — its pixel (i, j) is rig pixel (${box.x0} + i, ${box.y0} + j)`,
      });
    }
    const at = order0.findIndex((d) => 'cut' in d && d.cut === i);
    const base = order0.findIndex((d) => 'plan' in d && plan[d.plan][0] === q.from);
    if (at < base) {
      patchProblems.push({
        code: 'ASSEMBLE_UNDER_DRAW',
        object: `config.assemble.cuts[${i}].draw (part "${q.into}")`,
        detail: `is ${JSON.stringify(q.draw)}, which draws "${q.into}" behind "${q.from}"; with under, "${q.from}" is filled where the piece was painted and would hide it, so a draw in front of "${q.from}" is required — "front", or {"before": "<the plan part after ${q.from}>"} to keep the setup pose`,
      });
    }
  });
  refuseIfAny(patchProblems);

  const built: Array<Built | null> = plan.map(() => null);
  const empty: Problem[] = [];
  /** The part's alpha box and its `alpha > 8` count, over the whole rig. */
  const measureBox = (r: Raster): { x0: number; y0: number; x1: number; y1: number; opaque: number } => {
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    let opaque = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = r.data[(y * W + x) * 4 + 3];
        if (a > OPAQUE_ALPHA_ABOVE) opaque++;
        if (a > 0) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return { x0, y0, x1, y1, opaque };
  };
  plan.forEach(([name, run, tag], pi) => {
    const key = `${run}:${tag}`;
    const src = rig.get(key) as Raster;
    const r: Raster = { width: W, height: H, data: new Uint8ClampedArray(src.data) };
    const st = stats.get(key) as ProjectionStats;
    const extendKeys = extend.filter((e) => e.part === name).map((e) => `${e.run}:${e.tag}`);
    const extras = extendKeys.map((k) => rig.get(k) as Raster);
    let merged = 0;
    const trace: MergeTrace = { from: new Int32Array(W * H).fill(-1), ring: newMask(W, H) };
    if (extras.length > 0) {
      const front = newMask(W, H);
      for (const [, run2, tag2] of plan.slice(pi + 1)) {
        const f = rig.get(`${run2}:${tag2}`) as Raster;
        for (let p = 0; p < W * H; p++) if (f.data[p * 4 + 3] >= FRONT_ALPHA) front.data[p] = 1;
      }
      merged = mergeBelowCrop(r, extras, front, srcr, frame.headBottom, trace);
    }
    const { x1, opaque } = measureBox(r);
    if (opaque === 0) {
      empty.push({
        code: 'ASSEMBLE_PART_OPAQUE',
        object: `part "${name}" (${key}, config.assemble.plan[${pi}])`,
        detail: `has 0 pixels with alpha above ${OPAQUE_ALPHA_ABOVE} in the rig (${x1 < 0 ? 'no pixel at all' : 'only fringe below it'}; ${ghost[key]} ghost px removed in the run); a part with at least one opaque pixel is required — drop it from the plan or take the tag from the other run`,
      });
      return;
    }
    built[pi] = { key, r, st, extendKeys, trace, merged, region: null };
  });
  const silhouette = seamRule === 'silhouette' || patches.some((q) => q.alpha === 'silhouette') ? figureSilhouette(srcr) : null;
  const cut = patches.map((q, i) => {
    const c = cutPatch(q, srcr, silhouette);
    if (c === null) {
      empty.push({
        code: 'ASSEMBLE_PATCH_OPAQUE',
        object: `patch "${q.name}" (config.assemble.patches[${i}])`,
        detail: `takes 0 pixels: ${q.alpha === 'silhouette' ? `the painting's figure silhouette does not reach its box [${q.box.join(', ')}]` : 'its box is empty'}; a patch with at least one pixel is required — move the box onto the figure, or take "alpha": "box"`,
      });
    }
    return c;
  });

  // The cuts (issue #170), after step 4 so a piece takes the merged pixels
  // too: every pixel of the part with alpha above 0 whose centre a cut's
  // polygon holds moves to that cut's piece, colour and alpha, and is cleared
  // in the part. The polygons of one part are disjoint (refused above), so
  // each pixel goes to exactly one piece, and the counts printed are taken
  // here, before steps 4b and 5.
  const count = (m: Mask | null, region: Mask): number => {
    if (m === null) return 0;
    let n = 0;
    for (let p = 0; p < W * H; p++) if (m.data[p] === 1 && region.data[p] === 1) n++;
    return n;
  };
  const opaqueOf = (r: Raster): number => {
    let n = 0;
    for (let p = 0; p < W * H; p++) if (r.data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE) n++;
    return n;
  };
  const mergedIn = (b: Built, region: Mask): number => count(b.trace.lastSel ?? null, region) + count(b.trace.lastRing ?? null, region);
  const pieces: Array<Built | null> = cuts.map(() => null);
  const cutCounts: CutCount[] = [];
  plan.forEach(([name], pi) => {
    const mine = cuts.map((q, i) => i).filter((i) => cuts[i].from === name);
    const b = built[pi];
    if (mine.length === 0 || b === null) return;
    const before = opaqueOf(b.r);
    const rest = newMask(W, H);
    rest.data.fill(1);
    // The base's own pixels: `rest`, and every cut's band, which it keeps as well as the piece.
    const own = newMask(W, H);
    const bands: number[] = [];
    const taken = mine.map((i) => {
      const m = cutMasks[i];
      const band = cutBand(m, cuts[i].overlap);
      const r = newRaster(W, H);
      let n = 0;
      let nb = 0;
      for (let p = 0; p < W * H; p++) {
        rest.data[p] &= 1 - m.data[p];
        if (band.data[p] === 1) own.data[p] = 1;
        const a = b.r.data[p * 4 + 3];
        if (m.data[p] === 0 || a === 0) continue;
        r.data.set(b.r.data.subarray(p * 4, p * 4 + 4), p * 4);
        if (band.data[p] === 0) b.r.data.fill(0, p * 4, p * 4 + 4);
        if (a > OPAQUE_ALPHA_ABOVE) {
          n++;
          if (band.data[p] === 1) nb++;
        }
      }
      pieces[i] = { ...b, r, region: m, merged: mergedIn(b, m) };
      bands.push(nb);
      return n;
    });
    for (let p = 0; p < W * H; p++) if (rest.data[p] === 1) own.data[p] = 1;
    const bandSum = bands.reduce((a, n) => a + n, 0);
    // What the base kept of the strict partition; its image also holds the bands.
    const kept = opaqueOf(b.r) - bandSum;
    const sum = taken.reduce((a, n) => a + n, 0);
    const object = `part "${name}" (${b.key}, config.assemble.plan[${pi}])`;
    // By construction: the pieces partition the layer, so their counts add up to the layer's. A refusal here is a bug.
    const split = [
      ['opaque px', before, kept + sum],
      ['merged_px', b.merged, mergedIn(b, rest) + mine.reduce((a, i) => a + (pieces[i] as Built).merged, 0)],
      ['projected_core_px', b.st.core, count(b.st.coreMask, rest) + mine.reduce((a, i) => a + count(b.st.coreMask, cutMasks[i]), 0)],
      ['source_px_taken', b.st.taken, count(b.st.takenMask, rest) + mine.reduce((a, i) => a + count(b.st.takenMask, cutMasks[i]), 0)],
      ['refused_drift_px', b.st.refused, count(b.st.refusedMask, rest) + mine.reduce((a, i) => a + count(b.st.refusedMask, cutMasks[i]), 0)],
    ] as const;
    for (const [what, whole, parts] of split) {
      if (whole !== parts) empty.push({ code: 'ASSEMBLE_COUNTS_ADD_UP', object, detail: `${what}: ${whole} before its cuts, ${parts} over the pieces; equal is required (a bug in the assembler, not in the inputs)` });
    }
    mine.forEach((i, k) => {
      if (taken[k] === 0) {
        empty.push({
          code: 'ASSEMBLE_CUT_PIXELS',
          object: `config.assemble.cuts[${i}] (part "${cuts[i].into}")`,
          detail: `takes 0 of "${name}"'s ${before} opaque pixel(s) (alpha above ${OPAQUE_ALPHA_ABOVE}); its polygon holds ${count(cutMasks[i], cutMasks[i])} rig pixel(s) and none is that layer's art — a cut that takes at least one is required: draw the polygon over the art (parts/${name}.png, placed at its parts.json x, y, is the layer in rig pixels)`,
        });
      }
    });
    if (kept === 0) {
      empty.push({
        code: 'ASSEMBLE_CUT_PIXELS',
        object,
        detail: `keeps 0 of its ${before} opaque pixel(s): ${mine.map((i, k) => `cuts[${i}] ("${cuts[i].into}") takes ${taken[k]}`).join(', ')}; a part that keeps at least one is required — to move the whole layer, rename the plan part instead`,
      });
    }
    b.region = own;
    b.merged = mergedIn(b, own);
    // Issue #193: the base takes the under image where the cut removed its
    // pixels, after the counts above were taken from the cut alone. A filled
    // pixel lies outside the base's region, so it is counted occluded (the
    // piece is drawn over it) and never projected.
    const filled = mine.map((i) => {
      const u = unders[i];
      if (u === null) return undefined;
      // Filled where the image is at least as opaque as the layer was; left empty elsewhere (`fillUnder`).
      // With under_fill "colour" (issue #360) a filled pixel keeps the alpha the cut removed and takes the image's colour only.
      const f = fillUnder(b.r, (pieces[i] as Built).r, cutBand(cutMasks[i], cuts[i].overlap), u, underBox(cuts[i].polygon), cuts[i].under_fill);
      // A hidden-art layer (issue #359) is the whole layer's covered art, read by every cut of its part: a cut it holds nothing
      // under fills 0, which the cut line counts, and is not refused as a file made for this one cut would be.
      if (f.filled === 0 && input.cuts[i].under !== undefined) {
        empty.push({
          code: 'ASSEMBLE_UNDER_EMPTY',
          object: `config.assemble.cuts[${i}].under (part "${cuts[i].into}")`,
          detail: `${cuts[i].under} fills 0 of the ${f.empty} pixel(s) the cut removed from "${name}": at every one its alpha is below the alpha removed (an all-transparent image, or another file); an image that fills at least one is required — to leave the whole hole, drop under`,
        });
      }
      return f;
    });
    mine.forEach((i, k) => {
      const c: CutCount = { from: name, into: cuts[i].into, before, kept, taken: taken[k], band: bands[k] };
      const f = filled[k];
      if (f !== undefined) {
        c.under = f.filled;
        c.underEmpty = f.empty;
        if (cuts[i].under_fill === 'colour') c.underFill = 'colour';
      }
      cutCounts.push(c);
    });
  });
  refuseIfAny(empty);
  // In cut order, as the config lists them.
  cutCounts.sort((a, b) => cuts.findIndex((q) => q.into === a.into) - cuts.findIndex((q) => q.into === b.into));

  // Issue #564: a cut from a part a limb takes lies outside the limb's segments, read before the limbs are cut.
  const bands = input.limbs === undefined || cuts.length === 0 ? null : limbBands(cuts, pieces, input.limbs, input.bones ?? [], W, H, null);
  if (bands !== null) {
    refuseIfAny(bands.problems);
    for (const [i, at] of bands.past) {
      const c = cutCounts.find((q) => q.into === cuts[i].into);
      if (c !== undefined) c.limb = at;
    }
  }
  // Issue #349: the limbs, after the cuts (a limb may take a cut's piece, and a cut's under image fills its base first).
  const lim = cutLimbs(input.limbs ?? {}, input.bones ?? [], input.caps ?? new Map(), W, H, (name) => {
    const pi = plan.findIndex((e) => e[0] === name);
    if (pi >= 0) return built[pi];
    const ci = cuts.findIndex((q) => q.into === name);
    return ci >= 0 ? pieces[ci] : null;
  }, opaqueOf, mergedIn, count, (name) => hiddenArt.get(name) ?? null, (layer, by) => hiddenUses.get(layer)?.push(by));
  // Issue #564: and the cap a run's own layer fills above its upper joint, read once the limbs are cut.
  if (bands !== null) refuseIfAny(limbBands(cuts, pieces, input.limbs ?? {}, input.bones ?? [], W, H, (l, k) => lim.parts.find((q) => q.limb === l && q.segment === k)?.record.cap).problems);
  const limbPieces = lim.pieces;
  const order = limbOrder(order0, plan, cuts, lim.parts);
  const pieceAt = (d: { plan: number } | { cut: number } | { limb: number }): { name: string; b: Built } =>
    'plan' in d ? { name: plan[d.plan][0], b: built[d.plan] as Built } : 'cut' in d ? { name: cuts[d.cut].into, b: pieces[d.cut] as Built } : { name: lim.parts[d.limb].part, b: limbPieces[d.limb] as Built };

  // Step 4b: push back a fringe the painting shows another part through, over
  // the plan parts still uncropped and the patches, in draw order.
  const stack: PlacedPart[] = order.map((d) => {
    if ('patch' in d) return cut[d.patch] as PlacedPart;
    const { name, b } = pieceAt(d);
    const whole: PartRecord = { name, from: b.key, x: 0, y: 0, w: W, h: H, opaque_px: 0, projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 };
    return { record: whole, image: b.r };
  });
  const featheredInOrder: Array<Mask | null> = order.map((d) => ('patch' in d ? null : (pieceAt(d).b.feathered ?? null)));
  const pushedBy = pushBackFringe(stack, srcr, seamRule, seamRule === 'silhouette' ? silhouette : null, featheredInOrder);
  // Issue #255: a part's drift refusals in a body, and who holds the body in the draw order (the push-back clears
  // only fringe below CORE_ALPHA, and the seam override only recolours, so the holders read here are final).
  const holderAt = new Int32Array(W * H).fill(-1);
  stack.forEach(({ image }, i) => {
    for (let p = 0; p < W * H; p++) if (image.data[p * 4 + 3] >= CORE_ALPHA) holderAt[p] = i;
  });
  const stackNames = stack.map((q) => q.record.name);
  const drift: DriftBodies[] = [];
  order.forEach((d, orderIdx) => {
    if ('patch' in d) return;
    const { name, b } = pieceAt(d);
    if (b.st.refusedMask === null) return;
    const refused = newMask(W, H);
    for (let p = 0; p < W * H; p++) if (b.st.refusedMask.data[p] === 1 && (b.region === null || b.region.data[p] === 1)) refused.data[p] = 1;
    const behindAt = new Int32Array(W * H).fill(-1);
    for (let j = 0; j < orderIdx; j++) {
      const under = stack[j].image.data;
      for (let p = 0; p < W * H; p++) {
        if (under[p * 4 + 3] < CORE_ALPHA) continue;
        const dMax = Math.max(
          Math.abs(under[p * 4] - srcr.data[p * 4]),
          Math.abs(under[p * 4 + 1] - srcr.data[p * 4 + 1]),
          Math.abs(under[p * 4 + 2] - srcr.data[p * 4 + 2]),
        );
        if (dMax <= DRIFT_LIMIT) behindAt[p] = j;
      }
    }
    const found = driftBodies(name, b.key, refused, bodyMinPx(frame), holderAt, stackNames, behindAt);
    if (found !== null) drift.push(found);
  });
  const pushedOf: FringePushed[][] = plan.map(() => []);
  const pushedOfCut: FringePushed[][] = cuts.map(() => []);
  const pushedOfLimb: FringePushed[][] = lim.parts.map(() => []);
  order.forEach((d, i) => {
    if ('plan' in d) pushedOf[d.plan] = pushedBy[i];
    if ('cut' in d) pushedOfCut[d.cut] = pushedBy[i];
    if ('limb' in d) pushedOfLimb[d.limb] = pushedBy[i];
  });

  const planned: Array<PlacedPart | null> = plan.map(() => null);
  const cutPlaced: Array<PlacedPart | null> = cuts.map(() => null);
  // A cut's piece records the plan part it was cut from (issue #230): parts.json is in draw order, so a piece drawn
  // "back" comes before its base, and nothing else in the file says which of the two is the piece.
  const limbPlaced: Array<PlacedPart | null> = lim.parts.map(() => null);
  // A part a limb takes is not made itself (issue #349): its pixels are the limb's parts'.
  const taken = new Set(lim.parts.map((q) => q.of));
  const pieceList: Array<{ name: string; b: Built; pushed: FringePushed[]; at: string; cutFrom: string | null; limb?: LimbRecord; set: (p: PlacedPart) => void }> = [
    ...plan.map(([name], pi) => ({ name, b: built[pi] as Built, pushed: pushedOf[pi], at: `config.assemble.plan[${pi}]`, cutFrom: null, set: (q: PlacedPart) => (planned[pi] = q) })),
    ...cuts.map((q, i) => ({ name: q.into, b: pieces[i] as Built, pushed: pushedOfCut[i], at: `config.assemble.cuts[${i}]`, cutFrom: q.from, set: (pp: PlacedPart) => (cutPlaced[i] = pp) })),
    ...lim.parts.map((q, i) => ({ name: q.part, b: limbPieces[i] as Built, pushed: pushedOfLimb[i], at: `config.limbs.${q.limb}.segments[${q.segment}]`, cutFrom: null, limb: q.record, set: (pp: PlacedPart) => (limbPlaced[i] = pp) })),
  ].filter((q) => !taken.has(q.name));
  pieceList.forEach(({ name, b, pushed: pushedHere, at, cutFrom, limb, set }) => {
    const { key, r, st, extendKeys, trace, merged, region } = b;
    // A pixel the merge wrote is judged in the extend layer's run, every other
    // in the part's own. Projected = the colour came from projectSource's
    // accepted set: the part layer's, or for a copied pixel the extend
    // layer's (its rig layer was projected before it was copied). A ring pixel
    // is growRim's, counted in merged_px, and is not projection.
    const visible = newMask(W, H);
    const projected = newMask(W, H);
    for (let p = 0; p < W * H; p++) {
      const e = trace.from[p];
      const own = e < 0 ? st : (stats.get(extendKeys[e]) as ProjectionStats);
      // A pixel outside the piece's region is a base pixel filled from a cut's under image (issue #193): occluded, never visible.
      if (r.data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE && own.clear.data[p] === 1 && (region === null || region.data[p] === 1)) visible.data[p] = 1;
      if (trace.ring.data[p] === 0 && own.takenMask.data[p] === 1 && (region === null || region.data[p] === 1)) projected.data[p] = 1;
    }
    const { x0, y0, x1, y1, opaque } = measureBox(r);
    if (opaque === 0) {
      const pushed = pushedHere.reduce((a, q) => a + q.px, 0);
      empty.push({
        code: 'ASSEMBLE_PART_OPAQUE',
        object: `part "${name}" (${key}, ${at})`,
        detail: `has 0 pixels with alpha above ${OPAQUE_ALPHA_ABOVE} in the rig once its fringe is pushed back: every one of its pixels was below alpha ${CORE_ALPHA} where the painting shows another part (${pushed} px pushed back, held by ${pushedHere.map((q) => `"${q.part}" ${q.px} px`).join(', ')}); a part with at least one opaque pixel is required — drop it from the plan or take the tag from the other run`,
      });
      return;
    }
    const vc = visibilityCounts(`part "${name}" (${key})`, r, visible, projected);
    const record: PartRecord = {
      name,
      from: key,
      ...(cutFrom === null ? {} : { cut_from: cutFrom }),
      x: x0,
      y: y0,
      w: x1 - x0 + 1,
      h: y1 - y0 + 1,
      opaque_px: opaque,
      visible_px: vc.visible_px,
      occluded_px: vc.occluded_px,
      projected_core_px: region === null ? st.core : count(st.coreMask, region),
      source_px_taken: region === null ? st.taken : count(st.takenMask, region),
      visible_not_projected_px: vc.visible_not_projected_px,
      refused_drift_px: region === null ? st.refused : count(st.refusedMask, region),
      merged_px: merged,
      seam_override_px: 0,
    };
    if (pushedHere.length > 0) record.fringe_pushed_back = pushedHere;
    if (limb !== undefined) record.limb = limb;
    set({ record, image: crop(r, x0, y0, record.w, record.h) });
  });
  refuseIfAny(empty);
  const placed: PlacedPart[] = order.map((d) => ('plan' in d ? planned[d.plan] : 'cut' in d ? cutPlaced[d.cut] : 'limb' in d ? limbPlaced[d.limb] : cut[d.patch]) as PlacedPart);

  seamOverride(placed, srcr, seamRule, seamRule === 'silhouette' ? silhouette : null);
  const can = recomposite(placed, W, H);
  // Issue #242: on a scene painting the figure is read off the full run, and every recomposite figure inside it.
  const inside = input.scene === true ? sceneFigure([...rig.entries()].filter(([k]) => k.startsWith('full:')).map(([, r]) => r), W, H) : null;
  const sceneRecord: SceneRecord | null = inside === null ? null : { figure_alpha_above: OPAQUE_ALPHA_ABOVE, figure_px: inside.reduce((a, b) => a + b, 0), figure_mask: FIGURE_MASK_FILE };
  const figures = measureRecomposite(can, srcr, placed, inside);
  const covered = coveredMask(placed, W, H);
  const err = errorMask(can, srcr, inside);
  const anyLayer = new Uint8Array(W * H);
  for (const r of rig.values()) for (let p = 0; p < W * H; p++) if (r.data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE) anyLayer[p] = 1;
  const kinds = holeKinds(err, covered, anyLayer, W, H);
  const fullRig = fullTags.map((tag) => ({ tag, rig: rig.get(`full:${tag}`) as Raster }));
  const uncovered = uncoveredErrorLayers(
    fullRig,
    covered,
    err,
    figures.uncoveredErrorPx,
    plan,
    extend,
    layerFigures(full),
    (tag) => rig.get(`head:${tag}`) ?? null,
    frame.headBottom,
    bodyMinPx(frame),
  );
  return {
    parts: {
      rig_size: [W, H],
      scale_rig_per_source: frame.S,
      parts: placed.map((p) => p.record),
      ghost_px: ghost,
      recomposite: recompositeRecord(figures),
      ...(sceneRecord === null ? {} : { scene: sceneRecord }),
      ...(padRecord === null ? {} : { single_run_pad: padRecord }),
    },
    images: placed,
    recomposite: can,
    errorMap: recompositeErrorMap(can, srcr, placed, inside),
    figure: inside === null ? null : figureImage(inside, W, H),
    figures,
    cuts: cutCounts,
    limbs: lim.counts,
    uncovered,
    holeKinds: kinds,
    drift,
    hidden: [...hiddenUses].map(([layer, readBy]) => ({ layer, readBy })),
    seamRule,
    projectRule,
    ...(headFacePrep.underfillPx > 0 ? { headFaceUnderfillPx: headFacePrep.underfillPx } : {}),
  };
}

// ---------------------------------------------------------------------------
// refused bodies: a part whose layer is not what the painting shows (issue #255)
// ---------------------------------------------------------------------------

/** A part whose `DRIFT_LIMIT` refusals hold a body, and which parts the draw order puts there. */
export interface DriftBodies {
  /** The part, and its `<run>:<tag>`. */
  part: string;
  from: string;
  /** The part's `refused_drift_px`, in a body or not. */
  refusedPx: number;
  /** The bar the bodies were held to (`bodyMinPx`, the uncovered line's). */
  minPx: number;
  /** The bodies, largest first (`bodiesOf`). */
  bodies: UncoveredBody[];
  /**
   * Over every pixel of the bodies, the part that holds it in the draw order
   * — the top-most at alpha >= `CORE_ALPHA`, as the seam pass reads a holder
   * (`seamCandidates`) — with its pixel count, most first, then by name.
   */
  holders: Array<{ part: string; px: number }>;
  /**
   * Over every pixel of the bodies, the top-most part drawn behind `part` at
   * alpha >= `CORE_ALPHA` whose colour is within `DRIFT_LIMIT` of the painting
   * (issue #351), with its pixel count, most first, then by name.
   */
  behind?: Array<{ part: string; px: number }>;
}

/**
 * A part's refused bodies that another part holds in the draw order (issue
 * #255) or that a part drawn behind it matches within `DRIFT_LIMIT` of the
 * painting (issue #351).
 *
 * ⚖️ Invariant: `refused` is the part's projection core pixels whose layer
 * colour is more than `DRIFT_LIMIT` off the painting (`projectSource`'s
 * `refusedMask`, cut to the part's region); its bodies are `bodiesOf(refused,
 * minPx)` — the pixels that survive a `BODY_KERNEL` opening, in 8-connected
 * components of at least `minPx` — the same reading of "a body" as an
 * uncovered layer's, and the stage passes the same bar (`bodyMinPx`).
 * `holderAt` is, per rig pixel, the index into `names` of the top-most part
 * at alpha >= `CORE_ALPHA` in draw order (-1: none), as the seam pass reads a
 * holder. `behindAt` (optional) is, per rig pixel, the index into `names` of
 * the top-most part drawn behind `part` at alpha >= `CORE_ALPHA` whose colour
 * is within `DRIFT_LIMIT` of the painting (-1: none). The result is non-null
 * exactly when the bodies hold a pixel whose holder is another part or whose
 * `behindAt` names a part drawn behind `part` that matches the painting.
 */
export function driftBodies(part: string, from: string, refused: Mask, minPx: number, holderAt: Int32Array, names: readonly string[], behindAt?: Int32Array): DriftBodies | null {
  let refusedPx = 0;
  for (let p = 0; p < refused.data.length; p++) refusedPx += refused.data[p];
  if (refusedPx === 0) return null;
  const { bodies, pixels } = bodiesWithPixels(refused, minPx);
  if (bodies.length === 0) return null;
  const count = new Map<string, number>();
  const behindCount = new Map<string, number>();
  for (let p = 0; p < pixels.data.length; p++) {
    if (pixels.data[p] === 0) continue;
    if (holderAt[p] >= 0) {
      const n = names[holderAt[p]];
      count.set(n, (count.get(n) ?? 0) + 1);
    }
    if (behindAt !== undefined && behindAt[p] >= 0) {
      const b = names[behindAt[p]];
      if (b !== part) behindCount.set(b, (behindCount.get(b) ?? 0) + 1);
    }
  }
  const hasFront = [...count.keys()].some((n) => n !== part);
  if (!hasFront && behindCount.size === 0) return null;
  const holders = [...count.entries()].map(([q, px]) => ({ part: q, px })).sort((a, b) => b.px - a.px || (a.part < b.part ? -1 : a.part > b.part ? 1 : 0));
  const behind = [...behindCount.entries()].map(([q, px]) => ({ part: q, px })).sort((a, b) => b.px - a.px || (a.part < b.part ? -1 : a.part > b.part ? 1 : 0));
  return { part, from, refusedPx, minPx, bodies, holders, ...(behind.length > 0 ? { behind } : {}) };
}

/**
 * One `drift` line under the `uncovered` lines: the part, its refused pixels,
 * their bodies, and the parts the plan's draw order puts on them —
 * `drift: "topwear" refuses 196 px of full:topwear (its colour more than 90
 * off the painting, max channel), in a body of 196 px at 16,12 14x14 (at
 * least 150 px past a 5x5 opening); by the plan's draw order "face" holds 196
 * px of it (the top-most part at alpha >= 250), drawn in front of "topwear"`.
 * When `behind` is non-empty (issue #351), names the part(s) drawn behind
 * `part` whose colour is within `DRIFT_LIMIT` of the painting.
 */
export function driftLine(d: DriftBodies): string {
  const total = d.bodies.reduce((a, b) => a + b.px, 0);
  const big = d.bodies[0];
  const held = d.bodies.length > 1 ? `${d.bodies.length} bodies of ${total} px, the largest ${big.px} px at ${bodyBox(big)}` : `a body of ${big.px} px at ${bodyBox(big)}`;
  const others = d.holders.filter((h) => h.part !== d.part).map((h) => `"${h.part}"`);
  const frontClause = others.length > 0 ? `, ${others.join(', ')} drawn in front of "${d.part}"` : '';
  const behindClause =
    d.behind !== undefined && d.behind.length > 0
      ? `; the painting is within ${DRIFT_LIMIT} of ${d.behind.map((h) => `"${h.part}" (${h.px} px at alpha >= ${CORE_ALPHA}, drawn behind "${d.part}")`).join(', ')}`
      : '';
  return (
    `drift: "${d.part}" refuses ${d.refusedPx} px of ${d.from} (its colour more than ${DRIFT_LIMIT} off the painting, max channel), in ${held} (at least ${fmtPx(d.minPx)} px past a ${BODY_KERNEL}x${BODY_KERNEL} opening); ` +
    `by the plan's draw order ${d.holders.map((h) => `"${h.part}" holds ${h.px} px`).join(', ')} of it (the top-most part at alpha >= ${CORE_ALPHA})${frontClause}${behindClause}`
  );
}

/** A rig-pixel bar as the lines print it: a whole number as it is, otherwise to one decimal. */
function fmtPx(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ---------------------------------------------------------------------------
// uncovered bodies: a full-run layer the plan leaves out (issue #233)
// ---------------------------------------------------------------------------

/**
 * The kernel that separates a body from a seam: a full-run pixel no planned
 * part covers counts toward a body only where it survives an opening (erode,
 * then dilate) by this square. It is `CORE_KERNEL`, the stage's own measure of
 * "a few pixels wide": the two runs' silhouettes of one layer differ by a band
 * that narrow all along their outline (the full run is resampled up, the head
 * run down), and that band, joined end to end, is one long component that
 * holds no hair.
 */
export const BODY_KERNEL = CORE_KERNEL;

/**
 * The smallest uncovered body, in rig pixels: `PROPOSE_MIN_PX` full-run pixels
 * carried into the rig by the full run's map (each run pixel spans `k * k`
 * rig pixels, `k = fullK * rig_scale`). It is the bar below which the proposer
 * drops a whole tag as too small to be a part, so a body under it is one the
 * proposer would not have made a part of had it been a layer of its own.
 */
export function bodyMinPx(frame: Frame, minPx = PROPOSE_MIN_PX): number {
  return minPx * (frame.fullK * frame.S) ** 2;
}

/** One 8-connected body of a full-run layer that no planned part covers, rig pixels (y down, origin top-left). */
export interface UncoveredBody {
  px: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A full-run layer whose uncovered bodies the plan leaves out, and the rule that left them out. */
export interface UncoveredLayer {
  /** The full-run tag. */
  tag: string;
  /** Its bodies, largest first (then top row, then left column); each at least `bodyMinPx`. */
  bodies: UncoveredBody[];
  /** The rule that skipped it (`skippedBy`). */
  rule: string;
}

/**
 * The bodies of `mask`: its pixels that survive an opening by `BODY_KERNEL`,
 * as 8-connected components of at least `minPx` pixels, largest first, then by
 * the box's top row and left column.
 */
export function bodiesOf(mask: Mask, minPx: number): UncoveredBody[] {
  return bodiesWithPixels(mask, minPx).bodies;
}

/** `bodiesOf`, and the mask of every pixel that lies in one of the bodies it returns. */
export function bodiesWithPixels(mask: Mask, minPx: number): { bodies: UncoveredBody[]; pixels: Mask } {
  const opened = dilate(erode(mask, BODY_KERNEL), BODY_KERNEL);
  for (let p = 0; p < opened.data.length; p++) if (mask.data[p] === 0) opened.data[p] = 0;
  const cc = connectedComponents(opened, 8);
  const keep = cc.stats.map((s, l) => l > 0 && s.area > 0 && s.area >= minPx);
  const all = cc.stats.filter((s, l) => keep[l]);
  all.sort((a, b) => b.area - a.area || a.top - b.top || a.left - b.left);
  const pixels = newMask(mask.width, mask.height);
  for (let p = 0; p < pixels.data.length; p++) if (keep[cc.labels[p]]) pixels.data[p] = 1;
  return { bodies: all.map((s) => ({ px: s.area, x: s.left, y: s.top, w: s.width, h: s.height })), pixels };
}

/** A body's box as the hole lines print one: `x,y wxh`. */
export function bodyBox(b: UncoveredBody): string {
  return `${b.x},${b.y} ${b.w}x${b.h}`;
}

/**
 * Which rule left the full-run layer `tag` out of the plan's coverage, in
 * words that name it. `headPart` is the head-run part's rig raster when the
 * plan takes `tag` from the head run; `why` is the proposer's reason for not
 * proposing an extend entry, when the caller is the proposer.
 *
 * ⚖️ Invariant: exactly one of four cases, decided in this order — the plan
 * takes no part from `tag`; it takes one from the head run and no
 * `extend_below_crop` entry continues that part from the full run's `tag`;
 * an entry does, and the head-run part has no pixel of alpha above
 * `CROP_PROBE_ALPHA` on the probe row (`headBottom - CROP_PROBE_ROWS`), so
 * `belowCrop` seeds nothing; or it reaches the line and the body is not one
 * of the components `belowCrop` seeds.
 */
export function skippedBy(tag: string, plan: readonly PlanEntry[], extend: readonly Extend[], headPart: Raster | null, headBottom: number, why: string | null): string {
  const entry = plan.find((e) => e[2] === tag);
  if (entry === undefined) return `the plan takes no part from "${tag}"`;
  const part = entry[0];
  const taken = `${part} takes the head run's "${tag}"`;
  if (!extend.some((e) => e.part === part && e.run === 'full' && e.tag === tag)) {
    return `${taken}, and no extend_below_crop entry continues it from the full run${why === null ? '' : ` (${why})`}`;
  }
  const probe = headBottom - CROP_PROBE_ROWS;
  let reaches = false;
  if (headPart !== null && probe >= 0 && probe < headPart.height) {
    for (let x = 0; x < headPart.width && !reaches; x++) if (headPart.data[(probe * headPart.width + x) * 4 + 3] > CROP_PROBE_ALPHA) reaches = true;
  }
  if (!reaches) {
    return `${taken}; extend_below_crop continues a head-run part only from the columns where it reaches the head crop's bottom line (alpha above ${CROP_PROBE_ALPHA} on rig row ${probe}), and ${part} reaches it nowhere`;
  }
  return `${taken}; extend_below_crop continues only the full-run components that touch rig rows ${headBottom}..${headBottom + CROP_SEED_ROWS - 1} within ${CROP_SEED_COLUMNS} columns of where ${part} reaches the head crop's bottom line, and this body is not one of them`;
}

/**
 * The full-run layers holding a body no planned part covers. `covered` is 1
 * where some planned part has alpha above `COVERED_ALPHA` (the recomposite's
 * own "covered"); `fullRig` maps each full-run tag to its rig raster. A layer
 * is a candidate when no plan entry takes its tag from the full run and it
 * crosses no plausibility rule (a layer that does is noted by the proposer
 * and refused as a part by `layers`, so it is no continuation). Its body
 * pixels are its alpha-above-`COVERED_ALPHA` pixels where `covered` is 0;
 * `bodiesOf` keeps the bodies of at least `minPx`. Layers in the full run's
 * draw order.
 */
export function uncoveredLayers(
  fullRig: ReadonlyArray<{ tag: string; rig: Raster }>,
  covered: Uint8Array,
  plan: readonly PlanEntry[],
  extend: readonly Extend[],
  figures: readonly LayerFigures[],
  headRig: (tag: string) => Raster | null,
  headBottom: number,
  minPx: number,
  why: (tag: string) => string | null,
): UncoveredLayer[] {
  const out: UncoveredLayer[] = [];
  for (const { tag, rig } of fullRig) {
    if (plan.some((e) => e[1] === 'full' && e[2] === tag)) continue;
    const f = figures.find((x) => x.name === tag);
    if (f !== undefined && implausibleRules(f).length > 0) continue;
    const mask = newMask(rig.width, rig.height);
    let any = false;
    for (let p = 0; p < covered.length; p++) {
      if (covered[p] === 0 && rig.data[p * 4 + 3] > COVERED_ALPHA) {
        mask.data[p] = 1;
        any = true;
      }
    }
    if (!any) continue;
    const bodies = bodiesOf(mask, minPx);
    if (bodies.length === 0) continue;
    const entry = plan.find((e) => e[2] === tag);
    out.push({ tag, bodies, rule: skippedBy(tag, plan, extend, entry !== undefined && entry[1] === 'head' ? headRig(tag) : null, headBottom, why(tag)) });
  }
  return out;
}

/**
 * Where the plan's parts cover the rig before any pixel is projected: 1 where
 * some plan entry's layer, warped into the rig (`layerToRig`), has alpha above
 * `COVERED_ALPHA`, or where an `extend_below_crop` entry's `belowCrop`
 * selection copies such a pixel into its part. Projection never changes alpha,
 * so this is the stage's own coverage less what `growRim`'s ring, the fringe
 * push-back and the seam override add or clear along an outline — a pixel
 * wide, below any body (`BODY_KERNEL`).
 */
export function planCoverage(plan: readonly PlanEntry[], extend: readonly Extend[], rigOf: (run: Run, tag: string) => Raster, headBottom: number): Uint8Array {
  let covered: Uint8Array | null = null;
  const mark = (r: Raster, sel: Mask | null): void => {
    if (covered === null) covered = new Uint8Array(r.width * r.height);
    for (let p = 0; p < covered.length; p++) if (r.data[p * 4 + 3] > COVERED_ALPHA && (sel === null || sel.data[p] === 1)) covered[p] = 1;
  };
  for (const [name, run, tag] of plan) {
    const part = rigOf(run, tag);
    mark(part, null);
    for (const e of extend) {
      if (e.part !== name) continue;
      const extra = rigOf(e.run, e.tag);
      mark(extra, belowCrop(part, extra, headBottom));
    }
  }
  return covered ?? new Uint8Array(0);
}

/** A full-run layer the recomposite's uncovered error lies on in a body (`uncoveredErrorLayers`). */
export interface UncoveredErrorLayer {
  /** The layer, its uncovered error bodies, and the rule that skipped it. */
  layer: UncoveredLayer;
  /** Every uncovered error pixel under the layer's alpha above `COVERED_ALPHA`, in a body or not … */
  errorPx: number;
  /** … of the recomposite's `uncoveredErrorPx`. */
  of: number;
}

/**
 * The full-run layers the plan does not take from the full run that the
 * recomposite's uncovered error lies on in a body.
 *
 * ⚖️ Invariant: exactly `uncoveredLayers` with "covered" widened to every
 * pixel that is covered or is not an error pixel — so a layer is listed when
 * its uncovered ERROR pixels hold a body of at least `minPx` (`bodiesOf`), the
 * proposer's bar for an uncovered layer applied to what the recomposite shows.
 * `covered` and `err` are the recomposite's own masks (`coveredMask`,
 * `errorMask`). Draw order of the full run.
 *
 * Not "a layer holding most of the uncovered error": on the public examples'
 * proposed plans the seam scatter along every outline outweighs a missing
 * lock (the pull request that added this has the figures), so a majority
 * test would stay silent exactly where the proposer's note fires.
 */
export function uncoveredErrorLayers(
  fullRig: ReadonlyArray<{ tag: string; rig: Raster }>,
  covered: Uint8Array,
  err: Uint8Array,
  of: number,
  plan: readonly PlanEntry[],
  extend: readonly Extend[],
  figures: readonly LayerFigures[],
  headRig: (tag: string) => Raster | null,
  headBottom: number,
  minPx: number,
): UncoveredErrorLayer[] {
  if (of === 0) return [];
  const quiet = new Uint8Array(covered.length);
  for (let p = 0; p < quiet.length; p++) quiet[p] = covered[p] === 1 || err[p] === 0 ? 1 : 0;
  return uncoveredLayers(fullRig, quiet, plan, extend, figures, headRig, headBottom, minPx, () => null).map((layer) => {
    const rig = (fullRig.find((l) => l.tag === layer.tag) as { rig: Raster }).rig;
    let n = 0;
    for (let p = 0; p < err.length; p++) if (quiet[p] === 0 && rig.data[p * 4 + 3] > COVERED_ALPHA) n++;
    return { layer, errorPx: n, of };
  });
}

/**
 * One `uncovered` line under the hole lines: the layer, its share of the
 * uncovered error, its bodies, and the rule that skipped it — `uncovered: 240
 * of the 240 uncovered error px lie on the full run's "back hair", in a body
 * of 240 px at 36,22 8x30; hair_back takes the head run's "back hair"; …`.
 */
export function uncoveredLine(d: UncoveredErrorLayer, scene: string | null = null): string {
  const u = d.layer;
  const total = u.bodies.reduce((a, b) => a + b.px, 0);
  const big = u.bodies[0];
  const held = u.bodies.length > 1 ? `${u.bodies.length} bodies of ${total} px, the largest ${big.px} px at ${bodyBox(big)}` : `a body of ${big.px} px at ${bodyBox(big)}`;
  return `${scene === null ? '' : `${scene}: `}uncovered: ${d.errorPx} of the ${d.of} uncovered error px lie on the full run's "${u.tag}", in ${held}; ${u.rule}`;
}

/**
 * The proposer's note for an uncovered layer: the layer, its pixel count and
 * largest body, the rule that skipped it, and the continuations — the plan is
 * not changed, because which one fits (the full run's resolution for the whole
 * part, or a second part behind it) is the author's to choose.
 */
export function uncoveredNote(u: UncoveredLayer, plan: readonly PlanEntry[], minPx: number): string {
  const total = u.bodies.reduce((a, b) => a + b.px, 0);
  const big = u.bodies[0];
  const held =
    u.bodies.length > 1 ? `${u.bodies.length} bodies of ${total} rig px, the largest ${big.px} px at ${bodyBox(big)},` : `a body of ${big.px} rig px at ${bodyBox(big)}`;
  const entry = plan.find((e) => e[2] === u.tag);
  const fix =
    entry === undefined
      ? `take it as a part: ["${aliasOf(u.tag)}", "full", "${u.tag}"]`
      : `take ${entry[0]} from the full run (["${entry[0]}", "full", "${u.tag}"]), or add the full-run layer as a second part drawn just behind ${entry[0]}`;
  return `${u.tag}: the full run's layer holds ${held} that no planned part covers (a body: at least ${fmt0(minPx)} rig px past a ${BODY_KERNEL}x${BODY_KERNEL} opening); ${u.rule} -> ${fix}`;
}

// ---------------------------------------------------------------------------
// --propose-plan
// ---------------------------------------------------------------------------

/**
 * The tags the reference proposes from the HEAD run. Its own set, kept
 * verbatim — it is not `src/tags.ts`'s head group: it adds the hair and the
 * neck, and it holds only the split forms of the eye, brow and ear tags, and
 * neither `eyewear` nor `nose`. So an unsplit `eyebrow`, or `eyewear`, is
 * proposed from the full run.
 */
export const PROPOSE_HEAD_TAGS: readonly string[] = [
  'back hair',
  'front hair',
  'face',
  'ears-r',
  'ears-l',
  'headwear',
  'earwear',
  'mouth',
  'neck',
  'eyewhite-r',
  'eyewhite-l',
  'irides-r',
  'irides-l',
  'eyelash-r',
  'eyelash-l',
  'eyebrow-r',
  'eyebrow-l',
];

/** The part name the reference proposes for a tag; any other tag becomes its own name with spaces and hyphens as underscores. */
export const PROPOSE_ALIAS: Readonly<Record<string, string>> = {
  'back hair': 'hair_back',
  'front hair': 'hair_front',
  footwear: 'shoes',
  'irides-r': 'iris_r',
  'irides-l': 'iris_l',
  'eyelash-r': 'lash_r',
  'eyelash-l': 'lash_l',
  'eyebrow-r': 'brow_r',
  'eyebrow-l': 'brow_l',
  'ears-r': 'ear_r',
  'ears-l': 'ear_l',
  headwear: 'hairpin',
  earwear: 'earring',
};

/** An author-made layer's part is named by its label as the author wrote it (issue #256): the label is already a part name (`authorLabelOk`). */
function aliasOf(tag: string): string {
  const author = readAuthorTag(tag);
  if (author !== null) return author.label;
  return PROPOSE_ALIAS[tag] ?? tag.replaceAll(' ', '_').replaceAll('-', '_');
}

export interface PlanProposal {
  plan: PlanEntry[];
  extend_below_crop: Extend[];
  notes: string[];
}

/** Python's `%.0f`: round half to even on the binary value. */
function fmt0(v: number): string {
  const f = Math.floor(v);
  const d = v - f;
  const r = d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;
  return String(r);
}

/**
 * A default `assemble.plan` and `extend_below_crop` from the two runs, with
 * notes on every choice that was not the default.
 *
 * ⚖️ Invariant (`assemble_parts.py` `propose_plan`): a tag is proposable when
 * it is not `nose` and holds at least `PROPOSE_MIN_PX` run pixels of alpha
 * above 8 after ghost clean-up. Head tags (`PROPOSE_HEAD_TAGS`) come from the
 * head run, the rest from the full run. Order, back to front: `back hair`;
 * the body layers in the full run's draw order, with `neck` placed just before
 * the first of topwear, bottomwear or neckwear; then the remaining head layers
 * in the head run's draw order. A `headwear`/`earwear` the head run drops or
 * shrinks (its rig-pixel area below 0.8 of the full run's) is taken from the
 * full run instead, drawn right after `back hair` — noted. `front hair` and
 * `back hair` taken from the head run are extended below the crop from the
 * full run when the full run's layer reaches more than 8 rig pixels below the
 * crop line. A lone `handwear` layer is named `sleeves`.
 *
 * ⚖️ This port's, not the reference's: a layer that crosses a plausibility
 * rule (`implausibleRules` in `src/layers.ts` — mostly translucent, a pale
 * background-coloured haze, or out of proportion with the rest of its run's
 * figure) is neither proposed, nor taken as the head-run fallback, nor extended
 * below the crop, and a note names the layer, its three figures and every rule
 * it crossed with the bar. Those notes come last. [observed] No layer of a
 * public example crosses a rule.
 *
 * ⚖️ This port's too (issue #233): the proposer measures what its own plan
 * leaves uncovered before it prints it. Every plan entry's layer is warped
 * into the rig and every extend entry's `belowCrop` selection added
 * (`planCoverage`); a full-run layer no entry takes from the full run whose
 * uncovered pixels hold a body (`uncoveredLayers`, `bodyMinPx`) gets a note
 * after the reference's, naming the body, the rule that skipped it
 * (`skippedBy`) and the two continuations (`uncoveredNote`). The plan is not
 * changed. [observed] reference-sample's proposal is the reference's byte for
 * byte; demo's, reference-demo's and scarf's each gain one note, on the hair
 * their configs had already corrected by hand.
 *
 * ⚖️ This port's too (issue #256): an author-made layer (`author:<label>`,
 * `src/tags.ts`) is proposed from the run that holds it, at its place in that
 * run's draw order, as the part named by its label, under the same floor and
 * plausibility rules as any layer — its draw position is then the plan's,
 * where the author moves it. A note per such part says it has no tag and so
 * no role. One both runs hold is proposed once, from the full run, and a note
 * says how to take the head run's too. No public example holds one, so no
 * proposal of theirs moves.
 *
 * ⚖️ This port's too (issue #308): every tag a layer of either run holds that
 * no plan row or extend entry takes is named once, with why, run by run
 * (`unplannedNotes`), after the uncovered bodies and before the plausibility
 * drops. The plan is not changed. [observed] On the four public examples the
 * plan, the extend entries and every earlier note are byte for byte as
 * before; each gains one such note per tag left out (demo 6, scarf 9,
 * reference-demo 7, reference-sample 9).
 */
export function proposePlan(full0: LayerSet, head0: LayerSet, g: Geometry, minPx = PROPOSE_MIN_PX): PlanProposal {
  const frame = checkGeometry(g, { full: full0, head: head0 });
  // Issue #366: one run's file, padded to the resolution square as the stage pads it.
  const fullPadded = g.single === true ? padSingleRun(full0, frame, g.resolution) : full0;
  // Issue #439: when seethrough.arm_split is declared, split the full run's overlapping handwear into handwear-r and handwear-l.
  const fullArmSplit = g.armSplit === undefined ? fullPadded : applyArmSplit(fullPadded, g.resolution, g.armSplit);
  // Issue #490: when generation.control.skeleton is present, split merged arm layers (or refuse when sleeve and drape share one colour).
  const mergedSplit = g.keySkeleton === undefined ? { set: fullArmSplit, notes: [] as string[] } : splitMergedArmRunsWithNotes(fullArmSplit, g.resolution, frame, g.sourceW, g.sourceH, g.keySkeleton);
  const full = mergedSplit.set;
  // Issue #492: check (and when head_face_underfill: true, repair) a hollow head-run face against full:face mapped into the head canvas.
  const headFacePrep =
    g.single === true
      ? { head: full, underfillPx: 0, underfillNote: null as string | null }
      : prepareHeadFace(full, head0, frame, g.resolution, g.headFaceUnderfill === true, minPx);
  const head = headFacePrep.head;
  const runs = { full: runLayers(full, g.resolution), head: runLayers(head, g.resolution) };
  const find = (run: Run, tag: string): RunLayer | undefined => runs[run].find((l) => l.tag === tag);
  const figures: Record<Run, LayerFigures[]> = { full: layerFigures(full), head: layerFigures(head) };
  const dropNotes: string[] = [];
  const noted = new Set<string>();
  /** The plausibility rules `run:tag` crosses; the first time a consulted layer crosses any, a note says so. */
  const implausible = (run: Run, tag: string, what: string): boolean => {
    const f = figures[run].find((x) => x.name === tag);
    const rules = f === undefined ? [] : implausibleRules(f);
    if (f === undefined || rules.length === 0) return false;
    if (!noted.has(`${run}:${tag}`)) {
      noted.add(`${run}:${tag}`);
      dropNotes.push(`${tag}: ${run} run layer ${figuresPhrase(f)} -> ${what} by ${rules.map((r) => `${r} (${ruleSummary(r)})`).join(', ')}`);
    }
    return true;
  };
  const ok = (run: Run, tag: string): boolean => {
    const l = find(run, tag);
    const floor = ARM_MERGED_SPLIT_TAGS.some((p) => tag === `${p}-r` || tag === `${p}-l`) ? 1 : minPx;
    return tag !== 'nose' && l !== undefined && l.opaqueRunPx >= floor && !implausible(run, tag, 'not proposed');
  };
  const body = runs.full.filter((l) => !PROPOSE_HEAD_TAGS.includes(l.tag) && ok('full', l.tag)).map((l) => l.tag);
  // Issue #256: an author-made layer is proposed from the run that holds it, at its place in that run's draw order,
  // like any layer; one both runs hold is proposed once, from the full run when the full run's is proposed, and the note says so.
  const authorBoth = runs.head.filter((l) => readAuthorTag(l.tag) !== null && body.includes(l.tag)).map((l) => l.tag);
  const heads = runs.head.filter((l) => (PROPOSE_HEAD_TAGS.includes(l.tag) || (readAuthorTag(l.tag) !== null && !authorBoth.includes(l.tag))) && ok('head', l.tag)).map((l) => l.tag);
  const hw = body.filter((t) => t.startsWith('handwear'));
  const plan: PlanEntry[] = [];
  const drop = (t: string): void => {
    const i = heads.indexOf(t);
    if (i >= 0) heads.splice(i, 1);
  };
  if (heads.includes('back hair')) {
    plan.push([PROPOSE_ALIAS['back hair'], 'head', 'back hair']);
    drop('back hair');
  }
  let neckDone = !heads.includes('neck');
  for (const t of body) {
    if (!neckDone && (t === 'topwear' || t === 'bottomwear' || t === 'neckwear')) {
      plan.push(['neck', 'head', 'neck']);
      drop('neck');
      neckDone = true;
    }
    plan.push([t.startsWith('handwear') && hw.length === 1 ? 'sleeves' : aliasOf(t), 'full', t]);
  }
  const notes: string[] = [...mergedSplit.notes, ...(headFacePrep.underfillNote === null ? [] : [headFacePrep.underfillNote])];
  const headArea = (frame.headK * frame.S) ** 2;
  const fullArea = (frame.fullK * frame.S) ** 2;
  for (const t of ['headwear', 'earwear']) {
    const hl = find('head', t);
    const fl = find('full', t);
    const hp = hl !== undefined ? hl.opaqueRunPx * headArea : 0;
    const fp = fl !== undefined ? fl.opaqueRunPx * fullArea : 0;
    if (ok('full', t) && hp < 0.8 * fp) {
      drop(t);
      const at = plan.length > 0 && plan[0][2] === 'back hair' ? 1 : 0;
      plan.splice(at, 0, [PROPOSE_ALIAS[t], 'full', t]);
      notes.push(`${t}: head run ${fmt0(hp)} rig px < 0.8 x full run ${fmt0(fp)} -> full-run layer, drawn behind the face`);
    }
  }
  for (const t of heads) plan.push([aliasOf(t), 'head', t]);
  for (const [part, run, tag] of plan) {
    if (readAuthorTag(tag) !== null) notes.push(`${tag}: ${AUTHOR_NO_ROLE}; proposed as "${part}" from the ${run} run, at its place in that run's draw order`);
  }
  for (const tag of authorBoth) {
    notes.push(`${tag}: the head run holds a layer of this name too, and the proposer drafts one part per author-made layer, from the full run; to take the head run's as well, add ["<a part name>", "head", "${tag}"] to the plan`);
  }
  const extend: Extend[] = [];
  /** A hair tag the proposer did not continue below the crop: how far its full-run layer reaches, rig px (null: no opaque row). */
  const reaches = new Map<string, number | null>();
  for (const t of ['front hair', 'back hair']) {
    const fl = find('full', t);
    if (fl === undefined || !plan.some((p) => p[1] === 'head' && p[2] === t)) continue;
    if (implausible('full', t, 'not extended below the crop')) continue;
    let last = -1;
    const n = g.resolution;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (fl.canvas.data[(y * n + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE) {
          last = y;
          break;
        }
      }
    }
    // The run row maps to the rig as the warp maps it: k * row, less the top pad in rig px.
    const reach = (last + 1) * frame.fullK * frame.S - frame.fullPadTop * frame.S;
    if (last >= 0 && reach > frame.headBottom + 8) extend.push({ part: PROPOSE_ALIAS[t], run: 'full', tag: t });
    else reaches.set(t, last < 0 ? null : reach);
  }
  // What the plan leaves uncovered (issue #233): a full-run layer whose body no planned part covers is named, never dropped in silence.
  const rigs = new Map<string, Raster>();
  const rigOf = (run: Run, tag: string): Raster => {
    const key = `${run}:${tag}`;
    let r = rigs.get(key);
    if (r === undefined) {
      r = layerToRig((find(run, tag) as RunLayer).canvas, frame, run);
      rigs.set(key, r);
    }
    return r;
  };
  const covered = planCoverage(plan, extend, rigOf, frame.headBottom);
  const minBody = bodyMinPx(frame, minPx);
  const why = (tag: string): string => {
    if (!reaches.has(tag)) return 'the proposer continues only front hair and back hair below the head crop';
    const r = reaches.get(tag);
    return `the proposer continues ${tag} only when its full-run layer reaches more than 8 rig px below the crop line, rig row ${frame.headBottom}; it reaches ${r === null || r === undefined ? 'no row' : `rig row ${fmt0(r)}`}`;
  };
  const left =
    covered.length === 0
      ? []
      : uncoveredLayers(
          runs.full.filter((l) => l.opaqueRunPx > 0).map((l) => ({ tag: l.tag, rig: rigOf('full', l.tag) })),
          covered,
          plan,
          extend,
          figures.full,
          (tag) => rigOf('head', tag),
          frame.headBottom,
          minBody,
          why,
        );
  const bodyNotes = left.map((u) => uncoveredNote(u, plan, minBody));
  const unplanned = unplannedNotes(runs, plan, extend, noted, figures, minPx, (run, tag) => (find(run, tag)?.opaqueRunPx ?? 0) * (run === 'head' ? headArea : fullArea), new Set(left.map((u) => u.tag)));
  // The reference's notes, then the uncovered bodies, then the layers in no row (issue #308), then the plausibility drops — a drop note is last, as it was.
  return { plan, extend_below_crop: extend, notes: [...notes, ...bodyNotes, ...unplanned, ...dropNotes] };
}

/**
 * `--propose-plan` over one run (issue #359): the run is held to
 * {@link checkSingleRun}, proposed as both runs (`proposePlan(full, full)`,
 * whose two maps are one when `g` is {@link singleRunHeadBox}'s), and every
 * row the proposer drafts from the head run is written from the full run —
 * there is no other. No row is dropped and none moves: the plan is the
 * proposer's, in its order. The first note says so, because the notes after
 * it still speak of a head run, meaning this same file.
 */
export function proposeSinglePlan(full: LayerSet, g: Geometry, minPx = PROPOSE_MIN_PX): PlanProposal {
  checkSingleRun(full, null, null);
  const p = proposePlan(full, full, { ...g, single: true }, minPx);
  const plan = p.plan.map(([name, , tag]): PlanEntry => [name, 'full', tag]);
  return {
    plan,
    extend_below_crop: p.extend_below_crop,
    // The proposer's note offering a head-run row for an author-made layer both runs hold is about two runs; with one it offers a row the stage refuses.
    notes: [`one run: no --head, so ${full.source} is read as both runs; every row is written from the full run, and "the head run" in a note below is this same file`, ...p.notes.filter((n) => !n.includes(': the head run holds a layer of this name too'))],
  };
}

/** What every `--propose-plan` note on a layer in no row says its pixel figures are. */
export const UNPLANNED_PX = 'px: run pixels of alpha above 8 after ghost clean-up';

/**
 * One note per tag that a layer of either run holds and no plan row or
 * extend entry takes (issue #308), in the full run's draw order and then the
 * head run's, saying for each run why: it holds no such layer; the proposer
 * takes the tag from the other run only (`PROPOSE_HEAD_TAGS`); its layer is
 * empty, its opaque count below the floor (`PROPOSE_MIN_PX`); it crosses a
 * plausibility rule (that layer's own note, which follows, names its figures);
 * or, for a full-run `headwear` or `earwear`, the head run's was not below 0.8
 * of it in rig px. A tag every holding run of which a plausibility note
 * already names gets no second note. `nose`, which the proposer never plans
 * (the reference's rule), gets a note of its own: the counts, and the row that
 * lets `propose` read the head's pitch, the only reading in this package made
 * off a part tagged `nose` (`headFrameNotes`, `src/propose.ts`). The plan is
 * not changed.
 */
function unplannedNotes(
  runs: Record<Run, RunLayer[]>,
  plan: readonly PlanEntry[],
  extend: readonly Extend[],
  noted: ReadonlySet<string>,
  figures: Record<Run, LayerFigures[]>,
  minPx: number,
  rigPx: (run: Run, tag: string) => number,
  bodies: ReadonlySet<string>,
): string[] {
  const inRow = new Set<string>([...plan.map((p) => p[2]), ...extend.map((e) => e.tag)]);
  const find = (run: Run, tag: string): RunLayer | undefined => runs[run].find((l) => l.tag === tag);
  const floor = minPx === PROPOSE_MIN_PX ? `the proposer's floor of ${minPx} (PROPOSE_MIN_PX, src/assemble.ts)` : `the floor of ${minPx} this proposal was given`;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { tag } of [...runs.full, ...runs.head]) {
    if (seen.has(tag) || inRow.has(tag)) continue;
    seen.add(tag);
    const held = (['full', 'head'] as const).filter((r) => find(r, tag) !== undefined);
    const body = bodies.has(tag) ? "; the full run's layer holds a body no planned part covers, named in its note above" : '';
    if (tag === 'nose') {
      const counts = (['full', 'head'] as const).map((r) => `${r} run ${find(r, tag)?.opaqueRunPx ?? 'no layer'}${find(r, tag) === undefined ? '' : ' px'}`).join(', ');
      const best = (['head', 'full'] as const).reduce((a, b) => ((find(b, tag)?.opaqueRunPx ?? 0) > (find(a, tag)?.opaqueRunPx ?? 0) ? b : a));
      const most = find(best, tag)?.opaqueRunPx ?? 0;
      const after = plan.some((p) => p[2] === 'face') ? ` after the row that takes "face"` : '';
      const how =
        most === 0
          ? 'neither run\'s layer holds a pixel, so there is no nose part to add'
          : `propose reads the head's pitch (where the nose sits between the eye midpoint and the mouth) only off a part tagged nose, and without one prints "not read: no part tagged nose"; to have it read, add ["nose", "${best}", "nose"] to assemble.plan${after} (the ${best} run's layer holds the more of it) and run assemble and propose again`;
      out.push(`nose: in no plan row — the proposer never plans nose (the reference implementation's rule, which this port keeps); ${counts} (${UNPLANNED_PX}); ${how}${body}`);
      continue;
    }
    if (held.every((r) => noted.has(`${r}:${tag}`))) continue;
    const reason = (run: Run): string => {
      const l = find(run, tag);
      if (l === undefined) return `${run} run: no layer`;
      const px = `${run} run: ${l.opaqueRunPx} px`;
      const headTag = PROPOSE_HEAD_TAGS.includes(tag);
      const fallback = tag === 'headwear' || tag === 'earwear';
      if (run === 'full' && headTag && !fallback) return `${px}, but the proposer takes ${tag} from the head run only (PROPOSE_HEAD_TAGS, src/assemble.ts)`;
      if (run === 'head' && !headTag && readAuthorTag(tag) === null) return `${px}, but the proposer takes ${tag} from the full run only (it is not one of PROPOSE_HEAD_TAGS, src/assemble.ts)`;
      if (l.opaqueRunPx < minPx) return `${px}, empty: below ${floor}`;
      if (noted.has(`${run}:${tag}`)) {
        const f = figures[run].find((x) => x.name === tag) as LayerFigures;
        return `${px}, crosses ${implausibleRules(f).join(', ')} (named with its figures in the note below)`;
      }
      if (run === 'full' && fallback) {
        return `${px}, but the proposer takes ${tag} from the full run only when the head run's is below 0.8 of it in rig px (head run ${fmt0(rigPx('head', tag))}, full run ${fmt0(rigPx('full', tag))})`;
      }
      throw new Error(`unplannedNotes: no rule left ${run}:${tag} out of the plan, yet no row takes it`);
    };
    out.push(`${tag}: in no plan row — ${(['full', 'head'] as const).map(reason).join('; ')} (${UNPLANNED_PX})${body}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// what the stage reads from a config
// ---------------------------------------------------------------------------

/**
 * The config fields the stage reads: `seethrough.resolution` and `.head_box`,
 * `assemble.rig_scale`, `.plan`, `.extend_below_crop`, `.patches` and `.cuts` — and
 * nothing of the rig. The CLI hands it a config from
 * `parseEarlyConfig(raw, 'assemble')`; a config the full loader accepted is
 * the same shape with more in it. The head box is refused here rather than by
 * the loader, because `inputs` runs before it exists; `seethrough` too, for a
 * full-loader config, where it is optional.
 */
export function stageFields(
  cfg: Pick<CharacterConfig, 'seethrough' | 'assemble' | 'scene'> & { limbs?: Record<string, Limb>; bones?: BoneEntry[] },
  single: { w: number; h: number } | null = null,
): {
  resolution: number;
  headBox: [number, number, number, number];
  rigScale: number;
  plan: PlanEntry[];
  extend: Extend[];
  patches: Patch[];
  cuts: Cut[];
  scene?: boolean;
  limbs?: Record<string, Limb>;
  bones?: BoneEntry[];
  single?: boolean;
  armSplit?: ArmSplit;
  keySkeleton?: ControlSkeleton;
  headFaceUnderfill?: boolean;
} {
  const problems: Problem[] = [];
  if (cfg.seethrough === undefined) {
    problems.push({ code: 'ASSEMBLE_FIELD_PRESENT', object: 'config.seethrough', detail: 'is absent; assemble reads seethrough.resolution and seethrough.head_box, which place the two runs on the painting' });
  } else if (single !== null) problems.push(...singleRunHeadBoxProblems(cfg.seethrough));
  else if (cfg.seethrough.head_box === undefined) {
    problems.push({ code: 'ASSEMBLE_FIELD_PRESENT', object: 'config.seethrough.head_box', detail: 'is absent; the head run cannot be placed on the painting without the box it was cropped from' });
  }
  refuseIfAny(problems);
  const st = cfg.seethrough as SeeThrough;
  const keySkeleton = controlSkeletonOf(cfg);
  return {
    resolution: st.resolution,
    headBox: single !== null ? singleRunHeadBox(single.w, single.h, st.resolution) : (st.head_box as [number, number, number, number]),
    ...(single !== null ? { single: true } : {}),
    ...(st.arm_split === undefined ? {} : { armSplit: st.arm_split }),
    ...(keySkeleton === undefined ? {} : { keySkeleton }),
    ...(cfg.assemble.head_face_underfill === undefined ? {} : { headFaceUnderfill: cfg.assemble.head_face_underfill }),
    rigScale: cfg.assemble.rig_scale,
    plan: cfg.assemble.plan,
    extend: cfg.assemble.extend_below_crop ?? [],
    patches: cfg.assemble.patches ?? [],
    cuts: cfg.assemble.cuts ?? [],
    ...(cfg.scene === undefined ? {} : { scene: true }),
    ...(cfg.limbs === undefined ? {} : { limbs: cfg.limbs, bones: cfg.bones ?? [] }),
  };
}

/**
 * The three numbers `--propose-plan` reads, from a config that does not have a
 * plan yet. The config comes through `parseEarlyConfig` (`src/config.ts`), the
 * one partial entry point, which has already checked the fields with the full
 * loader's rules; what is left here is that this stage needs the head box,
 * which that loader leaves optional.
 */
export function proposeFields(
  cfg: EarlyConfig,
  single: { w: number; h: number } | null = null,
): { resolution: number; headBox: [number, number, number, number]; rigScale: number; single?: boolean; armSplit?: ArmSplit; keySkeleton?: ControlSkeleton; headFaceUnderfill?: boolean } {
  const armSplit = cfg.seethrough.arm_split === undefined ? {} : { armSplit: cfg.seethrough.arm_split };
  const keySkeleton = controlSkeletonOf(cfg);
  const skelField = keySkeleton === undefined ? {} : { keySkeleton };
  const underfillField = cfg.assemble.head_face_underfill === undefined ? {} : { headFaceUnderfill: cfg.assemble.head_face_underfill };
  if (single !== null) {
    refuseIfAny(singleRunHeadBoxProblems(cfg.seethrough));
    return { resolution: cfg.seethrough.resolution, headBox: singleRunHeadBox(single.w, single.h, cfg.seethrough.resolution), rigScale: cfg.assemble.rig_scale, single: true, ...armSplit, ...skelField, ...underfillField };
  }
  if (cfg.seethrough.head_box === undefined) {
    refuseIfAny([{ code: 'ASSEMBLE_FIELD_PRESENT', object: 'config.seethrough.head_box', detail: 'is absent; the plan is proposed from both runs, and the head run cannot be placed on the painting without the box it was cropped from — run `propose --head-box` first' }]);
  }
  return { resolution: cfg.seethrough.resolution, headBox: cfg.seethrough.head_box as [number, number, number, number], rigScale: cfg.assemble.rig_scale, ...armSplit, ...skelField, ...underfillField };
}

/**
 * A single run's config (issue #359) sets no `seethrough.head_box`: the box
 * places a head run cut from the painting, and with no `--head` there is none,
 * so a box there would be a value nothing reads (`ASSEMBLE_SINGLE_RUN_HEAD_BOX`).
 */
function singleRunHeadBoxProblems(st: Pick<SeeThrough, 'head_box'>): Problem[] {
  if (st.head_box === undefined) return [];
  return [
    {
      code: 'ASSEMBLE_SINGLE_RUN_HEAD_BOX',
      object: 'config.seethrough.head_box',
      detail: `is [${st.head_box.join(', ')}], and with no --head there is no head run for it to place; no head_box is required with one run — remove it, or give the head run with --head`,
    },
  ];
}
