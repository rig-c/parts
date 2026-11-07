/**
 * Step-4 plates (issue #1183): the figure-removed background and the
 * foreground matte of a full-screen painting, each with a machine receipt.
 *
 * Everything here is pure — no clock, no randomness, no network — so the
 * purity scan covers it. The one part that drives a GPU box, the background
 * inpainting run, lives in `src/comfy/plate.ts` and carries the graphs this
 * file builds.
 *
 * 🔒 **The mask comes from a source, never a hand polygon.** Two sources are
 * read, and nothing else:
 *
 * - `seethrough:<dir>`: a See-through run in the wrapper form (`layers.json`
 *   and `parts/`), the figure being every drawn layer's alpha above
 *   `OPAQUE_ALPHA_ABOVE`, on the run's own canvas;
 * - `figure-mask:<dir>`: an assemble output whose `parts.json` declares a
 *   `scene`, the figure being the `figure_rig.png` assemble wrote beside it
 *   (opaque white inside the figure, opaque black outside).
 *
 * The mask is taken on its own grid and never fitted: a source whose grid is
 * not the painting's size is refused by name. With no source the command
 * refuses before it writes anything or reaches a box.
 *
 * The receipt (`rig-parts-plate-receipt/1`) names the painting, the mask, the
 * model, every parameter, the graph, the GPU and the output, with the sha256
 * of every file it names; `verifyPlateReceipt` reads it back against the bytes
 * on disk. Every path in it is relative to the receipt's own directory.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { sourceInRig } from './assemble.ts';
import { PartsError, type Problem } from './errors.ts';
import type { Graph } from './graphs.ts';
import { type LayerSet, OPAQUE_ALPHA_ABOVE, readWrapperLayers } from './layers.ts';
import { FIGURE_MASK_FILE, PAINTING_IN_RIG_FILE } from './parts.ts';
import { decodePngBytes, encodePngBytes } from './raster/png.ts';
import { newRaster, type Raster } from './raster/types.ts';

export const PLATE_RECEIPT_SPEC = 'rig-parts-plate-receipt/1';
export const PLATE_RECEIPT_FILE = 'receipt.json';
export const PLATE_MASK_FILE = 'mask.png';
export const PLATE_OUTPUT_FILE = 'plate.png';

/** The receipt's top-level keys, in the order they are written. */
export const PLATE_RECEIPT_KEYS = ['spec', 'mode', 'painting', 'mask', 'model', 'params', 'graph', 'gpu', 'output'] as const;

export type PlateMode = 'background' | 'foreground';
export type PlateGraph = 'lama' | 'core';
export type MaskSource = 'seethrough' | 'figure-mask';

/** The graph ids a receipt names: one per background graph, and the fixed local id of the foreground derivation. */
export const PLATE_GRAPH_IDS = {
  lama: 'rig-parts/plate-background-lama/1',
  core: 'rig-parts/plate-background-core/1',
  foreground: 'rig-parts/plate-foreground/1',
} as const;

/** The inpainting model the `lama` graph loads unless `--model` names another. */
export const LAMA_MODEL = 'big-lama.pt';
/** Square dilation radius of the figure mask before inpainting, in painting px. */
export const DEFAULT_GROW_PX = 8;

export interface PlateReceipt {
  spec: typeof PLATE_RECEIPT_SPEC;
  mode: PlateMode;
  painting: { path: string; sha256: string };
  mask: { source: MaskSource; from: string; path: string; sha256: string };
  model: { name: string; checkpoint_sha256: string; checkpoint_sha256_from: 'declared' } | null;
  params: Record<string, string | number | boolean>;
  graph: string;
  gpu: string | null;
  output: { path: string; sha256: string };
}

