/**
 * A figure of one material (issue #577), generated: a 256x256 PSD whose whole
 * body — neck, torso, both arms, both legs — is one `topwear` layer, as
 * See-through returns a wooden mannequin or a statue, with `legwear` and
 * `footwear` near-empty, a separate `face`, the painting the file flattens to,
 * the single-run config and a hand-written keypoint file. Flat colour blocks
 * (the figure in horizontal bands, below): nothing here is art and nothing
 * here stands for any; every count below is computed by hand from the
 * rectangles.
 *
 * ## Why every number is exact
 *
 * The canvas is the painting's size and `seethrough.resolution` (256), and
 * `rig_scale` is 1: one run maps to the rig by the identity (the artist
 * fixture's argument, `fixtures/artist.ts`), so a layer's rig pixels are its
 * canvas pixels and a joint's painting px are its rig px.
 *
 * ## The layers, bottom first (x0, y0, x1, y1; right and bottom exclusive)
 *
 * - `legwear` [112, 150, 120, 158]: 8 x 8 = 64 px, and `footwear`
 *   [114, 222, 120, 228]: 6 x 6 = 36 px, both under the topwear and both
 *   below the proposer's floor of 150 (`PROPOSE_MIN_PX`, `src/assemble.ts`),
 *   so `assemble --propose-plan` plans neither and no legwear part exists
 *   (its note reads the footwear as 0 px: assemble's ghost clean-up removes
 *   all 36, measured).
 * - `topwear`, the figure, five rectangles that share no pixel: the neck
 *   [122, 50, 134, 70] 12 x 20 = 240 px (its rows 50..55 under the face); the
 *   torso [104, 70, 152, 130] 48 x 60 = 2,880 px; the arms straight out, `r`
 *   (the subject's right, image left) [40, 72, 104, 84] and `l`
 *   [152, 72, 216, 84], 64 x 12 = 768 px each; the legs, `r`
 *   [108, 130, 124, 230] and `l` [132, 130, 148, 230], 16 x 100 = 1,600 px
 *   each, 8 px apart. In all 240 + 2,880 + 2 x 768 + 2 x 1,600 = 7,856 px.
 *   Every row y with floor(y / 4) odd is `GRAIN`, every other `WOOD`: the
 *   bands give the breath edges to move, where a flat block shows a 1.6 px
 *   breath only at its rim (`BREATH_VISIBLE` read 1.713 on this figure in one
 *   colour and 4.457 banded, against its floor 3.809 — measured, issue #577).
 * - `face` [104, 8, 152, 56]: 48 x 48 = 2,304 px, `SKIN`, over the neck's top
 *   6 rows. The rest of the figure is then 2,304 + 64 + 36 = 2,404 px and the
 *   topwear 7,856 / 2,404 = 3.268 times it, under the 4 times above which
 *   `--propose-plan` leaves a layer out (`PLAN_LAYER_OVERSIZED`).
 * - `eyewhite-r` [110, 24, 126, 34] and `eyewhite-l` [130, 24, 146, 34]:
 *   16 x 10 = 160 px each, `EYE` (box centres x 118 and 138: the eye axis is
 *   x 128, the figure's centre line), inside the face.
 *
 * ## The joints ({@link MANNEQUIN_KEYPOINTS})
 *
 * On the art, each on its block's centre line: `neck` (128, 62); the
 * shoulders (100, 78) and (156, 78), the elbows (72, 78) and (184, 78), the
 * wrists (46, 78) and (210, 78) — 6 px in from each hand's end; the hips
 * (116, 126) and (140, 126), so the `hip` bone, their midpoint, is (128, 126)
 * and `chest`, half way to the neck, (128, 94); the knees (116, 180) and
 * (140, 180), the ankles (116, 224) and (140, 224); `nose` (128, 40).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEYPOINTS_SPACE, KEYPOINTS_SPEC } from '../src/keypoints.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { type ProposeFixturePart } from './propose.ts';
import { writePsdFixture } from './synthetic.ts';

type RGB = [number, number, number];
type Box = [number, number, number, number];

export const MANNEQUIN_SIDE = 256;
export const WOOD: RGB = [190, 150, 110];
export const SKIN: RGB = [225, 190, 160];
export const LEGWEAR: RGB = [60, 60, 70];
export const FOOTWEAR: RGB = [60, 40, 30];
/** The grain: every row y with floor(y / 4) odd takes it in place of `WOOD` (module comment). */
export const GRAIN: RGB = [90, 60, 35];
export const EYE: RGB = [245, 245, 250];

