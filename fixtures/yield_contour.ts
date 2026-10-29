/** Synthetic opaque accepted band around a refused square (#841).
 * A 16x16 refused interior has a four-pixel accepted surround:
 * 24x24 - 16x16 = 320 samples, matching the sigma-1 feather's radius.
 * Colours and coordinates are independent of any consumer's artwork.
 */
import { yieldRimFixture } from './yield_rim.ts';

export function yieldContourFixture(options: { drift?: number; refuse?: boolean; mismatch?: boolean; holderAlpha?: number } = {}) {
  const input = yieldRimFixture({ mismatch: options.mismatch, holderAlpha: options.holderAlpha });
  const front = input.full.layers[1].pixels;
  front.data.fill(0);
  for (let y = 8; y < 56; y++) for (let x = 8; x < 56; x++) {
    const interior = x >= 24 && x < 40 && y >= 24 && y < 40;
    const band = x >= 20 && x < 44 && y >= 20 && y < 44;
    const drift = interior && options.refuse !== false ? 100 : band ? (options.drift ?? 90) : 0;
    front.data.set([100 + drift, 100, 100, 255], (y * 64 + x) * 4);
  }
  input.full.layers[1].opaquePx = 48 * 48;
  return input;
}
