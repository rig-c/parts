import { baseAnchorProblems, orderedBaseAnchor, baseAnchorMoves, type AnchorRegion } from './baseanchor.ts';
import { padDepthSheet, padTurnDepthSheet, depthSheetProblems, type PartDepthReference } from './depthsheets.ts';
import { explicitBoneNames, explicitSlotBones, explicitWeightRows, regionBone } from './config.ts';
import { explicitAttachment, type ExplicitMeshReport } from './explicitmesh.ts';
/**
 * The rig stage: a character config and its assembled parts in, a rig spec
 * and a motion spec in rig-c's format out.
 *
 *     config (bones, meshes, regions, motion) + parts.json + parts/*.png
 *       -> images/*.png, rig.json, motion.json, mesh_report.json
 *
 * Everything written is something rig-c takes verbatim; no rigc
 * generator is used. What is authored:
 *
 * - **Bones**, unscaled, at the config's landmarks. A chain
 *   `{chain: "c", points: [p0 .. pn]}` becomes the bones `c0 .. cn`, each the
 *   parent of the next. `root` sits at the bottom centre of the rig canvas.
 *   Each chain link is **turned along its chain** (issue #73): `rotation` is
 *   the direction from its origin to the next link's — the last link's to
 *   the chain's `tip` — in Spine degrees (counter-clockwise, y up, local to
 *   the parent; measured through rigc with a one-bone spec), and `length` is
 *   that distance, so a physics constraint a consumer adds finds a lever
 *   (spine-core's solver reads `bone.data.length`). Under `idleKeys: 'ctl'`
 *   the link's control carries the turn and the length and the link sits at
 *   local rotation 0 under it; under `direct` the link carries them. Every
 *   other bone keeps world rotation 0 — one whose parent is a link is turned
 *   back. Nothing moves: a child's `x, y`, a weight's bind `x, y` and a
 *   region's `x, y` are the landmark carried into the turned frame as written
 *   (rigc's inverse, `src/coords.ts`), a region on a turned bone is turned
 *   back upright by `rotation`, and {@link flattenRig} gives the unturned
 *   numbers the reference wrote. A key the turn would re-aim — a translate
 *   key under a turned parent, a scale or shear key on a turned bone — is
 *   refused (`RIG_KEY_FRAME_UNTURNED`); rotate keys mean what they meant.
 *   A single bone with a `tip` is turned the same way (issue #239): its
 *   `rotation` is the direction from its origin to its tip and its `length`
 *   that distance, the segment its weights are already measured along, so a
 *   `tip` the config states is never accepted and ignored. A tip on its own
 *   origin has no direction and is refused (`RIG_TIP_DISTINCT`).
 * - **The face's axis** (issue #239). The five face bones a blink or an
 *   expression scales or translates, {@link FACE_BONES}, take the eye line's
 *   angle as their world rotation, so the blink's `scaley` squashes across
 *   the eye line and not across the page's horizontal on a tilted head. The
 *   line exists when parts.json holds the parts tagged `eyewhite-r` and
 *   `eyewhite-l` (the first of each, a cut's piece not counted — the parts
 *   `propose` stands `eye_r` and `eye_l` on) and config.bones declares both
 *   eye bones; it runs through the two eye bones' origins, read from the
 *   image-left one to the image-right one, so the angle is always the
 *   measured one, inside (−90°, 90°), which tag is which side does not enter
 *   it, and it is the line rigc's A51 draws. With one eyewhite or none, an
 *   eye bone missing, or two eye bones in one column, there is no line:
 *   {@link FaceAxis} says why and the face bones
 *   keep the page's axes. A face bone with its own `tip` takes the tip. A
 *   bone under a face bone that nothing else turns keeps its parent's axis,
 *   so a key on it means the face's axis too; the face bones' controls carry
 *   the turn as a link's do. Regions on these bones are turned back as every
 *   region is, so the setup pose is the same picture; a scale key on a face
 *   bone, and a translate key on a bone under one, mean the face's axes and
 *   are not refused. A translate key on a face bone itself still moves it
 *   along its parent's (the head's) axes — Spine's rule, which turning the
 *   bone does not change. With a line the rig spec also declares
 *   `invariants.axes` (rig-c 2.40.0): one entry, {@link FACE_AXIS_NAME},
 *   through `eye_r` and `eye_l`, holding the turned bones and their controls,
 *   which rigc's `A51_BONES_LIE_ALONG_THEIR_DECLARED_AXIS` checks. Its
 *   tolerance is measured on the bones as rigc emits them (see where it is
 *   written), the float floor; with no line no entry is written. A face bone
 *   with its own `tip` along the line is held too (issue #258), in a second
 *   entry, {@link FACE_TIPS_AXIS_NAME}: one whose tip lies within the
 *   whole-pixel rounding bound ({@link tipRoundingBound}) of the line is
 *   listed, its tolerance measured the same way, and one further off is its
 *   own axis, named with its gap in `FaceAxis.tipOff` — never silent. The
 *   roll the face bones stand on has one derivation, `src/headframe.ts`'s
 *   `eyeLineDegrees`, which `propose`'s head frame reads too (issue #250).
 * - **Meshes** over the parts named in `meshes`: a square lattice (`src/mesh.ts`)
 *   weighted by distance to the mesh's candidate segments (`src/weights.ts`),
 *   written in rigc's by-name `weights` form. The slot's bone is the first
 *   segment's bone. A mesh whose entry says `contour` (issue #84) is
 *   `src/contour.ts`'s mesh over the padded image instead, each vertex
 *   weighted by `src/localweights.ts` (its regions' bones by their declared
 *   falloff, the rest by the same segments), every refusal collected with the
 *   others; a lattice mesh writes what it always wrote.
 * - **Regions** for the parts named in `regions`: the image centred where the
 *   part sits, offset from its bone. A part named in `motion.blink.still` is
 *   two regions cut at its row: the rows from `row` down on the part's own
 *   slot and bone (they blink), the rows above on `<part>_still` and the
 *   entry's `bone`, drawn right after it (they do not). The cut row must carry
 *   no art: cut through art, each piece is resampled against its own
 *   transparent edge and the render changes at rest — measured on the demo
 *   example, 36 px of the setup pose (max 7 levels) — while a clear-row cut
 *   changes no pixel outside the blink (issue #26, `RG16`). A `painting:`
 *   patch (`assemble.patches`) is always a region. With declared limbs, an
 *   exclusively bound rider joins its limb's slot block (issue #646), keeping
 *   that limb's internal draw order; other patches keep the parts order.
 * - **The idle** and, under `idleKeys: 'ctl'` (the default), its control
 *   bones (`src/motion.ts`). Under `idleKeys: 'direct'` the keys stay on the
 *   bones the meshes are weighted to, no `<bone>_ctl` is added, and the rig
 *   spec declares `invariants.idleDrivesMeshes` with
 *   {@link IDLE_DRIVES_MESHES_WHY} — rig-c 1.3.0's statement that this
 *   idle deforms meshes on purpose, which `A15_IDLE_NO_MESH_BONE_KEYS` then
 *   reports as a SKIP with its cost instead of refusing each bone. The
 *   declaration is written only when the idle keys at least one mesh-driving
 *   bone: rigc refuses a declaration that switches nothing off.
 * - **Constraints**, only when the config has `constraints` (issue #92):
 *   handed to rigc as `rig.json`'s `constraints`, in the order written, each
 *   as written but its records and annotations. Nothing here solves or
 *   validates them; rigc's gate does, and a field it refuses is its refusal,
 *   in its words (`RIG_RIGC_GREEN`) — a two-bone ik whose child the idle
 *   keys through a control included (rig-c 2.15.0, issue #103). Every
 *   bone a constraint follows is declared detached from the bones it drives
 *   ({@link detachedRules}, `invariants.detached`, rigc's `A25`). Without the
 *   field, no byte of any output moves.
 * - **The turn control**, only when the config has `turn` (issue #251,
 *   `src/turn.ts`, {@link applyTurn}): a bone `turn` under `root` nothing
 *   keys, a leaf twin of every bone a carried part binds, and one transform
 *   constraint per part carrying its twins `fraction · turn.x` in world x,
 *   after the config's own constraints. Without the field nothing is added.
 * - **A bone's `inherit`**, only where config.bones declares one (issue
 *   #348): rig-c's mode name, written to that bone in rig.json as declared.
 *   The bone's setup rotation is then the turn from where rig-c's own poser
 *   puts it with a local rotation of 0 — under a mode that drops the parent's
 *   rotation that is not the parent's turn — so the bone still stands
 *   upright, or along its tip, at the setup pose. Where the idle gives the
 *   bone a control, the mode goes on the control, the bone that hangs from the
 *   declared parent, and the bone under it inherits normally: the idle's keys
 *   moved onto the control still turn the bone. Without the field no byte of
 *   any output moves.
 *
 * Every part image is padded by {@link PAD} transparent pixels on each side
 * before it is meshed or placed, and the padded image is what `images/`
 * holds: a lattice vertex on the part's own edge would otherwise sit on the
 * texture's edge, where filtering samples outside the art.
 *
 * Coordinates in the config and in parts.json are rig pixels, y down. The one
 * y flip goes through `src/coords.ts` (rig-c's `cropToSpineY`); x is
 * measured from the canvas centre, which is where `root` stands.
 *
 * Pure: the caller reads the files and writes the outputs; nothing here
 * touches the disk, and the same inputs give the same bytes (key order is the
 * order the objects are built in, and every number is rounded by `pyRound`).
 */
import { type AutoSpec, type BoneEntry, type InfluenceMeshSpec, type WeightRule, type CharacterConfig, type ConfigConstraint, type ConfigStop, CONSTRAINT_FOLLOWS, constraintForRig, contourRegionsOf, type ContourSpec, DEFAULT_BUST_BONE_L, DEFAULT_BUST_BONE_R, type Point, type RibsSpec, ROOT_BONE, stopForRig, turnRidersByBone, weightsABone } from './config.ts';
import { type BoneTransform, computeExactFrameTransforms, cropToSpineY, normaliseDegrees, paintingToSetupPoint, toBoneLocal, toWorld } from './coords.ts';
import { type Problem, refuseIfAny, PartsError } from './errors.ts';
import { recordedFocusProblems } from './setfocus.ts';
import { eyeLineDegrees } from './headframe.ts';
import type { RigBoneInherit, RigStop } from 'rig-c/src/rig.ts';
import { f32 } from 'rig-c/compile';
import type { MeshCounts, MeshQualityReport, MeshReductionInput, MotionAmplitude, ReducedMesh, Termination } from 'rig-c/mesh';
import { buildSegmentsLattice, type EntrySegment, influenceShares, segmentDistance as rigcSegmentDistance, type SegmentsLattice, type SegmentsLatticeReport } from 'rig-c/mesh';
import { type AmplitudeRow, amplitudeRow, partAmplitude, withAmplitude } from './autoamplitude.ts';
import { type ResidualRow, residualRow, slotEnvelope, withSkinning } from './autoenvelope.ts';
import { type AutoMotionCase, type AutoSearch, DEFORM_MAY_FOLD_WHY, type MotionDeformation, type StimulusPose, stimulusAnimationNames } from './automotion.ts';
import { type MultiIntervalRow, refinementSteps, replayVerdict, type ReplayRow } from './autoreplay.ts';
import {
  autoReductionInput,
  autoSource,
  autoVerdict,
  AUTO_THRESHOLD,
  DEFORMATION_UNMEASURED,
  legacyArtCoverage,
  qualityDocument,
  type Reducer,
  type Residual,
  residuals,
  runReduction,
  sourceWeights,
  type StageBOptIns,
  type StageBResult,
  stageBResult,
  worstRegion,
  worstResidual,
} from './automesh.ts';
import { type ContourChainRibs, type ContourReport, contourMesh, type ContourRegion, type ContourRib } from './contour.ts';
import { type LocalInfluence, localInfluences } from './localweights.ts';
import { edgeLength } from './length.ts';
import { skeletonLimbJoints } from './limbs.ts';
import { coalesceLimbSlots } from './limbslots.ts';
import { layoutAlias, placeLimbLayouts, type LayoutPlan } from './limblayout.ts';
import { artCoverage, ART_ALPHA, latticeCells, latticeMesh, latticeStray, ONE_LOOP_PASSES, type LatticeMesh } from './mesh.ts';
import { bindFaceSurfaceDeform, BLINK, blinkHoldMisses, blinkSpan, CONTROL_SUFFIX, controlledBones, IDLE_FPS, idleMotion, type MotionSpec, moveKeysToControls } from './motion.ts';
import { type PartRecord, type AlternateSetMap, FRONT_SUFFIX, PAINTING_RUN, type PartsFile, readFrom, tagOf } from './parts.ts';
import { waistPairs, waistBand, waistInfluences } from './waist.ts';
import { preserveWaistRest, refineWaistMesh, remapWaistDeforms, storedWorld, waistBottomMesh, waistBottomLayoutOf, type WaistMapping } from './waistmesh.ts';
import { pivotWaistMesh, sharedWaistCopy, type WaistPivotRequest } from './waistmesh.ts';
import { readTag } from './tags.ts';
import { EYE_GROUP_TAGS } from './propose.ts';
import { alphaAbove, crop, pad, type Raster } from './raster/index.ts';
import { pyRound } from './round.ts';
import { boneHeat, type HeatDust, heatInfluences, HEAT_LIMITS, heatRow, type HeatRow, latticeSilhouette, tracedSilhouette } from './heat.ts';
import type { PosePoints } from './skeleton.ts';
import { applyFaceSurfaceDeform, BODY_REAR_SHIFT_BONE, BODY_YAW_DIAL_BONE, BODYSHIFT_BONE, buildDepth25DTurn, FACE_RATED_BAND, FACESHIFT_BONE, PITCH_DIAL_BONE, REAR_SHIFT_BONE, resolveTurnGrid, TURN_BONE, TURN_CARRIER_TAG, TURN_GRID_MAX_TRIANGLES_PER_SLOT, TURN_GRID_MAX_TRIANGLES_TOTAL, TURN_PLACES, TURN_RIDER_APART, TURN_RIDER_TAGS, turnRiderDepth, type TurnRole, type TurnSpec, turnConstraintName, turnFractions, turnNearest, turnSurfaceBone, turnTwin, YAW_DIAL_BONE } from './turn.ts';
import { DISTANCE_EXPONENT, type FloorForm, type Influence, influences, type InfluenceLimits, type MeshInfluences, meshLimits, type Segment } from './weights.ts';

/** Transparent pixels added round every part image — the reference's `PAD`. */
export const PAD = 4;

/** Issue #671: the MIGRATION entry for 1.37.0's arm split (#490), by its heading's anchor. */
export const ARM_SPLIT_MIGRATION = 'docs/MIGRATION.md#after-1370-merged-arm-layers-are-split-issue-490';
/** Issue #671: the command that adds only what a config lacks for the arm split's parts: their plan rows and their entries. */
export const ARM_SPLIT_REMEDY = 'rig-parts propose --parts <parts> --source <painting> --out <dir> --write-config <config> --only-missing';

/**
 * The places a bone's rotation and every local offset (a bone's `x, y`, a
 * weight's bind `x, y`, a region's `x, y` and `rotation`) are written to.
 * The reference wrote offsets to 3, and could: its frames were never turned,
 * so an offset was a difference of two landmarks. Under a turned frame an
 * offset is that difference carried through a rotation, and 3 places would
 * move a world position by up to 0.0007 px — enough that turning it back
 * ({@link flattenRig}, to the reference's 3) would land a value on the other
 * side of a rounding step. Each offset is placed through its parent's frame
 * as written, so the errors do not add down a chain: every world position is
 * within 7.1e-7 of its landmark, and the round trip is exact unless a
 * landmark difference lies within that of a 3-place rounding step, which a
 * difference of whole and half pixels never does. An unturned frame writes
 * the same numbers it always wrote.
 */
export const OFFSET_PLACES = 6;

/** The places the reference wrote an offset to, which {@link flattenRig} gives back. */
export const FLAT_PLACES = 3;

/** {@link pyRound} to `n` places, with a negative zero written as 0. */
function placed(v: number, n: number): number {
  const r = pyRound(v, n);
  return r === 0 ? 0 : r;
}

function places(v: number): number {
  return placed(v, OFFSET_PLACES);
}

/**
 * The face bones that take the face's axis (issue #239): the bones `propose`
 * writes for the eyes, the brows and the mouth, which the blink and an
 * expression scale or translate. Read by name, as the blink's groups name
 * them; a config without one of them has nothing of that name to turn.
 */
export const FACE_BONES: readonly string[] = ['eye_r', 'eye_l', 'brow_r', 'brow_l', 'mouth'];

/** The eye line the face bones are turned to, or why there is none (issue #239). */
export interface FaceAxis {
  /** The eye line's angle in Spine degrees (counter-clockwise, y up), as written; null with no line. */
  degrees: number | null;
  /** The eyewhite parts that make the line exist, `eyewhite-r`'s first; fewer than two when they are what is missing. */
  parts: string[];
  /** The face bones turned to the line, in {@link FACE_BONES} order; empty with no line. */
  turned: string[];
  /** The face bones a `tip` of their own turns instead, in {@link FACE_BONES} order. */
  ownTip: string[];
  /** Why there is no line, or null. */
  none: string | null;
  /** The `invariants.axes` entry written for the line (issue #239, rig-c's `A51`), or null with the reason in {@link FaceAxis.noAxis}. */
  axis: RigAxis | null;
  /** Why no axes entry was written, or null when one was (or there is no line, which {@link FaceAxis.none} says). */
  noAxis: string | null;
  /** The `invariants.axes` entry holding the face bones whose own tip lies along the line within whole-pixel rounding (issue #258), or null when none does. */
  tipAxis: RigAxis | null;
  /** For each face bone whose own tip points further off the line than whole-pixel rounding allows, why it is not held (issue #258); in {@link FACE_BONES} order. */
  tipOff: string[];
  /** {@link HEAD_UP_BONE} as written (issue #250): its world rotation (the eye line + 90) and its length; null with the reason in {@link FaceAxis.headUpNone}, or with no line. */
  headUp: { rotation: number; length: number } | null;
  /** Why {@link HEAD_UP_BONE} was not written, when there is a line; null otherwise. */
  headUpNone: string | null;
}

/** One `invariants.axes` entry: rig-c's `RigAxis`, held by its gate rule `A51_BONES_LIE_ALONG_THEIR_DECLARED_AXIS` (2.40.0). */
export interface RigAxis {
  name: string;
  through: [string, string];
  bones: string[];
  tolerance: number;
}

/** The name of the face's `invariants.axes` entry. */
export const FACE_AXIS_NAME = 'face';

/**
 * The slotless bone the rig stage adds under `head` (issue #250): at head's origin, pointing along the face's up axis
 * (the eye line + 90 degrees), as long as the eye midpoint lies from head's origin along it. `head` keeps its own frame,
 * so no key on it or under it changes meaning; a rule that needs the head's frame (issue #249) reads this bone.
 */
export const HEAD_UP_BONE = 'head_up';

/** The name of the `invariants.axes` entry for the face bones whose own tip lies along the eye line (issue #258). */
export const FACE_TIPS_AXIS_NAME = 'face_tips';

/**
 * The most a bone's direction can sit off a line through whole-pixel
 * rounding of its tip alone (issue #258): a tip written in whole pixels is
 * within half a pixel in each coordinate, sqrt(2)/2 px, of the point on the
 * line it stands for, so at `length` px from the origin its direction is
 * within asin((sqrt(2)/2) / length) degrees. Null when the tip is closer than
 * sqrt(2)/2 px, where rounding alone can point it anywhere.
 */
export function tipRoundingBound(length: number): number | null {
  const s = Math.SQRT1_2 / length;
  return s >= 1 ? null : (Math.asin(s) * 180) / Math.PI;
}

/** One unit in the last place a rotation is written to ({@link OFFSET_PLACES}): the axes entry's tolerance stands this far above the gap it measures. */
const WRITTEN_UNIT = 10 ** -6;

/** Two directions' gap as lines, 0 to 90 degrees — rig-c's `lineGap` (A51), restated here because it is not on an entry this package imports. */
function lineGap(a: number, b: number): number {
  const d = (((a - b) % 180) + 180) % 180;
  return Math.min(d, 180 - d);
}

/** The bones the face's line runs through: rigc's A51 draws its line through their origins, and the face bones are turned to that same line. */
export const EYE_BONES: readonly [string, string] = ['eye_r', 'eye_l'];

/**
 * The eye line (issue #239). It exists when parts.json holds an eye on each
 * side — the first part tagged `eyewhite-r` and the first tagged `eyewhite-l`
 * (a cut's piece is neither), the parts `propose` stands `eye_r` and `eye_l`
 * on — and config.bones declares both eye bones. Its angle is read off the
 * two eye bones' origins as the config writes them, image-left to
 * image-right, in Spine's axes through the one y flip: the very line rigc's
 * A51 draws through those bones, so the face bones stand on what the gate
 * measures (the eyewhites' unrounded centres would sit up to a rounding off
 * it — demo's half pixel was 0.47 degrees), and a moved eye bone moves the
 * line with it. Null with the reason when an eyewhite or an eye bone is
 * missing, or when the two eye bones share a column, so the line has no
 * left-to-right direction to read.
 */
export function eyeLine(parts: PartsFile, eyeBones: ReadonlyMap<string, Point>): { degrees: number; parts: [string, string] } | { degrees: null; parts: string[]; none: string } {
  const H = parts.rig_size[1];
  const found = EYE_GROUP_TAGS.map((tag) => ({ tag, part: parts.parts.find((p) => tagOf(p.from) === tag && p.cut_from === undefined) }));
  const have = found.flatMap((f) => (f.part === undefined ? [] : [f.part]));
  if (have.length < 2) {
    const missing = found.filter((f) => f.part === undefined).map((f) => f.tag);
    return { degrees: null, parts: have.map((p) => p.name), none: `parts.json holds no part tagged ${missing.join(' or ')} (a cut's piece is not counted), so there is no eye line` };
  }
  const names = have.map((p) => p.name);
  const absent = EYE_BONES.filter((n) => !eyeBones.has(n));
  if (absent.length > 0) return { degrees: null, parts: names, none: `config.bones declares no single bone ${absent.join(' or ')}, so there is no pair of eye bones for the eye line to run through` };
  const [a, b] = EYE_BONES.map((n) => eyeBones.get(n) as Point);
  if (a[0] === b[0]) return { degrees: null, parts: names, none: `${EYE_BONES[0]} ${pt(a)} and ${EYE_BONES[1]} ${pt(b)} share the column x = ${a[0]}, so the eye line has no left-to-right direction to read` };
  // The one derivation of the roll (issue #250): propose's head frame reads the same function on the same origins.
  return { degrees: eyeLineDegrees(a, b, H), parts: [names[0], names[1]] };
}

/**
 * The weights a contour vertex is written with: a vertex no region reaches is
 * rounded as the lattice rounds ({@link latticeShares}), one a region reaches
 * by {@link roundShares} — and so is every vertex of a mesh that declares the
 * continuous floor (issue #284), whose shares, like a region's ramp, reach
 * below 0.03 and may round to 0.
 */
export function writtenShares(li: LocalInfluence, floor?: FloorForm): Influence[] {
  if (li.region >= 0 || floor === 'continuous') return roundShares(li.influences);
  return latticeShares(li.influences);
}

/**
 * The refusal for a mesh some of whose vertices the cut leaves with no bone (issue #284): the first such vertex, with
 * its capped shares before the floor, and how many more there are.
 *
 * When it can happen, by arithmetic: the capped shares of a vertex are normalised, so over k kept bones they sum to 1
 * and the largest is at least 1/k. The cut keeps a share of at least 0.03 and the continuous floor one above 0.03, so a
 * vertex keeps no bone only if 1/k ≤ 0.03, that is k ≥ 34 (1/33 = 0.0303… keeps its largest under both forms). At the
 * default cap of 4 the largest share is at least 0.25, so a mesh that declares nothing never reaches this; only a
 * declared cap of 34 or more, or `null`, over 34 or more bones whose shares are all at or below the floor does — and a
 * share that is not a number (raw values summing to 0) lands here too rather than in the file. Rare, so refused by
 * name rather than left to a crash in the rounding.
 */
export function nothingKeptProblem(part: string, floor: FloorForm | undefined, first: { vertex: number; at: Point; capped: readonly Influence[] }, more: number): Problem {
  const largest = first.capped.length === 0 ? null : Math.max(...first.capped.map((e) => e.weight));
  const form = floor === 'continuous' ? 'the continuous floor (0.03 subtracted from every share) keeps none at or below 0.03' : 'the cut drops every share below 0.03';
  return {
    code: 'RIG_INFLUENCES_KEPT',
    object: `config.meshes.${part}.influences`,
    detail: `vertex ${first.vertex} at rig (${first.at[0]}, ${first.at[1]})${more > 0 ? ` and ${more} more` : ''} keeps no bone: its ${first.capped.length} capped share(s) have the largest ${largest === null || !Number.isFinite(largest) ? String(largest) : pyRound(largest, 6)}, and ${form}; a largest share above 0.03 is required, which every vertex has when 33 or fewer bones are kept (the largest of k shares is at least 1/k) — declare maxInfluences 33 or less, or name fewer bones in segments`,
  };
}

/**
 * The lattice's rounding: each weight to 5 places, the last entry written as
 * `1 − sum(others)`. Safe because under the cut every kept entry is at least
 * `MIN_WEIGHT`, so the last cannot be taken negative; a mesh that declares the
 * continuous floor is rounded by {@link roundShares} instead (issue #284, as
 * Stage E wrote it: `docs/evidence/weight-cap.md`).
 */
export function latticeShares(list: readonly Influence[]): Influence[] {
  const shares = list.map(({ bone, weight }) => ({ bone, weight: pyRound(weight, 5) }));
  let others = 0;
  for (let k = 0; k < shares.length - 1; k++) others += shares[k].weight;
  shares[shares.length - 1].weight = pyRound(1 - others, 5);
  return shares;
}

/**
 * A region-weighted vertex's weights at 5 places (issue #84): each rounded
 * with `pyRound`; an entry that rounds to 0 is dropped (a bone at weight 0
 * pulls nothing); and the rounding remainder goes to the heaviest entry, the
 * first of equals, written as `1 − sum(others)`, so the vertex sums to exactly
 * 1. The lattice writes the remainder into its LAST entry, which is safe only
 * because `influences()` floors every entry at `MIN_WEIGHT`; a region's ramp
 * reaches the shares below that floor (`src/localweights.ts`), and a share
 * near 0 must not absorb a remainder that could take it negative. A vertex no
 * region reaches is rounded exactly as the lattice rounds, not by this.
 */
export function roundShares(list: readonly Influence[]): Influence[] {
  const kept = list.map((e) => ({ bone: e.bone, weight: pyRound(e.weight, 5) })).filter((e) => e.weight > 0);
  let heavy = 0;
  for (let k = 1; k < kept.length; k++) if (kept[k].weight > kept[heavy].weight) heavy = k;
  let others = 0;
  for (let k = 0; k < kept.length; k++) if (k !== heavy) others += kept[k].weight;
  kept[heavy].weight = pyRound(1 - others, 5);
  return kept;
}

/**
 * Issue #392: on a lattice mesh whose segments include sibling branch chains
 * forked from the same chain link with `r >= grid` (`split.hold_tip: true`),
 * the distance rule still concentrates weights along the fork row where the
 * trunk splits into branches and across adjacent trees' ruffled hem steps.
 * Four Laplacian passes (`FORK_SMOOTH_PASSES`, self share 0.5, floor 0.005, cap
 * 8 influences) diffuse each vertex's shares across its triangle neighbours
 * before rounding with {@link roundShares}. Every share is diffused alike —
 * trunk, branch and fixed bones — none is held in place.
 *
 * Issue #615: an influence mesh that declares `influence.hold_tip: true` is
 * smoothed by the same passes with `cap` its declared `influence.max`, so a
 * vertex never binds more bones than the config states; the lattice's call
 * passes no cap and keeps `FORK_SMOOTH_MAX_INFLUENCES`, byte for byte.
 */
export const FORK_SMOOTH_PASSES = 4;
export const FORK_SMOOTH_SELF = 0.5;
export const FORK_SMOOTH_FLOOR = 0.005;
export const FORK_SMOOTH_MAX_INFLUENCES = 8;

export function smoothForkShares(raw: ReadonlyArray<readonly Influence[]>, triangles: readonly number[], cap: number = FORK_SMOOTH_MAX_INFLUENCES): Influence[][] {
  const adj: number[][] = raw.map(() => []);
  const addEdge = (u: number, v: number): void => {
    if (!adj[u].includes(v)) adj[u].push(v);
    if (!adj[v].includes(u)) adj[v].push(u);
  };
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = triangles[i];
    const b = triangles[i + 1];
    const c = triangles[i + 2];
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  let cur: Influence[][] = raw.map((s) => [...s]);
  for (let p = 0; p < FORK_SMOOTH_PASSES; p++) {
    cur = cur.map((own, vi) => {
      const nb = adj[vi];
      if (nb.length === 0) return own;
      const m = new Map<string, number>();
      for (const { bone, weight } of own) m.set(bone, weight * FORK_SMOOTH_SELF);
      const nbShare = (1 - FORK_SMOOTH_SELF) / nb.length;
      for (const u of nb) {
        for (const { bone, weight } of cur[u]) m.set(bone, (m.get(bone) ?? 0) + weight * nbShare);
      }
      const kept = [...m.entries()]
        .filter(([, w]) => w >= FORK_SMOOTH_FLOOR)
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .slice(0, cap);
      const sum = kept.reduce((s, [, w]) => s + w, 0);
      return roundShares(kept.map(([bone, w]) => ({ bone, weight: w / sum })));
    });
  }
  return cur;
}


