import type { TakenLayerSource } from './takesource.ts';
/**
 * The input contract: one See-through decomposition as a `LayerSet`.
 *
 * Two readers, one shape. See-through reaches a user by more than one route
 * (README, *See-through routes*), and two of them leave different files:
 *
 * - **the ComfyUI wrapper form** — a `layers.json` manifest beside one RGBA PNG
 *   per layer. The manifest is the wrapper's own: `width`/`height` of the
 *   canvas and, per layer, `name` (the tag), `filename`, the layer's box as
 *   `left`/`top`/`right`/`bottom` in canvas pixels (right and bottom
 *   exclusive: **[observed]** every PNG is exactly `(right-left)x(bottom-top)`),
 *   and `depth_median`, See-through's per-layer depth, where a LARGER value is
 *   further back. `readWrapperLayers` reads it.
 * - **an upstream `.psd`** — one pixel layer per tag, the layer name being the
 *   tag and the PSD stacking order being the draw order. `readPsdLayers`
 *   reads it. ⚠️ No upstream PSD has been measured by this reader yet: it is
 *   written to that stated contract and tested on PSDs the selftest writes, so
 *   it refuses anything outside the contract (hidden layers, non-normal
 *   blending, opacity, clipping, masks, bit depths other than 8) by name rather
 *   than interpreting it.
 *
 * Both return layers in DRAW ORDER, back to front. For the wrapper that is
 * descending `depth_median` with ties kept in manifest order — a stable sort,
 * which is what the reference implementation's `sorted(..., key=-depth)` is —
 * and for a PSD it is the stacking order itself, with `depth` null because a
 * PSD carries none. Every refusal is collected and thrown once, so one run
 * names every missing file.
 *
 * A layer is named by a See-through v3 tag or, for a layer the author made
 * by hand and added to the run (issue #256), by `author:<label>`
 * (`src/tags.ts`, `AUTHOR_PREFIX`): read with `group` "author", it has no
 * role, and its place in the draw order is read like any other layer's.
 */
import { bindDepthRun, type DepthBinding, type DeferredDepthSource, type SourceDepthSheet } from './depthsheets.ts';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { initializeCanvas, type Layer as PsdLayer, readPsd, writePsd } from 'ag-psd';
import { type Problem, refuseIfAny } from './errors.ts';
import { decodePngBytes, encodePngBytes } from './raster/png.ts';
import type { Raster } from './raster/types.ts';
import { BODY_TAGS, HEAD_TAGS, HIDDEN_NAME_RULE, type LayerTagReading, layerTagRequirement, readHiddenTag, readLayerTag, SPLIT_TAGS } from './tags.ts';

/** Alpha strictly above this counts as painted. The reference uses the same cut for its ghost clean-up and its sheets. */
export const OPAQUE_ALPHA_ABOVE = 8;
/** Alpha at or above this is "opaque" for ownership, projection cores and the seam override. `>= 250`, not `== 255`: See-through leaves alpha-254 speckle. */
export const CORE_ALPHA = 250;
/**
 * A pixel whose min channel is above this is "near-white". The assemble stage's
 * rim and seam guard apply it to the painting (`src/assemble.ts` re-exports it
 * from here); `layerFigures` applies the same test to a layer's own colour, so
 * "background-coloured" means one thing in this repository.
 */
export const NEAR_WHITE_MIN = 235;

export interface Layer {
  /** Verified donor identities retained through generated splits. */
  takenLayers?: TakenLayerSource[];
  /** As the input names it: a v3 tag, possibly with a `-r`/`-l` side, or an author-made layer's `author:<label>`. */
  name: string;
  tag: LayerTagReading;
  /** The file the pixels came from, or null for a PSD layer. */
  file: string | null;
  /** The layer's own pixels, `(right-left)x(bottom-top)`, straight alpha. */
  pixels: Raster;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** See-through's `depth_median` (larger = further back), or null where the input carries none. */
  depth: number | null;
  /** Optional scalar source; ordering remains the separate depth_median. */
  depthSheet?: SourceDepthSheet;
  /** An unbound legacy hint; reading art must not touch its file. */
  depthHint?: DeferredDepthSource;
  /** 0 is drawn first (furthest back). */
  drawOrder: number;
  /** Pixels with alpha above `OPAQUE_ALPHA_ABOVE`. */
  opaquePx: number;
}

/**
 * A hidden-art layer (issue #359, `HIDDEN_SUFFIX` in `src/tags.ts`): the art
 * of the layer `of` where something covers it. Never drawn and never a part,
 * so it carries no tag reading, no depth and no draw order.
 */
export interface HiddenLayer {
  /** Legacy hint, retained but never interpreted while depth is inactive. */
  depthHint?: DeferredDepthSource;
  /** `<of>:hidden`. */
  name: string;
  /** The drawn layer of the same input it belongs to. */
  of: string;
  /** The file the pixels came from, or null for a PSD layer. */
  file: string | null;
  pixels: Raster;
  left: number;
  top: number;
  right: number;
  bottom: number;
  opaquePx: number;
}

export interface LayerSet {
  form: 'wrapper' | 'psd';
  /** The manifest or PSD that was read. */
  source: string;
  canvas: { w: number; h: number };
  /** In draw order, back to front. */
  layers: Layer[];
  /** The hidden-art layers (issue #359), in the order the input lists them; empty when it holds none. */
  hidden: HiddenLayer[];
}

/** Bounds in input-canvas pixels, with exclusive right/bottom boundaries. */
export interface OpaqueBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function alphaBox(layer: Pick<Layer, 'pixels' | 'left' | 'top'>, includes: (alpha: number) => boolean): OpaqueBox | null {
  const p = layer.pixels;
  let left = p.width;
  let top = p.height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      if (!includes(p.data[(y * p.width + x) * 4 + 3])) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  return right === 0 ? null : { left: layer.left + left, top: layer.top + top, right: layer.left + right, bottom: layer.top + bottom };
}

