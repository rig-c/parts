#!/usr/bin/env bun
/**
 * rig-parts — one painting and its See-through layers in, Spine-ready parts
 * and rig specs out, verified through rig-c.
 *
 * Every command prints named, numeric findings and nothing else an agent has
 * to interpret: a refusal is a `FAIL` line naming the rule, the object, the
 * value found and the value required. Exit codes are part of that interface:
 *
 *   0  the command did what it says
 *   1  it refused its input — every refusal is printed as a FAIL line
 *   2  a usage error, or a command this version does not implement
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { DEFAULT_PROJECT_RULE, DEFAULT_SEAM_RULE, HOLES_LISTED, PROJECT_RULES, type ProjectRule, proposeFields, proposePlan, proposeSinglePlan, SEAM_RULES, type SeamRule } from './src/assemble.ts';
import { type AlternateCliInput, assembleStage, build, checkStage, ERROR_MAP_FILE, loopStage, readRuns, readSource, rigStage, suppliedCheckFlag } from './src/build.ts';
import { ACCEPTABLE_BARS, DEFAULT_PACK_SHAPE, DEFAULT_PAGE_EDGES, findRigc, PACK_SHAPES, rigcRunnerAt, type PackShape, PAGE_EDGES, type PageEdges, PARTS_HOME_SENTENCE, RIGC_GEOMETRY_VERSION, rigcRanClause, type RigcRunner, NO_PARTS_SENTENCE, SEAM_MEAN_BAR, SOURCE_SENTENCE, SEAM_PX_BAR, SEAM_PX_LEVEL, SPINEBOY_YARDSTICK, TEXTURE_STRETCH_CEILING } from './src/check.ts';
import { ComfyClient, resolveHost, runPainting, runSeeThrough } from './src/comfy/index.ts';
import { type CharacterConfig, loadClothConfig, loadConfig, loadEarlyConfig, loadPaintConfig } from './src/config.ts';
import { configWriteLines, readConfigWriteTarget, separateConfigWriteTarget, stageConfigWrite, type StagedConfigWrite } from './tools/configwrite.ts';
import { failLine, guidePointer, PartsError } from './src/errors.ts';
import { GUIDE_DOC, type GuideAnswer, guideRule, guideSection } from './src/guide.ts';
import { proposeHeadBox } from './src/headbox.ts';
import { makeInputs } from './src/inputs.ts';
import { idleKeysOf, isIdleKeys } from './src/rig.ts';
import { depthSkipLine, exportLayers, figuresPhrase, hiddenLayerLine, implausibleRules, layerFigures, type LayerSet, layerSetDiff, pct, readLayers, readWrapperLayers, ruleSummary, templateLayerNames, templatePsdBytes, times } from './src/layers.ts';
import { checkImageSize, choosePerson, KEYPOINTS_SPEC, loadKeypoints, type RigJoints, toRigJoints } from './src/keypoints.ts';
import { basisLines, branchSqueezeLine, checkProposal, compare, compareLines, DEFAULT_GRID_RULE, draftTurn, drawLandmarks, FIGURE_GRID_DIVISOR, FRINGE_STEP_PX, GRID_RULES, type GridRule, HIP_MIN_FRACTION, type DraftLintFinding, lint, lintLine, type PartSet, PROPOSAL_CONFIG_SECTIONS, proposalAsConfig, proposeWithBasis, readPartSet, serializeProposal, withTurn, WRIST_ON_PART_PX } from './src/propose.ts';
import { BASIS_FILE, BASIS_SPEC, basisFile, basisLine, coverageLines, legChainChoice, serializeBasis } from './src/diagnostics.ts';
import { BEND_DEGREES, BEND_WORST_SHARE, DUST_MAX_PX, DUST_MAX_SHARE, IDLE_BOUND_PX, MESH_DRAFT_REPORT, MESH_DRAFT_SPEC, meshDraftStage, MORE_TRIANGLES_FLAG, relativeConfigPaths, TOLERANCE_FIGURE_DIVISOR } from './src/meshdraft.ts';
import { meshStatsStage } from './src/meshstats.ts';
import { chainsLeftBehind, clothConfigEdits, editPaths, plainCount, previousCount, writtenClothConfig } from './src/clothconfig.ts';
import { INPUT_CHECK_FILE, INPUT_CHECK_SPEC, PROVENANCE_FILE, REMESH_SPEC, remeshStage } from './src/remesh.ts';
import { RETUNE_FILE, RETUNE_SPEC, retuneStage } from './src/retune.ts';
import { checkPainting } from './src/paintcheck.ts';
import { readPng, writePng } from './src/raster/png.ts';
import { REQUIREMENTS_SENTENCE } from './src/requirements.ts';
import { composeStage, IMAGE_SEP, PLATE, PROVENANCES, SCENE_REPORT_FILE, SCENE_REPORT_SPEC, SCENE_SPEC } from './src/scene.ts';
import { buildSheet, defaultCaption, type Tile, tilesFrom } from './src/sheet.ts';
import { loadComparison, requiredProblems, structureLines } from './src/structure.ts';
import { authorLayerLine } from './src/tags.ts';

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;

function version(): string {
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, 'package.json'), 'utf8')) as { version?: string };
  return pkg.version ?? '(no version field)';
}

/**
 * The commands a later version will carry, registered now so the surface and
 * the help are honest about what exists. Each one exits 2 with the same
 * sentence, and the selftest holds every name here to that. Empty in this
 * version — every command is real — and kept so the next one has a place.
 */
const LATER: ReadonlyArray<[string, string]> = [];