function fail(code: string, object: string, detail: string): never {
  throw new PartsError([{ code, object, detail }]);
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** `--checkpoint-sha256`: 64 hex characters, stored lower-case; anything else is refused by name. */
export function declaredChecksum(value: string | undefined): string {
  if (value === undefined) fail('PLATE_CHECKPOINT_SHA256', '--checkpoint-sha256', 'is absent; the sha256 of the model file the box loads, 64 hex characters, is required — the box does not report a hash, so the receipt records this declared value');
  if (!/^[0-9a-fA-F]{64}$/.test(value)) fail('PLATE_CHECKPOINT_SHA256', '--checkpoint-sha256', `is ${JSON.stringify(value)}; 64 hex characters are required`);
  return value.toLowerCase();
}

/** `--mask-from <source>:<dir>`, parsed; an absent or unknown source is refused by name. */
export function parseMaskFrom(value: string | undefined): { source: MaskSource; dir: string } {
  if (value === undefined) {
    fail('PLATE_MASK_SOURCE', '--mask-from', 'is absent; a source mask is required — seethrough:<run dir> (run `rig-parts comfy seethrough` on the painting) or figure-mask:<assemble out dir> (run `assemble` with config.scene); a hand-drawn mask is not taken');
  }
  const m = /^(seethrough|figure-mask):(.+)$/.exec(value);
  if (m === null) fail('PLATE_MASK_SOURCE', '--mask-from', `is ${JSON.stringify(value)}; seethrough:<dir> or figure-mask:<dir> is required`);
  return { source: m[1] as MaskSource, dir: m[2] };
}

/** One byte per painting pixel, 1 inside the figure. */
export interface FigureMask {
  width: number;
  height: number;
  inside: Uint8Array;
}

function maskRecord(path: string, code: string, remedy = 're-run assemble'): { record: Record<string, unknown>; bytes: Uint8Array } {
  try {
    const bytes = new Uint8Array(readFileSync(path));
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return { record: value as Record<string, unknown>, bytes };
  } catch (err) {
    fail(code, path, `cannot read a JSON object (${(err as Error).message}); ${remedy}`);
  }
  return fail(code, path, `requires a JSON object; ${remedy}`);
}

/**
 * comfy seethrough writes meta.json with image_sha256 and per-layer {path, sha256}.
 * A missing or legacy meta without hashes is refused by name, every layer file
 * readWrapperLayers read must match its recorded entry in meta.json, and the
 * supplied --painting bytes must match image_sha256.
 */
function bindSeeThroughSource(dir: string, set: LayerSet, paintingBytes: Uint8Array | undefined): void {
  const root = resolve(dir);
  const metaPath = join(root, 'meta.json');
  const { record: meta } = maskRecord(metaPath, 'PLATE_MASK_RUN', 're-run comfy seethrough');
  if (typeof meta.image_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(meta.image_sha256) || !Array.isArray(meta.layers) || meta.layers.length === 0) {
    fail('PLATE_MASK_RUN', metaPath, 'requires lowercase 64-hex image_sha256 and non-empty layers [{path, sha256}] from comfy seethrough; legacy or unstamped runs are refused — re-run comfy seethrough');
  }
  const entries = meta.layers as unknown[];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (typeof e !== 'object' || e === null || !('path' in e) || typeof e.path !== 'string' || e.path === '' ||
        !('sha256' in e) || typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) {
      fail('PLATE_MASK_RUN', metaPath, `layers[${i}] requires a relative path and lowercase 64-hex sha256; re-run comfy seethrough`);
    }
  }
  const typedEntries = entries as Array<{ path: string; sha256: string }>;
  const readFiles = [...set.layers, ...set.hidden];
  for (const layer of readFiles) {
    if (layer.file === null) {
      fail('PLATE_MASK_RUN', metaPath, `layer "${layer.name}" has no file on disk; re-run comfy seethrough`);
    }
    const key = relative(root, resolve(layer.file)).split('\\').join('/');
    const matches = typedEntries.filter((e) => e.path === key);
    const actual = sha256(new Uint8Array(readFileSync(layer.file)));
    if (matches.length !== 1 || matches[0].sha256 !== actual) {
      fail('PLATE_MASK_RUN', layer.file, `sha256 is ${actual}; ${metaPath} must record exactly one layers entry for ${JSON.stringify(key)} with that hash (found ${matches.length}, hashes ${JSON.stringify(matches.map((e) => e.sha256))}); re-run comfy seethrough`);
    }
  }
  if (typedEntries.length !== readFiles.length) {
    fail('PLATE_MASK_RUN', metaPath, `records ${typedEntries.length} layer hash(es), while layers.json has ${readFiles.length}; re-run comfy seethrough`);
  }
  if (paintingBytes === undefined) {
    fail('PLATE_MASK_PAINTING', metaPath, 'the supplied painting bytes are required to compare with meta.json image_sha256');
  }
  const actualPainting = sha256(paintingBytes);
  if (actualPainting !== meta.image_sha256) {
    fail('PLATE_MASK_PAINTING', metaPath, `records image_sha256 ${meta.image_sha256}; the supplied painting has sha256 ${actualPainting} — use the painting this comfy seethrough run read`);
  }
}