/** Original alpha above the legacy painted-pixel cut (>8), before cleanup or resampling. */
export function layerOpaqueBox(layer: Pick<Layer, 'pixels' | 'left' | 'top'>): OpaqueBox | null {
  return alphaBox(layer, alpha => alpha > OPAQUE_ALPHA_ABOVE);
}

/** Original alpha at or above CORE_ALPHA; not an owned, eroded or resampled projection core. */
export function layerCoreBox(layer: Pick<Layer, 'pixels' | 'left' | 'top'>): OpaqueBox | null {
  return alphaBox(layer, alpha => alpha >= CORE_ALPHA);
}

function bodyBox(set: LayerSet, readBox: (layer: Layer) => OpaqueBox | null): OpaqueBox | null {
  let union: OpaqueBox | null = null;
  for (const layer of set.layers) {
    if (layer.tag.group !== 'body') continue;
    const box = readBox(layer);
    if (box === null) continue;
    union = union === null ? box : {
      left: Math.min(union.left, box.left), top: Math.min(union.top, box.top),
      right: Math.max(union.right, box.right), bottom: Math.max(union.bottom, box.bottom),
    };
  }
  return union;
}

/** Source >8 union of the reader's existing drawn body group, not an anatomical silhouette. */
export function bodyOpaqueBox(set: LayerSet): OpaqueBox | null {
  return bodyBox(set, layerOpaqueBox);
}

/** Source >=CORE_ALPHA union of the same body group; no ownership, erosion or cleanup. */
export function bodyCoreBox(set: LayerSet): OpaqueBox | null {
  return bodyBox(set, layerCoreBox);
}

