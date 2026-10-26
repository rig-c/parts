/** Explicit opt-in input boundary. Paths resolve beside the manifest, not cwd. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseAtlasText } from 'rig-c/src/atlas.ts';
import { decodePngBytes } from './raster/png.ts';
import { decodeDepth, depthChannel } from './raster/depth.ts';
import type { Raster } from './raster/types.ts';
import { PartsError, type Problem } from './errors.ts';
import type { DepthReport } from './depthsurface.ts';

/** Fixed pilot sample-count policy; see AUTHORING, Optional depth surface. */
export const DEPTH_DIRECT_CORE_MIN = 64;
export const DEPTH_EYE_CHECK_LABEL = 'EYE-CHECK PILOT, not shippable' as const;
export interface DepthPilot { mode: 'mixed-alpha-final-coverer'; label: typeof DEPTH_EYE_CHECK_LABEL; }

export function depthRefuse(code: string, object: string, detail: string): never {
  throw new PartsError([{ code, object, detail }]);
}
export interface DepthBinding {
  targetRgbaSha256: string;
  region: string;
  bounds: [number, number, number, number];
  mask: 'uv-alpha';
  triangles: number;
  host?: string;
}
export interface DepthManifest {
  spec: 'rig-parts-depth/2';
  source: { file: string; sha256: string; width: number; height: number; format: 'jpeg-rgb8' | 'png'; channel: 'red'; polarity: 'white-near' | 'black-near'; processed: true };
  atlas: { file: string; sha256: string; page: { file: string; sha256: string; width: number; height: number }; skeleton: { file: string; sha256: string } };
  sampling: { resampler: 'triangle-bilinear-v1'; alphaMin: number; erode: number; continuation: { kind: 'refuse' | 'nearest-core'; maxDistance: number } };
  model: { projection: 'depth-displacement'; pivotBone: string; reliefGain: number; gamma: number; yawSign: number; pitchSign: number; legacy: 'replace-managed' };
  groups: Record<string, string[]>;
  reference: { field: string; kind: 'core-median' };
  coverage: { alphaMin: number; overlaps: Array<{ subject: string; coverer: string }> };
  bindings: Record<string, DepthBinding>;
  pilot?: DepthPilot;
}
export interface DepthField { width: number; height: number; values: Float64Array; mask: Uint8Array; valid: number[]; reference: number; geometry?: { uvs: number[]; triangles: number[]; hull: number }; }
export interface PreparedDepth { manifest: DepthManifest; fields: Map<string, DepthField>; images: Map<string, Raster>; page: Raster; digest: string; report: DepthReport; }

