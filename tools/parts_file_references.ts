import { partsStringFieldFaults } from './parts_file_field_inventory.ts';
/** Observe the production readers on generated manifests, including a reader-only plant. */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { partsFileReferences, readParts, type PartsFile } from '../src/parts.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { PartsError } from '../src/errors.ts';
import { newRaster } from '../src/raster/types.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
interface Observation { reads: string[]; uncovered: string[] }
const observer = `
import { mock } from 'bun:test';
import * as fs from 'node:fs';
import { resolve } from 'node:path';
const [source, fixture, expected] = process.argv.slice(2);
const reads = new Set();
const read = fs.readFileSync;
mock.module('node:fs', () => ({ ...fs, readFileSync(path, ...options) {
  if (typeof path === 'string' && path.endsWith('.png')) reads.add(resolve(path));
  return Reflect.apply(read, fs, [path, ...options]);
} }));
const { readPartSet } = await import(source + '/src/propose.ts');
const { tilesFrom } = await import(source + '/src/sheet.ts');
const { readRigInputs } = await import(source + '/src/build.ts');
readPartSet(fixture);
tilesFrom(fixture + '/parts.json');
readRigInputs(fixture + '/config.json', fixture);
const enumerated = new Set(JSON.parse(expected));
console.log(JSON.stringify({ reads: [...reads].sort(), uncovered: [...reads].filter(path => !enumerated.has(path)).sort() }));
`;

export function runPartsFileReferenceChecks(dir: string, base: PartsFile, config: Record<string, unknown>, say: Say): void {
  const root = resolve(import.meta.dir, '..');
  const fixture = join(dir, 'fixture');
  mkdirSync(join(fixture, 'parts'), { recursive: true });
  const image = newRaster(12, 10);
  for (let i = 0; i < image.data.length; i += 4) image.data.set([128, 128, 128, 255], i);
  const bytes = encodePngBytes(image);
  const painting = newRaster(32, 24);
  for (let i = 3; i < painting.data.length; i += 4) painting.data[i] = 255;
  const paintingBytes = encodePngBytes(painting);
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
  writeFileSync(join(fixture, 'painting_in_rig.png'), paintingBytes);
  writeFileSync(join(fixture, 'figure_rig.png'), bytes);
  for (const name of ['face.png', 'face-depth.png', 'side_face.png', 'side-depth.png', 'stale.png']) writeFileSync(join(fixture, 'parts', name), bytes);
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
const [source, fixture, code, suffix] = process.argv.slice(2);
const { partsFileReferences, readParts } = await import(source + '/src/parts.ts');
const outcomes = [() => partsFileReferences(fixture), () => readParts(fixture + '/parts.json')].map(read => {
  try { read(); return { matched: false, problems: [] }; }
  catch (error) {
    const problems = error.problems ?? [];
    return { matched: problems.some(p => p.code === code && p.object.endsWith(suffix)), problems, error: error.name };
  }
});
console.log(JSON.stringify(outcomes));
`);
  interface RefusalOutcome { matched: boolean; problems: Array<{ code: string; object: string }> }
  const invalid = (name: string, edit: (raw: Record<string, unknown>) => void, code: string, suffix: string, rule: string): void => {
    const raw = structuredClone(file) as unknown as Record<string, unknown>;
    edit(raw);
    writeFileSync(path, JSON.stringify(raw));
    const observeRefusal = (source: string): RefusalOutcome[] => {
      const result = spawnSync(process.execPath, [refusalScript, source, fixture, code, suffix], { encoding: 'utf8', timeout: 30000 });
      if (result.status !== 0) throw new Error(`refusal observer exit ${result.status}: ${result.stderr}`);
      return JSON.parse(result.stdout.trim()) as RefusalOutcome[];
    };
    try {
      const green = observeRefusal(root);
      say(name, green.every(outcome => outcome.matched), JSON.stringify(green));
      const mutant = partsOriginal.replace(rule, '');
      if (mutant === partsOriginal) throw new Error(`missing mutation target for ${name}`);
      writeFileSync(partsSource, mutant);
      const red = observeRefusal(isolated);
      say(`${name}_RULE_REMOVAL_IS_RED`, red.every(outcome => !outcome.matched), JSON.stringify({ removed: rule, outcomes: red }));
      writeFileSync(partsSource, partsOriginal);
      const restored = observeRefusal(isolated);
      const afterMd5 = createHash('md5').update(readFileSync(partsSource)).digest('hex');
      say(`${name}_RULE_RESTORED`, afterMd5 === partsMd5 && restored.every(outcome => outcome.matched), `plant removed, tree restored, src/parts.ts md5 ${afterMd5}; pre-plant md5 ${partsMd5}; named refusal restored ${restored.every(outcome => outcome.matched)}`);
    } finally {
      writeFileSync(partsSource, partsOriginal);
      writeFileSync(path, JSON.stringify(file));
    }
  };
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
  const observe = (source: string): Observation => {
    const result = spawnSync(process.execPath, [script, source, fixture, JSON.stringify(paths)], { encoding: 'utf8', timeout: 30000 });
    if (result.status !== 0) throw new Error(`parts observer exit ${result.status}: ${result.stderr}`);
    return JSON.parse(result.stdout.trim()) as Observation;
  };
  const green = observe(root);
  say('PT1163_REAL_READER_PNGS_ARE_ENUMERATED', green.uncovered.length === 0 && paths.filter(path => !path.endsWith('/figure_rig.png')).every(path => green.reads.includes(path)), JSON.stringify(green));
  for (const reference of references) rmSync(join(fixture, reference.path));
  say('PT1163_MISSING_PNGS_KEEP_DECLARED_MEMBERSHIP', JSON.stringify(partsFileReferences(fixture)) === JSON.stringify(expected), 'all declared PNGs removed; manifest membership unchanged');
  for (const reference of references) writeFileSync(join(fixture, reference.path), reference.role === 'painting' ? paintingBytes : bytes);
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
  say('PT1163_RESTORED_READER_SUBSET_IS_GREEN', restored.uncovered.length === 0 && paths.filter(path => !path.endsWith('/figure_rig.png')).every(path => restored.reads.includes(path)), JSON.stringify(restored));
  const afterMd5 = createHash('md5').update(readFileSync(source)).digest('hex');
  say('PT1163_PLANT_REMOVED_SOURCE_RESTORED', afterMd5 === beforeMd5, `plant removed, tree restored, src/propose.ts md5 ${afterMd5}; pre-plant md5 ${beforeMd5}`);
}
