/** Issue #1328: record file bytes, splice one receipt, then publish checked configs. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parseConfig } from '../src/config.ts';
import type { EditedPartReceipt } from '../src/editedparts.ts';
import { receiptProducerJson } from '../src/receiptproducer.ts';
import { PartsError } from '../src/errors.ts';
import { decodePngBytes } from '../src/raster/png.ts';
import { readConfigWriteTarget, stageConfigWriteBatch, type StagedConfigWriteBatch } from './configwrite.ts';

export interface EditedPartInput {
  config: string;
  rigConfig?: string;
  part: string;
  file: string;
  from: string;
  editor?: string;
  producer?: string;
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
export interface EditedPartWriteResult { receipt: EditedPartReceipt; writes: StagedConfigWriteBatch['writes'] }

/** Prepare every replacement before even temporary files are written. No assembly or filename discovery. */
export function writeEditedPart(input: EditedPartInput): EditedPartWriteResult {
  for (const [flag, value] of [
    ['--config', input.config], ['--part', input.part], ['--file', input.file],
    ['--from', input.from],
    ...(input.editor === undefined ? [] : [['--editor', input.editor]]),
    ...(input.rigConfig === undefined ? [] : [['--rig-config', input.rigConfig]]),
  ]) if (typeof value !== 'string' || value.trim() === '') refuse('EDITED_PART_ARGUMENT', flag, 'is missing or blank; a non-empty value is required');
  if ((input.editor === undefined) === (input.producer === undefined)) {
    refuse('EDITED_PART_ARGUMENT', 'edited-part', 'requires exactly one of --producer or --editor');
  }
  const author = input.editor === undefined
    ? { producer: receiptProducerJson(input.producer!, '--producer') }
    : { editor: input.editor };
  const edited = png(input.file, '--file'), from = png(input.from, '--from');
  if (edited.width !== from.width || edited.height !== from.height) refuse('EDITED_PART_SIZE', input.part,
    `edited PNG is ${edited.width}x${edited.height}; --from PNG dimensions ${from.width}x${from.height} are required`);
  const receipt = { part: input.part, file: input.file, sha256: hash(edited.bytes), from_sha256: hash(from.bytes), ...author };
  const targets = [input.config, ...(input.rigConfig === undefined ? [] : [input.rigConfig])].map(readConfigWriteTarget);
  const receipts: EditedPartReceipt[] = [];
  const requests = targets.map(target => {
    const config = parseConfig(target.raw as Parameters<typeof parseConfig>[0]);
    const spec = config.assemble.edited_parts;
    if (spec === undefined) return refuse('EDITED_PART_BLOCK', target.path, 'has no assemble.edited_parts; declare {dir, receipts: []} before recording an edited part');
    const file = relative(resolve(dirname(target.path), spec.dir), resolve(input.file)).replaceAll('\\', '/');
    const value: EditedPartReceipt = { ...receipt, file };
    receipts.push(value);
    return { target, patch: { kind: 'edited-part-receipt' as const, receipt: value } };
  });
  const staged = stageConfigWriteBatch(requests);
  staged.commit();
  return { receipt: receipts[0], writes: staged.writes };
}