function number(v: unknown, at: string, low = -Infinity, integer = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < low || (integer && !Number.isInteger(v))) depthRefuse('CONFIG_DEPTH_INPUT', at, `a finite ${integer ? 'integer ' : ''}number >= ${low} is required`);
  return v;
}
function text(v: unknown, at: string): string {
  if (typeof v !== 'string' || v.length === 0) depthRefuse('CONFIG_DEPTH_INPUT', at, 'a nonempty string is required');
  return v;
}
function choice(v: unknown, allowed: readonly unknown[], at: string): void {
  if (!allowed.includes(v)) depthRefuse('CONFIG_DEPTH_INPUT', at, `is ${JSON.stringify(v)}; expected ${allowed.join(', ')}`);
}
export function parseDepthManifest(raw: unknown): DepthManifest {
  const problems: Problem[] = [];
  const collect = (fn: () => void): void => { try { fn(); } catch (e) { if (e instanceof PartsError) problems.push(...e.problems); else throw e; } };
  const record = (value: unknown, at: string, required: string[], optional: string[] = [], dictionary = false): Record<string, unknown> | null => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) { problems.push({ code: 'CONFIG_DEPTH_INPUT', object: at, detail: `is ${JSON.stringify(value)}; an object is required` }); return null; }
    const o = value as Record<string, unknown>;
    for (const key of required) if (!(key in o)) problems.push({ code: key === 'mask' ? 'RIG_DEPTH_MASK_REQUIRED' : 'CONFIG_DEPTH_INPUT', object: `${at}.${key}`, detail: 'is absent and required' });
    if (!dictionary) for (const key of Object.keys(o)) if (![...required, ...optional].includes(key)) problems.push({ code: 'CONFIG_DEPTH_INPUT', object: `${at}.${key}`, detail: 'is not a known depth field' });
    return o;
  };
  const fields = (o: Record<string, unknown> | null, checks: Record<string, (v: unknown) => void>): void => { if (o) for (const [key, fn] of Object.entries(checks)) if (key in o) collect(() => fn(o[key])); };
  const digest = (v: unknown, at: string): void => { if (!/^[a-f0-9]{64}$/.test(text(v, at))) depthRefuse('CONFIG_DEPTH_INPUT', at, 'a lowercase SHA-256 is required'); };
  const positive = (v: unknown, at: string): void => { if (!(number(v, at, 0) > 0)) depthRefuse('CONFIG_DEPTH_INPUT', at, 'a positive number is required'); };
  const top = record(raw, 'depth', ['spec', 'source', 'atlas', 'sampling', 'model', 'groups', 'reference', 'coverage', 'bindings'], ['pilot']);
  fields(top, { spec: v => choice(v, ['rig-parts-depth/2'], 'depth.spec') });
  if (top && 'pilot' in top) fields(record(top.pilot, 'depth.pilot', ['mode', 'label']), { mode: v => choice(v, ['mixed-alpha-final-coverer'], 'depth.pilot.mode'), label: v => choice(v, [DEPTH_EYE_CHECK_LABEL], 'depth.pilot.label') });
  if (top && 'source' in top) {
    const at = 'depth.source', o = record(top.source, at, ['file', 'sha256', 'width', 'height', 'format', 'channel', 'polarity', 'processed']);
    fields(o, { file: v => { text(v, `${at}.file`); }, sha256: v => digest(v, `${at}.sha256`), width: v => { number(v, `${at}.width`, 1, true); }, height: v => { number(v, `${at}.height`, 1, true); }, format: v => choice(v, ['jpeg-rgb8', 'png'], `${at}.format`), channel: v => choice(v, ['red'], `${at}.channel`), polarity: v => choice(v, ['white-near', 'black-near'], `${at}.polarity`), processed: v => choice(v, [true], `${at}.processed`) });
  }
  if (top && 'atlas' in top) {
    const at = 'depth.atlas', o = record(top.atlas, at, ['file', 'sha256', 'page', 'skeleton']);
    fields(o, { file: v => { text(v, `${at}.file`); }, sha256: v => digest(v, `${at}.sha256`) });
    if (o) for (const key of ['page', 'skeleton']) if (key in o) {
      const child = record(o[key], `${at}.${key}`, key === 'page' ? ['file', 'sha256', 'width', 'height'] : ['file', 'sha256']);
      fields(child, { file: v => { text(v, `${at}.${key}.file`); }, sha256: v => digest(v, `${at}.${key}.sha256`), ...(key === 'page' ? { width: (v: unknown) => { number(v, `${at}.page.width`, 1, true); }, height: (v: unknown) => { number(v, `${at}.page.height`, 1, true); } } : {}) });
    }
  }
  if (top && 'sampling' in top) {
    const at = 'depth.sampling', o = record(top.sampling, at, ['resampler', 'alphaMin', 'erode', 'continuation']);
    fields(o, { resampler: v => choice(v, ['triangle-bilinear-v1'], `${at}.resampler`), alphaMin: v => { if (number(v, `${at}.alphaMin`, 1, true) > 255) depthRefuse('CONFIG_DEPTH_INPUT', `${at}.alphaMin`, 'at most 255 is required'); }, erode: v => { number(v, `${at}.erode`, 0, true); } });
    if (o && 'continuation' in o) fields(record(o.continuation, `${at}.continuation`, ['kind', 'maxDistance']), { kind: v => choice(v, ['refuse', 'nearest-core'], `${at}.continuation.kind`), maxDistance: v => { number(v, `${at}.continuation.maxDistance`, 0); } });
  }
  if (top && 'model' in top) {
    const at = 'depth.model', o = record(top.model, at, ['projection', 'pivotBone', 'reliefGain', 'gamma', 'yawSign', 'pitchSign', 'legacy']);
    fields(o, { projection: v => choice(v, ['depth-displacement'], `${at}.projection`), legacy: v => choice(v, ['replace-managed'], `${at}.legacy`), pivotBone: v => { text(v, `${at}.pivotBone`); }, reliefGain: v => { number(v, `${at}.reliefGain`, 0); }, gamma: v => positive(v, `${at}.gamma`), yawSign: v => choice(v, [-1, 1], `${at}.yawSign`), pitchSign: v => choice(v, [-1, 1], `${at}.pitchSign`) });
  }
  if (top && 'groups' in top) {
    const groups = record(top.groups, 'depth.groups', [], [], true);
    if (groups) for (const [name, value] of Object.entries(groups)) collect(() => { if (!Array.isArray(value) || !value.length || !value.every(v => typeof v === 'string' && v.length > 0)) depthRefuse('CONFIG_DEPTH_INPUT', `depth.groups.${name}`, 'a nonempty array of explicit bone names is required'); });
  }
  if (top && 'reference' in top) {
    const at = 'depth.reference';
    fields(record(top.reference, at, ['field', 'kind']), { field: v => { text(v, `${at}.field`); }, kind: v => choice(v, ['core-median'], `${at}.kind`) });
  }
  if (top && 'coverage' in top) {
    const at = 'depth.coverage', o = record(top.coverage, at, ['alphaMin', 'overlaps']);
    fields(o, { alphaMin: v => { if (number(v, `${at}.alphaMin`, 1, true) > 255) depthRefuse('CONFIG_DEPTH_INPUT', `${at}.alphaMin`, 'at most 255 is required'); } });
    if (o && 'overlaps' in o) {
      if (!Array.isArray(o.overlaps)) problems.push({ code: 'CONFIG_DEPTH_INPUT', object: `${at}.overlaps`, detail: 'an explicit array of covering owners is required, including an empty array when none exist' });
      else o.overlaps.forEach((v, i) => fields(record(v, `${at}.overlaps[${i}]`, ['subject', 'coverer']), { subject: v => { text(v, `${at}.overlaps[${i}].subject`); }, coverer: v => { text(v, `${at}.overlaps[${i}].coverer`); } }));
    }
  }
  if (top && 'bindings' in top) {
    const bindings = record(top.bindings, 'depth.bindings', [], [], true);
    if (bindings && Object.keys(bindings).length === 0) problems.push({ code: 'CONFIG_DEPTH_INPUT', object: 'depth.bindings', detail: 'a nonempty binding table is required' });
    if (bindings) for (const [name, value] of Object.entries(bindings)) {
      const at = `depth.bindings.${name}`, o = record(value, at, ['region', 'bounds', 'mask', 'targetRgbaSha256', 'triangles'], ['host']);
      fields(o, { region: v => { text(v, `${at}.region`); }, triangles: v => { if (number(v, `${at}.triangles`, 1, true) > 2048) depthRefuse('CONFIG_DEPTH_INPUT', `${at}.triangles`, 'at most 2048 triangles per binding are supported; no automatic escalation'); }, mask: v => choice(v, ['uv-alpha'], `${at}.mask`), targetRgbaSha256: v => digest(v, `${at}.targetRgbaSha256`), bounds: v => { if (!Array.isArray(v) || v.length !== 4) depthRefuse('CONFIG_DEPTH_INPUT', `${at}.bounds`, 'four source atlas bounds are required'); else v.forEach((n, i) => { number(n, `${at}.bounds[${i}]`, i > 1 ? 1 : 0, true); }); } });
      if (o && 'host' in o) fields(o, { host: v => { text(v, `${at}.host`); } });
    }
  }
  if (problems.length) throw new PartsError(problems);
  return raw as DepthManifest;
}

