#!/usr/bin/env bun
/**
 * The Spine editor's example atlases measured as a population, and a rigc
 * build's atlas measured by the same instrument (rig-parts #54).
 *
 *     bun tools/atlas_population.ts [--json <file>] [--spine-runtimes <dir>] [<label>=<build dir>] ...
 *
 * - `--spine-runtimes <dir>` is a checkout of `EsotericSoftware/spine-runtimes`
 *   (the directory holding `examples/`). Every `examples/<name>/export/*.atlas`
 *   is one row, labelled by the atlas file's stem, EXCEPT a `-pma` twin: the
 *   editor writes each example twice, once straight and once with premultiplied
 *   colour, same layout. A twin is not a row; its pages are measured once
 *   anyway and printed on a `pma twin:` line beside the straight atlas's figure,
 *   because "premultiplying does not touch alpha" is a claim this tool checks
 *   rather than assumes. A directory whose `export/` holds a skeleton JSON and no
 *   straight atlas is named on a `no atlas:` line and has no row. The skeleton
 *   JSON of a row is `<stem>-pro.json`, else `<stem>-ess.json`, else
 *   `<stem>.json`, else none (the row says so and its figure columns are null).
 *   These files are Esoteric Software's, licensed for evaluating the runtimes:
 *   the directory is read at run time and nothing from it is kept.
 * - `<label>=<build dir>` is a directory holding `skeleton.atlas`, its page(s)
 *   and `skeleton.json` as `rigc build --pack` writes them (`rig-parts build`
 *   puts them in `<out>/check/build/`).
 *
 * The atlas is read by spine-core's own `TextureAtlas` (pages, regions, bounds)
 * and by a line scan that reads the one page field spine-core ignores,
 * `scale:`, and refuses the 3.x region fields (`xy`, `size`, `orig`, `offset`)
 * by name rather than reading them; the two readers must agree on the page and
 * region counts or the atlas is refused. Each column, exactly:
 *
 * - **pages**: count and `WxH` of each (`size:`); every page PNG is decoded and
 *   must be that size.
 * - **regions**: `TextureAtlas.regions.length` — every region entry, alternates
 *   and sequence frames included. `check`'s pack line prints rigc's figure for
 *   the same thing.
 * - **covered %**: Σ bounds w·h over Σ page area. rigc's pack line "covered" is
 *   the same sum (`rig-c/src/atlas.ts`, `occupancy`), rounded the same way
 *   (on the two public examples under `--pack-shape polygon`, rig-c 2.1.3 and 2.10.1,
 *   both read 95.0 %). It is a sum of rectangles, not a union: under
 *   `--pack-shape polygon` a region may sit inside a mesh region's rectangle
 *   where the hull is not, so the rectangles overlap and the figure can exceed
 *   100 % without any pixel being shared. **opaque %** is the measure of what
 *   the page holds.
 * - **opaque %**: pixels with alpha > 0 over page area, through `opaqueShare`
 *   and `readPng` — the call `check` makes for the pack line
 *   (`src/check.ts`, `packOpaque`); the count is that share times the page
 *   area, which is exact below 2^53 px.
 * - **scale**: the atlas's `scale:` (the editor's export scale: atlas px per
 *   skeleton unit). The Spine atlas format page (esotericsoftware.com/spine-atlas-format)
 *   lists no `scale` field and no default, so an absent line is not read as 1:
 *   the column is then the MEASURED ratio Σ atlas original size / Σ attachment
 *   `width`/`height` over every region and mesh attachment of every skin that
 *   names a width and a height, has no `sequence`, and whose region is in the
 *   atlas. Where both exist the measured ratio is printed beside the line, with
 *   how many attachments agree with the effective scale to within 1 px.
 * - **figure**: the setup-pose AABB in skeleton units and in atlas px (w·s ×
 *   h·s), and its area, read off the JSON `skeleton` block (`x y width
 *   height`) on every row. The editor computes that block from the setup pose;
 *   rig-c 2.2.0 and later write it as the setup-pose bounding box too
 *   (firejune/rigc#907; before that rigc wrote the stage it was given, the
 *   crop, and this column read spine-core instead). So a build row's block is
 *   held to spine-core's `Skeleton.getBounds` at the setup pose (default skin,
 *   `Physics.reset`): each of the four must equal rigc's own writing of that
 *   bound, `headerBoxNumber` (`rig-c/src/compile.ts`: the 1e-6 grid at
 *   float32), with nothing tolerated past it, and a block that does not is
 *   refused as `BUILD_HEADER_IS_SETUP_BOUNDS`, quoting both boxes — which is
 *   also what a build from rigc before 2.2.0 gets, its header being the stage
 *   (the demo's 2.1.3 build: 832x1216 at -416, 0 against 662.00006x1195 at
 *   -344, 5). A header with no box (rigc writes none where nothing is drawn at
 *   the setup pose, or no stage is declared) is `BUILD_HEADER_BOX`.
 *   Measured on the two public examples' builds with rig-c 2.10.1: all
 *   eight numbers equal, the raw doubles within 3.0e-5 of the header (demo's
 *   width, 662.00006 written for 662.0000898). selftest `BU07` plants a header
 *   one float32 step off. The same spine-core bounds are printed for an editor
 *   row as a cross-check where spine-core 4.3 can read the 4.2 JSON, with its
 *   refusal where it cannot; the editor's own block is not held to them.
 * - **page / figure**: Σ page area over figure area px. **opaque / figure**:
 *   opaque page px over figure area px.
 * - **setup**: slots whose setup `attachment` is non-null, resolved through the
 *   default skin (the skin named `default`): total drawn (region + mesh, a
 *   `linkedmesh` counted as a mesh), regions, meshes, and other (clipping,
 *   boundingbox, path, point — set but not drawn). A name the default skin
 *   does not hold is counted as unresolved.
 * - **skins**: how many; per non-default skin, the drawn setup attachments it
 *   resolves the way the runtime does (`Skeleton.getAttachment`: that skin,
 *   then the default skin), min–max; and the union: drawn setup attachments
 *   that resolve in ANY skin, the upper bound when skins are combined.
 *
 * Then a summary: min / median / max of every numeric column over (a) every
 * editor row and (b) the figure subset below (the build rows are the thing
 * compared against the population, so they are in neither). A row with no value
 * in a column is left out of that column and the `n` says so.
 *
 * `--json` writes the rows and summaries with fixed key order. No clock, no
 * randomness; rows sorted by label.
 *
 * Figures quoted from this tool carry "measured at spine-runtimes e7dc143".
 * `@esotericsoftware/spine-core` is this repository's development dependency, pinned to
 * the version rig-c develops against (`TY10`); `tools/` is not in
 * `package.json` `files`, so nothing installed depends on this file.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { AtlasAttachmentLoader, Physics, Skeleton, SkeletonJson, TextureAtlas, Vector2 } from '@esotericsoftware/spine-core';
import { headerBoxNumber } from '@rig-c/core/src/compile.ts';
import { opaqueShare, SPINEBOY_YARDSTICK } from '../src/check.ts';
import { readPng } from '../src/raster/png.ts';

/**
 * Summary (b): the editor examples that are one decomposed figure. Out of the
 * list the brief proposed, and why (measured at spine-runtimes e7dc143):
 * `spineboy-run` is ten whole-figure frames of one sequence region with no
 * skeleton JSON, not parts; `spinosaurus` has no atlas in its export and its
 * setup pose draws 5 regions (a menu screen); `stretchyman`'s setup pose
 * draws 5 (1 region, 4 meshes), under {@link DECOMPOSED_FLOOR}. `goblins`,
 * `chibi-stickers` and `mix-and-match` stay although their default skin draws
 * 3, 1 and 0: the figure is assembled from their other skins, which draw
 * 22, 20-33 and 1-51 (76 in union).
 */
