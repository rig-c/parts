import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import nodePath, { basename, join, relative, resolve, sep } from 'node:path';
import { type AssembleResult, FIGURE_MASK_FILE } from './assemble.ts';
import { BUILD_RUN_FILE, ERROR_MAP_FILE } from './build.ts';
import { CUT_MATERIAL_SOURCES } from './cutmaterial.ts';
import { EDGE_RESIDUAL_FILE } from './edgeresidual.ts';
import { PartsError } from './errors.ts';
import { LAYOUT_FILE } from './limblayout.ts';
import { argvPathFromOut, linkRuleFor, type PlatformPath, realWhereItExists, recordedConfigPath, recordedInputPath } from './outputpaths.ts';
import { PAINTING_ALLOCATION_FILE } from './paintingedges.ts';
import { PAINTING_IN_RIG_FILE } from './parts.ts';
import { STAGE_MAP_FILE } from './provenance.ts';
import { rigJsonText, type RigOutput, SETS_FILE } from './rig.ts';
import { SOURCE_COVER_FILE } from './sourcecover.ts';
import { SUPPORT_DOMAINS_FILE } from './supportdomains.ts';

export { argvPathFromOut, linkRuleFor, type PlatformPath, realWhereItExists, recordedConfigPath, recordedInputPath };

export const RUN_STAMP_SPEC = 'rig-run/1' as const;
export const RUN_STAMP_FILE = 'run.json' as const;
export const COMPOSE_RUN_SPEC = 'rig-compose-run/1' as const;
export const COMPOSE_RUN_FILE = 'compose-run.json' as const;
export const RUN_STAMP_INPUT_ROLES = ['source', 'full', 'head'] as const;

export type RunStampCommand = 'rig' | 'assemble';
export type RunStampInputRole = (typeof RUN_STAMP_INPUT_ROLES)[number];

export interface RunStampPackage {
  name: string;
  version: string;
}

export interface RunStampFileEntry {
  path: string;
  sha256: string;
}

/** Compose's consumed inputs and opted-in placement, captured before its gate. */
export interface ComposeRun {
  spec: typeof COMPOSE_RUN_SPEC;
  scene: RunStampFileEntry;
  characters: Array<{
    id: string;
    build: string;
    files: RunStampFileEntry[];
    placement?: {
      canvas_clip: true;
      bounds: [number, number, number, number];
      clipped_bounds: [number, number, number, number];
    };
  }>;
  plate: RunStampFileEntry | null;
  plates: Array<{ name: string; path: string; sha256: string }>;
}

export interface RunStampInputEntry<Role extends string = RunStampInputRole> {
  role: Role;
  path: string;
  sha256: string;
}

export interface RunStampAssembleInputs {
  cwd?: string;
  source: string;
  full: string;
  head?: string | null;
}

export interface RunStamp {
  spec: typeof RUN_STAMP_SPEC;
  package: RunStampPackage;
  command: RunStampCommand;
  started_at: string;
  finished_at: string;
  config: RunStampFileEntry;
  inputs?: RunStampInputEntry[];
  outputs: RunStampFileEntry[];
}

export interface RunStampInput {
  pkg: RunStampPackage;
  command: RunStampCommand;
  startedAt: string;
  finishedAt: string;
  outDir: string;
  configPath: string;
  inputs?: RunStampAssembleInputs;
  outputPaths: readonly string[];
}

