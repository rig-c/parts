/** Independent analytic controls for #897; no private art or measured expectations. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rigParts } from '../fixtures/rig.ts';
import { PartsError } from '../src/errors.ts';
import { alphaSupport, floatBox, integrateNormals, mapToSheet, readNumericMap, type NumericMap } from '../src/depthmaps.ts';
import { applyDepth, parseDepthRecipe, prepareDepth } from '../src/depthworkflow.ts';
import { readParts, writeParts } from '../src/parts.ts';
import { readRigInputs } from '../src/build.ts';
import { readPng, writePng } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
type Say = (name: string, ok: boolean, detail: string) => void;
const json = (p: string, v: unknown): void => writeFileSync(p, JSON.stringify(v) + '\n');
const codes = (fn: () => unknown): string[] => { try { fn(); return []; } catch (e) { if (!(e instanceof PartsError)) throw e; return e.problems.map(p => `${p.code}: ${p.object}`); } };
function files(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name), key = prefix + ent.name;
    if (ent.isDirectory()) Object.assign(out, files(path, key + '/')); else out[key] = readFileSync(path).toString('hex');
  }
  return out;
}
export function runDepthMapChecks(dir: string, say: Say): void {
  mkdirSync(join(dir, 'source/parts'), { recursive: true });
  const art = newRaster(65, 65), data: number[] = [], normals: number[] = [];
  for (let y = 0; y < 65; y++) for (let x = 0; x < 65; x++) {
    const dx = x - 32, dy = y - 32, rr = dx * dx + dy * dy, z = Math.sqrt(Math.max(0, 30 * 30 - rr));
    art.data.set([200, 120, 80, rr <= 24 * 24 ? 255 : 0], (y * 65 + x) * 4);
    data.push(x + 2 * y); normals.push(dx / 30, dy / 30, z / 30);
  }
  const mask = alphaSupport(art), map: NumericMap = { spec: 'rig-parts-map/1', width: 65, height: 65, channels: 3, data: normals };
  const shape = (m: NumericMap) => {
    const result = integrateNormals(m, art, 'hemisphere'), recovered = floatBox(result.data, 33, 33, 65, 65), actual: number[] = [], oracle: number[] = [];
    // The integration grid samples original (2*x,2*y), not BOX output centres.
    // Compare the analytic shape on that declared grid; BOX is checked separately.
    for (let y = 0; y < 33; y++) for (let x = 0; x < 33; x++) if ((2 * x - 32) ** 2 + (2 * y - 32) ** 2 < 20 ** 2) { actual.push(result.data[y * 33 + x]); oracle.push(Math.sqrt(30 ** 2 - (2 * x - 32) ** 2 - (2 * y - 32) ** 2)); }
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const ma = mean(actual), mo = mean(oracle); let cov = 0, va = 0, vo = 0;
    for (let i = 0; i < actual.length; i++) { cov += (actual[i] - ma) * (oracle[i] - mo); va += (actual[i] - ma) ** 2; vo += (oracle[i] - mo) ** 2; }
    const correlation = cov / Math.sqrt(va * vo), scale = cov / va;
    const rmse = Math.sqrt(actual.reduce((s, a, i) => s + ((a - ma) * scale - (oracle[i] - mo)) ** 2, 0) / actual.length) / (Math.max(...oracle) - Math.min(...oracle));
    return { sign: result.sign, correlation, rmse, recovered };
  };
  const a = shape(map), b = shape({ ...map, data: normals.map((v, i) => i % 3 === 2 ? v : -v) });
  say('DMP01_HEMISPHERE_BOTH_SIGNS_INDEPENDENT_ORACLE', [a, b].every(r => r.correlation >= .99 && r.rmse <= .03) && a.sign === -b.sign && a.recovered.every((v, i) => Math.abs(v - b.recovered[i]) < 1e-7), JSON.stringify([a, b].map(({ recovered: _v, ...r }) => r)));
  const islands = newRaster(65, 65); islands.data.set(art.data);
  for (let y = 0; y < 65; y++) for (let x = 31; x <= 33; x++) islands.data[(y * 65 + x) * 4 + 3] = 0;
  say('DMP02_TWO_ISLANDS_REFUSED', codes(() => integrateNormals(map, islands, 'split')).some(c => c.startsWith('DEPTH_NORMAL_ISLANDS:')), 'strip splits disk into two four-connected components');
  const zero = { ...map, data: Array(normals.length).fill(0) as number[] };
  say('DMP03_ZERO_NORMAL_REFUSED', codes(() => integrateNormals(zero, art, 'zero')).some(c => c.startsWith('DEPTH_NORMAL_VECTOR:')), 'zero signed normal is not a front-facing default');
  const plane = { ...map, data: normals.map((_v, i) => i % 3 === 2 ? 1 : 0) };
  say('DMP04_UNRESOLVED_CONVEXITY_REFUSED', codes(() => integrateNormals(plane, art, 'plane')).some(c => c.startsWith('DEPTH_NORMAL_CONVEXITY:')), 'plane has no resolved convex interior');
  const line = newRaster(3, 1); line.data.set([0, 0, 0, 127, 0, 0, 0, 128, 0, 0, 0, 255]);
  const normalized = mapToSheet([9999, 0, 10], line, 50, 18, 'white', 100, 'ramp');
  say('DMP05_NORMALIZATION_ALPHA_THRESHOLD_AND_NEAREST_FILL', normalized.reading.rawMedian === 5 && normalized.reading.rawP5 === .5 && normalized.reading.rawP95 === 9.5 && normalized.sheet.data[0] === 102 && normalized.sheet.data[4] === 102 && normalized.sheet.data[8] === 153 && normalized.reading.levels === 2, JSON.stringify(normalized.reading));
  const black = mapToSheet([9999, 0, 10], line, 50, 18, 'black', 100, 'ramp');
  say('DMP06_NEAR_BLACK_INVERTS_AND_CLIPPING_IS_REPORTED', black.sheet.data[4] === 153 && black.sheet.data[8] === 102 && mapToSheet([0, 0, 10], line, 0, 180, 'white', 100, 'clip').reading.clipFraction === 1, 'world Z controls encoding; clipping counted only inside alpha>=128');
  say('DMP07_FLAT_NONZERO_RELIEF_REFUSED_AND_ZERO_ALLOWED', codes(() => mapToSheet(Array(data.length).fill(1), art, 50, 1, 'white', 100, 'flat')).some(c => c.startsWith('DEPTH_MAP_SPREAD:')) && mapToSheet(Array(data.length).fill(1), art, 50, 0, 'white', 100, 'flat').reading.levels === 1, 'no epsilon invents relief for a constant map');
  say('DMP08_FLOAT_BOX_HAND_COMPUTED', Array.from(floatBox([1, 3, 5, 7, 9, 11, 13, 15], 4, 2, 2, 1)).join(',') === '6,10', 'two 2x2 blocks average to 6 and 10');
  const invalidMaps = [{ ...map, data: [1] }, { ...map, width: 0 }, { ...map, channels: 2 }, { ...map, data: normals.map((v, i) => i === 0 ? NaN : v) }, { ...map, extra: true }];
  say('DMP09_NUMERIC_FORMAT_REFUSES_SHAPE_NONFINITE_AND_UNKNOWN', invalidMaps.every(m => codes(() => readNumericMap(m, 'bad')).some(c => c.startsWith('DEPTH_MAP_FORMAT:'))), 'five independent malformed numeric inputs');
  const source = join(dir, 'source'), pf = rigParts(); pf.rig_size = [100, 100]; pf.parts = [{ ...pf.parts[0], name: 'face', from: 'full:face', x: 10, y: 10, w: 65, h: 65, opaque_px: mask.reduce((s, v) => s + v, 0) }];
  writeParts(join(source, 'parts.json'), pf); writePng(join(source, 'parts/face.png'), art);
  const config = { key: 'fixture', assemble: { rig_scale: .5, plan: [['face', 'full', 'face']] }, bones: [{ name: 'head', parent: 'root', at: [40, 40] }], meshes: {}, regions: { face: 'head' }, motion: { duration: 1, tracks: [] }, turn: { pivot: 30, roles: { face: 'surface' } } };
  const rigConfig = join(dir, 'rig-config.json'); json(rigConfig, config);
  const recipe = { spec: 'rig-parts-depth/1', prepare: { longSide: 65, paddingFraction: .08, padding: 4 }, groups: { head: { near: 'white', zScale: 100, pivot: 30 } }, parts: { face: { map: 'raw.json', source: 'depth', frame: 'part', group: 'head', median: 50, relief: 10 } }, clear: [] };
  const configPath = join(dir, 'depth.json'); json(configPath, recipe); json(join(dir, 'raw.json'), { spec: 'rig-parts-map/1', width: 65, height: 65, channels: 1, data });
  for (const field of ['median', 'relief']) {
    const bad = structuredClone(recipe); delete (bad.parts.face as Record<string, unknown>)[field];
    say(`DMP10_MISSING_${field.toUpperCase()}_REFUSED`, codes(() => parseDepthRecipe(bad)).some(c => c === `DEPTH_RECIPE_NUMBER: parts.face.${field}`), `missing ${field} named at its field`);
  }
  for (const field of ['near', 'zScale', 'pivot']) {
    const bad = structuredClone(recipe); delete (bad.groups.head as Record<string, unknown>)[field];
    say(`DMP11_MISSING_${field.toUpperCase()}_REFUSED`, codes(() => parseDepthRecipe(bad)).some(c => c.endsWith(`groups.head.${field}`)), `missing ${field} is never inferred`);
  }
  const prepared = join(dir, 'prepared'), prepared2 = join(dir, 'prepared2'), out = join(dir, 'applied'), out2 = join(dir, 'applied2');
  const manifest = prepareDepth({ parts: source, config: configPath, out: prepared }); prepareDepth({ parts: source, config: configPath, out: prepared2 });
  say('DMP12_PREPARE_BINDS_GRAY_PAD_CROP_AND_HASH', manifest.parts[0].padding === 9 && manifest.parts[0].crop.join(',') === '10,10,65,65' && readPng(join(prepared, 'face.png')).data.slice(0, 4).join(',') === '128,128,128,255' && manifest.parts[0].inputSha256.length === 64 && JSON.stringify(files(prepared)) === JSON.stringify(files(prepared2)), JSON.stringify(manifest.parts[0]));
  const args = { parts: source, config: configPath, manifest: join(prepared, 'manifest.json'), rigConfig, out };
  const report = applyDepth(args); applyDepth({ ...args, out: out2 });
  const reread = readParts(join(out, 'parts.json')), rigInputs = readRigInputs(join(out, 'config.json'), out);
  say('DMP13_APPLY_DETERMINISM_AND_ACTUAL_RIG_READER', JSON.stringify(files(out)) === JSON.stringify(files(out2)) && reread.parts[0].depth?.near === 'white' && rigInputs.images.has('face_depth.png') && JSON.stringify((report.parts as unknown[]).length) === '1', 'two outputs byte-identical including reports; actual readRigInputs resolves generated part references');
  say('DMP14_SOURCE_BYTES_UNCHANGED', readFileSync(join(source, 'parts/face.png')).equals(readFileSync(join(out, 'parts/face.png'))) && readFileSync(rigConfig, 'utf8').trim() === JSON.stringify(config), 'art and original rig config unchanged');
  say('DMP15_NONEMPTY_OUTPUT_REFUSED', codes(() => applyDepth(args)).some(c => c.startsWith('DEPTH_OUTPUT_EMPTY:')), 'old output never overwritten');
  const stale = readFileSync(join(prepared, 'face.png')); writeFileSync(join(prepared, 'face.png'), 'changed');
  const blocked = join(dir, 'blocked');
  say('DMP16_STALE_INFERENCE_REFUSED_BEFORE_EMIT', codes(() => applyDepth({ ...args, out: blocked })).some(c => c.startsWith('DEPTH_INPUT_BINDING:')) && !existsSync(blocked), 'stale prepared input produces no output'); writeFileSync(join(prepared, 'face.png'), stale);
  const artBytes = readFileSync(join(source, 'parts/face.png')); const changed = readPng(join(source, 'parts/face.png')); changed.data[0]++; writePng(join(source, 'parts/face.png'), changed);
  say('DMP17_STALE_SOURCE_REFUSED', codes(() => applyDepth({ ...args, out: blocked })).some(c => c.startsWith('DEPTH_INPUT_BINDING:')) && !existsSync(blocked), 'one source byte changed; manifest must be prepared again'); writeFileSync(join(source, 'parts/face.png'), artBytes);
  const rawBytes = readFileSync(join(dir, 'raw.json')); json(join(dir, 'raw.json'), { spec: 'rig-parts-map/1', width: 1, height: 1, channels: 1, data: [0] });
  say('DMP18_REGISTERED_MAP_SIZE_REFUSED_BEFORE_EMIT', codes(() => applyDepth({ ...args, out: blocked })).some(c => c.startsWith('DEPTH_MAP_SIZE:')) && !existsSync(blocked), '1x1 map cannot silently stretch over a 65x65 part'); writeFileSync(join(dir, 'raw.json'), rawBytes);
  const missing = join(dir, 'missing.json');
  say('DMP19_MISSING_INPUT_AND_INVALID_JSON_REFUSED', codes(() => prepareDepth({ parts: source, config: missing, out: blocked })).some(c => c.startsWith('DEPTH_INPUT_PRESENT:')) && (writeFileSync(missing, 'not json'), codes(() => prepareDepth({ parts: source, config: missing, out: blocked }))).some(c => c.startsWith('DEPTH_INPUT_JSON:')), 'named file and JSON refusals');
  const unknown = structuredClone(recipe); unknown.parts = { absent: unknown.parts.face } as unknown as typeof recipe.parts; json(missing, unknown);
  say('DMP20_UNKNOWN_PART_REFUSED', codes(() => prepareDepth({ parts: source, config: missing, out: blocked })).some(c => c.startsWith('DEPTH_PART_RESOLVES:')), 'selection resolves assembled part names');
  const cli = join(import.meta.dir, '../cli.ts');
  const run = spawnSync(process.execPath, [cli, 'depth-apply', '--parts', source, '--config', configPath, '--manifest', args.manifest, '--rig-config', rigConfig, '--out', join(dir, 'cli-out')], { encoding: 'utf8' });
  const usage = spawnSync(process.execPath, [cli, 'depth-prepare', '--bogus', 'x'], { encoding: 'utf8' });
  say('DMP21_REAL_CLI_SUCCESS_AND_UNKNOWN_FLAG', run.status === 0 && run.stdout.includes('reliefRigPixels=10') && usage.status === 2 && usage.stdout.includes('--bogus'), `apply exit ${run.status}; usage exit ${usage.status}; ${run.stderr}`);
  const two = join(dir, 'two'); mkdirSync(join(two, 'parts'), { recursive: true });
  const twoParts = structuredClone(pf); twoParts.parts.push({ ...twoParts.parts[0], name: 'badge', from: 'full:headwear' });
  writeParts(join(two, 'parts.json'), twoParts); writePng(join(two, 'parts/face.png'), art); writePng(join(two, 'parts/badge.png'), art);
  const twoRecipe = structuredClone(recipe) as Record<string, unknown>;
  twoRecipe.parts = { ...recipe.parts, badge: { ...recipe.parts.face, map: 'absent-late.json' } };
  const twoPath = join(dir, 'two-recipe.json'); json(twoPath, twoRecipe);
  const twoConfig = structuredClone(config) as Record<string, unknown>;
  twoConfig.assemble = { rig_scale: .5, plan: [['face', 'full', 'face'], ['badge', 'full', 'headwear']] };
  twoConfig.regions = { face: 'head', badge: 'head' }; twoConfig.turn = { pivot: 30, roles: { face: 'surface', badge: 'unit' } };
  const twoConfigPath = join(dir, 'two-config.json'); json(twoConfigPath, twoConfig);
  const twoPrepared = join(dir, 'two-prepared'); prepareDepth({ parts: two, config: twoPath, out: twoPrepared });
  const lateArgs = { parts: two, config: twoPath, manifest: join(twoPrepared, 'manifest.json'), rigConfig: twoConfigPath, out: blocked };
  const lateCodes = codes(() => applyDepth(lateArgs));
  say('DMP22_MISSING_LATER_MAP_WRITES_NOTHING', lateCodes.some(c => c.startsWith('DEPTH_INPUT_PRESENT:')) && !existsSync(blocked), `first valid part computed, second map absent; no output directory or partial sheet: ${lateCodes.join('; ')}`);
  json(join(dir, 'absent-late.json'), { spec: 'rig-parts-map/1', width: 65, height: 65, channels: 1, data });
  const multi = applyDepth({ ...lateArgs, out: join(dir, 'multi-green') });
  say('DMP28_TWO_VALID_PARTS_ARE_THE_LATE_INPUT_POSITIVE_CONTROL', (multi.parts as unknown[]).length === 2, 'same fixture with both declared maps supplied applies both');
  twoConfig.turn = { pivot: 30, roles: { face: 'surface' } }; json(twoConfigPath, twoConfig);
  say('DMP23_UNREGISTERED_GROUP_REFUSED_BEFORE_EMIT', codes(() => applyDepth(lateArgs)).some(c => c.startsWith('DEPTH_GROUP_BINDING:')) && !existsSync(blocked), 'a declared recipe group cannot silently attach an unrelated part');
  const partBytes = readFileSync(join(source, 'parts.json')); const moved = structuredClone(pf); moved.parts[0].x++; writeParts(join(source, 'parts.json'), moved);
  say('DMP24_STALE_CROP_REFUSED', codes(() => applyDepth({ ...args, out: blocked })).some(c => c.startsWith('DEPTH_INPUT_BINDING:')) && !existsSync(blocked), 'same part names and PNG bytes, changed rig crop'); writeFileSync(join(source, 'parts.json'), partBytes);
  const recipeBytes = readFileSync(configPath), padRecipe = structuredClone(recipe); padRecipe.prepare.padding++; json(configPath, padRecipe);
  say('DMP25_STALE_PADDING_REFUSED', codes(() => applyDepth({ ...args, out: blocked })).some(c => c.startsWith('DEPTH_INPUT_BINDING:')) && !existsSync(blocked), 'same source, changed declared padding'); writeFileSync(configPath, recipeBytes);
  say('DMP26_NESTED_OUTPUT_REFUSED', codes(() => prepareDepth({ parts: source, config: configPath, out: join(source, 'nested') })).some(c => c.startsWith('DEPTH_OUTPUT_EMPTY:')) && !existsSync(join(source, 'nested')), 'output cannot modify even a subdirectory of the source');
  const empty = newRaster(1, 1), one = newRaster(1, 1); one.data[3] = 255;
  say('DMP27_EMPTY_SUPPORT_REFUSED_AND_BANKERS_TIES', codes(() => mapToSheet([0], empty, 0, 0, 'white', 255, 'empty')).some(c => c.startsWith('DEPTH_MAP_SUPPORT:')) && mapToSheet([0], one, 10.5, 0, 'white', 255, 'tie').sheet.data[0] === 10 && mapToSheet([0], one, 11.5, 0, 'white', 255, 'tie').sheet.data[0] === 12, '10.5 rounds to10, 11.5 to12; no alpha support is refused');
  const brokenAnimation = { ...config, motion: { ...config.motion, animations_from: 'missing-animation.json' } };
  const brokenConfig = join(dir, 'broken-animation-config.json'); json(brokenConfig, brokenAnimation);
  say('DMP29_EXTERNAL_RIG_INPUT_VALIDATED_BEFORE_EMIT', codes(() => applyDepth({ ...args, rigConfig: brokenConfig, out: blocked })).some(c => c.startsWith('CONFIG_FILE_PRESENT:')) && !existsSync(blocked), 'original config animation reader runs before any sheet/config output');
  const paddedRecipe = structuredClone(recipe); paddedRecipe.prepare.longSide = 130; paddedRecipe.parts.face.frame = 'input'; paddedRecipe.parts.face.map = 'padded-map.json'; paddedRecipe.groups.head.pivot = 31;
  const paddedConfig = join(dir, 'padded-recipe.json'); json(paddedConfig, paddedRecipe);
  const paddedPrepared = join(dir, 'padded-prepared'), paddedManifest = prepareDepth({ parts: source, config: paddedConfig, out: paddedPrepared }), row = paddedManifest.parts[0];
  const paddedData = Array.from({ length: row.inputSize[0] * row.inputSize[1] }, (_, i) => {
    const x = i % row.inputSize[0] - row.padding, y = Math.floor(i / row.inputSize[0]) - row.padding;
    return x < 0 || y < 0 || x >= 130 || y >= 130 ? -99999 : Math.floor(x / 2) + 2 * Math.floor(y / 2);
  });
  json(join(dir, 'padded-map.json'), { spec: 'rig-parts-map/1', width: row.inputSize[0], height: row.inputSize[1], channels: 1, data: paddedData });
  const paddedOut = join(dir, 'padded-out'); applyDepth({ ...args, config: paddedConfig, manifest: join(paddedPrepared, 'manifest.json'), out: paddedOut });
  const paddedRead = readRigInputs(join(paddedOut, 'config.json'), paddedOut);
  say('DMP30_PADDED_UPSCALED_REGISTRATION_AND_CHANGED_PIVOT', readFileSync(join(out, 'parts/face_depth.png')).equals(readFileSync(join(paddedOut, 'parts/face_depth.png'))) && paddedRead.cfg.turn?.pivot === 31 && config.turn.pivot === 30, '2x block-replicated raw ramp, hostile padding discarded, BOX recovers native bytes; declared pivot31 replaces original30 in actual rig reader');
  const builtInConfig = { ...config, generation: { checkpoint: 'fixture', loras: [], trigger: '', identity: 'fixture', sampler: { steps: 1, cfg: 1, sampler: 'fixture', scheduler: 'fixture' }, costume: 'fixture', negative_extra: '', style: 'fixture', negative_pose: 'fixture', latent: [64, 64], seed: 0, control: { skeleton: 'stand_clasp', strength: 1, end_percent: 1 } } };
  const builtInPath = join(dir, 'builtin-config.json'); json(builtInPath, builtInConfig);
  const builtInOut = join(dir, 'builtin-out'); applyDepth({ ...args, rigConfig: builtInPath, out: builtInOut });
  const builtInRead = readRigInputs(join(builtInOut, 'config.json'), builtInOut);
  say('DMP31_BUILTIN_CONTROL_SKELETON_IS_NOT_RELOCATED_AS_A_FILE', builtInRead.cfg.generation?.control?.skeleton === 'stand_clasp', 'actual config reader accepts the relocated output with the built-in name preserved');
  const requirementsPath = join(dir, 'limits.json'); json(requirementsPath, { spec: 'spine-parts-requirements/1', fps: 12, requirements: [] });
  const requirementsConfig = join(dir, 'requirements-config.json'); json(requirementsConfig, { ...config, requirements: 'limits.json' });
  const requirementsOut = join(dir, 'requirements-out'); applyDepth({ ...args, rigConfig: requirementsConfig, out: requirementsOut });
  let requirementsRead = false;
  const requirementsCodes = codes(() => { requirementsRead = readRigInputs(join(requirementsOut, 'config.json'), requirementsOut).cfg.requirements !== undefined; });
  const writtenRequirements = JSON.parse(readFileSync(join(requirementsOut, 'config.json'), 'utf8')) as { requirements: string };
  say('DMP32_RELATIVE_REQUIREMENTS_RELOCATED_THROUGH_OUTPUT_READER', requirementsRead && requirementsCodes.length === 0 && readFileSync(join(requirementsOut, writtenRequirements.requirements)).equals(readFileSync(requirementsPath)), JSON.stringify({ outputReader: requirementsRead, refusals: requirementsCodes, requirements: writtenRequirements.requirements }));
  const unitSource = join(dir, 'unit-source'); mkdirSync(join(unitSource, 'parts'), { recursive: true });
  const unitParts = structuredClone(pf);
  unitParts.parts[0].provenance = { unchanged_layer_px: unitParts.parts[0].opaque_px, hand_px: 0, automatic_px: 0, edits: [], automatic: [], depth: { kind: 'authored-unit', values: [{ group: 'head', value: 7 }] } };
  writeParts(join(unitSource, 'parts.json'), unitParts); writePng(join(unitSource, 'parts/face.png'), art);
  const unitPrepared = join(dir, 'unit-prepared'); prepareDepth({ parts: unitSource, config: configPath, out: unitPrepared });
  const unitOut = join(dir, 'unit-conflict-out'), unitCodes = codes(() => applyDepth({ ...args, parts: unitSource, manifest: join(unitPrepared, 'manifest.json'), out: unitOut }));
  const unitReaderCodes = existsSync(join(unitOut, 'parts.json')) ? codes(() => readParts(join(unitOut, 'parts.json'))) : [];
  say('DMP33_AUTHORED_UNIT_SELECTION_REFUSES_BEFORE_EMISSION', unitCodes.some(c => c.startsWith('DEPTH_AUTHORED_UNIT_CONFLICT:')) && !existsSync(unitOut), JSON.stringify({ refusals: unitCodes, outputExists: existsSync(unitOut), outputReaderRefusals: unitReaderCodes }));
  const normalRecipe = structuredClone(recipe); normalRecipe.parts.face.source = 'normals'; normalRecipe.parts.face.map = 'normal-map.json';
  const normalConfig = join(dir, 'normal-recipe.json'); json(normalConfig, normalRecipe); json(join(dir, 'normal-map.json'), map);
  const normalPrepared = join(dir, 'normal-prepared'); prepareDepth({ parts: source, config: normalConfig, out: normalPrepared });
  const normalOut = join(dir, 'normal-out'); applyDepth({ ...args, config: normalConfig, manifest: join(normalPrepared, 'manifest.json'), out: normalOut });
  const integrated = integrateNormals(map, art, 'disk-oracle'), seeds: number[] = [];
  for (let y = 0; y < 33; y++) for (let x = 0; x < 33; x++) if (art.data[((2 * y) * 65 + 2 * x) * 4 + 3] >= 128) seeds.push(y * 33 + x);
  const nearest = (x: number, y: number): number => {
    let best = Infinity, seed = -1;
    for (const i of seeds) { const d = (i % 33 - x) ** 2 + (Math.floor(i / 33) - y) ** 2; if (d < best) { best = d; seed = i; } }
    return seed;
  };
  // This BOX enlargement has exactly one tap at floor((native+.5)*33/65).
  const referenceValues = Float64Array.from({ length: 65 * 65 }, (_, i) => integrated.data[nearest(Math.floor((i % 65 + .5) * 33 / 65), Math.floor((Math.floor(i / 65) + .5) * 33 / 65))]);
  const referenceSheet = mapToSheet(referenceValues, art, 50, 10, 'white', 100, 'disk-oracle').sheet;
  const actualSheet = readPng(join(normalOut, 'parts/face_depth.png')), pixel = 11 * 65 + 21, expectedLevel = referenceSheet.data[pixel * 4], actualLevel = actualSheet.data[pixel * 4];
  const contaminatedTap = 5 * 33 + 10, expectedSeed = 6 * 33 + 10;
  say('DMP34_NORMAL_DISK_BOX_DOES_NOT_PULL_UNSUPPORTED_ZERO_INTO_PIXEL_21_11', art.data[pixel * 4 + 3] >= 128 && !seeds.includes(contaminatedTap) && nearest(10, 5) === expectedSeed && actualLevel === expectedLevel, JSON.stringify({ nativePixel: [21, 11], integrationTap: [10, 5], sourceTapSupported: false, nearestSupported: [10, 6], unsupportedHeight: integrated.data[contaminatedTap], expectedHeight: integrated.data[expectedSeed], actualLevel, expectedLevel }));
  const legacyValues = floatBox(integrated.data, 33, 33, 65, 65); let preserved = 0, equal = 0;
  for (let i = 0; i < 65 * 65; i++) {
    if (art.data[i * 4 + 3] < 128) continue;
    if (seeds.includes(Math.floor((Math.floor(i / 65) + .5) * 33 / 65) * 33 + Math.floor((i % 65 + .5) * 33 / 65))) { preserved++; if (legacyValues[i] === referenceValues[i]) equal++; }
  }
  say('DMP35_DISK_FLOAT_ORACLE_AND_INSIDE_SUPPORT_BOX_PRESERVATION', preserved > 0 && equal === preserved && Array.from(mask).every((v, i) => !v || actualSheet.data[i * 4] === referenceSheet.data[i * 4]), JSON.stringify({ fullySupportedBoxPixels: preserved, unchangedRawBoxValues: equal, normalizedSheetMatchesIndependentNearestSeedOracle: true }));
  const mixedSource = join(dir, 'mixed-unit-source'); mkdirSync(join(mixedSource, 'parts'), { recursive: true });
  const mixedParts = structuredClone(twoParts); mixedParts.parts[1].provenance = structuredClone(unitParts.parts[0].provenance);
  writeParts(join(mixedSource, 'parts.json'), mixedParts); writePng(join(mixedSource, 'parts/face.png'), art); writePng(join(mixedSource, 'parts/badge.png'), art);
  const mixedConfig = join(dir, 'mixed-unit-config.json'); json(mixedConfig, { ...config, assemble: { rig_scale: .5, plan: [['face', 'full', 'face'], ['badge', 'full', 'headwear']] }, regions: { face: 'head', badge: 'head' }, turn: { pivot: 30, roles: { face: 'surface', badge: 'unit' }, unitDepths: { badge: 7 } } });
  const mixedPrepared = join(dir, 'mixed-prepared'); prepareDepth({ parts: mixedSource, config: configPath, out: mixedPrepared });
  const mixedOut = join(dir, 'mixed-out'); applyDepth({ ...args, parts: mixedSource, manifest: join(mixedPrepared, 'manifest.json'), rigConfig: mixedConfig, out: mixedOut });
  const mixedRead = readRigInputs(join(mixedOut, 'config.json'), mixedOut), retainedUnit = mixedRead.parts.parts.find(p => p.name === 'badge');
  say('DMP36_UNSELECTED_AUTHORED_UNIT_REMAINS_ONE_REPRESENTATION', retainedUnit?.depth === undefined && JSON.stringify(retainedUnit?.provenance) === JSON.stringify(mixedParts.parts[1].provenance) && readFileSync(join(mixedOut, 'parts/badge.png')).equals(readFileSync(join(mixedSource, 'parts/badge.png'))), 'positive mixed input: face gets scalar depth; unselected badge keeps its authored-unit provenance/art and the actual reader accepts both');
  const absoluteConfig = join(dir, 'absolute-requirements-config.json'); json(absoluteConfig, { ...config, requirements: requirementsPath });
  const absoluteOut = join(dir, 'absolute-requirements-out'); applyDepth({ ...args, rigConfig: absoluteConfig, out: absoluteOut });
  say('DMP37_ABSOLUTE_REQUIREMENTS_REBASE_TO_THE_SAME_FILE', readRigInputs(join(absoluteOut, 'config.json'), absoluteOut).cfg.requirements !== undefined && readFileSync(join(absoluteOut, (JSON.parse(readFileSync(join(absoluteOut, 'config.json'), 'utf8')) as { requirements: string }).requirements)).equals(readFileSync(requirementsPath)), 'positive absolute input reuses the same real requirements reader and bytes');
}
