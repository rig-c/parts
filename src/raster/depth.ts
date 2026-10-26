/** Processed relative relief, never metric distance. No inferred polarity or mask. */
import { decode } from 'jpeg-js';
import { decodePngBytes } from './png.ts';
import type { Raster } from './types.ts';

export function decodeDepth(bytes: Uint8Array, format: 'jpeg-rgb8' | 'png', label: string): Raster {
  if (format === 'png') return decodePngBytes(bytes, label);
  const image = decode(bytes, { useTArray: true, formatAsRGBA: true, tolerantDecoding: false, maxResolutionInMP: 32, maxMemoryUsageInMB: 256 });
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

/** Half-pixel centred separable triangle filter; widen support on downsampling.
 * Float64 channel output, no per-region stretch, gamma, or byte quantization.
 * This is an explicit filter definition, not a bit-exact Pillow claim.
 */
export function depthChannel(image: Raster, width: number, height: number): Float64Array {
  const table = (from: number, to: number): Array<Array<[number, number]>> => {
    const scale = from / to, support = Math.max(1, scale);
    return Array.from({ length: to }, (_, i) => {
      const centre = (i + 0.5) * scale - 0.5, rows: Array<[number, number]> = [];
      for (let k = Math.max(0, Math.ceil(centre - support)); k <= Math.min(from - 1, Math.floor(centre + support)); k++) {
        const weight = Math.max(0, 1 - Math.abs(k - centre) / support);
        if (weight > 0) rows.push([k, weight]);
      }
      const total = rows.reduce((sum, row) => sum + row[1], 0);
      return rows.map(([k, w]) => [k, w / total]);
    });
  };
  const xs = table(image.width, width), ys = table(image.height, height);
  const horizontal = new Float64Array(width * image.height), out = new Float64Array(width * height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < width; x++) {
    for (const [i, w] of xs[x]) horizontal[y * width + x] += image.data[(y * image.width + i) * 4] * w / 255;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    for (const [i, w] of ys[y]) out[y * width + x] += horizontal[i * width + x] * w;
  }
  return out;
}
