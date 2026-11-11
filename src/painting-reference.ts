/** A source-bound painting reference for an existing, immutable parts manifest. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { checkGeometry, sourceInRig, stageFields } from './assemble.ts';
import { parseEarlyConfig } from './config.ts';
import { PartsError } from './errors.ts';
import { PAINTING_IN_RIG_FILE, readParts } from './parts.ts';
import { decodePngBytes, encodePngBytes } from './raster/png.ts';

export const PAINTING_REFERENCE_SCHEMA = 'rig-parts-painting-reference/1';
export const PAINTING_REFERENCE_FILE = 'painting_in_rig.json';

export interface PaintingReference {
  schema: typeof PAINTING_REFERENCE_SCHEMA;
  manifest_sha256: string;
  path: string;
  sha256: string;
  resample: 'lanczos3-rgb-opaque';
  rig_size: [number, number];
}

export interface PaintingReferenceSeal { path: string; sha256: string }
export interface PaintingReferenceInput {
  manifest: PaintingReferenceSeal;
  source: PaintingReferenceSeal;
  config: PaintingReferenceSeal;
}

/** The caller retains this execution trace outside the inspected package. */
export interface PaintingReferenceReceipt {
  schema: 'rig-parts-painting-reference-write/1';
  inputs: PaintingReferenceInput;
  outputs: { declaration: PaintingReferenceSeal; image: PaintingReferenceSeal };
}

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function fail(code: string, object: string, detail: string): never {
  throw new PartsError([{ code, object, detail }]);
}

