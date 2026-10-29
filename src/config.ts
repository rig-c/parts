import { baseAnchorProblems, type BaseAnchor } from './baseanchor.ts';
import type { DepthConfig } from './depthsheets.ts';
/**
 * The character config: everything character-specific the CPU stages read,
 * plus the optional blocks for the two GPU stages.
 *
 * One file per character, filled in as the loop runs. What a step requires is
 * what that step reads, and {@link CONFIG_REQUIRES} states it once per loader:
 * the full loader, in front of `rig` and `build`, requires `key`, `assemble`,
 * `bones`, `meshes`, `regions` and `motion`; the early doors, in front of the
 * steps that run before `propose` has drafted the rig, require less.
 * `generation` is read only by the optional image-generation adapter; a
 * character whose painting came from anywhere else leaves it out.
 *
 * 🔒 **Every key is known or refused.** An unknown key is refused by name and
 * so is a missing one — a config that half-loads is a rig nobody can reason
 * about. There are two open doors, and both lead nowhere — nothing reads what
 * stands behind them. Annotation: `note`, and any key ending in `_note`, may
 * hold a string anywhere an object is expected. Annotations are how a hand
 * correction records its reason beside the value it corrected, and refusing
 * them would push that reason out of the file. Record: any key beginning with
 * `x-` and at least one character after it may hold any JSON value in the same
 * places (issue #70) — a project's own provenance, such as the gate results of
 * a past build or the seeds a search rejected, kept beside the conditions that
 * made the rig. The record test comes first, so `x-seed_note` is a record. The
 * part-name maps (`meshes`, `regions`, `motion.blink.still`) are not objects
 * in this sense: their keys are part names, and an `x-` key there is a part
 * name like any other. No stage writes a vouched object whole into an output;
 * each writer names its fields (`resolvedSampler` and its kin in
 * `src/graphs.ts`), which is what keeps both doors read by nothing.
 *
 * ⛔ **The generation block is inline.** Configs written for the private
 * reference pointed at a character file and an art-job id elsewhere
 * (`generation.character_file`, `generation.art_job`) and overrode parts of it
 * (`identity_override`, `lora_strength`). None of that resolves outside the
 * tree it was written in, so each of those keys is refused with a message that
 * names what replaces it, rather than as a bare unknown.
 *
 * Coordinates in `bones`, `meshes` and `motion` are RIG pixels, y down, origin
 * top-left — the parts' own space. The y flip to Spine happens once, in
 * `rig-c/src/transform.ts` (see `src/coords.ts`), when the rig is built.
 *
 * 🔗 **`constraints` is rig-c's, verbatim (issue #92).** An optional list
 * of constraint objects in rig-c's own rig-spec shape (`RigConstraint`:
 * `ik`, `transform`, `path`, `physics`, `slider`), handed to rigc as
 * `rig.json`'s `constraints` in the order written. The loader owns four things
 * and nothing else: the list is a list of objects; each has a `type` rigc's
 * union names and a non-empty `name`, unique within its kind (rigc's identity
 * of a constraint is its kind and its name); every bone a constraint names
 * — the fields {@link CONSTRAINT_BONE_FIELDS} lists, read off rigc's
 * `buildRigConstraint` — is a bone `bones` declares; and a bone a constraint
 * follows does not move with the bones it drives ({@link checkConstraints}).
 * Every other field, its type and its range — an ik's `bones` as a shape
 * included (rig-c 2.15.0, issue #103) — are rigc's to refuse, at the rig
 * stage's gate, in rigc's words. A record
 * (`x-…`) and an annotation (`note`, `…_note`) ride on a constraint as on any
 * object the loader vouches for, and the rig stage leaves them out of what it
 * hands rigc ({@link constraintForRig}).
 *
 * 🧭 **`turn` is this package's (issue #251, `src/turn.ts`).** An optional
 * `{pivot, depths}`: each carried part's See-through `depth_median` and the
 * depth that stays put, both stated — `propose --full/--head` drafts them —
 * from which the rig stage derives every fraction ({@link checkTurn}).
 *
 * 🖼️ **`scene` declares the painting a scene (issue #242).** An optional
 * object, `{}` today: the painting holds the figure and its surroundings (a
 * room, a ground), and See-through's full run holds only the figure. With it,
 * `assemble` reads the recomposite inside the figure and writes the figure's
 * mask, and `check` reads `RECOMPOSITE_HOLES` and the seam that way too, each
 * line saying so first (`src/assemble.ts`, `sceneFigure`). It takes no field
 * because nothing in it is the author's to choose: the figure is derived (the
 * union of the full run's layers), and so is the threshold. A key in it that is
 * not a record or an annotation is refused by name ({@link checkScene}); the
 * object leaves room for a field a later issue gives it.
 *
 * 🔗 **`motion.animations_from` is rig-c's too, verbatim (issue #183).** An
 * optional path, relative to the config file's directory, to a file in
 * rig-c's motion-spec shape whose `animations` are written into `motion.json`
 * beside the idle on every `rig` and `build`, untouched. The loader owns what
 * the merge needs and nothing else ({@link readAnimationsFrom}): the file
 * exists and parses; it is an object holding `spec` ("rigc-motion/1") and an
 * `animations` table of objects, nothing else that would be dropped; no
 * animation is named `idle`; and no key in it is written twice. What an
 * animation holds is rigc's to accept or refuse, at the rig stage's gate. The
 * file is read where the config is read from a path ({@link loadConfig});
 * {@link parseConfig}, which has no path to resolve against, checks only that
 * the field is a non-empty string.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { RIG_BONE_INHERIT, RIG_SKIN_CONSTRAINT_KEYS, type RigBoneInherit, type RigConstraint, type RigSkinConstraintKey, type RigStop } from '@rig-c/core/src/rig.ts';
import { pyRound } from './round.ts';
import { motionSeamProblems, type MotionSeamDeclaration } from './motionseams.ts';
import { REQUIREMENTS_SPEC } from './requirements.ts';
import { CLOTH_TARGETS, type ClothRecipes, RECIPE_STRENGTH, RIGC_DEFAULT_DAMPING, springStable } from './cloth.ts';
import { GRID, MAX_SIDE } from './contour.ts';
import { type Problem, refuseIfAny } from './errors.ts';
import { edgeLength } from './length.ts';
import { setFocusProblems } from './setfocus.ts';
import { isSkeletonName, KEYPOINT_NAMES, type KeypointName, type PosePoints, scaledPoints, SKELETON_NAMES, type SkeletonName } from './skeleton.ts';
import { acceptedTagNames, AUTHOR_LABEL_RULE, AUTHOR_PREFIX, readLayerTag } from './tags.ts';
import { BODYSHIFT_BONE, BODY_REAR_SHIFT_BONE, BODY_YAW_DIAL_BONE, EAR_DEPTH_RANGE, FACESHIFT_BONE, FACE_DEFORM_FRACTIONS, FACE_DEFORM_RANGES, FACE_RATED_PITCH_BAND, FACE_RATED_YAW_BAND, type FaceDeformKey, PITCH_DIAL_BONE, REAR_SHIFT_BONE, TURN_BONE, TURN_ROLES, type TurnRole, type TurnSpec, YAW_DIAL_BONE, turnNearest, turnSurfaceBone, turnUnitBone } from './turn.ts';
export type { TurnSpec };
import { FLOOR_FORMS, type FloorForm, type MeshInfluences } from './weights.ts';

export type Point = [number, number];

/** A rigid binding; the object form can keep an exclusive rider in authored order (#680). */
export type RegionSpec = string | { bone: string; gather?: false };

/** Read a declared region binding without changing the authored representation. */
export function regionBone(region: RegionSpec): string {
  return typeof region === 'string' ? region : region.bone;
}

/** The raw reader keeps invalid values intact for their own named refusal. */
function rawRegionBone(region: Json): Json {
  return isPlainObject(region) ? region.bone : region;
}

export interface Lora {
  name: string;
  strength: number;
  strength_clip?: number;
}

export interface Sampler {
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
}

export interface Control {
  /**
   * A built-in skeleton's name, or the path of a pose file relative to the
   * config's directory (issue #198; {@link readControlPose} reads it). A
   * string that is not a built-in name is a path.
   */
  skeleton: SkeletonName | string;
  strength: number;
  end_percent: number;
  model?: string;
}

export interface Generation {
  checkpoint: string;
  loras: Lora[];
  trigger: string;
  identity: string;
  sampler: Sampler;
  costume: string;
  negative_extra: string;
  pose?: string;
  style: string;
  negative_pose: string;
  latent: [number, number];
  seed: number;
  control?: Control;
}

export type ArmSplitTag = 'handwear-r' | 'handwear-l';
export const ARM_SPLIT_TAGS: readonly ArmSplitTag[] = ['handwear-r', 'handwear-l'];

/**
 * Issue #439: an optional declaration on `config.seethrough` that separates
 * overlapping arms in the full run into `handwear-r` (smaller image x, the
 * character's right as they face the viewer) and `handwear-l` (larger image x,
 * the character's left) in the draw order `order` states, back to front.
 * Exactly one of `x` (an integer column on the full run's canvas) or `line`
 * (a polyline of at least two `[x, y]` integer points on the full run's
 * canvas) is given.
 */
export interface ArmSplit {
  x?: number;
  line?: Array<[number, number]>;
  order: ['handwear-r', 'handwear-l'] | ['handwear-l', 'handwear-r'];
}

export interface SeeThrough {
  /** Square crop `[x0, y0, x1, y1]` in source pixels for the second, head-only run. */
  head_box?: [number, number, number, number];
  /** Issue #439: arm separation when both arms overlap in the full run. */
  arm_split?: ArmSplit;
  resolution: number;
  steps: number;
  seed: number;
  offload: boolean;
}

export type Run = 'full' | 'head';

/** One part: its name, which run it comes from, and the See-through tag it is. Order = draw order, back to front. */
export type PlanEntry = [string, Run, string];

export interface Extend {
  part: string;
  run: Run;
  tag: string;
}

/** Which pixels of a patch's box it takes: the painting's figure silhouette inside the box, or the whole box. */
export type PatchAlpha = 'silhouette' | 'box';
export const PATCH_ALPHAS: readonly PatchAlpha[] = ['silhouette', 'box'];

/** Where a patch is drawn: behind every part, in front of every part, or immediately behind a named plan part. */
export type PatchDraw = 'back' | 'front' | { before: string };

/**
 * An extra part cut from the PAINTING rather than from a See-through layer —
 * for a piece of the figure no layer holds (a hem the runs dropped). Its
 * `box` is `[x0, y0, x1, y1]` in RIG pixels, the space `parts.json` and the
 * recomposite are in, `x1`/`y1` exclusive. Its bone is `regions.<name>`, as
 * for every region part: a patch is always a region, never a mesh.
 */
export interface Patch {
  name: string;
  box: [number, number, number, number];
  alpha: PatchAlpha;
  draw: PatchDraw;
}

/**
 * A declared cut of a plan part (issue #170): the pixels of `from`'s layer
 * whose centre lies inside `polygon` leave `from` and make the part `into`,
 * a part like any other — its own `parts.json` record and PNG, a `meshes` or
 * `regions` entry, its own place in the draw order. `polygon` is `[[x, y],
 * …]`, at least three points, in non-negative integer RIG pixels (the space
 * of `parts.json` and the patches' boxes), even-odd, a pixel inside when its
 * centre `(x + 0.5, y + 0.5)` is. `draw` places `into` exactly as a patch's
 * `draw` places a patch. What the config alone cannot know — whether the
 * polygon lies inside the rig, takes any of the layer's art, or overlaps
 * another cut of the same part — the assemble stage refuses
 * (`ASSEMBLE_CUT_INSIDE`, `ASSEMBLE_CUT_PIXELS`, `ASSEMBLE_CUT_OVERLAP`), and,
 * for a `from` a limb takes (issue #564), whether the polygon takes a pixel a
 * segment of the limb holds (`ASSEMBLE_CUT_CROSSES_LIMB`).
 */
export interface Cut {
  from: string;
  into: string;
  polygon: Array<[number, number]>;
  draw: PatchDraw;
  /**
   * The band, in rig px, inside the cut's edge that the from part keeps as
   * well as the piece (`cutBand` in `src/assemble.ts`), so the piece's
   * resampled edge has art under it. Required, 0 allowed: 0 makes the two
   * abut, which `check`'s seam bar reads.
   */
  overlap: number;
  /**
   * Issue #193, optional: a PNG, its path relative to the config's directory,
   * of what lies under the piece — in rig pixels over the polygon's bounding
   * box (`underBox` in `src/assemble.ts`). Where the cut removed pixels from
   * the base (the piece's pixels less the band), the base takes this image's
   * pixels; it is read nowhere else. Absent: the base keeps only its band.
   */
  under?: string;
  /**
   * Issue #360 (item 11), optional, one value: `"colour"` — where the under
   * fills a removed pixel, the base takes the under's colour and keeps the
   * alpha the cut removed there, so the part's silhouette is the uncut
   * layer's and never grows. The under is `under`'s image or the part's
   * hidden-art layer (issue #359); a cut with neither is refused by the
   * assemble stage (`ASSEMBLE_UNDER_FILL_SOURCE`). Absent: the base takes the
   * under's colour and alpha, issue #193's rule.
   */
  under_fill?: 'colour';
}

export interface AlternateSetConfig {
  name: string;
  /** Opt-in base region offsets on explicitly selected local axes, with paired painting patches. */
  base_anchor?: BaseAnchor;
  /** Authored point on this painting, x right/y down; omitted means no focus. */
  focus?: Point;
  source?: string;
  full?: string;
  head?: string;
  parts?: string[];
  /** Per covered output part, the layer in its existing source run (issue #666). */
  layers?: Record<string, string>;
  hides?: string[];
  head_box?: [number, number, number, number];
  cuts?: Cut[];
  skeleton?: string;
  /** One or two skeleton keypoints paired with declared base-bone origins (issue #543). */
  anchor?: Partial<Record<KeypointName, string>>;
  drawn?: Record<string, number>;
  /** Explicit bone endpoints on this alternate painting, full source-crop pixels, x right/y down. */
  tips?: Record<string, Point>;
  /**
   * Issue #664: covered limb segment parts this set draws on their front slot
   * (`<part>_front`, declared by `config.limbs.<limb>.front`) instead of the
   * base slot, which the set hides. Absent, the set draws every covered part
   * in its base slot.
   */
  front?: string[];
}

export interface Assemble {
  /** Rig pixels per source pixel. */
  rig_scale: number;
  plan: PlanEntry[];
  extend_below_crop?: Extend[];
  patches?: Patch[];
  cuts?: Cut[];
  alternates?: AlternateSetConfig[];
  /** Issue #492: composite full:face under head:face on the head canvas to fill transparent holes inside the face silhouette. */
  head_face_underfill?: boolean;
  /** Opt-in: yield original drift-refused front pixels to an opaque behind holder matching the painting. */
  yield_refused?: boolean;
}

export interface SingleBone {
  name: string;
  parent: string;
  at: Point;
  tip?: Point;
  /**
   * What the bone takes from its parent's transform (issue #348): one of rig-c's
   * own mode names (`RIG_BONE_INHERIT`, rig-c's `RigBone.inherit`), passed to
   * rig.json as written. Absent, rig.json carries no `inherit` and the bone
   * takes the parent's whole transform (rig-c's default, `normal`). A spelling
   * outside rig-c's table is refused by name (`CONFIG_BONE_INHERIT`): the
   * runtime would fold the first letter, and this loader folds and maps nothing.
   */
  inherit?: RigBoneInherit;
}

export interface ChainBones {
  /** The links are named `<chain>0`, `<chain>1`, … in `points` order. */
  chain: string;
  parent: string;
  points: Point[];
  tip: Point;
  /** Expanded link name -> rig-c inherit mode (issue #369); absent links keep normal inheritance. */
  link_inherit?: Record<string, RigBoneInherit>;
}

export type BoneEntry = SingleBone | ChainBones;

/** A chain name, a bone name, or an explicit segment `[bone, from, to]`. */
export type Segment = string | [string, Point, Point];

/**
 * One mesh: exactly one of three modes (issue #84, issue #126). `r` and
 * `segments` mean the same in all three. Which mode is the author's choice on
 * every entry; nothing picks one, and `propose` still writes `grid`.
 *
 * - `grid`: the lattice (`src/mesh.ts`), as it has always been — every byte it
 *   writes is unchanged by the second mode existing.
 * - `contour`: the part's alpha outline through rig-c's tracer, with
 *   interior vertices placed where they are declared (`src/contour.ts`), and
 *   local deformation regions weighted to their own bones
 *   (`src/localweights.ts`).
 * - `auto`: the contour mesh at alpha 1 and above as the source, reduced and
 *   locally refined by rig-c's `reduceMesh` under the author's declared
 *   bounds (`src/automesh.ts`).
 */
export type MeshSpec = (LatticeMeshSpec | ContourMeshSpec | AutoMeshSpec | InfluenceMeshSpec | ExplicitMeshSpec) & { gather?: false };

/**
 * One mesh in the influence mode (issue #378): rig-c's `segments` lattice over the part at `cell` px, every vertex
 * pulled by every chain link within `radius` px of it, falling to zero there (`shape`), the strongest `max` kept —
 * `buildSegmentsLattice` and `influenceShares` from `@rig-c/core/mesh`, promised for this call (rig-c/core#1450), so the
 * rule is core's and the mesh is written with explicit weights like every other mode (`src/rig.ts`). `segments`
 * names the links as in every mode; each entry is one of rig-c's `bones` entries, which `across: false` keeps apart.
 * `hold_tip: true` (issue #615, optional, written by `propose --cloth` from the recipe's `split.hold_tip`) smooths the
 * pulled shares by the lattice's held-fork passes, capped at `max`; absent, the shares are rig-c's as pulled.
 */
/** One island slot of a multi-island explicit mesh payload (issue #734). */
export interface ExplicitMeshIslandSpec {
  slot: string;
  bone?: string;
  before?: string;
  uvs: number[];
  triangles: number[];
  hull: number;
  weights: Array<Array<{ bone: string; x: number; y: number; weight: number }>>;
}

/** An accepted mesh transferred without regenerating topology or bone-local bind positions (issue #658, #734). */
export interface ExplicitMeshSpec {
  /** Direct bone names: the first is the default slot bone; all weighted and island slot bones must be declared here. No segment geometry is regenerated. */
  segments: Segment[];
  explicit: {
    /** SHA-256 over the unpadded part's decoded RGBA bytes. */
    image_sha256: string;
    /** SHA-256 of JSON.stringify([rig width, rig height, x, y, w, h]). */
    region_sha256: string;
    /** Normalized UVs over the ordinary PAD-padded rig image, as rig-c reads them (single-slot payload). */
    uvs?: number[];
    triangles?: number[];
    hull?: number;
    /** rig-c by-name weights, in bone-local Spine pixels, copied without rounding (single-slot payload). */
    weights?: Array<Array<{ bone: string; x: number; y: number; weight: number }>>;
    /** Per-island payloads when a part splits across <part> and <part>__island2..<part>__island<N> (issue #734). */
    islands?: ExplicitMeshIslandSpec[];
  };
}

/** Every vertex weight row of an explicit mesh, across either its single-slot payload or its `islands` (issue #734). */
export function explicitWeightRows(m: ExplicitMeshSpec): Array<Array<{ bone: string; x: number; y: number; weight: number }>> {
  if (m.explicit.islands !== undefined) return m.explicit.islands.flatMap((isl) => isl.weights);
  return m.explicit.weights ?? [];
}

/** Every slot bone an explicit mesh attaches to: `segments[0]` when single-slot, or each island's `bone ?? segments[0]` (issue #734). */
export function explicitSlotBones(m: ExplicitMeshSpec): string[] {
  const seg0 = typeof m.segments[0] === 'string' ? m.segments[0] : m.segments[0][0];
  if (m.explicit.islands === undefined) return [seg0];
  const out: string[] = [];
  for (const isl of m.explicit.islands) {
    const b = isl.bone ?? seg0;
    if (!out.includes(b)) out.push(b);
  }
  return out;
}

export interface InfluenceMeshSpec {
  influence: { cell: number; radius: number; across: boolean; max: number; shape: 'linear' | 'smooth'; hold_tip?: true };
  segments: Segment[];
}

/**
 * `meshes.<part>.rule` (issue #161): how a mesh's vertices are weighted. `"distance"` is `influences()`
 * (`src/weights.ts`), and what an absent field means; `"heat"` is bone heat over the part's silhouette
 * (`src/heat.ts`), in every mode. Nothing else is a rule.
 */
export type WeightRule = 'distance' | 'heat';

export const WEIGHT_RULES: readonly WeightRule[] = ['distance', 'heat'];

export interface LatticeMeshSpec {
  grid: number;
  r: number;
  segments: Segment[];
  /** The distance rule's exponent, `w = 1/(d + r)^exponent`, above 0 (issue #161); absent is 2, the rule as it always was. */
  exponent?: number;
  /** Absent: `"distance"`. */
  rule?: WeightRule;
  /** The cap and the floor's form (issue #284); absent is 4 and the cut at 0.03, the rule as it always was. */
  influences?: MeshInfluences;
  /**
   * The largest island, in art pixels, that may be left out of the lattice (issue #303) — the contour mode's
   * `contour.stray`, with the same meaning (`latticeStray`, `src/mesh.ts`); absent leaves none out.
   */
  stray?: number;
}

export interface ContourMeshSpec {
  contour: ContourSpec;
  r: number;
  segments: Segment[];
  /** The distance rule's exponent, `w = 1/(d + r)^exponent`, above 0 (issue #161); absent is 2, the rule as it always was. */
  exponent?: number;
  /** Absent: `"distance"`. */
  rule?: WeightRule;
  /** As the lattice's (issue #284). */
  influences?: MeshInfluences;
  /** Rows of vertices across the part along the chains named here (issue #188); absent places none. */
  ribs?: RibsSpec;
}

/**
 * `meshes.<part>.ribs` (issue #188): per chain the mesh's `segments` name, how
 * many ribs each link carries between its origin and its end (`stations`, a
 * whole number, 0 or more; required — a rib at each joint is always placed).
 * The contour and automatic modes only; a lattice's vertices are its grid's
 * corners, and a lattice mesh that declares ribs is refused.
 */
export type RibsSpec = Record<string, { stations: number }>;

/**
 * `meshes.<part>.contour`. Lengths and positions are RIG pixels, like every
 * other length in the config; the rig stage carries a position into the part
 * image by a translation only (the part's box less the pad), so a length means
 * the same number of pixels in both. Art is `ART_ALPHA`, the lattice's and
 * `check`'s; it is not a field.
 */
export interface ContourSpec {
  /** rig-c's Douglas–Peucker tolerance on the traced outline, px, 0 or more. */
  tolerance: number;
  /** rig-c's outward offset of the simplified outline, px, 0 or more. */
  margin: number;
  /** The background interior spacing, px, above 0. */
  spacing: number;
  /** The longest outline edge, px (issue #265): a longer simplified edge is cut into equal pieces; absent cuts nothing. */
  maxEdge?: number;
  /** The most vertices the mesh may have; absent is no budget. */
  budget?: number;
  /** The largest island, in art pixels, that may be left out of the mesh; absent leaves none out. */
  stray?: number;
  /**
   * Issue #326: `true` meshes every island past those `stray` leaves out and joins them into one outline by bridges
   * (`src/contour.ts`); absent, a second island refuses as it always has. There is no `false`.
   */
  bridges?: true;
  /** Local deformation regions; absent is none. */
  regions?: ContourRegionSpec[];
  /**
   * Issue #475: derives the `bust_r` and `bust_l` circle regions from three required landmarks (`apex_r`, `apex_l`,
   * `cleavage`) and two constants (`alpha`, `clearance`). Mutually exclusive with hand-written `bust_r` or `bust_l`
   * in `regions`.
   */
  bust?: ContourBustSpec;
}

/** Default solid-core ratio `α = r / (r + band)` fitted across the five calibrated example characters (issue #475). */
export const DEFAULT_BUST_ALPHA = 0.22;
/** Default cleavage clearance `ε` (rig px) fitted across the five calibrated example characters (issue #475). */
export const DEFAULT_BUST_CLEARANCE = 3.8;
/** Default interior refinement spacing (rig px) for derived `bust_r` and `bust_l` regions (issue #475). */
export const DEFAULT_BUST_SPACING = 14;
/** Default control bone names for derived `bust_r` and `bust_l` regions (issue #475). */
export const DEFAULT_BUST_BONE_R = 'boob_r';
export const DEFAULT_BUST_BONE_L = 'boob_l';

/**
 * Landmark shorthand for the `bust_r` and `bust_l` contour regions (issue #475):
 * `R_s = round(|apex_s - cleavage| - clearance)`, `r_s = round(alpha * R_s)`, `band_s = R_s - r_s`.
 */
export interface ContourBustSpec {
  apex_r: Point;
  apex_l: Point;
  cleavage: Point;
  /** Core-to-outer radius ratio `r / (r + band)` in `(0, 1)`; absent is {@link DEFAULT_BUST_ALPHA} (`0.22`). */
  alpha?: number;
  /** Cleavage clearance `ε` in rig px (`> 0`, with `R_r + R_l < D`); absent is {@link DEFAULT_BUST_CLEARANCE} (`3.8`). */
  clearance?: number;
  /** Control bone for `bust_r`; absent is {@link DEFAULT_BUST_BONE_R} (`"boob_r"`). */
  bone_r?: string;
  /** Control bone for `bust_l`; absent is {@link DEFAULT_BUST_BONE_L} (`"boob_l"`). */
  bone_l?: string;
  /** Region refinement spacing in rig px (`> 0`); absent is {@link DEFAULT_BUST_SPACING} (`14`). */
  spacing?: number;
}

/**
 * Derive the `[bust_r, bust_l]` circle contour regions from {@link ContourBustSpec} (issue #475).
 * Read by both `propose` and `rig` through {@link contourRegionsOf}.
 */
export function deriveBustRegions(bust: ContourBustSpec): [ContourRegionSpec, ContourRegionSpec] {
  const alpha = bust.alpha ?? DEFAULT_BUST_ALPHA;
  const clearance = bust.clearance ?? DEFAULT_BUST_CLEARANCE;
  const spacing = bust.spacing ?? DEFAULT_BUST_SPACING;
  const boneR = bust.bone_r ?? DEFAULT_BUST_BONE_R;
  const boneL = bust.bone_l ?? DEFAULT_BUST_BONE_L;
  const [rx, ry] = bust.apex_r;
  const [lx, ly] = bust.apex_l;
  const [kx, ky] = bust.cleavage;
  const dR = edgeLength(kx - rx, ky - ry);
  const dL = edgeLength(kx - lx, ky - ly);
  const RR = Math.round(dR - clearance);
  const RL = Math.round(dL - clearance);
  const rR = Math.round(alpha * RR);
  const rL = Math.round(alpha * RL);
  return [
    { name: 'bust_r', shape: 'circle', cx: rx, cy: ry, r: rR, spacing, band: RR - rR, bone: boneR },
    { name: 'bust_l', shape: 'circle', cx: lx, cy: ly, r: rL, spacing, band: RL - rL, bone: boneL },
  ];
}

/**
 * Every contour region on `spec`: its hand-given `regions` (in declared order) followed by `deriveBustRegions(spec.bust)`
 * when `spec.bust` is declared (issue #475). When `spec.bust` is absent, returns `spec.regions ?? []`.
 */
export function contourRegionsOf(spec: ContourSpec): ContourRegionSpec[] {
  if (spec.bust === undefined) return spec.regions ?? [];
  return [...(spec.regions ?? []), ...deriveBustRegions(spec.bust)];
}

/**
 * A local deformation region: a shape in rig px, a control bone, the spacing
 * the mesh is refined at inside it and its band, and the band the bone's
 * weight falls across ({@link import('./localweights.ts').regionWeight}).
 * Every coordinate and length is a multiple of 1/256 px: the weight's 0 and 1
 * are decided exactly on that grid.
 */
export type ContourRegionSpec =
  | { name: string; shape: 'circle'; cx: number; cy: number; r: number; spacing: number; band: number; bone: string }
  | { name: string; shape: 'polygon'; points: Point[]; spacing: number; band: number; bone: string };

/**
 * One mesh in the automatic mode (issue #126, item 2): the contour mesh over
 * the part at alpha 1 and above is the source, and rig-c's `reduceMesh`
 * (`@rig-c/core/mesh`, 2.28.x) refines it inside the declared regions and
 * removes what the declared bounds allow (`src/automesh.ts`); the result is
 * kept only when its motion passes `motion` (`src/automotion.ts`). Every quality
 * input is a number the author wrote, named as rig-c's contract
 * (docs/MESH_REDUCTION.md) names it; none has a default inside this package
 * but the two the agreement fixed for parts's policy — `protect.hull` is false
 * when absent (P20) — and the lists of `protect`, which are empty when absent,
 * as an absent `regions` is "none" everywhere in this config.
 */
export interface AutoMeshSpec {
  auto: AutoSpec;
  r: number;
  segments: Segment[];
  /** The distance rule's exponent, `w = 1/(d + r)^exponent`, above 0 (issue #161); absent is 2, the rule as it always was. */
  exponent?: number;
  /** Absent: `"distance"`. */
  rule?: WeightRule;
  /** As the contour mode's (issue #188): rows across the source along the chains named, kept by the reduction; absent places none. */
  ribs?: RibsSpec;
}

export interface AutoSpec {
  /** The source mesh: the contour mode's own parameters, px. */
  source: { tolerance: number; margin: number; spacing: number; stray?: number };
  /** What the source must already satisfy (correction 3). */
  sourceBounds: ArtFitBoundsSpec;
  /** What the result must satisfy. */
  targets: { artFit: ArtFitBoundsSpec; maxBoundaryDeviation: number; minAngle?: number };
  protect?: {
    hull?: boolean;
    vertices?: number[];
    edges?: Array<[number, number]>;
    regionBoundaries?: string[];
    weightJump?: number | null;
    influences?: string[];
  };
  influences: { maxInfluences: number; minWeight: number };
  budget: { maxCandidates: number };
  minArtSamples: number;
  regions?: AutoRegionSpec[];
  /**
   * The motion gate's bounds (issue #126, item 3; `src/automotion.ts`). The
   * loader requires it on every auto mesh (`CONFIG_FIELD_PRESENT`): the mode is
   * accepted into a build only when its motion is measured and passes. It is
   * optional in the type only because `buildRig`, which measures geometry
   * alone, does not read it; the rig stage refuses a spec without it by the
   * same code.
   */
  motion?: AutoMotionSpec;
  /**
   * Stage B of rigc#1271 (rig-c 2.25.0–2.27.0), each opt-in and each the
   * author's: absent, the field is not sent to `reduceMesh` and the call is the
   * one it was before the field existed. `boundaryRuns.maxVertices` (a whole
   * number, 2 or more; no default) lets each removal pass replace a run of 2 to
   * that many consecutive source-hull vertices with one chord, as one step held
   * to every declared row; `retriangulate: 'delaunay'` re-triangulates the kept
   * vertices by Delaunay flips once the reduction ends, taken whole only when
   * every declared row still passes; `removalOrder: 'deformation-load'` tries the
   * single removals in ascending predicted load instead of ascending source
   * index. What each promises and does not is rig-c's (docs/MESH_REDUCTION.md
   * §8, the three *Stage B* subsections).
   */
  boundaryRuns?: { maxVertices: number };
  retriangulate?: 'delaunay';
  removalOrder?: 'deformation-load';
  /**
   * The declared stimulus of a part no idle key deforms (issue #196): each
   * link of the named chain rotated by +`degrees` and by −`degrees` about its
   * joint, poses the motion gate measures against beside the idle's
   * (`src/automotion.ts`). A list for a part bound to several chains. Absent:
   * none, and the stage is byte for byte the one it was before the field
   * existed — nothing here derives a motion.
   */
  stimulus?: StimulusSpec | StimulusSpec[];
}

/** `meshes.<part>.auto.stimulus` (issue #196): a chain this mesh's segments name, and the bend, degrees above 0. */
export interface StimulusSpec {
  chain: string;
  degrees: number;
}

/**
 * `meshes.<part>.auto.motion` — what rig-c's `compareMeshesInMotion`
 * holds the reduced mesh to against its unreduced source on the idle:
 * `maxLocalDeformation` in rig px (the rig's world units: its bones carry no
 * scale), required; `maxStretch` / `minStretch` (ratios) gate only when
 * written — absent, the rows are reported and not gated, the contract's own
 * rule; `deformMayFold` lets the part's folds be listed instead of refused,
 * false when absent — the one non-numeric default, echoed in the row.
 * `gradation` (px per px, 0 or more, or null) is the author's G for rig-c's
 * `MQ_ALLOCATION_CONTRAST` (docs/MESH_REDUCTION.md §8, *G — what it derives
 * from*): how fast the mesh may coarsen away from something that needs
 * density — at d px from a need of size h, edges up to h + G · d, the form of
 * a region's `grade`. Nothing a rig declares fixes it (rigc#1291), so it is
 * never derived: left out (or null) it is sent as null, and the row reads
 * `not-measurable` naming it while `MQ_DEFORM_LOAD` is measured.
 */
export interface AutoMotionSpec {
  maxLocalDeformation: number;
  maxStretch?: number;
  minStretch?: number;
  deformMayFold?: boolean;
  gradation?: number | null;
  /**
   * How the acceptance loop (`src/autoreplay.ts`) chooses a replayed step when
   * the full result fails the gate (issue #148). Absent: the bisection, and the
   * stage is byte for byte the one it was before the field existed.
   * `{ policy: 'multi-interval', maxProbes }` probes up to `maxProbes` distinct
   * removal steps (a whole number, 1 or more; the author's, never derived) in
   * a fixed order and keeps the fewest-vertex candidate among those that
   * passed — the best among tested candidates, never the last, the minimal
   * or a complete walk.
   */
  selection?: AutoSelectionSpec;
  /**
   * The skinning residual as a per-step veto (issue #126, rig-c 2.31.0's
   * `targets.skinning`, rigc#1295; `src/autoenvelope.ts`). Absent: nothing is
   * sent and the stage is byte for byte the one it was before the field
   * existed. `{ maxResidual }` (drawing px, 0 or more; the author's, never
   * derived) asks rig-c to refuse every removal, boundary run and post-pass
   * whose `MQ_SKINNING_RESIDUAL` against the original source exceeds it, under
   * the envelope derived from the declared idle. The residual is a pose-free
   * bound, not the motion verdict: the motion comparison still runs and still
   * decides.
   */
  residual?: AutoResidualSpec;
}

/** `meshes.<part>.auto.motion.residual` (issue #126, rigc#1295): the author's bound on the skinning residual, drawing px. */
export interface AutoResidualSpec {
  maxResidual: number;
}

/** `meshes.<part>.auto.motion.selection` (issue #148): the one policy besides the bisection, and its probe budget. */
export interface AutoSelectionSpec {
  policy: 'multi-interval';
  maxProbes: number;
}

/**
 * An art-fit bound set. `maxOvershoot` and `maxUndercut` are a number (px) or
 * `null`, "declared absent": rig-c measures the residual, reports its row
 * `undeclared` and gates nothing on it. Left out, either is refused by name —
 * absence is never read as "not bounded". `minCoverage` is always a number.
 */
export interface ArtFitBoundsSpec {
  minCoverage: number;
  maxOvershoot: number | null;
  maxUndercut: number | null;
}

/**
 * A region of the automatic mode, in one of two forms (issue #155).
 *
 * - **Weight and density** ({@link AutoWeightRegionSpec}): a shape and a
 *   control bone as a contour region has them, the bone's weight `band` (the
 *   same falloff, `src/localweights.ts`), and the density rig-c holds the
 *   mesh to (§5 of its contract): every edge meeting the region at most
 *   `maxEdgeLength` px (L0), relaxing as `L0 + grade·d` across `transition` px
 *   outside it, and the region's art sample floor (P9).
 * - **Density only** ({@link AutoDensityRegionSpec}): the same shape and
 *   density with no `bone` and no `band`. It is handed to rig-c exactly as the
 *   first form's density is, and it takes no part in the weights: no vertex's
 *   `g` comes from it, it adds no bone to `protect.influences`, and a source
 *   vertex inside it is weighted as one no region reaches. A vertex rig-c
 *   inserts there carries rig-c's interpolation of its source triangle (§6),
 *   as every inserted vertex does in either form.
 *
 * The two are told apart by `bone`: the loader takes `bone` and `band`
 * together or neither, and refuses either alone by name. Coordinates and
 * `band` are multiples of 1/256 px, as a contour region's.
 */
export type AutoRegionSpec = AutoWeightRegionSpec | AutoDensityRegionSpec;

/** An automatic-mode region that weights its bone and asks for density (the one form before issue #155). */
export type AutoWeightRegionSpec =
  | { name: string; shape: 'circle'; cx: number; cy: number; r: number; band: number; bone: string; maxEdgeLength: number; transition: number; grade: number; minArtSamples: number }
  | { name: string; shape: 'polygon'; points: Point[]; band: number; bone: string; maxEdgeLength: number; transition: number; grade: number; minArtSamples: number };

/** An automatic-mode region that asks for density and weights nothing (issue #155): no `bone`, no `band`. */
export type AutoDensityRegionSpec =
  | { name: string; shape: 'circle'; cx: number; cy: number; r: number; maxEdgeLength: number; transition: number; grade: number; minArtSamples: number }
  | { name: string; shape: 'polygon'; points: Point[]; maxEdgeLength: number; transition: number; grade: number; minArtSamples: number };

