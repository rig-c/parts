/**
 * Planted controls for the source-exposure reading (#1473): a part's recorded-hidden and undecided texels that a
 * pose shows, read on the gated build through rig-c's renderer.
 *
 * The fixture is hand-countable. A 40x40 canvas holds two 20x20 boxes, each opaque inside a 1 px transparent rim
 * (18x18 = 324 texels): `back` at crop (4, 4) on `root`, `front` at crop (14, 4) on a bone `front` the idle moves
 * 4 px right at t = 0.5 s and back. In the setup pose the front's opaque columns (crop x 15-32) cover the back's
 * crop x 15-22, back-local x 11-18. The back's map records local x 11 as partial-top (18 texels), x 12-18 as
 * occluded (126) and the rest as visible (180). At idle frame 6 (t = 0.5 s at 12 fps) the front's opaque columns
 * are crop x 19-36, so back-local x 11-14 show: partial-top 18 px, occluded 3 x 18 = 54 px. In the setup pose
 * nothing recorded hidden shows. The front part carries no record, so it has no map and is never read.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { checkStage } from '../src/build.ts';
import { checkStatuses, type RigcRunner } from '../src/check.ts';
import { cropToSpineY } from '../src/coords.ts';
import { PartsError, type Problem } from '../src/errors.ts';
import { readParts, serializeParts, type PartsFile } from '../src/parts.ts';
import { readRequirements } from '../src/requirements.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { SOURCE_EXPOSURE_CODE, SOURCE_EXPOSURE_LINE, SOURCE_EXPOSURE_UNMEASURED_CODE, sourceExposureProblems } from '../src/sourceexposure.ts';
import { encodeSourceStateMap, SOURCE_STATE, sourceStateCounts, sourceStateMapImage } from '../src/sourcestates.ts';

type Say = (name: string, pass: boolean, detail: string) => void;

const W = 40, H = 40;
const BOX = 20;
const BACK: { name: string; x: number; y: number; rgb: readonly [number, number, number] } = { name: 'back', x: 4, y: 4, rgb: [200, 60, 40] };
const FRONT: typeof BACK = { name: 'front', x: 14, y: 4, rgb: [40, 90, 200] };
/** The idle's peak `translatex` on the front bone, at t = 0.5 s. */
export const SOURCE_EXPOSURE_PEAK = 4;

function box(rgb: readonly [number, number, number]): Raster {
  const r = newRaster(BOX, BOX);
  for (let y = 1; y < BOX - 1; y++) for (let x = 1; x < BOX - 1; x++) r.data.set([rgb[0], rgb[1], rgb[2], 255], (y * BOX + x) * 4);
  return r;
}

/** The back part's codes: local x 11 partial-top, 12-18 occluded, the rest of the interior visible. */
export function backStateCodes(): Uint8Array {
  const codes = new Uint8Array(BOX * BOX);
  for (let y = 1; y < BOX - 1; y++) for (let x = 1; x < BOX - 1; x++) {
    codes[y * BOX + x] = x === 11 ? SOURCE_STATE['partial-top'] : x >= 12 ? SOURCE_STATE.occluded : SOURCE_STATE.visible;
  }
  return codes;
}

export interface ExposureRigOptions {
  /** Write the back part's map and record; false writes the same rig with no map. */
  map?: boolean;
  /** Replace the map's codes before it is hashed (the record's counts stay the true ones). */
  codes?: Uint8Array;
}