interface Bone {
  name: string;
  parent: string | null;
  x: number;
  y: number;
  /** config.bones' `inherit`, on the bone that hangs from the declared parent (issue #348); absent when none is declared. */
  inherit?: RigBoneInherit;
}

export interface RigBone {
  name: string;
  parent?: string;
  /** A chain link and its control: the distance to the next link, or to the chain's tip. */
  length?: number;
  /** Spine degrees, CCW in a y-up world, local to the parent — written on a chain link and its control, and on a bone whose parent is turned. */
  rotation?: number;
  x: number;
  y: number;
  /** rig-c's inherit mode, written only where config.bones declares one (issue #348). */
  inherit?: RigBoneInherit;
}

export interface WeightEntry {
  bone: string;
  x: number;
  y: number;
  weight: number;
}

export interface MeshAttachment {
  type: 'mesh';
  path?: string;
  image: string;
  width: number;
  height: number;
  uvs: number[];
  triangles: number[];
  hull: number;
  weights: WeightEntry[][];
  generator?: {
    kind: 'grid';
    cols: number;
    rows: number;
    depth?: Omit<PartDepthReference, 'sources'>;
  };
}

export interface RegionAttachment {
  image: string;
  x: number;
  y: number;
  /** Written only on a turned bone: the bone's world rotation, cancelled, so the image stays upright. */
  rotation?: number;
}

export interface RigSpec {
  spec: 'rigc-rig/1';
  name: string;
  images: 'images';
  skeleton: { x: number; y: number; width: number; height: number };
  bones: RigBone[];
  /** `attachment` null only on a limb segment's front slot (issue #664), which shows nothing at setup. */
  slots: Array<{ name: string; bone: string; attachment: string | null }>;
  skins: { default: Record<string, Record<string, MeshAttachment | RegionAttachment>> };
  /**
   * `config.constraints`, in the order written, each as the config wrote it
   * but its records and annotations ({@link constraintForRig}). Written only
   * when the config has the field.
   */
  constraints?: Array<Record<string, unknown>>;
  /**
   * `config.stops` (issue #404), in the order written, each with its `links`
   * expanded from `chain` when omitted and its records and annotations left out
   * ({@link stopForRig}). Written only when the config has the field.
   */
  stops?: RigStop[];
  /**
   * `idleDrivesMeshes`: written only under `idleKeys: 'direct'`, and only when
   * the idle keys a mesh-driving bone. `detached`: written only when a
   * constraint follows a bone ({@link detachedRules}).
   */
  invariants?: {
    idleDrivesMeshes?: { why: string };
    detached?: DetachedRule[];
    deformMayFold?: Array<{ slot: string; why: string }>;
    axes?: RigAxis[];
    meshSlots?: number;
    meshTriangles?: number;
  };
}

/** One `invariants.detached` entry: rig-c's `RigDetachedRule`, checked by its gate rule `A25`. */
export interface DetachedRule {
  bone: string;
  notUnder: string;
  why: string;
}

/**
 * `invariants.detached` for a config's constraints (issue #92): for each
 * constraint that follows a bone — an ik's `target`, a transform's `source`
 * — one rule per bone it drives, `{bone: <followed>, notUnder: <driven>}`,
 * in constraint order and then `bones` order, each pair once. rig-c's
 * `A25_DETACHED_BONE_PARENTAGE` fails a rule whose `bone` is a descendant of
 * its `notUnder` (rig-c 2.10.1, `src/assertions/bodies/a25.ts`):
 * measured on the rig fixture, a target declared detached and parented under
 * the link it drives fails the gate under both `--idle-keys` values, and the
 * same rig with nothing declared gates green with `A25` a SKIP. The loader
 * refuses that parentage first (`CONFIG_CONSTRAINT_TARGET_DETACHED`); the
 * declaration is what keeps it measured on the built rig, which a consumer
 * composes into a scene. Empty when no constraint follows a bone.
 */
export function detachedRules(constraints: readonly ConfigConstraint[]): DetachedRule[] {
  const out: DetachedRule[] = [];
  const seen = new Set<string>();
  constraints.forEach((c, i) => {
    const field = CONSTRAINT_FOLLOWS[c.type];
    if (field === undefined) return;
    const followed = c[field];
    const driven = c.bones;
    if (typeof followed !== 'string' || !Array.isArray(driven)) return;
    for (const b of driven) {
      if (typeof b !== 'string' || seen.has(`${followed}\u0000${b}`)) continue;
      seen.add(`${followed}\u0000${b}`);
      out.push({ bone: followed, notUnder: b, why: `rig-parts: "${followed}" is the ${field} of ${c.type} constraint "${c.name}" (config.constraints[${i}]), and "${b}" is a bone it drives; under it, driving it would move what it follows` });
    }
  });
  return out;
}

/** A fraction as the turn refusals print it: signed, 4 places. */
function signed4(v: number): string {
  const r = pyRound(v, 4);
  return `${r >= 0 ? '+' : '-'}${Math.abs(r).toFixed(4)}`;
}

/**
 * Issue #535: `CONFIG_TURN_RIDER_DEPTH` — an authored `turn.depths` entry for a
 * rider by bone ({@link turnRidersByBone}: a part every ownable bone of which
 * another carried part hosts, the host being the one binding it with the most
 * `opaque_px`) whose fraction differs from its host's by more than
 * {@link TURN_RIDER_APART} of the dial: the ornament would float off what it is
 * pinned to. Read here, not by the config loader, because the host is chosen by
 * `opaque_px`, which only parts.json holds. The candidates are the parts
 * `turn.depths` carries, in parts.json order; a face rider (issue #271: a part
 * from an eye-group, nose or mouth layer beside exactly one part from a `face`
 * layer) is read by its tag, never by its bones, as `propose` reads it.
 */
function turnRiderProblems(turn: TurnSpec, cfg: CharacterConfig, recs: PartsFile['parts']): Problem[] {
  if (turn.depths === undefined || turn.pivot === undefined) return [];
  const depths = turn.depths;
  const pivot = turn.pivot;
  const baseOf = (from: string): string | null => {
    const t = tagOf(from);
    return t === null ? null : (readTag(t)?.base ?? null);
  };
  const faces = recs.filter((r) => baseOf(r.from) === TURN_CARRIER_TAG && r.cut_from === undefined);
  const tagRider = (from: string): boolean => {
    const b = baseOf(from);
    return faces.length === 1 && b !== null && TURN_RIDER_TAGS.includes(b);
  };
  const carried = recs.filter((r) => Object.hasOwn(depths, r.name) && !tagRider(r.from));
  const { riders } = turnRidersByBone(cfg, carried.map((r) => ({ part: r.name, area: r.opaque_px })));
  if (riders.size === 0) return [];
  const nearest = turnNearest(depths);
  if (nearest === null) return [];
  const span = pivot - nearest.depth;
  const order = recs.map((r) => r.name);
  const frac = new Map(turnFractions(turn, order).map((f) => [f.part, f.fraction]));
  const problems: Problem[] = [];
  for (const [part, ride] of riders) {
    const fp = frac.get(part) as number;
    const fh = frac.get(ride.host) as number;
    const diff = Math.abs(fp - fh);
    if (!(diff > TURN_RIDER_APART)) continue;
    const above = order.indexOf(part) > order.indexOf(ride.host);
    const want = pyRound(turnRiderDepth(depths[ride.host], above), TURN_PLACES + 3);
    problems.push({
      code: 'CONFIG_TURN_RIDER_DEPTH',
      object: `config.turn.depths.${part}`,
      detail:
        `is ${depths[part]}, fraction ${signed4(fp)} of the dial; "${part}" rides "${ride.host}" by bone — every ownable bone it binds (${ride.bones.join(', ')}) is hosted by "${ride.host}", the carried part binding it with the most opaque px — ` +
        `whose depth ${depths[ride.host]} travels ${signed4(fh)}: the difference ${pyRound(diff, 4)} is more than ${TURN_RIDER_APART} of pivot − nearest (${pivot} − ${nearest.depth} = ${pyRound(span, TURN_PLACES)}), so at the dial's x the part leaves what it rides by ${pyRound(diff, 4)} of it; ` +
        `the host's depth ${above ? '−' : '+'} 0.001 (${want}, drawn ${above ? 'above' : 'under'} it) is required, or redraft the turn with propose --full/--head`,
    });
  }
  return problems;
}

/** One carried part of the turn control (issue #251): its depth, its fraction, and the twins that carry it. */
export interface TurnRow {
  part: string;
  depth: number;
  fraction: number;
  /** Each bone the part's slots and weights bind to, with the leaf twin that now carries it; empty when the fraction is 0 — the part stays with the pivot. */
  twins: Array<{ bone: string; twin: string }>;
}

/**
 * The turn control (issue #251, `src/turn.ts`), added to a built rig in place:
 * the control {@link TURN_BONE} under `root` at its origin, nothing keying it;
 * for each part `config.turn.depths` lists, in parts.json order, a leaf twin of
 * every bone the part's slots bind (its region's bone, a blink.still piece's
 * bone, a mesh's slot bone and every bone its weights name), in `bones`
 * declaration order (issue #746) — an identity child,
 * x 0, y 0, no rotation, so its world transform is its bone's exactly and every
 * idle key, physics step or constraint on the bone reaches it — the part's
 * slots and weights moved onto the twins, and one transform constraint per part
 * that adds `fraction · turn.x` to each twin's world x (`localSource`, read
 * off the control's local x; world target; `additive`).
 *
 * Why its own twins and not the `<bone>_ctl` controls: a control is a parent,
 * keyed by the idle, and carries every part on its bone and every bone under
 * it, so it cannot hold two parts at two depths; a leaf twin per part and bone
 * moves that part and nothing else, and nothing else keys or constrains it. A
 * mesh moves as a whole because its weights sum to 1 and every twin it binds
 * moves by the same world offset.
 *
 * At rest the control's x is 0, so each constraint adds `0 · fraction` to
 * world x. At rest: with `turn` declared, no pixel differs by more than 1
 * level at dial 0 (not byte-identical; the cause is float noise in the
 * identity child bones, and the constraints add nothing); without `turn`,
 * byte-identical. The constraints come
 * after the config's own, so a physics constraint on a bone has run before its
 * twin is moved. A part at the pivot depth (fraction 0) gets no twin and no
 * constraint. A name the turn needs that is taken is refused by name
 * (`RIG_TURN_NAME_FREE`).
 */
export function applyTurn(
  turn: TurnSpec,
  order: readonly string[],
  bones: RigBone[],
  slots: RigSpec['slots'],
  skin: RigSpec['skins']['default'],
  constraints: readonly ConfigConstraint[],
  frontSlots: ReadonlySet<string> = new Set(),
  slotFamilies: ReadonlyMap<string, readonly string[]> = new Map(),
  stops: ReadonlyArray<{ links: readonly string[] }> | null = null,
  orderByDeclaration: boolean = true,
): { constraints: Array<Record<string, unknown>>; detached: DetachedRule[]; rows: TurnRow[] } {
  const problems: Problem[] = [];
  const undrawn = new Map<string, string>();
  for (const s of stops ?? []) for (const l of s.links) undrawn.set(`${l}_d`, l);
  const boneOrder = new Map(bones.map((b, i) => [b.name, i * 2]));
  const orderOf = (b: string): number => {
    const direct = boneOrder.get(b);
    if (direct !== undefined) return direct;
    const base = undrawn.get(b);
    const baseIdx = base === undefined ? undefined : boneOrder.get(base);
    if (baseIdx === undefined) throw new Error(`applyTurn: bound bone "${b}" is not in bones`);
    return baseIdx + 1;
  };
  const taken = new Set(bones.map((b) => b.name));
  const transforms = new Set(constraints.filter((c) => c.type === 'transform').map((c) => c.name));
  if (taken.has(TURN_BONE)) problems.push({ code: 'RIG_TURN_NAME_FREE', object: `bone "${TURN_BONE}"`, detail: 'is the control the rig stage adds for config.turn, and the rig already has a bone of that name; rename it' });
  const rows: TurnRow[] = [];
  for (const f of turnFractions(turn, order)) {
    const row: TurnRow = { ...f, twins: [] };
    rows.push(row);
    if (f.fraction === 0) continue;
    const family = new Set(slotFamilies.get(f.part) ?? [f.part]);
    // A declared front slot (issue #664) rides its part; a part merely named `<part>_front` is a part of its own.
    const mine = slots.filter((sl) => family.has(sl.name) || sl.name === `${f.part}${STILL_SUFFIX}` || (sl.name === `${f.part}${FRONT_SUFFIX}` && frontSlots.has(sl.name)));
    const bound: string[] = [];
    const bind = (b: string): void => {
      if (!bound.includes(b)) bound.push(b);
    };
    for (const sl of mine) {
      bind(sl.bone);
      for (const att of Object.values(skin[sl.name] ?? {})) if ('type' in att && att.weights !== undefined) for (const v of att.weights) for (const w of v) bind(w.bone);
    }
    for (const b of bound) orderOf(b);
    if (orderByDeclaration) bound.sort((a, b) => orderOf(a) - orderOf(b));
    for (const b of bound) {
      const twin = turnTwin(f.part, b);
      if (taken.has(twin)) problems.push({ code: 'RIG_TURN_NAME_FREE', object: `bone "${twin}"`, detail: `is the twin that carries part "${f.part}" on "${b}" under config.turn, and the rig already has a bone of that name; rename it` });
      taken.add(twin);
      row.twins.push({ bone: b, twin });
    }
    const cname = turnConstraintName(f.part);
    if (transforms.has(cname)) problems.push({ code: 'RIG_TURN_NAME_FREE', object: `transform constraint "${cname}"`, detail: `is the constraint that carries part "${f.part}" under config.turn, and config.constraints already names a transform constraint so; rename it` });
  }
  refuseIfAny(problems);
  bones.push({ name: TURN_BONE, parent: ROOT_BONE, x: 0, y: 0 });
  const out: Array<Record<string, unknown>> = [];
  const detached: DetachedRule[] = [];
  for (const row of rows) {
    if (row.twins.length === 0) continue;
    const family = new Set(slotFamilies.get(row.part) ?? [row.part]);
    const twinOf = new Map(row.twins.map((t) => [t.bone, t.twin]));
    for (const t of row.twins) bones.push({ name: t.twin, parent: t.bone, x: 0, y: 0 });
    for (const sl of slots) {
      if (!family.has(sl.name) && sl.name !== `${row.part}${STILL_SUFFIX}` && !(sl.name === `${row.part}${FRONT_SUFFIX}` && frontSlots.has(sl.name))) continue;
      sl.bone = twinOf.get(sl.bone) as string;
      const atts = skin[sl.name] ?? {};
      for (const [k, att] of Object.entries(atts)) {
        if ('type' in att && att.weights !== undefined) atts[k] = { ...att, weights: att.weights.map((v) => v.map((w) => ({ ...w, bone: twinOf.get(w.bone) as string }))) };
      }
    }
    const cname = turnConstraintName(row.part);
    out.push({ type: 'transform', name: cname, bones: row.twins.map((t) => t.twin), source: TURN_BONE, localSource: true, additive: true, properties: { x: { to: { x: { scale: row.fraction } } } } });
    for (const t of row.twins) {
      detached.push({ bone: TURN_BONE, notUnder: t.twin, why: `rig-parts: "${TURN_BONE}" is the source of transform constraint "${cname}" (config.turn, issue #251), and "${t.twin}" is a bone it drives; under it, driving it would move what it follows` });
    }
  }
  return { constraints: out, detached, rows };
}

/**
 * Where the idle's keys on a mesh-driving bone go (`rig --idle-keys`).
 *
 * - `ctl`: onto a same-origin `<bone>_ctl` parent, which passes
 *   `A15_IDLE_NO_MESH_BONE_KEYS` under every rig-c this package has run
 *   on. It satisfies the rule's wording only — see `src/motion.ts`.
 * - `direct`: onto the bone itself, with `invariants.idleDrivesMeshes`
 *   declared, which needs rig-c 1.3.0 or later (an older rigc refuses
 *   the unknown invariant by name).
 *
 * Measured on the two public examples (rig-parts #13, `tools/idle_cost.ts`):
 * `direct` removes 31 of 72 bones (demo) and 24 of 56 (sample); every shown
 * mesh (8 and 6) has a driving bone whose world transform changes on every
 * idle frame under both, so the meshes a dirty-skip renderer could skip are 0
 * in both; and the per-frame pose time differs only in
 * `updateWorldTransform` (1.2 against 0.7 us on the demo), about 3 % of a
 * frame dominated by `computeWorldVertices`. The controls buy no renderer
 * work. `ctl` stays the default because the examples' expected `rig.json` and
 * `motion.json` are the reference implementation's output, and because the
 * declaration lives in the rig spec only: `rigc validate <build> --profile
 * rig-play`, which has no rig spec to read, refuses a `direct` build once
 * per keyed mesh bone.
 */
export const IDLE_KEYS = ['ctl', 'direct'] as const;
export type IdleKeys = (typeof IDLE_KEYS)[number];
export const DEFAULT_IDLE_KEYS: IdleKeys = 'ctl';

/**
 * `--idle-keys <value>` as `rig` and `build` both take it, or its default: one
 * reading for the two commands, so neither spells the flag its own way. A value
 * not in {@link IDLE_KEYS} is returned as the usage message naming the two.
 */
export function idleKeysOf(value: string | undefined): IdleKeys | string {
  const keys = value ?? DEFAULT_IDLE_KEYS;
  return (IDLE_KEYS as readonly string[]).includes(keys) ? (keys as IdleKeys) : `--idle-keys ${keys}; one of ${IDLE_KEYS.join(', ')} is required`;
}

export function isIdleKeys(v: IdleKeys | string): v is IdleKeys {
  return (IDLE_KEYS as readonly string[]).includes(v);
}

/**
 * The command that ran the rig stage, which the rig stage names when it tells
 * the author which flag to pass beside rigc's refusal of a pair a control
 * splits (`ctlRemedies`, src/build.ts): `rig` and `build` both take
 * `--idle-keys`, and the line has to name the one that was run. It changes no
 * byte the stage writes — only that line's text.
 */
export type RigCommand = 'rig' | 'build';

/** The `why` of the `invariants.idleDrivesMeshes` that `idleKeys: 'direct'` declares. */
export const IDLE_DRIVES_MESHES_WHY = 'painting rig: the idle is meant to deform the meshes it keys (rig-parts rig --idle-keys direct)';

/**
 * The bones a mesh attachment binds: the sorted set of bone names its weights name (issue #536). Every
 * `mesh_report.json` row's `bones` is this reading of the attachment the written `rig.json` holds — after the turn's
 * twins and the stops' drawn links have taken their bones' places — so the row names what the emitted model binds in
 * every mode; `remesh --delta`'s row (`deltaRow`, `src/remesh.ts`) takes the same function.
 */
export function meshBoundBones(att: Pick<MeshAttachment, 'weights'>): string[] {
  return [...new Set((att.weights ?? []).flatMap((w) => w.map((e) => e.bone)))].sort();
}

/** One row of `mesh_report.json`: a lattice mesh's row is as it always was; a contour mesh's says so. */
export type MeshReport = LatticeMeshReport | ContourMeshReport | AutoMeshReport | InfluenceMeshReport | ExplicitMeshReport;

/**
 * An influence mesh's row (issue #378): the lattice's counts and coverage as every row has them, the block as declared,
 * rig-c's lattice report, and the reach — the farthest vertex's distance to its nearest link and where, the vertices
 * the cap dropped a link from (`capped`, more links in reach than `max`) and the most links in reach at one vertex
 * (`widest`, the `max` that would drop none): the two figures rig-c's own `reach` line prints for its generator.
 */
export interface InfluenceMeshReport {
  part: string;
  vertices: number;
  triangles: number;
  hull: number;
  bones: string[];
  max_influences: number;
  mean_influences: number;
  art_coverage: number;
  mode: 'influence';
  influence: InfluenceMeshSpec['influence'];
  reach: { farthest: number; at: [number, number]; nearest: string; capped: number; widest: number };
  lattice: SegmentsLatticeReport;
}

/**
 * The alpha a pixel must reach to hold a cell of an influence mesh's lattice: this package's art, alpha above
 * {@link ART_ALPHA} (`src/mesh.ts`), which the lattice's own cells and every coverage figure read — so the two
 * modes' coverage is measured over the same art (issue #378, bar 1).
 */
export const INFLUENCE_THRESHOLD = ART_ALPHA + 1;

/** The farthest lattice vertex from its nearest link, part px (issue #378, bar 4): `segmentDistance`, rig-c's. */
export function influenceReach(points: ReadonlyArray<readonly [number, number]>, segs: readonly EntrySegment[], names: readonly string[]): { distance: number; vertex: number; at: [number, number]; bone: string } {
  let best = { distance: -1, vertex: -1, at: [0, 0] as [number, number], bone: '' };
  points.forEach(([x, y], vi) => {
    let d = Infinity;
    let bone = 0;
    for (const s of segs) {
      const e = rigcSegmentDistance([x, y], s.a, s.b);
      if (e < d) {
        d = e;
        bone = s.bone;
      }
    }
    if (d > best.distance) best = { distance: d, vertex: vi, at: [x, y], bone: names[bone] };
  });
  return best;
}

/**
 * Issue #518: the figure {@link influenceReach} holds an influence mesh's radius above, measured as the rig stage
 * measures it — rig-c's segments lattice at `cell` over the part padded by {@link PAD} (alpha above
 * {@link INFLUENCE_THRESHOLD}), and each vertex's distance to its nearest of `segs` (rig px, as the bones place them)
 * — for `propose` to draft a radius from before any rig is built. Null when rig-c's lattice refuses the part, which
 * the rig stage then names (`RIG_INFLUENCE_LATTICE`).
 */
