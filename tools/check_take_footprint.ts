/** Exact warp-footprint observations; no assembly pixels are modified. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeTakeRegionFixture } from '../fixtures/take_region.ts';
import { assembleStage } from '../src/build.ts';
import { FEATHER_SIGMA, type AssembleResult } from '../src/assemble.ts';
import { dilate } from '../src/raster/morph.ts';
import { gaussianKernelSize } from '../src/raster/blur.ts';
import { firstTakeWriters, takeFootprintObserver, type FootprintTrace } from './observe_take_footprint.ts';
import { readLayers } from '../src/layers.ts';
import { readPng } from '../src/raster/png.ts';
import { newFloatImage, newMask, newRaster, type Mask, type Raster } from '../src/raster/types.ts';
import { warpAffine, type ScaleTranslate, type WarpFilter } from '../src/raster/warp.ts';
import { rint } from '../src/round.ts';
import { deriveTakenRegion } from '../src/takeregion.ts';

/** Quantized inverse positions, independently read from warpAffine's contract. */
function samplePositions(size: number, scale: number, translate: number, horizontal: boolean): number[] {
  const inverse = 1 / scale;
  const offset = -translate / scale;
  return Array.from({ length: size }, (_, pixel) => {
    const fixed = horizontal
      ? rint(offset * 1024) + rint(inverse * pixel * 1024)
      : rint((inverse * pixel + offset) * 1024);
    return Math.floor((fixed + 16) / 32);
  });
}

/** A tap with a zero coefficient cannot carry a selected source pixel.
 * At an integer sample both filters have only their centre coefficient;
 * at the other 1/32 steps bicubic has four nonzero taps, bilinear two.
 * Singleton impulse controls compare this predicate with the shipped warp.
 */
export function takeFootprint(component: Mask, map: ScaleTranslate, width: number, height: number, filter: WarpFilter): Mask {
  const xs = samplePositions(width, map.sx, map.tx, true);
  const ys = samplePositions(height, map.sy, map.ty, false);
  const support = newMask(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const ix = Math.floor(xs[x] / 32), iy = Math.floor(ys[y] / 32);
    const fractionalX = xs[x] - ix * 32 !== 0;
    const fractionalY = ys[y] - iy * 32 !== 0;
    const firstX = fractionalX && filter === 'bicubic' ? -1 : 0;
    const firstY = fractionalY && filter === 'bicubic' ? -1 : 0;
    const lastX = fractionalX ? filter === 'bicubic' ? 2 : 1 : 0;
    const lastY = fractionalY ? filter === 'bicubic' ? 2 : 1 : 0;
    for (let dy = firstY; dy <= lastY; dy++) for (let dx = firstX; dx <= lastX; dx++) {
      const sx = ix + dx, sy = iy + dy;
      if (sx >= 0 && sx < component.width && sy >= 0 && sy < component.height && component.data[sy * component.width + sx] === 1) support.data[y * width + x] = 1;
    }
  }
  return support;
}

/** Place the emitted crop using its record, including transparent RGB. */
export function takeTargetCanvas(result: AssembleResult, name: string): Raster {
  const part = result.images.find(p => p.record.name === name);
  if (part === undefined) throw new Error(`footprint observation requires target "${name}" in both builds`);
  const [width, height] = result.parts.rig_size;
  const canvas = newRaster(width, height);
  for (let y = 0; y < part.image.height; y++) {
    const row = part.image.data.subarray(y * part.image.width * 4, (y + 1) * part.image.width * 4);
    canvas.data.set(row, ((part.record.y + y) * width + part.record.x) * 4);
  }
  return canvas;
}

/** The same zero predicate is used by the core control and its planted red. */
export function targetOutsideFootprint(before: AssembleResult, after: AssembleResult, target: string, support: Mask): number {
  const a = takeTargetCanvas(before, target), b = takeTargetCanvas(after, target);
  if (a.width !== support.width || b.width !== support.width || a.height !== support.height || b.height !== support.height) throw new Error('footprint observation requires matching rig grids');
  let outside = 0;
  for (let p = 0; p < support.data.length; p++) {
    if (support.data[p] === 0 && [0, 1, 2, 3].some(c => a.data[p * 4 + c] !== b.data[p * 4 + c])) outside++;
  }
  return outside;
}

