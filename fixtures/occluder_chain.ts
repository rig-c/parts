/**
 * Generated inputs for a declared occluder (issue #1230): a limb with a figure
 * standing in front of it, the decomposition of that painting (which leaves a
 * hole in the limb under the figure), and the decomposition of the
 * occluder-removed plate (which paints the limb whole).
 *
 * Every number below is a rectangle, so every count a control reads is
 * counted by hand: the limb is [16, 16, 112, 112], the occluder [48, 32, 80,
 * 96] (32 x 64 = 2,048 px, all enclosed by the limb), and the face group three
 * 8 px squares in the top row, as `hidden_extent.ts` places them.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleConfig } from './assemble_fixture.ts';
import { exportLayers, type Layer, type LayerSet } from '../src/layers.ts';
import { sha256 } from '../src/plate.ts';
import { decodePngBytes, encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { readLayerTag } from '../src/tags.ts';

export const SIDE = 128;
export const LIMB: [number, number, number, number] = [16, 16, 112, 112];
export const OCCLUDER: [number, number, number, number] = [48, 32, 80, 96];
export const LIMB_RGB: [number, number, number] = [60, 100, 160];
export const OCCLUDER_RGB: [number, number, number] = [180, 60, 40];
export const OCCLUDER_PX = (OCCLUDER[2] - OCCLUDER[0]) * (OCCLUDER[3] - OCCLUDER[1]);
export const DEEPER_OCCLUDER_DEPTH = 0.9;

const inside = (box: readonly number[], x: number, y: number): boolean => x >= box[0] && x < box[2] && y >= box[1] && y < box[3];

function fill(r: Raster, box: readonly number[], rgba: readonly number[]): void {
  for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) r.data.set(rgba, (y * r.width + x) * 4);
}

function layerSet(entries: ReadonlyArray<{ name: string; pixels: Raster; depth: number }>, source: string): LayerSet {
  const layers: Layer[] = entries.map(({ name, pixels, depth }, drawOrder) => {
    const tag = readLayerTag(name);
    if (tag === null) throw new Error(`generated tag ${name} does not resolve`);
    let opaquePx = 0;
    for (let p = 3; p < pixels.data.length; p += 4) if (pixels.data[p] > 8) opaquePx++;
    return { name, tag, pixels, file: null, left: 0, top: 0, right: SIDE, bottom: SIDE, depth, drawOrder, opaquePx };
  });
  return { form: 'wrapper', source, canvas: { w: SIDE, h: SIDE }, layers, hidden: [] };
}

function faceGroup(): Array<{ name: string; pixels: Raster; depth: number }> {
  return ['face', 'eyewhite-r', 'eyewhite-l'].map((name, k) => {
    const pixels = newRaster(SIDE, SIDE);
    fill(pixels, [2 + k * 12, 2, 10 + k * 12, 10], [90, 90, 90, 255]);
    return { name, pixels, depth: 0.5 - k * 0.01 };
  });
}

/** The painting: white, the face group, the limb, the occluder drawn over it. */
export function chainPainting(): Raster {
  const r = newRaster(SIDE, SIDE);
  r.data.fill(255);
  for (const { pixels } of faceGroup()) for (let p = 0; p < SIDE * SIDE; p++) if (pixels.data[p * 4 + 3] > 0) r.data.set(pixels.data.subarray(p * 4, p * 4 + 4), p * 4);
  fill(r, LIMB, [...LIMB_RGB, 255]);
  fill(r, OCCLUDER, [...OCCLUDER_RGB, 255]);
  return r;
}

/** The occluder: opaque over its rectangle, transparent zero elsewhere. */
export function chainOccluder(): Raster {
  const r = newRaster(SIDE, SIDE);
  fill(r, OCCLUDER, [...OCCLUDER_RGB, 255]);
  return r;
}

/** The occluder-removed plate: the painting with the limb whole where the occluder stood. */
export function chainPlate(): Raster {
  const r = newRaster(SIDE, SIDE);
  r.data.fill(255);
  for (const { pixels } of faceGroup()) for (let p = 0; p < SIDE * SIDE; p++) if (pixels.data[p * 4 + 3] > 0) r.data.set(pixels.data.subarray(p * 4, p * 4 + 4), p * 4);
  fill(r, LIMB, [...LIMB_RGB, 255]);
  return r;
}

/**
 * A plant in the limb layer of the painting's own decomposition, inside the
 * occluder's rectangle, against the painting's occluder colour there: `exact`
 * px of that colour, `within` px 20 off it on one channel, `beyond` px 21 off.
 * The copied-colour finding at `rgb_within: 20` counts `exact + within`.
 */
