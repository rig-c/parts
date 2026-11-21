/**
 * The rig stage's fixture: two flat parts, a small config, and the counts a
 * control compares against — every one of them derivable by hand from this
 * file, and derived below where it is stated.
 *
 * ⭐ Nothing here is art. `cloth` is an opaque 16x8 block, `eye` a 4x2 one.
 * No claim about appearance comes from them.
 *
 * ## The canvas and the bones
 *
 * A 40x40 rig, so `root` stands at (20, 40) in rig pixels (y down). Bones:
 * `body` at (20, 30); the chain `hem` through (14, 14) and (22, 14) with its
 * tip at (30, 14), so `hem0` and `hem1`; `eye` at (17, 28).
 *
 * ## The mesh, by hand
 *
 * `cloth` sits at (10, 10), 16x8. Padded by 4 it is a 24x16 image whose
 * top-left is rig (6, 6). A grid of 8 gives 3x2 cells with edges x = 0, 8,
 * 16, 24 and y = 0, 8, 16; the art covers padded x 4..19 and y 4..11, which
 * reaches into all six cells. So: 4x3 = **12 vertices**, 6 cells x 2 =
 * **12 triangles**, the outline of a 3x2 block of cells = 2 (3 + 2) = **10
 * hull vertices**, and 12 - 10 = 2 interior ones.
 *
 * The vertex at padded (8, 8) — uv (8/24, 8/16) = (0.333333, 0.5) — sits at
 * rig (14, 14), exactly on `hem0`'s origin (d = 0) and 8 px from `hem1`'s
 * segment (22,14)->(30,14), whose nearest point is its origin. With r = 8:
 * w0 = 1/(0+8)^2 = 1/64 and w1 = 1/(8+8)^2 = 1/256, so normalised
 * **hem0 0.8, hem1 0.2**. Its bind offsets, in Spine's axes (x from the
 * centre, y up): the vertex is (14 - 20, 40 - 14) = (-6, 26); `hem0` is
 * (-6, 26), so **(0, 0)**; `hem1` is (2, 26), so **(-8, 0)**.
 *
 * ## The region
 *
 * `eye` sits at (16, 26), 4x2: its centre is (18, 27), and the bone `eye` is
 * at (17, 28), so the offset is (18 - 17, (40 - 27) - (40 - 28)) = **(1, 1)**.
 *
 * ## The idle
 *
 * A 4 s idle with one chain track on `hem` (period 4, so 8 keys + the closing
 * one = **9 keys** per link) and a blink at t = 1 on `eye`. Both `hem` links
 * are keyed and weighted to by `cloth`, so each gets a control:
 * **root, body, hem0_ctl, hem0, hem1_ctl, hem1, eye** — 7 bones, in that
 * order (depth first, each control directly above its bone).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PartsFile } from '../src/parts.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';

export const RIG_CANVAS: [number, number] = [40, 40];

export const RIG_EXPECT = {
  vertices: 12,
  triangles: 12,
  hull: 10,
  bones: ['root', 'body', 'hem0_ctl', 'hem0', 'hem1_ctl', 'hem1', 'eye'],
  weighed: { uv: [0.333333, 0.5], weights: [{ bone: 'hem0', x: 0, y: 0, weight: 0.8 }, { bone: 'hem1', x: -8, y: 0, weight: 0.2 }] },
  region: { x: 1, y: 1 },
  keysPerLink: 9,
} as const;

/** An opaque block, or — with `gapFrom`/`gapTo` — the block with those columns cleared. */
export function block(w: number, h: number, gap?: [number, number]): Raster {
  const r = newRaster(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (gap !== undefined && x >= gap[0] && x < gap[1]) continue;
      r.data.set([200, 120, 80, 255], (y * w + x) * 4);
    }
  }
  return r;
}

export function rigParts(): PartsFile {
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
  return { rig_size: [...RIG_CANVAS], scale_rig_per_source: 0.5, parts: [rec('cloth', 'full:topwear', 10, 10, 16, 8), rec('eye', 'head:face', 16, 26, 4, 2)], ghost_px: {} };
}

