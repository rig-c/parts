/** Explicit opt-in commands for provider maps on already assembled parts (#897).
 * No existing assembly/build path calls these stages. All inputs validate before
 * the first output is emitted; output directories must be absent or empty.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { refuseStaleAssembly } from './assembly-reading.ts';
import { PartsError, type Problem } from './errors.ts';
import { loadConfigAndAnimations, parseConfig } from './config.ts';
import { relocateConfigReferences } from './configrelocation.ts';
import { depthReading, readSourceDepth } from './depthsheets.ts';
import { readEditorReceipts } from './editreceipt.ts';
import { alphaSupport, depthMapFail as fail, floatBox, integrateNormals, mapQuantile, mapToSheet, readNumericMap, type NumericMap } from './depthmaps.ts';
import { depthImageReference, partImageReference, readParts } from './parts.ts';
import { readPartSet, type PartSet } from './propose.ts';
import { decodePngBytes, encodePngBytes } from './raster/png.ts';
import { resize } from './raster/resize.ts';
import { connectedComponents } from './raster/components.ts';
import { newRaster, type Raster } from './raster/types.ts';

type Obj = Record<string, unknown>;
interface PrepareOptions { longSide: number; paddingFraction: number; padding: number }
interface Group { median?: never; near: 'black' | 'white'; zScale: number; pivot: number; unitDepths?: Record<string, number> }
interface PartMap { map: string; source: 'depth' | 'normals'; frame: 'part' | 'upscaled' | 'input'; group: string; median: number; relief: number }
interface Placement { map: string; near: Group['near']; scale: number; anchor: string; pivot?: 'anchor' | number; round?: string[] }
export interface DepthRecipe { spec: 'rig-parts-depth/1'; prepare: PrepareOptions; groups: Record<string, Group>; parts: Record<string, PartMap>; clear: string[]; place?: Placement }
interface PreparedPart { part: string; crop: number[]; sourceSha256: string; input: string; inputSha256: string; size: number[]; upscaled: number[]; upscale: number; padding: number; inputSize: number[] }
interface Prepared { spec: 'rig-parts-depth-inputs/1'; partsSha256: string; recipeSha256: string; background: number; alpha: number; parts: PreparedPart[] }
const hash = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const text = (raw: unknown): string => JSON.stringify(raw, null, 2) + '\n';
/** The next binary64 value above a finite, nonnegative depth bound. */
function aboveDepthBound(bound: number): number {
  if (bound === 0) return Number.MIN_VALUE;
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, bound);
  bits.setBigUint64(0, bits.getBigUint64(0) + 1n);
  return bits.getFloat64(0);
}
function object(raw: unknown, at: string): Obj {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fail('DEPTH_RECIPE', at, 'requires an object with the documented fields');
  return raw as Obj;
}
function keys(o: Obj, allowed: readonly string[], at: string): void {
  const unknown = Object.keys(o).filter(k => !allowed.includes(k));
  if (unknown.length) fail('DEPTH_RECIPE', at, `unknown fields ${unknown.join(', ')}; allowed: ${allowed.join(', ')}`);
}
function number(raw: unknown, at: string, min: number, inclusive = true): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || (inclusive ? raw < min : raw <= min)) return fail('DEPTH_RECIPE_NUMBER', at, `is ${String(raw)}; an explicit finite number ${inclusive ? '>=' : '>'} ${min} is required`);
  return raw;
}
function readJson(file: string): unknown {
  if (!existsSync(file) || !statSync(file).isFile()) return fail('DEPTH_INPUT_PRESENT', file, 'is missing or not a file; restore the declared input');
  try { return JSON.parse(readFileSync(file, 'utf8')) as unknown; }
  catch { return fail('DEPTH_INPUT_JSON', file, 'is not valid JSON; finite numeric JSON data is required'); }
}
function plain(name: string, at: string): void {
  if (!name || name.startsWith('.') || /[\\/]/.test(name) || name.includes('\0')) fail('DEPTH_RECIPE', at, `name "${name}" is not a plain part filename`);
}
export function parseDepthRecipe(raw: unknown): DepthRecipe {
  const { recipe, place } = readDepthRecipe(raw);
  if (place === undefined) return recipe;
  const { scale } = place;
  if (!isPlacementScale(scale)) throw new PartsError([placementScaleProblem(scale)]);
  return { ...recipe, place: { ...place, scale } };
}
function readDepthRecipe(raw: unknown): { recipe: DepthRecipe; place?: Omit<Placement, 'scale'> & { scale: unknown } } {
  const o = object(raw, 'depth recipe'); keys(o, ['spec', 'prepare', 'groups', 'parts', 'clear', 'place'], 'depth recipe');
  if (o.spec !== 'rig-parts-depth/1') fail('DEPTH_RECIPE', 'spec', 'requires rig-parts-depth/1');
  const p = object(o.prepare, 'prepare'); keys(p, ['longSide', 'paddingFraction', 'padding'], 'prepare');
  const prepare = { longSide: number(p.longSide, 'prepare.longSide', 1), paddingFraction: number(p.paddingFraction, 'prepare.paddingFraction', 0), padding: number(p.padding, 'prepare.padding', 0) };
  if (!Number.isSafeInteger(prepare.longSide) || !Number.isSafeInteger(prepare.padding)) fail('DEPTH_RECIPE_NUMBER', 'prepare', 'longSide and padding must be explicit safe integers');
  const groups: Record<string, Group> = {};
  for (const [name, value] of Object.entries(object(o.groups, 'groups'))) {
    if (!['head', 'body'].includes(name)) fail('DEPTH_RECIPE', `groups.${name}`, 'requires head or body, matching config.turn or config.turn.body');
    const g = object(value, `groups.${name}`); keys(g, ['near', 'zScale', 'pivot', 'unitDepths'], `groups.${name}`);
    if (g.near !== 'white' && g.near !== 'black') fail('DEPTH_RECIPE', `groups.${name}.near`, `is ${String(g.near)}; explicit white or black is required`);
    const unitDepths: Record<string, number> = {};
    if (g.unitDepths !== undefined) for (const [part, v] of Object.entries(object(g.unitDepths, `groups.${name}.unitDepths`))) unitDepths[part] = number(v, `groups.${name}.unitDepths.${part}`, -Infinity);
    groups[name] = { near: g.near, zScale: number(g.zScale, `groups.${name}.zScale`, 0, false), pivot: number(g.pivot, `groups.${name}.pivot`, -Infinity), ...(g.unitDepths === undefined ? {} : { unitDepths }) };
  }
  const parts: Record<string, PartMap> = {};
  for (const [name, value] of Object.entries(object(o.parts, 'parts'))) {
    plain(name, `parts.${name}`); const p = object(value, `parts.${name}`); keys(p, ['map', 'source', 'frame', 'group', 'median', 'relief'], `parts.${name}`);
    if (typeof p.map !== 'string' || !p.map) fail('DEPTH_RECIPE', `parts.${name}.map`, 'requires a declared numeric JSON map filename relative to the recipe');
    if (p.source !== 'depth' && p.source !== 'normals') fail('DEPTH_RECIPE', `parts.${name}.source`, 'requires depth or normals');
    if (p.frame !== 'part' && p.frame !== 'upscaled' && p.frame !== 'input') fail('DEPTH_RECIPE', `parts.${name}.frame`, 'requires part, upscaled or input; registration is never inferred from dimensions');
    if (typeof p.group !== 'string' || !Object.hasOwn(groups, p.group)) fail('DEPTH_RECIPE', `parts.${name}.group`, 'must resolve to a declared group');
    parts[name] = { map: p.map, source: p.source, frame: p.frame, group: p.group, median: number(p.median, `parts.${name}.median`, -Infinity), relief: number(p.relief, `parts.${name}.relief`, 0) };
  }
  if (!Object.keys(parts).length) fail('DEPTH_RECIPE', 'parts', 'requires at least one named part');
  if (!Array.isArray(o.clear) || !o.clear.every(n => typeof n === 'string') || new Set(o.clear).size !== o.clear.length) fail('DEPTH_RECIPE', 'clear', 'requires an explicit array of unique part names, [] when none; no sheet is dropped implicitly');
  for (const name of o.clear as string[]) { plain(name, 'clear'); if (Object.hasOwn(parts, name)) fail('DEPTH_RECIPE', `clear.${name}`, 'also has a new map; choose clear or apply'); }
  const recipe: DepthRecipe = { spec: 'rig-parts-depth/1', prepare, groups, parts, clear: o.clear as string[] };
  if (o.place === undefined) return { recipe };
  const at = 'place', place = object(o.place, at);
  keys(place, ['map', 'near', 'scale', 'anchor', 'pivot', 'round'], at);
  if (typeof place.map !== 'string' || !place.map.trim()) return fail('DEPTH_RECIPE', 'place.map', 'requires a numeric JSON map in the painting frame');
  if (place.near !== 'black' && place.near !== 'white') return fail('DEPTH_PLACE_NEAR', 'place.near', `is ${bindingFound(place.near)}; declare black or white for the painting map`);
  if (typeof place.anchor !== 'string' || !place.anchor) return fail('DEPTH_PLACE_ANCHOR', 'place.anchor', 'requires the name of the body turn\'s first surface');
  plain(place.anchor, 'place.anchor');
  const pivot = place.pivot === undefined || place.pivot === 'anchor' ? place.pivot : number(place.pivot, 'place.pivot', -Infinity);
  const round = place.round;
  if (round !== undefined && (!Array.isArray(round) || !round.every(n => typeof n === 'string') || new Set(round).size !== round.length)) {
    return fail('DEPTH_PLACE_ROUND', 'place.round', 'requires an array of unique recipe part names');
  }
  return { recipe, place: { map: place.map, near: place.near, scale: place.scale, anchor: place.anchor,
    ...(pivot === undefined ? {} : { pivot }), ...(round === undefined ? {} : { round }) } };
}
function isPlacementScale(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0;
}
function placementScaleProblem(raw: unknown): Problem {
  return { code: 'DEPTH_PLACE_SCALE', object: 'place.scale', detail: `is ${bindingFound(raw)}; declare a finite number > 0 (rig px per map unit)` };
}
function emptyOutput(out: string, inputs: readonly string[]): void {
  const canonical = (p: string): string => existsSync(p) ? realpathSync(p) : resolve(canonical(dirname(resolve(p))), basename(p));
  const target = canonical(out);
  for (const input of inputs) {
    const path = canonical(input), r = relative(target, path), back = relative(path, target);
    if (r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !r.startsWith(sep))) fail('DEPTH_OUTPUT_EMPTY', out, 'contains or is an input path; use a separate absent or empty output directory');
    if (existsSync(input) && statSync(input).isDirectory() && back !== '..' && !back.startsWith(`..${sep}`) && !back.startsWith(sep)) fail('DEPTH_OUTPUT_EMPTY', out, 'is inside an input directory; choose a separate output so source inputs remain read-only');
  }
  if (existsSync(out) && (!statSync(out).isDirectory() || readdirSync(out).length !== 0)) fail('DEPTH_OUTPUT_EMPTY', out, 'is not an empty directory; choose an absent or empty output, never overwrite inputs or old evidence');
}
function preparedParts(partsDir: string, recipe: DepthRecipe): { manifest: Prepared; images: Map<string, Uint8Array> } {
  const set = readPartSet(partsDir), images = new Map<string, Uint8Array>(), parts: PreparedPart[] = [];
  for (const name of [...Object.keys(recipe.parts), ...recipe.clear]) if (!set.recs.some(p => p.name === name)) fail('DEPTH_PART_RESOLVES', name, 'names no assembled part; use exact parts.json names');
  for (const part of set.recs.filter(p => Object.hasOwn(recipe.parts, p.name))) {
    const art = set.images.get(part.name) as Raster, { longSide, paddingFraction, padding } = recipe.prepare;
    const upscale = Math.max(1, Math.ceil(longSide / Math.max(art.width, art.height))), w = art.width * upscale, h = art.height * upscale;
    const pad = Math.floor(Math.max(w, h) * paddingFraction) + padding, big = resize(art, w, h, 'lanczos3'), input = newRaster(w + pad * 2, h + pad * 2);
    for (let i = 0; i < input.width * input.height; i++) input.data.set([128, 128, 128, 255], i * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, j = ((y + pad) * input.width + x + pad) * 4, a = big.data[i + 3];
      for (let c = 0; c < 3; c++) input.data[j + c] = Math.floor((big.data[i + c] * a + 128 * (255 - a) + 127) / 255);
    }
    if (!alphaSupport(art).some(Boolean)) fail('DEPTH_MAP_SUPPORT', part.name, 'has no alpha>=128 pixels; a supported part is required');
    const bytes = encodePngBytes(input), file = `${part.name}.png`; images.set(file, bytes);
    parts.push({ part: part.name, crop: [part.x, part.y, part.w, part.h], sourceSha256: hash(readFileSync(join(partsDir, partImageReference(part).path))), input: file, inputSha256: hash(bytes), size: [art.width, art.height], upscaled: [w, h], upscale, padding: pad, inputSize: [input.width, input.height] });
  }
  return { manifest: { spec: 'rig-parts-depth-inputs/1', partsSha256: hash(readFileSync(join(partsDir, 'parts.json'))), recipeSha256: hash(text(recipe)), background: 128, alpha: 128, parts }, images };
}
export function prepareDepth(input: { parts: string; config: string; out: string }): Prepared {
  const recipe = parseDepthRecipe(readJson(input.config));
  emptyOutput(input.out, [input.parts, input.config]);
  const { manifest, images } = preparedParts(input.parts, recipe);
  mkdirSync(input.out, { recursive: true });
  for (const [file, bytes] of images) writeFileSync(join(input.out, file), bytes);
  writeFileSync(join(input.out, 'manifest.json'), text(manifest));
  return manifest;
}

