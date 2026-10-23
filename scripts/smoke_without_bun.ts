/** Isolated smoke search environment; this changes no installed-package behavior. */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

type Env = Record<string, string | undefined>;
export function nodeOnlySearchEnvironment(original: Env, directory: string): Env {
  const env: Env = {};
  // Windows treats these names as one key; leaving both can select the old PATH.
  for (const [key, value] of Object.entries(original)) if (key.toUpperCase() !== 'PATH') env[key] = value;
  env.PATH = directory;
  return env;
}
interface SearchProbe {
  status: number | null;
  signal: string | null;
  errorCode?: string;
  stdout: string | null;
  stderr: string | null;
}
export function runWithoutBun(node: string, entry: string, workspace: string, original: Env = process.env): {
  status: number; out: string; probe: SearchProbe;
} {
  const root = mkdtempSync(join(workspace, 'node-only-'));
  try {
    const tools = join(root, 'tools');
    const cwd = join(root, 'empty');
    mkdirSync(tools); mkdirSync(cwd);
    const executable = join(tools, process.platform === 'win32' ? 'node.exe' : 'node');
    copyFileSync(node, executable);
    const env = nodeOnlySearchEnvironment(original, tools);
    const script = "const r=require('node:child_process').spawnSync('bun',['--version'],{encoding:'utf8',shell:false});process.stdout.write(JSON.stringify({status:r.status,signal:r.signal,errorCode:r.error?.code,stdout:r.stdout,stderr:r.stderr}));";
    const raw = spawnSync(executable, ['-e', script], { cwd, env, encoding: 'utf8', shell: false, windowsHide: true });
    let probe: SearchProbe;
    try { probe = JSON.parse(raw.stdout) as SearchProbe; }
    catch { throw new Error('SMOKE_WITHOUT_BUN_SEARCH_IS_EMPTY: Node search probe did not return JSON: ' + (raw.stderr ?? '')); }
    if (raw.status !== 0 || raw.error !== undefined || probe.errorCode !== 'ENOENT' ||
      probe.status !== null || probe.signal !== null || (probe.stdout ?? '') !== '' || (probe.stderr ?? '') !== '') {
      throw new Error('SMOKE_WITHOUT_BUN_SEARCH_IS_EMPTY: bun must be unresolvable before the shim runs; found ' + JSON.stringify(probe));
    }
    const ran = spawnSync(executable, [entry, '--version'], { cwd, env, encoding: 'utf8', shell: false, windowsHide: true });
    const error = ran.error === undefined ? '' : '\n' + ran.error.message;
    return { status: ran.status ?? 1, out: (ran.stdout ?? '') + (ran.stderr ?? '') + error, probe };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