export function insideDepthTriangle(x: number, y: number, uv: readonly number[], ids: readonly number[], width: number, height: number): [number, number, number] | null {
  const [a, b, c] = ids, ax = uv[a * 2] * width, ay = uv[a * 2 + 1] * height, bx = uv[b * 2] * width, by = uv[b * 2 + 1] * height, cx = uv[c * 2] * width, cy = uv[c * 2 + 1] * height;
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(d) < 1e-12) return null;
  const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, w = 1 - u - v;
  return Math.min(u, v, w) >= -1e-7 ? [u, v, w] : null;
}

/** UV ownership is independent of the depth channel and of neighbouring art. */
export function depthOwnership(width: number, height: number, uv: readonly number[], triangles: readonly number[], alpha: Uint8Array, threshold: number, erosion: number): Uint8Array {
  const owned = new Uint8Array(width * height);
  for (let t = 0; t < triangles.length; t += 3) {
    const ids = triangles.slice(t, t + 3), xs = ids.map(i => uv[i * 2] * width), ys = ids.map(i => uv[i * 2 + 1] * height);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(height, Math.ceil(Math.max(...ys))); y++) for (let x = Math.max(0, Math.floor(Math.min(...xs))); x < Math.min(width, Math.ceil(Math.max(...xs))); x++) {
      if (alpha[y * width + x] >= threshold && insideDepthTriangle(x + 0.5, y + 0.5, uv, ids, width, height)) owned[y * width + x] = 1;
    }
  }
  if (erosion === 0) return owned;
  const core = new Uint8Array(owned.length);
  for (let y = erosion; y < height - erosion; y++) for (let x = erosion; x < width - erosion; x++) {
    let valid = true;
    for (let dy = -erosion; dy <= erosion && valid; dy++) for (let dx = -erosion; dx <= erosion; dx++) if (owned[(y + dy) * width + x + dx] === 0) { valid = false; break; }
    if (valid) core[y * width + x] = 1;
  }
  return core;
}