const FIGURE_SUBSET = ['alien', 'celestial-circus', 'chibi-stickers', 'dragon', 'goblins', 'hero', 'mix-and-match', 'owl', 'raptor', 'speedy', 'spineboy'];

/** The brief's floor for a decomposed figure: a subset row whose setup pose draws fewer attachments (in its best skin) is named on a `subset:` line. */
const DECOMPOSED_FLOOR = 8;

function usage(msg: string): never {
  console.log(`  FAIL  USAGE: ${msg}`);
  console.log('  bun tools/atlas_population.ts [--json <file>] [--spine-runtimes <dir>] [<label>=<build dir>] ...');
  process.exit(2);
}

class Refusal extends Error {}

// ---------------------------------------------------------------------------
// the atlas
// ---------------------------------------------------------------------------

interface PageFigure {
  width: number;
  height: number;
  opaquePx: number;
}

interface AtlasFigure {
  file: string;
  scaleLine: number | null;
  pages: PageFigure[];
  regions: number;
  boundsArea: number;
  /** name -> [originalWidth, originalHeight] of the first region of that name, the one `TextureAtlas.findRegion` returns. */
  original: Map<string, [number, number]>;
}

const V3_REGION_FIELDS = new Set(['xy', 'size', 'orig', 'offset']);

