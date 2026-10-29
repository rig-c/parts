/**
 * Scalar input sheets for #773. This module registers authored data; it does
 * not generate geometry, infer depth, or emit motion. Core consumes the emitted
 * {image, near, zScale} on a generator (#763 owns production generators).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { type Problem, PartsError, refuseIfAny } from './errors.ts';
import { decodePngBytes } from './raster/png.ts';
import { newRaster, type Raster } from './raster/types.ts';
import type { Layer, LayerSet } from './layers.ts';

/** Far is high: round(255*clip(raw,0,1)), never crop-local normalization.
 * Source: jtydhr88/ComfyUI-See-through@98d754bf04f668647919ab750eccb0e0640faa81
 * nodes.py:261–281, 875–884, 945–952. The later ordering-median adjustment does
 * not rewrite this array. Its median is a reading, never a polarity gate.
 */
export const SEETHROUGH_DEPTH_NEAR = 'black' as const;
export type DepthNear = 'black' | 'white';
export interface DepthReading {
  orderingMedian: number | null;
  sheetMedian: number | null;
  relation: 'same' | 'opposite' | 'indeterminate';
}
export interface SourceDepthSheet {
  file: string;
  sha256: string;
  pixels: Raster;
  reading: DepthReading;
  /** Internal copy/warp provenance, set only after declared units resolve. */
  near?: DepthNear;
  zScale?: number;
  sources?: DepthSource[];
}
export interface UserDepthSheet { image: string; near: DepthNear; zScale: number }
export interface DepthRunConfig { layers?: Record<string, UserDepthSheet>; atlas?: UserDepthSheet }
export interface DepthConfig { zScale?: number; full?: DepthRunConfig; head?: DepthRunConfig }
/** Explicit caller context; never inferred from a filename or sheet presence. */
export interface DepthBinding { config: DepthConfig; run: 'full' | 'head'; base: string }
/** Legacy metadata retained without file I/O or value validation until opt-in. */
export interface DeferredDepthSource { filename: unknown; base: string }
export interface DepthSource {
  from: string;
  image: string;
  sha256: string;
  crop: [number, number, number, number];
  reading: DepthReading;
}
export interface PartDepthReference {
  image: string;
  near: DepthNear;
  zScale: number;
  sources: DepthSource[];
}
export interface RegisteredDepth {
  sheet: SourceDepthSheet;
  layer: Layer;
  near: DepthNear;
  zScale: number;
}

/** RGB-encoded gray is a sheet; a tinted preview is not. Alpha must be 255. */
export function depthSheetProblems(p: Raster, size: readonly [number, number], at: string): Problem[] {
  const out: Problem[] = [];
  if (p.width !== size[0] || p.height !== size[1]) out.push({ code: 'DEPTH_SHEET_SIZE', object: at, detail: `is ${p.width}x${p.height}; source grid ${size[0]}x${size[1]} is required — supply the sheet for this layer or declared canvas` });
  let color = 0, alpha = 0, firstColor = -1, firstAlpha = -1;
  for (let i = 0; i < p.width * p.height; i++) {
    if (p.data[i * 4] !== p.data[i * 4 + 1] || p.data[i * 4 + 1] !== p.data[i * 4 + 2]) { color++; if (firstColor < 0) firstColor = i; }
    if (p.data[i * 4 + 3] !== 255) { alpha++; if (firstAlpha < 0) firstAlpha = i; }
  }
  if (color > 0) out.push({ code: 'DEPTH_SHEET_GREYSCALE', object: at, detail: `has ${color} color pixels, first (${firstColor % p.width}, ${Math.floor(firstColor / p.width)}); R=G=B is required — provide grayscale data, not a color preview` });
  if (alpha > 0) out.push({ code: 'DEPTH_SHEET_OPAQUE', object: at, detail: `has ${alpha} nonopaque pixels, first (${firstAlpha % p.width}, ${Math.floor(firstAlpha / p.width)}); alpha 255 everywhere is required — provide a fully declared opaque sheet` });
  return out;
}

