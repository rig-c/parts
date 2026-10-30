import { SETUP_PAINTING_LINE, setupPaintingLines } from './setuppainting.ts';
import { writeMaterialSources } from './cutmaterialio.ts';
import { CUT_MATERIAL_LINE, CUT_MATERIAL_SOURCES, materialLines } from './cutmaterial.ts';
import { ART_JOINT_LINE, artJointLines } from './artjoints.ts';
import { applyTakenLayers } from './takelayers.ts';
import { ownershipLines, provenanceLines } from './provenance.ts';
import { readSourceDepth } from './depthsheets.ts';
import { orderedBaseAnchor } from './baseanchor.ts';
import { alternateLayerSources, alternateLayerIslands, alternateLayerOthers } from './alternatelayers.ts';
import { setFocusProblems } from './setfocus.ts';
/**
 * The stages as callable units, and `build`, which runs three of them in a row.
 *
 * Each command in `cli.ts` — `assemble`, `rig`, `check`, `loop` — is a thin
 * flag parser over one function here, and `build` calls the same functions in
 * the same process. That is the whole reason this file exists: a driver that
 * re-implemented a stage (or re-spawned the CLI and parsed its text) would be a
 * second copy that could drift from the command it claims to run. What a
 * stage prints, it prints through the `Log` it is handed, so `build` reads the
 * very lines the command prints, under a `[stage]` prefix.
 *
 *     build = assemble -> rig -> check [-> loop]
 *
 * `propose` is deliberately not a step. A config with bones is the input to
 * `build`: the proposal is a starting point to be corrected against its
 * overlay, and a driver that fed the proposal straight to `rig` would turn a
 * draft into a rig with nobody having looked at it.
 *
 * `build --out <dir>` receives:
 *
 * | path | from |
 * | --- | --- |
 * | `parts/<name>.png`, `parts.json`, `recomposite_rig.png`, `recomposite_error_rig.png` | assemble — the loose parts, an intermediate, and the error map of their flat stack |
 * | `rig/` (`rig.json`, `motion.json`, `mesh_report.json`, `images/`) | rig |
 * | `check/` (`build/` with the packed atlas, both gate files, `idle_frames/`, `contact.png`, `motion_heat.png`, `check.json`) | check |
 * | `idle.png` (lossless APNG), `idle-indexed.png` (indexed APNG), `idle.gif` | loop, with `--loop`, from `check/idle_frames/` |
 *
 * The artifact is `check/build/skeleton.json`, `.atlas` and the packed page
 * (issue #2): the last lines of a green build are the pack line and those
 * three paths.
 *
 * Emit only after green, stage by stage: each stage writes only after its own
 * checks, and `build` stops at the first stage that refuses — printing that
 * stage's own FAIL lines — so nothing downstream of a red is written. The paths
 * `build` owns under `--out` (the table above, and nothing else) are removed
 * before the first stage runs, so a file left by an earlier run cannot sit
 * beside a later run's refusal looking current.
 *
 * Pure in the sense `src/` is held to: no clock, no randomness, no network and
 * no child process. rig-c runs as a process, but the process is injected
 * as a {@link RigcRunner}, exactly as `src/check.ts` takes it.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type AnimFrame, EncodeError, encodeApng, encodeIndexedApng, INDEXED_DEFAULTS } from './apng.ts';
import { assemble, type AssembleResult, cutLines, type ExcludedCount, excludedLines, setExclusions, islandLines, setIslandSources, type IslandCount, hiddenLines, SINGLE_RUN_FACE_TAGS, singleRunHeadBox, softOcclusionLine, driftLine, limbLines, FIGURE_MASK_FILE, figuresLine, holeKindsLine, holeLines, measureRecomposite, type ProjectRule, recomposite, recompositeRecord, scenePhrase, type SeamRule, sourceInRig, stageFields, uncoveredLine } from './assemble.ts';
import { allocationClause, type Reducer, stageBClause, unboundedClause } from './automesh.ts';
import { residualClause } from './autoenvelope.ts';
import { type AutoMotionCase, failingRows, idleSchedule, localRow, motionClause, motionDeformation, motionDocument, motionInput, motionRowText, motionStimulus, motionVerdict, noStimulusProblem, prepareComparison, type ReplayCandidate, runComparison, runPreparedComparison, sourceSelfFailure, stimulusMotion, withStimulus } from './automotion.ts';
import {
  bisectAccepted,
  budgetProblem,
  type CountedProbe,
  finalVerdict,
  gridFrameIds,
  maxReplays,
  MULTI_INTERVAL_RULE,
  type MultiIntervalRow,
  multiIntervalSearch,
  noMultiReductionProblem,
  noReductionProblem,
  passingIntervals,
  readingText,
  REPLAY_RULE,
  type ReplayProbe,
  type ReplayRow,
  roleReadings,
  rolesProblem,
  selectionSchedule,
  splitSchedule,
  untestedIntervals,
} from './autoreplay.ts';
import { besideIdleLine, checkSummaryLine, inputFileRecord, type InputFileRecord, CLOTH_LINE, type ClothLine, clothWarnText, frameRuns, MOTION_SEAM_LINE, type MotionSeamLine, type MotionSeamPlant, motionSeamWarnText, FOLD_LINE, type FoldsLine, LEVEL_LINE, type LevelLine, LIMB_LINE, type LimbLine, STRESS_LINE, SWEEP_LINE, type SweepLine, buildGateLines, causeLines, environmentLine, IDLE_FPS, IDLE_MAX_PX, maxRgbDiff, REQUIREMENTS_DIR, type CheckReport, type PackLine, DEFAULT_PACK_SHAPE, DEFAULT_PAGE_EDGES, GATE_PROFILE, JUDGEMENT_LINES, type JudgementLine, packedBuildArgs, packedBuildLabel, type PackMode, readCheckEnvironment, readWindBand, type PackShape, type PageEdges, readFrameSet, rigcFailed, rigcIdentity, rigcRanClause, REPORTED_LINES, type ReportedLine, type RigcRunner, runCheck, SEAM_DIR, SEAM_MEAN_BAR, seamPairText, seamRigPxText, SOURCE_LINE, SEAM_PX_BAR, SEAM_PX_LEVEL, SEAM_PX_LEVEL_HIGH, SPINEBOY_YARDSTICK, STILL_DIR, WIND_BAND_LINE, windBandLines } from './check.ts';
import { type Cut, type Extend, type Limb, loadConfigAndAnimations, loadConfigWithBytes, loadEarlyConfig, type Patch, type PlanEntry } from './config.ts';
import { coreCompileGuideLine, failLine, PartsError, type Problem, refuseIfAny } from './errors.ts';
import type { MeshQualityReport, MotionSchedule } from '@rig-c/core/mesh';
import { encodeGif } from './gif.ts';
import { CONTROL_SUFFIX, withAnimations } from './motion.ts';
import type { PaletteError } from './palette.ts';
import { type LayerSet, readLayers } from './layers.ts';
import { placeBoneEntriesForSkeleton, poseBoneEntriesForDrawn, REGISTER_OFFSET_BAR, REGISTER_SCALE_BAR, registeredWithinBar, registerSkeleton, SKELETON_LIMB_BONES, skeletonDrawnLength, skeletonLimbJoints } from './limbs.ts';
import { type AlternatePartsRecord, FRONT_SUFFIX, type PartRecord, readParts, type RecompositeRecord, type SingleRunPad, tagOf, writeParts } from './parts.ts';
import { encodePngBytes, readPng, writePng } from './raster/png.ts';
import type { Raster } from './raster/types.ts';
import { type Mask, newMask } from './raster/types.ts';
import { type OtherLimbs, splitLines, capOwnershipLines, type SplitCount } from './assemble.ts';
import type { BoneEntry } from './config.ts';
import { OPAQUE_ALPHA_ABOVE } from './layers.ts';
import { readRequirements, type RequirementLine, summaryText } from './requirements.ts';
import { type AutoMeshReport, buildRig, DEFAULT_IDLE_KEYS, type FaceAxis, type IdleKeys, type MeshReport, type RigCommand, rigJsonText, type RigOutput, type RigSpec, SETS_FILE, type StrayCleared, type TurnRow } from './rig.ts';
import { KEYPOINT_NAMES, type KeypointName, type PosePoints } from './skeleton.ts';
import { AUTHOR_NO_ROLE, isAuthorTag } from './tags.ts';
import { TURN_BONE } from './turn.ts';
import { pyRound } from './round.ts';
import { LAYOUT_FILE, layoutCompanion, refreshLimbLayout } from './limblayout.ts';

/** Where a stage's lines go. The commands hand it `console.log`; `build` hands it a prefixing wrapper. */
export type Log = (line: string) => void;

// ---------------------------------------------------------------------------
// assemble
// ---------------------------------------------------------------------------

/** The painting, refused by name when it is missing or is not a PNG. */
export function readSource(path: string): Raster {
  if (!existsSync(path)) {
    throw new PartsError([{ code: 'ASSEMBLE_SOURCE_PRESENT', object: path, detail: 'no such file; the painting the two runs were made from is required' }]);
  }
  try {
    return readPng(path);
  } catch (err) {
    throw new PartsError([{ code: 'ASSEMBLE_SOURCE_DECODES', object: path, detail: `${(err as Error).message}; a PNG is required` }]);
  }
}

/**
 * Read both runs, collecting the refusals of both before throwing. With no
 * head run (`head` null, issue #359) the full run is read once and stands for
 * both, and `single` says so: the stage then holds it to `checkSingleRun`.
 */
export function readRuns(full: string, head: string | null): { full: LayerSet; head: LayerSet; single: boolean } {
  const problems: Problem[] = [];
  const one = (path: string): LayerSet | null => {
    try {
      return readLayers(path);
    } catch (err) {
      if (err instanceof PartsError) {
        problems.push(...err.problems);
        return null;
      }
      throw err;
    }
  };
  const f = one(full);
  const h = head === null ? f : one(head);
  if (problems.length > 0) throw new PartsError(problems);
  return { full: f as LayerSet, head: h as LayerSet, single: head === null };
}

/** One `--alt <name>=<source>:<full>[:<head>]` argument (issue #454). */
export interface AlternateCliInput {
  name: string;
  source: string;
  full: string;
  head?: string;
}

export interface AssembleStageInput {
  /** Write source-edge evidence only when cut_material is explicitly declared. */
  requirements?: string;
  source: string;
  full: string;
  /** The head run, or null for one run that holds the face (issue #359). */
  head: string | null;
  config: string;
  seam: SeamRule;
  project: ProjectRule;
  /** `--alt` entries, merged with `config.assemble.alternates` by set name (issue #454). */
  alts?: readonly AlternateCliInput[];
  /**
   * How an alternate set with a `skeleton` is cut (issue #539): `"skeleton"`
   * (the default, the only one the CLI runs) at the skeleton's own joint
   * positions, registered on the base's torso; `"angles"` at the base's joints
   * posed to the skeleton's angles, the rule before #539 — kept for the
   * selftest's control that shows a foreshortened segment refused under it.
   */
  altPlacement?: 'skeleton' | 'angles';
  /**
   * What a subset set's limb parts take under a base part the set does not replace (issue #587): `"base"` (the
   * default, the only one the CLI runs) excludes the pixels that base part covers at setup ({@link setExclusions});
   * `"none"` takes them, the rule before #587 — kept for the selftest's control that shows the count go red under it.
   */
  setExclusion?: 'base' | 'none';
  /** Issue #637: the CLI protects assigned source/cap art under covers; painting is the unprotected test mutant only. */
  setCover?: 'layer' | 'painting';
  /** Issue #637: source is the skipped-cap ownership test mutant, never a CLI/config option. */
  setCapOwnership?: 'target' | 'source';
  /**
   * What a subset set's limb parts keep of a layer of more than one island when the set names one limb side (issue
   * #588): `"joints"` (the default, the only one the CLI runs) the island the segment's joints fall on
   * ({@link setIslandSources}); `"all"` every island, the rule before #588 — kept for the selftest's control that
   * shows the island count go red under it.
   */
  setIslands?: 'joints' | 'all';
  /**
   * How a subset set's limb parts share a layer of one island with a limb the set does not carry (issue #609):
   * `"nearest"` (the default, the only one the CLI runs) by the nearest segment line in the set's pose, the other limb
   * placed by the set's skeleton ({@link OtherLimbs}); `"connectivity"` every pixel on the set's limb, the rule before
   * #609 — kept for the selftest's control that shows the second-limb share go red under it. Issue #638's
   * `"whole-limb"` mutant uses the pre-fix line, including segments taking other sources, to reproduce its measured
   * default-cap case. Neither mutant is a CLI/config option or bypasses the rig-c gate.
   */
  setSplit?: 'nearest' | 'connectivity' | 'whole-limb';
}

/** Where the assemble stage writes: `parts.json`, the directory of part PNGs, the recomposite, and its error map. */
export interface AssembleOutputs {
  partsJson: string;
  partsDir: string;
  recomposite: string;
  errorMap: string;
}

/** The error map's file name beside a recomposite: `recomposite_rig.png` -> `recomposite_error_rig.png`. */
export const ERROR_MAP_FILE = 'recomposite_error_rig.png';

/**
 * One line per part whose fringe `pushBackFringe` cleared (issue #119), in
 * draw order: `  fringe pushed back: "topwear" 723 px, where the painting
 * shows "handwear_l" 460 px, "bottomwear" 257 px`. No line when no part had
 * one, so a stack the rule did not touch prints what it printed before.
 */
export function fringeLines(parts: readonly PartRecord[]): string[] {
  return parts
    .filter((p) => p.fringe_pushed_back !== undefined && p.fringe_pushed_back.length > 0)
    .map((p) => {
      const list = p.fringe_pushed_back ?? [];
      const n = list.reduce((a, q) => a + q.px, 0);
      return `  fringe pushed back: "${p.name}" ${n} px, where the painting shows ${list.map((q) => `"${q.part}" ${q.px} px`).join(', ')}`;
    });
}

/**
 * One line per part whose layer the author made (issue #256), in draw order:
 * `  author-made: part "hand" (full:author:hand) — an author-made layer, …`.
 * No line when no part came from one, so a plan of See-through layers prints
 * what it printed before.
 */
export function authorPartLines(parts: readonly PartRecord[]): string[] {
  return parts.filter((p) => isAuthorTag(tagOf(p.from) ?? '')).map((p) => `  author-made: part "${p.name}" (${p.from}) — ${AUTHOR_NO_ROLE}`);
}

/**
 * Each cut's `under` image (issue #193), read from its path relative to the
 * config's directory, null for a cut without one. Every cut is read before
 * one refusal names them all: no such file (`ASSEMBLE_UNDER_PRESENT`), or a
 * file that does not decode as a PNG (`ASSEMBLE_UNDER_DECODES`). The stage
 * itself holds the image to the polygon's box and the removed pixels.
 */
export function readUnders(configPath: string, cuts: readonly Cut[]): Array<Raster | null> {
  const problems: Problem[] = [];
  const out = cuts.map((q, i): Raster | null => {
    if (q.under === undefined) return null;
    const file = resolve(dirname(resolve(configPath)), q.under);
    const object = `config.assemble.cuts[${i}].under (part "${q.into}")`;
    if (!existsSync(file) || !statSync(file).isFile()) {
      problems.push({ code: 'ASSEMBLE_UNDER_PRESENT', object, detail: `names ${file}, which is no such file; a PNG of what lies under the piece, its path relative to the config's directory, is required` });
      return null;
    }
    try {
      return readPng(file);
    } catch (err) {
      problems.push({ code: 'ASSEMBLE_UNDER_DECODES', object, detail: `${file}: ${(err as Error).message.split('\n')[0]}; a PNG is required` });
      return null;
    }
  });
  refuseIfAny(problems);
  return out;
}

/**
 * Each limb segment's `cap` image (issue #349), read from its path relative to
 * the config's directory and keyed `<limb>/<segment index>`. Every one is read
 * before one refusal names them all: no such file
 * (`ASSEMBLE_LIMB_CAP_PRESENT`), or a file that does not decode as a PNG
 * (`ASSEMBLE_LIMB_CAP_DECODES`). The stage holds the image to the cap's box.
 */
export function readCaps(configPath: string, limbs: Readonly<Record<string, Limb>>): Map<string, Raster> {
  const problems: Problem[] = [];
  const out = new Map<string, Raster>();
  for (const [l, limb] of Object.entries(limbs)) {
    limb.segments.forEach((sg, k) => {
      if (sg.cap === undefined) return;
      const file = resolve(dirname(resolve(configPath)), sg.cap);
      const object = `config.limbs.${l}.segments[${k}].cap (part "${sg.part}")`;
      if (!existsSync(file) || !statSync(file).isFile()) {
        problems.push({ code: 'ASSEMBLE_LIMB_CAP_PRESENT', object, detail: `names ${file}, which is no such file; a PNG of the cap, its path relative to the config's directory, is required` });
        return;
      }
      try {
        out.set(`${l}/${k}`, readPng(file));
      } catch (err) {
        problems.push({ code: 'ASSEMBLE_LIMB_CAP_DECODES', object, detail: `${file}: ${(err as Error).message.split('\n')[0]}; a PNG is required` });
      }
    });
  }
  refuseIfAny(problems);
  return out;
}

/**
 * Issue #664: `items` (in parts.json's order) with each part named in `front`
 * moved to just after the part `after` maps it to — where its front slot draws
 * it. Several front parts after one target keep `items`' order. A part whose
 * target is not among `items` stays where it is. With `front` empty, `items`.
 */
export function frontOrdered<T extends { record: { name: string } }>(items: readonly T[], front: ReadonlySet<string>, after: ReadonlyMap<string, string>): T[] {
  if (front.size === 0) return [...items];
  const names = new Set(items.map((x) => x.record.name));
  const moving = items.filter((x) => front.has(x.record.name) && names.has(after.get(x.record.name) ?? '') && after.get(x.record.name) !== x.record.name);
  const out: T[] = [];
  const place = (x: T): void => {
    if (out.includes(x)) return;
    out.push(x);
    for (const m of moving) if (after.get(m.record.name) === x.record.name) place(m);
  };
  for (const x of items) if (!moving.includes(x)) place(x);
  // Front parts whose targets form a cycle have no anchor: they are appended at the end, in items' order.
  for (const x of items) place(x);
  return out;
}

