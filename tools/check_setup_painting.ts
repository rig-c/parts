/** Independent controls for source-painting setup limits and plan inversions. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeCheckRig, CHECK_PARTS, checkPartRaster } from '../fixtures/checkrig.ts';
import { checkStage, readSource } from '../src/build.ts';
import { checkStatuses, readCheckInputs, type RigcRunner } from '../src/check.ts';
import { PartsError, type Problem } from '../src/errors.ts';
import { readRequirements } from '../src/requirements.ts';
import { alphaComposite } from '../src/raster/composite.ts';
import { newRaster } from '../src/raster/types.ts';
import { writePng } from '../src/raster/png.ts';
import { SETUP_PAINTING_LINE, setupPaintingLine, setupPaintingProblems, type SetupPainting } from '../src/setuppainting.ts';

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
  const run = (name: string, requirement?: string) => checkStage({ rig: input, source: sourcePath, out: join(dir, name), ...(requirement === undefined ? {} : { requirements: requirement }), noExtremes: true }, args => { calls.push([...args]); return rigc(args); }, 'fixture-rigc', () => {});
  const absent = run('absent');
  say('ZO11_NO_FIELD_OMITS_NEW_VERDICT', absent.figures[SETUP_PAINTING_LINE] === undefined && !JSON.stringify(absent.figures).includes(SETUP_PAINTING_LINE), 'existing check output has no new block');
  const clean = run('clean', req('clean-req', real));
  const cleanLine = clean.figures[SETUP_PAINTING_LINE];
  say('ZO12_REAL_SETUP_CLEAN_CONTROL', cleanLine?.status === 'PASS' && cleanLine.regions[0].pixel_count === 0 && checkStatuses(clean.figures)[SETUP_PAINTING_LINE] === 'PASS', JSON.stringify(cleanLine));
  // Change the independent painting, never its rig or parts. The front region
  // is opaque at this centre, RGB [40,120,200] versus [0,0,0].
  source.data.set([0, 0, 0, 255], (40 * 48 + 30) * 4); writePng(sourcePath, source);
  const red = run('defect', req('defect-req', real));
  say('ZO13_REAL_PIPELINE_RED_PRINTS_SOURCE_MISMATCH', red.figures[SETUP_PAINTING_LINE]?.status === 'FAIL' && red.problems.some(p => p.code === 'CHECK_SETUP_MATCHES_PAINTING' && p.object.includes('front')) && !red.figures.PASS, JSON.stringify(red.figures[SETUP_PAINTING_LINE]));
  const skip = run('skip', req('skip-req', { ...real, regions: [{ name: 'figure', box: [0, 0, 48, 80] }] }));
  say('ZO14_REAL_PIPELINE_NO_LIMIT_SKIP', skip.figures[SETUP_PAINTING_LINE]?.status === 'SKIP' && !skip.problems.some(p => p.code === 'CHECK_SETUP_MATCHES_PAINTING'), JSON.stringify(skip.figures[SETUP_PAINTING_LINE]));
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
  say('ZO20_ACTUAL_PIPELINE_HIDDEN_RGB_IGNORED_BEFORE_RESIZE', opaque?.status === 'PASS' && opaque.regions[0].pixel_count === 0 && JSON.stringify(black) === JSON.stringify(opaque) && JSON.stringify(magenta) === JSON.stringify(opaque), JSON.stringify({ opaque, black, magenta }));
  const partial = lines.get('alpha60-black'), expected = lines.get('opaque195');
  say('ZO21_ACTUAL_PIPELINE_COMPOSITES_FRACTIONAL_ALPHA_BEFORE_RESIZE', partial !== undefined && expected !== undefined && JSON.stringify(partial) === JSON.stringify(expected), JSON.stringify({ partial, expected, independentExpected: 'black at alpha60 over white is RGB195; precompose at96x160, then existing Lanczos3 to48x80' }));
}
