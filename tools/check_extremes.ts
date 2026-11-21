/** Issue #829: generated controls for optional observations, independent of check's bars. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeCheckRig, writeMergedCheckRig } from '../fixtures/checkrig.ts';
import { blankRigcRunClock } from '../fixtures/rigc_run_clock.ts';
import { checkStage } from '../src/build.ts';
import { measureRequirements, preflightCheckPaths, readCheckInputs, readFrameSet, retainCheckRender, runCheck, seamPairRows, type RigcRunner } from '../src/check.ts';
import { diagnosticSegment, diagnosticSiblings } from '../src/outputpaths.ts';
import { writePng } from '../src/raster/png.ts';
import { PartsError } from '../src/errors.ts';
import { readRequirements } from '../src/requirements.ts';
import { writeRequirements } from '../fixtures/reqrig.ts';

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

/** Independent left-to-right inverse of literal units and five-character escapes. */
function decodeDiagnosticSegment(segment: string): string {
  let name = '';
  for (let i = 0; i < segment.length;) {
    if (segment[i] !== '~') { name += segment[i++]; continue; }
    const hex = segment.slice(i + 1, i + 5);
    if (!/^[0-9a-f]{4}$/.test(hex)) throw new Error('fixture decoder requires a four-digit escape');
    name += String.fromCharCode(parseInt(hex, 16));
    i += 5;
  }
  return name;
}