/** The topwear's five blocks, by what they are. */
export const MANNEQUIN_BLOCKS: Record<'neck' | 'torso' | 'arm_r' | 'arm_l' | 'leg_r' | 'leg_l', Box> = {
  neck: [122, 50, 134, 70],
  torso: [104, 70, 152, 130],
  arm_r: [40, 72, 104, 84],
  arm_l: [152, 72, 216, 84],
  leg_r: [108, 130, 124, 230],
  leg_l: [132, 130, 148, 230],
};

/** The topwear's opaque pixels: 240 + 2,880 + 2 x 768 + 2 x 1,600. */
export const MANNEQUIN_FIGURE_PX = 7856;

export interface MannequinLayer {
  name: string;
  box: Box;
  rects: Array<[Box, RGB]>;
  /** The colour of every row y with floor(y / 4) odd, in place of the rectangle's own. */
  grain?: RGB;
}

/** The layers, bottom first. */
export function mannequinLayers(): MannequinLayer[] {
  return [
    { name: 'legwear', box: [112, 150, 120, 158], rects: [[[112, 150, 120, 158], LEGWEAR]] },
    { name: 'footwear', box: [114, 222, 120, 228], rects: [[[114, 222, 120, 228], FOOTWEAR]] },
    { name: 'topwear', box: [40, 50, 216, 230], rects: Object.values(MANNEQUIN_BLOCKS).map((b): [Box, RGB] => [b, WOOD]), grain: GRAIN },
    { name: 'face', box: [104, 8, 152, 56], rects: [[[104, 8, 152, 56], SKIN]] },
    { name: 'eyewhite-r', box: [110, 24, 126, 34], rects: [[[110, 24, 126, 34], EYE]] },
    { name: 'eyewhite-l', box: [130, 24, 146, 34], rects: [[[130, 24, 146, 34], EYE]] },
  ];
}

/** A layer's own pixels, `(x1 - x0) x (y1 - y0)`, transparent outside its rectangles. */
export function mannequinRaster(l: MannequinLayer): Raster {
  const [bx, by, bx1, by1] = l.box;
  const r = newRaster(bx1 - bx, by1 - by);
  for (const [[x0, y0, x1, y1], c] of l.rects) {
    for (let y = y0; y < y1; y++) {
      const rgb = l.grain !== undefined && Math.floor(y / 4) % 2 === 1 ? l.grain : c;
      for (let x = x0; x < x1; x++) r.data.set([...rgb, 255], ((y - by) * r.width + (x - bx)) * 4);
    }
  }
  return r;
}

/**
 * The same figure as assembled parts (`fixtures/propose.ts`'s form), for the proposer's own controls: the topwear
 * part `figure` (full:topwear) over its box 40,50 176x180 with the five blocks opaque, and `face` (full:face).
 */
export const MANNEQUIN_PARTS: ProposeFixturePart[] = [
  { name: 'figure', from: 'full:topwear', x: 40, y: 50, w: 176, h: 180, colour: WOOD, rects: Object.values(MANNEQUIN_BLOCKS).map(([x0, y0, x1, y1]): [number, number, number, number] => [x0, y0, x1 - x0, y1 - y0]) },
  { name: 'face', from: 'full:face', x: 104, y: 8, w: 48, h: 48, colour: SKIN },
  { name: 'eyewhite_r', from: 'full:eyewhite-r', x: 110, y: 24, w: 16, h: 10, colour: EYE },
  { name: 'eyewhite_l', from: 'full:eyewhite-l', x: 130, y: 24, w: 16, h: 10, colour: EYE },
];

