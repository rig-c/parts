/** Planted controls for the boundary colour-step bar against the rig's own pieces (#942). */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { CHECK_PARTS, writeCheckRig } from '../fixtures/checkrig.ts';
import { checkStage } from '../src/build.ts';
import { BOUNDARY_COLOUR_CODE, BOUNDARY_COLOUR_LINE, BOUNDARY_COLOUR_UNMEASURED_CODE, boundaryColourProblems } from '../src/boundarycolour.ts';
import { checkStatuses, type RigcRunner } from '../src/check.ts';
import { PartsError, type Problem } from '../src/errors.ts';
import { readRequirements } from '../src/requirements.ts';
import { writePng } from '../src/raster/png.ts';
import { resize } from '../src/raster/resize.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';

type Say = (name: string, pass: boolean, detail: string) => void;

/**
 * The fixture's front part redrawn as inked art: an opaque ellipse, a 2 px dark outline, a vertical fill gradient.
 * The stock fixture part fades over a third of its radius, which a 2 px shrink barely moves; real parts carry line
 * art at their edge, and that is what a texture stretched into its padded UVs pulls off the boundary.
 */
export function inkedFront(): Raster {
  const p = CHECK_PARTS[1];
  const r = newRaster(p.w, p.h);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const u = (2 * x + 1 - p.w) / p.w, v = (2 * y + 1 - p.h) / p.h;
    const edge = (1 - Math.sqrt(u * u + v * v)) * Math.min(p.w, p.h) / 2;
    if (edge <= 0) continue;
    r.data.set(edge < 2.5 ? [20, 20, 30, 255] : [40, 90 + Math.round((60 * y) / p.h), 200, 255], (y * p.w + x) * 4);
  }
  return r;
}

/** Plant (a): the image's content shrunk 2 px on every side inside its own box, the rim transparent — art no longer where its UVs say. */
export function stretchedIntoPadding(img: Raster): Raster {
  const small = resize(img, img.width - 4, img.height - 4, 'lanczos3');
  const out = newRaster(img.width, img.height);
  for (let y = 0; y < small.height; y++) for (let x = 0; x < small.width; x++) out.data.set(small.data.subarray((y * small.width + x) * 4, (y * small.width + x) * 4 + 4), ((y + 2) * out.width + x + 2) * 4);
  return out;
}

/** Plant (b): a 4x4 transparent notch at image (x0, y0), where the front part overlies the back one. */
export function notched(img: Raster, x0 = 3, y0 = 18): Raster {
  const out = { ...img, data: new Uint8ClampedArray(img.data) };
  for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) out.data[(y * out.width + x) * 4 + 3] = 0;
  return out;
}

