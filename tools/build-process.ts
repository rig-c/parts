/** Ordinary build stage processes. No public option selects this internal protocol. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleStage, checkStage, rigStage, type AssembleOutputs, type AssembleStageInput, type CheckStageInput, type RigStageInput } from '../src/build.ts';
import { rigcRunnerAt, type CheckReport, type RigcRunner } from '../src/check.ts';
import { PartsError, type Problem } from '../src/errors.ts';

export function processRigcRunner(bin: string): RigcRunner {
  return rigcRunnerAt(bin, (b, args) => {
    const r = spawnSync(b, [...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.error !== undefined) return { status: 127, out: `could not start ${b}: ${r.error.message}` };
    return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
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
    if (child.error !== undefined) throw new Error('BUILD_STAGE_CHILD: ' + job.stage + ' could not start — ' + child.error.message);
    return readBuildReceipt(job.stage, child.status, child.signal, existsSync(result) ? readFileSync(result, 'utf8') : '');
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
