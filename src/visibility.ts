/** Visibility on the native crops of a See-through output stack. */
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { depthSheetProblems } from './depthsheets.ts';
import { foldName, PartsError, type Problem, refuseIfAny } from './errors.ts';
import { readWrapperLayers, type Layer, type LayerSet } from './layers.ts';
import { decodePngBytes } from './raster/png.ts';
import type { Raster } from './raster/types.ts';
import { readLayerTag } from './tags.ts';

export const ALPHA_FLOOR = 128;
const DEPTH_TIE = 1;
const SPEC = 'rig-parts-visibility/1';
const MANIFEST = 'visibility.json';
const WRAPPER = 'layers.json';
const MASK_DIR = 'visibility';
const SHA256 = /^[0-9a-f]{64}$/;
export const VISIBILITY_STATE = { unrecorded: 0, visible: 1, occluded: 2, partialTop: 3, depthTie: 4 } as const;

export interface VisibilityIdentity {
  prompt_id: string;
  input_sha256: string;
  graph_sha256: string;
}
type Seal = { path: string; sha256: string };
type Pair = [number, number];
type LayerRecord = { tag: string; offset: Pair; size: Pair; image: Seal; depth: Seal; record: Seal };
export interface VisibilityManifest extends VisibilityIdentity {
  spec: typeof SPEC;
  layer_manifest: Seal;
  canvas: Pair;
  alpha_floor: typeof ALPHA_FLOOR;
  depth_tie: typeof DEPTH_TIE;
  layers: LayerRecord[];
}

type Obj = Record<string, unknown>;
type Code = 'VISIBILITY_SOURCE' | 'VISIBILITY_MANIFEST' | 'VISIBILITY_HASH';
type Crop = { layer: Layer; depth: Raster; image: Seal; sheet: Seal };
type RecordFiles = { manifest: VisibilityManifest; masks: Uint8Array[]; set: LayerSet };

/** Compare native depth levels. Smaller levels are nearer. */
export function compareVisibilityDepth(a: number, b: number): -1 | 0 | 1 {
  const gap = a - b;
  if (Math.abs(gap) <= DEPTH_TIE) return 0;
  return gap < 0 ? -1 : 1;
}

function fail(code: Code, object: string, detail: string): never {
  throw new PartsError([{ code, object, detail }]);
}

function isObject(value: unknown): value is Obj {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describe(value: unknown): string {
  return JSON.stringify(value)?.slice(0, 200) ?? 'absent';
}

function fields(value: unknown, keys: readonly string[], at: string): Obj {
  if (!isObject(value) || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) {
    fail('VISIBILITY_MANIFEST', at, `found ${describe(value)}; requires exactly the fields ${keys.join(', ')}`);
  }
  return value;
}

function match(found: unknown, expected: unknown, at: string): void {
  if (JSON.stringify(found) !== JSON.stringify(expected)) {
    fail('VISIBILITY_MANIFEST', at, `found ${describe(found)}; requires ${describe(expected)}`);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && SHA256.test(value);
}

function checkIdentity(identity: VisibilityIdentity): void {
  const prompt = identity?.prompt_id;
  if (typeof prompt !== 'string' || prompt.length === 0 || prompt.trim() !== prompt) {
    fail('VISIBILITY_SOURCE', 'prompt_id', `found ${describe(prompt)}; requires a nonempty run prompt ID without surrounding whitespace`);
  }
  for (const key of ['input_sha256', 'graph_sha256'] as const) {
    if (!isSha256(identity[key])) fail('VISIBILITY_SOURCE', key, `found ${describe(identity[key])}; requires 64 lowercase hexadecimal digits`);
  }
}

function parse(bytes: Buffer, at: string, code: Code): unknown {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch (error) {
    return fail(code, at, `requires readable JSON: ${(error as Error).message}`);
  }
}

function regularFile(path: string, optional = false): void {
  try {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat?.isFile() || (stat === undefined && optional)) return;
    throw new Error(stat === undefined ? 'file is absent' : 'path is a link or nonregular file');
  } catch (error) {
    fail('VISIBILITY_SOURCE', path, `requires a regular file: ${(error as Error).message}`);
  }
}

function readBytes(path: string): Buffer {
  regularFile(path);
  try {
    return readFileSync(path);
  } catch (error) {
    return fail('VISIBILITY_SOURCE', path, `requires readable bytes: ${(error as Error).message}`);
  }
}

function requireDirectory(dir: string): void {
  try {
    if (lstatSync(dir).isDirectory()) return;
    throw new Error('path is a link or is not a directory');
  } catch (error) {
    fail('VISIBILITY_SOURCE', dir, `requires a directory: ${(error as Error).message}`);
  }
}

function readSealed(dir: string, path: string, saved?: { value: unknown; at: string }): { bytes: Buffer; seal: Seal } {
  let declared: string | undefined;
  if (saved !== undefined) {
    const value = fields(saved.value, ['path', 'sha256'], saved.at);
    match(value.path, path, saved.at + '.path');
    if (!isSha256(value.sha256)) {
      fail('VISIBILITY_MANIFEST', saved.at + '.sha256', `found ${describe(value.sha256)}; requires 64 lowercase hexadecimal digits`);
    }
    declared = value.sha256;
  }
  const file = join(dir, path);
  const bytes = readBytes(file);
  const actual = sha256(bytes);
  if (declared !== undefined && actual !== declared) {
    fail('VISIBILITY_HASH', file, `sha256 is ${actual}; ${MANIFEST} declares ${declared}`);
  }
  return { bytes, seal: { path, sha256: actual } };
}

function plainName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('.') && !/[\\/\x00]/.test(value);
}

