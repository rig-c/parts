/** Additive consumer metadata, assigned where a check row is produced (#1089).
 * The family literal anchors the generated reference table; it is not serialized.
 * Finding is the producer's existing bar/warning decision, never a status guess.
 */
/** Registered JSON paths, including projections of the same producer rows. */
export const CHECK_ROW_PATHS = {
  'ANIMATIONS_DO_NOT_FOLD.declared_not_folding': ['ANIMATIONS_DO_NOT_FOLD.declared_not_folding'],
  'ANIMATIONS_DO_NOT_FOLD.folding': ['ANIMATIONS_DO_NOT_FOLD.folding'],
  'ART_JOINT_DISTANCE.joints': ['ART_JOINT_DISTANCE.joints'],
  'BOUNDARY_COLOUR_STEP.over': ['BOUNDARY_COLOUR_STEP.over'],
  'BOUNDARY_COLOUR_STEP.unmeasured': ['BOUNDARY_COLOUR_STEP.unmeasured'],
  'CLOTH_SETTLES.rows': ['CLOTH_SETTLES.rows'],
  'CUT_JOINT_MATERIAL.rows': ['CUT_JOINT_MATERIAL.rows'],
  'FEET_STAY_LEVEL.feet': ['FEET_STAY_LEVEL.feet'],
  'FEET_STAY_LEVEL.feet[].worst.through': ['FEET_STAY_LEVEL.feet[].worst.through'],
  'LIMB_ONE_BONE.parts': ['LIMB_ONE_BONE.parts'],
  'PART_SUPPORT_REPORT.pairs': ['PART_SUPPORT_REPORT.pairs'],
  'PART_SUPPORT_REPORT.raw_pairs': ['PART_SUPPORT_REPORT.raw_pairs'],
  'PART_SUPPORT_REPORT.unowned.regions': ['PART_SUPPORT_REPORT.unowned.regions'],
  'SEAM_OVER_MOTION.pairs': ['SEAM_OVER_MOTION.pairs'],
  'SEAM_OVER_MOTION.required.pairs': ['SEAM_OVER_MOTION.required.pairs'],
  'SEAM_OVER_MOTION.roots.unmeasured': ['SEAM_OVER_MOTION.roots.unmeasured'],
  'SEAM_OVER_MOTION.rows': ['SEAM_OVER_MOTION.rows'],
  'SEAM_OVER_MOTION.rows[].cells': ['SEAM_OVER_MOTION.rows[].cells'],
  'SEAM_OVER_MOTION.rows[].joint_contact.reasons': ['SEAM_OVER_MOTION.rows[].joint_contact.reasons'],
  'SEAM_OVER_MOTION.rows[].pose_at_worst.joints': ['SEAM_OVER_MOTION.rows[].pose_at_worst.joints'],
  'SEAM_OVER_MOTION.worlds.*.rows': ['SEAM_OVER_MOTION.worlds.*.rows'],
  'SEAM_OVER_RANGE.joints': ['SEAM_OVER_RANGE.joints'],
  'SEAM_OVER_RANGE.joints[].poses': ['SEAM_OVER_RANGE.joints[].poses'],
  'SETUP_MATCHES_PAINTING.regions': ['SETUP_MATCHES_PAINTING.regions'],
  'SETUP_MATCHES_PAINTING.regions[].slots': ['SETUP_MATCHES_PAINTING.regions[].slots'],
  'STILL_REGIONS_DARK.*.crossing': ['STILL_REGIONS_DARK.*.crossing'],
  'STILL_REGIONS_DARK.*.still_slots': ['STILL_REGIONS_DARK.*.still_slots'],
  'STRESS_OFF_CHAIN.not_read': ['STRESS_OFF_CHAIN.not_read'],
  'STRESS_OFF_CHAIN.per_part': ['STRESS_OFF_CHAIN.per_part'],
  'STRESS_OFF_CHAIN.per_part[].off_chain': ['STRESS_OFF_CHAIN.per_part[].off_chain'],
  'STRESS_OFF_CHAIN.per_part[].poses': ['STRESS_OFF_CHAIN.per_part[].poses'],
  'TEXTURE_STRETCH.per_mesh': ['TEXTURE_STRETCH.per_mesh'],
  'TIP_OVER_ROOT.parts': ['TIP_OVER_ROOT.parts'],
  'WIND_BAND.pairs': ['WIND_BAND.pairs'],
  'WIND_BAND.pairs[].steps': ['WIND_BAND.pairs[].steps'],
  'figure_openings.openings': ['figure_openings.openings'],
  'loop_physics': ['loop_physics'],
  'requirements.lines.* (bone)': ['requirements.lines.*'],
  'requirements.lines.* (seam)': ['requirements.lines.*'],
  'requirements.lines.* (stretch)': ['requirements.lines.*'],
  'seam_pairs': ['seam_pairs', 'seam_scope.whole_pairs', 'sets.*.seam_pairs', 'sets.*.seam_scope.whole_pairs'],
  'seam_scope.changes': ['seam_scope.changes', 'sets.*.seam_scope.changes'],
  'seam_scope.domain.states': ['seam_scope.domain.states', 'sets.*.seam_scope.domain.states'],
  'seam_scope.pairs': ['seam_scope.pairs', 'sets.*.seam_scope.pairs'],
  'seam_scope.population.pairs': ['seam_scope.population.pairs', 'sets.*.seam_scope.population.pairs'],
  'seam_scope.population.single_art': ['seam_scope.population.single_art', 'sets.*.seam_scope.population.single_art'],
} as const;
export type CheckRowFamily = keyof typeof CHECK_ROW_PATHS;
/** Enumerable so object spread preserves provenance; JSON never serializes symbols. */
export const CHECK_ROW_FAMILY: unique symbol = Symbol.for('@rig-c/parts/check-row-family');
/** Test preloads recognize serialized documents even in packed-install copies. */
export const CHECK_ROW_DOCUMENT: unique symbol = Symbol.for('@rig-c/parts/check-row-document');