type RoundPlacement = {
  sections: number;
  invertedSections: number;
  scale: number | null;
  iqr: [number, number] | null;
};
interface PlacementSample {
  part: string;
  group: 'body';
  visibleCount: number;
  visibleFraction: number;
  rawMedian: number;
  rawP5: number;
  rawP95: number;
  reliefRatio: number | null;
  round?: RoundPlacement;
}
export type DepthPlacementTurnCheck = { status: 'built' } | {
  status: 'refused';
  stage: 'prepare' | 'apply' | 'rig';
  problems: readonly Problem[];
  winding: readonly {
    rule: string; animation: string; part: string; attachment: string; key: number;
    endKey?: number; reversedTriangles: number; triangles: number; frame?: string;
  }[];
};
export interface DepthPlacementReport {
  spec: 'rig-parts-depth-place-report/1';
  near: Placement['near'];
  scale: number;
  anchor: string;
  pivot: number;
  parts: Array<PlacementSample & { rigMedian: number; impliedRelief: number | null }>;
  turnCheck?: DepthPlacementTurnCheck;
}
type DepthPlacementInput = { parts: string; config: string; rigConfig: string; out: string };

/** The projection uses the full silhouette for its axis and section widths,
 * and only pixels owned by this part for its regression ordinates. */
function roundPlacement(support: readonly number[], artWidth: number, valueAt: (i: number) => number | undefined, near: Placement['near']): RoundPlacement {
  let sx = 0, sy = 0;
  for (const i of support) { sx += i % artWidth; sy += Math.floor(i / artWidth); }
  const cx = sx / support.length, cy = sy / support.length;
  let xx = 0, xy = 0, yy = 0;
  for (const i of support) {
    const x = i % artWidth - cx, y = Math.floor(i / artWidth) - cy;
    xx += x * x; xy += x * y; yy += y * y;
  }
  if (xx === yy && xy === 0) return { sections: 0, invertedSections: 0, scale: null, iqr: null };
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  const [c, s] = xy === 0 ? (xx > yy ? [1, 0] : [0, 1]) : [Math.cos(angle), Math.sin(angle)];
  const points = support.map(i => {
    const x = i % artWidth - cx, y = Math.floor(i / artWidth) - cy;
    return { i, along: x * c + y * s, across: -x * s + y * c };
  });
  const start = points.reduce((min, p) => Math.min(min, p.along), Infinity);
  const bands = new Map<number, { lo: number; hi: number; visible: Array<{ across: number; value: number }> }>();
  for (const { i, along, across } of points) {
    const k = Math.floor((along - start) / 4);
    let band = bands.get(k);
    if (band === undefined) { band = { lo: across, hi: across, visible: [] }; bands.set(k, band); }
    band.lo = Math.min(band.lo, across);
    band.hi = Math.max(band.hi, across);
    const value = valueAt(i);
    if (value !== undefined) band.visible.push({ across, value: near === 'black' ? value : -value });
  }
  const scales: number[] = [];
  let invertedSections = 0;
  for (const { lo, hi, visible } of bands.values()) {
    const r = (hi - lo) / 2, center = (hi + lo) / 2;
    if (r === 0) continue;
    const samples = visible.flatMap(({ across, value }) => {
      const v = Math.abs(across - center);
      if (v > 0.8 * r) return [];
      // Rationalized r - sqrt(r*r - v*v) keeps shallow sagitta samples distinct.
      return [{ g: v * v / (r + Math.sqrt(r * r - v * v)), value }];
    });
    if (samples.length < 2 || samples.every(({ g }) => g === samples[0].g)) continue;
    const baseline = samples[0].value;
    let sumG = 0, sumZ = 0;
    for (const { g, value } of samples) { sumG += g; sumZ += value - baseline; }
    const meanG = sumG / samples.length, meanZ = sumZ / samples.length;
    let variance = 0, covariance = 0;
    for (const { g, value } of samples) {
      variance += (g - meanG) ** 2;
      covariance += (g - meanG) * (value - baseline - meanZ);
    }
    if (variance === 0) continue;
    const slope = covariance / variance, scale = 1 / slope;
    if (!Number.isFinite(slope) || (slope > 0 && !Number.isFinite(scale))) {
      return fail('DEPTH_MAP_FORMAT', 'place.map', 'round-section regression overflows; provide representable raw depths');
    }
    if (slope <= 0) invertedSections++;
    else scales.push(scale);
  }
  scales.sort((a, b) => a - b);
  return { sections: scales.length + invertedSections, invertedSections,
    scale: scales.length === 0 ? null : mapQuantile(scales, 0.5),
    iqr: scales.length === 0 ? null : [mapQuantile(scales, 0.25), mapQuantile(scales, 0.75)] };
}

