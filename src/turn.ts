/**
 * The turn control (issue #251): one bone nothing keys, and each part carried
 * sideways a fraction of that bone's offset, the fraction ordered by the part's
 * See-through depth — nearest furthest, the pivot depth staying put.
 *
 * 🧭 **The law is a turn's, not a chosen curve.** A figure turned by a small
 * angle θ about a vertical axis standing at depth `pivot`, seen without
 * perspective, moves each point sideways by `sin θ · (pivot − depth)` in depth
 * units: linear in depth, zero at the pivot, opposite signs on either side of
 * it. The depth unit's size in pixels is nothing See-through states, so the
 * dial is normalised by the nearest part instead:
 *
 *     fraction(part) = (pivot − depth(part)) / (pivot − depth(nearest))
 *
 * The nearest part (the smallest `depth_median`, larger being further back)
 * travels exactly the control's offset, the pivot depth 0, a part behind the
 * pivot the other way. The dial's unit is therefore the nearest part's travel
 * in rig px, and how far a consumer turns it is the consumer's.
 *
 * ⚖️ **The pivot `propose` drafts** ({@link turnPivot}) is the mean of the
 * carried parts' depths weighted by their `opaque_px`: the one depth at which
 * `Σ opaque_px · fraction = 0`, so the painted pixels' centroid does not slide
 * under the dial — the figure turns about its own middle rather than drifting
 * with it. It is a config field (`turn.pivot`), so a person corrects it there;
 * the rig stage recomputes every fraction from it.
 *
 * Depths are See-through's per-layer `depth_median` only. Issue #250 measured
 * that the depth maps do not carry relief inside a layer, so a part moves as
 * one piece. Pure: no file, no clock.
 */
import { computeWorldTransforms, setupToPaintingPoint, toBoneLocalVector, toWorld, type BoneTransform } from './coords.ts';
import { extendDepthSilhouette, sampleDepthFloat, type PartDepthReference } from './depthsheets.ts';
import { type Problem, refuseIfAny } from './errors.ts';
import type { Raster } from './raster/index.ts';
import { pyRound } from './round.ts';
import { turnOverlapOwners } from './turnoverlap.ts';
import { sampleTurnTriangleField, turnTriangleCoordinates } from './turnfield.ts';
import { PartsError } from './errors.ts';
import { f32 } from 'rig-c/compile';
import { evaluateDeformTransform } from 'rig-c/src/deformgen.ts';

/**
 * The layers that ride on the face (issue #271): See-through makes no depth
 * of their own for them, so `propose` does not read theirs. The eye group —
 * eyewhite, irides, eyelash, eyebrow — is cut from one depth map predicted for
 * the combined eyes layer (`compose_list` in See-through's
 * `common/utils/inference_utils.py`, commit df019de), which is why
 * `eyewhite-r` and `eyewhite-l` read the same median in every run measured
 * for #251; nose and mouth are clamped by See-through to the face's median
 * minus {@link TURN_RIDER_OFFSET} when they read behind it (the same file,
 * lines 528-531). Their own medians disagreed across the two runs by up to
 * 0.474 (demo `eyebrow-r`, #251's table), and the disagreement swapped their
 * order against the face. Matched on the layer's base tag, either side.
 */
export const TURN_RIDER_TAGS: readonly string[] = ['eyewhite', 'irides', 'eyelash', 'eyebrow', 'nose', 'mouth'];

/** The tag of the part the riders take their depth from. */
export const TURN_CARRIER_TAG = 'face';

/** See-through's own offset between a clamped face feature and the face (`face − 0.001`, the file named at {@link TURN_RIDER_TAGS}). */
export const TURN_RIDER_OFFSET = 0.001;

/**
 * A rider's depth: its carrier's, {@link TURN_RIDER_OFFSET} nearer when the
 * rider is drawn after the carrier (above it) and as much further when it is
 * drawn before (under it), so the draw order the depths imply is the one
 * parts.json holds.
 */
export function turnRiderDepth(carrier: number, above: boolean): number {
  return above ? carrier - TURN_RIDER_OFFSET : carrier + TURN_RIDER_OFFSET;
}

/**
 * The share of the span (`pivot − nearest`) past which a rider by bone's
 * fraction (issue #535: a part whose every ownable bone another carried part
 * hosts, `turnRidersByBone` in `src/config.ts`) is refused for differing from
 * its host's (`CONFIG_TURN_RIDER_DEPTH`, the rig stage). #535's judgment line,
 * set before it was measured: the same bar as `propose`'s `TURN_RUN_APART`.
 */
export const TURN_RIDER_APART = 0.1;

/** The control bone the rig stage adds under `root` when the config has `turn`: nothing keys it, and its local x is the dial. */
export const TURN_BONE = 'turn';

/** The places a pivot and a fraction are written to. */
export const TURN_PLACES = 6;

/**
 * The Set B ×2.5 face surface deformation table (issue #436): per-degree
 * fractions of the face plate's opaque width `W` and height `H` (and the
 * dimensionless coupling shares of the hair, ear and topknot parts that sample
 * the same head field), with the sheet's measurements on a `106×128` plate at
 * `+15°` beside each entry.
 */
export const FACE_DEFORM_FRACTIONS = {
  /** Mid-face vertical shift per degree of pitch (`H/deg`; `-9.02 px` at `+15°` on `H = 128`). */
  tilt_mid_y: -0.0047,
  /** Lower-face chin vertical squash per degree of pitch (`H/deg`; `+5.04 px` squash, chin tip `-3.98 px` at `+15°` on `H = 128`). */
  tilt_chin_squash_y: 0.002625,
  /** Forehead/crown extra drop per degree of pitch (`H/deg`; crown `-11.28 px` at `+15°` on `H = 128`). */
  tilt_crown_drop_y: -0.001175,
  /** Forehead/jaw perspective horizontal taper per degree of pitch (`W/deg`; `±4.77 px` at `+15°` on `W = 106`). */
  tilt_taper_x: 0.003,
  /** Mid-face and chin horizontal shift per degree of yaw (`W/deg`; `-9.54 px` at `+15°` on `W = 106`). */
  turn_mid_x: -0.006,
  /** Far (leading) cheek inward compression per degree of yaw (`W/deg`; far cheek `+3.75 px` inward at `+15°` on `W = 106`). */
  turn_lead_compress_x: 0.00835,
  /** Near (trailing) cheek shift beyond mid-face per degree of yaw (`W/deg`; near cheek `-10.50 px` at `+15°` on `W = 106`, total narrowing `-14.25 px` = `-13.4% W`). */
  turn_trail_shift_x: -0.0006,
  /** Cheek-arch vertical lift/drop per degree of yaw (`H/deg`; `±1.20 px` at `+15°` on `H = 128`). */
  turn_cheek_arch_y: 0.000625,
  /** Forehead bang base vertical travel per degree of pitch (`H/deg`; `-3.00 px` at `+15°` on `H = 128`). */
  tilt_bang_base_y: -0.0015625,
  /** Share of the pitch vertical surface field carried by `hair_front` (`0.95×` of `dySurf`). */
  tilt_hair_front_y: 0.95,
  /** Share of the pitch vertical surface field carried by lower `hair_back` (`0.85×` of `dySurf`). */
  tilt_hair_back_lower_y: 0.85,
  /** Share of the pitch vertical surface field carried by upper `hair_back` (`0.45×` of `dySurf`). */
  tilt_hair_back_bun_y: 0.45,
  /** Share of the pitch horizontal taper carried at the top of `hair_back` (`0.60×` of `dxSurf`). */
  tilt_hair_back_bun_x: 0.6,
  /** Share of the pitch vertical surface field carried by `ears` (`0.55×` of `dySurf`, `-4.31 px` at `+15°`). */
  tilt_ear_y: 0.55,
  /** Share of the crown pitch vertical field carried by `topknot` (`0.50×` of crown `dySurf`, `-5.64 px` at `+15°`). */
  tilt_topknot_y: 0.5,
  /** Forehead bang forward parallax per degree of yaw (`W/deg`; `-3.50 px` at `+15°` on `W = 106`). */
  turn_bang_parallax_x: -(3.5 / 15) / 106,
  /** Rear bun counter-parallax per degree of yaw (`W/deg`; `+8.00 px` at `+15°` on `W = 106`). */
  turn_bun_counter_x: 8.0 / 15 / 106,
  /** Rear hairpin counter-parallax per degree of yaw (`W/deg`; `+6.00 px` at `+15°` on `W = 106`). */
  turn_hairpin_counter_x: 6.0 / 15 / 106,
  /** Share of the cheek-edge yaw horizontal field carried by `ear_r` and `ear_l` (`0.85×` of `dxCheekEdge`, `-8.92 px` / `+3.14 px` at `+15°`). */
  turn_ear_x: 0.85,
} as const;

export type FaceDeformKey = keyof typeof FACE_DEFORM_FRACTIONS;
export type FaceDeformFractions = Record<FaceDeformKey, number>;

/**
 * Allowed `[min, max]` range for each key of {@link FACE_DEFORM_FRACTIONS}; an
 * override in `config.turn.deform` outside its stated interval is refused by
 * name (`CONFIG_TURN_DEFORM_RANGE`).
 */
export const FACE_DEFORM_RANGES: Readonly<Record<FaceDeformKey, readonly [number, number]>> = {
  tilt_mid_y: [-0.02, 0],
  tilt_chin_squash_y: [0, 0.015],
  tilt_crown_drop_y: [-0.01, 0],
  tilt_taper_x: [0, 0.015],
  turn_mid_x: [-0.02, 0],
  turn_lead_compress_x: [0, 0.025],
  turn_trail_shift_x: [-0.01, 0.01],
  turn_cheek_arch_y: [0, 0.01],
  tilt_bang_base_y: [-0.01, 0],
  tilt_hair_front_y: [0, 1.5],
  tilt_hair_back_lower_y: [0, 1.5],
  tilt_hair_back_bun_y: [0, 1.5],
  tilt_hair_back_bun_x: [0, 1.5],
  tilt_ear_y: [0, 1.5],
  tilt_topknot_y: [0, 1.5],
  turn_bang_parallax_x: [-0.015, 0],
  turn_bun_counter_x: [0, 0.02],
  turn_hairpin_counter_x: [0, 0.02],
  turn_ear_x: [0, 1.5],
};

/** Uneven 5×5 grid columns and rows for the `face` plate mesh (issue #436). */
export const FACE_DEFORM_GRID_US: readonly number[] = [0, 0.18, 0.5, 0.82, 1];
export const FACE_DEFORM_GRID_VS: readonly number[] = [0, 0.22, 0.5, 0.78, 1];

/** Resolve {@link FACE_DEFORM_FRACTIONS} with optional recipe overrides. */
export function resolveFaceDeformFractions(overrides?: Readonly<Partial<FaceDeformFractions>> | null): FaceDeformFractions {
  const out: FaceDeformFractions = { ...FACE_DEFORM_FRACTIONS };
  if (overrides !== undefined && overrides !== null) {
    for (const k of Object.keys(FACE_DEFORM_FRACTIONS) as FaceDeformKey[]) {
      const v = overrides[k];
      if (typeof v === 'number') out[k] = v;
    }
  }
  return out;
}

/**
 * Issue #472: the rated band of a single face plate — yaw `±15°`, pitch `±12°`.
 * Beyond this band on one plate, the foreshortened far eye runs out of cheek to
 * sit on; going further takes an alternate face set (`assemble.alternates`),
 * whose swap threshold is this band edge.
 */
export const FACE_RATED_YAW_BAND = 15;
export const FACE_RATED_PITCH_BAND = 12;
export const FACE_RATED_BAND = { yaw: FACE_RATED_YAW_BAND, pitch: FACE_RATED_PITCH_BAND } as const;

/**
 * Issue #477: allowed `[min, max]` range (in rig px) for an authored ear
 * `derive.depth` in `turn` or `tilt`. Ears sit at or behind the head pivot
 * (`depth <= 0`, where `-14` moves the ears slightly against the face turn); a
 * depth outside `[-50, 0]` is refused by `CONFIG_TURN_EAR_DEPTH_RANGE`.
 */
export const EAR_DEPTH_RANGE: readonly [number, number] = [-50, 0];

/** Default part names belonging to the `head` subtree when computing the head-only turn pivot (issue #478). */
export const DEFAULT_HEAD_TURN_PARTS: readonly string[] = [
  'face',
  'nose',
  'mouth',
  'eyewhite_r',
  'eyewhite_l',
  'iris_r',
  'iris_l',
  'irides_r',
  'irides_l',
  'lash_r',
  'lash_l',
  'eyelash_r',
  'eyelash_l',
  'brow_r',
  'brow_l',
  'eyebrow_r',
  'eyebrow_l',
  'ear_r',
  'ear_l',
  'ears',
  'hair_front',
  'hair_back',
  'hairpin',
  'headwear',
  'bun',
  'topknot',
];

export const TURN_ROLES = ['surface', 'unit', 'rear'] as const;
export type TurnRole = (typeof TURN_ROLES)[number];

export const DEFAULT_TURN_PIVOT_25D = 55;
export const DEFAULT_TURN_COUNTER_25D = 0.1;
export const DEFAULT_TURN_GRID_25D: readonly [number, number] = [13, 16];
export const FACESHIFT_BONE = 'faceshift';
export const REAR_SHIFT_BONE = 'rear_shift';
export const YAW_DIAL_BONE = 'yaw_dial';
export const PITCH_DIAL_BONE = 'pitch_dial';
export const BODYSHIFT_BONE = 'bodyshift';
export const BODY_REAR_SHIFT_BONE = 'body_rear_shift';
export const BODY_YAW_DIAL_BONE = 'body_yaw_dial';
export const BODY_TURN_ANIM = 'body_turn';
export const TURN_DIAL_SCALE = 0.0625;
export const TURN_GRID_MAX_TRIANGLES_PER_SLOT = 2400;
export const TURN_GRID_MAX_TRIANGLES_TOTAL = 4000;

