/**
 * Issue #996: a busy, opaque ground planted under a public example's painting,
 * generated (no binary is tracked). The figure keeps every pixel the painting
 * shows as figure; every other pixel takes a ground of many colours: a tan
 * plank wall with per-pixel texture, a saturated red banner with gold diamonds
 * and navy stripes, and a dark wainscot.
 *
 * The figure is `paintedFigure` (src/assemble.ts) read on the painting itself,
 * at its own size, with every enclosed hole filled — the test that ground uses
 * on a plain painting, so a white blouse inside the outline stays figure and
 * the white page round it becomes ground. Deterministic: integer arithmetic and
 * a fixed-seed generator, so the same painting always gives the same bytes.
 *
 *     bun fixtures/busy_ground.ts <painting.png> <out.png>
 *     bun fixtures/busy_ground.ts --crop-bottom <painting.png> <out.png>
 *
 * `--crop-bottom` writes the other fixture HQ asked for: the plain painting
 * with its bottom third removed, so the figure crosses the bottom edge of a
 * plain ground.
 */
import { paintedFigure } from '../src/assemble.ts';
import { fillHoles } from '../src/raster/morph.ts';
import { readPng, writePng } from '../src/raster/png.ts';
import { newMask, newRaster, type Raster } from '../src/raster/types.ts';

/** The ground's seed: the issue's number, so the fixture is reproducible from its name. */
export const BUSY_GROUND_SEED = 996;

/** mulberry32: a small 32-bit generator with a fixed sequence for a fixed seed. */
function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** The ground colour at (x, y) given the pixel's texture value `noise` in -28..28. */
function groundAt(x: number, y: number, noise: number): [number, number, number] {
  if (y >= 1750) return [58 + (noise >> 1), 74 + (noise >> 1), 52 + (noise >> 1)];
  if (x >= 180 && x < 1480 && y >= 120 && y < 1150) {
    if (y % 128 < 6) return [30, 30, 60];
    if (Math.abs((x % 64) - 32) + Math.abs((y % 64) - 32) < 13) return [236, 196, 48];
    return [196, 24, 36];
  }
  if (x % 96 < 5) return [92, 64, 40];
  const tone = Math.floor(x / 96) % 2 === 1 ? -22 : 0;
  return [196 + noise + tone, 160 + noise + tone, 112 + noise + tone];
}

/** The painting with a busy ground planted behind its figure (see the file's comment). */
export function plantBusyGround(painting: Raster): Raster {
  const { width: W, height: H } = painting;
  const figure = newMask(W, H);
  figure.data.set(paintedFigure(painting));
  const kept = fillHoles(figure);
  const next = generator(BUSY_GROUND_SEED);
  const out = newRaster(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const noise = (next() % 57) - 28;
      if (kept.data[p] === 1) {
        out.data.set(painting.data.subarray(p * 4, p * 4 + 3), p * 4);
      } else {
        const c = groundAt(x, y, noise);
        for (let k = 0; k < 3; k++) out.data[p * 4 + k] = Math.min(255, Math.max(0, c[k]));
      }
      out.data[p * 4 + 3] = 255;
    }
  }
  return out;
}

/** The painting with its bottom third removed: a plain ground the figure crosses at the bottom edge. */
export function cropBottom(painting: Raster): Raster {
  const { width: W, height: H } = painting;
  const h = Math.floor((2 * H) / 3);
  const out = newRaster(W, h);
  out.data.set(painting.data.subarray(0, W * h * 4));
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const crop = args[0] === '--crop-bottom';
  const [src, dst] = crop ? args.slice(1) : args;
  if (src === undefined || dst === undefined) {
    console.error('usage: bun fixtures/busy_ground.ts [--crop-bottom] <painting.png> <out.png>');
    process.exit(2);
  }
  const painting = readPng(src);
  writePng(dst, crop ? cropBottom(painting) : plantBusyGround(painting));
}
