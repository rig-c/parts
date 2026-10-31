/** #773 controls: hand-computable scalar grids, actual readers and Core gate. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { compile, f32 } from '@rig-c/core/compile';
import { parseMotionSpec, type MotionSpec } from '@rig-c/core/motion';
import { CompileError } from '@rig-c/core/errors';
import { parseRigSpec, type RigSpec } from '@rig-c/core/rig';
import { buildRig } from '../src/rig.ts';
import { assembleStage, readRigInputs, rigOutputTexts } from '../src/build.ts';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PartsError } from '../src/errors.ts';
import { parseConfig } from '../src/config.ts';
import { bindDepthRun, copyDepthMaterial, depthReading, depthSheetProblems, extendDepthSilhouette, padDepthSheet, padTurnDepthSheet, registerDepthRun, sampleDepthLevel, transportPartDepth, type RegisteredDepth } from '../src/depthsheets.ts';
import { exportLayers, readWrapperLayers, type LayerSet } from '../src/layers.ts';
import { writeParts, readParts, type PartsFile, type PartRecord } from '../src/parts.ts';
import { encodePngBytes, readPng, writePng } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { pad } from '../src/raster/index.ts';
import { lashConfig, lashImages, lashParts, rigConfig, rigImages, rigParts, writeRigFixture } from '../fixtures/rig.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
const errors = (f: () => unknown): string[] => { try { f(); return []; } catch (e) { if (e instanceof PartsError) return e.problems.map(p => p.code); throw e; } };
function grey(w: number, h: number, level: (x: number, y: number) => number): Raster {
  const p = newRaster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = level(x, y); p.data.set([v, v, v, 255], (y * w + x) * 4); }
  return p;
}
function input(dir: string, level = (x: number, y: number): number => 20 * x + 40 * y): LayerSet {
  mkdirSync(dir, { recursive: true });
  writePng(join(dir, 'art.png'), grey(4, 4, () => 180));
  writePng(join(dir, 'depth.png'), grey(4, 4, level));
  writeFileSync(join(dir, 'layers.json'), JSON.stringify({ width: 4, height: 4, layers: [{ name: 'face', filename: 'art.png', left: 0, top: 0, right: 4, bottom: 4, depth_median: 90 / 255, depth_filename: 'depth.png' }] }));
  return readWrapperLayers(dir);
}

export function runDepthSheetChecks(dir: string, say: Say): void {
  const home = join(dir, 'valid'), raw = input(home), binding = { config: { zScale: 12 }, run: 'full' as const, base: home };
  const set = bindDepthRun(raw, 'full', binding.config, home), layer = set.layers[0], scalar = layer.depthSheet;
  say('DS01_WRITER_SHEET_IS_SEPARATE_FROM_ORDER', scalar !== undefined && scalar.reading.relation === 'same' && scalar.reading.sheetMedian === 90 / 255 && layer.depth === 90 / 255, JSON.stringify(scalar?.reading));
  const exported = join(dir, 'export'); exportLayers(set, exported, binding); const reread = readWrapperLayers(exported, binding);
  say('DS02_EXPORT_RETAINS_PIXELS_AND_ORDER', Buffer.from(reread.layers[0].depthSheet?.pixels.data ?? []).equals(Buffer.from(scalar?.pixels.data ?? [])) && reread.layers[0].depth === layer.depth, 'actual wrapper export/read; source PNG re-encoding may change file hash, decoded scalar does not');
  const m = JSON.parse(readFileSync(join(home, 'layers.json'), 'utf8')) as { layers: Array<Record<string, unknown>> };
  const missing = () => { m.layers[0].depth_filename = 'missing.png'; writeFileSync(join(home, 'layers.json'), JSON.stringify(m)); return readWrapperLayers(home, binding); };
  say('DS03_MISSING_FILE_RED', errors(missing).includes('DEPTH_SHEET_PRESENT'), 'declared missing file never becomes a median plate');
  m.layers[0].depth_filename = 'depth.png'; writeFileSync(join(home, 'layers.json'), JSON.stringify(m));
  const original = grey(4, 4, (x, y) => 20 * x + 40 * y);
  writePng(join(home, 'depth.png'), grey(3, 4, () => 20));
  say('DS04_WRONG_SIZE_RED', errors(() => readWrapperLayers(home, binding)).includes('DEPTH_SHEET_SIZE'), '3x4 depth on 4x4 layer');
  const bad = grey(4, 4, () => 20); bad.data[1] = 21; bad.data[3] = 254; writePng(join(home, 'depth.png'), bad);
  const codes = errors(() => readWrapperLayers(home, binding));
  say('DS05_COLOR_AND_ALPHA_COLLECTED', codes.includes('DEPTH_SHEET_GREYSCALE') && codes.includes('DEPTH_SHEET_OPAQUE'), codes.join(','));
  writePng(join(home, 'depth.png'), original);
  say('DS06_ZSCALE_MISSING_RED', errors(() => registerDepthRun(raw, 'full', {}, home)).includes('DEPTH_ZSCALE_REQUIRED'), 'explicit empty block activates the writer hint but supplies no units');
  const invalid = rigConfig(); invalid.depth = { zScale: -1, full: { layers: { face: { image: 'depth.png', zScale: 0 } } } };
  const invalidCodes = errors(() => parseConfig(invalid));
  say('DS07_NEAR_AND_UNITS_COLLECTED', invalidCodes.includes('DEPTH_NEAR_REQUIRED') && invalidCodes.filter(c => c === 'DEPTH_ZSCALE_REQUIRED').length === 2, invalidCodes.join(','));
  const adjusted = depthReading(grey(4, 4, () => 220), layer.pixels, 0.4);
  say('DS08_ORDER_ADJUSTMENT_NOT_A_POLARITY_GATE', adjusted.relation === 'indeterminate' && errors(() => { m.layers[0].depth_median = 0.4; writeFileSync(join(home, 'layers.json'), JSON.stringify(m)); readWrapperLayers(home, binding); }).length === 0, JSON.stringify(adjusted));
  m.layers[0].depth_median = 90 / 255; writeFileSync(join(home, 'layers.json'), JSON.stringify(m));
  const sym = grey(2, 1, x => x * 255), symArt = grey(2, 1, () => 180);
  say('DS09_SYMMETRIC_AND_CONSTANT_ARE_NOT_CERTIFICATES', depthReading(sym, symArt, 0.5).relation === 'indeterminate' && depthReading(grey(2, 1, () => 128), symArt, 0.5).relation === 'indeterminate', 'both directions can match within half-level; relation is only a reading');
  say('DS10_OPPOSITE_READING_DOES_NOT_REFUSE', depthReading(grey(2, 1, () => 204), symArt, 0.2).relation === 'opposite', '0.8 versus ordering0.2 reads opposite, without an inversion gate');
  const bilinear = grey(2, 2, (x, y) => 20 * x + 40 * y);
  say('DS11_SCALAR_BILINEAR_PIXEL_CENTRES', sampleDepthLevel(bilinear, 1, 1) === 30 && sampleDepthLevel(bilinear, 0.5, 0.5) === 0 && sampleDepthLevel(bilinear, -3, -3) === 0, 'centre average(0,20,40,60)=30; corner/edge clamp=0');
  const padded = padDepthSheet(bilinear, 4);
  say('DS12_PAD4_ALIGNMENT', padded.width === 10 && padded.height === 10 && padded.data[(4 * 10 + 4) * 4] === 0 && padded.data[(5 * 10 + 5) * 4] === 60 && padded.data[(9 * 10 + 9) * 4] === 60, 'original texels land at padded4/5; far pad repeats60');
  const registered = registerDepthRun(set, 'full', { zScale: 12 }, home);
  const record = { name: 'panel', from: 'full:face', x: 1, y: 1, w: 2, h: 2 };
  const transport = { map: () => ({ sx: 1, tx: 0, ty: 0 }), width: 4, extend: [] as string[], owner: new Int32Array(16).fill(-1), ring: new Uint8Array(16), region: null };
  const crop = transportPartDepth(record, grey(2, 2, () => 180), registered, transport);
  say('DS13_FINAL_CROP_REGISTRATION', crop !== undefined && [0, 1, 2, 3].map(i => crop.image.data[i * 4]).join(',') === '60,80,100,120' && crop.reference.near === 'black' && crop.reference.zScale === 12, 'crop x1..2,y1..2 => 60,80/100,120, authored world units12 unchanged');
  const edgeSample = (x: number, y: number, alpha = 255) => {
    const art = grey(1, 1, () => 180); art.data[3] = alpha;
    return transportPartDepth({ ...record, x: 0, y: 0, w: 1, h: 1 }, art, registered, { ...transport, map: () => ({ sx: 1, tx: 0.5 - x, ty: 0.5 - y }) });
  };
  const edges: Array<[number, number, number]> = [[-0.25, 2, 60], [4.25, 2, 120], [2, -0.25, 30], [2, 4.25, 150], [-0.999, -0.999, 0], [4.999, 4.999, 180]];
  const edgeRows = edges.map(([x, y, expected]) => { const p = edgeSample(x, y); return { x, y, expected, level: p?.image.data[0], clamped: p?.clampedSamples, sources: p?.reference.sources }; });
  say('DS42_SUBPIXEL_FOUR_EDGES_AND_CORNERS', edgeRows.every(r => r.level === r.expected && r.clamped === 1 && JSON.stringify(r.sources) === JSON.stringify(crop?.reference.sources)), JSON.stringify(edgeRows));
  const exact = [[-1, 2], [5, 2], [2, -1], [2, 5]], farther = [[-1.001, 2], [5.001, 2], [2, -1.001], [2, 5.001]];
  say('DS43_EXACT_ONE_PIXEL_RED', exact.every(([x, y]) => errors(() => edgeSample(x, y)).includes('DEPTH_PART_SUPPORT')), 'exactly 1 source pixel outside on each of four axes keeps DEPTH_PART_SUPPORT');
  say('DS44_OVER_ONE_PIXEL_RED', farther.every(([x, y]) => errors(() => edgeSample(x, y)).includes('DEPTH_PART_SUPPORT')), '1.001 source pixels outside on each of four axes keeps DEPTH_PART_SUPPORT');
  const boundary = [[0, 2, 60, 0], [4, 2, 120, 1], [2, 0, 30, 0], [2, 4, 150, 1]];
  say('DS45_HALF_OPEN_BOUNDARY', boundary.every(([x, y, expected, count]) => { const p = edgeSample(x, y); return p?.image.data[0] === expected && p.clampedSamples === count; }), '0 is inside; width/height is clamped with zero overrun, identical edge level');
  say('DS46_TRANSPARENT_CLAMP_NOT_COUNTED', edgeSample(-2, -2, 0)?.clampedSamples === 0 && edgeSample(-2, -2, 0)?.image.data[0] === 0, 'transparent cells retain existing rectangular edge clamp without visible counts');
  say('DS47_IN_RANGE_BYTES_UNCHANGED', crop?.clampedSamples === 0 && edgeSample(2, 2)?.image.data[0] === 90 && edgeSample(2, 2)?.clampedSamples === 0, 'independent linear grid: 20*1.5 + 40*1.5 = 90, no clamped samples');
  const headHome = join(dir, 'head-independent');
  const head = bindDepthRun(input(headHome, () => 200), 'head', { zScale: 12 }, headHome);
  const merge = new Map([...registered, ...registerDepthRun(head, 'head', { zScale: 12 }, headHome)]);
  const owner = new Int32Array(16).fill(-1); owner[5] = 0;
  const merged = transportPartDepth(record, grey(2, 2, () => 180), merge, { ...transport, extend: ['head:face'], owner });
  const mergedLevels = [0, 1, 2, 3].map(i => merged?.image.data[i * 4]), mergedSources = merged?.reference.sources;
  say('DS14_MERGE_USES_ACTUAL_LAST_WRITER', mergedLevels.join(',') === '200,80,100,120' && mergedSources?.length === 2 && mergedSources.some(s => s.from === 'full:face') && mergedSources.some(s => s.from === 'head:face') && mergedSources[0].sha256 !== mergedSources[1].sha256, `actual levels${JSON.stringify(mergedLevels)}; independently read/bound source provenance${JSON.stringify(mergedSources)}`);
  const ring = new Uint8Array(16); ring[5] = 1;
  say('DS15_SYNTHESIZED_RIM_RED', errors(() => transportPartDepth(record, grey(2, 2, () => 180), merge, { ...transport, ring })).includes('DEPTH_PART_SUPPORT'), 'visible merge ring has no depth source');
  say('DS16_UNSOURCED_COPY_RED', errors(() => transportPartDepth(record, grey(2, 2, () => 180), registered, { ...transport, extend: ['head:face'], owner })).includes('DEPTH_PART_SUPPORT'), 'a missing extend sheet does not borrow the base');
  const region = new Uint8Array(16).fill(1); region[5] = 0;
  say('DS17_REPLACEMENT_UNDER_ART_RED', errors(() => transportPartDepth(record, grey(2, 2, () => 180), registered, { ...transport, region })).includes('DEPTH_PART_SUPPORT'), 'visible filled under-art cannot claim original layer depth');
  const bare = { ...raw, layers: raw.layers.map(({ depthSheet: _sheet, depthHint: _hint, ...l }) => l) };
  const user = registerDepthRun(bare, 'full', { full: { layers: { face: { image: 'depth.png', near: 'white', zScale: 7 } } } }, home).get('full:face');
  say('DS18_USER_DECLARED_NEAR_AND_UNITS', user?.near === 'white' && user.zScale === 7, 'explicit user convention is retained');
  say('DS19_DECLARATION_CONFLICT_RED', errors(() => registerDepthRun(raw, 'full', { zScale: 12, full: { layers: { face: { image: 'depth.png', near: 'white', zScale: 7 } } } }, home)).includes('DEPTH_SOURCE_AMBIGUOUS'), 'writer filename plus user source never silently selects one');
  const pf = rigParts(); if (crop !== undefined) pf.parts[0].depth = crop.reference;
  const file = join(dir, 'parts.json'); writeParts(file, pf);
  say('DS20_REFERENCE_ROUNDTRIP_AND_NO_DEPTH_OMISSION', JSON.stringify(readParts(file).parts[0].depth) === JSON.stringify(crop?.reference) && !JSON.stringify(rigParts()).includes('"depth"'), 'strict optional reference preserved; no-depth record has no added field');
  const corrupt = JSON.parse(readFileSync(file, 'utf8')) as { parts: Array<{ depth: Record<string, unknown> }> }; corrupt.parts[0].depth.near = 'guessed'; writeFileSync(file, JSON.stringify(corrupt));
  say('DS21_REFERENCE_MUTANT_RED', errors(() => readParts(file)).includes('PARTS_DEPTH_REFERENCE'), 'an invalid persisted convention does not reach output');
  say('DS22_NO_DATA_IS_NOT_ACTIVATED', registerDepthRun(bare, 'full', undefined, home).size === 0, 'no metadata or fallback => no sheet/ref');
  say('DS23_OPAQUE_GRAY_RGB_VALID', depthSheetProblems(original, [4, 4], 'analytic').length === 0, 'R=G=B on an RGBA encoding is valid scalar data');
  const bound = bindDepthRun(set, 'full', { zScale: 12 }, home);
  const source = bound.layers[0];
  const copied = copyDepthMaterial({ ...source, name: 'author:crop', left: 1, top: 1, right: 3, bottom: 3, pixels: grey(2, 2, () => 180) }, [source], (x, y) => [{ layer: source, x, y, weight: 1 }]);
  say('DS27_SOURCE_COPY_RETAINS_ORIGINAL_PROVENANCE', copied.depthSheet?.pixels.data[0] === 60 && copied.depthSheet.sources?.[0].crop.join(',') === '0,0,4,4', 'actual copied crop, original source rectangle retained');
  const shifted = { ...source, left: 3, top: 2, right: 7, bottom: 6 };
  const copiedPad = copyDepthMaterial(shifted, [shifted], (x, y) => [{ layer: shifted, x, y, weight: 1 }]);
  say('DS28_TRANSLATED_SOURCE_GRID_PRESERVED', Buffer.from(copiedPad.depthSheet?.pixels.data ?? []).equals(Buffer.from(source.depthSheet?.pixels.data ?? [])), 'single-run pad shifts domain, not scalar/art pixels');
  const other = { ...source, depthSheet: { ...source.depthSheet!, pixels: grey(4, 4, () => 200) } };
  const composite = copyDepthMaterial({ ...source, pixels: grey(4, 4, () => 180) }, [source, other], (x, y) => [{ layer: source, x, y, weight: 0.25 }, { layer: other, x, y, weight: 0.75 }]);
  say('DS29_KNOWN_COMPOSITE_USES_ACTUAL_WEIGHTS', composite.depthSheet?.pixels.data[0] === 150 && composite.depthSheet.pixels.data[3 * 4] === 165, '0.25*raw(0 or60)+0.75*200=150 or165; no depth fit');

  const enlarged = transportPartDepth({ ...record, x: 0, y: 0 }, grey(2, 2, () => 180), registered, { ...transport, map: () => ({ sx: 2, tx: 0, ty: 0 }) });
  say('DS30_CV_PIXEL_REGISTRATION_AT_SCALE2', [0, 1, 2, 3].map(i => enlarged?.image.data[i * 4]).join(',') === '0,10,20,30', 'existing runMap maps pixel indices; scalar sampler adds the half-centre after inversion');

  const legacyManifest = JSON.stringify(m);
  m.layers[0].depth_filename = 'missing.png'; writeFileSync(join(home, 'layers.json'), JSON.stringify(m));
  const inactiveMissing = readWrapperLayers(home);
  say('DS31_SAME_MISSING_HINT_INACTIVE_VALID_ACTIVE_RED', inactiveMissing.layers[0].depthSheet === undefined && inactiveMissing.layers[0].depthHint?.filename === 'missing.png' && errors(() => readWrapperLayers(home, binding)).includes('DEPTH_SHEET_PRESENT'), 'same untouched manifest; no activation versus explicit config.depth');
  m.layers[0].depth_filename = '../unreadable_hint'; writeFileSync(join(home, 'layers.json'), JSON.stringify(m));
  say('DS32_INACTIVE_HINT_HAS_NO_DEPTH_VALIDATION', errors(() => readWrapperLayers(home)).length === 0 && errors(() => readWrapperLayers(home, binding)).includes('DEPTH_SHEET_FILENAME'), 'inactive raw metadata is preserved, not interpreted as a path');
  writeFileSync(join(home, 'layers.json'), legacyManifest);
  const presentInactive = readWrapperLayers(home), memoryInactive = bindDepthRun(set, 'full', undefined, home);
  const offExport = join(dir, 'export-off'), memoryExport = join(dir, 'export-memory-off');
  exportLayers(presentInactive, offExport); exportLayers(set, memoryExport);
  say('DS33_PRESENT_OR_IN_MEMORY_SHEET_CANNOT_ACTIVATE', presentInactive.layers[0].depthSheet === undefined && memoryInactive.layers[0].depthSheet === undefined && registerDepthRun(set, 'full', undefined, home).size === 0 && readdirSync(offExport).length === 2 && readdirSync(memoryExport).length === 2 && !readFileSync(join(offExport, 'layers.json'), 'utf8').includes('depth_filename'), 'physical file and previously bound in-memory data both require explicit config; raw export stays art-only');
  say('DS34_ACTIVE_EXPORT_PRESERVES_SCALAR', readdirSync(exported).length === 3 && reread.layers[0].depthSheet !== undefined && readdirSync(offExport).every(f => Buffer.from(readFileSync(join(offExport, f))).equals(readFileSync(join(memoryExport, f)))), 'active export includes scalar; both inactive exports have identical legacy bytes');
  const aliasDir = join(home, 'parts'); mkdirSync(aliasDir); writePng(join(aliasDir, 'face_depth.png'), grey(4, 4, () => 1));
  say('DS35_DUPLICATE_ALIAS_ONLY_ACTIVE_RED', errors(() => readWrapperLayers(home)).length === 0 && errors(() => readWrapperLayers(home, binding)).includes('DEPTH_SHEET_UNAMBIGUOUS'), 'conflicting physical sources are ignored only when inactive');
  const authored = rigParts(); authored.parts[1].depth = { image: 'eye_depth.png', near: 'black', zScale: 12, sources: [{ from: 'head:face', image: 'source_depth.png', sha256: '0'.repeat(64), crop: [16, 26, 20, 28], reading: { orderingMedian: null, sheetMedian: 0, relation: 'indeterminate' } }] };
  const paths = writeRigFixture(join(dir, 'authored'), rigConfig(), rigImages(), authored);
  say('DS36_PERSISTED_REFERENCE_ALWAYS_ACTIVE', errors(() => readRigInputs(paths.config, paths.parts)).includes('DEPTH_SHEET_PRESENT'), 'standalone rig config has no depth block; authored part reference still requires its file');
  writePng(join(paths.parts, 'parts/eye_depth.png'), grey(4, 2, () => 0));
  say('DS37_PERSISTED_REFERENCE_READS_DECLARED_FILE', readRigInputs(paths.config, paths.parts).images.has('eye_depth.png'), 'same standalone reader loads valid explicit part data without reactivation flags');
  const badDir = join(dir, 'invalid-inactive'), badRaw = input(badDir), invalidSheet = grey(4, 4, () => 70); invalidSheet.data[1] = 71; invalidSheet.data[3] = 0; writePng(join(badDir, 'depth.png'), invalidSheet);
  say('DS38_INVALID_PHYSICAL_DATA_IS_IGNORED_ONLY_OFF', readWrapperLayers(badDir).layers[0].depthSheet === undefined && errors(() => bindDepthRun(badRaw, 'full', { zScale: 12 }, badDir)).includes('DEPTH_SHEET_GREYSCALE') && errors(() => bindDepthRun(badRaw, 'full', { zScale: 12 }, badDir)).includes('DEPTH_SHEET_OPAQUE'), 'inactive performs no scalar validation; active refuses color and nonopaque pixels');
  const invalidMemory = { ...set, layers: [{ ...layer, depthSheet: { ...scalar!, zScale: 0 } }] };
  say('DS39_BOUND_MEMORY_STILL_REQUIRES_VALID_ACTIVE_UNITS', registerDepthRun(invalidMemory, 'full', undefined, home).size === 0 && errors(() => registerDepthRun(invalidMemory, 'full', {}, home)).includes('DEPTH_ZSCALE_REQUIRED'), 'in-memory data cannot activate itself or evade positive finite units once active');
  const singleDir = join(dir, 'single-atlas'), singleFull = join(singleDir, 'full');
  mkdirSync(singleFull, { recursive: true });
  writePng(join(singleDir, 'painting.png'), grey(10, 6, () => 180));
  writePng(join(singleDir, 'atlas.png'), grey(10, 6, (x, y) => 10 * x + 20 * y));
  writePng(join(singleDir, 'bad-atlas.png'), grey(9, 6, () => 20));
  writePng(join(singleFull, 'face.png'), grey(10, 6, () => 180));
  writePng(join(singleFull, 'lash.png'), grey(10, 6, () => 160));
  writePng(join(singleFull, 'eye_r.png'), grey(10, 6, () => 180));
  writePng(join(singleFull, 'eye_l.png'), grey(10, 6, () => 180));
  writeFileSync(join(singleFull, 'layers.json'), JSON.stringify({ width: 10, height: 6, layers: [
    { name: 'face', filename: 'face.png', left: 0, top: 0, right: 10, bottom: 6, depth_median: 90 / 255 },
    { name: 'eyelash-r', filename: 'lash.png', left: 0, top: 0, right: 10, bottom: 6, depth_median: 80 / 255 },
    { name: 'eyewhite-r', filename: 'eye_r.png', left: 0, top: 0, right: 10, bottom: 6, depth_median: 70 / 255 },
    { name: 'eyewhite-l', filename: 'eye_l.png', left: 0, top: 0, right: 10, bottom: 6, depth_median: 70 / 255 },
  ] }));
  const runSingleStage = (tag: string, cfgBody: Record<string, unknown>) => {
    const cfgPath = join(singleDir, `${tag}.config.json`), outDir = join(singleDir, tag);
    writeFileSync(cfgPath, JSON.stringify(cfgBody));
    return assembleStage({ source: join(singleDir, 'painting.png'), full: singleFull, head: null, config: cfgPath, seam: 'near-white', project: 'core' }, { partsJson: join(outDir, 'parts.json'), partsDir: join(outDir, 'parts'), recomposite: join(outDir, 'recomposite_rig.png'), errorMap: join(outDir, 'recomposite_error_rig.png') }, () => {});
  };
  const singleBaseCfg = { key: 'single_atlas', seethrough: { resolution: 10, steps: 1, seed: 0, offload: false }, assemble: { rig_scale: 1, plan: [['face', 'full', 'face']] } };
  const singleAtlas = runSingleStage('atlas-ok', { ...singleBaseCfg, depth: { full: { atlas: { image: 'atlas.png', near: 'black', zScale: 12 } } } });
  const singleAtlasDepth = singleAtlas.images[0]?.depthImage;
  const expectedSingleAtlas = grey(10, 6, (x, y) => 10 * x + 20 * y);
  const badSingleAtlas = errors(() => runSingleStage('atlas-bad', { ...singleBaseCfg, depth: { full: { atlas: { image: 'bad-atlas.png', near: 'black', zScale: 12 } } } }));
  say('DS40_SINGLE_RUN_NON_SQUARE_ATLAS_PADS_GREEN', singleAtlas.parts.single_run_pad?.file_size.join('x') === '10x6' && singleAtlas.parts.single_run_pad.side === 10 && singleAtlas.parts.parts[0]?.depth?.sources[0]?.crop.join(',') === '0,0,10,6' && singleAtlasDepth !== undefined && Buffer.from(singleAtlasDepth.data).equals(Buffer.from(expectedSingleAtlas.data)) && badSingleAtlas.includes('DEPTH_SHEET_SIZE') && !existsSync(join(singleDir, 'atlas-bad')), `10x6 single run padded to 10x10: pad=${JSON.stringify(singleAtlas.parts.single_run_pad)}, bad 9x6 atlas=${badSingleAtlas.join(',')}`);
  const altStageDir = join(dir, 'alt-stage'), altStageFull = join(altStageDir, 'full'), expectedAltSheet = grey(8, 8, (x, y) => 10 * x + 20 * y);
  mkdirSync(altStageFull, { recursive: true });
  writePng(join(altStageDir, 'painting.png'), grey(8, 8, () => 180));
  writePng(join(altStageDir, 'sheet.png'), expectedAltSheet);
  for (const f of ['face.png', 'lash.png', 'eye_r.png', 'eye_l.png']) writePng(join(altStageFull, f), grey(8, 8, () => 180));
  writeFileSync(join(altStageFull, 'layers.json'), JSON.stringify({ width: 8, height: 8, layers: [
    { name: 'face', filename: 'face.png', left: 0, top: 0, right: 8, bottom: 8, depth_median: 90 / 255 },
    { name: 'eyelash-r', filename: 'lash.png', left: 0, top: 0, right: 8, bottom: 8, depth_median: 80 / 255 },
    { name: 'eyewhite-r', filename: 'eye_r.png', left: 0, top: 0, right: 8, bottom: 8, depth_median: 70 / 255 },
    { name: 'eyewhite-l', filename: 'eye_l.png', left: 0, top: 0, right: 8, bottom: 8, depth_median: 70 / 255 },
  ] }));
  const runAltStage = (tag: string, altName: string) => {
    const cfgPath = join(altStageDir, `${tag}.config.json`), outDir = join(altStageDir, tag);
    writeFileSync(cfgPath, JSON.stringify({
      key: 'alt_collision',
      seethrough: { resolution: 8, steps: 1, seed: 0, offload: false },
      depth: { full: { layers: { 'eyelash-r': { image: 'sheet.png', near: 'black', zScale: 12 } } } },
      assemble: {
        rig_scale: 1,
        plan: [['face', 'full', 'face'], ['warm_lash', 'full', 'eyelash-r'], ['lash_depth', 'full', 'eyewhite-r']],
        alternates: [{ name: altName, source: 'painting.png', full: 'full', parts: ['lash_depth'] }],
      },
    }));
    return assembleStage({ source: join(altStageDir, 'painting.png'), full: altStageFull, head: null, config: cfgPath, seam: 'near-white', project: 'core' }, { partsJson: join(outDir, 'parts.json'), partsDir: join(outDir, 'parts'), recomposite: join(outDir, 'recomposite_rig.png'), errorMap: join(outDir, 'recomposite_error_rig.png') }, () => {});
  };
  let stageCollision: PartsError | undefined;
  try { runAltStage('alt-collision', 'warm'); } catch (error) { if (!(error instanceof PartsError)) throw error; stageCollision = error; }
  runAltStage('alt-distinct', 'cool');
  say('DS41_ASSEMBLE_STAGE_BASE_SHEET_VS_ALTERNATE_ART_COLLISION_RED', stageCollision?.problems.some(p => p.code === 'DEPTH_SHEET_UNAMBIGUOUS' && p.object === 'warm_lash_depth.png' && p.detail.includes('output assets[')) === true && !existsSync(join(altStageDir, 'alt-collision')) && Buffer.from(readPng(join(altStageDir, 'alt-distinct/parts/warm_lash_depth.png')).data).equals(Buffer.from(expectedAltSheet.data)) && readPng(join(altStageDir, 'alt-distinct/parts/cool_lash_depth.png')).width === 8, JSON.stringify(stageCollision?.problems));

}

/** Real pinned Core generator consumer; production weighted meshes stay unchanged. */
export function runDepthSheetCoreChecks(dir: string, say: Say): void {
  mkdirSync(join(dir, 'images'), { recursive: true });
  const source = input(join(dir, 'source'));
  const registered = registerDepthRun(source, 'full', { zScale: 4 }, dir);
  const part = transportPartDepth({ name: 'panel', from: 'full:face', x: 0, y: 0, w: 4, h: 4 }, grey(4, 4, () => 180), registered, { map: () => ({ sx: 1, tx: 0, ty: 0 }), width: 4, extend: [], owner: new Int32Array(16).fill(-1), ring: new Uint8Array(16), region: null });
  if (part === undefined) throw new Error('analytic source must emit its registered sheet');
  writePng(join(dir, 'images/panel.png'), pad(grey(4, 4, () => 180), 4, 4, 4, 4, [0, 0, 0, 0]));
  writePng(join(dir, 'images/panel_depth.png'), padDepthSheet(part.image, 4));
  // Core cols/rows count positions:9 vertices and2*(3-1)*(3-1)=8 triangles.
  const rig = { spec: 'rigc-rig/1', name: 'depth_fixture', images: 'images', skeleton: { width: 16, height: 16 }, bones: [{ name: 'root' }, { name: 'clock', parent: 'root' }], slots: [{ name: 'panel', bone: 'root', attachment: 'panel' }], skins: { default: { panel: { panel: { type: 'mesh', image: 'panel.png', generator: { kind: 'grid', cols: 3, rows: 3, depth: { image: 'panel_depth.png', near: 'black' as 'black' | 'white', zScale: 4 } } } } } }, invariants: { meshSlots: 1, meshTriangles: 8 } } satisfies RigSpec;
  const parsedRig = parseRigSpec(rig, 'analytic depth fixture rig');
  say('DZ32_TYPED_RIG_PASSES_ACTUAL_READER', parsedRig.invariants?.meshSlots === 1 && parsedRig.invariants.meshTriangles === 8, 'published RigSpec and parseRigSpec; hand-derived3x3 positions =>1slot/8triangles');
  const motion = { spec: 'rigc-motion/1', archetype: rig.name, cut: 'painting', easings: {}, animations: { idle: { duration: 1, loop: true, tracks: [{ bone: 'clock', property: 'translate', keys: [{ t: 0, v: [0, 0] }, { t: 1, v: [0, 0] }] }] } } } satisfies MotionSpec;
  const parsedMotion = parseMotionSpec(motion, 'analytic depth fixture motion');
  say('DZ30_TYPED_MOTION_PASSES_ACTUAL_READER', parsedMotion.archetype === rig.name && Object.keys(parsedMotion.easings).length === 0, 'satisfies published MotionSpec; parseMotionSpec checks the same object before CLI build');
  const missingEasings: Record<string, unknown> = { ...motion }; delete missingEasings.easings;
  let missingCode: string | undefined;
  try { parseMotionSpec(missingEasings, 'analytic missing easings plant'); } catch (error) { if (!(error instanceof CompileError)) throw error; missingCode = error.code; }
  say('DZ31_MISSING_EASINGS_READER_RED', missingCode === 'CE_MOTION_FIELD_SHAPE', `actual reader refuses the previous missing-field input with ${missingCode}`);
  writeFileSync(join(dir, 'motion.json'), JSON.stringify(motion));
  writeFileSync(join(dir, 'rig.json'), JSON.stringify(rig));
  const run = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve('@rig-c/core/cli')), 'build', '--rig', join(dir, 'rig.json'), '--motion', join(dir, 'motion.json'), '--out', join(dir, 'built'), '--profile', 'rig-play', '--pack'], { encoding: 'utf8' });
  writeFileSync(join(dir, 'core.log'), run.stdout + run.stderr);
  say('DZ24_ACTUAL_CORE_GENERATOR_GATE', run.status === 0, `actual Core build --profile rig-play --pack exit${run.status}; raw=${JSON.stringify({ stdout: run.stdout, stderr: run.stderr })}`);
  if (run.status !== 0) return;
  const atlas = readFileSync(join(dir, 'built/skeleton.atlas'), 'utf8');
  say('DZ25_DEPTH_SHEET_NOT_PACKED_ART', atlas.includes('panel') && !atlas.includes('panel_depth'), 'only drawing attachment is packed; measurement sheet remains a compile-time input');
  const emitted = readPng(join(dir, 'images/panel_depth.png'));
  // Core CompileOptions (2.69.0 compile.ts:1850) reads these actual paths;
  // meshes[].depth is the compiler-produced report (types.ts:1710), not a
  // local sampler standing in for it. The CLI above performs the real gate.
  const measure = () => compile({ rigPath: join(dir, 'rig.json'), motionPath: join(dir, 'motion.json'), outDir: join(dir, 'sdk') }).meshes[0]?.depth;
  const measured = measure();
  const expectedLevels = Uint8Array.from({ length: 144 }, (_, i) => 20 * Math.max(0, Math.min(3, i % 12 - 4)) + 40 * Math.max(0, Math.min(3, Math.floor(i / 12) - 4)));
  const header = Buffer.alloc(8); header.writeUInt32BE(12, 0); header.writeUInt32BE(12, 4);
  const digest = createHash('sha256').update(header).update(expectedLevels).digest('hex').slice(0, 16);
  say('DZ26_CORE_REPORT_DIGEST_AND_SAMPLED_RANGE', emitted.width === 12 && measured?.digest === digest && measured.near === 'black' && measured.zScale === 4 && measured.range[0] === f32(20 / 17) && measured.range[1] === 4, `Core ${JSON.stringify(measured)}; independent definition:12x12 levels20*clamp(x-4)+40*clamp(y-4), digest${digest}, range[f32(20/17),4]`);
  writePng(join(dir, 'images/panel_depth.png'), grey(12, 12, (x, y) => 255 - expectedLevels[y * 12 + x]));
  const wrongMap = measure();
  say('DZ27_WRONG_MAP_PLANT_CHANGES_CORE_EVIDENCE', wrongMap?.digest !== digest && wrongMap?.range[0] === 0 && wrongMap.range[1] === f32(48 / 17), `actual inverted-map Core report ${JSON.stringify(wrongMap)}; original digest/range expectation rejects it`);
  writePng(join(dir, 'images/panel_depth.png'), padDepthSheet(part.image, 4));
  rig.skins.default.panel.panel.generator.depth.near = 'white'; writeFileSync(join(dir, 'rig.json'), JSON.stringify(rig));
  const wrongNear = measure();
  say('DZ28_DECLARED_DIRECTION_PLANT_CHANGES_CORE_Z', wrongNear?.digest === digest && wrongNear.near === 'white' && wrongNear.range[0] === 0 && wrongNear.range[1] === f32(48 / 17), `same sheet, explicit nearwhite gives Core ${JSON.stringify(wrongNear)}; units/map are unchanged`);
  rig.skins.default.panel.panel.generator.depth.near = 'black'; writeFileSync(join(dir, 'rig.json'), JSON.stringify(rig));
  const restored = measure();
  say('DZ29_SYNTHETIC_INPUT_RESTORED', JSON.stringify(restored) === JSON.stringify(measured), 'generated test sheet/direction restored after explicit plants; no repository source mutation');

  // #763: 2.5D head-turn producer positive and negative controls through buildRig + Core gate.
  const make25DFixture = () => {
    const W = 64, H = 64;
    const solid = (w: number, h: number, r: number, g: number, b: number): Raster => {
      const img = newRaster(w, h);
      for (let i = 0; i < w * h; i++) img.data.set([r, g, b, 255], i * 4);
      return img;
    };
    const faceArt = newRaster(24, 24);
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        // Leave a 1px transparent border around the face so silhouette extension is exercised.
        const a = x >= 1 && x <= 22 && y >= 1 && y <= 22 ? 255 : 0;
        faceArt.data.set([240, 210, 195, a], (y * 24 + x) * 4);
      }
    }
    // Smooth dome on opaque face pixels (centre ~210, edges ~160) and background drop (10) on the 1px transparent border.
    const faceDepth = grey(24, 24, (x, y) => {
      if (x < 1 || x > 22 || y < 1 || y > 22) return 10;
      const dx = (x - 11.5) / 11;
      const dy = (y - 11.5) / 11;
      return Math.round(210 - 35 * Math.min(1, dx * dx + dy * dy));
    });
    const depthSha = createHash('sha256').update(encodePngBytes(faceDepth)).digest('hex');
    const baseCounts = { projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 };
    const pf: PartsFile = {
      scale_rig_per_source: 1,
      rig_size: [W, H] as [number, number],
      parts: [
        { ...baseCounts, name: 'hair_back', from: 'full:back hair', x: 16, y: 12, w: 32, h: 36, opaque_px: 32 * 36 },
        { ...baseCounts, name: 'ear_r', from: 'head:ears-r', x: 16, y: 24, w: 4, h: 6, opaque_px: 24 },
        { ...baseCounts, name: 'ear_l', from: 'head:ears-l', x: 44, y: 24, w: 4, h: 6, opaque_px: 24 },
        {
          ...baseCounts,
          name: 'face',
          from: 'head:face',
          x: 20,
          y: 16,
          w: 24,
          h: 24,
          opaque_px: 22 * 22,
          depth: {
            image: 'face_depth.png',
            near: 'white' as const,
            zScale: 40,
            sources: [{ from: 'head:face', image: 'face_depth_src.png', sha256: depthSha, crop: [20, 16, 44, 40] as [number, number, number, number], reading: depthReading(faceDepth, faceArt, null) }],
          },
        },
        { ...baseCounts, name: 'eyewhite_r', from: 'head:eyewhite-r', x: 24, y: 24, w: 4, h: 4, opaque_px: 16 },
        { ...baseCounts, name: 'eyewhite_l', from: 'head:eyewhite-l', x: 36, y: 24, w: 4, h: 4, opaque_px: 16 },
        { ...baseCounts, name: 'mouth', from: 'head:mouth', x: 30, y: 34, w: 4, h: 2, opaque_px: 8 },
        { ...baseCounts, name: 'hair_front', from: 'head:front hair', x: 18, y: 12, w: 28, h: 16, opaque_px: 28 * 16 },
      ] satisfies PartRecord[],
      ghost_px: {},
      recomposite: { mean_abs: 0, within_limit: 0, within_share: 1, error_limit: 0, error_px: 0, covered_alpha: 8, uncovered_error_px: 0, hole_count: 0, holes_listed: 0, holes: [] },
    };
    const imgs = new Map<string, Raster>([
      ['hair_back', solid(32, 36, 60, 50, 70)],
      ['ear_r', solid(4, 6, 235, 200, 185)],
      ['ear_l', solid(4, 6, 235, 200, 185)],
      ['face', faceArt],
      ['face_depth.png', faceDepth],
      ['eyewhite_r', solid(4, 4, 250, 250, 250)],
      ['eyewhite_l', solid(4, 4, 250, 250, 250)],
      ['mouth', solid(4, 2, 200, 90, 90)],
      ['hair_front', solid(28, 16, 70, 60, 85)],
    ]);
    const rawCfg: Record<string, unknown> = {
      key: 'turn25d',
      seethrough: { resolution: 64, steps: 1, seed: 0, offload: false },
      assemble: {
        rig_scale: 1,
        plan: [
          ['hair_back', 'full', 'back hair'],
          ['ear_r', 'head', 'ears-r'],
          ['ear_l', 'head', 'ears-l'],
          ['face', 'head', 'face'],
          ['eyewhite_r', 'head', 'eyewhite-r'],
          ['eyewhite_l', 'head', 'eyewhite-l'],
          ['mouth', 'head', 'mouth'],
          ['hair_front', 'head', 'front hair'],
        ],
      },
      bones: [
        { name: 'hip', parent: 'root', at: [32, 56] },
        { name: 'head', parent: 'hip', at: [32, 36] },
        { name: 'eye_r', parent: 'head', at: [26, 26] },
        { name: 'eye_l', parent: 'head', at: [38, 26] },
        { name: 'mouth', parent: 'head', at: [32, 35] },
        { name: 'ear_r', parent: 'head', at: [18, 27] },
        { name: 'ear_l', parent: 'head', at: [46, 27] },
        { chain: 'bang_c', parent: 'head', points: [[32, 16], [32, 22]], tip: [32, 27] },
        { chain: 'hb_c', parent: 'head', points: [[32, 24], [32, 36]], tip: [32, 46] },
      ],
      meshes: {
        hair_front: { grid: 8, r: 20, segments: [['head', [32, 36], [32, 14]], 'bang_c'] },
        hair_back: { grid: 8, r: 20, segments: [['head', [32, 36], [32, 14]], 'hb_c'] },
      },
      regions: {
        ear_r: 'ear_r',
        ear_l: 'ear_l',
        face: 'head',
        eyewhite_r: 'eye_r',
        eyewhite_l: 'eye_l',
        mouth: 'mouth',
      },
      motion: {
        duration: 2,
        tracks: [{ bone: 'head', prop: 'rotate', amp: 1, period: 2, phase: 0 }],
      },
      turn: {
        pivot: 20,
        counter: 0.1,
        grid: [5, 5],
        roles: {
          hair_back: 'rear',
          ear_r: 'unit',
          ear_l: 'unit',
          face: 'surface',
          eyewhite_r: 'unit',
          eyewhite_l: 'unit',
          mouth: 'unit',
          hair_front: 'unit',
        },
        unitDepths: {
          ear_r: -4,
          ear_l: -4,
        },
      },
    };
    return { pf, imgs, rawCfg };
  };

  const f25 = make25DFixture();
  const built25 = buildRig(parseConfig(f25.rawCfg), f25.pf, f25.imgs);
  const t25Dir = join(dir, 'turn25d');
  mkdirSync(join(t25Dir, 'images'), { recursive: true });
  for (const [name, img] of built25.images) writePng(join(t25Dir, 'images', name), img);
  for (const [name, text] of rigOutputTexts(built25, null)) writeFileSync(join(t25Dir, name), text);
  const run25 = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve('@rig-c/core/cli')), 'build', '--rig', join(t25Dir, 'rig.json'), '--motion', join(t25Dir, 'motion.json'), '--out', join(t25Dir, 'built'), '--profile', 'rig-play'], { encoding: 'utf8' });
  const boneParents25 = new Map(built25.rig.bones.map((b) => [b.name, b.parent]));
  const faceAtt25 = built25.rig.skins.default.face?.face;
  const hfWeights25 = built25.rig.skins.default.hair_front?.hair_front;
  const hbWeights25 = built25.rig.skins.default.hair_back?.hair_back;
  const hfUsesFaceshift = hfWeights25 !== undefined && 'type' in hfWeights25 && hfWeights25.weights.some((r) => r.some((w) => w.bone === 'faceshift'));
  const hfUsesUnitCarrier =
    hfWeights25 !== undefined &&
    'type' in hfWeights25 &&
    hfWeights25.weights.some((r) => r.some((w) => w.bone === 'hair_front_unit'));
  const hfUsesBangChain =
    hfWeights25 !== undefined &&
    'type' in hfWeights25 &&
    hfWeights25.weights.some((r) => r.some((w) => w.bone === 'bang_c0' || w.bone === 'bang_c1')) &&
    hfWeights25.weights.every(
      (r) => r.length > 0 && r.every((w) => w.bone === 'hair_front_unit' || w.bone === 'bang_c0' || w.bone === 'bang_c1'),
    );
  const hbUsesRearShift = hbWeights25 !== undefined && 'type' in hbWeights25 && hbWeights25.weights.some((r) => r.some((w) => w.bone === 'rear_shift'));
  const turnUnits25 = built25.motion.groups?.turn_units ?? [];
  const skel25 = JSON.parse(readFileSync(join(t25Dir, 'built/skeleton.json'), 'utf8')) as {
    animations: Record<string, {
      bones?: Record<string, {
        translatex?: Array<{ time?: number; value?: number }>;
        translatey?: Array<{ time?: number; value?: number }>;
      }>;
    }>;
  };
  const faceshiftYawPos25 = skel25.animations.turn?.bones?.faceshift?.translatex?.[3]?.value ?? 0;
  const unitYawPos25 = skel25.animations.turn?.bones?.hair_front_unit?.translatex?.[3]?.value ?? 0;
  const worldUnitYawPos25 = faceshiftYawPos25 + unitYawPos25;
  const faceshiftPitchPos25 = skel25.animations.tilt?.bones?.faceshift?.translatey?.[3]?.value ?? 0;
  const unitPitchPos25 = skel25.animations.tilt?.bones?.hair_front_unit?.translatey?.[3]?.value ?? 0;
  const worldUnitPitchPos25 = faceshiftPitchPos25 + unitPitchPos25;

  // Compare against a region unit part on bang_c0 to prove identical unit depth translation.
  const f25Region = make25DFixture();
  delete (f25Region.rawCfg.meshes as Record<string, unknown>).hair_front;
  (f25Region.rawCfg.regions as Record<string, unknown>).hair_front = 'bang_c0';
  const built25Region = buildRig(parseConfig(f25Region.rawCfg), f25Region.pf, f25Region.imgs);
  const t25RegDir = join(dir, 'turn25d_reg');
  mkdirSync(join(t25RegDir, 'images'), { recursive: true });
  for (const [name, img] of built25Region.images) writePng(join(t25RegDir, 'images', name), img);
  for (const [name, text] of rigOutputTexts(built25Region, null)) writeFileSync(join(t25RegDir, name), text);
  const run25Reg = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve('@rig-c/core/cli')), 'build', '--rig', join(t25RegDir, 'rig.json'), '--motion', join(t25RegDir, 'motion.json'), '--out', join(t25RegDir, 'built'), '--profile', 'rig-play'], { encoding: 'utf8' });
  const skel25Reg = JSON.parse(readFileSync(join(t25RegDir, 'built/skeleton.json'), 'utf8')) as typeof skel25;
  const regBang0YawPos25 = skel25Reg.animations.turn?.bones?.bang_c0?.translatex?.[3]?.value ?? 0;
  const regBang0PitchPos25 = skel25Reg.animations.tilt?.bones?.bang_c0?.translatey?.[3]?.value ?? 0;

  // Verify parent-first bone order holds: faceshift < hair_front_unit < bang_c0 < bang_c1.
  const faceshiftIdx = built25.rig.bones.findIndex((b) => b.name === 'faceshift');
  const unitIdx = built25.rig.bones.findIndex((b) => b.name === 'hair_front_unit');
  const bang0Idx = built25.rig.bones.findIndex((b) => b.name === 'bang_c0');
  const bang1Idx = built25.rig.bones.findIndex((b) => b.name === 'bang_c1');

  // Verify a demo-shaped multi-chain "unit" mesh (binding "head" directly plus two chains bang_r, bang_l).
  const f25Demo = make25DFixture();
  (f25Demo.rawCfg.bones as unknown[]).push(
    { chain: 'bang_r', parent: 'head', points: [[24, 16], [24, 22]], tip: [24, 27] },
    { chain: 'bang_l', parent: 'head', points: [[40, 16], [40, 22]], tip: [40, 27] },
  );
  (f25Demo.rawCfg.meshes as Record<string, unknown>).hair_front = {
    grid: 8,
    r: 20,
    segments: [['head', [32, 36], [32, 14]], 'bang_r', 'bang_c', 'bang_l'],
  };
  const built25Demo = buildRig(parseConfig(f25Demo.rawCfg), f25Demo.pf, f25Demo.imgs);
  const t25DemoDir = join(dir, 'turn25d_demo');
  mkdirSync(join(t25DemoDir, 'images'), { recursive: true });
  for (const [name, img] of built25Demo.images) writePng(join(t25DemoDir, 'images', name), img);
  for (const [name, text] of rigOutputTexts(built25Demo, null)) writeFileSync(join(t25DemoDir, name), text);
  const run25Demo = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve('@rig-c/core/cli')), 'build', '--rig', join(t25DemoDir, 'rig.json'), '--motion', join(t25DemoDir, 'motion.json'), '--out', join(t25DemoDir, 'built'), '--profile', 'rig-play'], { encoding: 'utf8' });
  const demoParents = new Map(built25Demo.rig.bones.map((b) => [b.name, b.parent]));
  const demoWeights = built25Demo.rig.skins.default.hair_front?.hair_front;
  const demoAllUnderUnit =
    demoParents.get('hair_front_unit') === 'faceshift' &&
    demoParents.get('bang_r0') === 'hair_front_unit' &&
    demoParents.get('bang_c0') === 'hair_front_unit' &&
    demoParents.get('bang_l0') === 'hair_front_unit' &&
    demoWeights !== undefined &&
    'type' in demoWeights &&
    demoWeights.weights.every((r) =>
      r.every((w) =>
        ['hair_front_unit', 'bang_r0', 'bang_r1', 'bang_c0', 'bang_c1', 'bang_l0', 'bang_l1'].includes(w.bone),
      ),
    );

  say(
    'DZ51_TURN_25D_PRODUCER_PROMOTES_SURFACE_REPARENTS_CARRIERS_AND_GATES_CORE',
    run25.status === 0 &&
      run25Reg.status === 0 &&
      run25Demo.status === 0 &&
      faceAtt25 !== undefined &&
      'type' in faceAtt25 &&
      faceAtt25.generator?.kind === 'grid' &&
      faceAtt25.generator.cols === 5 &&
      faceAtt25.generator.rows === 5 &&
      boneParents25.get('faceshift') === 'head' &&
      boneParents25.get('rear_shift') === 'head' &&
      boneParents25.get('face_surface') === 'faceshift' &&
      boneParents25.get('hair_front_unit') === 'faceshift' &&
      boneParents25.get('eye_r') === 'faceshift' &&
      boneParents25.get('ear_r') === 'faceshift' &&
      boneParents25.get('bang_c0') === 'hair_front_unit' &&
      boneParents25.get('bang_c1') === 'bang_c0' &&
      boneParents25.get('hb_c0') === 'rear_shift' &&
      !hfUsesFaceshift &&
      hfUsesUnitCarrier &&
      hfUsesBangChain &&
      hbUsesRearShift &&
      demoAllUnderUnit &&
      turnUnits25.includes('hair_front_unit') &&
      !turnUnits25.includes('bang_c0') &&
      unitYawPos25 > 0 &&
      unitYawPos25 === regBang0YawPos25 &&
      unitPitchPos25 > 0 &&
      unitPitchPos25 === regBang0PitchPos25 &&
      faceshiftIdx !== -1 &&
      unitIdx > faceshiftIdx &&
      bang0Idx > unitIdx &&
      bang1Idx > bang0Idx &&
      built25.motion.animations.turn !== undefined &&
      built25.motion.animations.tilt !== undefined,
    `Core build exit=${run25.status} (demo=${run25Demo.status}); generator=${JSON.stringify(faceAtt25 && 'type' in faceAtt25 ? faceAtt25.generator : null)}; parents: faceshift->${boneParents25.get('faceshift')}, rear_shift->${boneParents25.get('rear_shift')}, hair_front_unit->${boneParents25.get('hair_front_unit')}, bang_c0->${boneParents25.get('bang_c0')}, bang_c1->${boneParents25.get('bang_c1')}, hb_c0->${boneParents25.get('hb_c0')}; hfUsesFaceshift=${hfUsesFaceshift}, hfUsesUnitCarrier=${hfUsesUnitCarrier}, hfUsesBangChain=${hfUsesBangChain}, hbUsesRearShift=${hbUsesRearShift}, demoAllUnderUnit=${demoAllUnderUnit}; unitYawPos=${unitYawPos25} (world=${worldUnitYawPos25.toFixed(6)} vs faceshift=${faceshiftYawPos25}, reg=${regBang0YawPos25}); unitPitchPos=${unitPitchPos25} (world=${worldUnitPitchPos25.toFixed(6)} vs faceshift=${faceshiftPitchPos25}, reg=${regBang0PitchPos25}); faceshift@${faceshiftIdx}<hair_front_unit@${unitIdx}<bang_c0@${bang0Idx}<bang_c1@${bang1Idx}`,
  );

  const badRole = make25DFixture();
  (badRole.rawCfg.turn as { roles: Record<string, unknown> }).roles.face = 'bogus';
  const badNoSurface = make25DFixture();
  (badNoSurface.rawCfg.turn as { roles: Record<string, unknown> }).roles.face = 'unit';
  const badEarOrder = make25DFixture();
  badEarOrder.rawCfg.assemble = {
    rig_scale: 1,
    plan: [
      ['hair_back', 'full', 'back hair'],
      ['face', 'head', 'face'],
      ['ear_r', 'head', 'ears-r'],
      ['ear_l', 'head', 'ears-l'],
      ['eyewhite_r', 'head', 'eyewhite-r'],
      ['eyewhite_l', 'head', 'eyewhite-l'],
      ['mouth', 'head', 'mouth'],
      ['hair_front', 'head', 'front hair'],
    ],
  };
  const badReservedBone = make25DFixture();
  (badReservedBone.rawCfg.bones as unknown[]).push({ name: 'faceshift', parent: 'head', at: [32, 36] });
  const badReservedUnitBone = make25DFixture();
  (badReservedUnitBone.rawCfg.bones as unknown[]).push({ name: 'hair_front_unit', parent: 'head', at: [32, 36] });
  const badHeadSurfaceMesh = make25DFixture();
  delete (badHeadSurfaceMesh.rawCfg.regions as Record<string, unknown>).face;
  (badHeadSurfaceMesh.rawCfg.meshes as Record<string, unknown>).face = { grid: 8, r: 20, segments: [['head', [32, 36], [32, 14]]] };
  const badHeadUnitMeshOutside = make25DFixture();
  (badHeadUnitMeshOutside.rawCfg.meshes as Record<string, unknown>).hair_front = {
    grid: 8,
    r: 20,
    segments: [['hip', [32, 56], [32, 36]], 'bang_c'],
  };
  const badHeadUnitMeshShared = make25DFixture();
  (badHeadUnitMeshShared.rawCfg.meshes as Record<string, unknown>).hair_back = {
    grid: 8,
    r: 20,
    segments: ['bang_c'],
  };
  ((badHeadUnitMeshShared.rawCfg.turn as { roles: Record<string, unknown> }).roles).hair_back = 'unit';
  const badHeadUnitMeshSharedRig = make25DFixture();
  (badHeadUnitMeshSharedRig.rawCfg.meshes as Record<string, unknown>).hair_back = {
    grid: 8,
    r: 20,
    segments: [['bang_c1', [32, 22], [32, 27]]],
  };
  const parsedSharedRig = parseConfig(badHeadUnitMeshSharedRig.rawCfg);
  (parsedSharedRig.turn?.roles as Record<string, string>).hair_back = 'unit';
  const badNoDepth = make25DFixture();
  delete (badNoDepth.pf.parts.find((p) => p.name === 'face') as { depth?: unknown }).depth;
  const badGridBudget = make25DFixture();
  (badGridBudget.rawCfg.turn as { grid: unknown }).grid = [40, 40];
  const badEarFront = make25DFixture();
  (badEarFront.rawCfg.turn as { unitDepths: Record<string, number> }).unitDepths = { ear_r: 40, ear_l: -4 };

  const cRole = errors(() => parseConfig(badRole.rawCfg));
  const cNoSurf = errors(() => parseConfig(badNoSurface.rawCfg));
  const cEarOrd = errors(() => parseConfig(badEarOrder.rawCfg));
  const cResBone = errors(() => parseConfig(badReservedBone.rawCfg));
  const cResUnitBone = errors(() => parseConfig(badReservedUnitBone.rawCfg));
  const cSurfMesh = errors(() => parseConfig(badHeadSurfaceMesh.rawCfg));
  const cUnitMeshOutside = errors(() => parseConfig(badHeadUnitMeshOutside.rawCfg));
  let sharedCfgErr: PartsError | undefined;
  try {
    parseConfig(badHeadUnitMeshShared.rawCfg);
  } catch (e) {
    if (e instanceof PartsError) sharedCfgErr = e;
    else throw e;
  }
  let sharedRigErr: PartsError | undefined;
  try {
    buildRig(parsedSharedRig, badHeadUnitMeshSharedRig.pf, badHeadUnitMeshSharedRig.imgs);
  } catch (e) {
    if (e instanceof PartsError) sharedRigErr = e;
    else throw e;
  }
  const cUnitMeshSharedOk =
    sharedCfgErr?.problems.some(
      (p) =>
        p.code === 'CONFIG_TURN_UNIT_MESH_BONES' &&
        p.object === 'config.turn.roles.hair_front' &&
        p.detail.includes('"hair_front"') &&
        p.detail.includes('"hair_back"') &&
        p.detail.includes('"bang_c0"'),
    ) === true &&
    sharedRigErr?.problems.some(
      (p) =>
        p.code === 'CONFIG_TURN_UNIT_MESH_BONES' &&
        p.object === 'config.turn.roles.hair_front' &&
        p.detail.includes('"hair_front"') &&
        p.detail.includes('"hair_back"') &&
        p.detail.includes('"bang_c0"') &&
        p.detail.includes('"bang_c1"'),
    ) === true;
  const cNoDepth = errors(() => buildRig(parseConfig(badNoDepth.rawCfg), badNoDepth.pf, badNoDepth.imgs));
  const cGrid = errors(() => buildRig(parseConfig(badGridBudget.rawCfg), badGridBudget.pf, badGridBudget.imgs));
  const cEarFront = errors(() => buildRig(parseConfig(badEarFront.rawCfg), badEarFront.pf, badEarFront.imgs));
  say(
    'DZ52_TURN_25D_CONFIG_AND_RIG_REFUSALS_NAMED',
    cRole.includes('CONFIG_TURN_ROLE_UNKNOWN') &&
      cNoSurf.includes('CONFIG_TURN_SURFACE_REQUIRED') &&
      cEarOrd.includes('CONFIG_TURN_EAR_DRAW_ORDER') &&
      cResBone.includes('CONFIG_TURN_BONE_FREE') &&
      cResUnitBone.includes('CONFIG_TURN_BONE_FREE') &&
      cSurfMesh.length === 0 &&
      cUnitMeshOutside.includes('CONFIG_TURN_UNIT_MESH_BONES') &&
      cUnitMeshSharedOk &&
      cNoDepth.includes('RIG_TURN_SURFACE_DEPTH_REQUIRED') &&
      cGrid.includes('RIG_TURN_GRID_BUDGET') &&
      cEarFront.includes('RIG_TURN_EAR_DEPTH_BEHIND_CHEEK'),
    `role=${cRole.join(',')}; noSurf=${cNoSurf.join(',')}; earOrder=${cEarOrd.join(',')}; resBone=${cResBone.join(',')}; resUnitBone=${cResUnitBone.join(',')}; surfMesh=${cSurfMesh.join(',')}; unitMeshOutside=${cUnitMeshOutside.join(',')}; unitMeshShared=${cUnitMeshSharedOk}; noDepth=${cNoDepth.join(',')}; grid=${cGrid.join(',')}; earFront=${cEarFront.join(',')}`,
  );

  // #787: 2.5D body-turn dial projecting torso surface grids through the head's turn path.
  const makeBody25DFixture = () => {
    const base = make25DFixture();
    const baseCounts = { projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 };
    const makeDome = (w: number, h: number, r: number, g: number, b: number) => {
      const art = newRaster(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const a = x >= 1 && x <= w - 2 && y >= 1 && y <= h - 2 ? 255 : 0;
          art.data.set([r, g, b, a], (y * w + x) * 4);
        }
      }
      const cx = (w - 1) / 2;
      const cy = (h - 1) / 2;
      const rx = Math.max(1, cx - 0.5);
      const ry = Math.max(1, cy - 0.5);
      const depth = grey(w, h, (x, y) => {
        if (x < 1 || x > w - 2 || y < 1 || y > h - 2) return 10;
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        return Math.round(215 - 40 * Math.min(1, dx * dx + 0.5 * dy * dy));
      });
      const sha = createHash('sha256').update(encodePngBytes(depth)).digest('hex');
      return { art, depth, sha };
    };
    const topDome = makeDome(24, 16, 80, 130, 210);
    const botDome = makeDome(26, 14, 50, 75, 145);
    const capeArt = newRaster(30, 24);
    for (let i = 0; i < 30 * 24; i++) capeArt.data.set([40, 35, 55, 255], i * 4);
    const badgeArt = newRaster(4, 4);
    for (let i = 0; i < 16; i++) badgeArt.data.set([245, 200, 60, 255], i * 4);

    base.pf.parts.splice(
      1,
      0,
      { ...baseCounts, name: 'cape', from: 'full:wings', x: 17, y: 36, w: 30, h: 24, opaque_px: 30 * 24 },
      {
        ...baseCounts,
        name: 'bottomwear',
        from: 'full:bottomwear',
        x: 19,
        y: 48,
        w: 26,
        h: 14,
        opaque_px: 24 * 12,
        depth: {
          image: 'bottomwear_depth.png',
          near: 'white' as const,
          zScale: 36,
          sources: [{ from: 'full:bottomwear', image: 'bottomwear_depth_src.png', sha256: botDome.sha, crop: [19, 48, 45, 62] as [number, number, number, number], reading: depthReading(botDome.depth, botDome.art, null) }],
        },
      },
      {
        ...baseCounts,
        name: 'topwear',
        from: 'full:topwear',
        x: 20,
        y: 36,
        w: 24,
        h: 16,
        opaque_px: 22 * 14,
        depth: {
          image: 'topwear_depth.png',
          near: 'white' as const,
          zScale: 36,
          sources: [{ from: 'full:topwear', image: 'topwear_depth_src.png', sha256: topDome.sha, crop: [20, 36, 44, 52] as [number, number, number, number], reading: depthReading(topDome.depth, topDome.art, null) }],
        },
      },
      { ...baseCounts, name: 'badge', from: 'full:neckwear', x: 26, y: 40, w: 4, h: 4, opaque_px: 16 },
    );
    base.imgs.set('cape', capeArt);
    base.imgs.set('bottomwear', botDome.art);
    base.imgs.set('bottomwear_depth.png', botDome.depth);
    base.imgs.set('topwear', topDome.art);
    base.imgs.set('topwear_depth.png', topDome.depth);
    base.imgs.set('badge', badgeArt);

    (base.rawCfg.assemble as { plan: unknown[][] }).plan.splice(
      1,
      0,
      ['cape', 'full', 'wings'],
      ['bottomwear', 'full', 'bottomwear'],
      ['topwear', 'full', 'topwear'],
      ['badge', 'full', 'neckwear'],
    );
    base.rawCfg.bones = [
      { name: 'hip', parent: 'root', at: [32, 56] },
      { name: 'chest', parent: 'hip', at: [32, 44] },
      { name: 'badge_b', parent: 'chest', at: [28, 42] },
      { name: 'head', parent: 'chest', at: [32, 36] },
      { name: 'eye_r', parent: 'head', at: [26, 26] },
      { name: 'eye_l', parent: 'head', at: [38, 26] },
      { name: 'mouth', parent: 'head', at: [32, 35] },
      { name: 'ear_r', parent: 'head', at: [18, 27] },
      { name: 'ear_l', parent: 'head', at: [46, 27] },
      { chain: 'bang_c', parent: 'head', points: [[32, 16], [32, 22]], tip: [32, 27] },
      { chain: 'hb_c', parent: 'head', points: [[32, 24], [32, 36]], tip: [32, 46] },
    ];
    const regs = base.rawCfg.regions as Record<string, string>;
    regs.cape = 'chest';
    regs.bottomwear = 'hip';
    regs.topwear = 'chest';
    regs.badge = 'badge_b';
    (base.rawCfg.turn as Record<string, unknown>).body = {
      pivot: 18,
      bone: 'chest',
      counter: 0.12,
      grid: { topwear: [5, 5], bottomwear: [4, 4] },
      roles: {
        cape: 'rear',
        bottomwear: 'surface',
        topwear: 'surface',
        badge: 'unit',
      },
      unitDepths: {
        badge: 10,
      },
    };
    return base;
  };

  const fb25 = makeBody25DFixture();
  const builtBody25 = buildRig(parseConfig(fb25.rawCfg), fb25.pf, fb25.imgs);
  const tb25Dir = join(dir, 'turn_body25d');
  mkdirSync(join(tb25Dir, 'images'), { recursive: true });
  for (const [name, img] of builtBody25.images) writePng(join(tb25Dir, 'images', name), img);
  for (const [name, text] of rigOutputTexts(builtBody25, null)) writeFileSync(join(tb25Dir, name), text);
  const runBody25 = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve('@rig-c/core/cli')), 'build', '--rig', join(tb25Dir, 'rig.json'), '--motion', join(tb25Dir, 'motion.json'), '--out', join(tb25Dir, 'built'), '--profile', 'rig-play'], { encoding: 'utf8' });
  const compiledBody25 = compile({ rigPath: join(tb25Dir, 'rig.json'), motionPath: join(tb25Dir, 'motion.json'), outDir: join(tb25Dir, 'sdk') });
  const topDepthRep = compiledBody25.meshes.find((m) => m.slot === 'topwear')?.depth;
  const botDepthRep = compiledBody25.meshes.find((m) => m.slot === 'bottomwear')?.depth;
  const bodyParents = new Map(builtBody25.rig.bones.map((b) => [b.name, b.parent]));
  const bodySlots = new Map(builtBody25.rig.slots.map((s) => [s.name, s.bone]));
  type AnimTrack = {
    bone?: string;
    group?: string;
    property: string;
    keys: Array<{ t: number; v?: number[]; derive?: { kind: string; degrees: number; depth?: number | Record<string, number> } }>;
  };
  type AnimDeform = {
    slot: string;
    attachment: string;
    keys: Array<{ t: number; transform?: { kind: string; degrees: number; depth?: boolean; narrowing?: boolean } }>;
  };
  type AnimShape = {
    tracks?: AnimTrack[];
    deform?: AnimDeform[];
  };
  const headTurnAnim = builtBody25.motion.animations.turn as AnimShape | undefined;
  const bodyTurnAnim = builtBody25.motion.animations.body_turn as AnimShape | undefined;
  const headDeformSlots = (headTurnAnim?.deform ?? []).map((d) => d.slot);
  const bodyDeformSlots = (bodyTurnAnim?.deform ?? []).map((d) => d.slot);
  const headTrackBones = (headTurnAnim?.tracks ?? []).map((t) => t.bone ?? t.group ?? '');
  const bodyTrackBones = (bodyTurnAnim?.tracks ?? []).map((t) => t.bone ?? t.group ?? '');
  // Read compiled Spine skeleton.json emitted by Core to verify actual projected deform vertices and carrier translations at +30 deg (key index 4, t=2).
  const compiledSkel = JSON.parse(readFileSync(join(tb25Dir, 'built/skeleton.json'), 'utf8')) as {
    animations: Record<string, {
      bones?: Record<string, { translatex?: Array<{ time?: number; value?: number }> }>;
      attachments?: { default?: Record<string, Record<string, { deform?: Array<{ time?: number; vertices?: number[] }> }>> };
    }>;
  };
  const facePosDeform = compiledSkel.animations.turn?.attachments?.default?.face?.face?.deform?.[4]?.vertices ?? [];
  const topPosDeform = compiledSkel.animations.body_turn?.attachments?.default?.topwear?.topwear?.deform?.[4]?.vertices ?? [];
  const faceCentreDxPos =
    (compiledSkel.animations.turn?.bones?.faceshift?.translatex?.[4]?.value ?? 0) +
    (compiledSkel.animations.turn?.bones?.face_surface?.translatex?.[4]?.value ?? 0) +
    (facePosDeform[12 * 2] ?? 0);
  const topCentreDxPos =
    (compiledSkel.animations.body_turn?.bones?.bodyshift?.translatex?.[4]?.value ?? 0) +
    (compiledSkel.animations.body_turn?.bones?.topwear_surface?.translatex?.[4]?.value ?? 0) +
    (topPosDeform[12 * 2] ?? 0);
  const bodyRearDxPos = compiledSkel.animations.body_turn?.bones?.body_rear_shift?.translatex?.[4]?.value ?? 0;
  const sliderNames = (builtBody25.rig.constraints ?? []).filter((c) => c.type === 'slider').map((c) => c.name);
  const fbPreChest = makeBody25DFixture();
  fbPreChest.rawCfg.bones = [
    { name: 'hip', parent: 'root', at: [32, 56] },
    { name: 'badge_b', parent: 'hip', at: [28, 42] },
    { name: 'chest', parent: 'hip', at: [32, 44] },
    { name: 'head', parent: 'chest', at: [32, 36] },
    { name: 'eye_r', parent: 'head', at: [26, 26] },
    { name: 'eye_l', parent: 'head', at: [38, 26] },
    { name: 'mouth', parent: 'head', at: [32, 35] },
    { name: 'ear_r', parent: 'head', at: [18, 27] },
    { name: 'ear_l', parent: 'head', at: [46, 27] },
    { chain: 'bang_c', parent: 'head', points: [[32, 16], [32, 22]], tip: [32, 27] },
    { chain: 'hb_c', parent: 'head', points: [[32, 24], [32, 36]], tip: [32, 46] },
  ];
  const builtPreChest = buildRig(parseConfig(fbPreChest.rawCfg), fbPreChest.pf, fbPreChest.imgs);
  const badgePreIdx = builtPreChest.rig.bones.findIndex((b) => b.name === 'badge_b');
  const shiftPreIdx = builtPreChest.rig.bones.findIndex((b) => b.name === 'bodyshift');
  const tbPreDir = join(dir, 'turn_body25d_prechest');
  mkdirSync(join(tbPreDir, 'images'), { recursive: true });
  for (const [name, img] of builtPreChest.images) writePng(join(tbPreDir, 'images', name), img);
  for (const [name, text] of rigOutputTexts(builtPreChest, null)) writeFileSync(join(tbPreDir, name), text);
  const runPreChest = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve('@rig-c/core/cli')), 'build', '--rig', join(tbPreDir, 'rig.json'), '--motion', join(tbPreDir, 'motion.json'), '--out', join(tbPreDir, 'built'), '--profile', 'rig-play'], { encoding: 'utf8' });
  say(
    'DZ53_BODY_TURN_25D_PROJECTS_TORSO_GRIDS_INDEPENDENT_OF_HEAD_AND_GATES_CORE',
    runBody25.status === 0 &&
      runPreChest.status === 0 &&
      shiftPreIdx !== -1 &&
      badgePreIdx > shiftPreIdx &&
      builtPreChest.rig.bones[badgePreIdx]?.parent === 'bodyshift' &&
      bodyParents.get('bodyshift') === 'chest' &&
      bodyParents.get('body_rear_shift') === 'chest' &&
      bodyParents.get('topwear_surface') === 'bodyshift' &&
      bodyParents.get('bottomwear_surface') === 'bodyshift' &&
      bodyParents.get('badge_b') === 'bodyshift' &&
      (bodyParents.get('head') === 'chest' || (bodyParents.get('head') === 'head_ctl' && bodyParents.get('head_ctl') === 'chest')) &&
      bodySlots.get('cape') === 'body_rear_shift' &&
      JSON.stringify(headDeformSlots) === JSON.stringify(['face']) &&
      JSON.stringify([...bodyDeformSlots].sort()) === JSON.stringify(['bottomwear', 'topwear']) &&
      !headTrackBones.some((b) => b === 'bodyshift' || b === 'body_rear_shift' || b === 'badge_b') &&
      !bodyTrackBones.some((b) => b === 'faceshift' || b === 'rear_shift' || b === 'eye_r' || b === 'ear_r') &&
      facePosDeform.length > 0 &&
      topPosDeform.length > 0 &&
      faceCentreDxPos < 0 &&
      topCentreDxPos < 0 &&
      bodyRearDxPos > 0 &&
      sliderNames.includes('body_yaw_dial') &&
      topDepthRep?.ceiling !== undefined &&
      botDepthRep?.ceiling !== undefined,
    `Core exit=${runBody25.status} (preChest=${runPreChest.status}, bodyshift@${shiftPreIdx}<badge_b@${badgePreIdx}); headDeform=${headDeformSlots.join(',')}; bodyDeform=${bodyDeformSlots.join(',')}; faceCentreDxPos=${faceCentreDxPos.toFixed(4)}; topCentreDxPos=${topCentreDxPos.toFixed(4)}; bodyRearDxPos=${bodyRearDxPos.toFixed(4)}; sliders=${sliderNames.join(',')}; topCeiling=${JSON.stringify(topDepthRep?.ceiling)}; botCeiling=${JSON.stringify(botDepthRep?.ceiling)}`,
  );

  const badBodyNoDepth = makeBody25DFixture();
  delete (badBodyNoDepth.pf.parts.find((p) => p.name === 'topwear') as { depth?: unknown }).depth;
  const badBodyPartMissing = makeBody25DFixture();
  badBodyPartMissing.pf.parts = badBodyPartMissing.pf.parts.filter((p) => p.name !== 'badge');
  const badBodyPartUnattached = makeBody25DFixture();
  ((badBodyPartUnattached.rawCfg.turn as { body: { roles: Record<string, unknown> } }).body.roles).unattached_part = 'unit';
  const badBodyRigUnattached = makeBody25DFixture();
  const parsedRigUnattached = parseConfig(badBodyRigUnattached.rawCfg);
  (parsedRigUnattached.turn?.body?.roles as Record<string, string>).unattached_part = 'unit';
  badBodyRigUnattached.pf.parts.push({ ...badBodyRigUnattached.pf.parts[0], name: 'unattached_part', from: 'full:objects' });
  const badBodySliderCollision = makeBody25DFixture();
  ((badBodySliderCollision.rawCfg.turn as { body: Record<string, unknown> }).body).slider = 'yaw';
  const badBodySliderConstraintCollision = makeBody25DFixture();
  badBodySliderConstraintCollision.rawCfg.constraints = [
    { type: 'slider', name: 'custom_body_yaw', animation: 'idle', bone: 'hip', property: 'x' },
  ];
  ((badBodySliderConstraintCollision.rawCfg.turn as { body: Record<string, unknown> }).body).slider = 'custom_body_yaw';
  const badBodySurfaceMesh = makeBody25DFixture();
  delete (badBodySurfaceMesh.rawCfg.regions as Record<string, unknown>).topwear;
  (badBodySurfaceMesh.rawCfg.meshes as Record<string, unknown>).topwear = { grid: 8, r: 20, segments: [['chest', [32, 44], [32, 36]]] };
  const badBodyUnitMeshBones = makeBody25DFixture();
  delete (badBodyUnitMeshBones.rawCfg.regions as Record<string, unknown>).badge;
  (badBodyUnitMeshBones.rawCfg.meshes as Record<string, unknown>).badge = { grid: 4, r: 10, segments: [['head', [32, 36], [28, 42]]] };

  const cbNoDepth = errors(() => buildRig(parseConfig(badBodyNoDepth.rawCfg), badBodyNoDepth.pf, badBodyNoDepth.imgs));
  const cbPartMissing = errors(() => buildRig(parseConfig(badBodyPartMissing.rawCfg), badBodyPartMissing.pf, badBodyPartMissing.imgs));
  const cbUnattached = errors(() => parseConfig(badBodyPartUnattached.rawCfg));
  const cbRigUnattached = errors(() => buildRig(parsedRigUnattached, badBodyRigUnattached.pf, badBodyRigUnattached.imgs));
  const cbSliderHead = errors(() => parseConfig(badBodySliderCollision.rawCfg));
  const cbSliderCst = errors(() => parseConfig(badBodySliderConstraintCollision.rawCfg));
  const cbSurfMesh = errors(() => parseConfig(badBodySurfaceMesh.rawCfg));
  const cbUnitMeshBones = errors(() => parseConfig(badBodyUnitMeshBones.rawCfg));
  say(
    'DZ54_BODY_TURN_25D_REFUSALS_NAMED',
    cbNoDepth.includes('RIG_TURN_SURFACE_DEPTH_REQUIRED') &&
      cbPartMissing.includes('RIG_PART_PRESENT') &&
      cbUnattached.includes('CONFIG_NAME_RESOLVES') &&
      cbRigUnattached.includes('RIG_NAME_RESOLVES') &&
      cbSliderHead.includes('CONFIG_TURN_SLIDER_NAME_FREE') &&
      cbSliderCst.includes('CONFIG_TURN_SLIDER_NAME_FREE') &&
      cbSurfMesh.length === 0 &&
      cbUnitMeshBones.includes('CONFIG_TURN_UNIT_MESH_BONES'),
    `noDepth=${cbNoDepth.join(',')}; partMissing=${cbPartMissing.join(',')}; unattached=${cbUnattached.join(',')}; rigUnattached=${cbRigUnattached.join(',')}; sliderHead=${cbSliderHead.join(',')}; sliderCst=${cbSliderCst.join(',')}; surfMesh=${cbSurfMesh.join(',')}; unitMeshBones=${cbUnitMeshBones.join(',')}`,
  );
}


