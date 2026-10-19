/**
 * The propose stage: bone origins, mesh candidate lists, regions and a default
 * idle, read off the assembled parts — and the overlay a person or an agent
 * corrects them against.
 *
 * ⭐ **Roles come from each part's See-through tag** (`parts.json` `from`),
 * never from the part's name. A plan may call the skirt layer anything; what
 * makes it the skirt is that it came from `bottomwear`. The rules, by tag:
 *
 * - `face` (head run first) -> `hip`/`chest`/`neck`/`head` — with no face
 *   part, a box derived from the head run's `front hair`/`back hair` and
 *   `neck`, said in a note (issue #76); `eyewhite-r/-l`
 *   -> `eye_r`/`eye_l`, the blink's `eyes` group — no eyewhite, no blink, and
 *   no eyebrow, no `brows` in it, each said in a note (issue #35); `irides-*`
 *   and `eyelash-*` ride their side's eye bone, or `head` with a note when
 *   that side has no eyewhite (issue #45); `mouth` -> `mouth` at the centroid of its biggest blob
 *   (stray pixels inflate a box); `eyebrow-*` -> `brow_r`/`brow_l` by POSITION
 *   left or right of the eye axis, never by tag, because the head run has been
 *   observed to swap the two brow tags.
 * - `bottomwear` -> `hip` at its top edge + three skirt chains — unless that
 *   hip would sit above `HIP_MIN_FRACTION` of the figure's height (a long
 *   robe tagged `bottomwear` starts at the collar): then `hip` is the waist,
 *   the narrowest torso row between the shoulder line and the figure's
 *   middle, and 0.32 of the figure height when no row narrows enough. With
 *   `cloth.bottomwear.part` naming a dress (issue #402), a `bottomwear` part
 *   lying on the dress's tree links rides them (issue #416), by the rule a
 *   layer on a tail does (below), and gets no trees of its own.
 * - `topwear` -> two outer-robe chains, only when it hangs below the hip line;
 *   a side whose link falls off the art is dropped.
 * - `handwear-*` -> two blobs: one sleeve chain per blob, its mesh taking that
 *   chain and nothing else (issue #347: a chest stub at the shoulder pinned the
 *   puff to the torso, so the part stretched when the chain turned; without it the
 *   part rides its chain rigidly); one blob: both chains and the chest
 *   midline, split at the eye axis — unless the blob is clasped hands (at the
 *   axis and at most half the shoulders' width), which ride `hip` as a region.
 * - `front hair` -> three fringe chains + one lock chain per strand that hangs
 *   0.3 face heights below the chin. The fringe chains are the reference's
 *   template turned into the head's frame (issue #249): columns along the
 *   eye line's perpendicular ({@link headRollOf}), each rooted on the part's
 *   own art, and a note saying they are a template, not the part's locks.
 * - `back hair` -> one `bun` bone if it ends above the shoulders, else two
 *   hanging chains.
 * - `headwear` / `earwear` -> the biggest layer of the tag gets a rigid bone
 *   and a pendant chain where the part narrows (dropped if any chain point is
 *   off the art); any other layer of the tag rides the head as a region. A
 *   layer with hanging strands ({@link Strand}) gets one pendulum chain per
 *   strand instead of the single pendant chain, and one note naming every
 *   strand and what became of it — a strand left without a chain is never
 *   silent (issue #24). Under the `back hair` cloth recipe (issue #391) a
 *   layer of either tag lying on a drafted tail rides the links it overlaps
 *   instead: its pixels over the tail's art are each given to the nearest span
 *   of the back hair's mesh (`tailOverlap`, `src/cloth.ts`), and when one is a
 *   link the part's mesh takes those spans as its segments and no rule above
 *   runs for it; a note names each span with its pixel count.
 * - anything no rule claims rides its nearest trunk bone as a region —
 *   including every part from an author-made layer (`<run>:author:<label>`,
 *   issue #256), which is no See-through tag and so has no role: no rule
 *   reads it, and its note says the bone is the config's to name — and
 *   every `painting:` patch (`assemble.patches`), which has no tag,
 *   so no rule above ever reads it: it is never a mesh or a chain, it moves
 *   no bone the rules place, and the note says the bone is the config's to
 *   name in `regions.<name>`. A cut's piece (`assemble.cuts`, recorded with
 *   `cut_from`) goes the same way (issue #230): it shares its base's tag, and
 *   the rules that run once per part of a tag would name the base's bones and
 *   chains a second time. The one exception is the sleeve rule, which names
 *   its chains by side and takes a cut sleeve as a blob of its own (#199). A
 *   `parts.json` sharing a layer between parts with no `cut_from` (an
 *   assemble before 1.6.0) is refused, `PROPOSE_CUT_FROM_RECORDED`.
 *
 * What it cannot know is written into `notes` when it guessed, and otherwise
 * left to the person correcting: things hidden inside a layer (a sash tail
 * painted into the skirt), hair that is none of the shapes above, whether an
 * accessory swings.
 *
 * Port of the reference `landmarks.py` (`propose`, `expand`, `lint`,
 * `compare`, `draw`). Every rule, constant and evaluation order is the
 * reference's, including three Python behaviours `src/pyfmt.ts` reproduces
 * (`round` to even, `or` treating 0.0 as missing, negative slice starts).
 * Seven departures, each stated where it happens: a missing face is refused
 * rather than crashing — unless the head run's hair and neck are there, when
 * the face box is derived from them by measured ratios and a note says so
 * (issue #76, {@link faceBoxOf}); the eye regions are keyed by the eyewhite
 * part's own name rather than by the literal `eyewhite_r`; the long-robe hip,
 * the clasped-hands region (issues #22, #23), an eyeless side's irides and
 * lashes on `head` (issue #45) and the face-less fallback, which fire on
 * neither published example — both proposals are byte-identical with and
 * without them; and `lint`'s two torso lines, which the reference did not
 * have. An eighth is opt-in and the reference had nothing like it: external
 * keypoints (`propose --keypoints`, issue #75, `src/keypoints.ts`). Given a
 * person's joints, a joint with a position places `neck`, `hip` (the midpoint
 * of the two hip joints), the chest (its rule, along neck -> hip) and each
 * sleeve chain (shoulder -> elbow, tip at the wrist) as given; a joint without
 * one leaves the bone to the rule above, and a note per joint says which. The
 * eye bones, `head` and the face box are measurements off the parts and are
 * never moved by a joint. `lint` then reads the torso and the sleeves by the
 * relations the joints declare instead of by screen y. Without joints every
 * value, note and LINT line is the one written before the option existed.
 * One rule runs only with joints (issue #241): a `legwear` part holding the
 * ankle of a leg whose hip, knee and ankle are given is meshed on a leg chain
 * (hip -> knee, tip at the ankle; one per leg, or one through the midpoints
 * when the part's art does not separate the legs — {@link legsFromJoints}),
 * where without them it rides `hip` as a region. And with a joint at either
 * end of the trunk (issue #243), the trunk parts' fixed segments run along
 * neck -> hip, the line the chest is placed on, instead of down the screen
 * ({@link trunkLineOf}).
 * One departure moves every published proposal, the reference's own two
 * included (issue #249): the reference stood the fringe's three columns on
 * the page and rooted them 13 px below the part's box, which on a tilted head
 * put them on a hat above the hair and across the locks; here they stand in
 * the head's frame and are rooted 13 px below the art on each column, and
 * `lint` names a fringe link that does not lean with the head.
 *
 * The idle departs from the reference's too (issue #252): it is
 * {@link IDLE_FRAMES} frames at 12 fps rather than 4 s, every period scaled
 * with it, and the chest's breath travels {@link BREATH_FRACTION} of the torso's
 * length, neck to hip ({@link breathTrack}; issue #270), rather than a fixed 1.3 px amplitude, so
 * no tracked proposal is the reference's output any more in its `motion`.
 *
 * Issue #86 adds what the proposer and lint looked at, and changes nothing
 * they wrote: {@link proposeWithBasis} records, at each placement, what the
 * bone rests on ({@link BoneBasis}; `basis.json`, `src/diagnostics.ts`), and
 * {@link lint} returns per bone which checks read it or why none did
 * ({@link BoneCoverage}), with the roles `src/structure.ts` derives.
 *
 * Coordinates are rig pixels, y down, origin top-left — the parts' own space.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { drawText, GLYPH_H } from 'rig-c/tools/font5x7.ts';
import { type BoneEntry, type ConfigConstraint, type ConfigStop, contourRegionsOf, deriveBustRegions, type Limb, type MeshSpec, parseConfig, type Point, type Segment, type SkeletonSections } from './config.ts';
export { contourRegionsOf, deriveBustRegions };
import { computeExactFrameTransforms, cropToSpineY, normaliseDegrees, toWorld } from './coords.ts';
import { PartsError, type Problem, refuseIfAny } from './errors.ts';
import { eyeLineDegrees, type FrameFeature, headAxes, type HeadAxes, headFrame, type HeadFrame } from './headframe.ts';
import { type LayerSet, OPAQUE_ALPHA_ABOVE } from './layers.ts';
import { PAINTING_RUN, type PartRecord, type PartsFile, readParts } from './parts.ts';
import { connectedComponents } from './raster/components.ts';
import { dilate, morphGradient } from './raster/morph.ts';
import { readPng } from './raster/png.ts';
import { resize } from './raster/resize.ts';
import { type Mask, newMask, newRaster, type Raster } from './raster/types.ts';
import { npMean, npMedian, npPercentile, pyFixed, pyInt, pyIntList, pyRepr, pyRound, pyStrList } from './pyfmt.ts';
import type { JointState, RigJoint, RigJoints } from './keypoints.ts';
import { IDLE_FPS } from './motion.ts';
import { influenceFarthest } from './rig.ts';
import { type Segment as WeightSegment } from './weights.ts';
import { pyRound as roundTo } from './round.ts';
import { KEYPOINT_NAMES, type KeypointName } from './skeleton.ts';
import { configRoles, type RoleOf } from './structure.ts';
import { AUTHOR_NO_ROLE, isAuthorTag } from './tags.ts';
import { TURN_BONE, TURN_CARRIER_TAG, TURN_PLACES, TURN_RIDER_OFFSET, TURN_RIDER_TAGS, turnFractions, turnNearest, turnPivot, turnRiderDepth, type TurnSpec } from './turn.ts';
import { edgeLength } from './length.ts';
import { bonePlaces, jointLine, limbCrossing, limbPolyline, limbRun, limbWidth, nearestLimb, nearestOnLine, offLineFigure, type Pt } from './limbs.ts';
import { type BranchSqueezeFinding, branchSqueezes, chainSqueezes, type SqueezeFinding } from './squeeze.ts';
import { backHairMasses, type BackHairMass, backHairMassTrees, INFLUENCE_RADIUS_CELLS, RECIPE_BACK_HAIR_CHAINS, RECIPE_LENGTH_RATIO, chainConstraints, clothNote, type ClothRecipe, type ClothRecipes, type ClothTarget, CLOTH_TARGETS, draftTrees, spanCrosses, swingName, type Tail, tailOverlap, type TailOverlap, type TailSpan, treeConstraints, type TreeChain, type TreeInput, type TreeMassInput } from './cloth.ts';
import { TEXTURE_STRETCH_CEILING } from './check.ts';

// ---------------------------------------------------------------------------
// the output shape — config-shaped, key order as the reference writes it
// ---------------------------------------------------------------------------

export interface ProposedSingleTrack {
  bone: string;
  prop: 'rotate' | 'translatey' | 'scalex';
  amp: number;
  period: number;
  phase: number;
  base?: number;
}

export interface ProposedChainTrack {
  chain: string;
  amps: number[];
  period: number;
  phase: number;
  lag: number;
}

/** `brows` and `brow_drop` are absent together when no eyebrow part exists: rigc refuses a group with no members. */
export interface ProposedBlink {
  t: number;
  eyes: string[];
  brows?: string[];
  squash: number;
  brow_drop?: number;
  still?: Record<string, { row: number; bone: string }>;
}

/** The tags whose parts make the eye bones, the blink's `eyes` group. Nothing else does: irides and lashes ride those bones as regions, or `head` on a side with none. */
export const EYE_GROUP_TAGS: readonly string[] = ['eyewhite-r', 'eyewhite-l'];
/** The tags whose parts make the brow bones, the blink's `brows` group. */
export const BROW_GROUP_TAGS: readonly string[] = ['eyebrow-r', 'eyebrow-l'];

/**
 * The drafted idle's length, in frames at {@link IDLE_FPS} (issue #252): 40
 * frames, 40/12 s. The reference drafted a 4 s idle; HQ calibrated the breath
 * over 40 frames at 12 fps, and a duration of a whole number of frames is what
 * `check`'s loop compares frame 0 with (issue #244).
 */
export const IDLE_FRAMES = 40;
/** {@link IDLE_FRAMES} in seconds: 3.3333333333333335 as a double, the time rigc's last frame is read at within `TIME_SLACK`. */
export const IDLE_SECONDS = IDLE_FRAMES / IDLE_FPS;
/**
 * The idle the reference drafted, in seconds. Every drafted track's period is
 * written against it (4 s: one cycle per idle; 2 s: two) and scaled by
 * `IDLE_SECONDS / REFERENCE_IDLE_SECONDS` when the proposal is returned, so
 * each keeps its number of cycles per idle — the loader refuses a period that
 * does not divide the idle (`CONFIG_PERIOD_DIVIDES_DURATION`). The scale is
 * 10/12 = 0.8333333333333334, and 4 and 2 times it are 40/12 and 20/12 to the
 * last bit, since only a power of two multiplies it.
 */
export const REFERENCE_IDLE_SECONDS = 4;
/**
 * The breath's travel, peak to peak, as a fraction of the torso (issue #252):
 * HQ's calibration, about 2.5 %. Issue #252 took the torso as the `topwear`
 * part's height; on the trailer's seated character that is 267 px, and the
 * reference's fixed 2.6 px peak to peak (amplitude 1.3, the base 1.3 so the
 * chest rises from its setup pose and returns) was 0.97 % of it, read by its
 * owner as a still paper doll; the production scene rig that replaced it
 * breathes 6.4 px, 2.4 %. Issue #270 measures the torso as the trunk the rig
 * has instead — the neck bone to the hip bone, {@link breathTrack} — because a
 * garment's box is not the body: `scarf`'s sweater runs to the thighs (690 px)
 * and breathed 2.9 times as deep as `demo`.
 */
export const BREATH_FRACTION = 0.025;
/** The breath's amplitude the reference drafted on every figure, kept only where the trunk has no length to scale by. */
export const REFERENCE_BREATH_AMP = 1.3;

/**
 * How a drafted lattice's spacing (`meshes.<part>.grid`) is chosen (issue #265):
 *
 * - `figure`, the default: one spacing for the figure, `round(H / FIGURE_GRID_DIVISOR)` rig px, H the height of the
 *   union of every part's box in parts.json ({@link figureGrid}); a part whose own spacing (the `part` rule) is
 *   already coarser keeps its own. `r` is the `part` rule's either way, so the weights a vertex would take at a point
 *   do not move, only where the vertices are.
 * - `part`: the reference implementation's rule, a tenth of the part's own short side, clamped to 5..36. The
 *   oracle examples (`reference-demo`, `reference-sample`) are proposed under it, because their `proposal.json` holds
 *   this proposer to the reference's.
 */
export type GridRule = 'figure' | 'part';
export const GRID_RULES: readonly GridRule[] = ['figure', 'part'];
export const DEFAULT_GRID_RULE: GridRule = 'figure';

/**
 * The divisor of the figure's spacing: Stage A of issue #265 (docs/evidence/density-survey.md) built every lattice
 * of demo, scarf and the public trailer at round(H / c) for c in {26, 37, 52}; 37 is the coarsest at which every
 * `check` bar passed on all three (c 26 failed scarf's TIP_OVER_ROOT). Calibrated on those three figures only, all
 * of similar size (H 1106, 1108 and 1185 rig px).
 */
export const FIGURE_GRID_DIVISOR = 37;

/** The largest idle displacement Stage A measured at {@link FIGURE_GRID_DIVISOR} against each example's finer lattice, rig px (the trailer's hairpin), which no `check` bar reads. */
export const FIGURE_GRID_IDLE_PX = 1.427;

/** The figure's spacing: the union of every part's box in parts.json, its height H, and round(H / {@link FIGURE_GRID_DIVISOR}). */
export function figureGrid(recs: readonly PartRecord[]): { top: number; bottom: number; height: number; grid: number } {
  const top = Math.min(...recs.map((r) => r.y));
  const bottom = Math.max(...recs.map((r) => r.y + r.h));
  const height = bottom - top;
  return { top, bottom, height, grid: pyInt(pyRound(height / FIGURE_GRID_DIVISOR)) };
}

/** The `part` rule's spacing and the weight falloff `r` both rules draft (the reference's). */
export function partGrid(p: { w: number; h: number }): [number, number] {
  const g = pyInt(Math.min(36, Math.max(5, pyRound(Math.min(p.w, p.h) / 10))));
  return [g, Math.max(3, pyInt(pyRound(g * 0.42)))];
}

export interface Proposal {
  bones: BoneEntry[];
  meshes: Record<string, MeshSpec>;
  regions: Record<string, string>;
  /** Only under `--keypoints`, where an arm or a leg is drafted from its joints (issue #349): absent otherwise, so a proposal without one is the one written before it. */
  limbs?: Record<string, Limb>;
  motion: {
    duration: number;
    tracks: Array<ProposedSingleTrack | ProposedChainTrack>;
    /** Absent when no part feeds the `eyes` group ({@link EYE_GROUP_TAGS}): a blink with nothing to blink is not written. */
    blink?: ProposedBlink;
  };
  /** Only with `propose --cloth` (issue #364, `src/cloth.ts`): the physics (and a skirt swing's transforms) of the trees it drafted; absent otherwise, so a proposal without it is the one written before it. */
  constraints?: ConfigConstraint[];
  /** Only with `propose --full`/`--head` (issue #251, {@link draftTurn}); absent otherwise, so a proposal without them is the one written before it. */
  turn?: TurnSpec;
  /** The `assemble.rig_scale` (`parts.json`'s `scale_rig_per_source`) its coordinates were drafted at (issue #354). */
  proposed_rig_scale: number;
  notes: string[];
}

/**
 * Every section of a proposal that is a config section, in the order the
 * proposal writes them: what an author copies into the config (issue #375).
 * `notes` is the proposal's own and is copied nowhere. Three of them are written
 * only on request — `limbs` under `--keypoints`, `constraints` under `--cloth`,
 * `turn` under `--full`/`--head` — and a `limbs` block left behind is refused
 * at the next step, by the name of every part it cuts. {@link checkProposal} reads
 * the proposal through the config loader by this list, the type below refuses a
 * {@link Proposal} key it does not hold, and the selftest's `TY18` holds every
 * paste sentence in the documents to it.
 */
export const PROPOSAL_CONFIG_SECTIONS = ['bones', 'meshes', 'regions', 'limbs', 'motion', 'constraints', 'turn', 'proposed_rig_scale'] as const satisfies ReadonlyArray<Exclude<keyof Proposal, 'notes'>>;

/** A {@link Proposal} key that is neither `notes` nor in {@link PROPOSAL_CONFIG_SECTIONS}; `never` while the list is whole. */
type UnlistedProposalSection = Exclude<keyof Proposal, 'notes' | (typeof PROPOSAL_CONFIG_SECTIONS)[number]>;

/** Fails to type-check, naming the key, when a section is added to {@link Proposal} and not to the list. */
export const PROPOSAL_SECTIONS_LISTED: [UnlistedProposalSection] extends [never] ? true : UnlistedProposalSection = true;

// ---------------------------------------------------------------------------
// what each proposed bone rests on (issue #86)
// ---------------------------------------------------------------------------

/**
 * What a placement rests on, in four kinds:
 *
 * - `joint`: a coordinate supplied from outside — a keypoint file's joint
 *   (`--keypoints`), recorded with its state, its `listed` flag and its score
 *   exactly as the file declared them, and its position in rig px through the
 *   overlay's map;
 * - `mask`: a measurement off a part's opaque pixels or its box (which part,
 *   which measure);
 * - `ratio`: a rule of proportion — a share of the face box, of the figure's
 *   height or of a part's — with each constant that sets the value;
 * - `derived`: computed from other bones' positions alone (which bones).
 *
 * A placement that also reads a constant or another bone names those too; the
 * kind is what the value is read off. No confidence is computed for any of
 * them, and no kind is a judgement of quality.
 */
export type BasisKind = 'joint' | 'mask' | 'ratio' | 'derived';

export const BASIS_KINDS: readonly BasisKind[] = ['joint', 'mask', 'ratio', 'derived'];

/** The frame quantities several rules read, described once in the basis file's `frame`. */
export type FrameKey = 'face_box' | 'eye_axis' | 'eye_line' | 'figure' | 'torso';

export const FRAME_KEYS: readonly FrameKey[] = ['face_box', 'eye_axis', 'eye_line', 'figure', 'torso'];

/** A joint a placement used, as the keypoint file declared it; `at` is rig px (the overlay's map applied). */
export interface BasisJoint {
  name: KeypointName;
  state: JointState;
  listed: boolean;
  /** The producer's score, when the file carried one; `null` when it did not. Never computed here. */
  score: number | null;
  at: [number, number];
}

export interface BasisConstant {
  name: string;
  value: number;
}

/** One coordinate pair's basis: an origin's, or a tip's. Key order is the file's. */
export interface Placement {
  kind: BasisKind;
  rule: string;
  parts: string[];
  joints: BasisJoint[];
  bones: string[];
  frame: FrameKey[];
  constants: BasisConstant[];
  /** The stand-in a rule took because what it reads was empty, or `null` when none was taken. */
  fallback: string | null;
}

/** One proposed bone (a chain link is a bone): what its origin rests on and, where the proposal states its tip, what that rests on. */
export interface BoneBasis {
  bone: string;
  /** The bone entry it came from: its own name, or the chain it is a link of. */
  entry: string;
  origin: Placement;
  /** `null` when the proposal states no tip of its own for this bone: a single bone without `tip`, or a chain link that is not the last (its tip is the next link's origin). */
  tip: Placement | null;
}

/** How a frame quantity was reached, and off which parts. */
export interface FrameBasis {
  rule: string;
  parts: string[];
}

/** What `propose` records beside the proposal: the frame quantities and one record per proposed bone, in the proposal's bone order. */
export interface ProposalBasis {
  frame: Record<FrameKey, FrameBasis>;
  bones: BoneBasis[];
}

function placement(kind: BasisKind, rule: string, o: Partial<Omit<Placement, 'kind' | 'rule'>> = {}): Placement {
  return { kind, rule, parts: o.parts ?? [], joints: o.joints ?? [], bones: o.bones ?? [], frame: o.frame ?? [], constants: o.constants ?? [], fallback: o.fallback ?? null };
}

function konst(name: string, value: number): BasisConstant {
  return { name, value };
}

/**
 * The `assemble` section {@link checkProposal} hands the loader, rebuilt from
 * parts.json: every See-through part a plan entry or a cut, every patch a
 * patches entry. Exported so a control can read which part went back as the
 * plan part and which as the piece (issue #230).
 */
export function proposalAssemble(P: PartSet): Record<string, unknown> {
  P = P.beforeLimbs();
  // A patch is not a plan entry; it goes back as the patches entry it came
  // from, so the loader holds it to its own rule (a region, never a mesh).
  // Its box, alpha and draw are the record's own box and placeholders the
  // loader only type-checks: nothing here is written anywhere.
  // A part that shares another's `from` is the piece of an `assemble.cuts`
  // entry (issue #170) — the only way two parts share a layer — and goes back
  // as a cut of its base, its polygon the record's box, a placeholder the
  // loader only type-checks like the patches' fields. The piece names its base
  // (`cut_from`, issue #230); file order cannot, as a piece drawn "back" comes
  // before its base. A file with an unmarked shared layer (an assemble before
  // 1.6.0, which propose refuses) goes back with the first part of the layer
  // as the plan part, as it did before the field.
  const run = P.recs.filter((r) => splitFrom(r.from)[0] !== PAINTING_RUN);
  const painted = P.recs.filter((r) => splitFrom(r.from)[0] === PAINTING_RUN);
  const firstOf = new Map<string, string>();
  for (const r of run) if (r.cut_from === undefined && !firstOf.has(r.from)) firstOf.set(r.from, r.name);
  const baseOf = (r: PartRecord): string => r.cut_from ?? (firstOf.get(r.from) as string);
  const planned = run.filter((r) => r.cut_from === undefined && firstOf.get(r.from) === r.name);
  const pieces = run.filter((r) => r.cut_from !== undefined || firstOf.get(r.from) !== r.name);
  return {
    rig_scale: P.rigScale,
    plan: planned.map((r) => [r.name, ...splitFrom(r.from)]),
    patches: painted.map((r) => ({ name: r.name, box: [r.x, r.y, r.x + r.w, r.y + r.h], alpha: 'box', draw: 'front' })),
    ...(pieces.length === 0
      ? {}
      : {
          cuts: pieces.map((r) => ({
            from: baseOf(r),
            into: r.name,
            polygon: [
              [r.x, r.y],
              [r.x + r.w, r.y],
              [r.x + r.w, r.y + r.h],
            ],
            draw: 'front',
            overlap: 0,
          })),
        }),
  };
}

/**
 * Hold the proposal to the config contract before it is written: it is copied
 * into a config field by field, so a proposal the loader would refuse is a
 * wrong file waiting to be pasted. The plan the loader needs is the parts
 * themselves — `[name, run, tag]` from each part's `from` — so every part must
 * come out as exactly one mesh or one region, every name must resolve, and
 * every chain track must carry one amplitude per link. Throws the loader's own
 * refusals.
 */
export function checkProposal(P: PartSet, p: Proposal): void {
  const sections: Record<string, unknown> = {};
  for (const k of PROPOSAL_CONFIG_SECTIONS) if (p[k] !== undefined) sections[k] = p[k];
  parseConfig({ key: 'proposal', assemble: proposalAssemble(P), ...sections });
}

/** Fixed key order, two-space indent, trailing newline: the same inputs write the same bytes. */
export function serializeProposal(p: Proposal): string {
  return `${JSON.stringify(p, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// the turn control (issue #251)
// ---------------------------------------------------------------------------

/** The See-through runs `propose --full/--head` reads depths from, by run. */
export type TurnRuns = Partial<Record<'full' | 'head', LayerSet>>;

/**
 * Draft `turn` (issue #251, `src/turn.ts`) from the parts and the See-through
 * runs they came from: each carrier's depth is its layer's `depth_median` —
 * the layer of the run its part was assembled from, named by its tag, a cut's
 * piece its base's — and the pivot is {@link turnPivot} over the parts'
 * `opaque_px`. A `painting:` patch has no layer and so no depth: it is not
 * carried, and a note names it. What a depth cannot be read for is refused by
 * name, every one at once:
 *
 * - `PROPOSE_TURN_RUN_GIVEN`: a part from a run whose layers were not given.
 * - `PROPOSE_TURN_LAYER_PRESENT`: the run given holds no layer of the part's tag.
 * - `PROPOSE_TURN_DEPTH_PRESENT`: the layer carries no depth (a PSD carries none).
 *
 * A rider (issue #271, {@link TURN_RIDER_TAGS}: the eye group, nose, mouth)
 * does not carry its own median: it takes the face part's, offset by
 * {@link turnRiderDepth} by draw order. With no face part, or more than one,
 * the riders keep their own medians and a note says so. Every other layer is
 * its own carrier.
 *
 * With no part to carry, or every carried part at one depth (nothing nearer
 * than the pivot), no `turn` is drafted and a note says why. Otherwise one note
 * states the pivot and its rule, the law, and every part's fraction with the
 * depth it came from; one lists where each depth came from; and one line names
 * each carrier the other run places more than {@link TURN_RUN_APART} of the
 * span away.
 */
export function draftTurn(P: PartSet, runs: TurnRuns): { turn: TurnSpec | null; notes: string[] } {
  P = P.beforeLimbs();
  const problems: Problem[] = [];
  const read: Array<{ part: string; run: 'full' | 'head'; tag: string; base: string | null; own: number; area: number; order: number; piece: boolean }> = [];
  const patches: string[] = [];
  const unread = new Map<string, string[]>();
  const depthless: Array<{ part: string; from: string; set: LayerSet }> = [];
  P.recs.forEach((r, order) => {
    const [run, tag] = splitFrom(r.from);
    if (run === PAINTING_RUN) {
      patches.push(r.name);
      return;
    }
    const set = run === 'full' || run === 'head' ? runs[run] : undefined;
    if (set === undefined) {
      unread.set(run, [...(unread.get(run) ?? []), r.name]);
      return;
    }
    const layer = set.layers.find((l) => l.name === tag);
    if (layer === undefined) {
      problems.push({ code: 'PROPOSE_TURN_LAYER_PRESENT', object: `part "${r.name}" (${r.from})`, detail: `came from the ${run} run's "${tag}" layer, and ${set.source} holds no layer of that name; the run its parts were assembled from is required` });
      return;
    }
    if (layer.depth === null) {
      depthless.push({ part: r.name, from: r.from, set });
      return;
    }
    read.push({ part: r.name, run: run as 'full' | 'head', tag, base: 'base' in layer.tag ? layer.tag.base : null, own: layer.depth, area: r.opaque_px, order, piece: r.cut_from !== undefined });
  });
  for (const [run, names] of unread) {
    problems.push({ code: 'PROPOSE_TURN_RUN_GIVEN', object: `the ${run} run`, detail: `part(s) ${names.map((n) => `"${n}"`).join(', ')} came from it and its layers were not given; --${run} <dir | layers.json> is required to read their depth` });
  }
  // Issue #359: runs that carry no depth at all (a PSD, or an export of one) are skipped by name, never passed and never
  // given an invented depth; a run where some parts' layers carry one and others do not is refused part by part.
  if (problems.length === 0 && read.length === 0 && depthless.length > 0) {
    const sources = [...new Set(depthless.map((d) => d.set.source))];
    return { turn: null, notes: [`turn: SKIP — ${sources.join(', ')} carr${sources.length === 1 ? 'ies' : 'y'} no depth_median (${[...new Set(depthless.map((d) => (d.set.form === 'psd' ? 'a PSD carries none' : 'null on every layer')))].join('; ')}), so no turn control is drafted from ${depthless.length} part(s); the turn orders parts by See-through's per-layer depth, and none was measured — a config.turn written by hand sets one`] };
  }
  for (const d of depthless) {
    problems.push({ code: 'PROPOSE_TURN_DEPTH_PRESENT', object: `part "${d.part}" (${d.from})`, detail: `its layer in ${d.set.source} carries no depth_median (a ${d.set.form} input) while other parts' layers carry one; the turn orders parts by See-through's per-layer depth, so a run that carries one for every part — or for none, which skips the turn — is required` });
  }
  refuseIfAny(problems);
  const notes: string[] = [];
  if (patches.length > 0) {
    notes.push(`turn: painting patch(es) ${patches.map((n) => `"${n}"`).join(', ')} carry no See-through depth and are not carried — each moves only as its bone does, as the pivot depth does; a value in config.turn.depths carries one`);
  }
  // Issue #271: the riders take the face's depth; everything else is its own carrier.
  // An author-made layer (issue #256) has no tag, so it is neither a rider nor the carrier: it carries itself at its own depth.
  const isRider = (x: { base: string | null }): boolean => x.base !== null && TURN_RIDER_TAGS.includes(x.base);
  const faces = read.filter((x) => x.base === TURN_CARRIER_TAG && !x.piece);
  const face = faces.length === 1 ? faces[0] : null;
  const riders = read.filter(isRider);
  if (riders.length > 0 && face === null) {
    notes.push(
      `turn: rider(s) ${riders.map((x) => `"${x.part}"`).join(', ')} keep their own See-through depth_median: ${faces.length === 0 ? `no part comes from a "${TURN_CARRIER_TAG}" layer` : `${faces.length} parts (${faces.map((x) => `"${x.part}"`).join(', ')}) come from a "${TURN_CARRIER_TAG}" layer, and which one carries them cannot be read off the parts`} — a value in config.turn.depths sets one`,
    );
  }
  const rows = read.map((x) => {
    if (face === null || !isRider(x)) return { ...x, depth: x.own, source: `own, ${x.run}:${x.tag}` };
    const above = x.order > face.order;
    return { ...x, depth: turnRiderDepth(face.own, above), source: `"${face.part}" ${above ? '-' : '+'} ${TURN_RIDER_OFFSET}, drawn ${above ? 'above' : 'under'} it; own ${x.run}:${x.tag} ${x.own}` };
  });
  const pivot = turnPivot(rows);
  const depths = Object.create(null) as Record<string, number>;
  for (const r of rows) depths[r.part] = r.depth;
  const nearest = turnNearest(depths);
  if (pivot === null || nearest === null) {
    notes.push('turn: no part carries a See-through depth with any opaque pixel, so no turn control is drafted');
    return { turn: null, notes };
  }
  if (!(pivot > nearest.depth)) {
    notes.push(`turn: every carried part lies at depth ${nearest.depth}, so none is nearer than the pivot and no turn control is drafted`);
    return { turn: null, notes };
  }
  const turn: TurnSpec = { pivot, depths };
  const fr = turnFractions(turn, rows.map((r) => r.part));
  notes.push(
    `turn: control "${TURN_BONE}" under root, keyed by nothing — its x is the dial. Pivot depth ${pivot}: the mean of the ${rows.length} carried parts' depths weighted by opaque_px, the one depth at which the painted pixels' centroid does not slide (correct it in turn.pivot). ` +
      `Each part travels (pivot - depth) / (pivot - ${nearest.depth}) of the control's x, "${nearest.part}" (nearest) all of it: ${fr.map((f) => `${f.part} ${f.fraction} (depth ${f.depth})`).join(', ')}`,
  );
  notes.push(`turn: where each depth came from — ${rows.map((r) => `${r.part} ${r.depth} (${r.source})`).join('; ')}`);
  // Issue #271: a carrier the other run places elsewhere is named; the run read stays the part's own.
  const span = pivot - nearest.depth;
  for (const r of rows) {
    if (isRider(r) && face !== null) continue;
    const other = r.run === 'full' ? 'head' : 'full';
    const there = runs[other]?.layers.find((l) => l.name === r.tag);
    if (there === undefined || there.depth === null || there.opaquePx === 0 || !(there.depth < 1)) continue;
    if (Math.abs(there.depth - r.own) > TURN_RUN_APART * span) {
      notes.push(`turn: "${r.part}" reads ${r.own} in the ${r.run} run and ${there.depth} in the ${other} run, more than ${TURN_RUN_APART * 100} % of the span ${roundTo(span, TURN_PLACES)} apart; the ${r.run} run it was assembled from is read`);
    }
  }
  notes.push(...TURN_DEPTH_CAVEAT);
  return { turn, notes };
}

/**
 * The share of the span (`pivot − nearest`) past which a carrier's two runs
 * are said to disagree: issue #271's judgment line, set before it was measured
 * (from #251's record). It only writes a note; the run read does not change.
 */
export const TURN_RUN_APART = 0.1;

/** The notes beside every drafted turn (issues #251, #271): what a See-through depth is, where it misleads, and that the two runs' axes are not reconciled. */
export const TURN_DEPTH_CAVEAT: readonly string[] = [
  "turn: depth is the See-through layer's median, a carrier's read from the run its part was assembled from and a rider's (eye group, nose, mouth) taken from the face; a seated or forward-reaching limb can read further back than it is (trailer legwear 0.770 sits behind the pivot)",
  "turn: the two runs' depth axes are not reconciled — a linear map cannot reconcile them, since the runs order the shared layers differently (parts#271)",
];

/** The proposal with `turn` written after `motion` and `notes` extended; the proposal itself when `turn` is null. */
export function withTurn(p: Proposal, draft: { turn: TurnSpec | null; notes: string[] }): Proposal {
  // Issue #349: a part a limb takes is not made; each of its limb parts carries its depth instead.
  let turn = draft.turn;
  if (turn !== null && p.limbs !== undefined) {
    const depths: Record<string, number> = {};
    const into = new Map<string, string[]>();
    for (const l of Object.values(p.limbs)) for (const sg of l.segments) into.set(sg.from, [...(into.get(sg.from) ?? []), sg.part]);
    for (const [part, d] of Object.entries(turn.depths)) {
      const parts = into.get(part);
      if (parts === undefined) depths[part] = d;
      else for (const q of parts) depths[q] = d;
    }
    turn = { pivot: turn.pivot, depths };
  }
  return { bones: p.bones, meshes: p.meshes, regions: p.regions, ...(p.limbs === undefined ? {} : { limbs: p.limbs }), motion: p.motion, ...(p.constraints === undefined ? {} : { constraints: p.constraints }), ...(turn === null ? {} : { turn }), proposed_rig_scale: p.proposed_rig_scale, notes: [...p.notes, ...draft.notes] };
}

// ---------------------------------------------------------------------------
// the parts, as masks
// ---------------------------------------------------------------------------

/** The assembled parts: `parts.json` plus `parts/<name>.png` beside it, every part as a full-canvas mask. */
export class PartSet {
  readonly W: number;
  readonly H: number;
  readonly rigScale: number;
  readonly recs: readonly PartRecord[];
  readonly images: ReadonlyMap<string, Raster>;
  private readonly masks = new Map<string, Mask>();
  private preLimbs: PartSet | null = null;

  constructor(file: PartsFile, images: ReadonlyMap<string, Raster>) {
    [this.W, this.H] = file.rig_size;
    this.rigScale = file.scale_rig_per_source;
    this.recs = file.parts;
    this.images = images;
  }

  /**
   * Parts whose `from` tag is exactly `tag`, optionally from one run, in
   * parts.json order. A `painting:` patch has no tag and is never one, and a
   * cut's piece (`cut_from`, issue #230) is not one either unless `pieces` is
   * set: it shares its base's layer, and a rule that runs once per part of a
   * tag would run for its base a second time — the same chains named twice.
   */
  byTag(tag: string, run?: 'full' | 'head', pieces = false): PartRecord[] {
    return this.recs.filter((p) => {
      const [r, t] = splitFrom(p.from);
      return r !== PAINTING_RUN && t === tag && (run === undefined || r === run) && (pieces || p.cut_from === undefined);
    });
  }

  /**
   * The layers more than one part holds with no `cut_from` to tell the piece
   * from its base: a `parts.json` an `assemble` before 1.6.0 wrote with
   * `assemble.cuts`. parts.json is in draw order and a piece drawn `"back"`
   * comes before its base, so which part takes the layer's rule cannot be
   * read off the file. Each entry is the layer and its parts, in file order.
   */
  unmarkedShares(): Array<{ from: string; parts: string[] }> {
    const by = new Map<string, string[]>();
    for (const p of this.layered()) if (p.cut_from === undefined && p.limb === undefined) by.set(p.from, [...(by.get(p.from) ?? []), p.name]);
    return [...by.entries()].filter(([, names]) => names.length > 1).map(([from, parts]) => ({ from, parts }));
  }