/** Preflight paths the wrapper reader can open. Index drawn layers in raw
 * manifest order, since wrapper draw order uses depth medians. */
function sourceNames(dir: string, bytes: Buffer): string[] {
  const source = join(dir, WRAPPER);
  const raw = parse(bytes, source, 'VISIBILITY_SOURCE');
  if (!isObject(raw) || !Array.isArray(raw.layers)) fail('VISIBILITY_SOURCE', source, 'requires a wrapper layers array');
  const names: string[] = [];
  const artPaths = new Set<string>();
  for (const [i, row] of raw.layers.entries()) {
    const at = `${source} layers[${i}]`;
    if (!isObject(row) || !plainName(row.name) || !plainName(row.filename)) {
      fail('VISIBILITY_SOURCE', at, `found ${describe(row)}; requires a layer name and a plain wrapper filename`);
    }
    regularFile(join(dir, row.filename), true);
    const art = row.name + '.png';
    if (artPaths.has(foldName(art))) fail('VISIBILITY_SOURCE', at, `staged art filename ${describe(art)} collides with another layer`);
    artPaths.add(foldName(art));
    regularFile(join(dir, 'parts', art), true);
    if (readLayerTag(row.name) !== null) names.push(row.name);
  }
  for (const name of names) {
    const depth = `${name}_depth.png`;
    if (artPaths.has(foldName(depth))) fail('VISIBILITY_SOURCE', source, `staged depth filename ${describe(depth)} collides with staged art`);
  }
  return names;
}

function readWrapper(dir: string, sealed: ReadonlyMap<string, Buffer>): ReturnType<typeof readWrapperLayers> {
  try {
    return readWrapperLayers(dir, undefined, sealed);
  } catch (error) {
    if (error instanceof PartsError) {
      throw new PartsError(error.problems.map(problem => ({ ...problem, code: 'VISIBILITY_SOURCE' })));
    }
    return fail('VISIBILITY_SOURCE', join(dir, WRAPPER), `requires readable wrapper layers: ${(error as Error).message}`);
  }
}

function decodeDepth(bytes: Buffer, size: Pair, file: string): Raster {
  let pixels: Raster;
  try {
    pixels = decodePngBytes(bytes, file);
  } catch (error) {
    throw new PartsError([{
      code: 'DEPTH_SHEET_DECODES', object: file, detail: `requires a readable grayscale PNG: ${(error as Error).message}`,
    }]);
  }
  refuseIfAny(depthSheetProblems(pixels, size, file));
  // IHDR bit depth and color type. The decoder expands other formats to RGBA.
  if (bytes[24] !== 8 || bytes[25] === 3) {
    fail('VISIBILITY_SOURCE', file, `PNG has bit depth ${bytes[24]} and color type ${bytes[25]}; requires native 8-bit grayscale samples`);
  }
  return pixels;
}

