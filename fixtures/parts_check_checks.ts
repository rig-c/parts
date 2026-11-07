/** Small generated CLI controls. No example art, renderer or selftest invocation. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PartsError } from '../src/errors.ts';
import { checkPartsStage, PARTS_CHECK_CODES, PARTS_CHECK_FILE, PARTS_QUALITY_HOLES, type PartsCheckReport } from '../src/partscheck.ts';
import { writeParts, type PartsFile } from '../src/parts.ts';
import { newRaster } from '../src/raster/types.ts';
import { writePng } from '../src/raster/png.ts';
import { sourceCoverReport, type SourceCoverSet } from '../src/sourcecover.ts';
import { assembleStage } from '../src/build.ts';
import { writeAssembleFixture } from './assemble_fixture.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
const ROOT = resolve(import.meta.dir, '..');

function fixture(home: string): void {
  mkdirSync(join(home, 'parts'), { recursive: true });
  const file: PartsFile = { rig_size: [8, 8], scale_rig_per_source: 1, ghost_px: {}, parts: [{
    name: 'neck', from: 'full:neck', x: 0, y: 0, w: 2, h: 2, opaque_px: 4,
    projected_core_px: 4, source_px_taken: 4, refused_drift_px: 0, merged_px: 0, seam_override_px: 0,
  }] };
  writeParts(join(home, 'parts.json'), file);
  const image = newRaster(2, 2);
  for (let pixel = 0; pixel < 4; pixel++) image.data.set([80, 90, 100, 255], pixel * 4);
  writePng(join(home, 'parts/neck.png'), image);
  const layer = (name: string, rank: number) => ({ source: `full:${name}`, run: 'full' as const, layer: name,
    depth_median: null, draw_order: rank + 1, plan_rank: rank, planned_parts: rank < 0 ? [] : ['neck'],
    extend_parts: [], input_layer: name, prepared: false, taken_layers: [] });
  const set: SourceCoverSet = { set: null, painting_sha256: 'a'.repeat(64), grid: [8, 8],
    inputs: [{ run: 'full', file: 'layers.json', sha256: 'b'.repeat(64), layers: [{ layer: 'neck', image: 'neck.png' }] }],
    sources: [layer('neck', 0), layer('author:cover', -1)],
    parts: [{ part: 'neck', source: 'full:neck', support_px: 4, held_under_cover_px: 0,
      covered_by: [{ source: 'full:author:cover', planned: false, pixels: { count: 2, spans: [[0, 0, 2]] } }] }],
    inherited_parts: [], hidden_parts: [], output_assets: [{ part: 'neck', image: 'neck.png' }],
  };
  writeFileSync(join(home, 'source_cover.json'), JSON.stringify(sourceCoverReport([set])));
  writeFileSync(join(home, 'painting_allocation.json'), JSON.stringify({ spec: 'rig-parts-painting-allocation/1',
    code: 'PAINTING_EDGE_COVERAGE_TRANSFER', stage: 'paintingEdges after piece guarding and restoration',
    grid: [8, 8], supplier: 'owner-a/raw-plan-alpha>=128', refused: {}, lineage: [], fallbackHeld: 0,
    coverageTransfers: [], written_reports: [] }));
}

function cli(home: string, out: string, extra: string[] = []): { exit: number; text: string; report?: PartsCheckReport } {
  const result = Bun.spawnSync([process.execPath, join(ROOT, 'cli.ts'), 'check-parts', '--parts', home, '--out', out, ...extra]);
  const report = join(out, PARTS_CHECK_FILE);
  return { exit: result.exitCode, text: result.stdout.toString() + result.stderr.toString(),
    ...(existsSync(report) ? { report: JSON.parse(readFileSync(report, 'utf8')) as PartsCheckReport } : {}) };
}

/** Read a scratch-only mutated implementation while sharing the real production dependencies. */
function implementation(parent: string, name: string, change: (text: string) => string): typeof checkPartsStage {
  const path = join(parent, `${name}.ts`);
  const source = readFileSync(join(ROOT, 'src/partscheck.ts'), 'utf8').replace(/from '(\.[^']+)'/g,
    (_match, specifier: string) => `from ${JSON.stringify(resolve(ROOT, 'src', specifier))}`)
    .replace("from '@rig-c/core/png'", `from ${JSON.stringify(import.meta.resolve('@rig-c/core/png'))}`);
  writeFileSync(path, change(source));
  const loaded: { checkPartsStage: typeof checkPartsStage } = createRequire(import.meta.url)(path);
  return loaded.checkPartsStage;
}

