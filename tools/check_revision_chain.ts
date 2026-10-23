/** Issue #531: metadata-only controls, including tracked public-family bytes; no builds or acceptance runs. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { carryProvenance, hashRows, readTree, sha256, type FileTree } from '../src/remesh.ts';
import { PartsError } from '../src/errors.ts';
import { rigJsonText } from '../src/rig.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function runRevisionChainChecks(dir: string, say: Say): void {
  const root = resolve(import.meta.dir, '..');
  const advance = (tree: FileTree, file: 'remesh.json' | 'retune.json'): FileTree => {
    const carried = carryProvenance(tree, tree, file);
    const record = { spec: file === 'remesh.json' ? 'rig-parts-remesh/1' : 'rig-parts-retune/1', input: { rig: hashRows(tree), ...(carried.parents.length === 0 ? {} : { provenance: carried.parents }) }, revision: hashRows(carried.revision) };
    carried.revision.set(file, bytes(rigJsonText(record)));
    return carried.revision;
  };
  for (const key of ['demo', 'reference-demo', 'reference-sample', 'scarf', 'wind']) {
    const base = readTree(join(root, 'examples', key, 'expected'));
    for (const [first, second] of [['remesh.json', 'remesh.json'], ['retune.json', 'retune.json'], ['remesh.json', 'retune.json'], ['retune.json', 'remesh.json']] as const) {
      const parent = advance(base, first), output = advance(parent, second);
      const at = join(dir, key, `${first}-${second}`);
      for (const [file, data] of output) { mkdirSync(join(at, file, '..'), { recursive: true }); writeFileSync(join(at, file), data); }
      const written = readTree(at);
      const record = JSON.parse(readFileSync(join(at, second), 'utf8')) as { input: { provenance: Array<{ source: string; path: string; sha256: string; bytes: number }> }; revision: unknown };
      const before = parent.get(first) as Uint8Array;
      const row = record.input.provenance.find((r) => r.source === first);
      const recovered = row === undefined ? undefined : written.get(row.path);
      const listed = new Map(written); listed.delete(second);
      const identical = same(hashRows(output), hashRows(advance(parent, second)));
      say(`RH698_${key.toUpperCase().replace(/-/g, '_')}_${first.slice(0, -5).toUpperCase()}_${second.slice(0, -5).toUpperCase()}`,
        same(record.revision, hashRows(listed)) && recovered !== undefined && row?.sha256 === sha256(before) && row.bytes === before.length && sha256(recovered) === sha256(before) && identical,
        `${record.input.provenance.length} parent row(s); ${hashRows(listed).length} written hash rows agree; parent recoverable ${recovered !== undefined && sha256(recovered) === sha256(before)}; repeat identical ${identical}; metadata writer only, command acceptance pending`);
    }
  }
  const original = bytes('{"spec":"legacy","bytes":"kept exactly"}\n');
  const file = `provenance/remesh-${sha256(original)}.json`;
  const planted: FileTree = new Map([['remesh.json', original], [file, bytes('different')]]);
  let collision = false;
  try { carryProvenance(planted, planted, 'remesh.json'); }
  catch (e) { collision = e instanceof PartsError && e.problems.some((p) => p.code === 'REMESH_PRESERVED' && p.object === file); }
  say('RH698_A_PARENT_ARCHIVE_COLLISION_IS_REFUSED_WITHOUT_CHANGING_INPUT', collision && new TextDecoder().decode(planted.get(file)) === 'different', `collision refused ${collision}; input untouched`);
}
