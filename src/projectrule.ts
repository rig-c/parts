/** Shared projection choices for the config reader and assembly. */

/**
 * Where a layer may take the painting's pixel (`projectSource` in
 * `src/assemble.ts`). `core` is the reference's rule: the layer's top-most
 * `alpha >= 250` pixels eroded by a 5x5 square, so a part a few pixels wide has
 * no core and none of its visible pixels is projected. `visible` keeps the
 * erosion only where it guards something — along a rim where a later layer of
 * the run is in front — and projects every other top-most `alpha >= 250` pixel
 * of the layer; the parts' visible edges are then resolved from the painting
 * (`paintingEdges`).
 */
export type ProjectRule = 'core' | 'visible';
export const PROJECT_RULES: readonly ProjectRule[] = ['core', 'visible'];

/**
 * The projection rule a run uses when none is named: the reference's, so the
 * examples stay comparable with it. `visible` was measured on the public
 * examples against it (the changes that added the flag and `paintingEdges`);
 * it is opt-in.
 */
export const DEFAULT_PROJECT_RULE: ProjectRule = 'core';
