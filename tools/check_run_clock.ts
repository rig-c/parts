/** Production CLI and stamp writer controls with local stage doubles; no renderer or GPU. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportMeasuredCase, RunTally, tallyFaults, TEXT_FILE, treeFiles, treeGuideCase } from '../selftest.ts';
import { buildRunStamp, type RunStamp } from '../src/runstamp.ts';
import { rigJsonText } from '../src/rig.ts';

const root = join(import.meta.dir, '..');
const work = mkdtempSync(join(tmpdir(), 'parts-run-clock-'));
const cases: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string): void => { cases.push({ name: `RC1217_${name}`, ok, detail }); };
const preload = join(work, 'stages.ts');
// Keep all real module exports except the two expensive stage boundaries. The CLI,
// argument parsing, clock, stamp clearing, output selection and writer are production.
writeFileSync(preload, `
import { mock } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const modulePath = ${JSON.stringify(join(root, 'src/build.ts'))};
const real = await import(modulePath);
function output(out, files) {
  for (const file of files) {
    const path = join(out, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{}\\n');
  }
}
mock.module(modulePath, () => ({ ...real,
  rigStage: ({out}) => {
    output(out, ['rig.json', 'motion.json', 'mesh_report.json']);
    return { images: [] };
  },
  assembleStage: (_input, paths) => {
    const out = dirname(dirname(paths.partsJson));
    output(out, ['rig/parts.json', 'rig/painting_in_rig.png', 'rig/source_cover.json',
      'rig/part_support_domains.json', 'render/recomposite_rig.png', 'render/recomposite_error_rig.png']);
    return { parts: { parts: [] }, figure: null };
  },
}));
`);
const config = join(work, 'config.json');
writeFileSync(config, '{}\n');
async function run(command: 'rig' | 'assemble', out: string, epoch?: string): Promise<{ code: number; text: string }> {
  const env = { ...process.env };
  delete env.SOURCE_DATE_EPOCH;
  if (epoch !== undefined) env.SOURCE_DATE_EPOCH = epoch;
  const args = command === 'rig' ? ['--parts', work] : ['--source', 'unused.png', '--full', 'unused'];
  const child = Bun.spawn([process.execPath, '--preload', preload, join(root, 'cli.ts'), command,
    '--config', config, '--out', out, ...args], { env, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, text: stdout + stderr };
}
function readStamp(out: string): { raw: string; stamp: RunStamp } {
  const raw = readFileSync(join(out, 'run.json'), 'utf8');
  return { raw, stamp: JSON.parse(raw) as RunStamp };
}
try {
  for (const command of ['rig', 'assemble'] as const) {
    const out = join(work, command);
    const fixed1 = await run(command, out, '1762560000');
    check(`${command}_FIXED_RUN`, fixed1.code === 0, fixed1.text);
    if (fixed1.code !== 0) continue;
    const first = readStamp(out);
    const fixed2 = await run(command, out, '1762560000');
    const second = readStamp(out);
    check(`${command}_FIXED_BYTES`, fixed2.code === 0 && first.raw === second.raw &&
      first.stamp.started_at === '2025-11-08T00:00:00.000Z' && first.stamp.finished_at === first.stamp.started_at,
    `exit=${fixed2.code}; identical=${first.raw === second.raw}; times=${first.stamp.started_at},${first.stamp.finished_at}`);
    const before = Date.now();
    const wall = await run(command, out);
    const after = Date.now();
    const unset = readStamp(out);
    const expected = buildRunStamp({ pkg: unset.stamp.package, command, startedAt: unset.stamp.started_at,
      finishedAt: unset.stamp.finished_at, outDir: out, configPath: config,
      outputPaths: first.stamp.outputs.map(file => file.path) });
    const blank = (stamp: RunStamp): string => JSON.stringify({ ...stamp, started_at: '', finished_at: '' });
    check(`${command}_UNSET_PARITY`, wall.code === 0 && unset.raw === rigJsonText(expected) && blank(unset.stamp) === blank(first.stamp) &&
      Date.parse(unset.stamp.started_at) >= before && Date.parse(unset.stamp.finished_at) <= after &&
      Date.parse(unset.stamp.started_at) <= Date.parse(unset.stamp.finished_at),
    `exit=${wall.code}; production writer bytes=${unset.raw === rigJsonText(expected)}; keys=${Object.keys(unset.stamp).join(',')}`);
    for (const [epoch, instant] of [['0', '1970-01-01T00:00:00.000Z'], ['253402300799', '9999-12-31T23:59:59.000Z']]) {
      const result = await run(command, out, epoch);
      const stamp = readStamp(out).stamp;
      check(`${command}_BOUNDARY_${epoch}`, result.code === 0 && stamp.started_at === instant && stamp.finished_at === stamp.started_at, `epoch=${epoch}; exit=${result.code}`);
    }
    const bad = ['', '-1', '1.5', 'abc', '253402300800', '8640000000001', '9007199254740992', '01', '+1', ' 1', '1e3', '1\n'];
    for (const [i, epoch] of bad.entries()) {
      const fresh = join(work, `${command}-bad-${i}`);
      const result = await run(command, fresh, epoch);
      check(`${command}_REFUSE_${i}`, result.code !== 0 && result.text.includes('RUN_STAMP_EPOCH') &&
        result.text.includes('SOURCE_DATE_EPOCH') && result.text.includes(JSON.stringify(epoch)) && result.text.includes('required') && !existsSync(fresh),
      `value=${JSON.stringify(epoch)}; exit=${result.code}; no output=${!existsSync(fresh)}; ${result.text.trim()}`);
    }
    // Validation must precede clearRunStamp, including reused output directories.
    const old = readFileSync(join(out, 'run.json'));
    writeFileSync(join(out, 'sentinel'), 'preserve');
    const members = readdirSync(out).sort().join(',');
    const rejected = await run(command, out, 'bad');
    check(`${command}_REUSED_UNTOUCHED`, rejected.code !== 0 && old.equals(readFileSync(join(out, 'run.json'))) &&
      readdirSync(out).sort().join(',') === members && readFileSync(join(out, 'sentinel'), 'utf8') === 'preserve', `exit=${rejected.code}; members=${members}`);
  }
  const tally = new RunTally();
  const log = console.log;
  console.log = (...values: unknown[]) => { const line = values.map(String).join(' '); tally.observe(line); log(line); };
  try {
    tally.of('run-clock', () => {
      console.log('\n── run-clock: opt-in stamp clock ──');
      let failures = 0;
      const say = (name: string, ok: boolean, detail: string, why: string): void => { failures += reportMeasuredCase(name, ok, JSON.stringify(detail), why); };
      for (const test of cases) say(test.name, test.ok, test.detail, 'issue #1217: production CLI clock and stamp writer with local stage doubles');
      treeGuideCase(treeFiles().filter(file => TEXT_FILE.test(file)).map(file => [file, readFileSync(join(root, file), 'utf8')] as const), say);
      return failures;
    });
  } finally { console.log = log; }
  const faults = tallyFaults(tally.blocks, tally.gutter, tally.total);
  for (const fault of faults) console.error(fault);
  console.log(`run-clock controls ${tally.total}, failures ${tally.failures}, tally faults ${faults.length}`);
  process.exitCode = tally.failures || faults.length ? 1 : 0;
} finally { rmSync(work, { recursive: true, force: true }); }
