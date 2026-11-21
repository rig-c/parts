/**
 * The mesh-draft fixture (issue #265): one tall flat strip on a three-link
 * chain, and a small block drawn as a region, so a rig builds, gates and
 * checks green and the figure is tall enough for the figure's rules to give a
 * spacing.
 *
 * ⭐ Nothing here is art. `strip` is an opaque 16x400 block, `mark` a 4x4 one.
 * No claim about appearance comes from them.
 *
 * ## The figure, by hand
 *
 * `mark` sits at (2, 2), 4x4; `strip` at (12, 10), 16x400. The union of the
 * boxes runs from row 2 to row 410, so **H = 408**: the tolerance and margin
 * T = max(1, round(408 / 554)) = max(1, 0) = **1**, and the spacing and the
 * longest outline edge S = round(408 / 37) = round(11.03) = **11**.
 *
 * ## The bones and the bend set
 *
 * `body` at (20, 10) under root; the chain `tail` under it through (20, 12),
 * (20, 145) and (20, 278) (the links a third of 400 apart, rounded), its tip at
 * (20, 408): **tail0, tail1, tail2**. The strip's segments name `tail`, so its
 * bend set turns all three links. `mark` is a region on `body`. The idle swings
 * the chain with amplitudes 1, 2 and 3 degrees, so `CHAIN_LAG` reads it and
 * `TEXTURE_STRETCH` reads the strip; no part is a topwear, eyewhite, handwear,
 * bottomwear, face or footwear, so the other judgement lines say SKIP.
 *
 * ## The three lattices
 *
 * The strip's lattice is the fixture's one free number. At grid 10 the gate
 * drafts the candidate (it holds every motion line and has fewer triangles).
 * At grid 12 the lattice has fewer triangles than the candidate, so reading 5
 * keeps it. At grid 8 the lattice is fine enough that the candidate's worst
 * sample at the bend set reads above the lattice's by more than a tenth.
 * Which one a control uses is said where it is used; no control reads a
 * figure off the readings but its verdict.
 */
import type { PartsFile } from '../src/parts.ts';
import type { Raster } from '../src/raster/types.ts';
import { block, writeRigFixture } from './rig.ts';

/** The figure's height and the two rules' values, by hand (module header). */
export const DRAFT_FIGURE = { top: 2, bottom: 410, height: 408, tolerance: 1, spacing: 11 } as const;

/** The lattice the gate drafts over, the one reading 5 keeps, and the one the bend keeps (module header). */
export const DRAFT_COARSE_GRID = 10;
export const DRAFT_COSTLY_GRID = 12;
export const DRAFT_FINE_GRID = 8;

/** The chain's links, root first. */
export const DRAFT_LINKS = ['tail0', 'tail1', 'tail2'] as const;

export function draftParts(): PartsFile {
  const rec = (name: string, from: string, x: number, y: number, w: number, h: number): PartsFile['parts'][number] => ({
    name,
    from,
    x,
    y,
    w,
    h,
    opaque_px: w * h,
    projected_core_px: 0,
    source_px_taken: 0,
    refused_drift_px: 0,
    merged_px: 0,
    seam_override_px: 0,
  });
  return { rig_size: [40, 420], scale_rig_per_source: 0.5, parts: [rec('strip', 'full:legwear', 12, 10, 16, 400), rec('mark', 'full:neckwear', 2, 2, 4, 4)], ghost_px: {} };
}

export function draftImages(): Map<string, Raster> {
  return new Map([
    ['strip', block(16, 400)],
    ['mark', block(4, 4)],
  ]);
}

/** The config, its strip on a lattice of `grid`. */
export function draftConfig(grid: number): Record<string, unknown> {
  return {
    key: 'draft',
    assemble: { rig_scale: 0.5, plan: [['strip', 'full', 'legwear'], ['mark', 'full', 'neckwear']] },
    bones: [
      { name: 'body', parent: 'root', at: [20, 10] },
      { chain: 'tail', parent: 'body', points: [[20, 12], [20, 145], [20, 278]], tip: [20, 408] },
    ],
    meshes: { strip: { grid, r: 8, segments: ['tail'] } },
    regions: { mark: 'body' },
    motion: { duration: 4, tracks: [{ chain: 'tail', amps: [1, 2, 3], period: 4, phase: 0, lag: 0.1 }] },
  };
}

/** The fixture on disk: `<dir>/config.json` and `<dir>/parts-in/` (parts.json and parts/). */
export function writeDraftFixture(dir: string, grid: number): { config: string; parts: string } {
  return writeRigFixture(dir, draftConfig(grid), draftImages(), draftParts());
}

/**
 * The mark's contour entry (issue #307): the same fixture with `mark` meshed in the outline mode instead of drawn as
 * a region, so the config holds one entry that is not a lattice. `mesh-draft` drafts lattice entries only; this one
 * it must name as not compared, and the strip's lattice row must not move. The numbers are the outline mode's
 * smallest on a 4x4 block (tolerance and margin 1, spacing 2) and the segment runs along the block's left edge on
 * `body`; nothing reads a figure off the mark's mesh.
 */
export const DRAFT_CONTOUR_MARK = { contour: { tolerance: 1, margin: 1, spacing: 2 }, r: 8, segments: [['body', [2, 2], [2, 6]]] } as const;

