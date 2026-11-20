import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { authoredUnitDepths } from './authoredunit.ts';
import { controlSkeletonOf, isDoorKey, loadEarlyConfig, turnMovingPartPair, type AssembleConfig, type CharacterConfig, type Cut, type Limb } from './config.ts';
import type { DepthRunConfig, UserDepthSheet } from './depthsheets.ts';
import { PartsError, refuseIfAny } from './errors.ts';
import { readWrapperLayers } from './layers.ts';
import { bonePlaces } from './limbs.ts';
import type { AssemblyConfigRecord, PartsFile } from './parts.ts';
import { PLATE_RECEIPT_FILE, verifyPlateReceipt } from './plate.ts';
import { isSkeletonName } from './skeleton.ts';
import { setupPaintingFilePath, type SetupPainting } from './setuppainting.ts';
import { DEFAULT_GROUND, DEFAULT_PROJECT_RULE, type Ground, type ProjectRule } from './projectrule.ts';
import { DEFAULT_SEAM_RULE, type SeamRule } from './seamrule.ts';
import { readRequirements } from './requirements.ts';

export type AssemblySource = Omit<AssembleConfig, 'seethrough'> & Partial<Pick<AssembleConfig, 'seethrough'>> & Pick<CharacterConfig, 'generation'>;

type ProjectionSource = Omit<AssemblySource, 'key' | 'proposed_rig_scale'>;

function assemblyLimb({ segments, split, front }: Limb) {
  return {
    segments,
    ...(split === undefined ? {} : { split }),
    ...(front === undefined ? {} : { front }),
  };
}

export type AssemblyLimb = ReturnType<typeof assemblyLimb>;

function assemblyPhysics(constraints: ProjectionSource['constraints']) {
  if (!Array.isArray(constraints)) return undefined;
  return constraints.flatMap(constraint =>
    constraint !== null && typeof constraint === 'object' && !Array.isArray(constraint) &&
      constraint.type === 'physics' && typeof constraint.bone === 'string'
      ? [{ type: 'physics' as const, bone: constraint.bone }]
      : []);
}

function assemblyMotion(motion: ProjectionSource['motion']) {
  const still = motion?.blink?.still;
  if (still == null) return undefined;
  const carriers = Object.fromEntries(Object.entries(still)
    .map(([part, carrier]) => [part, carrier == null ? carrier : { bone: carrier.bone }] as const));
  return { blink: { still: carriers } };
}

export interface AssemblyRules {
  seam?: SeamRule;
  project?: ProjectRule;
}

export function effectiveAssemblyRules(config: AssemblyRules, overrides: AssemblyRules = {}): Required<AssemblyRules> {
  return { seam: overrides.seam ?? config.seam ?? DEFAULT_SEAM_RULE, project: overrides.project ?? config.project ?? DEFAULT_PROJECT_RULE };
}

const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');

function fileBytes(path: string, field: string): Buffer {
  try {
    if (statSync(path).isFile()) return readFileSync(path);
  } catch {
    // Give callers the same named refusal for missing and unreadable files.
  }
  throw new PartsError([{ code: 'CONFIG_FILE_PRESENT', object: `config.${field}`, detail: `names ${path}; a readable file is required` }]);
}

function layerRunDigest(path: string, field: string): unknown {
  if (/\.psd$/i.test(path)) return sha256(fileBytes(path, field));
  const run = readWrapperLayers(path);
  return {
    manifest: sha256(fileBytes(run.source, field)),
    // Wrapper layers always retain a file. PSD files are handled above.
    layers: [...run.layers, ...run.hidden].map(layer => sha256(fileBytes(layer.file!, field))),
  };
}

function plateDigest(path: string, field: string): string {
  const receipt = resolve(path, PLATE_RECEIPT_FILE);
  const bytes = fileBytes(receipt, field);
  refuseIfAny(verifyPlateReceipt(receipt));
  return sha256(bytes);
}

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

// Each value below is exposed to assembly through the same entry that declares
// its digest. A shared binding names digest fields produced by another entry.
interface ReadingContext extends ReturnType<typeof digestFiles>, Required<AssemblyRules> {
  ground: Ground;
  hasHeadRun: boolean;
  bones: unknown;
  basePairs: Array<[string, string]>;
  physicsPairs: Array<[string, string]>;
  limbs: unknown[];
  hybridWidths: ReadonlyMap<string, Array<{ set: string | null; width?: number }>>;
  setup: SetupPainting | undefined;
  setupImage: (declaration: SetupPainting['figure_mask'] | SetupPainting['backdrop'], field: string) => unknown;
  authoredDepths: () => unknown;
}

