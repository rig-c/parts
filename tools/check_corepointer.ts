#!/usr/bin/env bun
/** #356 relay controls using real parts stage calls and synthetic core replies. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CORE_POINTER_CASES } from '../fixtures/corepointer.ts';
import { writeRigFixture } from '../fixtures/rig.ts';
import { gateThroughRigc, rigStage } from '../src/build.ts';
import { coreCompileGuideLine, failLine, PartsError } from '../src/errors.ts';
import { buildGateLines, rigcFailed, type RigcRunner } from '../src/check.ts';

/** Run the existing synthetic-relay controls explicitly, without owning process state. */
export function runCorePointerChecks(root: string, report: (name: string, ok: boolean, detail: string) => void): number {
  mkdirSync(root, { recursive: true });
  let failed = 0;
  function check(name: string, ok: boolean, detail: string): void {
    if (!ok) failed++;
    report(name, ok, detail);
  }
  function refusal(fn: () => unknown): PartsError | null {
    try { fn(); return null; } catch (e) { if (e instanceof PartsError) return e; throw e; }
  }
  for (const c of CORE_POINTER_CASES) {
    const got = coreCompileGuideLine(c.out);
    check(`CP_HELPER_${c.name}`, got === c.expected && coreCompileGuideLine(got) === got, 'literal expected line and repeated relay');
    const filtered = buildGateLines(c.out);
    const expectedLines = c.expected === '' ? [] : [c.expected];
    check(`CP_CHECK_FILTER_${c.name}`, JSON.stringify(filtered) === JSON.stringify(expectedLines), 'check build filter relays the completed pointer');
    const problems = rigcFailed('build', { status: 7, out: c.out, ran: 'rigc synthetic at fixture-runner' }, filtered);
    const checkLine = problems.map(failLine).join('\n');
    check(`CP_CHECK_REFUSAL_${c.name}`, problems.length === 1 && (c.expected === '' ? checkLine.includes('and it printed nothing') && !checkLine.includes('rigc guide') : checkLine.includes(c.expected.trim())) && checkLine.endsWith(' (see rig-parts guide CHECK_RIGC_GREEN)') && checkLine.split('(see rig-parts guide CHECK_RIGC_GREEN)').length === 2 && checkLine.includes('rigc synthetic at fixture-runner'), 'check refusal preserves the inner pointer and one outer pointer');
    const dir = join(root, c.name);
    const fixture = writeRigFixture(dir);
    const scratch = join(dir, 'scratch');
    const recorded: string[][] = [];
    const runner: RigcRunner = args => { recorded.push([...args]); return { status: 7, out: c.out, ran: 'rigc synthetic at fixture-runner' }; };
    const [gate] = gateThroughRigc([], [['rig.json', '{}'], ['motion.json', '{}']], runner, scratch, null);
    check(`CP_GATE_${c.name}`, gate.status === 7 && gate.ran === 'rigc synthetic at fixture-runner' && JSON.stringify(gate.lines) === JSON.stringify(c.expected === '' ? [] : [c.expected]) && recorded.length === 1 && recorded[0][0] === 'build' && !existsSync(scratch), 'actual gate call preserves status/runner and cleans scratch');
    const out = join(dir, 'out');
    const log: string[] = [];
    const error = refusal(() => rigStage({ config: fixture.config, parts: fixture.parts, out }, runner, scratch, l => log.push(l)));
    const problem = error?.problems.find(p => p.code === 'RIG_RIGC_GREEN');
    const line = problem === undefined ? '' : failLine(problem);
    const inner = c.expected === '' ? line.includes('and it printed nothing') && !line.includes('rigc guide') : line.includes(c.expected.trim());
    check(`CP_STAGE_${c.name}`, problem !== undefined && inner && line.endsWith(' (see rig-parts guide RIG_RIGC_GREEN)') && line.split('(see rig-parts guide RIG_RIGC_GREEN)').length === 2 && line.includes('rigc synthetic at fixture-runner') && !existsSync(out) && !existsSync(scratch), 'actual rig stage refusal keeps inner and outer pointers; emits no rig');
    check(`CP_LOG_${c.name}`, c.expected === '' ? !log.some(l => l.includes('rigc guide')) : log.some(l => l.trim() === c.expected.trim()), 'stage log relays the same core line without creating empty evidence');
  }
  const padded = '  rigc compile error: fallback probe  \r';
  const paddedExpected = '  rigc compile error: fallback probe (see rigc guide §5.1)  \r';
  check('CP_WHITESPACE', coreCompileGuideLine(padded) === paddedExpected, 'helper preserves leading/trailing whitespace');
  const [fallback] = gateThroughRigc([], [], () => ({ status: 3, out: padded }), join(root, 'fallback-scratch'), null);
  check('CP_CAUSE_FALLBACK', JSON.stringify(fallback.lines) === JSON.stringify(['rigc compile error: fallback probe (see rigc guide §5.1)']), 'causeLines fallback is completed after trimming');
  const checkFallback = rigcFailed('build', { status: 3, out: padded }, []);
  check('CP_CHECK_CAUSE_FALLBACK', checkFallback.length === 1 && checkFallback[0].detail === 'exit 3: rigc compile error: fallback probe (see rigc guide §5.1)', 'check fallback completes the compile pointer even without filtered lines');
  const unrelated = 'error: Cannot find module probe';
  const [cause] = gateThroughRigc([], [], () => ({ status: 3, out: unrelated }), join(root, 'cause-scratch'), null);
  check('CP_OTHER_CAUSE', cause.lines.join('') === unrelated, 'non-compile cause remains unchanged');
  const green = '  ..    assertions: 1 measured (1 passed, 0 failed)';
  const [positive] = gateThroughRigc([], [], () => ({ status: 0, out: green }), join(root, 'green-scratch'), null);
  check('CP_GREEN_GATE', positive.status === 0 && positive.lines.join('') === green, 'synthetic positive assertion summary remains byte-identical');
  const fixture = writeRigFixture(join(root, 'positive'));
  const out = join(root, 'positive', 'out');
  const error = refusal(() => rigStage({ config: fixture.config, parts: fixture.parts, out }, () => ({ status: 0, out: green }), join(root, 'positive-scratch'), () => {}));
  check('CP_GREEN_STAGE', error === null && existsSync(join(out, 'rig.json')) && JSON.parse(readFileSync(join(out, 'rig.json'), 'utf8')).spec === 'rigc-rig/1', 'actual parts stage accepts the synthetic green reply and writes its rig spec');
  return failed;
}

if (import.meta.main) {
  const keep = process.argv.indexOf('--keep');
  const root = keep < 0 ? mkdtempSync(join(tmpdir(), 'parts-corepointer-')) : resolve(process.argv[keep + 1]);
  let failed = 0;
  let measured = 0;
  try {
    failed = runCorePointerChecks(root, (name, ok, detail) => {
      measured++;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
    });
  } finally {
    if (keep < 0) rmSync(root, { recursive: true, force: true });
  }
  console.log(`COREPOINTER ${failed === 0 ? 'PASS' : 'FAIL'}: ${failed} failure(s), ${measured} control(s)`);
  process.exitCode = failed === 0 && measured > 0 ? 0 : 1;
}