export function rigImages(): Map<string, Raster> {
  return new Map([
    ['cloth', block(16, 8)],
    ['eye', block(4, 2)],
  ]);
}

/**
 * `cloth` as two islands: columns 4..11 of the unpadded part cleared, which
 * clears padded x 8..15 — the whole middle column of cells — leaving the left
 * and right columns of cells kept and nothing between them.
 */
export function islandParts(): PartsFile {
  const p = rigParts();
  return { ...p, parts: p.parts.map((r) => (r.name === 'cloth' ? { ...r, opaque_px: 64 } : r)) };
}

export function islandImages(): Map<string, Raster> {
  return new Map([
    ['cloth', block(16, 8, [4, 12])],
    ['eye', block(4, 2)],
  ]);
}

export function rigConfig(): Record<string, unknown> {
  return {
    key: 'fixture',
    assemble: {
      rig_scale: 0.5,
      plan: [
        ['cloth', 'full', 'topwear'],
        ['eye', 'head', 'face'],
      ],
    },
    bones: [
      { name: 'body', parent: 'root', at: [20, 30] },
      { chain: 'hem', parent: 'body', points: [[14, 14], [22, 14]], tip: [30, 14] },
      { name: 'eye', parent: 'body', at: [17, 28] },
    ],
    meshes: { cloth: { grid: 8, r: 8, segments: ['hem'] } },
    regions: { eye: 'eye' },
    motion: {
      duration: 4,
      tracks: [{ chain: 'hem', amps: [1, 2], period: 4, phase: 0, lag: 0.1 }],
      blink: { t: 1, eyes: ['eye'], brows: ['eye'], squash: 0.12, brow_drop: 1 },
    },
  };
}

/**
 * The turned-chain fixture (issue #73): the same two parts and canvas, with
 * the chain bent so its links point along known directions. `body` at
 * (20, 30); the chain `hem` through (14, 14) and (22, 20) with its tip at
 * (22, 26); a named bone `bead` under `hem1` at (22, 24); the region `eye`
 * rides `hem1`. No blink, so nothing keys a frame the chain turns.
 *
 * ## The turns, by hand
 *
 * In Spine's axes (x from the canvas centre 20, y up from 40):
 * `body` (0, 10), `hem0` (-6, 26), `hem1` (2, 20), the tip (2, 14),
 * `bead` (2, 16). `hem0` -> `hem1` is (8, -6): a 3-4-5 triangle,
 * **length 10**, direction atan2(-6, 8) = -atan(3/4) =
 * **-36.869898 degrees** (6 places). `hem1` -> tip is (0, -6):
 * **length 6, -90 degrees**. Both links are keyed and weighted to, so
 * each has a control carrying the turn: `hem0_ctl` local -36.869898 under the
 * unturned `body`, `hem1_ctl` local -90 - (-36.869898) = **-53.130102**,
 * each link local 0. `bead` is turned back upright: local **90**.
 *
 * Offsets in the turned frames (a vector v in a frame turned by t reads
 * R(-t) v): `hem1_ctl` in `hem0`'s frame: R(36.869898)(8, -6) =
 * (8 * 0.8 + 6 * 0.6, 8 * 0.6 - 6 * 0.8) = **(10, 0)**, the link's length
 * along its own axis. `bead` in `hem1`'s (-90): R(90)(0, -4) = **(4, 0)**.
 *
 * ## The weight and the region, by hand
 *
 * The cloth vertex at padded (8, 8) sits at rig (14, 14), `hem0`'s origin
 * (d = 0); its distance to `hem1`'s segment (22,20)->(22,26) is to the
 * segment's origin, sqrt(8^2 + 6^2) = 10. With r = 8: w0 = 1/64, w1 =
 * 1/324, normalised 324/388 = 0.835052 and 64/388, written **0.83505** and
 * **1 - 0.83505 = 0.16495**. Bind offsets: under `hem0`, **(0, 0)**; under
 * `hem1`, the world vector (-6, 26) - (2, 20) = (-8, 6) read in a frame
 * turned -90: R(90)(-8, 6) = **(-6, -8)**.
 *
 * `eye`'s centre (18, 27) is (-2, 13); from `hem1` that is (-4, -7), in its
 * frame R(90)(-4, -7) = **(7, -4)**, and the image is turned back by
 * **90** so it is drawn upright.
 *
 * The flat form, every bone unturned, is the plain world differences:
 * `hem0_ctl` (-6, 16), `hem1_ctl` (8, -6), `bead` (0, -4), the weights
 * (0, 0) and (-8, 6), `eye` (-4, -7).
 */
