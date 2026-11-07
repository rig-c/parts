/** Real preflight read inventory on generated inputs, including a reader-only plant. */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { writeSetupFigureFixture } from '../fixtures/setupfigure.ts';
import { checkFileReferences, configFileReferences, loadConfig } from '../src/config.ts';
import { readRequirements } from '../src/requirements.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
interface Observation {
  reached: boolean;
  codes: string[];
  reads: string[];
  uncovered: string[];
}

// A separate process keeps filesystem interception out of the suite worker.
const observer = `
import { mock } from 'bun:test';
import * as fs from 'node:fs';
import { resolve, sep } from 'node:path';
const [source, fixture, input, expected] = process.argv.slice(2);
const reads = new Set();
const read = fs.readFileSync;
mock.module('node:fs', () => ({ ...fs, readFileSync(path, ...options) {
  if (typeof path === 'string') {
    const absolute = resolve(path);
    if (!absolute.startsWith(resolve(fixture, 'rig') + sep) && absolute !== resolve(fixture, 'painting.png')) reads.add(absolute);
  }
  return Reflect.apply(read, fs, [path, ...options]);
} }));
const { runCheck } = await import(source + '/src/check.ts');
const { PartsError } = await import(source + '/src/errors.ts');
let reached = false;
let codes = [];
try {
  runCheck(fixture + '/rig', fixture + '/out', () => { reached = true; throw new Error('preflight complete'); },
    undefined, undefined, fixture + '/painting.png', input + '/spec/requirements.json');
} catch (error) {
  if (error instanceof PartsError) codes = error.problems.map(problem => problem.code);
  else if (!reached) throw error;
}
const enumerated = new Set(JSON.parse(expected));
console.log(JSON.stringify({ reached, codes, reads: [...reads].sort(), uncovered: [...reads].filter(path => !enumerated.has(path)).sort() }));
`;