/** Exact median of u8 levels on the writer's ORIGINAL art alpha>10 mask. */
export function depthReading(sheet: Raster, art: Raster, orderingMedian: number | null): DepthReading {
  const histogram = new Uint32Array(256); let n = 0;
  for (let i = 0; i < art.width * art.height; i++) if (art.data[i * 4 + 3] > 10) { histogram[sheet.data[i * 4]]++; n++; }
  let median: number | null = null;
  if (n > 0) {
    const lo = Math.floor((n - 1) / 2), hi = Math.floor(n / 2); let sum = 0, a = -1, b = -1;
    for (let v = 0; v < 256; v++) { sum += histogram[v]; if (a < 0 && sum > lo) a = v; if (sum > hi) { b = v; break; } }
    median = (a + b) / (2 * 255);
  }
  const halfLevel = 0.5 / 255;
  const same = median !== null && orderingMedian !== null && Math.abs(median - orderingMedian) <= halfLevel;
  const opposite = median !== null && orderingMedian !== null && Math.abs(1 - median - orderingMedian) <= halfLevel;
  return { orderingMedian, sheetMedian: median, relation: same === opposite ? 'indeterminate' : same ? 'same' : 'opposite' };
}

export function readSourceDepth(file: string, art: Raster, ordering: number | null): SourceDepthSheet {
  if (!existsSync(file)) throw new PartsError([{ code: 'DEPTH_SHEET_PRESENT', object: file, detail: 'is missing; the declared depth PNG is required — restore it or remove the declaration deliberately, not through fallback' }]);
  let bytes: Buffer; let pixels: Raster;
  try { bytes = readFileSync(file); pixels = decodePngBytes(bytes, file); } catch (e) { throw new PartsError([{ code: 'DEPTH_SHEET_DECODES', object: file, detail: `is not a readable PNG: ${(e as Error).message}; supply the declared grayscale PNG` }]); }
  refuseIfAny(depthSheetProblems(pixels, [art.width, art.height], file));
  return { file: basename(file), sha256: createHash('sha256').update(bytes).digest('hex'), pixels, reading: depthReading(pixels, art, ordering) };
}

/** Scalar bilinear sample at pixel centres, clamp to the declared rectangular
 * source grid, then round half up to u8. No color premultiplication/normalizing.
 * This is the raw-level bilinear definition, matching Core depth.ts:127–157;
 * quantization is parts' explicit sheet-writing step, not Core's float sample.
 */
export function sampleDepthFloat(p: Raster, x: number, y: number): number {
  const fx = x - 0.5, fy = y - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
  const at = (u: number, v: number): number => p.data[(Math.max(0, Math.min(p.height - 1, v)) * p.width + Math.max(0, Math.min(p.width - 1, u))) * 4];
  return (1 - ay) * ((1 - ax) * at(ix, iy) + ax * at(ix + 1, iy)) + ay * ((1 - ax) * at(ix, iy + 1) + ax * at(ix + 1, iy + 1));
}

export function sampleDepthLevel(p: Raster, x: number, y: number): number { return Math.floor(sampleDepthFloat(p, x, y) + 0.5); }