function placementSamples(set: PartSet, map: NumericMap, reliefs: ReadonlyMap<string, number>, place: Omit<Placement, 'scale'>, selected: ReadonlySet<string>): PlacementSample[] {
  const roundNames = new Set(place.round);
  // Iterate front-to-back so a pixel can be claimed only once, including by
  // layers not selected for placement. Scan the stored crop, in rig pixels.
  const claimed = new Uint8Array(map.data.length);
  const rows: PlacementSample[] = [], problems: Problem[] = [];
  for (const p of [...set.recs].reverse()) {
    const art = set.images.get(p.name)!;
    const support = alphaSupport(art), values: number[] = [], roundSupport: number[] = [];
    const roundValues = roundNames.has(p.name) ? new Map<number, number>() : undefined;
    const measure = selected.has(p.name);
    let supportCount = 0;
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const local = y * p.w + x;
      if (!support[local]) continue;
      if (roundValues !== undefined) roundSupport.push(local);
      if (measure) supportCount++;
      const pixel = (p.y + y) * map.width + p.x + x;
      if (claimed[pixel]) continue;
      claimed[pixel] = 1;
      if (measure) values.push(map.data[pixel]);
      roundValues?.set(local, map.data[pixel]);
    }
    if (!measure) continue;
    if (values.length === 0) {
      problems.push({ code: 'DEPTH_PLACE_OCCLUDED', object: `part "${p.name}"`,
        detail: `has no visible pixels (0 of ${supportCount} with alpha>=128); at least one topmost pixel is required for a median` });
      continue;
    }
    values.sort((a, b) => a - b);
    const constant = values[0] === values[values.length - 1] ? values[0] : undefined;
    const rawMedian = constant ?? mapQuantile(values, 0.5);
    const rawP5 = constant ?? mapQuantile(values, 0.05), rawP95 = constant ?? mapQuantile(values, 0.95);
    const span = rawP95 - rawP5, relief = reliefs.get(p.name);
    const ratio = relief === undefined || span <= 0 ? null : relief / span;
    if (!Number.isFinite(span)) return fail('DEPTH_MAP_FORMAT', `part "${p.name}"`, 'visible p5-p95 span overflows; provide representable raw depths');
    rows.push({ part: p.name, group: 'body', visibleCount: values.length,
      visibleFraction: values.length / supportCount, rawMedian, rawP5, rawP95, reliefRatio: Number.isFinite(ratio) ? ratio : null,
      ...(roundValues === undefined ? {} : { round: roundPlacement(roundSupport, p.w, i => roundValues.get(i), place.near) }) });
  }
  if (problems.length) throw new PartsError(problems);
  return rows.reverse();
}

