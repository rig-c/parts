/** Explicit motion observations; no automatic declaration in check. */
import type { BoneEntry, CharacterConfig, Segment } from './config.ts';
import type { Problem } from './errors.ts';
import { tagOf, type PartRecord } from './parts.ts';

export interface MotionSeamDeclaration {
  part: string;
  neighbour: string;
}

/** Both readers share shape, name, self-pair and unordered uniqueness rules. */
export function motionSeamProblems(value: unknown, names: ReadonlySet<string>, at: string, code: string): Problem[] {
  const problems: Problem[] = [];
  const bad = (object: string, detail: string): void => { problems.push({ code, object, detail }); };
  if (!Array.isArray(value)) {
    bad(at, 'requires an array of {part, neighbour} declarations');
    return problems;
  }
  const seen = new Set<string>();
  value.forEach((row: unknown, i) => {
    const object = `${at}[${i}]`;
    if (typeof row !== 'object' || row === null || Array.isArray(row)) { bad(object, 'requires {part, neighbour}'); return; }
    const r = row as Record<string, unknown>;
    for (const key of Object.keys(r)) if (key !== 'part' && key !== 'neighbour') bad(`${object}.${key}`, 'is unknown; only part and neighbour are read');
    for (const key of ['part', 'neighbour']) {
      if (typeof r[key] !== 'string' || r[key] === '') bad(`${object}.${key}`, 'requires a nonempty output part name');
      else if (!names.has(r[key])) bad(`${object}.${key}`, `names "${r[key]}", which is no output part; known: ${[...names].join(', ')}`);
    }
    if (typeof r.part !== 'string' || typeof r.neighbour !== 'string') return;
    if (r.part === r.neighbour) bad(object, `names "${r.part}" on both sides; two different parts are required`);
    const key = JSON.stringify([r.part, r.neighbour].sort());
    if (seen.has(key)) bad(object, 'duplicates an earlier pair, including reversed order; declare each unordered pair once');
    seen.add(key);
  });
  return problems;
}

/** Expand only declared links; a miss has no inferred parent. */
export function motionSeamParents(bones: readonly BoneEntry[]): Map<string, string> {
  const parents = new Map<string, string>();
  for (const bone of bones) {
    if ('name' in bone) parents.set(bone.name, bone.parent);
    else bone.points.forEach((_, i) => parents.set(`${bone.chain}${i}`, i === 0 ? bone.parent : `${bone.chain}${i - 1}`));
  }
  return parents;
}

/**
 * Source-bound declaration generator, also callable on a frozen handed config.
 * A non-limb topwear mesh has exactly two single-bone carriers, a named parent
 * and child. Handwear is bound strictly below that child, with no second trunk
 * carrier of its own. This proves the declared binding structure, not positive
 * compiled vertex weights or alpha overlap (the stock seam reader observes that).
 * No motion keys, thresholds, part spelling or nearest geometry select a pair.
 */
export function draftMotionSeams(config: Pick<CharacterConfig, 'bones' | 'meshes' | 'regions' | 'limbs'>, parts: readonly Pick<PartRecord, 'name' | 'from' | 'limb'>[]): MotionSeamDeclaration[] {
  const parents = motionSeamParents(config.bones);
  const singles = new Set(config.bones.flatMap(b => 'name' in b ? [b.name] : []));
  const chains = new Map(config.bones.flatMap(b => 'chain' in b ? [[b.chain, b.points.map((_, i) => `${b.chain}${i}`)] as const] : []));
  const bound = (part: string): string[] => {
    const mesh = config.meshes[part];
    if (mesh !== undefined && 'segments' in mesh) return [...new Set(mesh.segments.flatMap((s: Segment) => typeof s === 'string' ? chains.get(s) ?? [s] : [s[0]]))];
    const region = config.regions[part];
    return region === undefined ? [] : [typeof region === 'string' ? region : region.bone];
  };
  const consumed = new Set(Object.values(config.limbs ?? {}).flatMap(l => l.segments.map(s => s.from)));
  const out: MotionSeamDeclaration[] = [];
  for (const body of parts) {
    if (body.limb !== undefined || consumed.has(body.name) || tagOf(body.from) !== 'topwear' || config.meshes[body.name] === undefined) continue;
    const trunk = bound(body.name);
    if (trunk.length !== 2 || !trunk.every(b => singles.has(b))) continue;
    const child = trunk.find(b => parents.get(b) === trunk.find(other => other !== b));
    if (child === undefined) continue;
    for (const sleeve of parts) {
      if (sleeve.limb !== undefined || consumed.has(sleeve.name) || !['handwear-r', 'handwear-l'].includes(tagOf(sleeve.from) ?? '')) continue;
      const carriers = bound(sleeve.name);
      const underChild = (bone: string): boolean => {
        const seen = new Set<string>();
        for (let b: string | undefined = parents.get(bone); b !== undefined && !seen.has(b); b = parents.get(b)) {
          if (b === child) return true;
          seen.add(b);
        }
        return false;
      };
      if (carriers.length > 0 && carriers.every(b => parents.has(b) && !trunk.includes(b) && underChild(b))) out.push({ part: body.name, neighbour: sleeve.name });
    }
  }
  return out;
}