export function influenceFarthest(img: Raster, x: number, y: number, segs: readonly Segment[], cell: number): number | null {
  const padded = pad(img, PAD, PAD, PAD, PAD, [0, 0, 0, 0]);
  const alpha = new Uint8Array(padded.width * padded.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = padded.data[i * 4 + 3];
  let lattice: SegmentsLattice;
  try {
    lattice = buildSegmentsLattice({ mask: { width: padded.width, height: padded.height, alpha }, threshold: INFLUENCE_THRESHOLD, cell });
  } catch {
    return null;
  }
  const ox = x - PAD;
  const oy = y - PAD;
  const names = [...new Set(segs.map((s) => s.bone))];
  const local: EntrySegment[] = segs.map((s) => ({ bone: names.indexOf(s.bone), entry: 0, a: [s.a[0] - ox, s.a[1] - oy], b: [s.b[0] - ox, s.b[1] - oy] }));
  return influenceReach(lattice.points, local, names).distance;
}

/**
 * Whether a declared radius reaches a vertex `distance` px from its nearest link: a link pulls only when it is NEARER
 * than radius (rig-c's `d < radius`; the pull is 0 at d = radius), so a radius equal to the distance does not.
 */
export function influenceReachHolds(radius: number, distance: number): boolean {
  return radius > distance;
}

/** `RIG_INFLUENCE_REACH`: the radius does not exceed the farthest vertex's distance to its nearest link. */
export function influenceReachProblem(part: string, radius: number, reach: { distance: number; vertex: number; at: [number, number]; bone: string }, ox: number, oy: number): Problem {
  return {
    code: 'RIG_INFLUENCE_REACH',
    object: `config.meshes.${part}.influence.radius`,
    detail: `is ${radius}; vertex ${reach.vertex} of the part's lattice, at (${pyRound(reach.at[0] + ox, 4)}, ${pyRound(reach.at[1] + oy, 4)}) in rig px, is ${pyRound(reach.distance, 4)} px from its nearest link ("${reach.bone}"), and a link pulls a vertex only when it is nearer than radius — a radius above ${pyRound(reach.distance, 4)} is required, or a segment nearer that part of the art`,
  };
}

export interface LatticeMeshReport {
  part: string;
  vertices: number;
  triangles: number;
  hull: number;
  bones: string[];
  max_influences: number;
  mean_influences: number;
  art_coverage: number;
  grid: number;
  /** The distance rule's exponent the mesh declared (issue #161); absent when it declared none and ran at 2. */
  exponent?: number;
  /** The cap and floor form the mesh declared, as declared (issue #284); absent when it declared none and ran at 4 and the cut. */
  influences?: MeshInfluences;
  /** The `stray` the mesh declared (issue #303); absent when it declared none. */
  stray?: number;
  /** Only beside a declared `stray` (issue #303): the islands it left out of the lattice, their art px, and the part's art px. */
  stray_cleared?: StrayCleared;
  /** Only under `rule: "heat"` (issue #161): the rule and the solve it ran. Absent otherwise, so a distance mesh writes the row it always wrote. */
  heat?: HeatRow;
}

/**
 * A contour mesh's row (issue #84): the lattice row's figures, then the mode,
 * the parameters it ran at, `src/contour.ts`'s report whole, and per region
 * the vertices its bone reaches (g > 0) and holds alone (g = 1).
 * `art_coverage` is over ALL the part's art, stray islands left out included,
 * so a mesh that leaves pixels undrawn does not read 1.
 */
export interface ContourMeshReport {
  part: string;
  vertices: number;
  triangles: number;
  hull: number;
  bones: string[];
  max_influences: number;
  mean_influences: number;
  art_coverage: number;
  mode: 'contour';
  /** The distance rule's exponent the mesh declared (issue #161); absent when it declared none and ran at 2. */
  exponent?: number;
  /** As the lattice row's (issue #284). */
  influences?: MeshInfluences;
  /** Only when the mesh declared ribs (issue #188): what it declared and what was placed. Absent otherwise, so a mesh without ribs writes the row it always wrote. */
  ribs?: RibsRow;
  /** `maxEdge` only when the mesh declared it (issue #265), so a mesh without it writes the row it always wrote. */
  params: { tolerance: number; margin: number; spacing: number; maxEdge?: number; budget: number | null; stray: number | null; bridges?: true };
  contour: ContourReport;
  regions: Array<{ name: string; bone: string; reached: number; whole: number }>;
  /** Only under `rule: "heat"` (issue #161), as the lattice row's. */
  heat?: HeatRow;
}

/**
 * A mesh's ribs as its row echoes them (issue #188): the stations each chain declared, the ribs placed (one per link
 * joint and station, chain by chain) and the vertices they hold, ends included. Each rib's own vertex list is in the
 * contour report's `ribs` (the source's, in the automatic mode).
 */
export interface RibsRow {
  chains: RibsSpec;
  count: number;
  vertices: number;
}

/** The row's echo of a mesh's ribs (issue #188). */
function ribsRow(spec: RibsSpec, placed: readonly ContourRib[]): RibsRow {
  return { chains: spec, count: placed.length, vertices: placed.reduce((n, r) => n + r.vertices.length, 0) };
}

/** What a declared `source.stray` cleared from an automatic part's art (issue #172): islands, their pixels, and the art they were part of. */
export interface StrayCleared {
  islands: number;
  pixels: number;
  art_pixels: number;
}

/**
 * An automatic mesh's row (issue #126, item 2): the lattice row's figures,
 * then the mode; `settings`, every number the call saw (the effective
 * settings, as rig-c echoes them, are also in the document); the source
 * — the contour mesh's own report and rig-c's counts of it — and the
 * result's counts; every residual, the worst one and the worst region; the
 * termination; what the weights lost to the 5-place rounding; per region the
 * source vertices its bone reaches and holds alone and the result vertices
 * bound to it; `deformation` (below); and the whole
 * `mesh-quality-report/1` document rig-c wrote — inside the row rather
 * than beside it, so the rig stage stays pure and one file holds every part's
 * evidence, as it does for the other modes. `art_coverage` is over alpha above
 * 8, the other modes' reading, of the art every reader of the mesh takes (under
 * a declared `source.stray`, the islands the trace left out are not in it —
 * `stray_cleared`); the threshold-1 coverage is a residual.
 */
export interface AutoMeshReport {
  part: string;
  vertices: number;
  triangles: number;
  hull: number;
  bones: string[];
  max_influences: number;
  mean_influences: number;
  art_coverage: number;
  mode: 'auto';
  /** The distance rule's exponent the mesh declared (issue #161); absent when it declared none and ran at 2. */
  exponent?: number;
  /** Only when the mesh declared ribs (issue #188), as the contour row's; `vertices` counts the source's, which the reduction keeps. */
  ribs?: RibsRow;
  settings: {
    threshold: number;
    source: { tolerance: number; margin: number; spacing: number; stray: number | null };
    sourceBounds: { minCoverage: number; maxOvershoot: number | null; maxUndercut: number | null };
    targets: { artFit: { minCoverage: number; maxOvershoot: number | null; maxUndercut: number | null }; maxBoundaryDeviation: number; minAngle: number | null };
    protect: { hull: boolean; vertices: number[]; edges: Array<[number, number]>; regionBoundaries: string[]; weightJump: number | null; influences: string[] };
    influences: { maxInfluences: number; minWeight: number };
    budget: { maxCandidates: number };
    minArtSamples: number;
    /** A density-only region (issue #155) echoes `bone` and `band` as null: it declares neither. */
    regions: Array<{ name: string; bone: string | null; band: number | null; maxEdgeLength: number; transition: number; grade: number; minArtSamples: number; approximation: { from: string; policy: string; maxError: number } | null }>;
    preset: null;
    /** The amplitude rig-c read and echoed (`effective.motionAmplitude`), after the opt-ins; absent when none was sent. */
    motionAmplitude?: MotionAmplitude;
  } & StageBOptIns;
  source: { contour: ContourReport; counts: MeshCounts | null };
  /**
   * Only on a part whose author declared `source.stray` (issue #172): the islands the trace left out and their pixels,
   * cleared from the art every reader of the mesh takes (the reduction, its source bounds, `art_coverage`, the motion
   * gate), against `art_pixels` — the part's art at alpha 1 and above with those islands counted in. Zero islands
   * when the declaration left nothing out. Absent without the declaration, so such a part writes the row it always wrote.
   */
  stray_cleared?: StrayCleared;
  /** The counts; with a Stage B opt-in set, `boundary_runs` and `retriangulation` after them (`stageBResult`), each only when its opt-in is. */
  result: { counts: MeshCounts; removedVertices: number; insertedVertices: number } & StageBResult;
  residuals: Residual[];
  worst_residual: (Residual & { used: number }) | null;
  worst_region: string | null;
  /**
   * The motion amplitude rig-c's `MQ_ALLOCATION_CONTRAST` and `MQ_DEFORM_LOAD`
   * read (issue #126 Q2; `src/autoamplitude.ts`): `sent` when every track term
   * was derived from the idle and the amplitude — with the author's
   * `motion.gradation`, or null — handed to `reduceMesh` and to the motion
   * gate's comparison, and otherwise each term that stopped it, by path — so a
   * reader of the two rows' `not-measurable` learns which number is missing.
   */
  motion_amplitude: AmplitudeRow;
  /**
   * Only on a part whose author declared `auto.stimulus` (issue #196): each declared bend as the motion gate walked it —
   * the chain, the degrees, the links turned and the two animations (+ and −) its comparison builds carry. Absent
   * otherwise, so a part without the field writes the row it always wrote.
   */
  stimulus?: Array<{ chain: string; degrees: number; links: string[]; animations: [string, string] }>;
  /**
   * Only on a part whose author set `motion.residual` (issue #126, rig-c 2.31.0, rigc#1295; `src/autoenvelope.ts`):
   * the envelope sent and the written mesh's `MQ_SKINNING_RESIDUAL` against its bound, or every stop that left the
   * residual not measurable — the veto then not applied. A pose-free bound, not the motion verdict. Absent otherwise,
   * so a part without the field writes the row it always wrote.
   */
  skinning_residual?: ResidualRow;
  termination: Termination;
  weights: { sharesDroppedOnGrid: number; sharesPruned: number; droppedAtFivePlaces: number };
  /** A density-only region (issue #155): `bone` null, and 0 vertices reached, whole and bound — it weights nothing. */
  regions: Array<{ name: string; bone: string | null; reached: number; whole: number; bound_in_result: number }>;
  /**
   * Only on a part whose full reduction the motion gate refused and whose
   * acceptance loop wrote a replayed step instead (`src/autoreplay.ts`): the
   * search — N, I, the step chosen, the replays and the candidates they tried,
   * every probe, and the chosen step's selection and held-out readings. The
   * row's other fields are then that step's (its `termination` is
   * `replayed-to-accepted-step`). Absent on every other row, so a part the
   * gate accepted outright writes the row it always wrote. With the author's
   * `motion.selection` (issue #148) it is the multi-interval search's row,
   * which says `policy` and carries the tested set, the passing and untested
   * intervals, the chosen counts, the termination and the roles.
   */
  replay?: ReplayRow | MultiIntervalRow;
  /**
   * {@link DEFORMATION_UNMEASURED} as `buildRig` writes the row — it measures
   * geometry alone; the rig stage replaces it with the motion gate's rows
   * (`src/automotion.ts`) before anything is written, and adds
   * `motion_report`, rig-c's whole `compare` document, after
   * `quality_report`. A written row never says unmeasured: a part whose motion
   * was not measured and passed is refused.
   */
  deformation: string | MotionDeformation;
  /** Only under `rule: "heat"` (issue #161): the rule and the solve the source's weights came from. */
  heat?: HeatRow;
  quality_report: unknown;
  motion_report?: unknown;
}

export const SETS_SPEC = 'rig-parts-sets/1';
export const SETS_FILE = 'sets.json';

/**
 * `sets.json` (issue #454): the machine-readable map from each alternate
 * painting set to its `<set>_<part>` attachment on each slot it covers and
 * the slots it hides. Written beside `rig.json` only when `parts.json` carries
 * `alternates`.
 */
export interface AttachmentSetsFile {
  spec: typeof SETS_SPEC;
  threshold?: { yaw: number; pitch: number };
  sets: Record<string, AlternateSetMap>;
}

export interface RigOutput {
  depthReferences?: Array<{ part: string; size: [number, number]; depth: PartDepthReference }>;
  rig: RigSpec;
  /** Internal explicit-layout provenance; serialized only as an external companion. */
  layout?: LayoutPlan;
  motion: MotionSpec;
  meshReport: MeshReport[];
  /** The padded images, by file name (`<part>.png`), in parts.json order. */
  images: Array<[string, Raster]>;
  /** The bones that got a `<bone>_ctl`, sorted; empty under `idleKeys: 'direct'`. */
  controls: string[];
  /** The idle-keyed bones some mesh is weighted to, sorted — the bones `ctl` moves the keys off, and `direct` keys in place. */
  meshKeyed: string[];
  idleKeys: IdleKeys;
  /** The one-loop passes each mesh took, for the printed report. */
  loopPasses: Record<string, number>;
  /** Per automatic mesh, in parts.json order: what the rig stage's motion gate compares (`src/automotion.ts`). Nothing written. */
  autoMotion: AutoMotionCase[];
  /** The eye line the face bones were turned to, or why there is none (issue #239). */
  faceAxis: FaceAxis;
  /** The turn control's parts (issue #251), in parts.json order; null when the config has no `turn`. */
  turn: TurnRow[] | null;
  /** `sets.json` (issue #454), present only when `parts.alternates` is non-empty. */
  sets?: AttachmentSetsFile;
}

/**
 * Issue #465: pose a rig's bones so each bone named in `drawn` reaches that
 * world rotation (in Spine degrees, CCW, y up), adjusting its local `rotation`
 * from its parent's posed transform. Bones are walked in parent-first order.
 */
export function poseRigBonesForDrawn(
  bones: readonly RigBone[],
  drawn: Readonly<Record<string, number>>,
  stops?: ReadonlyArray<{ links: readonly string[] }>,
): RigBone[] {
  const undrawn = new Map<string, string>();
  for (const s of stops ?? []) for (const l of s.links) undrawn.set(`${l}_d`, l);
  const realBone = (n: string): string => undrawn.get(n) ?? n;
  const posed: RigBone[] = [];
  const posedRead: RigBone[] = [];
  for (const b of bones) {
    const readB: RigBone = { ...b, ...(b.parent === undefined ? {} : { parent: realBone(b.parent) }) };
    const target = drawn[b.name];
    if (target === undefined) {
      posed.push({ ...b });
      posedRead.push(readB);
      continue;
    }
    const m0 = computeExactFrameTransforms([...posedRead, { ...readB, rotation: 0 }]).get(b.name) as BoneTransform;
    const rotation = places(normaliseDegrees(target - normaliseDegrees(m0.worldRotation)));
    posed.push({ ...b, rotation });
    posedRead.push({ ...readB, rotation });
  }
  return posed;
}

/**
 * Issue #465: derive the alternate's `drawn` bone world rotations (in Spine
 * degrees, CCW, y up) from its body-18 skeleton read (`pts`, in rig pixels, y
 * down) against the base rig's setup bone origins (`B`) and setup world turns
 * (`turn`).
 */
export function deriveAlternateDrawn(
  pts: PosePoints,
  B: ReadonlyMap<string, { x: number; y: number }>,
  turn: ReadonlyMap<string, number>,
  CX: number,
  H: number,
): Record<string, number> {
  const sx = (x: number): number => x - CX;
  const sy = (y: number): number => cropToSpineY(y, H);
  const deg = (a: readonly [number, number], b: readonly [number, number]): number =>
    (Math.atan2(sy(b[1]) - sy(a[1]), sx(b[0]) - sx(a[0])) * 180) / Math.PI;
  const mid = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  const out: Record<string, number> = {};
  if (B.has('chest') && B.has('hip') && B.has('sleeve_r0') && B.has('sleeve_l0')) {
    const hip = B.get('hip') as { x: number; y: number };
    const sr0 = B.get('sleeve_r0') as { x: number; y: number };
    const sl0 = B.get('sleeve_l0') as { x: number; y: number };
    const setupTrunkAim = deg([hip.x, hip.y], mid([sr0.x, sr0.y], [sl0.x, sl0.y]));
    const altTrunkAim = deg(mid(pts.r_hip, pts.l_hip), mid(pts.r_shoulder, pts.l_shoulder));
    out.chest = places(normaliseDegrees((turn.get('chest') ?? 0) + (altTrunkAim - setupTrunkAim)));
  }
  if (B.has('head') && B.has('eye_r') && B.has('eye_l')) {
    const er = B.get('eye_r') as { x: number; y: number };
    const el = B.get('eye_l') as { x: number; y: number };
    const setupEyeAim = deg([er.x, er.y], [el.x, el.y]);
    const altEyeAim = deg(pts.r_eye, pts.l_eye);
    out.head = places(normaliseDegrees((turn.get('head') ?? 0) + (altEyeAim - setupEyeAim)));
  }
  const limbPairs = skeletonLimbJoints(pts);
  for (const [bone, a, b] of limbPairs) {
    if (B.has(bone)) out[bone] = places(normaliseDegrees(deg(a, b)));
  }
  for (const foot of ['foot_r', 'foot_l'] as const) {
    if (B.has(foot)) out[foot] = places(normaliseDegrees(turn.get(foot) ?? 0));
  }
  return out;
}

/**
 * `RIG_BLINK_HOLD_SPANS_A_FRAME` (issue #32): the eyes' hold must put an
 * idle frame inside the closed window for every `blink.t`, or the idle
 * frames, the contact sheet and the loop show a blink that never closes. The
 * three numbers are the tree's own constants (`BLINK.shut`, `BLINK.hold`,
 * `IDLE_FPS`), which the rig stage passes on every build that has a blink;
 * they are parameters so the refusal can be planted without editing them.
 */
export function blinkHoldProblems(shut: number, hold: number, fps: number): Problem[] {
  const m = blinkHoldMisses(shut, hold, fps);
  if (m.misses === 0) return [];
  return [
    {
      code: 'RIG_BLINK_HOLD_SPANS_A_FRAME',
      object: 'BLINK.hold (src/motion.ts)',
      detail:
        `is ${hold} s; the idle is rendered at IDLE_FPS = ${fps}, a frame every ${pyRound(1 / fps, 6)} s, so the closed window [t + ${shut}, t + ${pyRound(shut + hold, 6)}] s holds no frame ` +
        `for ${m.misses} of the ${m.phases} phases a 6-decimal blink.t takes against the frame grid (the first at t = ${m.first} s), and the idle frames and the loop show no closed eye there; ` +
        `a hold of at least one frame, 1/${fps} s, is required`,
    },
  ];
}

/** The slot, attachment and image name suffix of a `motion.blink.still` part's upper piece. */
export const STILL_SUFFIX = '_still';

/** Pixels with alpha above 0 in rows [y0, y1) of `img`. */
function alphaCount(img: Raster, y0: number, y1: number): number {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < img.width; x++) if (img.data[(y * img.width + x) * 4 + 3] > 0) n++;
  return n;
}