/** Independent row-ramp and actual lash fixture; art/geometry stay unchanged. */
export function runDepthSheetStillChecks(say: Say): void {
  const plain = buildRig(parseConfig(lashConfig()), lashParts(), lashImages());
  const parts = lashParts(), images = lashImages(), lash = parts.parts.find(p => p.name === 'lash');
  if (lash === undefined) throw new Error('hand-authored lash part is required');
  const scalar = grey(16, 9, (x, y) => x + 10 * y);
  lash.depth = { image: 'lash_depth.png', near: 'black', zScale: 12, sources: [{ from: 'head:eyelash-r', image: 'source_depth.png', sha256: createHash('sha256').update(encodePngBytes(scalar)).digest('hex'), crop: [14, 17, 30, 26], reading: depthReading(scalar, images.get('lash') as Raster, null) }] };
  const provenance = JSON.stringify(lash.depth.sources);
  images.set(lash.depth.image, scalar);
  const split = buildRig(parseConfig(lashConfig()), parts, images), actual = new Map(split.images);
  const artNames = ['face.png', 'eyewhite.png', 'lash.png', 'lash_still.png'];
  const expected = [...artNames, 'lash_depth.png', 'lash_still_depth.png'];
  say('DZ40_STILL_ASSETS_HAVE_SEPARATE_IDENTITIES', actual.size === 6 && split.images.length === 6 && expected.every(n => actual.has(n)) && JSON.stringify(plain.images.map(([n]) => n)) === JSON.stringify(artNames), `plain${plain.images.map(([n]) => n)}; depth${split.images.map(([n]) => n)}`);
  const lower = actual.get('lash_depth.png'), upper = actual.get('lash_still_depth.png');
  const correct = (p: Raster | undefined, height: number, offset: number): boolean => p !== undefined && p.width === 24 && p.height === height + 8 && [...p.data].every((v, i) => { const pixel = Math.floor(i / 4), channel = i % 4; return v === (channel === 3 ? 255 : Math.max(0, Math.min(15, pixel % 24 - 4)) + 10 * (offset + Math.max(0, Math.min(height - 1, Math.floor(pixel / 24) - 4)))); });
  say('DZ41_STILL_SCALAR_ROWS_MATCH_ACTUAL_ART_CUT', correct(lower, 6, 3) && correct(upper, 3, 0) && actual.get('lash.png')?.height === 14 && actual.get('lash_still.png')?.height === 11, 'source row3 at rig20: lower rows3..8 on24x14; still rows0..2 on24x11, all padded scalar texels checked');
  const refs = split.depthReferences ?? [];
  say('DZ42_STILL_REFERENCES_NAME_EXACT_DRAWING_GRIDS', refs.length === 2 && refs.some(r => r.part === 'lash' && r.depth.image === 'lash_depth.png' && r.size.join(',') === '24,14') && refs.some(r => r.part === 'lash_still' && r.depth.image === 'lash_still_depth.png' && r.size.join(',') === '24,11') && refs.every(r => JSON.stringify(r.depth.sources) === provenance), JSON.stringify(refs));
  const unchanged = JSON.stringify(split.rig) === JSON.stringify(plain.rig) && JSON.stringify(split.motion) === JSON.stringify(plain.motion) && JSON.stringify(split.meshReport) === JSON.stringify(plain.meshReport) && plain.images.every(([name, p]) => Buffer.from(p.data).equals(Buffer.from(actual.get(name)?.data ?? [])));
  say('DZ43_DEPTH_PRESERVES_ALL_STILL_ART_AND_RIG_BYTES', unchanged && plain.depthReferences === undefined, 'with/without sheet: exact rig/motion/mesh-report and every art RGBA; no-depth has only original4 assets and no companion');
  const text = rigOutputTexts(split, null).find(([name]) => name === 'depth_sheets.json')?.[1];
  say('DZ44_STILL_COMPANION_SERIALIZES_ACTUAL_REFERENCES', text !== undefined && JSON.stringify((JSON.parse(text) as { parts: unknown }).parts) === JSON.stringify(refs), 'actual rig output serializer carries both drawing-sized references; sources remain original');

  // Two base regions and a later alternate deliberately share a possible
  // filename spelling. Distinct input keys supply distinct art/scalar bytes.
  const namespaceParts = rigParts(), namespaceImages = rigImages();
  const eye = namespaceParts.parts.find(p => p.name === 'eye');
  if (eye === undefined) throw new Error('hand-authored eye region is required');
  const measuredPart = { ...eye, name: 'warm_lash', from: 'head:eyelash-r' };
  const alternateBase = { ...eye, name: 'lash_depth', from: 'head:eyewhite-r' };
  namespaceParts.parts.push(measuredPart, alternateBase);
  const art = namespaceImages.get('eye') as Raster;
  namespaceImages.set('warm_lash', art); namespaceImages.set('lash_depth', art);
  const namespaceConfig = rigConfig();
  namespaceConfig.assemble = { rig_scale: 0.5, plan: [['cloth', 'full', 'topwear'], ['eye', 'head', 'face'], ['warm_lash', 'head', 'eyelash-r'], ['lash_depth', 'head', 'eyewhite-r']] };
  namespaceConfig.regions = { eye: 'eye', warm_lash: 'eye', lash_depth: 'eye' };
  const config = parseConfig(namespaceConfig);
  const setAlternate = (name: string): void => {
    namespaceParts.alternates = [{ name, parts: ['lash_depth'], slots: { lash_depth: `${name}_lash_depth` }, records: [{ ...alternateBase }], ghost_px: {}, recomposite: { mean_abs: 0, within_limit: 0, within_share: 1, error_limit: 0, error_px: 0, covered_alpha: 8, uncovered_error_px: 0, hole_count: 0, holes_listed: 0, holes: [] } }];
    namespaceImages.set(`${name}_lash_depth`, art);
  };
  setAlternate('warm');
  const noSheet = buildRig(config, namespaceParts, namespaceImages);
  say('DZ45_FUTURE_ART_NAME_VALID_WITHOUT_SHEET', noSheet.images.length === 5 && new Set(noSheet.images.map(([name]) => name)).size === 5 && noSheet.depthReferences === undefined, 'actual build: warm_lash.png plus later warm_lash_depth.png are distinct valid art assets');
  const namespaceScalar = grey(4, 2, (x, y) => 10 * x + 40 * y);
  measuredPart.depth = { image: 'warm_lash_depth.png', near: 'black', zScale: 12, sources: [{ from: measuredPart.from, image: 'source_depth.png', sha256: createHash('sha256').update(encodePngBytes(namespaceScalar)).digest('hex'), crop: [16, 26, 20, 28], reading: depthReading(namespaceScalar, art, null) }] };
  namespaceImages.set(measuredPart.depth.image, namespaceScalar);
  let collision: PartsError | undefined;
  try { buildRig(config, namespaceParts, namespaceImages); } catch (error) { if (!(error instanceof PartsError)) throw error; collision = error; }
  say('DZ46_FUTURE_ALTERNATE_ART_COLLISION_RED', collision?.problems.some(p => p.code === 'DEPTH_SHEET_UNAMBIGUOUS' && p.object === 'warm_lash_depth.png' && p.detail.includes('output assets[')) === true, JSON.stringify(collision?.problems));
  setAlternate('cool');
  const unique = buildRig(config, namespaceParts, namespaceImages), uniqueImages = new Map(unique.images);
  say('DZ47_NONCOLLIDING_ALTERNATE_AND_SHEET_RETAINED', unique.images.length === 6 && uniqueImages.size === 6 && uniqueImages.has('cool_lash_depth.png') && Buffer.from(uniqueImages.get('warm_lash_depth.png')?.data ?? []).equals(Buffer.from(padDepthSheet(namespaceScalar, 4).data)) && uniqueImages.get('cool_lash_depth.png')?.data[(4 * 12 + 4) * 4 + 1] === 120, `actual final inventory: ${unique.images.map(([name]) => name).join(',')}; padded sheet and coloured alternate remain distinct`);
  delete measuredPart.depth;
  const plainUnique = buildRig(config, namespaceParts, namespaceImages);
  say('DZ48_NAMESPACE_CHECK_PRESERVES_NO_DEPTH_OUTPUT', JSON.stringify(unique.rig) === JSON.stringify(plainUnique.rig) && JSON.stringify(unique.motion) === JSON.stringify(plainUnique.motion) && JSON.stringify(unique.meshReport) === JSON.stringify(plainUnique.meshReport) && plainUnique.images.every(([name, image]) => Buffer.from(image.data).equals(Buffer.from(uniqueImages.get(name)?.data ?? []))) && plainUnique.depthReferences === undefined, 'exact rig/motion/report and all5 art RGBA match with/without the noncolliding sheet; no-depth adds no output');
  const silArt = newRaster(4, 3);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) {
    const a = x >= 1 && x <= 2 && y === 1 ? 255 : x === 0 && y === 1 ? 128 : 0;
    silArt.data.set([200, 100, 50, a], (y * 4 + x) * 4);
  }
  const silSource = grey(4, 3, (x, y) => (x === 1 && y === 1 ? 180 : x === 2 && y === 1 ? 220 : 10));
  const rawPadded = padDepthSheet(silSource, 2);
  const turnPadded = padTurnDepthSheet(silSource, silArt, 2);
  say(
    'DZ49_TURN_SILHOUETTE_EXTENSION_CONTINUOUS',
    rawPadded.data[0] === 10 &&
      turnPadded.width === 8 &&
      turnPadded.height === 7 &&
      turnPadded.data[0] === 180 &&
      turnPadded.data[(3 * 8 + 3) * 4] === 180 &&
      turnPadded.data[(3 * 8 + 4) * 4] === 220 &&
      turnPadded.data[(3 * 8 + 7) * 4] === 220,
    'raw padDepthSheet keeps background 10 at (0,0); padTurnDepthSheet extends nearest opaque (1,1)->180 left and (2,1)->220 right across fringe and PAD=2 border',
  );
  say(
    'DZ50_SILHOUETTE_SIZE_MISMATCH_REFUSED',
    errors(() => extendDepthSilhouette(silSource, newRaster(3, 3))).includes('DEPTH_SILHOUETTE_SIZE_MISMATCH'),
    'extendDepthSilhouette refuses mismatched source/art dimensions with DEPTH_SILHOUETTE_SIZE_MISMATCH',
  );
}