/** Strict optional part reference; only the first three fields go to Core. */
export function partDepthProblems(raw: unknown, at: string): Problem[] {
  const out: Problem[] = []; const fail = (field: string, detail: string): void => { out.push({ code: 'PARTS_DEPTH_REFERENCE', object: `${at}.${field}`, detail }); };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { fail('depth', 'is not an object; image, near, zScale and sources are required'); return out; }
  const d = raw as Record<string, unknown>;
  for (const k of Object.keys(d)) if (!['image', 'near', 'zScale', 'sources'].includes(k)) fail(k, 'is unknown; image, near, zScale and sources are the only reference fields');
  if (typeof d.image !== 'string' || !/^[^/\\]+\.png$/.test(d.image)) fail('image', 'requires one PNG filename, relative to the sheet directory');
  if (d.near !== 'black' && d.near !== 'white') fail('near', 'requires declared black or white');
  if (typeof d.zScale !== 'number' || !Number.isFinite(d.zScale) || d.zScale <= 0) fail('zScale', 'requires positive finite authored world units');
  if (!Array.isArray(d.sources) || d.sources.length === 0) fail('sources', 'requires at least one exact source/provenance record');
  else for (const [i, value] of d.sources.entries()) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) { fail(`sources[${i}]`, 'requires a source object'); continue; }
    const s = value as Record<string, unknown>;
    for (const k of Object.keys(s)) if (!['from', 'image', 'sha256', 'crop', 'reading'].includes(k)) fail(`sources[${i}].${k}`, 'is unknown; use the declared source fields');
    if (typeof s.from !== 'string' || !/^(full|head):.+$/.test(s.from)) fail(`sources[${i}].from`, 'requires run:layer provenance');
    if (typeof s.image !== 'string' || s.image.length === 0 || /[/\\]/.test(s.image)) fail(`sources[${i}].image`, 'requires the original source filename, without an absolute path');
    if (typeof s.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(s.sha256)) fail(`sources[${i}].sha256`, 'requires the source-file SHA256');
    if (!Array.isArray(s.crop) || s.crop.length !== 4 || !s.crop.every(Number.isInteger) || s.crop[0] < 0 || s.crop[1] < 0 || !(s.crop[2] > s.crop[0] && s.crop[3] > s.crop[1])) fail(`sources[${i}].crop`, 'requires a nonempty integer source rectangle [left,top,right,bottom]');
    const q = s.reading;
    if (typeof q !== 'object' || q === null || Array.isArray(q)) fail(`sources[${i}].reading`, 'requires orderingMedian, sheetMedian and relation');
    else {
      const v = q as Record<string, unknown>;
      if (Object.keys(v).some(k => !['orderingMedian', 'sheetMedian', 'relation'].includes(k))) fail(`sources[${i}].reading`, 'has an unknown reading field');
      for (const k of ['orderingMedian', 'sheetMedian']) if (v[k] !== null && (typeof v[k] !== 'number' || !Number.isFinite(v[k]))) fail(`sources[${i}].reading.${k}`, 'requires a finite number or explicit null');
      if (!['same', 'opposite', 'indeterminate'].includes(String(v.relation))) fail(`sources[${i}].reading.relation`, 'requires same, opposite or indeterminate; this is not a gate');
    }
  }
  return out;
}