/** The line scan: page count, region count and each page's `scale:`; 3.x region fields refused. */
function scanAtlas(path: string, text: string): { pages: number; regions: number; scales: (number | null)[] } {
  const lines = text.split(/\r\n|\r|\n/);
  const scales: (number | null)[] = [];
  let regions = 0;
  let state: 'page' | 'page-fields' | 'region' = 'page';
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '') {
      state = 'page';
      continue;
    }
    const colon = t.indexOf(':');
    if (colon === -1) {
      if (state === 'page') {
        scales.push(null);
        state = 'page-fields';
      } else {
        regions++;
        state = 'region';
      }
      continue;
    }
    const key = t.slice(0, colon).trim();
    if (state === 'page') throw new Refusal(`ATLAS_HEADER_FIELD: ${path} line ${i + 1} — "${key}:" before any page name; this reader reads the 4.2 layout, where a page name comes first`);
    if (state === 'page-fields' && key === 'scale') {
      const v = Number(t.slice(colon + 1).trim());
      if (!Number.isFinite(v) || v <= 0) throw new Refusal(`ATLAS_SCALE: ${path} line ${i + 1} — scale "${t.slice(colon + 1).trim()}"; a positive number is required`);
      scales[scales.length - 1] = v;
    }
    if (state === 'region' && V3_REGION_FIELDS.has(key)) {
      throw new Refusal(`ATLAS_3X_FIELD: ${path} line ${i + 1} — region field "${key}:" is the 3.x layout; this reader reads the 4.2 "bounds:"/"offsets:" form only and does not guess at the other`);
    }
  }
  return { pages: scales.length, regions, scales };
}

function readAtlas(path: string): AtlasFigure {
  const text = readFileSync(path, 'utf8');
  const scan = scanAtlas(path, text);
  const atlas = new TextureAtlas(text);
  const problems: string[] = [];
  if (scan.pages !== atlas.pages.length || scan.regions !== atlas.regions.length) {
    problems.push(`ATLAS_READERS_AGREE: ${path} — the line scan reads ${scan.pages} page(s) and ${scan.regions} region(s), spine-core ${atlas.pages.length} and ${atlas.regions.length}`);
  }
  const stated = [...new Set(scan.scales.map((s) => (s === null ? 'none' : String(s))))];
  if (stated.length > 1) problems.push(`ATLAS_SCALE_MIXED: ${path} — pages state scale [${scan.scales.map((s) => (s === null ? 'none' : s)).join(', ')}]; one scale per atlas is required to put a figure in atlas px`);
  const pages: PageFigure[] = [];
  for (const page of atlas.pages) {
    const png = join(dirname(path), page.name);
    if (!existsSync(png)) {
      problems.push(`ATLAS_PAGE_ON_DISK: ${path} — page ${page.name} is not beside the atlas`);
      continue;
    }
    const r = readPng(png);
    if (r.width !== page.width || r.height !== page.height) {
      problems.push(`ATLAS_PAGE_SIZE: ${path} — page ${page.name} decodes to ${r.width}x${r.height}; the atlas says ${page.width}x${page.height}`);
      continue;
    }
    pages.push({ width: page.width, height: page.height, opaquePx: Math.round(opaqueShare(r) * r.width * r.height) });
  }
  if (problems.length > 0) throw new Refusal(problems.join('\n        '));
  const original = new Map<string, [number, number]>();
  for (const reg of atlas.regions) if (!original.has(reg.name)) original.set(reg.name, [reg.originalWidth, reg.originalHeight]);
  return {
    file: basename(path),
    scaleLine: scan.scales[0] ?? null,
    pages,
    regions: atlas.regions.length,
    boundsArea: atlas.regions.reduce((n, reg) => n + reg.width * reg.height, 0),
    original,
  };
}