/** Read, assemble, and write only after every refusal has had its chance. Throws a PartsError on a refusal, having written nothing. */
export function assembleStage(input: AssembleStageInput, outs: AssembleOutputs, log: Log): AssembleResult {
  const materialAsked = input.requirements === undefined ? false : readRequirements(input.requirements).cut_material !== undefined;
  // The early door: assemble runs before propose has drafted bones, meshes,
  // regions and motion, so it requires only what it reads (issue #20).
  const cfg = loadEarlyConfig(input.config, 'assemble');
  const src = readSource(input.source);
  const runs = applyTakenLayers(readRuns(input.full, input.head), src, cfg, input.config);
  for (const note of runs.notes) log(`note: ${note}`);
  const fields = stageFields(cfg, runs.single ? { w: src.width, h: src.height } : null);
  const under = readUnders(input.config, fields.cuts);
  const caps = fields.limbs === undefined ? undefined : readCaps(input.config, fields.limbs);
  const result = assemble({ source: src, full: runs.full, head: runs.head, depth: cfg.depth, depthBase: dirname(resolve(input.config)), ...fields, under, ...(caps === undefined ? {} : { caps }), seamRule: input.seam, projectRule: input.project });

  // Issue #454: alternate painting sets, assembled before any file is written.
  const configDir = dirname(resolve(input.config));
  const cliAlts = input.alts ?? [];
  const cfgAlts = cfg.assemble.alternates ?? [];
  const cliByName = new Map<string, AlternateCliInput>();
  for (const a of cliAlts) cliByName.set(a.name, a);
  const mergedAlts: Array<{
    name: string;
    base_anchor?: NonNullable<typeof cfg.assemble.alternates>[number]['base_anchor'];
    at: string;
    source?: string;
    full?: string;
    head?: string;
    parts?: string[];
    layers?: Record<string, string>;
    hides?: string[];
    head_box?: [number, number, number, number];
    cuts?: Cut[];
    skeleton?: string;
    anchor?: NonNullable<typeof cfg.assemble.alternates>[number]['anchor'];
    drawn?: Record<string, number>;
    tips?: Record<string, [number, number]>;
    focus?: [number, number];
    front?: string[];
  }> = cfgAlts.map((a, i) => {
    const cli = cliByName.get(a.name);
    if (cli !== undefined) cliByName.delete(a.name);
    return {
      name: a.name,
      base_anchor: a.base_anchor,
      at: `config.assemble.alternates[${i}] (set "${a.name}")`,
      source: cli?.source ?? (a.source === undefined ? undefined : resolve(configDir, a.source)),
      full: cli?.full ?? (a.full === undefined ? undefined : resolve(configDir, a.full)),
      head: cli !== undefined ? cli.head : a.head === undefined ? undefined : resolve(configDir, a.head),
      parts: a.parts,
      layers: a.layers,
      hides: a.hides,
      head_box: a.head_box,
      cuts: a.cuts,
      skeleton: a.skeleton === undefined ? undefined : resolve(configDir, a.skeleton),
      anchor: a.anchor,
      drawn: a.drawn,
      tips: a.tips,
      focus: a.focus,
      front: a.front,
    };
  });
  for (const cli of cliByName.values()) {
    mergedAlts.push({
      name: cli.name,
      at: `--alt ${cli.name}`,
      source: cli.source,
      full: cli.full,
      head: cli.head,
    });
  }

  const altProblems: Problem[] = [];
  const altBuilt: Array<{ record: AlternatePartsRecord; images: Array<{ name: string; image: Raster }>; excluded: ExcludedCount[]; islands: IslandCount[]; splits: SplitCount[]; capSplits: SplitCount[]; depthClamps: AssembleResult['depthClamps'] }> = [];
  const baseSlots = result.parts.parts.map((p) => p.name);
  // Issue #664: each limb segment part with a declared front slot -> the part its front slot follows.
  const frontAfter = new Map<string, string>();
  for (const limb of Object.values(fields.limbs ?? {})) for (const p of limb.front?.parts ?? []) frontAfter.set(p, (limb.front as { after: string }).after);
  for (const alt of mergedAlts) {
    if (alt.source === undefined || alt.full === undefined) {
      altProblems.push({
        code: 'ASSEMBLE_ALT_INPUT_PRESENT',
        object: alt.at,
        detail: 'is missing source or full; declare source and full on the alternate set in config.assemble.alternates, or supply --alt <name>=<source>:<full>[:<head>]',
      });
      continue;
    }
    if (!existsSync(alt.source)) {
      altProblems.push({
        code: 'ASSEMBLE_ALT_INPUT_PRESENT',
        object: `${alt.source} (alternate set "${alt.name}")`,
        detail: 'no such file; the alternate painting is required',
      });
      continue;
    }
    if (!existsSync(alt.full)) {
      altProblems.push({
        code: 'ASSEMBLE_ALT_INPUT_PRESENT',
        object: `${alt.full} (alternate set "${alt.name}")`,
        detail: 'no such file or directory; the alternate full run is required',
      });
      continue;
    }
    if (alt.head !== undefined && !existsSync(alt.head)) {
      altProblems.push({
        code: 'ASSEMBLE_ALT_INPUT_PRESENT',
        object: `${alt.head} (alternate set "${alt.name}")`,
        detail: 'no such file or directory; the alternate head run is required when named',
      });
      continue;
    }
    let altSkeleton: PosePoints | undefined;
    if (alt.skeleton !== undefined) {
      if (!existsSync(alt.skeleton) || !statSync(alt.skeleton).isFile()) {
        altProblems.push({
          code: 'ASSEMBLE_ALT_INPUT_PRESENT',
          object: `${alt.skeleton} (alternate set "${alt.name}")`,
          detail: 'no such file; the alternate pose skeleton is required when named',
        });
        continue;
      }
      try {
        const rawSkel: unknown = JSON.parse(readFileSync(alt.skeleton, 'utf8'));
        const skObj = typeof rawSkel === 'object' && rawSkel !== null && !Array.isArray(rawSkel) ? (rawSkel as Record<string, unknown>) : null;
        const sw = skObj !== null && typeof skObj.width === 'number' && skObj.width > 0 ? skObj.width : null;
        const sh = skObj !== null && typeof skObj.height === 'number' && skObj.height > 0 ? skObj.height : null;
        const spts = skObj !== null && typeof skObj.points === 'object' && skObj.points !== null && !Array.isArray(skObj.points) ? (skObj.points as Record<string, unknown>) : null;
        if (sw === null || sh === null || spts === null || KEYPOINT_NAMES.some((k) => !Array.isArray(spts[k]) || (spts[k] as unknown[]).length !== 2)) {
          altProblems.push({
            code: 'ASSEMBLE_ALT_SKELETON',
            object: `${alt.skeleton} (alternate set "${alt.name}")`,
            detail: 'must hold {"width": W, "height": H, "points": {…the 18 body-18 keypoints}}',
          });
          continue;
        }
        const [rW, rH] = result.parts.rig_size;
        const sx = rW / sw;
        const sy = rH / sh;
        const scaled = {} as Record<KeypointName, readonly [number, number]>;
        for (const k of KEYPOINT_NAMES) {
          const [px, py] = spts[k] as [number, number];
          scaled[k] = [pyRound(px * sx, 6), pyRound(py * sy, 6)];
        }
        altSkeleton = scaled;
      } catch (err) {
        altProblems.push({
          code: 'ASSEMBLE_ALT_SKELETON',
          object: `${alt.skeleton} (alternate set "${alt.name}")`,
          detail: `does not parse as JSON: ${(err as Error).message}`,
        });
        continue;
      }
    }
    const altSrc = readSource(alt.source);
    if (altSrc.width !== src.width || altSrc.height !== src.height) {
      altProblems.push({
        code: 'ASSEMBLE_ALT_CANVAS_SIZE',
        object: `${alt.source} (alternate set "${alt.name}")`,
        detail: `is ${altSrc.width}x${altSrc.height}, while the primary painting ${input.source} is ${src.width}x${src.height}; an alternate painting must share the primary painting's canvas size so its parts land in the same rig frame`,
      });
      continue;
    }
    if (alt.focus !== undefined) {
      const invalidFocus = setFocusProblems(alt.focus, `${alt.at}.focus`, [altSrc.width, altSrc.height]);
      if (invalidFocus.length > 0) { altProblems.push(...invalidFocus); continue; }
    }
    const altRuns = readRuns(alt.full, alt.head ?? null);
    const hidesSet = new Set(alt.hides ?? []);
    const declaredSlots = alt.parts !== undefined ? alt.parts.filter((p) => !hidesSet.has(p)) : baseSlots.filter((p) => !hidesSet.has(p));
    const coveredSet = new Set(declaredSlots);
    const generatedBands: string[] = [];
    for (const limb of Object.values(fields.limbs ?? {})) if (limb.segments.every((sg) => coveredSet.has(sg.part))) {
      for (const sg of limb.segments) if (sg.hybrid !== undefined) { coveredSet.add(sg.hybrid.part); generatedBands.push(sg.hybrid.part); }
    }
    let rawCuts = alt.cuts !== undefined ? alt.cuts : fields.cuts.filter((c) => coveredSet.has(c.into) && coveredSet.has(c.from)).map((c) => ({ ...c, under: undefined }));
    let altLimbs: Record<string, Limb> = {};
    if (fields.limbs !== undefined) {
      for (const [ln, limb] of Object.entries(fields.limbs)) {
        if (limb.segments.every((sg) => coveredSet.has(sg.part))) {
          altLimbs[ln] = { ...limb, segments: limb.segments.map((sg) => ({ ...sg, cap: undefined })) };
        }
      }
    }
    const neededPlan = new Set<string>();
    for (const [name] of fields.plan) {
      if (
        coveredSet.has(name) ||
        rawCuts.some((c) => c.from === name) ||
        Object.values(altLimbs).some((l) => l.segments.some((sg) => sg.from === name))
      ) {
        neededPlan.add(name);
      }
    }
    let altPlan: PlanEntry[] = fields.plan
      .filter(([name]) => neededPlan.has(name))
      .map(([name, run, tag]): PlanEntry => (altRuns.single ? [name, 'full', tag] : [name, run, tag]));
    const originalAltLimbs = altLimbs;
    const selectedLayers = alternateLayerSources(altPlan, rawCuts, altLimbs, coveredSet, alt.layers);
    altPlan = selectedLayers.plan;
    rawCuts = selectedLayers.cuts;
    altLimbs = selectedLayers.limbs;
    let missingLayer = false;
    const selectedCutLayers: PlanEntry[] = rawCuts.flatMap(c => {
      const tag = selectedLayers.cutLayers.get(c.into);
      const parent = altPlan.find(([name]) => name === c.from);
      return tag === undefined || parent === undefined ? [] : [[c.into, parent[1], tag]];
    });
    for (const [name, run, tag] of [...altPlan, ...selectedCutLayers]) {
      const l = altRuns[run].layers.find((x) => x.name === tag);
      if (l === undefined || l.opaquePx === 0) {
        altProblems.push({
          code: 'ASSEMBLE_ALT_INPUT_PRESENT',
          object: `alternate set "${alt.name}" (part "${name}")`,
          detail: `takes ${run}:${tag}, which ${l === undefined ? 'is absent' : 'has 0 opaque pixels'} in ${altRuns[run].source}; every covered part of the alternate set must be present in its runs, or listed in hides`,
        });
        missingLayer = true;
      }
    }
    if (missingLayer) continue;
    const altPlanNames = new Set(altPlan.map((e) => e[0]));
    const remapDraw = (d: Patch['draw']): Patch['draw'] => {
      if (typeof d !== 'object') return d;
      if (altPlanNames.has(d.before)) return d;
      const baseIdx = fields.plan.findIndex((e) => e[0] === d.before);
      for (let i = Math.max(0, baseIdx); i < fields.plan.length; i++) {
        if (altPlanNames.has(fields.plan[i][0])) return { before: fields.plan[i][0] };
      }
      return 'front';
    };
    const altExtend: Extend[] = altRuns.single ? [] : fields.extend.filter((e) => altPlanNames.has(e.part));
    const altPatches: Patch[] = fields.patches.filter((p) => coveredSet.has(p.name)).map((p) => ({ ...p, draw: remapDraw(p.draw) }));
    const altCuts: Cut[] = rawCuts.map((c) => ({ ...c, draw: remapDraw(c.draw) }));
    const altUnder = alt.cuts !== undefined ? readUnders(input.config, altCuts) : altCuts.map(() => null);
    const altHeadBox = alt.head_box ?? (altRuns.single ? singleRunHeadBox(altSrc.width, altSrc.height, fields.resolution) : fields.headBox);
    let altBones = fields.bones;
    let altDrawnLength: Record<string, number> | undefined;
    let altRegistration: { offset: [number, number]; scale: number } | undefined;
    // Issue #588: a subset set that names one limb side keeps, of a layer that holds more than one island, the one its joints fall on.
    const originalIslands = alt.parts === undefined || input.setIslands === 'all' ? [] : setIslandSources(fields.limbs ?? {}, originalAltLimbs);
    const altIslands = alternateLayerIslands(originalIslands, selectedLayers.groups);
    // Issue #609: the limbs of those layers the set does not carry — the other leg of a two-leg layer.
    const otherLimbs: Record<string, Limb> =
      input.setSplit === 'connectivity'
        ? {}
        : Object.fromEntries(Object.entries(fields.limbs ?? {}).filter(([ln, l]) => !(ln in altLimbs) && l.segments.some((sg) => originalIslands.includes(sg.from))));
    const otherBones = new Set(Object.values(otherLimbs).flatMap((l) => l.segments.map((sg) => sg.bone)));
    // The bones the set places: by its skeleton, or by the angles it states; every other bone keeps the base's place unless an ancestor moved.
    const setPlaced = new Set<string>();
    if (Object.keys(altLimbs).length > 0 && fields.bones !== undefined && (altSkeleton !== undefined || alt.drawn !== undefined)) {
      const coveredLimbBones = new Set(Object.values(altLimbs).flatMap((l) => l.segments.map((sg) => sg.bone)));
      const limbDrawn: Record<string, number> = {};
      const joints = altSkeleton === undefined ? [] : skeletonLimbJoints(altSkeleton);
      if (altSkeleton !== undefined) {
        const deg = (a: readonly [number, number], b: readonly [number, number]): number =>
          (Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180) / Math.PI;
        for (const [bName, a, b] of joints) {
          if (alt.parts === undefined || coveredLimbBones.has(bName)) limbDrawn[bName] = deg(a, b);
        }
      }
      if (alt.drawn !== undefined) {
        for (const [bName, degVal] of Object.entries(alt.drawn)) limbDrawn[bName] = degVal;
      }
      const placedBySkeleton = altSkeleton !== undefined && input.altPlacement !== 'angles' && SKELETON_LIMB_BONES.some(([b]) => coveredLimbBones.has(b));
      if (placedBySkeleton && altSkeleton !== undefined) {
        // Issue #539: the painting must sit where the base figure sits before its own joints are cut at.
        const reg = registerSkeleton(fields.bones, altSkeleton, alt.anchor);
        if (!reg.ok) {
          const read = reg.anchors.map((a) => `${a.keypoint} on "${a.bone}"`).join(', ') || 'none';
          altProblems.push({
            code: 'ASSEMBLE_ALT_SKELETON_REGISTERED',
            object: `${alt.skeleton} (alternate set "${alt.name}")`,
            detail:
              reg.missing.length > 0
                ? `cannot be registered on the base's torso: config.bones declares no bone rooted at the torso's ${reg.missing.join(' or ')} (the shoulders r_shoulder / l_shoulder root sleeve_r0, arm_r0, sleeve_l0, arm_l0; the hips r_hip / l_hip root leg_r0, leg_l0; read: ${read}); a base that declares a bone at each end of the torso is required, or drawn in place of skeleton`
                : `cannot be registered on the base's torso: its torso keypoints (${read}) stand on one point, so the torso has no length; a skeleton whose shoulders and hips are apart is required`,
          });
          continue;
        }
        if (!registeredWithinBar(reg)) {
          altProblems.push({
            code: 'ASSEMBLE_ALT_SKELETON_REGISTERED',
            object: `${alt.skeleton} (alternate set "${alt.name}")`,
            detail: `puts the set's torso off the base's: the painting would need offset [${reg.offset.join(', ')}] rig px and scale ${reg.scale} (p -> scale * p + offset, about the canvas origin; read on ${reg.anchors.map((a) => `${a.keypoint} = "${a.bone}"`).join(', ')}), over the bar of ${REGISTER_OFFSET_BAR} rig px and ${REGISTER_SCALE_BAR * 100} % in scale; a registered painting is required — the set's figure at the base figure's torso place and scale on the same canvas`,
          });
          continue;
        }
        altRegistration = { offset: [reg.offset[0], reg.offset[1]], scale: reg.scale };
        altDrawnLength = skeletonDrawnLength(fields.bones, coveredLimbBones, joints);
        // Issue #609: the other limb of a shared layer stands at the set's own keypoints too, so its segment line is the
        // set's; the skeleton file holds them. Only its place widens: drawn and drawnLength stay the covered bones'.
        const placed = new Set([...coveredLimbBones, ...[...otherBones].filter((b) => SKELETON_LIMB_BONES.some(([t]) => t === b))]);
        for (const b of placed) if (SKELETON_LIMB_BONES.some(([t]) => t === b)) setPlaced.add(b);
        altBones = placeBoneEntriesForSkeleton(fields.bones, placed, joints, limbDrawn);
      } else {
        altBones = poseBoneEntriesForDrawn(fields.bones, limbDrawn);
      }
      for (const b of Object.keys(limbDrawn)) setPlaced.add(b);
    }
    // Source-crop endpoints are final evidence, not angles or origin placement.
    // Resize exactly onto the accepted raster, after skeleton/drawn placement.
    const altTips: Record<string, [number, number]> | undefined = alt.tips === undefined ? undefined
      : Object.fromEntries(Object.keys(alt.tips).sort().map((bone) => [bone, [
          (alt.tips as Record<string, [number, number]>)[bone][0] * (result.parts.rig_size[0] / altSrc.width),
          (alt.tips as Record<string, [number, number]>)[bone][1] * (result.parts.rig_size[1] / altSrc.height),
        ] as [number, number]]));
    const invalidTip = Object.entries(altTips ?? {}).find(([, tip]) => !tip.every(Number.isFinite));
    if (invalidTip !== undefined) {
      altProblems.push({ code: 'ASSEMBLE_ALT_TIP_POINT', object: `${alt.at}.tips.${invalidTip[0]}`, detail: 'does not normalize to a finite [x, y] endpoint on the accepted rig canvas' });
      continue;
    }
    const altOthers = Object.keys(otherLimbs).length === 0 ? undefined : otherLimbsOf(otherLimbs, setPlaced, fields.bones ?? [], result.images, result.parts.rig_size, altSkeleton !== undefined ? 'skeleton' : alt.drawn !== undefined ? 'drawn' : 'none');
    if (altOthers !== undefined && input.setSplit === 'whole-limb') altOthers.line = 'whole-limb';
    // Issue #587: a subset set's limb part takes nothing a base part it does not replace covers at setup.
    const [exW, exH] = result.parts.rig_size;
    // Issue #664: a part the set draws on its front slot is drawn after its front slot's target, so only base parts
    // drawn after that target cover it; every other segment part keeps the base order.
    const altFront = new Set(alt.front ?? []);
    const altSegParts = Object.values(altLimbs).flatMap((l) => l.segments.map((sg) => sg.part));
    const replacedSet = new Set([...coveredSet, ...hidesSet]);
    const altExclude =
      alt.parts === undefined || input.setExclusion === 'none'
        ? []
        : altFront.size === 0
          ? setExclusions(result.images, exW, exH, altSegParts, replacedSet)
          : altSegParts.flatMap((sp) => setExclusions(altFront.has(sp) ? frontOrdered(result.images, new Set([sp]), frontAfter) : result.images, exW, exH, [sp], replacedSet));
    let altRes: ReturnType<typeof assemble>;
    try {
      altRes = assemble({
        source: altSrc,
        depth: cfg.depth, depthBase: configDir,
        limbUnderCover: alt.parts !== undefined && input.setCover !== 'painting',
        ...(altTips === undefined ? {} : { boneTips: altTips }),
        capOwnership: input.setCapOwnership ?? 'target',
        full: altRuns.full,
        head: altRuns.head,
        ...(fields.keepUnderOccluders === undefined ? {} : { keepUnderOccluders: fields.keepUnderOccluders.filter(name => altPlanNames.has(name)) }),
        resolution: fields.resolution,
        headBox: altHeadBox,
        rigScale: fields.rigScale,
        plan: altPlan,
        ...(selectedLayers.groups.size === 0 ? {} : { limbSourceGroups: selectedLayers.groups }),
        extend: altExtend,
        patches: altPatches,
        cuts: altCuts,
        ...(selectedLayers.cutLayers.size === 0 ? {} : { cutLayers: selectedLayers.cutLayers }),
        under: altUnder,
        ...(Object.keys(altLimbs).length > 0 ? { limbs: altLimbs, bones: altBones } : {}),
        ...(fields.scene === undefined ? {} : { scene: fields.scene }),
        ...(fields.armSplit !== undefined && altPlan.some((e) => e[1] === 'full' && (e[2] === 'handwear-r' || e[2] === 'handwear-l')) ? { armSplit: fields.armSplit } : {}),
        ...(fields.headFaceUnderfill === undefined ? {} : { headFaceUnderfill: fields.headFaceUnderfill }),
        ...(fields.yieldRefused === undefined ? {} : { yieldRefused: fields.yieldRefused }),
        ...(fields.turnMovingPair === undefined ? {} : { turnMovingPair: fields.turnMovingPair }),
        ...(fields.turn === undefined ? {} : { turn: fields.turn, regions: fields.regions, meshes: fields.meshes, motion: fields.motion }),
        seamRule: input.seam,
        projectRule: input.project,
        ...(altExclude.length === 0 ? {} : { exclude: altExclude }),
        ...(altIslands.length === 0 ? {} : { limbIslands: altIslands }),
        ...(altOthers === undefined ? {} : { otherLimbs: alternateLayerOthers(altOthers, selectedLayers.groups) }),
      });
    } catch (err) {
      if (err instanceof PartsError) {
        for (const p of err.problems) {
          altProblems.push({
            ...p,
            object: `${p.object} (alternate set "${alt.name}")`,
          });
        }
        continue;
      }
      throw err;
    }
    const keptImages = altRes.images
      .filter(({ record }) => coveredSet.has(record.name))
      .flatMap(({ record, image, depthImage }) => [{ name: `${alt.name}_${record.name}`, image }, ...(depthImage === undefined || record.depth === undefined ? [] : [{ name: `${alt.name}_${record.depth.image.slice(0, -4)}`, image: depthImage }])]);
    const keptRecords = altRes.parts.parts.filter((p) => coveredSet.has(p.name)).map(p => p.depth === undefined ? p : { ...p, depth: { ...p.depth, image: `${alt.name}_${p.depth.image}` } });
    const slots: Record<string, string> = {};
    for (const r of keptRecords) slots[altFront.has(r.name) ? `${r.name}${FRONT_SUFFIX}` : r.name] = `${alt.name}_${r.name}`;
    let altRecomposite = altRes.parts.recomposite as RecompositeRecord;
    if (alt.parts !== undefined) {
      const [rW, rH] = result.parts.rig_size;
      const altByName = new Map(altRes.images.map((x) => [x.record.name, x]));
      const fullSetPlaced = frontOrdered(result.images, altFront, frontAfter)
        .filter(({ record }) => !hidesSet.has(record.name))
        .map((baseItem) => altByName.get(baseItem.record.name) ?? baseItem);
      const altSrcRig = sourceInRig(altSrc, rW, rH);
      const altCan = recomposite(fullSetPlaced, rW, rH);
      altRecomposite = recompositeRecord(measureRecomposite(altCan, altSrcRig, fullSetPlaced));
    }
    altBuilt.push({
      record: {
        name: alt.name,
        ...(alt.base_anchor === undefined ? {} : { base_anchor: orderedBaseAnchor(alt.base_anchor) }),
        ...(alt.parts === undefined ? {} : { parts: [...alt.parts, ...generatedBands.filter((n) => !(alt.parts as string[]).includes(n))] }),
        ...(alt.hides === undefined || alt.hides.length === 0 ? (altFront.size === 0 ? {} : { hides: [...altFront] }) : { hides: [...alt.hides, ...[...altFront].filter((p) => !(alt.hides as string[]).includes(p))] }),
        ...(altFront.size === 0 ? {} : { front: [...altFront] }),
        slots,
        records: keptRecords,
        ...(altRes.parts.cut_ownership === undefined ? {} : { cut_ownership: altRes.parts.cut_ownership }),
        ghost_px: altRes.parts.ghost_px,
        recomposite: altRecomposite,
        ...(altRes.parts.scene === undefined ? {} : { scene: altRes.parts.scene }),
        ...(altRes.parts.single_run_pad === undefined ? {} : { single_run_pad: altRes.parts.single_run_pad }),
        ...(altSkeleton === undefined ? {} : { skeleton: altSkeleton }),
        ...(alt.drawn === undefined ? {} : { drawn: { ...alt.drawn } }),
        ...(altTips === undefined ? {} : { tips_source_size: [altSrc.width, altSrc.height], tips: altTips }),
        ...(alt.focus === undefined ? {} : { focus: [...alt.focus], focus_source_size: [altSrc.width, altSrc.height] }),
        ...(altDrawnLength === undefined ? {} : { drawnLength: altDrawnLength }),
        ...(altRegistration === undefined ? {} : { registration: altRegistration }),
      },
      images: keptImages,
      excluded: altRes.excluded,
      islands: altRes.islands,
      splits: altRes.splits,
      capSplits: altRes.capSplits,
      depthClamps: altRes.depthClamps,
    });
  }
  const emittedAssets = [
    ...result.images.flatMap(({ record, depthImage }) => [
      `${record.name}.png`,
      ...(depthImage !== undefined && record.depth !== undefined ? [record.depth.image] : []),
    ]),
    ...altBuilt.flatMap((b) => b.images.map(({ name }) => `${name}.png`)),
  ];
  const assetIndices = new Map<string, number>();
  emittedAssets.forEach((file, index) => {
    const previous = assetIndices.get(file);
    if (previous !== undefined) {
      altProblems.push({
        code: 'DEPTH_SHEET_UNAMBIGUOUS',
        object: file,
        detail: `output assets[${previous}] and [${index}] require the same filename; choose distinct base, alternate and sheet names`,
      });
    } else {
      assetIndices.set(file, index);
    }
  });
  refuseIfAny(altProblems);
  if (altBuilt.length > 0) {
    result.parts.alternates = altBuilt.map((b) => b.record);
  }

  // Emit only after green: every refusal above has already thrown.
  mkdirSync(outs.partsDir, { recursive: true });
  mkdirSync(dirname(outs.partsJson), { recursive: true });
  mkdirSync(dirname(outs.recomposite), { recursive: true });
  mkdirSync(dirname(outs.errorMap), { recursive: true });
  writeParts(outs.partsJson, result.parts);
  for (const { record, image, depthImage } of result.images) {
    writePng(join(outs.partsDir, `${record.name}.png`), image);
    if (depthImage !== undefined && record.depth !== undefined) writePng(join(outs.partsDir, record.depth.image), depthImage);
  }
  for (const row of result.depthReadings ?? []) log(`  depth reading ${row.from}: ${row.reading.relation}; ordering median ${row.reading.orderingMedian}, source-sheet median ${row.reading.sheetMedian} (half-level quantization; reading only, polarity declared)`);
  for (const row of result.depthClamps ?? []) log(`  depth edge clamp ${row.part}: ${row.samples} visible samples less than 1 source pixel outside the crop; edge texels retained`);
  for (const b of altBuilt) for (const row of b.depthClamps ?? []) log(`  set "${b.record.name}" depth edge clamp ${row.part}: ${row.samples} visible samples less than 1 source pixel outside the crop; edge texels retained`);
  for (const b of altBuilt) {
    for (const { name, image } of b.images) writePng(join(outs.partsDir, `${name}.png`), image);
  }
  if (materialAsked) writeMaterialSources(outs.partsJson, outs.partsDir, result.parts, result.materialSources);
  else rmSync(join(dirname(outs.partsJson), CUT_MATERIAL_SOURCES), { force: true });
  writePng(outs.recomposite, result.recomposite);
  writePng(outs.errorMap, result.errorMap);
  // Issue #242: under config.scene, the figure the recomposite was read inside, beside the recomposite.
  const figurePath = result.figure === null ? null : join(dirname(outs.recomposite), FIGURE_MASK_FILE);
  if (figurePath !== null) writePng(figurePath, result.figure as Raster);
  const [W, H] = result.parts.rig_size;
  log(`rig-parts assemble: ${result.images.length} part(s) on a ${W}x${H} rig (${result.parts.scale_rig_per_source} rig px per source px), seam rule ${result.seamRule}, projection rule ${result.projectRule}`);
  // Issue #359: one run, said, so a reader of the lines knows no head run was placed.
  if (runs.single) log(`  one run: ${input.full} holds the face (${SINGLE_RUN_FACE_TAGS.join(', ')}), so no head run is read; every part comes from the full run`);
  // Issue #366: a file that is not the resolution square was padded to it; said, with where parts.json records it. None for a square file.
  const pad = result.parts.single_run_pad;
  if (pad !== undefined) log(singleRunPadLine(input.full, pad));
  for (const p of result.parts.parts) {
    const underfillSuffix = p.from === 'head:face' && (result.headFaceUnderfillPx ?? 0) > 0 ? ` underfill=${result.headFaceUnderfillPx}px(full:face)` : '';
    log(
      `  ${p.name.padEnd(11)} ${p.from.padEnd(16)} ${`${p.w}x${p.h}`.padEnd(9)} @${String(p.x).padStart(4)},${String(p.y).padStart(4)} ` +
        `op=${String(p.opaque_px).padStart(6)} vis=${String(p.visible_px).padStart(6)} src=${String(p.source_px_taken).padStart(6)}/${String(p.projected_core_px).padStart(6)} ` +
        `unproj=${String(p.visible_not_projected_px).padStart(5)} drift=${String(p.refused_drift_px).padStart(5)} ${driftShare(p.refused_drift_px, p.projected_core_px)} merged=${p.merged_px} seam=${p.seam_override_px}${underfillSuffix}`,
    );
  }
  for (const line of provenanceLines(result.parts.parts)) log(line);
  for (const line of ownershipLines(result.parts.cut_ownership ?? [])) log(line);
  for (const alt of altBuilt) for (const line of [...provenanceLines(alt.record.records), ...ownershipLines(alt.record.cut_ownership ?? [])]) log(`  set "${alt.record.name}" ${line.trimStart()}`);
  // Issue #256: one line per part from an author-made layer, so it never reads as See-through's. None without one.
  for (const l of authorPartLines(result.parts.parts)) log(l);
  // One line per plan part an assemble.cuts entry cut, before the fringe lines: the cut is made first. None without cuts.
  for (const l of cutLines(result.cuts)) log(l);
  if (materialAsked) for (const line of materialLines({ status: 'SKIP', rows: result.cutMaterial, reason: 'assemble source readings only; check --requirements judges declared joint material' })) log(`  ${line}`);
  // Issue #349: one line per part a limb took, and one per joint with its cap's pixels. None without limbs.
  for (const l of limbLines(result.limbs)) log(l);
  for (const l of fringeLines(result.parts.parts)) log(l);
  // Issue #359: one line per hidden-art layer and what read it. None without one.
  for (const l of hiddenLines(result.hidden)) log(l);
  const total = (k: 'opaque_px' | 'visible_px' | 'occluded_px' | 'source_px_taken' | 'visible_not_projected_px'): number => result.parts.parts.reduce((a, p) => a + (p[k] ?? 0), 0);
  const [op, vis, occ, taken, unproj] = (['opaque_px', 'visible_px', 'occluded_px', 'source_px_taken', 'visible_not_projected_px'] as const).map(total);
  const pct = (n: number): string => `${((100 * n) / op).toFixed(1)}%`;
  log(
    `  pixels: opaque ${op} = visible ${vis} + occluded ${occ} (${pct(occ)}); taken from the painting ${taken} (${pct(taken)}); ` +
      `visible but not projected ${unproj} (${pct(unproj)})`,
  );
  const ghosts = Object.values(result.parts.ghost_px).reduce((a, b) => a + b, 0);
  log(`  ghost px removed: ${ghosts} over ${Object.keys(result.parts.ghost_px).length} layer(s)`);
  const scene = result.parts.scene === undefined ? null : scenePhrase(result.parts.scene, W * H);
  log(figuresLine(result.figures, scene));
  for (const l of holeLines(result.figures, scene)) log(l);
  if (result.figures.uncoveredErrorPx > 0) log(holeKindsLine(result.holeKinds, scene));
  for (const u of result.uncovered) log(uncoveredLine(u, scene));
  for (const d of result.drift) log(driftLine(d));
  for (const d of result.softOcclusion ?? []) log(softOcclusionLine(d));
  // Issue #588: per subset set, one line per limb part cut from a layer of more than one island, then (issue #587) one
  // per limb part and base part over it that took a pixel. None otherwise.
  // Issue #609: then one per limb part cut from a layer of one island that also holds a limb the set does not carry.
  for (const b of altBuilt) for (const l of [...islandLines(b.record.name, b.islands), ...splitLines(b.record.name, b.splits), ...capOwnershipLines(b.record.name, b.capSplits), ...excludedLines(b.record.name, b.excluded)]) log(l);
  log(`wrote ${outs.partsJson}, ${result.images.length} PNG(s) in ${outs.partsDir}, ${outs.recomposite}, ${outs.errorMap} (uncovered error px red, covered error px blue, the painting grey)${figurePath === null ? '' : `, ${figurePath} (the figure, white, the recomposite was read inside)`}`);
  return result;
}