/** Resolve sheets once per input run. Declared files never fall through. */
export function registerDepthRun(set: LayerSet, run: 'full' | 'head', cfg: DepthConfig | undefined, base: string): Map<string, RegisteredDepth> {
  const out = new Map<string, RegisteredDepth>(), problems: Problem[] = [];
  if (cfg === undefined) return out;
  for (const hidden of set.hidden) if (hidden.depthHint !== undefined) problems.push({ code: 'DEPTH_SHEET_FILENAME', object: `hidden layer "${hidden.name}" depth_filename`, detail: 'active scalar inputs require a drawn layer; remove the hidden-art depth declaration' });
  const user = cfg?.[run];
  if (user?.atlas !== undefined && user.layers !== undefined && Object.keys(user.layers).length > 0) problems.push({ code: 'DEPTH_SOURCE_AMBIGUOUS', object: `config.depth.${run}`, detail: 'declares both a canvas atlas and per-layer sheets; choose one fallback route explicitly' });
  for (const name of Object.keys(user?.layers ?? {})) if (!set.layers.some(l => l.name === name)) problems.push({ code: 'DEPTH_SOURCE_RESOLVES', object: `config.depth.${run}.layers.${name}`, detail: 'names no source layer in this run; use an exact layer name' });
  let atlas: SourceDepthSheet | null = null;
  if (user?.atlas !== undefined && (set.layers.length === 0 || set.layers.some(l => l.depthSheet?.sources === undefined || l.depthSheet.near === undefined || l.depthSheet.zScale === undefined))) {
    try { atlas = readSourceDepth(resolve(base, user.atlas.image), newRaster(set.canvas.w, set.canvas.h), null); } catch (e) { if (e instanceof PartsError) problems.push(...e.problems); else throw e; }
  }
  for (const layer of set.layers) {
    const from = `${run}:${layer.name}`, supplied = user?.layers?.[layer.name] ?? user?.atlas;
    try {
      let sheet = layer.depthSheet;
      // Copied material already bound before art operations keeps its original
      // provenance and units. Never reopen its original file on a changed grid.
      if (sheet?.sources !== undefined && sheet.near !== undefined && sheet.zScale !== undefined) {
        problems.push(...depthSheetProblems(sheet.pixels, [layer.pixels.width, layer.pixels.height], from));
        if (!Number.isFinite(sheet.zScale) || sheet.zScale <= 0) problems.push({ code: 'DEPTH_ZSCALE_REQUIRED', object: from, detail: 'bound source requires positive finite world units; restore its declared zScale' });
        if (sheet.near !== 'black' && sheet.near !== 'white') problems.push({ code: 'DEPTH_NEAR_REQUIRED', object: from, detail: 'bound source requires explicit black or white polarity; restore its declaration' });
        out.set(from, { sheet, layer, near: sheet.near, zScale: sheet.zScale });
        continue;
      }
      const hint = layer.depthHint;
      if (hint !== undefined) {
        const file = hint.filename;
        if (typeof file !== 'string' || file === '' || isAbsolute(file) || /[\\/]/.test(file) || file === '..') throw new PartsError([{ code: 'DEPTH_SHEET_FILENAME', object: `${from} depth_filename`, detail: 'active writer source requires a drawn layer plain depth PNG filename' }]);
        const paths = [join(hint.base, file), join(hint.base, 'parts', `${layer.name}_depth.png`)];
        const found = paths.filter(p => existsSync(p));
        if (found.length === 2 && !readFileSync(found[0]).equals(readFileSync(found[1]))) throw new PartsError([{ code: 'DEPTH_SHEET_UNAMBIGUOUS', object: from, detail: `${paths.join(' and ')} differ; keep one source or identical bytes` }]);
        sheet = readSourceDepth(found[0] ?? paths[0], layer.pixels, layer.depth);
      }
      if (sheet !== undefined && supplied !== undefined) throw new PartsError([{ code: 'DEPTH_SOURCE_AMBIGUOUS', object: from, detail: 'has both depth_filename and a user declaration; the writer file is authoritative — remove the unused fallback for this layer' }]);
      let near: DepthNear = sheet?.near ?? SEETHROUGH_DEPTH_NEAR, zScale = sheet?.zScale ?? cfg?.zScale;
      if (sheet === undefined && supplied !== undefined) {
        near = supplied.near; zScale = supplied.zScale;
        if (user?.layers?.[layer.name] !== undefined) sheet = readSourceDepth(resolve(base, supplied.image), layer.pixels, layer.depth);
        else if (atlas !== null) {
          const p = newRaster(layer.pixels.width, layer.pixels.height);
          for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) p.data.set(atlas.pixels.data.subarray(((y + layer.top) * atlas.pixels.width + x + layer.left) * 4, ((y + layer.top) * atlas.pixels.width + x + layer.left) * 4 + 4), (y * p.width + x) * 4);
          sheet = { ...atlas, pixels: p, reading: depthReading(p, layer.pixels, layer.depth) };
        }
      }
      if (sheet === undefined) continue;
      if (zScale === undefined || !Number.isFinite(zScale) || zScale <= 0) throw new PartsError([{ code: 'DEPTH_ZSCALE_REQUIRED', object: from, detail: 'has a depth image but no positive finite config.depth.zScale; declare world units, never derive scale from eight bits' }]);
      out.set(from, { sheet, layer, near, zScale });
    } catch (e) { if (e instanceof PartsError) problems.push(...e.problems); else throw e; }
  }
  refuseIfAny(problems); return out;
}

export interface DepthTransport {
  map: (run: 'full' | 'head') => { sx: number; tx: number; ty: number };
  width: number;
  /** Same last-writer ownership used for the art's merge/cut provenance. */
  extend: readonly string[];
  owner: Int32Array;
  ring: Uint8Array;
  region: Uint8Array | null;
  unsupported?: string;
  copiedSource?: (x: number, y: number) => { key: string; ring: boolean } | null;
}
/** Resample on the FINAL unpadded part grid. Visible synthesized/unsupported
 * material refuses; transparent cells and later PAD4 use explicit edge clamp.
 * Registered art filtering can reach less than one source pixel beyond its
 * crop. Keep that edge texel; a visible sample >=1px outside still refuses.
 * clampedSamples counts visible samples outside the half-open crop, once per
 * output pixel even at a corner. It is a reading, not emitted provenance.
 * No geometry, art pixels, source field or calibration are changed here.
 */
