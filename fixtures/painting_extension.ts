/** Public flat blocks for #848: two layers leave an 8 x 7 painted gap. */
import type { PaintingExtension } from '../src/paintingextension.ts';
import type { AssembleInput } from '../src/assemble.ts';
import type { Layer, LayerSet } from '../src/layers.ts';
import { newRaster } from '../src/raster/types.ts';
import { readLayerTag } from '../src/tags.ts';

export const PAINTING_EXTENSION: PaintingExtension = { part: 'upper', band: [10, 15, 22, 25], max_distance: 3 };

export function paintingExtensionFixture(): AssembleInput {
  const N = 64, source = newRaster(N, N), upper = newRaster(N, N), lower = newRaster(N, N);
  const colour = (x: number, y: number): number[] => [40 + x, 50 + y, 60 + x + y, 255];
  for (let y = 10; y < 33; y++) for (let x = 10; x < 18; x++) {
    const p = (y * N + x) * 4;
    source.data.set(colour(x, y), p);
    if (y < 18) upper.data.set(colour(x, y), p);
    if (y >= 25) lower.data.set(colour(x, y), p);
  }
  // Within three geometric steps, but disconnected by transparent column 18.
  source.data.set(colour(19, 16), (16 * N + 19) * 4);
  // Connected to the target, but outside the authored band.
  for (let y = 15; y < 25; y++) source.data.set(colour(9, y), (y * N + 9) * 4);
  // Adjacent and in-band, but not opaque in the painting.
  source.data.set([80, 90, 100, 249], (17 * N + 18) * 4);
  const layer = (name: string, pixels: typeof upper, drawOrder: number): Layer => ({
    name, tag: readLayerTag(name)!, pixels, file: null, left: 0, top: 0, right: N, bottom: N,
    depth: 1 - drawOrder / 2, drawOrder, opaquePx: 64,
  });
  const full: LayerSet = { form: 'wrapper', source: 'synthetic', canvas: { w: N, h: N },
    layers: [layer('topwear', upper, 0), layer('bottomwear', lower, 1)], hidden: [] };
  return { source, full, head: { ...full, layers: [] }, resolution: N, headBox: [0, 0, N, N], rigScale: 1,
    plan: [['upper', 'full', 'topwear'], ['lower', 'full', 'bottomwear']], extend: [], patches: [], cuts: [],
    seamRule: 'near-white', projectRule: 'core' };
}

export function paintingExtensionConfig(extension: unknown = [PAINTING_EXTENSION]): Record<string, unknown> {
  const f = paintingExtensionFixture();
  return { key: 'painted-blocks', seethrough: { resolution: 64, head_box: f.headBox, steps: 1, seed: 0, offload: false },
    assemble: { rig_scale: 1, plan: f.plan, extend_painting: extension },
    bones: [{ name: 'upper', parent: 'root', at: [14, 10] }, { name: 'lower', parent: 'root', at: [14, 25] }],
    meshes: {}, regions: { upper: 'upper', lower: 'lower' }, motion: { duration: 1,
      tracks: [{ bone: 'upper', prop: 'rotate', amp: 0, period: 1, phase: 0 }] } };
}

/** Public faint-edge regression: two connected 8-pixel rows cross the gap. */
export function faintPaintingExtensionFixture(): AssembleInput {
  const f = paintingExtensionFixture();
  for (let x = 10; x < 18; x++) {
    f.full.layers[0].pixels.data.set([190, 30, 50, 35], (18 * 64 + x) * 4);
    f.full.layers[1].pixels.data.set([20, 180, 80, 35], (24 * 64 + x) * 4);
  }
  return f;
}

/** Public interleaving claims: two seeds border a five-column shared gap. */
export function interleavingPaintingExtensionFixture() {
  const painting = newRaster(7, 3), first = newRaster(7, 3), second = newRaster(7, 3), holder = newRaster(1, 1);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 7; x++) {
    const p = (y * 7 + x) * 4;
    painting.data.set([80 + x, 90 + y, 100, 255], p);
    if (x === 0) first.data.set([10, 20, 30, 255], p);
    if (x === 6) second.data.set([40, 50, 60, 255], p);
    if (x > 0 && x < 6 && (y === 0 || (x + y) % 2 === 0)) second.data.set([70, 80, 90, 8], p);
  }
  holder.data.set([210, 40, 90, 1]);
  const parts = [{ name: 'first', image: first }, { name: 'second', image: second }, { name: 'holder', image: holder, x: 2, y: 1 }];
  const declarations: PaintingExtension[] = [
    { part: 'first', band: [0, 0, 7, 3], max_distance: 2, min_held_alpha: 250 },
    { part: 'second', band: [0, 0, 7, 3], max_distance: 5, min_held_alpha: 250 },
  ];
  return { painting, parts, declarations };
}