export const TURNED_EXPECT = {
  bones: ['root', 'body', 'hem0_ctl', 'hem0', 'hem1_ctl', 'hem1', 'bead'],
  oriented: {
    hem0_ctl: { length: 10, rotation: -36.869898, x: -6, y: 16 },
    hem0: { length: 10, rotation: 0, x: 0, y: 0 },
    hem1_ctl: { length: 6, rotation: -53.130102, x: 10, y: 0 },
    hem1: { length: 6, rotation: 0, x: 0, y: 0 },
    bead: { rotation: 90, x: 4, y: 0 },
  },
  flat: { body: [0, 10], hem0_ctl: [-6, 16], hem0: [0, 0], hem1_ctl: [8, -6], hem1: [0, 0], bead: [0, -4] },
  weighed: {
    uv: [0.333333, 0.5],
    oriented: [{ bone: 'hem0', x: 0, y: 0, weight: 0.83505 }, { bone: 'hem1', x: -6, y: -8, weight: 0.16495 }],
    flat: [{ bone: 'hem0', x: 0, y: 0, weight: 0.83505 }, { bone: 'hem1', x: -8, y: 6, weight: 0.16495 }],
  },
  region: { oriented: { image: 'eye.png', x: 7, y: -4, rotation: 90 }, flat: { image: 'eye.png', x: -4, y: -7 } },
  /** The landmarks in Spine's axes, by bone (a control stands at its bone's). */
  world: { root: [0, 0], body: [0, 10], hem0: [-6, 26], hem1: [2, 20], bead: [2, 16] },
} as const;

export function turnedConfig(): Record<string, unknown> {
  return {
    key: 'turned',
    assemble: {
      rig_scale: 0.5,
      plan: [
        ['cloth', 'full', 'topwear'],
        ['eye', 'head', 'face'],
      ],
    },
    bones: [
      { name: 'body', parent: 'root', at: [20, 30] },
      { chain: 'hem', parent: 'body', points: [[14, 14], [22, 20]], tip: [22, 26] },
      { name: 'bead', parent: 'hem1', at: [22, 24] },
    ],
    meshes: { cloth: { grid: 8, r: 8, segments: ['hem'] } },
    regions: { eye: 'hem1' },
    motion: {
      duration: 4,
      tracks: [{ chain: 'hem', amps: [1, 2], period: 4, phase: 0, lag: 0.1 }],
    },
  };
}

/**
 * The constraint fixture (issue #92): {@link rigConfig} with a scene target —
 * `tgt`, a single bone under `root` at rig (26, 20) — and the constraints a
 * control names, which `constraints` adds as `config.constraints`.
 *
 * ## The target, by hand
 *
 * In Spine's axes (x from the canvas centre 20, y up from 40): `tgt` is
 * (6, 20), `hem0` (-6, 26), `hem1` (2, 26). The chain's links are 8 and 8
 * long, so its reach from `hem0` is 16; `tgt` is (12, -6) from `hem0`,
 * sqrt(144 + 36) = sqrt(180) = 13.416…, inside that reach and outside the
 * 0 a fully folded pair reaches — so a two-bone ik over `hem0` and `hem1`
 * with no softness puts `hem1`'s tip, its origin carried its length along its
 * own x axis, exactly on `tgt`. `tgt` binds nothing and nothing keys it.
 */
export const SCENE_TARGET = { name: 'tgt', rig: [26, 20], spine: [6, 20] } as const;