/** Whether an automatic-mode region weights a bone: the loader admits `bone` and `band` together or neither (issue #155). */
export function weightsABone(rg: AutoRegionSpec): rg is AutoWeightRegionSpec {
  return 'bone' in rg;
}

/** The three sections a part's bones are read from: a config's, or a proposal's, which has the same shape (issue #535). */
export interface PartBinding {
  bones: readonly BoneEntry[];
  meshes: Readonly<Record<string, MeshSpec>>;
  regions: Readonly<Record<string, RegionSpec>>;
}

/**
 * The bones each part binds (issue #535): a region's `regions.<part>`; for a
 * mesh, every bone its `segments` name (a chain's name standing for each of
 * its links `<chain>0`, `<chain>1`, …; an explicit segment's bone), its
 * `contour` regions' bones (a declared `bust` included) and its `auto`
 * regions' that weight one. The same reading the rig stage makes of the parts
 * an alternate set covers (issue #476). Parts in `meshes` first, then
 * `regions`, each part's bones in the order they are named, once. Pure: a bone
 * that does not resolve is kept by name — the loader and the rig stage refuse
 * it on their own.
 */
export function partBoundBones(b: PartBinding): Map<string, string[]> {
  const chains = new Map<string, string[]>();
  for (const e of Array.isArray(b.bones) ? b.bones : []) {
    if (isPlainObject(e) && 'chain' in e && typeof e.chain === 'string' && Array.isArray(e.points)) {
      chains.set(e.chain, e.points.map((_, k) => `${e.chain}${k}`));
    }
  }
  const out = new Map<string, string[]>();
  const bind = (part: string, bone: string): void => {
    const list = out.get(part) ?? [];
    if (!list.includes(bone)) list.push(bone);
    out.set(part, list);
  };
  if (isPlainObject(b.meshes)) {
    for (const [part, m] of Object.entries(b.meshes)) {
      if (isRecordKey(part) || !isPlainObject(m)) continue;
      if ('explicit' in m && isPlainObject(m.explicit)) {
        const addWeights = (ws: Json): void => {
          if (!Array.isArray(ws)) return;
          for (const row of ws) {
            if (!Array.isArray(row)) continue;
            for (const w of row) {
              if (isPlainObject(w) && typeof w.bone === 'string') bind(part, w.bone);
            }
          }
        };
        if (Array.isArray(m.explicit.islands)) {
          for (const isl of m.explicit.islands) {
            if (isPlainObject(isl)) addWeights(isl.weights);
          }
          const seg0 =
            Array.isArray(m.segments) && m.segments.length > 0
              ? typeof m.segments[0] === 'string'
                ? m.segments[0]
                : Array.isArray(m.segments[0]) && typeof m.segments[0][0] === 'string'
                  ? m.segments[0][0]
                  : undefined
              : undefined;
          for (const isl of m.explicit.islands) {
            if (!isPlainObject(isl)) continue;
            const bName = typeof isl.bone === 'string' ? isl.bone : seg0;
            if (bName !== undefined) bind(part, bName);
          }
        } else {
          addWeights(m.explicit.weights);
        }
        continue;
      }
      if (Array.isArray(m.segments)) {
        for (const sg of m.segments) {
          if (typeof sg === 'string') {
            for (const l of chains.get(sg) ?? [sg]) bind(part, l);
          } else if (Array.isArray(sg) && typeof sg[0] === 'string') {
            bind(part, sg[0]);
          }
        }
      }
      if ('contour' in m && isPlainObject(m.contour)) {
        if (Array.isArray(m.contour.regions)) {
          for (const rg of m.contour.regions) {
            if (isPlainObject(rg) && typeof rg.bone === 'string') bind(part, rg.bone);
          }
        }
        if (isPlainObject(m.contour.bust)) {
          bind(part, typeof m.contour.bust.bone_r === 'string' ? m.contour.bust.bone_r : DEFAULT_BUST_BONE_R);
          bind(part, typeof m.contour.bust.bone_l === 'string' ? m.contour.bust.bone_l : DEFAULT_BUST_BONE_L);
        }
      }
      if ('auto' in m && isPlainObject(m.auto) && Array.isArray(m.auto.regions)) {
        for (const rg of m.auto.regions) {
          if (isPlainObject(rg) && typeof rg.bone === 'string') bind(part, rg.bone);
        }
      }
    }
  }
  if (isPlainObject(b.regions)) {
    for (const [part, region] of Object.entries(b.regions)) {
      if (isRecordKey(part)) continue;
      const bone = rawRegionBone(region);
      if (typeof bone === 'string') bind(part, bone);
    }
  }
  return out;
}

/**
 * Issue #791: whether a turn moves two parts relative to each other — two parts
 * with different turn roles or carriers (`config.turn.roles`,
 * `config.turn.body.roles`, `config.turn.depths`), or a part with a physics
 * chain (`config.constraints` with `type: "physics"`) over another part.
 * Returns null when `config.turn` is absent, so a rig without a turn block is
 * untouched.
 */
export function turnMovingPartPair(
  cfg: {
    assemble?: CharacterConfig['assemble'];
    turn?: TurnSpec;
    bones?: BoneEntry[];
    meshes?: Record<string, MeshSpec>;
    regions?: Record<string, RegionSpec>;
    limbs?: Record<string, Limb>;
    constraints?: ConfigConstraint[];
  },
): ((a: string, b: string) => boolean) | null {
  const turn = cfg.turn;
  if (!isPlainObject(turn)) return null;

  const sourceOf = new Map<string, string>();
  for (const c of cfg.assemble?.cuts ?? []) {
    if (isPlainObject(c) && typeof c.into === 'string' && typeof c.from === 'string') sourceOf.set(c.into, c.from);
  }
  if (isPlainObject(cfg.limbs)) {
    for (const limb of Object.values(cfg.limbs)) {
      if (!isPlainObject(limb) || !Array.isArray(limb.segments)) continue;
      for (const sg of limb.segments) {
        if (!isPlainObject(sg) || typeof sg.part !== 'string' || typeof sg.from !== 'string') continue;
        sourceOf.set(sg.part, sg.from);
        if (isPlainObject(sg.hybrid) && typeof sg.hybrid.part === 'string') sourceOf.set(sg.hybrid.part, sg.from);
      }
    }
  }
  const baseName = (p: string): string => {
    let cur = p;
    const seen = new Set<string>();
    while (sourceOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = sourceOf.get(cur) as string;
    }
    return cur;
  };

  const boneEntries = Array.isArray(cfg.bones) ? cfg.bones.filter(isPlainObject) : [];
  const parentOf = new Map<string, string>();
  for (const e of boneEntries) {
    if ('chain' in e && typeof e.chain === 'string' && Array.isArray(e.points)) {
      e.points.forEach((_, k) => parentOf.set(`${e.chain}${k}`, k === 0 ? e.parent : `${e.chain}${k - 1}`));
    } else if ('name' in e && typeof e.name === 'string' && typeof e.parent === 'string') {
      parentOf.set(e.name, e.parent);
    }
  }
  const physicsBones = new Set<string>();
  if (Array.isArray(cfg.constraints)) {
    for (const c of cfg.constraints) {
      if (isPlainObject(c) && c.type === 'physics' && typeof c.bone === 'string') physicsBones.add(c.bone);
    }
  }
  for (const b of parentOf.keys()) {
    let cur: string | undefined = b;
    const seen = new Set<string>();
    while (cur !== undefined && !seen.has(cur)) {
      if (physicsBones.has(cur)) {
        physicsBones.add(b);
        break;
      }
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  }

  const meshParts = isPlainObject(cfg.meshes)
    ? new Set(Object.keys(cfg.meshes).filter((k) => !isRecordKey(k)))
    : new Set<string>();
  const isMeshPart = (p: string): boolean => meshParts.has(p) || meshParts.has(baseName(p));

  const bound =
    isPlainObject(cfg.meshes) || isPlainObject(cfg.regions)
      ? partBoundBones({
          bones: boneEntries as BoneEntry[],
          meshes: isPlainObject(cfg.meshes) ? (cfg.meshes as Record<string, MeshSpec>) : {},
          regions: isPlainObject(cfg.regions) ? (cfg.regions as Record<string, RegionSpec>) : {},
        })
      : new Map<string, string[]>();
  if (isPlainObject(cfg.limbs)) {
    for (const limb of Object.values(cfg.limbs)) {
      if (!isPlainObject(limb) || !Array.isArray(limb.segments)) continue;
      for (const sg of limb.segments) {
        if (!isPlainObject(sg) || typeof sg.part !== 'string' || typeof sg.bone !== 'string') continue;
        if (!bound.has(sg.part)) bound.set(sg.part, [sg.bone]);
        if (isPlainObject(sg.hybrid) && typeof sg.hybrid.part === 'string' && !bound.has(sg.hybrid.part)) {
          bound.set(sg.hybrid.part, [sg.bone]);
        }
      }
    }
  }
  const bonesOf = (p: string): readonly string[] => bound.get(p) ?? bound.get(baseName(p)) ?? [];
  const sameNonEmptyBones = (a: readonly string[], b: readonly string[]): boolean =>
    a.length > 0 && a.length === b.length && a.every((x, i) => x === b[i]);

  const roleGroups: Array<{ roles: Readonly<Record<string, TurnRole>>; unitDepths?: Readonly<Record<string, number>> }> = [];
  if (isPlainObject(turn.roles)) {
    roleGroups.push({
      roles: turn.roles as Readonly<Record<string, TurnRole>>,
      ...(isPlainObject(turn.unitDepths) ? { unitDepths: turn.unitDepths as Readonly<Record<string, number>> } : {}),
    });
  }
  if (isPlainObject(turn.body) && isPlainObject(turn.body.roles)) {
    roleGroups.push({
      roles: turn.body.roles as Readonly<Record<string, TurnRole>>,
      ...(isPlainObject(turn.body.unitDepths) ? { unitDepths: turn.body.unitDepths as Readonly<Record<string, number>> } : {}),
    });
  }
  const depths = isPlainObject(turn.depths) ? (turn.depths as Readonly<Record<string, number>>) : null;
  const pivot = typeof turn.pivot === 'number' && Number.isFinite(turn.pivot) ? turn.pivot : null;

  return (a: string, b: string): boolean => {
    if (a === b) return false;
    const bA = bonesOf(a);
    const bB = bonesOf(b);
    const hasPhysA = bA.some((x) => physicsBones.has(x));
    const hasPhysB = bB.some((x) => physicsBones.has(x));
    if ((hasPhysA || hasPhysB) && !(bA.length === 1 && sameNonEmptyBones(bA, bB))) return true;

    for (const g of roleGroups) {
      const rA = g.roles[a] ?? g.roles[baseName(a)];
      const rB = g.roles[b] ?? g.roles[baseName(b)];
      if (rA === undefined && rB === undefined) continue;
      if (rA !== rB) return true;
      if (rA === 'surface') return true;
      if (rA === 'unit' && (isMeshPart(a) || isMeshPart(b) || !sameNonEmptyBones(bA, bB))) return true;
      const ud = g.unitDepths;
      if (ud !== undefined) {
        const dA = ud[a] ?? ud[baseName(a)] ?? (bA.length === 1 ? ud[bA[0]] : undefined);
        const dB = ud[b] ?? ud[baseName(b)] ?? (bB.length === 1 ? ud[bB[0]] : undefined);
        if (dA !== dB) return true;
      }
      if ((bA.length > 0 || bB.length > 0) && !sameNonEmptyBones(bA, bB)) return true;
    }

    if (depths !== null) {
      const rawA = depths[a] ?? depths[baseName(a)];
      const rawB = depths[b] ?? depths[baseName(b)];
      const effA = typeof rawA === 'number' && Number.isFinite(rawA) && rawA !== pivot ? rawA : null;
      const effB = typeof rawB === 'number' && Number.isFinite(rawB) && rawB !== pivot ? rawB : null;
      if (effA !== effB) return true;
    }

    return false;
  };
}

/**
 * The bones a part can own (issue #535): every chain link, and every bone no
 * other bone hangs from. A trunk bone — `head`, `chest`, anything with a child —
 * is shared by nature, so binding it is never a rider relation on its own.
 */
export function ownableBones(bones: readonly BoneEntry[]): Set<string> {
  const parents = new Set(bones.map((e) => e.parent));
  const out = new Set<string>();
  for (const e of bones) {
    if ('chain' in e) e.points.forEach((_, k) => out.add(`${e.chain}${k}`));
    else if (!parents.has(e.name)) out.add(e.name);
  }
  return out;
}

/**
 * Issue #535's rider by bone, read off a binding for the carried parts (each
 * with its `opaque_px`, in parts.json's draw order): the host of an ownable
 * bone ({@link ownableBones}) is the carried part binding it with the most
 * opaque pixels, the earlier in draw order on a tie; a part is a rider of `H`
 * when it binds at least one ownable bone, every one of them is hosted by `H`,
 * and it hosts none itself. A part whose ownable bones have two or more hosts
 * rides none of them and is returned in `split` with its hosts. Parts not in
 * `carried` neither host nor ride.
 */
export function turnRidersByBone(b: PartBinding, carried: ReadonlyArray<{ part: string; area: number }>): { riders: Map<string, { host: string; bones: string[] }>; split: Array<{ part: string; hosts: string[] }> } {
  const bound = partBoundBones(b);
  const ownable = ownableBones(b.bones);
  const host = new Map<string, { part: string; area: number }>();
  for (const c of carried) {
    for (const bone of bound.get(c.part) ?? []) {
      if (!ownable.has(bone)) continue;
      const h = host.get(bone);
      if (h === undefined || c.area > h.area) host.set(bone, c);
    }
  }
  const hosts = new Set([...host.values()].map((h) => h.part));
  const riders = new Map<string, { host: string; bones: string[] }>();
  const split: Array<{ part: string; hosts: string[] }> = [];
  for (const c of carried) {
    if (hosts.has(c.part)) continue;
    const own = (bound.get(c.part) ?? []).filter((bone) => host.has(bone));
    if (own.length === 0) continue;
    const of = [...new Set(own.map((bone) => (host.get(bone) as { part: string }).part))];
    if (of.length === 1) riders.set(c.part, { host: of[0], bones: own });
    else split.push({ part: c.part, hosts: of });
  }
  return { riders, split };
}

export interface SingleTrack {
  bone: string;
  prop: SingleProp;
  amp: number;
  period: number;
  phase: number;
  base?: number;
}

export interface ChainTrack {
  chain: string;
  amps: number[];
  period: number;
  phase: number;
  lag: number;
}

export type Track = SingleTrack | ChainTrack;

/**
 * A region part the blink moves, cut at a rig row: the rows above `row` are
 * drawn by a second slot `<part>_still` on `bone`, which the blink does not
 * key, and the rows from `row` down stay on the part's own slot and blink.
 * For an eyelash layer that also carries the eyelid crease (issue #26).
 */
export interface BlinkStill {
  row: number;
  bone: string;
}

/**
 * The idle's one blink. `eyes` names at least one bone; `brows` and
 * `brow_drop` are stated together or not at all, and a stated `brows` names
 * at least one bone — rigc refuses a group with no members, and a
 * `brow_drop` with no brows is a value nothing reads. A figure with no eye
 * bone has no blink: leave `blink` out (`CONFIG_BLINK_GROUP_MEMBERS`).
 */
export interface Blink {
  t: number;
  eyes: string[];
  brows?: string[];
  squash: number;
  brow_drop?: number;
  still?: Record<string, BlinkStill>;
}

export interface Motion {
  duration: number;
  tracks: Track[];
  blink?: Blink;
  /**
   * A file in rig-c's motion-spec shape whose `animations` are written beside
   * the idle (issue #183), its path relative to the config file's directory.
   * Absent, `motion.json` holds the idle alone.
   */
  animations_from?: string;
}

/** The motion-spec version a file `motion.animations_from` names must state: rig-c's, the one `motion.json` states. */
export const ANIMATIONS_FROM_SPEC = 'rigc-motion/1';

/**
 * The animations `motion.animations_from` names, as read: `table` is the file's
 * `animations` object itself, each animation untouched, in the order
 * `JSON.parse` gives its keys (the file's order, except that a name that is an
 * array index, `"0"` to `"4294967294"`, comes first, in numeric order — the
 * JavaScript object's own key order, which no writer here can change).
 */
export interface AnimationsFrom {
  /** The file, resolved against the config's directory. */
  file: string;
  table: Record<string, unknown>;
}

/**
 * One entry of `config.constraints`: a constraint in rig-c's rig-spec
 * shape. The loader vouches for `type`, `name` and the bone names in the
 * fields {@link CONSTRAINT_BONE_FIELDS} lists; every other field is carried
 * unread and is rigc's to accept or refuse.
 */
export interface ConfigConstraint {
  type: RigSkinConstraintKey;
  name: string;
  [field: string]: unknown;
}

/**
 * One entry of `config.stops` (issue #404): rig-c's `RigStop` (`rig-c` 2.56.0),
 * a cloth chain's rotation clamped against a leg bone so the skirt cannot swing
 * into the leg. `chain` names a chain declared in `config.bones`; `links` is
 * the stopped links along it (when omitted, every link of `chain` in link
 * order); `against` is the leg bone the point rides on; `at` is `[x, y]` in
 * `against`'s local space; `inward` and `outward` are the first link's clamp
 * bounds in degrees (positive away from `against`), and `lower` the lower
 * links' bounds when more than one link is stopped.
 */
export interface ConfigStop {
  chain: string;
  links?: string[];
  against: string;
  at: Point;
  inward: number;
  outward: number;
  lower?: { inward: number; outward: number };
}

/**
 * One segment of a limb (issue #349): the part it makes, the part whose
 * pixels it takes (`from`: a plan part or a cut's piece), and the one bone it
 * rides with weight 1. Every segment after the first sits below a joint at
 * its bone's origin: `joint` names it, `range` is the bend the joint may take
 * from rest, `[min, max]` degrees (carried into `parts.json` and posed by
 * `check`'s `SEAM_OVER_RANGE`, issue #360; not read by rig-c), and `cap` an
 * image, relative to the config's directory, of the cap that overlaps the
 * joint (`limbCaps` in `src/assemble.ts`). Two opt-in fields shape the cut at
 * the joint (issue #360, `src/limbs.ts`): `edge: "feather"` fades the upper
 * piece out across the cap, and `cap_shape: "disc"` sizes the cap by the
 * limb's half-width about the joint and fills it from the art, the upper
 * segment's included; `cap_shape: "ball"` (issue #579) is that disc on both
 * sides of the joint line, its lower half written into the lower piece from
 * the cap image where the piece's layer is transparent. Absent, the cut
 * is hard and the cap the layer's half-disc of half the limb's width. A third,
 * `cut_band: N` (issue #360, item 14), places the cut on the line within N px
 * of the joint line that crosses the fewest stroke pixels; absent, the cut is
 * the joint line.
 */
export interface LimbSegment {
  part: string;
  from: string;
  bone: string;
  joint?: string;
  range?: [number, number];
  cap?: string;
  edge?: 'feather';
  cap_shape?: 'disc' | 'ball';
  /** Issue #360 (item 14): the half-width, whole rig px, of the band about the joint line the cut is placed in (`placeCut` in `src/limbs.ts`). Absent, the cut is the joint line. */
  cut_band?: number;
  /** Issue #399: one generated mesh across this joint; width is full axial rig px. */
  hybrid?: { part: string; width?: number };
}

/**
 * Issue #446: a per-limb split declared on the covering limb where two limbs
 * share one part and cross: either `line` (a polyline of two or more `[x, y]`
 * points in rig px along the covering limb's seam) or `edge: "painting"`
 * (traces the covering limb's painted stroke or silhouette across the crossing).
 */
export interface LimbSplit {
  line?: Array<[number, number]>;
  edge?: 'painting';
}

/** A limb (issue #349): its segments, upper first; each segment's bone is the child of the one before. */
export interface Limb {
  segments: LimbSegment[];
  split?: LimbSplit;
  /** Explicit rig-stage adjacency; absent, the existing limb closure is unchanged. */
  layout?: LimbLayout;
  /** Issue #664: a second, empty-at-setup slot per named segment part; absent, no slot is added and no byte moves. */
  front?: LimbFront;
}

/**
 * Issue #664: `parts` are this limb's own segment parts; each gets a slot
 * `<part>_front` on its base slot's bone with no setup attachment, placed in the
 * final setup slot order immediately after `after`'s whole slot family.
 */
export interface LimbFront {
  parts: string[];
  after: string;
}

export type LimbLayoutTarget = { limb: string; part?: never } | { part: string; limb?: never };
export type LimbLayout = { parts?: string[] } & (
  { before: LimbLayoutTarget; after?: never } | { after: LimbLayoutTarget; before?: never }
);

export interface WaistDeclaration {
  top: string;
  bottom: string;
  upper: string;
  lower: string;
  bone: string;
  constraint: string;
}

export interface CharacterConfig {
  /** Explicit shared-waist construction. Absent, no pair is detected or altered. */
  waist?: WaistDeclaration;
  depth?: DepthConfig;
  key: string;
  note?: string;
  generation?: Generation;
  seethrough?: SeeThrough;
  assemble: Assemble;
  /** Limbs cut at their joints (issue #349): absent, no part is cut at a joint and no byte of any output moves. */
  limbs?: Record<string, Limb>;
  bones: BoneEntry[];
  meshes: Record<string, MeshSpec>;
  regions: Record<string, RegionSpec>;
  motion: Motion;
  constraints?: ConfigConstraint[];
  /** Leg stops (issue #404, rig-c 2.56.0's `RigStop`): absent, no stop is added and no byte of any output moves. */
  stops?: ConfigStop[];
  /** The turn control (issue #251, `src/turn.ts`): absent, no control is added and no byte of any output moves. */
  turn?: TurnSpec;
  /** The painting is a scene (issue #242): absent, no byte of any output moves. */
  scene?: SceneSpec;
  /** The cloth and hair recipe `propose --cloth` drafts from (issue #364, `src/cloth.ts`): read by propose only, so no byte of any rig output moves with it. */
  cloth?: ClothRecipes;
  /** The `assemble.rig_scale` (`parts.json`'s `scale_rig_per_source`) `propose` drafted the rig sections at (issue #354): absent on a hand-authored config, held equal to `assemble.rig_scale` when present. */
  proposed_rig_scale?: number;
  /** Alternate painting sets (issue #454): absent, no alternate sets are assembled or emitted. */
  alternates?: AlternateSetConfig[];
  /**
   * The requirements file the build's check reads (issue #556), a path relative
   * to the config's directory: `build` reads it when no `--requirements` is
   * given, and refuses a flag naming a file with other bytes. Absent, nothing
   * is read and no byte of any output moves.
   */
  requirements?: string;
  /** Explicit motion observations, propagated to parts.json; absent means no added pair. */
  motion_seams?: MotionSeamDeclaration[];
}

/** `config.scene` (issue #242): the declaration that the painting is a scene. It holds no field today. */
export type SceneSpec = Readonly<Record<string, unknown>>;

/** The fields of one constraint kind, as rig-c's interface for that kind declares them. */
type ConstraintField<K extends RigSkinConstraintKey> = Exclude<keyof Extract<RigConstraint, { type: K }>, number | symbol>;

/**
 * 🔒 The bone-bearing fields of each of rig-c's five constraint kinds,
 * and whether each holds one bone name or a list of them — the one table this
 * package keeps of rigc's constraint shapes, and only of the fields that name
 * a bone. Read off `buildRigConstraint` in rig-c 2.10.1
 * (`src/compile.ts`), where each is resolved with its `needBone` (the ik's
 * `bones` and `target`, the transform's `bones` and `source`, the path's
 * `bones`, the physics constraint's `bone`, the slider's optional `bone`); a
 * path's `slot` names a slot and a slider's `animation` an animation, which
 * rigc resolves. rigc exports no such table. Each field name is typed
 * against rigc's own interface for its kind, so a rigc release that renames
 * one breaks the typecheck by name, and the selftest holds every name to
 * rigc's `RIG_KEYS` at run time (`CF66`).
 */
export const CONSTRAINT_BONE_FIELDS: { readonly [K in RigSkinConstraintKey]: ReadonlyArray<readonly [ConstraintField<K>, 'one' | 'list']> } = {
  ik: [['bones', 'list'], ['target', 'one']],
  transform: [['bones', 'list'], ['source', 'one']],
  path: [['bones', 'list']],
  physics: [['bone', 'one']],
  slider: [['bone', 'one']],
};

/**
 * The bone a constraint follows, by kind — an ik's `target`, a transform's
 * `source` (rigc: "4.2 called this target") — or none. It is what makes a
 * bone a `target` in `src/structure.ts`'s roles, and the bone the rig stage
 * declares `invariants.detached` for.
 */
export const CONSTRAINT_FOLLOWS: Readonly<Partial<Record<RigSkinConstraintKey, 'target' | 'source'>>> = { ik: 'target', transform: 'source' };

/** Whether a key on a vouched object is the loader's own door — a record or an annotation — that nothing reads. */
export function isDoorKey(key: string): boolean {
  return isRecordKey(key) || key === 'note' || key.endsWith('_note');
}

/**
 * A constraint as the rig stage hands it to rigc: every field the config
 * wrote, in the order written, but the records (`x-…`) and annotations
 * (`note`, `…_note`) the loader let ride on it — they are read by nothing,
 * and rigc refuses a key it does not read. No rigc constraint field is a
 * record or an annotation name (`CF66` holds that to rigc's `RIG_KEYS`), so
 * nothing rigc would read is left out.
 */
export function constraintForRig(c: ConfigConstraint): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(c)) if (!isDoorKey(key)) out[key] = value;
  return out;
}

/**
 * A stop as the rig stage hands it to rigc (issue #404): its fields in
 * `RigStop` order, `links` expanded from `chain` when omitted, and any records
 * (`x-…`) or annotations (`note`, `…_note`) left out.
 */
export function stopForRig(s: ConfigStop, links: readonly string[]): RigStop {
  return {
    chain: s.chain,
    links: [...links],
    against: s.against,
    at: [s.at[0], s.at[1]],
    inward: s.inward,
    outward: s.outward,
    ...(s.lower === undefined ? {} : { lower: { inward: s.lower.inward, outward: s.lower.outward } }),
  };
}

/** The single-value bone properties a sine track may drive — rigc's one-channel bone timelines. */
export const SINGLE_PROPS = ['rotate', 'translatex', 'translatey', 'scalex', 'scaley', 'shearx', 'sheary'] as const;
export type SingleProp = (typeof SINGLE_PROPS)[number];

/** The bone every rig has and no config declares. */
export const ROOT_BONE = 'root';

/** Keys from the private reference era, each with what replaces it. */
const RETIRED: Record<string, Record<string, string>> = {
  generation: {
    character_file:
      'pointed at a character file outside this tree; write its values inline instead — generation.checkpoint, generation.loras, generation.trigger, generation.identity and generation.sampler',
    art_job: 'named a job record outside this tree; put the costume words themselves in generation.costume and where they came from in generation.costume_note',
    identity_override: 'overrode the character file\'s identity; with the values inline, write the identity you want in generation.identity',
    lora_strength: 'overrode every LoRA\'s strength; with the values inline, set generation.loras[i].strength on each',
    seed0: 'recorded where a seed search started; the chosen seed is generation.seed, and the search belongs in generation.seed_note, or as a structured record in generation.x-seeds_tried',
    seeds_tried: 'recorded the seeds a search tried; the chosen seed is generation.seed, and the search belongs in generation.seed_note, or as a structured record in generation.x-seeds_tried',
  },
};

/**
 * A project's own record: a key beginning `x-` with at least one character
 * after it, holding any JSON value, read by nothing. `X-`, `x_` and a bare
 * `x-` are not record names, so a typo of one is still refused by name.
 */
function isRecordKey(key: string): boolean {
  return key.length > 2 && key.startsWith('x-');
}

/** What every refusal of a key the schema does not know adds after its own sentence: the two doors. */
const DOORS = 'a project\'s own record goes under a key beginning "x-" (any JSON, read by nothing), a remark under note or <name>_note (a string)';

// ---------------------------------------------------------------------------
// the checker
// ---------------------------------------------------------------------------

type Json = unknown;

class Check {
  readonly problems: Problem[] = [];

  fail(code: string, object: string, detail: string): void {
    this.problems.push({ code, object, detail });
  }

  /** An object with exactly these keys (plus records and annotations); returns it, or null after refusing. */
  object(path: string, v: Json, required: readonly string[], optional: readonly string[]): Record<string, Json> | null {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      this.fail('CONFIG_FIELD_TYPE', path, `is ${show(v)}; an object is required`);
      return null;
    }
    const o = v as Record<string, Json>;
    const section = path.replace(/^config\.?/, '');
    for (const key of Object.keys(o)) {
      if (required.includes(key) || optional.includes(key)) continue;
      if (isRecordKey(key)) continue;
      if (key === 'note' || key.endsWith('_note')) {
        if (typeof o[key] !== 'string') {
          this.fail('CONFIG_FIELD_TYPE', `${path}.${key}`, `is ${show(o[key])}; an annotation is a string — a structured record goes under a key beginning "x-" (any JSON, read by nothing)`);
        }
        continue;
      }
      const retired = RETIRED[section]?.[key];
      if (retired !== undefined) this.fail('CONFIG_KEY_RETIRED', `${path}.${key}`, retired);
      else this.fail('CONFIG_KEY_KNOWN', `${path}.${key}`, `is not a field here; known: ${[...required, ...optional].join(', ')} — ${DOORS}`);
    }
    for (const key of required) if (!(key in o)) this.fail('CONFIG_FIELD_PRESENT', `${path}.${key}`, 'is absent and required');
    return o;
  }

  string(path: string, v: Json, nonEmpty = true): v is string {
    if (typeof v === 'string' && (!nonEmpty || v !== '')) return true;
    this.fail('CONFIG_FIELD_TYPE', path, `is ${show(v)}; ${nonEmpty ? 'a non-empty string' : 'a string'} is required`);
    return false;
  }

  number(path: string, v: Json, rule: 'any' | 'positive' | 'non-negative' | 'unit' = 'any'): v is number {
    const ok =
      typeof v === 'number' &&
      Number.isFinite(v) &&
      (rule === 'any' || (rule === 'positive' ? v > 0 : rule === 'non-negative' ? v >= 0 : v >= 0 && v <= 1));
    if (!ok) {
      const need = { any: 'a finite number', positive: 'a number above 0', 'non-negative': 'a number at or above 0', unit: 'a number in [0, 1]' }[rule];
      this.fail('CONFIG_FIELD_TYPE', path, `is ${show(v)}; ${need} is required`);
    }
    return ok;
  }

  int(path: string, v: Json, min: number): v is number {
    if (typeof v === 'number' && Number.isInteger(v) && v >= min) return true;
    this.fail('CONFIG_FIELD_TYPE', path, `is ${show(v)}; an integer at or above ${min} is required`);
    return false;
  }

  point(path: string, v: Json): v is Point {
    if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) return true;
    this.fail('CONFIG_FIELD_TYPE', path, `is ${show(v)}; a point [x, y] in rig pixels is required`);
    return false;
  }

  array(path: string, v: Json, nonEmpty: boolean): v is Json[] {
    if (Array.isArray(v) && (!nonEmpty || v.length > 0)) return true;
    this.fail('CONFIG_FIELD_TYPE', path, `is ${show(v)}; ${nonEmpty ? 'a non-empty array' : 'an array'} is required`);
    return false;
  }
}

function show(v: Json): string {
  if (v === undefined) return 'absent';
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

/** A part name becomes a file name (`parts/<name>.png`) and a Spine slot name, so it may not be a path. */
function partNameOk(name: string): boolean {
  return name !== '' && !name.startsWith('.') && !/[\\/]/.test(name);
}

// ---------------------------------------------------------------------------
// the loader
// ---------------------------------------------------------------------------

/** The file's bytes as read and as parsed JSON, or a refusal naming why not. Every loader reads through it. */
function readConfigBytes(path: string): { raw: Json; bytes: Buffer } {
  if (!existsSync(path)) refuseIfAny([{ code: 'CONFIG_FILE_PRESENT', object: path, detail: 'no such file' }]);
  const bytes = readFileSync(path);
  let raw: Json;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    refuseIfAny([{ code: 'CONFIG_IS_JSON', object: path, detail: `does not parse as JSON: ${(err as Error).message}` }]);
  }
  return { raw, bytes };
}

/** The file as parsed JSON, or a refusal naming why not. */
function readConfigFile(path: string): Json {
  return readConfigBytes(path).raw;
}

export function loadConfig(path: string): CharacterConfig {
  return loadConfigAndAnimations(path).config;
}

/**
 * The full loader, with the bytes it parsed (issue #607): `build` hashes these
 * into `check.json`'s `config` record, so the digest is of the bytes this read
 * took, not of a later read of the same path.
 */
export function loadConfigWithBytes(path: string): { config: CharacterConfig; bytes: Buffer } {
  const { raw, bytes } = readConfigBytes(path);
  return { config: parseConfigFrom(raw, dirname(resolve(path))).config, bytes };
}

/**
 * The full loader with the file `motion.animations_from` names read beside it,
 * relative to the config's directory: every problem in either is one refusal.
 * `animations` is null when the config names no file.
 */
export function loadConfigAndAnimations(path: string): { config: CharacterConfig; animations: AnimationsFrom | null } {
  return parseConfigFrom(readConfigFile(path), dirname(resolve(path)));
}

// ---------------------------------------------------------------------------
// the early loader — before the rig exists
// ---------------------------------------------------------------------------

/**
 * Which step is reading the config before the rig exists, and so which fields
 * that step requires. The requirement is the caller's to name because it is a
 * fact about the step, not about the file: the same config legitimately lacks
 * `seethrough` when the painting is generated and must carry it when the
 * See-through images are cut.
 *
 * - `paint` — `comfy paint`, the first step of all: `key` and `generation`.
 *   Nothing else exists yet, and nothing else is read.
 * - `layers` — `inputs` and `assemble --propose-plan`: `key`, `seethrough`
 *   (`head_box` absent until `propose --head-box` has run) and
 *   `assemble.rig_scale`.
 * - `assemble` — plain `assemble`: the `layers` door plus `assemble.plan`,
 *   which `--propose-plan` printed, and `extend_below_crop` when present, both
 *   under the full loader's own rules. `bones`, `meshes`, `regions` and
 *   `motion` are drafted by `propose` from the parts this step writes, so
 *   requiring them here is what made a new character need placeholder rig
 *   fields (issue #20).
 *
 * `generation` is checked on every door when present, because that block is
 * complete before any image exists.
 */
export type EarlyDoor = 'paint' | 'layers' | 'assemble';

/** Every loader: the three early doors, and `full` — `parseConfig`, in front of `rig`, `build` and `propose --from-config`/`--compare`. */
export type ConfigDoor = EarlyDoor | 'full' | 'cloth';

/**
 * 🔒 The one statement of what each loader requires, as dotted field paths.
 * The loaders read their required keys from here — the top-level keys are the
 * first segments, `config.assemble`'s the second — and docs/AUTHORING.md §4's
 * table is compared against it by the selftest, so neither the doc nor a
 * loader can state a requirement the other does not.
 */
export const CONFIG_REQUIRES: Readonly<Record<ConfigDoor, readonly string[]>> = {
  paint: ['key', 'generation'],
  layers: ['key', 'seethrough', 'assemble.rig_scale'],
  assemble: ['key', 'seethrough', 'assemble.rig_scale', 'assemble.plan'],
  full: ['key', 'assemble.rig_scale', 'assemble.plan', 'bones', 'meshes', 'regions', 'motion'],
  cloth: ['key', 'cloth'],
};

/** The top-level keys a loader requires, in `CONFIG_REQUIRES` order. */
function topRequired(door: ConfigDoor): string[] {
  return [...new Set(CONFIG_REQUIRES[door].map((f) => f.split('.')[0]))];
}

/** The keys a loader requires inside one top-level section. */
function sectionRequired(door: ConfigDoor, section: string): string[] {
  return CONFIG_REQUIRES[door].filter((f) => f.startsWith(`${section}.`)).map((f) => f.slice(section.length + 1));
}

/** What `comfy paint` reads: the key its files are named for and the generation block it paints from. */
export interface PaintConfig {
  key: string;
  generation: Generation;
}

/**
 * What a character's config holds before its layers exist: a key, the
 * See-through block and the rig scale. `inputs` and `assemble --propose-plan`
 * run at that point, and the full loader would refuse the config for the plan,
 * bones, meshes, regions and motion that are written only after them.
 */
export interface EarlyConfig {
  depth?: DepthConfig;
  key: string;
  seethrough: SeeThrough;
  assemble: { rig_scale: number; head_face_underfill?: boolean; yield_refused?: boolean };
}

/** What plain `assemble` reads: the early config plus the plan `--propose-plan` printed. */
export interface AssembleConfig {
  depth?: DepthConfig;
  key: string;
  seethrough: SeeThrough;
  assemble: Assemble;
  scene?: SceneSpec;
  /** Issue #349: read with `bones` (the joints are the bones' origins) when present. */
  limbs?: Record<string, Limb>;
  bones?: BoneEntry[];
  /** Issue #791: read with `turn` so `assemble` leaves moving pairs' fringes and seams alone. */
  meshes?: Record<string, MeshSpec>;
  regions?: Record<string, RegionSpec>;
  constraints?: ConfigConstraint[];
  motion?: Motion;
  turn?: TurnSpec;
  motion_seams?: MotionSeamDeclaration[];
  /** Issue #354: the `rig_scale` `propose` drafted the rig sections at, held equal to `assemble.rig_scale` when present. */
  proposed_rig_scale?: number;
}