type ReadDigest = (ctx: ReadingContext) => unknown;
type DigestBindings = Readonly<Record<string, ReadDigest>>;
type Exemption = { readonly issue: number; readonly reason: string };
type ProjectionEntry<T> =
  | { value: T; bindings: DigestBindings; shared?: never; exemption?: never }
  | { value: T; bindings?: never; shared: readonly string[]; exemption?: never }
  | { value: T; bindings?: never; shared?: never; exemption: Exemption };

function bound<T>(value: T, read: (value: T, ctx: ReadingContext) => unknown = value => value): ProjectionEntry<T> {
  return { value, bindings: { '': ctx => read(value, ctx) } };
}

function named<T>(value: T, bindings: DigestBindings): ProjectionEntry<T> {
  return { value, bindings };
}

function shared<T>(value: T, ...fields: string[]): ProjectionEntry<T> {
  return { value, shared: fields };
}

function exempt<T>(value: T, issue: number, reason: string): ProjectionEntry<T> {
  return { value, exemption: { issue, reason } };
}

type EntryGroup = Readonly<Record<string, ProjectionEntry<unknown>>>;
type Projected<G extends EntryGroup> = { [K in keyof G]: G[K]['value'] };

function projected<G extends EntryGroup>(group: G): Projected<G> {
  return Object.fromEntries(Object.entries(group).map(([key, entry]) => [key, entry.value])) as Projected<G>;
}

function nonempty<T>(value: T[] | undefined): T[] | undefined {
  return value?.length ? value : undefined;
}

