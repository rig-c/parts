/** Exact warp-footprint observations; no assembly pixels are modified. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeTakeRegionFixture } from '../fixtures/take_region.ts';
import { assembleStage } from '../src/build.ts';
import { CORE_KERNEL, DRIFT_LIMIT, FEATHER_SIGMA, checkGeometry, runMap, stageFields, type AssembleResult } from '../src/assemble.ts';
import { dilate } from '../src/raster/morph.ts';
import { gaussianKernelSize } from '../src/raster/blur.ts';
import { firstTakeWriters, takeFootprintObserver, type FootprintTrace } from './observe_take_footprint.ts';
import { readLayers } from '../src/layers.ts';
import { readPng, encodePngBytes } from '../src/raster/png.ts';
import { loadEarlyConfig } from '../src/config.ts';
import { fileSha256 } from '../src/editreceipt.ts';
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

/** Dependency reach of erode → close (dilate then erode) → Gaussian blur.
 * projectSource's CORE_KERNEL is anchored at floor(CORE_KERNEL/2) in
 * morph.ts, with opposite reach CORE_KERNEL-1-anchor. Closing applies that
 * kernel twice. blur.ts uses (gaussianKernelSize(FEATHER_SIGMA)-1)/2.
 * Sequential dependency reaches add, including both closing passes.
 */
export function projectionChainReach() {
  const anchor = Math.floor(CORE_KERNEL / 2);
  const erosion = Math.max(anchor, CORE_KERNEL - 1 - anchor);
  const closing = erosion + erosion;
  const blurKernel = gaussianKernelSize(FEATHER_SIGMA);
  const blur = (blurKernel - 1) / 2;
  return { coreKernel: CORE_KERNEL, anchor, erosion, closing, blurKernel, blur, total: erosion + closing + blur };
}

/** A red plant is located by a separate Chebyshev-distance calculation.
 * It reads only the original footprint and the analytically derived radius.
 */
function justBeyondProjectionBound(support: Mask, radius: number): number {
  const cells: Array<[number, number]> = [];
  for (let p = 0; p < support.data.length; p++) if (support.data[p] === 1) cells.push([p % support.width, Math.floor(p / support.width)]);
  for (let p = 0; p < support.data.length; p++) {
    const x = p % support.width, y = Math.floor(p / support.width);
    let distance = Infinity;
    for (const [sx, sy] of cells) distance = Math.min(distance, Math.max(Math.abs(x - sx), Math.abs(y - sy)));
    if (distance === radius + 1) return p;
  }
  throw new Error('projection plant requires a cell just beyond the independently derived reach');
}

