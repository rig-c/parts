/** Smoke-only executable resolution and shell-free package-command dispatch. */
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

type Env = Record<string, string | undefined>;
function value(env: Env, key: string, platform: string): string {
  return env[key] ?? (platform === 'win32' ? env[Object.keys(env).find((name) => name.toUpperCase() === key) ?? key] : undefined) ?? '';
}
export function findSmokeExecutable(command: string, env: Env = process.env, platform: string = process.platform, cwd = process.cwd()): string | null {
  const windows = platform === 'win32';
  const direct = /[\\/]/.test(command) || isAbsolute(command);
  const dirs = direct ? [''] : value(env, 'PATH', platform).split(windows ? ';' : delimiter);
  const suffixes = windows && extname(command) === ''
    ? [...new Set((value(env, 'PATHEXT', platform) || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).flatMap((suffix) => [suffix, suffix.toLowerCase()])), '']
    : [''];
  for (const dir of dirs) for (const suffix of suffixes) {
    const path = resolve(cwd, dir.replace(/^"|"$/g, ''), command + suffix);
    try {
      if (!statSync(path).isFile()) continue;
      if (!windows) accessSync(path, constants.X_OK);
      return path;
    } catch { /* Try the next actual PATH candidate. */ }
  }
  return null;
}

/** Compare existing filesystem identities, including aliases, without accepting lexical siblings. */
export function isSmokePathInside(directory: string, candidate: string): boolean {
  try {
    const parent = realpathSync.native(directory);
    const child = realpathSync.native(candidate);
    const path = relative(parent, child);
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
  } catch { return false; }
}

function packageEntry(shim: string, packageName: string, command: string): string {
  const req = createRequire(join(dirname(shim), 'smoke-resolver.cjs'));
  let manifest: string;
  try { manifest = req.resolve(packageName + '/package.json'); }
  catch {
    let dir = dirname(req.resolve(packageName));
    for (;;) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate) && (JSON.parse(readFileSync(candidate, 'utf8')) as { name?: unknown }).name === packageName) break;
      const parent = dirname(dir);
      if (parent === dir) throw new Error('package manifest was not resolved');
      dir = parent;
    }
    manifest = join(dir, 'package.json');
  }
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown; bin?: unknown };
  const declared = typeof pkg.bin === 'string' ? (packageName.split('/').at(-1) === command ? pkg.bin : undefined)
    : pkg.bin !== null && typeof pkg.bin === 'object' ? (pkg.bin as Record<string, unknown>)[command] : undefined;
  if (pkg.name !== packageName || typeof declared !== 'string') throw new Error('command is absent from package bin metadata');
  const entry = resolve(dirname(manifest), declared);
  if (!isSmokePathInside(dirname(manifest), entry) || !/\.(?:cjs|mjs|js)$/.test(entry) || !statSync(entry).isFile())
    throw new Error('declared JavaScript bin entry is not a package file');
  return entry;
}

export function runSmokeCommand(command: string, args: string[], cwd: string, env: Env = process.env,
  packages: Readonly<Record<string, string>> = {}, platform: string = process.platform): { status: number; out: string } {
  const executable = findSmokeExecutable(command, env, platform, cwd);
  if (executable === null) return { status: 1, out: 'SMOKE_PREREQ_TOOLS_ON_PATH: ' + command + ' is not on PATH' };
  let launch = executable;
  let argv = args;
  if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)) {
    const name = basename(command).replace(/\.(?:cmd|bat)$/i, '');
    try {
      const pkg = packages[name];
      if (pkg === undefined) throw new Error('no declared package for command');
      const node = findSmokeExecutable('node', env, platform, cwd);
      if (node === null) throw new Error('node is not on PATH');
      launch = node;
      argv = [packageEntry(executable, pkg, name), ...args];
    } catch (error) {
      return { status: 1, out: 'SMOKE_PACKAGE_BIN_ENTRY: ' + name + ' — ' + (error instanceof Error ? error.message : String(error)) };
    }
  }
  const result = spawnSync(launch, argv, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const failed = result.error === undefined ? '' : '\n' + result.error.message;
  return { status: typeof result.status === 'number' ? result.status : 1, out: (result.stdout ?? '') + (result.stderr ?? '') + failed };
}