function checkPlacementScale(scale: unknown, samples: readonly PlacementSample[], reliefs: ReadonlyMap<string, number>): number {
  const problems: Problem[] = [];
  const validScale = isPlacementScale(scale) ? scale : undefined;
  if (validScale === undefined) {
    problems.push(placementScaleProblem(scale));
    for (const { part, reliefRatio, rawP5, rawP95, round } of samples) {
      const relief = !reliefs.has(part) ? 'unavailable (no body recipe relief)'
        : reliefRatio === null ? `unavailable (p5=${rawP5}, p95=${rawP95})` : String(reliefRatio);
      const fit = round === undefined ? '' : `; implied round scale for "${part}" = ${round.scale ?? 'unavailable'}, IQR=${round.iqr?.join('..') ?? 'unavailable'}, sections=${round.sections}`;
      problems.push({ code: 'DEPTH_PLACE_SCALE', object: 'place.scale', detail: `implied relief ratio for "${part}" = ${relief}${fit}` });
    }
  }
  for (const { part, round } of samples) {
    if (round === undefined) continue;
    if (round.sections === 0) problems.push({ code: 'DEPTH_PLACE_ROUND', object: `part "${part}"`, detail: 'has 0 measurable round sections; visible samples at distinct sagittae are required on a resolved principal axis' });
    else if (round.invertedSections > 0) problems.push({ code: 'DEPTH_PLACE_ROUND', object: `part "${part}"`,
      detail: `${round.invertedSections} of ${round.sections} fitted sections (fraction ${round.invertedSections / round.sections}) have a non-positive slope; required edges farther than the centre under place.near` });
  }
  if (validScale === undefined || problems.length) throw new PartsError(problems);
  return validScale;
}

