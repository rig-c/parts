import { createHash } from 'node:crypto';
import { linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { SHA256_PATTERN } from './editreceipt.ts';
import { PartsError } from './errors.ts';
import { readBinaryMask } from './maskvalues.ts';
import { decodePngBytes } from './raster/png.ts';
import { parseReceiptProducer, receiptObject, receiptProducerJson, receiptText, type ReceiptProducer } from './receiptproducer.ts';

const SPEC = 'rig-parts-external-receipt/1';
type FileBinding = { path: string; sha256: string };
type Grid = { width: number; height: number };
type ExternalReceipt = {
  spec: typeof SPEC;
  kind: 'mask';
  file: FileBinding;
  painting: FileBinding;
  grid: Grid;
  producer: ReceiptProducer;
};

function refuse(code: string, object: string, detail: string): never {
  throw new PartsError([{ code, object, detail }]);
}

function keys(value: unknown, expected: string[]): value is Record<string, unknown> {
  return receiptObject(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

function validPath(value: unknown): value is string {
  return receiptText(value) && !value.includes('\0');
}

function binding(value: unknown): value is FileBinding {
  return keys(value, ['path', 'sha256']) && validPath(value.path) && !/^(?:\/|[A-Za-z]:)/.test(value.path) &&
    !value.path.includes('\\') && typeof value.sha256 === 'string' && SHA256_PATTERN.test(value.sha256);
}

function grid(value: unknown): value is Grid {
  return keys(value, ['width', 'height']) &&
    [value.width, value.height].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n > 0);
}

function parseReceipt(path: string): ExternalReceipt {
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8')); }
  catch { return refuse('EXTERNAL_RECEIPT_SCHEMA', path, `a readable ${SPEC} JSON file is required`); }
  if (!keys(value, ['spec', 'kind', 'file', 'painting', 'grid', 'producer']) ||
    value.spec !== SPEC || value.kind !== 'mask' || !binding(value.file) || !binding(value.painting) || !grid(value.grid)) {
    return refuse('EXTERNAL_RECEIPT_SCHEMA', path, `requires ${SPEC}, kind "mask", file and painting bindings, a measured grid and a producer`);
  }
  return { spec: SPEC, kind: 'mask', file: value.file, painting: value.painting, grid: value.grid,
    producer: parseReceiptProducer(value.producer, `${path} producer`) };
}

function readInput(path: string, role: 'file' | 'painting', expected?: string) {
  let bytes: Buffer;
  try { bytes = readFileSync(path); }
  catch { return refuse('EXTERNAL_RECEIPT_INPUT', path, `${role} is unreadable; a readable PNG is required`); }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (expected !== undefined && sha256 !== expected) {
    const code = role === 'file' ? 'EXTERNAL_RECEIPT_FILE_HASH' : 'EXTERNAL_RECEIPT_PAINTING_HASH';
    refuse(code, path, `${role} sha256 is ${sha256}; receipt requires ${expected}`);
  }
  try { return { sha256, raster: decodePngBytes(bytes, path) }; }
  catch { return refuse('EXTERNAL_RECEIPT_PNG', path, `${role} is not a decodable PNG`); }
}

function measure(file: string, painting: string, expected?: ExternalReceipt) {
  const source = readInput(painting, 'painting', expected?.painting.sha256);
  const mask = readInput(file, 'file', expected?.file.sha256);
  const { width, height } = source.raster;
  const checkGrid = (object: string, measured: Grid): void => {
    if (measured.width !== width || measured.height !== height) {
      refuse('EXTERNAL_RECEIPT_GRID', object, `is ${measured.width}x${measured.height}; painting ${painting} requires ${width}x${height}`);
    }
  };
  checkGrid(file, mask.raster);
  if (expected !== undefined) checkGrid('receipt grid', expected.grid);
  readBinaryMask(mask.raster, detail => refuse('EXTERNAL_RECEIPT_MASK_VALUES', file, detail));
  return { fileSha: mask.sha256, paintingSha: source.sha256, grid: { width, height } };
}

function publish(path: string, receipt: ExternalReceipt): void {
  let staging: string | undefined;
  try {
    staging = mkdtempSync(join(dirname(path), '.external-receipt-'));
    const staged = join(staging, 'receipt.json');
    writeFileSync(staged, JSON.stringify(receipt, null, 2) + '\n');
    linkSync(staged, path);
  } catch {
    refuse('EXTERNAL_RECEIPT_OUTPUT', path, 'could not publish the receipt; an unused path in a writable directory is required');
  } finally {
    if (staging !== undefined) rmSync(staging, { recursive: true, force: true });
  }
}

export function externalReceipt(flags: ReadonlyMap<string, string>): void {
  const verify = flags.get('--verify');
  if (verify !== undefined) {
    if (flags.size !== 1 || !validPath(verify)) {
      refuse('EXTERNAL_RECEIPT_ARGUMENT', '--verify', 'requires one receipt path and no write flags');
    }
    const path = resolve(verify);
    const receipt = parseReceipt(path);
    measure(resolve(dirname(path), receipt.file.path), resolve(dirname(path), receipt.painting.path), receipt);
    return;
  }
  if (flags.get('--kind') !== 'mask') {
    refuse('EXTERNAL_RECEIPT_ARGUMENT', '--kind', `is ${JSON.stringify(flags.get('--kind'))}; "mask" is the accepted value`);
  }
  const argument = (flag: string): string => {
    const value = flags.get(flag);
    if (!validPath(value)) return refuse('EXTERNAL_RECEIPT_ARGUMENT', flag, 'requires a nonblank value');
    return value;
  };
  const path = resolve(argument('--out'));
  const file = resolve(argument('--file'));
  const painting = resolve(argument('--painting'));
  const producer = receiptProducerJson(flags.get('--producer') ?? '', '--producer');
  const bound = (input: string, sha256: string): FileBinding => {
    const pathFromReceipt = relative(dirname(path), input).split(sep).join('/');
    const value = { path: pathFromReceipt, sha256 };
    if (!binding(value)) refuse('EXTERNAL_RECEIPT_ARGUMENT', input, 'requires a portable path relative to the receipt directory');
    return value;
  };
  const measured = measure(file, painting);
  publish(path, { spec: SPEC, kind: 'mask', file: bound(file, measured.fileSha),
    painting: bound(painting, measured.paintingSha), grid: measured.grid, producer });
}