/**
 * Assemble writes run.json above rig/. A missing stamp is refused, including
 * legacy outputs: their current mask bytes cannot be tied to a completed run.
 * Bind parts.json too, so an old manifest cannot substitute another painting.
 * The config hash identifies config bytes, not painting bytes. The existing
 * painting_in_rig declaration binds those through assemble's RGB conversion.
 */
function bindFigureSource(dir: string, parts: Record<string, unknown>, partsBytes: Uint8Array, maskBytes: Uint8Array, painting: Raster | undefined): void {
  const root = dirname(resolve(dir));
  const stampPath = join(root, 'run.json');
  const { record: stamp } = maskRecord(stampPath, 'PLATE_MASK_RUN');
  if (stamp.spec !== 'rig-run/1' || stamp.command !== 'assemble' || !Array.isArray(stamp.outputs)) {
    fail('PLATE_MASK_RUN', stampPath, 'requires spec "rig-run/1", command "assemble" and outputs; re-run assemble');
  }
  const outputs = stamp.outputs as unknown[];
  const checkOutput = (path: string, bytes: Uint8Array): void => {
    const key = relative(root, path).split('\\').join('/');
    const entries = outputs.filter((entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null && 'path' in entry && entry.path === key);
    const actual = sha256(bytes);
    if (entries.length !== 1 || entries[0].sha256 !== actual) {
      fail('PLATE_MASK_RUN', path, `sha256 is ${actual}; ${stampPath} must record exactly one outputs entry for ${JSON.stringify(key)} with that hash (found ${entries.length}, hashes ${JSON.stringify(entries.map(e => e.sha256))}); re-run assemble`);
    }
  };
  checkOutput(join(dir, FIGURE_MASK_FILE), maskBytes);
  checkOutput(join(dir, 'parts.json'), partsBytes);
  // Legacy manifests may omit this additive declaration. When recorded, it
  // must bind the supplied painting before either plate mode writes or connects.
  if (parts.painting_in_rig === undefined) return;
  const declared = parts.painting_in_rig;
  if (typeof declared !== 'object' || declared === null || !('path' in declared) || declared.path !== PAINTING_IN_RIG_FILE ||
      !('sha256' in declared) || typeof declared.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(declared.sha256) ||
      !('resample' in declared) || declared.resample !== 'lanczos3-rgb-opaque') {
    fail('PLATE_MASK_PAINTING', join(dir, 'parts.json'), 'painting_in_rig requires path "painting_in_rig.png", lowercase 64-hex sha256 and resample "lanczos3-rgb-opaque"; re-run assemble');
  }
  const path = join(dir, PAINTING_IN_RIG_FILE);
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(readFileSync(path)); }
  catch (err) { return fail('PLATE_MASK_PAINTING', path, `cannot read declared painting (${(err as Error).message}); re-run assemble`); }
  checkOutput(path, bytes);
  const found = sha256(bytes);
  if (found !== declared.sha256) fail('PLATE_MASK_PAINTING', path, `sha256 is ${found}; parts.json records ${declared.sha256}; re-run assemble`);
  if (painting === undefined) fail('PLATE_MASK_PAINTING', path, 'the supplied painting raster is required to compare with painting_in_rig');
  let recorded: Raster;
  try { recorded = decodePngBytes(bytes, path); }
  catch (err) { return fail('PLATE_MASK_PAINTING', path, `cannot decode declared painting (${(err as Error).message}); re-run assemble`); }
  const actual = sourceInRig(painting, painting.width, painting.height);
  if (recorded.width !== actual.width || recorded.height !== actual.height || !recorded.data.every((v, i) => v === actual.data[i])) {
    fail('PLATE_MASK_PAINTING', path, `records ${recorded.width}x${recorded.height} opaque RGB (file sha256 ${declared.sha256}); the supplied painting is ${actual.width}x${actual.height} with different decoded RGB; use the painting this assemble run read`);
  }
}

/**
 * The figure mask from its source, on its own grid. Refused by name: a source
 * directory that holds no mask (the missing tool named), a grid that is not
 * `width`x`height`, a `figure_rig.png` that is not the two values assemble
 * writes, and a mask with no figure pixel.
 */
