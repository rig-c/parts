/** Independent declared alpha support, verified before any candidate build. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { refuseIfAny } from './errors.ts';
import { decodePngBytes } from './raster/png.ts';
import type { Raster } from './raster/types.ts';
import { setupPaintingFilePath, type SetupPainting } from './setuppainting.ts';

export function readSetupFigureMask(declared: SetupPainting, requirements: string, source: Raster | null, width: number, height: number): Uint8Array | undefined {
  const mask = declared.figure_mask;
  if (mask === undefined) return undefined;
  const fail = (detail: string): never => {
    refuseIfAny([{ code: 'CHECK_SETUP_PAINTING_MASK', object: 'setup_painting.figure_mask', detail }]);
    throw new Error('unreachable');
  };
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(readFileSync(setupPaintingFilePath(requirements, mask.path))); }
  catch { return fail(`cannot read declared PNG "${mask.path}"; requires independent figure alpha support`); }
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== mask.sha256) return fail(`PNG "${mask.path}" has sha256 ${hash}; requires declared ${mask.sha256}`);
  let image: Raster;
  try { image = decodePngBytes(bytes, mask.path); }
  catch { return fail(`"${mask.path}" is not a decodable PNG; requires independent figure alpha support`); }
  if (source === null || image.width !== source.width || image.height !== source.height) return fail(`PNG "${mask.path}" is ${image.width}x${image.height}; requires the original source painting grid ${source === null ? '(no source)' : `${source.width}x${source.height}`}, without fitting`);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return fail('requires positive integer stage dimensions');
  if (!image.data.some((v, i) => i % 4 === 3 && v > 0)) return fail(`PNG "${mask.path}" has empty alpha support; requires at least one figure pixel`);
  // Nearest source pixel centre, independently on each axis. No colour,
  // morphology, rendered alpha or interpolated support enters this domain.
  const support = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.floor((x + 0.5) * image.width / width), sy = Math.floor((y + 0.5) * image.height / height);
    support[y * width + x] = image.data[(sy * image.width + sx) * 4 + 3] > 0 ? 1 : 0;
  }
  if (!support.some(v => v === 1)) return fail(`PNG "${mask.path}" has no figure support on the declared stage grid`);
  return support;
}
