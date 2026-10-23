/** Isolated smoke search environment; this changes no installed-package behavior. */
import { spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';

type Env = Record<string, string | undefined>;
export function nodeOnlySearchEnvironment(original: Env, directory: string): Env {
  const env: Env = {};
  // Windows treats these names as one key; leaving both can select the old PATH.
  for (const [key, value] of Object.entries(original)) if (key.toUpperCase() !== 'PATH') env[key] = value;
  env.PATH = directory;
  return env;
}
/** Only an exhausted EBUSY cleanup is informational; the control's child result is already captured. */
export function cleanupWithoutBun(
  root: string,
  remove: (path: string) => void = path => rmSync(path, { recursive: true, force: true }),
  note: (message: string) => void = message => console.error(message),
  pause: () => void = () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); },
): void {
  for (let attempt = 0; ; attempt++) {
    try { remove(root); return; }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EBUSY') throw error;
      if (attempt === 3) { note('NOTE SMOKE_WITHOUT_BUN_CLEANUP: EBUSY after 4 attempts; left ' + root); return; }
      pause();
    }
  }
}

interface SearchProbe {
  status: number | null;
  signal: string | null;
  errorCode?: string;
  stdout: string | null;
  stderr: string | null;
}
export function runWithoutBun(
  node: string, entry: string, workspace: string, original: Env = process.env,
  cleanup: (root: string) => void = cleanupWithoutBun,
): {
  status: number; out: string; probe: SearchProbe;
} {
  // This directory owns its cleanup: neither the install workspace nor the control's parent may rediscover it.
  const root = mkdtempSync(join(tmpdir(), 'rig-parts-node-only-'));
  try {
    const within = relative(realpathSync.native(workspace), realpathSync.native(root));
    if (!(within === '..' || within.startsWith('..' + sep) || isAbsolute(within))) {
      throw new Error('SMOKE_WITHOUT_BUN_CLEANUP_ROOT: the owned temp directory must be outside the caller workspace');
    }
    const tools = join(root, 'tools');
    const cwd = join(root, 'empty');
    mkdirSync(tools); mkdirSync(cwd);
    const executable = join(tools, process.platform === 'win32' ? 'node.exe' : 'node');
    copyFileSync(node, executable);
    const env = nodeOnlySearchEnvironment(original, tools);
    let captureIndex = 0;
    // Capture uses files rather than pipes; every owned descriptor closes before directory cleanup.
    const capture = (args: string[]) => {
      const stdoutPath = join(root, 'stdout-' + captureIndex);
      const stderrPath = join(root, 'stderr-' + captureIndex++);
      const stdout = openSync(stdoutPath, 'w');
      try {
        const stderr = openSync(stderrPath, 'w');
        try {
          const result = spawnSync(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', stdout, stderr] });
          return { status: result.status, error: result.error, stdout: readFileSync(stdoutPath, 'utf8'), stderr: readFileSync(stderrPath, 'utf8') };
        } finally { closeSync(stderr); }
      } finally { closeSync(stdout); }
    };
    const script = "const r=require('node:child_process').spawnSync('bun',['--version'],{encoding:'utf8',shell:false});process.stdout.write(JSON.stringify({status:r.status,signal:r.signal,errorCode:r.error?.code,stdout:r.stdout,stderr:r.stderr}));";
    const raw = capture(['-e', script]);
    let probe: SearchProbe;
    try { probe = JSON.parse(raw.stdout) as SearchProbe; }
    catch { throw new Error('SMOKE_WITHOUT_BUN_SEARCH_IS_EMPTY: Node search probe did not return JSON: ' + (raw.stderr ?? '')); }
    if (raw.status !== 0 || raw.error !== undefined || probe.errorCode !== 'ENOENT' ||
      probe.status !== null || probe.signal !== null || (probe.stdout ?? '') !== '' || (probe.stderr ?? '') !== '') {
      throw new Error('SMOKE_WITHOUT_BUN_SEARCH_IS_EMPTY: bun must be unresolvable before the shim runs; found ' + JSON.stringify(probe));
    }
    const ran = capture([entry, '--version']);
    const error = ran.error === undefined ? '' : '\n' + ran.error.message;
    return { status: ran.status ?? 1, out: (ran.stdout ?? '') + (ran.stderr ?? '') + error, probe };
  } finally { cleanup(root); }
}