/** The fixture with `mark` as {@link DRAFT_CONTOUR_MARK} rather than a region, its strip on a lattice of `grid`. */
export function writeDraftFixtureWithContour(dir: string, grid: number): { config: string; parts: string } {
  const c = draftConfig(grid);
  c.meshes = { ...(c.meshes as Record<string, unknown>), mark: DRAFT_CONTOUR_MARK };
  c.regions = {};
  return writeRigFixture(dir, c, draftImages(), draftParts());
}

/**
 * The islands fixture (issue #326, Stage B): {@link draftConfig}'s figure with two more lattice parts, each one image
 * of two flat blocks — `block(30, 8, [8, 24])`, an 8x8 block (x 0..7, 64 px) and a 6x8 one (x 24..29, 48 px), 16 px
 * apart — on a rig 80 px wide:
 *
 * - `pins` at (40, 20), carried by **one** bone: its one segment runs along `pin` ([40, 24] → [70, 24]), so every
 *   lattice vertex is bound to `pin` alone and mesh-draft drafts the two blocks joined by a bridge.
 * - `studs` at (40, 60), carried by **two**: one segment on `stud_a` down the left block's left edge ([40, 60] →
 *   [40, 68]) and one on `stud_b` down the right block's right edge ([70, 60] → [70, 68]), r 4, so the lattice's
 *   vertices are bound to both bones and mesh-draft keeps the lattice, naming them.
 * - `specks` at (40, 100), 30x8, on `pin` too (issue #326, HQ's ruling on the speck): the 8x8 block at alpha 255 and
 *   a 2x3 speck at x 26..27, y 2..4 at **alpha 40** — 6 px, a real piece (more than 4 px), every pixel under 64: faint,
 *   so the draft leaves it out and its line names it. The pins beside it are the positive: their 6x8 block is visible
 *   and bridged although its bridge, across the 14 px left between the grown blocks, covers more than its 48 px.
 *
 * The figure does not move: the new boxes lie inside rows 20..108, within the union's rows 2..410, so H = 408,
 * T = 1 and S = 11 as {@link DRAFT_FIGURE} says. At T = 1 the blocks grow by one pixel each and stay 14 px apart, so
 * each image traces as two silhouettes. The lattices are at grid {@link DRAFT_ISLANDS_GRID}, finer than the
 * candidate is coarse; no control reads a figure off the lattice but the verdict and the note.
 */
export const DRAFT_ISLANDS_GRID = 2;

/** The two-block image both parts share. */
export const DRAFT_ISLANDS_IMAGE: readonly [number, number, readonly [number, number]] = [30, 8, [8, 24]];

/** The speck image: the 8x8 block at x 0..7 and a faint 2x3 speck (alpha 40) at x 26..27, y 2..4, in 30x8. */
export const DRAFT_SPECK_ALPHA = 40;

export function speckImage(): Raster {
  const r = block(30, 8, [8, 30]);
  for (let y = 2; y < 5; y++) for (let x = 26; x < 28; x++) r.data.set([200, 120, 80, DRAFT_SPECK_ALPHA], (y * 30 + x) * 4);
  return r;
}

export function draftIslandsParts(): PartsFile {
  const p = draftParts();
  const rec = (name: string, tag: string, y: number, px: number): PartsFile['parts'][number] => ({ ...p.parts[0], name, from: `full:${tag}`, x: 40, y, w: 30, h: 8, opaque_px: px });
  return { ...p, rig_size: [80, 420], parts: [...p.parts, rec('pins', 'earwear', 20, 112), rec('studs', 'headwear', 60, 112), rec('specks', 'objects', 100, 70)] };
}

export function draftIslandsConfig(grid: number): Record<string, unknown> {
  const c = draftConfig(grid);
  const a = c.assemble as { plan: string[][] };
  c.assemble = { ...a, plan: [...a.plan, ['pins', 'full', 'earwear'], ['studs', 'full', 'headwear'], ['specks', 'full', 'objects']] };
  c.bones = [...(c.bones as unknown[]), { name: 'pin', parent: 'body', at: [40, 24] }, { name: 'stud_a', parent: 'body', at: [40, 60] }, { name: 'stud_b', parent: 'body', at: [70, 60] }];
  c.meshes = {
    ...(c.meshes as Record<string, unknown>),
    pins: { grid: DRAFT_ISLANDS_GRID, r: 4, segments: [['pin', [40, 24], [70, 24]]] },
    studs: { grid: DRAFT_ISLANDS_GRID, r: 4, segments: [['stud_a', [40, 60], [40, 68]], ['stud_b', [70, 60], [70, 68]]] },
    specks: { grid: DRAFT_ISLANDS_GRID, r: 4, segments: [['pin', [40, 104], [70, 104]]] },
  };
  return c;
}

/** The islands fixture on disk, its strip on a lattice of `grid`. */
export function writeDraftIslandsFixture(dir: string, grid: number): { config: string; parts: string } {
  const [w, h, gap] = DRAFT_ISLANDS_IMAGE;
  const images = draftImages();
  images.set('pins', block(w, h, [gap[0], gap[1]]));
  images.set('studs', block(w, h, [gap[0], gap[1]]));
  images.set('specks', speckImage());
  return writeRigFixture(dir, draftIslandsConfig(grid), images, draftIslandsParts());
}
