import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHECK_ROW_FAMILY, CHECK_ROW_PATHS, checkRow, checkSlotParts, checkSlotRow, serializeCheckRows, type CheckRowFamily } from '../src/checkrow.ts';
/** An omission guard over emitted object rows, not a field-name classifier. */
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
export function checkRowFaults(value: unknown): string[] {
  const faults: string[] = [];
  const check = (row: Record<string, unknown>, path: string): void => {
    if (!['part', 'pair', 'rig'].includes(String(row.row_scope)) || !['finding', 'evidence'].includes(String(row.row_kind))) faults.push(`${path}: missing or invalid row_scope / row_kind`);
    const subjects = row.row_subjects;
    if (!Array.isArray(subjects) || !subjects.every(s => typeof s === 'string' && s.length > 0) || subjects.length !== (row.row_scope === 'part' ? 1 : row.row_scope === 'pair' ? 2 : 0)) faults.push(`${path}: invalid row_subjects`);
  };
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) v.forEach((entry, i) => {
      if (object(entry)) check(entry, `${path}[${i}]`);
      walk(entry, `${path}[${i}]`);
    });
    else if (object(v)) for (const [key, entry] of Object.entries(v)) {
      if (key === 'lines' && path.endsWith('.requirements') && object(entry)) for (const [name, row] of Object.entries(entry)) if (object(row)) check(row, `${path}.lines.${name}`);
      walk(entry, `${path}.${key}`);
    }
  };
  walk(value, 'check');
  return faults;
}
export function checkRowCombinations(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (object(v)) {
      if ('row_scope' in v && 'row_kind' in v) found.add(`${String(v.row_scope)}/${String(v.row_kind)}`);
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return [...found].sort();
}

/** Recursive schema: unknown object-array paths are denied, never classified by field names. */
export function checkRowSchemaFaults(value: unknown, requireFamily = true): string[] {
  const faults: string[] = [];
  const paths = Object.entries(CHECK_ROW_PATHS);
  const matches = (pattern: string, actual: readonly string[]): boolean => {
    const tokens = pattern.replaceAll('[]', '.[]').split('.');
    return tokens.length === actual.length && tokens.every((token, i) => token === '*' || token === actual[i]);
  };
  const row = (v: Record<string, unknown>, at: string[], familyPath: string[]): void => {
    const shown = at.join('.');
    const candidates = paths.filter(([, allowed]) => allowed.some(path => matches(path, familyPath)));
    if (candidates.length === 0) faults.push(`${shown}: unregistered object-row path`);
    const family: unknown = Reflect.get(v, CHECK_ROW_FAMILY);
    if ((requireFamily || family !== undefined) && !candidates.some(([key]) => key === family)) faults.push(`${shown}: family ${String(family)} does not register this path`);
    if (!['part', 'pair', 'rig'].includes(String(v.row_scope)) || !['finding', 'evidence'].includes(String(v.row_kind))) faults.push(`${shown}: missing or invalid row_scope / row_kind`);
    const subjects = v.row_subjects;
    if (!Array.isArray(subjects) || !subjects.every(s => typeof s === 'string' && s.length > 0) || subjects.length !== (v.row_scope === 'part' ? 1 : v.row_scope === 'pair' ? 2 : 0)) faults.push(`${shown}: invalid row_subjects`);
  };
  const walk = (v: unknown, path: string[]): void => {
    if (Array.isArray(v)) v.forEach((entry, i) => {
      if (object(entry)) row(entry, [...path, String(i)], path);
      walk(entry, [...path, '[]']);
    });
    else if (object(v)) for (const [key, entry] of Object.entries(v)) {
      const next = [...path, key];
      if (key === 'lines' && path.length === 1 && path[0] === 'requirements' && object(entry)) for (const [name, item] of Object.entries(entry)) if (object(item)) row(item, [...next, name], [...next, name]);
      walk(entry, next);
    }
  };
  walk(value, []);
  return faults;
}

/** Non-row shapes are excluded by structure, never by a producer's field names. */
export const CHECK_ROW_EXCLUSIONS = {
  scalar_arrays_and_tuples: 'Arrays of scalar values and numeric tuples do not contain object rows.',
  aggregate_records: 'Non-array records are aggregate fields, except requirements.lines, the named row dictionary.',
} as const;

/** One emitted schema fixture per registered family/path, including nested parent rows. */
export function checkRowSchemaFixtures(): Array<{ family: CheckRowFamily; path: string; value: unknown }> {
  const entries = Object.entries(CHECK_ROW_PATHS) as Array<[CheckRowFamily, readonly string[]]>;
  const tokens = (path: string): string[] => path.replaceAll('[]', '.[]').split('.');
  const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
  return entries.flatMap(([family, paths]) => paths.map(path => {
    const parts = tokens(path);
    let value: unknown = checkRow(family, 'rig', false, []);
    if (!path.startsWith('requirements.lines.')) value = [value];
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] === '[]') {
        const parent = entries.find(([, paths]) => paths.some(p => same(tokens(p), parts.slice(0, i))));
        if (parent === undefined || !object(value)) throw new Error(`missing schema fixture parent for ${path}`);
        value = [{ ...checkRow(parent[0], 'rig', false, []), ...value }];
      } else value = { [parts[i] === '*' ? 'sample.with.dot' : parts[i]]: value };
    }
    return { family, path, value };
  }));
}

