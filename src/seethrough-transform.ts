import { newRaster, type Raster } from './raster/types.ts';
import { resize } from './raster/resize.ts';

/** image_sha256 in the enclosing run record binds the source PNG bytes. */
export interface SeeThroughTransform {
  source: [number, number];
  padded: [number, number];
  pad: [number, number];
  scale: number;
  resample: 'parts-lanczos3-rgba';
  pad_fill: 'rgb-black-opaque';
  target: [number, number];
  inverse: 'nearest-pixel-centres';
}

/** Prepare only non-square images. Square inputs keep their original upload bytes. */
export function prepareSeeThroughInput(source: Raster, resolution: number): { image: Raster; transform?: SeeThroughTransform } {
  if (source.width === source.height) return { image: source };
  const side = Math.max(source.width, source.height);
  const left = Math.floor((side - source.width) / 2);
  const top = Math.floor((side - source.height) / 2);
  const padded = newRaster(side, side);
  for (let y = 0; y < source.height; y++) {
    padded.data.set(source.data.subarray(y * source.width * 4, (y + 1) * source.width * 4), ((y + top) * side + left) * 4);
  }
  return {
    image: resize(padded, resolution, resolution, 'lanczos3'),
    transform: {
      source: [source.width, source.height], padded: [side, side], pad: [left, top],
      scale: resolution / side, resample: 'parts-lanczos3-rgba', pad_fill: 'rgb-black-opaque', target: [resolution, resolution], inverse: 'nearest-pixel-centres',
    },
  };
}

/** Validate all geometry before allocating or indexing a mapped mask. Offsets are read, never inferred. */
export function isSeeThroughTransform(value: unknown, width: number, height: number, targetWidth: number, targetHeight: number): value is SeeThroughTransform {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const pair = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every(n => Number.isSafeInteger(n));
  if (!pair(v.source) || !pair(v.padded) || !pair(v.pad) || !pair(v.target)) return false;
  const side = v.padded[0];
  return v.source[0] === width && v.source[1] === height && width !== height &&
    side === Math.max(width, height) && v.padded[1] === side &&
    v.pad[0] >= 0 && v.pad[1] >= 0 && v.pad[0] + width <= side && v.pad[1] + height <= side &&
    v.target[0] === targetWidth && v.target[1] === targetHeight && targetWidth > 0 && targetWidth === targetHeight &&
    v.scale === targetWidth / side && v.resample === 'parts-lanczos3-rgba' && v.pad_fill === 'rgb-black-opaque' && v.inverse === 'nearest-pixel-centres';
}

/** Sample the union at transformed source pixel centres. Sub-grid detail cannot be recovered. */
export function inverseSeeThroughMask(mask: Uint8Array, transform: SeeThroughTransform): Uint8Array {
  const [width, height] = transform.source;
  const [targetWidth, targetHeight] = transform.target;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const ty = Math.min(targetHeight - 1, Math.floor((y + transform.pad[1] + 0.5) * transform.scale));
    for (let x = 0; x < width; x++) {
      const tx = Math.min(targetWidth - 1, Math.floor((x + transform.pad[0] + 0.5) * transform.scale));
      out[y * width + x] = mask[ty * targetWidth + tx];
    }
  }
  return out;
}