const TOP_KEYS = ['key', 'generation', 'seethrough', 'assemble', 'limbs', 'bones', 'meshes', 'regions', 'motion', 'constraints', 'stops', 'turn', 'scene', 'cloth', 'proposed_rig_scale', 'requirements', 'motion_seams', 'depth', 'waist'] as const;

/**
 * The one partial entry point. It validates exactly what its door requires —
 * with the full loader's own rules for each — plus `generation` whenever it is
 * present. The sections a later step writes may be present and are NOT read or
 * vouched for (for `paint` that is everything but `key` and `generation`; for
 * `layers`, `assemble.plan`, `extend_below_crop`, `patches`, `cuts`, `bones`, `meshes`,
 * `regions` and `motion`; for `assemble`, the last four); a caller that needs
 * them uses {@link parseConfig}. Every other key that is not a record or an
 * annotation is still refused by name, and a retired one
 * (`generation.character_file` and its kin) still with what replaces it: a
 * config is not allowed to be half-known at any stage.
 */
export function parseEarlyConfig(raw: Json, door: 'paint'): PaintConfig;
export function parseEarlyConfig(raw: Json, door: 'layers'): EarlyConfig;
export function parseEarlyConfig(raw: Json, door: 'assemble'): AssembleConfig;
export function parseEarlyConfig(raw: Json, door: EarlyDoor): PaintConfig | EarlyConfig | AssembleConfig {
  return parseEarlyConfigFrom(raw, door, null).config;
}

/** The early loader with, when `base` is the config's directory, the pose file `generation.control.skeleton` names read beside it. */
function parseEarlyConfigFrom(raw: Json, door: EarlyDoor, base: string | null): { config: PaintConfig | EarlyConfig | AssembleConfig; pose: ControlPose | null } {
  const c = new Check();
  // `generation` is taken out of the generic presence check so its absence can
  // say what the block has to hold, rather than only that it is missing.
  const needed = topRequired(door);
  const required = needed.filter((k) => k !== 'generation');
  const top = c.object('config', raw, required, TOP_KEYS.filter((k) => !required.includes(k)));
  if (top === null) refuseIfAny(c.problems);
  const t = top as Record<string, Json>;
  if ('depth' in t) checkDepthConfig(c, t.depth);
  if ('waist' in t) checkWaistDeclaration(c, t.waist);
  if ('key' in t) c.string('config.key', t.key);
  if ('generation' in t) checkGeneration(c, t.generation);
  else if (needed.includes('generation')) {
    c.fail(
      'CONFIG_FIELD_PRESENT',
      'config.generation',
      `is absent and required; comfy paint generates from it and nothing else — ${GENERATION_REQUIRED.join(', ')}, and pose or control`,
    );
  }
  if (door === 'layers') {
    if ('seethrough' in t) checkSeeThrough(c, t.seethrough);
    if ('assemble' in t) {
      const a = c.object('config.assemble', t.assemble, sectionRequired(door, 'assemble'), ['plan', 'extend_below_crop', 'patches', 'cuts', 'alternates', 'head_face_underfill', 'yield_refused']);
      if (a !== null) {
        if ('rig_scale' in a) c.number('config.assemble.rig_scale', a.rig_scale, 'positive');
        if ('head_face_underfill' in a && typeof a.head_face_underfill !== 'boolean') {
          c.fail('CONFIG_FIELD_TYPE', 'config.assemble.head_face_underfill', `is ${show(a.head_face_underfill)}; true or false is required`);
        }
        if ('yield_refused' in a && typeof a.yield_refused !== 'boolean') {
          c.fail('CONFIG_FIELD_TYPE', 'config.assemble.yield_refused', `is ${show(a.yield_refused)}; true or false is required`);
        }
      }
    }
  }
  if (door === 'assemble') {
    if ('seethrough' in t) checkSeeThrough(c, t.seethrough);
    const made = 'assemble' in t ? checkAssemble(c, t.assemble, door) : { parts: [], patches: [], cuts: [] };
    checkProposedRigScale(c, t);
    if ('scene' in t) checkScene(c, t.scene);
    // Issue #349: the limbs' joints are their bones' origins, so the bones are read with them, and only then.
    let limbs: LimbNames | null = null;
    let names: { bones: Set<string>; chains: Map<string, number>; parents: Map<string, string> } | null = null;
    const hasTips = isPlainObject(t.assemble) && Array.isArray(t.assemble.alternates) && t.assemble.alternates.some((a) => isPlainObject(a) && 'tips' in a);
    if (hasTips && !('bones' in t)) c.fail('CONFIG_FIELD_PRESENT', 'config.bones', 'is absent; alternate tips name declared bones, so assemble reads bones when tips are supplied');
    if (hasTips && 'bones' in t && !('limbs' in t)) names = checkBones(c, t.bones);
    if ('limbs' in t) {
      if (!('bones' in t)) c.fail('CONFIG_FIELD_PRESENT', 'config.bones', 'is absent; config.limbs names bones, and each joint is its bone\'s origin, so assemble reads the bones with the limbs');
      names = 'bones' in t ? checkBones(c, t.bones) : null;
      limbs = checkLimbs(c, t.limbs, made, names);
    }
    if (isPlainObject(t.assemble) && 'alternates' in t.assemble) {
      checkAlternates(c, t.assemble.alternates, made, limbs, names?.bones ?? null, names?.chains ?? null, t.regions, t.meshes);
    }
    const output = new Set([...made.parts.filter(n => !limbs?.consumed.has(n)), ...made.patches, ...made.cuts, ...(limbs?.parts.keys() ?? [])]);
    if ('motion_seams' in t) {
      c.problems.push(...motionSeamProblems(t.motion_seams, output, 'config.motion_seams', 'CONFIG_MOTION_SEAM'));
    }
    if ('turn' in t) {
      if ('bones' in t && names === null) names = checkBones(c, t.bones);
      const attached = 'meshes' in t || 'regions' in t ? attachedParts(t.meshes, t.regions) : output;
      const hasAltFace = hasAlternateFaceSet(t.assemble, [...made.parts, ...made.cuts]);
      const declaredSliders = new Set<string>();
      if (Array.isArray(t.constraints)) {
        for (const entry of t.constraints) {
          if (isPlainObject(entry) && entry.type === 'slider' && typeof entry.name === 'string' && entry.name.length > 0) {
            declaredSliders.add(entry.name);
          }
        }
      }
      const meshParts = isPlainObject(t.meshes) ? new Set(Object.keys(t.meshes).filter((k) => !isRecordKey(k))) : new Set<string>();
      checkTurn(c, t.turn, attached, names?.bones ?? new Set(['root', 'head', 'chest', 'hip']), hasAltFace, made.parts, declaredSliders, meshParts);
    }
  }
  if ('cloth' in t) checkCloth(c, t.cloth);
  const pose = base === null ? null : poseBeside(c, t.generation, base);
  refuseIfAny(c.problems);
  const config = raw as PaintConfig | EarlyConfig | AssembleConfig;
  const controlSkel = resolveControlSkeleton(t.generation, pose);
  if (controlSkel !== undefined) controlSkeletons.set(config, controlSkel);
  return { config, pose };
}

export function loadEarlyConfig(path: string, door: 'paint'): PaintConfig;
export function loadEarlyConfig(path: string, door: 'layers'): EarlyConfig;
export function loadEarlyConfig(path: string, door: 'assemble'): AssembleConfig;
export function loadEarlyConfig(path: string, door: EarlyDoor): PaintConfig | EarlyConfig | AssembleConfig {
  return parseEarlyConfigFrom(readConfigFile(path), door, dirname(resolve(path))).config;
}

/**
 * `comfy paint`'s loader: the `paint` door, and the pose file
 * `generation.control.skeleton` names read beside the config (issue #198).
 * `pose` is null when the control is a built-in skeleton or absent.
 */
export function loadPaintConfig(path: string): { config: PaintConfig; pose: ControlPose | null } {
  const { config, pose } = parseEarlyConfigFrom(readConfigFile(path), 'paint', dirname(resolve(path)));
  return { config: config as PaintConfig, pose };
}

/**
 * Issue #490: the control skeleton `config.generation.control.skeleton` names,
 * with its points on the `generation.latent` canvas (`[w, h]`, x right, y down).
 */
export interface ControlSkeleton {
  latent: readonly [number, number];
  points: PosePoints;
}

const controlSkeletons = new WeakMap<object, ControlSkeleton>();

function resolveControlSkeleton(gen: Json, pose: ControlPose | null): ControlSkeleton | undefined {
  if (!isPlainObject(gen) || !isPlainObject(gen.control)) return undefined;
  const l = gen.latent;
  if (!(Array.isArray(l) && l.length === 2 && typeof l[0] === 'number' && typeof l[1] === 'number' && l[0] > 0 && l[1] > 0)) return undefined;
  const latent: readonly [number, number] = [l[0], l[1]];
  if (pose !== null) return { latent, points: pose.points };
  const skel = gen.control.skeleton;
  if (isSkeletonName(skel)) return { latent, points: scaledPoints(skel, latent[0], latent[1]) };
  return undefined;
}

/**
 * Return the {@link ControlSkeleton} resolved for a loaded or parsed config
 * (`loadEarlyConfig`, `loadConfig`, `parseEarlyConfig`, `parseConfig`), or
 * computed from an inline `generation.control.skeleton` built-in when present.
 */
export function controlSkeletonOf(cfg: object): ControlSkeleton | undefined {
  const cached = controlSkeletons.get(cfg);
  if (cached !== undefined) return cached;
  const gen = (cfg as { generation?: unknown }).generation;
  return resolveControlSkeleton(gen, null);
}

/** Clone a config and its already resolved control pose, without reading a relative file again. */
export function cloneConfig<T extends object>(cfg: T): T {
  const clone = structuredClone(cfg);
  const skeleton = controlSkeletonOf(cfg);
  if (skeleton !== undefined) controlSkeletons.set(clone, structuredClone(skeleton));
  return clone;
}

/** The pose file a checked `generation` block's control names, read relative to `base`; null for a built-in, an absent control, or a block already refused. */
function poseBeside(c: Check, gen: Json, base: string): ControlPose | null {
  if (!isPlainObject(gen) || !isPlainObject(gen.control)) return null;
  const skel = gen.control.skeleton;
  if (typeof skel !== 'string' || skel === '' || isSkeletonName(skel)) return null;
  const l = gen.latent;
  const latent = Array.isArray(l) && l.length === 2 && l.every((n) => typeof n === 'number' && Number.isInteger(n) && n > 0) ? ([l[0], l[1]] as [number, number]) : null;
  return readControlPose(c, resolve(base, skel), latent);
}

/**
 * Read the pose file `generation.control.skeleton` names (issue #198), every
 * problem collected in `c`. The file is the built-ins' shape, stated by its
 * fields: `{"width": W, "height": H, "points": {"nose": [x, y], …}}` — the
 * canvas the points are in, which is `generation.latent` (the control image is
 * drawn at the latent size and the points are not scaled), and the 18 body-18
 * keypoints by name, each `[x, y]` in that canvas's pixels, x right, y down.
 *
 * - `CONFIG_FILE_PRESENT`: no such file, or one that cannot be read — the
 *   detail names the built-ins too, since a misspelt built-in lands here.
 * - `CONFIG_IS_JSON`: the text does not parse.
 * - `CONFIG_FIELD_TYPE` / `CONFIG_KEY_KNOWN` / `CONFIG_FIELD_PRESENT`: not an
 *   object; a key besides the three (and the annotation and record doors);
 *   one of the three absent; a size that is not a whole positive pixel count;
 *   a point that is not two finite numbers.
 * - `CONFIG_KEY_UNIQUE`: a key written twice (`JSON.parse` keeps the last).
 * - `CONFIG_POSE_CANVAS`: `width` x `height` is not `generation.latent`.
 * - `CONFIG_POSE_KEYPOINTS`: `points` holds another count than the 18, or a
 *   name that is not body-18; the found and required counts and the names.
 * - `CONFIG_POSE_IN_CANVAS`: a point outside `0 <= x <= width`, `0 <= y <=
 *   height` (continuous canvas coordinates, the edges inside, as
 *   `src/keypoints.ts` reads a joint), named with the canvas size.
 *
 * Returns the pose when this file added no problem, else null.
 */
function readControlPose(c: Check, file: string, latent: [number, number] | null): ControlPose | null {
  const field = 'config.generation.control.skeleton';
  const shape = `${SKELETON_NAMES.map((n) => `"${n}"`).join(' or ')}, or a pose file {"width": W, "height": H, "points": {"nose": [x, y], …the 18 body-18 keypoints}} at a path relative to the config's directory, is required`;
  if (!existsSync(file) || !statSync(file).isFile()) {
    c.fail('CONFIG_FILE_PRESENT', field, `names ${file}, which is neither a built-in skeleton nor a file; ${shape}`);
    return null;
  }
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    c.fail('CONFIG_FILE_PRESENT', field, `names ${file}, which cannot be read: ${(err as Error).message}; ${shape}`);
    return null;
  }
  let raw: Json;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    c.fail('CONFIG_IS_JSON', `${field} (${file})`, `does not parse as JSON: ${(err as Error).message}`);
    return null;
  }
  const before = c.problems.length;
  const at = `${field} (${file})`;
  for (const r of repeatedKeys(text)) {
    c.fail('CONFIG_KEY_UNIQUE', `${at}${r.at === '' ? '' : `.${r.at}`}`, `names "${r.key}" ${r.count === 2 ? 'twice' : `${r.count} times`}; each key once is required — JSON keeps only the last, so every value but the last would be dropped without a word`);
  }
  const o = c.object(at, raw, ['width', 'height', 'points'], []);
  if (o === null) return null;
  const w = 'width' in o && c.int(`${at}.width`, o.width, 1) ? o.width : null;
  const h = 'height' in o && c.int(`${at}.height`, o.height, 1) ? o.height : null;
  if (w !== null && h !== null && latent !== null && (w !== latent[0] || h !== latent[1])) {
    c.fail('CONFIG_POSE_CANVAS', at, `states a ${w}x${h} canvas; generation.latent's ${latent[0]}x${latent[1]} is required — the control image is drawn at the latent size and the points are read in its pixels, not scaled`);
  }
  const points = {} as Record<KeypointName, readonly [number, number]>;
  if ('points' in o) {
    const pts = o.points;
    if (!isPlainObject(pts)) {
      c.fail('CONFIG_FIELD_TYPE', `${at}.points`, `is ${show(pts)}; an object of the 18 body-18 keypoints by name, each [x, y], is required`);
    } else {
      const names = Object.keys(pts);
      const missing = KEYPOINT_NAMES.filter((k) => !(k in pts));
      const unknown = names.filter((k) => !(KEYPOINT_NAMES as readonly string[]).includes(k));
      if (missing.length > 0 || unknown.length > 0) {
        c.fail(
          'CONFIG_POSE_KEYPOINTS',
          `${at}.points`,
          `holds ${names.length} keypoint(s); the ${KEYPOINT_NAMES.length} body-18 keypoints are required, each once (${KEYPOINT_NAMES.join(', ')})${missing.length > 0 ? ` — missing: ${missing.join(', ')}` : ''}${unknown.length > 0 ? ` — not body-18: ${unknown.join(', ')}` : ''}`,
        );
      }
      for (const k of KEYPOINT_NAMES) {
        if (!(k in pts)) continue;
        const v = pts[k];
        if (!(Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)))) {
          c.fail('CONFIG_FIELD_TYPE', `${at}.points.${k}`, `is ${show(v)}; a point [x, y] in canvas pixels is required`);
          continue;
        }
        const [x, y] = v as [number, number];
        if (w !== null && h !== null && !(x >= 0 && x <= w && y >= 0 && y <= h)) {
          c.fail('CONFIG_POSE_IN_CANVAS', `${at}.points.${k}`, `is [${x}, ${y}]; a point inside the ${w}x${h} canvas is required, 0 <= x <= ${w} and 0 <= y <= ${h}`);
        }
        points[k] = [x, y];
      }
    }
  }
  if (c.problems.length > before) return null;
  return { file, points };
}

/**
 * Validate a parsed config. Every problem found is thrown at once, as one
 * `PartsError`. With no path to resolve against, `motion.animations_from` is
 * checked as a non-empty string and its file is not read ({@link loadConfig} reads it).
 */
export function parseConfig(raw: Json): CharacterConfig {
  return parseConfigFrom(raw, null).config;
}

function parseConfigFrom(raw: Json, base: string | null): { config: CharacterConfig; animations: AnimationsFrom | null } {
  const c = new Check();
  const required = topRequired('full');
  const top = c.object('config', raw, required, TOP_KEYS.filter((k) => !required.includes(k)));
  if (top === null) refuseIfAny(c.problems);
  const t = top as Record<string, Json>;
  if ('depth' in t) checkDepthConfig(c, t.depth);
  if ('waist' in t) checkWaistDeclaration(c, t.waist);
  if ('key' in t) c.string('config.key', t.key);
  if ('generation' in t) checkGeneration(c, t.generation);
  if ('seethrough' in t) checkSeeThrough(c, t.seethrough);
  const { parts, patches, cuts } = 'assemble' in t ? checkAssemble(c, t.assemble, 'full') : { parts: [], patches: [], cuts: [] };
  checkProposedRigScale(c, t);
  const names = 'bones' in t ? checkBones(c, t.bones) : { bones: new Set<string>([ROOT_BONE]), chains: new Map<string, number>(), parents: new Map<string, string>() };
  const limbs = 'limbs' in t ? checkLimbs(c, t.limbs, { parts, patches, cuts }, 'bones' in t ? names : null) : null;
  if (isPlainObject(t.assemble) && 'alternates' in t.assemble) {
    checkAlternates(c, t.assemble.alternates, { parts, patches, cuts }, limbs, names.bones, names.chains, t.regions, t.meshes);
  }
  if ('meshes' in t) checkMeshes(c, t.meshes, names.bones, names.chains, t.stops);
  if ('regions' in t) checkRegions(c, t.regions, names.bones);
  if ('meshes' in t && 'regions' in t && 'assemble' in t) checkCoverage(c, [...parts, ...cuts], patches, t.meshes, t.regions, limbs);
  if ('motion' in t) checkMotion(c, t.motion, names.bones, names.chains, 'regions' in t ? t.regions : undefined);
  if ('constraints' in t) checkConstraints(c, t.constraints, names.bones, names.parents);
  if ('stops' in t) checkStops(c, t.stops, names.bones, names.chains);
  if ('waist' in t && isPlainObject(t.waist)) {
    for (const field of ['upper', 'lower'] as const) if (typeof t.waist[field] === 'string' && !names.bones.has(t.waist[field])) c.fail('CONFIG_WAIST_BINDING', `config.waist.${field}`, `names ${JSON.stringify(t.waist[field])}; a declared bone is required`);
    for (const [field, map] of [['top', t.meshes], ['bottom', t.regions]] as const) if (typeof t.waist[field] === 'string' && (!isPlainObject(map) || !Object.hasOwn(map, t.waist[field]))) c.fail('CONFIG_WAIST_BINDING', `config.waist.${field}`, `names ${JSON.stringify(t.waist[field])}; ${field === 'top' ? 'a declared mesh' : 'a declared region'} is required`);
    if (typeof t.waist.bone === 'string' && names.bones.has(t.waist.bone)) c.fail('CONFIG_WAIST_NAME_FREE', 'config.waist.bone', `bone ${JSON.stringify(t.waist.bone)} already exists; an unused generated name is required`);
  }
  const attached = attachedParts(t.meshes, t.regions);
  if ('motion_seams' in t) c.problems.push(...motionSeamProblems(t.motion_seams, attached, 'config.motion_seams', 'CONFIG_MOTION_SEAM'));
  const hasAltFace = hasAlternateFaceSet(t.assemble, [...parts, ...cuts]);
  const declaredSliders = new Set<string>();
  if (Array.isArray(t.constraints)) {
    for (const entry of t.constraints) {
      if (isPlainObject(entry) && entry.type === 'slider' && typeof entry.name === 'string' && entry.name.length > 0) {
        declaredSliders.add(entry.name);
      }
    }
  }
  const meshParts = isPlainObject(t.meshes) ? new Set(Object.keys(t.meshes).filter((k) => !isRecordKey(k))) : new Set<string>();
  if ('turn' in t) checkTurn(c, t.turn, attached, names.bones, hasAltFace, parts, declaredSliders, meshParts, t.meshes, names.chains, names.parents);
  if ('scene' in t) checkScene(c, t.scene);
  if ('cloth' in t) checkCloth(c, t.cloth);
  if ('requirements' in t && c.string('config.requirements', t.requirements) && base !== null) checkRequirementsFile(c, resolve(base, t.requirements));
  const from = isPlainObject(t.motion) ? t.motion.animations_from : undefined;
  const animations = base !== null && typeof from === 'string' && from !== '' ? readAnimationsFrom(c, base, from) : null;
  if (animations !== null) {
    checkFaceAnimationBand(c, animations, hasAltFace, t.turn, attached);
    const baseSlots = new Set<string>([...parts.filter((n) => !(limbs?.consumed.has(n) ?? false)), ...patches, ...cuts, ...(limbs?.parts.keys() ?? [])]);
    checkAnimationSetKeys(c, animations, t.assemble, new Set<string>([...parts, ...patches, ...cuts, ...(limbs?.parts.keys() ?? []), ...explicitIslandSlotNames(baseSlots, t.meshes)]));
  }
  const pose = base === null ? null : poseBeside(c, t.generation, base);
  refuseIfAny(c.problems);
  const config = raw as CharacterConfig;
  const controlSkel = resolveControlSkeleton(t.generation, pose);
  if (controlSkel !== undefined) controlSkeletons.set(config, controlSkel);
  return { config, animations };
}

/**
 * Issue #354: `propose` records `parts.json`'s `scale_rig_per_source` on the
 * proposal as `proposed_rig_scale`, and pasting the proposal into `config.json`
 * carries it. When present, `assemble`, `rig` and `build` compare it against
 * `assemble.rig_scale` and refuse a mismatch: the bones, mesh spacings, segment
 * coordinates and motion amplitudes are in the proposed rig canvas's pixels and
 * do not scale when `assemble.rig_scale` changes. A hand-authored config with
 * no `proposed_rig_scale` is not refused.
 */
function checkProposedRigScale(c: Check, t: Record<string, Json>): void {
  if (!('proposed_rig_scale' in t)) return;
  if (!c.number('config.proposed_rig_scale', t.proposed_rig_scale, 'positive')) return;
  const a = isPlainObject(t.assemble) ? t.assemble : null;
  if (a === null || !('rig_scale' in a) || !(typeof a.rig_scale === 'number' && Number.isFinite(a.rig_scale) && a.rig_scale > 0)) return;
  if (t.proposed_rig_scale !== a.rig_scale) {
    c.fail(
      'CONFIG_PROPOSED_RIG_SCALE',
      'config.proposed_rig_scale',
      `is ${t.proposed_rig_scale}, and config.assemble.rig_scale is ${a.rig_scale} — the bones, meshes, limbs and motion were proposed at rig_scale ${t.proposed_rig_scale} and are in that rig canvas's pixels, so they do not scale when assemble.rig_scale changes; re-run assemble and propose at rig_scale ${a.rig_scale} and paste the new proposal, or restore config.assemble.rig_scale to ${t.proposed_rig_scale}`,
    );
  }
}

function isPlainObject(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Issue #556: the file `config.requirements` names is on disk —
 * `CONFIG_FILE_PRESENT` otherwise, as `motion.animations_from`'s. Its shape is
 * the requirements reader's (`src/requirements.ts`), which `build` runs on it
 * before assemble, as on the flag's file.
 */
function checkRequirementsFile(c: Check, file: string): void {
  if (existsSync(file) && statSync(file).isFile()) return;
  c.fail('CONFIG_FILE_PRESENT', 'config.requirements', `names ${file}, which is no such file; a ${REQUIREMENTS_SPEC} file, its path relative to the config's directory, is required`);
}

/**
 * Read the file `motion.animations_from` names (issue #183) and vouch for what
 * merging its animations beside the idle needs, every problem collected in `c`:
 *
 * - `CONFIG_FILE_PRESENT`: no such file, or a file that cannot be read. The
 *   line names the path as typed, the config's directory it was resolved
 *   against and what that gave (issue #569): the path is read beside the
 *   config, not in the working directory, and a reader who cannot see the
 *   disk needs all three to tell which was wrong.
 * - `CONFIG_IS_JSON`: the text does not parse.
 * - `CONFIG_FIELD_TYPE`: the file is not an object, its `spec` is not
 *   "rigc-motion/1", its `animations` is not an object, or an animation in it
 *   is not one. `CONFIG_KEY_KNOWN` / `CONFIG_FIELD_PRESENT`: a key besides
 *   `spec` and `animations` (and the annotation and record doors), or one of
 *   the two absent; an absent `spec` is told the line to write and the whole
 *   file's shape (issue #569), from {@link ANIMATIONS_FROM_SPEC}. rig-c's `easings`, `groups`, `setup`, `physics` and `mix`
 *   are refused rather than dropped: `motion.json`'s own are this package's,
 *   and a table read and not written would be a value lost without a word.
 * - `CONFIG_ANIMATION_NAME_FREE`: an animation named `idle`, the one the
 *   config's own `motion` writes.
 * - `CONFIG_KEY_UNIQUE`: a key written twice in one object of the file.
 *   `JSON.parse` keeps the last and drops the others silently, so the file's
 *   text is read for it ({@link repeatedKeys}).
 *
 * Returns the animations when this file added no problem, else null.
 */
function readAnimationsFrom(c: Check, base: string, from: string): AnimationsFrom | null {
  const field = 'config.motion.animations_from';
  const file = resolve(base, from);
  const form = `{"spec": "${ANIMATIONS_FROM_SPEC}", "animations": {"<name>": {"duration": …, "tracks": [...]}}}`;
  const shape = `a file in rig-c's motion-spec shape, ${form}, its path relative to the config's directory`;
  const where = `names ${JSON.stringify(from)}, resolved against the config's directory ${base} (not the working directory) to ${file}`;
  if (!existsSync(file) || !statSync(file).isFile()) {
    c.fail('CONFIG_FILE_PRESENT', field, `${where}, which is no such file; ${shape} is required`);
    return null;
  }
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    c.fail('CONFIG_FILE_PRESENT', field, `${where}, which cannot be read: ${(err as Error).message}; ${shape} is required`);
    return null;
  }
  let raw: Json;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    c.fail('CONFIG_IS_JSON', `${field} (${file})`, `does not parse as JSON: ${(err as Error).message}`);
    return null;
  }
  const before = c.problems.length;
  const at = `${field} (${file})`;
  if (!isPlainObject(raw)) {
    c.fail('CONFIG_FIELD_TYPE', at, `is ${show(raw)}; ${shape} is required`);
    return null;
  }
  for (const r of repeatedKeys(text)) {
    c.fail(
      'CONFIG_KEY_UNIQUE',
      `${at}${r.at === '' ? '' : `.${r.at}`}`,
      `names "${r.key}" ${r.count === 2 ? 'twice' : `${r.count} times`}; each key once is required — JSON keeps only the last, so ${r.at === 'animations' ? 'every animation of that name but the last' : 'every value but the last'} would be dropped without a word`,
    );
  }
  // Both keys are required; `c.object` is given them as optional so an absent
  // `spec` can be told the line to write, in the order `c.object` names them.
  const o = c.object(at, raw, [], ['spec', 'animations']);
  if (o !== null && !('spec' in o)) {
    c.fail('CONFIG_FIELD_PRESENT', `${at}.spec`, `is absent and required: write "spec": "${ANIMATIONS_FROM_SPEC}" beside "animations", the motion-spec version motion.json states — the whole file is ${form}`);
  }
  if (o !== null && !('animations' in o)) c.fail('CONFIG_FIELD_PRESENT', `${at}.animations`, 'is absent and required');
  if (o !== null && 'spec' in o && o.spec !== ANIMATIONS_FROM_SPEC) {
    c.fail('CONFIG_FIELD_TYPE', `${at}.spec`, `is ${show(o.spec)}; "${ANIMATIONS_FROM_SPEC}" is required, the motion-spec version motion.json states`);
  }
  if (o !== null && 'animations' in o) {
    if (!isPlainObject(o.animations)) {
      c.fail('CONFIG_FIELD_TYPE', `${at}.animations`, `is ${show(o.animations)}; a table keyed by animation name is required, {"<name>": {"duration": …, "tracks": [...]}}`);
    } else {
      for (const [name, anim] of Object.entries(o.animations)) {
        if (name === 'idle') {
          c.fail('CONFIG_ANIMATION_NAME_FREE', `${at}.animations.idle`, 'is the idle, which config.motion writes; an animation beside it needs another name');
        } else if (!isPlainObject(anim)) {
          c.fail('CONFIG_FIELD_TYPE', `${at}.animations.${name}`, `is ${show(anim)}; an animation object in rig-c's motion-spec shape is required ({"duration": …, "tracks": [...]}, and what else rigc reads)`);
        }
      }
    }
  }
  if (c.problems.length > before || o === null) return null;
  return { file, table: o.animations as Record<string, unknown> };
}

/**
 * Every key an object in the JSON `text` names more than once, with the
 * object's dotted path (`""` for the top level, `animations.smile.tracks[0]`
 * below it) and how many times — what `JSON.parse` folds into its last value
 * without a word. `text` must already parse; the walk is a reader of valid
 * JSON only, and keys are compared after their escapes are decoded.
 */
export function repeatedKeys(text: string): Array<{ at: string; key: string; count: number }> {
  const out: Array<{ at: string; key: string; count: number }> = [];
  let i = 0;
  const ws = (): void => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const str = (): string => {
    const start = i;
    i++;
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (at: string): void => {
    ws();
    const ch = text[i];
    if (ch === '{') {
      i++;
      const seen = new Map<string, number>();
      ws();
      if (text[i] === '}') {
        i++;
        return;
      }
      for (;;) {
        ws();
        const key = str();
        seen.set(key, (seen.get(key) ?? 0) + 1);
        ws();
        i++; // the colon
        value(at === '' ? key : `${at}.${key}`);
        ws();
        if (text[i++] === '}') break;
      }
      for (const [key, count] of seen) if (count > 1) out.push({ at, key, count });
    } else if (ch === '[') {
      i++;
      ws();
      if (text[i] === ']') {
        i++;
        return;
      }
      for (let k = 0; ; k++) {
        value(`${at}[${k}]`);
        ws();
        if (text[i++] === ']') break;
      }
    } else if (ch === '"') str();
    else while (i < text.length && !',]} \t\n\r'.includes(text[i])) i++;
  };
  value('');
  return out;
}

/** The four sections `propose` drafts and a config carries: what a skeleton comparison reads of either. */
export interface SkeletonSections {
  bones: BoneEntry[];
  meshes: Record<string, MeshSpec>;
  regions: Record<string, RegionSpec>;
  motion: Motion;
}

/**
 * A `proposal.json` as `propose` writes it — `bones`, `meshes`, `regions`,
 * `motion` and `notes` (strings), `limbs` when `propose --keypoints` drafted
 * them (issue #349), `constraints` when `propose --cloth` did (issue #364;
 * both read here since issue #372, whose `wind` example tracks such a
 * proposal), and `proposed_rig_scale` (issue #354) — under the full loader's own rules for those sections (issue
 * #85). There is no plan to hold the meshes, regions and limbs against, so
 * the coverage rule (every plan part exactly one of a mesh or a region) is
 * not run, and a limb segment's `from` is held to no plan part (the parts
 * the limbs take are the ones they name); `propose` held its proposal to
 * both before writing (`checkProposal`). A key the loader would not take is
 * refused by name, as in a config. Refusals name the fields `proposal.…`.
 */
export function parseProposalSections(raw: Json): SkeletonSections & { limbs?: Record<string, Limb>; constraints?: ConfigConstraint[]; stops?: ConfigStop[]; proposed_rig_scale?: number; motion_seams?: MotionSeamDeclaration[] } {
  const c = new Check();
  const top = c.object('config', raw, ['bones', 'meshes', 'regions', 'motion'], ['notes', 'limbs', 'constraints', 'stops', 'proposed_rig_scale', 'motion_seams']);
  if (top !== null) {
    const names = 'bones' in top ? checkBones(c, top.bones) : { bones: new Set<string>([ROOT_BONE]), chains: new Map<string, number>(), parents: new Map<string, string>() };
    if ('limbs' in top) {
      const taken = isPlainObject(top.limbs)
        ? Object.values(top.limbs).flatMap((l) => (isPlainObject(l) && Array.isArray(l.segments) ? l.segments.flatMap((sg) => (isPlainObject(sg) && typeof sg.from === 'string' ? [sg.from] : [])) : []))
        : [];
      checkLimbs(c, top.limbs, { parts: [...new Set(taken)], patches: [], cuts: [] }, names, false);
    }
    if ('meshes' in top) checkMeshes(c, top.meshes, names.bones, names.chains, top.stops);
    if ('regions' in top) checkRegions(c, top.regions, names.bones);
    if ('motion_seams' in top) c.problems.push(...motionSeamProblems(top.motion_seams, attachedParts(top.meshes, top.regions), 'config.motion_seams', 'CONFIG_MOTION_SEAM'));
    if ('motion' in top) checkMotion(c, top.motion, names.bones, names.chains, 'regions' in top ? top.regions : undefined);
    if ('constraints' in top) checkConstraints(c, top.constraints, names.bones, names.parents);
    if ('stops' in top) checkStops(c, top.stops, names.bones, names.chains);
    if ('proposed_rig_scale' in top) c.number('config.proposed_rig_scale', top.proposed_rig_scale, 'positive');
    if ('notes' in top && c.array('config.notes', top.notes, false)) (top.notes as Json[]).forEach((n, i) => c.string(`config.notes[${i}]`, n, false));
  }
  refuseIfAny(c.problems.map((p) => ({ ...p, object: p.object.replace(/^config\b/, 'proposal') })));
  return raw as SkeletonSections & { limbs?: Record<string, Limb>; constraints?: ConfigConstraint[]; stops?: ConfigStop[]; proposed_rig_scale?: number; motion_seams?: MotionSeamDeclaration[] };
}

/**
 * `motion.blink.still`: part name -> `{row, bone}`. The part must be a region
 * whose bone the blink's `eyes` names — a cut on anything else holds nothing
 * still that was moving — and `bone` must be declared and must not be one of
 * the blink's eyes, or the still piece would blink with the rest.
 */
function checkBlinkStill(c: Check, v: Json, eyes: Json, bones: Set<string>, regions: Json): void {
  const at = 'config.motion.blink.still';
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    c.fail('CONFIG_FIELD_TYPE', at, `is ${show(v)}; an object of part name -> {row, bone} is required`);
    return;
  }
  const eyeList = Array.isArray(eyes) ? eyes.filter((e): e is string => typeof e === 'string') : [];
  const regionOf = typeof regions === 'object' && regions !== null && !Array.isArray(regions) ? (regions as Record<string, Json>) : {};
  for (const [part, entry] of Object.entries(v as Record<string, Json>)) {
    const e = c.object(`${at}.${part}`, entry, ['row', 'bone'], []);
    if (e === null) continue;
    if ('row' in e) c.int(`${at}.${part}.row`, e.row, 0);
    if ('bone' in e) {
      if (typeof e.bone !== 'string' || !bones.has(e.bone)) c.fail('CONFIG_NAME_RESOLVES', `${at}.${part}.bone`, `is ${show(e.bone)}; a declared bone is required`);
      else if (eyeList.includes(e.bone)) {
        c.fail('CONFIG_STILL_OFF_THE_BLINK', `${at}.${part}.bone`, `is "${e.bone}", which config.motion.blink.eyes names, so the still piece would blink too; a bone the blink does not key is required (the eye bone's parent, as propose writes it)`);
      }
    }
    const rb = Object.prototype.hasOwnProperty.call(regionOf, part) ? rawRegionBone(regionOf[part]) : undefined;
    if (typeof rb !== 'string') {
      c.fail('CONFIG_NAME_RESOLVES', `${at}.${part}`, `names "${part}", which config.regions does not attach; a region part is required — a mesh is not cut`);
    } else if (!eyeList.includes(rb)) {
      c.fail(
        'CONFIG_STILL_OFF_THE_BLINK',
        `${at}.${part}`,
        `names a region on "${rb}", which config.motion.blink.eyes (${eyeList.join(', ') || 'none'}) does not name, so the blink never moves it and there is nothing to hold still; a region on a blinking eye bone is required`,
      );
    }
  }
}

/**
 * A pose file `generation.control.skeleton` names, as read (issue #198): its
 * 18 body-18 keypoints, in the pixels of the `generation.latent` canvas the
 * file states, drawn as given.
 */
export interface ControlPose {
  /** The file, resolved against the config's directory. */
  file: string;
  points: PosePoints;
}

/** The fields every generation block carries; `pose` or `control` is required besides, checked below. */
const GENERATION_REQUIRED = ['checkpoint', 'loras', 'trigger', 'identity', 'sampler', 'costume', 'negative_extra', 'style', 'negative_pose', 'latent', 'seed'] as const;

