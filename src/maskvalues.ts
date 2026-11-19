import type { Raster } from './raster/types.ts';

/** Read an opaque black/white mask, reporting the first invalid pixel. */
export function readBinaryMask(
  mask: Raster,
  refuse: (detail: string) => never,
): Uint8Array {
  const { width, height, data } = mask;
  const inside = new Uint8Array(width * height);
  for (let p = 0; p < inside.length; p++) {
    const offset = p * 4;
    const r = data[offset], g = data[offset + 1], b = data[offset + 2], a = data[offset + 3];
    const white = r === 255 && g === 255 && b === 255;
    const black = r === 0 && g === 0 && b === 0;
    if (a !== 255 || (!white && !black)) {
      refuse(`holds (${r}, ${g}, ${b}, ${a}) at pixel ${p % width},${Math.floor(p / width)}; only opaque white and opaque black, as assemble writes it, are taken`);
    }
    if (white) inside[p] = 1;
  }
  return inside;
}
