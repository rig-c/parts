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
  /** Plan parts that draw this occluder, in front of `under` (#1241). */
  over?: string[];
  /** Max absolute channel difference from the painting at which an `under` pixel reads as the occluder's colour. */
  rgb_within: number;
}

export const OCCLUDER_COLOUR_COPIED = 'ASSEMBLE_OCCLUDER_COLOUR_COPIED';
export const OCCLUDER_DRAW_ORDER = 'ASSEMBLE_OCCLUDER_DRAW_ORDER';
export const OCCLUDER_DRAW_CYCLE = 'ASSEMBLE_OCCLUDER_DRAW_CYCLE';
export const OCCLUDER_OVER_TAKEN = 'ASSEMBLE_OCCLUDER_OVER_TAKEN';
/** An `under` layer pixel counts at alpha above this: the half-opaque floor `deriveTakenRegion` reads. */
export const COPIED_ALPHA_ABOVE = 128;

const AT = 'config.assemble.occluders';

/** Contradictory `over` / `under` draw order across occluder entries (`ASSEMBLE_OCCLUDER_DRAW_CYCLE`). */
export function occluderDrawCycleProblems(declarations: readonly OccluderDeclaration[]): Problem[] {
  const problems: Problem[] = [];
  const edges = new Map<string, Map<string, number>>();
  const vertices: string[] = [];
  const addVertex = (name: string): void => {
    if (!vertices.includes(name)) vertices.push(name);
  };
  declarations.forEach((d, i) => {
    if (d.over === undefined) return;
    for (const u of d.over) {
      for (const v of d.under) {
        if (u === v) {
          problems.push({
            code: OCCLUDER_DRAW_CYCLE,
            object: `${AT}[${i}]`,
            detail: `cycle ${u} -> ${u}: "${u}" is in both over and under of occluders[${i}]; a part cannot draw in front of itself`,
          });
          continue;
        }
        addVertex(u);
        addVertex(v);
        let row = edges.get(u);
        if (row === undefined) {
          row = new Map<string, number>();
          edges.set(u, row);
        }
        if (!row.has(v)) row.set(v, i);
      }
    }
  });
  vertices.forEach((start, startIndex) => {
    const startEdges = edges.get(start);
    if (startEdges === undefined) return;
    const visited = new Set<string>();
    const queue: Array<{ node: string; path: string[]; steps: Array<[string, string, number]> }> = [];
    for (const [next, ei] of startEdges) {
      if (vertices.indexOf(next) > startIndex) {
        visited.add(next);
        queue.push({ node: next, path: [start, next], steps: [[start, next, ei]] });
      }
    }
    while (queue.length > 0) {
      const current = queue.shift()!;
      const nextEdges = edges.get(current.node);
      if (nextEdges === undefined) continue;
      const back = nextEdges.get(start);
      if (back !== undefined) {
        const cycle = [...current.path, start];
        const steps = [...current.steps, [current.node, start, back] as [string, string, number]];
        problems.push({
          code: OCCLUDER_DRAW_CYCLE,
          object: AT,
          detail: `cycle ${cycle.join(' -> ')} (${steps.map(([from, to, idx]) => `"${from}" over "${to}" in occluders[${idx}]`).join(', ')}); declared over/under draw order must be acyclic`,
        });
        break;
      }
      for (const [next, ei] of nextEdges) {
        if (vertices.indexOf(next) > startIndex && !visited.has(next)) {
          visited.add(next);
          queue.push({ node: next, path: [...current.path, next], steps: [...current.steps, [current.node, next, ei]] });
        }
      }
    }
  });
  return problems;
}

export interface DeclaredOccluderPair {
  index: number;
  over: string;
  under: string;
}

/** First occluder entry declaring `(a, b)` or `(b, a)` as an `(over, under)` pair, or null when undeclared. */
export function declaredOccluderPair(declarations: readonly OccluderDeclaration[], a: string, b: string): DeclaredOccluderPair | null {
  for (let i = 0; i < declarations.length; i++) {
    const d = declarations[i];
    if (d.over === undefined) continue;
    if (d.over.includes(a) && d.under.includes(b)) return { index: i, over: a, under: b };
    if (d.over.includes(b) && d.under.includes(a)) return { index: i, over: b, under: a };
  }
  return null;
}

/** Every `over` part's plan layer (`run:tag`) must be taken by a whole-layer `assemble.take` declaration (`ASSEMBLE_OCCLUDER_OVER_TAKEN`). */
export function occluderOverTakenProblems(
  declarations: readonly OccluderDeclaration[],
  plan: ReadonlyArray<readonly [string, string, string]>,
  taken: ReadonlyArray<{ run: string; tags: readonly string[] }>,
): Problem[] {
  const problems: Problem[] = [];
  declarations.forEach((d, i) => {
    d.over?.forEach((name, j) => {
      const row = plan.find(([part]) => part === name);
      if (row === undefined) return;
      const [, run, tag] = row;
      if (!taken.some((t) => t.run === run && t.tags.includes(tag))) {
        problems.push({
          code: OCCLUDER_OVER_TAKEN,
          object: `${AT}[${i}].over[${j}]`,
          detail: `part "${name}" (${run}:${tag}) is not taken by config.assemble.take; declare a whole-layer take for ${run}:${tag} or omit "${name}" from over`,
        });
      }
    });
  });
  return problems;
}

/** Every `under` and `over` entry names a plan part (`CONFIG_NAME_RESOLVES`, with `over` entries distinct per occluder, `CONFIG_PART_UNIQUE`); `names` null skips the plan-membership check (a door without the plan). */
export function occluderNameProblems(declarations: readonly OccluderDeclaration[], names: readonly string[] | null): Problem[] {
  const problems: Problem[] = [];
  declarations.forEach((d, i) => {
    if (d.over !== undefined) {
      const seen = new Set<string>();
      d.over.forEach((name, j) => {
        if (seen.has(name)) problems.push({ code: 'CONFIG_PART_UNIQUE', object: `${AT}[${i}].over[${j}]`, detail: `names "${name}" again; each part is named once` });
        seen.add(name);
      });
    }
    if (names === null) return;
    d.under.forEach((name, j) => {
      if (!names.includes(name)) problems.push({ code: 'CONFIG_NAME_RESOLVES', object: `${AT}[${i}].under[${j}]`, detail: `names "${name}"; a part in config.assemble.plan is required` });
    });
    d.over?.forEach((name, j) => {
      if (!names.includes(name)) problems.push({ code: 'CONFIG_NAME_RESOLVES', object: `${AT}[${i}].over[${j}]`, detail: `names "${name}"; a part in config.assemble.plan is required` });
    });
  });
  problems.push(...occluderDrawCycleProblems(declarations));
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