export function constraintConfig(constraints?: unknown[]): Record<string, unknown> {
  const c = rigConfig();
  (c.bones as unknown[]).push({ name: SCENE_TARGET.name, parent: 'root', at: [...SCENE_TARGET.rig] });
  if (constraints !== undefined) c.constraints = constraints;
  return c;
}

/** The fixture on disk as the `rig` command reads it: `config.json`, and `parts.json` + `parts/` under `parts`. */
export function writeRigFixture(dir: string, config: Record<string, unknown> = rigConfig(), images: Map<string, Raster> = rigImages(), parts: PartsFile = rigParts()): { config: string; parts: string } {
  const partsDir = join(dir, 'parts-in');
  mkdirSync(join(partsDir, 'parts'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(partsDir, 'parts.json'), `${JSON.stringify(parts, null, 2)}\n`);
  for (const [name, img] of images) writeFileSync(join(partsDir, 'parts', `${name}.png`), encodePngBytes(img));
  return { config: join(dir, 'config.json'), parts: partsDir };
}

/**
 * The blink-still fixture (issue #26): an eye whose eyelash layer also carries
 * a crease above the lid, on a 48x64 rig. Bones: `head` at (24, 40) under
 * `root`, `eye` at the eyewhite's centre (22, 27) and `brow` at (22, 14), both
 * under `head`. The idle rolls `head` (a 2-degree sine over 4 s) and blinks at
 * t = 1 s — so the rest frames are not all axis-aligned, which is where a cut
 * through art would show.
 *
 * - `face` (head:face) 8,8 32x40, opaque — the layer under the eye, so a shut
 *   eye shows face, never the page.
 * - `eyewhite` (head:eyewhite-r) 16,24 12x6, opaque.
 * - `lash` (head:eyelash-r) 14,17 16x9: rows 17-18 are the crease (x 16..27),
 *   rows 19-20 carry no art, rows 21-25 the lash line across the full width.
 *   It reaches 24 - 17 = **7 px** above the eyewhite, 7 / 9 = **78 %** of its
 *   height. Rows 19 and 20 are clear, so the lowest clear row above the lid is
 *   **20**: `motion.blink.still.lash = {row: 20, bone: "head"}` cuts off rows
 *   17-19 (the crease, 12 x 2 = **24 px**) as `lash_still`.
 */
export const LASH_RIG: [number, number] = [48, 64];
export const LASH_CREASE = { x0: 16, x1: 28, y0: 17, y1: 19, px: 24 } as const;
export const LASH_ROW = 20;

function lashRaster(): Raster {
  const r = newRaster(16, 9);
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 16; x++) {
      const crease = y < 2 && x >= 2 && x < 14;
      const line = y >= 4;
      if (crease) r.data.set([90, 40, 40, 255], (y * 16 + x) * 4);
      else if (line) r.data.set([30, 20, 20, 255], (y * 16 + x) * 4);
    }
  }
  return r;
}

function lashRec(name: string, from: string, x: number, y: number, w: number, h: number, opaque: number): PartsFile['parts'][number] {
  return { name, from, x, y, w, h, opaque_px: opaque, projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 };
}

export function lashParts(): PartsFile {
  return {
    rig_size: [...LASH_RIG],
    scale_rig_per_source: 0.5,
    parts: [lashRec('face', 'head:face', 8, 8, 32, 40, 1280), lashRec('eyewhite', 'head:eyewhite-r', 16, 24, 12, 6, 72), lashRec('lash', 'head:eyelash-r', 14, 17, 16, 9, 24 + 80)],
    ghost_px: {},
  };
}

export function lashImages(): Map<string, Raster> {
  const white = newRaster(12, 6);
  for (let i = 0; i < 72; i++) white.data.set([250, 250, 250, 255], i * 4);
  return new Map([
    ['face', block(32, 40)],
    ['eyewhite', white],
    ['lash', lashRaster()],
  ]);
}

