import { partsStringFieldFaults } from './parts_file_field_inventory.ts';
/** Observe the production readers on generated manifests, including a reader-only plant. */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { assembleConfig, EXPECTED_PARTS, writeAssembleFixture } from '../fixtures/assemble_fixture.ts';
import { FIGURE_MASK_FILE, partsFileReferences, readParts, type PartsFile } from '../src/parts.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { PartsError } from '../src/errors.ts';
import { newRaster } from '../src/raster/types.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
interface Observation { reads: string[]; uncovered: string[] }
const observer = `
import { mock } from 'bun:test';
import * as fs from 'node:fs';
import { join, resolve, sep } from 'node:path';
const [source, fixture, rigDir, stageFixture, scratch, rootsJson, expected] = process.argv.slice(2);
const roots = JSON.parse(rootsJson).map(r => resolve(r));
const reads = new Set();
const read = fs.readFileSync;
mock.module('node:fs', () => ({ ...fs, readFileSync(path, ...options) {
  if (typeof path === 'string' && path.endsWith('.png') && !(new Error().stack ?? '').includes('at collect (')) {
    const full = resolve(path);
    if (roots.some(root => full === root || full.startsWith(root + sep))) reads.add(full);
  }
  return Reflect.apply(read, fs, [path, ...options]);
} }));
const { readPartSet } = await import(source + '/src/propose.ts');
const { tilesFrom } = await import(source + '/src/sheet.ts');
const { readRigInputs } = await import(source + '/src/build.ts');
const { boundaryColourSizeProblems, flatComposite, flatCompositeForSet, readCheckInputs } = await import(source + '/src/check.ts');
const { diffComponentsCommand } = await import(source + '/src/diffcomponents.ts');
const { meshDraftStage } = await import(source + '/src/meshdraft.ts');
const { applyDepth, prepareDepth } = await import(source + '/src/depthworkflow.ts');
const { readMaterialSources, writeMaterialSources } = await import(source + '/src/cutmaterialio.ts');
const { readParts } = await import(source + '/src/parts.ts');
readPartSet(fixture);
tilesFrom(fixture + '/parts.json');
readRigInputs(fixture + '/config.json', fixture);
const checked = readCheckInputs(rigDir, fixture);
flatComposite(checked.parts, checked.partsDir, [0, 0, 0, 255]);
flatCompositeForSet(checked.parts, checked.parts.alternates[0], checked.partsDir, [0, 0, 0, 255]);
boundaryColourSizeProblems(checked);
diffComponentsCommand(['--stack', fixture + '/painting_in_rig.png', '--painting', fixture + '/painting_in_rig.png', '--parts', fixture + '/parts.json', '--figure', fixture + '/figure_rig.png', '--floor', '1', '--out', join(scratch, 'diff.json')]);
try { meshDraftStage({ config: stageFixture + '/config.json', parts: stageFixture, out: join(scratch, 'draft') }, () => ({ status: 1, out: 'FAIL' }), 'rigc', join(scratch, 'draft-scratch'), () => {}); } catch {}
fs.rmSync(join(scratch, 'depth-prep'), { recursive: true, force: true });
fs.rmSync(join(scratch, 'depth-out'), { recursive: true, force: true });
prepareDepth({ parts: stageFixture, config: join(scratch, 'depth-recipe.json'), out: join(scratch, 'depth-prep') });
applyDepth({ parts: stageFixture, manifest: join(scratch, 'depth-prep', 'manifest.json'), config: join(scratch, 'depth-recipe.json'), rigConfig: stageFixture + '/config.json', out: join(scratch, 'depth-out') });
const parts = readParts(fixture + '/parts.json');
writeMaterialSources(fixture + '/parts.json', fixture + '/parts', parts, []);
readMaterialSources(fixture, parts);
fs.rmSync(fixture + '/cut_material_sources.json', { force: true });
const enumerated = new Set(JSON.parse(expected));
console.log(JSON.stringify({ reads: [...reads].sort(), uncovered: [...reads].filter(path => !enumerated.has(path)).sort() }));
`;