function checkGeneration(c: Check, v: Json): void {
  const g = c.object('config.generation', v, GENERATION_REQUIRED, ['pose', 'control']);
  if (g === null) return;
  const p = 'config.generation';
  for (const key of ['checkpoint', 'identity', 'costume', 'style', 'negative_pose'] as const) if (key in g) c.string(`${p}.${key}`, g[key]);
  for (const key of ['trigger', 'negative_extra'] as const) if (key in g) c.string(`${p}.${key}`, g[key], false);
  if ('pose' in g) c.string(`${p}.pose`, g.pose);
  if ('seed' in g) c.int(`${p}.seed`, g.seed, 0);
  if ('latent' in g) {
    const l = g.latent;
    if (!(Array.isArray(l) && l.length === 2 && l.every((n) => typeof n === 'number' && Number.isInteger(n) && n > 0))) {
      c.fail('CONFIG_FIELD_TYPE', `${p}.latent`, `is ${show(l)}; [width, height] in positive integers is required`);
    }
  }
  if ('loras' in g && c.array(`${p}.loras`, g.loras, false)) {
    (g.loras as Json[]).forEach((lo, i) => {
      const o = c.object(`${p}.loras[${i}]`, lo, ['name', 'strength'], ['strength_clip']);
      if (o === null) return;
      if ('name' in o) c.string(`${p}.loras[${i}].name`, o.name);
      if ('strength' in o) c.number(`${p}.loras[${i}].strength`, o.strength);
      if ('strength_clip' in o) c.number(`${p}.loras[${i}].strength_clip`, o.strength_clip);
    });
  }
  if ('sampler' in g) {
    const s = c.object(`${p}.sampler`, g.sampler, ['steps', 'cfg', 'sampler', 'scheduler'], []);
    if (s !== null) {
      if ('steps' in s) c.int(`${p}.sampler.steps`, s.steps, 1);
      if ('cfg' in s) c.number(`${p}.sampler.cfg`, s.cfg, 'positive');
      if ('sampler' in s) c.string(`${p}.sampler.sampler`, s.sampler);
      if ('scheduler' in s) c.string(`${p}.sampler.scheduler`, s.scheduler);
    }
  }
  if ('control' in g) {
    const k = c.object(`${p}.control`, g.control, ['skeleton', 'strength', 'end_percent'], ['model']);
    if (k !== null) {
      if ('skeleton' in k && (typeof k.skeleton !== 'string' || k.skeleton === '')) {
        c.fail('CONFIG_FIELD_TYPE', `${p}.control.skeleton`, `is ${show(k.skeleton)}; ${SKELETON_NAMES.map((n) => `"${n}"`).join(' or ')}, or the path of a pose file relative to the config's directory, is required`);
      } else if ('skeleton' in k && !isSkeletonName(k.skeleton) && !('pose' in g)) {
        // A pose file is points only; the built-ins' words are theirs, and none is guessed for a file.
        c.fail('CONFIG_FIELD_PRESENT', `${p}.pose`, `is absent, and generation.control.skeleton names a pose file (${show(k.skeleton)}), which carries no words; the pose words are required from generation.pose`);
      }
      if ('strength' in k) c.number(`${p}.control.strength`, k.strength, 'non-negative');
      if ('end_percent' in k) c.number(`${p}.control.end_percent`, k.end_percent, 'unit');
      if ('model' in k) c.string(`${p}.control.model`, k.model);
    }
  }
  if (!('pose' in g) && !('control' in g)) {
    c.fail('CONFIG_FIELD_PRESENT', `${p}.pose`, 'is absent and so is generation.control; the pose words come from one of them, and neither is guessed');
  }
}

function checkHeadBox(c: Check, path: string, b: Json): void {
  const ints = Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number' && Number.isInteger(n));
  if (!ints) c.fail('CONFIG_FIELD_TYPE', path, `is ${show(b)}; [x0, y0, x1, y1] in integer source pixels is required`);
  else {
    const [x0, y0, x1, y1] = b as number[];
    if (!(x1 > x0 && y1 > y0 && x1 - x0 === y1 - y0)) {
      c.fail('CONFIG_HEAD_BOX_SQUARE', path, `is ${x1 - x0}x${y1 - y0}; a non-empty square is required (the head run is fed a square crop)`);
    }
  }
}

function checkSeeThrough(c: Check, v: Json): void {
  const s = c.object('config.seethrough', v, ['resolution', 'steps', 'seed', 'offload'], ['head_box', 'arm_split']);
  if (s === null) return;
  const p = 'config.seethrough';
  const res = 'resolution' in s && c.int(`${p}.resolution`, s.resolution, 1) ? (s.resolution as number) : null;
  if ('steps' in s) c.int(`${p}.steps`, s.steps, 1);
  if ('seed' in s) c.int(`${p}.seed`, s.seed, 0);
  if ('offload' in s && typeof s.offload !== 'boolean') c.fail('CONFIG_FIELD_TYPE', `${p}.offload`, `is ${show(s.offload)}; true or false is required`);
  if ('head_box' in s) checkHeadBox(c, `${p}.head_box`, s.head_box);
  if ('arm_split' in s) checkArmSplit(c, `${p}.arm_split`, s.arm_split, res);
}

function checkArmSplit(c: Check, path: string, v: Json, resolution: number | null): void {
  const a = c.object(path, v, ['order'], ['x', 'line']);
  if (a === null) return;
  if (!('x' in a) && !('line' in a)) {
    c.fail('CONFIG_FIELD_PRESENT', path, 'has neither x nor line; a split column ("x") or a polyline ("line") is required to separate the arms');
  } else if ('x' in a && 'line' in a) {
    c.fail('CONFIG_FIELD_TYPE', `${path}.line`, 'is set alongside x; give either a split column ("x") or a polyline ("line"), not both');
  }
  if ('x' in a && c.number(`${path}.x`, a.x, 'non-negative')) {
    const x = a.x as number;
    if (resolution !== null && x > resolution) {
      c.fail('CONFIG_FIELD_TYPE', `${path}.x`, `is ${x}; a column inside the ${resolution}x${resolution} run canvas (0 <= x <= ${resolution}) is required`);
    }
  }
  if ('line' in a) {
    const l = a.line;
    if (!Array.isArray(l) || l.length < 2) {
      c.fail('CONFIG_FIELD_TYPE', `${path}.line`, `is ${show(l)}; an array of at least 2 [x, y] points in run pixels is required`);
    } else {
      l.forEach((pt, i) => {
        const ok = Array.isArray(pt) && pt.length === 2 && pt.every((n) => typeof n === 'number' && Number.isFinite(n));
        if (!ok) {
          c.fail('CONFIG_FIELD_TYPE', `${path}.line[${i}]`, `is ${show(pt)}; a point [x, y] in run pixels is required`);
          return;
        }
        const [px, py] = pt as [number, number];
        if (px < 0 || py < 0 || (resolution !== null && (px > resolution || py > resolution))) {
          c.fail(
            'CONFIG_FIELD_TYPE',
            `${path}.line[${i}]`,
            `is [${px}, ${py}]; ${resolution !== null ? `a point inside the ${resolution}x${resolution} run canvas (0 <= x, y <= ${resolution})` : 'x >= 0 and y >= 0'} is required`,
          );
        }
      });
    }
  }
  if ('order' in a) {
    const o = a.order;
    const valid =
      Array.isArray(o) &&
      o.length === 2 &&
      ((o[0] === 'handwear-r' && o[1] === 'handwear-l') || (o[0] === 'handwear-l' && o[1] === 'handwear-r'));
    if (!valid) {
      c.fail('CONFIG_FIELD_TYPE', `${path}.order`, `is ${show(o)}; ["handwear-r", "handwear-l"] or ["handwear-l", "handwear-r"] (back to front) is required`);
    }
  }
}

function checkRunTag(c: Check, path: string, run: Json, tag: Json): void {
  if (run !== 'full' && run !== 'head') c.fail('CONFIG_FIELD_TYPE', `${path} run`, `is ${show(run)}; "full" or "head" is required`);
  // Issue #256: an author-made layer's `author:<label>` is a tag the readers admit, with no role.
  if (typeof tag !== 'string' || readLayerTag(tag) === null) {
    const label = typeof tag === 'string' && tag.startsWith(AUTHOR_PREFIX) ? `; after "${AUTHOR_PREFIX}", ${AUTHOR_LABEL_RULE}` : '';
    c.fail('CONFIG_TAG_KNOWN', `${path} tag`, `is ${show(tag)}; a See-through v3 tag is required — one of ${acceptedTagNames().join(', ')} — or "${AUTHOR_PREFIX}<label>" for a layer the author made${label}`);
  }
}

/**
 * Returns the plan's part names, in plan order, the patches' names, in patch
 * order, and the names the cuts make (`into`), in cut order. `plan` is left
 * out of the generic presence check so that its absence says which command
 * writes one — the step a config without a plan has most likely skipped.
 */
function checkAssemble(c: Check, v: Json, door: 'assemble' | 'full'): { parts: string[]; patches: string[]; cuts: string[] } {
  const required = sectionRequired(door, 'assemble');
  const a = c.object('config.assemble', v, required.filter((k) => k !== 'plan'), ['plan', 'extend_below_crop', 'patches', 'cuts', 'alternates', 'head_face_underfill', 'yield_refused']);
  if (a === null) return { parts: [], patches: [], cuts: [] };
  if (required.includes('plan') && !('plan' in a)) {
    c.fail('CONFIG_FIELD_PRESENT', 'config.assemble.plan', 'is absent and required; `assemble --propose-plan` prints one from the two runs — paste its plan and extend_below_crop into config.assemble');
  }
  const p = 'config.assemble';
  if ('rig_scale' in a) c.number(`${p}.rig_scale`, a.rig_scale, 'positive');
  if ('head_face_underfill' in a && typeof a.head_face_underfill !== 'boolean') {
    c.fail('CONFIG_FIELD_TYPE', `${p}.head_face_underfill`, `is ${show(a.head_face_underfill)}; true or false is required`);
  }
  if ('yield_refused' in a && typeof a.yield_refused !== 'boolean') {
    c.fail('CONFIG_FIELD_TYPE', `${p}.yield_refused`, `is ${show(a.yield_refused)}; true or false is required`);
  }
  const parts: string[] = [];
  if ('plan' in a && c.array(`${p}.plan`, a.plan, true)) {
    const seenPart = new Map<string, number>();
    const seenSource = new Map<string, number>();
    (a.plan as Json[]).forEach((entry, i) => {
      const at = `${p}.plan[${i}]`;
      if (!(Array.isArray(entry) && entry.length === 3 && typeof entry[0] === 'string')) {
        c.fail('CONFIG_FIELD_TYPE', at, `is ${show(entry)}; [part name, "full" | "head", tag] is required`);
        return;
      }
      const [name, run, tag] = entry as [string, Json, Json];
      if (!partNameOk(name)) c.fail('CONFIG_PART_NAME', at, `names the part ${show(name)}; a part name is a file name, so it may not be empty, start with "." or hold a slash`);
      checkRunTag(c, at, run, tag);
      if (seenPart.has(name)) c.fail('CONFIG_PART_UNIQUE', at, `names the part "${name}" again (first at plan[${seenPart.get(name)}]); each part is one layer`);
      else seenPart.set(name, i);
      const source = `${String(run)}:${String(tag)}`;
      if (seenSource.has(source)) c.fail('CONFIG_PART_UNIQUE', at, `takes ${source} again (first at plan[${seenSource.get(source)}]); one layer makes one part`);
      else seenSource.set(source, i);
      parts.push(name);
    });
  }
  if ('extend_below_crop' in a && c.array(`${p}.extend_below_crop`, a.extend_below_crop, false)) {
    (a.extend_below_crop as Json[]).forEach((entry, i) => {
      const at = `${p}.extend_below_crop[${i}]`;
      const e = c.object(at, entry, ['part', 'run', 'tag'], []);
      if (e === null) return;
      checkRunTag(c, at, e.run, e.tag);
      if (typeof e.part !== 'string' || !parts.includes(e.part)) {
        c.fail('CONFIG_NAME_RESOLVES', `${at}.part`, `is ${show(e.part)}; a part named in assemble.plan is required`);
      }
    });
  }
  const patches = 'patches' in a ? checkPatches(c, a.patches, parts) : [];
  const cuts = 'cuts' in a ? checkCuts(c, a.cuts, parts, patches) : [];
  return { parts, patches, cuts };
}

/**
 * `assemble.cuts` (issue #170): each entry `{from, into, polygon, draw, overlap}`
 * and optionally `under` (issue #193, a non-empty path string; the assemble
 * stage reads the file) and `under_fill` (issue #360, the one value
 * `"colour"`; whether the cut has an under to fill with is the assemble
 * stage's to judge, since a hidden-art layer can be one), refused field by field. `from` must be a plan part — a cut of a patch or of
 * another cut's piece is refused, so every piece's provenance is one layer and
 * one polygon. `into` is a new part name: not a plan part, not a patch, not
 * another cut's. Returns the names the cuts make, in order.
 */
function checkCuts(c: Check, v: Json, plan: string[], patches: string[], p = 'config.assemble.cuts'): string[] {
  const names: string[] = [];
  if (!c.array(p, v, false)) return names;
  const seen = new Map<string, number>();
  (v as Json[]).forEach((entry, i) => {
    const at = `${p}[${i}]`;
    const e = c.object(at, entry, ['from', 'into', 'polygon', 'draw', 'overlap'], ['under', 'under_fill']);
    if (e === null) return;
    if ('under' in e && !(typeof e.under === 'string' && e.under !== '')) {
      c.fail('CONFIG_FIELD_TYPE', `${at}.under`, `is ${show(e.under)}; a non-empty path to a PNG is required, relative to the config's directory — the image of what lies under the piece, in rig pixels over the polygon's bounding box`);
    }
    if ('under_fill' in e && e.under_fill !== 'colour') {
      c.fail('CONFIG_FIELD_TYPE', `${at}.under_fill`, `is ${show(e.under_fill)}; "colour" is required — the base takes the under's colour and keeps the alpha the cut removed, so its silhouette does not grow; leave under_fill out for the under's colour and alpha`);
    }
    if ('overlap' in e && !(typeof e.overlap === 'number' && Number.isInteger(e.overlap) && e.overlap >= 0)) {
      c.fail('CONFIG_FIELD_TYPE', `${at}.overlap`, `is ${show(e.overlap)}; a non-negative integer of rig pixels is required — the band inside the cut's edge the part keeps under the piece, 0 for none`);
    }
    if ('from' in e && (typeof e.from !== 'string' || !plan.includes(e.from))) {
      c.fail('CONFIG_NAME_RESOLVES', `${at}.from`, `is ${show(e.from)}; a part named in assemble.plan is required — a cut takes pixels out of one plan part's layer`);
    }
    if ('into' in e && c.string(`${at}.into`, e.into)) {
      const name = e.into;
      if (!partNameOk(name)) c.fail('CONFIG_PART_NAME', `${at}.into`, `names the part ${show(name)}; a part name is a file name, so it may not be empty, start with "." or hold a slash`);
      if (plan.includes(name)) c.fail('CONFIG_PART_UNIQUE', `${at}.into`, `names the part "${name}", which assemble.plan[${plan.indexOf(name)}] already makes; a cut makes a part of its own`);
      else if (patches.includes(name)) c.fail('CONFIG_PART_UNIQUE', `${at}.into`, `names the part "${name}", which assemble.patches[${patches.indexOf(name)}] already makes; a cut makes a part of its own`);
      else if (seen.has(name)) c.fail('CONFIG_PART_UNIQUE', `${at}.into`, `names the part "${name}" again (first at cuts[${seen.get(name)}])`);
      else seen.set(name, i);
      names.push(name);
    }
    if ('polygon' in e) {
      const g = e.polygon;
      const point = (q: Json): boolean => Array.isArray(q) && q.length === 2 && q.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0);
      if (!(Array.isArray(g) && g.length >= 3 && g.every(point))) {
        c.fail('CONFIG_FIELD_TYPE', `${at}.polygon`, `is ${show(g)}; at least three [x, y] points in non-negative integer rig pixels are required`);
      }
    }
    if ('draw' in e) {
      const d = e.draw;
      if (d === 'back' || d === 'front') return;
      if (typeof d === 'object' && d !== null && !Array.isArray(d)) {
        const o = c.object(`${at}.draw`, d, ['before'], []);
        if (o !== null && 'before' in o && (typeof o.before !== 'string' || !plan.includes(o.before))) {
          c.fail('CONFIG_NAME_RESOLVES', `${at}.draw.before`, `is ${show(o.before)}; a part named in assemble.plan is required`);
        }
        return;
      }
      c.fail('CONFIG_FIELD_TYPE', `${at}.draw`, `is ${show(d)}; "back", "front" or {"before": "<plan part>"} is required`);
    }
  });
  return names;
}

function explicitIslandSlotNames(baseSlots: ReadonlySet<string>, meshes: Json): string[] {
  if (!isPlainObject(meshes)) return [];
  const out: string[] = [];
  for (const [part, spec] of Object.entries(meshes)) {
    if (!baseSlots.has(part) || !isPlainObject(spec) || !isPlainObject(spec.explicit) || !Array.isArray(spec.explicit.islands)) continue;
    for (let i = 1; i < spec.explicit.islands.length; i++) {
      const isl = spec.explicit.islands[i];
      const slot = isPlainObject(isl) && typeof isl.slot === 'string' && isl.slot !== '' ? isl.slot : `${part}__island${i + 1}`;
      out.push(slot);
    }
  }
  return out;
}

function checkAlternates(
  c: Check,
  v: Json,
  made: { parts: string[]; patches: string[]; cuts: string[] },
  limbs: LimbNames | null,
  bones: Set<string> | null = null,
  chains: Map<string, number> | null = null,
  regions: Json = undefined,
  meshes: Json = undefined,
): void {
  const p = 'config.assemble.alternates';
  if (!c.array(p, v, true)) return;
  const baseSlots = new Set<string>([
    ...made.parts.filter((n) => !(limbs?.consumed.has(n) ?? false)),
    ...made.patches,
    ...made.cuts,
    ...(limbs?.parts.keys() ?? []),
  ]);
  const allSlots = new Set<string>([
    ...baseSlots,
    ...explicitIslandSlotNames(baseSlots, meshes),
  ]);
  const seenNames = new Map<string, number>();
  (v as Json[]).forEach((entry, i) => {
    const at = `${p}[${i}]`;
    const e = c.object(at, entry, ['name'], ['source', 'full', 'head', 'parts', 'hides', 'head_box', 'cuts', 'skeleton', 'anchor', 'drawn', 'tips', 'front', 'layers', 'focus', 'base_anchor']);
    if (e === null) return;
    if ('name' in e && c.string(`${at}.name`, e.name)) {
      if (!partNameOk(e.name)) c.fail('CONFIG_PART_NAME', `${at}.name`, `names the set ${show(e.name)}; a set name is a file prefix, so it may not be empty, start with "." or hold a slash`);
      if (seenNames.has(e.name)) c.fail('CONFIG_PART_UNIQUE', `${at}.name`, `names the set "${e.name}" again (first at alternates[${seenNames.get(e.name)}])`);
      else seenNames.set(e.name, i);
    }
    for (const k of ['source', 'full', 'head', 'skeleton'] as const) {
      if (k in e) c.string(`${at}.${k}`, e[k]);
    }
    if ('focus' in e) c.problems.push(...setFocusProblems(e.focus, `${at} (set ${show(e.name)}).focus`));
    if ('anchor' in e) {
      if (!('skeleton' in e)) c.fail('CONFIG_FIELD_PRESENT', `${at}.skeleton`, 'is absent; anchor registers a skeleton set and requires its skeleton file');
      const a = e.anchor;
      if (!isPlainObject(a) || Object.keys(a).length < 1 || Object.keys(a).length > 2) {
        c.fail('CONFIG_FIELD_TYPE', `${at}.anchor`, `is ${show(a)}; one or two keypoint name -> declared base bone entries are required`);
      } else for (const [keypoint, bone] of Object.entries(a)) {
        if (!(KEYPOINT_NAMES as readonly string[]).includes(keypoint)) c.fail('CONFIG_KEY_KNOWN', `${at}.anchor.${keypoint}`, `is not a body-18 keypoint; one of ${KEYPOINT_NAMES.join(', ')} is required`);
        if (typeof bone !== 'string' || (bones !== null && !bones.has(bone))) c.fail('CONFIG_NAME_RESOLVES', `${at}.anchor.${keypoint}`, `names ${show(bone)}; a bone config.bones declares is required`);
      }
    }
    if ('drawn' in e) {
      const d = e.drawn;
      if (!isPlainObject(d) || Object.keys(d).length === 0) {
        c.fail('CONFIG_FIELD_TYPE', `${at}.drawn`, `is ${show(d)}; a non-empty object of bone name -> drawn world angle in Spine degrees is required`);
      } else {
        for (const [bName, deg] of Object.entries(d)) {
          if (bones !== null && !bones.has(bName)) {
            c.fail('CONFIG_NAME_RESOLVES', `${at}.drawn.${bName}`, `names "${bName}", which config.bones does not declare`);
          }
          c.number(`${at}.drawn.${bName}`, deg);
        }
      }
    }
    if ('tips' in e) {
      if (!isPlainObject(e.tips) || Object.keys(e.tips).length === 0) {
        c.fail('CONFIG_FIELD_TYPE', `${at}.tips`, `is ${show(e.tips)}; a non-empty object of declared bone name -> [x, y] in full source-crop pixels is required`);
      } else for (const [bone, point] of Object.entries(e.tips)) {
        const path = `${at}.tips.${bone}`;
        if (bones !== null && (bone === ROOT_BONE || !bones.has(bone))) c.fail('CONFIG_NAME_RESOLVES', path, `names "${bone}", which config.bones does not declare as a single bone or expanded chain link`);
        if (!Array.isArray(point) || point.length !== 2 || !point.every((n) => typeof n === 'number' && Number.isFinite(n))) {
          c.fail('CONFIG_FIELD_TYPE', path, `is ${show(point)}; a finite point [x, y] in full source-crop pixels is required`);
        }
      }
    }
    if ('head_box' in e) checkHeadBox(c, `${at}.head_box`, e.head_box);
    const altCuts = 'cuts' in e ? checkCuts(c, e.cuts, made.parts, [], `${at}.cuts`) : [];
    let cutsConsumedLimb = false;
    if (limbs !== null && 'cuts' in e && Array.isArray(e.cuts)) {
      e.cuts.forEach((ce, ci) => {
        if (!isPlainObject(ce) || typeof ce.from !== 'string') return;
        const byLimb = limbs.consumed.get(ce.from);
        if (byLimb !== undefined) {
          cutsConsumedLimb = true;
          const segList = (limbs.chains.get(byLimb)?.parts ?? []).map((s) => `"${s}"`).join(', ');
          c.fail(
            'CONFIG_LIMB_SET_JOINTS',
            `${at}.cuts[${ci}].from`,
            `cuts "${ce.from}", which config.limbs.${byLimb} cuts at the base's joints into ${segList}; a gesture set over a limb chain is cut at the base's joints and may not declare its own polygon cuts for that layer`,
          );
        }
      });
    }
    const validParts = new Set<string>([...allSlots, ...altCuts]);
    const seenParts = new Set<string>();
    if ('parts' in e && c.array(`${at}.parts`, e.parts, true)) {
      (e.parts as Json[]).forEach((pn, k) => {
        if (!c.string(`${at}.parts[${k}]`, pn)) return;
        const byLimb = limbs?.consumed.get(pn);
        if (byLimb !== undefined) {
          const segList = (limbs?.chains.get(byLimb)?.parts ?? []).map((s) => `"${s}"`).join(', ');
          c.fail(
            'CONFIG_LIMB_SET_JOINTS',
            `${at}.parts[${k}]`,
            `names "${pn}", which config.limbs.${byLimb} cuts at the base's joints into ${segList}; a gesture set covers the limb chain's segment parts at the base's joints, not the unsplit layer`,
          );
        } else if (!validParts.has(pn)) {
          c.fail('CONFIG_NAME_RESOLVES', `${at}.parts[${k}]`, `is ${show(pn)}; a slot of the base rig (or a part made by this alternate's cuts) is required`);
        } else if (seenParts.has(pn)) {
          c.fail('CONFIG_PART_UNIQUE', `${at}.parts[${k}]`, `repeats "${pn}"; each covered part is named once`);
        } else seenParts.add(pn);
      });
    }
    const seenHides = new Set<string>();
    if ('hides' in e && c.array(`${at}.hides`, e.hides, false)) {
      (e.hides as Json[]).forEach((hn, k) => {
        if (!c.string(`${at}.hides[${k}]`, hn)) return;
        const byLimb = limbs?.consumed.get(hn);
        if (byLimb !== undefined) {
          const segList = (limbs?.chains.get(byLimb)?.parts ?? []).map((s) => `"${s}"`).join(', ');
          c.fail(
            'CONFIG_LIMB_SET_JOINTS',
            `${at}.hides[${k}]`,
            `names "${hn}", which config.limbs.${byLimb} cuts at the base's joints into ${segList}; a gesture set covers the limb chain's segment parts at the base's joints, not the unsplit layer`,
          );
        } else if (!allSlots.has(hn)) {
          c.fail('CONFIG_NAME_RESOLVES', `${at}.hides[${k}]`, `is ${show(hn)}; a slot of the base rig is required`);
        } else if (seenHides.has(hn)) {
          c.fail('CONFIG_PART_UNIQUE', `${at}.hides[${k}]`, `repeats "${hn}"; each hidden slot is named once`);
        } else seenHides.add(hn);
      });
    }
    if ('layers' in e) {
      if (!isPlainObject(e.layers)) c.fail('CONFIG_FIELD_TYPE', `${at}.layers`, `is ${show(e.layers)}; an object of covered part -> layer name is required`);
      else for (const [part, layer] of Object.entries(e.layers)) {
        const path = `${at}.layers.${part}`;
        const covered = ('parts' in e ? seenParts : allSlots).has(part) && !seenHides.has(part);
        if (!covered) c.fail('CONFIG_SET_LAYERS', path, `names "${part}", which the set does not cover; name a covered, nonhidden part`);
        if (limbs?.parts.get(part)?.band !== undefined) c.fail('CONFIG_SET_LAYERS', path, `names generated band "${part}"; select the shared layer through its rigid segment parts, not a separate band layer`);
        if (made.patches.includes(part)) c.fail('CONFIG_SET_LAYERS', path, `names the painting patch "${part}", which has no run layer source; declare a layer-backed plan part instead`);
        if (typeof layer !== 'string' || readLayerTag(layer) === null) c.fail('CONFIG_TAG_KNOWN', path, `is ${show(layer)}; a See-through v3 tag or "${AUTHOR_PREFIX}<label>" is required; ${AUTHOR_LABEL_RULE}`);
      }
    }
    if ('base_anchor' in e) c.problems.push(...baseAnchorProblems(e.base_anchor, `${at}.base_anchor`, new Set([...('parts' in e ? seenParts : baseSlots)].filter(n => !seenHides.has(n))), new Set(made.patches), isPlainObject(regions) ? new Set(Object.keys(regions).filter(n => !isPlainObject(meshes) || !Object.hasOwn(meshes, n))) : undefined));
    // Issue #664: a part the set draws on its front slot is one the set covers and a limb declares a front slot for.
    if ('front' in e) {
      if (!Array.isArray(e.front) || e.front.length === 0) {
        c.fail('CONFIG_SET_FRONT', `${at}.front`, `is ${show(e.front)}; a nonempty list of covered limb segment parts with a declared front slot is required`);
      } else {
        const seenFront = new Set<string>();
        (e.front as Json[]).forEach((fn, k) => {
          if (!c.string(`${at}.front[${k}]`, fn)) return;
          const declaredBy = limbs?.front.get(fn);
          const covered = 'parts' in e && seenParts.has(fn) && !seenHides.has(fn);
          if (seenFront.has(fn)) c.fail('CONFIG_SET_FRONT', `${at}.front[${k}]`, `repeats "${fn}"; each front part is named once`);
          else if (!covered) {
            c.fail('CONFIG_SET_FRONT', `${at}.front[${k}]`, `names "${fn}", which this set does not cover${'parts' in e ? ` (its parts less its hides: ${[...seenParts].filter((q) => !seenHides.has(q)).map((q) => `"${q}"`).join(', ') || 'none'})` : ' (a set without parts is a full set; front slots are for a subset set over a limb)'}; a set draws on a front slot only the parts it covers`);
          } else if (declaredBy === undefined) {
            const declared = [...(limbs?.front.keys() ?? [])].map((q) => `"${q}"`).join(', ') || 'none';
            c.fail('CONFIG_SET_FRONT', `${at}.front[${k}]`, `names "${fn}", which no config.limbs.<limb>.front.parts lists (front slots declared: ${declared}); declare the front slot on its limb first`);
          }
          seenFront.add(fn);
        });
      }
    }
    if ('parts' in e && limbs !== null) {
      for (const [limbName, chain] of limbs.chains) {
        const coveredSegs = chain.parts.filter((sp) => seenParts.has(sp) && !seenHides.has(sp));
        const hiddenSegs = chain.parts.filter((sp) => seenHides.has(sp));
        const bands = [...limbs.parts].filter(([, p]) => p.band?.limb === limbName).map(([name]) => name);
        const selectedBands = bands.filter((n) => seenParts.has(n)), hiddenBands = bands.filter((n) => seenHides.has(n));
        if ((coveredSegs.length > 0 || hiddenSegs.length > 0 || selectedBands.length > 0 || hiddenBands.length > 0) && (coveredSegs.length !== chain.parts.length || hiddenBands.length > 0)) {
          c.fail(
            'CONFIG_LIMB_SET_JOINTS',
            `${at}.parts`,
            `covers [${coveredSegs.map((s) => `"${s}"`).join(', ')}]${hiddenSegs.length > 0 ? ` (and hides [${hiddenSegs.map((s) => `"${s}"`).join(', ')}])` : ''} of config.limbs.${limbName}, which cuts at the base's joints into [${chain.parts.map((s) => `"${s}"`).join(', ')}]; a gesture set over a limb chain must cover all ${chain.parts.length} of its segment parts so it is cut at the base's joints${hiddenBands.length === 0 ? '' : `; generated bands [${hiddenBands.join(', ')}] cannot be hidden independently`}`,
          );
        } else if (coveredSegs.length === chain.parts.length && !cutsConsumedLimb && 'cuts' in e && Array.isArray(e.cuts) && e.cuts.length > 0) {
          c.fail(
            'CONFIG_LIMB_SET_JOINTS',
            `${at}.cuts`,
            `declares custom polygon cuts on a gesture set covering config.limbs.${limbName}; a gesture set is cut at the base's joints and declares no cuts of its own`,
          );
        }
      }
    }
    if ('parts' in e && 'drawn' in e && isPlainObject(e.drawn)) {
      const activeParts = [...seenParts].filter((pn) => !seenHides.has(pn));
      const coveredBones = new Set<string>();
      let allPartsResolved = activeParts.length > 0;
      for (const pn of activeParts) {
        const limbSeg = limbs?.parts.get(pn);
        if (limbSeg !== undefined) {
          coveredBones.add(limbSeg.bone);
          if (limbSeg.band !== undefined) coveredBones.add(limbSeg.band.upper);
        } else if (isPlainObject(regions) && typeof rawRegionBone(regions[pn]) === 'string') {
          coveredBones.add(rawRegionBone(regions[pn]) as string);
        } else if (isPlainObject(meshes) && isPlainObject(meshes[pn])) {
          const m = meshes[pn] as Record<string, Json>;
          if (Array.isArray(m.segments)) {
            for (const s of m.segments) {
              if (typeof s === 'string') {
                const links = chains?.get(s);
                if (links !== undefined) {
                  for (let lk = 0; lk < links; lk++) coveredBones.add(`${s}${lk}`);
                } else {
                  coveredBones.add(s);
                }
              } else if (Array.isArray(s) && typeof s[0] === 'string') {
                coveredBones.add(s[0]);
              }
            }
          }
          if (isPlainObject(m.contour)) {
            if (Array.isArray(m.contour.regions)) {
              for (const rg of m.contour.regions) if (isPlainObject(rg) && typeof rg.bone === 'string') coveredBones.add(rg.bone);
            }
            if (isPlainObject(m.contour.bust)) {
              coveredBones.add(typeof m.contour.bust.bone_r === 'string' ? m.contour.bust.bone_r : DEFAULT_BUST_BONE_R);
              coveredBones.add(typeof m.contour.bust.bone_l === 'string' ? m.contour.bust.bone_l : DEFAULT_BUST_BONE_L);
            }
          }
          if (isPlainObject(m.auto) && Array.isArray(m.auto.regions)) {
            for (const rg of m.auto.regions) if (isPlainObject(rg) && typeof rg.bone === 'string') coveredBones.add(rg.bone);
          }
        } else {
          allPartsResolved = false;
        }
      }
      if (allPartsResolved) {
        const coveredList = [...coveredBones].map((b) => `"${b}"`).join(', ') || 'none';
        for (const bName of Object.keys(e.drawn)) {
          if ((bones === null || bones.has(bName)) && !coveredBones.has(bName)) {
            c.fail(
              'CONFIG_SET_COVERS_BONE',
              `${at}.drawn.${bName}`,
              `names "${bName}", which alternate set "${String(e.name ?? '')}" does not cover (covered bones: ${coveredList}); a subset set may state drawn angles only for the bones its covered parts ride`,
            );
          }
        }
      }
    }
  });
}

/**
 * `assemble.patches`: each entry `{name, box, alpha, draw}`, refused field by
 * field. What the config alone cannot know — whether the box lies inside the
 * rig, whether the rule leaves any pixel — the assemble stage refuses
 * (`ASSEMBLE_PATCH_BOX_INSIDE`, `ASSEMBLE_PATCH_OPAQUE`). Returns the patch
 * names, in order.
 */
function checkPatches(c: Check, v: Json, plan: string[]): string[] {
  const p = 'config.assemble.patches';
  const names: string[] = [];
  if (!c.array(p, v, false)) return names;
  const seen = new Map<string, number>();
  (v as Json[]).forEach((entry, i) => {
    const at = `${p}[${i}]`;
    // `bone` is the field a reader expects here, and the answer is a place
    // that already exists: one place for a region's bone, not two.
    let fields = entry;
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry) && 'bone' in entry) {
      c.fail('CONFIG_KEY_KNOWN', `${at}.bone`, 'is not a field here; a patch is a region, and the bone a region rides is config.regions.<name> — write it there');
      const { bone: _bone, ...rest } = entry as Record<string, Json>;
      fields = rest;
    }
    const e = c.object(at, fields, ['name', 'box', 'alpha', 'draw'], []);
    if (e === null) return;
    if ('name' in e && c.string(`${at}.name`, e.name)) {
      const name = e.name;
      if (!partNameOk(name)) c.fail('CONFIG_PART_NAME', `${at}.name`, `names the part ${show(name)}; a part name is a file name, so it may not be empty, start with "." or hold a slash`);
      if (plan.includes(name)) c.fail('CONFIG_PART_UNIQUE', `${at}.name`, `names the part "${name}", which assemble.plan[${plan.indexOf(name)}] already makes; a patch is a part of its own`);
      else if (seen.has(name)) c.fail('CONFIG_PART_UNIQUE', `${at}.name`, `names the part "${name}" again (first at patches[${seen.get(name)}])`);
      else seen.set(name, i);
      names.push(name);
    }
    if ('box' in e) {
      const b = e.box;
      const ints = Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0);
      if (!ints) c.fail('CONFIG_FIELD_TYPE', `${at}.box`, `is ${show(b)}; [x0, y0, x1, y1] in non-negative integer rig pixels is required`);
      else {
        const [x0, y0, x1, y1] = b as number[];
        if (!(x1 > x0 && y1 > y0)) c.fail('CONFIG_PATCH_BOX', `${at}.box`, `is [${x0}, ${y0}, ${x1}, ${y1}], ${x1 - x0}x${y1 - y0}; a non-empty box is required (x1 > x0 and y1 > y0; x1 and y1 are exclusive)`);
      }
    }
    if ('alpha' in e && !(PATCH_ALPHAS as readonly Json[]).includes(e.alpha)) {
      c.fail('CONFIG_FIELD_TYPE', `${at}.alpha`, `is ${show(e.alpha)}; one of ${PATCH_ALPHAS.map((r) => `"${r}"`).join(', ')} is required — "silhouette" takes the painting's figure inside the box, "box" the whole box`);
    }
    if ('draw' in e) {
      const d = e.draw;
      if (d === 'back' || d === 'front') return;
      if (typeof d === 'object' && d !== null && !Array.isArray(d)) {
        const o = c.object(`${at}.draw`, d, ['before'], []);
        if (o !== null && 'before' in o && (typeof o.before !== 'string' || !plan.includes(o.before))) {
          c.fail('CONFIG_NAME_RESOLVES', `${at}.draw.before`, `is ${show(o.before)}; a part named in assemble.plan is required`);
        }
        return;
      }
      c.fail('CONFIG_FIELD_TYPE', `${at}.draw`, `is ${show(d)}; "back", "front" or {"before": "<plan part>"} is required`);
    }
  });
  return names;
}

