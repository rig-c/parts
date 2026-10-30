/** Bounded #877 checks and an independent API-pinned main baseline; no full suite. */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { runAuthoredUnitDepthChecks } from './check_authored_unit_depth.ts';
import { authoredUnitDepthFixture } from '../fixtures/authored_unit_depth.ts';
import { assembleStage } from '../src/build.ts';
import type { CharacterConfig } from '../src/config.ts';

const [mode, out, baseline] = process.argv.slice(2);
if (mode === '--help') { console.log('bun tools/measure_authored_unit_depth.ts --targeted <out> | --baseline <out> <API-pinned-source-root>'); process.exit(0); }
if (!out || !['--targeted', '--baseline'].includes(mode)) throw Error('use --help');
mkdirSync(out, { recursive: true });
if (mode === '--targeted') {
  const rows: Array<{ name: string; ok: boolean; detail: string }> = [];
  runAuthoredUnitDepthChecks(join(out, 'fixtures'), (name, ok, detail) => { rows.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); });
  const result = { passed: rows.filter(r => r.ok).length, failed: rows.filter(r => !r.ok).length, rows };
  writeFileSync(join(out, 'targeted.json'), JSON.stringify(result, null, 2)); process.exitCode = result.failed ? 1 : 0;
} else {
  if (!baseline) throw Error('baseline source root is required');
  const old = await import(resolve(baseline, 'src/build.ts')) as { assembleStage: typeof assembleStage };
  const rows = [];
  const digest = (dir: string, prefix = ''): Array<{ path: string; sha256: string }> => readdirSync(dir).sort().flatMap(name => {
    const path = join(dir, name), rel = prefix + name;
    return statSync(path).isDirectory() ? digest(path, rel + '/') : [{ path: rel, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }];
  });
  const cases: Array<[string, (c: CharacterConfig) => void]> = [
    ['no-turn-under', c => { delete c.turn; delete c.depth; }],
    ['no-turn-scalar', c => { delete c.turn; c.assemble.cuts = []; }],
    ['no-depth-unit', c => { delete c.depth; }],
  ];
  for (const [name, edit] of cases) {
    const home = join(out, name), cfg = authoredUnitDepthFixture(home); edit(cfg); const config = join(home, 'config.json'); writeFileSync(config, JSON.stringify(cfg));
    for (const [label, stage] of [['origin', old.assembleStage], ['current', assembleStage]] as const) {
      const dir = join(home, label); mkdirSync(join(dir, 'parts'), { recursive: true });
      stage({ source: join(home, 'source.png'), full: home, head: home, config, seam: 'near-white', project: 'core' }, { partsJson: join(dir, 'parts.json'), partsDir: join(dir, 'parts'), recomposite: join(dir, 'recomposite.png'), errorMap: join(dir, 'error.png') }, () => {});
    }
    const origin = digest(join(home, 'origin')), current = digest(join(home, 'current'));
    const equal = JSON.stringify(origin) === JSON.stringify(current); rows.push({ name, equal, origin, current }); console.log(`${equal ? 'PASS' : 'FAIL'} pinned-main bytes ${name}: ${current.length} output files`);
  }
  writeFileSync(join(out, 'baseline.json'), JSON.stringify({ baselineSource: baseline, rows }, null, 2)); process.exitCode = rows.every(r => r.equal) ? 0 : 1;
}