// ---------------------------------------------------------------------------
// the skeleton JSON, read as JSON (spine-core 4.3 refuses most 4.2 exports)
// ---------------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

function isObj(v: Json | undefined): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

interface Skin {
  name: string;
  /** slot -> attachment name -> attachment */
  attachments: Map<string, Map<string, Obj>>;
}

interface SkeletonFigure {
  file: string;
  block: Aabb | null;
  slots: { name: string; attachment: string | null }[];
  skins: Skin[];
}

export interface Aabb {
  x: number;
  y: number;
  width: number;
  height: number;
}

function readSkeleton(path: string): SkeletonFigure {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Json;
  if (!isObj(raw)) throw new Refusal(`SKELETON_JSON: ${path} — not a JSON object`);
  const head = raw.skeleton;
  let block: Aabb | null = null;
  if (isObj(head)) {
    const x = head.x, y = head.y, w = head.width, h = head.height;
    if (typeof x === 'number' && typeof y === 'number' && typeof w === 'number' && typeof h === 'number') block = { x, y, width: w, height: h };
  }
  const slotsRaw = raw.slots;
  const slots = Array.isArray(slotsRaw)
    ? slotsRaw.filter(isObj).map((s) => ({ name: String(s.name), attachment: typeof s.attachment === 'string' ? s.attachment : null }))
    : [];
  const skinsRaw = raw.skins;
  if (!Array.isArray(skinsRaw)) throw new Refusal(`SKELETON_SKINS: ${path} — "skins" is not an array; the 4.x layout (an array of {name, attachments}) is the one this reads`);
  const skins: Skin[] = skinsRaw.filter(isObj).map((s) => {
    const attachments = new Map<string, Map<string, Obj>>();
    const a = s.attachments;
    if (isObj(a)) {
      for (const slot of Object.keys(a).sort()) {
        const per = a[slot];
        const m = new Map<string, Obj>();
        if (isObj(per)) for (const n of Object.keys(per).sort()) {
          const att = per[n];
          if (isObj(att)) m.set(n, att);
        }
        attachments.set(slot, m);
      }
    }
    return { name: String(s.name), attachments };
  });
  return { file: basename(path), block, slots, skins };
}

type Kind = 'region' | 'mesh' | 'other';

function kindOf(att: Obj): Kind {
  const t = typeof att.type === 'string' ? att.type : 'region';
  if (t === 'region') return 'region';
  if (t === 'mesh' || t === 'linkedmesh') return 'mesh';
  return 'other';
}

interface Setup {
  drawn: number;
  regions: number;
  meshes: number;
  other: number;
  unresolved: number;
}

/** The setup pose's attachments through the runtime lookup: `skin`, then the default skin. */
function setupOf(sk: SkeletonFigure, skin: Skin | null, def: Skin | null): Setup {
  const out: Setup = { drawn: 0, regions: 0, meshes: 0, other: 0, unresolved: 0 };
  for (const s of sk.slots) {
    if (s.attachment === null) continue;
    const att = skin?.attachments.get(s.name)?.get(s.attachment) ?? def?.attachments.get(s.name)?.get(s.attachment);
    if (att === undefined) {
      out.unresolved++;
      continue;
    }
    const k = kindOf(att);
    if (k === 'region') out.regions++;
    else if (k === 'mesh') out.meshes++;
    else out.other++;
  }
  out.drawn = out.regions + out.meshes;
  return out;
}

function unionDrawn(sk: SkeletonFigure): number {
  let n = 0;
  for (const s of sk.slots) {
    if (s.attachment === null) continue;
    const name = s.attachment;
    if (sk.skins.some((skin) => {
      const att = skin.attachments.get(s.name)?.get(name);
      return att !== undefined && kindOf(att) !== 'other';
    })) n++;
  }
  return n;
}

/** Σ atlas original size over Σ attachment width/height, and how many agree with `s` to within 1 px. */
function measuredScale(sk: SkeletonFigure, atlas: AtlasFigure): { pairs: { o: [number, number]; a: [number, number] }[] } {
  const pairs: { o: [number, number]; a: [number, number] }[] = [];
  for (const skin of sk.skins) {
    for (const [, per] of skin.attachments) {
      for (const [name, att] of per) {
        if (kindOf(att) === 'other' || att.sequence !== undefined) continue;
        const w = att.width, h = att.height;
        if (typeof w !== 'number' || typeof h !== 'number' || w <= 0 || h <= 0) continue;
        const regionName = typeof att.path === 'string' ? att.path : typeof att.name === 'string' ? att.name : name;
        const o = atlas.original.get(regionName);
        if (o !== undefined) pairs.push({ o, a: [w, h] });
      }
    }
  }
  return { pairs };
}