export function readSourceMask(source: MaskSource, dir: string, width: number, height: number, painting?: Raster, paintingBytes?: Uint8Array): FigureMask {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail('PLATE_MASK_SOURCE', `${source}:${dir}`, `is not a directory; ${source === 'seethrough' ? 'a See-through run directory (from `rig-parts comfy seethrough`)' : 'an assemble output directory with parts.json and figure_rig.png'} is required`);
  }
  const inside = new Uint8Array(width * height);
  if (source === 'seethrough') {
    if (!existsSync(join(dir, 'layers.json'))) fail('PLATE_MASK_SOURCE', `${source}:${dir}`, 'holds no layers.json; the figure layers of a See-through run are required — run `rig-parts comfy seethrough` on the painting first');
    const set = readWrapperLayers(dir);
    bindSeeThroughSource(dir, set, paintingBytes);
    if (set.canvas.w !== width || set.canvas.h !== height) {
      fail('PLATE_MASK_GRID', `${source}:${dir}`, `is a ${set.canvas.w}x${set.canvas.h} canvas; the painting's ${width}x${height} is required — the mask is never fitted, so run See-through on the painting at its own size`);
    }
    for (const l of set.layers) {
      const w = l.right - l.left;
      for (let y = 0; y < l.bottom - l.top; y++) {
        const cy = l.top + y;
        if (cy < 0 || cy >= height) continue;
        for (let x = 0; x < w; x++) {
          const cx = l.left + x;
          if (cx < 0 || cx >= width) continue;
          if (l.pixels.data[(y * w + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE) inside[cy * width + cx] = 1;
        }
      }
    }
  } else {
    const partsPath = join(dir, 'parts.json');
    if (!existsSync(partsPath)) fail('PLATE_MASK_SOURCE', `${source}:${dir}`, 'holds no parts.json; an assemble output with config.scene is required — run `assemble` on the painting first');
    const { record: parts, bytes: partsBytes } = maskRecord(partsPath, 'PLATE_MASK_SOURCE');
    const scene = parts.scene;
    if (typeof scene !== 'object' || scene === null || (scene as Record<string, unknown>).figure_mask !== FIGURE_MASK_FILE) {
      fail('PLATE_MASK_SOURCE', partsPath, `declares no scene figure mask; a parts.json whose scene.figure_mask is "${FIGURE_MASK_FILE}" is required — assemble writes it under config.scene`);
    }
    const maskPath = join(dir, FIGURE_MASK_FILE);
    if (!existsSync(maskPath)) fail('PLATE_MASK_SOURCE', maskPath, 'no such file; parts.json declares it, and assemble writes it beside parts.json');
    const maskBytes = new Uint8Array(readFileSync(maskPath));
    bindFigureSource(dir, parts, partsBytes, maskBytes, painting);
    const r = decodePngBytes(maskBytes, maskPath);
    if (r.width !== width || r.height !== height) {
      fail('PLATE_MASK_GRID', maskPath, `is ${r.width}x${r.height}; the painting's ${width}x${height} is required — the rig grid is not the painting's when the rig is scaled, and the mask is never fitted`);
    }
    for (let p = 0; p < width * height; p++) {
      const [R, G, B, A] = [r.data[p * 4], r.data[p * 4 + 1], r.data[p * 4 + 2], r.data[p * 4 + 3]];
      const white = R === 255 && G === 255 && B === 255, black = R === 0 && G === 0 && B === 0;
      if (A !== 255 || (!white && !black)) fail('PLATE_MASK_VALUES', maskPath, `holds (${R}, ${G}, ${B}, ${A}) at pixel ${p % width},${Math.floor(p / width)}; only opaque white and opaque black, as assemble writes it, are taken`);
      if (white) inside[p] = 1;
    }
  }
  if (!inside.some((v) => v === 1)) fail('PLATE_MASK_EMPTY', `${source}:${dir}`, 'holds no figure pixel on the painting grid; a figure to remove or matte is required');
  return { width, height, inside };
}

/** The mask grown by a square of side `2r+1` (two separable passes): a halo of the figure's outline is inpainted too. */
export function growMask(mask: FigureMask, r: number): FigureMask {
  if (r === 0) return { ...mask, inside: mask.inside.slice() };
  const { width: W, height: H } = mask;
  const rows = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let last = -Infinity;
    for (let x = 0; x < W; x++) {
      if (mask.inside[y * W + x] === 1) last = x;
      if (x - last <= r) rows[y * W + x] = 1;
    }
    last = Infinity;
    for (let x = W - 1; x >= 0; x--) {
      if (mask.inside[y * W + x] === 1) last = x;
      if (last - x <= r) rows[y * W + x] = 1;
    }
  }
  const out = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    let last = -Infinity;
    for (let y = 0; y < H; y++) {
      if (rows[y * W + x] === 1) last = y;
      if (y - last <= r) out[y * W + x] = 1;
    }
    last = Infinity;
    for (let y = H - 1; y >= 0; y--) {
      if (rows[y * W + x] === 1) last = y;
      if (last - y <= r) out[y * W + x] = 1;
    }
  }
  return { width: W, height: H, inside: out };
}