export interface Plant { exact: number; within: number; beyond: number }
export const PLANT: Plant = { exact: 120, within: 30, beyond: 30 };

/**
 * The decomposition of the painting itself: the limb with no pixel under the
 * occluder (See-through never paints what it cannot see), unless `plant`
 * paints some of the occluder's colour into it; the occluder as `objects`.
 */
export function originalRun(plant: Plant | null = null, occluderDepth = 0.2, extraLayers: ReadonlyArray<{ name: string; pixels: Raster; depth: number }> = []): LayerSet {
  const limb = newRaster(SIDE, SIDE), front = newRaster(SIDE, SIDE);
  for (let y = LIMB[1]; y < LIMB[3]; y++) for (let x = LIMB[0]; x < LIMB[2]; x++) if (!inside(OCCLUDER, x, y)) limb.data.set([...LIMB_RGB, 255], (y * SIDE + x) * 4);
  if (plant !== null) {
    // Planted rows from the occluder's top-left, row-major: exact, then 20 off, then 21 off.
    const colours = [...Array(plant.exact).fill(0), ...Array(plant.within).fill(20), ...Array(plant.beyond).fill(21)] as number[];
    const w = OCCLUDER[2] - OCCLUDER[0];
    colours.forEach((off, i) => limb.data.set([OCCLUDER_RGB[0] - off, OCCLUDER_RGB[1], OCCLUDER_RGB[2], 255], ((OCCLUDER[1] + Math.floor(i / w)) * SIDE + OCCLUDER[0] + (i % w)) * 4));
  }
  fill(front, OCCLUDER, [...OCCLUDER_RGB, 255]);
  return layerSet([...faceGroup(), { name: 'legwear', pixels: limb, depth: 0.7 }, { name: 'objects', pixels: front, depth: occluderDepth }, ...extraLayers], 'generated-original');
}

/** The painting's decomposition when See-through ranks the occluder deeper (`0.9`) than the limb (`0.7`, #1241). */
export function deeperOriginalRun(plant: Plant | null = null, extraLayers: ReadonlyArray<{ name: string; pixels: Raster; depth: number }> = []): LayerSet {
  return originalRun(plant, DEEPER_OCCLUDER_DEPTH, extraLayers);
}

/**
 * The decomposition of the occluder-removed plate, standing in for a See-through
 * run on it: the limb layer is the plate's own pixels over the whole limb (so
 * under the occluder it carries whatever the inpainting put there), and there
 * is no occluder layer — the plate holds none.
 */
export function plateRun(plate: Raster): LayerSet {
  const limb = newRaster(SIDE, SIDE);
  for (let y = LIMB[1]; y < LIMB[3]; y++) for (let x = LIMB[0]; x < LIMB[2]; x++) {
    const p = (y * SIDE + x) * 4;
    limb.data.set([plate.data[p], plate.data[p + 1], plate.data[p + 2], 255], p);
  }
  return layerSet([...faceGroup(), { name: 'legwear', pixels: limb, depth: 0.7 }], 'generated-plate');
}

const PLAN = [['face', 'full', 'face'], ['eye_r', 'full', 'eyewhite-r'], ['eye_l', 'full', 'eyewhite-l'], ['behind', 'full', 'legwear'], ['front', 'full', 'objects']];

/** The config: one run at 128, rig scale 1; `extra` merged into `assemble`. */
export function chainConfig(extra: Record<string, unknown>): Record<string, unknown> {
  const cfg = assembleConfig({ plan: PLAN, extend: [], resolution: SIDE, rigScale: 1 });
  delete (cfg.seethrough as Record<string, unknown>).head_box;
  return { ...cfg, assemble: { ...(cfg.assemble as object), ...extra } };
}

/** `painting.png`, `occluder.png` and the painting's decomposition (`orig/`, with the meta a take reads) in `dir`. */
export function writeChainInputs(dir: string, plant: Plant | null = null, occluderDepth = 0.2, extraLayers: ReadonlyArray<{ name: string; pixels: Raster; depth: number }> = []): { painting: string; occluder: string; occluderSha: string } {
  mkdirSync(dir, { recursive: true });
  const painting = join(dir, 'painting.png'), occluder = join(dir, 'occluder.png');
  writeFileSync(painting, encodePngBytes(chainPainting()));
  const occluderBytes = encodePngBytes(chainOccluder());
  writeFileSync(occluder, occluderBytes);
  exportLayers(originalRun(plant, occluderDepth, extraLayers), join(dir, 'orig'));
  writeFileSync(join(dir, 'orig', 'meta.json'), JSON.stringify({ prompt_id: 'generated-original', seed: 42 }));
  return { painting, occluder, occluderSha: sha256(occluderBytes) };
}

