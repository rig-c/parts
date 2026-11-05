/** Issue #953: config.assemble.project through the actual config readers and CLI routing, with generated source controls. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assembleConfig, writeAssembleFixture } from '../fixtures/assemble_fixture.ts';
import { parseConfig, parseEarlyConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
const ROOT = resolve(import.meta.dir, '..');
export function runProjectConfigChecks(dir: string, say: Say): void {
  const base = assembleConfig();
  const cfg = (project: unknown): Record<string, unknown> => ({ ...base, assemble: { ...(base.assemble as object), project } });
  const doors = [parseConfig, (c: Record<string, unknown>) => parseEarlyConfig(c, 'assemble'), (c: Record<string, unknown>) => parseEarlyConfig(c, 'layers')];
  const valid = ['core', 'visible'].flatMap(project => doors.map(read => {
    try { return read(cfg(project)).assemble.project === project; } catch { return false; }
  }));
  say('CF9530_PROJECT_READS_AT_EVERY_CONFIG_DOOR', valid.every(Boolean), `both valid rules across full, assemble and layers: ${valid.join(',')}`);
  const invalid = ['other', '', 1, null, false].flatMap(value => doors.map(read => {
    try { read(cfg(value)); return false; } catch (e) {
      return e instanceof PartsError && e.problems.some(p => p.code === 'CONFIG_FIELD_TYPE' && p.object === 'config.assemble.project' && p.detail.includes('core') && p.detail.includes('visible'));
    }
  }));
  say('CF9531_BAD_PROJECT_IS_NAMED_WITH_ALLOWED_VALUES', invalid.every(Boolean), `fifteen invalid value/door controls: ${invalid.join(',')}`);
  say('CF9532_ABSENT_PROJECT_STAYS_ABSENT', doors.every(read => !('project' in read(base).assemble)), 'no field is synthesized by any config reader');
  writeAssembleFixture(dir);
  const run = (command: 'assemble' | 'build', name: string, config: Record<string, unknown>, flag?: string) => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
    const out = join(dir, name);
    const args = [join(ROOT, 'cli.ts'), command, '--config', join(dir, 'config.json'), '--source', command === 'build' ? join(dir, 'missing.png') : join(dir, 'painting.png'), '--full', join(dir, 'full'), '--head', join(dir, 'head'), '--out', out, ...(flag === undefined ? [] : ['--project', flag])];
    const q = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT });
    return { status: q.status, text: (q.stdout ?? '') + (q.stderr ?? ''), out };
  };
  const rows = [
    { name: 'absent', config: base, expected: 'core', flag: undefined },
    { name: 'configured', config: cfg('visible'), expected: 'visible', flag: undefined },
    { name: 'override', config: cfg('visible'), expected: 'core', flag: 'core' },
    { name: 'reverse', config: cfg('core'), expected: 'visible', flag: 'visible' },
  ];
  for (const command of ['assemble', 'build'] as const) {
    const got = rows.map(r => {
      const q = run(command, `${command}-${r.name}`, r.config, r.flag);
      return { name: r.name, status: q.status, ok: q.text.includes(`projection rule ${r.expected}`) && (command === 'assemble' ? q.status === 0 : q.status === 1 && q.text.includes('ASSEMBLE_SOURCE_PRESENT')) , text: q.text };
    });
    say(command === 'assemble' ? 'CF9533_ASSEMBLE_CLI_FLAG_CONFIG_DEFAULT_PRECEDENCE' : 'CF9534_BUILD_CLI_FLAG_CONFIG_DEFAULT_PRECEDENCE', got.every(r => r.ok), JSON.stringify(got.map(r => ({ ...r, text: r.ok ? 'expected rule observed' : r.text }))));
  }
  const absent = join(dir, 'assemble-absent', 'rig');
  const override = join(dir, 'assemble-override', 'rig');
  const files = existsSync(join(absent, 'parts')) ? ['parts.json', 'painting_in_rig.png', ...readdirSync(join(absent, 'parts')).map(f => `parts/${f}`)] : [];
  say('CF9535_EXPLICIT_OVERRIDE_PRESERVES_DEFAULT_PART_BYTES', files.length > 0 && files.every(f => existsSync(join(override, f)) && readFileSync(join(absent, f)).equals(readFileSync(join(override, f)))), `${files.length} part records/PNGs compare byte-identically`);
  const bad = run('assemble', 'invalid', cfg('bad'), 'visible');
  say('CF9536_INVALID_CONFIG_IS_NOT_HIDDEN_BY_A_CLI_OVERRIDE', bad.status === 1 && bad.text.includes('CONFIG_FIELD_TYPE: config.assemble.project'), bad.text);
}
if (import.meta.main) {
  const dir = mkdtempSync(join(tmpdir(), 'project-config-'));
  let failed = 0;
  try { runProjectConfigChecks(dir, (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); if (!ok) failed++; }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
  process.exit(failed ? 1 : 0);
}