/** The fixture's config; `still` false leaves `motion.blink.still` out — the same rig with the whole lash blinking. */
export function lashConfig(still = true): Record<string, unknown> {
  const blink: Record<string, unknown> = { t: 1, eyes: ['eye'], brows: ['brow'], squash: 0.12, brow_drop: 1 };
  if (still) blink.still = { lash: { row: LASH_ROW, bone: 'head' } };
  return {
    key: 'lash_fixture',
    assemble: {
      rig_scale: 0.5,
      plan: [
        ['face', 'head', 'face'],
        ['eyewhite', 'head', 'eyewhite-r'],
        ['lash', 'head', 'eyelash-r'],
      ],
    },
    bones: [
      { name: 'head', parent: 'root', at: [24, 40] },
      { name: 'eye', parent: 'head', at: [22, 27] },
      { name: 'brow', parent: 'head', at: [22, 14] },
    ],
    meshes: {},
    regions: { face: 'head', eyewhite: 'eye', lash: 'eye' },
    motion: { duration: 4, tracks: [{ bone: 'head', prop: 'rotate', amp: 2, period: 4, phase: 0 }], blink },
  };
}

/**
 * The bone-heat strip (issue #161): the rig fixture with `cloth`'s segments
 * replaced by two vertical lines through the centres of its first and last
 * art columns, so the heat equilibrium is a 1-D one whose answer is linear.
 *
 * ## The field, by hand
 *
 * The padded `cloth` image's art is columns 4..19, rows 4..11 (16x8 = 128
 * px, one island, no hole); its top-left is rig (6, 6). Column 4's centres
 * are image x 4.5 = rig 10.5 and column 19's are image 19.5 = rig 25.5;
 * rows 4..11's centres are rig 10.5..17.5. So `hem0`'s segment
 * (10.5, 10.5)->(10.5, 17.5) passes through every centre of column 4 and
 * `hem1`'s through every centre of column 19: **8 source pixels each**.
 * Column 5's centres lie 1 px from `hem0`'s segment, past the 0.75 px band,
 * so no other pixel is a source. With 0 and 1 held on the two end columns,
 * no flux through the top and bottom rows and each free pixel the mean of
 * its neighbours, the solution is constant down a column and linear across:
 * `hem1`'s field at column c is **(c − 4) / 15**, `hem0`'s 1 − that.
 *
 * ## Two vertices, by hand
 *
 * A lattice vertex sits on a pixel corner, touching four pixels whose
 * centres are equally near it; the first in raster order is the one up and
 * to the left. The vertex at padded (8, 8) (uv 0.333333, 0.5) reads column
 * 7: hem1 3/15 = **0.2**, hem0 **0.8**. The vertex at padded (16, 8)
 * (uv 0.666667, 0.5) reads column 15: hem1 11/15 = 0.733333..., written
 * **0.73333**, and hem0 **1 − 0.73333 = 0.26667**, heaviest first.
 */
export const HEAT_STRIP_SEGMENTS = [
  ['hem0', [10.5, 10.5], [10.5, 17.5]],
  ['hem1', [25.5, 10.5], [25.5, 17.5]],
] as const;

export const HEAT_STRIP_EXPECT = {
  sources: 8,
  at: [
    { uv: [0.333333, 0.5], weights: [['hem0', 0.8], ['hem1', 0.2]] },
    { uv: [0.666667, 0.5], weights: [['hem1', 0.73333], ['hem0', 0.26667]] },
  ],
} as const;

/** The rig fixture with `cloth` on the strip's segments; `mesh` adds to (or replaces fields of) the mesh entry. */
export function heatStripConfig(mesh: Record<string, unknown> = {}): Record<string, unknown> {
  const c = rigConfig();
  (c.meshes as Record<string, unknown>).cloth = { grid: 8, r: 8, segments: HEAT_STRIP_SEGMENTS.map(([b, p, q]) => [b, [...p], [...q]]), ...mesh };
  return c;
}

