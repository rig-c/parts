/** The absent-Bun control must prove absence, even with two installed candidates. */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { nodeOnlySearchEnvironment, runWithoutBun } from './smoke_without_bun.ts';

export function checkSmokeWithoutBun(): void {
  const root = mkdtempSync(join(tmpdir(), 'smoke absent bun '));
  const expect = (ok: boolean, name: string): void => {
    if (!ok) throw new Error(name);
    console.log('  PASS  ' + name);
  };
  try {
    const said = spawnSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' });
    if (said.status !== 0 || said.stdout.trim() === '') throw new Error('SMOKE_WITHOUT_BUN_NODE_REQUIRED');
    const node = said.stdout.trim();
    const clean = nodeOnlySearchEnvironment({ PATH: 'first-bun', Path: 'second-bun', path: 'third-bun', KEEP: 'literal' }, join(root, 'node only'));
    expect(Object.keys(clean).filter(key => key.toUpperCase() === 'PATH').join(',') === 'PATH' &&
      clean.PATH === join(root, 'node only') && clean.KEEP === 'literal', 'SMOKE_WITHOUT_BUN_ONE_PATH_KEY');
    const a = join(root, 'bun one');
    const b = join(root, 'bun two');
    mkdirSync(a); mkdirSync(b);
    const bun = process.platform === 'win32' ? 'bun.exe' : 'bun';
    copyFileSync(process.execPath, join(a, bun));
    copyFileSync(process.execPath, join(b, bun));
    const probe = "const r=require('node:child_process').spawnSync('bun',['--version'],{encoding:'utf8'});process.stdout.write(JSON.stringify({status:r.status,signal:r.signal,error:r.error?.code,stdout:r.stdout,stderr:r.stderr}));";
    const oldEnv = nodeOnlySearchEnvironment(process.env, [a, b].join(delimiter));
    const before = spawnSync(node, ['-e', probe], { cwd: root, env: oldEnv, encoding: 'utf8' });
    const stripped = spawnSync(node, ['-e', probe], { cwd: root, env: { ...oldEnv, PATH: b }, encoding: 'utf8' });
    const oldResult = JSON.parse(stripped.stdout) as { status?: number; error?: string };
    expect(before.status === 0 && JSON.parse(before.stdout).status === 0 && stripped.status === 0 && oldResult.status === 0 && oldResult.error === undefined,
      'SMOKE_WITHOUT_BUN_OLD_SINGLE_DIRECTORY_REMOVAL_LEAVES_SECOND_CANDIDATE');
    const entry = join(root, 'fixture shim.cjs');
    writeFileSync(entry, "const r=require('node:child_process').spawnSync('bun',['--version'],{encoding:'utf8'});if(r.error?.code==='ENOENT'){process.stderr.write('fixture runs on Bun: not found on PATH');process.exit(1);}process.exit(r.status??2);");
    const missing = runWithoutBun(node, entry, root, oldEnv);
    expect(missing.status === 1 && missing.probe.errorCode === 'ENOENT' && /runs on Bun/.test(missing.out),
      'SMOKE_WITHOUT_BUN_TWO_CANDIDATES_ARE_ABSENT_IN_CONTROLLED_SEARCH');
    const wrong = join(root, 'wrong shim.cjs');
    writeFileSync(wrong, "process.stdout.write('wrong shim accepted');");
    const bad = runWithoutBun(node, wrong, root, oldEnv);
    expect(bad.probe.errorCode === 'ENOENT' && (bad.status !== 1 || !/runs on Bun/.test(bad.out)),
      'SMOKE_WITHOUT_BUN_ACCEPTING_SHIM_IS_RED');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
if (import.meta.main) checkSmokeWithoutBun();
