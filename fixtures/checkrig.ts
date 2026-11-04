/**
 * A rig directory the `check` controls generate on every run: the smallest
 * thing `rig-parts check` accepts, authored by hand here and built with the
 * installed rig-c, so the whole check — build, the gate, the idle
 * render, the loop, the seam — runs in the selftest without a corpus.
 *
 * What it is: a 48x80 canvas, one bone (`root`), two region parts, one `idle`
 * track that moves the root 2 units right and back over one second. Each part
 * is an ellipse whose alpha ramps from 255 to 0 over the outer third of its
 * radius, with a vertical green gradient — soft edges, because a rendered rig is
 * resampled and a hard edge would make the seam figure a measure of the
 * resampler rather than of the stack. The back part spans the canvas's full
 * height so the setup-pose render sits near scale 1, the regime a real rig's
 * render is in (a full-height character).
 *
 * The part PNGs are written twice, as the rig stage writes them: once into
 * `images/` (what rig.json points rigc at) and once into `parts/` (what the
 * seam composites). A mutant that edits one copy and not the other is how the
 * seam gate is made to fire.
 *
 * ⭐ No claim about appearance comes from this fixture. The seam figure it
 * produces says only that the gate's mechanism lines the composite up with the
 * render (a 3 px shift is caught; the aligned stack is not) — the bar's
 * calibration was made on real rigs and is quoted in ORACLE_check.md, not here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cropToSpineY } from '../src/coords.ts';
import { OPAQUE_ALPHA_ABOVE } from '../src/layers.ts';
import { type PartsFile, type RecompositeRecord, serializeParts } from '../src/parts.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';

export const CHECK_RIG = { w: 48, h: 80 };

export interface CheckPart {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rgb: [number, number, number];
}

/** Back to front. */
export const CHECK_PARTS: readonly CheckPart[] = [
  { name: 'back', x: 4, y: 0, w: 30, h: 80, rgb: [200, 60, 40] },
  { name: 'front', x: 18, y: 20, w: 26, h: 40, rgb: [40, 90, 200] },
];

/** How much of the radius the alpha ramp occupies, as a divisor: 3 = the outer third. */
const RAMP = 3;

export function checkPartRaster(p: CheckPart, opaque = false): Raster {
  const r = newRaster(p.w, p.h);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const u = (2 * x + 1 - p.w) / p.w;
      const v = (2 * y + 1 - p.h) / p.h;
      const a = opaque ? 1 : Math.max(0, Math.min(1, (1 - Math.sqrt(u * u + v * v)) * RAMP));
      if (a > 0) r.data.set([p.rgb[0], Math.round(p.rgb[1] + (60 * y) / p.h), p.rgb[2], Math.round(255 * a)], (y * p.w + x) * 4);
    }
  }
  return r;
}

/** `src` moved `dx` pixels right inside its own box, the vacated columns transparent. */
export function shiftRight(src: Raster, dx: number): Raster {
  const out = newRaster(src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = dx; x < src.width; x++) out.data.set(src.data.subarray((y * src.width + x - dx) * 4, (y * src.width + x - dx) * 4 + 4), (y * src.width + x) * 4);
  }
  return out;
}

