import { writeSetupFigureFixture } from '../fixtures/setupfigure.ts';
import { readSetupFigureMask } from '../src/setupfiguremask.ts';
import { createHash } from 'node:crypto';
import { writeSetupBackdropFixture } from '../fixtures/setupbackdrop.ts';
import { readSetupBackdrop } from '../src/setupbackdrop.ts';
/** Independent controls for source-painting setup limits and plan inversions. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { writeCheckRig, CHECK_PARTS, checkPartRaster } from '../fixtures/checkrig.ts';
import { checkStage, readSource } from '../src/build.ts';
import { checkStatuses, readCheckInputs, type RigcRunner } from '../src/check.ts';
import { PartsError, type Problem } from '../src/errors.ts';
import { readRequirements } from '../src/requirements.ts';
import { alphaComposite } from '../src/raster/composite.ts';
import { newRaster } from '../src/raster/types.ts';
import { readPng, writePng } from '../src/raster/png.ts';
import { SETUP_PAINTING_LINE, SETUP_PAINTING_REQUIRED_CODE, setupPaintingLine, setupPaintingProblems, type SetupPainting } from '../src/setuppainting.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
export function runSetupPaintingChecks(dir: string, say: Say, rigc: RigcRunner): void {
  mkdirSync(dir, { recursive: true });
  const image = (r: number, a = 255) => { const im = newRaster(1, 1); im.data.set([r, 0, 0, a]); return im; };
  const declared: SetupPainting = { rgb_tolerance: 60, regions: [{ name: 'sample', box: [0, 0, 1, 1], max_pixels: 0 }] };
  const metric = (a: ReturnType<typeof image>, b: ReturnType<typeof image>, requirement = declared, owner = 0) => {
    const problems: Problem[] = [];
    const line = setupPaintingLine(requirement, a, b, new Uint8Array([1]), new Int32Array([owner]), ['front'], problems);
    return { line, problems };
  };
  say('ZO01_IDENTICAL_IS_GREEN', metric(image(0), image(0)).line.status === 'PASS', 'identical opaque observations: pixelcount0,limit0');
  const defect = metric(image(0), image(61));
  say('ZO02_DEFECT_NAMES_SLOT_BOX_COUNT_LIMIT', defect.line.status === 'FAIL' && defect.line.regions[0].pixel_count === 1 && defect.problems[0]?.code === 'CHECK_SETUP_MATCHES_PAINTING' && defect.problems[0].object.includes('front') && defect.problems[0].detail.includes('box [0, 0, 1, 1]') && defect.problems[0].detail.includes('declared limit 0'), JSON.stringify(defect));
  say('ZO03_THRESHOLD_AND_LIMIT_EQUALITY', metric(image(0), image(60)).line.status === 'PASS' && metric(image(0), image(61), { ...declared, regions: [{ ...declared.regions[0], max_pixels: 1 }] }).line.status === 'PASS', 'strict RGB>60, inclusive pixelcount<=1');
  const noLimit = metric(image(0), image(0), { ...declared, regions: [{ name: 'sample', box: [0, 0, 1, 1] }] });
  say('ZO04_ABSENT_LIMIT_NEVER_PASSES', noLimit.line.status === 'SKIP' && noLimit.line.regions[0].status === 'SKIP', JSON.stringify(noLimit));
  say('ZO05_TRANSPARENT_HIDDEN_RGB_IGNORED', metric(image(0, 0), image(255, 0)).line.status === 'PASS', 'both composite to white');
  const uncovered = metric(image(0), image(0, 0), declared, -1);
  say('ZO06_MISSING_FIGURE_COUNTS_UNCOVERED', uncovered.line.status === 'FAIL' && uncovered.line.regions[0].slots[0].slot === '(uncovered)', JSON.stringify(uncovered));
  const invalid: unknown[] = [{}, { ...declared, rgb_tolerance: -1 }, { ...declared, rgb_tolerance: 256 }, { ...declared, surprise: 1 }, { ...declared, regions: [] }, { ...declared, regions: [{ name: 'x', box: [0, 0, 0, 1] }] }, { ...declared, regions: [{ name: 'x', box: [0, 0, 1, 1], max_pixels: -1 }] }, { ...declared, regions: [declared.regions[0], declared.regions[0]] }];
  say('ZO07_INVALID_SHAPES_COLLECT_NAMED_FAILURES', invalid.every(v => setupPaintingProblems(v, 'setup_painting').every(p => p.code === 'REQUIREMENTS_FIELD') && setupPaintingProblems(v, 'setup_painting').length > 0), `${invalid.length} planted invalid declarations`);
  const req = (name: string, value?: unknown) => {
    const path = join(dir, name + '.json');
    writeFileSync(path, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [], ...(value === undefined ? {} : { setup_painting: value }) }));
    return path;
  };
  let refused = false;
  try { readRequirements(req('invalid', invalid[1])); } catch (e) { refused = e instanceof PartsError && e.problems.some(p => p.code === 'REQUIREMENTS_FIELD'); }
  say('ZO08_REAL_REQUIREMENTS_READER_IS_ADDITIVE', refused && readRequirements(req('absent')).setup_painting === undefined && readRequirements(req('present', declared)).setup_painting?.rgb_tolerance === 60, 'existing requirements format; absent key omitted, invalid key refused');
  const input = join(dir, 'input'); writeCheckRig(input);
  const rigBefore = readFileSync(join(input, 'rig.json'), 'utf8');
  let source = newRaster(48, 80); source.data.fill(255);
  for (const p of CHECK_PARTS) source = alphaComposite(source, checkPartRaster(p), p.x, p.y);
  const sourcePath = join(dir, 'painting.png'); writePng(sourcePath, source);
  const real: SetupPainting = { rgb_tolerance: 60, regions: [{ name: 'figure', box: [0, 0, 48, 80], max_pixels: 0 }] };
  const calls: string[][] = [];
  const logs = new Map<string, string[]>();
  const run = (name: string, requirement?: string) => {
    const lines: string[] = [];
    logs.set(name, lines);
    return checkStage({ rig: input, source: sourcePath, out: join(dir, name), ...(requirement === undefined ? {} : { requirements: requirement }), noExtremes: true }, args => { calls.push([...args]); return rigc(args); }, 'fixture-rigc', line => lines.push(line));
  };
  const cli = (name: string, requirement?: string, json = false) => {
    const out = join(dir, name);
    const result = spawnSync(process.execPath, [resolve(import.meta.dir, '../cli.ts'), 'check', '--rig', input, '--source', sourcePath, '--out', out, '--no-extremes', ...(requirement === undefined ? [] : ['--requirements', requirement]), ...(json ? ['--json'] : [])], { encoding: 'utf8' });
    return { ...result, out };
  };
  const jsonMatches = (result: ReturnType<typeof cli>): boolean => {
    try { return result.stdout === readFileSync(join(result.out, 'check.json'), 'utf8'); }
    catch { return false; }
  };
  const absent = run('absent');
  const absentLine = absent.figures[SETUP_PAINTING_LINE];
  const remedy = (text: string): boolean => ['setup_painting', '--requirements', 'rgb_tolerance', 'regions', 'max_pixels'].every(field => text.includes(field));
  say('ZO11_UNDECLARED_SOURCE_NAMES_SKIP_AND_REMEDY', absentLine?.status === 'SKIP' && Object.keys(absentLine).join(',') === 'status,reason' && remedy(absentLine.reason ?? '') && checkStatuses(absent.figures)[SETUP_PAINTING_LINE] === 'SKIP' && absent.figures.PASS && absent.problems.length === 0 && !absent.bars.measured.includes(SETUP_PAINTING_LINE) && absent.bars.skipped.some(b => b.bar === SETUP_PAINTING_LINE && remedy(b.reason)) && logs.get('absent')?.some(line => line.includes(SETUP_PAINTING_LINE + ': SKIP') && remedy(line)) === true && JSON.parse(readFileSync(join(dir, 'absent', 'check.json'), 'utf8'))[SETUP_PAINTING_LINE]?.status === 'SKIP', JSON.stringify({line: absentLine ?? null, bars: absent.bars}));
  const empty = run('empty-requirements', req('empty-req'));
  say('ZO21_EMPTY_REQUIREMENTS_NAMES_SAME_SKIP', JSON.stringify(empty.figures[SETUP_PAINTING_LINE]) === JSON.stringify(absentLine) && empty.figures[SETUP_PAINTING_LINE]?.status === 'SKIP' && empty.figures.PASS, JSON.stringify(empty.figures[SETUP_PAINTING_LINE] ?? null));
  const noSource = checkStage({ rig: input, out: join(dir, 'no-source'), noExtremes: true }, rigc, 'fixture-rigc', () => {});
  say('ZO22_NO_SOURCE_RETAINS_OMISSION', noSource.figures[SETUP_PAINTING_LINE] === undefined && !noSource.bars.skipped.some(b => b.bar === SETUP_PAINTING_LINE), 'without source no new setup-painting block or bar');
  const textCli = cli('cli-undeclared');
  say('ZO23_UNDECLARED_CLI_EXIT_ZERO_WITH_SKIP', textCli.status === 0 && textCli.stdout.split('\n').some(line => line.includes(SETUP_PAINTING_LINE + ': SKIP') && remedy(line)), JSON.stringify({exit: textCli.status, lines: textCli.stdout.split('\n').filter(line => line.includes(SETUP_PAINTING_LINE))}));
  const jsonCli = cli('json-undeclared', undefined, true);
  say('ZO24_JSON_UNDECLARED_IS_THE_WRITTEN_REPORT', jsonCli.status === 0 && jsonMatches(jsonCli) && remedy(jsonCli.stdout) && jsonCli.stdout.includes('"status": "SKIP"'), JSON.stringify({exit: jsonCli.status, sameBytes: jsonMatches(jsonCli), stderr: jsonCli.stderr}));
  const declaredCli = cli('json-clean', req('json-clean-req', real), true);
  say('ZO25_JSON_DECLARED_PASS_EXIT_ZERO', declaredCli.status === 0 && jsonMatches(declaredCli) && JSON.parse(declaredCli.stdout)[SETUP_PAINTING_LINE]?.status === 'PASS', JSON.stringify({exit: declaredCli.status, sameBytes: jsonMatches(declaredCli)}));
  const requiredClean = cli('json-required-clean', req('json-required-clean-req', { ...real, required: true }), true);
  say('ZO33_REQUIRED_WITH_LIMITS_CLEAN_PASSES_AS_OPTIONAL', requiredClean.status === 0 && jsonMatches(requiredClean) && JSON.stringify(JSON.parse(requiredClean.stdout)[SETUP_PAINTING_LINE]) === JSON.stringify(JSON.parse(declaredCli.stdout)[SETUP_PAINTING_LINE]) && JSON.parse(requiredClean.stdout)[SETUP_PAINTING_LINE]?.status === 'PASS', JSON.stringify({ exit: requiredClean.status, sameBytes: jsonMatches(requiredClean) }));
  const clean = run('clean', req('clean-req', real));
  const cleanLine = clean.figures[SETUP_PAINTING_LINE];
  say('ZO12_REAL_SETUP_CLEAN_CONTROL', cleanLine?.status === 'PASS' && 'regions' in cleanLine && cleanLine.regions[0].pixel_count === 0 && checkStatuses(clean.figures)[SETUP_PAINTING_LINE] === 'PASS' && logs.get('clean')?.some(line => line.includes(SETUP_PAINTING_LINE + ': PASS')) === true, JSON.stringify(cleanLine));
  // Change the independent painting, never its rig or parts. The front region
  // is opaque at this centre, RGB [40,120,200] versus [0,0,0].
  source.data.set([0, 0, 0, 255], (40 * 48 + 30) * 4); writePng(sourcePath, source);
  const red = run('defect', req('defect-req', real));
  say('ZO13_REAL_PIPELINE_RED_PRINTS_SOURCE_MISMATCH', red.figures[SETUP_PAINTING_LINE]?.status === 'FAIL' && red.problems.some(p => p.code === 'CHECK_SETUP_MATCHES_PAINTING' && p.object.includes('front')) && !red.figures.PASS, JSON.stringify(red.figures[SETUP_PAINTING_LINE]));
  const skip = run('skip', req('skip-req', { ...real, regions: [{ name: 'figure', box: [0, 0, 48, 80] }] }));
  say('ZO14_REAL_PIPELINE_NO_LIMIT_SKIP', skip.figures[SETUP_PAINTING_LINE]?.status === 'SKIP' && !skip.problems.some(p => p.code === 'CHECK_SETUP_MATCHES_PAINTING'), JSON.stringify(skip.figures[SETUP_PAINTING_LINE]));
  const redCli = cli('json-defect', req('json-defect-req', real), true);
  say('ZO26_JSON_DECLARED_FAILURE_EXIT_ONE', redCli.status === 1 && jsonMatches(redCli) && JSON.parse(redCli.stdout)[SETUP_PAINTING_LINE]?.status === 'FAIL' && JSON.parse(redCli.stdout).PASS === false, JSON.stringify({exit: redCli.status, sameBytes: jsonMatches(redCli)}));
  const duplicate = spawnSync(process.execPath, [resolve(import.meta.dir, '../cli.ts'), 'check', '--json', '--json'], { encoding: 'utf8' });
  say('ZO27_JSON_DUPLICATE_IS_USAGE_ERROR', duplicate.status === 2 && (duplicate.stdout + duplicate.stderr).includes('--json is given twice'), JSON.stringify({exit: duplicate.status}));
  // Issue #943: required: true turns every absent limit into a refusal by name, before anything is built.
  const requiredRefusal = (name: string, value: unknown): readonly Problem[] => {
    try { readRequirements(req(name, value)); } catch (e) { if (e instanceof PartsError) return e.problems; throw e; }
    return [];
  };
  const bare = requiredRefusal('required-bare', { required: true });
  say('ZO28_REQUIRED_WITHOUT_LIMITS_REFUSED_BY_FIELD', bare.length === 2 && bare.every(p => p.code === SETUP_PAINTING_REQUIRED_CODE) && bare[0].object.endsWith('setup_painting.rgb_tolerance') && bare[1].object.endsWith('setup_painting.regions') && bare.every(p => p.detail.includes('is absent') && p.detail.includes('required is true')), JSON.stringify(bare));
  const unlimited = { required: true, rgb_tolerance: 60, regions: [{ name: 'figure', box: [0, 0, 48, 80] }, { name: 'head', box: [0, 0, 48, 20], max_pixels: 0 }] };
  const region = requiredRefusal('required-region', unlimited);
  const { required: _drop, ...optional } = unlimited;
  const optionalSkip = run('required-control-skip', req('required-control-skip-req', optional)).figures[SETUP_PAINTING_LINE];
  say('ZO29_REQUIRED_REGION_WITHOUT_MAX_PIXELS_REFUSED_WHERE_OPTIONAL_SKIPS', region.length === 1 && region[0].code === SETUP_PAINTING_REQUIRED_CODE && region[0].object.endsWith('setup_painting.regions[0].max_pixels (region "figure")') && optionalSkip?.status === 'SKIP', JSON.stringify({ region, optional: optionalSkip?.status ?? null }));
  const requiredCli = cli('required-cli', req('required-cli-req', { required: true }));
  const requiredLines = requiredCli.stdout.split('\n').filter(line => line.includes(SETUP_PAINTING_REQUIRED_CODE));
  say('ZO30_REQUIRED_CLI_EXIT_ONE_BEFORE_BUILD', requiredCli.status === 1 && requiredLines.length === 2 && requiredLines.every(line => line.includes('FAIL')) && !requiredCli.stdout.includes(SETUP_PAINTING_LINE + ': SKIP'), JSON.stringify({ exit: requiredCli.status, lines: requiredLines }));
  const requiredDefect = cli('required-defect', req('required-defect-req', { ...real, required: true }), true);
  const sameBytes = (a: ReturnType<typeof cli>, b: ReturnType<typeof cli>): boolean => a.status === b.status && JSON.stringify(JSON.parse(a.stdout)[SETUP_PAINTING_LINE]) === JSON.stringify(JSON.parse(b.stdout)[SETUP_PAINTING_LINE]);
  say('ZO31_REQUIRED_WITH_LIMITS_DEFECT_FAILS_AS_OPTIONAL', requiredDefect.status === 1 && sameBytes(requiredDefect, redCli) && JSON.parse(requiredDefect.stdout)[SETUP_PAINTING_LINE]?.status === 'FAIL', JSON.stringify({ required: requiredDefect.status, optional: redCli.status }));
  const notBoolean = requiredRefusal('required-string', { ...real, required: 'yes' });
  const optionalFalse = run('required-false', req('required-false-req', { ...real, required: false })).figures[SETUP_PAINTING_LINE];
  say('ZO32_REQUIRED_IS_BOOLEAN_FALSE_IS_ABSENT', notBoolean.length === 1 && notBoolean[0].code === 'REQUIREMENTS_FIELD' && notBoolean[0].object.endsWith('setup_painting.required') && JSON.stringify(optionalFalse) === JSON.stringify(red.figures[SETUP_PAINTING_LINE]), JSON.stringify({ notBoolean, same: JSON.stringify(optionalFalse) === JSON.stringify(red.figures[SETUP_PAINTING_LINE]) }));
  // The own source fixture is read-only through every check.
  say('ZO15_INPUT_RIG_UNCHANGED', readFileSync(join(input, 'rig.json'), 'utf8') === rigBefore && calls.some(a => a[0] === 'build'), 'real gated builds and official setup renderer used; no source repair');
  let gridRefused = false;
  try { setupPaintingLine(declared, image(0), newRaster(2, 1), new Uint8Array([1]), new Int32Array([0]), ['front'], []); }
  catch (e) { gridRefused = e instanceof PartsError && e.problems.some(p => p.code === 'CHECK_SETUP_PAINTING_MEASURED'); }
  say('ZO16_GRID_MISMATCH_NEVER_FITS', gridRefused, 'a different setup grid is refused, not aligned to obtain a result');
  const early = (name: string, value: unknown, withSource: boolean): { code: string[]; calls: number } => {
    let count = 0;
    try { checkStage({ rig: input, out: join(dir, name), requirements: req(name + '-req', value), ...(withSource ? { source: sourcePath } : {}), noExtremes: true }, args => { if (args[0] === 'build') count++; return rigc(args); }, 'fixture-rigc', () => {}); }
    catch (e) { if (e instanceof PartsError) return { code: e.problems.map(p => p.code), calls: count }; throw e; }
    return { code: [], calls: count };
  };
  const missingSource = early('missing-source', real, false);
  say('ZO17_SOURCE_MISSING_REFUSED_BEFORE_BUILD', missingSource.code.includes('CHECK_SETUP_PAINTING_SOURCE') && missingSource.calls === 0, JSON.stringify(missingSource));
  const outside = early('outside-stage', { ...real, regions: [{ name: 'outside', box: [47, 0, 2, 1], max_pixels: 0 }] }, true);
  say('ZO18_REGION_OUTSIDE_STAGE_REFUSED_BEFORE_BUILD', outside.code.includes('REQUIREMENTS_FIELD') && outside.calls === 0, JSON.stringify(outside));
  runSetupFigureChecks(join(dir, 'figure-mask'), say, rigc);
  runSetupBackdropChecks(join(dir, 'backdrop'), say, rigc);
  runSetupPaintingTransparencyChecks(join(dir, 'source-alpha'), say, rigc);
}

/** Actual PNG readers -> checkStage -> native setup measurement, at a 2:1
 * source/stage ratio. The top-left 8x12 stage box is outside this synthetic
 * figure. Hidden RGB must not invent a figure there. Alpha60 black composites
 * to authored RGB195 on white BEFORE the existing Lanczos resampling. */