/** Projection first writes use the whole chain; every other writer stays local. */
export function coreFootprintChanges(before: AssembleResult, after: AssembleResult, target: string, support: Mask, writers: Uint8Array): { projection: number; other: number; beyondProjection: number; beyondBlur: number } {
  const a = takeTargetCanvas(before, target), b = takeTargetCanvas(after, target);
  const reach = projectionChainReach();
  const projection = dilate(support, reach.total * 2 + 1);
  const blurOnly = dilate(support, gaussianKernelSize(FEATHER_SIGMA));
  let projectionCount = 0, other = 0, beyondProjection = 0, beyondBlur = 0;
  for (let p = 0; p < support.data.length; p++) {
    if (support.data[p] === 1) continue;
    let projected = false, differentWriter = false;
    for (let c = 0; c < 4; c++) if (a.data[p * 4 + c] !== b.data[p * 4 + c]) {
      if (writers[p * 4 + c] === 1) projected = true;
      else differentWriter = true;
    }
    if (projected) projectionCount++;
    if (differentWriter) other++;
    if (projected && projection.data[p] === 0) beyondProjection++;
    if (projected && blurOnly.data[p] === 0) beyondBlur++;
  }
  return { projection: projectionCount, other, beyondProjection, beyondBlur };
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

  for (const fixture of [{ name: '1', scale: 1, drift: false }, { name: '1.5', scale: 1.5, drift: false }, { name: 'drifted', scale: 1.5, drift: true }]) {
    const { scale } = fixture;
    const home = join(dir, fixture.name), raw = writeTakeRegionFixture(home);
    const config = join(home, 'config.json');
    const assemble = raw.assemble as Record<string, unknown>;
    assemble.rig_scale = scale;
    const declarations = assemble.take;
    if (fixture.drift) {
      const painting = readPng(join(home, 'painting.png'));
      writeFileSync(join(home, 'reference.png'), encodePngBytes(painting));
      const delta = Math.floor(DRIFT_LIMIT / 2);
      for (let p = 0; p < painting.data.length; p += 4) if (painting.data[p] !== 255) for (let c = 0; c < 3; c++) painting.data[p + c] += delta;
      writeFileSync(join(home, 'painting.png'), encodePngBytes(painting));
      (declarations as Array<{ reference: unknown }>)[0].reference = { painting: 'reference.png', sha256: fileSha256(join(home, 'reference.png')) };
    }
    const input = (project: 'core' | 'visible') => ({ source: join(home, 'painting.png'), full: join(home, 'full'), head: null, config, project, requirements: join(home, 'requirements.json') });
    const output = (name: string) => ({ partsJson: join(home, name, 'parts.json'), partsDir: join(home, name, 'parts'), recomposite: join(home, name, 'recomposite.png'), errorMap: join(home, name, 'error.png') });
    const stage = (name: string, project: 'core' | 'visible') => assembleStage(input(project), output(name), () => {});
    const save = () => writeFileSync(config, JSON.stringify(raw));
    assemble.take = []; save(); const before = stage('core-before', 'core');
    const observedBefore = observe(input('core'), output('observed-before'), 'body', 'full:topwear');
    assemble.take = declarations; save(); const after = stage('core-after', 'core');
    const observedAfter = observe(input('core'), output('observed-after'), 'body', 'full:topwear');
    const baseSet = readLayers(join(home, 'full'));
    const base = baseSet.layers.find(layer => layer.name === 'topwear')!;
    const donor = readLayers(join(home, 'donor')).layers.find(layer => layer.name === 'topwear')!;
    const painting = readPng(join(home, 'painting.png'));
    const reference = fixture.drift ? readPng(join(home, 'reference.png')) : painting;
    const derived = deriveTakenRegion(base, donor, reference, [12, 40], 0, 'generated footprint control');
    const component = newMask(baseSet.canvas.w, baseSet.canvas.h);
    const layer = derived.layer;
    for (let y = layer.top; y < layer.bottom; y++) for (let x = layer.left; x < layer.right; x++) {
      const p = ((y - layer.top) * layer.pixels.width + x - layer.left) * 4;
      const old = x < base.left || x >= base.right || y < base.top || y >= base.bottom ? -1 : ((y - base.top) * base.pixels.width + x - base.left) * 4;
      if ([0, 1, 2, 3].some(c => layer.pixels.data[p + c] !== (old < 0 ? 0 : base.pixels.data[old + c]))) component.data[y * component.width + x] = 1;
    }
    const fields = stageFields(loadEarlyConfig(config, 'assemble'), { w: painting.width, h: painting.height });
    const frame = checkGeometry({ ...fields, sourceW: painting.width, sourceH: painting.height });
    const map = runMap(frame, 'full');
    const support = takeFootprint(component, { sx: map.sx, sy: map.sx, tx: map.tx, ty: map.ty }, ...after.parts.rig_size, map.k < 1 ? 'bilinear' : 'bicubic');
    const writers = firstTakeWriters(observedBefore.trace, observedAfter.trace);
    const reading = coreFootprintChanges(before, after, 'body', support, writers);
    const observedBase = takeTargetCanvas(observedBefore.result, 'body'), observedTake = takeTargetCanvas(observedAfter.result, 'body');
    const neutral = takeTargetCanvas(before, 'body').data.every((value, p) => value === observedBase.data[p]) &&
      takeTargetCanvas(after, 'body').data.every((value, p) => value === observedTake.data[p]);
    const beforeCanvas = takeTargetCanvas(before, 'body'), afterCanvas = takeTargetCanvas(after, 'body');
    const insideChanged = support.data.reduce((count, value, p) => count + (value === 1 && [0, 1, 2, 3].some(c => beforeCanvas.data[p * 4 + c] !== afterCanvas.data[p * 4 + c]) ? 1 : 0), 0);
    const supportCells = support.data.reduce((count, value) => count + value, 0);
    say('REGION_CORE_WRITER_FOOTPRINT_GUARD', neutral && supportCells > 0 && insideChanged > 0 && reading.other === 0 && reading.beyondProjection === 0, `${fixture.name}; k=${map.k}; support ${supportCells}; changed inside ${insideChanged}; projection-first halo ${reading.projection}; beyond blur ${reading.beyondBlur}; other ${reading.other}; beyond chain ${reading.beyondProjection}; observer neutral ${neutral}`);
    if (fixture.drift) console.log(`  INFO  drifted projection reach: beyond blur support ${reading.beyondBlur}; chain radius ${projectionChainReach().total}; observed reading only`);
    const inside = support.data.findIndex((value, p) => value === 1 && p % support.width < support.width - 1 && support.data[p + 1] === 0);
    const outer = justBeyondProjectionBound(support, projectionChainReach().total);
    const plant = (stage: string, pixel: number, channel = 0) => {
      const trace: FootprintTrace = new Map();
      let writing = false;
      for (const [name, image] of observedAfter.trace) {
        writing ||= name === stage;
        const copy = { ...image, data: image.data.slice() };
        if (writing) copy.data[pixel * 4 + channel] ^= 1;
        trace.set(name, copy);
      }
      const image = trace.get('emit')!;
      const result = { ...after, images: after.images.map(part => part.record.name === 'body' ? { ...part, image, record: { ...part.record, x: 0, y: 0, w: image.width, h: image.height } } : part) };
      return coreFootprintChanges(before, result, 'body', support, firstTakeWriters(observedBefore.trace, trace));
    };
    const projectedRed = plant('projection', outer), otherRed = plant('postSeam', inside + 1, 3), boundary = plant('postSeam', inside);
    say('REGION_FOOTPRINT_CHAIN_AND_OTHER_WRITER_REDS', inside >= 0 && outer > 0 && projectedRed.beyondProjection === 1 && otherRed.other === 1 && boundary.other === 0 && boundary.beyondProjection === 0, `${fixture.name}; beyond-chain plant ${projectedRed.beyondProjection}; other-writer plant ${otherRed.other}; inside-boundary ${boundary.other}`);
    assemble.take = []; save(); const visibleBefore = stage('visible-before', 'visible');
    assemble.take = declarations; save(); const visibleAfter = stage('visible-after', 'visible');
    console.log(`  INFO  region target footprint: visible, k=${scale}, outside ${targetOutsideFootprint(visibleBefore, visibleAfter, 'body', support)} RGBA px; report only, tracked on #1033`);
  }
}
