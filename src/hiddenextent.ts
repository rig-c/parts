import type { Problem } from './errors.ts';
import { CORE_ALPHA, OPAQUE_ALPHA_ABOVE } from './layers.ts';
import { fillHoles } from './raster/morph.ts';
import { newMask, type Raster } from './raster/types.ts';

/** A source part whose enclosed missing material must not sit under this moving cover. */
export interface HiddenExtentDeclaration {
  part: string;
  occluder: string;
}

/** Original selected material, in source-family draw order, before cleanup or preparation. */
export interface HiddenExtentSource {
  name: string;
  from: string;
  image: Raster | null;
  x?: number;
  y?: number;
}

export function hiddenExtentNameProblems(declarations: readonly HiddenExtentDeclaration[], names: readonly string[] | null): Problem[] {
  const problems: Problem[] = [];
  const seen = new Set<string>();
  declarations.forEach(({ part, occluder }, i) => {
    const object = `config.assemble.require_hidden_extent[${i}]`;
    const pair = JSON.stringify([part, occluder]);
    if (seen.has(pair)) problems.push({ code: 'CONFIG_PART_UNIQUE', object, detail: `repeats "${part}" under "${occluder}"; each directed source pair is declared once` });
    seen.add(pair);
    if (names !== null) for (const [key, name] of [['part', part], ['occluder', occluder]]) {
      if (!names.includes(name)) problems.push({ code: 'CONFIG_NAME_RESOLVES', object: `${object}.${key}`, detail: `names "${name}"; a source part in assemble.plan is required, before cuts or limb splitting` });
    }
    if (part === occluder || (names !== null && names.includes(part) && names.includes(occluder) && names.indexOf(occluder) < names.indexOf(part))) {
      problems.push({ code: 'CONFIG_HIDDEN_EXTENT_ORDER', object, detail: `names "${part}" under "${occluder}"; a distinct occluder drawn after the source part is required` });
    }
  });
  return problems;
}

/** Enclosed source holes only. Exterior-connected missing material is outside this contract. */
export function hiddenExtentProblems(declarations: readonly HiddenExtentDeclaration[], sources: readonly HiddenExtentSource[], width: number, height: number): Problem[] {
  const names = sources.map(source => source.name);
  const sourceNames = sources.filter(source => !source.from.startsWith('painting:')).map(source => source.name);
  const problems = hiddenExtentNameProblems(declarations, sourceNames);
  const alpha = (source: HiddenExtentSource, x: number, y: number): number => {
    const image = source.image;
    const sx = x - (source.x ?? 0), sy = y - (source.y ?? 0);
    return image === null || sx < 0 || sy < 0 || sx >= image.width || sy >= image.height ? 0 : image.data[(sy * image.width + sx) * 4 + 3];
  };
  for (const { part, occluder } of declarations) {
    const at = names.indexOf(part), coverAt = names.indexOf(occluder);
    if (at < 0 || coverAt <= at || !sourceNames.includes(part) || !sourceNames.includes(occluder)) continue;
    const own = sources[at];
    const object = `part "${part}" (${own.from}) under "${occluder}"`;
    const unavailable = sources.slice(at).find(source => source.image === null);
    if (unavailable !== undefined) {
      problems.push({ code: 'ASSEMBLE_HIDDEN_EXTENT_UNMEASURED', object, detail: `original selected material for "${unavailable.name}" (${unavailable.from}) is unavailable; source ancestry is required before cleanup or any writer` });
      continue;
    }
    const support = newMask(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) support.data[y * width + x] = alpha(own, x, y) > OPAQUE_ALPHA_ABOVE ? 1 : 0;
    const filled = fillHoles(support);
    let overlap = 0, soft = 0, opaque = 0, first = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (filled.data[p] === 0) continue;
      let front = -1, frontAlpha = 0;
      for (let j = sources.length - 1; j > at; j--) {
        const a = alpha(sources[j], x, y);
        if (a <= OPAQUE_ALPHA_ABOVE) continue;
        front = j;
        frontAlpha = a;
        break;
      }
      if (front !== coverAt) continue;
      overlap++;
      if (support.data[p] === 1) continue;
      if (first < 0) first = p;
      if (frontAlpha < CORE_ALPHA) soft++;
      else opaque++;
    }
    if (soft + opaque > 0) {
      problems.push({ code: 'ASSEMBLE_HIDDEN_EXTENT_ABSENT', object, detail: `${soft + opaque} enclosed-hole rig cells of ${overlap} covered cells have own alpha <= ${OPAQUE_ALPHA_ABOVE}, > ${OPAQUE_ALPHA_ABOVE} required (soft cover ${soft}, opaque cover ${opaque}); first at ${first % width},${Math.floor(first / width)}; a source carrying this extent is required` });
    } else if (overlap === 0) {
      problems.push({ code: 'ASSEMBLE_HIDDEN_EXTENT_UNMEASURED', object, detail: `has no filled own-support overlap beneath the resolved occluder at alpha > ${OPAQUE_ALPHA_ABOVE}; a measurable source overlap is required` });
    }
  }
  return problems;
}