/** Hand-spelled code units and generated sidecars; no renderer or art needed. */
export function runDiagnosticPathChecks(root: string, say: Say): void {
  const vectors: Array<[string, string]> = [
    ['idle', 'idle'], ['wave-2_left', 'wave-2_left'], ['idle@24fps', 'idle@24fps'],
    ['a:turn', 'a~003aturn'], ['a~003aturn', 'a~007e003aturn'], ['a-turn', 'a-turn'],
    ['A', 'A'], ['a', 'a'], ['\u00e9', '~00e9'], ['e\u0301', 'e~0301'],
    ['~0041', '~007e0041'], ['CON', '~0043ON'], ['con', '~0063on'],
    ['con.txt', '~0063on.txt'], ['lpt1', '~006cpt1'],
    ['tail.', 'tail~002e'], ['tail ', 'tail~0020'],
    ['.', '~002e'], ['..', '.~002e'], ['con.', 'con~002e'],
    ['tail~002e', 'tail~007e002e'], ['~0063on.txt', '~007e0063on.txt'], ['.~002e', '.~007e002e'],
    ['a/b', 'a~002fb'], ['a\\b', 'a~005cb'], ['a\u0000', 'a~0000'],
    ['<>:"|?*', '~003c~003e~003a~0022~007c~003f~002a'],
    ['\ud800', '~d800'], ['\udc00', '~dc00'], ['\ufffd', '~fffd'], ['\ud83d\ude00', '~d83d~de00'],
  ];
  const actual = vectors.map(([name]) => diagnosticSegment(name));
  say('CK1362_SEGMENTS_MATCH_HAND_COMPUTED_CODE_UNITS', vectors.every(([, want], i) => actual[i] === want),
    JSON.stringify(vectors.map(([name, want], i) => ({ name, want, got: actual[i] }))));
  say('CK1362_LEFT_TO_RIGHT_DECODER_ROUNDTRIPS_EVERY_COLLISION_FIXTURE',
    vectors.every(([name], i) => decodeDiagnosticSegment(actual[i]) === name) &&
    decodeDiagnosticSegment(diagnosticSegment('\ud83d\ude00')) === '\ud83d\ude00' &&
    decodeDiagnosticSegment(diagnosticSegment('\udc00')) === '\udc00',
    `${vectors.length} hand-computed names, a surrogate pair and a lone low surrogate recover exact UTF-16 units`);
  say('CK1362_UPPERCASE_REQUIREMENT_NAMES_RETAIN_THEIR_LITERAL_PATHS',
    diagnosticSegment('VANE_HALF') === 'VANE_HALF' && diagnosticSegment('RIDER_HALF') === 'RIDER_HALF',
    'VANE_HALF and RIDER_HALF keep their original released/full folder spelling');
  const refusedName = (name: string, suffix = ''): boolean => {
    try { diagnosticSegment(name, suffix); }
    catch (error) {
      return error instanceof PartsError && error.problems.length === 1 && error.problems[0].code === 'DIAGNOSTIC_PATH_SEGMENT' &&
        error.problems[0].object === `diagnostic name ${JSON.stringify(name)}` &&
        error.problems[0].detail.includes(name.length === 0 ? 'is empty' : 'encodes to 256 characters');
    }
    return false;
  };
  say('CK1362_EMPTY_AND_OVERLONG_NAMES_ARE_NAMED_REFUSALS_WITHOUT_TRUNCATION',
    refusedName('') && refusedName('', '.png') && refusedName('a'.repeat(256)) && refusedName('a'.repeat(251) + ':') &&
    refusedName('a'.repeat(252), '.png') && refusedName('a'.repeat(250), '@24fps') &&
    diagnosticSegment('a'.repeat(255)) === 'a'.repeat(255) &&
    diagnosticSegment('a'.repeat(250) + ':') === 'a'.repeat(250) + '~003a' &&
    diagnosticSegment('a'.repeat(251), '.png') === 'a'.repeat(251) + '.png' &&
    diagnosticSegment('a'.repeat(249), '@24fps') === 'a'.repeat(249) + '@24fps',
    'empty originals refuse even with a suffix; literal, escaped-unit, PNG and fps boundaries accept 255 and refuse 256, naming the original');
  const refusedBeforeRender = ['', 'a'.repeat(251) + ':'].map((name, i) => {
    const home = join(root, 'refused-name-' + i), out = join(root, 'refused-name-out-' + i);
    writeCheckRig(home);
    const motion = json(join(home, 'motion.json'));
    const animations = motion.animations as Record<string, unknown>;
    motion.animations = { [name]: animations.idle };
    writeFileSync(join(home, 'motion.json'), JSON.stringify(motion));
    let calls = 0;
    try { runCheck(home, out, () => { calls++; throw new Error('no renderer may run for a refused diagnostic name'); }); }
    catch (error) {
      return error instanceof PartsError && error.problems[0]?.code === 'DIAGNOSTIC_PATH_SEGMENT' &&
        error.problems[0].object === `diagnostic name ${JSON.stringify(name)}` && calls === 0 && !existsSync(out);
    }
    return false;
  });
  say('CK1362_INVALID_EXTREMES_NAMES_REFUSE_BEFORE_CORE_OR_OUTPUT', refusedBeforeRender.every(Boolean),
    'empty and 256-character encoded names: named refusals, zero core calls, no output directory');
  const fold = (name: string): string => name.normalize('NFD').toLowerCase();
  const unique = (names: string[]): boolean => new Set(names).size === names.length;
  const foldedUnique = (names: string[]): boolean => new Set(names.map(fold)).size === names.length;
  const portable = (name: string): boolean => name.length > 0 && !/[<>:"/\\|?*\u0000-\u001f]/.test(name) &&
    !/[. ]$/.test(name) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
  say('CK1362_CASE_NORMALIZATION_AND_ESCAPE_PREFIX_COLLISIONS_ARE_PLANTED', unique(actual) && actual.every(portable) &&
    !foldedUnique(['A', 'a']) && !foldedUnique(['\u00e9', 'e\u0301']) && !unique(['a:turn', 'a-turn'].map(n => n.replace(':', '-'))) &&
    !portable('CON') && !portable('tail.') && !portable('tail '),
    `${actual.length} case-sensitive distinct portable segments; folded siblings require the named collision preflight`);
  const reserved = ['prn', 'aux', 'nul', 'com1', 'com9', 'lpt9', 'con.log', 'com1.log', 'lpt9.log', 'COM\u00b9', 'LPT\u00b2'];
  say('CK1362_DEVICE_EXTENSIONS_AND_CONTROL_CHARACTERS_ARE_ENCODED',
    [...reserved, ...Array.from({ length: 32 }, (_, i) => String.fromCharCode(i))].every(name => diagnosticSegment(name) !== name && portable(diagnosticSegment(name))),
    'device basenames and extensions force an escape; superscript devices and every C0 control contain an unsafe unit');

  const source = join(root, 'source'), target = join(root, 'kept');
  mkdirSync(source, { recursive: true });
  const names = ['idle', 'a:turn', 'A', 'b', '\u00e9', 'e\u0301', '~0041'];
  const sets = names.map((animation, i) => {
    const dir = 'source-' + i;
    mkdirSync(join(source, dir));
    writePng(join(source, dir, 'f0000.png'), { width: 1, height: 1, data: new Uint8ClampedArray([i, 0, 0, 255]) });
    for (const file of ['extremes.json', 'seam.json', 'folds.json', 'geometry.json']) writeFileSync(join(source, dir, file), JSON.stringify({ animation, marker: i }));
    return { animation, dir, fps: 12, sampled: 1, written: 1, stride: 1, duration: 0 };
  });
  const manifest = { spec: 'rigc-frames/1', viewport: { x: 0, y: 0, width: 1, height: 1, scale: 1, pixelWidth: 1, pixelHeight: 1 }, background: [0, 0, 0, 0], sets };
  writeFileSync(join(source, 'frames.json'), JSON.stringify(manifest));
  writeFileSync(join(source, 'fixed~root.json'), '{ "protocol": "verbatim" }\n');
  retainCheckRender(source, target);
  say('CK1362_FIXED_ROOT_SIDECARS_KEEP_PROTOCOL_NAMES_AND_BYTES',
    readFileSync(join(target, 'fixed~root.json'), 'utf8') === readFileSync(join(source, 'fixed~root.json'), 'utf8') &&
    !existsSync(join(target, 'fixed~007eroot.json')),
    'a planted tilde-bearing protocol sidecar is copied verbatim, rather than passed through the diagnostic name mapping');
  const kept = json(join(target, 'frames.json')).sets as typeof sets;
  say('CK1362_RETAINED_INDEX_AND_READERS_KEEP_DISTINCT_PUBLIC_NAMES', unique(kept.map(set => set.dir)) && kept.every((set, i) => {
    const reading = readFrameSet(join(target, set.dir));
    return set.dir === sets[i].dir && set.animation === names[i] && reading.animation === names[i] && reading.frames[0].image.data[0] === i &&
      ['extremes.json', 'seam.json', 'folds.json', 'geometry.json'].every(file => readFileSync(join(source, sets[i].dir, file), 'utf8') === readFileSync(join(target, set.dir, file), 'utf8'));
  }), 'issue #1367: each set keeps the folder its index records, never one rebuilt from its animation: ' + JSON.stringify(kept.map(({ animation, dir }) => ({ animation, dir }))));

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
    { ...manifest, sets: [sets[0], { ...sets[1], dir: sets[0].dir }] },
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
    'missing sets, escaping source dir and a set directory recorded twice: ' + refused.join(', '));
  const pixel = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) };
  const viewport = { x: 0, y: 0, width: 1, height: 1, scale: 1, pixelWidth: 1, pixelHeight: 1 };
  const seam = { mean: 50, over40: 1, over80: 0, border: null, counted: [0], countedDiff: [50], map: { sx: 1, sy: 1, tx: 0, ty: 0 } };
  const picture = (name: string) => seamPairRows(seam, [{ name, from: 'generated', x: 0, y: 0, image: pixel }], [1, 1], viewport)[0].row;
  const prefixed = picture('a:turn'), plain = picture('a-turn');
  say('CK1362_SEAM_PICTURE_PATH_IS_MAPPED_WITH_SUBJECTS_AND_COUNTS_UNCHANGED',
    prefixed.picture === 'seam/01_a~003aturn_no-art.png' &&
    plain.picture === 'seam/01_a-turn_no-art.png' && prefixed.parts[0] === 'a:turn' && prefixed.px_over_40 === 1 && plain.px_over_40 === 1,
    JSON.stringify({ prefixed, plain }));

  const collision = (run: () => unknown, scope: string): boolean => {
    try { run(); }
    catch (error) {
      return error instanceof PartsError && error.problems.length === 1 && error.problems[0].code === 'DIAGNOSTIC_PATH_SEGMENT' &&
        error.problems[0].object === 'diagnostic names "Idle" and "idle"' && error.problems[0].detail.includes('"Idle"') &&
        error.problems[0].detail.includes('"idle"') && error.problems[0].detail.includes('"' + scope + '"');
    }
    return false;
  };
  const scopes = ['extremes', 'retained render sets', 'alternate set folders', 'requirements/as-declared', 'requirements/released', 'requirements/full'];
  say('CK1362_ASCII_CASE_SIBLINGS_REFUSE_BOTH_ORIGINALS_AND_FOLDER_IN_EVERY_SCOPE',
    scopes.every(scope => collision(() => diagnosticSiblings([{ name: 'Idle' }, { name: 'idle' }], scope), scope)) &&
    diagnosticSiblings([{ name: 'Idle' }, { name: 'idle-2' }], 'positive').join(',') === 'Idle,idle-2' &&
    collision(() => preflightCheckPaths(['Idle', 'idle'], [], null), 'extremes') &&
    collision(() => preflightCheckPaths(['Idle', 'idle'], [], null, true), 'retained render sets') &&
    collision(() => preflightCheckPaths([], ['Idle', 'idle'], null), 'alternate set folders'),
    'six sibling scopes reject Idle/idle, naming both originals and their ASCII-case-folded folder; Idle/idle-2 stays literal');

  const aliasHome = join(root, 'alias-input'), aliasOut = join(root, 'alias-out');
  writeCheckRig(aliasHome);
  const aliasMotion = json(join(aliasHome, 'motion.json'));
  const idle = (aliasMotion.animations as Record<string, unknown>).idle;
  aliasMotion.animations = { Idle: idle, idle };
  writeFileSync(join(aliasHome, 'motion.json'), JSON.stringify(aliasMotion));
  let aliasCalls = 0;
  const aliasRefused = collision(() => runCheck(aliasHome, aliasOut, () => { aliasCalls++; throw new Error('no core call for alias siblings'); }), 'extremes');
  const retainedAlias = join(root, 'retained-alias'), retainedAliasOut = join(root, 'retained-alias-out');
  mkdirSync(retainedAlias);
  writeFileSync(join(retainedAlias, 'frames.json'), JSON.stringify({ ...manifest, sets: [
    { ...sets[0], animation: 'Idle', dir: 'Idle' }, { ...sets[1], animation: 'idle', dir: 'idle' },
  ] }));
  // Issue #1367: the render names these folders, so the copy refuses the
  // recorded pair as a frames.json problem rather than mapping the names.
  const retainedRefused = ((): boolean => {
    try { retainCheckRender(retainedAlias, retainedAliasOut); }
    catch (error) {
      return error instanceof PartsError && error.problems.length === 1 && error.problems[0].code === 'FRAMES_SIDECAR' &&
        error.problems[0].object.endsWith('sets[1] (animation "idle")') && error.problems[0].detail.includes('"idle" and sets[0] "dir" "Idle" are one folder "idle"');
    }
    return false;
  })();
  say('CK1362_EXTREMES_AND_RETAINED_CASE_ALIASES_REFUSE_BEFORE_ANY_OUTPUT',
    aliasRefused && aliasCalls === 0 && !existsSync(aliasOut) && retainedRefused && !existsSync(retainedAliasOut),
    'runCheck: zero core calls and no output; retainCheckRender: no destination created or copied before refusal');

  const reqPath = join(root, 'collision-requirements.json');
  writeRequirements(reqPath, { requirements: [] });
  const req = readRequirements(reqPath);
  const follow = { kind: 'follow' as const, name: 'first', animation: 'idle', bone: 'root', constraint: 'test',
    constraint_type: 'ik' as const, property: 'rotate' as const, fraction: 0.5, tolerance: 0.01, least_drive: 1 };
  const declaredAliases = { ...req, requirements: [{ ...follow, animation: 'Idle' }, { ...follow, name: 'second', animation: 'idle' }] };
  const followAliases = { ...req, requirements: [{ ...follow, name: 'Idle' }, { ...follow, name: 'idle' }] };
  const requirementInput = readCheckInputs(aliasHome);
  const requirementResults = [
    { file: declaredAliases, scope: 'requirements/as-declared' },
    { file: followAliases, scope: 'requirements/released' },
  ].map(({ file, scope }, i) => {
    const out = join(root, 'requirements-alias-out-' + i);
    mkdirSync(join(out, 'requirements'), { recursive: true });
    mkdirSync(join(out, '_requirements'));
    writeFileSync(join(out, 'requirements', 'sentinel'), 'keep published');
    writeFileSync(join(out, '_requirements', 'sentinel'), 'keep scratch');
    const before = tree(out).join('|');
    let calls = 0;
    const refused = collision(() => measureRequirements(requirementInput, file, 'unused-build', out, () => { calls++; throw new Error('no core call for requirement aliases'); }, []), scope);
    return refused && calls === 0 && tree(out).join('|') === before;
  });
  say('CK1362_REQUIREMENT_CASE_ALIASES_REFUSE_BEFORE_CLEANUP_OR_RENDER', requirementResults.every(Boolean),
    'as-declared and shared released/full scope preflights preserve existing published/scratch sentinels byte-for-byte; zero core calls');
}