/** The slot bone that carries a 2.5D `'surface'` grid mesh (`<part>_surface`), centred on the part's window at world rotation 0. */
export function turnSurfaceBone(part: string): string {
  return `${part}_surface`;
}

/** The carrier bone that carries a 2.5D `'unit'` mesh part (`<part>_unit`) under `faceshift` / `bodyshift` (#790). */
export function turnUnitBone(part: string): string {
  return `${part}_unit`;
}

/** Optional 2.5D body-yaw turn block under `config.turn.body` (#787). */
export interface TurnBodySpec {
  pivot?: number;
  roles: Record<string, TurnRole>;
  bone?: string;
  slider?: string;
  counter?: number;
  grid?: [number, number] | Record<string, [number, number]>;
  unitDepths?: Record<string, number>;
}

/** `config.turn`: either the legacy `{ pivot, depths }` turn spec or the 2.5D depth-sampled `{ roles, body?, pivot?, counter?, grid?, unitDepths?, band? }` spec (#763, #787). */
export interface TurnSpec {
  pivot?: number;
  depths?: Record<string, number>;
  roles?: Record<string, TurnRole>;
  body?: TurnBodySpec;
  counter?: number;
  grid?: [number, number] | Record<string, [number, number]>;
  unitDepths?: Record<string, number>;
  head?: { pivot?: number; radius?: number };
  surface?: { radius?: number };
  radius?: number;
  band?: number | { yaw?: number; pitch?: number };
  deform?: Partial<FaceDeformFractions>;
}

/** Resolve `[cols, rows]` for a `'surface'` part under `config.turn` or `config.turn.body`. */
export function resolveTurnGrid(
  spec: { grid?: [number, number] | Record<string, [number, number]> } | null | undefined,
  part: string,
  fallback?: { grid?: [number, number] | Record<string, [number, number]> } | null,
): [number, number] {
  for (const s of [spec, fallback]) {
    const g = s?.grid;
    if (Array.isArray(g) && g.length === 2) return [g[0], g[1]];
    if (g !== undefined && !Array.isArray(g) && Object.hasOwn(g, part)) {
      const entry = g[part];
      return [entry[0], entry[1]];
    }
  }
  return [DEFAULT_TURN_GRID_25D[0], DEFAULT_TURN_GRID_25D[1]];
}

/** Resolve `[yawBand, pitchBand]` from `config.turn.band`, defaulting to `[FACE_RATED_YAW_BAND, FACE_RATED_PITCH_BAND]`. */
export function resolveTurnBands(spec: TurnSpec | null | undefined): { yaw: number; pitch: number } {
  const b = spec?.band;
  if (typeof b === 'number' && Number.isFinite(b) && b > 0) {
    return { yaw: b, pitch: FACE_RATED_PITCH_BAND };
  }
  if (b !== undefined && typeof b === 'object' && b !== null) {
    return {
      yaw: typeof b.yaw === 'number' && Number.isFinite(b.yaw) && b.yaw > 0 ? b.yaw : FACE_RATED_YAW_BAND,
      pitch: typeof b.pitch === 'number' && Number.isFinite(b.pitch) && b.pitch > 0 ? b.pitch : FACE_RATED_PITCH_BAND,
    };
  }
  return { yaw: FACE_RATED_YAW_BAND, pitch: FACE_RATED_PITCH_BAND };
}

/**
 * Issue #479: the cylinder radius `R` (in rig px) for the curved-surface face
 * yaw projection — `spec.surface.radius`, `spec.radius`, or `spec.head.radius`
 * when declared, defaulting to half the face plate's opaque width (`W / 2`).
 */
export function turnSurfaceRadius(spec: TurnSpec | null | undefined, W: number): number {
  const r = spec?.surface?.radius ?? spec?.radius ?? spec?.head?.radius;
  return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : W / 2;
}

/**
 * Issue #479: horizontal displacement `Δx` of a point at rest offset `x`
 * (`hx - X0`) on a vertical cylinder of radius `radius` turned by `deg`
 * degrees of yaw (`θ = deg · π / 180`), with the rotated surface angle clamped
 * to the visible limb `[-π/2, π/2]`. At the leading limb (`u = -sign(deg)`),
 * `Δx = 0` so the leading outline holds fixed; across the interior (`|u| < 1`),
 * points slide toward the leading side (`-radius · sin θ` at `x = 0`), widening
 * the trailing cheek and foreshortening the leading cheek.
 */
export function cylinderYawDx(x: number, deg: number, radius: number): number {
  if (deg === 0 || !(radius > 0)) return 0;
  const theta = (deg * Math.PI) / 180;
  const u = Math.max(-1, Math.min(1, x / radius));
  const phi0 = Math.asin(u);
  const phi1 = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, phi0 - theta));
  return radius * (Math.sin(phi1) - u);
}

/** One carried part: its depth and the fraction of the control's offset it travels. */
export interface TurnFraction {
  part: string;
  depth: number;
  fraction: number;
}

/** The nearest part of a turn: the smallest depth, the first such part in `depths`' key order. */
export function turnNearest(depths: Readonly<Record<string, number>>): { part: string; depth: number } | null {
  let best: { part: string; depth: number } | null = null;
  for (const [part, depth] of Object.entries(depths)) if (best === null || depth < best.depth) best = { part, depth };
  return best;
}

/**
 * `(pivot − depth) / (pivot − nearest)`, to {@link TURN_PLACES} places, with a
 * negative zero written as 0. The caller holds `pivot > nearest` (the loader
 * refuses anything else, `CONFIG_TURN_PIVOT_BEHIND_NEAREST`).
 */
export function turnFraction(pivot: number, nearest: number, depth: number): number {
  const f = pyRound((pivot - depth) / (pivot - nearest), TURN_PLACES);
  return f === 0 ? 0 : f;
}

/** Every carried part's fraction, in `order` (parts.json's draw order); a name in `order` the spec does not list is not carried. */
export function turnFractions(spec: TurnSpec, order: readonly string[]): TurnFraction[] {
  if (spec.depths === undefined || spec.pivot === undefined) return [];
  const depths = spec.depths;
  const pivot = spec.pivot;
  const nearest = turnNearest(depths);
  if (nearest === null) return [];
  return order.filter((p) => Object.hasOwn(depths, p)).map((part) => ({ part, depth: depths[part], fraction: turnFraction(pivot, nearest.depth, depths[part]) }));
}

/**
 * The pivot `propose` drafts: `Σ area · depth / Σ area` over the carried
 * parts, to {@link TURN_PLACES} places — the depth at which the painted
 * pixels' centroid does not move under the dial. Null with no area.
 */
export function turnPivot(rows: ReadonlyArray<{ depth: number; area: number }>): number | null {
  let a = 0;
  let ad = 0;
  for (const r of rows) {
    a += r.area;
    ad += r.area * r.depth;
  }
  return a > 0 ? pyRound(ad / a, TURN_PLACES) : null;
}

/**
 * Issue #478: the head-only turn pivot — either `spec.head.pivot` when
 * declared, or the `opaque_px`-weighted mean of `spec.depths` restricted to the
 * `head` subtree parts (`headParts`). Neck and torso parts are excluded so a
 * front-heavy body does not pull the head's rotation axis forward of the skull.
 */
export function headTurnPivot(
  spec: TurnSpec,
  headParts: ReadonlySet<string> = new Set(DEFAULT_HEAD_TURN_PARTS),
  partAreas?: Readonly<Record<string, number>>,
): number | null {
  if (typeof spec.head?.pivot === 'number' && Number.isFinite(spec.head.pivot)) {
    return pyRound(spec.head.pivot, TURN_PLACES);
  }
  if (spec.depths === undefined) return null;
  const headEntries = Object.entries(spec.depths).filter(([part, d]) => headParts.has(part) && typeof d === 'number' && Number.isFinite(d));
  const entries = headEntries.length > 0 ? headEntries : Object.entries(spec.depths).filter(([, d]) => typeof d === 'number' && Number.isFinite(d));
  return turnPivot(entries.map(([part, depth]) => ({ depth, area: partAreas?.[part] ?? 1 })));
}

/**
 * Issue #478: a head-mounted part's turn fraction `(headPivot − depth) / (headPivot − headNearest)`
 * about the head-only pivot. Parts behind `headPivot` (`hair_back`, rear `hairpin`)
 * receive a negative fraction and move opposite to the face and irises.
 */
export function headTurnFraction(
  spec: TurnSpec,
  part: string,
  headParts: ReadonlySet<string> = new Set(DEFAULT_HEAD_TURN_PARTS),
  partAreas?: Readonly<Record<string, number>>,
): number | null {
  if (spec.depths === undefined) return null;
  const depth = spec.depths[part];
  if (typeof depth !== 'number' || !Number.isFinite(depth)) return null;
  const pivot = headTurnPivot(spec, headParts, partAreas);
  const headDepths: Record<string, number> = {};
  for (const [p, d] of Object.entries(spec.depths)) {
    if (headParts.has(p) && typeof d === 'number' && Number.isFinite(d)) headDepths[p] = d;
  }
  const nearest = turnNearest(Object.keys(headDepths).length > 0 ? headDepths : spec.depths);
  if (pivot === null || nearest === null || !(pivot > nearest.depth)) return null;
  return turnFraction(pivot, nearest.depth, depth);
}

/** The leaf bone that carries `part`'s share of `bone` under the turn: an identity child of `bone`, so it follows everything `bone` does. */
export function turnTwin(part: string, bone: string): string {
  return `${TURN_BONE}_${part}_${bone}`;
}

/** The transform constraint that carries `part`. */
export function turnConstraintName(part: string): string {
  return `${TURN_BONE}_${part}`;
}

const FACE_DEFORM_MULT = 2.5;
const unmult = (v: number): number => pyRound(v / FACE_DEFORM_MULT, 8);

/**
 * Evaluate the pitch (`tilt`) surface deformation field `(dx, dy)` in `head`
 * space at `(hx, hy)` for `deg` degrees of pitch.
 */
export function evalPitchFaceSurface(
  hx: number,
  hy: number,
  deg: number,
  W: number,
  H: number,
  X0: number,
  Y0: number,
  f: Readonly<FaceDeformFractions> = FACE_DEFORM_FRACTIONS,
): [number, number] {
  if (deg === 0) return [0, 0];
  const ux = Math.max(-1.35, Math.min(1.35, (hx - X0) / (W / 2)));
  const uy = Math.max(-1.35, Math.min(1.35, (hy - Y0) / (H / 2)));
  const uChin = Math.min(1.2, Math.max(0, -uy));
  const uCrown = Math.min(1.2, Math.max(0, uy));
  const fracYPerDeg = unmult(f.tilt_mid_y) + unmult(f.tilt_chin_squash_y) * Math.pow(uChin, 1.25) + unmult(f.tilt_crown_drop_y) * Math.pow(uCrown, 1.25);
  const fracXPerDeg = unmult(f.tilt_taper_x) * ux * Math.max(-1.1, Math.min(1.1, uy));
  return [FACE_DEFORM_MULT * deg * W * fracXPerDeg, FACE_DEFORM_MULT * deg * H * fracYPerDeg];
}

/**
 * Evaluate the yaw (`turn`) surface deformation field `(dx, dy)` in `head`
 * space at `(hx, hy)` for `deg` degrees of yaw (issue #479: cylinder projection
 * of radius `radius`, default `W / 2`, with lower-face jaw taper so the leading
 * jaw edge holds and the trailing cheek widens; `flatYawTable: true` restores
 * the flat yaw table for the Bar 4 negative control or explicit fraction overrides).
 */
export function evalYawFaceSurface(
  hx: number,
  hy: number,
  deg: number,
  W: number,
  H: number,
  X0: number,
  Y0: number,
  f: Readonly<FaceDeformFractions> = FACE_DEFORM_FRACTIONS,
  radius?: number,
  flatYawTable = false,
): [number, number] {
  if (deg === 0) return [0, 0];
  const s = Math.sign(deg);
  const ux = Math.max(-1.35, Math.min(1.35, (hx - X0) / (W / 2)));
  const uy = Math.max(-1.35, Math.min(1.35, (hy - Y0) / (H / 2)));
  const fracYPerDeg = unmult(f.turn_cheek_arch_y) * (-s * ux) * Math.max(0, 1 - Math.abs(uy));
  const dy = FACE_DEFORM_MULT * deg * H * fracYPerDeg;
  if (flatYawTable) {
    const uLead = Math.min(1.2, Math.max(0, -s * ux));
    const uTrail = Math.min(1.2, Math.max(0, s * ux));
    const fracXPerDeg = unmult(f.turn_mid_x) + unmult(f.turn_lead_compress_x) * Math.pow(uLead, 1.2) + unmult(f.turn_trail_shift_x) * Math.pow(uTrail, 1.2);
    return [FACE_DEFORM_MULT * deg * W * fracXPerDeg, dy];
  }
  const R = radius !== undefined && radius > 0 ? radius : W / 2;
  const rawDx = cylinderYawDx(hx - X0, deg, R);
  const absUx = Math.abs((hx - X0) / (W / 2));
  const tOutline = Math.max(0, Math.min(1, (absUx - 0.7) / (1.0 - 0.7)));
  const wOutline = 1 - tOutline * tOutline * (3 - 2 * tOutline);
  const dx = rawDx * wOutline;
  return [dx, dy];
}

