/** #999 public figures and full old/new build hashes, with one stable output
 * path and core runner so paths and tool identity are held constant.
 * bun tools/measure_edge_residual.ts --baseline <source snapshot> --out <evidence>
 */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from '../src/build.ts';
import { rigcRunnerAt } from '../src/check.ts';
import { EDGE_RESIDUAL_FILE, type EdgeResidualReport } from '../src/edgeresidual.ts';

function hashes(home: string, dir = home): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const path = join(dir, entry.name), name = relative(home, path);
    if (entry.isDirectory()) Object.assign(out, hashes(home, path));
    else if (name !== EDGE_RESIDUAL_FILE) out[name] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return out;
}
if (import.meta.main) {
  const baselineIndex = process.argv.indexOf('--baseline'), outIndex = process.argv.indexOf('--out');
  if (baselineIndex < 0 || outIndex < 0) throw new Error('requires --baseline and --out');
  const root = resolve(import.meta.dir, '..'), out = resolve(process.argv[outIndex + 1]);
  const old = await import(pathToFileURL(resolve(process.argv[baselineIndex + 1], 'src/build.ts')).href) as typeof import('../src/build.ts');
  const bin = join(root, 'node_modules', '.bin', 'rigc');
  const runner = rigcRunnerAt(bin, (command, args) => {
    const result = spawnSync(command, [...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (result.error !== undefined) return { status: 127, out: result.error.message };
    return { status: result.status ?? 1, out: (result.stdout ?? '') + (result.stderr ?? '') };
  });
  mkdirSync(out, { recursive: true });
  const rows = [];
  for (const key of ['demo', 'reference-demo', 'reference-sample', 'scarf', 'wind']) {
    const example = join(root, 'examples', key), inputs = join(example, 'inputs');
    const target = join(out, 'working-build');
    const input = { config: join(example, 'config.json'), source: join(inputs, 'painting.png'), full: join(inputs, 'layers', 'full'), head: join(inputs, 'layers', 'head'), out: target, project: 'visible' as const, pageEdges: 'pot' as const, loop: false };
    const runners = { rig: runner, check: runner, checkBin: bin, scratch: join(out, 'gate-scratch') };
    rmSync(target, { recursive: true, force: true });
    const oldLog: string[] = [], newLog: string[] = [];
    const beforeResult = old.build(input, runners, line => oldLog.push(line));
    writeFileSync(join(out, key + '-old.log'), oldLog.join('\n') + '\n');
    if (beforeResult.stoppedAt !== null) throw new Error(`${key} baseline stopped at ${beforeResult.stoppedAt}`);
    const before = hashes(target);
    rmSync(target, { recursive: true, force: true });
    const afterResult = build(input, runners, line => newLog.push(line));
    writeFileSync(join(out, key + '-new.log'), newLog.join('\n') + '\n');
    if (afterResult.stoppedAt !== null) throw new Error(`${key} current stopped at ${afterResult.stoppedAt}`);
    const after = hashes(target);
    const report = JSON.parse(readFileSync(join(target, EDGE_RESIDUAL_FILE), 'utf8')) as EdgeResidualReport;
    const protectedFiles = Object.keys(before).filter(name => name === 'parts.json' || name.startsWith('parts/') || name === 'rig/mesh_report.json' || name === 'check/check.json');
    if (!protectedFiles.includes('rig/mesh_report.json') || !protectedFiles.includes('check/check.json')) throw new Error('full protected output set was not built');
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => before[name] !== after[name]);
    const row = { example: key, equal: changed.length === 0, changed, protected_files: protectedFiles.length, before, after, figures: report.summary, report };
    rows.push(row);
    writeFileSync(join(out, key + '-comparison.json'), JSON.stringify(row, null, 2) + '\n');
    cpSync(join(target, EDGE_RESIDUAL_FILE), join(out, key + '-edge_residuals.json'));
    console.log(JSON.stringify({ example: key, equal: row.equal, changed, protected_files: row.protected_files, figures: row.figures }));
    if (!row.equal) throw new Error(`${key} existing output bytes changed`);
    // Only hashes and the additive report are needed for the comparison receipt.
    rmSync(target, { recursive: true, force: true });
  }
  writeFileSync(join(out, 'comparisons.json'), JSON.stringify(rows, null, 2) + '\n');
}
