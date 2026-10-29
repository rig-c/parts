/**
 * PNG in and out, through rig-c's own codec.
 *
 * ⚖️ **Why no PNG dependency.** `rig-c` ships a complete PNG codec inside
 * its published allowlist: `tools/plate.ts` exports `decodePng` (every colour
 * type the PNG spec defines — greyscale, RGB, indexed with `PLTE`/`tRNS`,
 * grey+alpha, RGBA — at every legal bit depth, all five scanline filters,
 * expanded to straight RGBA) and `encodePng` (8-bit RGBA, filter 0, zlib level
 * 9, deterministic), and `src/png.ts` exports `assertPng`, which names what a
 * file is when it is not a PNG. `npm pack --dry-run` of rig-c 1.2.3 lists
 * both files. The one gap is interlaced (Adam7) files, which `decodePng`
 * refuses by name rather than misreading. So adding `pngjs` would have been a
 * second codec for the same bytes, and two codecs are two answers.
 *
 * 🔌 **The deep path is the interface.** rig-c's `exports` map carries
 * `./*.ts`, so `rig-c/tools/plate.ts` is how a consumer reaches the codec
 * and it is what the installed package resolves. If a rigc release narrows the
 * map to omit these paths, this import is what breaks, by name, and
 * `bun run smoke` is where that is seen first.
 */
import { assertPng } from '@rig-c/core/src/png.ts';
import { decodePng, encodePng } from '@rig-c/core/tools/plate.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { type FloatImage, newFloatImage, newRaster, type Raster, RasterError } from './types.ts';

/** Decode PNG bytes to a straight-alpha RGBA raster. `label` names the bytes in any refusal. */
export function decodePngBytes(bytes: Uint8Array, label: string): Raster {
  assertPng(bytes, label);
  let plate;
  try {
    plate = decodePng(bytes);
  } catch (err) {
    throw new RasterError(`cannot decode PNG ${label}: ${(err as Error).message}`);
  }
  return { width: plate.width, height: plate.height, data: new Uint8ClampedArray(plate.data) };
}

export function readPng(path: string): Raster {
  return decodePngBytes(new Uint8Array(readFileSync(path)), path);
}

export function encodePngBytes(r: Raster): Uint8Array {
  return encodePng(r.width, r.height, new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength));
}

export function writePng(path: string, r: Raster): void {
  writeFileSync(path, encodePngBytes(r));
}

/**
 * A raster as four float channels, optionally premultiplied (`c * a / 255`,
 * unrounded) — the form the reference warps in.
 */
export function toFloat(r: Raster, premultiply: boolean): FloatImage {
  const f = newFloatImage(r.width, r.height, 4);
  for (let i = 0; i < r.width * r.height; i++) {
    const a = r.data[i * 4 + 3];
    for (let c = 0; c < 3; c++) f.data[i * 4 + c] = premultiply ? (r.data[i * 4 + c] * a) / 255 : r.data[i * 4 + c];
    f.data[i * 4 + 3] = a;
  }
  return f;
}

/**
 * Four float channels back to a raster: clipped to 0..255, optionally
 * un-premultiplied, then TRUNCATED to integers — `np.clip(...).astype(np.uint8)`,
 * which is what the reference does, and which is not rounding.
 */
export function fromFloat(f: FloatImage, premultiplied: boolean): Raster {
  if (f.channels !== 4) throw new RasterError(`fromFloat: ${f.channels} channel(s); 4 are required`);
  const r = newRaster(f.width, f.height);
  const clip = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let i = 0; i < f.width * f.height; i++) {
    const a = clip(f.data[i * 4 + 3]);
    for (let c = 0; c < 3; c++) {
      const v = clip(f.data[i * 4 + c]);
      r.data[i * 4 + c] = Math.trunc(premultiplied ? (a > 0 ? clip((v * 255) / Math.max(a, 1e-3)) : 0) : v);
    }
    r.data[i * 4 + 3] = Math.trunc(a);
  }
  return r;
}
