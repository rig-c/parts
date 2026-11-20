import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { authoredUnitDepths } from './authoredunit.ts';
import { controlSkeletonOf, isDoorKey, loadEarlyConfig, turnMovingPartPair, type AssembleConfig } from './config.ts';
import { PartsError } from './errors.ts';
import { bonePlaces } from './limbs.ts';
import type { AssemblyConfigRecord, PartsFile } from './parts.ts';
import { DEFAULT_PROJECT_RULE, type ProjectRule } from './projectrule.ts';
import { readRequirements } from './requirements.ts';

type AssemblySource = Omit<AssembleConfig, 'seethrough'> & Partial<Pick<AssembleConfig, 'seethrough'>>;

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
  cfg: AssemblySource, parts: PartsFile, configPath: string, projectOverride?: ProjectRule,
): AssemblyConfigRecord {
  const project = projectOverride ?? cfg.assemble.project ?? DEFAULT_PROJECT_RULE;
  const setup = project === 'visible' && cfg.assemble.ground === 'busy' && cfg.requirements !== undefined
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
  const limbs = Object.entries(cfg.limbs ?? {}).map(([name, { segments, split, front }]) => [name, { segments, split, front }] as const);
  const limbBones = new Set(limbs.flatMap(([, limb]) => limb.segments.map(segment => segment.bone)));
  const alternateBones = new Set((cfg.assemble.alternates ?? []).flatMap(set => Object.keys(set.tips ?? {})));
  const posesAlternate = limbs.length > 0 && cfg.assemble.alternates?.some(set => set.drawn !== undefined || set.skeleton !== undefined);
  const geometry = limbBones.size === 0 && alternateBones.size === 0 ? [] : [...bonePlaces(cfg.bones ?? [])]
    .filter(([name]) => limbBones.has(name) || alternateBones.has(name));
  // Alternate skeleton and drawn registration also use the hierarchy.
  const bones = posesAlternate ? cfg.bones : geometry.length === 0 ? undefined : geometry;
  const assemble = {
    ...cfg.assemble,
    project,
    stage_map: undefined,
    editor_receipts: undefined,
    edited_parts: cfg.assemble.edited_parts?.receipts.length ? cfg.assemble.edited_parts : undefined,
    occluders: cfg.assemble.occluders?.map(item => ({
      ...item,
      grow: item.grow === 0 ? undefined : item.grow,
      guard: item.guard === 0 ? undefined : item.guard,
    })),
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
  return { sha256: assemblyFieldDigest(fields), fields, ...(projectOverride === undefined ? {} : { project_override: projectOverride }) };
}

export function assemblyFieldDigest(fields: AssemblyConfigRecord['fields']): string {
  return sha256(JSON.stringify(fields.map(({ name, sha256 }) => [name, sha256])));
}

export function assemblyConfigReading(configPath: string, parts: PartsFile): AssemblyConfigRecord {
  const override = parts.assembly_config?.project_override;
  return readAssemblyConfig(loadEarlyConfig(configPath, 'assemble', override), parts, configPath, override);
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

export function refuseStaleAssembly(configPath: string, parts: PartsFile, loaded?: AssemblySource): void {
  if (parts.assembly_config === undefined) return;
  const current = loaded === undefined ? assemblyConfigReading(configPath, parts) : readAssemblyConfig(loaded, parts, configPath, parts.assembly_config.project_override);
  const changes = changedAssemblyFields(parts.assembly_config, current);
  if (changes.length > 0) throw new PartsError([{ code: 'ASSEMBLY_CONFIG_STALE', object: configPath, detail: assemblyChangeDetail(changes) }]);
}
