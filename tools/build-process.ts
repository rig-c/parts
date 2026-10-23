/** Ordinary build stage processes. No public option selects this internal protocol. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { assembleStage, checkStage, rigStage, type AssembleOutputs, type AssembleStageInput, type CheckStageInput, type RigStageInput } from '../src/build.ts';
import { rigcRunnerAt, type CheckReport, type RigcRunner } from '../src/check.ts';
import { PartsError, type Problem } from '../src/errors.ts';

/** Preserve native/custom executables; adapt only a proven package-manager script shim. */
export function selectedRigcCommand(bin: string, platform: NodeJS.Platform = process.platform): { command: string; prefix: string[] } {
  if (platform !== 'win32' || extname(bin).toLowerCase() === '.exe') return { command: bin, prefix: [] };
  const fail = (detail: string): never => { throw new Error('RIGC_LAUNCHER_IDENTITY: ' + bin + ' — ' + detail + '; the selected executable must keep its own launcher'); };
  try {
    const selected = resolve(bin);
    // findRigc selected this exact local .bin path; do not resolve an ambient package.
    if (basename(selected) !== 'rigc' || basename(dirname(selected)) !== '.bin') return fail('unknown or custom script shim');
    const packageRoot = join(dirname(dirname(selected)), 'rig-c');
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { name?: unknown; bin?: unknown };
    const binMap = manifest.bin;
    const declared = typeof binMap === 'string' ? binMap : binMap !== null && typeof binMap === 'object' ? (binMap as Record<string, unknown>).rigc : undefined;
    if (manifest.name !== 'rig-c' || typeof declared !== 'string') return fail('the selected package does not declare rigc');
    const entry = resolve(packageRoot, declared);
    const within = relative(realpathSync.native(packageRoot), realpathSync.native(entry));
    if (within === '..' || within.startsWith('..' + sep) || isAbsolute(within) || !statSync(entry).isFile()) return fail('bin target is outside the selected package');
    const launcher = readFileSync(entry, 'utf8');
    if (launcher.split(/\r?\n/, 1)[0] !== '#!/usr/bin/env node') return fail('declared bin is not a Node launcher');
    if (realpathSync.native(selected) !== realpathSync.native(entry)) {
      // npm cmd-shim's shell companion is checked in full, including both forwarding branches.
      // Extra custom commands, another target or an unknown shim format are refused, never bypassed.
      const reference = relative(dirname(selected), entry).split(sep).join('/');
      if (/["$\x60\r\n]/.test(reference)) return fail('target cannot be identified literally in the package shim');
      const expected = [
        '#!/bin/sh', 'basedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")',
        'case \x60uname\x60 in', '*CYGWIN*|*MINGW*|*MSYS*)', 'if command -v cygpath > /dev/null 2>&1; then',
        'basedir=\x60cygpath -w "$basedir"\x60', 'fi', ';;', 'esac',
        'if [ -x "$basedir/node" ]; then', 'exec "$basedir/node" "$basedir/' + reference + '" "$@"',
        'else', 'exec node "$basedir/' + reference + '" "$@"', 'fi',
      ];
      const actual = readFileSync(selected, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const equal = actual.length === expected.length && actual.every((line, i) => line === expected[i] ||
        (i === 10 && line === expected[i].replace('node" ', 'node"  ')) || (i === 12 && line === expected[i].replace('exec node ', 'exec node  ')));
      if (!equal) return fail('selected shim is not the declared launcher forwarding wrapper');
    }
    return { command: 'node', prefix: [entry] };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('RIGC_LAUNCHER_IDENTITY:')) throw error;
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function childStarted(child: { status: number | null; signal: string | null }): boolean {
  return typeof child.status === 'number' || (typeof child.signal === 'string' && child.signal !== '');
}

export function processRigcRunner(bin: string): RigcRunner {
  return rigcRunnerAt(bin, (b, args) => {
    let launch: { command: string; prefix: string[] };
    try { launch = selectedRigcCommand(b); }
    catch (error) { return { status: 127, out: error instanceof Error ? error.message : String(error) }; }
    const r = spawnSync(launch.command, [...launch.prefix, ...args], { shell: false, windowsHide: true, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (!childStarted(r)) return { status: 127, out: 'could not start ' + b + ': ' + (r.error?.message ?? 'no exit status or signal was reported') };
    return { status: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') };
  });
}

type Stage = 'assemble' | 'rig' | 'check';
export type BuildProcessJob =
  | { stage: 'assemble'; bin: string; input: AssembleStageInput; outputs: AssembleOutputs }
  | { stage: 'rig'; bin: string; input: Omit<RigStageInput, 'reduce'>; scratch: string }
  | { stage: 'check'; bin: string; input: CheckStageInput };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function problems(value: unknown): value is Problem[] {
  return Array.isArray(value) && value.length > 0 && value.every((p) => record(p) && typeof p.code === 'string' && typeof p.object === 'string' && typeof p.detail === 'string');
}
function resultError(stage: Stage, detail: string): never {
  throw new Error('BUILD_STAGE_RESULT: ' + stage + ' child — ' + detail + '; a matching complete receipt is required');
}
function checkReport(value: unknown): value is CheckReport {
  if (!record(value) || !record(value.figures) || typeof value.figures.PASS !== 'boolean') return false;
  const arrays = ['gateHtml', 'pack', 'packOpaque', 'problems', 'written', 'besideIdle'];
  if (!arrays.every((key) => Array.isArray(value[key]))) return false;
  if (!record(value.bars) || !Array.isArray(value.bars.measured) || !Array.isArray(value.bars.skipped)) return false;
  if (!record(value.motionSeam) || !record(value.cloth)) return false;
  if (!['idle', 'loopPhysics', 'seamViewport', 'requirements'].every((key) => Object.hasOwn(value, key))) return false;
  return (value.pack as unknown[]).every((p) => record(p) && typeof p.line === 'string' && typeof p.page === 'string' &&
    ['width', 'height', 'regions', 'coveredPct', 'padding'].every((key) => typeof p[key] === 'number') &&
    (p.pageEdges === 'free' || p.pageEdges === 'pot') && (p.packShape === 'rect' || p.packShape === 'polygon')) &&
    (value.problems as unknown[]).every((p) => record(p) && typeof p.code === 'string' && typeof p.object === 'string' && typeof p.detail === 'string');
}

/** Decode only a matching successful stage or its original named input refusal. */
export function readBuildReceipt(stage: 'check', status: number | null, signal: string | null, text: string): CheckReport;
export function readBuildReceipt(stage: 'assemble' | 'rig', status: number | null, signal: string | null, text: string): void;
export function readBuildReceipt(stage: Stage, status: number | null, signal: string | null, text: string): CheckReport | void;
export function readBuildReceipt(stage: Stage, status: number | null, signal: string | null, text: string): CheckReport | void {
  if (signal !== null || status === null || (status !== 0 && status !== 1) || (status !== 0 && text === '')) {
    throw new Error('BUILD_STAGE_CHILD: ' + stage + ' child — exit ' + status + ', signal ' + signal + '; no later stage ran');
  }
  let row: unknown;
  try { row = JSON.parse(text); } catch { return resultError(stage, 'missing or malformed JSON'); }
  if (!record(row) || row.version !== 1 || row.stage !== stage) return resultError(stage, 'wrong version or stage');
  if (row.kind === 'refused') {
    if (status !== 1 || !problems(row.problems)) return resultError(stage, 'refusal must exit 1 and name at least one complete problem');
    throw new PartsError(row.problems);
  }
  if (row.kind !== 'done') return resultError(stage, 'unknown receipt kind');
  if (status !== 0) throw new Error('BUILD_STAGE_CHILD: ' + stage + ' child — exit ' + status + ' with a completion receipt; no later stage ran');
  if (stage !== 'check') {
    if (Object.hasOwn(row, 'report') || Object.hasOwn(row, 'sweepSteps')) return resultError(stage, 'a void stage returned an invented check report');
    return;
  }
  if (!checkReport(row.report)) return resultError(stage, 'check report is incomplete');
  if (row.sweepSteps !== null && (!Array.isArray(row.sweepSteps) || !row.sweepSteps.every((p) =>
    Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && record(p[1]) && typeof p[1].left === 'number' && typeof p[1].right === 'number'))) {
    return resultError(stage, 'sweepSteps must be null or the original map entries');
  }
  const report = row.report;
  if (row.sweepSteps !== null) report.sweepSteps = new Map(row.sweepSteps as Array<[string, { left: number; right: number }]>);
  return report;
}

/** The check's one optional Map is carried as entries; every other field is the original report. */
export function encodeCheckReceipt(report: CheckReport): string {
  return JSON.stringify({ version: 1, stage: 'check', kind: 'done', report: { ...report, sweepSteps: undefined },
    sweepSteps: report.sweepSteps === undefined ? null : [...report.sweepSteps] });
}

/** Minimum Bun may attach error to an ordinary nonzero exit; only an unstarted child is a launch failure. */
export function readBuildChild(stage: Stage, child: { status: number | null; signal: string | null; error?: Error }, text: string): CheckReport | void {
  if (!childStarted(child) && child.error !== undefined) throw new Error('BUILD_STAGE_CHILD: ' + stage + ' could not start — ' + child.error.message);
  return readBuildReceipt(stage, child.status ?? null, child.signal ?? null, text);
}

/** Inherited descriptors keep stdout/stderr write order; no shell parses paths or flags. */
export function launchBuildChild(argv: readonly string[]): { status: number | null; signal: string | null; error?: Error } {
  const [command, ...args] = argv;
  if (command === undefined) throw new Error('BUILD_STAGE_CHILD: executable is required');
  return spawnSync(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
}

export function runBuildProcess(job: Extract<BuildProcessJob, { stage: 'check' }>, home: string): CheckReport;
export function runBuildProcess(job: Exclude<BuildProcessJob, { stage: 'check' }>, home: string): void;
export function runBuildProcess(job: BuildProcessJob, home: string): CheckReport | void {
  mkdirSync(home, { recursive: true });
  const request = join(home, job.stage + '.request.json');
  const result = join(home, job.stage + '.result.json');
  rmSync(result, { force: true });
  writeFileSync(request, JSON.stringify(job));
  try {
    const child = launchBuildChild([process.execPath, import.meta.path, request, result]);
    return readBuildChild(job.stage, child, existsSync(result) ? readFileSync(result, 'utf8') : '');
  } finally {
    rmSync(request, { force: true });
    rmSync(result, { force: true });
  }
}

function requestError(detail: string): never {
  throw new PartsError([{ code: 'BUILD_STAGE_REQUEST', object: 'internal build worker', detail: detail + '; a complete assemble, rig or check request is required' }]);
}
function readJob(path: string): BuildProcessJob {
  let job: unknown;
  try { job = JSON.parse(readFileSync(path, 'utf8')); } catch { return requestError('request file is missing or malformed'); }
  if (!record(job) || typeof job.bin !== 'string' || !record(job.input)) return requestError('request must name its runner and typed input');
  const input = job.input;
  const strings = (keys: string[]): boolean => keys.every((key) => typeof input[key] === 'string');
  if (job.stage === 'assemble') {
    if (!strings(['config', 'source', 'full', 'seam', 'project']) || !(input.head === null || typeof input.head === 'string') ||
      !record(job.outputs) || !['partsJson', 'partsDir', 'recomposite', 'errorMap'].every((key) => typeof (job.outputs as Record<string, unknown>)[key] === 'string')) return requestError('assemble input or output paths are incomplete');
  } else if (job.stage === 'rig') {
    if (!strings(['config', 'parts', 'out']) || typeof job.scratch !== 'string' || Object.hasOwn(input, 'reduce')) return requestError('rig input or scratch is incomplete, or contains a nonserializable reducer');
  } else if (job.stage === 'check') {
    if (!strings(['rig', 'out'])) return requestError('check input paths are incomplete');
  } else return requestError('unknown stage ' + JSON.stringify(job.stage));
  return job as unknown as BuildProcessJob;
}

function worker(args: string[]): number {
  if (args.length !== 2 || args.some((a) => a === '' || a.startsWith('--'))) return requestError('expected exactly one request path and one result path');
  const job = readJob(args[0]);
  const runner = processRigcRunner(job.bin);
  const log = (line: string): void => { console.log('[' + job.stage + '] ' + line); };
  try {
    let report: CheckReport | undefined;
    if (job.stage === 'assemble') assembleStage(job.input, job.outputs, log);
    else if (job.stage === 'rig') rigStage(job.input, runner, job.scratch, log);
    else report = checkStage(job.input, runner, job.bin, log);
    writeFileSync(args[1], report === undefined ? JSON.stringify({ version: 1, stage: job.stage, kind: 'done' }) : encodeCheckReceipt(report));
    return 0;
  } catch (err) {
    if (!(err instanceof PartsError)) throw err;
    writeFileSync(args[1], JSON.stringify({ version: 1, stage: job.stage, kind: 'refused', problems: err.problems }));
    return 1;
  }
}
if (import.meta.main) {
  try { process.exit(worker(process.argv.slice(2))); }
  catch (err) {
    if (!(err instanceof PartsError)) throw err;
    console.error(err.message);
    process.exit(1);
  }
}
