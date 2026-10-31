/**
 * The three pixel containers the pipeline passes around.
 *
 * - `Raster` is 8-bit RGBA with STRAIGHT (non-premultiplied) alpha, row-major,
 *   top-left origin, y down — what a PNG part is on disk.
 * - `Mask` is one byte per pixel holding exactly 0 or 1. Every morphology and
 *   labelling op reads and writes this, never a thresholded `Raster`, so the
 *   threshold is always a visible decision at the call site.
 * - `FloatImage` is `channels` float32 samples per pixel, for the ops the
 *   reference implementation runs in floating point (a premultiplied warp, a
 *   feathered blend weight).
 *
 * Nothing here knows about Spine's y-up world. The only conversion between the
 * two lives in `@rig-c/core/transform`, re-exported by `src/coords.ts`.
 */
export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface Mask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface FloatImage {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly data: Float32Array;
}

/** A raster op refused its arguments. The message names the op, the value found and the value required. */
export class RasterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RasterError';
  }
}

function assertDims(op: string, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new RasterError(`${op}: size ${width}x${height} is not a pair of non-negative integers`);
  }
}

export function newRaster(width: number, height: number): Raster {
  assertDims('newRaster', width, height);
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function newMask(width: number, height: number): Mask {
  assertDims('newMask', width, height);
  return { width, height, data: new Uint8Array(width * height) };
}

export function newFloatImage(width: number, height: number, channels: number): FloatImage {
  assertDims('newFloatImage', width, height);
  if (!Number.isInteger(channels) || channels < 1) {
    throw new RasterError(`newFloatImage: ${channels} channel(s) is not a positive integer`);
  }
  return { width, height, channels, data: new Float32Array(width * height * channels) };
}

/** Pixels whose alpha is strictly above `threshold`, as a mask. */
export function alphaAbove(r: Raster, threshold: number): Mask {
  const m = newMask(r.width, r.height);
  for (let i = 0; i < m.data.length; i++) m.data[i] = r.data[i * 4 + 3] > threshold ? 1 : 0;
  return m;
}

/** How many pixels a mask sets. */
export function maskCount(m: Mask): number {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) n += m.data[i];
  return n;
}

/** Whether a mask holds only 0 and 1 — the precondition every mask op states. */
export function assertBinary(op: string, m: Mask): void {
  for (let i = 0; i < m.data.length; i++) {
    const v = m.data[i];
    if (v !== 0 && v !== 1) {
      throw new RasterError(`${op}: mask pixel ${i % m.width},${Math.floor(i / m.width)} holds ${v}; a mask holds 0 or 1`);
    }
  }
}