interface SourceGeometry { type: 'mesh' | 'region'; uvs: number[]; triangles: number[]; hull: number; }

/** Validate only the source skeleton fields this reader consumes, before access. */
export function parseDepthSource(raw: unknown, names: readonly string[]): Map<string, SourceGeometry> {
  const problems: Problem[] = [], out = new Map<string, SourceGeometry>();
  const plain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  const fail = (at: string, detail: string): void => { problems.push({ code: 'RIG_DEPTH_BINDING', object: `depth.atlas.skeleton.${at}`, detail }); };
  if (!plain(raw) || !Array.isArray(raw.skins) || raw.skins.length !== 1 || !plain(raw.skins[0]) || !plain(raw.skins[0].attachments)) fail('skins', 'one skin containing an attachments object is required');
  else {
    const attachments = raw.skins[0].attachments;
    for (const name of new Set(names)) {
      const slot = attachments[name], a = plain(slot) ? slot[name] : undefined, at = `attachments.${name}`;
      if (!plain(a)) { fail(at, 'a source attachment object is required'); continue; }
      if (a.type === undefined || a.type === 'region') { out.set(name, { type: 'region', uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 0, 2, 3], hull: 4 }); continue; }
      if (a.type !== 'mesh') { fail(`${at}.type`, `is ${JSON.stringify(a.type)}; a mesh or region is required`); continue; }
      const uv = a.uvs, tri = a.triangles;
      const validUV = Array.isArray(uv) && uv.length >= 6 && uv.length % 2 === 0 && uv.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1);
      if (!validUV) fail(`${at}.uvs`, 'finite unit UV pairs for at least three vertices are required');
      const validTri = Array.isArray(tri) && tri.length >= 3 && tri.length % 3 === 0 && tri.every(v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && (!Array.isArray(uv) || v < uv.length / 2));
      if (!validTri) fail(`${at}.triangles`, 'complete triples of finite integer indices inside the UV population are required');
      const validHull = typeof a.hull === 'number' && Number.isInteger(a.hull) && a.hull >= 3 && (!Array.isArray(uv) || a.hull <= uv.length / 2);
      if (!validHull) fail(`${at}.hull`, 'an explicit hull vertex count inside the UV population is required');
      if (validUV && validTri && validHull) out.set(name, { type: 'mesh', uvs: uv as number[], triangles: tri as number[], hull: a.hull as number });
    }
  }
  if (problems.length) throw new PartsError(problems);
  return out;
}