const HELP = `rig-parts ${version()} — Spine-ready parts from one painting and its See-through layers

usage:
  rig-parts layers <dir | layers.json | file.psd>
      Read a See-through decomposition — the ComfyUI wrapper form (a directory
      holding layers.json and one PNG per layer) or an upstream .psd — and print
      every layer: draw order, name, tag group, box, size, opaque pixels, depth,
      and three plausibility figures over its opaque pixels — translucent share
      (alpha below 128), background share (min channel above 235) and area as a
      multiple of the rest of the figure (the other layers' union). A layer that
      crosses a plausibility rule gets a WARN line naming the rule and the bar;
      --propose-plan leaves it out. A layer named author:<label> is one the
      author made by hand: its group is author, and a line says it has no
      role. A layer named <layer>:hidden (issue #359) is that layer's art
      where something covers it: listed apart, never drawn, never a part. An
      input with no depth (a PSD, or depth_median null on every layer, whose
      manifest order is then the draw order) prints one SKIP depth line.
      Refuses, by name, a missing file, an unknown tag, a PNG whose
      size is not its box, and anything else outside the input contract —
      never a WARN.

  rig-parts layers --export <dir> <dir | layers.json | file.psd>
      Print the table, then write the input as the wrapper form into <dir>
      (absent or empty, LAYERS_EXPORT_DIR_EMPTY): layers.json and one RGBA PNG
      per layer, <index>_<name>.png, drawn layers in draw order then the
      hidden-art layers, depth_median as read (null for a PSD). The export is
      read back at once and must hold the same layers, boxes, pixels and order
      (LAYERS_EXPORT_ROUND_TRIP). Correct the parse there with any image
      library and hand <dir> to any command that reads layers
      (docs/AUTHORING.md, the correction loop).

  rig-parts layers --template <out.psd> --canvas <W>x<H>
      Write a PSD for an artist: one empty layer per tag name the rig reads,
      bottom first (back hair, the body, the face, front hair; the six split
      tags as their -r and -l halves; no head). The same canvas writes the
      same bytes. Read back, every layer is refused as empty
      (PSD_LAYER_HAS_PIXELS) until painted: paint the ones the figure has,
      delete the rest.

  rig-parts sheet --source <painting.png> --layers <path> [--layers <path> ...]
                    --out <sheet.png> [--cell <px>] [--cols <n>]
      A contact sheet: the painting, then every layer or part, each on a
      checkerboard and labelled with its name, size and opaque pixel count.
      --layers takes anything \`layers\` reads, or a parts.json (its PNGs are read
      from parts/ beside it). --cell defaults to 220, --cols to 8; both are
      printed. The same information is printed as text.

  rig-parts propose --parts <dir> --source <painting.png> --out <dir> [--compare <config.json>]
      Propose bones, meshes, regions and an idle from the assembled parts (<dir>
      holds parts.json and parts/). Roles come from each part's See-through tag,
      never its name; a part from an author:<label> layer has no role and
      rides the nearest trunk bone until the config names one. Writes <out>/proposal.json (config-shaped: bones, meshes,
      regions, motion with its blink — and a blink.still cut for a lash that
      reaches far above its eyewhite, when a clear row allows one; no blink
      when no part is an eyewhite, and no brows in it when no part is an
      eyebrow, each said in a note; an iris or lash on a side with no
      eyewhite rides head, said in a note — and notes)
      and the overlay to correct against, <out>/render/landmarks.png and
      landmarks_head.png. A figure with no face part gets a face box derived
      from the head run's hair and neck, said in the first note; with no
      head-run hair or neck it is refused (PROPOSE_FACE_PRESENT). Prints every
      note and a LINT line for each chain link that lies off its mesh's art, for a
      link of a fringe chain (hung from head on a head-run front hair mesh, its tip
      no lower than the chin) that drifts more than ${FRINGE_STEP_PX} px plus a pixel's
      rounding across the head's down axis (the eye line's perpendicular), for a
      hip that is not below the chest, for a hip above ${HIP_MIN_FRACTION} of the figure's
      height (the shoulders), and for two keyed chains on one lattice mesh whose
      own swing, every other bone held, takes an edge of the rig stage's lattice
      past check's TEXTURE_STRETCH bar (with each chain alone, the tips'
      distance, and each remedy's own figure: one sign for opposed amplitudes,
      dropping a chain; a contour or automatic mesh, or rule "heat", is said in
      a "squeeze not read" note); the fringe's three chains stand in the head's frame,
      rooted on the part's art, and a note says they are a template, not its
      locks; a headwear/earwear layer with hanging strands
      gets one pendulum chain per strand and a note with each strand's x, rows
      and width ("-- no chain proposed" is the one to act on; AUTHORING §3).
      --compare prints each shared bone's distance, proposal to config, in px.
      It reads bone origins only — not parents, tips, lengths, directions or
      names, so a changed parent or tip scores 0; rig-parts compare reads those.
      After the LINT lines, one "coverage" line per bone says which check read
      it ("checked, clean" or "checked, LINT") or that none did and why ("not
      checked": its role — a control binds nothing and may sit off the art —
      a single bone or an explicit [bone, from, to] segment, which the off-art
      check does not read, a region, a mesh naming no part), and a summary
      counts the three apart with the roles. Writes <out>/${BASIS_FILE} beside
      the proposal (spec "${BASIS_SPEC}"): per proposed bone, what its origin
      and its stated tip rest on — a joint (with its state and score as the
      file declared them), a measurement off a part, a ratio with its
      constants, or other bones — and under --compare whether the config's
      bone differs (origin, tip, parent; how far, in px). No confidence is
      computed. It prints "wrote ${BASIS_FILE} (…)" after the coverage lines.

  rig-parts propose … [--keypoints <keypoints.json> [--person <id>] [--wrist-snap <px>]]
      Read the figure's pose from one explicit file (spec "${KEYPOINTS_SPEC}"):
      its space (painting-px, origin top-left, y down — another is refused),
      the image's width and height (held to --source's, KEYPOINTS_IMAGE_SIZE),
      its source, and people, each an id and body-18 joints (r and l are the
      subject's sides), each observed with a position, occluded with an
      optional position (the producer's estimate) or missing; an unlisted
      joint is missing. More than one person needs --person (nothing picks
      one). Painting px reach rig px by the overlay's map, x * W/width,
      y * H/height. A joint with a position places its bone as given: neck,
      hip (the midpoint of r_hip and l_hip), the chest half way along neck ->
      hip, and each sleeve chain shoulder -> elbow with its tip at the wrist
      when every handwear part holds a wrist; a missing joint leaves its bone to
      the rule. One note per joint says which. Each arm and leg so placed is a
      limb (issue #349): proposal.json's "limbs" cuts its layer at the elbow or
      the knee into parts rigid on its links (and, when every ankle lies on a
      footwear part, a foot on a bone of its own at the ankle that keeps its
      setup angle); assemble with the block makes the cut. LINT then reads the torso along
      the neck -> hips line and each sleeve chain along shoulder -> wrist
      instead of by screen y, and prints the rule set it used first. Without
      --keypoints nothing changes. A wrist holds a part when it lies within
      ${WRIST_ON_PART_PX} px of its art (the larger of the x and y gaps); when a hanging
      arm's wrist lands off its arm layer (e.g. on a skirt below the hand), the
      sleeve chain's tip is placed at the bottom extent of the arm layer, the
      elbow cut comes from the limb chain, and a PROPOSE_WRIST_OFF_LAYER note
      names the layer it landed on (issue #491).
      --wrist-snap <px>, an integer above ${WRIST_ON_PART_PX}, binds a wrist on no
      part to the one nearest part within <px>, said in a "wrist snap:" note
      (with --keypoints, not with --from-config). Without it nothing changes.

  rig-parts propose … [--full <dir | layers.json>] [--head <dir | layers.json>]
      Draft the turn control (issue #251) into proposal.json's "turn": the
      See-through runs the parts came from, read for each part's layer
      depth_median (larger = further back). turn.depths holds every part's
      depth, turn.pivot their mean weighted by opaque_px — the depth at which
      the painted pixels' centroid stays put. The rig stage adds a bone "turn"
      under root that nothing keys; each part travels (pivot - depth) /
      (pivot - nearest depth) of its x, the nearest part all of it, a part
      behind the pivot the other way. A note states the pivot and every
      fraction with its depth; a painting patch has no depth, is not carried,
      and is named in a note. A part from a run not given, a tag the run lacks
      or a layer with no depth is refused by name. Without either flag nothing
      changes.

  rig-parts propose … [--grid-rule figure|part]
      How each drafted lattice's spacing (meshes.<part>.grid) is chosen.
      figure, the default: round(H / ${FIGURE_GRID_DIVISOR}) rig px for every lattice, H the
      height of every part's box together, and a part whose own spacing is
      already coarser keeps it; a note says which parts took it, that it was
      calibrated on three figures of similar size, and what it costs (the
      idle moved against the finer lattice, which no bar reads). part: the
      reference's rule, a tenth of the part's short side clamped to 5..36.
      r is the part rule's under both.

  rig-parts propose … [--cloth <config.json>]
      Draft cloth and hair as trees that answer the world (issue #364), from
      the config's "cloth" block — a recipe per tag, bottomwear, back hair
      and front hair (AUTHORING §3, *Recipe: cloth and hair*). Each tagged
      piece hangs "chains" trees of "links" links from its attachment bone
      (hip, or head), forked by "split", the links shortening toward the tip;
      proposal.json's "constraints" puts a physics constraint on every link,
      its strength by trunk, branch or edge, its wind and gravity response
      on a ramp from the declared root value to the tip value (multipliers
      of the consumer's environment — no direction is drafted), and drafts no
      idle key on them. A bottomwear recipe's "swing" drives each tree's
      first link from one shared pendulum. A recipe that drafts nothing is
      refused (PROPOSE_CLOTH_DRAFTED). A topwear part shaped like a skirt (a
      dress) is named in a note, never drafted on its shape; a bottomwear
      recipe's "part" declares it, and its trees hang from the hip over the
      part's art below it (PROPOSE_CLOTH_PART). A recipe's "influence"
      ({across, max, shape}, issue #518) drafts the parts it meshes in the
      influence mode at their lattice's cell, the radius as stated or drafted
      as the farthest lattice vertex from its nearest link plus 3 cells, and
      a LINT line names each drafted radius and both figures. A keyed bone
      the recipe leaves the only keyed child of its parent joins it in one
      chain CHAIN_LAG holds to non-decreasing amplitudes (issue #572): a LINT
      line names each link of such a chain below the link above, with both
      amplitudes and the least that passes; no amplitude is changed. Without
      --cloth nothing changes.

  rig-parts propose … --cloth <config.json> [--write-config <out.json> [--from <previous.json>]]
      Also write the --cloth config's own text with what the recipe drafts
      spliced in (issue #537), the way mesh-draft writes its config, so that
      rig --config <out.json> builds it. What is spliced is measured: the
      same parts drafted again without the recipe, and each config section
      that differs, entry by entry: meshes.<part> and regions.<part>, and
      bones, constraints and motion.tracks by each entry's name (issue
      #552) — an entry the recipe drafts replaced or inserted, one it
      replaces removed, and every other entry, a hand-added one among
      them, kept in its place; a section the input lacks is inserted;
      every other byte as read. The text is written as stated, so a
      relative path in it resolves against <out.json>'s directory (a note
      names each when that is not the input's). Only with --cloth and not
      with --from-config (usage errors); refused, before anything is
      written, when <out.json> exists or is a file this run writes
      (PROPOSE_WRITE_CONFIG_FRESH), when an entry the recipe re-drafts or
      removes was changed by hand, naming the entry and the field
      (PROPOSE_WRITE_CONFIG_CONFLICT), or when the spliced text does not
      parse to the config with the sections set, naming the first key
      that moved (PROPOSE_WRITE_CONFIG_SPLICE).
      --from <previous.json> (issue #571, only with --write-config) names
      the config the recipe is changed from: its cloth block is read as
      --cloth's is, the same parts are drafted a third time with it, and an
      entry equal to that previous recipe's draft is the recipe's, replaced
      (or removed) as one equal to the draft without the recipe is; an entry
      equal to none of the three drafts is still refused by name, its field
      read against the previous recipe's draft. An entry the previous recipe
      drafted that the recipe now leaves plain (a tag whose recipe was
      dropped) goes back to the draft without the recipe (issue #630). The
      write line counts the entries the previous draft vouched for and the
      entries returned to the plain draft. Without --from nothing changes.

  rig-parts propose --parts <dir> --source <painting.png> --out <dir> --from-config <config.json>
      Draw the config's CURRENT bones instead (<out>/render/landmarks_config.png
      and _head) and LINT them (by the joints too, given --keypoints), with the
      coverage lines after them; no ${BASIS_FILE}, as nothing is proposed.
      Exits 1 when any LINT line is printed.

  rig-parts propose … --write-config <config.json>
      Without --cloth, update an existing config with the whole proposal's
      present config sections, including proposed_rig_scale; notes stay in the
      proposal. Absent optional sections and all other fields are kept. The
      full config loader validates a same-directory candidate before atomic
      replacement; relative paths resolve beside the config. An equal update
      keeps the original bytes and mtime. A changed source, an artifact alias
      or a failed write is refused by name. Change lines go to stderr.

  rig-parts propose --head-box --full <dir | layers.json | file.psd> --canvas <W>x<H> [--no-back-hair]
                         [--write-config <config.json>]
      Propose seethrough.head_box (source px, square) from the full run's
      layers for a painting of WxH px (portrait or landscape: the full run is
      mapped back through the pad inputs added), held inside the painting; a
      shift is printed when one was needed. When "back hair" contributes, prints
      the box without it and how much of the side and area it took;
      --no-back-hair leaves "back hair" out of the box. --write-config updates
      only seethrough.head_box in an existing config through the layers loader.

  rig-parts compare --left <file> --right <file> [--map <bonemap.json>]
      Compare two skeletons bone by bone. Each file is a config, a proposal.json
      or a rig.json (rigc-rig/1), told apart by what it states: "spec" (read by
      rig-c's own reader), "key" (the config loader) or "bones". No parts and
      no painting are read. Both sides are brought to one form — rig px, y down;
      a rig.json through its stage (skeleton x, y, width, height), the y flip
      through rig-c's — and each pair prints its origin distance, its
      parent (the same through the pairing; the right's or the left's ancestor
      at depth k, with the bones between that are in no pair; DIFFERENT, naming
      both; or NOT MAPPED), its tip distance, both lengths and their
      difference, and the turn of its direction in degrees (clockwise as
      drawn). A bone of length 0 has no tip: those three say SKIP with the
      reason, never 0. A rig with no stage, or two configs at different
      rig_scale, are not in one frame: origin, tip, the length difference and
      direction say SKIP "frames not related", and parents, required bones and
      roles still run. Then the unmapped bones of each side by name, the
      required bones, and each side's roles read off the spec — target (an ik
      target, a transform source), deforms (a mesh weight or segment, a region),
      control (binds nothing; keyed, or parents others), unclassified (said why)
      — with the control and target counts, reported and never failed.
      With no --map a bone pairs only with the bone of the same name; nothing
      pairs by resemblance. --map is {"spec": "spine-parts-bonemap/1"} with
      optional "pairs" ([[left, right], ...]: the whole pairing), "required"
      (left names that must be present on both sides) and "frame" ({"scale",
      "offset": [x, y]}: right = scale * left + offset, numbers the author
      wrote — nothing is fitted). Exit 1 names each required bone missing
      (STRUCTURE_REQUIRED_PRESENT) or each refusal of a file; every other row is
      a figure and exits 0.

  rig-parts rig --config <config.json> --parts <dir> --out <dir> [--idle-keys ctl|direct]
                  [--page-edges pot|free] [--pack-shape rect|polygon]
      Author the rig: bones at the config's landmarks (a chain makes
      <chain>0..n, each link turned along its chain with its length, so a
      physics constraint added later has a lever; every offset under a turned
      link is in its frame, so nothing moves; a translate key under a turned
      link or a scale/shear key on one is refused, RIG_KEY_FRAME_UNTURNED),
      a square lattice mesh over every part in config.meshes (a contour
      mesh where the entry says contour, with its regions' bones weighted
      by their declared falloff, AUTHORING §3)
      weighted by distance to its candidate bone segments, a region for every
      part in config.regions (a motion.blink.still part as two: the rows above
      its row on a second slot <part>_still, which the blink does not move),
      and one idle of sines and a blink whose closed hold is at least one
      12 fps frame, so the idle frames and the loop show the eyes shut
      (RIG_BLINK_HOLD_SPANS_A_FRAME otherwise); no blink when the config
      states no motion.blink, and a blink group that names no bone, or one
      bone twice, is refused by the loader, CONFIG_BLINK_GROUP_MEMBERS or
      CONFIG_BLINK_GROUP_UNIQUE, before rigc starts, as are two tracks on one
      bone property, CONFIG_BONE_PROPERTY_KEYED_ONCE. Beside the idle,
      every animation of the file config.motion.animations_from names is
      written into motion.json as read, for rigc's gate to judge (AUTHORING
      §3). --parts is the
      directory holding parts.json and parts/<name>.png. The result is built
      through rig-c (profile rig-play, packed with --page-edges and
      --pack-shape as for check; rigc's build gates the compile and the packed pages on disk) in a
      scratch directory first, and --out receives images/*.png, rig.json,
      motion.json and mesh_report.json only when it is green. Prints one line
      per mesh and the rigc gate lines.
      --idle-keys says where the idle's keys on a bone a mesh is weighted to go:
      ctl (the default) keys a same-origin <bone>_ctl parent instead, which
      passes A15_IDLE_NO_MESH_BONE_KEYS on any rig-c; direct keys the bone
      itself and declares invariants.idleDrivesMeshes in rig.json, which needs
      rig-c 1.3.0 or later and makes A15 a SKIP that prints its cost (the
      stage prints that SKIP line). The pose is the same to one level of float
      rounding, and so is the per-frame mesh work (AUTHORING §5).
  rig-parts mesh-draft --config <config.json> --parts <dir> --out <dir> [--requirements <file.json>]
                  [--idle-keys ctl|direct] [--page-edges pot|free] [--pack-shape rect|polygon]
                  [--more-triangles]
      Draft a traced outline around a coarse grid for every lattice mesh the
      config states, and keep it only where it holds against that part's
      lattice (issue #265). The config is read, never written: --out receives
      config.json — the input's own text with each drafted part's meshes entry
      replaced, every other byte as read — and ${MESH_DRAFT_REPORT} (spec
      "${MESH_DRAFT_SPEC}": the rules, both checks' bars, and per part its
      lattice and candidate triangles and overdraw, the five readings, each
      with its margin to its line, and the note). H is the height of the union of the parts' boxes; the candidate is
      contour {tolerance T, margin T, spacing S, maxEdge S, stray} with
      T = max(1, round(H / ${TOLERANCE_FIGURE_DIVISOR})) and S = round(H / ${FIGURE_GRID_DIVISOR}) (a figure whose S is 0 is
      refused, MESH_DRAFT_FIGURE), stray the largest dust island (at most
      ${DUST_MAX_PX} px and ${DUST_MAX_SHARE * 100} % of the part's art); a part with any other extra island
      keeps its lattice. The config as written must build and check PASS first
      (MESH_DRAFT_LATTICE_GREEN). Then each candidate is held to its lattice:
      every check bar that reads the part passes on the drafted rig; within
      ${IDLE_BOUND_PX} rig px of the lattice over the idle; at the bend set (every chain
      link the part's segments name turned ${BEND_DEGREES} degrees, both ways) no more
      inverted triangles than the lattice and the worst sample within
      ${BEND_WORST_SHARE * 100} % of the lattice's, both against a denser lattice of the same
      part; and no more triangles than the lattice — every motion reading
      rig-c's (check, and compareMeshesInMotion over three unpacked gate
      builds). The lattice is the config's own grid entry: for a proposed
      config, the figure's spacing propose drafts. The gate is a judgment
      relative to that lattice, not an absolute quality: when the lattice
      coarsens, the reference moves with it. --more-triangles drafts a
      candidate that holds the four motion readings even with more triangles
      than its lattice, and the report records each part's triangle and
      overdraw difference. A part that passes is drafted, its note saying
      what it was measured against; one that fails keeps its entry, and the
      report names each failed reading and by how much. An auto or contour
      entry is neither drafted nor compared with anything: a NOT COMPARED line
      and the report's not_compared name each, so build it once on a lattice
      and compare the rig stage's mesh lines (AUTHORING §3, issue #307).
      Written only when the drafted config's check is PASS. --requirements, --idle-keys,
      --page-edges and --pack-shape are as for rig and check.

  rig-parts mesh-stats --config <config.json> --parts <dir>
      Print the vertices and triangles of every mesh the config states, as the
      rig stage would make them from the parts in --parts (the directory
      holding parts.json and parts/<name>.png), and their total, in seconds:
      the rig stage's own mesh construction, without rigc, without assemble
      and without check (issue #566). One line per mesh in parts.json's order,
      "mesh-stats: <part> — <mode> <V> vertices, <T> triangles" (mode lattice,
      contour, auto or influence), then "mesh-stats: total <N> triangles over
      <M> mesh(es)"; the counts are the ones the rig stage writes to
      mesh_report.json, except an auto part's when rigc's motion gate refuses
      its reduction and the rig stage replays an earlier accepted step, which
      the auto line says. A problem the rig stage refuses (a missing part PNG,
      an outline that does not close, a bone no config entry declares) is the
      rig stage's own refusal, exit 1. Writes nothing.

  rig-parts remesh --rig <dir> --config <config.json> --parts <dir> --part <name>
                   --mesh <entry.json> --out <dir> [--requirements <file.json>]
                   (or --delta <mesh-edit.json> in place of --mesh)
                   [--idle-keys ctl|direct] [--page-edges pot|free] [--pack-shape rect|polygon]
                   [--record-input-check] [--input-check <input-check.json>]
      Re-fit one part's mesh of a gated rig (the directory rig writes) under
      the mesh entry --mesh holds — what config.json would hold at
      meshes.<name>: a grid, a contour or an auto entry, its bounds the
      entry's own — and write a new revision into --out, which must not
      exist (REMESH_OUT_FRESH); the input is never written. --config and
      --parts are what the input was built from: the config as written must
      reproduce the input's part (its attachment, image and mesh_report.json
      row) and its bones, and for an auto entry its motion
      (REMESH_BASELINE_MISMATCH); every other part is carried over as bytes,
      whether or not the config reproduces it. The part must be a mesh nothing
      else is bound to — no linked mesh, no deform timeline
      (REMESH_TARGET_MESH, REMESH_TARGET_CLOSED). The entry is built through
      the rig stage, its mode's own checks and an auto entry's motion gate
      (REMESH_CANDIDATE_REFUSED, quoting each), and may not move a bone, a
      motion key or the part's image (REMESH_REQUEST_HELD). Every file but
      rig.json and mesh_report.json is the input's bytes, rig.json is the
      input's outside the part's attachment, and every other report row is
      the input's (REMESH_PRESERVED); rigc's build gate passes over the
      revision (REMESH_RIGC_GREEN); check measures every bar on it that it
      measures on the input and fails none the input meets
      (REMESH_CHECK_HELD). --out receives the revision and ${PROVENANCE_FILE}
      (spec "${REMESH_SPEC}": the request, both versions, every input file's
      SHA-256, the part's counts before and after, both checks and their
      scope) — no path and no clock, so the same request writes the same bytes.
      Prints the part's counts and a hash table of every file.
      --delta, in place of --mesh (exactly one of the two): rig-c/review's
      mesh edit (rig-review-mesh-edit/1, basis "setup", at most 300 ops of
      move, add, remove, edge and unedge, crop px of the rig canvas), whose
      source counts and source.hash must be the input part's
      (REMESH_DELTA_SOURCE). The ops are replayed in order over the input's
      own mesh — moved vertices rebound, added ones weighted from their
      edge's or triangle's corners, removed ones' rings re-triangulated,
      Delaunay restored by flips that keep the hull and every constraint —
      and the result is held to the outline rules (REMESH_DELTA_JSON,
      REMESH_DELTA_BASIS, REMESH_DELTA_OPS, REMESH_DELTA_OP naming ops[i],
      REMESH_DELTA_TOPOLOGY). No config entry is built: the baseline is the
      input itself; the splice, the gate and check are as for --mesh.
      --record-input-check writes ${INPUT_CHECK_FILE} into --out beside
      ${PROVENANCE_FILE} (spec "${INPUT_CHECK_SPEC}": both versions — rigc's
      whole --version output — the pack mode, the requirements file's path and
      SHA-256, the rig and parts directories as resolved with every file's
      SHA-256 — every file under --rig, parts.json and every file under
      parts/ — and the input's check side as ${PROVENANCE_FILE} carries it).
      --input-check <input-check.json> reuses that check instead of running
      check on the input again (a line says so, with the number of SHA-256
      rows that bound it), and the provenance's check.input is the recorded
      one, byte for byte. Every row must be this run's: a file added, missing
      or of other bytes, another directory, requirements file, pack mode,
      rig-parts or rigc is refused by name with the row, the value recorded
      and the value required (REMESH_INPUT_CHECK_BOUND); a file that is not
      the record is REMESH_INPUT_CHECK_FILE. Both are read before anything is
      built, and nothing is written. The record's rows are hashed again
      right after check-input has read the input; a file that moved in
      between is refused with both digests (REMESH_INPUT_CHECK_MOVED), and no
      record or revision is written. Without either flag nothing written
      moves.

  rig-parts retune --rig <dir> --config <config.json> --parts <dir> --out <dir>
                   [--requirements <file.json>] [--idle-keys ctl|direct]
                   [--page-edges pot|free] [--pack-shape rect|polygon]
                   [--record-input-check] [--input-check <input-check.json>]
      Splice the constraints and the idle a config states onto a gated rig
      (the directory rig writes) and write a new revision into --out, which
      must not exist (RETUNE_OUT_FRESH); the input is never written. The
      config is built once through the rig stage (RETUNE_CONFIG_REFUSED,
      quoting each problem), and that build must state the input's stops,
      bones, slots, skeleton, images, every invariant but detached and every
      byte of motion.json but animations.idle (RETUNE_REQUEST_HELD): a moved
      bone, a redrawn image, a stops change or an animations_from change is
      no retune. No attachment is compared — the input's meshes are carried
      over as bytes, repairs included, and a meshes change in the config is
      never read (remesh is a mesh's producer). rig.json takes the build's
      constraints and invariants.detached, motion.json its animations.idle,
      every other byte is the input's (RETUNE_PRESERVED); rigc's build gate
      passes over the revision (RETUNE_RIGC_GREEN); check measures every bar
      on it that it measures on the input and fails none the input meets
      (RETUNE_CHECK_HELD). --out receives the revision and ${RETUNE_FILE}
      (spec "${RETUNE_SPEC}": the request, both versions, every input file's
      SHA-256, what was held, which constraint fields and idle tracks changed,
      both checks and their scope) — no path and no clock, so the same request
      writes the same bytes. Prints what changed and a hash table of every file.
      --record-input-check and --input-check are remesh's (one record format,
      one binding; a record either command wrote serves the other over the
      same input), refused as RETUNE_INPUT_CHECK_BOUND,
      RETUNE_INPUT_CHECK_FILE and RETUNE_INPUT_CHECK_MOVED.

  rig-parts check --rig <dir> --out <dir> [--parts <dir>] [--source <painting.png>]
                    [--page-edges pot|free] [--pack-shape rect|polygon]
                    [--requirements <file.json>] [--seam-pairs] [--keep-stills]
                    [--set <name> | --all-sets] [--environment <schedule.json>]
      Build, gate, render and measure a rig through rig-c's CLI (the rigc at
      node_modules/.bin/rigc, or on PATH). --rig holds rig.json and motion.json:
      a rig spec, which rigc build compiles, not a compiled skeleton.json.
      motion.json is required (rigc build takes --motion; "animations": {}
      builds); an "idle" in it is not.
      ${PARTS_HOME_SENTENCE}; ${NO_PARTS_SENTENCE}.
      Both are only read. Into --out:
      build/ (rigc build --profile rig-play --pack --page-edges <value>
      --pack-shape <value>: the packed atlas is the artifact), gate_spine-html.txt (the gate lines
      verbatim), idle_frames/ (rigc render --animation idle --fps 12 --max 640
      --geometry: the frames and geometry.json, the skinned vertices and
      every bone's world transform per frame),
      contact.png, motion_heat.png and check.json (with rigc_entry, the rigc
      entry that gated the build, and pack_mode, the two pack flags). PASS needs every gate summary
      "0 failed", the seam (setup pose vs the flat composite of parts/) at mean
      |d| <= ${SEAM_MEAN_BAR.toFixed(1)} with <= ${SEAM_PX_BAR} rig px over ${SEAM_PX_LEVEL} (the frame pixels over ${SEAM_PX_LEVEL}
      divided by s², s the frame scale the seam: line prints and check.json's
      seam_frame_scale holds, so the bar means the same at every scale), and
      the loop (idle frame 0 vs the frame at t = duration) at max |d| 0. A
      failing seam, or any seam under --seam-pairs, is split by the pair of
      parts each counted pixel lies between: one "seam pair" line each, worst
      first, with its count in frame px, frame and rig boxes and a picture
      under seam/, and check.json's seam_pairs (AUTHORING §7). A seam picture
      is the setup-pose frame with that pair's counted pixels painted magenta
      (255, 0, 255) — magenta = a counted pixel — and a cyan (0, 255, 255)
      box one pixel outside them. --keep-stills leaves the setup-pose still the seam reads,
      rigc's render directory with its frames.json (viewport and background),
      under setup_still/. Then six judgement lines, each in
      check.json and on the console as NAME: PASS|FAIL|SKIP with its figures and
      bars (AUTHORING §7): BREATH_VISIBLE (the topwear moves, the footwear does
      not, each rendered alone), BLINK_NO_HOLE (the setup pose with the blink
      held shut shows no background inside the eyewhite box), CHAIN_LAG (every
      rotate track lags its keyed ancestor and amplitude grows down each
      chain, read off motion.json), TIP_OVER_ROOT (each handwear/bottomwear
      part's lower half travels further than its upper half, measured from
      the idle's posed geometry, so the render size does not move it),
      STILL_REGIONS_DARK (the face and the parts over it the head bone alone
      carries keep their place relative to that bone, and the feet theirs on
      the screen, from the idle's posed geometry up to the arithmetic's own
      rounding; how deep any other slot's art swings into the face is
      reported, with no bar) and
      TEXTURE_STRETCH (every mesh triangle's edges over the idle against their
      rest length, max(ratio, 1/ratio) <= ${TEXTURE_STRETCH_CEILING}; the worst
      triangle is named by slot, triangle, vertices, edge and frame).
      Needs rig-c ${RIGC_GEOMETRY_VERSION} or later, whose render writes
      geometry.json; an older rigc is refused, CHECK_RIGC_VERSION, before
      anything is built.
      Regions come from parts.json's See-through tags; a line with nothing to
      read says SKIP and why — neither a pass nor a failure — and PASS needs
      every line that measured to be PASS. Then RECOMPOSITE_HOLES: REPORTED,
      read from parts.json's recomposite block (uncovered error px, hole count,
      the largest hole's box and the parts bordering it) — a line with no bar,
      never a FAIL, because a pixel no part holds is missing from both sides of
      the seam; SKIP when parts.json has no such block. What a bar cannot
      read it says SKIP for, by name, with the reason (AUTHORING §7, Measuring a
      rig rig-parts did not assemble): without parts.json the seam,
      BREATH_VISIBLE, BLINK_NO_HOLE, TIP_OVER_ROOT, STILL_REGIONS_DARK and
      RECOMPOSITE_HOLES; without an idle the loop and every line that reads idle
      frames, and no idle is rendered. The gate always runs. When motion.json
      holds an animation, ANIMATIONS_DO_NOT_FOLD reads each, the idle included,
      with rigc render --folds, physics constraints left out: a mesh triangle turned
      over against the setup pose fails, unless the --requirements file's
      may_fold declares that slot and animation with a why. Where a footwear
      part rides a bone that hangs from another, FEET_STAY_LEVEL reads the
      same render's geometry: while a bone above that bone is turned, the
      part's drawing must stay within ±10 degrees of its setup pose (HQ's
      line); config.bones' "inherit" on the foot is what keeps it there. The
      last line says how many of the bars measured — nine, ten with the fold
      bar, eleven with the feet-level bar — and names the skipped ones.
      --source adds SETUP_POSE_VS_SOURCE: REPORTED, never a FAIL — the setup
      pose against the painting by assemble's own recomposite figures (mean |d|,
      % within 8, error px over 40, uncovered error px where the pose has alpha
      128 or less, holes). ${SOURCE_SENTENCE}; a painting that is not this
      rig's is refused, CHECK_SOURCE_SIZE, before anything is built. Prints the pack line
      beside the spineboy yardstick (${SPINEBOY_YARDSTICK}), a reference and not
      a bar. Exit 0 on PASS, 1 on FAIL — every FAIL line names the bar, the value
      and the value required.
      --page-edges is handed to rigc verbatim and defaults to ${DEFAULT_PAGE_EDGES}: the
      least-area page the parts need (on the two public examples, rect, 967x1338
      and 479x1166, where pot writes 1024x2048 and 512x2048), at the cost rigc
      states — region attachments sample within 1 LSB of the loose build
      rather than exactly (measured on both examples: every idle frame within
      1 level of the pot build's; AUTHORING §5, Page edges). pot is a power of two on both edges, for a consumer
      that mipmaps or repeats the page (the atlas declares filter Linear,
      Linear and no repeat). rigc's pack line carries ", page edges free" under
      free; a line that disagrees with the value passed, or a pot page that is
      not a power of two, is refused, CHECK_PACK_PAGE_EDGES.
      --pack-shape is handed to rigc verbatim and defaults to ${DEFAULT_PACK_SHAPE}:
      a region only meshes draw is packed by its emitted hull, so a neighbour
      may sit inside its rectangle where the hull is not (on the two public
      examples, under free, 922x1348 and 477x1151 where rect writes 967x1338
      and 479x1166), at the cost of the same 1-level class as free (measured
      on both examples: every idle frame within 1 level of the rect build's;
      AUTHORING §5, Pack shape). rect keeps every region's cell apart and
      writes the page earlier releases wrote. rigc's pack line ends
      ", shape rect" or ", shape polygon"; a line that disagrees with the
      value passed is refused, CHECK_PACK_SHAPE.
      ${REQUIREMENTS_SENTENCE} (AUTHORING §7, Declared requirements). It is
      read and every name in it resolved against rig.json and motion.json
      before anything is built: a bone, constraint, slot, mesh attachment or
      animation that does not resolve, a missing field or bar, or a follow
      naming a property its constraint does not drive is refused by name
      (REQUIREMENTS_*). Each named animation is rendered once with --geometry
      into requirements/as-declared/<animation>/; scene targets (a bone whose
      parent is the root, placed at a stage point or at stage points at stated
      times) are written onto a throwaway copy, never the rig. Each follow is
      measured from three poses of the same frames — as declared, released
      (that mix forced to 0, its keys removed) and full (forced to 1) — into
      requirements/released/<name>/ and requirements/full/<name>/. One line per
      requirement, NAME: PASS|FAIL|NOT MEASURABLE with its figures, the bar as
      declared and the worst frame, a requirements block in check.json, and a
      summary line naming the kinds not declared. A FAIL is
      CHECK_REQUIREMENT_MET; a NOT MEASURABLE (a tip or an axis on a bone of
      length 0, an aim whose target sits on the origin on every frame, a
      follow no frame of which reaches its least drive) is
      CHECK_REQUIREMENT_MEASURABLE, and the run is not PASS. Without the flag
      nothing is read, written or printed for it.
      --environment <schedule.json> takes the readings in the world a person
      watched: a rigc-environment/1 schedule ({ "spec": "rigc-environment/1",
      "steps": [{ "t": <seconds>, "wind"?: [x, y], "gravity"?: [x, y] }, ...] },
      x right, y down — what rigc render --environment reads, and what the
      review editor exports). It is read once, by rig-c's own reader, before
      anything is built; a malformed one, or a path with nothing at it, is
      refused, CHECK_ENVIRONMENT, rigc's sentence verbatim, and --out is not
      written. Every render a bar or a warning reads with the physics on is
      posed under it — the idle (TIP_OVER_ROOT, STILL_REGIONS_DARK,
      TEXTURE_STRETCH, CLOTH_SETTLES), the physics-on half of
      ANIMATIONS_DO_NOT_FOLD, the parts BREATH_VISIBLE renders alone,
      SEAM_OVER_MOTION and the --requirements renders; the physics-off renders
      (the loop's, the fold bar's other half, STRESS_OFF_CHAIN,
      SEAM_OVER_RANGE), the setup-pose stills and build's loop take none. What
      rigc render refuses of the schedule on this rig (no physics constraint,
      a half no constraint answers, a step after the last frame) is
      CHECK_ENVIRONMENT with rigc's line. The world before the first step is
      the runtime's, wind [1, 0] and gravity [0, 1]: a schedule stating that
      reads what a run without the flag reads, and wind [0, 0] is a calm, not
      the default (AUTHORING §6, The world the readings are taken in). One
      environment: line names the path, the step count and the sha256's first
      16 hex; check.json's environment holds path (as given), sha256 and
      steps. Without the flag no environment provenance key is written.
      Physics rigs with readable declared seam pairs also report independent
      default wind [1, 0] and still wind [0, 0], gravity [0, 1], under
      SEAM_OVER_MOTION.worlds: gap/ghost maximum and worst frame only;
      dir points to retained raw seam renders relative to check.json. No
      new bar or warning, and the custom reading is unchanged. No wind
      response or no band is SKIP; no pair or animation gives no worlds.
      Nonphysics output is unchanged. In rig-play environment(null) returns
      to the default world, not still air (AUTHORING, Physics seam environments).

  rig-parts loop --frames <dir> --out <file.png | file.gif> [--palette]
      Encode a frame set rigc render wrote (its --out directory, or the set
      directory inside it) as a looping animation: .png writes an APNG
      (acTL/fcTL/fdAT, lossless — the exactness record), .png with --palette an
      indexed APNG (colour type 3, one palette for every frame: 255 median-cut
      colours plus one transparent entry, alpha graded per entry, no dithering,
      filter None — the README-sized file), .gif a GIF89a (the same 255-colour
      median cut, no dithering, LZW, delays rounded so the loop's length is
      exact). The indexed APNG and the GIF print their palette error, per
      channel over every frame. The fps is read from frames.json. When the last
      frame equals frame 0 it is dropped, and the output says so: the loop wraps
      onto frame 0 itself. Animated WebP is not written — it needs a VP8/VP8L
      encoder, out of scope.

  rig-parts assemble --source <painting.png> --full <dir|psd> [--head <dir|psd>]
                       --config <config.json> --out <dir> [--seam near-white|silhouette]
                       [--project core|visible] [--alt <name>=<source>:<full>[:<head>]]
      Merge the full-body and head-crop See-through runs into rig-space parts:
      <out>/rig/parts/<name>.png (each cropped to its alpha box), <out>/rig/parts.json,
      <out>/render/recomposite_rig.png and <out>/render/${ERROR_MAP_FILE} (the error
      map: uncovered error px red, covered error px blue, the rest the painting in
      light grey). Reads config.seethrough.head_box and
      .resolution and config.assemble.rig_scale, .plan, .extend_below_crop,
      .patches — extra parts cut from the painting itself over a rig-pixel box
      (alpha "silhouette": the painting's figure inside it; "box": all of it),
      drawn "back", "front" or {"before": <plan part>}, recorded in parts.json
      as from "painting:<name>" and counted 100 % source — and .cuts — a plan
      part's pixels inside a rig-pixel polygon taken into a new part, drawn the
      same way, recorded with the plan part's from — and .limbs (issue #349),
      with the bones they name: each limb's layer cut at its joints into one
      part per segment, each lower part carrying a cap past its joint, the
      upper drawn over the lower — and no other rig section:
      bones, meshes, regions and motion need not exist yet, because propose
      drafts them from these parts (AUTHORING §4, the table).
      Prints one line per part, one \`cut:\` line per part a cut split (its
      opaque pixels = what it kept + what each cut took), one \`limb cut:\`
      line per part a limb took and one \`limb cap:\` line per joint (the cap's
      pixels from the layer and missing, and the box to paint them into), the seam override
      counts, the \`pixels:\` totals
      (opaque = visible + occluded; taken from the painting; visible but not
      projected), and \`recomposite vs source\` (mean |d| and % within 8 over the
      mean channel; error px: max channel > 40; uncovered: of those, where no
      part has alpha above 128), then the uncovered holes (8-connected) and the
      largest ${HOLES_LISTED}, each \`uncovered hole N: <px> px at x,y wxh (between
      "<part>" <px> px, …)\` — the list parts.json holds under recomposite —
      and one \`uncovered:\` line per full-run layer the plan does not take from
      the full run whose uncovered error holds a body (5x5-opened, 8-connected,
      at least 150 full-run px in rig px), naming the layer, its pixels and the
      rule that left it out. One \`hidden art:\` line per hidden-art layer
      (<layer>:hidden, issue #359) names what read it: the under of a cut of
      its layer's part, or the cap of a limb segment below a joint that takes
      that part, when neither names a file (both: ASSEMBLE_HIDDEN_ONE_SOURCE).
      With no --head, the full run is the one run (an artist's own file): it
      must hold face, eyewhite-r and eyewhite-l, painted
      (ASSEMBLE_SINGLE_RUN_FACE), every plan row takes "full" and none
      extends below a crop (ASSEMBLE_SINGLE_RUN_PLAN), and the config sets no
      seethrough.head_box (ASSEMBLE_SINGLE_RUN_HEAD_BOX).
      Writes nothing unless every check passed.
      --seam defaults to ${DEFAULT_SEAM_RULE}. --project says where a layer takes
      the painting's pixel: core (the reference's) erodes every layer's top-most
      opaque area by 5x5 first, so a part a few pixels wide takes none; visible
      erodes only along a rim where a later layer is in front. It defaults to
      ${DEFAULT_PROJECT_RULE}.

  rig-parts assemble --propose-plan --source <painting.png> --full <dir|psd>
                       [--head <dir|psd>] --config <config.json> [--write-config <config.json>]
      Print {plan, extend_below_crop, notes} for config.assemble, from the two
      runs. A layer \`layers\` WARNs about (PLAN_LAYER_TRANSLUCENT,
      PLAN_LAYER_BACKGROUND, PLAN_LAYER_OVERSIZED) is not proposed, and a note
      names it, its figures and the rule. A full-run layer holding a body no
      planned part covers (a lock the head run's part does not reach and
      extend_below_crop cannot continue) is named in a note with the body, the
      rule that skipped it and the continuation; the plan itself is not
      changed. Reads only config.seethrough.head_box,
      config.seethrough.resolution and config.assemble.rig_scale — the rest of
      the config need not exist yet. With no --head, the one run is held as
      assemble holds it and every row is written from it, and the first note
      says so. --write-config must name --config itself; it updates the whole
      assemble.plan and assemble.extend_below_crop through the assemble loader.

  rig-parts inputs --source <painting.png> --config <config.json> --out <dir>
      Cut the two images See-through is fed: <out>/st_input_full.png (the
      painting centred on a white square of its longer side: white left and
      right of a portrait painting, above and below a landscape one) and, when
      the config sets seethrough.head_box, <out>/st_input_head.png (that box,
      cropped at its exact size). Refuses a translucent painting and a head box
      outside the painting, by name.

  rig-parts comfy seethrough --image <png> --out <dir> [--host <url>]
                    [--resolution 1024] [--steps 30] [--seed 42] [--offload] [--lama] [--nf4]
                    [--prefix spine_parts] [--wait 1800] [--timeout 3600] [--poll 3]
      Optional. Run See-through on a ComfyUI box with the jtydhr88/ComfyUI-See-through
      wrapper installed, and write the wrapper form \`layers\` reads into <out>
      (absent or empty): layers.json, parts/<tag>.png, meta.json, previews/.
      The host is --host or COMFY_HOST and has no default. Checks every node and
      input against the box's /object_info before uploading, waits for an empty
      queue (at most --wait s), polls /history (at most --timeout s), and
      writes <out> only after the layer reader accepts what came back.
      --lama turns the wrapper's LaMa inpainting on and --nf4 its nf4
      quantisation; both are off unless given, as --offload is.

  rig-parts comfy paint --config <config.json> --out <dir> [--host <url>]
                    [--seeds 1] [--seed0 <generation.seed>] [--wait 1800] [--timeout 3600] [--poll 3]
      Optional. Generate the painting from the config's inline generation block:
      <out>/painting_<seed>.png and painting_<seed>_meta.json (the prompts
      verbatim, checkpoint, LoRAs, sampler, control, elapsed) for --seeds
      seeds from --seed0, and control_<skeleton>.png when generation.control
      is set. The pose words are generation.pose, or the control skeleton's own.
      The config needs only key and generation here; the rest comes later.

  rig-parts build --config <config.json> --source <painting.png> --full <dir|psd>
                    [--head <dir|psd>] --out <dir> [--seam near-white|silhouette]
                    [--project core|visible] [--page-edges pot|free]
                    [--pack-shape rect|polygon] [--loop] [--requirements <file.json>]
                    [--idle-keys ctl|direct] [--lead-in <periods>] [--seam-pairs] [--keep-stills]
                    [--alt <name>=<source>:<full>[:<head>]] [--set <name> | --all-sets]
                    [--environment <schedule.json>]
      assemble, then rig, then check, in one process, each stage's own lines
      printed under [assemble], [rig] and [check]; the first stage that refuses
      stops the build with its own FAIL lines. The config must already carry
      bones, meshes, regions and motion — propose is not a step of build: run it,
      correct the proposal against its overlay, and write the result into the
      config. Into --out: parts/ + parts.json + recomposite_rig.png +
      ${ERROR_MAP_FILE} (assemble),
      rig/ (rig), check/ (check, with the packed build in check/build/), and with
      --loop idle.png (lossless APNG), idle-indexed.png (indexed APNG) and
      idle.gif from check/idle_frames/, then one loop: line with the three sizes
      and the two palette errors. --lead-in <n> (with --loop) encodes them
      instead from the last of n + 1 idle periods played back to back, for a
      rig whose physics does not end where rigc's render starts it. The paths it writes are cleared first. A
      green build ends with the pack line beside the spineboy yardstick and the
      three artifact paths — skeleton .json, .atlas and the packed page: the
      packed atlas is the result, the loose parts are the intermediate it was
      made from. --seam defaults to ${DEFAULT_SEAM_RULE}, --project to
      ${DEFAULT_PROJECT_RULE} (both as for assemble), --page-edges to ${DEFAULT_PAGE_EDGES} and
      --pack-shape to ${DEFAULT_PACK_SHAPE} (as for check; both packed builds, rig's gate
      and check's artifact, take them). --requirements is forwarded to check
      (as for check); the file's own shape is read before assemble runs, and
      its names resolve against the rig in the check, before it builds.
      Without the flag, config.requirements (a path beside the config) is
      read in its place; a flag naming other bytes than the declaration is
      BUILD_REQUIREMENTS_CONFLICT, before assemble. check.json's
      requirements.file records the path as typed or declared, its sha256
      and the file's keys.
      --environment is forwarded to check (as for check); the schedule is read
      by rig-c's reader before assemble runs, so a malformed one is refused,
      CHECK_ENVIRONMENT, under [assemble] before anything is assembled.
      --seam-pairs and --keep-stills are forwarded to check (as for check:
      the seam split by pair on a pass too, under check/seam/; the setup-pose
      still under check/setup_still/). check's --rig and --parts are refused:
      build's check reads the rig and the parts it wrote, <out>/rig and <out>.
      build's --source is the painting assemble reads and is not handed to
      the check, so check.json carries no SETUP_POSE_VS_SOURCE; run check
      --rig <out>/rig --parts <out> --source <painting> for that line.
      --idle-keys is forwarded to the rig stage (as for rig) and defaults to
      ctl; the first line names it when it is direct. A config with a
      two-bone ik over chain links the idle keys needs --idle-keys direct:
      rigc refuses the pair a control splits, and the RIG_RIGC_GREEN line
      names the flag on the command that ran.

  rig-parts compose --scene <scene.json> --out <dir> [--requirements <file.json>] [--accept <bar>[,<bar>...]]
      Bind several finished characters into one rig. The scene file (spec
      "${SCENE_SPEC}") states the canvas {width, height}, an optional plate
      {image, provenance: ${PROVENANCES.join(' | ')}, note?}, the characters
      [{id, build, offset: [x, y], scale?}] — each build the --out of a green
      \`rig-parts build\` (its check/check.json PASS), each offset a
      translation from its rig px to canvas px, each scale (a positive
      number, 1 when absent) the character's size about its stage's top-left
      corner: every length it carries is scaled as Spine's loader scales a
      skeleton (bones, regions, weight binds, constraint lengths, translate
      keys), and a physics wind or gravity, which no per-character value
      can scale, is refused (SCENE_SCALE_EXACT) — and order: the draw order,
      back to front, of character ids (that character's remaining slots, in
      its own order) and "<id>:<slot>" entries, every slot exactly once.
      Paths are relative to the scene file. Every bone, slot, attachment,
      constraint, track, group and easing of a character is renamed
      "<id>:<name>" under one shared root; its images "<id>${IMAGE_SEP}<file>" (an
      atlas region cannot hold ":"). The offset is added once, to what the
      character places in root's own frame: its first-level bones, and a
      region on a slot root carries or a weight bound to root. The root is
      shared, so a character whose idle keys it, or whose constraint names it,
      is refused. The plate is a region on bone "${PLATE}" under
      root, drawn first, its image at canvas (0, 0). One idle holds every
      character's tracks; an animation beside a character's idle (its
      config's motion.animations_from) rides along as "<id>:<name>",
      prefixed as the idle is and scheduled by nothing. Refused by name, every problem at once: an id
      repeated, empty or holding ":" (or "/", "\\", a leading "."); a build
      missing a file or whose own check is not green; characters built at
      different rig_scale; a character whose parts' boxes, placed, leave the
      canvas; an order entry naming no character or slot; a slot named twice
      or never; a constraint, or a --requirements name, that names a bone of
      another character without its prefix (SCENE_NAME_PREFIXED); a plate not
      of the canvas size; idles of different durations; a key in a build's
      rig or motion compose does not know. The result is gated through
      rig-c as rig gates its own (build --profile rig-play --pack, the
      compile and the packed pages on disk); --out receives rig/ (rig.json,
      motion.json, images/) and ${SCENE_REPORT_FILE} (spec "${SCENE_REPORT_SPEC}":
      every setting, each character's offset, scale, bounds and shift (and what it
      moved),
      the plate's provenance, the declared and the composed order) only when
      it is green; then check runs over rig/ into check/, as on a rig it did
      not build (no parts.json: the seam, BREATH_VISIBLE, BLINK_NO_HOLE,
      TIP_OVER_ROOT, STILL_REGIONS_DARK and RECOMPOSITE_HOLES say SKIP and
      why), --requirements forwarded. Nothing is inferred: not the order, not
      an overlap, not a scale, not a person; the plate's provenance and the
      order are the author's and judged by nothing. --accept (or a
      character's "accept": [...] in the scene file; the two lists are
      joined, the command line's applying to every character) takes a build
      whose own check failed only the bars named — ${ACCEPTABLE_BARS.join(', ')};
      the gate, a declared requirement and an unknown name are refused
      (SCENE_ACCEPT_KNOWN). It is for looking, not shipping: the [compose]
      line and ${SCENE_REPORT_FILE} name what was accepted, and the run exits 1.
      Exit 0 when the check is PASS and nothing was accepted, 1 otherwise.

  rig-parts painting --keypoints <keypoints.json> [--person <id>] <painting.png>
      Before See-through: read the painting against its body-18 joints (the
      file propose --keypoints reads, measured on this painting) and refuse,
      by name, what a rig cannot be cut from. Background is near-white
      (every channel above 235) or unpainted (alpha 8 or less) ground
      connected to the edge; the figure is the rest; a gap is one background
      pixel on the line between two joints. PAINTING_BACKGROUND_PLAIN (a
      border pixel that is not ground), PAINTING_JOINTS_STATED (a wrist,
      knee or ankle not observed, or a hip neither observed nor occluded
      with a position), PAINTING_JOINT_ON_FIGURE (an observed joint, or an
      occluded hip, on the background), PAINTING_ARM_CLEAR (no gap from a
      wrist to its hip), PAINTING_HANDS_APART (none between the wrists),
      PAINTING_LEGS_APART (none between the knees, or the ankles). Prints the
      figure, every joint and every gap with its count; writes nothing.
      docs/PAINTING.md says why each one matters. Exit 0 PASS, 1 refused.

  rig-parts guide <RULE | §<n> | §<n>.<m> | §<n>.<m>.<k>>
      Print a slice of ${GUIDE_DOC}, the guide this package ships, read
      from the installed file at the moment of the call; nothing is kept
      apart from it. Every FAIL line ends with the command that prints its
      rule's row: "(see rig-parts guide <RULE>)". guide <RULE> prints
      "docs/AUTHORING.md §<addr>, line <N> — under "<heading>"" and the one
      row naming the rule; a refusal and the bar it enforces (CHECK_<LINE>
      and <LINE>) print one after the other, joined by "paired with
      <OTHER>:". A name no row holds is refused on stderr
      (GUIDE_RULE_KNOWN), with the three nearest names the guide holds,
      and nothing printed in their place. guide §<n> prints section n,
      after its subsections' numbers and sizes in KB; §<n>.<m>
      is the m-th ### heading under it and §<n>.<m>.<k> the k-th #### under
      that, counted as the file stands (the headings carry no number), and
      §<n>.<m> lists its ####s as §<n> lists its ###s. Exit 0 printed, 1
      refused, 2 usage.

  rig-parts --version
  rig-parts --help

${LATER.length === 0 ? '' : `not implemented in this version (each exits 2):\n${LATER.map(([name, what]) => `  ${name.padEnd(9)} ${what}`).join('\n')}\n\n`}exit codes: 0 done, 1 input refused (FAIL lines name every reason), 2 usage or not implemented
`;