/** Gaussian-feather first writes get its actual kernel support; others do not. */
export function coreFootprintChanges(before: AssembleResult, after: AssembleResult, target: string, support: Mask, writers: Uint8Array): { feather: number; other: number; beyondFeather: number } {
  const a = takeTargetCanvas(before, target), b = takeTargetCanvas(after, target);
  const feather = dilate(support, gaussianKernelSize(FEATHER_SIGMA));
  let featherCount = 0, other = 0, beyondFeather = 0;
  for (let p = 0; p < support.data.length; p++) {
    if (support.data[p] === 1) continue;
    let projected = false, differentWriter = false;
    for (let c = 0; c < 4; c++) if (a.data[p * 4 + c] !== b.data[p * 4 + c]) {
      if (writers[p * 4 + c] === 1) projected = true;
      else differentWriter = true;
    }
    if (projected) featherCount++;
    if (differentWriter) other++;
    if (projected && feather.data[p] === 0) beyondFeather++;
  }
  return { feather: featherCount, other, beyondFeather };
}

export function runTakeFootprintChecks(dir: string, say: (name: string, pass: boolean, detail: string) => void): void {
  const observe = takeFootprintObserver(dir);
  const singleton = newMask(17, 17);
  singleton.data[8 * 17 + 8] = 1;
  const impulse = newFloatImage(17, 17, 1);
  impulse.data[8 * 17 + 8] = 1;
  let agrees = true;
  for (const scale of [0.5, 1, 1.5]) for (const tx of [0, -0.5]) {
    const map = { sx: scale, sy: scale, tx, ty: 0.25 };
    const filter = scale < 1 ? 'bilinear' : 'bicubic';
    const support = takeFootprint(singleton, map, 32, 32, filter);
    const actual = warpAffine(impulse, map, 32, 32, filter);
    agrees &&= support.data.every((value, p) => (value === 1) === (actual.data[p] !== 0));
  }
  say('REGION_FOOTPRINT_MATCHES_WARP_IMPULSES', agrees, 'six scale/offset controls, including zero coefficients and bilinear downsampling');
  const unit = takeFootprint(singleton, { sx: 1, sy: 1, tx: 0, ty: 0 }, 32, 32, 'bicubic');
  const enlarged = takeFootprint(singleton, { sx: 1.5, sy: 1.5, tx: 0, ty: 0 }, 32, 32, 'bicubic');
  // The unit impulse reaches only (8,8); at 1.5 its nonzero support is [10,14]².
  say('REGION_FOOTPRINT_SECOND_SCALE', unit.data.reduce((n, v) => n + v, 0) === 1 && enlarged.data.reduce((n, v) => n + v, 0) === 25, 'k=1 reaches one cell; k=1.5 reaches the analytic 5x5 support');

  for (const scale of [1, 1.5]) {
    const home = join(dir, String(scale)), raw = writeTakeRegionFixture(home);
    const config = join(home, 'config.json');
    const assemble = raw.assemble as Record<string, unknown>;
    assemble.rig_scale = scale;
    const declarations = assemble.take;
    const input = (project: 'core' | 'visible') => ({ source: join(home, 'painting.png'), full: join(home, 'full'), head: null, config, project, requirements: join(home, 'requirements.json') });
    const output = (name: string) => ({ partsJson: join(home, name, 'parts.json'), partsDir: join(home, name, 'parts'), recomposite: join(home, name, 'recomposite.png'), errorMap: join(home, name, 'error.png') });
    const stage = (name: string, project: 'core' | 'visible') => assembleStage(input(project), output(name), () => {});
    const save = () => writeFileSync(config, JSON.stringify(raw));
    assemble.take = []; save(); const before = stage('core-before', 'core');
    const observedBefore = observe(input('core'), output('observed-before'), 'body', 'full:topwear');
    assemble.take = declarations; save(); const after = stage('core-after', 'core');
    const observedAfter = observe(input('core'), output('observed-after'), 'body', 'full:topwear');
    const base = readLayers(join(home, 'full')).layers.find(layer => layer.name === 'topwear')!;
    const donor = readLayers(join(home, 'donor')).layers.find(layer => layer.name === 'topwear')!;
    const derived = deriveTakenRegion(base, donor, readPng(join(home, 'painting.png')), [12, 40], 0, 'generated footprint control');
    const component = newMask(64, 64);
    for (let y = base.top; y < base.bottom; y++) for (let x = base.left; x < base.right; x++) {
      const p = ((y - base.top) * base.pixels.width + x - base.left) * 4;
      if ([0, 1, 2, 3].some(c => base.pixels.data[p + c] !== derived.layer.pixels.data[p + c])) component.data[y * 64 + x] = 1;
    }
    const support = takeFootprint(component, { sx: scale, sy: scale, tx: 0, ty: 0 }, ...after.parts.rig_size, 'bicubic');
    const writers = firstTakeWriters(observedBefore.trace, observedAfter.trace);
    const reading = coreFootprintChanges(before, after, 'body', support, writers);
    const observedBase = takeTargetCanvas(observedBefore.result, 'body'), observedTake = takeTargetCanvas(observedAfter.result, 'body');
    const neutral = takeTargetCanvas(before, 'body').data.every((value, p) => value === observedBase.data[p]) &&
      takeTargetCanvas(after, 'body').data.every((value, p) => value === observedTake.data[p]);
    say('REGION_CORE_WRITER_FOOTPRINT_GUARD', neutral && reading.other === 0 && reading.beyondFeather === 0, `k=${scale}; projection-first halo ${reading.feather}; other ${reading.other}; beyond feather ${reading.beyondFeather}; observer neutral ${neutral}`);
    const feather = dilate(support, gaussianKernelSize(FEATHER_SIGMA));
    const inside = support.data.findIndex((value, p) => value === 1 && p % support.width < support.width - 1 && support.data[p + 1] === 0);
    const outer = feather.data.findIndex((value, p) => value === 1 && p % support.width < support.width - 1 && feather.data[p + 1] === 0) + 1;
    const plant = (stage: string, pixel: number) => {
      const trace: FootprintTrace = new Map();
      let writing = false;
      for (const [name, image] of observedAfter.trace) {
        writing ||= name === stage;
        const copy = { ...image, data: image.data.slice() };
        if (writing) copy.data[pixel * 4] ^= 1;
        trace.set(name, copy);
      }
      const image = trace.get('emit')!;
      const result = { ...after, images: after.images.map(part => part.record.name === 'body' ? { ...part, image, record: { ...part.record, x: 0, y: 0, w: image.width, h: image.height } } : part) };
      return coreFootprintChanges(before, result, 'body', support, firstTakeWriters(observedBefore.trace, trace));
    };
    const projectedRed = plant('projection', outer), otherRed = plant('postSeam', inside + 1), boundary = plant('postSeam', inside);
    say('REGION_FOOTPRINT_FEATHER_AND_OTHER_WRITER_REDS', inside >= 0 && outer > 0 && projectedRed.beyondFeather === 1 && otherRed.other === 1 && boundary.other === 0 && boundary.beyondFeather === 0, `k=${scale}; beyond-feather plant ${projectedRed.beyondFeather}; other-writer plant ${otherRed.other}; inside-boundary ${boundary.other}`);
    assemble.take = []; save(); const visibleBefore = stage('visible-before', 'visible');
    assemble.take = declarations; save(); const visibleAfter = stage('visible-after', 'visible');
    console.log(`  INFO  region target footprint: visible, k=${scale}, outside ${targetOutsideFootprint(visibleBefore, visibleAfter, 'body', support)} RGBA px; report only, tracked on #1033`);
  }
}