/**
 * The dust fixture (issue #303): the rig fixture's config on a 72x56 rig, with
 * `cloth` a 56x40 part at (10, 10) whose columns 0..49 are an opaque 50x40
 * block — **2000 art px** — and beside it the runs `dustImages` is handed,
 * each a horizontal run of opaque pixels in columns 51..55 (unpadded), so
 * each is its own 4-connected island.
 *
 * ## Dust, by hand
 *
 * Dust is at most 4 px and at most 0.1 % of the part's art (`isDust`,
 * `src/mesh.ts`). With one run of n px beside the block the art is 2000 + n
 * px: 1 px (1 <= 2.001) and 2 px (2 <= 2.002) are dust, 3 px is not
 * (3 > 2.003), by the share alone.
 *
 * ## The lattice, by hand (grid 8)
 *
 * Padded by 4 the image is 64x48, top-left rig (6, 6); the block covers
 * padded x 4..53 and y 4..43, so cell columns 0..6 and rows 0..5: 7x6 = 42
 * cells, 8x7 = **56 vertices**, **84 triangles**. A run at unpadded (53, 20)
 * sits at padded (57, 24), alone in cell (7, 3), which shares its left edge
 * with the block's cell (6, 3): one cell more, its two right corners new —
 * **58 vertices, 86 triangles** — and its corner is rig (6 + 57, 6 + 24) =
 * **(63, 30)**. The heat segments (`HEAT_STRIP_SEGMENTS`) lie on the block's
 * columns 0 and 15, so no bone reaches a run.
 */
export const DUST_RIG: [number, number] = [72, 56];

export function dustParts(runs: ReadonlyArray<readonly [number, number, number]> = []): PartsFile {
  const p = rigParts();
  const extra = runs.reduce((sum, [, , n]) => sum + n, 0);
  return { ...p, rig_size: [...DUST_RIG], parts: p.parts.map((r) => (r.name === 'cloth' ? { ...r, w: 56, h: 40, opaque_px: 2000 + extra } : r)) };
}

/** `cloth` as the 50x40 block plus a run of `length` opaque px for each `[x, y, length]` (unpadded part px). */
export function dustImages(runs: ReadonlyArray<readonly [number, number, number]>): Map<string, Raster> {
  const r = block(56, 40, [50, 56]);
  for (const [x, y, n] of runs) for (let i = 0; i < n; i++) r.data.set([200, 120, 80, 255], (y * 56 + x + i) * 4);
  return new Map([
    ['cloth', r],
    ['eye', block(4, 2)],
  ]);
}

/**
 * The tilted-face fixture (issue #239): a 64x64 rig whose two eyes sit on a
 * line at a known angle, so the face bones' turn can be read off by hand.
 *
 * ## The parts
 *
 * `face` (head:face) is a 48x48 skin block at (8, 8). Each eye is a 12x10
 * part holding a dark bar along the direction (4, -3) in rig pixels (y down)
 * — the pixels whose centre lies within 1.5 px of the line through the box's
 * centre in that direction — so each eye is a stroke on the eye line.
 * `eyewhite_r` (head:eyewhite-r) at (14, 23), centre **(20, 28)**;
 * `eyewhite_l` (head:eyewhite-l) at (30, 11), centre **(36, 16)**. `mouth`
 * (head:mouth), an 8x4 block at (30, 36), centre (34, 38).
 *
 * ## The eye line, by hand
 *
 * Through the eye bones, which stand on the eyewhites' centres: from the
 * image-left `eye_r` (20, 28) to the image-right `eye_l` (36, 16): in
 * Spine's axes (y up) that is (16, 12), a 3-4-5 triangle, so the line's angle
 * is atan2(12, 16) = atan(3/4) = **36.869898 degrees** (6 places). `head`
 * stands unturned under `root`, so each of the five face bones is written
 * with local rotation 36.869898, and each region on one is turned back by
 * **-36.869898**. Every face bone stands on its part's centre or on a whole
 * pixel, and the region on a bone at its part's centre sits at offset (0, 0).
 *
 * ## The blink, by hand
 *
 * The blink (t = 1) squashes `eyes` to 0.12 along each eye bone's own y. On
 * the eye line that is across the stroke, so the closed stroke still runs at
 * 36.87 degrees; on the page's axes (before issue #239) the stroke's
 * direction (4, 3) (y up) becomes (4, 0.12 x 3) = (4, 0.36), atan(0.09) =
 * **5.14 degrees** — the closed eye lies nearly flat on a tilted face.
 */