function printRefusal(err: unknown): number {
  if (err instanceof PartsError) {
    for (const p of err.problems) console.log(failLine(p));
    console.log(`refused: ${err.problems.length} problem(s)`);
    return EXIT_REFUSED;
  }
  throw err;
}

function usage(message: string): number {
  console.log(`  FAIL  USAGE: ${message}${guidePointer('USAGE')}`);
  console.log('rig-parts --help lists the commands');
  return EXIT_USAGE;
}

/** `guide`: one argument, a rule name or a section; the slice printed, or the refusal. */
function cmdGuide(args: string[]): number {
  if (args.length !== 1) return usage(`guide takes one rule name or one §<n> / §<n>.<m> / §<n>.<m>.<k>; got ${args.length} argument(s)`);
  if (args[0].startsWith('-')) return usage(`guide takes no flag; "${args[0]}" is neither a rule name nor §<n> / §<n>.<m>`);
  const path = join(import.meta.dir, GUIDE_DOC);
  if (!existsSync(path)) return printRefusal(new PartsError([{ code: 'GUIDE_FILE_PRESENT', object: path, detail: 'no such file; the guide ships in the package beside cli.ts' }]));
  const text = readFileSync(path, 'utf8');
  const answer: GuideAnswer = args[0].startsWith('§') ? guideSection(text, args[0]) : guideRule(text, args[0]);
  // The shared form: an unknown name or section is one coded FAIL line on stderr, exit 1.
  if ('problem' in answer) {
    console.error(failLine(answer.problem));
    return EXIT_REFUSED;
  }
  for (const l of answer.lines) console.log(l);
  return EXIT_OK;
}