export interface CheckRigOptions {
  /** The idle's last `translatex` key; 0 closes the loop. */
  lastKey?: number;
  /** Write `images/front.png` fully opaque, which rig-c's A19 refuses under rig-play. */
  opaqueFront?: boolean;
  /** The two parts' `from`, back then front — the See-through tags the judgement lines choose regions by. Default both `full:topwear`. */
  from?: readonly [string, string];
  /** The idle's peak `translatex` on the root; 0 makes an idle that moves nothing. */
  peak?: number;
  /**
   * Hang the front part on a bone `eye` at its centre and give the idle a
   * blink: group `eyes` = [`eye`], `scaley` 1 -> `squash` -> 1. The front part
   * reaches past the back one on the right, so the shut eye shows the
   * background there — the hole `BLINK_NO_HOLE` exists to name.
   */
  blinkSquash?: number;
  /** A `recomposite` block for parts.json, as assemble would write one; absent by default, as in a reference-written parts.json. */
  recomposite?: RecompositeRecord;
  /**
   * Draw the back part as a four-vertex mesh (issue #31) rather than a region:
   * vertices top-left, top-right, bottom-right, bottom-left, triangles
   * `0 1 2` and `2 3 0`. The slot hangs from, and the top two vertices are
   * weighted to, a bone `yoke` at the root's origin (rigc's A15 counts a mesh
   * slot's own bone as one that drives it, and the idle keys `root`); the
   * bottom two are weighted to
   * a bone `hem` at the part's bottom centre, whose parent `hem_ctl` the idle
   * moves down by this many units at t = 0.5 s and back — the control-bone
   * indirection the rig stage uses, so the idle keys no bone a mesh is weighted
   * to. At the peak the two vertical edges are (h + stretch) / h times their
   * rest length and no edge is shorter than at rest, so `TEXTURE_STRETCH`
   * reads (80 + stretch) / 80 at idle frame 6 (t = 0.5 s at 12 fps), on
   * triangle 0 (vertices 0 1 2, edge 1-2) — the first of the two triangles
   * that tie.
   */
  stretchMesh?: number;
  /**
   * Hang both parts on a bone `head` (at {@link HEAD_AT}, under `root`
   * through `head_ctl`) and roll it: the idle keys `head_ctl` `rotate` 0,
   * `roll`, 0, `-roll`, 0 at quarter steps (degrees) — the control-bone shape
   * the rig stage writes, which rig-c's A15 asks for over a mesh. With `slide`, the back part is instead a four-vertex mesh
   * weighted wholly to a bone `slide` under `head` (through `slide_ctl`, which
   * the idle keys `translatex` 0, `slide`, 0) while its slot still rides
   * `head` — a face that slides `slide` rig pixels relative to the head the
   * slot says carries it. With `bang` (issue #123), the front part is a
   * four-vertex mesh weighted wholly to a bone `bang` under `head` (through
   * `bang_ctl`, which the idle keys `translatex` 0, `-bang`, 0) while its slot
   * rides `head` — a fringe that swings `bang` rig pixels left, over the back
   * part. Not with `blinkSquash`.
   */
  head?: { roll: number; slide?: number; bang?: number };
  /**
   * The canvas (the stage, and parts.json's rig_size), default
   * {@link CHECK_RIG}; the parts keep their rig-pixel boxes. rig-c's render
   * fits the figure and `check` asks for the canvas's longest side, so a canvas
   * larger than the figure renders the setup-pose still at a frame scale above
   * 1 — the regime of a consumer's figure that fills less of its stage (issue
   * #209).
   */
  canvas?: { w: number; h: number };
  /**
   * Issue #262: draw the back part as {@link CheckRigOptions.stretchMesh}'s four-vertex mesh, but with its top two
   * vertices weighted to a bone `chest` (through `chest_ctl`, which the idle keys `translatey` 0, `breath`, 0 — a
   * breath) and its bottom two to `hem` (through `hem_ctl`, keyed `translatex` 0, `sway`, 0 at the same times); the
   * slot rides `chest`. The root half of the box goes up with the breath further than the tip half does, and only
   * the tip half follows the sway: a skirt whose waistband the breath carries. Not with `stretchMesh`, `blinkSquash`
   * or `head`.
   */
  carried?: { breath: number; sway: number };
  /**
   * Issue #987: draw the back part as a sleeve hung on a two-link chain under a carried body, in the rig stage's
   * shape. The body is `chest` (through `chest_ctl`, which the idle keys `translatex` `carry` · sin(2πt), sampled at
   * eight steps — the sway that carries the sleeve whole). The chain is `s0_ctl` > `s0` > `s1_ctl` > `s1`, each link
   * turned to point down the sleeve with a length (`s0` to `s1_ctl`, `s1` 10); `swing` keys `s0_ctl` and `s1_ctl`
   * `rotate` `swing` · sin(2πt) and half that at the same eight steps (a chain `CHAIN_LAG` reads). `swing` 0 writes
   * no control bones and no rotate keys: `s0` under `chest`, `s1` under `s0`. `physics` puts a physics constraint on `s0` and on `s1` (`rotate` 1, `mix` 1, `strength` and `inertia`
   * as given) — the physics child the rig stage binds a sleeve to. The part is a four-vertex mesh, its top two
   * vertices on `s0` and its bottom two on `s1`; the slot rides `chest`. `pivot` `top` puts `s0_ctl` at the sleeve's
   * top; `mid` at its middle, so the whole sleeve turns about its centre. Not with `stretchMesh`, `carried`,
   * `blinkSquash` or `head`.
   */
  hung?: { carry: number; swing: number; pivot: 'top' | 'mid'; physics?: { strength: number; inertia: number } };
  /**
   * The idle's duration in seconds, default 1 (issue #244). The root's three
   * `translatex` keys sit at 0, half of it and it. Only with none of
   * `blinkSquash`, `stretchMesh` and `head`, whose keys are written over 1 s.
   */
  duration?: number;
}

/** Where the fixture's `head` bone stands, in rig pixels (y down): the bottom centre of the back part, a neck. */
export const HEAD_AT = { x: 19, y: 78 };

export const IDLE_PEAK = 2;