function sha256OnDisk(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function relativeToOutRoot(outDir: string, targetPath: string): string {
  const realOut = realpathSync(resolve(outDir));
  const realTarget = realpathSync(resolve(targetPath));
  return relative(realOut, realTarget).split(sep).join('/');
}

type RunInputPaths<Role extends string> = Array<readonly [Role, string | null | undefined]>;

/** Name and hash the same file. A See-through directory names its manifest (issue #1554). */
function recordInputs<Role extends string>(paths: RunInputPaths<Role>, outDir: string, cwd: string): RunStampInputEntry<Role>[] {
  const entries: RunStampInputEntry<Role>[] = [];
  for (const [role, given] of paths) {
    if (given === undefined || given === null) continue;
    const resolved = resolve(cwd, given);
    const isDir = statSync(resolved).isDirectory();
    entries.push({
      role,
      path: recordedInputPath(given, outDir, cwd, isDir),
      sha256: sha256OnDisk(isDir ? join(resolved, 'layers.json') : resolved),
    });
  }
  return entries;
}

/** The ordered inputs (`source`, `full`, and `head` when given) for an `assemble` run stamp. */
export function buildAssembleInputs(inputs: RunStampAssembleInputs, outDir: string): RunStampInputEntry[] {
  return recordInputs<RunStampInputRole>([
    ['source', inputs.source],
    ['full', inputs.full],
    ['head', inputs.head],
  ], outDir, inputs.cwd ?? process.cwd());
}

function sortCodeUnits(paths: readonly string[]): string[] {
  return [...new Set(paths.filter((p) => p !== RUN_STAMP_FILE))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Remove `<outDir>/run.json` before a stage starts so a refused run never leaves a stale stamp behind. */
export function clearRunStamp(outDir: string): void {
  rmSync(join(outDir, RUN_STAMP_FILE), { force: true });
}

/** Remove a previous compose record before CLI prevalidation or the compose stage begins. */
export function clearComposeRun(outDir: string): void {
  rmSync(join(outDir, COMPOSE_RUN_FILE), { force: true });
}

/**
 * Read package `name` and `version` from `package.json`, refusing with `RUN_STAMP_PACKAGE`
 * when the file is missing, invalid JSON, or lacks a non-empty string `name` or `version`.
 */
export function readPackageIdentity(pkgPath: string): RunStampPackage {
  if (!existsSync(pkgPath)) {
    throw new PartsError([{ code: 'RUN_STAMP_PACKAGE', object: pkgPath, detail: 'no such file; a package.json with non-empty string "name" and "version" is required to write run.json' }]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    throw new PartsError([{ code: 'RUN_STAMP_PACKAGE', object: pkgPath, detail: `${(err as Error).message}; valid JSON with non-empty string "name" and "version" is required to write run.json` }]);
  }
  const obj = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  const name = obj !== null && typeof obj.name === 'string' ? obj.name.trim() : '';
  const version = obj !== null && typeof obj.version === 'string' ? obj.version.trim() : '';
  if (name === '' || version === '') {
    const missing = [...(name === '' ? ['name'] : []), ...(version === '' ? ['version'] : [])].join(' and ');
    throw new PartsError([{ code: 'RUN_STAMP_PACKAGE', object: pkgPath, detail: `missing non-empty string ${missing}; both "name" and "version" are required to write run.json` }]);
  }
  return { name, version };
}

/** The exact relative output paths `rigStage` writes under `--out`, derived from its returned `RigOutput`. */
export function rigOutputFiles(rig: RigOutput): string[] {
  return sortCodeUnits([
    'rig.json',
    'motion.json',
    'mesh_report.json',
    ...(rig.depthReferences === undefined ? [] : ['depth_sheets.json']),
    ...(rig.sets === undefined ? [] : [SETS_FILE]),
    ...(rig.layout === undefined ? [] : [LAYOUT_FILE]),
    ...rig.images.map(([file]) => `images/${file}`),
  ]);
}

function writtenAllocationReports(outDir: string): string[] {
  const allocationPath = join(outDir, 'rig', PAINTING_ALLOCATION_FILE);
  if (!existsSync(allocationPath)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(allocationPath, 'utf8'));
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'written_reports' in parsed &&
      Array.isArray(parsed.written_reports)
    ) {
      return parsed.written_reports
        .filter((f): f is string => typeof f === 'string' && f.startsWith('painting_allocation.') && f.endsWith('.json') && basename(f) === f)
        .map((f) => `rig/${f}`);
    }
  } catch {
    return [];
  }
  return [];
}

/** The exact relative output paths `assembleStage` writes under `--out`, derived from its returned `AssembleResult`. */
export function assembleOutputFiles(outDir: string, result: AssembleResult): string[] {
  return sortCodeUnits([
    'rig/parts.json',
    `rig/${PAINTING_IN_RIG_FILE}`,
    `rig/${SOURCE_COVER_FILE}`,
    `rig/${SUPPORT_DOMAINS_FILE}`,
    ...(result.stageMap === undefined ? [] : [`rig/${STAGE_MAP_FILE}`]),
    ...(result.edgeResiduals === undefined ? [] : [`rig/${EDGE_RESIDUAL_FILE}`]),
    ...(result.paintingEdges?.allocation === undefined ? [] : [`rig/${PAINTING_ALLOCATION_FILE}`, ...writtenAllocationReports(outDir)]),
    ...(existsSync(join(outDir, 'rig', CUT_MATERIAL_SOURCES)) ? [`rig/${CUT_MATERIAL_SOURCES}`] : []),
    ...result.parts.parts.flatMap((p) => [`rig/parts/${p.name}.png`, ...(p.depth === undefined ? [] : [`rig/parts/${p.depth.image}`]), ...(p.source_state_map === undefined ? [] : [`rig/parts/${p.source_state_map.image}`])]),
    ...(result.parts.alternates ?? []).flatMap((alt) =>
      alt.records.flatMap((p) => [`rig/parts/${alt.name}_${p.name}.png`, ...(p.depth === undefined ? [] : [`rig/parts/${p.depth.image}`]), ...(p.source_state_map === undefined ? [] : [`rig/parts/${p.source_state_map.image}`])]),
    ),
    'render/recomposite_rig.png',
    `render/${ERROR_MAP_FILE}`,
    ...(result.figure === null ? [] : [`render/${FIGURE_MASK_FILE}`, `rig/${FIGURE_MASK_FILE}`]),
  ]);
}

/**
 * Build a `rig-run/1` run stamp from the files actually written by the stage under `outDir`
 * and the config file on disk, using the caller-supplied package metadata and
 * UTC ISO-8601 timestamps. Pure with respect to the clock: no time is read here.
 */
export function buildRunStamp(input: RunStampInput): RunStamp {
  const relPaths = sortCodeUnits(input.outputPaths);
  const outputs: RunStampFileEntry[] = relPaths.map((rel) => ({
    path: rel,
    sha256: sha256OnDisk(join(input.outDir, ...rel.split('/'))),
  }));
  const inputs = input.inputs === undefined ? undefined : buildAssembleInputs(input.inputs, input.outDir);
  return {
    spec: RUN_STAMP_SPEC,
    package: {
      name: input.pkg.name,
      version: input.pkg.version,
    },
    command: input.command,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    config: {
      path: relativeToOutRoot(input.outDir, input.configPath),
      sha256: sha256OnDisk(input.configPath),
    },
    ...(inputs === undefined ? {} : { inputs }),
    outputs,
  };
}

/**
 * Format and write `<outDir>/run.json` (`spec: "rig-run/1"`). Called by the CLI
 * only after the command's gate and output writes have succeeded.
 */
export function writeRunStamp(input: RunStampInput): RunStamp {
  const stamp = buildRunStamp(input);
  writeFileSync(join(input.outDir, RUN_STAMP_FILE), rigJsonText(stamp));
  return stamp;
}

// ---------------------------------------------------------------------------
// Run records: check (rig-run/2) and build (rig-run/3)
// ---------------------------------------------------------------------------

export const RUN_RECORD_SPEC = 'rig-run/2' as const;
export const BUILD_RUN_RECORD_SPEC = 'rig-run/3' as const;
/** The record `check` writes in its `--out`; `build` writes {@link BUILD_RUN_FILE}. Neither can be the rig's `run.json`. */
export const CHECK_RUN_FILE = 'check-run.json' as const;
export { BUILD_RUN_FILE };

export type RunRecordCommand = 'check' | 'build';

/** Both records carry the arguments to reproduce the run with the same version, run from `--out`. */
interface RunRecordFields {
  package: RunStampPackage;
  started_at: string;
  finished_at: string;
  outputs: RunStampFileEntry[];
  argv: string[];
}

export type BuildRunInputRole = RunStampInputRole | 'requirements' | 'environment' | 'wind-band' | `alt[${number}].${RunStampInputRole}`;

export type RunRecord =
  | (RunRecordFields & { spec: typeof RUN_RECORD_SPEC; command: 'check' })
  | (RunRecordFields & { spec: typeof BUILD_RUN_RECORD_SPEC; command: 'build'; config: RunStampFileEntry; inputs: RunStampInputEntry<BuildRunInputRole>[] });

/** One command's flags as its parser takes them: the flag-table order, which values are paths, and values that hold paths inside them. */
export interface ArgvTable {
  valued: readonly string[];
  switches: readonly string[];
  /** The valued flags whose value is one path. `--out` is written as `.`. */
  paths: readonly string[];
  /** Valued flags whose value holds paths inside it (`build --alt <name>=<source>:<full>[:<head>]`): rewrite each path with `path`. */
  compound?: Readonly<Record<string, (value: string, path: (p: string) => string) => string>>;
}

/** The accepted arguments, as given: valued flags as `[flag, value]` in the order given, and the switches present. */
function argvPairs(args: readonly string[], table: ArgvTable): { values: Array<[string, string]>; on: Set<string> } {
  const values: Array<[string, string]> = [];
  const on = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (table.switches.includes(flag)) on.add(flag);
    else if (table.valued.includes(flag) && i + 1 < args.length) values.push([flag, args[++i]]);
    else throw new Error(`run record: ${JSON.stringify(flag)} is not an argument the parser accepted`);
  }
  return { values, on };
}

/**
 * The `argv` a run record holds: the command, then the options as given, in the command's flag-table order (valued
 * flags, a repeated one in the order given, then the switches present), every path written by
 * {@link argvPathFromOut} and `--out` as `.`. Defaults the run used and did not take as an argument are not written.
 */
export function recordArgv(command: RunRecordCommand, args: readonly string[], table: ArgvTable, out: string, cwd: string, api: PlatformPath = nodePath, real: (path: string) => string = linkRuleFor(api)): string[] {
  const { values, on } = argvPairs(args, table);
  const path = (p: string): string => argvPathFromOut(p, out, cwd, api, real);
  const argv: string[] = [command];
  for (const flag of table.valued) {
    for (const [f, v] of values) {
      if (f !== flag) continue;
      const compound = table.compound?.[f];
      argv.push(f, f === '--out' ? '.' : table.paths.includes(f) ? path(v) : compound === undefined ? v : compound(v, path));
    }
  }
  for (const flag of table.switches) if (on.has(flag)) argv.push(flag);
  return argv;
}

/**
 * The options a parse of `args` from `cwd` takes, each path resolved to where it points: valued flags as their
 * values in the order given, switches as present. Two argument lists that resolve to the same map ask for the same run.
 */
export function effectiveArgv(args: readonly string[], table: ArgvTable, cwd: string, api: PlatformPath = nodePath): Map<string, string[]> {
  const { values, on } = argvPairs(args, table);
  const at = (p: string): string => api.resolve(cwd, p);
  const got = new Map<string, string[]>();
  for (const [f, v] of values) {
    const compound = table.compound?.[f];
    got.set(f, [...(got.get(f) ?? []), table.paths.includes(f) ? at(v) : compound === undefined ? v : compound(v, at)]);
  }
  for (const flag of on) got.set(flag, ['on']);
  return got;
}

/**
 * Where a recorded `argv`, replayed from the `--out` directory, asks for another run than the arguments as given
 * from `cwd`: one line per flag whose effective values differ, empty when the replay is the same run.
 */
export function argvReplayProblems(command: RunRecordCommand, args: readonly string[], recorded: readonly string[], table: ArgvTable, out: string, cwd: string, api: PlatformPath = nodePath): string[] {
  if (recorded[0] !== command) return [`argv[0] is ${JSON.stringify(recorded[0])}; ${JSON.stringify(command)} is required`];
  let replay: Map<string, string[]>;
  try {
    replay = effectiveArgv(recorded.slice(1), table, api.resolve(cwd, out), api);
  } catch (err) {
    return [(err as Error).message];
  }
  const given = effectiveArgv(args, table, cwd, api);
  const flags = [...new Set([...given.keys(), ...replay.keys()])];
  return flags.filter((f) => JSON.stringify(given.get(f) ?? null) !== JSON.stringify(replay.get(f) ?? null))
    .map((f) => `${f}: given ${JSON.stringify(given.get(f) ?? null)}, replayed ${JSON.stringify(replay.get(f) ?? null)}`);
}

/** Remove a previous record before the command starts, so a refused run leaves none behind. */
export function clearRunRecord(outDir: string, file: string): void {
  rmSync(join(outDir, file), { force: true });
}

function filesUnder(outDir: string, entry: string): string[] {
  const rel = entry.endsWith('/') ? entry.slice(0, -1) : entry;
  const at = join(outDir, ...rel.split('/'));
  if (!existsSync(at)) return [];
  if (!statSync(at).isDirectory()) return [rel];
  return readdirSync(at, { withFileTypes: true }).flatMap((e) => filesUnder(outDir, `${rel}/${e.name}${e.isDirectory() ? '/' : ''}`));
}

/**
 * A record of a run, not a product of it: `run.json` (rigc's `rigc-run/1` in a packed build directory, a stage's
 * `rig-run/1`) or a `-run.json` record such as this one. Each carries its run's clock, so a record's `outputs` leaves
 * them out and two runs of the same inputs list the same files and digests.
 */
export function isRunRecordFile(path: string): boolean {
  const name = path.split('/').at(-1) ?? path;
  return name === RUN_STAMP_FILE || name.endsWith('-run.json');
}

interface RunRecordInputFields {
  pkg: RunStampPackage;
  startedAt: string;
  finishedAt: string;
  outDir: string;
  /** What the run wrote under `outDir`, relative, a directory standing for every file under it. */
  outputs: readonly string[];
  argv: readonly string[];
}

interface BuildRunInputs extends RunStampAssembleInputs {
  requirements?: string;
  environment?: string;
  windBand?: string;
  alts?: readonly Omit<RunStampAssembleInputs, 'cwd'>[];
}

export type RunRecordInput = RunRecordInputFields & (
  | { command: 'check' }
  | { command: 'build'; configPath: string; inputs: BuildRunInputs }
);

function buildRunInputs(inputs: BuildRunInputs, outDir: string): RunStampInputEntry<BuildRunInputRole>[] {
  const paths: RunInputPaths<BuildRunInputRole> = [
    ['source', inputs.source],
    ['full', inputs.full],
    ['head', inputs.head],
    ['requirements', inputs.requirements],
    ['environment', inputs.environment],
    ['wind-band', inputs.windBand],
  ];
  inputs.alts?.forEach(({ source, full, head }, i) => {
    paths.push([`alt[${i}].source`, source], [`alt[${i}].full`, full], [`alt[${i}].head`, head]);
  });
  return recordInputs(paths, outDir, inputs.cwd ?? process.cwd());
}

/** Build a run record from the files on disk using the caller's timestamps. */
export function buildRunRecord(input: RunRecordInput): RunRecord {
  const paths = [...new Set(input.outputs.flatMap((e) => filesUnder(input.outDir, e)))].filter((p) => !isRunRecordFile(p)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const pkg = { name: input.pkg.name, version: input.pkg.version };
  const times = {
    started_at: input.startedAt,
    finished_at: input.finishedAt,
  };
  const tail = {
    outputs: paths.map((p) => ({ path: p, sha256: sha256OnDisk(join(input.outDir, ...p.split('/'))) })),
    argv: [...input.argv],
  };
  if (input.command === 'check') return { spec: RUN_RECORD_SPEC, package: pkg, command: 'check', ...times, ...tail };
  return {
    spec: BUILD_RUN_RECORD_SPEC,
    package: pkg,
    command: 'build',
    ...times,
    config: { path: recordedConfigPath(input.outDir, input.configPath), sha256: sha256OnDisk(input.configPath) },
    inputs: buildRunInputs(input.inputs, input.outDir),
    ...tail,
  };
}

/** Write `<outDir>/check-run.json` or `<outDir>/build-run.json`, after the command's report is on disk. */
export function writeRunRecord(input: RunRecordInput): RunRecord {
  const record = buildRunRecord(input);
  writeFileSync(join(input.outDir, input.command === 'check' ? CHECK_RUN_FILE : BUILD_RUN_FILE), rigJsonText(record));
  return record;
}
