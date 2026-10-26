/** Explicit setup adjacency (#647). Ownership proves eligibility, never intent. */
import type { Limb, LimbLayoutTarget } from './config.ts';
import { createHash } from 'node:crypto';
import { type Problem, refuseIfAny } from './errors.ts';
import type { LimbSlotLayout } from './limbslots.ts';
import type { RigSpec } from './rig.ts';

export const LAYOUT_FILE = 'layout.json';
export const LAYOUT_SPEC = 'rig-parts-layout/1';
interface SegmentSource { limb: string; part: string }
export interface LayoutPlacement {
  limb: string;
  parts: string[];
  before?: LimbLayoutTarget;
  after?: LimbLayoutTarget;
  slots: string[];
  target_slots: string[];
}
/** Internal proof is not a RigSpec field and is never serialized as one. */
export interface LayoutPlan {
  placements: LayoutPlacement[];
  sources: Map<string, SegmentSource[]>;
  limbs: Readonly<Record<string, Limb>>;
  families: ReadonlyMap<string, readonly string[]>;
  originalOrder: string[];
  /** Authored rider families excluded from implicit closure, including replay. */
  ungathered?: readonly string[];
}
export interface LayoutCompanion {
  spec: typeof LAYOUT_SPEC;
  rig: { file: 'rig.json'; sha256: string };
  sets?: { file: 'sets.json'; sha256: string };
  setup_slots: string[];
  placements: LayoutPlacement[];
}

/** Keep the concrete declared boundary that 646's parent walk encounters. */
function segmentSources(limbs: Readonly<Record<string, Limb>>, bones: RigSpec['bones']): Map<string, SegmentSource[]> {
  const seeds = new Map<string, SegmentSource[]>();
  for (const [limb, l] of Object.entries(limbs)) for (const s of l.segments) seeds.set(s.bone, [...(seeds.get(s.bone) ?? []), { limb, part: s.part }]);
  const parents = new Map(bones.map((b) => [b.name, b.parent]));
  const result = new Map<string, SegmentSource[]>();
  for (const b of bones) {
    let at: string | undefined = b.name;
    const seen = new Set<string>();
    while (at !== undefined && !seen.has(at) && !seeds.has(at)) { seen.add(at); at = parents.get(at); }
    result.set(b.name, at === undefined ? [] : seeds.get(at) ?? []);
  }
  return result;
}

function bindings(slot: RigSpec['slots'][number], skin: RigSpec['skins']['default']): string[][] {
  return Object.values(skin[slot.name] ?? {}).map((a) => 'type' in a && 'weights' in a && a.weights !== undefined ? a.weights.flatMap((v) => v.map((w) => w.bone)) : [slot.bone]);
}
function bindingDetail(slots: RigSpec['slots'], skin: RigSpec['skins']['default'], sources: LayoutPlan['sources']): string {
  return JSON.stringify(slots.map((s) => ({ slot: s.name, attachments: Object.entries(skin[s.name] ?? {}).map(([attachment, a]) => ({ attachment, bones: ('type' in a && 'weights' in a && a.weights !== undefined ? a.weights.flatMap((v) => v.map((w) => w.bone)) : [s.bone]).map((bone) => ({ bone, sources: sources.get(bone) ?? [] })) })) })));
}
function owned(slot: RigSpec['slots'][number], skin: RigSpec['skins']['default'], sources: LayoutPlan['sources'], limb: string, parts: readonly string[], moving?: ReadonlyMap<string, readonly string[]>): boolean {
  const bs = bindings(slot, skin);
  return bs.length > 0 && bs.every((b) => b.length > 0 && b.every((n) => {
    const s = sources.get(n) ?? [];
    if (s.length === 1) return s[0].limb === limb && parts.includes(s[0].part);
    return moving !== undefined && s.some((x) => x.limb === limb && parts.includes(x.part)) && s.every((x) => moving.get(x.limb)?.includes(x.part) === true);
  }));
}
/** A crossing target may be outside every limb, but may not mix owners. */
function targetSafe(slots: RigSpec['slots'], skin: RigSpec['skins']['default'], sources: LayoutPlan['sources']): boolean {
  const owners = new Set<string>();
  let good = slots.length > 0;
  for (const slot of slots) {
    const bs = bindings(slot, skin);
    if (bs.length === 0) good = false;
    for (const b of bs) {
      if (b.length === 0) good = false;
      for (const n of b) {
        const s = sources.get(n) ?? [];
        if (s.length > 1) good = false;
        owners.add(s.length === 0 ? 'outside' : `limb:${s[0].limb}`);
      }
    }
  }
  return good && owners.size === 1;
}