export function writeCheckRig(dir: string, opts: CheckRigOptions = {}): void {
  const { w: W, h: H } = opts.canvas ?? CHECK_RIG;
  mkdirSync(join(dir, 'images'), { recursive: true });
  mkdirSync(join(dir, 'parts'), { recursive: true });
  for (const p of CHECK_PARTS) {
    writeFileSync(join(dir, 'images', `${p.name}.png`), encodePngBytes(checkPartRaster(p, opts.opaqueFront === true && p.name === 'front')));
    writeFileSync(join(dir, 'parts', `${p.name}.png`), encodePngBytes(checkPartRaster(p)));
  }
  const stage = { x: -W / 2, y: 0, width: W, height: H };
  const blink = opts.blinkSquash !== undefined;
  const front = CHECK_PARTS[1];
  const eyeAt = { x: stage.x + front.x + front.w / 2, y: stage.y + cropToSpineY(front.y + front.h / 2, H) };
  const peak = opts.peak ?? IDLE_PEAK;
  const carried = opts.carried;
  if (carried !== undefined && (opts.stretchMesh !== undefined || opts.blinkSquash !== undefined || opts.head !== undefined)) throw new Error('writeCheckRig: carried is not with stretchMesh, blinkSquash or head');
  const hung = opts.hung;
  if (hung !== undefined && (opts.stretchMesh !== undefined || carried !== undefined || opts.blinkSquash !== undefined || opts.head !== undefined)) throw new Error('writeCheckRig: hung is not with stretchMesh, carried, blinkSquash or head');
  const mesh = opts.stretchMesh !== undefined || carried !== undefined;
  const T = opts.duration ?? 1;
  if (T !== 1 && (blink || mesh || hung !== undefined || opts.head !== undefined)) throw new Error('writeCheckRig: duration is only for the bare fixture; the blink, mesh and head keys are written over 1 s');
  const back = CHECK_PARTS[0];
  const hemAt = { x: stage.x + back.x + back.w / 2, y: stage.y + cropToSpineY(back.y + back.h, H) };
  const corners = [
    [back.x, back.y],
    [back.x + back.w, back.y],
    [back.x + back.w, back.y + back.h],
    [back.x, back.y + back.h],
  ].map(([u, v]) => ({ x: stage.x + u, y: stage.y + cropToSpineY(v, H) }));
  const backMesh = {
    type: 'mesh',
    image: `${back.name}.png`,
    width: back.w,
    height: back.h,
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    triangles: [0, 1, 2, 2, 3, 0],
    hull: 4,
    weights: corners.map((c, i) => (i < 2 ? [{ bone: carried === undefined ? 'yoke' : 'chest', x: c.x, y: c.y, weight: 1 }] : [{ bone: 'hem', x: c.x - hemAt.x, y: c.y - hemAt.y, weight: 1 }])),
  };
  // Issue #987: the hung sleeve — its chain's origins in world units, from the sleeve's top (or middle) to its bottom.
  const topAt = { x: stage.x + back.x + back.w / 2, y: stage.y + cropToSpineY(back.y, H) };
  const s0At = hung?.pivot === 'mid' ? { x: topAt.x, y: stage.y + cropToSpineY(back.y + back.h / 2, H) } : topAt;
  const s1At = hemAt;
  const s0Len = s0At.y - s1At.y;
  // The links point down (rotation -90), so a world offset (dx, dy) is (-dy, dx) in a link's frame.
  const linkLocal = (dx: number, dy: number): { x: number; y: number } => ({ x: -dy, y: dx });
  const hungMesh = {
    ...backMesh,
    weights: corners.map((c, i) => [{ bone: i < 2 ? 's0' : 's1', ...linkLocal(c.x - (i < 2 ? s0At : s1At).x, c.y - (i < 2 ? s0At : s1At).y), weight: 1 }]),
  };
  const hungBones =
    hung === undefined
      ? []
      : [
          { name: 'chest_ctl', parent: 'root', x: 0, y: 0 },
          { name: 'chest', parent: 'chest_ctl', x: 0, y: 0 },
          ...(hung.swing === 0
            ? [
                { name: 's0', parent: 'chest', x: s0At.x, y: s0At.y, rotation: -90, length: s0Len },
                { name: 's1', parent: 's0', x: s0Len, y: 0, length: 10 },
              ]
            : [
                { name: 's0_ctl', parent: 'chest', x: s0At.x, y: s0At.y, rotation: -90 },
                { name: 's0', parent: 's0_ctl', x: 0, y: 0, length: s0Len },
                { name: 's1_ctl', parent: 's0', x: s0Len, y: 0 },
                { name: 's1', parent: 's1_ctl', x: 0, y: 0, length: 10 },
              ]),
        ];
  const sine = (amp: number): Array<{ t: number; v: number[] }> => Array.from({ length: 9 }, (_, k) => ({ t: k / 8, v: [k === 8 ? 0 : Math.round(amp * Math.sin((2 * Math.PI * k) / 8) * 1e4) / 1e4] }));
  const hungTracks =
    hung === undefined
      ? []
      : [
          { bone: 'chest_ctl', property: 'translatex', keys: sine(hung.carry) },
          ...(hung.swing === 0
            ? []
            : [
                { bone: 's0_ctl', property: 'rotate', keys: sine(hung.swing) },
                { bone: 's1_ctl', property: 'rotate', keys: sine(hung.swing / 2) },
              ]),
        ];
  const hungPhysics = hung?.physics;
  const hungConstraints =
    hungPhysics === undefined ? [] : ['s0', 's1'].map((b) => ({ type: 'physics', name: `${b}_phys`, bone: b, rotate: 1, inertia: hungPhysics.inertia, strength: hungPhysics.strength, damping: 0.85, mass: 1, mix: 1 }));
  const hemTracks =
    carried !== undefined
      ? [
          { bone: 'chest_ctl', property: 'translatey', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [carried.breath] }, { t: 1, v: [0] }] },
          { bone: 'hem_ctl', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [carried.sway] }, { t: 1, v: [0] }] },
        ]
      : mesh
        ? [{ bone: 'hem_ctl', property: 'translatey', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [-(opts.stretchMesh as number)] }, { t: 1, v: [0] }] }]
        : [];
  const head = opts.head;
  const headAt = { x: stage.x + HEAD_AT.x, y: stage.y + cropToSpineY(HEAD_AT.y, H) };
  const slide = head?.slide !== undefined;
  const bang = head?.bang !== undefined;
  const headBones =
    head === undefined
      ? []
      : [
          { name: 'head_ctl', parent: 'root', x: headAt.x, y: headAt.y },
          { name: 'head', parent: 'head_ctl', x: 0, y: 0 },
          ...(slide ? [{ name: 'slide_ctl', parent: 'head', x: 0, y: 0 }, { name: 'slide', parent: 'slide_ctl', x: 0, y: 0 }] : []),
          ...(bang ? [{ name: 'bang_ctl', parent: 'head', x: 0, y: 0 }, { name: 'bang', parent: 'bang_ctl', x: 0, y: 0 }] : []),
        ];
  const headTracks =
    head === undefined
      ? []
      : [
          { bone: 'head_ctl', property: 'rotate', keys: [0, head.roll, 0, -head.roll, 0].map((v, i) => ({ t: i / 4, v: [v] })) },
          ...(slide ? [{ bone: 'slide_ctl', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [head.slide] }, { t: 1, v: [0] }] }] : []),
          ...(bang ? [{ bone: 'bang_ctl', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [-(head.bang as number)] }, { t: 1, v: [0] }] }] : []),
        ];
  const attachment = (p: CheckPart, i: number): Record<string, unknown> => {
    const at = { x: stage.x + p.x + p.w / 2, y: stage.y + cropToSpineY(p.y + p.h / 2, H) };
    if (hung !== undefined && i === 0) return hungMesh;
    if (mesh && i === 0) return backMesh;
    if (head !== undefined) {
      if ((i === 0 && slide) || (i === 1 && bang)) {
        const corners = [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]];
        return {
          type: 'mesh',
          image: `${p.name}.png`,
          width: p.w,
          height: p.h,
          uvs: [0, 0, 1, 0, 1, 1, 0, 1],
          triangles: [0, 1, 2, 0, 2, 3],
          hull: 4,
          weights: corners.map(([x, y]) => [{ bone: i === 0 ? 'slide' : 'bang', x: stage.x + x - headAt.x, y: stage.y + cropToSpineY(y, H) - headAt.y, weight: 1 }]),
        };
      }
      return { image: `${p.name}.png`, x: at.x - headAt.x, y: at.y - headAt.y };
    }
    return { image: `${p.name}.png`, ...(blink && i === 1 ? { x: at.x - eyeAt.x, y: at.y - eyeAt.y } : at) };
  };
  const blinkTracks =
    opts.blinkSquash === undefined
      ? []
      : [{ group: 'eyes', property: 'scaley', keys: [{ t: 0, v: [1] }, { t: 0.4, v: [1] }, { t: 0.5, v: [opts.blinkSquash] }, { t: 0.6, v: [opts.blinkSquash] }, { t: 0.7, v: [1] }, { t: 1, v: [1] }] }];
  const rig = {
    spec: 'rigc-rig/1',
    name: 'check_probe',
    images: 'images',
    skeleton: stage,
    bones: [
      { name: 'root', x: 0, y: 0 },
      ...(blink ? [{ name: 'eye', parent: 'root', x: eyeAt.x, y: eyeAt.y }] : []),
      ...(mesh ? [{ name: 'yoke', parent: 'root', x: 0, y: 0 }, { name: 'hem_ctl', parent: 'root', x: hemAt.x, y: hemAt.y }, { name: 'hem', parent: 'hem_ctl', x: 0, y: 0 }] : []),
      ...(carried !== undefined ? [{ name: 'chest_ctl', parent: 'root', x: 0, y: 0 }, { name: 'chest', parent: 'chest_ctl', x: 0, y: 0 }] : []),
      ...headBones,
      ...hungBones,
    ],
    slots: CHECK_PARTS.map((p, i) => ({ name: p.name, bone: head !== undefined ? 'head' : blink && i === 1 ? 'eye' : hung !== undefined && i === 0 ? 'chest' : mesh && i === 0 ? (carried === undefined ? 'yoke' : 'chest') : 'root', attachment: p.name })),
    skins: { default: Object.fromEntries(CHECK_PARTS.map((p, i) => [p.name, { [p.name]: attachment(p, i) }])) },
    ...(hungConstraints.length === 0 ? {} : { constraints: hungConstraints }),
  };
  writeFileSync(join(dir, 'rig.json'), `${JSON.stringify(rig, null, 2)}\n`);
  const motion = {
    spec: 'rigc-motion/1',
    archetype: 'check_probe',
    cut: 'check_probe',
    easings: {},
    groups: blink ? { eyes: ['eye'] } : {},
    animations: {
      idle: {
        duration: T,
        loop: true,
        tracks: [{ bone: 'root', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: T / 2, v: [peak] }, { t: T, v: [opts.lastKey ?? 0] }] }, ...blinkTracks, ...hemTracks, ...headTracks, ...hungTracks],
      },
    },
  };
  writeFileSync(join(dir, 'motion.json'), `${JSON.stringify(motion, null, 2)}\n`);
  const parts: PartsFile = {
    rig_size: [W, H],
    scale_rig_per_source: 1,
    parts: CHECK_PARTS.map((p, i) => ({
      name: p.name,
      from: opts.from?.[i] ?? 'full:topwear',
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      opaque_px: Array.from(checkPartRaster(p).data.filter((_, i) => i % 4 === 3)).filter((a) => a > OPAQUE_ALPHA_ABOVE).length,
      projected_core_px: 0,
      source_px_taken: 0,
      refused_drift_px: 0,
      merged_px: 0,
      seam_override_px: 0,
    })),
    ghost_px: {},
    ...(opts.recomposite === undefined ? {} : { recomposite: opts.recomposite }),
  };
  writeFileSync(join(dir, 'parts.json'), serializeParts(parts));
}