/** The mask as the PNG written beside the plate and uploaded to the box: opaque white inside, opaque black outside (LoadImageMask reads its red channel). */
export function maskImage(mask: FigureMask): Raster {
  const r = newRaster(mask.width, mask.height);
  for (let p = 0; p < mask.inside.length; p++) {
    const v = mask.inside[p] === 1 ? 255 : 0;
    r.data.set([v, v, v, 255], p * 4);
  }
  return r;
}

/**
 * The background plate: the box's pixels inside the mask (opaque), the
 * painting's own bytes outside it. The paste-back is done here, not on the
 * box, so a pixel outside the mask is the painting's byte for byte whatever
 * the box's float round trip did to it.
 */
export function pasteInside(painting: Raster, inpainted: Raster, mask: FigureMask): Raster {
  const out = newRaster(painting.width, painting.height);
  out.data.set(painting.data);
  for (let p = 0; p < mask.inside.length; p++) {
    if (mask.inside[p] !== 1) continue;
    out.data.set([inpainted.data[p * 4], inpainted.data[p * 4 + 1], inpainted.data[p * 4 + 2], 255], p * 4);
  }
  return out;
}

/** The foreground plate: the painting's own pixels inside the mask, transparent zero outside. A deterministic derivation, no model. */
export function foregroundMatte(painting: Raster, mask: FigureMask): Raster {
  const out = newRaster(painting.width, painting.height);
  for (let p = 0; p < mask.inside.length; p++) if (mask.inside[p] === 1) out.data.set(painting.data.subarray(p * 4, p * 4 + 4), p * 4);
  return out;
}

// ---------------------------------------------------------------------------
// the two background graphs
// ---------------------------------------------------------------------------

export interface LamaParams {
  seed: number;
  grow_px: number;
}

export interface CoreParams {
  seed: number;
  grow_px: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  denoise: number;
  prompt: string;
  negative: string;
}

export const CORE_DEFAULTS = { steps: 30, cfg: 6.0, sampler: 'euler_ancestral', scheduler: 'normal', denoise: 1.0, prompt: 'scenery, background, no humans', negative: 'person, figure, human, character, text, watermark' } as const;

/**
 * `lama`: LoadImage + LoadImageMask -> INPAINT_LoadInpaintModel ->
 * INPAINT_InpaintWithModel -> SaveImage (the comfyui-inpaint-nodes pack and
 * its LaMa model).
 */
export function lamaPlateGraph(painting: string, mask: string, model: string, p: LamaParams, prefix: string): Graph {
  return {
    '1': { class_type: 'LoadImage', inputs: { image: painting } },
    '2': { class_type: 'LoadImageMask', inputs: { image: mask, channel: 'red' } },
    '3': { class_type: 'INPAINT_LoadInpaintModel', inputs: { model_name: model } },
    '4': { class_type: 'INPAINT_InpaintWithModel', inputs: { inpaint_model: ['3', 0], image: ['1', 0], mask: ['2', 0], seed: p.seed } },
    '5': { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: prefix } },
  };
}

/**
 * `core`: ComfyUI's own nodes only — the checkpoint, the two text encoders,
 * InpaintModelConditioning over the painting and the mask (noise masked),
 * KSampler, VAEDecode, SaveImage. The paste-back is `pasteInside`.
 */