export function runExtremesChecks(root: string, say: Say, rigc: RigcRunner): void {
  runDiagnosticPathChecks(join(root, 'portable-paths'), say);
  runFrameSetDirChecks(join(root, 'frame-set-dirs'), say, rigc);
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
  const prefixedDir = join(prefixedOut, 'extremes', 'a~003aturn');
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

/**
 * Issue #1367: a retained render keeps the folder rig-c's render recorded under
 * `frames.json` `sets[].dir` (rig-c/core#1744), byte for byte, and refuses by
 * name a value that is not one safe path segment. FSD01 and FSD02 render with
 * the suite's own rigc, so FSD01 holds only once the pinned core names
 * frame-set folders itself; every expected folder is spelled by hand.
 */
export function runFrameSetDirChecks(root: string, say: Say, rigc: RigcRunner): void {
  const home = join(root, 'input');
  writeCheckRig(home);
  const motion = json(join(home, 'motion.json'));
  const anims = motion.animations as Record<string, unknown>;
  anims['a:turn'] = anims.idle;
  writeFileSync(join(home, 'motion.json'), JSON.stringify(motion));
  const build = join(root, 'build');
  const built = rigc(['build', '--rig', join(home, 'rig.json'), '--motion', join(home, 'motion.json'), '--out', build]);
  const files = (dir: string, prefix = ''): string[] => readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .flatMap(e => e.isDirectory() ? files(join(dir, e.name), prefix + e.name + '/') : [prefix + e.name + ':' + createHash('sha256').update(readFileSync(join(dir, e.name))).digest('hex')]);
  const folders = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
  const render = (out: string, args: string[]): { status: number; dirs: string[] } => {
    const call = rigc(['render', '--candidate', build, '--max', '64', ...args, '--out', out]);
    const sets = call.status === 0 ? (json(join(out, 'frames.json')).sets as Array<{ dir: unknown }>) : [];
    return { status: call.status, dirs: sets.map(set => String(set.dir)) };
  };
  const copied = (source: string, target: string): string => {
    try { retainCheckRender(source, target); return 'copied'; }
    catch (error) { return error instanceof PartsError ? error.problems.map(p => `${p.code} ${p.object}: ${p.detail}`).join(' | ') : String(error); }
  };

  // FSD01: the folder on disk, the source index and the copy agree with what
  // the render recorded; a second mapping of the name or of the folder shows.
  const colon = [12, 24].map(fps => {
    const source = join(root, 'colon-' + fps), target = join(root, 'colon-kept-' + fps);
    const want = fps === 12 ? ['a~003aturn', 'idle'] : ['a~003aturn@24fps', 'idle@24fps'];
    const r = built.status === 0 ? render(source, ['--fps', String(fps)]) : { status: -1, dirs: [] };
    const result = r.status === 0 ? copied(source, target) : 'render exited ' + r.status;
    const ok = result === 'copied' && [...r.dirs].sort().join(',') === want.join(',') && folders(source).join(',') === want.join(',') &&
      folders(target).join(',') === want.join(',') && readFileSync(join(target, 'frames.json')).equals(readFileSync(join(source, 'frames.json'))) &&
      files(target).join('|') === files(source).join('|') && readFrameSet(join(target, want[0])).animation === 'a:turn';
    return { fps, ok, recorded: r.dirs, result };
  });
  // The same render with its folder renamed and the index following it: the
  // copy keeps the recorded name, not the one the animation would map to.
  const renamed = join(root, 'renamed'), renamedKept = join(root, 'renamed-kept');
  let renamedOk = false, renamedResult = 'not run';
  if (colon[0].ok) {
    copied(join(root, 'colon-12'), renamed);
    renameSync(join(renamed, 'a~003aturn'), join(renamed, 'turn-a'));
    const index = json(join(renamed, 'frames.json'));
    for (const set of index.sets as Array<{ animation: unknown; dir: string }>) if (set.animation === 'a:turn') set.dir = 'turn-a';
    writeFileSync(join(renamed, 'frames.json'), JSON.stringify(index));
    renamedResult = copied(renamed, renamedKept);
    if (renamedResult === 'copied') renamedResult += ' to ' + folders(renamedKept).join(',');
    renamedOk = renamedResult === 'copied to idle,turn-a' && folders(renamedKept).join(',') === 'idle,turn-a' && readFrameSet(join(renamedKept, 'turn-a')).animation === 'a:turn';
  }
  say('FSD01_COLON_RENDER_IS_COPIED_AS_RECORDED_WITHOUT_A_SECOND_MAPPING', built.status === 0 && colon.every(c => c.ok) && renamedOk,
    JSON.stringify({ build: built.status, colon, renamed: renamedResult }));

  // FSD02: a render of names that are already safe copies byte for byte.
  const safe = join(root, 'safe'), safeKept = join(root, 'safe-kept');
  const safeRender = built.status === 0 ? render(safe, ['--animation', 'idle', '--fps', '24']) : { status: -1, dirs: [] };
  const safeResult = safeRender.status === 0 ? copied(safe, safeKept) : 'render exited ' + safeRender.status;
  say('FSD02_SAFE_NAME_RENDER_COPIES_EVERY_BYTE', safeResult === 'copied' && safeRender.dirs.join(',') === 'idle@24fps' && files(safeKept).join('|') === files(safe).join('|'),
    JSON.stringify({ recorded: safeRender.dirs, result: safeResult, files: existsSync(safeKept) ? files(safeKept).length : 0 }));

  // FSD03: every value that is not one safe segment is refused by name, with
  // nothing created; reasons spelled by hand from the rule.
  const manifest = (sets: unknown[]) => ({ spec: 'rigc-frames/1', viewport: { x: 0, y: 0, width: 1, height: 1, scale: 1, pixelWidth: 1, pixelHeight: 1 }, background: [0, 0, 0, 0], sets });
  const row = (dir: unknown) => ({ animation: 'a', ...(dir === undefined ? {} : { dir }), fps: 12, sampled: 1, written: 1, stride: 1, duration: 0 });
  const bad: Array<[unknown, string]> = [
    [undefined, '"dir" is absent'], [7, '"dir" 7 is number, not a string'], [null, '"dir" null is null, not a string'],
    ['', '"dir" "" is empty'], ['..', '"dir" ".." holds a dot segment'], ['.', '"dir" "." holds a dot segment'],
    ['../outside', '"dir" "../outside" holds a dot segment'], ['/abs', '"dir" "/abs" is an absolute path'],
    ['C:x', '"dir" "C:x" holds ":" (U+003a) outside [A-Za-z0-9_@+.~-]'], ['\\\\server', '"dir" "\\\\\\\\server" is an absolute path'],
    ['a/b', '"dir" "a/b" holds a path separator'], ['a\\b', '"dir" "a\\\\b" holds a path separator'],
    ['a:turn', '"dir" "a:turn" holds ":" (U+003a) outside [A-Za-z0-9_@+.~-]'], ['é', '"dir" "é" holds "é" (U+00e9) outside [A-Za-z0-9_@+.~-]'],
    ['tail ', '"dir" "tail " holds " " (U+0020) outside [A-Za-z0-9_@+.~-]'], ['tail.', '"dir" "tail." ends with "."'],
    ['con', '"dir" "con" is a Windows device name before its first dot'], ['LPT1.log', '"dir" "LPT1.log" is a Windows device name before its first dot'],
    ['x'.repeat(256), `"dir" "${'x'.repeat(256)}" is 256 characters`],
  ];
  const refusals = bad.map(([dir, want], i) => {
    const source = join(root, 'bad-' + i), target = join(root, 'bad-kept-' + i);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'frames.json'), JSON.stringify(manifest([row(dir)])));
    let ok = false;
    try { retainCheckRender(source, target); }
    catch (error) {
      ok = error instanceof PartsError && error.problems.length === 1 && error.problems[0].code === 'FRAMES_SIDECAR' &&
        error.problems[0].object === join(source, 'frames.json') + ' sets[0] (animation "a")' &&
        error.problems[0].detail.startsWith(want + '; one path segment of [A-Za-z0-9_@+.~-]') && error.problems[0].detail.includes('is required to retain a render');
    }
    return ok && !existsSync(target);
  });
  const good = ['a~003aturn', 'idle@24fps', '~0063on.txt', 'tail~002e', '.~002e', 'x'.repeat(255)].map((dir, i) => {
    const source = join(root, 'good-' + i), target = join(root, 'good-kept-' + i);
    mkdirSync(join(source, dir), { recursive: true });
    writeFileSync(join(source, dir, 'sentinel'), String(i));
    writeFileSync(join(source, 'frames.json'), JSON.stringify(manifest([row(dir)])));
    return copied(source, target) === 'copied' && existsSync(join(target, dir, 'sentinel')) && readFileSync(join(target, dir, 'sentinel'), 'utf8') === String(i);
  });
  say('FSD03_A_SET_DIR_THAT_IS_NOT_ONE_SAFE_SEGMENT_IS_REFUSED_BEFORE_COPY', refusals.every(Boolean) && good.every(Boolean),
    `${refusals.filter(Boolean).length} of ${bad.length} planted values refused by name with no target; ${good.filter(Boolean).length} of ${good.length} safe recorded folders copied: ${refusals.join(',')} / ${good.join(',')}`);

  // FSD04: two recorded folders one case-insensitive filesystem would merge,
  // and every bad set of one index, are named in one refusal; Idle and idle-2 copy.
  const pair = join(root, 'pair'), pairKept = join(root, 'pair-kept');
  mkdirSync(pair, { recursive: true });
  writeFileSync(join(pair, 'frames.json'), JSON.stringify(manifest([{ ...row('Idle'), animation: 'Idle' }, { ...row('a:turn'), animation: 'a:turn' }, { ...row('idle'), animation: 'idle' }])));
  let named: string[] = [];
  try { retainCheckRender(pair, pairKept); } catch (error) { if (error instanceof PartsError) named = error.problems.map(p => `${p.code} ${p.object.slice(join(pair, 'frames.json').length)}: ${p.detail.split(';')[0]}`); }
  const distinct = join(root, 'distinct'), distinctKept = join(root, 'distinct-kept');
  for (const dir of ['Idle', 'idle-2']) mkdirSync(join(distinct, dir), { recursive: true });
  writeFileSync(join(distinct, 'frames.json'), JSON.stringify(manifest([{ ...row('Idle'), animation: 'Idle' }, { ...row('idle-2'), animation: 'idle-2' }])));
  say('FSD04_CASE_FOLDED_RECORDED_FOLDERS_AND_EVERY_BAD_SET_ARE_NAMED_IN_ONE_REFUSAL',
    named.join(' | ') === 'FRAMES_SIDECAR  sets[1] (animation "a:turn"): "dir" "a:turn" holds ":" (U+003a) outside [A-Za-z0-9_@+.~-] | ' +
      'FRAMES_SIDECAR  sets[2] (animation "idle"): "dir" "idle" and sets[0] "dir" "Idle" are one folder "idle" on a case-insensitive filesystem' &&
      !existsSync(pairKept) && copied(distinct, distinctKept) === 'copied' && folders(distinctKept).join(',') === 'Idle,idle-2',
    named.join(' | '));
}
