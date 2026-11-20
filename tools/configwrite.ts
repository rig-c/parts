/** Same-directory staging for every CLI config writer (issue #356).
 * Ownership is pure; this adapter alone owns files. Existing updates use their
 * stage loaders; fresh cloth text retains its intentional partial-config contract.
 */
import { closeSync, fchmodSync, linkSync, mkdirSync, lstatSync, openSync, readFileSync, realpathSync, statSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { loadConfigAndAnimations, loadEarlyConfig, parseConfig, parseEarlyConfig, repeatedKeys } from '../src/config.ts';
import { mergeConfigProposal, type ConfigWriteChange, type ConfigWritePatch } from '../src/configwrite.ts';
import { PartsError, type Problem } from '../src/errors.ts';
import { splicedEdits } from '../src/meshdraft.ts';

export interface ConfigWriteTarget { path: string; original: string; mode: number; raw: unknown }
/** Cloth supplies already checked splice text; a partial config is intentional. */
export interface FreshConfigWrite { kind: 'fresh'; path: string; text: string }
export interface ConfigWriteFiles {
  /** Narrow filesystem operations, supplied only by failure controls; CLI uses the real defaults. */
  replace?: (from: string, to: string) => void;
  remove?: (path: string) => void;
  publish?: (from: string, to: string) => void;
  /** Batch rollback is independent of the replacement failure being controlled. */
  restore?: (from: string, to: string) => void;
}
export interface StagedConfigWrite {
  changes: readonly ConfigWriteChange[];
  commit(): void;
  cancel(): void;
  /** Combine a caller artifact failure with cleanup before its catch prints it. */
  abort(error: unknown): never;
}
function refusal(code: string, path: string, detail: string): never {
  throw new PartsError([{ code, object: path, detail }]);
}
function ioProblem(path: string, action: string, error: unknown): Problem {
  return { code: 'CONFIG_WRITE_FAILED', object: path, detail: `${action}: ${error instanceof Error ? error.message : String(error)}; check the destination directory and permissions` };
}
function ioFailure(path: string, action: string, error: unknown): never {
  throw new PartsError([ioProblem(path, action, error)]);
}
function failedOperation(path: string, action: string, error: unknown, cancel: () => void): never {
  const problems = error instanceof PartsError ? [...error.problems] : [ioProblem(path, action, error)];
  try { cancel(); }
  catch (cleanup) { problems.push(...(cleanup instanceof PartsError ? cleanup.problems : [ioProblem(path, 'removing the staged config failed', cleanup)])); }
  throw new PartsError(problems);
}
export function readConfigWriteTarget(path: string): ConfigWriteTarget {
  const target = resolve(path);
  let stat: ReturnType<typeof lstatSync>;
  try { stat = lstatSync(target); }
  catch (error) { return refusal('CONFIG_FILE_PRESENT', target, `cannot read the existing config: ${error instanceof Error ? error.message : String(error)}; without --cloth, --write-config updates an existing config in place (only propose --cloth --write-config writes to a new file)`); }
  if (!stat.isFile()) return refusal('CONFIG_FIELD_TYPE', target, 'is not a regular file (symlinks are not replaced); --write-config updates an existing config file in place');
  let original: string;
  try { original = readFileSync(target, 'utf8'); }
  catch (error) { return ioFailure(target, 'reading the destination failed', error); }
  let raw: unknown;
  try { raw = JSON.parse(original); }
  catch (error) { return refusal('CONFIG_IS_JSON', target, `does not parse as JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return refusal('CONFIG_FIELD_TYPE', target, 'must hold a config JSON object');
  const duplicates = repeatedKeys(original);
  if (duplicates.length > 0) throw new PartsError(duplicates.map((r) => ({ code: 'CONFIG_KEY_UNIQUE', object: `config${r.at === '' ? '' : `.${r.at}`}`, detail: `names ${JSON.stringify(r.key)} ${r.count} times; each key must occur once before an in-place update` })));
  return { path: target, original, raw, mode: stat.mode & 0o777 };
}
/** Resolve existing ancestors too: an output parent may be an alias or not exist yet. */
function canonical(path: string): string {
  let at = resolve(path);
  const tail: string[] = [];
  for (;;) {
    try { return join(realpathSync(at), ...tail); }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      const parent = dirname(at);
      if (parent === at) throw error;
      tail.unshift(basename(at));
      at = parent;
    }
  }
}
/** Refuse before ordinary propose writes any artifact that could overwrite its config. */
export function separateConfigWriteTarget(target: Pick<ConfigWriteTarget, 'path'>, artifacts: readonly string[], code = 'CONFIG_WRITE_TARGET'): void {
  try {
    let identity: ReturnType<typeof statSync> | null = null;
    try { identity = statSync(target.path); }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    const targetPath = canonical(target.path);
    for (const artifact of artifacts) {
      let alias = canonical(artifact) === targetPath;
      try {
        const existing = statSync(artifact);
        alias ||= identity !== null && existing.dev === identity.dev && existing.ino === identity.ino;
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      }
      if (alias) refusal(code, target.path, `is also the proposal output ${resolve(artifact)}; choose a config outside the command's proposal, basis and landmark artifact paths — nothing was written`);
    }
  } catch (error) {
    if (error instanceof PartsError) throw error;
    ioFailure(target.path, 'checking output collisions failed', error);
  }
}

function unchanged(target: ConfigWriteTarget): void {
  let same = false;
  try {
    const stat = lstatSync(target.path);
    same = stat.isFile() && (stat.mode & 0o777) === target.mode && readFileSync(target.path, 'utf8') === target.original;
  } catch { /* Removal is also a change, never a reason to create a new config. */ }
  if (!same) refusal('CONFIG_WRITE_CHANGED', target.path, 'changed after it was read; nothing was replaced — rerun against the current config');
}

function configWriteDoor(patch: ConfigWritePatch, receiptDoor: 'full' | 'assemble'): 'layers' | 'assemble' | 'full' {
  if (patch.kind === 'head-box') return 'layers';
  if (patch.kind === 'assemble-plan') return 'assemble';
  return patch.kind === 'edited-part-receipt' ? receiptDoor : 'full';
}

/** One file-writing adapter for all --write-config modes. Existing-file ownership
 * produces whole-value edits for splicedEdits, the engine clothConfigEdits uses.
 * Fresh cloth text already passed writtenClothConfig's splice check: it is never
 * sent through a full loader that would reject an intentional partial config.
 */
export function stageConfigWrite(target: ConfigWriteTarget | FreshConfigWrite, patch?: ConfigWritePatch, files: ConfigWriteFiles = {}, receiptDoor: 'full' | 'assemble' = 'full'): StagedConfigWrite {
  const fresh = 'kind' in target;
  const path = resolve(target.path);
  let text: string;
  let changes: readonly ConfigWriteChange[];
  let door: ReturnType<typeof configWriteDoor> | undefined;
  if (fresh) {
    text = target.text;
    changes = [];
  } else {
    if (patch === undefined) return refusal('CONFIG_FIELD_TYPE', path, 'has no config patch; a supported proposal operation is required');
    const merged = mergeConfigProposal(target.raw, patch, receiptDoor);
    const spliced = merged.changes.length === 0 ? { text: target.original, moved: null } : splicedEdits(target.original, merged.edits);
    if (spliced.moved !== null) return refusal('CONFIG_WRITE_FAILED', path, `spliced proposal values moved ${spliced.moved}; the original was not replaced`);
    text = spliced.text;
    changes = merged.changes;
    door = configWriteDoor(patch, receiptDoor);
  }
  const freshAbsent = (): void => {
    try { lstatSync(path); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      return ioFailure(path, 'checking the fresh destination failed', error);
    }
    refusal('PROPOSE_WRITE_CONFIG_FRESH', path, 'exists; the config is written to a new file, never over the --cloth config or an earlier one (unlike assemble --propose-plan and propose without --cloth, which update an existing --config in place)');
  };
  if (fresh) freshAbsent();
  const temp = join(dirname(path), `.${basename(path)}.rig-parts-${randomBytes(8).toString('hex')}.tmp`);
  let owned = false;
  const cancel = (): void => {
    if (!owned) return;
    owned = false;
    try { if (files.remove === undefined) rmSync(temp, { force: true }); else files.remove(temp); }
    catch (error) { ioFailure(temp, 'removing the staged config failed; remove this temporary after restoring directory permissions', error); }
  };
  let fd: number | undefined;
  try {
    if (fresh) mkdirSync(dirname(path), { recursive: true });
    fd = openSync(temp, 'wx', fresh ? 0o666 : target.mode);
    owned = true;
    writeFileSync(fd, text);
    if (!fresh) fchmodSync(fd, target.mode);
    closeSync(fd);
    fd = undefined;
    if (door === 'layers') loadEarlyConfig(temp, 'layers');
    else if (door === 'assemble') loadEarlyConfig(temp, 'assemble');
    else if (door === 'full') loadConfigAndAnimations(temp);
  } catch (error) {
    if (fd !== undefined) {
      try { closeSync(fd); }
      catch (cleanup) {
        const primary = error instanceof PartsError ? [...error.problems] : [ioProblem(path, 'staging the config failed', error)];
        error = new PartsError([...primary, ioProblem(temp, 'closing the staged config failed', cleanup)]);
      }
    }
    return failedOperation(path, 'staging the config failed; the destination was not written', error, cancel);
  }
  return {
    changes,
    cancel,
    abort(error: unknown): never {
      return failedOperation(path, 'writing proposal artifacts failed', error, cancel);
    },
    commit(): void {
      try {
        if (fresh) {
          freshAbsent();
          // Linking the same-directory staged file publishes complete bytes and
          // refuses an intervening creator atomically; rename would overwrite it.
          try { (files.publish ?? linkSync)(temp, path); }
          catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'EEXIST') refusal('PROPOSE_WRITE_CONFIG_FRESH', path, 'exists; the config is written to a new file, never over the --cloth config or an earlier one (unlike assemble --propose-plan and propose without --cloth, which update an existing --config in place)');
            throw error;
          }
          cancel();
        } else {
          unchanged(target);
          if (changes.length > 0) { (files.replace ?? renameSync)(temp, path); owned = false; }
          else cancel();
        }
      } catch (error) {
        failedOperation(path, 'committing the config failed', error, cancel);
      }
    },
  };
}
/** Print to stderr so proposal JSON on stdout remains machine-readable. */
export function configWriteLines(target: ConfigWriteTarget, changes: readonly ConfigWriteChange[]): string[] {
  return changes.length === 0 ? [`config ${target.path}: unchanged`] : changes.map((c) => `config ${target.path}: ${c.kind} ${c.path}${c.value === undefined ? '' : ` ${c.value}`}`);
}

