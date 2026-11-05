/** Additive consumer metadata, assigned where a check row is produced (#1089).
 * The family literal anchors the generated reference table; it is not serialized.
 * Finding is the producer's existing bar/warning decision, never a status guess.
 */
export type CheckRowScope = 'part' | 'pair' | 'rig';
export interface CheckRowLabels {
  row_scope: CheckRowScope;
  row_kind: 'finding' | 'evidence';
  /** Actual named parts only; rig observations have no implied part attribution. */
  row_subjects: string[];
}
export function checkRow(_family: string, scope: CheckRowScope, finding: boolean, subjects: readonly string[]): CheckRowLabels {
  return { row_scope: scope, row_kind: finding ? 'finding' : 'evidence', row_subjects: [...subjects] };
}

/** Legacy figures for human-readable formatters and compatibility oracles. */
export function withoutCheckRows(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCheckRows);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['row_scope', 'row_kind', 'row_subjects'].includes(key))
    .map(([key, entry]) => [key, withoutCheckRows(entry)]));
  return value;
}