function opaque(r: Raster): number {
  let n = 0;
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i] > OPAQUE_ALPHA_ABOVE) n++;
  return n;
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function describe(v: unknown): string {
  return v === undefined ? 'absent' : JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// the wrapper form
// ---------------------------------------------------------------------------

const MANIFEST_KEYS = ['prefix', 'timestamp', 'layers', 'width', 'height'] as const;
const MANIFEST_REQUIRED = ['layers', 'width', 'height'] as const;
const LAYER_KEYS = ['name', 'filename', 'left', 'top', 'right', 'bottom', 'depth_median', 'depth_filename'] as const;
const LAYER_REQUIRED = ['name', 'filename', 'left', 'top', 'right', 'bottom', 'depth_median'] as const;

/**
 * What the wrapper form's `depth_median` may be, as a refusal quotes it. A
 * See-through run writes a number; an input with no depth — a PSD exported by
 * `layers --export` (issue #359) — writes `null` for every drawn layer, and
 * its draw order is then the manifest's order, back to front, exactly as a
 * PSD's is its stacking order. A depth is never invented for it.
 */
const DEPTH_RULE = 'a finite number (See-through\'s depth, larger = further back), or null on every drawn layer of an input that carries no depth (the manifest\'s order is then the draw order, back to front)';

/**
 * Read the wrapper form from a directory holding `layers.json`, or from the
 * manifest path itself.
 *
 * A layer's PNG is looked for in the two places the two known layouts put it,
 * and the choice is never silent: `<dir>/<filename>` (the wrapper's own output
 * directory, flat) and `<dir>/parts/<name>.png` (the layout a fetcher that
 * renames by tag writes). One present is used; neither is a refusal naming
 * both; both present with different bytes is a refusal, because picking one
 * would be a guess.
 *
 * ⚠️ An unknown key is refused, in the manifest and in a layer. The wrapper is
 * not this repository's, and a field it adds tomorrow could carry meaning (an
 * order, a scale) that silently ignoring would get wrong — so the reader says
 * which key it does not know and stops.
 */
export function readWrapperLayers(path: string, binding?: DepthBinding): LayerSet {
  const manifestPath = existsSync(path) && statSync(path).isDirectory() ? join(path, 'layers.json') : path;
  const dir = dirname(manifestPath);
  const problems: Problem[] = [];
  const refuse = (code: string, object: string, detail: string): void => {
    problems.push({ code, object, detail });
  };
  if (!existsSync(manifestPath)) {
    refuse('LAYERS_MANIFEST_PRESENT', manifestPath, 'no such file; a See-through wrapper output directory holds layers.json');
    refuseIfAny(problems);
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    refuse('LAYERS_MANIFEST_IS_JSON', manifestPath, `does not parse as JSON: ${(err as Error).message}`);
    refuseIfAny(problems);
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    refuse('LAYERS_MANIFEST_IS_JSON', manifestPath, `holds ${describe(manifest)}; an object with width, height and layers is required`);
    refuseIfAny(problems);
  }
  const m = manifest as Record<string, unknown>;
  for (const key of Object.keys(m)) {
    if (!(MANIFEST_KEYS as readonly string[]).includes(key)) {
      refuse('LAYERS_KEY_KNOWN', `${manifestPath} key "${key}"`, `is not a wrapper manifest field; known: ${MANIFEST_KEYS.join(', ')}`);
    }
  }
  for (const key of MANIFEST_REQUIRED) {
    if (!(key in m)) refuse('LAYERS_FIELD_PRESENT', `${manifestPath} field "${key}"`, 'is absent and required');
  }
  const width = m.width;
  const height = m.height;
  if ('width' in m && (!isInt(width) || width < 1)) {
    refuse('LAYERS_FIELD_PRESENT', `${manifestPath} field "width"`, `is ${describe(width)}; a positive integer is required`);
  }
  if ('height' in m && (!isInt(height) || height < 1)) {
    refuse('LAYERS_FIELD_PRESENT', `${manifestPath} field "height"`, `is ${describe(height)}; a positive integer is required`);
  }
  if ('layers' in m && !Array.isArray(m.layers)) {
    refuse('LAYERS_FIELD_PRESENT', `${manifestPath} field "layers"`, `is ${describe(m.layers)}; an array is required`);
  }
  refuseIfAny(problems);
  const W = width as number;
  const H = height as number;
  const entries = m.layers as unknown[];
  if (entries.length === 0) refuse('LAYERS_FIELD_PRESENT', `${manifestPath} field "layers"`, 'is empty; at least one layer is required');

  const read: Array<Omit<Layer, 'drawOrder'> & { index: number }> = [];
  const hidden: HiddenLayer[] = [];
  const seen = new Map<string, number>();
  entries.forEach((entry, index) => {
    const at = `${basename(manifestPath)} layers[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      refuse('LAYERS_FIELD_PRESENT', at, `is ${describe(entry)}; an object is required`);
      return;
    }
    const e = entry as Record<string, unknown>;
    const label = typeof e.name === 'string' ? `layer "${e.name}"` : at;
    let ok = true;
    // Uniqueness first, before any other problem can end this entry's checks:
    // a duplicate beside an entry that is also malformed is still a duplicate.
    if (typeof e.name === 'string') {
      if (seen.has(e.name)) {
        refuse('LAYERS_NAME_UNIQUE', label, `appears at layers[${seen.get(e.name)}] and layers[${index}]; a tag names one layer`);
        ok = false;
      } else seen.set(e.name, index);
    }
    for (const key of Object.keys(e)) {
      if (!(LAYER_KEYS as readonly string[]).includes(key)) {
        refuse('LAYERS_KEY_KNOWN', `${label} key "${key}"`, `is not a wrapper layer field; known: ${LAYER_KEYS.join(', ')}`);
        ok = false;
      }
    }
    for (const key of LAYER_REQUIRED) {
      if (!(key in e)) {
        refuse('LAYERS_FIELD_PRESENT', `${label} field "${key}"`, 'is absent and required');
        ok = false;
      }
    }
    if (!ok) return;
    if (typeof e.name !== 'string') {
      refuse('LAYERS_FIELD_PRESENT', `${at} field "name"`, `is ${describe(e.name)}; a tag string is required`);
      return;
    }
    const name = e.name;
    const hiddenOf = readHiddenTag(name);
    const tag = hiddenOf === null ? readLayerTag(name) : null;
    if (tag === null && hiddenOf === null) {
      refuse('LAYERS_TAG_KNOWN', `layer "${name}"`, layerTagRequirement(name));
      ok = false;
    }
    for (const key of ['left', 'top', 'right', 'bottom'] as const) {
      if (!isInt(e[key])) {
        refuse('LAYERS_FIELD_PRESENT', `layer "${name}" field "${key}"`, `is ${describe(e[key])}; an integer is required`);
        ok = false;
      }
    }
    if (hiddenOf !== null) {
      if (e.depth_median !== null) {
        refuse('LAYERS_HIDDEN_NO_DEPTH', `layer "${name}" field "depth_median"`, `is ${describe(e.depth_median)}; a hidden-art layer is never drawn, so it has no depth and null is required`);
        ok = false;
      }
    } else if (e.depth_median !== null && (typeof e.depth_median !== 'number' || !Number.isFinite(e.depth_median))) {
      refuse('LAYERS_FIELD_PRESENT', `layer "${name}" field "depth_median"`, `is ${describe(e.depth_median)}; ${DEPTH_RULE} is required`);
      ok = false;
    }
    if (typeof e.filename !== 'string' || e.filename === '') {
      refuse('LAYERS_FIELD_PRESENT', `layer "${name}" field "filename"`, `is ${describe(e.filename)}; a file name is required`);
      ok = false;
    }
    if (!ok || (tag === null && hiddenOf === null)) return;
    const left = e.left as number;
    const top = e.top as number;
    const right = e.right as number;
    const bottom = e.bottom as number;
    if (left < 0 || top < 0 || right > W || bottom > H || left >= right || top >= bottom) {
      refuse(
        'LAYERS_BBOX_INSIDE_CANVAS',
        `layer "${name}"`,
        `box left ${left} top ${top} right ${right} bottom ${bottom}; a non-empty box inside the ${W}x${H} canvas is required`,
      );
      return;
    }
    const flat = join(dir, e.filename as string);
    const byTag = join(dir, 'parts', `${name}.png`);
    const present = [flat, byTag].filter((p) => existsSync(p));
    if (present.length === 0) {
      refuse('LAYERS_PNG_PRESENT', `layer "${name}"`, `neither ${flat} nor ${byTag} exists; one of them is required`);
      return;
    }
    const bytes = present.map((p) => new Uint8Array(readFileSync(p)));
    if (bytes.length === 2 && Buffer.compare(Buffer.from(bytes[0]), Buffer.from(bytes[1])) !== 0) {
      refuse('LAYERS_PNG_UNAMBIGUOUS', `layer "${name}"`, `${flat} and ${byTag} both exist with different bytes; exactly one source is required`);
      return;
    }
    let pixels: Raster;
    try {
      pixels = decodePngBytes(bytes[0], present[0]);
    } catch (err) {
      refuse('LAYERS_PNG_DECODES', `layer "${name}"`, (err as Error).message);
      return;
    }
    if (pixels.width !== right - left || pixels.height !== bottom - top) {
      refuse(
        'LAYERS_PNG_MATCHES_BBOX',
        `layer "${name}"`,
        `${present[0]} is ${pixels.width}x${pixels.height}; the manifest box is ${right - left}x${bottom - top}`,
      );
      return;
    }
    if (hiddenOf !== null) {
      hidden.push({ name, of: hiddenOf.of, file: present[0], pixels, left, top, right, bottom, opaquePx: opaque(pixels), ...(!('depth_filename' in e) ? {} : { depthHint: { filename: e.depth_filename, base: dir } }) });
      return;
    }
    read.push({
      name,
      tag: tag as LayerTagReading,
      file: present[0],
      pixels,
      ...(!('depth_filename' in e) ? {} : { depthHint: { filename: e.depth_filename, base: dir } }),
      left,
      top,
      right,
      bottom,
      depth: e.depth_median as number | null,
      opaquePx: opaque(pixels),
      index,
    });
  });
  // Issue #359: depth on every drawn layer, or on none — a mix has no one order to draw by.
  const withDepth = read.filter((l) => l.depth !== null);
  if (withDepth.length > 0 && withDepth.length < read.length) {
    const none = read.filter((l) => l.depth === null).map((l) => `"${l.name}"`);
    refuse('LAYERS_DEPTH_ALL_OR_NONE', manifestPath, `${withDepth.length} drawn layer(s) carry a depth_median and ${none.length} carry null (${none.join(', ')}); a number on every drawn layer, or null on every one, is required — a mix has no one draw order`);
  }
  checkHiddenOf(hidden, read.map((l) => l.name), (l) => `layer "${l}"`, refuse);
  refuseIfAny(problems);
  // Stable: Array.prototype.sort is stable, so equal depths keep manifest order — and with no depth at all (every
  // depth null), the manifest's own order is the draw order.
  const ordered = withDepth.length === 0 ? read : [...read].sort((a, b) => (b.depth as number) - (a.depth as number));
  const set: LayerSet = {
    form: 'wrapper',
    source: manifestPath,
    canvas: { w: W, h: H },
    layers: ordered.map(({ index: _index, ...rest }, drawOrder) => ({ ...rest, drawOrder })),
    hidden,
  };
  return binding === undefined ? set : bindDepthRun(set, binding.run, binding.config, binding.base);
}

/** Every hidden-art layer must belong to a drawn layer the same input holds (issue #359): `LAYERS_HIDDEN_OF_PRESENT`. */
function checkHiddenOf(hidden: readonly HiddenLayer[], drawn: readonly string[], label: (name: string) => string, refuse: (code: string, object: string, detail: string) => void): void {
  for (const h of hidden) {
    if (!drawn.includes(h.of)) {
      refuse('LAYERS_HIDDEN_OF_PRESENT', label(h.name), `is the hidden art of "${h.of}", and the input holds no drawn layer of that name — it holds ${drawn.length === 0 ? 'none' : drawn.map((n) => `"${n}"`).join(', ')}; ${HIDDEN_NAME_RULE} is required`);
    }
  }
}

// ---------------------------------------------------------------------------
// the PSD form
// ---------------------------------------------------------------------------

let canvasStubbed = false;

/** The image-data shape ag-psd asks its factory for, named off ag-psd's own signature rather than a DOM lib. */
type PsdImageData = ReturnType<NonNullable<Parameters<typeof initializeCanvas>[1]>>;

/**
 * ag-psd decodes into `ImageData` objects and asks a canvas factory for them,
 * even with `useImageData`. There is no canvas here and none is wanted, so the
 * factory hands back a plain `{ width, height, data }` and the canvas
 * constructor throws: a code path that needed a real canvas would be one that
 * rasterises something (a text layer, a composite), which this reader refuses
 * anyway.
 */
function stubCanvas(): void {
  if (canvasStubbed) return;
  initializeCanvas(
    () => {
      throw new Error('rig-parts reads PSD pixel data only; this PSD asked for a canvas');
    },
    (width: number, height: number) =>
      ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' }) as PsdImageData,
  );
  canvasStubbed = true;
}

/** PSD colour mode 3 is RGB, the only one See-through writes and the only one read here. */
const PSD_RGB = 3;

export function readPsdLayers(path: string): LayerSet {
  const problems: Problem[] = [];
  const refuse = (code: string, object: string, detail: string): void => {
    problems.push({ code, object, detail });
  };
  if (!existsSync(path)) {
    refuse('PSD_FILE_PRESENT', path, 'no such file');
    refuseIfAny(problems);
  }
  stubCanvas();
  let psd;
  try {
    psd = readPsd(readFileSync(path), {
      useImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
    });
  } catch (err) {
    refuse('PSD_PARSES', path, `ag-psd could not read it: ${(err as Error).message}`);
    refuseIfAny(problems);
    throw err;
  }
  if (psd.colorMode !== PSD_RGB) refuse('PSD_IS_RGB8', path, `colour mode ${String(psd.colorMode)}; RGB (3) is required`);
  if (psd.bitsPerChannel !== 8) refuse('PSD_IS_RGB8', path, `${String(psd.bitsPerChannel)} bits per channel; 8 are required`);
  const W = psd.width;
  const H = psd.height;
  const leaves: PsdLayer[] = [];
  const walk = (children: PsdLayer[] | undefined, trail: string): void => {
    for (const layer of children ?? []) {
      const where = `${trail}${layer.name ?? '(unnamed)'}`;
      // A hidden-art layer (issue #359) is never drawn, so it may be switched off in the file; every other layer is drawn.
      const art = layer.children === undefined && readHiddenTag(layer.name ?? '') !== null;
      if (layer.hidden && !art) refuse('PSD_LAYER_PLAIN', `PSD layer "${where}"`, 'is hidden; every layer of a decomposition is drawn (only a hidden-art layer, "<layer>:hidden", may be switched off)');
      if (layer.opacity !== undefined && layer.opacity !== 1) {
        refuse('PSD_LAYER_PLAIN', `PSD layer "${where}"`, `has opacity ${layer.opacity}; 1 is required`);
      }
      if (layer.children !== undefined) {
        if (layer.blendMode !== undefined && layer.blendMode !== 'pass through' && layer.blendMode !== 'normal') {
          refuse('PSD_LAYER_PLAIN', `PSD group "${where}"`, `blends "${layer.blendMode}"; pass through or normal is required`);
        }
        walk(layer.children, `${where}/`);
        continue;
      }
      if (layer.blendMode !== undefined && layer.blendMode !== 'normal') {
        refuse('PSD_LAYER_PLAIN', `PSD layer "${where}"`, `blends "${layer.blendMode}"; normal is required`);
      }
      if (layer.clipping) refuse('PSD_LAYER_PLAIN', `PSD layer "${where}"`, 'is a clipping layer; none is required');
      if (layer.mask !== undefined) refuse('PSD_LAYER_PLAIN', `PSD layer "${where}"`, 'carries a layer mask; none is required');
      leaves.push(layer);
    }
  };
  walk(psd.children, '');
  if (leaves.length === 0) refuse('PSD_HAS_LAYERS', path, 'holds no pixel layer; one per See-through tag is required');
  const seen = new Set<string>();
  const layers: Layer[] = [];
  const hidden: HiddenLayer[] = [];
  leaves.forEach((layer) => {
    const name = layer.name ?? '';
    const hiddenOf = readHiddenTag(name);
    const tag = hiddenOf === null ? readLayerTag(name) : null;
    if (tag === null && hiddenOf === null) {
      refuse('LAYERS_TAG_KNOWN', `PSD layer "${name}"`, layerTagRequirement(name));
      return;
    }
    if (seen.has(name)) {
      refuse('LAYERS_NAME_UNIQUE', `PSD layer "${name}"`, 'appears twice; a tag names one layer');
      return;
    }
    seen.add(name);
    const img = layer.imageData;
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    const right = layer.right ?? 0;
    const bottom = layer.bottom ?? 0;
    if (img === undefined || img.width === 0 || img.height === 0) {
      refuse('PSD_LAYER_HAS_PIXELS', `PSD layer "${name}"`, 'carries no pixel data; a painted layer is required');
      return;
    }
    if (left < 0 || top < 0 || right > W || bottom > H) {
      refuse(
        'LAYERS_BBOX_INSIDE_CANVAS',
        `PSD layer "${name}"`,
        `box left ${left} top ${top} right ${right} bottom ${bottom}; a box inside the ${W}x${H} canvas is required`,
      );
      return;
    }
    if (img.width !== right - left || img.height !== bottom - top) {
      refuse('LAYERS_PNG_MATCHES_BBOX', `PSD layer "${name}"`, `pixels are ${img.width}x${img.height}; the layer box is ${right - left}x${bottom - top}`);
      return;
    }
    const pixels: Raster = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
    if (hiddenOf !== null) {
      hidden.push({ name, of: hiddenOf.of, file: null, pixels, left, top, right, bottom, opaquePx: opaque(pixels) });
      return;
    }
    layers.push({
      name,
      tag: tag as LayerTagReading,
      file: null,
      pixels,
      left,
      top,
      right,
      bottom,
      depth: null,
      drawOrder: layers.length,
      opaquePx: opaque(pixels),
    });
  });
  checkHiddenOf(hidden, layers.map((l) => l.name), (l) => `PSD layer "${l}"`, refuse);
  refuseIfAny(problems);
  return { form: 'psd', source: path, canvas: { w: W, h: H }, layers, hidden };
}

/** Read whichever form `path` is: a `.psd` file, or a wrapper directory / `layers.json`. */
export function readLayers(path: string, binding?: DepthBinding): LayerSet {
  if (/\.psd$/i.test(path)) { const set = readPsdLayers(path); return binding === undefined ? set : bindDepthRun(set, binding.run, binding.config, binding.base); }
  if (existsSync(path) && (statSync(path).isDirectory() || basename(path) === 'layers.json')) return readWrapperLayers(path, binding);
  refuseIfAny([
    {
      code: 'LAYERS_INPUT_KIND',
      object: path,
      detail: existsSync(path)
        ? 'is neither a .psd file nor a directory holding layers.json nor a layers.json'
        : 'does not exist; a .psd file or a See-through wrapper output directory is required',
    },
  ]);
  throw new Error('unreachable');
}

// ---------------------------------------------------------------------------
// the export and the template (issue #359)
// ---------------------------------------------------------------------------

/**
 * The file a layer is exported to: its index in the manifest, zero-padded to
 * the width of the last index (at least two digits), then its name with every
 * character other than a letter, a digit, `-` and `_` written `_`. The index
 * makes the name unique (`author:a b` and `author:a_b` would otherwise meet),
 * and the manifest, not the file name, says which layer a file is.
 */
export function exportFileName(index: number, count: number, name: string): string {
  const width = Math.max(2, String(Math.max(0, count - 1)).length);
  return `${String(index).padStart(width, '0')}_${name.replace(/[^A-Za-z0-9_-]/g, '_')}.png`;
}

/** The wrapper manifest `exportLayers` writes, as text: fixed key order, two-space indent, a trailing newline. */
export function exportManifestText(set: LayerSet, binding?: DepthBinding): string {
  set = bindDepthRun(set, binding?.run ?? 'full', binding?.config, binding?.base ?? '');
  const all: Array<{ name: string; left: number; top: number; right: number; bottom: number; depth: number | null; depthSheet?: SourceDepthSheet }> = [
    ...set.layers.map((l) => ({ name: l.name, left: l.left, top: l.top, right: l.right, bottom: l.bottom, depth: l.depth, ...(l.depthSheet === undefined ? {} : { depthSheet: l.depthSheet }) })),
    ...set.hidden.map((h) => ({ name: h.name, left: h.left, top: h.top, right: h.right, bottom: h.bottom, depth: null })),
  ];
  const manifest = {
    width: set.canvas.w,
    height: set.canvas.h,
    layers: all.map((l, i) => ({ name: l.name, filename: exportFileName(i, all.length, l.name), left: l.left, top: l.top, right: l.right, bottom: l.bottom, depth_median: l.depth, ...(l.depthSheet === undefined ? {} : { depth_filename: exportFileName(i, all.length, `${l.name}_depth`) }) })),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * `layers --export <dir> <input>` (issue #359): write a set as the wrapper
 * form — `layers.json` beside one RGBA PNG per layer — so an agent can correct
 * the parse with ordinary file operations and hand the directory back to any
 * command that reads layers. Drawn layers are listed in draw order, back to
 * front, then the hidden-art layers in their own order; `depth_median` is the
 * input's own, so a PSD's is `null` on every layer and the manifest's order is
 * its draw order ({@link readWrapperLayers}). Reading the directory back gives
 * the same layers, boxes, pixels and order as the input's reading (selftest
 * `LW` round trip).
 *
 * Refuses a `dir` that exists and is not an empty directory
 * (`LAYERS_EXPORT_DIR_EMPTY`): a file left there by an earlier export — a
 * `parts/<name>.png` the reader also looks for — could be read in place of
 * the one written now. Writes nothing until that has passed.
 */
export function exportLayers(set: LayerSet, dir: string, binding?: DepthBinding): { manifest: string; files: string[] } {
  if (existsSync(dir) && (!statSync(dir).isDirectory() || readdirSync(dir).length > 0)) {
    refuseIfAny([
      {
        code: 'LAYERS_EXPORT_DIR_EMPTY',
        object: dir,
        detail: statSync(dir).isDirectory() ? `holds ${readdirSync(dir).length} entr${readdirSync(dir).length === 1 ? 'y' : 'ies'}; a directory that does not exist yet, or an empty one, is required — a file left there could be read in place of the one written now` : 'is a file; a directory that does not exist yet, or an empty one, is required',
      },
    ]);
  }
  set = bindDepthRun(set, binding?.run ?? 'full', binding?.config, binding?.base ?? '');
  const text = exportManifestText(set, binding);
  const entries = (JSON.parse(text) as { layers: Array<{ filename: string }> }).layers;
  const pixels = [...set.layers.map((l) => l.pixels), ...set.hidden.map((h) => h.pixels)];
  mkdirSync(dir, { recursive: true });
  const files = entries.map((e, i) => {
    const path = join(dir, e.filename);
    writeFileSync(path, encodePngBytes(pixels[i]));
    return path;
  });
  set.layers.forEach((l, i) => { if (l.depthSheet !== undefined) { const file = join(dir, exportFileName(i, set.layers.length + set.hidden.length, `${l.name}_depth`)); writeFileSync(file, encodePngBytes(l.depthSheet.pixels)); files.push(file); } });
  const manifest = join(dir, 'layers.json');
  writeFileSync(manifest, text);
  return { manifest, files };
}

/**
 * Where two readings of one decomposition differ, or null when they are the
 * same: the canvas, then each drawn layer in draw order — name, box, depth,
 * pixels byte for byte — then each hidden-art layer. The first difference is
 * named. What the export's round trip is held to (issue #359); the source
 * path, the form and each layer's file are where it was read from, not what
 * it holds, and are not compared.
 */
export function layerSetDiff(a: LayerSet, b: LayerSet): string | null {
  if (a.canvas.w !== b.canvas.w || a.canvas.h !== b.canvas.h) return `canvas ${a.canvas.w}x${a.canvas.h} against ${b.canvas.w}x${b.canvas.h}`;
  const box = (l: { left: number; top: number; right: number; bottom: number }): string => `${l.left},${l.top},${l.right},${l.bottom}`;
  const same = (x: Raster, y: Raster): boolean => x.width === y.width && x.height === y.height && Buffer.from(x.data).equals(Buffer.from(y.data));
  if (a.layers.length !== b.layers.length) return `${a.layers.length} drawn layer(s) against ${b.layers.length}`;
  for (let i = 0; i < a.layers.length; i++) {
    const x = a.layers[i];
    const y = b.layers[i];
    if (x.name !== y.name) return `draw order ${i} is "${x.name}" against "${y.name}"`;
    if (box(x) !== box(y)) return `layer "${x.name}" box ${box(x)} against ${box(y)}`;
    if (x.depth !== y.depth) return `layer "${x.name}" depth ${String(x.depth)} against ${String(y.depth)}`;
    if (!same(x.pixels, y.pixels)) return `layer "${x.name}" pixels differ`;
  }
  if (a.hidden.length !== b.hidden.length) return `${a.hidden.length} hidden-art layer(s) against ${b.hidden.length}`;
  for (let i = 0; i < a.hidden.length; i++) {
    const x = a.hidden[i];
    const y = b.hidden[i];
    if (x.name !== y.name || box(x) !== box(y) || !same(x.pixels, y.pixels)) return `hidden-art layer ${i} "${x.name}" against "${y.name}" (name, box or pixels)`;
  }
  return null;
}

/**
 * The layer names `layers --template` writes, bottom first (issue #359): every
 * v3 tag (`src/tags.ts`, 24) less `head` — upstream never emits it as a layer
 * and no stage reads a role from it — with each of the six split tags written
 * as its `-r` and `-l` halves, because the rig reads the halves (the eye bones
 * come from `eyewhite-r` and `eyewhite-l`): 24 − 1 − 6 + 12 = 29 names. The
 * order is a starting stack — back hair, the body, the face, front hair — and
 * not a rule: the file's own order is the draw order.
 */
export function templateLayerNames(): string[] {
  const expand = (t: string): string[] => ((SPLIT_TAGS as readonly string[]).includes(t) ? [`${t}-r`, `${t}-l`] : [t]);
  const body = (BODY_TAGS as readonly string[]).filter((t) => t !== 'head' && t !== 'back hair' && t !== 'front hair');
  return ['back hair', ...body.flatMap(expand), ...(HEAD_TAGS as readonly string[]).flatMap(expand), 'front hair'];
}

/**
 * `layers --template <out.psd> --canvas <W>x<H>`: a PSD of {@link templateLayerNames}'s
 * layers, each empty, on a `W x H` canvas, written by the same library the
 * reader uses. The same canvas writes the same bytes. The reader refuses an
 * empty layer (`PSD_LAYER_HAS_PIXELS`), so the template read back as it is
 * names every layer once: an artist paints into the layers the figure has and
 * deletes the rest.
 */
export function templatePsdBytes(w: number, h: number): Uint8Array {
  stubCanvas();
  const doc = { width: w, height: h, children: templateLayerNames().map((name) => ({ name })) };
  return new Uint8Array(writePsd(doc, { noBackground: true }));
}

// ---------------------------------------------------------------------------
// plausibility: three figures per layer, and the rules `--propose-plan` drops by
// ---------------------------------------------------------------------------

/**
 * An opaque pixel (alpha above `OPAQUE_ALPHA_ABOVE`) whose alpha is below this
 * is "translucent". 128 is the tree's half-covered cut (`FRONT_ALPHA`,
 * `COVERED_ALPHA` in `src/assemble.ts`).
 */
export const TRANSLUCENT_ALPHA_BELOW = 128;
/**
 * `PLAN_LAYER_TRANSLUCENT` and `PLAN_LAYER_BACKGROUND` judge only a layer at
 * least this large against the rest of its run's figure. [observed] Every
 * example layer of 150 px or more that is above 25 % translucent is a small
 * feature — a lash, a brow, a mouth, a nose, an ear, an iris, an eye white, an
 * earring (27 of the 116 layers of the two examples' four runs) — and the
 * largest of them is 0.011x the rest of its figure (a lash of the sample's head
 * run). An antialiased stroke is mostly rim, so its translucency says nothing
 * about plausibility; 23 of the 116 layers are judged.
 */
export const PLAUSIBLE_JUDGED_AREA_RATIO = 0.05;
/** [observed] Above this translucent share a judged layer is dropped. The most translucent judged example layer is 17.8 % (the sample's full-run front hair). */
export const PLAUSIBLE_TRANSLUCENT_MAX = 0.5;
/**
 * [observed] Above this background share, with a translucent share above
 * `PLAUSIBLE_BACKGROUND_TRANSLUCENT_MIN`, a judged layer is dropped. The most
 * background-coloured judged example layer is 21.9 % (the demo's head-run
 * topwear, a white dress). The second condition is what keeps an opaque white
 * garment: its colour is the page's, its alpha is not the haze's.
 */
export const PLAUSIBLE_BACKGROUND_MAX = 0.5;
/** [observed] Of the judged example layers more than 10 % background-coloured, the most translucent is 5.6 % (the demo's full-run handwear-r). */
export const PLAUSIBLE_BACKGROUND_TRANSLUCENT_MIN = 0.25;
/** [observed] Above this area ratio any layer is dropped. The largest example layer is 1.681x the rest of its figure (the demo's head-run back hair, which fills the crop). */
export const PLAUSIBLE_AREA_RATIO_MAX = 4;

export type PlausibilityRule = 'PLAN_LAYER_TRANSLUCENT' | 'PLAN_LAYER_BACKGROUND' | 'PLAN_LAYER_OVERSIZED';

export interface LayerFigures {
  name: string;
  /** Pixels with alpha above `OPAQUE_ALPHA_ABOVE` — the table's `opaque_px`. */
  opaquePx: number;
  /** Opaque pixels with alpha below `TRANSLUCENT_ALPHA_BELOW`. */
  translucentPx: number;
  /** Opaque pixels whose own colour (straight alpha) has a min channel above `NEAR_WHITE_MIN`. */
  backgroundPx: number;
  /** Opaque pixels of the union of every OTHER layer of the set, on the canvas. */
  restPx: number;
  /** `translucentPx / opaquePx`, or null for a layer with no opaque pixel. */
  translucent: number | null;
  /** `backgroundPx / opaquePx`, or null for a layer with no opaque pixel. */
  background: number | null;
  /** `opaquePx / restPx`, or null when no other layer has an opaque pixel. */
  areaRatio: number | null;
}

/**
 * The three plausibility figures of every layer of a set, in the set's order.
 *
 * ⚖️ Invariant: every figure is a ratio of pixel counts over the layer as read
 * (no ghost clean-up), over its opaque pixels (alpha above 8) — never over
 * alpha above 0, because See-through leaves a haze of alpha 1..8 over whole
 * canvases (the demo's full-run face: 99.1 % of its alpha-above-0 pixels are
 * below 128, 4.2 % of its opaque ones). The area ratio is taken against the
 * REST of the figure, the other layers' union: over the whole union a layer
 * could never exceed 1, and "twice the figure" could not be said.
 */
export function layerFigures(set: LayerSet): LayerFigures[] {
  const W = set.canvas.w;
  const H = set.canvas.h;
  // Cover counts saturate at 2: "this layer only" versus "some other layer too" is all the rest needs.
  const cover = new Uint8Array(W * H);
  for (const l of set.layers) {
    const p = l.pixels;
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        if (p.data[(y * p.width + x) * 4 + 3] <= OPAQUE_ALPHA_ABOVE) continue;
        const c = (l.top + y) * W + l.left + x;
        if (cover[c] < 2) cover[c]++;
      }
    }
  }
  let union = 0;
  for (let i = 0; i < W * H; i++) if (cover[i] > 0) union++;
  return set.layers.map((l) => {
    const p = l.pixels;
    let opaquePx = 0;
    let translucentPx = 0;
    let backgroundPx = 0;
    let alone = 0;
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const i = (y * p.width + x) * 4;
        const a = p.data[i + 3];
        if (a <= OPAQUE_ALPHA_ABOVE) continue;
        opaquePx++;
        if (a < TRANSLUCENT_ALPHA_BELOW) translucentPx++;
        if (Math.min(p.data[i], p.data[i + 1], p.data[i + 2]) > NEAR_WHITE_MIN) backgroundPx++;
        if (cover[(l.top + y) * W + l.left + x] === 1) alone++;
      }
    }
    const restPx = union - alone;
    return {
      name: l.name,
      opaquePx,
      translucentPx,
      backgroundPx,
      restPx,
      translucent: opaquePx > 0 ? translucentPx / opaquePx : null,
      background: opaquePx > 0 ? backgroundPx / opaquePx : null,
      areaRatio: restPx > 0 ? opaquePx / restPx : null,
    };
  });
}

/**
 * The rules a layer crosses, in a fixed order. A layer with no opaque pixel
 * crosses none (the plan's pixel floor already leaves it out).
 *
 * - `PLAN_LAYER_TRANSLUCENT`: judged, and translucent share above `PLAUSIBLE_TRANSLUCENT_MAX`.
 * - `PLAN_LAYER_BACKGROUND`: judged, background share above `PLAUSIBLE_BACKGROUND_MAX`
 *   and translucent share above `PLAUSIBLE_BACKGROUND_TRANSLUCENT_MIN` — a pale haze.
 * - `PLAN_LAYER_OVERSIZED`: area ratio above `PLAUSIBLE_AREA_RATIO_MAX`.
 *
 * "Judged" is an area ratio of at least `PLAUSIBLE_JUDGED_AREA_RATIO`, or no
 * ratio at all (a layer alone in its set is the whole figure, not a stroke).
 */
export function implausibleRules(f: LayerFigures): PlausibilityRule[] {
  if (f.opaquePx === 0 || f.translucent === null || f.background === null) return [];
  const judged = f.areaRatio === null || f.areaRatio >= PLAUSIBLE_JUDGED_AREA_RATIO;
  const out: PlausibilityRule[] = [];
  if (judged && f.translucent > PLAUSIBLE_TRANSLUCENT_MAX) out.push('PLAN_LAYER_TRANSLUCENT');
  if (judged && f.background > PLAUSIBLE_BACKGROUND_MAX && f.translucent > PLAUSIBLE_BACKGROUND_TRANSLUCENT_MIN) out.push('PLAN_LAYER_BACKGROUND');
  if (f.areaRatio !== null && f.areaRatio > PLAUSIBLE_AREA_RATIO_MAX) out.push('PLAN_LAYER_OVERSIZED');
  return out;
}

/** A share as `12.3%`. */
export function pct(v: number | null): string {
  return v === null ? '-' : `${(v * 100).toFixed(1)}%`;
}

/** An area ratio as `1.681x`. */
export function times(v: number | null): string {
  return v === null ? '-' : `${v.toFixed(3)}x`;
}

/** The figures, as a plan note and a WARN line say them. */
export function figuresPhrase(f: LayerFigures): string {
  return `${pct(f.translucent)} translucent, ${pct(f.background)} background-coloured, ${f.areaRatio === null ? 'no other layer to compare with' : `${times(f.areaRatio)} the rest of the figure`}`;
}

/** What a rule requires, in words, so the line that names it says the bar. */
export function ruleSummary(rule: PlausibilityRule): string {
  const judged = `for a layer at least ${PLAUSIBLE_JUDGED_AREA_RATIO}x the rest of the figure`;
  if (rule === 'PLAN_LAYER_TRANSLUCENT') return `at most ${PLAUSIBLE_TRANSLUCENT_MAX * 100}% translucent (alpha below ${TRANSLUCENT_ALPHA_BELOW}) ${judged}`;
  if (rule === 'PLAN_LAYER_BACKGROUND') {
    return `at most ${PLAUSIBLE_BACKGROUND_MAX * 100}% background-coloured (min channel above ${NEAR_WHITE_MIN}), or at most ${PLAUSIBLE_BACKGROUND_TRANSLUCENT_MIN * 100}% translucent, ${judged}`;
  }
  return `at most ${PLAUSIBLE_AREA_RATIO_MAX}x the rest of the figure`;
}

/** The `layers` line for a hidden-art layer (issue #359): whose art it is, its box and pixels, and that it is never drawn. */
export function hiddenLayerLine(h: HiddenLayer): string {
  return `hidden art: layer "${h.name}" — "${h.of}"'s art where it is covered, box ${h.left},${h.top} to ${h.right},${h.bottom}, ${h.opaquePx} opaque px; never drawn and never a part: assemble reads it as the under of a cut and the cap of a limb segment that take "${h.of}"'s part`;
}

/**
 * The line `layers` prints for an input with no depth (issue #359): a PSD, or
 * a wrapper export of one. The one reading of depth in this package is the
 * turn draft (`propose --full/--head`), and it SKIPs such a run — naming it —
 * rather than drafting a turn from depths nobody measured.
 */
export function depthSkipLine(set: LayerSet): string {
  return `SKIP  depth: ${set.source} carries no depth_median (${set.form === 'psd' ? 'a PSD carries none' : 'null on every layer'}); the draw order is the file's own, and the turn draft (propose --full/--head) skips this run`;
}
