/**
 * The `rig-run/2` run record `check` and `build` write (issue #1541), on the build suite's green build.
 *
 * Every expected value is written by hand from the fixture's layout: the record's argv is the command, the options as
 * given in the flag-table order, each path relative to `--out` and `--out` as `.`. The replays run from a sibling of
 * the original `--out`, at the same depth, so every recorded relative path names the same file.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, posix, relative, resolve, win32 } from 'node:path';
import { BUILD_RUN_FILE } from '../src/build.ts';
import { makeOutDir } from '../src/outputpaths.ts';
import { argvPathFromOut, argvReplayProblems, type ArgvTable, CHECK_RUN_FILE, effectiveArgv, isRunRecordFile, recordArgv, recordedConfigPath, RUN_RECORD_SPEC, type RunRecord } from '../src/runstamp.ts';

type Say = (name: string, ok: boolean, detail: string, why: string) => void;

const ROOT = resolve(import.meta.dir, '..');
/** The record's keys, in order: rig-run/1's for the command, then argv (`config` on build only). */
export const RECORD_KEYS_CHECK = ['spec', 'package', 'command', 'started_at', 'finished_at', 'outputs', 'argv'];
export const RECORD_KEYS_BUILD = ['spec', 'package', 'command', 'started_at', 'finished_at', 'config', 'outputs', 'argv'];

/** A table shaped like a command's flag row, for the pure controls: two path flags, one plain, one compound, two switches. */
const TABLE: ArgvTable = {
  valued: ['--rig', '--out', '--parts', '--page-edges', '--alt'],
  switches: ['--seam-pairs', '--no-extremes'],
  paths: ['--rig', '--out', '--parts'],
  compound: { '--alt': (value, path) => { const [name, rest] = value.split('='); return `${name}=${rest.split(':').map(path).join(':')}`; } },
};