/** Validate once, then write paths relative to each chosen destination. */
export function stageDepthPlacement(input: DepthPlacementInput): {
  report: DepthPlacementReport;
  write(out: string, turnCheck?: DepthPlacementTurnCheck): { recipe: string; config: string };
} {
  const recipeDir = dirname(resolve(input.config)), configDir = dirname(resolve(input.rigConfig));
  const { recipe, place } = readDepthRecipe(readJson(input.config));
  if (place === undefined) return fail('DEPTH_RECIPE', 'place', 'is absent; declare the painting map, near, scale and anchor');
  const mapFile = resolve(recipeDir, place.map);
  const maps = Object.values(recipe.parts).flatMap(p => { const file = resolve(recipeDir, p.map); return [file, file + '.binding.json']; });
  const sources = [resolve(input.parts), resolve(input.config), resolve(input.rigConfig), mapFile, ...maps];
  emptyOutput(input.out, sources);
  const set = readPartSet(input.parts), names = new Set(set.recs.map(p => p.name));
  const missing = [...Object.keys(recipe.parts), ...recipe.clear].filter(name => !names.has(name));
  if (missing.length) throw new PartsError(missing.map(name => ({ code: 'DEPTH_PART_RESOLVES', object: name, detail: 'names no assembled part; use exact parts.json names' })));
  const map = readNumericMap(readJson(mapFile), 'place.map');
  if (map.channels !== 1) return fail('DEPTH_MAP_FORMAT', 'place.map', 'requires a single scalar depth channel');
  if (map.width !== set.W || map.height !== set.H) {
    return fail('DEPTH_MAP_SIZE', 'place.map', `is ${map.width}x${map.height}; painting frame (parts.json rig_size) requires ${set.W}x${set.H}`);
  }
  const raw = object(readJson(input.rigConfig), 'rig config');
  const config = parseConfig(raw), body = config.turn?.body;
  if (body === undefined || !Object.hasOwn(recipe.groups, 'body')) {
    return fail('DEPTH_PLACE_GROUP', 'config.turn.body', 'requires a declared 2.5D body turn and a body depth recipe group');
  }
  const firstSurface = Object.entries(body.roles).find(([, role]) => role === 'surface')?.[0];
  if (firstSurface !== place.anchor || !Object.hasOwn(recipe.parts, place.anchor) || recipe.parts[place.anchor].group !== 'body') {
    return fail('DEPTH_PLACE_ANCHOR', 'place.anchor', `names "${place.anchor}"; required the first body surface (${JSON.stringify(firstSurface)}) declared in recipe.parts for the body group`);
  }
  const reliefs = new Map(Object.entries(recipe.parts).filter(([, p]) => p.group === 'body').map(([name, p]) => [name, p.relief]));
  const selected = new Set(reliefs.keys());
  const groupProblems = [...selected].filter(part => !Object.hasOwn(body.roles, part)).map(part => ({
    code: 'DEPTH_GROUP_BINDING', object: part, detail: 'declares the body group; register the part in config.turn.body.roles',
  }));
  for (const [part, role] of Object.entries(body.roles)) if (role === 'unit') {
    selected.add(part);
    if (!names.has(part)) groupProblems.push({
      code: 'DEPTH_PART_RESOLVES', object: part, detail: 'is declared as a body turn unit but names no assembled part; use exact parts.json names',
    });
  }
  for (const part of place.round ?? []) if (!selected.has(part)) groupProblems.push({
    code: 'DEPTH_PLACE_ROUND', object: `place.round, part ${JSON.stringify(part)}`, detail: 'must resolve to a body recipe part or a body turn unit',
  });
  if (groupProblems.length) throw new PartsError(groupProblems);
  const samples = placementSamples(set, map, reliefs, place, selected);
  const scale = checkPlacementScale(place.scale, samples, reliefs);
  const anchorMedian = samples.find(p => p.part === place.anchor)!.rawMedian;
  const anchorZ = recipe.parts[place.anchor].median, sign = place.near === 'white' ? 1 : -1;
  const pivot = typeof place.pivot === 'number' ? place.pivot : 0;
  const parts = samples.map(({ rawMedian, rawP5, rawP95, ...sample }) => {
    const rigMedian = sample.part === place.anchor ? anchorZ : anchorZ + sign * ((rawMedian - anchorMedian) * scale);
    const impliedRelief = reliefs.has(sample.part) ? (rawP95 - rawP5) * scale : null;
    if (!Number.isFinite(rigMedian) || (impliedRelief !== null && !Number.isFinite(impliedRelief))) return fail('DEPTH_PLACE_SCALE', `part "${sample.part}"`, 'placed median or implied relief overflows; declare a representable scale and anchor median');
    return { ...sample, rawMedian, rawP5, rawP95, rigMedian, impliedRelief };
  });
  const bodyGroup = recipe.groups.body;
  const unitRows = parts.filter(({ part }) => body.roles[part] === 'unit');
  const turn = object(raw.turn, 'config.turn'), rawBody = object(turn.body, 'config.turn.body');
  rawBody.pivot = pivot;
  bodyGroup.pivot = pivot;
  if (unitRows.length) {
    // The body producer projects these world depths against the first surface.
    const unitDepths = { ...(body.unitDepths ?? config.turn?.unitDepths), ...bodyGroup.unitDepths,
      ...Object.fromEntries(unitRows.map(({ part, rigMedian }) => [part, rigMedian])) };
    rawBody.unitDepths = unitDepths;
    // depth-apply applies a recipe's authored override after reading the rig config.
    if (bodyGroup.unitDepths !== undefined) bodyGroup.unitDepths = unitDepths;
  }
  for (const { part, rigMedian } of parts) if (reliefs.has(part)) recipe.parts[part].median = rigMedian;
  recipe.place = { ...place, scale };
  parseConfig(raw);
  const report: DepthPlacementReport = { spec: 'rig-parts-depth-place-report/1', near: place.near, scale, anchor: place.anchor, pivot, parts };
  return { report, write(out, turnCheck) {
    const dir = resolve(out);
    emptyOutput(dir, sources);
    const relocated = structuredClone(raw), placedRecipe = structuredClone(recipe);
    relocateConfigReferences(relocated, configDir, dir, 'relative');
    const mapAt = (path: string): string => isAbsolute(path) ? path : relative(dir, resolve(recipeDir, path));
    for (const p of Object.values(placedRecipe.parts)) p.map = mapAt(p.map);
    placedRecipe.place!.map = mapAt(place.map);
    const paths = { recipe: join(dir, 'recipe.json'), config: join(dir, 'config.json') };
    const reportJson = text(turnCheck === undefined ? report : { ...report, turnCheck });
    mkdirSync(dir, { recursive: true });
    writeFileSync(paths.recipe, text(placedRecipe), { flag: 'wx' });
    writeFileSync(paths.config, text(relocated), { flag: 'wx' });
    writeFileSync(join(dir, 'depth-place-report.json'), reportJson, { flag: 'wx' });
    return paths;
  } };
}

function registeredMap(map: NumericMap, p: PreparedPart, frame: PartMap['frame'], at: string): NumericMap {
  const [w, h] = frame === 'part' ? p.size : frame === 'input' ? p.inputSize : p.upscaled;
  if (map.width !== w || map.height !== h) return fail('DEPTH_MAP_SIZE', at, `is ${map.width}x${map.height}; declared ${frame} frame is ${w}x${h}`);
  if (frame !== 'input') return map;
  const data: number[] = [];
  for (let y = 0; y < p.upscaled[1]; y++) for (let x = 0; x < p.upscaled[0]; x++) for (let c = 0; c < map.channels; c++) data.push(map.data[((y + p.padding) * map.width + x + p.padding) * map.channels + c]);
  return { ...map, width: p.upscaled[0], height: p.upscaled[1], data };
}

/** Extend the float field from its OWN stride2 integration support before BOX.
 * Keep every supported height unchanged; Euclidean nearest seeds use row-major
 * ties. A nearest seed must be on the four-neighbour boundary: an interior
 * seed always has a strictly closer axis neighbour toward an unsupported point.
 * No gray encoding or native-art mask is used on this integration grid.
 */
