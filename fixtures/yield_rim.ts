/** Flat synthetic refused patch with a four-step alpha rim (#832).
 * All coordinates are source/run/rig pixels; no private art is used.
 */
import type { AssembleInput, PlacedPart } from '../src/assemble.ts';
import type { Layer } from '../src/layers.ts';
import { newRaster, type Raster } from '../src/raster/index.ts';
import { readLayerTag } from '../src/tags.ts';

export const RIM_SIZE = 64;
export const RIM_RGB = [200, 100, 100] as const;
export const RIM_ROI = [12, 12, 52, 52] as const;

export function yieldRimFixture(options: { mismatch?: boolean; holderAlpha?: number; blocker?: boolean; diagonal?: boolean } = {}): AssembleInput {
  const N = RIM_SIZE, source = newRaster(N, N), under = newRaster(N, N), front = newRaster(N, N);
  for (let p = 0; p < N * N; p++) {
    source.data.set([100, 100, 100, 255], p * 4);
    under.data.set([options.mismatch ? 0 : 100, 100, 100, options.holderAlpha ?? 255], p * 4);
  }
  // A matching opaque carrier outside the patch keeps a real moving part.
  for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) front.data.set([100, 100, 100, 255], (y * N + x) * 4);
  for (let y = 12; y < 52; y++) for (let x = 12; x < 52; x++) {
    const distance = Math.min(x - 12, 51 - x, y - 12, 51 - y);
    const alpha = [40, 100, 180, 249][distance] ?? 255;
    front.data.set([...RIM_RGB, alpha], (y * N + x) * 4);
  }
  // A separate soft island: same colour/holder, no path to a yielded seed.
  for (let y = 54; y < 60; y++) for (let x = 24; x < 40; x++) front.data.set([...RIM_RGB, 100], (y * N + x) * 4);
  if (options.diagonal) front.data.set([...RIM_RGB, 100], (11 * N + 11) * 4);
  const layer = (name: string, pixels: Raster, drawOrder: number): Layer => ({ name, tag: readLayerTag(name)!, file: null, pixels, left: 0, top: 0, right: N, bottom: N, depth: 1 - drawOrder / 3, drawOrder, opaquePx: Array.from(pixels.data).filter((v, i) => i % 4 === 3 && v > 8).length });
  const layers = [layer('neck', under, 0)];
  if (options.blocker) {
    const block = newRaster(N, N);
    for (let p = 0; p < N * N; p++) block.data.set([0, 100, 100, 255], p * 4);
    layers.push(layer('hair', block, 1));
  }
  layers.push(layer('topwear', front, layers.length));
  const full = { form: 'wrapper' as const, source: 'synthetic', canvas: { w: N, h: N }, layers, hidden: [] };
  return { source, full, head: { ...full, layers: [] }, resolution: N, headBox: [0, 0, N, N], rigScale: 1,
    plan: [['under', 'full', 'neck'], ...(options.blocker ? [['block', 'full', 'hair'] as [string, 'full', string]] : []), ['front', 'full', 'topwear']], extend: [], cuts: [], patches: [], seamRule: 'near-white', projectRule: 'core', yieldRefused: true, turnMovingPair: () => true };
}

export function rimPixel(part: PlacedPart, x: number, y: number): number[] {
  const sx = x - part.record.x, sy = y - part.record.y;
  if (sx < 0 || sy < 0 || sx >= part.record.w || sy >= part.record.h) return [0, 0, 0, 0];
  const q = (sy * part.record.w + sx) * 4;
  return Array.from(part.image.data.subarray(q, q + 4));
}

export function rimCount(part: PlacedPart): number {
  let n = 0;
  for (let y = 12; y < 52; y++) for (let x = 12; x < 52; x++) {
    if (Math.min(x - 12, 51 - x, y - 12, 51 - y) < 4 && rimPixel(part, x, y)[3] > 0) n++;
  }
  return n;
}
