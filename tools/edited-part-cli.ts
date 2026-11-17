/** Issue #1328: record file bytes, splice one receipt, then publish checked configs. */
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, fchmodSync, linkSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseConfig } from '../src/config.ts';
import type { EditedPartReceipt } from '../src/editedparts.ts';
import { PartsError, type Problem } from '../src/errors.ts';
import { splicedEdits } from '../src/meshdraft.ts';
import { decodePngBytes } from '../src/raster/png.ts';
import { readConfigWriteTarget, type ConfigWriteTarget } from './configwrite.ts';

export interface EditedPartInput {
  config: string;
  rigConfig?: string;
  part: string;
  file: string;
  from: string;
  editor: string;
}
function refuse(code: string, object: string, detail: string): never {
  throw new PartsError([{ code, object, detail }]);
}
function png(path: string, flag: string): { bytes: Buffer; width: number; height: number } {
  let bytes: Buffer;
  try { bytes = readFileSync(path); }
  catch { return refuse('EDITED_PART_FILE', flag, `file ${JSON.stringify(path)} is not readable; a readable PNG is required`); }
  try {
    const { width, height } = decodePngBytes(bytes, path);
    return { bytes, width, height };
  } catch {
    return refuse('EDITED_PART_PNG', flag, `file ${JSON.stringify(path)} is not a decodable PNG; a PNG is required`);
  }
}
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
interface Candidate { target: ConfigWriteTarget; text: string; receipt: EditedPartReceipt }

/** Prepare every replacement before even temporary files are written. No assembly or filename discovery. */
export function writeEditedPart(input: EditedPartInput): EditedPartReceipt {
  for (const [flag, value] of [
    ['--config', input.config], ['--part', input.part], ['--file', input.file],
    ['--from', input.from], ['--editor', input.editor],
    ...(input.rigConfig === undefined ? [] : [['--rig-config', input.rigConfig]]),
  ]) if (typeof value !== 'string' || value.trim() === '') refuse('EDITED_PART_ARGUMENT', flag, 'is missing or blank; a non-empty value is required');
  const edited = png(input.file, '--file'), from = png(input.from, '--from');
  if (edited.width !== from.width || edited.height !== from.height) refuse('EDITED_PART_SIZE', input.part,
    `edited PNG is ${edited.width}x${edited.height}; --from PNG dimensions ${from.width}x${from.height} are required`);
  const receipt = { part: input.part, file: input.file, sha256: hash(edited.bytes), from_sha256: hash(from.bytes), editor: input.editor };
  const targets = [input.config, ...(input.rigConfig === undefined ? [] : [input.rigConfig])].map(readConfigWriteTarget);
  if (targets.length === 2) {
    const a = lstatSync(targets[0].path), b = lstatSync(targets[1].path);
    if (a.dev === b.dev && a.ino === b.ino) refuse('CONFIG_WRITE_TARGET', '--rig-config', 'names the same file as --config; distinct explicit config files are required');
  }
  const candidates: Candidate[] = targets.map(target => {
    const config = parseConfig(target.raw as Parameters<typeof parseConfig>[0]);
    const spec = config.assemble.edited_parts;
    if (spec === undefined) return refuse('EDITED_PART_BLOCK', target.path, 'has no assemble.edited_parts; declare {dir, receipts: []} before recording an edited part');
    if (!config.assemble.plan.some(([part]) => part === input.part)) return refuse('ASSEMBLE_EDITED_PART_UNKNOWN', input.part, 'is not in assemble.plan; an existing plan part is required');
    const file = relative(resolve(dirname(target.path), spec.dir), resolve(input.file)).replaceAll('\\', '/');
    const value: EditedPartReceipt = { ...receipt, file };
    const found = spec.receipts.findIndex(row => row.part === input.part);
    const index = found === -1 ? spec.receipts.length : found;
    const result = splicedEdits(target.original, [{ path: ['assemble', 'edited_parts', 'receipts', index], value, insert: found === -1 }]);
    if (result.moved !== null) return refuse('CONFIG_WRITE_FAILED', target.path, `receipt splice moved ${result.moved}; the original was not replaced`);
    parseConfig(JSON.parse(result.text) as Parameters<typeof parseConfig>[0]);
    return { target, text: result.text, receipt: value };
  });
  publish(candidates);
  return candidates[0].receipt;
}

/** Stage all checked texts, retain original inodes for rollback, and check snapshots before publication. */
function publish(candidates: readonly Candidate[]): void {
  const staged: Array<{ target: ConfigWriteTarget; next: string; backup: string; backupOwned: boolean; replaced: boolean }> = [];
  let failure: unknown;
  const cleanupProblems: Problem[] = [];
  try {
    for (const { target } of candidates) {
      const stat = lstatSync(target.path);
      if (!stat.isFile() || (stat.mode & 0o777) !== target.mode || readFileSync(target.path, 'utf8') !== target.original)
        refuse('CONFIG_WRITE_CHANGED', target.path, 'changed after it was read; nothing was replaced');
    }
    for (const { target, text } of candidates) {
      const prefix = join(dirname(target.path), `.${basename(target.path)}.edited-part-${randomBytes(8).toString('hex')}`);
      const row = { target, next: prefix + '.tmp', backup: prefix + '.bak', backupOwned: false, replaced: false };
      const fd = openSync(row.next, 'wx', target.mode);
      staged.push(row);
      try { writeFileSync(fd, text); fchmodSync(fd, target.mode); }
      finally { closeSync(fd); }
      linkSync(target.path, row.backup);
      row.backupOwned = true;
    }
    for (const row of staged) {
      if (readFileSync(row.target.path, 'utf8') !== row.target.original) refuse('CONFIG_WRITE_CHANGED', row.target.path, 'changed during staging; nothing was replaced');
    }
    for (const row of staged) { renameSync(row.next, row.target.path); row.replaced = true; }
  } catch (error) {
    failure = error;
    for (const row of staged.toReversed()) if (row.replaced) {
      try { renameSync(row.backup, row.target.path); row.replaced = false; row.backupOwned = false; }
      catch { cleanupProblems.push({ code: 'CONFIG_WRITE_FAILED', object: row.target.path, detail: `rollback failed; original bytes remain at ${row.backup}` }); }
    }
  } finally {
    for (const row of staged) for (const path of [row.next, ...(!row.backupOwned || (failure !== undefined && row.replaced) ? [] : [row.backup])]) {
      try { rmSync(path, { force: true }); }
      catch { cleanupProblems.push({ code: 'CONFIG_WRITE_FAILED', object: path, detail: 'cannot remove this staged file; restore directory permissions and remove it' }); }
    }
  }
  if (failure !== undefined || cleanupProblems.length > 0) {
    const problems: Problem[] = failure instanceof PartsError ? [...failure.problems] : failure === undefined ? [] : [{
      code: 'CONFIG_WRITE_FAILED', object: 'edited-part', detail: `could not publish configs: ${failure instanceof Error ? failure.message : String(failure)}`,
    }];
    throw new PartsError([...problems, ...cleanupProblems]);
  }
}