function fixed(v: number | null): string {
  return v === null ? '-' : v.toFixed(4);
}

function printLayerTable(set: LayerSet): void {
  console.log(`rig-parts layers: ${set.form === 'wrapper' ? 'ComfyUI wrapper form' : 'PSD'}, ${set.source}`);
  console.log(`  canvas ${set.canvas.w}x${set.canvas.h}, ${set.layers.length} layer(s), back to front`);
  const figures = layerFigures(set);
  const rows = set.layers.map((l, i) => [
    String(l.drawOrder),
    l.name,
    l.tag.group,
    `${l.left},${l.top}`,
    `${l.right},${l.bottom}`,
    `${l.pixels.width}x${l.pixels.height}`,
    String(l.opaquePx),
    fixed(l.depth),
    pct(figures[i].translucent),
    pct(figures[i].background),
    times(figures[i].areaRatio),
  ]);
  const head = ['order', 'name', 'group', 'left,top', 'right,bottom', 'size', 'opaque_px', 'depth', 'translucent', 'background', 'area'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]): string => `  ${cells.map((c, i) => c.padEnd(widths[i])).join('  ')}`.trimEnd();
  console.log(line(head));
  for (const r of rows) console.log(line(r));
  const painted = set.layers.filter((l) => l.opaquePx > 0).length;
  console.log(`  ${set.layers.length} layer(s): ${painted} with opaque pixels, ${set.layers.length - painted} with none`);
  // Issue #256: a layer the author made is said to be one, so it never reads as See-through's. None, no line.
  for (const l of set.layers) if (l.tag.group === 'author') console.log(`  ${authorLayerLine(l.name)}`);
  // Issue #359: a hidden-art layer is listed apart, never in the drawn table. None, no line.
  for (const h of set.hidden) console.log(`  ${hiddenLayerLine(h)}`);
  // Issue #359: an input with no depth is said once, with what reads depth and that it is skipped, never passed.
  if (set.layers.length > 0 && set.layers.every((l) => l.depth === null)) console.log(`  ${depthSkipLine(set)}`);
  // A reader refuses nothing on plausibility: it says what --propose-plan will leave out, and why.
  let warned = 0;
  for (const f of figures) {
    for (const rule of implausibleRules(f)) {
      console.log(`  WARN  ${rule}: layer "${f.name}" — ${figuresPhrase(f)}; ${ruleSummary(rule)} is required, so --propose-plan leaves it out`);
      warned++;
    }
  }
  console.log(`  ${warned} WARN line(s)`);
}