export interface FaceSurfaceDeformOptions {
  /** Padded `face.png` width in rig px (defaults to the mesh width or 114). */
  imageWidth?: number;
  /** Padded `face.png` height in rig px (defaults to the mesh height or 136). */
  imageHeight?: number;
  /** Opaque face plate width `W` in rig px (defaults to `imageWidth - 8`). */
  opaqueWidth?: number;
  /** Opaque face plate height `H` in rig px (defaults to `imageHeight - 8`). */
  opaqueHeight?: number;
  /** Recipe overrides for {@link FACE_DEFORM_FRACTIONS}. */
  overrides?: Readonly<Partial<FaceDeformFractions>> | null;
  /**
   * Issue #472: true when `assemble.alternates` declares an alternate face set
   * for the overflow beyond `±15°` yaw / `±12°` pitch. When false or absent,
   * any `yaw` / `pitch` slider constraints on the rig are preceded by clamping
   * transform constraints holding the dial bones to `[-15, 15]` and `[-12, 12]`.
   */
  hasAlternateFaceSet?: boolean;
  /** Issue #478: `config.turn` holding `pivot`, `depths` and optional `head.pivot` / `radius`. */
  turn?: TurnSpec | null;
  /** Issue #478: each part's `opaque_px` from `parts.json` for weighting the head-only pivot. */
  partAreas?: Readonly<Record<string, number>>;
  /**
   * Issue #478: when true, refuse by `CONFIG_TURN_REQUIRED` if `turn` is absent
   * or missing `depths` for attached `face`, `hair_front`, or `hair_back`.
   */
  requireTurn?: boolean;
  /**
   * Issue #478 Bar 4 negative control: when true, flip the back-layer fraction
   * sign so `hair_back` and `hairpin` move with the face instead of against it.
   */
  flipBackLayerSignMutant?: boolean;
  /**
   * Issue #479: explicit cylinder radius override in rig px (defaults to
   * `turnSurfaceRadius(turn, W)` = `W / 2`).
   */
  surfaceRadius?: number;
  /**
   * Issue #479 Bar 4 negative control: when true, restore the flat yaw table
   * instead of the cylinder projection.
   */
  flatYawTableMutant?: boolean;
}

interface DeformWeight {
  bone: string;
  x: number;
  y: number;
  weight: number;
}

interface DeformMeshAttachment {
  type: 'mesh';
  image: string;
  width: number;
  height: number;
  uvs: number[];
  triangles: number[];
  hull: number;
  weights: DeformWeight[][];
}

interface DeformRegionAttachment {
  image: string;
  x: number;
  y: number;
  rotation?: number;
}

interface DeriveSpec {
  kind: 'yaw' | 'pitch';
  degrees: number;
  about?: number;
  depth?: number | Readonly<Record<string, number>>;
  carried?: number | Readonly<Record<string, number>>;
}

interface SliderKey {
  t: number;
  v?: number[] | Record<string, number[]>;
  derive?: DeriveSpec;
}

interface SliderTrack {
  bone?: string;
  group?: string;
  property: string;
  keys: SliderKey[];
}

interface DeformTimelineEntry {
  slot: string;
  attachment: string;
  keys: Array<{ t: number; vertices?: number[] }>;
}

interface SliderAnimation {
  duration: number;
  tracks: SliderTrack[];
  deform?: DeformTimelineEntry[];
}

function buildFaceGrid(width: number, height: number): { points: Array<[number, number]>; uvs: number[]; triangles: number[]; hull: number } {
  const us = FACE_DEFORM_GRID_US;
  const vs = FACE_DEFORM_GRID_VS;
  const cols = us.length - 1;
  const rows = vs.length - 1;
  const ring: Array<[number, number]> = [];
  for (let c = 0; c <= cols; c++) ring.push([c, 0]);
  for (let r = 1; r <= rows; r++) ring.push([cols, r]);
  for (let c = cols - 1; c >= 0; c--) ring.push([c, rows]);
  for (let r = rows - 1; r >= 1; r--) ring.push([0, r]);
  const interior: Array<[number, number]> = [];
  for (let r = 1; r < rows; r++) for (let c = 1; c < cols; c++) interior.push([c, r]);
  const all = [...ring, ...interior];
  const idx = new Map<string, number>();
  all.forEach(([c, r], i) => idx.set(`${c},${r}`, i));
  const points: Array<[number, number]> = [];
  const uvs: number[] = [];
  for (const [c, r] of all) {
    const u = us[c];
    const v = vs[r];
    points.push([u * width, v * height]);
    uvs.push(pyRound(u, 6), pyRound(v, 6));
  }
  const triangles: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tl = idx.get(`${c},${r}`) as number;
      const tr = idx.get(`${c + 1},${r}`) as number;
      const bl = idx.get(`${c},${r + 1}`) as number;
      const br = idx.get(`${c + 1},${r + 1}`) as number;
      triangles.push(tl, bl, br, tl, br, tr);
    }
  }
  return { points, uvs, triangles, hull: ring.length };
}

/**
 * Promote the `face` region on `head` to a 5×5 grid mesh and populate the
 * `tilt` and `turn` slider animations with the Set B ×2.5 face and hair mesh
 * deform timelines, feature field-sampled tracks (#468) and ear/topknot tracks
 * (issues #436, #477, #478). When `motion` holds neither `tilt` nor `turn` with
 * slider `derive` keys, neither `rig` nor `motion` is touched.
 */
