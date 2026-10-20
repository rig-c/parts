# Interface stability

This page states what **1.0.0 holds stable**, and what it does not. Every item is
read off the tree: the command and flag lists below are held to
`cli.ts`, and the config field list to the loader in `src/config.ts`, by the
selftest's `TY13` and `TY14` (the `tree` suite), so neither list can drift from the
code without a red run. What changed for an author coming from 0.16.0 is
[MIGRATION.md](MIGRATION.md).

## What "stable" means here

From 1.0.0 the package follows semantic versioning over the items on this page. A
stable item is not removed, renamed, or given another meaning inside a major
version; a new command, flag, optional config field, report key or refusal may
arrive in a minor version, because a reader written against the old surface still
reads it. A refusal may be retired in a minor version when what it refused becomes
accepted (0.13.0 retired two ik refusals that way, when rig-c's parser took them
over).

The list was frozen for review at the release candidate 1.0.0-rc.1, and 1.0.0 was
promoted from it after the owner's acceptance of the production evidence (issue #126,
item 7; `docs/evidence/production-trial.md` in the repository). Every interface
change between the two is additive, and [MIGRATION.md](MIGRATION.md)'s *Since
1.0.0-rc.1* names each one, with the build bytes that moved.

Bytes are a separate promise, and a narrower one: **one version of this package
with one installed rig-c writes the same bytes for the same inputs** (*Determinism*
below). A build's bytes are not promised across versions. A later version may move
them, and when it does, the change that moves them declares which bytes and why (the
winding change of #133 is the example: [MIGRATION.md](MIGRATION.md)).

## Commands and flags

Exit codes are part of the interface: **0** the command did what it says, **1** it
refused its input (every reason a `FAIL` line), **2** a usage error or a command
this version does not implement. No command is unimplemented at 1.0.0 (`LATER`
in `cli.ts` is empty). A refusal line has the shape
`  FAIL  <RULE>: <object> — <value found>; <value required> (see rig-parts guide <RULE>)`:
the rule name is a stable identifier, the pointer at the end is fixed text, and the
detail between them is prose that may be reworded. A command
also answers to the alias `spine-parts` as long as the install keeps it
([MIGRATION.md](MIGRATION.md)). `-h`, `help` and `-v` are the short forms of
`--help` and `--version`. The flags' meanings are `rig-parts --help`'s; their
defaults are the help's too, and none is guessed from the art.

<!-- stable:commands -->
| command | flags |
| --- | --- |
| `layers` | one positional path: a wrapper directory, a `layers.json` or a `.psd`; with it, optional `--export` (a directory to write the wrapper form into, issue #359); or `--template` with `--canvas` and no path |
| `sheet` | `--source`, `--layers` (repeatable), `--out`; optional `--cell`, `--cols` |
| `inputs` | `--source`, `--config`, `--out` |
| `comfy` | `paint`: `--config`, `--out`; optional `--seeds`, `--seed0`, `--host`, `--wait`, `--timeout`, `--poll` |
| `comfy` | `seethrough`: `--image`, `--out`; optional `--resolution`, `--steps`, `--seed`, `--prefix`, `--offload`, `--lama`, `--nf4`, `--host`, `--wait`, `--timeout`, `--poll` |
| `assemble` | `--propose-plan` with `--source`, `--full`, `--config`, optional `--head`; or `--source`, `--full`, `--config`, `--out`, optional `--head` (without it, one run: issue #359), `--seam` (near-white, silhouette), `--project` (core, visible), `--alt` (repeatable `<name>=<source>:<full>[:<head>]`, issue #454) |
| `propose` | `--head-box` with `--full`, `--canvas`; optional `--no-back-hair` |
| `propose` | `--parts`, `--source`, `--out`; optional `--compare` or `--from-config` (one of them), `--keypoints`, `--person` and `--wrist-snap` (each with `--keypoints`), `--full`, `--head` (the turn control's depths; not with `--from-config`), `--grid-rule` (`figure` or `part`, the drafted lattice's spacing; not with `--from-config`), `--cloth` (a config whose `cloth` block is the recipe, issue #364; not with `--from-config`), `--write-config` (a new file, with `--cloth` and not with `--from-config`, issue #537 — additive: without it nothing `propose` writes changes) |
| `compare` | `--left`, `--right`; optional `--map` |
| `rig` | `--config`, `--parts`, `--out`; optional `--idle-keys` (ctl, direct), `--page-edges` (pot, free), `--pack-shape` (rect, polygon) |
| `check` | `--rig`, `--out`; optional `--parts`, `--source`, `--page-edges`, `--pack-shape`, `--requirements`, `--seam-pairs`, `--keep-stills`, `--set` or `--all-sets` (issue #454), `--environment` (issue #538, additive) |
| `loop` | `--frames`, `--out`; optional `--palette` |
| `build` | `--config`, `--source`, `--full`, `--out`; optional `--head` (as for `assemble`), `--seam`, `--project`, `--page-edges`, `--pack-shape`, `--loop`, `--lead-in`, `--requirements`, `--idle-keys`, `--seam-pairs`, `--keep-stills`, `--alt` (as for `assemble`, issue #454), `--set` or `--all-sets` (as for `check`, issue #454), `--environment` (as for `check`, issue #538, additive) |
| `compose` | `--scene`, `--out`; optional `--requirements`, `--accept` |
| `mesh-draft` | `--config`, `--parts`, `--out`; optional `--requirements`, `--idle-keys` (ctl, direct), `--page-edges` (pot, free), `--pack-shape` (rect, polygon), `--more-triangles` |
| `remesh` | `--rig`, `--config`, `--parts`, `--part`, `--out`, and one of `--mesh` or `--delta` (issue #526); optional `--requirements`, `--idle-keys` (ctl, direct), `--page-edges` (pot, free), `--pack-shape` (rect, polygon) |
| `retune` | `--rig`, `--config`, `--parts`, `--out`; optional `--requirements`, `--idle-keys` (ctl, direct), `--page-edges` (pot, free), `--pack-shape` (rect, polygon) |
| `painting` | one positional path, the painting; `--keypoints`; optional `--person` |
| `guide` | one positional argument: a rule name, `§<n>`, `§<n>.<m>` or `§<n>.<m>.<k>` |
| (none) | `--version`, `--help` |
<!-- /stable:commands -->

`TY13` holds the first column to the commands `cli.ts` dispatches and the set of
flags named anywhere in the table to the set of flags `cli.ts` spells. It holds the
names, not which command takes which flag: that pairing is the CLI's, and the `cli`
suite's controls read it from the help.

## The config contract

`src/config.ts` is the schema and the loader, and
[AUTHORING §3](AUTHORING.md#3-configjson-field-by-field) explains every field. The
rules that make the contract:

- **Every key is known or refused** (`CONFIG_KEY_KNOWN`), a required key that is
  missing is refused by name (`CONFIG_FIELD_PRESENT`), and nothing is defaulted
  from the art. A field absent where absence means "none" (a contour's `stray`, an
  automatic mesh's `minAngle`) is written as that in the report, never filled in.
- **Two open doors, and nothing reads behind them**: `note` and any key ending in
  `_note` hold a string anywhere an object is; any key beginning `x-` with a name
  after it holds any JSON value in the same places. They are not open in `meshes`,
  `regions` or `motion.blink.still`, whose keys are part names.
- **Coordinates** in `bones`, `meshes` and `motion` are rig pixels, y down, origin
  top-left.
- **A mesh is one of three modes**: `grid` (the lattice, what `propose` writes),
  `contour` (the traced outline with declared interior points) or `auto` (the
  automatic mode: the contour mesh at alpha 1 and above reduced by rig-c's
  `reduceMesh` under declared bounds, written only when its motion against the
  unreduced source passes the author's bounds). Two, or none, is
  `CONFIG_MESH_MODE`. The top-level default does not change: `propose` writes
  `grid`, and a config that names no `auto` builds as it did before the mode
  existed.
- **`constraints`** are rig-c's own rig-spec constraints (`RigConstraint` in
  rig-c's `src/rig.ts`), handed to rigc as written; this loader checks their
  `type`, their `name` and that every bone they name resolves.
- **`turn`** (issue #251) adds a control bone `turn` under `root` that nothing
  keys, and carries each part in `depths` by `(pivot − depth) / (pivot − nearest
  depth)` of its x. Without the field no byte of any output moves.
- **`scene`** (issue #242) declares the painting a scene — the figure and what
  is round it — and takes no field: `{}`. With it `assemble` reads the
  recomposite inside the figure (the union of the full run's layers at alpha
  above 8), writes the figure as `figure_rig.png` beside the recomposite and a
  `scene` block in `parts.json`, and `check` leaves the painting's border rows
  and columns out of the seam. Without the field no byte of any output moves.

The fields, object by object (a bold path is where the object sits; `<part>` is a
part name, `[i]` an entry of a list):

<!-- stable:config -->
- **config** — required by the full loader, in front of rig and build: `key`, `assemble`, `bones`, `meshes`, `regions`, `motion`; optional: `generation`, `seethrough`, `limbs`, `constraints`, `stops`, `turn`, `scene`, `cloth`, `proposed_rig_scale`
- **generation** — required: `checkpoint`, `loras`, `trigger`, `identity`, `sampler`, `costume`, `negative_extra`, `style`, `negative_pose`, `latent`, `seed`; optional: `pose`, `control`
- **generation.loras[i]** — required: `name`, `strength`; optional: `strength_clip`
- **generation.sampler** — required: `steps`, `cfg`, `sampler`, `scheduler`
- **generation.control** — required: `skeleton`, `strength`, `end_percent`; optional: `model`
- **generation.control.skeleton**, the pose file it names when it is no built-in — required: `width`, `height`, `points`
- **seethrough** — required: `resolution`, `steps`, `seed`, `offload`; optional: `head_box`, `arm_split`
- **seethrough.arm_split** — required: `order`, and one of `x` or `line` (issue #439)
- **assemble** — required: `rig_scale`, `plan` (from plain `assemble` on); optional: `extend_below_crop`, `patches`, `cuts`, `alternates`, `head_face_underfill`
- **assemble.alternates[i]** — required: `name`; optional: `source`, `full`, `head`, `parts`, `hides`, `head_box`, `cuts`, `skeleton`, `drawn` (issues #454, #465)
- **assemble.extend_below_crop[i]** — required: `part`, `run`, `tag`
- **assemble.patches[i]** — required: `name`, `box`, `alpha`, `draw`
- **assemble.patches[i].draw**, when an object — required: `before`
- **assemble.cuts[i]** — required: `from`, `into`, `polygon`, `draw`, `overlap`; optional: `under`, `under_fill`
- **assemble.cuts[i].draw**, when an object — required: `before`
- **limbs.&lt;limb&gt;** — required: `segments` (issue #349)
- **limbs.&lt;limb&gt;.segments[i]** — required: `part`, `from`, `bone`; required below a joint (i > 0): `joint`; optional below a joint: `range`, `cap`, `edge`, `cap_shape`, `cut_band`
- **bones[i]**, a single bone — required: `name`, `parent`, `at`; optional: `tip`, `inherit`
- **bones[i]**, a chain — required: `chain`, `parent`, `points`, `tip`; optional: `link_inherit`
- **stops[i]** — required: `chain`, `against`, `at`, `inward`, `outward`; optional: `links`, `lower` (issue #404)
- **stops[i].lower** — required: `inward`, `outward`
- **meshes.&lt;part&gt;** — exactly one of `grid`, `contour`, `auto`, `influence`; required in every mode: `segments`, and `r` in every mode but `influence`, which refuses it; optional in every mode: `exponent`, `rule`; optional with `contour` or `auto`: `ribs`; optional with `grid` or `contour`: `influences` (issue #284; beside `auto` it is refused, CONFIG_INFLUENCES_MODE); optional with `grid`: `stray` (issue #303; beside `contour` or `auto` it is refused, CONFIG_STRAY_MODE)
- **meshes.&lt;part&gt;.influence** — required: `cell`, `radius`, `across`, `max`, `shape` (issue #378); beside it `r`, `exponent`, `rule`, `influences`, `stray` and `ribs` are refused by name
- **meshes.&lt;part&gt;.influences** — optional, at least one: `maxInfluences` (a whole number, 1 or more, or null for no cap), `floor` ("cut" or "continuous")
- **meshes.&lt;part&gt;.ribs.&lt;chain&gt;** — required: `stations`
- **meshes.&lt;part&gt;.contour** — required: `tolerance`, `margin`, `spacing`; optional: `maxEdge`, `budget`, `stray`, `bridges`, `regions`, `bust`
- **meshes.&lt;part&gt;.contour.regions[i]** — required: `name`, `shape`, `bone`, `spacing`, `band`, and `cx`, `cy`, `r` for a circle or `points` for a polygon
- **meshes.&lt;part&gt;.contour.bust** — required: `apex_r`, `apex_l`, `cleavage`; optional: `alpha`, `clearance`, `bone_r`, `bone_l`, `spacing` (issue #475)
- **meshes.&lt;part&gt;.auto** — required: `source`, `sourceBounds`, `targets`, `influences`, `budget`, `minArtSamples`, `motion`; optional: `protect`, `regions`, the three Stage B opt-ins `boundaryRuns`, `retriangulate`, `removalOrder`, and `stimulus`
- **meshes.&lt;part&gt;.auto.source** — required: `tolerance`, `margin`, `spacing`; optional: `stray`
- **meshes.&lt;part&gt;.auto.sourceBounds** and **meshes.&lt;part&gt;.auto.targets.artFit** — required: `minCoverage`, `maxOvershoot`, `maxUndercut` (each of the last two a number or null, the bound declared absent)
- **meshes.&lt;part&gt;.auto.targets** — required: `artFit`, `maxBoundaryDeviation`; optional: `minAngle`
- **meshes.&lt;part&gt;.auto.influences** — required: `maxInfluences`, `minWeight`
- **meshes.&lt;part&gt;.auto.budget** — required: `maxCandidates`
- **meshes.&lt;part&gt;.auto.motion** — required: `maxLocalDeformation`; optional: `maxStretch`, `minStretch`, `deformMayFold`, `gradation`, `selection`, `residual`
- **meshes.&lt;part&gt;.auto.motion.selection** — required: `policy`, `maxProbes`
- **meshes.&lt;part&gt;.auto.motion.residual** — required: `maxResidual`
- **meshes.&lt;part&gt;.auto.protect** — optional: `hull`, `vertices`, `edges`, `regionBoundaries`, `weightJump`, `influences`
- **meshes.&lt;part&gt;.auto.regions[i]** — required: `name`, `shape`, `maxEdgeLength`, `transition`, `grade`, `minArtSamples`, and `cx`, `cy`, `r` for a circle or `points` for a polygon; optional: `bone`, `band` (both or neither; with neither the region is density only)
- **meshes.&lt;part&gt;.auto.boundaryRuns** — required: `maxVertices`
- **meshes.&lt;part&gt;.auto.stimulus**, or each entry of it when a list — required: `chain`, `degrees`
- **cloth.&lt;tag&gt;**, the tag bottomwear, back hair or front hair (issue #364; read by propose --cloth only) — required: `chains` (optional on `back hair`, issue #390), `links`, `wind`, `gravity`; optional: `split`, `length_ratio`, `strength`, `damping`, `alternate_damping`, `translate`, `swing` (on bottomwear only), `part` (a string on bottomwear, or a list of parts in root-to-tip order on any tag, issue #437), `parts` (a list of parts in root-to-tip order on any tag, issue #437)
- **cloth.&lt;tag&gt;.split** — required: `at`, `into`; optional: `hold_tip`
- **cloth.&lt;tag&gt;.strength** — required: `trunk`, `branch`, `edge`
- **cloth.&lt;tag&gt;.swing** — required: `scales`
- **regions.&lt;part&gt;** — a bone name
- **motion** — required: `duration`, `tracks`; optional: `blink`, `animations_from`
- **motion.tracks[i]**, a single track — required: `bone`, `prop`, `amp`, `period`, `phase`; optional: `base`
- **motion.tracks[i]**, a chain track — required: `chain`, `amps`, `period`, `phase`, `lag`
- **motion.blink** — required: `t`, `eyes`, `squash`; optional: `brows`, `brow_drop`, `still`
- **motion.blink.still.&lt;part&gt;** — required: `row`, `bone`
- **motion.animations_from**, the file it names — required: `spec`, `animations`
- **turn** — required: `pivot`, `depths`; optional: `deform`, `band`, `radius`, `surface`, `head`
- **turn.depths.&lt;part&gt;** — a See-through depth
- **turn.deform.&lt;key&gt;** — a per-degree fraction or coupling share (FACE_DEFORM_FRACTIONS, issue #436)
- **turn.band**, when an object — optional: `yaw`, `pitch` (issue #472)
- **turn.surface**, when an object — optional: `radius` (issue #479)
- **turn.head**, when an object — optional: `pivot`, `radius` (issues #478, #479)
- **scene** — no field (`{}`; a record or an annotation only)
- **proposal.json**, the file propose writes — `bones`, `meshes`, `regions`, `limbs` under `--keypoints` where an arm or a leg is drafted from its joints (issue #349), `stops` when supplied, `motion` under the rules above, `turn` with `--full`/`--head`, `proposed_rig_scale` (issue #354), and `notes`
<!-- /stable:config -->

`TY14` holds the set of field names in backticks above to the set of names the
loader's object checks spell (every `c.object(…)` in `src/config.ts`, with the lists
they name), in both directions, and refuses an object check whose key list it cannot
read. It holds the names, not their nesting or which are required: the `config`
suite's controls hold those, refusal by refusal.

The values a field takes (`retriangulate` is "delaunay", `removalOrder`
"deformation-load", `selection.policy` "multi-interval"; the units and ranges of
every number) are AUTHORING §3's tables, and the loader refuses any other by name.

## Files this package writes

| file | written by | what is stable |
| --- | --- | --- |
| `parts.json`, `parts/<name>.png` | `assemble`, `build` | one record per part: `from` (`<run>:<tag>` with a See-through v3 tag, `<run>:author:<label>` for a layer the author made — issue #256, read by no role rule — or `painting:<name>` for a patch), `cut_from` on a cut's piece only (the plan part it was cut from, issue #230), `limb` on a limb segment's part only (issue #349: `name`, `segment`, `of`, `bone`, and below a joint `joint`, `range` when the config segment declares one (issue #360), and `cap` — `at`, `width`, `radius`, `box`, `layer_px`, `image_px` with a cap image, `image_layer` after it when that image was a hidden-art layer — issue #359, `<run>:<layer>:hidden` — `missing_px`, then `shape` and `upper_px` under the segment's `cap_shape`, and `edge`, `feather_radius` and `feathered_px` under its `edge`, and `cut_band`, `cut_offset`, `cut_at`, `cut_crossed`, `joint_crossed`, `band_px` and `stroke_luma_max` (when the band has a split) under its `cut_band`, issue #360), the box `x`, `y`, `w`, `h` (rig px), the pixel counts `src/parts.ts` documents (`opaque_px`, `visible_px`, `occluded_px`, `projected_core_px`, `source_px_taken`, `visible_not_projected_px`, `refused_drift_px`, `merged_px`, `seam_override_px`, and `fringe_pushed_back` when not empty); `rig_size`, `scale_rig_per_source`, `ghost_px`, `recomposite`, and `scene` (`figure_alpha_above`, `figure_px`, `figure_mask`) under `config.scene` only, with the figure's mask `figure_rig.png` beside the recomposite (issue #242); `single_run_pad` (`file_size`, `side`, `left`, `top`) last, only for one run whose file is not the `seethrough.resolution` square (issue #366) |
| `rig/rig.json`, `rig/motion.json`, `rig/images/` | `rig`, `build`, `compose` | rig-c's rig spec and motion spec, `spec` `rigc-rig/1` and `rigc-motion/1`: the format is rig-c's, and this package writes only what rig-c's parser accepts; a bone carries `inherit` only where config.bones declares one, rig-c's mode name as written (issue #348) |
| `rig/mesh_report.json` | `rig`, `build` | one row per mesh: `part`, `vertices`, `triangles`, `hull`, `bones`, `max_influences`, `mean_influences`, `art_coverage`, then `grid` (a lattice); `mode` "contour" with `params`, `contour`, `regions` (`params.maxEdge` and `contour.outlineCut` only when the mesh declares `contour.maxEdge`; `params.bridges` and `contour.bridges` — `islands`, `units`, `joins`, and `faint` only when an island was left out as faint — only when it declares `contour.bridges`); or `mode` "influence" with `influence` (as declared), `reach` (`farthest`, `at`, `nearest`, `capped`, `widest`) and `lattice` (rig-c's `SegmentsLatticeReport`: `cols`, `rows`, `artCells`, `keptCells`, `passes`, `islands`) (issue #378); or `mode` "auto" with `settings`, `source`, `result`, `residuals`, `worst_residual`, `worst_region`, `motion_amplitude`, `termination`, `weights`, `regions`, `deformation`, `quality_report` (rig-c's `mesh-quality-report/1` document whole), `motion_report`, and, only when they apply, `stray_cleared` (after `source`, when `source.stray` is declared), `skinning_residual` and `replay` (`AutoMeshReport` in `src/rig.ts`); in every mode, `exponent` when the mesh declares one (after `grid`, or after `mode`); `influences`, as declared, when a lattice or contour mesh declares it (after `exponent`, or where `exponent` would be); `stray` and `stray_cleared` when a lattice mesh declares `stray` (after `influences`, or where `influences` would be); `ribs` when a contour or auto mesh declares them (after `exponent`, or after `mode`), and then `contour.ribs` (`source.contour.ribs` in the automatic mode) |
| `check/check.json` and the rest of `check/` | `check`, `build`, `compose` | the reference's fields in its order (`gate_spine_html_green`, `rigc_entry`, `pack_mode`, `environment` after it under `--environment` only (issue #538, additive: `path` as given, `sha256`, `steps`), `loop_max_diff`, the seam figures — `seam_mean`, `seam_px_over_40`, `seam_px_over_80` and, from issue #216, `seam_frame_scale`, the frame scale the bar divides the count by), `loop_physics` after `loop_max_diff` when the rig declares a physics constraint, `seam_border` after the seam figures when `parts.json` declares a scene (issue #242), `seam_pairs` after the seam figures when the seam bar fails or `--seam-pairs` asks (each row's picture under `check/seam/`; `--keep-stills` leaves the setup-pose still and its `frames.json` under `check/setup_still/`), then the judgement lines (`BREATH_VISIBLE`, `BLINK_NO_HOLE`, `CHAIN_LAG`, `TIP_OVER_ROOT`, `STILL_REGIONS_DARK`, `TEXTURE_STRETCH`), `ANIMATIONS_DO_NOT_FOLD` after them when `motion.json` holds an animation, the idle included — on every rig with an idle since issue #333 (issues #320, #363: `status`, `animations`, `fps`, `physics_left_out`, `folding` — each `animation`, `slot`, `attachment`, `frames`, `worst_frame`, `worst_triangles`, `triangles`, `physics_on`, `physics_off`, `physics_constraints`, `declared`, `line` — `folding_undeclared`, `declared_not_folding`, `bar`), `FEET_STAY_LEVEL` after it when a `footwear` part rides a bone that hangs from another and `motion.json` holds an animation (issue #348: `status`, `reason` on a SKIP only, `animations`, `fps`, `physics_left_out`, `bar_degrees`, `bar`, `feet` — each `part`, `bone`, `hangs_from`, `status`, `frames_posed`, `worst`), `LIMB_ONE_BONE` after it (and after `STRESS_OFF_CHAIN` where that is written) when `parts.json` holds a limb segment's part (issue #349: `status`, `parts` — each `part`, `limb`, `bone`, `status`, `others`), `SEAM_OVER_RANGE` after it when a limb record carries a `range` (issue #360: `status`, `frame_scale`, `physics_left_out`, `bar` — `mean`, `rig_px_over_40`, `level` — and `joints`, each `part`, `limb`, `segment`, `joint`, `bone`, `range`, `at`, `radius`, `under_px`, `status`, `poses` — each `degrees`, `status`, `mean`, `px_over_40`, `px_over_80`, `rig_px_over_40` — and `unread` on a joint not read), `SEAM_OVER_MOTION` after it when `parts.json` holds a limb segment or `--requirements` a `seam` (issue #493, a warning and not a bar: `status` — `WARN`, `CLEAR` or `SKIP` — `reason` on a SKIP only, `fps`, `floor`, `pairs` — each `pair`, `a`, `b`, `declared`, and `unread` on a pair not read — `animations`, `warnings`, `rows` — each `pair`, `animation`, `status`, `drawn`, `banded`, `opens`, `px`, `max_px`, `under_floor`), `CLOTH_SETTLES` after it when the rig declares a physics constraint and has an idle (issue #501, a warning and not a bar: `status` — `WARN` or `CLEAR` — `fps`, `frames`, `duration`, `floor_rig_px_per_s`, `floor`, `levers`, `warnings`, `rows` — each `tip`, `root`, `links`, `point`, `settles_at`, `max_rig_px_per_s`, `min_rig_px_per_s`), `RECOMPOSITE_HOLES` (its first figure `declared_scene` when `parts.json` declares a scene), `SETUP_POSE_VS_SOURCE`, `skipped`, a `requirements` block under `--requirements`, and `PASS`; `check/build/skeleton.json`, `.atlas` and `.png` are the packed artifact rig-c writes |
| `layers.json`, `<index>_<name>.png` | `layers --export` | the wrapper form `layers` reads (issue #359): `width`, `height`, then `layers` — each `name`, `filename`, `left`, `top`, `right`, `bottom`, `depth_median` (the input's own; `null` for a PSD, the manifest's order then being the draw order) — drawn layers in draw order, then the hidden-art layers; a PNG's name is its index and its layer's name, and the manifest, not the file name, says which layer it is |
| the template `.psd` | `layers --template` | one empty layer per name `templateLayerNames` (`src/layers.ts`) holds, bottom first; the same canvas writes the same bytes |
| `proposal.json`, `render/landmarks*.png` | `propose` | the config's four rig sections, `constraints` with `--cloth` (issue #364: a physics constraint per tree link named `<bone>_physics`, a dangling end's `<bone>_translate`, and a skirt swing's transforms `<swing>_<tree>`), `turn` with `--full`/`--head`, `proposed_rig_scale` (issue #354), and `notes` |
| `basis.json` | `propose` | spec `spine-parts-basis/1` |
| the `--write-config` file | `propose --cloth … --write-config` | the `--cloth` config read, byte for byte, but for the entries the recipe drafts (issue #537), measured against the same parts drafted without it: `meshes.<part>` and `regions.<part>` for each part the recipe moves, and `bones`, `constraints` and `motion.tracks` entry by entry by name (issue #552) — an entry the recipe drafts replaced or inserted, one it replaces removed, every other entry kept with its bytes and its place, and a hand edit to an entry the recipe owns refused by name (`PROPOSE_WRITE_CONFIG_CONFLICT`) rather than dropped; a section the input lacks is inserted |
| `config.json`, `mesh_draft.json` | `mesh-draft` | `config.json` is the config read, byte for byte, but for each drafted part's `meshes` entry; `mesh_draft.json` is spec `rig-parts-mesh-draft/1`: `rules`, `lattice_check`, `draft_check`, `figure_overdraw`, and per lattice part `part`, `mode`, `lattice`, `candidate` (with `bridges` — `units`, `joins` of `span` and `area_px2`, `area_px2`, `overdraw`, and `faint` only when an island was left out as faint — only when the candidate is a bridged one, issue #326), `delta` (under `--more-triangles` only), `readings`, `gate` (each line's `reading`, `pass`, `text`, `margin`), `note`; and `not_compared` (issue #307), only when the config holds an `auto` or `contour` entry: per such entry, in config order, `part`, `mode` and `note` — the part was neither drafted nor compared, and a config of lattices alone writes no such key |
| `rig.json`, `motion.json`, `mesh_report.json`, `images/`, `remesh.json` | `remesh` | the input revision's files, `rig.json` and `mesh_report.json` with the part's attachment and row replaced (under `--delta` the row is the input's with its counts, `bones` and influences recomputed and `mode` "delta"), every other file byte for byte; `remesh.json` is spec `rig-parts-remesh/1`: `request` (`part`, `mesh`, `mesh_sha256`, `idle_keys`, `page_edges`, `pack_shape`; under `--delta`, issue #526: `part`, `delta` — the mesh edit as read — `delta_sha256`, `ops`, `applied` — `moved`, `added`, `removed`, `constrained` — `idle_keys`, `page_edges`, `pack_shape`), `versions` (`parts`, `rigc`), `input` (`rig` — `path`, `bytes`, `sha256` per file — `config_sha256`, `parts_json_sha256`), `baseline` (`reproduced`, `not_compared`; under `--delta` `reproduced` holds one sentence: no config is built, the input is the baseline), `target` (`before`, `after`: `vertices`, `triangles`, `hull`), `preserved` (`identical`, `spliced`), `revision` (per file as `input.rig`), `check` (`input`, `revision`: `pass`, `measured`, `not_met`, `skipped`, `physics`; `scope`) |
| `rig.json`, `motion.json`, `mesh_report.json`, `images/`, `retune.json` | `retune` | the input revision's files, `rig.json` with `constraints` and `invariants.detached` replaced and `motion.json` with `animations.idle` replaced by the config's build, every other file byte for byte; `retune.json` is spec `rig-parts-retune/1`: `request` (`idle_keys`, `page_edges`, `pack_shape`), `versions` (`parts`, `rigc`), `input` (`rig` — `path`, `bytes`, `sha256` per file — `config_sha256`, `parts_json_sha256`), `held` (`compared`, `not_compared`), `changed` (`constraints` — each `name`, `type`, `fields` — `added`, `removed`, `idle`: `tracks_changed`, `duration` as before and after), `preserved` (`identical`, `spliced`), `revision` (per file as `input.rig`), `check` (`input`, `revision`: `pass`, `measured`, `not_met`, `skipped`, `physics`; `scope`) |
| the scene report | `compose` | spec `spine-parts-scene-report/1` |
| `idle.png`, `idle-indexed.png`, `idle.gif` | `loop`, `build --loop` | APNG and GIF encodings of the rendered idle |

Files authors write for this package, each with a spec id the reader holds:
`spine-parts-requirements/1` (`check --requirements`), `spine-parts-scene/1`
(`compose --scene`), `spine-parts-keypoints/1` (`propose --keypoints`),
`spine-parts-bonemap/1` (`compare --map`); and one another tool writes, read as that tool defines it: rig-c/review's `rig-review-mesh-edit/1` (`remesh --delta`). The spec ids keep the package's former
name on purpose: they name a file format, not the tool, and a file written before
the rename still reads. They do not change at 1.0.

## Environment

The installed package reads two environment variables and no other: `PATH`, where
the launcher finds Bun and the CLI finds the `rigc` its own `node_modules` holds,
and `COMFY_HOST`, which `comfy paint` and `comfy seethrough` read when `--host` is
not given (it has no default). `RIG_PARTS_CORPUS` and `RIG_PARTS_SELFTEST_JOBS`,
with their former `SPINE_PARTS_` names read when they are not set, are the
selftest's, a development interface of this repository: the selftest does not ship
in the package.

## rig-c

`dependencies` takes `rig-c` `^2.33.0`: 2.33.0 or any later 2.x. Bun 1.2 or later
runs the package (`engines`). What this package relies on in rig-c, every import
read off `src/` and `cli.ts`:

- the named entries `rig-c/mesh` (the outline functions, `measureAuthoredMeshFit`,
  `reduceMesh`, `skinningEnvelopeBone`, `writeMeshQualityReport` and their types)
  and `rig-c/meshcompare` (`compareMeshesInMotion`);
- the deep paths its `exports` map carries: `rig-c/src/rig.ts` (`parseRigSpec`,
  `RIG_SPEC_VERSION`, the constraint keys), `rig-c/src/errors.ts`,
  `rig-c/src/png.ts`, `rig-c/src/transform.ts` (the y flip, through
  `src/coords.ts` only), `rig-c/tools/plate.ts` (the PNG codec) and
  `rig-c/tools/font5x7.ts`;
- the `rigc` command: `build` and `render`, and `--version`, whose `entry:` line
  says which validator gated a build (`check.json`'s `rigc_entry`).

A rig-c release that moves any of these breaks this package by name, and the
install smoke is where that shows first. No Spine runtime is a dependency: an
install is gated by rigc's own validator, and `@esotericsoftware/spine-core` is a
development dependency of this repository only.

## What is not stable

- **The evidence documents** under `docs/evidence/`: their layout, columns and
  figures are a measurement record of one tree on one rig-c, regenerated when the
  tools or rig-c move.
- **The tools** under `tools/` (the matrix, the surveys, the comparisons) and their
  command lines, and the scripts under `scripts/`.
- **The selftest**: its control names, counts and line wording.
- **Console prose** beyond the shapes above: the detail after a rule name, the
  wording of a note, the order of informational lines.
- **The examples' `expected/` outputs**: they are this repository's regression
  record and move with any change that declares a byte move.
- **Bytes across versions**, as stated at the top.

## Bounded time, and what the checks cost

The automatic mode's search is bounded by counts the author declares or the call
derives, never by a clock (`src/` reads none): rig-c's `reduceMesh` tries at most
`budget.maxCandidates` steps, the acceptance loop replays at most ⌈log₂(N − I)⌉
removal steps (N the call's accepted operations, I the refinement's), and the
multi-interval selection at most `motion.selection.maxProbes`, each replay one
unpacked gated build and one motion comparison. Wall time is therefore a property of
the input and the machine. Measured: the evidence tools run every cell under a
600 s cap and a whole matrix under 2,700 s (`docs/evidence/auto-mesh-matrix.md`,
*re-running*); one `reduceMesh` call on the public parts took 0.7 s to 10.7 s at
rig-c 2.23.0 (the same document's quiet timing table, a remote WSL runner, pool,
load under 2); at rig-c 2.31.0 the whole rig stage of one automatic part, motion
gate and acceptance loop included, took 1.1 s to 61.6 s on the eight parts the
surveys switch, reference-demo `bottomwear` the slowest at 12 gated builds, with a run-to-run
spread of ±15 % on that part (pull request #152's paired exclusive timing, remote
20-core runner; the surveys print wall time to standard error, not into the
documents). On CI (`ubuntu-latest`), the last two green runs on `main` took 4 min
54 s and 8 min 28 s for the full selftest (842 controls over 45 suites at
`22b2c5a`, with the public examples fetched; the job's limit is 20 minutes) and
42 s and 41 s for the install smoke (6 cases; limit 10 minutes), at `8be4cd1` and
`22b2c5a` respectively. None of these figures is a promise: they are what the named
runs measured.

## Determinism

The same inputs, with the same version of this package and the same installed
rig-c, write the same bytes: fixed key order in every JSON written, stable sorts, no
clock, no randomness and no locale-sensitive formatting. `src/` is pure outside
`src/comfy/` (`TY06` refuses a clock, randomness or network call anywhere else under
`src/`). The selftest holds it by running the same thing twice and comparing the bytes:
`PN01` (the PNG codec), `PT01` (`parts.json` round trip), `AS07` (`assemble`
from the CLI), `SK04` (the skeleton), `RG03` (two lattice builds), `CW20` and
`CT20` (a contour rig and a contour mesh), `AM24` (an automatic mesh), `MO11`,
`MO27`, `MO44`, `MO50`, `MO63` and `MO74` (the motion gate, the acceptance
loop's replay, every Stage B opt-in, a gradation, the multi-interval selection's
policy path and the residual veto), `CK02`, `CK33` and `CK79` (`check`, its
stretch geometry, and `check --requirements`), `DG13` (`basis.json`), `LP08`
(the indexed APNG) and `ST26` (the `compare` printout). With the public examples
fetched, the `chain` suite builds each of them and holds `parts.json`
(`CH02`), `rig.json`, `motion.json` and `mesh_report.json` (`CH03`),
`check.json` (`CH04`) and the gate file (`CH05`) to its tracked `expected/`,
field by field, with the tolerances `CH07` plants against.