/**
 * Every flag each command takes: `valued` flags carry a value, `switches` are bare. Each parser reads its row to
 * decide what it accepts, and {@link notTaken} prints the same row in the unknown-flag refusal, so the refusal
 * lists exactly the flags the parser accepts (CL26). `guide` takes one positional argument and no flag, so it has
 * no row; `layers` takes one positional path beside its flags (issue #359).
 */
const TAKES = {
  layers: { valued: ['--export', '--template', '--canvas'], switches: [] },
  sheet: { valued: ['--source', '--layers', '--out', '--cell', '--cols'], switches: [] },
  rig: { valued: ['--config', '--parts', '--out', '--idle-keys', '--page-edges', '--pack-shape'], switches: [] },
  propose: { valued: ['--parts', '--source', '--out', '--from-config', '--compare', '--full', '--head', '--canvas', '--keypoints', '--person', '--wrist-snap', '--grid-rule', '--cloth', '--write-config', '--from'], switches: ['--head-box', '--no-back-hair'] },
  compare: { valued: ['--left', '--right', '--map'], switches: [] },
  check: { valued: ['--rig', '--out', '--parts', '--source', '--page-edges', '--pack-shape', '--requirements', '--set', '--environment'], switches: ['--seam-pairs', '--keep-stills', '--all-sets'] },
  loop: { valued: ['--frames', '--out'], switches: ['--palette'] },
  assemble: { valued: ['--source', '--full', '--head', '--config', '--out', '--seam', '--project', '--alt', '--write-config'], switches: ['--propose-plan'] },
  'comfy seethrough': { valued: ['--image', '--out', '--resolution', '--steps', '--seed', '--prefix', '--host', '--wait', '--timeout', '--poll'], switches: ['--offload', '--lama', '--nf4'] },
  'comfy paint': { valued: ['--config', '--out', '--seeds', '--seed0', '--host', '--wait', '--timeout', '--poll'], switches: [] },
  inputs: { valued: ['--source', '--config', '--out'], switches: [] },
  build: { valued: ['--config', '--source', '--full', '--head', '--out', '--seam', '--project', '--page-edges', '--pack-shape', '--requirements', '--idle-keys', '--lead-in', '--alt', '--set', '--environment'], switches: ['--loop', '--seam-pairs', '--keep-stills', '--all-sets'] },
  compose: { valued: ['--scene', '--out', '--requirements', '--accept'], switches: [] },
  'mesh-draft': { valued: ['--config', '--parts', '--out', '--requirements', '--idle-keys', '--page-edges', '--pack-shape'], switches: ['--more-triangles'] },
  'mesh-stats': { valued: ['--config', '--parts'], switches: [] },
  remesh: { valued: ['--rig', '--config', '--parts', '--part', '--mesh', '--delta', '--out', '--requirements', '--idle-keys', '--page-edges', '--pack-shape', '--input-check'], switches: ['--record-input-check'] },
  retune: { valued: ['--rig', '--config', '--parts', '--out', '--requirements', '--idle-keys', '--page-edges', '--pack-shape', '--input-check'], switches: ['--record-input-check'] },
  painting: { valued: ['--keypoints', '--person'], switches: [] },
} as const satisfies Record<string, { valued: readonly string[]; switches: readonly string[] }>;

type Command = keyof typeof TAKES;

/** Whether `command` takes `flag` as a valued flag, read off its {@link TAKES} row. */
function takesValued(command: Command, flag: string): boolean {
  return (TAKES[command].valued as readonly string[]).includes(flag);
}

/** The unknown-flag refusal: the flag, and every flag the command's {@link TAKES} row holds, valued then bare. */
function notTaken(command: Command, flag: string): string {
  const row = TAKES[command];
  return `${command} does not take "${flag}"; it takes ${[...row.valued, ...row.switches].join(', ')}`;
}

/** Parse `--alt <name>=<source>:<full>[:<head>]` (issue #454), or return a usage message. */
function parseAltArg(value: string): AlternateCliInput | string {
  const eq = value.indexOf('=');
  if (eq <= 0) return `--alt "${value}" is not <name>=<source>:<full>[:<head>]`;
  const name = value.slice(0, eq);
  if (name.startsWith('.') || name.includes('/') || name.includes('\\')) return `--alt set name "${name}" may not start with "." or hold a slash`;
  const rest = value.slice(eq + 1);
  const parts = rest.split(':');
  if (parts.length < 2 || parts.length > 3 || parts[0].length === 0 || parts[1].length === 0 || (parts.length === 3 && parts[2].length === 0)) {
    return `--alt "${value}" is not <name>=<source>:<full>[:<head>]`;
  }
  return { name, source: parts[0], full: parts[1], ...(parts.length === 3 ? { head: parts[2] } : {}) };
}

/**
 * `layers <path>` prints the table; `layers --export <dir> <path>` writes the
 * set as the wrapper form and reads it back (issue #359); `layers --template
 * <out.psd> --canvas <W>x<H>` writes the artist's template. One positional
 * path, except with --template, which reads nothing.
 */
