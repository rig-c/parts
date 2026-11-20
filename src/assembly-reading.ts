import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { authoredUnitDepths } from './authoredunit.ts';
import { controlSkeletonOf, isDoorKey, loadEarlyConfig, turnMovingPartPair, type AssembleConfig } from './config.ts';
import { PartsError } from './errors.ts';
import { bonePlaces } from './limbs.ts';
import type { AssemblyConfigRecord, PartsFile } from './parts.ts';
import { DEFAULT_GROUND, DEFAULT_PROJECT_RULE, type ProjectRule } from './projectrule.ts';
import { DEFAULT_SEAM_RULE, type SeamRule } from './seamrule.ts';
import { readRequirements } from './requirements.ts';

type AssemblySource = Omit<AssembleConfig, 'seethrough'> & Partial<Pick<AssembleConfig, 'seethrough'>>;

export interface AssemblyRules {
  seam?: SeamRule;
  project?: ProjectRule;
}

export function effectiveAssemblyRules(config: AssemblyRules, overrides: AssemblyRules = {}): Required<AssemblyRules> {
  return { seam: overrides.seam ?? config.seam ?? DEFAULT_SEAM_RULE, project: overrides.project ?? config.project ?? DEFAULT_PROJECT_RULE };
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

// These maps use authored part, bone or layer names as keys, independently
// of the loader's metadata spelling for structural fields.
const authoredKeyMaps = new Set(['layers', 'tips', 'drawn', 'base_anchor']);

function canonical(value: unknown, authoredKeys = false): unknown {
  if (Array.isArray(value)) return value.map(entry => canonical(entry));
  if (value !== null && typeof value === 'object') {
    const fields = value as Record<string, unknown>;
    const keys = Object.keys(fields).filter(key => authoredKeys || !isDoorKey(key)).sort();
    return Object.fromEntries(keys.map(key => [key, canonical(fields[key], !authoredKeys && authoredKeyMaps.has(key))]));
  }
  return value;
}

function movingPairs(cfg: AssemblySource, names: readonly string[]): Array<[string, string]> {
  const moves = turnMovingPartPair(cfg);
  if (moves === null) return [];
  return names.flatMap((a, i) => names.slice(i + 1).filter(b => moves(a, b)).map((b): [string, string] => [a, b]));
}

/** Config values consumed by assembly, evaluated against the assembled names and run shape. */
export function readAssemblyConfig(
  cfg: AssemblySource, parts: PartsFile, configPath: string, overrides?: AssemblyRules,
): AssemblyConfigRecord {
  const { seam, project } = effectiveAssemblyRules(cfg.assemble, overrides);
  const ground = project === 'visible' ? cfg.assemble.ground ?? DEFAULT_GROUND : DEFAULT_GROUND;
  const setup = ground === 'busy' && cfg.requirements !== undefined
    ? readRequirements(resolve(dirname(configPath), cfg.requirements)).setup_painting
    : undefined;
  const names = [...new Set([
    ...parts.parts.map(part => part.name),
    ...(parts.alternates ?? []).flatMap(set => set.records.map(part => part.name)),
    ...(cfg.assemble.cuts ?? []).map(cut => cut.into),
    ...(cfg.assemble.patches ?? []).map(patch => patch.name),
    ...cfg.assemble.plan.map(([name]) => name),
  ])].sort();
  const basePairs = movingPairs({ ...cfg, constraints: undefined }, names);
  const baseSet = new Set(basePairs.map(pair => JSON.stringify(pair)));
  const physicsPairs = movingPairs(cfg, names).filter(pair => !baseSet.has(JSON.stringify(pair)));
  const { resolution, head_box, arm_split } = cfg.seethrough ?? {};
  const hasHeadRun = Object.keys(parts.ghost_px).some(name => name.startsWith('head:'));
  const frontParts = new Set((cfg.assemble.alternates ?? []).flatMap(set => set.front ?? []));
  const bands = [
    { name: null, records: parts.parts },
    ...(parts.alternates ?? []).map(({ name, records }) => ({ name, records })),
  ];
  const hybridWidths = new Map<string, Array<{ set: string | null; width?: number }>>();
  const limbs = Object.entries(cfg.limbs ?? {}).map(([name, { segments, split, front }]) => {
    const activeFront = front?.parts.filter(part => frontParts.has(part)) ?? [];
    const resolvedSegments = segments.map(({ hybrid, ...segment }) => {
      if (hybrid === undefined) return segment;
      hybridWidths.set(hybrid.part, bands.flatMap(({ name: set, records }) => {
        const band = records.find(record => record.name === hybrid.part)?.limb?.band;
        return band === undefined ? [] : [{ set, width: hybrid.width ?? band.measured_width }];
      }));
      return { ...segment, hybrid: { part: hybrid.part } };
    });
    return [name, {
      segments: resolvedSegments,
      split,
      front: front !== undefined && activeFront.length > 0 ? { parts: activeFront, after: front.after } : undefined,
    }] as const;
  });
  const limbBones = new Set(limbs.flatMap(([, limb]) => limb.segments.map(segment => segment.bone)));
  const alternateBones = new Set((cfg.assemble.alternates ?? []).flatMap(set => Object.keys(set.tips ?? {})));
  const posesAlternate = limbs.length > 0 && cfg.assemble.alternates?.some(set => set.drawn !== undefined || set.skeleton !== undefined);
  const geometry = limbBones.size === 0 && alternateBones.size === 0 ? [] : [...bonePlaces(cfg.bones ?? [])]
    .filter(([name]) => limbBones.has(name) || alternateBones.has(name));
  // Alternate skeleton and drawn registration also use the hierarchy.
  const bones = posesAlternate ? cfg.bones : geometry.length === 0 ? undefined : geometry;
  const assemble = {
    ...cfg.assemble,
    ground,
    project,
    seam,
    extend_below_crop: cfg.assemble.extend_below_crop?.length ? cfg.assemble.extend_below_crop : undefined,
    patches: cfg.assemble.patches?.length ? cfg.assemble.patches : undefined,
    cuts: cfg.assemble.cuts?.length ? cfg.assemble.cuts : undefined,
    keep_under_occluders: cfg.assemble.keep_under_occluders?.length ? cfg.assemble.keep_under_occluders : undefined,
    require_hidden_extent: cfg.assemble.require_hidden_extent?.length ? cfg.assemble.require_hidden_extent : undefined,
    head_face_underfill: hasHeadRun && cfg.assemble.head_face_underfill === true ? true : undefined,
    yield_refused: cfg.assemble.yield_refused === true ? true : undefined,
    stage_map: undefined,
    editor_receipts: undefined,
    edited_parts: cfg.assemble.edited_parts?.receipts.length ? cfg.assemble.edited_parts : undefined,
    occluders: cfg.assemble.occluders?.length ? cfg.assemble.occluders.map(item => ({
      ...item,
      grow: item.grow === 0 ? undefined : item.grow,
      guard: item.guard === 0 ? undefined : item.guard,
    })) : undefined,
    take: cfg.assemble.take?.length ? cfg.assemble.take : undefined,
    alternates: cfg.assemble.alternates?.length ? cfg.assemble.alternates.map(set => ({
      ...set,
      layers: Object.keys(set.layers ?? {}).length === 0 ? undefined : set.layers,
    })) : undefined,
  };
  const inputs = {
    ...Object.fromEntries(Object.entries(assemble).filter(([key]) => !isDoorKey(key)).map(([key, value]) => [`assemble.${key}`, value])),
    bones,
    'constraints.physics': physicsPairs.length === 0 ? undefined : physicsPairs,
    'depth.authored_units': cfg.depth === undefined ? undefined : [...authoredUnitDepths(cfg)].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
    depth: cfg.depth,
    'generation.control.skeleton': controlSkeletonOf(cfg),
    limbs: limbs.length === 0 ? undefined : limbs,
    'limbs.hybrid_width': hybridWidths.size === 0 ? undefined : [...hybridWidths],
    motion_seams: cfg.motion_seams,
    'requirements.setup_painting': setup,
    scene: cfg.scene === undefined ? undefined : true,
    'seethrough.resolution': resolution,
    'seethrough.head_box': hasHeadRun ? head_box : undefined,
    'seethrough.arm_split': arm_split,
    turn: basePairs.length === 0 ? undefined : basePairs,
  };
  const fields = Object.entries(inputs).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .flatMap(([name, value]) => value === undefined ? [] : [{ name, sha256: sha256(JSON.stringify(canonical(value))) }]);
  return { sha256: assemblyFieldDigest(fields), fields };
}

export function assemblyFieldDigest(fields: AssemblyConfigRecord['fields']): string {
  return sha256(JSON.stringify(fields.map(({ name, sha256 }) => [name, sha256])));
}

export function assemblyConfigReading(configPath: string, parts: PartsFile): AssemblyConfigRecord {
  return readAssemblyConfig(loadEarlyConfig(configPath, 'assemble'), parts, configPath);
}

export function changedAssemblyFields(previous: AssemblyConfigRecord, current: AssemblyConfigRecord): string[] {
  if (previous.sha256 === current.sha256) return [];
  const before = new Map(previous.fields.map(row => [row.name, row.sha256]));
  const after = new Map(current.fields.map(row => [row.name, row.sha256]));
  return [...new Set([...before.keys(), ...after.keys()])].sort().filter(name => before.get(name) !== after.get(name));
}

export function assemblyConfigChanges(configPath: string, parts: PartsFile): string[] {
  if (parts.assembly_config === undefined) return [];
  return changedAssemblyFields(parts.assembly_config, assemblyConfigReading(configPath, parts));
}

export function assemblyChangeDetail(changes: readonly string[]): string {
  return `assembly config changed at ${changes.map(name => `config.${name}`).join(', ')}; re-run assemble from the current config`;
}

export function refuseStaleAssembly(configPath: string, parts: PartsFile, loaded?: AssemblySource, overrides?: AssemblyRules): void {
  if (parts.assembly_config === undefined) return;
  const cfg = loaded ?? loadEarlyConfig(configPath, 'assemble', overrides?.project);
  const current = readAssemblyConfig(cfg, parts, configPath, overrides);
  const changes = changedAssemblyFields(parts.assembly_config, current);
  if (changes.length > 0) throw new PartsError([{ code: 'ASSEMBLY_CONFIG_STALE', object: configPath, detail: assemblyChangeDetail(changes) }]);
}