export type CheckRowScope = 'part' | 'pair' | 'rig';
export interface CheckRowLabels {
  [CHECK_ROW_FAMILY]: CheckRowFamily;
  row_scope: CheckRowScope;
  row_kind: 'finding' | 'evidence';
  /** Actual named parts only; rig observations have no implied part attribution. */
  row_subjects: string[];
}
export function checkRow(family: CheckRowFamily, scope: CheckRowScope, finding: boolean, subjects: readonly string[]): CheckRowLabels {
  return { [CHECK_ROW_FAMILY]: family, row_scope: scope, row_kind: finding ? 'finding' : 'evidence', row_subjects: [...subjects] };
}

/** Legacy figures for human-readable formatters and compatibility oracles. */
export function withoutCheckRows(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCheckRows);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['row_scope', 'row_kind', 'row_subjects'].includes(key))
    .map(([key, entry]) => [key, withoutCheckRows(entry)]));
  return value;
}

/** A slot alone proves no part identity. The caller supplies a witnessed mapping. */
export function checkSlotRow(family: CheckRowFamily, finding: boolean, slot: string, pieces?: ReadonlyMap<string, string>): CheckRowLabels {
  const part = pieces?.get(slot);
  return checkRow(family, part === undefined ? 'rig' : 'part', finding, part === undefined ? [] : [part]);
}

/** Serialization has no production validation side effect; tests guard this boundary. */
export function serializeCheckRows(value: unknown): string {
  const document = value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...value, [CHECK_ROW_DOCUMENT]: true } : value;
  return `${JSON.stringify(document, null, 1)}\n`;
}

/** Resolve default-skin drawings only to one manifest piece, including declared set images. */
export function checkSlotParts(rig: Readonly<Record<string, unknown>>, partNames: readonly string[], alternateSets: readonly string[] = []): ReadonlyMap<string, string> {
  const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
  const skin = record(rig.skins) && record(rig.skins.default) ? rig.skins.default : {};
  const named = new Set(partNames), mapping = new Map<string, string>();
  for (const [slot, drawings] of Object.entries(skin)) {
    if (!record(drawings)) continue;
    const names = Object.values(drawings).map(d => record(d) && typeof d.image === 'string' && d.sequence === undefined && ['region', 'mesh'].includes(typeof d.type === 'string' ? d.type : 'region') ? d.image.replace(/\.png$/, '') : undefined);
    const candidates = names.length === 0 ? [] : [...named].filter(part => names.every(name => name !== undefined && (name === part || alternateSets.some(set => name === `${set}_${part}`))));
    if (candidates.length === 1) mapping.set(slot, candidates[0]);
  }
  return mapping;
}