function cmdLayers(args: string[]): number {
  const flags = new Map<string, string>();
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      paths.push(a);
      continue;
    }
    if (!takesValued('layers', a)) return usage(notTaken('layers', a));
    const value = args[i + 1];
    if (value === undefined) return usage(`${a} needs a value`);
    if (flags.has(a)) return usage(`${a} is given twice`);
    flags.set(a, value);
    i++;
  }
  const template = flags.get('--template');
  if (template !== undefined) {
    if (flags.has('--export') || paths.length > 0) return usage(`--template writes a PSD and reads nothing; it takes --canvas only, and got ${[...[...flags.keys()].filter((f) => f !== '--template' && f !== '--canvas'), ...paths].join(', ')}`);
    const canvasArg = flags.get('--canvas');
    if (canvasArg === undefined) return usage('--template needs --canvas <W>x<H>, the canvas size in px (with one run, a square of seethrough.resolution)');
    const canvas = parseCanvas(canvasArg);
    if (canvas === null) return usage(`--canvas ${canvasArg} is not <W>x<H> in integer px`);
    if (extname(template).toLowerCase() !== '.psd') return usage(`--template ${template} is not a .psd path`);
    const names = templateLayerNames();
    mkdirSync(dirname(template), { recursive: true });
    writeFileSync(template, templatePsdBytes(canvas.w, canvas.h));
    console.log(`rig-parts layers --template: wrote ${template}, ${canvas.w}x${canvas.h}, ${names.length} empty layer(s), bottom first: ${names.join(', ')}`);
    console.log('  paint into the layers the figure has and delete the rest: an empty layer is refused by name (PSD_LAYER_HAS_PIXELS)');
    return EXIT_OK;
  }
  if (flags.has('--canvas')) return usage('--canvas belongs to --template');
  if (paths.length !== 1) return usage(`layers takes one path; got ${paths.length}`);
  try {
    const set = readLayers(paths[0]);
    printLayerTable(set);
    const dir = flags.get('--export');
    if (dir !== undefined) {
      const w = exportLayers(set, dir);
      // The round trip, read now: what was written must read back as what was read.
      const back = readWrapperLayers(dir);
      const diff = layerSetDiff(set, back);
      if (diff !== null) throw new PartsError([{ code: 'LAYERS_EXPORT_ROUND_TRIP', object: w.manifest, detail: `reads back unlike ${paths[0]}: ${diff}; the same layers, boxes, pixels and order are required (a bug in the exporter, not in the input)` }]);
      console.log(`rig-parts layers --export: wrote ${w.manifest} and ${w.files.length} PNG(s) in ${dir}; read back: ${back.layers.length} drawn and ${back.hidden.length} hidden-art layer(s), boxes, pixels and order as read`);
      console.log(`  correct it there — move pixels between PNGs, change a box in layers.json with its PNG — and hand ${dir} to any command that reads layers (docs/AUTHORING.md, *The correction loop*)`);
    }
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

function cmdSheet(args: string[]): number {
  const layers: string[] = [];
  let source: string | null = null;
  let out: string | null = null;
  let cell = 220;
  let cols = 8;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (!takesValued('sheet', flag)) return usage(notTaken('sheet', flag));
    if (value === undefined) return usage(`${flag} needs a value`);
    i++;
    if (flag === '--source') source = value;
    else if (flag === '--layers') layers.push(value);
    else if (flag === '--out') out = value;
    else {
      const n = Number(value);
      if (!Number.isInteger(n) || n < (flag === '--cell' ? 40 : 1)) {
        return usage(`${flag} ${value} is not an integer of at least ${flag === '--cell' ? 40 : 1}`);
      }
      if (flag === '--cell') cell = n;
      else cols = n;
    }
  }
  if (source === null) return usage('sheet needs --source <painting.png>');
  if (layers.length === 0) return usage('sheet needs at least one --layers <path>');
  if (out === null) return usage('sheet needs --out <sheet.png>');
  if (extname(out).toLowerCase() !== '.png') return usage(`--out ${out} is not a .png; the sheet is written as PNG only`);
  try {
    if (!existsSync(source)) {
      throw new PartsError([{ code: 'SHEET_SOURCE_PRESENT', object: source, detail: 'no such file; the painting is the first tile' }]);
    }
    const src = readPng(source);
    const tiles: Tile[] = [{ name: 'source', image: src, caption: basename(source) }];
    for (const path of layers) tiles.push(...tilesFrom(path));
    const sheet = buildSheet(tiles, cols, cell);
    // The README's loop writes sheets/layers.png into a folder nothing made yet;
    // every other command creates its --out, so this one does too.
    mkdirSync(dirname(out), { recursive: true });
    writePng(out, sheet);
    console.log(`rig-parts sheet: ${out}`);
    console.log(`  ${tiles.length} tile(s) in ${cols} column(s) of ${cell} px, sheet ${sheet.width}x${sheet.height}`);
    tiles.forEach((t, i) => console.log(`  tile ${String(i).padStart(3)}  ${t.name}  ${t.caption ?? defaultCaption(t.image)}`));
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

/** `--page-edges`, or its default; a value rig-c does not take is a usage error naming the two it does. */
function pageEdgesOf(value: string | undefined): PageEdges | string {
  const edges = value ?? DEFAULT_PAGE_EDGES;
  return (PAGE_EDGES as readonly string[]).includes(edges) ? (edges as PageEdges) : `--page-edges ${edges}; one of ${PAGE_EDGES.join(', ')} is required`;
}

function isPageEdges(v: PageEdges | string): v is PageEdges {
  return (PAGE_EDGES as readonly string[]).includes(v);
}

/** `--pack-shape`, or its default; a value rig-c does not take is a usage error naming the two it does. */
function packShapeOf(value: string | undefined): PackShape | string {
  const shape = value ?? DEFAULT_PACK_SHAPE;
  return (PACK_SHAPES as readonly string[]).includes(shape) ? (shape as PackShape) : `--pack-shape ${shape}; one of ${PACK_SHAPES.join(', ')} is required`;
}

function isPackShape(v: PackShape | string): v is PackShape {
  return (PACK_SHAPES as readonly string[]).includes(v);
}

function cmdRig(args: string[]): number {
  let config: string | null = null;
  let partsDir: string | null = null;
  let out: string | null = null;
  let idleKeys: string | null = null;
  let pageEdges: string | null = null;
  let packShape: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (!takesValued('rig', flag)) return usage(notTaken('rig', flag));
    if (value === undefined) return usage(`${flag} needs a value`);
    i++;
    if (flag === '--config') config = value;
    else if (flag === '--parts') partsDir = value;
    else if (flag === '--idle-keys') {
      if (idleKeys !== null) return usage('--idle-keys is given twice');
      idleKeys = value;
    } else if (flag === '--page-edges') {
      if (pageEdges !== null) return usage('--page-edges is given twice');
      pageEdges = value;
    } else if (flag === '--pack-shape') {
      if (packShape !== null) return usage('--pack-shape is given twice');
      packShape = value;
    } else out = value;
  }
  if (config === null) return usage('rig needs --config <config.json>');
  if (partsDir === null) return usage('rig needs --parts <dir> (the directory holding parts.json and parts/)');
  if (out === null) return usage('rig needs --out <dir>');
  const keys = idleKeysOf(idleKeys ?? undefined);
  if (!isIdleKeys(keys)) return usage(keys);
  const edges = pageEdgesOf(pageEdges ?? undefined);
  if (!isPageEdges(edges)) return usage(edges);
  const shape = packShapeOf(packShape ?? undefined);
  if (!isPackShape(shape)) return usage(shape);
  let bin: string;
  try {
    bin = findRigc(import.meta.dir, process.env.PATH ?? '');
  } catch (err) {
    return printRefusal(err);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'rig-parts-rig-'));
  try {
    rigStage({ config, parts: partsDir, out, idleKeys: keys, pageEdges: edges, packShape: shape }, rigcRunner(bin), scratch, console.log);
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The rigc process, for every stage that runs rigc — `rig`'s gate, `check`, and
 * both inside `build`: the `rigc` binary {@link findRigc} located, spawned as
 * it is, so rig-c's own launcher (`bin/rigc.cjs`) chooses the entry —
 * `cli.ts` and the spine-core round trip where the runtime resolves beside it,
 * `cli_core.ts` and rigc's own validator where it does not. No stage runs a
 * rigc source file by path: under rig-c 2.0, `cli.ts` by path is the
 * spine-core entry whether or not spine-core is there. `src/` is pure and takes
 * the spawn from here. A call that fails carries which rigc ran it, path and
 * version ({@link rigcRunnerAt}, issue #337), and every refusal quoting it says so.
 */
function rigcRunner(bin: string): RigcRunner {
  return rigcRunnerAt(bin, (b, args) => {
    const r = spawnSync(b, [...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.error !== undefined) return { status: 127, out: `could not start ${b}: ${r.error.message}` };
    return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  });
}

/** The command's valued flags as `--flag value` pairs, each one its {@link TAKES} row holds; `required` must all be given. Its bare switches are taken out by the caller before this reads the rest. A string is a usage error. */
function flags(args: string[], command: Command, required: readonly string[]): Map<string, string> | string {
  const got = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!takesValued(command, flag)) return notTaken(command, flag);
    if (args[i + 1] === undefined) return `${flag} needs a value`;
    if (got.has(flag)) return `${flag} is given twice`;
    got.set(flag, args[i + 1]);
  }
  for (const k of required) if (!got.has(k)) return `${command} needs ${k} <value>`;
  return got;
}

function cmdCheck(args: string[]): number {
  // The switches check takes (issues #202, #209, #454): they carry no value, so they are taken out before the valued flags are read.
  const seamPairs = args.filter((a) => a === '--seam-pairs').length;
  if (seamPairs > 1) return usage('--seam-pairs is given twice');
  const keepStills = args.filter((a) => a === '--keep-stills').length;
  if (keepStills > 1) return usage('--keep-stills is given twice');
  const allSets = args.filter((a) => a === '--all-sets').length;
  if (allSets > 1) return usage('--all-sets is given twice');
  const f = flags(
    args.filter((a) => a !== '--seam-pairs' && a !== '--keep-stills' && a !== '--all-sets'),
    'check',
    ['--rig', '--out'],
  );
  if (typeof f === 'string') return usage(f);
  if (allSets === 1 && f.has('--set')) return usage('--set and --all-sets are two modes; give one');
  const rig = f.get('--rig') as string;
  const out = f.get('--out') as string;
  const edges = pageEdgesOf(f.get('--page-edges'));
  if (!isPageEdges(edges)) return usage(edges);
  const shape = packShapeOf(f.get('--pack-shape'));
  if (!isPackShape(shape)) return usage(shape);
  try {
    const bin = findRigc(import.meta.dir, process.env.PATH ?? '');
    const r = checkStage(
      { rig, parts: f.get('--parts'), source: f.get('--source'), out, pageEdges: edges, packShape: shape, requirements: f.get('--requirements'), seamPairs: seamPairs === 1, keepStills: keepStills === 1, ...(f.has('--set') ? { set: f.get('--set') as string } : {}), allSets: allSets === 1, ...(f.has('--environment') ? { environment: f.get('--environment') as string } : {}) },
      rigcRunner(bin),
      bin,
      console.log,
    );
    return r.figures.PASS ? EXIT_OK : EXIT_REFUSED;
  } catch (err) {
    return printRefusal(err);
  }
}

function parseCanvas(v: string): { w: number; h: number } | null {
  const m = /^(\d+)x(\d+)$/.exec(v);
  return m === null ? null : { w: Number(m[1]), h: Number(m[2]) };
}

function printLint(P: PartSet, spec: { bones: CharacterConfig['bones']; meshes: CharacterConfig['meshes']; regions: CharacterConfig['regions']; motion: CharacterConfig['motion']; constraints?: CharacterConfig['constraints']; limbs?: CharacterConfig['limbs']; notes?: readonly string[] }, joints?: RigJoints, drafted: readonly DraftLintFinding[] = []): number {
  const res = lint(P, spec, joints, drafted);
  // Under --keypoints only: which rule set read the torso and the chains, and on what basis.
  if (res.basis !== undefined) for (const l of basisLines(res.basis)) console.log(l);
  for (const f of res.findings) console.log(lintLine(f));
  for (const m of res.unknownMeshes) console.log(`note: mesh ${JSON.stringify(m)} names no part in parts.json, so it was not linted`);
  for (const w of res.lockUnread) console.log(`note: off-lock not read: ${w}`);
  for (const w of res.squeezeUnread) console.log(`note: squeeze not read: ${w}`);
  for (const b of res.branchSqueezes) console.log(branchSqueezeLine(b));
  for (const b of res.missingTorsoBones) {
    console.log(
      res.basis?.torso.read === true
        ? `note: no single bone named ${JSON.stringify(b)}, so it was not linted against the torso joints`
        : `note: no single bone named ${JSON.stringify(b)}, so the hip was not linted against the chest${b === 'hip' ? ' or the figure height' : ''}`,
    );
  }
  console.log(`${res.findings.length} LINT line(s) over ${Object.keys(spec.meshes).length - res.unknownMeshes.length} mesh(es) and the hip`);
  // Issue #86: after every line above, which check read each bone, or why none did.
  for (const l of coverageLines(res.coverage, legChainChoice(P, spec, joints))) console.log(l);
  return res.findings.length;
}

function cmdPropose(args: string[]): number {
  const flags = new Map<string, string>();
  let headBox = false;
  let noBackHair = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--head-box') {
      headBox = true;
      continue;
    }
    if (flag === '--no-back-hair') {
      if (noBackHair) return usage('--no-back-hair is given twice');
      noBackHair = true;
      continue;
    }
    if (!takesValued('propose', flag)) return usage(notTaken('propose', flag));
    const value = args[i + 1];
    if (value === undefined) return usage(`${flag} needs a value`);
    if (flags.has(flag)) return usage(`${flag} is given twice`);
    flags.set(flag, value);
    i++;
  }
  let staged: StagedConfigWrite | null = null;
  try {
    if (headBox) {
      const stray = [...flags.keys()].filter((f) => f !== '--full' && f !== '--canvas' && f !== '--write-config');
      if (stray.length > 0) return usage(`--head-box takes --full, --canvas and optional --write-config only; got ${stray.join(', ')}`);
      const full = flags.get('--full');
      const canvasArg = flags.get('--canvas');
      if (full === undefined) return usage('--head-box needs --full <dir | layers.json | file.psd>, the full run\'s layers');
      if (canvasArg === undefined) return usage('--head-box needs --canvas <W>x<H>, the painting\'s size in px');
      const canvas = parseCanvas(canvasArg);
      if (canvas === null) return usage(`--canvas ${canvasArg} is not <W>x<H> in integer px`);
      const target = flags.has('--write-config') ? readConfigWriteTarget(flags.get('--write-config') as string) : null;
      const r = proposeHeadBox(readLayers(full), canvas, { backHair: !noBackHair });
      if (target !== null) {
        staged = stageConfigWrite(target, { kind: 'head-box', head_box: r.head_box });
        staged.commit();
        for (const line of configWriteLines(target, staged.changes)) console.error(line);
      }
      console.log(`rig-parts propose --head-box: ${full}`);
      console.log(`  painting ${canvas.w}x${canvas.h}; head layers ${r.layers.map(([n, c]) => `${n} ${c} px`).join(', ')}`);
      if (r.shift[0] !== 0 || r.shift[1] !== 0) {
        console.log(`  clamped: the proposed box [${r.unclamped.join(', ')}] leaves the ${canvas.w}x${canvas.h} painting; shifted by ${r.shift[0]},${r.shift[1]} px at the same size`);
      } else console.log('  inside the painting, no shift');
      const edge = r.head_box[2] - r.head_box[0];
      const w = r.without_back_hair;
      if (w !== undefined) {
        const share = edge > 0 ? Math.round((1 - (w.edge * w.edge) / (edge * edge)) * 100) : 0;
        console.log(`  back hair: without "back hair" the box is ${w.head_box !== null ? `[${w.head_box.join(', ')}], ` : ''}${w.edge}x${w.edge} ("back hair" adds ${edge - w.edge} px to the side, ${share}% of the box's area; pass --no-back-hair to leave it out)`);
      }
      console.log(`  head_box [${r.head_box.join(', ')}], ${edge}x${r.head_box[3] - r.head_box[1]}`);
      console.log(JSON.stringify({ head_box: r.head_box }));
      return EXIT_OK;
    }
    if (noBackHair) return usage('--no-back-hair belongs to --head-box');
    if (flags.has('--canvas')) return usage('--canvas belongs to --head-box');
    const partsArg = flags.get('--parts');
    const source = flags.get('--source');
    const out = flags.get('--out');
    if (partsArg === undefined) return usage('propose needs --parts <dir>, the directory holding parts.json and parts/');
    if (source === undefined) return usage('propose needs --source <painting.png>, drawn under the overlay');
    if (out === undefined) return usage('propose needs --out <dir>');
    if (flags.has('--from-config') && flags.has('--compare')) return usage('--from-config and --compare are two modes; give one');
    if (flags.has('--person') && !flags.has('--keypoints')) return usage('--person names a person in the --keypoints file; give --keypoints <file>');
    // Issue #251: the See-through runs the turn control's depths are read from; without them nothing is drafted.
    if (flags.has('--from-config') && (flags.has('--full') || flags.has('--head'))) return usage('--full and --head draft the turn control while proposing; --from-config proposes nothing');
    // Issue #199: a declared tolerance for a wrist on no handwear part. Whole px above the built-in one: the distance is
    // counted in whole px, so a fraction would bind what its floor binds, and a value at or under the built-in binds nothing.
    const snapArg = flags.get('--wrist-snap');
    let wristSnap: number | null = null;
    if (snapArg !== undefined) {
      if (!flags.has('--keypoints')) return usage('--wrist-snap binds a wrist joint to a handwear part; give --keypoints <file>');
      if (flags.has('--from-config')) return usage('--wrist-snap binds a wrist while proposing; --from-config proposes nothing');
      if (!/^[0-9]+$/.test(snapArg) || Number(snapArg) <= WRIST_ON_PART_PX) {
        return usage(`--wrist-snap ${snapArg} is not an integer above ${WRIST_ON_PART_PX}, the px within which a wrist already holds a part`);
      }
      wristSnap = Number(snapArg);
    }
    // Issue #265: the drafted lattice's spacing; the figure's unless the reference's per-part rule is asked for.
    const ruleArg = flags.get('--grid-rule');
    if (ruleArg !== undefined && flags.has('--from-config')) return usage('--grid-rule chooses the drafted spacing; --from-config proposes nothing');
    if (ruleArg !== undefined && !(GRID_RULES as readonly string[]).includes(ruleArg)) return usage(`--grid-rule ${ruleArg}; one of ${GRID_RULES.join(', ')} is required`);
    const gridRule = (ruleArg ?? DEFAULT_GRID_RULE) as GridRule;
    // Issue #364: the cloth and hair recipe, read from a config's cloth block; without it nothing changes.
    const clothArg = flags.get('--cloth');
    if (clothArg !== undefined && flags.has('--from-config')) return usage('--cloth drafts trees while proposing; --from-config proposes nothing');
    // Issue #537: the --cloth config's own text with what its recipe drafts spliced in, beside proposal.json.
    const writeArg = flags.get('--write-config');
    if (writeArg !== undefined && flags.has('--from-config')) return usage('--write-config writes what the recipe drafts into its config; --from-config proposes nothing');
    // Issue #571: the config the recipe is changed from; an entry equal to its recipe's draft is the recipe's, not a hand edit.
    const fromArg = flags.get('--from');
    if (fromArg !== undefined && writeArg === undefined) return usage('--from names the config the recipe is changed from, for --write-config; give --write-config <out.json>');
    if (fromArg !== undefined && clothArg === undefined) return usage('--from names a previous cloth recipe; give --cloth <config.json>');
    if (writeArg !== undefined && clothArg !== undefined) {
      const ours = ['proposal.json', BASIS_FILE, 'render/landmarks.png', 'render/landmarks_head.png'].map((f) => resolve(out, f));
      if (existsSync(writeArg) || ours.includes(resolve(writeArg))) {
        throw new PartsError([{ code: 'PROPOSE_WRITE_CONFIG_FRESH', object: writeArg, detail: existsSync(writeArg) ? 'exists; the config is written to a new file, never over the --cloth config or an earlier one' : `is a file this run writes under ${out}; name another file` }]);
      }
      separateConfigWriteTarget({ path: resolve(writeArg) }, ours, 'PROPOSE_WRITE_CONFIG_FRESH');
    }
    // The existing cloth writer keeps its fresh-file, per-entry splice contract.
    // Without --cloth, #356 updates only an existing config through the stage loader.
    const target = writeArg === undefined || clothArg !== undefined ? null : readConfigWriteTarget(writeArg);
    if (target !== null) separateConfigWriteTarget(target, [join(out, 'proposal.json'), join(out, BASIS_FILE), join(out, 'render', 'landmarks.png'), join(out, 'render', 'landmarks_head.png')]);
    const cloth = clothArg === undefined ? null : loadClothConfig(clothArg).cloth;
    const previousCloth = fromArg === undefined ? null : loadClothConfig(fromArg).cloth;
    const partsDir = existsSync(partsArg) && statSync(partsArg).isFile() ? dirname(partsArg) : partsArg;
    if (!existsSync(source)) {
      throw new PartsError([{ code: 'PROPOSE_SOURCE_PRESENT', object: source, detail: 'no such file; the painting is drawn under the overlay' }]);
    }
    const P = readPartSet(partsDir);
    const painting = readPng(source);
    // Issue #75: the keypoint file, held to this painting's size and taken to rig px by the overlay's map.
    const kpPath = flags.get('--keypoints');
    let joints: RigJoints | undefined;
    if (kpPath !== undefined) {
      const kp = loadKeypoints(kpPath);
      checkImageSize(kp, painting.width, painting.height, kpPath, source);
      joints = toRigJoints(kp, choosePerson(kp, flags.get('--person'), kpPath), P.W, P.H);
    }
    const render = join(out, 'render');
    const fromConfig = flags.get('--from-config');
    if (fromConfig !== undefined) {
      const cfg = loadConfig(fromConfig);
      const img = drawLandmarks(P, painting, cfg.bones, 'config bones');
      mkdirSync(render, { recursive: true });
      writePng(join(render, 'landmarks_config.png'), img.full);
      if (img.head !== null) writePng(join(render, 'landmarks_config_head.png'), img.head);
      console.log(`wrote ${join(render, 'landmarks_config.png')}${img.head !== null ? ' (+_head)' : ' (no bone named "head", so no head crop)'}`);
      return printLint(P, cfg, joints) > 0 ? EXIT_REFUSED : EXIT_OK;
    }
    const cmpPath = flags.get('--compare');
    const cfg = cmpPath === undefined ? null : loadConfig(cmpPath);
    const { proposal: drafted, basis, draftLint } = proposeWithBasis(P, joints, wristSnap, gridRule, cloth);
    const fullRun = flags.get('--full');
    const headRun = flags.get('--head');
    const prop =
      fullRun === undefined && headRun === undefined
        ? drafted
        : withTurn(drafted, draftTurn(P, { ...(fullRun === undefined ? {} : { full: readLayers(fullRun) }), ...(headRun === undefined ? {} : { head: readLayers(headRun) }) }, drafted));
    // Emit only after green: a proposal the config loader would refuse is not written, nor a basis record that does not hold to it.
    checkProposal(P, prop);
    // The same parts drafted without the recipe: what --write-config measures its edits against, and what issue #572's chain reading compares with.
    const plain = cloth === null ? null : proposeWithBasis(P, joints, wristSnap, gridRule, null).proposal;
    // Issue #537: the sections the recipe moves, measured against the same parts drafted without it, spliced before anything is written.
    const written =
      writeArg === undefined || clothArg === undefined || plain === null
        ? null
        : (() => {
            const text = readFileSync(clothArg, 'utf8');
            // Issue #552: bones, constraints and motion.tracks entry by entry; a hand edit the recipe would drop is refused by name.
            // Issue #571: with --from, the same parts drafted a third time with the previous recipe.
            const previous = previousCloth === null ? null : proposeWithBasis(P, joints, wristSnap, gridRule, previousCloth).proposal;
            const edits = clothConfigEdits(drafted, plain, JSON.parse(text) as unknown, false, previous);
            return { at: writeArg, input: text, text: writtenClothConfig(clothArg, text, edits), paths: editPaths(edits), vouched: previousCount(edits), returned: plainCount(edits), relative: relativeConfigPaths(dirname(resolve(clothArg)), JSON.parse(text) as Record<string, unknown>) };
          })();
    // Issue #572: the keyed chains CHAIN_LAG reads only once the recipe took its trees' idle keys — in the config written
    // against the --cloth config with --write-config, else in the proposal against the draft without the recipe.
    const leftBehind: { findings: DraftLintFinding[]; unread: string | null } = (() => {
      if (plain === null) return { findings: [], unread: null };
      if (written === null) return { findings: chainsLeftBehind(proposalAsConfig(P, plain), proposalAsConfig(P, prop)), unread: null };
      const read = (what: string, text: string): CharacterConfig | string => {
        try {
          return proposalAsConfig(P, JSON.parse(text) as Record<string, unknown>);
        } catch (err) {
          if (!(err instanceof PartsError)) throw err;
          return `${what} does not load as a config (${err.problems[0].code}: ${err.problems[0].object})`;
        }
      };
      const before = read(String(clothArg), written.input);
      const after = read(written.at, written.text);
      if (typeof before === 'string') return { findings: [], unread: before };
      if (typeof after === 'string') return { findings: [], unread: after };
      return { findings: chainsLeftBehind(before, after), unread: null };
    })();
    const bfile = basisFile(P, prop, basis, cfg === null || cmpPath === undefined ? null : { where: cmpPath, config: cfg });
    const img = drawLandmarks(P, painting, prop.bones, 'PROPOSAL - CORRECT ME');
    if (target !== null) staged = stageConfigWrite(target, { kind: 'proposal', proposal: prop, sections: PROPOSAL_CONFIG_SECTIONS });
    else if (written !== null) staged = stageConfigWrite({ kind: 'fresh', path: written.at, text: written.text });
    mkdirSync(render, { recursive: true });
    writeFileSync(join(out, 'proposal.json'), serializeProposal(prop));
    writeFileSync(join(out, BASIS_FILE), serializeBasis(bfile));
    writePng(join(render, 'landmarks.png'), img.full);
    if (img.head !== null) writePng(join(render, 'landmarks_head.png'), img.head);
    if (staged !== null) {
      staged.commit();
      if (target !== null) for (const line of configWriteLines(target, staged.changes)) console.error(line);
    }
    console.log(`wrote proposal.json (${prop.bones.length} bone entries, ${Object.keys(prop.meshes).length} meshes) and render/landmarks.png (+_head) under ${out}`);
    for (const n of prop.notes) console.log(`note: ${n}`);
    if (leftBehind.unread !== null) console.log(`note: the keyed chains were not read after the recipe (issue #572): ${leftBehind.unread}`);
    printLint(P, prop, joints, [...draftLint, ...leftBehind.findings]);
    console.log(basisLine(bfile, out));
    if (written !== null && clothArg !== undefined) {
      // Issue #630: the entries a recipe dropped since --from gives back to the draft without the recipe.
      const from = fromArg === undefined ? '' : `; --from ${fromArg}: ${written.vouched} ${written.vouched === 1 ? 'entry' : 'entries'} taken as the previous recipe's draft, ${written.returned} ${written.returned === 1 ? 'entry' : 'entries'} returned to the plain draft`;
      console.log(
        written.paths.length > 0
          ? `wrote ${written.at}: ${clothArg}'s text with ${written.paths.join(', ')} spliced in from the draft; every other byte as read${from}`
          : `wrote ${written.at}: ${clothArg}'s text byte for byte; every entry the recipe drafts is already as drafted${from}`,
      );
      if (written.relative.length > 0 && dirname(resolve(written.at)) !== dirname(resolve(clothArg))) {
        console.log(`note: ${written.relative.map((r) => `${r.at} "${r.value}"`).join(', ')} written as stated; the loader resolves each against the directory the config sits in, ${dirname(written.at)} for ${written.at}, not ${dirname(clothArg)}; put the config beside ${clothArg} or rewrite them`);
      }
    }
    if (cfg !== null) for (const l of compareLines(compare(prop.bones, cfg.bones))) console.log(l);
    return EXIT_OK;
  } catch (err) {
    if (staged !== null) {
      try { staged.abort(err); } catch (combined) { return printRefusal(combined); }
    }
    return printRefusal(err);
  } finally {
    staged?.cancel();
  }
}