/** Returns every bone name (root and chain links included), each chain's link count, and each declared bone's parent as written. */
function checkBones(c: Check, v: Json): { bones: Set<string>; chains: Map<string, number>; parents: Map<string, string> } {
  const bones = new Set<string>([ROOT_BONE]);
  const chains = new Map<string, number>();
  const parents = new Map<string, string>();
  if (!c.array('config.bones', v, true)) return { bones, chains, parents };
  // Not `declare`: Bun strips `declare(...)` as a TypeScript ambient declaration
  // while tsc accepts it as a call, so the call vanished at run time with both
  // gates green. Measured, not assumed — the selftest has a control for it.
  const addBone = (name: string, at: string): void => {
    if (name === ROOT_BONE) c.fail('CONFIG_BONE_UNIQUE', at, `declares "${ROOT_BONE}", which every rig already has`);
    else if (bones.has(name)) c.fail('CONFIG_BONE_UNIQUE', at, `declares the bone "${name}" a second time`);
    bones.add(name);
  };
  (v as Json[]).forEach((entry, i) => {
    const at = `config.bones[${i}]`;
    const isChain = typeof entry === 'object' && entry !== null && 'chain' in entry;
    if (isChain) {
      const b = c.object(at, entry, ['chain', 'parent', 'points', 'tip'], ['link_inherit']);
      if (b === null) return;
      if ('parent' in b && c.string(`${at}.parent`, b.parent) && !bones.has(b.parent)) {
        c.fail('CONFIG_NAME_RESOLVES', `${at}.parent`, `names "${b.parent}", which is not "${ROOT_BONE}" or a bone declared above it; parents come first`);
      }
      if ('tip' in b) c.point(`${at}.tip`, b.tip);
      if (!c.string(`${at}.chain`, b.chain)) return;
      const name = b.chain;
      if (chains.has(name)) c.fail('CONFIG_BONE_UNIQUE', `${at}.chain`, `declares the chain "${name}" a second time`);
      if ('points' in b && c.array(`${at}.points`, b.points, true)) {
        const points = b.points as Json[];
        points.forEach((pt, k) => c.point(`${at}.points[${k}]`, pt));
        points.forEach((_, k) => addBone(`${name}${k}`, `${at} link ${k}`));
        points.forEach((_, k) => {
          if (k > 0) parents.set(`${name}${k}`, `${name}${k - 1}`);
          else if (typeof b.parent === 'string' && !parents.has(`${name}0`)) parents.set(`${name}0`, b.parent);
        });
        chains.set(name, points.length);
        if ('link_inherit' in b) {
          const path = `${at}.link_inherit`;
          const links = points.map((_, k) => `${name}${k}`);
          if (!isPlainObject(b.link_inherit)) {
            c.fail('CONFIG_FIELD_TYPE', path, `is ${show(b.link_inherit)}; an object mapping this chain's expanded link names to rig-c inherit modes is required`);
          } else {
            for (const [link, mode] of Object.entries(b.link_inherit)) {
              const field = `${path}.${link}`;
              if (!links.includes(link)) c.fail('CONFIG_NAME_RESOLVES', field, `names "${link}", which is not a link of chain "${name}"; its declared links are ${links.map((n) => `"${n}"`).join(', ')}`);
              if (c.string(field, mode) && !(RIG_BONE_INHERIT as readonly string[]).includes(mode)) {
                c.fail('CONFIG_BONE_INHERIT', field, `is ${show(mode)}; one of rig-c's inherit modes, spelled as its table spells them, is required — ${RIG_BONE_INHERIT.join(', ')} (rig-c's RigBone.inherit; nothing here folds a case or maps a name)`);
              }
            }
          }
        }
      }
      return;
    }
    const b = c.object(at, entry, ['name', 'parent', 'at'], ['tip', 'inherit']);
    if (b === null) return;
    // Issue #348: rig-c's own mode names, as its table spells them; nothing is folded, mapped or defaulted.
    if ('inherit' in b && c.string(`${at}.inherit`, b.inherit) && !(RIG_BONE_INHERIT as readonly string[]).includes(b.inherit)) {
      c.fail(
        'CONFIG_BONE_INHERIT',
        `${at}.inherit`,
        `is ${show(b.inherit)}; one of rig-c's inherit modes, spelled as its table spells them, is required — ${RIG_BONE_INHERIT.join(', ')} (rig-c's RigBone.inherit; nothing here folds a case or maps a name)`,
      );
    }
    if ('parent' in b && c.string(`${at}.parent`, b.parent) && !bones.has(b.parent)) {
      c.fail('CONFIG_NAME_RESOLVES', `${at}.parent`, `names "${b.parent}", which is not "${ROOT_BONE}" or a bone declared above it; parents come first`);
    }
    if ('at' in b) c.point(`${at}.at`, b.at);
    if ('tip' in b) c.point(`${at}.tip`, b.tip);
    if ('name' in b && c.string(`${at}.name`, b.name)) {
      addBone(b.name, `${at}.name`);
      if (typeof b.parent === 'string' && !parents.has(b.name)) parents.set(b.name, b.parent);
    }
  });
  return { bones, chains, parents };
}

/** Only drawn names generated by the declared, valid stopped links are additional explicit bindings. */
export function explicitBoneNames(bones: ReadonlySet<string>, chains: ReadonlyMap<string, number>, stops: unknown): Set<string> {
  const out = new Set(bones);
  if (!Array.isArray(stops)) return out;
  for (const stop of stops) {
    if (!isPlainObject(stop) || typeof stop.chain !== 'string') continue;
    const count = chains.get(stop.chain);
    if (count === undefined) continue;
    const links = Array.from({ length: count }, (_, i) => `${stop.chain}${i}`);
    for (const link of Array.isArray(stop.links) ? stop.links : links) if (typeof link === 'string' && links.includes(link)) out.add(`${link}_d`);
  }
  return out;
}

function checkMeshes(c: Check, v: Json, bones: Set<string>, chains: Map<string, number>, stops: Json): void {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    c.fail('CONFIG_FIELD_TYPE', 'config.meshes', `is ${show(v)}; an object of part name -> mesh is required`);
    return;
  }
  for (const [part, spec] of Object.entries(v as Record<string, Json>)) {
    const at = `config.meshes.${part}`;
    // The known keys keep their old order (grid, r, segments) with contour after them, and `r` and `segments` are
    // required in the place and words the object check uses, so a lattice mesh's refusals read as they did.
    const m = c.object(at, spec, [], ['grid', 'r', 'segments', 'contour', 'auto', 'exponent', 'rule', 'ribs', 'influences', 'stray', 'influence', 'gather', 'explicit']);
    if (m === null) continue;
    checkGather(c, at, m);
    if ('explicit' in m) {
      checkExplicit(c, at, m, explicitBoneNames(bones, chains, stops), part);
      continue;
    }
    // issue #378: the influence mode weights by rig-c's own pull, so `r` (the distance rule's softening) is not one of its
    // fields — it is refused there below, and required in every other mode as it always was.
    for (const key of 'influence' in m ? ['segments'] : ['r', 'segments']) if (!(key in m)) c.fail('CONFIG_FIELD_PRESENT', `${at}.${key}`, 'is absent and required');
    const modes = ['grid', 'contour', 'auto', 'influence'].filter((k) => k in m);
    if (modes.length === 2 && !modes.includes('auto') && !modes.includes('influence')) {
      c.fail('CONFIG_MESH_MODE', at, 'has both grid (the lattice) and contour; exactly one is required — a mesh is one or the other');
    } else if (modes.length > 1) {
      c.fail('CONFIG_MESH_MODE', at, `has ${modes.join(' and ')}; exactly one of grid (the lattice), contour (the outline mode), auto (the automatic mode) and influence (rig-c's segments lattice and pull) is required — a mesh is one of them`);
    } else if (modes.length === 0) {
      c.fail('CONFIG_MESH_MODE', at, 'has neither grid (the lattice cell size, px) nor contour (the outline mode) nor auto (the automatic mode) nor influence (rig-c\'s segments lattice and pull); exactly one is required');
    }
    if ('influence' in m) checkInfluence(c, at, m);
    if ('grid' in m) c.int(`${at}.grid`, m.grid, 1);
    if ('contour' in m) checkContour(c, `${at}.contour`, m.contour, bones);
    if ('auto' in m) checkAuto(c, `${at}.auto`, m.auto, bones);
    if ('r' in m) c.number(`${at}.r`, m.r, 'non-negative');
    // issue #161: the distance rule's exponent, in every mode; absent is 2 (src/weights.ts), nothing is filled in here.
    if ('exponent' in m) c.number(`${at}.exponent`, m.exponent, 'positive');
    if ('rule' in m && !WEIGHT_RULES.includes(m.rule as WeightRule)) {
      c.fail('CONFIG_FIELD_TYPE', `${at}.rule`, `is ${show(m.rule)}; "distance" (the distance rule, what an absent rule means) or "heat" (bone heat over the part's silhouette) is required`);
    }
    // issue #161: the exponent is the distance rule's; bone heat has none, so declaring both is refused rather than ignored.
    if ('exponent' in m && m.rule === 'heat') {
      c.fail('CONFIG_FIELD_TYPE', `${at}.exponent`, `is ${show(m.exponent)} on a mesh that declares rule "heat"; the exponent belongs to the distance rule (w = 1/(d + r)^exponent) and bone heat reads none — remove exponent, or declare rule "distance"`);
    }
    if ('segments' in m && c.array(`${at}.segments`, m.segments, true)) {
      (m.segments as Json[]).forEach((s, i) => {
        const sp = `${at}.segments[${i}]`;
        if (typeof s === 'string') {
          if (!chains.has(s) && !bones.has(s)) c.fail('CONFIG_NAME_RESOLVES', sp, `names "${s}", which is neither a chain nor a bone`);
          return;
        }
        if (!(Array.isArray(s) && s.length === 3 && typeof s[0] === 'string')) {
          c.fail('CONFIG_FIELD_TYPE', sp, `is ${show(s)}; a chain name, a bone name, or [bone, [x, y], [x, y]] is required`);
          return;
        }
        if (!bones.has(s[0] as string)) c.fail('CONFIG_NAME_RESOLVES', `${sp}[0]`, `names "${String(s[0])}", which is not a bone`);
        c.point(`${sp}[1]`, s[1]);
        c.point(`${sp}[2]`, s[2]);
      });
    }
    if ('ribs' in m) checkRibs(c, `${at}.ribs`, m, chains);
    if ('influences' in m) checkMeshInfluences(c, `${at}.influences`, m);
    if ('stray' in m) checkLatticeStray(c, `${at}.stray`, m);
    if ('auto' in m && typeof m.auto === 'object' && m.auto !== null && !Array.isArray(m.auto) && 'stimulus' in m.auto) {
      checkStimulus(c, `${at}.auto.stimulus`, (m.auto as Record<string, Json>).stimulus, m, chains);
    }
  }
}

/** Checks one explicit mesh payload (`uvs`, `triangles`, `hull`, `weights`), either on `explicit` or on `explicit.islands[i]`. */
function checkExplicitPayload(c: Check, where: string, o: Record<string, Json>, m: Record<string, Json>, bones: Set<string>): void {
  const uvs = Array.isArray(o.uvs) ? o.uvs : [];
  if ('uvs' in o && c.array(`${where}.uvs`, o.uvs, true)) {
    uvs.forEach((v, i) => c.number(`${where}.uvs[${i}]`, v));
    if (uvs.length % 2 !== 0) c.fail('CONFIG_EXPLICIT_SHAPE', `${where}.uvs`, `has ${uvs.length} numbers; x/y pairs are required`);
  }
  if ('triangles' in o && c.array(`${where}.triangles`, o.triangles, true)) {
    o.triangles.forEach((v, i) => {
      if (c.int(`${where}.triangles[${i}]`, v, 0) && v >= uvs.length / 2) c.fail('CONFIG_EXPLICIT_SHAPE', `${where}.triangles[${i}]`, `is ${v}; the payload has ${uvs.length / 2} vertices`);
    });
    if (o.triangles.length % 3 !== 0) c.fail('CONFIG_EXPLICIT_SHAPE', `${where}.triangles`, `has ${o.triangles.length} indices; triples are required`);
  }
  if ('hull' in o && c.int(`${where}.hull`, o.hull, 1) && o.hull > uvs.length / 2) c.fail('CONFIG_EXPLICIT_SHAPE', `${where}.hull`, `is ${o.hull}; the payload has ${uvs.length / 2} vertices`);
  if ('weights' in o && c.array(`${where}.weights`, o.weights, true)) {
    if (o.weights.length !== uvs.length / 2) c.fail('CONFIG_EXPLICIT_SHAPE', `${where}.weights`, `has ${o.weights.length} rows for ${uvs.length / 2} vertices; one row per vertex is required`);
    o.weights.forEach((row, i) => {
      const atRow = `${where}.weights[${i}]`;
      if (!c.array(atRow, row, true)) return;
      row.forEach((v, j) => {
        const atWeight = `${atRow}[${j}]`, w = c.object(atWeight, v, ['bone', 'x', 'y', 'weight'], []);
        if (w === null) return;
        if ('bone' in w && c.string(`${atWeight}.bone`, w.bone)) {
          if (!bones.has(w.bone)) c.fail('CONFIG_NAME_RESOLVES', `${atWeight}.bone`, `names "${w.bone}", which is not a bone`);
          else if (Array.isArray(m.segments) && !m.segments.includes(w.bone)) c.fail('CONFIG_NAME_RESOLVES', `${atWeight}.bone`, `names "${w.bone}", which this explicit mesh's segments do not declare`);
        }
        for (const k of ['x', 'y', 'weight']) if (k in w) c.number(`${atWeight}.${k}`, w[k]);
      });
    });
  }
}

/** The loader checks the payload's shape and names; rig-c's mandatory gate owns mesh validity. */
function checkExplicit(c: Check, at: string, m: Record<string, Json>, bones: Set<string>, part: string): void {
  for (const k of ['grid', 'r', 'contour', 'auto', 'exponent', 'rule', 'ribs', 'influences', 'stray', 'influence']) {
    if (k in m) c.fail('CONFIG_EXPLICIT_MODE', `${at}.${k}`, 'is declared beside explicit, which transfers an accepted payload without generation; remove the generator field');
  }
  if (!('segments' in m)) c.fail('CONFIG_FIELD_PRESENT', `${at}.segments`, 'is absent and required: direct bone names, first the slot bone');
  else if (c.array(`${at}.segments`, m.segments, true)) m.segments.forEach((bone, i) => {
    if (c.string(`${at}.segments[${i}]`, bone) && !bones.has(bone)) c.fail('CONFIG_NAME_RESOLVES', `${at}.segments[${i}]`, `names "${bone}", which is not a bone; explicit segments name bones directly, not chains`);
  });
  const where = `${at}.explicit`;
  const o = c.object(where, m.explicit, ['image_sha256', 'region_sha256'], ['uvs', 'triangles', 'hull', 'weights', 'islands']);
  if (o === null) return;
  for (const k of ['image_sha256', 'region_sha256']) if (k in o && !(typeof o[k] === 'string' && /^[0-9a-f]{64}$/.test(o[k] as string))) {
    c.fail('CONFIG_EXPLICIT_HASH', `${where}.${k}`, 'requires exactly 64 lowercase hexadecimal SHA-256 digits; derive it from the accepted part image and region');
  }
  const singleKeys = ['uvs', 'triangles', 'hull', 'weights'].filter((k) => k in o);
  if ('islands' in o) {
    for (const k of singleKeys) {
      c.fail('CONFIG_EXPLICIT_ISLANDS', `${where}.${k}`, 'is declared beside islands; state either a single-slot payload (uvs, triangles, hull, weights) or islands, not both');
    }
    if (!Array.isArray(o.islands)) {
      c.fail('CONFIG_FIELD_TYPE', `${where}.islands`, `is ${show(o.islands)}; an array of at least 2 island payloads is required`);
      return;
    }
    if (o.islands.length < 2) {
      c.fail('CONFIG_EXPLICIT_ISLANDS', `${where}.islands`, `has ${o.islands.length} entry; at least 2 islands ("${part}", "${part}__island2", ...) are required — use uvs, triangles, hull, weights directly for a single-slot part`);
    }
    o.islands.forEach((entry, i) => {
      const atIsl = `${where}.islands[${i}]`;
      const isl = c.object(atIsl, entry, ['slot', 'uvs', 'triangles', 'hull', 'weights'], ['bone', 'before']);
      if (isl === null) return;
      const expectedSlot = i === 0 ? part : `${part}__island${i + 1}`;
      if ('slot' in isl && c.string(`${atIsl}.slot`, isl.slot) && isl.slot !== expectedSlot) {
        c.fail('CONFIG_EXPLICIT_ISLAND_SLOT', `${atIsl}.slot`, `is "${isl.slot}"; island ${i + 1} of "${part}" must be named "${expectedSlot}"`);
      }
      if ('bone' in isl && c.string(`${atIsl}.bone`, isl.bone)) {
        if (!bones.has(isl.bone)) c.fail('CONFIG_NAME_RESOLVES', `${atIsl}.bone`, `names "${isl.bone}", which is not a bone`);
        else if (Array.isArray(m.segments) && !m.segments.includes(isl.bone)) c.fail('CONFIG_NAME_RESOLVES', `${atIsl}.bone`, `names "${isl.bone}", which this explicit mesh's segments do not declare`);
      }
      if ('before' in isl) {
        if (i === 0) c.fail('CONFIG_EXPLICIT_ISLANDS', `${atIsl}.before`, `is declared on island 1 ("${part}"), which takes its draw position from assemble.plan; only "${part}__island2" and later may declare before`);
        else c.string(`${atIsl}.before`, isl.before);
      }
      checkExplicitPayload(c, atIsl, isl, m, bones);
    });
    return;
  }
  for (const k of ['uvs', 'triangles', 'hull', 'weights']) if (!(k in o)) c.fail('CONFIG_FIELD_PRESENT', `${where}.${k}`, 'is absent and required');
  checkExplicitPayload(c, where, o, m, bones);
}

/** The fields of the distance rule and of the other modes, which an influence mesh does not read (issue #378). */
export const INFLUENCE_FOREIGN_FIELDS = ['r', 'exponent', 'rule', 'influences', 'stray', 'ribs'] as const;

/**
 * `meshes.<part>.influence` (issue #378): rig-c's `segments` lattice over the part (`cell`, px) and its `influence`
 * pull (`radius` px, `across`, `max`, `shape`, AUTHORING §3.4.7 in rig-c), every field required and none defaulted.
 * A field of the distance rule or of another mode beside it is refused by name (`CONFIG_INFLUENCE_MODE`) rather
 * than read by nothing. Whether `radius` reaches the part's farthest vertex is the rig stage's to measure, against
 * the lattice it builds (`RIG_INFLUENCE_REACH`, `src/rig.ts`).
 */
function checkInfluence(c: Check, at: string, m: Record<string, Json>): void {
  for (const k of INFLUENCE_FOREIGN_FIELDS) {
    if (k in m) c.fail('CONFIG_INFLUENCE_MODE', `${at}.${k}`, `is ${show(m[k])} on an influence mesh; it pulls each vertex by rig-c's influence (radius, across, max, shape), which reads no ${k} — remove ${k}`);
  }
  const o = c.object(`${at}.influence`, m.influence, ['cell', 'radius', 'across', 'max', 'shape'], ['hold_tip']);
  if (o === null) return;
  // Issue #615: one spelling — true smooths the held fork, absent leaves the shares as pulled; false would be a second
  // spelling of absent, and a mesh_report row that echoes it would differ from the one written before the field existed.
  if ('hold_tip' in o && o.hold_tip !== true) c.fail('CONFIG_FIELD_TYPE', `${at}.influence.hold_tip`, `is ${show(o.hold_tip)}; true (the pulled shares smoothed across the held fork, capped at max) is required — remove hold_tip to keep the shares as rig-c pulls them`);
  if ('cell' in o) c.int(`${at}.influence.cell`, o.cell, 1);
  if ('radius' in o) c.number(`${at}.influence.radius`, o.radius, 'positive');
  if ('across' in o && typeof o.across !== 'boolean') c.fail('CONFIG_FIELD_TYPE', `${at}.influence.across`, `is ${show(o.across)}; true (every link within radius pulls, across the segments entries) or false (only the links of the entry nearest the vertex) is required`);
  if ('max' in o) c.int(`${at}.influence.max`, o.max, 1);
  if ('shape' in o && o.shape !== 'linear' && o.shape !== 'smooth') c.fail('CONFIG_FIELD_TYPE', `${at}.influence.shape`, `is ${show(o.shape)}; "linear" (1 - x) or "smooth" (1 - x²(3 - 2x)) is required`);
}

/**
 * `meshes.<part>.auto.stimulus` (issue #196): a declared bend, `{ chain,
 * degrees }` or a non-empty list of them, for a part no idle key deforms (a
 * part only a physics constraint moves). Each `chain` must be one this mesh's
 * `segments` name — the bend is measured on the bones the part is weighted to
 * — and named once; `degrees` a number above 0, the rotation each link of the
 * chain takes about its joint, both signs measured (`src/automotion.ts`).
 * Nothing is defaulted: absent, no stimulus is declared and the stage is the
 * one it was before the field existed.
 */
function checkStimulus(c: Check, at: string, v: Json, m: Record<string, Json>, chains: Map<string, number>): void {
  const list = Array.isArray(v) ? v : [v];
  if (Array.isArray(v) && v.length === 0) {
    c.fail('CONFIG_FIELD_TYPE', at, 'is []; { chain, degrees } or a non-empty list of them is required — remove stimulus to declare none');
    return;
  }
  const named = new Set((Array.isArray(m.segments) ? m.segments : []).filter((s): s is string => typeof s === 'string' && chains.has(s)));
  const seen = new Set<string>();
  list.forEach((e, i) => {
    const eat = Array.isArray(v) ? `${at}[${i}]` : at;
    const o = c.object(eat, e, ['chain', 'degrees'], []);
    if (o === null) return;
    if ('chain' in o) {
      if (typeof o.chain !== 'string') {
        c.fail('CONFIG_FIELD_TYPE', `${eat}.chain`, `is ${show(o.chain)}; the name of a chain this mesh's segments name is required`);
      } else if (!named.has(o.chain)) {
        c.fail(
          'CONFIG_NAME_RESOLVES',
          `${eat}.chain`,
          `names "${o.chain}", which ${chains.has(o.chain) ? "is a chain this mesh's segments do not name" : 'is not a chain config.bones declares'}; a chain among this mesh's segments is required${named.size > 0 ? ` (${[...named].join(', ')})` : ' (it names none)'} — a bend of bones the part is not weighted to moves none of it`,
        );
      } else if (seen.has(o.chain)) {
        c.fail('CONFIG_FIELD_TYPE', `${eat}.chain`, `names "${o.chain}" a second time; each chain is bent once, by its one declared degrees`);
      } else seen.add(o.chain);
    }
    if ('degrees' in o) c.number(`${eat}.degrees`, o.degrees, 'positive');
  });
}

/**
 * `meshes.<part>.influences` (issue #284): the lattice and contour modes' cut, the author's per mesh —
 * `maxInfluences`, a whole number 1 or more or `null` (no cap), and `floor`, `"cut"` or `"continuous"` (`FloorForm`,
 * `src/weights.ts`). Either may be absent (4, and the cut); an object naming neither is refused, since it would
 * declare nothing. The automatic mode states its cap and floor in `auto.influences`, which rig-c's reduction is
 * handed, so this field beside `auto` is refused by name (`CONFIG_INFLUENCES_MODE`) rather than read by nothing.
 */
function checkMeshInfluences(c: Check, at: string, m: Record<string, Json>): void {
  if ('auto' in m) {
    c.fail('CONFIG_INFLUENCES_MODE', at, `is ${show(m.influences)} on an automatic mesh (auto); the automatic mode states its cap and floor in auto.influences (maxInfluences, minWeight), which rig-c's reduction is handed — declare them there, or remove influences`);
    return;
  }
  const l = c.object(at, m.influences, [], ['maxInfluences', 'floor']);
  if (l === null) return;
  if (!('maxInfluences' in l) && !('floor' in l)) c.fail('CONFIG_FIELD_TYPE', at, `is ${show(m.influences)}, which names neither maxInfluences nor floor; remove influences to keep the cap of 4 and the cut at 0.03`);
  if ('maxInfluences' in l && l.maxInfluences !== null && !(typeof l.maxInfluences === 'number' && Number.isInteger(l.maxInfluences) && l.maxInfluences >= 1)) {
    c.fail('CONFIG_FIELD_TYPE', `${at}.maxInfluences`, `is ${show(l.maxInfluences)}; an integer at or above 1, or null (no cap: every bone the mesh's segments name), is required`);
  }
  if ('floor' in l && !FLOOR_FORMS.includes(l.floor as FloorForm)) {
    c.fail('CONFIG_FIELD_TYPE', `${at}.floor`, `is ${show(l.floor)}; "cut" (shares under 0.03 dropped, what an absent floor means) or "continuous" (0.03 subtracted from every share, those at or below 0 dropped) is required`);
  }
}

/**
 * `meshes.<part>.stray` (issue #303): the lattice's largest island, in art pixels, that may be left out — a whole
 * number, 0 or more, as the contour mode's `contour.stray` is. The contour and automatic modes already state it in
 * their own place (`contour.stray`, `auto.source.stray`), so beside either it is refused by name
 * (`CONFIG_STRAY_MODE`) rather than read by nothing.
 */
function checkLatticeStray(c: Check, at: string, m: Record<string, Json>): void {
  const elsewhere = 'contour' in m ? ['a contour mesh (contour)', 'contour.stray'] : 'auto' in m ? ['an automatic mesh (auto)', 'auto.source.stray'] : null;
  if (elsewhere !== null && !('grid' in m)) {
    c.fail('CONFIG_STRAY_MODE', at, `is ${show(m.stray)} on ${elsewhere[0]}; that mode states the largest island it may leave out in ${elsewhere[1]}, which its trace reads — declare it there, or remove stray`);
    return;
  }
  c.int(at, m.stray, 0);
}

/**
 * `meshes.<part>.ribs` (issue #188): an object of chain name → `{ stations }`.
 * Each key must be a chain this mesh's `segments` name (a rib is placed along
 * a chain the mesh is weighted to), `stations` a whole number, 0 or more, and
 * the mesh one of the two modes that place vertices where declared; a lattice
 * that declares ribs is refused (`CONFIG_RIBS_MODE`), and so is an object that
 * names no chain, which would place nothing. Where a rib falls is decided at
 * the rig stage, against the part's art (`src/contour.ts`, `placeRibs`).
 */
function checkRibs(c: Check, at: string, m: Record<string, Json>, chains: Map<string, number>): void {
  if ('grid' in m) {
    c.fail('CONFIG_RIBS_MODE', at, "is declared on a lattice mesh (grid); ribs are placed by the contour and auto modes, whose vertices go where they are declared — a lattice's vertices are its grid's corners, which no row can move; declare contour or auto, or remove ribs");
  }
  const v = m.ribs;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    c.fail('CONFIG_FIELD_TYPE', at, `is ${show(v)}; an object of chain name -> { stations } is required`);
    return;
  }
  const named = new Set((Array.isArray(m.segments) ? m.segments : []).filter((s): s is string => typeof s === 'string' && chains.has(s)));
  const keys = Object.keys(v).filter((k) => !isDoorKey(k));
  if (keys.length === 0) c.fail('CONFIG_FIELD_TYPE', at, 'names no chain; one or more chains this mesh\'s segments name are required — remove ribs to place none');
  for (const k of keys) {
    const kat = `${at}.${k}`;
    if (!named.has(k)) {
      c.fail('CONFIG_NAME_RESOLVES', kat, `names "${k}", which ${chains.has(k) ? "is a chain this mesh's segments do not name" : 'is not a chain config.bones declares'}; a chain among this mesh's segments is required${named.size > 0 ? ` (${[...named].join(', ')})` : ' (it names none)'}`);
    }
    const r = c.object(kat, (v as Record<string, Json>)[k], ['stations'], []);
    if (r !== null && 'stations' in r) c.int(`${kat}.stations`, r.stations, 0);
  }
}

/**
 * `meshes.<part>.contour` (issue #84). `tolerance`, `margin` and `spacing` are
 * required — nothing is defaulted; `maxEdge`, `budget`, `stray` and `regions` are
 * optional, and an absent one is "none", not a guessed value. What the outline
 * itself refuses (a band that folds a polygon, a spacing whose keep radius
 * snaps to nothing) is `src/contour.ts`'s, at the rig stage, in its words;
 * what is read here is the shape of the block, the bone each region names, and
 * the grid every region number must sit on.
 */
function checkContour(c: Check, at: string, v: Json, bones: Set<string>): void {
  const o = c.object(at, v, ['tolerance', 'margin', 'spacing'], ['maxEdge', 'budget', 'stray', 'bridges', 'regions', 'bust']);
  if (o === null) return;
  if ('tolerance' in o) c.number(`${at}.tolerance`, o.tolerance, 'non-negative');
  if ('margin' in o && c.number(`${at}.margin`, o.margin, 'non-negative') && (o.margin as number) > 0 && (o.margin as number) < 1) {
    c.fail('CONFIG_FIELD_TYPE', `${at}.margin`, `is ${o.margin as number}; 0, or 1 px or more, is required — the outline's silhouette grows by the pixels whose centre lies within the margin of an art pixel's centre, and none lies closer than 1 px, so a margin under 1 px would add nothing`);
  }
  if ('spacing' in o) c.number(`${at}.spacing`, o.spacing, 'positive');
  if ('maxEdge' in o) c.number(`${at}.maxEdge`, o.maxEdge, 'positive');
  if ('budget' in o) c.int(`${at}.budget`, o.budget, 3);
  if ('stray' in o) c.int(`${at}.stray`, o.stray, 0);
  if ('bridges' in o && o.bridges !== true) c.fail('CONFIG_FIELD_TYPE', `${at}.bridges`, `is ${show(o.bridges)}; true is required (every island joined into one outline by bridges, issue #326) — remove the field for the one-island rule`);
  const onGrid = (path: string, n: Json, rule: 'any' | 'positive' | 'non-negative'): void => {
    if (!c.number(path, n, rule)) return;
    const v2 = n as number;
    if (!Number.isInteger(v2 * GRID) || Math.abs(v2) > MAX_SIDE) {
      c.fail('CONFIG_FIELD_TYPE', path, `is ${v2}; a multiple of 1/${GRID} px within ±${MAX_SIDE} px is required — a region's weight is 1 inside it and 0 past its band, and those two are decided exactly on that grid`);
    }
  };
  const names = new Set<string>();
  if ('regions' in o && c.array(`${at}.regions`, o.regions, false)) {
    (o.regions as Json[]).forEach((rv, i) => {
      const rat = `${at}.regions[${i}]`;
      const shape = typeof rv === 'object' && rv !== null && !Array.isArray(rv) ? (rv as Record<string, Json>).shape : undefined;
      const own = shape === 'circle' ? ['cx', 'cy', 'r'] : shape === 'polygon' ? ['points'] : [];
      const r = c.object(rat, rv, ['name', 'shape', 'bone', 'spacing', 'band', ...own], []);
      if (r === null) return;
      if ('shape' in r && own.length === 0) c.fail('CONFIG_FIELD_TYPE', `${rat}.shape`, `is ${show(r.shape)}; "circle" (with cx, cy, r) or "polygon" (with points) is required`);
      if ('name' in r && c.string(`${rat}.name`, r.name)) {
        if (names.has(r.name)) c.fail('CONFIG_REGION_NAME_UNIQUE', `${rat}.name`, `"${r.name}" is declared twice in this mesh; each region needs its own name`);
        names.add(r.name);
      }
      if ('bone' in r && (typeof r.bone !== 'string' || !bones.has(r.bone))) {
        c.fail('CONFIG_NAME_RESOLVES', `${rat}.bone`, `is ${show(r.bone)}; a bone config.bones declares is required — the region's control bone`);
      }
      if ('spacing' in r) c.number(`${rat}.spacing`, r.spacing, 'positive');
      if ('band' in r) onGrid(`${rat}.band`, r.band, 'non-negative');
      if (shape === 'circle') {
        if ('cx' in r) onGrid(`${rat}.cx`, r.cx, 'any');
        if ('cy' in r) onGrid(`${rat}.cy`, r.cy, 'any');
        if ('r' in r) onGrid(`${rat}.r`, r.r, 'positive');
      }
      if (shape === 'polygon' && 'points' in r && c.array(`${rat}.points`, r.points, true)) {
        const pts = r.points as Json[];
        if (pts.length < 3) c.fail('CONFIG_FIELD_TYPE', `${rat}.points`, `has ${pts.length} point(s); 3 or more [x, y] in rig pixels are required`);
        pts.forEach((p, k) => {
          if (!c.point(`${rat}.points[${k}]`, p)) return;
          onGrid(`${rat}.points[${k}][0]`, (p as Point)[0], 'any');
          onGrid(`${rat}.points[${k}][1]`, (p as Point)[1], 'any');
        });
      }
    });
  }
  if ('bust' in o) {
    const bat = `${at}.bust`;
    const b = c.object(bat, o.bust, ['apex_r', 'apex_l', 'cleavage'], ['alpha', 'clearance', 'bone_r', 'bone_l', 'spacing']);
    if (b === null) return;
    for (const dup of ['bust_r', 'bust_l'] as const) {
      if (names.has(dup)) {
        c.fail('CONFIG_REGION_NAME_UNIQUE', bat, `"${dup}" is declared in both ${at}.regions and ${bat}; give either ${bat} or hand-written bust_r/bust_l in ${at}.regions, not both`);
      }
    }
    let ptsOk = true;
    for (const k of ['apex_r', 'apex_l', 'cleavage'] as const) {
      if (!(k in b)) {
        ptsOk = false;
        continue;
      }
      if (!c.point(`${bat}.${k}`, b[k])) {
        ptsOk = false;
        continue;
      }
      onGrid(`${bat}.${k}[0]`, (b[k] as Point)[0], 'any');
      onGrid(`${bat}.${k}[1]`, (b[k] as Point)[1], 'any');
    }
    let alpha = DEFAULT_BUST_ALPHA;
    let alphaOk = true;
    if ('alpha' in b) {
      if (!c.number(`${bat}.alpha`, b.alpha, 'positive')) alphaOk = false;
      else if ((b.alpha as number) >= 1) {
        c.fail('CONFIG_FIELD_TYPE', `${bat}.alpha`, `is ${b.alpha as number}; a core ratio in (0, 1) is required (default ${DEFAULT_BUST_ALPHA})`);
        alphaOk = false;
      } else alpha = b.alpha as number;
    }
    let clearance = DEFAULT_BUST_CLEARANCE;
    let clearanceOk = true;
    if ('clearance' in b) {
      if (!c.number(`${bat}.clearance`, b.clearance, 'any')) clearanceOk = false;
      else clearance = b.clearance as number;
    }
    if ('spacing' in b) c.number(`${bat}.spacing`, b.spacing, 'positive');
    for (const [k, def, regName] of [
      ['bone_r', DEFAULT_BUST_BONE_R, 'bust_r'],
      ['bone_l', DEFAULT_BUST_BONE_L, 'bust_l'],
    ] as const) {
      const bone = k in b ? b[k] : def;
      if (typeof bone !== 'string' || !bones.has(bone)) {
        c.fail('CONFIG_NAME_RESOLVES', `${bat}.${k}`, `is ${show(bone)}; a bone config.bones declares is required — ${regName}'s control bone`);
      }
    }
    if (ptsOk && alphaOk && clearanceOk) {
      const [rx, ry] = b.apex_r as Point;
      const [lx, ly] = b.apex_l as Point;
      const [kx, ky] = b.cleavage as Point;
      const D = edgeLength(lx - rx, ly - ry);
      const dR = edgeLength(kx - rx, ky - ry);
      const dL = edgeLength(kx - lx, ky - ly);
      const RR = Math.round(dR - clearance);
      const RL = Math.round(dL - clearance);
      const rR = Math.round(alpha * RR);
      const rL = Math.round(alpha * RL);
      const bandR = RR - rR;
      const bandL = RL - rL;
      if (clearance <= 0 || RR + RL >= D || rR <= 0 || rL <= 0 || bandR < 0 || bandL < 0) {
        // Invalid coordinates already have named problems, but c.point accepts any finite pair.
        // Restrict only this diagnostic search to onGrid's existing domain, not the refusal rule.
        let remedy = `clearance hint unavailable: correct the CONFIG_FIELD_TYPE landmark coordinates to the 1/${GRID} px grid within ±${MAX_SIDE} px first`;
        if ([rx, ry, lx, ly, kx, ky].every((n) => Number.isInteger(n * GRID) && Math.abs(n) <= MAX_SIDE)) {
          let low = 1;
          let high = Math.ceil(Math.max(dR, dL) * 100) + 100;
          // The coordinate domain bounds high below 2^24; binary search needs at most 24 steps.
          const maxSteps = Math.ceil(Math.log2(high));
          for (let step = 0; low < high && step < maxSteps; step++) {
            const mid = low + Math.floor((high - low) / 2);
            if (Math.round(dR - mid / 100) + Math.round(dL - mid / 100) < D) high = mid;
            else low = mid + 1;
          }
          if (low === high) {
            const candidate = low / 100;
            const nextRR = Math.round(dR - candidate);
            const nextRL = Math.round(dL - candidate);
            const nextR = Math.round(alpha * nextRR);
            const nextL = Math.round(alpha * nextRL);
            remedy = nextRR + nextRL < D && nextR > 0 && nextL > 0 && nextRR - nextR >= 0 && nextRL - nextL >= 0
              ? `the first passing clearance in 0.01 px steps is ${candidate} px for these landmarks and alpha; set clearance to that value`
              : 'no clearance in 0.01 px steps meets all these rounded-radius checks; move cleavage or the apices, or change alpha, and retry';
          }
        }
        c.fail(
          'CONFIG_BUST_CLEARANCE',
          `${bat}.clearance`,
          `is ${clearance} (giving R_r = ${RR}, R_l = ${RL}, R_r + R_l = ${RR + RL} px against apex distance D = ${pyRound(D, 2)} px, r_r = ${rR}, band_r = ${bandR}, r_l = ${rL}, band_l = ${bandL}); a clearance > 0 with R_r + R_l < D and positive core radii and non-negative bands is required; ${remedy}`,
        );
      }
    }
  }
}