export const FACE_RIG: [number, number] = [64, 64];
export const FACE_EXPECT = { degrees: 36.869898, flatClosed: 5.14 } as const;

function eyeBar(): Raster {
  const r = newRaster(12, 10);
  // The box centre is (6, 5); the line's unit direction (4, -3)/5 in raster axes, its normal (3, 4)/5.
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 12; x++) {
      const d = Math.abs(((x + 0.5 - 6) * 3 + (y + 0.5 - 5) * 4) / 5);
      if (d <= 1.5) r.data.set([30, 20, 20, 255], (y * 12 + x) * 4);
    }
  }
  return r;
}

function skin(w: number, h: number): Raster {
  const r = newRaster(w, h);
  for (let i = 0; i < w * h; i++) r.data.set([250, 220, 200, 255], i * 4);
  return r;
}

/** The fixture's parts; `eyes` names which eyewhite parts it holds (both by default). */
export function faceParts(eyes: ReadonlyArray<'r' | 'l'> = ['r', 'l']): PartsFile {
  const rec = (name: string, from: string, x: number, y: number, w: number, h: number, opaque = w * h): PartsFile['parts'][number] => ({
    name,
    from,
    x,
    y,
    w,
    h,
    opaque_px: opaque,
    projected_core_px: 0,
    source_px_taken: 0,
    refused_drift_px: 0,
    merged_px: 0,
    seam_override_px: 0,
  });
  const parts = [rec('face', 'head:face', 8, 8, 48, 48)];
  if (eyes.includes('r')) parts.push(rec('eyewhite_r', 'head:eyewhite-r', 14, 23, 12, 10, 46));
  if (eyes.includes('l')) parts.push(rec('eyewhite_l', 'head:eyewhite-l', 30, 11, 12, 10, 46));
  parts.push(rec('mouth', 'head:mouth', 30, 36, 8, 4));
  return { rig_size: [...FACE_RIG], scale_rig_per_source: 0.5, parts, ghost_px: {} };
}

export function faceImages(): Map<string, Raster> {
  return new Map([
    ['face', skin(48, 48)],
    ['eyewhite_r', eyeBar()],
    ['eyewhite_l', eyeBar()],
    ['mouth', block(8, 4)],
  ]);
}

/** The fixture's config; `eyes` as {@link faceParts}. A part a side lacks is left out of the plan and the regions, and its eye bone out of the blink. */
export function faceConfig(eyes: ReadonlyArray<'r' | 'l'> = ['r', 'l']): Record<string, unknown> {
  const plan: string[][] = [['face', 'head', 'face']];
  const regions: Record<string, string> = { face: 'head' };
  if (eyes.includes('r')) {
    plan.push(['eyewhite_r', 'head', 'eyewhite-r']);
    regions.eyewhite_r = 'eye_r';
  }
  if (eyes.includes('l')) {
    plan.push(['eyewhite_l', 'head', 'eyewhite-l']);
    regions.eyewhite_l = 'eye_l';
  }
  plan.push(['mouth', 'head', 'mouth']);
  regions.mouth = 'mouth';
  return {
    key: 'face_fixture',
    assemble: { rig_scale: 0.5, plan },
    bones: [
      { name: 'head', parent: 'root', at: [32, 50] },
      { name: 'eye_r', parent: 'head', at: [20, 28] },
      { name: 'eye_l', parent: 'head', at: [36, 16] },
      { name: 'brow_r', parent: 'head', at: [17, 22] },
      { name: 'brow_l', parent: 'head', at: [33, 10] },
      { name: 'mouth', parent: 'head', at: [34, 38] },
    ],
    meshes: {},
    regions,
    motion: { duration: 4, tracks: [], blink: { t: 1, eyes: ['eye_r', 'eye_l'], brows: ['brow_r', 'brow_l'], squash: 0.12, brow_drop: 1 } },
  };
}