export function applyFaceSurfaceDeform(
  rig: {
    bones: Array<{ name: string; parent?: string; x: number; y: number; rotation?: number; length?: number; inherit?: string }>;
    slots?: Array<{ name: string; bone: string }>;
    skins: { default: Record<string, Record<string, DeformMeshAttachment | DeformRegionAttachment>> };
    constraints?: Array<Record<string, unknown>>;
    invariants?: Record<string, unknown>;
  },
  motion: {
    groups?: Record<string, string[]>;
    animations: Record<string, unknown>;
  },
  options?: FaceSurfaceDeformOptions | Readonly<Partial<FaceDeformFractions>> | null,
): void {
  const rawTilt = motion.animations.tilt as SliderAnimation | undefined;
  const rawTurn = motion.animations.turn as SliderAnimation | undefined;
  if (rawTilt === undefined && rawTurn === undefined) return;
  const hasDerive =
    (rawTilt?.tracks?.some((tr) => tr.keys?.some((k) => k.derive !== undefined)) ?? false) ||
    (rawTurn?.tracks?.some((tr) => tr.keys?.some((k) => k.derive !== undefined)) ?? false);
  if (!hasDerive) return;

  const isOpts =
    options !== undefined &&
    options !== null &&
    ('imageWidth' in options ||
      'imageHeight' in options ||
      'opaqueWidth' in options ||
      'opaqueHeight' in options ||
      'overrides' in options ||
      'hasAlternateFaceSet' in options ||
      'turn' in options ||
      'partAreas' in options ||
      'requireTurn' in options ||
      'flipBackLayerSignMutant' in options ||
      'surfaceRadius' in options ||
      'flatYawTableMutant' in options);
  const opts: FaceSurfaceDeformOptions = isOpts ? (options as FaceSurfaceDeformOptions) : { overrides: options as Readonly<Partial<FaceDeformFractions>> | null | undefined };

  // Issue #477 & #478: refuse an out-of-range ear derive.depth or missing config.turn by name before touching rig or motion.
  const preProblems: Problem[] = [];
  if (opts.requireTurn === true) {
    if (opts.turn === undefined || opts.turn === null) {
      preProblems.push({
        code: 'CONFIG_TURN_REQUIRED',
        object: 'config.turn',
        detail: 'is absent and required when motion.animations_from carries a turn or tilt slider animation with derive keys; copy the turn block propose drafted into config.turn so the head pivot and each head part\'s depth are declared',
      });
    } else if (opts.turn.depths !== undefined) {
      for (const reqPart of ['face', 'hair_front', 'hair_back'] as const) {
        if (rig.skins.default[reqPart]?.[reqPart] !== undefined && !(reqPart in opts.turn.depths)) {
          preProblems.push({
            code: 'CONFIG_TURN_REQUIRED',
            object: `config.turn.depths.${reqPart}`,
            detail: `is absent and required when motion.animations_from carries a turn or tilt slider animation with derive keys and "${reqPart}" is attached; include "${reqPart}"'s See-through depth_median in config.turn.depths so the head pivot and fraction are defined`,
          });
        }
      }
    }
  }
  const [earLo, earHi] = EAR_DEPTH_RANGE;
  for (const [animName, anim] of [
    ['tilt', rawTilt],
    ['turn', rawTurn],
  ] as const) {
    if (anim === undefined) continue;
    anim.tracks.forEach((tr, ti) => {
      const isEarTrack = tr.group === 'ears' || tr.bone === 'ear_r' || tr.bone === 'ear_l';
      if (!isEarTrack) return;
      tr.keys.forEach((k, ki) => {
        const d = k.derive?.depth;
        if (typeof d === 'number') {
          if (d < earLo || d > earHi) {
            preProblems.push({
              code: 'CONFIG_TURN_EAR_DEPTH_RANGE',
              object: `animations.${animName}.tracks[${ti}].keys[${ki}].derive.depth`,
              detail: `is ${d}; an ear depth in [${earLo}, ${earHi}] (at or behind the head pivot) is required`,
            });
          }
        } else if (d !== undefined && typeof d === 'object') {
          for (const [member, val] of Object.entries(d)) {
            if (typeof val === 'number' && (val < earLo || val > earHi)) {
              preProblems.push({
                code: 'CONFIG_TURN_EAR_DEPTH_RANGE',
                object: `animations.${animName}.tracks[${ti}].keys[${ki}].derive.depth.${member}`,
                detail: `is ${val}; an ear depth in [${earLo}, ${earHi}] (at or behind the head pivot) is required`,
              });
            }
          }
        }
      });
    });
  }
  refuseIfAny(preProblems);

  const tiltAnim = rawTilt === undefined ? undefined : structuredClone(rawTilt);
  const turnAnim = rawTurn === undefined ? undefined : structuredClone(rawTurn);
  if (tiltAnim !== undefined) motion.animations.tilt = tiltAnim;
  if (turnAnim !== undefined) motion.animations.turn = turnAnim;

  const f = resolveFaceDeformFractions(opts.overrides);
  const hasFlatYawOverride =
    opts.overrides !== undefined &&
    opts.overrides !== null &&
    (opts.overrides.turn_mid_x !== undefined ||
      opts.overrides.turn_lead_compress_x !== undefined ||
      opts.overrides.turn_trail_shift_x !== undefined);
  const useFlatYaw = opts.flatYawTableMutant === true || hasFlatYawOverride;

  // Issue #472: when no alternate face set is declared, clamp dial bones to the single-plate rated band (±15° yaw, ±12° pitch).
  if (!opts.hasAlternateFaceSet && Array.isArray(rig.constraints)) {
    const nextConstraints: Array<Record<string, unknown>> = [];
    const existingNames = new Set(rig.constraints.map((c) => c.name));
    const makeClampConstraint = (name: string, bone: string, prop: unknown, band: number): Record<string, unknown> => {
      const useX = prop === 'x' || prop === 'translatex';
      const key = useX ? 'x' : 'rotate';
      const mixKey = useX ? 'mixX' : 'mixRotate';
      return {
        name,
        type: 'transform',
        source: bone,
        bones: [bone],
        localSource: true,
        localTarget: true,
        clamp: true,
        properties: {
          [key]: {
            offset: -band,
            to: {
              [key]: {
                offset: -band,
                max: band,
                scale: 1,
              },
            },
          },
        },
        [mixKey]: 1,
      };
    };
    for (const c of rig.constraints) {
      if (c.type === 'slider' && typeof c.bone === 'string') {
        const isYaw = c.name === 'yaw' || c.animation === 'turn';
        const isPitch = c.name === 'pitch' || c.animation === 'tilt';
        if (isYaw && !existingNames.has('yaw_clamp')) {
          existingNames.add('yaw_clamp');
          nextConstraints.push(makeClampConstraint('yaw_clamp', c.bone, c.property, FACE_RATED_YAW_BAND));
        } else if (isPitch && !existingNames.has('pitch_clamp')) {
          existingNames.add('pitch_clamp');
          nextConstraints.push(makeClampConstraint('pitch_clamp', c.bone, c.property, FACE_RATED_PITCH_BAND));
        }
      }
      nextConstraints.push(c);
    }
    rig.constraints = nextConstraints;
  }

  const faceSlot = rig.skins.default.face;
  if (faceSlot === undefined || faceSlot.face === undefined) return;
  const faceAtt = faceSlot.face;

  let faceW = opts.imageWidth ?? 114;
  let faceH = opts.imageHeight ?? 136;
  let faceRegX = -1;
  let faceRegY = 49;

  const faceBone = rig.slots?.find((s) => s.name === 'face')?.bone ?? (rig.bones.some((b) => b.name === 'turn_face_head') ? 'turn_face_head' : 'head');

  if (!('type' in faceAtt)) {
    faceRegX = faceAtt.x;
    faceRegY = faceAtt.y;
    const grid = buildFaceGrid(faceW, faceH);
    const faceWeights: DeformWeight[][] = grid.points.map(([px, py]) => [
      {
        bone: faceBone,
        x: pyRound(faceRegX - faceW / 2 + px, 6),
        y: pyRound(faceRegY + faceH / 2 - py, 6),
        weight: 1,
      },
    ]);
    faceSlot.face = {
      type: 'mesh',
      image: faceAtt.image,
      width: faceW,
      height: faceH,
      uvs: grid.uvs,
      triangles: grid.triangles,
      hull: grid.hull,
      weights: faceWeights,
    };
    if (rig.invariants !== undefined) {
      if (typeof rig.invariants.meshSlots === 'number') rig.invariants.meshSlots += 1;
      if (typeof rig.invariants.meshTriangles === 'number') rig.invariants.meshTriangles += grid.triangles.length / 3;
    }
  } else {
    faceW = faceAtt.width;
    faceH = faceAtt.height;
    let sumX = 0;
    let sumY = 0;
    for (const w of faceAtt.weights) {
      sumX += w[0]?.x ?? 0;
      sumY += w[0]?.y ?? 0;
    }
    if (faceAtt.weights.length > 0) {
      faceRegX = Math.round((sumX / faceAtt.weights.length) * 2) / 2;
      faceRegY = Math.round((sumY / faceAtt.weights.length) * 2) / 2;
    }
  }

  const W = opts.opaqueWidth ?? faceW - 8;
  const H = opts.opaqueHeight ?? faceH - 8;
  const X0 = faceRegX;
  const Y0 = faceRegY - 1;
  const cylRadius =
    opts.surfaceRadius !== undefined && Number.isFinite(opts.surfaceRadius) && opts.surfaceRadius > 0
      ? opts.surfaceRadius
      : turnSurfaceRadius(opts.turn, W);

  const boneOrder = new Map<string, number>(rig.bones.map((b, i) => [b.name, i]));
  for (const slotName of ['hair_front', 'hair_back', 'hairpin']) {
    const slotObj = rig.skins.default[slotName];
    const att = slotObj?.[slotName];
    if (att !== undefined && 'type' in att) {
      for (const infls of att.weights) {
        infls.sort((a, b) => (boneOrder.get(a.bone) ?? 0) - (boneOrder.get(b.bone) ?? 0));
      }
    }
  }

  const tf = computeWorldTransforms(rig.bones);
  const headTf = tf.get('head') as BoneTransform | undefined;
  if (headTf === undefined) return;

  interface VertexSetup {
    hx: number;
    hy: number;
    boneWeights: Record<string, number>;
    infls: DeformWeight[];
  }

  const getMeshSetup = (att: DeformMeshAttachment): VertexSetup[] =>
    att.weights.map((infls) => {
      let wx = 0;
      let wy = 0;
      const boneWeights: Record<string, number> = {};
      for (const inf of infls) {
        const m = tf.get(inf.bone) as BoneTransform;
        const [x, y] = toWorld(m, inf.x, inf.y);
        wx += x * inf.weight;
        wy += y * inf.weight;
        boneWeights[inf.bone] = (boneWeights[inf.bone] ?? 0) + inf.weight;
      }
      return { hx: wx - headTf.worldX, hy: wy - headTf.worldY, boneWeights, infls };
    });

  const expandToDeform = (verts: readonly VertexSetup[], evalVertex: (v: VertexSetup) => [number, number]): number[] => {
    const out: number[] = [];
    for (const v of verts) {
      const [dx, dy] = evalVertex(v);
      for (const inf of v.infls) {
        const m = tf.get(inf.bone) as BoneTransform;
        const [bx, by] = toBoneLocalVector(m, dx, dy);
        out.push(pyRound(bx, 4), pyRound(by, 4));
      }
    }
    return out;
  };

  const boneMap = new Map(rig.bones.map((b) => [b.name, b]));
  const referencedGroups = new Set<string>();
  for (const anim of [tiltAnim, turnAnim]) {
    for (const tr of anim?.tracks ?? []) {
      if (tr.group !== undefined) referencedGroups.add(tr.group);
    }
  }
  const defaultGroups: Readonly<Record<string, readonly string[]>> = {
    features: ['eye_r', 'eye_l', 'brow_r', 'brow_l', 'pupil_r', 'pupil_l', 'eyelash_r', 'eyelash_l', 'eyebrow_r', 'eyebrow_l', 'nose', 'mouth'],
    ears: ['ear_r', 'ear_l'],
    bangs: ['bang_r0', 'bang_c0', 'bang_l0'].map((b) => (boneMap.has(`${b}_ctl`) ? `${b}_ctl` : b)),
    topknot: ['bun_ctl', 'hairpin', 'headwear'],
  };
  for (const g of referencedGroups) {
    if (motion.groups?.[g] === undefined && defaultGroups[g] !== undefined) {
      const members = defaultGroups[g].filter((b) => boneMap.has(b));
      if (members.length > 0) {
        motion.groups ??= {};
        motion.groups[g] = members;
      }
    }
  }

  const evalDeriveKey = (boneName: string, k: SliderKey): number => {
    if (Array.isArray(k.v)) return k.v[0] ?? 0;
    if (k.v !== undefined && typeof k.v === 'object') return k.v[boneName]?.[0] ?? 0;
    const d = k.derive;
    if (d === undefined) return 0;
    const b = boneMap.get(boneName);
    const coord = d.kind === 'yaw' ? (b?.x ?? 0) : (b?.y ?? 0);
    const rad = (d.degrees * Math.PI) / 180;
    const depth = typeof d.depth === 'number' ? d.depth : (d.depth?.[boneName] ?? 0);
    const carried = typeof d.carried === 'number' ? d.carried : (d.carried?.[boneName] ?? 0);
    const val = (coord - (d.about ?? 0)) * (Math.cos(rad) - 1) - (depth - carried) * Math.sin(rad);
    const r = Math.round(val * 1e6) / 1e6;
    return r === 0 ? 0 : r;
  };

  const mapParent: Readonly<Record<string, string>> = {
    bang_r0: boneMap.has('bang_r0_ctl') ? 'bang_r0_ctl' : 'bang_r0',
    bang_r1: boneMap.has('bang_r0_ctl') ? 'bang_r0_ctl' : 'bang_r0',
    bang_c0: boneMap.has('bang_c0_ctl') ? 'bang_c0_ctl' : 'bang_c0',
    bang_c1: boneMap.has('bang_c0_ctl') ? 'bang_c0_ctl' : 'bang_c0',
    bang_l0: boneMap.has('bang_l0_ctl') ? 'bang_l0_ctl' : 'bang_l0',
    bang_l1: boneMap.has('bang_l0_ctl') ? 'bang_l0_ctl' : 'bang_l0',
    bun: boneMap.has('bun_ctl') ? 'bun_ctl' : 'bun',
  };

  const getBoneDeltaAtTime = (tracks: readonly SliderTrack[], t: number, boneName: string): [number, number] => {
    const drivers = new Set<string>();
    let cur: string | undefined = boneName;
    const visited = new Set<string>();
    while (cur !== undefined && !visited.has(cur) && cur !== 'head' && cur !== 'turn_face_head' && cur !== 'root') {
      visited.add(cur);
      if (!cur.startsWith('turn_')) {
        drivers.add(mapParent[cur] ?? cur);
      }
      cur = boneMap.get(cur)?.parent;
    }
    if (drivers.size === 0) {
      const stripped = boneName.replace(/^turn_[^_]+_/, '');
      if (stripped !== 'head' && stripped !== 'root') {
        drivers.add(mapParent[stripped] ?? stripped);
      }
    }
    let dx = 0;
    let dy = 0;
    for (const driver of drivers) {
      for (const tr of tracks) {
        const inGroup = tr.group !== undefined && (motion.groups?.[tr.group]?.includes(driver) ?? false);
        if (tr.bone !== driver && !inGroup) continue;
        const key = tr.keys.find((k) => Math.abs(k.t - t) < 1e-6);
        if (key === undefined) continue;
        const val = evalDeriveKey(driver, key);
        if (tr.property === 'translatex') dx += val;
        if (tr.property === 'translatey') dy += val;
      }
    }
    return [dx, dy];
  };

  const getVertexBoneDelta = (v: VertexSetup, tracks: readonly SliderTrack[], t: number): [number, number] => {
    let bx = 0;
    let by = 0;
    for (const [bname, w] of Object.entries(v.boneWeights)) {
      const [dx, dy] = getBoneDeltaAtTime(tracks, t, bname);
      bx += dx * w;
      by += dy * w;
    }
    return [bx, by];
  };

  const faceMesh = faceSlot.face as DeformMeshAttachment;
  const faceVerts = getMeshSetup(faceMesh);
  const hairFrontAtt = rig.skins.default.hair_front?.hair_front;
  const hairBackAtt = rig.skins.default.hair_back?.hair_back;
  const hairpinAtt = rig.skins.default.hairpin?.hairpin;
  const hairFrontVerts = hairFrontAtt !== undefined && 'type' in hairFrontAtt ? getMeshSetup(hairFrontAtt) : null;
  const hairBackVerts = hairBackAtt !== undefined && 'type' in hairBackAtt ? getMeshSetup(hairBackAtt) : null;
  const hairpinVerts = hairpinAtt !== undefined && 'type' in hairpinAtt && !boneMap.has('hairpin') ? getMeshSetup(hairpinAtt) : null;

  const hyCrown = Y0 + (67 / 128) * H;
  const hyCrownStart = Y0 + (24 / 128) * H;
  const hyCrownZero = Y0 + (48 / 128) * H;
  const hyBunSpan = (85 / 128) * H;
  const hyBangBottom = Y0 - (68 / 128) * H;
  const hyBangSpan = (130 / 128) * H;
  const hyTurnBangBottom = Y0 - (28 / 128) * H;
  const hyTurnBangSpan = (80 / 128) * H;
  const hyEar = Y0 - (16 / 128) * H;
  const earRx = boneMap.get('ear_r')?.x ?? -51;
  const earLx = boneMap.get('ear_l')?.x ?? 47.5;
  const featRx = (24 / 106) * W;
  const featRy = (12 / 128) * H;
  const featMembers = motion.groups?.features ?? [];

  const minDepthOf = (depth: number | Readonly<Record<string, number>> | undefined, fallback: number): number => {
    if (typeof depth === 'number') return depth > 0 ? depth : fallback;
    if (depth === undefined) return fallback;
    const vals = Object.values(depth).filter((v): v is number => typeof v === 'number' && v > 0);
    return vals.length > 0 ? Math.min(...vals) : fallback;
  };

  const memberDepthOf = (depth: number | Readonly<Record<string, number>> | undefined, boneName: string, zRef: number): number => {
    if (typeof depth === 'number') return depth;
    return depth?.[boneName] ?? zRef;
  };

  if (tiltAnim !== undefined) {
    const origTiltTracks = tiltAnim.tracks.map((tr) => ({ ...tr, keys: [...tr.keys] }));
    const refTiltTrack = origTiltTracks.find((tr) => tr.keys.some((k) => k.derive !== undefined)) ?? origTiltTracks[0];
    const isLegacyTilt =
      tiltAnim.duration === 2.5 &&
      Math.abs(refTiltTrack?.keys[0]?.derive?.degrees ?? 0) === 25;
    const tiltKeys: Array<{ t: number; deg: number }> = isLegacyTilt
      ? [
          { t: 0, deg: -25 },
          { t: 0.75, deg: -10 },
          { t: 1.25, deg: 0 },
          { t: 2.0, deg: 15 },
          { t: 2.5, deg: 25 },
        ]
      : (refTiltTrack?.keys ?? []).map((k) => ({ t: k.t, deg: k.derive?.degrees ?? 0 }));
    const tiltDeform: DeformTimelineEntry[] = [
      {
        slot: 'face',
        attachment: 'face',
        keys: tiltKeys.map(({ t, deg }) =>
          deg === 0 ? { t } : { t, vertices: expandToDeform(faceVerts, (v) => evalPitchFaceSurface(v.hx, v.hy, deg, W, H, X0, Y0, f)) },
        ),
      },
    ];
    if (hairFrontVerts !== null) {
      tiltDeform.push({
        slot: 'hair_front',
        attachment: 'hair_front',
        keys: tiltKeys.map(({ t, deg }) =>
          deg === 0
            ? { t }
            : {
                t,
                vertices: expandToDeform(hairFrontVerts, (v) => {
                  const [dxSurf, dySurf] = evalPitchFaceSurface(v.hx, v.hy, deg, W, H, X0, Y0, f);
                  const [bx, by] = getVertexBoneDelta(v, origTiltTracks, t);
                  const baseBangDy = (deg / 15) * (f.tilt_bang_base_y * 15 * H) * Math.max(0, Math.min(1, (v.hy - hyBangBottom) / hyBangSpan));
                  return [dxSurf - bx, baseBangDy + dySurf * f.tilt_hair_front_y - by];
                }),
              },
        ),
      });
    }
    if (hairBackVerts !== null) {
      tiltDeform.push({
        slot: 'hair_back',
        attachment: 'hair_back',
        keys: tiltKeys.map(({ t, deg }) =>
          deg === 0
            ? { t }
            : {
                t,
                vertices: expandToDeform(hairBackVerts, (v) => {
                  const [bx, by] = getVertexBoneDelta(v, origTiltTracks, t);
                  const [dxSurf, dySurf] = evalPitchFaceSurface(v.hx, Math.min(hyCrown, v.hy), deg, W, H, X0, Y0, f);
                  const uBun = Math.max(0, Math.min(1, (v.hy - hyCrown) / hyBunSpan));
                  const targetDy = (1 - uBun) * (dySurf * f.tilt_hair_back_lower_y) + uBun * (dySurf * f.tilt_hair_back_bun_y);
                  return [dxSurf * (1 - pyRound(1 - f.tilt_hair_back_bun_x, 8) * uBun) - bx, targetDy - by];
                }),
              },
        ),
      });
    }
    for (const tr of tiltAnim.tracks) {
      if (tr.group === 'features' && (tr.property === 'translatey' || tr.property === 'scaley') && featMembers.length > 0) {
        const zRef = minDepthOf(tr.keys[0]?.derive?.depth, 34);
        tr.keys = tr.keys.map((k) => {
          const deg = k.derive?.degrees ?? 0;
          if (deg === 0) return { t: k.t, v: tr.property === 'scaley' ? [1] : [0] };
          const vMap: Record<string, number[]> = {};
          for (const bname of featMembers) {
            const b = boneMap.get(bname);
            const bx = b?.x ?? 0;
            const by = b?.y ?? Y0;
            const z = memberDepthOf(k.derive?.depth, bname, zRef);
            const dFrac = zRef > 0 ? z / zRef : 1;
            const uy = Math.max(-1, Math.min(1, (by - Y0) / (H / 2)));
            const effDeg = deg * (1 + (dFrac - 1) * Math.max(0, 1 - uy * uy));
            const [, dyD] = evalPitchFaceSurface(bx, by - featRy, effDeg, W, H, X0, Y0, f);
            const [, dyU] = evalPitchFaceSurface(bx, by + featRy, effDeg, W, H, X0, Y0, f);
            if (tr.property === 'translatey') {
              vMap[bname] = [pyRound(0.5 * (dyD + dyU), 4)];
            } else {
              vMap[bname] = [pyRound(Math.max(0.2, 1 + (dyU - dyD) / (2 * featRy)), 4)];
            }
          }
          return { t: k.t, v: vMap };
        });
      }
      if (tr.group === 'ears' && tr.property === 'translatey') {
        tr.keys = tr.keys.map((k) => {
          const deg = k.derive?.degrees ?? 0;
          if (deg === 0) return { t: k.t, v: [0] };
          const [, dyEar] = evalPitchFaceSurface(0, hyEar, deg, W, H, X0, Y0, f);
          return { t: k.t, v: [pyRound(dyEar * f.tilt_ear_y, 4)] };
        });
      }
      if (tr.group === 'topknot' && tr.property === 'translatey') {
        tr.keys = tr.keys.map((k) => {
          const deg = k.derive?.degrees ?? 0;
          if (deg === 0) return { t: k.t, v: [0] };
          const [, dyCrown] = evalPitchFaceSurface(0, hyCrown, deg, W, H, X0, Y0, f);
          return { t: k.t, v: [pyRound(dyCrown * f.tilt_topknot_y, 4)] };
        });
      }
    }
    const refTiltKeys = refTiltTrack?.keys ?? [];
    for (const [earBone, earHx] of [
      ['ear_r', earRx],
      ['ear_l', earLx],
    ] as const) {
      if (!boneMap.has(earBone)) continue;
      tiltAnim.tracks.push({
        bone: earBone,
        property: 'translatex',
        keys: refTiltKeys.map((k) => {
          const deg = k.derive?.degrees ?? 0;
          if (deg === 0) return { t: k.t, v: [0] };
          const [dxEar] = evalPitchFaceSurface(earHx, hyEar, deg, W, H, X0, Y0, f);
          return { t: k.t, v: [pyRound(dxEar, 4)] };
        }),
      });
    }
    tiltAnim.deform = tiltDeform;
  }

  if (turnAnim !== undefined) {
    const origTurnTracks = turnAnim.tracks.map((tr) => ({ ...tr, keys: [...tr.keys] }));
    const refTurnTrack = origTurnTracks.find((tr) => tr.keys.some((k) => k.derive !== undefined)) ?? origTurnTracks[0];
    const isLegacyTurn =
      turnAnim.duration === 3.0 &&
      Math.abs(refTurnTrack?.keys[0]?.derive?.degrees ?? 0) === 30;
    const turnKeys: Array<{ t: number; deg: number }> = isLegacyTurn
      ? [
          { t: 0, deg: -30 },
          { t: 0.75, deg: -15 },
          { t: 1.5, deg: 0 },
          { t: 2.25, deg: 15 },
          { t: 3.0, deg: 30 },
        ]
      : (refTurnTrack?.keys ?? []).map((k) => ({ t: k.t, deg: k.derive?.degrees ?? 0 }));
    const refTurnKeys = refTurnTrack?.keys ?? [];

    // Issue #478: compute head-subtree turn fractions about the head-only pivot.
    const headParts = new Set<string>(DEFAULT_HEAD_TURN_PARTS);

    const backSign = opts.flipBackLayerSignMutant === true ? -1 : 1;
    const rawBackFrac = opts.turn != null ? headTurnFraction(opts.turn, 'hair_back', headParts, opts.partAreas) : null;
    const rawHairpinFrac = opts.turn != null ? headTurnFraction(opts.turn, 'hairpin', headParts, opts.partAreas) : null;
    const hairpinRidesBack =
      hairpinAtt !== undefined &&
      'type' in hairpinAtt &&
      hairpinAtt.weights.some((infls) => infls.some((w) => w.bone.includes('hairback_')));

    const dxFaceCenterAt = (deg: number): number => FACE_DEFORM_MULT * deg * W * unmult(f.turn_mid_x);
    const dxBunAt = (deg: number): number =>
      backSign * FACE_DEFORM_MULT * (deg / 15) * pyRound((f.turn_bun_counter_x * 15 * W) / FACE_DEFORM_MULT, 8);
    const dxBackAt = (deg: number): number => {
      if (rawBackFrac !== null) {
        return backSign * rawBackFrac * dxFaceCenterAt(deg);
      }
      return dxBunAt(deg);
    };
    const dxHairpinAt = (deg: number): number => {
      if (rawHairpinFrac !== null && rawHairpinFrac < 0) {
        return backSign * rawHairpinFrac * dxFaceCenterAt(deg);
      }
      if (hairpinRidesBack && rawBackFrac !== null) {
        const ratio = f.turn_bun_counter_x > 0 ? f.turn_hairpin_counter_x / f.turn_bun_counter_x : 0.75;
        return dxBackAt(deg) * ratio;
      }
      return backSign * FACE_DEFORM_MULT * (deg / 15) * pyRound((f.turn_hairpin_counter_x * 15 * W) / FACE_DEFORM_MULT, 8);
    };

    const earMembers = motion.groups?.ears ?? ['ear_r', 'ear_l'].filter((b) => boneMap.has(b));
    const hasAuthoredEarTurnTx = turnAnim.tracks.some(
      (tr) => tr.property === 'translatex' && (tr.group === 'ears' || tr.bone === 'ear_r' || tr.bone === 'ear_l'),
    );
    turnAnim.tracks = turnAnim.tracks.filter(
      (tr) => !(tr.group === 'topknot' && tr.property === 'translatex'),
    );
    for (const tr of turnAnim.tracks) {
      if (tr.group === 'features' && (tr.property === 'translatex' || tr.property === 'scalex') && featMembers.length > 0) {
        const zRef = minDepthOf(tr.keys[0]?.derive?.depth, 36);
        tr.keys = tr.keys.map((k) => {
          const deg = k.derive?.degrees ?? 0;
          if (deg === 0) return { t: k.t, v: tr.property === 'scalex' ? [1] : [0] };
          const vMap: Record<string, number[]> = {};
          const s = Math.sign(deg);
          for (const bname of featMembers) {
            const b = boneMap.get(bname);
            const bx = b?.x ?? X0;
            const by = b?.y ?? Y0;
            const z = memberDepthOf(k.derive?.depth, bname, zRef);
            const dFrac = zRef > 0 ? z / zRef : 1;
            const ux = Math.max(-1, Math.min(1, (bx - X0) / (W / 2)));
            const effDeg = deg * (1 + (dFrac - 1) * Math.max(0, 1 - ux * ux));
            const [dxL] = evalYawFaceSurface(bx - featRx, by, effDeg, W, H, X0, Y0, f, cylRadius, useFlatYaw);
            const [dxR] = evalYawFaceSurface(bx + featRx, by, effDeg, W, H, X0, Y0, f, cylRadius, useFlatYaw);
            const rawDelta = (dxR - dxL) / (2 * featRx);
            const isTrailing = s * (bx - X0) > featRx * 0.5;
            let sx: number;
            if (!useFlatYaw && isTrailing) {
              const cylL = cylinderYawDx(bx - X0 - featRx * 0.5, effDeg, cylRadius);
              const cylR = cylinderYawDx(bx - X0 + featRx * 0.5, effDeg, cylRadius);
              sx = 1 + Math.abs((cylR - cylL) / featRx);
            } else {
              sx = isTrailing ? 1 + Math.abs(rawDelta) : Math.max(0.2, 1 + rawDelta);
            }
            sx = pyRound(sx, 4);
            let dx: number;
            if (useFlatYaw) {
              dx = isTrailing
                ? (s > 0 ? dxR - featRx * (sx - 1) : dxL + featRx * (sx - 1))
                : 0.5 * (dxL + dxR);
            } else {
              const [dxCenter] = evalYawFaceSurface(bx, by, effDeg, W, H, X0, Y0, f, cylRadius, false);
              if (Math.abs(deg) > FACE_RATED_YAW_BAND) {
                const [plateLeftDx] = evalYawFaceSurface(X0 - W / 2, by, deg, W, H, X0, Y0, f, cylRadius, false);
                const [plateRightDx] = evalYawFaceSurface(X0 + W / 2, by, deg, W, H, X0, Y0, f, cylRadius, false);
                const plateMinX = X0 - W / 2 + plateLeftDx;
                const plateMaxX = X0 + W / 2 + plateRightDx;
                const minDx = Math.ceil((plateMinX - bx + featRx * sx - 1e-9) * 10000) / 10000;
                const maxDx = Math.floor((plateMaxX - bx - featRx * sx + 1e-9) * 10000) / 10000;
                dx = Math.max(minDx, Math.min(maxDx, dxCenter));
              } else {
                dx = dxCenter;
              }
            }
            if (tr.property === 'translatex') {
              vMap[bname] = [pyRound(dx, 4)];
            } else {
              vMap[bname] = [sx];
            }
          }
          return { t: k.t, v: vMap };
        });
      } else if (tr.group === 'ears' && tr.property === 'translatex' && earMembers.length > 0) {
        tr.keys = tr.keys.map((k) => {
          if (k.derive === undefined) return k;
          const deg = k.derive.degrees;
          if (deg === 0) return { t: k.t, v: [0] };
          const vMap: Record<string, number[]> = {};
          for (const bname of earMembers) {
            vMap[bname] = [evalDeriveKey(bname, k)];
          }
          return { t: k.t, v: vMap };
        });
      } else if ((tr.bone === 'ear_r' || tr.bone === 'ear_l') && tr.property === 'translatex') {
        const bname = tr.bone;
        tr.keys = tr.keys.map((k) => {
          if (k.derive === undefined) return k;
          const deg = k.derive.degrees;
          if (deg === 0) return { t: k.t, v: [0] };
          return { t: k.t, v: [evalDeriveKey(bname, k)] };
        });
      }
    }
    if (!hasAuthoredEarTurnTx) {
      for (const [earBone, earHx] of [
        ['ear_r', earRx],
        ['ear_l', earLx],
      ] as const) {
        if (!boneMap.has(earBone)) continue;
        turnAnim.tracks.push({
          bone: earBone,
          property: 'translatex',
          keys: refTurnKeys.map((k) => {
            const deg = k.derive?.degrees ?? 0;
            if (deg === 0) return { t: k.t, v: [0] };
            const [dxCheekEdge] = evalYawFaceSurface(earHx, hyEar, deg, W, H, X0, Y0, f, cylRadius, useFlatYaw);
            return { t: k.t, v: [pyRound(dxCheekEdge * f.turn_ear_x, 4)] };
          }),
        });
      }
    }
    for (const [tkBone, evalTkDx] of [
      ['bun_ctl', dxBunAt],
      ['hairpin', dxHairpinAt],
    ] as const) {
      if (!boneMap.has(tkBone)) continue;
      turnAnim.tracks.push({
        bone: tkBone,
        property: 'translatex',
        keys: refTurnKeys.map((k) => {
          const deg = k.derive?.degrees ?? 0;
          if (deg === 0) return { t: k.t, v: [0] };
          return { t: k.t, v: [pyRound(evalTkDx(deg), 4)] };
        }),
      });
    }
    // Issue #478: cloth chain roots parented to head on hair_back follow hair_back's counter-parallax fraction.
    for (const b of rig.bones) {
      if (b.parent === 'head' && b.name.startsWith('hairback_') && b.name.endsWith('_0')) {
        if (turnAnim.tracks.some((tr) => tr.bone === b.name && tr.property === 'translatex')) continue;
        turnAnim.tracks.push({
          bone: b.name,
          property: 'translatex',
          keys: refTurnKeys.map((k) => {
            const deg = k.derive?.degrees ?? 0;
            if (deg === 0) return { t: k.t, v: [0] };
            return { t: k.t, v: [pyRound(dxBackAt(deg), 4)] };
          }),
        });
      }
    }

    const turnDeform: DeformTimelineEntry[] = [
      {
        slot: 'face',
        attachment: 'face',
        keys: turnKeys.map(({ t, deg }) =>
          deg === 0 ? { t } : { t, vertices: expandToDeform(faceVerts, (v) => evalYawFaceSurface(v.hx, v.hy, deg, W, H, X0, Y0, f, cylRadius, useFlatYaw)) },
        ),
      },
    ];
    if (hairFrontVerts !== null) {
      turnDeform.push({
        slot: 'hair_front',
        attachment: 'hair_front',
        keys: turnKeys.map(({ t, deg }) =>
          deg === 0
            ? { t }
            : {
                t,
                vertices: expandToDeform(hairFrontVerts, (v) => {
                  const [dxSurf, dySurf] = evalYawFaceSurface(v.hx, v.hy, deg, W, H, X0, Y0, f, cylRadius, useFlatYaw);
                  const [bx, by] = getVertexBoneDelta(v, turnAnim.tracks, t);
                  const uBang = Math.max(0, Math.min(1, (v.hy - hyTurnBangBottom) / hyTurnBangSpan));
                  const bangParallaxX = (deg / 15) * pyRound(f.turn_bang_parallax_x * 15 * W, 8) * uBang;
                  const hyFrontCrownStart = Y0 + (36 / 128) * H;
                  const hyFrontCrownZero = Y0 + (60 / 128) * H;
                  const tCrown = Math.max(0, Math.min(1, (v.hy - hyFrontCrownStart) / (hyFrontCrownZero - hyFrontCrownStart)));
                  const wCrown = 1 - tCrown * tCrown * (3 - 2 * tCrown);
                  const absUx = Math.abs((v.hx - X0) / (W / 2));
                  const tLat = Math.max(0, Math.min(1, (absUx - 0.96) / (1.28 - 0.96)));
                  const wLat = 1 - tLat * tLat * (3 - 2 * tLat);
                  return [(bangParallaxX + dxSurf) * wCrown * wLat - bx, dySurf * wCrown * wLat - by];
                }),
              },
        ),
      });
    }
    if (hairBackVerts !== null) {
      turnDeform.push({
        slot: 'hair_back',
        attachment: 'hair_back',
        keys: turnKeys.map(({ t, deg }) =>
          deg === 0
            ? { t }
            : {
                t,
                vertices: expandToDeform(hairBackVerts, (v) => {
                  const [bx, by] = getVertexBoneDelta(v, turnAnim.tracks, t);
                  const [, dyCheek] = evalYawFaceSurface(v.hx, v.hy, deg, W, H, X0, Y0, f, cylRadius, useFlatYaw);
                  const uBun = Math.max(0, Math.min(1, (v.hy - hyCrown) / hyBunSpan));
                  const wBun =
                    (v.boneWeights.bun ?? 0) +
                    (v.boneWeights.bun_ctl ?? 0) +
                    (v.boneWeights.turn_hair_back_bun ?? 0) +
                    (v.boneWeights.turn_hair_back_bun_ctl ?? 0);
                  const wTopBun = Math.max(uBun, wBun);
                  const tCrown = Math.max(0, Math.min(1, (v.hy - hyCrownStart) / (hyCrownZero - hyCrownStart)));
                  const wCrown = 1 - tCrown * tCrown * (3 - 2 * tCrown);
                  const tCraniumY = Math.max(0, Math.min(1, (v.hy - (Y0 - (24 / 128) * H)) / ((32 / 128) * H)));
                  const absUx = Math.abs((v.hx - X0) / (W / 2));
                  const tLat = Math.max(0, Math.min(1, (absUx - 0.55) / (0.95 - 0.55)));
                  const wLatCranium = 1 - tCraniumY * (tLat * tLat * (3 - 2 * tLat));
                  const targetDx = (1 - wTopBun) * (dxBackAt(deg) * wCrown * wLatCranium) + wTopBun * dxBunAt(deg);
                  return [targetDx - bx, (1 - wTopBun) * dyCheek * wCrown - by];
                }),
              },
        ),
      });
    }
    if (hairpinVerts !== null) {
      turnDeform.push({
        slot: 'hairpin',
        attachment: 'hairpin',
        keys: turnKeys.map(({ t, deg }) =>
          deg === 0
            ? { t }
            : {
                t,
                vertices: expandToDeform(hairpinVerts, (v) => {
                  const [bx, by] = getVertexBoneDelta(v, turnAnim.tracks, t);
                  return [dxHairpinAt(deg) - bx, -by];
                }),
              },
        ),
      });
    }
    turnAnim.deform = turnDeform;
  }
}