function same(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function pt(p: Point): string {
  return `[${p[0]}, ${p[1]}]`;
}

/**
 * Build the rig. `images` holds every parts.json part's PNG by part name.
 * Every problem found is thrown at once, as one `PartsError`. `reduce` runs each
 * automatic part's reduction, `runReduction` unless a caller hands one that
 * reuses a reduction it already ran on the same input (issue #135).
 */
/** Issue #399: source-axis shares, used by base and alternate band attachments alike. */
function limbBandShares(p: PartRecord, point: Point): Influence[] | null {
  const h = p.limb?.band;
  if (h === undefined) return null;
  const axial = (point[0] - h.at[0]) * h.axis[0] + (point[1] - h.at[1]) * h.axis[1];
  const lower = Math.max(0, Math.min(1, axial / h.width + 0.5));
  return [{ bone: h.upper, weight: 1 - lower }, { bone: (p.limb as NonNullable<typeof p.limb>).bone, weight: lower }].filter((q) => q.weight > 0);
}

export function buildWaistPairSource(
  cfg: CharacterConfig,
  parts: PartsFile,
  images: ReadonlyMap<string, Raster>,
  maxLoopPasses: number = ONE_LOOP_PASSES,
  idleKeys: IdleKeys = DEFAULT_IDLE_KEYS,
  reduce: Reducer = runReduction,
  turnOrderByDeclaration: boolean = true,
): RigOutput {
  // Generated bands have a fixed one-pixel lattice, with their axial weights
  // below; config never supplies a second mesh policy for the same source.
  const bands = parts.parts.filter((p) => p.limb?.band !== undefined);
  if (bands.length > 0) cfg = { ...cfg, meshes: { ...cfg.meshes, ...Object.fromEntries(bands.map((p) => [p.name, { segments: [(p.limb as NonNullable<typeof p.limb>).band?.upper as string, (p.limb as NonNullable<typeof p.limb>).bone], grid: 1, r: 1 }])) } };
  const problems: Problem[] = [];
  const fail = (code: string, object: string, detail: string): void => {
    problems.push({ code, object, detail });
  };
  for (const [name, limb] of Object.entries(cfg.limbs ?? {})) limb.segments.forEach((sg, k) => {
    if (sg.hybrid === undefined) return;
    const band = parts.parts.find((p) => p.name === sg.hybrid?.part);
    const joint = parts.parts.find((p) => p.name === sg.part);
    if (band?.limb?.band === undefined || joint?.limb?.hybrid?.part !== sg.hybrid.part) fail('RIG_HYBRID_SOURCE', `config.limbs.${name}.segments[${k}].hybrid`, `declares band "${sg.hybrid.part}" for "${sg.part}"; assembled band is ${band?.limb?.band === undefined ? 'absent' : 'present'}, joint reference is ${JSON.stringify(joint?.limb?.hybrid?.part ?? null)} — re-run assemble before rig`);
  });
  for (const p of bands) {
    const b = p.limb as NonNullable<typeof p.limb>, h = b.band as NonNullable<typeof b.band>;
    const segments = cfg.limbs?.[b.name]?.segments;
    const declared = segments?.[b.segment];
    if (declared?.hybrid?.part !== p.name || declared.bone !== b.bone || segments?.[b.segment - 1]?.bone !== h.upper || (declared.hybrid.width !== undefined && declared.hybrid.width !== h.width)) fail('RIG_HYBRID_SOURCE', `part "${p.name}"`, 'does not match its declared hybrid joint and two carriers; re-run assemble with the current config');
    for (const sg of [segments?.[b.segment - 1], declared]) if (sg !== undefined && (!(sg.part in cfg.regions) || sg.part in cfg.meshes)) fail('RIG_HYBRID_RIGID', `part "${sg.part}"`, 'is beside a hybrid band; a rigid region on its own carrier is required');
  }
  refuseIfAny(problems);
  const [W, H] = parts.rig_size;
  const CX = W / 2;
  const byPart = new Map(parts.parts.map((p) => [p.name, p]));

  const configuredAlts = cfg.assemble.alternates ?? cfg.alternates ?? [];
  const anchorRegions = new Set(Object.keys(cfg.regions).filter(n => !(n in cfg.meshes)));
  for (const a of configuredAlts) {
    if (a.base_anchor === undefined) continue;
    const covered = new Set((a.parts ?? parts.parts.map(p => p.name)).filter(n => !(a.hides ?? []).includes(n)));
    problems.push(...baseAnchorProblems(a.base_anchor, `config alternate set "${a.name}".base_anchor`, covered, new Set((cfg.assemble.patches ?? []).map(p => p.name)), anchorRegions, 'RIG_ALT_BASE_ANCHOR'));
  }
  for (const a of parts.alternates ?? []) {
    if (a.base_anchor !== undefined) problems.push(...baseAnchorProblems(a.base_anchor, `parts.json alternate set "${a.name}".base_anchor`, new Set(a.records.map(p => p.name)), new Set(a.records.filter(p => p.from.startsWith('painting:')).map(p => p.name)), anchorRegions, 'RIG_ALT_BASE_ANCHOR'));
  }
  // Direct callers need the same shape checks as serialized readers. Collect
  // both sides before any canonical ordering can inspect their axes or pairs.
  refuseIfAny(problems);
  for (const a of parts.alternates ?? []) {
    const configured = configuredAlts.find(c => c.name === a.name)?.base_anchor;
    if (JSON.stringify(configured === undefined ? null : orderedBaseAnchor(configured)) !== JSON.stringify(a.base_anchor === undefined ? null : orderedBaseAnchor(a.base_anchor))) fail('RIG_ALT_BASE_ANCHOR_MATCH_CONFIG', `alternate set "${a.name}" base_anchor`, 'config and parts.json declare different base anchors; re-run assemble before rig');
    problems.push(...recordedFocusProblems(a, `parts.json alternate set "${a.name}".focus`, parts.rig_size, parts.scale_rig_per_source));
  }
  for (const a of cfg.assemble.alternates ?? cfg.alternates ?? []) {
    const record = parts.alternates?.find((p) => p.name === a.name);
    if (a.base_anchor !== undefined && record === undefined) fail('RIG_ALT_BASE_ANCHOR_MATCH_CONFIG', `alternate set "${a.name}" base_anchor`, 'has no assembled set; re-run assemble before rig');
    if ((a.focus !== undefined || record?.focus !== undefined)
      && JSON.stringify(a.focus) !== JSON.stringify(record?.focus)) {
      fail('CONFIG_SET_FOCUS', `config.assemble alternate set "${a.name}".focus`, 'does not match the assembled painting point; re-run assemble after changing or removing focus');
    }
  }
  refuseIfAny(problems);

  // Standalone rig checks source-bound normalization, never reconstructing
  // original dimensions from nominal scale or treating source points as rig points.
  for (const a of parts.alternates ?? []) {
    if (a.tips === undefined && a.tips_source_size === undefined) continue;
    const size = a.tips_source_size;
    if (a.tips === undefined || !Array.isArray(size) || size.length !== 2 || !size.every((n) => typeof n === 'number' && Number.isInteger(n) && n > 0)
      || Math.trunc(size[0] * parts.scale_rig_per_source) !== W || Math.trunc(size[1] * parts.scale_rig_per_source) !== H) {
      fail('RIG_ALT_TIPS_SOURCE', `parts.json alternate set "${a.name}" tips_source_size`, 'requires the original source dimensions that produce rig_size at scale_rig_per_source; re-run assemble to record normalization provenance');
    }
  }
  refuseIfAny(problems);
  for (const a of cfg.assemble.alternates ?? cfg.alternates ?? []) {
    const record = parts.alternates?.find((p) => p.name === a.name);
    if (a.tips === undefined) {
      if (record?.tips !== undefined) {
        fail('RIG_ALT_TIPS_MATCH_CONFIG', `parts.json alternate set "${a.name}" tips`, 'records endpoints while the matching config set has no tips; re-run assemble after removing source-crop tips');
      }
      continue;
    }
    if (record?.tips === undefined) {
      fail('RIG_ALT_TIPS_RECORDED', `parts.json alternate set "${a.name}" tips`, 'is absent while config declares source-crop tips; re-run assemble to record normalized endpoints before rig');
      continue;
    }
    const [sw, sh] = record.tips_source_size as [number, number];
    const configured = Object.keys(a.tips).sort(), recorded = Object.keys(record.tips).sort();
    if (configured.length !== recorded.length || configured.some((bone, i) => bone !== recorded[i])) {
      fail('RIG_ALT_TIPS_MATCH_CONFIG', `parts.json alternate set "${a.name}" tips`, `records bones [${recorded.join(', ')}] while config declares [${configured.join(', ')}]; re-run assemble after changing source-crop tips`);
    } else for (const bone of configured) {
      const raw = a.tips[bone], found = record.tips[bone];
      const expected: Point = [raw[0] * (W / sw), raw[1] * (H / sh)];
      if (!Array.isArray(found) || found.length !== 2 || found[0] !== expected[0] || found[1] !== expected[1]) {
        fail('RIG_ALT_TIPS_MATCH_CONFIG', `parts.json alternate set "${a.name}" tips.${bone}`, `is ${JSON.stringify(found)}; config source-crop tip ${JSON.stringify(raw)} on ${sw}x${sh} requires rig-crop ${JSON.stringify(expected)}; re-run assemble, never reinterpret or silently replace recorded endpoints`);
      }
    }
  }
  refuseIfAny(problems);

  // ---- bones -------------------------------------------------------------
  const B = new Map<string, Bone>();
  B.set(ROOT_BONE, { name: ROOT_BONE, parent: null, x: CX, y: H });
  const tips = new Map<string, Point>();
  const child = new Map<string, Point>();
  const chains = new Map<string, string[]>();
  /** Each chain's points and tip, rig px, as declared (issue #188: the ribs are placed along them). */
  const chainLines = new Map<string, Point[]>();
  /** The single bones that state a `tip` (issue #239: each is turned towards it). */
  const singleTips = new Set<string>();
  cfg.bones.forEach((e: BoneEntry, i) => {
    if ('chain' in e) {
      const names: string[] = [];
      const polyline = [...e.points, e.tip];
      if (e.points.length < 1) {
        fail('RIG_CHAIN_POINTS', `config.bones[${i}] chain "${e.chain}"`, `has ${e.points.length} point(s) and a tip; at least one point and a tip — 2 points — are required to make a link`);
      }
      for (let k = 0; k + 1 < polyline.length; k++) {
        if (same(polyline[k], polyline[k + 1])) {
          fail(
            'RIG_CHAIN_POINTS',
            `config.bones[${i}] chain "${e.chain}" link ${k}`,
            `runs from ${pt(polyline[k])} to ${k + 1 < e.points.length ? `points[${k + 1}]` : 'the tip'} ${pt(polyline[k + 1])}, the same point — the chain has fewer than 2 distinct points along that link, so the link has no direction to weight along; each link must end at a point other than its origin`,
          );
        }
      }
      e.points.forEach(([x, y], k) => {
        const n = `${e.chain}${k}`;
        const inherit = e.link_inherit?.[n];
        B.set(n, { name: n, parent: k === 0 ? e.parent : names[names.length - 1], x, y, ...(inherit === undefined ? {} : { inherit }) });
        if (names.length > 0) child.set(names[names.length - 1], [x, y]);
        names.push(n);
      });
      if (names.length > 0) tips.set(names[names.length - 1], [e.tip[0], e.tip[1]]);
      chains.set(e.chain, names);
      chainLines.set(e.chain, polyline);
    } else {
      B.set(e.name, { name: e.name, parent: e.parent, x: e.at[0], y: e.at[1], ...(e.inherit === undefined ? {} : { inherit: e.inherit }) });
      if (e.tip !== undefined) {
        if (same(e.at, e.tip)) {
          fail(
            'RIG_TIP_DISTINCT',
            `config.bones[${i}] "${e.name}".tip`,
            `is ${pt(e.tip)}, the bone's own origin; a bone is turned from its origin towards its tip (issue #239), and a tip on the origin has no direction — give a tip other than ${pt(e.at)}, or leave the tip out`,
          );
        }
        tips.set(e.name, [e.tip[0], e.tip[1]]);
        singleTips.add(e.name);
      }
    }
  });

  // ---- segments ----------------------------------------------------------
  const seg = (bone: string, at: string): Segment | null => {
    const b = B.get(bone);
    if (b === undefined) {
      fail('RIG_NAME_RESOLVES', at, `names the bone "${bone}", which config.bones does not declare`);
      return null;
    }
    const end = child.get(bone) ?? tips.get(bone);
    if (end === undefined) {
      fail(
        'RIG_SEGMENT_DEFINED',
        at,
        `names the bone "${bone}", which has no tip and no next chain link, so it has an origin and no segment; give config.bones "${bone}" a "tip", or write the segment out as ["${bone}", [x0, y0], [x1, y1]]`,
      );
      return null;
    }
    return { bone, a: [b.x, b.y], b: end };
  };
  const meshSegments = new Map<string, Segment[]>();
  // issue #378: which `segments` entry each resolved segment came from — rig-c's `bones` entries, which an influence
  // mesh's `across: false` keeps apart. Every mode resolves them; only the influence mode reads this.
  const meshSegmentEntries = new Map<string, number[]>();
  const explicitNames = explicitBoneNames(new Set(B.keys()), new Map([...chains].map(([k, v]) => [k, v.length])), cfg.stops);
  for (const [part, m] of Object.entries(cfg.meshes)) {
    if ('explicit' in m) {
      for (const bone of [...m.segments.map(s => typeof s === 'string' ? s : s[0]), ...explicitSlotBones(m), ...explicitWeightRows(m).flatMap(row => row.map(w => w.bone))]) {
        if (!explicitNames.has(bone)) fail('RIG_NAME_RESOLVES', `config.meshes.${part}.explicit`, `names the bone "${bone}", which config.bones does not declare`);
      }
      continue;
    }
    if ('contour' in m) {
      (m.contour.regions ?? []).forEach((rg, i) => {
        if (!B.has(rg.bone)) fail('RIG_NAME_RESOLVES', `config.meshes.${part}.contour.regions[${i}].bone`, `names the bone "${rg.bone}", which config.bones does not declare`);
      });
      if (m.contour.bust !== undefined) {
        for (const [k, bone] of [
          ['bone_r', m.contour.bust.bone_r ?? DEFAULT_BUST_BONE_R],
          ['bone_l', m.contour.bust.bone_l ?? DEFAULT_BUST_BONE_L],
        ] as const) {
          if (!B.has(bone)) fail('RIG_NAME_RESOLVES', `config.meshes.${part}.contour.bust.${k}`, `names the bone "${bone}", which config.bones does not declare`);
        }
      }
    }
    if ('auto' in m) {
      (m.auto.regions ?? []).forEach((rg, i) => {
        if (weightsABone(rg) && !B.has(rg.bone)) fail('RIG_NAME_RESOLVES', `config.meshes.${part}.auto.regions[${i}].bone`, `names the bone "${rg.bone}", which config.bones does not declare`);
      });
    }
    const out: Segment[] = [];
    const entries: number[] = [];
    m.segments.forEach((sp, i) => {
      const at = `config.meshes.${part}.segments[${i}]`;
      const push = (s: Segment | null): void => {
        if (s === null) return;
        out.push(s);
        entries.push(i);
      };
      if (typeof sp === 'string') {
        const links = chains.get(sp);
        if (links !== undefined) {
          for (const l of links) push(seg(l, `${at} (chain "${sp}" link "${l}")`));
        } else push(seg(sp, at));
      } else {
        if (!B.has(sp[0])) fail('RIG_NAME_RESOLVES', `${at}[0]`, `names the bone "${sp[0]}", which config.bones does not declare`);
        else push({ bone: sp[0], a: [sp[1][0], sp[1][1]], b: [sp[2][0], sp[2][1]] });
      }
    });
    meshSegments.set(part, out);
    meshSegmentEntries.set(part, entries);
  }

  // ---- parts ↔ config ----------------------------------------------------
  // Issue #671: a part 1.37.0's arm split (#490) makes from the full run is new to a config proposed before it.
  const armSplitHint = (from: string): string =>
    /^full:(drape|hand)-[rl]$/.test(from)
      ? ` — the full run's merged arm layer was split into this part (issue #490, from 1.37.0), which a config proposed before 1.37.0 does not name; see ${ARM_SPLIT_MIGRATION}, and add only its plan row and entry with: ${ARM_SPLIT_REMEDY}`
      : '';
  const where = (part: string): string => `parts.json holds ${parts.parts.length} part(s): ${parts.parts.map((p) => p.name).join(', ')}`;
  for (const part of Object.keys(cfg.meshes)) if (!byPart.has(part)) fail('RIG_PART_PRESENT', `config.meshes.${part}`, `names the part "${part}", which is not in parts.json; ${where(part)}`);
  for (const [part, region] of Object.entries(cfg.regions)) {
    const bone = regionBone(region);
    if (!byPart.has(part)) fail('RIG_PART_PRESENT', `config.regions.${part}`, `names the part "${part}", which is not in parts.json; ${where(part)}`);
    if (!B.has(bone)) fail('RIG_NAME_RESOLVES', `config.regions.${part}`, `names the bone "${bone}", which config.bones does not declare`);
  }
  if (cfg.stops !== undefined) {
    cfg.stops.forEach((s, i) => {
      const at = `config.stops[${i}]`;
      if (!chains.has(s.chain)) fail('RIG_NAME_RESOLVES', `${at}.chain`, `names the chain "${s.chain}", which config.bones does not declare`);
      const links = s.links ?? chains.get(s.chain) ?? [];
      links.forEach((l, k) => {
        if (!B.has(l)) fail('RIG_NAME_RESOLVES', `${at}.links[${k}]`, `names the bone "${l}", which config.bones does not declare`);
      });
      if (!B.has(s.against)) fail('RIG_NAME_RESOLVES', `${at}.against`, `names the bone "${s.against}", which config.bones does not declare`);
    });
  }
  if (cfg.turn?.roles !== undefined) {
    for (const part of Object.keys(cfg.turn.roles)) {
      if (!byPart.has(part)) fail('RIG_PART_PRESENT', `config.turn.roles.${part}`, `names the part "${part}", which is not in parts.json; ${where(part)}`);
      else if (!(part in cfg.meshes) && !(part in cfg.regions)) fail('RIG_NAME_RESOLVES', `config.turn.roles.${part}`, `names "${part}", which neither config.meshes nor config.regions attaches`);
    }
  }
  if (cfg.turn?.body !== undefined) {
    for (const part of Object.keys(cfg.turn.body.roles)) {
      if (!byPart.has(part)) fail('RIG_PART_PRESENT', `config.turn.body.roles.${part}`, `names the part "${part}", which is not in parts.json; ${where(part)}`);
      else if (!(part in cfg.meshes) && !(part in cfg.regions)) fail('RIG_NAME_RESOLVES', `config.turn.body.roles.${part}`, `names "${part}", which neither config.meshes nor config.regions attaches`);
    }
  }
  for (const p of parts.parts) {
    const inM = p.name in cfg.meshes;
    const inR = p.name in cfg.regions;
    if (!inM && !inR) fail('RIG_PART_ATTACHED', `part "${p.name}"`, `is in parts.json and has neither a config.meshes nor a config.regions entry; exactly one is required${armSplitHint(p.from)}`);
    if (inM && inR) fail('RIG_PART_ATTACHED', `part "${p.name}"`, 'has both a config.meshes and a config.regions entry; exactly one is required');
    else if (inM && readFrom(p.from)?.run === PAINTING_RUN) {
      fail('RIG_PART_ATTACHED', `part "${p.name}"`, `is a painting patch (${p.from}) and has a config.meshes entry; a patch is a region — config.regions.${p.name} names its bone`);
    }
    const img = images.get(p.name);
    if (img === undefined) fail('RIG_PNG_PRESENT', `part "${p.name}"`, `has no parts/${p.name}.png`);
    else if (img.width !== p.w || img.height !== p.h) {
      fail('RIG_PNG_MATCHES_BOX', `part "${p.name}"`, `parts/${p.name}.png is ${img.width}x${img.height}; parts.json's box is ${p.w}x${p.h}`);
    }
  }

  // ---- motion ------------------------------------------------------------
  const bl = cfg.motion.blink;
  const span = bl === undefined ? 0 : blinkSpan(bl);
  if (bl !== undefined && !(bl.t > 0 && bl.t + span < cfg.motion.duration)) {
    fail(
      'RIG_BLINK_INSIDE_IDLE',
      'config.motion.blink.t',
      `is ${bl.t} s; the blink's keys run from t to t + ${pyRound(span, 6)} s between the idle's first key at 0 and its last at ${cfg.motion.duration} s, so 0 < t < ${pyRound(cfg.motion.duration - span, 6)} is required`,
    );
  }
  if (bl !== undefined) problems.push(...blinkHoldProblems(BLINK.shut, BLINK.hold, IDLE_FPS));
  // ---- blink.still: a blinking region cut at a row ----------------------
  const stills = bl?.still ?? {};
  const partNames = new Set(parts.parts.map((p) => p.name));
  for (const [part, st] of Object.entries(stills)) {
    const at = `config.motion.blink.still.${part}`;
    const p = byPart.get(part);
    if (!(part in cfg.regions)) fail('RIG_NAME_RESOLVES', at, `names "${part}", which config.regions does not attach; a region part is required`);
    if (!B.has(st.bone)) fail('RIG_NAME_RESOLVES', `${at}.bone`, `names the bone "${st.bone}", which config.bones does not declare`);
    if (p === undefined) continue;
    const still = `${part}${STILL_SUFFIX}`;
    if (partNames.has(still)) fail('RIG_STILL_NAME_FREE', at, `the still piece is drawn by the slot "${still}", and parts.json already holds a part of that name; rename that part`);
    if (!(st.row > p.y && st.row < p.y + p.h)) {
      fail('RIG_STILL_ROW_INSIDE_PART', `${at}.row`, `is ${st.row}; "${part}" spans rows ${p.y}..${p.y + p.h - 1}, so a row with part rows on both sides, ${p.y + 1}..${p.y + p.h - 1}, is required`);
      continue;
    }
    const img = images.get(part);
    if (img === undefined || img.width !== p.w || img.height !== p.h) continue;
    const r = st.row - p.y;
    const crossing: number[] = [];
    for (let x = 0; x < img.width; x++) if (img.data[(r * img.width + x) * 4 + 3] > 0) crossing.push(x);
    if (crossing.length > 0) {
      fail(
        'RIG_STILL_ROW_CLEAR',
        `${at}.row`,
        `is ${st.row}, and "${part}" has ${crossing.length} pixel(s) with alpha above 0 on that row (the first at x = ${p.x + crossing[0]}); a row with no art across the part's whole width is required — two pieces cut through art are each resampled against their own transparent edge, so the render changes at rest, not only while the eye moves`,
      );
      continue;
    }
    const artAbove = alphaCount(img, 0, r);
    const artBelow = alphaCount(img, r, img.height);
    if (artAbove === 0 || artBelow === 0) {
      fail('RIG_STILL_PIECES_HAVE_ART', `${at}.row`, `is ${st.row}; "${part}" has ${artAbove} art pixel(s) above it and ${artBelow} below; both pieces need art, or the cut holds nothing still (or nothing blinks)`);
    }
  }
  refuseIfAny(problems);

  const motion = idleMotion(cfg, chains);
  const meshBones = new Set<string>();
  for (const segs of meshSegments.values()) for (const s of segs) meshBones.add(s.bone);
  // A contour region's control bone is weighted to like a segment's bone (issue #84), so the idle's keys on it move
  // to its control under `ctl` as theirs do. A config with no contour region adds nothing here.
  for (const m of Object.values(cfg.meshes)) if ('contour' in m) for (const rg of contourRegionsOf(m.contour)) meshBones.add(rg.bone);
  for (const m of Object.values(cfg.meshes)) if ('auto' in m) for (const rg of m.auto.regions ?? []) if (weightsABone(rg)) meshBones.add(rg.bone);
  for (const m of Object.values(cfg.meshes)) if ('explicit' in m) for (const row of explicitWeightRows(m)) for (const w of row) meshBones.add(w.bone);
  // Accepted final bindings may already name a stop's drawn link. Its source link still needs the idle control.
  for (const stop of cfg.stops ?? []) for (const link of stop.links ?? chains.get(stop.chain) ?? []) {
    if (meshBones.has(`${link}_d`)) meshBones.add(link);
  }
  const meshKeyed = controlledBones(motion, meshBones);
  const controls = idleKeys === 'ctl' ? meshKeyed : [];
  for (const k of controls) {
    const ctl = `${k}${CONTROL_SUFFIX}`;
    if (B.has(ctl)) {
      fail('RIG_CONTROL_NAME_FREE', `bone "${k}"`, `is keyed by the idle and weighted to by a mesh, so it needs the control bone "${ctl}", and config.bones already declares a bone of that name`);
    }
  }
  // The face's up-axis bone is the rig stage's (issue #250): a config bone of that name would be shadowed.
  if (B.has(HEAD_UP_BONE)) fail('RIG_HEAD_UP_NAME_FREE', `bone "${HEAD_UP_BONE}"`, `is the bone the rig stage adds under head to carry the face's up axis (issue #250), and config.bones already declares a bone of that name; rename it`);
  // A two-bone ik over a link and its child link stops being one when the
  // child gets a control: `<child>_ctl` stands between them. rig-c 2.15.0
  // refuses that pair by name (issue #103); the rig stage adds the flag to
  // rigc's line (`ctlRemedies`, src/build.ts).
  refuseIfAny(problems);
  for (const k of controls) {
    const { inherit, ...b } = B.get(k) as Bone;
    const ctl = `${k}${CONTROL_SUFFIX}`;
    // Issue #348: the declared mode belongs to the bone hanging from the declared parent, which is now the control.
    B.set(ctl, { name: ctl, parent: b.parent, x: b.x, y: b.y, ...(inherit === undefined ? {} : { inherit }) });
    B.set(k, { ...b, parent: ctl });
  }
  moveKeysToControls(motion, controls);
  // Parents first: a depth-first walk over the table in insertion order, each
  // bone after its parent — which puts every control directly above its bone.
  const orderParentsFirst = <T extends { name: string; parent?: string | null }>(table: ReadonlyMap<string, T>): T[] => {
    const out: T[] = [];
    const done = new Set<string>();
    const visit = (n: string): void => {
      if (done.has(n)) return;
      const b = table.get(n);
      if (b === undefined) return;
      if (b.parent !== null && b.parent !== undefined) visit(b.parent);
      done.add(n);
      out.push(b);
    };
    for (const n of table.keys()) visit(n);
    return out;
  };
  const ordered = orderParentsFirst(B);

  const spineX = (x: number): number => x - CX;
  const spineY = (y: number): number => cropToSpineY(y, H);

  // ---- direction: every chain link points along its chain (issue #73) ----
  // From the link's origin to the next link's, the last link to the chain's
  // tip, in Spine's axes; a link's control (same origin) points the same way.
  const aim = new Map<string, { rotation: number; length: number }>();
  for (const links of chains.values()) {
    for (const l of links) {
      const b = B.get(l) as Bone;
      const end = (child.get(l) ?? tips.get(l)) as Point;
      const dx = spineX(end[0]) - spineX(b.x);
      const dy = spineY(end[1]) - spineY(b.y);
      const a = { rotation: (Math.atan2(dy, dx) * 180) / Math.PI, length: pyRound(Math.sqrt(dx * dx + dy * dy), 3) };
      aim.set(l, a);
      if (controls.includes(l)) aim.set(`${l}${CONTROL_SUFFIX}`, a);
    }
  }
  // A single bone with a tip points at it the same way, and its control with it (issue #239).
  for (const n of singleTips) {
    const b = B.get(n) as Bone;
    const end = tips.get(n) as Point;
    const dx = spineX(end[0]) - spineX(b.x);
    const dy = spineY(end[1]) - spineY(b.y);
    const a = { rotation: (Math.atan2(dy, dx) * 180) / Math.PI, length: pyRound(Math.sqrt(dx * dx + dy * dy), 3) };
    aim.set(n, a);
    if (controls.includes(n)) aim.set(`${n}${CONTROL_SUFFIX}`, a);
  }
  // ---- the face's axis (issue #239) --------------------------------------
  // Each face bone config.bones declares as a single bone with no tip of its own stands on the eye line, and its
  // control with it; a bone under a face-framed bone that nothing else turns keeps that frame.
  const eyeAt = new Map<string, Point>();
  for (const e of cfg.bones) if (!('chain' in e) && (EYE_BONES as readonly string[]).includes(e.name)) eyeAt.set(e.name, [e.at[0], e.at[1]]);
  const line = eyeLine(parts, eyeAt);
  const declared = FACE_BONES.filter((n) => cfg.bones.some((e) => !('chain' in e) && e.name === n));
  const faceAxis: FaceAxis = {
    degrees: line.degrees,
    parts: line.parts,
    turned: line.degrees === null ? [] : declared.filter((n) => !singleTips.has(n)),
    ownTip: declared.filter((n) => singleTips.has(n)),
    none: line.degrees === null ? line.none : null,
    axis: null,
    noAxis: null,
    tipAxis: null,
    tipOff: [],
    headUp: null,
    headUpNone: null,
  };
  const faceTurn = new Map<string, number>();
  for (const n of faceAxis.turned) {
    faceTurn.set(n, line.degrees as number);
    if (controls.includes(n)) faceTurn.set(`${n}${CONTROL_SUFFIX}`, line.degrees as number);
  }
  const faceRoots = new Set(declared.flatMap((n) => (controls.includes(n) ? [n, `${n}${CONTROL_SUFFIX}`] : [n])));
  // Each bone's local rotation turns it from its parent's world rotation to
  // the one it should have: its chain's direction, or 0 for every other bone,
  // so a named bone under a chain link is turned back upright. `turn` is the
  // world rotation as written, the sum of the written local rotations down the
  // tree. Each local offset is the bone's origin carried into its parent's
  // setup frame as written, through rigc's inverse (`src/coords.ts`).
  const turn = new Map<string, number>();
  /** The bones whose frame is the face's (issue #239): the face bones, their controls, and what hangs under them unturned. */
  const faceFramed = new Set<string>();
  const bones: RigBone[] = [];
  for (const b of ordered) {
    if (b.parent === null) {
      bones.push({ name: b.name, x: 0, y: 0 });
      turn.set(b.name, 0);
      continue;
    }
    const up = turn.get(b.parent) as number;
    const a = aim.get(b.name);
    const inherits = a === undefined && !faceRoots.has(b.name) && faceFramed.has(b.parent);
    if (faceRoots.has(b.name) || inherits) faceFramed.add(b.name);
    const target = a?.rotation ?? faceTurn.get(b.name) ?? (inherits ? up : 0);
    const frame = computeExactFrameTransforms(bones).get(b.parent) as BoneTransform;
    const [x, y] = toBoneLocal(frame, spineX(b.x), spineY(b.y));
    if (b.inherit === undefined) {
      const rotation = places(normaliseDegrees(target - up));
      turn.set(b.name, places(up + rotation));
      bones.push({ name: b.name, parent: b.parent, ...(a === undefined ? {} : { length: a.length }), ...(a !== undefined || rotation !== 0 ? { rotation } : {}), x: places(x), y: places(y) });
      continue;
    }
    // Issue #348: where rig-c's poser puts the bone with no rotation of its own, under its declared mode — the
    // parent's turn under `normal` and the two scale modes, 0 where the mode drops the parent's rotation — and the
    // turn from there to the target; its world turn is then read back off the same poser, not summed.
    const placedAt = { name: b.name, parent: b.parent, x: places(x), y: places(y), inherit: b.inherit };
    const posed = (r: number): BoneTransform => computeExactFrameTransforms([...bones, { ...placedAt, rotation: r }]).get(b.name) as BoneTransform;
    const rotation = places(normaliseDegrees(target - normaliseDegrees(posed(0).worldRotation)));
    turn.set(b.name, places(normaliseDegrees(posed(rotation).worldRotation)));
    bones.push({ name: b.name, parent: b.parent, ...(a === undefined ? {} : { length: a.length }), ...(a !== undefined || rotation !== 0 ? { rotation } : {}), x: places(x), y: places(y), inherit: b.inherit });
  }
  // ---- the head's up axis (issue #250) ----------------------------------
  // `head` keeps its frame, so every key on it and under it — the idle, the blink's brow drop, an authored
  // animation's scale or translate — means what it meant. The face's frame is carried by one slotless bone under it,
  // {@link HEAD_UP_BONE}, at head's origin, turned to the eye line's angle + 90 (the same line, {@link eyeLine}) and
  // as long as the eye midpoint lies from head's origin along that axis: derived from the three bones the config
  // writes, so it moves with them. A rule that needs the head's frame reads it here; nothing binds to it or keys it.
  const headEntry = cfg.bones.find((e) => !('chain' in e) && e.name === 'head');
  if (line.degrees !== null && headEntry !== undefined && !('chain' in headEntry)) {
    const up = line.degrees + 90;
    const [eR, eL] = EYE_BONES.map((n) => eyeAt.get(n) as Point);
    const mid: Point = [(eR[0] + eL[0]) / 2, (eR[1] + eL[1]) / 2];
    const h = B.get('head') as Bone;
    const ux = Math.cos((up * Math.PI) / 180);
    const uy = Math.sin((up * Math.PI) / 180);
    const reach = (spineX(mid[0]) - spineX(h.x)) * ux + (spineY(mid[1]) - spineY(h.y)) * uy;
    if (reach <= 0) {
      faceAxis.headUpNone = `the eye midpoint ${pt(mid)} lies ${pyRound(-reach, 3)} px below head's origin ${pt([h.x, h.y])} along the face's up axis, so ${HEAD_UP_BONE} would have no length toward the crown; not written`;
    } else {
      const parentTurn = turn.get('head') as number;
      const rotation = places(normaliseDegrees(up - parentTurn));
      const length = pyRound(reach, 3);
      bones.push({ name: HEAD_UP_BONE, parent: 'head', length, rotation, x: 0, y: 0 });
      faceAxis.headUp = { rotation: places(parentTurn + rotation), length };
    }
  } else if (line.degrees !== null) faceAxis.headUpNone = 'config.bones declares no single bone "head" for it to hang from';

  const world = computeExactFrameTransforms(bones);

  // ---- the face's axes entry (issue #239, rig-c 2.40.0's A51) -------------
  // The gate draws its line through the eye bones' setup origins, and the face bones were turned to the line through
  // the same two origins as the config writes them ({@link eyeLine}); what separates the two is only how the numbers
  // are stored. So the tolerance is measured, not chosen: the largest gap, as lines, between the line through
  // eye_r -> eye_l and any listed bone's world x axis, in the setup frames of the bones as rigc emits them (each x, y
  // and rotation through rig-c's own `f32`, the float32 the skeleton stores — 36.869898 is stored 1.6e-6 degrees off,
  // more than a 6-place unit), rounded up to the places a rotation is written to, plus one unit of that last place —
  // the float floor of the emitted rig, to the precision this stage writes. A bone turned further off is A51's.
  // Issue #258: a face bone with its own tip is the author's statement of its axis (#239) and is not turned here, but
  // a tip written to lie along the eye line is held too, in an entry of its own ({@link FACE_TIPS_AXIS_NAME}), so the
  // turned bones' entry keeps its float floor. Which tips are meant to lie along the line is read, not chosen: a tip
  // written in whole pixels sits at most half a pixel off in each coordinate, sqrt(2)/2 px, from the point of the line
  // it stands for, so its direction can sit up to asin((sqrt(2)/2) / length) degrees off the line through rounding
  // alone ({@link tipRoundingBound}); a tip within that bone's own bound is held, its entry's tolerance measured as the
  // turned bones' is, and a tip further off is an axis of its own, said by name in faceAxis.tipOff, never silent.
  if (line.degrees !== null && (faceAxis.turned.length > 0 || faceAxis.ownTip.length > 0)) {
    const through: [string, string] = [EYE_BONES[0], EYE_BONES[1]];
    const emitted = computeExactFrameTransforms(
      bones.map((bn) => ({ ...bn, x: f32(bn.x), y: f32(bn.y), ...(bn.rotation === undefined ? {} : { rotation: f32(bn.rotation) }) })),
    );
    const [a, b] = through.map((n) => emitted.get(n) as BoneTransform);
    const gateLine = (Math.atan2(b.worldY - a.worldY, b.worldX - a.worldX) * 180) / Math.PI;
    const gapOf = (n: string): number => {
      const t = emitted.get(n) as BoneTransform;
      return lineGap((Math.atan2(t.c, t.a) * 180) / Math.PI, gateLine);
    };
    const entry = (name: string, listed: string[]): { axis: RigAxis | null; gap: number } => {
      const gap = Math.max(...listed.map(gapOf));
      const tolerance = pyRound(Math.ceil(gap / WRITTEN_UNIT) * WRITTEN_UNIT + WRITTEN_UNIT, OFFSET_PLACES);
      return { axis: tolerance >= 90 ? null : { name, through, bones: listed, tolerance }, gap };
    };
    if (a.worldX === b.worldX && a.worldY === b.worldY) faceAxis.noAxis = `eye_r and eye_l share the world origin (${a.worldX}, ${a.worldY}), so they draw no line`;
    else {
      if (faceAxis.turned.length > 0) {
        const e = entry(FACE_AXIS_NAME, bones.map((bn) => bn.name).filter((n) => faceTurn.has(n)));
        if (e.axis === null) faceAxis.noAxis = `the face bones lie ${pyRound(e.gap, 6)} degrees off the line through eye_r and eye_l, and rigc takes a tolerance below 90 only`;
        else faceAxis.axis = e.axis;
      }
      const held: string[] = [];
      for (const n of faceAxis.ownTip) {
        const length = (aim.get(n) as { length: number }).length;
        const bound = tipRoundingBound(length);
        const gap = gapOf(n);
        if (bound !== null && gap <= bound) {
          held.push(n);
          if (controls.includes(n)) held.push(`${n}${CONTROL_SUFFIX}`);
        } else {
          faceAxis.tipOff.push(
            bound === null
              ? `${n}'s tip is ${length} px from its origin, under the sqrt(2)/2 px a whole-pixel tip can sit off the line, so no direction it states can be read as the line's; its own axis, not held`
              : `${n}'s tip points ${pyRound(gap, 6)} degrees off the line through eye_r and eye_l, more than the ${pyRound(bound, 6)} degrees a tip ${length} px from its origin can sit off it through whole-pixel rounding; its own axis, not held`,
          );
        }
      }
      if (held.length > 0) {
        // In the rig's bone order, as the turned bones' entry lists them.
        const e = entry(FACE_TIPS_AXIS_NAME, bones.map((bn) => bn.name).filter((n) => held.includes(n)));
        faceAxis.tipAxis = e.axis;
      }
    }
  }

  // ---- keys a turned frame would change ----------------------------------
  // A rotate key turns a bone about its origin whatever its frame, so the
  // idle's chain sways mean what they meant. A translate key moves a bone
  // along its parent's axes and a scale or shear key stretches it along its
  // own: on a turned frame those are other directions than the config wrote.
  const keyFrame: Array<{ bone: string; prop: string; at: string }> = [];
  cfg.motion.tracks.forEach((tr, i) => {
    if (!('chain' in tr)) keyFrame.push({ bone: tr.bone, prop: tr.prop, at: `config.motion.tracks[${i}]` });
  });
  bl?.eyes.forEach((m, i) => keyFrame.push({ bone: m, prop: 'scaley', at: `config.motion.blink.eyes[${i}]` }));
  if (bl?.brow_drop !== undefined) bl.brows?.forEach((m, i) => keyFrame.push({ bone: m, prop: 'translatey', at: `config.motion.blink.brows[${i}]` }));
  for (const k of keyFrame) {
    if (k.prop === 'rotate') continue;
    const own = B.get(k.bone) as Bone;
    const parent = (controls.includes(k.bone) ? (B.get(`${k.bone}${CONTROL_SUFFIX}`) as Bone).parent : own.parent) as string;
    const translate = k.prop.startsWith('translate');
    const frameBone = translate ? parent : k.bone;
    const deg = turn.get(frameBone) as number;
    // A key in a face-framed bone's frame means the face's axes: that is the point of the turn (issue #239).
    if (deg === 0 || faceFramed.has(frameBone)) continue;
    const axis = k.prop.slice(-1);
    fail(
      'RIG_KEY_FRAME_UNTURNED',
      `${k.at} (bone "${k.bone}", ${k.prop})`,
      translate
        ? `moves "${k.bone}" along the axes of its parent "${parent}", which is turned ${deg} degrees to point along its chain (issue #73), so the key would move it along that turned axis and not along the picture's ${axis}; a translate key is allowed only on a bone whose parent is not turned — key the chain's own parent, or key rotate`
        : `stretches "${k.bone}" along its own axes, and "${k.bone}" is turned ${deg} degrees to point along its chain (issue #73), so the key would stretch it along that turned axis and not along the picture's ${axis}; a scale or shear key is allowed only on a bone that is not turned — key the chain's own parent, or key rotate`,
    );
  }
  refuseIfAny(problems);

  // ---- attachments -------------------------------------------------------
  const slots: RigSpec['slots'] = [];
  const slotFamilies = new Map<string, string[]>();
  const pendingIslandSlots: Array<{ part: string; index: number; prevSlot: string; before?: string; row: RigSpec['slots'][number] }> = [];
  const addSlots = (part: string, ...rows: RigSpec['slots']): void => {
    slots.push(...rows);
    slotFamilies.set(part, [...(slotFamilies.get(part) ?? []), ...rows.map((s) => s.name)]);
  };
  const skin: RigSpec['skins']['default'] = {};
  const meshReport: MeshReport[] = [];
  const outImages: Array<[string, Raster]> = [];
  const depthReferences: NonNullable<RigOutput['depthReferences']> = [];
  const emitDepth = (part: string, reference: PartDepthReference, scalar: Raster): void => {
    if (outImages.some(([file]) => file === reference.image)) {
      fail('DEPTH_SHEET_UNAMBIGUOUS', reference.image, 'collides with an emitted asset; choose noncolliding part/sheet names');
      return;
    }
    const art = images.get(part);
    const isTurnPart = cfg.turn?.roles?.[part] !== undefined || cfg.turn?.body?.roles?.[part] !== undefined;
    const image =
      isTurnPart && art !== undefined && art.width === scalar.width && art.height === scalar.height
        ? padTurnDepthSheet(scalar, art, PAD)
        : padDepthSheet(scalar, PAD);
    outImages.push([reference.image, image]);
    depthReferences.push({ part, size: [image.width, image.height], depth: reference });
  };

  const loopPasses: Record<string, number> = {};
  const autoMotion: AutoMotionCase[] = [];
  const waistTargets = new Map<string, WaistMapping>();
  const waistLayouts = new Map<string, { slot: string; lm: LatticeMesh; origin: [number, number] }>();
  const waistRegions = new Map<string, { slot: string; region: RegionAttachment; origin: [number, number]; size: [number, number]; bones: RigBone[] }>();
  const waistOld = (lm: LatticeMesh, file: string, w: number, h: number, ox: number, oy: number, segsAt: (y: number) => readonly Segment[], r: number, limits: InfluenceLimits, exponent: number, frames: ReadonlyMap<string, BoneTransform>): MeshAttachment => ({
    type: 'mesh', image: file, width: w, height: h, triangles: lm.triangles, hull: lm.hull,
    uvs: lm.vertices.flatMap(([x, y]) => [pyRound(x / w, 6), pyRound(y / h, 6)]),
    weights: lm.vertices.map(([x, y]) => {
      const shares = influences([x + ox, y + oy], segsAt(y + oy), r, limits, exponent);
      const rounded = limits.floor === 'continuous' ? roundShares(shares) : latticeShares(shares);
      return rounded.map(({ bone, weight }) => { const p = toBoneLocal(frames.get(bone) as BoneTransform, spineX(x + ox), spineY(y + oy)); return { bone, x: places(p[0]), y: places(p[1]), weight }; });
    }),
  });
  // A region's centre in its bone's setup frame; on a turned bone the image
  // is turned back by the bone's world rotation, so it is drawn upright.
  const region = (image: string, bone: string, cx: number, cy: number): RegionAttachment => {
    const [x, y] = toBoneLocal(world.get(bone) as BoneTransform, spineX(cx), spineY(cy));
    const deg = turn.get(bone) as number;
    return deg === 0 ? { image, x: places(x), y: places(y) } : { image, x: places(x), y: places(y), rotation: places(normaliseDegrees(-deg)) };
  };
  // issue #188: the chains a mesh declared ribs on, in the order its segments name them, each chain's points and tip
  // carried into the part image by the same translation as every other position. No ribs declared, none.
  const chainRibs = (segments: ReadonlyArray<string | readonly [string, Point, Point]>, ribs: RibsSpec | undefined, ox: number, oy: number): ContourChainRibs[] => {
    if (ribs === undefined) return [];
    const named = [...new Set(segments.filter((sp): sp is string => typeof sp === 'string'))];
    return named.flatMap((chain) => {
      const line = chainLines.get(chain);
      const declared = ribs[chain];
      if (line === undefined || declared === undefined) return [];
      return [{ chain, points: line.map(([x, y]) => [x - ox, y - oy] as [number, number]), stations: declared.stations }];
    });
  };
  // Issue #417: on a declared dress (a topwear mesh carrying chest, hip and hip-rooted skirt tree chains, as
  // cloth.bottomwear.part drafts), skirt tree links carry no weight on vertices above the hip line (wy < hip.y): the
  // bodice is weighted by the torso's own bones (chest, hip, and any local region like a bust) at any influences cap;
  // below the hip line nothing changes.
  const hipChainLinks = new Set<string>();
  for (const links of chains.values()) {
    for (const l of links) {
      let cur: string | null = B.get(l)?.parent ?? null;
      while (cur !== null && cur !== 'hip' && cur !== 'chest') cur = B.get(cur)?.parent ?? null;
      if (cur === 'hip') hipChainLinks.add(l);
    }
  }
  const dressSegsAt = (p: PartsFile['parts'][number], segs: Segment[]): ((wy: number) => Segment[]) => {
    const hipBone = B.get('hip');
    if (hipBone === undefined) return () => segs;
    const isDress =
      tagOf(p.from) === 'topwear' &&
      segs.some((s) => s.bone === 'chest') &&
      segs.some((s) => s.bone === 'hip') &&
      segs.some((s) => hipChainLinks.has(s.bone));
    if (!isDress) return () => segs;
    const torso = segs.filter((s) => !hipChainLinks.has(s.bone));
    if (torso.length === 0) return () => segs;
    return (wy: number): Segment[] => (wy < hipBone.y ? torso : segs);
  };
  const waist = cfg.waist === undefined ? { pairs: new Map<string, import('./waist.ts').WaistPair>(), problems: [] } : waistPairs(parts.parts.filter((p) => p.name === cfg.waist!.top || p.name === cfg.waist!.bottom), cfg, meshSegments, B);
  problems.push(...waist.problems);
  refuseIfAny(problems);
  // A contour mesh (issue #84): `src/contour.ts` over the padded image, every refusal collected with the others;
  // the weights by `src/localweights.ts`; slot, uvs, bind positions and by-name weights written as the lattice's.
  // The config's region numbers are rig px; the part image's are rig px less (p.x − PAD, p.y − PAD) — a
  // translation, so every length (tolerance, margin, spacing, band, r) is the same number in both.
  const contourAttachment = (
    p: PartsFile['parts'][number],
    img: Raster,
    file: string,
    spec: ContourSpec,
    r: number,
    exponent: number | undefined,
    segs: Segment[],
    rule: WeightRule,
    ribSpec: { segments: ReadonlyArray<string | readonly [string, Point, Point]>; ribs?: RibsSpec },
    declared: MeshInfluences | undefined,
    out: Problem[],
  ): { attachment: MeshAttachment; report: ContourMeshReport } | null => {
    const limits = meshLimits(declared);
    const ox = p.x - PAD;
    const oy = p.y - PAD;
    const w = img.width;
    const h = img.height;
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
    const regions = contourRegionsOf(spec);
    const inPart: ContourRegion[] = regions.map((rg) =>
      rg.shape === 'circle'
        ? { name: rg.name, shape: 'circle', cx: rg.cx - ox, cy: rg.cy - oy, r: rg.r, spacing: rg.spacing, band: rg.band }
        : { name: rg.name, shape: 'polygon', points: rg.points.map(([x, y]) => [x - ox, y - oy] as [number, number]), spacing: rg.spacing, band: rg.band },
    );
    const ribs = chainRibs(ribSpec.segments, ribSpec.ribs, ox, oy);
    const cm = contourMesh(p.name, { width: w, height: h, alpha }, { threshold: ART_ALPHA, tolerance: spec.tolerance, margin: spec.margin, spacing: spec.spacing, ...(spec.maxEdge === undefined ? {} : { maxEdge: spec.maxEdge }), budget: spec.budget, stray: spec.stray, ...(spec.bridges === undefined ? {} : { bridges: spec.bridges }), regions: inPart, ...(ribs.length === 0 ? {} : { ribs }) });
    if (Array.isArray(cm)) {
      out.push(...cm);
      return null;
    }
    // issue #161: under rule "heat", the field over the silhouette the outline was traced from (art above 8, holes
    // filled, grown by the margin), and every vertex's segment shares read off it instead of the distance rule.
    const heat = rule === 'heat' ? boneHeat(`config.meshes.${p.name}`, tracedSilhouette(cm.mask, ART_ALPHA, spec.margin), segs, ox, oy) : null;
    if (Array.isArray(heat)) {
      out.push(...heat);
      return null;
    }
    const segsAt = dressSegsAt(p, segs);
    const weights: WeightEntry[][] = [];
    const reached = regions.map(() => 0);
    const whole = regions.map(() => 0);
    let infl = 0;
    let maxInfl = 0;
    let overlapped = false;
    let emptied: { vertex: number; at: Point; capped: Influence[] } | null = null;
    let emptiedMore = 0;
    cm.vertices.forEach(([vx, vy], vi) => {
      const wx = vx + ox;
      const wy = vy + oy;
      const vSegs = segsAt(wy);
      const li = localInfluences([wx, wy], vSegs, r, regions, limits, exponent ?? DISTANCE_EXPONENT, heat === null ? undefined : heatInfluences(heat, [vx, vy], limits));
      if ('first' in li) {
        if (!overlapped) {
          let bustHint = '';
          if (spec.bust !== undefined) {
            const need: number[] = [];
            for (const rg of [regions[li.first], regions[li.second]]) {
              if (rg.name === 'bust_r' || rg.name === 'bust_l') {
                const apex = rg.name === 'bust_r' ? spec.bust.apex_r : spec.bust.apex_l;
                const d = edgeLength(spec.bust.cleavage[0] - apex[0], spec.bust.cleavage[1] - apex[1]);
                const dist = edgeLength(wx - apex[0], wy - apex[1]);
                need.push(pyRound(d - dist, 2));
              }
            }
            if (need.length > 0) {
              bustHint = ` (contour.bust.clearance >= ${Math.min(...need)} clears vertex ${vi})`;
            }
          }
          out.push({
            code: 'RIG_CONTOUR_REGIONS_OVERLAP',
            object: `config.meshes.${p.name}.contour.regions`,
            detail: `vertex ${vi} at rig (${wx}, ${wy}) takes weight ${pyRound(li.g1, 5)} from region "${regions[li.first].name}" and ${pyRound(li.g2, 5)} from region "${regions[li.second].name}"; each vertex may be reached by one region's falloff (its region and band) — move the regions apart or narrow a band${bustHint}`,
          });
        }
        overlapped = true;
        return;
      }
      if (li.influences.length === 0) {
        // issue #284: a declared cut that keeps no bone (nothingKeptProblem says when that can be); a region's bone would be kept.
        if (emptied === null) emptied = { vertex: vi, at: [wx, wy], capped: heat === null ? influences([wx, wy], vSegs, r, { maxInfluences: limits.maxInfluences, minWeight: 0 }, exponent ?? DISTANCE_EXPONENT) : heatInfluences(heat, [vx, vy], { maxInfluences: limits.maxInfluences, minWeight: 0 }) };
        else emptiedMore++;
        return;
      }
      if (li.region >= 0) {
        reached[li.region]++;
        if (li.g >= 1) whole[li.region]++;
      }
      const shares = writtenShares(li, limits.floor);
      const ent: WeightEntry[] = shares.map(({ bone, weight }) => {
        const [x, y] = toBoneLocal(world.get(bone) as BoneTransform, spineX(wx), spineY(wy));
        return { bone, x: places(x), y: places(y), weight };
      });
      weights.push(ent);
      infl += ent.length;
      maxInfl = Math.max(maxInfl, ent.length);
    });
    if (overlapped) return null;
    if (emptied !== null) {
      out.push(nothingKeptProblem(p.name, limits.floor, emptied, emptiedMore));
      return null;
    }
    const uvs: number[] = [];
    for (const [x, y] of cm.vertices) uvs.push(pyRound(x / w, 6), pyRound(y / h, 6));
    const bones = new Set(segs.map((s) => s.bone));
    for (const rg of regions) bones.add(rg.bone);
    const rep = cm.report;
    return {
      attachment: { type: 'mesh', image: file, width: w, height: h, uvs, triangles: cm.triangles, hull: cm.hull, weights },
      report: {
        part: p.name,
        vertices: cm.vertices.length,
        triangles: cm.triangles.length / 3,
        hull: cm.hull,
        bones: [...bones].sort(),
        max_influences: maxInfl,
        mean_influences: pyRound(infl / cm.vertices.length, 2),
        art_coverage: pyRound(rep.coveredArtPixels / (rep.artPixels + rep.strayPixels + (rep.bridges?.faint ?? []).reduce((t, f) => t + f.art, 0)), 5),
        mode: 'contour',
        ...(exponent === undefined ? {} : { exponent }),
        ...(declared === undefined ? {} : { influences: declared }),
        ...(ribSpec.ribs === undefined ? {} : { ribs: ribsRow(ribSpec.ribs, cm.ribs ?? []) }),
        params: { tolerance: spec.tolerance, margin: spec.margin, spacing: spec.spacing, ...(spec.maxEdge === undefined ? {} : { maxEdge: spec.maxEdge }), budget: spec.budget ?? null, stray: spec.stray ?? null, ...(spec.bridges === undefined ? {} : { bridges: spec.bridges }) },
        contour: rep,
        regions: regions.map((rg, k) => ({ name: rg.name, bone: rg.bone, reached: reached[k], whole: whole[k] })),
        ...(heat === null ? {} : { heat: heatRow(heat) }),
      },
    };
  };
  // An influence mesh (issue #378): rig-c's segments lattice and its influence pull, both computed by rig-c's own
  // promised functions (`buildSegmentsLattice`, `segmentDistance`, `influenceShares`, rig-c/core#1450) in the padded
  // part's pixels — the frame the generator reads — and written as explicit weights, bound exactly as a lattice
  // vertex is. Before any share is taken the radius is held to the farthest vertex's nearest link
  // (`RIG_INFLUENCE_REACH`): a vertex no link reaches would be refused by rig-c's own rule, and the figure that
  // fixes it is that distance.
  const influenceAttachment = (
    p: PartsFile['parts'][number],
    img: Raster,
    file: string,
    spec: InfluenceMeshSpec,
    segs: readonly Segment[],
    entries: readonly number[],
    out: Problem[],
  ): { attachment: MeshAttachment; report: InfluenceMeshReport } | null => {
    const ox = p.x - PAD;
    const oy = p.y - PAD;
    const w = img.width;
    const h = img.height;
    const at = `config.meshes.${p.name}.influence`;
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
    let lattice: SegmentsLattice;
    try {
      lattice = buildSegmentsLattice({ mask: { width: w, height: h, alpha }, threshold: INFLUENCE_THRESHOLD, cell: spec.influence.cell });
    } catch (err) {
      out.push({ code: 'RIG_INFLUENCE_LATTICE', object: `${at}.cell`, detail: `rig-c's segments lattice refused part "${p.name}" at cell ${spec.influence.cell}: ${(err as Error).message}` });
      return null;
    }
    const names = [...new Set(segs.map((s) => s.bone))];
    const index = new Map(names.map((n, k) => [n, k]));
    const local: EntrySegment[] = segs.map((s, k) => ({ bone: index.get(s.bone) as number, entry: entries[k], a: [s.a[0] - ox, s.a[1] - oy], b: [s.b[0] - ox, s.b[1] - oy] }));
    const reach = influenceReach(lattice.points, local, names);
    if (!influenceReachHolds(spec.influence.radius, reach.distance)) {
      out.push(influenceReachProblem(p.name, spec.influence.radius, reach, ox, oy));
      return null;
    }
    const weights: WeightEntry[][] = [];
    let infl = 0;
    let maxInfl = 0;
    let capped = 0;
    let widest = 0;
    const pulled: Influence[][] = [];
    for (const [vi, [x, y]] of lattice.points.entries()) {
      const r = influenceShares([x, y], local, spec.influence);
      if ('nearest' in r) {
        // Not reached after the reach check passed: a defect here, not an input to word.
        throw new Error(`influenceAttachment: vertex ${vi} of "${p.name}" is reached by no link after the radius held`);
      }
      if (r.inReach > spec.influence.max) capped++;
      widest = Math.max(widest, r.inReach);
      pulled.push(r.weights.map((e) => ({ bone: names[e.control ?? 0], weight: e.weight })));
    }
    // Issue #615: `hold_tip: true`, declared on the mesh (propose writes it from the recipe's `split.hold_tip`), smooths
    // the pulled shares by the lattice's held-fork passes, capped at the declared `max`; absent, the shares are rig-c's.
    const shares = spec.influence.hold_tip === true ? smoothForkShares(pulled, lattice.triangles, spec.influence.max) : pulled;
    for (const [vi, [x, y]] of lattice.points.entries()) {
      const wx = x + ox;
      const wy = y + oy;
      const ent: WeightEntry[] = shares[vi].map(({ bone, weight }) => {
        const [bx, by] = toBoneLocal(world.get(bone) as BoneTransform, spineX(wx), spineY(wy));
        return { bone, x: places(bx), y: places(by), weight };
      });
      weights.push(ent);
      infl += ent.length;
      maxInfl = Math.max(maxInfl, ent.length);
    }
    const vertices = lattice.points.map(([x, y]) => [x, y] as Point);
    const n = vertices.length;
    return {
      attachment: { type: 'mesh', image: file, width: w, height: h, uvs: lattice.uvs, triangles: lattice.triangles, hull: lattice.hullVertices, weights },
      report: {
        part: p.name,
        vertices: n,
        triangles: lattice.triangles.length / 3,
        hull: lattice.hullVertices,
        bones: [...names].sort(),
        max_influences: maxInfl,
        mean_influences: pyRound(infl / n, 2),
        art_coverage: pyRound(artCoverage({ vertices, triangles: lattice.triangles }, alphaAbove(img, ART_ALPHA)), 5),
        mode: 'influence',
        influence: { ...spec.influence },
        reach: { farthest: pyRound(reach.distance, 4), at: [pyRound(reach.at[0] + ox, 4), pyRound(reach.at[1] + oy, 4)], nearest: reach.bone, capped, widest },
        lattice: { ...lattice.report },
      },
    };
  };
  // An automatic mesh (issue #126, item 2): the contour source at alpha 1 and above, rig-c's reduceMesh, and
  // the result used only when accepted (`src/automesh.ts`). Its weights are rig-c's by name — a survivor's are
  // the source's bit for bit, an inserted vertex's interpolated — rounded by roundShares (the author's minWeight
  // replaces the 0.03 floor that makes the lattice's rounding safe, so every vertex closes on its heaviest entry)
  // and bound exactly as a contour vertex is.
  const boneOrder = bones.map((b) => b.name);
  // What the amplitude derivation reads (src/autoamplitude.ts), named here because autoAttachment's own `bones` and `motion` shadow them.
  const rigBones = bones;
  const idle = motion;
  // Each bone's setup joint in crop px (src/autoenvelope.ts reads it as the pivot of the skinning envelope), off the
  // rig's bones as written: x back across the root, y through the one door — cropToSpineY is its own inverse (y ↦ H − y).
  const joints = new Map<string, readonly [number, number]>(bones.map((b) => {
    const m = world.get(b.name) as BoneTransform;
    return [b.name, [m.worldX + CX, cropToSpineY(m.worldY, H)] as const];
  }));
  const autoAttachment = (
    p: PartsFile['parts'][number],
    img: Raster,
    file: string,
    spec: AutoSpec,
    r: number,
    exponent: number | undefined,
    segs: Segment[],
    rule: WeightRule,
    ribSpec: { segments: ReadonlyArray<string | readonly [string, Point, Point]>; ribs?: RibsSpec },
    out: Problem[],
  ): { attachment: MeshAttachment; report: AutoMeshReport; motion: AutoMotionCase } | null => {
    const ox = p.x - PAD;
    const oy = p.y - PAD;
    const w = img.width;
    const h = img.height;
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
    const mask = { width: w, height: h, alpha };
    const object = `config.meshes.${p.name}.auto`;
    const regions = spec.regions ?? [];
    // issue #196: the declared bends, as a list, each chain's links resolved (the loader held each chain to the segments).
    const segmentChains = ribSpec.segments.filter((x): x is string => typeof x === 'string' && chains.has(x));
    const stimulus: StimulusPose[] | null =
      spec.stimulus === undefined ? null : (Array.isArray(spec.stimulus) ? spec.stimulus : [spec.stimulus]).map((x) => ({ chain: x.chain, degrees: x.degrees, links: [...(chains.get(x.chain) ?? [])] }));
    const source = autoSource(p.name, mask, spec, chainRibs(ribSpec.segments, ribSpec.ribs, ox, oy));
    if (Array.isArray(source)) {
      out.push(...source.map((q) => ({ ...q, detail: `${q.detail} (the automatic mode's source, at alpha ${AUTO_THRESHOLD} and above)` })));
      return null;
    }
    // One mask for every reader of the part (issue #172): under a declared `source.stray` the islands the trace left
    // out are cleared from the art the reduction, its source bounds, the coverage and the motion gate read — the mask
    // `contourMesh` traced. Nothing left out, it is `mask` itself, so a part without stray reads what it always read.
    // The image written for the part is not touched (the reason is in docs/AUTHORING.md's `stray` row).
    const art = source.mask;
    // issue #161: under rule "heat", the field over the silhouette the source was traced from (the same mask, at the
    // automatic mode's alpha 1 and above, holes filled, grown by source.margin).
    const heat = rule === 'heat' ? boneHeat(`config.meshes.${p.name}`, tracedSilhouette(art, AUTO_THRESHOLD - 1, spec.source.margin), segs, ox, oy) : null;
    if (Array.isArray(heat)) {
      out.push(...heat);
      return null;
    }
    const sw = sourceWeights(source.vertices, ox, oy, segs, r, spec, exponent ?? DISTANCE_EXPONENT, heat, dressSegsAt(p, segs));
    if ('overlap' in sw) {
      out.push({
        code: 'RIG_CONTOUR_REGIONS_OVERLAP',
        object: `${object}.regions`,
        detail: `source vertex ${sw.vertex} at rig (${sw.at[0]}, ${sw.at[1]}) takes weight ${pyRound(sw.overlap.g1, 5)} from region "${regions[sw.overlap.first].name}" and ${pyRound(sw.overlap.g2, 5)} from region "${regions[sw.overlap.second].name}"; each vertex may be reached by one region's falloff (its region and band) — move the regions apart or narrow a band`,
      });
      return null;
    }
    // rig-c's allocation rows read an amplitude this package derives from its own idle (issue #126 Q2), with the
    // author's gradation or null (rig-c 2.29.0, rigc#1291); sent whenever every track term is derived
    // (src/autoamplitude.ts). The same amplitude goes on the motion gate's comparison (src/automotion.ts).
    const amplitude = partAmplitude({ bones: rigBones, motion: idle, constraints: cfg.constraints?.length ?? 0 }, sw.weights, spec.motion);
    // issue #126 (rig-c 2.31.0, rigc#1295): the skinning residual as a per-step veto, only when the author set
    // motion.residual — its envelope derived from the same idle (src/autoenvelope.ts), the reference the lowest common
    // ancestor of the slot's bone and every bound bone (issue #165; the slot's bone itself when every bound bone hangs
    // below it, Q4). A part whose envelope stops is sent nothing: the veto is not applied and the comparison decides alone.
    const residualSpec = spec.motion?.residual;
    const envelope = residualSpec === undefined ? null : slotEnvelope({ bones: rigBones, joints, motion: idle, constraints: cfg.constraints ?? [] }, segs[0].bone, sw.weights.flatMap((v) => v.map((e) => e.bone)), [ox, oy]);
    const input: MeshReductionInput = withSkinning(withAmplitude(autoReductionInput({ part: p.name, mask: art, ox, oy, spec, source, weights: sw.weights, boneOrder }), amplitude), envelope?.derivation ?? null, residualSpec?.maxResidual);
    const ran = reduce(object, input);
    if ('code' in ran) {
      out.push(ran);
      return null;
    }
    const verdict = autoVerdict(object, ran);
    if (!verdict.accepted) {
      out.push(verdict.problem);
      return null;
    }
    // One binding for the result and for the source the motion gate compares it with: rounded by roundShares, bound in each bone's frame.
    const bind = (points: ReadonlyArray<readonly [number, number]>, lists: ReadonlyArray<ReadonlyArray<{ bone: string; weight: number }>>) => {
      const weights: WeightEntry[][] = [];
      let infl = 0;
      let maxInfl = 0;
      let droppedAtFivePlaces = 0;
      const boundTo = regions.map(() => 0);
      points.forEach(([vx, vy], vi) => {
        const wx = vx + ox;
        const wy = vy + oy;
        const list = lists[vi];
        const shares = roundShares(list);
        droppedAtFivePlaces += list.length - shares.length;
        regions.forEach((rg, k) => {
          if (weightsABone(rg) && shares.some((s) => s.bone === rg.bone)) boundTo[k]++;
        });
        const ent: WeightEntry[] = shares.map(({ bone, weight }) => {
          const [x, y] = toBoneLocal(world.get(bone) as BoneTransform, spineX(wx), spineY(wy));
          return { bone, x: places(x), y: places(y), weight };
        });
        weights.push(ent);
        infl += ent.length;
        maxInfl = Math.max(maxInfl, ent.length);
      });
      return { weights, infl, maxInfl, droppedAtFivePlaces, boundTo };
    };
    // The reference of the motion gate (src/automotion.ts): the source exactly as reduceMesh was handed it — its UVs, its
    // triangles in that winding, its hull — and its own weights, bound as the result's are.
    const srcBound = bind(source.vertices, sw.weights);
    const reference: MeshAttachment = { type: 'mesh', image: file, width: w, height: h, uvs: [...input.source.uvs], triangles: [...input.source.triangles], hull: input.source.hull, weights: srcBound.weights };
    const reached = regions.map(() => 0);
    const whole = regions.map(() => 0);
    if ('local' in sw) {
      for (const li of sw.local) {
        if (li.region < 0) continue;
        reached[li.region]++;
        if (li.g >= 1) whole[li.region]++;
      }
    }
    const bones = new Set(segs.map((s) => s.bone));
    for (const rg of regions) if (weightsABone(rg)) bones.add(rg.bone);
    const pro = input.protect;
    // The attachment and the row of one accepted mesh and the report it came with: the full result's, or a replay's (src/autoreplay.ts).
    // The Stage B opt-ins the author set, echoed after `preset` only when set (rigc#1271): a part that sets none writes the row it always wrote.
    const stageB: StageBOptIns = {
      ...(spec.boundaryRuns === undefined ? {} : { boundaryRuns: { maxVertices: spec.boundaryRuns.maxVertices } }),
      ...(spec.retriangulate === undefined ? {} : { retriangulate: spec.retriangulate }),
      ...(spec.removalOrder === undefined ? {} : { removalOrder: spec.removalOrder }),
    };
    // What the declared stray cleared, against the part's art at alpha 1 and above with the cleared islands counted in.
    const strayCleared: StrayCleared = { islands: source.report.strayIslands, pixels: source.report.strayPixels, art_pixels: source.report.artPixels + source.report.strayPixels };
    const rowOf = (mesh: ReducedMesh, report: MeshQualityReport): { attachment: MeshAttachment; row: AutoMeshReport } => {
      const { weights, infl, maxInfl, droppedAtFivePlaces, boundTo } = bind(mesh.points, mesh.weights as Array<Array<{ bone: string; weight: number }>>);
      const candidate = report.candidates[0];
      const rows = residuals(report);
      return {
        attachment: { type: 'mesh', image: file, width: w, height: h, uvs: [...mesh.uvs], triangles: [...mesh.triangles], hull: mesh.hull, weights },
        row: {
          part: p.name,
          vertices: mesh.points.length,
          triangles: mesh.triangles.length / 3,
          hull: mesh.hull,
          bones: [...bones].sort(),
          max_influences: maxInfl,
          mean_influences: pyRound(infl / mesh.points.length, 2),
          art_coverage: pyRound(legacyArtCoverage(art, mesh.points, mesh.triangles), 5),
          mode: 'auto',
          ...(exponent === undefined ? {} : { exponent }),
          ...(ribSpec.ribs === undefined ? {} : { ribs: ribsRow(ribSpec.ribs, source.ribs ?? []) }),
          settings: {
            threshold: input.art.threshold,
            source: { tolerance: spec.source.tolerance, margin: spec.source.margin, spacing: spec.source.spacing, stray: spec.source.stray ?? null },
            sourceBounds: input.sourceBounds,
            targets: { artFit: input.targets.artFit, maxBoundaryDeviation: input.targets.maxBoundaryDeviation, minAngle: input.targets.minAngle ?? null },
            protect: { hull: pro.hull, vertices: pro.vertices, edges: pro.edges, regionBoundaries: pro.regionBoundaries, weightJump: pro.weightJump, influences: pro.influences },
            influences: input.influences as { maxInfluences: number; minWeight: number },
            budget: input.budget,
            minArtSamples: input.minArtSamples,
            regions: regions.map((rg, k) => ({
              name: rg.name,
              bone: weightsABone(rg) ? rg.bone : null,
              band: weightsABone(rg) ? rg.band : null,
              maxEdgeLength: rg.maxEdgeLength,
              transition: rg.transition,
              grade: rg.grade,
              minArtSamples: rg.minArtSamples,
              approximation: input.targets.regions[k].approximation,
            })),
            preset: null,
            ...stageB,
            // rig-c's own echo of the amplitude it read (`effective.motionAmplitude`, rigc#1287/#1291), only when one was sent.
            ...(report.effective.motionAmplitude === undefined || report.effective.motionAmplitude === null ? {} : { motionAmplitude: report.effective.motionAmplitude }),
          },
          source: { contour: source.report, counts: report.sourceCounts },
          ...(spec.source.stray === undefined ? {} : { stray_cleared: strayCleared }),
          result: { counts: mesh.counts, removedVertices: candidate.changes?.removedVertices ?? 0, insertedVertices: candidate.changes?.insertedVertices ?? 0, ...stageBResult(report, stageB) },
          residuals: rows,
          worst_residual: worstResidual(rows),
          worst_region: worstRegion(rows),
          motion_amplitude: amplitudeRow(amplitude),
          ...(stimulus === null ? {} : { stimulus: stimulus.map((x) => ({ chain: x.chain, degrees: x.degrees, links: [...x.links], animations: stimulusAnimationNames(x) })) }),
          ...(residualSpec === undefined || envelope === null ? {} : { skinning_residual: residualRow(residualSpec.maxResidual, envelope.reference, envelope.derivation, report, segs[0].bone) }),
          termination: report.termination as Termination,
          weights: { sharesDroppedOnGrid: candidate.changes?.sharesDroppedOnGrid ?? 0, sharesPruned: candidate.changes?.sharesPruned ?? 0, droppedAtFivePlaces },
          ...(heat === null ? {} : { heat: heatRow(heat) }),
          regions: regions.map((rg, k) => ({ name: rg.name, bone: weightsABone(rg) ? rg.bone : null, reached: reached[k], whole: whole[k], bound_in_result: boundTo[k] })),
          deformation: DEFORMATION_UNMEASURED,
          quality_report: qualityDocument(report),
        },
      };
    };
    const changes = ran.report.candidates[0]?.changes;
    const acceptedAt = [...(changes?.acceptedAt ?? [])];
    const search: AutoSearch = {
      acceptedAt,
      inserted: refinementSteps(acceptedAt),
      replay: (step) => {
        const replayed = reduce(object, { ...input, stopAfterAccepted: step });
        if ('code' in replayed) return replayed;
        const v = replayVerdict(object, step, acceptedAt, replayed);
        if (!v.accepted) return v.problem;
        return { ...rowOf(v.mesh, replayed.report), candidatesTried: v.candidatesTried };
      },
    };
    const motion: AutoMotionCase = {
      part: p.name,
      object,
      motion: spec.motion,
      reference,
      mask: art,
      sourceBounds: input.sourceBounds,
      artFit: input.targets.artFit,
      minArtSamples: input.minArtSamples,
      regions: input.targets.regions.map((rg, k) => ({ name: rg.name, polygon: rg.polygon.map(([x, y]) => [x, y] as [number, number]), minArtSamples: regions[k].minArtSamples })),
      boundBones: [...new Set(srcBound.weights.flatMap((v) => v.map((e) => e.bone)))].sort(),
      segmentChains,
      stimulus,
      amplitude: 'amplitude' in amplitude ? amplitude.amplitude : null,
      search,
    };
    const full = rowOf(verdict.mesh, ran.report);
    return { motion, attachment: full.attachment, report: full.row };
  };
  for (const p of parts.parts) {
    const img = pad(images.get(p.name) as Raster, PAD, PAD, PAD, PAD, [0, 0, 0, 0]);
    const file = `${p.name}.png`;
    const artIndex = outImages.length;
    outImages.push([file, img]);
    const scalar = p.depth === undefined ? undefined : images.get(p.depth.image);
    if (p.depth !== undefined) {
      if (scalar === undefined) fail('DEPTH_SHEET_PRESENT', p.depth.image, `part "${p.name}" declares a sheet; the unpadded source sheet must be handed to buildRig`);
      else {
        problems.push(...depthSheetProblems(scalar, [p.w, p.h], p.depth.image));
        if (parts.parts.some(q => `${q.name}.png` === p.depth?.image)) fail('DEPTH_SHEET_UNAMBIGUOUS', p.depth.image, 'collides with artwork; use noncolliding part names');
        else if (cfg.meshes[p.name] !== undefined || stills[p.name] === undefined) emitDepth(p.name, p.depth, scalar);
      }
    }

    const isHeadSurface = cfg.turn?.roles?.[p.name] === 'surface';
    const isBodySurface = cfg.turn?.body?.roles?.[p.name] === 'surface';
    if (isHeadSurface || isBodySurface) {
      const roleField = isHeadSurface ? `config.turn.roles.${p.name}` : `config.turn.body.roles.${p.name}`;
      if (cfg.meshes[p.name] !== undefined) {
        fail(
          'CONFIG_TURN_SURFACE_REGION',
          roleField,
          `declares "${p.name}" as "surface", and config.meshes.${p.name} also declares a mesh for "${p.name}"; a 2.5D turn "surface" part must be attached in config.regions so the rig stage can promote it to a depth-backed grid mesh`,
        );
        continue;
      }
      if (p.depth === undefined || scalar === undefined) {
        fail(
          'RIG_TURN_SURFACE_DEPTH_REQUIRED',
          roleField,
          `declares role "surface" for "${p.name}", which requires a depth sheet in parts.json; run assemble with config.depth or provide "${p.name}_depth.png"`,
        );
        continue;
      }
    }

    const mesh = cfg.meshes[p.name];
    if (mesh === undefined) {
      if (isHeadSurface || isBodySurface) {
        const [cols, rows] = isHeadSurface
          ? resolveTurnGrid(cfg.turn!, p.name)
          : resolveTurnGrid(cfg.turn!.body!, p.name, cfg.turn);
        const triCount = 2 * (cols - 1) * (rows - 1);
        const gridField = isHeadSurface ? `config.turn.grid (${p.name})` : `config.turn.body.grid (${p.name})`;
        if (triCount > TURN_GRID_MAX_TRIANGLES_PER_SLOT) {
          fail(
            'RIG_TURN_GRID_BUDGET',
            gridField,
            `specifies a ${cols}x${rows} grid (${triCount} triangles), which exceeds the per-slot budget of ${TURN_GRID_MAX_TRIANGLES_PER_SLOT} triangles`,
          );
          continue;
        }
        const surfBone = turnSurfaceBone(p.name);
        const { sources: _sources, ...coreDepth } = p.depth!;
        const gridAtt: Omit<MeshAttachment, 'uvs' | 'triangles' | 'hull' | 'weights'> = {
          type: 'mesh',
          image: file,
          width: img.width,
          height: img.height,
          generator: {
            kind: 'grid',
            cols,
            rows,
            depth: coreDepth,
          },
        };
        skin[p.name] = {
          [p.name]: gridAtt as MeshAttachment,
        };
        addSlots(p.name, { name: p.name, bone: surfBone, attachment: p.name });
        continue;
      }
      const bone = B.get(regionBone(cfg.regions[p.name])) as Bone;
      const cx = p.x + p.w / 2;
      const st = stills[p.name];
      if (st !== undefined) {
        // The part cut at st.row: the lower piece keeps the part's slot and
        // blinks; the upper one is drawn right after it, by <part>_still on
        // st.bone. Each piece sits exactly where its rows sat in the part.
        const src = images.get(p.name) as Raster;
        const r = st.row - p.y;
        const still = `${p.name}${STILL_SUFFIX}`;
        const stillFile = `${still}.png`;
        const lower = pad(crop(src, 0, r, p.w, p.h - r), PAD, PAD, PAD, PAD, [0, 0, 0, 0]);
        const upper = pad(crop(src, 0, 0, p.w, r), PAD, PAD, PAD, PAD, [0, 0, 0, 0]);
        const sb = B.get(st.bone) as Bone;
        outImages[artIndex] = [file, lower];
        outImages.push([stillFile, upper]);
        if (p.depth !== undefined && scalar !== undefined) {
          // The SAME source row r as the art; each drawing owns a distinct
          // padded scalar grid, while original-source provenance stays intact.
          emitDepth(p.name, p.depth, crop(scalar, 0, r, p.w, p.h - r));
          emitDepth(still, { ...p.depth, image: `${still}_depth.png` }, crop(scalar, 0, 0, p.w, r));
        }

        const cyLow = st.row + (p.h - r) / 2;
        const cyUp = p.y + r / 2;
        skin[p.name] = { [p.name]: region(file, bone.name, cx, cyLow) };
        waistRegions.set(p.name, { slot: p.name, region: skin[p.name][p.name] as RegionAttachment, origin: [p.x - PAD, st.row - PAD], size: [lower.width, lower.height], bones });
        skin[still] = { [still]: region(stillFile, sb.name, cx, cyUp) };
        addSlots(p.name, { name: p.name, bone: bone.name, attachment: p.name }, { name: still, bone: sb.name, attachment: still });
        continue;
      }
      const cy = p.y + p.h / 2;
      skin[p.name] = { [p.name]: region(file, bone.name, cx, cy) };
      waistRegions.set(p.name, { slot: p.name, region: skin[p.name][p.name] as RegionAttachment, origin: [p.x - PAD, p.y - PAD], size: [img.width, img.height], bones });
      addSlots(p.name, { name: p.name, bone: bone.name, attachment: p.name });
      continue;
    }
    if ('explicit' in mesh) {
      const row = explicitAttachment(p, images.get(p.name) as Raster, parts.rig_size, mesh);
      if (Array.isArray(row)) { problems.push(...row); continue; }
      for (const isl of row.islandSlots) skin[isl.slot] = { [isl.slot]: isl.attachment };
      const first = row.islandSlots[0];
      addSlots(p.name, { name: first.slot, bone: first.bone, attachment: first.slot });
      for (let i = 1; i < row.islandSlots.length; i++) {
        const isl = row.islandSlots[i];
        pendingIslandSlots.push({
          part: p.name,
          index: i,
          prevSlot: row.islandSlots[i - 1].slot,
          before: isl.before,
          row: { name: isl.slot, bone: isl.bone, attachment: isl.slot },
        });
      }
      meshReport.push(row.report);
      continue;
    }
    const segs = meshSegments.get(p.name) as Segment[];
    if ('auto' in mesh) {
      const row = autoAttachment(p, img, file, mesh.auto, mesh.r, mesh.exponent, segs, mesh.rule ?? 'distance', mesh, problems);
      if (row === null) continue;
      skin[p.name] = { [p.name]: row.attachment };
      addSlots(p.name, { name: p.name, bone: segs[0].bone, attachment: p.name });
      meshReport.push(row.report);
      autoMotion.push(row.motion);
      continue;
    }
    if ('contour' in mesh) {
      const row = contourAttachment(p, img, file, mesh.contour, mesh.r, mesh.exponent, segs, mesh.rule ?? 'distance', mesh, mesh.influences, problems);
      if (row === null) continue;
      skin[p.name] = { [p.name]: row.attachment };
      addSlots(p.name, { name: p.name, bone: segs[0].bone, attachment: p.name });
      meshReport.push(row.report);
      continue;
    }
    if ('influence' in mesh) {
      const row = influenceAttachment(p, img, file, mesh, segs, meshSegmentEntries.get(p.name) as number[], problems);
      if (row === null) continue;
      skin[p.name] = { [p.name]: row.attachment };
      addSlots(p.name, { name: p.name, bone: segs[0].bone, attachment: p.name });
      meshReport.push(row.report);
      continue;
    }
    const allArt = alphaAbove(img, ART_ALPHA);
    // issue #303: under a declared `stray`, the islands it leaves out are cleared from the art the lattice and its heat
    // silhouette are built over; absent, `art` is `allArt` itself and nothing downstream moves.
    const stray = mesh.stray === undefined ? null : latticeStray(allArt, mesh.stray);
    const art = stray === null ? allArt : stray.art;
    const ox = p.x - PAD;
    const oy = p.y - PAD;
    const pair = waist.pairs.get(p.name);
    const band = pair === undefined ? null : waistBand(pair, art, (B.get(pair.upper) as Bone).y - oy);
    if (band !== null && 'code' in band) { problems.push(band); continue; }
    const originalLm = latticeMesh(p.name, art, mesh.grid, maxLoopPasses);
    const lm = band === null || 'code' in originalLm ? originalLm : refineWaistMesh(originalLm, [band.anchor, band.plateau, band.hem]);
    if ('code' in lm) {
      problems.push(lm);
      continue;
    }
    loopPasses[p.name] = lm.passes;
    // issue #161: under rule "heat", the field over the lattice's art (alpha above 8) with its holes filled.
    // issue #303: an island no bone reaches is worded against the lattice's own `stray` when it is dust.
    const dust = (): HeatDust => {
      const read = stray ?? latticeStray(allArt, 0);
      return { field: `config.meshes.${p.name}.stray`, declared: mesh.stray ?? null, artPixels: read.artPixels, largest: read.largest };
    };
    const heat = mesh.rule === 'heat' ? boneHeat(`config.meshes.${p.name}`, latticeSilhouette(art), segs, ox, oy, HEAT_LIMITS, dust) : null;
    if (Array.isArray(heat)) {
      problems.push(...heat);
      continue;
    }
    const w = img.width;
    const h = img.height;
    const weights: WeightEntry[][] = [];
    let infl = 0;
    let maxInfl = 0;
    // issue #284: the mesh's declared cap and floor form, or DEFAULT_LIMITS itself when it declares none.
    const limits: InfluenceLimits = meshLimits(mesh.influences);
    const segsAt = dressSegsAt(p, segs);
    let emptied: { vertex: number; at: Point; capped: Influence[] } | null = null;
    let emptiedMore = 0;
    const rawShares: Influence[][] = [];
    for (const [vi, [vx0, vy0]] of lm.vertices.entries()) {
      const wx = vx0 + ox;
      const wy = vy0 + oy;
      const vSegs = segsAt(wy);
      const hybrid = limbBandShares(p, [wx, wy]);
      const shares = hybrid ?? (band !== null ? waistInfluences([wx, wy], vy0, band, vSegs, mesh.r, limits, mesh.exponent ?? DISTANCE_EXPONENT) : heat === null ? influences([wx, wy], vSegs, mesh.r, limits, mesh.exponent ?? DISTANCE_EXPONENT) : heatInfluences(heat, [vx0, vy0], limits));
      if ('code' in shares) { problems.push(shares); continue; }
      if (shares.length === 0) {
        // issue #284: a declared cut that keeps no bone (nothingKeptProblem says when that can be).
        if (emptied === null) emptied = { vertex: vi, at: [wx, wy], capped: heat === null ? influences([wx, wy], vSegs, mesh.r, { maxInfluences: limits.maxInfluences, minWeight: 0 }, mesh.exponent ?? DISTANCE_EXPONENT) : heatInfluences(heat, [vx0, vy0], { maxInfluences: limits.maxInfluences, minWeight: 0 }) };
        else emptiedMore++;
        continue;
      }
      rawShares.push(hybrid !== null || limits.floor === 'continuous' ? roundShares(shares) : latticeShares(shares));
    }
    if (emptied !== null) {
      problems.push(nothingKeptProblem(p.name, limits.floor, emptied, emptiedMore));
      continue;
    }
    if (rawShares.length !== lm.vertices.length) continue; // named waist binding problems already collected
    const allChainLinks = new Set([...chains.values()].flat());
    const forkCounts = new Map<string, number>();
    for (const sp of mesh.segments) {
      if (typeof sp !== 'string') continue;
      const links = chains.get(sp);
      const par = links !== undefined && links.length > 0 ? (B.get(links[0])?.parent ?? null) : null;
      if (par !== null && allChainLinks.has(par)) forkCounts.set(par, (forkCounts.get(par) ?? 0) + 1);
    }
    const heldFork = band === null && heat === null && mesh.r >= mesh.grid && mesh.influences === undefined && [...forkCounts.values()].some((c) => c >= 2);
    const finalShares = heldFork ? smoothForkShares(rawShares, lm.triangles) : rawShares;
    for (const [vi, [vx0, vy0]] of lm.vertices.entries()) {
      const wx = vx0 + ox;
      const wy = vy0 + oy;
      const ent: WeightEntry[] = finalShares[vi].map(({ bone, weight }) => {
        const [x, y] = toBoneLocal(world.get(bone) as BoneTransform, spineX(wx), spineY(wy));
        return { bone, x: places(x), y: places(y), weight };
      });
      weights.push(ent);
      infl += ent.length;
      maxInfl = Math.max(maxInfl, ent.length);
    }
    const uvs: number[] = [];
    for (const [x, y] of lm.vertices) uvs.push(pyRound(x / w, 6), pyRound(y / h, 6));
    skin[p.name] = { [p.name]: { type: 'mesh', image: file, width: w, height: h, uvs, triangles: lm.triangles, hull: lm.hull, weights } };
    if (band !== null && !('code' in originalLm)) {
      const att = skin[p.name][p.name] as MeshAttachment;
      const old = waistOld(originalLm, file, w, h, ox, oy, segsAt, mesh.r, limits, mesh.exponent ?? DISTANCE_EXPONENT, world);
      waistTargets.set(`default/${p.name}/${p.name}`, preserveWaistRest(old, originalLm, att, lm, storedWorld(bones), band.anchor));
      waistLayouts.set(p.name, { slot: p.name, lm, origin: [ox, oy] });
    }
    addSlots(p.name, { name: p.name, bone: segs[0].bone, attachment: p.name });
    meshReport.push({
      part: p.name,
      vertices: lm.vertices.length,
      triangles: lm.triangles.length / 3,
      hull: lm.hull,
      bones: [...new Set(segs.map((s) => s.bone))].sort(),
      max_influences: maxInfl,
      mean_influences: pyRound(infl / lm.vertices.length, 2),
      art_coverage: pyRound(artCoverage(lm, allArt), 5),
      grid: mesh.grid,
      ...(mesh.exponent === undefined ? {} : { exponent: mesh.exponent }),
      ...(mesh.influences === undefined ? {} : { influences: mesh.influences }),
      ...(stray === null ? {} : { stray: mesh.stray as number, stray_cleared: { islands: stray.islands, pixels: stray.pixels, art_pixels: stray.artPixels } }),
      ...(heat === null ? {} : { heat: heatRow(heat) }),
    });
  }
  const basePartNames = new Set(parts.parts.map((p) => p.name));
  for (const item of pendingIslandSlots) {
    if (item.before !== undefined) {
      if (item.before === item.part || !basePartNames.has(item.before)) {
        fail(
          'RIG_NAME_RESOLVES',
          `config.meshes.${item.part}.explicit.islands[${item.index}].before`,
          `names "${item.before}", which is ${item.before === item.part ? `the part "${item.part}" itself` : 'not a part slot in the rig'}; name another part slot in the rig`,
        );
        continue;
      }
      const targetIdx = slots.findIndex((s) => s.name === item.before);
      slots.splice(targetIdx, 0, item.row);
    } else {
      const prevIdx = slots.findIndex((s) => s.name === item.prevSlot);
      slots.splice(prevIdx + 1, 0, item.row);
    }
    slotFamilies.set(item.part, [...(slotFamilies.get(item.part) ?? []), item.row.name]);
  }
  refuseIfAny(problems);
  // ---- front slots (issue #664) ------------------------------------------
  // Only when a limb declares `front`: each named segment part gets `<part>_front` on its base slot's bone, showing
  // nothing at setup. They ride with every slot through stops and turn, but stay out of the limb closure (#646) and
  // are placed after their target's family once the setup order is final.
  const frontSlots: RigSpec['slots'] = [];
  const frontTargets: Array<{ slot: string; after: string; at: string }> = [];
  for (const [limbName, limb] of Object.entries(cfg.limbs ?? {})) {
    if (limb.front === undefined) continue;
    for (const part of limb.front.parts) {
      const at = `config.limbs.${limbName}.front`;
      const base = slots.find((sl) => sl.name === part);
      if (base === undefined) {
        fail('RIG_NAME_RESOLVES', `${at}.parts`, `names "${part}", which has no slot in the base rig; a front slot rides its segment's base slot bone`);
        continue;
      }
      frontSlots.push({ name: `${part}${FRONT_SUFFIX}`, bone: base.bone, attachment: null });
      frontTargets.push({ slot: `${part}${FRONT_SUFFIX}`, after: limb.front.after, at });
    }
  }
  refuseIfAny(problems);
  // Only declared front slots are front slots: a part authored as `<part>_front` is an ordinary part (review of #667).
  const declaredFront = new Set(frontSlots.map((sl) => sl.name));
  // ---- alternate painting sets (issues #454, #465) ------------------------
  // Only when `parts.alternates` is present: each alternate set's `<set>_<part>`
  // attachments are added to `skins.default[<part>]` on the existing bones and
  // slots before `applyStops` and `applyTurn`, so stopped links and turn twins
  // carry the alternate attachments alongside the base ones. When the alternate
  // carries a skeleton read (`alt.skeleton`) or explicit `drawn` angles, its
  // attachments are bound in the posed bone frames (`altWorld`) and `sets.json`
  // records `drawn` so a retarget does not pose the art a second time.
  let sets: AttachmentSetsFile | undefined;
  if (parts.alternates !== undefined && parts.alternates.length > 0) {
    const setEntries: Record<string, AlternateSetMap> = {};
    for (const [altIdx, alt] of parts.alternates.entries()) {
      const cfgAlt = cfg.alternates?.find((a) => a.name === alt.name);
      for (const [bone, tip] of Object.entries(alt.tips ?? {})) {
        if (bone === ROOT_BONE || !B.has(bone)) fail('RIG_NAME_RESOLVES', `parts.json alternates[${altIdx}].tips.${bone}`, `names "${bone}", which config.bones does not declare; re-run assemble with declared bone names`);
        if (!Array.isArray(tip) || tip.length !== 2 || !tip.every((n) => typeof n === 'number' && Number.isFinite(n))) {
          fail('RIG_ALT_TIP_POINT', `parts.json alternates[${altIdx}].tips.${bone}`, 'requires a finite [x, y] endpoint in rig-crop pixels');
        }
      }
      // Issue #664: one segment is drawn by one slot of a set, its base slot or its front slot, never both.
      for (const slotName of Object.keys(alt.slots)) {
        if (declaredFront.has(`${slotName}${FRONT_SUFFIX}`) && Object.hasOwn(alt.slots, `${slotName}${FRONT_SUFFIX}`)) {
          fail('RIG_SET_FRONT_BOTH', `parts.json alternates[${altIdx}] (set "${alt.name}") part "${slotName}"`, `maps both slot "${slotName}" and its front slot "${slotName}${FRONT_SUFFIX}"; a set draws a segment on its base slot or on its front slot, not both — re-run assemble`);
        }
      }
      const altFront = new Set(alt.front ?? []);
      refuseIfAny(problems);
      const explicitDrawn = alt.drawn ?? cfgAlt?.drawn;
      const isSubsetSet = alt.parts !== undefined || cfgAlt?.parts !== undefined;
      let coveredBones: Set<string> | null = null;
      if (isSubsetSet) {
        coveredBones = new Set<string>();
        for (const slotName of Object.keys(alt.slots)) {
          const pName = declaredFront.has(slotName) && altFront.has(slotName.slice(0, -FRONT_SUFFIX.length)) ? slotName.slice(0, -FRONT_SUFFIX.length) : slotName;
          if (pName in cfg.regions) coveredBones.add(regionBone(cfg.regions[pName]));
          for (const s of meshSegments.get(pName) ?? []) coveredBones.add(s.bone);
          const m = cfg.meshes[pName];
          if (m !== undefined) {
            if ('explicit' in m) {
              if (m.explicit.islands !== undefined) for (const bName of explicitSlotBones(m)) coveredBones.add(bName);
              for (const row of explicitWeightRows(m)) for (const w of row) coveredBones.add(w.bone);
            }
            if ('contour' in m) for (const rg of contourRegionsOf(m.contour)) coveredBones.add(rg.bone);
            if ('auto' in m) for (const rg of m.auto.regions ?? []) if (weightsABone(rg)) coveredBones.add(rg.bone);
          }
        }
      }
      if (explicitDrawn !== undefined) {
        for (const boneName of Object.keys(explicitDrawn)) {
          if (!B.has(boneName)) {
            fail('RIG_NAME_RESOLVES', `config.alternates[${altIdx}].drawn.${boneName}`, `names the bone "${boneName}", which config.bones does not declare`);
          } else if (coveredBones !== null && !coveredBones.has(boneName)) {
            const coveredList = [...coveredBones].map((b) => `"${b}"`).join(', ') || 'none';
            fail(
              'RIG_SET_COVERS_BONE',
              `config.assemble.alternates[${altIdx}].drawn.${boneName}`,
              `names "${boneName}", which alternate set "${alt.name}" does not cover (covered bones: ${coveredList}); a subset set may state drawn angles only for the bones its covered parts ride`,
            );
          }
        }
      }
      refuseIfAny(problems);
      const rawDerived = alt.skeleton === undefined ? undefined : deriveAlternateDrawn(alt.skeleton, B, turn, CX, H);
      const derived =
        rawDerived === undefined
          ? undefined
          : coveredBones === null
            ? rawDerived
            : Object.fromEntries(Object.entries(rawDerived).filter(([k]) => coveredBones.has(k)));
      const drawn: Record<string, number> | undefined =
        (derived === undefined || Object.keys(derived).length === 0) && explicitDrawn === undefined
          ? undefined
          : {
              ...(derived ?? {}),
              ...Object.fromEntries(Object.entries(explicitDrawn ?? {}).map(([k, v]) => [k, places(normaliseDegrees(v))])),
            };
      const posedBones = drawn === undefined ? null : poseRigBonesForDrawn(bones, drawn);
      const altWorld = posedBones === null ? world : computeExactFrameTransforms(posedBones);
      const altTurn = new Map<string, number>();
      if (posedBones !== null) {
        for (const b of posedBones) {
          altTurn.set(b.name, places(normaliseDegrees((altWorld.get(b.name) as BoneTransform).worldRotation)));
        }
      } else {
        for (const [k, v] of turn) altTurn.set(k, v);
      }
      const altRegion = (image: string, bone: string, cx: number, cy: number): RegionAttachment => {
        const [x, y] = toBoneLocal(altWorld.get(bone) as BoneTransform, spineX(cx), spineY(cy));
        const deg = altTurn.get(bone) as number;
        return deg === 0 ? { image, x: places(x), y: places(y) } : { image, x: places(x), y: places(y), rotation: places(normaliseDegrees(-deg)) };
      };
      for (const p of alt.records) {
        const attName = `${alt.name}_${p.name}`;
        const rawImg = images.get(attName);
        if (rawImg === undefined) continue;
        // Issue #664: a part the set draws on its front slot files its attachment under that slot; bones are shared.
        const skinSlot = altFront.has(p.name) ? `${p.name}${FRONT_SUFFIX}` : p.name;
        skin[skinSlot] ??= {};
        const img = pad(rawImg, PAD, PAD, PAD, PAD, [0, 0, 0, 0]);
        const file = `${attName}.png`;
        outImages.push([file, img]);
        if (p.depth !== undefined) {
          const scalar = images.get(p.depth.image);
          if (scalar === undefined) fail('DEPTH_SHEET_PRESENT', p.depth.image, `alternate "${attName}" requires its declared source sheet`);
          else { problems.push(...depthSheetProblems(scalar, [p.w, p.h], p.depth.image)); emitDepth(attName, p.depth, scalar); }
        }

        const mesh = cfg.meshes[p.name];
        if (mesh === undefined) {
          const bone = B.get(regionBone(cfg.regions[p.name])) as Bone;
          skin[skinSlot][attName] = altRegion(file, bone.name, p.x + p.w / 2, p.y + p.h / 2);
          waistRegions.set(attName, { slot: skinSlot, region: skin[skinSlot][attName] as RegionAttachment, origin: [p.x - PAD, p.y - PAD], size: [img.width, img.height], bones: posedBones ?? bones });
          continue;
        }
        if ('explicit' in mesh) {
          fail('RIG_EXPLICIT_ALTERNATE', `config.meshes.${p.name}.explicit`, `set "${alt.name}" replaces this part; an accepted payload is bound to one image and region, not alternate artwork or bind poses — use a generated mesh for this alternate part`);
          continue;
        }
        const fullSegs = meshSegments.get(p.name) as Segment[];
        const explicitSegments = new Map(fullSegs.map((s, k) => [s, typeof mesh.segments[(meshSegmentEntries.get(p.name) as number[])[k]] !== 'string']));
        const baseAtt = skin[p.name]?.[p.name];
        const baseBones = baseAtt !== undefined && 'type' in baseAtt ? new Set((baseAtt.weights ?? []).flatMap((v) => v.map((e) => e.bone))) : null;
        const filteredSegs = baseBones !== null && baseBones.size > 0 ? fullSegs.filter((s) => baseBones.has(s.bone)) : fullSegs;
        let segs = waist.pairs.has(p.name) ? fullSegs : filteredSegs.length > 0 ? filteredSegs : fullSegs;
        let waistSegs = segs;
        if (drawn !== undefined) {
          const movePt = (bone: string, pt0: Point): Point => {
            const m0 = world.get(bone) as BoneTransform;
            const m1 = altWorld.get(bone) as BoneTransform;
            const [lx, ly] = toBoneLocal(m0, spineX(pt0[0]), spineY(pt0[1]));
            const [wx, wy] = toWorld(m1, lx, ly);
            return [wx + CX, cropToSpineY(wy, H)];
          };
          const pt = (q: readonly [number, number]): Point => [q[0], q[1]];
          const skSegs: Map<string, readonly [Point, Point]> | null =
            alt.skeleton === undefined ? null : new Map(skeletonLimbJoints(alt.skeleton).map(([bone, a, b]) => [bone, [pt(a), pt(b)] as const]));
          segs = segs.map((s) => {
            const skPair = skSegs?.get(s.bone);
            const moved = skPair !== undefined ? { bone: s.bone, a: skPair[0], b: skPair[1] } : { bone: s.bone, a: movePt(s.bone, s.a), b: movePt(s.bone, s.b) };
            explicitSegments.set(moved, explicitSegments.get(s) === true);
            return moved;
          });
        }
        if (alt.tips !== undefined) {
          segs = segs.map((s) => {
            // Coordinate tuples are independent authored geometry. Only a named
            // bone/chain endpoint takes the explicit alternate tip.
            const explicit = explicitSegments.get(s) === true;
            const end = alt.tips?.[s.bone];
            return explicit || end === undefined ? s : { ...s, b: [end[0], end[1]] };
          });
        }
        waistSegs = segs;
        // Select against final endpoints, retaining each original entry's
        // tuple/named provenance through the preceding pose and base filters.
        if (drawn !== undefined) {
          const nonSkirt = segs.filter((s) => !hipChainLinks.has(s.bone));
          if (nonSkirt.length > 0) segs = nonSkirt;
          const yOverlapping = segs.filter((s) => Math.max(s.a[1], s.b[1]) >= p.y && Math.min(s.a[1], s.b[1]) <= p.y + p.h);
          segs = yOverlapping.length > 0 ? yOverlapping : [segs[0]];
        }
        const allArt = alphaAbove(img, ART_ALPHA);
        const strayVal = 'auto' in mesh ? mesh.auto.source.stray : 'contour' in mesh ? mesh.contour.stray : 'influence' in mesh ? undefined : mesh.stray;
        const stray = strayVal === undefined ? null : latticeStray(allArt, strayVal);
        const art = stray === null ? allArt : stray.art;
        const grid = 'grid' in mesh ? mesh.grid : 28;
        const r = 'r' in mesh ? mesh.r : 80;
        const ox = p.x - PAD;
        const oy = p.y - PAD;
        const pair = waist.pairs.get(p.name);
        const band = pair === undefined ? null : waistBand(pair, art, cropToSpineY((altWorld.get(pair.upper) as BoneTransform).worldY, H) - oy);
        if (band !== null && 'code' in band) { problems.push(band); continue; }
        if (band !== null) segs = waistSegs;
        const originalLm = latticeMesh(attName, art, grid, maxLoopPasses);
        const lm = band === null || 'code' in originalLm ? originalLm : refineWaistMesh(originalLm, [band.anchor, band.plateau, band.hem]);
        if ('code' in lm) {
          if (band !== null) { problems.push(lm); continue; }
          skin[skinSlot][attName] = altRegion(file, segs[0].bone, p.x + p.w / 2, p.y + p.h / 2);
          continue;
        }
        const w = img.width;
        const h = img.height;
        const limits: InfluenceLimits = meshLimits('influences' in mesh ? mesh.influences : undefined);
        const segsAt = dressSegsAt(p, segs);
        const exponent = ('exponent' in mesh ? mesh.exponent : undefined) ?? DISTANCE_EXPONENT;
        let touchesArt: boolean[] | null = null;
        if (band === null && drawn !== undefined && limits.maxInfluences === 1) {
          const lc = latticeCells(art, grid);
          touchesArt = lm.vertices.map(([vx0, vy0]) => {
            const ii = Math.round(vx0 / grid);
            const jj = Math.round(vy0 / grid);
            for (const di of [-1, 0]) {
              for (const dj of [-1, 0]) {
                const ci = ii + di;
                const cj = jj + dj;
                if (ci >= 0 && ci < lc.nx && cj >= 0 && cj < lc.ny && lc.cells.data[cj * lc.nx + ci] === 1) return true;
              }
            }
            return false;
          });
        }
        const rawShares: Influence[][] = [];
        for (const [vx0, vy0] of lm.vertices) {
          const wx = vx0 + ox;
          const wy = vy0 + oy;
          const vSegs = segsAt(wy);
          const hybrid = limbBandShares(p, [wx, wy]);
          let shares = hybrid ?? (band === null ? influences([wx, wy], vSegs, r, limits, exponent) : waistInfluences([wx, wy], vy0, band, vSegs, r, limits, exponent));
          if ('code' in shares) { problems.push(shares); continue; }
          if (shares.length === 0 && band === null) {
            shares = influences([wx, wy], vSegs, Infinity, { maxInfluences: 1, minWeight: 0 }, exponent);
          }
          rawShares.push(hybrid !== null || limits.floor === 'continuous' ? roundShares(shares) : latticeShares(shares));
        }
        if (rawShares.length !== lm.vertices.length) continue;
        if (touchesArt !== null) {
          let firstArtBone: string | null = null;
          for (let vi = 0; vi < lm.vertices.length; vi++) {
            if (touchesArt[vi] && rawShares[vi].length > 0) {
              firstArtBone = rawShares[vi][0].bone;
              break;
            }
          }
          if (firstArtBone !== null) {
            for (let vi = 0; vi < lm.vertices.length; vi++) {
              if (!touchesArt[vi]) rawShares[vi] = [{ bone: firstArtBone, weight: 1 }];
            }
          }
        }
        const weights: WeightEntry[][] = [];
        for (const [vi, [vx0, vy0]] of lm.vertices.entries()) {
          const wx = vx0 + ox;
          const wy = vy0 + oy;
          const ent: WeightEntry[] = rawShares[vi].map(({ bone, weight }) => {
            const [x, y] = toBoneLocal(altWorld.get(bone) as BoneTransform, spineX(wx), spineY(wy));
            return { bone, x: places(x), y: places(y), weight };
          });
          weights.push(ent);
        }
        const uvs: number[] = [];
        for (const [x, y] of lm.vertices) uvs.push(pyRound(x / w, 6), pyRound(y / h, 6));
        skin[skinSlot][attName] = { type: 'mesh', image: file, width: w, height: h, uvs, triangles: lm.triangles, hull: lm.hull, weights };
        if (band !== null && !('code' in originalLm)) {
          const att = skin[skinSlot][attName] as MeshAttachment;
          const old = waistOld(originalLm, file, w, h, ox, oy, segsAt, r, limits, exponent, altWorld);
          waistTargets.set(`default/${skinSlot}/${attName}`, preserveWaistRest(old, originalLm, att, lm, storedWorld(posedBones ?? bones), band.anchor));
          waistLayouts.set(attName, { slot: skinSlot, lm, origin: [ox, oy] });
        }
      }
      if (alt.base_anchor !== undefined) {
        const baseRegions = new Map<string, AnchorRegion>(), altRegions = new Map<string, AnchorRegion>();
        for (const p of alt.records) {
          if (cfg.meshes[p.name] !== undefined || cfg.regions[p.name] === undefined) continue;
          const bone = regionBone(cfg.regions[p.name]), slot = altFront.has(p.name) ? `${p.name}${FRONT_SUFFIX}` : p.name;
          const original = skin[p.name]?.[p.name], art = skin[slot]?.[`${alt.name}_${p.name}`];
          if (original !== undefined && !('type' in original)) baseRegions.set(p.name, { bone, x: original.x, y: original.y });
          if (art !== undefined && !('type' in art)) altRegions.set(p.name, { bone, x: art.x, y: art.y });
        }
        const moves = baseAnchorMoves(alt.base_anchor, baseRegions, altRegions, altWorld);
        for (const [name, move] of moves) {
          const slot = altFront.has(name) ? `${name}${FRONT_SUFFIX}` : name;
          const attachment = skin[slot][`${alt.name}_${name}`] as RegionAttachment;
          skin[slot][`${alt.name}_${name}`] = { ...attachment, x: places(attachment.x + move.local[0]), y: places(attachment.y + move.local[1]) };
        }
      }
      const slotMap: Record<string, string> = {};
      for (const [slotName, att] of Object.entries(alt.slots)) slotMap[slotName] = att;
      const hideList: string[] = [];
      for (const h of alt.hides ?? []) {
        for (const member of slotFamilies.get(h) ?? [h]) {
          if (!hideList.includes(member)) hideList.push(member);
        }
        if (stills[h] !== undefined && !hideList.includes(`${h}${STILL_SUFFIX}`)) hideList.push(`${h}${STILL_SUFFIX}`);
      }
      for (const slotName of Object.keys(alt.slots)) {
        if (stills[slotName] !== undefined && !hideList.includes(`${slotName}${STILL_SUFFIX}`)) hideList.push(`${slotName}${STILL_SUFFIX}`);
      }
      const coversFace = Object.hasOwn(slotMap, 'face');
      setEntries[alt.name] = {
        slots: slotMap,
        ...(alt.base_anchor === undefined ? {} : { base_anchor: orderedBaseAnchor(alt.base_anchor) }),
        ...(alt.focus === undefined ? {} : { focus: paintingToSetupPoint(alt.focus, alt.focus_source_size as [number, number], parts.rig_size) }),
        ...(hideList.length > 0 ? { hides: hideList } : {}),
        ...(drawn === undefined ? {} : { drawn }),
        ...(alt.drawnLength === undefined ? {} : { drawnLength: { ...alt.drawnLength } }),
        ...(alt.registration === undefined ? {} : { registration: { offset: [alt.registration.offset[0], alt.registration.offset[1]], scale: alt.registration.scale } }),
        ...(coversFace && cfg.turn !== undefined ? { threshold: { ...FACE_RATED_BAND } } : {}),
      };
    }
    const anyCoversFace = Object.values(setEntries).some((e) => Object.hasOwn(e.slots, 'face'));
    sets = {
      spec: SETS_SPEC,
      ...(anyCoversFace ? { threshold: { ...FACE_RATED_BAND } } : {}),
      sets: setEntries,
    };
  }
  refuseIfAny(problems);
  // The bottom follows the explicitly selected top attachment, including subset/alternate sets.
  // Derived attachment names are local to the existing slot/set contract, never a new config field.
  const waistRegionTargets = new Set<string>();
  const freeAttachment = (slot: string, prefix: string): string => { let n = prefix; while (skin[slot][n] !== undefined) n += '_'; return n; };
  for (const pair of waist.pairs.values()) {
    const convert = (topSlot: string, topName: string, bottomSlot: string, bottomName: string, destination: string): void => {
      const layout = waistLayouts.get(topName), source = waistRegions.get(bottomName);
      if (layout === undefined || source === undefined || layout.slot !== topSlot || source.slot !== bottomSlot) { fail('RIG_WAIST_SET_BINDING', `pair "${pair.top}"/"${pair.bottom}"`, `attachments "${topName}"/"${bottomName}" do not carry their declared mesh/region source geometry`); return; }
      const top = skin[topSlot][topName] as MeshAttachment;
      const bottom = waistBottomMesh(top, layout.lm, layout.origin, source.region, source.origin, source.size, pair.lower, source.bones);
      skin[bottomSlot][destination] = bottom;
      if (bottomSlot === pair.bottom && destination === pair.bottom) {
        const driver = cfg.meshes[pair.top];
        const image = outImages.find(([name])=> name === bottom.image)?.[1];
        const shape = waistBottomLayoutOf(bottom);
        if (driver !== undefined && 'grid' in driver && image !== undefined && shape !== undefined) meshReport.push({ part:pair.bottom,vertices:bottom.weights.length,triangles:bottom.triangles.length/3,hull:bottom.hull,bones:[...new Set(bottom.weights.flatMap((ws)=>ws.map((w)=>w.bone)))].sort(),max_influences:Math.max(...bottom.weights.map((ws)=>ws.length)),mean_influences:pyRound(bottom.weights.reduce((n,ws)=>n+ws.length,0)/bottom.weights.length,2),art_coverage:pyRound(artCoverage(shape,alphaAbove(image,ART_ALPHA)),5),grid:driver.grid });
      }
      waistRegionTargets.add(`default/${bottomSlot}/${destination}`);
    };
    convert(pair.top, pair.top, pair.bottom, pair.bottom, pair.bottom);
    for (const [setName, entry] of Object.entries(sets?.sets ?? {})) {
      const selected = (part: string): { slot: string; attachment: string } | null => {
        const front = `${part}${FRONT_SUFFIX}`;
        if (entry.slots[front] !== undefined && !entry.hides?.includes(front)) return { slot: front, attachment: entry.slots[front] };
        return entry.hides?.includes(part) ? null : { slot: part, attachment: entry.slots[part] ?? part };
      };
      const top = selected(pair.top), bottom = selected(pair.bottom);
      if (bottom === null) continue;
      if (top === null) {
        const source = waistRegions.get(bottom.attachment);
        if (source !== undefined) {
          const name = freeAttachment(bottom.slot, `${setName}_${pair.bottom}_rigid`);
          skin[bottom.slot][name] = source.region; entry.slots[bottom.slot] = name;
        }
        continue;
      }
      if (top.slot === pair.top && top.attachment === pair.top && bottom.slot === pair.bottom && bottom.attachment === pair.bottom) continue;
      const destination = bottom.attachment === pair.bottom ? freeAttachment(bottom.slot, `${setName}_${pair.bottom}_waist`) : bottom.attachment;
      convert(top.slot, top.attachment, bottom.slot, bottom.attachment, destination);
      entry.slots[bottom.slot] = destination;
    }
  }
  refuseIfAny(problems);
  const waistBindingsBeforeRebind = new Map([...waistTargets].map(([name, map]) => [name, JSON.stringify(map.current.weights)]));
  const hasAlternateFaceSet = sets !== undefined && Object.values(sets.sets).some((e) => Object.hasOwn(e.slots, 'face'));
  // Read every base/alternate binding before rebinds; publish only the slot
  // permutation below, after stops/turn have used the original enumeration.
  const ungathered = [
    ...Object.entries(cfg.meshes).filter(([, spec]) => spec.gather === false).map(([part]) => ({ part, object: `config.meshes.${part}.gather`, slots: slotFamilies.get(part) ?? [part] })),
    ...Object.entries(cfg.regions).filter(([, spec]) => typeof spec !== 'string' && spec.gather === false).map(([part]) => ({ part, object: `config.regions.${part}.gather`, slots: slotFamilies.get(part) ?? [part] })),
  ];
  // Accepted explicit weights already name drawn stop links. Resolve only the
  // declared aliases for ownership before applyStops, without rebinding them
  // or adding these lookup-only entries to the emitted bone graph.
  const ownershipBones = cfg.stops === undefined ? bones : [...bones, ...cfg.stops.flatMap(s =>
    (s.links ?? chains.get(s.chain) ?? []).map(link => ({ name: `${link}_d`, parent: link, x: 0, y: 0 })))];
  const limbLayout = coalesceLimbSlots(cfg.limbs, ownershipBones, slots, skin, ungathered);
  const explicitLayout = placeLimbLayouts(cfg.limbs, ownershipBones, limbLayout, skin, slotFamilies);
  // ---- leg stops (issue #404) --------------------------------------------
  // Only when the config has `stops`: each link after the first (and any bone hanging from a stopped link) hangs
  // from the drawn link `<link>_d` above it, and slots and weights on a stopped link bind `<link>_d`.
  const rebound = frontSlots.length === 0 ? slots : [...slots, ...frontSlots];
  const stops = cfg.stops === undefined ? null : applyStops(cfg.stops, chains, bones, rebound, skin, (original, emitted) => layoutAlias(explicitLayout.plan, original, emitted));
  for (const [part, mesh] of Object.entries(cfg.meshes)) if ('explicit' in mesh) {
    const defaultBone = typeof mesh.segments[0] === 'string' ? mesh.segments[0] : mesh.segments[0][0];
    if (mesh.explicit.islands !== undefined) {
      mesh.explicit.islands.forEach((isl, i) => {
        const att = skin[isl.slot]?.[isl.slot];
        const slotEntry = slots.find((s) => s.name === isl.slot);
        const expectedBone = isl.bone ?? defaultBone;
        const weightsChanged =
          att !== undefined &&
          'type' in att &&
          JSON.stringify(att.weights) !== JSON.stringify(isl.weights.map(row => row.map(w => ({ bone: w.bone, x: w.x, y: w.y, weight: w.weight }))));
        const boneChanged = slotEntry !== undefined && slotEntry.bone !== expectedBone;
        if (weightsChanged || boneChanged) {
          fail('RIG_EXPLICIT_BINDING', `config.meshes.${part}.explicit.islands[${i}].weights`, 'the declared stops would change these accepted bindings; supply the accepted final emitted bone names and bind coordinates, or use a generated mesh; no payload is normalized');
        }
      });
      continue;
    }
    const att = skin[part]?.[part];
    const slotEntry = slots.find((s) => s.name === part);
    const weightsChanged =
      att !== undefined &&
      'type' in att &&
      JSON.stringify(att.weights) !== JSON.stringify((mesh.explicit.weights ?? []).map(row => row.map(w => ({ bone: w.bone, x: w.x, y: w.y, weight: w.weight }))));
    const boneChanged = slotEntry !== undefined && slotEntry.bone !== defaultBone;
    if (weightsChanged || boneChanged) {
      fail('RIG_EXPLICIT_BINDING', `config.meshes.${part}.explicit.weights`, 'the declared stops would change these accepted bindings; supply the accepted final emitted bone names and bind coordinates, or use a generated mesh; no payload is normalized');
    }
  }
  // ---- the turn control (issue #251) -------------------------------------
  // Only when the config has `turn`: every other build adds nothing here, so no byte moves.
  if (cfg.turn !== undefined) refuseIfAny(turnRiderProblems(cfg.turn, cfg, parts.parts));
  const turned = cfg.turn === undefined || cfg.turn.roles !== undefined || cfg.turn.depths === undefined ? null : applyTurn(cfg.turn, parts.parts.map((p) => p.name), bones, rebound, skin, cfg.constraints ?? [], declaredFront, slotFamilies, stops, turnOrderByDeclaration);
  for (const row of turned?.rows ?? []) for (const t of row.twins) layoutAlias(explicitLayout.plan, t.bone, t.twin);
  const finalSlots = frontSlots.length === 0 ? explicitLayout.slots : spliceFrontSlots(explicitLayout.slots, frontSlots, frontTargets, slotFamilies);
  let generatedMeshBudget: { meshSlots: number; meshTriangles: number } | null = null;
  if (cfg.turn?.roles !== undefined || cfg.turn?.body !== undefined) {
    let totalGridTriangles = 0;
    const slotByName = new Map(finalSlots.map((s) => [s.name, s]));

    if (cfg.turn.roles !== undefined) {
      const roles = cfg.turn.roles;
      const headIdx = bones.findIndex((b) => b.name === 'head');
      if (headIdx === -1) {
        fail('RIG_TURN_HEAD_BONE', 'config.turn.roles', 'requires a declared "head" bone in config.bones to parent the 2.5D turn carriers');
      } else {
        const headTransform = world.get('head') as BoneTransform;
        const headTurnDeg = turn.get('head') ?? 0;
        const surfBones: RigBone[] = [];
        for (const p of parts.parts) {
          if (roles[p.name] !== 'surface') continue;
          const [cols, rows] = resolveTurnGrid(cfg.turn, p.name);
          totalGridTriangles += 2 * (cols - 1) * (rows - 1);
          const cx = p.x + p.w / 2;
          const cy = p.y + p.h / 2;
          const [lx, ly] = toBoneLocal(headTransform, spineX(cx), spineY(cy));
          const rot = places(normaliseDegrees(-headTurnDeg));
          surfBones.push({
            name: turnSurfaceBone(p.name),
            parent: FACESHIFT_BONE,
            x: places(lx),
            y: places(ly),
            ...(rot === 0 ? {} : { rotation: rot }),
          });
        }
        const hasRear = Object.values(roles).includes('rear');
        const carriers: RigBone[] = [
          { name: FACESHIFT_BONE, parent: 'head', x: 0, y: 0 },
          ...(hasRear ? [{ name: REAR_SHIFT_BONE, parent: 'head', x: 0, y: 0 }] : []),
          ...surfBones,
        ];
        bones.splice(headIdx + 1, 0, ...carriers);
        const existingNames = new Set(bones.map((b) => b.name));
        if (!existingNames.has(YAW_DIAL_BONE)) bones.push({ name: YAW_DIAL_BONE, parent: ROOT_BONE, x: 0, y: 0 });
        if (!existingNames.has(PITCH_DIAL_BONE)) bones.push({ name: PITCH_DIAL_BONE, parent: ROOT_BONE, x: 0, y: 0 });

        const boneByName = new Map(bones.map((b) => [b.name, b]));
        const reparentFromHead = (boneName: string, targetParent: string): void => {
          const b = boneByName.get(boneName);
          if (b !== undefined && b.parent === 'head') b.parent = targetParent;
        };
        const rebindPartToCarrier = (part: string, carrierBone: string): void => {
          const sl = slotByName.get(part);
          if (sl !== undefined && sl.bone === 'head') sl.bone = carrierBone;
          const stillSl = slotByName.get(`${part}${STILL_SUFFIX}`);
          if (stillSl !== undefined) {
            if (stillSl.bone === 'head') stillSl.bone = carrierBone;
            else reparentFromHead(stillSl.bone, carrierBone);
          }
          const atts = skin[part] ?? {};
          for (const att of Object.values(atts)) {
            if (!('type' in att) || att.weights === undefined) continue;
            for (const row of att.weights) {
              for (const w of row) {
                if (w.bone === 'head') {
                  w.bone = carrierBone;
                } else {
                  let cur = boneByName.get(w.bone);
                  while (cur !== undefined && cur.parent !== undefined && cur.parent !== 'head' && cur.parent !== carrierBone) {
                    cur = boneByName.get(cur.parent);
                  }
                  if (cur !== undefined && cur.parent === 'head') cur.parent = carrierBone;
                }
              }
            }
          }
        };

        for (const [part, role] of Object.entries(roles)) {
          if (role === 'unit') {
            if (cfg.regions[part] !== undefined) {
              const bName = regionBone(cfg.regions[part]);
              if (bName === 'head') {
                const sl = slotByName.get(part);
                if (sl !== undefined) sl.bone = FACESHIFT_BONE;
              } else {
                reparentFromHead(bName, FACESHIFT_BONE);
              }
              const st = stills[part];
              if (st !== undefined) reparentFromHead(st.bone, FACESHIFT_BONE);
            } else if (cfg.meshes[part] !== undefined) {
              rebindPartToCarrier(part, FACESHIFT_BONE);
            }
          } else if (role === 'rear' && hasRear) {
            if (cfg.regions[part] !== undefined) {
              const bName = regionBone(cfg.regions[part]);
              if (bName === 'head') {
                const sl = slotByName.get(part);
                if (sl !== undefined) sl.bone = REAR_SHIFT_BONE;
              } else {
                reparentFromHead(bName, REAR_SHIFT_BONE);
              }
            } else if (cfg.meshes[part] !== undefined) {
              rebindPartToCarrier(part, REAR_SHIFT_BONE);
            }
          }
        }
      }
    }

    if (cfg.turn.body !== undefined) {
      const bodySpec = cfg.turn.body;
      const bodyRoles = bodySpec.roles;
      const bodyRoot = bodySpec.bone ?? (bones.some((b) => b.name === 'chest') ? 'chest' : 'hip');
      const bodyIdx = bones.findIndex((b) => b.name === bodyRoot);
      if (bodyIdx === -1) {
        fail('RIG_TURN_HEAD_BONE', 'config.turn.body', `requires a declared "${bodyRoot}" bone in config.bones to parent the 2.5D body turn carriers`);
      } else {
        const bodyTransform = world.get(bodyRoot) as BoneTransform;
        const bodyTurnDeg = turn.get(bodyRoot) ?? 0;
        const surfBones: RigBone[] = [];
        for (const p of parts.parts) {
          if (bodyRoles[p.name] !== 'surface') continue;
          const [cols, rows] = resolveTurnGrid(bodySpec, p.name, cfg.turn);
          totalGridTriangles += 2 * (cols - 1) * (rows - 1);
          const cx = p.x + p.w / 2;
          const cy = p.y + p.h / 2;
          const [lx, ly] = toBoneLocal(bodyTransform, spineX(cx), spineY(cy));
          const rot = places(normaliseDegrees(-bodyTurnDeg));
          surfBones.push({
            name: turnSurfaceBone(p.name),
            parent: BODYSHIFT_BONE,
            x: places(lx),
            y: places(ly),
            ...(rot === 0 ? {} : { rotation: rot }),
          });
        }
        const hasRear = Object.values(bodyRoles).includes('rear');
        const carriers: RigBone[] = [
          { name: BODYSHIFT_BONE, parent: bodyRoot, x: 0, y: 0 },
          ...(hasRear ? [{ name: BODY_REAR_SHIFT_BONE, parent: bodyRoot, x: 0, y: 0 }] : []),
          ...surfBones,
        ];
        bones.splice(bodyIdx + 1, 0, ...carriers);
        const bodyDialBone = bodySpec.slider ?? BODY_YAW_DIAL_BONE;
        if (!bones.some((b) => b.name === bodyDialBone)) {
          bones.push({ name: bodyDialBone, parent: ROOT_BONE, x: 0, y: 0 });
        }

        const boneByName = new Map(bones.map((b) => [b.name, b]));
        const torsoRoots = new Set<string>([bodyRoot, 'chest', 'hip', `${bodyRoot}${CONTROL_SUFFIX}`, `chest${CONTROL_SUFFIX}`, `hip${CONTROL_SUFFIX}`]);
        const headExclusion = new Set<string>(['head', `head${CONTROL_SUFFIX}`, 'neck', `neck${CONTROL_SUFFIX}`, FACESHIFT_BONE, REAR_SHIFT_BONE]);
        const reparentFromTorso = (boneName: string, targetParent: string): void => {
          if (torsoRoots.has(boneName) || headExclusion.has(boneName)) return;
          let cur = boneByName.get(boneName);
          while (
            cur !== undefined &&
            cur.parent !== undefined &&
            !torsoRoots.has(cur.parent) &&
            cur.parent !== targetParent &&
            !headExclusion.has(cur.parent)
          ) {
            cur = boneByName.get(cur.parent);
          }
          if (cur !== undefined && cur.parent !== undefined && torsoRoots.has(cur.parent) && !torsoRoots.has(cur.name) && !headExclusion.has(cur.name)) {
            const oldParent = cur.parent;
            if (oldParent !== bodyRoot) {
              const oldTr = world.get(oldParent);
              if (oldTr !== undefined) {
                const [wx, wy] = toWorld(oldTr, cur.x, cur.y);
                const [lx, ly] = toBoneLocal(bodyTransform, wx, wy);
                cur.x = places(lx);
                cur.y = places(ly);
              }
            }
            cur.parent = targetParent;
          }
        };
        const rebindBodyPartToCarrier = (part: string, carrierBone: string): void => {
          const sl = slotByName.get(part);
          if (sl !== undefined && torsoRoots.has(sl.bone)) sl.bone = carrierBone;
          const stillSl = slotByName.get(`${part}${STILL_SUFFIX}`);
          if (stillSl !== undefined) {
            if (torsoRoots.has(stillSl.bone)) stillSl.bone = carrierBone;
            else reparentFromTorso(stillSl.bone, carrierBone);
          }
          const atts = skin[part] ?? {};
          for (const att of Object.values(atts)) {
            if (!('type' in att) || att.weights === undefined) continue;
            for (const row of att.weights) {
              for (const w of row) {
                if (torsoRoots.has(w.bone)) {
                  if (w.bone !== bodyRoot) {
                    const oldTr = world.get(w.bone);
                    if (oldTr !== undefined) {
                      const [wx, wy] = toWorld(oldTr, w.x, w.y);
                      const [lx, ly] = toBoneLocal(bodyTransform, wx, wy);
                      w.x = places(lx);
                      w.y = places(ly);
                    }
                  }
                  w.bone = carrierBone;
                } else {
                  reparentFromTorso(w.bone, carrierBone);
                }
              }
            }
          }
        };

        for (const [part, role] of Object.entries(bodyRoles)) {
          if (role === 'unit') {
            if (cfg.regions[part] !== undefined) {
              const bName = regionBone(cfg.regions[part]);
              if (torsoRoots.has(bName)) {
                const sl = slotByName.get(part);
                if (sl !== undefined) sl.bone = BODYSHIFT_BONE;
                if (bName !== bodyRoot) {
                  const oldTr = world.get(bName);
                  if (oldTr !== undefined) {
                    for (const att of Object.values(skin[part] ?? {})) {
                      if (!('type' in att)) {
                        const [wx, wy] = toWorld(oldTr, att.x, att.y);
                        const [lx, ly] = toBoneLocal(bodyTransform, wx, wy);
                        att.x = places(lx);
                        att.y = places(ly);
                      }
                    }
                  }
                }
              } else {
                reparentFromTorso(bName, BODYSHIFT_BONE);
              }
              const st = stills[part];
              if (st !== undefined) reparentFromTorso(st.bone, BODYSHIFT_BONE);
            } else if (cfg.meshes[part] !== undefined) {
              rebindBodyPartToCarrier(part, BODYSHIFT_BONE);
            }
          } else if (role === 'rear' && hasRear) {
            if (cfg.regions[part] !== undefined) {
              const bName = regionBone(cfg.regions[part]);
              if (torsoRoots.has(bName)) {
                const sl = slotByName.get(part);
                if (sl !== undefined) sl.bone = BODY_REAR_SHIFT_BONE;
                if (bName !== bodyRoot) {
                  const oldTr = world.get(bName);
                  if (oldTr !== undefined) {
                    for (const att of Object.values(skin[part] ?? {})) {
                      if (!('type' in att)) {
                        const [wx, wy] = toWorld(oldTr, att.x, att.y);
                        const [lx, ly] = toBoneLocal(bodyTransform, wx, wy);
                        att.x = places(lx);
                        att.y = places(ly);
                      }
                    }
                  }
                }
              } else {
                reparentFromTorso(bName, BODY_REAR_SHIFT_BONE);
              }
            } else if (cfg.meshes[part] !== undefined) {
              rebindBodyPartToCarrier(part, BODY_REAR_SHIFT_BONE);
            }
          }
        }
      }
    }

    if (cfg.turn.roles !== undefined || cfg.turn.body !== undefined) {
      bones.splice(0, bones.length, ...orderParentsFirst(new Map(bones.map((b) => [b.name, b]))));
    }

    if (totalGridTriangles > TURN_GRID_MAX_TRIANGLES_TOTAL) {
      fail(
        'RIG_TURN_GRID_BUDGET',
        'config.turn.grid',
        `allocates ${totalGridTriangles} total grid triangles across surface slots, which exceeds the total budget of ${TURN_GRID_MAX_TRIANGLES_TOTAL} triangles`,
      );
    }

    let meshSlots = 0;
    let meshTriangles = 0;
    for (const atts of Object.values(skin)) {
      let slotHasMesh = false;
      for (const att of Object.values(atts)) {
        if (!('type' in att)) continue;
        slotHasMesh = true;
        const tris =
          att.generator?.kind === 'grid'
            ? 2 * (att.generator.cols - 1) * (att.generator.rows - 1)
            : (att.triangles?.length ?? 0) / 3;
        if (tris > meshTriangles) meshTriangles = tris;
      }
      if (slotHasMesh) meshSlots++;
    }
    generatedMeshBudget = { meshSlots, meshTriangles };
  }
  // issue #536: every row names the bones the emitted attachment binds, read once the turn and the stops have
  // rebound the weights; a rig with neither rebinds nothing, so this reads back the names each row already holds.
  for (const row of meshReport) {
    const m = cfg.meshes[row.part];
    if (m !== undefined && 'explicit' in m && m.explicit.islands !== undefined) {
      const bound = new Set<string>();
      for (const isl of m.explicit.islands) {
        const att = skin[isl.slot]?.[isl.slot];
        if (att !== undefined && 'type' in att) for (const b of meshBoundBones(att)) bound.add(b);
      }
      row.bones = [...bound].sort();
      continue;
    }
    const att = skin[row.part]?.[row.part];
    if (att !== undefined && 'type' in att) row.bones = meshBoundBones(att);
  }
  // Check the complete namespace: an alternate's art can arrive after a base
  // sheet (or a still asset) with the same filename. Never let write order
  // decide which drawing or measurement survives on disk.
  const assetIndices = new Map<string, number>();
  outImages.forEach(([file], index) => {
    const previous = assetIndices.get(file);
    if (previous !== undefined) fail('DEPTH_SHEET_UNAMBIGUOUS', file, `output assets[${previous}] and [${index}] require the same filename; choose distinct base, still, alternate and sheet names`);
    else assetIndices.set(file, index);
  });
  refuseIfAny(problems);
  const name = `${cfg.key}_painting`;
  const rig: RigSpec = {
    spec: 'rigc-rig/1',
    name,
    images: 'images',
    skeleton: { x: -CX, y: 0, width: W, height: H },
    bones,
    slots: finalSlots,
    skins: { default: skin },
  };
  if (cfg.constraints !== undefined) rig.constraints = cfg.constraints.map(constraintForRig);
  if (turned !== null) rig.constraints = [...(rig.constraints ?? []), ...turned.constraints];
  if (stops !== null) rig.stops = stops;
  const detached = [...detachedRules(cfg.constraints ?? []), ...(turned?.detached ?? [])];
  if (idleKeys === 'direct' && meshKeyed.length > 0) rig.invariants = { idleDrivesMeshes: { why: IDLE_DRIVES_MESHES_WHY } };
  if (detached.length > 0) rig.invariants = { ...rig.invariants, detached };
  // issue #126 item 3: an automatic part whose author set motion.deformMayFold — written only then, so no other rig moves.
  const mayFold = autoMotion.filter((c) => c.motion?.deformMayFold === true).map((c) => ({ slot: c.part, why: DEFORM_MAY_FOLD_WHY }));
  if (mayFold.length > 0) rig.invariants = { ...rig.invariants, deformMayFold: mayFold };
  // issue #239: the face's line, written only when the face bones were turned to one, so no other rig moves.
  const axes = [faceAxis.axis, faceAxis.tipAxis].flatMap((x) => (x === null ? [] : [x]));
  if (axes.length > 0) rig.invariants = { ...rig.invariants, axes };
  if (generatedMeshBudget !== null) {
    rig.invariants = { ...rig.invariants, ...generatedMeshBudget };
  }
  const faceImg = outImages.find(([k]) => k === 'face.png')?.[1];
  const facePart = parts.parts.find((p) => p.name === 'face');
  const partAreas: Record<string, number> = {};
  for (const p of parts.parts) partAreas[p.name] = p.opaque_px;
  const boneLandmarks = new Map<string, readonly [number, number]>();
  for (const [bName, bEntry] of B) {
    boneLandmarks.set(bName, [bEntry.x, bEntry.y]);
  }
  if (cfg.turn?.roles !== undefined || cfg.turn?.body !== undefined) {
    buildDepth25DTurn(rig, motion, {
      turn: cfg.turn,
      parts: parts.parts,
      images,
      regions: cfg.regions,
      stills,
      boneLandmarks,
      hasAlternateFaceSet,
    });
  }
  bindFaceSurfaceDeform(motion, (merged) => {
    if (cfg.waist !== undefined) refuseSharedWaistMotion(merged, cfg.waist.top, cfg.waist.bone);
    remapWaistDeforms(merged, waistTargets, waistRegionTargets, waistBindingsBeforeRebind);
    expandSetAttachmentKeys(rig, sets, merged);
    if (cfg.turn?.roles !== undefined || cfg.turn?.body !== undefined) {
      buildDepth25DTurn(rig, merged, {
        turn: cfg.turn,
        parts: parts.parts,
        images,
        regions: cfg.regions,
        stills,
        boneLandmarks,
        hasAlternateFaceSet,
      });
    }
    if (cfg.turn?.roles === undefined && (cfg.turn === undefined || cfg.turn.body === undefined || cfg.turn.depths !== undefined)) {
      applyFaceSurfaceDeform(rig, merged, {
        imageWidth: faceImg?.width,
        imageHeight: faceImg?.height,
        opaqueWidth: facePart?.w,
        opaqueHeight: facePart?.h,
        overrides: cfg.turn?.deform,
        hasAlternateFaceSet,
        turn: cfg.turn,
        partAreas,
        requireTurn: true,
      });
    }
    if (sets !== undefined && (merged.animations.turn !== undefined || merged.animations.tilt !== undefined)) {
      for (const entry of Object.values(sets.sets)) {
        if (Object.hasOwn(entry.slots, 'face')) {
          entry.threshold = { ...FACE_RATED_BAND };
        }
      }
    }
  });
  return {
    rig,
    motion,
    meshReport,
    images: outImages,
    ...(depthReferences.length === 0 ? {} : { depthReferences }),
    controls,
    meshKeyed,
    idleKeys,
    loopPasses,
    autoMotion,
    faceAxis,
    turn: turned?.rows ?? null,
    ...(sets === undefined ? {} : { sets }),
    ...(explicitLayout.plan === undefined ? {} : { layout: explicitLayout.plan }),
  };
}

/**
 * Issue #664: the final setup slot order with each front slot placed
 * immediately after its target part's whole slot family (the part's slot and
 * its `<part>_still`), wherever the closure (#646) left that family's last
 * member; several front slots after one family keep the order the config
 * declares them in. A target with no slot in the order is refused by name.
 */
function spliceFrontSlots(order: RigSpec['slots'], fronts: RigSpec['slots'], targets: ReadonlyArray<{ slot: string; after: string; at: string }>, families: ReadonlyMap<string, readonly string[]>): RigSpec['slots'] {
  const problems: Problem[] = [];
  const out = [...order];
  for (const [i, f] of fronts.entries()) {
    const t = targets[i];
    const family = families.get(t.after) ?? [];
    const last = Math.max(-1, ...family.map((n) => out.findIndex((s) => s.name === n)));
    if (last < 0) {
      problems.push({ code: 'RIG_NAME_RESOLVES', object: `${t.at}.after`, detail: `names "${t.after}", which has no slot in the rig's setup order; a front slot is placed after a part's slot family` });
      continue;
    }
    let at = last + 1;
    while (at < out.length && fronts.slice(0, i).includes(out[at])) at++;
    out.splice(at, 0, f);
  }
  refuseIfAny(problems);
  return out;
}

/**
 * Issue #473: expand `{"t": …, "set": "<name>" | null}` keys on slot attachment
 * tracks in `merged.animations` into `{"t": …, "v": "<attachment>" | null}`
 * keys against `rig.slots` and `sets.json`. When no key carries `"set"`, nothing
 * is touched and no byte moves.
 */
export function expandSetAttachmentKeys(rig: RigSpec, sets: AttachmentSetsFile | undefined, merged: MotionSpec): void {
  let hasAnySetKey = false;
  for (const [animName, anim] of Object.entries(merged.animations)) {
    if (animName === 'idle' || typeof anim !== 'object' || anim === null || Array.isArray(anim)) continue;
    const tracks = (anim as Record<string, unknown>).tracks;
    if (!Array.isArray(tracks)) continue;
    for (const tr of tracks) {
      if (typeof tr !== 'object' || tr === null || Array.isArray(tr)) continue;
      const keys = (tr as Record<string, unknown>).keys;
      if (!Array.isArray(keys)) continue;
      for (const k of keys) {
        if (typeof k === 'object' && k !== null && !Array.isArray(k) && 'set' in k) {
          hasAnySetKey = true;
          break;
        }
      }
      if (hasAnySetKey) break;
    }
    if (hasAnySetKey) break;
  }
  if (!hasAnySetKey) return;

  const baseSlots = new Map<string, string | null>();
  const slotBoneMap = new Map<string, string>();
  for (const sl of rig.slots) {
    baseSlots.set(sl.name, sl.attachment ?? null);
    const rawBone = sl.bone.startsWith(`${sl.name}__`) ? sl.bone.slice(`${sl.name}__`.length) : sl.bone;
    slotBoneMap.set(sl.name, rawBone);
  }
  const setupRotByBone = new Map<string, number>();
  for (const b of rig.bones) setupRotByBone.set(b.name, b.rotation ?? 0);
  const setBoneDeltas = new Map<string, Map<string, number>>();
  if (sets !== undefined) {
    for (const [setName, entry] of Object.entries(sets.sets)) {
      if (entry.drawn === undefined || Object.keys(entry.drawn).length === 0) continue;
      const posed = poseRigBonesForDrawn(rig.bones, entry.drawn, rig.stops);
      const deltas = new Map<string, number>();
      for (const b of posed) {
        if (Object.hasOwn(entry.drawn, b.name)) {
          const d = places(normaliseDegrees((b.rotation ?? 0) - (setupRotByBone.get(b.name) ?? 0)));
          deltas.set(b.name, d);
        }
      }
      setBoneDeltas.set(setName, deltas);
    }
  }
  const declaredSets =
    sets === undefined || Object.keys(sets.sets).length === 0
      ? 'none'
      : Object.keys(sets.sets)
          .map((n) => `"${n}"`)
          .join(', ');
  const problems: Problem[] = [];

  for (const [animName, anim] of Object.entries(merged.animations)) {
    if (animName === 'idle' || typeof anim !== 'object' || anim === null || Array.isArray(anim)) continue;
    const tracks = (anim as Record<string, unknown>).tracks;
    if (!Array.isArray(tracks)) continue;
    const existingRotateBones = new Set<string>();
    for (const tr of tracks) {
      if (typeof tr === 'object' && tr !== null && !Array.isArray(tr)) {
        const r = tr as Record<string, unknown>;
        if (r.property === 'rotate' && typeof r.bone === 'string') existingRotateBones.add(r.bone);
      }
    }
    const synthesizedRotate = new Map<string, Array<Record<string, unknown>>>();
    tracks.forEach((tr, ti) => {
      if (typeof tr !== 'object' || tr === null || Array.isArray(tr)) return;
      const trRec = tr as Record<string, unknown>;
      const keys = trRec.keys;
      if (!Array.isArray(keys)) return;
      const slot = typeof trRec.slot === 'string' && trRec.slot !== '' ? trRec.slot : null;
      const isAttachmentTrack = trRec.property === 'attachment' && slot !== null;
      const slotBone = slot === null ? undefined : slotBoneMap.get(slot);
      let trackTouchesDrawnBone = false;
      const rawSetKeysForBone: Array<{ t: unknown; setVal: string | null }> = [];
      keys.forEach((k, ki) => {
        if (typeof k !== 'object' || k === null || Array.isArray(k) || !('set' in k)) return;
        const kRec = k as Record<string, unknown>;
        const keyAt = `animations.${animName}.tracks[${ti}].keys[${ki}].set`;
        if (!isAttachmentTrack || slot === null) {
          problems.push({
            code: 'CONFIG_SET_COVERS_SLOT',
            object: keyAt,
            detail: `is ${JSON.stringify(kRec.set)} on a ${JSON.stringify(trRec.property)} track${slot === null ? '' : ` for slot "${slot}"`}; a "set" key belongs on a slot attachment track ({"slot": "<part>", "property": "attachment", "keys": [{"t": …, "set": "<name>" | null}]})`,
          });
          return;
        }
        if ('v' in kRec) {
          problems.push({
            code: 'CONFIG_FIELD_TYPE',
            object: keyAt,
            detail: `is declared beside v (${JSON.stringify(kRec.v)}); state either "set": "<name>" | null or "v": "<attachment>" | null on an attachment key, not both`,
          });
          return;
        }
        const setVal = kRec.set;
        let resolvedV: string | null = null;
        if (setVal === null) {
          if (!baseSlots.has(slot)) {
            problems.push({
              code: 'CONFIG_SET_COVERS_SLOT',
              object: keyAt,
              detail: `restores the base attachment on slot "${slot}", which is not a declared slot of the rig (declared slots: ${[...baseSlots.keys()].map((s) => `"${s}"`).join(', ')})`,
            });
            return;
          }
          resolvedV = baseSlots.get(slot) ?? null;
          rawSetKeysForBone.push({ t: kRec.t, setVal: null });
        } else if (typeof setVal !== 'string' || setVal === '') {
          problems.push({
            code: 'CONFIG_FIELD_TYPE',
            object: keyAt,
            detail: `is ${JSON.stringify(setVal)}; a non-empty alternate set name or null (the base pose) is required`,
          });
          return;
        } else {
          const entry = sets?.sets[setVal];
          if (entry === undefined) {
            problems.push({
              code: 'CONFIG_SET_COVERS_SLOT',
              object: keyAt,
              detail: `names alternate set "${setVal}" for slot "${slot}", which config.assemble.alternates does not declare (declared sets: ${declaredSets})`,
            });
            return;
          }
          // Issue #664: a set that draws this track's part on its front slot moves the part in the draw order, which a
          // keyed attachment swap cannot do; keyed draw-order changes are out of scope.
          // A declared front slot is the one slot the rig writes with no setup attachment.
          const isFront = (name: string): boolean => rig.slots.some((sl) => sl.name === name && sl.attachment === null);
          const frontBase = slot.endsWith(FRONT_SUFFIX) && isFront(slot) ? slot.slice(0, -FRONT_SUFFIX.length) : null;
          const drawsFront =
            (isFront(`${slot}${FRONT_SUFFIX}`) && Object.hasOwn(entry.slots, `${slot}${FRONT_SUFFIX}`) && entry.hides?.includes(slot) === true) ||
            (frontBase !== null && Object.hasOwn(entry.slots, slot) && entry.hides?.includes(frontBase) === true);
          if (drawsFront) {
            const part = frontBase ?? slot;
            problems.push({
              code: 'CONFIG_SET_FRONT_KEYED',
              object: keyAt,
              detail: `names alternate set "${setVal}" on slot "${slot}", and set "${setVal}" draws "${part}" on its front slot "${part}${FRONT_SUFFIX}" (hiding "${part}"); a keyed set switch on a front part would change the draw order mid-clip, which is out of scope — show the set with setSet, or key a part the set draws on its base slot`,
            });
            return;
          }
          if (Object.hasOwn(entry.slots, slot)) {
            resolvedV = entry.slots[slot];
          } else if (entry.hides?.includes(slot) === true) {
            resolvedV = null;
          } else {
            const covered = [...Object.keys(entry.slots), ...(entry.hides ?? [])].map((s) => `"${s}"`).join(', ') || 'none';
            problems.push({
              code: 'CONFIG_SET_COVERS_SLOT',
              object: keyAt,
              detail: `names alternate set "${setVal}" on slot "${slot}", which set "${setVal}" does not cover (set "${setVal}" covers: ${covered}); add "${slot}" to that set's parts (or hides) in config.assemble.alternates, or key a slot the set covers`,
            });
            return;
          }
          if (slotBone !== undefined && setBoneDeltas.get(setVal)?.has(slotBone) === true) {
            trackTouchesDrawnBone = true;
          }
          rawSetKeysForBone.push({ t: kRec.t, setVal });
        }
        const expanded: Record<string, unknown> = {};
        for (const [prop, val] of Object.entries(kRec)) {
          if (prop === 'set') expanded.v = resolvedV;
          else expanded[prop] = val;
        }
        keys[ki] = expanded;
      });
      if (
        problems.length === 0 &&
        trackTouchesDrawnBone &&
        slotBone !== undefined &&
        !existingRotateBones.has(slotBone) &&
        !synthesizedRotate.has(slotBone)
      ) {
        const rotKeys = rawSetKeysForBone.map((rk, idx) => {
          const d = rk.setVal === null ? 0 : (setBoneDeltas.get(rk.setVal)?.get(slotBone) ?? 0);
          return idx + 1 < rawSetKeysForBone.length ? { t: rk.t, v: [d], curve: 'stepped' } : { t: rk.t, v: [d] };
        });
        synthesizedRotate.set(slotBone, rotKeys);
      }
    });
    if (problems.length === 0) {
      for (const [boneName, rotKeys] of synthesizedRotate) {
        tracks.push({ bone: boneName, property: 'rotate', keys: rotKeys });
      }
    }
  }
  refuseIfAny(problems);
}

/**
 * Re-parent every bone that hangs from a stopped link onto that link's drawn
 * link `<link>_d`, move slots and mesh weights from a stopped link onto
 * `<link>_d`, and return `rig.json`'s `stops` array (issue #404). At the setup
 * pose `<link>_d` has the same world origin and rotation as `<link>`, so every
 * local offset and bind coordinate is unchanged.
 */
function applyStops(
  stops: readonly ConfigStop[],
  chains: ReadonlyMap<string, readonly string[]>,
  bones: RigBone[],
  slots: RigSpec['slots'],
  skin: RigSpec['skins']['default'],
  alias?: (original: string, emitted: string) => void,
): RigStop[] {
  const out: RigStop[] = [];
  const drawn = new Map<string, string>();
  for (const s of stops) {
    const links = s.links ?? chains.get(s.chain) ?? [];
    for (const l of links) { drawn.set(l, `${l}_d`); alias?.(l, `${l}_d`); }
    out.push(stopForRig(s, links));
  }
  for (const b of bones) {
    const d = b.parent === undefined ? undefined : drawn.get(b.parent);
    if (d !== undefined) b.parent = d;
  }
  for (const s of slots) {
    const d = drawn.get(s.bone);
    if (d !== undefined) s.bone = d;
  }
  for (const atts of Object.values(skin)) {
    for (const att of Object.values(atts)) {
      if (!('type' in att)) continue;
      for (const v of att.weights) {
        for (const w of v) {
          const d = drawn.get(w.bone);
          if (d !== undefined) w.bone = d;
        }
      }
    }
  }
  return out;
}

/**
 * The JSON text of a rig output file. One space of indent, as the reference
 * wrote, and a closing newline; the key order is the order the objects were
 * built in, which `buildRig` fixes.
 */
export function rigJsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 1)}\n`;
}

/**
 * The rig as the reference wrote it: every bone unturned, so each local
 * offset is a plain difference of world positions. Each bone's `x, y`, each
 * weight's bind `x, y` and each region's `x, y` is carried out of its frame as
 * written (rigc's `toWorld`, `src/coords.ts`) and back in as a difference from
 * the frame's origin, at the reference's 3 places; `length` and `rotation` are
 * dropped, and so is `invariants.axes` (issue #239): it holds bones to a
 * line they lie along only when turned, which the flat form undoes, and the
 * reference declared none; and so is {@link HEAD_UP_BONE} (issue #250), a
 * slotless bone that carries only a direction, which the reference never
 * wrote. Everything else is copied.
 *
 * It exists so the reference's outputs stay an oracle: the chain suite and
 * `scripts/rig_oracle.ts` compare `flattenRig(built)` with the reference's
 * `rig.json`. It is the oriented emitter's inverse, and it lives beside it so
 * a change to one is read against the other.
 *
 * ⛔ The flat form cannot draw a turned image. A region whose `rotation` does
 * not cancel its bone's world rotation is refused by name
 * (`FLATTEN_REGION_UPRIGHT`) rather than flattened into an upright one the
 * oriented rig does not draw.
 *
 * A transform constraint that reads its source's **local** rotation and adds
 * it to its targets' local rotations (`localSource`, `localTarget`,
 * `additive`: the cloth recipe's swing, issue #364) reads the source's setup
 * rotation, which the flat form drops; spine-core takes the source's rotation
 * less the `rotate` property's `offset`, so the flat form's offset is the
 * offset less that setup rotation, and the targets turn by the same amount in
 * both forms (issue #372: copied as written, the swing turned every skirt tree
 * 90 degrees in the flat form of the `wind` example). Every other constraint
 * is copied as written.
 *
 * `sense` is the direction rotations are read in: 1, always, but for the
 * planted control that shows a flatten turning the wrong way is caught.
 */
export function flattenRig(rig: RigSpec, sense: 1 | -1 = 1): RigSpec {
  const problems: Problem[] = [];
  const undrawn = new Map<string, string>();
  for (const s of rig.stops ?? []) for (const l of s.links) undrawn.set(`${l}_d`, l);
  const realBone = (n: string): string => undrawn.get(n) ?? n;
  const read = rig.bones.map((b) => ({ ...b, ...(b.parent === undefined ? {} : { parent: realBone(b.parent) }), rotation: (b.rotation ?? 0) * sense }));
  const world = computeExactFrameTransforms(read);
  const turn = new Map<string, number>();
  // A bone with a declared inherit mode (issue #348) is read off rig-c's poser, which honours the mode; every other is the sum, as before.
  for (const b of rig.bones) {
    turn.set(
      b.name,
      b.inherit === undefined
        ? placed((b.parent === undefined ? 0 : (turn.get(realBone(b.parent)) as number)) + (b.rotation ?? 0), OFFSET_PLACES)
        : placed(normaliseDegrees((world.get(b.name) as BoneTransform).worldRotation), OFFSET_PLACES),
    );
  }
  const origin = (bone: string): BoneTransform => world.get(realBone(bone)) as BoneTransform;
  const out = (m: BoneTransform, x: number, y: number): [number, number] => {
    const [wx, wy] = toWorld(m, x, y);
    return [placed(wx - m.worldX, FLAT_PLACES), placed(wy - m.worldY, FLAT_PLACES)];
  };
  // The head's up-axis bone (issue #250) carries only a direction, which the flat form undoes; the reference wrote none.
  const bones: RigBone[] = rig.bones.filter((b) => b.name !== HEAD_UP_BONE).map((b) => {
    if (b.parent === undefined) return { name: b.name, x: b.x, y: b.y };
    const [x, y] = out(origin(b.parent), b.x, b.y);
    return { name: b.name, parent: b.parent, x, y, ...(b.inherit === undefined ? {} : { inherit: b.inherit }) };
  });
  const slotBone = new Map(rig.slots.map((s) => [s.name, s.bone]));
  const skin: RigSpec['skins']['default'] = {};
  for (const [slot, atts] of Object.entries(rig.skins.default)) {
    const bone = slotBone.get(slot) as string;
    const flat: Record<string, MeshAttachment | RegionAttachment> = {};
    for (const [name, att] of Object.entries(atts)) {
      if ('type' in att) {
        flat[name] = { ...att, weights: att.weights.map((v) => v.map((w) => {
          const [x, y] = out(origin(w.bone), w.x, w.y);
          return { bone: w.bone, x, y, weight: w.weight };
        })) };
        continue;
      }
      const left = normaliseDegrees((turn.get(realBone(bone)) as number) + (att.rotation ?? 0));
      if (Math.abs(left) > 1e-6) {
        problems.push({
          code: 'FLATTEN_REGION_UPRIGHT',
          object: `skins.default.${slot}.${name}`,
          detail: `rides "${bone}", turned ${turn.get(realBone(bone))} degrees, with rotation ${att.rotation ?? 'absent'}, so it is drawn turned ${placed(left, OFFSET_PLACES)} degrees; the flat form draws every region upright, so the region's rotation must cancel its bone's turn`,
        });
        continue;
      }
      const [x, y] = out(origin(bone), att.x, att.y);
      flat[name] = { image: att.image, x, y };
    }
    skin[slot] = flat;
  }
  refuseIfAny(problems);
  const flat: RigSpec = { ...rig, bones, skins: { default: skin } };
  if (rig.constraints !== undefined) {
    const setup = new Map(read.map((b) => [b.name, b.rotation]));
    flat.constraints = rig.constraints.map((c) => {
      const props = c.properties as Record<string, Record<string, unknown>> | undefined;
      const rotate = props?.rotate;
      const turned = typeof c.source === 'string' ? (setup.get(c.source) ?? 0) : 0;
      if (c.type !== 'transform' || c.localSource !== true || c.localTarget !== true || c.additive !== true || rotate === undefined || turned === 0) return c;
      const offset = typeof rotate.offset === 'number' ? rotate.offset : 0;
      return { ...c, properties: { ...props, rotate: { ...rotate, offset: placed(offset - turned, OFFSET_PLACES) } } };
    });
  }
  if (rig.stops !== undefined) {
    flat.stops = rig.stops.map((s) => ({ ...s, at: out(origin(s.against), s.at[0], s.at[1]) }));
  }
  if (rig.invariants?.axes !== undefined) {
    const { axes: _axes, ...rest } = rig.invariants;
    if (Object.keys(rest).length > 0) flat.invariants = rest;
    else delete flat.invariants;
  }
  return flat;
}

/** Explicit candidate stage: preserve the ordinary builder and all original topwear bytes. */
export function withWaistPivot(output: RigOutput, request: WaistPivotRequest): RigOutput {
  const old = output.rig.skins.default[request.bottom]?.[request.bottom];
  const top = output.rig.skins.default[request.top]?.[request.top];
  const oldLm = old !== undefined && 'type' in old ? waistBottomLayoutOf(old) : undefined;
  const bottomImage = output.images.find(([name]) => name === old?.image)?.[1];
  const topImage = output.images.find(([name]) => name === top?.image)?.[1];
  if (old === undefined || !('type' in old) || top === undefined || !('type' in top) || oldLm === undefined || topImage === undefined || bottomImage === undefined) throw new PartsError([{ code: 'RIG_WAIST_PIVOT_SOURCE', object: 'waist candidate', detail: `paired mesh source/layout/images "${request.top}"/"${request.bottom}" required from the original builder` }]);
  if (output.rig.constraints?.length || output.turn !== null || output.rig.stops !== undefined) throw new PartsError([{ code: 'RIG_WAIST_PIVOT_FRAME', object: 'waist candidate', detail: 'requires the original unconstrained, unturned, unstopped source graph; no existing graph is rewritten' }]);
  const pivot = pivotWaistMesh(old, oldLm, alphaAbove(topImage, ART_ALPHA), alphaAbove(bottomImage, ART_ALPHA), output.rig.bones, request);
  return { ...output, rig: { ...output.rig, bones: [...output.rig.bones, pivot.bone], constraints: [pivot.constraint],
    invariants: { ...output.rig.invariants, detached: [...(output.rig.invariants?.detached ?? []), { bone: request.lower, notUnder: request.bone, why: 'explicit rotation-only waist follows the original lower frame without driving its source' }] },
    skins: { default: { ...output.rig.skins.default, [request.bottom]: { ...output.rig.skins.default[request.bottom], [request.bottom]: pivot.mesh } } } },
    meshReport: output.meshReport.map((row) => row.part !== request.bottom ? row : { ...row, vertices: pivot.mesh.weights.length, triangles: pivot.mesh.triangles.length / 3, hull: pivot.mesh.hull, bones: [request.bone, request.lower].sort(), max_influences: Math.max(...pivot.mesh.weights.map((ws) => ws.length)), mean_influences: pyRound(pivot.mesh.weights.reduce((n, ws) => n + ws.length, 0) / pivot.mesh.weights.length, 2) }) };
}

/** Explicit supplied-output stage. The bottom, existing graph, art and motion remain identical. */
export function withWaistSharedCopy<T extends Pick<RigOutput, 'rig' | 'motion' | 'images' | 'meshReport'>>(output: T, request: WaistPivotRequest): T {
  const top=output.rig.skins.default[request.top]?.[request.top],bottom=output.rig.skins.default[request.bottom]?.[request.bottom];
  const topImage=output.images.find(([name])=>name===top?.image)?.[1],bottomImage=output.images.find(([name])=>name===bottom?.image)?.[1];
  const refuse=(code:string,detail:string):never=>{throw new PartsError([{code,object:'shared waist copy',detail}]);};
  if(top===undefined||!('type'in top)||bottom===undefined||!('type'in bottom)||!topImage||!bottomImage)refuse('RIG_WAIST_COPY_SOURCE',`original paired meshes and images "${request.top}"/"${request.bottom}" required`);
  const W=output.rig.bones.find(b=>b.name===request.bone),c=output.rig.constraints?.find(c=>c.name===request.constraint),props=c?.properties as Record<string,{to?:Record<string,unknown>}>|undefined;
  if(!W||W.parent!==request.upper||!c||output.rig.constraints?.length!==1||c.type!=='transform'||c.source!==request.lower||JSON.stringify(c.bones)!==JSON.stringify([request.bone])||!props?.rotate?.to?.rotate||Object.keys(props).join()!=='rotate'||Object.keys(props.rotate.to).join()!=='rotate'||(c.mixRotate??1)!==1||['mixX','mixY','mixScaleX','mixScaleY','mixShearY'].some(k=>(c[k]??0)!==0)||c.localSource===true||c.localTarget===true||c.additive===true||output.rig.stops!==undefined)refuse('RIG_WAIST_COPY_FRAME','requires the existing upper-parented, world rotate-only waist frame; no graph or motion rewrite');
  refuseSharedWaistMotion(output.motion, request.top, request.bone);
  const copy=sharedWaistCopy(top as MeshAttachment,alphaAbove(topImage!,ART_ALPHA),alphaAbove(bottomImage!,ART_ALPHA),output.rig.bones,request);
  return {...output,rig:{...output.rig,skins:{...output.rig.skins,default:{...output.rig.skins.default,[request.top]:{...output.rig.skins.default[request.top],[request.top]:copy.mesh}}}},meshReport:output.meshReport.map(row=>row.part!==request.top?row:{...row,vertices:copy.mesh.weights.length,triangles:copy.mesh.triangles.length/3,hull:copy.mesh.hull,bones:[...new Set(copy.mesh.weights.flatMap(ws=>ws.map(w=>w.bone)))].sort(),max_influences:Math.max(...copy.mesh.weights.map(ws=>ws.length)),mean_influences:pyRound(copy.mesh.weights.reduce((sum,ws)=>sum+ws.length,0)/copy.mesh.weights.length,2)})};
}

/** Reuse the accepted pair, pivot and shared-copy stages only on an explicit declaration. */
export function buildRig(...input: Parameters<typeof buildWaistPairSource>): RigOutput {
  const [cfg, parts] = input;
  const declaration = cfg.waist;
  if (declaration === undefined) return buildWaistPairSource(...input);
  const refuse = (detail: string): never => { throw new PartsError([{ code: 'RIG_WAIST_DECLARATION', object: 'config.waist', detail }]); };
  const top = parts.parts.find((p) => p.name === declaration.top), bottom = parts.parts.find((p) => p.name === declaration.bottom);
  if (top === undefined || bottom === undefined || tagOf(top.from) !== 'topwear' || tagOf(bottom.from) !== 'bottomwear') refuse(`requires topwear mesh "${declaration.top}" and rigid bottomwear "${declaration.bottom}" with matching source provenance`);
  if (parts.alternates?.length || cfg.assemble.alternates?.length || top!.limb !== undefined || bottom!.limb !== undefined) refuse('the accepted construction requires one base drawing pair without alternate or limb-owned replacements');
  const source = buildWaistPairSource(...input);
  const paired = source.rig.skins.default[declaration.bottom]?.[declaration.bottom];
  if (paired === undefined || !('type' in paired) || waistBottomLayoutOf(paired) === undefined) refuse(`the declared pair "${declaration.top}"/"${declaration.bottom}" did not produce a shared two-bone distance field`);
  const binding = regionBone(cfg.regions[declaration.bottom]);
  const meshSpec = cfg.meshes[declaration.top];
  const named = meshSpec?.segments.map((segment) => typeof segment === 'string' ? segment : segment[0]);
  if (binding !== declaration.lower || named === undefined || named.length !== 2 || !named.includes(declaration.lower) || !named.includes(declaration.upper)) refuse(`requires exactly the declared upper/lower segment bones "${declaration.upper}"/"${declaration.lower}" and the bottom bound to lower`);
  const request: WaistPivotRequest = { ...declaration, topOrigin: [top!.x - PAD, top!.y - PAD], bottomOrigin: [bottom!.x - PAD, bottom!.y - PAD], canvas: parts.rig_size };
  return withWaistSharedCopy(withWaistPivot(source, request), request);
}

/** Imported tracks cannot silently change the accepted shared frame or its old-topology deforms. */
function refuseSharedWaistMotion(motion: MotionSpec, top: string, bone: string): void {
  const refuse = (code: string, detail: string): never => { throw new PartsError([{ code, object: 'shared waist copy', detail }]); };
  const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
  for(const [animation,entry]of Object.entries(motion.animations)){
    const value:unknown=entry;
    if(record(value)&&Array.isArray(value.deform))for(const track of value.deform){
    if(!record(track)||String(track.skin??'default')!=='default'||track.slot!==top||track.attachment!==top||!Array.isArray(track.keys))continue;
    for(const key of track.keys)if(record(key)&&(key.transform!==undefined||(key.vertices!==undefined&&key.vertices!==null&&(!Array.isArray(key.vertices)||key.vertices.some(v=>typeof v!=='number'||!Number.isFinite(v)||v!==0)))))refuse('RIG_WAIST_COPY_DEFORM',`animation "${animation}" top deform at ${String(key.t)} has no proved per-bone transfer into the new waist support; retain its original numeric field or supply a representable composition`);
    }
  }

  for (const [animation, entry] of Object.entries(motion.animations)) {
    const value: unknown = entry;
    if (record(value) && Array.isArray(value.tracks) && value.tracks.some((track) => record(track) && track.bone === bone)) refuse('RIG_WAIST_MOTION', `animation "${animation}" drives generated waist bone "${bone}"; original tracks must retain their authored targets`);
  }
}