/** The plate's decomposition in `<dir>/plate-run`, its meta binding the plate's bytes as a See-through run's would. */
export function writePlateRun(dir: string, plateBytes: Uint8Array): string {
  const out = join(dir, 'plate-run');
  exportLayers(plateRun(decodePngBytes(plateBytes, 'plate.png')), out);
  writeFileSync(join(out, 'meta.json'), JSON.stringify({ prompt_id: 'generated-plate', seed: 7, image_sha256: sha256(plateBytes) }));
  return out;
}

/**
 * Partial-`over` twin (issue #1246):
 * - The occluder rectangle is `OCCLUDER` (`[48, 32, 80, 96]`, `2,048` px).
 * - The `over` part (`front`, `full:objects`) covers only the upper half
 *   `PARTIAL_OVER_BOX` (`[48, 32, 80, 64]`, `1,024` px), leaving the lower half
 *   `PARTIAL_LOWER_BOX` (`[48, 64, 80, 96]`, `1,024` px) uncovered by `over`.
 * - `PARTIAL_OCCLUDER_RGB` (`[120, 70, 110]`) differs from `LIMB_RGB` (`[60, 100, 160]`)
 *   by max-channel `60`, which is within `DRIFT_LIMIT` (`90`) so `--project visible`
 *   would project it onto `behind` without the `under` keep guard, and above
 *   `rgb_within` (`20`) so it does not trigger `ASSEMBLE_OCCLUDER_COLOUR_COPIED`.
 */
export const PARTIAL_OVER_BOX: [number, number, number, number] = [48, 32, 80, 64];
export const PARTIAL_LOWER_BOX: [number, number, number, number] = [48, 64, 80, 96];
export const PARTIAL_HALF_PX = (PARTIAL_OVER_BOX[2] - PARTIAL_OVER_BOX[0]) * (PARTIAL_OVER_BOX[3] - PARTIAL_OVER_BOX[1]);
export const PARTIAL_OCCLUDER_RGB: [number, number, number] = [120, 70, 110];

export function partialOverPainting(): Raster {
  const r = newRaster(SIDE, SIDE);
  r.data.fill(255);
  for (const { pixels } of faceGroup()) for (let p = 0; p < SIDE * SIDE; p++) if (pixels.data[p * 4 + 3] > 0) r.data.set(pixels.data.subarray(p * 4, p * 4 + 4), p * 4);
  fill(r, LIMB, [...LIMB_RGB, 255]);
  fill(r, OCCLUDER, [...PARTIAL_OCCLUDER_RGB, 255]);
  return r;
}

export function partialOverOccluder(): Raster {
  const r = newRaster(SIDE, SIDE);
  fill(r, OCCLUDER, [...PARTIAL_OCCLUDER_RGB, 255]);
  return r;
}

export function partialOverOriginalRun(occluderDepth = 0.2): LayerSet {
  const limb = newRaster(SIDE, SIDE), front = newRaster(SIDE, SIDE);
  for (let y = LIMB[1]; y < LIMB[3]; y++) for (let x = LIMB[0]; x < LIMB[2]; x++) if (!inside(OCCLUDER, x, y)) limb.data.set([...LIMB_RGB, 255], (y * SIDE + x) * 4);
  fill(front, PARTIAL_OVER_BOX, [...PARTIAL_OCCLUDER_RGB, 255]);
  return layerSet([...faceGroup(), { name: 'legwear', pixels: limb, depth: 0.7 }, { name: 'objects', pixels: front, depth: occluderDepth }], 'generated-partial-original');
}

export function writePartialOverInputs(dir: string, occluderDepth = 0.2): { painting: string; occluder: string; occluderSha: string; plateRunDir: string } {
  mkdirSync(dir, { recursive: true });
  const painting = join(dir, 'painting.png'), occluder = join(dir, 'occluder.png');
  writeFileSync(painting, encodePngBytes(partialOverPainting()));
  const occluderBytes = encodePngBytes(partialOverOccluder());
  writeFileSync(occluder, occluderBytes);
  exportLayers(partialOverOriginalRun(occluderDepth), join(dir, 'orig'));
  writeFileSync(join(dir, 'orig', 'meta.json'), JSON.stringify({ prompt_id: 'generated-partial-original', seed: 42 }));
  const plateRunDir = writePlateRun(dir, encodePngBytes(chainPlate()));
  return { painting, occluder, occluderSha: sha256(occluderBytes), plateRunDir };
}