export function runPartsCheckChecks(parent: string, say: Say): void {
  mkdirSync(parent, { recursive: true });
  let serial = 0;
  const fresh = () => { const dir = join(parent, `case-${serial++}`); fixture(join(dir, 'input')); return dir; };
  const run = (dir: string, name = 'out', extra: string[] = ['--json']) => cli(join(dir, 'input'), join(dir, name), extra);
  const positive = fresh();
  const green = run(positive);
  say('PCK1161_POSITIVE_AND_COVER', green.exit === 0 && green.report?.refusals.length === 0 &&
    green.report.reported.length === 1 && green.report.reported[0].part === 'neck' && green.report.reported[0].count === 2 &&
    JSON.stringify(green.report.reported[0].spans) === '[[0,0,2]]', JSON.stringify(green.report?.reported));
  for (const [code] of PARTS_QUALITY_HOLES) {
    const row = green.report?.holes.find(hole => hole.code === code);
    say(`PCK1161_${code}`, row !== undefined && row.line.includes('HOLE') && green.exit === 0, JSON.stringify(row));
  }
  const hash = (path: string, algorithm = 'sha256') => createHash(algorithm).update(readFileSync(path)).digest('hex');
  const before = green.report?.inputs.filter(row => row.status === 'read').map(row => [row.path, hash(join(positive, 'input', row.path))]);
  const again = run(positive);
  const other = run(positive, 'different/parent/report');
  const normalBytes = readFileSync(join(positive, 'out', PARTS_CHECK_FILE));
  const deterministic = normalBytes.equals(readFileSync(join(positive, 'different/parent/report', PARTS_CHECK_FILE)));
  say('PCK1161_DETERMINISM_AND_INPUT_BYTES', again.exit === 0 && other.exit === 0 && deterministic &&
    JSON.stringify(before) === JSON.stringify(other.report?.inputs.filter(row => row.status === 'read').map(row => [row.path, hash(join(positive, 'input', row.path))])) &&
    again.text === normalBytes.toString(), `repeat/different parents identical ${deterministic}; inputs ${JSON.stringify(before)}`);

  for (const [file, code] of [['source_cover.json', 'PARTS_SOURCE_COVER'], ['painting_allocation.json', 'PARTS_PAINTING_ALLOCATION']]) {
    const dir = fresh(); rmSync(join(dir, 'input', file)); const result = run(dir);
    say(`PCK1161_ABSENT_${code}`, result.exit === 0 && result.report?.holes.some(row => row.code === code) === true &&
      result.report.inputs.some(row => row.path === file && row.status === 'absent' && row.sha256 === null), JSON.stringify(result.report?.holes));
  }
  const bad = (name: string, change: (home: string) => void, code: string): void => {
    const dir = fresh(); change(join(dir, 'input')); const result = run(dir);
    const row = result.report?.refusals.find(problem => problem.code === code);
    say(name, result.exit === 1 && result.report?.exit_code === 1 && row !== undefined && row.object.length > 0 && row.detail.length > 0,
      JSON.stringify(row ?? result));
  };
  bad('PCK1161_SCHEMA', home => writeFileSync(join(home, 'parts.json'), '{"parts":[]}'), 'PARTS_FIELD_PRESENT');
  bad('PCK1161_INVALID_SCENE_STAYS_A_READER_REFUSAL', home => {
    const path = join(home, 'parts.json');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    value.scene = { figure_alpha_above: 8, figure_px: 4, figure_mask: '.' };
    writeFileSync(path, JSON.stringify(value));
  }, 'PARTS_FIELD_TYPE');
  bad('PCK1161_PNG_DIMENSION', home => writePng(join(home, 'parts/neck.png'), newRaster(1, 1)), 'PROPOSE_PNG_MATCHES_BOX');
  bad('PCK1161_PNG_READ', home => writeFileSync(join(home, 'parts/neck.png'), 'broken'), 'PARTS_CHECK_PNG_READ');
  bad('PCK1161_INPUT_READ', home => symlinkSync('missing', join(home, 'link')), 'PARTS_CHECK_INPUT_READ');
  for (const file of ['source_cover.json', 'painting_allocation.json']) {
    bad(`PCK1161_MALFORMED_${file.split('.')[0]}`, home => writeFileSync(join(home, file), '{}'), 'PARTS_CHECK_REPORT');
    bad(`PCK1161_JSON_${file.split('.')[0]}`, home => writeFileSync(join(home, file), '{'), 'PARTS_CHECK_REPORT');
  }
  bad('PCK1161_SOURCE_COVER_COUNT', home => {
    const path = join(home, 'source_cover.json');
    const report = JSON.parse(readFileSync(path, 'utf8'));
    report.sets[0].parts[0].covered_by[0].pixels.count = 3;
    writeFileSync(path, JSON.stringify(report));
  }, 'PARTS_CHECK_REPORT');
  bad('PCK1161_SOURCE_COVER_OWNER_MEMBERSHIP', home => {
    const path = join(home, 'source_cover.json');
    const report = JSON.parse(readFileSync(path, 'utf8'));
    report.sets[0].parts[0].covered_by[0].planned = true;
    writeFileSync(path, JSON.stringify(report));
  }, 'PARTS_CHECK_REPORT');
  const absentMask = fresh();
  const manifestPath = join(absentMask, 'input/parts.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.recomposite = { mean_abs: 0, within_limit: 8, within_share: 1, error_limit: 40, error_px: 0, covered_alpha: 128, uncovered_error_px: 0, hole_count: 0, holes_listed: 0, holes: [] };
  manifest.scene = { figure_alpha_above: 8, figure_px: 4, figure_mask: 'figure_rig.png' };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const noMask = run(absentMask);
  say('PCK1161_SCENE_MASK_IS_NOT_CONSUMED', noMask.exit === 0 && !noMask.report?.inputs.some(row => row.path === 'figure_rig.png'),
    JSON.stringify({ exit: noMask.exit, inputs: noMask.report?.inputs }));
  writeFileSync(join(absentMask, 'input/figure_rig.png'), 'ignored bytes');
  const presentMask = run(absentMask, 'with-mask');
  say('PCK1161_PRESENT_SCENE_MASK_IS_NOT_HASHED', presentMask.exit === 0 &&
    readFileSync(join(absentMask, 'out', PARTS_CHECK_FILE)).equals(readFileSync(join(absentMask, 'with-mask', PARTS_CHECK_FILE))), 'absent and unreadable declared figure masks produce the same report');

  const overlap = cli(join(positive, 'input'), join(positive, 'input/out'));
  say('PCK1161_OUTPUT_OVERLAP', overlap.exit === 1 && overlap.text.includes('PARTS_CHECK_OUTPUT') && !overlap.report, overlap.text.trim());
  const publishDir = fresh(); writeFileSync(join(publishDir, 'blocked'), 'keep');
  const publish = cli(join(publishDir, 'input'), join(publishDir, 'blocked'));
  say('PCK1161_PUBLISH', publish.exit === 1 && publish.text.includes('PARTS_CHECK_PUBLISH') && !publish.report && readFileSync(join(publishDir, 'blocked'), 'utf8') === 'keep', publish.text.trim());
  const usage = run(fresh(), 'usage', ['--unknown', 'value']);
  say('PCK1161_USAGE', usage.exit === 2 && usage.text.includes('USAGE') && !usage.report, usage.text.trim());

  const sourcePath = join(ROOT, 'src/partscheck.ts');
  const originalMd5 = hash(sourcePath, 'md5');
  const mutant = implementation(parent, 'absolute-path-mutant', text => text.replace('stage: \'parts\', inputs: before,',
    'stage: \'parts\', inputs: before.map(row => ({ ...row, path: output + "/" + row.path })), '));
  const redA = join(parent, 'mutant/a'); const redB = join(parent, 'mutant/different/b');
  mutant(join(positive, 'input'), redA, () => {}); mutant(join(positive, 'input'), redB, () => {});
  const mutantEqual = readFileSync(join(redA, PARTS_CHECK_FILE)).equals(readFileSync(join(redB, PARTS_CHECK_FILE)));
  const restored = implementation(parent, 'restored', text => text);
  const fixedA = join(parent, 'restored-a'); const fixedB = join(parent, 'restored-different/b');
  restored(join(positive, 'input'), fixedA, () => {}); restored(join(positive, 'input'), fixedB, () => {});
  const fixedEqual = readFileSync(join(fixedA, PARTS_CHECK_FILE)).equals(readFileSync(join(fixedB, PARTS_CHECK_FILE)));
  say('PCK1161_DETERMINISM_MUTANT_RED_THEN_GREEN', !mutantEqual && fixedEqual && hash(sourcePath, 'md5') === originalMd5,
    `mutant equal ${mutantEqual}, restored equal ${fixedEqual}; source md5 before ${originalMd5} after ${hash(sourcePath, 'md5')}; mutant reports ${hash(join(redA, PARTS_CHECK_FILE), 'md5')} ${hash(join(redB, PARTS_CHECK_FILE), 'md5')}; restored reports ${hash(join(fixedA, PARTS_CHECK_FILE), 'md5')} ${hash(join(fixedB, PARTS_CHECK_FILE), 'md5')}`);
  const changed = implementation(parent, 'changed-input-mutant', text => text.replace(
    '  if (JSON.stringify(before) !== JSON.stringify(inventory(false))) {',
    '  writeFileSync(join(home, "parts.json"), readFileSync(join(home, "parts.json"), "utf8") + " ");\n  if (JSON.stringify(before) !== JSON.stringify(inventory(false))) {'));
  const changeDir = fresh(); let changeCode = '';
  try { changed(join(changeDir, 'input'), join(changeDir, 'out'), () => {}); }
  catch (error) { if (!(error instanceof PartsError)) throw error; changeCode = error.problems[0].code; }
  say('PCK1161_INPUT_CHANGED', changeCode === 'PARTS_CHECK_INPUT_CHANGED' && !existsSync(join(changeDir, 'out', PARTS_CHECK_FILE)), changeCode);
  const unknown = implementation(parent, 'unknown-code-mutant', text => text.replaceAll("refuse('PARTS_CHECK_REPORT', name,", "refuse('UNDECLARED_CODE', name,"));
  const unknownDir = fresh(); writeFileSync(join(unknownDir, 'input/source_cover.json'), '{}'); let unknownCode = '';
  try { unknown(join(unknownDir, 'input'), join(unknownDir, 'out'), () => {}); }
  catch (error) { if (!(error instanceof PartsError)) throw error; unknownCode = error.problems[0].code; }
  say('PCK1161_INTERNAL_UNKNOWN_CODE', unknownCode === 'PARTS_CHECK_INTERNAL' && !existsSync(join(unknownDir, 'out', PARTS_CHECK_FILE)), unknownCode);

  const files = ['src/parts.ts', 'src/takesource.ts', 'src/depthsheets.ts', 'src/setfocus.ts', 'src/partscheck.ts'];
  const body = files.map(file => readFileSync(join(ROOT, file), 'utf8')).join('\n');
  const literals = [...body.matchAll(/'(PARTS_[A-Z0-9_]+|CONFIG_SET_FOCUS|PROPOSE_PNG_MATCHES_BOX)'/g)].map(match => match[1]);
  const documented = readFileSync(join(ROOT, 'docs/STABILITY.md'), 'utf8').split('<!-- parts-check:codes -->')[1]?.split('<!-- /parts-check:codes -->')[0] ?? '';
  const documentedCodes = [...documented.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map(match => match[1]);
  const declared = [...new Set(PARTS_CHECK_CODES)].sort();
  const accepts = (codes: string[]) => codes.every(code => declared.includes(code));
  say('PCK1161_CLOSED_CODES_AND_PLANTED_ADDITION', accepts(literals) && !accepts([...literals, 'UNDECLARED_CODE']) &&
    JSON.stringify([...new Set(documentedCodes)].sort()) === JSON.stringify(declared), JSON.stringify({ derived: [...new Set(literals)].sort(), documented: documentedCodes }));

  const standalone = join(parent, 'standalone');
  writeAssembleFixture(standalone);
  const configuration = join(standalone, 'config.json');
  const config = JSON.parse(readFileSync(configuration, 'utf8'));
  config.assemble.alternates = [{ name: 'variant', source: 'painting.png', full: 'full', head: 'head', parts: ['topwear'] }];
  writeFileSync(configuration, JSON.stringify(config));
  const stageOut = join(standalone, 'output');
  const rig = join(stageOut, 'rig');
  assembleStage({ source: join(standalone, 'painting.png'), full: join(standalone, 'full'), head: join(standalone, 'head'), config: join(standalone, 'config.json') },
    { partsJson: join(rig, 'parts.json'), partsDir: join(rig, 'parts'), recomposite: join(stageOut, 'render/recomposite_rig.png'), errorMap: join(stageOut, 'render/error.png') }, () => {});
  const result = cli(rig, join(standalone, 'checked'), ['--json']);
  const painting = result.report?.inputs.find(row => row.path === 'painting_in_rig.png');
  say('PCK1161_STANDALONE_PAINTING_BOUND', result.exit === 0 && painting?.status === 'read' &&
    painting.sha256 === hash(join(rig, 'painting_in_rig.png')), JSON.stringify({ exit: result.exit, painting, refusals: result.report?.refusals }));
  say('PCK1161_ALTERNATE_ASSETS_BOUND', result.exit === 0 && result.report?.parts.alternates.length === 1 &&
    result.report.inputs.some(row => row.path === 'parts/variant_topwear.png' && row.status === 'read'),
    JSON.stringify({ alternates: result.report?.parts.alternates, inputs: result.report?.inputs.map(row => row.path) }));
  const sceneFile = join(rig, 'parts.json');
  const withScene = JSON.parse(readFileSync(sceneFile, 'utf8'));
  withScene.alternates[0].scene = { figure_alpha_above: 8, figure_px: 0, figure_mask: 'figure_rig.png' };
  writeFileSync(sceneFile, JSON.stringify(withScene));
  const alternateScene = cli(rig, join(standalone, 'alternate-scene'), ['--json']);
  say('PCK1161_ALTERNATE_SCENE_MASK_IS_NOT_CONSUMED', alternateScene.exit === 0 &&
    !alternateScene.report?.inputs.some(row => row.path === 'figure_rig.png'), JSON.stringify({ exit: alternateScene.exit, refusals: alternateScene.report?.refusals }));
}