/** The rig directory `check --rig` reads: rig.json, motion.json, parts.json, images/ and parts/. */
export function writeSourceExposureRig(dir: string, opts: ExposureRigOptions = {}): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'images'), { recursive: true });
  mkdirSync(join(dir, 'parts'), { recursive: true });
  for (const p of [BACK, FRONT]) {
    const bytes = encodePngBytes(box(p.rgb));
    writeFileSync(join(dir, 'images', `${p.name}.png`), bytes);
    writeFileSync(join(dir, 'parts', `${p.name}.png`), bytes);
  }
  const stage = { x: -W / 2, y: 0, width: W, height: H };
  const centre = (p: { x: number; y: number }): { x: number; y: number } => ({ x: stage.x + p.x + BOX / 2, y: stage.y + cropToSpineY(p.y + BOX / 2, H) });
  const rig = {
    spec: 'rigc-rig/1',
    name: 'source_exposure_probe',
    images: 'images',
    skeleton: stage,
    bones: [{ name: 'root', x: 0, y: 0 }, { name: 'front', parent: 'root', x: 0, y: 0 }],
    slots: [{ name: 'back', bone: 'root', attachment: 'back' }, { name: 'front', bone: 'front', attachment: 'front' }],
    skins: { default: { back: { back: { image: 'back.png', ...centre(BACK) } }, front: { front: { image: 'front.png', ...centre(FRONT) } } } },
  };
  writeFileSync(join(dir, 'rig.json'), `${JSON.stringify(rig, null, 2)}\n`);
  const motion = {
    spec: 'rigc-motion/1',
    archetype: 'source_exposure_probe',
    cut: 'source_exposure_probe',
    easings: {},
    groups: {},
    animations: { idle: { duration: 1, loop: true, tracks: [{ bone: 'front', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [SOURCE_EXPOSURE_PEAK] }, { t: 1, v: [0] }] }] } },
  };
  writeFileSync(join(dir, 'motion.json'), `${JSON.stringify(motion, null, 2)}\n`);
  const codes = backStateCodes();
  const record = (p: typeof BACK, mapped: boolean) => ({
    name: p.name, from: 'full:topwear', x: p.x, y: p.y, w: BOX, h: BOX, opaque_px: (BOX - 2) * (BOX - 2),
    projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0,
    ...(mapped ? { source_visibility: { source_layers: ['full:front', 'full:topwear'], ...sourceStateCounts(codes) } } : {}),
  });
  const parts: PartsFile = { rig_size: [W, H], scale_rig_per_source: 1, parts: [record(BACK, opts.map !== false), record(FRONT, false)], ghost_px: {} };
  if (opts.map !== false) {
    const map = encodeSourceStateMap(opts.codes ?? codes, BOX, BOX);
    writeFileSync(join(dir, 'parts', sourceStateMapImage(BACK.name)), map.bytes);
    parts.parts[0].source_state_map = { image: sourceStateMapImage(BACK.name), sha256: map.sha256 };
  }
  writeFileSync(join(dir, 'parts.json'), serializeParts(parts));
}

