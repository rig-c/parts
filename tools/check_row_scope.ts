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