export function runSetupPaintingTransparencyChecks(dir: string, say: Say, rigc: RigcRunner): void {
  mkdirSync(dir, { recursive: true });
  const input = join(dir, 'input'); writeCheckRig(input);
  const partsPath = join(input, 'parts.json');
  const parts = JSON.parse(readFileSync(partsPath, 'utf8')) as Record<string, unknown>;
  parts.scale_rig_per_source = 0.5;
  writeFileSync(partsPath, JSON.stringify(parts));
  let native = newRaster(48, 80); native.data.fill(255);
  for (const p of CHECK_PARTS) native = alphaComposite(native, checkPartRaster(p), p.x, p.y);
  const doubled = newRaster(96, 160);
  for (let y = 0; y < 160; y++) for (let x = 0; x < 96; x++) {
    const q = (Math.floor(y / 2) * 48 + Math.floor(x / 2)) * 4;
    doubled.data.set(native.data.subarray(q, q + 4), (y * 96 + x) * 4);
  }
  const patch = (rgba: readonly number[]): typeof doubled => {
    const out = { ...doubled, data: new Uint8ClampedArray(doubled.data) };
    for (let y = 0; y < 24; y++) for (let x = 0; x < 16; x++) out.data.set(rgba, (y * 96 + x) * 4);
    return out;
  };
  const requirement = join(dir, 'requirements.json');
  writeFileSync(requirement, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [], setup_painting: { rgb_tolerance: 60, regions: [{ name: 'figure', box: [0, 0, 48, 80], max_pixels: 0 }] } }));
  const variants = {
    'opaque-white': patch([255, 255, 255, 255]),
    'hidden-black': patch([0, 0, 0, 0]),
    'hidden-magenta': patch([255, 0, 255, 0]),
    'alpha60-black': patch([0, 0, 0, 60]),
    'opaque195': patch([195, 195, 195, 255]),
  };
  const lines = new Map<string, ReturnType<typeof checkStage>['figures'][typeof SETUP_PAINTING_LINE]>();
  for (const [name, image] of Object.entries(variants)) {
    const source = join(dir, name + '.png'); writePng(source, image);
    const report = checkStage({ rig: input, source, out: join(dir, name), requirements: requirement, noExtremes: true }, rigc, 'fixture-rigc', () => {});
    lines.set(name, report.figures[SETUP_PAINTING_LINE]);
  }
  const source = join(dir, 'hidden-black.png');
  const direct = readSource(source), checked = readCheckInputs(input, undefined, source).source;
  say('ZO19_ACTUAL_SOURCE_READERS_PRESERVE_ALPHA', direct.data[3] === 0 && direct.data[0] === 0 && checked?.painting.data[3] === 0 && checked.painting.data[0] === 0, '96x160 straight RGBA survives readSource and readCheckInputs; stage48x80, declared source scale0.5');
  const opaque = lines.get('opaque-white'), black = lines.get('hidden-black'), magenta = lines.get('hidden-magenta');
  say('ZO20_ACTUAL_PIPELINE_HIDDEN_RGB_IGNORED_BEFORE_RESIZE', opaque?.status === 'PASS' && 'regions' in opaque && opaque.regions[0].pixel_count === 0 && JSON.stringify(black) === JSON.stringify(opaque) && JSON.stringify(magenta) === JSON.stringify(opaque), JSON.stringify({ opaque, black, magenta }));
  const partial = lines.get('alpha60-black'), expected = lines.get('opaque195');
  say('ZO21_ACTUAL_PIPELINE_COMPOSITES_FRACTIONAL_ALPHA_BEFORE_RESIZE', partial !== undefined && expected !== undefined && JSON.stringify(partial) === JSON.stringify(expected), JSON.stringify({ partial, expected, independentExpected: 'black at alpha60 over white is RGB195; precompose at96x160, then existing Lanczos3 to48x80' }));
}