export function readDepthInput(path: string): PreparedDepth {
  let bytes: Buffer, rawInput: unknown;
  try { bytes = readFileSync(path); rawInput = JSON.parse(bytes.toString('utf8')) as unknown; }
  catch (error) { return depthRefuse('CONFIG_DEPTH_INPUT', path, `cannot read a JSON manifest: ${(error as Error).message}`); }
  const manifest = parseDepthManifest(rawInput), base = dirname(resolve(path));
  const read = (record: { file: string; sha256: string }): Uint8Array => {
    const at = resolve(base, record.file); let content: Buffer;
    try { content = readFileSync(at); } catch { return depthRefuse('CONFIG_DEPTH_INPUT', record.file, 'file is absent or unreadable'); }
    if (createHash('sha256').update(content).digest('hex') !== record.sha256) depthRefuse('RIG_DEPTH_BINDING', record.file, 'source digest differs from the declared SHA-256; supply the source-bound manifest');
    return content;
  };
  let source: Raster;
  const fileProblems: Problem[] = [], contents = new Map<string, Uint8Array>();
  for (const [key, record] of [['source', manifest.source], ['atlas', manifest.atlas], ['page', manifest.atlas.page], ['skeleton', manifest.atlas.skeleton]] as const) {
    try { contents.set(key, read(record)); } catch (error) { if (error instanceof PartsError) fileProblems.push(...error.problems); else throw error; }
  }
  if (fileProblems.length) throw new PartsError(fileProblems);
  const sourceBytes = contents.get('source') as Uint8Array;
  try { source = decodeDepth(sourceBytes, manifest.source.format, manifest.source.file); }
  catch (error) { return depthRefuse('CONFIG_DEPTH_INPUT', manifest.source.file, `cannot decode declared relief: ${(error as Error).message}`); }
  if (source.width !== manifest.source.width || source.height !== manifest.source.height) depthRefuse('RIG_DEPTH_BINDING', 'depth.source', 'decoded dimensions differ from the declared dimensions');
  const parsed = parseAtlasText(Buffer.from(contents.get('atlas') as Uint8Array).toString('utf8'));
  let page: Raster;
  try { page = decodePngBytes(contents.get('page') as Uint8Array, manifest.atlas.page.file); }
  catch (error) { return depthRefuse('RIG_DEPTH_BINDING', 'depth.atlas.page', `cannot decode pinned art: ${(error as Error).message}`); }
  if (parsed.pages.length !== 1 || parsed.pages[0].width !== page.width || parsed.pages[0].height !== page.height || page.width !== manifest.atlas.page.width || page.height !== manifest.atlas.page.height) depthRefuse('RIG_DEPTH_BINDING', 'depth.atlas', 'one matching page with explicit dimensions is required');
  let raw: unknown;
  try { raw = JSON.parse(Buffer.from(contents.get('skeleton') as Uint8Array).toString('utf8')) as unknown; }
  catch (error) { return depthRefuse('RIG_DEPTH_BINDING', 'depth.atlas.skeleton', `cannot parse pinned source JSON: ${(error as Error).message}`); }
  const sourceGeometry = parseDepthSource(raw, Object.values(manifest.bindings).map(b => b.region));
  const pixels = depthChannel(source, page.width, page.height), fields = new Map<string, DepthField>(), images = new Map<string, Raster>();
  for (const [part, binding] of Object.entries(manifest.bindings)) {
    const region = parsed.pages[0].regions.find(r => r.name.trim() === binding.region);
    if (!region || region.degrees !== 0 || region.offsetX !== 0 || region.offsetY !== 0 || region.originalWidth !== region.width || region.originalHeight !== region.height) depthRefuse('RIG_DEPTH_BINDING', part, 'an existing unrotated, untrimmed source region is required');
    if ([region.x, region.y, region.width, region.height].join(',') !== binding.bounds.join(',')) depthRefuse('RIG_DEPTH_BINDING', part, 'bounds differ from the pinned atlas region; a shifted depth binding is not supported');
    const attachment = sourceGeometry.get(binding.region);
    if (!attachment) depthRefuse('RIG_DEPTH_BINDING', part, 'source skeleton has no matching attachment');
    const uv = attachment.uvs, triangles = attachment.triangles;
    const alpha = new Uint8Array(region.width * region.height), values = new Float64Array(alpha.length), rgba = new Uint8ClampedArray(alpha.length * 4);
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
      const i = y * region.width + x, j = (y + region.y) * page.width + x + region.x;
      alpha[i] = page.data[j * 4 + 3]; values[i] = pixels[j]; rgba.set(page.data.subarray(j * 4, j * 4 + 4), i * 4);
    }
    images.set(part, { width: region.width, height: region.height, data: rgba });
    if (binding.host) {
      if (!manifest.bindings[binding.host] || manifest.bindings[binding.host].host) depthRefuse('RIG_DEPTH_BINDING', part, 'shared host must name a directly sampled binding');
      continue;
    }
    const mask = depthOwnership(region.width, region.height, uv, triangles, alpha, manifest.sampling.alphaMin, manifest.sampling.erode);
    const valid: number[] = []; for (let i = 0; i < mask.length; i++) if (mask[i]) valid.push(i);
    if (valid.length < DEPTH_DIRECT_CORE_MIN) depthRefuse('RIG_DEPTH_SAMPLE_UNSUPPORTED', part, `direct eroded UV-owned opaque core has ${valid.length} texels; fixed pilot eligibility requires at least ${DEPTH_DIRECT_CORE_MIN}; declare a whole-material supported shared host or supply an eligible own field; count alone does not prove relief quality`);
    fields.set(part, { width: region.width, height: region.height, values, mask, valid, reference: 0, ...(attachment.type === 'mesh' ? { geometry: { uvs: attachment.uvs, triangles: attachment.triangles, hull: attachment.hull } } : {}) });
  }
  const primary = fields.get(manifest.reference.field);
  if (!primary) depthRefuse('RIG_DEPTH_BINDING', 'depth.reference.field', 'must name an explicitly bound direct nonempty source field');
  const values = primary.valid.map(i => primary.values[i]).sort((a, b) => a - b);
  const reference = (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2;
  for (const field of fields.values()) field.reference = reference;

  const digest = createHash('sha256').update(bytes).digest('hex');
  return { manifest, fields, images, page, digest, report: { input: digest, projection: 'depth-displacement', regions: [], coverage: [], modelSpacePoses: 0, modelSpaceFolds: 0, pending: ['surface not evaluated'], composition: 'not evaluated' } };
}