export function runCheckFileReferenceChecks(dir: string, rawConfig: Record<string, unknown>, say: Say): void {
  const root = resolve(import.meta.dir, '..');
  let fixture = join(dir, 'source');
  let input = join(fixture, 'inputs');
  let spec = join(input, 'spec');
  mkdirSync(spec, { recursive: true });
  const setup = writeSetupFigureFixture(fixture);
  cpSync(join(fixture, 'figure.png'), join(spec, 'figure.png'));
  const plate = newRaster(48, 80);
  for (let i = 0; i < plate.data.length; i += 4) plate.data.set([30, 40, 50, 255], i);
  const bytes = encodePngBytes(plate);
  writeFileSync(join(spec, 'backdrop.png'), bytes);
  setup.backdrop = { path: 'backdrop.png', sha256: createHash('sha256').update(bytes).digest('hex') };
  const requirementsPath = join(spec, 'requirements.json');
  writeFileSync(requirementsPath, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [], setup_painting: setup }));
  const raw = { ...rawConfig, requirements: 'spec/requirements.json' };
  const config = join(input, 'config.json');
  writeFileSync(config, JSON.stringify(raw));
  loadConfig(config);
  const requirements = readRequirements(requirementsPath);
  const before = JSON.stringify({ raw, requirements });
  const references = checkFileReferences(raw, config, requirements);
  const fields = references.map(row => row.at);
  const expectedFields = [...configFileReferences(raw).map(row => row.at), 'requirements.setup_painting.figure_mask.path', 'requirements.setup_painting.backdrop.path'];
  const expectedPaths = ['spec/requirements.json', 'spec/figure.png', 'spec/backdrop.png'];
  say('CF1138_CONFIG_AND_REQUIREMENTS_MEMBERSHIP', JSON.stringify(fields) === JSON.stringify(expectedFields) &&
    JSON.stringify(references.map(row => row.value)) === JSON.stringify(expectedPaths) && before === JSON.stringify({ raw, requirements }),
    JSON.stringify(references));
  const declaredConfig = { requirements: '../spec.json', motion: { animations_from: './motion.json' }, generation: { control: { skeleton: '/pose.json' } } };
  const own = checkFileReferences(declaredConfig, config);
  say('CF1138_ALL_CONFIG_ROWS_AND_ABSENT_SETUP', own.length === 3 && own.every((row, i) => row.at === configFileReferences(declaredConfig)[i].at && resolve(input, row.value) === resolve(input, configFileReferences(declaredConfig)[i].value)) &&
    JSON.stringify(checkFileReferences(raw, config, { ...requirements, setup_painting: undefined })) === JSON.stringify(checkFileReferences(raw, config)), JSON.stringify(own));
  const packed = join(dir, 'bundle');
  mkdirSync(join(packed, 'inputs'), { recursive: true });
  cpSync(join(fixture, 'rig'), join(packed, 'rig'), { recursive: true });
  cpSync(join(fixture, 'painting.png'), join(packed, 'painting.png'));
  cpSync(config, join(packed, 'inputs/config.json'));
  for (const reference of references) {
    const destination = resolve(packed, 'inputs', reference.value);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolve(input, reference.value), destination);
  }
  fixture = packed;
  input = join(fixture, 'inputs');
  spec = join(input, 'spec');
  const script = join(dir, 'observe.ts');
  writeFileSync(script, observer);
  const paths = references.map(row => resolve(input, row.value));
  const observe = (source: string): Observation => {
    const result = spawnSync(process.execPath, [script, source, fixture, input, JSON.stringify(paths)], { encoding: 'utf8', timeout: 30000 });
    if (result.status !== 0) throw new Error(`preflight observer exit ${result.status}: ${result.stderr}`);
    return JSON.parse(result.stdout.trim()) as Observation;
  };
  const green = observe(root);
  say('CF1138_PREFLIGHT_READS_ARE_ENUMERATED', green.reached && green.codes.length === 0 && green.uncovered.length === 0 && paths.every(path => green.reads.includes(path)), JSON.stringify(green));
  for (const [file, code] of [['figure.png', 'CHECK_SETUP_PAINTING_MASK'], ['backdrop.png', 'CHECK_SETUP_PAINTING_BACKDROP']] as const) {
    const path = join(spec, file);
    const saved = readFileSync(path);
    rmSync(path);
    try {
      const red = observe(root);
      say(`CF1138_MISSING_${file === 'figure.png' ? 'MASK' : 'BACKDROP'}_KEEPS_PREFLIGHT_REFUSAL`, !red.reached && red.codes.includes(code), JSON.stringify(red));
    } finally { writeFileSync(path, saved); }
  }
  const isolated = join(dir, 'isolated');
  mkdirSync(isolated);
  cpSync(join(root, 'src'), join(isolated, 'src'), { recursive: true });
  cpSync(join(root, 'package.json'), join(isolated, 'package.json'));
  symlinkSync(join(root, 'node_modules'), join(isolated, 'node_modules'), 'dir');
  const check = join(isolated, 'src/check.ts');
  const original = readFileSync(check, 'utf8');
  const marker = 'reqRecord = requirementsFileRecord(requirements, requirementsAs ?? requirements);';
  const planted = original.replace(marker, `${marker}\n    readFileSync(resolve(dirname(requirements), 'extra.png'));`);
  writeFileSync(join(spec, 'extra.png'), bytes);
  try {
    writeFileSync(check, planted);
    const red = observe(isolated);
    say('CF1138_READER_ONLY_PLANT_BREAKS_READ_SUBSET', planted !== original && red.reached && red.uncovered.length === 1 && red.uncovered[0] === join(spec, 'extra.png'), JSON.stringify(red));
  } finally {
    writeFileSync(check, original);
    rmSync(join(spec, 'extra.png'));
  }
  const restored = observe(isolated);
  say('CF1138_PLANT_REMOVED_READ_SUBSET_RESTORED', restored.reached && restored.uncovered.length === 0 && readFileSync(check, 'utf8') === original,
    `plant removed, tree restored, check.ts md5 ${createHash('md5').update(readFileSync(check)).digest('hex')}; ${JSON.stringify(restored)}`);
}