/** Called only for opt-in declarations, over 646's unchanged permutation. */
export function placeLimbLayouts(limbs: Readonly<Record<string, Limb>> | undefined, bones: RigSpec['bones'], base: LimbSlotLayout, skin: RigSpec['skins']['default'], families: ReadonlyMap<string, readonly string[]>, inheritedSources?: LayoutPlan['sources']): { slots: RigSpec['slots']; plan?: LayoutPlan } {
  if (limbs === undefined || !Object.values(limbs).some((l) => l.layout !== undefined)) return { slots: base.slots };
  const sources = inheritedSources ?? segmentSources(limbs, bones), problems: Problem[] = [], placements: LayoutPlacement[] = [];
  const names = base.slots.map((s) => s.name);
  const movingByLimb = new Map<string, string[]>();
  for (const [limb, l] of Object.entries(limbs)) {
    if (l.layout !== undefined) movingByLimb.set(limb, l.segments.map((s) => s.part).filter((p) => l.layout?.parts === undefined || l.layout.parts.includes(p)));
  }
  for (const [limb, l] of Object.entries(limbs)) {
    const d = l.layout;
    if (d === undefined) continue;
    const at = `config.limbs.${limb}.layout`, parts = movingByLimb.get(limb) ?? [];
    const subject = base.slots.filter((s) => !base.ungathered?.includes(s.name) && owned(s, skin, sources, limb, parts, movingByLimb));
    const authored = d.before ?? d.after as LimbLayoutTarget;
    const target: LimbLayoutTarget = authored.limb === undefined ? { part: authored.part } : { limb: authored.limb };
    let targets: RigSpec['slots'];
    if (target.limb !== undefined) {
      const other = limbs[target.limb];
      const all = other?.segments.map((s) => s.part) ?? [];
      targets = base.slots.filter((s) => !base.ungathered?.includes(s.name) && owned(s, skin, sources, target.limb as string, all));
      for (const p of all) {
        if ((families.get(p) ?? []).length === 0) problems.push({ code: 'RIG_LAYOUT_UNREPRESENTABLE', object: at, detail: `target limb "${target.limb}" segment part "${p}" has no emitted family` });
        for (const n of families.get(p) ?? []) if (!targets.some((s) => s.name === n)) problems.push({ code: 'RIG_LAYOUT_NONEXCLUSIVE', object: `${at} target limb "${target.limb}" slot "${n}"`, detail: `requires exclusive target ownership across every attachment; found ${bindingDetail(base.slots.filter((s) => s.name === n), skin, sources)}` });
      }
    } else targets = base.slots.filter((s) => (families.get(target.part) ?? []).includes(s.name));
    for (const p of parts) {
      const family = families.get(p) ?? [];
      if (family.length === 0) problems.push({ code: 'RIG_LAYOUT_UNREPRESENTABLE', object: at, detail: `selected segment part "${p}" has no emitted slot family` });
      for (const n of family) if (!subject.some((s) => s.name === n)) problems.push({ code: 'RIG_LAYOUT_NONEXCLUSIVE', object: `${at} part "${p}" slot "${n}"`, detail: `requires exclusive selected-scope bindings across every attachment; found ${bindingDetail(base.slots.filter((s) => s.name === n), skin, sources)}` });
    }
    if (targets.length === 0) problems.push({ code: 'RIG_LAYOUT_UNREPRESENTABLE', object: at, detail: `target ${JSON.stringify(target)} has no emitted exclusive slot group` });
    else if (!targetSafe(targets, skin, sources)) problems.push({ code: 'RIG_LAYOUT_NONEXCLUSIVE', object: `${at} target ${JSON.stringify(target)}`, detail: `requires one binding owner across base/alternate attachments; found ${bindingDetail(targets, skin, sources)}` });
    const idx = targets.map((s) => names.indexOf(s.name));
    if (idx.some((v, i) => i > 0 && v !== idx[i - 1] + 1)) problems.push({ code: 'RIG_LAYOUT_UNREPRESENTABLE', object: at, detail: `target slots ${targets.map((s) => s.name).join(', ')} do not form one contiguous block; no unrelated slot is absorbed` });
    placements.push({ limb, parts, ...(d.before === undefined ? { after: target } : { before: target }), slots: subject.map((s) => s.name), target_slots: targets.map((s) => s.name) });
  }
  const movedBy = new Map<string, string>();
  const targetedBy = new Map<string, { at: string; targetKey: string; targetSlots: readonly string[] }>();
  for (const p of placements) {
    const at = `config.limbs.${p.limb}.layout`, targetKey = p.target_slots.join('\u0000');
    const localTargets = new Set(p.target_slots);
    for (const n of p.slots) {
      const otherMover = movedBy.get(n), otherTarget = targetedBy.get(n);
      if (localTargets.has(n)) {
        problems.push({ code: 'RIG_LAYOUT_CONFLICT', object: at, detail: `slot "${n}" is both a moving slot and a target in ${at}; self, reciprocal, chained and mover-as-target declarations are refused — only a stationary target may be shared` });
      } else if (otherMover !== undefined) {
        problems.push({ code: 'RIG_LAYOUT_CONFLICT', object: at, detail: `slot "${n}" is a moving slot in both ${otherMover} and ${at}; a slot may move in only one placement — only a stationary target may be shared` });
      } else if (otherTarget !== undefined) {
        problems.push({ code: 'RIG_LAYOUT_CONFLICT', object: at, detail: `slot "${n}" is a moving slot in ${at} and a target in ${otherTarget.at}; self, reciprocal, chained and mover-as-target declarations are refused — only a stationary target may be shared` });
      } else {
        movedBy.set(n, at);
      }
    }
    for (const n of p.target_slots) {
      if (localTargets.has(n) && p.slots.includes(n)) continue;
      const otherMover = movedBy.get(n), otherTarget = targetedBy.get(n);
      if (otherMover !== undefined) {
        problems.push({ code: 'RIG_LAYOUT_CONFLICT', object: at, detail: `slot "${n}" is a target in ${at} and a moving slot in ${otherMover}; self, reciprocal, chained and mover-as-target declarations are refused — only a stationary target may be shared` });
      } else if (otherTarget !== undefined && otherTarget.targetKey !== targetKey) {
        problems.push({ code: 'RIG_LAYOUT_CONFLICT', object: at, detail: `target slot "${n}" in ${at} ([${p.target_slots.join(', ')}]) partially overlaps ${otherTarget.at} ([${otherTarget.targetSlots.join(', ')}]); shared targets must resolve to the same target slot block` });
      } else if (otherTarget === undefined) {
        targetedBy.set(n, { at, targetKey, targetSlots: p.target_slots });
      }
    }
  }
  refuseIfAny(problems);
  placements.sort((a, b) => names.indexOf(a.target_slots[0]) - names.indexOf(b.target_slots[0]) || names.indexOf(a.slots[0]) - names.indexOf(b.slots[0]));
  const moving = new Set(placements.flatMap((p) => p.slots));
  const result: RigSpec['slots'] = [];
  for (const s of base.slots) {
    if (moving.has(s.name)) continue;
    for (const p of placements) if (p.before !== undefined && p.target_slots[0] === s.name) result.push(...base.slots.filter((x) => p.slots.includes(x.name)));
    result.push(s);
    for (const p of placements) if (p.after !== undefined && p.target_slots[p.target_slots.length - 1] === s.name) result.push(...base.slots.filter((x) => p.slots.includes(x.name)));
  }
  const plan = { placements, sources, limbs, families, originalOrder: names, ...(base.ungathered === undefined ? {} : { ungathered: base.ungathered }) };
  validateLimbLayout(plan, { slots: result, skins: { default: skin } });
  return { slots: result, plan };
}

