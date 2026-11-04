/** Public procedural room and figure-only rig, derived from synthetic parts. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECK_PARTS, checkPartRaster, writeCheckRig } from './checkrig.ts';
import { alphaComposite } from '../src/raster/composite.ts';
import { writePng } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
import type { SetupPainting } from '../src/setuppainting.ts';

export function writeSetupFigureFixture(dir: string): SetupPainting {
  mkdirSync(dir, { recursive: true });
  writeCheckRig(join(dir, 'rig'));
  let figure = newRaster(48, 80);
  for (const part of CHECK_PARTS) {
    const image = checkPartRaster(part);
    for (let q = 3; q < image.data.length; q += 4) if (image.data[q] > 0) image.data[q] = 255;
    for (const folder of ['images', 'parts']) writePng(join(dir, 'rig', folder, part.name + '.png'), image);
    figure = alphaComposite(figure, image, part.x, part.y);
  }
  const room = newRaster(48, 80);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 48; x++) {
    const floor = y >= 60, window = x >= 3 && x < 12 && y >= 8 && y < 28;
    room.data.set(window ? [100, 150, 190, 255] : floor ? [100, 70, 40, 255] : [60 + x, 70 + y, 90, 255], (y * 48 + x) * 4);
  }
  writePng(join(dir, 'painting.png'), alphaComposite(room, figure, 0, 0));
  writePng(join(dir, 'figure.png'), figure);
  const declared: SetupPainting = {
    figure_mask: { path: 'figure.png', sha256: createHash('sha256').update(readFileSync(join(dir, 'figure.png'))).digest('hex') },
    rgb_tolerance: 3,
    regions: [{ name: 'figure', box: [0, 0, 48, 80], max_pixels: 0 }, { name: 'upper', box: [0, 0, 48, 45], max_pixels: 0 }],
  };
  writeFileSync(join(dir, 'requirements.json'), JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [], setup_painting: declared }, null, 2) + '\n');
  return declared;
}
if (import.meta.main) {
  const out = process.argv[2];
  if (out === undefined || process.argv.length !== 3) throw new Error('usage: bun fixtures/setupfigure.ts <output-directory>');
  writeSetupFigureFixture(out);
}