/**
 * The shoe-on-a-shin fixture (issue #348): one `footwear` part on a foot bone
 * that hangs from a shin bone, on a 40x40 rig, so `root` stands at (20, 40).
 *
 * ## The bones, by hand
 *
 * `shin` under `root` at (20, 8) with its tip at (20, 28): in Spine's axes
 * (x from the canvas centre 20, y up from 40) it stands at (0, 32) and points
 * at (0, 12), so it is turned **-90 degrees**, **length 20**. `foot` under
 * `shin` at (20, 28), Spine (0, 12), no tip. Its offset in `shin`'s frame is
 * the world vector (0, -20) read in a frame turned -90: R(90)(0, -20) =
 * **(20, 0)**.
 *
 * - Inheriting normally, `foot` stands upright (world 0) only with a local
 *   rotation of 0 - (-90) = **90**.
 * - With `inherit: "noRotationOrReflection"` (or `"onlyTranslation"`) rig-c's
 *   poser gives the bone with a local rotation of 0 the world rotation 0, so
 *   it is written with **no rotation**.
 *
 * Either way `foot` is upright at the setup pose, and `shoe` — at (14, 28),
 * 12x6, centre (20, 31), Spine (0, 9) — is the region **(0, -3)** in its
 * frame, with no rotation. `leg` (`legwear`, which no line reads) — at
 * (16, 10), 8x18, centre (20, 19), Spine (0, 21) — rides `shin`: the world
 * vector (0, -11) in its frame is R(90)(0, -11) = **(11, 0)**, the image
 * turned back by **90**. Two regions, because rigc's A27 refuses a page
 * holding one.
 *
 * ## The motion
 *
 * The idle sways only `tail`, a bone under `root` at (34, 20) that carries
 * nothing (rigc refuses an idle with no key); the feet hold still, which
 * BREATH_VISIBLE's feet half requires. {@link shoeKick} turns `shin` by `degrees` at t = 0.5 s and back;
 * at 12 fps frame 6 is t = 0.5 s exactly. Inheriting normally, `foot` and the
 * shoe turn by `degrees` with the shin; under a mode that drops the parent's
 * rotation they turn by **0**.
 */
export const SHOE_RIG: [number, number] = [40, 40];

export function shoeParts(): PartsFile {
  return {
    rig_size: [...SHOE_RIG],
    scale_rig_per_source: 0.5,
    parts: [
      { name: 'leg', from: 'full:legwear', x: 16, y: 10, w: 8, h: 18, opaque_px: 144, projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 },
      { name: 'shoe', from: 'full:footwear', x: 14, y: 28, w: 12, h: 6, opaque_px: 72, projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 },
    ],
    ghost_px: {},
  };
}

export function shoeImages(): Map<string, Raster> {
  return new Map([
    ['leg', block(8, 18)],
    ['shoe', block(12, 6)],
  ]);
}

/** The shoe fixture's config; `inherit` goes on `foot` when given, and `animations_from` names `anims/extra.json` when `withAnimations`. */
export function shoeConfig(inherit?: string, withAnimations = true): Record<string, unknown> {
  return {
    key: 'shoe',
    assemble: {
      rig_scale: 0.5,
      plan: [
        ['leg', 'full', 'legwear'],
        ['shoe', 'full', 'footwear'],
      ],
    },
    bones: [
      { name: 'shin', parent: 'root', at: [20, 8], tip: [20, 28] },
      { name: 'foot', parent: 'shin', at: [20, 28], ...(inherit === undefined ? {} : { inherit }) },
      { name: 'tail', parent: 'root', at: [34, 20] },
    ],
    meshes: {},
    regions: { leg: 'shin', shoe: 'foot' },
    motion: { duration: 4, tracks: [{ bone: 'tail', prop: 'rotate', amp: 1, period: 4, phase: 0 }], ...(withAnimations ? { animations_from: 'anims/extra.json' } : {}) },
  };
}

/** A `rigc-motion/1` animations file: `kick` turns `shin` by `degrees` at t = 0.5 s and back, over 1 s. */
export function shoeKick(degrees: number): Record<string, unknown> {
  return {
    spec: 'rigc-motion/1',
    animations: { kick: { duration: 1, tracks: [{ bone: 'shin', property: 'rotate', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [degrees] }, { t: 1, v: [0] }] }] } },
  };
}