  /**
   * Issue #440: limb records (`r.limb !== undefined`) that cannot be reassembled
   * into their pre-limb source parts (`r.limb.of`) — a limb part handed to
   * `propose` on its own or with an incomplete segment chain (fewer than two
   * segments, a segment index missing from `0..n-1`, a lower segment without
   * its `cap` record, or the source part `of` still present beside the limb
   * parts). When every limb in `parts.json` is complete, returns `[]` and
   * {@link beforeLimbs} reconstructs the pre-limb part set.
   */
  standaloneLimbParts(): PartRecord[] {
    const limbed = this.recs.filter((r) => r.limb !== undefined);
    if (limbed.length === 0) return [];
    const nonLimbNames = new Set(this.recs.filter((r) => r.limb === undefined).map((r) => r.name));
    const byLimb = new Map<string, PartRecord[]>();
    for (const r of limbed) {
      const l = r.limb as NonNullable<PartRecord['limb']>;
      byLimb.set(l.name, [...(byLimb.get(l.name) ?? []), r]);
    }
    const badLimbs = new Set<string>();
    const badOf = new Set<string>();
    for (const [name, segs] of byLimb) {
      const sorted = [...segs].sort((a, b) => (a.limb?.segment ?? 0) - (b.limb?.segment ?? 0));
      const complete =
        sorted.length >= 2 &&
        sorted.every((s, i) => {
          const l = s.limb as NonNullable<PartRecord['limb']>;
          return l.segment === i && (i === 0 ? l.cap === undefined : l.cap !== undefined) && !nonLimbNames.has(l.of);
        });
      if (!complete) {
        badLimbs.add(name);
        for (const s of segs) badOf.add((s.limb as NonNullable<PartRecord['limb']>).of);
      }
    }
    return limbed.filter((r) => {
      const l = r.limb as NonNullable<PartRecord['limb']>;
      return badLimbs.has(l.name) || badOf.has(l.of);
    });
  }

  /**
   * Issue #440: when `parts.json` came from an `assemble` run with `config.limbs`
   * (every limb complete, {@link standaloneLimbParts} empty), reconstruct the
   * pre-limb part set so `propose`, `draftTurn`, `checkProposal` and
   * `checkBasis` read the whole layer each limb took in a single run. Without
   * limb records (or when a standalone limb part will be refused by
   * `PROPOSE_LIMB_PARTS`), returns `this`.
   */
  beforeLimbs(): PartSet {
    if (this.preLimbs !== null) return this.preLimbs;
    if (!this.recs.some((r) => r.limb !== undefined) || this.standaloneLimbParts().length > 0) {
      this.preLimbs = this;
      return this;
    }
    const segsByOf = new Map<string, PartRecord[]>();
    const segByLimb = new Map<string, PartRecord>();
    for (const r of this.recs) {
      if (r.limb === undefined) continue;
      segsByOf.set(r.limb.of, [...(segsByOf.get(r.limb.of) ?? []), r]);
      segByLimb.set(`${r.limb.name}:${r.limb.segment}`, r);
    }
    const buildOf = (ofName: string): { rec: PartRecord; raster: Raster } => {
      const segs = segsByOf.get(ofName) as PartRecord[];
      const union = new Uint8Array(this.W * this.H);
      for (const s of segs) {
        const m = this.alpha(s);
        const l = s.limb as NonNullable<PartRecord['limb']>;
        const up = l.segment > 0 ? segByLimb.get(`${l.name}:${l.segment - 1}`) : undefined;
        const dropUpperCap = up !== undefined && up.limb?.of !== ofName && (l.cap?.upper_px ?? 0) > 0 && (l.cap?.layer_px ?? 0) === 0 ? this.alpha(up) : null;
        const box = l.cap?.box;
        for (let y = s.y; y < s.y + s.h; y++) {
          for (let x = s.x; x < s.x + s.w; x++) {
            const p = y * this.W + x;
            if (!m.data[p]) continue;
            if (dropUpperCap !== null && box !== undefined && x >= box[0] && x < box[0] + box[2] && y >= box[1] && y < box[1] + box[3] && dropUpperCap.data[p]) continue;
            union[p] = 1;
          }
        }
      }
      let x0 = this.W;
      let y0 = this.H;
      let x1 = -1;
      let y1 = -1;
      let opaquePx = 0;
      for (let y = 0; y < this.H; y++) {
        for (let x = 0; x < this.W; x++) {
          if (!union[y * this.W + x]) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
          opaquePx++;
        }
      }
      const first = segs[0];
      if (x1 < x0) {
        x0 = first.x;
        y0 = first.y;
        x1 = first.x + first.w - 1;
        y1 = first.y + first.h - 1;
      }
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      const raster = newRaster(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (union[(y0 + y) * this.W + x0 + x]) raster.data[(y * w + x) * 4 + 3] = 255;
        }
      }
      const sum = (f: (r: PartRecord) => number): number => segs.reduce((acc, r) => acc + f(r), 0);
      const hasVis = segs.every((r) => r.visible_px !== undefined && r.occluded_px !== undefined);
      const rec: PartRecord = {
        name: ofName,
        from: first.from,
        ...(first.cut_from === undefined ? {} : { cut_from: first.cut_from }),
        x: x0,
        y: y0,
        w,
        h,
        opaque_px: opaquePx,
        ...(hasVis ? { visible_px: sum((r) => r.visible_px as number), occluded_px: sum((r) => r.occluded_px as number) } : {}),
        projected_core_px: sum((r) => r.projected_core_px),
        source_px_taken: sum((r) => r.source_px_taken),
        ...(segs.some((r) => r.visible_not_projected_px !== undefined) ? { visible_not_projected_px: sum((r) => r.visible_not_projected_px ?? 0) } : {}),
        refused_drift_px: sum((r) => r.refused_drift_px),
        merged_px: sum((r) => r.merged_px),
        seam_override_px: sum((r) => r.seam_override_px),
      };
      return { rec, raster };
    };
    const recs: PartRecord[] = [];
    const images = new Map<string, Raster>();
    const emittedOf = new Set<string>();
    for (const r of this.recs) {
      if (r.limb === undefined) {
        recs.push(r);
        const im = this.images.get(r.name);
        if (im !== undefined) images.set(r.name, im);
        continue;
      }
      const seg0 = segByLimb.get(`${r.limb.name}:0`) as PartRecord;
      const rootOf = (seg0.limb as NonNullable<PartRecord['limb']>).of;
      if (emittedOf.has(rootOf)) continue;
      const groupLimbs = new Set(
        this.recs.filter((q) => q.limb !== undefined && q.limb.segment === 0 && q.limb.of === rootOf).map((q) => (q.limb as NonNullable<PartRecord['limb']>).name),
      );
      const minSegByOf = new Map<string, number>();
      for (const q of this.recs) {
        if (q.limb === undefined || !groupLimbs.has(q.limb.name)) continue;
        const prev = minSegByOf.get(q.limb.of);
        if (prev === undefined || q.limb.segment < prev) minSegByOf.set(q.limb.of, q.limb.segment);
      }
      const orderedOfs = [...minSegByOf.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n);
      for (const ofName of orderedOfs) {
        if (emittedOf.has(ofName)) continue;
        emittedOf.add(ofName);
        const built = buildOf(ofName);
        recs.push(built.rec);
        images.set(ofName, built.raster);
      }
    }
    this.preLimbs = new PartSet({ rig_size: [this.W, this.H], scale_rig_per_source: this.rigScale, ghost_px: {}, parts: recs }, images);
    return this.preLimbs;
  }

  /** The See-through parts: every part but the `painting:` patches. */
  layered(): PartRecord[] {
    return this.recs.filter((p) => splitFrom(p.from)[0] !== PAINTING_RUN);
  }

  /** `byTag(tag, 'head') or byTag(tag)`: the head run's layer when it has one. */
  headFirst(tag: string): PartRecord[] {
    const head = this.byTag(tag, 'head');
    return head.length > 0 ? head : this.byTag(tag);
  }

  /** Full-canvas mask of a part: its PNG's alpha above 8, placed at its box. */
  alpha(p: PartRecord): Mask {
    const cached = this.masks.get(p.name);
    if (cached !== undefined) return cached;
    const im = this.images.get(p.name) as Raster;
    const m = newMask(this.W, this.H);
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) m.data[(p.y + y) * this.W + p.x + x] = im.data[(y * p.w + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE ? 1 : 0;
    }
    this.masks.set(p.name, m);
    return m;
  }
}

function splitFrom(from: string): [string, string] {
  const i = from.indexOf(':');
  return [from.slice(0, i), from.slice(i + 1)];
}

/**
 * Read `parts.json` and every PNG it names. A PNG that is absent, or whose size
 * is not its record's box, is refused by name — the reference would have
 * crashed on the second and read garbage on neither.
 */
export function readPartSet(dir: string): PartSet {
  const file = readParts(join(dir, 'parts.json'));
  const problems: Problem[] = [];
  const images = new Map<string, Raster>();
  for (const p of file.parts) {
    const png = join(dir, 'parts', `${p.name}.png`);
    if (!existsSync(png)) {
      problems.push({ code: 'PROPOSE_PNG_PRESENT', object: `part "${p.name}"`, detail: `${png} does not exist; parts.json names it` });
      continue;
    }
    const im = readPng(png);
    if (im.width !== p.w || im.height !== p.h) {
      problems.push({ code: 'PROPOSE_PNG_MATCHES_BOX', object: `part "${p.name}"`, detail: `parts/${p.name}.png is ${im.width}x${im.height}; its parts.json box is ${p.w}x${p.h}` });
      continue;
    }
    images.set(p.name, im);
  }
  refuseIfAny(problems);
  return new PartSet(file, images);
}

// ---------------------------------------------------------------------------
// mask measurements, in numpy's slicing semantics
// ---------------------------------------------------------------------------

/** Python's `a[start:stop]` bounds over a length, negative indices included. */
function pySlice(start: number, stop: number, len: number): [number, number] {
  const norm = (i: number): number => (i < 0 ? Math.max(0, len + i) : Math.min(i, len));
  const s = norm(start);
  const e = norm(stop);
  return [s, Math.max(s, e)];
}

/** Columns (sorted) holding a set pixel in rows `mask[r0:r1]`. */
function colsAny(m: Mask, r0: number, r1: number): number[] {
  const [a, b] = pySlice(r0, r1, m.height);
  const hit = new Uint8Array(m.width);
  for (let y = a; y < b; y++) for (let x = 0; x < m.width; x++) if (m.data[y * m.width + x]) hit[x] = 1;
  const out: number[] = [];
  for (let x = 0; x < m.width; x++) if (hit[x]) out.push(x);
  return out;
}

/** Rows (sorted) holding a set pixel. */
function rowsAny(m: Mask): number[] {
  const out: number[] = [];
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (m.data[y * m.width + x]) {
        out.push(y);
        break;
      }
    }
  }
  return out;
}

function sideOf(xs: number[], side: 'r' | 'l', axis: number): number[] {
  return side === 'r' ? xs.filter((x) => x < axis) : xs.filter((x) => x >= axis);
}

/**
 * The x of the mask in a horizontal band at y (`half` rows each way): the
 * column-count centroid, or `frac` of the way between the band's edges. `null`
 * when the band is empty — the reference's `None`.
 */
function bandX(m: Mask, y: number, opts: { half?: number; frac?: number; side?: 'r' | 'l'; axis?: number } = {}): number | null {
  const half = opts.half ?? 12;
  const y0 = Math.max(0, pyInt(y - half));
  const y1 = pyInt(y + half);
  const [a, b] = pySlice(y0, y1, m.height);
  const counts = new Float64Array(m.width);
  for (let yy = a; yy < b; yy++) for (let x = 0; x < m.width; x++) counts[x] += m.data[yy * m.width + x];
  let xs: number[] = [];
  for (let x = 0; x < m.width; x++) if (counts[x] > 0) xs.push(x);
  if (opts.side !== undefined) xs = sideOf(xs, opts.side, opts.axis as number);
  if (xs.length === 0) return null;
  if (opts.frac === undefined) {
    let num = 0;
    let den = 0;
    for (const x of xs) {
      num += x * counts[x];
      den += counts[x];
    }
    return num / den;
  }
  return xs[0] + opts.frac * (xs[xs.length - 1] - xs[0]);
}

/** Python's `v or fallback` on a float that may be `None`: 0.0 is falsy there, and so it is here. */
function or(v: number | null, fallback: number): number {
  return v === null || v === 0 ? fallback : v;
}

function center(p: PartRecord): [number, number] {
  return [p.x + p.w / 2, p.y + p.h / 2];
}

function rnd(p: readonly [number, number]): Point {
  return [pyRound(p[0]), pyRound(p[1])];
}

function isOn(m: Mask, x: number, y: number): boolean {
  const xi = pyInt(x);
  const yi = pyInt(y);
  return yi >= 0 && yi < m.height && xi >= 0 && xi < m.width && m.data[yi * m.width + xi] === 1;
}

