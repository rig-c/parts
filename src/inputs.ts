/**
 * The two images See-through is fed, cut from the painting.
 *
 * - **full** — the painting centred on a WHITE square whose side is the
 *   painting's longer side (See-through's own pad is black, and a black margin
 *   reads to it as part of the figure): a portrait painting is padded left and
 *   right, a landscape one top and bottom, each by `squarePad`. The reference
 *   pasted at `((side - w) // 2, 0)` on a square of side `h`, which is centred
 *   only because its paintings are portrait; for those the vertical pad is 0
 *   and the bytes are the reference's. The pad is on See-through's input only:
 *   `proposeHeadBox` (`src/headbox.ts`) and `assemble` (`src/assemble.ts`) map
 *   the full run back through the same `squarePad`, x and y alike, so the rig
 *   stays in painting pixels with no padding in it.
 * - **head** — `seethrough.head_box` cut from the painting at its exact size.
 *   Written only when the config sets a head box; the config loader has
 *   already refused a box that is not a non-empty square.
 *
 * Pure raster. The reference converted the painting to RGB, which DROPS alpha
 * rather than compositing it — a translucent pixel would have kept whatever
 * colour sat under it. Neither dropping nor compositing is a value the input
 * states, so a painting with any pixel below alpha 255 is refused.
 *
 * Measured against the reference's own `st_input_full.png` and
 * `st_input_head.png` for the public examples: the selftest's
 * `inputs-examples` suite compares them pixel for pixel whenever
 * `bun run fetch-examples` has put them on disk.
 */
import type { CharacterConfig } from './config.ts';
import { type Problem, refuseIfAny } from './errors.ts';
import { crop, pad } from './raster/composite.ts';
import type { Raster } from './raster/types.ts';

export interface SeeThroughInputs {
  full: Raster;
  /** The pad added on the left, in source px (the right gets the remainder); 0 for a landscape painting. */
  padLeft: number;
  /** The pad added on top, in source px (the bottom gets the remainder); 0 for a portrait painting. */
  padTop: number;
  head: Raster | null;
  headBox: readonly [number, number, number, number] | null;
}

const WHITE: readonly [number, number, number, number] = [255, 255, 255, 255];

/** Where a painting sits on the square the full run is fed, in source px. */
export interface SquarePad {
  /** The square's side: the painting's longer side. */
  side: number;
  /** The margin on the left; the right gets `side - w - left`. */
  left: number;
  /** The margin on top; the bottom gets `side - h - top`. */
  top: number;
}

/**
 * The one derivation of the full run's pad, read by every stage that maps the
 * full run back to the painting. Each margin floors, as the reference's
 * `(side - w) // 2` does, so an odd remainder goes to the right or the bottom.
 * At most one of the two margins is non-zero.
 */
export function squarePad(w: number, h: number): SquarePad {
  return padToSquare(w, h, Math.max(w, h));
}

/**
 * The same centring on a square of a given `side` (issue #366): a single run's
 * file padded to the `seethrough.resolution` square. Each margin floors, so an
 * odd remainder goes to the right or the bottom, exactly as {@link squarePad};
 * both margins are non-zero when both sides are below `side`. The caller has
 * refused a side above `side` — padding cannot shrink a canvas.
 */
export function padToSquare(w: number, h: number, side: number): SquarePad {
  return { side, left: Math.floor((side - w) / 2), top: Math.floor((side - h) / 2) };
}

export function makeInputs(painting: Raster, cfg: { seethrough?: Partial<Pick<NonNullable<CharacterConfig['seethrough']>, 'head_box' | 'resolution'>> }, label: string): SeeThroughInputs {
  const problems: Problem[] = [];
  const { width: w, height: h } = painting;
  let translucent = 0;
  let firstAt = -1;
  for (let i = 0; i < w * h; i++) {
    if (painting.data[i * 4 + 3] !== 255) {
      translucent++;
      if (firstAt === -1) firstAt = i;
    }
  }
  if (translucent > 0) {
    problems.push({
      code: 'INPUTS_PAINTING_OPAQUE',
      object: label,
      detail: `has ${translucent} pixel(s) below alpha 255 (first at ${firstAt % w},${Math.floor(firstAt / w)}); an opaque painting is required, because neither dropping the alpha nor compositing it is stated by the input`,
    });
  }
  const box = cfg.seethrough?.head_box ?? null;
  if (box !== null) {
    const [x0, y0, x1, y1] = box;
    if (x0 < 0 || y0 < 0 || x1 > w || y1 > h) {
      problems.push({
        code: 'INPUTS_HEAD_BOX_INSIDE',
        object: 'config.seethrough.head_box',
        detail: `is [${box.join(', ')}] and the painting is ${w}x${h}; a box inside the painting is required (the crop is not padded)`,
      });
    }
  }
  refuseIfAny(problems);
  const { side, left, top } = squarePad(w, h);
  const full = pad(painting, left, top, side - w - left, side - h - top, WHITE);
  const head = box === null ? null : crop(painting, box[0], box[1], box[2] - box[0], box[3] - box[1]);
  return { full, padLeft: left, padTop: top, head, headBox: box };
}
