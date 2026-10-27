/** Explicit alternate region placement; source pixels and crop provenance never change. */
import { toBoneLocalVector, toWorld, type BoneTransform } from './coords.ts';
import { refuseIfAny, type Problem } from './errors.ts';

export type BaseAnchor = Record<string, { axes: Array<'x' | 'y'>; paired?: string[] }>;
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Both config doors, serialized parts, and direct builders validate the same explicit rule. */
export function baseAnchorProblems(value: unknown, at: string, covered: ReadonlySet<string>, patches?: ReadonlySet<string>, regions?: ReadonlySet<string>, code = 'CONFIG_SET_BASE_ANCHOR'): Problem[] {
  const problems: Problem[] = [];
  const fail = (where: string, detail: string): void => { problems.push({ code, object: where, detail }); };
  if (!object(value) || Object.keys(value).length === 0) return [{ code, object: at, detail: 'requires a nonempty region-name map of {axes: ["x" and/or "y"], paired?: [patch names]}; omit base_anchor for art-measured placement' }];
  const paired = new Set<string>();
  for (const [name, rule] of Object.entries(value)) {
    const path = `${at}.${name}`;
    if (!covered.has(name) || (regions !== undefined && !regions.has(name))) fail(path, `names "${name}"; a covered, nonhidden region with a base attachment is required, never a mesh`);
    if (!object(rule)) { fail(path, 'requires {axes: ["x" and/or "y"], paired?: [patch names]}'); continue; }
    for (const key of Object.keys(rule)) if (key !== 'axes' && key !== 'paired') fail(`${path}.${key}`, 'is unknown; only axes and paired are accepted');
    if (!Array.isArray(rule.axes) || rule.axes.length === 0 || rule.axes.some(a => a !== 'x' && a !== 'y') || new Set(rule.axes).size !== rule.axes.length) fail(`${path}.axes`, `is ${JSON.stringify(rule.axes)}; one or both distinct local axes "x", "y" are required`);
    if (rule.paired !== undefined) {
      if (!Array.isArray(rule.paired) || rule.paired.length === 0) { fail(`${path}.paired`, 'requires a nonempty list of covered painting patches'); continue; }
      for (const patch of rule.paired) {
        if (typeof patch !== 'string' || !covered.has(patch) || (patches !== undefined && !patches.has(patch)) || (regions !== undefined && !regions.has(patch))) fail(`${path}.paired`, `names ${JSON.stringify(patch)}; a covered, nonhidden painting-patch region is required`);
        else if (patch === name || Object.hasOwn(value, patch) || paired.has(patch)) fail(`${path}.paired`, `names "${patch}" more than once or also as an anchor; one anchor owns each paired patch`);
        else paired.add(patch);
      }
    }
  }
  return problems;
}

export function orderedBaseAnchor(value: BaseAnchor): BaseAnchor {
  return Object.fromEntries(Object.keys(value).sort().map(name => [name, { axes: (['x', 'y'] as const).filter(a => value[name].axes.includes(a)), ...(value[name].paired === undefined ? {} : { paired: [...value[name].paired!].sort() }) }]));
}

export interface AnchorRegion { bone: string; x: number; y: number }
/** Local displacement for every owner and explicitly paired region; pairs share a world displacement. */
export function baseAnchorMoves(rules: BaseAnchor, base: ReadonlyMap<string, AnchorRegion>, source: ReadonlyMap<string, AnchorRegion>, world: ReadonlyMap<string, BoneTransform>): Map<string, { local: [number, number]; world: [number, number] }> {
  const problems: Problem[] = [];
  const out = new Map<string, { local: [number, number]; world: [number, number] }>();
  for (const name of Object.keys(rules).sort()) {
    const original = base.get(name), art = source.get(name), rule = rules[name];
    if (original === undefined || art === undefined || !world.has(art.bone) || original.bone !== art.bone) {
      problems.push({ code: 'RIG_ALT_BASE_ANCHOR', object: `base_anchor.${name}`, detail: `requires matching base and alternate region attachments on the same declared bone; base ${original?.bone ?? 'absent'}, alternate ${art?.bone ?? 'absent'}` }); continue;
    }
    const frame = world.get(art.bone)!;
    const dx = rule.axes.includes('x') ? original.x - art.x : 0, dy = rule.axes.includes('y') ? original.y - art.y : 0;
    const origin = toWorld(frame, 0, 0), target = toWorld(frame, dx, dy);
    const delta: [number, number] = [target[0] - origin[0], target[1] - origin[1]];
    out.set(name, { local: [dx, dy], world: delta });
    for (const pair of rule.paired ?? []) {
      const region = source.get(pair), pairFrame = region === undefined ? undefined : world.get(region.bone);
      if (pairFrame === undefined) problems.push({ code: 'RIG_ALT_BASE_ANCHOR', object: `base_anchor.${name}.paired`, detail: `paired patch "${pair}" has no alternate region or bone frame; re-run assemble with the patch covered` });
      else out.set(pair, { local: toBoneLocalVector(pairFrame, ...delta), world: delta });
    }
  }
  refuseIfAny(problems);
  return out;
}