/**
 * `meshes.<part>.auto` (issue #126, item 2). Every number is required and
 * read as rig-c's contract types it (docs/MESH_REDUCTION.md §1, §5, §6):
 * nothing is defaulted, nothing is read off the image. The two absences that
 * mean something are stated: `protect` and each of its fields may be left out
 * — `hull` is then false (P20, the default the agreement fixed for parts's
 * policy), each list empty and `weightJump` null (no such protection, which
 * the report echoes) — and `regions` and `source.stray` may be left out, as in
 * the contour mode. `motion` is required (issue #126 item 3), and inside it
 * `maxLocalDeformation`; `maxStretch`, `minStretch`, `deformMayFold` and
 * `gradation` may be left out (`AutoMotionSpec`). What only rig-c can judge (a region bound under one
 * texel, a region outside the art, a protected vertex index the source does
 * not have) is its refusal at the rig stage, in its words.
 */
function checkAuto(c: Check, at: string, v: Json, bones: Set<string>): void {
  const o = c.object(at, v, ['source', 'sourceBounds', 'targets', 'influences', 'budget', 'minArtSamples', 'motion'], ['protect', 'regions', 'boundaryRuns', 'retriangulate', 'removalOrder', 'stimulus']);
  if (o === null) return;
  // Stage B (rigc#1271): three opt-ins, each absent = not sent; a value is exactly one rig-c accepts, or it is refused by name.
  if ('boundaryRuns' in o) {
    const b = c.object(`${at}.boundaryRuns`, o.boundaryRuns, ['maxVertices'], []);
    if (b !== null && 'maxVertices' in b) c.int(`${at}.boundaryRuns.maxVertices`, b.maxVertices, 2);
  }
  if ('retriangulate' in o && o.retriangulate !== 'delaunay') {
    c.fail('CONFIG_FIELD_TYPE', `${at}.retriangulate`, `is ${show(o.retriangulate)}; "delaunay" is required (the one post-pass rig-c offers), or leave the field out for the triangles the removals leave`);
  }
  if ('removalOrder' in o && o.removalOrder !== 'deformation-load') {
    c.fail('CONFIG_FIELD_TYPE', `${at}.removalOrder`, `is ${show(o.removalOrder)}; "deformation-load" is required (the one order rig-c offers besides its default), or leave the field out for ascending source index`);
  }
  if ('motion' in o) {
    const m = c.object(`${at}.motion`, o.motion, ['maxLocalDeformation'], ['maxStretch', 'minStretch', 'deformMayFold', 'gradation', 'selection', 'residual']);
    if (m !== null) {
      // issue #126 (rigc#1295): the skinning residual veto, opt-in; its bound is the author's number, never defaulted.
      if ('residual' in m) {
        const res = c.object(`${at}.motion.residual`, m.residual, ['maxResidual'], []);
        if (res !== null && 'maxResidual' in res) c.number(`${at}.motion.residual.maxResidual`, res.maxResidual, 'non-negative');
      }
      // issue #148: the multi-interval selection, opt-in; its budget is the author's whole number, never defaulted.
      if ('selection' in m) {
        const sel = c.object(`${at}.motion.selection`, m.selection, ['policy', 'maxProbes'], []);
        if (sel !== null) {
          if ('policy' in sel && sel.policy !== 'multi-interval') {
            c.fail('CONFIG_FIELD_TYPE', `${at}.motion.selection.policy`, `is ${show(sel.policy)}; "multi-interval" is required (the one policy besides the bisection), or leave selection out for the bisection`);
          }
          if ('maxProbes' in sel) c.int(`${at}.motion.selection.maxProbes`, sel.maxProbes, 1);
        }
      }
      // rigc#1291: the author's G, a number at or above 0, or null (sent as null: Δ not measured); never derived.
      if ('gradation' in m && m.gradation !== null) c.number(`${at}.motion.gradation`, m.gradation, 'non-negative');
      if ('maxLocalDeformation' in m) c.number(`${at}.motion.maxLocalDeformation`, m.maxLocalDeformation, 'non-negative');
      if ('maxStretch' in m) c.number(`${at}.motion.maxStretch`, m.maxStretch, 'non-negative');
      if ('minStretch' in m) c.number(`${at}.motion.minStretch`, m.minStretch, 'non-negative');
      if ('deformMayFold' in m && typeof m.deformMayFold !== 'boolean') c.fail('CONFIG_FIELD_TYPE', `${at}.motion.deformMayFold`, `is ${show(m.deformMayFold)}; true or false is required`);
    }
  }
  if ('source' in o) {
    const s = c.object(`${at}.source`, o.source, ['tolerance', 'margin', 'spacing'], ['stray']);
    if (s !== null) {
      if ('tolerance' in s) c.number(`${at}.source.tolerance`, s.tolerance, 'non-negative');
      if ('margin' in s && c.number(`${at}.source.margin`, s.margin, 'non-negative') && (s.margin as number) > 0 && (s.margin as number) < 1) {
        c.fail('CONFIG_FIELD_TYPE', `${at}.source.margin`, `is ${s.margin as number}; 0, or 1 px or more, is required — the source's silhouette grows by the pixels whose centre lies within the margin of an art pixel's centre, and none lies closer than 1 px`);
      }
      if ('spacing' in s) c.number(`${at}.source.spacing`, s.spacing, 'positive');
      if ('stray' in s) c.int(`${at}.source.stray`, s.stray, 0);
    }
  }
  const fit = (path: string, f: Json): void => {
    const b = c.object(path, f, ['minCoverage', 'maxOvershoot', 'maxUndercut'], []);
    if (b === null) return;
    if ('minCoverage' in b) c.number(`${path}.minCoverage`, b.minCoverage, 'unit');
    // A bound may be declared absent with null: rig-c (from 2.21.0) measures
    // and reports it as `undeclared` and gates nothing on it. Left out, it is
    // refused above (CONFIG_FIELD_PRESENT), as rig-c refuses it too.
    for (const k of ['maxOvershoot', 'maxUndercut'] as const) {
      if (!(k in b) || b[k] === null) continue;
      const v = b[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        c.fail('CONFIG_FIELD_TYPE', `${path}.${k}`, `is ${show(v)}; a number at or above 0, or null (declared absent: measured and reported, not bounded), is required`);
      }
    }
  };
  if ('sourceBounds' in o) fit(`${at}.sourceBounds`, o.sourceBounds);
  if ('targets' in o) {
    const t = c.object(`${at}.targets`, o.targets, ['artFit', 'maxBoundaryDeviation'], ['minAngle']);
    if (t !== null) {
      if ('artFit' in t) fit(`${at}.targets.artFit`, t.artFit);
      if ('maxBoundaryDeviation' in t) c.number(`${at}.targets.maxBoundaryDeviation`, t.maxBoundaryDeviation, 'non-negative');
      if ('minAngle' in t) c.number(`${at}.targets.minAngle`, t.minAngle, 'non-negative');
    }
  }
  if ('influences' in o) {
    const l = c.object(`${at}.influences`, o.influences, ['maxInfluences', 'minWeight'], []);
    if (l !== null) {
      if ('maxInfluences' in l) c.int(`${at}.influences.maxInfluences`, l.maxInfluences, 1);
      if ('minWeight' in l && c.number(`${at}.influences.minWeight`, l.minWeight, 'non-negative') && (l.minWeight as number) >= 1) {
        c.fail('CONFIG_FIELD_TYPE', `${at}.influences.minWeight`, `is ${l.minWeight as number}; a share at or above 0 and below 1 is required (0 drops only shares that are 0 on the weight grid)`);
      }
    }
  }
  if ('budget' in o) {
    const b = c.object(`${at}.budget`, o.budget, ['maxCandidates'], []);
    if (b !== null && 'maxCandidates' in b) c.int(`${at}.budget.maxCandidates`, b.maxCandidates, 0);
  }
  if ('minArtSamples' in o) c.int(`${at}.minArtSamples`, o.minArtSamples, 1);
  const names = new Set<string>();
  if ('regions' in o && c.array(`${at}.regions`, o.regions, false)) {
    (o.regions as Json[]).forEach((rv, i) => {
      const rat = `${at}.regions[${i}]`;
      const shape = typeof rv === 'object' && rv !== null && !Array.isArray(rv) ? (rv as Record<string, Json>).shape : undefined;
      const own = shape === 'circle' ? ['cx', 'cy', 'r'] : shape === 'polygon' ? ['points'] : [];
      const r = c.object(rat, rv, ['name', 'shape', 'maxEdgeLength', 'transition', 'grade', 'minArtSamples', ...own], ['bone', 'band']);
      if (r === null) return;
      // issue #155: `bone` and `band` together are the weight-and-density form, neither is the density-only form; one alone is refused.
      if ('band' in r && !('bone' in r)) {
        c.fail('CONFIG_REGION_BAND_NEEDS_BONE', `${rat}.band`, `is ${show(r.band)} and the region names no bone; a band is the falloff of a bone's weight — add "bone", or leave "band" out for a density-only region`);
      }
      if ('bone' in r && !('band' in r)) {
        c.fail('CONFIG_REGION_BONE_NEEDS_BAND', `${rat}.bone`, `is ${show(r.bone)} and the region declares no band; a region that weights a bone needs the band its weight falls off across (0 for a hard edge) — add "band", or leave "bone" out for a density-only region`);
      }
      if ('shape' in r && own.length === 0) c.fail('CONFIG_FIELD_TYPE', `${rat}.shape`, `is ${show(r.shape)}; "circle" (with cx, cy, r) or "polygon" (with points) is required`);
      if ('name' in r && c.string(`${rat}.name`, r.name)) {
        if (names.has(r.name)) c.fail('CONFIG_REGION_NAME_UNIQUE', `${rat}.name`, `"${r.name}" is declared twice in this mesh; each region needs its own name`);
        names.add(r.name);
      }
      if ('bone' in r && (typeof r.bone !== 'string' || !bones.has(r.bone))) {
        c.fail('CONFIG_NAME_RESOLVES', `${rat}.bone`, `is ${show(r.bone)}; a bone config.bones declares is required — the region's control bone`);
      }
      const onGrid = (path: string, n: Json, rule: 'any' | 'positive' | 'non-negative'): void => {
        if (!c.number(path, n, rule)) return;
        const v2 = n as number;
        if (!Number.isInteger(v2 * GRID) || Math.abs(v2) > MAX_SIDE) {
          c.fail('CONFIG_FIELD_TYPE', path, `is ${v2}; a multiple of 1/${GRID} px within ±${MAX_SIDE} px is required — a region's weight is 1 inside it and 0 past its band, and those two are decided exactly on that grid`);
        }
      };
      if ('band' in r) onGrid(`${rat}.band`, r.band, 'non-negative');
      if ('maxEdgeLength' in r) c.number(`${rat}.maxEdgeLength`, r.maxEdgeLength, 'positive');
      if ('transition' in r) c.number(`${rat}.transition`, r.transition, 'non-negative');
      if ('grade' in r) c.number(`${rat}.grade`, r.grade, 'non-negative');
      if ('minArtSamples' in r) c.int(`${rat}.minArtSamples`, r.minArtSamples, 1);
      if (shape === 'circle') {
        if ('cx' in r) onGrid(`${rat}.cx`, r.cx, 'any');
        if ('cy' in r) onGrid(`${rat}.cy`, r.cy, 'any');
        if ('r' in r) onGrid(`${rat}.r`, r.r, 'positive');
      }
      if (shape === 'polygon' && 'points' in r && c.array(`${rat}.points`, r.points, true)) {
        const pts = r.points as Json[];
        if (pts.length < 3) c.fail('CONFIG_FIELD_TYPE', `${rat}.points`, `has ${pts.length} point(s); 3 or more [x, y] in rig pixels are required`);
        pts.forEach((p, k) => {
          if (!c.point(`${rat}.points[${k}]`, p)) return;
          onGrid(`${rat}.points[${k}][0]`, (p as Point)[0], 'any');
          onGrid(`${rat}.points[${k}][1]`, (p as Point)[1], 'any');
        });
      }
    });
  }
  if ('protect' in o) {
    const p = c.object(`${at}.protect`, o.protect, [], ['hull', 'vertices', 'edges', 'regionBoundaries', 'weightJump', 'influences']);
    if (p === null) return;
    if ('hull' in p && typeof p.hull !== 'boolean') c.fail('CONFIG_FIELD_TYPE', `${at}.protect.hull`, `is ${show(p.hull)}; true or false is required`);
    if ('vertices' in p && c.array(`${at}.protect.vertices`, p.vertices, false)) (p.vertices as Json[]).forEach((n, k) => c.int(`${at}.protect.vertices[${k}]`, n, 0));
    if ('edges' in p && c.array(`${at}.protect.edges`, p.edges, false)) {
      (p.edges as Json[]).forEach((e, k) => {
        if (!(Array.isArray(e) && e.length === 2 && e.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0))) {
          c.fail('CONFIG_FIELD_TYPE', `${at}.protect.edges[${k}]`, `is ${show(e)}; a pair of source vertex indices [a, b] is required`);
        }
      });
    }
    if ('regionBoundaries' in p && c.array(`${at}.protect.regionBoundaries`, p.regionBoundaries, false)) {
      (p.regionBoundaries as Json[]).forEach((n, k) => {
        if (typeof n !== 'string' || !names.has(n)) c.fail('CONFIG_NAME_RESOLVES', `${at}.protect.regionBoundaries[${k}]`, `is ${show(n)}; the name of a region this mesh declares is required`);
      });
    }
    if ('weightJump' in p && p.weightJump !== null) c.number(`${at}.protect.weightJump`, p.weightJump, 'non-negative');
    if ('influences' in p && c.array(`${at}.protect.influences`, p.influences, false)) {
      (p.influences as Json[]).forEach((n, k) => {
        if (typeof n !== 'string' || !bones.has(n)) c.fail('CONFIG_NAME_RESOLVES', `${at}.protect.influences[${k}]`, `is ${show(n)}; a bone config.bones declares is required`);
      });
    }
  }
}

/** Only false opts out; remove the key for the historical gathering rule. */
function checkGather(c: Check, at: string, entry: Record<string, Json>): void {
  if ('gather' in entry && entry.gather !== false) c.fail('CONFIG_FIELD_TYPE', `${at}.gather`, `is ${show(entry.gather)}; false is required to keep a limb rider at its authored draw position — remove gather for normal gathering`);
}

function checkRegions(c: Check, v: Json, bones: Set<string>): void {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    c.fail('CONFIG_FIELD_TYPE', 'config.regions', `is ${show(v)}; an object of part name -> bone name is required`);
    return;
  }
  for (const [part, entry] of Object.entries(v as Record<string, Json>)) {
    const at = `config.regions.${part}`;
    if (isPlainObject(entry)) {
      const o = c.object(at, entry, ['bone'], ['gather']);
      if (o !== null) checkGather(c, at, o);
    }
    const bone = rawRegionBone(entry);
    if (typeof bone !== 'string') c.fail('CONFIG_NAME_RESOLVES', `config.regions.${part}`, `is ${show(bone)}; a bone name is required`);
    // Issue #671: the part and the bone by name, so an entry `propose --only-missing` drafted on a bone the config
    // does not declare says which.
    else if (!bones.has(bone)) c.fail('CONFIG_NAME_RESOLVES', `config.regions.${part}`, `names the bone ${show(bone)} for the part "${part}", which config.bones does not declare; a declared bone is required`);
  }
}

/** What the loader read off `config.limbs` (issue #349): each limb part with its bone, and each part a limb takes, with the first limb taking it. */
interface LimbNames {
  parts: Map<string, { bone: string; at: string; band?: { limb: string; upper: string } }>;
  consumed: Map<string, string>;
  chains: Map<string, { parts: string[]; bones: string[]; froms: string[] }>;
  /** Issue #664: each segment part a limb's `front.parts` names -> that limb. */
  front: Map<string, string>;
}

/**
 * `config.limbs` (issue #349): `{<limb>: {segments: [{part, from, bone}, {part,
 * from, bone, joint, range?, cap?}, …]}}`, upper segment first. Refused field
 * by field: `part` a new part name (`CONFIG_PART_NAME`, `CONFIG_PART_UNIQUE`
 * against the plan, the patches, the cuts and every other limb part); `from`
 * a plan part or a cut's piece (`CONFIG_NAME_RESOLVES`), the segments of one
 * limb that take one part consecutive (`CONFIG_LIMB_FROM_RUN`: the cut
 * between them is a joint line, and a joint line has two sides); `bone` a
 * declared bone, each segment's bone the child of the one before
 * (`CONFIG_LIMB_BONES_CHAIN`: a bend is a rotation of the lower bone about
 * the joint, its origin); the first segment has no joint, every other names
 * one (`CONFIG_KEY_KNOWN`, `CONFIG_FIELD_PRESENT`); `range` two finite
 * degrees `[min, max]` with `min <= 0 <= max` (`CONFIG_LIMB_RANGE`: the range
 * is measured from rest, so rest is in it); `cap` a non-empty path; `edge`
 * `"feather"` (issue #360), the one value its field takes, and `cap_shape`
 * `"disc"` (issue #360) or `"ball"` (issue #579) — absent is the hard cut and
 * the layer's half-disc (`CONFIG_FIELD_TYPE` on any other); `cut_band` a whole number of px, 1 or
 * more (`CONFIG_FIELD_TYPE`), on a segment that takes the segment above's
 * part (`CONFIG_KEY_KNOWN`: between two layers nothing is cut). A limb
 * has two segments or more. With `names` null (no `bones`), bones are not
 * resolved. Returns the limb parts and the parts the limbs take.
 */
function checkLimbs(c: Check, v: Json, made: { parts: string[]; patches: string[]; cuts: string[] }, names: { bones: Set<string>; parents: Map<string, string> } | null, resolveLayoutParts = true): LimbNames {
  const out: LimbNames = { parts: new Map(), consumed: new Map(), chains: new Map(), front: new Map() };
  if (!isPlainObject(v)) {
    c.fail('CONFIG_FIELD_TYPE', 'config.limbs', `is ${show(v)}; an object of limb name -> {"segments": [...]} is required`);
    return out;
  }
  const sources = new Set([...made.parts, ...made.cuts]);
  const firstAt = new Map<string, string>();
  const limbFroms = new Map<string, Set<string>>();
  const splitLimbs: string[] = [];
  for (const [limb, spec] of Object.entries(v)) {
    const at = `config.limbs.${limb}`;
    const o = c.object(at, spec, ['segments'], ['split', 'layout', 'front']);
    if (o === null) continue;
    if ('split' in o) {
      const sp = c.object(`${at}.split`, o.split, [], ['line', 'edge']);
      if (sp !== null) {
        const hasLine = 'line' in sp;
        const hasEdge = 'edge' in sp;
        if ((hasLine && hasEdge) || (!hasLine && !hasEdge)) {
          c.fail('CONFIG_FIELD_TYPE', `${at}.split`, `is ${show(o.split)}; either "line" (a polyline of two or more [x, y] points in rig px) or "edge": "painting" is required, not both and not neither`);
        } else if (hasLine) {
          const pts = sp.line;
          const ok =
            Array.isArray(pts) &&
            pts.length >= 2 &&
            pts.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && Number.isFinite(p[0]) && typeof p[1] === 'number' && Number.isFinite(p[1]));
          if (!ok) {
            c.fail('CONFIG_FIELD_TYPE', `${at}.split.line`, `is ${show(pts)}; an array of two or more [x, y] points in rig px is required`);
          } else {
            const typed = pts as Array<[number, number]>;
            if (typed.every((p) => p[0] === typed[0][0] && p[1] === typed[0][1])) {
              c.fail('CONFIG_FIELD_TYPE', `${at}.split.line`, `is ${show(pts)}; a polyline with non-zero length is required — all points stand on [${typed[0].join(', ')}]`);
            } else splitLimbs.push(limb);
          }
        } else if (sp.edge !== 'painting') {
          c.fail('CONFIG_FIELD_TYPE', `${at}.split.edge`, `is ${show(sp.edge)}; "painting" is required — traces the covering limb's edge across the crossing from the painting's own stroke or silhouette`);
        } else splitLimbs.push(limb);
      }
    }
    if (!('segments' in o)) continue;
    if (!Array.isArray(o.segments) || o.segments.length < 2) {
      c.fail('CONFIG_FIELD_TYPE', `${at}.segments`, `is ${show(o.segments)}; an array of two segments or more, upper first, is required — a limb is cut at a joint, and a joint has a segment on each side`);
      continue;
    }
    const segs = o.segments as Json[];
    const segParts: Array<string | null> = [];
    const froms: Array<string | null> = [];
    const bones: Array<string | null> = [];
    segs.forEach((entry, i) => {
      const sat = `${at}.segments[${i}]`;
      const e = c.object(sat, entry, ['part', 'from', 'bone'], ['joint', 'range', 'cap', 'edge', 'cap_shape', 'cut_band', 'hybrid']);
      segParts.push(null);
      froms.push(null);
      bones.push(null);
      if (e === null) return;
      // The upper segment sits below no joint; every other sits below one, which it names.
      if (i === 0) {
        for (const k of ['joint', 'range', 'cap', 'edge', 'cap_shape', 'cut_band', 'hybrid'].filter((q) => q in e)) c.fail('CONFIG_KEY_KNOWN', `${sat}.${k}`, `is not a field on the upper segment; it sits below no joint, so ${k} belongs to the segment below the joint it names (segments[1] and on)`);
      } else if (!('joint' in e)) c.fail('CONFIG_FIELD_PRESENT', `${sat}.joint`, 'is absent and required; a segment after the first sits below a joint, at its bone\'s origin, and names it');
      if ('part' in e && c.string(`${sat}.part`, e.part)) {
        const name = e.part;
        if (!partNameOk(name)) c.fail('CONFIG_PART_NAME', `${sat}.part`, `names the part ${show(name)}; a part name is a file name, so it may not be empty, start with "." or hold a slash`);
        else if (made.parts.includes(name) || made.patches.includes(name) || made.cuts.includes(name)) {
          c.fail('CONFIG_PART_UNIQUE', `${sat}.part`, `names the part "${name}", which ${made.parts.includes(name) ? 'assemble.plan' : made.patches.includes(name) ? 'assemble.patches' : 'assemble.cuts'} already makes; a limb segment makes a part of its own`);
        } else if (firstAt.has(name)) c.fail('CONFIG_PART_UNIQUE', `${sat}.part`, `names the part "${name}" again (first at ${firstAt.get(name)})`);
        else {
          firstAt.set(name, sat);
          segParts[i] = name;
          if ('bone' in e && typeof e.bone === 'string') out.parts.set(name, { bone: e.bone, at: `config.limbs.${limb} segment ${i}` });
        }
      }
      if ('hybrid' in e && i > 0) {
        const h = c.object(`${sat}.hybrid`, e.hybrid, ['part'], ['width']);
        if (h !== null) {
          if (c.string(`${sat}.hybrid.part`, h.part)) {
            if (!partNameOk(h.part)) c.fail('CONFIG_PART_NAME', `${sat}.hybrid.part`, `is ${show(h.part)}; a part filename is required`);
            else if (firstAt.has(h.part) || [...made.parts, ...made.patches, ...made.cuts].includes(h.part)) c.fail('CONFIG_PART_UNIQUE', `${sat}.hybrid.part`, `names "${h.part}", already produced; a unique band name is required`);
            else {
              firstAt.set(h.part, `${sat}.hybrid`);
              if (typeof e.bone === 'string' && typeof bones[i - 1] === 'string') out.parts.set(h.part, { bone: e.bone, at: `${sat}.hybrid`, band: { limb, upper: bones[i - 1] as string } });
            }
          }
          if ('width' in h && !(typeof h.width === 'number' && Number.isFinite(h.width) && h.width > 0)) c.fail('CONFIG_FIELD_TYPE', `${sat}.hybrid.width`, `is ${show(h.width)}; finite full axial width above 0 rig px is required`);
        }
        for (const field of ['cap', 'cap_shape', 'edge', 'cut_band']) if (field in e) c.fail('CONFIG_HYBRID_CUT', `${sat}.${field}`, 'is declared with hybrid; the band replaces the cut and cap, so remove the cut option');
        if (e.from !== froms[i - 1]) c.fail('CONFIG_HYBRID_SOURCE', `${sat}.from`, `is ${show(e.from)}; the upper source ${show(froms[i - 1])} is required for one continuous band`);
      }
      if ('from' in e) {
        if (typeof e.from !== 'string' || !sources.has(e.from)) {
          c.fail('CONFIG_NAME_RESOLVES', `${sat}.from`, `is ${show(e.from)}; a part named in assemble.plan or made by an assemble.cuts entry is required — the layer the segment's pixels are cut from`);
        } else {
          froms[i] = e.from;
          if (!out.consumed.has(e.from)) out.consumed.set(e.from, limb);
        }
      }
      if ('bone' in e && c.string(`${sat}.bone`, e.bone)) {
        if (names !== null && !names.bones.has(e.bone)) c.fail('CONFIG_NAME_RESOLVES', `${sat}.bone`, `is "${e.bone}"; a bone config.bones declares is required (a chain's links are <chain>0, <chain>1, …)`);
        else bones[i] = e.bone;
      }
      if ('joint' in e) c.string(`${sat}.joint`, e.joint);
      if ('range' in e) {
        const r = e.range;
        const ok = Array.isArray(r) && r.length === 2 && r.every((n) => typeof n === 'number' && Number.isFinite(n));
        if (!ok) c.fail('CONFIG_FIELD_TYPE', `${sat}.range`, `is ${show(r)}; [min, max], two finite numbers of degrees from rest, is required`);
        else {
          const [lo, hi] = r as [number, number];
          if (!(lo <= 0 && 0 <= hi)) c.fail('CONFIG_LIMB_RANGE', `${sat}.range`, `is [${lo}, ${hi}]; min <= 0 <= max is required — the range is the bend from rest, and rest (0) is a pose the joint takes`);
        }
      }
      if ('cap' in e && !(typeof e.cap === 'string' && e.cap !== '')) {
        c.fail('CONFIG_FIELD_TYPE', `${sat}.cap`, `is ${show(e.cap)}; a non-empty path to a PNG is required, relative to the config's directory — the cap's image over the box assemble's limb line prints`);
      }
      // Issue #360: the cut's geometry at the joint, each field one value; absent is the hard cut and the layer's half-disc.
      if ('edge' in e && e.edge !== 'feather') {
        c.fail('CONFIG_FIELD_TYPE', `${sat}.edge`, `is ${show(e.edge)}; "feather" is required — the upper piece fades out across the cap instead of stopping at the joint line; leave edge out for the hard cut`);
      }
      if ('cap_shape' in e && e.cap_shape !== 'disc' && e.cap_shape !== 'ball') {
        c.fail('CONFIG_FIELD_TYPE', `${sat}.cap_shape`, `is ${show(e.cap_shape)}; "disc" or "ball" is required — "disc" the cap a disc of the limb's half-width about the joint, filled from the art, the upper segment's included; "ball" that disc on both sides of the joint line, its lower half written into the lower piece from the cap image where the piece's layer is transparent (issue #579); leave cap_shape out for the layer's half-disc of half the limb's width`);
      }
      // Issue #360 (item 14): the band the cut is placed in, whole px, on a joint whose two segments take one part.
      if ('cut_band' in e && i > 0) {
        if (!(typeof e.cut_band === 'number' && Number.isInteger(e.cut_band) && e.cut_band >= 1)) {
          c.fail('CONFIG_FIELD_TYPE', `${sat}.cut_band`, `is ${show(e.cut_band)}; a whole number of rig px, 1 or more, is required — the half-width of the band about the joint line the cut is placed in (the line there that crosses the fewest stroke pixels); leave cut_band out to cut at the joint line`);
        } else if (typeof e.from === 'string' && typeof froms[i - 1] === 'string' && froms[i - 1] !== e.from) {
          c.fail('CONFIG_KEY_KNOWN', `${sat}.cut_band`, `is not a field on a segment whose from ("${e.from}") is not the segment above's ("${String(froms[i - 1])}"); no line is cut between two layers — each segment takes its own part whole — so there is no cut to place`);
        }
      }
    });
    out.chains.set(limb, {
      parts: segParts.filter((q): q is string => q !== null),
      bones: bones.filter((q): q is string => q !== null),
      froms: [...new Set(froms.filter((q): q is string => q !== null))],
    });
    limbFroms.set(limb, new Set(froms.filter((f): f is string => f !== null)));
    froms.forEach((f, i) => {
      if (f === null || i === 0 || froms[i - 1] === f) return;
      const back = froms.slice(0, i - 1).lastIndexOf(f);
      if (back >= 0) {
        c.fail('CONFIG_LIMB_FROM_RUN', `${at}.segments[${i}].from`, `is "${f}", which segments[${back}] takes too with another part between them; the segments that take one part must be consecutive — the cut between two of them is the joint line, and it has two sides`);
      }
    });
    if (names !== null) {
      bones.forEach((b, i) => {
        if (i === 0 || b === null || bones[i - 1] === null) return;
        const parent = names.parents.get(b);
        if (parent !== bones[i - 1]) {
          c.fail('CONFIG_LIMB_BONES_CHAIN', `${at}.segments[${i}].bone`, `is "${b}", whose parent is ${parent === undefined ? 'not declared' : `"${parent}"`}; "${bones[i - 1]}", the bone of segments[${i - 1}], is required — the lower segment turns about the joint on a bone that hangs from the upper's`);
        }
      });
    }
  }
  for (const limb of splitLimbs) {
    const myFroms = limbFroms.get(limb) ?? new Set<string>();
    if (myFroms.size === 0) continue;
    const sharers = [...limbFroms.entries()].filter(([other, fs]) => other !== limb && [...myFroms].some((f) => fs.has(f)));
    if (sharers.length === 0) {
      c.fail('CONFIG_FIELD_TYPE', `config.limbs.${limb}.split`, `is declared on "${limb}", whose from part(s) (${[...myFroms].map((f) => `"${f}"`).join(', ')}) no other limb takes; a per-limb split divides a part shared by two limbs`);
    } else {
      const otherSplit = sharers.find(([other]) => splitLimbs.includes(other));
      if (otherSplit !== undefined) {
        const sharedFrom = [...myFroms].find((f) => otherSplit[1].has(f)) as string;
        c.fail('CONFIG_FIELD_TYPE', `config.limbs.${limb}.split`, `is declared on "${limb}" and on "${otherSplit[0]}", which both take "${sharedFrom}"; declare split on the covering limb alone`);
      }
    }
  }
  checkLimbLayouts(c, v, made, out, resolveLayoutParts);
  checkLimbFronts(c, v, made, out, resolveLayoutParts);
  return out;
}

/**
 * Issue #664: `config.limbs.<limb>.front` — `parts` a nonempty list of this
 * limb's own segment parts, each once (`CONFIG_FRONT_SCOPE`); `after` one
 * produced part, the same notion {@link checkLimbLayouts} holds a part target
 * to, and not a part of this limb (`CONFIG_FRONT_NAME`). A front slot and an
 * explicit layout are not composed: a config declaring both, on one limb or on
 * two, is refused (`CONFIG_FRONT_LAYOUT`).
 */
function checkLimbFronts(c: Check, limbs: Record<string, Json>, made: { parts: string[]; patches: string[]; cuts: string[] }, names: LimbNames, resolveParts: boolean): void {
  const produced = new Set([...made.parts, ...made.patches, ...made.cuts].filter((n) => !names.consumed.has(n)));
  for (const n of names.parts.keys()) produced.add(n);
  const layouts = Object.entries(limbs).filter(([, raw]) => isPlainObject(raw) && 'layout' in raw).map(([l]) => l);
  for (const [limb, raw] of Object.entries(limbs)) {
    if (!isPlainObject(raw) || !('front' in raw)) continue;
    const at = `config.limbs.${limb}.front`;
    if (layouts.length > 0) {
      c.fail(
        'CONFIG_FRONT_LAYOUT',
        at,
        `is declared while ${layouts.map((l) => `config.limbs.${l}.layout`).join(', ')} ${layouts.length === 1 ? 'is' : 'are'} declared; version 1 of front slots does not compose with an explicit limb layout (issue #647) — the layout's adjacency proof would have to move the front slots too — so declare one or the other on a rig`,
      );
    }
    const f = c.object(at, raw.front, ['parts', 'after'], []);
    if (f === null) continue;
    const own = names.chains.get(limb)?.parts ?? [];
    if ('parts' in f) {
      const ps = f.parts;
      if (!Array.isArray(ps) || ps.length === 0 || !ps.every((p) => typeof p === 'string' && own.includes(p))) {
        c.fail('CONFIG_FRONT_SCOPE', `${at}.parts`, `is ${show(ps)}; a nonempty list of this limb's own segment parts (${own.join(', ')}) is required — a front slot is a second slot for one of its segments`);
      } else if (new Set(ps).size !== ps.length) {
        c.fail('CONFIG_FRONT_SCOPE', `${at}.parts`, `is ${show(ps)}; each segment part is named once`);
      } else {
        for (const p of ps as string[]) {
          names.front.set(p, limb);
          // The front slot is named <part>_front; a part already made under that name would take the same slot name.
          if (produced.has(`${p}_front`)) c.fail('CONFIG_FRONT_NAME', `${at}.parts`, `names "${p}", whose front slot "${p}_front" is the name of a part this config already makes; rename that part, since a slot name is held once`);
        }
      }
    }
    if ('after' in f && c.string(`${at}.after`, f.after)) {
      const n = f.after;
      if (own.includes(n)) {
        c.fail('CONFIG_FRONT_NAME', `${at}.after`, `names "${n}", a segment part of this same limb; a front slot is placed after a part the limb is drawn behind, never after its own segment`);
      } else if (resolveParts && !produced.has(n)) {
        const consumed = names.consumed.get(n);
        c.fail('CONFIG_FRONT_NAME', `${at}.after`, `names "${n}"; a produced part (${[...produced].join(', ')}) is required${consumed === undefined ? '' : `; "${n}" is consumed by limb "${consumed}" into ${names.chains.get(consumed)?.parts.join(', ')}`}`);
      }
    }
  }
}

/** Validate after every limb is known; a declaration may refer forward by name. */
function checkLimbLayouts(c: Check, limbs: Record<string, Json>, made: { parts: string[]; patches: string[]; cuts: string[] }, names: LimbNames, resolveParts: boolean): void {
  const produced = new Set([...made.parts, ...made.patches, ...made.cuts].filter((n) => !names.consumed.has(n)));
  for (const n of names.parts.keys()) produced.add(n);
  for (const [limb, raw] of Object.entries(limbs)) {
    if (!isPlainObject(raw) || !('layout' in raw)) continue;
    const at = `config.limbs.${limb}.layout`;
    const l = c.object(at, raw.layout, [], ['before', 'after', 'parts']);
    if (l === null) continue;
    const sides = ['before', 'after'].filter((s) => s in l);
    if (sides.length !== 1) c.fail('CONFIG_LAYOUT_TARGET', at, 'exactly one of before or after is required; it means immediate setup-slot adjacency');
    for (const side of sides) {
      const t = c.object(`${at}.${side}`, l[side], [], ['limb', 'part']);
      if (t === null) continue;
      const keys = ['limb', 'part'].filter((k) => k in t);
      if (keys.length !== 1) { c.fail('CONFIG_LAYOUT_TARGET', `${at}.${side}`, 'exactly one typed target, {limb: name} or {part: name}, is required'); continue; }
      const k = keys[0], n = t[k];
      if (!c.string(`${at}.${side}.${k}`, n)) continue;
      if (k === 'limb' ? !Object.hasOwn(limbs, n) : resolveParts && !produced.has(n)) {
        const consumed = names.consumed.get(n);
        c.fail('CONFIG_LAYOUT_NAME', `${at}.${side}.${k}`, `names "${n}"; ${k === 'limb' ? `a declared limb (${Object.keys(limbs).join(', ')})` : `a produced part (${[...produced].join(', ')})`} is required${consumed === undefined ? '' : `; "${n}" is consumed by limb "${consumed}" into ${names.chains.get(consumed)?.parts.join(', ')}`}`);
      }
    }
    if (!('parts' in l)) continue;
    const own = names.chains.get(limb)?.parts ?? [];
    if (!Array.isArray(l.parts) || l.parts.length === 0 || !l.parts.every((p) => typeof p === 'string' && own.includes(p))) {
      c.fail('CONFIG_LAYOUT_SCOPE', `${at}.parts`, `is ${show(l.parts)}; a nonempty list of this limb's source-bound segment parts (${own.join(', ')}) is required; rider names are not selectors`);
      continue;
    }
    const positions = l.parts.map((p) => own.indexOf(p as string)).sort((a, b) => a - b);
    if (new Set(positions).size !== positions.length || positions.some((p, i) => i > 0 && p !== positions[i - 1] + 1)) {
      c.fail('CONFIG_LAYOUT_SCOPE', `${at}.parts`, `is ${show(l.parts)}; distinct consecutive segment-part references in ${own.join(', ')} are required`);
    }
  }
}

/**
 * Every plan part — and every cut's piece, which the caller lists with them —
 * is exactly one of a mesh or a region, every patch is a region, and every
 * mesh or region is one of those parts or a patch.
 */
