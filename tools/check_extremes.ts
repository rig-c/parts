/** Issue #829: generated controls for optional observations, independent of check's bars. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeCheckRig, writeMergedCheckRig } from '../fixtures/checkrig.ts';
import { blankRigcRunClock } from '../fixtures/rigc_run_clock.ts';
import { checkStage } from '../src/build.ts';
import { readFrameSet, retainCheckRender, seamPairRows, type RigcRunner } from '../src/check.ts';
import { diagnosticSegment } from '../src/outputpaths.ts';
import { writePng } from '../src/raster/png.ts';
import { PartsError } from '../src/errors.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
const isExtremes = (args: readonly string[]): boolean => args.includes('--extremes') || args.includes('--extremes-only');
const json = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
const bytes = (path: string, name = ''): string => createHash('sha256').update(blankRigcRunClock(readFileSync(path), name)).digest('hex');
function tree(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).flatMap(e => {
    if (prefix === '' && e.name === 'extremes') return [];
    const name = prefix + e.name;
    return e.isDirectory() ? tree(join(dir, e.name), name + '/') : [name + ':' + bytes(join(dir, e.name), name)];
  });
}

/** Hand-spelled code units and generated sidecars; no renderer or art needed. */
export function runDiagnosticPathChecks(root: string, say: Say): void {
  const vectors: Array<[string, string]> = [
    ['idle', 'idle'], ['wave-2_left', 'wave-2_left'], ['idle@24fps', 'idle@24fps'],
    ['a:turn', '~0061003a007400750072006e'], ['a-turn', 'a-turn'],
    ['A', '~0041'], ['a', 'a'], ['\u00e9', '~00e9'], ['e\u0301', '~00650301'],
    ['~0041', '~007e0030003000340031'], ['CON', '~0043004f004e'], ['con', '~0063006f006e'],
    ['con.txt', '~0063006f006e002e007400780074'], ['lpt1', '~006c007000740031'],
    ['tail.', '~007400610069006c002e'], ['tail ', '~007400610069006c0020'],
    ['.', '~002e'], ['..', '~002e002e'], ['', '~'],
    ['a/b', '~0061002f0062'], ['a\\b', '~0061005c0062'], ['a\u0000', '~00610000'],
    ['<>:"|?*', '~003c003e003a0022007c003f002a'],
    ['\ud800', '~d800'], ['\ufffd', '~fffd'],
  ];
  const actual = vectors.map(([name]) => diagnosticSegment(name));
  say('CK1362_SEGMENTS_MATCH_HAND_COMPUTED_CODE_UNITS', vectors.every(([, want], i) => actual[i] === want),
    JSON.stringify(vectors.map(([name, want], i) => ({ name, want, got: actual[i] }))));
  const fold = (name: string): string => name.normalize('NFD').toLowerCase();
  const unique = (names: string[]): boolean => new Set(names.map(fold)).size === names.length;
  const portable = (name: string): boolean => name.length > 0 && !/[<>:"/\\|?*\u0000-\u001f]/.test(name) &&
    !/[. ]$/.test(name) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
  say('CK1362_CASE_NORMALIZATION_AND_ESCAPE_PREFIX_COLLISIONS_ARE_PLANTED', unique(actual) && actual.every(portable) &&
    !unique(['A', 'a']) && !unique(['\u00e9', 'e\u0301']) && !unique(['a:turn', 'a-turn'].map(n => n.replace(':', '-'))) &&
    !portable('CON') && !portable('tail.') && !portable('tail '),
    `${actual.length} distinct portable segments; identity, normalization and colon replacement lose the planted pairs`);
  const reserved = ['prn', 'aux', 'nul', 'com1', 'com9', 'lpt9', 'con.log', 'com1.log', 'lpt9.log', 'COM\u00b9', 'LPT\u00b2'];
  say('CK1362_DEVICE_EXTENSIONS_AND_CONTROL_CHARACTERS_ARE_ENCODED',
    [...reserved, ...Array.from({ length: 32 }, (_, i) => String.fromCharCode(i))].every(name => diagnosticSegment(name) !== name && portable(diagnosticSegment(name))),
    'device basenames, extensions, superscript devices and every C0 control are outside the literal alphabet');

  const source = join(root, 'source'), target = join(root, 'kept');
  mkdirSync(source, { recursive: true });
  const names = ['idle', 'a:turn', 'A', 'a', '\u00e9', 'e\u0301', '~0041'];
  const wanted = ['idle', '~0061003a007400750072006e', '~0041', 'a', '~00e9', '~00650301', '~007e0030003000340031'];
  const sets = names.map((animation, i) => {
    const dir = 'source-' + i;
    mkdirSync(join(source, dir));
    writePng(join(source, dir, 'f0000.png'), { width: 1, height: 1, data: new Uint8ClampedArray([i, 0, 0, 255]) });
    for (const file of ['extremes.json', 'seam.json', 'folds.json', 'geometry.json']) writeFileSync(join(source, dir, file), JSON.stringify({ animation, marker: i }));
    return { animation, dir, fps: 12, sampled: 1, written: 1, stride: 1, duration: 0 };
  });
  const manifest = { spec: 'rigc-frames/1', viewport: { x: 0, y: 0, width: 1, height: 1, scale: 1, pixelWidth: 1, pixelHeight: 1 }, background: [0, 0, 0, 0], sets };
  writeFileSync(join(source, 'frames.json'), JSON.stringify(manifest));
  retainCheckRender(source, target);
  const kept = json(join(target, 'frames.json')).sets as typeof sets;
  say('CK1362_RETAINED_INDEX_AND_READERS_KEEP_DISTINCT_PUBLIC_NAMES', unique(kept.map(set => set.dir)) && kept.every((set, i) => {
    const reading = readFrameSet(join(target, set.dir));
    return set.dir === wanted[i] && set.animation === names[i] && reading.animation === names[i] && reading.frames[0].image.data[0] === i &&
      ['extremes.json', 'seam.json', 'folds.json', 'geometry.json'].every(file => readFileSync(join(source, sets[i].dir, file), 'utf8') === readFileSync(join(target, set.dir, file), 'utf8'));
  }), JSON.stringify(kept.map(({ animation, dir }) => ({ animation, dir }))));

  const safe = join(root, 'safe'), safeKept = join(root, 'safe-kept');
  mkdirSync(join(safe, 'idle@24fps'), { recursive: true });
  const safeText = JSON.stringify({ ...manifest, sets: [{ ...sets[0], dir: 'idle@24fps', fps: 24 }] });
  writeFileSync(join(safe, 'frames.json'), safeText);
  writeFileSync(join(safe, 'idle@24fps', 'sentinel'), 'unchanged');
  retainCheckRender(safe, safeKept);
  say('CK1362_SAFE_LOWERCASE_RENDER_PRESERVES_PATHS_AND_INDEX_BYTES', readFileSync(join(safeKept, 'frames.json'), 'utf8') === safeText &&
    readFileSync(join(safeKept, 'idle@24fps', 'sentinel'), 'utf8') === 'unchanged', 'safe idle@24fps and its original frames.json bytes retained');

  const invalid = [
    { ...manifest, sets: null },
    { ...manifest, sets: [{ ...sets[0], dir: '../outside' }] },
    { ...manifest, sets: [sets[0], { ...sets[1], animation: 'idle' }] },
  ];
  const refused = invalid.map((value, i) => {
    const home = join(root, 'bad-' + i), kept = join(root, 'bad-kept-' + i);
    mkdirSync(home);
    writeFileSync(join(home, 'frames.json'), JSON.stringify(value));
    try { retainCheckRender(home, kept); }
    catch (error) { return error instanceof PartsError && error.problems[0]?.code === 'FRAMES_SIDECAR' && !existsSync(kept); }
    return false;
  });
  say('CK1362_UNREADABLE_OR_ALIASED_RETAINED_INDEX_IS_REFUSED_BEFORE_COPY', refused.every(Boolean),
    'missing sets, escaping source dir and duplicate retained dir: ' + refused.join(', '));
  const pixel = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) };
  const viewport = { x: 0, y: 0, width: 1, height: 1, scale: 1, pixelWidth: 1, pixelHeight: 1 };
  const seam = { mean: 50, over40: 1, over80: 0, border: null, counted: [0], countedDiff: [50], map: { sx: 1, sy: 1, tx: 0, ty: 0 } };
  const picture = (name: string) => seamPairRows(seam, [{ name, from: 'generated', x: 0, y: 0, image: pixel }], [1, 1], viewport)[0].row;
  const prefixed = picture('a:turn'), plain = picture('a-turn');
  say('CK1362_SEAM_PICTURE_PATH_IS_MAPPED_WITH_SUBJECTS_AND_COUNTS_UNCHANGED',
    prefixed.picture === 'seam/~00300031005f0061003a007400750072006e005f006e006f002d006100720074.png' &&
    plain.picture === 'seam/01_a-turn_no-art.png' && prefixed.parts[0] === 'a:turn' && prefixed.px_over_40 === 1 && plain.px_over_40 === 1,
    JSON.stringify({ prefixed, plain }));
}

