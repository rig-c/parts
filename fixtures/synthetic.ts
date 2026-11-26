/**
 * Inputs the selftest generates, into a temp directory, on every run.
 *
 * ⭐ Nothing here is art and nothing here stands for any. A layer is a flat
 * block of one colour with a known number of painted pixels, so every figure a
 * control compares against — a count, a box, a draw order — can be computed by
 * hand from this file. No claim about seams, blending or appearance can come
 * from a fixture here, and none is made.
 *
 * The real inputs — paintings and See-through layers of actual characters —
 * never enter this repository (CLAUDE.md, *Where the private oracle lives*).
 * The selftest reaches them only through `--corpus <dir>`, which reads and
 * never writes.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeCanvas, writePsd } from 'ag-psd';
import { depthReading } from '../src/depthsheets.ts';
import { depthImageReference, partImageReference, writeParts } from '../src/parts.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { block, rigParts } from './rig.ts';

export interface FixtureLayer {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  depth: number;
  colour: [number, number, number];
  /** Painted pixels, counted from the top-left, row-major; the rest is transparent. */
  painted: number;
  /** Where the PNG goes: the wrapper's own flat file name, or `parts/<name>.png`. */
  layout: 'flat' | 'by-tag';
}

export const CANVAS = { w: 64, h: 48 };

/**
 * Five layers over a 64x48 canvas. Draw order by descending depth is
 * `neckwear` (1.0), `back hair` (0.9), `face` (0.5), then the two brows (0.2
 * each) in MANIFEST order — `eyebrow-l` is listed before `eyebrow-r`, so a sort
 * that is not stable, or that breaks the tie by name, puts them the other way.
 * `neckwear` is an empty tag the way See-through writes one: a box with no
 * painted pixel in it.
 */
export const WRAPPER_LAYERS: FixtureLayer[] = [
  { name: 'face', left: 20, top: 8, width: 24, height: 20, depth: 0.5, colour: [230, 200, 180], painted: 300, layout: 'by-tag' },
  { name: 'eyebrow-l', left: 34, top: 12, width: 6, height: 2, depth: 0.2, colour: [40, 30, 30], painted: 12, layout: 'flat' },
  { name: 'back hair', left: 10, top: 0, width: 44, height: 40, depth: 0.9, colour: [60, 40, 90], painted: 1000, layout: 'by-tag' },
  { name: 'eyebrow-r', left: 24, top: 12, width: 6, height: 2, depth: 0.2, colour: [40, 30, 30], painted: 7, layout: 'flat' },
  { name: 'neckwear', left: 0, top: 0, width: 64, height: 48, depth: 1.0, colour: [0, 0, 0], painted: 0, layout: 'flat' },
];

export const WRAPPER_PREFIX = 'fx';

export function flatName(name: string): string {
  return `${WRAPPER_PREFIX}_00000000_000000_fixture_${name}.png`;
}

export function layerRaster(l: FixtureLayer): Raster {
  const r = newRaster(l.width, l.height);
  for (let i = 0; i < l.painted; i++) r.data.set([...l.colour, 255], i * 4);
  return r;
}

/** The wrapper form of `layers` in `dir`: `layers.json` plus each PNG where its `layout` says. */
export function writeWrapperFixture(dir: string, layers: FixtureLayer[] = WRAPPER_LAYERS): void {
  mkdirSync(join(dir, 'parts'), { recursive: true });
  const manifest = {
    prefix: WRAPPER_PREFIX,
    timestamp: '00000000_000000_fixture',
    layers: layers.map((l) => ({
      name: l.name,
      filename: flatName(l.name),
      left: l.left,
      top: l.top,
      right: l.left + l.width,
      bottom: l.top + l.height,
      depth_median: l.depth,
      depth_filename: flatName(`${l.name}_depth`),
    })),
    width: CANVAS.w,
    height: CANVAS.h,
  };
  writeFileSync(join(dir, 'layers.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const l of layers) {
    const path = l.layout === 'flat' ? join(dir, flatName(l.name)) : join(dir, 'parts', `${l.name}.png`);
    writeFileSync(path, encodePngBytes(layerRaster(l)));
  }
}

let canvasStubbed = false;

type PsdImageData = ReturnType<NonNullable<Parameters<typeof initializeCanvas>[1]>>;

export interface PsdFixtureLayer {
  name: string;
  left: number;
  top: number;
  pixels: Raster;
  hidden?: boolean;
  blendMode?: 'normal' | 'multiply';
  /** A group holding these layers instead of pixels. */
  children?: PsdFixtureLayer[];
}

/** A PSD written by ag-psd, the same library the reader uses, with layers bottom first. */
export function writePsdFixture(path: string, width: number, height: number, layers: PsdFixtureLayer[]): void {
  if (!canvasStubbed) {
    initializeCanvas(
      () => {
        throw new Error('the PSD fixture writes pixel data only');
      },
      (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: 'srgb' }) as PsdImageData,
    );
    canvasStubbed = true;
  }
  const toPsd = (l: PsdFixtureLayer): Record<string, unknown> =>
    l.children !== undefined
      ? { name: l.name, children: l.children.map(toPsd) }
      : {
          name: l.name,
          left: l.left,
          top: l.top,
          right: l.left + l.pixels.width,
          bottom: l.top + l.pixels.height,
          hidden: l.hidden ?? false,
          blendMode: l.blendMode ?? 'normal',
          imageData: { width: l.pixels.width, height: l.pixels.height, data: new Uint8ClampedArray(l.pixels.data) },
        };
  const doc = { width, height, children: layers.map(toPsd) };
  writeFileSync(path, new Uint8Array(writePsd(doc as Parameters<typeof writePsd>[0], { noBackground: true })));
}

