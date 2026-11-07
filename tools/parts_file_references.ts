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
  const path = join(fixture, 'parts.json');
  writeFileSync(path, JSON.stringify(file));
  writeFileSync(join(fixture, 'config.json'), JSON.stringify(config));
  writeFileSync(join(fixture, 'painting_in_rig.png'), paintingBytes);
  for (const name of ['face.png', 'face-depth.png', 'side_face.png', 'side-depth.png', 'stale.png']) writeFileSync(join(fixture, 'parts', name), bytes);
  readParts(path);
  const expected = [
    { path: 'painting_in_rig.png', role: 'painting' },
    { path: 'parts/face-depth.png', role: 'depth' },
    { path: 'parts/face.png', role: 'part' },
    { path: 'parts/side-depth.png', role: 'depth' },
    { path: 'parts/side_face.png', role: 'alternate' },
  ];
  const references = partsFileReferences(fixture);
  say('PT1163_DECLARED_MEMBERSHIP_AND_ROLES', JSON.stringify(references) === JSON.stringify(expected), JSON.stringify(references));
  const invalid = (name: string, edit: (raw: Record<string, unknown>) => void, code: string): void => {
    const raw = structuredClone(file) as unknown as Record<string, unknown>;
    edit(raw);
    writeFileSync(path, JSON.stringify(raw));
    const refused: string[][] = [];
    try {
      for (const read of [() => partsFileReferences(fixture), () => readParts(path)]) {
        try { read(); refused.push([]); }
        catch (error) {
          if (!(error instanceof PartsError)) throw error;
          refused.push(error.problems.map(problem => problem.code));
        }
      }
    } finally { writeFileSync(path, JSON.stringify(file)); }
    say(name, refused.every(codes => codes.includes(code)), JSON.stringify(refused));
  };
  invalid('PT1163_ALTERNATE_DEPTH_ESCAPE_IS_REFUSED', raw => {
    const sets = raw.alternates as PartsFile['alternates'];
    sets![0].records[0].depth!.image = '../../x.png';
  }, 'PARTS_DEPTH_REFERENCE');
  invalid('PT1163_ALTERNATE_MISSING_RECORDS_IS_NAMED', raw => { raw.alternates = [{}]; }, 'PARTS_FIELD_TYPE');
  invalid('PT1163_ALTERNATE_MISSING_SET_NAME_IS_REFUSED', raw => {
    delete (raw.alternates as Array<Record<string, unknown>>)[0].name;
  }, 'PARTS_FIELD_TYPE');
  invalid('PT1163_ALTERNATE_UNSAFE_SET_NAME_IS_REFUSED', raw => {
    (raw.alternates as Array<Record<string, unknown>>)[0].name = '../side';
  }, 'PARTS_FIELD_TYPE');
  invalid('PT1163_ALTERNATE_UNSAFE_PART_NAME_IS_REFUSED', raw => {
    const sets = raw.alternates as PartsFile['alternates'];
    sets![0].records[0].name = '../face';
  }, 'PARTS_FIELD_TYPE');
  invalid('PT1163_ALTERNATE_NONOBJECT_IS_NAMED', raw => { raw.alternates = [null]; }, 'PARTS_FIELD_TYPE');
  invalid('PT1163_ALTERNATE_NONOBJECT_RECORD_IS_NAMED', raw => {
    (raw.alternates as Array<Record<string, unknown>>)[0].records = [null];
  }, 'PARTS_FIELD_TYPE');
  const script = join(dir, 'observer.ts');
  writeFileSync(script, observer);
  const paths = references.map(reference => resolve(fixture, reference.path));
  const observe = (source: string): Observation => {
    const result = spawnSync(process.execPath, [script, source, fixture, JSON.stringify(paths)], { encoding: 'utf8', timeout: 30000 });
    if (result.status !== 0) throw new Error(`parts observer exit ${result.status}: ${result.stderr}`);
    return JSON.parse(result.stdout.trim()) as Observation;
  };
  const green = observe(root);
  say('PT1163_REAL_READER_PNGS_ARE_ENUMERATED', green.uncovered.length === 0 && paths.every(path => green.reads.includes(path)), JSON.stringify(green));
  for (const reference of references) rmSync(join(fixture, reference.path));
  say('PT1163_MISSING_PNGS_KEEP_DECLARED_MEMBERSHIP', JSON.stringify(partsFileReferences(fixture)) === JSON.stringify(expected), 'all declared PNGs removed; manifest membership unchanged');
  for (const reference of references) writeFileSync(join(fixture, reference.path), reference.role === 'painting' ? paintingBytes : bytes);
  const isolated = join(dir, 'isolated');
  mkdirSync(isolated);
  cpSync(join(root, 'src'), join(isolated, 'src'), { recursive: true });
  cpSync(join(root, 'package.json'), join(isolated, 'package.json'));
  symlinkSync(join(root, 'node_modules'), join(isolated, 'node_modules'), 'dir');
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
}