/**
 * Propose-sized twin of the occluder chain fixture (issues #1247, #1251):
 * face/eye layers at >= 150 px (`PROPOSE_MIN_PX`), `legwear` on `[32, 24, 80, 104]`
 * (`3,840` px total: `2,048` inside `OCCLUDER` and `1,792` outside), `objects` on
 * `OCCLUDER` (`2,048` px at `DEEPER_OCCLUDER_DEPTH = 0.9`), and `footwear` on
 * `[48, 32, 64, 64]` (`512` px inside `OCCLUDER` at depth `0.95`, drafted as
 * `"shoes"` via `PROPOSE_ALIAS`).
 */
export function writeOccluderProposeFixture(dir: string): { painting: string; occluder: string; occluderSha: string; origDir: string; plateRunDir: string } {
  mkdirSync(dir, { recursive: true });
  const box = (b: readonly [number, number, number, number], rgba: readonly [number, number, number, number]): Raster => {
    const r = newRaster(SIDE, SIDE);
    fill(r, b, rgba);
    return r;
  };
  const paint = box([0, 0, SIDE, SIDE], [250, 250, 250, 255]);
  fill(paint, [16, 4, 48, 20], [235, 200, 185, 255]);
  fill(paint, [16, 4, 32, 14], [250, 250, 250, 255]);
  fill(paint, [32, 4, 48, 14], [250, 250, 250, 255]);
  fill(paint, [32, 24, 80, 104], [60, 90, 170, 255]);
  const occRgba: readonly [number, number, number, number] = [OCCLUDER_RGB[0], OCCLUDER_RGB[1], OCCLUDER_RGB[2], 255];
  fill(paint, OCCLUDER, occRgba);
  const paintBytes = encodePngBytes(paint);
  const painting = join(dir, 'painting.png');
  writeFileSync(painting, paintBytes);

  const plate = box([0, 0, SIDE, SIDE], [250, 250, 250, 255]);
  fill(plate, [16, 4, 48, 20], [235, 200, 185, 255]);
  fill(plate, [16, 4, 32, 14], [250, 250, 250, 255]);
  fill(plate, [32, 4, 48, 14], [250, 250, 250, 255]);
  fill(plate, [32, 24, 80, 104], [60, 90, 170, 255]);
  const plateBytes = encodePngBytes(plate);

  const occ = box(OCCLUDER, occRgba);
  const occBytes = encodePngBytes(occ);
  const occluder = join(dir, 'occluder.png');
  writeFileSync(occluder, occBytes);
  const occluderSha = sha256(occBytes);

  const faceLayers = [
    { name: 'face', pixels: box([16, 4, 48, 20], [235, 200, 185, 255]), depth: 0.5 },
    { name: 'eyewhite-r', pixels: box([16, 4, 32, 14], [250, 250, 250, 255]), depth: 0.4 },
    { name: 'eyewhite-l', pixels: box([32, 4, 48, 14], [250, 250, 250, 255]), depth: 0.4 },
  ];
  const origLimb = newRaster(SIDE, SIDE);
  for (let y = 24; y < 104; y++) {
    for (let x = 32; x < 80; x++) {
      if (!inside(OCCLUDER, x, y)) origLimb.data.set([60, 90, 170, 255], (y * SIDE + x) * 4);
    }
  }
  const origDir = join(dir, 'orig');
  exportLayers(
    layerSet(
      [
        ...faceLayers,
        { name: 'legwear', pixels: origLimb, depth: 0.7 },
        { name: 'objects', pixels: occ, depth: DEEPER_OCCLUDER_DEPTH },
        { name: 'footwear', pixels: box([48, 32, 64, 64], occRgba), depth: 0.95 },
      ],
      'prop-orig',
    ),
    origDir,
  );
  writeFileSync(join(origDir, 'meta.json'), JSON.stringify({ prompt_id: 'prop-orig', seed: 42, image_sha256: sha256(paintBytes) }));

  const plateRunDir = join(dir, 'plate-run');
  exportLayers(
    layerSet([...faceLayers, { name: 'legwear', pixels: box([32, 24, 80, 104], [60, 90, 170, 255]), depth: 0.7 }], 'prop-plate'),
    plateRunDir,
  );
  writeFileSync(join(plateRunDir, 'meta.json'), JSON.stringify({ prompt_id: 'prop-plate', seed: 42, image_sha256: sha256(plateBytes) }));
  return { painting, occluder, occluderSha, origDir, plateRunDir };
}

