/**
 * The run records `check` and `build` write (issues #1541, #1556), on the build suite's green build.
 *
 * Every expected value is written by hand from the fixture's layout: the record's argv is the command, the options as
 * given in the flag-table order, each path relative to `--out` and `--out` as `.`. The replays run from a sibling of
 * the original `--out`, at the same depth, so every recorded relative path names the same file.
 */
import { pngChunk } from '@rig-c/core/plate';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, posix, relative, resolve, sep, win32 } from 'node:path';
import { BUILD_RUN_FILE } from '../src/build.ts';
import { makeOutDir } from '../src/outputpaths.ts';
import { decodePngBytes } from '../src/raster/png.ts';
import { argvPathFromOut, argvReplayProblems, type ArgvTable, buildRunRecord, CHECK_RUN_FILE, effectiveArgv, isRunRecordFile, linkRuleFor, realWhereItExists, recordArgv, recordedConfigPath, recordedInputPath, type RunRecord, RUN_STAMP_FILE, type RunStamp } from '../src/runstamp.ts';

type Say = (name: string, ok: boolean, detail: string, why: string) => void;

const ROOT = resolve(import.meta.dir, '..');
/** The record keys in write order. */
export const RECORD_KEYS_CHECK = ['spec', 'package', 'command', 'started_at', 'finished_at', 'outputs', 'argv'];
export const RECORD_KEYS_BUILD = ['spec', 'package', 'command', 'started_at', 'finished_at', 'config', 'inputs', 'outputs', 'argv'];
const FIXED_EPOCH = '1762560000';
const FIXED_TIME = '2025-11-08T00:00:00.000Z';

/** A table shaped like a command's flag row, for the pure controls: two path flags, one plain, one compound, two switches. */
const TABLE: ArgvTable = {
  valued: ['--rig', '--out', '--parts', '--page-edges', '--alt'],
  switches: ['--seam-pairs', '--no-extremes'],
  paths: ['--rig', '--out', '--parts'],
  compound: { '--alt': (value, path) => { const [name, rest] = value.split('='); return `${name}=${rest.split(':').map(path).join(':')}`; } },
};