/** Convert an 8-bit grey level `0..255` to a scalar depth in `[0, zScale]` using `ref.near` and `ref.zScale`. */
export function levelToDepthZ(level: number, ref: PartDepthReference): number {
  const u = ref.near === 'white' ? level / 255 : (255 - level) / 255;
  return u * ref.zScale;
}

/**
 * Sample a `'unit'` part's single scalar depth from its unpadded depth sheet
 * (`scalar`) over opaque art texels (`alpha >= 128`, falling back to `alpha > 0`).
 */
export function sampleUnitPartDepth(scalar: Raster, art: Raster, ref: PartDepthReference): number {
  const levels: number[] = [];
  const total = scalar.width * scalar.height;
  for (let i = 0; i < total; i++) {
    if (art.data[i * 4 + 3] >= 128) levels.push(scalar.data[i * 4]);
  }
  if (levels.length === 0) {
    for (let i = 0; i < total; i++) {
      if (art.data[i * 4 + 3] > 0) levels.push(scalar.data[i * 4]);
    }
  }
  if (levels.length === 0) return 0;
  levels.sort((a, b) => a - b);
  const mid = Math.floor(levels.length / 2);
  const medLevel = levels.length % 2 === 1 ? levels[mid] : 0.5 * (levels[mid - 1] + levels[mid]);
  return pyRound(levelToDepthZ(medLevel, ref), 4);
}

