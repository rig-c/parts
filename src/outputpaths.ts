import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import nodePath, { resolve } from 'node:path';
import { PartsError } from './errors.ts';

/** `node:path`, or its `win32`/`posix` twin a control passes in. */
export type PlatformPath = typeof nodePath.posix;

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

/**
 * `path` relative to `outDir` in `api`'s separators, with `outDir` and `path`'s directory resolved through their
 * links by `real` and `path`'s own last segment kept: the rule {@link recordedConfigPath}, {@link argvPathFromOut}
 * and {@link recordedInputPath} share, rig-c core's `relativeToOut` (core issue #1770).
 */
export function relativeKeepingName(outDir: string, path: string, real: (path: string) => string, api: PlatformPath): string {
  const absolute = api.resolve(path);
  return api.relative(real(api.resolve(outDir)), api.join(real(api.dirname(absolute)), api.basename(absolute)));
}

/**
 * `config.path` in a `rig-run/2` record: relative to the real `--out` directory, the config's directory resolved through
 * its links and the file's own name kept, `/`-separated. A config given through a link is recorded by the link's name,
 * as rig-c core's render-run.json records an input (core issue #1770), so a replay reads what the link names then.
 * `rig-run/1`'s `config.path` still resolves the file itself and is unchanged.
 * The links are resolved by {@link linkRuleFor}'s rule, so on Windows the path is relative to `--out` as spelled.
 * `real` and `api` are the resolution and path rules used, for the control.
 */
export function recordedConfigPath(outDir: string, configPath: string, real?: (path: string) => string, api: PlatformPath = nodePath): string {
  return relativeKeepingName(outDir, configPath, real ?? linkRuleFor(api), api).split(api.sep).join('/');
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

/**
 * One `assemble` input (`source`, `full`, `head`) recorded relative to `--out` by {@link argvPathFromOut} (issue
 * #1554): when `isDirectory` is true (a See-through directory run), records the hashed manifest `<given>/layers.json`
 * rather than the directory itself so the recorded `path` names the exact file `sha256` digests.
 */
export function recordedInputPath(given: string, out: string, cwd: string, isDirectory = false, api: PlatformPath = nodePath, real: (path: string) => string = linkRuleFor(api)): string {
  return argvPathFromOut(isDirectory ? api.join(given, 'layers.json') : given, out, cwd, api, real);
}

/**
 * Make an output directory and its parents, from its resolved path. Bun on Windows refuses
 * `mkdirSync('.', { recursive: true })` with EEXIST when `.` exists (windows-latest, Bun 1.4.5, issue #1541), so an
 * `--out .` given from the directory it names reached that refusal; the resolved path is made on every platform.
 * `mkdir` is the call made, for the control that plants the unresolved one.
 */
export function makeOutDir(dir: string, mkdir: (path: string, options: { recursive: true }) => unknown = mkdirSync): void {
  mkdir(resolve(dir), { recursive: true });
}

/**
 * Filesystem spelling for a diagnostic name. See STABILITY's "Diagnostic path
 * segments" for the single public definition. Encode code units, not UTF-8:
 * even an unpaired surrogate has its own spelling rather than U+FFFD's.
 */
export function diagnosticSegment(name: string, suffix = ''): string {
  let encoded = '';
  const escape = (unit: number): string => '~' + unit.toString(16).padStart(4, '0');
  for (let i = 0; i < name.length; i++) {
    const unit = name[i];
    encoded += /^[A-Za-z0-9_@+.-]$/.test(unit) && !(unit === '.' && i === name.length - 1)
      ? unit : escape(name.charCodeAt(i));
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(encoded)) encoded = escape(name.charCodeAt(0)) + encoded.slice(1);
  const segment = encoded + suffix;
  if (name.length === 0 || segment.length > 255) throw new PartsError([{
    code: 'DIAGNOSTIC_PATH_SEGMENT', object: `diagnostic name ${JSON.stringify(name)}`,
    detail: name.length === 0 ? 'is empty; a nonempty original name is required for a diagnostic filesystem segment'
      : `encodes to ${segment.length} characters including fixed suffix ${JSON.stringify(suffix)}; at most 255 are required for a diagnostic filesystem segment; shorten the original name, no truncation is applied`,
  }]);
  return segment;
}

/**
 * Why `dir`, a folder name another tool recorded, is not one safe path segment
 * Parts can join under its own output as it is, or `null` when it is (issue
 * #1367). Safe is the alphabet `diagnosticSegment` emits — `[A-Za-z0-9_@+.-]`
 * and its escape character `~` — with no final `.` (so neither `.` nor `..`),
 * no Windows device basename before the first dot, and 1 to 255 characters.
 * rig-c's render records every frame-set folder in that alphabet from
 * rig-c/core#1744 on; nothing here maps or repairs the value.
 */
export function unsafeSegmentReason(dir: unknown): string | null {
  if (typeof dir !== 'string') return dir === undefined ? 'is absent' : `is ${dir === null ? 'null' : typeof dir}, not a string`;
  if (dir.length === 0) return 'is empty';
  if (/^[\\/]/.test(dir)) return 'is an absolute path';
  if (dir === '.' || dir === '..' || /(?:^|[\\/])\.\.?(?:[\\/]|$)/.test(dir)) return 'holds a dot segment';
  if (/[\\/]/.test(dir)) return 'holds a path separator';
  let unit = 0;
  while (unit < dir.length && /^[A-Za-z0-9_@+.~-]$/.test(dir[unit])) unit++;
  if (unit < dir.length) return `holds ${JSON.stringify(dir[unit])} (U+${dir.charCodeAt(unit).toString(16).padStart(4, '0')}) outside [A-Za-z0-9_@+.~-]`;
  if (dir.endsWith('.')) return 'ends with "."';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(dir)) return 'is a Windows device name before its first dot';
  if (dir.length > 255) return `is ${dir.length} characters`;
  return null;
}

/** Validate the entire sibling scope before a caller creates any of its paths. */
export function diagnosticSiblings(names: readonly { name: string; suffix?: string }[], scope: string): string[] {
  const seen = new Map<string, { name: string; folder: string }>();
  return names.map(({ name, suffix }) => {
    const folder = diagnosticSegment(name, suffix);
    const folded = folder.toLowerCase(); // Mapped segments contain ASCII only.
    const previous = seen.get(folded);
    if (previous !== undefined) throw new PartsError([{
      code: 'DIAGNOSTIC_PATH_SEGMENT', object: `diagnostic names ${JSON.stringify(previous.name)} and ${JSON.stringify(name)}`,
      detail: `folders ${JSON.stringify(previous.folder)} and ${JSON.stringify(folder)} share ASCII-case-folded folder ${JSON.stringify(folded)} in sibling scope ${JSON.stringify(scope)}; distinct case-folded sibling folders are required`,
    }]);
    seen.set(folded, { name, folder });
    return folder;
  });
}