/** The layers composited bottom first on white: the painting the file flattens to. */
export function mannequinPainting(): Raster {
  const s = MANNEQUIN_SIDE;
  const p = newRaster(s, s);
  for (let i = 0; i < s * s; i++) p.data.set([255, 255, 255, 255], i * 4);
  for (const l of mannequinLayers()) {
    const r = mannequinRaster(l);
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        const k = (y * r.width + x) * 4;
        if (r.data[k + 3] > 0) p.data.set(r.data.subarray(k, k + 4), ((l.box[1] + y) * s + l.box[0] + x) * 4);
      }
    }
  }
  return p;
}

/** The plan `assemble --propose-plan` writes for the file (every row from the one run; legwear and footwear below the floor). */
export const MANNEQUIN_PLAN: Array<[string, 'full', string]> = [
  ['topwear', 'full', 'topwear'],
  ['face', 'full', 'face'],
  ['eyewhite_r', 'full', 'eyewhite-r'],
  ['eyewhite_l', 'full', 'eyewhite-l'],
];

/** The single-run config assemble reads: no `seethrough.head_box`, the plan, and nothing a rig needs yet. */
export function mannequinConfig(plan: Array<[string, 'full', string]> = MANNEQUIN_PLAN): Record<string, unknown> {
  return {
    key: 'mannequin-fixture',
    seethrough: { resolution: MANNEQUIN_SIDE, steps: 1, seed: 0, offload: false },
    assemble: { rig_scale: 1, plan },
  };
}

type J = { state: 'observed'; at: [number, number] };
const obs = (x: number, y: number): J => ({ state: 'observed', at: [x, y] });

/** The keypoint file, every body joint observed on the art (module comment), as JSON. */
export const MANNEQUIN_KEYPOINTS: Record<string, unknown> = {
  spec: KEYPOINTS_SPEC,
  space: { ...KEYPOINTS_SPACE },
  width: MANNEQUIN_SIDE,
  height: MANNEQUIN_SIDE,
  source: 'hand-written for the rig-parts selftest',
  people: [
    {
      id: 'a',
      joints: {
        nose: obs(128, 40),
        neck: obs(128, 62),
        r_shoulder: obs(100, 78),
        r_elbow: obs(72, 78),
        r_wrist: obs(46, 78),
        l_shoulder: obs(156, 78),
        l_elbow: obs(184, 78),
        l_wrist: obs(210, 78),
        r_hip: obs(116, 126),
        l_hip: obs(140, 126),
        r_knee: obs(116, 180),
        l_knee: obs(140, 180),
        r_ankle: obs(116, 224),
        l_ankle: obs(140, 224),
      },
    },
  ],
};

/** The fixture in `dir`: `art.psd`, `painting.png` (always the one-figure composite), `config.json` and `keypoints.json`. */
export function writeMannequinFixture(dir: string, opts: { config?: Record<string, unknown> } = {}): void {
  mkdirSync(dir, { recursive: true });
  writePsdFixture(
    join(dir, 'art.psd'),
    MANNEQUIN_SIDE,
    MANNEQUIN_SIDE,
    mannequinLayers().map((l) => ({ name: l.name, left: l.box[0], top: l.box[1], pixels: mannequinRaster(l) })),
  );
  writeFileSync(join(dir, 'painting.png'), encodePngBytes(mannequinPainting()));
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(opts.config ?? mannequinConfig(), null, 2)}\n`);
  writeFileSync(join(dir, 'keypoints.json'), `${JSON.stringify(MANNEQUIN_KEYPOINTS, null, 2)}\n`);
}