/**
 * Issue #609: what a subset set says of the limbs of its shared layers it does not carry ({@link OtherLimbs}). A bone
 * is placed by the set when the set places it (`setPlaced`: its skeleton's table bones, its drawn bones) or an
 * ancestor of it — the rule `placeBoneEntriesForSkeleton` and `poseBoneEntriesForDrawn` move a child by; any other
 * bone keeps the base's place, which is not the set's, so a limb with one is `unposed`. The base art is each limb's
 * base parts at alpha above `OPAQUE_ALPHA_ABOVE`, at their `parts.json` x, y.
 */
function otherLimbsOf(
  limbs: Readonly<Record<string, Limb>>,
  setPlaced: ReadonlySet<string>,
  bones: readonly BoneEntry[],
  base: ReadonlyArray<{ record: PartRecord; image: Raster }>,
  rigSize: readonly [number, number],
  pose: OtherLimbs['pose'],
): OtherLimbs {
  const parent = new Map<string, string>();
  for (const b of bones) {
    if ('chain' in b) b.points.forEach((_, k) => parent.set(`${b.chain}${k}`, k === 0 ? b.parent : `${b.chain}${k - 1}`));
    else parent.set(b.name, b.parent);
  }
  const placed = (b: string): boolean => {
    for (let at: string | undefined = b, n = 0; at !== undefined && n <= parent.size; at = parent.get(at), n++) if (setPlaced.has(at)) return true;
    return false;
  };
  const [W, H] = rigSize;
  const unposed: Record<string, string[]> = {};
  const baseArt: Record<string, Mask> = {};
  for (const [ln, l] of Object.entries(limbs)) {
    unposed[ln] = l.segments.map((sg) => sg.bone).filter((b) => !placed(b));
    const names = new Set(l.segments.map((sg) => sg.part));
    const m = newMask(W, H);
    for (const { record, image } of base) {
      if (!names.has(record.name)) continue;
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const rx = record.x + x;
          const ry = record.y + y;
          if (rx >= 0 && ry >= 0 && rx < W && ry < H && image.data[(y * image.width + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE) m.data[ry * W + rx] = 1;
        }
      }
    }
    baseArt[ln] = m;
  }
  return { limbs, unposed, baseArt, drawOrder: base.map((q) => q.record.name), pose };
}

/**
 * The line `assemble` prints under `one run:` when the file was padded (issue
 * #366): its size, the square and the four margins, and that `parts.json`'s
 * `single_run_pad` records them.
 */
export function singleRunPadLine(file: string, pad: SingleRunPad): string {
  const [w, h] = pad.file_size;
  return `  padded: ${file} is ${w}x${h}, centred on the ${pad.side}x${pad.side} run square (left ${pad.left}, right ${pad.side - w - pad.left}, top ${pad.top}, bottom ${pad.side - h - pad.top}); parts.json single_run_pad records it, and every part's box is in the file's pixels times scale_rig_per_source`;
}

/**
 * The scale the per-part line prints `drift=` with (issue #314): `refused_drift_px` counts the part's projection
 * candidates (`projected_core_px`, the `src=` column's second figure) refused because See-through's colour sits more
 * than the drift limit off the painting's, so it is read against them — `(<p>% of core)`, one decimal; a part with no
 * candidate has nothing to refuse and says so. No bar reads either figure (AUTHORING §5, `assemble`).
 */
export function driftShare(refused: number, core: number): string {
  return core === 0 ? '(no core)' : `(${((100 * refused) / core).toFixed(1)}% of core)`;
}

// ---------------------------------------------------------------------------
// rig
// ---------------------------------------------------------------------------

export interface GateRun {
  label: string;
  status: number;
  /**
   * rigc's FAIL lines, its assertion summary, the core entry's `here:` line and
   * the one SKIP this stage's own declaration causes, as it printed them — or,
   * for a run that exited non-zero with none of those, the lines
   * {@link causeLines} says name why.
   */
  lines: string[];
  /** Which rigc ran it, when the runner said ({@link RigcCall.ran}; issue #337). */
  ran?: string;
}

/**
 * `A15_IDLE_NO_MESH_BONE_KEYS`'s SKIP under `invariants.idleDrivesMeshes` —
 * the line in which rigc states what `--idle-keys direct` declared and what it
 * costs. It is the one SKIP the rig stage prints: every other SKIP is a check
 * with nothing to measure, while this one is switched off by a field this
 * stage wrote, so it is shown rather than folded into the skipped count.
 */
const DECLARED_SKIP = /^ {2}SKIP {2}A15_IDLE_NO_MESH_BONE_KEYS: declared by the rig/;

/** The core entry's line after its summary (rig-c 2.0.0 and later): which rules ran, and that the round trip did not. */
const HERE_LINE = /^ {2}\.\. {4}here: /;

function gateRun(label: string, rigc: RigcRunner, args: string[]): GateRun {
  const r = rigc(args);
  const lines = r.out.split('\n').filter((l) => /^ {2}FAIL {2}/.test(l) || /assertions: \d+ measured/.test(l) || /^rigc compile error/.test(l) || DECLARED_SKIP.test(l) || HERE_LINE.test(l));
  const failed = lines.some((l) => /^ {2}FAIL {2}/.test(l) || /^rigc compile error/.test(l));
  const quoted = r.status !== 0 && !failed ? [...lines, ...causeLines(r.out)] : lines;
  return { label, status: r.status, lines: quoted.map(coreCompileGuideLine), ...(r.ran === undefined ? {} : { ran: r.ran }) };
}

/**
 * The motion gate's reference build (issue #135): rigc's `build` under the
 * `rig-play` profile (named `spine-html` before rig-c 2.50.0) and nothing
 * else — the same gate over the compile that the candidate's build runs,
 * without `--pack`. Its model document is all the comparison reads, and it
 * differs from a packed build's only in where the atlas puts each region (its
 * `pages`), which rig-c's comparison allowlists as atlas layout; the pages a
 * reference would pack are never written anywhere, so packing them was work
 * nobody read. No render is asked of rigc by either build.
 */
export const REFERENCE_BUILD_ARGS: readonly string[] = ['--profile', GATE_PROFILE];

/** The reference build's label, as the rig stage prints it. */
export const REFERENCE_BUILD_LABEL = `build ${REFERENCE_BUILD_ARGS.join(' ')}`;

/**
 * rig-c's gate over the rig in a scratch directory: `build` under the
 * rig-play profile with `--pack --page-edges <edges> --pack-shape <shape>`, which runs the gate
 * once over the compile and once over the packed pages on disk. There is no
 * second `validate --profile spine` run: rig-play holds every rule spine
 * measures (selftest `CH09`). The files are staged exactly as `--out` will
 * receive them, so what passed is what is written. The scratch directory is
 * the caller's, and is emptied here before and after. `images` are the PNG
 * files' bytes as `--out` will receive them: the rig stage's are its rasters
 * encoded as `writePng` encodes them, `compose`'s the builds' own files.
 * `mode` null is the motion gate's reference ({@link REFERENCE_BUILD_ARGS}):
 * the same gate over the compile, nothing packed; its build directory sits
 * where a packed one would, so every relative path in its model document is
 * the candidate's.
 */
