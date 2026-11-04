/** Declared setup plate: hash the same bytes that are decoded, before builds. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { refuseIfAny } from './errors.ts';
import { decodePngBytes } from './raster/png.ts';
import type { Raster } from './raster/types.ts';
import type { SetupPainting } from './setuppainting.ts';

export function readSetupBackdrop(declared: SetupPainting, requirements: string, source: Raster | null): Raster | undefined {
  const plate = declared.backdrop;
  if (plate === undefined) return undefined;
  const fail = (detail: string): never => {
    refuseIfAny([{ code: 'CHECK_SETUP_PAINTING_BACKDROP', object: 'setup_painting.backdrop', detail }]);
    throw new Error('unreachable');
  };
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(readFileSync(resolve(dirname(requirements), plate.path))); }
  catch { return fail(`cannot read declared PNG "${plate.path}"; requires the authored opaque backdrop, not a guessed colour`); }
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== plate.sha256) return fail(`PNG "${plate.path}" has sha256 ${hash}; requires declared ${plate.sha256}`);
  let raster: Raster;
  try { raster = decodePngBytes(bytes, plate.path); }
  catch { return fail(`"${plate.path}" is not a decodable PNG; requires an opaque backdrop on the original painting grid`); }
  if (source === null || raster.width !== source.width || raster.height !== source.height) return fail(`PNG "${plate.path}" is ${raster.width}x${raster.height}; requires the original source painting grid ${source === null ? '(no source)' : `${source.width}x${source.height}`}, without fitting`);
  if (raster.data.some((v, i) => i % 4 === 3 && v !== 255)) return fail(`PNG "${plate.path}" contains nonopaque pixels; requires alpha 255 throughout`);
  return raster;
}