function cmdCompare(args: string[]): number {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!takesValued('compare', flag)) return usage(notTaken('compare', flag));
    const value = args[i + 1];
    if (value === undefined) return usage(`${flag} needs a value`);
    if (flags.has(flag)) return usage(`${flag} is given twice`);
    flags.set(flag, value);
    i++;
  }
  const left = flags.get('--left');
  const right = flags.get('--right');
  if (left === undefined) return usage('compare needs --left <config.json | proposal.json | rig.json>');
  if (right === undefined) return usage('compare needs --right <config.json | proposal.json | rig.json>');
  const map = flags.get('--map') ?? null;
  try {
    const c = loadComparison(left, right, map);
    console.log(`rig-parts compare: left ${left}, right ${right}${map === null ? ', no map' : `, map ${map}`}`);
    for (const l of structureLines(c)) console.log(l);
    const missing = requiredProblems(c, map ?? 'the map');
    for (const p of missing) console.log(failLine(p));
    return missing.length > 0 ? EXIT_REFUSED : EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

function cmdLoop(args: string[]): number {
  const palettes = args.filter((a) => a === '--palette').length;
  if (palettes > 1) return usage('--palette is given twice');
  const f = flags(
    args.filter((a) => a !== '--palette'),
    'loop',
    ['--frames', '--out'],
  );
  if (typeof f === 'string') return usage(f);
  const out = f.get('--out') as string;
  const ext = extname(out).toLowerCase();
  if (ext === '.webp') return usage(`--out ${out}: animated WebP needs a VP8/VP8L encoder, which is out of scope; write .png (APNG) or .gif`);
  if (ext !== '.png' && ext !== '.gif') return usage(`--out ${out} is neither .png (APNG) nor .gif`);
  if (palettes === 1 && ext !== '.png') return usage(`--palette selects the indexed APNG, so --out must be a .png; ${out} is a GIF, which is always one palette`);
  try {
    loopStage(f.get('--frames') as string, out, ext === '.gif' ? 'gif' : palettes === 1 ? 'indexed' : 'apng', console.log);
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

function cmdAssemble(args: string[]): number {
  const flags = new Map<string, string>();
  const alts: AlternateCliInput[] = [];
  let propose = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--propose-plan') {
      propose = true;
      continue;
    }
    if (!takesValued('assemble', flag)) return usage(notTaken('assemble', flag));
    const value = args[i + 1];
    if (value === undefined) return usage(`${flag} needs a value`);
    if (flag === '--alt') {
      const parsed = parseAltArg(value);
      if (typeof parsed === 'string') return usage(parsed);
      if (alts.some((a) => a.name === parsed.name)) return usage(`--alt set "${parsed.name}" is given twice`);
      alts.push(parsed);
      i++;
      continue;
    }
    if (flags.has(flag)) return usage(`${flag} is given twice`);
    flags.set(flag, value);
    i++;
  }
  // --head is optional (issue #359): without it the full run is the one run, and it must hold the face.
  for (const f of ['--source', '--full', '--config']) if (!flags.has(f)) return usage(`assemble needs ${f}`);
  if (propose && (flags.has('--out') || flags.has('--seam') || flags.has('--project') || alts.length > 0)) return usage('--propose-plan prints to the console; it takes none of --out, --seam, --project, --alt');
  if (!propose && flags.has('--write-config')) return usage('--write-config belongs to assemble --propose-plan');
  if (!propose && !flags.has('--out')) return usage('assemble needs --out <dir>');
  const seam = flags.get('--seam') ?? DEFAULT_SEAM_RULE;
  if (!(SEAM_RULES as readonly string[]).includes(seam)) return usage(`--seam ${seam}; one of ${SEAM_RULES.join(', ')} is required`);
  const project = flags.get('--project') ?? DEFAULT_PROJECT_RULE;
  if (!(PROJECT_RULES as readonly string[]).includes(project)) return usage(`--project ${project}; one of ${PROJECT_RULES.join(', ')} is required`);
  const [source, full, config] = ['--source', '--full', '--config'].map((f) => flags.get(f) as string);
  const head = flags.get('--head') ?? null;
  const writePath = flags.get('--write-config');
  if (writePath !== undefined && resolve(writePath) !== resolve(config)) return usage('--write-config must name the same file as --config for assemble --propose-plan');
  let staged: StagedConfigWrite | null = null;
  try {
    if (propose) {
      const target = writePath === undefined ? null : readConfigWriteTarget(writePath);
      const src = readSource(source);
      const runs = readRuns(full, head);
      const g = proposeFields(loadEarlyConfig(config, 'layers'), runs.single ? { w: src.width, h: src.height } : null);
      const geometry = { sourceW: src.width, sourceH: src.height, ...g };
      const proposal = runs.single ? proposeSinglePlan(runs.full, geometry) : proposePlan(runs.full, runs.head, geometry);
      if (target !== null) {
        staged = stageConfigWrite(target, { kind: 'assemble-plan', plan: proposal.plan, extend_below_crop: proposal.extend_below_crop });
        staged.commit();
        for (const line of configWriteLines(target, staged.changes)) console.error(line);
      }
      console.log(JSON.stringify(proposal, null, 2));
      return EXIT_OK;
    }
    const out = flags.get('--out') as string;
    assembleStage(
      { source, full, head, config, seam: seam as SeamRule, project: project as ProjectRule, ...(alts.length === 0 ? {} : { alts }) },
      { partsJson: join(out, 'rig', 'parts.json'), partsDir: join(out, 'rig', 'parts'), recomposite: join(out, 'render', 'recomposite_rig.png'), errorMap: join(out, 'render', ERROR_MAP_FILE) },
      console.log,
    );
    return EXIT_OK;
  } catch (err) {
    if (staged !== null) {
      try { staged.abort(err); } catch (combined) { return printRefusal(combined); }
    }
    return printRefusal(err);
  } finally {
    staged?.cancel();
  }
}

/** Parse `--flag value` pairs and bare `--switch`es, as the command's {@link TAKES} row names them; a string is a usage error. */
function comfyFlags(args: string[], command: 'comfy seethrough' | 'comfy paint'): { v: Map<string, string>; on: Set<string> } | string {
  const switches: readonly string[] = TAKES[command].switches;
  const v = new Map<string, string>();
  const on = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (switches.includes(flag)) {
      if (on.has(flag)) return `${flag} is given twice`;
      on.add(flag);
      continue;
    }
    if (!takesValued(command, flag)) return notTaken(command, flag);
    const value = args[i + 1];
    if (value === undefined) return `${flag} needs a value`;
    if (v.has(flag)) return `${flag} is given twice`;
    v.set(flag, value);
    i++;
  }
  return { v, on };
}

/** An integer flag at or above `min`, or its stated default; a string is a usage error. */
function intFlag(v: Map<string, string>, flag: string, fallback: number, min: number): number | string {
  const raw = v.get(flag);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : `${flag} ${raw} is not an integer of at least ${min}`;
}

/** A seconds flag above 0, or its stated default. */
function secondsFlag(v: Map<string, string>, flag: string, fallback: number): number | string {
  const raw = v.get(flag);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : `${flag} ${raw} is not a number of seconds above 0`;
}