/**
 * Soft-edge `over` twin (issue #1251):
 * - The occluder rectangle is `OCCLUDER` (`[48, 32, 80, 96]`, `32 x 64 = 2,048` px, opaque `PARTIAL_OCCLUDER_RGB`).
 * - The taken `over` layer (`front`, `full:objects`) covers `OCCLUDER`, with an outer ring of width `SOFT_OVER_RING_WIDTH` (`4` px)
 *   at alpha `SOFT_OVER_RING_ALPHA` (`200`, in `129..249`) and an inner opaque region `SOFT_OVER_INNER_BOX`
 *   (`[52, 36, 76, 92]`, `24 x 56 = 1,344` px at alpha `255`), so the ring holds `2,048 - 1,344 = 704` px.
 * - `OCCLUDER_SPECK_BOX` (`[41, 48, 44, 56]`, `3 x 8 = 24` px at alpha `OCCLUDER_SPECK_ALPHA = 20` in `9..32`,
 *   whose closest column `x = 43` is `5` px off the occluder core edge `x = 48`) is an isolated low-alpha speck.
 */
export const SOFT_OVER_RING_WIDTH = 4;
export const SOFT_OVER_RING_ALPHA = 200;
export const SOFT_OVER_INNER_BOX: [number, number, number, number] = [
  OCCLUDER[0] + SOFT_OVER_RING_WIDTH,
  OCCLUDER[1] + SOFT_OVER_RING_WIDTH,
  OCCLUDER[2] - SOFT_OVER_RING_WIDTH,
  OCCLUDER[3] - SOFT_OVER_RING_WIDTH,
];
export const SOFT_OVER_INNER_PX = (SOFT_OVER_INNER_BOX[2] - SOFT_OVER_INNER_BOX[0]) * (SOFT_OVER_INNER_BOX[3] - SOFT_OVER_INNER_BOX[1]);
export const SOFT_OVER_RING_PX = OCCLUDER_PX - SOFT_OVER_INNER_PX;
export const OCCLUDER_SPECK_BOX: [number, number, number, number] = [41, 48, 44, 56];
export const OCCLUDER_SPECK_ALPHA = 20;
export const OCCLUDER_SPECK_PX = (OCCLUDER_SPECK_BOX[2] - OCCLUDER_SPECK_BOX[0]) * (OCCLUDER_SPECK_BOX[3] - OCCLUDER_SPECK_BOX[1]);

export function softOverOriginalRun(occluderDepth = 0.2): LayerSet {
  const limb = newRaster(SIDE, SIDE), front = newRaster(SIDE, SIDE);
  for (let y = LIMB[1]; y < LIMB[3]; y++) for (let x = LIMB[0]; x < LIMB[2]; x++) if (!inside(OCCLUDER, x, y)) limb.data.set([...LIMB_RGB, 255], (y * SIDE + x) * 4);
  fill(front, OCCLUDER, [...PARTIAL_OCCLUDER_RGB, SOFT_OVER_RING_ALPHA]);
  fill(front, SOFT_OVER_INNER_BOX, [...PARTIAL_OCCLUDER_RGB, 255]);
  return layerSet([...faceGroup(), { name: 'legwear', pixels: limb, depth: 0.7 }, { name: 'objects', pixels: front, depth: occluderDepth }], 'generated-soft-original');
}

export function partialOverOccluderWithSpeck(): Raster {
  const r = partialOverOccluder();
  fill(r, OCCLUDER_SPECK_BOX, [...PARTIAL_OCCLUDER_RGB, OCCLUDER_SPECK_ALPHA]);
  return r;
}

export function writeSoftOverInputs(dir: string, occluderDepth = 0.2): { painting: string; occluder: string; occluderSha: string; speckOccluder: string; speckOccluderSha: string; plateRunDir: string } {
  mkdirSync(dir, { recursive: true });
  const painting = join(dir, 'painting.png');
  const occluder = join(dir, 'occluder.png');
  const speckOccluder = join(dir, 'occluder_speck.png');
  writeFileSync(painting, encodePngBytes(partialOverPainting()));
  const occluderBytes = encodePngBytes(partialOverOccluder());
  writeFileSync(occluder, occluderBytes);
  const speckOccluderBytes = encodePngBytes(partialOverOccluderWithSpeck());
  writeFileSync(speckOccluder, speckOccluderBytes);
  exportLayers(softOverOriginalRun(occluderDepth), join(dir, 'orig'));
  writeFileSync(join(dir, 'orig', 'meta.json'), JSON.stringify({ prompt_id: 'generated-soft-original', seed: 42 }));
  const plateRunDir = writePlateRun(dir, encodePngBytes(chainPlate()));
  return { painting, occluder, occluderSha: sha256(occluderBytes), speckOccluder, speckOccluderSha: sha256(speckOccluderBytes), plateRunDir };
}