function projectionEntries(cfg: ProjectionSource) {
  // Follow-up #1393 covers effective requirements/receipt inputs. CLI
  // requirements values are read outside this config view. Only selected values
  // can be exemptions in the projection, such as the editor receipt ledger below.
  const a = cfg.assemble;
  // These fields used to enter the digest through the enumerable assemble spread.
  const authored = <K extends keyof typeof a>(key: K) => {
    const enumerable = Object.prototype.propertyIsEnumerable.call(a, key);
    return bound(a[key], value => enumerable ? value : undefined);
  };
  const assemble = {
    seam: bound(a.seam, (_, ctx) => ctx.seam),
    project: bound(a.project, (_, ctx) => ctx.project),
    ground: bound(a.ground, (_, ctx) => ctx.ground),
    rig_scale: authored('rig_scale'),
    plan: authored('plan'),
    extend_below_crop: bound(a.extend_below_crop, nonempty),
    extend_painting: authored('extend_painting'),
    edge_splits: authored('edge_splits'),
    patches: bound(a.patches, nonempty),
    cuts: bound(a.cuts, (value, ctx) => ctx.cuts(value, 'assemble.cuts')),
    keep_under_occluders: bound(a.keep_under_occluders, nonempty),
    require_hidden_extent: bound(a.require_hidden_extent, nonempty),
    head_face_underfill: bound(a.head_face_underfill, (value, ctx) => ctx.hasHeadRun && value === true ? true : undefined),
    yield_refused: bound(a.yield_refused, value => value === false ? undefined : value),
    stage_map: exempt(a.stage_map, 1393, 'Selects a report sidecar without changing the assembly manifest.'),
    editor_receipts: exempt(a.editor_receipts, 946, 'The legacy config digest omits the validation ledger and its receipt policy.'),
    edited_parts: bound(a.edited_parts, (edited, { base, file }) => edited?.receipts.length ? {
      receipts: edited.receipts.map((receipt, i) => ({
        ...receipt,
        file: file(resolve(base, edited.dir, receipt.file), `assemble.edited_parts.receipts[${i}].file`),
      })),
    } : undefined),
    occluders: bound(a.occluders, (items, { file, plate }) => items?.length ? items.map((item, i) => ({
      ...item,
      image: file(item.image, `assemble.occluders[${i}].image`),
      plate: plate(item.plate, `assemble.occluders[${i}].plate`),
      grow: item.grow === 0 ? undefined : item.grow,
      guard: item.guard === 0 ? undefined : item.guard,
    })) : undefined),
    take: named(a.take, {
      '': ({ base, file, run }) => a.take?.length ? a.take.map((take, i) => {
        const field = `assemble.take[${i}]`;
        const reference = 'reference' in take ? take.reference : undefined;
        return {
          ...take,
          run_dir: run(take.run_dir, `${field}.run_dir`),
          st_input: file(take.st_input, `${field}.st_input`),
          // Keep whole-layer metadata in the original take digest.
          meta: 'tags' in take ? file(resolve(base, take.run_dir, 'meta.json'), `${field}.run_dir`) : undefined,
          reference: reference !== undefined && 'painting' in reference
            ? { ...reference, painting: file(reference.painting, `${field}.reference.painting`) } : reference,
        };
      }) : undefined,
      ...Object.fromEntries((a.take ?? []).flatMap((take, i) => {
        if (!('occluder' in take)) return [];
        const field = `assemble.take[${i}].meta`;
        const digest: ReadDigest = ({ base, file }) => file(resolve(base, take.run_dir, 'meta.json'), field);
        return [[field, digest]];
      })),
    }),
    alternates: bound(a.alternates, (items, { file, run, cuts }) => items?.length ? items.map((set, i) => ({
      ...set,
      source: file(set.source, `assemble.alternates[${i}].source`),
      full: run(set.full, `assemble.alternates[${i}].full`),
      head: run(set.head, `assemble.alternates[${i}].head`),
      skeleton: file(set.skeleton, `assemble.alternates[${i}].skeleton`),
      cuts: cuts(set.cuts, `assemble.alternates[${i}].cuts`),
      layers: Object.keys(set.layers ?? {}).length === 0 ? undefined : set.layers,
    })) : undefined),
  };
  const st = cfg.seethrough;
  const seethrough = st == null ? undefined : {
    resolution: bound(st.resolution),
    head_box: bound(st.head_box, (value, ctx) => ctx.hasHeadRun ? value : undefined),
    arm_split: bound(st.arm_split),
  };
  const skeleton = cfg.generation?.control?.skeleton;
  const latent = cfg.generation?.latent;
  // Look up the resolved pose on the original loader object before projecting.
  const root = {
    bones: bound(cfg.bones, (_, ctx) => ctx.bones),
    constraints: named(assemblyPhysics(cfg.constraints), {
      'constraints.physics': ctx => nonempty(ctx.physicsPairs),
    }),
    depth: bound(cfg.depth, (value, ctx) => value === undefined ? undefined : ({
      ...value,
      full: ctx.depthRun(value.full, 'depth.full'),
      head: ctx.depthRun(value.head, 'depth.head'),
    })),
    keySkeleton: named(controlSkeletonOf(cfg), {
      'generation.control.skeleton': ctx => skeleton === undefined ? undefined : {
        latent,
        ...(isSkeletonName(skeleton) ? { builtin: skeleton } : { file: ctx.file(skeleton, 'generation.control.skeleton') }),
      },
    }),
    limbs: named(cfg.limbs == null ? undefined : Object.fromEntries(
      Object.entries(cfg.limbs).map(([name, limb]) => [name, assemblyLimb(limb)] as const),
    ), {
      limbs: ctx => nonempty(ctx.limbs),
      'limbs.hybrid_width': ctx => ctx.hybridWidths.size === 0 ? undefined : [...ctx.hybridWidths],
    }),
    motion_seams: bound(cfg.motion_seams),
    requirements: named(cfg.requirements, {
      'requirements.setup_painting': ctx => ctx.setup === undefined ? undefined : {
        ...ctx.setup,
        figure_mask: ctx.setupImage(ctx.setup.figure_mask, 'figure_mask'),
        backdrop: ctx.setupImage(ctx.setup.backdrop, 'backdrop'),
      },
    }),
    scene: bound(cfg.scene === undefined ? undefined : true),
    // Turn, meshes and regions reach existing carrier helpers as aggregates.
    // Their digest bindings cover the current derived effects. The guard
    // cannot attribute a new read inside those aggregates to a digest.
    turn: named(cfg.turn, {
      turn: ctx => nonempty(ctx.basePairs),
      'depth.authored_units': ctx => ctx.authoredDepths(),
    }),
    meshes: shared(cfg.meshes, 'turn', 'constraints.physics', 'depth.authored_units'),
    regions: shared(cfg.regions, 'turn', 'constraints.physics', 'depth.authored_units'),
    motion: shared(assemblyMotion(cfg.motion), 'depth.authored_units'),
  };
  return { assemble, seethrough, root };
}

// Keep the validator's input permissive so it can name malformed entries at
// runtime, including entries planted in tests. The live entries use the union above.
type ProjectionRow = Readonly<Partial<{
  value: unknown;
  bindings: DigestBindings;
  shared: readonly string[];
  exemption: Exemption;
}>>;