export function corePlateGraph(painting: string, mask: string, checkpoint: string, p: CoreParams, prefix: string): Graph {
  return {
    '1': { class_type: 'LoadImage', inputs: { image: painting } },
    '2': { class_type: 'LoadImageMask', inputs: { image: mask, channel: 'red' } },
    '3': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: p.prompt, clip: ['3', 1] } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: p.negative, clip: ['3', 1] } },
    '6': { class_type: 'InpaintModelConditioning', inputs: { positive: ['4', 0], negative: ['5', 0], vae: ['3', 2], pixels: ['1', 0], mask: ['2', 0], noise_mask: true } },
    '7': {
      class_type: 'KSampler',
      inputs: { model: ['3', 0], seed: p.seed, steps: p.steps, cfg: p.cfg, sampler_name: p.sampler, scheduler: p.scheduler, denoise: p.denoise, positive: ['6', 0], negative: ['6', 1], latent_image: ['6', 2] },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: prefix } },
  };
}

/** The `core` graph encodes through the VAE, which crops to multiples of 8; a painting off that grid is refused before anything is uploaded. */
export function coreGridProblem(width: number, height: number, painting: string): Problem | null {
  return width % 8 === 0 && height % 8 === 0 ? null : { code: 'PLATE_CORE_GRID', object: painting, detail: `is ${width}x${height}; the core graph needs both sides a multiple of 8 (the VAE crops otherwise) — use --graph lama, or a painting on that grid` };
}

// ---------------------------------------------------------------------------
// the receipt
// ---------------------------------------------------------------------------

