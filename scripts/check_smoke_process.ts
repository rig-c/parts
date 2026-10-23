/** Portable smoke-process controls; no checkout dependencies are required. */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { findSmokeExecutable, isSmokePathInside, runSmokeCommand } from './smoke_process.ts';

export function checkSmokeProcess(): void {
  const root = mkdtempSync(join(tmpdir(), 'smoke process '));
  const expect = (ok: boolean, name: string): void => {
    if (!ok) throw new Error(name);
    console.log('  PASS  ' + name);
  };
  try {
    if (process.platform === 'win32') {
      // Real TEMP short names exercise a different identity seam from a junction.
      const entry = join(root, 'actual temp entry.js');
      writeFileSync(entry, '');
      const longRoot = realpathSync.native(root);
      const longEntry = realpathSync.native(entry);
      const shortName = /[\\/][^\\/]*~\d+(?=[\\/]|$)/i;
      const actualPair = shortName.test(root) && !shortName.test(longRoot) && root.toLowerCase() !== longRoot.toLowerCase();
      if (!actualPair) {
        console.log('  SKIP  SMOKE_PROCESS_WINDOWS_ACTUAL_SHORT_LONG_IDENTITY: TEMP supplies no actual short/long pair');
        console.log('          HOLE: no 8.3 identity proof on this host; ordinary alias and outside/missing controls still run');
      } else {
        const sameIdentity = (a: string, b: string): boolean => {
          const x = statSync(a, { bigint: true });
          const y = statSync(b, { bigint: true });
          return x.dev === y.dev && x.ino === y.ino;
        };
        const oldRelative = relative(realpathSync(root), realpathSync(longEntry));
        const oldAccepted = oldRelative === '' || (!isAbsolute(oldRelative) && oldRelative !== '..' && !oldRelative.startsWith('..' + sep));
        const accepted = sameIdentity(root, longRoot) && sameIdentity(entry, longEntry) &&
          isSmokePathInside(root, longEntry) && isSmokePathInside(longRoot, entry);
        if (!accepted) console.error('SMOKE_PROCESS_WINDOWS_SHORT_LONG_OBSERVATION ' + JSON.stringify({ root, entry,
          defaultRoot: realpathSync(root), defaultEntry: realpathSync(longEntry), nativeRoot: longRoot, nativeEntry: longEntry, actualPair, oldAccepted, accepted }));
        expect(accepted, 'SMOKE_PROCESS_WINDOWS_ACTUAL_SHORT_LONG_IDENTITY');
        console.log('          actualPair=true; default resolver accepted ' + oldAccepted + '; native resolver accepted ' + accepted);
      }
    }
    const bin = join(root, 'bin with spaces');
    mkdirSync(bin);
    writeFileSync(join(bin, 'npm.cmd'), '@exit /b 99\r\n');
    writeFileSync(join(bin, 'bun.exe'), 'not an executable');
    const env = { Path: bin, PATHEXT: '.CMD;.EXE' };
    const sameWindowsPath = (actual: string | null, expected: string): boolean =>
      actual !== null && actual.toLowerCase() === expected.toLowerCase();
    expect(sameWindowsPath(findSmokeExecutable('npm', env, 'win32'), join(bin, 'npm.cmd')) &&
      sameWindowsPath(findSmokeExecutable('bun', env, 'win32'), join(bin, 'bun.exe')), 'SMOKE_PROCESS_WINDOWS_PATHEXT_AND_SPACES');
    const old = spawnSync('command', ['-v', 'bun'], { env: { ...process.env, PATH: bin }, shell: true, encoding: 'utf8' });
    expect((old.stdout ?? '').trim() === '' && findSmokeExecutable('bun', env, 'win32') !== null,
      'SMOKE_PROCESS_OLD_LOOKUP_NEGATIVE');
    expect(findSmokeExecutable('missing-smoke-tool', env, 'win32') === null &&
      runSmokeCommand('missing-smoke-tool', [], root, env, {}, 'win32').out.includes('SMOKE_PREREQ_TOOLS_ON_PATH'),
      'SMOKE_PROCESS_ABSENT_TOOL_IS_NAMED');
    const install = join(root, 'canonical install');
    const alias = join(root, 'install alias');
    const outside = join(root, 'canonical install-other');
    mkdirSync(join(install, 'nested'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(install, 'nested', 'entry.js'), '');
    writeFileSync(join(outside, 'entry.js'), '');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    symlinkSync(install, alias, linkType);
    symlinkSync(outside, join(install, 'escape'), linkType);
    expect(isSmokePathInside(alias, join(install, 'nested', 'entry.js')) &&
      isSmokePathInside(install, join(alias, 'nested', 'entry.js')),
      'SMOKE_PROCESS_CANONICAL_ALIAS_IS_THE_SAME_INSTALL');
    expect(!isSmokePathInside(install, join(outside, 'entry.js')) &&
      !isSmokePathInside(install, join(install, 'escape', 'entry.js')) &&
      !isSmokePathInside(install, join(install, 'missing.js')) &&
      !isSmokePathInside(join(root, 'missing-root'), join(install, 'nested', 'entry.js')),
      'SMOKE_PROCESS_CONTAINMENT_REFUSES_OUTSIDE_SYMLINK_PREFIX_AND_MISSING');
    const node = findSmokeExecutable('node');
    if (node === null) throw new Error('SMOKE_PROCESS_NODE_REQUIRED');
    copyFileSync(node, join(bin, 'node.exe'));
    const pkg = join(bin, 'node_modules', 'npm');
    mkdirSync(join(pkg, 'unusual entry'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'npm', main: 'unusual entry/start.cjs', bin: { npm: 'unusual entry/start.cjs' } }));
    writeFileSync(join(pkg, 'unusual entry/start.cjs'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
    const args = ['space here', '& echo must-stay-literal', '%PATH%', 'quote"slash\\', 'line\nbreak'];
    const actual = runSmokeCommand('npm', args, root, { ...process.env, PATH: bin }, { npm: 'npm' }, 'win32');
    expect(actual.status === 0 && actual.out === JSON.stringify(args), 'SMOKE_PROCESS_METADATA_ENTRY_AND_LITERAL_ARGV');
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'npm', main: 'unusual entry/start.cjs', bin: { npm: 'missing.cjs' } }));
    const broken = runSmokeCommand('npm', [], root, { ...process.env, PATH: bin }, { npm: 'npm' }, 'win32');
    expect(broken.status === 1 && broken.out.includes('SMOKE_PACKAGE_BIN_ENTRY'), 'SMOKE_PROCESS_INVALID_BIN_IS_NAMED');
    if (process.platform !== 'win32') {
      writeFileSync(join(bin, 'not-executable'), 'text', { mode: 0o644 });
      expect(findSmokeExecutable('not-executable', { PATH: bin }) === null && findSmokeExecutable('node', { PATH: dirname(node) }) !== null,
        'SMOKE_PROCESS_POSIX_EXECUTABILITY');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}
if (import.meta.main) checkSmokeProcess();