function extendIntegratedHeight(data: Float64Array, art: Raster): Float64Array {
  const w = Math.ceil(art.width / 2), h = Math.ceil(art.height / 2);
  const support = Uint8Array.from({ length: w * h }, (_, i) => art.data[((2 * Math.floor(i / w)) * art.width + 2 * (i % w)) * 4 + 3] >= 128 ? 1 : 0);
  const boundary: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (support[i] && (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !support[i - 1] || !support[i + 1] || !support[i - w] || !support[i + w])) boundary.push(i);
  }
  // integrateNormals already refused empty/disconnected support before this call.
  const filled = data.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (support[i]) continue;
    let distance = Infinity, seed = -1;
    for (const j of boundary) {
      const dx = x - j % w, dy = y - Math.floor(j / w), d = dx * dx + dy * dy;
      if (d < distance) { distance = d; seed = j; }
    }
    filled[i] = data[seed];
  }
  return filled;
}
const MAP_BINDING_ABSENT = 'DEPTH_MAP_BINDING_ABSENT';
const BINDING_REMEDY = 're-run depth for these inputs, then rig-parts depth-bind --map <numeric-map.json> --input <prepared.png> --part <name>';
/** Bound diagnostic values; never echo a receipt payload. */
function bindingFound(value: unknown): string {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return JSON.stringify(value)?.slice(0, 96) ?? String(value);
}

/** Attest the two files available now, not the unobserved inference execution. */
export function bindDepthMap(input: { map: string; input: string; part: string }): Obj {
  if (!input.part || input.part.startsWith('.') || /[\\/]/.test(input.part) || input.part.includes('\0')) {
    fail('DEPTH_MAP_BINDING', 'depth-bind --part', `found ${bindingFound(input.part)}; required a nonempty plain part filename; ${BINDING_REMEDY}`);
  }
  const read = (file: string): Uint8Array => {
    if (!existsSync(file) || !statSync(file).isFile()) return fail('DEPTH_INPUT_PRESENT', file, 'is missing or not a file; restore the declared input');
    return readFileSync(file);
  };
  const mapBytes = read(input.map), inputBytes = read(input.input);
  readNumericMap(readJson(input.map), input.part);
  decodePngBytes(inputBytes, input.part);
  const receipt = { spec: 'rig-parts-depth-map-binding/1', part: input.part, mapSha256: hash(mapBytes), inputSha256: hash(inputBytes) };
  const target = input.map + '.binding.json';
  // Exclusive creation preserves a previous attestation; all readers run first.
  try { writeFileSync(target, text(receipt), { flag: 'wx' }); }
  catch (error) {
    const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
    const reason = code === 'EEXIST' ? 'already exists (EEXIST)' : `write failed (${code})`;
    return fail('DEPTH_MAP_BINDING', `part "${input.part}"`, `receipt ${JSON.stringify(target)} ${reason}; required an absent receipt in a writable directory; keep existing evidence and use a new map filename; ${BINDING_REMEDY}`);
  }
  return receipt;
}

// existsSync follows symlinks; a dangling receipt is present malformed evidence.
function isReceiptLink(path: string): boolean {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

/** Parts-owned provenance beside the numeric map; never inferred from a new prepare. */
function mapBinding(mapPath: string, bytes: Uint8Array, part: PreparedPart): string | undefined {
  const receiptPath = mapPath + '.binding.json';
  if (!existsSync(receiptPath) && !isReceiptLink(receiptPath)) return `WARN  ${MAP_BINDING_ABSENT}: part "${part.part}" — no map binding receipt (compatibility policy dated 2026-11-16); applying legacy map without inference-input identity; ${BINDING_REMEDY}`;
  const remedy = BINDING_REMEDY;
  const refuse = (detail: string): never => fail('DEPTH_MAP_BINDING', `part "${part.part}"`, `${detail}; ${remedy}`);
  if (!lstatSync(receiptPath).isFile()) return refuse('receipt found a symlink or nonregular file; required a regular file');
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(receiptPath, 'utf8')) as unknown; }
  catch { return refuse('receipt found unreadable or invalid JSON; required a readable JSON object'); }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return refuse(`receipt found ${bindingFound(raw)}; required an object`);
  const r = raw as Obj;
  const sha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  const unknown = Object.keys(r).filter(k => !['spec', 'part', 'mapSha256', 'inputSha256'].includes(k));
  if (unknown.length) return refuse(`receipt found unknown key ${bindingFound(unknown[0])}; required only spec, part, mapSha256, inputSha256`);
  if (r.spec !== 'rig-parts-depth-map-binding/1') return refuse(`receipt spec found ${bindingFound(r.spec)}; required "rig-parts-depth-map-binding/1"`);
  if (r.part !== part.part) return refuse(`receipt part found ${bindingFound(r.part)}; required ${JSON.stringify(part.part)}`);
  for (const key of ['mapSha256', 'inputSha256'] as const) {
    if (!sha(r[key])) return refuse(`receipt ${key} found ${bindingFound(r[key])}; required 64 lowercase hexadecimal digits`);
  }
  const mapSha = hash(bytes);
  if (r.mapSha256 !== mapSha) return refuse(`map sha found ${r.mapSha256}; required ${mapSha}`);
  if (r.inputSha256 !== part.inputSha256) return refuse(`inference input sha found ${r.inputSha256}; required ${part.inputSha256}`);
  return undefined;
}
/** `depth-apply --groups` (#1449): the recipe's groups the run applies, in the recipe's declaration order.
 * Every problem in the list is collected and refused at once; absent, every group applies. */