export function transportPartDepth(
  part: { name: string; from: string; x: number; y: number; w: number; h: number },
  art: Raster,
  registered: ReadonlyMap<string, RegisteredDepth>,
  transport: DepthTransport,
): { reference: PartDepthReference; image: Raster; clampedSamples: number } | undefined {
  const keys = [part.from, ...transport.extend];
  const initial = keys.map(k => registered.get(k)).find((s): s is RegisteredDepth => s !== undefined);
  if (initial === undefined) return undefined;
  const fail = (detail: string): never => { throw new PartsError([{ code: 'DEPTH_PART_SUPPORT', object: `part "${part.name}"`, detail }]); };
  if (transport.unsupported !== undefined) fail(`${transport.unsupported}; an exact source-bound scalar transport is required`);
  const image = newRaster(part.w, part.h), used = new Map<string, RegisteredDepth>();
  let clampedSamples = 0;
  for (let y = 0; y < part.h; y++) for (let x = 0; x < part.w; x++) {
    const rx = part.x + x, ry = part.y + y, pos = ry * transport.width + rx;
    const visible = art.data[(y * part.w + x) * 4 + 3] > 0;
    const copied = transport.copiedSource?.(rx, ry);
    const own = transport.owner[pos], key = copied?.key ?? (own < 0 ? part.from : transport.extend[own]);
    const source = registered.get(key);
    if (visible && (source === undefined || (copied === undefined || copied === null ? transport.ring[pos] !== 0 : copied.ring) || (copied == null && transport.region?.[pos] === 0))) fail(`rig pixel (${rx},${ry}) has ${source === undefined ? `no declared sheet for ${key}` : transport.ring[pos] !== 0 ? 'a synthesized merge rim' : 'replacement under-art outside the original cut material'}; provide a source sheet/registration for this material, never a background depth`);
    const input = source ?? initial;
    if (input.near !== initial.near || input.zScale !== initial.zScale) fail(`source ${key} uses near=${input.near}, zScale=${input.zScale}; a merged sheet requires the same declared convention and units as ${initial.near}/${initial.zScale}, not implicit per-source remapping`);
    const sourceKey = source === undefined ? keys.find(k => registered.get(k) === initial) as string : key;
    const run = sourceKey.startsWith('head:') ? 'head' : 'full';
    const m = transport.map(run), px = (rx - m.tx) / m.sx - input.layer.left + 0.5, py = (ry - m.ty) / m.sx - input.layer.top + 0.5;
    if (visible && (px <= -1 || py <= -1 || px >= input.sheet.pixels.width + 1 || py >= input.sheet.pixels.height + 1)) fail(`rig pixel (${rx},${ry}) maps to source (${px},${py}) outside ${input.sheet.pixels.width}x${input.sheet.pixels.height}; source art filtering/generated material has no declared depth there`);
    if (visible && (px < 0 || py < 0 || px >= input.sheet.pixels.width || py >= input.sheet.pixels.height)) clampedSamples++;
    const level = sampleDepthLevel(input.sheet.pixels, px, py);
    image.data.set([level, level, level, 255], (y * part.w + x) * 4);
    if (visible && source !== undefined) used.set(key, source);
  }
  return { image, clampedSamples, reference: {
    image: `${part.name}_depth.png`, near: initial.near, zScale: initial.zScale,
    sources: [...new Map([...used].flatMap(([from, s]) => s.sheet.sources ?? [{ from, image: s.sheet.file, sha256: s.sheet.sha256, crop: [s.layer.left, s.layer.top, s.layer.right, s.layer.bottom] as [number, number, number, number], reading: s.sheet.reading }]).map(s => [`${s.from}:${s.sha256}`, s])).values()],
  } };
}

