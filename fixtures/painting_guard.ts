import { paintingReceivers, rawPaintingOwner } from '../src/paintingowner.ts';
import { newRaster } from '../src/raster/types.ts';

/** Two art lobes joined by soft art, or a soft receive detached from its art. */
export function paintingGuardFixture(mode: 'bridge' | 'island') {
  const width = 48, height = 32;
  const behind = newRaster(width, height), front = newRaster(width, height), source = newRaster(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    behind.data.set([0, 0, 200, mode === 'bridge' || x >= 26 ? 255 : 0], offset);
    const lobe = y >= 8 && y < 24 && ((x >= 8 && x < 20) || (x >= 24 && x < 36));
    const bridge = y === 16 && x >= 20 && x < 24;
    const alpha = mode === 'bridge' ? (lobe ? 255 : bridge ? 20 : 0)
      : x >= 12 && x < 26 && y >= 8 && y < 24 ? 255 : 0;
    front.data.set([200, 0, 0, alpha], offset);
    source.data.set(alpha >= 128 ? [200, 0, 0, 255] : [0, 0, 200, 255], offset);
    if (mode === 'bridge' && bridge) source.data.set([30, 0, 170, 255], offset);
  }
  const pixel = 16 * width + (mode === 'bridge' ? 21 : 24);
  if (mode === 'island') {
    behind.data.set([0, 0, 200, 5], pixel * 4);
    front.data[pixel * 4 + 3] = 20;
    source.data.set([30, 0, 170, 255], pixel * 4);
  }
  const parts = [behind, front];
  const raw = parts.map(raster => ({ ...raster, data: new Uint8ClampedArray(raster.data) }));
  if (mode === 'island') raw[0].data[pixel * 4 + 3] = 255;
  const names = ['behind', 'front'];
  const owner = paintingReceivers(rawPaintingOwner(raw.map((raster, i) => ({ name: names[i], raster })), width * height),
    parts.map((image, i) => ({ name: names[i], image, region: null })), []);
  return { source, parts, owner, pixel, ground: mode === 'island' ? 'busy' as const : 'plain' as const };
}