function groupSelection(recipe: DepthRecipe, groups: readonly string[] | undefined): string[] | undefined {
  if (groups === undefined) return undefined;
  const declared = Object.keys(recipe.groups), has = `the recipe's groups are ${declared.map(g => JSON.stringify(g)).join(', ')}`;
  const problems: Problem[] = [], seen = new Set<string>(), repeated = new Set<string>();
  const refuse = (detail: string): void => { problems.push({ code: 'DEPTH_GROUP_SELECTION', object: 'depth-apply --groups', detail }); };
  if (groups.length === 0) refuse(`found an empty list; required one or more group names, comma-separated; ${has}`);
  for (const name of groups) {
    if (seen.has(name)) { if (!repeated.has(name)) refuse(`found ${JSON.stringify(name)} more than once; required each group named once; ${has}`); repeated.add(name); continue; }
    seen.add(name);
    if (!declared.includes(name)) refuse(`found ${JSON.stringify(name)}, which the recipe does not declare; required a group the recipe declares; ${has}`);
  }
  if (problems.length) throw new PartsError(problems);
  return declared.filter(g => seen.has(g));
}
export function applyDepth(input: { parts: string; manifest: string; config: string; rigConfig: string; out: string; groups?: readonly string[] }, log: (line: string) => void = console.warn): Obj {
  const recipe = parseDepthRecipe(readJson(input.config)), selection = groupSelection(recipe, input.groups), applied = (group: string): boolean => selection === undefined || selection.includes(group);
  const expected = preparedParts(input.parts, recipe);
  const supplied = readJson(input.manifest);
  if (text(supplied) !== text(expected.manifest)) fail('DEPTH_INPUT_BINDING', input.manifest, 'does not match the recipe, parts.json, art hashes, crop or padding; run depth-prepare again for these exact inputs');
  for (const p of expected.manifest.parts) {
    const file = join(dirname(input.manifest), p.input);
    if (!existsSync(file) || hash(readFileSync(file)) !== p.inputSha256) fail('DEPTH_INPUT_BINDING', p.part, 'prepared inference PNG is missing or changed; restore its exact bytes or prepare again');
  }
  emptyOutput(input.out, [input.parts, input.config, input.manifest, input.rigConfig, ...Object.values(recipe.parts).flatMap(p => { const map = resolve(dirname(input.config), p.map); return [map, map + '.binding.json']; })]);
  const rawParts = object(readJson(join(input.parts, 'parts.json')), 'parts.json'), file = readParts(join(input.parts, 'parts.json'));
  for (const p of file.parts) if (Object.hasOwn(recipe.parts, p.name) && applied(recipe.parts[p.name].group) && p.provenance?.depth?.kind === 'authored-unit') fail('DEPTH_AUTHORED_UNIT_CONFLICT', `part "${p.name}"`, 'has provenance.depth.kind "authored-unit"; a transported scalar reference cannot coexist with authored unit depth — retain the unit declaration or supply an explicitly reassembled scalar-compatible input; no automatic transition is made');
  const { config } = loadConfigAndAnimations(input.rigConfig);
  const receiptProblems = readEditorReceipts(config.assemble.editor_receipts, input.rigConfig).problems;
  if (receiptProblems.length) throw new PartsError(receiptProblems);
  refuseStaleAssembly(input.rigConfig, file, config);
  const raw = object(readJson(input.rigConfig), 'rig config'), turn = object(raw.turn, 'config.turn');
  // A group left out must not turn: the rig builds a group's turn from its config block, not from its sheets.
  // An applied body group still requires config.turn.body; every such problem is refused at once.
  const turnProblems: Problem[] = [];
  for (const name of Object.keys(recipe.groups)) {
    if (applied(name)) {
      if (name !== 'head' && (turn.body === null || typeof turn.body !== 'object' || Array.isArray(turn.body))) turnProblems.push({ code: 'DEPTH_RECIPE', object: 'config.turn.body', detail: 'requires an object with the documented fields' });
      continue;
    }
    for (const field of name === 'head' ? ['roles', 'depths'] : ['body']) if (turn[field] !== undefined) turnProblems.push({ code: 'DEPTH_GROUP_LEFT_OUT', object: `config.turn.${field}`, detail: `declares the ${name} turn, and depth-apply --groups ${(selection as string[]).join(',')} leaves the recipe's ${name} group out; required no config.turn.${field} in the rig config when the ${name} group is left out, or ${name} named in --groups` });
  }
  if (turnProblems.length) throw new PartsError(turnProblems);
  for (const [name, group] of Object.entries(recipe.groups)) {
    if (!applied(name)) continue;
    const target = name === 'head' ? turn : object(turn.body, 'config.turn.body'); target.pivot = group.pivot;
    if (group.unitDepths !== undefined) target.unitDepths = group.unitDepths;
  }
  // Keep relative paths portable when relocating the output directory with its inputs.
  relocateConfigReferences(raw, dirname(input.rigConfig), input.out, 'relative');
  const relocatedConfig = parseConfig(raw), outConfig = join(input.out, 'config.json');
  const relocatedReceiptProblems = readEditorReceipts(relocatedConfig.assemble.editor_receipts, outConfig).problems;
  if (relocatedReceiptProblems.length) throw new PartsError(relocatedReceiptProblems);
  refuseStaleAssembly(outConfig, file, relocatedConfig);
  const warnings: string[] = [];
  const writes = new Map<string, Uint8Array>(), rows: Obj[] = [], recs = rawParts.parts as Obj[];
  const groupMaxZ = new Map<string, number>();
  const clipped: { name: string; group: string; fraction: number; clipsHigh: boolean; median: number; minMedian?: number }[] = [];
  // Retain auxiliary art (including alternate sets) and diagnostics byte-for-byte.
  // Symlink inputs would obscure ownership and can escape this assembled directory.
  const retained = new Map<string, Uint8Array>();
  const collect = (dir: string, prefix: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, ent.name), key = prefix + ent.name;
      if (ent.isDirectory()) collect(path, key + '/');
      else if (ent.isFile()) retained.set(key, readFileSync(path));
      else fail('DEPTH_INPUT_PRESENT', path, 'is not a regular owned file/directory; supply a self-contained assembled directory without symlinks');
    }
  };
  collect(input.parts, '');
  for (const p of file.parts) {
    const name = p.name, bytes = readFileSync(join(input.parts, partImageReference(p).path)), art = decodePngBytes(bytes, name), rec = recs.find(r => r.name === name) as Obj;
    writes.set(`${name}.png`, bytes);
    const declaration = Object.hasOwn(recipe.parts, name) ? recipe.parts[name] : undefined;
    // A left-out group's part gets no new sheet, and any sheet it carried is dropped, never retained stale.
    if (declaration !== undefined && !applied(declaration.group)) { if (p.depth !== undefined) retained.delete(depthImageReference(p.depth).path); delete rec.depth; continue; }
    if (declaration === undefined) {
      if (recipe.clear.includes(name)) { if (p.depth !== undefined) retained.delete(depthImageReference(p.depth).path); delete rec.depth; }
      else if (p.depth !== undefined) { const depthPath = join(input.parts, depthImageReference(p.depth).path); readSourceDepth(depthPath, art, null); writes.set(p.depth.image, readFileSync(depthPath)); }
      continue;
    }
    const g = recipe.groups[declaration.group], target = declaration.group === 'head' ? turn : object(turn.body, 'config.turn.body');
    if (!Object.hasOwn(object(target.roles, `config.turn.${declaration.group}.roles`), name)) fail('DEPTH_GROUP_BINDING', name, `declared group ${declaration.group} does not name this part in its roles; register it explicitly`);
    const prepared = expected.manifest.parts.find(row => row.part === name) as PreparedPart;
    const mapPath = resolve(dirname(input.config), declaration.map), numeric = readNumericMap(readJson(mapPath), name), mapBytes = readFileSync(mapPath);
    const warning = mapBinding(mapPath, mapBytes, prepared);
    if (warning !== undefined) warnings.push(warning);
    const map = registeredMap(numeric, prepared, declaration.frame, name);
    let values: ArrayLike<number>, normal: ReturnType<typeof integrateNormals> | undefined;
    if (declaration.source === 'normals') {
      if (map.channels !== 3) fail('DEPTH_MAP_FORMAT', name, 'normals require three signed XYZ channels');
      const islands = connectedComponents({ width: art.width, height: art.height, data: alphaSupport(art) }, 4).count - 1;
      if (islands !== 1) fail('DEPTH_NORMAL_ISLANDS', name, `native part has ${islands} alpha>=128 islands; exactly one closed convex part is required`);
      const maskArt = map.width === art.width && map.height === art.height ? art : resize(art, map.width, map.height, 'lanczos3');
      normal = integrateNormals(map, maskArt, name);
      values = floatBox(extendIntegratedHeight(normal.data, maskArt), Math.ceil(map.width / 2), Math.ceil(map.height / 2), art.width, art.height);
    } else {
      if (map.channels !== 1) fail('DEPTH_MAP_FORMAT', name, 'depth requires one floating-point channel');
      values = floatBox(map.data, map.width, map.height, art.width, art.height);
    }
    const { sheet, reading, maxZ, minOffset, clipsLow } = mapToSheet(values, art, declaration.median, declaration.relief, g.near, g.zScale, name);
    groupMaxZ.set(declaration.group, Math.max(groupMaxZ.get(declaration.group) ?? -Infinity, maxZ));
    if (reading.clipFraction > 0) {
      clipped.push({ name, group: declaration.group, fraction: reading.clipFraction, clipsHigh: maxZ >= g.zScale, median: declaration.median,
        ...(clipsLow ? { minMedian: aboveDepthBound(-minOffset) } : {}) });
      continue;
    }
    const image = `${name}_depth.png`, sheetBytes = encodePngBytes(sheet);
    if (file.parts.some(p => `${p.name}.png` === image)) fail('DEPTH_GROUP_BINDING', name, `sheet filename ${image} collides with artwork; use noncolliding part names`);
    writes.set(image, sheetBytes);
    if (p.depth !== undefined) retained.delete(depthImageReference(p.depth).path);
    rec.depth = { image, near: g.near, zScale: g.zScale, sources: [{ from: p.from, image: basename(declaration.map), sha256: hash(mapBytes), crop: [0, 0, art.width, art.height], reading: depthReading(sheet, art, null) }] };
    rows.push({ part: name, group: declaration.group, source: declaration.source, frame: declaration.frame, sourceSha256: prepared.sourceSha256, mapSha256: hash(mapBytes), inputSha256: prepared.inputSha256, sheetSha256: hash(sheetBytes), median: declaration.median, relief: declaration.relief, near: g.near, zScale: g.zScale, pivot: g.pivot, ...reading, sign: normal?.sign ?? 1, ...(normal === undefined ? {} : { integration: { stride: 2, iterations: normal.iterations, residual: normal.residual, coreMinusRim: normal.coreMinusRim, maxIterations: 3000, atol: 1e-6, btol: 1e-6 } }) });
  }
  if (clipped.length) throw new PartsError(clipped.map(({ name, group, fraction, clipsHigh, median, minMedian }) => {
    const details = [`clip=${fraction} in group "${group}"`];
    if (clipsHigh) {
      const maxZ = groupMaxZ.get(group)!;
      const required = aboveDepthBound(maxZ);
      details.push(Number.isFinite(required) ? `required zScale=${required} (group max z=${maxZ})` : `no finite zScale exceeds group max z=${maxZ}; revise median or relief`);
    }
    if (minMedian !== undefined) {
      details.push(Number.isFinite(minMedian) ? `required median=${minMedian} (rise ${minMedian - median} rig px)` : 'no finite median clears z<=0; reduce relief');
    }
    return { code: 'DEPTH_APPLY_CLIPPED', object: `part "${name}"`, detail: details.join('; ') };
  }));
  // A replacement must share near/zScale with every retained part in its actual group.
  for (const [name, g] of Object.entries(recipe.groups)) {
    if (!applied(name)) continue;
    const target = name === 'head' ? turn : object(turn.body, 'config.turn.body'), roles = object(target.roles, `config.turn.${name}.roles`);
    for (const rec of recs) if (Object.hasOwn(roles, String(rec.name)) && rec.depth !== undefined) {
      const d = rec.depth as Obj;
      if (d.near !== g.near || d.zScale !== g.zScale) fail('DEPTH_GROUP_BINDING', String(rec.name), `retained ${name} sheet near=${String(d.near)}, zScale=${String(d.zScale)}; declared group requires ${g.near}, ${g.zScale}; replace or explicitly clear that sheet`);
    }
  }
  const report = { spec: 'rig-parts-depth-report/1', partsSha256: expected.manifest.partsSha256, recipeSha256: expected.manifest.recipeSha256, manifestSha256: hash(readFileSync(input.manifest)), rigConfigSha256: hash(readFileSync(input.rigConfig)), alpha: 128, normalization: 'median, linear p5..p95', extension: 'nearest alpha>=128, row-major ties', cleared: recipe.clear,
    ...(selection === undefined ? {} : { selection: { groups: selection, leftOut: file.parts.filter(p => Object.hasOwn(recipe.parts, p.name) && !applied(recipe.parts[p.name].group)).map(p => p.name) } }), parts: rows };
  mkdirSync(join(input.out, 'parts'), { recursive: true });
  for (const [file, bytes] of retained) {
    if (['parts.json', 'config.json', 'depth-report.json'].includes(file)) continue;
    const target = join(input.out, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
  }
  for (const [file, bytes] of writes) writeFileSync(join(input.out, 'parts', file), bytes);
  writeFileSync(join(input.out, 'parts.json'), text(rawParts));
  writeFileSync(join(input.out, 'config.json'), text(raw));
  writeFileSync(join(input.out, 'depth-report.json'), text(report));
  for (const warning of warnings) log(warning);
  return report;
}