function bindingName(path: string, name: string): string {
  return name === '' ? path : name;
}

export function assemblyProjectionProblems(rows: Readonly<Record<string, ProjectionRow>>): string[] {
  const problems: string[] = [];
  const boundNames = new Set<string>();
  for (const [path, entry] of Object.entries(rows)) {
    for (const name of Object.keys(entry.bindings ?? {})) {
      const field = bindingName(path, name);
      if (boundNames.has(field)) problems.push(`config.${field} has duplicate assembly digest bindings`);
      boundNames.add(field);
    }
  }
  for (const [path, entry] of Object.entries(rows)) {
    const field = `config.${path}`;
    if (entry.exemption !== undefined) {
      if (!Object.hasOwn(entry, 'value')) problems.push(`${field} has an exemption but is not projected`);
      if (boundNames.has(path) || entry.shared?.length || Object.keys(entry.bindings ?? {}).length) {
        problems.push(`${field} has an exemption and a digest binding`);
      }
    } else if (Object.keys(entry.bindings ?? {}).length === 0 && !entry.shared?.length) {
      problems.push(`${field} is projected without a digest binding or exemption`);
    }
    for (const name of entry.shared ?? []) {
      if (!boundNames.has(name)) problems.push(`${field} names missing digest binding config.${name}`);
    }
  }
  return problems;
}

export function projectAssemblyConfig(source: ProjectionSource) {
  const { assemble, seethrough, root } = projectionEntries(source);
  const rows: Readonly<Record<string, ProjectionRow>> = {
    ...Object.fromEntries(Object.entries(assemble).map(([key, entry]) => [`assemble.${key}`, entry])),
    ...root,
    ...Object.fromEntries(Object.entries(seethrough ?? {}).map(([key, entry]) => [`seethrough.${key}`, entry])),
  };
  const problems = assemblyProjectionProblems(rows);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  return {
    config: {
      assemble: projected(assemble),
      seethrough: seethrough === undefined ? undefined : projected(seethrough),
      ...projected(root),
    },
    rows,
    // The loader refuses unknown assemble keys. The public reader also accepts
    // inline configs, whose extra enumerable fields were historically hashed.
    legacyFields: Object.entries(source.assemble).filter(([key]) => !Object.hasOwn(assemble, key) && !isDoorKey(key)),
  };
}

type AssemblyProjection = ReturnType<typeof projectAssemblyConfig>;
export type AssemblyView = AssemblyProjection['config'];

function movingPairs(cfg: AssemblyView, names: readonly string[]): Array<[string, string]> {
  const moves = turnMovingPartPair(cfg);
  if (moves === null) return [];
  return names.flatMap((a, i) => names.slice(i + 1).filter(b => moves(a, b)).map((b): [string, string] => [a, b]));
}

function digestFiles(base: string) {
  const file = (path: string | undefined, field: string): string | undefined =>
    path === undefined ? undefined : sha256(fileBytes(resolve(base, path), field));
  const run = (path: string | undefined, field: string): unknown =>
    path === undefined ? undefined : layerRunDigest(resolve(base, path), field);
  const plate = (path: string | undefined, field: string): string | undefined =>
    path === undefined ? undefined : plateDigest(resolve(base, path), field);
  const cuts = (entries: Cut[] | undefined, field: string): unknown => entries?.length
    ? entries.map((cut, i) => ({
      ...cut,
      under: typeof cut.under === 'string' ? file(cut.under, `${field}[${i}].under`)
        : cut.under === undefined ? undefined : { plate: plate(cut.under.plate, `${field}[${i}].under.plate`) },
    }))
    : undefined;
  const sheet = (value: UserDepthSheet, field: string): unknown => ({ ...value, image: file(value.image, field) });
  const depthRun = (value: DepthRunConfig | undefined, field: string): unknown => value === undefined ? undefined : ({
    atlas: value.atlas === undefined ? undefined : sheet(value.atlas, `${field}.atlas.image`),
    layers: value.layers === undefined ? undefined : Object.fromEntries(Object.entries(value.layers)
      .map(([name, layer]) => [name, sheet(layer, `${field}.layers.${name}.image`)])),
  });
  return { base, file, run, plate, cuts, depthRun };
}