function score(crops: readonly Crop[], [width, height]: Pair): Uint8Array[] {
  // The sentinel is beyond the highest real level even with the tie allowance.
  const absent = 255 + DEPTH_TIE + 1;
  const nearest = new Uint16Array(width * height).fill(absent);
  const second = new Uint16Array(nearest.length).fill(absent);
  const topAlpha = new Uint8Array(nearest.length);
  for (const { layer, depth } of crops) {
    const art = layer.pixels;
    for (let y = 0; y < art.height; y++) {
      for (let x = 0; x < art.width; x++) {
        const sample = (y * art.width + x) * 4;
        const alpha = art.data[sample + 3];
        if (alpha < ALPHA_FLOOR) continue;
        const cell = (y + layer.top) * width + x + layer.left;
        const level = depth.data[sample];
        // Keep exact minima because the tie relation is not transitive.
        if (level < nearest[cell]) {
          second[cell] = nearest[cell];
          nearest[cell] = level;
          topAlpha[cell] = alpha;
        } else if (level < second[cell]) {
          second[cell] = level;
        }
      }
    }
  }
  return crops.map(({ layer, depth }) => {
    const art = layer.pixels;
    const mask = new Uint8Array(art.width * art.height);
    for (let y = 0; y < art.height; y++) {
      for (let x = 0; x < art.width; x++) {
        const pixel = y * art.width + x;
        if (art.data[pixel * 4 + 3] < ALPHA_FLOOR) continue;
        const cell = (y + layer.top) * width + x + layer.left;
        if (compareVisibilityDepth(nearest[cell], second[cell]) === 0) mask[pixel] = VISIBILITY_STATE.depthTie;
        else if (topAlpha[cell] < 255) mask[pixel] = VISIBILITY_STATE.partialTop;
        else mask[pixel] = depth.data[pixel * 4] === nearest[cell] ? VISIBILITY_STATE.visible : VISIBILITY_STATE.occluded;
      }
    }
    return mask;
  });
}

function buildRecord(dir: string, identity: VisibilityIdentity, saved?: { value: unknown }): RecordFiles {
  const manifestAt = join(dir, MANIFEST);
  const { prompt_id, input_sha256, graph_sha256 } = identity;
  const run = { spec: SPEC, prompt_id, input_sha256, graph_sha256 } as const;
  const policy = { alpha_floor: ALPHA_FLOOR, depth_tie: DEPTH_TIE } as const;
  const recorded = saved === undefined ? undefined : fields(saved.value, [
    ...Object.keys(run), 'layer_manifest', 'canvas', ...Object.keys(policy), 'layers',
  ], manifestAt);
  if (recorded !== undefined) {
    for (const [key, expected] of Object.entries({ ...run, ...policy })) match(recorded[key], expected, manifestAt + '.' + key);
  }

  const wrapper = readSealed(dir, WRAPPER, recorded && { value: recorded.layer_manifest, at: manifestAt + '.layer_manifest' });
  requireDirectory(join(dir, 'parts'));
  const names = sourceNames(dir, wrapper.bytes);
  const rows = recorded?.layers;
  if (recorded !== undefined && (!Array.isArray(rows) || rows.length !== names.length)) {
    fail('VISIBILITY_MANIFEST', manifestAt + '.layers', `found ${Array.isArray(rows) ? rows.length : describe(rows)}; requires ${names.length} drawn layers`);
  }
  const sealed = new Map([[join(dir, WRAPPER), wrapper.bytes]]);
  const sourceLayers = names.map((tag, i) => {
    const at = `${manifestAt}.layers[${i}]`;
    const row = Array.isArray(rows) ? fields(rows[i], ['tag', 'offset', 'size', 'image', 'depth', 'record'], at) : undefined;
    if (row !== undefined) match(row.tag, tag, at + '.tag');
    const image = readSealed(dir, `parts/${tag}.png`, row && { value: row.image, at: at + '.image' });
    sealed.set(join(dir, image.seal.path), image.bytes);
    return { tag, at, row, image: image.seal };
  });

  const set = readWrapper(dir, sealed);
  const canvas: Pair = [set.canvas.w, set.canvas.h];
  if (recorded !== undefined) match(recorded.canvas, canvas, manifestAt + '.canvas');
  if (!canvas.every(Number.isSafeInteger) || !Number.isSafeInteger(canvas[0] * canvas[1])) {
    fail('VISIBILITY_SOURCE', set.source, `canvas ${canvas.join('x')} requires safe integer dimensions and area`);
  }

  const byName = new Map(set.layers.map(layer => [layer.name, layer]));
  const problems: Problem[] = [];
  const crops: Crop[] = [];
  for (const { tag, at, row, image } of sourceLayers) {
    try {
      const layer = byName.get(tag);
      if (layer === undefined) fail('VISIBILITY_SOURCE', set.source, `requires drawn layer ${describe(tag)} in the wrapper reader's result`);
      const size: Pair = [layer.pixels.width, layer.pixels.height];
      if (row !== undefined) {
        match(row.offset, [layer.left, layer.top], at + '.offset');
        match(row.size, size, at + '.size');
      }
      if (!plainName(layer.depthHint?.filename)) {
        fail('VISIBILITY_SOURCE', `layer ${describe(tag)} depth_filename`,
          `found ${describe(layer.depthHint?.filename)}; requires the wrapper's raw depth filename`);
      }
      const path = `parts/${tag}_depth.png`;
      const sheet = readSealed(dir, path, row && { value: row.depth, at: at + '.depth' });
      crops.push({ layer, depth: decodeDepth(sheet.bytes, size, join(dir, path)), image, sheet: sheet.seal });
    } catch (error) {
      if (!(error instanceof PartsError)) throw error;
      problems.push(...error.problems);
    }
  }
  refuseIfAny(problems);
  let masks: Uint8Array[];
  try {
    masks = score(crops, canvas);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return fail('VISIBILITY_SOURCE', set.source, `cannot allocate visibility for canvas ${canvas.join('x')}: ${error.message}`);
  }
  if (recorded !== undefined) requireDirectory(join(dir, MASK_DIR));
  const layers = crops.map(({ layer, image, sheet }, i): LayerRecord => {
    const { at, row } = sourceLayers[i];
    const path = `${MASK_DIR}/${i}.bin`;
    const expected = sha256(masks[i]);
    if (row !== undefined) {
      const { seal } = readSealed(dir, path, { value: row.record, at: at + '.record' });
      if (seal.sha256 !== expected) {
        fail('VISIBILITY_MANIFEST', join(dir, path), `sha256 ${seal.sha256} matches the declaration; scoring the bound output stack requires ${expected}`);
      }
    }
    return {
      tag: layer.name, offset: [layer.left, layer.top], size: [layer.pixels.width, layer.pixels.height],
      image, depth: sheet, record: { path, sha256: expected },
    };
  });
  return { manifest: { ...run, layer_manifest: wrapper.seal, canvas, ...policy, layers }, masks, set };
}

