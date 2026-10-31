/** Explicit opt-in commands for provider maps on already assembled parts (#897).
 * No existing assembly/build path calls these stages. All inputs validate before
 * the first output is emitted; output directories must be absent or empty.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { loadConfigAndAnimations, parseConfig } from './config.ts';
import { depthReading, readSourceDepth } from './depthsheets.ts';
import { alphaSupport, depthMapFail as fail, floatBox, integrateNormals, mapToSheet, readNumericMap, type NumericMap } from './depthmaps.ts';
import { readParts } from './parts.ts';
import { readPartSet } from './propose.ts';
import { decodePngBytes, encodePngBytes } from './raster/png.ts';
import { resize } from './raster/resize.ts';
import { connectedComponents } from './raster/components.ts';
import { isSkeletonName } from './skeleton.ts';
import { newRaster, type Raster } from './raster/types.ts';

type Obj = Record<string, unknown>;
interface PrepareOptions { longSide: number; paddingFraction: number; padding: number }
interface Group { median?: never; near: 'black' | 'white'; zScale: number; pivot: number; unitDepths?: Record<string, number> }
interface PartMap { map: string; source: 'depth' | 'normals'; frame: 'part' | 'upscaled' | 'input'; group: string; median: number; relief: number }
export interface DepthRecipe { spec: 'rig-parts-depth/1'; prepare: PrepareOptions; groups: Record<string, Group>; parts: Record<string, PartMap>; clear: string[] }
interface PreparedPart { part: string; crop: number[]; sourceSha256: string; input: string; inputSha256: string; size: number[]; upscaled: number[]; upscale: number; padding: number; inputSize: number[] }
interface Prepared { spec: 'rig-parts-depth-inputs/1'; partsSha256: string; recipeSha256: string; background: number; alpha: number; parts: PreparedPart[] }
const hash = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const text = (raw: unknown): string => JSON.stringify(raw, null, 2) + '\n';
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
  const o = object(raw, 'depth recipe'); keys(o, ['spec', 'prepare', 'groups', 'parts', 'clear'], 'depth recipe');
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
  return { spec: 'rig-parts-depth/1', prepare, groups, parts, clear: o.clear as string[] };
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
    parts.push({ part: part.name, crop: [part.x, part.y, part.w, part.h], sourceSha256: hash(readFileSync(join(partsDir, 'parts', file))), input: file, inputSha256: hash(bytes), size: [art.width, art.height], upscaled: [w, h], upscale, padding: pad, inputSize: [input.width, input.height] });
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
function registeredMap(map: NumericMap, p: PreparedPart, frame: PartMap['frame'], at: string): NumericMap {
  const [w, h] = frame === 'part' ? p.size : frame === 'input' ? p.inputSize : p.upscaled;
  if (map.width !== w || map.height !== h) return fail('DEPTH_MAP_SIZE', at, `is ${map.width}x${map.height}; declared ${frame} frame is ${w}x${h}`);
  if (frame !== 'input') return map;
  const data: number[] = [];
  for (let y = 0; y < p.upscaled[1]; y++) for (let x = 0; x < p.upscaled[0]; x++) for (let c = 0; c < map.channels; c++) data.push(map.data[((y + p.padding) * map.width + x + p.padding) * map.channels + c]);
  return { ...map, width: p.upscaled[0], height: p.upscaled[1], data };
}
export function applyDepth(input: { parts: string; manifest: string; config: string; rigConfig: string; out: string }): Obj {
  const recipe = parseDepthRecipe(readJson(input.config)), expected = preparedParts(input.parts, recipe);
  const supplied = readJson(input.manifest);
  if (text(supplied) !== text(expected.manifest)) fail('DEPTH_INPUT_BINDING', input.manifest, 'does not match the recipe, parts.json, art hashes, crop or padding; run depth-prepare again for these exact inputs');
  for (const p of expected.manifest.parts) {
    const file = join(dirname(input.manifest), p.input);
    if (!existsSync(file) || hash(readFileSync(file)) !== p.inputSha256) fail('DEPTH_INPUT_BINDING', p.part, 'prepared inference PNG is missing or changed; restore its exact bytes or prepare again');
  }
  emptyOutput(input.out, [input.parts, input.config, input.manifest, input.rigConfig, ...Object.values(recipe.parts).map(p => resolve(dirname(input.config), p.map))]);
  const rawParts = object(readJson(join(input.parts, 'parts.json')), 'parts.json'), file = readParts(join(input.parts, 'parts.json'));
  loadConfigAndAnimations(input.rigConfig);
  const raw = object(readJson(input.rigConfig), 'rig config'), turn = object(raw.turn, 'config.turn');
  for (const [name, group] of Object.entries(recipe.groups)) {
    const target = name === 'head' ? turn : object(turn.body, 'config.turn.body'); target.pivot = group.pivot;
    if (group.unitDepths !== undefined) target.unitDepths = group.unitDepths;
  }
  // Keep relative paths portable when relocating the output directory with its inputs.
  const motion = raw.motion as Obj | undefined;
  if (typeof motion?.animations_from === 'string') motion.animations_from = relative(resolve(input.out), resolve(dirname(input.rigConfig), motion.animations_from));
  const control = (raw.generation as Obj | undefined)?.control as Obj | undefined;
  if (typeof control?.skeleton === 'string' && !isSkeletonName(control.skeleton)) control.skeleton = relative(resolve(input.out), resolve(dirname(input.rigConfig), control.skeleton));
  parseConfig(raw);
  const writes = new Map<string, Uint8Array>(), rows: Obj[] = [], recs = rawParts.parts as Obj[];
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
    const name = p.name, bytes = readFileSync(join(input.parts, 'parts', `${name}.png`)), art = decodePngBytes(bytes, name), rec = recs.find(r => r.name === name) as Obj;
    writes.set(`${name}.png`, bytes);
    const declaration = Object.hasOwn(recipe.parts, name) ? recipe.parts[name] : undefined;
    if (declaration === undefined) {
      if (recipe.clear.includes(name)) { if (p.depth !== undefined) retained.delete(`parts/${p.depth.image}`); delete rec.depth; }
      else if (p.depth !== undefined) { readSourceDepth(join(input.parts, 'parts', p.depth.image), art, null); writes.set(p.depth.image, readFileSync(join(input.parts, 'parts', p.depth.image))); }
      continue;
    }
    const g = recipe.groups[declaration.group], target = declaration.group === 'head' ? turn : object(turn.body, 'config.turn.body');
    if (!Object.hasOwn(object(target.roles, `config.turn.${declaration.group}.roles`), name)) fail('DEPTH_GROUP_BINDING', name, `declared group ${declaration.group} does not name this part in its roles; register it explicitly`);
    const prepared = expected.manifest.parts.find(row => row.part === name) as PreparedPart;
    const mapPath = resolve(dirname(input.config), declaration.map), numeric = readNumericMap(readJson(mapPath), name), mapBytes = readFileSync(mapPath);
    const map = registeredMap(numeric, prepared, declaration.frame, name);
    let values: ArrayLike<number>, normal: ReturnType<typeof integrateNormals> | undefined;
    if (declaration.source === 'normals') {
      if (map.channels !== 3) fail('DEPTH_MAP_FORMAT', name, 'normals require three signed XYZ channels');
      const islands = connectedComponents({ width: art.width, height: art.height, data: alphaSupport(art) }, 4).count - 1;
      if (islands !== 1) fail('DEPTH_NORMAL_ISLANDS', name, `native part has ${islands} alpha>=128 islands; exactly one closed convex part is required`);
      const maskArt = map.width === art.width && map.height === art.height ? art : resize(art, map.width, map.height, 'lanczos3');
      normal = integrateNormals(map, maskArt, name);
      values = floatBox(normal.data, Math.ceil(map.width / 2), Math.ceil(map.height / 2), art.width, art.height);
    } else {
      if (map.channels !== 1) fail('DEPTH_MAP_FORMAT', name, 'depth requires one floating-point channel');
      values = floatBox(map.data, map.width, map.height, art.width, art.height);
    }
    const { sheet, reading } = mapToSheet(values, art, declaration.median, declaration.relief, g.near, g.zScale, name), image = `${name}_depth.png`, sheetBytes = encodePngBytes(sheet);
    if (file.parts.some(p => `${p.name}.png` === image)) fail('DEPTH_GROUP_BINDING', name, `sheet filename ${image} collides with artwork; use noncolliding part names`);
    writes.set(image, sheetBytes);
    if (p.depth !== undefined) retained.delete(`parts/${p.depth.image}`);
    rec.depth = { image, near: g.near, zScale: g.zScale, sources: [{ from: p.from, image: basename(declaration.map), sha256: hash(mapBytes), crop: [0, 0, art.width, art.height], reading: depthReading(sheet, art, null) }] };
    rows.push({ part: name, group: declaration.group, source: declaration.source, frame: declaration.frame, sourceSha256: prepared.sourceSha256, mapSha256: hash(mapBytes), inputSha256: prepared.inputSha256, sheetSha256: hash(sheetBytes), median: declaration.median, relief: declaration.relief, near: g.near, zScale: g.zScale, pivot: g.pivot, ...reading, sign: normal?.sign ?? 1, ...(normal === undefined ? {} : { integration: { stride: 2, iterations: normal.iterations, residual: normal.residual, coreMinusRim: normal.coreMinusRim, maxIterations: 3000, atol: 1e-6, btol: 1e-6 } }) });
  }
  // A replacement must share near/zScale with every retained part in its actual group.
  for (const [name, g] of Object.entries(recipe.groups)) {
    const target = name === 'head' ? turn : object(turn.body, 'config.turn.body'), roles = object(target.roles, `config.turn.${name}.roles`);
    for (const rec of recs) if (Object.hasOwn(roles, String(rec.name)) && rec.depth !== undefined) {
      const d = rec.depth as Obj;
      if (d.near !== g.near || d.zScale !== g.zScale) fail('DEPTH_GROUP_BINDING', String(rec.name), `retained ${name} sheet near=${String(d.near)}, zScale=${String(d.zScale)}; declared group requires ${g.near}, ${g.zScale}; replace or explicitly clear that sheet`);
    }
  }
  const report = { spec: 'rig-parts-depth-report/1', partsSha256: expected.manifest.partsSha256, recipeSha256: expected.manifest.recipeSha256, manifestSha256: hash(readFileSync(input.manifest)), rigConfigSha256: hash(readFileSync(input.rigConfig)), alpha: 128, normalization: 'median, linear p5..p95', extension: 'nearest alpha>=128, row-major ties', cleared: recipe.clear, parts: rows };
  mkdirSync(join(input.out, 'parts'), { recursive: true });
  for (const [file, bytes] of retained) {
    if (['parts.json', 'config.json', 'depth-report.json'].includes(file)) continue;
    const target = join(input.out, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
  }
  for (const [file, bytes] of writes) writeFileSync(join(input.out, 'parts', file), bytes);
  writeFileSync(join(input.out, 'parts.json'), text(rawParts));
  writeFileSync(join(input.out, 'config.json'), text(raw));
  writeFileSync(join(input.out, 'depth-report.json'), text(report));
  return report;
}
