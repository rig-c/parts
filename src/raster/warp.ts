import { type FloatImage, newFloatImage, RasterError } from './types.ts';

/** A forward map `dst = scale * src + translate`, per axis — the only affine the pipeline uses. */
export interface ScaleTranslate {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export type WarpFilter = 'bilinear' | 'bicubic';

const AB_BITS = 10;
const AB_SCALE = 1 << AB_BITS;
const INTER_BITS = 5;
const INTER_TAB_SIZE = 1 << INTER_BITS;

function cvRound(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

function cubic(x: number): [number, number, number, number] {
  const A = -0.75;
  const c0 = ((A * (x + 1) - 5 * A) * (x + 1) + 8 * A) * (x + 1) - 4 * A;
  const c1 = ((A + 2) * x - (A + 3)) * x * x + 1;
  const c2 = ((A + 2) * (1 - x) - (A + 3)) * (1 - x) * (1 - x) + 1;
  return [c0, c1, c2, 1 - c0 - c1 - c2];
}

/**
 * The sample position of each output index along one axis, in cv2's own
 * arithmetic: the inverse map in 10-bit fixed point, rounded to 1/32 of a
 * pixel (`INTER_TAB_SIZE`). Returned as the integer part and the 1/32 step.
 *
 * ⚠️ The two axes are rounded differently, because cv2 does: along x the
 * offset and the per-column step are rounded to fixed point SEPARATELY
 * (`X0 + adelta[x]`), along y their sum is rounded once per row (`Y0`). Using
 * the x rule for both moved samples by up to 6.3 levels in 84,508 measured
 * against cv2 4.13.
 */
function positions(outSize: number, scale: number, translate: number, axis: 'x' | 'y'): Array<[number, number]> {
  const inv = 1 / scale;
  const offset = -translate / scale;
  const half = AB_SCALE / INTER_TAB_SIZE / 2;
  const out: Array<[number, number]> = [];
  for (let o = 0; o < outSize; o++) {
    const fixed = axis === 'x' ? cvRound(offset * AB_SCALE) + cvRound(inv * o * AB_SCALE) : cvRound((inv * o + offset) * AB_SCALE);
    const q = Math.floor((fixed + half) / (1 << (AB_BITS - INTER_BITS)));
    const i = Math.floor(q / INTER_TAB_SIZE);
    out.push([i, q - i * INTER_TAB_SIZE]);
  }
  return out;
}

/**
 * `cv2.warpAffine(src, [[sx, 0, tx], [0, sy, ty]], (width, height), flags,
 * borderValue=0)` on a float image, for the scale-and-translate maps the
 * pipeline uses. Every channel is warped independently; a caller that wants a
 * premultiplied warp premultiplies first, as the reference does.
 *
 * What is cv2's and reproduced here, because each moves a sample:
 * - no half-pixel offset: output pixel `x` samples input `(x - tx) / sx`;
 * - that position is rounded to 1/32 of a pixel through cv2's 10-bit fixed
 *   point before the filter weights are read;
 * - taps outside the image read the border value 0 and still carry weight.
 *
 * Measured against cv2 4.13 over 84,508 float samples at random scales and
 * offsets: bilinear within 3.1e-5, bicubic within 6.1e-5 (float32 rounding).
 *
 * ⚠️ `cv2.INTER_AREA` passed to `warpAffine` is not an area filter: on every
 * one of those 84,508 samples cv2 returned exactly its INTER_LINEAR output.
 * The reference passes INTER_AREA when the scale is below one, so the port of
 * that call site asks for `bilinear`, and says why.
 */
export function warpAffine(src: FloatImage, map: ScaleTranslate, width: number, height: number, filter: WarpFilter): FloatImage {
  for (const [k, v] of Object.entries(map)) {
    if (!Number.isFinite(v)) throw new RasterError(`warpAffine: ${k} is ${v}; a finite number is required`);
  }
  if (map.sx === 0 || map.sy === 0) throw new RasterError(`warpAffine: scale ${map.sx}x${map.sy} is singular`);
  if (filter !== 'bilinear' && filter !== 'bicubic') {
    throw new RasterError(`warpAffine: filter "${String(filter)}"; bilinear or bicubic is required`);
  }
  const px = positions(width, map.sx, map.tx, 'x');
  const py = positions(height, map.sy, map.ty, 'y');
  const weights = (step: number): number[] => {
    const f = step / INTER_TAB_SIZE;
    return filter === 'bilinear' ? [1 - f, f] : cubic(f);
  };
  const first = filter === 'bilinear' ? 0 : -1;
  const taps = filter === 'bilinear' ? 2 : 4;
  const { width: sw, height: sh, channels: ch } = src;
  const out = newFloatImage(width, height, ch);
  for (let y = 0; y < height; y++) {
    const [iy, fy] = py[y];
    const wy = weights(fy);
    for (let x = 0; x < width; x++) {
      const [ix, fx] = px[x];
      const wx = weights(fx);
      for (let c = 0; c < ch; c++) {
        let s = 0;
        for (let j = 0; j < taps; j++) {
          const sy = iy + first + j;
          if (sy < 0 || sy >= sh) continue;
          let row = 0;
          for (let i = 0; i < taps; i++) {
            const sx = ix + first + i;
            if (sx < 0 || sx >= sw) continue;
            row += src.data[(sy * sw + sx) * ch + c] * wx[i];
          }
          s += row * wy[j];
        }
        out.data[(y * width + x) * ch + c] = s;
      }
    }
  }
  return out;
}
