/** Fully explicit unit consumers may omit their unused scalar transport (#877). */
import type { MeshSpec, Motion, RegionSpec, TurnSpec } from './config.ts';
import { turnUnitBone } from './turn.ts';

export interface AuthoredUnitDepth {
  kind: 'authored-unit';
  /** An absent bone means the part override, which covers every carried piece. */
  values: Array<{ group: 'head' | 'body'; bone?: string; value: number }>;
}

export function authoredUnitDepths(cfg: {
  turn?: TurnSpec;
  regions?: Record<string, RegionSpec>;
  meshes?: Record<string, MeshSpec>;
  motion?: Pick<Motion, 'blink'>;
}): ReadonlyMap<string, AuthoredUnitDepth> {
  const out = new Map<string, AuthoredUnitDepth>();
  const turn = cfg.turn;
  if (turn === undefined || turn === null || typeof turn !== 'object' || Array.isArray(turn)) return out;
  const groups = [
    { group: 'head' as const, roles: turn.roles, depths: turn.unitDepths },
    { group: 'body' as const, roles: turn.body?.roles, depths: turn.body?.unitDepths ?? turn.unitDepths },
  ];
  const number = (table: Record<string, number> | undefined, name: string): number | undefined => {
    const value = table !== undefined && Object.hasOwn(table, name) ? table[name] : undefined;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };
  const parts = new Set(groups.flatMap(g => Object.keys(g.roles ?? {})));
  for (const part of parts) {
    const values: AuthoredUnitDepth['values'] = [];
    let complete = true;
    for (const g of groups) {
      if (g.roles === undefined || !Object.hasOwn(g.roles, part)) continue;
      if (g.roles[part] !== 'unit') { complete = false; break; }
      const explicitPart = number(g.depths, part);
      if (explicitPart !== undefined) { values.push({ group: g.group, value: explicitPart }); continue; }
      const region = cfg.regions?.[part];
      const bone = typeof region === 'string' ? region : region?.bone;
      // Match the producer's actual unit carrier, not a mesh segment's bone.
      const bones = cfg.meshes !== undefined && Object.hasOwn(cfg.meshes, part)
        ? [turnUnitBone(part)]
        : typeof bone === 'string' && bone.length > 0 ? [bone] : [];
      if (cfg.meshes?.[part] === undefined) {
        const still = cfg.motion?.blink?.still?.[part];
        if (still !== undefined) {
          if (typeof still.bone !== 'string' || still.bone.length === 0) { complete = false; break; }
          bones.push(still.bone);
        }
      }
      if (bones.length === 0) { complete = false; break; }
      for (const name of new Set(bones)) {
        const value = number(g.depths, name);
        if (value === undefined) { complete = false; break; }
        values.push({ group: g.group, bone: name, value });
      }
      if (!complete) break;
    }
    if (complete && values.length > 0) out.set(part, { kind: 'authored-unit', values });
  }
  return out;
}
