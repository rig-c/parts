/** Receipted model masks, bound to the exact painting bytes; no pixel repair. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { PartsError } from './errors.ts';
import type { Graph } from './graphs.ts';
import { decodePngBytes, encodePngBytes } from './raster/png.ts';
import { newRaster, type Raster } from './raster/types.ts';
import { inverseSeeThroughMask, isSeeThroughTransform, prepareSeeThroughInput as prepareMatteInput, type SeeThroughTransform } from './seethrough-transform.ts';

export const MATTE_SPEC = 'rig-parts-matte-receipt/1';
export const MATTE_KEYS = ['spec', 'painting', 'model', 'params', 'graph', 'gpu', 'input_transform', 'input_sha256', 'raw_output', 'output'] as const;
export const MATTE_NODE = 'BiRefNetRMBG';
export const MATTE_MODEL = 'BiRefNet-HR-matting';
export const MATTE_MODEL_FILE = 'BiRefNet/BiRefNet-HR-matting.safetensors';
export const MATTE_GRAPH_ID = 'rig-parts/matte-BiRefNetRMBG/1';
const NODE_PARAMS = { mask_blur: 0, mask_offset: 0, invert_output: false, refine_foreground: false, background: 'Alpha', background_color: '#222222' } as const;
interface Artifact {
  path: string;
  sha256: string;
  width: number;
  height: number;
}
export interface MatteReceipt {
  spec: typeof MATTE_SPEC;
  painting: { path: string; sha256: string };
  model: { node: string; name: string; checkpoint_sha256: string; checkpoint_sha256_from: 'declared' };
  params: typeof NODE_PARAMS & { resolution: number; threshold: number; mask_rule: 'red-above-threshold'; };
  graph: { id: typeof MATTE_GRAPH_ID; api: Graph; sha256: string };
  gpu: string;
  input_transform: SeeThroughTransform | null;
  input_sha256: string;
  raw_output: Artifact;
  output: Artifact;
}
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
function fail(code: string, object: string, detail: string): never {
  throw new PartsError([{ code, object, detail }]);
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hex = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

/** Only the isolated-probe winner is admitted; an enum is not a runnable-node receipt. */
export function matteSelection(node: string | undefined, model: string | undefined): void {
  if (node !== MATTE_NODE || model !== MATTE_MODEL) fail('MATTE_MODEL', '--node / --model', `got ${JSON.stringify(node)} / ${JSON.stringify(model)}; explicitly name ${MATTE_NODE} / ${MATTE_MODEL}, the supported graph; no model is guessed`);
}
export function matteParams(resolution: number, threshold: number): MatteReceipt['params'] {
  if (!Number.isSafeInteger(resolution) || resolution < 64 || resolution > 2048 || resolution % 8 !== 0 || !Number.isInteger(threshold) || threshold < 0 || threshold > 254) {
    fail('MATTE_PARAMS', '--resolution / --threshold', `got ${resolution} / ${threshold}; resolution must be a multiple of 8 in [64,2048], threshold an integer in [0,254]`);
  }
  return { ...NODE_PARAMS, resolution, threshold, mask_rule: 'red-above-threshold' };
}
export function matteGraph(image: string, prefix: string): Graph {
  return {
    '1': { class_type: 'LoadImage', inputs: { image } },
    '2': { class_type: MATTE_NODE, inputs: { image: ['1', 0], model: MATTE_MODEL, ...NODE_PARAMS } },
    '3': { class_type: 'MaskToImage', inputs: { mask: ['2', 1] } },
    '4': { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: prefix } },
  };
}
export function matteGraphHash(graph: Graph): string { return hash(new TextEncoder().encode(JSON.stringify(graph))); }

