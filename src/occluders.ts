/**
 * Declared occluders (issue #1230): `config.assemble.occluders`, an opt-in
 * list of RGBA images of what stands in front of the character, each on the
 * painting's grid, bound by sha256, with the plan parts it stands over.
 *
 * Today one reading uses it: a pixel of an `under` part's selected source
 * layer (after any take, before projection or cleanup) with alpha above
 * {@link COPIED_ALPHA_ABOVE}, where the occluder's alpha is above 0, whose RGB
 * lies within `rgb_within` (max absolute channel difference) of the painting
 * at that pixel, is the occluder's own colour copied into the layer: the run
 * painted the thing in front into the surface behind it. It is reported as a
 * WARN with {@link OCCLUDER_COLOUR_COPIED}, never silently kept and never
 * repaired.
 *
 * Nothing here reads a stage or an assembly, so the config doors can share
 * the name and file checks without an import cycle.
 */
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileSha256, SHA256_PATTERN } from './editreceipt.ts';
import type { Problem } from './errors.ts';
import type { Raster } from './raster/types.ts';

export interface OccluderDeclaration {
  /** An RGBA PNG on the painting's grid, relative to the config's directory. */
  image: string;
  /** The image file's sha256, 64 lowercase hex digits. */
  sha256: string;
  /** Plan parts the occluder stands in front of. */
  under: string[];
  /** Max absolute channel difference from the painting at which an `under` pixel reads as the occluder's colour. */
  rgb_within: number;
}

export const OCCLUDER_COLOUR_COPIED = 'ASSEMBLE_OCCLUDER_COLOUR_COPIED';
/** An `under` layer pixel counts at alpha above this: the half-opaque floor `deriveTakenRegion` reads. */
export const COPIED_ALPHA_ABOVE = 128;

const AT = 'config.assemble.occluders';

/** Every `under` entry names a plan part (`CONFIG_NAME_RESOLVES`); `names` null skips the check (a door without the plan). */
export function occluderNameProblems(declarations: readonly OccluderDeclaration[], names: readonly string[] | null): Problem[] {
  if (names === null) return [];
  const problems: Problem[] = [];
  declarations.forEach((d, i) => d.under.forEach((name, j) => {
    if (!names.includes(name)) problems.push({ code: 'CONFIG_NAME_RESOLVES', object: `${AT}[${i}].under[${j}]`, detail: `names "${name}"; a part in config.assemble.plan is required` });
  }));
  return problems;
}

/** The image is a file beside the config (`CONFIG_FILE_PRESENT`) whose bytes hash to `sha256` (`CONFIG_OCCLUDER_SHA256`). */
export function occluderFileProblems(declarations: readonly OccluderDeclaration[], base: string): Problem[] {
  const problems: Problem[] = [];
  declarations.forEach((d, i) => {
    const path = resolve(base, d.image);
    if (!existsSync(path) || !statSync(path).isFile()) {
      problems.push({ code: 'CONFIG_FILE_PRESENT', object: `${AT}[${i}].image`, detail: `names ${d.image}, which is no such file; an RGBA PNG of the occluder on the painting's grid, relative to the config's directory, is required` });
      return;
    }
    const found = fileSha256(path);
    if (SHA256_PATTERN.test(d.sha256) && found !== d.sha256) {
      problems.push({ code: 'CONFIG_OCCLUDER_SHA256', object: `${AT}[${i}].sha256`, detail: `is ${d.sha256}; ${d.image} has sha256 ${found} — declare the bytes the occluder image holds` });
    }
  });
  return problems;
}

export interface OccluderCopy {
  part: string;
  px: number;
  /** Rig px, x right and y down: the first copied pixel in row order. */
  first: [number, number];
}

/**
 * Copied occluder colour per `under` part, on the rig grid: `parts` are the
 * selected source layers placed on the rig canvas (`width`x`height`), `painting`
 * the painting on the same grid, `alpha(x, y)` the occluder's alpha at a rig
 * pixel. A part with no copied pixel is left out.
 */
export function occluderColourCopies(parts: ReadonlyArray<{ name: string; image: Raster }>, painting: Raster, alpha: (x: number, y: number) => number, rgbWithin: number): OccluderCopy[] {
  const out: OccluderCopy[] = [];
  const { width, height } = painting;
  for (const { name, image } of parts) {
    let px = 0, first = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (image.data[p * 4 + 3] <= COPIED_ALPHA_ABOVE || alpha(x, y) <= 0) continue;
      let delta = 0;
      for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(image.data[p * 4 + c] - painting.data[p * 4 + c]));
      if (delta > rgbWithin) continue;
      if (first < 0) first = p;
      px++;
    }
    if (px > 0) out.push({ part: name, px, first: [first % width, Math.floor(first / width)] });
  }
  return out;
}

export function occluderColourWarning(index: number, copy: OccluderCopy, rgbWithin: number): string {
  return `WARN  ${OCCLUDER_COLOUR_COPIED}: ${AT}[${index}] part "${copy.part}" — ${copy.px} rig px of its selected layer at alpha > ${COPIED_ALPHA_ABOVE} under the occluder (alpha > 0) lie within ${rgbWithin} of the painting (max channel); first at ${copy.first[0]},${copy.first[1]}; the layer holds the occluder's own colour — take this part from a See-through run on the painting with the occluder removed (comfy plate --mode occluder)`;
}