function cli(args: readonly string[], cwd: string): { status: number; out: string } {
  const r = spawnSync('bun', [join(ROOT, 'cli.ts'), ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
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
  say('BU1541E_A_GREEN_BUILD_WRITES_BUILD_RUN_JSON_WITH_ITS_KEYS_ITS_VERSION_AND_ITS_ARGV',
    built !== null && JSON.stringify(Object.keys(built)) === JSON.stringify(RECORD_KEYS_BUILD) && built.spec === RUN_RECORD_SPEC &&
      built.package.name === pkgName && built.package.version === version && built.command === 'build' && built.config?.path === '../config.json' &&
      built.argv[0] === 'build' && built.argv[built.argv.indexOf('--out') + 1] === '.' && built.argv[built.argv.indexOf('--config') + 1] === '../config.json' &&
      outputs.includes('check/check.json') && outputs.includes('parts.json') && !outputs.some(isRunRecordFile),
    `keys ${JSON.stringify(built === null ? null : Object.keys(built))}; package ${built?.package.name}@${built?.package.version} against --version ${version}; config ${built?.config?.path}; argv ${JSON.stringify(built?.argv)}; ${outputs.length} output(s), check/check.json ${outputs.includes('check/check.json')}, a run record among them ${outputs.some(isRunRecordFile)}`,
    'issue #1541: the version is read from package.json the way --version reads it, never written by hand; the config and every path are relative to --out');

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
  const checked = cli(['check', '--rig', 'out/rig', '--out', 'check-1541', '--parts', 'out', '--no-extremes'], dir);
  const rec = readRecord(join(dir, 'check-1541', CHECK_RUN_FILE));
  const checkWant = ['check', '--rig', '../out/rig', '--out', '.', '--parts', '../out', '--no-extremes'];
  const checkReplayDir = join(dir, 'check-1541-replay');
  mkdirSync(checkReplayDir, { recursive: true });
  const checkReplay = rec === null ? { status: -1, out: 'no record' } : cli(rec.argv, checkReplayDir);
  const recAgain = readRecord(join(checkReplayDir, CHECK_RUN_FILE));
  const checkSame = existsSync(join(checkReplayDir, 'check.json')) &&
    readFileSync(join(dir, 'check-1541', 'check.json')).equals(readFileSync(join(checkReplayDir, 'check.json')));
  say('BU1541G_CHECK_WRITES_CHECK_RUN_JSON_AND_ITS_ARGV_REPLAYED_FROM_OUT_IS_THE_SAME_CHECK',
    checked.status === 0 && rec !== null && JSON.stringify(Object.keys(rec)) === JSON.stringify(RECORD_KEYS_CHECK) && rec.package.version === version &&
      JSON.stringify(rec.argv) === JSON.stringify(checkWant) && rec.outputs.some((o) => o.path === 'check.json') &&
      checkReplay.status === 0 && checkSame && timeless(recAgain) === timeless(rec),
    `check exit ${checked.status}; keys ${JSON.stringify(rec === null ? null : Object.keys(rec))}; argv ${JSON.stringify(rec?.argv)} against ${JSON.stringify(checkWant)}; replay exit ${checkReplay.status}, check.json byte-equal ${checkSame}, records equal but for the times ${timeless(recAgain) === timeless(rec)}`,
    'issue #1541: a check given relative paths from its working directory records them from --out; the replay is the same check');

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
}

/** `check`'s flag row as cli.ts records it, for the planted argv: the valued flags and switches this control gives. */
const CHECK_PLANT_TABLE: ArgvTable = { valued: ['--rig', '--out', '--parts'], switches: ['--no-extremes'], paths: ['--rig', '--out', '--parts'] };

/**
 * Issue #1544, the real command: `--out` given through a directory link whose target sits deeper than the link, and
 * `--rig` and `--parts` given relative to a working directory the process reports by its real path (as
 * `/var` -> `/private/var` on macOS; here a link of our own, so every host has it). The record's argv, replayed with
 * the CLI from the `--out` directory, is the same check and writes the same record but for the times. The plant
 * records the same arguments by plain path arithmetic (no link resolved), and its replay from `--out` does not find
 * the rig.
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
  const replay = rec === null ? { status: -1, out: 'no record' } : cli(rec.argv, given);
  const again = readRecord(join(given, CHECK_RUN_FILE));
  // rigc writes skeleton.images relative to the --out it was handed, by plain arithmetic: the first run hands it the
  // linked spelling and the replay the real one, so build/skeleton.json, the model that hashes it and check.json's
  // model_sha256 may differ (rig-c core's own spelling, outside this record). Every other key and digest is the same.
  // rig-c/core#1773 tightens this: once core spells images through links, `spelled` goes and the records match whole.
  const spelled = new Set(['build/skeleton.json', 'build/skeleton.model.json', 'check.json']);
  const differ = (a: RunRecord | null, b: RunRecord | null): string[] => a === null || b === null ? ['absent']
    : [...new Set([...a.outputs, ...b.outputs].map((o) => o.path))].filter((p) =>
      JSON.stringify(a.outputs.find((o) => o.path === p)) !== JSON.stringify(b.outputs.find((o) => o.path === p)));
  const aside = (r: RunRecord | null): string => r === null ? 'absent' : timeless({ ...r, outputs: r.outputs.map((o) => spelled.has(o.path) ? { ...o, sha256: '<spelled by rigc>' } : o) });
  const moved = differ(rec, again);
  say('BU1544A_ARGV_RECORDED_THROUGH_A_LINKED_OUT_REPLAYS_FROM_OUT_AS_THE_SAME_CHECK',
    first.status === 0 && rec !== null && recordedRig === `../${rig}` && replay.status === 0 && aside(again) === aside(rec) && moved.every((p) => spelled.has(p)),
    `check exit ${first.status}; --rig given ${JSON.stringify(rig)} from the real working directory, recorded ${JSON.stringify(recordedRig)}; replay from --out exit ${replay.status}; records equal but for the times and rigc's spelled files ${aside(again) === aside(rec)}; digests that moved ${JSON.stringify(moved)}${replay.status === 0 ? '' : `; ${replay.out.trim().split('\n').slice(-2).join(' | ')}`}`,
    'issue #1544: --out and each path\'s directory are resolved through their links before the path is rebased, so the replay climbs the real tree; the link sits two levels above its target, so one level more is the hand-written answer');

  // The plant: the same arguments recorded by plain path arithmetic (the identity for link resolution), replayed the same way.
  const planted = recordArgv('check', args, CHECK_PLANT_TABLE, given, work, undefined, (p) => p);
  const plantedRig = planted[planted.indexOf('--rig') + 1];
  const plantedReplay = cli(planted, given);
  say('BU1544B_PLANTED_ARGV_BY_PLAIN_ARITHMETIC_CLIMBS_OUT_THROUGH_THE_LINK_AND_THE_REPLAY_FAILS',
    plantedRig === rig && plantedReplay.status !== 0 && plantedReplay.status !== 2 && !existsSync(join(given, CHECK_RUN_FILE)),
    `planted --rig ${JSON.stringify(plantedRig)} (the link is two levels shallower than its target, so plain arithmetic keeps the working directory's climb); replay exit ${plantedReplay.status}, record after ${existsSync(join(given, CHECK_RUN_FILE))}`,
    'issue #1544: the arithmetic main 6cd3be2 used; replayed from the real --out directory it names a rig two levels too high, and the check refuses it');
}
