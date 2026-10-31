/** Shared seam choices for the config reader and assembly. */
export type SeamRule = 'near-white' | 'silhouette';
export const SEAM_RULES: readonly SeamRule[] = ['near-white', 'silhouette'];

/**
 * The seam rule a run uses when none is named. Set by measurement, not taste:
 * the silhouette rule ships as the default only if it lowers the error pixel
 * count on every oracle character without raising mean |d| on any
 * (ORACLE_assemble.md, *faithful vs silhouette*).
 */
export const DEFAULT_SEAM_RULE: SeamRule = 'near-white';