export function runPartsFileReferenceChecks(dir: string, base: PartsFile, config: Record<string, unknown>, say: Say): void {
  const root = resolve(import.meta.dir, '..');
  const fixture = join(dir, 'fixture');
  const rigDir = join(dir, 'rig');
  const stageFixture = join(dir, 'stage-fixture');
  const scratch = join(dir, 'scratch');
  mkdirSync(join(fixture, 'parts'), { recursive: true });
  mkdirSync(join(rigDir, 'images'), { recursive: true });
  mkdirSync(join(stageFixture, 'parts'), { recursive: true });
  mkdirSync(scratch, { recursive: true });
  const image = newRaster(12, 10);
  for (let i = 0; i < image.data.length; i += 4) image.data.set([128, 128, 128, 255], i);
  const bytes = encodePngBytes(image);
  const rigImage = newRaster(16, 14);
  for (let i = 0; i < rigImage.data.length; i += 4) rigImage.data.set([128, 128, 128, 255], i);
  const rigBytes = encodePngBytes(rigImage);
  const figure = newRaster(32, 24);
  for (let i = 0; i < figure.data.length; i += 4) figure.data.set([255, 255, 255, 255], i);
  const figureBytes = encodePngBytes(figure);
  const painting = newRaster(32, 24);
  for (let i = 3; i < painting.data.length; i += 4) painting.data[i] = 255;
  const paintingBytes = encodePngBytes(painting);
  const tallPainting = newRaster(32, 120);
  for (let i = 3; i < tallPainting.data.length; i += 4) tallPainting.data[i] = 255;
  const tallPaintingBytes = encodePngBytes(tallPainting);
  const depth = (image: string) => ({ image, near: 'black' as const, zScale: 1, sources: [{
    from: 'full:face', image: 'source.png', sha256: '0'.repeat(64), crop: [0, 0, 12, 10] as [number, number, number, number],
    reading: { orderingMedian: null, sheetMedian: null, relation: 'indeterminate' as const },
  }] });
  const file: PartsFile = { ...base,
    parts: [{ ...base.parts[0], depth: depth('face-depth.png') }],
    painting_in_rig: { path: 'painting_in_rig.png', sha256: createHash('sha256').update(paintingBytes).digest('hex'), resample: 'lanczos3-rgb-opaque' },
    alternates: [{ name: 'side', slots: { face: 'side_face' }, records: [{ ...base.parts[0], depth: depth('side-depth.png') }], ghost_px: {},
      recomposite: { mean_abs: 0, within_limit: 768, within_share: 1, error_limit: 0, error_px: 0, covered_alpha: 120, uncovered_error_px: 0, hole_count: 0, holes_listed: 0, holes: [] } }],
  };
  for (const record of [...file.parts, ...file.alternates![0].records]) record.taken_layers = [{ run: 'full', tag: 'face', run_dir: 'historical-run', st_input: 'historical-input.png', prompt_id: 'receipt', seed: 0, support_px: 1, checked_px: 1, differing_px: 0 }];
  file.scene = { figure_alpha_above: 8, figure_px: 120, figure_mask: 'figure_rig.png' };
  file.recomposite = { ...file.alternates![0].recomposite, within_limit: 0 };
  file.alternates![0].scene = { ...file.scene };
  const path = join(fixture, 'parts.json');
  writeFileSync(path, JSON.stringify(file));
  writeFileSync(join(fixture, 'config.json'), JSON.stringify(config));
  const stageFile: PartsFile = {
    ...base,
    rig_size: [32, 120],
    painting_in_rig: { path: 'painting_in_rig.png', sha256: createHash('sha256').update(tallPaintingBytes).digest('hex'), resample: 'lanczos3-rgb-opaque' },
    parts: [
      { ...base.parts[0], opaque_px: 120, depth: depth('face-depth.png') },
      { ...base.parts[0], name: 'robe', from: 'full:topwear', y: 94, opaque_px: 120, depth: depth('robe-depth.png') },
    ],
  };
  writeFileSync(join(stageFixture, 'parts.json'), JSON.stringify(stageFile));
  writeFileSync(join(stageFixture, 'config.json'), JSON.stringify({ ...config, turn: { pivot: 0.5, roles: { face: 'surface' } } }));
  writeFileSync(join(stageFixture, 'painting_in_rig.png'), tallPaintingBytes);
  for (const name of ['face.png', 'face-depth.png', 'robe.png', 'robe-depth.png', 'stale.png']) writeFileSync(join(stageFixture, 'parts', name), bytes);
  writeFileSync(join(rigDir, 'rig.json'), JSON.stringify({
    skeleton: { x: -16, y: -12, width: 32, height: 24 },
    bones: [{ name: 'root' }],
    slots: [{ name: 'face', bone: 'root', attachment: 'face' }],
    skins: { default: { face: { face: { x: 0, y: 0, width: 12, height: 10, image: 'face.png' } } } },
  }));
  writeFileSync(join(rigDir, 'motion.json'), JSON.stringify({ animations: { idle: { duration: 1, tracks: [{ bone: 'root', property: 'rotate', keys: [{ t: 0, v: [0] }, { t: 1, v: [0] }] }] } } }));
  writeFileSync(join(scratch, 'face-map.json'), JSON.stringify({ spec: 'rig-parts-map/1', width: 12, height: 10, channels: 1, data: Array.from({ length: 120 }, (_, i) => (i % 12) / 12) }));
  writeFileSync(join(scratch, 'depth-recipe.json'), JSON.stringify({
    spec: 'rig-parts-depth/1',
    prepare: { longSide: 12, paddingFraction: 0, padding: 0 },
    groups: { head: { near: 'black', zScale: 1, pivot: 0.5 } },
    parts: { face: { map: 'face-map.json', source: 'depth', frame: 'part', group: 'head', median: 0.5, relief: 0.2 } },
    clear: [],
  }));
  writeFileSync(join(fixture, 'painting_in_rig.png'), paintingBytes);
  writeFileSync(join(fixture, 'figure_rig.png'), figureBytes);
  for (const name of ['face.png', 'face-depth.png', 'side_face.png', 'side-depth.png', 'stale.png']) writeFileSync(join(fixture, 'parts', name), bytes);
  writeFileSync(join(rigDir, 'images', 'face.png'), rigBytes);
  readParts(path);
  const expected = [
    { path: 'figure_rig.png', role: 'figure_mask' },
    { path: 'painting_in_rig.png', role: 'painting' },
    { path: 'parts/face-depth.png', role: 'depth' },
    { path: 'parts/face.png', role: 'part' },
    { path: 'parts/side-depth.png', role: 'depth' },
    { path: 'parts/side_face.png', role: 'alternate' },
  ];
  const references = partsFileReferences(fixture);
  say('PT1163_DECLARED_MEMBERSHIP_AND_ROLES', JSON.stringify(references) === JSON.stringify(expected), JSON.stringify(references));
  const isolated = join(dir, 'isolated');
  mkdirSync(isolated);
  cpSync(join(root, 'src'), join(isolated, 'src'), { recursive: true });
  cpSync(join(root, 'package.json'), join(isolated, 'package.json'));
  symlinkSync(join(root, 'node_modules'), join(isolated, 'node_modules'), 'dir');
  const partsSource = join(isolated, 'src/parts.ts');
  const partsOriginal = readFileSync(partsSource, 'utf8');
  const partsMd5 = createHash('md5').update(readFileSync(partsSource)).digest('hex');
  say('PT1163_FILE_FIELD_CENSUS_IS_COMPLETE', partsStringFieldFaults(root).length === 0, 'all PartsFile string leaves are classified, including historical source fields');
  const censusPlant = partsOriginal.replace('export interface PartsFile {', 'export interface PartsFile {\n  completeness_png?: string;');
  try {
    writeFileSync(partsSource, censusPlant);
    const red = partsStringFieldFaults(isolated);
    say('PT1163_NEW_PNG_FIELD_BREAKS_COMPLETENESS', censusPlant !== partsOriginal && red.includes('unclassified string/file field completeness_png'), JSON.stringify({ plant: 'completeness_png?: string;', faults: red }));
  } finally { writeFileSync(partsSource, partsOriginal); }
  const censusRestoredMd5 = createHash('md5').update(readFileSync(partsSource)).digest('hex');
  say('PT1163_COMPLETENESS_PLANT_REMOVED', censusRestoredMd5 === partsMd5 && partsStringFieldFaults(isolated).length === 0, `plant removed, tree restored, src/parts.ts md5 ${censusRestoredMd5}; pre-plant md5 ${partsMd5}`);

  const refusalScript = join(dir, 'refusal.ts');
  writeFileSync(refusalScript, `
const [source, fixture, code, suffix, requiredDetail] = process.argv.slice(2);
const { partsFileReferences, readParts } = await import(source + '/src/parts.ts');
const outcomes = [() => partsFileReferences(fixture), () => readParts(fixture + '/parts.json')].map(read => {
  try { read(); return { matched: false, problems: [] }; }
  catch (error) {
    const problems = error.problems ?? [];
    const tokens = requiredDetail ? requiredDetail.split(',') : [];
    return { matched: problems.some(p => p.code === code && p.object.endsWith(suffix) && tokens.every(t => p.detail.includes(t))), problems, error: error.name };
  }
});
console.log(JSON.stringify(outcomes));
`);
  interface RefusalOutcome { matched: boolean; problems: Array<{ code: string; object: string; detail: string }> }
  const invalid = (name: string, edit: (raw: Record<string, unknown>) => void, code: string, suffix: string, rule: string, requiredDetail = ''): void => {
    const raw = structuredClone(file) as unknown as Record<string, unknown>;
    edit(raw);
    writeFileSync(path, JSON.stringify(raw));
    const observeRefusal = (source: string): RefusalOutcome[] => {
      const result = spawnSync(process.execPath, [refusalScript, source, fixture, code, suffix, requiredDetail], { encoding: 'utf8', timeout: 30000 });
      if (result.status !== 0) throw new Error(`refusal observer exit ${result.status}: ${result.stderr}`);
      return JSON.parse(result.stdout.trim()) as RefusalOutcome[];
    };
    try {
      const green = observeRefusal(root);
      say(name, green.every(outcome => outcome.matched), JSON.stringify(green));
      const mutant = partsOriginal.replace(rule, '');
      if (mutant === partsOriginal) throw new Error(`missing mutation target for ${name}`);
      writeFileSync(partsSource, mutant);
      const plantedMd5 = createHash('md5').update(readFileSync(partsSource)).digest('hex');
      const red = observeRefusal(isolated);
      say(`${name}_RULE_REMOVAL_IS_RED`, plantedMd5 !== partsMd5 && red.every(outcome => !outcome.matched), JSON.stringify({ removed: rule, beforeMd5: partsMd5, plantedMd5, outcomes: red }));
      writeFileSync(partsSource, partsOriginal);
      const restored = observeRefusal(isolated);
      const afterMd5 = createHash('md5').update(readFileSync(partsSource)).digest('hex');
      say(`${name}_RULE_RESTORED`, afterMd5 === partsMd5 && restored.every(outcome => outcome.matched), `plant removed, tree restored, src/parts.ts md5 ${afterMd5}; pre-plant md5 ${partsMd5}; named refusal restored ${restored.every(outcome => outcome.matched)}`);
    } finally {
      writeFileSync(partsSource, partsOriginal);
      writeFileSync(path, JSON.stringify(file));
    }
  };
  invalid('PT1169_CASE_COLLIDING_PART_NAMES_ARE_REFUSED', raw => {
    const first = (raw.parts as Array<Record<string, unknown>>)[0];
    raw.parts = [{ ...first, name: 'Face' }, { ...first, name: 'face' }];
  }, 'PARTS_NAME_UNIQUE', 'part "face"',
  ' else if (seen.has(r.name.toLowerCase())) fail(\'PARTS_NAME_UNIQUE\', label, `appears at parts[${seen.get(r.name.toLowerCase())!.index}] ("${seen.get(r.name.toLowerCase())!.name}") and parts[${i}] ("${r.name}")`);',
  '"Face","face"');
  const distinctParts = structuredClone(file);
  distinctParts.parts = [{ ...file.parts[0], name: 'Face' }, { ...file.parts[0], name: 'neck', from: 'full:topwear' }];
  writeFileSync(path, JSON.stringify(distinctParts));
  say('PT1169_DISTINCT_PART_NAMES_PASS', readParts(path).parts.map(p => p.name).join(',') === 'Face,neck' && partsFileReferences(fixture).some(r => r.path === 'parts/Face.png') && partsFileReferences(fixture).some(r => r.path === 'parts/neck.png'), 'Face + neck read and enumerate without collision');
  writeFileSync(path, JSON.stringify(file));
  invalid('PT1163_ALTERNATE_DEPTH_ESCAPE_IS_REFUSED', raw => {
    (raw.alternates as NonNullable<PartsFile['alternates']>)[0].records[0].depth!.image = '../../x.png';
  }, 'PARTS_DEPTH_REFERENCE', 'records[0] depth.image',
  "        if ('depth' in r) problems.push(...partDepthProblems(r.depth, `${recordAt} depth`));");
  invalid('PT1163_ALTERNATE_MISSING_RECORDS_IS_NAMED', raw => {
    delete (raw.alternates as Array<Record<string, unknown>>)[0].records;
  }, 'PARTS_FIELD_TYPE', 'field "records"',
  '      if (!Array.isArray(set.records)) fail(\'PARTS_FIELD_TYPE\', `${at} field "records"`, `is ${show(set.records)}; an array of alternate part records is required`);');
  const setNameRule = '      if (!isPartName(set.name)) fail(\'PARTS_FIELD_TYPE\', `${at} field "name"`, `is ${show(set.name)}; a file-name-safe set name is required`);';
  invalid('PT1163_ALTERNATE_MISSING_SET_NAME_IS_REFUSED', raw => {
    delete (raw.alternates as Array<Record<string, unknown>>)[0].name;
  }, 'PARTS_FIELD_TYPE', 'alternates[0] field "name"', setNameRule);
  invalid('PT1163_ALTERNATE_UNSAFE_SET_NAME_IS_REFUSED', raw => {
    (raw.alternates as Array<Record<string, unknown>>)[0].name = '../side';
  }, 'PARTS_FIELD_TYPE', 'alternates[0] (set "../side") field "name"', setNameRule);
  invalid('PT1163_ALTERNATE_UNSAFE_PART_NAME_IS_REFUSED', raw => {
    (raw.alternates as NonNullable<PartsFile['alternates']>)[0].records[0].name = '../face';
  }, 'PARTS_FIELD_TYPE', 'records[0] field "name"',
  '        if (!isPartName(r.name)) fail(\'PARTS_FIELD_TYPE\', `${recordAt} field "name"`, `is ${show(r.name)}; a file-name-safe part name is required`);');
  invalid('PT1163_ALTERNATE_NONOBJECT_IS_NAMED', raw => { raw.alternates = [null]; }, 'PARTS_FIELD_TYPE', 'alternates[0]',
  '        fail(\'PARTS_FIELD_TYPE\', `${path} alternates[${i}]`, `is ${show(a)}; an alternate set object is required`);');
  invalid('PT1163_ALTERNATE_NONOBJECT_RECORD_IS_NAMED', raw => {
    (raw.alternates as Array<Record<string, unknown>>)[0].records = [null];
  }, 'PARTS_FIELD_TYPE', 'records[0]',
  '          fail(\'PARTS_FIELD_TYPE\', `${at} records[${j}]`, `is ${show(p)}; a part object is required`);');
  const figureRule = '  if (value !== FIGURE_MASK_FILE) fail(\'PARTS_FIELD_TYPE\', object, `is ${show(value)}; exactly "${FIGURE_MASK_FILE}" is required`);';
  invalid('PT1163_BASE_FIGURE_MASK_ESCAPE_IS_REFUSED', raw => {
    (raw.scene as Record<string, unknown>).figure_mask = '../../../x.png';
  }, 'PARTS_FIELD_TYPE', 'scene field "figure_mask"', figureRule);
  invalid('PT1163_ALTERNATE_FIGURE_MASK_ESCAPE_IS_REFUSED', raw => {
    (raw.alternates as NonNullable<PartsFile['alternates']>)[0].scene!.figure_mask = '../../../x.png';
  }, 'PARTS_FIELD_TYPE', 'alternates[0] (set "side") scene field "figure_mask"', figureRule);
  const alternateOnly = structuredClone(file);
  delete alternateOnly.scene;
  writeFileSync(path, JSON.stringify(alternateOnly));
  say('PT1163_ALTERNATE_ONLY_FIGURE_MASK_IS_ENUMERATED', partsFileReferences(fixture).some(row => row.role === 'figure_mask' && row.path === 'figure_rig.png'), 'base scene omitted, alternate scene retained');
  const baseOnly = structuredClone(file);
  delete baseOnly.alternates![0].scene;
  writeFileSync(path, JSON.stringify(baseOnly));
  say('PT1163_BASE_ONLY_FIGURE_MASK_IS_ENUMERATED', partsFileReferences(fixture).some(row => row.role === 'figure_mask' && row.path === 'figure_rig.png'), 'alternate scene omitted, base scene retained');
  writeFileSync(path, JSON.stringify(file));
  const manifestErrors: string[] = [];
  for (const text of [null, '{']) {
    if (text === null) rmSync(path); else writeFileSync(path, text);
    try { partsFileReferences(fixture); manifestErrors.push('returned'); }
    catch (error) {
      if (!(error instanceof PartsError)) throw error;
      manifestErrors.push(error.problems.find(problem => problem.object === path)?.code ?? 'wrong object');
    } finally { writeFileSync(path, JSON.stringify(file)); }
  }
  say('PT1163_MISSING_AND_INVALID_MANIFEST_ARE_NAMED', JSON.stringify(manifestErrors) === JSON.stringify(['PARTS_FILE_PRESENT', 'PARTS_IS_JSON']), JSON.stringify(manifestErrors));
  const script = join(dir, 'observer.ts');
  writeFileSync(script, observer);
  const paths = references.map(reference => resolve(fixture, reference.path));
  const stagePaths = partsFileReferences(stageFixture).map(reference => resolve(stageFixture, reference.path));
  const allPaths = [...paths, ...stagePaths];
  const observe = (source: string, roots = [fixture], expectedPaths = paths): Observation => {
    const result = spawnSync(process.execPath, [script, source, fixture, rigDir, stageFixture, scratch, JSON.stringify(roots), JSON.stringify(expectedPaths)], { encoding: 'utf8', timeout: 30000 });
    if (result.status !== 0) throw new Error(`parts observer exit ${result.status}: ${result.stderr}`);
    return JSON.parse(result.stdout.trim()) as Observation;
  };
  const green = observe(root, [fixture, stageFixture], allPaths);
  say('PT1163_REAL_READER_PNGS_ARE_ENUMERATED', green.uncovered.length === 0 && allPaths.every(path => green.reads.includes(path)), JSON.stringify(green));
  for (const reference of references) rmSync(join(fixture, reference.path));
  say('PT1163_MISSING_PNGS_KEEP_DECLARED_MEMBERSHIP', JSON.stringify(partsFileReferences(fixture)) === JSON.stringify(expected), 'all declared PNGs removed; manifest membership unchanged');
  for (const reference of references) writeFileSync(join(fixture, reference.path), reference.role === 'painting' ? paintingBytes : reference.role === 'figure_mask' ? figureBytes : bytes);
  const source = join(isolated, 'src/propose.ts');
  const original = readFileSync(source, 'utf8');
  const beforeMd5 = createHash('md5').update(readFileSync(source)).digest('hex');
  const marker = "const file = readParts(join(dir, 'parts.json'));";
  const planted = original.replace(marker, `${marker}\n  readPng(join(dir, 'parts', 'stale.png'));`);
  try {
    writeFileSync(source, planted);
    say('PT1163_SOURCE_PLANT_CHANGES_FROZEN_MD5', createHash('md5').update(readFileSync(source)).digest('hex') !== beforeMd5, 'reader-only plant differs from pre-plant source hash');
    const red = observe(isolated);
    say('PT1163_READER_ONLY_PLANT_BREAKS_READ_SUBSET', planted !== original && red.uncovered.length === 1 && red.uncovered[0] === join(fixture, 'parts/stale.png'), JSON.stringify(red));
  } finally { writeFileSync(source, original); }
  const restored = observe(isolated);
  say('PT1163_RESTORED_READER_SUBSET_IS_GREEN', restored.uncovered.length === 0 && paths.every(path => restored.reads.includes(path)), JSON.stringify(restored));
  const afterMd5 = createHash('md5').update(readFileSync(source)).digest('hex');
  say('PT1163_PLANT_REMOVED_SOURCE_RESTORED', afterMd5 === beforeMd5, `plant removed, tree restored, src/propose.ts md5 ${afterMd5}; pre-plant md5 ${beforeMd5}`);

  const plantReader = (label: string, relPath: string, target: string, replacement: string, staleDir = fixture, note?: string): void => {
    const modSource = join(isolated, relPath);
    const modOriginal = readFileSync(modSource, 'utf8');
    const modBeforeMd5 = createHash('md5').update(readFileSync(modSource)).digest('hex');
    const modPlanted = modOriginal.replace(target, replacement);
    try {
      writeFileSync(modSource, modPlanted);
      const modPlantedMd5 = createHash('md5').update(readFileSync(modSource)).digest('hex');
      say(`PT1168_${label}_NAMING_PLANT_CHANGES_MD5`, modPlantedMd5 !== modBeforeMd5, `${relPath} pre-plant md5 ${modBeforeMd5}; planted md5 ${modPlantedMd5}`);
      const red = observe(isolated, [fixture, stageFixture], allPaths);
      say(`PT1168_${label}_NAMING_PLANT_IS_RED`, modPlanted !== modOriginal && red.uncovered.length === 1 && red.uncovered[0] === join(staleDir, 'parts/stale.png'), JSON.stringify({ file: relPath, plant: replacement, ...(note === undefined ? {} : { note }), red }));
    } finally { writeFileSync(modSource, modOriginal); }
    const modRestored = observe(isolated, [fixture, stageFixture], allPaths);
    const modAfterMd5 = createHash('md5').update(readFileSync(modSource)).digest('hex');
    say(`PT1168_${label}_NAMING_PLANT_RESTORED`, modAfterMd5 === modBeforeMd5 && modRestored.uncovered.length === 0 && allPaths.every(path => modRestored.reads.includes(path)), `plant removed, tree restored, ${relPath} md5 ${modAfterMd5}; pre-plant md5 ${modBeforeMd5}`);
  };
  const collectExclusionNote = "applyDepth's whole-directory collect() read excluded by call-site stack tag (!(new Error().stack ?? '').includes('at collect ('))";
  plantReader('CHECK', 'src/check.ts', 'const png = join(home, partImageReference(r, alt.name).path);', "const png = join(home, 'parts', 'stale.png');");
  plantReader('DIFFCOMPONENTS', 'src/diffcomponents.ts', 'join(dirname(partsPath), partImageReference(record).path)', "join(dirname(partsPath), 'parts', 'stale.png')");
  plantReader('MESHDRAFT', 'src/meshdraft.ts', 'const png = join(input.parts, partImageReference(p).path);', "const png = join(input.parts, 'parts', 'stale.png');", stageFixture, '32x120 stage-fixture with robe at y=94 (height 100, spacing 3)');
  plantReader('DEPTHWORKFLOW_PREPARE', 'src/depthworkflow.ts', 'join(partsDir, partImageReference(part).path)', "join(partsDir, 'parts', 'stale.png')", stageFixture);
  plantReader('DEPTHWORKFLOW_APPLY_PART', 'src/depthworkflow.ts', 'join(input.parts, partImageReference(p).path)', "join(input.parts, 'parts', 'stale.png')", stageFixture, collectExclusionNote);
  plantReader('DEPTHWORKFLOW_APPLY_DEPTH', 'src/depthworkflow.ts', 'join(input.parts, depthImageReference(p.depth).path)', "join(input.parts, 'parts', 'stale.png')", stageFixture, `${collectExclusionNote}; robe has depth robe-depth.png and is absent from recipe.parts and recipe.clear`);
  plantReader('CUTMATERIALIO_WRITE', 'src/cutmaterialio.ts', 'hash(join(dirname(partsDir),partImageReference(p).path))', "hash(join(dirname(partsDir),'parts','stale.png'))");
  plantReader('CUTMATERIALIO_READ', 'src/cutmaterialio.ts', 'const file=join(home,partImageReference(part).path);', "const file=join(home,'parts','stale.png');");

  cpSync(join(root, 'cli.ts'), join(isolated, 'cli.ts'));
  cpSync(join(root, 'tools'), join(isolated, 'tools'), { recursive: true });
  const sceneFixture = join(dir, 'scene-fixture');
  const skirtTop = EXPECTED_PARTS.parts.find(p => p.name === 'bottomwear') as { x: number; y: number; w: number };
  const torsoTop = EXPECTED_PARTS.parts.find(p => p.name === 'topwear') as { x: number; y: number; w: number };
  const sceneCfg = {
    ...assembleConfig(),
    scene: {},
    bones: [
      { name: 'anchor', parent: 'root', at: [0, 0] },
      { name: 'chest', parent: 'root', at: [torsoTop.x + torsoTop.w / 2, torsoTop.y] },
      { name: 'skirt', parent: 'root', at: [skirtTop.x + skirtTop.w / 2, skirtTop.y] },
    ],
    regions: { ...(assembleConfig().regions as Record<string, string>), topwear: 'chest', bottomwear: 'skirt' },
    motion: {
      duration: 1,
      tracks: [
        { bone: 'chest', prop: 'translatey', amp: 1, period: 1, phase: 0 },
        { bone: 'skirt', prop: 'rotate', amp: 2, period: 1, phase: 0 },
      ],
    },
  };
  writeAssembleFixture(sceneFixture, sceneCfg);
  interface LayoutRowOutcome { path: string; role: string; ok: boolean; sha256?: string; code?: string; message?: string }
  interface LayoutOutcome { layout: 'build' | 'assemble'; status: number; rows: LayoutRowOutcome[]; missing: LayoutRowOutcome[] }
  interface SceneLayoutsObservation {
    layouts: LayoutOutcome[];
    renderFigureSha256: string | null;
    rigFigureSha256: string | null;
    buildFigureSha256: string | null;
  }
  const sha256Of = (filePath: string): string => createHash('sha256').update(readFileSync(filePath)).digest('hex');
  const observeSceneLayouts = (sourceRoot: string, label: string): SceneLayoutsObservation => {
    const outRoot = join(dir, `scene-layouts-${label}`);
    rmSync(outRoot, { recursive: true, force: true });
    const buildOut = join(outRoot, 'build');
    const assembleOut = join(outRoot, 'assemble');
    const cliPath = join(sourceRoot, 'cli.ts');
    const commonArgs = [
      '--config', join(sceneFixture, 'config.json'),
      '--source', join(sceneFixture, 'painting.png'),
      '--full', join(sceneFixture, 'full'),
      '--head', join(sceneFixture, 'head'),
    ];
    const buildRun = spawnSync(process.execPath, [cliPath, 'build', '--no-extremes', ...commonArgs, '--out', buildOut], { cwd: sourceRoot, encoding: 'utf8', timeout: 60000 });
    const assembleRun = spawnSync(process.execPath, [cliPath, 'assemble', ...commonArgs, '--out', assembleOut], { cwd: sourceRoot, encoding: 'utf8', timeout: 60000 });
    const layouts: LayoutOutcome[] = [];
    for (const [layout, status, partsDir] of [
      ['build', buildRun.status ?? 1, buildOut],
      ['assemble', assembleRun.status ?? 1, join(assembleOut, 'rig')],
    ] as const) {
      const rows = partsFileReferences(partsDir).map((row): LayoutRowOutcome => {
        try {
          return { path: row.path, role: row.role, ok: true, sha256: sha256Of(join(partsDir, row.path)) };
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          return { path: row.path, role: row.role, ok: false, code: err.code, message: err.message };
        }
      });
      layouts.push({ layout, status, rows, missing: rows.filter(r => !r.ok) });
    }
    const safeSha = (p: string): string | null => {
      try { return sha256Of(p); } catch { return null; }
    };
    return {
      layouts,
      renderFigureSha256: safeSha(join(assembleOut, 'render', FIGURE_MASK_FILE)),
      rigFigureSha256: safeSha(join(assembleOut, 'rig', FIGURE_MASK_FILE)),
      buildFigureSha256: safeSha(join(buildOut, FIGURE_MASK_FILE)),
    };
  };
  const sceneGreen = observeSceneLayouts(root, 'green');
  const stripSha = (rows: LayoutRowOutcome[]) => rows.map(({ path: p, role }) => ({ path: p, role }));
  say(
    'PT1177_SCENE_BUILD_AND_STANDALONE_ASSEMBLE_RESOLVE_ALL_REFERENCES',
    sceneGreen.layouts.length === 2 &&
      sceneGreen.layouts.every(l =>
        l.status === 0 &&
        l.missing.length === 0 &&
        l.rows.some(r => r.path === 'figure_rig.png' && r.role === 'figure_mask' && r.ok) &&
        l.rows.some(r => r.path === 'painting_in_rig.png' && r.role === 'painting' && r.ok)) &&
      JSON.stringify(stripSha(sceneGreen.layouts[0].rows)) === JSON.stringify(stripSha(sceneGreen.layouts[1].rows)) &&
      sceneGreen.rigFigureSha256 !== null &&
      sceneGreen.rigFigureSha256 === sceneGreen.renderFigureSha256 &&
      sceneGreen.rigFigureSha256 === sceneGreen.buildFigureSha256,
    JSON.stringify(sceneGreen),
  );
  const buildSource = join(isolated, 'src/build.ts');
  const buildOriginal = readFileSync(buildSource, 'utf8');
  const buildBeforeMd5 = createHash('md5').update(readFileSync(buildSource)).digest('hex');
  const buildPlantTarget = '    if (resolve(dirname(outs.partsJson)) !== resolve(dirname(outs.recomposite))) writeFileSync(join(dirname(outs.partsJson), FIGURE_MASK_FILE), figureBytes);';
  const buildPlanted = buildOriginal.replace(buildPlantTarget, '');
  if (buildPlanted === buildOriginal) throw new Error('missing mutation target for PT1177 in src/build.ts');
  try {
    writeFileSync(buildSource, buildPlanted);
    const buildPlantedMd5 = createHash('md5').update(readFileSync(buildSource)).digest('hex');
    const sceneRed = observeSceneLayouts(isolated, 'mutant');
    const buildLayout = sceneRed.layouts.find(l => l.layout === 'build');
    const assembleLayout = sceneRed.layouts.find(l => l.layout === 'assemble');
    say(
      'PT1177_SKIPPING_PARTS_DIR_FIGURE_MASK_COPY_FAILS_WITH_ENOENT',
      buildPlantedMd5 !== buildBeforeMd5 &&
        buildLayout?.status === 0 &&
        buildLayout.missing.length === 0 &&
        assembleLayout?.status === 0 &&
        assembleLayout.missing.length === 1 &&
        assembleLayout.missing[0].path === 'figure_rig.png' &&
        assembleLayout.missing[0].role === 'figure_mask' &&
        assembleLayout.missing[0].code === 'ENOENT' &&
        (assembleLayout.missing[0].message ?? '').includes('figure_rig.png') &&
        sceneRed.renderFigureSha256 !== null &&
        sceneRed.rigFigureSha256 === null,
      JSON.stringify({ file: 'src/build.ts', removed: buildPlantTarget.trim(), beforeMd5: buildBeforeMd5, plantedMd5: buildPlantedMd5, red: sceneRed }),
    );
  } finally {
    writeFileSync(buildSource, buildOriginal);
  }
  const sceneRestored = observeSceneLayouts(isolated, 'restored');
  const buildAfterMd5 = createHash('md5').update(readFileSync(buildSource)).digest('hex');
  say(
    'PT1177_FIGURE_MASK_COPY_PLANT_REMOVED_AND_RESTORED',
    buildAfterMd5 === buildBeforeMd5 &&
      sceneRestored.layouts.every(l => l.status === 0 && l.missing.length === 0) &&
      sceneRestored.rigFigureSha256 !== null &&
      sceneRestored.rigFigureSha256 === sceneRestored.renderFigureSha256 &&
      sceneRestored.rigFigureSha256 === sceneRestored.buildFigureSha256,
    `plant removed, tree restored, src/build.ts md5 ${buildAfterMd5}; pre-plant md5 ${buildBeforeMd5}; rig/render/build figure_rig.png sha256 ${sceneRestored.rigFigureSha256}`,
  );
  const plainCfgPath = join(dir, 'plain-config.json');
  writeFileSync(plainCfgPath, JSON.stringify(assembleConfig(), null, 2) + '\n');
  const reuseW = join(dir, 'scene-then-plain-assemble');
  const firstSceneAssemble = spawnSync(
    process.execPath,
    [
      join(root, 'cli.ts'),
      'assemble',
      '--config', join(sceneFixture, 'config.json'),
      '--source', join(sceneFixture, 'painting.png'),
      '--full', join(sceneFixture, 'full'),
      '--head', join(sceneFixture, 'head'),
      '--out', reuseW,
    ],
    { cwd: root, encoding: 'utf8', timeout: 60000 },
  );
  const rigFigureAfterScene = existsSync(join(reuseW, 'rig', FIGURE_MASK_FILE));
  const secondPlainAssemble = spawnSync(
    process.execPath,
    [
      join(root, 'cli.ts'),
      'assemble',
      '--config', plainCfgPath,
      '--source', join(sceneFixture, 'painting.png'),
      '--full', join(sceneFixture, 'full'),
      '--head', join(sceneFixture, 'head'),
      '--out', reuseW,
    ],
    { cwd: root, encoding: 'utf8', timeout: 60000 },
  );
  const rigFigureAfterPlain = existsSync(join(reuseW, 'rig', FIGURE_MASK_FILE));
  const plainRefsAfterReuse = partsFileReferences(join(reuseW, 'rig'));
  say(
    'PT1177_NON_SCENE_ASSEMBLE_CLEARS_STALE_PARTS_DIR_FIGURE_MASK',
    firstSceneAssemble.status === 0 &&
      rigFigureAfterScene &&
      secondPlainAssemble.status === 0 &&
      !rigFigureAfterPlain &&
      !plainRefsAfterReuse.some(r => r.role === 'figure_mask' || r.path === FIGURE_MASK_FILE),
    JSON.stringify({
      sceneStatus: firstSceneAssemble.status,
      rigFigureAfterScene,
      plainStatus: secondPlainAssemble.status,
      rigFigureAfterPlain,
      plainRefs: plainRefsAfterReuse,
    }),
  );
}