/** The backdrop is independent of the actual renderer; the analytic parts make
 * the painting. Only synthetic part alpha is planted, in both input copies. */
function runSetupBackdropChecks(dir: string, say: Say, rigc: RigcRunner): void {
  const declaration = writeSetupBackdropFixture(dir);
  const requirements = join(dir, 'requirements.json'), input = join(dir, 'rig'), source = join(dir, 'painting.png');
  const run = (name: string, value = declaration) => {
    writeFileSync(requirements, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [], setup_painting: value }));
    return checkStage({ rig: input, source, requirements, out: join(dir, name), noExtremes: true }, rigc, 'fixture-rigc', () => {}).figures[SETUP_PAINTING_LINE];
  };
  const withPlate = run('with-plate');
  const { backdrop: _drop, ...white } = declaration;
  const without = run('without-plate', white);
  const count = (v: typeof withPlate): number => v !== undefined && 'regions' in v ? v.regions[0].pixel_count : -1;
  say('ZO34_BACKDROP_ACTUAL_RENDERER_MATCHES_ANALYTIC_PAINTING', withPlate?.status === 'PASS' && count(withPlate) === 0 && without?.status === 'FAIL' && count(without) > 0, JSON.stringify({ withPlate, without }));
  // A 3x3 patch at global x36..38,y38..40 is outside the back part's box.
  const front = CHECK_PARTS[1], part = checkPartRaster(front);
  for (let y = 18; y < 21; y++) for (let x = 18; x < 21; x++) part.data[(y * part.width + x) * 4 + 3] = 0;
  for (const folder of ['images', 'parts']) writePng(join(input, folder, 'front.png'), part);
  const hole = run('hole');
  say('ZO35_BACKDROP_HOLE_COUNTS_UNCOVERED', hole?.status === 'FAIL' && count(hole) === 9 && 'regions' in hole && hole.regions[0].slots.some(s => s.slot === '(uncovered)' && s.pixel_count === 9), JSON.stringify(hole));
  const painting = readPng(source), plate = readPng(join(dir, 'backdrop.png'));
  const empty = newRaster(48, 80), noFigure = new Uint8Array(48 * 80), noOwners = new Int32Array(48 * 80).fill(-1);
  const seen = setupPaintingLine(declaration, painting, empty, noFigure, noOwners, [], [], plate);
  // Mutant: discard every source pixel with no setup alpha. This is the
  // opaque-only / setup-edge-exclusion alternative, which hides all holes.
  const mutantSource = { ...plate, data: new Uint8ClampedArray(plate.data) };
  const missed = setupPaintingLine(declaration, mutantSource, empty, noFigure, noOwners, [], [], plate);
  say('ZO36_BACKDROP_DOMAIN_KILLS_SETUP_ALPHA_ONLY_MUTANT', seen.status === 'FAIL' && seen.regions[0].pixel_count > 9 && missed.status === 'PASS' && missed.regions[0].pixel_count === 0 && hole !== undefined && 'regions' in hole && hole.regions[0].slots.filter(s => s.slot !== '(uncovered)').reduce((n, s) => n + s.pixel_count, 0) === 0, `source-plate domain ${seen.regions[0].pixel_count}; setup-alpha-only mutant ${missed.regions[0].pixel_count}; actual 9px hole ignored by ownership-mask mutant`);
  const bad: unknown[] = [null, {}, { path: '', sha256: 'x' }, { ...declaration.backdrop, other: true }];
  say('ZO37_BACKDROP_SHAPE_IS_REFUSED', bad.every(backdrop => setupPaintingProblems({ ...declaration, backdrop }, 'setup_painting').some(p => p.code === 'REQUIREMENTS_FIELD')), `${bad.length} malformed backdrop declarations`);
  const rejects = (value: SetupPainting, native = painting): boolean => {
    try { readSetupBackdrop(value, requirements, native); } catch (e) { return e instanceof PartsError && e.problems.some(p => p.code === 'CHECK_SETUP_PAINTING_BACKDROP'); }
    return false;
  };
  const goodPlate = readSetupBackdrop(declaration, requirements, painting);
  say('ZO38_BACKDROP_READER_BINDS_HASH_GRID_OPACITY', goodPlate?.width === 48 && rejects({ ...declaration, backdrop: { path: 'missing.png', sha256: '0'.repeat(64) } }) && rejects({ ...declaration, backdrop: { ...declaration.backdrop!, sha256: '0'.repeat(64) } }) && rejects(declaration, newRaster(24, 40)), 'same decoded bytes are hashed; absent PNG, stale hash and native-grid mismatch refused');
  const bytes = readFileSync(join(dir, 'backdrop.png'));
  plate.data[3] = 254; writePng(join(dir, 'backdrop.png'), plate);
  const translucent = { ...declaration, backdrop: { path: 'backdrop.png', sha256: createHash('sha256').update(readFileSync(join(dir, 'backdrop.png'))).digest('hex') } };
  say('ZO39_BACKDROP_TRANSLUCENCY_REFUSED', rejects(translucent), 'alpha254 cannot silently choose a second background');
  writeFileSync(join(dir, 'backdrop.png'), bytes);
  let builds = 0, earlyRefused = false;
  writeFileSync(requirements, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [], setup_painting: { ...declaration, backdrop: { path: 'missing.png', sha256: '0'.repeat(64) } } }));
  try { checkStage({ rig: input, source, requirements, out: join(dir, 'refused'), noExtremes: true }, args => { if (args[0] === 'build') builds++; return rigc(args); }, 'fixture-rigc', () => {}); }
  catch (e) { earlyRefused = e instanceof PartsError && e.problems.some(p => p.code === 'CHECK_SETUP_PAINTING_BACKDROP'); }
  say('ZO40_BACKDROP_REFUSED_BEFORE_BUILD', earlyRefused && builds === 0, `missing declared plate: refusal ${earlyRefused}, build calls ${builds}`);
  writeFileSync(join(dir, 'backdrop.png'), 'not a PNG');
  const invalidPng = { ...declaration, backdrop: { path: 'backdrop.png', sha256: createHash('sha256').update('not a PNG').digest('hex') } };
  say('ZO41_BACKDROP_INVALID_PNG_REFUSED_AFTER_VALID_HASH', rejects(invalidPng), 'matching bytes hash cannot admit a non-PNG');
  writeFileSync(join(dir, 'backdrop.png'), bytes);
}

