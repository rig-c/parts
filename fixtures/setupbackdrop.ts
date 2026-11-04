/** Generate a public synthetic backdrop fixture; no binary assets are tracked.
 * Run: bun fixtures/setupbackdrop.ts <output-directory>
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECK_PARTS, checkPartRaster, writeCheckRig } from './checkrig.ts';
import { alphaComposite } from '../src/raster/composite.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
import type { SetupPainting } from '../src/setuppainting.ts';

export function writeSetupBackdropFixture(dir: string): SetupPainting {
  mkdirSync(dir, { recursive: true });
  writeCheckRig(join(dir, 'rig'));
  const plate = newRaster(48, 80);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 48; x++) plate.data.set([20 + x, 30 + y, 60, 255], (y * 48 + x) * 4);
  const bytes = encodePngBytes(plate);
  writeFileSync(join(dir, 'backdrop.png'), bytes);
  let painting = plate;
  for (const p of CHECK_PARTS) painting = alphaComposite(painting, checkPartRaster(p), p.x, p.y);
  writeFileSync(join(dir, 'painting.png'), encodePngBytes(painting));
  const declared: SetupPainting = { backdrop: { path: 'backdrop.png', sha256: createHash('sha256').update(bytes).digest('hex') }, rgb_tolerance: 3, regions: [{ name: 'figure', box: [0, 0, 48, 80], max_pixels: 0 }] };
  writeFileSync(join(dir, 'requirements.json'), JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [], setup_painting: declared }, null, 2) + '\n');
  return declared;
}
if (import.meta.main) {
  const out = process.argv[2];
  if (out === undefined || process.argv.length !== 3) throw new Error('usage: bun fixtures/setupbackdrop.ts <output-directory>');
  writeSetupBackdropFixture(out);
}