/** spine-core's setup-pose bounds, or why it could not read the skeleton. */
function coreBounds(atlasPath: string, jsonPath: string): Aabb | string {
  try {
    const atlas = new TextureAtlas(readFileSync(atlasPath, 'utf8'));
    const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(readFileSync(jsonPath, 'utf8')));
    const sk = new Skeleton(data);
    sk.setupPose();
    sk.updateWorldTransform(Physics.reset);
    const off = new Vector2();
    const size = new Vector2();
    sk.getBounds(off, size, []);
    return { x: off.x, y: off.y, width: size.x, height: size.y };
  } catch (err) {
    return `spine-core 4.3.13 does not read it: ${(err as Error).message}`;
  }
}

const boxText = (b: Aabb): string => `x ${b.x}, y ${b.y}, width ${b.width}, height ${b.height}`;

/**
 * A rigc build's header box against spine-core's setup-pose bounds: `null`
 * where each of the four equals `headerBoxNumber` of the bound (the number
 * rigc writes for it), else the refusal naming the build, both boxes and the
 * fields that differ. `bounds` is spine-core's refusal where it is a string.
 */
export function headerProblem(label: string, header: Aabb | null, bounds: Aabb | string): string | null {
  if (header === null) {
    return `BUILD_HEADER_BOX: ${label} — skeleton.json's "skeleton" block has no numeric x, y, width and height; rig-c 2.2.0 and later write the setup-pose bounding box there (firejune/rigc#907) and none where the setup pose draws nothing or the rig declares no stage, so there is no figure to read`;
  }
  if (typeof bounds === 'string') return `BUILD_HEADER_IS_SETUP_BOUNDS: ${label} — the header cannot be held to the setup pose: ${bounds}`;
  const keys = ['x', 'y', 'width', 'height'] as const;
  const written: Aabb = { x: headerBoxNumber(bounds.x), y: headerBoxNumber(bounds.y), width: headerBoxNumber(bounds.width), height: headerBoxNumber(bounds.height) };
  const off = keys.filter((k) => header[k] !== written[k]);
  if (off.length === 0) return null;
  return `BUILD_HEADER_IS_SETUP_BOUNDS: ${label} — the header box is ${boxText(header)}; spine-core's getBounds at the setup pose is ${boxText(bounds)}, which rigc writes as ${boxText(written)} (headerBoxNumber); they differ on ${off.join(', ')}`;
}

/** {@link headerProblem} over a directory `rigc build --pack` wrote. */
export function buildHeaderProblem(label: string, dir: string): string | null {
  const atlas = join(dir, 'skeleton.atlas');
  const json = join(dir, 'skeleton.json');
  return headerProblem(label, readSkeleton(json).block, coreBounds(atlas, json));
}

// ---------------------------------------------------------------------------
// rows
// ---------------------------------------------------------------------------