export function runBoundaryColourChecks(dir: string, say: Say, rigc: RigcRunner): void {
  mkdirSync(dir, { recursive: true });
  const req = (name: string, value?: unknown): string => {
    const path = join(dir, `${name}.json`);
    writeFileSync(path, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [], ...(value === undefined ? {} : { boundary_colour: value }) }));
    return path;
  };
  // 1. The declaration's shape: one authored integer, no default.
  const invalid: unknown[] = [{}, { max_step_excess: -1 }, { max_step_excess: 256 }, { max_step_excess: 1.5 }, { max_step_excess: '8' }, { max_step_excess: 8, surprise: 1 }, 8, null];
  say('BK01_INVALID_DECLARATIONS_ARE_NAMED_FIELD_FAILURES', invalid.every((v) => { const p = boundaryColourProblems(v, 'boundary_colour'); return p.length > 0 && p.every((q) => q.code === 'REQUIREMENTS_FIELD'); }) && boundaryColourProblems({ max_step_excess: 0, note: 'why' }, 'boundary_colour').length === 0,
    `${invalid.length} planted invalid declarations each refused as REQUIREMENTS_FIELD; {max_step_excess: 0, note} accepted`);
  let readerRefused = false;
  try { readRequirements(req('invalid', { max_step_excess: 300 })); } catch (e) { readerRefused = e instanceof PartsError && e.problems.some((p) => p.code === 'REQUIREMENTS_FIELD' && p.object.endsWith('boundary_colour.max_step_excess')); }
  say('BK02_REAL_REQUIREMENTS_READER_IS_ADDITIVE', readerRefused && readRequirements(req('absent')).boundary_colour === undefined && readRequirements(req('present', { max_step_excess: 8 })).boundary_colour?.max_step_excess === 8,
    'absent key omitted, a declared one read as written, an out-of-range one refused by field');

  // 2. The real pipeline: checkStage on the generated rig, its front part inked; parts/ and images/ written alike.
  const rigFor = (name: string, image?: Raster): string => {
    const input = join(dir, name, 'input');
    rmSync(input, { recursive: true, force: true });
    writeCheckRig(input);
    writePng(join(input, 'parts', 'front.png'), inkedFront());
    writePng(join(input, 'images', 'front.png'), image ?? inkedFront());
    return input;
  };
  const logs = new Map<string, string[]>();
  const run = (name: string, input: string, requirement?: string) => {
    const lines: string[] = [];
    logs.set(name, lines);
    return checkStage({ rig: input, out: join(dir, name, 'out'), ...(requirement === undefined ? {} : { requirements: requirement }), noExtremes: true }, rigc, 'fixture-rigc', (line) => lines.push(line));
  };
  const ALLOW = 8;
  const declared = req('declared', { max_step_excess: ALLOW });
  const cleanRig = rigFor('clean');
  const undeclared = run('undeclared', cleanRig);
  const skipLines = (logs.get('undeclared') ?? []).filter((l) => l.includes(`${BOUNDARY_COLOUR_LINE}: SKIP — not measured, not a pass`) && l.includes('boundary_colour') && l.includes('max_step_excess'));
  const undeclaredJson = readFileSync(join(dir, 'undeclared', 'out', 'check.json'), 'utf8');
  say('BK03_UNDECLARED_WRITES_NOTHING_AND_PRINTS_SKIP', undeclared.figures.PASS && undeclared.figures[BOUNDARY_COLOUR_LINE] === undefined && !undeclaredJson.includes(BOUNDARY_COLOUR_LINE) && !undeclared.bars.measured.includes(BOUNDARY_COLOUR_LINE) && !undeclared.bars.skipped.some((b) => b.bar === BOUNDARY_COLOUR_LINE) && skipLines.length === 1 && undeclared.boundaryColour === null,
    JSON.stringify({ pass: undeclared.figures.PASS, key: undeclaredJson.includes(BOUNDARY_COLOUR_LINE), skip: skipLines.map((l) => l.slice(0, 80)) }));
  const empty = run('empty', cleanRig, req('empty'));
  say('BK04_A_REQUIREMENTS_FILE_WITHOUT_THE_KEY_IS_UNDECLARED', empty.figures.PASS && empty.figures[BOUNDARY_COLOUR_LINE] === undefined && (logs.get('empty') ?? []).some((l) => l.includes(`${BOUNDARY_COLOUR_LINE}: SKIP`)), 'the same SKIP, no key');
  const clean = run('declared-clean', cleanRig, declared);
  const cl = clean.figures[BOUNDARY_COLOUR_LINE];
  say('BK05_PUBLIC_SHAPE_CLEAN_CONTROL_PASSES_UNDER_THE_DECLARED_ALLOWANCE', clean.figures.PASS && cl?.status === 'PASS' && cl.over.length === 0 && cl.unmeasured.length === 0 && cl.frames > 1 && cl.boundary_pairs > 0 && (cl.worst?.excess ?? 0) <= ALLOW && checkStatuses(clean.figures)[BOUNDARY_COLOUR_LINE] === 'PASS' && clean.bars.measured.includes(BOUNDARY_COLOUR_LINE) && (logs.get('declared-clean') ?? []).some((l) => l.includes(`${BOUNDARY_COLOUR_LINE}: PASS`)),
    JSON.stringify({ status: cl?.status, frames: cl?.frames, pairs: cl?.boundary_pairs, worst: cl?.worst ?? null }));
  const refusal = (r: ReturnType<typeof run>): Problem[] => r.problems.filter((p) => p.code === BOUNDARY_COLOUR_CODE);
  const named = (ps: Problem[]): boolean => ps.length > 0 && ps.every((p) => p.object === 'part pair "back|front"' && /^(setup|idle frame \d+ \(t [\d.]+ s\)), stage pixel \(\d+, \d+\): step excess \d+ > declared max_step_excess 8 \(rendered step \d+, the rig's own pieces \d+\)/.test(p.detail));
  const stretched = run('stretch', rigFor('stretch', stretchedIntoPadding(inkedFront())), declared);
  const sl = stretched.figures[BOUNDARY_COLOUR_LINE];
  say('BK06_PLANT_A_STRETCH_INTO_PADDING_REFUSED_BY_NAME', !stretched.figures.PASS && sl?.status === 'FAIL' && named(refusal(stretched)) && (sl.worst?.excess ?? 0) > ALLOW,
    JSON.stringify(refusal(stretched).map((p) => `${p.object}: ${p.detail.slice(0, 110)}`)));
  const notchRig = rigFor('notch', notched(inkedFront()));
  const notch = run('notch', notchRig, declared);
  const nl = notch.figures[BOUNDARY_COLOUR_LINE];
  say('BK07_PLANT_B_CORNER_NOTCH_REFUSED_BY_NAME', !notch.figures.PASS && nl?.status === 'FAIL' && named(refusal(notch)) && refusal(notch).every((p) => p.code === BOUNDARY_COLOUR_CODE) && (nl.worst?.excess ?? 0) > ALLOW,
    JSON.stringify(refusal(notch).map((p) => `${p.object}: ${p.detail.slice(0, 110)}`)));
  // The bar is inclusive and is the declared number, nothing else: at the found value the notch passes, one under it fails.
  const found = nl?.worst?.excess ?? -1;
  const atFound = run('notch-at', notchRig, req('at', { max_step_excess: found }));
  const below = run('notch-below', notchRig, req('below', { max_step_excess: found - 1 }));
  say('BK08_THE_ALLOWANCE_IS_INCLUSIVE_AND_ONLY_THE_DECLARED_NUMBER', found > 0 && atFound.figures[BOUNDARY_COLOUR_LINE]?.status === 'PASS' && below.figures[BOUNDARY_COLOUR_LINE]?.status === 'FAIL' && refusal(below).every((p) => p.detail.includes(`declared max_step_excess ${found - 1}`)),
    `found ${found}: allowance ${found} -> ${atFound.figures[BOUNDARY_COLOUR_LINE]?.status}, ${found - 1} -> ${below.figures[BOUNDARY_COLOUR_LINE]?.status}`);
  const again = run('notch-again', notchRig, declared);
  say('BK09_DETERMINISTIC', JSON.stringify(again.figures[BOUNDARY_COLOUR_LINE]) === JSON.stringify(nl) && JSON.stringify(refusal(again)) === JSON.stringify(refusal(notch)), 'the same rig read twice: the same line and refusals, byte for byte');

  // 3. A declared reading that cannot be taken is refused by name before the build, never a pass.
  const early = (name: string, input: string): { codes: string[]; builds: number } => {
    let builds = 0;
    try { checkStage({ rig: input, out: join(dir, name, 'out'), requirements: declared, noExtremes: true }, (args) => { if (args[0] === 'build') builds++; return rigc(args); }, 'fixture-rigc', () => {}); }
    catch (e) { if (e instanceof PartsError) return { codes: e.problems.map((p) => p.code), builds }; throw e; }
    return { codes: [], builds };
  };
  const noIdleRig = rigFor('no-idle');
  const motionPath = join(noIdleRig, 'motion.json');
  const motion = JSON.parse(readFileSync(motionPath, 'utf8')) as { animations: Record<string, unknown> };
  motion.animations = { sway: motion.animations.idle };
  writeFileSync(motionPath, JSON.stringify(motion));
  const noIdle = early('no-idle', noIdleRig);
  const noPartsRig = rigFor('no-parts');
  rmSync(join(noPartsRig, 'parts.json'));
  const noParts = early('no-parts', noPartsRig);
  say('BK10_UNMEASURABLE_IS_REFUSED_BY_NAME_BEFORE_THE_BUILD', noIdle.codes.includes(BOUNDARY_COLOUR_UNMEASURED_CODE) && noIdle.builds === 0 && noParts.codes.includes(BOUNDARY_COLOUR_UNMEASURED_CODE) && noParts.builds === 0,
    JSON.stringify({ noIdle, noParts }));
  // A drawn piece whose rig image is not its parts image with one even pad cannot be read against it: refused by slot.
  const oddRig = rigFor('odd-pad');
  const odd = newRaster(CHECK_PARTS[1].w + 1, CHECK_PARTS[1].h + 1);
  const ink = inkedFront();
  for (let y = 0; y < ink.height; y++) for (let x = 0; x < ink.width; x++) odd.data.set(ink.data.subarray((y * ink.width + x) * 4, (y * ink.width + x) * 4 + 4), (y * odd.width + x) * 4);
  writePng(join(oddRig, 'images', 'front.png'), odd);
  let oddCodes: Problem[] = [];
  try { oddCodes = run('odd-pad', oddRig, declared).problems.filter((p) => p.code === BOUNDARY_COLOUR_UNMEASURED_CODE); } catch (e) { if (e instanceof PartsError) oddCodes = e.problems.filter((p) => p.code === BOUNDARY_COLOUR_UNMEASURED_CODE); else throw e; }
  say('BK11_AN_UNREADABLE_PIECE_IS_NEVER_A_PASS', oddCodes.length === 1 && oddCodes[0].object.startsWith('slot "front"') && oddCodes[0].detail.includes('one even pad'), JSON.stringify(oddCodes));

  // 4. The CLI: undeclared exits 0 with the SKIP line; a declared plant exits 1 naming the pair.
  const cli = (name: string, input: string, requirement?: string) => spawnSync(process.execPath, [resolve(import.meta.dir, '../cli.ts'), 'check', '--rig', input, '--out', join(dir, name, 'cli'), '--no-extremes', ...(requirement === undefined ? [] : ['--requirements', requirement])], { encoding: 'utf8' });
  const cliClean = cli('cli-undeclared', cleanRig);
  const cliNotch = cli('cli-notch', notchRig, declared);
  say('BK12_CLI_UNDECLARED_EXIT_0_WITH_SKIP_AND_PLANT_EXIT_1_BY_NAME', cliClean.status === 0 && cliClean.stdout.includes(`${BOUNDARY_COLOUR_LINE}: SKIP`) && cliNotch.status === 1 && cliNotch.stdout.split('\n').some((l) => l.includes(`FAIL  ${BOUNDARY_COLOUR_CODE}: part pair "back|front"`)),
    JSON.stringify({ undeclared: cliClean.status, notch: cliNotch.status, lines: cliNotch.stdout.split('\n').filter((l) => l.includes(BOUNDARY_COLOUR_CODE)).map((l) => l.slice(0, 100)) }));
}