export function runCheckRowSchemaChecks(say: (name: string, ok: boolean, detail: string, why: string) => void): void {
  const fixtures = checkRowSchemaFixtures();
  const problems = fixtures.flatMap(f => checkRowSchemaFaults(f.value).map(problem => `${f.family}: ${problem}`));
  say('TY824_EVERY_REGISTERED_ROW_FAMILY_AND_PROJECTION_HAS_A_SCHEMA_WITNESS', problems.length === 0,
    `${fixtures.length} family/path fixtures; ${problems.slice(0, 3).join('; ') || 'all labelled, including dotted dictionary keys'}`,
    'the same recursive schema checks every serialization in selftests, regardless of fixture coverage or source directory');
  const unlabelled = { loop_physics: [{ name: 'generated constraint', bone: 'root' }] };
  const omission = checkRowSchemaFaults(unlabelled);
  say('TY825_A_PRODUCER_WITHOUT_CHECKROW_IS_REFUSED', omission.some(p => p.includes('row_scope / row_kind')) && omission.some(p => p.includes('family undefined')),
    omission.join('; '), 'a plain object producer must fail without depending on a checkRow call-site inventory');
  const mismatch = checkRowSchemaFaults({ loop_physics: [{ ...checkRow('CLOTH_SETTLES.rows', 'rig', false, []) }] });
  say('TY826_A_REGISTERED_FAMILY_ON_THE_WRONG_JSON_PATH_IS_REFUSED', mismatch.some(p => p.includes('family CLOTH_SETTLES.rows does not register this path')),
    mismatch.join('; '), 'a valid family key cannot label another family path');
  const unknown = checkRowSchemaFaults({ future: [{ ...checkRow('loop_physics', 'rig', false, []) }] });
  say('TY827_A_LABELLED_UNREGISTERED_OBJECT_ARRAY_IS_REFUSED', unknown.some(p => p.includes('unregistered object-row path')),
    unknown.join('; '), 'labels alone cannot extend the schema');
  const bytes = fixtures.every(f => JSON.stringify(f.value, null, 1) + '\n' === serializeCheckRows(f.value) && !serializeCheckRows(f.value).includes('check row family'));
  say('TY828_FAMILY_PROVENANCE_ADDS_NO_SERIALIZED_BYTES', bytes,
    `${fixtures.length} complete-output serialization comparisons`, 'enumerable symbols survive spreads but JSON ignores their keys');
  const rig = { skins: { default: { generated: { draw: { image: 'piece.png' } }, unrelated: { draw: { image: 'unknown.png' } }, mixed: { one: { image: 'piece.png' }, two: { image: 'other.png' } } } } };
  const mapping = checkSlotParts(rig, ['piece', 'other']);
  const known = checkSlotRow('TEXTURE_STRETCH.per_mesh', true, 'generated', mapping);
  const absent = checkSlotRow('TEXTURE_STRETCH.per_mesh', true, 'unrelated', mapping);
  const ambiguous = checkSlotRow('TEXTURE_STRETCH.per_mesh', true, 'mixed', mapping);
  const omitted = checkSlotRow('TEXTURE_STRETCH.per_mesh', true, 'piece');
  say('TY829_GENERATED_SLOTS_REQUIRE_A_REAL_UNAMBIGUOUS_PIECE_MAPPING', known.row_scope === 'part' && known.row_subjects.join() === 'piece' && [absent, ambiguous, omitted].every(r => r.row_scope === 'rig' && r.row_subjects.length === 0) && [known, absent, ambiguous, omitted].every(r => r.row_kind === 'finding'),
    'renamed slot resolves its image; absent, mixed and omitted mappings have rig scope; findings unchanged', 'slot spelling never supplies a part name');
}

/** Isolated negatives use Bun's native spawn so their expected denial cannot poison the parent. */
export function runCheckRowGuardChecks(root: string, say: (name: string, ok: boolean, detail: string, why: string) => void): void {
  const serializer = JSON.stringify(pathToFileURL(join(root, 'src/checkrow.ts')).href);
  const preload = join(root, 'tools/check_row_guard.ts');
  const invalid = `const {serializeCheckRows}=await import(${serializer}); try { serializeCheckRows({loop_physics:[{name:'unlabelled'}]}); } catch {}`;
  const mismatch = `const {serializeCheckRows,checkRow}=await import(${serializer}); serializeCheckRows({loop_physics:[checkRow('CLOTH_SETTLES.rows','rig',false,[])]});`;
  const nested = `const {spawnSync}=await import('node:child_process'); const child=spawnSync(process.execPath,['-e',${JSON.stringify(invalid)}],{encoding:'utf8'}); process.exit(child.status??0);`;
  const probe = (code: string, guarded: boolean) => {
    const result = Bun.spawnSync({ cmd: [process.execPath, ...(guarded ? ['--preload', preload] : []), '-e', code], cwd: root, stdout: 'pipe', stderr: 'pipe' });
    return { status: result.exitCode, stderr: Buffer.from(result.stderr).toString(), stdout: Buffer.from(result.stdout).toString() };
  };
  const swallowed = probe(invalid, true), child = probe(nested, true), wrongPath = probe(mismatch, true), consumer = probe(invalid, false);
  say('TY832_TEST_ROW_SCHEMA_DENIAL_SURVIVES_SWALLOWING_AND_BUN_DESCENDANTS',
    [swallowed, child, wrongPath].every(r => r.status !== 0 && r.stderr.includes('check row schema:')) && consumer.status === 0 && consumer.stderr === '' && consumer.stdout === '',
    `swallowed ${swallowed.status}, descendant ${child.status}, mismatch ${wrongPath.status}; unguarded consumer ${consumer.status} with empty streams`,
    'the test preload enforces the same schema on actual serialization and descendants; consumers acquire no new failure');
}