export interface Depth25DTurnOptions {
  turn: TurnSpec;
  parts: ReadonlyArray<{ name: string; x: number; y: number; w: number; h: number; depth?: PartDepthReference }>;
  images: ReadonlyMap<string, Raster>;
  regions: Readonly<Record<string, string | { bone: string; gather?: false }>>;
  stills: Readonly<Record<string, { row: number; bone: string }>>;
  boneLandmarks: ReadonlyMap<string, readonly [number, number]>;
  hasAlternateFaceSet: boolean;
  /** Existing weighted attachments; offsets are emitted per binding, never per UV. */
  surfaceMeshes?: ReadonlyArray<{
    part: string;
    slot: string;
    attachment: string;
    weights: ReadonlyArray<ReadonlyArray<{ bone: string; x: number; y: number; weight: number }>>;
    canvas: readonly [number, number];
    /** Existing setup topology resolves neighbour islands without a part-wide bbox. */
    triangles?: readonly number[];
    /** Core-generated grid sample positions, support only; never authored bindings. */
    gridSamples?: ReadonlyArray<readonly [number, number]>;
    /** Derived only from existing setup alpha overlap; never an authored switch. */
    overlapOwners?: ReadonlyArray<{ group: 'head' | 'body'; neighbours: readonly string[] } | undefined>;
    /** Every attachment of a part containing a blended mesh carries its own group mask. */
    groups?: ReadonlyMap<string, 'head' | 'body'>;
  }>;
  /** Final weighted unit/rear drawings are support only, never surface targets. */
  neighbourMeshes?: Depth25DTurnOptions['surfaceMeshes'];
}

interface Depth25DGroupSpec {
  fieldPrefix: 'config.turn' | 'config.turn.body';
  roles: Record<string, TurnRole>;
  pivot: number;
  counter: number;
  unitDepths?: Record<string, number>;
  carrierBone: string;
  rearCarrierBone: string;
  unitGroupName: string;
  useEyeLandmarksForZRef: boolean;
  checkEarBehindCheek: boolean;
  axes: ReadonlyArray<{
    kind: 'yaw' | 'pitch';
    animName: string;
    sliderName: string;
    dialBone: string;
    maxDeg: number;
  }>;
}

interface Depth25DTurnRig {
  bones: Array<{ name: string; parent?: string; x: number; y: number; rotation?: number; length?: number }>;
  slots: Array<{ name: string; bone: string; attachment: string | null }>;
  constraints?: Array<Record<string, unknown>>;
  stops?: ReadonlyArray<{ links: readonly string[] }>;
}

/** Stop draw bones share their link's setup frame; Core emits them later. */
function surfaceSetupGraph(rig: Depth25DTurnRig) {
  const aliases = new Map<string, string>();
  for (const stop of rig.stops ?? []) for (const link of stop.links) aliases.set(`${link}_d`, link);
  const resolve = (name: string): string => aliases.get(name) ?? name;
  // Like flattenRig: resolve parents as well as weights, without changing the rig.
  const bones = rig.bones.map(b => b.parent === undefined ? b : { ...b, parent: resolve(b.parent) });
  return { bones, resolve };
}