/** The receipt's JSON text, its keys in `PLATE_RECEIPT_KEYS` order. */
export function receiptText(r: PlateReceipt): string {
  const ordered: Record<string, unknown> = {};
  for (const k of PLATE_RECEIPT_KEYS) ordered[k] = r[k];
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** A path as the receipt writes it: relative to the receipt's directory, POSIX separators. */
export function receiptPath(receiptDir: string, path: string): string {
  return relative(resolve(receiptDir), resolve(path)).split('\\').join('/');
}

/**
 * Every problem between a receipt and the bytes on disk: its spec and key
 * order, and each of the painting, mask and output whose sha256 is not that of
 * the file it names (or whose file is gone).
 */
export function verifyPlateReceipt(receiptFile: string): Problem[] {
  const problems: Problem[] = [];
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(readFileSync(receiptFile, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    return [{ code: 'PLATE_RECEIPT_READ', object: receiptFile, detail: `does not parse as JSON (${(err as Error).message})` }];
  }
  if (r.spec !== PLATE_RECEIPT_SPEC) problems.push({ code: 'PLATE_RECEIPT_SPEC', object: receiptFile, detail: `has spec ${JSON.stringify(r.spec)}; "${PLATE_RECEIPT_SPEC}" is required` });
  const keys = Object.keys(r).join(',');
  if (keys !== PLATE_RECEIPT_KEYS.join(',')) problems.push({ code: 'PLATE_RECEIPT_KEYS', object: receiptFile, detail: `has keys ${keys}; ${PLATE_RECEIPT_KEYS.join(',')} in that order is required` });
  const base = dirname(receiptFile);
  for (const field of ['painting', 'mask', 'output'] as const) {
    const f = r[field] as { path?: unknown; sha256?: unknown } | undefined;
    if (typeof f?.path !== 'string' || typeof f.sha256 !== 'string') {
      problems.push({ code: 'PLATE_RECEIPT_KEYS', object: `${receiptFile} ${field}`, detail: 'lacks a path and a sha256' });
      continue;
    }
    const file = join(base, f.path);
    if (!existsSync(file)) {
      problems.push({ code: 'PLATE_RECEIPT_FILE', object: `${receiptFile} ${field}`, detail: `names ${f.path}, which does not exist` });
      continue;
    }
    const found = sha256(new Uint8Array(readFileSync(file)));
    if (found !== f.sha256) problems.push({ code: 'PLATE_RECEIPT_HASH', object: `${receiptFile} ${field}`, detail: `records sha256 ${f.sha256} for ${f.path}; the file on disk has ${found}` });
  }
  return problems;
}

/** Encode a raster to PNG and return the bytes with their sha256. */
export function pngWithHash(r: Raster): { bytes: Uint8Array; sha256: string } {
  const bytes = encodePngBytes(r);
  return { bytes, sha256: sha256(bytes) };
}

// ---------------------------------------------------------------------------
// writing a plate
// ---------------------------------------------------------------------------

/** An `--out` that is absent or empty; anything else is refused, so one run's plate is never mixed with another's receipt. */
export function assertPlateOutFree(out: string): void {
  if (existsSync(out) && (!statSync(out).isDirectory() || readdirSync(out).length > 0)) {
    fail('PLATE_OUT_EMPTY', out, 'is a file or a directory that holds entries; an absent or empty directory is required');
  }
}

/** What a run hands the writer: the mask and plate rasters, and the receipt less what the writer measures. */
export interface PlateWrite {
  out: string;
  /** A name that is this run's own, for the staging directory beside `out`. */
  stageTag: string;
  mode: PlateMode;
  paintingPath: string;
  paintingBytes: Uint8Array;
  source: MaskSource;
  sourceDir: string;
  mask: FigureMask;
  plate: Raster;
  model: PlateReceipt['model'];
  params: PlateReceipt['params'];
  graph: string;
  gpu: string | null;
}

let foregroundStageSeq = 0;

/**
 * Write `mask.png`, `plate.png` and `receipt.json` into a staging directory
 * beside `out`, read the receipt back against the bytes on disk, and only
 * then move the directory to `out`. A receipt that does not verify is never
 * left at the path a later stage reads.
 */
export function publishPlate(w: PlateWrite): PlateReceipt {
  const parent = dirname(resolve(w.out));
  mkdirSync(parent, { recursive: true });
  const stage = mkdtempSync(join(parent, `.${basename(resolve(w.out))}.partial-${w.stageTag}-`));
  try {
    const mask = pngWithHash(maskImage(w.mask));
    const plate = pngWithHash(w.plate);
    writeFileSync(join(stage, PLATE_MASK_FILE), mask.bytes);
    writeFileSync(join(stage, PLATE_OUTPUT_FILE), plate.bytes);
    const receipt: PlateReceipt = {
      spec: PLATE_RECEIPT_SPEC,
      mode: w.mode,
      painting: { path: receiptPath(w.out, w.paintingPath), sha256: sha256(w.paintingBytes) },
      mask: { source: w.source, from: receiptPath(w.out, w.sourceDir), path: PLATE_MASK_FILE, sha256: mask.sha256 },
      model: w.model,
      params: w.params,
      graph: w.graph,
      gpu: w.gpu,
      output: { path: PLATE_OUTPUT_FILE, sha256: plate.sha256 },
    };
    writeFileSync(join(stage, PLATE_RECEIPT_FILE), receiptText(receipt));
    const problems = verifyPlateReceipt(join(stage, PLATE_RECEIPT_FILE));
    if (problems.length > 0) throw new PartsError(problems);
    assertPlateOutFree(w.out);
    try {
      if (existsSync(w.out)) rmdirSync(w.out);
      renameSync(stage, w.out);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'ENOTDIR' || code === 'EISDIR') {
        fail('PLATE_OUT_EMPTY', w.out, 'is a file or a directory that holds entries; an absent or empty directory is required');
      }
      throw err;
    }
    return receipt;
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  }
}

/** A painting read for a plate: its bytes as on disk (hashed into the receipt) and its pixels. */
export function readPlatePainting(path: string): { bytes: Uint8Array; raster: Raster } {
  if (!existsSync(path)) fail('PLATE_PAINTING_PRESENT', path, 'no such file; the painting the plate is made from is required');
  const bytes = new Uint8Array(readFileSync(path));
  return { bytes, raster: decodePngBytes(bytes, path) };
}

export interface ForegroundRun {
  painting: string;
  maskFrom: string | undefined;
  out: string;
}

/**
 * `comfy plate --mode foreground`: no box and no model. The source mask is
 * read first (refused by name, nothing written, when there is none), then the
 * painting's pixels inside it are written with alpha, transparent zero
 * outside, with a receipt whose `model` and `gpu` are null and whose `graph`
 * is the fixed local id.
 */
export function runForeground(run: ForegroundRun): PlateReceipt {
  const from = parseMaskFrom(run.maskFrom);
  const painting = readPlatePainting(run.painting);
  const mask = readSourceMask(from.source, from.dir, painting.raster.width, painting.raster.height, painting.raster, painting.bytes);
  assertPlateOutFree(run.out);
  return publishPlate({
    out: run.out,
    stageTag: `foreground-${process.pid}-${++foregroundStageSeq}`,
    mode: 'foreground',
    paintingPath: run.painting,
    paintingBytes: painting.bytes,
    source: from.source,
    sourceDir: from.dir,
    mask,
    plate: foregroundMatte(painting.raster, mask),
    model: null,
    params: { mask_alpha_above: OPAQUE_ALPHA_ABOVE },
    graph: PLATE_GRAPH_IDS.foreground,
    gpu: null,
  });
}