/** Four-pixel rig padding repeats the part sheet's edge, exactly Core's clamp
 * at the old boundary. This is not silhouette extrapolation/nearest-core fill.
 */
export function padDepthSheet(source: Raster, pad: number): Raster {
  const result = newRaster(source.width + 2 * pad, source.height + 2 * pad);
  for (let y = 0; y < result.height; y++) for (let x = 0; x < result.width; x++) {
    const v = sampleDepthLevel(source, x - pad + 0.5, y - pad + 0.5);
    result.data.set([v, v, v, 255], (y * result.width + x) * 4);
  }
  return result;
}

/**
 * Extend a part's depth sheet across its transparent and semi-transparent
 * margin from the nearest opaque texel (`alpha === 255`, falling back to
 * `alpha > 0` when a part has no fully opaque texel), before `padDepthSheet`
 * edge-clamps into the `PAD` border.
 *
 * A `grid` generator spans the part's rectangular bounding box, so any vertex
 * outside the opaque silhouette would otherwise sample the monocular estimator's
 * background cliff and fold the border triangles at small turn angles.
 *
 * Exact Euclidean nearest seed, ties broken deterministically by row-major seed
 * index. Any interior seed whose 8-neighbours are all seeds is strictly farther
 * from every non-seed texel than its step neighbour toward that texel, so
 * scanning 8-boundary seeds yields the identical minimum and tie-break as
 * scanning all seeds.
 */
export function extendDepthSilhouette(source: Raster, art: Raster): Raster {
  if (source.width !== art.width || source.height !== art.height) {
    throw new PartsError([{
      code: 'DEPTH_SILHOUETTE_SIZE_MISMATCH',
      object: 'depth silhouette extension',
      detail: `source sheet is ${source.width}x${source.height}; art is ${art.width}x${art.height}`,
    }]);
  }
  const w = source.width, h = source.height, n = w * h;
  const seedMask = new Uint8Array(n);
  let seedCount = 0;
  for (let i = 0; i < n; i++) {
    if (art.data[i * 4 + 3] === 255) {
      seedMask[i] = 1;
      seedCount++;
    }
  }
  if (seedCount === 0) {
    for (let i = 0; i < n; i++) {
      if (art.data[i * 4 + 3] > 0) {
        seedMask[i] = 1;
        seedCount++;
      }
    }
  }
  const result = newRaster(w, h);
  result.data.set(source.data);
  if (seedCount === 0 || seedCount === n) return result;

  const bx: number[] = [];
  const by: number[] = [];
  const bLevel: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (seedMask[idx] === 0) continue;
      let boundary = x === 0 || x === w - 1 || y === 0 || y === h - 1;
      if (!boundary) {
        for (let dy = -1; dy <= 1 && !boundary; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (seedMask[(y + dy) * w + (x + dx)] === 0) {
              boundary = true;
              break;
            }
          }
        }
      }
      if (boundary) {
        bx.push(x);
        by.push(y);
        bLevel.push(source.data[idx * 4]);
      }
    }
  }
  const bCount = bx.length;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (seedMask[idx] !== 0) continue;
      let bestDist = Infinity;
      let bestLevel = source.data[idx * 4];
      for (let i = 0; i < bCount; i++) {
        const dx = x - bx[i];
        const dy = y - by[i];
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) {
          bestDist = d2;
          bestLevel = bLevel[i];
        }
      }
      const off = idx * 4;
      result.data[off] = bestLevel;
      result.data[off + 1] = bestLevel;
      result.data[off + 2] = bestLevel;
      result.data[off + 3] = 255;
    }
  }
  return result;
}

/**
 * Pad a turn-bound surface part's depth sheet: extend the opaque silhouette
 * across the unpadded box first, then edge-clamp into the `pad`-pixel border.
 */
export function padTurnDepthSheet(source: Raster, art: Raster, pad: number): Raster {
  return padDepthSheet(extendDepthSilhouette(source, art), pad);
}


/** Bind units once, before the existing art operators. Their scalar copies
 * retain the ORIGINAL source rectangle/readings instead of remeasuring it.
 */