if (import.meta.main && process.argv[2] === '--adapter-probe') {
  const { startFakeComfy, fakePainting } = await import('../fixtures/fakecomfy.ts');
  const { ComfyClient } = await import('../src/comfy/client.ts');
  const { runSeeThrough } = await import('../src/comfy/seethrough.ts');
  const dir = process.argv[3]; mkdirSync(dir, { recursive: true });
  const file = join(dir, 'input.png'); writePng(file, fakePainting(4, 4));
  const results: Array<{ mode: string; active?: boolean; ok: boolean; sheets?: number; fetched?: number; codes?: string[]; exit?: number; raw?: { stdout: string; stderr: string } }> = [];
  for (const active of [false, true]) for (const mode of ['ok', 'missing-depth'] as const) {
    const fake = startFakeComfy(mode);
    try {
      const out = join(dir, `${mode}-${active}`), binding = { config: { zScale: 12 }, run: 'full' as const, base: dir };
      try {
        await runSeeThrough(new ComfyClient(fake.url, { request: 5, poll: 0.01 }), { image: file, out, prefix: 'depth_fixture', resolution: 512, steps: 1, seed: 0, offload: false, lama: false, quant: 'none', wait: 1, timeout: 5, ...(active ? { depth: binding } : {}) }, () => {});
        const set = readWrapperLayers(out, active ? binding : undefined), sheets = set.layers.filter(l => l.depthSheet !== undefined).length;
        const fetched = fake.views.filter(f => f.endsWith('_depth.png')).length;
        const saved = readdirSync(join(out, 'parts')).filter(f => f.endsWith('_depth.png')).length;
        results.push({ mode, active, ok: active ? mode === 'ok' && sheets === 5 && fetched === 5 && saved === 5 : sheets === 0 && fetched === 0 && saved === 0, sheets, fetched });
      } catch (error) {
        if (!(error instanceof PartsError)) throw error;
        results.push({ mode, active, ok: active && mode === 'missing-depth' && fake.views.some(f => f.endsWith('_depth.png')) && error.problems.some(p => p.code === 'COMFY_VIEW_PRESENT' && p.object.includes('_depth.png')), codes: error.problems.map(p => p.code) });
      }
    } finally { fake.stop(); }
  }
  const configFile = join(dir, 'config.json'), config = { ...rigConfig(), seethrough: { resolution: 512, steps: 1, seed: 0, offload: false }, depth: { zScale: 12 } };
  writeFileSync(configFile, JSON.stringify(config));
  const { depth: _depth, ...noDepthConfig } = config, noDepthFile = join(dir, 'no-depth-config.json'); writeFileSync(noDepthFile, JSON.stringify(noDepthConfig));
  for (const test of [{ name: 'active-cli', mode: 'ok', args: ['--config', configFile, '--depth-run', 'full'], exit: 0, fetched: 5 }, { name: 'missing-cli', mode: 'missing-depth', args: ['--config', configFile, '--depth-run', 'full'], exit: 1, fetched: 1 }, { name: 'inactive-cli', mode: 'missing-depth', args: [], exit: 0, fetched: 0 }, { name: 'inactive-config-cli', mode: 'missing-depth', args: ['--config', noDepthFile], exit: 0, fetched: 0 }, { name: 'no-run-cli', mode: 'ok', args: ['--config', configFile], exit: 2, fetched: 0 }, { name: 'run-without-block-cli', mode: 'ok', args: ['--config', noDepthFile, '--depth-run', 'full'], exit: 2, fetched: 0 }] as const) {
    const fake = startFakeComfy(test.mode);
    try {
      const proc = Bun.spawn([process.execPath, resolve('cli.ts'), 'comfy', 'seethrough', '--image', file, '--out', join(dir, test.name), '--host', fake.url, '--steps', '1', '--resolution', '512', '--wait', '1', '--timeout', '5', '--poll', '0.01', ...test.args], { stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      writeFileSync(join(dir, `${test.name}.log`), stdout + stderr);
      const fetched = fake.views.filter(f => f.endsWith('_depth.png')).length;
      results.push({ mode: test.name, exit, fetched, ok: exit === test.exit && fetched === test.fetched && (test.exit !== 1 || (stdout + stderr).includes('COMFY_VIEW_PRESENT')) && (test.exit !== 2 || fake.requests.length === 0), ...(test.exit === 1 ? { raw: { stdout, stderr } } : {}) });
    } finally { fake.stop(); }
  }
  console.log(JSON.stringify(results)); process.exit(results.every(r => r.ok) ? 0 : 1);
}