// ---------------------------------------------------------------------------
// issue #77: a merged rig — two copies under one root, a plate at slot 0, no parts.json
// ---------------------------------------------------------------------------

/**
 * The shape issue #77 measures: two rig-parts characters merged into one
 * rig spec outside the package — bone and slot names prefixed, both
 * hierarchies under one root, a region slot at index 0 for a background plate
 * — and no `parts.json`, because no assemble made the merged canvas.
 *
 * Each copy is {@link CHECK_PARTS}'s two boxes and colours as FLAT blocks: the
 * colour opaque everywhere but a transparent margin {@link MERGED_INSET} wide
 * (so neither is an opaque overlay, which rigc's A19 refuses), the second copy
 * {@link MERGED_COPY_DX} rig pixels right of the first. The plate is one opaque
 * colour over the whole stage — rigc's A19 lets an attachment the stage's size
 * be opaque. Flat colours make the painting, and every figure the controls
 * expect of it, a matter of rectangles: {@link mergedStack} is the flat stack
 * by hand, and {@link mergedCores} its rectangles.
 */
export const MERGED_STAGE = { w: 2 * CHECK_RIG.w, h: CHECK_RIG.h };
export const MERGED_COPY_DX = CHECK_RIG.w;
export const MERGED_INSET = 2;
export const MERGED_PREFIXES = ['a_', 'b_'] as const;
export const MERGED_PLATE_RGB: readonly [number, number, number] = [240, 240, 240];