export function runExtremesChecks(root: string, say: Say, rigc: RigcRunner): void {
  runDiagnosticPathChecks(join(root, 'portable-paths'), say);
  const input = join(root, 'input');
  writeCheckRig(input);
  const motionPath = join(input, 'motion.json');
  const motion = json(motionPath);
  const anims = motion.animations as Record<string, unknown>;
  anims.wave = anims.idle;
  anims.hold = { duration: 1, loop: true, tracks: [{ bone: 'root', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 1, v: [0] }] }] };
  writeFileSync(motionPath, JSON.stringify(motion));
  const run = (out: string, noExtremes = false, runner: RigcRunner = rigc, home = input) => {
    const calls: string[][] = [], lines: string[] = [], native: boolean[] = [], observationFiles: string[][] = [];
    const files = (dir: string, prefix = ''): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name), prefix + e.name + '/') : [prefix + e.name]);
    const tap: RigcRunner = args => {
      calls.push([...args]);
      const result = runner(args);
      if (isExtremes(args) && result.status === 0) {
        const grid = json(args[args.indexOf('--viewport-from') + 1]);
        native.push((grid.viewport as Record<string, unknown>).scale === 1);
        observationFiles.push(files(args[args.indexOf('--out') + 1]));
      }
      return result;
    };
    const report = checkStage({ rig: home, out, noExtremes }, tap, 'fixture-rigc', line => lines.push(line));
    return { report, calls, lines, native, observationFiles };
  };
  const onDir = join(root, 'on'), offDir = join(root, 'off');
  const on = run(onDir), off = run(offDir, true);
  say('CK839_EXTREMES_ONLY_OMITS_DISCARDED_RENDER_OUTPUTS', on.calls.filter(isExtremes).length === 3 && on.calls.filter(isExtremes).every(args => args.includes('--extremes-only') && !args.includes('--extremes')) && on.observationFiles.length === 3 && on.observationFiles.every(files => files.length > 0 && files.every(file => /(^|\/)extremes\.(json|png)$/.test(file))), JSON.stringify(on.observationFiles));
  const paths = ['idle', 'wave'].map(name => join(onDir, 'extremes', name));
  const pairs = paths.map(dir => existsSync(join(dir, 'extremes.json')) ? json(join(dir, 'extremes.json')).geometryPair : null);
  const exact = pairs.every(pair => {
    const p = pair as { frames?: Array<{ index: number }>; maxVertexDistance?: number } | null;
    return p?.frames?.map(f => f.index).join(',') === '0,6' && p.maxVertexDistance === 2;
  });
  say('CK829_DEFAULT_EVERY_ANIMATION_NATIVE_AND_HAND_DERIVED_PAIR', paths.every(dir => existsSync(join(dir, 'extremes.png'))) && exact && on.native.length === 3 && on.native.every(Boolean), JSON.stringify({ pairs, native: on.native }));
  const holdPath = join(onDir, 'extremes', 'hold', 'extremes.json');
  const hold = existsSync(holdPath) ? json(holdPath) : null;
  say('CK830_CORE_STATIC_SKIP_IS_NAMED_AND_HAS_NO_SHEET', hold?.status === 'SKIP' && !existsSync(join(onDir, 'extremes', 'hold', 'extremes.png')) && on.lines.some(l => l.includes('EXTREMES "hold" SKIP:')), JSON.stringify({ status: hold?.status, reason: hold?.reason }));
  const renders = (calls: string[][]) => calls.filter(args => args[0] === 'render');
  say('CK831_OPT_OUT_ADDS_NO_RENDER_OR_DIRECTORY_AND_PRESERVES_BYTES', !existsSync(join(offDir, 'extremes')) && !off.calls.some(args => isExtremes(args)) && renders(on.calls).length === renders(off.calls).length + 3 && tree(onDir).join('|') === tree(offDir).join('|') && on.report.figures.PASS === off.report.figures.PASS, JSON.stringify({ on: renders(on.calls).length, off: renders(off.calls).length, same: tree(onDir).join('|') === tree(offDir).join('|') }));
  mkdirSync(join(offDir, 'extremes'), { recursive: true });
  writeFileSync(join(offDir, 'extremes', 'stale.png'), 'stale');
  writeFileSync(join(offDir, 'sentinel'), 'keep');
  run(offDir, true);
  say('CK832_OPT_OUT_REMOVES_STALE_EXTREMES_ONLY', !existsSync(join(offDir, 'extremes')) && readFileSync(join(offDir, 'sentinel'), 'utf8') === 'keep', 'reused output: stale diagnostics removed, unrelated sentinel retained');
  const failedDir = join(root, 'gate-red');
  mkdirSync(join(failedDir, 'extremes'), { recursive: true });
  let gateCalls = 0, gateRefused = false;
  try {
    run(failedDir, false, args => {
      if (args[0] === 'render') gateCalls++;
      return args[0] === 'build' ? { status: 1, out: '1 failed\n' } : rigc(args);
    });
  } catch (e) { if (e instanceof PartsError) gateRefused = true; else throw e; }
  say('CK833_FAILED_GATE_RUNS_NO_EXTREMES_AND_LEAVES_NO_STALE_DIAGNOSTICS', gateRefused && gateCalls === 0 && !existsSync(join(failedDir, 'extremes')), JSON.stringify({ gateRefused, gateCalls }));
  const diagDir = join(root, 'diagnostic-red');
  const diag = run(diagDir, false, args => isExtremes(args) ? { status: 17, out: 'fixture render failure' } : rigc(args));
  say('CK834_DIAGNOSTIC_FAILURE_IS_NAMED_WITH_UNCHANGED_VERDICT', bytes(join(diagDir, 'check.json')) === bytes(join(onDir, 'check.json')) && diag.report.figures.PASS === on.report.figures.PASS && diag.lines.some(l => l.includes('EXTREMES') && l.includes('SKIP') && l.includes('17')) && !existsSync(join(diagDir, 'extremes')), diag.lines.filter(l => l.includes('EXTREMES')).join(' | '));
  const namedHome = join(root, 'no-idle');
  writeCheckRig(namedHome);
  const namedMotion = json(join(namedHome, 'motion.json'));
  const namedAnims = namedMotion.animations as Record<string, unknown>;
  namedAnims.wave = namedAnims.idle;
  delete namedAnims.idle;
  writeFileSync(join(namedHome, 'motion.json'), JSON.stringify(namedMotion));
  const namedOut = join(root, 'no-idle-out');
  const named = run(namedOut, false, rigc, namedHome);
  say('CK836_WITHOUT_IDLE_THE_NAMED_ANIMATION_STILL_GETS_NATIVE_EXTREMES', named.native.length === 1 && named.native[0] && existsSync(join(namedOut, 'extremes', 'wave', 'extremes.png')), JSON.stringify({ native: named.native, lines: named.lines.filter(l => l.includes('EXTREMES')) }));
  const renamedOut = join(root, 'core-owned-directory');
  const renamed = run(renamedOut, false, args => {
    const result = rigc(args);
    if (result.status === 0 && (isExtremes(args) || args.includes('--folds'))) {
      const out = args[args.indexOf('--out') + 1];
      mkdirSync(join(out, 'core-owned'), { recursive: true });
      renameSync(join(out, 'wave'), join(out, 'core-owned', 'nested set'));
      if (!isExtremes(args)) {
        const sidecar = json(join(out, 'frames.json'));
        const sets = sidecar.sets as Array<{ animation: string; dir: string }>;
        const wave = sets.find(row => row.animation === 'wave');
        if (wave === undefined) throw new Error('fixture ordinary render has no wave set');
        wave.dir = 'core-owned/nested set';
        writeFileSync(join(out, 'frames.json'), JSON.stringify(sidecar));
      }
    }
    return result;
  }, namedHome);
  say('CK840_EXISTING_METADATA_OWNS_DIRECTORY_WITHOUT_A_NEW_FRAME_SIDECAR', existsSync(join(renamedOut, 'extremes', 'wave', 'extremes.png')) && !existsSync(join(renamedOut, 'extremes', 'core-owned')) && !renamed.lines.some(line => line.includes('CHECK_EXTREMES_RENDER_FAILED')), renamed.lines.filter(line => line.includes('EXTREMES')).join(' | '));
  const prefixedHome = join(root, 'prefixed');
  writeCheckRig(prefixedHome);
  const prefixedMotion = json(join(prefixedHome, 'motion.json'));
  const prefixedAnims = prefixedMotion.animations as Record<string, unknown>;
  prefixedAnims['a:turn'] = prefixedAnims.idle;
  delete prefixedAnims.idle;
  writeFileSync(join(prefixedHome, 'motion.json'), JSON.stringify(prefixedMotion));
  const prefixedOut = join(root, 'prefixed-out');
  const prefixed = run(prefixedOut, false, rigc, prefixedHome);
  const prefixedDir = join(prefixedOut, 'extremes', '~0061003a007400750072006e');
  say('CK1362_PREFIXED_ANIMATION_RETAINS_ORIGINAL_NAME_IN_EXTREMES', existsSync(join(prefixedDir, 'extremes.png')) &&
    json(join(prefixedDir, 'extremes.json')).animation === 'a:turn' && !existsSync(join(prefixedOut, 'extremes', 'a:turn')) &&
    prefixed.lines.some(line => line.includes('EXTREMES "a:turn"')),
    prefixed.lines.filter(line => line.includes('EXTREMES')).join(' | '));
  for (const defect of ['missing', 'wrong-animation'] as const) {
    const badOut = join(root, 'observation-' + defect);
    const bad = run(badOut, false, args => {
      const result = rigc(args);
      if (isExtremes(args) && result.status === 0) {
        const out = args[args.indexOf('--out') + 1], observation = join(out, 'wave');
        if (defect === 'missing') rmSync(observation, { recursive: true });
        else writeFileSync(join(observation, 'extremes.json'), JSON.stringify({ ...json(join(observation, 'extremes.json')), animation: 'another' }));
      }
      return result;
    }, namedHome);
    say('CK841_INCOMPLETE_OBSERVATION_' + defect.toUpperCase().replace('-', '_'), !existsSync(join(badOut, 'extremes')) && bytes(join(badOut, 'check.json')) === bytes(join(namedOut, 'check.json')) && bad.lines.some(line => line.includes('CHECK_EXTREMES_RENDER_FAILED')), bad.lines.filter(line => line.includes('EXTREMES')).join(' | '));
  }
  const staticHome = join(root, 'no-animations');
  writeMergedCheckRig(staticHome, { idle: false, plate: true });
  const none = run(join(root, 'no-animations-out'), false, rigc, staticHome);
  say('CK835_NO_ANIMATION_IS_NAMED_WITH_NO_EXTRA_RENDER', !none.calls.some(args => isExtremes(args)) && none.lines.some(l => l.includes('EXTREMES') && l.includes('SKIP') && l.includes('no animation')), none.lines.filter(l => l.includes('EXTREMES')).join(' | '));
}