function portable(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/[:\\%?#\x00-\x1f]/.test(value)
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

/** The six-key public sidecar grammar. Package/PNG binding is checked by its reader. */
export function parsePaintingReference(value: unknown, label = PAINTING_REFERENCE_FILE): PaintingReference {
  const keys = ['schema', 'manifest_sha256', 'path', 'sha256', 'resample', 'rig_size'];
  if (!record(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
    || value.schema !== PAINTING_REFERENCE_SCHEMA || !hex(value.manifest_sha256) || !portable(value.path)
    || !hex(value.sha256) || value.resample !== 'lanczos3-rgb-opaque' || !Array.isArray(value.rig_size)
    || value.rig_size.length !== 2
    || !Number.isSafeInteger(value.rig_size[0]) || value.rig_size[0] <= 0
    || !Number.isSafeInteger(value.rig_size[1]) || value.rig_size[1] <= 0) {
    return fail('PARTS_PAINTING_REFERENCE_SCHEMA', label, 'requires exactly schema, manifest_sha256, portable path, sha256, resample and positive safe-integer rig_size [W,H]; restore the producer declaration');
  }
  return { schema: PAINTING_REFERENCE_SCHEMA, manifest_sha256: value.manifest_sha256,
    path: value.path, sha256: value.sha256, resample: value.resample, rig_size: [value.rig_size[0], value.rig_size[1]] };
}

function readSealed(input: PaintingReferenceSeal, label: string): Buffer {
  if (!record(input) || typeof input.path !== 'string' || !input.path.trim() || !hex(input.sha256)) {
    return fail('PARTS_PAINTING_REFERENCE_INPUT', label, 'requires an explicit file path and expected lowercase SHA-256; supply the frozen input seal');
  }
  let bytes: Buffer;
  try {
    if (!fs.lstatSync(input.path).isFile()) throw new Error('requires a regular file without a symlink');
    const descriptor = fs.openSync(input.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      if (!fs.fstatSync(descriptor).isFile()) throw new Error('requires a regular file');
      bytes = fs.readFileSync(descriptor);
    } finally { fs.closeSync(descriptor); }
  } catch (error) {
    return fail('PARTS_PAINTING_REFERENCE_INPUT', input.path, `${label} is unreadable (${String(error)}); restore the sealed regular input`);
  }
  if (hash(bytes) !== input.sha256) return fail('PARTS_PAINTING_REFERENCE_HASH', input.path, `${label} differs from expected SHA-256 ${input.sha256}; restore the frozen input`);
  return bytes;
}

function readJson(bytes: Uint8Array, label: string): unknown {
  try { return JSON.parse(Buffer.from(bytes).toString('utf8')); }
  catch { return fail('PARTS_PAINTING_REFERENCE_INPUT', label, 'requires readable JSON; restore the sealed manifest or config'); }
}

/** Existing output is usable only when it is a regular file with identical bytes. */
function existingOutput(path: string, expected: Uint8Array): boolean {
  let descriptor: number | undefined;
  try {
    if (!fs.lstatSync(path).isFile()) fail('PARTS_PAINTING_REFERENCE_OUTPUT', path, 'is not a regular file; preserve it and resolve the output collision');
    descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    if (!fs.fstatSync(descriptor).isFile() || !fs.readFileSync(descriptor).equals(Buffer.from(expected))) {
      fail('PARTS_PAINTING_REFERENCE_OUTPUT', path, 'already exists with different bytes; preserve the existing file and resolve the collision before retrying');
    }
    return true;
  }
  catch (error) {
    if (error instanceof PartsError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    return fail('PARTS_PAINTING_REFERENCE_OUTPUT', path, `cannot inspect the destination (${String(error)}); restore its directory permissions`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

/** Publish complete bytes with a no-replace link, including a concurrent exact retry. */
function publishFile(staged: string, target: string, bytes: Uint8Array): void {
  try { fs.linkSync(staged, target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST' && existingOutput(target, bytes)) return;
    throw error;
  }
}

/**
 * Add the reference PNG and adjacent sidecar after validating all sealed inputs.
 * The sidecar is the commit point. An interrupted writer can leave an unreferenced
 * complete PNG; an exact retry verifies it and finishes the declaration. Each
 * destination is published without replacement, so concurrent writers cannot
 * overwrite accepted files. The caller holds independent input writers frozen.
 */
export function writePaintingReference(input: PaintingReferenceInput): PaintingReferenceReceipt {
  const manifestBytes = readSealed(input.manifest, 'manifest');
  const sourceBytes = readSealed(input.source, 'source');
  const configBytes = readSealed(input.config, 'config');
  if (basename(input.manifest.path) !== 'parts.json') {
    return fail('PARTS_PAINTING_REFERENCE_INPUT', input.manifest.path, 'requires the exact parts.json file; select the frozen parts manifest');
  }
  const directory = fs.realpathSync(dirname(resolve(input.manifest.path)));
  const manifest = readParts(input.manifest.path);
  const size = manifest.rig_size;
  if (size.length !== 2 || !size.every(n => Number.isSafeInteger(n) && n > 0)) {
    return fail('PARTS_PAINTING_REFERENCE_FRAME', input.manifest.path, 'rig_size must contain two positive safe integers; restore the recorded producer frame');
  }
  const config = parseEarlyConfig(readJson(configBytes, input.config.path), 'assemble');
  let source: ReturnType<typeof decodePngBytes>;
  try { source = decodePngBytes(sourceBytes, input.source.path); }
  catch (error) { return fail('PARTS_PAINTING_REFERENCE_INPUT', input.source.path, `source PNG cannot be decoded (${String(error)}); restore the sealed original painting`); }
  // Assemble records every run layer in ghost_px, including zero counts.
  // A resolution-square single run has this census but no padding record.
  const runKeys = Object.keys(manifest.ghost_px);
  const hasHeadRun = runKeys.some(key => key.startsWith('head:'));
  if (!runKeys.some(key => key.startsWith('full:'))) {
    return fail('PARTS_PAINTING_REFERENCE_FRAME', input.manifest.path, 'ghost_px has no full-run census to bind the run mode; restore the original producer manifest');
  }
  const pad = manifest.single_run_pad;
  if (hasHeadRun && pad !== undefined) {
    return fail('PARTS_PAINTING_REFERENCE_FRAME', input.manifest.path, 'head-run census conflicts with single_run_pad; restore the original producer manifest');
  }
  if (!hasHeadRun) {
    if (manifest.parts.some(part => part.from.startsWith('head:')) || config.assemble.plan.some(([, run]) => run === 'head')
      || (config.assemble.extend_below_crop?.length ?? 0) > 0) {
      return fail('PARTS_PAINTING_REFERENCE_FRAME', input.manifest.path, 'full-only run census conflicts with head-run part, plan or crop-extension references; supply the matching original config and manifest');
    }
    if (pad === undefined && (source.width !== config.seethrough.resolution || source.height !== config.seethrough.resolution)) {
      return fail('PARTS_PAINTING_REFERENCE_FRAME', input.manifest.path, 'single-run source is not the resolution square and has no single_run_pad; restore its recorded producer padding');
    }
    if (pad !== undefined && (pad.file_size[0] !== source.width || pad.file_size[1] !== source.height || pad.side !== config.seethrough.resolution)) {
      return fail('PARTS_PAINTING_REFERENCE_FRAME', input.manifest.path, 'single_run_pad file_size or side differs from sealed source/config; supply the original source and config');
    }
  }
  const single = hasHeadRun ? null : { w: source.width, h: source.height };
  const fields = stageFields(config, single);
  const frame = checkGeometry({ sourceW: source.width, sourceH: source.height, ...fields });
  if (frame.W !== size[0] || frame.H !== size[1] || frame.S !== manifest.scale_rig_per_source) {
    return fail('PARTS_PAINTING_REFERENCE_FRAME', input.manifest.path, `recorded ${size.join('x')} at scale ${manifest.scale_rig_per_source} differs from the sealed source/config frame ${frame.W}x${frame.H} at scale ${frame.S}; supply the original source and config`);
  }
  const imageBytes = encodePngBytes(sourceInRig(source, size[0], size[1]));
  const declaration = parsePaintingReference({ schema: PAINTING_REFERENCE_SCHEMA,
    manifest_sha256: hash(manifestBytes), path: PAINTING_IN_RIG_FILE, sha256: hash(imageBytes),
    resample: 'lanczos3-rgb-opaque', rig_size: size });
  const declarationBytes = Buffer.from(JSON.stringify(declaration, null, 2) + '\n');
  const imagePath = join(directory, PAINTING_IN_RIG_FILE);
  const declarationPath = join(directory, PAINTING_REFERENCE_FILE);
  const unchanged = (): void => {
    readSealed(input.manifest, 'manifest');
    readSealed(input.source, 'source');
    readSealed(input.config, 'config');
    if (fs.realpathSync(dirname(resolve(input.manifest.path))) !== directory) {
      fail('PARTS_PAINTING_REFERENCE_INPUT', input.manifest.path, 'manifest directory moved; restore the frozen package location');
    }
  };
  const receipt: PaintingReferenceReceipt = { schema: 'rig-parts-painting-reference-write/1',
    inputs: { manifest: { ...input.manifest }, source: { ...input.source }, config: { ...input.config } },
    outputs: { declaration: { path: declarationPath, sha256: hash(declarationBytes) }, image: { path: imagePath, sha256: hash(imageBytes) } } };
  const imageExists = existingOutput(imagePath, imageBytes);
  const declarationExists = existingOutput(declarationPath, declarationBytes);
  unchanged();
  if (imageExists && declarationExists) return receipt;
  let stage: string | undefined;
  try {
    stage = fs.mkdtempSync(join(directory, '.painting-reference-'));
    const stagedImage = join(stage, PAINTING_IN_RIG_FILE), stagedDeclaration = join(stage, PAINTING_REFERENCE_FILE);
    fs.writeFileSync(stagedImage, imageBytes, { flag: 'wx' });
    fs.writeFileSync(stagedDeclaration, declarationBytes, { flag: 'wx' });
    unchanged();
    publishFile(stagedImage, imagePath, imageBytes);
    unchanged();
    publishFile(stagedDeclaration, declarationPath, declarationBytes);
    return receipt;
  } catch (error) {
    if (error instanceof PartsError) throw error;
    return fail('PARTS_PAINTING_REFERENCE_WRITE', declarationPath, `publication failed (${String(error)}); preserve existing files and retry with the same input seals`);
  } finally {
    if (stage !== undefined) fs.rmSync(stage, { recursive: true, force: true });
  }
}