/** Model output is grayscale and opaque. Thresholding is the sole classification. */
export function matteMask(raw: Raster, width: number, height: number, threshold: number, transform: SeeThroughTransform | null): Raster {
  if ((transform === null && (raw.width !== width || raw.height !== height)) || (transform !== null && !isSeeThroughTransform(transform, width, height, raw.width, raw.height))) {
    fail('MATTE_GRID', 'model mask / input_transform', `model grid ${raw.width}x${raw.height}, painting ${width}x${height}; an identical grid or valid recorded square transform is required`);
  }
  let inside: Uint8Array = new Uint8Array(raw.width * raw.height);
  for (let p = 0; p < inside.length; p++) {
    const i = p * 4;
    if (raw.data[i] !== raw.data[i + 1] || raw.data[i] !== raw.data[i + 2] || raw.data[i + 3] !== 255) fail('MATTE_VALUES', 'model-mask.png', `pixel ${p} is not opaque grayscale; MaskToImage output is required`);
    inside[p] = raw.data[i] > threshold ? 1 : 0;
  }
  if (transform !== null) inside = inverseSeeThroughMask(inside, transform);
  if (!inside.some(v => v === 1)) fail('MATTE_EMPTY', 'mask.png', 'has no foreground pixel after threshold and inverse mapping; a nonempty model mask is required');
  const out = newRaster(width, height);
  for (let p = 0; p < inside.length; p++) out.data.set([inside[p] * 255, inside[p] * 255, inside[p] * 255, 255], p * 4);
  return out;
}
export function assertMatteOutFree(out: string): void {
  if (existsSync(out) && (!statSync(out).isDirectory() || readdirSync(out).length !== 0)) fail('MATTE_OUT_EMPTY', out, 'is a file or nonempty directory; an absent or empty output is required');
}

/** Validate the complete receipt before trusting any cast or output file. */
function parseReceipt(value: unknown, file: string): MatteReceipt {
  if (!record(value) || Object.keys(value).join(',') !== MATTE_KEYS.join(',') || value.spec !== MATTE_SPEC ||
      !record(value.painting) || typeof value.painting.path !== 'string' || value.painting.path === '' || !hex(value.painting.sha256) ||
      !record(value.model) || value.model.node !== MATTE_NODE || value.model.name !== MATTE_MODEL || !hex(value.model.checkpoint_sha256) || value.model.checkpoint_sha256_from !== 'declared' ||
      !record(value.params) || !record(value.graph) || value.graph.id !== MATTE_GRAPH_ID || !record(value.graph.api) || !hex(value.graph.sha256) ||
      typeof value.gpu !== 'string' || value.gpu === '' || !hex(value.input_sha256)) {
    fail('MATTE_RECEIPT', file, `requires the complete ordered ${MATTE_SPEC} receipt, painting, model, declared checkpoint hash, params, graph and GPU; legacy or unbound masks are refused`);
  }
  const params = matteParams(value.params.resolution as number, value.params.threshold as number);
  if (JSON.stringify(value.params) !== JSON.stringify(params)) fail('MATTE_RECEIPT', file, 'params differ from the fixed node graph and recorded threshold rule; re-run comfy matte');
  for (const [field, expected] of [['raw_output', 'model-mask.png'], ['output', 'mask.png']] as const) {
    const a = value[field];
    if (!record(a) || a.path !== expected || !hex(a.sha256) || !Number.isSafeInteger(a.width) || !Number.isSafeInteger(a.height) || (a.width as number) <= 0 || (a.height as number) <= 0) fail('MATTE_RECEIPT', file, `${field} requires fixed path ${expected}, lowercase sha256 and positive integer dimensions`);
  }
  const api = value.graph.api;
  if (!record(api['1']) || !record(api['1'].inputs) || typeof api['1'].inputs.image !== 'string' ||
      !record(api['4']) || !record(api['4'].inputs) || typeof api['4'].inputs.filename_prefix !== 'string' ||
      JSON.stringify(api) !== JSON.stringify(matteGraph(api['1'].inputs.image, api['4'].inputs.filename_prefix)) ||
      value.graph.sha256 !== matteGraphHash(api as Graph)) fail('MATTE_RECEIPT', file, 'submitted graph or its sha256 differs from the versioned matte graph');
  return value as unknown as MatteReceipt;
}