export function runSetupFigureChecks(dir: string, say: Say, rigc: RigcRunner): void {
  const declared = writeSetupFigureFixture(dir);
  const requirements = join(dir, 'requirements.json'), sourcePath = join(dir, 'painting.png'), input = join(dir, 'rig');
  const run = (name: string, value: SetupPainting) => {
    writeFileSync(requirements, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [], setup_painting: value }));
    const report = checkStage({ rig: input, source: sourcePath, requirements, out: join(dir, name), noExtremes: true }, rigc, 'fixture-rigc', () => {});
    const line = report.figures[SETUP_PAINTING_LINE];
    if (line === undefined || !('regions' in line)) throw new Error('fixture did not produce region readings');
    return line;
  };
  const { figure_mask: mask, ...omitted } = declared;
  const legacy = run('legacy', omitted), clean = run('masked', declared);
  say('ZO42_ROOM_IS_UNBARRED_FIGURE_IS_CLEAN', legacy.status === 'FAIL' && clean.status === 'PASS' && clean.regions.every(r => r.pixel_count === 0) && (clean.outside_figure?.pixel_count ?? 0) > 0 && clean.outside_figure?.status === 'UNBARRED', JSON.stringify({ legacy, clean }));
  // A room-count reduction can hide a new figure defect in the old
  // region total. Freeze both baseline budgets before planting either change.
  const budgets = { ...omitted, regions: legacy.regions.map(r => ({ name: r.name, box: r.box, max_pixels: r.pixel_count })) };
  const front = checkPartRaster(CHECK_PARTS[1]);
  for (let q = 3; q < front.data.length; q += 4) if (front.data[q] > 0) front.data[q] = 255;
  for (let y = 18; y < 21; y++) for (let x = 18; x < 21; x++) front.data[(y * front.width + x) * 4 + 3] = 0;
  for (const folder of ['images', 'parts']) writePng(join(input, folder, 'front.png'), front);
  const painting = readPng(sourcePath);
  const independent = readPng(join(dir, 'figure.png'));
  for (let y = 8; y < 28; y++) for (let x = 3; x < 12; x++) {
    const q = (y * painting.width + x) * 4;
    if (independent.data[q + 3] === 0) painting.data.set([255, 255, 255, 255], q);
  }
  writePng(sourcePath, painting);
  const missed = run('legacy-defect', budgets), caught = run('masked-defect', declared);
  say('ZO43_FROZEN_ROOM_BUDGET_MISSES_FIGURE_HOLE', missed.status === 'PASS' && caught.status === 'FAIL' && caught.regions.every(r => r.pixel_count === 9) && caught.regions.every(r => r.slots.some(s => s.slot === '(uncovered)' && s.pixel_count === 9)), JSON.stringify({ legacyBaseline: legacy.regions, old: missed, new: caught }));
  const maskPath = join(dir, 'figure.png'), bytes = readFileSync(maskPath);
  const expected = createHash('sha256').update(bytes).digest('hex');
  const failure = (value: SetupPainting, source = painting): readonly Problem[] => {
    try { readSetupFigureMask(value, requirements, source, 48, 80); } catch (e) { if (e instanceof PartsError) return e.problems; throw e; }
    return [];
  };
  const wrongHash = failure({ ...declared, figure_mask: { path: 'figure.png', sha256: '0'.repeat(64) } });
  const wrongGrid = failure(declared, newRaster(24, 40));
  say('ZO44_MASK_HASH_AND_GRID_EXACT_REFUSALS', wrongHash.length === 1 && wrongHash[0].code === 'CHECK_SETUP_PAINTING_MASK' && wrongHash[0].object === 'setup_painting.figure_mask' && wrongHash[0].detail === `PNG "figure.png" has sha256 ${expected}; requires declared ${'0'.repeat(64)}` && wrongGrid.length === 1 && wrongGrid[0].code === 'CHECK_SETUP_PAINTING_MASK' && wrongGrid[0].detail === 'PNG "figure.png" is 48x80; requires the original source painting grid 24x40, without fitting', JSON.stringify({ wrongHash, wrongGrid }));
  const invalid = [null, {}, { path: '', sha256: 'x' }, { ...mask, extra: true }];
  say('ZO45_MASK_SHAPE_AND_OMISSION', invalid.every(figure_mask => setupPaintingProblems({ ...declared, figure_mask }, 'setup_painting').length > 0) && readSetupFigureMask(omitted, requirements, null, 48, 80) === undefined && JSON.stringify(run('omitted-again', budgets)) === JSON.stringify(missed), 'malformed declarations refused; omitted keeps shipped predicate and serialized output');
  writePng(maskPath, newRaster(48, 80));
  const empty = failure({ ...declared, figure_mask: { path: 'figure.png', sha256: createHash('sha256').update(readFileSync(maskPath)).digest('hex') } });
  say('ZO46_EMPTY_MASK_REFUSED', empty[0]?.detail === 'PNG "figure.png" has empty alpha support; requires at least one figure pixel', JSON.stringify(empty));
  writeFileSync(maskPath, bytes);
  let builds = 0, early = false;
  writeFileSync(requirements, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [], setup_painting: { ...declared, figure_mask: { path: 'figure.png', sha256: '0'.repeat(64) } } }));
  try { checkStage({ rig: input, source: sourcePath, requirements, out: join(dir, 'refused-mask'), noExtremes: true }, args => { if (args[0] === 'build') builds++; return rigc(args); }, 'fixture-rigc', () => {}); }
  catch (e) { early = e instanceof PartsError && e.problems.some(p => p.code === 'CHECK_SETUP_PAINTING_MASK'); }
  say('ZO47_MASK_REFUSED_BEFORE_BUILD', early && builds === 0, `refused ${early}, build calls ${builds}`);
  const support = readSetupFigureMask(declared, requirements, painting, 24, 40);
  const full = readPng(maskPath);
  say('ZO48_MASK_NEAREST_CENTRE_RESAMPLING', support !== undefined && support.every((v, p) => v === (full.data[((Math.floor(p / 24) * 2 + 1) * 48 + p % 24 * 2 + 1) * 4 + 3] > 0 ? 1 : 0)), '48x80 alpha-support samples at odd source coordinates map to 24x40 without dilation or rendered-alpha union');
}