/** The smallest config every CPU-stage section of which is populated and green. */
export function minimalConfig(): Record<string, unknown> {
  return {
    key: 'fixture',
    note: 'Synthetic; every value chosen to be checkable by hand.',
    assemble: {
      rig_scale: 0.5,
      plan: [
        ['hair_back', 'head', 'back hair'],
        ['face', 'head', 'face'],
        ['brow_l', 'head', 'eyebrow-l'],
        ['robe', 'full', 'topwear'],
      ],
      extend_below_crop: [{ part: 'hair_back', run: 'full', tag: 'back hair' }],
    },
    bones: [
      { name: 'hip', parent: 'root', at: [32, 40] },
      { name: 'chest', parent: 'hip', at: [32, 30] },
      { name: 'head', parent: 'chest', at: [32, 16], tip: [32, 4] },
      { chain: 'hem', parent: 'hip', points: [[28, 40], [28, 44]], tip: [28, 47] },
    ],
    meshes: {
      hair_back: { grid: 8, r: 4, segments: [['head', [32, 16], [32, 2]]] },
      robe: { grid: 8, r: 6, segments: ['chest', 'hem'] },
    },
    regions: { face: 'head', brow_l: 'head' },
    motion: {
      duration: 4,
      tracks: [
        { bone: 'chest', prop: 'translatey', amp: 1, period: 4, phase: 0, base: 1 },
        { chain: 'hem', amps: [1, 2], period: 2, phase: 0.1, lag: 0.05 },
      ],
      blink: { t: 1.5, eyes: ['head'], brows: ['head'], squash: 0.12, brow_drop: 1 },
    },
    rig_note: 'an annotation, which the loader must accept and ignore',
  };
}

/**
 * A 32x80 contour cell at crop (16,10), sampled at spacing 400.
 * Its top-left collar share is 1 - 8/40 = 0.8. The top-right distance
 * is sqrt(28² + 8²), in the eased half of the band. Both lower corners
 * lie outside the band. A left-to-right scalar ramp makes the two yaw
 * deforms compress the same upper edge.
 */
export function writeTurnWindingFixture(dir: string, variant: 'shared' | 'separate' | 'head-only'): { config: string; parts: string } {
  const shared = variant === 'shared';
  const manifest = rigParts();
  const template = manifest.parts[0];
  manifest.rig_size = [64, 96];
  manifest.scale_rig_per_source = 1;
  manifest.parts = [
    { ...template, name: 'topwear', from: 'full:topwear', x: 16, y: 10, w: 32, h: 80, opaque_px: 32 * 80 },
    { ...template, name: 'face', from: 'head:face', x: 22, y: 4, w: 20, h: 26, opaque_px: 20 * 26 },
  ];
  const parts = join(dir, 'parts-in');
  mkdirSync(join(parts, 'parts'), { recursive: true });
  for (const p of manifest.parts) {
    const art = block(p.w, p.h);
    const scalar = newRaster(p.w, p.h);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const level = shared && p.name === 'topwear' ? Math.round(255 * (p.w - 1 - x) / (p.w - 1)) : 0;
      scalar.data.set([level, level, level, 255], 4 * (y * p.w + x));
    }
    const bytes = encodePngBytes(scalar);
    p.depth = {
      image: `${p.name}_depth.png`, near: 'white', zScale: 110,
      sources: [{
        from: p.from, image: `${p.name}_scalar.png`, sha256: createHash('sha256').update(bytes).digest('hex'),
        crop: [p.x, p.y, p.x + p.w, p.y + p.h], reading: depthReading(scalar, art, null),
      }],
    };
    writeFileSync(join(parts, partImageReference(p).path), encodePngBytes(art));
    writeFileSync(join(parts, depthImageReference(p.depth).path), bytes);
  }
  writeParts(join(parts, 'parts.json'), manifest);

  const spacing = 400;
  const collar = { name: 'collar', shape: 'polygon', points: [[0, 0], [20, 0], [20, 2], [0, 2]], bone: 'collar', spacing, band: 40 };
  const body = variant === 'head-only' ? {} : { body: { pivot: 16, roles: { topwear: 'surface' } } };
  const config = join(dir, 'config.json');
  writeFileSync(config, JSON.stringify({
    key: 'turn_winding',
    assemble: { rig_scale: 1, plan: manifest.parts.map(p => [p.name, ...p.from.split(':')]) },
    bones: [
      { name: 'chest', parent: 'root', at: [32, 90] },
      { name: 'torso', parent: 'chest', at: [32, 90] },
      { name: 'head', parent: 'chest', at: [32, 30] },
      { name: 'crown', parent: 'head', at: [32, 30] },
      { name: 'collar', parent: 'head', at: [32, 30], inherit: 'onlyTranslation' },
    ],
    regions: { face: 'crown' },
    meshes: {
      topwear: {
        segments: [['torso', [32, 90], [32, 34]]], r: 4,
        contour: { tolerance: 0, margin: 0, spacing, ...(shared ? { regions: [collar] } : {}) },
      },
    },
    motion: { duration: 2, tracks: [{ bone: 'chest', prop: 'rotate', amp: 2, period: 2, phase: 0 }] },
    turn: { pivot: 16, grid: [5, 5], roles: { face: 'surface' }, ...body },
  }));
  return { config, parts };
}
