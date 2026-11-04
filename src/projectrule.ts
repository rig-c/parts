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

/**
 * Issue #996: what lies behind the figure in the painting. `plain` is a ground
 * of one colour, the assumption `paintedFigure` (src/assemble.ts) makes when it
 * reads the border ring's median as the ground. `busy` is an opaque ground of
 * many colours (a wall, a banner), where that test marks the ground as figure
 * and the painting alone cannot tell a part's painted outline from the ground
 * next to it. Under `visible`, `paintingEdges` then bounds what a part may take
 * (see its invariant). The ground is declared by the author, never inferred.
 */
export type Ground = 'plain' | 'busy';
export const GROUNDS: readonly Ground[] = ['plain', 'busy'];

/** The ground when none is declared: `plain`, the code path every build ran before issue #996. */
export const DEFAULT_GROUND: Ground = 'plain';
