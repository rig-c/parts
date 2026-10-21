/**
 * Issue #646: close each declared limb's existing slot block over its riders.
 * No anatomical role or crossed target is inferred. A declared segment is an
 * ownership boundary: descendants belong to the first segment encountered up
 * their parent graph, so a nested limb does not become its ancestor's rider.
 */
import type { Limb } from './config.ts';
import type { RigSpec } from './rig.ts';

export interface LimbSlotOwner {
  slot: string;
  kind: 'exclusive' | 'nonexclusive' | 'outside' | 'unbound';
  limb: string | null;
  /** Every attachment's actual binding, not a mesh slot's carrier bone. */
  bindings: Array<{ attachment: string; bones: string[] }>;
  limbs: string[];
  outside: string[];
}

export interface LimbSlotLayout {
  slots: RigSpec['slots'];
  owners: LimbSlotOwner[];
  /** First segment SLOT encountered in setup order, not anatomical segment 0. */
  anchors: Array<{ limb: string; slot: string | null }>;
}

/**
 * Read after all alternate attachments exist and before stops/turn rewrite
 * bindings. Keep the returned slot references until those rewrites finish;
 * only then publish the permutation, so their own enumeration order is intact.
 *
 * All weights of all attachments must resolve exclusively to the same limb.
 * Even a listed zero-weight reference is read, as in meshBoundBones: there is
 * no epsilon or first-weight rule. Mixed/outside/empty bindings stay outside
 * the gathered blocks, with their classification returned for inspection.
 * Their mutual order is preserved; complete closure is not promised across a
 * nonexclusive segment or rider. No new refusal is introduced.
 */
export function coalesceLimbSlots(
  limbs: Readonly<Record<string, Limb>> | undefined,
  bones: RigSpec['bones'],
  slots: RigSpec['slots'],
  skin: RigSpec['skins']['default'],
): LimbSlotLayout {
  if (limbs === undefined || Object.keys(limbs).length === 0) return { slots, owners: [], anchors: [] };
  const seeds = new Map<string, string[]>();
  for (const [name, limb] of Object.entries(limbs)) {
    for (const s of limb.segments) {
      const names = seeds.get(s.bone) ?? [];
      if (!names.includes(name)) names.push(name);
      seeds.set(s.bone, names);
    }
  }
  const parents = new Map(bones.map((b) => [b.name, b.parent]));
  const ownerOf = (bone: string): readonly string[] => {
    let at: string | undefined = bone;
    const seen = new Set<string>();
    while (at !== undefined && !seen.has(at)) {
      seen.add(at);
      const declared = seeds.get(at);
      if (declared !== undefined) return declared;
      at = parents.get(at);
    }
    return [];
  };
  const owners: LimbSlotOwner[] = slots.map((slot) => {
    const bindings = Object.entries(skin[slot.name] ?? {}).map(([attachment, att]) => ({
      attachment,
      bones: 'type' in att ? [...new Set(att.weights.flatMap((v) => v.map((w) => w.bone)))] : [slot.bone],
    }));
    const mine = new Set<string>();
    const outside = new Set<string>();
    let exclusive = bindings.length > 0;
    for (const b of bindings) {
      if (b.bones.length === 0) exclusive = false;
      for (const bone of b.bones) {
        const names = ownerOf(bone);
        if (names.length !== 1) exclusive = false;
        if (names.length === 0) outside.add(bone);
        for (const name of names) mine.add(name);
      }
    }
    const kind = exclusive && mine.size === 1 && outside.size === 0 ? 'exclusive' : mine.size > 0 ? 'nonexclusive' : bindings.some((b) => b.bones.length > 0) ? 'outside' : 'unbound';
    return { slot: slot.name, kind, limb: kind === 'exclusive' ? [...mine][0] : null, bindings, limbs: [...mine], outside: [...outside] };
  });
  const anchors = Object.entries(limbs).map(([name, limb]) => ({ limb: name, slot: slots.find((s) => limb.segments.some((sg) => sg.part === s.name))?.name ?? null }));
  const at = new Map<string, string[]>();
  const anchored = new Set<string>();
  for (const anchor of anchors) {
    if (anchor.slot === null) continue;
    at.set(anchor.slot, [...(at.get(anchor.slot) ?? []), anchor.limb]);
    anchored.add(anchor.limb);
  }
  const owned = new Map(owners.map((o) => [o.slot, o.limb !== null && anchored.has(o.limb) ? o.limb : null]));
  const gathered = new Map<string, RigSpec['slots']>();
  for (const slot of slots) {
    const name = owned.get(slot.name);
    if (name !== null && name !== undefined) gathered.set(name, [...(gathered.get(name) ?? []), slot]);
  }
  const reordered: RigSpec['slots'] = [];
  for (const slot of slots) {
    for (const name of at.get(slot.name) ?? []) reordered.push(...(gathered.get(name) ?? []));
    if (owned.get(slot.name) === null) reordered.push(slot);
  }
  return { slots: reordered.every((s, i) => s === slots[i]) ? slots : reordered, owners, anchors };
}