export function validateDepthTargets(input: PreparedDepth, images: ReadonlyArray<readonly [string, Raster]>): void {
  for (const [part, binding] of Object.entries(input.manifest.bindings)) {
    const image = images.find(([name]) => name === `${part}.png`)?.[1];
    if (!image || createHash('sha256').update(image.data).digest('hex') !== binding.targetRgbaSha256) depthRefuse('RIG_DEPTH_BINDING', part, 'target straight-RGBA differs from the source-bound declaration');
    if (image.width !== binding.bounds[2] || image.height !== binding.bounds[3]) depthRefuse('RIG_DEPTH_BINDING', part, 'target dimensions differ from the declared untrimmed region');
  }
}

interface DepthSearch { index: number; axis: number; left: DepthSearch | null; right: DepthSearch | null; }
// A prepared field is static. Cache only its search topology, never values or
// query answers. Equal-distance samples still select the first row/column.
const depthSearches = new WeakMap<DepthField, DepthSearch | null>();
function nearestDepth(field: DepthField, x: number, y: number): { index: number; squared: number } {
  let tree = depthSearches.get(field);
  const coordinate = (i: number, axis: number): number => axis === 0 ? i % field.width : Math.floor(i / field.width);
  if (tree === undefined) {
    const build = (ids: number[], axis: number): DepthSearch | null => { if (!ids.length) return null; ids.sort((a, b) => coordinate(a, axis) - coordinate(b, axis) || a - b); const m = Math.floor(ids.length / 2); return { index: ids[m], axis, left: build(ids.slice(0, m), 1 - axis), right: build(ids.slice(m + 1), 1 - axis) }; };
    tree = build([...field.valid], 0); depthSearches.set(field, tree);
  }
  let index = -1, squared = Infinity;
  const visit = (node: DepthSearch | null): void => { if (!node) return; const dx = coordinate(node.index, 0) - x, dy = coordinate(node.index, 1) - y, d = dx * dx + dy * dy; if (d < squared || (d === squared && (index < 0 || node.index < index))) { squared = d; index = node.index; } const delta = (node.axis === 0 ? x : y) - coordinate(node.index, node.axis); visit(delta < 0 ? node.left : node.right); if (delta * delta <= squared) visit(delta < 0 ? node.right : node.left); };
  visit(tree); return { index, squared };
}

export function sampleDepth(field: DepthField, u: number, v: number, policy: DepthManifest['sampling']['continuation']): { value: number; continued: number } {
  const x = u * field.width - 0.5, y = v * field.height - 0.5, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const samples: Array<[number, number, number]> = [[ix, iy, (1 - fx) * (1 - fy)], [ix + 1, iy, fx * (1 - fy)], [ix, iy + 1, (1 - fx) * fy], [ix + 1, iy + 1, fx * fy]];
  if (samples.every(([a, b, w]) => w === 0 || (a >= 0 && a < field.width && b >= 0 && b < field.height && field.mask[b * field.width + a] === 1))) return { value: samples.reduce((sum, [a, b, w]) => w === 0 ? sum : sum + field.values[b * field.width + a] * w, 0), continued: 0 };
  if (policy.kind === 'refuse') return depthRefuse('RIG_DEPTH_SAMPLE_UNSUPPORTED', 'depth sample', `(${u}, ${v}) is outside the valid core; declared policy refuses continuation`);
  const nearest = nearestDepth(field, x, y), best = nearest.index, distance = nearest.squared;
  if (best < 0 || Math.sqrt(distance) > policy.maxDistance) depthRefuse('RIG_DEPTH_SAMPLE_UNSUPPORTED', 'depth sample', `(${u}, ${v}) needs ${Math.sqrt(distance)} source pixels of continuation, above declared ${policy.maxDistance}`);
  return { value: field.values[best], continued: Math.sqrt(distance) };
}