interface Row {
  label: string;
  source: 'editor' | 'build';
  atlas: string;
  json: string | null;
  scale: number | null;
  scaleSource: 'scale line' | 'measured' | null;
  scaleLine: number | null;
  scaleMeasured: number | null;
  scaleAgree: string | null;
  pages: number;
  pageSizes: string[];
  pageArea: number;
  regions: number;
  coveredPct: number;
  opaquePct: number;
  opaquePx: number;
  figureSource: string | null;
  figureUnits: { width: number; height: number } | null;
  figurePx: { width: number; height: number } | null;
  figureAreaPx: number | null;
  pagePerFigure: number | null;
  opaquePerFigure: number | null;
  coreBounds: { width: number; height: number } | string | null;
  setup: Setup | null;
  skins: number | null;
  defaultSkin: string | null;
  perSkinMin: number | null;
  perSkinMax: number | null;
  unionDrawn: number | null;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

function row(label: string, source: 'editor' | 'build', atlasPath: string, jsonPath: string | null): Row {
  const atlas = readAtlas(atlasPath);
  const pageArea = atlas.pages.reduce((n, p) => n + p.width * p.height, 0);
  const opaquePx = atlas.pages.reduce((n, p) => n + p.opaquePx, 0);
  const sk = jsonPath === null ? null : readSkeleton(jsonPath);
  let scaleMeasured: number | null = null;
  let pairs: { o: [number, number]; a: [number, number] }[] = [];
  if (sk !== null) {
    pairs = measuredScale(sk, atlas).pairs;
    if (pairs.length > 0) {
      const so = pairs.reduce((n, p) => n + p.o[0] + p.o[1], 0);
      const sa = pairs.reduce((n, p) => n + p.a[0] + p.a[1], 0);
      scaleMeasured = so / sa;
    }
  }
  const scale = atlas.scaleLine ?? scaleMeasured;
  const scaleSource = atlas.scaleLine !== null ? 'scale line' : scaleMeasured !== null ? 'measured' : null;
  const agree = scale === null || pairs.length === 0 ? null : `${pairs.filter((p) => Math.abs(p.o[0] - p.a[0] * scale) <= 1 && Math.abs(p.o[1] - p.a[1] * scale) <= 1).length}/${pairs.length}`;

  let figureSource: string | null = null;
  let units: Aabb | null = null;
  let core: Aabb | string | null = null;
  if (sk !== null && jsonPath !== null) {
    core = coreBounds(atlasPath, jsonPath);
    if (source === 'build') {
      const problem = headerProblem(label, sk.block, core);
      if (problem !== null) throw new Refusal(problem);
    }
    units = sk.block;
    figureSource = units === null ? null : source === 'editor' ? 'skeleton block' : 'skeleton block, held to spine-core setup bounds';
  }
  const figurePx = units === null || scale === null ? null : { width: r1(units.width * scale), height: r1(units.height * scale) };
  const figureAreaPx = units === null || scale === null ? null : units.width * scale * units.height * scale;

  let setup: Setup | null = null;
  let perMin: number | null = null;
  let perMax: number | null = null;
  let def: Skin | null = null;
  if (sk !== null) {
    def = sk.skins.find((s) => s.name === 'default') ?? null;
    setup = setupOf(sk, null, def);
    const others = sk.skins.filter((s) => s !== def).map((s) => setupOf(sk, s, def).drawn);
    const per = others.length > 0 ? others : [setup.drawn];
    perMin = Math.min(...per);
    perMax = Math.max(...per);
  }
  return {
    label,
    source,
    atlas: atlas.file,
    json: sk === null ? null : sk.file,
    scale: scale === null ? null : r3(scale),
    scaleSource,
    scaleLine: atlas.scaleLine,
    scaleMeasured: scaleMeasured === null ? null : r3(scaleMeasured),
    scaleAgree: agree,
    pages: atlas.pages.length,
    pageSizes: atlas.pages.map((p) => `${p.width}x${p.height}`),
    pageArea,
    regions: atlas.regions,
    coveredPct: r1((atlas.boundsArea / pageArea) * 100),
    opaquePct: r1((opaquePx / pageArea) * 100),
    opaquePx,
    figureSource,
    figureUnits: units === null ? null : { width: r1(units.width), height: r1(units.height) },
    figurePx,
    figureAreaPx: figureAreaPx === null ? null : Math.round(figureAreaPx),
    pagePerFigure: figureAreaPx === null ? null : r3(pageArea / figureAreaPx),
    opaquePerFigure: figureAreaPx === null ? null : r3(opaquePx / figureAreaPx),
    coreBounds: core === null ? null : typeof core === 'string' ? core : { width: r1(core.width), height: r1(core.height) },
    setup,
    skins: sk === null ? null : sk.skins.length,
    defaultSkin: sk === null ? null : def === null ? 'none' : def.name,
    perSkinMin: perMin,
    perSkinMax: perMax,
    unionDrawn: sk === null ? null : unionDrawn(sk),
  };
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

const COLUMNS: [string, (r: Row) => number | null][] = [
  ['pages', (r) => r.pages],
  ['pageArea', (r) => r.pageArea],
  ['regions', (r) => r.regions],
  ['coveredPct', (r) => r.coveredPct],
  ['opaquePct', (r) => r.opaquePct],
  ['opaquePx', (r) => r.opaquePx],
  ['scale', (r) => r.scale],
  ['figureAreaPx', (r) => r.figureAreaPx],
  ['pagePerFigure', (r) => r.pagePerFigure],
  ['opaquePerFigure', (r) => r.opaquePerFigure],
  ['setupDrawn', (r) => r.setup?.drawn ?? null],
  ['setupRegions', (r) => r.setup?.regions ?? null],
  ['setupMeshes', (r) => r.setup?.meshes ?? null],
  ['perSkinMax', (r) => r.perSkinMax],
  ['unionDrawn', (r) => r.unionDrawn],
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface Stat {
  column: string;
  n: number;
  min: number | null;
  median: number | null;
  max: number | null;
}

function summarise(rows: Row[]): Stat[] {
  return COLUMNS.map(([column, get]) => {
    const xs = rows.map(get).filter((v): v is number => v !== null);
    return xs.length === 0 ? { column, n: 0, min: null, median: null, max: null } : { column, n: xs.length, min: Math.min(...xs), median: r3(median(xs)), max: Math.max(...xs) };
  });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function show(r: Row): string {
  const fig = r.figureUnits === null ? 'figure none' : `figure ${r.figureUnits.width}x${r.figureUnits.height} u = ${r.figurePx?.width ?? '?'}x${r.figurePx?.height ?? '?'} px (${r.figureSource}), area ${r.figureAreaPx ?? '?'} px`;
  const core = r.coreBounds === null ? '' : typeof r.coreBounds === 'string' ? `; core bounds: ${r.coreBounds}` : `; core bounds ${r.coreBounds.width}x${r.coreBounds.height} u`;
  const setup = r.setup === null ? 'setup none' : `setup ${r.setup.drawn} drawn (${r.setup.regions} region, ${r.setup.meshes} mesh), ${r.setup.other} other, ${r.setup.unresolved} unresolved in skin "${r.defaultSkin}"; skins ${r.skins}, per skin ${r.perSkinMin}-${r.perSkinMax}, union ${r.unionDrawn}`;
  return [
    `${r.label}  [${r.source}] ${r.atlas} + ${r.json ?? 'no skeleton JSON'}`,
    `      scale ${r.scale ?? 'none'} (${r.scaleSource ?? 'no scale line and nothing to measure it by'}${r.scaleLine !== null && r.scaleMeasured !== null ? `; measured ${r.scaleMeasured}` : ''}${r.scaleAgree === null ? '' : `; ${r.scaleAgree} attachments within 1 px`})`,
    `      ${r.pages} page(s) ${r.pageSizes.join(' ')}, ${r.regions} region(s), ${r.coveredPct.toFixed(1)}% covered, ${r.opaquePct.toFixed(1)}% opaque (alpha > 0), ${r.opaquePx} opaque px`,
    `      ${fig}; page/figure ${r.pagePerFigure ?? 'none'}, opaque/figure ${r.opaquePerFigure ?? 'none'}${core}`,
    `      ${setup}`,
  ].join('\n');
}

function jsonOf(dir: string, stem: string): string | null {
  for (const f of [`${stem}-pro.json`, `${stem}-ess.json`, `${stem}.json`]) if (existsSync(join(dir, f))) return join(dir, f);
  return null;
}

function main(argv: string[]): void {
  let json: string | null = null;
  let runtimes: string | null = null;
  const builds: [string, string][] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '--spine-runtimes') {
      const v = argv[++i];
      if (v === undefined) usage(`${a} needs a value`);
      if (a === '--json') json = v;
      else runtimes = v;
    } else if (a.includes('=')) {
      const eq = a.indexOf('=');
      builds.push([a.slice(0, eq), a.slice(eq + 1)]);
    } else usage(`unknown argument "${a}"`);
  }
  if (runtimes === null && builds.length === 0) usage('name --spine-runtimes <dir> or at least one <label>=<build dir>');

  const rows: Row[] = [];
  const notes: string[] = [];
  const problems: string[] = [];
  const attempt = (f: () => void): void => {
    try {
      f();
    } catch (err) {
      if (err instanceof Refusal) problems.push(err.message);
      else throw err;
    }
  };

  if (runtimes !== null) {
    const ex = join(runtimes, 'examples');
    if (!existsSync(ex)) usage(`--spine-runtimes ${runtimes}: no examples/ directory in it`);
    for (const name of readdirSync(ex).sort()) {
      const dir = join(ex, name, 'export');
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).sort();
      const straight = files.filter((f) => f.endsWith('.atlas') && !f.endsWith('-pma.atlas'));
      if (straight.length === 0) {
        const js = files.filter((f) => f.endsWith('.json'));
        notes.push(`no atlas: ${name} — export/ holds ${js.length} skeleton JSON and no straight .atlas; no row`);
      }
      for (const f of straight) {
        const stem = f.slice(0, -'.atlas'.length);
        attempt(() => {
          const r = row(stem, 'editor', join(dir, f), jsonOf(dir, stem));
          rows.push(r);
          const twin = join(dir, `${stem}-pma.atlas`);
          if (existsSync(twin)) {
            const t = readAtlas(twin);
            const tOpaque = t.pages.reduce((n, p) => n + p.opaquePx, 0);
            notes.push(`pma twin: ${stem}-pma.atlas — ${t.pages.length} page(s), ${t.regions} region(s), ${tOpaque} opaque px; straight ${r.pages} page(s), ${r.regions} region(s), ${r.opaquePx} opaque px: ${tOpaque === r.opaquePx && t.regions === r.regions && t.pages.length === r.pages ? 'equal' : 'DIFFERS'}`);
          }
        });
      }
    }
  }
  for (const [label, dir] of builds) {
    attempt(() => {
      for (const f of ['skeleton.atlas', 'skeleton.json']) if (!existsSync(join(dir, f))) throw new Refusal(`BUILD_DIR: ${label}=${dir} — no ${f}; a directory rigc build --pack wrote is required`);
      rows.push(row(label, 'build', join(dir, 'skeleton.atlas'), join(dir, 'skeleton.json')));
    });
  }
  const labels = rows.map((r) => r.label);
  const dup = labels.filter((l, i) => labels.indexOf(l) !== i);
  if (dup.length > 0) problems.push(`LABEL_UNIQUE: label(s) [${[...new Set(dup)].join(', ')}] name more than one row`);
  if (problems.length > 0) {
    for (const p of problems) console.log(`  FAIL  ${p}`);
    process.exit(2);
  }
  rows.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

  console.log(`atlas population: ${rows.length} row(s)`);
  for (const r of rows) console.log(show(r));
  for (const n of notes.sort()) console.log(n);

  const editor = rows.filter((r) => r.source === 'editor');
  const figures = editor.filter((r) => FIGURE_SUBSET.includes(r.label));
  if (runtimes !== null) {
    const missing = FIGURE_SUBSET.filter((l) => !figures.some((r) => r.label === l));
    if (missing.length > 0) console.log(`subset: [${missing.join(', ')}] named in the figure subset and not rows here`);
    for (const r of figures) {
      const most = Math.max(r.setup?.drawn ?? 0, r.perSkinMax ?? 0, r.unionDrawn ?? 0);
      if (most < DECOMPOSED_FLOOR) console.log(`subset: ${r.label} draws at most ${most} setup attachment(s), under ${DECOMPOSED_FLOOR}`);
    }
    const sb = rows.find((r) => r.label === 'spineboy' && r.source === 'editor');
    if (sb !== undefined) {
      const line = `${sb.pageSizes.join(' ')}, ${sb.regions} region(s), ${sb.opaquePct.toFixed(1)}% opaque (alpha > 0)`;
      console.log(`yardstick: spineboy.atlas reads "${line}"; SPINEBOY_YARDSTICK is "${SPINEBOY_YARDSTICK}": ${line === SPINEBOY_YARDSTICK ? 'agrees' : 'DIFFERS'}`);
    }
  }
  const sums = { all: summarise(editor), figures: summarise(figures) };
  for (const [name, stats, n] of [['(a) every editor row', sums.all, editor.length], ['(b) figure subset', sums.figures, figures.length]] as const) {
    console.log(`summary ${name}, ${n} row(s): min / median / max (n)`);
    for (const s of stats) console.log(`  ${s.column.padEnd(16)} ${s.n === 0 ? 'none' : `${s.min} / ${s.median} / ${s.max} (${s.n})`}`);
  }
  if (json !== null) {
    writeFileSync(json, `${JSON.stringify({ rows, notes: notes.sort(), subset: FIGURE_SUBSET, summary: sums }, null, 1)}\n`);
    console.log(`wrote ${json}`);
  }
}

if (import.meta.main) main(process.argv.slice(2));
