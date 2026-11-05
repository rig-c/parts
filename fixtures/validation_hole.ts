/** Exercise the real selftest reporter with the sample absent in a private copy. */
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validationInput } from './validation_cache.ts';

export function validationHoleProbe(root: string, holder: string): { ok: boolean; detail: string } {
  if (validationInput(root) === null) throw new Error('HOLE probe requires the present-sample positive first');
  const copy = join(holder, 'checkout'); mkdirSync(holder, { recursive: true });
  cpSync(root, copy, { recursive: true, filter: source => {
    const path = relative(root, source).replaceAll('\\', '/');
    return !['.git', 'node_modules', 'scratch', 'fixtures/validation-inputs'].includes(path);
  } });
  symlinkSync(join(root, 'node_modules'), join(copy, 'node_modules'), 'dir');
  const summary = join(holder, 'summary.json');
  const run = spawnSync(process.execPath, [join(copy, 'selftest.ts'), '--only', 'chain,png', '--summary-json', summary],
    { cwd: copy, encoding: 'utf8', timeout: 60000, maxBuffer: 1 << 26,
      env: { ...process.env, RIG_PARTS_SELFTEST_JOBS: '1', RIG_PARTS_VALIDATION_CACHE: join(holder, 'cache') } });
  const log = (run.stdout ?? '') + (run.stderr ?? ''); writeFileSync(join(holder, 'selftest.log'), log);
  const doc = existsSync(summary) ? JSON.parse(readFileSync(summary, 'utf8')) as { suites: Array<{ suite: string; status: string; controls: number }>; faults: string[] } : null;
  const chain = doc?.suites.find(row => row.suite === 'chain');
  const ok = run.status === 2 && chain?.status === 'hole' && chain.controls === 0 && doc?.faults.length === 0 &&
    log.includes('SKIP  validation sample inputs are absent') && log.includes('HOLE') && !/PASS\s+CH\d/.test(log) && !log.includes('selftest: green');
  return { ok, detail: `present sample found; absent-copy selftest exit ${run.status}; chain ${JSON.stringify(chain)}; faults ${JSON.stringify(doc?.faults)}; no CH PASS and no whole-run green` };
}
