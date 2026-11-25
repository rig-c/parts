import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import nodePath, { basename, join, relative, resolve, sep } from 'node:path';
import { type AssembleResult, FIGURE_MASK_FILE } from './assemble.ts';
import { BUILD_RUN_FILE, ERROR_MAP_FILE } from './build.ts';
import { CUT_MATERIAL_SOURCES } from './cutmaterial.ts';
import { EDGE_RESIDUAL_FILE } from './edgeresidual.ts';
import { PartsError } from './errors.ts';
import { LAYOUT_FILE } from './limblayout.ts';
import { PAINTING_ALLOCATION_FILE } from './paintingedges.ts';
import { PAINTING_IN_RIG_FILE } from './parts.ts';
import { STAGE_MAP_FILE } from './provenance.ts';
import { rigJsonText, type RigOutput, SETS_FILE } from './rig.ts';
import { SOURCE_COVER_FILE } from './sourcecover.ts';
import { SUPPORT_DOMAINS_FILE } from './supportdomains.ts';

/** `node:path`, or its `win32`/`posix` twin a control passes in. */
type PlatformPath = typeof nodePath.posix;

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

export interface RunStampInputEntry {
  role: RunStampInputRole;
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

/**
 * `config.path` in a `rig-run/2` record: relative to the real `--out` directory, the config's directory resolved through
 * its links and the file's own name kept, `/`-separated. A config given through a link is recorded by the link's name,
 * as rig-c core's render-run.json records an input (core issue #1770), so a replay reads what the link names then.
 * `rig-run/1`'s `config.path` ({@link relativeToOutRoot}) still resolves the file itself and is unchanged.
 * The links are resolved by {@link linkRuleFor}'s rule, so on Windows the path is relative to `--out` as spelled.
 * `real` and `api` are the resolution and path rules used, for the control.
 */
export function recordedConfigPath(outDir: string, configPath: string, real?: (path: string) => string, api: PlatformPath = nodePath): string {
  return relativeKeepingName(outDir, configPath, real ?? linkRuleFor(api), api).split(api.sep).join('/');
}

/**
 * `path` relative to `outDir` in `api`'s separators, with `outDir` and `path`'s directory resolved through their
 * links by `real` and `path`'s own last segment kept: the rule {@link recordedConfigPath} and {@link argvPathFromOut}
 * share, rig-c core's `relativeToOut` (core issue #1770).
 */
function relativeKeepingName(outDir: string, path: string, real: (path: string) => string, api: PlatformPath): string {
  const absolute = api.resolve(path);
  return api.relative(real(api.resolve(outDir)), api.join(real(api.dirname(absolute)), api.basename(absolute)));
}

/** A directory through its links when it exists; as given when it does not (nothing on disk to resolve). */
export function realWhereItExists(path: string): string {
  return existsSync(path) ? realpathSync(path) : path;
}

/** A path as spelled: no link resolved. */
function asSpelled(path: string): string {
  return path;
}

/**
 * The link rule a path is rebased to `--out` by, chosen by `api`'s platform: the rule its `..` follows when a replay
 * runs from the `--out` directory. On POSIX `..` is the physical parent, and the working directory is reported by its
 * real path, so both ends are resolved through their links ({@link realWhereItExists}). On Windows `..` is textual:
 * measured (issue #1551, Bun 1.4.4 on Windows build 26100), a process started in a directory spelled through a
 * junction reports that spelling as `process.cwd()` and resolves `..` against it, while `realpathSync` and
 * `realpathSync.native` both resolve the junction; resolving the ends there climbed one level too many from the
 * `--out` the run was given. So on Windows a path is rebased as spelled, from `--out` as the run was given it.
 */
export function linkRuleFor(api: PlatformPath): (path: string) => string {
  return api.sep === '\\' ? asSpelled : realWhereItExists;
}

function relativeToCwd(cwd: string, targetPath: string): string {
  const rel = relative(resolve(cwd), resolve(cwd, targetPath)).split(sep).join('/');
  return rel === '' ? '.' : rel;
}

function inputSha256OnDisk(cwd: string, targetPath: string): string {
  const resolved = resolve(cwd, targetPath);
  const filePath = statSync(resolved).isDirectory() ? join(resolved, 'layers.json') : resolved;
  return sha256OnDisk(filePath);
}

/**
 * Build the ordered `inputs` list (`source`, `full`, and `head` when given) for an `assemble` run stamp:
 * each entry records `role`, `path` relative to `cwd`, and `sha256` of the file or of `<dir>/layers.json`.
 */
export function buildAssembleInputs(inputs: RunStampAssembleInputs): RunStampInputEntry[] {
  const cwd = inputs.cwd ?? process.cwd();
  const raw: ReadonlyArray<readonly [RunStampInputRole, string | null | undefined]> = [
    ['source', inputs.source],
    ['full', inputs.full],
    ['head', inputs.head],
  ];
  const entries: RunStampInputEntry[] = [];
  for (const [role, given] of raw) {
    if (given === undefined || given === null) continue;
    entries.push({
      role,
      path: relativeToCwd(cwd, given),
      sha256: inputSha256OnDisk(cwd, given),
    });
  }
  return entries;
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
  const inputs = input.inputs === undefined ? undefined : buildAssembleInputs(input.inputs);
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
// rig-run/2: the run record `check` and `build` write (issue #1541)
// ---------------------------------------------------------------------------

export const RUN_RECORD_SPEC = 'rig-run/2' as const;
/** The record `check` writes in its `--out`; `build` writes {@link BUILD_RUN_FILE}. Neither can be the rig's `run.json`. */
export const CHECK_RUN_FILE = 'check-run.json' as const;
export { BUILD_RUN_FILE };

export type RunRecordCommand = 'check' | 'build';

/**
 * A `rig-run/2` record: the `rig-run/1` keys `check` and `build` have, then `argv`, the arguments that reproduce
 * the run with the same package version, run from the `--out` directory. `config` is written by `build` only;
 * `check` reads no config.
 */
export interface RunRecord {
  spec: typeof RUN_RECORD_SPEC;
  package: RunStampPackage;
  command: RunRecordCommand;
  started_at: string;
  finished_at: string;
  config?: RunStampFileEntry;
  outputs: RunStampFileEntry[];
  argv: string[];
}

/** One command's flags as its parser takes them: the flag-table order, which values are paths, and values that hold paths inside them. */
export interface ArgvTable {
  valued: readonly string[];
  switches: readonly string[];
  /** The valued flags whose value is one path. `--out` is written as `.`. */
  paths: readonly string[];
  /** Valued flags whose value holds paths inside it (`build --alt <name>=<source>:<full>[:<head>]`): rewrite each path with `path`. */
  compound?: Readonly<Record<string, (value: string, path: (p: string) => string) => string>>;
}

/**
 * One path argument written relative to the `--out` directory, with `/` separators: both taken from `cwd`, the
 * `--out` directory and the argument's directory resolved through their links, the argument's own last segment kept
 * (a linked file keeps its own name), as {@link recordedConfigPath} records `config.path`. `.` when it is the directory
 * itself. Written as given when it cannot be expressed relative to `--out` (another Windows drive).
 *
 * Measured (issue #1544): with `--out` given through a linked directory (`/var` -> `/private/var` on macOS) and the
 * argument relative to a working directory the process reports by its real path, plain path arithmetic climbed out
 * through the link and named a path that, replayed from the `--out` directory, did not exist. `real` is the link
 * resolution used, {@link linkRuleFor} the platform's by default (on Windows, as spelled: issue #1551); the control
 * passes the other platform's rule to plant the wrong arithmetic.
 */
export function argvPathFromOut(given: string, out: string, cwd: string, api: PlatformPath = nodePath, real: (path: string) => string = linkRuleFor(api)): string {
  const rel = relativeKeepingName(api.resolve(cwd, out), api.resolve(cwd, given), real, api);
  if (api.isAbsolute(rel)) return given;
  return rel === '' ? '.' : rel.split(api.sep).join('/');
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

export interface RunRecordInput {
  pkg: RunStampPackage;
  command: RunRecordCommand;
  startedAt: string;
  finishedAt: string;
  outDir: string;
  /** `build` only: the config it read. */
  configPath?: string;
  /** What the run wrote under `outDir`, relative, a directory standing for every file under it. */
  outputs: readonly string[];
  argv: readonly string[];
}

/** Build a `rig-run/2` record from the files on disk. Pure with respect to the clock: the times are the caller's. */
export function buildRunRecord(input: RunRecordInput): RunRecord {
  const paths = [...new Set(input.outputs.flatMap((e) => filesUnder(input.outDir, e)))].filter((p) => !isRunRecordFile(p)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    spec: RUN_RECORD_SPEC,
    package: { name: input.pkg.name, version: input.pkg.version },
    command: input.command,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    ...(input.configPath === undefined ? {} : { config: { path: recordedConfigPath(input.outDir, input.configPath), sha256: sha256OnDisk(input.configPath) } }),
    outputs: paths.map((p) => ({ path: p, sha256: sha256OnDisk(join(input.outDir, ...p.split('/'))) })),
    argv: [...input.argv],
  };
}

/** Write `<outDir>/check-run.json` or `<outDir>/build-run.json`, after the command's report is on disk. */
export function writeRunRecord(input: RunRecordInput): RunRecord {
  const record = buildRunRecord(input);
  writeFileSync(join(input.outDir, input.command === 'check' ? CHECK_RUN_FILE : BUILD_RUN_FILE), rigJsonText(record));
  return record;
}