/** A replay may change weights. Resolve closure again before that candidate is gated. */
export function refreshLimbLayout(plan: LayoutPlan, rig: RigSpec): LayoutPlan {
  const byName = new Map(rig.slots.map((s) => [s.name, s]));
  const slots = plan.originalOrder.flatMap((n) => { const s = byName.get(n); return s === undefined ? [] : [s]; });
  if (slots.length !== rig.slots.length || new Set(rig.slots.map((s) => s.name)).size !== slots.length) refuseIfAny([{ code: 'RIG_LAYOUT_UNREPRESENTABLE', object: 'rig.slots', detail: 'accepted candidate changed the source slot population; an exact permutation is required' }]);
  const next = placeLimbLayouts(plan.limbs, rig.bones, { slots, owners: [], anchors: [], ...(plan.ungathered === undefined ? {} : { ungathered: plan.ungathered }) }, rig.skins.default, plan.families, plan.sources);
  rig.slots = next.slots;
  return next.plan as LayoutPlan;
}

/** Explicit generated alias, supplied where stops/turn actually create it. */
export function layoutAlias(plan: LayoutPlan | undefined, original: string, emitted: string): void {
  if (plan !== undefined) plan.sources.set(emitted, plan.sources.get(original) ?? []);
}

/** Recheck accepted attachments after rebinds or mesh replay, before any emit. */
export function validateLimbLayout(plan: LayoutPlan, rig: Pick<RigSpec, 'slots' | 'skins'>): void {
  const names = rig.slots.map((s) => s.name), problems: Problem[] = [];
  for (const p of plan.placements) {
    const at = `config.limbs.${p.limb}.layout`, target = p.before ?? p.after as LimbLayoutTarget;
    const read = (ns: readonly string[]) => rig.slots.filter((s) => ns.includes(s.name));
    const ss = read(p.slots), ts = read(p.target_slots);
    const targetKey = p.target_slots.join('\u0000');
    const coMovers = plan.placements
      .filter((q) => (q.before !== undefined) === (p.before !== undefined) && q.target_slots.join('\u0000') === targetKey)
      .sort((a, b) => plan.originalOrder.indexOf(a.slots[0]) - plan.originalOrder.indexOf(b.slots[0]));
    const groupSlots = coMovers.flatMap((q) => q.slots);
    const contiguous = (ns: string[]) => ns.length > 0 && ns.every((n, i) => i === 0 || names.indexOf(n) === names.indexOf(ns[i - 1]) + 1);
    if (
      ss.length !== p.slots.length ||
      ts.length !== p.target_slots.length ||
      !contiguous(p.slots) ||
      !contiguous(p.target_slots) ||
      !contiguous(groupSlots) ||
      (p.before !== undefined
        ? names.indexOf(groupSlots[groupSlots.length - 1]) + 1 !== names.indexOf(p.target_slots[0])
        : names.indexOf(p.target_slots[p.target_slots.length - 1]) + 1 !== names.indexOf(groupSlots[0]))
    ) {
      problems.push({ code: 'RIG_LAYOUT_UNREPRESENTABLE', object: at, detail: `accepted setup slots do not preserve the exact declared adjacency: ${JSON.stringify(p)}` });
    }
    if (ss.some((s) => !owned(s, rig.skins.default, plan.sources, p.limb, p.parts)) || !targetSafe(ts, rig.skins.default, plan.sources) || (target.limb !== undefined && ts.some((s) => !owned(s, rig.skins.default, plan.sources, target.limb as string, plan.limbs[target.limb as string].segments.map((s) => s.part))))) {
      problems.push({ code: 'RIG_LAYOUT_NONEXCLUSIVE', object: at, detail: `accepted/replayed bindings must remain exclusive to their declared group; found ${bindingDetail([...ss, ...ts], rig.skins.default, plan.sources)}; no stale ownership proof is emitted` });
    }
  }
  refuseIfAny(problems);
}

/** Hash exact accepted texts, never the pre-replay candidate or a core extension. */
export function layoutCompanion(plan: LayoutPlan, rig: RigSpec, rigText: string, setsText?: string): LayoutCompanion {
  validateLimbLayout(plan, rig);
  if (JSON.stringify(JSON.parse(rigText)) !== JSON.stringify(rig)) refuseIfAny([{ code: 'RIG_LAYOUT_UNREPRESENTABLE', object: 'layout.json rig source', detail: 'final rig text and accepted layout object differ; nothing may be emitted from a stale candidate' }]);
  const hash = (s: string): string => createHash('sha256').update(s).digest('hex');
  return {
    spec: LAYOUT_SPEC,
    rig: { file: 'rig.json', sha256: hash(rigText) },
    ...(setsText === undefined ? {} : { sets: { file: 'sets.json' as const, sha256: hash(setsText) } }),
    setup_slots: rig.slots.map((s) => s.name),
    placements: plan.placements.map((p) => ({ limb: p.limb, parts: [...p.parts], ...(p.before === undefined ? { after: p.after } : { before: p.before }), slots: [...p.slots], target_slots: [...p.target_slots] })),
  };
}