function buildDepth25DTurnGroup(
  rig: Depth25DTurnRig,
  motion: {
    groups?: Record<string, string[]>;
    animations: Record<string, unknown>;
  },
  opts: Depth25DTurnOptions,
  group: Depth25DGroupSpec,
  problems: Problem[],
): void {
  const { roles } = group;
  const partMap = new Map(opts.parts.map((p) => [p.name, p]));
  const startProblems = problems.length;

  // All turn-bound parts in the group that carry a depth sheet must share one near and one zScale.
  let sharedNear: PartDepthReference['near'] | null = null;
  let sharedZScale: number | null = null;
  let sharedFirstPart: string | null = null;
  for (const part of Object.keys(roles)) {
    const rec = partMap.get(part);
    if (rec?.depth === undefined) continue;
    if (sharedNear === null || sharedZScale === null) {
      sharedNear = rec.depth.near;
      sharedZScale = rec.depth.zScale;
      sharedFirstPart = part;
    } else if (rec.depth.near !== sharedNear || rec.depth.zScale !== sharedZScale) {
      problems.push({
        code: 'RIG_TURN_SHARED_DEPTH_SCALE',
        object: `parts.json part "${part}".depth`,
        detail: `states near="${rec.depth.near}", zScale=${rec.depth.zScale}, which disagrees with "${sharedFirstPart}" (near="${sharedNear}", zScale=${sharedZScale}); all parts bound to one 2.5D turn group must share one near polarity and one zScale so Core's sampled z values are in one coordinate space`,
      });
    }
  }

  // Prepare extended surface sheets and reference depths.
  const surfaceSheets = new Map<
    string,
    {
      rec: { name: string; x: number; y: number; w: number; h: number; depth: PartDepthReference };
      ext: Raster;
      zRef: number;
    }
  >();
  for (const [part, role] of Object.entries(roles)) {
    if (role !== 'surface') continue;
    const rec = partMap.get(part);
    const art = opts.images.get(part);
    const scalar = rec?.depth === undefined ? undefined : opts.images.get(rec.depth.image);
    if (rec === undefined || rec.depth === undefined || art === undefined || scalar === undefined) {
      problems.push({
        code: 'RIG_TURN_SURFACE_DEPTH_REQUIRED',
        object: `${group.fieldPrefix}.roles.${part}`,
        detail: `declares role "surface" for "${part}", which requires a depth sheet in parts.json; run assemble with config.depth or provide "${part}_depth.png"`,
      });
      continue;
    }
    const ext = extendDepthSilhouette(scalar, art);
    const padX = Math.floor((ext.width - rec.w) / 2);
    const padY = Math.floor((ext.height - rec.h) / 2);
    const sampleExtAtCrop = (cx: number, cy: number): number => {
      const lx = Math.max(0, Math.min(ext.width - 1, Math.round(cx - rec.x + padX)));
      const ly = Math.max(0, Math.min(ext.height - 1, Math.round(cy - rec.y + padY)));
      return levelToDepthZ(ext.data[(ly * ext.width + lx) * 4], rec.depth as PartDepthReference);
    };
    const eyeR = group.useEyeLandmarksForZRef ? opts.boneLandmarks.get('eye_r') : undefined;
    const eyeL = group.useEyeLandmarksForZRef ? opts.boneLandmarks.get('eye_l') : undefined;
    let zRef: number;
    if (eyeR !== undefined && eyeL !== undefined) {
      zRef = pyRound(0.5 * (sampleExtAtCrop(eyeR[0], eyeR[1]) + sampleExtAtCrop(eyeL[0], eyeL[1])), 4);
    } else {
      zRef = sampleUnitPartDepth(ext, art, rec.depth);
    }
    surfaceSheets.set(part, { rec: rec as { name: string; x: number; y: number; w: number; h: number; depth: PartDepthReference }, ext, zRef });
  }
  if (problems.length > startProblems) return;

  const primarySurface = (group.useEyeLandmarksForZRef ? surfaceSheets.get('face') : undefined) ?? [...surfaceSheets.values()][0];
  const pivot = pyRound(group.pivot, 4);
  const counter = group.counter;
  const rearDepth = pyRound(-counter * pivot, 4);
  const hasRear = Object.values(roles).includes('rear');

  // Collect unit bones that sit directly under carrierBone and resolve one scalar depth per unit bone.
  const carrierChildren = new Set(rig.bones.filter((b) => b.parent === group.carrierBone).map((b) => b.name));
  const unitDepthMap: Record<string, number> = {};
  const unitBones: string[] = [];
  const addUnitBone = (bone: string, depth: number): void => {
    if (!carrierChildren.has(bone)) return;
    if (!unitBones.includes(bone)) unitBones.push(bone);
    unitDepthMap[bone] = pyRound(depth, 4);
  };

  for (const [part, role] of Object.entries(roles)) {
    if (role !== 'unit') continue;
    const regSpec = opts.regions[part];
    let baseBone: string | undefined;
    let candidateBones: string[] = [];
    if (regSpec !== undefined) {
      baseBone = typeof regSpec === 'string' ? regSpec : regSpec.bone;
      const stillBone = opts.stills[part]?.bone;
      candidateBones = [baseBone, ...(stillBone === undefined ? [] : [stillBone])].filter((b) => carrierChildren.has(b));
    } else {
      const uBone = turnUnitBone(part);
      if (carrierChildren.has(uBone)) candidateBones = [uBone];
    }
    if (candidateBones.length === 0) continue;

    for (const bName of candidateBones) {
      const explicitPartDepth = group.unitDepths?.[part];
      const explicitBoneDepth = group.unitDepths?.[bName];
      let resolved: number | null = null;
      if (typeof explicitPartDepth === 'number' && Number.isFinite(explicitPartDepth)) {
        resolved = explicitPartDepth;
      } else if (typeof explicitBoneDepth === 'number' && Number.isFinite(explicitBoneDepth)) {
        resolved = explicitBoneDepth;
      } else if (primarySurface !== undefined) {
        let pt: readonly [number, number] | undefined =
          opts.boneLandmarks.get(bName) ??
          (baseBone === undefined ? undefined : opts.boneLandmarks.get(baseBone));
        if (pt === undefined && regSpec === undefined) {
          const childPts: Array<readonly [number, number]> = [];
          for (const child of rig.bones) {
            if (child.parent !== bName) continue;
            const bare = child.name.endsWith('_ctl') ? child.name.slice(0, -4) : child.name;
            const cp = opts.boneLandmarks.get(child.name) ?? opts.boneLandmarks.get(bare);
            if (cp !== undefined) childPts.push(cp);
          }
          if (childPts.length > 0) {
            const sx = childPts.reduce((acc, p) => acc + p[0], 0) / childPts.length;
            const sy = childPts.reduce((acc, p) => acc + p[1], 0) / childPts.length;
            pt = [sx, sy];
          } else {
            const partRec = partMap.get(part);
            if (partRec !== undefined) pt = [partRec.x + partRec.w / 2, partRec.y + partRec.h / 2];
          }
        }
        if (pt !== undefined) {
          const { rec, ext, zRef } = primarySurface;
          const padX = Math.floor((ext.width - rec.w) / 2);
          const padY = Math.floor((ext.height - rec.h) / 2);
          const lx = Math.max(0, Math.min(ext.width - 1, Math.round(pt[0] - rec.x + padX)));
          const ly = Math.max(0, Math.min(ext.height - 1, Math.round(pt[1] - rec.y + padY)));
          const zUnit = levelToDepthZ(ext.data[(ly * ext.width + lx) * 4], rec.depth);
          resolved = pyRound(pivot + (zUnit - zRef), 4);
        }
      }
      if (resolved === null) {
        const rec = partMap.get(part);
        const art = opts.images.get(part);
        const scalar = rec?.depth === undefined ? undefined : opts.images.get(rec.depth.image);
        if (rec?.depth !== undefined && art !== undefined && scalar !== undefined) {
          resolved = sampleUnitPartDepth(scalar, art, rec.depth);
        }
      }
      if (resolved === null) {
        problems.push({
          code: 'RIG_TURN_UNIT_DEPTH_REQUIRED',
          object: `${group.fieldPrefix}.roles.${part}`,
          detail: `declares role "unit" for "${part}" (bone "${bName}"), and neither a surface depth sheet nor a part depth sheet nor ${group.fieldPrefix}.unitDepths.${part} provides its depth`,
        });
        continue;
      }
      if (group.checkEarBehindCheek && (bName === 'ear_r' || bName === 'ear_l') && primarySurface !== undefined) {
        const pt = opts.boneLandmarks.get(bName);
        if (pt !== undefined) {
          const { rec, ext, zRef } = primarySurface;
          const padX = Math.floor((ext.width - rec.w) / 2);
          const padY = Math.floor((ext.height - rec.h) / 2);
          const cheekX = pt[0] < rec.x + rec.w / 2 ? 0 : ext.width - 1;
          const cheekY = Math.max(0, Math.min(ext.height - 1, Math.round(pt[1] - rec.y + padY)));
          const cheekDepth = pyRound(pivot + (levelToDepthZ(ext.data[(cheekY * ext.width + cheekX) * 4], rec.depth) - zRef), 4);
          if (resolved > cheekDepth) {
            problems.push({
              code: 'RIG_TURN_EAR_DEPTH_BEHIND_CHEEK',
              object: `${group.fieldPrefix}.unitDepths.${part}`,
              detail: `places "${bName}" at depth ${pyRound(resolved, 4)}, which is in front of the adjacent cheek edge (${cheekDepth}); an ear depth at or behind ${cheekDepth} is required so the ear recedes behind the cheek`,
            });
            continue;
          }
        }
      }
      addUnitBone(bName, resolved);
    }
  }
  if (problems.length > startProblems) return;

  // Order unitBones in rig.bones declaration order for determinism.
  const boneIndex = new Map(rig.bones.map((b, i) => [b.name, i]));
  unitBones.sort((a, b) => (boneIndex.get(a) ?? 0) - (boneIndex.get(b) ?? 0));
  const orderedUnitDepthMap: Record<string, number> = {};
  for (const b of unitBones) orderedUnitDepthMap[b] = unitDepthMap[b];

  if (unitBones.length > 0) {
    motion.groups ??= {};
    motion.groups[group.unitGroupName] = unitBones;
  }

  const buildAxisAnim = (kind: 'yaw' | 'pitch', animName: string, maxDeg: number): void => {
    const prop = kind === 'yaw' ? 'translatex' : 'translatey';
    const duration = pyRound(2 * maxDeg * TURN_DIAL_SCALE, 6);
    const step = maxDeg / 2;
    const angles = [-maxDeg, -step, 0, step, maxDeg];
    const keyList = angles.map((deg) => ({
      t: pyRound((deg + maxDeg) * TURN_DIAL_SCALE, 6),
      deg: pyRound(deg, 6),
    }));

    const tracks: Array<{
      bone?: string;
      group?: string;
      property: string;
      keys: Array<{
        t: number;
        v?: number[] | Record<string, number[]>;
        derive?: {
          kind: 'yaw' | 'pitch';
          degrees: number;
          about?: number;
          carried?: number;
          depth?: number | Record<string, number>;
          narrowing?: boolean;
        };
      }>;
    }> = [
      {
        bone: group.carrierBone,
        property: prop,
        keys: keyList.map(({ t, deg }) =>
          deg === 0
            ? { t, v: [0] }
            : { t, derive: { kind, degrees: deg, depth: pivot, narrowing: false } },
        ),
      },
    ];
    if (hasRear && rearDepth !== 0) {
      tracks.push({
        bone: group.rearCarrierBone,
        property: prop,
        keys: keyList.map(({ t, deg }) =>
          deg === 0
            ? { t, v: [0] }
            : { t, derive: { kind, degrees: deg, depth: rearDepth, narrowing: false } },
        ),
      });
    }
    for (const [part, { zRef }] of surfaceSheets) {
      if (opts.surfaceMeshes?.some((m) => m.part === part)) continue;
      const surfShift = pyRound(-zRef, 4);
      if (surfShift !== 0) {
        tracks.push({
          bone: turnSurfaceBone(part),
          property: prop,
          keys: keyList.map(({ t, deg }) =>
            deg === 0
              ? { t, v: [0] }
              : { t, derive: { kind, degrees: deg, depth: surfShift, narrowing: false } },
          ),
        });
      }
    }
    if (unitBones.length > 0) {
      tracks.push({
        group: group.unitGroupName,
        property: prop,
        keys: keyList.map(({ t, deg }) =>
          deg === 0
            ? { t, v: [0] }
            : {
                t,
                derive: {
                  kind,
                  degrees: deg,
                  carried: pivot,
                  depth: { ...orderedUnitDepthMap },
                  narrowing: false,
                },
              },
        ),
      });
    }

    const deform: Array<{
      slot: string;
      attachment: string;
      keys: Array<{
        t: number;
        vertices?: number[];
        transform?: {
          kind: 'yaw' | 'pitch';
          degrees: number;
          depth?: boolean;
          narrowing?: boolean;
        };
      }>;
    }> = [];
    for (const [part, { rec, ext, zRef }] of surfaceSheets) {
      const authored = opts.surfaceMeshes?.filter((m) => m.part === part) ?? [];
      if (authored.length > 0) {
        const setup = surfaceSetupGraph(rig);
        const world = computeWorldTransforms(setup.bones);
        for (const mesh of authored) {
          // An all-zero timeline can overwrite another slider's deform (Core A40).
          // A sibling with no positive binding in this group owns no timeline here.
          const field = group.fieldPrefix === 'config.turn' ? 'head' : 'body';
          const active = mesh.groups === undefined || mesh.weights.some((row, i) => row.some(w => w.weight > 0 && (mesh.overlapOwners?.[i] === undefined ? mesh.groups?.get(w.bone) === field : mesh.overlapOwners[i]?.group === field)));
          const vertices = mesh.weights.map((row, index) => {
            let wx = 0, wy = 0, total = 0;
            for (const w of row) {
              const frame = world.get(setup.resolve(w.bone));
              if (frame === undefined) {
                problems.push({ code: 'RIG_TURN_SURFACE_MESH_BINDINGS', object: `surface mesh "${mesh.slot}/${mesh.attachment}" vertex ${index}`, detail: `names missing bone "${w.bone}"; every influence must resolve in the final setup` });
                continue;
              }
              // A unit/rear mesh sharing this root would move our bindings too.
              let ancestor = setup.bones.find((b) => b.name === setup.resolve(w.bone));
              while (ancestor !== undefined) {
                if ([FACESHIFT_BONE, REAR_SHIFT_BONE, BODYSHIFT_BONE, BODY_REAR_SHIFT_BONE].includes(ancestor.name)) {
                  problems.push({ code: 'RIG_TURN_SURFACE_MESH_BINDINGS', object: `${group.fieldPrefix}.roles.${part}`, detail: `binds "${w.bone}" through turn carrier "${ancestor.name}" shared with another role; surface mesh bindings must retain their authored frame` });
                  break;
                }
                ancestor = setup.bones.find((b) => b.name === ancestor?.parent);
              }
              const [x, y] = toWorld(frame, w.x, w.y);
              wx += x * w.weight; wy += y * w.weight; total += w.weight;
            }
            if (!Number.isFinite(total) || Math.abs(total - 1) > 0.0001) {
              problems.push({ code: 'RIG_TURN_SURFACE_MESH_BINDINGS', object: `surface mesh "${mesh.slot}/${mesh.attachment}" vertex ${index}`, detail: `has influence sum ${total}; weights closing at 1 are required to sample a setup position` });
            }
            const [cx, cy] = setupToPaintingPoint([wx, wy], mesh.canvas, mesh.canvas);
            const z = levelToDepthZ(sampleDepthFloat(ext, cx - rec.x, cy - rec.y), rec.depth);
            return { row, depth: pivot + z - zRef };
          });
          if (problems.length > startProblems || !active) continue;
          deform.push({
            slot: mesh.slot,
            attachment: mesh.attachment,
            keys: keyList.map(({ t, deg }) => deg === 0 ? { t } : {
              t,
              // Spine's weighted deform is one bind-space pair per influence.
              // Do not multiply by weight: the runtime performs that sum once.
              vertices: vertices.flatMap(({ row, depth }) => {
                const d = -depth * Math.sin(deg * Math.PI / 180);
                return row.flatMap((w) => {
                  if (mesh.groups !== undefined && (w.weight === 0 || mesh.groups.get(w.bone) !== field)) return [0, 0];
                  const frame = world.get(setup.resolve(w.bone))!; // every influence resolved before emitting keys
                  const [x, y] = toBoneLocalVector(frame, kind === 'yaw' ? d : 0, kind === 'pitch' ? d : 0);
                  return [pyRound(x, 6), pyRound(y, 6)];
                });
              }),
            }),
          });
        }
        continue;
      }
      deform.push({
        slot: part,
        attachment: part,
        keys: keyList.map(({ t, deg }) =>
          deg === 0
            ? { t }
            : {
                t,
                transform: {
                  kind,
                  degrees: deg,
                  depth: true,
                  narrowing: false,
                },
              },
        ),
      });
    }

    // Snapshot the emitted fields BEFORE any overlap target is rewritten.
    // Mixed targets never become another target's source by traversal order.
    if (opts.surfaceMeshes?.some(m => m.overlapOwners !== undefined)) {
      const setup = surfaceSetupGraph(rig), world = computeWorldTransforms(setup.bones);
      const parents = new Map(setup.bones.map(b => [b.name, b.parent]));
      const field = group.fieldPrefix === 'config.turn' ? 'head' : 'body';
      const supports = [...(opts.surfaceMeshes ?? []), ...(opts.neighbourMeshes ?? [])];
      const raw = deform.map(d => ({ ...d, keys: d.keys.map(k => ({ ...k, vertices: k.vertices?.slice() })) }));
      const points = (mesh: typeof supports[number]) => mesh.weights.map(row => {
        let x = 0, y = 0;
        for (const w of row) { const frame = world.get(setup.resolve(w.bone)); if (frame === undefined) return [NaN, NaN]; const q = toWorld(frame, w.x, w.y); x += q[0] * w.weight; y += q[1] * w.weight; }
        return [x, y];
      });
      for (const [ki, { deg }] of keyList.entries()) {
        if (deg === 0) continue;
        // All tracks this producer emits are local translations. Sum their
        // actual emitted world vectors along each binding's ancestor chain.
        const translations = new Map<string, [number, number]>();
        for (const track of tracks) {
          const names = track.bone === undefined ? motion.groups?.[track.group!] : [track.bone];
          if (names === undefined) { problems.push({ code: 'RIG_TURN_SURFACE_OVERLAP_SUPPORT', object: `animation "${animName}"`, detail: `emitted group "${track.group}" has no resolved bones; an unresolved track is not a zero field` }); continue; }
          for (const bone of names) {
          const key = track.keys[ki], derived = key.derive;
          const depth = typeof derived?.depth === 'number' ? derived.depth : derived?.depth?.[bone];
          const stated = Array.isArray(key.v) ? key.v[0] : depth === undefined ? undefined : -(depth - (derived?.carried ?? 0)) * Math.sin(deg * Math.PI / 180);
          if (stated === undefined || !Number.isFinite(stated)) { problems.push({ code: 'RIG_TURN_SURFACE_OVERLAP_SUPPORT', object: `animation "${animName}" bone "${bone}"`, detail: 'has no finite emitted translation; unresolved depth is not replaced by zero' }); continue; }
          const value = f32(stated);
          const parent = parents.get(bone), frame = parent === undefined ? undefined : world.get(setup.resolve(parent));
          if (parent !== undefined && frame === undefined) { problems.push({ code: 'RIG_TURN_SURFACE_OVERLAP_SUPPORT', object: `animation "${animName}" bone "${bone}"`, detail: `has no resolved parent frame "${parent}"; supply its setup transform` }); continue; }
          translations.set(bone, frame === undefined ? [track.property === 'translatex' ? value : 0, track.property === 'translatey' ? value : 0]
            : track.property === 'translatex' ? [frame.a * value, frame.c * value] : [frame.b * value, frame.d * value]);
          }
        }
        const carried = (bone: string): [number, number] => {
          let x = 0, y = 0; const seen = new Set<string>();
          for (let b: string | undefined = setup.resolve(bone); b !== undefined && !seen.has(b); b = parents.get(b)) { seen.add(b); const v = translations.get(b); if (v !== undefined) { x += v[0]; y += v[1]; } }
          return [x, y];
        };
        const snapshots = supports.filter(m => roles[m.part] !== undefined && (m.groups === undefined || [...m.groups.values()].includes(field))).map(mesh => {
          const positions = points(mesh), key = raw.find(d => d.slot === mesh.slot && d.attachment === mesh.attachment)?.keys[ki];
          let generated: number[] | undefined;
          if (key?.transform !== undefined && mesh.gridSamples !== undefined) {
            const sheet = surfaceSheets.get(mesh.part);
            if (sheet !== undefined) generated = evaluateDeformTransform(key.transform, positions.flat(), f32, `turn neighbour "${mesh.slot}/${mesh.attachment}"`, mesh.gridSamples.map(([x, y]) => levelToDepthZ(sampleDepthFloat(sheet.ext, x - sheet.rec.x, y - sheet.rec.y), sheet.rec.depth))).offsets;
          }
          let at = 0;
          const vectors = mesh.weights.map((row, vi) => {
            let x = 0, y = 0;
            for (const w of row) {
              const frame = world.get(setup.resolve(w.bone));
              if (frame === undefined) return [NaN, NaN];
              const v = generated === undefined ? [key?.vertices?.[at], key?.vertices?.[at + 1]] : toBoneLocalVector(frame, generated[2 * vi], generated[2 * vi + 1]);
              // Surface fields require an emitted vertex run (or Core's grid
              // transform); absence is never interpreted as target depth.
              if (roles[mesh.part] === 'surface' && (v[0] === undefined || v[1] === undefined)) return [NaN, NaN];
              const dx = f32(v[0] ?? 0), dy = f32(v[1] ?? 0), c = carried(w.bone);
              x += (frame.a * dx + frame.b * dy + c[0]) * w.weight;
              y += (frame.c * dx + frame.d * dy + c[1]) * w.weight; at += 2;
            }
            return [x, y];
          });
          return { mesh, label: `${mesh.part}/${mesh.slot}/${mesh.attachment}`, points: positions, triangles: mesh.triangles ?? [], vectors };
        });
        for (const mesh of opts.surfaceMeshes ?? []) {
          if (mesh.overlapOwners === undefined) continue;
          const target = deform.find(d => d.slot === mesh.slot && d.attachment === mesh.attachment)?.keys[ki];
          if (target?.vertices === undefined) continue;
          let at = 0; const positions = points(mesh);
          for (const [vi, row] of mesh.weights.entries()) {
            const owner = mesh.overlapOwners[vi];
            if (owner === undefined) { at += 2 * row.length; continue; }
            const encode = (v: readonly number[]) => row.flatMap(w => { if (w.weight === 0) return [0, 0]; const q = toBoneLocalVector(world.get(setup.resolve(w.bone))!, v[0], v[1]); return q.map(n => pyRound(n, 6)); });
            let values: number[] = Array<number>(2 * row.length).fill(0);
            if (owner.group === field) {
              const samples: Array<{ name: string; values: number[] }> = [];
              for (const name of owner.neighbours) {
                const candidates = snapshots.filter(s => s.mesh.part === name), point = positions[vi];
                const covering = candidates.filter(s => turnTriangleCoordinates(s.points, s.triangles, point[0], point[1]) !== null);
                const chosen = covering.length === 0 ? candidates.slice(0, 1) : covering;
                if (chosen.length === 0) problems.push({ code: 'RIG_TURN_SURFACE_OVERLAP_SUPPORT', object: `surface mesh "${mesh.slot}/${mesh.attachment}" vertex ${vi}`, detail: `selected neighbour "${name}" has no existing triangle field; supply actual setup support; target depth is not a fallback` });
                for (const source of chosen) {
                  try { samples.push({ name: source.label, values: encode(sampleTurnTriangleField(source, point, `surface mesh "${mesh.slot}/${mesh.attachment}" vertex ${vi}`)) }); }
                  catch (e) { if (e instanceof PartsError) problems.push(...e.problems); else throw e; }
                }
              }
              if (samples.length > 0) {
                values = samples[0].values;
                if (samples.some(s => s.values.some((v, i) => v !== values[i]))) problems.push({ code: 'RIG_TURN_SURFACE_OVERLAP_DEPTH', object: `surface mesh "${mesh.slot}/${mesh.attachment}" vertex ${vi}`, detail: `neighbours ${samples.map(s => `"${s.name}"`).join(', ')} require incompatible emitted fields at this setup point; separate the conflicting support or supply coincident fields` });
              }
            }
            target.vertices.splice(at, 2 * row.length, ...values); at += 2 * row.length;
          }
        }
      }
      for (let i = deform.length - 1; i >= 0; i--) if (opts.surfaceMeshes.some(m => m.slot === deform[i].slot && m.attachment === deform[i].attachment && m.overlapOwners !== undefined) && deform[i].keys.every(k => k.vertices === undefined || k.vertices.every(v => v === 0))) deform.splice(i, 1);
    }

    motion.animations[animName] = {
      duration,
      loop: false,
      tracks,
      ...(deform.length > 0 ? { deform } : {}),
    };
  };

  rig.constraints ??= [];
  const upsertSlider = (name: string, animName: string, dialBone: string, maxDeg: number): void => {
    const colliding = rig.constraints?.find((c) => c.type === 'slider' && c.name === name && c.animation !== animName);
    if (colliding !== undefined) {
      problems.push({
        code: 'CONFIG_TURN_SLIDER_NAME_FREE',
        object: `${group.fieldPrefix}.slider`,
        detail: `is "${name}", which collides with an existing slider constraint "${name}"; choose a distinct slider name`,
      });
      return;
    }
    const existing = rig.constraints?.find((c) => c.type === 'slider' && c.animation === animName);
    if (existing !== undefined) {
      existing.bone = dialBone;
      existing.property = 'rotate';
      existing.from = -maxDeg;
      existing.to = 0;
      existing.scale = TURN_DIAL_SCALE;
      existing.max = maxDeg;
      existing.local = true;
      existing.additive = true;
      existing.mix = 1;
    } else {
      rig.constraints?.push({
        name,
        type: 'slider',
        animation: animName,
        bone: dialBone,
        property: 'rotate',
        from: -maxDeg,
        to: 0,
        scale: TURN_DIAL_SCALE,
        max: maxDeg,
        local: true,
        additive: true,
        mix: 1,
      });
    }
  };

  for (const axis of group.axes) {
    buildAxisAnim(axis.kind, axis.animName, axis.maxDeg);
    upsertSlider(axis.sliderName, axis.animName, axis.dialBone, axis.maxDeg);
  }
}