function cli(args: readonly string[], cwd: string, epoch?: string): { status: number; out: string } {
  const env = epoch === undefined ? process.env : { ...process.env, SOURCE_DATE_EPOCH: epoch };
  const r = spawnSync('bun', [join(ROOT, 'cli.ts'), ...args], { cwd, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function readRecord(path: string): RunRecord | null {
  try { return JSON.parse(readFileSync(path, 'utf8')) as RunRecord; } catch { return null; }
}

const timeless = (r: RunRecord | null): string => {
  if (r === null) return 'absent';
  const { started_at: _s, finished_at: _f, ...rest } = r;
  return JSON.stringify(rest);
};

/** The pure controls: path arithmetic, flag-table order, as-given options, and the replay comparison with its plants. */
export function runRunRecordPureChecks(say: Say): void {
  // Given from /w (the working directory) with --out o/run: a relative path climbs two levels, an absolute one too.
  const given = ['--no-extremes', '--alt', 'b=in/b.png:in/full', '--out', 'o/run', '--parts', '/w/in/parts', '--rig', 'in/rig', '--seam-pairs'];
  const argv = recordArgv('check', given, TABLE, 'o/run', '/w', posix);
  const want = ['check', '--rig', '../../in/rig', '--out', '.', '--parts', '../../in/parts', '--alt', 'b=../../in/b.png:../../in/full', '--seam-pairs', '--no-extremes'];
  say('BU1541A_ARGV_IS_THE_OPTIONS_AS_GIVEN_IN_FLAG_TABLE_ORDER_WITH_PATHS_FROM_OUT',
    JSON.stringify(argv) === JSON.stringify(want),
    `recorded ${JSON.stringify(argv)}; hand-written ${JSON.stringify(want)}`,
    'issue #1541: the command first, valued flags in table order, then the switches present; --page-edges was not given and is not written (as given, no default expanded); an absolute path is rebased like a relative one');
  // Another Windows drive cannot be written relative to --out; it is written as given. On the same drive it is rebased.
  const otherDrive = argvPathFromOut('C:\\art\\full', 'D:\\o', 'D:\\w', win32);
  const sameDrive = argvPathFromOut('D:\\art\\full', 'D:\\o', 'D:\\w', win32);
  const itself = argvPathFromOut('o/run/', 'o/run', '/w', posix);
  say('BU1541B_A_PATH_ON_ANOTHER_DRIVE_IS_WRITTEN_AS_GIVEN_AND_THE_OUT_DIRECTORY_IS_DOT',
    otherDrive === 'C:\\art\\full' && sameDrive === '../art/full' && itself === '.',
    `other drive ${JSON.stringify(otherDrive)}, same drive ${JSON.stringify(sameDrive)}, --out itself ${JSON.stringify(itself)}`,
    'issue #1541: posix separators wherever a relative path exists; as given only where none does');
  // The replay from --out asks for the same run; each plant asks for another one and is named by flag.
  const same = argvReplayProblems('check', given, argv, TABLE, 'o/run', '/w', posix);
  const dropped = argvReplayProblems('check', given, argv.filter((t, i) => !(t === '--parts' || argv[i - 1] === '--parts')), TABLE, 'o/run', '/w', posix);
  const fromCwd = argvReplayProblems('check', given, argv.map((t) => (t === '../../in/rig' ? 'in/rig' : t)), TABLE, 'o/run', '/w', posix);
  const lostSwitch = argvReplayProblems('check', given, argv.filter((t) => t !== '--seam-pairs'), TABLE, 'o/run', '/w', posix);
  const wrongCommand = argvReplayProblems('check', given, ['build', ...argv.slice(1)], TABLE, 'o/run', '/w', posix);
  say('BU1541C_THE_RECORDED_ARGV_REPLAYED_FROM_OUT_IS_THE_SAME_RUN_AND_EACH_PLANT_IS_NAMED',
    same.length === 0 && dropped.length === 1 && dropped[0].startsWith('--parts:') && fromCwd.length === 1 && fromCwd[0].startsWith('--rig:') &&
      lostSwitch.length === 1 && lostSwitch[0].startsWith('--seam-pairs:') && wrongCommand.length === 1 && wrongCommand[0].startsWith('argv[0]'),
    `as recorded ${JSON.stringify(same)}; planted: --parts dropped ${JSON.stringify(dropped)}; --rig left relative to the working directory ${JSON.stringify(fromCwd)}; --seam-pairs dropped ${JSON.stringify(lostSwitch)}; argv[0] build ${JSON.stringify(wrongCommand)}`,
    'issue #1541: effective options resolve each path where it points, so a replay that drops an option, or keeps a path relative to the wrong directory, is a named difference');
  const eff = effectiveArgv(argv.slice(1), TABLE, '/w/o/run', posix);
  say('BU1541D_RUN_RECORD_FILES_ARE_LEFT_OUT_OF_OUTPUTS_AND_NOTHING_ELSE_IS',
    isRunRecordFile('build/run.json') && isRunRecordFile(CHECK_RUN_FILE) && isRunRecordFile(BUILD_RUN_FILE) && !isRunRecordFile('build/skeleton.json') &&
      !isRunRecordFile('check/check.json') && !isRunRecordFile('run.json.png') && eff.get('--alt')?.[0] === 'b=/w/in/b.png:/w/in/full',
    `build/run.json ${isRunRecordFile('build/run.json')}, ${CHECK_RUN_FILE} ${isRunRecordFile(CHECK_RUN_FILE)}, ${BUILD_RUN_FILE} ${isRunRecordFile(BUILD_RUN_FILE)}; build/skeleton.json ${isRunRecordFile('build/skeleton.json')}, check/check.json ${isRunRecordFile('check/check.json')}, run.json.png ${isRunRecordFile('run.json.png')}; --alt resolves to ${JSON.stringify(eff.get('--alt'))}`,
    'issue #1541: rigc\'s run.json carries its own clock, so a record that hashed it would differ between two runs of the same inputs');

  // Bun on Windows refuses mkdirSync('.', { recursive: true }) with EEXIST (windows-latest CI, BU1541F's replay with
  // --out . from the directory it names). The model below refuses the same way on every host, on `.`.
  // makeOutDir hands it the resolved path; the plant is the call the build made before.
  const made: string[] = [];
  const windowsBun = (path: string): void => {
    if (path === '.') throw new Error(`EEXIST: file already exists, mkdir '${path}'`);
    made.push(path);
  };
  let fixed = 'made';
  try { makeOutDir('.', windowsBun); } catch (e) { fixed = (e as Error).message; }
  let planted = 'made';
  try { windowsBun('.'); } catch (e) { planted = (e as Error).message; }
  say('BU1541I_AN_OUT_THAT_IS_THE_WORKING_DIRECTORY_IS_MADE_BY_ITS_RESOLVED_PATH',
    fixed === 'made' && made.length === 1 && made[0] === resolve('.') && planted.startsWith('EEXIST'),
    `makeOutDir('.') ${fixed}, path handed over ${JSON.stringify(made[0])}; planted mkdirSync('.') ${JSON.stringify(planted)}`,
    'issue #1541: build --out . run from that directory reached resetBuildOutput\'s mkdirSync(\'.\'), which Bun on Windows refuses');

  // A config given through a link: the record names the link (its directory resolved, its own name kept), as rig-c
  // core's render-run.json does; resolving the file itself, as rig-run/1 does, names the link's target instead.
  const links: Record<string, string> = { '/w/out': '/w/out', '/w/cfg': '/w/store', '/w/cfg/config.json': '/w/store/shared.json' };
  const real = (p: string): string => links[p] ?? p;
  const kept = recordedConfigPath('/w/out', '/w/cfg/config.json', real, posix);
  const followed = posix.relative(real('/w/out'), real('/w/cfg/config.json'));
  say('BU1541J_A_LINKED_CONFIG_IS_RECORDED_BY_THE_LINK_NAME_WITH_ITS_DIRECTORY_RESOLVED',
    kept === '../store/config.json' && followed === '../store/shared.json',
    `recorded ${JSON.stringify(kept)}; planted (the file resolved too) ${JSON.stringify(followed)}`,
    'issue #1541: a replay from --out reads what the link names when it runs, as rig-c core records an input');

  // Windows, modelled on every host: a junction C:\t\ln -> C:\t\deep\er, the check run from C:\t\deep\er\work with
  // --out C:\t\ln\work\chk. The replay runs from --out as spelled, and Windows resolves `..` against that spelling
  // (measured, issue #1551), so the recorded --rig must name the rig from it textually. The plant resolves the junction
  // first, the POSIX rule main 0c1d234 applied on every platform.
  const junction = (p: string): string => p.startsWith('C:\\t\\ln') ? `C:\\t\\deep\\er${p.slice('C:\\t\\ln'.length)}` : p;
  const winOut = 'C:\\t\\ln\\work\\chk';
  const winArgs = ['--rig', '..\\..\\..\\out\\rig', '--out', winOut];
  const asRule = recordArgv('check', winArgs, CHECK_PLANT_TABLE, winOut, 'C:\\t\\deep\\er\\work', win32);
  const throughJunction = recordArgv('check', winArgs, CHECK_PLANT_TABLE, winOut, 'C:\\t\\deep\\er\\work', win32, junction);
  const replayed = (argv: string[]): string => win32.resolve(winOut, argv[argv.indexOf('--rig') + 1]);
  say('BU1551A_ON_WINDOWS_A_PATH_IS_REBASED_TO_OUT_AS_SPELLED_SO_THE_REPLAY_FROM_OUT_NAMES_THE_SAME_RIG',
    linkRuleFor(posix) === realWhereItExists && asRule[asRule.indexOf('--rig') + 1] === '../../../out/rig' && replayed(asRule) === 'C:\\t\\out\\rig' &&
      throughJunction[throughJunction.indexOf('--rig') + 1] === '../../../../out/rig' && replayed(throughJunction) === 'C:\\out\\rig',
    `POSIX rule resolves links ${linkRuleFor(posix) === realWhereItExists}; Windows rule recorded --rig ${JSON.stringify(asRule[asRule.indexOf('--rig') + 1])}, replayed from --out as spelled ${JSON.stringify(replayed(asRule))}; planted (junction resolved) ${JSON.stringify(throughJunction[throughJunction.indexOf('--rig') + 1])}, replayed ${JSON.stringify(replayed(throughJunction))}`,
    'issue #1551: Bun on Windows reports a working directory spelled through a junction as spelled and resolves `..` textually against it, so resolving the junction before rebasing climbs one level per hidden one');

  // Issue #1554: input paths recorded by assemble (rig-run/1) and check (check.json) use the same --out-relative
  // per-platform rule, and directory inputs name `<dir>/layers.json` so the recorded path names the hashed file.
  const posixLinks1554: Record<string, string> = {
    '/w/ln/out': '/w/deep/er/out',
    '/w/art/ln-head': '/w/store/head-dir',
    '/w/art/ln-head/layers.json': '/w/store/shared-manifest.json',
  };
  const real1554 = (p: string): string => posixLinks1554[p] ?? p;
  const posixCwd1554 = '/w/runner';
  const posixOut1554 = '/w/ln/out';
  const posixSource = recordedInputPath('../art/painting.png', posixOut1554, posixCwd1554, false, posix, real1554);
  const posixFullDir = recordedInputPath('../art/full', posixOut1554, posixCwd1554, true, posix, real1554);
  const posixLinkedHeadFile = recordedInputPath('../art/ln-head/layers.json', posixOut1554, posixCwd1554, false, posix, real1554);
  const plantedCwdSource = '../art/painting.png';
  const plantedDirOnly = recordedInputPath('../art/full', posixOut1554, posixCwd1554, false, posix, real1554);
  const winAsmOut = 'C:\\t\\ln\\work\\assembled';
  const winFullAsSpelled = recordedInputPath('..\\..\\..\\art\\full', winAsmOut, 'C:\\t\\deep\\er\\work', true, win32);
  const winFullPlantedJunction = recordedInputPath('..\\..\\..\\art\\full', winAsmOut, 'C:\\t\\deep\\er\\work', true, win32, junction);
  say('BU1554A_RECORDED_INPUT_PATHS_REBASE_TO_OUT_AND_NAME_LAYERS_JSON_BY_THE_PER_PLATFORM_LINK_RULE',
    posixSource === '../../../art/painting.png' &&
      posix.resolve('/w/deep/er/out', posixSource) === '/w/art/painting.png' &&
      posixFullDir === '../../../art/full/layers.json' &&
      posix.resolve('/w/deep/er/out', posixFullDir) === '/w/art/full/layers.json' &&
      posixLinkedHeadFile === '../../../store/head-dir/layers.json' &&
      posix.resolve('/w/deep/er/out', plantedCwdSource) !== '/w/art/painting.png' &&
      plantedDirOnly === '../../../art/full' && !plantedDirOnly.endsWith('/layers.json') &&
      winFullAsSpelled === '../../../art/full/layers.json' &&
      win32.resolve(winAsmOut, winFullAsSpelled) === 'C:\\t\\art\\full\\layers.json' &&
      winFullPlantedJunction === '../../../../art/full/layers.json' &&
      win32.resolve(winAsmOut, winFullPlantedJunction) === 'C:\\art\\full\\layers.json',
    `POSIX: source ${JSON.stringify(posixSource)}, full dir ${JSON.stringify(posixFullDir)}, linked head ${JSON.stringify(posixLinkedHeadFile)}; planted cwd-relative resolves to ${JSON.stringify(posix.resolve('/w/deep/er/out', plantedCwdSource))}, dir-only ${JSON.stringify(plantedDirOnly)}; Windows: recorded ${JSON.stringify(winFullAsSpelled)} -> ${JSON.stringify(win32.resolve(winAsmOut, winFullAsSpelled))}, planted junction-resolved ${JSON.stringify(winFullPlantedJunction)} -> ${JSON.stringify(win32.resolve(winAsmOut, winFullPlantedJunction))}`,
    'issue #1554: assemble inputs rebase to --out by linkRuleFor(api) and name layers.json for directories; planted cwd-relative, directory-only and wrong-platform-rule paths miss the hashed file');
}

/**
 * The CLI controls on a green build's `--out` (`out`, built from `dir`): build's record, a standalone check of that
 * build with its record, each replayed from a sibling directory, the version against `--version`, and a refused
 * check leaving no record.
 */
export function runRunRecordCliChecks(dir: string, out: string, say: Say): void {
  const version = cli(['--version'], ROOT).out.trim();
  const pkgName = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string }).name;
  const built = readRecord(join(out, BUILD_RUN_FILE));
  const outputs = built?.outputs.map((o) => o.path) ?? [];
  const buildRecord = built?.command === 'build' ? built : undefined;
  say('BU1541E_A_GREEN_BUILD_WRITES_BUILD_RUN_JSON_WITH_ITS_KEYS_ITS_VERSION_AND_ITS_ARGV',
    buildRecord !== undefined && JSON.stringify(Object.keys(buildRecord)) === JSON.stringify(RECORD_KEYS_BUILD) && buildRecord.spec === 'rig-run/3' &&
      buildRecord.package.name === pkgName && buildRecord.package.version === version && buildRecord.config?.path === '../config.json' &&
      buildRecord.argv[0] === 'build' && buildRecord.argv[buildRecord.argv.indexOf('--out') + 1] === '.' &&
      buildRecord.argv[buildRecord.argv.indexOf('--config') + 1] === '../config.json' &&
      outputs.includes('check/check.json') && outputs.includes('parts.json') && !outputs.some(isRunRecordFile),
    `keys ${JSON.stringify(built === null ? null : Object.keys(built))}; package ${built?.package.name}@${built?.package.version} against --version ${version}; config ${buildRecord?.config?.path}; argv ${JSON.stringify(built?.argv)}; ${outputs.length} output(s), check/check.json ${outputs.includes('check/check.json')}, a run record among them ${outputs.some(isRunRecordFile)}`,
    'issue #1541: the version is read from package.json the way --version reads it, never written by hand; the config and every path are relative to --out');

  const expectedInputs = [
    { role: 'source', path: '../painting.png', sha256: sha256File(join(dir, 'painting.png')) },
    { role: 'full', path: '../full/layers.json', sha256: sha256File(join(dir, 'full', 'layers.json')) },
    { role: 'head', path: '../head/layers.json', sha256: sha256File(join(dir, 'head', 'layers.json')) },
  ];
  const builtInputs = built !== null && 'inputs' in built ? built.inputs : undefined;
  say('BU1556A_BUILD_CLI_RECORDS_ORDERED_INPUT_FILES_AND_RAW_HASHES',
    JSON.stringify(builtInputs) === JSON.stringify(expectedInputs),
    `inputs ${JSON.stringify(builtInputs ?? null)}; expected ${JSON.stringify(expectedInputs)}`,
    'issue #1556: the pre-change build record carries the paths in argv only; the emitted inputs must name and hash the painting and the two manifests');

  // Replay build's argv from a sibling of --out. check.json records the config path as --config was typed (issue
  // #607), so the replay's report differs from the original there and nowhere else; every measured key is the same.
  const replayOut = join(dir, 'out-replay-1541');
  mkdirSync(replayOut, { recursive: true });
  const replay = built === null ? { status: -1, out: 'no record' } : cli(built.argv, replayOut);
  const again = readRecord(join(replayOut, BUILD_RUN_FILE));
  const report = (at: string): Record<string, unknown> | null => {
    try { return JSON.parse(readFileSync(join(at, 'check', 'check.json'), 'utf8')) as Record<string, unknown>; } catch { return null; }
  };
  const first = report(out), second = report(replayOut);
  const typed = (r: Record<string, unknown> | null): unknown => (r?.config as { path?: unknown } | undefined)?.path;
  const untyped = (r: Record<string, unknown> | null): string => {
    if (r === null) return 'absent';
    const cfg = r.config as Record<string, unknown> | undefined;
    return JSON.stringify(cfg === undefined ? r : { ...r, config: { ...cfg, path: '<as typed>' } });
  };
  const recordAside = (r: RunRecord | null): string => r === null ? 'absent'
    : timeless({ ...r, outputs: r.outputs.filter((o) => o.path !== 'check/check.json') });
  const configArg = built === null ? undefined : built.argv[built.argv.indexOf('--config') + 1];
  say('BU1541F_BUILD_ARGV_REPLAYED_FROM_OUT_REBUILDS_THE_SAME_CHECK_AND_RECORD_BUT_FOR_THE_CONFIG_PATH_AS_TYPED',
    replay.status === 0 && first !== null && untyped(first) === untyped(second) && typed(second) === configArg && typed(first) !== configArg &&
      recordAside(again) === recordAside(built) && JSON.stringify(again?.argv) === JSON.stringify(built?.argv),
    `replay exit ${replay.status}; check.json equal but config.path ${untyped(first) === untyped(second)}; config.path typed ${JSON.stringify(typed(first))} then ${JSON.stringify(typed(second))} (the recorded --config ${JSON.stringify(configArg)}); records equal but for the times and check/check.json's digest ${recordAside(again) === recordAside(built)}${replay.status === 0 ? '' : `; ${replay.out.trim().split('\n').slice(-3).join(' | ')}`}`,
    'issue #1541: these arguments reproduce the check with the same package version, run from the --out directory; the one key that records a path as typed records the replay\'s spelling');

  // A standalone check of the build, from dir with relative paths, and its replay from a sibling at the same depth.
  const checked = cli(['check', '--rig', 'out/rig', '--out', 'check-1541', '--parts', 'out', '--no-extremes'], dir, FIXED_EPOCH);
  const checkOut = join(dir, 'check-1541');
  const rec = readRecord(join(checkOut, CHECK_RUN_FILE));
  const checkWant = ['check', '--rig', '../out/rig', '--out', '.', '--parts', '../out', '--no-extremes'];
  const checkReplayDir = join(dir, 'check-1541-replay');
  mkdirSync(checkReplayDir, { recursive: true });
  const checkReplay = rec === null ? { status: -1, out: 'no record' } : cli(rec.argv, checkReplayDir, FIXED_EPOCH);
  const recAgain = readRecord(join(checkReplayDir, CHECK_RUN_FILE));
  const checkSame = existsSync(join(checkReplayDir, 'check.json')) &&
    readFileSync(join(dir, 'check-1541', 'check.json')).equals(readFileSync(join(checkReplayDir, 'check.json')));
  say('BU1541G_CHECK_WRITES_CHECK_RUN_JSON_AND_ITS_ARGV_REPLAYED_FROM_OUT_IS_THE_SAME_CHECK',
    checked.status === 0 && rec?.command === 'check' && rec.spec === 'rig-run/2' && JSON.stringify(Object.keys(rec)) === JSON.stringify(RECORD_KEYS_CHECK) && rec.package.version === version &&
      JSON.stringify(rec.argv) === JSON.stringify(checkWant) && rec.outputs.some((o) => o.path === 'check.json') &&
      checkReplay.status === 0 && checkSame && timeless(recAgain) === timeless(rec),
    `check exit ${checked.status}; keys ${JSON.stringify(rec === null ? null : Object.keys(rec))}; argv ${JSON.stringify(rec?.argv)} against ${JSON.stringify(checkWant)}; replay exit ${checkReplay.status}, check.json byte-equal ${checkSame}, records equal but for the times ${timeless(recAgain) === timeless(rec)}`,
    'issue #1541: a check given relative paths from its working directory records them from --out; the replay is the same check');

  const checkFiles = existsSync(checkOut) ? readdirSync(checkOut, { recursive: true, withFileTypes: true }) : [];
  const checkOutputs = checkFiles.filter((entry) => entry.isFile())
    .map((entry) => relative(checkOut, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((file) => file !== CHECK_RUN_FILE && file !== 'build/run.json').sort()
    .map((path) => ({ path, sha256: sha256File(join(checkOut, path)) }));
  const legacyCheck = {
    spec: 'rig-run/2', package: { name: pkgName, version }, command: 'check',
    started_at: FIXED_TIME, finished_at: FIXED_TIME, outputs: checkOutputs, argv: checkWant,
  };
  const checkBytes = rec === null ? '' : readFileSync(join(checkOut, CHECK_RUN_FILE), 'utf8');
  const legacyBytes = `${JSON.stringify(legacyCheck, null, 1)}\n`;
  const changedSpec = `${JSON.stringify({ ...legacyCheck, spec: 'rig-run/3' }, null, 1)}\n`;
  say('BU1556B_CHECK_RUN_2_MATCHES_LEGACY_BYTES_AT_A_FIXED_CLOCK',
    checked.status === 0 && checkOutputs.length > 0 && checkBytes === legacyBytes && checkBytes !== changedSpec,
    `${checkBytes.length} actual bytes, ${legacyBytes.length} legacy bytes, ${checkOutputs.length} independently listed outputs; changed spec differs ${checkBytes !== changedSpec}`,
    'issue #1556: compare the actual record to the legacy serializer and fixture layout, including field order, indentation and final newline');

  // A refused check over a reused --out clears the earlier record and writes none.
  const reused = join(dir, 'check-1541-refused');
  cpSync(join(dir, 'check-1541'), reused, { recursive: true });
  const hadRecord = existsSync(join(reused, CHECK_RUN_FILE));
  writeFileSync(join(dir, 'not-a-rig-1541'), 'x');
  const refused = cli(['check', '--rig', 'not-a-rig-1541', '--out', 'check-1541-refused', '--no-extremes'], dir);
  say('BU1541H_A_REFUSED_CHECK_LEAVES_NO_RUN_RECORD_IN_A_REUSED_OUT',
    hadRecord && refused.status !== 0 && refused.status !== 2 && !existsSync(join(reused, CHECK_RUN_FILE)),
    `reused --out held a record ${hadRecord}; refused exit ${refused.status}; record after ${existsSync(join(reused, CHECK_RUN_FILE))}`,
    'issue #1541: the record is cleared before the check starts and written only when it completed its report');

  runLinkedOutReplay(dir, out, say);
  runOutRelativeInputRecordChecks(dir, out, say);
  runBuildInputRecordChecks(dir, out, say);
}

/** `check`'s flag row as cli.ts records it, for the planted argv: the valued flags and switches this control gives. */
const CHECK_PLANT_TABLE: ArgvTable = { valued: ['--rig', '--out', '--parts'], switches: ['--no-extremes'], paths: ['--rig', '--out', '--parts'] };

/**
 * Issue #1544, the real command: `--out` given through a directory link whose target sits deeper than the link, and
 * `--rig` and `--parts` given relative to a working directory the process reports by its real path (as
 * `/var` -> `/private/var` on macOS; here a link of our own, so every host has it). The record's argv, replayed with
 * the CLI from the `--out` directory as the run was given it, is the same check and writes the same record but for the
 * times. What "through a link" means is the host's (issue #1551, {@link linkRuleFor}): on POSIX `..` is physical, so the
 * recorded path climbs the real tree, one level more than from the working directory; on Windows `..` is textual
 * against the spelling, so it climbs the link's spelling, as many levels as from the working directory. The plant
 * records the same arguments by the other platform's rule, and its replay from `--out` does not find the rig.
 */
function runLinkedOutReplay(dir: string, out: string, say: Say): void {
  const root = join(realpathSync(dir), 'linked-1544');
  const target = join(root, 'deep', 'er');
  const work = join(target, 'work');
  mkdirSync(work, { recursive: true });
  const link = join(root, 'ln');
  symlinkSync(target, link, 'junction');
  const realOut = realpathSync(out);
  const rig = relative(work, join(realOut, 'rig')).split('\\').join('/');
  const parts = relative(work, realOut).split('\\').join('/');
  const given = join(link, 'work', 'chk');
  const args = ['--rig', rig, '--out', given, '--parts', parts, '--no-extremes'];
  const first = cli(['check', ...args], work);
  const rec = readRecord(join(given, CHECK_RUN_FILE));
  const recordedRig = rec === null ? undefined : rec.argv[rec.argv.indexOf('--rig') + 1];
  // POSIX: the link sits two levels above its target, so from its real --out the rig is one level further than from
  // the working directory. Windows: the spelling ln\work\chk is as deep as work, so the climb is the same.
  const windows = sep === '\\';
  const wantRig = windows ? rig : `../${rig}`;
  const replay = rec === null ? { status: -1, out: 'no record' } : cli(rec.argv, given);
  const again = readRecord(join(given, CHECK_RUN_FILE));
  const differ = (a: RunRecord | null, b: RunRecord | null): string[] => a === null || b === null ? ['absent']
    : [...new Set([...a.outputs, ...b.outputs].map((o) => o.path))].filter((p) =>
      JSON.stringify(a.outputs.find((o) => o.path === p)) !== JSON.stringify(b.outputs.find((o) => o.path === p)));
  const moved = differ(rec, again);
  const sameRecord = timeless(again) === timeless(rec);
  say('BU1544A_ARGV_RECORDED_THROUGH_A_LINKED_OUT_REPLAYS_FROM_OUT_AS_THE_SAME_CHECK',
    first.status === 0 && rec !== null && recordedRig === wantRig && replay.status === 0 && sameRecord,
    `check exit ${first.status}; --rig given ${JSON.stringify(rig)} from the real working directory, recorded ${JSON.stringify(recordedRig)} (want ${JSON.stringify(wantRig)}, ${windows ? 'Windows: as spelled' : 'POSIX: through the link'}); replay from --out exit ${replay.status}; records equal but for the times ${sameRecord}; digests that moved ${JSON.stringify(moved)}${replay.status === 0 ? '' : `; ${replay.out.trim().split('\n').slice(-2).join(' | ')}`}`,
    'issues #1544, #1551: on POSIX --out and each path\'s directory are resolved through their links before the path is rebased, so the replay climbs the real tree (one level more, by hand); on Windows the path is rebased as spelled, as Windows resolves `..` from the spelling (the same climb, by hand)');

  // The plant: the same arguments recorded by the other platform's rule, replayed the same way. On POSIX that is plain
  // arithmetic (no link resolved); on Windows it is the links resolved first, as main 0c1d234 did there.
  const planted = recordArgv('check', args, CHECK_PLANT_TABLE, given, work, undefined, windows ? realWhereItExists : (p) => p);
  const plantedRig = planted[planted.indexOf('--rig') + 1];
  const wantPlanted = windows ? `../${rig}` : rig;
  const plantedReplay = cli(planted, given);
  say('BU1544B_PLANTED_ARGV_BY_THE_OTHER_PLATFORMS_LINK_RULE_MISSES_THE_RIG_AND_THE_REPLAY_FAILS',
    plantedRig === wantPlanted && plantedReplay.status !== 0 && plantedReplay.status !== 2 && !existsSync(join(given, CHECK_RUN_FILE)),
    `planted --rig ${JSON.stringify(plantedRig)} (want ${JSON.stringify(wantPlanted)}, ${windows ? 'Windows: the junction resolved first' : 'POSIX: plain arithmetic, the link not resolved'}); replay exit ${plantedReplay.status}, record after ${existsSync(join(given, CHECK_RUN_FILE))}`,
    'issues #1544, #1551: on POSIX the arithmetic main 6cd3be2 used names a rig a level too high from the real --out; on Windows the rule main 0c1d234 used names one a level too high from the spelled --out; either way the check refuses it');
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function runBuildInputRecordChecks(dir: string, out: string, say: Say): void {
  const root = join(realpathSync(dir), 'input-record-1556');
  const target = join(root, 'deep', 'target');
  mkdirSync(target, { recursive: true });
  const link = join(root, 'link');
  symlinkSync(target, link, 'junction');
  const linkedOut = join(link, 'out');
  // Leave parts/ absent, as in the Windows failure. Rig writes its own files without clearing unrelated entries.
  const staleRig = join(target, 'out', 'rig');
  mkdirSync(staleRig, { recursive: true });
  const staleFile = join(staleRig, 'stale-output.txt');
  writeFileSync(staleFile, 'from an earlier build');
  const runner = join(root, 'runner');
  mkdirSync(runner);
  const configPath = join(dir, 'config.json');
  // The wrong Windows climb reaches dir, which already holds the byte-identical original painting.png.
  const paintingName = 'painting-linked-1556.png';
  const painting = join(root, paintingName);
  cpSync(join(dir, 'painting.png'), painting);
  const manifest = join(dir, 'full', 'layers.json');
  const head = join(dir, 'head', 'layers.json');
  const fullLink = join(root, 'full-link');
  symlinkSync(join(realpathSync(dir), 'full'), fullLink, 'junction');
  const requirements = join(root, 'requirements.json');
  writeFileSync(requirements, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [] }));
  const givenSource = `../${paintingName}`;
  const given = ['build', '--requirements', '../requirements.json', '--config', '../../config.json', '--source', givenSource,
    '--full', '../full-link', '--head', '../../head/layers.json', '--out', '../link/out', '--no-extremes'];
  const linkedBuild = cli(given, runner);
  const recorded = readRecord(join(linkedOut, BUILD_RUN_FILE));
  const linkedInputs = recorded !== null && 'inputs' in recorded ? recorded.inputs : undefined;
  const windows = sep === '\\';
  const climb = windows ? '../..' : '../../..';
  const wantLinked = [
    { role: 'source', path: `${climb}/${paintingName}`, sha256: sha256File(painting) },
    { role: 'full', path: windows ? '../../full-link/layers.json' : '../../../../full/layers.json', sha256: sha256File(manifest) },
    { role: 'head', path: `${climb}/../head/layers.json`, sha256: sha256File(head) },
    { role: 'requirements', path: `${climb}/requirements.json`, sha256: sha256File(requirements) },
  ];
  const fromOut = windows ? linkedOut : join(target, 'out');
  const namedFilesMatch = wantLinked.every(({ path, sha256 }) => {
    const absolute = resolve(fromOut, path);
    return existsSync(absolute) && statSync(absolute).isFile() && sha256File(absolute) === sha256;
  });
  const wrongLinkRule = `${windows ? '../../..' : '../..'}/${paintingName}`;
  const wrongLinkMiss = !existsSync(resolve(fromOut, wrongLinkRule));
  const cwdSpellingMiss = !existsSync(resolve(fromOut, givenSource));
  const staleCleared = !existsSync(staleFile);
  say('BU1556C_LINKED_BUILD_OUT_REBASES_INPUTS_BY_THE_HOST_RULE',
    linkedBuild.status === 0 && JSON.stringify(linkedInputs) === JSON.stringify(wantLinked) && namedFilesMatch &&
      wrongLinkMiss && cwdSpellingMiss && staleCleared,
    `build exit ${linkedBuild.status}; inputs ${JSON.stringify(linkedInputs ?? null)}; expected files resolve with matching hashes ${namedFilesMatch}; ` +
      `planted ${wrongLinkRule} misses ${wrongLinkMiss}; planted ${givenSource} misses ${cwdSpellingMiss}; stale rig file cleared ${staleCleared}` +
      (linkedBuild.status === 0 ? '' : `; ${linkedBuild.out.trim().split('\n').slice(-3).join(' | ')}`),
    'issue #1556: build through a relative junction clears stale outputs and follows the #1555 host link rule from a non-parent cwd; the cwd spelling and the other host rule both miss the painting');

  // Reuse the build's products. A full repaint build also updates source_cover.json's painting hash.
  const recordedSourcePath = `../input-record-1556/${paintingName}`;
  const argv = ['build', '--source', recordedSourcePath, '--full', '../full', '--out', '.'];
  const recordInput = {
    command: 'build' as const, pkg: { name: '@rig-c/parts', version: '0.0.0' },
    startedAt: FIXED_TIME, finishedAt: FIXED_TIME, outDir: out, configPath, outputs: ['parts.json', 'rig/'], argv,
    inputs: { source: painting, full: join(dir, 'full') },
  };
  const before = buildRunRecord(recordInput);
  const original = readFileSync(painting);
  // Add a valid ancillary tEXt chunk immediately before the fixed-size IEND chunk.
  const repainted = Buffer.concat([original.subarray(0, -12), pngChunk('tEXt', Buffer.from('Comment\0build input control')), original.subarray(-12)]);
  const originalPixels = decodePngBytes(original, 'original source');
  const repaintedPixels = decodePngBytes(repainted, 're-encoded source');
  writeFileSync(painting, repainted);
  const after = buildRunRecord(recordInput);
  const beforeInputs = 'inputs' in before ? before.inputs : undefined;
  const afterInputs = 'inputs' in after ? after.inputs : undefined;
  const beforeSha = createHash('sha256').update(original).digest('hex');
  const afterSha = sha256File(painting);
  const pixelsMatch = originalPixels.width === repaintedPixels.width && originalPixels.height === repaintedPixels.height &&
    Buffer.from(originalPixels.data).equals(Buffer.from(repaintedPixels.data));
  const expectedAfter = { ...before, inputs: [
    { role: 'source', path: recordedSourcePath, sha256: afterSha },
    { role: 'full', path: '../full/layers.json', sha256: sha256File(manifest) },
  ] };
  const { inputs: _oldInputs, ...legacy } = { ...before, inputs: beforeInputs };
  const { inputs: _newInputs, ...legacyAfter } = { ...after, inputs: afterInputs };
  const legacyBytesEqual = JSON.stringify({ ...legacy, spec: 'rig-run/2' }) === JSON.stringify({ ...legacyAfter, spec: 'rig-run/2' });
  say('BU1556D_SAME_PIXELS_AND_FIXED_PRODUCTS_CHANGE_ONLY_THE_SOURCE_INPUT_HASH',
    beforeSha !== afterSha && pixelsMatch && before.outputs.length > 0 && legacyBytesEqual &&
    JSON.stringify(beforeInputs) === JSON.stringify([
      { ...expectedAfter.inputs[0], sha256: beforeSha }, expectedAfter.inputs[1],
    ]) && JSON.stringify(after) === JSON.stringify(expectedAfter) && JSON.stringify(before) !== JSON.stringify(after),
    `decoded pixels equal ${pixelsMatch}; hashes ${beforeSha} -> ${afterSha}; outputs ${before.outputs.length}; legacy records equal ${legacyBytesEqual}; only the source hash changed ${JSON.stringify(after) === JSON.stringify(expectedAfter)}`,
    'issue #1556: identical decoded pixels and products still bind distinct source bytes; the planted legacy shape stays identical and misses the repaint');

  const environment = join(root, 'environment.json');
  const windBand = join(root, 'wind-band.json');
  writeFileSync(environment, JSON.stringify({ spec: 'rigc-environment/1', steps: [{ t: 0, wind: [1, 0] }] }));
  writeFileSync(windBand, JSON.stringify({ spec: 'rig-parts-wind-band/1', min: 0, max: 2, step: 2,
    fps: 12, max_gap: 500, max_ghost: 500, pairs: ['topwear:bottomwear'] }));
  const withOptions = buildRunRecord({ ...recordInput, inputs: {
    source: painting, full: manifest, head, requirements, environment, windBand,
    alts: [{ source: painting, full: manifest }, { source: join(dir, 'painting.png'), full: join(dir, 'full'), head }],
  } });
  const optionInputs = 'inputs' in withOptions ? withOptions.inputs : undefined;
  const wantOptions = [
    ...expectedAfter.inputs,
    { role: 'head', path: '../head/layers.json', sha256: sha256File(head) },
    { role: 'requirements', path: '../input-record-1556/requirements.json', sha256: sha256File(requirements) },
    { role: 'environment', path: '../input-record-1556/environment.json', sha256: sha256File(environment) },
    { role: 'wind-band', path: '../input-record-1556/wind-band.json', sha256: sha256File(windBand) },
    { ...expectedAfter.inputs[0], role: 'alt[0].source' },
    { ...expectedAfter.inputs[1], role: 'alt[0].full' },
    { role: 'alt[1].source', path: '../painting.png', sha256: beforeSha },
    { ...expectedAfter.inputs[1], role: 'alt[1].full' },
    { role: 'alt[1].head', path: '../head/layers.json', sha256: sha256File(head) },
  ];
  say('BU1556E_OPTIONAL_FILES_AND_ALT_TUPLES_FOLLOW_ROLE_ORDER_AND_OMIT_ABSENT_ALT_HEAD',
    JSON.stringify(optionInputs) === JSON.stringify(wantOptions),
    `inputs ${JSON.stringify(optionInputs ?? null)}; expected roles ${wantOptions.map((entry) => entry.role).join(', ')}`,
    'issue #1556: the optional file roles come before the CLI alternate tuples, which retain their indices even when a head is absent');
}

/**
 * Issue #1554: CLI controls from a working directory (`runner/`, depth +1) that is NOT `--out`'s parent, writing into a
 * deeper `--out` (`outputs/deep/...`, depth +3) so every old cwd-relative path (`../...`) resolves to the wrong place
 * from `--out` and fails. Covers `assemble`'s `run.json` (`inputs[].path`, including `<dir>/layers.json` for directory
 * inputs) and `check.json`'s `requirements.file.path`, `environment.path` and `WIND_BAND.path`.
 */
function runOutRelativeInputRecordChecks(dir: string, out: string, say: Say): void {
  const runnerCwd = join(dir, 'runner-1554');
  mkdirSync(runnerCwd, { recursive: true });
  const asmOut = join(dir, 'outputs-1554', 'deep', 'assembled');
  const oldCwdPaths = { source: '../painting.png', full: '../full', head: '../head' };
  const asmRun = cli([
    'assemble',
    '--source', oldCwdPaths.source,
    '--full', oldCwdPaths.full,
    '--head', oldCwdPaths.head,
    '--config', '../config.json',
    '--out', '../outputs-1554/deep/assembled',
  ], runnerCwd);
  const stamp: RunStamp | null = existsSync(join(asmOut, RUN_STAMP_FILE))
    ? (JSON.parse(readFileSync(join(asmOut, RUN_STAMP_FILE), 'utf8')) as RunStamp)
    : null;
  const wantInputs = [
    { role: 'source', path: '../../../painting.png', sha256: sha256File(join(dir, 'painting.png')) },
    { role: 'full', path: '../../../full/layers.json', sha256: sha256File(join(dir, 'full', 'layers.json')) },
    { role: 'head', path: '../../../head/layers.json', sha256: sha256File(join(dir, 'head', 'layers.json')) },
  ];
  const inputsResolveFromOut =
    stamp?.inputs !== undefined &&
    stamp.inputs.length === 3 &&
    stamp.inputs.every((entry) => {
      const target = resolve(asmOut, entry.path);
      return existsSync(target) && statSync(target).isFile() && sha256File(target) === entry.sha256;
    });
  const plantedCwdFailsFromOut = Object.values(oldCwdPaths).every((oldRel) => !existsSync(resolve(asmOut, oldRel)));
  const asmReplayOut = join(dir, 'outputs-1554', 'deep', 'assembled-replay');
  mkdirSync(asmReplayOut, { recursive: true });
  const asmReplay = stamp?.inputs === undefined
    ? { status: -1, out: 'no stamp' }
    : cli([
        'assemble',
        ...stamp.inputs.flatMap((entry) => [`--${entry.role}`, resolve(asmOut, entry.path)]),
        '--config', resolve(asmOut, stamp.config.path),
        '--out', '.',
      ], asmReplayOut);
  const timelessStamp = (at: string): string => {
    if (!existsSync(join(at, RUN_STAMP_FILE))) return 'absent';
    const parsed = JSON.parse(readFileSync(join(at, RUN_STAMP_FILE), 'utf8')) as RunStamp;
    const { started_at: _s, finished_at: _f, ...rest } = parsed;
    return JSON.stringify(rest);
  };
  say('BU1554B_ASSEMBLE_FROM_NON_PARENT_CWD_RECORDS_OUT_RELATIVE_INPUTS_AND_LAYERS_JSON_AND_PLANTED_CWD_PATHS_FAIL',
    asmRun.status === 0 &&
      JSON.stringify(stamp?.inputs) === JSON.stringify(wantInputs) &&
      inputsResolveFromOut &&
      plantedCwdFailsFromOut &&
      asmReplay.status === 0 &&
      timelessStamp(asmOut) === timelessStamp(asmReplayOut),
    `assemble exit ${asmRun.status}; recorded inputs ${JSON.stringify(stamp?.inputs?.map((e) => e.path) ?? null)}; all resolve from --out to files matching sha256 ${inputsResolveFromOut}; planted cwd-relative paths [${Object.values(oldCwdPaths).join(', ')}] missing from --out ${plantedCwdFailsFromOut}; replay exit ${asmReplay.status}, stamps equal modulo clock ${timelessStamp(asmOut) === timelessStamp(asmReplayOut)}`,
    'issue #1554: run from a working directory that is not --out\'s parent, assemble records source, full/layers.json and head/layers.json relative to --out, each resolving from --out alone with matching sha256 while the old cwd-relative paths fail');

  // Create a wind-answering copy of the built rig with a leveraged child bone and an overlapping pair of slots so one
  // standalone check from the non-parent cwd exercises all three check.json input-file records together:
  // requirements.file.path, environment.path, and WIND_BAND.path.
  const physRigDir = join(dir, 'phys-rig-1554');
  cpSync(join(out, 'rig'), physRigDir, { recursive: true });
  const rigDoc = JSON.parse(readFileSync(join(physRigDir, 'rig.json'), 'utf8')) as {
    bones: Array<Record<string, unknown>>;
    slots: Array<{ name: string; bone: string; attachment?: string }>;
    skins: { default: Record<string, Record<string, unknown>> };
    constraints?: Array<Record<string, unknown>>;
  };
  rigDoc.bones.push({ name: 'tassel_1554', parent: 'skirt', length: 10 });
  const baseSlot = rigDoc.slots.find((s) => s.attachment !== undefined && rigDoc.skins.default[s.name]?.[s.attachment] !== undefined) ?? rigDoc.slots[0];
  const baseAttName = baseSlot.attachment ?? baseSlot.name;
  rigDoc.slots.push({ name: 'lining_1554', bone: baseSlot.bone, attachment: baseAttName });
  rigDoc.skins.default.lining_1554 = { [baseAttName]: structuredClone(rigDoc.skins.default[baseSlot.name][baseAttName]) };
  rigDoc.constraints = [
    ...(rigDoc.constraints ?? []),
    { type: 'physics', name: 'rec1554_phys', bone: 'tassel_1554', wind: 1, gravity: 1, rotate: 1, inertia: 0.5, strength: 100, damping: 0.85, mass: 1, mix: 1 },
  ];
  writeFileSync(join(physRigDir, 'rig.json'), `${JSON.stringify(rigDoc, null, 2)}\n`);
  const reqPath = join(dir, 'reqs-1554.json');
  const envPath = join(dir, 'env-1554.json');
  const wbPath = join(dir, 'wb-1554.json');
  writeFileSync(reqPath, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [] }));
  writeFileSync(envPath, JSON.stringify({ spec: 'rigc-environment/1', steps: [{ t: 0, wind: [1, 0], gravity: [0, 1] }] }));
  writeFileSync(wbPath, JSON.stringify({
    spec: 'rig-parts-wind-band/1',
    min: 0,
    max: 2,
    step: 2,
    fps: 12,
    max_gap: 500,
    max_ghost: 500,
    pairs: [`${baseSlot.name}:lining_1554`],
  }));

  const chkOut = join(dir, 'outputs-1554', 'deep', 'checked');
  const oldReqArg = '../reqs-1554.json';
  const oldEnvArg = '../env-1554.json';
  const oldWbArg = '../wb-1554.json';
  const chkRun = cli([
    'check',
    '--rig', '../phys-rig-1554',
    '--out', '../outputs-1554/deep/checked',
    '--requirements', oldReqArg,
    '--environment', oldEnvArg,
    '--wind-band', oldWbArg,
    '--no-extremes',
  ], runnerCwd);
  const chkReport = existsSync(join(chkOut, 'check.json'))
    ? (JSON.parse(readFileSync(join(chkOut, 'check.json'), 'utf8')) as {
        requirements?: { file?: { path?: string; sha256?: string } };
        environment?: { path?: string; sha256?: string };
        WIND_BAND?: { path?: string; sha256?: string };
      })
    : null;
  const chkRec = readRecord(join(chkOut, CHECK_RUN_FILE));
  const chkReplayDir = join(dir, 'outputs-1554', 'deep', 'checked-replay');
  mkdirSync(chkReplayDir, { recursive: true });
  const chkReplay = chkRec === null ? { status: -1, out: 'no record' } : cli(chkRec.argv, chkReplayDir);
  const reqRecorded = chkReport?.requirements?.file;
  const envRecorded = chkReport?.environment;
  const wbRecorded = chkReport?.WIND_BAND;
  const resolvesWithHash = (entry: { path?: string; sha256?: string } | undefined, expectedFile: string): boolean => {
    if (entry?.path === undefined || entry.sha256 === undefined) return false;
    const target = resolve(chkOut, entry.path);
    return target === resolve(expectedFile) && existsSync(target) && sha256File(target) === entry.sha256;
  };
  const plantedCheckCwdFails = [oldReqArg, oldEnvArg, oldWbArg].every((oldArg) => !existsSync(resolve(chkOut, oldArg)));
  const replayCheckSame =
    existsSync(join(chkOut, 'check.json')) &&
    existsSync(join(chkReplayDir, 'check.json')) &&
    readFileSync(join(chkOut, 'check.json')).equals(readFileSync(join(chkReplayDir, 'check.json')));
  say('BU1554C_CHECK_JSON_REQUIREMENTS_ENVIRONMENT_AND_WIND_BAND_PATHS_RESOLVE_FROM_OUT_AND_REPLAY_BYTE_EQUAL',
    chkRun.status === 0 &&
      reqRecorded?.path === '../../../reqs-1554.json' &&
      envRecorded?.path === '../../../env-1554.json' &&
      wbRecorded?.path === '../../../wb-1554.json' &&
      resolvesWithHash(reqRecorded, reqPath) &&
      resolvesWithHash(envRecorded, envPath) &&
      resolvesWithHash(wbRecorded, wbPath) &&
      plantedCheckCwdFails &&
      chkReplay.status === 0 &&
      replayCheckSame,
    `check exit ${chkRun.status}; recorded requirements=${JSON.stringify(reqRecorded?.path)}, environment=${JSON.stringify(envRecorded?.path)}, WIND_BAND=${JSON.stringify(wbRecorded?.path)}; all resolve from --out with matching sha256 ${resolvesWithHash(reqRecorded, reqPath) && resolvesWithHash(envRecorded, envPath) && resolvesWithHash(wbRecorded, wbPath)}; planted cwd-relative paths fail from --out ${plantedCheckCwdFails}; sibling replay exit ${chkReplay.status}, check.json byte-equal ${replayCheckSame}${chkRun.status === 0 ? '' : `; ${chkRun.out.trim().split('\n').slice(-3).join(' | ')}`}`,
    'issue #1554: check.json records requirements.file.path, environment.path and WIND_BAND.path relative to --out, so each resolves from --out alone, planted cwd-relative paths fail, and check-run.json replayed from a sibling writes byte-identical check.json');

  // Issue #1554, review P2 + macOS /var -> /private/var shape: a --out directory that does not exist yet under a
  // linked ancestor (`link -> deep/real`, `--out link/new-check`), with the input files beside `link` (and the
  // both-under-link shape of BU178/BU211 on macOS). Before `mkdirSync` creates `new-check`, `realWhereItExists`
  // resolves the deepest existing prefix (`link` -> `deep/real`) and appends `new-check`; the old rule left a
  // nonexistent `--out` unresolved while resolving the input's existing directory, climbing the wrong number of levels
  // and changing its answer on a repeat run once `--out` existed. Windows stays as spelled (#1551).
  const sandbox = join(realpathSync(dir), 'linked-out-1554', 'ws');
  const linkedTarget = join(sandbox, 'deep', 'real');
  mkdirSync(linkedTarget, { recursive: true });
  const link = join(sandbox, 'link');
  symlinkSync(linkedTarget, link, 'junction');
  const besideReq = join(sandbox, 'reqs-linked-1554.json');
  const besideEnv = join(sandbox, 'env-linked-1554.json');
  const besideWb = join(sandbox, 'wb-linked-1554.json');
  writeFileSync(besideReq, readFileSync(reqPath));
  writeFileSync(besideEnv, readFileSync(envPath));
  writeFileSync(besideWb, readFileSync(wbPath));
  writeFileSync(join(linkedTarget, 'reqs-in-link-1554.json'), readFileSync(reqPath));
  const newCheckOut = join(link, 'new-check');
  const outAbsentBefore = !existsSync(newCheckOut);
  const oldPosixRule = (p: string): string => (existsSync(p) ? realpathSync(p) : p);
  const windows = sep === '\\';
  const ancestorResolved = realWhereItExists(join(link, 'missing', 'leaf')) === join(realpathSync(linkedTarget), 'missing', 'leaf');
  const ancestorPlanted = oldPosixRule(join(link, 'missing', 'leaf')) === join(link, 'missing', 'leaf');
  const sameLinkFixed = argvPathFromOut(join(link, 'reqs-in-link-1554.json'), join(link, 'req-flag', 'check'), sandbox, undefined, realWhereItExists);
  const sameLinkPlanted = argvPathFromOut(join(link, 'reqs-in-link-1554.json'), join(link, 'req-flag', 'check'), sandbox, undefined, oldPosixRule);
  const wantPreMkdirPlanted = windows ? '../../../reqs-linked-1554.json' : '../../reqs-linked-1554.json';
  const plantedPreMkdir = argvPathFromOut('reqs-linked-1554.json', 'link/new-check', sandbox, undefined, windows ? realWhereItExists : oldPosixRule);
  const rigFromSandbox = relative(sandbox, physRigDir).split('\\').join('/');
  const linkCheckArgs = [
    'check',
    '--rig', rigFromSandbox,
    '--out', 'link/new-check',
    '--requirements', 'reqs-linked-1554.json',
    '--environment', 'env-linked-1554.json',
    '--wind-band', 'wb-linked-1554.json',
    '--no-extremes',
  ];
  const firstLinkRun = cli(linkCheckArgs, sandbox);
  const firstLinkBytes = existsSync(join(newCheckOut, 'check.json')) ? readFileSync(join(newCheckOut, 'check.json')) : Buffer.alloc(0);
  const secondLinkRun = cli(linkCheckArgs, sandbox);
  const secondLinkBytes = existsSync(join(newCheckOut, 'check.json')) ? readFileSync(join(newCheckOut, 'check.json')) : Buffer.alloc(0);
  const linkChkReport = firstLinkBytes.length > 0
    ? (JSON.parse(firstLinkBytes.toString('utf8')) as {
        requirements?: { file?: { path?: string; sha256?: string } };
        environment?: { path?: string; sha256?: string };
        WIND_BAND?: { path?: string; sha256?: string };
      })
    : null;
  const wantFromLinkedOut = (file: string): string => (windows ? `../../${file}` : `../../../${file}`);
  const fromLinkedOut = (rel: string): string => resolve(windows ? newCheckOut : realpathSync(newCheckOut), rel);
  const resolvesFromLinkedOut = (entry: { path?: string; sha256?: string } | undefined, expectedFile: string): boolean => {
    if (entry?.path === undefined || entry.sha256 === undefined) return false;
    const target = fromLinkedOut(entry.path);
    const kernelOk = windows || (existsSync(`${newCheckOut}/${entry.path}`) && sha256File(`${newCheckOut}/${entry.path}`) === entry.sha256);
    return kernelOk && target === realpathSync(expectedFile) && existsSync(target) && sha256File(target) === entry.sha256;
  };
  const linkReqRec = linkChkReport?.requirements?.file;
  const linkEnvRec = linkChkReport?.environment;
  const linkWbRec = linkChkReport?.WIND_BAND;
  const plantedMissesFromLinkedOut =
    !existsSync(fromLinkedOut(plantedPreMkdir)) &&
    (windows || !existsSync(`${newCheckOut}/${plantedPreMkdir}`));
  const repeatByteEqual = firstLinkBytes.length > 0 && firstLinkBytes.equals(secondLinkBytes);
  say('BU1554D_NONEXISTENT_OUT_UNDER_A_LINKED_ANCESTOR_REBASES_THROUGH_THE_ANCESTOR_AND_PLANTED_OLD_RULE_FAILS',
    outAbsentBefore &&
      ancestorResolved &&
      ancestorPlanted &&
      sameLinkFixed === '../../reqs-in-link-1554.json' &&
      sameLinkPlanted === '../../../deep/real/reqs-in-link-1554.json' &&
      plantedPreMkdir === wantPreMkdirPlanted &&
      firstLinkRun.status === 0 &&
      secondLinkRun.status === 0 &&
      linkReqRec?.path === wantFromLinkedOut('reqs-linked-1554.json') &&
      linkEnvRec?.path === wantFromLinkedOut('env-linked-1554.json') &&
      linkWbRec?.path === wantFromLinkedOut('wb-linked-1554.json') &&
      resolvesFromLinkedOut(linkReqRec, besideReq) &&
      resolvesFromLinkedOut(linkEnvRec, besideEnv) &&
      resolvesFromLinkedOut(linkWbRec, besideWb) &&
      plantedMissesFromLinkedOut &&
      repeatByteEqual,
    `absent before=${outAbsentBefore}; ancestor resolved=${ancestorResolved} (planted=${ancestorPlanted}); both-under-link=${JSON.stringify(sameLinkFixed)} (planted old rule=${JSON.stringify(sameLinkPlanted)}); check exit ${firstLinkRun.status}/${secondLinkRun.status}, requirements=${JSON.stringify(linkReqRec?.path)}, environment=${JSON.stringify(linkEnvRec?.path)}, WIND_BAND=${JSON.stringify(linkWbRec?.path)}; planted=${JSON.stringify(plantedPreMkdir)} misses=${plantedMissesFromLinkedOut}; repeat byte-equal=${repeatByteEqual}${firstLinkRun.status === 0 ? '' : `; ${firstLinkRun.out.trim().split('\n').slice(-3).join(' | ')}`}`,
    'issue #1554: when --out does not exist yet beneath a linked ancestor, realWhereItExists resolves the deepest existing prefix and appends missing segments (Windows stays as spelled, #1551), so recorded paths resolve from --out on the first run and match a repeat run byte for byte, while the planted pre-fix rule misses');
}