function checkCoverage(c: Check, made: string[], patches: string[], meshes: Json, regions: Json, limbs: LimbNames | null = null): void {
  const m = typeof meshes === 'object' && meshes !== null ? Object.keys(meshes) : [];
  const r = typeof regions === 'object' && regions !== null ? Object.keys(regions) : [];
  // Issue #349: a part a limb takes is cut into the limb's parts and is not made itself; the limb's parts are.
  const parts = limbs === null ? made : [...made.filter((n) => !limbs.consumed.has(n)), ...limbs.parts.keys()];
  if (limbs !== null) {
    for (const name of [...m, ...r]) {
      const by = limbs.consumed.get(name);
      if (by !== undefined) {
        c.fail('CONFIG_NAME_RESOLVES', `config.${m.includes(name) ? 'meshes' : 'regions'}.${name}`, `names "${name}", which config.limbs.${by} cuts into its parts at the joints, so no part of that name is made — attach the limb's parts instead`);
      }
    }
    for (const [part, seg] of limbs.parts) {
      if (seg.band !== undefined) continue;
      const bone = isPlainObject(regions) ? rawRegionBone(regions[part]) : undefined;
      if (typeof bone === 'string' && bone !== seg.bone) {
        c.fail('CONFIG_LIMB_BONE', `config.regions.${part}`, `is "${bone}"; "${part}" is ${seg.at}, which rides "${seg.bone}" with weight 1, so config.regions.${part} "${seg.bone}" is required`);
      }
    }
  }
  for (const patch of patches) {
    if (m.includes(patch)) c.fail('CONFIG_PART_ATTACHED', `part "${patch}"`, `is an assemble.patches entry and has a meshes entry; a patch is a region — drop config.meshes.${patch} and name its bone in config.regions.${patch}`);
    else if (!r.includes(patch)) c.fail('CONFIG_PART_ATTACHED', `part "${patch}"`, `is an assemble.patches entry with no regions entry; a patch is a region, so config.regions.${patch} naming its bone is required`);
  }
  for (const part of parts) {
    const inM = m.includes(part);
    const inR = r.includes(part);
    if (limbs?.parts.get(part)?.band !== undefined) {
      if (inM || inR) c.fail('CONFIG_PART_ATTACHED', `part "${part}"`, 'is a generated hybrid band; remove its mesh/region entry — the joint supplies its two-carrier attachment');
      continue;
    }
    if (!inM && !inR) c.fail('CONFIG_PART_ATTACHED', `part "${part}"`, 'has neither a meshes entry nor a regions entry; exactly one is required');
    if (inM && inR) c.fail('CONFIG_PART_ATTACHED', `part "${part}"`, 'has both a meshes entry and a regions entry; exactly one is required');
  }
  for (const name of [...m, ...r]) {
    if (!parts.includes(name) && !patches.includes(name) && !(limbs?.consumed.has(name) ?? false)) {
      c.fail('CONFIG_NAME_RESOLVES', `config.${m.includes(name) ? 'meshes' : 'regions'}.${name}`, 'names a part that neither assemble.plan nor assemble.patches makes (nor an assemble.cuts entry, nor config.limbs)');
    }
  }
}

/** What an empty blink group is told: the tags whose parts make its bones, and what to write instead. */
const BLINK_GROUP_EMPTY: Readonly<Record<'eyes' | 'brows', string>> = {
  eyes: 'is []; the eyes group must name at least one bone (rigc refuses a group with no members). The eye bones come from eyewhite-r / eyewhite-l parts; a figure with none has nothing to blink, so leave config.motion.blink out',
  brows: 'is []; the brows group must name at least one bone (rigc refuses a group with no members). The brow bones come from eyebrow-r / eyebrow-l parts; a figure with none has nothing to drop, so leave brows and brow_drop out',
};

function checkMotion(c: Check, v: Json, bones: Set<string>, chains: Map<string, number>, regions: Json): void {
  const m = c.object('config.motion', v, ['duration', 'tracks'], ['blink', 'animations_from']);
  if (m === null) return;
  const p = 'config.motion';
  if ('animations_from' in m) c.string(`${p}.animations_from`, m.animations_from);
  // Every bone property the idle will key, and the tracks that key it, in the
  // order idleMotion writes them: single and chain tracks, then the eyes
  // group, then the brows group.
  const claims = new Map<string, string[]>();
  const claim = (target: string, by: string): void => {
    claims.set(target, [...(claims.get(target) ?? []), by]);
  };
  const duration = 'duration' in m && c.number(`${p}.duration`, m.duration, 'positive') ? (m.duration as number) : null;
  const periodFits = (at: string, period: Json): void => {
    if (!c.number(at, period, 'positive') || duration === null) return;
    const cycles = duration / period;
    if (Math.abs(cycles - Math.round(cycles)) > 1e-9) {
      c.fail(
        'CONFIG_PERIOD_DIVIDES_DURATION',
        at,
        `is ${period} s against a ${duration} s idle, ${cycles.toFixed(4)} cycles; a whole number of cycles is required or the loop's last frame is not its first`,
      );
    }
  };
  if ('tracks' in m && c.array(`${p}.tracks`, m.tracks, false)) {
    (m.tracks as Json[]).forEach((tr, i) => {
      const at = `${p}.tracks[${i}]`;
      if (typeof tr === 'object' && tr !== null && 'chain' in tr) {
        const t = c.object(at, tr, ['chain', 'amps', 'period', 'phase', 'lag'], []);
        if (t === null) return;
        if ('period' in t) periodFits(`${at}.period`, t.period);
        if ('phase' in t) c.number(`${at}.phase`, t.phase);
        if ('lag' in t) c.number(`${at}.lag`, t.lag);
        const links = typeof t.chain === 'string' ? chains.get(t.chain) : undefined;
        if (links === undefined) c.fail('CONFIG_NAME_RESOLVES', `${at}.chain`, `is ${show(t.chain)}; a chain declared in config.bones is required`);
        // A chain track keys rotate on every link (idleMotion), one link per point.
        else for (let k = 0; k < links; k++) claim(`${String(t.chain)}${k}.rotate`, `${at} (chain "${String(t.chain)}", link ${k})`);
        if ('amps' in t && c.array(`${at}.amps`, t.amps, true)) {
          const amps = t.amps as Json[];
          amps.forEach((a, k) => c.number(`${at}.amps[${k}]`, a));
          if (links !== undefined && amps.length !== links) {
            c.fail('CONFIG_AMPS_MATCH_CHAIN', `${at}.amps`, `holds ${amps.length} amplitude(s) for the ${links}-link chain "${String(t.chain)}"; one per link is required`);
          }
        }
        return;
      }
      const t = c.object(at, tr, ['bone', 'prop', 'amp', 'period', 'phase'], ['base']);
      if (t === null) return;
      if (typeof t.bone !== 'string' || !bones.has(t.bone)) c.fail('CONFIG_NAME_RESOLVES', `${at}.bone`, `is ${show(t.bone)}; a declared bone is required`);
      if ('prop' in t && !(SINGLE_PROPS as readonly string[]).includes(t.prop as string)) {
        c.fail('CONFIG_FIELD_TYPE', `${at}.prop`, `is ${show(t.prop)}; one of ${SINGLE_PROPS.join(', ')} is required`);
      } else if ('prop' in t && typeof t.bone === 'string' && bones.has(t.bone)) claim(`${t.bone}.${String(t.prop)}`, at);
      if ('amp' in t) c.number(`${at}.amp`, t.amp);
      if ('period' in t) periodFits(`${at}.period`, t.period);
      if ('phase' in t) c.number(`${at}.phase`, t.phase);
      if ('base' in t) c.number(`${at}.base`, t.base);
    });
  }
  if ('blink' in m) {
    const b = c.object(`${p}.blink`, m.blink, ['t', 'eyes', 'squash'], ['brows', 'brow_drop', 'still']);
    if (b === null) return refuseSharedTargets(c, claims);
    if ('t' in b) c.number(`${p}.blink.t`, b.t, 'non-negative');
    if ('squash' in b) c.number(`${p}.blink.squash`, b.squash, 'positive');
    if ('brow_drop' in b) c.number(`${p}.blink.brow_drop`, b.brow_drop);
    if ('brows' in b && !('brow_drop' in b)) {
      c.fail('CONFIG_BLINK_BROWS_PAIRED', `${p}.blink.brow_drop`, 'is absent while config.motion.blink.brows is stated; the brows group drops by brow_drop, so state both or neither');
    }
    if ('brow_drop' in b && !('brows' in b)) {
      c.fail('CONFIG_BLINK_BROWS_PAIRED', `${p}.blink.brows`, `is absent while config.motion.blink.brow_drop is ${show(b.brow_drop)}; nothing would drop, so state both or neither`);
    }
    for (const key of ['eyes', 'brows'] as const) {
      if (key in b && c.array(`${p}.blink.${key}`, b[key], false)) {
        const list = b[key] as Json[];
        // rigc refuses a group with no members (`group "eyes" declares no
        // members`) one stage later, at the gate; the stage whose input is
        // wrong is this one.
        if (list.length === 0) c.fail('CONFIG_BLINK_GROUP_MEMBERS', `${p}.blink.${key}`, BLINK_GROUP_EMPTY[key]);
        const at = new Map<string, number[]>();
        list.forEach((name, k) => {
          if (typeof name !== 'string' || !bones.has(name)) c.fail('CONFIG_NAME_RESOLVES', `${p}.blink.${key}[${k}]`, `is ${show(name)}; a declared bone is required`);
          if (typeof name === 'string') at.set(name, [...(at.get(name) ?? []), k]);
        });
        // The group track keys one property on every member: scaley for the
        // eyes, translatey for the brows — and the brows track is written only
        // when brow_drop is stated beside them (idleMotion). A member named
        // twice is CONFIG_BLINK_GROUP_UNIQUE's, so each bone claims once, at
        // its first index.
        const prop = key === 'eyes' ? 'scaley' : 'translatey';
        if (key === 'eyes' || 'brow_drop' in b) {
          for (const [name, ks] of at) if (bones.has(name)) claim(`${name}.${prop}`, `${p}.blink.${key}[${ks[0]}] (the blink's ${key} group, which keys ${prop} on every member)`);
        }
        // rigc refuses a member named twice (`group "eyes" names member "eye"
        // twice`) at the gate, one stage late — issue #45, the sibling of the
        // empty group above. One refusal per repeated name, in first-seen order.
        for (const [name, ks] of at) {
          if (ks.length > 1) {
            c.fail(
              'CONFIG_BLINK_GROUP_UNIQUE',
              `${p}.blink.${key}`,
              `names ${show(name)} ${ks.length === 2 ? 'twice' : `${ks.length} times`} (at ${ks.map((k) => `[${k}]`).join(', ')}); each bone is named once — the group keys every member it names, so a repeat keys one bone twice, and rigc refuses a group naming a member twice`,
            );
          }
        }
      }
    }
    if ('still' in b) checkBlinkStill(c, b.still, b.eyes, bones, regions);
  }
  refuseSharedTargets(c, claims);
}

/**
 * Two tracks keying one bone property — two single tracks, a single track
 * beside a chain link's rotate or a blink group's member — are one refusal
 * per property, naming every track that keys it (issue #49). rigc refuses the
 * pair at the rig gate (`animation "idle" has two tracks on eye.scaley`), one
 * stage after the input that was wrong; the loader knows every track it
 * writes. The control bones the rig stage adds (`<bone>_ctl`) cannot make two
 * distinct targets one: the rename is the same suffix on every key of a bone,
 * and a declared bone already holding the control's name is the rig stage's
 * refusal, `RIG_CONTROL_NAME_FREE`.
 */
function refuseSharedTargets(c: Check, claims: ReadonlyMap<string, string[]>): void {
  for (const [target, by] of claims) {
    if (by.length < 2) continue;
    c.fail(
      'CONFIG_BONE_PROPERTY_KEYED_ONCE',
      `bone property "${target}"`,
      `is keyed by ${by.length} tracks: ${by.join(' and ')}; one track per bone property is required — the idle would hold ${by.length} timelines on ${target}, and rigc refuses two tracks on one bone property. Merge them into one track, or key another property or bone`,
    );
  }
}

/**
 * `config.constraints` (issue #92): rig-c's own constraint shapes, read
 * for the four things this package owns and nothing else (see the module
 * comment). What each refusal is for:
 *
 * - `CONFIG_FIELD_TYPE` / `CONFIG_FIELD_PRESENT`: not a list, an entry not an
 *   object, a `type` or `name` absent, a `name` not a non-empty string, an
 *   annotation not a string, a bone field holding something that is not a
 *   name (or a list of names).
 * - `CONFIG_CONSTRAINT_TYPE_KNOWN`: a `type` rigc's union does not name.
 *   rigc refuses it too; the stage whose input is wrong is this one.
 * - `CONFIG_CONSTRAINT_NAME_UNIQUE`: two constraints of one kind under one
 *   name. rigc resolves a constraint by its kind and its name
 *   (`SkeletonData.findConstraint(name, type)`), so an ik and a transform may
 *   share a name and two iks may not — the identity rigc keeps.
 * - `CONFIG_NAME_RESOLVES`: a bone a constraint names that `bones` does not
 *   declare, naming the constraint, the field and the name, with the bones
 *   that exist.
 * - `CONFIG_CONSTRAINT_TARGET_DETACHED`: the bone an ik follows (`target`)
 *   or a transform reads (`source`) is one of the bones it drives or sits
 *   under one, so driving them moves the bone they follow. A scene target is
 *   a bone parented to `root`. The rig stage declares the same fact for rigc
 *   (`invariants.detached`, rigc's `A25`), so the gate holds the built rig to
 *   it too. rigc does not refuse this parentage undeclared: measured through
 *   rig-c 2.15.0 on the rig fixture, an ik over `hem0` following `hem1`
 *   and a transform over `hem0` reading `hem1` each gate green with nothing
 *   declared.
 *
 * Every other field — `mix`, `properties`, a path's `slot`, a slider's
 * `animation` — and every value of it is rigc's, refused at the rig stage's
 * gate in rigc's words. So is an ik's `bones` as a shape (issue #103): from
 * rig-c 2.15.0 its rig-spec parser refuses an ik over more than two
 * bones, or over a pair whose second bone is not the first's child, by name
 * (firejune/rigc#1205); this loader refused both itself while rigc's gate
 * passed them (issue #92), and no longer does.
 */
function checkConstraints(c: Check, v: Json, bones: Set<string>, parents: Map<string, string>): void {
  const p = 'config.constraints';
  if (!c.array(p, v, false)) return;
  const kinds = RIG_SKIN_CONSTRAINT_KEYS as readonly string[];
  const declared = [...bones].join(', ');
  const seen = new Map<string, number>();
  // A bone's parents as the config writes them, nearest first.
  const above = (bone: string): string[] => {
    const out: string[] = [];
    for (let up = parents.get(bone); up !== undefined && !out.includes(up); up = parents.get(up)) out.push(up);
    return out;
  };
  (v as Json[]).forEach((entry, i) => {
    const at = `${p}[${i}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      c.fail('CONFIG_FIELD_TYPE', at, `is ${show(entry)}; a constraint object in rig-c's rig-spec shape is required ({"type": …, "name": …, and that kind's fields})`);
      return;
    }
    const o = entry as Record<string, Json>;
    for (const key of Object.keys(o)) {
      if (!isRecordKey(key) && (key === 'note' || key.endsWith('_note')) && typeof o[key] !== 'string') {
        c.fail('CONFIG_FIELD_TYPE', `${at}.${key}`, `is ${show(o[key])}; an annotation is a string — a structured record goes under a key beginning "x-" (any JSON, read by nothing)`);
      }
    }
    let kind: RigSkinConstraintKey | null = null;
    if (!('type' in o)) c.fail('CONFIG_FIELD_PRESENT', `${at}.type`, `is absent and required; one of ${kinds.join(', ')}`);
    else if (typeof o.type !== 'string' || !kinds.includes(o.type)) {
      c.fail('CONFIG_CONSTRAINT_TYPE_KNOWN', `${at}.type`, `is ${show(o.type)}; one of ${kinds.join(', ')} is required — rig-c's rig-spec constraint kinds, spelled as rigc spells them`);
    } else kind = o.type as RigSkinConstraintKey;
    if (!('name' in o)) c.fail('CONFIG_FIELD_PRESENT', `${at}.name`, 'is absent and required; a constraint is found by its kind and its name');
    else if (c.string(`${at}.name`, o.name) && kind !== null) {
      const id = `${kind} ${o.name}`;
      const first = seen.get(id);
      if (first !== undefined) {
        c.fail(
          'CONFIG_CONSTRAINT_NAME_UNIQUE',
          `${at}.name`,
          `names the ${kind} constraint "${o.name}" again (first at constraints[${first}]); a constraint is found by its kind and its name, so two of one kind may not share one (an ik and a transform may: rig-c's identity of a constraint)`,
        );
      } else seen.set(id, i);
    }
    if (kind === null) return;
    const label = typeof o.name === 'string' && o.name !== '' ? `${kind} constraint "${o.name}"` : `the ${kind} constraint`;
    // The bone names, field by field, resolved against the declared bones.
    const named = new Map<string, string[]>();
    for (const [field, arity] of CONSTRAINT_BONE_FIELDS[kind]) {
      if (!(field in o)) continue;
      const value = o[field];
      const fat = `${at}.${field}`;
      if (arity === 'one') {
        if (typeof value !== 'string') {
          c.fail('CONFIG_FIELD_TYPE', fat, `is ${show(value)}; ${label} names a bone here, and a bone name is required`);
        } else if (!bones.has(value)) {
          c.fail('CONFIG_NAME_RESOLVES', fat, `names "${value}", which config.bones does not declare (${label}); the bones that exist: ${declared}`);
        } else named.set(field, [value]);
        continue;
      }
      if (!Array.isArray(value) || !value.every((n) => typeof n === 'string')) {
        c.fail('CONFIG_FIELD_TYPE', fat, `is ${show(value)}; ${label} names bones here, and a list of bone names is required`);
        continue;
      }
      const list = value as string[];
      list.forEach((n, k) => {
        if (!bones.has(n)) c.fail('CONFIG_NAME_RESOLVES', `${fat}[${k}]`, `names "${n}", which config.bones does not declare (${label}); the bones that exist: ${declared}`);
      });
      if (list.every((n) => bones.has(n))) named.set(field, list);
    }
    const driven = named.get('bones');
    const follows = CONSTRAINT_FOLLOWS[kind];
    const target = follows === undefined ? undefined : named.get(follows)?.[0];
    if (follows !== undefined && target !== undefined && driven !== undefined) {
      const line = [target, ...above(target)];
      const hit = driven.find((b) => line.includes(b));
      if (hit !== undefined) {
        const where = hit === target ? `is "${target}", which ${label} also drives` : `is "${target}", which sits under "${hit}" (${line.slice(0, line.indexOf(hit) + 1).join(' < ')}), a bone ${label} drives`;
        c.fail(
          'CONFIG_CONSTRAINT_TARGET_DETACHED',
          `${at}.${follows}`,
          `${where}; the bone a constraint follows must not move with the bones it drives, or driving them moves what they follow — a scene target is a bone parented to "${ROOT_BONE}"`,
        );
      }
    }
  });
}

/**
 * `config.stops` (issue #404): rig-c 2.56.0's `RigStop` entries, each holding
 * a swinging chain off a leg bone (`against`). `chain` resolves against the
 * chains `config.bones` declares; `links` (when given) and `against` resolve
 * against the bones `config.bones` declares (`CONFIG_NAME_RESOLVES`).
 */
function checkStops(c: Check, v: Json, bones: Set<string>, chains: Map<string, number>): void {
  const p = 'config.stops';
  if (!c.array(p, v, false)) return;
  const declaredBones = [...bones].join(', ');
  const declaredChains = [...chains.keys()].join(', ') || 'none';
  (v as Json[]).forEach((entry, i) => {
    const at = `${p}[${i}]`;
    const o = c.object(at, entry, ['chain', 'against', 'at', 'inward', 'outward'], ['links', 'lower']);
    if (o === null) return;
    let chainLinks: number | undefined;
    if ('chain' in o && c.string(`${at}.chain`, o.chain)) {
      chainLinks = chains.get(o.chain);
      if (chainLinks === undefined) {
        c.fail('CONFIG_NAME_RESOLVES', `${at}.chain`, `names "${o.chain}", which config.bones does not declare as a chain; the chains that exist: ${declaredChains}`);
      }
    }
    let linkCount = chainLinks ?? 0;
    if ('links' in o && c.array(`${at}.links`, o.links, true)) {
      const list = o.links as Json[];
      linkCount = list.length;
      list.forEach((l, k) => {
        if (c.string(`${at}.links[${k}]`, l) && !bones.has(l)) {
          c.fail('CONFIG_NAME_RESOLVES', `${at}.links[${k}]`, `names "${l}", which config.bones does not declare; the bones that exist: ${declaredBones}`);
        }
      });
    }
    if ('against' in o && c.string(`${at}.against`, o.against) && !bones.has(o.against)) {
      c.fail('CONFIG_NAME_RESOLVES', `${at}.against`, `names "${o.against}", which config.bones does not declare; the bones that exist: ${declaredBones}`);
    }
    if ('at' in o) c.point(`${at}.at`, o.at);
    const inward = 'inward' in o && c.number(`${at}.inward`, o.inward) ? (o.inward as number) : null;
    const outward = 'outward' in o && c.number(`${at}.outward`, o.outward) ? (o.outward as number) : null;
    if (inward !== null && outward !== null && inward > outward) {
      c.fail('CONFIG_FIELD_TYPE', `${at}.inward`, `is ${inward}, above outward ${outward}; inward <= outward is required`);
    }
    if ('lower' in o) {
      const lo = c.object(`${at}.lower`, o.lower, ['inward', 'outward'], []);
      if (lo !== null) {
        const li = 'inward' in lo && c.number(`${at}.lower.inward`, lo.inward) ? (lo.inward as number) : null;
        const loOut = 'outward' in lo && c.number(`${at}.lower.outward`, lo.outward) ? (lo.outward as number) : null;
        if (li !== null && loOut !== null && li > loOut) {
          c.fail('CONFIG_FIELD_TYPE', `${at}.lower.inward`, `is ${li}, above lower.outward ${loOut}; inward <= outward is required`);
        }
      }
      if (linkCount === 1) {
        c.fail('CONFIG_FIELD_TYPE', `${at}.lower`, `is ${show(o.lower)} on a 1-link stop; lower holds the links below the first, so leave lower out when links has 1 bone`);
      }
    } else if (linkCount > 1) {
      c.fail('CONFIG_FIELD_PRESENT', `${at}.lower`, `is absent and required when the stop holds ${linkCount} links (more than 1); state lower: { inward, outward } for the links below the first`);
    }
  });
}

/** The parts `meshes` and `regions` attach, read off whatever they hold; `turn.depths` may name only these. */
function attachedParts(meshes: Json, regions: Json): Set<string> {
  const out = new Set<string>();
  for (const v of [meshes, regions]) if (isPlainObject(v)) for (const k of Object.keys(v)) out.add(k);
  return out;
}

/**
 * `config.turn` (issue #251, `src/turn.ts`): `pivot`, the depth that stays put
 * when the control moves, and `depths`, each carried part's See-through
 * `depth_median` as `propose` read it. Neither has a default: a config without
 * `turn` gets no control, and one with it states both.
 *
 * - `CONFIG_FIELD_TYPE` / `CONFIG_FIELD_PRESENT` / `CONFIG_KEY_KNOWN`: not an
 *   object; `pivot` or `depths` absent; another key (records and annotations
 *   aside); a pivot or a depth that is not a finite number; `depths` not an
 *   object or empty.
 * - `CONFIG_NAME_RESOLVES`: a `depths` key that names no part `meshes` or
 *   `regions` attaches. Its keys are part names, so no annotation or record
 *   door is open there.
 * - `CONFIG_TURN_PIVOT_BEHIND_NEAREST`: a pivot at or in front of the nearest
 *   part's depth. The law divides by `pivot − nearest`, so at the nearest depth
 *   it has no value, and in front of it every part would travel against the
 *   dial — no part would be nearer than what stays put.
 * - `CONFIG_TURN_BONE_FREE`: `bones` declares a bone named {@link TURN_BONE},
 *   the control the rig stage adds.
 */
/**
 * `config.scene` (issue #242): an object, and today one with no field — a key
 * that is not a record (`x-…`) or an annotation (`note`, `…_note`) is
 * `CONFIG_KEY_KNOWN`, naming the key and saying the object is the whole
 * declaration. Not `true`: an object is what a later field can be added to
 * without changing what an existing config means.
 */
/**
 * `config.cloth` (issue #364): a recipe per tag `propose --cloth` drafts trees
 * for. Every field is checked here, and every combination that would draft
 * something other than what it says is refused by name:
 *
 * - a tag that is not one of {@link CLOTH_TARGETS} (`CONFIG_KEY_KNOWN`);
 * - `split.at` at or past `links` — no link would be left for the branches
 *   (`CONFIG_CLOTH_SPLIT_BEFORE_TIP`);
 * - a `wind` or `gravity` pair whose tip is below its root: the response is
 *   growing toward the tip (`CONFIG_CLOTH_RESPONSE_GROWS_TO_TIP`);
 * - `alternate_damping` without `damping`, or equal to it: neighbouring trees
 *   are declared out of phase, and an alternate that alternates nothing is
 *   not a declaration (`CONFIG_CLOTH_ALTERNATE_DIFFERS`);
 * - `swing` on a tag other than `bottomwear`, or `swing.scales` not one per
 *   tree (`CONFIG_CLOTH_SWING_SCALE_PER_TREE`);
 * - `part` on a tag other than `bottomwear` (`CONFIG_CLOTH_PART_ON_BOTTOMWEAR`):
 *   the field hands the skirt's recipe to a part of another tag (issue #402),
 *   and only the skirt has a recipe that part can take; whether the part
 *   exists, and is a `topwear` part or its cut piece hanging below the hip, is read off the assembled parts
 *   by `propose` (`PROPOSE_CLOTH_PART`);
 * - a strength, declared or the recipe's default, whose spring is unstable at
 *   a damping the recipe runs at — k = strength·massInverse·step² at or past
 *   2(1 + damping^(60·step)), rig-c's default fps 60 and mass 1, the damping
 *   `damping`, `alternate_damping` or rig-c's default 0.85
 *   (`CONFIG_CLOTH_SPRING_STABLE`, {@link springStable}).
 */
function checkCloth(c: Check, v: Json): void {
  const at = 'config.cloth';
  if (!isPlainObject(v)) {
    c.fail('CONFIG_FIELD_TYPE', at, `is ${show(v)}; an object is required — one recipe per tag, ${CLOTH_TARGETS.map((t) => `"${t}"`).join(', ')}`);
    return;
  }
  // The keys are tags, not fields: read here rather than by c.object, whose lists are field names.
  for (const key of Object.keys(v)) {
    if (isRecordKey(key) || (CLOTH_TARGETS as readonly string[]).includes(key)) continue;
    if (key === 'note' || key.endsWith('_note')) {
      if (typeof v[key] !== 'string') c.fail('CONFIG_FIELD_TYPE', `${at}.${key}`, `is ${show(v[key])}; an annotation is a string`);
      continue;
    }
    c.fail('CONFIG_KEY_KNOWN', `${at}.${JSON.stringify(key)}`, `is not a tag a recipe is drafted for; known: ${CLOTH_TARGETS.map((t) => `"${t}"`).join(', ')} — ${DOORS}`);
  }
  if (Object.keys(v).filter((k) => (CLOTH_TARGETS as readonly string[]).includes(k)).length === 0) {
    c.fail('CONFIG_FIELD_PRESENT', at, `names no tag; one recipe per tag, ${CLOTH_TARGETS.map((t) => `"${t}"`).join(', ')}, is required (leave cloth out for none)`);
  }
  for (const tag of CLOTH_TARGETS) {
    if (!(tag in v)) continue;
    const path = `${at}.${JSON.stringify(tag)}`;
    const r = c.object(path, v[tag], ['links', 'wind', 'gravity'], ['chains', 'split', 'length_ratio', 'strength', 'damping', 'alternate_damping', 'translate', 'swing', 'part', 'parts', 'influence']);
    if (r === null) continue;
    if (tag !== 'back hair' && !('chains' in r)) c.fail('CONFIG_FIELD_PRESENT', `${path}.chains`, 'is absent and required');
    const chains = 'chains' in r && c.int(`${path}.chains`, r.chains, 1) ? (r.chains as number) : null;
    const links = 'links' in r && c.int(`${path}.links`, r.links, 1) ? (r.links as number) : null;
    if ('split' in r) {
      const sp = c.object(`${path}.split`, r.split, ['at', 'into'], ['hold_tip']);
      if (sp !== null) {
        const sAt = 'at' in sp && c.int(`${path}.split.at`, sp.at, 1) ? (sp.at as number) : null;
        if ('into' in sp) c.int(`${path}.split.into`, sp.into, 2);
        if ('hold_tip' in sp && typeof sp.hold_tip !== 'boolean') c.fail('CONFIG_FIELD_TYPE', `${path}.split.hold_tip`, `is ${show(sp.hold_tip)}; true or false is required`);
        if (sAt !== null && links !== null && sAt >= links) {
          c.fail('CONFIG_CLOTH_SPLIT_BEFORE_TIP', `${path}.split.at`, `is ${sAt} and links is ${links}; the trunk's ${sAt} link(s) would leave no link for the branches — split.at below links is required`);
        }
      }
    }
    if ('length_ratio' in r) c.number(`${path}.length_ratio`, r.length_ratio, 'positive');
    // Issue #518: the influence mode for the parts this recipe meshes; the three fields #513 did not vary are the
    // author's, each required, and radius, when stated, is kept as stated (the rig stage holds it to the reach).
    if ('influence' in r) {
      const o = c.object(`${path}.influence`, r.influence, ['across', 'max', 'shape'], ['radius']);
      if (o !== null) {
        if ('across' in o && typeof o.across !== 'boolean') c.fail('CONFIG_FIELD_TYPE', `${path}.influence.across`, `is ${show(o.across)}; true (every link within radius pulls, across the segments entries) or false (only the links of the entry nearest the vertex) is required`);
        if ('max' in o) c.int(`${path}.influence.max`, o.max, 1);
        if ('shape' in o && o.shape !== 'linear' && o.shape !== 'smooth') c.fail('CONFIG_FIELD_TYPE', `${path}.influence.shape`, `is ${show(o.shape)}; "linear" (1 - x) or "smooth" (1 - x²(3 - 2x)) is required`);
        if ('radius' in o) c.number(`${path}.influence.radius`, o.radius, 'positive');
      }
    }
    if ('strength' in r) {
      const st = c.object(`${path}.strength`, r.strength, ['trunk', 'branch', 'edge'], []);
      if (st !== null) for (const k of ['trunk', 'branch', 'edge'] as const) if (k in st) c.number(`${path}.strength.${k}`, st[k], 'positive');
    }
    const damping = 'damping' in r && c.number(`${path}.damping`, r.damping, 'unit') ? (r.damping as number) : null;
    if ('alternate_damping' in r && c.number(`${path}.alternate_damping`, r.alternate_damping, 'unit')) {
      if (!('damping' in r)) c.fail('CONFIG_CLOTH_ALTERNATE_DIFFERS', `${path}.alternate_damping`, 'is declared and damping is absent; the odd trees take alternate_damping in place of the even trees\' damping, so damping is required beside it');
      else if (damping !== null && damping === r.alternate_damping) c.fail('CONFIG_CLOTH_ALTERNATE_DIFFERS', `${path}.alternate_damping`, `is ${damping}, the same as damping; neighbouring trees are declared out of phase, so a different value is required (or leave alternate_damping out)`);
    }
    const st = isPlainObject(r.strength) ? r.strength : null;
    const strengths = (['trunk', 'branch', 'edge'] as const).map((k) => [k, st === null ? RECIPE_STRENGTH[k] : st[k]] as const).filter((e): e is readonly ['trunk' | 'branch' | 'edge', number] => typeof e[1] === 'number' && Number.isFinite(e[1]) && e[1] > 0);
    const dampings = [damping ?? RIGC_DEFAULT_DAMPING, ...(typeof r.alternate_damping === 'number' && r.alternate_damping >= 0 && r.alternate_damping <= 1 ? [r.alternate_damping] : [])];
    for (const [k, value] of strengths) {
      for (const d of dampings) {
        const b = springStable(value, d);
        if (!b.ok) {
          c.fail(
            'CONFIG_CLOTH_SPRING_STABLE',
            `${path}.strength.${k}`,
            `is ${value}${st === null ? " (the recipe's default)" : ''}; at damping ${d}, rig-c's default fps 60 and mass 1, k = strength·massInverse·step² = ${pyRound(b.k, 6)}, and a spring is stable only below 2(1 + damping^(60·step)) = ${pyRound(b.bound, 6)} — lower the strength`,
          );
        }
      }
    }
    for (const k of ['wind', 'gravity'] as const) {
      if (!(k in r)) continue;
      const pair = r[k];
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
        c.fail('CONFIG_FIELD_TYPE', `${path}.${k}`, `is ${show(pair)}; [root, tip], two numbers at or above 0 — the ${k} response of a path's first link and of its last — is required`);
        continue;
      }
      if ((pair[1] as number) < (pair[0] as number)) {
        c.fail('CONFIG_CLOTH_RESPONSE_GROWS_TO_TIP', `${path}.${k}`, `is [${pair[0]}, ${pair[1]}]; the response grows from the root to the tip, where the motion accumulates down the chain, so tip >= root is required`);
      }
    }
    if ('translate' in r && c.number(`${path}.translate`, r.translate, 'unit') && r.translate === 0) {
      c.fail('CONFIG_FIELD_TYPE', `${path}.translate`, 'is 0; a mix above 0 and at most 1 is required (leave translate out for none)');
    }
    const checkPartList = (fieldPath: string, list: Json): void => {
      if (!c.array(fieldPath, list, true)) return;
      const seen = new Set<string>();
      (list as Json[]).forEach((item, i) => {
        if (c.string(`${fieldPath}[${i}]`, item)) {
          const s = item as string;
          if (seen.has(s)) {
            c.fail('CONFIG_CLOTH_PARTS_UNIQUE', `${fieldPath}[${i}]`, `repeats "${s}"; each part in the list must be named once, in order from root to tip`);
          }
          seen.add(s);
        }
      });
    };
    if ('part' in r && 'parts' in r) {
      c.fail('CONFIG_CLOTH_PARTS_UNIQUE', `${path}.parts`, 'is declared beside part; declare either parts (a list of parts from root to tip) or part, not both');
    }
    if ('part' in r) {
      if (Array.isArray(r.part)) {
        checkPartList(`${path}.part`, r.part);
      } else if (tag !== 'bottomwear') {
        c.fail('CONFIG_CLOTH_PART_ON_BOTTOMWEAR', `${path}.part`, `is declared on "${tag}"; part hands the skirt's recipe (bottomwear) to a topwear part or its cut skirt piece (a dress) — leave it out here`);
      } else c.string(`${path}.part`, r.part);
    }
    if ('parts' in r) {
      checkPartList(`${path}.parts`, r.parts);
    }
    if ('swing' in r) {
      if (tag !== 'bottomwear') {
        c.fail('CONFIG_CLOTH_SWING_SCALE_PER_TREE', `${path}.swing`, `is declared on "${tag}"; the shared swing is the skirt's (bottomwear) — leave it out here`);
      } else {
        const sw = c.object(`${path}.swing`, r.swing, ['scales'], []);
        if (sw !== null && 'scales' in sw && c.array(`${path}.swing.scales`, sw.scales, true)) {
          const scales = sw.scales as Json[];
          scales.forEach((n, i) => c.number(`${path}.swing.scales[${i}]`, n, 'positive'));
          if (chains !== null && scales.length !== chains) {
            c.fail('CONFIG_CLOTH_SWING_SCALE_PER_TREE', `${path}.swing.scales`, `holds ${scales.length} scale(s) and chains is ${chains}; one scale per tree, in tree order across the piece, is required`);
          }
        }
      }
    }
  }
}

/**
 * `propose --cloth`'s loader (issue #364): the `cloth` door — `key` and
 * `cloth`, under the full loader's rules for each — and nothing else read.
 * Every other key must still be one a config knows.
 */
export function loadClothConfig(path: string): { key: string; cloth: ClothRecipes } {
  const raw = readConfigFile(path);
  const c = new Check();
  const required = topRequired('cloth');
  const top = c.object('config', raw, required, TOP_KEYS.filter((k) => !required.includes(k)));
  if (top === null) refuseIfAny(c.problems);
  const t = top as Record<string, Json>;
  if ('depth' in t) checkDepthConfig(c, t.depth);
  if ('waist' in t) checkWaistDeclaration(c, t.waist);
  if ('key' in t) c.string('config.key', t.key);
  if ('cloth' in t) checkCloth(c, t.cloth);
  refuseIfAny(c.problems);
  return raw as { key: string; cloth: ClothRecipes };
}

function checkScene(c: Check, v: Json): void {
  if (!isPlainObject(v)) {
    c.fail('CONFIG_FIELD_TYPE', 'config.scene', `is ${show(v)}; an object is required — {} declares the painting a scene`);
    return;
  }
  for (const key of Object.keys(v)) {
    if (isRecordKey(key)) continue;
    if (key === 'note' || key.endsWith('_note')) {
      if (typeof v[key] !== 'string') c.fail('CONFIG_FIELD_TYPE', `config.scene.${key}`, `is ${show(v[key])}; an annotation is a string`);
      continue;
    }
    c.fail('CONFIG_KEY_KNOWN', `config.scene.${key}`, `is not a field here; scene takes no field — {} is the whole declaration (the figure and its threshold are derived, not chosen) — ${DOORS}`);
  }
}

function hasAlternateFaceSet(assemble: Json, planParts: readonly string[]): boolean {
  if (!isPlainObject(assemble) || !Array.isArray(assemble.alternates)) return false;
  const allParts = new Set(planParts);
  for (const alt of assemble.alternates) {
    if (!isPlainObject(alt)) continue;
    const hides = Array.isArray(alt.hides) ? alt.hides : [];
    if (Array.isArray(alt.parts)) {
      if (alt.parts.includes('face') && !hides.includes('face')) return true;
    } else if (allParts.has('face') && !hides.includes('face')) {
      return true;
    }
  }
  return false;
}