export function runSourceExposureChecks(dir: string, say: Say, rigc: RigcRunner): void {
  mkdirSync(dir, { recursive: true });
  const req = (name: string, value?: unknown): string => {
    const path = join(dir, `${name}.json`);
    writeFileSync(path, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [], ...(value === undefined ? {} : { source_exposure: value }) }));
    return path;
  };
  // 1. The declaration's shape: one authored integer, no default.
  const invalid: unknown[] = [{}, { max_px: -1 }, { max_px: 1.5 }, { max_px: '8' }, { max_px: 8, surprise: 1 }, 8, null];
  say('SX01_INVALID_DECLARATIONS_ARE_NAMED_FIELD_FAILURES', invalid.every(v => { const p = sourceExposureProblems(v, 'source_exposure'); return p.length > 0 && p.every(q => q.code === 'REQUIREMENTS_FIELD'); }) && sourceExposureProblems({ max_px: 0, note: 'why' }, 'source_exposure').length === 0,
    `${invalid.length} planted invalid declarations each refused as REQUIREMENTS_FIELD; {max_px: 0, note} accepted`);
  let readerRefused = false;
  try { readRequirements(req('invalid', { max_px: -3 })); } catch (e) { readerRefused = e instanceof PartsError && e.problems.some(p => p.code === 'REQUIREMENTS_FIELD' && p.object.endsWith('source_exposure.max_px')); }
  say('SX02_REQUIREMENTS_READER_IS_ADDITIVE', readerRefused && readRequirements(req('absent')).source_exposure === undefined && readRequirements(req('present', { max_px: 5 })).source_exposure?.max_px === 5,
    'absent key omitted, a declared one read as written, a negative one refused by field');

  // 2. The real pipeline on the hand-counted rig.
  const logs = new Map<string, string[]>();
  const run = (name: string, input: string, requirement?: string) => {
    const lines: string[] = [];
    logs.set(name, lines);
    return checkStage({ rig: input, out: join(dir, name, 'out'), ...(requirement === undefined ? {} : { requirements: requirement }), noExtremes: true }, rigc, 'fixture-rigc', line => lines.push(line));
  };
  const mapped = join(dir, 'mapped', 'input');
  writeSourceExposureRig(mapped);
  const reported = run('mapped', mapped);
  const line = reported.figures[SOURCE_EXPOSURE_LINE];
  const rows = line?.rows ?? [];
  const setupRows = rows.filter(r => r.animation === null);
  const peak = rows.filter(r => r.animation === 'idle' && r.index === 6).map(r => `${r.part}:${r.state}:${r.px}`).sort();
  say('SX03_SETUP_POSE_SHOWS_NOTHING_RECORDED_HIDDEN', line !== undefined && setupRows.length === 0 && JSON.stringify(line.parts) === JSON.stringify(['back']) && JSON.stringify(line.texels) === JSON.stringify({ back: { occluded: 126, 'partial-top': 18, 'depth-tie': 0, 'mixed-source-states': 0 } }),
    JSON.stringify({ setup: setupRows, texels: line?.texels }));
  say('SX04_THE_MOVED_FRAME_NAMES_PART_STATE_TEXELS_AND_FRAME', JSON.stringify(peak) === JSON.stringify(['back:occluded:54', 'back:partial-top:18']) && rows.some(r => r.frame === 'idle frame 6 (t 0.5 s)' && r.part === 'back' && r.state === 'occluded' && r.px === 54) && rows.every(r => r.part === 'back' && r.px <= 54),
    JSON.stringify({ peak, rows: rows.length, frames: line?.frames }));
  const printed = logs.get('mapped') ?? [];
  say('SX05_WITHOUT_A_LIMIT_IT_IS_REPORTED_NEVER_A_PASS', reported.figures.PASS && line?.status === 'REPORTED' && line.max_px === null && checkStatuses(reported.figures)[SOURCE_EXPOSURE_LINE] === 'REPORTED' && !reported.bars.measured.includes(SOURCE_EXPOSURE_LINE) && reported.problems.every(p => !p.code.startsWith('CHECK_SOURCE_EXPOSURE')) && printed.some(l => l.includes(`${SOURCE_EXPOSURE_LINE}: REPORTED`) && l.includes('never a pass')) && printed.some(l => l.includes('shown part "back" occluded 54 px — idle frame 6 (t 0.5 s)')),
    JSON.stringify({ status: line?.status, lines: printed.filter(l => l.includes('SOURCE_EXPOSURE') || l.includes('shown part')).slice(0, 3).map(l => l.slice(0, 120)) }));

  // 3. A declared limit: inclusive at the worst row, one under it fails by name.
  const at = run('limit-at', mapped, req('at', { max_px: 54 }));
  const below = run('limit-below', mapped, req('below', { max_px: 53 }));
  const refused = below.problems.filter(p => p.code === SOURCE_EXPOSURE_CODE);
  say('SX06_A_DECLARED_LIMIT_IS_PASS_OR_FAIL_BY_NAME', at.figures.PASS && at.figures[SOURCE_EXPOSURE_LINE]?.status === 'PASS' && !below.figures.PASS && below.figures[SOURCE_EXPOSURE_LINE]?.status === 'FAIL' && refused.length === 1 && refused[0].object === 'part "back"' && refused[0].detail.startsWith('shows 54 stage px of occluded source material at idle frame 6 (t 0.5 s); declared max_px 53 is required'),
    JSON.stringify({ at: at.figures[SOURCE_EXPOSURE_LINE]?.status, below: refused.map(p => `${p.object}: ${p.detail.slice(0, 90)}`) }));

  // 4. A map that is not the one assemble bound is refused by name before anything is built.
  const early = (name: string, input: string): { problems: readonly Problem[]; builds: number } => {
    let builds = 0;
    try { checkStage({ rig: input, out: join(dir, name, 'out'), noExtremes: true }, args => { if (args[0] === 'build') builds++; return rigc(args); }, 'fixture-rigc', () => {}); }
    catch (e) { if (e instanceof PartsError) return { problems: e.problems, builds }; throw e; }
    return { problems: [], builds };
  };
  const tampered = join(dir, 'tampered', 'input');
  writeSourceExposureRig(tampered);
  const mapPath = join(tampered, 'parts', sourceStateMapImage('back'));
  const bytes = readFileSync(mapPath);
  writeFileSync(mapPath, encodeSourceStateMap(backStateCodes().map(c => (c === SOURCE_STATE.occluded ? SOURCE_STATE.visible : c)), BOX, BOX).bytes);
  const tamper = early('tampered', tampered);
  say('SX07_A_TAMPERED_MAP_IS_REFUSED_BEFORE_THE_BUILD', bytes.length > 0 && tamper.builds === 0 && tamper.problems.length === 1 && tamper.problems[0].code === 'PARTS_SOURCE_STATE_MAP_SHA256' && tamper.problems[0].object === `part "back" source_state_map (${sourceStateMapImage('back')})`,
    JSON.stringify(tamper));
  const disagree = join(dir, 'disagree', 'input');
  const shifted = backStateCodes().map(c => (c === SOURCE_STATE['partial-top'] ? SOURCE_STATE.occluded : c));
  writeSourceExposureRig(disagree, { codes: shifted });
  const counts = early('disagree', disagree);
  say('SX08_A_MAP_WHOSE_COUNTS_DISAGREE_WITH_THE_RECORD_IS_REFUSED', counts.builds === 0 && counts.problems.length === 1 && counts.problems[0].code === 'PARTS_SOURCE_STATE_MAP_COUNTS' && counts.problems[0].detail.includes('"occluded_px":144') && counts.problems[0].detail.includes('"occluded_px":126'),
    JSON.stringify(counts.problems.map(p => `${p.code}: ${p.detail.slice(0, 120)}`)));
  const absent = join(dir, 'absent', 'input');
  writeSourceExposureRig(absent);
  rmSync(join(absent, 'parts', sourceStateMapImage('back')));
  const gone = early('absent', absent);
  say('SX09_AN_ABSENT_MAP_IS_REFUSED_BY_NAME', gone.builds === 0 && gone.problems.length === 1 && gone.problems[0].code === 'PARTS_SOURCE_STATE_MAP_PRESENT', JSON.stringify(gone.problems.map(p => p.code)));

  // 5. A rig with no map writes no block and prints no line; a declared limit over it is never a pass.
  const bare = join(dir, 'bare', 'input');
  writeSourceExposureRig(bare, { map: false });
  const plain = run('bare', bare);
  const bareJson = readFileSync(join(dir, 'bare', 'out', 'check.json'), 'utf8');
  say('SX10_NO_MAP_WRITES_NO_BLOCK_AND_NO_LINE', plain.figures.PASS && plain.figures[SOURCE_EXPOSURE_LINE] === undefined && !bareJson.includes(SOURCE_EXPOSURE_LINE) && !bareJson.includes('source_state_map') && !(logs.get('bare') ?? []).some(l => l.includes(SOURCE_EXPOSURE_LINE)),
    JSON.stringify({ pass: plain.figures.PASS, block: plain.figures[SOURCE_EXPOSURE_LINE] !== undefined }));
  const bareDeclared = run('bare-declared', bare, req('bare-declared', { max_px: 0 }));
  say('SX11_A_LIMIT_WITH_NO_MAP_IS_UNMEASURED_NEVER_A_PASS', !bareDeclared.figures.PASS && bareDeclared.figures[SOURCE_EXPOSURE_LINE]?.status === 'FAIL' && bareDeclared.problems.some(p => p.code === SOURCE_EXPOSURE_UNMEASURED_CODE && p.object === 'requirements.source_exposure'),
    JSON.stringify(bareDeclared.problems.filter(p => p.code.startsWith('CHECK_SOURCE')).map(p => p.code)));
  const again = run('mapped-again', mapped);
  say('SX12_DETERMINISTIC', JSON.stringify(again.figures[SOURCE_EXPOSURE_LINE]) === JSON.stringify(line), 'the same rig read twice: the same block, byte for byte');
  // parts.json round trip keeps the field.
  say('SX13_PARTS_JSON_ROUND_TRIPS_THE_MAP_FIELD', readParts(join(mapped, 'parts.json')).parts[0].source_state_map?.image === sourceStateMapImage('back') && readParts(join(mapped, 'parts.json')).parts[1].source_state_map === undefined, 'the mapped part keeps {image, sha256}; the unrecorded part has none');

  // 6. The CLI: reported exits 0; a limit under the worst row exits 1 naming the part.
  const cli = (name: string, input: string, requirement?: string) => spawnSync(process.execPath, [resolve(import.meta.dir, '../cli.ts'), 'check', '--rig', input, '--out', join(dir, name, 'cli'), '--no-extremes', ...(requirement === undefined ? [] : ['--requirements', requirement])], { encoding: 'utf8' });
  const cliReported = cli('cli-reported', mapped);
  const cliFail = cli('cli-fail', mapped, req('cli-below', { max_px: 53 }));
  say('SX14_CLI_REPORTED_EXIT_0_AND_LIMIT_EXIT_1_BY_NAME', cliReported.status === 0 && cliReported.stdout.includes(`${SOURCE_EXPOSURE_LINE}: REPORTED`) && cliFail.status === 1 && cliFail.stdout.split('\n').some(l => l.includes(`FAIL  ${SOURCE_EXPOSURE_CODE}: part "back"`)),
    JSON.stringify({ reported: cliReported.status, fail: cliFail.status }));
}
