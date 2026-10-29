/** Issue #829: generated controls for optional observations, independent of check's bars. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeCheckRig, writeMergedCheckRig } from '../fixtures/checkrig.ts';
import { checkStage } from '../src/build.ts';
import type { RigcRunner } from '../src/check.ts';
import { PartsError } from '../src/errors.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
const json = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
const bytes = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
function tree(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).flatMap(e => {
    if (prefix === '' && e.name === 'extremes') return [];
    const name = prefix + e.name;
    return e.isDirectory() ? tree(join(dir, e.name), name + '/') : [name + ':' + bytes(join(dir, e.name))];
  });
}

export function runExtremesChecks(root: string, say: Say, rigc: RigcRunner): void {
  const input = join(root, 'input');
  writeCheckRig(input);
  const motionPath = join(input, 'motion.json');
  const motion = json(motionPath);
  const anims = motion.animations as Record<string, unknown>;
  anims.wave = anims.idle;
  anims.hold = { duration: 1, loop: true, tracks: [{ bone: 'root', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 1, v: [0] }] }] };
  writeFileSync(motionPath, JSON.stringify(motion));
  const run = (out: string, noExtremes = false, runner: RigcRunner = rigc, home = input) => {
    const calls: string[][] = [], lines: string[] = [], native: boolean[] = [];
    const tap: RigcRunner = args => {
      calls.push([...args]);
      const result = runner(args);
      if (args.includes('--extremes') && result.status === 0) {
        const rendered = json(join(args[args.indexOf('--out') + 1], 'frames.json'));
        native.push((rendered.viewport as Record<string, unknown>).scale === 1);
      }
      return result;
    };
    const report = checkStage({ rig: home, out, noExtremes }, tap, 'fixture-rigc', line => lines.push(line));
    return { report, calls, lines, native };
  };
  const onDir = join(root, 'on'), offDir = join(root, 'off');
  const on = run(onDir), off = run(offDir, true);
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
  say('CK831_OPT_OUT_ADDS_NO_RENDER_OR_DIRECTORY_AND_PRESERVES_BYTES', !existsSync(join(offDir, 'extremes')) && !off.calls.some(args => args.includes('--extremes')) && renders(on.calls).length === renders(off.calls).length + 3 && tree(onDir).join('|') === tree(offDir).join('|') && on.report.figures.PASS === off.report.figures.PASS, JSON.stringify({ on: renders(on.calls).length, off: renders(off.calls).length, same: tree(onDir).join('|') === tree(offDir).join('|') }));
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
  const diag = run(diagDir, false, args => args.includes('--extremes') ? { status: 17, out: 'fixture render failure' } : rigc(args));
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
  const staticHome = join(root, 'no-animations');
  writeMergedCheckRig(staticHome, { idle: false, plate: true });
  const none = run(join(root, 'no-animations-out'), false, rigc, staticHome);
  say('CK835_NO_ANIMATION_IS_NAMED_WITH_NO_EXTRA_RENDER', !none.calls.some(args => args.includes('--extremes')) && none.lines.some(l => l.includes('EXTREMES') && l.includes('SKIP') && l.includes('no animation')), none.lines.filter(l => l.includes('EXTREMES')).join(' | '));
}