export function gateThroughRigc(
  images: ReadonlyArray<readonly [string, Uint8Array]>,
  texts: ReadonlyArray<readonly [string, string]>,
  rigc: RigcRunner,
  scratch: string,
  mode: PackMode | null,
  onGreen?: (buildDir: string) => void,
): GateRun[] {
  rmSync(scratch, { recursive: true, force: true });
  try {
    mkdirSync(join(scratch, 'images'), { recursive: true });
    for (const [file, bytes] of images) writeFileSync(join(scratch, 'images', file), bytes);
    for (const [file, text] of texts) writeFileSync(join(scratch, file), text);
    const build = join(scratch, 'build');
    const label = mode === null ? REFERENCE_BUILD_LABEL : packedBuildLabel(mode);
    const args = mode === null ? [...REFERENCE_BUILD_ARGS] : packedBuildArgs(mode);
    const runs = [gateRun(label, rigc, ['build', '--rig', join(scratch, 'rig.json'), '--motion', join(scratch, 'motion.json'), '--out', build, ...args])];
    // What the caller reads off a green build before the scratch is emptied (the motion gate's model document); nothing for a red one.
    if (onGreen !== undefined && runs.every((g) => g.status === 0)) onGreen(build);
    return runs;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * What only this package can add to rigc's refusal of a two-bone ik a control
 * splits (issue #103). Under `--idle-keys ctl` a chain link the idle keys is
 * keyed through a same-origin `<link>_ctl` parent, so a config's ik over that
 * link and the link above it names a pair whose second bone is not the
 * first's child; rig-c 2.15.0's rig-spec parser refuses it by name
 * (firejune/rigc#1205), with `("<link>_ctl" stands between)` in its sentence
 * and a remedy a config cannot follow — a config cannot name the control.
 *
 * This reads rigc's verdict and checks no rule of its own: for each control
 * the stage added, a rigc line saying that control, and only it, stands
 * between gets one sentence naming the flag on the command that ran. The ik
 * shape is rigc's to judge; a pair split by a control and by a bone the config
 * declares (`"…_ctl", "…" stand between`) gets nothing, because
 * `--idle-keys direct` would not make it a parent and its child. Should rigc
 * reword its sentence, rigc's refusal still reaches the author and only this
 * sentence is lost; the selftest holds it on the installed rigc (`RG56`).
 */
export function ctlRemedies(lines: readonly string[], controls: readonly string[], command: RigCommand): string[] {
  const out: string[] = [];
  for (const bone of controls) {
    const ctl = `${bone}${CONTROL_SUFFIX}`;
    if (!lines.some((l) => l.includes(`("${ctl}" stands between)`))) continue;
    out.push(`"${ctl}" is the control this stage keys "${bone}" through under --idle-keys ctl, and a config cannot name it: run \`${command} --idle-keys direct\`, which keys "${bone}" in place, so no control stands between "${bone}" and its parent`);
  }
  return out;
}

export interface RigStageInput {
  config: string;
  /** The directory holding parts.json and parts/<name>.png. */
  parts: string;
  out: string;
  /** Where the idle's keys on mesh-driving bones go; `ctl` when absent. See `IDLE_KEYS` in `src/rig.ts`. */
  idleKeys?: IdleKeys;
  /** The gate build's `--page-edges`; {@link DEFAULT_PAGE_EDGES} when absent. The pack is scratch here; the gate is what it is for. */
  pageEdges?: PageEdges;
  /** The gate build's `--pack-shape`; {@link DEFAULT_PACK_SHAPE} when absent. */
  packShape?: PackShape;
  /** The command running the stage, which {@link ctlRemedies} names beside the flag; `rig` when absent. It moves no byte written. */
  command?: RigCommand;
  /**
   * How `buildRig` runs each automatic part's reduction (`src/automesh.ts`);
   * `runReduction` when absent. A caller that already ran the reduction on the
   * same input hands `reuseReductions` over it (`tools/auto_matrix.ts`), so the
   * same `reduceMesh` call is not run twice (issue #135). It moves no byte
   * written: the same input is the same result.
   */
  reduce?: Reducer;
}

/** One automatic part's motion gate, as the rig stage ran it (`src/automotion.ts`). */
export interface MotionGateRun {
  part: string;
  /** The reference build through rigc's gate — null when the part was refused before anything was compiled. */
  reference: GateRun | null;
  /** rig-c's `compare` report — null when the comparison did not run or refused its input. */
  report: MeshQualityReport | null;
  /** What refuses the part; empty when it is accepted. */
  problems: Problem[];
  /** Why no comparison ran, for the mesh line; null when one ran. */
  notCompared: string | null;
  /** The reference build's model document, read off its green build; null when it was not built or is red. Nothing writes it. */
  referenceModel: string | null;
  /**
   * Only on a part with a declared stimulus (issue #196): the build of the written rig with the stimulus animations
   * added (`stimulusTexts`), the candidate the comparison reads in place of the stage's own gate build. Absent otherwise.
   */
  candidate?: GateRun;
}

/**
 * The texts a comparison build of one part stages: `texts` with `motion.json`
 * carrying the part's declared stimulus animations (`stimulusMotion`,
 * src/automotion.ts), or `texts` as given when the part declares none.
 */
export function stimulusTexts(c: AutoMotionCase, texts: ReadonlyArray<readonly [string, string]>): ReadonlyArray<readonly [string, string]> | Problem {
  if (c.stimulus === null) return texts;
  const at = texts.find(([file]) => file === 'motion.json');
  if (at === undefined) return { code: 'AUTO_MESH_MOTION_INPUT', object: `${c.object}.stimulus`, detail: 'the stage staged no motion.json to add the declared stimulus to; the comparison builds read the motion the stage writes' };
  const m = stimulusMotion(c, JSON.parse(at[1]) as Record<string, unknown>);
  if ('problem' in m) return m.problem;
  const text = rigJsonText(m.motion);
  return texts.map(([file, t]) => [file, file === 'motion.json' ? text : t] as const);
}

/** The model document a green gate build wrote, or null. */
function modelAt(buildDir: string): string | null {
  const path = join(buildDir, RIGC_MODEL_DOCUMENT);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/**
 * The motion gate of every automatic part (issue #126, item 3): for each, the
 * reference rig — `rig` with that part's attachment swapped for its unreduced
 * source and nothing else — through rigc's gate ({@link REFERENCE_BUILD_ARGS}:
 * the stage's `build` under rig-play, without packing, issue #135), then
 * rig-c's comparison of its `skeleton.model.json` with the candidate's
 * (`candidateModel`, the stage's own gate build). A part refused before
 * compiling (no `motion`, no stimulus) costs no build.
 */
export function motionGates(
  rig: RigOutput,
  images: ReadonlyArray<readonly [string, Uint8Array]>,
  texts: ReadonlyArray<readonly [string, string]>,
  candidateModel: string | null,
  rigc: RigcRunner,
  scratch: string,
  schedules: ReadonlyMap<string, MotionSchedule> = new Map(),
): MotionGateRun[] {
  return rig.autoMotion.map((c: AutoMotionCase): MotionGateRun => {
    const out = (over: Partial<MotionGateRun>): MotionGateRun => ({ part: c.part, reference: null, report: null, problems: [], notCompared: null, referenceModel: null, ...over });
    if (c.motion === undefined) {
      return out({
        problems: [{ code: 'CONFIG_FIELD_PRESENT', object: `${c.object}.motion`, detail: 'is absent and required; an automatic mesh is accepted only when its motion is measured and passes (issue #126 item 3)' }],
        notCompared: 'no motion bounds',
      });
    }
    const stim = motionStimulus(rig.rig.bones, rig.motion, c.boundBones, c.stimulus?.flatMap((x) => x.links) ?? []);
    if (stim.by.length === 0) return out({ problems: [noStimulusProblem(c, stim.keyed)], notCompared: 'no stimulus' });
    const staged = stimulusTexts(c, texts);
    if ('code' in staged) return out({ problems: [staged], notCompared: 'the stimulus could not be staged' });
    // issue #196: a declared stimulus is walked in both builds, so the candidate is the written rig built again with it.
    let candidate: GateRun | undefined;
    let compared = candidateModel;
    if (c.stimulus !== null && compared !== null) {
      let model: string | null = null;
      [candidate] = gateThroughRigc(images, staged, rigc, scratch, null, (dir) => {
        model = modelAt(dir);
      });
      if (candidate.status !== 0 || model === null) {
        return out({
          candidate,
          problems: [
            {
              code: 'AUTO_MESH_MOTION_INPUT',
              object: c.object,
              detail: `the candidate with the declared stimulus (the rig as written, its motion carrying the stimulus animations) ${candidate.status !== 0 ? `is refused by rigc's gate, exit ${candidate.status}${candidate.lines.length > 0 ? `: ${candidate.lines.map((l) => l.trim()).join(' | ')}` : ''}${rigcRanClause(candidate)}` : `built green and wrote no ${RIGC_MODEL_DOCUMENT}`}; a candidate that is not gated is not evidence, and nothing is built in the part's place`,
            },
          ],
          notCompared: 'the stimulus candidate build is red',
        });
      }
      compared = model;
    }
    if (compared === null) {
      return out({
        problems: [{ code: 'AUTO_MESH_MOTION_INPUT', object: c.object, detail: `the rig stage's gate build wrote no ${RIGC_MODEL_DOCUMENT}, so there is no candidate document to compare; rigc's build writes one beside every green build` }],
        notCompared: `no candidate ${RIGC_MODEL_DOCUMENT}`,
      });
    }
    const refRig = JSON.parse(rigJsonText(rig.rig)) as RigSpec;
    refRig.skins.default[c.part] = { [c.part]: c.reference };
    const refTexts = staged.map(([file, text]) => [file, file === 'rig.json' ? rigJsonText(refRig) : text] as const);
    let refModel: string | null = null;
    const [gate] = gateThroughRigc(images, refTexts, rigc, scratch, null, (dir) => {
      refModel = modelAt(dir);
    });
    const withCandidate = candidate === undefined ? {} : { candidate };
    if (gate.status !== 0 || refModel === null) {
      return out({
        ...withCandidate,
        reference: gate,
        problems: [
          {
            code: 'AUTO_MESH_MOTION_INPUT',
            object: c.object,
            detail: `the reference (the rig with "${c.part}" as its unreduced source mesh) ${gate.status !== 0 ? `is refused by rigc's gate, exit ${gate.status}${gate.lines.length > 0 ? `: ${gate.lines.map((l) => l.trim()).join(' | ')}` : ''}${rigcRanClause(gate)}` : `built green and wrote no ${RIGC_MODEL_DOCUMENT}`}; a reference that is not gated is not evidence, and nothing is built in the part's place`,
          },
        ],
        notCompared: 'the reference build is red',
      });
    }
    const ran = runComparison(c.object, motionInput(c, c.motion, refModel, compared, withStimulus(schedules.get(c.part) ?? idleSchedule(), c.stimulus)));
    if ('code' in ran) return out({ ...withCandidate, reference: gate, problems: [ran], notCompared: 'rig-c refused the input', referenceModel: refModel });
    const verdict = motionVerdict(c.object, ran);
    return out({ ...withCandidate, reference: gate, report: ran, problems: verdict === null ? [] : [verdict], referenceModel: refModel });
  });
}

/** The mesh report as written: each automatic row with the motion gate's rows in place of "unmeasured", and its `compare` document after `quality_report`. */
export function withMotion(rows: readonly MeshReport[], runs: readonly MotionGateRun[], cases: readonly AutoMotionCase[], replays: ReadonlyMap<string, ReplayRow | MultiIntervalRow> = new Map()): MeshReport[] {
  return rows.map((m) => {
    if (!('mode' in m) || m.mode !== 'auto') return m;
    const run = runs.find((r) => r.part === m.part);
    const c = cases.find((x) => x.part === m.part);
    if (run === undefined || run.report === null || c === undefined || c.motion === undefined) return m;
    const replay = replays.get(m.part);
    if (replay === undefined) {
      const row: AutoMeshReport = { ...m, deformation: motionDeformation(c.motion, run.report), motion_report: motionDocument(run.report) };
      return row;
    }
    // A replayed part's row carries `replay` just before `deformation`; every other key keeps its place.
    const { deformation: _unmeasured, quality_report: quality, ...head } = m;
    const row: AutoMeshReport = { ...head, replay, deformation: motionDeformation(c.motion, run.report), quality_report: quality, motion_report: motionDocument(run.report) };
    return row;
  });
}

/** One automatic part's acceptance loop after the gate refused its full result (`src/autoreplay.ts`): the step chosen, or the problem. */
export interface ReplaySearchRun {
  part: string;
  /** The replay to write, the grid frame ids it was chosen on and the search's figures; null when the part is refused. */
  chosen: {
    candidate: ReplayCandidate;
    grid: string[];
    row: Omit<ReplayRow, 'selection' | 'held_out'> | Omit<MultiIntervalRow, 'selection' | 'held_out'>;
    /** The multi-interval search only (issue #148): every frame id any probe's comparison walked, for the final roles check. */
    probeFrames?: string[];
  } | null;
  problems: Problem[];
  /** What the stage prints about the search. */
  lines: string[];
}

/**
 * The search of one automatic part (`src/autoreplay.ts`, module header): the
 * source compared with itself on the grid frames first — a source the gate
 * would refuse leaves the part refused as the full result was, and no search
 * runs — then a bisection over the removal steps of the full run's
 * `acceptedAt`. Each probe replays a step (`AutoSearch.replay`, pure), puts it
 * into `rig` alone, builds that rig through rigc's gate without packing (the
 * reference's build, {@link REFERENCE_BUILD_ARGS}) and compares it with the
 * reference on the grid frames alone ({@link selectionSchedule}). A replay
 * that breaks rig-c's promise, a red build or a refused comparison refuses the
 * part; a replay that keeps the promise and misses a geometry target is a probe
 * that did not pass.
 */
export function replaySearch(
  rig: RigOutput,
  c: AutoMotionCase,
  run: MotionGateRun,
  images: ReadonlyArray<readonly [string, Uint8Array]>,
  texts: ReadonlyArray<readonly [string, string]>,
  rigc: RigcRunner,
  scratch: string,
): ReplaySearchRun {
  const lines: string[] = [];
  const refuse = (p: Problem): ReplaySearchRun => ({ part: c.part, chosen: null, problems: [p], lines });
  if (c.motion === undefined || run.report === null || run.referenceModel === null) return { part: c.part, chosen: null, problems: run.problems, lines };
  const motion = c.motion;
  const refModel = run.referenceModel;
  const grid = gridFrameIds(run.report);
  const N = c.search.acceptedAt.length;
  const I = c.search.inserted;
  const fullLocal = localRow(run.report);
  const fullReading = fullLocal === null ? null : { value: fullLocal.value, state: fullLocal.state, frame: fullLocal.worst?.frame?.id ?? null };
  const fullText = `reads ${failingRows(run.report).map(motionRowText).join('; ') || 'no failing row'}`;
  // Step 0: the source against itself on the selection frames. It reads no motion; a geometry row it fails leaves the part refused as today.
  // issue #196: a declared stimulus is walked in every probe too, and read to choose (`withStimulus`), as the grid is.
  const probeSchedule = withStimulus(selectionSchedule(grid), c.stimulus);
  const staged = stimulusTexts(c, texts);
  if ('code' in staged) return refuse(staged);
  const self = runComparison(c.object, motionInput(c, motion, refModel, refModel, probeSchedule));
  if ('code' in self) return refuse(self);
  if (motionVerdict(c.object, self) !== null) {
    // Issue #280: the refusal says, in its own sentence, that the source fails itself — where, the row, the remedy;
    // the reduction's reading follows it for the record. The line names the stimulus where it is read at one.
    const why = sourceSelfFailure(self, c.stimulus);
    lines.push(`replay "${c.part}": the unreduced source is not accepted against itself ${why === null ? 'on its selection frames' : why.where}; no search runs`);
    const problems = why === null ? run.problems : run.problems.map((p) => (p.code === 'AUTO_MESH_MOTION' ? { ...p, detail: `${why.sentence}. The reduction's own reading, for the record: ${p.detail}` } : p));
    return { part: c.part, chosen: null, problems, lines };
  }
  const selection = motion.selection;
  if (selection !== undefined && selection.maxProbes < maxReplays(N, I)) return refuse(budgetProblem(c.object, selection.maxProbes, N, I));
  const { candidates: _unused, ...referenceInput } = motionInput(c, motion, refModel, refModel, probeSchedule);
  const prepared = prepareComparison(c.object, referenceInput);
  if ('code' in prepared) return refuse(prepared);
  const kept = new Map<number, ReplayCandidate>();
  const probeFrames: string[] = [];
  let fatal: Problem | null = null;
  let candidatesTried = 0;
  const counted = (step: number): CountedProbe => {
    const refused = (reason: string): CountedProbe => ({ step, verdict: 'refused', value: null, frame: null, reason, vertices: null });
    if (fatal !== null) return refused('the search was refused at an earlier step');
    const rep = c.search.replay(step);
    if ('code' in rep) {
      if (rep.code !== 'AUTO_MESH_ACCEPTED') fatal = rep;
      return refused(rep.code);
    }
    candidatesTried += rep.candidatesTried;
    const candRig = JSON.parse(rigJsonText(rig.rig)) as RigSpec;
    candRig.skins.default[c.part] = { [c.part]: rep.attachment };
    const candTexts = staged.map(([file, text]) => [file, file === 'rig.json' ? rigJsonText(candRig) : text] as const);
    let model: string | null = null;
    const [gate] = gateThroughRigc(images, candTexts, rigc, scratch, null, (dir) => {
      model = modelAt(dir);
    });
    if (gate.status !== 0 || model === null) {
      fatal = {
        code: 'AUTO_MESH_MOTION_INPUT',
        object: c.object,
        detail: `the replay to accepted step ${step} (the rig with "${c.part}" as that step's mesh) ${gate.status !== 0 ? `is refused by rigc's gate, exit ${gate.status}${gate.lines.length > 0 ? `: ${gate.lines.map((l) => l.trim()).join(' | ')}` : ''}${rigcRanClause(gate)}` : `built green and wrote no ${RIGC_MODEL_DOCUMENT}`}; a candidate that is not gated is not evidence, and nothing is built in the part's place`,
      };
      return refused(`rigc exit ${gate.status}`);
    }
    const cmp = runPreparedComparison(c.object, prepared, motionInput(c, motion, refModel, model, probeSchedule));
    if ('code' in cmp) {
      fatal = cmp;
      return refused(cmp.code);
    }
    const r = localRow(cmp);
    const pass = motionVerdict(c.object, cmp) === null;
    if (pass) kept.set(step, rep);
    for (const f of cmp.candidates[0]?.motion?.schedule.walked ?? []) probeFrames.push(f.id);
    return { step, verdict: pass ? 'pass' : 'fail', value: r?.value ?? null, frame: r?.worst?.frame?.id ?? null, reason: null, vertices: rep.row.vertices };
  };
  if (selection !== undefined) return multiIntervalRun(c, selection.maxProbes, N, I, counted, () => fatal, kept, grid, probeFrames, fullReading, fullText, () => candidatesTried, lines);
  // The bisection, the stage as it was before issue #148: a probe carries no vertex count.
  const probe = (step: number): ReplayProbe => {
    const { vertices: _counted, ...p } = counted(step);
    return p;
  };
  const { chosen, probes } = bisectAccepted(I, N, probe);
  lines.push(
    `replay "${c.part}": bisection over the removal steps ${I + 1}..${N - 1} of ${N} accepted step(s), ${probes.length} replay(s) of at most ${maxReplays(N, I)}: ${probes.map((p) => `${p.step} ${p.verdict}${p.value === null ? '' : ` ${p.value}`}`).join(', ') || 'none'}`,
  );
  if (fatal !== null) return refuse(fatal);
  const candidate = kept.get(chosen);
  if (chosen <= I || candidate === undefined) return refuse(noReductionProblem(c.object, fullText, N, I, probes));
  return {
    part: c.part,
    chosen: {
      candidate,
      grid,
      row: { rule: REPLAY_RULE, accepted_steps: N, refinement_steps: I, chosen_step: chosen, replays: probes.length, max_replays: maxReplays(N, I), candidates_tried: candidatesTried, full: fullReading, probes },
    },
    problems: [],
    lines,
  };
}

/**
 * The multi-interval search of one automatic part (issue #148; `src/autoreplay.ts`, `multiIntervalSearch`), run by
 * {@link replaySearch} when the author wrote `motion.selection`: the same probe — a replay, an unpacked gated build, a
 * comparison on the grid frames alone — called once per distinct step, up to `maxProbes` replays; the fewest-vertex
 * candidate among the tested steps that passed is chosen, the lower step on a tie. The source (step I) and the full
 * result (step N) bound the domain and are never written; the bisection's own result is among the tested.
 */
function multiIntervalRun(
  c: AutoMotionCase,
  maxProbes: number,
  N: number,
  I: number,
  probe: (step: number) => CountedProbe,
  fatalOf: () => Problem | null,
  kept: ReadonlyMap<number, ReplayCandidate>,
  grid: string[],
  probeFrames: string[],
  full: MultiIntervalRow['full'],
  fullText: string,
  triedOf: () => number,
  lines: string[],
): ReplaySearchRun {
  const run = multiIntervalSearch(I, N, maxProbes, probe, () => fatalOf() !== null);
  const tested = [...new Set(run.probes.map((p) => p.step))].sort((a, b) => a - b);
  const pick = run.chosen;
  lines.push(
    `replay "${c.part}": multi-interval selection over the removal steps ${I + 1}..${N - 1} of ${N} accepted step(s), ${run.probes.length} replay(s) of at most ${maxProbes} (maxProbes), ended ${run.termination}: ` +
      `${run.probes.map((p) => `${p.step} ${p.verdict}${p.value === null ? '' : ` ${p.value}`}${p.vertices === null ? '' : ` v=${p.vertices}`}`).join(', ') || 'none'}; ` +
      `the bisection kept ${run.bisection <= I ? 'none' : `step ${run.bisection}`}; ${pick === null ? 'no tested step passed' : `the fewest vertices among the tested passing steps: step ${pick.step}, ${pick.vertices} vertices`} (best among tested candidates)`,
  );
  const fatal = fatalOf();
  if (fatal !== null) return { part: c.part, chosen: null, problems: [fatal], lines };
  const candidate = pick === null ? undefined : kept.get(pick.step);
  if (pick === null || candidate === undefined) return { part: c.part, chosen: null, problems: [noMultiReductionProblem(c.object, fullText, N, I, maxProbes, run.termination, run.probes)], lines };
  const counts = candidate.row.result.counts;
  return {
    part: c.part,
    chosen: {
      candidate,
      grid,
      probeFrames,
      row: {
        rule: MULTI_INTERVAL_RULE,
        policy: 'multi-interval',
        max_probes: maxProbes,
        accepted_steps: N,
        refinement_steps: I,
        chosen_step: pick.step,
        bisection_step: run.bisection,
        replays: run.probes.length,
        candidates_tried: triedOf(),
        termination: run.termination,
        tested,
        passing_intervals: passingIntervals(run.probes),
        untested_intervals: untestedIntervals(I, N, new Set(tested)),
        chosen: { vertices: candidate.row.vertices, boundary: counts.boundaryVertices, interior: counts.interiorVertices, triangles: candidate.row.triangles, bindings: counts.bindings },
        full,
        probes: run.probes,
        roles: { selection: 'grid', held_out: 'irr', probe_frames: new Set(probeFrames).size },
      },
    },
    problems: [],
    lines,
  };
}

/**
 * Author the rig, gate it through rigc in `scratch`, and write `out` only when
 * the gate is green — and, for every automatic mesh, only when its motion gate
 * accepted it (issue #126 item 3; {@link motionGates}).
 */
/** What the rig stage reads before it builds anything: the config with its `animations_from` table, parts.json, and each part's PNG (and each alternate set's) that exists. */
export interface RigInputs {
  cfg: ReturnType<typeof loadConfigAndAnimations>['config'];
  from: ReturnType<typeof loadConfigAndAnimations>['animations'];
  parts: ReturnType<typeof readParts>;
  images: Map<string, Raster>;
}

/**
 * The rig stage's inputs, read as {@link rigStage} reads them: `rigStage` and `mesh-stats` (issue #566,
 * `src/meshstats.ts`) both start here, so the two read the same config, the same parts and the same images, and a
 * PNG that is missing is left out of the map for `buildRig` to refuse by name (`RIG_PNG_PRESENT`).
 */
export function readRigInputs(config: string, partsDir: string): RigInputs {
  const { config: cfg, animations: from } = loadConfigAndAnimations(config);
  const parts = readParts(join(partsDir, 'parts.json'));
  const images = new Map<string, Raster>();
  const depthProblems: Problem[] = [];
  for (const p of parts.parts) {
    const png = join(partsDir, 'parts', `${p.name}.png`);
    if (existsSync(png)) images.set(p.name, readPng(png));
    if (p.depth !== undefined && images.has(p.name)) { try { images.set(p.depth.image, readSourceDepth(join(partsDir, 'parts', p.depth.image), images.get(p.name) as Raster, null).pixels); } catch (error) { if (error instanceof PartsError) depthProblems.push(...error.problems); else throw error; } }
  }
  for (const alt of parts.alternates ?? []) {
    for (const p of alt.records) {
      const attName = `${alt.name}_${p.name}`;
      const png = join(partsDir, 'parts', `${attName}.png`);
      if (existsSync(png)) images.set(attName, readPng(png));
      if (p.depth !== undefined && images.has(attName)) { try { images.set(p.depth.image, readSourceDepth(join(partsDir, 'parts', p.depth.image), images.get(attName) as Raster, null).pixels); } catch (error) { if (error instanceof PartsError) depthProblems.push(...error.problems); else throw error; } }
    }
  }
  refuseIfAny(depthProblems);
  return { cfg, from, parts, images };
}

/** Final candidate serialization shared by initial and settled motion replay. */
export function rigOutputTexts(r: RigOutput, animations: Parameters<typeof withAnimations>[1]): Array<[string, string]> {
    const mergedMotion = withAnimations(r.motion, animations);
    if (r.layout !== undefined) r.layout = refreshLimbLayout(r.layout, r.rig);
    return [
      ['rig.json', rigJsonText(r.rig)],
      ['motion.json', rigJsonText(mergedMotion)],
      ['mesh_report.json', rigJsonText(r.meshReport)],
      ...(r.depthReferences === undefined ? [] : [['depth_sheets.json', rigJsonText({ spec: 'rig-parts-depth-sheets/1', parts: r.depthReferences })] as [string, string]]),
      ...(r.sets === undefined ? [] : [[SETS_FILE, rigJsonText(r.sets)] as [string, string]]),
    ];
}

export function rigStage(input: RigStageInput, rigc: RigcRunner, scratch: string, log: Log): RigOutput {
  const { cfg, from, parts, images } = readRigInputs(input.config, input.parts);
  const first = buildRig(cfg, parts, images, undefined, input.idleKeys ?? DEFAULT_IDLE_KEYS, input.reduce);
  const textsOf = (r: RigOutput): Array<[string, string]> => rigOutputTexts(r, from === null ? null : from.table);
  const firstTexts = textsOf(first);
  // The gate runs before the lines are printed, and its lines print where they always did: an automatic part's motion
  // gate compares the model document of this very build, the one written (issue #126 item 3). mesh_report.json is staged
  // as buildRig wrote it; rigc reads only rig.json, motion.json and images/.
  const pngs = first.images.map(([file, img]) => [file, encodePngBytes(img)] as const);
  const mode: PackMode = { pageEdges: input.pageEdges ?? DEFAULT_PAGE_EDGES, packShape: input.packShape ?? DEFAULT_PACK_SHAPE };
  let firstModel: string | null = null;
  const firstGate = gateThroughRigc(pngs, firstTexts, rigc, scratch, mode, first.autoMotion.length === 0 ? undefined : (dir) => (firstModel = modelAt(dir)));
  const firstRed = firstGate.filter((g) => g.status !== 0);
  const firstMotion = firstRed.length > 0 ? [] : motionGates(first, pngs, firstTexts, firstModel, rigc, scratch);
  // The acceptance loop (src/autoreplay.ts): a part whose full result the motion gate refused, and only such a part, is
  // searched for a replayed step. Where no part is, nothing below runs and the stage is the one it always was.
  const searches = firstMotion
    .filter((r) => r.report !== null && r.problems.some((p) => p.code === 'AUTO_MESH_MOTION'))
    .map((r) => replaySearch(first, first.autoMotion.find((c) => c.part === r.part) as AutoMotionCase, r, pngs, firstTexts, rigc, scratch));
  const searched = new Set(searches.map((s) => s.part));
  const chosen = searches.flatMap((s) => (s.chosen === null ? [] : [{ part: s.part, ...s.chosen }]));
  const settled = searches.length > 0 && chosen.length === searches.length && firstMotion.every((r) => searched.has(r.part) || r.problems.length === 0);
  // Every part's search chose a step: the rig with those steps in place goes through the gate again, as written, and
  // each automatic part through the motion gate again — a chosen one on the whole idle with its grid frames as selection.
  let rig = first;
  let texts = firstTexts;
  let gate = firstGate;
  let motion: MotionGateRun[] = firstMotion.map((r) => (searched.has(r.part) ? { ...r, problems: searches.find((s) => s.part === r.part)?.problems ?? r.problems } : r));
  let finalGate: GateRun[] | null = null;
  let finalMotion: MotionGateRun[] = [];
  const replays = new Map<string, ReplayRow | MultiIntervalRow>();
  if (settled) {
    const swapped = JSON.parse(rigJsonText(first.rig)) as RigSpec;
    for (const k of chosen) swapped.skins.default[k.part] = { ...swapped.skins.default[k.part], [k.part]: k.candidate.attachment };
    rig = { ...first, rig: swapped, meshReport: first.meshReport.map((m) => chosen.find((k) => k.part === m.part)?.candidate.row ?? m) };
    texts = textsOf(rig);
    let model: string | null = null;
    finalGate = gateThroughRigc(pngs, texts, rigc, scratch, mode, (dir) => (model = modelAt(dir)));
    gate = finalGate;
    finalMotion = gate.some((g) => g.status !== 0) ? [] : motionGates(rig, pngs, texts, model, rigc, scratch, new Map(chosen.map((k) => [k.part, splitSchedule(k.grid)])));
    motion = finalMotion.map((r) => {
      const k = chosen.find((x) => x.part === r.part);
      if (k === undefined || r.report === null) return r;
      const roles = roleReadings(r.report);
      replays.set(r.part, { ...k.row, selection: roles.selection, held_out: roles.held_out });
      // issue #148: a multi-interval choice holds its roles — no probe read a frame the final comparison holds out.
      const c = rig.autoMotion.find((x) => x.part === r.part) as AutoMotionCase;
      const leaked = k.probeFrames === undefined ? null : rolesProblem(c.object, k.row.chosen_step, k.probeFrames, r.report);
      if (leaked !== null) return { ...r, problems: [leaked] };
      if (!r.problems.some((p) => p.code === 'AUTO_MESH_MOTION')) return r;
      const held = finalVerdict(c.object, k.row.chosen_step, k.row.accepted_steps, r.report);
      return { ...r, problems: held === null ? [] : [held] };
    });
  }
  const red = gate.filter((g) => g.status !== 0);
  log(`rig-parts rig: ${cfg.key}, rig ${parts.rig_size[0]}x${parts.rig_size[1]}, ${parts.parts.length} part(s)`);
  let vertices = 0;
  for (const m of rig.meshReport) {
    vertices += m.vertices;
    const head = `  mesh ${m.part.padEnd(12)} v=${String(m.vertices).padStart(4)} t=${String(m.triangles).padStart(4)} hull=${String(m.hull).padStart(3)} `;
    const infl = `bones=${m.bones.length} infl max ${m.max_influences} mean ${m.mean_influences.toFixed(2)} cover ${m.art_coverage.toFixed(5)}`;
    if ('mode' in m && m.mode === 'auto') {
      const s = m.source.counts;
      const r = m.result.counts;
      const t = m.termination;
      const tried = t.reason === 'no-further-valid-reduction' || t.reason === 'budget-exhausted' || t.reason === 'replayed-to-accepted-step' ? ` after ${t.candidatesTried} candidate(s)` : '';
      const worst = m.worst_residual === null ? 'none declared' : `${m.worst_residual.code}${m.worst_residual.region === null ? '' : `[${m.worst_residual.region}]`} ${m.worst_residual.value} ${m.worst_residual.bound?.op} ${m.worst_residual.bound?.value}`;
      const from = s === null ? 'unread' : `${s.boundaryVertices}+${s.interiorVertices}`;
      const run = motion.find((x) => x.part === m.part);
      const moved = run === undefined ? 'motion not compared (the gate is red)' : run.report !== null ? motionClause(run.report) : `motion not compared (${run.notCompared ?? 'refused'})`;
      const rp = replays.get(m.part);
      const replayed =
        rp === undefined || run?.report === null || run === undefined
          ? ''
          : `; replayed to accepted step ${rp.chosen_step} of ${rp.accepted_steps} after ${rp.replays} replay(s); selection ${readingText(rp.selection, roleReadings(run.report).bound)}; held out ${readingText(rp.held_out, roleReadings(run.report).bound)}`;
      log(`${head}auto ${from} -> ${r.boundaryVertices}+${r.interiorVertices} (hull+interior) bindings ${r.bindings} ${infl} ${t.reason}${tried}; worst ${worst}${unboundedClause(m.residuals, m.settings.targets.artFit)}${allocationClause(m.residuals)}${stageBClause(m.settings, m.result)}${residualClause(m.skinning_residual)}${strayClause(m.stray_cleared)}; ${moved}${replayed}`);
    } else if ('mode' in m && m.mode === 'explicit') {
      log(`${head}explicit ${infl} image sha256 ${m.image_sha256} region sha256 ${m.region_sha256}`);
    } else if ('mode' in m && m.mode === 'influence') {
      // issue #378: rig-c's segments lattice and pull, the figures its own build prints for the generator (AUTHORING §3.4.7).
      const i = m.influence;
      const l = m.lattice;
      log(`${head}influence cell=${i.cell} radius=${i.radius} ${i.shape} ${i.across ? 'across entries' : 'within the nearest entry'} max ${i.max} ${infl}`);
      log(`        reach      farthest vertex ${m.reach.farthest}px from its nearest link "${m.reach.nearest}" at (${m.reach.at.join(', ')}), radius ${i.radius}px: ${m.reach.capped} of ${m.vertices} vertices had more links in reach than max (widest ${m.reach.widest})`);
      log(`        lattice    cell ${i.cell}px, ${l.cols}x${l.rows} cells, ${l.artCells} with art, ${l.keptCells} kept${l.islands > 1 ? ` (${l.islands} island(s) joined into one outline)` : ''}`);
    } else if ('mode' in m) {
      const c = m.contour;
      const stray = c.strayIslands === 0 ? '' : ` left out ${c.strayIslands} island(s), ${c.strayPixels} px`;
      const regions = m.regions.map((rg) => ` region ${rg.name}->${rg.bone} reaches ${rg.reached} (${rg.whole} whole)`).join('');
      log(`${head}contour tol=${m.params.tolerance} margin=${m.params.margin} spacing=${m.params.spacing}${m.params.maxEdge === undefined ? '' : ` maxEdge=${m.params.maxEdge} (outline +${c.outlineCut ?? 0})`} ${infl} overshoot ${c.overshoot} min angle ${c.smallestAngle.value}${stray}${regions}`);
    } else {
      // issue #303: only beside a declared stray, so a lattice line without one reads as it always did.
      const stray = m.stray_cleared === undefined ? '' : ` stray ${m.stray} left out ${m.stray_cleared.islands} island(s), ${m.stray_cleared.pixels} of ${m.stray_cleared.art_pixels} art px`;
      log(`${head}grid=${m.grid} ${infl} loop passes ${rig.loopPasses[m.part]}${stray}`);
    }
  }
  const regions = rig.rig.slots.length - rig.meshReport.length;
  const tracks = rig.motion.animations.idle.tracks;
  const keys = tracks.reduce((n, t) => n + t.keys.length, 0);
  log(
    `  bones ${rig.rig.bones.length} (${rig.controls.length} control) slots ${rig.rig.slots.length} meshes ${rig.meshReport.length} regions ${regions} vertices ${vertices}; idle ${rig.motion.animations.idle.duration} s, ${tracks.length} track(s), ${keys} key(s)`,
  );
  if (from !== null) log(`  animations beside the idle, from ${from.file} as written: ${Object.keys(from.table).join(', ') || 'none'}`);
  log(faceAxisLine(rig.faceAxis));
  if (rig.turn !== null) log(turnLine(rig.turn));
  for (const w of rig.turnWarnings ?? []) log(`  WARN  ${w.code}: ${w.object} — ${w.detail}`);
  log(
    rig.idleKeys === 'ctl'
      ? `  idle keys ctl: ${rig.meshKeyed.length} mesh-driving bone(s) keyed by the idle, each keyed through a same-origin <bone>_ctl parent`
      : `  idle keys direct: ${rig.meshKeyed.length} mesh-driving bone(s) keyed in place, ${rig.rig.invariants === undefined ? 'so no invariants.idleDrivesMeshes is declared (it would switch nothing off)' : 'invariants.idleDrivesMeshes declared'}`,
  );
  for (const g of firstGate) {
    log(`  rigc ${g.label}: exit ${g.status}`);
    for (const l of g.lines) log(`    ${l.trim()}`);
  }
  for (const r of firstMotion) {
    if (r.candidate !== undefined) {
      log(`  rigc ${r.candidate.label}, candidate "${r.part}" with its declared stimulus: exit ${r.candidate.status}`);
      for (const l of r.candidate.lines) log(`    ${l.trim()}`);
    }
    if (r.reference === null) continue;
    log(`  rigc ${r.reference.label}, reference "${r.part}" (its unreduced source mesh): exit ${r.reference.status}`);
    for (const l of r.reference.lines) log(`    ${l.trim()}`);
  }
  for (const s of searches) for (const l of s.lines) log(`  ${l}`);
  if (finalGate !== null) {
    for (const g of finalGate) {
      log(`  rigc ${g.label}, the rig with its replayed step(s): exit ${g.status}`);
      for (const l of g.lines) log(`    ${l.trim()}`);
    }
    for (const r of finalMotion) {
      if (r.candidate !== undefined) {
        log(`  rigc ${r.candidate.label}, candidate "${r.part}" with its declared stimulus and replayed step(s): exit ${r.candidate.status}`);
        for (const l of r.candidate.lines) log(`    ${l.trim()}`);
      }
      if (r.reference === null) continue;
      log(`  rigc ${r.reference.label}, reference "${r.part}" against the rig with its replayed step(s): exit ${r.reference.status}`);
      for (const l of r.reference.lines) log(`    ${l.trim()}`);
    }
  }
  if (red.length > 0) {
    const problems: Problem[] = red.map((g) => ({
      code: 'RIG_RIGC_GREEN',
      object: `rigc ${g.label}`,
      detail: `exited ${g.status}${g.lines.length > 0 ? `: ${g.lines.map((l) => l.trim()).join(' | ')}` : ', and it printed nothing'}${rigcRanClause(g)}; ${ctlRemedies(g.lines, rig.controls, input.command ?? 'rig').map((s) => `${s}; `).join('')}exit 0 is required before anything is written, and nothing was`,
    }));
    throw new PartsError(problems);
  }
  // Emit only after green: a part the motion gate did not accept refuses the stage, every part's problem named at once.
  refuseIfAny(motion.flatMap((r) => r.problems));
  if (motion.length > 0) {
    const rows = withMotion(rig.meshReport, motion, rig.autoMotion, replays);
    rig.meshReport.splice(0, rig.meshReport.length, ...rows);
    texts[2] = ['mesh_report.json', rigJsonText(rig.meshReport)];
  }
  const layout = rig.layout === undefined ? undefined : layoutCompanion(rig.layout, rig.rig, texts[0][1], texts.find(([n]) => n === SETS_FILE)?.[1]);
  // This stage owns the companion. A red run reaches neither cleanup nor emit.
  if (layout === undefined) rmSync(join(input.out, LAYOUT_FILE), { force: true });
  mkdirSync(join(input.out, 'images'), { recursive: true });
  for (const [file, img] of rig.images) writePng(join(input.out, 'images', file), img);
  for (const [file, text] of texts) writeFileSync(join(input.out, file), text);
  if (layout !== undefined) writeFileSync(join(input.out, LAYOUT_FILE), rigJsonText(layout));
  log(`rig-parts rig: wrote ${join(input.out, 'rig.json')}, motion.json, mesh_report.json and ${rig.images.length} image(s) under ${join(input.out, 'images')}`);
  return rig;
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

export interface CheckStageInput {
  /** The directory holding rig.json and motion.json. */
  rig: string;
  /**
   * The directory holding parts.json and parts/ (`--parts`). Absent, it is the
   * rig directory, where a missing parts.json is measured without (issue #77);
   * named, a missing one is refused.
   */
  parts?: string;
  out: string;
  /** The painting `--source` names (issue #77): adds the setup pose against it. */
  source?: string;
  /** The packed build's `--page-edges`; {@link DEFAULT_PAGE_EDGES} when absent. */
  pageEdges?: PageEdges;
  /** The packed build's `--pack-shape`; {@link DEFAULT_PACK_SHAPE} when absent. */
  packShape?: PackShape;
  /** The scene's declared requirements (`--requirements`, issue #93); absent, nothing is read, written or printed for them. */
  requirements?: string;
  /** The path `check.json`'s `requirements.file` records (issue #556): `config.requirements` as declared when build read it from the config; absent, `requirements` as given. */
  requirementsAs?: string;
  /** The config `build` read (issue #607), recorded as `check.json`'s `config`; absent, no key is written, as `check` alone writes none. */
  config?: InputFileRecord;
  /**
   * `check --seam-pairs` (issue #202): split the seam's counted pixels by pair
   * and draw each pair's picture even when the bar passes. A failing seam is
   * always split; absent and passing, nothing is written or printed for it.
   */
  seamPairs?: boolean;
  /** `check --keep-stills` (issue #209): leave the setup-pose still and its `frames.json` under {@link STILL_DIR}. */
  keepStills?: boolean;
  /** Skip the extra extremes renders and remove stale extremes outputs (issue #829). */
  noExtremes?: boolean;
  /** `check --set <name>` (issue #454): measure one declared alternate set's setup-pose seam and recomposite figures. */
  set?: string;
  /** `check --all-sets` (issue #454): measure every declared alternate set's setup-pose seam and recomposite figures. */
  allSets?: boolean;
  /**
   * `check --environment <file>` (issue #538): a `rigc-environment/1` schedule every render a bar or a warning reads
   * with the physics on is posed under; absent, no render argument and no byte of `check.json` moves.
   */
  environment?: string;
  /**
   * `check --wind-band <spec.json>` (issue #590): a `rig-parts-wind-band/1` steady-wind sweep specification;
   * absent, no sweep runs and no byte of `check.json` moves.
   */
  windBand?: string;
}

/**
 * What a declared `source.stray` cleared, as the rig stage prints it on the part's mesh line (issue #172): empty when
 * nothing was declared or nothing was left out, so such a line prints what it always printed.
 */
export function strayClause(cleared: StrayCleared | undefined): string {
  if (cleared === undefined || cleared.islands === 0) return '';
  return `; stray cleared ${cleared.islands} island(s), ${cleared.pixels} of ${cleared.art_pixels} art px, from the art every reader of the mesh takes (the image is drawn as assembled)`;
}

/** The pack line as it is printed: rigc's own, then the page's opaque share beside the spineboy yardstick. */
export function packLines(r: CheckReport): string[] {
  if (r.pack.length === 0) return ['pack: no pack line in the build output'];
  return r.pack.map((p) => {
    const op = r.packOpaque.find((o) => o.page === p.page);
    return `${p.line}; page opaque ${op === undefined ? 'not measured (page not on disk)' : `${(op.share * 100).toFixed(1)}%`} (alpha > 0) — spineboy yardstick ${SPINEBOY_YARDSTICK}, a reference and not a bar`;
  });
}

function showFigure(v: unknown): string {
  if (Array.isArray(v)) return v.length === 0 ? 'none' : v.map(showFigure).join(' | ');
  if (typeof v === 'object' && v !== null) return Object.entries(v).map(([k, x]) => `${k} ${showFigure(x)}`).join(', ');
  return String(v);
}

/**
 * The rig stage's face-axis line (issue #239): the eye line's angle, the parts it runs between and the face bones
 * turned to it, or why there is no line and the face bones keep the page's axes — the note a one-eyed painting gets.
 * With a line it also names the `invariants.axes` entry written for rigc's A51, its tolerance, or why none was; and
 * the entry holding the face bones whose own tip lies along the line, or each such bone with why it is not held
 * (issue #258) — a face with no entry is never silent.
 */
export function faceAxisLine(f: FaceAxis): string {
  const own = f.ownTip.length === 0 ? '' : `; ${f.ownTip.join(', ')} ${f.ownTip.length === 1 ? 'takes its' : 'take their'} own tip`;
  if (f.degrees === null) return `  face axis: none — ${f.none}; ${f.ownTip.length === 0 ? 'the face bones keep' : 'the other face bones keep'} the page's axes${own}`;
  const turned = f.turned.length === 0 ? 'no face bone to turn' : `${f.turned.join(', ')} turned to it`;
  const held =
    f.axis !== null
      ? `; invariants.axes "${f.axis.name}" holds ${f.axis.bones.join(', ')} to the line through ${f.axis.through.join(' -> ')}, tolerance ${f.axis.tolerance} degrees (rigc's A51)`
      : f.noAxis !== null
        ? `; no invariants.axes entry: ${f.noAxis}`
        : '';
  // Issue #258: the tipped face bones are held in an entry of their own, or each is named with why it is not.
  const tips =
    f.noAxis !== null && f.turned.length === 0
      ? ''
      : `${f.tipAxis === null ? '' : `; invariants.axes "${f.tipAxis.name}" holds ${f.tipAxis.bones.join(', ')}, whose own tips lie along the line within whole-pixel rounding, tolerance ${f.tipAxis.tolerance} degrees (rigc's A51)`}${f.tipOff.map((t) => `; ${t}`).join('')}`;
  // Issue #250: the slotless bone carrying the face's up axis under head, or why there is none.
  const up = f.headUp !== null ? `; head_up under head along the face's up axis, ${f.headUp.rotation} degrees, ${f.headUp.length} px (head's origin to the eye midpoint along it)` : f.headUpNone !== null ? `; no head_up: ${f.headUpNone}` : '';
  return `  face axis: ${pyRound(f.degrees, 6)} degrees, the line through the eye bones eye_r and eye_l (on ${f.parts[0]} and ${f.parts[1]}); ${turned}${own}${held}${tips}${up}`;
}

/**
 * The rig stage's turn line (issue #251): the control, and per carried part its fraction, the depth it came from and
 * how many twins carry it — a part at the pivot depth said to stay. Printed only when the config has `turn`.
 */
export function turnLine(rows: readonly TurnRow[]): string {
  const carried = rows.filter((r) => r.twins.length > 0);
  const twins = carried.reduce((n, r) => n + r.twins.length, 0);
  const parts = rows.map((r) => (r.twins.length === 0 ? `${r.part} stays (depth ${r.depth}, the pivot's)` : `${r.part} ${r.fraction} (depth ${r.depth}, ${r.twins.length} twin(s))`));
  return `  turn: control "${TURN_BONE}" under root, keyed by nothing; ${carried.length} part(s) carried by ${carried.length} transform constraint(s) over ${twins} twin bone(s), each part's x a fraction of the control's: ${parts.join(', ')}`;
}

/** A judgement line as the console prints it: its name, its status, then its figures and bars as check.json holds them (a SKIP prints its reason). */
export function judgementLine(name: string, line: JudgementLine | ReportedLine): string {
  if (line.status === 'SKIP') return `${name}: SKIP — ${String(line.reason)}`;
  return `${name}: ${line.status} — ${Object.entries(line)
    .filter(([k]) => k !== 'status')
    .map(([k, v]) => `${k} ${showFigure(v)}`)
    .join('; ')}`;
}

/**
 * The fold line (issues #320, #333, #363) as the console prints it: the status,
 * what was read and at what rate, and then each folding mesh on a line of its
 * own, with physics on and off side by side (and its physics constraints named
 * when only physics folds it), rigc's own words, and the declaration's why
 * where `may_fold` takes it.
 */
export function foldsLines(line: FoldsLine): string[] {
  const physics = line.physics_left_out === 0 ? '' : `, with its ${line.physics_left_out} physics constraint(s) on and off`;
  const head =
    `${FOLD_LINE}: ${line.status} — ${line.animations.length} animation(s) read by rigc render --folds at ${line.fps} fps${physics} (${line.animations.join(', ')}): ` +
    `${line.folding.length} folding mesh(es), ${line.folding_undeclared} not declared in may_fold (<= ${line.bar})` +
    (line.declared_not_folding.length === 0 ? '' : `; may_fold declares ${line.declared_not_folding.map((d) => `slot "${d.slot}" in "${d.animation}"`).join(', ')}, which do(es) not fold`);
  return [
    head,
    ...line.folding.map((r) => {
      const side =
        line.physics_left_out === 0
          ? ''
          : ` — physics on: ${r.physics_on === null ? '0 frame(s)' : `${r.physics_on.frames} frame(s), worst frame ${r.physics_on.worst_frame} (${r.physics_on.worst_triangles}/${r.triangles} triangle(s))`}; physics off: ${r.physics_off === null ? '0 frame(s)' : `${r.physics_off.frames} frame(s), worst frame ${r.physics_off.worst_frame} (${r.physics_off.worst_triangles}/${r.triangles} triangle(s))`}` +
            (r.physics_constraints.length === 0 ? '' : `; physics constraint(s): ${r.physics_constraints.join(', ')}`);
      return `  folds  ${r.line}${side}${r.declared === null ? '' : ` — declared in may_fold: ${r.declared}`}`;
    }),
  ];
}

/**
 * The feet-level line (issue #348) as the console prints it: the status, what was read, the bar and whose it is, then
 * each foot on a line of its own — its bone, what that hangs from, how many frames posed it, and the worst turn with
 * the bone that was turned and the bones it came through. A SKIP prints its reason.
 */
export function levelLines(line: LevelLine): string[] {
  const physics = line.physics_left_out === 0 ? '' : `, its ${line.physics_left_out} physics constraint(s) left out`;
  const read = `${line.animations.length} animation(s) read by rigc render --folds --geometry at ${line.fps} fps${physics} (${line.animations.join(', ')})`;
  const head =
    line.status === 'SKIP'
      ? `${LEVEL_LINE}: SKIP — ${String(line.reason)}; ${read}`
      : `${LEVEL_LINE}: ${line.status} — ${read}: each foot's drawing within ±${line.bar_degrees} degrees of its setup pose while a bone above it is turned, ${line.bar}`;
  return [
    head,
    ...line.feet.map((f) => {
      const at = `foot  "${f.part}" on "${f.bone}" (hangs from "${f.hangs_from}"): ${f.status}, ${f.frames_posed} posed frame(s)`;
      if (f.worst === null) return `${at}, so nothing was measured`;
      const w = f.worst;
      return `${at}; worst ${w.degrees} degrees in "${w.animation}" frame ${w.frame} (t = ${w.time}s), "${w.turned}" turned ${w.turned_degrees}, through ${w.through.map((x) => `${x.bone} (inherit ${x.inherit})`).join(', ')}`;
    }),
  ];
}

/**
 * The limb line (issue #349) as the console prints it: the status and the bar, then each limb part on a line of its
 * own — its limb, its bone, and on a FAIL every other bone it is bound to.
 */
export function limbCheckLines(line: LimbLine): string[] {
  return [
    `${LIMB_LINE}: ${line.status} — ${line.parts.length} limb part(s), each bound in rig.json to its one bone with weight 1 (a region on it, or a mesh weighted to it alone)`,
    ...line.parts.map((r) => `limb  "${r.part}" (${r.limb}) on "${r.bone}": ${r.status}${r.others.length === 0 ? '' : `, also weighted to ${r.others.map((b) => `"${b}"`).join(', ')}`}`),
  ];
}

/**
 * The seam over the range (issue #360) as the console prints it: the status, what was posed and the bar, then each
 * joint at each angle on a line of its own — its status and the seam figures there — or, not read, why.
 */
export function sweepCheckLines(line: SweepLine, steps: ReadonlyMap<string, { left: number; right: number }> = new Map()): string[] {
  const s = line.frame_scale;
  return [
    `${SWEEP_LINE}: ${line.status} — ${line.joints.length} joint(s) bent to their declared range's ends and middle${line.physics_left_out === 0 ? '' : `, ${line.physics_left_out} physics constraint(s) left out`}; at each, the pose against the same pose with the joint's own art drawn under the limb, on the rest-pose seam's bar (mean |d| <= ${line.bar.mean.toFixed(1)}, <= ${line.bar.rig_px_over_40} rig px over ${line.bar.level})${s === null ? '' : ` at frame scale ${s}`}`,
    ...line.joints.flatMap((j) => {
      const head = `joint "${j.joint}" (${j.limb}, "${j.part}" on "${j.bone}", range [${j.range.join(', ')}]${j.shape === undefined ? '' : `, cap_shape "${j.shape}": no pixel over ${line.bar.level} in the disc`})`;
      if (j.unread !== undefined) return [`${head}: FAIL — not read: ${j.unread}`];
      // Issue #557: the contour step, a reading on every row (check.json carries it only for a short cap).
      return j.poses.map((p) => {
        const st = p.step_px ?? steps.get(`${j.part} ${p.degrees}`);
        return `${head} at ${p.degrees}°: ${p.status} — mean |d| ${p.mean}/255, ${p.px_over_40} frame px over ${line.bar.level} (${p.px_over_80} over ${SEAM_PX_LEVEL_HIGH}), ${p.rig_px_over_40.toFixed(2)} rig px${st === undefined ? '' : `; contour step ${st.left} px left, ${st.right} px right (a reading)`}`;
      });
    }),
  ];
}

/**
 * The seam over every animation (issue #493) as the console prints it: the status, what was read, the floor and that
 * it is not a bar, then one WARN line per pair and animation with a frame over the floor, and a line per pair rigc
 * read nothing of (its SKIP) or the line could not read. A SKIP with nothing declared prints its reason alone.
 */
export function motionSeamLines(line: MotionSeamLine, plant: MotionSeamPlant = {}): string[] {
  const unmeasured = (line.roots?.unmeasured ?? []).map(root => `root pair for ${root.limb} (${root.part}, bone "${root.bone}", parent "${root.parent}", candidates ${root.candidates.join('/')}): SKIP — ${root.reason}`);
  const rootStatus = line.roots === undefined ? '' : '; body-root gap-open+under-ghost gate ' + line.roots.status + ' (' + line.roots.pairs.length + ' pair(s)); ghost ownership from resolved draw order' + (line.roots.reason === undefined ? '' : ' — ' + line.roots.reason);
  if (line.worlds === undefined && line.status === 'SKIP' && line.rows.length === 0 && line.pairs.every((p) => p.unread === undefined)) return [`${MOTION_SEAM_LINE}: SKIP — ${String(line.reason)}${unmeasured.length === 0 ? '' : rootStatus}`, ...unmeasured];
  const read = `${line.pairs.length} declared pair(s) in ${line.animations.length} animation(s) (${line.animations.join(', ')}), read by rigc render --seam at ${line.fps} fps on the build as played`;
  const head =
    line.status === 'SKIP'
      ? `${MOTION_SEAM_LINE}: SKIP — ${String(line.reason)}; ${read}${unmeasured.length === 0 ? '' : rootStatus}`
      : `${MOTION_SEAM_LINE}: ${line.status} — ${read}: ${line.warnings} warning(s), never a bar${rootStatus}; ${line.floor}`;
  return [
    head,
    ...unmeasured,
    ...line.pairs.filter((p) => p.unread !== undefined).map((p) => `seam "${p.pair}" (${p.declared.join('; ')}): not read — ${String(p.unread)}`),
    ...line.rows.filter((r) => r.status === 'skip').map((r) => `seam "${r.pair}" in "${r.animation}": SKIP — rigc read no band on any of the ${r.drawn} frame(s) both slots draw, so there is no seam to read`),
    ...(plant.silent === true ? [] : line.rows.filter((r) => r.opens.length > 0).map(r => line.pairs.some(p => p.pair === r.pair && p.root !== undefined)
      ? `FAIL seam "${r.pair}" opens on ${r.opens.length} frame(s) ${frameRuns(r.opens)} max ${r.max_px} px in "${r.animation}" — body-root gapOpen + UNDER-owned ghost over the one-cell floor`
      : motionSeamWarnText(r))),
    ...line.rows.flatMap(r => (r.cells ?? []).map(h =>
      `INFO seam "${r.pair}" in "${r.animation}" frame ${h.index}: gapOpen ${h.gapOpen}, gapCovered ${h.gapCovered}, ghost ${h.ghostA + h.ghostB}; UNDER ${h.under ?? 'none'} ghost ${h.underGhost}, OVER ghost ${h.overGhost}; counted ${h.counted}`)),
    ...line.rows.filter((r) => r.opens.length === 0 && r.under_floor.length > 0).map((r) => `seam "${r.pair}" in "${r.animation}": under the floor — rigc names ${r.under_floor.length} frame(s) open ${frameRuns(r.under_floor)}, each opening one cell thick`),
    ...(line.worlds === undefined ? [] : (['default', 'still'] as const).flatMap(name => {
      const w = line.worlds?.[name];
      if (w === undefined) return [];
      const label = 'seam world "' + name + '"';
      const header = label + ' wind [' + w.wind.join(', ') + '], gravity [' + w.gravity.join(', ') + ']: ' + w.status +
        (w.status === 'SKIP' ? ' — ' + String(w.reason) : ' — raw gap/ghost cell counts, informational, not judged') +
        (w.dir === undefined ? '' : '; raw render: ' + w.dir);
      return [header, ...w.rows.map(r => {
        const head = label + ' "' + r.pair + '" in "' + r.animation + '": ';
        if (r.status === 'skip') return head + 'SKIP — rigc read no band';
        const at = (kind: typeof r.gap) => kind.worst === null ? 'none' : 'frame ' + kind.worst.index + ' (t = ' + kind.worst.index / line.fps + 's)';
        return head + 'gap ' + r.gap.max_px + ' cell(s), worst ' + at(r.gap) + '; ghost ' + r.ghost.max_px + ' cell(s), worst ' + at(r.ghost);
      })];
    })),
  ];
}

/**
 * The cloth reading (issue #501) as the console prints it: the status, what was read, the floor, the levers and that it
 * is not a bar, then one WARN line per chain that settles. A SKIP prints its reason alone. `silent` is the mutant that
 * removes the reading's lines.
 */
export function clothLines(line: ClothLine, plant: { silent?: boolean } = {}): string[] {
  if (plant.silent === true) return [];
  if (line.status === 'SKIP') return [`${CLOTH_LINE}: SKIP — ${String(line.reason)}`];
  const read = `${line.rows.length} physics chain(s) read by their tip on the idle as rendered (${line.frames} frame(s) at ${line.fps} fps over ${line.duration} s, physics on)`;
  return [
    `${CLOTH_LINE}: ${line.status} — ${read}: ${line.warnings} of them settle before the loop's length — ${line.warnings} warning(s), never a bar; ${line.floor}; ${line.levers}`,
    ...line.rows.filter((r) => r.settles_at !== null).map((r) => clothWarnText(r, line.duration)),
  ];
}

/** A requirement's line as the console prints it: its name and status, the reason first when NOT MEASURABLE, then its figures as check.json holds them. */
export function requirementText(name: string, line: RequirementLine): string {
  const rest = Object.entries(line).filter(([k]) => k !== 'status' && k !== 'reason');
  return `${name}: ${line.status} — ${[...(line.status === 'NOT MEASURABLE' ? [String(line.reason)] : []), ...rest.map(([k, v]) => `${k} ${showFigure(v)}`)].join('; ')}`;
}

/**
 * Run the check and print its report. Returns the report; `figures.PASS` says
 * whether every bar was met, and each one that was not is printed as a FAIL
 * line here. Throws a PartsError when the check could not measure at all.
 */
export function checkStage(input: CheckStageInput, rigc: RigcRunner, bin: string, log: Log): CheckReport {
  const v = rigc(['--version']);
  log(`rig-parts check: ${input.rig} -> ${input.out}`);
  const versionLines = v.out.trim().split('\n');
  const entryLine = versionLines.find((l) => l.startsWith('entry:'));
  log(`  ${rigcIdentity(bin, v)}${entryLine === undefined ? '' : `; ${entryLine}`}`);
  const mode: PackMode = { pageEdges: input.pageEdges ?? DEFAULT_PAGE_EDGES, packShape: input.packShape ?? DEFAULT_PACK_SHAPE };
  const r = runCheck(input.rig, input.out, rigc, input.parts, mode, input.source, input.requirements, input.seamPairs === true, input.keepStills === true, input.set, input.allSets === true, input.environment, input.requirementsAs, input.config, input.windBand, input.noExtremes === true);
  if (r.figures.environment !== undefined) log(`  ${environmentLine(r.figures.environment)}`);
  log(`  gate rig-play (rigc ${packedBuildLabel(mode)}), verbatim:`);
  for (const l of r.gateHtml) log(l);
  for (const l of packLines(r)) log(`  ${l}`);
  for (const line of r.extremes ?? []) log(`  ${line}`);
  const fig = r.figures;
  if (r.idle === null) log(`  loop: SKIP — ${fig.skipped?.loop ?? ''}`);
  else log(`  ${loopCheckLine(r.idle, fig.loop_max_diff, fig.loop_physics?.length ?? 0)}`);
  if (r.loopPhysics !== null) log(`  ${r.loopPhysics}`);
  const beside = besideIdleLine(r.besideIdle, r.figures[LEVEL_LINE] !== undefined);
  if (beside !== null) log(`  ${beside}`);
  if (r.seamViewport === null || fig.seam_mean === null) log(`  seam: SKIP — ${fig.skipped?.seam ?? ''}`);
  else {
    log(
      `  seam${fig.seam_border === undefined ? '' : ` (config.scene: ${fig.seam_border.frame_px_left_out} frame px on the painting's border rows and columns left out, ${fig.seam_border.px_over_40_left_out} of them over ${SEAM_PX_LEVEL})`}: setup pose at ${r.seamViewport.pixelWidth}x${r.seamViewport.pixelHeight}, scale ${r.seamViewport.scale.toFixed(4)}: mean |d| ${fig.seam_mean} (<= ${SEAM_MEAN_BAR.toFixed(1)}), ` +
        `${fig.seam_px_over_40} px over ${SEAM_PX_LEVEL}, ${fig.seam_frame_scale === null || fig.seam_px_over_40 === null ? '' : seamRigPxText(fig.seam_px_over_40, fig.seam_frame_scale)} rig px (the count / s²; <= ${SEAM_PX_BAR}), ${fig.seam_px_over_80} px over ${SEAM_PX_LEVEL_HIGH} (reported)`,
    );
    if (fig.seam_scope !== undefined) log(`  seam scope: ${fig.seam_scope.mode}, denominator ${fig.seam_scope.denominator_px} source cells; union ${fig.seam_scope.domain?.viewport.pixelWidth}x${fig.seam_scope.domain?.viewport.pixelHeight}, numerator ${fig.seam_scope.domain?.numerator}; auto-frame raw mean ${fig.seam_scope.auto_frame_raw.mean}, ${fig.seam_scope.auto_frame_raw.px_over_40} px over ${SEAM_PX_LEVEL} at scale ${fig.seam_scope.auto_frame_raw.frame_scale} (diagnostic only)`);
    const pairs = fig.seam_pairs ?? [];
    pairs.forEach((row, i) => log(`  seam pair ${i + 1} of ${pairs.length}: ${seamPairText(row)}`));
    if (fig.sets !== undefined) {
      for (const [setName, setFig] of Object.entries(fig.sets)) {
        log(
          `  seam (${setName})${setFig.seam_border === undefined ? '' : ` (config.scene: ${setFig.seam_border.frame_px_left_out} frame px on the painting's border rows and columns left out, ${setFig.seam_border.px_over_40_left_out} of them over ${SEAM_PX_LEVEL})`}: setup pose at ${setFig.render_px}, scale ${setFig.seam_frame_scale.toFixed(4)}: mean |d| ${setFig.seam_mean} (<= ${SEAM_MEAN_BAR.toFixed(1)}), ` +
            `${setFig.seam_px_over_40} px over ${SEAM_PX_LEVEL}, ${seamRigPxText(setFig.seam_px_over_40, setFig.seam_frame_scale)} rig px (the count / s²; <= ${SEAM_PX_BAR}), ${setFig.seam_px_over_80} px over ${SEAM_PX_LEVEL_HIGH} (reported)`,
        );
        if (setFig.seam_scope !== undefined) {
          const scope = setFig.seam_scope;
          log(`  seam scope (${setName}): ${scope.mode}, denominator ${scope.denominator_px} base source cells; union ${scope.domain?.viewport.pixelWidth}x${scope.domain?.viewport.pixelHeight}, numerator ${scope.domain?.numerator}; whole canonical ${scope.whole.px_over_40} px over ${SEAM_PX_LEVEL}, mean ${scope.whole.mean}; auto-frame raw ${scope.auto_frame_raw.px_over_40} at scale ${scope.auto_frame_raw.frame_scale} (diagnostic only); effects ${JSON.stringify(scope.effects)}, changes ${JSON.stringify(scope.changes)}${scope.unavailable === undefined ? '' : `; ${JSON.stringify(scope.unavailable)}`}`);
          for (const pair of scope.pairs ?? []) log(`  seam inheritance (${setName}): ${JSON.stringify(pair.parts)}, whole ${pair.whole_px_over_40}, affected ${pair.affected_px_over_40}, inherited from base ${pair.inherited_px_over_40} px over ${SEAM_PX_LEVEL}`);
        }
        const setPairs = setFig.seam_pairs ?? [];
        setPairs.forEach((row, i) => log(`  seam pair (${setName}) ${i + 1} of ${setPairs.length}: ${seamPairText(row)}`));
      }
    }
  }
  for (const name of JUDGEMENT_LINES) log(`  ${judgementLine(name, fig[name])}`);
  const folds = fig[FOLD_LINE];
  if (folds !== undefined) for (const l of foldsLines(folds)) log(`  ${l}`);
  const level = fig[LEVEL_LINE];
  if (level !== undefined) for (const [i, l] of levelLines(level).entries()) log(`  ${i === 0 ? '' : '  '}${l}`);
  const stress = fig[STRESS_LINE];
  if (stress !== undefined) log(`  ${judgementLine(STRESS_LINE, stress)}`);
  const limbs = fig[LIMB_LINE];
  if (limbs !== undefined) for (const [i, l] of limbCheckLines(limbs).entries()) log(`  ${i === 0 ? '' : '  '}${l}`);
  const sweep = fig[SWEEP_LINE];
  if (sweep !== undefined) for (const [i, l] of sweepCheckLines(sweep, r.sweepSteps).entries()) log(`  ${i === 0 ? '' : '  '}${l}`);
  for (const [i, l] of motionSeamLines(r.motionSeam).entries()) log(`  ${i === 0 ? '' : '  '}${l}`);
  for (const [i, l] of clothLines(r.cloth).entries()) log(`  ${i === 0 ? '' : '  '}${l}`);
  for (const name of REPORTED_LINES) log(`  ${judgementLine(name, fig[name])}`);
  if (fig.sets !== undefined) {
    for (const [setName, setFig] of Object.entries(fig.sets)) {
      log(`  ${judgementLine(`RECOMPOSITE_HOLES (${setName})`, setFig.RECOMPOSITE_HOLES)}`);
    }
  }
  const vsSource = fig[SOURCE_LINE];
  if (vsSource !== undefined) log(`  ${judgementLine(SOURCE_LINE, vsSource)}`);
  const windBand = fig[WIND_BAND_LINE];
  if (windBand !== undefined) for (const l of windBandLines(windBand)) log(`  ${l}`);
  const cutMaterial = fig[CUT_MATERIAL_LINE];
  if (cutMaterial !== undefined) for (const line of materialLines(cutMaterial)) log(`  ${line}`);
  const artJoints = fig[ART_JOINT_LINE];
  if (artJoints !== undefined) for (const line of artJointLines(artJoints)) log(`  ${line}`);
  const setupPainting = fig[SETUP_PAINTING_LINE];
  if (setupPainting !== undefined) for (const line of setupPaintingLines(setupPainting)) log(`  ${line}`);
  if (r.requirements !== null) {
    for (const [name, line] of Object.entries(r.requirements.lines)) log(`  ${requirementText(name, line)}`);
    log(`  ${summaryText(r.requirements.summary)}`);
  }
  log(`  gate: rig-play ${fig.gate_spine_html_green ? 'green' : 'RED'} (${fig.rigc_entry.entry}${fig.rigc_entry.spine_core === null ? ', rigc\'s own validator' : `, the spine-core ${fig.rigc_entry.spine_core} round trip`})`);
  log(`  wrote ${r.written.map((w) => join(input.out, w)).join(', ')}, ${join(input.out, 'build')}/${r.idle === null ? '' : `, ${join(input.out, 'idle_frames')}/`}${r.requirements === null ? '' : `, ${join(input.out, REQUIREMENTS_DIR)}/`}${fig.seam_pairs === undefined ? '' : `, ${join(input.out, SEAM_DIR)}/`}${existsSync(join(input.out, STILL_DIR)) ? `, ${join(input.out, STILL_DIR)}/` : ''}`);
  for (const p of r.problems) log(failLine(p));
  log(checkSummaryLine(r));
  return r;
}

// ---------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------

function sameRgba(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The loop file's format: `apng` is the lossless APNG, the exactness record;
 * `indexed` the colour-type-3 APNG with one shared palette, the README-sized
 * file; `gif` the GIF89a. The CLI picks it from the extension and `--palette`.
 */
export type LoopFormat = 'apng' | 'indexed' | 'gif';

export interface LoopResult {
  bytes: number;
  /** The palette error over every encoded frame; null for the lossless APNG, which has none. */
  error: PaletteError | null;
}

/**
 * The idle `build --loop --lead-in <n>` renders (issue #224's follow-up):
 * `idle` played n + 1 times back to back, of which the loop keeps the last
 * period. rigc's render resets physics at frame 0, so an idle whose rig
 * carries a physics constraint does not end where it starts; played on, a
 * spring the idle drives settles into the idle's period, and the last period
 * of the run is that steady state.
 */
export const LEAD_IN_ANIMATION = 'idle_lead_in';

/** Which frames of a lead-in run the loop keeps: the last of `periods + 1` periods. */
export interface LoopWindow {
  periods: number;
}

const LEAD_IN_ANIMATION_KEYS = ['duration', 'loop', 'note', 'tracks'];

/**
 * `motion` with {@link LEAD_IN_ANIMATION} added: every idle track's keys
 * repeated `periods + 1` times, each copy shifted by one idle duration, its
 * Bezier `curve` times with it, and the key at the end of a copy dropped for
 * the next copy's first key at the same time. Refused by name
 * (`LOOP_LEAD_IN_IDLE`), every problem at once, when the motion has no idle,
 * already has an animation of that name, or the idle is not a loop this can
 * repeat without inventing a value: a field besides duration, loop, note and
 * tracks; a track whose keys do not start at 0 and end at the duration; or one
 * whose last value is not its first.
 */
export function repeatIdle(motion: Record<string, unknown>, periods: number): Record<string, unknown> {
  const problems: Problem[] = [];
  const fail = (object: string, detail: string): void => {
    problems.push({ code: 'LOOP_LEAD_IN_IDLE', object, detail });
  };
  const anims = motion.animations;
  const table = typeof anims === 'object' && anims !== null && !Array.isArray(anims) ? (anims as Record<string, unknown>) : null;
  const idle = table?.idle;
  if (table === null || typeof idle !== 'object' || idle === null || Array.isArray(idle)) {
    fail('motion.json animations.idle', 'is absent; the lead-in repeats the idle');
    refuseIfAny(problems);
  }
  const t = table as Record<string, unknown>;
  const a = idle as Record<string, unknown>;
  if (LEAD_IN_ANIMATION in t) fail(`motion.json animations.${LEAD_IN_ANIMATION}`, 'exists; the lead-in writes an animation of that name and never replaces one');
  for (const k of Object.keys(a)) if (!LEAD_IN_ANIMATION_KEYS.includes(k)) fail(`motion.json animations.idle.${k}`, `is a field the lead-in does not repeat; the idle it repeats holds ${LEAD_IN_ANIMATION_KEYS.join(', ')}`);
  const d = a.duration;
  if (typeof d !== 'number' || !(d > 0)) fail('motion.json animations.idle.duration', `is ${JSON.stringify(d)}; a positive number is required`);
  const tracks = Array.isArray(a.tracks) ? a.tracks : [];
  const duration = d as number;
  const out: unknown[] = [];
  tracks.forEach((track, i) => {
    const tr = track as Record<string, unknown>;
    const keys = Array.isArray(tr.keys) ? (tr.keys as Array<Record<string, unknown>>) : [];
    const at = `motion.json animations.idle.tracks[${i}]`;
    const first = keys[0];
    const last = keys[keys.length - 1];
    if (first === undefined || first.t !== 0 || last.t !== duration) {
      fail(at, `keys run from ${String(first?.t)} to ${String(last?.t)}; a track the lead-in repeats starts at 0 and ends at the duration ${duration}`);
      return;
    }
    if (JSON.stringify(first.v) !== JSON.stringify(last.v)) {
      fail(at, `ends at ${JSON.stringify(last.v)} and starts at ${JSON.stringify(first.v)}; repeated, the idle would jump where one copy meets the next`);
      return;
    }
    const repeated: Array<Record<string, unknown>> = [];
    for (let r = 0; r <= periods; r++) {
      const shift = r * duration;
      keys.forEach((k, j) => {
        if (r < periods && j === keys.length - 1) return;
        const moved: Record<string, unknown> = { ...k, t: (k.t as number) + shift };
        if (Array.isArray(k.curve)) moved.curve = (k.curve as number[]).map((c, n) => (n % 2 === 0 ? c + shift : c));
        repeated.push(moved);
      });
    }
    out.push({ ...tr, keys: repeated });
  });
  refuseIfAny(problems);
  return { ...motion, animations: { ...t, [LEAD_IN_ANIMATION]: { duration: duration * (periods + 1), loop: false, tracks: out } } };
}

/**
 * Render {@link LEAD_IN_ANIMATION} of the rig in `rigDir` as `check` renders
 * the idle (the packed build, `IDLE_FPS`, `IDLE_MAX_PX`), every other
 * animation kept so the viewport is fitted as for the idle frames. Writes
 * under `dir` and returns the frame set's directory.
 */
export function leadInFrames(rigDir: string, dir: string, periods: number, rigc: RigcRunner, mode: PackMode): string {
  const rig = JSON.parse(readFileSync(join(rigDir, 'rig.json'), 'utf8')) as Record<string, unknown>;
  const motion = repeatIdle(JSON.parse(readFileSync(join(rigDir, 'motion.json'), 'utf8')) as Record<string, unknown>, periods);
  const images = typeof rig.images === 'string' ? resolve(rigDir, rig.images) : rig.images;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'rig.json'), JSON.stringify({ ...rig, images }));
  writeFileSync(join(dir, 'motion.json'), JSON.stringify(motion));
  const what = `the idle played ${periods + 1} times (${LEAD_IN_ANIMATION})`;
  const b = rigc(['build', '--rig', join(dir, 'rig.json'), '--motion', join(dir, 'motion.json'), '--out', join(dir, 'build'), ...packedBuildArgs(mode)]);
  if (b.status !== 0) refuseIfAny(rigcFailed(`${packedBuildLabel(mode)} (${what})`, b, buildGateLines(b.out)));
  const r = rigc(['render', '--candidate', join(dir, 'build'), '--animation', LEAD_IN_ANIMATION, '--fps', String(IDLE_FPS), '--max', String(IDLE_MAX_PX), '--out', join(dir, 'frames')]);
  if (r.status !== 0) refuseIfAny(rigcFailed(`render --animation ${LEAD_IN_ANIMATION} (${what})`, r, r.out.split('\n').filter((l) => l.includes('FAIL') || l.includes('rigc:'))));
  return join(dir, 'frames');
}

/** Pixels whose largest RGB channel difference between `a` and `b` is above `level`. */
function pixelsOver(a: Raster, b: Raster, level: number): number {
  let n = 0;
  for (let p = 0; p < a.width * a.height; p++) {
    let m = 0;
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.data[p * 4 + c] - b.data[p * 4 + c]));
    if (m > level) n++;
  }
  return n;
}

/**
 * `check`'s `loop:` line (issue #325). With physics constraints in the rig the
 * comparison it reports was made with them left out (issue #183), and the line
 * says so itself rather than leaving it to the `loop physics:` line below: the
 * loop stage compares the frames rendered with them, and on a rig with physics
 * those ends differ although this line reads max |d| 0.
 */
export function loopCheckLine(idle: { frames: number; fps: number; duration: number; lastIndex: number }, max: number | null, physics: number): string {
  const left = physics === 0 ? '' : ` with the rig's ${physics} physics constraint(s) left out (named on the \`loop physics:\` line; rendered with them, the ends need not meet — \`build --loop --lead-in <n>\`)`;
  return `loop: idle ${idle.frames} frame(s) at ${idle.fps} fps, f0000 vs f${String(idle.lastIndex).padStart(4, '0')} (t = ${idle.duration}s)${left}: max |d| ${String(max)} (0 required)`;
}

/**
 * The loop stage's line when the end frame is not frame 0 (issue #325): the
 * jump as measured (max |d| over R, G and B, and pixels over 40 — the lead-in
 * line's figures), then why. `physics` is how many physics constraints the rig
 * behind the frames holds; `build --loop` knows it from `check`, while
 * `loop --frames` reads frames alone and does not, so its line names both
 * causes. With physics, rigc's render starts every constraint at rest at frame
 * 0, so the idle does not end where it starts, and `--lead-in` is the remedy;
 * with none, the idle itself does not close, which `check`'s `loop:` line
 * measures — under `build`, which stops at that bar, the branch is reached
 * only by a difference the bar does not read.
 */
export function loopJumpLine(lastName: string, max: number, over40: number, physics: number | undefined): string {
  const jump = `${lastName} differs from f0000.png by max |d| ${max}, ${over40} px over 40, so every frame is kept and the loop will jump at the wrap`;
  const remedy = '`build --loop --lead-in <n>` plays the idle n periods ahead and keeps the last (docs/AUTHORING.md §5, *build --loop --lead-in*)';
  if (physics === undefined) {
    return `${jump}; the frames alone do not say why — if their rig holds a physics constraint, rigc's render starts it at rest at frame 0 and ${remedy}; if it holds none, the idle itself does not close, which \`check\`'s \`loop:\` line (CHECK_LOOP_CLOSES) measures`;
  }
  if (physics === 0) {
    return `${jump}: the rig holds no physics constraint, so the idle itself does not close — \`check\`'s \`loop:\` line (CHECK_LOOP_CLOSES) measures the same two frames, and \`--lead-in\`, which settles physics, is not the remedy`;
  }
  return `${jump}: the rig holds ${physics} physics constraint(s), and rigc's render starts every one at rest at frame 0, so the idle does not end where it starts — \`check\`'s \`loop:\` line read its ends with them left out; ${remedy}`;
}

/**
 * Encode a rigc frame set as a looping APNG, indexed APNG or GIF and write it.
 * An encoder refusal is a PartsError coded `LOOP_ENCODE`, so it prints like
 * every other. `physics` is how many physics constraints the frames' rig holds,
 * when the caller knows it ({@link loopJumpLine}).
 */
export function loopStage(frames: string, out: string, format: LoopFormat, log: Log, window?: LoopWindow, physics?: number): LoopResult {
  const set = readFrameSet(frames);
  const images = set.frames.map((fr) => fr.image);
  log(`rig-parts loop: ${set.dir} -> ${out}`);
  log(`  ${images.length} frame(s) ${images[0]?.width ?? 0}x${images[0]?.height ?? 0} at ${set.fps} fps (from frames.json), animation ${set.animation ?? '(none)'}`);
  let used = images;
  const lastName = set.frames[set.frames.length - 1]?.name ?? '';
  if (window !== undefined) {
    const per = (images.length - 1) / (window.periods + 1);
    if (!Number.isInteger(per) || per < 1) {
      throw new PartsError([{ code: 'LOOP_LEAD_IN_IDLE', object: set.dir, detail: `holds ${images.length} frame(s), which is not ${window.periods + 1} whole period(s) and the end frame; the lead-in keeps the last period` }]);
    }
    const start = window.periods * per;
    const end = start + per;
    const jump = maxRgbDiff(images[start], images[end]);
    used = images.slice(start, end);
    const name = (i: number): string => set.frames[i].name.replace('.png', '');
    log(`  lead-in: ${window.periods} period(s) of the idle played ahead, physics running; ${name(start)}–${name(end - 1)} kept (${per} frame(s), the last period); ${name(end)}, one period after ${name(start)}, differs from it by max |d| ${jump.max}, ${pixelsOver(images[start], images[end], 40)} px over 40 — the jump at the wrap`);
  } else if (images.length > 1 && sameRgba(images[0].data, images[images.length - 1].data)) {
    used = images.slice(0, -1);
    log(`  ${lastName} equals f0000.png byte for byte, so it is dropped: the loop wraps onto frame 0, and showing it twice would hold that pose for two ticks`);
  } else if (images.length > 1) {
    const last = images[images.length - 1];
    log(`  ${loopJumpLine(lastName, maxRgbDiff(images[0], last).max, pixelsOver(images[0], last, 40), physics)}`);
  }
  const anim: AnimFrame[] = used.map((image) => ({ image, ticks: 1 }));
  log(`  ${anim.length} frame(s) encoded, ${(anim.length / set.fps).toFixed(3)}s per loop, looping forever`);
  try {
    if (format === 'apng') {
      const { bytes, stats } = encodeApng(anim, set.fps);
      writeFileSync(out, bytes);
      log(`  APNG: ${stats.frames} frame(s) after merging identical neighbours, ${stats.overFrames} of ${Math.max(0, stats.frames - 1)} later frame(s) blended OVER with unchanged pixels cleared, lossless`);
      log(`  wrote ${out}: ${stats.bytes} bytes`);
      return { bytes: stats.bytes, error: null };
    }
    if (format === 'indexed') {
      const { bytes, stats } = encodeIndexedApng(anim, set.fps);
      writeFileSync(out, bytes);
      log(
        `  indexed APNG: ${stats.frames} frame(s) after merging, ${stats.overFrames} of ${Math.max(0, stats.frames - 1)} later frame(s) blended OVER; ${stats.entries} palette entries (1 transparent, ${stats.entries - 1} cut from ${stats.distinct} distinct), ${stats.bitDepth}-bit, ${INDEXED_DEFAULTS.dither ? 'Floyd–Steinberg dithering' : 'no dithering'}, filter ${INDEXED_DEFAULTS.adaptiveFilter ? 'adaptive' : 'None'}`,
      );
      log(`  ${errorText(stats.all)}`);
      log(`  wrote ${out}: ${stats.bytes} bytes`);
      return { bytes: stats.bytes, error: stats.all };
    }
    const { bytes, stats } = encodeGif(anim, set.fps);
    writeFileSync(out, bytes);
    log(`  GIF: ${stats.frames} frame(s) after merging, ${stats.colours} palette colour(s) cut from ${stats.distinct} distinct, no dithering`);
    log(`  palette error (per channel, of 255): frame 0 max ${stats.frame0.max}, mean ${stats.frame0.mean.toFixed(3)}; all frames max ${stats.all.max}, mean ${stats.all.mean.toFixed(3)}`);
    log(`  wrote ${out}: ${stats.bytes} bytes`);
    return { bytes: stats.bytes, error: stats.all };
  } catch (err) {
    if (err instanceof EncodeError) throw new PartsError([{ code: 'LOOP_ENCODE', object: out, detail: err.message }]);
    throw err;
  }
}

/** A palette error as the loop lines print it: R, G, B per channel over every frame, and alpha. */
function errorText(e: PaletteError): string {
  return `palette error (per channel, of 255, all frames): max ${e.max}, mean ${e.mean.toFixed(3)}; alpha max ${e.alphaMax}`;
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

export interface BuildInput {
  config: string;
  source: string;
  full: string;
  /** The head run, or null for one run that holds the face (issue #359). */
  head: string | null;
  out: string;
  seam: SeamRule;
  project: ProjectRule;
  loop: boolean;
  /** `--page-edges` for both packed builds, the rig stage's gate and the check's artifact. */
  pageEdges: PageEdges;
  /** `--pack-shape` for both packed builds, as `pageEdges`; {@link DEFAULT_PACK_SHAPE} when absent. */
  packShape?: PackShape;
  /** `--requirements`, forwarded to the check (issue #93): read before assemble runs, so a file check would refuse is refused first; absent, `config.requirements` is read in its place (issue #556, {@link buildRequirements}), and with neither nothing moves. */
  requirements?: string;
  /** `--idle-keys`, forwarded to the rig stage as `rig` takes it (issue #95); {@link DEFAULT_IDLE_KEYS} when absent. */
  idleKeys?: IdleKeys;
  /**
   * `--lead-in <n>`, with `loop` only: the loop is encoded from the last of n + 1
   * idle periods played back to back ({@link leadInFrames}) instead of from
   * `check/idle_frames/`; absent, the loop is as before.
   */
  leadIn?: number;
  /** `--seam-pairs`, forwarded to the check as `check` takes it (issue #257): the seam split by pair on a pass too; absent, nothing moves. */
  seamPairs?: boolean;
  /** `--keep-stills`, forwarded to the check as `check` takes it (issue #257): the setup-pose still under `check/setup_still/`; absent, nothing moves. */
  keepStills?: boolean;
  /** Skip the extra extremes renders and remove stale extremes outputs (issue #829). */
  noExtremes?: boolean;
  /** `--alt`, forwarded to the assemble stage as `assemble` takes it (issue #454). */
  alts?: readonly AlternateCliInput[];
  /** `--set <name>`, forwarded to the check as `check` takes it (issue #454). */
  set?: string;
  /** `--all-sets`, forwarded to the check as `check` takes it (issue #454). */
  allSets?: boolean;
  /** `--environment <file>`, forwarded to the check as `check` takes it (issue #538): read before assemble runs, so a schedule check would refuse is refused first; absent, nothing moves. */
  environment?: string;
  /** `--wind-band <spec.json>`, forwarded to the check as `check` takes it (issue #590): read before assemble runs, so a spec check would refuse is refused first; absent, nothing moves. */
  windBand?: string;
}

/** What `build` does with one flag `check` takes: hands it to its check stage, takes it as its own, or refuses it because build supplies the value itself. */
export type CheckFlagInBuild =
  | { as: 'forwarded' }
  | { as: 'own'; why: string }
  | { as: 'supplied'; why: string };

/**
 * Every flag `check` takes and what `build` does with it (issue #257). `cli.ts`
 * refuses a `supplied` flag on `build` with its `why`; the selftest holds the
 * table's keys to the flags `check`'s own refusal lists, so a flag added to
 * `check` without a line here is a named failure, not a flag `build` drops.
 */
export const CHECK_FLAGS_IN_BUILD: Readonly<Record<string, CheckFlagInBuild>> = {
  '--rig': { as: 'supplied', why: 'its check reads the rig its rig stage writes, <out>/rig; run check --rig to measure another rig' },
  '--out': { as: 'own', why: 'build\'s own --out; its check writes under <out>/check' },
  '--parts': { as: 'supplied', why: 'its check reads the parts its assemble stage writes, <out>; run check --parts to measure against others' },
  '--source': { as: 'own', why: 'the painting assemble reads; it is not handed to the check, so check.json carries no SETUP_POSE_VS_SOURCE — run check --rig <out>/rig --parts <out> --source <painting> for that line' },
  '--page-edges': { as: 'forwarded' },
  '--pack-shape': { as: 'forwarded' },
  '--requirements': { as: 'forwarded' },
  '--set': { as: 'forwarded' },
  '--all-sets': { as: 'forwarded' },
  '--seam-pairs': { as: 'forwarded' },
  '--keep-stills': { as: 'forwarded' },
  '--no-extremes': { as: 'forwarded' },
  '--environment': { as: 'forwarded' },
  '--wind-band': { as: 'forwarded' },
};

/** The requirements file build's check reads (issue #556): `read` is where it is opened, `recorded` what `check.json` names it by. */
export interface BuildRequirements {
  read: string;
  recorded: string;
}

/**
 * Which requirements file a build reads (issue #556): the `--requirements`
 * flag as typed, else `config.requirements` resolved against the config's
 * directory and recorded as declared, else none. Both given, they must name
 * one file — the same path once resolved, or a file of the same bytes — and the
 * declaration is the one read and recorded, so the build writes what a rebuild
 * from the config alone writes; two files of different bytes are
 * `BUILD_REQUIREMENTS_CONFLICT`, naming both.
 */
export function buildRequirements(flag: string | undefined, declared: string | undefined, configPath: string): BuildRequirements | null {
  if (declared === undefined) return flag === undefined ? null : { read: flag, recorded: flag };
  const fromConfig = resolve(dirname(resolve(configPath)), declared);
  if (flag === undefined || resolve(flag) === fromConfig) return { read: fromConfig, recorded: declared };
  const digestOf = (path: string): string | null => (existsSync(path) && statSync(path).isFile() ? createHash('sha256').update(readFileSync(path)).digest('hex') : null);
  const flagDigest = digestOf(resolve(flag));
  const configDigest = digestOf(fromConfig);
  if (flagDigest !== null && flagDigest === configDigest) return { read: fromConfig, recorded: declared };
  const shown = (d: string | null): string => (d === null ? 'no such file' : `sha256 ${d.slice(0, 16)}`);
  throw new PartsError([
    {
      code: 'BUILD_REQUIREMENTS_CONFLICT',
      object: `--requirements ${flag} and config.requirements "${declared}"`,
      detail: `the flag names ${resolve(flag)} (${shown(flagDigest)}) and the config declares ${fromConfig} (${shown(configDigest)}); a build reads one requirements file and records it, so the two must name the same file or the same bytes — drop the flag to build from the config's file, or point config.requirements at the flag's`,
    },
  ]);
}

/** The `build` refusal of a `check` flag build supplies itself ({@link CHECK_FLAGS_IN_BUILD}), or null for any other flag. */
export function suppliedCheckFlag(flag: string): string | null {
  const row = Object.hasOwn(CHECK_FLAGS_IN_BUILD, flag) ? CHECK_FLAGS_IN_BUILD[flag] : undefined;
  return row?.as === 'supplied' ? `build does not take "${flag}"; ${row.why}` : null;
}

/**
 * The rigc process for each stage: `rig` gates through one, `check` measures
 * through the other. `cli.ts` hands both the same runner, the `rigc` binary
 * rig-c's launcher answers for; they are two fields so a caller can tell
 * the stages' calls apart (the selftest counts them).
 */
/** Stage implementations may run outside this process; only check has a returned value the driver reads. */
export interface BuildStages {
  assemble: (input: AssembleStageInput, outputs: AssembleOutputs, log: Log) => void;
  rig: (input: RigStageInput, rigc: RigcRunner, scratch: string, log: Log) => void;
  check: typeof checkStage;
}

export interface BuildRunners {
  rig: RigcRunner;
  check: RigcRunner;
  /** The CLI isolates stages; API callers keep the same in-process functions by default. */
  stages?: BuildStages;
  /** Where the check's rigc binary is, for its header line. */
  checkBin: string;
  /** A directory the rig stage may stage its gate in, and the loop its lead-in render after it; emptied before and after each. */
  scratch: string;
}

/** Every path `build` writes under `--out`, relative — and so every path it clears first. */
export const BUILD_OWNS: readonly string[] = ['parts', 'parts.json', 'recomposite_rig.png', ERROR_MAP_FILE, 'rig', 'check', 'idle.gif', 'idle.png', 'idle-indexed.png'];

export type BuildStage = 'assemble' | 'rig' | 'check' | 'loop' | 'artifact';

export interface BuildResult {
  /** The stage that refused, or null when the build is green. */
  stoppedAt: BuildStage | null;
  check: CheckReport | null;
  /** The artifact's paths, on green: skeleton JSON, atlas, then each packed page. */
  artifact: string[];
}

/**
 * rigc's own record of the compiled rig, which `build` writes beside the
 * skeleton JSON and atlas (rig-c's AUTHORING, the `--out` row; written
 * since 1.6): what rigc's posing core reads, not a Spine file, so it is not the
 * artifact and is not counted as a second skeleton JSON.
 */
export const RIGC_MODEL_DOCUMENT = 'skeleton.model.json';

/** The three artifact files of a packed build, each refused by name when absent. */
export function artifactPaths(buildDir: string, pack: readonly PackLine[]): string[] {
  const problems: Problem[] = [];
  const names = existsSync(buildDir) ? readdirSync(buildDir).sort() : [];
  const json = names.filter((n) => n.endsWith('.json') && n !== RIGC_MODEL_DOCUMENT);
  const atlas = names.filter((n) => n.endsWith('.atlas'));
  if (json.length !== 1) problems.push({ code: 'BUILD_ARTIFACT_PRESENT', object: `${buildDir} skeleton JSON`, detail: `holds ${json.length} .json file(s) [${json.join(', ')}]; the packed build writes exactly one besides rigc's ${RIGC_MODEL_DOCUMENT}` });
  if (atlas.length !== 1) problems.push({ code: 'BUILD_ARTIFACT_PRESENT', object: `${buildDir} atlas`, detail: `holds ${atlas.length} .atlas file(s) [${atlas.join(', ')}]; the packed build writes exactly one` });
  if (pack.length === 0) problems.push({ code: 'BUILD_ARTIFACT_PRESENT', object: `${buildDir} packed page`, detail: 'rigc printed no pack line, so no packed page is named; the build runs with --pack and must print one' });
  for (const p of pack) {
    if (!names.includes(p.page)) problems.push({ code: 'BUILD_ARTIFACT_PRESENT', object: `${buildDir} packed page`, detail: `the pack line names ${p.page}, which is not on disk` });
  }
  if (problems.length > 0) throw new PartsError(problems);
  return [join(buildDir, json[0]), join(buildDir, atlas[0]), ...pack.map((p) => join(buildDir, p.page))];
}

/**
 * assemble -> rig -> check [-> loop], each stage's lines under its prefix,
 * stopping at the first stage that refuses. Returns where it stopped; the
 * caller turns that into the exit status. A crash that is not a refusal is
 * rethrown: it is not a stage's message and must not be printed as one.
 */
export function build(input: BuildInput, run: BuildRunners, log: Log): BuildResult {
  const stages: BuildStages = run.stages ?? { assemble: assembleStage, rig: rigStage, check: checkStage };
  const prefixed = (stage: BuildStage): Log => (line) => log(`[${stage}] ${line}`);
  const refused = (stage: BuildStage, err: unknown, check: CheckReport | null = null): BuildResult => {
    if (!(err instanceof PartsError)) throw err;
    const say = prefixed(stage);
    for (const p of err.problems) say(failLine(p));
    say(`refused: ${err.problems.length} problem(s)`);
    log(`build: stopped at ${stage}; no later stage ran`);
    return { stoppedAt: stage, check, artifact: [] };
  };
  const out = input.out;
  mkdirSync(out, { recursive: true });
  for (const p of BUILD_OWNS) rmSync(join(out, p), { recursive: true, force: true });
  // Optional source evidence is cleared separately; BUILD_OWNS is the legacy complete output tree.
  rmSync(join(out, CUT_MATERIAL_SOURCES), { force: true });
  // Issue #242: the figure mask is written only under config.scene; one left by an earlier scene build is not this build's.
  rmSync(join(out, FIGURE_MASK_FILE), { force: true });
  // The idle-keys value is named only when it is not the default, so a build without the flag, or with the default, prints the line it printed before issue #95.
  const idleKeys = input.idleKeys ?? DEFAULT_IDLE_KEYS;
  log(`rig-parts build: ${input.config} -> ${out}, seam rule ${input.seam}, projection rule ${input.project}, page edges ${input.pageEdges}, pack shape ${input.packShape ?? DEFAULT_PACK_SHAPE}${idleKeys === DEFAULT_IDLE_KEYS ? '' : `, idle keys ${idleKeys}`}${input.loop ? `, with the idle loop${input.leadIn === undefined ? '' : ` after a lead-in of ${input.leadIn} period(s)`}` : ''}`);

  let req: BuildRequirements | null = null;
  let configRecord: InputFileRecord | null = null;
  try {
    // build runs rig next, which needs the whole config, so the full loader is
    // asked first: a config rig would refuse is refused before assemble writes
    // anything, and under [assemble], as it was before the stage had its own
    // narrower door.
    // Issue #556: the flag, or the config's declaration when there is none; both naming other bytes is refused here.
    // Issue #607: the bytes this read parsed are the ones check.json's config record hashes, under the path as typed.
    const loaded = loadConfigWithBytes(input.config);
    configRecord = inputFileRecord(loaded.bytes, input.config);
    req = buildRequirements(input.requirements, loaded.config.requirements, input.config);
    // The same for the requirements file's own shape; its names resolve against the rig, in the check, before it builds.
    if (req !== null) readRequirements(req.read);
    // And the schedule (issue #538), by rigc's own reader, as check reads it.
    if (input.environment !== undefined) readCheckEnvironment(input.environment);
    // And the steady-wind band spec (issue #590), as check reads it.
    if (input.windBand !== undefined) readWindBand(input.windBand);
    stages.assemble(
      { source: input.source, full: input.full, head: input.head, config: input.config, seam: input.seam, project: input.project, ...(req === null ? {} : { requirements: req.read }), ...(input.alts === undefined ? {} : { alts: input.alts }) },
      { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, ERROR_MAP_FILE) },
      prefixed('assemble'),
    );
  } catch (err) {
    return refused('assemble', err);
  }

  try {
    stages.rig({ config: input.config, parts: out, out: join(out, 'rig'), idleKeys, pageEdges: input.pageEdges, packShape: input.packShape, command: 'build' }, run.rig, run.scratch, prefixed('rig'));
  } catch (err) {
    return refused('rig', err);
  }

  let report: CheckReport;
  try {
    report = stages.check({ rig: join(out, 'rig'), parts: out, out: join(out, 'check'), pageEdges: input.pageEdges, packShape: input.packShape, ...(req === null ? {} : { requirements: req.read, requirementsAs: req.recorded }), seamPairs: input.seamPairs === true, keepStills: input.keepStills === true, noExtremes: input.noExtremes === true, ...(input.set === undefined ? {} : { set: input.set }), allSets: input.allSets === true, ...(input.environment === undefined ? {} : { environment: input.environment }), ...(input.windBand === undefined ? {} : { windBand: input.windBand }), ...(configRecord === null ? {} : { config: configRecord }) }, run.check, run.checkBin, prefixed('check'));
  } catch (err) {
    return refused('check', err);
  }
  if (!report.figures.PASS) {
    log(`build: stopped at check; ${report.problems.length} bar(s) not met, so no loop was encoded and no artifact is reported`);
    return { stoppedAt: 'check', check: report, artifact: [] };
  }

  if (input.loop) {
    try {
      const say = prefixed('loop');
      const window = input.leadIn === undefined ? undefined : { periods: input.leadIn };
      if (window !== undefined) rmSync(run.scratch, { recursive: true, force: true });
      const frames = window === undefined ? join(out, 'check', 'idle_frames') : leadInFrames(join(out, 'rig'), run.scratch, window.periods, run.check, { pageEdges: input.pageEdges, packShape: input.packShape ?? DEFAULT_PACK_SHAPE });
      const physics = report.figures.loop_physics?.length ?? 0;
      const lossless = loopStage(frames, join(out, 'idle.png'), 'apng', say, window, physics);
      const indexed = loopStage(frames, join(out, 'idle-indexed.png'), 'indexed', say, window, physics);
      const gif = loopStage(frames, join(out, 'idle.gif'), 'gif', say, window, physics);
      if (window !== undefined) rmSync(run.scratch, { recursive: true, force: true });
      const fig = (e: PaletteError | null): string => (e === null ? 'lossless' : `max ${e.max}, mean ${e.mean.toFixed(3)}`);
      say(`loop: idle.png ${lossless.bytes} B (${fig(lossless.error)}); idle-indexed.png ${indexed.bytes} B (${fig(indexed.error)}); idle.gif ${gif.bytes} B (${fig(gif.error)}) — palette error per channel over all frames`);
    } catch (err) {
      return refused('loop', err, report);
    }
  }

  let artifact: string[];
  try {
    artifact = artifactPaths(join(out, 'check', 'build'), report.pack);
  } catch (err) {
    return refused('artifact', err, report);
  }
  log(`build: PASS — the packed atlas is the artifact; parts/ and rig/ are the intermediates it was made from`);
  for (const l of packLines(report)) log(`  ${l}`);
  for (const a of artifact) log(`  ${a}`);
  return { stoppedAt: null, check: report, artifact };
}
