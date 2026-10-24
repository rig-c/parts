/** Per-covered-part alternate sources; all coordinates and pixels stay in their original run. */
import type { Cut, Limb, PlanEntry } from './config.ts';
import type { OtherLimbs } from './assemble.ts';
import { refuseIfAny, type Problem } from './errors.ts';
import { readLayerTag } from './tags.ts';

export interface AlternateLayerSources {
  plan: PlanEntry[];
  cuts: Cut[];
  limbs: Record<string, Limb>;
  /** Effective source name -> original logical source, only for sources split across layers. */
  groups: ReadonlyMap<string, string>;
}

/** Resolve output names before the stage checks required layers. Never mutate the base plan or limb declarations. */
export function alternateLayerSources(
  plan: PlanEntry[], cuts: Cut[], limbs: Record<string, Limb>, covered: ReadonlySet<string>, layers?: Readonly<Record<string, string>>,
): AlternateLayerSources {
  if (layers === undefined || Object.keys(layers).length === 0) return { plan, cuts, limbs, groups: new Map() };
  const problems: Problem[] = [];
  const planByName = new Map(plan.map(p => [p[0], p]));
  const cutByName = new Map(cuts.map(c => [c.into, c]));
  const segments = Object.values(limbs).flatMap(l => l.segments);
  const sourceOf = (part: string): string => segments.find(s => s.part === part)?.from ?? part;
  const rowOf = (source: string): PlanEntry | undefined => planByName.get(cutByName.get(source)?.from ?? source);
  for (const [part, layer] of Object.entries(layers)) {
    const at = `alternate layers.${part}`;
    if (!covered.has(part)) problems.push({ code: 'CONFIG_SET_LAYERS', object: at, detail: `names "${part}", which the set does not cover; name a covered, nonhidden part` });
    if (rowOf(sourceOf(part)) === undefined) problems.push({ code: 'ASSEMBLE_ALT_LAYER_SOURCE', object: at, detail: `"${part}" has no planned layer source; a painting patch cannot take a run layer — declare a layer-backed plan part instead` });
    if (typeof layer !== 'string' || readLayerTag(layer) === null) problems.push({ code: 'CONFIG_TAG_KNOWN', object: at, detail: `is ${JSON.stringify(layer)}; a See-through tag or author:<label> layer name is required` });
  }
  refuseIfAny(problems);
  const occupied = new Set([...planByName.keys(), ...cutByName.keys(), ...segments.map(s => s.part)]);
  const variants = new Map<string, Map<string, string>>();
  const madePlans = new Map<string, PlanEntry[]>();
  const madeCuts = new Map<string, Cut[]>();
  const originalTag = (source: string): string => (rowOf(source) as PlanEntry)[2];
  const chosen = (part: string, source: string): string => Object.hasOwn(layers, part) ? layers[part] : originalTag(source);
  const variant = (source: string, layer: string): string => {
    let choices = variants.get(source);
    if (choices === undefined) { choices = new Map(); variants.set(source, choices); }
    const existing = choices.get(layer);
    if (existing !== undefined) return existing;
    let name = source;
    if (choices.size > 0) {
      let n = 1;
      do { name = `${source}_layer_${n++}`; } while (occupied.has(name));
      occupied.add(name);
    }
    choices.set(layer, name);
    const cut = cutByName.get(source);
    if (cut !== undefined) {
      const next = { ...cut, into: name, from: variant(cut.from, layer) };
      madeCuts.set(source, [...(madeCuts.get(source) ?? []), next]);
    } else {
      const row = planByName.get(source) as PlanEntry;
      madePlans.set(source, [...(madePlans.get(source) ?? []), [name, row[1], layer]]);
    }
    return name;
  };
  // Direct output names keep their identity; limb-only sources follow declaration order.
  for (const [name] of plan) if (covered.has(name)) variant(name, chosen(name, name));
  for (const cut of cuts) if (covered.has(cut.into)) variant(cut.into, chosen(cut.into, cut.into));
  const selected = Object.fromEntries(Object.entries(limbs).map(([name, limb]) => [name, {
    ...limb, segments: limb.segments.map(s => ({ ...s, from: variant(s.from, chosen(s.part, s.from)) })),
  }]));
  // Uncovered cuts can still remove art from a covered source. Keep their declared route.
  for (const c of cuts) if (!variants.has(c.into)) variant(c.into, originalTag(c.into));
  const consumed = new Set(segments.map(s => s.from));
  for (const [name] of plan) if (!variants.has(name) && !consumed.has(name)) variant(name, originalTag(name));
  const groups = new Map<string, string>();
  for (const [source, choices] of variants) if (choices.size > 1) for (const name of choices.values()) groups.set(name, source);
  return {
    plan: plan.flatMap(([name]) => madePlans.get(name) ?? []),
    cuts: cuts.flatMap(c => madeCuts.get(c.into) ?? []),
    limbs: selected,
    groups,
  };
}

/** Shared-source island rules follow every selected layer of that logical source. */
export function alternateLayerIslands(sources: readonly string[], groups: ReadonlyMap<string, string>): string[] {
  return sources.flatMap(source => {
    const choices = [...groups].filter(([, original]) => original === source).map(([name]) => name);
    return choices.length === 0 ? [source] : choices;
  });
}

/** Preserve the other limb's pose/evidence while giving each selected source its own ownership reading. */
export function alternateLayerOthers(other: OtherLimbs, groups: ReadonlyMap<string, string>): OtherLimbs {
  if (groups.size === 0) return other;
  const limbs: Record<string, Limb> = {}, unposed: Record<string, readonly string[]> = {}, baseArt: Record<string, OtherLimbs['baseArt'][string]> = {};
  const occupied = new Set(Object.keys(other.limbs));
  for (const [name, limb] of Object.entries(other.limbs)) {
    let copies = [limb];
    for (const source of new Set(limb.segments.map(s => s.from))) {
      const choices = [...groups].filter(([, original]) => original === source).map(([effective]) => effective);
      if (choices.length > 0) copies = copies.flatMap(copy => choices.map(choice => ({ ...copy, segments: copy.segments.map(s => s.from === source ? { ...s, from: choice } : s) })));
    }
    copies.forEach((copy, i) => {
      let key = name;
      if (i > 0) { let n = i; do { key = `${name}_layer_${n++}`; } while (occupied.has(key)); occupied.add(key); }
      limbs[key] = copy;
      unposed[key] = other.unposed[name];
      baseArt[key] = other.baseArt[name];
    });
  }
  return { ...other, limbs, unposed, baseArt };
}