export interface ConfigWriteRequest { target: ConfigWriteTarget; patch: ConfigWritePatch; receiptDoor?: 'full' | 'assemble' }
export interface StagedConfigWriteBatch {
  writes: ReadonlyArray<{ target: ConfigWriteTarget; changes: readonly ConfigWriteChange[] }>;
  commit(): void;
  cancel(): void;
}
/** Existing configs only: every candidate stages through stageConfigWrite before
 * any destination commits. A later commit failure restores earlier originals.
 * Backups whose restoration fails are retained and named, never deleted.
 */
export function stageConfigWriteBatch(requests: readonly ConfigWriteRequest[], files: ConfigWriteFiles = {}): StagedConfigWriteBatch {
  const entries: Array<{ target: ConfigWriteTarget; staged: StagedConfigWrite; backup: string | null; committed: boolean; restoreFailed: boolean }> = [];
  const problemsOf = (error: unknown, path: string, action: string): Problem[] => error instanceof PartsError ? [...error.problems] : [ioProblem(path, action, error)];
  const cancelAll = (): Problem[] => entries.flatMap(({ target, staged }) => {
    try { staged.cancel(); return []; }
    catch (error) { return problemsOf(error, target.path, 'removing the staged config failed'); }
  });
  try {
    // Two names for one inode cannot be independent members of a write batch.
    const identities = new Set<string>();
    for (const { target } of requests) {
      const stat = statSync(target.path), identity = `${stat.dev}:${stat.ino}`;
      if (identities.has(identity)) refusal('CONFIG_WRITE_TARGET', target.path, 'names another config in the batch; distinct existing config files are required');
      identities.add(identity);
    }
    // Candidate shape refusals precede even temporary writes. The existing
    // stage loader then validates each real same-directory staged file, including
    // relative sidecars.
    for (const { target, patch, receiptDoor = 'full' } of requests) {
      const candidate = mergeConfigProposal(target.raw, patch, receiptDoor).config;
      const door = configWriteDoor(patch, receiptDoor);
      if (door === 'layers') parseEarlyConfig(candidate, 'layers');
      else if (door === 'assemble') parseEarlyConfig(candidate, 'assemble');
      else parseConfig(candidate);
    }
    for (const { target, patch, receiptDoor } of requests) entries.push({ target, staged: stageConfigWrite(target, patch, files, receiptDoor), backup: null, committed: false, restoreFailed: false });
  } catch (error) {
    throw new PartsError([...problemsOf(error, 'config batch', 'staging configs failed'), ...cancelAll()]);
  }
  return {
    writes: entries.map(({ target, staged }) => ({ target, changes: staged.changes })),
    cancel(): void {
      const problems = cancelAll();
      if (problems.length > 0) throw new PartsError(problems);
    },
    commit(): void {
      let problems: Problem[] = [];
      try {
        for (const entry of entries) {
          unchanged(entry.target);
          if (entry.staged.changes.length === 0) continue;
          const path = entry.target.path;
          const backup = join(dirname(path), `.${basename(path)}.rig-parts-${randomBytes(8).toString('hex')}.bak`);
          linkSync(path, backup);
          entry.backup = backup;
        }
        for (const entry of entries) {
          entry.staged.commit();
          entry.committed = entry.staged.changes.length > 0;
        }
      } catch (error) {
        problems = problemsOf(error, 'config batch', 'committing configs failed');
        for (const entry of entries.toReversed()) if (entry.committed && entry.backup !== null) {
          try { (files.restore ?? renameSync)(entry.backup, entry.target.path); entry.backup = null; entry.committed = false; }
          catch (restore) {
            entry.restoreFailed = true;
            problems.push(ioProblem(entry.target.path, `restoring original config failed; original retained at ${entry.backup}`, restore));
          }
        }
        problems.push(...cancelAll());
      }
      for (const entry of entries) if (entry.backup !== null && !entry.restoreFailed) {
        const backup = entry.backup;
        try { (files.remove ?? ((path: string) => rmSync(path, { force: true })))(backup); entry.backup = null; }
        catch (error) { problems.push(ioProblem(backup, 'removing the original-config backup failed', error)); }
      }
      if (problems.length > 0) throw new PartsError(problems);
    },
  };
}