function union(a: Mask, b: Mask): Mask {
  const out = newMask(a.width, a.height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = a.data[i] | b.data[i];
  return out;
}

// ---------------------------------------------------------------------------
// the proposer
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// the torso, read off the figure
// ---------------------------------------------------------------------------

/**
 * The hip may not sit above this fraction of the figure's height, measured
 * from its top. Below it the proposer takes `bottomwear`'s top edge as the
 * waist; above it that edge is the collar of a long robe and the waist is read
 * off the silhouette. `lint` holds any config to the same line. The published
 * examples' hips sit at 0.436 (`demo`) and 0.342 (`sample`) of their figures;
 * a figure four heads tall has its whole head in the top quarter.
 */
export const HIP_MIN_FRACTION = 0.25;

/** A row is a waist when the torso there is at most this fraction of the shoulders' width (the examples' torsos narrow to 0.648 of their shoulders in `demo` and 0.710 in `sample`). */
export const WAIST_MAX_OF_SHOULDERS = 0.8;

/**
 * A `topwear` part hangs below the hip when its box reaches this many face
 * heights below the hip's y: above it, the topwear rule reads a bodice that
 * stops at the waist and drafts no robe chains (the reference's line). Issue
 * #402 reads the same line for a skirt held inside `topwear` (a dress), so
 * the two rules cannot disagree about which topwear hangs.
 */
export const TOPWEAR_HANGS_FACE_HEIGHTS = 0.25;

/**
 * Issue #402: the note naming a `topwear` part shaped like a skirt — its box
 * hanging {@link TOPWEAR_HANGS_FACE_HEIGHTS} face heights past the hip, and
 * its art wider across its last 24 rows than in the 24-row band at the hip
 * (the band the robe rule reads) — or null when it is not. The cloth recipe
 * finds a skirt by the `bottomwear` tag alone, and the shape cannot tell a
 * dress from an outer robe over a skirt, so the proposer drafts nothing on
 * the strength of it: the note names the part, its art's rows below the hip
 * and the field, `cloth.bottomwear.part`, by which the author declares it.
 */
function skirtInsideNote(p: PartRecord, mask: Mask, hipY: number, fh: number): string | null {
  const bot = p.y + p.h;
  const line = hipY + TOPWEAR_HANGS_FACE_HEIGHTS * fh;
  if (bot < line) return null;
  const span = (xs: number[]): number => (xs.length === 0 ? 0 : xs[xs.length - 1] - xs[0] + 1);
  const atHip = span(colsAny(mask, pyInt(hipY) - 12, pyInt(hipY) + 12));
  const atBottom = span(colsAny(mask, bot - 24, bot));
  if (!(atBottom > atHip)) return null;
  const hipRow = pyRound(hipY);
  let last = bot - 1;
  while (last > p.y && colsAny(mask, last, last + 1).length === 0) last--;
  return (
    `${p.name} (${p.from}): shaped like a skirt — its art's rows ${hipRow + 1} to ${last} lie below hip (y ${hipRow}), past hip + ${TOPWEAR_HANGS_FACE_HEIGHTS} face heights (y ${pyFixed(line, 1)}), and it is wider across its last 24 rows (${atBottom} px) than in the 24-row band at the hip (${atHip} px); ` +
    `the cloth recipe finds a skirt by the bottomwear tag alone, so it drafted no skirt trees on ${p.name}, and the topwear rule drafts it instead. If See-through returned the skirt inside it (a dress), declare config.cloth.bottomwear.part: "${p.name}", and the bottomwear recipe's trees hang from hip over its art below the hip`
  );
}

/**
 * One handwear blob is clasped hands, not two sleeves, when it is at most this
 * fraction of the shoulders' width: two sleeves that hang from the shoulders
 * are at least as wide as them (the examples' one-blob sleeves are 1.506 and
 * 1.580 shoulder widths).
 */
export const CLASPED_MAX_OF_SHOULDERS = 0.5;

/** ... and when its centre is within this fraction of the shoulders' width of the eye axis. */
export const CLASPED_AXIS_OF_SHOULDERS = 0.25;

/**
 * The tags whose layers make the torso's silhouette: the body without hair,
 * hands, head parts, tail, wings or held objects — the layers whose width at
 * a row is the body's width there.
 */
export const TORSO_TAGS = ['neck', 'neckwear', 'topwear', 'bottomwear', 'legwear', 'footwear'] as const;

/** The first and last rows holding any part's pixel. */
function figureExtent(P: PartSet): { top: number; bot: number } {
  // The layers' figure: a patch adds none of its own, so adding one moves no bone.
  let fig = newMask(P.W, P.H);
  for (const p of P.layered()) fig = union(fig, P.alpha(p));
  const ys = rowsAny(fig);
  return { top: ys[0], bot: ys[ys.length - 1] };
}

/** Per row, the leftmost and rightmost torso pixel (-1 on an empty row). */
function torsoRows(P: PartSet): { lo: Int32Array; hi: Int32Array } {
  const lo = new Int32Array(P.H).fill(-1);
  const hi = new Int32Array(P.H).fill(-1);
  for (const p of P.layered()) {
    if (!(TORSO_TAGS as readonly string[]).includes(splitFrom(p.from)[1])) continue;
    const m = P.alpha(p);
    for (let y = p.y; y < p.y + p.h; y++) {
      for (let x = p.x; x < p.x + p.w; x++) {
        if (!m.data[y * P.W + x]) continue;
        if (lo[y] < 0 || x < lo[y]) lo[y] = x;
        if (x > hi[y]) hi[y] = x;
      }
    }
  }
  return { lo, hi };
}

interface TorsoRow {
  y: number;
  width: number;
  cx: number;
}

function rowAt(t: { lo: Int32Array; hi: Int32Array }, y: number): TorsoRow | null {
  return t.lo[y] < 0 ? null : { y, width: t.hi[y] - t.lo[y] + 1, cx: (t.lo[y] + t.hi[y]) / 2 };
}

/** The widest torso row within one face height below the neck (the first, on a tie): the shoulder line. */
function shoulderOf(t: { lo: Int32Array; hi: Int32Array }, neckY: number, fh: number): TorsoRow | null {
  let best: TorsoRow | null = null;
  for (let y = Math.max(0, Math.ceil(neckY)); y <= Math.min(t.lo.length - 1, Math.floor(neckY + fh)); y++) {
    const r = rowAt(t, y);
    if (r !== null && (best === null || r.width > best.width)) best = r;
  }
  return best;
}

/**
 * The narrowest torso row from the shoulder line down to `bandEnd` (the
 * figure's middle: below it legs are narrower than any waist — the sample's
 * legs are 89 px wide at y 1046, its waist 125 px at y 435), when it is a waist at all.
 */
function waistOf(t: { lo: Int32Array; hi: Int32Array }, shoulders: TorsoRow, bandEnd: number): TorsoRow | null {
  let best: TorsoRow | null = null;
  for (let y = shoulders.y; y <= Math.min(t.lo.length - 1, Math.floor(bandEnd)); y++) {
    const r = rowAt(t, y);
    if (r !== null && (best === null || r.width < best.width)) best = r;
  }
  return best !== null && best.width <= WAIST_MAX_OF_SHOULDERS * shoulders.width ? best : null;
}

/**
 * The note saying the handwear is clasped hands, or `null` when it is not:
 * every handwear part together is ONE connected component over 500 px (the
 * floor the sleeve rule applies to a part), at most
 * `CLASPED_MAX_OF_SHOULDERS` of the shoulder width wide, centred within
 * `CLASPED_AXIS_OF_SHOULDERS` of it of the eye axis. No shoulder line
 * measured -> `null`, and the sleeve rule runs as before.
 */
function claspedOf(P: PartSet, hw: readonly PartRecord[], shoulders: TorsoRow | null, axis: number): string | null {
  if (shoulders === null) return null;
  let mask = newMask(P.W, P.H);
  for (const p of hw) mask = union(mask, P.alpha(p));
  const cc = connectedComponents(mask, 8);
  const blobs = cc.stats.slice(1).filter((st) => st.area > 500);
  if (blobs.length !== 1) return null;
  const b = blobs[0];
  const cx = b.left + b.width / 2;
  if (b.width > CLASPED_MAX_OF_SHOULDERS * shoulders.width || Math.abs(cx - axis) > CLASPED_AXIS_OF_SHOULDERS * shoulders.width) return null;
  return (
    `handwear is one blob (${hw.map((p) => p.name).join(', ')}) ${b.width}x${b.height} px centred at x=${pyFixed(cx, 0)}: ` +
    `at most ${CLASPED_MAX_OF_SHOULDERS} of the shoulder width (${shoulders.width} px at y=${shoulders.y}) and within ${CLASPED_AXIS_OF_SHOULDERS} of it of the eye axis x=${pyFixed(axis, 0)}, ` +
    'so clasped hands: a region on hip, no sleeve chains (sleeves painted inside another layer move with it)'
  );
}

/** The region role of each tag that has one. Brows are overridden by position below. */
const TAG_REGION: Readonly<Record<string, string>> = {
  face: 'head',
  'ears-r': 'head',
  'ears-l': 'head',
  mouth: 'mouth',
  nose: 'head',
  'irides-r': 'eye_r',
  'irides-l': 'eye_l',
  'eyelash-r': 'eye_r',
  'eyelash-l': 'eye_l',
  'eyewhite-r': 'eye_r',
  'eyewhite-l': 'eye_l',
  'eyebrow-r': 'brow_r',
  'eyebrow-l': 'brow_l',
  footwear: 'root',
};

/**
 * A hanging strand: a connected sub-shape (8-connected) of an accessory's mask,
 * searched below the part's body — in its pendant rows, the run of rows at the
 * bottom narrower than {@link PENDANT_NARROW} of the widest row — or over the
 * whole part when the part is all pendant. It is a strand when it is at least
 * {@link STRAND_ASPECT} times as tall as it is wide, at least
 * {@link STRAND_SHARE} of the part's height, and at least
 * {@link PENDANT_MIN_ROWS} rows tall.
 *
 * Measured on the public examples' two accessories (the sub-shapes this
 * definition reads, height/width): `demo` `hairpin` (head:headwear, 133 rows)
 * has two in its pendant rows, 22/41 = 0.54 and 41/46 = 0.89 (the bows' tips,
 * the second carrying the star dangle); `demo` `earring` (full:earwear, all
 * pendant, 29 rows) has two, 26/25 = 1.04 and 28/26 = 1.08. None reaches 3,
 * so neither proposal changes; `sample` has no headwear or earwear.
 */
export interface Strand {
  /** Column centroid, rig px. */
  x: number;
  /** First and last row, rig px, inclusive. */
  top: number;
  bottom: number;
  /** Bounding-box width, px. */
  width: number;
  /** The strand alone, full canvas. */
  mask: Mask;
}

/** Pendant rows are the rows at the bottom narrower than this share of the widest row — the reference's 35 %. */
export const PENDANT_NARROW = 0.35;
/** A pendant (or strand) shorter than this many rows gets no chain — the reference's tassel floor. */
export const PENDANT_MIN_ROWS = 10;
/** A strand is at least this many times as tall as it is wide. */
export const STRAND_ASPECT = 3;
/** A strand is at least this share of its part's height. */
export const STRAND_SHARE = 0.2;
/** A pendant chain's second link sits this far down it — the reference's tassel. */
export const STRAND_LINK_AT = 0.45;
/** A pendant chain's two link amplitudes, degrees — the reference's tassel, which every strand chain takes. */
export const STRAND_AMPS: readonly [number, number] = [4.0, 7.0];

/** An accessory's opaque pixels per row, and where its pendant rows start (`j`, part rows) and how many there are. */
function pendantRows(P: PartSet, p: PartRecord): { rows: number[]; j: number; pendH: number } {
  const im = P.images.get(p.name) as Raster;
  const rows: number[] = [];
  for (let y = 0; y < p.h; y++) {
    let n = 0;
    for (let x = 0; x < p.w; x++) n += im.data[(y * p.w + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE ? 1 : 0;
    rows.push(n);
  }
  const wmax = Math.max(...rows);
  // The pendant: the longest run of rows at the bottom whose width is under 35 % of the widest row.
  const narrow = rows.map((n) => n < PENDANT_NARROW * wmax);
  let j = rows.length - 1;
  while (j > 0 && narrow[j - 1] && rows[j - 1] > 0) j--;
  return { rows, j, pendH: rows.length - j };
}

/** The strands of `p` in its rows from `fromRow` down, left to right. See {@link Strand}. */
export function hangingStrands(P: PartSet, p: PartRecord, fromRow: number): Strand[] {
  const im = P.images.get(p.name) as Raster;
  const local = newMask(p.w, p.h);
  for (let y = fromRow; y < p.h; y++) for (let x = 0; x < p.w; x++) local.data[y * p.w + x] = im.data[(y * p.w + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE ? 1 : 0;
  const cc = connectedComponents(local, 8);
  const out: Strand[] = [];
  for (let i = 1; i < cc.count; i++) {
    const st = cc.stats[i];
    if (st.height < STRAND_ASPECT * st.width || st.height < STRAND_SHARE * p.h || st.height < PENDANT_MIN_ROWS) continue;
    const mask = newMask(P.W, P.H);
    for (let y = st.top; y < st.top + st.height; y++) {
      for (let x = st.left; x < st.left + st.width; x++) if (cc.labels[y * p.w + x] === i) mask.data[(p.y + y) * P.W + p.x + x] = 1;
    }
    out.push({ x: p.x + st.cx, top: p.y + st.top, bottom: p.y + st.top + st.height - 1, width: st.width, mask });
  }
  // Stable: two strands at one x keep their scan order.
  return out.sort((a, b) => a.x - b.x);
}

/** The one note a part with strands gets: every strand's figures, and which chain each got or why none. */
function strandNote(p: PartRecord, strands: readonly Strand[], chained: readonly string[], dropped: readonly Strand[], why: string): string {
  const n = strands.length;
  const at = `x=${strands.map((s) => pyFixed(s.x, 0)).join(',')}, y ${strands.map((s) => `${s.top}-${s.bottom}`).join(',')}, width ${strands.map((s) => s.width).join(',')}`;
  const head = `${p.name} (${p.from}): ${n} hanging strand${n === 1 ? '' : 's'} at ${at}`;
  if (chained.length === 0) return `${head} -- no chain proposed (${why})`;
  const made = `pendulum chain${chained.length === 1 ? '' : 's'} ${chained.join(', ')}`;
  if (dropped.length === 0) return `${head} -> ${made}`;
  return `${head} -> ${made}; no chain proposed at x=${dropped.map((s) => pyFixed(s.x, 0)).join(',')} (${why})`;
}

// ---------------------------------------------------------------------------
// the face box, or one derived from the head run when no face part exists (issue #76)
// ---------------------------------------------------------------------------

/**
 * The ratios the face-less fallback derives a face box with. `L`, the span,
 * runs from the top of the head run's hair ({@link FACELESS_HAIR_TAGS}, the
 * highest of them) to the top of its `neck`. Measured on the two public
 * examples' assembled parts (`examples/<key>/expected/parts.json`; demo: hair
 * top y 67, neck top y 191, face 361,80 109x133; sample: hair top y 80, neck
 * top y 194, face 368,98 94x121) — a sample of two; the mean of the two, to
 * three places, is used:
 *
 * - `heightOfSpan` — face height / L: demo 133/124 = 1.073, sample
 *   121/114 = 1.061.
 * - `topOfSpan` — (face top − hair top) / L: demo 13/124 = 0.105, sample
 *   18/114 = 0.158.
 * - `widthOfHeight` — face width / face height: demo 109/133 = 0.820,
 *   sample 94/121 = 0.777.
 *
 * The box is centred on the neck part's centre x (demo 417 against the face's
 * 415.5, sample 411 against 415). Rejected for the top: the union of every
 * head-run part, which the demo's headwear lifts to y 20 — its face height /
 * span is 0.778 there against the sample's 1.061.
 */
export interface FacelessRatios {
  heightOfSpan: number;
  topOfSpan: number;
  widthOfHeight: number;
}

/** The measured means; see {@link FacelessRatios}. */
export const FACELESS_RATIOS: Readonly<FacelessRatios> = { heightOfSpan: 1.067, topOfSpan: 0.131, widthOfHeight: 0.798 };

/** The head-run tags the face-less fallback reads the top of the head from. */
export const FACELESS_HAIR_TAGS: readonly string[] = ['front hair', 'back hair'];

/** The rules a face's features feed, by the tags each reads: the fallback note names each whose tags are all absent. */
const FACE_FEATURE_RULES: ReadonlyArray<readonly [readonly string[], string]> = [
  [EYE_GROUP_TAGS, 'the eye bones, the eye axis, the blink and its still pieces'],
  [BROW_GROUP_TAGS, 'the brow bones'],
  [['mouth'], 'the mouth bone'],
];

/** A face box `[x0, y0, w, h]` in rig px, and the note saying how it was derived (`null` when it is the face part's own box). */
export interface FaceBox {
  box: [number, number, number, number];
  note: string | null;
  /** The parts the box was read off: the face part, or the hair and neck it was derived from. */
  parts: string[];
}

/**
 * The face box every rule scales by: the head run's `face` part (the full
 * run's when the head run has none), as the reference read it; or, with no
 * face part at all, one derived from the head run's hair and neck by
 * `ratios` ({@link FACELESS_RATIOS}), with a note naming what it read, what
 * it derived and which face-reading rules have nothing to read. Refuses
 * `PROPOSE_FACE_PRESENT` when there is neither a face part nor what the
 * fallback reads — never a box from nothing.
 */
export function faceBoxOf(P: PartSet, ratios: Readonly<FacelessRatios> = FACELESS_RATIOS): FaceBox {
  const faces = P.headFirst('face');
  if (faces.length > 0) return { box: [faces[0].x, faces[0].y, faces[0].w, faces[0].h], note: null, parts: [faces[0].name] };
  const hair = P.layered().filter((p) => splitFrom(p.from)[0] === 'head' && FACELESS_HAIR_TAGS.includes(splitFrom(p.from)[1]));
  const neck = P.byTag('neck', 'head');
  const refuse = (why: string): never => {
    const tags = [...new Set(P.recs.map((p) => p.from))].join(', ');
    throw new PartsError([
      {
        code: 'PROPOSE_FACE_PRESENT',
        object: 'parts.json',
        detail:
          `holds no part from a "face" layer (found: ${tags}); head, neck, the eye axis and the face height every other rule scales by all come from it, ` +
          `and the face-less fallback, which derives a face box from the head run's hair (${FACELESS_HAIR_TAGS.map((t) => `"${t}"`).join(' or ')}) and its "neck", cannot: ${why}`,
      },
    ]);
  };
  if (hair.length === 0 && neck.length === 0) refuse('the head run has neither');
  if (hair.length === 0) refuse(`the head run has a neck (${neck[0].name}) but no hair part`);
  if (neck.length === 0) refuse(`the head run has hair (${hair.map((p) => p.name).join(', ')}) but no "neck" part`);
  const n = neck[0];
  const top = Math.min(...hair.map((p) => p.y));
  const span = n.y - top;
  if (span <= 0) refuse(`the hair's top, y=${top}, is not above the top of ${n.name}, y=${n.y}, so there is no span to scale`);
  const fh = ratios.heightOfSpan * span;
  const fw = ratios.widthOfHeight * fh;
  const cx = n.x + n.w / 2;
  const box: [number, number, number, number] = [cx - fw / 2, top + ratios.topOfSpan * span, fw, fh];
  const nothing = FACE_FEATURE_RULES.filter(([ts]) => ts.every((t) => P.byTag(t).length === 0)).map(([ts, rule]) => `${rule} (no ${ts.join(' or ')} part)`);
  const note =
    `no face part: face box derived from the head run's hair (${hair.map((p) => p.name).join(', ')}; top y=${top}) and neck (${n.name}; top y=${n.y}, centre x=${pyFixed(cx, 1)}), a span of ${span} px — ` +
    `height ${ratios.heightOfSpan} of the span, top ${ratios.topOfSpan} of it below the hair's top, width ${ratios.widthOfHeight} of the height, centred on the neck: ` +
    `x ${pyFixed(box[0], 1)}, y ${pyFixed(box[1], 1)}, ${pyFixed(fw, 1)}x${pyFixed(fh, 1)} (ratios measured on the two public examples); ` +
    'head, neck, the eye line when there is no eyewhite and every face-height scale are read off this guess, so correct those bones against the overlay' +
    (nothing.length === 0 ? '' : `; nothing to read for ${nothing.join(', ')}`) +
    // Measured: the sample with only its face removed opens 587 px behind its shut eyes, the demo 0 (its hair is under them).
    (EYE_GROUP_TAGS.some((t) => P.byTag(t).length > 0) ? "; the blink shuts the eyes over no face part, so check's BLINK_NO_HOLE says whether anything shows through" : '');
  return { box, note, parts: [...hair.map((p) => p.name), n.name] };
}

const SIDES = [
  ['r', 1],
  ['l', -1],
] as const;

/**
 * Propose bones, meshes, regions and an idle from the parts. With `joints`
 * (`propose --keypoints`, issue #75), a joint the file gives a position is
 * used as given in place of the body-ratio rule for the bone it places, and
 * every joint the proposer could use gets one note saying how it was used or
 * which rule stood in; without it every value and note is the one this
 * function wrote before the parameter existed.
 */
export function propose(
  P: PartSet,
  joints?: RigJoints,
  wristSnap: number | null = null,
  gridRule: GridRule = DEFAULT_GRID_RULE,
  cloth: ClothRecipes | null = null,
  chainRule = true,
): Proposal {
  return proposeWithBasis(P, joints, wristSnap, gridRule, cloth, chainRule).proposal;
}

/**
 * {@link propose}, and beside the proposal what each bone it places rests on
 * (issue #86): recorded at each placement below, from the values that placed
 * it — no bone's value is touched by the recording, and `propose` returns the
 * same proposal, byte for byte, as before the record existed.
 *
 * `wristSnap` (`propose --wrist-snap`, issue #199) is read only with
 * `joints`: see {@link armsFromJoints}. `null` is the built-in tolerance
 * alone, and every value and note is the one written before it existed.
 */
export function proposeWithBasis(
  P: PartSet,
  joints?: RigJoints,
  wristSnap: number | null = null,
  gridRule: GridRule = DEFAULT_GRID_RULE,
  cloth: ClothRecipes | null = null,
  chainRule = true,
): { proposal: Proposal; basis: ProposalBasis; draftLint: DraftLintFinding[] } {
  // Issue #230: a piece is not given its base's rule a second time, which
  // needs to know which part is the piece. A file that cannot say is refused
  // here, and only here: every other reader of parts.json still takes it.
  refuseIfAny(
    P.unmarkedShares().map(({ from, parts }) => ({
      code: 'PROPOSE_CUT_FROM_RECORDED',
      object: `parts ${parts.map((n) => `"${n}"`).join(', ')} (${from})`,
      detail: `share one layer and none of them records cut_from, so which is the plan part and which the piece an assemble.cuts entry took cannot be read off parts.json (it is in draw order, and a piece drawn "back" comes before its base); re-run assemble (1.6.0+) to record cut_from`,
    })),
  );
  // Issue #349, #440: limbs are drafted from the parts before their cut — a complete assemble with config.limbs
  // reconstructs its pre-limb parts here in the same run; a standalone or incomplete limb part handed to propose
  // on its own is refused by name.
  const limbed = P.standaloneLimbParts();
  refuseIfAny(
    limbed.length === 0
      ? []
      : [
          {
            code: 'PROPOSE_LIMB_PARTS',
            object: `parts ${limbed.map((r) => `"${r.name}"`).join(', ')}`,
            detail: `were cut at their joints by config.limbs (from ${[...new Set(limbed.map((r) => `"${(r.limb as NonNullable<PartRecord['limb']>).of}"`))].join(', ')}), and propose drafts the limbs from the whole layer each limb takes; hand propose the complete assemble output (every segment of each limb, with its cap record) so the source part can be reconstructed in one run, or assemble with config.limbs left out — or read the config's bones with propose --from-config`,
          },
        ],
  );
  P = P.beforeLimbs();
  const bones: BoneEntry[] = [];
  const records: BoneBasis[] = [];
  /** Issue #349: the limbs `--keypoints` drafts, and the parts they take (not made, so not given a mesh or a region). */
  const limbs: Record<string, Limb> = Object.create(null) as Record<string, Limb>;
  /** Issue #517: the ankles left uncut because they lie off their leg's art — LINT lines, handed back beside the proposal. */
  const jointsOffArt: LimbJointOffArtFinding[] = [];
  const consumed = new Set<string>();
  // No prototype: a part may be named anything file-safe, "__proto__" included.
  const meshes = Object.create(null) as Record<string, MeshSpec>;
  const regions = Object.create(null) as Record<string, string>;
  const tracks: Array<ProposedSingleTrack | ProposedChainTrack> = [];
  const notes: string[] = [];

  // The face part's box, or with none one derived from the head run's hair
  // and neck (issue #76), said in the first note.
  const faceBox = faceBoxOf(P);
  const [fx0, fy0, fw, fh] = faceBox.box;
  if (faceBox.note !== null) notes.push(faceBox.note);
  const ew: Record<'r' | 'l', PartRecord | null> = { r: P.byTag('eyewhite-r')[0] ?? null, l: P.byTag('eyewhite-l')[0] ?? null };
  const eyes = new Map<'r' | 'l', [number, number]>();
  for (const s of ['r', 'l'] as const) {
    const p = ew[s];
    if (p !== null) eyes.set(s, center(p));
  }
  const axis = eyes.size === 2 ? ((eyes.get('r') as [number, number])[0] + (eyes.get('l') as [number, number])[0]) / 2 : fx0 + fw / 2;
  const eyeY = eyes.size > 0 ? npMean([...eyes.values()].map((e) => e[1])) : fy0 + 0.5 * fh;
  const eyeParts = (['r', 'l'] as const).flatMap((s) => (ew[s] === null ? [] : [(ew[s] as PartRecord).name]));
  const torsoParts = P.layered().filter((p) => (TORSO_TAGS as readonly string[]).includes(splitFrom(p.from)[1]));
  const frame: Record<FrameKey, FrameBasis> = {
    face_box: { rule: faceBox.note === null ? `the box of ${faceBox.parts[0]}, the face part` : "derived from the head run's hair and neck by the measured ratios (the first note)", parts: faceBox.parts },
    eye_axis: eyes.size === 2 ? { rule: "half way between the centres of the two eyewhites' boxes", parts: eyeParts } : { rule: 'the centre x of the face box (there are not two eyewhites)', parts: faceBox.parts },
    eye_line: eyes.size > 0 ? { rule: "the mean y of the eyewhites' box centres", parts: eyeParts } : { rule: 'half way down the face box (no eyewhite)', parts: faceBox.parts },
    figure: { rule: "the first and last rows holding any layered part's pixel", parts: P.layered().map((p) => p.name) },
    torso: { rule: `per row, the leftmost and rightmost pixel of the layers tagged ${TORSO_TAGS.join(', ')}`, parts: torsoParts.map((p) => p.name) },
  };
  // A joint as the file declared it, for the record.
  const jointRef = (n: KeypointName): BasisJoint => {
    const j = (joints as RigJoints).joints[n];
    return { name: n, state: j.state, listed: j.listed, score: j.score, at: j.at as [number, number] };
  };
  // Python's `v or fallback`, with the stand-in said when it is taken.
  const orSaid = (v: number | null, fallback: number, why: string, sink: { fallback: string | null }): number => {
    if (v === null || v === 0) sink.fallback = why;
    return or(v, fallback);
  };
  const chin = fy0 + fh;
  const head: [number, number] = [axis, fy0 + 0.88 * fh];
  const neckp = P.headFirst('neck');
  let neckY = neckp.length > 0 ? (chin + neckp[0].y + neckp[0].h) / 2 : chin + 0.12 * fh;
  // Issue #75: an observed neck joint is the neck bone, used as given; the
  // rule's y is replaced by the joint's everywhere the rules read the neck.
  const at = (n: KeypointName): [number, number] | null => (joints === undefined ? null : joints.joints[n].at);
  const neckRule = neckp.length > 0 ? `half way from the chin to the bottom of ${neckp[0].name}, on the eye axis` : '0.12 face heights below the chin, on the eye axis';
  const neckJ = at('neck');
  let neckAt: [number, number] = [axis, neckY];
  let neckWhy =
    neckp.length > 0
      ? placement('ratio', `half way from the chin (the face box's bottom) to the bottom of ${neckp[0].name}, on the eye axis`, { parts: [neckp[0].name], frame: ['face_box', 'eye_axis'], constants: [konst('share_chin_to_neck_bottom', 0.5)] })
      : placement('ratio', "0.12 face heights below the chin (the face box's bottom), on the eye axis", { frame: ['face_box', 'eye_axis'], constants: [konst('face_heights_below_chin', 0.12)], fallback: 'no neck part' });
  if (neckJ !== null) {
    neckAt = neckJ;
    neckY = neckJ[1];
    neckWhy = placement('joint', `the neck joint, ${usedAs((joints as RigJoints).joints.neck)}`, { joints: [jointRef('neck')] });
  }
  const bw = P.byTag('bottomwear');
  const tw = P.byTag('topwear');
  const { top: ftop, bot: fbot } = figureExtent(P);
  const torso = torsoRows(P);
  const shoulders = shoulderOf(torso, neckY, fh);
  let hip: [number, number];
  let hipRule = '';
  let hipWhy: Placement;
  const rHipJ = at('r_hip');
  const lHipJ = at('l_hip');
  const hipFromJoints = rHipJ !== null && lHipJ !== null;
  if (rHipJ !== null && lHipJ !== null) {
    hip = [(rHipJ[0] + lHipJ[0]) / 2, (rHipJ[1] + lHipJ[1]) / 2];
    hipWhy = placement('joint', 'the midpoint of the r_hip and l_hip joints — a point between two joints, not a joint', { joints: [jointRef('r_hip'), jointRef('l_hip')] });
  } else if (bw.length > 0 && bw[0].y + 0.14 * fh >= ftop + HIP_MIN_FRACTION * (fbot - ftop)) {
    hip = [bw[0].x + bw[0].w / 2, bw[0].y + 0.14 * fh];
    hipRule = `the top of ${bw[0].name} (bottomwear) + 0.14 face heights`;
    hipWhy = placement('ratio', `the top of ${bw[0].name} (bottomwear) + 0.14 face heights, at the centre x of its box`, { parts: [bw[0].name], frame: ['face_box'], constants: [konst('face_heights_below_top', 0.14)] });
  } else if (bw.length === 0) {
    hip = [axis, ftop + 0.32 * (fbot - ftop)];
    hipRule = '0.32 of the figure height, on the eye axis (no bottomwear)';
    hipWhy = placement('ratio', '0.32 of the figure height below its top row, on the eye axis', { frame: ['figure', 'eye_axis'], constants: [konst('of_figure_height', 0.32)], fallback: 'no bottomwear part' });
    notes.push('no bottomwear: hip from 0.32 of figure height');
  } else {
    // A long under-robe tagged bottomwear starts at the collar: its top edge
    // is not the waist, and a hip read off it sits at the shoulders with the
    // chest above it by half a neck. The waist is read off the figure instead.
    const limit = ftop + HIP_MIN_FRACTION * (fbot - ftop);
    notes.push(
      `hip: ${bw[0].name} (${bw[0].from}) starts at y=${bw[0].y}, so its top + 0.14 face heights (y=${pyFixed(bw[0].y + 0.14 * fh, 0)}) is above ${HIP_MIN_FRACTION} of the figure height (y=${pyFixed(limit, 0)}, figure y ${ftop}..${fbot}): its top edge is not the waist`,
    );
    const waist = shoulders === null ? null : waistOf(torso, shoulders, ftop + 0.5 * (fbot - ftop));
    if (shoulders !== null && waist !== null) {
      hip = [waist.cx, waist.y + 0.14 * fh];
      hipRule = 'the waist (the narrowest torso row) + 0.14 face heights';
      hipWhy = placement('ratio', "the waist — the narrowest torso row from the shoulder line (the widest torso row within one face height below the neck) down to the figure's middle — + 0.14 face heights, at that row's centre x", {
        bones: ['neck'],
        frame: ['torso', 'figure', 'face_box'],
        constants: [konst('face_heights_below_waist', 0.14), konst('waist_max_of_shoulders', WAIST_MAX_OF_SHOULDERS)],
      });
      notes.push(`hip from the waist: silhouette narrowest at y=${waist.y} (width ${waist.width} px, shoulders ${shoulders.width} px at y=${shoulders.y}), hip 0.14 face heights below it`);
    } else {
      hip = [axis, ftop + 0.32 * (fbot - ftop)];
      hipRule = '0.32 of the figure height, on the eye axis (no waist found)';
      hipWhy = placement('ratio', '0.32 of the figure height below its top row, on the eye axis', { frame: ['figure', 'eye_axis'], constants: [konst('of_figure_height', 0.32)], fallback: 'no waist found' });
      const why =
        shoulders === null
          ? `no torso layer (${TORSO_TAGS.join(', ')}) in the shoulder band y ${pyFixed(neckY, 0)}..${pyFixed(neckY + fh, 0)}`
          : `the silhouette never narrows to ${WAIST_MAX_OF_SHOULDERS} of the shoulders (${shoulders.width} px at y=${shoulders.y}) above the figure's middle, y=${pyFixed(ftop + 0.5 * (fbot - ftop), 0)}`;
      notes.push(`hip from 0.32 of figure height (no waist found: ${why})`);
    }
  }
  // The chest keeps its rule, half way from the neck to the hip; when either
  // end is a joint the half way is taken along the line between them, not
  // down the screen, because the torso need not be upright.
  const chestAlong = neckJ !== null || hipFromJoints;
  const chest: [number, number] = chestAlong ? [(neckAt[0] + hip[0]) / 2, (neckAt[1] + hip[1]) / 2] : [hip[0], neckY + 0.5 * (hip[1] - neckY)];
  // Issue #243: on that same line, neck -> hip, the trunk parts' fixed segments are laid too (neck, topwear,
  // bottomwear; {@link trunkSegments}), not down the screen through the bones' x. Without a joint at either end,
  // today's verticals; with the two ends on one point the line has no direction, and a note says the verticals stay.
  const trunk = chestAlong ? trunkLineOf(neckAt, hip) : null;
  if (chestAlong && trunk === null) {
    notes.push(`trunk segments: neck and hip are one point, ${fmtAt(hip)}, so neck -> hip declares no line; the trunk parts' segments are drafted down the screen, as without keypoints`);
  }
  // Each placement hands its basis with its value: one record per bone, in the order the bones are written.
  const B = (name: string, parent: string, at: readonly [number, number], why: Placement, tip?: readonly [number, number], tipWhy?: Placement): void => {
    bones.push(tip === undefined ? { name, parent, at: rnd(at) } : { name, parent, at: rnd(at), tip: rnd(tip) });
    records.push({ bone: name, entry: name, origin: why, tip: tipWhy ?? null });
  };
  const C = (chain: string, parent: string, pts: ReadonlyArray<readonly [number, number]>, tip: readonly [number, number], why: readonly Placement[], tipWhy: Placement): void => {
    bones.push({ chain, parent, points: pts.map(rnd), tip: rnd(tip) });
    pts.forEach((_, k) => records.push({ bone: `${chain}${k}`, entry: chain, origin: why[k], tip: k === pts.length - 1 ? tipWhy : null }));
  };
  // Issue #364: the trees a cloth recipe drafts, their constraints, and the tags it was used on.
  const clothConstraints: ConfigConstraint[] = [];
  const clothUsed = new Set<ClothTarget>();
  /** Issue #518: each part a recipe meshes, by the target whose recipe drafted its mesh. */
  const clothMeshed = new Map<string, ClothTarget>();
  const multiPartClaimed = new Set<string>();
  const recipeOf = (tag: ClothTarget): ClothRecipe | null => cloth?.[tag] ?? null;
  const declaredPartsOf = (tag: ClothTarget): { field: 'parts' | 'part'; list: PartRecord[] } | null => {
    const rcp = recipeOf(tag);
    if (rcp === null) return null;
    const raw = rcp.parts !== undefined ? { field: 'parts' as const, names: rcp.parts } : Array.isArray(rcp.part) ? { field: 'part' as const, names: rcp.part } : null;
    if (raw === null) return null;
    const object = `config.cloth.${JSON.stringify(tag)}.${raw.field}`;
    const list: PartRecord[] = [];
    for (const name of raw.names) {
      const q = P.recs.find((x) => x.name === name);
      if (q === undefined) {
        throw new PartsError([{ code: 'PROPOSE_CLOTH_PART', object, detail: `names "${name}", which is no part in parts.json; every part in the list must exist in parts.json` }]);
      }
      if (splitFrom(q.from)[0] === PAINTING_RUN) {
        throw new PartsError([{ code: 'PROPOSE_CLOTH_PART', object, detail: `names "${name}", from ${q.from}; a painting patch has no layer tag and cannot be part of a cloth tree` }]);
      }
      list.push(q);
    }
    return { field: raw.field, list };
  };
  // Issue #391: the tails the back hair recipe drafts, each with its mesh's spans, which an accessory wrapped round one rides.
  const tails: Tail[] = [];
  const T = (p: PartRecord | readonly PartRecord[], tag: ClothTarget, r: ClothRecipe, input: TreeInput): TreeChain[] => {
    const partNames = Array.isArray(p) ? p.map((x) => x.name) : [(p as PartRecord).name];
    const trees = draftTrees(input, r);
    const constants = [konst('cloth_chains', input.masses !== undefined ? input.masses.length : (r.chains ?? RECIPE_BACK_HAIR_CHAINS)), konst('cloth_links', r.links), konst('length_ratio', roundTo(r.length_ratio ?? RECIPE_LENGTH_RATIO, 6))];
    for (const t of trees) {
      C(
        t.chain,
        t.parent,
        t.points,
        t.tip,
        t.why.map((w) => placement('mask', w, { parts: partNames, bones: [input.parent], constants })),
        placement('mask', t.tipWhy, { parts: partNames, bones: [input.parent], constants }),
      );
    }
    clothUsed.add(tag);
    return trees;
  };
  B('hip', 'root', hip, hipWhy);
  B(
    'chest',
    'hip',
    chest,
    placement('derived', chestAlong ? 'half way from neck to hip, along the line between them' : "at hip's x, half way from neck's y down to hip's y", { bones: ['neck', 'hip'], constants: [konst('share_neck_to_hip', 0.5)] }),
  );
  B('neck', 'chest', neckAt, neckWhy);
  B('head', 'neck', head, placement('ratio', '0.88 face heights below the top of the face box, on the eye axis', { frame: ['face_box', 'eye_axis'], constants: [konst('face_heights_below_top', 0.88)] }));
  for (const s of ['r', 'l'] as const) {
    const e = eyes.get(s);
    if (e !== undefined) {
      B(`eye_${s}`, 'head', e, placement('mask', `the centre of ${(ew[s] as PartRecord).name}'s box`, { parts: [(ew[s] as PartRecord).name] }));
      // The reference keyed this by the literal "eyewhite_<s>"; keyed by the
      // part's own name it is the same entry whenever that is the name, and
      // not a region for a part that does not exist when it is not.
      regions[(ew[s] as PartRecord).name] = `eye_${s}`;
    }
  }
  // Brows by POSITION, not by tag: the head run has swapped the two brow tags
  // and lost one side, and a tag-bound brow bone then sits on the other eye.
  const browOf = new Map<string, string>();
  const bySide = new Map<'r' | 'l', PartRecord[]>();
  for (const b of [...P.byTag('eyebrow-r'), ...P.byTag('eyebrow-l')]) {
    const side = center(b)[0] < axis ? 'r' : 'l';
    if (!bySide.has(side)) bySide.set(side, []);
    (bySide.get(side) as PartRecord[]).push(b);
    browOf.set(b.name, `brow_${side}`);
    if (splitFrom(b.from)[1] !== `eyebrow-${side}`) notes.push(`${b.name} (${b.from}) sits on the ${side} side of the eye axis: bound to brow_${side}`);
  }
  for (const s of ['r', 'l'] as const) {
    const group = bySide.get(s);
    if (group !== undefined) {
      const cs = group.map(center);
      B(
        `brow_${s}`,
        'head',
        [npMean(cs.map((c) => c[0])), npMean(cs.map((c) => c[1]))],
        placement('mask', `the mean of the box centres of the eyebrow parts on the ${s} side of the eye axis`, { parts: group.map((p) => p.name), frame: ['eye_axis'] }),
      );
    }
  }
  const mouth = P.headFirst('mouth');
  if (mouth.length > 0) {
    // The centroid of the biggest blob: stray pixels inflate the box.
    const cc = connectedComponents(P.alpha(mouth[0]), 8);
    if (cc.count > 1) {
      let best = 1;
      for (let i = 2; i < cc.count; i++) if (cc.stats[i].area > cc.stats[best].area) best = i;
      B('mouth', 'head', [cc.stats[best].cx, cc.stats[best].cy], placement('mask', `the centroid of the biggest 8-connected blob of ${mouth[0].name}`, { parts: [mouth[0].name] }));
    } else B('mouth', 'head', center(mouth[0]), placement('mask', `the centre of ${mouth[0].name}'s box`, { parts: [mouth[0].name], fallback: 'its mask has no opaque pixel, so no blob' }));
  }
  // Issue #250: the head's frame, read off the head run once, written as notes. The bar is the line through the eye
  // bones' origins as written here: the one roll the rig turns the face bones to (src/headframe.ts).
  notes.push(...headFrameNotes(P, bones));
  // An eye bone comes only from an eyewhite (EYE_GROUP_TAGS). An iris or a
  // lash on a side with none has no eye bone to ride, and writing its region
  // as `eye_<s>` anyway named a bone that does not exist — refused by the
  // loader as the symptom (`config.regions.<part> — is "eye_r"`), never the
  // cause (issue #45). Such a part rides `head` — the bone the eye bone would
  // hang from and the one the face beside it already rides — so no value is
  // invented, the proposal stays one a person can correct, and the note names
  // the cause.
  const eyeless: string[] = [];
  const eyelessSides = new Set<'r' | 'l'>();
  for (const p of P.layered()) {
    // A cut's piece takes no tag's role (issue #230): it falls to the trunk rule below, which says so.
    if (p.cut_from !== undefined) continue;
    const t = splitFrom(p.from)[1];
    let role: string | undefined = TAG_REGION[t];
    if (browOf.has(p.name)) role = browOf.get(p.name);
    const side = role === 'eye_r' ? 'r' : role === 'eye_l' ? 'l' : null;
    if (side !== null && !eyes.has(side)) {
      role = 'head';
      eyeless.push(`${p.name} (${p.from})`);
      eyelessSides.add(side);
    }
    if (role !== undefined) regions[p.name] = role;
  }
  if (eyeless.length > 0) {
    const sides = (['r', 'l'] as const).filter((s) => eyelessSides.has(s));
    notes.push(
      `no eyewhite part for ${sides.map((s) => `eye_${s}`).join(', ')} (looked for: ${sides.map((s) => `eyewhite-${s}`).join(', ')}): ${eyeless.join(', ')} ${eyeless.length === 1 ? 'is' : 'are'} placed on head as ${eyeless.length === 1 ? 'a region' : 'regions'}, rigid with the head and not blinking — an eye bone comes only from an eyewhite`,
    );
  }
  // A blink group rigc is handed must name a member (rigc refuses `group
  // "eyes" declares no members`), so a group with none is not written, and a
  // blink with no eyes is not written at all: a value with nothing to act on
  // would be invented. Each omission is a note naming the tags looked for.
  const eyeBonesProposed = (['r', 'l'] as const).filter((s) => eyes.has(s)).map((s) => `eye_${s}`);
  const browBonesProposed = (['r', 'l'] as const).filter((s) => bySide.has(s)).map((s) => `brow_${s}`);
  let blink: ProposedBlink | undefined;
  if (eyeBonesProposed.length === 0) {
    const brows = browBonesProposed.length === 0 ? '' : `; ${browBonesProposed.join(', ')} ${browBonesProposed.length === 1 ? 'is' : 'are'} placed and nothing drops ${browBonesProposed.length === 1 ? 'it' : 'them'}`;
    notes.push(`no blink: no eyewhite part (looked for: ${EYE_GROUP_TAGS.join(', ')}), so the blink's eyes group would name no bone${brows}`);
  } else {
    blink = browBonesProposed.length === 0 ? { t: 2.3, eyes: eyeBonesProposed, squash: 0.12 } : { t: 2.3, eyes: eyeBonesProposed, brows: browBonesProposed, squash: 0.12, brow_drop: 1.2 };
    const still = lashStills(P, ew, notes);
    if (Object.keys(still).length > 0) blink.still = still;
    if (browBonesProposed.length === 0) notes.push(`blink without brows: no eyebrow part (looked for: ${BROW_GROUP_TAGS.join(', ')}), so the blink has no brows group and no brow_drop`);
  }
  // Issue #252: the breath's travel is BREATH_FRACTION of the torso, not the reference's fixed 1.3 px amplitude; issue
  // #270: the torso is the neck -> hip run as the two bones are written above, not a garment's height. Its base stays
  // its amplitude (the chest rises from the setup pose and returns). The other three tracks are an angle and a ratio
  // and stay as drafted. A trunk of no length (neck and hip on one point) keeps the reference's amplitude, and a note.
  const writtenAt = (n: string): Point => (bones.find((b) => 'name' in b && b.name === n) as { at: Point }).at;
  const breath = breathTrack(writtenAt('neck'), writtenAt('hip'));
  notes.push(breath.note);
  tracks.push(
    breath.track,
    { bone: 'chest', prop: 'scalex', amp: 0.004, period: 4.0, phase: 0.0, base: 1.004 },
    { bone: 'head', prop: 'rotate', amp: 0.9, period: 4.0, phase: 0.12 },
    { bone: 'neck', prop: 'rotate', amp: 0.35, period: 4.0, phase: 0.08 },
  );

  // Issue #265: the figure's spacing unless the reference's rule is asked for; r is the part rule's either way.
  const fig = figureGrid(P.recs);
  const ownGrid = new Map<string, number>();
  const gridR = (p: PartRecord): [number, number] => {
    const [g, r] = partGrid(p);
    ownGrid.set(p.name, g);
    return [gridRule === 'part' ? g : Math.max(g, fig.grid), r];
  };

  // ---- back hair
  const backHairParts = declaredPartsOf('back hair');
  const backHairSingleSame =
    backHairParts !== null &&
    backHairParts.list.length === 1 &&
    P.headFirst('back hair').length === 1 &&
    backHairParts.list[0] === P.headFirst('back hair')[0] &&
    SIDES.every(([s]) => {
      const m = P.alpha(backHairParts.list[0]);
      for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
          if ((s === 'r' ? x < axis : x >= axis) && m.data[y * m.width + x] !== 0) return true;
        }
      }
      return false;
    });
  if (backHairSingleSame) {
    const p0 = backHairParts.list[0];
    if (p0.y + p0.h < neckY + 0.5 * fh) {
      throw new PartsError([
        {
          code: 'PROPOSE_CLOTH_PART',
          object: `config.cloth."back hair".${backHairParts.field}`,
          detail: `names "${p0.name}" (${p0.from}, box y=${p0.y}..${p0.y + p0.h}), which ends above the shoulders (y=${pyFixed(neckY + 0.5 * fh, 1)}), where the proposer drafts a bun bone with no tree links — no tree link crosses "${p0.name}"`,
        },
      ]);
    }
  } else if (backHairParts !== null) {
    const { field, list } = backHairParts;
    const object = `config.cloth."back hair".${field}`;
    const rawRcp = recipeOf('back hair') as ClothRecipe;
    const p0 = list[0];
    const m0 = P.alpha(p0);
    const shoulderLine = neckY + 0.5 * fh;
    const sideHasBelow = (m: Mask, s: 'r' | 'l', yMin: number): boolean => {
      const r0 = Math.max(0, Math.ceil(yMin));
      for (let y = r0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
          if ((s === 'r' ? x < axis : x >= axis) && m.data[y * m.width + x] !== 0) return true;
        }
      }
      return false;
    };
    const activeSides = SIDES.filter(([s]) => list.some((q) => sideHasBelow(P.alpha(q), s, shoulderLine)));
    if (activeSides.length === 0) {
      throw new PartsError([
        {
          code: 'PROPOSE_CLOTH_PART',
          object,
          detail: `names "${p0.name}" (${p0.from}, box y=${p0.y}..${p0.y + p0.h}), which has no art below the shoulders (y=${pyFixed(shoulderLine, 1)}) — no back hair tree link crosses "${p0.name}"`,
        },
      ]);
    }
    const unionMask = newMask(P.W, P.H);
    unionMask.data.set(m0.data);
    for (let idx = 1; idx < list.length; idx++) {
      const mq = P.alpha(list[idx]);
      for (const [s] of activeSides) {
        for (let y = 0; y < P.H; y++) {
          let p0HasRow = false;
          for (let x = 0; x < P.W; x++) {
            if ((s === 'r' ? x < axis : x >= axis) && m0.data[y * P.W + x] !== 0) {
              p0HasRow = true;
              break;
            }
          }
          if (p0HasRow) continue;
          for (let x = 0; x < P.W; x++) {
            if ((s === 'r' ? x < axis : x >= axis) && mq.data[y * P.W + x] !== 0) {
              unionMask.data[y * P.W + x] = 1;
            }
          }
        }
      }
    }
    const uRows = rowsAny(unionMask);
    const top = uRows.length > 0 ? uRows[0] : p0.y;
    const bot = uRows.length > 0 ? uRows[uRows.length - 1] + 1 : p0.y + p0.h;
    const [g, r] = gridR(p0);
    const dilated = dilate(unionMask, 31);
    const y0 = pyRound(eyeY);
    const sideOpaqueWidth = (s: 'r' | 'l'): number => {
      if (y0 < 0 || y0 >= unionMask.height) return 0;
      let w = 0;
      for (let x = 0; x < unionMask.width; x++) {
        if ((s === 'r' ? x < axis : x >= axis) && unionMask.data[y0 * unionMask.width + x]) w++;
      }
      return w;
    };
    const prefixOf = (s: 'r' | 'l'): string => `hairback_${s}`;
    const offRootsAt = (cnt: number, s: 'r' | 'l'): Array<{ bone: string; at: Point; alpha: number }> => {
      const pref = prefixOf(s);
      const im = P.images.get(p0.name) as Raster;
      const off: Array<{ bone: string; at: Point; alpha: number }> = [];
      for (let k = 0; k < cnt; k++) {
        const fc = (k + 0.5) / cnt;
        const rx = pyRound(bandX(unionMask, eyeY, { frac: fc, side: s, axis }) ?? axis);
        if (!isOn(dilated, rx, y0)) {
          const lx = rx - p0.x;
          const ly = y0 - p0.y;
          const alpha = lx >= 0 && lx < p0.w && ly >= 0 && ly < p0.h ? im.data[(ly * p0.w + lx) * 4 + 3] : 0;
          off.push({ bone: `${pref}${k}_0`, at: [rx, y0], alpha });
        }
      }
      return off;
    };
    const sideWidths = activeSides.map(([s]) => sideOpaqueWidth(s));
    const widthCap = Math.max(1, Math.min(...sideWidths.map((w) => Math.floor(w / g))));
    let maxFit = 1;
    for (let cnt = widthCap; cnt >= 1; cnt--) {
      if (activeSides.every(([s]) => offRootsAt(cnt, s).length === 0)) {
        maxFit = cnt;
        break;
      }
    }
    if (rawRcp.chains !== undefined) {
      const offRoots = activeSides.flatMap(([s]) => offRootsAt(rawRcp.chains as number, s));
      if (rawRcp.chains > widthCap || offRoots.length > 0) {
        const wR = sideOpaqueWidth('r');
        const wL = sideOpaqueWidth('l');
        throw new PartsError([
          {
            code: 'PROPOSE_CLOTH_BACK_HAIR_CHAINS',
            object: 'config.cloth."back hair".chains',
            detail:
              `declares ${rawRcp.chains} tree(s) per side on "${p0.name}", and at the root row y=${y0} the tail is ${wR} px wide on the r side and ${wL} px on the l side on a ${g} px mesh grid (at most ${maxFit} tree(s) per side fit inside the art` +
              (offRoots.length > 0 ? `; off the art: ${offRoots.map((o) => `${o.bone} at [${o.at[0]}, ${o.at[1]}] (alpha ${o.alpha})`).join(', ')}` : '') +
              `) — set chains to at most ${maxFit}, or leave chains out to derive it from the tail's width`,
          },
        ]);
      }
    }
    const massesBySide = new Map<'r' | 'l', BackHairMass[]>(activeSides.map(([s]) => [s, backHairMasses(unionMask, s, axis, y0, shoulderLine, g)]));
    const useMasses = rawRcp.chains === undefined;
    const all: TreeChain[] = [];
    let n = 0;
    const partNamesLabel = list.map((q) => q.name).join(' -> ');
    const sideTreeCounts: number[] = [];
    for (const [side] of activeSides) {
      const prefix = prefixOf(side);
      const sideMasses = massesBySide.get(side) ?? [];
      if (useMasses && sideMasses.length === 0) continue;
      const frame = `${partNamesLabel}'s art on the ${side} side of the eye axis (no art there in the band: the eye axis x)`;
      const sideMassInputs: TreeMassInput[] | undefined = useMasses
        ? sideMasses.flatMap((m): TreeMassInput[] => {
            const count = backHairMassTrees(m, g);
            return Array.from({ length: count }, (_, t): TreeMassInput => ({
              rootY: m.minY <= y0 ? eyeY : m.minY,
              tipY: m.maxY >= bot - 12 ? bot - 4 : Math.max(m.minY + 4, m.maxY - 3),
              xAt: (y, f) => bandX(m.mask, y, { frac: f, side, axis }),
              fallbackX: m.minY <= y0 && sideMasses.length === 1 && count === 1 ? () => axis : (f) => pyRound(m.minX + f * (m.maxX - m.minX)),
              frame,
              treeInMass: t,
              treesInMass: count,
            }));
          })
        : undefined;
      const sideCount = sideMassInputs !== undefined ? sideMassInputs.length : (rawRcp.chains ?? Math.min(RECIPE_BACK_HAIR_CHAINS, maxFit));
      sideTreeCounts.push(sideCount);
      const sideRcp: ClothRecipe = { ...rawRcp, chains: sideCount };
      const trees = T(list, 'back hair', sideRcp, {
        prefix,
        parent: 'head',
        rootY: eyeY,
        tipY: bot - 4,
        xAt: (y, f) => bandX(unionMask, y, { frac: f, side, axis }),
        fallbackX: () => axis,
        frame,
        edges: side,
        masses: sideMassInputs,
      });
      const made = treeConstraints(trees, sideRcp, null);
      clothConstraints.push(...made);
      n += made.length;
      all.push(...trees);
    }
    const rcp: ClothRecipe = {
      ...rawRcp,
      chains: useMasses ? Math.max(1, ...sideTreeCounts) : (rawRcp.chains ?? Math.min(RECIPE_BACK_HAIR_CHAINS, maxFit)),
    };
    const spans: Array<TailSpan & { depth: number }> = [{ bone: 'head', a: rnd(head), b: rnd([axis, top + 13]), link: false, depth: -1 }];
    for (const t of all) {
      const line = [...t.points, t.tip];
      t.points.forEach((q, i) => spans.push({ bone: `${t.chain}${i}`, a: q, b: line[i + 1], link: true, depth: t.depths[i] }));
    }
    let prevMinD = -1;
    let prevMaxD = -1;
    const linkSummary: string[] = [];
    for (let idx = 0; idx < list.length; idx++) {
      const q = list[idx];
      const mq = P.alpha(q);
      const crossedLinks = spans.filter((sp) => sp.link && spanCrosses(sp, mq) > 0);
      if (crossedLinks.length === 0) {
        const linkDesc = spans
          .filter((sp) => sp.link)
          .map((sp) => `${sp.bone} [${sp.a[0]}, ${sp.a[1]}]->[${sp.b[0]}, ${sp.b[1]}]`)
          .join(', ');
        throw new PartsError([
          {
            code: 'PROPOSE_CLOTH_PART',
            object,
            detail: `names "${q.name}" (${q.from}, box x=${q.x}..${q.x + q.w}, y=${q.y}..${q.y + q.h}), which no link of the drafted tree crosses (${linkDesc}: 0 px on "${q.name}") — every part in ${field} must be crossed by at least one link of the tree`,
          },
        ]);
      }
      const minD = Math.min(...crossedLinks.map((sp) => sp.depth));
      const maxD = Math.max(...crossedLinks.map((sp) => sp.depth));
      if (idx > 0 && (minD < prevMinD || maxD < prevMaxD)) {
        throw new PartsError([
          {
            code: 'PROPOSE_CLOTH_PART',
            object,
            detail: `names "${q.name}" after "${list[idx - 1].name}", and "${q.name}" is crossed at link depth ${minD}..${maxD} while "${list[idx - 1].name}" is crossed at depth ${prevMinD}..${prevMaxD} — list parts in order from root to tip`,
          },
        ]);
      }
      prevMinD = minD;
      prevMaxD = maxD;
      const [gq, rq] = q === p0 ? [g, r] : gridR(q);
      const qSegs: Segment[] = [];
      const crossedDesc: string[] = [];
      for (const sp of spans) {
        const px = spanCrosses(sp, mq);
        if (px > 0) {
          qSegs.push(sp.link ? sp.bone : [sp.bone, sp.a, sp.b]);
          if (sp.link) crossedDesc.push(`${sp.bone} (${px} px)`);
        }
      }
      linkSummary.push(`${q.name}: ${crossedDesc.join(', ')}`);
      delete regions[q.name];
      meshes[q.name] = { grid: gq, r: rcp.split?.hold_tip === true ? Math.max(rq, gq) : rq, segments: qSegs };
      clothMeshed.set(q.name, 'back hair');
      multiPartClaimed.add(q.name);
    }
    notes.push(
      clothNote(
        partNamesLabel,
        'back hair',
        all,
        rcp,
        n,
        ` across ${list.length} parts in root-to-tip order (${linkSummary.join('; ')}), from head, rooted on the eye line and tipped 4 px above ${list[list.length - 1].name}'s bottom`,
      ),
    );
    tails.push({ part: p0.name, mask: unionMask, spans });
  }
  for (const p of P.headFirst('back hair')) {
    if (multiPartClaimed.has(p.name)) continue;
    const [g, r] = gridR(p);
    const top = p.y;
    const bot = p.y + p.h;
    if (bot < neckY + 0.5 * fh && isOn(dilate(P.alpha(p), 31), pyRound(axis), pyRound(bot - 0.1 * p.h))) {
      B(
        'bun',
        'head',
        [axis, top + 0.36 * p.h],
        placement('ratio', `0.36 of ${p.name}'s height below its top, on the eye axis`, { parts: [p.name], frame: ['eye_axis'], constants: [konst('of_part_height_below_top', 0.36)] }),
        [axis, bot - 0.1 * p.h],
        placement('ratio', `0.1 of ${p.name}'s height above its bottom, on the eye axis`, { parts: [p.name], frame: ['eye_axis'], constants: [konst('of_part_height_above_bottom', 0.1)] }),
      );
      meshes[p.name] = { grid: g, r, segments: [['head', rnd(head), rnd([axis, top + 13])], 'bun'] };
      tracks.push({ bone: 'bun', prop: 'rotate', amp: 0.8, period: 4.0, phase: 0.2 });
    } else if (recipeOf('back hair') !== null && (backHairParts === null || backHairSingleSame)) {
      // Issue #364: the recipe's trees, per side of the eye axis (twin tails are a side each), from the eye line to
      // 4 px above the part's bottom, in place of the two keyed chains.
      // Issue #390: an explicit tree count per side that exceeds `floor(width / grid)` at the root row or roots a tree
      // outside the 15 px dilated art is refused by name (`PROPOSE_CLOTH_BACK_HAIR_CHAINS`).
      // Issue #445: when `chains` is omitted, the tree count on each side is the number of visible hair masses on that
      // side (connected components below the root row, merged within one grid cell), one tree per mass, rooted at that
      // mass's top row and inside its columns.
      const rawRcp = recipeOf('back hair') as ClothRecipe;
      const mask = P.alpha(p);
      const dilated = dilate(mask, 31);
      const y0 = pyRound(eyeY);
      const sideOpaqueWidth = (s: 'r' | 'l'): number => {
        if (y0 < 0 || y0 >= mask.height) return 0;
        let w = 0;
        for (let x = 0; x < mask.width; x++) {
          if ((s === 'r' ? x < axis : x >= axis) && mask.data[y0 * mask.width + x]) w++;
        }
        return w;
      };
      const prefixOf = (s: 'r' | 'l'): string => (P.headFirst('back hair').length === 1 ? `hairback_${s}` : `hairback_${p.name}_${s}`);
      const offRootsAt = (cnt: number, s: 'r' | 'l'): Array<{ bone: string; at: Point; alpha: number }> => {
        const pref = prefixOf(s);
        const im = P.images.get(p.name) as Raster;
        const off: Array<{ bone: string; at: Point; alpha: number }> = [];
        for (let k = 0; k < cnt; k++) {
          const fc = (k + 0.5) / cnt;
          const rx = pyRound(bandX(mask, eyeY, { frac: fc, side: s, axis }) ?? axis);
          if (!isOn(dilated, rx, y0)) {
            const lx = rx - p.x;
            const ly = y0 - p.y;
            const alpha = lx >= 0 && lx < p.w && ly >= 0 && ly < p.h ? im.data[(ly * p.w + lx) * 4 + 3] : 0;
            off.push({ bone: `${pref}${k}_0`, at: [rx, y0], alpha });
          }
        }
        return off;
      };
      const wR = sideOpaqueWidth('r');
      const wL = sideOpaqueWidth('l');
      const widthCap = Math.max(1, Math.min(Math.floor(wR / g), Math.floor(wL / g)));
      let maxFit = 1;
      for (let cnt = widthCap; cnt >= 1; cnt--) {
        if (offRootsAt(cnt, 'r').length === 0 && offRootsAt(cnt, 'l').length === 0) {
          maxFit = cnt;
          break;
        }
      }
      if (rawRcp.chains !== undefined) {
        const offRoots = [...offRootsAt(rawRcp.chains, 'r'), ...offRootsAt(rawRcp.chains, 'l')];
        if (rawRcp.chains > widthCap || offRoots.length > 0) {
          throw new PartsError([
            {
              code: 'PROPOSE_CLOTH_BACK_HAIR_CHAINS',
              object: 'config.cloth."back hair".chains',
              detail:
                `declares ${rawRcp.chains} tree(s) per side on "${p.name}", and at the root row y=${y0} the tail is ${wR} px wide on the r side and ${wL} px on the l side on a ${g} px mesh grid (at most ${maxFit} tree(s) per side fit inside the art` +
                (offRoots.length > 0 ? `; off the art: ${offRoots.map((o) => `${o.bone} at [${o.at[0]}, ${o.at[1]}] (alpha ${o.alpha})`).join(', ')}` : '') +
                `) — set chains to at most ${maxFit}, or leave chains out to derive it from the tail's width`,
            },
          ]);
        }
      }
      const shoulderLine = neckY + 0.5 * fh;
      const rMasses = backHairMasses(mask, 'r', axis, y0, shoulderLine, g);
      const lMasses = backHairMasses(mask, 'l', axis, y0, shoulderLine, g);
      const massesBySide = new Map<'r' | 'l', BackHairMass[]>([
        ['r', rMasses],
        ['l', lMasses],
      ]);
      const useMasses = rawRcp.chains === undefined;
      const segs: Segment[] = [['head', rnd(head), rnd([axis, top + 13])]];
      const all: TreeChain[] = [];
      let n = 0;
      const treeCountBySide = new Map<'r' | 'l', number>([
        ['r', 0],
        ['l', 0],
      ]);
      for (const [side] of SIDES) {
        const prefix = prefixOf(side);
        const sideMasses = massesBySide.get(side) ?? [];
        if (useMasses && sideMasses.length === 0) continue;
        const frame = `${p.name}'s art on the ${side} side of the eye axis (no art there in the band: the eye axis x)`;
        const sideMassInputs: TreeMassInput[] | undefined = useMasses
          ? sideMasses.flatMap((m): TreeMassInput[] => {
              const count = backHairMassTrees(m, g);
              return Array.from({ length: count }, (_, t): TreeMassInput => ({
                rootY: m.minY <= y0 ? eyeY : m.minY,
                tipY: m.maxY >= bot - 12 ? bot - 4 : Math.max(m.minY + 4, m.maxY - 3),
                xAt: (y, f) => bandX(m.mask, y, { frac: f, side, axis }),
                fallbackX: m.minY <= y0 && sideMasses.length === 1 && count === 1 ? () => axis : (f) => pyRound(m.minX + f * (m.maxX - m.minX)),
                frame,
                treeInMass: t,
                treesInMass: count,
              }));
            })
          : undefined;
        const sideCount = sideMassInputs !== undefined ? sideMassInputs.length : (rawRcp.chains ?? Math.min(RECIPE_BACK_HAIR_CHAINS, maxFit));
        treeCountBySide.set(side, sideCount);
        const sideRcp: ClothRecipe = { ...rawRcp, chains: sideCount };
        const trees = T(p, 'back hair', sideRcp, {
          prefix,
          parent: 'head',
          rootY: eyeY,
          tipY: bot - 4,
          xAt: (y, f) => bandX(mask, y, { frac: f, side, axis }),
          fallbackX: () => axis,
          frame,
          edges: side,
          masses: sideMassInputs,
        });
        for (const t of trees) segs.push(t.chain);
        const made = treeConstraints(trees, sideRcp, null);
        clothConstraints.push(...made);
        n += made.length;
        all.push(...trees);
      }
      const rTreeCount = treeCountBySide.get('r') ?? 0;
      const lTreeCount = treeCountBySide.get('l') ?? 0;
      const sameSideCounts = !useMasses || rTreeCount === lTreeCount;
      const noteRcp: ClothRecipe = {
        ...rawRcp,
        chains: useMasses ? (sameSideCounts ? rTreeCount : rTreeCount + lTreeCount) : (rawRcp.chains ?? Math.min(RECIPE_BACK_HAIR_CHAINS, maxFit)),
      };
      const massReason = rTreeCount === rMasses.length && lTreeCount === lMasses.length ? 'one per visible hair mass' : 'across the visible hair masses by root-row width';
      notes.push(
        clothNote(
          p.name,
          'back hair',
          all,
          noteRcp,
          n,
          sameSideCounts
            ? ' per side of the eye axis, from head, rooted on the eye line and tipped 4 px above its bottom'
            : ` (${rTreeCount} on the r side and ${lTreeCount} on the l side of the eye axis, ${massReason}), from head, rooted on each mass's top row and tipped 4 px above its bottom`,
        ),
      );
      meshes[p.name] = { grid: g, r: rawRcp.split?.hold_tip === true ? Math.max(r, g) : r, segments: segs };
      clothMeshed.set(p.name, 'back hair');
      // Issue #391: the spans are this mesh's segments, the head's fixed one and every tree link, in segment order.
      const spans: TailSpan[] = [{ bone: 'head', a: rnd(head), b: rnd([axis, top + 13]), link: false }];
      for (const t of all) {
        const line = [...t.points, t.tip];
        t.points.forEach((q, i) => spans.push({ bone: `${t.chain}${i}`, a: q, b: line[i + 1], link: true }));
      }
      tails.push({ part: p.name, mask, spans });
    } else {
      const mask = P.alpha(p);
      const segs: Segment[] = [['head', rnd(head), rnd([axis, top + 13])]];
      for (const [s, sgn] of SIDES) {
        const y0 = eyeY;
        const why: Placement[] = [];
        const pts: Array<[number, number]> = [0, 1, 2].map((k) => {
          const w = placement('mask', `link ${k}: the centroid x of ${p.name}'s art on the ${s} side of the eye axis, in the 24-row band at ${k}/4 of the way from the eye line to its bottom`, {
            parts: [p.name],
            frame: ['eye_axis', 'eye_line'],
            constants: [konst('share_eye_line_to_bottom', k / 4)],
          });
          why.push(w);
          return [orSaid(bandX(mask, y0 + (k * (bot - y0)) / 4, { side: s, axis }), axis, 'no art on that side in the band: the eye axis x', w), y0 + (k * (bot - y0)) / 4];
        });
        C(`hairback_${s}`, 'head', pts, [pts[pts.length - 1][0], bot - 4], why, placement('mask', `4 px above the bottom of ${p.name}, at the last link's x`, { parts: [p.name], bones: [`hairback_${s}2`] }));
        segs.push(`hairback_${s}`);
        tracks.push({ chain: `hairback_${s}`, amps: [sgn * 0.6, sgn * 1.4, sgn * 2.4], period: 4.0, phase: 0.2, lag: 0.08 });
      }
      meshes[p.name] = { grid: g, r, segments: segs };
    }
  }

  // ---- front hair: fringe + locks
  // Issue #249: the fringe's columns stand in the head's frame — the roll read once, off the eye bones as written
  // (headRollOf, the one derivation) — and each column's root sits on the part's own art. With no eye pair the
  // frame is the page's, said in a note.
  const roll = headRollOf(bones, P.H);
  const ax = headAxes('none' in roll ? 0 : roll.degrees, P.H);
  const eyeMid: [number, number] = [axis, eyeY];
  const turned = 'none' in roll ? 'on the page' : `along the head's down axis (the eye line's perpendicular, roll ${pyFixed(roll.degrees, 3)} degrees)`;
  const rollBones = 'none' in roll ? [] : ['eye_r', 'eye_l'];
  for (const p of P.headFirst('front hair')) {
    if (multiPartClaimed.has(p.name)) continue;
    const [g, r] = gridR(p);
    const mask = P.alpha(p);
    const top = p.y;
    const segs: Segment[] = [['head', rnd(head), rnd([axis, top])]];
    // Depths along the face's down axis from the eye line (through the eye midpoint): the brow line and the tip's.
    const browD = -0.18 * fh;
    const tipD = browD + 19;
    const columns: string[] = [];
    for (const [tag, f, dx] of [
      ['bang_r', 0.25, -FRINGE_STEP_PX],
      ['bang_c', 0.5, 0],
      ['bang_l', 0.75, FRINGE_STEP_PX],
    ] as const) {
      const foot = ax.at(eyeMid, fx0 + f * fw - axis, 0);
      // The root is 13 px into a run of the column's art and above the brow line: the lowest run that holds such a
      // point. A strand's end under the fringe (demo's centre column has one, 7 px below it) or a lock that starts
      // at the brow line is not where the fringe's lock starts.
      const runs = columnRuns(mask, p, ax, foot);
      const held = runs.filter(([s0, s1]) => s0 + 13 < browD && s0 + 13 <= s1);
      const artD = held.length === 0 ? null : held[held.length - 1][0];
      const d0 = (artD ?? boxEntry(p, ax, foot)) + 13;
      const d1 = (d0 + browD) / 2 + 6;
      const rootWhy = placement(
        'mask',
        `link 0: on the column at ${f} of the face box's width from its left, ${turned}, 13 px below where ${p.name}'s art starts on that column — the lowest run of its art there that holds a point 13 px in and above the brow line (0.18 face heights above the eye line)`,
        {
          parts: [p.name],
          bones: rollBones,
          frame: ['face_box', 'eye_axis', 'eye_line'],
          constants: [konst('of_face_width', f), konst('px_below_art_start', 13)],
          fallback: artD === null ? `no run of ${p.name}'s art on the column holds a point 13 px in above the brow line: 13 px below the top of its box along the column` : null,
        },
      );
      C(
        tag,
        'head',
        [ax.at(foot, 0, d0), ax.at(foot, dx, d1)],
        ax.at(foot, dx * 1.8, tipD),
        [
          rootWhy,
          placement('ratio', `link 1: ${dx} px across the column from link 0, 6 px below half way from link 0 to the brow line (0.18 face heights above the eye line), ${turned}`, {
            parts: [p.name],
            bones: rollBones,
            frame: ['face_box', 'eye_line'],
            constants: [konst('px_across', dx), konst('px_below_half_way', 6), konst('brow_line_face_heights_above_eye_line', 0.18)],
          }),
        ],
        placement('ratio', `${dx * 1.8} px across the column (1.8 times link 1's step), 19 px below the brow line (0.18 face heights above the eye line), ${turned}`, {
          bones: rollBones,
          frame: ['face_box', 'eye_line'],
          constants: [konst('times_link_1_offset', 1.8), konst('px_below_brow_line', 19), konst('brow_line_face_heights_above_eye_line', 0.18)],
        }),
      );
      segs.push(tag);
      columns.push(tag);
      const fringeRecipe = recipeOf('front hair');
      if (fringeRecipe !== null) {
        // Issue #364: under the recipe the fringe's two links carry physics, an outer column the edge's, and no key.
        clothConstraints.push(...chainConstraints(tag, 2, columns.length - 1, tag !== 'bang_c', fringeRecipe));
        clothUsed.add('front hair');
        continue;
      }
      const a = tag === 'bang_c' ? 0.8 : 1.0;
      tracks.push({ chain: tag, amps: [a, Number((a * 2.2).toFixed(4))], period: 4.0, phase: 0.18, lag: 0.1 });
    }
    notes.push(
      `${p.name} (${p.from}): ${columns.join(', ')} are a template, not its locks — columns at 0.25, 0.5 and 0.75 of the face box's width, ${turned}, each rooted on the part's art; ` +
        `the opaque shape does not separate the locks painted inside one mass of hair, so a lock that runs elsewhere is not followed — move the chains onto the locks` +
        ('none' in roll ? `; no head frame to turn the columns to: ${roll.none}` : ''),
    );
    if (recipeOf('front hair') !== null) {
      notes.push(
        `${p.name} (${p.from}): config.cloth."front hair" -> ${columns.join(', ')} carry physics on both links (bang_r and bang_l the edge's strength, bang_c the trunk's; wind and gravity on the recipe's root-to-tip ramp over their two links) and no idle key; the recipe's chains, links and split shape the hanging strands, not the fringe`,
      );
    }
    const below = newMask(P.W, P.H);
    below.data.set(mask.data);
    const [c0, c1] = pySlice(0, pyInt(chin) + 4, P.H);
    below.data.fill(0, c0 * P.W, c1 * P.W);
    const cc = connectedComponents(below, 8);
    let k = 0;
    for (let i = 1; i < cc.count; i++) {
      const st = cc.stats[i];
      if (st.height < 0.3 * fh) continue;
      const comp = newMask(P.W, P.H);
      for (let j = 0; j < comp.data.length; j++) comp.data[j] = cc.labels[j] === i ? 1 : 0;
      const bot = st.top + st.height;
      const y0 = eyeY - 0.22 * fh;
      const span = bot + 5 - y0;
      const cm = newMask(P.W, P.H);
      for (let y = 0; y < P.H; y++) {
        for (let x = 0; x < P.W; x++) {
          const j = y * P.W + x;
          cm.data[j] = comp.data[j] | (mask.data[j] & (Math.abs(x - st.cx) < 25 ? 1 : 0));
        }
      }
      const name = k === 0 ? 'lock' : `lock${k}_`;
      const lockRecipe = recipeOf('front hair');
      if (lockRecipe !== null) {
        // Issue #364: the strand hangs as the recipe's trees, across its own art, from the same root row to 5 px below it.
        const trees = T(p, 'front hair', lockRecipe, {
          prefix: `${name.replace(/_$/, '')}t`,
          parent: 'head',
          rootY: y0,
          tipY: bot + 5,
          xAt: (y, f) => bandX(cm, y, { frac: f }),
          fallbackX: () => st.cx,
          frame: `the strand of ${p.name} that hangs below the chin (with ${p.name}'s art within 25 px of its centre x; no art in the band: the strand's centre x)`,
          edges: 'both',
        });
        for (const t of trees) segs.push(t.chain);
        const made = treeConstraints(trees, lockRecipe, null);
        clothConstraints.push(...made);
        notes.push(clothNote(p.name, 'front hair', trees, lockRecipe, made.length, ` on the strand at x ${pyFixed(st.cx, 0)}, from head, rooted 0.22 face heights above the eye line and tipped 5 px below the strand`));
        k++;
        continue;
      }
      const why: Placement[] = [];
      const pts: Array<[number, number]> = [0, 1, 2, 3].map((j) => {
        const w = placement(
          'mask',
          `link ${j}: the centroid x of the strand of ${p.name} that hangs below the chin (with ${p.name}'s art within 25 px of the strand's centre x), in the 24-row band at ${j}/4 of the way from 0.22 face heights above the eye line to 5 px below the strand's bottom`,
          { parts: [p.name], frame: ['face_box', 'eye_line'], constants: [konst('share_of_span', j / 4), konst('face_heights_above_eye_line', 0.22)] },
        );
        why.push(w);
        return [orSaid(bandX(cm, y0 + (j * span) / 4), st.cx, "no art in the band: the strand's centre x", w), y0 + (j * span) / 4];
      });
      const lockTip = placement('mask', `5 px below the strand's bottom, at the strand's centroid x in the band 6 px above its bottom`, { parts: [p.name] });
      C(name, 'head', pts, [orSaid(bandX(comp, bot - 6), pts[pts.length - 1][0], "no art in the band: the last link's x", lockTip), bot + 5], why, lockTip);
      segs.push(name);
      tracks.push({ chain: name, amps: [0.8, 1.6, 2.6, 3.6], period: 4.0, phase: 0.16, lag: 0.07 });
      k++;
    }
    const frontRcp = recipeOf('front hair');
    meshes[p.name] = { grid: g, r: frontRcp?.split?.hold_tip === true && k > 0 ? Math.max(r, g) : r, segments: segs };
    if (frontRcp !== null && clothUsed.has('front hair')) clothMeshed.set(p.name, 'front hair');
  }

  // ---- accessories: rigid body + pendant chain where the part narrows, or one pendulum chain per hanging strand
  for (const [tag, bname, par] of [
    ['headwear', 'hairpin', 'head'],
    ['earwear', 'earring', 'head'],
  ] as const) {
    // Every part with the tag (a plan may take both runs' layers): the biggest
    // gets the bone and chain, the rest ride the head rigidly. A stable sort,
    // as Python's `sorted` is.
    const cands = [...P.byTag(tag)].filter((q) => !multiPartClaimed.has(q.name)).sort((a, b) => b.opaque_px - a.opaque_px);
    // Issue #391: a layer of the tag lying on a tail the back hair recipe drafted rides the links it overlaps — the
    // spans of the tail its pixels over the tail's art fall nearest — and not head: its mesh names those bones and no
    // others, so every vertex weights by the rule the tail's own art does. The links are read off the overlap, never
    // off the part's name. A layer over no link keeps its rule below. Only with the recipe: without it no tail moves
    // by the world, and nothing here runs.
    const rides = (q: PartRecord): boolean => {
      const segments: Segment[] = [];
      const links: string[] = [];
      const said: string[] = [];
      for (const tail of tails) {
        const o = tailOverlap(tail, P.alpha(q), q);
        if (!tail.spans.some((sp, k) => sp.link && o.counts[k] > 0)) continue;
        const on: string[] = [];
        tail.spans.forEach((sp, k) => {
          if (o.counts[k] === 0) return;
          on.push(`${sp.link ? sp.bone : `${sp.bone}'s fixed segment`} ${o.counts[k]}`);
          // A link is named, so its segment is the link as the bones declare it; the head's span is written out, as the tail's mesh writes it.
          segments.push(sp.link ? sp.bone : [sp.bone, sp.a, sp.b]);
          if (sp.link) links.push(sp.bone);
        });
        said.push(`${o.over} of its ${o.total} px lie over ${tail.part}'s art, nearest ${tail.part}'s spans ${on.join(', ')} px`);
      }
      if (links.length === 0) return false;
      const [g, r] = gridR(q);
      delete regions[q.name];
      meshes[q.name] = { grid: g, r, segments };
      notes.push(
        `${q.name} (${q.from}): wraps a tail config.cloth."back hair" drafts — ${said.join('; ')} — so its mesh's segments are those spans and it rides the links ${links.join(', ')} with the tail, not head; no ${tag} bone, pendant or strand chain is drafted for it (issue #391)`,
      );
      return true;
    };
    for (const q of cands.slice(1)) {
      if (rides(q)) continue;
      regions[q.name] = 'head';
      notes.push(`${q.name} (${q.from}): second ${tag} layer, rigid on head`);
      // A region cannot swing, so strands found on it are only said.
      const pr = pendantRows(P, q);
      const strands = hangingStrands(P, q, tag === 'earwear' || pr.pendH > 0.8 * q.h ? 0 : pr.j);
      if (strands.length > 0) notes.push(strandNote(q, strands, [], strands, 'it rides the head as a region'));
    }
    for (const p of cands.slice(0, 1)) {
      if (rides(p)) continue;
      const [g, r] = gridR(p);
      const fullMask = dilate(P.alpha(p), 7);
      const onArt = (pts: ReadonlyArray<readonly [number, number]>): boolean => pts.every((q) => isOn(fullMask, q[0], q[1]));
      const im = P.images.get(p.name) as Raster;
      const own = (x: number, y: number): number => (im.data[(y * p.w + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE ? 1 : 0);
      const { rows, j, pendH } = pendantRows(P, p);
      const bodyRows = j > 0 ? j : rows.length;
      const colsIn = (r0: number, r1: number): number[] => {
        const out: number[] = [];
        for (let x = 0; x < p.w; x++) {
          for (let y = r0; y < r1; y++) {
            if (own(x, y)) {
              out.push(x);
              break;
            }
          }
        }
        return out;
      };
      const byx = colsIn(0, bodyRows);
      const allPendant = tag === 'earwear' || pendH > 0.8 * rows.length;
      // Strands: searched below the body, or over the whole part when it is all pendant.
      const strands = hangingStrands(P, p, allPendant ? 0 : j);
      // One pendulum chain per strand, in place of the part's single pendant
      // chain: a chain at the mean x of several strands hangs between them.
      const strandChains = (parent: string): { segs: Segment[]; chained: string[]; dropped: Strand[] } => {
        const segs: Segment[] = [];
        const chained: string[] = [];
        const dropped: Strand[] = [];
        strands.forEach((st, k) => {
          const h = st.bottom - st.top + 1;
          const why: Placement[] = [];
          const pts: Array<[number, number]> = [st.top, st.top + h * STRAND_LINK_AT].map((y, i) => {
            const w = placement('mask', i === 0 ? `link 0: the strand's centroid x in the band at its top row` : `link 1: the strand's centroid x in the band ${STRAND_LINK_AT} of its height below its top row`, {
              parts: [p.name],
              constants: i === 0 ? [] : [konst('of_strand_height', STRAND_LINK_AT)],
            });
            why.push(w);
            return [orSaid(bandX(st.mask, y), st.x, "no art in the band: the strand's centre x", w), y];
          });
          const tipWhy = placement('mask', "the strand's bottom row, at its centroid x in the band there", { parts: [p.name] });
          const tip: [number, number] = [orSaid(bandX(st.mask, st.bottom), pts[pts.length - 1][0], "no art in the band: the last link's x", tipWhy), st.bottom];
          if (!onArt([...pts, tip])) {
            dropped.push(st);
            return;
          }
          const name = `${bname}_strand${k}_`;
          C(name, parent, pts, tip, why, tipWhy);
          // The head stub at the strand's top is what an all-pendant part hangs from, as the single pendant chain's mesh does.
          if (parent === par) segs.push(['head', rnd([pts[0][0], st.top - 7]), rnd([pts[0][0], st.top + 1])]);
          segs.push(name);
          chained.push(name);
          tracks.push({ chain: name, amps: [...STRAND_AMPS], period: 2.0, phase: 0.2, lag: 0.12 });
        });
        return { segs, chained, dropped };
      };
      if (allPendant && strands.length > 0) {
        const sc = strandChains(par);
        notes.push(strandNote(p, strands, sc.chained, sc.dropped, 'a chain down it would run off the art'));
        if (sc.chained.length > 0) {
          delete regions[p.name];
          meshes[p.name] = { grid: g, r, segments: sc.segs };
          continue;
        }
      }
      if (allPendant) {
        // All pendant: a chain from the part's own top.
        const topRows = Math.min(p.h, Math.max(4, Math.floor(rows.length / 5)));
        const cols = colsIn(0, topRows);
        const x = p.x + (cols.length > 0 ? npMean(cols) : p.w / 2);
        const topWhy = placement('mask', `the mean opaque column of ${p.name}'s top ${topRows} rows, 3 px below its top`, {
          parts: [p.name],
          constants: [konst('px_below_top', 3)],
          fallback: cols.length > 0 ? null : 'no opaque column in those rows: the centre x of its box',
        });
        if (!onArt([[x, p.y + 3]])) {
          B(bname, par, [x, p.y + 3], topWhy);
          delete regions[p.name];
          meshes[p.name] = { grid: g, r, segments: [[bname, rnd([x, p.y]), rnd([x, p.y + p.h])]] };
          notes.push(`${p.name}: pendant top is off the art -> rigid bone, no chain`);
          continue;
        }
        C(bname, par, [[x, p.y + 3]], [x, p.y + p.h - 1], [topWhy], placement('mask', `the bottom row of ${p.name}, at link 0's x`, { parts: [p.name] }));
        meshes[p.name] = { grid: g, r, segments: [['head', rnd([x, p.y - 7]), rnd([x, p.y + 1])], bname] };
        tracks.push({ chain: bname, amps: [5.0], period: 2.0, phase: 0.25, lag: 0.0 });
        continue;
      }
      if (byx.length === 0) {
        // The reference's `byx.min()` raises here; a refusal names what it could not measure.
        refuseIfAny([
          {
            code: 'PROPOSE_ACCESSORY_BODY',
            object: `part "${p.name}" (${p.from})`,
            detail: `has no opaque pixel above its pendant rows (${pendH} of ${rows.length} rows from the bottom); a body to hang the ${bname} bone on is required`,
          },
        ]);
      }
      const by: number[] = [];
      for (let y = 0; y < bodyRows; y++) if (rows[y] > 0) by.push(y);
      const cy = p.y + npMean(by);
      const xl = p.x + byx[0];
      const xr = p.x + byx[byx.length - 1];
      // The pendant's lower half: clear of the body's fringe.
      const lowFrom = pendH > 0 ? j + Math.floor(pendH / 2) : 0;
      const lowCols: number[] = [];
      for (let y = lowFrom; y < p.h; y++) for (let x = 0; x < p.w; x++) if (own(x, y)) lowCols.push(x);
      const px = p.x + (lowCols.length > 0 ? npMean(lowCols) : p.w / 2);
      const near = Math.abs(px - xl) < Math.abs(px - xr) ? xl : xr;
      const far = near === xl ? xr : xl;
      const start: [number, number] = [near + (px - near) * 0.6 + (near === xl ? 47 : -47), cy];
      B(
        bname,
        par,
        start,
        placement('mask', `0.6 of the way from the near edge of ${p.name}'s body to its pendant's mean opaque column, 47 px further in, at the body's mean opaque row`, {
          parts: [p.name],
          constants: [konst('share_near_edge_to_pendant', 0.6), konst('px_further_in', 47)],
          fallback: lowCols.length > 0 ? null : "no opaque pixel in the pendant's lower half: the centre x of its box as the pendant's column",
        }),
        [far, cy],
        placement('mask', `the far edge of ${p.name}'s body, at its mean opaque row`, { parts: [p.name] }),
      );
      // The body's two fixed segments come first and stay: they are what holds the body still while a strand swings.
      const segs: Segment[] = [
        [bname, rnd(start), rnd([far, cy])],
        [bname, rnd([near, cy - 12]), rnd([start[0], cy + 18])],
      ];
      if (strands.length > 0) {
        // The body's full width at its mean row: without it the body's near side
        // is held only by the reference's two segments, and a strand's pull
        // reaches it (measured on the synthetic crown: 1.07 px off its bone
        // without this segment, 0.55 px with it).
        segs.push([bname, rnd([xl, cy]), rnd([xr, cy])]);
        const sc = strandChains(bname);
        segs.push(...sc.segs);
        notes.push(strandNote(p, strands, sc.chained, sc.dropped, 'a chain down it would run off the art'));
        meshes[p.name] = { grid: g, r, segments: segs };
        continue;
      }
      const tpts: Array<[number, number]> = [
        [px, p.y + j],
        [px, p.y + j + pendH * 0.45],
        [px, p.y + p.h - 1],
      ];
      if (pendH >= PENDANT_MIN_ROWS && !onArt(tpts)) {
        notes.push(`${p.name}: pendant chain would run off the art -> no tassel chain (add one by hand if it swings)`);
      } else if (pendH >= PENDANT_MIN_ROWS) {
        const y0 = p.y + j;
        const lowFallback = lowCols.length > 0 ? null : "no opaque pixel in the pendant's lower half: the centre x of its box";
        C(
          `${bname}_tassel`,
          bname,
          [
            [px, y0],
            [px, y0 + pendH * 0.45],
          ],
          [px, p.y + p.h - 1],
          [
            placement('mask', `link 0: the mean opaque column of the lower half of ${p.name}'s pendant, at the pendant's top row`, { parts: [p.name], fallback: lowFallback }),
            placement('mask', `link 1: the same column, 0.45 of the pendant's height below its top row`, { parts: [p.name], constants: [konst('of_pendant_height', 0.45)], fallback: lowFallback }),
          ],
          placement('mask', `the bottom row of ${p.name}, at the same column`, { parts: [p.name], fallback: lowFallback }),
        );
        segs.push(`${bname}_tassel`);
        tracks.push({ chain: `${bname}_tassel`, amps: [...STRAND_AMPS], period: 2.0, phase: 0.2, lag: 0.12 });
      }
      meshes[p.name] = { grid: g, r, segments: segs };
    }
  }

  // ---- neck mesh
  for (const p of P.headFirst('neck')) {
    const [g, r] = gridR(p);
    meshes[p.name] = {
      grid: g,
      r,
      segments: [
        trunk === null ? ['chest', rnd([axis, neckY + 18]), rnd([axis, chest[1]])] : ['chest', rnd(along(neckAt, trunk.u, 18)), rnd(chest)],
        ['head', rnd(head), rnd([axis, head[1] - 50])],
      ],
    };
  }

  // ---- sleeves
  // A cut's piece counts here (issue #230): the sleeve rule names its chains by side, not once per part, so a piece
  // never repeats one, and cutting one sleeve out of a both-arms part is how #199's note says to separate them.
  const hw = [...P.byTag('handwear-r', undefined, true), ...P.byTag('handwear-l', undefined, true)].filter((p) => p.opaque_px > 500);
  const sides = new Map<'r' | 'l', PartRecord[]>();
  for (const p of hw) {
    const s = center(p)[0] < axis ? 'r' : 'l';
    if (!sides.has(s)) sides.set(s, []);
    (sides.get(s) as PartRecord[]).push(p);
  }
  const clasped = hw.length > 0 && !(hw.length === 2 && sides.size === 2) ? claspedOf(P, hw, shoulders, axis) : null;
  // Issue #75: arms from joints, when every handwear part carries the wrist of
  // an arm whose shoulder, elbow and wrist are all given; otherwise the rule
  // below places every sleeve chain, and the notes say why.
  const armPlan = joints !== undefined && clasped === null && hw.length > 0 ? armsFromJoints(P, hw, joints, wristSnap, chainRule) : null;
  let sleeveRule = '';
  if (clasped !== null) {
    sleeveRule = 'the clasped-hands rule (the handwear is a region on hip, with no sleeve chain)';
    // One blob at the midline, narrower than the shoulders: the hands, clasped
    // in front. The sleeves are inside another layer and move with it; two
    // sleeve chains on this blob would stand on one vertical line.
    for (const p of hw) regions[p.name] = 'hip';
    notes.push(clasped);
  } else if (armPlan !== null && armPlan.arms !== null) {
    // Each chain runs shoulder -> elbow with its tip at the wrist (or, when
    // the wrist fell outside the arm layer onto a skirt or top layer, at the
    // arm layer's bottom extent, issue #491): two links,
    // the upper arm and the forearm, each with the amplitude the two-blob rule
    // gives its link of the same index. Its part's mesh takes the chain alone,
    // as the two-blob rule's does since issue #347 (no chest stub: a stub on
    // chest pinned the puff, and the arm stretched it when it turned).
    for (const a of armPlan.arms) {
      const sgn = a.side === 'r' ? 1 : -1;
      const used = (n: KeypointName): Placement => placement('joint', `the ${n} joint, ${usedAs((joints as RigJoints).joints[n])}`, { joints: [jointRef(n)] });
      const tipWhy =
        a.offLayer === null
          ? used(`${a.side}_wrist`)
          : placement('mask', `3 px above ${a.part.name}'s bottom row, at its centroid x in the band 6 px above that row`, {
              parts: [a.part.name],
              fallback: a.tipFallback,
            });
      C(`sleeve_${a.side}`, 'chest', [a.shoulder, a.elbow], a.tip, [used(`${a.side}_shoulder`), used(`${a.side}_elbow`)], tipWhy);
      tracks.push({ chain: `sleeve_${a.side}`, amps: [sgn * 0.2, sgn * 0.6], period: 4.0, phase: 0.22 + (a.side === 'l' ? 0.05 : 0), lag: 0.08 });
    }
    // Issue #349: each arm is a limb — the upper arm on link 0 and the forearm (with the hand) on link 1, each rigid on
    // its link, cut at the elbow — not a mesh blended along the chain. Its handwear part is the layer the limb takes.
    for (const a of armPlan.arms) {
      limbs[`arm_${a.side}`] = {
        segments: [
          { part: `upperarm_${a.side}`, from: a.part.name, bone: `sleeve_${a.side}0` },
          { part: `forearm_${a.side}`, from: a.part.name, bone: `sleeve_${a.side}1`, joint: 'elbow' },
        ],
      };
      regions[`upperarm_${a.side}`] = `sleeve_${a.side}0`;
      regions[`forearm_${a.side}`] = `sleeve_${a.side}1`;
      consumed.add(a.part.name);
      notes.push(
        `limb arm_${a.side}: ${a.part.name} (${a.part.from}) is cut at the ${a.side}_elbow joint into upperarm_${a.side} on sleeve_${a.side}0 and forearm_${a.side} (with the hand) on sleeve_${a.side}1, each rigid on its link with weight 1 — a bend is a rotation at the joint; assemble with this limbs block cuts the layer, and the forearm carries a cap past the elbow (its line counts the cap's pixels, and names any the layer does not hold)`,
      );
    }
  } else if (hw.length === 2 && sides.size === 2) {
    sleeveRule = 'the two-blob sleeve rule (one chain per handwear blob, down its rows)';
    // Arms apart: two blobs. Each mesh gets ONLY its own sleeve chain; the
    // one-blob recipe made hanging hands breathe with the sternum, and the short
    // chest segment at the shoulder this rule drafted until issue #347 pinned the
    // puff to the torso, so the sleeve stretched when its chain turned.
    for (const [s, sgn] of SIDES) {
      const p = (sides.get(s) as PartRecord[])[0];
      const mask = P.alpha(p);
      const ys = rowsAny(mask);
      const top = ys[0];
      const bot = ys[ys.length - 1];
      const y0 = top + 15;
      const span = bot - 6 - y0;
      const why: Placement[] = [];
      const pts: Array<[number, number]> = [0, 1, 2].map((k) => {
        const w = placement('mask', `link ${k}: the centroid x of ${p.name}'s art in the 24-row band at ${k}/3 of the way from 15 px below its top row to 6 px above its bottom row`, {
          parts: [p.name],
          constants: [konst('share_of_span', k / 3)],
        });
        why.push(w);
        return [orSaid(bandX(mask, y0 + (k * span) / 3), center(p)[0], 'no art in the band: the centre x of its box', w), y0 + (k * span) / 3];
      });
      const tipWhy = placement('mask', `3 px above ${p.name}'s bottom row, at its centroid x in the band 6 px above that row`, { parts: [p.name] });
      C(`sleeve_${s}`, 'chest', pts, [orSaid(bandX(mask, bot - 6), pts[pts.length - 1][0], "no art in the band: the last link's x", tipWhy), bot - 3], why, tipWhy);
      tracks.push({ chain: `sleeve_${s}`, amps: [sgn * 0.2, sgn * 0.6, sgn * 1.2], period: 4.0, phase: 0.22 + (s === 'l' ? 0.05 : 0), lag: 0.08 });
      const [g, r] = gridR(p);
      meshes[p.name] = { grid: g, r, segments: [`sleeve_${s}`] };
    }
    notes.push('handwear is two blobs: one sleeve chain per mesh, and nothing on chest');
  } else if (hw.length > 0) {
    sleeveRule = `the one-blob sleeve rule (both chains in one mesh, split at the eye axis x=${pyFixed(axis, 0)})`;
    const segs: Segment[] = [['chest', rnd([chest[0], chest[1] - 40]), rnd([chest[0], hip[1]])]];
    let mask = newMask(P.W, P.H);
    for (const p of hw) mask = union(mask, P.alpha(p));
    const ys = rowsAny(mask);
    const bot = ys[ys.length - 1];
    for (const [s, sgn] of SIDES) {
      const span = bot - chest[1];
      // The outer half of the sleeve on that side, away from the axis.
      const pts: Array<[number, number]> = [];
      const why: Placement[] = [];
      const hwNames = hw.map((q) => q.name);
      for (let k = 0; k < 3; k++) {
        const y = chest[1] + (k * span) / 3;
        const xs = sideOf(colsAny(mask, pyInt(y) - 12, pyInt(y) + 12), s, axis);
        const share = k === 0 ? 0.22 : 0.5 * (1 - 0.35 * k);
        why.push(
          placement('mask', `link ${k}: ${share} of the way from the outer to the inner edge of the handwear on the ${s} side of the eye axis, in the 24-row band at ${k}/3 of the way from chest's y down to the handwear's bottom row`, {
            parts: hwNames,
            bones: ['chest'],
            frame: ['eye_axis'],
            constants: [konst('share_outer_to_inner', share), konst('share_of_span', k / 3)],
            fallback: xs.length === 0 ? 'no handwear on that side in the band: the eye axis x' : null,
          }),
        );
        if (xs.length === 0) {
          pts.push([axis, y]);
          continue;
        }
        const outer = s === 'r' ? xs[0] : xs[xs.length - 1];
        const inner = s === 'r' ? xs[xs.length - 1] : xs[0];
        // k = 0 is the shoulder, not the clasped hands.
        pts.push([outer + (k === 0 ? 0.22 : 0.5 * (1 - 0.35 * k)) * (inner - outer), y]);
      }
      const xs = sideOf(colsAny(mask, bot - 12, bot), s, axis);
      const tipx = xs.length > 0 ? (xs[0] + xs[xs.length - 1]) / 2 : pts[pts.length - 1][0];
      C(
        `sleeve_${s}`,
        'chest',
        pts,
        [tipx, bot - 3],
        why,
        placement('mask', `3 px above the handwear's bottom row, half way across its art on the ${s} side of the eye axis in the bottom 12 rows`, {
          parts: hwNames,
          frame: ['eye_axis'],
          fallback: xs.length > 0 ? null : "no handwear on that side in those rows: the last link's x",
        }),
      );
      segs.push(`sleeve_${s}`);
      tracks.push({ chain: `sleeve_${s}`, amps: [sgn * 0.25, sgn * 0.9, sgn * 1.8], period: 4.0, phase: 0.22 + (s === 'l' ? 0.05 : 0), lag: 0.08 });
    }
    for (const p of hw) {
      const [g, r] = gridR(p);
      meshes[p.name] = { grid: g, r, segments: segs };
    }
    if (hw.length === 1) notes.push(`handwear is one blob (${hw[0].name}): both sleeves in one mesh, split at the eye axis x=${pyFixed(axis, 0)}`);
  }
  for (const [s] of SIDES) {
    const sc = bones.find((b): b is Extract<BoneEntry, { chain: string }> => 'chain' in b && b.chain === `sleeve_${s}`);
    if (sc === undefined) continue;
    const bone = `sleeve_${s}${sc.points.length - 1}`;
    for (const hp of P.byTag(`hand-${s}`)) {
      regions[hp.name] = bone;
      notes.push(`${hp.name} (${hp.from}): split hand -> region on ${bone}, the tip link of sleeve_${s}`);
    }
  }

  // Issue #402: the topwear part config.cloth.bottomwear.part names takes the skirt's rule and recipe below; every
  // other topwear shaped like a skirt is named in a note when a recipe is in play, never drafted on by its shape.
  const bottomwearParts = declaredPartsOf('bottomwear');
  const bottomwearSingleSame =
    bottomwearParts !== null &&
    bottomwearParts.list.length === 1 &&
    bw.length === 1 &&
    bottomwearParts.list[0] === bw[0];
  const namedSkirt = ((): PartRecord | null => {
    const rawPart = recipeOf('bottomwear')?.part;
    if (typeof rawPart === 'string') {
      const name = rawPart;
      const refuse = (detail: string): never => {
        throw new PartsError([{ code: 'PROPOSE_CLOTH_PART', object: 'config.cloth."bottomwear".part', detail }]);
      };
      const q = P.recs.find((x) => x.name === name);
      if (q === undefined) return refuse(`names "${name}", which is no part in parts.json; a topwear part or its cut skirt piece whose art hangs below the hip (a dress) is required`);
      // An explicit name may select a topwear cut piece; automatic tag rules still exclude pieces.
      const [run, tag] = splitFrom(q.from);
      if (run === PAINTING_RUN || tag !== 'topwear') {
        return refuse(
          `names "${name}", from ${q.from}; ${splitFrom(q.from)[1] === 'bottomwear' ? 'a bottomwear part takes the recipe by its tag already — leave part out' : "only a topwear part takes the skirt's recipe by name (a skirt See-through returned inside topwear, a dress)"}`,
        );
      }
      const line = hip[1] + TOPWEAR_HANGS_FACE_HEIGHTS * fh;
      if (q.y + q.h < line) {
        return refuse(`names "${name}", whose box ends at y=${q.y + q.h}, above hip + ${TOPWEAR_HANGS_FACE_HEIGHTS} face heights (y=${pyFixed(line, 1)}), where the topwear rule reads a bodice that stops at the waist: no skirt hangs below the hip to hang trees on`);
      }
      return q;
    }
    if (bottomwearParts !== null && bottomwearParts.list.length === 1 && !bottomwearSingleSame) {
      const q = bottomwearParts.list[0];
      const object = `config.cloth."bottomwear".${bottomwearParts.field}`;
      const [run, tag] = splitFrom(q.from);
      if (run === PAINTING_RUN || tag !== 'topwear') {
        throw new PartsError([
          {
            code: 'PROPOSE_CLOTH_PART',
            object,
            detail: `names "${q.name}" (${q.from}, box x=${q.x}..${q.x + q.w}, y=${q.y}..${q.y + q.h}), which no link of the skirt's trees crosses`,
          },
        ]);
      }
      const line = hip[1] + TOPWEAR_HANGS_FACE_HEIGHTS * fh;
      if (q.y + q.h < line) {
        throw new PartsError([
          {
            code: 'PROPOSE_CLOTH_PART',
            object,
            detail: `names "${q.name}", whose box ends at y=${q.y + q.h}, above hip + ${TOPWEAR_HANGS_FACE_HEIGHTS} face heights (y=${pyFixed(line, 1)}), where the topwear rule reads a bodice that stops at the waist: no skirt hangs below the hip to hang trees on`,
          },
        ]);
      }
      return q;
    }
    return null;
  })();
  const skirtHints = new Map<string, string>();
  if (cloth !== null) {
    for (const p of tw) {
      if (p === namedSkirt || multiPartClaimed.has(p.name)) continue;
      const hint = skirtInsideNote(p, P.alpha(p), hip[1], fh);
      if (hint !== null) skirtHints.set(p.name, hint);
    }
  }

  // ---- outer robe (topwear)
  for (const p of tw) {
    if (p === namedSkirt || multiPartClaimed.has(p.name)) continue;
    const hint = skirtHints.get(p.name);
    if (hint !== undefined) notes.push(hint);
    const [g, r] = gridR(p);
    const mask = P.alpha(p);
    const top = chest[1] - 0.3 * fh;
    const bot = p.y + p.h;
    const segs: Segment[] =
      trunk === null
        ? [
            ['chest', rnd([chest[0], p.y]), rnd([chest[0], hip[1] - 20])],
            ['hip', rnd([chest[0], hip[1] - 20]), rnd([chest[0], hip[1] + 100])],
          ]
        : [
            // The part's top read along the trunk: the nearest its art comes to the neck end of the line.
            ['chest', rnd(along(hip, trunk.u, artExtent(mask, p, hip, trunk.u)[0])), rnd(along(hip, trunk.u, -20))],
            ['hip', rnd(along(hip, trunk.u, -20)), rnd(along(hip, trunk.u, 100))],
          ];
    if ((bw.length > 0 || namedSkirt?.cut_from === p.name) && bot < hip[1] + TOPWEAR_HANGS_FACE_HEIGHTS * fh) {
      // A bodice above bottomwear, including its explicitly named cut skirt: robe chains would fall off the art.
      meshes[p.name] = { grid: g, r, segments: segs };
      notes.push(`${p.name} ends at y=${bot} (hip ${pyFixed(hip[1], 0)}): no robe chains -- add a sash chain by hand if one hangs`);
      continue;
    }
    // The LINT tolerance; the reference dilated it once per side, to the same mask.
    const near = dilate(mask, 31);
    for (const [s, sgn] of SIDES) {
      const pts: Array<[number, number]> = [];
      const why: Placement[] = [];
      for (let k = 0; k < 4; k++) {
        const y = top + (k * (bot - 0.1 * (bot - top) - top)) / 3.3;
        const xs = sideOf(colsAny(mask, pyInt(y) - 12, pyInt(y) + 12), s, axis);
        const outer = xs.length > 0 ? (s === 'r' ? xs[0] : xs[xs.length - 1]) : axis;
        pts.push([outer + 0.2 * (axis - outer), y]);
        why.push(
          placement('mask', `link ${k}: 0.2 of the way from ${p.name}'s outer edge on the ${s} side to the eye axis, in the 24-row band ${k}/3.3 of the way from 0.3 face heights above chest's y to 0.1 of that span above its bottom`, {
            parts: [p.name],
            bones: ['chest'],
            frame: ['face_box', 'eye_axis'],
            constants: [konst('share_edge_to_axis', 0.2), konst('face_heights_above_chest', 0.3), konst('step_divisor', 3.3), konst('share_of_span_above_bottom', 0.1)],
            fallback: xs.length > 0 ? null : 'no art on that side in the band: the eye axis x',
          }),
        );
      }
      // The flare just above the hem.
      const xs2 = sideOf(colsAny(mask, bot - 60, bot - 20), s, axis);
      const o2 = xs2.length > 0 ? (s === 'r' ? xs2[0] : xs2[xs2.length - 1]) : pts[pts.length - 1][0];
      const tip: [number, number] = [o2 + 0.15 * (axis - o2), bot - 5];
      const tipWhy = placement('mask', `5 px above ${p.name}'s bottom, 0.15 of the way from its outer edge on the ${s} side (rows 60 to 20 px above its bottom) to the eye axis`, {
        parts: [p.name],
        frame: ['eye_axis'],
        constants: [konst('share_edge_to_axis', 0.15)],
        fallback: xs2.length > 0 ? null : "no art on that side in those rows: the last link's x as the edge",
      });
      if (!pts.every((q) => isOn(near, q[0], q[1]))) {
        notes.push(`robe_${s}: a link falls off ${p.name} (the layer narrows above its hem) -> dropped`);
        continue;
      }
      C(`robe_${s}`, 'chest', pts, tip, why, tipWhy);
      segs.push(`robe_${s}`);
      tracks.push({ chain: `robe_${s}`, amps: [sgn * 0.12, sgn * 0.3, sgn * 0.6, sgn * 1.1], period: 4.0, phase: 0.25 + (s === 'l' ? 0.04 : 0), lag: 0.07 });
    }
    meshes[p.name] = { grid: g, r, segments: segs };
  }

  // ---- skirt (bottomwear, and the topwear part config.cloth.bottomwear.part names: issue #402)
  // The fixed segments of a skirt's mesh, and the note when it hangs from the waist (pushed by the drafting loop only).
  const skirtFrame = (p: PartRecord, mask: Mask): { segs: Segment[]; hangs: string | null } => {
    let segs: Segment[] = [
      ['chest', rnd([chest[0], chest[1] - 30]), rnd([chest[0], hip[1] - 20])],
      ['hip', rnd([p.x + 0.09 * p.w, hip[1] + 5]), rnd([p.x + 0.91 * p.w, hip[1] + 5])],
    ];
    if (trunk !== null) {
      // The waist line runs across the trunk, 5 px down it from the hip, over 0.09 to 0.91 of the art's width across it.
      const [s0, s1] = artExtent(mask, p, hip, trunk.v);
      const waist = along(hip, trunk.u, 5);
      segs = [
        ['chest', rnd(along(chest, trunk.u, -30)), rnd(along(hip, trunk.u, -20))],
        ['hip', rnd(along(waist, trunk.v, s0 + 0.09 * (s1 - s0))), rnd(along(waist, trunk.v, s0 + 0.91 * (s1 - s0)))],
      ];
    }
    // Issue #262: a skirt whose art starts below the chest bone hangs from the waist. Its root is the hip line's,
    // and the chest segment goes: with it the breath carries the waistband (a vertex near the chest segment's
    // lower end takes chest weight), so the root travels with the breath while the hem, on the skirt's chains,
    // does not. A bottomwear reaching up past the chest (the long robe the hip rule above reads the waist for) has
    // art on the chest and keeps the segment. Read along the trunk where there is one, down the screen otherwise.
    const down: readonly [number, number] = trunk === null ? [0, 1] : trunk.u;
    const artTop = artExtent(mask, p, hip, down)[0];
    const chestAt = (chest[0] - hip[0]) * down[0] + (chest[1] - hip[1]) * down[1];
    if (artTop < chestAt) return { segs, hangs: null };
    return {
      segs: segs.filter((s) => typeof s === 'string' || s[0] !== 'chest'),
      hangs: `${p.name} (${p.from}): its art starts ${pyFixed(artTop - chestAt, 1)} px below chest's origin, so it hangs from the waist — its mesh takes the hip line and its skirt chains, no chest segment, and the breath does not carry its root`,
    };
  };
  // Where the recipe's trees hang on a skirt: from 20 px below the hip to 4 px above the cloth's bottom under each column, across its art.
  const skirtInput = (p: PartRecord, mask: Mask, prefix: string, r: ClothRecipe, bot = p.y + p.h, emitNotes = true): TreeInput => {
    const y0 = hip[1] + 20;
    const y0Int = Math.max(0, pyInt(y0));
    const botInt = Math.min(mask.height, pyInt(bot));
    const n = r.chains ?? RECIPE_BACK_HAIR_CHAINS;
    const into = r.split === undefined ? 1 : r.split.into;
    const traceLastOpaqueY = (f: number): number => {
      let lastY = -1;
      for (let y = y0Int; y < botInt; y++) {
        const bx = bandX(mask, y, { frac: f }) ?? p.x + f * p.w;
        const rx = Math.max(0, Math.min(mask.width - 1, pyRound(bx)));
        if (mask.data[y * mask.width + rx] !== 0) {
          lastY = y;
        } else if (lastY >= y0Int) {
          let gapContinues = false;
          for (let yy = y + 1; yy <= Math.min(botInt - 1, y + 12); yy++) {
            if (mask.data[yy * mask.width + rx] !== 0) {
              gapContinues = true;
              break;
            }
          }
          if (!gapContinues) break;
        }
      }
      return lastY;
    };
    const shares: number[] = [];
    for (let k = 0; k < n; k++) {
      shares.push((k + 0.5) / n);
      if (into > 1) {
        for (let b = 0; b < into; b++) shares.push((k + (b + 0.5) / into) / n);
      }
    }
    const uniformBottom = shares.every((f) => {
      const lastY = traceLastOpaqueY(f);
      if (lastY >= botInt - 4) return true;
      if (lastY < botInt - 36 || lastY < y0Int + 4) return false;
      const txBot = Math.max(0, Math.min(mask.width - 1, pyRound(bandX(mask, bot - 4, { frac: f }) ?? p.x + f * p.w)));
      for (let yy = Math.max(y0Int, botInt - 16); yy < botInt; yy++) {
        if (mask.data[yy * mask.width + txBot] !== 0) return true;
      }
      return false;
    });
    const notedEmpty = new Set<number>();
    const cappedXAt = (maxY: number) => (y: number, f: number): number | null => {
      const yi = Math.min(maxY, Math.max(0, pyRound(y)));
      const a = Math.max(0, pyInt(y - 12));
      const b = Math.min(maxY + 1, pyInt(y + 12));
      let x0 = mask.width;
      let x1 = -1;
      for (let yy = a; yy < b; yy++) {
        for (let x = 0; x < mask.width; x++) {
          if (mask.data[yy * mask.width + x] !== 0) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
          }
        }
      }
      const raw = x1 < x0 ? (bandX(mask, yi, { frac: f }) ?? p.x + f * p.w) : x0 + f * (x1 - x0);
      const rx = Math.max(0, Math.min(mask.width - 1, pyRound(raw)));
      if (mask.data[yi * mask.width + rx] !== 0) return raw;
      let bestX: number | null = null;
      let bestDist = mask.width + 1;
      for (let x = 0; x < mask.width; x++) {
        if (mask.data[yi * mask.width + x] !== 0) {
          const d = Math.abs(x - rx);
          if (d < bestDist) {
            bestDist = d;
            bestX = x;
          }
        }
      }
      return bestX ?? raw;
    };
    return {
      prefix,
      parent: 'hip',
      rootY: y0,
      tipY: bot - 4,
      xAt: (y, f) => bandX(mask, y, { frac: f }),
      fallbackX: (f) => p.x + f * p.w,
      frame: `${p.name}'s art (no art in the band: that share of its box's width)`,
      edges: 'both',
      columnTip: (k, f) => {
        const col0 = Math.floor(p.x + (k / n) * p.w);
        const col1 = Math.max(col0, Math.ceil(p.x + ((k + 1) / n) * p.w) - 1);
        let colMaxY = -1;
        for (let y = y0Int; y < botInt; y++) {
          for (let x = col0; x <= col1; x++) {
            if (mask.data[y * mask.width + x] !== 0) colMaxY = y;
          }
        }
        const fc = (k + 0.5) / n;
        const trunkLastY = traceLastOpaqueY(fc);
        if (colMaxY < y0Int + 4 || trunkLastY < y0Int + 4) {
          if (emitNotes && !notedEmpty.has(k)) {
            notedEmpty.add(k);
            notes.push(
              `${p.name} (${p === namedSkirt ? p.from : 'bottomwear'}): column ${k} of ${n} (x=${col0}..${col1}, share ${roundTo(fc, 6)}) holds no cloth below the root row y=${y0Int} — no tree drafted there`,
            );
          }
          return null;
        }
        if (uniformBottom) return { tipY: bot - 4 };
        const rawLastY = traceLastOpaqueY(f);
        const lastY = rawLastY >= y0Int + 4 ? rawLastY : trunkLastY;
        const tipY = Math.min(bot - 4, Math.max(y0Int + 4, lastY - 3));
        return { tipY, xAt: cappedXAt(lastY) };
      },
    };
  };
  // Issue #416: a bottomwear part lying on the trees of the dress config.cloth.bottomwear.part names (a ruffle hem
  // See-through returned on its own) rides the links it overlaps, as a layer wrapped round a tail does (issue #391),
  // and gets no trees of its own: one skirt carries one set of trees. The dress's mesh is the tail — its fixed
  // segments and every tree link, in segment order — and the links are read off the overlap, never off the part's
  // name. Which parts ride is read here, before any bone is named, off the trees as the recipe places them (a tree's
  // points do not depend on its prefix); a part over no link keeps its own trees below. Only with the field.
  const dressTail = (p: PartRecord, segs: readonly Segment[], trees: readonly TreeChain[]): Tail => {
    const spans: TailSpan[] = [];
    for (const s of segs) if (typeof s !== 'string') spans.push({ bone: s[0], a: s[1], b: s[2], link: false });
    for (const t of trees) {
      const line = [...t.points, t.tip];
      t.points.forEach((q, i) => spans.push({ bone: `${t.chain}${i}`, a: q, b: line[i + 1], link: true }));
    }
    return { part: p.name, mask: P.alpha(p), spans };
  };
  const overLinks = (tail: Tail, q: PartRecord): { o: TailOverlap; rides: boolean } => {
    const o = tailOverlap(tail, P.alpha(q), q);
    return { o, rides: tail.spans.some((sp, k) => sp.link && o.counts[k] > 0) };
  };
  const dressRecipe = recipeOf('bottomwear');
  if (bottomwearParts !== null && bottomwearParts.list.length >= 2 && dressRecipe !== null) {
    const { field, list } = bottomwearParts;
    const object = `config.cloth."bottomwear".${field}`;
    const p0 = list[0];
    const m0 = P.alpha(p0);
    const y0 = hip[1] + 20;
    const unionMask = newMask(P.W, P.H);
    unionMask.data.set(m0.data);
    for (let idx = 1; idx < list.length; idx++) {
      const mq = P.alpha(list[idx]);
      for (let y = p0.y; y < P.H; y++) {
        let p0HasRow = false;
        for (let x = 0; x < P.W; x++) {
          if (m0.data[y * P.W + x] !== 0) {
            p0HasRow = true;
            break;
          }
        }
        if (p0HasRow) continue;
        for (let x = 0; x < P.W; x++) {
          if (mq.data[y * P.W + x] !== 0) unionMask.data[y * P.W + x] = 1;
        }
      }
    }
    const uRows = rowsAny(unionMask);
    const bot = uRows.length > 0 ? uRows[uRows.length - 1] + 1 : p0.y + p0.h;
    if (bot - 4 <= y0) {
      throw new PartsError([
        {
          code: 'PROPOSE_CLOTH_PART',
          object,
          detail: `names "${p0.name}" (${p0.from}, box y=${p0.y}..${p0.y + p0.h}), which ends above the skirt root row (y=${pyFixed(y0, 1)}) — no skirt tree link crosses "${p0.name}"`,
        },
      ]);
    }
    const [g, r] = gridR(p0);
    const { segs: fixedSegs, hangs } = skirtFrame(p0, m0);
    if (hangs !== null) notes.push(hangs);
    const prefix = 'skirt';
    const partNamesLabel = list.map((q) => q.name).join(' -> ');
    const trees = T(list, 'bottomwear', dressRecipe, {
      ...skirtInput(p0, unionMask, prefix, dressRecipe, bot),
      tipY: bot - 4,
      frame: `${partNamesLabel}'s art (no art in the band: that share of ${p0.name}'s box width)`,
    });
    let swing: { bone: string; rest: number } | null = null;
    if (dressRecipe.swing !== undefined && trees.length > 0) {
      const cx = or(bandX(unionMask, y0, { frac: 0.5 }), p0.x + 0.5 * p0.w);
      const first = trees[0].points.length > 1 ? trees[0].points[1][1] : trees[0].tip[1];
      const at: [number, number] = [cx, y0];
      const tipAt: [number, number] = [cx, first];
      B(
        swingName(prefix),
        'hip',
        at,
        placement('mask', `the centre of ${partNamesLabel}'s art in the 24-row band at the root row (20 px below hip's y)`, { parts: list.map((q) => q.name), bones: ['hip'], constants: [konst('share_across', 0.5)] }),
        tipAt,
        placement('derived', `straight down from the swing's origin to the row of the first tree's second link (one link long)`, { bones: [`${trees[0].chain}0`] }),
      );
      swing = { bone: swingName(prefix), rest: roundTo((Math.atan2(-(rnd(tipAt)[1] - rnd(at)[1]), rnd(tipAt)[0] - rnd(at)[0]) * 180) / Math.PI, 6) };
    }
    const made = treeConstraints(trees, dressRecipe, swing);
    clothConstraints.push(...made);
    const spans: Array<TailSpan & { depth: number }> = [];
    for (const s of fixedSegs) if (typeof s !== 'string') spans.push({ bone: s[0], a: s[1], b: s[2], link: false, depth: -1 });
    for (const t of trees) {
      const line = [...t.points, t.tip];
      t.points.forEach((q, i) => spans.push({ bone: `${t.chain}${i}`, a: q, b: line[i + 1], link: true, depth: t.depths[i] }));
    }
    let prevMinD = -1;
    let prevMaxD = -1;
    const linkSummary: string[] = [];
    for (let idx = 0; idx < list.length; idx++) {
      const q = list[idx];
      const mq = P.alpha(q);
      const crossedLinks = spans.filter((sp) => sp.link && spanCrosses(sp, mq) > 0);
      if (crossedLinks.length === 0) {
        const linkDesc = spans
          .filter((sp) => sp.link)
          .map((sp) => `${sp.bone} [${sp.a[0]}, ${sp.a[1]}]->[${sp.b[0]}, ${sp.b[1]}]`)
          .join(', ');
        throw new PartsError([
          {
            code: 'PROPOSE_CLOTH_PART',
            object,
            detail: `names "${q.name}" (${q.from}, box x=${q.x}..${q.x + q.w}, y=${q.y}..${q.y + q.h}), which no link of the drafted tree crosses (${linkDesc}: 0 px on "${q.name}") — every part in ${field} must be crossed by at least one link of the tree`,
          },
        ]);
      }
      const minD = Math.min(...crossedLinks.map((sp) => sp.depth));
      const maxD = Math.max(...crossedLinks.map((sp) => sp.depth));
      if (idx > 0 && (minD < prevMinD || maxD < prevMaxD)) {
        throw new PartsError([
          {
            code: 'PROPOSE_CLOTH_PART',
            object,
            detail: `names "${q.name}" after "${list[idx - 1].name}", and "${q.name}" is crossed at link depth ${minD}..${maxD} while "${list[idx - 1].name}" is crossed at depth ${prevMinD}..${prevMaxD} — list parts in order from root to tip`,
          },
        ]);
      }
      prevMinD = minD;
      prevMaxD = maxD;
      const [gq, rq] = q === p0 ? [g, r] : gridR(q);
      const qSegs: Segment[] = idx === 0 ? [...fixedSegs] : [];
      const crossedDesc: string[] = [];
      for (const sp of spans) {
        if (!sp.link) continue;
        const px = spanCrosses(sp, mq);
        if (px > 0) {
          qSegs.push(sp.bone);
          crossedDesc.push(`${sp.bone} (${px} px)`);
        }
      }
      linkSummary.push(`${q.name}: ${crossedDesc.join(', ')}`);
      delete regions[q.name];
      meshes[q.name] = { grid: gq, r: dressRecipe.split?.hold_tip === true ? Math.max(rq, gq) : rq, segments: qSegs };
      clothMeshed.set(q.name, 'bottomwear');
      multiPartClaimed.add(q.name);
    }
    notes.push(
      clothNote(
        partNamesLabel,
        'bottomwear',
        trees,
        dressRecipe,
        made.length,
        `${swing === null ? '' : ` on one shared swing, ${swing.bone} (each tree's first link takes its rotation times ${dressRecipe.swing?.scales.join('/')}, its setup rotation ${swing.rest} degrees subtracted)`} across ${list.length} parts in root-to-tip order (${linkSummary.join('; ')}) from hip, rooted 20 px below its y and tipped 4 px above ${list[list.length - 1].name}'s bottom, laid down the screen`,
      ),
    );
  }
  const riders: PartRecord[] =
    namedSkirt === null || dressRecipe === null
      ? []
      : ((): PartRecord[] => {
          const mask = P.alpha(namedSkirt);
          const tail = dressTail(namedSkirt, skirtFrame(namedSkirt, mask).segs, draftTrees(skirtInput(namedSkirt, mask, 'skirt', dressRecipe, namedSkirt.y + namedSkirt.h, false), dressRecipe));
          return bw.filter((q) => !multiPartClaimed.has(q.name) && overLinks(tail, q).rides);
        })();
  let dressDrafted: Tail | null = null;
  const skirts = (namedSkirt === null ? bw : [...bw.filter((q) => !riders.includes(q)), namedSkirt]).filter((q) => !multiPartClaimed.has(q.name));
  for (const p of skirts) {
    const [g, r] = gridR(p);
    const mask = P.alpha(p);
    const bot = p.y + p.h;
    const y0 = hip[1] + 20;
    const { segs, hangs } = skirtFrame(p, mask);
    if (hangs !== null) notes.push(hangs);
    // Issue #364: with config.cloth.bottomwear, the recipe's trees hang from the hip in place of the three keyed chains.
    const skirtRecipe = recipeOf('bottomwear');
    if (skirtRecipe !== null) {
      const prefix = skirts.length === 1 ? 'skirt' : `skirt_${p.name}`;
      const fixed = [...segs];
      const trees = T(p, 'bottomwear', skirtRecipe, skirtInput(p, mask, prefix, skirtRecipe));
      if (p === namedSkirt) dressDrafted = dressTail(p, fixed, trees);
      for (const t of trees) segs.push(t.chain);
      let swing: { bone: string; rest: number } | null = null;
      if (skirtRecipe.swing !== undefined && trees.length > 0) {
        // One link long, straight down from the centre of the root row: the hip is drafted with no tip, so it is
        // unturned and the swing's setup rotation in its frame is its own direction, -90 degrees (Spine, y up).
        const cx = or(bandX(mask, y0, { frac: 0.5 }), p.x + 0.5 * p.w);
        const first = trees[0].points.length > 1 ? trees[0].points[1][1] : trees[0].tip[1];
        const at: [number, number] = [cx, y0];
        const tipAt: [number, number] = [cx, first];
        B(
          swingName(prefix),
          'hip',
          at,
          placement('mask', `the centre of ${p.name}'s art in the 24-row band at the root row (20 px below hip's y)`, { parts: [p.name], bones: ['hip'], constants: [konst('share_across', 0.5)] }),
          tipAt,
          placement('derived', `straight down from the swing's origin to the row of the first tree's second link (one link long)`, { bones: [`${trees[0].chain}0`] }),
        );
        swing = { bone: swingName(prefix), rest: roundTo((Math.atan2(-(rnd(tipAt)[1] - rnd(at)[1]), rnd(tipAt)[0] - rnd(at)[0]) * 180) / Math.PI, 6) };
      }
      const made = treeConstraints(trees, skirtRecipe, swing);
      clothConstraints.push(...made);
      notes.push(
        clothNote(
          p.name,
          'bottomwear',
          trees,
          skirtRecipe,
          made.length,
          `${swing === null ? '' : ` on one shared swing, ${swing.bone} (each tree's first link takes its rotation times ${skirtRecipe.swing?.scales.join('/')}, its setup rotation ${swing.rest} degrees subtracted)`} from hip, rooted 20 px below its y and tipped 4 px above ${p.name}'s bottom, laid down the screen`,
          p === namedSkirt ? p.from : undefined,
        ),
      );
      meshes[p.name] = { grid: g, r: skirtRecipe.split?.hold_tip === true ? Math.max(r, g) : r, segments: segs };
      clothMeshed.set(p.name, 'bottomwear');
      continue;
    }
    for (const [tag, f, ph] of [
      ['skirt_r', 0.3, 0.3],
      ['skirt_c', 0.5, 0.34],
      ['skirt_l', 0.7, 0.38],
    ] as const) {
      const why: Placement[] = [];
      const pts: Array<[number, number]> = [0, 1, 2].map((k) => {
        const w = placement('mask', `link ${k}: ${f} of the way across ${p.name}'s art in the 24-row band at ${k}/3 of the way from 20 px below hip's y to 4 px above its bottom`, {
          parts: [p.name],
          bones: ['hip'],
          constants: [konst('share_across', f), konst('share_of_span', k / 3)],
        });
        why.push(w);
        return [orSaid(bandX(mask, y0 + (k * (bot - 4 - y0)) / 3, { frac: f }), p.x + f * p.w, `no art in the band: ${f} of its box's width`, w), y0 + (k * (bot - 4 - y0)) / 3];
      });
      const tipWhy = placement('mask', `4 px above ${p.name}'s bottom, ${f} of the way across its art in the band 10 px above its bottom`, { parts: [p.name], constants: [konst('share_across', f)] });
      C(tag, 'hip', pts, [orSaid(bandX(mask, bot - 10, { frac: f }), pts[pts.length - 1][0], "no art in the band: the last link's x", tipWhy), bot - 4], why, tipWhy);
      segs.push(tag);
      tracks.push({ chain: tag, amps: [0.15, 0.35, 0.7], period: 4.0, phase: ph, lag: 0.07 });
    }
    meshes[p.name] = { grid: g, r, segments: segs };
  }
  // Issue #416: each rider's mesh takes the dress's spans its pixels over the dress's art fall nearest — a link by its
  // bone, a fixed segment written out as the dress's mesh writes it — so every vertex weights by the rule the dress's
  // own art does, and the note names each span with its pixel count.
  for (const q of riders) {
    const tail = dressDrafted as Tail | null;
    if (tail === null) break;
    const { o } = overLinks(tail, q);
    const segments: Segment[] = [];
    const links: string[] = [];
    const on: string[] = [];
    tail.spans.forEach((sp, k) => {
      if (o.counts[k] === 0) return;
      on.push(`${sp.link ? sp.bone : `${sp.bone}'s fixed segment`} ${o.counts[k]}`);
      segments.push(sp.link ? sp.bone : [sp.bone, sp.a, sp.b]);
      if (sp.link) links.push(sp.bone);
    });
    const [g, r] = gridR(q);
    meshes[q.name] = { grid: g, r, segments };
    notes.push(
      `${q.name} (${q.from}): lies on the trees of ${tail.part}, which config.cloth."bottomwear".part names — ${o.over} of its ${o.total} px lie over ${tail.part}'s art, nearest its spans ${on.join(', ')} px — so its mesh's segments are those spans and it rides the links ${links.join(', ')} with the dress; no trees of its own are drafted for it, so the skirt carries one set (issue #416)`,
    );
  }

  // ---- legs (issue #241)
  // Only with joints: a legwear part whose art holds the ankle of a leg whose hip, knee and ankle are all given is
  // meshed on a leg chain hip -> knee, tip at the ankle; without them no line below runs, and the part stays the
  // region the trunk rule gives it, its note unchanged. No idle track is written for a leg chain: the chain is
  // drafted whatever the pose, and a standing figure's legs are planted — whether they move is the scene's.
  const lw = P.byTag('legwear', undefined, true).filter((p) => p.opaque_px > 500);
  const legPlan = joints !== undefined && lw.length > 0 ? legsFromJoints(P, lw, joints) : null;
  if (legPlan !== null && legPlan.chains !== null) {
    for (const c of legPlan.chains) {
      const J = (joints as RigJoints).joints;
      const used = (n: KeypointName): Placement => placement('joint', `the ${n} joint, ${usedAs(J[n])}`, { joints: [jointRef(n)] });
      C(c.chain, 'hip', [c.hip, c.knee], c.ankle, [used(`${c.side}_hip`), used(`${c.side}_knee`)], used(`${c.side}_ankle`));
    }
    // Issue #349: each leg is a limb — the thigh on link 0 and the shin on link 1, cut at the knee, and the foot below
    // the ankle on a bone of its own that does not take the shin's rotation, so the shoe stays level (issue #348). The
    // thigh rides its link alone: no hip stub pins it.
    const fw = P.byTag('footwear', undefined, true).filter((q) => q.opaque_px > 500);
    const nearFoot = new Map(fw.map((q) => [q, dilate(P.alpha(q), 2 * WRIST_ON_PART_PX + 1)]));
    // The feet are drafted only when every leg's ankle lies on exactly one footwear part: a shoe layer holding both
    // shoes split between one leg's foot and no other would hand that leg the other shoe.
    const legChains = legPlan.chains;
    const feetOn = legChains.map((c) => fw.filter((q) => isOn(nearFoot.get(q) as Mask, c.ankle[0], c.ankle[1])));
    // Issue #517: and only when every ankle lies on its leg's art along its joint line, as assemble reads it — or the
    // config drafted here is one assemble refuses by ASSEMBLE_LIMB_JOINT_ON_ART. An ankle off it is LINTed, not moved.
    const offArt = fw.length > 0 && feetOn.every((on) => on.length === 1) ? anklesOffArt(P, legChains, feetOn.map((on) => on[0])) : [];
    jointsOffArt.push(...offArt);
    const feetBound = fw.length > 0 && feetOn.every((on) => on.length === 1) && offArt.length === 0;
    legChains.forEach((c, ci) => {
      const s = c.side as 'r' | 'l';
      const J = (joints as RigJoints).joints;
      const segs: Limb['segments'] = [
        { part: `thigh_${s}`, from: c.part.name, bone: `leg_${s}0` },
        { part: `shin_${s}`, from: c.part.name, bone: `leg_${s}1`, joint: 'knee' },
      ];
      regions[`thigh_${s}`] = `leg_${s}0`;
      regions[`shin_${s}`] = `leg_${s}1`;
      consumed.add(c.part.name);
      const on = feetOn[ci];
      let foot = '';
      if (feetBound) {
        B(`foot_${s}`, `leg_${s}1`, c.ankle, placement('joint', `the ${s}_ankle joint, ${usedAs(J[`${s}_ankle`])}`, { joints: [jointRef(`${s}_ankle`)] }));
        (bones[bones.length - 1] as { inherit?: string }).inherit = FOOT_INHERIT;
        segs.push({ part: `foot_${s}`, from: on[0].name, bone: `foot_${s}`, joint: 'ankle' });
        regions[`foot_${s}`] = `foot_${s}`;
        consumed.add(on[0].name);
        foot = `, and foot_${s}, ${on[0].name}'s share below the ankle, on bone foot_${s} at the ${s}_ankle joint under leg_${s}1 with inherit "${FOOT_INHERIT}" — the shoe keeps its setup angle while the leg turns (FEET_STAY_LEVEL)`;
      } else if (offArt.length > 0) {
        foot = `; no foot segment: ${offArt.map((f) => `${f.keypoint} at ${fmtAt(f.at)} lies on none of leg_${f.side}'s art within 1 px along its joint line (${offLineFigure(f.nearest)})`).join('; ')}, so assemble could not size the ankle's cap — every leg's ankle must lie on its leg's art for the feet to be drafted, and ${offArt.length === 1 ? 'its' : 'their'} LINT line${offArt.length === 1 ? ' says' : 's say'} how far off; move the ankle keypoint onto the art and re-run propose`;
      } else if (fw.length > 0) {
        const where = (k: number): string => {
          const o = feetOn[k];
          const g = legChains[k];
          if (o.length > 1) return `${g.side}_ankle lies on the art of ${o.length} footwear parts (${o.map((q) => q.name).join(', ')})`;
          if (o.length === 1) return `${g.side}_ankle lies on ${o[0].name}`;
          const d = fw.map((q) => ({ q, d: artDistance(P.alpha(q), g.ankle) })).sort((a, b) => a.d - b.d)[0];
          return `${g.side}_ankle at ${fmtAt(g.ankle)} lies on the art of no footwear part over 500 px within ${WRIST_ON_PART_PX} px — the nearest is ${d.q.name}, ${d.d} px from its art by the larger of the x and y gaps`;
        };
        foot = `; no foot segment: every leg's ankle must lie on exactly one footwear part for the feet to be drafted, and ${legChains.map((_, k) => where(k)).join('; ')} — move the ankle joint onto the shoe, or write the foot segment and its bone in config by hand`;
      } else foot = '; no foot segment: no footwear part is over 500 px';
      limbs[`leg_${s}`] = { segments: segs };
      notes.push(`limb leg_${s}: ${c.part.name} (${c.part.from}) is cut at the ${s}_knee joint into thigh_${s} on leg_${s}0 and shin_${s} on leg_${s}1, each rigid on its link with weight 1${foot}; the shin carries a cap past the knee`);
    });
    notes.push(...legPlan.notes);
  } else if (legPlan !== null && legPlan.why !== null) {
    notes.push(`${lw.map((p) => p.name).join(', ')}: no leg chain — ${legPlan.why}; the trunk rule places ${lw.length === 1 ? 'it' : 'them'}`);
  }

  // Issue #349: a part a limb takes is not made, so the rule that read its tag first (footwear rides root) gives it nothing.
  for (const name of consumed) {
    delete meshes[name];
    delete regions[name];
  }
  // Anything no rule claimed rides its nearest trunk bone rigidly, so the rig stage never meets an unassigned part.
  for (const p of P.recs) {
    if (!(p.name in meshes) && !(p.name in regions) && !consumed.has(p.name)) {
      const cy = center(p)[1];
      regions[p.name] = cy < neckY ? 'head' : cy < hip[1] ? 'chest' : 'hip';
      if (splitFrom(p.from)[0] === PAINTING_RUN) {
        notes.push(`${p.name} (${p.from}): a painting patch has no tag, so no rule -> region on ${regions[p.name]}, the nearest trunk bone; config.regions.${p.name} is the bone it rides`);
      } else if (isAuthorTag(splitFrom(p.from)[1])) {
        // Issue #256: no rule reads an author-made layer, and none is guessed for it.
        notes.push(`${p.name} (${p.from}): ${AUTHOR_NO_ROLE}; no rule reads it -> region on ${regions[p.name]}, the nearest trunk bone, until config.regions.${p.name} names the bone it rides`);
      } else if (p.cut_from !== undefined) {
        notes.push(
          `${p.name} (${p.from}): a piece an assemble.cuts entry took from ${p.cut_from}, so not given that layer's rule a second time (it would name ${p.cut_from}'s bones and chains again) -> region on ${regions[p.name]}, the nearest trunk bone; config.regions.${p.name} is the bone it rides, and a mesh in config.meshes is the author's to give it`,
        );
      } else notes.push(`${p.name} (${p.from}): no rule -> region on ${regions[p.name]}`);
    }
  }
  if (trunk !== null) {
    const laid = [...P.headFirst('neck'), ...tw, ...bw].map((p) => p.name);
    if (laid.length > 0) {
      notes.push(
        `trunk segments (${laid.join(', ')}): laid along neck -> hip, the line the chest was placed on (${pyFixed((Math.atan2(trunk.u[0], trunk.u[1]) * 180) / Math.PI, 1)} degrees off the screen's downward vertical, positive towards +x): each [bone, from, to] segment the rule drafts down the screen runs along that line instead, and the waist segment across it`,
      );
    }
  }
  if (gridRule === 'figure') {
    const latt = Object.keys(meshes).filter((m) => 'grid' in meshes[m] && ownGrid.has(m));
    if (latt.length > 0) notes.push(gridNote(fig, latt.map((m) => [m, ownGrid.get(m) as number])));
  }
  if (joints !== undefined) {
    notes.push(
      ...jointNotes(joints, {
        neckRule,
        hipRule,
        chest: chestAlong ? { neck: neckAt, hip } : null,
        sleeveRule,
        armWhy: armPlan === null ? null : armPlan.why,
        legs: legPlan === null ? null : legPlan.chains,
        arms: armPlan === null ? null : armPlan.arms,
        wristSnap,
        eyes: (['r', 'l'] as const).map((s) => {
          const e = eyes.get(s);
          return e === undefined ? null : { bone: `eye_${s}`, part: (ew[s] as PartRecord).name, at: e };
        }),
      }),
    );
  }
  // Issue #252: the idle is IDLE_FRAMES long, and every period drafted against the reference's 4 s idle keeps its
  // cycles per idle (REFERENCE_IDLE_SECONDS).
  const scale = IDLE_SECONDS / REFERENCE_IDLE_SECONDS;
  const idleTracks = tracks.map((tr) => ({ ...tr, period: tr.period * scale }));
  const drafted = Object.keys(limbs).length === 0 ? {} : { limbs };
  // Issue #364: a recipe that drafted nothing is a declaration that says something false about the rig.
  if (cloth !== null) {
    refuseIfAny(
      CLOTH_TARGETS.filter((t) => cloth[t] !== undefined && !clothUsed.has(t)).map((t) => ({
        code: 'PROPOSE_CLOTH_DRAFTED',
        object: `config.cloth."${t}"`,
        detail:
          P.byTag(t).length === 0 && P.headFirst(t).length === 0
            ? t === 'bottomwear' && skirtHints.size > 0
              ? `declares a recipe for "${t}", and no part is tagged "${t}"; leave the recipe out, assemble the layer it is for, or name the part that holds the skirt — ${[...skirtHints.values()].join('; ')}`
              : `declares a recipe for "${t}", and no part is tagged "${t}"; leave the recipe out, or assemble the layer it is for`
            : t === 'back hair'
              ? `declares a recipe for "back hair", and every back hair part ends above the shoulders (0.5 face heights below the neck), which the proposer drafts as a bun bone with no chain; leave the recipe out`
              : `declares a recipe for "${t}", and the proposer drafted no chain on it`,
      })),
    );
    if (clothUsed.has('bottomwear') && legPlan !== null && legPlan.chains !== null) {
      notes.push(
        `stop at the legs: leg chains ${legPlan.chains.map((c) => c.chain).join(', ')} are drafted, and no stop is drafted for the skirt's trees — on the recipe's fixture the environment alone pushed no hem link through a thigh, but a hip the consumer moves can (AUTHORING §3, *Recipe: cloth and hair*); that case is rig-c/core#1413 (open), and until it lands a stop is the author's own constraint network in config.constraints`,
      );
    }
  }
  // Issue #518: a recipe that declares `influence` has the parts it meshes drafted in the influence mode, each at the
  // cell its lattice had, and — unless the recipe states the radius — at the radius INFLUENCE_RADIUS_CELLS cells past
  // the farthest lattice vertex from its nearest link, measured as the rig stage measures it (influenceFarthest).
  const radii: InfluenceRadiusFinding[] = [];
  for (const [name, tag] of clothMeshed) {
    const decl = recipeOf(tag)?.influence;
    const m = meshes[name];
    if (decl === undefined || m === undefined || !('grid' in m)) continue;
    const segments = m.segments;
    const cell = m.grid;
    let radius = decl.radius;
    if (radius === undefined) {
      const rec = P.recs.find((q) => q.name === name) as PartRecord;
      const farthest = influenceFarthest(P.images.get(name) as Raster, rec.x, rec.y, meshSegmentsOf(bones, segments), cell);
      if (farthest === null) {
        notes.push(`${name}: config.cloth.${JSON.stringify(tag)}.influence is declared, and rig-c's segments lattice refuses the part at cell ${cell}, so no radius is measured and it keeps its lattice mesh`);
        continue;
      }
      radius = roundTo(farthest + INFLUENCE_RADIUS_CELLS * cell, 4);
      radii.push({ kind: 'influence-radius', part: name, tag, radius, farthest: roundTo(farthest, 4), cells: INFLUENCE_RADIUS_CELLS, cell });
    }
    meshes[name] = { influence: { cell, radius, across: decl.across, max: decl.max, shape: decl.shape }, segments };
  }
  const constrained = clothConstraints.length === 0 ? {} : { constraints: clothConstraints };
  return {
    proposal: { bones, meshes, regions, ...drafted, motion: blink === undefined ? { duration: IDLE_SECONDS, tracks: idleTracks } : { duration: IDLE_SECONDS, tracks: idleTracks, blink }, ...constrained, proposed_rig_scale: P.rigScale, notes },
    basis: { frame, bones: records },
    draftLint: [...jointsOffArt, ...radii],
  };
}

/**
 * The note the `figure` grid rule writes (issue #265): the spacing and where it came from, per lattice part its own
 * spacing and the one drafted, what it costs and what it was calibrated on.
 */
export function gridNote(fig: { top: number; bottom: number; height: number; grid: number }, parts: ReadonlyArray<readonly [string, number]>): string {
  const took = parts.filter(([, g]) => g < fig.grid).map(([m, g]) => `${m} ${g} -> ${fig.grid}`);
  const kept = parts.filter(([, g]) => g >= fig.grid).map(([m, g]) => `${m} ${g}`);
  return (
    `mesh spacing: grid ${fig.grid} = round(H / ${FIGURE_GRID_DIVISOR}), H ${fig.height} rig px the height of every part's box together (rows ${fig.top} to ${fig.bottom}), in place of a tenth of each part's short side (${took.length > 0 ? took.join(', ') : 'none'}; kept, already as coarse: ${kept.length > 0 ? kept.join(', ') : 'none'}); r is the part's own. ` +
    `Calibrated on three figures of similar size (H 1106-1185 rig px, issue #265 Stage A), where every check bar passed at this divisor and the idle moved by up to ${FIGURE_GRID_IDLE_PX} rig px against the finer lattice — no bar reads that. propose --grid-rule part drafts the part's own spacing`
  );
}

/**
 * The drafted breath (issues #252, #270): `chest` `translatey`, its travel peak
 * to peak {@link BREATH_FRACTION} of the torso's length — the distance from the
 * `neck` bone's origin to the `hip` bone's, as the proposal writes them (so the
 * figure can be recomputed from proposal.json): the run the chest is placed
 * half way along and the trunk segments are laid along (issue #243), whichever
 * rule placed the two ends (joints, the face and bottomwear, the waist, or the
 * figure's proportion — the hip's own note names it). Amplitude half of it to
 * two decimals, and the base the amplitude. When neck and hip are one point the
 * trunk has no length to take a fraction of, and inventing one is not done: the
 * track keeps the reference's amplitude, {@link REFERENCE_BREATH_AMP}, and the
 * note says so.
 */
export function breathTrack(neck: readonly [number, number], hip: readonly [number, number]): { track: ProposedSingleTrack; note: string } {
  const length = edgeLength(hip[0] - neck[0], hip[1] - neck[1]);
  const run = `neck ${pyIntList(neck)} -> hip ${pyIntList(hip)}`;
  if (length === 0) {
    const a = REFERENCE_BREATH_AMP;
    return {
      track: { bone: 'chest', prop: 'translatey', amp: a, period: REFERENCE_IDLE_SECONDS, phase: 0.0, base: a },
      note: `breath: ${run} are one point, so the trunk has no length to take a fraction of: chest translatey keeps the reference's amplitude ${a} (${pyFixed(2 * a, 2)} px peak to peak), not ${pyFixed(BREATH_FRACTION * 100, 1)} % of a torso — scale it to the figure`,
    };
  }
  const amp = roundTo((BREATH_FRACTION * length) / 2, 2);
  return {
    track: { bone: 'chest', prop: 'translatey', amp, period: REFERENCE_IDLE_SECONDS, phase: 0.0, base: amp },
    note: `breath: chest translatey ${pyFixed(2 * amp, 2)} px peak to peak (amp ${pyFixed(amp, 2)}, base ${pyFixed(amp, 2)}) = ${pyFixed(BREATH_FRACTION * 100, 1)} % of the torso's length, ${pyFixed(length, 1)} px (${run}), once per ${IDLE_FRAMES}-frame idle at ${IDLE_FPS} fps`,
  };
}

// ---------------------------------------------------------------------------
// external keypoints (issue #75)
// ---------------------------------------------------------------------------

/**
 * The trunk's line (issue #243), from the neck bone's origin to the hip's, when a joint placed either end: `u` is
 * its unit direction, down the trunk, and `v` the unit across it, `u` turned a quarter (`[u_y, -u_x]`). An upright
 * trunk's `u` is `[0, 1]` and its `v` `[1, 0]`, the screen's y and x, which is what the vertical drafts read: each
 * trunk segment is that draft with "down the screen" read as "along `u`" and "across the screen" as "along `v`".
 * `null` when the two ends are one point: a line through one point has no direction.
 */
interface TrunkLine {
  u: [number, number];
  v: [number, number];
}

function trunkLineOf(neck: readonly [number, number], hip: readonly [number, number]): TrunkLine | null {
  const dx = hip[0] - neck[0];
  const dy = hip[1] - neck[1];
  const len = edgeLength(dx, dy);
  if (len === 0) return null;
  const u: [number, number] = [dx / len, dy / len];
  return { u, v: [u[1], -u[0]] };
}

/** The point `k` px from `p` along the unit direction `d`. */
function along(p: readonly [number, number], d: readonly [number, number], k: number): [number, number] {
  return [p[0] + k * d[0], p[1] + k * d[1]];
}

/**
 * The extent of a part's art along the unit direction `d`, measured from `o`: the least and the greatest
 * projection onto `d` of its opaque pixels, each taken as the unit square it covers. An axis-aligned box tight on
 * its art therefore projects onto `[1, 0]` as its own left and right edges and onto `[0, 1]` as its top and bottom,
 * the values the vertical drafts read off the box. A part with no opaque pixel is read as its box.
 */
function artExtent(mask: Mask, p: PartRecord, o: readonly [number, number], d: readonly [number, number]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = Math.max(0, p.y); y < Math.min(mask.height, p.y + p.h); y++) {
    for (let x = Math.max(0, p.x); x < Math.min(mask.width, p.x + p.w); x++) {
      if (mask.data[y * mask.width + x] !== 1) continue;
      const t = (x - o[0]) * d[0] + (y - o[1]) * d[1];
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
  }
  const w = lo === Infinity ? p.w : 1;
  const h = lo === Infinity ? p.h : 1;
  if (lo === Infinity) lo = hi = (p.x - o[0]) * d[0] + (p.y - o[1]) * d[1];
  return [lo + Math.min(0, d[0]) * w + Math.min(0, d[1]) * h, hi + Math.max(0, d[0]) * w + Math.max(0, d[1]) * h];
}

/**
 * How far a wrist joint may lie from a handwear part's art and still be on
 * it: the LINT's own tolerance, the part's mask dilated this many px each way
 * (a `2 * 15 + 1` square). `propose --wrist-snap <px>` (issue #199) extends
 * it for a wrist on no part; it never narrows it.
 */
export const WRIST_ON_PART_PX = 15;

/**
 * One arm placed from joints: its side (the subject's), its three joints in
 * rig px, the handwear part whose art holds its wrist, and `snap` — `null`
 * when the wrist is within {@link WRIST_ON_PART_PX} of that part's art, else
 * the distance `--wrist-snap` bound it across.
 */
/**
 * The `inherit` a drafted foot bone takes (issue #349): the shin's position and not its rotation or reflection, so
 * the shoe keeps its setup angle while the leg is posed — the mode `FEET_STAY_LEVEL` names (issue #348). The
 * proposer drafts it; which mode a foot takes stays the author's.
 */
export const FOOT_INHERIT = 'noRotationOrReflection';

interface JointArm {
  side: 'r' | 'l';
  shoulder: [number, number];
  elbow: [number, number];
  wrist: [number, number];
  tip: [number, number];
  tipFallback: string | undefined;
  part: PartRecord;
  snap: number | null;
  offLayer: {
    distance: number;
    landedOn: readonly PartRecord[];
  } | null;
}

/**
 * The distance from the pixel holding `at` (truncated, as {@link isOn} reads
 * it) to the nearest pixel of `m`'s art by the larger of the x and y gaps
 * (Chebyshev) — the measure of the dilation that holds a wrist within
 * {@link WRIST_ON_PART_PX}, so a wrist this far off its part is on the part's
 * mask dilated `2 * d + 1`. Infinity on a mask with no art.
 */
function artDistance(m: Mask, at: readonly [number, number]): number {
  const xi = pyInt(at[0]);
  const yi = pyInt(at[1]);
  let best = Infinity;
  for (let y = 0; y < m.height; y++) {
    const dy = Math.abs(y - yi);
    if (dy >= best) continue;
    for (let x = 0; x < m.width; x++) {
      if (m.data[y * m.width + x] !== 1) continue;
      const d = Math.max(dy, Math.abs(x - xi));
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * The arms the sleeve chains are placed from, or why the sleeve rule places
 * them instead. An arm is complete when its shoulder, elbow and wrist all
 * have a position (and the shoulder and elbow are two points); a handwear
 * part carries an arm when the wrist lies on its art within the LINT's own
 * tolerance (the mask dilated 15 px each way). The joints are used only when
 * every complete arm's wrist is on exactly one part and every handwear part
 * carries one: a part left to the rule beside parts placed from joints would
 * be read by two rules at once. Sides come from the joints, not from the eye
 * axis, so a figure seen from behind or lying across the axis is paired by
 * where its wrists are. Issue #458: when pre-separated `handwear-r` and
 * `handwear-l` parts cross so that `<s>_wrist` lies on the opaque art of its
 * own side's `handwear-<s>` part and also within 15 px of the opposite side's
 * `handwear-<other>` part, it resolves to its own side's part.
 *
 * Issue #199: a wrist on no part within that tolerance is measured to every
 * part by the same Chebyshev distance ({@link artDistance}). With
 * `wristSnap` (an integer above {@link WRIST_ON_PART_PX}, the CLI's to hold)
 * it is bound to the one nearest part when that part is at most `wristSnap`
 * px away; two parts tied nearest bind neither, as a wrist on two parts
 * does not.
 *
 * Issue #491: when a hanging arm's wrist keypoint falls outside its handwear
 * layer's mask (`elbow[1] > shoulder[1]`, `wrist[1] > elbow[1]`, the elbow lies
 * within {@link WRIST_ON_PART_PX} of that side's handwear part, and the part's
 * bottom extent `bot - 3` reaches at least {@link WRIST_ON_PART_PX} below the
 * elbow — e.g. when a skin-coloured wrist read lands on a light skirt or top
 * layer below a hanging sleeve), the arm binds its handwear part with its
 * chain tip placed at the layer's bottom extent `[bandX(mask, bot - 6), bot - 3]`
 * so `limbs.arm_<s>` cuts at the elbow from the limb chain (`PROPOSE_WRIST_OFF_LAYER`).
 * Otherwise the why names the nearest part and its distance, the tolerance
 * that would have bound it.
 */
function armsFromJoints(
  P: PartSet,
  hw: readonly PartRecord[],
  joints: RigJoints,
  wristSnap: number | null,
  chainRule = true,
): { arms: JointArm[] | null; why: string | null } {
  const complete: Array<Omit<JointArm, 'tip' | 'tipFallback' | 'part' | 'snap' | 'offLayer'>> = [];
  const gaps: string[] = [];
  for (const s of ['r', 'l'] as const) {
    const sh = joints.joints[`${s}_shoulder`].at;
    const el = joints.joints[`${s}_elbow`].at;
    const wr = joints.joints[`${s}_wrist`].at;
    if (sh === null || el === null || wr === null) {
      const absent = [sh === null ? `${s}_shoulder` : null, el === null ? `${s}_elbow` : null, wr === null ? `${s}_wrist` : null].filter((n): n is string => n !== null);
      gaps.push(`${absent.join(', ')} ${absent.length === 1 ? 'has' : 'have'} no position`);
    } else if (sh[0] === el[0] && sh[1] === el[1]) gaps.push(`${s}_shoulder and ${s}_elbow are one point, so the upper arm has no direction`);
    else complete.push({ side: s, shoulder: sh, elbow: el, wrist: wr });
  }
  if (complete.length === 0) return { arms: null, why: `no arm has its shoulder, elbow and wrist all given (${gaps.join('; ')})` };
  const armAlpha = new Map(
    hw.map((p) => {
      const tag = splitFrom(p.from)[1];
      const side = tag === 'handwear-r' ? 'r' : tag === 'handwear-l' ? 'l' : null;
      let m = P.alpha(p);
      if (side !== null) {
        for (const h of P.byTag(`hand-${side}`)) m = union(m, P.alpha(h));
      }
      return [p, m] as const;
    }),
  );
  const near = new Map(hw.map((p) => [p, dilate(armAlpha.get(p) as Mask, 2 * WRIST_ON_PART_PX + 1)]));
  const arms: JointArm[] = [];
  for (const a of complete) {
    const raw = hw.filter((p) => isOn(near.get(p) as Mask, a.wrist[0], a.wrist[1]));
    const ownTag = `handwear-${a.side}`;
    const oppTag = `handwear-${a.side === 'r' ? 'l' : 'r'}`;
    const own =
      raw.length > 1 &&
      raw.every((p) => {
        const t = splitFrom(p.from)[1];
        return t === ownTag || t === oppTag;
      })
        ? raw.filter((p) => splitFrom(p.from)[1] === ownTag && isOn(armAlpha.get(p) as Mask, a.wrist[0], a.wrist[1]))
        : [];
    const on = own.length === 1 ? own : raw;
    if (on.length > 1) return { arms: null, why: `${a.side}_wrist at ${fmtAt(a.wrist)} lies on the art of ${on.length} handwear parts (${on.map((p) => p.name).join(', ')}), so it does not say which sleeve it ends` };
    if (on.length === 1) {
      arms.push({ ...a, tip: a.wrist, tipFallback: undefined, part: on[0], snap: null, offLayer: null });
      continue;
    }
    const far = hw.map((p) => ({ p, d: artDistance(armAlpha.get(p) as Mask, a.wrist) }));
    const d = Math.min(...far.map((q) => q.d));
    const nearest = far.filter((q) => q.d === d).map((q) => q.p);
    if (wristSnap !== null && d <= wristSnap && nearest.length === 1) {
      arms.push({ ...a, tip: a.wrist, tipFallback: undefined, part: nearest[0], snap: d, offLayer: null });
      continue;
    }
    if (chainRule) {
      const byTag = hw.filter((p) => splitFrom(p.from)[1] === ownTag);
      const byElbow = hw.filter((p) => isOn(near.get(p) as Mask, a.elbow[0], a.elbow[1]));
      const sidePart =
        byTag.length === 1 && isOn(near.get(byTag[0]) as Mask, a.elbow[0], a.elbow[1])
          ? byTag[0]
          : byElbow.length === 1
            ? byElbow[0]
            : null;
      if (sidePart !== null) {
        const m = armAlpha.get(sidePart) as Mask;
        const ys = rowsAny(m);
        const bot = ys[ys.length - 1];
        if (bot !== undefined && a.elbow[1] > a.shoulder[1] && a.wrist[1] > a.elbow[1] && bot - 3 - a.elbow[1] >= WRIST_ON_PART_PX) {
          const bx = bandX(m, bot - 6);
          const tipX = or(bx, a.elbow[0]);
          const tipFallback = bx === null || bx === 0 ? `no art in the band: the ${a.side}_elbow joint's x` : undefined;
          const tip: [number, number] = [pyRound(tipX), bot - 3];
          const landedOn = P.layered().filter((p) => p !== sidePart && isOn(P.alpha(p), a.wrist[0], a.wrist[1]));
          const partDist = artDistance(m, a.wrist);
          arms.push({ ...a, tip, tipFallback, part: sidePart, snap: null, offLayer: { distance: partDist, landedOn } });
          continue;
        }
      }
    }
    const gap = 'by the larger of the x and y gaps';
    const reach = wristSnap === null ? `--wrist-snap ${Math.max(d, WRIST_ON_PART_PX + 1)} would bind it` : `beyond --wrist-snap ${wristSnap}`;
    const nearestIs =
      nearest.length === 1
        ? `the nearest is ${nearest[0].name}, ${d} px from its art ${gap} (${reach})`
        : `the nearest are ${nearest.map((p) => p.name).join(' and ')}, each ${d} px from its art ${gap}, so no tolerance says which`;
    return { arms: null, why: `${a.side}_wrist at ${fmtAt(a.wrist)} lies on the art of no handwear part within ${WRIST_ON_PART_PX} px, so it does not say which sleeve it ends; ${nearestIs}` };
  }
  const idle = hw.filter((p) => !arms.some((a) => a.part === p));
  if (idle.length > 0) {
    const why = gaps.length > 0 ? ` (${gaps.join('; ')})` : '';
    return { arms: null, why: `${idle.map((p) => p.name).join(', ')} ${idle.length === 1 ? 'carries' : 'carry'} the wrist of no arm whose three joints are given${why}` };
  }
  return { arms, why: null };
}

/**
 * One leg chain drafted from joints (issue #241): its name, the side whose
 * joints it runs through, its two links and tip in rig px, and the legwear
 * part its limb takes (issue #349).
 */
/**
 * Issue #517: the ankles of `legs` (each bound to the footwear part `feet[i]`) that lie on none of their leg's art
 * within 1 px along the joint line, read as assemble's cap reads it (`cutLimbs` in `src/assemble.ts`): the line
 * through the ankle across the shin bone's direction (knee -> ankle; the foot bone has no tip), the art each leg's
 * polyline (hip, knee, ankle, as the bones round them) owns by {@link nearestLimb} among the legs taking the same part,
 * in the legwear part and in its footwear part, alpha above {@link OPAQUE_ALPHA_ABOVE}. Empty when every ankle is on it.
 */
function anklesOffArt(P: PartSet, legs: readonly LegChain[], feet: readonly PartRecord[]): LimbJointOffArtFinding[] {
  const polys = legs.map((c) => [rnd(c.hip), rnd(c.knee), rnd(c.ankle)] as Pt[]);
  const box = [0, 0, P.W - 1, P.H - 1] as const;
  const out: LimbJointOffArtFinding[] = [];
  legs.forEach((c, i) => {
    const line = jointLine(rnd(c.knee), rnd(c.ankle), null);
    if (line === null) return;
    const takers = (part: PartRecord, of: (k: number) => PartRecord): number[] => legs.map((_, k) => k).filter((k) => of(k).name === part.name);
    const owned = (part: PartRecord, of: (k: number) => PartRecord): ((x: number, y: number) => boolean) => {
      const m = P.alpha(part);
      const ks = takers(part, of);
      const lines = ks.map((k) => polys[k]);
      return (x, y) => m.data[y * P.W + x] === 1 && ks[ks.length === 1 ? 0 : nearestLimb(lines, x, y)] === i;
    };
    const onLeg = owned(c.part, (k) => legs[k].part);
    const onFoot = owned(feet[i], (k) => feet[k]);
    const art = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < P.W && y < P.H && (onLeg(x, y) || onFoot(x, y));
    if (limbRun(line, art, box) !== null) return;
    out.push({ kind: 'limb-joint-off-art', side: c.side, limb: `leg_${c.side}`, keypoint: `${c.side}_ankle`, part: `foot_${c.side}`, from: feet[i].name, link: `leg_${c.side}1`, at: rnd(c.ankle), nearest: nearestOnLine(line, art, box) });
  });
  return out;
}

/**
 * Issue #518: a mesh's `segments` resolved to lines on the bones `bones` declares, as the rig stage resolves them
 * (`src/rig.ts`): a chain's name to each of its links, from the link's origin to the next link's or the tip; a single
 * bone to its origin and tip; an explicit `[bone, from, to]` as written. A name with no line resolves to nothing — the
 * rig stage names it (`RIG_SEGMENT_DEFINED`, `RIG_NAME_RESOLVES`).
 */
function meshSegmentsOf(bones: readonly BoneEntry[], segments: readonly Segment[]): WeightSegment[] {
  const out: WeightSegment[] = [];
  for (const sp of segments) {
    if (typeof sp !== 'string') {
      out.push({ bone: sp[0], a: [sp[1][0], sp[1][1]], b: [sp[2][0], sp[2][1]] });
      continue;
    }
    const chain = bones.find((e) => 'chain' in e && e.chain === sp);
    if (chain !== undefined && 'chain' in chain) {
      chain.points.forEach((q, k) => {
        const end = k + 1 < chain.points.length ? chain.points[k + 1] : chain.tip;
        out.push({ bone: `${sp}${k}`, a: [q[0], q[1]], b: [end[0], end[1]] });
      });
      continue;
    }
    const link = bones.flatMap((e) => ('chain' in e ? e.points.map((q, k) => ({ name: `${e.chain}${k}`, a: q, b: k + 1 < e.points.length ? e.points[k + 1] : e.tip })) : []));
    const l = link.find((x) => x.name === sp);
    if (l !== undefined) {
      out.push({ bone: sp, a: [l.a[0], l.a[1]], b: [l.b[0], l.b[1]] });
      continue;
    }
    const single = bones.find((e) => !('chain' in e) && e.name === sp);
    if (single !== undefined && !('chain' in single) && single.tip !== undefined) out.push({ bone: sp, a: [single.at[0], single.at[1]], b: [single.tip[0], single.tip[1]] });
  }
  return out;
}

interface LegChain {
  chain: string;
  side: 'r' | 'l';
  hip: [number, number];
  knee: [number, number];
  ankle: [number, number];
  part: PartRecord;
}

/**
 * The leg chains a keypoint file drafts for the legwear parts, or why none
 * is drafted (issue #241) — the sleeve's {@link armsFromJoints} for the legs.
 * A leg is complete when its hip, knee and ankle all have a position and the
 * hip and knee are two points; a legwear part carries a leg when the ankle
 * lies on its art within the LINT's own tolerance ({@link WRIST_ON_PART_PX}).
 * The joints are used only when every complete leg's ankle is on exactly one
 * part and every legwear part carries one, as for the sleeves; when a leg is
 * complete and they are not, `why` says so. With no complete leg nothing is
 * drafted and `why` is `null`: the proposal is the one written before the
 * rule existed.
 *
 * Every bound leg gets its own chain, `leg_<side>`, and becomes a limb
 * (issue #349): a part carrying both legs is split between the two limbs by
 * the cut itself (each pixel to the leg whose bones pass nearest it), so the
 * single midpoint chain the mesh needed when the legs touched (issue #241) is
 * not drafted. Each part gets one note saying which and why.
 */
function legsFromJoints(P: PartSet, lw: readonly PartRecord[], joints: RigJoints): { chains: LegChain[] | null; notes: string[]; why: string | null } {
  const complete: Array<{ side: 'r' | 'l'; hip: [number, number]; knee: [number, number]; ankle: [number, number] }> = [];
  const gaps: string[] = [];
  for (const s of ['r', 'l'] as const) {
    const hp = joints.joints[`${s}_hip`].at;
    const kn = joints.joints[`${s}_knee`].at;
    const an = joints.joints[`${s}_ankle`].at;
    if (hp === null || kn === null || an === null) {
      const absent = [hp === null ? `${s}_hip` : null, kn === null ? `${s}_knee` : null, an === null ? `${s}_ankle` : null].filter((n): n is string => n !== null);
      gaps.push(`${absent.join(', ')} ${absent.length === 1 ? 'has' : 'have'} no position`);
    } else if (hp[0] === kn[0] && hp[1] === kn[1]) gaps.push(`${s}_hip and ${s}_knee are one point, so the thigh has no direction`);
    else complete.push({ side: s, hip: hp, knee: kn, ankle: an });
  }
  // No complete leg is the file before this rule existed: nothing is said, and the part stays the trunk rule's.
  if (complete.length === 0) return { chains: null, notes: [], why: null };
  const near = new Map(lw.map((p) => [p, dilate(P.alpha(p), 2 * WRIST_ON_PART_PX + 1)]));
  const bound: Array<(typeof complete)[number] & { part: PartRecord }> = [];
  for (const g of complete) {
    const on = lw.filter((p) => isOn(near.get(p) as Mask, g.ankle[0], g.ankle[1]));
    if (on.length !== 1) {
      const where = on.length === 0 ? `the art of no legwear part within ${WRIST_ON_PART_PX} px` : `the art of ${on.length} legwear parts (${on.map((p) => p.name).join(', ')})`;
      return { chains: null, notes: [], why: `${g.side}_ankle at ${fmtAt(g.ankle)} lies on ${where}, so it does not say which part its leg is` };
    }
    bound.push({ ...g, part: on[0] });
  }
  const idle = lw.filter((p) => !bound.some((g) => g.part === p));
  if (idle.length > 0) {
    const why = gaps.length > 0 ? ` (${gaps.join('; ')})` : '';
    return { chains: null, notes: [], why: `${idle.map((p) => p.name).join(', ')} ${idle.length === 1 ? 'carries' : 'carry'} the ankle of no leg whose three joints are given${why}` };
  }
  const chains: LegChain[] = [];
  const notes: string[] = [];
  const still = 'no idle track is written for it: the chain is drafted whatever the pose, and whether the legs move is the scene\'s to key or drive';
  for (const p of lw) {
    const on = bound.filter((g) => g.part === p);
    if (on.length === 1) {
      const g = on[0];
      chains.push({ chain: `leg_${g.side}`, side: g.side, hip: g.hip, knee: g.knee, ankle: g.ankle, part: p });
      const other = g.side === 'r' ? 'l' : 'r';
      const lack = complete.some((q) => q.side === other) ? `${other}_ankle lies on another part` : gaps.join('; ');
      notes.push(`${p.name} (${p.from}): one leg chain, leg_${g.side}, hip -> knee -> ankle from the ${g.side} joints — ${g.side}_ankle lies on its art and no ${other} leg is bound to it (${lack}); ${still}`);
      continue;
    }
    // Issue #349: two legs on one part are two limbs; the cut gives each pixel to the leg whose bones pass nearest it,
    // so the legs need not be painted apart, and no midpoint chain stands for both.
    for (const g of on) chains.push({ chain: `leg_${g.side}`, side: g.side, hip: g.hip, knee: g.knee, ankle: g.ankle, part: p });
    notes.push(
      `${p.name} (${p.from}): one chain per leg, leg_r and leg_l — both ankles lie on its art; each runs hip -> knee -> ankle from its side's joints, the two limbs split the part between them (each pixel to the leg whose bones pass nearest it), and ${still}`,
    );
  }
  return { chains, notes, why: null };
}

/** A rig-px point as the notes and LINT lines print it: one decimal place. */
function fmtAt(p: readonly [number, number]): string {
  return `[${pyFixed(p[0], 1)}, ${pyFixed(p[1], 1)}]`;
}

/** How a joint is said: its state, where (rig px) when given, and the producer's score when it carries one. */
function said(n: KeypointName, j: RigJoint): string {
  const score = j.score === null ? '' : ` (score ${JSON.stringify(j.score)}, the producer's)`;
  if (j.at === null) return j.state === 'occluded' ? `${n} occluded with no position${score}` : `${n} missing${j.listed ? '' : ' (not listed)'}${score}`;
  return `${n} ${j.state} at ${fmtAt(j.at)}${score}`;
}

/** What a used joint was used as: given, or the producer's estimate. */
function usedAs(j: RigJoint): string {
  return j.state === 'observed' ? 'used as given' : "used as the producer's estimate";
}

interface JointNoteFacts {
  neckRule: string;
  hipRule: string;
  /** The ends the chest was placed half way between, when either is a joint. */
  chest: { neck: [number, number]; hip: [number, number] } | null;
  sleeveRule: string;
  armWhy: string | null;
  arms: JointArm[] | null;
  /** The leg chains drafted (issue #241), or `null` when none was: then no line here names a leg joint. */
  legs: LegChain[] | null;
  /** `propose --wrist-snap`, or `null` without it. */
  wristSnap: number | null;
  eyes: ReadonlyArray<{ bone: string; part: string; at: [number, number] } | null>;
}

/**
 * The notes `--keypoints` adds, after every note the rules wrote: a header
 * naming the file's person, source and map; one line per joint the proposer
 * could use — used as given for bone X, used as the producer's estimate for
 * bone X, or a rule placing bone X in its stead, with the rule named; the
 * distance from an eye joint to an eye bone measured off its eyewhite, with
 * no bar; and one line naming every other joint and its state, so no joint
 * is left unsaid and none is shown as anything it is not.
 */
function jointNotes(joints: RigJoints, f: JointNoteFacts): string[] {
  const J = joints.joints;
  const out: string[] = [];
  const [w, h] = joints.painting;
  const [W, H] = joints.rig;
  out.push(
    `keypoints: person "${joints.person}" from ${JSON.stringify(joints.source)}, painting ${w}x${h} px to the ${W}x${H} rig by the overlay's map (x * ${W}/${w}, y * ${H}/${h}); ` +
      'a joint with a position places its bone in place of the rule, a joint without one leaves the bone to its rule, and no bone is authored from a joint that no rule places',
  );
  const told = new Set<KeypointName>();
  const tell = (n: KeypointName, line: string): void => {
    told.add(n);
    out.push(line);
  };
  tell('neck', J.neck.at !== null ? `${said('neck', J.neck)}: ${usedAs(J.neck)} for bone neck` : `${said('neck', J.neck)}: the rule "${f.neckRule}" placed bone neck instead`);
  const hipsGiven = J.r_hip.at !== null && J.l_hip.at !== null;
  for (const [n, other] of [
    ['r_hip', 'l_hip'],
    ['l_hip', 'r_hip'],
  ] as const) {
    if (hipsGiven) tell(n, `${said(n, J[n])}: ${usedAs(J[n])} for bone hip, the midpoint of r_hip and l_hip — a point between two joints, not a joint`);
    else if (J[n].at !== null) tell(n, `${said(n, J[n])}: not used — bone hip is the midpoint of r_hip and l_hip, and ${other} has no position; the rule "${f.hipRule}" placed bone hip instead`);
    else tell(n, `${said(n, J[n])}: the rule "${f.hipRule}" placed bone hip instead`);
  }
  if (f.chest !== null) out.push(`chest: its rule, half way from neck to hip, taken along the line from neck ${fmtAt(f.chest.neck)} to hip ${fmtAt(f.chest.hip)} rather than down the screen`);
  const standIn = f.sleeveRule === '' ? 'no handwear part is over 500 px, so no sleeve chain is placed' : `${f.sleeveRule} stands in`;
  for (const s of ['r', 'l'] as const) {
    const arm = f.arms?.find((a) => a.side === s) ?? null;
    for (const [joint, role] of [
      [`${s}_shoulder`, 'link 0'],
      [`${s}_elbow`, 'link 1'],
      [`${s}_wrist`, 'the tip'],
    ] as const) {
      const j = J[joint];
      if (arm !== null && arm.offLayer !== null && joint === `${s}_wrist`) {
        const landed =
          arm.offLayer.landedOn.length > 0
            ? `, on ${arm.offLayer.landedOn.map((p) => `${p.name} (${p.from})`).join(', ')}`
            : '';
        tell(
          joint,
          `${said(joint, j)}: not used — ${s}_wrist at ${fmtAt(arm.wrist)} lies outside ${arm.part.name} (${arm.part.from})'s mask (${arm.offLayer.distance} px from its art by the larger of the x and y gaps${landed}); chain sleeve_${s}'s tip is placed at ${arm.part.name}'s bottom extent [${arm.tip[0]}, ${arm.tip[1]}] instead`,
        );
        continue;
      }
      const on =
        arm === null
          ? ''
          : arm.offLayer !== null
            ? `the elbow lies on ${arm.part.name}; ${s}_wrist lies outside ${arm.part.name}'s mask, so sleeve_${s}'s tip is ${arm.part.name}'s bottom extent [${arm.tip[0]}, ${arm.tip[1]}]`
            : arm.snap === null
              ? `the wrist lies on ${arm.part.name}`
              : `the wrist is bound to ${arm.part.name} by --wrist-snap`;
      if (arm !== null) tell(joint, `${said(joint, j)}: ${usedAs(j)} for chain sleeve_${s}, ${role} (${on})`);
      else if (j.at !== null && f.armWhy !== null) tell(joint, `${said(joint, j)}: not used — ${f.armWhy}; ${standIn}`);
      else if (j.at !== null) tell(joint, `${said(joint, j)}: not used — ${standIn}`);
      else tell(joint, `${said(joint, j)}: ${standIn}`);
    }
    // Issue #199: which wrist the declared tolerance bound, to which part, and how far.
    if (arm !== null && arm.snap !== null) {
      out.push(
        `wrist snap: ${s}_wrist at ${fmtAt(arm.wrist)} lies on no handwear part within ${WRIST_ON_PART_PX} px; --wrist-snap ${f.wristSnap} bound it to ${arm.part.name}, the nearest, ${arm.snap} px from its art by the larger of the x and y gaps`,
      );
    }
    // Issue #491: when the wrist keypoint lies outside the arm layer's mask, name the wrist, the arm layer, where it
    // landed, the chain tip at the layer's bottom extent, and the chain-derived elbow cut position.
    if (arm !== null && arm.offLayer !== null) {
      const landed =
        arm.offLayer.landedOn.length > 0
          ? `, on ${arm.offLayer.landedOn.map((p) => `${p.name} (${p.from})`).join(', ')}`
          : '';
      out.push(
        `PROPOSE_WRIST_OFF_LAYER: ${s}_wrist at ${fmtAt(arm.wrist)} lies outside ${arm.part.name} (${arm.part.from})'s mask (${arm.offLayer.distance} px from its art by the larger of the x and y gaps${landed}); chain sleeve_${s} places its tip at ${arm.part.name}'s bottom extent [${arm.tip[0]}, ${arm.tip[1]}] instead of ${s}_wrist, and limb arm_${s} places the elbow cut at [${pyRound(arm.elbow[0])}, ${pyRound(arm.elbow[1])}] (${fmtAt(arm.elbow)}) from the limb chain (${s}_shoulder [${pyRound(arm.shoulder[0])}, ${pyRound(arm.shoulder[1])}] -> ${s}_elbow [${pyRound(arm.elbow[0])}, ${pyRound(arm.elbow[1])}] -> [${arm.tip[0]}, ${arm.tip[1]}])`,
      );
    }
  }
  // Issue #199: two chains on one part are said, not left to share its mesh unremarked.
  const both = f.arms !== null && f.arms.length === 2 && f.arms[0].part === f.arms[1].part ? f.arms[0].part.name : null;
  if (both !== null) {
    out.push(
      `one handwear part holds both wrists: r_wrist and l_wrist both end on ${both}, so limbs arm_r and arm_l both take it, and the cut gives each pixel to the arm whose bones pass nearest it; ` +
        `where the arms touch or cross in its art that split is a line no painting draws — to draw it yourself, cut one sleeve out of ${both} with an assemble.cuts entry (a polygon round it) and name the piece as that arm's from`,
    );
  }
  // Issue #241: the knees and ankles a leg chain was drafted from, and the hips as its first link.
  for (const c of f.legs ?? []) {
    const on = `the ankle lies on ${c.part.name}`;
    out.push(`chain leg_${c.side}: link 0 is the ${c.side}_hip joint, ${fmtAt(c.hip)}`);
    for (const [joint, role] of [
      [`${c.side}_knee`, 'link 1'],
      [`${c.side}_ankle`, 'the tip'],
    ] as const) {
      tell(joint, `${said(joint, J[joint])}: ${usedAs(J[joint])} for chain leg_${c.side}, ${role} (${on})`);
    }
  }
  (['r', 'l'] as const).forEach((s, i) => {
    const n = `${s}_eye` as const;
    const j = J[n];
    if (j.at === null) return;
    const e = f.eyes[i];
    if (e === null) tell(n, `${said(n, j)}: no bone takes it — an eye bone comes only from an eyewhite part`);
    else tell(n, `${said(n, j)}: bone ${e.bone} is measured off ${e.part} (its box centre ${fmtAt(e.at)}) and is not moved; the joint is ${pyFixed(edgeLength(j.at[0] - e.at[0], j.at[1] - e.at[1]), 1)} px from it`);
  });
  const rest = KEYPOINT_NAMES.filter((n) => !told.has(n));
  if (rest.length > 0) out.push(`no rule reads ${rest.map((n) => said(n, J[n])).join(', ')} — no bone is authored from them`);
  return out;
}

// ---------------------------------------------------------------------------
// the lash that carries the crease (issue #26)
// ---------------------------------------------------------------------------

/**
 * A lash reaching more than this share of its own height above its eyewhite's
 * top is noted. Measured on the two public examples: their four lashes reach
 * 4-6 px above the eyewhite, 17-26 % of their height (demo 26 % / 17 %,
 * sample 18 % / 23 %), which is the lash line itself. The bar sits above that
 * with a 9-point margin; the character issue #26 reported is not in this tree,
 * so no figure of its crease is quoted here.
 */
export const LASH_ABOVE_SHARE_BAR = 0.35;

/**
 * A lash more than this many times the height of its pair is noted. The two
 * public examples' pairs are 24 / 23 px (1.04) and 22 / 22 px (1.00); the
 * pair issue #26 reported, 36x24 against 30x17, is 24 / 17 px (1.41).
 */
export const LASH_PAIR_RATIO_BAR = 1.2;

function pct(v: number): string {
  return `${Math.round(v * 100)} %`;
}

/**
 * The frontal reference the pitch proportions are written beside (issue #250):
 * each figure's range, `[min, max]`, over three drawn faces that face front —
 * `demo` and `scarf` as built here, and the seated character of
 * https://github.com/rig-c/trailer (its `inputs/`, assembled by this port at
 * the same plan) — read by {@link headFrame} with a `nose` part added to each
 * plan, which `assemble --propose-plan` never proposes (the reference's rule):
 * where the nose sits along eye midpoint -> mouth, demo 0.474, scarf 0.564,
 * trailer 0.630; the stem against the bar, demo 0.629, scarf 0.675, trailer
 * 0.510 (each on the eye bones `propose` writes). A drawn face does not carry a human face's ratios (the eyes are
 * larger and lower, the nose a dot), so no published human model's are used.
 *
 * The turn is not written (issue #250): on a face painted three-quarter
 * toward image left, the stem via the nose (skew −45.9 degrees, frontal
 * −8.2 to 0.8) and via the mouth (−11.1, frontal −5.3 to 3.6) and the face's
 * halves (image-left over image-right 0.681, frontal 0.839 to 1.032) all read
 * it beyond the frontal range on the turned side, but the eyewhites' widths
 * (0.913) read it inside the frontal range (0.898 to 1.000) — the trailer
 * character, facing front, reads more turned by that figure than the turned
 * face. Three readings that do not agree in order are not reported as one.
 */
export const FRONTAL_REFERENCE = {
  faces: ['demo', 'scarf', 'the rig-c/trailer character'],
  noseAlongStem: [0.474, 0.63],
  stemOverBar: [0.51, 0.675],
} as const;

/** The centroid of a part's biggest 8-connected blob — the mouth bone's rule — or why it has none. */
function blobPoint(P: PartSet, tag: string): FrameFeature {
  const ps = P.headFirst(tag);
  if (ps.length === 0) return { missing: `no part tagged ${tag}` };
  const cc = connectedComponents(P.alpha(ps[0]), 8);
  if (cc.count < 2) return { missing: `${ps[0].name} (${tag}) has no opaque pixel` };
  let best = 1;
  for (let i = 2; i < cc.count; i++) if (cc.stats[i].area > cc.stats[best].area) best = i;
  return { part: ps[0].name, at: [cc.stats[best].cx, cc.stats[best].cy] };
}

/**
 * The head's roll as the hair chains and their lint read it (issue #249):
 * {@link eyeLineDegrees} on the origins of the single bones `eye_r` and
 * `eye_l` as `bones` writes them — the one derivation of the roll, the one
 * {@link headFrameNotes} prints and the rig turns the face bones to. With no
 * such pair, or a pair in one column, why there is none.
 */
export function headRollOf(bones: readonly BoneEntry[], H: number): { degrees: number; eyes: [Point, Point] } | { none: string } {
  const at = (n: string): Point | null => {
    const e = bones.find((b) => 'name' in b && b.name === n);
    return e === undefined || 'chain' in e ? null : e.at;
  };
  const r = at('eye_r');
  const l = at('eye_l');
  if (r === null || l === null) return { none: `no single bone ${[r === null ? 'eye_r' : null, l === null ? 'eye_l' : null].filter((n) => n !== null).join(' or ')}, so there is no eye line to turn to` };
  if (r[0] === l[0]) return { none: `eye_r ${fmtAt(r)} and eye_l ${fmtAt(l)} share the column x = ${r[0]}, so the eye line has no left-to-right direction` };
  return { degrees: eyeLineDegrees(r, l, H), eyes: [r, l] };
}

/**
 * The px a fringe link of the template steps across its column, image-outward
 * (issue #249 keeps it; the reference's `dx`): `bang_r`'s first link 10 px
 * toward image-left, `bang_l`'s toward image-right, each tip 1.8 times that
 * from its root. It is the widest step across the column the fringe rule
 * writes in one link (the second steps 0.8 of it), so the off-lock LINT
 * ({@link lint}) allows a link this much drift across the head's down axis.
 */
export const FRINGE_STEP_PX = 10;

/**
 * The runs of `mask`'s art along a column of the head's frame (issue #249):
 * the column is the line through `foot` along the face's down axis, and the
 * pixels it reads are those inside the part's box whose centre lies within
 * half a pixel of that line. Ordered by the depth of their centre along the
 * down axis, two pixels whose centres are within sqrt(2) px in depth
 * (8-connected neighbours at most) are one run. Each run is `[start, end]`:
 * its first centre's depth less half a pixel and its last's plus half a
 * pixel — on the page's axes, exactly the top edge of its first row and the
 * bottom edge of its last. Shallowest first.
 */
function columnRuns(mask: Mask, box: PartRecord, ax: HeadAxes, foot: readonly [number, number]): Array<[number, number]> {
  const ds: number[] = [];
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      if (mask.data[y * mask.width + x] !== 1) continue;
      const [a, d] = ax.of(foot, [x + 0.5, y + 0.5]);
      if (Math.abs(a) <= 0.5) ds.push(d);
    }
  }
  ds.sort((p, q) => p - q);
  const runs: Array<[number, number]> = [];
  for (let i = 0; i < ds.length; i++) {
    if (i === 0 || ds[i] - ds[i - 1] > Math.SQRT2) runs.push([ds[i] - 0.5, ds[i] + 0.5]);
    else runs[runs.length - 1][1] = ds[i] + 0.5;
  }
  return runs;
}

/**
 * The depth along the face's down axis at which the column through `foot`
 * enters the part's box (issue #249): on the page's axes, the box's top row
 * less the foot's y, which is where the reference rooted the fringe. A column
 * that misses the box enters it nowhere, and its corners' least depth stands
 * in.
 */
function boxEntry(box: PartRecord, ax: HeadAxes, foot: readonly [number, number]): number {
  const o = ax.at(foot, 0, 0);
  const one = ax.at(foot, 0, 1);
  const n: [number, number] = [one[0] - o[0], one[1] - o[1]];
  const corners = (): number => Math.min(...[[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map((c) => ax.of(foot, [c[0], c[1]])[1]));
  let lo = -Infinity;
  let hi = Infinity;
  for (const [k, a, b] of [
    [0, box.x, box.x + box.w],
    [1, box.y, box.y + box.h],
  ] as const) {
    if (n[k] === 0) {
      if (o[k] < a || o[k] > b) return corners();
      continue;
    }
    const t0 = (a - o[k]) / n[k];
    const t1 = (b - o[k]) / n[k];
    lo = Math.max(lo, Math.min(t0, t1));
    hi = Math.min(hi, Math.max(t0, t1));
  }
  return lo <= hi ? lo : corners();
}

/** `[min, max]` as `a..b` at 3 places. */
function refRange(r: readonly [number, number] | readonly number[]): string {
  return `${pyFixed(r[0], 3)}..${pyFixed(r[1], 3)}`;
}

/**
 * The head frame's notes (issue #250): the bar through the eye bones'
 * origins as `bones` writes them, its roll, the eye midpoint and the
 * inter-eye distance; then the pitch proportions beside their frontal
 * reference ({@link FRONTAL_REFERENCE}). The turn is read by
 * {@link headFrame} but not written (the reference says why). A figure whose
 * part is missing is named, never estimated.
 * With no pair of eye bones there is no bar, and one note says why.
 */
export function headFrameNotes(P: PartSet, bones: readonly BoneEntry[]): string[] {
  const at = (n: string): Point | null => {
    const e = bones.find((b) => 'name' in b && b.name === n);
    return e === undefined || 'chain' in e ? null : e.at;
  };
  const r = at('eye_r');
  const l = at('eye_l');
  if (r === null || l === null) {
    const missing = [r === null ? 'eye_r' : null, l === null ? 'eye_l' : null].filter((n) => n !== null).join(' and ');
    return [`head frame: not read — no ${missing} bone (an eye bone comes only from an eyewhite), so there is no bar to read the roll, the turn or the pitch against`];
  }
  if (r[0] === l[0]) return [`head frame: not read — eye_r ${fmtAt(r)} and eye_l ${fmtAt(l)} share the column x = ${r[0]}, so the bar has no left-to-right direction`];
  const ew = (['eyewhite-r', 'eyewhite-l'] as const).map((t, i) => {
    const p = P.byTag(t)[0];
    return { part: p.name, mask: P.alpha(p), eye: i === 0 ? r : l };
  });
  const facePart = P.headFirst('face')[0];
  const hf: HeadFrame = headFrame([r, l], P.H, { nose: blobPoint(P, 'nose'), mouth: blobPoint(P, 'mouth') }, ew, facePart === undefined ? { missing: 'no part tagged face' } : { part: facePart.name, mask: P.alpha(facePart) });
  const f3 = (v: number): string => pyFixed(v, 3);
  const [el, er] = hf.eyes;
  const bar =
    `head frame: the bar runs through ${el === l ? 'eye_l' : 'eye_r'} ${fmtAt(el)} and ${er === l ? 'eye_l' : 'eye_r'} ${fmtAt(er)}, the eye bones' origins, ${f3(hf.bar)} px; ` +
    `roll ${f3(hf.roll)} degrees (Spine's, counter-clockwise) — the line the rig turns the face bones to and declares as invariants.axes; eye midpoint ${fmtAt(hf.mid)}`;
  const ref = FRONTAL_REFERENCE;
  const nose = hf.nose;
  const mouth = hf.mouth;
  const pitch =
    `head pitch: the nose sits ${hf.noseAlongStem === null ? `— (not read: ${'missing' in nose ? nose.missing : 'missing' in mouth ? mouth.missing : 'the mouth sits on the bar'})` : f3(hf.noseAlongStem)} of the way from the eye midpoint to the mouth (frontal ${refRange(ref.noseAlongStem)}); ` +
    `the stem, eye midpoint -> mouth, is ${'missing' in mouth ? `— (not read: ${mouth.missing})` : `${f3(mouth.down)} of the bar`} (frontal ${refRange(ref.stemOverBar)}); frontal ranges read on ${ref.faces.join(', ')}; the turn is not reported (src/propose.ts FRONTAL_REFERENCE says why)`;
  return [bar, pitch];
}

/**
 * The blink squashes each eye's parts about the eye bone, so anything painted
 * into the eyelash layer above the lid — a double-eyelid crease — is squashed
 * with it. A lash that reaches far above its eyewhite, or is much taller than
 * its pair, is noted; when some row between its top and the eyewhite's top
 * carries no art across the lash's whole width, the rows above the lowest such
 * row are proposed as a still piece (`motion.blink.still`) on the eye bone's
 * parent, `head`. The cut must be a clear row because the rig stage refuses
 * any other (`RIG_STILL_ROW_CLEAR`).
 */
function lashStills(P: PartSet, ew: Record<'r' | 'l', PartRecord | null>, notes: string[]): Record<string, { row: number; bone: string }> {
  const out: Record<string, { row: number; bone: string }> = {};
  const lash: Record<'r' | 'l', PartRecord | null> = { r: P.byTag('eyelash-r')[0] ?? null, l: P.byTag('eyelash-l')[0] ?? null };
  for (const s of ['r', 'l'] as const) {
    const la = lash[s];
    const eye = ew[s];
    if (la === null || eye === null) continue;
    const pair = lash[s === 'r' ? 'l' : 'r'];
    const above = eye.y - la.y;
    const share = above / la.h;
    const ratio = pair === null ? null : la.h / pair.h;
    const tall = share > LASH_ABOVE_SHARE_BAR;
    const odd = ratio !== null && ratio > LASH_PAIR_RATIO_BAR;
    if (!tall && !odd) continue;
    const im = P.images.get(la.name) as Raster;
    let row: number | null = null;
    for (let y = eye.y - 1; y > la.y && row === null; y--) {
      const r = y - la.y;
      if (r >= la.h) continue;
      let clear = true;
      for (let x = 0; x < la.w && clear; x++) if (im.data[(r * la.w + x) * 4 + 3] > 0) clear = false;
      if (clear) row = y;
    }
    const why = [
      `reaches ${above} px above ${eye.name}'s top, ${pct(share)} of its ${la.h} px height (noted above ${pct(LASH_ABOVE_SHARE_BAR)})`,
      ...(pair === null || ratio === null ? [] : [`is ${pyFixed(ratio, 2)}x the height of ${pair.name}, ${pair.h} px (noted above ${pyFixed(LASH_PAIR_RATIO_BAR, 2)}x)`]),
    ].join(' and ');
    if (row !== null) {
      out[la.name] = { row, bone: 'head' };
      notes.push(`${la.name} (${la.from}) ${why}: the blink would squash whatever is painted there, a crease included — rows above ${row} (a row with no art) split off as ${la.name}_still on head (motion.blink.still), which the blink does not move`);
    } else {
      notes.push(
        `${la.name} (${la.from}) ${why}: the blink squashes whatever is painted there, a crease included — no row between its top and the lid is clear across its width, so it is not split; if a crease is painted in, clear a row between it and the lash line and set motion.blink.still by hand`,
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// expand, lint, compare
// ---------------------------------------------------------------------------

export interface ExpandedBone {
  parent: string;
  x: number;
  y: number;
}

/** Config bones -> every bone by name (chain links as `<chain><i>`), plus the polylines to draw. */
export function expand(bones: readonly BoneEntry[]): { byName: Map<string, ExpandedBone>; chains: Array<[string, Point[]]> } {
  const byName = new Map<string, ExpandedBone>();
  const chains: Array<[string, Point[]]> = [];
  for (const e of bones) {
    if ('chain' in e) {
      let previous = e.parent;
      e.points.forEach((q, i) => {
        const n = `${e.chain}${i}`;
        byName.set(n, { parent: i === 0 ? e.parent : previous, x: q[0], y: q[1] });
        previous = n;
      });
      chains.push([e.chain, [...e.points, e.tip]]);
    } else {
      byName.set(e.name, { parent: e.parent, x: e.at[0], y: e.at[1] });
      if (e.tip !== undefined) chains.push([e.name, [e.at, e.tip]]);
    }
  }
  return { byName, chains };
}

/** A chain link off the art of a mesh it is a candidate for. */
export interface OffArtFinding {
  kind: 'off-art';
  bone: string;
  mesh: string;
  at: [number, number];
}

/**
 * A link of a lock the head carries whose line leaves the lock's run (issue
 * #249): it drifts across the head's down axis by more than the fringe
 * template's widest step, {@link FRINGE_STEP_PX}, plus a pixel's rounding at
 * each end. `degrees` is the link's angle off that axis and `limit` the angle
 * that drift allows over the link's reach down the axis; a link that does not
 * reach down the axis at all has no limit (`null`) and is named whatever its
 * angle.
 */
export interface OffLockFinding {
  kind: 'off-lock';
  bone: string;
  mesh: string;
  from: [number, number];
  to: [number, number];
  degrees: number;
  limit: number | null;
  roll: number;
}

/** The hip at or above the chest: breathing and every skirt chain hang from the wrong end of the torso. */
export interface HipAboveChestFinding {
  kind: 'hip-not-below-chest';
  hip: [number, number];
  chest: [number, number];
}

/** The hip above `HIP_MIN_FRACTION` of the figure's height: a hip at the shoulders. */
export interface HipTooHighFinding {
  kind: 'hip-too-high';
  hip: [number, number];
  /** The lowest y the hip may take, `figure.top + HIP_MIN_FRACTION * (figure.bot - figure.top)`. */
  limit: number;
  figure: { top: number; bot: number };
}

/** With joints: the chest bone does not fall strictly between the neck joint and the hip joints' midpoint along the line from one to the other. */
export interface ChestNotBetweenFinding {
  kind: 'chest-not-between';
  chest: [number, number];
  /** Where the chest falls along neck -> hips, 0 at the neck joint and 1 at the hips' midpoint. */
  t: number;
  neck: [number, number];
  hips: [number, number];
}

/** With joints: the hip bone does not fall further along neck -> hips than the chest bone — the joint-frame form of `hip-not-below-chest`. */
export interface HipNotPastChestFinding {
  kind: 'hip-not-past-chest';
  hip: [number, number];
  chest: [number, number];
  tHip: number;
  tChest: number;
}

/** With joints: the hip bone is nearer the neck joint than the hips' midpoint — the joint-frame form of `hip-too-high`. */
export interface HipNearerNeckFinding {
  kind: 'hip-nearer-neck';
  hip: [number, number];
  neck: [number, number];
  hips: [number, number];
  dNeck: number;
  dHips: number;
}

/** With joints: a sleeve chain's link or tip does not fall further along its shoulder -> wrist line than the one before it. */
export interface ChainNotAdvancingFinding {
  kind: 'chain-not-advancing';
  /** `<chain><i>`, or `<chain> tip`. */
  point: string;
  at: [number, number];
  /** Px along the joints' line from the root joint. */
  t: number;
  previous: string;
  tPrevious: number;
  fromJoint: KeypointName;
  toJoint: KeypointName;
}

/** Issue #314: two chains on one lattice whose own swing closes or opens an edge between them past check's TEXTURE_STRETCH bar (`src/squeeze.ts`). */
export type SqueezeLintFinding = { kind: 'squeeze' } & SqueezeFinding;

/**
 * Issue #400: a hand layer (`handwear-r` or `handwear-l`, un-cut) whose side's wrist keypoint is placed is held to at
 * least this share of the other hand layer's opaque pixel count (`ceil(HAND_MIN_OF_OTHER * other.opaque_px)`), or, when
 * the other side has no hand layer and the side's elbow and wrist keypoints are placed, to a square of the forearm's
 * width (`ceil(width²)`). On issue #400's overlapping-hands decomposition, See-through put 1,923 px into `handwear_l`
 * and 123 px of finger slivers into `handwear_r` (6.4 % of the other hand, below `ceil(0.25 * 1923) = 481` px); on two
 * separate hands (`standing` 1,200 / 1,200, `seated` 816 / 816, `lying` 1,120 / 1,120) the two layers are equal.
 */
export const HAND_MIN_OF_OTHER = 0.25;

/**
 * Issue #400: a hand layer holding fewer opaque pixels than the bar derived from the other hand layer or from the
 * forearm's width, while its side's wrist keypoint says a hand is there.
 */
export interface NearEmptyHandFinding {
  kind: 'near-empty-hand';
  part: string;
  from: string;
  side: 'r' | 'l';
  wrist: KeypointName;
  wristAt: [number, number];
  opaquePx: number;
  bar: number;
  basis:
    | { kind: 'other-hand'; otherPart: string; otherFrom: string; otherPx: number; share: number }
    | { kind: 'forearm-width'; width: number };
}

/**
 * Issue #445: back-hair cloth trees on one side of the eye axis whose count does not match the side's visible hair
 * masses or whose link or tip leaves its mass's column range.
 */
export interface BackHairMassesFinding {
  kind: 'back-hair-masses';
  mesh: string;
  side: 'r' | 'l';
  trunks: string[];
  masses: Array<{ minX: number; maxX: number; minY: number; maxY: number }>;
  outside: Array<{ point: string; at: [number, number]; minX: number; maxX: number }>;
}

/**
 * Issue #439: both arms overlap in one 8-connected component of a single handwear layer (`handwear-r` or `handwear-l`),
 * resolved by declaring `config.seethrough.arm_split` (`x` or `line`, and `order`).
 */
export interface OverlappingArmsFinding {
  kind: 'overlapping-arms';
  part: string;
  from: string;
  rAt: [number, number];
  lAt: [number, number];
  opaquePx: number;
}

/**
 * Issue #446: two limbs sharing one part (`from`) cross in an X at `at` with no `config.limbs.<limb>.split`
 * declared on the covering limb, so `nearestLimb` cuts a straight line through the crossing.
 */
export interface CrossedLimbsFinding {
  kind: 'crossed-limbs';
  part: string;
  from: string;
  a: string;
  b: string;
  at: [number, number];
}

/**
 * Issue #447: a stop's contact point `<chain>_touch` (`at` in `against`'s local frame) lies above the first stopped
 * link's root (`links[0]` at `[x0, y0]`) in rig pixels (`ty < y0`, i.e. higher Spine y), so `<chain>_rest` aims
 * upward into the upper half-plane (`|rest| > 90°`) and `|rest| + outward > 180°` wraps past ±180° (`RIG_STOP_BOUNDS`).
 */
export interface StopTouchAboveRootFinding {
  kind: 'stop-touch-above-root';
  chain: string;
  firstLink: string;
  rootAt: [number, number];
  against: string;
  at: [number, number];
  touchAt: [number, number];
  rest: number;
  outward: number;
}

/**
 * Issue #517: a leg's ankle keypoint lies on none of the leg's art within 1 px along its joint line, as assemble reads
 * the joint, so `propose` drafted the leg without its ankle cut ({@link anklesOffArt}): `at` the ankle (rig px), `link`
 * the chain link whose tip it is, and the nearest pixel of the leg's art on that line, or null when the line crosses
 * none. Handed to {@link lint} by `propose`; the keypoint is not moved onto the art (no value the author did not state).
 */
export interface LimbJointOffArtFinding {
  kind: 'limb-joint-off-art';
  side: 'r' | 'l';
  limb: string;
  keypoint: KeypointName;
  part: string;
  from: string;
  link: string;
  at: Point;
  nearest: { distance: number; at: Pt } | null;
}

/**
 * Issue #518: an influence radius `propose --cloth` drafted (no radius stated in the recipe): the part, the recipe's
 * target, and the rule's figures — `radius = farthest + cells × cell`, `farthest` the part's farthest lattice vertex
 * from its nearest link as `RIG_INFLUENCE_REACH` measures it. A LINT so the author sees what was drawn and from what.
 */
export interface InfluenceRadiusFinding {
  kind: 'influence-radius';
  part: string;
  tag: ClothTarget;
  radius: number;
  farthest: number;
  cells: number;
  cell: number;
}

/** What `propose` hands `lint` beside the proposal: findings of the draft itself, not of a check over the spec. */
export type DraftLintFinding = LimbJointOffArtFinding | InfluenceRadiusFinding;

export type LintFinding =
  | OffArtFinding
  | OffLockFinding
  | HipAboveChestFinding
  | HipTooHighFinding
  | ChestNotBetweenFinding
  | HipNotPastChestFinding
  | HipNearerNeckFinding
  | ChainNotAdvancingFinding
  | SqueezeLintFinding
  | NearEmptyHandFinding
  | BackHairMassesFinding
  | OverlappingArmsFinding
  | CrossedLimbsFinding
  | StopTouchAboveRootFinding
  | LimbJointOffArtFinding
  | InfluenceRadiusFinding;

/** Which rule set read the torso and the sleeve chains, under `--keypoints`. */
export interface LintBasis {
  person: string;
  torso: { read: true; neck: [number, number]; hips: [number, number] } | { read: false; why: string };
  chains: Array<{ chain: string; joints: [KeypointName, KeypointName]; line: { from: [number, number]; to: [number, number] } | null; why: string | null }>;
}

/** What a check could not look at, said rather than skipped. */
export interface LintResult {
  findings: LintFinding[];
  /** Meshes naming no part in parts.json: nothing to lint them against. */
  unknownMeshes: string[];
  /** Why the off-lock check (issue #249) read nothing though a head-run front hair mesh names a chain hung from head: no head frame, or no face box to find the chin by. Empty when it ran or had nothing to read. */
  lockUnread: string[];
  /** Single bones the torso checks read (`hip`, `chest`) that the bones do not hold: those checks did not run. */
  missingTorsoBones: string[];
  /** Issue #314: the pairs of keyed chains on one mesh the squeeze check could not build a lattice for, and why. Empty when it read every pair or had none. */
  squeezeUnread: string[];
  /** Issue #403: sibling branch pairs on a fork whose cell-boundary weights and spring strengths are unheld. */
  branchSqueezes: BranchSqueezeFinding[];
  /** Present only under `--keypoints`: the rule set that read the torso and the chains. */
  basis?: LintBasis;
  /** One record per bone of the spec, in its bone order (chain links as `<chain><i>`): which checks read it, or why none did (issue #86). */
  coverage: BoneCoverage[];
}

/** What lint's coverage says of a bone: read and named by no LINT line, read and named by one, or read by no check. */
export type CoverageOutcome = 'checked, clean' | 'checked, LINT' | 'not checked';

export const COVERAGE_OUTCOMES: readonly CoverageOutcome[] = ['checked, clean', 'checked, LINT', 'not checked'];

/**
 * One bone's coverage (issue #86). `read` names each check that read it — a
 * finding kind, and for the off-art check the mesh — and `lint` counts the
 * LINT lines that name it. With `read` empty, `why` says why no check did:
 * its role, the kind of segment that names it, a mesh that names no part, a
 * torso bone absent, a chain the joints declare no line for. A role is
 * {@link configRoles}' — read off the spec, never off a name — and `null`
 * only when the spec handed to `lint` carries no `regions` and `motion`.
 */
export interface BoneCoverage {
  bone: string;
  role: RoleOf | null;
  read: string[];
  lint: number;
  why: string[];
}

/** A coverage record's outcome. */
export function coverageOutcome(c: BoneCoverage): CoverageOutcome {
  return c.read.length === 0 ? 'not checked' : c.lint > 0 ? 'checked, LINT' : 'checked, clean';
}

/**
 * Chain links that sit off the art of a mesh they are a candidate for
 * (the part's mask dilated 15 px each way). A chain point in the background
 * still weights by distance, but it is almost always a mis-pick.
 *
 * As in the reference, only CHAIN segments are linted: a string segment names
 * the links `<segment><digits>`, so a single bone named as a segment has none,
 * and an explicit `[bone, from, to]` segment is a line, not an origin.
 *
 * Then the fringe (issue #249): every chain hung from `head` that a head-run
 * `front hair` part's mesh names, its tip no lower than the chin (the face
 * box's bottom centre) along the head's down axis — the eye line's
 * perpendicular, read by {@link headRollOf} — is a lock the head carries,
 * and a link of it that drifts across that axis by more than
 * {@link FRINGE_STEP_PX} plus sqrt(2) px (the template's widest step, and
 * each end rounded to whole px) is named, with its angle and the angle its
 * reach allows. A strand that hangs past the chin hangs with its weight and
 * is not held to the head. With no head frame or no face box, `lockUnread`
 * says why nothing was read.
 *
 * Then the torso, which the reference did not lint: a single bone `hip` that
 * is not below a single bone `chest` (larger y), and a `hip` above
 * `HIP_MIN_FRACTION` of the figure's height (every part's union, top row to
 * bottom row). Either one is a rig whose breath and skirt hang from the
 * shoulders, and a mesh check cannot see it.
 *
 * With `joints` (`--keypoints`, issue #75) the torso is read by the relations
 * the joints declare instead of by screen y, wherever the neck and both hip
 * joints have a position: along the line from the neck joint to the hips'
 * midpoint, the chest must fall strictly between them, the hip past the
 * chest, and the hip nearer the hips than the neck — so a seated or lying
 * figure is held to its own torso, not to "larger y is lower". Each sleeve
 * chain is read along its side's shoulder -> wrist: every link and the tip
 * must fall further along that line than the one before. No relation carries
 * a threshold; each is a definition. The off-art check is unchanged.
 *
 * Issue #86: beside the findings, `coverage` holds one record per bone of the
 * spec — the checks that read it, recorded as each check runs, or why none
 * did (its role, the segment that names it, a region, a mesh naming no part,
 * a torso bone absent, a chain the joints declare no line for). No check is
 * widened: an off-art check on single bones and explicit segments' ends is
 * not run, and the coverage says those bones are not checked.
 */
export function lint(
  P: PartSet,
  spec: { bones: readonly BoneEntry[]; meshes: Readonly<Record<string, MeshSpec>>; regions?: Readonly<Record<string, string>>; motion?: SkeletonSections['motion']; constraints?: readonly ConfigConstraint[]; limbs?: Readonly<Record<string, Limb>>; stops?: readonly ConfigStop[] },
  joints?: RigJoints,
  drafted: readonly DraftLintFinding[] = [],
): LintResult {
  const { byName } = expand(spec.bones);
  const parts = new Map(P.recs.map((p) => [p.name, p]));
  // Issue #517: what the proposer left uncut and why, first: the finding is the draft's, not a check's over the spec.
  const findings: LintFinding[] = [...drafted];
  const unknownMeshes: string[] = [];
  // Issue #86: which check read which bone, recorded where each check reads it.
  const read = new Map<string, string[]>([...byName.keys()].map((n) => [n, []]));
  const readBy = (n: string, check: string): void => {
    const list = read.get(n);
    if (list !== undefined && !list.includes(check)) list.push(check);
  };
  for (const f of drafted) if (f.kind === 'limb-joint-off-art') readBy(f.link, `limb-joint-off-art on ${f.limb}`);
  for (const [mname, m] of Object.entries(spec.meshes)) {
    const part = parts.get(mname);
    if (part === undefined) {
      unknownMeshes.push(mname);
      continue;
    }
    const mask = dilate(P.alpha(part), 31);
    const names: string[] = [];
    for (const sp of m.segments) {
      if (typeof sp !== 'string') continue;
      for (const n of byName.keys()) if (n.startsWith(sp) && /^[0-9]+$/.test(n.slice(sp.length))) names.push(n);
    }
    for (const n of names) {
      const b = byName.get(n) as ExpandedBone;
      const x = pyInt(b.x);
      const y = pyInt(b.y);
      readBy(n, `off-art on mesh ${pyRepr(mname)}`);
      if (!isOn(mask, x, y)) findings.push({ kind: 'off-art', bone: n, mesh: mname, at: [x, y] });
    }
  }
  // Issue #249: a lock the head carries runs along the head's down axis. The links read are those of every chain
  // hung from head that a head-run front hair part's mesh names, when the chain's tip lies no lower along that axis
  // than the chin (the face box's bottom centre): a strand that hangs past the chin hangs with its weight, not with
  // the head, and is not held to the head's axis. The roll is headRollOf's, the one derivation.
  const lockUnread: string[] = [];
  const lockMeshes = Object.entries(spec.meshes).filter(([mname]) => {
    const part = parts.get(mname);
    return part !== undefined && splitFrom(part.from)[0] === 'head' && splitFrom(part.from)[1] === 'front hair';
  });
  const lockChains = lockMeshes.flatMap(([mname, m]) =>
    m.segments.flatMap((sp) => {
      if (typeof sp !== 'string') return [];
      const e = spec.bones.find((b) => 'chain' in b && b.chain === sp);
      return e !== undefined && 'chain' in e && e.parent === 'head' ? [{ mesh: mname, entry: e }] : [];
    }),
  );
  if (lockChains.length > 0) {
    const roll = headRollOf(spec.bones, P.H);
    let chin: [number, number] | null = null;
    try {
      const [fx0, fy0, fw, fh] = faceBoxOf(P).box;
      chin = [fx0 + fw / 2, fy0 + fh];
    } catch (err) {
      if (!(err instanceof PartsError)) throw err;
      lockUnread.push(`no face box to find the chin by (${err.message.split('\n')[0]}), so no chain was read as a lock the head carries`);
    }
    if ('none' in roll) lockUnread.push(`${roll.none}, so no chain was read against the head's down axis`);
    else if (chin !== null) {
      const ax = headAxes(roll.degrees, P.H);
      const mid: [number, number] = [(roll.eyes[0][0] + roll.eyes[1][0]) / 2, (roll.eyes[0][1] + roll.eyes[1][1]) / 2];
      const chinD = ax.of(mid, chin)[1];
      for (const { mesh, entry } of lockChains) {
        if (ax.of(mid, entry.tip)[1] > chinD) continue;
        const pts = [...entry.points, entry.tip];
        entry.points.forEach((q, i) => {
          const bone = `${entry.chain}${i}`;
          readBy(bone, `off-lock on mesh ${pyRepr(mesh)}`);
          const [across, down] = ax.of(q, pts[i + 1]);
          const degrees = (Math.atan2(Math.abs(across), down) * 180) / Math.PI;
          // A drift of FRINGE_STEP_PX across, and each end within sqrt(2)/2 px of the point it was rounded from.
          const limit = down > 0 ? (Math.atan2(FRINGE_STEP_PX + Math.SQRT2, down) * 180) / Math.PI : null;
          if (limit === null || degrees > limit) findings.push({ kind: 'off-lock', bone, mesh, from: [q[0], q[1]], to: [pts[i + 1][0], pts[i + 1][1]], degrees, limit, roll: roll.degrees });
        });
      }
    }
  }
  const single = (n: string): [number, number] | null => {
    const e = spec.bones.find((b) => 'name' in b && b.name === n);
    return e !== undefined && 'name' in e ? [e.at[0], e.at[1]] : null;
  };
  const hip = single('hip');
  const chest = single('chest');
  const missingTorsoBones = [hip === null ? 'hip' : null, chest === null ? 'chest' : null].filter((n): n is string => n !== null);
  // Issue #75: with joints, where the torso joints are given, the torso is
  // read along the line they declare and the two screen-y rules do not run.
  const basis = joints === undefined ? undefined : lintBasis(spec.bones, joints);
  const T = basis !== undefined && basis.torso.read ? basis.torso : null;
  if (T !== null) {
    const v: [number, number] = [T.hips[0] - T.neck[0], T.hips[1] - T.neck[1]];
    const L2 = v[0] * v[0] + v[1] * v[1];
    const along = (p: readonly [number, number]): number => ((p[0] - T.neck[0]) * v[0] + (p[1] - T.neck[1]) * v[1]) / L2;
    if (chest !== null) readBy('chest', 'chest-not-between');
    if (hip !== null && chest !== null) for (const n of ['hip', 'chest']) readBy(n, 'hip-not-past-chest');
    if (hip !== null) readBy('hip', 'hip-nearer-neck');
    if (chest !== null && !(along(chest) > 0 && along(chest) < 1)) findings.push({ kind: 'chest-not-between', chest, t: along(chest), neck: T.neck, hips: T.hips });
    if (hip !== null && chest !== null && along(hip) <= along(chest)) findings.push({ kind: 'hip-not-past-chest', hip, chest, tHip: along(hip), tChest: along(chest) });
    if (hip !== null) {
      const dNeck = edgeLength(hip[0] - T.neck[0], hip[1] - T.neck[1]);
      const dHips = edgeLength(hip[0] - T.hips[0], hip[1] - T.hips[1]);
      if (dNeck < dHips) findings.push({ kind: 'hip-nearer-neck', hip, neck: T.neck, hips: T.hips, dNeck, dHips });
    }
  } else {
    if (hip !== null && chest !== null) for (const n of ['hip', 'chest']) readBy(n, 'hip-not-below-chest');
    if (hip !== null) readBy('hip', 'hip-too-high');
    if (hip !== null && chest !== null && hip[1] <= chest[1]) findings.push({ kind: 'hip-not-below-chest', hip, chest });
    if (hip !== null) {
      const figure = figureExtent(P);
      const limit = figure.top + HIP_MIN_FRACTION * (figure.bot - figure.top);
      if (hip[1] < limit) findings.push({ kind: 'hip-too-high', hip, limit, figure });
    }
  }
  if (basis !== undefined) {
    for (const c of basis.chains) {
      if (c.line === null) continue;
      const { from, to } = c.line;
      const len = edgeLength(to[0] - from[0], to[1] - from[1]);
      const e = spec.bones.find((b) => 'chain' in b && b.chain === c.chain);
      if (e === undefined || !('chain' in e)) continue;
      const pts: Array<[string, Point]> = [...e.points.map((q, i): [string, Point] => [`${c.chain}${i}`, q]), [`${c.chain} tip`, e.tip]];
      e.points.forEach((_, i) => readBy(`${c.chain}${i}`, `chain-not-advancing along ${c.joints[0]} -> ${c.joints[1]}`));
      const proj = pts.map(([, q]) => ((q[0] - from[0]) * (to[0] - from[0]) + (q[1] - from[1]) * (to[1] - from[1])) / len);
      for (let i = 1; i < pts.length; i++) {
        if (proj[i] <= proj[i - 1]) findings.push({ kind: 'chain-not-advancing', point: pts[i][0], at: pts[i][1], t: proj[i], previous: pts[i - 1][0], tPrevious: proj[i - 1], fromJoint: c.joints[0], toJoint: c.joints[1] });
      }
    }
  }
  // Issue #400: when a hand layer holds fewer opaque pixels than the bar derived from the other hand layer, or from the
  // forearm's width when the other side has no hand layer, while the wrist keypoint says a hand is there.
  if (joints !== undefined) {
    const handOf = (s: 'r' | 'l'): PartRecord | null => {
      const ps = P.byTag(`handwear-${s}`).filter((p) => p.limb === undefined);
      return ps.length === 1 ? ps[0] : null;
    };
    for (const s of ['r', 'l'] as const) {
      const wrist: KeypointName = `${s}_wrist`;
      const wristAt = joints.joints[wrist].at;
      const part = handOf(s);
      if (wristAt === null || part === null) continue;
      const other = handOf(s === 'r' ? 'l' : 'r');
      if (other !== null) {
        const bar = Math.ceil(HAND_MIN_OF_OTHER * other.opaque_px);
        if (part.opaque_px < bar) {
          findings.push({
            kind: 'near-empty-hand',
            part: part.name,
            from: part.from,
            side: s,
            wrist,
            wristAt: [wristAt[0], wristAt[1]],
            opaquePx: part.opaque_px,
            bar,
            basis: { kind: 'other-hand', otherPart: other.name, otherFrom: other.from, otherPx: other.opaque_px, share: HAND_MIN_OF_OTHER },
          });
        }
        continue;
      }
      const elAt = joints.joints[`${s}_elbow`].at;
      if (elAt === null) continue;
      const dx = wristAt[0] - elAt[0];
      const dy = wristAt[1] - elAt[1];
      const len = edgeLength(dx, dy);
      if (len === 0) continue;
      const armMasks = [...P.byTag('topwear'), part].map((p) => P.alpha(p));
      const art = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < P.W && y < P.H && armMasks.some((m) => m.data[y * P.W + x] === 1);
      const mid: [number, number] = [(elAt[0] + wristAt[0]) / 2, (elAt[1] + wristAt[1]) / 2];
      const axis: [number, number] = [dx / len, dy / len];
      const w = limbWidth({ at: mid, axis }, art, [0, 0, P.W - 1, P.H - 1]) ?? limbWidth({ at: elAt, axis }, art, [0, 0, P.W - 1, P.H - 1]);
      if (w === null) continue;
      const bar = Math.ceil(w * w);
      if (part.opaque_px < bar) {
        findings.push({
          kind: 'near-empty-hand',
          part: part.name,
          from: part.from,
          side: s,
          wrist,
          wristAt: [wristAt[0], wristAt[1]],
          opaquePx: part.opaque_px,
          bar,
          basis: { kind: 'forearm-width', width: w },
        });
      }
    }
  }
  // Issue #439: when both arms overlap in one 8-connected component of a single handwear layer, name the overlap and
  // the config.seethrough.arm_split declaration that separates them into two layers.
  if (joints !== undefined && joints.joints.r_wrist.at !== null && joints.joints.l_wrist.at !== null) {
    const hwParts = [...P.byTag('handwear-r', undefined, true), ...P.byTag('handwear-l', undefined, true)].filter((p) => p.limb === undefined);
    if (hwParts.length === 1) {
      const part = hwParts[0];
      const rAt: [number, number] = [joints.joints.r_wrist.at[0], joints.joints.r_wrist.at[1]];
      const lAt: [number, number] = [joints.joints.l_wrist.at[0], joints.joints.l_wrist.at[1]];
      {
        const cc = connectedComponents(P.alpha(part), 8);
        const compsNear = (pt: readonly [number, number]): Set<number> => {
          const hit = new Set<number>();
          const px = pyInt(pt[0]);
          const py = pyInt(pt[1]);
          const x0 = Math.max(0, px - WRIST_ON_PART_PX);
          const x1 = Math.min(P.W - 1, px + WRIST_ON_PART_PX);
          const y0 = Math.max(0, py - WRIST_ON_PART_PX);
          const y1 = Math.min(P.H - 1, py + WRIST_ON_PART_PX);
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const l = cc.labels[y * P.W + x];
              if (l > 0) hit.add(l);
            }
          }
          return hit;
        };
        const rComps = compsNear(rAt);
        const lComps = compsNear(lAt);
        const shared = [...rComps].find((l) => lComps.has(l));
        if (shared !== undefined) {
          findings.push({
            kind: 'overlapping-arms',
            part: part.name,
            from: part.from,
            rAt,
            lAt,
            opaquePx: cc.stats[shared].area,
          });
        }
      }
    }
  }
  // Issue #445: back-hair cloth trees (trunks `hairback_..._<r|l><k>_` hung from head) are held to the visible hair
  // masses on each side of the eye axis — one tree per mass, every link and tip inside that mass's column range.
  const bhParts = P.headFirst('back hair').filter((p) => spec.meshes[p.name] !== undefined);
  if (bhParts.length > 0) {
    try {
      const [fx0, fy0, fw, fh] = faceBoxOf(P).box;
      const ewR = P.byTag('eyewhite-r')[0] ?? null;
      const ewL = P.byTag('eyewhite-l')[0] ?? null;
      const axis = ewR !== null && ewL !== null ? (center(ewR)[0] + center(ewL)[0]) / 2 : fx0 + fw / 2;
      const eyeYs = [ewR, ewL].filter((x): x is PartRecord => x !== null).map((x) => center(x)[1]);
      const eyeY = eyeYs.length > 0 ? npMean(eyeYs) : fy0 + 0.5 * fh;
      const chin = fy0 + fh;
      const neckp = P.headFirst('neck');
      const neckY = joints?.joints.neck.at?.[1] ?? (neckp.length > 0 ? (chin + neckp[0].y + neckp[0].h) / 2 : chin + 0.12 * fh);
      const shoulderLine = neckY + 0.5 * fh;
      const y0 = pyRound(eyeY);
      const seenGroups = new Set<string>();
      for (const part of bhParts) {
        const m = spec.meshes[part.name];
        const segStrings = m.segments.filter((sp): sp is string => typeof sp === 'string');
        const trunkMatch = segStrings.map((sp) => /^(hairback_(?:.+_)?)(r|l)(\d+)_$/.exec(sp)).find((x) => x !== null) ?? null;
        if (trunkMatch === null) continue;
        const basePrefix = trunkMatch[1];
        if (seenGroups.has(basePrefix)) continue;
        seenGroups.add(basePrefix);
        const groupParts = bhParts.filter((q) =>
          spec.meshes[q.name].segments.some((sp) => typeof sp === 'string' && sp.startsWith(basePrefix) && /^(r|l)\d+_$/.test(sp.slice(basePrefix.length))),
        );
        const mask = groupParts.length === 1 ? P.alpha(part) : newMask(P.W, P.H);
        if (groupParts.length > 1) {
          for (const q of groupParts) {
            const mq = P.alpha(q);
            for (let i = 0; i < mask.data.length; i++) if (mq.data[i]) mask.data[i] = 1;
          }
        }
        const m0 = spec.meshes[groupParts[0].name];
        const g = 'grid' in m0 ? m0.grid : partGrid(groupParts[0])[0];
        for (const side of ['r', 'l'] as const) {
          const trunkRe = new RegExp(`^${basePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${side}(\\d+)_$`);
          const sideTrunks = spec.bones
            .filter((b): b is Extract<BoneEntry, { chain: string }> => 'chain' in b && b.parent === 'head' && trunkRe.test(b.chain) && groupParts.some((q) => spec.meshes[q.name].segments.includes(b.chain)))
            .sort((a, b) => Number(trunkRe.exec(a.chain)![1]) - Number(trunkRe.exec(b.chain)![1]));
          if (sideTrunks.length === 0) continue;
          const masses = backHairMasses(mask, side, axis, y0, shoulderLine, g);
          const massSlots = masses.flatMap((x) => Array.from({ length: backHairMassTrees(x, g) }, () => x));
          const outside: Array<{ point: string; at: [number, number]; minX: number; maxX: number }> = [];
          const sideMinX = masses.length > 0 ? Math.min(...masses.map((x) => x.minX)) : 0;
          const sideMaxX = masses.length > 0 ? Math.max(...masses.map((x) => x.maxX)) : P.W - 1;
          sideTrunks.forEach((tr, k) => {
            const target = k < massSlots.length ? massSlots[k] : null;
            const minX = target !== null ? target.minX : sideMinX;
            const maxX = target !== null ? target.maxX : sideMaxX;
            const treeBase = tr.chain.slice(0, -1);
            const treeRe = new RegExp(`^${treeBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-z]*_$`);
            const treeChains = spec.bones.filter((b): b is Extract<BoneEntry, { chain: string }> => 'chain' in b && treeRe.test(b.chain));
            for (const c of treeChains) {
              c.points.forEach((pt, idx) => {
                const px = pyInt(pt[0]);
                const py = pyInt(pt[1]);
                if (px < minX || px > maxX) outside.push({ point: `${c.chain}${idx}`, at: [px, py], minX, maxX });
              });
              const tx = pyInt(c.tip[0]);
              const ty = pyInt(c.tip[1]);
              if (tx < minX || tx > maxX) outside.push({ point: `${c.chain} tip`, at: [tx, ty], minX, maxX });
            }
          });
          if (sideTrunks.length !== massSlots.length || outside.length > 0) {
            findings.push({
              kind: 'back-hair-masses',
              mesh: groupParts.map((q) => q.name).join(' -> '),
              side,
              trunks: sideTrunks.map((t) => t.chain),
              masses: masses.map((x) => ({ minX: x.minX, maxX: x.maxX, minY: x.minY, maxY: x.maxY })),
              outside,
            });
          }
        }
      }
    } catch (err) {
      if (!(err instanceof PartsError)) throw err;
    }
  }
  // Issue #446: when two limbs sharing one part cross in an X without a per-limb split declared on the covering limb,
  // nearest-bone splitting cuts a straight line through the crossing.
  {
    const baseP = P.beforeLimbs();
    const places = bonePlaces(spec.bones);
    if (spec.limbs !== undefined) {
      const limbNames = Object.keys(spec.limbs);
      const fromParts = [...new Set(limbNames.flatMap((l) => spec.limbs![l].segments.map((sg) => sg.from)))];
      for (const src of fromParts) {
        const on = limbNames.filter((l) => spec.limbs![l].segments.some((sg) => sg.from === src));
        if (on.length < 2 || on.some((l) => spec.limbs![l].split !== undefined)) continue;
        const valid = on.filter((l) => spec.limbs![l].segments.every((sg) => places.has(sg.bone)));
        if (valid.length < 2) continue;
        const rec = baseP.recs.find((r) => r.name === src);
        for (let i = 0; i < valid.length; i++) {
          const polyA = limbPolyline(spec.limbs[valid[i]], places);
          for (let j = i + 1; j < valid.length; j++) {
            const polyB = limbPolyline(spec.limbs[valid[j]], places);
            const cross = limbCrossing(polyA, polyB);
            if (cross !== null) {
              findings.push({
                kind: 'crossed-limbs',
                part: src,
                from: rec?.from ?? '',
                a: valid[i],
                b: valid[j],
                at: cross,
              });
            }
          }
        }
      }
    } else {
      const legR = spec.bones.find((b): b is Extract<BoneEntry, { chain: string }> => 'chain' in b && b.chain === 'leg_r' && b.points.length >= 2);
      const legL = spec.bones.find((b): b is Extract<BoneEntry, { chain: string }> => 'chain' in b && b.chain === 'leg_l' && b.points.length >= 2);
      if (legR !== undefined && legL !== undefined) {
        const polyR: Array<[number, number]> = [...legR.points.map((p): [number, number] => [p[0], p[1]]), [legR.tip[0], legR.tip[1]]];
        const polyL: Array<[number, number]> = [...legL.points.map((p): [number, number] => [p[0], p[1]]), [legL.tip[0], legL.tip[1]]];
        const cross = limbCrossing(polyR, polyL);
        if (cross !== null) {
          const lwParts = baseP.byTag('legwear');
          const shared = lwParts.find((p: PartRecord) => {
            const near = dilate(baseP.alpha(p), 2 * WRIST_ON_PART_PX + 1);
            return isOn(near, legR.tip[0], legR.tip[1]) && isOn(near, legL.tip[0], legL.tip[1]);
          });
          if (shared !== undefined) {
            findings.push({
              kind: 'crossed-limbs',
              part: shared.name,
              from: shared.from,
              a: 'leg_r',
              b: 'leg_l',
              at: cross,
            });
          }
        }
      }
    }
  }
  // Issue #447: when a stop's contact point `<chain>_touch` (`at` in `against`'s local frame) lies above the first
  // stopped link's root (`links[0]`) in rig pixels (`ty < y0`, i.e. higher Spine y), `<chain>_rest` aims into the
  // upper half-plane (`|rest| > 90°`) and `|rest| + outward > 180°` wraps past ±180° (`RIG_STOP_BOUNDS`).
  if (spec.stops !== undefined && spec.stops.length > 0) {
    const boneEnds = new Map<string, Point>();
    const chainLinks = new Map<string, string[]>();
    for (const e of spec.bones) {
      if ('chain' in e) {
        const names = e.points.map((_, k) => `${e.chain}${k}`);
        chainLinks.set(e.chain, names);
        e.points.forEach((_, k) => {
          boneEnds.set(names[k], k + 1 < e.points.length ? e.points[k + 1] : e.tip);
        });
      } else if (e.tip !== undefined) {
        boneEnds.set(e.name, e.tip);
      }
    }
    for (const s of spec.stops) {
      const links = s.links ?? chainLinks.get(s.chain) ?? [];
      if (links.length === 0) continue;
      const firstLink = links[0];
      const rootBone = byName.get(firstLink);
      const againstBone = byName.get(s.against);
      if (rootBone === undefined || againstBone === undefined) continue;
      const againstEnd = boneEnds.get(s.against);
      let againstRot = 0;
      if (againstEnd !== undefined) {
        const dx = againstEnd[0] - againstBone.x;
        const dy = cropToSpineY(againstEnd[1], P.H) - cropToSpineY(againstBone.y, P.H);
        if (dx !== 0 || dy !== 0) againstRot = (Math.atan2(dy, dx) * 180) / Math.PI;
      }
      const frame = computeExactFrameTransforms([
        { name: s.against, x: againstBone.x, y: cropToSpineY(againstBone.y, P.H), rotation: againstRot },
      ]).get(s.against)!;
      const [wx, wy] = toWorld(frame, s.at[0], s.at[1]);
      const touchAt: [number, number] = [pyRound(wx * 10) / 10, pyRound(cropToSpineY(wy, P.H) * 10) / 10];
      const aimDx = wx - rootBone.x;
      const aimDy = wy - cropToSpineY(rootBone.y, P.H);
      if (aimDx === 0 && aimDy === 0) continue;
      const rest = pyRound(normaliseDegrees((Math.atan2(aimDy, aimDx) * 180) / Math.PI) * 100) / 100;
      if (touchAt[1] < rootBone.y || Math.abs(rest) + s.outward > 180) {
        findings.push({
          kind: 'stop-touch-above-root',
          chain: s.chain,
          firstLink,
          rootAt: [rootBone.x, rootBone.y],
          against: s.against,
          at: [s.at[0], s.at[1]],
          touchAt,
          rest,
          outward: s.outward,
        });
      }
    }
  }
  // Issue #314: every pair of keyed chains a lattice mesh names, swung on the rig stage's own lattice and weights, held
  // to check's TEXTURE_STRETCH bar (src/squeeze.ts). Only with a motion: without one nothing swings.
  const partImages = new Map(P.recs.filter((p) => P.images.has(p.name)).map((p) => [p.name, { x: p.x, y: p.y, image: P.images.get(p.name) as Raster }]));
  const sq = chainSqueezes({ bones: spec.bones, meshes: spec.meshes, motion: spec.motion }, partImages);
  for (const { mesh, a, b } of sq.read) {
    for (const [c, other] of [[a, b], [b, a]]) {
      const e = spec.bones.find((x) => 'chain' in x && x.chain === c);
      if (e !== undefined && 'chain' in e) e.points.forEach((_, i) => readBy(`${c}${i}`, `squeeze with ${other} on mesh ${pyRepr(mesh)}`));
    }
  }
  for (const f of sq.findings) findings.push({ kind: 'squeeze', ...f });
  const squeezeUnread = sq.unread;
  const branchSq = branchSqueezes({ bones: spec.bones, meshes: spec.meshes, constraints: spec.constraints }, partImages);
  const coverage = lintCoverage(spec, byName, read, findings, unknownMeshes, basis);
  return basis === undefined
    ? { findings, unknownMeshes, lockUnread, missingTorsoBones, squeezeUnread, branchSqueezes: branchSq, coverage }
    : { findings, unknownMeshes, lockUnread, missingTorsoBones, squeezeUnread, branchSqueezes: branchSq, basis, coverage };
}

/** The bones a finding names: the off-art link; hip and chest for a relation between them; a chain's last link for its tip. */
function findingBones(f: LintFinding, bones: readonly BoneEntry[]): string[] {
  switch (f.kind) {
    case 'off-art':
    case 'off-lock':
      return [f.bone];
    case 'limb-joint-off-art':
      return [f.link];
    case 'influence-radius':
      return [];
    case 'hip-not-below-chest':
    case 'hip-not-past-chest':
      return ['hip', 'chest'];
    case 'hip-too-high':
    case 'hip-nearer-neck':
      return ['hip'];
    case 'chest-not-between':
      return ['chest'];
    case 'squeeze':
      return [...new Set(f.vertices.map((v) => v.weights[0]?.bone).filter((n): n is string => n !== undefined))];
    case 'near-empty-hand':
    case 'overlapping-arms':
    case 'crossed-limbs':
    case 'stop-touch-above-root':
      return [];
    case 'back-hair-masses': {
      const out = new Set<string>();
      for (const o of f.outside) {
        if (!o.point.endsWith(' tip')) out.add(o.point);
        else {
          const chain = o.point.slice(0, -' tip'.length);
          const e = bones.find((b) => 'chain' in b && b.chain === chain);
          if (e !== undefined && 'chain' in e) out.add(`${chain}${e.points.length - 1}`);
        }
      }
      if (out.size === 0) for (const t of f.trunks) out.add(`${t}0`);
      return [...out];
    }
    case 'chain-not-advancing': {
      if (!f.point.endsWith(' tip')) return [f.point];
      const chain = f.point.slice(0, -' tip'.length);
      const e = bones.find((b) => 'chain' in b && b.chain === chain);
      return e !== undefined && 'chain' in e ? [`${chain}${e.points.length - 1}`] : [];
    }
  }
}

/**
 * Per bone: the checks that read it (recorded in `lint` as each check ran),
 * the LINT lines naming it, and — for a bone no check read — why, from what
 * names it in the spec. The off-art check reads only the links of a chain a
 * string segment names, so a single bone named as a segment (it has no
 * links) and an explicit `[bone, from, to]` segment (a line, not an origin)
 * are not read, and a region or a still piece binds its bone rigidly with
 * nothing to read. A control or a target binds nothing, so may sit off the
 * art by design: its role is the reason, never a finding.
 */
function lintCoverage(
  spec: { bones: readonly BoneEntry[]; meshes: Readonly<Record<string, MeshSpec>>; regions?: Readonly<Record<string, string>>; motion?: SkeletonSections['motion']; constraints?: readonly ConfigConstraint[] },
  byName: ReadonlyMap<string, ExpandedBone>,
  read: ReadonlyMap<string, string[]>,
  findings: readonly LintFinding[],
  unknownMeshes: readonly string[],
  basis: LintBasis | undefined,
): BoneCoverage[] {
  const roles =
    spec.regions !== undefined && spec.motion !== undefined ? configRoles({ bones: [...spec.bones], meshes: { ...spec.meshes }, regions: { ...spec.regions }, motion: spec.motion, constraints: spec.constraints }) : null;
  const chains = new Map<string, number>();
  for (const e of spec.bones) if ('chain' in e) chains.set(e.chain, e.points.length);
  const linked = (n: string): string | null => {
    for (const [c, k] of chains) if (n.startsWith(c) && /^[0-9]+$/.test(n.slice(c.length)) && Number(n.slice(c.length)) < k) return c;
    return null;
  };
  const named = new Map<string, number>();
  for (const f of findings) for (const b of findingBones(f, spec.bones)) named.set(b, (named.get(b) ?? 0) + 1);
  const out: BoneCoverage[] = [];
  for (const bone of byName.keys()) {
    const r = read.get(bone) ?? [];
    const role = roles === null ? null : (roles.get(bone) ?? null);
    const why: string[] = [];
    if (r.length === 0) {
      const chain = linked(bone);
      if (role === null) why.push('its role is not read: the spec handed to lint carries no regions and motion');
      else if (role.role !== 'deforms') {
        const byDesign = role.role === 'control' || role.role === 'target' ? `, and a ${role.role} may sit off the art by design` : '';
        why.push(`its role is ${role.role} (${role.why}): it binds nothing, so there is no art to hold it to${byDesign}`);
      }
      // What names it, grouped by kind: one reason per kind, every place named.
      const explicit: string[] = [];
      const single: string[] = [];
      const partless: string[] = [];
      for (const [mname, m] of Object.entries(spec.meshes)) {
        m.segments.forEach((sp, i) => {
          const at = `meshes.${mname}.segments[${i}]`;
          if (typeof sp !== 'string') {
            if (sp[0] === bone) explicit.push(at);
          } else if (sp === bone && chain === null) single.push(at);
          else if (chain !== null && sp === chain && unknownMeshes.includes(mname)) partless.push(`${at} (mesh ${JSON.stringify(mname)})`);
        });
      }
      const regions = Object.entries(spec.regions ?? {}).filter(([, b]) => b === bone).map(([part]) => `regions.${part}`);
      const stills = Object.entries(spec.motion?.blink?.still ?? {}).filter(([, st]) => st.bone === bone).map(([part]) => `motion.blink.still.${part}`);
      const s = (list: readonly string[], one: string, many: string): string => (list.length === 1 ? one : many);
      if (single.length > 0) why.push(`named as a single bone by ${single.join(', ')}: a single bone has no links, and the off-art check reads only the links <segment><digits> of a chain`);
      if (explicit.length > 0) {
        why.push(`bound by the explicit [bone, from, to] ${s(explicit, 'segment', 'segments')} ${explicit.join(', ')}: a segment is a line, not an origin, and the off-art check reads origins`);
      }
      if (partless.length > 0) why.push(`its chain is named by ${partless.join(', ')}, which ${s(partless, 'names', 'name')} no part in parts.json`);
      if (regions.length > 0) why.push(`bound rigidly by ${regions.join(', ')}: no check reads a region's bone`);
      if (stills.length > 0) why.push(`bound rigidly by ${stills.join(', ')}: no check reads a still piece's bone`);
      if (bone === 'chest' && !byName.has('hip')) why.push('the torso checks read chest beside a single bone "hip", which the bones do not hold');
      const c = basis?.chains.find((x) => x.chain === chain && x.line === null);
      if (c !== undefined) why.push(`lint chain ${c.chain}: not read against the joints (${c.why})`);
      if (why.length === 0) why.push('no mesh segment names it as a chain link of a mesh with a part, and no torso check reads it');
    }
    out.push({ bone, role, read: [...r], lint: named.get(bone) ?? 0, why });
  }
  return out;
}

/** The sleeve chains a keypoint file can be read against, and the joints each runs between. */
const ARM_CHAINS: ReadonlyArray<readonly [string, KeypointName, KeypointName]> = [
  ['sleeve_r', 'r_shoulder', 'r_wrist'],
  ['sleeve_l', 'l_shoulder', 'l_wrist'],
];

/**
 * What the joints let LINT read: the torso along the line from the neck joint
 * to the midpoint of the hip joints, when all three have a position and the
 * two ends are two points; and each sleeve chain (by its name, as `propose`
 * writes it) along its side's shoulder -> wrist, when both have a position.
 */
function lintBasis(bones: readonly BoneEntry[], joints: RigJoints): LintBasis {
  const J = joints.joints;
  const absent = (['neck', 'r_hip', 'l_hip'] as const).filter((n) => J[n].at === null);
  let torso: LintBasis['torso'];
  if (absent.length > 0) torso = { read: false, why: `${absent.map((n) => said(n, J[n])).join(', ')}` };
  else {
    const neck = J.neck.at as [number, number];
    const r = J.r_hip.at as [number, number];
    const l = J.l_hip.at as [number, number];
    const hips: [number, number] = [(r[0] + l[0]) / 2, (r[1] + l[1]) / 2];
    // Two joints at one point declare no line: every share of the way along it would divide by zero.
    torso = neck[0] === hips[0] && neck[1] === hips[1] ? { read: false, why: `neck and the midpoint of r_hip and l_hip are one point, ${fmtAt(neck)}, so they declare no line` } : { read: true, neck, hips };
  }
  const chains = ARM_CHAINS.map(([chain, a, b]): LintBasis['chains'][number] => {
    if (!bones.some((e) => 'chain' in e && e.chain === chain)) return { chain, joints: [a, b], line: null, why: `no chain named ${chain}` };
    const from = J[a].at;
    const to = J[b].at;
    if (from === null || to === null) return { chain, joints: [a, b], line: null, why: [from === null ? said(a, J[a]) : null, to === null ? said(b, J[b]) : null].filter((s) => s !== null).join(', ') };
    if (from[0] === to[0] && from[1] === to[1]) return { chain, joints: [a, b], line: null, why: `${a} and ${b} are one point, ${fmtAt(from)}, so they declare no line` };
    return { chain, joints: [a, b], line: { from, to }, why: null };
  });
  return { person: joints.person, torso, chains };
}

/**
 * The lines `propose --keypoints` prints before its LINT lines: which rule set
 * read the torso and on what basis, and which chains were read against which
 * joints. Without `--keypoints` nothing is printed, and the rule set is the
 * screen's, as it always was.
 */
export function basisLines(b: LintBasis): string[] {
  const out: string[] = [];
  if (b.torso.read) {
    out.push(
      `lint rule set: joints (person "${b.person}") — the torso is read along the line from the neck joint ${fmtAt(b.torso.neck)} to the midpoint of r_hip and l_hip ${fmtAt(b.torso.hips)}: ` +
        'the chest strictly between them, the hip past the chest, and the hip nearer the hips than the neck; the two screen-y torso rules do not run, and the off-art check is unchanged',
    );
  } else out.push(`lint rule set: screen — the torso joints do not declare a line (${b.torso.why}), so the hip is read by screen y as without keypoints; the off-art check is unchanged`);
  for (const c of b.chains) {
    out.push(c.line === null ? `lint chain ${c.chain}: not read against the joints (${c.why})` : `lint chain ${c.chain}: each link and the tip must advance from ${c.joints[0]} ${fmtAt(c.line.from)} toward ${c.joints[1]} ${fmtAt(c.line.to)}`);
  }
  return out;
}

/**
 * The LINT line. The off-art line is the reference's, verbatim:
 * `LINT sleeve_r0 at [335, 330] is off the art of mesh 'sleeves'`; the
 * torso and chain lines keep its shape, `LINT <bone> at [x, y] …`.
 */
export function lintLine(f: LintFinding): string {
  switch (f.kind) {
    case 'influence-radius':
      return (
        `LINT ${f.part} on mesh ${pyRepr(f.part)}: influence radius ${f.radius} = farthest ${f.farthest} + ${f.cells} × cell ${f.cell} — drafted by config.cloth.${JSON.stringify(f.tag)}.influence, ` +
        `the farthest lattice vertex from its nearest link (the figure RIG_INFLUENCE_REACH holds the radius above) plus ${f.cells} cells; a radius at the floor folds more than the lattice and a larger one is not safer (AUTHORING, influence.radius) — state influence.radius in the recipe to keep your own`
      );
    case 'limb-joint-off-art':
      return (
        `LINT ${f.part} at ${pyIntList(f.at)}, the ${f.keypoint} joint and ${f.link}'s tip, lies on none of ${f.limb}'s art within 1 px along its joint line (${offLineFigure(f.nearest)}), ` +
        `so assemble could not size the ankle's cap (ASSEMBLE_LIMB_JOINT_ON_ART): ${f.limb} is drafted without its ankle cut and ${f.from} stays one part — move the ${f.keypoint} keypoint onto the art of the leg or of ${f.from}, then re-run propose`
      );
    case 'off-art':
      return `LINT ${f.bone} at ${pyIntList(f.at)} is off the art of mesh ${pyRepr(f.mesh)}`;
    case 'off-lock':
      return (
        `LINT ${f.bone} at ${pyIntList(f.from)} runs to ${pyIntList(f.to)} ${pyFixed(f.degrees, 1)} degrees off the head's down axis (the eye line's perpendicular, roll ${pyFixed(f.roll, 1)}), ` +
        (f.limit === null
          ? 'and does not reach down it at all'
          : `more than the ${pyFixed(f.limit, 1)} its reach allows (a drift of ${FRINGE_STEP_PX} px across, the fringe template's widest step, and a pixel's rounding at each end)`) +
        `: a lock of mesh ${pyRepr(f.mesh)} the head carries runs along the head, and this link leaves it`
      );
    case 'hip-not-below-chest':
      return `LINT hip at ${pyIntList(f.hip)} is not below chest at ${pyIntList(f.chest)}: the hip must have the larger y, or breathing and the skirt hang from the shoulders`;
    case 'hip-too-high':
      return `LINT hip at ${pyIntList(f.hip)} is above ${HIP_MIN_FRACTION} of the figure height (figure y ${f.figure.top}..${f.figure.bot}, so hip y must be at least ${pyFixed(f.limit, 1)}): a hip at the shoulders`;
    case 'chest-not-between':
      return `LINT chest at ${pyIntList(f.chest)} is not between the neck joint ${fmtAt(f.neck)} and the midpoint of the hip joints ${fmtAt(f.hips)}: it falls at ${pyFixed(f.t, 2)} of the way from one to the other, and strictly between 0 and 1 is required`;
    case 'hip-not-past-chest':
      return `LINT hip at ${pyIntList(f.hip)} is not past chest at ${pyIntList(f.chest)} on the way from the neck joint to the hip joints (hip at ${pyFixed(f.tHip, 2)}, chest at ${pyFixed(f.tChest, 2)} of the way): breathing and the skirt hang from the wrong end of the torso`;
    case 'hip-nearer-neck':
      return `LINT hip at ${pyIntList(f.hip)} is nearer the neck joint ${fmtAt(f.neck)} (${pyFixed(f.dNeck, 1)} px) than the midpoint of the hip joints ${fmtAt(f.hips)} (${pyFixed(f.dHips, 1)} px): a hip at the shoulders`;
    case 'squeeze':
      return squeezeLine(f);
    case 'near-empty-hand': {
      const why =
        f.basis.kind === 'other-hand'
          ? `${f.basis.share} of ${f.basis.otherPart} (${f.basis.otherFrom}), ${f.basis.otherPx} px`
          : `forearm width ${pyFixed(f.basis.width, 1)} px squared`;
      return `LINT ${f.part} (${f.from}) holds ${f.opaquePx} opaque px while ${f.wrist} at ${fmtAt(f.wristAt)} says a hand is there — below the bar of ${f.bar} px (${why}): the hands may overlap in the other layer and leave finger slivers here`;
    }
    case 'overlapping-arms':
      return `LINT ${f.part} (${f.from}) holds both arms in one ${f.opaquePx} px component (r_wrist at ${fmtAt(f.rAt)}, l_wrist at ${fmtAt(f.lAt)}): declare config.seethrough.arm_split (x or line, and order: ["handwear-r", "handwear-l"] or ["handwear-l", "handwear-r"]) to separate the overlapping arms into two layers`;
    case 'crossed-limbs':
      return `LINT ${f.a} and ${f.b} on ${f.part}${f.from === '' ? '' : ` (${f.from})`} cross at ${fmtAt(f.at)} with no per-limb split: nearest-bone splitting cuts a straight line through the crossing; declare config.limbs.<covering>.split (line: [[x, y], ...] or edge: "painting") on the covering limb so the seam follows the limb`;
    case 'stop-touch-above-root':
      return `LINT stop on ${f.chain} (${f.firstLink} at ${fmtAt(f.rootAt)}) against ${f.against} (at ${fmtAt(f.at)}) places ${f.chain}_touch at ${fmtAt(f.touchAt)}, above ${f.firstLink}'s root (rest ${pyFixed(f.rest, 2)} deg, |rest| + outward ${pyFixed(Math.abs(f.rest) + f.outward, 2)} deg): stop against the descending limb bone below ${f.firstLink}, set links to start at a link below ${f.chain}_touch, or omit the stop on a rising limb`;
    case 'back-hair-masses': {
      const massDesc =
        f.masses.length === 0
          ? 'none'
          : f.masses.map((m, i) => `mass ${i} columns x=${m.minX}..${m.maxX}, y=${m.minY}..${m.maxY}`).join('; ');
      const outDesc =
        f.outside.length === 0
          ? ''
          : `; outside mass columns: ${f.outside.map((o) => `${o.point} at ${pyIntList(o.at)} (outside x=${o.minX}..${o.maxX})`).join(', ')}`;
      return `LINT ${f.trunks.join(', ')} on mesh ${pyRepr(f.mesh)} (side ${f.side}): ${f.trunks.length} tree(s) for ${f.masses.length} visible hair mass(es) (${massDesc})${outDesc} — draft one tree per visible hair mass, rooted at that mass's top row and inside its columns`;
    }
    case 'chain-not-advancing':
      return `LINT ${f.point} at ${pyIntList(f.at)} does not advance from ${f.fromJoint} toward ${f.toJoint}: it falls ${pyFixed(f.t, 1)} px along that line and ${f.previous} ${pyFixed(f.tPrevious, 1)} px, and each must fall further than the one before`;
  }
}

/**
 * The squeeze LINT line (issue #314): the pair and the mesh, the worst edge with both swinging and the bone each of
 * its two vertices rides most, the bar it is held to (check's), each chain swung alone, the tips' distance and the
 * amplitudes, and the remedies whose figure passes the bar — one sign when the amplitudes are opposed, dropping a
 * chain when the other alone passes — or, when none does, that the amplitudes are too large for this lattice.
 */
function squeezeLine(f: SqueezeLintFinding): string {
  const e = f.both.at;
  const C = TEXTURE_STRETCH_CEILING;
  const rides = f.vertices.map((v) => (v.weights.length === 0 ? `vertex ${v.vertex} rides no bone` : `vertex ${v.vertex} rides ${v.weights[0].bone} ${v.weights[0].weight}`)).join(', ');
  const amps = (c: { amps: readonly number[] }): string => `[${c.amps.join(', ')}]`;
  const remedies: string[] = [];
  if (f.turned !== null && f.turned <= C) remedies.push(`give both the same sign (then ${pyFixed(f.turned, 3)})`);
  if (f.aloneA <= C && f.aloneB <= C) remedies.push('drop one chain');
  else if (f.aloneA <= C) remedies.push(`drop ${f.b.chain}, which alone is past the bar too`);
  else if (f.aloneB <= C) remedies.push(`drop ${f.a.chain}, which alone is past the bar too`);
  const said =
    f.turned !== null
      ? `their amplitudes are opposed (${f.a.chain} ${amps(f.a)}, ${f.b.chain} ${amps(f.b)}), so their tips swing towards each other and apart`
      : `their amplitudes are ${f.a.chain} ${amps(f.a)} and ${f.b.chain} ${amps(f.b)}`;
  const remedy = remedies.length > 0 ? remedies.join(', or ') : 'neither one sign nor either chain alone passes the bar: lower the amplitudes';
  return (
    `LINT ${f.a.chain} and ${f.b.chain} on mesh ${pyRepr(f.mesh)} ${e.ratio >= 1 ? 'stretch' : 'squeeze'} it: swung together, every other bone held, ` +
    `edge ${e.edge.join('-')} of triangle ${e.triangle} ${e.ratio >= 1 ? 'opens' : 'closes'} to ${pyFixed(e.ratio, 3)} times its rest length at idle frame ${e.frame} (max(ratio, 1/ratio) ${pyFixed(f.both.severity, 3)}; ` +
    `<= ${C} is required, check's TEXTURE_STRETCH bar) — ${rides}; alone, ${f.a.chain} reads ${pyFixed(f.aloneA, 3)} and ${f.b.chain} ${pyFixed(f.aloneB, 3)}. ` +
    `Their tips are ${pyFixed(f.tipGap, 1)} px apart and ${said}: ${remedy}`
  );
}

/**
 * Issue #403: the note line naming a branch tip's squeezed triangle, the bones (`a` and `b` forked from `parent`),
 * the mechanism (`the weights where two branches' cells meet` and, when present, unequal spring strength on the fork),
 * and the setting (`split.hold_tip: true`) that holds the tip.
 */
export function branchSqueezeLine(f: BranchSqueezeFinding): string {
  const stiff =
    f.strengthA !== null && f.strengthB !== null && f.strengthA !== f.strengthB
      ? ` and unequal spring strength on the fork (${f.a} ${f.strengthA} vs ${f.b} ${f.strengthB})`
      : '';
  return (
    `LINT ${f.a} and ${f.b} (forked from ${f.parent}) on mesh ${pyRepr(f.mesh)} squeeze their tip: triangle ${f.triangle} across edge ${f.edge[0]}-${f.edge[1]} (tips ${pyFixed(f.tipGap, 1)} px apart) ` +
    `is squeezed by the weights where two branches' cells meet (vertex ${f.edge[0]} rides ${f.a} ${pyFixed(f.weightA, 5)}, vertex ${f.edge[1]} rides ${f.b} ${pyFixed(f.weightB, 5)} at r=${f.r} on a ${f.grid} px lattice)${stiff} — ` +
    `set split.hold_tip: true to hold the branch tips (keeps branch strength across the fork and raises r to grid)`
  );
}

export interface Comparison {
  rows: Array<[string, number]>;
  onlyConfig: string[];
  onlyProposal: string[];
}

/** Per bone the two share, in the config's order: the distance between the proposal's origin and the config's, in rig px. */
export function compare(proposal: readonly BoneEntry[], config: readonly BoneEntry[]): Comparison {
  const a = expand(proposal).byName;
  const b = expand(config).byName;
  const rows: Array<[string, number]> = [];
  for (const [n, cb] of b) {
    const pb = a.get(n);
    if (pb !== undefined) rows.push([n, edgeLength(pb.x - cb.x, pb.y - cb.y)]);
  }
  return { rows, onlyConfig: [...b.keys()].filter((n) => !a.has(n)), onlyProposal: [...a.keys()].filter((n) => !b.has(n)) };
}

/** The reference's compare printout, line for line. */
export function compareLines(c: Comparison): string[] {
  const out = c.rows.map(([n, v]) => `  ${n.padEnd(12)} ${pyFixed(v, 1).padStart(6)} px`);
  const d = c.rows.map((r) => r[1]);
  if (d.length > 0) {
    out.push(
      `matched ${d.length} bones: median ${pyFixed(npMedian(d), 1)} px, mean ${pyFixed(npMean(d), 1)}, p90 ${pyFixed(npPercentile(d, 90), 1)}, max ${pyFixed(Math.max(...d), 1)}; ` +
        `<=10 px ${d.filter((v) => v <= 10).length}, <=25 px ${d.filter((v) => v <= 25).length}`,
    );
  } else out.push('matched 0 bones: the proposal and the config share no bone name, so there is no distance to state');
  out.push(`in config only (hand-added): ${pyStrList(c.onlyConfig)}`);
  out.push(`in proposal only: ${pyStrList(c.onlyProposal)}`);
  return out;
}

// ---------------------------------------------------------------------------
// the overlay
// ---------------------------------------------------------------------------

const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [230, 25, 75],
  [60, 180, 75],
  [0, 130, 200],
  [245, 130, 48],
  [145, 30, 180],
  [70, 190, 190],
  [240, 50, 230],
  [128, 128, 0],
];

function setPx(r: Raster, x: number, y: number, c: readonly [number, number, number]): void {
  if (x < 0 || y < 0 || x >= r.width || y >= r.height) return;
  const i = (y * r.width + x) * 4;
  r.data[i] = c[0];
  r.data[i + 1] = c[1];
  r.data[i + 2] = c[2];
  r.data[i + 3] = 255;
}

function text(r: Raster, s: string, x0: number, y0: number, c: readonly [number, number, number]): void {
  const plot = (x: number, y: number): void => setPx(r, x, y, c);
  let x = Math.round(x0);
  const y = Math.round(y0);
  for (const ch of s) {
    if (ch === '_') for (let i = 0; i < 5; i++) plot(x + i, y + GLYPH_H - 1);
    else if (ch !== ' ') drawText(ch, x, y, 1, plot);
    x += 6;
  }
}

/** A line `width` px thick: a square brush stepped along the segment one pixel at a time. */
function line(r: Raster, a: readonly [number, number], b: readonly [number, number], width: number, c: readonly [number, number, number]): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
  const lo = -Math.floor((width - 1) / 2);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(a[0] + ((b[0] - a[0]) * i) / steps);
    const y = Math.round(a[1] + ((b[1] - a[1]) * i) / steps);
    for (let dy = lo; dy < lo + width; dy++) for (let dx = lo; dx < lo + width; dx++) setPx(r, x + dx, y + dy, c);
  }
}

function dot(r: Raster, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const d = edgeLength(dx, dy);
      if (d <= 3.5) setPx(r, Math.round(cx) + dx, Math.round(cy) + dy, [255, 0, 0]);
      else if (d <= 4.5) setPx(r, Math.round(cx) + dx, Math.round(cy) + dy, [0, 0, 0]);
    }
  }
}

/** A window of `src`, black where it reaches outside — what PIL's `crop` gives for a box past the edge. */
function cropPadded(src: Raster, x0: number, y0: number, x1: number, y1: number): Raster {
  const out = newRaster(x1 - x0, y1 - y0);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const sx = x + x0;
      const sy = y + y0;
      const o = (y * out.width + x) * 4;
      out.data[o + 3] = 255;
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
      const i = (sy * src.width + sx) * 4;
      out.data[o] = src.data[i];
      out.data[o + 1] = src.data[i + 1];
      out.data[o + 2] = src.data[i + 2];
    }
  }
  return out;
}

/**
 * The overlay: the painting resized to the rig and blended 55 % over white,
 * every part's outline in a rotating palette, a 50 px grid labelled every
 * 100 px, chains as blue polylines, every bone origin as a red dot with its
 * name, and the title bottom right. `head` is a 2x crop around the `head`
 * bone (300x320 rig px to 600x640), or null when no bone is named `head`.
 *
 * Layout, palette, blend, grid and crop are the reference's; two deviations,
 * both stated: labels are drawn in rig-c's 5x7 bitmap font (upper case)
 * rather than PIL's default font, and thick lines and dots are this module's
 * own raster rather than PIL's `ImageDraw` — the overlay is for reading, and
 * no claim is made that it matches the reference pixel for pixel.
 */
export function drawLandmarks(P: PartSet, source: Raster, bones: readonly BoneEntry[], title: string): { full: Raster; head: Raster | null } {
  const opaque = newRaster(source.width, source.height);
  for (let i = 0; i < source.width * source.height; i++) {
    opaque.data.set(source.data.subarray(i * 4, i * 4 + 3), i * 4);
    opaque.data[i * 4 + 3] = 255;
  }
  const src = resize(opaque, P.W, P.H, 'lanczos3');
  const im = newRaster(P.W, P.H);
  // PIL's Image.blend(white, src, 0.55): in1 + alpha * (in2 - in1) in float32, truncated.
  const alpha = Math.fround(0.55);
  for (let i = 0; i < P.W * P.H; i++) {
    for (let c = 0; c < 3; c++) im.data[i * 4 + c] = Math.trunc(Math.fround(255 + Math.fround(alpha * (src.data[i * 4 + c] - 255))));
    im.data[i * 4 + 3] = 255;
  }
  P.recs.forEach((p, i) => {
    const edge = morphGradient(P.alpha(p), 3);
    const c = PALETTE[i % PALETTE.length];
    for (let j = 0; j < edge.data.length; j++) if (edge.data[j]) setPx(im, j % P.W, Math.floor(j / P.W), c);
  });
  for (let x = 0; x < P.W; x += 50) {
    line(im, [x, 0], [x, P.H], 1, x % 100 ? [200, 200, 200] : [150, 150, 150]);
    if (x % 100 === 0) text(im, String(x), x + 2, 2, [80, 80, 80]);
  }
  for (let y = 0; y < P.H; y += 50) {
    line(im, [0, y], [P.W, y], 1, y % 100 ? [200, 200, 200] : [150, 150, 150]);
    if (y % 100 === 0) text(im, String(y), 2, y + 2, [80, 80, 80]);
  }
  const { byName, chains } = expand(bones);
  for (const [, pts] of chains) for (let k = 1; k < pts.length; k++) line(im, pts[k - 1], pts[k], 2, [0, 90, 255]);
  for (const [n, b] of byName) {
    dot(im, b.x, b.y);
    text(im, n, b.x + 6, b.y - 6, [0, 0, 0]);
  }
  text(im, title, P.W - 260, P.H - 16, [0, 0, 0]);
  const hb = bones.find((b) => 'name' in b && b.name === 'head');
  let headCrop: Raster | null = null;
  if (hb !== undefined && 'name' in hb) {
    const [hx, hy] = hb.at;
    const box = cropPadded(im, pyInt(hx - 150), Math.max(0, pyInt(hy - 190)), pyInt(hx + 150), pyInt(hy + 130));
    headCrop = box.width > 0 && box.height > 0 ? resize(box, 600, 640, 'lanczos3') : null;
  }
  return { full: im, head: headCrop };
}