/** Stage into a fresh wrapper transaction directory. The manifest is written last. */
export function writeVisibilityRecord(dir: string, identity: VisibilityIdentity): VisibilityManifest {
  checkIdentity(identity);
  const { manifest, masks } = buildRecord(dir, identity);
  const file = join(dir, MANIFEST);
  const output = join(dir, MASK_DIR);
  for (const destination of [file, output]) {
    if (lstatSync(destination, { throwIfNoEntry: false }) !== undefined) {
      fail('VISIBILITY_SOURCE', destination, 'already exists; requires a fresh visibility destination');
    }
  }
  // I/O failures from here abort the caller's transaction.
  mkdirSync(output);
  for (const [i, layer] of manifest.layers.entries()) writeFileSync(join(dir, layer.record.path), masks[i], { flag: 'wx' });
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}

/** Verify the run, current source bytes, native grids and exact scored masks. */
export function readVisibilityRecord(dir: string, identity: VisibilityIdentity): VisibilityManifest;
export function readVisibilityRecord(dir: string, identity: VisibilityIdentity, includeSamples: true): RecordFiles;
export function readVisibilityRecord(
  dir: string, identity: VisibilityIdentity, includeSamples = false,
): VisibilityManifest | RecordFiles {
  checkIdentity(identity);
  const file = join(dir, MANIFEST);
  const value = parse(readBytes(file), file, 'VISIBILITY_MANIFEST');
  const result = buildRecord(dir, identity, { value });
  return includeSamples ? result : result.manifest;
}

/** The expected identity comes from the independent producer metadata. */
export function readRunVisibility(dir: string): RecordFiles | undefined {
  const path = join(dir, MANIFEST);
  if (lstatSync(path, { throwIfNoEntry: false }) === undefined) return;
  const meta = join(dir, 'meta.json');
  const value = parse(readBytes(meta), meta, 'VISIBILITY_SOURCE');
  if (!isObject(value) || Object.hasOwn(value, 'visibility_warning')) {
    fail('VISIBILITY_SOURCE', meta, 'requires producer metadata with a successful visibility record');
  }
  const { prompt_id, uploaded_image_sha256, graph_sha256 } = value;
  if (typeof prompt_id !== 'string' || prompt_id.length === 0 || prompt_id.trim() !== prompt_id ||
      !isSha256(uploaded_image_sha256) || !isSha256(graph_sha256)) {
    fail('VISIBILITY_SOURCE', meta, 'requires prompt_id and lowercase SHA-256 uploaded_image_sha256 and graph_sha256 from the producing run');
  }
  return readVisibilityRecord(dir, { prompt_id, input_sha256: uploaded_image_sha256, graph_sha256 }, true);
}
