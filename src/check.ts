/**
 * The check stage: build a rig through rig-c, gate it under both
 * profiles, render its idle, and measure the two things the gate cannot see —
 * whether the setup pose IS the flat stack of parts (the seam), and whether the
 * idle ends where it began (the loop).
 *
 * ⭐ **This is the one stage that drives a subprocess, and it does not own the
 * spawn.** Every rigc step — build, validate, render — is rig-c's own CLI,
 * never a re-implementation of it, because rigc's gate is the only oracle
 * behind a skeleton (CLAUDE.md, "rig-c's gate is not optional here
 * either"): the spine-core round trip where the runtime resolves beside rigc,
 * rigc's own validator where it does not, and `check.json`'s `rigc_entry` says
 * which ({@link readRigcEntry}). But `src/` is held to no child
 * processes (`TY06`, with `src/comfy/` its one named exception), so the process
 * is injected: `runCheck` takes a {@link RigcRunner}, `cli.ts` hands it one
 * that spawns the binary {@link findRigc} located, and the selftest hands it
 * the same. What this module does with the file system is read inputs and write
 * the outputs listed below; it never reads the clock or the network.
 *
 * Input — a rig directory holding what the rig stage writes:
 * `rig.json`, `motion.json` (with an `idle` animation), `parts.json`, and
 * `parts/<name>.png` for every part (the last two may sit in a directory of
 * their own, `partsHome`). It is a rig SPEC, which `rigc build` compiles, not
 * a compiled skeleton. Since issue #77 the `idle` and `parts.json` may be
 * missing — a rig merged from several rig-parts outputs has neither — and
 * every line that reads the missing one says SKIP with the reason; the
 * painting (`--source`) adds {@link SOURCE_LINE}. The inputs are read only;
 * everything is written under the output directory (the idle's outputs only
 * when there is an idle):
 *
 * | output | what |
 * | --- | --- |
 * | `build/` | `rigc build --profile rig-play --pack --page-edges free --pack-shape polygon` (or `pot`, `rect`, when the caller names them; {@link PAGE_EDGES}, {@link PACK_SHAPES}) — the packed atlas is the final artifact |
 * | `gate_spine-html.txt` | that build's gate lines, verbatim — the one gate: rigc's `build` runs it once over the compile and once over the packed pages on disk, and `rig-play` holds every rule `spine` measures (selftest `CH09`) |
 * | `idle_frames/` | `rigc render --animation idle --fps 12 --max 640 --geometry`: `frames.json` + `idle/f*.png` + `idle/geometry.json` (each mesh's skinned vertices, which `TEXTURE_STRETCH` reads, every attachment's posed triangles, which `TIP_OVER_ROOT` and both halves of `STILL_REGIONS_DARK` read since issues #118 and #123, and every bone's world transform, which the face half reads its head bone from) |
 * | `contact.png` | rigc's own contact sheet of that render, copied out |
 * | `motion_heat.png` | frame 0 in grey with each pixel's largest change across the idle in red |
 * | `check.json` | the figures below and `PASS` |
 * | `requirements/` | under `--requirements` only (issue #93): `as-declared/<animation>/`, and per follow `released/<name>/` and `full/<name>/` — rigc renders with `--geometry` ({@link measureRequirements}) |
 *
 * The acceptance bars are the reference implementation's (`check_rig.py`):
 * both gate summaries `0 failed`; seam mean |d| <= 1.0 of 255 and at most 50
 * pixels differing by more than 40; loop max |d| == 0.
 *
 * Beside them, six judgement lines (issue #11, and #31 for the sixth) measure
 * what used to be left to an eye — `BREATH_VISIBLE`, `BLINK_NO_HOLE`,
 * `CHAIN_LAG`, `TIP_OVER_ROOT`, `STILL_REGIONS_DARK`, `TEXTURE_STRETCH` — from
 * rigc renders of the idle (the whole rig, or a part alone through `--slot`),
 * from the setup still with the blink held shut, from `motion.json` read as
 * sines, or from the skinned mesh vertices the idle render's `--geometry`
 * writes beside its frames (rig-c {@link RIGC_GEOMETRY_VERSION} or later,
 * which `check` asks `rigc --version` for before it builds anything). Each reports SKIP,
 * with the reason, when the rig has nothing for it to read. The instruments
 * are `src/instruments.ts`; the bars are below and in AUTHORING §7. After
 * them, one REPORTED line with no bar, `RECOMPOSITE_HOLES` (issue #25): the
 * uncovered holes `assemble` recorded in `parts.json`'s `recomposite` block,
 * copied into `check.json` because the seam cannot see them — it compares the
 * setup pose with the flat stack of parts, and a pixel no part holds is
 * missing from both. When `motion.json` holds an animation, one more bar,
 * `ANIMATIONS_DO_NOT_FOLD` (issues #320, #333): rigc's own `render --folds`
 * over every animation, the idle included, physics constraints left out
 * ({@link FOLD_LINE}). Beside it, where a `footwear` part rides a bone that
 * hangs from another, `FEET_STAY_LEVEL` (issue #348): the same render, with
 * `--geometry`, read for how far each such part's drawing turns while a bone
 * above it is turned ({@link LEVEL_LINE}). The part-alone renders, the shut-eye still, the keyed
 * build and the fold render are scratch (`_isolated/`, `_still/`, `_loop/`,
 * `_folds/`), removed before the stage returns.
 *
 * Where this port deliberately differs from the reference, each written where
 * it applies below: a gate summary is read with a pattern rather than the
 * substring `"0 failed"` (which `"10 failed"` contains); a gate with no summary
 * line is not green (Python's `all()` of nothing is `True`); the seam render's
 * `--max` is the rig canvas's longest side rather than the literal 1216 (which
 * was that for every rig it ever saw); the grey is read from rigc's
 * `frames.json` rather than typed; the crop-to-world map comes from the rig's
 * own stage box through `src/coords.ts` rather than an open-coded `-W/2`; and
 * the last idle frame is refused unless it sits at t = duration (within
 * `TIME_SLACK`, issue #244).
 */
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { measureRecomposite, type RecompositeFigures, recompositeRecord, scenePhrase, sourceInRig } from './assemble.ts';
import { type BoneTransform, computeExactFrameTransforms, cropToSpineY, normaliseDegrees, toBoneLocal } from './coords.ts';
import { capBox, inDisc } from './limbs.ts';
import { PartsError, type Problem, refuseIfAny } from './errors.ts';
import { framesInside, IDLE_FPS, TIME_SLACK } from './motion.ts';
import {
  blinkFigures,
  type GeometryPose,
  type MeshRest,
  blinkTracks,
  type ArtMask,
  type BoneTrack,
  type BoneWorld,
  boxLabel,
  crossingOf,
  type FrameMap,
  chainFigures,
  EYE_TAGS,
  eyeBones,
  FACE_FEATURE_TAGS,
  FACE_TAGS,
  FEET_TAGS,
  breathHeat,
  frameBox,
  heatField,
  partsTagged,
  type PixelBox,
  type PosedTriangles,
  regionHeat,
  partWorldBox,
  type RigRegion,
  setupToFrame,
  stillReading,
  stillTolerance,
  type StretchAt,
  stretchFigures,
  stretchSeverity,
  sweptBox,
  SWING_TAGS,
  topmostIndex,
  TORSO_TAGS,
  halfTravels,
  chainToward,
  type Toward,
  type WorldBox,
} from './instruments.ts';
import { type AlternatePartsRecord, type LimbRecord, type PartRecord, type PartsFile, readParts } from './parts.ts';
import { poseRigBonesForDrawn, type RigBone, SETS_FILE } from './rig.ts';
import { turnTwin } from './turn.ts';
import {
  aimLine,
  contactLine,
  declareConsumerDriven,
  followLine,
  forceMix,
  mutedLine,
  mutedOnly,
  placeTargets,
  type Poses,
  rangeLine,
  readRequirements,
  type RequirementLine,
  type MayFold,
  type RequirementsFile,
  requirementProblem,
  type RequirementsSummary,
  requirementsSummary,
  resolveRequirements,
  rigFacts,
  placedArt,
  type PosedAttachment,
  resolveSeams,
  type SeamFrame,
  seamLine,
  type SeamPair,
  stretchRequirementLine,
} from './requirements.ts';
import { RIG_BONE_INHERIT, type RigSpec as RigcRigSpec } from 'rig-c/src/rig.ts';
import { expandStops } from 'rig-c/src/stop.ts';
import { ENVIRONMENT_SPEC, EnvironmentError, readEnvironmentSchedule } from 'rig-c/src/environment.ts';
import { alphaComposite } from './raster/composite.ts';
import { readPng, writePng } from './raster/png.ts';
import { newFloatImage, newRaster, type Raster } from './raster/types.ts';
import type { BaseTag } from './tags.ts';
import { type ScaleTranslate, warpAffine } from './raster/warp.ts';
import { edgeLength } from './length.ts';

// ---------------------------------------------------------------------------
// the bars
// ---------------------------------------------------------------------------

/** Seam: mean max-channel |d| over the frame, in levels of 255, at most this. */
export const SEAM_MEAN_BAR = 1.0;
/**
 * Seam: pixels whose max-channel |d| exceeds {@link SEAM_PX_LEVEL}, at most
 * this many **rig** pixels — the frame count divided by s², s the frame scale
 * the setup-pose still renders at (issue #216). The frame holds s² pixels per
 * rig pixel, so a stack that parts from the render over a fixed area of the
 * rig reads s² times as many frame pixels: on the public sample a part moved
 * 2 rig px read 400, 891 and 1,560 frame px over 40 at s = 1.0, 1.5 and 2.0,
 * and 400, 396 and 390 divided by s²; the uncut sample 3, 3 and 7 frame px
 * [measured for issue #216, a scratch run, not tracked]. At s = 1 the bar is
 * the reference's frame count.
 */
export const SEAM_PX_BAR = 50;
export const SEAM_PX_LEVEL = 40;
/** Seam: the second, reported-only level. */
export const SEAM_PX_LEVEL_HIGH = 80;
/** Loop: frame 0 vs the frame at t = duration, largest |d|, exactly this. */
export const LOOP_MAX_BAR = 0;

/** The idle render the reference makes, and the one issue #1's loop is encoded from. Defined beside the blink it has to see (`src/motion.ts`). */
export { IDLE_FPS };
export const IDLE_MAX_PX = 640;
/** The throwaway setup-pose animation: one key at 0 and one at this time, rendered at this rate. */
const STILL_DURATION = 0.1;
const STILL_FPS = 10;

/**
 * The judgement lines' bars (issue #11). Each is derived from the two public
 * examples by one stated rule, and AUTHORING §7 quotes what each example
 * measures beside it: a floor is half the weaker example's figure, a ceiling
 * twice the worse one's, so the weaker example clears every bar by a factor of
 * two; a bar the model itself fixes (a still part does not move, a lag is
 * above 0, a hole is 0 pixels) is that value, not a margin. The still regions'
 * bar is the model's too — nothing moves — read up to the arithmetic's own
 * rounding (`stillTolerance` in `src/instruments.ts`, issue #123).
 */
export const BREATH_TORSO_MEAN_FLOOR = 3.809;
export const BREATH_FEET_MAX_CEILING = 0;
export const BLINK_HOLE_BAR = 0;
/** The reported colour-patch level: the seam's own "differs by more than 40". */
export const BLINK_PATCH_LEVEL = SEAM_PX_LEVEL;
/** The smallest lag the reading resolves, in cycles: phases are written to three places. */
export const CHAIN_LAG_MIN_STEP = 0.001;
export const TIP_RATIO_FLOOR = 1.4725;
/**
 * Issue #245: the bar a part the scene declares `rests` is held to — its tip
 * half travels no further than its root half, tip / root <= 1, read at the
 * line's precision (three places), and with a root that does not move, a tip
 * that does not either. The declaration's own relation fixes it ("the tip's
 * motion no greater than the root's"), a value the model fixes and not a
 * margin: no example declares `rests`, so the floor-and-ceiling rule above
 * has no figure to halve or double.
 */
export const TIP_REST_RATIO_CEILING = 1;
/**
 * `TEXTURE_STRETCH`'s ceiling on max(ratio, 1/ratio) (issue #31): the worse
 * example's figure (demo, 1.388) squared. The ceiling rule is "twice the worse
 * one's", and it is applied to the quantity whose zero means "nothing
 * happened", as it is for heat: for an edge ratio that is |ln r|, so twice
 * |ln 1.388| is ln(1.388²). Doubling the ratio itself (2.776) was rejected —
 * its zero is not at 1, and it would pass an edge drawn at 2.7 times its rest
 * length, the mutant the line exists to catch included.
 */
export const TEXTURE_STRETCH_CEILING = 1.926544;

/** The first rig-c whose `render` writes `geometry.json` (`--geometry`, rig-c 1.4.0's changelog). */
export const RIGC_GEOMETRY_VERSION = '1.4.0';
/** The geometry export's file name inside a frame set directory, and the format tag it carries. */
export const GEOMETRY_FILE = 'geometry.json';
export const GEOMETRY_SPEC = 'rigc-geometry/1';

/** Issue #2's yardstick, measured on the Spine example export `spineboy.png` (alpha > 0). */
export const SPINEBOY_YARDSTICK = '1024x256, 40 region(s), 45.8% opaque (alpha > 0)';

/**
 * What a packed page's edges may be: rig-c's `build --pack --page-edges`,
 * handed to it verbatim (the flag is in rig-c's CLI since 1.4.0, the
 * floor `check` already requires; 1.5.0 made `free` search every width).
 * `pot` is a power of two on both edges; `free` is the least-area page the
 * placement needs, at the cost rigc's help states: region attachments sample
 * within 1 LSB of the loose build rather than exactly.
 *
 * `free` is the default here although rigc's own default is `pot`: the packed
 * page is this package's final artifact, and on the two public examples `free`
 * takes the page from 1024x2048 to 967x1338 (covered 56.3 % -> 91.2 %) and
 * from 512x2048 to 479x1166 (49.7 % -> 93.4 %), rigc 1.5.1, 2.0.3, 2.1.3 and 2.10.1 (`rect`) alike. The cost was
 * measured on the same two builds. Each of the 49 idle frames differs from the
 * `pot` build's, by at most 1 level in any channel (demo 2,373 px, sample 651
 * px over all 49). On sample that moves STILL_REGIONS_DARK's reported
 * screen-space face mean from 11.475 to 11.472; no bar or status moves. The
 * atlas rigc writes says `filter: Linear, Linear` and has no `repeat` line, so
 * a consumer that mipmaps or repeats the page itself is the one that wants
 * `pot`. AUTHORING §5, *Page edges*, holds the tables.
 */
export const PAGE_EDGES = ['pot', 'free'] as const;
export type PageEdges = (typeof PAGE_EDGES)[number];
export const DEFAULT_PAGE_EDGES: PageEdges = 'free';

/**
 * What two packed rectangles may share: rig-c's `build --pack
 * --pack-shape`, handed to it verbatim (in rig-c's CLI since 2.1.0; this
 * package's range starts at 2.15.0). `rect` keeps every region's cell apart;
 * `polygon` packs a region that only meshes draw by its emitted hull, so a
 * neighbour may sit inside its rectangle where the hull is not, with the
 * padding kept between footprints — a region attachment stays its rectangle
 * (rigc's help).
 *
 * `polygon` is the default here although rigc's own default is `rect`, for the
 * reason {@link DEFAULT_PAGE_EDGES} is `free`: the packed page is this
 * package's final artifact, rigc gates the footprints on the pages on disk
 * (`A49_PACKED_FOOTPRINTS_DO_NOT_OVERLAP`), and the cost is the class already
 * accepted for `free`. Measured with rig-c 2.1.3, and again with 2.10.1,
 * whose pages, atlases and idle frames are byte-identical to it (the full entry,
 * spine-core 4.3.13 beside it), `rig-parts build` on the two public examples
 * under `--page-edges free`: `polygon` takes demo's page from 967x1338 (91.2 %
 * covered) to 922x1348 (95.0 %), 3.9 % less area, and sample's from 479x1166
 * (93.4 %) to 477x1151 (95.0 %), 1.7 % less. Each of the 49 idle frames at 12
 * fps differs from the `rect` build's by at most 1 level in any channel (demo
 * 2,594 px, sample 740 px over all 49), and no figure in `check.json` but
 * `pack_mode` moves. Under `--page-edges pot` both shapes give the same page
 * size and the same frames. AUTHORING §5, *Pack shape*, holds the tables.
 * `--pack-shape rect` writes the page and atlas rigc 2.0.3 wrote for 0.7.0
 * (measured byte for byte on both examples; selftest `CK53` holds rect to
 * rigc's own rect page).
 */
export const PACK_SHAPES = ['rect', 'polygon'] as const;
export type PackShape = (typeof PACK_SHAPES)[number];
export const DEFAULT_PACK_SHAPE: PackShape = 'polygon';

/** How a packed build packs: its `--page-edges` and its `--pack-shape`, each handed to rigc verbatim. */
export interface PackMode {
  pageEdges: PageEdges;
  packShape: PackShape;
}

/** Both defaults, {@link DEFAULT_PAGE_EDGES} and {@link DEFAULT_PACK_SHAPE}. */
export const DEFAULT_PACK_MODE: PackMode = { pageEdges: DEFAULT_PAGE_EDGES, packShape: DEFAULT_PACK_SHAPE };

/**
 * The profile every rigc build this package runs is gated under. rig-c 2.50.0
 * renamed `spine-html` to `rig-play` and runs the same rules under it; the old
 * name is accepted only until a later minor release and prints a deprecation
 * line on stderr (selftest `CK20` holds every stage's build to the new name).
 */
export const GATE_PROFILE = 'rig-play';

/** The packed build's rigc arguments after `--out <dir>`, as every stage that packs passes them. */
export function packedBuildArgs(mode: PackMode): string[] {
  return ['--profile', GATE_PROFILE, '--pack', '--page-edges', mode.pageEdges, '--pack-shape', mode.packShape];
}

/** The packed build as a label: the rigc command line that was run, after `rigc`. */
export function packedBuildLabel(mode: PackMode): string {
  return `build ${packedBuildArgs(mode).join(' ')}`;
}

// ---------------------------------------------------------------------------
// the rigc process, injected
// ---------------------------------------------------------------------------

export interface RigcCall {
  /** Exit status; a process that did not start is reported by the runner as a non-zero status with the reason in `out`. */
  status: number;
  /** stdout then stderr. */
  out: string;
  /**
   * Which rigc ran the call, as {@link rigcIdentity} words it (`rigc <version> at <path>`), from a runner that knows
   * its binary ({@link rigcRunnerAt}): set on every call that exited non-zero and on every `--version` call, so a
   * refusal quoting the call names the binary and its version (issue #337). Absent from a runner that does not know.
   */
  ran?: string;
}

export type RigcRunner = (args: readonly string[]) => RigcCall;

/** The process primitive {@link rigcRunnerAt} is given: `src/` spawns nothing, so the caller's spawn is injected. */
export type RigcSpawn = (bin: string, args: readonly string[]) => RigcCall;

/**
 * A rigc binary as what it says it is: `rigc <version> at <path>`, the version being the first line `--version`
 * printed — the line `check` prints before it builds (`checkStage`). A `--version` run that exited non-zero or
 * printed nothing is said so, with the path, rather than read as a version.
 */
export function rigcIdentity(bin: string, version: RigcCall): string {
  const first = version.out.trim().split('\n')[0] ?? '';
  if (version.status === 0 && first !== '') return `rigc ${first} at ${bin}`;
  return `rigc (\`--version\` exited ${version.status}${first === '' ? ' and printed nothing' : `, printing ${JSON.stringify(first)}`}) at ${bin}`;
}

/** The clause a refusal quoting a rigc call ends with: which rigc ran it ({@link RigcCall.ran}), or nothing when the runner did not say. */
export function rigcRanClause(call: { ran?: string }): string {
  return call.ran === undefined ? '' : `; ${call.ran} ran it`;
}

/**
 * The runner every stage is given (issue #337): `bin` spawned through `spawn`, each call that exited non-zero, and
 * each `--version` call, carrying {@link RigcCall.ran}. The identity is read once per runner, off its first
 * `--version` call or, when a call fails before any, off one `--version` run then — so a green run spawns nothing
 * extra, and a failure names the binary and version that produced it rather than leaving the reader to guess
 * which rigc a path resolved to.
 */
export function rigcRunnerAt(bin: string, spawn: RigcSpawn): RigcRunner {
  let identity: string | null = null;
  return (args) => {
    const call = spawn(bin, args);
    const version = args.length === 1 && args[0] === '--version';
    if (version) {
      const own = rigcIdentity(bin, call);
      identity ??= own;
      return { ...call, ran: own };
    }
    if (call.status === 0) return call;
    identity ??= rigcIdentity(bin, spawn(bin, ['--version']));
    return { ...call, ran: identity };
  };
}

/** A line in which a rigc run that stopped says why: Bun's own `error: …`, rigc's `rigc <command>: …` refusals, a `usage: …` line. */
const CAUSE = /^(error: |rigc[\w -]*: |usage: )/;

/**
 * What a rigc run that exited non-zero said about why, for a refusal whose own
 * filter (FAIL lines, the assertion summary) matched nothing: every line that
 * names a cause, or, when none does, the last three non-empty lines. Measured
 * against rig-c 2.0.3: its `cli.ts` run by path without
 * `@esotericsoftware/spine-core` beside it dies at import with one
 * `error: Cannot find module '@esotericsoftware/spine-core' from …` line, and its
 * core entry refuses `validate` with one `rigc validate: …` line, neither of
 * which a gate filter reads. The last lines and not the first are the fallback
 * because `rigc build` prints its header and inputs before it can stop. Empty
 * only when the run printed nothing at all.
 */
export function causeLines(out: string): string[] {
  const lines = out.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const named = lines.filter((l) => CAUSE.test(l));
  return named.length > 0 ? named : lines.slice(-3);
}

/** The two entries rig-c's launcher (`bin/rigc.cjs`, rig-c 2.0.0 and later) runs. */
export const RIGC_ENTRIES = ['cli.ts', 'cli_core.ts'] as const;
export type RigcEntry = (typeof RIGC_ENTRIES)[number];

/** The first rig-c whose `--version` names the entry that ran (its launcher's stderr line; rig-c 2.0.0's changelog, issue #1061 there). */
export const RIGC_ENTRY_VERSION = '2.0.0';

/**
 * Which rigc entry gated the build, as `check.json` records it: `cli.ts`, the
 * spine-core round trip, with the runtime's version; `cli_core.ts`, rigc's own
 * validator over its model document, with no runtime (`spine_core` null).
 */
export interface RigcEntryRecord {
  entry: RigcEntry;
  spine_core: string | null;
}

/** The launcher's two `entry:` lines, whole, as rig-c 2.0.3's `bin/rigc.cjs` writes them. */
const ENTRY_FULL = /^entry: cli\.ts — @esotericsoftware\/spine-core (\S+) present$/;
const ENTRY_CORE = /^entry: cli_core\.ts — @esotericsoftware\/spine-core absent — /;

/**
 * The entry a `rigc --version` run names. A run with no `entry:` line is a
 * rigc older than {@link RIGC_ENTRY_VERSION}, or not rigc's launcher, and is
 * refused `CHECK_RIGC_ENTRY`; an `entry:` line in neither form above is refused
 * `CHECK_RIGC_ENTRY_READS`, naming the line — a third entry is not read as
 * either of the two.
 */
export function readRigcEntry(versionOut: string): RigcEntryRecord {
  const lines = versionOut.split('\n').map((l) => l.trim());
  const line = lines.find((l) => l.startsWith('entry:'));
  if (line === undefined) {
    refuseIfAny([
      {
        code: 'CHECK_RIGC_ENTRY',
        object: '`rigc --version`',
        detail: `printed ${JSON.stringify(versionOut.trim())} and no \`entry:\` line; rig-c ${RIGC_ENTRY_VERSION} or later is required — its launcher names the entry that ran, and check.json records which one gated the build (\`bun install\` puts this package's own rig-c at node_modules/.bin/rigc)`,
      },
    ]);
  }
  const at = line as string;
  const full = ENTRY_FULL.exec(at);
  if (full !== null) return { entry: 'cli.ts', spine_core: full[1] };
  if (ENTRY_CORE.test(at)) return { entry: 'cli_core.ts', spine_core: null };
  refuseIfAny([
    {
      code: 'CHECK_RIGC_ENTRY_READS',
      object: `rigc's entry line ${JSON.stringify(at)}`,
      detail: 'reads as neither "entry: cli.ts — @esotericsoftware/spine-core <version> present" nor "entry: cli_core.ts — @esotericsoftware/spine-core absent — …"; one of the two is required',
    },
  ]);
  throw new Error('unreachable');
}

/**
 * This package's own rigc: `node_modules/.bin/rigc` under `root` and nowhere else — no directory above it and no
 * PATH, which {@link findRigc} walks (issue #337). The selftest's suites run rigc through it from the package root,
 * so a fixture in a temp directory, or a tree nested inside another checkout (a harness worktree under
 * `.claude/worktrees/`) whose own install is missing, cannot reach another tree's rigc. A miss is refused naming
 * the one path looked at.
 */
export function packageRigc(root: string): string {
  const bin = join(resolve(root), 'node_modules', '.bin', 'rigc');
  if (!existsSync(bin)) {
    refuseIfAny([
      {
        code: 'CHECK_RIGC_PACKAGE',
        object: bin,
        detail: `does not exist; this package's own rigc is required here and no other is looked for — not in a directory above ${resolve(root)}, not on PATH (\`bun install\` puts it there)`,
      },
    ]);
  }
  return bin;
}

/**
 * Where the `rigc` binary is: `node_modules/.bin/rigc` in `from` or any
 * directory above it (a clone has it beside the package; an install has it in
 * the consumer's `node_modules/.bin`), then every directory on `PATH`. A miss
 * is refused naming every place looked.
 */
export function findRigc(from: string, pathVar: string): string {
  const looked: string[] = [];
  let dir = resolve(from);
  for (;;) {
    const bin = join(dir, 'node_modules', '.bin', 'rigc');
    looked.push(bin);
    if (existsSync(bin)) return bin;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  for (const p of pathVar.split(delimiter).filter((s) => s !== '')) {
    const bin = join(p, 'rigc');
    if (existsSync(bin)) return bin;
  }
  refuseIfAny([
    {
      code: 'CHECK_RIGC_PRESENT',
      object: 'the rig-c CLI `rigc`',
      detail: `found at none of ${looked.length} node_modules/.bin/rigc path(s) from ${resolve(from)} up (nearest ${looked[0]}) nor on PATH; rig-c is this package's dependency — \`bun install\` puts it at node_modules/.bin/rigc`,
    },
  ]);
  return '';
}

// ---------------------------------------------------------------------------
// inputs
// ---------------------------------------------------------------------------

export interface StageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What `--parts` is, said once for the refusals and the help. */
export const PARTS_HOME_SENTENCE = '--parts names the directory holding parts.json and parts/, not parts/ itself (after build, that is build\'s --out, whose rig is <out>/rig); without --parts it is --rig';

/**
 * What `check` does without `--parts` when the rig directory holds no
 * `parts.json` (issue #77), said once for the help and the SKIP lines.
 */
export const NO_PARTS_SENTENCE = 'without --parts, a rig directory holding no parts.json is measured without one: the seam and every line that reads parts.json say SKIP, by name — unless the directory above --rig holds parts.json (build\'s layout), which is refused naming it';

/**
 * What the painting `--source` names is compared with (issue #77), for the
 * refusals and the help: assemble's own resample of it onto the rig canvas.
 */
export const SOURCE_SENTENCE = '--source names the painting the rig was made from: the stage size itself, or any size assemble takes to the stage (width and height each the painting\'s times one rig_scale, truncated — parts.json\'s scale_rig_per_source when parts.json is read), resampled onto the stage as assemble resamples it (lanczos3, alpha dropped)';

/** The painting `--source` names, read and checked against the stage before anything is built. */
export interface SourceInput {
  path: string;
  painting: Raster;
}

export interface CheckInputs {
  rigDir: string;
  rigPath: string;
  motionPath: string;
  partsPath: string;
  partsDir: string;
  rig: Record<string, unknown>;
  motion: Record<string, unknown>;
  /** Null when the rig directory holds no `parts.json` and no `--parts` was named (issue #77); {@link noParts} says why. */
  parts: PartsFile | null;
  /** Why `parts` is null, as the SKIP lines say it; null when `parts.json` was read. */
  noParts: string | null;
  stage: StageBox;
  rootBone: string;
  /** Null when `motion.json` declares no `idle` animation (issue #77); {@link noIdle} says why. */
  idleDuration: number | null;
  /** Why `idleDuration` is null, as the SKIP lines say it; null when there is an idle. */
  noIdle: string | null;
  /** The painting `--source` named, or null without `--source`. */
  source: SourceInput | null;
}

/** The inputs every line that reads both the parts and the idle takes: both present. */
export type FullInputs = CheckInputs & { parts: PartsFile; idleDuration: number };

/**
 * Whether a painting `w`x`h` can be the one assemble made a `W`x`H` rig canvas
 * from: assemble's `checkGeometry` makes the canvas `trunc(w * S)` x
 * `trunc(h * S)` for `rig_scale` S, so with S known (parts.json's
 * `scale_rig_per_source`) both must come out; with S unknown some S must
 * satisfy both, which is `W h < (H + 1) w` and `H w < (W + 1) h` in integers.
 * The same size is S = 1. Null when it can; otherwise the refusal's detail.
 */
export function sourceSizeProblem(w: number, h: number, stage: StageBox, scale: number | null): string | null {
  const { width: W, height: H } = stage;
  const whole = (v: number): boolean => Number.isInteger(v) && v > 0;
  if (!whole(W) || !whole(H)) return `the stage (rig.json's "skeleton") is ${W}x${H}; whole positive pixel counts are required to compare it with a painting pixel for pixel`;
  if (scale !== null) {
    if (Math.trunc(w * scale) === W && Math.trunc(h * scale) === H) return null;
    return `is ${w}x${h}, which parts.json's scale_rig_per_source ${scale} takes to ${Math.trunc(w * scale)}x${Math.trunc(h * scale)}; the stage is ${W}x${H}, so the painting assemble was given is required`;
  }
  if (W * h < (H + 1) * w && H * w < (W + 1) * h) return null;
  return `is ${w}x${h}; no single rig_scale takes it to the ${W}x${H} stage (assemble truncates width and height times the same scale), so the painting is not this rig's — ${SOURCE_SENTENCE}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readJson(path: string, problems: Problem[]): Record<string, unknown> | null {
  if (!existsSync(path)) {
    problems.push({ code: 'CHECK_INPUT_PRESENT', object: path, detail: 'no such file; the rig directory holds rig.json, motion.json, parts.json and parts/' });
    return null;
  }
  try {
    const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (isRecord(v)) return v;
    problems.push({ code: 'CHECK_INPUT_IS_JSON', object: path, detail: `holds ${JSON.stringify(v)?.slice(0, 40)}; an object is required` });
  } catch (err) {
    problems.push({ code: 'CHECK_INPUT_IS_JSON', object: path, detail: `does not parse as JSON: ${(err as Error).message}` });
  }
  return null;
}

/**
 * Read and cross-check the rig directory. Every problem is collected before
 * one refusal. `partsHome` is the directory holding `parts.json` and `parts/`
 * when they do not sit beside `rig.json` — `build` keeps the parts at the top
 * of its output and the rig under `rig/`; absent, it is the rig directory, and
 * there (issue #77) a `parts.json` may be missing: the rig is then measured
 * without parts ({@link NO_PARTS_SENTENCE}). A named `partsHome` with no
 * `parts.json` is refused, as is a missing one whose directory's parent holds
 * `parts.json` — build's layout, where the miss is `--parts` left off. An
 * `idle` may be missing too; an `idle` that is there must have a positive
 * duration. `sourcePath` is `--source`, read and held to the stage here, so a
 * painting that is not this rig's is refused before anything is built.
 */
export function readCheckInputs(rigDir: string, partsHome?: string, sourcePath?: string, set?: string, allSets = false): CheckInputs {
  const dir = resolve(rigDir);
  const named = partsHome !== undefined;
  const home = resolve(partsHome ?? rigDir);
  const problems: Problem[] = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    refuseIfAny([{ code: 'CHECK_INPUT_PRESENT', object: dir, detail: 'is not a directory; --rig names the directory holding rig.json and motion.json (and parts.json and parts/, or --parts names where they are)' }]);
  }
  const rigPath = join(dir, 'rig.json');
  const motionPath = join(dir, 'motion.json');
  const partsPath = join(home, 'parts.json');
  const partsDir = join(home, 'parts');
  if (home !== dir && (!existsSync(home) || !statSync(home).isDirectory())) {
    refuseIfAny([{ code: 'CHECK_INPUT_PRESENT', object: home, detail: `is not a directory; ${PARTS_HOME_SENTENCE}` }]);
  }
  const rig = readJson(rigPath, problems);
  const motion = readJson(motionPath, problems);
  let parts: PartsFile | null = null;
  let noParts: string | null = null;
  if (!existsSync(partsPath)) {
    // The usual miss is passing parts/ itself, or leaving --parts off after build; the parent is then named.
    const parent = dirname(home);
    const parentHolds = existsSync(join(parent, 'parts.json'));
    if (named || parentHolds) {
      const hint = parentHolds ? ` — ${parent} holds parts.json, so --parts ${parent} is the directory meant` : '';
      problems.push({
        code: 'CHECK_INPUT_PRESENT',
        object: partsPath,
        detail: `no such file; ${PARTS_HOME_SENTENCE} (the seam check composites the parts parts.json lists)${hint}`,
      });
    } else noParts = `no parts.json: ${partsPath} does not exist and no --parts was named, so there are no parts to composite and no See-through tags to choose regions by`;
  }
  else {
    try {
      parts = readParts(partsPath);
    } catch (err) {
      if (err instanceof PartsError) problems.push(...err.problems);
      else throw err;
    }
  }
  if (parts !== null) {
    for (const p of parts.parts) {
      const png = join(partsDir, `${p.name}.png`);
      if (!existsSync(png)) {
        problems.push({ code: 'CHECK_PART_PNG_PRESENT', object: `part "${p.name}"`, detail: `${png} does not exist; parts.json lists it` });
        continue;
      }
      const im = readPng(png);
      if (im.width !== p.w || im.height !== p.h) {
        problems.push({ code: 'CHECK_PART_PNG_MATCHES_BOX', object: `part "${p.name}"`, detail: `${png} is ${im.width}x${im.height}; parts.json's box is ${p.w}x${p.h}` });
      }
    }
    for (const alt of parts.alternates ?? []) {
      for (const r of alt.records) {
        const png = join(partsDir, `${alt.name}_${r.name}.png`);
        if (!existsSync(png)) {
          problems.push({ code: 'CHECK_PART_PNG_PRESENT', object: `set "${alt.name}" part "${r.name}"`, detail: `${png} does not exist; parts.json lists it` });
          continue;
        }
        const im = readPng(png);
        if (im.width !== r.w || im.height !== r.h) {
          problems.push({ code: 'CHECK_PART_PNG_MATCHES_BOX', object: `set "${alt.name}" part "${r.name}"`, detail: `${png} is ${im.width}x${im.height}; parts.json's box is ${r.w}x${r.h}` });
        }
      }
    }
  }
  if (set !== undefined || allSets) {
    if (parts === null) {
      problems.push({
        code: 'CHECK_INPUT_PRESENT',
        object: set !== undefined ? `--set ${set}` : '--all-sets',
        detail: `${partsPath} was not read; alternate sets are read from parts.json's "alternates"`,
      });
    } else {
      const alts = parts.alternates ?? [];
      if (set !== undefined && !alts.some((a) => a.name === set)) {
        problems.push({
          code: 'CHECK_INPUT_PRESENT',
          object: `--set ${set}`,
          detail: `${partsPath} has no alternate set "${set}" in "alternates" (${alts.length === 0 ? 'none declared' : alts.map((a) => `"${a.name}"`).join(', ')})`,
        });
      } else if (allSets && alts.length === 0) {
        problems.push({
          code: 'CHECK_INPUT_PRESENT',
          object: '--all-sets',
          detail: `${partsPath} declares no alternate sets in "alternates"`,
        });
      }
    }
  }
  let stage: StageBox | null = null;
  let rootBone: string | null = null;
  if (rig !== null) {
    const s = rig.skeleton;
    const nums = isRecord(s) && ['x', 'y', 'width', 'height'].every((k) => typeof s[k] === 'number' && Number.isFinite(s[k]));
    if (!nums) {
      problems.push({ code: 'CHECK_RIG_STAGE_PRESENT', object: `${rigPath} field "skeleton"`, detail: `is ${JSON.stringify(s)}; the stage box { x, y, width, height } is required — it is where parts.json's crop pixels sit in Spine's world` });
    } else {
      stage = { x: s.x as number, y: s.y as number, width: s.width as number, height: s.height as number };
      if (parts !== null && (stage.width !== parts.rig_size[0] || stage.height !== parts.rig_size[1])) {
        problems.push({
          code: 'CHECK_RIG_STAGE_IS_THE_CANVAS',
          object: `${rigPath} field "skeleton"`,
          detail: `is ${stage.width}x${stage.height}; parts.json's rig_size is ${parts.rig_size[0]}x${parts.rig_size[1]}, and the seam compares the two pixel for pixel`,
        });
      }
    }
    const slots = new Set((Array.isArray(rig.slots) ? rig.slots : []).filter(isRecord).map((s) => s.name));
    if (parts !== null) {
      for (const p of parts.parts) {
        if (!slots.has(p.name)) {
          problems.push({
            code: 'CHECK_PART_SLOT_PRESENT',
            object: `part "${p.name}"`,
            detail: `${rigPath} has no slot named "${p.name}"; the rig stage draws every part by the slot of its own name, and the judgement lines render a part alone by that slot`,
          });
        }
      }
    }
    const bones = rig.bones;
    const first: unknown = Array.isArray(bones) ? bones[0] : undefined;
    if (isRecord(first) && typeof first.name === 'string') rootBone = first.name;
    else problems.push({ code: 'CHECK_RIG_ROOT_BONE', object: `${rigPath} field "bones"`, detail: 'has no first bone with a name; the setup-pose render keys the root bone' });
  }
  let idleDuration: number | null = null;
  let noIdle: string | null = null;
  if (motion !== null) {
    const anims = motion.animations;
    const idle = isRecord(anims) ? anims.idle : undefined;
    if (idle === undefined) {
      noIdle = `no idle: ${motionPath} field "animations" holds ${isRecord(anims) ? `[${Object.keys(anims).join(', ')}]` : JSON.stringify(anims) ?? 'nothing'} and no "idle", so there is no loop to close and no idle frame to read`;
    } else if (!isRecord(idle)) {
      problems.push({ code: 'CHECK_IDLE_PRESENT', object: `${motionPath} animation "idle"`, detail: `is ${JSON.stringify(idle)}; an animation object is required — the loop is measured on it` });
    } else if (!(typeof idle.duration === 'number' && idle.duration > 0)) {
      problems.push({ code: 'CHECK_IDLE_PRESENT', object: `${motionPath} animation "idle" field "duration"`, detail: `is ${JSON.stringify(idle.duration)}; a positive number of seconds is required` });
    } else idleDuration = idle.duration;
  }
  let source: SourceInput | null = null;
  if (sourcePath !== undefined) {
    const path = resolve(sourcePath);
    if (!existsSync(path) || !statSync(path).isFile()) {
      problems.push({ code: 'CHECK_INPUT_PRESENT', object: path, detail: `no such file; ${SOURCE_SENTENCE}` });
    } else {
      try {
        source = { path, painting: readPng(path) };
      } catch (err) {
        problems.push({ code: 'CHECK_SOURCE_PNG', object: path, detail: `does not read as a PNG: ${(err as Error).message.split('\n')[0]}; ${SOURCE_SENTENCE}` });
      }
    }
    if (source !== null && stage !== null) {
      const why = sourceSizeProblem(source.painting.width, source.painting.height, stage, parts === null ? null : parts.scale_rig_per_source);
      if (why !== null) problems.push({ code: 'CHECK_SOURCE_SIZE', object: `--source ${path}`, detail: why });
    }
  }
  refuseIfAny(problems);
  return {
    rigDir: dir,
    rigPath,
    motionPath,
    partsPath,
    partsDir,
    rig: rig as Record<string, unknown>,
    motion: motion as Record<string, unknown>,
    parts,
    noParts,
    stage: stage as StageBox,
    rootBone: rootBone as string,
    idleDuration,
    noIdle,
    source,
  };
}

// ---------------------------------------------------------------------------
// gate lines
// ---------------------------------------------------------------------------

/**
 * The `here:` line rig-c's core entry (`cli_core.ts`, 2.0.0 and later)
 * prints after its assertion summary, saying which rules ran and that the
 * spine-core round trip did not; `cli.ts` prints none.
 */
const HERE_LINE = /^\.\.\s+here: /;

/**
 * `check_rig.py`'s filter for the build: summary, stats and pack lines, and
 * anything that failed — and, under rigc's core entry, its `here:` line, so the
 * gate file says which validator ran.
 */
export function buildGateLines(out: string): string[] {
  return out
    .split('\n')
    .filter((l) => (l.trim().startsWith('..') && (l.includes(' assertions: ') || l.includes('pages=') || l.includes('pack:') || HERE_LINE.test(l.trim()))) || l.includes('FAIL') || l.includes('compile error'));
}

/**
 * The rules a rigc run measured — every `PASS` and `FAIL` line's rule name, in
 * the order printed, each once. A SKIP, a PROF line and a summary are not
 * measurements. The selftest's `CH09` compares a build's set with
 * `rigc validate --profile spine`'s on the same build.
 */
export function measuredRules(out: string): string[] {
  const seen: string[] = [];
  for (const m of out.matchAll(/^ {2}(?:PASS|FAIL) {2}([A-Z][A-Z0-9_]*)/gm)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

const SUMMARY = /\((\d+) passed, (\d+) failed\)/;

/**
 * Green = rigc exited 0, at least one summary line, and every summary line says
 * `0 failed`. Read with a pattern: the reference's substring test `"0 failed"`
 * is also true of `"10 failed"`, and its `all()` over no summary line is true.
 */
export function gateGreen(status: number, lines: readonly string[]): boolean {
  const summaries = lines.filter((l) => l.includes(' assertions: '));
  return status === 0 && summaries.length > 0 && summaries.every((l) => SUMMARY.exec(l)?.[2] === '0');
}

export interface PackLine {
  line: string;
  page: string;
  width: number;
  height: number;
  regions: number;
  coveredPct: number;
  padding: number;
  /** `free` when the line carries `, page edges free` after the padding, `pot` when it does not — rig-c prints the clause exactly when it packed under `--page-edges free` (its `src/cli/shared.ts`, the pack line). */
  pageEdges: PageEdges;
  /**
   * The line's last clause, `, shape rect` or `, shape polygon`: rig-c
   * 2.1 names the `--pack-shape` it packed under on every pack line, its
   * default included. A line with no shape clause is the 1.5.1–2.0.3 form,
   * from a rigc that had no other shape, and reads as `rect`.
   */
  packShape: PackShape;
}

/** rigc's pack line, whole: the line is this and nothing else, or it is refused. */
const PACK = /^pack: (\S+) (\d+)x(\d+), (\d+) region\(s\), (\d+(?:\.\d+)?)% covered, padding (\d+)(, page edges free)?(?:, shape (rect|polygon))?$/;

/** A pack line that names its shape: the rig-c 2.1 form. */
const PACK_SHAPE_CLAUSE = /, shape (?:rect|polygon)$/;

/**
 * Every pack line among the gate lines — a line that reads `pack:` once its
 * `..` gutter is taken off. Two forms are read, each by name: rig-c
 * 2.1's, which ends `, shape rect` or `, shape polygon`, and the 1.5.1–2.0.3
 * form, which has no shape clause and reads as `rect`; in both,
 * `, page edges free` sits between the padding and the shape or is absent. Any
 * other line (an unknown shape, an unknown suffix, a missing field, the clauses
 * out of order) is refused, `CHECK_PACK_LINE_READS`, naming the line and the
 * form required: a line half-read would lose the field that changed.
 */
export function parsePackLines(lines: readonly string[]): PackLine[] {
  const out: PackLine[] = [];
  const problems: Problem[] = [];
  for (const l of lines) {
    const text = l.trim().replace(/^\.\.\s+/, '');
    if (!text.startsWith('pack:')) continue;
    const m = PACK.exec(text);
    if (m === null) {
      problems.push({
        code: 'CHECK_PACK_LINE_READS',
        object: `rigc's pack line ${JSON.stringify(text)}`,
        detail: 'does not read as "pack: <page> <W>x<H>, <N> region(s), <P>% covered, padding <D>", then ", page edges free" or nothing, then ", shape rect", ", shape polygon" or nothing; that form is required',
      });
      continue;
    }
    out.push({
      line: text,
      page: m[1],
      width: Number(m[2]),
      height: Number(m[3]),
      regions: Number(m[4]),
      coveredPct: Number(m[5]),
      padding: Number(m[6]),
      pageEdges: m[7] === undefined ? 'pot' : 'free',
      packShape: m[8] === 'polygon' ? 'polygon' : 'rect',
    });
  }
  refuseIfAny(problems);
  return out;
}

function powerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/**
 * Where a pack line disagrees with the pack mode the build was given. The
 * line's own page-edges clause must say the `--page-edges` passed, and a `pot`
 * page must be a power of two on both edges, as rigc's help defines it,
 * `CHECK_PACK_PAGE_EDGES`. By the same rule the line's shape must be the
 * `--pack-shape` passed, `CHECK_PACK_SHAPE` — a line with no shape clause
 * reads as `rect`, so under `polygon` it disagrees. That is the case that
 * matters: rigc 2.0.3 takes `--pack-shape` without a word, packs by
 * rectangles and prints the form with no shape clause (measured), so a rigc
 * older than 2.1.0 first on `PATH` is refused here rather than shipping a
 * rect page as a polygon one. One problem per disagreement; empty is
 * agreement.
 */
export function packEdgeProblems(pack: readonly PackLine[], mode: PackMode): Problem[] {
  const edges = mode.pageEdges;
  const problems: Problem[] = [];
  for (const p of pack) {
    const object = `packed page ${p.page}`;
    if (p.pageEdges !== edges) {
      problems.push({
        code: 'CHECK_PACK_PAGE_EDGES',
        object,
        detail: `rigc's pack line says page edges ${p.pageEdges} (${p.pageEdges === 'free' ? 'it carries ", page edges free"' : 'no ", page edges free" clause'}); the build was run with --page-edges ${edges}, so page edges ${edges} is required`,
      });
    } else if (edges === 'pot' && !(powerOfTwo(p.width) && powerOfTwo(p.height))) {
      problems.push({ code: 'CHECK_PACK_PAGE_EDGES', object, detail: `is ${p.width}x${p.height}; the build was run with --page-edges pot, so a power of two on both edges is required` });
    }
    if (p.packShape !== mode.packShape) {
      problems.push({
        code: 'CHECK_PACK_SHAPE',
        object,
        detail: `rigc's pack line says shape ${p.packShape} (${PACK_SHAPE_CLAUSE.test(p.line) ? `it ends ", shape ${p.packShape}"` : 'no ", shape" clause: the 1.5.1-2.0.3 form, read as rect'}); the build was run with --pack-shape ${mode.packShape}, so shape ${mode.packShape} is required`,
      });
    }
  }
  return problems;
}

/** Share of a page's pixels with alpha above 0 — the measure issue #2's spineboy figure is in. rigc's "covered" is region rectangles, not pixels. */
export function opaqueShare(r: Raster): number {
  let n = 0;
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i] > 0) n++;
  return n / (r.width * r.height);
}

// ---------------------------------------------------------------------------
// rigc's frames
// ---------------------------------------------------------------------------

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  pixelWidth: number;
  pixelHeight: number;
}

export interface FrameSet {
  /** The directory holding the frames. */
  dir: string;
  animation: string | null;
  fps: number;
  sampled: number;
  written: number;
  stride: number;
  /** The last sampled frame's time, as rigc records it. */
  duration: number;
  background: [number, number, number, number];
  viewport: Viewport;
  /** `f<index>.png`, in index order. */
  frames: Array<{ name: string; index: number; image: Raster }>;
}

function sidecarProblem(object: string, detail: string): never {
  refuseIfAny([{ code: 'FRAMES_SIDECAR', object, detail }]);
  throw new Error('unreachable');
}

/**
 * A frame set as `rigc render` wrote it: either the `--out` directory
 * (`frames.json` plus one set directory) or a set directory whose parent holds
 * `frames.json`. Every figure is read off the sidecar; none is assumed.
 */
export function readFrameSet(path: string): FrameSet {
  const dir = resolve(path);
  let sidecarPath: string;
  let setName: string | null;
  if (existsSync(join(dir, 'frames.json'))) {
    sidecarPath = join(dir, 'frames.json');
    setName = null;
  } else if (existsSync(join(dirname(dir), 'frames.json'))) {
    sidecarPath = join(dirname(dir), 'frames.json');
    setName = basename(dir);
  } else {
    return sidecarProblem(dir, `neither ${join(dir, 'frames.json')} nor ${join(dirname(dir), 'frames.json')} exists; the fps and the frame count are read from the frames.json \`rigc render\` writes`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  } catch (err) {
    return sidecarProblem(sidecarPath, `does not parse as JSON: ${(err as Error).message}`);
  }
  if (!isRecord(raw) || !Array.isArray(raw.sets) || !isRecord(raw.viewport) || !Array.isArray(raw.background)) {
    return sidecarProblem(sidecarPath, 'lacks "sets", "viewport" or "background"; a rigc-frames/1 sidecar carries all three');
  }
  const sets = raw.sets.filter(isRecord);
  let set: Record<string, unknown> | undefined;
  if (setName === null) {
    if (sets.length !== 1) return sidecarProblem(sidecarPath, `holds ${sets.length} set(s) [${sets.map((s) => String(s.dir)).join(', ')}]; name one set directory when there is not exactly one`);
    set = sets[0];
  } else {
    set = sets.find((s) => s.dir === setName);
    if (set === undefined) return sidecarProblem(sidecarPath, `has no set "${setName}"; it has [${sets.map((s) => String(s.dir)).join(', ')}]`);
  }
  const num = (o: Record<string, unknown>, k: string, at: string): number => {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return sidecarProblem(sidecarPath, `${at} field "${k}" is ${JSON.stringify(v)}; a number is required`);
    return v;
  };
  const vpRaw = raw.viewport;
  const viewport: Viewport = {
    x: num(vpRaw, 'x', 'viewport'),
    y: num(vpRaw, 'y', 'viewport'),
    width: num(vpRaw, 'width', 'viewport'),
    height: num(vpRaw, 'height', 'viewport'),
    scale: num(vpRaw, 'scale', 'viewport'),
    pixelWidth: num(vpRaw, 'pixelWidth', 'viewport'),
    pixelHeight: num(vpRaw, 'pixelHeight', 'viewport'),
  };
  const bg = raw.background;
  if (bg.length !== 4 || !bg.every((v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 255)) {
    return sidecarProblem(sidecarPath, `"background" is ${JSON.stringify(bg)}; four 8-bit channels are required`);
  }
  const setDir = join(dirname(sidecarPath), String(set.dir));
  if (!existsSync(setDir)) return sidecarProblem(setDir, 'does not exist; frames.json names it');
  const frames = readdirSync(setDir)
    .map((name) => ({ name, m: /^f(\d+)\.png$/.exec(name) }))
    .filter((e) => e.m !== null)
    .map((e) => ({ name: e.name, index: Number((e.m as RegExpExecArray)[1]) }))
    .sort((a, b) => a.index - b.index)
    .map((e) => ({ ...e, image: readPng(join(setDir, e.name)) }));
  const written = num(set, 'written', `set "${String(set.dir)}"`);
  if (frames.length !== written) return sidecarProblem(setDir, `holds ${frames.length} f*.png frame(s); frames.json says ${written} were written`);
  return {
    dir: setDir,
    animation: typeof set.animation === 'string' ? set.animation : null,
    fps: num(set, 'fps', `set "${String(set.dir)}"`),
    sampled: num(set, 'sampled', `set "${String(set.dir)}"`),
    written,
    stride: num(set, 'stride', `set "${String(set.dir)}"`),
    duration: num(set, 'duration', `set "${String(set.dir)}"`),
    background: bg as [number, number, number, number],
    viewport,
    frames,
  };
}

// ---------------------------------------------------------------------------
// the keyed loop: physics left out (issue #183)
// ---------------------------------------------------------------------------

/** A physics constraint the loop's frames leave out, as the `loop:` physics line names it. */
export interface LoopPhysics {
  name: string;
  bone: string;
  /** Where it was declared: rig.json's `constraints`, or motion.json's `physics` table. */
  in: 'rig.json' | 'motion.json';
}

/**
 * A throwaway copy of `rig` whose accompanying `motion` replaces `animations`
 * with a synthetic set (`still`, `blink_shut`, `stress ...`, `sweep ...`) omits
 * any `slider` constraint whose target animation is not in that set.
 */
function withoutSliders(rig: Record<string, unknown>, animations: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(rig.constraints)) return rig;
  const kept = rig.constraints.filter((c) => !(isRecord(c) && c.type === 'slider' && typeof c.animation === 'string' && !(c.animation in animations)));
  if (kept.length === rig.constraints.length) return rig;
  const out: Record<string, unknown> = { ...rig };
  if (kept.length > 0) out.constraints = kept;
  else delete out.constraints;
  return out;
}

/**
 * The rig spec and motion spec with every physics constraint left out, and
 * the constraints it left out; null when there is none, so a rig without one
 * is measured from the very build and render it always was.
 *
 * rig-c's render resets physics at frame 0 and steps it by 1/fps (its
 * `spinePoser`), so a constraint still moving at the idle's duration makes
 * the last frame differ from the first by what the simulation is doing, not by
 * what the keys say. `CHECK_LOOP_CLOSES` measures the keys: a rig-c
 * `constraints` entry of `type` `"physics"` and every entry of motion.json's
 * `physics` table are dropped, with what names them only to activate or key
 * them — a skin's `physics` list, and an animation track whose target is a
 * `physics` constraint. Nothing else is touched, and nothing here judges the
 * constraints: the line that names them reports.
 */
export function withoutPhysics(rig: Record<string, unknown>, motion: Record<string, unknown>): { rig: Record<string, unknown>; motion: Record<string, unknown>; physics: LoopPhysics[] } | null {
  const physics: LoopPhysics[] = [];
  const constraints = Array.isArray(rig.constraints) ? rig.constraints : null;
  if (constraints !== null) {
    for (const c of constraints) if (isRecord(c) && c.type === 'physics') physics.push({ name: String(c.name), bone: String(c.bone), in: 'rig.json' });
  }
  const table = isRecord(motion.physics) ? motion.physics : null;
  if (table !== null) for (const [name, e] of Object.entries(table)) physics.push({ name, bone: isRecord(e) ? String(e.bone) : '', in: 'motion.json' });
  if (physics.length === 0) return null;
  const expanded = Array.isArray(rig.stops) ? (expandStops(rig as unknown as RigcRigSpec, 'rig.json') as unknown as Record<string, unknown>) : rig;
  const r: Record<string, unknown> = { ...expanded };
  delete r.stops;
  if (Array.isArray(r.constraints)) {
    const kept = r.constraints.filter((c) => !(isRecord(c) && c.type === 'physics'));
    if (kept.length > 0) r.constraints = kept;
    else delete r.constraints;
  }
  if (isRecord(rig.skins)) {
    r.skins = Object.fromEntries(Object.entries(rig.skins).map(([skin, entry]) => {
      if (!isRecord(entry) || !('physics' in entry)) return [skin, entry];
      return [skin, Object.fromEntries(Object.entries(entry).filter(([k]) => k !== 'physics'))];
    }));
  }
  const m: Record<string, unknown> = { ...motion };
  delete m.physics;
  if (isRecord(motion.animations)) {
    m.animations = Object.fromEntries(Object.entries(motion.animations).map(([name, a]) => {
      if (!isRecord(a) || !Array.isArray(a.tracks)) return [name, a];
      return [name, { ...a, tracks: a.tracks.filter((t) => !(isRecord(t) && 'physics' in t)) }];
    }));
  }
  return { rig: r, motion: m, physics };
}

/** The one line naming what {@link withoutPhysics} left out of the loop's frames: reported, not judged. */
export function loopPhysicsLine(physics: readonly LoopPhysics[]): string {
  return `loop physics: ${physics.length} physics constraint(s) left out of the loop's frames, reported, not judged — ${physics.map((p) => `"${p.name}" on bone "${p.bone}" (${p.in})`).join(', ')}`;
}

// ---------------------------------------------------------------------------
// pixel measurements
// ---------------------------------------------------------------------------

/** Largest per-channel |a - b| over RGB (alpha dropped, as PIL's `convert("RGB")` does), and the first pixel where it is. */
export function maxRgbDiff(a: Raster, b: Raster): { max: number; x: number; y: number } {
  let max = 0;
  let at = 0;
  for (let p = 0; p < a.width * a.height; p++) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[p * 4 + c] - b.data[p * 4 + c]);
      if (d > max) {
        max = d;
        at = p;
      }
    }
  }
  return { max, x: at % a.width, y: Math.floor(at / a.width) };
}

/**
 * The motion heat map: frame 0 as grey, blended 0.6 toward a red channel
 * holding each pixel's largest per-channel change from frame 0 across all
 * frames. The grey is PIL's `convert("L")` (`(19595 R + 38470 G + 7471 B +
 * 0x8000) >> 16`) and the blend is PIL's `Image.blend` (`in1 + alpha * (in2 -
 * in1)` with alpha as float32, fused, truncated) — the reference's two calls,
 * measured byte-exact against the reference's own heat maps (ORACLE_check.md).
 */
export function motionHeat(frames: readonly Raster[]): Raster {
  const f0 = frames[0];
  const n = f0.width * f0.height;
  const d = heatField(frames);
  const alpha = Math.fround(0.6);
  // One rounding, to float32, of the exact `in1 + alpha * (in2 - in1)`: the
  // build of Pillow 12.2.0 measured here contracts the expression to a fused
  // multiply-add. Rounding the product first (two roundings) disagreed with it
  // on 33 of 256 values of in1 at in2 = 0; this form agrees on all 65,536
  // (in1, in2) pairs. The product and sum are exact in float64, so one fround
  // IS the fused result.
  const blend = (a: number, b: number): number => Math.trunc(Math.fround(a + alpha * (b - a)));
  const out = newRaster(f0.width, f0.height);
  for (let p = 0; p < n; p++) {
    const l = (f0.data[p * 4] * 19595 + f0.data[p * 4 + 1] * 38470 + f0.data[p * 4 + 2] * 7471 + 0x8000) >>> 16;
    out.data[p * 4] = blend(l, d[p]);
    out.data[p * 4 + 1] = blend(l, 0);
    out.data[p * 4 + 2] = blend(l, 0);
    out.data[p * 4 + 3] = 255;
  }
  return out;
}

export interface SeamFigures {
  mean: number;
  over40: number;
  over80: number;
  /**
   * Under a scene (issue #242), the frame pixels on the painting's border that the
   * figures above leave out ({@link seamFigures}): how many there are, and how many
   * of them were over {@link SEAM_PX_LEVEL}. Null when the painting is not a scene.
   */
  border: { framePx: number; over40: number } | null;
  /** The frame pixels {@link over40} counts, by index into the frame, ascending; each one's max-channel |d| is in {@link countedDiff}. */
  counted: number[];
  countedDiff: number[];
  /** The rig-to-frame map the composite was warped by ({@link rigToFrameMap}): frame = (sx u + tx, sy v + ty), pixel index to pixel index, as float32 values. */
  map: { sx: number; sy: number; tx: number; ty: number };
}

/**
 * The flat stack of parts over the background, in rig pixels: PIL's
 * `alpha_composite` of every part at its `x, y`, in parts.json order, over an
 * opaque canvas of the render's own background colour.
 */
export function flatComposite(parts: PartsFile, partsDir: string, background: readonly [number, number, number, number]): Raster {
  const [W, H] = parts.rig_size;
  let canvas = newRaster(W, H);
  for (let i = 0; i < W * H; i++) canvas.data.set(background, i * 4);
  for (const p of parts.parts) canvas = alphaComposite(canvas, readPng(join(partsDir, `${p.name}.png`)), p.x, p.y);
  return canvas;
}

/**
 * The flat stack of parts for an alternate set (issue #454), in `parts.parts`
 * slot order: hidden slots skipped, covered slots drawn from `alt.records` at
 * their box, uncovered base slots drawn at their base box.
 */
export function flatCompositeForSet(parts: PartsFile, alt: AlternatePartsRecord, partsDir: string, background: readonly [number, number, number, number]): Raster {
  const [W, H] = parts.rig_size;
  let canvas = newRaster(W, H);
  for (let i = 0; i < W * H; i++) canvas.data.set(background, i * 4);
  const hides = new Set(alt.hides ?? []);
  const byName = new Map(alt.records.map((r) => [r.name, r]));
  for (const p of parts.parts) {
    if (hides.has(p.name)) continue;
    const rec = byName.get(p.name);
    const pngName = rec === undefined ? p.name : `${alt.name}_${rec.name}`;
    const box = rec ?? p;
    canvas = alphaComposite(canvas, readPng(join(partsDir, `${pngName}.png`)), box.x, box.y);
  }
  return canvas;
}

/**
 * The setup-pose rig spec with an alternate set applied (issues #454, #465):
 * hidden slots (and `<slot>_still` for any hidden or covered slot) have no
 * setup attachment, covered slots have `alt.slots[slot]`, and when the set
 * carries `drawn` bone rotations its bones are posed at those world rotations
 * so the throwaway still renders the alternate in the pose it was painted in.
 */
export function stillRigForSet(
  rig: Record<string, unknown>,
  alt: AlternatePartsRecord,
  drawn: Readonly<Record<string, number>> | undefined = alt.drawn,
): Record<string, unknown> {
  const hides = new Set(alt.hides ?? []);
  const slots = (Array.isArray(rig.slots) ? rig.slots : []).map((s) => {
    if (!isRecord(s) || typeof s.name !== 'string') return s;
    const stillBase = s.name.endsWith('_still') ? s.name.slice(0, -'_still'.length) : null;
    if (hides.has(s.name) || (stillBase !== null && (hides.has(stillBase) || Object.hasOwn(alt.slots, stillBase)))) {
      return { ...s, attachment: null };
    }
    if (Object.hasOwn(alt.slots, s.name)) return { ...s, attachment: alt.slots[s.name] };
    return s;
  });
  if (drawn === undefined || Object.keys(drawn).length === 0) return { ...rig, slots };
  const rawBones = (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord).map((b) => ({
    name: String(b.name),
    ...(typeof b.parent === 'string' && b.parent !== '' ? { parent: b.parent } : {}),
    ...(typeof b.length === 'number' ? { length: b.length } : {}),
    ...(typeof b.rotation === 'number' ? { rotation: b.rotation } : {}),
    x: typeof b.x === 'number' ? b.x : 0,
    y: typeof b.y === 'number' ? b.y : 0,
    ...(typeof b.inherit === 'string' ? { inherit: b.inherit as RigBone['inherit'] } : {}),
  }));
  const stops = (Array.isArray(rig.stops) ? rig.stops : []).filter(isRecord).map((s) => ({
    links: Array.isArray(s.links) ? s.links.filter((l): l is string => typeof l === 'string') : [],
  }));
  const bones = poseRigBonesForDrawn(rawBones, drawn, stops);
  const out: Record<string, unknown> = { ...rig, bones, slots };
  if (isRecord(out.invariants)) {
    const { axes: _axes, ...rest } = out.invariants;
    if (Object.keys(rest).length > 0) out.invariants = rest;
    else delete out.invariants;
  }
  return out;
}

/**
 * The map from rig (crop) pixel indices to frame pixel indices that the seam
 * and the source line warp by: frame = (sx u + tx, sy v + ty).
 *
 * Crop pixel (u, v) covers world x from stage.x + u to stage.x + u + 1 (y
 * through `cropToSpineY`, the one door), and world (wx, wy) is the frame's
 * continuous position ((wx - vp.x) s, (vp.y + vp.height - wy) s). rig-c's
 * renderer samples at pixel centres (`x + 0.5`), and cv2's `warpAffine` (which
 * `src/raster/warp.ts` reproduces) maps index to index with no half-pixel
 * offset, so the centre of crop pixel u, at continuous u + 0.5, lands at frame
 * index s (u + 0.5) + t - 0.5 = s u + t + 0.5 (s - 1) (issue #209). Measured
 * through rig-c's own `render`: a one-pixel column and row on a rig rendered
 * at s = 1.0069, 1.3889, 1.5046 and 2.0023 sit within 0.042 frame px of this
 * map on both axes and 0.499 px off the map without the 0.5 (s - 1) term at
 * s = 2.0023 [measured for issue #209, a scratch rig, not tracked]. At s = 1
 * the term is 0 and the map is the reference's.
 *
 * The reference hands cv2 the matrix as float32 (`np.float32([[...]])`), and
 * that quantisation moves a sample row across a 1/32-pixel step: in float64 one
 * row of one rig's 1216-row frame (C1 in ORACLE_check.md) sampled differently
 * and the unrounded mean drifted 3.1e-4. The map is rounded to float32 the same
 * way. ⚠️ The reference has no centre term, so from issue #209 this map
 * mirrors the reference — and ORACLE_check.md's figures are matched — at
 * s = 1 only; above or below it the reference laid the composite 0.5 (s - 1)
 * frame px off the render on each axis.
 *
 * `centres` false drops the term: the reference's map, kept so the `check`
 * suite can plant it (issue #209). Every caller in `src/` leaves it true.
 */
export function rigToFrameMap(stage: StageBox, rigH: number, vp: Viewport, centres = true): ScaleTranslate {
  const s = vp.scale;
  const f = Math.fround;
  const c = centres ? 0.5 * (s - 1) : 0;
  return { sx: f(s), sy: f(s), tx: f((stage.x - vp.x) * s + c), ty: f((vp.y + vp.height - (stage.y + cropToSpineY(0, rigH))) * s + c) };
}

/**
 * {@link rigToFrameMap} turned round, from frame pixel indices to rig pixel
 * indices: u = (frame - t - 0.5 (s - 1)) / s, rounded to float32 as the
 * forward map is. The source line warps the frame onto the stage by it.
 */
export function frameToRigMap(stage: StageBox, rigH: number, vp: Viewport): ScaleTranslate {
  const s = vp.scale;
  const f = Math.fround;
  const c = 0.5 * (s - 1);
  return { sx: f(1 / s), sy: f(1 / s), tx: f(vp.x - stage.x - c / s), ty: f(stage.y + cropToSpineY(0, rigH) - (vp.y + vp.height) - c / s) };
}

/**
 * The seam figures: the setup-pose frame vs the flat composite carried onto the
 * frame's pixel grid.
 *
 * The map is {@link rigToFrameMap}: a scale by s and a translate, from rig
 * pixel indices to frame pixel indices, centre to centre. It is warped with
 * `src/raster/warp.ts` (cv2's bilinear `warpAffine`, which is also what the
 * reference's `INTER_AREA` flag gets from cv2 — see that file) in float32.
 * cv2's `borderValue` is the background; this warp's border is 0, so the
 * composite is warped as `(pixel - background)` and the background added back,
 * which is the same linear sum. The per-pixel figure is the largest channel
 * |d|, as in the reference.
 *
 * `map` is for the controls alone (the `check` suite plants the map without
 * the centre term, issue #209); every caller in `src/` leaves it to the default.
 *
 * `scene` (issue #242; `parts.json`'s `scene` block): the painting is a scene,
 * and a figure cut by its frame has an edge there that no part meets. A frame
 * pixel whose bilinear sample of the composite reads the painting's outermost
 * row or column, or past it — its two-by-two footprint, `floor(u)` and
 * `floor(u) + 1` with `u = (x - tx) / sx`, reaching column 0 or `W - 1` or
 * beyond, and the same for rows — is on the painting's border, and is not
 * counted: not in the mean, not over either level. How many such pixels there
 * were, and how many of them were over {@link SEAM_PX_LEVEL}, is returned
 * (`border`) for the line to say.
 */
export function seamFigures(
  composite: Raster,
  frame: Raster,
  stage: StageBox,
  vp: Viewport,
  background: readonly [number, number, number, number],
  map: ScaleTranslate = rigToFrameMap(stage, composite.height, vp),
  scene = false,
): SeamFigures {
  const [W, H] = [composite.width, composite.height];
  const src = newFloatImage(W, H, 3);
  for (let p = 0; p < W * H; p++) for (let c = 0; c < 3; c++) src.data[p * 3 + c] = composite.data[p * 4 + c] - background[c];
  const warped = warpAffine(src, map, vp.pixelWidth, vp.pixelHeight, 'bilinear');
  if (frame.width !== vp.pixelWidth || frame.height !== vp.pixelHeight) {
    refuseIfAny([{ code: 'CHECK_SEAM_FRAME_SIZE', object: 'the setup-pose frame', detail: `is ${frame.width}x${frame.height}; frames.json's viewport is ${vp.pixelWidth}x${vp.pixelHeight}` }]);
  }
  let sum = 0;
  let over40 = 0;
  let over80 = 0;
  let borderPx = 0;
  let borderOver40 = 0;
  const counted: number[] = [];
  const countedDiff: number[] = [];
  const n = vp.pixelWidth * vp.pixelHeight;
  // Issue #242: on a scene, the frame columns and rows whose composite sample reaches the painting's border.
  const onEdge = (i: number, t: number, s: number, size: number): boolean => {
    const k = Math.floor((i - t) / s);
    return k <= 0 || k + 1 >= size - 1;
  };
  const edgeCol = scene ? Array.from({ length: vp.pixelWidth }, (_, x) => onEdge(x, map.tx, map.sx, W)) : null;
  const edgeRow = scene ? Array.from({ length: vp.pixelHeight }, (_, y) => onEdge(y, map.ty, map.sy, H)) : null;
  for (let p = 0; p < n; p++) {
    let m = 0;
    for (let c = 0; c < 3; c++) {
      const w = Math.fround(warped.data[p * 3 + c] + background[c]);
      const d = Math.abs(w - frame.data[p * 4 + c]);
      if (d > m) m = d;
    }
    if (edgeCol !== null && edgeRow !== null && (edgeCol[p % vp.pixelWidth] || edgeRow[Math.floor(p / vp.pixelWidth)])) {
      borderPx++;
      if (m > SEAM_PX_LEVEL) borderOver40++;
      continue;
    }
    sum += m;
    if (m > SEAM_PX_LEVEL) {
      over40++;
      counted.push(p);
      countedDiff.push(m);
    }
    if (m > SEAM_PX_LEVEL_HIGH) over80++;
  }
  return { mean: scene ? (n - borderPx === 0 ? 0 : sum / (n - borderPx)) : sum / n, over40, over80, border: scene ? { framePx: borderPx, over40: borderOver40 } : null, counted, countedDiff, map };
}

/**
 * Where `check --keep-stills` leaves the setup-pose still under `--out`
 * (issue #209): rigc's own render directory as `render` wrote it —
 * `frames.json` (the viewport the seam and the source line map by, and the
 * background) and the set directory beside it — so a reader compares against
 * the frame the bars read rather than rebuilding it. Removed at the start of
 * every run, so it is on disk only after a run that asked for it.
 */
export const STILL_DIR = 'setup_still';

/** Where `check` writes the seam pictures, under `--out` (issue #202): one per row of {@link SeamPairRow}, named by its rank and its two parts. */
export const SEAM_DIR = 'seam';

/** What a seam row names in place of a part when the counted pixel's sample reads fewer than two parts' art. */
export const SEAM_NO_ART = '(no art)';

/**
 * One row of `check.json`'s `seam_pairs` (issue #202): the pixels the seam bar
 * counts (max-channel |d| over {@link SEAM_PX_LEVEL}) that one pair of parts
 * answers for, on the setup-pose still — the one frame the bar reads.
 *
 * A counted frame pixel is answered for by the parts whose art (alpha above
 * 0) lies under the composite's own sample of it: the frame pixel's centre
 * carried back to rig pixels by the inverse of {@link SeamFigures.map}, and
 * the 2x2 rig pixels the bilinear warp reads there (`floor(u)`, `floor(u) +
 * 1` by `floor(v)`, `floor(v) + 1`, those inside the rig). Of those parts the
 * two drawn last (parts.json's order is the draw order) are the pair, lower
 * first; where only one part's art lies there it is named first and the
 * second is {@link SEAM_NO_ART}, and where none does both are.
 * `frame_box` is the counted pixels' bounding box in frame pixels, inclusive,
 * `[x0, y0, x1, y1]`; `rig_box` the bounding box of the rig pixels those
 * samples read, in the rig pixels of `parts.json`, `cuts[].polygon` and the
 * patches.
 *
 * `cut` is written only when the two parts come from one layer (the same
 * parts.json `from`, as a cut's base and piece do, `assemble.cuts`): `from`
 * is that layer, and `differing_copies_px` how many of the row's counted
 * pixels have, among the rig pixels their sample reads, one that both parts
 * hold (alpha above 0 in each — a cut's band) in a different colour (any of
 * R, G, B unequal). It is what the seam bar sees of a cut's band (issue #202):
 * the band is not excluded, because the two copies are not one drawing — the
 * piece shows the painting where it is seen and the base keeps the layer's
 * colour under it — and the upper part's resampled edge shows the lower
 * part's copy. The pair's other counted pixels on a cut line are the same
 * resampling where the art changes colour across the line; this count does
 * not name them.
 */
export interface SeamPairRow {
  parts: [string, string];
  px_over_40: number;
  px_over_80: number;
  frame_box: [number, number, number, number];
  rig_box: [number, number, number, number];
  cut?: { from: string; differing_copies_px: number };
  picture: string;
}

/** A part's art in rig pixels: where it is, its image and the layer it comes from (parts.json's `from`). */
export interface PlacedAlpha {
  name: string;
  from: string;
  x: number;
  y: number;
  image: Raster;
}

/**
 * Split the seam's counted pixels by the pair of parts that answers for each
 * ({@link SeamPairRow}), worst first: by `px_over_40` descending, ties by the
 * pair's names in draw order. `parts` is parts.json's list in its order, each
 * with its image as assembled.
 */
export function seamPairRows(seam: SeamFigures, parts: readonly PlacedAlpha[], rigSize: readonly [number, number], vp: Viewport): Array<{ row: SeamPairRow; pixels: number[] }> {
  const [W, H] = rigSize;
  // Each rig pixel's two topmost parts with art there (-1 for none): the top two of a union of pixels are among each pixel's own top two.
  const top = new Int32Array(W * H).fill(-1);
  const next = new Int32Array(W * H).fill(-1);
  parts.forEach((part, k) => {
    const img = part.image;
    for (let j = 0; j < img.height; j++) {
      const v = part.y + j;
      if (v < 0 || v >= H) continue;
      for (let i = 0; i < img.width; i++) {
        const u = part.x + i;
        if (u < 0 || u >= W || img.data[(j * img.width + i) * 4 + 3] === 0) continue;
        const q = v * W + u;
        next[q] = top[q];
        top[q] = k;
      }
    }
  });
  const { sx, sy, tx, ty } = seam.map;
  // A part's pixel at rig (u, v) as an offset into its image, or -1 where it holds no art.
  const at = (k: number, u: number, v: number): number => {
    const part = parts[k];
    const i = u - part.x;
    const j = v - part.y;
    if (i < 0 || j < 0 || i >= part.image.width || j >= part.image.height) return -1;
    const o = (j * part.image.width + i) * 4;
    return part.image.data[o + 3] === 0 ? -1 : o;
  };
  const differ = (a: number, b: number, u: number, v: number): boolean => {
    const oa = at(a, u, v);
    const ob = at(b, u, v);
    if (oa < 0 || ob < 0) return false;
    const da = parts[a].image.data;
    const db = parts[b].image.data;
    return da[oa] !== db[ob] || da[oa + 1] !== db[ob + 1] || da[oa + 2] !== db[ob + 2];
  };
  interface Acc { a: number; b: number; over40: number; over80: number; f: [number, number, number, number]; r: [number, number, number, number]; pixels: number[]; differing: number }
  const byPair = new Map<string, Acc>();
  seam.counted.forEach((p, idx) => {
    const fx = p % vp.pixelWidth;
    const fy = Math.floor(p / vp.pixelWidth);
    const u0 = Math.floor((fx - tx) / sx);
    const v0 = Math.floor((fy - ty) / sy);
    let first = -1;
    let second = -1;
    const read: Array<[number, number]> = [];
    let rx0 = Infinity;
    let ry0 = Infinity;
    let rx1 = -Infinity;
    let ry1 = -Infinity;
    for (let dv = 0; dv < 2; dv++) {
      for (let du = 0; du < 2; du++) {
        const u = u0 + du;
        const v = v0 + dv;
        if (u < 0 || u >= W || v < 0 || v >= H) continue;
        read.push([u, v]);
        rx0 = Math.min(rx0, u);
        ry0 = Math.min(ry0, v);
        rx1 = Math.max(rx1, u);
        ry1 = Math.max(ry1, v);
        for (const k of [top[v * W + u], next[v * W + u]]) {
          if (k < 0 || k === first || k === second) continue;
          if (k > first) {
            second = first;
            first = k;
          } else if (k > second) second = k;
        }
      }
    }
    // A sample wholly outside the rig reads no rig pixel; its rig box is the nearest rig pixel.
    if (rx1 < rx0) {
      rx0 = rx1 = Math.min(Math.max(u0, 0), W - 1);
      ry0 = ry1 = Math.min(Math.max(v0, 0), H - 1);
    }
    const a = second;
    const b = first;
    const key = `${a},${b}`;
    let acc = byPair.get(key);
    if (acc === undefined) {
      acc = { a, b, over40: 0, over80: 0, f: [fx, fy, fx, fy], r: [rx0, ry0, rx1, ry1], pixels: [], differing: 0 };
      byPair.set(key, acc);
    }
    if (a >= 0 && parts[a].from === parts[b].from && read.some(([u, v]) => differ(a, b, u, v))) acc.differing++;
    acc.over40++;
    acc.pixels.push(p);
    if (seam.countedDiff[idx] > SEAM_PX_LEVEL_HIGH) acc.over80++;
    acc.f = [Math.min(acc.f[0], fx), Math.min(acc.f[1], fy), Math.max(acc.f[2], fx), Math.max(acc.f[3], fy)];
    acc.r = [Math.min(acc.r[0], rx0), Math.min(acc.r[1], ry0), Math.max(acc.r[2], rx1), Math.max(acc.r[3], ry1)];
  });
  const name = (k: number): string => (k < 0 ? SEAM_NO_ART : parts[k].name);
  const sorted = [...byPair.values()].sort((x, y) => y.over40 - x.over40 || x.b - y.b || x.a - y.a);
  const width = String(sorted.length).length;
  return sorted.map((acc, i) => {
    // A part over no other art is named first, then SEAM_NO_ART.
    const pair: [string, string] = acc.a < 0 ? [name(acc.b), SEAM_NO_ART] : [name(acc.a), name(acc.b)];
    const file = `${String(i + 1).padStart(Math.max(2, width), '0')}_${pair.map((n) => (n === SEAM_NO_ART ? 'no-art' : n)).join('_')}.png`;
    const cut = acc.a >= 0 && parts[acc.a].from === parts[acc.b].from ? { cut: { from: parts[acc.a].from, differing_copies_px: acc.differing } } : {};
    return { row: { parts: pair, px_over_40: acc.over40, px_over_80: acc.over80, frame_box: acc.f, rig_box: acc.r, ...cut, picture: `${SEAM_DIR}/${file}` }, pixels: acc.pixels };
  });
}

/** The marks a seam picture draws: the counted pixels of its pair, and the box round them. */
export const SEAM_MARK: readonly [number, number, number] = [255, 0, 255];
export const SEAM_BOX: readonly [number, number, number] = [0, 255, 255];

/**
 * A seam row's picture: the setup-pose frame with the pair's counted pixels
 * painted {@link SEAM_MARK} and the rectangle one pixel outside its
 * `frame_box` drawn {@link SEAM_BOX} where it falls inside the frame. Every
 * other pixel is the frame's own, opaque. `pixels` are the row's counted
 * pixels, by index into the frame.
 */
export function seamPicture(frame: Raster, row: SeamPairRow, pixels: readonly number[]): Raster {
  const out = newRaster(frame.width, frame.height);
  out.data.set(frame.data);
  for (let p = 0; p < frame.width * frame.height; p++) out.data[p * 4 + 3] = 255;
  const paint = (x: number, y: number, rgb: readonly [number, number, number]): void => {
    if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return;
    out.data.set(rgb, (y * frame.width + x) * 4);
  };
  const [x0, y0, x1, y1] = row.frame_box;
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    paint(x, y0 - 1, SEAM_BOX);
    paint(x, y1 + 1, SEAM_BOX);
  }
  for (let y = y0 - 1; y <= y1 + 1; y++) {
    paint(x0 - 1, y, SEAM_BOX);
    paint(x1 + 1, y, SEAM_BOX);
  }
  for (const p of pixels) paint(p % frame.width, Math.floor(p / frame.width), SEAM_MARK);
  return out;
}

/** Python's `round(x, 3)` for the figures written: to three places, on the value's exact decimal expansion. */
function round3(x: number): number {
  return Number(x.toFixed(3));
}

/** Python's `round(x, 6)` for the frame scale written: to six places, on the value's exact decimal expansion. */
function round6(x: number): number {
  return Number(x.toFixed(6));
}

/** The seam's count in rig pixels (issue #216): the frame pixels over {@link SEAM_PX_LEVEL} divided by the square of the frame scale. */
export function seamRigPx(over40: number, scale: number): number {
  return over40 / (scale * scale);
}

/** {@link seamRigPx} as the console and the refusal print it, to two places. */
export function seamRigPxText(over40: number, scale: number): string {
  return seamRigPx(over40, scale).toFixed(2);
}

/**
 * The seam bar, on the figures as check.json writes them: the mean (rounded
 * to three places) over {@link SEAM_MEAN_BAR}, or more than
 * {@link SEAM_PX_BAR} rig pixels over {@link SEAM_PX_LEVEL} — the frame count
 * over the square of the written frame scale (issue #216).
 */
function seamFails(mean: number, over40: number, scale: number): boolean {
  return mean > SEAM_MEAN_BAR || seamRigPx(over40, scale) > SEAM_PX_BAR;
}

/** A seam row as the console prints it: the pair, the frame, the counts, both boxes and the picture. */
export function seamPairText(row: SeamPairRow): string {
  const q = (n: string): string => (n === SEAM_NO_ART ? n : `"${n}"`);
  const box = (b: readonly number[]): string => `x ${b[0]}..${b[2]}, y ${b[1]}..${b[3]}`;
  const cut =
    row.cut === undefined
      ? ''
      : `; one layer cut in two (both from ${row.cut.from}): ${row.cut.differing_copies_px} of these px read a pixel both parts hold in different colours. Along a cut line the render draws the upper part's resampled edge over the lower part's own resampled copy, so it parts from the flat stack where the two copies differ and where the art changes colour across the line; a wider cuts[].overlap moves neither, a polygon edge through art of one colour on both sides, in both copies, does`;
  return `${q(row.parts[0])} / ${q(row.parts[1])} at the setup pose: ${row.px_over_40} px over ${SEAM_PX_LEVEL} (${row.px_over_80} over ${SEAM_PX_LEVEL_HIGH}), frame box ${box(row.frame_box)}, rig box ${box(row.rig_box)}, picture ${row.picture}${cut}`;
}

// ---------------------------------------------------------------------------
// the setup pose against the painting (issue #77)
// ---------------------------------------------------------------------------

/** The line `--source` adds: the setup pose against the painting, with assemble's recomposite figures. */
export const SOURCE_LINE = 'SETUP_POSE_VS_SOURCE';

/** The name the setup pose's coverage goes by where assemble's measure names a part. */
export const SETUP_POSE_COVER = '(setup pose)';

/** The throwaway rig whose every slot is tinted black, rendered beside the setup-pose still: the coverage the opaque render does not carry. */
const BLACK_RIG = 'rig_black.json';

/**
 * The rig with every slot tinted black (`color` `000000` with the slot's own
 * alpha kept, and `dark` `000000` where the slot has one), so the setup pose
 * drawn from it is the render's background times what the art lets through.
 */
export function blackRig(rig: Record<string, unknown>): Record<string, unknown> {
  const slots = (Array.isArray(rig.slots) ? rig.slots : []).map((s) => {
    if (!isRecord(s)) return s;
    const alpha = typeof s.color === 'string' && s.color.length === 8 ? s.color.slice(6) : 'ff';
    return { ...s, color: `000000${alpha}`, ...(s.dark === undefined ? {} : { dark: '000000' }) };
  });
  return { ...rig, slots };
}

/**
 * The setup pose against the painting with `assemble`'s recomposite figures,
 * by `assemble`'s own function (`measureRecomposite`): mean |d| and the share
 * within 8 over the mean channel, error pixels over 40 by the max channel, the
 * uncovered ones where nothing has alpha above 128, and their 8-connected
 * holes — over the stage's W x H pixels, which is assemble's population.
 *
 * What stands in for assemble's two inputs, because the setup pose is what is
 * measured and the parts are not read:
 * - **The recomposite.** assemble composites onto opaque white; rigc renders
 *   onto its opaque `background` (232 grey, rig-c's `BACKGROUND`), so the
 *   frame carries no alpha. A second still of the same pose, every slot tinted
 *   black ({@link blackRig}), is the background times what the art lets
 *   through, channel by channel: `black = bg (1 - a)`. The pose over white is
 *   then `open + (255 - bg) black / bg` — exact for every slot drawn with the
 *   normal blend, which is every slot rig-parts writes.
 * - **The coverage.** assemble's "a part has alpha above 128" becomes "the
 *   setup pose has alpha above 128", the alpha read as `255 (1 - black / bg)`
 *   on the channel that lets most through. Where two translucent parts overlap
 *   the stack's alpha exceeds either part's, so a pixel uncovered here is
 *   uncovered in assemble's reading too, never the reverse.
 *
 * Both are carried from the frame's grid onto the stage's with the seam's map
 * turned round ({@link frameToRigMap}, pixel centre to pixel centre, issue
 * #209), through the same bilinear `warpAffine` in float32, the border reading
 * as no art; then rounded to 8 bits, as assemble's composite is.
 */
export function sourceFigures(open: Raster, black: Raster, vp: Viewport, background: readonly [number, number, number, number], stage: StageBox, srcr: Raster): RecompositeFigures {
  const problems: Problem[] = [];
  for (const [label, f] of [['the setup-pose frame', open], ['the black-tinted setup-pose frame', black]] as const) {
    if (f.width !== vp.pixelWidth || f.height !== vp.pixelHeight) problems.push({ code: 'CHECK_SOURCE_GRID', object: label, detail: `is ${f.width}x${f.height}; frames.json's viewport is ${vp.pixelWidth}x${vp.pixelHeight}` });
  }
  if (background[3] !== 255 || background.slice(0, 3).some((c) => c === 0)) {
    problems.push({ code: 'CHECK_SOURCE_GRID', object: 'the render background', detail: `is ${JSON.stringify(background)}; an opaque background with no channel at 0 is required — the coverage is read as how much of it the black-tinted pose lets through` });
  }
  if (srcr.width !== stage.width || srcr.height !== stage.height) problems.push({ code: 'CHECK_SOURCE_GRID', object: 'the painting on the rig canvas', detail: `is ${srcr.width}x${srcr.height}; the stage is ${stage.width}x${stage.height}` });
  refuseIfAny(problems);
  const [W, H] = [stage.width, stage.height];
  const n = vp.pixelWidth * vp.pixelHeight;
  // Ink = 255 - the pose over white, so the warp's border 0 reads as white paper; channel 3 is the coverage alpha.
  const ink = newFloatImage(vp.pixelWidth, vp.pixelHeight, 4);
  for (let p = 0; p < n; p++) {
    let through = 0;
    for (let c = 0; c < 3; c++) {
      const t = black.data[p * 4 + c] / background[c];
      if (t > through) through = t;
      ink.data[p * 4 + c] = 255 - (open.data[p * 4 + c] + (255 - background[c]) * t);
    }
    ink.data[p * 4 + 3] = 255 * (1 - Math.min(1, through));
  }
  // The seam's map turned round, centre to centre (issue #209).
  const warped = warpAffine(ink, frameToRigMap(stage, H, vp), W, H, 'bilinear');
  const to8 = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));
  const can = newRaster(W, H);
  const cover = newRaster(W, H);
  for (let p = 0; p < W * H; p++) {
    for (let c = 0; c < 3; c++) can.data[p * 4 + c] = to8(255 - warped.data[p * 4 + c]);
    can.data[p * 4 + 3] = 255;
    cover.data[p * 4 + 3] = to8(warped.data[p * 4 + 3]);
  }
  const record: PartRecord = { name: SETUP_POSE_COVER, from: SETUP_POSE_COVER, x: 0, y: 0, w: W, h: H, opaque_px: 0, projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 };
  return measureRecomposite(can, srcr, [{ record, image: cover }]);
}

/** {@link sourceFigures} as the line `check.json` carries: assemble's `recomposite` block's figures and limits, the largest hole's box, and what was compared. */
export function sourceLine(fig: RecompositeFigures, painting: Raster, stage: StageBox, vp: Viewport): ReportedLine {
  const r = recompositeRecord(fig);
  return {
    status: 'REPORTED',
    painting_px: `${painting.width}x${painting.height}`,
    stage_px: `${stage.width}x${stage.height}`,
    render_px: `${vp.pixelWidth}x${vp.pixelHeight}`,
    render_scale: Number(vp.scale.toFixed(4)),
    mean_abs: r.mean_abs,
    within_limit: r.within_limit,
    within_share: r.within_share,
    error_limit: r.error_limit,
    error_px: r.error_px,
    covered_alpha: r.covered_alpha,
    uncovered_error_px: r.uncovered_error_px,
    hole_count: r.hole_count,
    largest: r.holes.length === 0 ? null : { px: r.holes[0].px, box: boxText(r.holes[0]) },
  };
}

// ---------------------------------------------------------------------------
// the stage
// ---------------------------------------------------------------------------

/** One judgement line (issue #11): its status, the figures it measured, and the bars it held them to — or why it measured nothing. */
export type JudgementLine = { status: 'PASS' | 'FAIL'; [figure: string]: unknown } | { status: 'SKIP'; reason: string };

/** The judgement lines, in the order check.json and the console carry them. */
export const JUDGEMENT_LINES = ['BREATH_VISIBLE', 'BLINK_NO_HOLE', 'CHAIN_LAG', 'TIP_OVER_ROOT', 'STILL_REGIONS_DARK', 'TEXTURE_STRETCH'] as const;
export type JudgementName = (typeof JUDGEMENT_LINES)[number];

/**
 * A line with no bar (issue #25): it reports figures and can never be a FAIL,
 * so `PASS` does not read it. SKIP, with the reason, when there is nothing to
 * report from.
 */
export type ReportedLine = { status: 'REPORTED'; [figure: string]: unknown } | { status: 'SKIP'; reason: string };

/** The reported lines, after the judgement lines, in the order check.json and the console carry them. */
export const REPORTED_LINES = ['RECOMPOSITE_HOLES'] as const;

/** check.json — the reference's fields in its order, then the judgement lines, then PASS. */
export interface CheckFigures {
  gate_spine_html_green: boolean;
  /** Which rigc entry gated the build ({@link readRigcEntry}): provenance, not a bar. */
  rigc_entry: RigcEntryRecord;
  /** How the artifact's page was packed: the `--page-edges` and `--pack-shape` rigc was handed, which its pack line was read to agree with ({@link packEdgeProblems}). Provenance, not a bar. */
  pack_mode: { page_edges: PageEdges; pack_shape: PackShape };
  /**
   * Written only under `--environment` (issue #538): the `rigc-environment/1` schedule every measured render was posed
   * under — the path as the command line gave it, the sha256 of the bytes read, and how many steps rigc's reader read
   * off them ({@link readCheckEnvironment}). Provenance, not a bar; without the flag no key is written.
   */
  environment?: CheckEnvironment;
  /** Null when the rig has no idle (issue #77); `skipped.loop` then says why. */
  loop_max_diff: number | null;
  /**
   * Written only when the rig declares a physics constraint (issue #183):
   * each one {@link withoutPhysics} left out of the frames `loop_max_diff` was
   * read from. Reported, not judged; a rig without one writes the keys it always wrote.
   */
  loop_physics?: LoopPhysics[];
  /** The seam figures: null when there is no parts.json (issue #77); `skipped.seam` then says why. The two counts are frame pixels. */
  seam_mean: number | null;
  seam_px_over_40: number | null;
  seam_px_over_80: number | null;
  /**
   * The frame scale s the setup-pose still rendered at (rigc's viewport
   * scale, to six places), issue #216: the seam bar reads `seam_px_over_40`
   * divided by its square ({@link seamRigPx}). Null with the other three.
   */
  seam_frame_scale: number | null;
  /**
   * Written only when `parts.json` declares a scene (issue #242): the frame pixels
   * on the painting's border that the seam figures above leave out, and how many
   * of them were over 40 ({@link seamFigures}). A painting that is not a scene
   * writes the keys it always wrote.
   */
  seam_border?: { frame_px_left_out: number; px_over_40_left_out: number };
  /**
   * Written only when the seam bar fails, or when it was asked for (`check
   * --seam-pairs`), issue #202: the counted pixels split by the pair of parts
   * that answers for each, worst first ({@link SeamPairRow}), each with its
   * picture under {@link SEAM_DIR}. A passing run not asked for it writes the
   * keys it always wrote.
   */
  seam_pairs?: SeamPairRow[];
  BREATH_VISIBLE: JudgementLine;
  BLINK_NO_HOLE: JudgementLine;
  CHAIN_LAG: JudgementLine;
  TIP_OVER_ROOT: JudgementLine;
  STILL_REGIONS_DARK: JudgementLine;
  TEXTURE_STRETCH: JudgementLine;
  /** Written whenever motion.json holds an animation, the idle included (issues #320, #333): {@link FoldsLine}. */
  [FOLD_LINE]?: FoldsLine;
  /** Written only where a `footwear` part rides a bone with a parent and motion.json holds an animation (issue #348): {@link LevelLine}. */
  [LEVEL_LINE]?: LevelLine;
  /** Written whenever parts.json names a `handwear` part and the motion has an idle (issue #347): {@link STRESS_LINE}. */
  [STRESS_LINE]?: JudgementLine;
  /** Written only where parts.json holds a part a `config.limbs` segment made (issue #349): {@link LimbLine}. */
  [LIMB_LINE]?: LimbLine;
  /** Written only where parts.json holds a limb record with a `range` (issue #360): {@link SweepLine}. */
  [SWEEP_LINE]?: SweepLine;
  [MOTION_SEAM_LINE]?: MotionSeamLine;
  /** Written only when the rig declares a physics constraint and has an idle (issue #501): {@link ClothLine}, a warning, never a bar. */
  [CLOTH_LINE]?: ClothLine;
  RECOMPOSITE_HOLES: ReportedLine;
  /** Written only under `--source` (issue #77): the setup pose against the painting, REPORTED. */
  SETUP_POSE_VS_SOURCE?: ReportedLine;
  /**
   * Written only when the loop or the seam measured nothing (issue #77): the
   * reason for each, by the name its console line goes by. The judgement and
   * reported lines carry their own SKIP; these two bars have figures, not a
   * status, so their reasons sit here, and a run that measured both writes
   * the keys it always wrote.
   */
  skipped?: { loop?: string; seam?: string };
  /** Written only under `--set` or `--all-sets` (issue #454): each checked alternate set's setup-pose seam and recomposite figures, keyed by set name. */
  sets?: Record<string, SetCheckFigures>;
  /** Written only under `--requirements` (issue #93): the file's fps, the summary, and one line per declared requirement, by name. */
  requirements?: RequirementsBlock;
  PASS: boolean;
}

/** One alternate set's setup-pose check record under `--set` or `--all-sets` (issue #454). */
export interface SetCheckFigures {
  render_px: string;
  seam_mean: number;
  seam_px_over_40: number;
  seam_px_over_80: number;
  seam_frame_scale: number;
  seam_border?: { frame_px_left_out: number; px_over_40_left_out: number };
  seam_pairs?: SeamPairRow[];
  RECOMPOSITE_HOLES: ReportedLine;
  PASS: boolean;
}

/** `check.json`'s `requirements` block: the fps every named animation was sampled at, the summary, and each line by its name, in the file's order. */
export interface RequirementsBlock {
  fps: number;
  summary: RequirementsSummary;
  lines: Record<string, RequirementLine>;
}

/**
 * The bar over every animation, the idle included (issues #320, #333): no mesh
 * triangle turned over against the setup pose on any frame, on rig-c's own
 * reading —
 * `rigc render --folds`, one run over every animation the build holds — and
 * not a reading of this package's. A fold the art means is declared in the
 * requirements file's `may_fold`, by slot and animation with its why, and is
 * named and not held to the bar.
 *
 * ⭐ **Read with the physics constraints left out**, as the loop is, from the
 * same build ({@link withoutPhysics}). rig-c's render steps physics by 1/fps
 * from frame 0, so a fold a physics constraint makes is the sampling rate's:
 * on the public `scarf` example `hop` folds `bottomwear` (3 of 308 triangles,
 * frames 7-8) at 12 fps, and at none of 10, 15, 24, 30, 36, 48 and 60 fps;
 * `hair_front` at 6 fps; and nothing at 6, 12 or 24 fps with its 30 physics
 * constraints left out [measured for issue #320, rigc 2.47.1, a scratch run,
 * not tracked]. The keys and weights fold at every rate or at none that the
 * sampling resolves; the rate a consumer steps physics at is the scene's.
 *
 * The idle is read like any other animation (issue #333): `TEXTURE_STRETCH`
 * reads how far the idle's triangles stretch, and a triangle that turns inside
 * out is this bar's. Written whenever the motion holds an animation, so a rig
 * of the idle alone writes it too; on the public examples and the trailer no
 * idle folds, keys only [measured for issue #333, rigc 2.47.1, a scratch run,
 * not tracked].
 */
export const FOLD_LINE = 'ANIMATIONS_DO_NOT_FOLD';

/**
 * The bar over every animation, the idle included, for a `footwear` part that
 * rides a bone hanging from another (issue #348): while a bone above the
 * part's bone is turned, the part's drawing stays within
 * {@link LEVEL_BAR_DEGREES} of its setup pose.
 *
 * ⭐ **What the rig declares, and nothing else.** The feet are the parts
 * parts.json says come from a See-through `footwear` layer (the feet
 * `BREATH_VISIBLE` and `STILL_REGIONS_DARK` read); each one's bone is the bone
 * rig.json's slot of the same name sits on, and "the shin" is whatever bone
 * that bone hangs from, read off rig.json's `parent` — nothing here knows a
 * foot or a shin by name. A part on a bone with no parent (`root`, as on every
 * public example) hangs from nothing, so it is not read; a rig with no such
 * part, or no animation, writes no line, and its check.json keeps the keys it
 * always had.
 *
 * - **Posed**: a frame on which some bone above the part's bone — its parent,
 *   or any bone over that up to the root — has a world rotation other than
 *   its setup pose's, read off the `geometry.json` rig-c's render writes. The
 *   nearest such bone is named, with its turn. No threshold: a frame is posed
 *   or it is not.
 * - **The sole's angle**: the part's drawing has no sole a program can find,
 *   so what is held is the drawing itself — the turn of the least-squares
 *   rotation carrying its setup-pose vertices onto the frame's, both centred,
 *   from the same `geometry.json` ({@link drawingTurn}). For a region, its four
 *   corners turn rigidly with its bone and this is the bone's turn exactly;
 *   for a mesh it is the best rotation the skinned vertices admit. Level is
 *   the setup pose, the painting's own: the check cannot see where the sole is
 *   drawn, and the setup pose is the art as painted.
 * - **The bar** is {@link LEVEL_BAR_DEGREES}, HQ's line — not a figure measured
 *   here, and stated as HQ's wherever it is printed.
 *
 * Read off the fold render ({@link FOLD_LINE}), which then also writes
 * `--geometry`: the same build, with its physics constraints left out, at the
 * same rate. A part no frame poses says SKIP in its row; a line every row of
 * which says SKIP says SKIP and is not counted as measured.
 */
export const LEVEL_LINE = 'FEET_STAY_LEVEL';

/** Issue #349: every limb part rides its one bone ({@link limbLine}). */
export const LIMB_LINE = 'LIMB_ONE_BONE';

/**
 * `SEAM_OVER_RANGE` (issue #360, item 13): the seam bar read with each limb
 * joint bent, not only at rest. Every lower segment `parts.json` records with
 * a `range` — its config segment's, `[min, max]` degrees from rest — is posed
 * at `min`, at the middle `(min + max) / 2` and at `max`, each angle once in
 * that order ({@link sweepAngles}), by a `rotate` key on its bone (rigc's
 * sense: counter-clockwise on screen), one joint per animation, on a throwaway
 * copy of the rig with its physics constraints left out.
 *
 * - **What is compared.** At each pose, two renders of one build on one grid:
 *   the copy as it is, and the copy with the joint's own art drawn under the
 *   limb ({@link sweepUnderlay}) — the limb's parts composited at rest,
 *   inside the cap's disc (`limb.cap.at` and `radius`), one pixel in from
 *   every edge of what is opaque there — as a region on the bone the joint's
 *   bone hangs from, so it does not turn, in a slot just before the limb's
 *   first. Where the bent limb still covers the disc the two are the same
 *   picture; where the bend uncovers it, the second shows the joint's art and
 *   the first what lies behind the limb. At rest the limb's parts cover every
 *   one of those pixels opaquely, and the one-pixel margin is the reach of a
 *   bilinear sample, so the underlay never half-shows at an edge the limb
 *   draws.
 * - **The bar is the rest-pose seam's, unchanged.** {@link seamFigures} on the
 *   pair — the second render as the reference, on the first's own grid, so the
 *   map is the identity — and {@link seamFails}: mean |d| at most
 *   {@link SEAM_MEAN_BAR}, at most {@link SEAM_PX_BAR} rig px over
 *   {@link SEAM_PX_LEVEL}, the count divided by the frame scale squared. No
 *   threshold is new.
 * - **A disc cap is held to its promise** (issue #360, unit B). A joint whose
 *   cap record says `shape: "disc"` (`cap_shape: "disc"` in the config) is
 *   also a FAIL at a pose where any frame pixel of the comparison is over
 *   {@link SEAM_PX_LEVEL}: the disc is the cap's whole claim, so one uncovered
 *   pixel of it is one too many. The level is the seam's; the count's bar is
 *   the card's ("the joint disc holds no background pixel"), not a figure
 *   measured here. Its row says `shape: "disc"`; no other row changes.
 * - **Opt-in by construction.** Written only when `parts.json` holds a limb
 *   record with a `range`; a rig without one renders nothing more and writes
 *   what it wrote.
 */
export const SWEEP_LINE = 'SEAM_OVER_RANGE';

/** HQ's line (rig-c/parts#347 ruling 4, issue #348): the sole within ±10 degrees of level while the shin is posed. Not measured here. */
export const LEVEL_BAR_DEGREES = 10;

/** Where the bar comes from, as the line and check.json state it. */
export const LEVEL_BAR_SOURCE = "HQ's line (rig-c/parts#347 ruling 4), not a figure measured here";

/**
 * The bar on a sleeve whose mesh is weighted to a bone off its chain (issue
 * #347). The chain's first link is turned through {@link STRESS_TURNS} on a
 * throwaway copy of the rig; rigc poses each turn and writes its
 * `geometry.json`; the part's worst edge, max(ratio, 1/ratio) against the
 * setup pose ({@link stretchFigures}, the quantity `TEXTURE_STRETCH` reads),
 * must read {@link STRESS_RIGID} at {@link STRESS_PLACES} places. A part
 * weighted to its chain alone turns rigidly with the link, so it reads exactly
 * that; a vertex weighted to a bone the turn does not move is pulled between
 * the two, and the line names that bone — the segment on it in the config's
 * `meshes.<part>.segments`.
 *
 * - **The bar is the rigid reading, not a margin.** Measured for issue #347
 *   (rigc 2.47.1, scratch runs, not tracked): the `handwear_*` parts of
 *   `demo` and of the exam-01 test rig, their chest segment dropped, read
 *   1.0000038 to 1.0000090 over the three turns of each sleeve — float32 bone
 *   arithmetic — and 1.0000 at four places; with the segment, 2.41 to 1498.
 * - **The turns are interim** (issue #347, HQ's ruling 1): ±90° and 180° on
 *   the first link, the card's arm raised, arm across and arm behind the head,
 *   until a config block names each limb and its joint's declared range — the
 *   stress check then poses each limb at its range's ends.
 * - **Which parts: those from a See-through `handwear` layer**
 *   ({@link STRESS_TAGS}) whose weights ride exactly one chain the idle keys
 *   ({@link chainsCarrying}). A part riding two chains (one mesh for both
 *   sleeves) stretches between them by construction when one turns, and is
 *   listed as not read with that reason. The scope is the tag and not every
 *   one-chain part: `reference-demo`'s `hairpin` rides its tassel's chain and
 *   the pin's bone, a pendant the idle swings a few degrees, and reads 23.7
 *   with its tassel turned 180° (issue #347, scratch run) — a figure for the
 *   limbs block to scope, not a defect this line was asked to name.
 */
export const STRESS_LINE = 'STRESS_OFF_CHAIN';

/** The bars `PASS` reads, in the order the summary counts them: the gate, the reference's two, then the judgement lines. */
export const BARS = ['gate', 'loop', 'seam', ...JUDGEMENT_LINES] as const;

/**
 * The bars a character's own check may have failed and `compose --accept`
 * still take (issue #203): every bar of {@link BARS} but the gate, which is
 * rig-c's and never accepted, {@link FOLD_LINE} (issue #320) and
 * {@link STRESS_LINE} (issue #347).
 */
export const ACCEPTABLE_BARS: readonly string[] = [...BARS.filter((b) => b !== 'gate'), FOLD_LINE, LEVEL_LINE, STRESS_LINE, LIMB_LINE, SWEEP_LINE];

/**
 * The bars a `check.json`, as `check` writes it, says were not met, in
 * {@link BARS} order: the gate when `gate_spine_html_green` is not true, the
 * loop when `loop_max_diff` is a number other than {@link LOOP_MAX_BAR}, the
 * seam when its figures fail {@link seamFails}, and each judgement line whose
 * status is `FAIL`, then {@link FOLD_LINE} when it is written and `FAIL`
 * (issue #320), then {@link LEVEL_LINE} the same way (issue #348), then {@link STRESS_LINE} likewise (issue #347), then
 * {@link LIMB_LINE} (issue #349), then {@link SWEEP_LINE} (issue #360). A bar that measured nothing (null figures, `SKIP`) is not
 * one of them. Read off the file rather than its problems, because the file is
 * all a finished build leaves (issue #203).
 */
export function barsNotMet(fig: Readonly<Record<string, unknown>>): string[] {
  const out: string[] = [];
  if (fig.gate_spine_html_green !== true) out.push('gate');
  if (typeof fig.loop_max_diff === 'number' && fig.loop_max_diff !== LOOP_MAX_BAR) out.push('loop');
  // A check.json written before issue #216 has no seam_frame_scale; it is read by the frame count, the bar it was written under.
  const scale = typeof fig.seam_frame_scale === 'number' ? fig.seam_frame_scale : 1;
  const setFailed =
    isRecord(fig.sets) &&
    Object.values(fig.sets).some((s) => isRecord(s) && typeof s.seam_mean === 'number' && typeof s.seam_px_over_40 === 'number' && seamFails(s.seam_mean, s.seam_px_over_40, typeof s.seam_frame_scale === 'number' ? s.seam_frame_scale : 1));
  if ((typeof fig.seam_mean === 'number' && typeof fig.seam_px_over_40 === 'number' && seamFails(fig.seam_mean, fig.seam_px_over_40, scale)) || setFailed) out.push('seam');
  for (const n of [...JUDGEMENT_LINES, FOLD_LINE, LEVEL_LINE, STRESS_LINE, LIMB_LINE, SWEEP_LINE]) {
    const l = fig[n];
    if (typeof l === 'object' && l !== null && (l as { status?: unknown }).status === 'FAIL') out.push(n);
  }
  return out;
}

/** The declared requirements a `check.json` says were not PASS (FAIL or NOT MEASURABLE), by name, in the file's order; none without a `requirements` block. */
export function requirementsNotPass(fig: Readonly<Record<string, unknown>>): string[] {
  const block = fig.requirements;
  if (typeof block !== 'object' || block === null) return [];
  const lines = (block as { lines?: unknown }).lines;
  if (typeof lines !== 'object' || lines === null) return [];
  return Object.entries(lines as Record<string, unknown>)
    .filter(([, l]) => typeof l !== 'object' || l === null || (l as { status?: unknown }).status !== 'PASS')
    .map(([n]) => n);
}

export interface CheckReport {
  figures: CheckFigures;
  gateHtml: string[];
  pack: PackLine[];
  /** Opaque share (alpha > 0) of each packed page, by page file name. */
  packOpaque: Array<{ page: string; share: number }>;
  /** Null when the rig has no idle. */
  idle: { frames: number; fps: number; duration: number; lastIndex: number; loopAt: { x: number; y: number } } | null;
  /** The physics line ({@link loopPhysicsLine}); null when the rig declares no physics constraint or has no idle. */
  loopPhysics: string | null;
  /** The setup-pose still's grid; null when nothing read the still (no parts.json and no `--source`). */
  seamViewport: Viewport | null;
  /** Every bar in {@link BARS} that measured, and every one that did not with its reason. */
  bars: { measured: string[]; skipped: Array<{ bar: string; reason: string }> };
  /** Every bar that was not met, one problem each; empty on PASS. */
  problems: Problem[];
  written: string[];
  /** Under `--requirements` only (issue #93): what `check.json`'s `requirements` block holds; null without the flag. */
  requirements: RequirementsBlock | null;
  /**
   * The animations `motion.json` holds beside the idle (issue #183), in its
   * order: built and gated with the rig, measured by nothing here — every bar
   * reads the idle. Empty when the idle is alone.
   */
  besideIdle: string[];
  /** `SEAM_OVER_MOTION` (issue #493): a warning, never a bar — in `check.json` only when a pair is declared; its SKIP is printed either way. */
  motionSeam: MotionSeamLine;
  /** `CLOTH_SETTLES` (issue #501): a warning, never a bar — in `check.json` only when the rig declares a physics constraint and has an idle; its SKIP is printed either way. */
  cloth: ClothLine;
}

/**
 * How many of the bars measured and how many said SKIP, by name — the
 * summary's second half (issue #77): `PASS` reads only the bars that measured,
 * so a run that measured one bar says so on the line that says PASS. The
 * count is every bar `check` tallied: the {@link BARS}, and
 * {@link FOLD_LINE} where it is written (issue #320).
 */
export function barsSummary(r: Pick<CheckReport, 'bars'>): string {
  const { measured, skipped } = r.bars;
  return `${measured.length} of ${measured.length + skipped.length} bar(s) measured, ${skipped.length} skipped${skipped.length === 0 ? '' : ` (${skipped.map((s) => s.bar).join(', ')})`}`;
}

/** The summary's warning clause: each warning line that read something, named, with the warnings they printed together; empty when none read. */
export function warningsClause(r: Pick<CheckReport, 'motionSeam' | 'cloth'>): string {
  const read = [...(r.motionSeam.status === 'SKIP' ? [] : [{ name: MOTION_SEAM_LINE, n: r.motionSeam.warnings }]), ...(r.cloth.status === 'SKIP' ? [] : [{ name: CLOTH_LINE, n: r.cloth.warnings }])];
  if (read.length === 0) return '';
  return `; ${read.reduce((a, x) => a + x.n, 0)} warning(s) (${read.map((x) => x.name).join(', ')}, not a bar)`;
}

/**
 * The last line `check` prints, whole and as printed (`check: PASS; …` or `check: FAIL — …; …`), issue #541: the
 * one place it is composed. `check` prints it from here, and `remesh.json` / `retune.json` carry it from here
 * ({@link CheckReport} in, no clock, no path), so a consumer matching the carried line against a `check` run's stdout
 * compares the same composer's output twice.
 */
export function checkSummaryLine(r: Pick<CheckReport, 'figures' | 'problems' | 'requirements' | 'bars' | 'motionSeam' | 'cloth'>): string {
  const reqNotPass = r.requirements === null ? 0 : r.requirements.summary.declared - r.requirements.summary.pass;
  const notMet = r.requirements === null ? `${r.problems.length} bar(s) not met` : `${r.problems.length - reqNotPass} bar(s) not met, ${reqNotPass} declared requirement(s) not PASS`;
  return `${r.figures.PASS ? 'check: PASS' : `check: FAIL — ${notMet}`}; ${barsSummary(r)}${warningsClause(r)}`;
}

/** A block's status as {@link checkStatuses} reads it off `check.json`. */
export type CheckStatus = 'PASS' | 'FAIL' | 'SKIP' | 'WARN' | 'CLEAR' | 'REPORTED';

/**
 * Every block's status as `check.json` records it (issue #541), read off the figures object `check.json` is written
 * from, in the file's order, one entry per block the file holds. The three bars with figures and no `status` key are
 * read the way {@link barsNotMet} reads the file: `gate` PASS when `gate_spine_html_green` is true, else FAIL (it is
 * never skipped); `loop` SKIP when `loop_max_diff` is null, `seam` SKIP when `seam_mean` is null, otherwise FAIL when
 * {@link barsNotMet} names it and PASS when it does not. Every other block carries its own `status` key and is copied:
 * the judgement lines, then {@link FOLD_LINE}, {@link LEVEL_LINE}, {@link STRESS_LINE}, {@link LIMB_LINE},
 * {@link SWEEP_LINE}, {@link MOTION_SEAM_LINE}, {@link CLOTH_LINE}, the reported lines and {@link SOURCE_LINE}, each
 * where the file writes it. The `requirements` block's lines are not bars and are not read here.
 */
export function checkStatuses(fig: CheckFigures): Record<string, CheckStatus> {
  const notMet = barsNotMet(fig as unknown as Record<string, unknown>);
  const bar = (name: string, measured: boolean): CheckStatus => (!measured ? 'SKIP' : notMet.includes(name) ? 'FAIL' : 'PASS');
  const out: Record<string, CheckStatus> = { gate: bar('gate', true), loop: bar('loop', fig.loop_max_diff !== null), seam: bar('seam', fig.seam_mean !== null) };
  for (const n of JUDGEMENT_LINES) out[n] = fig[n].status;
  for (const n of [FOLD_LINE, LEVEL_LINE, STRESS_LINE, LIMB_LINE, SWEEP_LINE, MOTION_SEAM_LINE, CLOTH_LINE, ...REPORTED_LINES, SOURCE_LINE] as const) {
    const l = fig[n];
    if (l !== undefined) out[n] = l.status;
  }
  return out;
}

/**
 * The one line `check` prints when `motion.json` holds animations beside the
 * idle (issue #183), or null when it holds none, so a rig of the idle alone
 * prints what it printed before.
 */
export function besideIdleLine(names: readonly string[], level = false): string | null {
  if (names.length === 0) return null;
  const readers = level ? `${FOLD_LINE} reads each for folds and ${LEVEL_LINE} for how far the feet turn` : `${FOLD_LINE} reads each for folds`;
  return `beside the idle: ${names.length} animation(s), ${names.join(', ')} — built and gated by rigc with the rig; ${readers}, every other bar here reads the idle`;
}

// ---------------------------------------------------------------------------
// every animation, the idle included, read for folds (issues #320, #333)
// ---------------------------------------------------------------------------

/**
 * The fold render's `--max`, rigc's smallest: `--folds` reads posed vertices
 * in world units, which the frame size does not change (rig-c AUTHORING §8.3),
 * so the frames are drawn as small as rigc draws them and thrown away. On
 * `scarf` the `hop` folds.json was byte-identical at `--max` 16 and 640
 * [measured for issue #320, a scratch run].
 */
export const FOLD_RENDER_MAX = 16;

/** The fold render, under `--out`; removed before the stage returns. */
const FOLD_SCRATCH = '_folds';

/** One side of a mesh's fold reading (with physics on or off): rigc's figures and its printed line. */
export interface FoldSide {
  /** How many frames show a folded triangle. */
  frames: number;
  /** The frame with the most, the earliest on a tie (rigc's `worst`). */
  worst_frame: number;
  /** How many triangles are folded on that frame. */
  worst_triangles: number;
  /** rigc's printed line for the mesh, verbatim (`rigc render --folds`). */
  line: string;
}

/** One mesh that folds in one animation: rigc's figures, with physics on and off side by side, its physics constraints when only physics folds it, the declaration that takes it if any, and rigc's own line. */
export interface FoldRow {
  animation: string;
  slot: string;
  attachment: string;
  /** How many frames show a folded triangle (the active reading, physics on when the rig has physics). */
  frames: number;
  /** The frame with the most, the earliest on a tie (rigc's `worst`). */
  worst_frame: number;
  /** How many triangles are folded on that frame. */
  worst_triangles: number;
  /** How many triangles the mesh has. */
  triangles: number;
  /** The reading with physics on, or null when the mesh folds only with physics off. */
  physics_on: FoldSide | null;
  /** The reading with physics off, or null when the mesh folds only with physics on. */
  physics_off: FoldSide | null;
  /** When the mesh folds only with physics on (`physics_on !== null && physics_off === null`), the physics constraints on its bones (`<name> on <bone>`); empty otherwise. */
  physics_constraints: string[];
  /** The `may_fold` entry's why when the requirements file declares this slot and animation; null when nothing does. */
  declared: string | null;
  /** rigc's printed line for the mesh, verbatim (`rigc render --folds`). */
  line: string;
}

/** `check.json`'s `ANIMATIONS_DO_NOT_FOLD`: written whenever the motion holds an animation, the idle included. */
export interface FoldsLine {
  status: 'PASS' | 'FAIL';
  /** Every animation, the idle included, in motion.json's order: each one read. */
  animations: string[];
  fps: number;
  /** How many physics constraints the rig declares ({@link withoutPhysics}) — stepped in `physics_on` and left out in `physics_off`; 0 when the rig has none. */
  physics_left_out: number;
  /** Every mesh that folds in an animation read, in that animation's order and rigc's mesh order. */
  folding: FoldRow[];
  /** The rows no `may_fold` entry takes: the bar's figure. */
  folding_undeclared: number;
  /** The `may_fold` entries no row matches, each a FAIL — an exception that excepts nothing. */
  declared_not_folding: Array<{ slot: string; animation: string }>;
  /** The bar: undeclared folds, at most this many. */
  bar: number;
}

/** One folding mesh as the reading states it. */
export interface FoldingMesh {
  slot: string;
  attachment: string;
  triangleCount: number;
  frames: number;
  worstFrame: number;
  worstTriangles: number;
  line: string;
}

/** The marker rigc prints before each fold line (`rigc render --folds`). */
const FOLD_PRINTED = /^\s*\.\.\s+folds\s+(.*)$/;

/**
 * The folding meshes of each named animation, read off a `rigc render
 * --folds` run over every animation: `frames.json` names each set's
 * directory, each `folds.json` (`rigc-folds/1`) its meshes, and each folding
 * mesh's line is the one rigc printed for it. Refuses (`CHECK_FOLDS_READ`),
 * every problem at once, a set or file that is missing, a file that is not
 * the animation's or not at the rate asked, a field of the wrong shape, and a
 * folding mesh rigc printed no line for.
 */
export function readFoldSets(dir: string, named: readonly string[], fps: number, printed: string): Map<string, FoldingMesh[]> {
  const problems: Problem[] = [];
  const bad = (object: string, detail: string): void => {
    problems.push({ code: 'CHECK_FOLDS_READ', object, detail });
  };
  const lines = printed.split('\n').map((l) => FOLD_PRINTED.exec(l)?.[1]).filter((l): l is string => l !== undefined);
  const out = new Map<string, FoldingMesh[]>();
  const sidecar = readJson(join(dir, 'frames.json'), problems);
  const sets = sidecar !== null && Array.isArray(sidecar.sets) ? sidecar.sets.filter(isRecord) : [];
  for (const name of named) {
    const set = sets.find((x) => x.animation === name);
    if (set === undefined || typeof set.dir !== 'string') {
      bad(join(dir, 'frames.json'), `names no frame set for animation ${JSON.stringify(name)}; \`rigc render --folds\` over the build writes one per animation`);
      continue;
    }
    const path = join(dir, set.dir, 'folds.json');
    const file = readJson(path, problems);
    if (file === null) continue;
    if (file.spec !== 'rigc-folds/1') bad(path, `spec is ${JSON.stringify(file.spec)}; "rigc-folds/1" is required`);
    if (file.animation !== name) bad(path, `animation is ${JSON.stringify(file.animation)}; ${JSON.stringify(name)} is required`);
    if (file.fps !== fps) bad(path, `fps is ${JSON.stringify(file.fps)}; ${fps}, the rate asked for, is required`);
    if (!Array.isArray(file.meshes)) {
      bad(path, `meshes is ${JSON.stringify(file.meshes)?.slice(0, 40)}; an array is required`);
      continue;
    }
    const rows: FoldingMesh[] = [];
    file.meshes.forEach((m, i) => {
      const at = `${path} meshes[${i}]`;
      if (!isRecord(m) || typeof m.slot !== 'string' || typeof m.attachment !== 'string' || typeof m.triangleCount !== 'number' || !Array.isArray(m.frames)) {
        bad(at, 'is not { slot, attachment, triangleCount, frames, worst } as rigc-folds/1 writes it');
        return;
      }
      if (m.worst === null) return;
      const worst = isRecord(m.worst) ? m.worst : null;
      if (worst === null || typeof worst.index !== 'number' || !Array.isArray(worst.triangles)) {
        bad(at, `worst is ${JSON.stringify(m.worst)?.slice(0, 40)}; null or { index, triangles, … } is required`);
        return;
      }
      const prefix = `${JSON.stringify(name)}: mesh "${m.attachment}" (slot "${m.slot}") folds on `;
      const line = lines.find((l) => l.startsWith(prefix));
      if (line === undefined) {
        bad(at, `folds on ${m.frames.length} frame(s), and rigc printed no line beginning ${prefix.trim()}`);
        return;
      }
      rows.push({ slot: m.slot, attachment: m.attachment, triangleCount: m.triangleCount, frames: m.frames.length, worstFrame: worst.index, worstTriangles: worst.triangles.length, line });
    });
    out.set(name, rows);
  }
  refuseIfAny(problems);
  return out;
}

/**
 * The physics constraints on the bones a mesh attachment is bound to (or their
 * ancestors, or `<bone>` when a stopped link is bound as `<bone>_d`), in
 * {@link withoutPhysics} order, formatted `"<name> on <bone>"`.
 */
export function meshPhysicsConstraints(rig: Record<string, unknown>, slot: string, attachment: string, physics: readonly LoopPhysics[]): string[] {
  if (physics.length === 0) return [];
  const bones = (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord).filter((b) => typeof b.name === 'string');
  const parent = new Map(bones.map((b) => [String(b.name), typeof b.parent === 'string' ? b.parent : null]));
  const skins = isRecord(rig.skins) ? rig.skins : {};
  const skin = isRecord(skins.default) ? skins.default : {};
  const onSlot = isRecord(skin[slot]) ? skin[slot] : {};
  const att = isRecord(onSlot[attachment]) ? onSlot[attachment] : null;
  const bound = new Set<string>();
  const addWithAncestors = (start: string): void => {
    for (let b: string | null = start; b !== null && !bound.has(b); b = parent.get(b) ?? null) {
      bound.add(b);
      if (b.endsWith('_d')) bound.add(b.slice(0, -2));
    }
  };
  if (att !== null && Array.isArray(att.weights)) {
    for (const v of att.weights) {
      if (!Array.isArray(v)) continue;
      for (const w of v) if (isRecord(w) && typeof w.bone === 'string' && typeof w.weight === 'number' && w.weight > 0) addWithAncestors(w.bone);
    }
  }
  if (bound.size === 0) {
    const slotRec = (Array.isArray(rig.slots) ? rig.slots : []).filter(isRecord).find((s) => s.name === slot);
    if (slotRec !== undefined && typeof slotRec.bone === 'string') addWithAncestors(slotRec.bone);
  }
  const direct = physics.filter((p) => bound.has(p.bone));
  return (direct.length > 0 ? direct : physics).map((p) => `${p.name} on ${p.bone}`);
}

/**
 * The fold line (issues #320, #333, #363) from the reading: posed with physics
 * stepping on the render clock (`readings`, and `readingsWithoutPhysics`
 * beside it when the rig declares physics constraints), every folding mesh a
 * row reporting `physics_on` and `physics_off` side by side, a row no
 * `may_fold` entry takes a `CHECK_ANIMATIONS_DO_NOT_FOLD` problem naming the
 * animation, the slot, the physics constraint(s) on its bones and the worst
 * frame when the fold appears only with physics on, and rigc's line, and an
 * entry no row matches a problem of its own — a declaration that excepts
 * nothing.
 */
export function foldsLine(
  named: readonly string[],
  fps: number,
  physicsLeftOut: number,
  readings: ReadonlyMap<string, readonly FoldingMesh[]>,
  mayFold: readonly MayFold[],
  requirementsPath: string | null,
  problems: Problem[],
  readingsWithoutPhysics: ReadonlyMap<string, readonly FoldingMesh[]> = readings,
  rig: Record<string, unknown> = {},
  physicsList: readonly LoopPhysics[] = [],
): FoldsLine {
  const toSide = (m: FoldingMesh | undefined): FoldSide | null =>
    m === undefined ? null : { frames: m.frames, worst_frame: m.worstFrame, worst_triangles: m.worstTriangles, line: m.line };
  const folding: FoldRow[] = [];
  for (const name of named) {
    const onList = readings.get(name) ?? [];
    const offList = readingsWithoutPhysics.get(name) ?? [];
    const seen = new Set<string>();
    const keys: Array<{ slot: string; attachment: string }> = [];
    for (const m of [...onList, ...offList]) {
      const k = `${m.slot}\0${m.attachment}`;
      if (!seen.has(k)) {
        seen.add(k);
        keys.push({ slot: m.slot, attachment: m.attachment });
      }
    }
    for (const { slot, attachment } of keys) {
      const on = onList.find((m) => m.slot === slot && m.attachment === attachment);
      const off = offList.find((m) => m.slot === slot && m.attachment === attachment);
      const primary = (on ?? off) as FoldingMesh;
      const entry = mayFold.find((e) => e.slot === slot && e.animation === name);
      const onlyPhysicsOn = on !== undefined && off === undefined;
      const constraints = onlyPhysicsOn ? meshPhysicsConstraints(rig, slot, attachment, physicsList) : [];
      folding.push({
        animation: name,
        slot,
        attachment,
        frames: primary.frames,
        worst_frame: primary.worstFrame,
        worst_triangles: primary.worstTriangles,
        triangles: primary.triangleCount,
        physics_on: toSide(on),
        physics_off: toSide(off),
        physics_constraints: constraints,
        declared: entry === undefined ? null : entry.why,
        line: primary.line,
      });
    }
  }
  const physics =
    physicsLeftOut === 0
      ? ''
      : `, with its ${physicsLeftOut} physics constraint(s) on and off`;
  for (const r of folding) {
    if (r.declared !== null) continue;
    const sideClause =
      r.physics_on !== null && r.physics_off === null && physicsLeftOut > 0
        ? ` (physics on: ${r.physics_on.frames} frame(s), worst frame ${r.physics_on.worst_frame} (${r.physics_on.worst_triangles}/${r.triangles} triangle(s)); physics off: 0 frame(s); physics constraint(s) on mesh "${r.attachment}": ${r.physics_constraints.join(', ')})`
        : r.physics_on !== null && r.physics_off !== null && physicsLeftOut > 0
          ? ` (physics on: ${r.physics_on.frames} frame(s), worst frame ${r.physics_on.worst_frame}; physics off: ${r.physics_off.frames} frame(s), worst frame ${r.physics_off.worst_frame})`
          : r.physics_on === null && r.physics_off !== null && physicsLeftOut > 0
            ? ` (physics on: 0 frame(s); physics off: ${r.physics_off.frames} frame(s), worst frame ${r.physics_off.worst_frame})`
            : '';
    problems.push({
      code: `CHECK_${FOLD_LINE}`,
      object: `animation "${r.animation}", mesh "${r.attachment}" (slot "${r.slot}")`,
      detail: `rigc render --folds at ${fps} fps${physics}${sideClause}: ${r.line}; no triangle turned over against the setup pose is required — a fold the art means is declared in the --requirements file's may_fold, { "slot": "${r.slot}", "animation": "${r.animation}", "why": … }`,
    });
  }
  const declaredNotFolding = mayFold.filter((e) => !folding.some((r) => r.slot === e.slot && r.animation === e.animation)).map((e) => ({ slot: e.slot, animation: e.animation }));
  for (const e of declaredNotFolding) {
    problems.push({
      code: `CHECK_${FOLD_LINE}`,
      object: `${requirementsPath ?? 'the requirements file'} may_fold (slot "${e.slot}", animation "${e.animation}")`,
      detail: `declares a fold, and rigc render --folds at ${fps} fps${physics} reads no folded triangle on slot "${e.slot}" in animation "${e.animation}"; an exception that excepts nothing is taken out of the file`,
    });
  }
  const undeclared = folding.filter((r) => r.declared === null).length;
  return {
    status: undeclared === 0 && declaredNotFolding.length === 0 ? 'PASS' : 'FAIL',
    animations: [...named],
    fps,
    physics_left_out: physicsLeftOut,
    folding,
    folding_undeclared: undeclared,
    declared_not_folding: declaredNotFolding,
    bar: 0,
  };
}

// ---------------------------------------------------------------------------
// the feet stay level while a bone above them turns (issue #348)
// ---------------------------------------------------------------------------

/** A `footwear` part on a bone that hangs from another, as rig.json declares it. */
export interface LevelFoot {
  part: string;
  /** The bone the part's slot sits on. */
  bone: string;
  /** That bone's parent in rig.json. */
  hangs_from: string;
}

/** The frame a foot's drawing turned furthest on, among the frames a bone above it was turned. */
export interface LevelWorst {
  animation: string;
  frame: number;
  time: number;
  /** The drawing's turn from its setup pose, degrees, CCW, six places. */
  degrees: number;
  /** The nearest bone above the part's bone that is turned on that frame, and its turn. */
  turned: string;
  turned_degrees: number;
  /** The bones from the part's bone up to `turned`, `turned` left out, each with its inherit mode as rig.json writes it ("normal", rig-c's default, where it writes none). */
  through: Array<{ bone: string; inherit: string }>;
}

export interface LevelRow extends LevelFoot {
  status: 'PASS' | 'FAIL' | 'SKIP';
  /** Frames, over every animation, on which a bone above the part's bone is turned and the part is shown. */
  frames_posed: number;
  worst: LevelWorst | null;
}

/** `check.json`'s `FEET_STAY_LEVEL`. */
export interface LevelLine {
  status: 'PASS' | 'FAIL' | 'SKIP';
  /** Only on a SKIP: why nothing was measured. */
  reason?: string;
  animations: string[];
  fps: number;
  physics_left_out: number;
  bar_degrees: number;
  bar: string;
  feet: LevelRow[];
}

/** The `footwear` parts the line reads (module comment above {@link LEVEL_LINE}), in parts.json's order: each on a slot of its name whose bone has a parent. */
export function levelFeet(parts: PartsFile, rig: Record<string, unknown>): LevelFoot[] {
  const slots = (Array.isArray(rig.slots) ? rig.slots : []).filter(isRecord);
  const bones = (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord);
  const out: LevelFoot[] = [];
  for (const p of partsTagged(parts, FEET_TAGS)) {
    const slot = slots.find((sl) => sl.name === p.name);
    if (slot === undefined || typeof slot.bone !== 'string') continue;
    const bone = bones.find((b) => b.name === slot.bone);
    if (bone === undefined || typeof bone.parent !== 'string') continue;
    out.push({ part: p.name, bone: slot.bone, hangs_from: bone.parent });
  }
  return out;
}

/**
 * The turn, in degrees CCW (y up), of the least-squares rotation carrying the
 * points `rest` onto `posed` (flat `x, y` lists, one point per pair), both
 * centred on their means: atan2(Σ (r × p), Σ (r · p)). Null when the sums are
 * both 0 — fewer than two distinct points, so no direction to turn.
 */
export function drawingTurn(rest: readonly number[], posed: readonly number[]): number | null {
  const n = rest.length / 2;
  let rx = 0;
  let ry = 0;
  let px = 0;
  let py = 0;
  for (let i = 0; i < n; i++) {
    rx += rest[2 * i];
    ry += rest[2 * i + 1];
    px += posed[2 * i];
    py += posed[2 * i + 1];
  }
  rx /= n;
  ry /= n;
  px /= n;
  py /= n;
  let cross = 0;
  let dot = 0;
  for (let i = 0; i < n; i++) {
    const ax = rest[2 * i] - rx;
    const ay = rest[2 * i + 1] - ry;
    const bx = posed[2 * i] - px;
    const by = posed[2 * i + 1] - py;
    cross += ax * by - ay * bx;
    dot += ax * bx + ay * by;
  }
  if (cross === 0 && dot === 0) return null;
  return (Math.atan2(cross, dot) * 180) / Math.PI;
}

/** A bone's turn from its setup pose to a frame, degrees CCW in (-180, 180], off the two world matrices. */
export function boneTurn(setup: BoneWorld, frame: BoneWorld): number {
  return normaliseDegrees(((Math.atan2(frame.c, frame.a) - Math.atan2(setup.c, setup.a)) * 180) / Math.PI);
}

/** One animation's frames as the fold render wrote them with `--geometry`: the set and its geometry file. */
export interface LevelReading {
  animation: string;
  set: FrameSet;
  geometryPath: string;
}

/**
 * The line from the feet and the readings (module comment above
 * {@link LEVEL_LINE}); each FAIL row adds one `CHECK_FEET_STAY_LEVEL` problem
 * naming the part, its bone, the frame and the bones the turn came through.
 */
export function levelLine(feet: readonly LevelFoot[], rig: Record<string, unknown>, readings: readonly LevelReading[], fps: number, physicsLeftOut: number, problems: Problem[]): LevelLine {
  const bones = (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord);
  const parentOf = (n: string): string | null => {
    const b = bones.find((x) => x.name === n);
    return b !== undefined && typeof b.parent === 'string' ? b.parent : null;
  };
  const inheritOf = (n: string): string => {
    const b = bones.find((x) => x.name === n);
    return b !== undefined && typeof b.inherit === 'string' ? b.inherit : 'normal';
  };
  const rows: LevelRow[] = feet.map((f) => ({ ...f, status: 'SKIP', frames_posed: 0, worst: null }));
  for (const r of readings) {
    const geo = readGeometry(r.geometryPath, r.set.written);
    if (geo === null) geometryProblem(r.geometryPath, `does not exist; \`rigc render --folds --geometry\` writes it, and ${LEVEL_LINE} is read off it`);
    const shown = attachmentPoses(r.geometryPath, r.set.written);
    const tracks = new Map<string, BoneTrack>();
    const track = (n: string): BoneTrack => {
      const got = tracks.get(n) ?? boneTrackOf(geo, r.geometryPath, r.set, n);
      if (typeof got === 'string') return geometryProblem(r.geometryPath, got);
      tracks.set(n, got);
      return got;
    };
    for (const row of rows) {
      const above: string[] = [];
      for (let b: string | null = row.hangs_from; b !== null; b = parentOf(b)) above.push(b);
      r.set.frames.forEach((_, i) => {
        const turned = above.find((b) => {
          const t = track(b);
          return boneTurn(t.setup, t.frames[i]) !== 0;
        });
        if (turned === undefined) return;
        const at = shown[i].get(row.part);
        if (at === undefined) return;
        const deg = drawingTurn(at.rest, at.posed);
        if (deg === null) return;
        row.frames_posed++;
        const degrees = round6(deg);
        if (row.worst !== null && Math.abs(degrees) <= Math.abs(row.worst.degrees)) return;
        const t = track(turned);
        const through: Array<{ bone: string; inherit: string }> = [];
        for (let b: string | null = row.bone; b !== null && b !== turned; b = parentOf(b)) through.push({ bone: b, inherit: inheritOf(b) });
        row.worst = { animation: r.animation, frame: r.set.frames[i].index, time: t.times[i], degrees, turned, turned_degrees: round6(boneTurn(t.setup, t.frames[i])), through };
      });
    }
  }
  for (const row of rows) {
    if (row.worst === null) continue;
    row.status = Math.abs(row.worst.degrees) > LEVEL_BAR_DEGREES ? 'FAIL' : 'PASS';
  }
  const physics = physicsLeftOut === 0 ? '' : `, its ${physicsLeftOut} physics constraint(s) left out`;
  for (const row of rows) {
    if (row.status !== 'FAIL' || row.worst === null) continue;
    const w = row.worst;
    const how = w.through.map((x) => `"${x.bone}" (inherit ${x.inherit})`).join(', then ');
    problems.push({
      code: `CHECK_${LEVEL_LINE}`,
      object: `footwear part "${row.part}" on bone "${row.bone}" (hangs from "${row.hangs_from}")`,
      detail:
        `in animation "${w.animation}" frame ${w.frame} (t = ${w.time}s, rigc render --folds --geometry at ${fps} fps${physics}), "${w.turned}" is turned ${w.turned_degrees} degrees from its setup pose and the part's drawing ${w.degrees} degrees; ` +
        `within ±${LEVEL_BAR_DEGREES} degrees of level (its setup pose) is required while a bone above it is turned — ${LEVEL_BAR_SOURCE}. ` +
        `The turn reaches the drawing through ${how}: config.bones' "inherit" on "${row.bone}" says what it takes from "${row.hangs_from}" (rig-c's modes, as its table spells them: ${RIG_BONE_INHERIT.join(', ')})`,
    });
  }
  const status: LevelLine['status'] = rows.some((r) => r.status === 'FAIL') ? 'FAIL' : rows.some((r) => r.status === 'PASS') ? 'PASS' : 'SKIP';
  const names = readings.map((r) => r.animation);
  const line: LevelLine = { status, animations: names, fps, physics_left_out: physicsLeftOut, bar_degrees: LEVEL_BAR_DEGREES, bar: LEVEL_BAR_SOURCE, feet: rows };
  if (status === 'SKIP') {
    line.reason = `no frame of ${names.map((n) => `"${n}"`).join(', ')} turns a bone above ${rows.map((r) => `"${r.bone}" (which "${r.part}" rides)`).join(', ')}, so no foot was seen while its leg was posed`;
  }
  return line;
}

// ---------------------------------------------------------------------------
// a part on one chain, posed large (issue #347)
// ---------------------------------------------------------------------------


/** The first link's turns, degrees from its setup rotation (issue #347's card: ±90° and 180°), interim until limbs are declared. */
export const STRESS_TURNS: readonly number[] = [90, -90, 180];

/** The parts the line reads (issue #347): from a See-through layer of these tags. */
export const STRESS_TAGS: readonly BaseTag[] = ['handwear'];

/** The reading a part riding its chain rigidly gives: max(ratio, 1/ratio) of 1. */
export const STRESS_RIGID = 1;

/** The places the reading is held to {@link STRESS_RIGID} at: four, where the rigid parts' float32 noise (at most 9.0e-6 measured) rounds away. */
export const STRESS_PLACES = 4;

/** The stress render, under `--out`; removed before the stage returns. */
const STRESS_SCRATCH = '_stress';

/** The animation one turn of one first link is posed by on the throwaway copy. */
export function stressAnimationName(link: string, turn: number): string {
  return `stress ${link} ${turn}`;
}

/**
 * The stress render's geometry, by animation: `frames.json` names each set's
 * directory and how many frames it wrote, and each `geometry.json` is read by
 * {@link readGeometry}. A set or a file missing is refused
 * (`CHECK_GEOMETRY_FILE`), every one at once.
 */
export function readStressSets(dir: string, named: readonly string[]): Map<string, IdleGeometry> {
  const problems: Problem[] = [];
  const sidecar = readJson(join(dir, 'frames.json'), problems);
  const sets = sidecar !== null && Array.isArray(sidecar.sets) ? sidecar.sets.filter(isRecord) : [];
  const out = new Map<string, IdleGeometry>();
  for (const name of named) {
    const set = sets.find((x) => x.animation === name);
    if (set === undefined || typeof set.dir !== 'string' || typeof set.written !== 'number') {
      problems.push({ code: 'CHECK_GEOMETRY_FILE', object: join(dir, 'frames.json'), detail: `names no frame set for animation ${JSON.stringify(name)} with its directory and frame count; \`rigc render --geometry\` over the turned copy writes one per animation` });
      continue;
    }
    const path = join(dir, set.dir, GEOMETRY_FILE);
    const geo = readGeometry(path, set.written);
    if (geo === null) problems.push({ code: 'CHECK_GEOMETRY_FILE', object: path, detail: 'does not exist; `rigc render --geometry` writes it, and the stress line reads the part\'s posed mesh from it' });
    else out.set(name, geo);
  }
  refuseIfAny(problems);
  return out;
}

/** A part the line reads: its chain's links from the root, and the bones it is weighted to off that chain, each with how many of its vertices carry it and the largest weight. */
export interface StressPart {
  part: string;
  chain: string[];
  off_chain: Array<{ bone: string; vertices: number; of: number; largest_weight: number }>;
}

/** The parts a handwear tag names that the line reads, and those it does not with the reason. */
export interface StressPlan {
  read: StressPart[];
  notRead: Array<{ part: string; reason: string }>;
}

/**
 * Which handwear parts the line reads (see {@link STRESS_LINE}): a weighted
 * mesh whose bones ride exactly one chain of the idle; for each, the bones
 * off that chain — neither a link nor under one — with their vertex counts
 * and largest weight, read off `rig.json`'s default skin.
 */
export function stressPlan(rig: Record<string, unknown>, motion: Record<string, unknown>, parts: readonly PartRecord[]): StressPlan {
  const read: StressPart[] = [];
  const notRead: StressPlan['notRead'] = [];
  const bones = (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord).filter((b) => typeof b.name === 'string');
  const parent = new Map(bones.map((b) => [String(b.name), typeof b.parent === 'string' ? b.parent : null]));
  const skins = isRecord(rig.skins) ? rig.skins : {};
  const skin = isRecord(skins.default) ? skins.default : {};
  for (const p of parts) {
    // Issue #349: a limb segment is held to its one bone by LIMB_ONE_BONE, read off rig.json, so it turns rigidly by construction.
    if (p.limb !== undefined) {
      notRead.push({ part: p.name, reason: `a limb segment (config.limbs.${p.limb.name}), held to its one bone "${p.limb.bone}" by ${LIMB_LINE}, so it turns rigidly by construction` });
      continue;
    }
    const onSlot = skin[p.name];
    const atts: unknown[] = isRecord(onSlot) ? (isRecord(onSlot[p.name]) ? [onSlot[p.name]] : Object.values(onSlot)) : [];
    const weighted = atts.filter((a): a is Record<string, unknown> & { weights: unknown[] } => isRecord(a) && Array.isArray(a.weights));
    if (weighted.length === 0) {
      notRead.push({ part: p.name, reason: 'it is not a weighted mesh, so it rides one bone whole and cannot stretch' });
      continue;
    }
    const { found } = chainsCarrying(rig, motion, p.name);
    if (found.length !== 1) {
      notRead.push({
        part: p.name,
        reason:
          found.length === 0
            ? 'its weights ride no chain the idle keys, so there is no chain to turn'
            : `its weights ride ${found.length} chains (${found.map((c) => `"${c[0]}"`).join(', ')}): turning one stretches the part toward the other by construction; a part riding one chain is read until a limbs block names each limb`,
      });
      continue;
    }
    const chain = found[0];
    const onChain = (b: string): boolean => {
      const seen = new Set<string>();
      for (let x: string | null = b; x !== null && !seen.has(x); x = parent.get(x) ?? null) {
        if (chain.includes(x)) return true;
        seen.add(x);
      }
      return false;
    };
    const off = new Map<string, { vertices: number; largest: number }>();
    let of = 0;
    for (const a of weighted) {
      for (const v of a.weights) {
        of++;
        const ws = (Array.isArray(v) ? v : []).filter(isRecord).filter((w) => typeof w.bone === 'string' && typeof w.weight === 'number') as Array<{ bone: string; weight: number }>;
        for (const w of ws) {
          if (onChain(w.bone) || w.weight <= 0) continue;
          const e = off.get(w.bone) ?? { vertices: 0, largest: 0 };
          e.vertices++;
          e.largest = Math.max(e.largest, w.weight);
          off.set(w.bone, e);
        }
      }
    }
    read.push({ part: p.name, chain, off_chain: [...off].map(([bone, e]) => ({ bone, vertices: e.vertices, of, largest_weight: e.largest })) });
  }
  return { read, notRead };
}

/** The throwaway copy's animations: one per first link and turn, a single `rotate` key at time 0, duration 0. */
export function stressAnimations(plan: StressPlan): Record<string, { duration: number; tracks: Array<{ bone: string; property: string; keys: Array<{ t: number; v: number[] }> }> }> {
  const out: ReturnType<typeof stressAnimations> = {};
  for (const r of plan.read) {
    for (const turn of STRESS_TURNS) out[stressAnimationName(r.chain[0], turn)] = { duration: 0, tracks: [{ bone: r.chain[0], property: 'rotate', keys: [{ t: 0, v: [turn] }] }] };
  }
  return out;
}

/** {@link STRESS_PLACES} places. */
function roundStress(x: number): number {
  const k = 10 ** STRESS_PLACES;
  return Math.round(x * k) / k;
}

/**
 * The line from the renders: `geometry` maps each stress animation to its
 * `geometry.json` read by {@link readGeometry}. Per part and turn, the
 * worst edge of the part's mesh; a reading above {@link STRESS_RIGID} at
 * {@link STRESS_PLACES} places is a `CHECK_STRESS_OFF_CHAIN` problem naming
 * the part, the link and turn, the edge, and the bones off the chain. SKIP,
 * with every part's reason, when no handwear part is read.
 */
export function stressLine(plan: StressPlan, geometry: (animation: string) => IdleGeometry, problems: Problem[]): JudgementLine {
  if (plan.read.length === 0) return skip(plan.notRead.map((n) => `"${n.part}": ${n.reason}`).join('; '));
  const rows: Array<Record<string, unknown>> = [];
  let worst: { part: string; link: string; turn: number; reading: number } | null = null;
  let failed = false;
  for (const r of plan.read) {
    const poses: Array<Record<string, unknown>> = [];
    for (const turn of STRESS_TURNS) {
      const name = stressAnimationName(r.chain[0], turn);
      const geo = geometry(name);
      const m = stretchFigures(
        geo.meshes.filter((x) => x.slot === r.part),
        geo.frames,
      );
      const seen = m.filter((x) => x.max !== null && x.min !== null);
      if (seen.length === 0) {
        poses.push({ turn, unmeasured: `the "${name}" render shows no mesh on slot "${r.part}"` });
        failed = true;
        problems.push({ code: `CHECK_${STRESS_LINE}`, object: `mesh "${r.part}" with "${r.chain[0]}" turned ${turn}°`, detail: `the "${name}" render shows no mesh on slot "${r.part}", so its stretch was not read; a part not read is not a pass` });
        continue;
      }
      let at: StretchAt | null = null;
      let reading = 0;
      for (const x of seen) {
        for (const s of [x.max as StretchAt, x.min as StretchAt]) {
          const v = stretchSeverity(s.ratio);
          if (v > reading) {
            reading = v;
            at = s;
          }
        }
      }
      const shown = roundStress(reading);
      const a = at as StretchAt;
      poses.push({ turn, reading: shown, worst: { triangle: a.triangle, edge: a.edge, ratio: round3(a.ratio) } });
      if (worst === null || reading > worst.reading) worst = { part: r.part, link: r.chain[0], turn, reading };
      if (shown > STRESS_RIGID) {
        failed = true;
        const bones = r.off_chain.length === 0 ? 'no vertex is weighted off the chain, so a bone under the chain or the render moves it' : r.off_chain.map((o) => `"${o.bone}" (${o.vertices} of ${o.of} vertices, largest weight ${round3(o.largest_weight)})`).join(', ');
        problems.push({
          code: `CHECK_${STRESS_LINE}`,
          object: `mesh "${r.part}" with chain link "${r.chain[0]}" turned ${turn}°`,
          detail:
            `its worst edge, triangle ${a.triangle} edge ${a.edge.join('-')}, is ${round3(a.ratio)} times its rest length (max(ratio, 1/ratio) ${shown}); ${STRESS_RIGID.toFixed(STRESS_PLACES)}, the part turning rigidly with its chain, is required — ` +
            `it is weighted off the chain to ${bones}: a segment on ${r.off_chain.length === 1 ? `"${r.off_chain[0].bone}"` : 'each of those bones'} in meshes.${r.part}.segments pins the part while the chain turns; drop it, so the part rides its chain alone`,
        });
      }
    }
    rows.push({ part: r.part, link: r.chain[0], links: r.chain.length, off_chain: r.off_chain.map((o) => ({ ...o, largest_weight: round3(o.largest_weight) })), poses });
  }
  const w = worst as { part: string; link: string; turn: number; reading: number } | null;
  return {
    status: failed ? 'FAIL' : 'PASS',
    tags: [...STRESS_TAGS],
    turns: [...STRESS_TURNS],
    parts_read: plan.read.length,
    reading: w === null ? null : roundStress(w.reading),
    worst: w === null ? null : { part: w.part, link: w.link, turn: w.turn },
    bar: STRESS_RIGID,
    per_part: rows,
    not_read: plan.notRead,
  };
}

// ---------------------------------------------------------------------------
// a limb segment rides one bone (issue #349)
// ---------------------------------------------------------------------------

/**
 * `LIMB_ONE_BONE` (issue #349): every part a `config.limbs` segment made —
 * `parts.json`'s records that carry `limb` — is bound in `rig.json` to its
 * limb bone alone, with weight 1: a region on a slot whose bone is that bone,
 * or a mesh whose every weight names it. A bend is a rotation at the joint,
 * never a deformed mesh, and a second bone is the pin (a puff held by the
 * chest) or the noodle (a forearm blended along a chain) the cut retires.
 * Under `config.turn` a part rides the leaf twin of its bone
 * (`turnTwin`), an identity child, and the twin counts as the bone. Read off
 * `rig.json` and `parts.json` alone: nothing is rendered. Written only when
 * `parts.json` holds a limb part, so a check with none writes what it wrote.
 * The name is {@link LIMB_LINE}.
 */

/** One limb part's row of the line. */
export interface LimbRow {
  part: string;
  limb: string;
  bone: string;
  status: 'PASS' | 'FAIL';
  /** The bones besides its own the part is bound to, in rig.json's order; empty on a PASS. */
  others: string[];
}

/** `check.json`'s `LIMB_ONE_BONE`. */
export interface LimbLine {
  status: 'PASS' | 'FAIL';
  parts: LimbRow[];
}

/** The line from parts.json's limb records and rig.json's slots and skins; each FAIL row adds one `CHECK_LIMB_ONE_BONE` problem naming the part and every second bone. Null when no part is a limb's. */
export function limbLine(parts: PartsFile, rig: Record<string, unknown>, problems: Problem[]): LimbLine | null {
  const limbParts = parts.parts.filter((p) => p.limb !== undefined);
  if (limbParts.length === 0) return null;
  const slots = (Array.isArray(rig.slots) ? rig.slots : []).filter(isRecord);
  const rows: LimbRow[] = limbParts.map((p) => {
    const l = p.limb as NonNullable<PartRecord['limb']>;
    const own = new Set([l.bone, turnTwin(p.name, l.bone)]);
    const slot = slots.find((sl) => sl.name === p.name);
    const bound = slot === undefined ? new Set<string>() : boundBones(rig, p.name);
    const others = [...bound].filter((b) => !own.has(b));
    const fail = others.length > 0 || bound.size === 0;
    if (fail) {
      problems.push({
        code: `CHECK_${LIMB_LINE}`,
        object: `limb part "${p.name}" (config.limbs.${l.name} segment ${l.segment}, bone "${l.bone}")`,
        detail:
          bound.size === 0
            ? `is bound to no bone in rig.json (no slot of its name, or no attachment); its one bone "${l.bone}", with weight 1, is required`
            : `is weighted to ${others.map((b) => `"${b}"`).join(', ')} besides "${l.bone}"; a limb part rides its one bone with weight 1 — a bend is a rotation at the joint, never a deformed mesh — so a region on "${l.bone}" (config.regions.${p.name}), or a mesh whose segments name "${l.bone}" alone, is required`,
      });
    }
    return { part: p.name, limb: l.name, bone: l.bone, status: fail ? 'FAIL' : 'PASS', others };
  });
  return { status: rows.some((r) => r.status === 'FAIL') ? 'FAIL' : 'PASS', parts: rows };
}

// ---------------------------------------------------------------------------
// the seam over a joint's declared range (issue #360; the rule is {@link SWEEP_LINE}'s)
// ---------------------------------------------------------------------------

/** The sweep's copy, builds and renders, under `--out`; removed before the stage returns. */
const SWEEP_SCRATCH = '_sweep';

/** The transparent margin round an underlay image, as `src/rig.ts` gives every part image (its `PAD`), so its edge is sampled against transparency. */
const UNDER_PAD = 4;

/** One joint the line poses: the lower segment's part and its limb record. */
export interface SweepJoint {
  part: string;
  limb: string;
  segment: number;
  joint: string;
  /** The lower segment's bone: the one the bend turns. */
  bone: string;
  range: [number, number];
  at: [number, number];
  radius: number;
  /** Issue #360: the cap's record says `shape: "disc"` — the disc is held to no pixel uncovered ({@link sweepLine}). */
  disc?: true;
}

/** Every limb record in `parts.json` that declares a `range`, in `parts.json`'s order. */
export function sweepJoints(parts: PartsFile): SweepJoint[] {
  const out: SweepJoint[] = [];
  for (const p of parts.parts) {
    const l = p.limb;
    if (l === undefined || l.range === undefined || l.cap === undefined || l.joint === undefined) continue;
    out.push({ part: p.name, limb: l.name, segment: l.segment, joint: l.joint, bone: l.bone, range: [l.range[0], l.range[1]], at: [l.cap.at[0], l.cap.at[1]], radius: l.cap.radius, ...(l.cap.shape === 'disc' ? { disc: true as const } : {}) });
  }
  return out;
}

/** The angles a joint is posed at: the range's two ends and its middle, `[min, (min + max) / 2, max]`, each once, in that order. */
export function sweepAngles(range: readonly [number, number]): number[] {
  const out: number[] = [];
  for (const a of [range[0], (range[0] + range[1]) / 2, range[1]]) if (!out.includes(a)) out.push(a);
  return out;
}

/** The animation one joint at one angle is posed by on the copy. */
export function sweepAnimationName(part: string, degrees: number): string {
  return `seam over range ${part} ${degrees}`;
}

/** The underlay slot of a joint's lower part: `<part>_under`, with one more `_` for each name the rig already holds. */
export function underlaySlotName(part: string, taken: ReadonlySet<string>): string {
  let n = `${part}_under`;
  while (taken.has(n)) n += '_';
  return n;
}

/**
 * The joint's own art at rest (see {@link SWEEP_LINE}): the limb's parts —
 * every `parts.json` record whose `limb.name` is the joint's limb — composited
 * at their boxes in `parts.json`'s order over a transparent canvas, and of that
 * each pixel that, with its eight neighbours, lies inside the cap's disc
 * ({@link inDisc}) at alpha 255, cropped to the cap's box ({@link capBox})
 * and padded by {@link UNDER_PAD}. `box` is the padded image's place in rig
 * px, `px` the pixels it holds.
 */
export function sweepUnderlay(parts: PartsFile, image: (name: string) => Raster, j: SweepJoint): { box: [number, number, number, number]; image: Raster; px: number } {
  const [W, H] = parts.rig_size;
  let canvas = newRaster(W, H);
  for (const p of parts.parts) if (p.limb?.name === j.limb) canvas = alphaComposite(canvas, image(p.name), p.x, p.y);
  const solid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && inDisc(j.at, j.radius, x, y) && canvas.data[(y * W + x) * 4 + 3] === 255;
  const [bx, by, bw, bh] = capBox(j.at, j.radius);
  const out = newRaster(bw + 2 * UNDER_PAD, bh + 2 * UNDER_PAD);
  let px = 0;
  for (let y = by; y < by + bh; y++) {
    for (let x = bx; x < bx + bw; x++) {
      let inner = true;
      for (let dy = -1; dy <= 1 && inner; dy++) for (let dx = -1; dx <= 1 && inner; dx++) inner = solid(x + dx, y + dy);
      if (!inner) continue;
      const s = (y * W + x) * 4;
      out.data.set(canvas.data.subarray(s, s + 4), ((y - by + UNDER_PAD) * out.width + (x - bx + UNDER_PAD)) * 4);
      px++;
    }
  }
  return { box: [bx - UNDER_PAD, by - UNDER_PAD, out.width, out.height], image: out, px };
}

/** Why a joint is not read, or null when it is: its bone is not in rig.json with a parent, no slot of rig.json shows one of its limb's parts, or its disc holds no opaque art. */
export function sweepUnread(j: SweepJoint, rig: Record<string, unknown>, limbSlots: readonly string[], underPx: number): string | null {
  const bones = (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord);
  const own = bones.find((b) => b.name === j.bone);
  if (own === undefined || typeof own.parent !== 'string' || own.parent === '') return `"${j.bone}" is not a bone of rig.json with a parent, so there is no bone the joint's art can stay on while it turns`;
  if (limbSlots.length === 0) return `no slot of rig.json shows a part of limb "${j.limb}", so there is no limb to draw the joint's art under`;
  if (underPx === 0) return `the disc of radius ${j.radius} px about [${j.at.join(', ')}] holds no pixel of limb "${j.limb}"'s parts at rest that is opaque (alpha 255) with its eight neighbours, so a gap the bend opens cannot be seen against the joint's art`;
  return null;
}

/**
 * The throwaway copy (see {@link SWEEP_LINE}): `rig` with one underlay slot per
 * read joint — a region on the parent of the joint's bone, centred on its box
 * and turned back by that bone's world rotation so it is drawn upright, as
 * `src/rig.ts` places a region (rig-c's frames, through `src/coords.ts`) —
 * just before the first slot of the joint's limb; `motion` with its
 * animations replaced by one per read joint and angle, a `rotate` key on the
 * joint's bone held from 0 to the still's duration. `read[i]` is joint `i`'s
 * underlay, or null when it is not read; `files` the names, less `.png`, the
 * images directory already holds, which a slot's name avoids as it avoids the
 * slots ({@link underlaySlotName}). Returns the copy, the underlay slots (for
 * `--hide`) and their images, each named `<slot>.png`.
 */
export function sweepCopy(
  rig: Record<string, unknown>,
  motion: Record<string, unknown>,
  joints: readonly SweepJoint[],
  read: ReadonlyArray<{ box: [number, number, number, number]; image: Raster } | null>,
  limbSlots: (limb: string) => string[],
  stage: StageBox,
  rigH: number,
  files: ReadonlySet<string> = new Set(),
): { rig: Record<string, unknown>; motion: Record<string, unknown>; slots: string[]; images: Array<[string, Raster]> } {
  const bones = (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord);
  const posable: Parameters<typeof computeExactFrameTransforms>[0][number][] = bones.map((b) => ({
    name: String(b.name),
    ...(typeof b.parent === 'string' && b.parent !== '' ? { parent: b.parent } : {}),
    ...Object.fromEntries((['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'] as const).filter((k) => typeof b[k] === 'number').map((k) => [k, b[k] as number])),
    ...(typeof b.inherit === 'string' ? { inherit: b.inherit } : {}),
  }));
  const world = computeExactFrameTransforms(posable);
  const slots = (Array.isArray(rig.slots) ? rig.slots : []).filter(isRecord).map((s) => ({ ...s }));
  const skins = isRecord(rig.skins) ? rig.skins : {};
  const skin: Record<string, unknown> = { ...(isRecord(skins.default) ? skins.default : {}) };
  const taken = new Set([...slots.map((s) => String(s.name)), ...files]);
  const added: string[] = [];
  const images: Array<[string, Raster]> = [];
  const animations: Record<string, unknown> = {};
  joints.forEach((j, i) => {
    const u = read[i];
    if (u === null) return;
    const parent = String((bones.find((b) => b.name === j.bone) as Record<string, unknown>).parent);
    const m = world.get(parent) as BoneTransform;
    const name = underlaySlotName(j.part, taken);
    taken.add(name);
    const [x, y] = toBoneLocal(m, stage.x + u.box[0] + u.box[2] / 2, stage.y + cropToSpineY(u.box[1] + u.box[3] / 2, rigH));
    const turn = normaliseDegrees(-m.worldRotation);
    skin[name] = { [name]: turn === 0 ? { image: `${name}.png`, x, y } : { image: `${name}.png`, x, y, rotation: turn } };
    const mine = new Set(limbSlots(j.limb));
    slots.splice(slots.findIndex((s) => mine.has(String(s.name))), 0, { name, bone: parent, attachment: name });
    added.push(name);
    images.push([`${name}.png`, u.image]);
    for (const a of sweepAngles(j.range)) {
      animations[sweepAnimationName(j.part, a)] = { duration: STILL_DURATION, loop: false, tracks: [{ bone: j.bone, property: 'rotate', keys: [{ t: 0, v: [a] }, { t: STILL_DURATION, v: [a] }] }] };
    }
  });
  return { rig: { ...rig, slots, skins: { ...skins, default: skin } }, motion: { ...motion, animations }, slots: added, images };
}

/** One pose of a joint: the angle from rest and the rest-pose seam's figures read there ({@link SWEEP_LINE}). */
export interface SweepPose {
  degrees: number;
  status: 'PASS' | 'FAIL';
  mean: number;
  px_over_40: number;
  px_over_80: number;
  rig_px_over_40: number;
}

/** One joint's row: its limb record, its disc, how many of the joint's own art pixels the disc holds, and each pose — or, not read, why. */
export interface SweepRow {
  part: string;
  limb: string;
  segment: number;
  joint: string;
  bone: string;
  range: [number, number];
  at: [number, number];
  radius: number;
  /** Issue #360: written only for a joint whose cap is `cap_shape: "disc"`, held to no pixel over the level in its disc. */
  shape?: 'disc';
  under_px: number;
  status: 'PASS' | 'FAIL';
  poses: SweepPose[];
  unread?: string;
}

/** `check.json`'s `SEAM_OVER_RANGE`: the frame scale the counts are divided by (null when no joint was read), the physics constraints left out, the bar, and one row per joint. */
export interface SweepLine {
  status: 'PASS' | 'FAIL';
  frame_scale: number | null;
  physics_left_out: number;
  bar: { mean: number; rig_px_over_40: number; level: number };
  joints: SweepRow[];
}

/**
 * The line from the renders: `frames(animation)` gives the pose's two frame
 * sets, with the joints' art under the limb (`under`) and without it (`bare`).
 * Every set is on one grid over one background, or the line is refused
 * (`CHECK_SEAM_OVER_RANGE`): the figures compare them pixel for pixel. Each
 * pose that fails {@link seamFails}, and each joint not read, adds one
 * `CHECK_SEAM_OVER_RANGE` problem naming the joint and the angle.
 */
export function sweepLine(
  joints: readonly SweepJoint[],
  underPx: readonly number[],
  unread: ReadonlyArray<string | null>,
  frames: (animation: string) => { under: FrameSet; bare: FrameSet },
  physicsLeftOut: number,
  problems: Problem[],
): SweepLine {
  const seen: { grid: FrameSet | null } = { grid: null };
  const rows: SweepRow[] = joints.map((j, i) => {
    const object = (at: string): string => `joint "${j.joint}" (config.limbs.${j.limb} segment ${j.segment}, part "${j.part}", bone "${j.bone}") ${at}`;
    const head = { part: j.part, limb: j.limb, segment: j.segment, joint: j.joint, bone: j.bone, range: j.range, at: j.at, radius: j.radius, ...(j.disc === true ? { shape: 'disc' as const } : {}), under_px: underPx[i] };
    const why = unread[i];
    if (why !== null) {
      problems.push({ code: `CHECK_${SWEEP_LINE}`, object: object(`over its range [${j.range.join(', ')}]`), detail: `is not read: ${why}; a joint not read is not a pass` });
      return { ...head, status: 'FAIL', poses: [], unread: why };
    }
    const poses: SweepPose[] = sweepAngles(j.range).map((a) => {
      const { under, bare } = frames(sweepAnimationName(j.part, a));
      for (const s of [under, bare]) {
        const first: FrameSet = seen.grid ?? s;
        if (!sameViewport(first.viewport, s.viewport) || first.background.join(',') !== s.background.join(',')) {
          refuseIfAny([
            {
              code: `CHECK_${SWEEP_LINE}`,
              object: `the render of "${sweepAnimationName(j.part, a)}"${s === under ? '' : ' with the underlays hidden'}`,
              detail: `is on ${JSON.stringify(s.viewport)} over ${JSON.stringify(s.background)}; the sweep's first render is on ${JSON.stringify(first.viewport)} over ${JSON.stringify(first.background)}, and the two renders of a pose are compared pixel for pixel`,
            },
          ]);
        }
        seen.grid = first;
      }
      const vp = bare.viewport;
      const f = seamFigures(under.frames[0].image, bare.frames[0].image, { x: 0, y: 0, width: vp.pixelWidth, height: vp.pixelHeight }, vp, bare.background, { sx: 1, sy: 1, tx: 0, ty: 0 });
      const mean = round3(f.mean);
      const scale = round6(vp.scale);
      // Issue #360: a disc cap promises the disc covered at every pose, so one pixel over the level there is a FAIL of its own.
      const discFail = j.disc === true && f.over40 > 0 && !seamFails(mean, f.over40, scale);
      const fail = seamFails(mean, f.over40, scale) || discFail;
      if (discFail) {
        problems.push({
          code: `CHECK_${SWEEP_LINE}`,
          object: object(`bent ${a}°`),
          detail:
            `${f.over40} frame px over ${SEAM_PX_LEVEL} (${f.over80} over ${SEAM_PX_LEVEL_HIGH}) at frame scale ${scale}, mean |d| ${mean}/255, against the same pose with the joint's own art drawn under the limb (${underPx[i]} px, the disc of radius ${j.radius} px about [${j.at.join(', ')}]); ` +
            `the cap is cap_shape "disc", which promises the disc covered at every pose — no pixel of it over ${SEAM_PX_LEVEL}, under the rest-pose seam's bar as well — and the bend shows what lies behind the limb there: a cap pixel the art did not give ("limb cap:" counts them as missing), or a pixel cleared from "${j.part}" after assemble wrote it`,
        });
      } else if (fail) {
        problems.push({
          code: `CHECK_${SWEEP_LINE}`,
          object: object(`bent ${a}°`),
          detail:
            `mean |d| ${mean}/255 and ${f.over40} frame px over ${SEAM_PX_LEVEL} (${f.over80} over ${SEAM_PX_LEVEL_HIGH}) at frame scale ${scale}, ${seamRigPxText(f.over40, scale)} rig px (the count / s²), against the same pose with the joint's own art drawn under the limb (${underPx[i]} px, the disc of radius ${j.radius} px about [${j.at.join(', ')}]); ` +
            `mean <= ${SEAM_MEAN_BAR.toFixed(1)} and <= ${SEAM_PX_BAR} rig px over ${SEAM_PX_LEVEL} are required, the rest-pose seam's bar — the bend uncovers the joint, and a cap that covers the turn (the limb's art within that radius on the upper side of the joint line, carried by "${j.part}") keeps it covered`,
        });
      }
      return { degrees: a, status: fail ? 'FAIL' : 'PASS', mean, px_over_40: f.over40, px_over_80: f.over80, rig_px_over_40: Number(seamRigPxText(f.over40, scale)) };
    });
    return { ...head, status: poses.some((p) => p.status === 'FAIL') ? 'FAIL' : 'PASS', poses };
  });
  const g = seen.grid;
  return {
    status: rows.some((r) => r.status === 'FAIL') ? 'FAIL' : 'PASS',
    frame_scale: g === null ? null : round6(g.viewport.scale),
    physics_left_out: physicsLeftOut,
    bar: { mean: SEAM_MEAN_BAR, rig_px_over_40: SEAM_PX_BAR, level: SEAM_PX_LEVEL },
    joints: rows,
  };
}

// ---------------------------------------------------------------------------
// the seam over every animation (issue #493; the line is {@link MOTION_SEAM_LINE}'s)
// ---------------------------------------------------------------------------

/**
 * `SEAM_OVER_MOTION` (issue #493): every declared neighbour pair read in every
 * animation `motion.json` holds, the idle included, by rig-c's seam reading
 * (`rigc render --seam`, rig-c 2.60.0) — a **warning, never a bar**. The
 * owner's ruling (2026-10-18): a seam opening in motion may be intentional, so
 * the line names the pair, the animation, the frames and the cells, and moves
 * neither the exit status nor `check: PASS`; the summary counts it apart from
 * the bars.
 *
 * The pairs are the ones the inputs declare and nothing else: each limb's
 * consecutive segments in `parts.json` (`config.limbs`, the upper and the
 * segment below each joint) and, under `--requirements`, each `seam`
 * requirement's part and neighbour. None declared, the line is a SKIP naming
 * why, never a pass, and `check.json` carries no key for it.
 *
 * **The floor** ({@link openingOverFloor}): a frame's gap or ghost is reported
 * when it holds more cells than its box is long — when it is thicker than one
 * cell. rigc counts a cell drawn when the renderer paints its centre at half
 * opacity or more, so a boundary that moves by less than a cell flips the
 * cells along it in or out: a line of cells one deep, scattered or joined,
 * holds at most as many cells as its box's longer side. A hole of any area
 * holds more. The rule types no number; it is read off rigc's own cell and
 * box, and measured, not chosen: on `examples/wind`'s idle rigc names 43
 * openings over its six limb pairs (28 and 15 frames of the two elbows, 1 to
 * 5 cells, boxes up to 17 cells long) and every one is one cell thick; on
 * rig-c's `gallery/walk` its 13 joint cracks of 1 to 3 cells are too; the
 * ghost rig-c's own reading names on a skirt swung clear of a leg (1564 cells
 * in a box 92 long) is far over it.
 */
export const MOTION_SEAM_LINE = 'SEAM_OVER_MOTION';

/** The seam reading's scratch build and renders, under `--out`; removed before the stage returns. */
const MOTION_SEAM_SCRATCH = '_seam_motion';

/** rig-c's seam reading: the file it writes in each set's directory, and its format tag. */
export const SEAM_READING_FILE = 'seam.json';
export const SEAM_READING_SPEC = 'rigc-seam/1';

/** The floor as the console and `check.json` state it. */
export const MOTION_SEAM_FLOOR = "a frame opens when its gap or its ghost holds more cells than its box is long (rig-c's cell, its box's longer side) — thicker than one cell; a crack one cell deep is the half-opacity cut moving by less than a cell, and is not reported";

/** One declared pair: the two slots, and every declaration that names it. */
export interface MotionSeamPair {
  /** `"<a>|<b>"`, the two slots in the order declared first. */
  pair: string;
  a: string;
  b: string;
  declared: string[];
  /** Why the pair is not read: a slot `rig.json` does not have. */
  unread?: string;
}

/** One pair in one animation, as the floor reads rigc's file. */
export interface MotionSeamRow {
  pair: string;
  animation: string;
  /** rigc's: `skip` when no frame has a band to read — nothing measured, not a seam that held. */
  status: 'read' | 'skip';
  /** Frames both slots draw, and of those the frames read (rigc's `drawn`, `banded`). */
  drawn: number;
  banded: number;
  /** The frames over the floor, ascending: the warning's frames. */
  opens: number[];
  /** Beside `opens`, frame by frame: the most cells of either kind on that frame. */
  px: number[];
  /** The most cells of either kind on any frame over the floor; 0 when none is. */
  max_px: number;
  /** The frames rigc names open whose every opening is one cell thick: under the floor, not reported. */
  under_floor: number[];
}

/** The line: `WARN` with at least one warning, `CLEAR` with none, `SKIP` with nothing declared or nothing to read. */
export interface MotionSeamLine {
  status: 'WARN' | 'CLEAR' | 'SKIP';
  reason?: string;
  fps: number;
  floor: string;
  pairs: MotionSeamPair[];
  animations: string[];
  /** Rows with a frame over the floor: the WARN lines. */
  warnings: number;
  rows: MotionSeamRow[];
}

/**
 * The neighbour pairs the inputs declare, in their order: each limb's
 * consecutive segments (`parts.json`'s limb records, by segment), then each
 * `seam` requirement's part and neighbour. A pair named twice, in either
 * order, is one pair with both declarations.
 */
export function motionSeamPairs(parts: PartsFile, seams: ReadonlyArray<{ name: string; part: string; neighbour: string }>): MotionSeamPair[] {
  const out: MotionSeamPair[] = [];
  const add = (a: string, b: string, declared: string): void => {
    const hit = out.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
    if (hit !== undefined) hit.declared.push(declared);
    else out.push({ pair: `${a}|${b}`, a, b, declared: [declared] });
  };
  const limbs: string[] = [];
  for (const p of parts.parts) if (p.limb !== undefined && !limbs.includes(p.limb.name)) limbs.push(p.limb.name);
  for (const limb of limbs) {
    const segs = parts.parts.filter((p) => p.limb?.name === limb).sort((x, y) => (x.limb as LimbRecord).segment - (y.limb as LimbRecord).segment);
    for (let i = 1; i < segs.length; i++) {
      const lower = segs[i].limb as LimbRecord;
      add(segs[i - 1].name, segs[i].name, `config.limbs.${limb} segment ${lower.segment}${lower.joint === undefined ? '' : `, joint "${lower.joint}"`}`);
    }
  }
  for (const r of seams) add(r.part, r.neighbour, `requirement "${r.name}" (seam)`);
  return out;
}

/** A frame's opening of one kind over the floor ({@link MOTION_SEAM_FLOOR}): more cells than its box, in cells, is long. */
export function openingOverFloor(hit: { px: number; cell: number; box: readonly [number, number, number, number] }): boolean {
  const long = Math.round(Math.max(hit.box[2] - hit.box[0], hit.box[3] - hit.box[1]) / hit.cell);
  return hit.px > long;
}

/** Frame indices as runs, `[0-6, 8, 13]`: the form rigc prints a frame list in. */
export function frameRuns(frames: readonly number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < frames.length; ) {
    let j = i;
    while (j + 1 < frames.length && frames[j + 1] === frames[j] + 1) j++;
    runs.push(i === j ? String(frames[i]) : `${frames[i]}-${frames[j]}`);
    i = j + 1;
  }
  return `[${runs.join(', ')}]`;
}

/**
 * A planted defect, for the suite's mutants only (`SO` controls in `selftest.ts`). Every caller in `src/` passes none.
 */
export interface MotionSeamPlant {
  /** Report every frame rigc names open, the one-cell cracks included: the floor removed. */
  noFloor?: true;
  /** Print the line's head and none of its WARN lines: the warning suppressed. */
  silent?: true;
}

type SeamHitRead = { index: number; px: number; cell: number; box: [number, number, number, number] };

/**
 * The rows of one `rigc render --seam` run over every animation: `frames.json`
 * names each set's directory, each `seam.json` (`rigc-seam/1`) its pairs in
 * the flag's order. Refuses (`FRAMES_SIDECAR`), every problem at once, a set or
 * file that is missing, a file that is not the animation's or not at the rate
 * asked, a pair out of the flag's order, and a field of the wrong shape.
 */
export function readMotionSeams(dir: string, animations: readonly string[], fps: number, pairs: readonly MotionSeamPair[], plant: MotionSeamPlant = {}): MotionSeamRow[] {
  const problems: Problem[] = [];
  const bad = (object: string, detail: string): void => {
    problems.push({ code: 'FRAMES_SIDECAR', object, detail });
  };
  const rows: MotionSeamRow[] = [];
  const sidecar = readJson(join(dir, 'frames.json'), problems);
  const sets = sidecar !== null && Array.isArray(sidecar.sets) ? sidecar.sets.filter(isRecord) : [];
  const nums = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number');
  const hitOf = (h: unknown): SeamHitRead | null =>
    isRecord(h) && typeof h.index === 'number' && typeof h.px === 'number' && typeof h.cell === 'number' && h.cell > 0 && nums(h.box) && h.box.length === 4 ? { index: h.index, px: h.px, cell: h.cell, box: [h.box[0], h.box[1], h.box[2], h.box[3]] } : null;
  for (const animation of animations) {
    const set = sets.find((x) => x.animation === animation);
    if (set === undefined || typeof set.dir !== 'string') {
      bad(join(dir, 'frames.json'), `names no frame set for animation ${JSON.stringify(animation)}; \`rigc render --seam\` over the build writes one per animation`);
      continue;
    }
    const path = join(dir, set.dir, SEAM_READING_FILE);
    const file = readJson(path, problems);
    if (file === null) continue;
    if (file.spec !== SEAM_READING_SPEC) bad(path, `spec is ${JSON.stringify(file.spec)}; "${SEAM_READING_SPEC}" is required`);
    if (file.animation !== animation) bad(path, `animation is ${JSON.stringify(file.animation)}; ${JSON.stringify(animation)} is required`);
    if (file.fps !== fps) bad(path, `fps is ${JSON.stringify(file.fps)}; ${fps}, the rate asked for, is required`);
    const read = Array.isArray(file.pairs) ? file.pairs : [];
    if (read.length !== pairs.length) bad(path, `holds ${read.length} pair(s); the ${pairs.length} asked for, in the flag's order, are required`);
    pairs.forEach((want, i) => {
      const p = read[i];
      const at = `${path} pairs[${i}]`;
      if (!isRecord(p) || p.a !== want.a || p.b !== want.b) {
        bad(at, `is ${JSON.stringify(isRecord(p) ? `${String(p.a)}|${String(p.b)}` : p)}; "${want.pair}", the flag's entry ${i}, is required`);
        return;
      }
      if ((p.status !== 'read' && p.status !== 'skip') || typeof p.drawn !== 'number' || typeof p.banded !== 'number' || !nums(p.opens)) {
        bad(at, 'is not { a, b, drawn, banded, status, opens, maxPx, gap, ghost } as rigc-seam/1 writes it');
        return;
      }
      const over = new Map<number, number>();
      for (const kind of ['gap', 'ghost'] as const) {
        const k = p[kind];
        const frames = isRecord(k) && Array.isArray(k.frames) ? k.frames.map(hitOf) : null;
        if (frames === null || frames.some((h) => h === null)) {
          bad(`${at} ${kind}`, 'is not { frames: [{ index, px, cell, box }…], spans, worst } as rigc-seam/1 writes it');
          return;
        }
        for (const h of frames as SeamHitRead[]) if (plant.noFloor === true || openingOverFloor(h)) over.set(h.index, Math.max(over.get(h.index) ?? 0, h.px));
      }
      const opens = [...over.keys()].sort((x, y) => x - y);
      rows.push({
        pair: want.pair,
        animation,
        status: p.status,
        drawn: p.drawn,
        banded: p.banded,
        opens,
        px: opens.map((f) => over.get(f) ?? 0),
        max_px: opens.reduce((m, f) => Math.max(m, over.get(f) ?? 0), 0),
        under_floor: p.opens.filter((f) => !over.has(f)),
      });
    });
  }
  refuseIfAny(problems);
  return rows;
}

/** The line from its rows: WARN when a row has a frame over the floor, CLEAR when none has, SKIP when no row was read. */
export function motionSeamLine(pairs: MotionSeamPair[], animations: string[], fps: number, rows: MotionSeamRow[], reason?: string): MotionSeamLine {
  const warnings = rows.filter((r) => r.opens.length > 0).length;
  const read = rows.some((r) => r.status === 'read');
  const skipWhy =
    reason ??
    (read
      ? undefined
      : pairs.every((p) => p.unread !== undefined)
        ? `no declared pair is read: ${pairs.map((p) => `"${p.pair}" ${String(p.unread)}`).join('; ')}`
        : `rigc read no band on any frame of any declared pair in any animation — nothing measured, which is not a seam that held`);
  return {
    status: skipWhy !== undefined ? 'SKIP' : warnings > 0 ? 'WARN' : 'CLEAR',
    ...(skipWhy === undefined ? {} : { reason: skipWhy }),
    fps,
    floor: MOTION_SEAM_FLOOR,
    pairs,
    animations,
    warnings,
    rows,
  };
}

/** One warning as the console prints it (issue #493's form, the floor's clause after it). */
export function motionSeamWarnText(r: MotionSeamRow): string {
  return `WARN seam "${r.pair}" opens on ${r.opens.length} frame(s) ${frameRuns(r.opens)} max ${r.max_px} px in "${r.animation}" — over the one-cell floor${r.under_floor.length === 0 ? '' : `, ${r.under_floor.length} more frame(s) one cell thick not reported`}`;
}

// ---------------------------------------------------------------------------
// cloth that comes to rest on the idle (issue #501; the line is {@link CLOTH_LINE}'s)
// ---------------------------------------------------------------------------

/**
 * `CLOTH_SETTLES` (issue #501): every physics chain read by its tip on the
 * idle as `check` renders it (physics on, rigc's default environment) — a
 * **warning, never a bar**. The owner's ruling: cloth at rest while the
 * character stands can be intended, so the line names the chain, the time its
 * tip comes to rest and the floor, and moves neither the exit status nor
 * `check: PASS`; the summary counts it apart from the bars.
 *
 * Why it exists: `CHAIN_LAG` reads the idle's keyed chains off `motion.json`
 * and `TIP_OVER_ROOT` the idle's posed parts, and neither reads what a
 * physics constraint does with a chain nothing above it moves. A skirt hung
 * from `hip` under an idle that keys only the breath is pushed by rigc's
 * reset at frame 0 and then comes to rest, and every bar passes.
 *
 * A chain is a physics leaf — a bone carrying a physics constraint (rig.json's
 * `constraints` or motion.json's `physics`) with no such bone under it — and
 * the physics bones above it, as far as the run of them goes. Its tip is the
 * leaf's end (origin plus `length` along its world x axis), or its origin when
 * the leaf has no length. Its speed between two frames is the tip's distance
 * over their time; it **settles** at the first frame from which every speed
 * to the idle's last frame is under {@link CLOTH_SETTLE_FLOOR}, and the line
 * warns when one does — that is, before the loop's length is out.
 */
export const CLOTH_LINE = 'CLOTH_SETTLES';

/**
 * The floor, rig px per second — half the slowest tip a keyed bone drives on
 * the public examples, the repository's floor rule (half the weaker figure).
 * Measured for issue #501 with this port's build of each example (rig-c
 * 2.60.0, `check`'s idle at 12 fps, physics on): over the 31 physics chains an
 * idle key drives — a keyed bone at or above the leaf (`demo` 12,
 * `reference-sample` 1, `scarf` 11, `wind` 7) — the slowest frame-to-frame tip
 * speed is `scarf`'s `skirt_l2`, 0.03388; the ten no key drives (`wind`'s
 * skirt, its eight trees and its swing, and `reference-sample`'s `hip_jiggle`)
 * fall under half of it, from 0 s (`hip_jiggle`, which never moves) to 2.75 s
 * on a 3.333 s idle, and end at 0.0025 rig px/s or less. `reference-demo`
 * declares no physics constraint.
 */
export const CLOTH_SETTLE_FLOOR = 0.01694;

/** The floor as the console and `check.json` state it. */
export const CLOTH_FLOOR_TEXT = `a chain settles at the first frame from which its tip moves slower than ${CLOTH_SETTLE_FLOOR} rig px/s to the idle's last frame — half the slowest tip an idle key drives on the public examples (scarf's skirt_l2, 0.03388 rig px/s)`;

/** The consumer's two levers, as the console and `check.json` state them. */
export const CLOTH_LEVERS_TEXT = "a chain at rest moves again when the world or the body does: an environment at render (rigc render --environment, wind and gravity in time; AUTHORING §3, What moves them, has a worked schedule) or a consumer's animation that moves the bone it hangs from; the drafted idle keys no hip (rig-c/parts#502)";

/** One physics chain as the line reads it. */
export interface ClothRow {
  /** The leaf: the physics bone with no physics bone under it. */
  tip: string;
  /** The topmost physics bone of the run the leaf ends. */
  root: string;
  /** Physics bones from root to tip. */
  links: number;
  /** What was tracked: the leaf's end, or its origin when it has no `length`. */
  point: 'end' | 'origin';
  /** The time of the frame from which the tip stays under the floor; null when it never does. */
  settles_at: number | null;
  /** The fastest and slowest frame-to-frame speeds of the point, rig px/s, four significant figures. */
  max_rig_px_per_s: number;
  min_rig_px_per_s: number;
}

/** The line: `WARN` with a chain that settles, `CLEAR` with none, `SKIP` with no chain or no idle. */
export interface ClothLine {
  status: 'WARN' | 'CLEAR' | 'SKIP';
  reason?: string;
  fps: number;
  frames: number;
  duration: number;
  floor_rig_px_per_s: number;
  floor: string;
  levers: string;
  /** Rows that settle: the WARN lines. */
  warnings: number;
  rows: ClothRow[];
}

/**
 * The physics chains of a rig, leaf by leaf in rig.json's bone order: each
 * bone a physics constraint names with no such bone under it, and how far up
 * the run of physics bones above it goes.
 */
export function clothChains(rig: Record<string, unknown>, physics: readonly LoopPhysics[]): Array<{ tip: string; root: string; links: number; length: number }> {
  const bones = (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord);
  const parent = new Map(bones.map((b) => [String(b.name), typeof b.parent === 'string' ? b.parent : null]));
  const length = new Map(bones.map((b) => [String(b.name), typeof b.length === 'number' && Number.isFinite(b.length) ? b.length : 0]));
  const held = new Set(physics.map((p) => p.bone));
  const above = (b: string, a: string): boolean => {
    const seen = new Set<string>();
    for (let p = parent.get(b) ?? null; p !== null && !seen.has(p); p = parent.get(p) ?? null) {
      if (p === a) return true;
      seen.add(p);
    }
    return false;
  };
  const out: Array<{ tip: string; root: string; links: number; length: number }> = [];
  for (const b of bones.map((x) => String(x.name))) {
    if (!held.has(b) || [...held].some((o) => o !== b && above(o, b))) continue;
    let root = b;
    let links = 1;
    for (let p = parent.get(b) ?? null; p !== null && held.has(p); p = parent.get(p) ?? null) {
      root = p;
      links++;
    }
    out.push({ tip: b, root, links, length: length.get(b) ?? 0 });
  }
  return out;
}

/** One chain's row off its leaf's bone track: the point, the speeds, and when it settles under the floor. */
export function clothRow(chain: { tip: string; root: string; links: number; length: number }, track: BoneTrack, floor: number = CLOTH_SETTLE_FLOOR): ClothRow {
  const L = chain.length;
  const pts = track.frames.map((w) => [w.worldX + L * w.a, w.worldY + L * w.c]);
  const speeds: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const dt = track.times[i] - track.times[i - 1];
    speeds.push(dt > 0 ? edgeLength(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) / dt : Infinity);
  }
  let s = speeds.length;
  while (s > 0 && speeds[s - 1] < floor) s--;
  return {
    tip: chain.tip,
    root: chain.root,
    links: chain.links,
    point: L > 0 ? 'end' : 'origin',
    settles_at: speeds.length > 0 && s < speeds.length ? round3(track.times[s]) : null,
    max_rig_px_per_s: speeds.length === 0 ? 0 : sig4(Math.max(...speeds)),
    min_rig_px_per_s: speeds.length === 0 ? 0 : sig4(Math.min(...speeds)),
  };
}

/** The line from its rows: WARN when a chain settles, CLEAR when none does, SKIP with the reason when nothing was read. */
export function clothLine(rows: ClothRow[], fps: number, frames: number, duration: number, reason?: string): ClothLine {
  const warnings = rows.filter((r) => r.settles_at !== null).length;
  return {
    status: reason !== undefined ? 'SKIP' : warnings > 0 ? 'WARN' : 'CLEAR',
    ...(reason === undefined ? {} : { reason }),
    fps,
    frames,
    duration: round3(duration),
    floor_rig_px_per_s: CLOTH_SETTLE_FLOOR,
    floor: CLOTH_FLOOR_TEXT,
    levers: CLOTH_LEVERS_TEXT,
    warnings,
    rows,
  };
}

/** One warning as the console prints it. */
export function clothWarnText(r: ClothRow, duration: number): string {
  const chain = r.links === 1 ? `"${r.tip}"` : `"${r.root}" .. "${r.tip}"`;
  return `WARN chain ${chain} (${r.links} physics link(s)) settles at ${r.settles_at ?? ''} s of the ${round3(duration)} s idle — its tip's ${r.point} under ${CLOTH_SETTLE_FLOOR} rig px/s from there to the last frame (fastest on the idle ${r.max_rig_px_per_s} rig px/s)`;
}

/**
 * One `CHECK_RIGC_GREEN` per line that says why `rigc <what>` was not green:
 * its FAIL and compile-error lines, or, when there are none, {@link causeLines}.
 * A run that printed nothing is still one problem, never none.
 */
export function rigcFailed(what: string, call: RigcCall, lines: readonly string[]): Problem[] {
  const named = lines.filter((l) => l.includes('FAIL') || l.includes('compile error'));
  const quoted = named.length > 0 ? named.map((l) => l.trim()) : causeLines(call.out);
  const object = `\`rigc ${what}\``;
  const ran = rigcRanClause(call);
  if (quoted.length === 0) return [{ code: 'CHECK_RIGC_GREEN', object, detail: `exit ${call.status}, and it printed nothing${ran}` }];
  return quoted.map((l) => ({ code: 'CHECK_RIGC_GREEN', object, detail: `exit ${call.status}: ${l}${ran}` }));
}

// ---------------------------------------------------------------------------
// the world the readings are taken in (issue #538)
// ---------------------------------------------------------------------------

/** The refusal of a schedule `check --environment` names: rigc's reader's sentence, or rigc render's, verbatim. */
export const ENVIRONMENT_RULE = 'CHECK_ENVIRONMENT';

/** What `check.json` records of the schedule under `--environment`: provenance, not a bar. */
export interface CheckEnvironment {
  /** The path as the command line gave it — never resolved, so the record holds no directory the caller did not type. */
  path: string;
  /** The sha256 of the file's bytes as read, the bytes rigc's reader read. */
  sha256: string;
  /** How many steps rigc's reader read off it. */
  steps: number;
}

function environmentRefused(given: string, sentence: string): PartsError {
  return new PartsError([{ code: ENVIRONMENT_RULE, object: given, detail: sentence }]);
}

/**
 * `--environment <file>` read once, before anything is built (issue #538): the file's bytes hashed and handed to
 * rig-c's own reader, `readEnvironmentSchedule` (`rig-c/src/environment.ts`), which refuses every malformed schedule
 * — a `spec` other than {@link ENVIRONMENT_SPEC}, a key it does not read, no step, a `t` that is not finite, at or
 * above 0 and after the step before, a `wind` or `gravity` that is not a pair of finite numbers, a step that changes
 * nothing — by entry, field, the value found and the value required. Nothing here reads the schedule's meaning: its
 * sentence is carried as {@link ENVIRONMENT_RULE}'s detail, verbatim, and a path with no file at it is worded as
 * `rigc render --environment` words it. What a well-formed schedule cannot do to this rig — move a rig with no
 * physics constraint, change a half no constraint answers, fall after the last frame drawn — is rigc render's to
 * refuse, and {@link runCheck} carries that sentence the same way.
 */
export function readCheckEnvironment(given: string): CheckEnvironment {
  const path = resolve(given);
  if (!existsSync(path) || !statSync(path).isFile()) throw environmentRefused(given, `--environment ${given}: nothing at ${path} — it takes a schedule file { "spec": "${ENVIRONMENT_SPEC}", "steps": [...] }`);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (err) {
    throw environmentRefused(given, `--environment ${given}: not readable — ${(err as Error).message}`);
  }
  try {
    const steps = readEnvironmentSchedule(bytes.toString('utf8'), given);
    return { path: given, sha256: createHash('sha256').update(bytes).digest('hex'), steps: steps.length };
  } catch (err) {
    if (err instanceof EnvironmentError) throw environmentRefused(given, err.message);
    throw err;
  }
}

/** The line `check` prints under `--environment`, beside rigc's identity: which schedule, by path and digest, and which renders it poses. */
export function environmentLine(env: CheckEnvironment): string {
  return `environment: ${env.path}, ${ENVIRONMENT_SPEC}, ${env.steps} step(s), sha256 ${env.sha256.slice(0, 16)} — every render a bar or a warning reads with the physics on is posed under it; the physics-off, setup-pose and loop renders are not`;
}

/**
 * Run the whole check. Refuses (throws a PartsError) when the inputs are
 * unreadable or a rigc step that everything after it depends on is red — the
 * gate file is written first, so the refusal's evidence is on disk. Otherwise
 * it measures everything it can read, writes every output including
 * `check.json`, and returns the report; `report.problems` names each bar that
 * was not met, and `figures.PASS` is true exactly when it is empty. `mode`
 * reaches rigc's `--page-edges` and `--pack-shape` verbatim, a pack line that
 * disagrees with either is refused (`CHECK_PACK_PAGE_EDGES`,
 * `CHECK_PACK_SHAPE`), and `check.json` records it as `pack_mode`.
 *
 * What it can read (issue #77): the gate always runs, on whatever the spec
 * declares. Without `parts.json` ({@link readCheckInputs}) the seam, the four
 * judgement lines that choose regions by tag and `RECOMPOSITE_HOLES` say SKIP
 * with the reason; without an `idle` the loop and every line that reads idle
 * frames say SKIP, and no idle is rendered (no `idle_frames/`, `contact.png`
 * or `motion_heat.png`). `source` (`--source`) adds {@link SOURCE_LINE}.
 *
 * `requirements` (`--requirements`, issue #93) is read with the rig directory
 * and resolved against it before anything is built ({@link readRequirements},
 * {@link resolveRequirements}); after every line above, each declared
 * requirement is measured ({@link measureRequirements}) into `requirements/`,
 * `check.json` gains its `requirements` block, and every FAIL and NOT
 * MEASURABLE is a problem. Without it nothing here reads, writes or prints
 * anything it did not before.
 */
export function runCheck(rigDir: string, outDir: string, rigc: RigcRunner, partsHome?: string, mode: PackMode = DEFAULT_PACK_MODE, source?: string, requirements?: string, seamPairsAsked = false, keepStills = false, set?: string, allSets = false, environment?: string): CheckReport {
  let inp: CheckInputs;
  let reqFile: RequirementsFile | null = null;
  let seams: Map<string, SeamPair[]> | null = null;
  // Every reader collects every problem; one refusal names every set.
  const refused: Problem[] = [];
  const take = <T>(read: () => T): T | null => {
    try {
      return read();
    } catch (err) {
      if (!(err instanceof PartsError)) throw err;
      refused.push(...err.problems);
      return null;
    }
  };
  // Issue #538: the schedule is read once, first, by rigc's own reader; refused, nothing is built or written.
  const env = environment === undefined ? null : take(() => readCheckEnvironment(environment));
  if (requirements === undefined) {
    const got = take(() => readCheckInputs(rigDir, partsHome, source, set, allSets));
    refuseIfAny(refused);
    inp = got as CheckInputs;
  } else {
    const got = take(() => readCheckInputs(rigDir, partsHome, source, set, allSets));
    reqFile = take(() => readRequirements(requirements));
    refuseIfAny(refused);
    inp = got as CheckInputs;
    const file = reqFile as RequirementsFile;
    const ready = inp;
    take(() => resolveRequirements(file, ready.rig, ready.motion, ready.rootBone));
    take(() => refuseIfAny(exceptionProblems(file, ready.parts, ready.noParts)));
    // A seam's pairs are read off parts.json's art (issue #111); both resolvers' problems are named in one refusal.
    if (file.requirements.some((r) => r.kind === 'seam')) {
      const parts = ready.parts;
      seams = take(() => resolveSeams(file, parts === null ? null : parts.parts.map((p) => p.name), ready.noParts, (n) => {
        const rec = (parts as PartsFile).parts.find((p) => p.name === n) as PartRecord;
        return placedArt(rec.x, rec.y, readPng(join(ready.partsDir, `${n}.png`)));
      }));
    }
    refuseIfAny(refused);
  }
  // Issue #538: a motion with no animation gives check no render a schedule could pose — every frame it reads would be
  // the setup still's — so the flag is refused rather than recorded over readings it did not move.
  if (env !== null && !(isRecord(inp.motion.animations) && Object.keys(inp.motion.animations).length > 0)) {
    throw environmentRefused(env.path, `${inp.motionPath} holds no animation, so check renders no frame a schedule could pose — the setup-pose stills take none; rigc render reads a schedule only over an animation's frames`);
  }
  const rigcEntry = readRigcEntry(requireRigcVersion(rigc));
  /**
   * Issue #538: a render whose frames a bar or a warning reads, with the physics on — posed under the schedule when
   * `--environment` names one (the path as given; rigc reads the file the same way). A refusal rigc render prints of
   * the schedule against this rig (its `--environment <path>:` line) is carried as {@link ENVIRONMENT_RULE}, verbatim;
   * any other failure is the call site's to name. Without the flag it is `rigc`, and no argument moves.
   */
  const measured: RigcRunner =
    env === null
      ? rigc
      : (args) => {
          const call = rigc([...args, '--environment', env.path]);
          if (call.status !== 0) {
            const said = call.out.split('\n').map((l) => l.trim()).find((l) => l.startsWith(`rigc: --environment ${env.path}: `));
            if (said !== undefined) throw environmentRefused(env.path, `${said.slice('rigc: '.length)}${rigcRanClause(call)}`);
          }
          return call;
        };
  const out = resolve(outDir);
  mkdirSync(out, { recursive: true });
  const buildDir = join(out, 'build');
  const idleDir = join(out, 'idle_frames');
  const stillDir = join(out, '_still');
  const isoDir = join(out, '_isolated');
  const loopDir = join(out, '_loop');
  const seamDir = join(out, SEAM_DIR);
  const keptDir = join(out, STILL_DIR);
  const foldDir = join(out, FOLD_SCRATCH);
  for (const d of [buildDir, idleDir, stillDir, isoDir, loopDir, seamDir, keptDir, foldDir]) rmSync(d, { recursive: true, force: true });
  const written: string[] = [];
  const write = (name: string, data: string): void => {
    writeFileSync(join(out, name), data);
    written.push(name);
  };

  // 1. build, packed, under the policy profile
  const build = rigc(['build', '--rig', inp.rigPath, '--motion', inp.motionPath, '--out', buildDir, ...packedBuildArgs(mode)]);
  const gateHtml = buildGateLines(build.out);
  write('gate_spine-html.txt', `${gateHtml.join('\n')}\n`);
  if (build.status !== 0) refuseIfAny(rigcFailed(packedBuildLabel(mode), build, gateHtml));
  const pack = parsePackLines(gateHtml);
  refuseIfAny(packEdgeProblems(pack, mode));
  const packOpaque = pack.filter((p) => existsSync(join(buildDir, p.page))).map((p) => ({ page: p.page, share: opaqueShare(readPng(join(buildDir, p.page))) }));

  // 2. no second gate: `rigc validate --profile spine` of this build measured no rule the build's own two passes
  // had not (14 of the build's 23 on the demo, rigc 1.5.1 and 2.0.3 alike; selftest CH09 holds it), and on rigc's
  // core entry — an install without spine-core — `validate` is refused outright
  const htmlGreen = gateGreen(build.status, gateHtml);

  // What each line reads, and why it cannot when it cannot (issue #77).
  const full: FullInputs | null = inp.parts !== null && inp.idleDuration !== null ? { ...inp, parts: inp.parts, idleDuration: inp.idleDuration } : null;
  const lacking = [inp.noParts, inp.noIdle].filter((r): r is string => r !== null).join('; ');
  const problems: Problem[] = [];

  // 3. the idle, the loop, the heat — only when there is an idle
  let idle: FrameSet | null = null;
  let loop: { max: number; x: number; y: number } | null = null;
  let loopSet: FrameSet | null = null;
  let loopPhysics: LoopPhysics[] | null = null;
  // The keyed build (issues #183, #320): with a physics constraint, the same rig and motion with every one left out,
  // built once the same way, which the loop and the folds of every animation are both read from.
  const stripped = withoutPhysics(inp.rig, inp.motion);
  let keyed: string | null = null;
  const keyedBuild = (what: string): string => {
    if (stripped === null) return buildDir;
    if (keyed !== null) return keyed;
    mkdirSync(loopDir, { recursive: true });
    const images = typeof inp.rig.images === 'string' ? resolve(inp.rigDir, inp.rig.images) : inp.rig.images;
    writeFileSync(join(loopDir, 'rig.json'), JSON.stringify({ ...stripped.rig, images }));
    writeFileSync(join(loopDir, 'motion.json'), JSON.stringify(stripped.motion));
    const lb = rigc(['build', '--rig', join(loopDir, 'rig.json'), '--motion', join(loopDir, 'motion.json'), '--out', join(loopDir, 'build'), ...packedBuildArgs(mode)]);
    if (lb.status !== 0) refuseIfAny(rigcFailed(`${packedBuildLabel(mode)} (${what})`, lb, buildGateLines(lb.out)));
    keyed = join(loopDir, 'build');
    return keyed;
  };
  const animationNames = isRecord(inp.motion.animations) ? Object.keys(inp.motion.animations) : [];
  const named = animationNames.filter((n) => n !== 'idle');
  let folds: FoldsLine | null = null;
  const foldProblems: Problem[] = [];
  // Issue #348: the feet the level line reads, off parts.json and rig.json; none, and nothing below moves.
  const feet = inp.parts === null ? [] : levelFeet(inp.parts, inp.rig);
  let level: LevelLine | null = null;
  // Issue #349: the limb parts' bones, off rig.json and parts.json; none, and nothing is written.
  const limbProblems: Problem[] = [];
  const limbs = inp.parts === null ? null : limbLine(inp.parts, inp.rig, limbProblems);
  const levelProblems: Problem[] = [];
  try {
    if (inp.idleDuration !== null) {
      const render = measured(['render', '--candidate', buildDir, '--animation', 'idle', '--fps', String(IDLE_FPS), '--max', String(IDLE_MAX_PX), '--geometry', '--out', idleDir]);
      if (render.status !== 0) refuseIfAny(rigcFailed('render --animation idle --geometry', render, render.out.split('\n').filter((l) => l.includes('FAIL') || l.includes('rigc:'))));
      idle = readFrameSet(idleDir);
      const last = idle.frames[idle.frames.length - 1];
      // Issue #244: the last frame's time and the duration are compared within TIME_SLACK, not with `!==` — a whole
      // number of frames (40/12 s) is not exact in binary, and rigc writes its last frame at 40 * (1/12), one ulp off.
      if (idle.stride !== 1 || idle.written !== idle.sampled || Math.abs(idle.duration - inp.idleDuration) > TIME_SLACK || last.index !== idle.sampled - 1) {
        refuseIfAny([
          {
            code: 'CHECK_LOOP_LAST_FRAME_AT_DURATION',
            object: `idle frame ${last.name}`,
            detail: `rigc sampled ${idle.sampled} frame(s), wrote ${idle.written} at stride ${idle.stride}, the last at t = ${idle.duration}s; the loop compares frame 0 with the frame at the idle's duration, ${inp.idleDuration}s, so a duration that is a whole number of 1/${IDLE_FPS} s ticks (within ${TIME_SLACK} s) and every frame written are required`,
          },
        ]);
      }
      const contact = join(idle.dir, 'contact.png');
      if (existsSync(contact)) {
        copyFileSync(contact, join(out, 'contact.png'));
        written.push('contact.png');
      }
      loop = maxRgbDiff(idle.frames[0].image, last.image);
      loopSet = idle;
      // The keyed loop (issue #183): with a physics constraint, the same rig and motion with every one left out, built
      // the same way and rendered the same way, is what frame 0 and the frame at the duration are read from.
      if (stripped !== null) {
        loopPhysics = stripped.physics;
        const what = 'the idle with its physics constraint(s) left out';
        const lr = rigc(['render', '--candidate', keyedBuild(what), '--animation', 'idle', '--fps', String(IDLE_FPS), '--max', String(IDLE_MAX_PX), '--out', join(loopDir, 'frames')]);
        if (lr.status !== 0) refuseIfAny(rigcFailed(`render --animation idle (${what})`, lr, lr.out.split('\n').filter((l) => l.includes('FAIL') || l.includes('rigc:'))));
        const kept = readFrameSet(join(loopDir, 'frames'));
        const keptLast = kept.frames[kept.frames.length - 1];
        if (kept.stride !== 1 || kept.written !== kept.sampled || keptLast.index !== last.index) {
          refuseIfAny([
            {
              code: 'CHECK_LOOP_LAST_FRAME_AT_DURATION',
              object: `idle frame ${keptLast.name} (${what})`,
              detail: `rigc sampled ${kept.sampled} frame(s), wrote ${kept.written} at stride ${kept.stride}; the idle as written ends at ${last.name}, and the loop compares frame 0 with that frame`,
            },
          ]);
        }
        loop = maxRgbDiff(kept.frames[0].image, keptLast.image);
        loopSet = kept;
      }
      const idleImages = idle.frames.map((f) => f.image);
      writePng(join(out, 'motion_heat.png'), motionHeat(idleImages));
      written.push('motion_heat.png');
    }

    // 3a. every animation, the idle included, read for folds by rigc (issues #320, #333, #363) — only when there is one; at
    // the idle's rate whatever --requirements says, so a requirements file moves only what it declares (CK78), with physics on and off
    if (animationNames.length > 0) {
      const fps = IDLE_FPS;
      const checkedAlt = set !== undefined && !allSets && inp.parts !== null ? (inp.parts.alternates ?? []).find((a) => a.name === set) : undefined;
      const subsetFoldSlots =
        checkedAlt !== undefined && checkedAlt.parts !== undefined
          ? new Set<string>([...Object.keys(checkedAlt.slots), ...(checkedAlt.hides ?? [])])
          : null;
      const filterFolds = (map: Map<string, FoldingMesh[]>): Map<string, FoldingMesh[]> => {
        if (subsetFoldSlots === null) return map;
        const filtered = new Map<string, FoldingMesh[]>();
        for (const [anim, list] of map.entries()) {
          filtered.set(anim, list.filter((m) => subsetFoldSlots.has(m.slot)));
        }
        return filtered;
      };
      const mayFoldForRun =
        reqFile === null
          ? []
          : subsetFoldSlots === null
            ? reqFile.may_fold
            : reqFile.may_fold.filter((e) => subsetFoldSlots.has(e.slot));
      try {
        // Issue #348: with a foot to read, the keyed render writes each animation's geometry as well.
        const geometry = feet.length > 0 ? ['--geometry'] : [];
        if (stripped === null) {
          const fr = measured(['render', '--candidate', buildDir, '--folds', ...geometry, '--fps', String(fps), '--max', String(FOLD_RENDER_MAX), '--out', foldDir]);
          if (fr.status !== 0) refuseIfAny(rigcFailed(`render --folds${geometry.map((g) => ` ${g}`).join('')} --fps ${fps}`, fr, fr.out.split('\n').filter((l) => l.includes('FAIL') || l.includes('rigc:'))));
          const readings = filterFolds(readFoldSets(foldDir, animationNames, fps, fr.out));
          folds = foldsLine(animationNames, fps, 0, readings, mayFoldForRun, reqFile === null ? null : reqFile.path, foldProblems, readings, inp.rig, []);
          if (feet.length > 0) {
            const sets = readJson(join(foldDir, 'frames.json'), []);
            const listed = sets !== null && Array.isArray(sets.sets) ? sets.sets.filter(isRecord) : [];
            const levelReadings = animationNames.map((name) => {
              const dir = join(foldDir, String((listed.find((x) => x.animation === name) as Record<string, unknown>).dir));
              return { animation: name, set: readFrameSet(dir), geometryPath: join(dir, GEOMETRY_FILE) };
            });
            level = levelLine(feet, inp.rig, levelReadings, fps, 0, levelProblems);
          }
        } else {
          const onDir = join(foldDir, 'on');
          const offDir = join(foldDir, 'off');
          const frOn = measured(['render', '--candidate', buildDir, '--folds', '--fps', String(fps), '--max', String(FOLD_RENDER_MAX), '--out', onDir]);
          if (frOn.status !== 0) refuseIfAny(rigcFailed(`render --folds --fps ${fps}`, frOn, frOn.out.split('\n').filter((l) => l.includes('FAIL') || l.includes('rigc:'))));
          // The physics-off half takes no schedule (issue #538): its candidate declares no physics constraint, so no
          // world moves it, and rigc render refuses a schedule on it by name.
          const frOff = rigc(['render', '--candidate', keyedBuild('the animations with their physics constraint(s) left out'), '--folds', ...geometry, '--fps', String(fps), '--max', String(FOLD_RENDER_MAX), '--out', offDir]);
          if (frOff.status !== 0) refuseIfAny(rigcFailed(`render --folds${geometry.map((g) => ` ${g}`).join('')} --fps ${fps} (physics constraint(s) left out)`, frOff, frOff.out.split('\n').filter((l) => l.includes('FAIL') || l.includes('rigc:'))));
          const readingsOn = filterFolds(readFoldSets(onDir, animationNames, fps, frOn.out));
          const readingsOff = filterFolds(readFoldSets(offDir, animationNames, fps, frOff.out));
          folds = foldsLine(animationNames, fps, stripped.physics.length, readingsOn, mayFoldForRun, reqFile === null ? null : reqFile.path, foldProblems, readingsOff, inp.rig, stripped.physics);
          if (feet.length > 0) {
            const sets = readJson(join(offDir, 'frames.json'), []);
            const listed = sets !== null && Array.isArray(sets.sets) ? sets.sets.filter(isRecord) : [];
            const levelReadings = animationNames.map((name) => {
              const dir = join(offDir, String((listed.find((x) => x.animation === name) as Record<string, unknown>).dir));
              return { animation: name, set: readFrameSet(dir), geometryPath: join(dir, GEOMETRY_FILE) };
            });
            level = levelLine(feet, inp.rig, levelReadings, fps, stripped.physics.length, levelProblems);
          }
        }
      } finally {
        rmSync(foldDir, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(loopDir, { recursive: true, force: true });
  }

  // 3b. the parts a judgement reads alone: each rendered by its own slots, on the whole rig's grid
  const isolated = (label: string, ps: readonly PartRecord[]): FrameSet => {
    const dir = join(isoDir, label);
    const r = measured(['render', '--candidate', buildDir, '--animation', 'idle', '--fps', String(IDLE_FPS), '--max', String(IDLE_MAX_PX), '--slot', ps.map((p) => p.name).join(','), '--out', dir]);
    if (r.status !== 0) refuseIfAny(rigcFailed(`render --animation idle --slot ${ps.map((p) => p.name).join(',')}`, r, r.out.split('\n').filter((l) => l.includes('FAIL') || l.includes('rigc:'))));
    return readFrameSet(dir);
  };
  // Issue #411: the breath alone — a throwaway copy of the build carrying, beside every animation, the idle with its
  // breath tracks held at rest; the torso rendered alone in both idles, from that one build, so the two share a grid.
  const breathPair = (ps: readonly PartRecord[]): BreathPair | null => {
    const tracks = breathTracks(inp.motion);
    if (tracks.length === 0) return null;
    const dir = join(isoDir, BREATH_SCRATCH);
    const anims = isRecord(inp.motion.animations) ? inp.motion.animations : {};
    const idleAnim = isRecord(anims.idle) ? anims.idle : {};
    let name = BREATH_ANIMATION;
    while (name in anims) name = `${name}_`;
    // Each breath track held at rest over its own span: the idle without the breath, still keyed to its end, which rigc
    // requires of an animation's last key.
    const kept = (Array.isArray(idleAnim.tracks) ? idleAnim.tracks : []).map((t) => (isRecord(t) && isBreathTrack(t, tracks) ? heldTrack(t) : t));
    mkdirSync(dir, { recursive: true });
    const images = typeof inp.rig.images === 'string' ? resolve(inp.rigDir, inp.rig.images) : inp.rig.images;
    writeFileSync(join(dir, 'rig.json'), JSON.stringify({ ...inp.rig, images }));
    writeFileSync(join(dir, 'motion.json'), JSON.stringify({ ...inp.motion, animations: { ...anims, [name]: { ...idleAnim, tracks: kept } } }));
    const b = rigc(['build', '--rig', join(dir, 'rig.json'), '--motion', join(dir, 'motion.json'), '--out', join(dir, 'build'), ...packedBuildArgs(mode)]);
    if (b.status !== 0) refuseIfAny(rigcFailed(`${packedBuildLabel(mode)} (BREATH_VISIBLE's copy, the idle beside it with its breath tracks held at rest)`, b, buildGateLines(b.out)));
    const slots = ps.map((p) => p.name).join(',');
    const render = (animation: string, label: string): FrameSet => {
      const r = measured(['render', '--candidate', join(dir, 'build'), '--animation', animation, '--fps', String(IDLE_FPS), '--max', String(IDLE_MAX_PX), '--slot', slots, '--out', join(dir, label)]);
      if (r.status !== 0) refuseIfAny(rigcFailed(`render --animation ${animation} --slot ${slots} (BREATH_VISIBLE's copy)`, r, r.out.split('\n').filter((l) => l.includes('FAIL') || l.includes('rigc:'))));
      return readFrameSet(join(dir, label));
    };
    return { with: render('idle', 'with'), without: render(name, 'without'), tracks: tracks.map((t) => `${t.bone} ${t.property}`) };
  };
  // Issue #231: the footwear parts the scene file declares not planted; none without --requirements or the field.
  const notPlanted = reqFile === null ? [] : reqFile.not_planted;
  let breath: JudgementLine = skip(lacking);
  let tip: JudgementLine = skip(lacking);
  if (full !== null) {
    try {
      breath = breathLine(full, isolated, breathPair, problems, notPlanted);
      if (idle !== null) tip = tipLine(full, join(idle.dir, GEOMETRY_FILE), idle.written, problems, reqFile === null ? NO_TIP_EXCEPTIONS : { path: reqFile.path, not_swinging: reqFile.not_swinging, rises: reqFile.rises, rests: reqFile.rests });
    } finally {
      rmSync(isoDir, { recursive: true, force: true });
    }
  }
  let chain: JudgementLine = skip(inp.noIdle ?? '');
  let stretch: JudgementLine = skip(inp.noIdle ?? '');
  let still: JudgementLine = skip(lacking);
  let idleGeometry: IdleGeometry | null = null;
  if (idle !== null) {
    chain = chainLine(inp, problems, reqFile === null ? NO_CHAIN_RESTS : { path: reqFile.path, rests: reqFile.rests });
    // One reader for the one geometry file: the stretch reads its meshes, the still regions every slot and the head bone.
    const geometryPath = join(idle.dir, GEOMETRY_FILE);
    const geometry = readGeometry(geometryPath, idle.written);
    idleGeometry = geometry;
    stretch = stretchLine(geometry, geometryPath, problems, inp);
    if (full !== null) still = stillLine(full, idle, geometry, geometryPath, problems, notPlanted);
  }

  // 3c. a sleeve on one chain, its first link turned large (issue #347): a throwaway copy, physics left out, posed by rigc
  let stress: JudgementLine | null = null;
  const stressProblems: Problem[] = [];
  const stressTagged = full === null || idle === null ? [] : partsTagged(full.parts, STRESS_TAGS);
  if (stressTagged.length > 0) {
    const plan = stressPlan(inp.rig, inp.motion, stressTagged);
    const stressDir = join(out, STRESS_SCRATCH);
    rmSync(stressDir, { recursive: true, force: true });
    try {
      if (plan.read.length > 0) {
        mkdirSync(stressDir, { recursive: true });
        const base = stripped === null ? inp.rig : stripped.rig;
        const images = typeof inp.rig.images === 'string' ? resolve(inp.rigDir, inp.rig.images) : inp.rig.images;
        const stressAnims = stressAnimations(plan);
        writeFileSync(join(stressDir, 'rig.json'), JSON.stringify({ ...withoutSliders(base, stressAnims), images }));
        writeFileSync(join(stressDir, 'motion.json'), JSON.stringify({ ...(stripped === null ? inp.motion : stripped.motion), animations: stressAnims }));
        const sb = rigc(['build', '--rig', join(stressDir, 'rig.json'), '--motion', join(stressDir, 'motion.json'), '--out', join(stressDir, 'build'), '--profile', 'spine']);
        if (sb.status !== 0) refuseIfAny(rigcFailed(`build (${STRESS_LINE}'s turned copy)`, sb, buildGateLines(sb.out)));
        const sr = rigc(['render', '--candidate', join(stressDir, 'build'), '--fps', String(IDLE_FPS), '--max', String(FOLD_RENDER_MAX), '--geometry', '--out', join(stressDir, 'render')]);
        if (sr.status !== 0) refuseIfAny(rigcFailed(`render --geometry (${STRESS_LINE}'s turned copy)`, sr, sr.out.split('\n').filter((l) => l.includes('FAIL') || l.includes('rigc:'))));
      }
      const sets = plan.read.length > 0 ? readStressSets(join(stressDir, 'render'), Object.keys(stressAnimations(plan))) : new Map<string, IdleGeometry>();
      stress = stressLine(plan, (a) => sets.get(a) as IdleGeometry, stressProblems);
    } finally {
      rmSync(stressDir, { recursive: true, force: true });
    }
  }

  // 3d. each limb joint with a declared range, bent to its ends and middle (issue #360): a throwaway copy with the
  // joints' own art under the limbs, physics left out, rendered twice by rigc on one grid — none without a range
  let sweep: SweepLine | null = null;
  const sweepProblems: Problem[] = [];
  const joints = inp.parts === null ? [] : sweepJoints(inp.parts);
  if (joints.length > 0) {
    const parts = inp.parts as PartsFile;
    const sweepDir = join(out, SWEEP_SCRATCH);
    rmSync(sweepDir, { recursive: true, force: true });
    try {
      const base = stripped === null ? inp.rig : stripped.rig;
      const slotNames = (Array.isArray(base.slots) ? base.slots : []).filter(isRecord).map((s) => String(s.name));
      const limbSlots = (limb: string): string[] => {
        const mine = new Set(parts.parts.filter((p) => p.limb?.name === limb).map((p) => p.name));
        return slotNames.filter((n) => mine.has(n));
      };
      const pngs = new Map<string, Raster>();
      const png = (name: string): Raster => {
        const hit = pngs.get(name);
        if (hit !== undefined) return hit;
        const r = readPng(join(inp.partsDir, `${name}.png`));
        pngs.set(name, r);
        return r;
      };
      const under = joints.map((j) => sweepUnderlay(parts, png, j));
      const unread = joints.map((j, i) => sweepUnread(j, base, limbSlots(j.limb), under[i].px));
      const imagesFrom = typeof inp.rig.images === 'string' ? resolve(inp.rigDir, inp.rig.images) : null;
      const imagesDir = join(sweepDir, 'images');
      mkdirSync(imagesDir, { recursive: true });
      if (imagesFrom !== null && existsSync(imagesFrom)) cpSync(imagesFrom, imagesDir, { recursive: true });
      const files = new Set(readdirSync(imagesDir).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -'.png'.length)));
      const copy = sweepCopy(base, stripped === null ? inp.motion : stripped.motion, joints, under.map((u, i) => (unread[i] === null ? u : null)), limbSlots, inp.stage, parts.rig_size[1], files);
      const sets = new Map<string, { under: FrameSet; bare: FrameSet }>();
      if (copy.slots.length > 0) {
        for (const [file, image] of copy.images) writePng(join(imagesDir, file), image);
        const sweepAnims = isRecord(copy.motion.animations) ? copy.motion.animations : {};
        writeFileSync(join(sweepDir, 'rig.json'), JSON.stringify({ ...withoutSliders(copy.rig, sweepAnims), images: imagesDir }));
        writeFileSync(join(sweepDir, 'motion.json'), JSON.stringify(copy.motion));
        const sb = rigc(['build', '--rig', join(sweepDir, 'rig.json'), '--motion', join(sweepDir, 'motion.json'), '--out', join(sweepDir, 'build'), '--profile', 'spine']);
        if (sb.status !== 0) refuseIfAny(rigcFailed(`build (${SWEEP_LINE}'s bent copy)`, sb, buildGateLines(sb.out)));
        // The stage is the parts' canvas wherever parts.json is read (CHECK_RIG_STAGE_IS_THE_CANVAS), so this is its longest side, as the setup-pose still's.
        const maxSide = Math.ceil(Math.max(inp.stage.width, inp.stage.height));
        for (const [label, hide] of [['under', []], ['bare', ['--hide', copy.slots.join(',')]]] as const) {
          const r = rigc(['render', '--candidate', join(sweepDir, 'build'), '--fps', String(STILL_FPS), '--max', String(maxSide), ...hide, '--out', join(sweepDir, label)]);
          if (r.status !== 0) refuseIfAny(rigcFailed(`render (${SWEEP_LINE}'s bent copy${hide.length === 0 ? '' : ', the underlays hidden'})`, r, r.out.split('\n').filter((l) => l.includes('FAIL') || l.includes('rigc:'))));
        }
        const named = (label: string, animation: string): FrameSet => {
          const sidecar = join(sweepDir, label, 'frames.json');
          const raw = readJson(sidecar, []);
          const listed = raw !== null && Array.isArray(raw.sets) ? raw.sets.filter(isRecord) : [];
          const s = listed.find((x) => x.animation === animation);
          if (s === undefined || typeof s.dir !== 'string') return sidecarProblem(sidecar, `names no frame set for animation ${JSON.stringify(animation)}; \`rigc render\` over ${SWEEP_LINE}'s bent copy writes one per animation`);
          return readFrameSet(join(sweepDir, label, s.dir));
        };
        joints.forEach((j, i) => {
          if (unread[i] !== null) return;
          for (const a of sweepAngles(j.range)) {
            const name = sweepAnimationName(j.part, a);
            sets.set(name, { under: named('under', name), bare: named('bare', name) });
          }
        });
      }
      sweep = sweepLine(joints, under.map((u) => u.px), unread, (a) => sets.get(a) as { under: FrameSet; bare: FrameSet }, stripped === null ? 0 : stripped.physics.length, sweepProblems);
    } finally {
      rmSync(sweepDir, { recursive: true, force: true });
    }
  }

  // 3e. every declared neighbour pair read in every animation by rigc's seam reading (issue #493): a warning, never a
  // bar — the build as played, at the idle's rate; SKIP, named, with no pair declared or no animation to read
  let motionSeam: MotionSeamLine;
  {
    const fps = IDLE_FPS;
    const seamReqs = reqFile === null || seams === null ? [] : reqFile.requirements.flatMap((r) => (r.kind === 'seam' && seams?.has(r.name) === true ? [{ name: r.name, part: r.part, neighbour: r.neighbour }] : []));
    const pairs = inp.parts === null ? [] : motionSeamPairs(inp.parts, seamReqs);
    const slotNames = new Set((Array.isArray(inp.rig.slots) ? inp.rig.slots : []).filter(isRecord).map((sl) => String(sl.name)));
    for (const p of pairs) {
      const missing = [p.a, p.b].filter((n) => !slotNames.has(n));
      if (missing.length > 0) p.unread = `names ${missing.map((n) => `slot "${n}"`).join(' and ')}, which rig.json does not have`;
    }
    const read = pairs.filter((p) => p.unread === undefined);
    if (inp.parts === null) motionSeam = motionSeamLine([], animationNames, fps, [], inp.noParts ?? 'no parts.json');
    else if (pairs.length === 0) motionSeam = motionSeamLine([], animationNames, fps, [], 'no neighbour pair is declared: parts.json holds no limb segment below a joint (config.limbs) and no --requirements seam names two parts');
    else if (animationNames.length === 0) motionSeam = motionSeamLine(pairs, [], fps, [], 'motion.json holds no animation to read the declared pairs in');
    else if (read.length === 0) motionSeam = motionSeamLine(pairs, animationNames, fps, []);
    else {
      const seamMotionDir = join(out, MOTION_SEAM_SCRATCH);
      rmSync(seamMotionDir, { recursive: true, force: true });
      try {
        const list = read.map((p) => `${p.a}:${p.b}`).join(',');
        const r = measured(['render', '--candidate', buildDir, '--seam', list, '--fps', String(fps), '--max', String(FOLD_RENDER_MAX), '--out', seamMotionDir]);
        if (r.status !== 0) refuseIfAny(rigcFailed(`render --seam ${list} --fps ${fps}`, r, r.out.split('\n').filter((l) => l.includes('FAIL') || l.includes('rigc:'))));
        motionSeam = motionSeamLine(pairs, animationNames, fps, readMotionSeams(seamMotionDir, animationNames, fps, read));
      } finally {
        rmSync(seamMotionDir, { recursive: true, force: true });
      }
    }
  }

  // 3f. every physics chain read by its tip on the idle as rendered above, physics on (issue #501): a warning, never a
  // bar; SKIP, named, with no idle or no physics constraint
  let cloth: ClothLine;
  if (idle === null) cloth = clothLine([], IDLE_FPS, 0, 0, inp.noIdle ?? 'no idle');
  else if (stripped === null) cloth = clothLine([], idle.fps, idle.frames.length, idle.duration, "the rig declares no physics constraint (rig.json's constraints, motion.json's physics), so there is no chain to read");
  else {
    const geometryPath = join(idle.dir, GEOMETRY_FILE);
    const rows: ClothRow[] = [];
    let unread: string | undefined;
    for (const c of clothChains(inp.rig, stripped.physics)) {
      const track = boneTrackOf(idleGeometry, geometryPath, idle, c.tip);
      if (typeof track === 'string') {
        unread = track;
        break;
      }
      rows.push(clothRow(c, track));
    }
    cloth = unread === undefined ? clothLine(rows, idle.fps, idle.frames.length, idle.duration) : clothLine([], idle.fps, idle.frames.length, idle.duration, unread);
  }

  // 4. the setup pose as a one-key throwaway animation — the seam reads it against the parts, the source line against
  // the painting — and, beside it, the same pose with the eyes shut
  let seam: SeamFigures | null = null;
  let seamPairs: SeamPairRow[] | null = null;
  let seamViewport: Viewport | null = null;
  let blink: JudgementLine = skip(lacking);
  let sourceRead: ReportedLine | null = null;
  const setsFigures: Record<string, SetCheckFigures> = {};
  if (inp.parts !== null || inp.source !== null) {
    try {
      mkdirSync(stillDir, { recursive: true });
      const images = typeof inp.rig.images === 'string' ? resolve(inp.rigDir, inp.rig.images) : inp.rig.images;
      const eyes = full === null ? [] : partsTagged(full.parts, EYE_TAGS);
      const slotBone = new Map((Array.isArray(inp.rig.slots) ? inp.rig.slots : []).filter(isRecord).map((sl) => [String(sl.name), String(sl.bone)]));
      const shut = full === null ? [] : blinkTracks(inp.motion, eyeBones(inp.rig, eyes.map((p) => slotBone.get(p.name) ?? '')));
      const animations: Record<string, unknown> = {
        still: { duration: STILL_DURATION, loop: false, tracks: [{ bone: inp.rootBone, property: 'rotate', keys: [{ t: 0, v: [0] }, { t: STILL_DURATION, v: [0] }] }] },
      };
      if (eyes.length > 0 && shut.length > 0) {
        animations[BLINK_ANIMATION] = {
          duration: STILL_DURATION,
          loop: false,
          tracks: shut.map((b) => ({ ...b.target, property: 'scaley', keys: [{ t: 0, v: [b.closed] }, { t: STILL_DURATION, v: [b.closed] }] })),
        };
      }
      const stillRig = { ...withoutSliders(inp.rig, animations), images };
      writeFileSync(join(stillDir, 'rig.json'), JSON.stringify(stillRig));
      writeFileSync(join(stillDir, 'motion.json'), JSON.stringify({ ...inp.motion, animations }));
      const sb = rigc(['build', '--rig', join(stillDir, 'rig.json'), '--motion', join(stillDir, 'motion.json'), '--out', join(stillDir, 'build'), '--profile', 'spine']);
      if (sb.status !== 0) refuseIfAny(rigcFailed('build (the setup-pose still)', sb, buildGateLines(sb.out)));
      // The stage is the parts' canvas wherever parts.json is read (CHECK_RIG_STAGE_IS_THE_CANVAS), so this is its longest side.
      const maxSide = Math.ceil(Math.max(inp.stage.width, inp.stage.height));
      const sr = rigc(['render', '--candidate', join(stillDir, 'build'), '--animation', 'still', '--fps', String(STILL_FPS), '--max', String(maxSide), '--out', join(stillDir, 'render')]);
      if (sr.status !== 0) refuseIfAny(rigcFailed('render (the setup-pose still)', sr, sr.out.split('\n').filter((l) => l.includes('FAIL'))));
      const stillSet = readFrameSet(join(stillDir, 'render'));
      seamViewport = stillSet.viewport;
      if (keepStills) cpSync(join(stillDir, 'render'), keptDir, { recursive: true });
      if (inp.parts !== null) {
        const composite = flatComposite(inp.parts, inp.partsDir, stillSet.background);
        seam = seamFigures(composite, stillSet.frames[0].image, inp.stage, stillSet.viewport, stillSet.background, undefined, inp.parts.scene !== undefined);
        if (seamPairsAsked || seamFails(round3(seam.mean), seam.over40, round6(stillSet.viewport.scale))) {
          const placed = inp.parts.parts.map((p) => ({ name: p.name, from: p.from, x: p.x, y: p.y, image: readPng(join(inp.partsDir, `${p.name}.png`)) }));
          const split = seamPairRows(seam, placed, inp.parts.rig_size, stillSet.viewport);
          mkdirSync(seamDir, { recursive: true });
          for (const { row, pixels } of split) writePng(join(out, row.picture), seamPicture(stillSet.frames[0].image, row, pixels));
          seamPairs = split.map((x) => x.row);
        }
        if (set !== undefined || allSets) {
          const alts = allSets ? (inp.parts.alternates ?? []) : (inp.parts.alternates ?? []).filter((a) => a.name === set);
          const setStillAnimations: Record<string, unknown> = { still: animations.still };
          const setStillBase = { ...withoutSliders(inp.rig, setStillAnimations), images };
          const setsJsonPath = join(inp.rigDir, SETS_FILE);
          const setsJsonRaw = existsSync(setsJsonPath) ? readJson(setsJsonPath, []) : null;
          const setsMap = setsJsonRaw !== null && isRecord(setsJsonRaw.sets) ? setsJsonRaw.sets : null;
          for (const alt of alts) {
            const setEntry: Record<string, unknown> | null =
              setsMap !== null && isRecord(setsMap[alt.name]) ? (setsMap[alt.name] as Record<string, unknown>) : null;
            const setDrawn: Record<string, number> | undefined =
              setEntry !== null && isRecord(setEntry.drawn)
                ? Object.fromEntries(
                    Object.entries(setEntry.drawn).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])),
                  )
                : alt.drawn;
            const setDir = join(stillDir, `set_${alt.name}`);
            mkdirSync(setDir, { recursive: true });
            writeFileSync(join(setDir, 'rig.json'), JSON.stringify(stillRigForSet(setStillBase, alt, setDrawn)));
            writeFileSync(join(setDir, 'motion.json'), JSON.stringify({ ...inp.motion, animations: setStillAnimations }));
            const asb = rigc(['build', '--rig', join(setDir, 'rig.json'), '--motion', join(setDir, 'motion.json'), '--out', join(setDir, 'build'), '--profile', 'spine']);
            if (asb.status !== 0) refuseIfAny(rigcFailed(`build (the setup-pose still of set "${alt.name}")`, asb, buildGateLines(asb.out)));
            const asr = rigc(['render', '--candidate', join(setDir, 'build'), '--animation', 'still', '--fps', String(STILL_FPS), '--max', String(maxSide), '--out', join(setDir, 'render')]);
            if (asr.status !== 0) refuseIfAny(rigcFailed(`render (the setup-pose still of set "${alt.name}")`, asr, asr.out.split('\n').filter((l) => l.includes('FAIL'))));
            const altStillSet = readFrameSet(join(setDir, 'render'));
            if (keepStills) cpSync(join(setDir, 'render'), join(keptDir, alt.name), { recursive: true });
            const altComposite = flatCompositeForSet(inp.parts, alt, inp.partsDir, altStillSet.background);
            const altSeam = seamFigures(altComposite, altStillSet.frames[0].image, inp.stage, altStillSet.viewport, altStillSet.background, undefined, alt.scene !== undefined);
            const altMean = round3(altSeam.mean);
            const altScale = round6(altStillSet.viewport.scale);
            const altFailed = seamFails(altMean, altSeam.over40, altScale);
            let altPairs: SeamPairRow[] | null = null;
            if (seamPairsAsked || altFailed) {
              const hides = new Set(alt.hides ?? []);
              const byName = new Map(alt.records.map((r) => [r.name, r]));
              const placed = inp.parts.parts
                .filter((p) => !hides.has(p.name))
                .map((p) => {
                  const rec = byName.get(p.name);
                  const pngName = rec === undefined ? p.name : `${alt.name}_${rec.name}`;
                  const box = rec ?? p;
                  return { name: p.name, from: box.from, x: box.x, y: box.y, image: readPng(join(inp.partsDir, `${pngName}.png`)) };
                });
              const split = seamPairRows(altSeam, placed, inp.parts.rig_size, altStillSet.viewport);
              const altSeamDir = join(seamDir, alt.name);
              mkdirSync(altSeamDir, { recursive: true });
              for (const { row, pixels } of split) {
                row.picture = `${SEAM_DIR}/${alt.name}/${basename(row.picture)}`;
                writePng(join(out, row.picture), seamPicture(altStillSet.frames[0].image, row, pixels));
              }
              altPairs = split.map((x) => x.row);
            }
            setsFigures[alt.name] = {
              render_px: `${altStillSet.viewport.pixelWidth}x${altStillSet.viewport.pixelHeight}`,
              seam_mean: altMean,
              seam_px_over_40: altSeam.over40,
              seam_px_over_80: altSeam.over80,
              seam_frame_scale: altScale,
              ...(altSeam.border === null ? {} : { seam_border: { frame_px_left_out: altSeam.border.framePx, px_over_40_left_out: altSeam.border.over40 } }),
              ...(altPairs === null ? {} : { seam_pairs: altPairs }),
              RECOMPOSITE_HOLES: altHolesLine(inp.parts, alt),
              PASS: !altFailed,
            };
          }
        }
      }
      if (inp.source !== null) {
        // The same pose with every slot tinted black, built with the same animations so rigc fits the same grid.
        writeFileSync(join(stillDir, BLACK_RIG), JSON.stringify(blackRig(stillRig)));
        const kb = rigc(['build', '--rig', join(stillDir, BLACK_RIG), '--motion', join(stillDir, 'motion.json'), '--out', join(stillDir, 'black_build'), '--profile', 'spine']);
        if (kb.status !== 0) refuseIfAny(rigcFailed('build (the setup-pose still, every slot tinted black)', kb, buildGateLines(kb.out)));
        const kr = rigc(['render', '--candidate', join(stillDir, 'black_build'), '--animation', 'still', '--fps', String(STILL_FPS), '--max', String(maxSide), '--out', join(stillDir, 'black')]);
        if (kr.status !== 0) refuseIfAny(rigcFailed('render (the setup-pose still, every slot tinted black)', kr, kr.out.split('\n').filter((l) => l.includes('FAIL'))));
        const blackSet = readFrameSet(join(stillDir, 'black'));
        if (!sameViewport(stillSet.viewport, blackSet.viewport) || stillSet.background.join(',') !== blackSet.background.join(',')) {
          refuseIfAny([
            {
              code: 'CHECK_SOURCE_GRID',
              object: 'the black-tinted setup-pose still',
              detail: `is on ${JSON.stringify(blackSet.viewport)} over ${JSON.stringify(blackSet.background)}; the setup-pose still is on ${JSON.stringify(stillSet.viewport)} over ${JSON.stringify(stillSet.background)}, and the coverage is read pixel for pixel between the two`,
            },
          ]);
        }
        const srcr = sourceInRig(inp.source.painting, inp.stage.width, inp.stage.height);
        const fig = sourceFigures(stillSet.frames[0].image, blackSet.frames[0].image, stillSet.viewport, stillSet.background, inp.stage, srcr);
        sourceRead = sourceLine(fig, inp.source.painting, inp.stage, stillSet.viewport);
      }
      if (full !== null) {
        const H = full.parts.rig_size[1];
        if (eyes.length === 0) blink = skip(`no part comes from a See-through ${tagWords(EYE_TAGS)} layer, so there is no eye to look behind`);
        else if (shut.length === 0) blink = skip(`no idle "scaley" track on the bones of ${quoteParts(eyes)} goes below its first key, so the idle has no blink`);
        else {
          const br = rigc(['render', '--candidate', join(stillDir, 'build'), '--animation', BLINK_ANIMATION, '--fps', String(STILL_FPS), '--max', String(maxSide), '--out', join(stillDir, 'blink')]);
          if (br.status !== 0) refuseIfAny(rigcFailed(`render (the setup pose with the eyes shut, "${BLINK_ANIMATION}")`, br, br.out.split('\n').filter((l) => l.includes('FAIL'))));
          blink = blinkLine(full, eyes, shut, stillSet, readFrameSet(join(stillDir, 'blink')), idle as FrameSet, H, problems);
        }
      }
    } finally {
      rmSync(stillDir, { recursive: true, force: true });
    }
  }

  // 5. the scene's declared requirements (issue #93), only under --requirements
  const reqProblems: Problem[] = [];
  const reqBlock = reqFile === null ? null : measureRequirements(inp, reqFile, buildDir, out, rigc, reqProblems, seams ?? new Map(), measured);

  const skipped: { loop?: string; seam?: string } = {};
  if (inp.noIdle !== null) skipped.loop = inp.noIdle;
  if (inp.noParts !== null) skipped.seam = inp.noParts;
  const figures: CheckFigures = {
    gate_spine_html_green: htmlGreen,
    rigc_entry: rigcEntry,
    pack_mode: { page_edges: mode.pageEdges, pack_shape: mode.packShape },
    ...(env === null ? {} : { environment: env }),
    loop_max_diff: loop === null ? null : loop.max,
    ...(loopPhysics === null ? {} : { loop_physics: loopPhysics }),
    seam_mean: seam === null ? null : round3(seam.mean),
    seam_px_over_40: seam === null ? null : seam.over40,
    seam_px_over_80: seam === null ? null : seam.over80,
    seam_frame_scale: seam === null || seamViewport === null ? null : round6(seamViewport.scale),
    ...(seam === null || seam.border === null ? {} : { seam_border: { frame_px_left_out: seam.border.framePx, px_over_40_left_out: seam.border.over40 } }),
    ...(seamPairs === null ? {} : { seam_pairs: seamPairs }),
    BREATH_VISIBLE: breath,
    BLINK_NO_HOLE: blink,
    CHAIN_LAG: chain,
    TIP_OVER_ROOT: tip,
    STILL_REGIONS_DARK: still,
    TEXTURE_STRETCH: stretch,
    ...(folds === null ? {} : { [FOLD_LINE]: folds }),
    ...(level === null ? {} : { [LEVEL_LINE]: level }),
    ...(stress === null ? {} : { [STRESS_LINE]: stress }),
    ...(limbs === null ? {} : { [LIMB_LINE]: limbs }),
    ...(sweep === null ? {} : { [SWEEP_LINE]: sweep }),
    ...(motionSeam.pairs.length === 0 ? {} : { [MOTION_SEAM_LINE]: motionSeam }),
    ...(stripped === null || idle === null ? {} : { [CLOTH_LINE]: cloth }),
    RECOMPOSITE_HOLES: inp.parts === null ? { status: 'SKIP', reason: inp.noParts ?? '' } : holesLine(inp.parts),
    ...(sourceRead === null ? {} : { [SOURCE_LINE]: sourceRead }),
    ...(Object.keys(skipped).length === 0 ? {} : { skipped }),
    ...(Object.keys(setsFigures).length === 0 ? {} : { sets: setsFigures }),
    ...(reqBlock === null ? {} : { requirements: reqBlock }),
    PASS: false,
  };
  const barProblems: Problem[] = [];
  if (!htmlGreen) barProblems.push(...rigcFailed(packedBuildLabel(mode), build, gateHtml));
  if (loop !== null && idle !== null && loopSet !== null && loop.max !== LOOP_MAX_BAR) {
    const last = idle.frames[idle.frames.length - 1];
    barProblems.push({
      code: 'CHECK_LOOP_CLOSES',
      object: `idle frame f0000.png vs ${last.name} (t = ${idle.duration}s)${loopPhysics === null ? '' : ', its physics constraint(s) left out'}`,
      detail: `max |d| ${loop.max}/255, first at pixel ${loop.x},${loop.y} of ${loopSet.viewport.pixelWidth}x${loopSet.viewport.pixelHeight}; ${LOOP_MAX_BAR} is required — the idle's last key must equal its first`,
    });
  }
  if (figures.seam_mean !== null && figures.seam_px_over_40 !== null && figures.seam_frame_scale !== null && seamFails(figures.seam_mean, figures.seam_px_over_40, figures.seam_frame_scale)) {
    const worst = seamPairs === null || seamPairs.length === 0 ? null : seamPairs[0];
    barProblems.push({
      code: 'CHECK_SEAM_WITHIN_BAR',
      object: 'the setup-pose render vs the flat composite of parts/',
      detail:
        `mean |d| ${figures.seam_mean}/255 and ${figures.seam_px_over_40} frame px over ${SEAM_PX_LEVEL} (${figures.seam_px_over_80} over ${SEAM_PX_LEVEL_HIGH}) at frame scale ${figures.seam_frame_scale}, ${seamRigPxText(figures.seam_px_over_40, figures.seam_frame_scale)} rig px (the count / s²); mean <= ${SEAM_MEAN_BAR.toFixed(1)} and <= ${SEAM_PX_BAR} rig px over ${SEAM_PX_LEVEL} are required` +
        (worst === null
          ? `; no pixel is over ${SEAM_PX_LEVEL}, so the mean alone fails and there is no pair to name`
          : `; worst of ${(seamPairs as SeamPairRow[]).length} pair(s): ${seamPairText(worst)} — every pair is a \`seam pair\` line above and a row of check.json's seam_pairs`),
    });
  }
  for (const [setName, setFig] of Object.entries(setsFigures)) {
    if (!setFig.PASS) {
      const worst = setFig.seam_pairs === undefined || setFig.seam_pairs.length === 0 ? null : setFig.seam_pairs[0];
      barProblems.push({
        code: 'CHECK_SEAM_WITHIN_BAR',
        object: `the setup-pose render of set "${setName}" vs the flat composite of parts/`,
        detail:
          `mean |d| ${setFig.seam_mean}/255 and ${setFig.seam_px_over_40} frame px over ${SEAM_PX_LEVEL} (${setFig.seam_px_over_80} over ${SEAM_PX_LEVEL_HIGH}) at frame scale ${setFig.seam_frame_scale}, ${seamRigPxText(setFig.seam_px_over_40, setFig.seam_frame_scale)} rig px (the count / s²); mean <= ${SEAM_MEAN_BAR.toFixed(1)} and <= ${SEAM_PX_BAR} rig px over ${SEAM_PX_LEVEL} are required` +
          (worst === null
            ? `; no pixel is over ${SEAM_PX_LEVEL}, so the mean alone fails and there is no pair to name`
            : `; worst of ${(setFig.seam_pairs as SeamPairRow[]).length} pair(s): ${seamPairText(worst)}`),
      });
    }
  }
  const rank = (q: Problem): number => JUDGEMENT_LINES.findIndex((n) => q.code === `CHECK_${n}`);
  problems.sort((a, b) => rank(a) - rank(b));
  problems.unshift(...barProblems);
  problems.push(...foldProblems, ...levelProblems, ...stressProblems, ...limbProblems, ...sweepProblems, ...reqProblems);
  figures.PASS = problems.length === 0;
  write('check.json', `${JSON.stringify(figures, null, 1)}\n`);
  const bars: CheckReport['bars'] = { measured: ['gate'], skipped: [] };
  const tally = (bar: string, reason: string | null): void => {
    if (reason === null) bars.measured.push(bar);
    else bars.skipped.push({ bar, reason });
  };
  tally('loop', skipped.loop ?? null);
  tally('seam', skipped.seam ?? null);
  for (const n of JUDGEMENT_LINES) {
    const l = figures[n];
    tally(n, l.status === 'SKIP' ? l.reason : null);
  }
  // Issues #320, #333: the fold bar is counted where it is written — on every rig whose motion holds an animation.
  if (folds !== null) tally(FOLD_LINE, null);
  // Issue #348: the level bar where it is written; a line whose every foot no frame posed says SKIP and is not measured.
  if (level !== null) tally(LEVEL_LINE, level.status === 'SKIP' ? (level.reason ?? '') : null);
  // Issue #347: the stress bar is counted where it is written — on every rig with a handwear part and an idle.
  if (stress !== null) tally(STRESS_LINE, stress.status === 'SKIP' ? stress.reason : null);
  // Issue #349: the limb bar where it is written; it reads rig.json, so it always measures.
  if (limbs !== null) tally(LIMB_LINE, null);
  // Issue #360: the range bar where it is written; a joint it cannot read fails, so it always measures.
  if (sweep !== null) tally(SWEEP_LINE, null);
  return {
    figures,
    gateHtml,
    pack,
    packOpaque,
    idle: idle === null || loop === null ? null : { frames: idle.frames.length, fps: idle.fps, duration: idle.duration, lastIndex: idle.frames[idle.frames.length - 1].index, loopAt: { x: loop.x, y: loop.y } },
    loopPhysics: loopPhysics === null ? null : loopPhysicsLine(loopPhysics),
    seamViewport,
    bars,
    problems,
    written,
    requirements: reqBlock,
    besideIdle: named,
    motionSeam,
    cloth,
  };
}

// ---------------------------------------------------------------------------
// the scene's declared requirements (issue #93)
// ---------------------------------------------------------------------------

/** Where `check` writes the requirement renders, under `--out`: `as-declared/<animation>/`, `released/<name>/`, `full/<name>/`. */
export const REQUIREMENTS_DIR = 'requirements';

/** The throwaway copies' specs and builds, under `--out`; removed before the stage returns. */
const REQUIREMENTS_SCRATCH = '_requirements';

/**
 * Measure every requirement of a file {@link resolveRequirements} has passed.
 * Every pose is rig-c's: each animation a requirement names is rendered
 * once with `--geometry` at the file's fps, from the rig under test's own
 * build — or, when the file places scene targets for it, from a copy with
 * them written in ({@link placeTargets}, built `--profile spine`, as the setup
 * still is) — into `requirements/as-declared/<animation>/`. Each `follow` adds
 * two copies, released and full ({@link forceMix}), the scene targets placed
 * on both, rendered into `requirements/released/<name>/` and
 * `requirements/full/<name>/`. The released copy's constraint is muted
 * throughout, which rig-c's A47 (ik) or A48 (transform) refuses unless
 * the rig declares the mix consumer-driven: when the gate refuses that copy
 * for that constraint and nothing else ({@link mutedOnly}), the copy — never
 * the rig under test — declares it in `invariants.consumerDrivenMix`, rigc's
 * own door, and the line says so. A copy rigc refuses otherwise is refused,
 * `CHECK_RIGC_GREEN`, quoting rigc. Lines go into the returned block; each
 * FAIL and NOT MEASURABLE into `problems`.
 */
export function measureRequirements(inp: CheckInputs, file: RequirementsFile, buildDir: string, out: string, rigc: RigcRunner, problems: Problem[], seams: ReadonlyMap<string, readonly SeamPair[]> = new Map(), render: RigcRunner = rigc): RequirementsBlock {
  const reqDir = join(out, REQUIREMENTS_DIR);
  const scratch = join(out, REQUIREMENTS_SCRATCH);
  for (const d of [reqDir, scratch]) rmSync(d, { recursive: true, force: true });
  mkdirSync(reqDir, { recursive: true });
  mkdirSync(scratch, { recursive: true });
  const images = typeof inp.rig.images === 'string' ? resolve(inp.rigDir, inp.rig.images) : inp.rig.images;
  const base = { ...inp.rig, images };
  let copies = 0;
  const buildCopy = (rig: Record<string, unknown>, motion: Record<string, unknown>): { dir: string; call: RigcCall } => {
    const dir = join(scratch, `copy${copies++}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'rig.json'), JSON.stringify(rig));
    writeFileSync(join(dir, 'motion.json'), JSON.stringify(motion));
    return { dir: join(dir, 'build'), call: rigc(['build', '--rig', join(dir, 'rig.json'), '--motion', join(dir, 'motion.json'), '--out', join(dir, 'build'), '--profile', 'spine']) };
  };
  const green = (b: { dir: string; call: RigcCall }, what: string): string => {
    if (b.call.status !== 0) refuseIfAny(rigcFailed(`build (${what})`, b.call, buildGateLines(b.call.out)));
    return b.dir;
  };
  const posesOf = (candidate: string, animation: string, dir: string, label: string): { poses: Poses; geo: IdleGeometry; path: string } => {
    const r = render(['render', '--candidate', candidate, '--animation', animation, '--fps', String(file.fps), '--max', String(IDLE_MAX_PX), '--geometry', '--out', dir]);
    if (r.status !== 0) refuseIfAny(rigcFailed(`render --animation ${animation} --geometry (${label})`, r, r.out.split('\n').filter((l) => l.includes('FAIL') || l.includes('rigc:'))));
    const set = readFrameSet(dir);
    if (set.written !== set.sampled || set.stride !== 1) {
      refuseIfAny([{ code: 'CHECK_REQUIREMENTS_FRAMES', object: `${dir} (${label})`, detail: `rigc sampled ${set.sampled} frame(s) and wrote ${set.written} at stride ${set.stride}; every sampled frame is required, since a requirement holds over all of them` }]);
    }
    const path = join(set.dir, GEOMETRY_FILE);
    const geo = readGeometry(path, set.written);
    if (geo === null) return geometryProblem(path, 'does not exist; `rigc render --geometry` writes it, and every requirement is measured from it');
    const cache = new Map<string, { setup: BoneWorld; frames: BoneWorld[] }>();
    const bone = (name: string): { setup: BoneWorld; frames: BoneWorld[] } => {
      const hit = cache.get(name);
      if (hit !== undefined) return hit;
      const t = boneTrackOf(geo, path, set, name);
      if (typeof t === 'string') return geometryProblem(path, t);
      const v = { setup: t.setup, frames: t.frames };
      cache.set(name, v);
      return v;
    };
    const root = boneTrackOf(geo, path, set, inp.rootBone);
    if (typeof root === 'string') return geometryProblem(path, root);
    return { poses: { label, indices: geo.frames.map((f) => f.index), times: root.times, bone }, geo, path };
  };

  const lines: Record<string, RequirementLine> = {};
  try {
    const placed = new Map<string, { rig: Record<string, unknown>; motion: Record<string, unknown> }>();
    const placedFor = (animation: string): { rig: Record<string, unknown>; motion: Record<string, unknown> } => {
      let p = placed.get(animation);
      if (p === undefined) {
        p = placeTargets(base, inp.motion, file.targets, animation, inp.stage);
        placed.set(animation, p);
      }
      return p;
    };
    const declared = new Map<string, { poses: Poses; geo: IdleGeometry; path: string }>();
    for (const r of file.requirements) {
      if (declared.has(r.animation)) continue;
      const scene = file.targets.some((t) => t.animation === r.animation);
      const label = scene ? `as declared, the scene targets of "${r.animation}" placed` : 'as declared';
      const candidate = scene ? green(buildCopy(placedFor(r.animation).rig, placedFor(r.animation).motion), `the rig ${label}`) : buildDir;
      declared.set(r.animation, posesOf(candidate, r.animation, join(reqDir, 'as-declared', r.animation), label));
    }
    for (const r of file.requirements) {
      const d = declared.get(r.animation) as { poses: Poses; geo: IdleGeometry; path: string };
      const scene = placedFor(r.animation);
      const facts = rigFacts(scene.rig, inp.stage);
      let line: RequirementLine;
      if (r.kind === 'contact') line = contactLine(r, d.poses, facts);
      else if (r.kind === 'aim') line = aimLine(r, d.poses, facts);
      else if (r.kind === 'range') line = rangeLine(r, d.poses, facts);
      // Issue #321: the worst edge's vertices named as CHECK_TEXTURE_STRETCH names them (#314), off the rig this render posed.
      else if (r.kind === 'stretch') line = stretchRequirementLine(r, d.geo.meshes, d.geo.frames, d.poses, (edge) => edgeBonesText(scene.rig, scene.motion, r.slot, r.attachment, edge));
      else if (r.kind === 'seam') {
        const shown = attachmentPoses(d.path, d.poses.indices.length);
        const frames: SeamFrame[] = shown.map((f) => ({ part: f.get(r.part) ?? null, neighbour: f.get(r.neighbour) ?? null }));
        line = seamLine(r, seams.get(r.name) ?? [], frames, d.poses, inp.stage);
      } else {
        const rel = forceMix(scene.rig, scene.motion, r, 0);
        let relBuild = buildCopy(rel.rig, rel.motion);
        let door: string | null = null;
        if (relBuild.call.status !== 0 && mutedOnly(buildGateLines(relBuild.call.out).filter((l) => l.includes('FAIL')).map((l) => l.trim()), r)) {
          relBuild = buildCopy(declareConsumerDriven(rel.rig, r), rel.motion);
          door = `${mutedLine(r).rule} refused the released copy (its mix is 0 throughout), so that copy alone declares ${r.constraint_type} constraint "${r.constraint}" in invariants.consumerDrivenMix`;
        }
        const released = posesOf(green(relBuild, `the released copy of "${r.name}": ${r.constraint_type} constraint "${r.constraint}" ${r.property} mix forced to 0`), r.animation, join(reqDir, 'released', r.name), 'released');
        const fullCopy = forceMix(scene.rig, scene.motion, r, 1);
        const full = posesOf(green(buildCopy(fullCopy.rig, fullCopy.motion), `the full copy of "${r.name}": ${r.constraint_type} constraint "${r.constraint}" ${r.property} mix forced to 1`), r.animation, join(reqDir, 'full', r.name), 'full');
        const same = (a: Poses, b: Poses): boolean => a.times.length === b.times.length && a.times.every((t, i) => t === b.times[i] && a.indices[i] === b.indices[i]);
        if (!same(d.poses, released.poses) || !same(d.poses, full.poses)) {
          refuseIfAny([{ code: 'CHECK_REQUIREMENTS_FRAMES', object: `requirement "${r.name}"`, detail: `the as-declared, released and full renders of "${r.animation}" sample frames at [${d.poses.times.join(', ')}], [${released.poses.times.join(', ')}] and [${full.poses.times.join(', ')}] s; the follow is read frame by frame across the three, so the same frames are required` }]);
        }
        line = { ...followLine(r, d.poses, released.poses, full.poses), released_copy: door ?? 'built as forced: rig-c\'s gate passed it with no further declaration' };
      }
      lines[r.name] = line;
      const p = requirementProblem(r, line);
      if (p !== null) problems.push(p);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return { fps: file.fps, summary: requirementsSummary(file, new Map(Object.entries(lines))), lines };
}

// ---------------------------------------------------------------------------
// the judgement lines (issue #11)
// ---------------------------------------------------------------------------

/**
 * `RECOMPOSITE_HOLES`: `parts.json`'s `recomposite` block as a line — the
 * uncovered error pixels, how many holes they make, and the largest hole's box
 * and bordering parts. Read, not measured: the block is what assemble measured
 * on the painting, which check never sees. REPORTED, never FAIL, because no
 * bar for a hole is derivable by the rule the judgement bars follow: both
 * public examples hold hundreds of holes of a few dozen pixels along part
 * edges (453 on demo, the largest 70 px; 259 on sample, the largest 94 px),
 * and whether a hole matters depends on where it is — which the box and the
 * bordering parts say and a count cannot (AUTHORING §7).
 */
export function holesLine(parts: PartsFile): ReportedLine {
  const r = parts.recomposite;
  if (r === undefined) return { status: 'SKIP', reason: 'parts.json has no "recomposite" block (a parts.json the reference wrote has none); re-run assemble, which writes it' };
  return {
    status: 'REPORTED',
    // Issue #242: a scene's figures were read inside the figure, and the line says so first.
    ...(parts.scene === undefined ? {} : { declared_scene: scenePhrase(parts.scene, parts.rig_size[0] * parts.rig_size[1]) }),
    error_px: r.error_px,
    uncovered_error_px: r.uncovered_error_px,
    hole_count: r.hole_count,
    largest: r.holes.length === 0 ? null : { px: r.holes[0].px, box: boxText(r.holes[0]), borders: r.holes[0].borders.map((b) => `${b.part} ${b.px} px`) },
  };
}

/** `RECOMPOSITE_HOLES` for an alternate set (issue #454), carrying its assemble `mean_abs` and hole figures. */
export function altHolesLine(parts: PartsFile, alt: AlternatePartsRecord): ReportedLine {
  const r = alt.recomposite;
  return {
    status: 'REPORTED',
    ...(alt.scene === undefined ? {} : { declared_scene: scenePhrase(alt.scene, parts.rig_size[0] * parts.rig_size[1]) }),
    mean_abs: r.mean_abs,
    error_px: r.error_px,
    uncovered_error_px: r.uncovered_error_px,
    hole_count: r.hole_count,
    largest: r.holes.length === 0 ? null : { px: r.holes[0].px, box: boxText(r.holes[0]), borders: r.holes[0].borders.map((b) => `${b.part} ${b.px} px`) },
  };
}

function boxText(h: { x: number; y: number; w: number; h: number }): string {
  return `${h.x},${h.y} ${h.w}x${h.h}`;
}

/** The throwaway animation that holds the blink tracks at their closed value, rendered beside the setup-pose still. */
export const BLINK_ANIMATION = 'blink_shut';

function skip(reason: string): JudgementLine {
  return { status: 'SKIP', reason };
}

function tagWords(tags: readonly BaseTag[]): string {
  return tags.map((t) => `"${t}"`).join(' or ');
}

function quoteParts(ps: readonly PartRecord[]): string {
  return ps.map((p) => `"${p.name}"`).join(', ');
}

type Isolate = (label: string, ps: readonly PartRecord[]) => FrameSet;

/**
 * The scene file's three exceptions (issue #231), read against parts.json
 * before anything is built: each name must be a part parts.json lists
 * (`REQUIREMENTS_RESOLVES`), and one the bar it relaxes reads — a `footwear`
 * part for `not_planted` (`REQUIREMENTS_NOT_PLANTED`), a `handwear` or
 * `bottomwear` part for `not_swinging`, `rises` and `rests` (issue #245)
 * (`REQUIREMENTS_TIP_EXCEPTION`): an exception that excepts nothing is a miss,
 * refused by name. With no parts.json every name is refused. Whether a `rises`
 * part's chain does rise is read off the idle's geometry by `TIP_OVER_ROOT`.
 */
export function exceptionProblems(file: Pick<RequirementsFile, 'not_planted' | 'not_swinging' | 'rises' | 'rests' | 'path'>, parts: PartsFile | null, noParts: string | null): Problem[] {
  const out: Problem[] = [];
  // Issue #231: not_swinging and rises name swinging parts, the ones TIP_OVER_ROOT reads; whether a rises part's chain does rise is read off the idle's geometry, in the line. Issue #245: rests too.
  for (const key of ['not_swinging', 'rises', 'rests'] as const) {
    file[key].forEach((name, i) => {
      const object = `${file.path} field "${key}"[${i}]`;
      if (parts === null) {
        out.push({ code: 'REQUIREMENTS_TIP_EXCEPTION', object, detail: `names part "${name}", and the swinging parts are chosen by parts.json's See-through tags, of which none was read: ${noParts ?? 'no parts.json'}` });
        return;
      }
      const rec = parts.parts.find((p) => p.name === name);
      if (rec === undefined) {
        out.push({ code: 'REQUIREMENTS_RESOLVES', object, detail: `names part "${name}", which parts.json does not list; it lists ${parts.parts.map((p) => `"${p.name}"`).join(', ') || 'none'}` });
        return;
      }
      const swing = partsTagged(parts, SWING_TAGS).map((p) => p.name);
      if (!swing.includes(name)) {
        out.push({
          code: 'REQUIREMENTS_TIP_EXCEPTION',
          object,
          detail: `names part "${name}" (from "${rec.from}"), which TIP_OVER_ROOT does not read; only a part from a See-through ${tagWords(SWING_TAGS)} layer is (${swing.map((n) => `"${n}"`).join(', ') || 'none here'}), so declaring it excepts nothing`,
        });
      }
    });
  }
  file.not_planted.forEach((name, i) => {
    const object = `${file.path} field "not_planted"[${i}]`;
    if (parts === null) {
      out.push({ code: 'REQUIREMENTS_NOT_PLANTED', object, detail: `names part "${name}", and the feet are chosen by parts.json's See-through tags, of which none was read: ${noParts ?? 'no parts.json'}` });
      return;
    }
    const rec = parts.parts.find((p) => p.name === name);
    if (rec === undefined) {
      out.push({ code: 'REQUIREMENTS_RESOLVES', object, detail: `names part "${name}", which parts.json does not list; it lists ${parts.parts.map((p) => `"${p.name}"`).join(', ') || 'none'}` });
      return;
    }
    const feet = partsTagged(parts, FEET_TAGS).map((p) => p.name);
    if (!feet.includes(name)) {
      out.push({
        code: 'REQUIREMENTS_NOT_PLANTED',
        object,
        detail: `names part "${name}" (from "${rec.from}"), which is not read as a planted foot; only a part from a See-through ${tagWords(FEET_TAGS)} layer is (${feet.map((n) => `"${n}"`).join(', ') || 'none here'}), so declaring it excepts nothing`,
      });
    }
  });
  return out;
}

/** The feet a line holds still (issue #231): the `footwear` parts less those the scene file declares not planted, and the declared ones, in parts.json's order. */
function plantedFeet(parts: PartsFile, notPlanted: readonly string[]): { all: PartRecord[]; held: PartRecord[]; declared: string[] } {
  const all = partsTagged(parts, FEET_TAGS);
  return { all, held: all.filter((p) => !notPlanted.includes(p.name)), declared: all.filter((p) => notPlanted.includes(p.name)).map((p) => p.name) };
}

/** The sentence a feet half carries when every footwear part is declared not planted (issue #231). */
function noneHeldText(declared: readonly string[]): string {
  return `every ${tagWords(FEET_TAGS)} part (${declared.map((n) => `"${n}"`).join(', ')}) is declared not planted by the scene file's not_planted, so there are no feet to hold still`;
}

/**
 * (1) The torso moves while the feet do not: each rendered alone, heat over
 * its own box. The feet are the `footwear` parts less those the scene file
 * declares `not_planted` (issue #231); a declaration is the line's first
 * figure, `declared_not_planted`, so the line never reads as though the feet
 * it names were held still. With every foot declared, the torso is measured
 * and the feet figures are an empty list and null.
 *
 * Issue #323: the two halves are read apart. With no `topwear` part the feet
 * half is still measured, and with no `footwear` part the torso half is; the
 * half that was measured decides the line, and the line says so first —
 * `halves_measured` `1 of 2`, then each half's own status, the unmeasured one
 * `SKIP` with its reason — so a half nobody read never passes by being silent.
 * With neither, the line is the SKIP it was. A run that measured both halves
 * writes the keys it always wrote.
 *
 * Issue #411: the torso half reads the breath alone ({@link torsoBreath}):
 * `torso_heat_mean` is the heat the breath makes, the idle rendered with and
 * without its breath tracks, on the same box and against the same floor.
 * Until #411 it was the whole idle's heat over the box, so a keyed cloth swing
 * or a physics response to the world inside the torso's box passed the bar
 * for a torso that did not breathe.
 */
function breathLine(inp: FullInputs, isolated: Isolate, pair: BreathPairRender, problems: Problem[], notPlanted: readonly string[] = []): JudgementLine {
  const torso = partsTagged(inp.parts, TORSO_TAGS);
  const { all: allFeet, held: feet, declared } = plantedFeet(inp.parts, notPlanted);
  const noTorso = `no part comes from a See-through ${tagWords(TORSO_TAGS)} layer, so there is no torso to see breathe`;
  const noFeet = `no part comes from a See-through ${tagWords(FEET_TAGS)} layer, so there are no feet to hold still`;
  // Issue #323: a figure without one of the two halves still has the other read; with neither, the SKIP it always was.
  if (torso.length === 0 && feet.length === 0) return skip(`${noTorso}${declared.length === 0 ? '' : `; ${declared.map((n) => `"${n}"`).join(', ')} declared not planted`}`);
  if (torso.length === 0) return oneHalf(inp, isolated, pair, problems, 'feet', feet, noTorso, declared);
  if (allFeet.length === 0) return oneHalf(inp, isolated, pair, problems, 'torso', torso, noFeet, []);
  const H = inp.parts.rig_size[1];
  const tr = torsoBreath(inp, torso, pair);
  const fs = feet.length === 0 ? null : isolated('feet', feet);
  const fb = fs === null ? null : frameBox(feet, H, inp.stage, fs.viewport);
  if ('skip' in tr || (fs !== null && fb === null)) return skip(`the ${'skip' in tr ? 'torso' : 'feet'} box falls outside the idle frame`);
  const fh = fs === null || fb === null ? null : regionHeat(heatField(fs.frames.map((f) => f.image)), fs.viewport.pixelWidth, fb);
  const mean = tr.mean;
  const ok = mean >= BREATH_TORSO_MEAN_FLOOR && (fh === null || fh.max <= BREATH_FEET_MAX_CEILING);
  if (mean < BREATH_TORSO_MEAN_FLOOR) problems.push(torsoProblem(torso, tr, ''));
  if (fh !== null && fb !== null && fh.max > BREATH_FEET_MAX_CEILING) {
    problems.push({
      code: 'CHECK_BREATH_VISIBLE',
      object: `feet ${quoteParts(feet)} rendered alone, frame box ${boxLabel(fb)}${declared.length === 0 ? '' : ` (${declared.map((n) => `"${n}"`).join(', ')} declared not planted)`}`,
      detail: `heat max ${fh.max}/255 over the idle; <= ${BREATH_FEET_MAX_CEILING} is required — the feet move: their slot rides, or their mesh is weighted to, a bone the idle keys`,
    });
  }
  return {
    status: ok ? 'PASS' : 'FAIL',
    ...(declared.length === 0 ? {} : { declared_not_planted: declared }),
    torso_parts: torso.map((p) => p.name),
    torso_heat_mean: mean,
    torso_floor: BREATH_TORSO_MEAN_FLOOR,
    feet_parts: feet.map((p) => p.name),
    feet_heat_max: fh === null ? null : fh.max,
    feet_ceiling: BREATH_FEET_MAX_CEILING,
  };
}

/**
 * `BREATH_VISIBLE` with one half to read (issue #323): the torso with no
 * `footwear` part, or the feet with no `topwear` part. The half read decides
 * the line by the bar it always had, its figures under the names they always
 * had; the other half is `SKIP` with `reason`, and the line's first figure,
 * `halves_measured`, says `1 of 2` — after `declared_not_planted` when the scene
 * file declares some of the feet read (issue #231), which stays the first.
 */
function oneHalf(inp: FullInputs, isolated: Isolate, pair: BreathPairRender, problems: Problem[], half: 'torso' | 'feet', ps: readonly PartRecord[], reason: string, declared: readonly string[]): JudgementLine {
  const H = inp.parts.rig_size[1];
  if (half === 'torso') {
    // Issue #411: the torso half is the breath alone.
    const tr = torsoBreath(inp, ps, pair);
    if ('skip' in tr) return skip(`the ${half} box falls outside the idle frame, and ${reason}`);
    const mean = tr.mean;
    const ok = mean >= BREATH_TORSO_MEAN_FLOOR;
    if (!ok) problems.push(torsoProblem(ps, tr, `; the feet half not measured: ${reason}`));
    return {
      status: ok ? 'PASS' : 'FAIL',
      halves_measured: '1 of 2',
      torso_status: ok ? 'PASS' : 'FAIL',
      torso_parts: ps.map((p) => p.name),
      torso_heat_mean: mean,
      torso_floor: BREATH_TORSO_MEAN_FLOOR,
      feet_status: 'SKIP',
      feet_reason: reason,
    };
  }
  const fs = isolated(half, ps);
  const box = frameBox(ps, H, inp.stage, fs.viewport);
  if (box === null) return skip(`the ${half} box falls outside the idle frame, and ${reason}`);
  const heat = regionHeat(heatField(fs.frames.map((f) => f.image)), fs.viewport.pixelWidth, box);
  const ok = heat.max <= BREATH_FEET_MAX_CEILING;
  if (!ok) {
    problems.push({
      code: 'CHECK_BREATH_VISIBLE',
      object: `feet ${quoteParts(ps)} rendered alone, frame box ${boxLabel(box)}${declared.length === 0 ? '' : ` (${declared.map((n) => `"${n}"`).join(', ')} declared not planted)`}; the torso half not measured: ${reason}`,
      detail: `heat max ${heat.max}/255 over the idle; <= ${BREATH_FEET_MAX_CEILING} is required — the feet move: their slot rides, or their mesh is weighted to, a bone the idle keys`,
    });
  }
  return {
    status: ok ? 'PASS' : 'FAIL',
    ...(declared.length === 0 ? {} : { declared_not_planted: [...declared] }),
    halves_measured: '1 of 2',
    torso_status: 'SKIP',
    torso_reason: reason,
    feet_status: ok ? 'PASS' : 'FAIL',
    feet_parts: ps.map((p) => p.name),
    feet_heat_max: heat.max,
    feet_ceiling: BREATH_FEET_MAX_CEILING,
  };
}

/** The throwaway animation BREATH_VISIBLE adds beside the idle (issue #411): the idle with its breath tracks held at rest; a trailing `_` is added while the rig already has an animation of the name. */
export const BREATH_ANIMATION = 'idle_without_breath';
/** Where BREATH_VISIBLE's copy is built and rendered, under the stage's scratch; removed before the stage returns. */
const BREATH_SCRATCH = 'breath';

/** The idle track properties that make up the breath on a breath bone (issue #411): it moves and it swells; the drafted breath is `chest` `translatey` and `scalex` (src/propose.ts). */
const BREATH_TRACK_PROPS: readonly string[] = ['translate', 'translatex', 'translatey', 'scale', 'scalex', 'scaley'];

/**
 * The breath's tracks (issue #411), in the idle's order: the breath bones are
 * every bone an idle track translates ({@link BREATH_PROPS}, issue #262), and
 * their breath tracks every idle track that translates or scales one of them
 * ({@link BREATH_TRACK_PROPS}). A track that turns a breath bone, a group's
 * track and every track on another bone are not the breath. Empty when no
 * idle track translates a bone.
 */
export function breathTracks(motion: Record<string, unknown>): Array<{ bone: string; property: string }> {
  const anims = isRecord(motion.animations) ? motion.animations : {};
  const idle = isRecord(anims.idle) ? anims.idle : {};
  const tracks = (Array.isArray(idle.tracks) ? idle.tracks : []).filter(isRecord).filter((t) => typeof t.bone === 'string' && typeof t.property === 'string');
  const bones = new Set(tracks.filter((t) => BREATH_PROPS.includes(String(t.property))).map((t) => String(t.bone)));
  return tracks.filter((t) => bones.has(String(t.bone)) && BREATH_TRACK_PROPS.includes(String(t.property))).map((t) => ({ bone: String(t.bone), property: String(t.property) }));
}

/**
 * A breath track held at rest (issue #411): the setup pose's value — 0 for a translate, 1 for a scale, one per axis
 * the track's first key gives — at its first and last key times, no curve. That is the track removed, as the bone
 * stands without it, while the idle stays keyed to its end: a dropped track could leave the idle's last key before
 * its duration, which rigc refuses. (Held at its first key instead, the bone would stand offset from frame 0 on and
 * the physics under it would answer that start, which is not the idle without its breath.)
 */
function heldTrack(t: Record<string, unknown>): Record<string, unknown> {
  const keys = (Array.isArray(t.keys) ? t.keys : []).filter(isRecord);
  if (keys.length === 0) return t;
  const first = keys[0];
  const last = keys[keys.length - 1];
  const rest = String(t.property).startsWith('scale') ? 1 : 0;
  const v = (Array.isArray(first.v) ? first.v : [first.v]).map(() => rest);
  return { ...t, keys: keys.length === 1 ? [{ t: first.t, v }] : [{ t: first.t, v }, { t: last.t, v }] };
}

function isBreathTrack(t: Record<string, unknown>, tracks: ReadonlyArray<{ bone: string; property: string }>): boolean {
  return tracks.some((b) => b.bone === t.bone && b.property === t.property);
}

/** The torso rendered alone twice from one build (issue #411): the idle (`with`) and the idle less its breath tracks (`without`), and those tracks as `bone property`. */
export interface BreathPair {
  with: FrameSet;
  without: FrameSet;
  tracks: string[];
}

/** Renders {@link BreathPair} for the torso parts; null when the idle has no breath track. */
export type BreathPairRender = (ps: readonly PartRecord[]) => BreathPair | null;

/**
 * Why the two renders of a {@link BreathPair} cannot be compared pixel for
 * pixel, or null when they can: one grid (the viewport), one background, the
 * same number of frames, each of one size. Both come from one build, so a
 * difference is rigc's, refused by name (`CHECK_BREATH_VISIBLE`) rather than
 * read.
 */
export function breathPairProblem(pair: BreathPair): Problem | null {
  const a = pair.with;
  const b = pair.without;
  const size = (s: FrameSet): string => [...new Set(s.frames.map((f) => `${f.image.width}x${f.image.height}`))].join(',');
  if (sameViewport(a.viewport, b.viewport) && a.background.join(',') === b.background.join(',') && a.frames.length === b.frames.length && size(a) === size(b) && !size(a).includes(',')) return null;
  return {
    code: 'CHECK_BREATH_VISIBLE',
    object: `the torso's two idle renders (with and without the breath tracks ${pair.tracks.join(', ')})`,
    detail: `are ${a.frames.length} frame(s) of ${size(a)} on ${JSON.stringify(a.viewport)} over ${JSON.stringify(a.background)} and ${b.frames.length} frame(s) of ${size(b)} on ${JSON.stringify(b.viewport)} over ${JSON.stringify(b.background)}; the breath is read pixel for pixel between them, which needs one grid, one background and one frame count`,
  };
}

/** The torso half's reading (issue #411): the breath's heat mean over the box, the whole idle's beside it, and the breath tracks; `none` when the idle has no breath track. */
type TorsoBreath = { box: PixelBox; mean: number; whole: number; tracks: string[] } | { none: string; mean: number } | { skip: true };

/**
 * `BREATH_VISIBLE`'s torso half (issue #411): the breath alone. The breath
 * bones are every bone an idle track translates, and the breath tracks every
 * idle track that translates or scales one of them ({@link breathTracks}).
 * The torso is rendered alone, idle at its rate and size, from one throwaway
 * build carrying every animation of the rig and, beside them, the idle with
 * its breath tracks held at rest ({@link heldTrack}: the bone as it stands
 * without them, the idle still keyed to its end) — so both renders share a
 * grid. Per pixel, the largest
 * |(with_t - with_0) - (without_t - without_0)| over the frames and the RGB
 * channels ({@link breathHeat}), meaned over the torso's frame box. Motion that
 * is not the breath's — a keyed cloth swing, physics answering the world, a
 * head turn — is in both renders and cancels; physics the breath sets moving
 * is counted. The whole idle's heat over the same box, the reading until #411,
 * is carried for the refusal's sentence only.
 *
 * With no breath track the figure is 0, by the definition (the idle with and
 * without its breath is one idle), and the bar fails naming why: a torso with
 * no breath is what the bar exists to find, so it is not a SKIP; nothing is
 * rendered.
 */
function torsoBreath(inp: FullInputs, ps: readonly PartRecord[], pair: BreathPairRender): TorsoBreath {
  const got = pair(ps);
  if (got === null) return { none: 'no idle track translates a bone, so the rig has no breath to read (the breath bones are every bone an idle track translates); whatever else the idle moves is not counted', mean: 0 };
  const grid = breathPairProblem(got);
  if (grid !== null) refuseIfAny([grid]);
  const box = frameBox(ps, inp.parts.rig_size[1], inp.stage, got.with.viewport);
  if (box === null) return { skip: true };
  const width = got.with.viewport.pixelWidth;
  const withFrames = got.with.frames.map((f) => f.image);
  const mean = round3(regionHeat(breathHeat(withFrames, got.without.frames.map((f) => f.image)), width, box).mean);
  const whole = round3(regionHeat(heatField(withFrames), width, box).mean);
  return { box, mean, whole, tracks: got.tracks };
}

/** The torso half's refusal (issue #411): the breath's figure, the tracks it was read from, and the whole idle's beside it. */
function torsoProblem(ps: readonly PartRecord[], tr: Exclude<TorsoBreath, { skip: true }>, tail: string): Problem {
  if ('none' in tr) {
    return { code: 'CHECK_BREATH_VISIBLE', object: `torso ${quoteParts(ps)}${tail}`, detail: `breath heat mean 0/255: ${tr.none}; >= ${BREATH_TORSO_MEAN_FLOOR} is required — key the chest's breath (a translate track on the bone the torso is weighted to)` };
  }
  return {
    code: 'CHECK_BREATH_VISIBLE',
    object: `torso ${quoteParts(ps)} rendered alone, frame box ${boxLabel(tr.box)}${tail}`,
    detail: `breath heat mean ${tr.mean}/255 over the idle — the idle with and without its breath tracks (${tr.tracks.join(', ')}), on one grid; the whole idle reads ${tr.whole} over the box, and what is not the breath's is not counted; >= ${BREATH_TORSO_MEAN_FLOOR} is required — the chest's breath track moves too little, or the torso is not weighted to the bone it keys`,
  };
}

/** The scene file's exceptions to `TIP_OVER_ROOT` (issues #231, #245), and the file they were read from, which a refusal names. */
export interface TipExceptions {
  path: string;
  not_swinging: readonly string[];
  rises: readonly string[];
  rests: readonly string[];
}

const NO_TIP_EXCEPTIONS: TipExceptions = { path: '', not_swinging: [], rises: [], rests: [] };

/**
 * What `TIP_OVER_ROOT` is measured with, written into its line (issue #118):
 * the idle's posed geometry, not a render of the part. Until #118 the line
 * read rendered pixels — figures in frame px under `root_px`/`tip_px` — so an
 * old and a new check.json are told apart by this key and by the units in
 * the field names.
 */
export const TIP_INSTRUMENT = 'geometry';

/**
 * (4) Each swinging part's tip travels further than its root: how far the art
 * in the lower half of the part's box travels against the upper half — the
 * centroid of the art's area inside each fixed half, through the posed mesh
 * ({@link halfTravels}) — read off the idle's `geometry.json`. Until issue
 * #118 the halves were read off the part rendered alone at `--max 640`, a
 * binary-coverage centroid per half; every root half on the three examples
 * travels under a frame pixel, where that centroid scatters by up to 0.3 px
 * with the grid, so the ratio was set by the grid.
 *
 * Issue #231: the scene file's `not_swinging` parts are left out, each row
 * saying so, and its `rises` parts are read with the halves swapped once the
 * chain carrying each is measured to rise ({@link chainDirection}; refused by
 * name otherwise); both lists are the line's first figures. Without them the
 * line is the one written before. Issue #322: the chain is read at its last
 * link, and a declared row carries `tip_read`, the reading that let it rise.
 *
 * Issue #245: a part the scene declares `rests` — its tip at rest while its
 * root moves — is measured with the same halves and held to the opposite
 * relation: tip / root at most {@link TIP_REST_RATIO_CEILING}. Its row says
 * so first (`declared: "rests"`), the list is the line's first figure after
 * the other two, and the ceiling follows the floor.
 */
function tipLine(inp: FullInputs, geometryPath: string, frames: number, problems: Problem[], excepted: TipExceptions = NO_TIP_EXCEPTIONS): JudgementLine {
  const swing = partsTagged(inp.parts, SWING_TAGS);
  if (swing.length === 0) return skip(`no part comes from a See-through ${tagWords(SWING_TAGS)} layer, so there is no hem or sleeve to swing`);
  const poses = attachmentPoses(geometryPath, frames);
  // Issue #231: a part declared `rises` is read up only when the chain carrying it does rise, measured at the setup pose.
  // Issue #322: at its last link, the end the tip half is the art of; the row says what was read.
  const risesRead = new Map<string, string>();
  if (excepted.rises.length > 0) {
    const geo = readGeometry(geometryPath, frames);
    const origins = new Map<string, SetupBone>();
    for (const b of Array.isArray(geo?.setupBones) ? geo.setupBones : []) {
      if (isRecord(b) && typeof b.name === 'string' && typeof b.worldX === 'number' && typeof b.worldY === 'number') {
        origins.set(b.name, { x: b.worldX, y: b.worldY, ...(typeof b.a === 'number' && typeof b.c === 'number' ? { a: b.a, c: b.c } : {}) });
      }
    }
    const refused: Problem[] = [];
    excepted.rises.forEach((name, i) => {
      const dir = chainDirection(inp.rig, inp.motion, name, origins);
      if ('toward' in dir && dir.toward === 'up') {
        risesRead.set(name, dir.chains.join('; '));
        return;
      }
      refused.push({
        code: 'REQUIREMENTS_TIP_EXCEPTION',
        object: `${excepted.path} field "rises"[${i}]`,
        detail: `names part "${name}", whose tip is not up: ${'none' in dir ? dir.none : `its chain runs ${dir.toward} — ${dir.chains.join('; ')}`}; a part declared rises must be carried by a chain whose last link runs up at the setup pose — from its origin along its length, or, a last link with no length, from the link before's origin to its own`,
      });
    });
    refuseIfAny(refused);
  }
  const rows: Array<Record<string, unknown>> = [];
  let measured = 0;
  let failed = false;
  for (const p of swing) {
    if (excepted.not_swinging.includes(p.name)) {
      rows.push({ part: p.name, unmeasured: "declared not swinging by the scene file's not_swinging, so it is not held to the bar" });
      continue;
    }
    // Issue #349: a limb segment is rigid on its one bone and turns at its joint; it does not hang, so no tip trails a root.
    if (p.limb !== undefined) {
      rows.push({ part: p.name, unmeasured: `a limb segment (config.limbs.${p.limb.name}), rigid on its one bone "${p.limb.bone}": it turns at its joint and does not hang, so it is not held to the bar` });
      continue;
    }
    const rises = excepted.rises.includes(p.name);
    const rests = excepted.rests.includes(p.name);
    const [rootHalf, tipHalf] = rises ? ['lower', 'upper'] : ['upper', 'lower'];
    const art = placedArt(p.x, p.y, readPng(join(inp.partsDir, `${p.name}.png`)));
    const shown = poses.map((f) => f.get(p.name) ?? null);
    const t = halfTravels(art, p, inp.stage, shown, rises ? 'up' : 'down');
    // A part not declared writes the row it wrote before issue #231; a declared one says which half is its tip's.
    const said = { ...(rests ? { declared: 'rests' } : {}), ...(rises ? { tip_half: tipHalf, tip_read: risesRead.get(p.name) as string } : {}) };
    if (t.root === null || t.tip === null) {
      rows.push({ part: p.name, ...said, unmeasured: shown[0] === null ? 'its slot shows no attachment on idle frame 0' : `on idle frame 0 the ${t.root === null ? rootHalf : tipHalf} half of its box holds no art its attachment draws` });
      continue;
    }
    measured++;
    const ratio = t.root > 0 ? round3(t.tip / t.root) : null;
    // Issue #245: a resting tip is held to the opposite relation — no further than its root, at the line's precision.
    const ok = rests ? (ratio === null ? round3(t.tip) === 0 : ratio <= TIP_REST_RATIO_CEILING) : ratio === null ? t.tip > 0 : ratio >= TIP_RATIO_FLOOR;
    rows.push({ part: p.name, ...said, root_rig_px: round3(t.root), tip_rig_px: round3(t.tip), ratio });
    if (!ok && rests) {
      failed = true;
      problems.push({
        code: 'CHECK_TIP_OVER_ROOT',
        object: `part "${p.name}", box ${p.x},${p.y} ${p.w}x${p.h} rig px, posed by the idle's geometry, declared rests${rises ? ' and rises' : ''}`,
        detail: `the art in its ${tipHalf} half travels ${round3(t.tip)} rig px and in its ${rootHalf} half ${round3(t.root)} rig px (ratio ${ratio ?? 'undefined: the root does not move'}); the scene file's rests declares its tip at rest, so a ratio <= ${TIP_REST_RATIO_CEILING} is required — the tip swings: the chain's amplitudes grow toward the tip, or the tip of the mesh is weighted to a bone the idle swings`,
      });
    } else if (!ok) {
      failed = true;
      // Issue #262: a root the breath carries is named with its carrier, not blamed on the chain.
      // Issue #351: when the breath carries the root and the chain is also below the bar, or when the mesh is weighted
      // off its chain without a breath carrier, name that too instead of only blaming the chain's amplitudes.
      const carry = breathCarrier(inp.rig, inp.motion, p.name, geometryPath, frames, { art, box: p, stage: inp.stage, shown, toward: rises ? 'up' : 'down', root: t.root, tip: t.tip });
      if (carry !== null) rows[rows.length - 1] = { ...rows[rows.length - 1], carried_by: carry.bone, breath_rig_px: round3(carry.breath), root_without_breath_rig_px: round3(carry.root), tip_without_breath_rig_px: round3(carry.tip) };
      const offChain = carry === null && round3(t.tip) > 0 ? offChainClause(inp.rig, inp.motion, p.name) : null;
      const why =
        carry === null
          ? `the chain's amplitudes do not grow toward the tip, or the mesh is not weighted to the chain${offChain === null ? '' : `; ${offChain}`}`
          : carry.passes
            ? `the root travels with the breath (${round3(t.root)} px of ${round3(carry.breath)} px): it is carried by \`${carry.bone}\`, which moves it more than the tip; with \`${carry.keyed}\`'s translate held still the root travels ${round3(carry.root)} rig px and the tip ${round3(carry.tip)}, which the bar passes (ratio ${carry.root > 0 ? round3(carry.tip / carry.root) : 'undefined: the root moves only with it'}) — bind the root to the bone the part hangs from, not to \`${carry.bone}\``
            : `the root travels with the breath (${round3(t.root)} px of ${round3(carry.breath)} px): it is carried by \`${carry.bone}\`, which moves it more than the tip; with \`${carry.keyed}\`'s translate held still the root travels ${round3(carry.root)} rig px and the tip ${round3(carry.tip)}, which is still below the bar (ratio ${carry.root > 0 ? round3(carry.tip / carry.root) : 'undefined: the root moves only with it'}, < ${TIP_RATIO_FLOOR}) — drop the segment on \`${carry.bone}\` from \`meshes.${p.name}.segments\` (or bind the root to the bone the part hangs from, not to \`${carry.bone}\`) and grow the chain's amplitudes toward the tip`;
      problems.push({
        code: 'CHECK_TIP_OVER_ROOT',
        object: `part "${p.name}", box ${p.x},${p.y} ${p.w}x${p.h} rig px, posed by the idle's geometry${rises ? ', declared rises' : ''}`,
        detail: `the art in its ${tipHalf} half travels ${round3(t.tip)} rig px and in its ${rootHalf} half ${round3(t.root)} rig px (ratio ${ratio ?? 'undefined: nothing moves'}); a ratio >= ${TIP_RATIO_FLOOR} is required — ${why}`,
      });
    }
  }
  const declared = {
    ...(excepted.not_swinging.length === 0 ? {} : { declared_not_swinging: swing.filter((p) => excepted.not_swinging.includes(p.name)).map((p) => p.name) }),
    ...(excepted.rises.length === 0 ? {} : { declared_rises: swing.filter((p) => excepted.rises.includes(p.name)).map((p) => p.name) }),
    ...(excepted.rests.length === 0 ? {} : { declared_rests: swing.filter((p) => excepted.rests.includes(p.name)).map((p) => p.name) }),
  };
  if (measured === 0) return { status: 'SKIP', reason: `none of ${quoteParts(swing)} could be measured: ${rows.map((r) => `${String(r.part)}: ${String(r.unmeasured)}`).join('; ')}` };
  return { status: failed ? 'FAIL' : 'PASS', ...declared, instrument: TIP_INSTRUMENT, parts: rows, ratio_floor: TIP_RATIO_FLOOR, ...(excepted.rests.length === 0 ? {} : { rest_ratio_ceiling: TIP_REST_RATIO_CEILING }) };
}

/**
 * When a failing weighted mesh rides a chain (`chainsCarrying`) and also carries positive weight on a bone off that
 * chain (neither a link nor under one, as {@link stressPlan} reads it), name the off-chain bones and their vertex
 * counts so `CHECK_TIP_OVER_ROOT` does not only blame the chain's amplitudes (issue #351).
 */
function offChainClause(rig: Record<string, unknown>, motion: Record<string, unknown>, part: string): string | null {
  const bones = (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord).filter((b) => typeof b.name === 'string');
  const parent = new Map(bones.map((b) => [String(b.name), typeof b.parent === 'string' ? b.parent : null]));
  const skins = isRecord(rig.skins) ? rig.skins : {};
  const skin = isRecord(skins.default) ? skins.default : {};
  const onSlot = skin[part];
  const atts: unknown[] = isRecord(onSlot) ? (isRecord(onSlot[part]) ? [onSlot[part]] : Object.values(onSlot)) : [];
  const weighted = atts.filter((a): a is Record<string, unknown> & { weights: unknown[] } => isRecord(a) && Array.isArray(a.weights));
  if (weighted.length === 0) return null;
  const { found } = chainsCarrying(rig, motion, part);
  if (found.length === 0) return null;
  const links = new Set(found.flat());
  const onChain = (b: string): boolean => {
    const seen = new Set<string>();
    for (let x: string | null = b; x !== null && !seen.has(x); x = parent.get(x) ?? null) {
      if (links.has(x)) return true;
      seen.add(x);
    }
    return false;
  };
  const off = new Map<string, { vertices: number; largest: number }>();
  let of = 0;
  for (const a of weighted) {
    for (const v of a.weights) {
      of++;
      const ws = (Array.isArray(v) ? v : []).filter(isRecord).filter((w) => typeof w.bone === 'string' && typeof w.weight === 'number') as Array<{ bone: string; weight: number }>;
      for (const w of ws) {
        if (onChain(w.bone) || w.weight <= 0) continue;
        const e = off.get(w.bone) ?? { vertices: 0, largest: 0 };
        e.vertices++;
        e.largest = Math.max(e.largest, w.weight);
        off.set(w.bone, e);
      }
    }
  }
  if (off.size === 0) return null;
  const list = [...off].map(([bone, e]) => `"${bone}" (${e.vertices} of ${of} vertices, largest weight ${round3(e.largest)})`).join(', ');
  const drop = off.size === 1 ? `"${[...off.keys()][0]}"` : 'each of those bones';
  return `it is weighted off the chain to ${list} — drop the segment on ${drop} in \`meshes.${part}.segments\`, or grow the chain's amplitudes toward the tip`;
}

/**
 * The bones a part's attachments are bound to in the default skin (issue #231): a mesh's weights, or its slot's
 * bone for an attachment that carries no weights.
 */
function boundBones(rig: Record<string, unknown>, part: string): Set<string> {
  const slot = (Array.isArray(rig.slots) ? rig.slots : []).filter(isRecord).find((sl) => sl.name === part);
  const skins = isRecord(rig.skins) ? rig.skins : {};
  const skin = isRecord(skins.default) ? skins.default : {};
  const onSlot = skin[part];
  const atts = isRecord(onSlot) ? (isRecord(onSlot[part]) ? [onSlot[part]] : Object.values(onSlot)) : [];
  const bound = new Set<string>();
  for (const a of atts) {
    if (isRecord(a) && Array.isArray(a.weights)) for (const v of a.weights) for (const w of Array.isArray(v) ? v : []) if (isRecord(w) && typeof w.bone === 'string') bound.add(w.bone);
    if (!(isRecord(a) && Array.isArray(a.weights)) && slot !== undefined && typeof slot.bone === 'string') bound.add(slot.bone);
  }
  return bound;
}

/** The idle track properties that move a bone without turning it: the breath is one of these (issue #262). */
const BREATH_PROPS: readonly string[] = ['translate', 'translatex', 'translatey'];

/**
 * The bone a failing part's root travels with, when that is the breath's (issues #262, #351). The breath is every idle
 * track that translates a bone ({@link BREATH_PROPS}), each read on its own: `K` the bone it keys. Its motion is
 * `K`'s world origin less where `K`'s parent carries `K`'s setup position, frame by frame — what the translate keys
 * add — and the breath's travel is that, less its frame-0 value, at its largest. The part (one weighted mesh; a
 * region is carried whole and cannot stretch) is posed again with that motion taken out of every vertex in
 * proportion to its weight on `K` and the bones under it, and its halves measured as {@link halfTravels} measures
 * them. The root travels with the breath when the breath adds more to the root's travel than to the tip's and the tip
 * moves above 0 at the line's precision (round3); `passes` records whether, held still, the halves pass the bar
 * (tip >= {@link TIP_RATIO_FLOOR} x root). The carrier named is the bone the part is bound to ({@link boundBones}) at
 * or under `K` that no other such bone is above (the sleeve's links ride `chest`, which is the carrier). Null otherwise.
 */
function breathCarrier(
  rig: Record<string, unknown>,
  motion: Record<string, unknown>,
  part: string,
  geometryPath: string,
  frames: number,
  m: { art: ArtMask; box: { x: number; y: number; w: number; h: number }; stage: StageBox; shown: ReadonlyArray<PosedAttachment | null>; toward: 'down' | 'up'; root: number; tip: number },
): { bone: string; keyed: string; breath: number; root: number; tip: number; passes: boolean } | null {
  const anims = isRecord(motion.animations) ? motion.animations : {};
  const idle = isRecord(anims.idle) ? anims.idle : {};
  const keyed = [...new Set((Array.isArray(idle.tracks) ? idle.tracks : []).filter(isRecord).filter((t) => typeof t.bone === 'string' && typeof t.property === 'string' && BREATH_PROPS.includes(t.property)).map((t) => String(t.bone)))];
  if (keyed.length === 0) return null;
  const bones = (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord).filter((b) => typeof b.name === 'string');
  const parent = new Map(bones.map((b) => [String(b.name), typeof b.parent === 'string' ? b.parent : null]));
  const setupAt = new Map(bones.map((b) => [String(b.name), [typeof b.x === 'number' ? b.x : 0, typeof b.y === 'number' ? b.y : 0] as const]));
  const atOrUnder = (b: string, anc: string): boolean => {
    const seen = new Set<string>();
    for (let x: string | null = b; x !== null && !seen.has(x); x = parent.get(x) ?? null) {
      if (x === anc) return true;
      seen.add(x);
    }
    return false;
  };
  // The one weighted mesh the part draws, its weights in the order of the geometry's vertices.
  const skins = isRecord(rig.skins) ? rig.skins : {};
  const skin = isRecord(skins.default) ? skins.default : {};
  const onSlot = skin[part];
  const atts = isRecord(onSlot) ? (isRecord(onSlot[part]) ? [onSlot[part]] : Object.values(onSlot)) : [];
  const first = m.shown[0];
  if (atts.length !== 1 || first === null || first === undefined) return null;
  const att = atts[0];
  if (!isRecord(att) || !Array.isArray(att.weights) || att.weights.length * 2 !== first.rest.length) return null;
  const weights = att.weights.map((v) => (Array.isArray(v) ? v.filter(isRecord).filter((w) => typeof w.bone === 'string' && typeof w.weight === 'number') : []));
  const geo = readGeometry(geometryPath, frames);
  if (geo === null) return null;
  const world = (bs: unknown, name: string): BoneWorld | null => {
    const b = Array.isArray(bs) ? bs.filter(isRecord).find((x) => x.name === name) : undefined;
    if (b === undefined) return null;
    const f = [b.a, b.b, b.c, b.d, b.worldX, b.worldY];
    if (!f.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    return { a: b.a as number, b: b.b as number, c: b.c as number, d: b.d as number, worldX: b.worldX as number, worldY: b.worldY as number };
  };
  const bound = [...boundBones(rig, part)];
  for (const k of keyed) {
    const under = bound.filter((b) => atOrUnder(b, k));
    const carrier = under.find((b) => !under.some((o) => o !== b && atOrUnder(b, o)));
    if (carrier === undefined) continue;
    // What the translate keys add to K's world origin, frame by frame, less frame 0's.
    const [lx, ly] = setupAt.get(k) ?? [0, 0];
    const pk = parent.get(k) ?? null;
    const added: Array<[number, number] | null> = geo.frameBones.map((bs) => {
      const w = world(bs, k);
      if (w === null) return null;
      const pw = pk === null ? { a: 1, b: 0, c: 0, d: 1, worldX: 0, worldY: 0 } : world(bs, pk);
      if (pw === null) return null;
      return [w.worldX - (pw.a * lx + pw.b * ly + pw.worldX), w.worldY - (pw.c * lx + pw.d * ly + pw.worldY)];
    });
    const a0 = added[0];
    if (a0 === null || added.some((d) => d === null)) continue;
    const delta = (added as Array<[number, number]>).map(([x, y]) => [x - a0[0], y - a0[1]] as const);
    const breath = Math.max(...delta.map(([x, y]) => edgeLength(x, y)));
    if (!(breath > 0)) continue;
    const share = weights.map((v) => v.filter((w) => atOrUnder(String(w.bone), k)).reduce((s, w) => s + (w.weight as number), 0));
    const held = m.shown.map((f, i) => (f === null ? null : { rest: f.rest, triangles: f.triangles, posed: f.posed.map((v, j) => v - share[j >> 1] * delta[i][j & 1]) }));
    const t = halfTravels(m.art, m.box, m.stage, held, m.toward);
    if (t.root === null || t.tip === null) continue;
    if (!(m.root - t.root > Math.max(0, m.tip - t.tip)) || round3(t.tip) === 0) continue;
    return { bone: carrier, keyed: k, breath, root: t.root, tip: t.tip, passes: t.tip >= TIP_RATIO_FLOOR * t.root };
  }
  return null;
}

/** A bone at the setup pose off the idle's geometry: its world origin, and its world x axis (a, c) when the file gives it. */
export interface SetupBone {
  x: number;
  y: number;
  a?: number;
  c?: number;
}

/**
 * Which way the chain carrying a part runs at its tip (issues #231, #322), for
 * a part the scene declares `rises`: the bones its attachments are bound to in
 * the default skin (a mesh's weights, or its slot's bone); the leaves among
 * them — those with no other of them below — walked up the bone tree to the
 * first link of a chain `CHAIN_LAG` reads ({@link chainFigures}: two or more
 * rotate-keyed links, each under the one before at one period). Each chain so
 * found is read at its **last link** ({@link chainToward}), the end
 * `TIP_OVER_ROOT`'s tip half is the art of: from the link's setup-pose origin
 * along its `length` in rig.json on its world x axis — the extent the rig
 * stage turns a link to (issue #73) — or, a last link with no length, from the
 * link before's origin to its own, the last extent the skeleton states. Until
 * #322 it was the first link's origin to the last's, which reads a chain that
 * hangs and then rises — a folded arm — as down, and on a two-link chain read
 * the first link only. `{ none }`, the reason, when no leaf is under a chain,
 * when a last link runs as far across as along, or when the part's chains run
 * different ways.
 */
export function chainDirection(rig: Record<string, unknown>, motion: Record<string, unknown>, part: string, origins: ReadonlyMap<string, SetupBone>): { toward: Toward; chains: string[] } | { none: string } {
  const { found, bound } = chainsCarrying(rig, motion, part);
  const boundText = [...bound].map((b) => `"${b}"`).join(', ') || 'no bone';
  if (found.length === 0) return { none: `it rides no chain: none of the bones it is bound to (${boundText}) is under a chain of rotate-keyed links` };
  const lengths = new Map<string, number>();
  for (const b of (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord)) if (typeof b.name === 'string' && typeof b.length === 'number' && b.length > 0) lengths.set(b.name, b.length);
  const read = found.map((c) => {
    const last = c[c.length - 1];
    const before = c[c.length - 2];
    const label = c.join(' > ');
    const z = origins.get(last);
    const len = lengths.get(last);
    if (z === undefined) return { label, toward: null, text: `${label}: no setup-pose origin for ${last} in the idle's geometry` };
    let dx: number;
    let dy: number;
    let how: string;
    if (len !== undefined) {
      if (z.a === undefined || z.c === undefined) return { label, toward: null, text: `${label}: no setup-pose axis (a, c) for its last link ${last} in the idle's geometry` };
      dx = len * z.a;
      dy = len * z.c;
      how = `its last link ${last}, from its origin along its length ${len},`;
    } else {
      const a = origins.get(before);
      if (a === undefined) return { label, toward: null, text: `${label}: no setup-pose origin for ${before} in the idle's geometry` };
      dx = z.x - a.x;
      dy = z.y - a.y;
      how = `its last link ${last}, which has no length, from ${before}'s origin to its own,`;
    }
    const toward = chainToward(dx, dy);
    return { label, toward, text: `${label}: ${how} ${toward === null ? 'runs as far across as along' : `runs ${toward}`} (${round3(dx)}, ${round3(dy)} world px)` };
  });
  const ways = [...new Set(read.map((r) => r.toward))];
  if (ways.length !== 1 || ways[0] === null) return { none: `its chains do not run one way at the tip: ${read.map((r) => r.text).join('; ')}` };
  return { toward: ways[0], chains: read.map((r) => r.text) };
}

/**
 * The chains that carry a part (issues #231, #245): the bones its attachments
 * are bound to in the default skin ({@link boundBones}); the leaves among them
 * — those with no other of them below — each walked up the bone tree to the
 * first link of a chain `CHAIN_LAG` reads ({@link chainFigures}: two or more
 * rotate-keyed links, each under the one before at one period). Each chain is
 * its links' names from the root, once, in the order the leaves find them.
 */
export function chainsCarrying(rig: Record<string, unknown>, motion: Record<string, unknown>, part: string): { found: string[][]; bound: Set<string> } {
  const bones = (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord).filter((b) => typeof b.name === 'string');
  const parent = new Map(bones.map((b) => [String(b.name), typeof b.parent === 'string' ? b.parent : null]));
  const bound = boundBones(rig, part);
  const under = (b: string, anc: string): boolean => {
    const seen = new Set<string>();
    for (let x = parent.get(b) ?? null; x !== null && !seen.has(x); x = parent.get(x) ?? null) {
      if (x === anc) return true;
      seen.add(x);
    }
    return false;
  };
  const leaves = [...bound].filter((b) => ![...bound].some((o) => o !== b && under(o, b)));
  const chains = chainFigures(rig, motion).chains.filter((c) => c.length >= 2);
  const chainOf = new Map<string, string[]>();
  for (const c of chains) for (const l of c) chainOf.set(l.bone, c.map((x) => x.bone));
  const found: string[][] = [];
  for (const leaf of leaves) {
    const seen = new Set<string>();
    for (let b: string | null = leaf; b !== null && !seen.has(b); b = parent.get(b) ?? null) {
      seen.add(b);
      const c = chainOf.get(b);
      if (c !== undefined) {
        if (!found.some((f) => f[0] === c[0])) found.push(c);
        break;
      }
    }
  }
  return { found, bound };
}

/**
 * The bone the face is measured in the frame of (issue #33): the bone every
 * `face`-tagged part's slot rides in rig.json — which is the bone the config's
 * `regions.<part>` (or, for a mesh, its first segment) names for it, carried
 * into the rig spec by the rig stage. Never a bone found by its name.
 */
export type HeadBone = { bone: string } | { none: string };

export function headBoneOf(inp: Pick<FullInputs, 'rig' | 'parts'>): HeadBone {
  const face = partsTagged(inp.parts, FACE_TAGS);
  if (face.length === 0) return { none: `no part comes from a See-through ${tagWords(FACE_TAGS)} layer` };
  const slotBone = new Map((Array.isArray(inp.rig.slots) ? inp.rig.slots : []).filter(isRecord).map((sl) => [String(sl.name), typeof sl.bone === 'string' ? sl.bone : null]));
  const bones = [...new Set(face.map((p) => slotBone.get(p.name) ?? null))];
  if (bones.length === 1 && bones[0] !== null) return { bone: bones[0] };
  return { none: `the face parts ride ${face.map((p) => `"${p.name}" on ${JSON.stringify(slotBone.get(p.name) ?? null)}`).join(', ')}; the head frame is one bone's, so they must share a slot bone` };
}

/**
 * One bone's world transform at the setup pose and on every frame of a set,
 * off the geometry {@link readGeometry} read beside those frames. A string
 * (the reason) when the set has no geometry file; a `CHECK_GEOMETRY_FILE`
 * refusal when the file disagrees with the frames it sits beside in what the
 * face half needs and the stretch does not read: the viewport (the transforms
 * would be carried onto another grid), the frame indices, the bone on the
 * setup pose and on every frame with six finite numbers, and each frame's time.
 */
export function boneTrackOf(geo: IdleGeometry | null, path: string, set: FrameSet, bone: string): BoneTrack | string {
  if (geo === null) return `${path} does not exist, so no bone's per-frame transform is known (rigc render writes it with --geometry)`;
  const gv = geo.viewport;
  const vp = set.viewport;
  const keys: Array<keyof Viewport> = ['x', 'y', 'width', 'height', 'scale', 'pixelWidth', 'pixelHeight'];
  const off = keys.filter((k) => gv?.[k] !== vp[k]);
  if (off.length > 0) return geometryProblem(path, `viewport ${off.map((k) => `${k} ${JSON.stringify(gv?.[k])}`).join(', ')}; the frames.json beside it says ${off.map((k) => `${k} ${vp[k]}`).join(', ')} — the transforms would be carried onto another grid`);
  const world = (bones: unknown, at: string): BoneWorld => {
    const b = Array.isArray(bones) ? bones.filter(isRecord).find((x) => x.name === bone) : undefined;
    if (b === undefined) return geometryProblem(path, `${at} has no bone "${bone}"`);
    const f = ['a', 'b', 'c', 'd', 'worldX', 'worldY'] as const;
    const bad = f.filter((k) => typeof b[k] !== 'number' || !Number.isFinite(b[k]));
    if (bad.length > 0) return geometryProblem(path, `${at} bone "${bone}" field(s) ${bad.map((k) => `"${k}" ${JSON.stringify(b[k])}`).join(', ')}; finite numbers are required`);
    return { a: b.a as number, b: b.b as number, c: b.c as number, d: b.d as number, worldX: b.worldX as number, worldY: b.worldY as number };
  };
  if (geo.frames.length !== set.frames.length || geo.frames.some((f, i) => f.index !== set.frames[i].index)) {
    return geometryProblem(path, `holds frame(s) [${geo.frames.map((f) => String(f.index)).join(', ')}]; the set holds [${set.frames.map((f) => f.index).join(', ')}]`);
  }
  const badTime = geo.times.findIndex((t) => typeof t !== 'number' || !Number.isFinite(t));
  if (badTime >= 0) return geometryProblem(path, `frame ${String(geo.frames[badTime].index)} field "time" is ${JSON.stringify(geo.times[badTime])}; a number of seconds is required`);
  return { bone, setup: world(geo.setupBones, 'setup'), frames: geo.frameBones.map((bs, i) => world(bs, `frame ${String(geo.frames[i].index)}`)), times: geo.times as number[] };
}

/** {@link readGeometry} then {@link boneTrackOf}, for a frame set's own `geometry.json`. */
export function readBoneTrack(set: FrameSet, bone: string): BoneTrack | string {
  const path = join(set.dir, GEOMETRY_FILE);
  return boneTrackOf(readGeometry(path, set.written), path, set, bone);
}

/**
 * What `STILL_REGIONS_DARK` is measured with, written into each half (issue
 * #123): the idle's posed geometry, not its frames. Until #123 the face half
 * compared a heat mean in the head's frame with twice the resampler's own and
 * the feet half a screen-space heat mean with a ceiling, both read off the
 * idle's pixels, so an old and a new check.json are told apart by this key.
 */
export const STILL_INSTRUMENT = 'geometry';

/** Four significant figures: a figure that may be a rounding residue near 1e-12 keeps its size rather than reading 0. */
function sig4(x: number): number {
  return x === 0 ? 0 : Number(x.toPrecision(4));
}

/**
 * The slots the idle moves on purpose, by slot rather than by bone: every slot
 * a `deform` or `sequence` entry or a slot-targeted track of the idle names.
 * A still-set candidate rides the head bone alone, so a bone track cannot move
 * it relative to that bone; what can is a key on the slot itself.
 */
function idleDrivenSlots(motion: Record<string, unknown>): Set<string> {
  const anims = isRecord(motion.animations) ? motion.animations : {};
  const idle = isRecord(anims.idle) ? anims.idle : {};
  const named = new Set<string>();
  for (const key of ['deform', 'sequence', 'tracks']) {
    const list = idle[key];
    if (!Array.isArray(list)) continue;
    for (const t of list) if (isRecord(t) && typeof t.slot === 'string') named.add(t.slot);
  }
  return named;
}

/**
 * Whether every attachment the default skin gives a slot is carried by one
 * bone alone: a region or an unweighted mesh on a slot of that bone, or a mesh
 * whose every weight names it.
 */
function ridesOnly(rig: Record<string, unknown>, slot: string, slotBone: string | undefined, bone: string): boolean {
  const skins = isRecord(rig.skins) ? rig.skins : {};
  const skin = isRecord(skins.default) ? skins.default : {};
  const atts = isRecord(skin[slot]) ? Object.values(skin[slot]) : [];
  if (atts.length === 0) return false;
  return atts.every((a) => {
    if (!isRecord(a)) return false;
    const type = a.type ?? 'region';
    if (type === 'region') return slotBone === bone;
    if (type !== 'mesh') return false;
    if (!Array.isArray(a.weights)) return slotBone === bone;
    return a.weights.every((v) => Array.isArray(v) && v.length > 0 && v.every((w) => isRecord(w) && w.bone === bone));
  });
}

/** One half's figures (issue #123): the still set's displacement in the reference frame, its tolerance, and the reported crossings. */
interface StillHalf {
  figures: Record<string, unknown>;
  over: Array<{ slot: string; max: number; frame: number }>;
  rms: number;
  tolerance: number;
}

/**
 * (7) Nothing moves that should hold still (issue #123), read off the idle's
 * posed geometry. The face half asks whether the face and the parts drawn
 * over it that the head carries keep their place relative to the head bone —
 * the bone the face's slot rides — over the idle; the feet half whether the
 * feet keep theirs on the screen (they ride the root, which the idle does not
 * key, so the screen is their own frame).
 *
 * The face's still set, derived from the rig and the motion, never from a
 * list: the `face` slots, and every slot drawn after the first of them whose
 * art overlaps a face part's art at the setup pose, whose every attachment the
 * head bone alone carries ({@link ridesOnly}), and which the idle does not key
 * by slot ({@link idleDrivenSlots}, reported as `driven_slots`). The features
 * the blink and the brows move ride bones of their own, so they are not in it.
 * The feet's still set is the `footwear` slots.
 *
 * Each still slot's art is carried through its posed attachment back into the
 * reference frame on every idle frame and compared with its setup position
 * ({@link stillReading}); the figure is the largest displacement, with the RMS
 * beside it, and the bar is the arithmetic's own tolerance
 * ({@link stillTolerance}) — nothing may move. How far another slot's art
 * swings into the region (`face` on top at the setup pose, clear of where the
 * features go; `footwear` on top) is reported per slot, `crossing`, with no
 * bar ({@link crossingOf}). No render grid enters either half.
 */
export function stillLine(inp: FullInputs, idle: FrameSet, geo: IdleGeometry | null, geometryPath: string, problems: Problem[], notPlanted: readonly string[] = []): JudgementLine {
  const face = partsTagged(inp.parts, FACE_TAGS);
  const { all: allFeet, held: feet, declared } = plantedFeet(inp.parts, notPlanted);
  if (face.length === 0 && allFeet.length === 0) return skip(`no part comes from a See-through ${tagWords([...FACE_TAGS, ...FEET_TAGS])} layer, so there is no still region to read`);
  if (geo === null) return skip(`${geometryPath} does not exist; \`rigc render --geometry\` (rig-c ${RIGC_GEOMETRY_VERSION} or later) writes it, and the still regions are read off it`);
  const H = inp.parts.rig_size[1];
  const W = inp.parts.rig_size[0];
  const poses = attachmentPoses(geometryPath, idle.written);
  const top = topmostIndex(inp.parts, (i) => readPng(join(inp.partsDir, `${inp.parts.parts[i].name}.png`)));
  const index = new Map(inp.parts.parts.map((p, i) => [p.name, i]));
  const record = new Map(inp.parts.parts.map((p) => [p.name, p]));
  const slots = (Array.isArray(inp.rig.slots) ? inp.rig.slots : []).filter(isRecord).map((sl) => ({ name: String(sl.name), bone: typeof sl.bone === 'string' ? sl.bone : undefined }));
  const slotBone = new Map(slots.map((sl) => [sl.name, sl.bone]));
  const arts = new Map<string, ArtMask>();
  const artOf = (name: string): ArtMask => {
    let a = arts.get(name);
    if (a === undefined) {
      const p = record.get(name) as PartRecord;
      a = placedArt(p.x, p.y, readPng(join(inp.partsDir, `${name}.png`)));
      arts.set(name, a);
    }
    return a;
  };
  const shownOf = (slot: string): Array<PosedTriangles | null> => poses.map((f) => f.get(slot) ?? null);
  const frameIndex = (k: number | null): number | null => (k === null ? null : idle.frames[k].index);

  /** The still set measured in one frame, and every later slot's crossing into `region`. */
  const half = (still: readonly string[], firstSlot: number, maps: readonly FrameMap[], entryMax: number, coordFloor: number, region: RigRegion): StillHalf => {
    const rows: Array<Record<string, unknown>> = [];
    const over: StillHalf['over'] = [];
    let worst: { slot: string; max: number; frame: number | null } | null = null;
    let sumSq = 0;
    let weight = 0;
    let coordMax = coordFloor;
    const readings = still.map((slot) => ({ slot, r: stillReading(artOf(slot), inp.stage, shownOf(slot), maps) }));
    for (const { r } of readings) coordMax = Math.max(coordMax, r.coordMax);
    const tolerance = stillTolerance(coordMax, entryMax);
    for (const { slot, r } of readings) {
      if (r.max === null) {
        rows.push({ slot, unmeasured: 'no idle frame shows it' });
        continue;
      }
      sumSq += r.sumSq;
      weight += r.weight;
      rows.push({ slot, max_rig_px: sig4(r.max), rms_rig_px: sig4(r.weight > 0 ? Math.sqrt(r.sumSq / r.weight) : 0) });
      if (worst === null || r.max > worst.max) worst = { slot, max: r.max, frame: frameIndex(r.frame) };
      if (r.max > tolerance) over.push({ slot, max: r.max, frame: frameIndex(r.frame) as number });
    }
    const crossing: Array<Record<string, unknown>> = [];
    for (const sl of slots.slice(firstSlot + 1)) {
      if (still.includes(sl.name) || !record.has(sl.name)) continue;
      const c = crossingOf(artOf(sl.name), inp.stage, shownOf(sl.name), maps, region);
      // Art that only touches the region within the arithmetic's tolerance has not entered it.
      if (c !== null && c.depth > tolerance) crossing.push({ slot: sl.name, depth_rig_px: round3(c.depth), area_rig_px2: round3(c.area), frame: frameIndex(c.frame) });
    }
    const rms = weight > 0 ? Math.sqrt(sumSq / weight) : 0;
    return {
      figures: {
        instrument: STILL_INSTRUMENT,
        still_slots: rows,
        max_rig_px: worst === null ? null : sig4(worst.max),
        // Where the largest displacement is, only when it is a motion: below the tolerance it is rounding, and its place is noise.
        at: worst === null || worst.max <= tolerance ? null : { slot: worst.slot, frame: worst.frame },
        rms_rig_px: sig4(rms),
        tolerance_rig_px: sig4(tolerance),
        crossing,
      },
      over,
      rms,
      tolerance,
    };
  };
  const regionOf = (idx: ReadonlySet<number>, exclude: readonly WorldBox[]): RigRegion => {
    const data = new Uint8Array(W * H);
    for (let v = 0; v < H; v++) {
      for (let u = 0; u < W; u++) {
        if (!idx.has(top[v * W + u])) continue;
        const x0 = inp.stage.x + u;
        const y1 = inp.stage.y + cropToSpineY(v, H);
        if (exclude.some((e) => x0 + 1 > e.x0 && x0 < e.x1 && y1 > e.y0 && y1 - 1 < e.y1)) continue;
        data[v * W + u] = 1;
      }
    }
    return { width: W, height: H, data };
  };
  const firstOf = (names: readonly string[]): number => Math.min(...names.map((n) => slots.findIndex((sl) => sl.name === n)).filter((i) => i >= 0));

  const faceHalf = (): Record<string, unknown> | string => {
    if (face.length === 0) return `no part comes from a See-through ${tagWords(FACE_TAGS)} layer`;
    const head = headBoneOf(inp);
    if (!('bone' in head)) return `no head bone to measure it in: ${head.none}`;
    const track = boneTrackOf(geo, geometryPath, idle, head.bone);
    if (typeof track === 'string') return track;
    const maps: FrameMap[] = [];
    for (const f of track.frames) {
      const m = setupToFrame(track.setup, f);
      if (m === null) return `the head bone "${head.bone}" has a singular setup transform, so there is no head frame to carry the face into`;
      maps.push(m);
    }
    const entries = [track.setup, ...track.frames];
    const entryMax = Math.max(...entries.map((b) => Math.max(Math.abs(b.a), Math.abs(b.b), Math.abs(b.c), Math.abs(b.d))));
    const coordFloor = Math.max(...entries.map((b) => Math.max(Math.abs(b.worldX), Math.abs(b.worldY))));
    // The features are left out of the region where they go in the head's frame, not only where they sit at rest.
    const features = partsTagged(inp.parts, FACE_FEATURE_TAGS);
    const swept: WorldBox[] = [];
    for (const p of features) {
      const ft = boneTrackOf(geo, geometryPath, idle, slotBone.get(p.name) ?? '');
      if (typeof ft === 'string') return `no track for feature "${p.name}"'s bone: ${ft}`;
      const sb = sweptBox(partWorldBox(p, H, inp.stage), ft, track);
      if (sb === null) return `feature "${p.name}"'s bone or the head bone "${head.bone}" has a singular transform on a frame, so where the feature goes in the head's frame is not known`;
      swept.push(sb);
    }
    const faceNames = face.map((p) => p.name);
    const first = firstOf(faceNames);
    const faceArt = faceNames.map(artOf);
    const overFace = (name: string): boolean => {
      const a = artOf(name);
      return faceArt.some((f) => {
        for (let y = Math.max(a.y, f.y); y < Math.min(a.y + a.height, f.y + f.height); y++) {
          for (let x = Math.max(a.x, f.x); x < Math.min(a.x + a.width, f.x + f.width); x++) if (a.data[(y - a.y) * a.width + x - a.x] === 1 && f.data[(y - f.y) * f.width + x - f.x] === 1) return true;
        }
        return false;
      });
    };
    const drivenNames = idleDrivenSlots(inp.motion);
    const driven: string[] = [];
    const still = [...faceNames];
    for (const sl of slots.slice(first + 1)) {
      if (still.includes(sl.name) || !record.has(sl.name) || !ridesOnly(inp.rig, sl.name, sl.bone, head.bone) || !overFace(sl.name)) continue;
      if (drivenNames.has(sl.name)) driven.push(sl.name);
      else still.push(sl.name);
    }
    const h = half(still, first, maps, entryMax, coordFloor, regionOf(new Set(face.map((p) => index.get(p.name) as number)), swept));
    for (const o of h.over) {
      problems.push({
        code: 'CHECK_STILL_REGIONS_DARK',
        object: `slot "${o.slot}" of the face's still set (${still.map((n) => `"${n}"`).join(', ')}), in the frame of its head bone "${head.bone}"`,
        detail: `its art moves ${sig4(o.max)} rig px relative to that bone at idle frame ${o.frame} (RMS over the still set ${sig4(h.rms)}); at most ${sig4(h.tolerance)} rig px is required — the arithmetic's own rounding, so nothing may move — a mesh over the face weighted to a bone the head does not carry, or the face mesh deformed by another bone`,
      });
    }
    return { parts: faceNames, head_bone: head.bone, ...h.figures, driven_slots: driven };
  };

  const feetHalf = (): Record<string, unknown> | string => {
    if (allFeet.length === 0) return `no part comes from a See-through ${tagWords(FEET_TAGS)} layer`;
    if (feet.length === 0) return noneHeldText(declared);
    const names = feet.map((p) => p.name);
    const h = half(names, firstOf(names), poses.map(() => null), 1, 0, regionOf(new Set(feet.map((p) => index.get(p.name) as number)), []));
    for (const o of h.over) {
      problems.push({
        code: 'CHECK_STILL_REGIONS_DARK',
        object: `slot "${o.slot}" of the feet (${names.map((n) => `"${n}"`).join(', ')}), in screen space`,
        detail: `its art moves ${sig4(o.max)} rig px at idle frame ${o.frame} (RMS over the feet ${sig4(h.rms)}); at most ${sig4(h.tolerance)} rig px is required — the arithmetic's own rounding — something that should hold still moves: a mesh weighted to a swinging bone, or a part that rides the wrong bone`,
      });
    }
    return { parts: names, ...h.figures };
  };

  const f = faceHalf();
  const t = feetHalf();
  if (typeof f === 'string' && typeof t === 'string') return skip(`face: ${f}; feet: ${t}`);
  const failed = problems.some((q) => q.code === 'CHECK_STILL_REGIONS_DARK');
  // Issue #231: a declaration is the feet half's first figure, measured or not.
  const said = declared.length === 0 ? {} : { declared_not_planted: declared };
  return { status: failed ? 'FAIL' : 'PASS', face: typeof f === 'string' ? { unmeasured: f } : f, feet: typeof t === 'string' ? { ...said, unmeasured: t } : { ...said, ...t } };
}

function fmt3(x: number): string {
  return x.toFixed(3);
}

/** The scene file's `rests` parts as `CHAIN_LAG` reads them (issue #245), and the file they were read from. */
export interface ChainRests {
  path: string;
  rests: readonly string[];
}

const NO_CHAIN_RESTS: ChainRests = { path: '', rests: [] };

/**
 * (3) Down every chain the phase lags and the amplitude does not shrink, read off motion.json's rotate tracks.
 *
 * Issue #245: a chain that carries a part the scene file declares `rests` ({@link chainsCarrying}) is held to the
 * opposite amplitude relation — non-increasing toward the tip, the tip moving no more than the root, as
 * `TIP_OVER_ROOT` holds the part. The lag is not relaxed: the declaration says how far the tip moves, not when.
 * The declared parts are the line's first figure (`declared_rests`), and the chains they hold, `resting_chains`,
 * follow it; a declared part no chain carries is named in neither. Without the field the line is the one written
 * before.
 */
export function chainLine(inp: Pick<CheckInputs, 'rig' | 'motion'>, problems: Problem[], declared: ChainRests = NO_CHAIN_RESTS): JudgementLine {
  const cf = chainFigures(inp.rig, inp.motion);
  const long = cf.chains.filter((c) => c.length >= 2);
  // Issue #245: each resting chain by its first link, with the declared parts that ride it, in the file's order.
  const resting = new Map<string, string[]>();
  for (const part of declared.rests) {
    for (const c of chainsCarrying(inp.rig, inp.motion, part).found) resting.set(c[0], [...(resting.get(c[0]) ?? []), part]);
  }
  const restingChains = long.filter((c) => resting.has(c[0].bone));
  const said = declared.rests.length === 0 ? {} : { declared_rests: [...declared.rests], resting_chains: restingChains.map((c) => c.map((l) => l.bone).join(' > ')) };
  if (cf.edges.length === 0 && long.length === 0) {
    return skip(`no idle "rotate" track sits under another at the same period${cf.unread.length > 0 ? ` (unread, not sampled sines: ${cf.unread.join(', ')})` : ''}, so there is no chain to lag`);
  }
  const violations: string[] = [];
  for (const e of cf.edges) {
    if (round3(e.step) < CHAIN_LAG_MIN_STEP) {
      const v = `"${e.child}" follows its keyed ancestor "${e.parent}" by ${fmt3(e.step)} cycle(s)`;
      violations.push(v);
      problems.push({ code: 'CHECK_CHAIN_LAG', object: `bone "${e.child}" under "${e.parent}"`, detail: `phase step ${fmt3(e.step)} cycle(s); >= ${CHAIN_LAG_MIN_STEP} is required — a link must lag the one above it (a larger "phase", or a positive "lag" on the chain track)` });
    }
  }
  for (const c of long) {
    const rests = resting.get(c[0].bone);
    for (let i = 1; i < c.length; i++) {
      const a = round3(c[i - 1].reading.amp);
      const b = round3(c[i].reading.amp);
      if (rests !== undefined) {
        if (b > a) {
          violations.push(`"${c[i].bone}" swings ${fmt3(b)} over "${c[i - 1].bone}"'s ${fmt3(a)} in a chain declared resting`);
          problems.push({
            code: 'CHECK_CHAIN_LAG',
            object: `bone "${c[i].bone}" in the chain from "${c[0].bone}", which carries ${rests.map((n) => `"${n}"`).join(', ')}, declared rests by ${declared.path}`,
            detail: `amplitude ${fmt3(b)} above the link above's ${fmt3(a)}; non-increasing down the chain is required — the scene file's rests declares the tip at rest, so it moves no more than the root ("amps" shrink toward the tip)`,
          });
        }
        continue;
      }
      if (b < a) {
        violations.push(`"${c[i].bone}" swings ${fmt3(b)} under "${c[i - 1].bone}"'s ${fmt3(a)}`);
        problems.push({ code: 'CHECK_CHAIN_LAG', object: `bone "${c[i].bone}" in the chain from "${c[0].bone}"`, detail: `amplitude ${fmt3(b)} below the link above's ${fmt3(a)}; non-decreasing down the chain is required — "amps" grow toward the tip` });
      }
    }
  }
  const minStep = cf.edges.length === 0 ? null : round3(Math.min(...cf.edges.map((e) => e.step)));
  return {
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    ...said,
    chains: long.map((c) => `${c.map((l) => l.bone).join(' > ')}: period ${round3(c[0].reading.period)}s, phase ${c.map((l) => fmt3(l.reading.phase)).join(' ')}, amp ${c.map((l) => fmt3(l.reading.amp)).join(' ')}`),
    lags: cf.edges.map((e) => `${e.parent} > ${e.child} ${e.step >= 0 ? '+' : ''}${fmt3(e.step)}`),
    min_step: minStep,
    step_floor: CHAIN_LAG_MIN_STEP,
    other_period: cf.otherPeriod.map((e) => `${e.parent} > ${e.child}`),
    unread: cf.unread,
    first_violation: violations[0] ?? null,
  };
}

function sameViewport(a: Viewport, b: Viewport): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.scale === b.scale && a.pixelWidth === b.pixelWidth && a.pixelHeight === b.pixelHeight;
}

/** (2) The setup pose with the blink tracks held at their closed value, against the setup pose, inside the eye box. */
function blinkLine(
  inp: CheckInputs,
  eyes: readonly PartRecord[],
  shut: ReturnType<typeof blinkTracks>,
  open: FrameSet,
  closed: FrameSet,
  idle: FrameSet,
  H: number,
  problems: Problem[],
): JudgementLine {
  if (!sameViewport(open.viewport, closed.viewport)) return skip(`the closed-eye render's grid ${JSON.stringify(closed.viewport)} is not the setup still's ${JSON.stringify(open.viewport)}, so the two cannot be compared pixel for pixel`);
  const box = frameBox(eyes, H, inp.stage, open.viewport);
  if (box === null) return skip('the eye box falls outside the setup-pose frame');
  const b = blinkFigures(open.frames[0].image, closed.frames[0].image, open.background, box, BLINK_PATCH_LEVEL);
  const from = Math.max(...shut.map((s) => s.window[0]));
  const to = Math.min(...shut.map((s) => s.window[1]));
  const frames = framesInside(from, to, idle.fps, idle.sampled);
  if (b.holePx > BLINK_HOLE_BAR) {
    problems.push({
      code: 'CHECK_BLINK_NO_HOLE',
      object: `the eye box ${boxLabel(box)} (${quoteParts(eyes)}) with the eyes shut`,
      detail: `${b.holePx} px show the background where the open eye had art; ${BLINK_HOLE_BAR} is required — the layer under the eye has no art there (See-through left it empty), so a closed eye opens a hole`,
    });
  }
  return {
    status: b.holePx > BLINK_HOLE_BAR ? 'FAIL' : 'PASS',
    eye_parts: eyes.map((p) => p.name),
    closed: shut.map((s) => `${'bone' in s.target ? `bone ${s.target.bone}` : `group ${s.target.group}`} scaley ${s.closed} from ${s.window[0]}s to ${s.window[1]}s`),
    idle_frames_closed: frames,
    box_px: b.px,
    hole_px: b.holePx,
    hole_bar: BLINK_HOLE_BAR,
    patch_max: b.patchMax,
    patch_px_over_40: b.patchOver,
  };
}

// ---------------------------------------------------------------------------
// texture stretch (issue #31): rigc's geometry export
// ---------------------------------------------------------------------------

/** `major.minor.patch` of a `rigc --version` line, or null when it holds none. */
export function parseRigcVersion(out: string): [number, number, number] | null {
  const m = /^\s*(\d+)\.(\d+)\.(\d+)/.exec(out);
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Refuse, before anything is built, a rigc older than
 * {@link RIGC_GEOMETRY_VERSION}: its `render` has no `--geometry`, so the idle
 * render would fail on the flag after the build had run, and
 * the refusal would name a flag rather than the version that lacks it.
 * Returns what `--version` printed, stdout then stderr, which is where
 * {@link readRigcEntry} reads the entry.
 */
export function requireRigcVersion(rigc: RigcRunner): string {
  const v = rigc(['--version']);
  const got = v.status === 0 ? parseRigcVersion(v.out) : null;
  const need = parseRigcVersion(RIGC_GEOMETRY_VERSION) as [number, number, number];
  const below = got !== null && (got[0] - need[0] || got[1] - need[1] || got[2] - need[2]) < 0;
  if (got === null || below) {
    refuseIfAny([
      {
        code: 'CHECK_RIGC_VERSION',
        object: '`rigc --version`',
        detail: `${got === null ? `exit ${v.status}, printed ${JSON.stringify(v.out.trim().split('\n')[0] ?? '')} — no version` : `is ${got.join('.')}`}${rigcRanClause(v)}; rig-c ${RIGC_GEOMETRY_VERSION} or later is required — its \`render --geometry\` writes the skinned mesh vertices TEXTURE_STRETCH is measured from (\`bun install\` puts this package's own rig-c at node_modules/.bin/rigc)`,
      },
    ]);
  }
  return v.out;
}

export interface IdleGeometry {
  meshes: MeshRest[];
  frames: GeometryPose[];
  /** The rest, carried as read for {@link boneTrackOf}, which checks what it uses: the viewport, the setup pose's and each frame's `bones`, each frame's `time`. */
  viewport: Record<string, unknown> | null;
  setupBones: unknown;
  frameBones: unknown[];
  times: unknown[];
}

function geometryProblem(object: string, detail: string): never {
  refuseIfAny([{ code: 'CHECK_GEOMETRY_FILE', object, detail }]);
  throw new Error('unreachable');
}

function numberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));
}

/**
 * The mesh half of a `rigc-geometry/1` file: every `rest` entry of kind
 * `mesh`, and each frame's attachments. Null when the file does not exist
 * (the line then says SKIP, naming it); a file that exists and does not hold
 * `frames` frames of well-formed vertices is refused naming what is wrong,
 * because a figure read off a half-written export would be a wrong number
 * printed as a measurement.
 */
export function readGeometry(path: string, frames: number): IdleGeometry | null {
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return geometryProblem(path, `does not parse as JSON: ${(err as Error).message}`);
  }
  if (!isRecord(raw) || raw.spec !== GEOMETRY_SPEC) return geometryProblem(path, `"spec" is ${JSON.stringify(isRecord(raw) ? raw.spec : raw)?.slice(0, 40)}; ${JSON.stringify(GEOMETRY_SPEC)} is required`);
  if (!Array.isArray(raw.rest) || !Array.isArray(raw.frames)) return geometryProblem(path, 'lacks "rest" or "frames"; a rigc-geometry/1 file carries both');
  if (raw.frames.length !== frames) return geometryProblem(path, `holds ${raw.frames.length} frame(s); the frame set beside it wrote ${frames}`);
  const meshes: MeshRest[] = [];
  for (const [i, r] of raw.rest.entries()) {
    if (!isRecord(r) || r.kind !== 'mesh') continue;
    const at = `rest[${i}] (slot ${JSON.stringify(r.slot)}, attachment ${JSON.stringify(r.attachment)})`;
    if (typeof r.slot !== 'string' || typeof r.attachment !== 'string') return geometryProblem(path, `${at} has no string "slot" and "attachment"`);
    if (!numberArray(r.vertices) || r.vertices.length % 2 !== 0) return geometryProblem(path, `${at} "vertices" is not an even-length array of finite numbers`);
    const n = r.vertices.length / 2;
    const tri = r.triangles;
    if (!numberArray(tri) || tri.length % 3 !== 0 || !tri.every((x) => Number.isInteger(x) && x >= 0 && x < n)) return geometryProblem(path, `${at} "triangles" is not index triplets into its ${n} vertices`);
    meshes.push({ slot: r.slot, attachment: r.attachment, vertices: r.vertices, triangles: tri });
  }
  const want = new Map(meshes.map((m) => [`${m.slot}\u0000${m.attachment}`, m.vertices.length]));
  const poses: GeometryPose[] = [];
  for (const [i, f] of raw.frames.entries()) {
    if (!isRecord(f) || typeof f.index !== 'number' || !Array.isArray(f.attachments)) return geometryProblem(path, `frames[${i}] has no "index" or "attachments"`);
    const attachments: GeometryPose['attachments'][number][] = [];
    for (const a of f.attachments) {
      if (!isRecord(a) || typeof a.slot !== 'string' || typeof a.attachment !== 'string') continue;
      const n = want.get(`${a.slot}\u0000${a.attachment}`);
      if (n === undefined) continue;
      if (!numberArray(a.vertices) || a.vertices.length !== n) {
        return geometryProblem(path, `frame ${f.index} mesh "${a.slot}" attachment "${a.attachment}" has ${Array.isArray(a.vertices) ? a.vertices.length : 'no'} vertex number(s); its rest entry has ${n}`);
      }
      attachments.push({ slot: a.slot, attachment: a.attachment, vertices: a.vertices });
    }
    poses.push({ index: f.index, attachments });
  }
  return {
    meshes,
    frames: poses,
    viewport: isRecord(raw.viewport) ? raw.viewport : null,
    setupBones: isRecord(raw.setup) ? raw.setup.bones : undefined,
    frameBones: raw.frames.map((f) => (isRecord(f) ? f.bones : undefined)),
    times: raw.frames.map((f) => (isRecord(f) ? f.time : undefined)),
  };
}

/**
 * Every attachment a `rigc-geometry/1` file shows, frame by frame, keyed by
 * its slot: the posed vertices with the rest vertices and triangles of the
 * same slot and attachment — regions and meshes alike, which a seam
 * requirement reads (issue #111). Read only for a `seam` requirement, so a
 * run without one reads the file exactly as before ({@link readGeometry}).
 * A file that is not a whole export of `frames` frames — a rest entry without
 * well-formed vertices and triangles, a frame showing an attachment with no
 * rest entry or another vertex count — is refused naming what is wrong.
 */
export function attachmentPoses(path: string, frames: number): Array<Map<string, PosedAttachment>> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return geometryProblem(path, `does not read as JSON: ${(err as Error).message}`);
  }
  if (!isRecord(raw) || !Array.isArray(raw.rest) || !Array.isArray(raw.frames)) return geometryProblem(path, 'lacks "rest" or "frames"; a rigc-geometry/1 file carries both');
  if (raw.frames.length !== frames) return geometryProblem(path, `holds ${raw.frames.length} frame(s); the frame set beside it wrote ${frames}`);
  const rest = new Map<string, { vertices: number[]; triangles: number[] }>();
  for (const [i, r] of raw.rest.entries()) {
    if (!isRecord(r) || typeof r.slot !== 'string' || typeof r.attachment !== 'string') return geometryProblem(path, `rest[${i}] has no string "slot" and "attachment"`);
    const at = `rest[${i}] (slot ${JSON.stringify(r.slot)}, attachment ${JSON.stringify(r.attachment)})`;
    if (!numberArray(r.vertices) || r.vertices.length % 2 !== 0) return geometryProblem(path, `${at} "vertices" is not an even-length array of finite numbers`);
    const n = r.vertices.length / 2;
    const tri = r.triangles;
    if (!numberArray(tri) || tri.length % 3 !== 0 || !tri.every((x) => Number.isInteger(x) && x >= 0 && x < n)) return geometryProblem(path, `${at} "triangles" is not index triplets into its ${n} vertices`);
    rest.set(`${r.slot}\u0000${r.attachment}`, { vertices: r.vertices, triangles: tri });
  }
  return raw.frames.map((f, i) => {
    if (!isRecord(f) || !Array.isArray(f.attachments)) return geometryProblem(path, `frames[${i}] has no "attachments"`);
    const shown = new Map<string, PosedAttachment>();
    for (const a of f.attachments) {
      if (!isRecord(a) || typeof a.slot !== 'string' || typeof a.attachment !== 'string') return geometryProblem(path, `frames[${i}] holds an attachment with no string "slot" and "attachment"`);
      const r = rest.get(`${a.slot}\u0000${a.attachment}`);
      if (r === undefined) return geometryProblem(path, `frames[${i}] shows slot "${a.slot}" attachment "${a.attachment}", which "rest" has no entry for`);
      if (!numberArray(a.vertices) || a.vertices.length !== r.vertices.length) return geometryProblem(path, `frames[${i}] slot "${a.slot}" attachment "${a.attachment}" has ${Array.isArray(a.vertices) ? a.vertices.length : 'no'} vertex number(s); its rest entry has ${r.vertices.length}`);
      shown.set(a.slot, { rest: r.vertices, posed: a.vertices, triangles: r.triangles });
    }
    return shown;
  });
}

function stretchAtText(s: { triangle: number; vertices: readonly number[]; edge: readonly number[]; frame: number }): string {
  return `triangle ${s.triangle} (vertices ${s.vertices.join(' ')}), edge ${s.edge.join('-')}, idle frame ${s.frame}`;
}

/**
 * Issue #314: what a failing edge's two vertices hang on, read off rig.json and motion.json — so the cause reads off
 * the line rather than off a hand decoding of the weight runs. Each vertex's bones from the default skin's weights,
 * the largest two by weight (equal weights in rig.json's order), with how many it has; then every bone named, grouped
 * by the idle chain it hangs on — the nearest link at or above it of a chain `CHAIN_LAG` reads
 * ({@link chainFigures}: two or more rotate-keyed links at one period), each chain named once, by its first link — and
 * the bones on none. A mesh with no weights rides its slot's bone, and an attachment the skin does not hold, or a
 * vertex its weights do not reach, is said rather than guessed.
 */
export function edgeBonesText(rig: Record<string, unknown>, motion: Record<string, unknown>, slot: string, attachment: string, edge: readonly number[]): string {
  const skins = isRecord(rig.skins) ? rig.skins : {};
  const skin = isRecord(skins.default) ? skins.default : {};
  const onSlot = isRecord(skin[slot]) ? skin[slot] : {};
  const att = onSlot[attachment];
  if (!isRecord(att)) return `its weights are not read: rig.json's default skin holds no attachment "${attachment}" on slot "${slot}"`;
  if (!Array.isArray(att.weights)) {
    const sl = (Array.isArray(rig.slots) ? rig.slots : []).filter(isRecord).find((x) => x.name === slot);
    return `the mesh carries no weights, so vertex ${edge.join(' and vertex ')} ride slot "${slot}"'s bone ${sl !== undefined && typeof sl.bone === 'string' ? `"${sl.bone}"` : '(rig.json names none)'}`;
  }
  const weights = att.weights;
  const missing = edge.filter((v) => !Array.isArray(weights[v]));
  if (missing.length > 0) return `its weights are not read: rig.json's mesh "${attachment}" weights ${weights.length} vertices, and vertex ${missing.join(' and ')} is not among them`;
  const named: string[] = [];
  const parts = edge.map((v, i) => {
    const list = (weights[v] as unknown[]).filter(isRecord).filter((w) => typeof w.bone === 'string' && typeof w.weight === 'number') as Array<{ bone: string; weight: number }>;
    const top = [...list].sort((a, b) => b.weight - a.weight).slice(0, 2);
    for (const w of top) if (!named.includes(w.bone)) named.push(w.bone);
    const shown = top.map((w) => `"${w.bone}" ${w.weight}`).join(', ');
    return `${i === 0 ? `vertex ${v} is weighted to` : `vertex ${v} to`} ${shown}${list.length > 2 ? ` (the largest 2 of ${list.length})` : ''}`;
  });
  const bones = (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord);
  const parent = new Map(bones.filter((b) => typeof b.name === 'string').map((b) => [String(b.name), typeof b.parent === 'string' ? b.parent : null]));
  const firstLink = new Map<string, string>();
  for (const c of chainFigures(rig, motion).chains) if (c.length >= 2) for (const l of c) firstLink.set(l.bone, c[0].bone);
  const carries = new Map<string, string[]>();
  const none: string[] = [];
  for (const b of named) {
    let chain: string | null = null;
    const seen = new Set<string>();
    for (let x: string | null = b; x !== null && !seen.has(x); x = parent.get(x) ?? null) {
      const f = firstLink.get(x);
      if (f !== undefined) {
        chain = f;
        break;
      }
      seen.add(x);
    }
    if (chain === null) none.push(b);
    else carries.set(chain, [...(carries.get(chain) ?? []), b]);
  }
  const quoted = (l: readonly string[]): string => l.map((n) => `"${n}"`).join(', ');
  const chains =
    carries.size === 0
      ? 'none of these bones hangs on a chain of the idle'
      : `on the idle's chains, ${[...carries].map(([c, l]) => `the chain from "${c}" carries ${quoted(l)}`).join(' and ')}${none.length === 0 ? '' : `, and ${quoted(none)} ${none.length === 1 ? 'hangs' : 'hang'} on none`}`;
  return `${parts.join(' and ')}; ${chains}`;
}

/**
 * (6) No visible texture stretch: for every mesh triangle, each edge's length
 * in each idle frame over its rest length (the setup pose's bones, no deform —
 * which on both examples is the art's own proportions, the attachment's `uvs`
 * times its size, to 2.4e-5). The figure is the rig's worst max(ratio,
 * 1/ratio); each mesh's largest and smallest ratio, and where, are the detail.
 * SKIP when the render wrote no geometry file or the rig draws no mesh. With
 * `bound`, the rig and motion `check` read, a failing edge's line also names the
 * bones its two vertices hang on and their chains ({@link edgeBonesText}, issue
 * #314).
 */
export function stretchLine(geo: IdleGeometry | null, path: string, problems: Problem[], bound?: Pick<CheckInputs, 'rig' | 'motion'>): JudgementLine {
  if (geo === null) return skip(`${path} does not exist; \`rigc render --geometry\` (rig-c ${RIGC_GEOMETRY_VERSION} or later) writes it, and the skinned mesh vertices are read from it`);
  if (geo.meshes.length === 0) return skip('the rig draws no mesh attachment (every slot is a region), so there is no triangle to stretch');
  const figures = stretchFigures(geo.meshes, geo.frames);
  const rows: Array<Record<string, unknown>> = [];
  let worst: { mesh: (typeof figures)[number]; at: NonNullable<(typeof figures)[number]['max']>; severity: number } | null = null;
  let maxAll: number | null = null;
  let minAll: number | null = null;
  let failed = false;
  for (const m of figures) {
    if (m.degenerate.length > 0) {
      failed = true;
      problems.push({
        code: 'CHECK_TEXTURE_STRETCH',
        object: `mesh "${m.slot}" attachment "${m.attachment}"`,
        detail: `${m.degenerate.length} rest edge(s) of length 0, the first triangle ${m.degenerate[0].triangle} edge ${m.degenerate[0].edge.join('-')}; no stretch ratio can be read off an edge with no rest length — two of the mesh's vertices coincide at the setup pose`,
      });
    }
    if (m.max === null || m.min === null) {
      rows.push({ slot: m.slot, triangles: m.triangles, unmeasured: 'no idle frame shows this attachment' });
      continue;
    }
    const sMax = stretchSeverity(m.max.ratio);
    const sMin = stretchSeverity(m.min.ratio);
    const at = sMin > sMax ? m.min : m.max;
    const severity = round3(Math.max(sMax, sMin));
    if (worst === null || severity > worst.severity) worst = { mesh: m, at, severity };
    maxAll = maxAll === null ? m.max.ratio : Math.max(maxAll, m.max.ratio);
    minAll = minAll === null ? m.min.ratio : Math.min(minAll, m.min.ratio);
    rows.push({ slot: m.slot, triangles: m.triangles, max_ratio: round3(m.max.ratio), max_at: stretchAtText(m.max), min_ratio: round3(m.min.ratio), min_at: stretchAtText(m.min), severity });
    if (severity > TEXTURE_STRETCH_CEILING) {
      failed = true;
      problems.push({
        code: 'CHECK_TEXTURE_STRETCH',
        object: `mesh "${m.slot}" ${stretchAtText(at)}`,
        detail: `the edge is ${round3(at.ratio)} times its rest length (max(ratio, 1/ratio) ${severity}); <= ${TEXTURE_STRETCH_CEILING} is required${bound === undefined ? '' : `; ${edgeBonesText(bound.rig, bound.motion, m.slot, m.attachment, at.edge)}`} — the texture on it is ${at.ratio >= 1 ? 'stretched' : 'squeezed'}: the bones this mesh is weighted to move apart (amplitudes too large down a chain), or a vertex blends bones that move against each other`,
      });
    }
  }
  if (worst === null) return { status: 'SKIP', reason: `no idle frame shows any of the rig's ${figures.length} mesh(es): ${figures.map((m) => `"${m.slot}"`).join(', ')}` };
  return {
    status: failed ? 'FAIL' : 'PASS',
    meshes: figures.length,
    triangles: figures.reduce((n, m) => n + m.triangles, 0),
    frames: geo.frames.length,
    severity: worst.severity,
    severity_ceiling: TEXTURE_STRETCH_CEILING,
    worst: { slot: worst.mesh.slot, triangle: worst.at.triangle, vertices: worst.at.vertices, edge: worst.at.edge, frame: worst.at.frame, ratio: round3(worst.at.ratio) },
    max_ratio: round3(maxAll as number),
    min_ratio: round3(minAll as number),
    per_mesh: rows,
  };
}
