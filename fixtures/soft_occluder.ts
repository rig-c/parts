/** Public, wholly synthetic amodal completion under a soft garment hem (#825).
 * One rig pixel is one source/run pixel. The hidden under-part is uniform;
 * all dark hem ink comes from compositing the front layer into the painting.
 */
import type { AssembleInput } from '../src/assemble.ts';
import type { PlacedPart } from '../src/assemble.ts';
import type { Layer, LayerSet } from '../src/layers.ts';
import { newRaster, type Raster } from '../src/raster/index.ts';
import { readLayerTag } from '../src/tags.ts';

export const SOFT_SIZE = 96;
export const SOFT_SKIN = [220, 180, 140, 255] as const;
export const SOFT_HEM = [40, 30, 20] as const;
export const SOFT_BAND = [32, 34, 56, 42] as const;

/** Combined historical yield/limb-cover path. The lower cap copies upper art;
 * its existing keep mask must stay independent of the new option (#825).
 * The matching opaque backdrop is available after earlier front yields.
 */
export function yieldLimbCoverFixture(): AssembleInput {
  const f = softOccluderFixture('none'), cover = softOccluderFixture().full.layers[1];
  const back = newRaster(96, 96), front = newRaster(96, 96);
  for (let p = 0; p < 96 * 96; p++) {
    back.data.set([100, 100, 100, 255], p * 4);
    f.source.data.set([100, 100, 100, 255], p * 4);
  }
  for (let y = 8; y < 88; y++) for (let x = 24; x < 72; x++) front.data.set([200, 100, 100, 255], (y * 96 + x) * 4);
  f.full = { ...f.full, layers: [{ ...f.full.layers[0], pixels: back, opaquePx: 96 * 96 }, { ...cover, pixels: front, opaquePx: 48 * 80 }] };
  f.plan = [['under', 'full', 'neck'], ['front', 'full', 'topwear']];
  f.bones = [{ chain: 'arm', parent: 'root', points: [[48, 8], [48, 48]], tip: [48, 88] }];
  f.limbs = { arm_r: { segments: [{ part: 'upper', from: 'front', bone: 'arm0' }, { part: 'lower', from: 'front', bone: 'arm1', joint: 'elbow' }] } };
  f.limbUnderCover = true;
  f.yieldRefused = true;
  f.turnMovingPair = () => true;
  return f;
}

/** Independent inverse rigid transform: the pivot is (44,34), extremes 0/30.
 * ROI y>=42 is beyond the stationary hem; both poses have real under-part
 * support there. Uniform amodal skin has zero max-min residual in this ROI.
 * Only samples whose max-pose source is inside the declared hem are counted.
 * This oracle uses nearest texel centres, not the assembler's masks or counts.
 */
export function softTrailDiff(part: PlacedPart): { count: number; population: number; alphaHoles: number } {
  let count = 0, population = 0, alphaHoles = 0;
  const sample = (x: number, y: number): number[] => {
    const ix = Math.floor(x) - part.record.x, iy = Math.floor(y) - part.record.y;
    if (ix < 0 || iy < 0 || ix >= part.image.width || iy >= part.image.height) return [0, 0, 0, 0];
    return Array.from(part.image.data.subarray((iy * part.image.width + ix) * 4, (iy * part.image.width + ix) * 4 + 4));
  };
  for (let y = 42; y < 50; y++) for (let x = 32; x < 56; x++) {
    const dx = x + 0.5 - 44, dy = y + 0.5 - 34;
    const sx = 44 + dx * Math.sqrt(3) / 2 - dy / 2, sy = 34 + dx / 2 + dy * Math.sqrt(3) / 2;
    if (sx < 34 || sx >= 54 || sy < 36 || sy >= 42) continue;
    population++;
    const min = sample(x + 0.5, y + 0.5), max = sample(sx, sy);
    if (min[3] !== 255 || max[3] !== 255) alphaHoles++;
    if (min.slice(0, 3).some((v, c) => Math.abs(v - max[c]) > 0)) count++;
  }
  return { count, population, alphaHoles };
}

export function softOccluderFixture(edge: 'soft' | 'opaque' | 'none' = 'soft'): AssembleInput {
  const N = SOFT_SIZE;
  const under = newRaster(N, N), cover = newRaster(N, N), source = newRaster(N, N);
  for (let p = 0; p < N * N; p++) source.data.set([255, 255, 255, 255], p * 4);
  for (let y = 12; y < 84; y++) for (let x = 32; x < 56; x++) under.data.set(SOFT_SKIN, (y * N + x) * 4);
  if (edge !== 'none') for (let y = 8; y < 42; y++) for (let x = 16; x < 72; x++) {
    const a = edge === 'opaque' || y < 34 ? 255 : 8 + (41 - y) * 120 / 7;
    cover.data.set([...SOFT_HEM, Math.round(a)], (y * N + x) * 4);
  }
  for (const image of [under, cover]) for (let p = 0; p < N * N; p++) {
    const a = image.data[p * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) source.data[p * 4 + c] = Math.round(image.data[p * 4 + c] * a + source.data[p * 4 + c] * (1 - a));
  }
  const layer = (name: string, pixels: Raster, drawOrder: number): Layer => ({
    name, tag: readLayerTag(name)!, file: null, pixels, left: 0, top: 0, right: N, bottom: N,
    depth: 1 - drawOrder / 2, drawOrder, opaquePx: Array.from(pixels.data).filter((v, i) => i % 4 === 3 && v > 8).length,
  });
  const full: LayerSet = { form: 'wrapper', source: 'synthetic', canvas: { w: N, h: N }, layers: [layer('neck', under, 0), ...(edge === 'none' ? [] : [layer('topwear', cover, 1)])], hidden: [] };
  return { source, full, head: { ...full, layers: [] }, resolution: N, headBox: [0, 0, N, N], rigScale: 1,
    plan: [['under', 'full', 'neck'], ...(edge === 'none' ? [] : [['cover', 'full', 'topwear'] as [string, 'full', string]])], extend: [], cuts: [], patches: [], seamRule: 'near-white', projectRule: 'core' };
}