async function cmdComfy(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub !== 'seethrough' && sub !== 'paint') return usage(`comfy takes seethrough or paint; got ${sub === undefined ? 'nothing' : `"${sub}"`}`);
  const f = comfyFlags(rest, `comfy ${sub}`);
  if (typeof f === 'string') return usage(f);
  const { v, on } = f;
  const wait = secondsFlag(v, '--wait', 1800);
  const timeout = secondsFlag(v, '--timeout', 3600);
  const poll = secondsFlag(v, '--poll', 3);
  for (const x of [wait, timeout, poll]) if (typeof x === 'string') return usage(x);
  const out = v.get('--out');
  if (out === undefined) return usage(`comfy ${sub} needs --out <dir>`);
  const configPath = v.get('--config');
  if (sub === 'paint' && configPath === undefined) return usage('comfy paint needs --config <config.json>');
  try {
    // The config is a local file, so it is answered before any host is: a
    // config comfy paint cannot paint from is refused with no box named.
    const paint = sub === 'paint' ? loadPaintConfig(configPath as string) : null;
    const cfg = paint === null ? null : paint.config;
    const host = resolveHost(v.get('--host'), process.env.COMFY_HOST);
    const client = new ComfyClient(host, { poll: poll as number, request: 30 });
    if (sub === 'seethrough') {
      const image = v.get('--image');
      if (image === undefined) return usage('comfy seethrough needs --image <png>');
      const resolution = intFlag(v, '--resolution', 1024, 64);
      const steps = intFlag(v, '--steps', 30, 1);
      const seed = intFlag(v, '--seed', 42, 0);
      for (const x of [resolution, steps, seed]) if (typeof x === 'string') return usage(x);
      const prefix = v.get('--prefix') ?? 'spine_parts';
      if (!/^[A-Za-z0-9_-]+$/.test(prefix)) return usage(`--prefix ${prefix} is not letters, digits, "_" and "-"`);
      const run = {
        image,
        out,
        prefix,
        resolution: resolution as number,
        steps: steps as number,
        seed: seed as number,
        offload: on.has('--offload'),
        lama: on.has('--lama'),
        quant: on.has('--nf4') ? ('nf4' as const) : ('none' as const),
        wait: wait as number,
        timeout: timeout as number,
      };
      console.log(`rig-parts comfy seethrough: ${image} -> ${out}`);
      console.log(`  resolution ${run.resolution}, steps ${run.steps}, seed ${run.seed}, offload ${run.offload}, lama ${run.lama}, quant ${run.quant}; wait <= ${run.wait} s, timeout ${run.timeout} s`);
      const r = await runSeeThrough(client, run, (l) => console.log(l));
      console.log(`  ${r.layers.length} layer(s) on a ${r.canvas[0]}x${r.canvas[1]} canvas, read back green by the layer reader: ${r.layers.join(', ')}`);
      console.log(`  wrote ${join(out, 'layers.json')}, meta.json, parts/ (${r.layers.length} PNG) and previews/ (${r.previews.length} PNG); GPU job ended`);
      return EXIT_OK;
    }
    if (cfg === null) return usage('comfy paint needs --config <config.json>');
    const seeds = intFlag(v, '--seeds', 1, 1);
    if (typeof seeds === 'string') return usage(seeds);
    const seed0 = intFlag(v, '--seed0', cfg.generation.seed, 0);
    if (typeof seed0 === 'string') return usage(seed0);
    console.log(`rig-parts comfy paint: ${cfg.key} -> ${out}`);
    console.log(`  ${seeds} seed(s) from ${seed0}${v.has('--seed0') ? '' : ' (generation.seed)'}; wait <= ${wait} s per seed, timeout ${timeout} s`);
    const done = await runPainting(client, { config: cfg, pose: paint === null ? null : paint.pose, out, seeds, seed0, wait: wait as number, timeout: timeout as number }, (l) => console.log(l));
    console.log(`  wrote ${done.length} painting(s): ${done.map((d) => `${d.file} ${d.size[0]}x${d.size[1]} in ${d.elapsed.toFixed(1)} s`).join(', ')}; GPU job(s) ended`);
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

function cmdInputs(args: string[]): number {
  const f = flags(args, 'inputs', ['--source', '--config', '--out']);
  if (typeof f === 'string') return usage(f);
  const source = f.get('--source') as string;
  const out = f.get('--out') as string;
  try {
    if (!existsSync(source)) throw new PartsError([{ code: 'INPUTS_SOURCE_PRESENT', object: source, detail: 'no such file; the painting is required' }]);
    const cfg = loadEarlyConfig(f.get('--config') as string, 'layers');
    const painting = readPng(source);
    const r = makeInputs(painting, cfg, source);
    mkdirSync(out, { recursive: true });
    writePng(join(out, 'st_input_full.png'), r.full);
    console.log(`rig-parts inputs: ${source} (${painting.width}x${painting.height}) -> ${out}`);
    console.log(
      r.padTop > 0
        ? `  st_input_full.png ${r.full.width}x${r.full.height}: the painting at y ${r.padTop}, white above and below (${r.padTop} + ${r.full.height - painting.height - r.padTop} px)`
        : `  st_input_full.png ${r.full.width}x${r.full.height}: the painting at x ${r.padLeft}, white either side (${r.padLeft} + ${r.full.width - painting.width - r.padLeft} px)`,
    );
    if (r.head !== null && r.headBox !== null) {
      writePng(join(out, 'st_input_head.png'), r.head);
      console.log(`  st_input_head.png ${r.head.width}x${r.head.height}: seethrough.head_box [${r.headBox.join(', ')}]`);
    } else {
      console.log('  no seethrough.head_box in the config, so no st_input_head.png: run the full See-through pass, then `propose --head-box`, then this again');
    }
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

function cmdBuild(args: string[]): number {
  const flags = new Map<string, string>();
  const alts: AlternateCliInput[] = [];
  // The bare switches build takes: --loop its own, --seam-pairs and --keep-stills check's, forwarded (issue #257).
  const on = new Set<string>();
  const switches: readonly string[] = TAKES.build.switches;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (switches.includes(flag)) {
      if (on.has(flag)) return usage(`${flag} is given twice`);
      on.add(flag);
      continue;
    }
    // A check flag whose value build supplies itself (--rig, --parts) is refused with what build reads instead (issue #257).
    const supplied = suppliedCheckFlag(flag);
    if (supplied !== null) return usage(supplied);
    if (!takesValued('build', flag)) return usage(notTaken('build', flag));
    const value = args[i + 1];
    if (value === undefined) return usage(`${flag} needs a value`);
    if (flag === '--alt') {
      const parsed = parseAltArg(value);
      if (typeof parsed === 'string') return usage(parsed);
      if (alts.some((a) => a.name === parsed.name)) return usage(`--alt set "${parsed.name}" is given twice`);
      alts.push(parsed);
      i++;
      continue;
    }
    if (flags.has(flag)) return usage(`${flag} is given twice`);
    flags.set(flag, value);
    i++;
  }
  // --head is optional (issue #359), as for assemble.
  for (const f of ['--config', '--source', '--full', '--out']) if (!flags.has(f)) return usage(`build needs ${f}`);
  if (on.has('--all-sets') && flags.has('--set')) return usage('--set and --all-sets are two modes; give one');
  const seam = flags.get('--seam') ?? DEFAULT_SEAM_RULE;
  if (!(SEAM_RULES as readonly string[]).includes(seam)) return usage(`--seam ${seam}; one of ${SEAM_RULES.join(', ')} is required`);
  const project = flags.get('--project') ?? DEFAULT_PROJECT_RULE;
  if (!(PROJECT_RULES as readonly string[]).includes(project)) return usage(`--project ${project}; one of ${PROJECT_RULES.join(', ')} is required`);
  const edges = pageEdgesOf(flags.get('--page-edges'));
  if (!isPageEdges(edges)) return usage(edges);
  const shape = packShapeOf(flags.get('--pack-shape'));
  if (!isPackShape(shape)) return usage(shape);
  const keys = idleKeysOf(flags.get('--idle-keys'));
  if (!isIdleKeys(keys)) return usage(keys);
  const loop = on.has('--loop');
  const leadText = flags.get('--lead-in');
  if (leadText !== undefined && !/^[1-9][0-9]*$/.test(leadText)) return usage(`--lead-in ${leadText}; a whole number of idle periods, 1 or more, is required`);
  if (leadText !== undefined && !loop) return usage('--lead-in needs --loop; it says which frames the loop is encoded from');
  const [config, source, full, out] = ['--config', '--source', '--full', '--out'].map((f) => flags.get(f) as string);
  const head = flags.get('--head') ?? null;
  let bin: string;
  try {
    bin = findRigc(import.meta.dir, process.env.PATH ?? '');
  } catch (err) {
    return printRefusal(err);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'rig-parts-build-'));
  try {
    const r = build(
      { config, source, full, head, out, seam: seam as SeamRule, project: project as ProjectRule, loop, pageEdges: edges, packShape: shape, ...(flags.has('--requirements') ? { requirements: flags.get('--requirements') as string } : {}), idleKeys: keys, ...(leadText === undefined ? {} : { leadIn: Number(leadText) }), seamPairs: on.has('--seam-pairs'), keepStills: on.has('--keep-stills'), ...(alts.length === 0 ? {} : { alts }), ...(flags.has('--set') ? { set: flags.get('--set') as string } : {}), allSets: on.has('--all-sets'), ...(flags.has('--environment') ? { environment: flags.get('--environment') as string } : {}) },
      { rig: rigcRunner(bin), check: rigcRunner(bin), checkBin: bin, scratch: join(scratch, 'rig-gate') },
      console.log,
    );
    return r.stoppedAt === null ? EXIT_OK : EXIT_REFUSED;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function cmdCompose(args: string[]): number {
  const f = flags(args, 'compose', ['--scene', '--out']);
  if (typeof f === 'string') return usage(f);
  let bin: string;
  try {
    bin = findRigc(import.meta.dir, process.env.PATH ?? '');
  } catch (err) {
    return printRefusal(err);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'rig-parts-compose-'));
  try {
    const req = f.get('--requirements');
    const accept = f.get('--accept');
    const r = composeStage(
      { scene: f.get('--scene') as string, out: f.get('--out') as string, ...(req === undefined ? {} : { requirements: req }), ...(accept === undefined ? {} : { accept: accept.split(',') }) },
      { rig: rigcRunner(bin), check: rigcRunner(bin), checkBin: bin, scratch: join(scratch, 'gate') },
      console.log,
    );
    return r.stoppedAt === null ? EXIT_OK : EXIT_REFUSED;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function cmdMeshDraft(args: string[]): number {
  // The one switch mesh-draft takes (#295): taken out before the valued flags are read.
  const more = args.filter((a) => a === MORE_TRIANGLES_FLAG).length;
  if (more > 1) return usage(`${MORE_TRIANGLES_FLAG} is given twice`);
  const f = flags(
    args.filter((a) => a !== MORE_TRIANGLES_FLAG),
    'mesh-draft',
    ['--config', '--parts', '--out'],
  );
  if (typeof f === 'string') return usage(f);
  const keys = idleKeysOf(f.get('--idle-keys'));
  if (!isIdleKeys(keys)) return usage(keys);
  const edges = pageEdgesOf(f.get('--page-edges'));
  if (!isPageEdges(edges)) return usage(edges);
  const shape = packShapeOf(f.get('--pack-shape'));
  if (!isPackShape(shape)) return usage(shape);
  let bin: string;
  try {
    bin = findRigc(import.meta.dir, process.env.PATH ?? '');
  } catch (err) {
    return printRefusal(err);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'rig-parts-mesh-draft-'));
  try {
    const req = f.get('--requirements');
    meshDraftStage(
      { config: f.get('--config') as string, parts: f.get('--parts') as string, out: f.get('--out') as string, idleKeys: keys, pageEdges: edges, packShape: shape, ...(req === undefined ? {} : { requirements: req }), ...(more === 1 ? { moreTriangles: true } : {}) },
      rigcRunner(bin),
      bin,
      scratch,
      console.log,
    );
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** `mesh-stats --config <config.json> --parts <dir>` (issue #566): every configured mesh's counts, through the rig stage's own `buildRig`, without rigc. Writes nothing. */
function cmdMeshStats(args: string[]): number {
  const f = flags(args, 'mesh-stats', ['--config', '--parts']);
  if (typeof f === 'string') return usage(f);
  try {
    meshStatsStage({ config: f.get('--config') as string, parts: f.get('--parts') as string }, console.log);
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

/** `remesh` (issue #495): one part of a gated rig re-fitted under a requested mesh entry, into a new revision. */
function cmdRemesh(args: string[]): number {
  // Issue #617: --record-input-check carries no value, so it is taken out before the valued flags are read.
  const record = args.filter((a) => a === '--record-input-check').length;
  if (record > 1) return usage('--record-input-check is given twice');
  const f = flags(args.filter((a) => a !== '--record-input-check'), 'remesh', ['--rig', '--config', '--parts', '--part', '--out']);
  if (typeof f === 'string') return usage(f);
  if (f.has('--mesh') === f.has('--delta')) return usage('remesh needs exactly one of --mesh, --delta');
  const keys = idleKeysOf(f.get('--idle-keys'));
  if (!isIdleKeys(keys)) return usage(keys);
  const edges = pageEdgesOf(f.get('--page-edges'));
  if (!isPageEdges(edges)) return usage(edges);
  const shape = packShapeOf(f.get('--pack-shape'));
  if (!isPackShape(shape)) return usage(shape);
  let bin: string;
  try {
    bin = findRigc(import.meta.dir, process.env.PATH ?? '');
  } catch (err) {
    return printRefusal(err);
  }
  const runner = rigcRunner(bin);
  const said = runner(['--version']);
  const rigcVersion = said.status === 0 ? (said.out.trim().split('\n')[0] ?? '') : '';
  if (rigcVersion === '') return printRefusal(new PartsError([{ code: 'REMESH_RIGC_GREEN', object: 'rigc --version', detail: `exited ${said.status}${rigcRanClause(said)}; the provenance names the rigc that gated the revision, so its version is required` }]));
  const scratch = mkdtempSync(join(tmpdir(), 'rig-parts-remesh-'));
  try {
    const req = f.get('--requirements');
    const ic = f.get('--input-check');
    remeshStage(
      { rig: f.get('--rig') as string, config: f.get('--config') as string, parts: f.get('--parts') as string, part: f.get('--part') as string, ...(f.has('--mesh') ? { mesh: f.get('--mesh') as string } : { delta: f.get('--delta') as string }), out: f.get('--out') as string, idleKeys: keys, pageEdges: edges, packShape: shape, ...(req === undefined ? {} : { requirements: req }), ...(ic === undefined ? {} : { inputCheck: ic }), ...(record === 1 ? { recordInputCheck: true } : {}) },
      runner,
      bin,
      { parts: version(), rigc: rigcVersion },
      scratch,
      console.log,
    );
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** `retune` (issue #527): the constraints and the idle a config states, spliced onto a gated rig, into a new revision. */
function cmdRetune(args: string[]): number {
  // Issue #617: --record-input-check carries no value, so it is taken out before the valued flags are read.
  const record = args.filter((a) => a === '--record-input-check').length;
  if (record > 1) return usage('--record-input-check is given twice');
  const f = flags(args.filter((a) => a !== '--record-input-check'), 'retune', ['--rig', '--config', '--parts', '--out']);
  if (typeof f === 'string') return usage(f);
  const keys = idleKeysOf(f.get('--idle-keys'));
  if (!isIdleKeys(keys)) return usage(keys);
  const edges = pageEdgesOf(f.get('--page-edges'));
  if (!isPageEdges(edges)) return usage(edges);
  const shape = packShapeOf(f.get('--pack-shape'));
  if (!isPackShape(shape)) return usage(shape);
  let bin: string;
  try {
    bin = findRigc(import.meta.dir, process.env.PATH ?? '');
  } catch (err) {
    return printRefusal(err);
  }
  const runner = rigcRunner(bin);
  const said = runner(['--version']);
  const rigcVersion = said.status === 0 ? (said.out.trim().split('\n')[0] ?? '') : '';
  if (rigcVersion === '') return printRefusal(new PartsError([{ code: 'RETUNE_RIGC_GREEN', object: 'rigc --version', detail: `exited ${said.status}${rigcRanClause(said)}; the provenance names the rigc that gated the revision, so its version is required` }]));
  const scratch = mkdtempSync(join(tmpdir(), 'rig-parts-retune-'));
  try {
    const req = f.get('--requirements');
    const ic = f.get('--input-check');
    retuneStage(
      { rig: f.get('--rig') as string, config: f.get('--config') as string, parts: f.get('--parts') as string, out: f.get('--out') as string, idleKeys: keys, pageEdges: edges, packShape: shape, ...(req === undefined ? {} : { requirements: req }), ...(ic === undefined ? {} : { inputCheck: ic }), ...(record === 1 ? { recordInputCheck: true } : {}) },
      runner,
      bin,
      { parts: version(), rigc: rigcVersion },
      scratch,
      console.log,
    );
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * `painting --keypoints <k.json> [--person <id>] <painting.png>` (issue #350): what the painting must be before
 * See-through runs on it, read off its pixels and the body-18 joints `propose --keypoints` reads. Writes nothing.
 */
function cmdPainting(args: string[]): number {
  const flags = new Map<string, string>();
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      paths.push(a);
      continue;
    }
    if (!takesValued('painting', a)) return usage(notTaken('painting', a));
    const value = args[i + 1];
    if (value === undefined) return usage(`${a} needs a value`);
    if (flags.has(a)) return usage(`${a} is given twice`);
    flags.set(a, value);
    i++;
  }
  const kpPath = flags.get('--keypoints');
  if (kpPath === undefined) return usage('painting needs --keypoints <file>, the body-18 joints of the figure in painting px (the file propose --keypoints reads)');
  if (paths.length !== 1) return usage(`painting takes one painting path; got ${paths.length}`);
  const source = paths[0];
  try {
    if (!existsSync(source)) throw new PartsError([{ code: 'PAINTING_SOURCE_PRESENT', object: source, detail: 'no such file; the painting to check is required' }]);
    let painting: ReturnType<typeof readPng>;
    try {
      painting = readPng(source);
    } catch (err) {
      throw new PartsError([{ code: 'PAINTING_SOURCE_DECODES', object: source, detail: `${(err as Error).message}; a PNG is required` }]);
    }
    const kp = loadKeypoints(kpPath);
    checkImageSize(kp, painting.width, painting.height, kpPath, source);
    const person = choosePerson(kp, flags.get('--person'), kpPath);
    console.log(`rig-parts painting: ${source}, joints from ${kpPath} person "${person.id}" (source: ${kp.source})`);
    const r = checkPainting(painting, person, source, kpPath);
    for (const l of r.lines) console.log(l);
    if (r.problems.length > 0) throw new PartsError(r.problems);
    console.log('  PASS  the painting holds every requirement this check reads (docs/PAINTING.md); what only an eye reads is listed there');
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

function main(argv: string[]): number | Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    return command === undefined ? EXIT_USAGE : EXIT_OK;
  }
  if (command === '--version' || command === '-v') {
    console.log(version());
    return EXIT_OK;
  }
  if (command === 'layers') return cmdLayers(rest);
  if (command === 'sheet') return cmdSheet(rest);
  if (command === 'rig') return cmdRig(rest);
  if (command === 'propose') return cmdPropose(rest);
  if (command === 'compare') return cmdCompare(rest);
  if (command === 'check') return cmdCheck(rest);
  if (command === 'loop') return cmdLoop(rest);
  if (command === 'assemble') return cmdAssemble(rest);
  if (command === 'inputs') return cmdInputs(rest);
  if (command === 'comfy') return cmdComfy(rest);
  if (command === 'build') return cmdBuild(rest);
  if (command === 'compose') return cmdCompose(rest);
  if (command === 'mesh-draft') return cmdMeshDraft(rest);
  if (command === 'mesh-stats') return cmdMeshStats(rest);
  if (command === 'remesh') return cmdRemesh(rest);
  if (command === 'retune') return cmdRetune(rest);
  if (command === 'painting') return cmdPainting(rest);
  if (command === 'guide') return cmdGuide(rest);
  const later = LATER.find(([name]) => name === command);
  if (later !== undefined) {
    console.log(`  FAIL  NOT_IMPLEMENTED: \`rig-parts ${command}\` (${later[1]}) is not implemented in this version, ${version()}${guidePointer('NOT_IMPLEMENTED')}`);
    return EXIT_USAGE;
  }
  return usage(`unknown command "${command}"`);
}

process.exit(await main(process.argv.slice(2)));