/**
 * Issues #763 & #787: build the 2.5D head-turn (`turn`, `tilt`) and optional
 * body-turn (`body_turn`) animations and slider constraints using Core's native
 * `derive` and `deform` `transform` (`depth: true, narrowing: false`).
 */
export function buildDepth25DTurn(
  rig: Depth25DTurnRig,
  motion: {
    groups?: Record<string, string[]>;
    animations: Record<string, unknown>;
  },
  opts: Depth25DTurnOptions,
): void {
  const problems: Problem[] = [];
  const { yaw: yawMax, pitch: pitchMax } = resolveTurnBands(opts.turn);
  // Ownership is derived here, never accepted as an authored producer switch.
  opts = { ...opts, surfaceMeshes: opts.surfaceMeshes?.map(({ overlapOwners: _owners, groups: _groups, ...mesh }) => mesh) };

  // Only a surface opt-in spanning both authored subtrees changes paths (#796).
  // Single-group meshes keep #795's role and bytes, including explicit islands.
  const setup = surfaceSetupGraph(rig);
  const parents = new Map(setup.bones.map((b) => [b.name, b.parent]));
  const bodyRoot = opts.turn.body?.bone ?? (parents.has('chest') ? 'chest' : 'hip');
  const descends = (bone: string, root: string): boolean => {
    const seen = new Set<string>();
    for (let cur: string | undefined = setup.resolve(bone); cur !== undefined && !seen.has(cur); cur = parents.get(cur)) {
      if (cur === root) return true;
      seen.add(cur);
    }
    return false;
  };
  const blended = new Set<string>();
  const classified = opts.surfaceMeshes?.map((mesh) => {
    const groups = new Map<string, 'head' | 'body'>();
    const outside = new Set<string>();
    for (const w of mesh.weights.flat()) {
      if (w.weight <= 0) continue;
      if (descends(w.bone, 'head')) groups.set(w.bone, 'head');
      else if (descends(w.bone, bodyRoot)) groups.set(w.bone, 'body');
      else outside.add(w.bone);
    }
    if (new Set(groups.values()).size === 2) blended.add(mesh.part);
    return { mesh, groups, outside };
  });
  // A part's role covers every island, but each attachment keeps its own mask.
  // Without a blended attachment the explicit role still owns the legacy path.
  const surfaceMeshes = classified?.map(({ mesh, groups, outside }) => {
    if (!blended.has(mesh.part)) return mesh;
    if (opts.turn.roles === undefined || opts.turn.body === undefined || outside.size > 0 || descends(bodyRoot, 'head')) {
      problems.push({
        code: 'RIG_TURN_SURFACE_MESH_GROUPS', object: `surface mesh "${mesh.slot}/${mesh.attachment}"`,
        detail: `belongs to a part with blended head and body bindings${outside.size === 0 ? '' : ` with ungrouped bone(s) ${[...outside].map(b => `"${b}"`).join(', ')}`}; declare both config.turn.roles and config.turn.body with a body root outside head, and bind every influence to one of those subtrees`,
      });
      return mesh;
    }
    // A second declaration cannot ask the same attachment to be both a sampled
    // surface and a unit/rear carrier. No binding is reparented here.
    const roles = [opts.turn.roles[mesh.part], opts.turn.body.roles[mesh.part]];
    if (roles.some(role => role !== undefined && role !== 'surface')) {
      problems.push({ code: 'RIG_TURN_SURFACE_MESH_GROUPS', object: `surface mesh "${mesh.slot}/${mesh.attachment}"`, detail: 'declares a unit/rear role as well as surface across the head and body groups; declare surface in one or both groups so its authored frames are retained' });
      return mesh;
    }
    return { ...mesh, groups };
  });
  refuseIfAny(problems);
  if (blended.size > 0) {
    const owners = turnOverlapOwners(rig, opts, classified ?? [], blended, problems);
    refuseIfAny(problems);
    const overlapped = surfaceMeshes?.map((mesh, i) => {
      const overlapOwners = owners.get(classified![i].mesh);
      return overlapOwners === undefined ? mesh : { ...mesh, overlapOwners };
    });
    const surfaceRoles = Object.fromEntries([...blended].map(part => [part, 'surface' as const]));
    opts = { ...opts, surfaceMeshes: overlapped, turn: { ...opts.turn,
      roles: { ...opts.turn.roles, ...surfaceRoles },
      body: { ...opts.turn.body!, roles: { ...opts.turn.body!.roles, ...surfaceRoles } },
    } };
  }

  if (opts.turn.roles !== undefined) {
    buildDepth25DTurnGroup(
      rig,
      motion,
      opts,
      {
        fieldPrefix: 'config.turn',
        roles: opts.turn.roles,
        pivot: opts.turn.pivot ?? DEFAULT_TURN_PIVOT_25D,
        counter: opts.turn.counter ?? DEFAULT_TURN_COUNTER_25D,
        unitDepths: opts.turn.unitDepths,
        carrierBone: FACESHIFT_BONE,
        rearCarrierBone: REAR_SHIFT_BONE,
        unitGroupName: 'turn_units',
        useEyeLandmarksForZRef: true,
        checkEarBehindCheek: true,
        axes: [
          { kind: 'yaw', animName: 'turn', sliderName: 'yaw', dialBone: YAW_DIAL_BONE, maxDeg: yawMax },
          { kind: 'pitch', animName: 'tilt', sliderName: 'pitch', dialBone: PITCH_DIAL_BONE, maxDeg: pitchMax },
        ],
      },
      problems,
    );
  }

  if (opts.turn.body !== undefined) {
    const body = opts.turn.body;
    const bodySlider = typeof body.slider === 'string' && body.slider.trim().length > 0 ? body.slider : BODY_YAW_DIAL_BONE;
    buildDepth25DTurnGroup(
      rig,
      motion,
      opts,
      {
        fieldPrefix: 'config.turn.body',
        roles: body.roles,
        pivot: body.pivot ?? opts.turn.pivot ?? DEFAULT_TURN_PIVOT_25D,
        counter: body.counter ?? opts.turn.counter ?? DEFAULT_TURN_COUNTER_25D,
        unitDepths: body.unitDepths ?? opts.turn.unitDepths,
        carrierBone: BODYSHIFT_BONE,
        rearCarrierBone: BODY_REAR_SHIFT_BONE,
        unitGroupName: 'body_turn_units',
        useEyeLandmarksForZRef: false,
        checkEarBehindCheek: false,
        axes: [
          { kind: 'yaw', animName: BODY_TURN_ANIM, sliderName: bodySlider, dialBone: bodySlider, maxDeg: yawMax },
        ],
      },
      problems,
    );
  }

  refuseIfAny(problems);
}