function readingContext(cfg: AssemblyView, parts: PartsFile, configPath: string, overrides?: AssemblyRules): ReadingContext {
  const { seam, project } = effectiveAssemblyRules(cfg.assemble, overrides);
  const ground = project === 'visible' ? cfg.assemble.ground ?? DEFAULT_GROUND : DEFAULT_GROUND;
  const base = dirname(resolve(configPath));
  const files = digestFiles(base);
  const { file } = files;
  const requirementsPath = ground === 'busy' && cfg.requirements !== undefined
    ? resolve(base, cfg.requirements) : undefined;
  const setup = requirementsPath === undefined ? undefined : readRequirements(requirementsPath).setup_painting;
  const setupImage = (declaration: SetupPainting['figure_mask'] | SetupPainting['backdrop'], field: string) =>
    declaration === undefined ? undefined : {
      ...declaration,
      path: sha256(fileBytes(setupPaintingFilePath(requirementsPath!, declaration.path), `requirements.setup_painting.${field}.path`)),
    };
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
  const hasHeadRun = Object.keys(parts.ghost_px).some(name => name.startsWith('head:'));
  const frontParts = new Set((cfg.assemble.alternates ?? []).flatMap(set => set.front ?? []));
  const bands = [
    { name: null, records: parts.parts },
    ...(parts.alternates ?? []).map(({ name, records }) => ({ name, records })),
  ];
  const hybridWidths = new Map<string, Array<{ set: string | null; width?: number }>>();
  const limbs = Object.entries(cfg.limbs ?? {}).map(([name, { segments, split, front }]) => {
    const activeFront = front?.parts.filter(part => frontParts.has(part)) ?? [];
    const resolvedSegments = segments.map(({ hybrid, ...declared }, i) => {
      const segment = { ...declared, cap: file(declared.cap, `limbs.${name}.segments[${i}].cap`) };
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
  return {
    ...files, seam, project, ground, setup, setupImage, hasHeadRun,
    basePairs, physicsPairs, bones, limbs, hybridWidths,
    authoredDepths: () => cfg.depth === undefined ? undefined
      : [...authoredUnitDepths(cfg)].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  };
}

/** Config values consumed by assembly, evaluated against the assembled names and run shape. */
export function readAssemblyConfig(
  cfg: AssemblySource, parts: PartsFile, configPath: string, overrides?: AssemblyRules,
): AssemblyConfigRecord {
  return readProjectedAssemblyConfig(projectAssemblyConfig(cfg), parts, configPath, overrides);
}

export function readProjectedAssemblyConfig(
  projection: AssemblyProjection, parts: PartsFile, configPath: string, overrides?: AssemblyRules,
): AssemblyConfigRecord {
  const ctx = readingContext(projection.config, parts, configPath, overrides);
  const inputs: Array<[string, unknown]> = projection.legacyFields.map(([key, value]) => [`assemble.${key}`, value]);
  for (const [path, entry] of Object.entries(projection.rows)) {
    for (const [name, read] of Object.entries(entry.bindings ?? {})) inputs.push([bindingName(path, name), read(ctx)]);
  }
  const fields = inputs.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .flatMap(([name, value]) => value === undefined ? [] : [{ name, sha256: sha256(JSON.stringify(canonical(value))) }]);
  return { sha256: assemblyFieldDigest(fields), fields };
}

export function assemblyFieldDigest(fields: AssemblyConfigRecord['fields']): string {
  return sha256(JSON.stringify(fields.map(({ name, sha256 }) => [name, sha256])));
}

export function isSplitTakeMetadataField(name: string): boolean {
  return /^assemble\.take\[(?:0|[1-9][0-9]*)\]\.meta$/.test(name);
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
  const previous = parts.assembly_config;
  if (previous === undefined) return;
  const cfg = loaded ?? loadEarlyConfig(configPath, 'assemble', overrides?.project);
  const current = readAssemblyConfig(cfg, parts, configPath, overrides);
  const changes = changedAssemblyFields(previous, current);
  if (changes.length === 0) return;
  const recorded = new Set(previous.fields.map(({ name }) => name));
  const predatesSplitMetadata = changes.every(name => isSplitTakeMetadataField(name) && !recorded.has(name));
  const detail = predatesSplitMetadata
    ? `assembly reading changed at ${changes.map(name => `config.${name}`).join(', ')}; the recorded stamp predates split-take donor metadata binding. Re-run assemble once with the same config`
    : assemblyChangeDetail(changes);
  throw new PartsError([{ code: 'ASSEMBLY_CONFIG_STALE', object: configPath, detail }]);
}