function maxDeriveDegrees(anim: unknown): number {
  if (!isPlainObject(anim) || !Array.isArray(anim.tracks)) return 0;
  let maxDeg = 0;
  for (const tr of anim.tracks) {
    if (!isPlainObject(tr) || !Array.isArray(tr.keys)) continue;
    for (const k of tr.keys) {
      if (!isPlainObject(k) || !isPlainObject(k.derive)) continue;
      const deg = k.derive.degrees;
      if (typeof deg === 'number' && Number.isFinite(deg)) {
        const a = Math.abs(deg);
        if (a > maxDeg) maxDeg = a;
      }
    }
  }
  return maxDeg;
}

function checkFaceAnimationBand(c: Check, animations: AnimationsFrom, hasAltFace: boolean, turn?: Json, attached?: Set<string>): void {
  const at = `config.motion.animations_from (${animations.file}).animations`;
  const maxYaw = maxDeriveDegrees(animations.table.turn);
  const maxPitch = maxDeriveDegrees(animations.table.tilt);
  if (maxYaw > 0 || maxPitch > 0) {
    if (turn === undefined) {
      c.fail(
        'CONFIG_TURN_REQUIRED',
        'config.turn',
        "is absent and required when motion.animations_from carries a turn or tilt slider animation with derive keys; copy the turn block propose drafted into config.turn so the head pivot and each head part's depth are declared",
      );
    } else if (isPlainObject(turn) && isPlainObject(turn.depths) && !isPlainObject(turn.roles) && attached !== undefined) {
      for (const reqPart of ['face', 'hair_front', 'hair_back'] as const) {
        if (attached.has(reqPart) && !(reqPart in turn.depths)) {
          c.fail(
            'CONFIG_TURN_REQUIRED',
            `config.turn.depths.${reqPart}`,
            `is absent and required when motion.animations_from carries a turn or tilt slider animation with derive keys and "${reqPart}" is attached; include "${reqPart}"'s See-through depth_median in config.turn.depths so the head pivot and fraction are defined`,
          );
        }
      }
    }
  }
  if (maxYaw > FACE_RATED_YAW_BAND && !hasAltFace) {
    c.fail(
      'CONFIG_FACE_BAND_EXCEEDED',
      `${at}.turn`,
      `rates yaw ±${maxYaw}° on a single face plate; the rated band for one face plate is yaw ±${FACE_RATED_YAW_BAND}° / pitch ±${FACE_RATED_PITCH_BAND}° — declare an alternate face set in config.assemble.alternates to go beyond ±${FACE_RATED_YAW_BAND}° / ±${FACE_RATED_PITCH_BAND}°`,
    );
  }
  if (maxPitch > FACE_RATED_PITCH_BAND && !hasAltFace) {
    c.fail(
      'CONFIG_FACE_BAND_EXCEEDED',
      `${at}.tilt`,
      `rates pitch ±${maxPitch}° on a single face plate; the rated band for one face plate is yaw ±${FACE_RATED_YAW_BAND}° / pitch ±${FACE_RATED_PITCH_BAND}° — declare an alternate face set in config.assemble.alternates to go beyond ±${FACE_RATED_YAW_BAND}° / ±${FACE_RATED_PITCH_BAND}°`,
    );
  }
  const [earLo, earHi] = EAR_DEPTH_RANGE;
  for (const [animName, anim] of [
    ['tilt', animations.table.tilt],
    ['turn', animations.table.turn],
  ] as const) {
    if (!isPlainObject(anim) || !Array.isArray(anim.tracks)) continue;
    anim.tracks.forEach((tr, ti) => {
      if (!isPlainObject(tr) || !Array.isArray(tr.keys)) return;
      const isEarTrack = tr.group === 'ears' || tr.bone === 'ear_r' || tr.bone === 'ear_l';
      if (!isEarTrack) return;
      tr.keys.forEach((k, ki) => {
        if (!isPlainObject(k) || !isPlainObject(k.derive)) return;
        const d = k.derive.depth;
        if (typeof d === 'number' && Number.isFinite(d)) {
          if (d < earLo || d > earHi) {
            c.fail(
              'CONFIG_TURN_EAR_DEPTH_RANGE',
              `${at}.${animName}.tracks[${ti}].keys[${ki}].derive.depth`,
              `is ${d}; an ear depth in [${earLo}, ${earHi}] (at or behind the head pivot) is required`,
            );
          }
        } else if (isPlainObject(d)) {
          for (const [member, val] of Object.entries(d)) {
            if (typeof val === 'number' && Number.isFinite(val) && (val < earLo || val > earHi)) {
              c.fail(
                'CONFIG_TURN_EAR_DEPTH_RANGE',
                `${at}.${animName}.tracks[${ti}].keys[${ki}].derive.depth.${member}`,
                `is ${val}; an ear depth in [${earLo}, ${earHi}] (at or behind the head pivot) is required`,
              );
            }
          }
        }
      });
    });
  }
}

/**
 * Issue #473: an attachment track key in `motion.animations_from` may name an
 * alternate set (`{"t": …, "set": "<name>" | null}`) instead of spelling out the
 * `<set>_<slot>` attachment name. Refuses (`CONFIG_SET_COVERS_SLOT`) when `"set"`
 * appears on a non-attachment track, names an undeclared alternate set, or keys a
 * slot the set does not cover (`slots` or `hides`).
 */
function checkAnimationSetKeys(
  c: Check,
  animations: AnimationsFrom,
  assemble: Json,
  allSlots: Set<string>,
): void {
  const at = `config.motion.animations_from (${animations.file}).animations`;
  const sets = new Map<string, { slots: Set<string>; hides: Set<string> }>();
  if (isPlainObject(assemble) && Array.isArray(assemble.alternates)) {
    for (const alt of assemble.alternates) {
      if (!isPlainObject(alt) || typeof alt.name !== 'string' || alt.name === '') continue;
      const hides = new Set<string>(
        Array.isArray(alt.hides) ? alt.hides.filter((h): h is string => typeof h === 'string') : [],
      );
      for (const sl of allSlots) {
        const m = /^(.+)__island[2-9]\d*$/.exec(sl);
        if (m !== null && hides.has(m[1])) hides.add(sl);
      }
      const altCuts = Array.isArray(alt.cuts)
        ? alt.cuts.filter(isPlainObject).map((cu) => cu.into).filter((s): s is string => typeof s === 'string')
        : [];
      const slots = Array.isArray(alt.parts)
        ? new Set<string>(alt.parts.filter((p): p is string => typeof p === 'string' && !hides.has(p)))
        : new Set<string>([...allSlots, ...altCuts].filter((p) => !hides.has(p)));
      sets.set(alt.name, { slots, hides });
    }
  }
  const declaredSets = sets.size === 0 ? 'none' : [...sets.keys()].map((n) => `"${n}"`).join(', ');
  for (const [animName, anim] of Object.entries(animations.table)) {
    if (!isPlainObject(anim) || !Array.isArray(anim.tracks)) continue;
    anim.tracks.forEach((tr, ti) => {
      if (!isPlainObject(tr) || !Array.isArray(tr.keys)) return;
      const slot = typeof tr.slot === 'string' && tr.slot !== '' ? tr.slot : null;
      const isAttachmentTrack = tr.property === 'attachment' && slot !== null;
      tr.keys.forEach((k, ki) => {
        if (!isPlainObject(k) || !('set' in k)) return;
        const keyAt = `${at}.${animName}.tracks[${ti}].keys[${ki}].set`;
        if (!isAttachmentTrack || slot === null) {
          c.fail(
            'CONFIG_SET_COVERS_SLOT',
            keyAt,
            `is ${show(k.set)} on a ${show(tr.property)} track${slot === null ? '' : ` for slot "${slot}"`}; a "set" key belongs on a slot attachment track ({"slot": "<part>", "property": "attachment", "keys": [{"t": …, "set": "<name>" | null}]})`,
          );
          return;
        }
        if ('v' in k) {
          c.fail(
            'CONFIG_FIELD_TYPE',
            keyAt,
            `is declared beside v (${show(k.v)}); state either "set": "<name>" | null or "v": "<attachment>" | null on an attachment key, not both`,
          );
          return;
        }
        const setVal = k.set;
        if (setVal === null) {
          if (!allSlots.has(slot)) {
            c.fail(
              'CONFIG_SET_COVERS_SLOT',
              keyAt,
              `restores the base attachment on slot "${slot}", which is not a declared slot of the rig (declared slots: ${[...allSlots].map((s) => `"${s}"`).join(', ')})`,
            );
          }
          return;
        }
        if (typeof setVal !== 'string' || setVal === '') {
          c.fail(
            'CONFIG_FIELD_TYPE',
            keyAt,
            `is ${show(setVal)}; a non-empty alternate set name or null (the base pose) is required`,
          );
          return;
        }
        const entry = sets.get(setVal);
        if (entry === undefined) {
          c.fail(
            'CONFIG_SET_COVERS_SLOT',
            keyAt,
            `names alternate set "${setVal}" for slot "${slot}", which config.assemble.alternates does not declare (declared sets: ${declaredSets})`,
          );
          return;
        }
        if (!entry.slots.has(slot) && !entry.hides.has(slot)) {
          const covered = [...entry.slots, ...entry.hides].map((s) => `"${s}"`).join(', ') || 'none';
          c.fail(
            'CONFIG_SET_COVERS_SLOT',
            keyAt,
            `names alternate set "${setVal}" on slot "${slot}", which set "${setVal}" does not cover (set "${setVal}" covers: ${covered}); add "${slot}" to that set's parts (or hides) in config.assemble.alternates, or key a slot the set covers`,
          );
        }
      });
    });
  }
}

function checkTurn(
  c: Check,
  v: Json,
  attached: Set<string>,
  bones: Set<string>,
  hasAltFace: boolean,
  parts: readonly string[] = [],
  declaredSliders: ReadonlySet<string> = new Set(),
  meshParts: ReadonlySet<string> = new Set(),
  rawMeshes: Json = undefined,
  chains: ReadonlyMap<string, number> = new Map(),
  parents: ReadonlyMap<string, string> = new Map(),
): void {
  const at = 'config.turn';
  const meshBoundBones = (part: string): string[] => {
    if (!isPlainObject(rawMeshes) || !isPlainObject(rawMeshes[part])) return [];
    const m = rawMeshes[part] as Record<string, Json>;
    const out: string[] = [];
    const add = (rawBone: string): void => {
      const b = rawBone.endsWith('_d') && bones.has(rawBone.slice(0, -2)) ? rawBone.slice(0, -2) : rawBone;
      if (bones.has(b) && !out.includes(b)) out.push(b);
    };
    if (Array.isArray(m.segments)) {
      for (const s of m.segments) {
        if (typeof s === 'string') {
          const linkCount = chains.get(s);
          if (linkCount !== undefined) {
            for (let lk = 0; lk < linkCount; lk++) add(`${s}${lk}`);
          } else {
            add(s);
          }
        } else if (Array.isArray(s) && typeof s[0] === 'string') {
          add(s[0]);
        }
      }
    }
    if (isPlainObject(m.contour)) {
      if (Array.isArray(m.contour.regions)) {
        for (const rg of m.contour.regions) {
          if (isPlainObject(rg) && typeof rg.bone === 'string') add(rg.bone);
        }
      }
      if (isPlainObject(m.contour.bust)) {
        add(typeof m.contour.bust.bone_r === 'string' ? m.contour.bust.bone_r : DEFAULT_BUST_BONE_R);
        add(typeof m.contour.bust.bone_l === 'string' ? m.contour.bust.bone_l : DEFAULT_BUST_BONE_L);
      }
    }
    if (isPlainObject(m.auto) && Array.isArray(m.auto.regions)) {
      for (const rg of m.auto.regions) {
        if (isPlainObject(rg) && typeof rg.bone === 'string') add(rg.bone);
      }
    }
    if (isPlainObject(m.explicit)) {
      const addWeights = (ws: Json): void => {
        if (!Array.isArray(ws)) return;
        for (const row of ws) {
          if (!Array.isArray(row)) continue;
          for (const w of row) {
            if (isPlainObject(w) && typeof w.bone === 'string') add(w.bone);
          }
        }
      };
      addWeights(m.explicit.weights);
      if (Array.isArray(m.explicit.islands)) {
        for (const isl of m.explicit.islands) {
          if (isPlainObject(isl)) addWeights(isl.weights);
        }
      }
    }
    return out;
  };
  const headSubtreeRoot = (boneName: string): string | null => {
    if (boneName === 'head') return 'head';
    let cur: string | undefined = boneName;
    const seen = new Set<string>();
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      const p = parents.get(cur);
      if (p === 'head') return cur;
      cur = p;
    }
    return null;
  };
  const canCarryHeadUnitBone = (boneName: string): boolean => headSubtreeRoot(boneName) !== null;
  const bodySubtreeRoot = (boneName: string, torsoRoots: ReadonlySet<string>, headExclusion: ReadonlySet<string>): string | null => {
    if (headExclusion.has(boneName)) return null;
    if (torsoRoots.has(boneName)) return boneName;
    let cur: string | undefined = boneName;
    const seen = new Set<string>();
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      const p = parents.get(cur);
      if (p === undefined || headExclusion.has(p)) return null;
      if (torsoRoots.has(p)) return !torsoRoots.has(cur) && !headExclusion.has(cur) ? cur : null;
      cur = p;
    }
    return null;
  };
  const canCarryBodyUnitBone = (boneName: string, torsoRoots: ReadonlySet<string>, headExclusion: ReadonlySet<string>): boolean =>
    bodySubtreeRoot(boneName, torsoRoots, headExclusion) !== null;
  const hasRoles = isPlainObject(v) && 'roles' in v;
  const hasBody = isPlainObject(v) && 'body' in v;
  const hasDepths = isPlainObject(v) && 'depths' in v;
  const o = hasRoles
    ? c.object(at, v, ['roles'], ['pivot', 'depths', 'counter', 'grid', 'unitDepths', 'head', 'deform', 'band', 'radius', 'surface', 'body'])
    : hasBody && !hasDepths
      ? c.object(at, v, ['body'], ['pivot', 'depths', 'roles', 'counter', 'grid', 'unitDepths', 'head', 'deform', 'band', 'radius', 'surface'])
      : c.object(at, v, ['pivot', 'depths'], ['roles', 'counter', 'grid', 'unitDepths', 'head', 'deform', 'band', 'radius', 'surface', 'body']);
  if (o === null) return;
  const pivot = 'pivot' in o && c.number(`${at}.pivot`, o.pivot) ? (o.pivot as number) : null;
  const checkGridField = (gAt: string, gv: Json): void => {
    const checkGridPair = (pAt: string, pv: Json): void => {
      if (!Array.isArray(pv) || pv.length !== 2 || !pv.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 2)) {
        c.fail('CONFIG_FIELD_TYPE', pAt, `is ${show(pv)}; a [cols, rows] pair of integers >= 2 is required`);
      }
    };
    if (Array.isArray(gv)) {
      checkGridPair(gAt, gv);
    } else if (isPlainObject(gv)) {
      for (const [part, pv] of Object.entries(gv)) {
        if (isRecordKey(part)) continue;
        if (!attached.has(part)) {
          c.fail('CONFIG_NAME_RESOLVES', `${gAt}.${part}`, `names "${part}", which neither config.meshes nor config.regions attaches`);
        }
        checkGridPair(`${gAt}.${part}`, pv);
      }
    } else {
      c.fail('CONFIG_FIELD_TYPE', gAt, `is ${show(gv)}; a [cols, rows] pair or object of part -> [cols, rows] is required`);
    }
  };
  const checkUnitDepthsField = (uAt: string, uv: Json): void => {
    if (!isPlainObject(uv)) {
      c.fail('CONFIG_FIELD_TYPE', uAt, `is ${show(uv)}; an object of part or bone name -> scalar depth is required`);
    } else {
      for (const [k, dv] of Object.entries(uv)) {
        if (isRecordKey(k)) continue;
        if (!attached.has(k) && !bones.has(k)) {
          c.fail('CONFIG_NAME_RESOLVES', `${uAt}.${k}`, `names "${k}", which is neither an attached part nor a declared bone`);
        }
        c.number(`${uAt}.${k}`, dv);
      }
    }
  };
  if ('counter' in o && c.number(`${at}.counter`, o.counter)) {
    const cnt = o.counter as number;
    if (cnt < 0 || cnt > 1) {
      c.fail('CONFIG_TURN_COUNTER_RANGE', `${at}.counter`, `is ${cnt}; a rear counter fraction in [0, 1] is required`);
    }
  }
  if ('grid' in o) checkGridField(`${at}.grid`, o.grid);
  if ('unitDepths' in o) checkUnitDepthsField(`${at}.unitDepths`, o.unitDepths);
  if ('roles' in o) {
    const r = o.roles;
    if (!isPlainObject(r) || Object.keys(r).length === 0) {
      c.fail('CONFIG_FIELD_TYPE', `${at}.roles`, `is ${show(r)}; a non-empty object of part name -> ("surface" | "unit" | "rear") is required`);
    } else {
      const surfaceParts: string[] = [];
      const unitMeshParts: string[] = [];
      const earParts: string[] = [];
      const headUnitRootOwner = new Map<string, { part: string; bone: string }>();
      for (const [part, role] of Object.entries(r)) {
        if (isRecordKey(part)) continue;
        if (!attached.has(part)) {
          c.fail('CONFIG_NAME_RESOLVES', `${at}.roles.${part}`, `names "${part}", which neither config.meshes nor config.regions attaches; a part the rig draws is required`);
        }
        if (typeof role !== 'string' || !(TURN_ROLES as readonly string[]).includes(role)) {
          c.fail('CONFIG_TURN_ROLE_UNKNOWN', `${at}.roles.${part}`, `is ${show(role)}; expected one of ${TURN_ROLES.map((x) => `"${x}"`).join(', ')}`);
        } else {
          if (role === 'surface') {
            surfaceParts.push(part);
          }
          if (role === 'unit') {
            if (part === 'ear_r' || part === 'ear_l') earParts.push(part);
            if (meshParts.has(part)) {
              unitMeshParts.push(part);
              if (bones.has('head')) {
                const bound = meshBoundBones(part);
                const uncarried = bound.filter((b) => !canCarryHeadUnitBone(b));
                if (bound.length > 0 && uncarried.length > 0) {
                  c.fail(
                    'CONFIG_TURN_UNIT_MESH_BONES',
                    `${at}.roles.${part}`,
                    `declares "${part}" as "unit", and config.meshes.${part} binds bone(s) ${uncarried.map((b) => `"${b}"`).join(', ')} outside the "head" subtree, which cannot be carried by "${turnUnitBone(part)}" under "${FACESHIFT_BONE}"; bind a head "unit" mesh only to "head" or bones and chains under "head"`,
                  );
                }
                const reportedRoots = new Set<string>();
                for (const b of bound) {
                  if (b === 'head') continue;
                  const rootBone = headSubtreeRoot(b);
                  if (rootBone === null) continue;
                  const owner = headUnitRootOwner.get(rootBone);
                  if (owner !== undefined && owner.part !== part) {
                    if (!reportedRoots.has(rootBone)) {
                      reportedRoots.add(rootBone);
                      const sharedDetail =
                        owner.bone === b
                          ? `bone "${b}"${b === rootBone ? '' : ` (under "${rootBone}")`}`
                          : `chain root "${rootBone}" ("${owner.part}" binds "${owner.bone}", "${part}" binds "${b}")`;
                      c.fail(
                        'CONFIG_TURN_UNIT_MESH_BONES',
                        `${at}.roles.${part}`,
                        `declares "${part}" as "unit", and config.meshes.${part} shares ${sharedDetail} with "unit" mesh "${owner.part}" (${at}.roles.${owner.part}); each "unit" mesh reparents its bound chain root under its own "<part>_unit" carrier, so two "unit" meshes cannot share a bone or chain under "head"`,
                      );
                    }
                  } else if (owner === undefined) {
                    headUnitRootOwner.set(rootBone, { part, bone: b });
                  }
                }
              }
            }
          }
        }
      }
      if (surfaceParts.length === 0) {
        c.fail('CONFIG_TURN_SURFACE_REQUIRED', `${at}.roles`, 'declares no part with role "surface"; at least one surface part (such as "face") is required for 2.5D head turn');
      }
      for (const ear of earParts) {
        const earIdx = parts.indexOf(ear);
        for (const surf of surfaceParts.filter((p) => p === 'face')) {
          const surfIdx = parts.indexOf(surf);
          if (earIdx !== -1 && surfIdx !== -1 && earIdx > surfIdx) {
            c.fail(
              'CONFIG_TURN_EAR_DRAW_ORDER',
              `${at}.roles.${ear}`,
              `draws "${ear}" (plan index ${earIdx}) after surface part "${surf}" (plan index ${surfIdx}); place "${ear}" before "${surf}" in config.assemble.plan so the ear is occluded behind the face`,
            );
          }
        }
      }
      if (!bones.has('head')) {
        c.fail('CONFIG_TURN_HEAD_BONE', `${at}.roles`, 'requires a declared "head" bone in config.bones to parent the 2.5D turn carriers');
      }
      for (const reserved of [FACESHIFT_BONE, REAR_SHIFT_BONE, ...surfaceParts.filter((p) => !meshParts.has(p)).map(turnSurfaceBone), ...unitMeshParts.map(turnUnitBone)]) {
        if (bones.has(reserved)) {
          c.fail('CONFIG_TURN_BONE_FREE', `bone "${reserved}"`, `is a carrier bone the rig stage adds under head for config.turn.roles, and config.bones already declares a bone of that name; rename it`);
        }
      }
    }
  }
  if ('body' in o) {
    const bAt = `${at}.body`;
    const bo = c.object(bAt, o.body, ['roles'], ['pivot', 'bone', 'slider', 'counter', 'grid', 'unitDepths']);
    if (bo !== null) {
      if ('pivot' in bo) {
        c.number(`${bAt}.pivot`, bo.pivot);
      } else if (pivot === null) {
        c.fail('CONFIG_FIELD_PRESENT', `${bAt}.pivot`, 'is absent and required when config.turn.pivot is not declared');
      }
      if ('counter' in bo && c.number(`${bAt}.counter`, bo.counter)) {
        const cnt = bo.counter as number;
        if (cnt < 0 || cnt > 1) {
          c.fail('CONFIG_TURN_COUNTER_RANGE', `${bAt}.counter`, `is ${cnt}; a rear counter fraction in [0, 1] is required`);
        }
      }
      if ('grid' in bo) checkGridField(`${bAt}.grid`, bo.grid);
      if ('unitDepths' in bo) checkUnitDepthsField(`${bAt}.unitDepths`, bo.unitDepths);
      if ('bone' in bo) {
        if (c.string(`${bAt}.bone`, bo.bone) && !bones.has(bo.bone as string)) {
          c.fail('CONFIG_NAME_RESOLVES', `${bAt}.bone`, `names "${bo.bone}", which config.bones does not declare`);
        }
      } else if (!bones.has('chest') && !bones.has('hip')) {
        c.fail('CONFIG_TURN_HEAD_BONE', `${bAt}.roles`, 'requires a declared "chest" or "hip" bone (or config.turn.body.bone) in config.bones to parent the 2.5D body turn carriers');
      }
      let sliderName = BODY_YAW_DIAL_BONE;
      if ('slider' in bo) {
        if (c.string(`${bAt}.slider`, bo.slider)) sliderName = bo.slider as string;
      }
      const headSliders = new Set(['yaw', 'pitch', YAW_DIAL_BONE, PITCH_DIAL_BONE]);
      if (declaredSliders.has(sliderName) || headSliders.has(sliderName)) {
        c.fail(
          'CONFIG_TURN_SLIDER_NAME_FREE',
          `${bAt}.slider`,
          `is "${sliderName}", which collides with an existing slider constraint "${sliderName}"; choose a distinct slider name`,
        );
      }
      if (bones.has(sliderName)) {
        c.fail(
          'CONFIG_TURN_BONE_FREE',
          `bone "${sliderName}"`,
          `is the dial bone the rig stage adds under root for config.turn.body, and config.bones already declares a bone of that name; rename it`,
        );
      }
      const br = bo.roles;
      if (!isPlainObject(br) || Object.keys(br).length === 0) {
        c.fail('CONFIG_FIELD_TYPE', `${bAt}.roles`, `is ${show(br)}; a non-empty object of part name -> ("surface" | "unit" | "rear") is required`);
      } else {
        const bodySurfaceParts: string[] = [];
        const bodyUnitMeshParts: string[] = [];
        const bodyRoot = typeof bo.bone === 'string' && bones.has(bo.bone) ? bo.bone : bones.has('chest') ? 'chest' : 'hip';
        const torsoRoots = new Set<string>([bodyRoot, 'chest', 'hip']);
        const headExclusion = new Set<string>(['head', 'neck']);
        const bodyUnitRootOwner = new Map<string, { part: string; bone: string }>();
        for (const [part, role] of Object.entries(br)) {
          if (isRecordKey(part)) continue;
          if (!attached.has(part)) {
            c.fail('CONFIG_NAME_RESOLVES', `${bAt}.roles.${part}`, `names "${part}", which neither config.meshes nor config.regions attaches; a part the rig draws is required`);
          }
          if (typeof role !== 'string' || !(TURN_ROLES as readonly string[]).includes(role)) {
            c.fail('CONFIG_TURN_ROLE_UNKNOWN', `${bAt}.roles.${part}`, `is ${show(role)}; expected one of ${TURN_ROLES.map((x) => `"${x}"`).join(', ')}`);
          } else if (role === 'surface') {
            bodySurfaceParts.push(part);
          } else if (role === 'unit' && meshParts.has(part)) {
            bodyUnitMeshParts.push(part);
            if (bones.has(bodyRoot)) {
              const bound = meshBoundBones(part);
              const uncarried = bound.filter((b) => !canCarryBodyUnitBone(b, torsoRoots, headExclusion));
              if (bound.length > 0 && uncarried.length > 0) {
                c.fail(
                  'CONFIG_TURN_UNIT_MESH_BONES',
                  `${bAt}.roles.${part}`,
                  `declares "${part}" as "unit", and config.meshes.${part} binds bone(s) ${uncarried.map((b) => `"${b}"`).join(', ')} outside the "${bodyRoot}" torso subtree, which cannot be carried by "${turnUnitBone(part)}" under "${BODYSHIFT_BONE}"; bind a body "unit" mesh only to the torso root or bones and chains under it`,
                );
              }
              const reportedRoots = new Set<string>();
              for (const b of bound) {
                if (torsoRoots.has(b)) continue;
                const rootBone = bodySubtreeRoot(b, torsoRoots, headExclusion);
                if (rootBone === null) continue;
                const owner = bodyUnitRootOwner.get(rootBone);
                if (owner !== undefined && owner.part !== part) {
                  if (!reportedRoots.has(rootBone)) {
                    reportedRoots.add(rootBone);
                    const sharedDetail =
                      owner.bone === b
                        ? `bone "${b}"${b === rootBone ? '' : ` (under "${rootBone}")`}`
                        : `chain root "${rootBone}" ("${owner.part}" binds "${owner.bone}", "${part}" binds "${b}")`;
                    c.fail(
                      'CONFIG_TURN_UNIT_MESH_BONES',
                      `${bAt}.roles.${part}`,
                      `declares "${part}" as "unit", and config.meshes.${part} shares ${sharedDetail} with "unit" mesh "${owner.part}" (${bAt}.roles.${owner.part}); each "unit" mesh reparents its bound chain root under its own "<part>_unit" carrier, so two "unit" meshes cannot share a bone or chain under "${bodyRoot}"`,
                    );
                  }
                } else if (owner === undefined) {
                  bodyUnitRootOwner.set(rootBone, { part, bone: b });
                }
              }
            }
          }
        }
        if (bodySurfaceParts.length === 0) {
          c.fail('CONFIG_TURN_SURFACE_REQUIRED', `${bAt}.roles`, 'declares no part with role "surface"; at least one surface part is required for 2.5D body turn');
        }
        for (const reserved of [BODYSHIFT_BONE, BODY_REAR_SHIFT_BONE, ...bodySurfaceParts.filter((p) => !meshParts.has(p)).map(turnSurfaceBone), ...bodyUnitMeshParts.map(turnUnitBone)]) {
          if (bones.has(reserved)) {
            c.fail('CONFIG_TURN_BONE_FREE', `bone "${reserved}"`, `is a carrier bone the rig stage adds for config.turn.body.roles, and config.bones already declares a bone of that name; rename it`);
          }
        }
      }
    }
  }
  if ('radius' in o) c.number(`${at}.radius`, o.radius, 'positive');
  if ('surface' in o) {
    const so = c.object(`${at}.surface`, o.surface, [], ['radius']);
    if (so !== null && 'radius' in so) c.number(`${at}.surface.radius`, so.radius, 'positive');
  }
  let headPivot: number | null = null;
  if ('head' in o) {
    const ho = c.object(`${at}.head`, o.head, [], ['pivot', 'radius']);
    if (ho !== null) {
      if ('pivot' in ho && c.number(`${at}.head.pivot`, ho.pivot)) {
        headPivot = ho.pivot as number;
      }
      if ('radius' in ho) c.number(`${at}.head.radius`, ho.radius, 'positive');
    }
  }
  const depths: Record<string, number> = {};
  let depthsOk = false;
  if ('depths' in o) {
    const d = o.depths;
    if (!isPlainObject(d) || Object.keys(d).length === 0) {
      c.fail('CONFIG_FIELD_TYPE', `${at}.depths`, `is ${show(d)}; a non-empty object of part name -> See-through depth_median is required`);
    } else {
      depthsOk = true;
      for (const [part, depth] of Object.entries(d)) {
        if (!attached.has(part)) {
          c.fail('CONFIG_NAME_RESOLVES', `${at}.depths.${part}`, `names "${part}", which neither config.meshes nor config.regions attaches; a part the rig draws is required — a depth for a part nobody draws carries nothing`);
          depthsOk = false;
        }
        if (c.number(`${at}.depths.${part}`, depth)) depths[part] = depth;
        else depthsOk = false;
      }
    }
  }
  if ('band' in o) {
    const b = o.band;
    if (typeof b === 'number' && Number.isFinite(b) && b > 0) {
      if (b > FACE_RATED_YAW_BAND && !hasAltFace) {
        c.fail(
          'CONFIG_FACE_BAND_EXCEEDED',
          `${at}.band`,
          `rates yaw ±${b}° on a single face plate; the rated band for one face plate is yaw ±${FACE_RATED_YAW_BAND}° / pitch ±${FACE_RATED_PITCH_BAND}° — declare an alternate face set in config.assemble.alternates to go beyond ±${FACE_RATED_YAW_BAND}° / ±${FACE_RATED_PITCH_BAND}°`,
        );
      }
    } else if (isPlainObject(b)) {
      const bo = c.object(`${at}.band`, b, [], ['yaw', 'pitch']);
      if (bo !== null) {
        const yawOk = !('yaw' in bo) || c.number(`${at}.band.yaw`, bo.yaw, 'positive');
        const pitchOk = !('pitch' in bo) || c.number(`${at}.band.pitch`, bo.pitch, 'positive');
        const yawVal = yawOk && typeof bo.yaw === 'number' ? bo.yaw : null;
        const pitchVal = pitchOk && typeof bo.pitch === 'number' ? bo.pitch : null;
        if (!hasAltFace && ((yawVal !== null && yawVal > FACE_RATED_YAW_BAND) || (pitchVal !== null && pitchVal > FACE_RATED_PITCH_BAND))) {
          const foundParts = [
            ...(yawVal !== null ? [`yaw ±${yawVal}°`] : []),
            ...(pitchVal !== null ? [`pitch ±${pitchVal}°`] : []),
          ];
          c.fail(
            'CONFIG_FACE_BAND_EXCEEDED',
            `${at}.band`,
            `rates ${foundParts.join(' / ')} on a single face plate; the rated band for one face plate is yaw ±${FACE_RATED_YAW_BAND}° / pitch ±${FACE_RATED_PITCH_BAND}° — declare an alternate face set in config.assemble.alternates to go beyond ±${FACE_RATED_YAW_BAND}° / ±${FACE_RATED_PITCH_BAND}°`,
          );
        }
      }
    } else {
      c.fail('CONFIG_FIELD_TYPE', `${at}.band`, `is ${show(b)}; a positive yaw number or {yaw, pitch} is required`);
    }
  }
  if ('deform' in o) {
    const df = o.deform;
    if (!isPlainObject(df)) {
      c.fail('CONFIG_FIELD_TYPE', `${at}.deform`, `is ${show(df)}; an object of face deform key -> per-degree fraction is required`);
    } else {
      const known = Object.keys(FACE_DEFORM_FRACTIONS);
      for (const [key, val] of Object.entries(df)) {
        if (isRecordKey(key)) continue;
        if (key === 'note' || key.endsWith('_note')) {
          if (typeof val !== 'string') c.fail('CONFIG_FIELD_TYPE', `${at}.deform.${key}`, `is ${show(val)}; an annotation is a string`);
          continue;
        }
        if (!Object.hasOwn(FACE_DEFORM_FRACTIONS, key)) {
          c.fail('CONFIG_KEY_KNOWN', `${at}.deform.${key}`, `is not a known face deform fraction; expected one of ${known.join(', ')} — ${DOORS}`);
          continue;
        }
        if (c.number(`${at}.deform.${key}`, val)) {
          const [lo, hi] = FACE_DEFORM_RANGES[key as FaceDeformKey];
          if (val < lo || val > hi) {
            c.fail(
              'CONFIG_TURN_DEFORM_RANGE',
              `${at}.deform.${key}`,
              `is ${val}; a per-degree fraction in [${lo}, ${hi}] is required (default ${FACE_DEFORM_FRACTIONS[key as FaceDeformKey]})`,
            );
          }
        }
      }
    }
  }
  if (!hasRoles && pivot !== null && depthsOk) {
    const nearest = turnNearest(depths);
    if (nearest !== null && !(pivot > nearest.depth)) {
      c.fail(
        'CONFIG_TURN_PIVOT_BEHIND_NEAREST',
        `${at}.pivot`,
        `is ${pivot}; the nearest part, "${nearest.part}", lies at depth ${nearest.depth}, and a pivot above that (further back) is required — each part travels (pivot − depth) / (pivot − ${nearest.depth}) of the control's offset, which has no value at the nearest depth and turns every part against the dial in front of it`,
      );
    }
  }
  if (!hasRoles && headPivot !== null && depthsOk) {
    const nearest = turnNearest(depths);
    if (nearest !== null && !(headPivot > nearest.depth)) {
      c.fail(
        'CONFIG_TURN_PIVOT_BEHIND_NEAREST',
        `${at}.head.pivot`,
        `is ${headPivot}; the nearest part, "${nearest.part}", lies at depth ${nearest.depth}, and a head pivot above that (further back) is required`,
      );
    }
  }
  if (!hasRoles && (!hasBody || hasDepths) && bones.has(TURN_BONE)) {
    c.fail('CONFIG_TURN_BONE_FREE', `bone "${TURN_BONE}"`, `is the control the rig stage adds under root for config.turn, and config.bones already declares a bone of that name; rename it`);
  }
}

/** #773: all scalar units and user polarity are authored, never inferred. */
function checkDepthConfig(c: Check, raw: Json): void {
  const d = c.object('config.depth', raw, [], ['zScale', 'full', 'head']);
  if (d === null) return;
  const scale = (path: string, v: Json | undefined): void => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) c.fail('DEPTH_ZSCALE_REQUIRED', path, `is ${show(v)}; positive finite authored world units are required`);
  };
  if ('zScale' in d) scale('config.depth.zScale', d.zScale);
  const sheet = (path: string, value: Json): void => {
    const q = c.object(path, value, ['image'], ['near', 'zScale']);
    if (q === null) return;
    if ('image' in q) c.string(`${path}.image`, q.image);
    if (q.near !== 'black' && q.near !== 'white') c.fail('DEPTH_NEAR_REQUIRED', `${path}.near`, `is ${show(q.near)}; a user sheet must declare black or white, with no guessed convention`);
    scale(`${path}.zScale`, q.zScale);
  };
  for (const run of ['full', 'head']) if (run in d) {
    const path = `config.depth.${run}`, q = c.object(path, d[run], [], ['layers', 'atlas']);
    if (q === null) continue;
    if ('atlas' in q) sheet(`${path}.atlas`, q.atlas);
    if ('layers' in q) {
      if (!isPlainObject(q.layers)) c.fail('CONFIG_FIELD_TYPE', `${path}.layers`, 'requires an object keyed by exact source layer name');
      else for (const [layer, value] of Object.entries(q.layers)) sheet(`${path}.layers.${layer}`, value);
    }
    if ('atlas' in q && isPlainObject(q.layers) && Object.keys(q.layers).length > 0) c.fail('DEPTH_SOURCE_AMBIGUOUS', path, 'declares canvas and per-layer sheets together; choose one fallback explicitly');
  }
}

/** The operation has no implicit selector, fitted position or tuning coefficient. */
function checkWaistDeclaration(c: Check, raw: Json): void {
  const fields = ['top', 'bottom', 'upper', 'lower', 'bone', 'constraint'] as const;
  const o = c.object('config.waist', raw, ['top', 'bottom', 'upper', 'lower', 'bone', 'constraint'], []);
  if (o === null) return;
  for (const field of fields) if (field in o) c.string(`config.waist.${field}`, o[field]);
  for (const [a, b] of [['top', 'bottom'], ['upper', 'lower']] as const) if (typeof o[a] === 'string' && o[a] === o[b]) c.fail('CONFIG_WAIST_BINDING', `config.waist.${a}`, `matches ${b} ${JSON.stringify(o[b])}; two distinct names are required`);
}