/**
 * Soft outer-ring occluder twin (issue #1259):
 * - The occluder core (`alpha > 128`) is `OCCLUDER` (`[48, 32, 80, 96]`, `32 x 64 = 2,048` px at alpha `255`).
 * - Around `OCCLUDER` sits a soft outer ring of width `GUARD_RING_WIDTH` (`R = 2` px),
 *   so the outer rectangle is `GUARD_RING_OUTER_BOX` (`[46, 30, 82, 98]`, `36 x 68 = 2,448` px)
 *   and the ring (`GUARD_RING_OUTER_BOX \ OCCLUDER`) holds `GUARD_RING_PX` (`N = 2,448 - 2,048 = 400` px)
 *   at alpha `GUARD_RING_ALPHA` (`64 <= 128`) on `occluder.png`.
 * - On `painting.png`, `GUARD_RING_OUTER_BOX` (`[46, 30, 82, 98]`, core and ring) carries `PARTIAL_OCCLUDER_RGB`
 *   (`[120, 70, 110]`), while the `under` part's plate-run layer (`behind`, `full:legwear`) carries `LIMB_RGB`
 *   (`[60, 100, 160]`) over all of `LIMB` (`[16, 16, 112, 112]`).
 */
export const GUARD_RING_WIDTH = 2;
export const GUARD_RING_ALPHA = 64;
export const GUARD_RING_OUTER_BOX: [number, number, number, number] = [
  OCCLUDER[0] - GUARD_RING_WIDTH,
  OCCLUDER[1] - GUARD_RING_WIDTH,
  OCCLUDER[2] + GUARD_RING_WIDTH,
  OCCLUDER[3] + GUARD_RING_WIDTH,
];
export const GUARD_RING_OUTER_PX = (GUARD_RING_OUTER_BOX[2] - GUARD_RING_OUTER_BOX[0]) * (GUARD_RING_OUTER_BOX[3] - GUARD_RING_OUTER_BOX[1]);
export const GUARD_RING_PX = GUARD_RING_OUTER_PX - OCCLUDER_PX;

export function softRingPainting(): Raster {
  const r = newRaster(SIDE, SIDE);
  r.data.fill(255);
  for (const { pixels } of faceGroup()) for (let p = 0; p < SIDE * SIDE; p++) if (pixels.data[p * 4 + 3] > 0) r.data.set(pixels.data.subarray(p * 4, p * 4 + 4), p * 4);
  fill(r, LIMB, [...LIMB_RGB, 255]);
  fill(r, GUARD_RING_OUTER_BOX, [...PARTIAL_OCCLUDER_RGB, 255]);
  return r;
}

export function softRingOccluder(): Raster {
  const r = newRaster(SIDE, SIDE);
  fill(r, GUARD_RING_OUTER_BOX, [...PARTIAL_OCCLUDER_RGB, GUARD_RING_ALPHA]);
  fill(r, OCCLUDER, [...PARTIAL_OCCLUDER_RGB, 255]);
  return r;
}

export function writeSoftRingInputs(dir: string, occluderDepth = 0.2): { painting: string; occluder: string; occluderSha: string; plateRunDir: string } {
  mkdirSync(dir, { recursive: true });
  const painting = join(dir, 'painting.png');
  const occluder = join(dir, 'occluder.png');
  writeFileSync(painting, encodePngBytes(softRingPainting()));
  const occluderBytes = encodePngBytes(softRingOccluder());
  writeFileSync(occluder, occluderBytes);
  exportLayers(partialOverOriginalRun(occluderDepth), join(dir, 'orig'));
  writeFileSync(join(dir, 'orig', 'meta.json'), JSON.stringify({ prompt_id: 'generated-soft-ring-original', seed: 42 }));
  const plateRunDir = writePlateRun(dir, encodePngBytes(chainPlate()));
  return { painting, occluder, occluderSha: sha256(occluderBytes), plateRunDir };
}