export function bindDepthRun(set: LayerSet, run: 'full' | 'head', cfg: DepthConfig | undefined, base: string): LayerSet {
  if (cfg === undefined) return set.layers.some(l => l.depthSheet !== undefined)
    ? { ...set, layers: set.layers.map(({ depthSheet: _sheet, ...layer }) => layer) }
    : set;
  const registered = registerDepthRun(set, run, cfg, base);
  if (registered.size === 0) return set;
  return { ...set, layers: set.layers.map(layer => {
    const from = `${run}:${layer.name}`, r = registered.get(from);
    return r === undefined ? layer : { ...layer, depthSheet: { ...r.sheet, near: r.near, zScale: r.zScale, sources: [{ from, image: r.sheet.file, sha256: r.sheet.sha256, crop: [layer.left, layer.top, layer.right, layer.bottom] as [number, number, number, number], reading: r.sheet.reading }] } };
  }) };
}

export interface DepthCopyTap { layer: Layer; x: number; y: number; weight: number }
/** Follow an EXISTING art copy/composite, using its actual source coordinates
 * and weights. These weights belong to the operator, not a depth fit. Scalar
 * levels are never multiplied by their own coverage alpha or renormalized.
 */
export function copyDepthMaterial(target: Layer, inputs: readonly Layer[], taps: (x: number, y: number) => DepthCopyTap[]): Layer {
  const firstLayer = inputs.find(l => l.depthSheet !== undefined);
  const first = firstLayer?.depthSheet;
  if (first === undefined || firstLayer === undefined) return target;
  const p = newRaster(target.pixels.width, target.pixels.height), sources = new Map<string, DepthSource>();
  const fail = (detail: string): never => { throw new PartsError([{ code: 'DEPTH_PART_SUPPORT', object: `layer "${target.name}"`, detail }]); };
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    const visible = target.pixels.data[(y * p.width + x) * 4 + 3] > 0;
    const samples = taps(x + target.left + 0.5, y + target.top + 0.5).filter(t => t.weight > 0);
    if (visible && samples.length === 0) fail(`source copy at (${x + target.left},${y + target.top}) has no owner; exact source material is required`);
    if (!visible) {
      // Unpainted output cells use the first available declared coordinate,
      // otherwise the first source rectangle's clamp; never a zero fill.
      const tap = samples.find(t => t.layer.depthSheet !== undefined);
      const layer = tap?.layer ?? firstLayer, sheet = layer.depthSheet as SourceDepthSheet;
      const v = sampleDepthLevel(sheet.pixels, (tap?.x ?? x + target.left + 0.5) - layer.left, (tap?.y ?? y + target.top + 0.5) - layer.top);
      p.data.set([v, v, v, 255], (y * p.width + x) * 4); continue;
    }
    let level = 0;
    for (const t of samples) {
      const sheet = t.layer.depthSheet;
      if (sheet === undefined) { if (visible) fail(`source copy from "${t.layer.name}" at (${t.x},${t.y}) has no declared sheet`); continue; }
      if (sheet.near !== first.near || sheet.zScale !== first.zScale) fail('composited sources have different declared near/units; explicit common units are required');
      const sx = t.x - t.layer.left, sy = t.y - t.layer.top;
      if (visible && (sx < 0 || sy < 0 || sx > sheet.pixels.width || sy > sheet.pixels.height)) fail(`copy from "${t.layer.name}" maps to (${sx},${sy}) outside ${sheet.pixels.width}x${sheet.pixels.height}; depth for this filtered source material is undeclared`);
      level += t.weight * sampleDepthFloat(sheet.pixels, sx, sy);
      if (visible) for (const source of sheet.sources ?? []) sources.set(`${source.from}:${source.sha256}`, source);
    }
    // No owner on a transparent cell: explicitly repeat the source grid edge.
    if (samples.length === 0) level = sampleDepthFloat(first.pixels, x + 0.5, y + 0.5);
    const v = Math.floor(level + 0.5); p.data.set([v, v, v, 255], (y * p.width + x) * 4);
  }
  return { ...target, depthSheet: { ...first, pixels: p, sources: [...sources.values()] } };
}