export interface MergedRigOptions {
  /** Write an `idle` (the fixture's root sway, closed); false writes `animations: {}`. */
  idle: boolean;
  /** Put the opaque plate at slot 0. */
  plate: boolean;
  /** Move one slot's attachment this many rig pixels right (negative: left) in rig.json only — the painting is not moved. */
  move?: { slot: string; dx: number };
}

/** One flat rectangle of the stack, in stage pixels (y down): where the colour is opaque. */
export interface FlatCore {
  slot: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rgb: readonly [number, number, number];
}

/** A part as a flat block: its colour at alpha 255 inside, alpha 0 in the margin. */
export function flatPartRaster(p: CheckPart): Raster {
  const r = newRaster(p.w, p.h);
  for (let y = MERGED_INSET; y < p.h - MERGED_INSET; y++) for (let x = MERGED_INSET; x < p.w - MERGED_INSET; x++) r.data.set([...p.rgb, 255], (y * p.w + x) * 4);
  return r;
}

/** The opaque rectangles in draw order (the plate first when there is one), the moved slot moved. */
export function mergedCores(opts: Pick<MergedRigOptions, 'plate' | 'move'>): FlatCore[] {
  const cores: FlatCore[] = opts.plate ? [{ slot: 'plate', x: 0, y: 0, w: MERGED_STAGE.w, h: MERGED_STAGE.h, rgb: MERGED_PLATE_RGB }] : [];
  MERGED_PREFIXES.forEach((prefix, k) => {
    for (const p of CHECK_PARTS) {
      const slot = `${prefix}${p.name}`;
      const dx = opts.move?.slot === slot ? opts.move.dx : 0;
      cores.push({ slot, x: k * MERGED_COPY_DX + p.x + MERGED_INSET + dx, y: p.y + MERGED_INSET, w: p.w - 2 * MERGED_INSET, h: p.h - 2 * MERGED_INSET, rgb: p.rgb });
    }
  });
  return cores;
}