/** Bind supplied painting bytes, both saved masks, geometry and the exact derivation. */
export function readMatteSource(dir: string, paintingBytes: Uint8Array | undefined, width: number, height: number): Raster {
  const file = join(dir, 'receipt.json');
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, 'utf8')); }
  catch { return fail('MATTE_RECEIPT', file, 'cannot read a JSON receipt; re-run comfy matte on the painting'); }
  const r = parseReceipt(value, file);
  if (paintingBytes === undefined || hash(paintingBytes) !== r.painting.sha256) fail('MATTE_PAINTING', file, `supplied painting sha256 ${paintingBytes === undefined ? 'absent' : hash(paintingBytes)} differs from recorded ${r.painting.sha256}; use the painting this matte run read`);
  const source = decodePngBytes(paintingBytes, 'painting');
  if (source.width !== width || source.height !== height) fail('MATTE_GRID', file, `supplied painting decodes as ${source.width}x${source.height}, requested ${width}x${height}; identical dimensions are required`);
  const artifacts: Raster[] = [];
  for (const a of [r.raw_output, r.output]) {
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(readFileSync(join(dir, a.path))); }
    catch { return fail('MATTE_HASH', a.path, 'recorded mask file is absent; re-run comfy matte'); }
    if (hash(bytes) !== a.sha256) fail('MATTE_HASH', a.path, `file sha256 ${hash(bytes)} differs from recorded ${a.sha256}; re-run comfy matte`);
    const raster = decodePngBytes(bytes, a.path);
    if (raster.width !== a.width || raster.height !== a.height) fail('MATTE_GRID', a.path, `decoded ${raster.width}x${raster.height} differs from recorded ${a.width}x${a.height}`);
    artifacts.push(raster);
  }
  // Recreate preparation, including its square fast path, using the recorded resolution.
  const prepared = prepareMatteInput(source, r.params.resolution);
  const inputBytes = prepared.transform === undefined ? paintingBytes : encodePngBytes(prepared.image);
  if (hash(inputBytes) !== r.input_sha256 || JSON.stringify(prepared.transform ?? null) !== JSON.stringify(r.input_transform)) fail('MATTE_GRID', file, 'recorded input hash or transform differs from preparation of the bound painting; re-run comfy matte');
  if (artifacts[0].width !== prepared.image.width || artifacts[0].height !== prepared.image.height) fail('MATTE_GRID', 'model-mask.png', `requires prepared input grid ${prepared.image.width}x${prepared.image.height}; got ${artifacts[0].width}x${artifacts[0].height}`);
  const expected = matteMask(artifacts[0], width, height, r.params.threshold, r.input_transform);
  const final = artifacts[1];
  if (final.width !== width || final.height !== height || !expected.data.every((v, i) => v === final.data[i])) fail('MATTE_VALUES', 'mask.png', 'differs from the recorded raw-mask threshold and inverse mapping; no pixel repair is accepted');
  return final;
}

/** Stage, verify against frozen input bytes, then publish without replacing prior output. */
export function publishMatte(out: string, paintingPath: string, paintingBytes: Uint8Array, rawBytes: Uint8Array, receipt: Omit<MatteReceipt, 'spec' | 'painting' | 'raw_output' | 'output'>): MatteReceipt {
  assertMatteOutFree(out);
  const painting = decodePngBytes(paintingBytes, paintingPath);
  const raw = decodePngBytes(rawBytes, 'model-mask.png');
  const mask = matteMask(raw, painting.width, painting.height, receipt.params.threshold, receipt.input_transform);
  const maskBytes = encodePngBytes(mask);
  const parent = dirname(resolve(out));
  mkdirSync(parent, { recursive: true });
  const stage = mkdtempSync(join(parent, `.${basename(resolve(out))}.partial-`));
  try {
    const r: MatteReceipt = {
      spec: MATTE_SPEC, painting: { path: relative(resolve(out), resolve(paintingPath)).split('\\').join('/'), sha256: hash(paintingBytes) },
      ...receipt,
      raw_output: { path: 'model-mask.png', sha256: hash(rawBytes), width: raw.width, height: raw.height },
      output: { path: 'mask.png', sha256: hash(maskBytes), width: mask.width, height: mask.height },
    };
    writeFileSync(join(stage, 'model-mask.png'), rawBytes);
    writeFileSync(join(stage, 'mask.png'), maskBytes);
    writeFileSync(join(stage, 'receipt.json'), `${JSON.stringify(r, null, 2)}\n`);
    readMatteSource(stage, paintingBytes, painting.width, painting.height);
    assertMatteOutFree(out);
    try {
      if (existsSync(out)) rmdirSync(out);
      renameSync(stage, out);
    } catch (error) {
      if (['ENOTEMPTY', 'EEXIST', 'ENOTDIR', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        fail('MATTE_OUT_EMPTY', out, 'became a file or nonempty directory before publication; an absent or empty output is required');
      }
      throw error;
    }
    return r;
  } finally { if (existsSync(stage)) rmSync(stage, { recursive: true, force: true }); }
}