/** The flat stack over white at the stage's size, by rectangles: each core paints its colour, later over earlier. */
export function mergedStack(opts: Pick<MergedRigOptions, 'plate' | 'move'>): Raster {
  const r = newRaster(MERGED_STAGE.w, MERGED_STAGE.h);
  r.data.fill(255);
  for (const c of mergedCores(opts)) {
    for (let y = Math.max(0, c.y); y < Math.min(MERGED_STAGE.h, c.y + c.h); y++) for (let x = Math.max(0, c.x); x < Math.min(MERGED_STAGE.w, c.x + c.w); x++) r.data.set([...c.rgb, 255], (y * MERGED_STAGE.w + x) * 4);
  }
  return r;
}

/** Write the merged rig directory: rig.json, motion.json and images/ — and no parts.json. */
export function writeMergedCheckRig(dir: string, opts: MergedRigOptions): void {
  const { w: W, h: H } = MERGED_STAGE;
  mkdirSync(join(dir, 'images'), { recursive: true });
  for (const p of CHECK_PARTS) writeFileSync(join(dir, 'images', `${p.name}.png`), encodePngBytes(flatPartRaster(p)));
  const stage = { x: -W / 2, y: 0, width: W, height: H };
  const bones: Array<Record<string, unknown>> = [{ name: 'root', x: 0, y: 0 }];
  const slots: Array<Record<string, unknown>> = [];
  const skin: Record<string, Record<string, unknown>> = {};
  if (opts.plate) {
    const plate = newRaster(W, H);
    for (let i = 0; i < W * H; i++) plate.data.set([...MERGED_PLATE_RGB, 255], i * 4);
    writeFileSync(join(dir, 'images', 'plate.png'), encodePngBytes(plate));
    slots.push({ name: 'plate', bone: 'root', attachment: 'plate' });
    skin.plate = { plate: { image: 'plate.png', x: stage.x + W / 2, y: stage.y + cropToSpineY(H / 2, H) } };
  }
  MERGED_PREFIXES.forEach((prefix, k) => {
    const bone = `${prefix}root`;
    const bx = k * MERGED_COPY_DX;
    bones.push({ name: bone, parent: 'root', x: bx, y: 0 });
    for (const p of CHECK_PARTS) {
      const slot = `${prefix}${p.name}`;
      const dx = opts.move?.slot === slot ? opts.move.dx : 0;
      slots.push({ name: slot, bone, attachment: slot });
      skin[slot] = { [slot]: { image: `${p.name}.png`, x: stage.x + p.x + p.w / 2 + dx, y: stage.y + cropToSpineY(p.y + p.h / 2, H) } };
    }
  });
  const rig = { spec: 'rigc-rig/1', name: 'merged_probe', images: 'images', skeleton: stage, bones, slots, skins: { default: skin } };
  writeFileSync(join(dir, 'rig.json'), `${JSON.stringify(rig, null, 2)}\n`);
  const idle = { duration: 1, loop: true, tracks: [{ bone: 'root', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [IDLE_PEAK] }, { t: 1, v: [0] }] }] };
  const motion = { spec: 'rigc-motion/1', archetype: 'merged_probe', cut: 'merged_probe', easings: {}, groups: {}, animations: opts.idle ? { idle } : {} };
  writeFileSync(join(dir, 'motion.json'), `${JSON.stringify(motion, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// issue #231: a seated figure — legs that swing, a raised forearm on its own chain, a cut piece left still
// ---------------------------------------------------------------------------

/**
 * The seated figure of issue #231 on {@link CHECK_RIG}'s canvas, back to
 * front. `under` is the piece cut off the skirt and sent behind: a region on
 * `root`, on no chain. `body` the torso, `face` the face on a bone `head`.
 * `shoes` the feet, a region on the last link of a leg chain hanging from the
 * knee, whose control declares `inherit: "noRotationOrReflection"` (issue
 * #348), so the shoes turn by the ankle's own swing alone. `arm` the raised forearm, a region on the first link of an arm chain
 * whose links rise from the elbow at the bottom of its box (crop y 36) to
 * crop y 21: its tip is up.
 */
export const SEATED_CHECK_PARTS: ReadonlyArray<CheckPart & { from: string }> = [
  { name: 'under', from: 'full:bottomwear', x: 10, y: 40, w: 24, h: 14, rgb: [120, 60, 160] },
  { name: 'body', from: 'full:topwear', x: 8, y: 14, w: 30, h: 36, rgb: [200, 60, 40] },
  { name: 'face', from: 'head:face', x: 14, y: 0, w: 20, h: 18, rgb: [230, 180, 150] },
  { name: 'shoes', from: 'full:footwear', x: 12, y: 60, w: 24, h: 18, rgb: [60, 60, 60] },
  { name: 'arm', from: 'full:handwear-r', x: 32, y: 6, w: 12, h: 30, rgb: [40, 90, 200] },
];

/** The two chains' amplitude in degrees (each link the same, so `CHAIN_LAG`'s non-decreasing amplitude holds) and the lag of the second link, cycles. */
export const SEATED_SWING = { arm: 20, leg: 8, lag: 0.1 };

/** Eight samples of `amp sin(2 pi (t - phase))` over one second and the first again at t = 1, so the loop closes exactly and `CHAIN_LAG` reads the sine. */
function sineKeys(amp: number, phase: number): Array<{ t: number; v: number[] }> {
  const keys = Array.from({ length: 8 }, (_, k) => ({ t: k / 8, v: [amp * Math.sin(2 * Math.PI * (k / 8 - phase))] }));
  return [...keys, { t: 1, v: keys[0].v }];
}

/**
 * Write the seated figure's rig directory: rig.json, motion.json, images/, parts/ and parts.json. The idle slides the
 * root {@link IDLE_PEAK} right and back, as {@link writeCheckRig}'s does, and swings both chains. `armHangs` puts the
 * arm chain's second link below the elbow (issue #231's planted negative of `rises`).
 *
 * `armFolds` (issue #322) folds the arm under the same art: the chain's first link hangs from a shoulder at crop
 * (38, 21) to the elbow at the bottom of the box, crop (38, 36), 15 px down; the second, from the elbow, is turned as
 * the rig stage turns a link (rotation and `length`, issue #73) — `up` 90 degrees with length 30, to crop (38, 6),
 * longer than half the art; `down` -90 degrees, the same length the other way (the planted negative: a declared tip
 * that does not rise). The art rides the second link, its region turned back upright.
 */
export function writeSeatedCheckRig(dir: string, opts: { armHangs?: boolean; armFolds?: 'up' | 'down' } = {}): void {
  const { w: W, h: H } = CHECK_RIG;
  mkdirSync(join(dir, 'images'), { recursive: true });
  mkdirSync(join(dir, 'parts'), { recursive: true });
  for (const p of SEATED_CHECK_PARTS) {
    writeFileSync(join(dir, 'images', `${p.name}.png`), encodePngBytes(checkPartRaster(p)));
    writeFileSync(join(dir, 'parts', `${p.name}.png`), encodePngBytes(checkPartRaster(p)));
  }
  const stage = { x: -W / 2, y: 0, width: W, height: H };
  const world = (u: number, v: number): { x: number; y: number } => ({ x: stage.x + u, y: stage.y + cropToSpineY(v, H) });
  const elbow = world(38, 36);
  // With armHangs the arm chain's second link sits below the elbow instead: a chain that hangs, under the same art.
  const wrist = world(38, opts.armHangs === true ? 51 : 21);
  const knee = world(24, 54);
  const ankle = world(24, 66);
  const head = world(24, 18);
  const shoulder = world(38, 21);
  const fold = opts.armFolds;
  // Folded: the second link turned up (or down) by 90 degrees, so a world offset (dx, dy) is (dy, -dx) in its frame
  // (or (-dy, dx)), written by hand rather than through a cosine that is not exactly 0.
  const turn = fold === undefined ? 0 : fold === 'up' ? 90 : -90;
  const intoLink = (dx: number, dy: number): { x: number; y: number } => (turn === 90 ? { x: dy, y: -dx } : turn === -90 ? { x: -dy, y: dx } : { x: dx, y: dy });
  const armLinks =
    fold === undefined
      ? [
          { name: 'arm0_ctl', parent: 'root', x: elbow.x, y: elbow.y },
          { name: 'arm0', parent: 'arm0_ctl', x: 0, y: 0 },
          { name: 'arm1_ctl', parent: 'arm0', x: wrist.x - elbow.x, y: wrist.y - elbow.y },
          { name: 'arm1', parent: 'arm1_ctl', x: 0, y: 0 },
        ]
      : [
          { name: 'arm0_ctl', parent: 'root', x: shoulder.x, y: shoulder.y },
          { name: 'arm0', parent: 'arm0_ctl', x: 0, y: 0 },
          { name: 'arm1_ctl', parent: 'arm0', length: 30, rotation: turn, x: elbow.x - shoulder.x, y: elbow.y - shoulder.y },
          { name: 'arm1', parent: 'arm1_ctl', x: 0, y: 0 },
        ];
  const bones = [
    { name: 'root', x: 0, y: 0 },
    { name: 'head', parent: 'root', x: head.x, y: head.y },
    ...armLinks,
    { name: 'leg0_ctl', parent: 'root', x: knee.x, y: knee.y },
    { name: 'leg0', parent: 'leg0_ctl', x: 0, y: 0 },
    // Issue #348: the ankle link drops the knee's rotation, so the swing turns the shoes by the ankle's own 8 degrees,
    // within FEET_STAY_LEVEL's ±10; inheriting the knee's too, they turned by up to twice that and failed a bar this
    // figure was not written to read.
    { name: 'leg1_ctl', parent: 'leg0', x: ankle.x - knee.x, y: ankle.y - knee.y, inherit: 'noRotationOrReflection' },
    { name: 'leg1', parent: 'leg1_ctl', x: 0, y: 0 },
  ];
  const at: Record<string, { x: number; y: number }> = { root: { x: 0, y: 0 }, head, arm0: elbow, arm1: elbow, leg1: ankle };
  const slotBone: Record<string, string> = { under: 'root', body: 'root', face: 'head', shoes: 'leg1', arm: fold === undefined ? 'arm0' : 'arm1' };
  const rig = {
    spec: 'rigc-rig/1',
    name: 'seated_probe',
    images: 'images',
    skeleton: stage,
    bones,
    slots: SEATED_CHECK_PARTS.map((p) => ({ name: p.name, bone: slotBone[p.name], attachment: p.name })),
    skins: {
      default: Object.fromEntries(
        SEATED_CHECK_PARTS.map((p) => {
          const c = world(p.x + p.w / 2, p.y + p.h / 2);
          const b = at[slotBone[p.name]];
          if (slotBone[p.name] === 'arm1') {
            const o = intoLink(c.x - b.x, c.y - b.y);
            return [p.name, { [p.name]: { image: `${p.name}.png`, x: o.x, y: o.y, rotation: -turn } }];
          }
          return [p.name, { [p.name]: { image: `${p.name}.png`, x: c.x - b.x, y: c.y - b.y } }];
        }),
      ),
    },
  };
  writeFileSync(join(dir, 'rig.json'), `${JSON.stringify(rig, null, 2)}\n`);
  const { arm, leg, lag } = SEATED_SWING;
  const motion = {
    spec: 'rigc-motion/1',
    archetype: 'seated_probe',
    cut: 'seated_probe',
    easings: {},
    groups: {},
    animations: {
      idle: {
        duration: 1,
        loop: true,
        tracks: [
          { bone: 'root', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [IDLE_PEAK] }, { t: 1, v: [0] }] },
          { bone: 'arm0_ctl', property: 'rotate', keys: sineKeys(arm, 0) },
          { bone: 'arm1_ctl', property: 'rotate', keys: sineKeys(arm, lag) },
          { bone: 'leg0_ctl', property: 'rotate', keys: sineKeys(leg, 0) },
          { bone: 'leg1_ctl', property: 'rotate', keys: sineKeys(leg, lag) },
        ],
      },
    },
  };
  writeFileSync(join(dir, 'motion.json'), `${JSON.stringify(motion, null, 2)}\n`);
  const parts: PartsFile = {
    rig_size: [W, H],
    scale_rig_per_source: 1,
    parts: SEATED_CHECK_PARTS.map((p) => ({
      name: p.name,
      from: p.from,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      opaque_px: Array.from(checkPartRaster(p).data.filter((_, i) => i % 4 === 3)).filter((a) => a > OPAQUE_ALPHA_ABOVE).length,
      projected_core_px: 0,
      source_px_taken: 0,
      refused_drift_px: 0,
      merged_px: 0,
      seam_override_px: 0,
    })),
    ghost_px: {},
  };
  writeFileSync(join(dir, 'parts.json'), serializeParts(parts));
}
