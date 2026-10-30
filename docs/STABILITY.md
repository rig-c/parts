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
detail between them is prose that may be reworded. Existing named or child core
guide pointers in relayed compile-error text are preserved verbatim. Only a bare
core compile-error line receives `(see rigc guide §5.1)` inside the enclosing
rig-parts refusal; no core error code is invented. A command
also answers to the alias `spine-parts` as long as the install keeps it
([MIGRATION.md](MIGRATION.md)). `-h`, `help` and `-v` are the short forms of
`--help` and `--version`. The flags' meanings are `rig-parts --help`'s; their
defaults are the help's too, and none is guessed from the art.

<!-- stable:commands -->
| command | flags |
| --- | --- |
| `layers` | one positional path: a wrapper directory, a `layers.json` or a `.psd`; with it, optional `--export` (a directory to write the wrapper form into, issue #359); or `--template` with `--canvas` and no path; or a positional head run with `--full`, `--source`, `--config` together for `PLAN_HEAD_GARMENT_OVERLAP` (issue #826) |
| `sheet` | `--source`, `--layers` (repeatable), `--out`; optional `--cell`, `--cols` |
| `inputs` | `--source`, `--config`, `--out` |
| `comfy` | `paint`: `--config`, `--out`; optional `--seeds`, `--seed0`, `--host`, `--wait`, `--timeout`, `--poll` |
| `comfy` | `seethrough`: `--image`, `--out`; optional `--resolution`, `--steps`, `--seed`, `--prefix`, `--offload`, `--lama`, `--nf4`, `--host`, `--wait`, `--timeout`, `--poll`, `--config` (optional depth block), `--depth-run` (`full` or `head`, required with the block) |
| `assemble` | `--propose-plan` with `--source`, `--full`, `--config`, optional `--head`, `--write-config` (must name `--config` itself, issue #356); or `--source`, `--full`, `--config`, `--out`, optional `--head` (without it, one run: issue #359), `--seam` (near-white, silhouette), `--project` (core, visible), `--alt` (repeatable `<name>=<source>:<full>[:<head>]`, issue #454) |
| `propose` | `--head-box` with `--full`, `--canvas`; optional `--no-back-hair`, `--write-config` (existing config, issue #356) |
| `propose` | `--parts`, `--source`, `--out`; optional `--compare` or `--from-config` (one of them), `--keypoints`, `--person` and `--wrist-snap` (each with `--keypoints`), `--full`, `--head` (the turn control's depths; not with `--from-config`), `--grid-rule` (`figure` or `part`, the drafted lattice's spacing; not with `--from-config`), `--cloth` (a config whose `cloth` block is the recipe, issue #364; not with `--from-config`), `--write-config` (existing config for an ordinary proposal, issue #356; a new file with `--cloth`, issue #537; not with `--from-config` — additive: without it nothing `propose` writes changes), `--from` (the config the recipe is changed from, only with `--write-config`, issue #571 — additive: without it nothing `--write-config` writes changes), `--only-missing` (only with `--parts` and `--write-config`, not with `--cloth` or `--from-config`, issue #671 — additive: without it nothing `--write-config` writes changes) |
| `propose` | `--parts`, `--source`, `--out`, `--full`, `--head`, `--write-config` together: the [neck draft](AUTHORING.md#a-neck-that-moves-on-its-own) for an existing config with `turn.body` and one neck plan row; reassembles under `<out>/rig`, preserves the sampled turn and drafts a rigid neck unit (issue #826) |
| `compare` | `--left`, `--right`; optional `--map` |
| `rig` | `--config`, `--parts`, `--out`; optional `--idle-keys` (ctl, direct), `--page-edges` (pot, free), `--pack-shape` (rect, polygon) |
| `check` | `--rig`, `--out`; optional `--parts`, `--source`, `--page-edges`, `--pack-shape`, `--requirements`, `--seam-pairs`, `--keep-stills`, `--no-extremes` (issue #829), `--set` or `--all-sets` (issue #454), `--environment` (issue #538, additive), `--wind-band` (issue #590, additive) |
| `loop` | `--frames`, `--out`; optional `--palette` |
| `build` | `--config`, `--source`, `--full`, `--out`; optional `--head` (as for `assemble`), `--seam`, `--project`, `--page-edges`, `--pack-shape`, `--loop`, `--lead-in`, `--requirements`, `--idle-keys`, `--seam-pairs`, `--keep-stills`, `--no-extremes` (issue #829), `--alt` (as for `assemble`, issue #454), `--set` or `--all-sets` (as for `check`, issue #454), `--environment` (as for `check`, issue #538, additive), `--wind-band` (as for `check`, issue #590, additive) |
| `compose` | `--scene`, `--out`; optional `--requirements`, `--accept` |
| `mesh-draft` | `--config`, `--parts`, `--out`; optional `--requirements`, `--idle-keys` (ctl, direct), `--page-edges` (pot, free), `--pack-shape` (rect, polygon), `--more-triangles` |
| `mesh-stats` | `--config`, `--parts` (issue #566, additive: prints, writes nothing) |
| `remesh` | `--rig`, `--config`, `--parts`, `--part`, `--out`, and one of `--mesh` or `--delta` (issue #526); optional `--requirements`, `--idle-keys` (ctl, direct), `--page-edges` (pot, free), `--pack-shape` (rect, polygon), `--record-input-check` and `--input-check` (issue #617, additive: without them nothing `remesh` prints or writes changes) |
| `retune` | `--rig`, `--config`, `--parts`, `--out`; optional `--requirements`, `--idle-keys` (ctl, direct), `--page-edges` (pot, free), `--pack-shape` (rect, polygon), `--record-input-check` and `--input-check` (as for `remesh`, issue #617, additive) |
| `painting` | one positional path, the painting; `--keypoints`; optional `--person` |
| `guide` | one positional argument: a rule name, `§<n>`, `§<n>.<m>` or `§<n>.<m>.<k>` |
| (none) | `--version`, `--help` |
<!-- /stable:commands -->

`TY13` holds the first column to the commands `cli.ts` dispatches, the set of
flags in the table to the flags `cli.ts` spells, and each command's listed flags
to its parser's `TAKES` row in both directions. Repeated proposal modes share one
command's flag union; `comfy paint` and `comfy seethrough` are checked separately.
Required combinations within a mode remain the CLI's; the `cli` suite's controls
read them from the help.

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
  top-left. Explicit mesh UVs are normalized padded-image coordinates, and its weights are bone-local Spine pixels, already y up.
- **A mesh has exactly one mode**: `grid` (the lattice, what `propose` writes),
  `contour` (the traced outline with declared interior points), `influence` (core's lattice and pull), `explicit` (a hash-bound accepted payload) or `auto` (the
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
- **config** — required by the full loader, in front of rig and build: `key`, `assemble`, `bones`, `meshes`, `regions`, `motion`; optional: `generation`, `seethrough`, `limbs`, `constraints`, `stops`, `turn`, `scene`, `cloth`, `proposed_rig_scale`, `requirements` (issue #556, additive: a path beside the config that build reads in place of its requirements flag, whose behaviour is unchanged), `motion_seams`, `depth`, `waist`
- **generation** — required: `checkpoint`, `loras`, `trigger`, `identity`, `sampler`, `costume`, `negative_extra`, `style`, `negative_pose`, `latent`, `seed`; optional: `pose`, `control`
- **generation.loras[i]** — required: `name`, `strength`; optional: `strength_clip`
- **generation.sampler** — required: `steps`, `cfg`, `sampler`, `scheduler`
- **generation.control** — required: `skeleton`, `strength`, `end_percent`; optional: `model`
- **generation.control.skeleton**, the pose file it names when it is no built-in — required: `width`, `height`, `points`
- **seethrough** — required: `resolution`, `steps`, `seed`, `offload`; optional: `head_box`, `arm_split`
- **seethrough.arm_split** — required: `order`, and one of `x` or `line` (issue #439)
- **assemble** — required: `rig_scale`, `plan` (from plain `assemble` on); optional: `extend_below_crop`, `patches`, `cuts`, `alternates`, `head_face_underfill`, `yield_refused`, `keep_under_occluders`, `extend_painting`
- **assemble.alternates[i]** — required: `name`; optional: `source`, `full`, `head`, `parts`, `hides`, `head_box`, `cuts`, `skeleton`, `anchor`, `base_anchor`, `drawn`, `tips`, `front`, `layers`, `focus` (issues #454, #465, #543, #652, #664, #666, #719, #780). `focus` is an authored finite `[x, y]` in painting pixels, within its canvas (edges included), refused as CONFIG_SET_FOCUS before assemble output when invalid; only when present, `parts.json` records it with focus_source_size and `sets.json` emits it in setup-world coordinates through the actual rig resize and `src/coords.ts`. Absent focus emits no field or inferred value; changing/removing it requires reassembly
- **assemble.extend_below_crop[i]** — required: `part`, `run`, `tag`
- **assemble.extend_painting[i]** — required: `part`, `band`, `max_distance`; optional: `min_held_alpha`, `order` (issues #848, #854, #855; explicit final layer-derived part, half-open rig band and positive four-neighbour path bound; base painting only). The optional integer floor 1–255 admits exact original alpha-over coverage strictly below it; absent or 1 blocks every nonzero holder. Only selected target samples below the floor may take painting RGBA; target samples at/above the floor and every non-target holder remain exact. By default overlapping reachable claims refuse. With `order` on every entry (unique nonnegative safe integers), lower values claim first and their gains block later candidates and paths; array order never breaks ties or supplies missing precedence
- **assemble.patches[i]** — required: `name`, `box`, `alpha`, `draw`
- **assemble.patches[i].draw**, when an object — required: `before`
- **assemble.cuts[i]** — required: `from`, `into`, `polygon`, `draw`, `overlap`; optional: `under`, `under_fill`
- **assemble.cuts[i].draw**, when an object — required: `before`
- **limbs.&lt;limb&gt;** — required: `segments`; optional: `split`, `layout`, `front` (issues #349, #446, #647, #664)
- **limbs.&lt;limb&gt;.front** — required: `parts` (own segment parts, issue #664), `after` (a produced part)
- **limbs.&lt;limb&gt;.layout** — exactly one of `before`, `after`; optional: `parts` (own consecutive segment-part references, issue #647)
- **limbs.&lt;limb&gt;.layout.before**, **limbs.&lt;limb&gt;.layout.after** — exactly one typed target: `limb` or `part`
- **limbs.&lt;limb&gt;.segments[i]** — required: `part`, `from`, `bone`; required below a joint (i > 0): `joint`; optional below a joint: `range`, `cap`, `edge`, `cap_shape`, `cut_band`, `hybrid`
- **limbs.&lt;limb&gt;.segments[i].hybrid** — required: `part`; optional: `width` (issue #399; lower segments only, replaces cut-cap options, one source and two adjacent rigid carriers)
- **bones[i]**, a single bone — required: `name`, `parent`, `at`; optional: `tip`, `inherit`
- **bones[i]**, a chain — required: `chain`, `parent`, `points`, `tip`; optional: `link_inherit`
- **stops[i]** — required: `chain`, `against`, `at`, `inward`, `outward`; optional: `links`, `lower` (issue #404)
- **stops[i].lower** — required: `inward`, `outward`
- **meshes.&lt;part&gt;** — exactly one of `grid`, `contour`, `auto`, `influence`, `explicit`; required in every mode: `segments`, and `r` in generated modes other than `influence`; `explicit` refuses generation fields and uses direct bone names in `segments`, the first the slot bone; optional in every mode: `exponent`, `rule`, `gather` (issue #680, false only: preserve an exclusive non-segment rider's authored draw position without changing its binding; absent, output bytes unchanged); optional with `contour` or `auto`: `ribs`; optional with `grid` or `contour`: `influences` (issue #284; beside `auto` it is refused, CONFIG_INFLUENCES_MODE); optional with `grid`: `stray` (issue #303; beside `contour` or `auto` it is refused, CONFIG_STRAY_MODE)
- **meshes.&lt;part&gt;.explicit** — required: `image_sha256`, `region_sha256`, and either `uvs`, `triangles`, `hull`, `weights` (single-slot, issue #658) or `islands` (at least two island entries, issue #734); direct payload numbers are transferred without normalization; weights require `bone`, `x`, `y`, `weight`. Image SHA-256 is over decoded unpadded RGBA bytes; region SHA-256 is over JSON.stringify([rig width, rig height, part x, part y, part w, part h]). Both must match before output, and when `islands` is declared its entry count must match the part's non-dust 4-connected art island count. All weighted and island slot bones must occur in segments; declared stopped links may use their emitted `<link>_d` names. Other unknown names remain refused. Alternate artwork for this part is refused; use a generated mesh for it.
- **meshes.&lt;part&gt;.explicit.islands[i]** — required: `slot` (`<part>` at index 0, `<part>__island<i+1>` at index i >= 1), `uvs`, `triangles`, `hull`, `weights`; optional: `bone` (defaults to `segments[0]`), `before` (index i >= 1 only: the base part slot in `rig.json` to splice `<part>__island<i+1>` immediately before; absent, immediately after the part's previous island slot)
- **meshes.&lt;part&gt;.influence** — required: `cell`, `radius`, `across`, `max`, `shape` (issue #378); optional: `hold_tip` (issue #615, the value true only); beside it `r`, `exponent`, `rule`, `influences`, `stray` and `ribs` are refused by name
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
- **regions.&lt;part&gt;** — a bone name, or `{bone, gather?}` with the same required bone name and optional `gather: false` (issue #680); absent, normal gathering and historical bytes are unchanged. An opt-out requires an exclusive non-segment limb rider ([named refusal](AUTHORING.md#RIG_GATHER_RIDER))
- **motion** — required: `duration`, `tracks`; optional: `blink`, `animations_from`
- **motion.tracks[i]**, a single track — required: `bone`, `prop`, `amp`, `period`, `phase`; optional: `base`
- **motion.tracks[i]**, a chain track — required: `chain`, `amps`, `period`, `phase`, `lag`
- **motion.blink** — required: `t`, `eyes`, `squash`; optional: `brows`, `brow_drop`, `still`
- **motion.blink.still.&lt;part&gt;** — required: `row`, `bone`
- **motion.animations_from**, the file it names — required: `spec`, `animations`
- **turn** — required: `pivot`, `depths` (or `roles` / `body`, issues #763, #787); optional: `deform`, `band`, `radius`, `surface`, `head`, `roles`, `counter`, `grid`, `unitDepths`, `body`
- **turn.depths.&lt;part&gt;** — a See-through depth
- **turn.roles.&lt;part&gt;** — `"surface"`, `"unit"` or `"rear"` (issue #763)
- **turn.unitDepths.&lt;part&gt;** — a calibrated world depth in rig pixels (issue #763)
- **turn.body**, when an object — required: `roles`, `pivot` (when `turn.pivot` is absent); optional: `bone`, `slider`, `counter`, `grid`, `unitDepths` (issue #787)
- **turn.body.roles.&lt;part&gt;** — `"surface"`, `"unit"` or `"rear"` (issue #787)
- **turn.body.unitDepths.&lt;part&gt;** — a calibrated world depth in rig pixels (issue #787)
- **turn.deform.&lt;key&gt;** — a per-degree fraction or coupling share (FACE_DEFORM_FRACTIONS, issue #436)
- **turn.band**, when an object — optional: `yaw`, `pitch` (issue #472)
- **turn.surface**, when an object — optional: `radius` (issue #479)
- **turn.head**, when an object — optional: `pivot`, `radius` (issues #478, #479)
- **scene** — no field (`{}`; a record or an annotation only)
- **proposal.json**, the file propose writes — `bones`, `meshes`, `regions`, `limbs` under `--keypoints` where an arm or a leg is drafted from its joints (issue #349), `stops` when supplied, `motion` under the rules above, `turn` with `--full`/`--head`, `proposed_rig_scale` (issue #354), and `notes`
- **depth** — optional: `zScale`, `full`, `head` (#773)
- **depth.full**, **depth.head** — optional: `layers`, `atlas` (one fallback route)
- **depth.full.layers.&lt;layer&gt;**, **depth.head.layers.&lt;layer&gt;**, **depth.full.atlas**, **depth.head.atlas** — required: `image`, `near`, `zScale`
- **waist** — required: `top`, `bottom`, `upper`, `lower`, `bone`, `constraint` (#650; absent keeps the ordinary bindings and graph)
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
| `parts.json`, `parts/<name>.png` | `assemble`, `build` | one record per part: `from` (`<run>:<tag>` with a See-through v3 tag, `<run>:author:<label>` for a layer the author made — issue #256, read by no role rule — or `painting:<name>` for a patch), `cut_from` on a cut's piece only (the plan part it was cut from, issue #230), `limb` on a limb segment's part only (issue #349: `name`, `segment`, `of`, `bone`, and below a joint `joint`, `range` when the config segment declares one (issue #360), and `cap` — `at`, `width`, `radius`, `box`, `layer_px`, `image_px` with a cap image, `image_layer` after it when that image was a hidden-art layer — issue #359, `<run>:<layer>:hidden` — `missing_px`, `short_px` (`left`, `right`) after it only when `missing_px` is above 0 (issue #557, additive), `excluded_px` after them only on a subset set's limb part whose cap the set exclusion took a pixel of (issue #603, additive: each pixel taken out of the count it was in, so the cap's counts are the written PNG's), then `shape` and `upper_px` under the segment's `cap_shape` — `upper_px` without the shape only when the upper segment gave a pixel (issue #557, additive) — and after them `lower_px`, `lower_kept_px` and `lower_missing_px` under `cap_shape: "ball"` (issue #579, additive), and `edge`, `feather_radius` and `feathered_px` under its `edge`, and `cut_band`, `cut_offset`, `cut_at`, `cut_crossed`, `joint_crossed`, `band_px` and `stroke_luma_max` (when the band has a split) under its `cut_band`, issue #360), the box `x`, `y`, `w`, `h` (rig px), the pixel counts `src/parts.ts` documents (`opaque_px`, `visible_px`, `occluded_px`, `projected_core_px`, `source_px_taken`, `visible_not_projected_px`, `refused_drift_px`, `merged_px` — on a subset set's limb part counted after the set exclusion, issue #603 — `seam_override_px`, and `fringe_pushed_back` when not empty); per-part `provenance` (`unchanged_layer_px`, `hand_px`, `automatic_px`, `edits`, `automatic`, additive, issue #823); optional top-level `motion_seams`, `alternates` and `cut_ownership` (one row per cut, independent of RGBA equality, issue #823); `rig_size`, `scale_rig_per_source`, `ghost_px`, `recomposite`, and `scene` (`figure_alpha_above`, `figure_px`, `figure_mask`) under `config.scene` only, with the figure's mask `figure_rig.png` beside the recomposite (issue #242); `single_run_pad` (`file_size`, `side`, `left`, `top`) last, only for one run whose file is not the `seethrough.resolution` square (issue #366) |
| `rig/rig.json`, `rig/motion.json`, `rig/images/` | `rig`, `build`, `compose` | rig-c's rig spec and motion spec, `spec` `rigc-rig/1` and `rigc-motion/1`: the format is rig-c's, and this package writes only what rig-c's parser accepts; a bone carries `inherit` only where config.bones declares one, rig-c's mode name as written (issue #348) |
| `rig/mesh_report.json` | `rig`, `build` | one row per mesh: `part`, `vertices`, `triangles`, `hull`, `bones` (the sorted names the attachment's weights bind in the written `rig.json`, in every mode — since 1.49.1 (issue #536) a rig with `turn` or `stops` names the twins and `<link>_d` bones there, where the row named the segment bones they replace: a fix of a wrong name, not a format change; a rig with neither writes the bytes it wrote), `max_influences`, `mean_influences`, `art_coverage`, then `grid` (a lattice); or `mode` "explicit" with `image_sha256` and `region_sha256` (the verified guards; counts and coverage are measured from the supplied mesh, no legacy generator report is adopted); `mode` "contour" with `params`, `contour`, `regions` (`params.maxEdge` and `contour.outlineCut` only when the mesh declares `contour.maxEdge`; `params.bridges` and `contour.bridges` — `islands`, `units`, `joins`, and `faint` only when an island was left out as faint — only when it declares `contour.bridges`); or `mode` "influence" with `influence` (as declared), `reach` (`farthest`, `at`, `nearest`, `capped`, `widest`) and `lattice` (rig-c's `SegmentsLatticeReport`: `cols`, `rows`, `artCells`, `keptCells`, `passes`, `islands`) (issue #378); or `mode` "auto" with `settings`, `source`, `result`, `residuals`, `worst_residual`, `worst_region`, `motion_amplitude`, `termination`, `weights`, `regions`, `deformation`, `quality_report` (rig-c's `mesh-quality-report/1` document whole), `motion_report`, and, only when they apply, `stray_cleared` (after `source`, when `source.stray` is declared), `skinning_residual` and `replay` (`AutoMeshReport` in `src/rig.ts`); in every mode, `exponent` when the mesh declares one (after `grid`, or after `mode`); `influences`, as declared, when a lattice or contour mesh declares it (after `exponent`, or where `exponent` would be); `stray` and `stray_cleared` when a lattice mesh declares `stray` (after `influences`, or where `influences` would be); `ribs` when a contour or auto mesh declares them (after `exponent`, or after `mode`), and then `contour.ribs` (`source.contour.ribs` in the automatic mode) |
| `check/check.json` and the rest of `check/` | `check`, `build`, `compose` | the reference's fields in its order (`gate_spine_html_green`, `rigc_entry`, `pack_mode`, `environment` after it under `--environment` only (issue #538, additive: `path` as given, `sha256`, `steps`), `loop_max_diff`, the seam figures — `seam_mean`, `seam_px_over_40`, `seam_px_over_80` and, from issue #216, `seam_frame_scale`, the frame scale the bar divides the count by), `loop_physics` after `loop_max_diff` when the rig declares a physics constraint, `seam_border` after the seam figures when `parts.json` declares a scene (issue #242), `seam_pairs` after the seam figures when the seam bar fails or `--seam-pairs` asks (each row's picture under `check/seam/`; `--keep-stills` leaves the setup-pose still and its `frames.json` under `check/setup_still/`), then the judgement lines (`BREATH_VISIBLE`, `BLINK_NO_HOLE`, `CHAIN_LAG`, `TIP_OVER_ROOT`, `STILL_REGIONS_DARK`, `TEXTURE_STRETCH`), `ANIMATIONS_DO_NOT_FOLD` after them when `motion.json` holds an animation, the idle included — on every rig with an idle since issue #333 (issues #320, #363: `status`, `animations`, `fps`, `physics_left_out`, `folding` — each `animation`, `slot`, `attachment`, `frames`, `worst_frame`, `worst_triangles`, `triangles`, `physics_on`, `physics_off`, `physics_constraints`, `declared`, `line` — `folding_undeclared`, `declared_not_folding`, `bar`), `FEET_STAY_LEVEL` after it when a `footwear` part rides a bone that hangs from another and `motion.json` holds an animation (issue #348: `status`, `reason` on a SKIP only, `animations`, `fps`, `physics_left_out`, `bar_degrees`, `bar`, `feet` — each `part`, `bone`, `hangs_from`, `status`, `frames_posed`, `worst`), `LIMB_ONE_BONE` after it (and after `STRESS_OFF_CHAIN` where that is written) when `parts.json` holds a limb segment's part (issue #349: `status`, `parts` — each `part`, `limb`, `bone`, `status`, `others`), `SEAM_OVER_RANGE` after it when a limb record carries a `range` (issue #360: `status`, `frame_scale`, `physics_left_out`, `bar` — `mean`, `rig_px_over_40`, `level` — and `joints`, each `part`, `limb`, `segment`, `joint`, `bone`, `range`, `at`, `radius`, `under_px`, `status`, `poses` — each `degrees`, `status`, `mean`, `px_over_40`, `px_over_80`, `rig_px_over_40`, and `step_px` (`left`, `right`) only on a joint whose cap record carries `short_px` (issue #557, additive) — and `unread` on a joint not read), `SEAM_OVER_MOTION` after it when `parts.json` holds a limb segment or `--requirements` a `seam` (issue #493 retains existing pair warnings; issue #686 gates GAP on proven body-root pairs only (gap-only; mixed ghost remains INFO until rig-c/core#1555 supplies owners): `status` — `WARN`, `CLEAR`, `SKIP` or `FAIL` — `reason` on a SKIP only, `fps`, `floor`, `pairs` — each `pair`, `a`, `b`, `declared`, optional `root` (`limb`, `bone`, `parent`) on a proven body-root pair, and `unread` on a pair not read — `animations`, `warnings`, `rows` — each `pair`, `animation`, `status`, `drawn`, `banded`, `opens`, `px`, `max_px`, `under_floor`, and only on new-root rows stock `gapOpen` plus UNDER-owned `ghostA`/`ghostB` cells selected by resolved per-frame draw order gate their summed count against the unchanged strict one-cell floor on the original raw kind boxes (their union when both kinds contribute), never narrowed partition boxes, while `gapCovered` and OVER-owned ghost cells are excluded (issue #711); `cells` retains partition counts, UNDER owner and counted total, `worst` retains frame/count/cell/box, and `roots` retains status, mode `gap-open+under-ghost`, ghost_owner `resolved-draw-order`, pairs, failed, reason and optional unmeasured bindings; eligible candidates whose valid setup bands are all zero retain a named unmeasured root and SKIP bar, including when no pair is selected; measured root FAIL wins over SKIP, while measured PASS plus an unmeasured root remains SKIP; every eligible body drawing with stock setup `banded > 0` is selected, including both when a parent is shared; issue #708 resolves a body slot on its exact generated turn child to the same named carrier only after unique identity-bone/control/per-part-transform proof, without changing pair identity, setup selection or the direct-carrier path; setup-only observation preserves the authored motion and default drawing, root-free inputs add no setup compile/render, and no animation remains SKIP rather than a measured zero; existing internal pair warnings and their exits are unchanged; issue #591 adds optional `worlds` on physics rigs with readable declared pairs and animations: `default` and `still`, each `wind`, `gravity`, `status` (`REPORTED` or `SKIP`), `reason` on SKIP, `dir` only when rendered (relative to check.json: `seam_motion/default` or `seam_motion/still`, the complete retained render with frames.json and each animation's raw seam.json), and `rows` — pair, animation, status, drawn, banded, `gap` and `ghost`, each `max_px` and `worst` only; worst carries `index`, `px`, `cell`, `box`. Per-frame hits stay in the raw sidecars. These raw reference readings add no bar or warning and leave the custom environment reading unchanged), `CLOTH_SETTLES` after it when the rig declares a physics constraint and has an idle (issue #501, a warning and not a bar: `status` — `WARN` or `CLEAR` — `fps`, `frames`, `duration`, `floor_rig_px_per_s`, `floor`, `levers`, `warnings`, `rows` — each `tip`, `root`, `links`, `point`, `settles_at`, `max_rig_px_per_s`, `min_rig_px_per_s`), `RECOMPOSITE_HOLES` (its first figure `declared_scene` when `parts.json` declares a scene), `SETUP_POSE_VS_SOURCE`, `WIND_BAND` after it under `--wind-band` only (issue #590, additive: `status` `"REPORTED"`, `spec` `"rig-parts-wind-band/1"`, `path` as given, `sha256`, `steady_wind_only` `true`, `gravity` `[0, 1]`, `min`, `max`, `step`, `steps`, `fps`, `animations`, `max_gap`, `max_ghost`, `holds_from`, `holds_to`, `pairs_holding_all`, and `pairs` — each `pair`, `a`, `b`, `holds_all`, `holds_from`, `holds_to`, `first_break_below`, `first_break_above`, `worst_gap`, `worst_ghost`, `steps`), `skipped`, `config` under `build` only (issue #607, additive: `path` as `--config` was typed, `sha256` of the bytes the build read; `check` and `compose` read no config and write none), a `requirements` block under `--requirements` (or `build`'s `config.requirements`) — `file` first from issue #556, additive: `path` as typed or declared, `sha256`, `keys` — and `PASS`; `check/build/skeleton.json`, `.atlas` and `.png` are the packed artifact rig-c writes. Missing stock partitions or resolved owner are named refusals, never zero. No whole-box exemption or consumer compositor remains; internal warnings and reference raw readings are unchanged. |
| `layers.json`, `<index>_<name>.png` | `layers --export` | the wrapper form `layers` reads (issue #359): `width`, `height`, then `layers` — each `name`, `filename`, `left`, `top`, `right`, `bottom`, `depth_median` (the input's own; `null` for a PSD, the manifest's order then being the draw order) — drawn layers in draw order, then the hidden-art layers; a PNG's name is its index and its layer's name, and the manifest, not the file name, says which layer it is |
| the template `.psd` | `layers --template` | one empty layer per name `templateLayerNames` (`src/layers.ts`) holds, bottom first; the same canvas writes the same bytes |
| `proposal.json`, `render/landmarks*.png` | `propose` | the config's four rig sections, `constraints` with `--cloth` (issue #364: a physics constraint per tree link named `<bone>_physics`, a dangling end's `<bone>_translate`, and a skirt swing's transforms `<swing>_<tree>`), `turn` with `--full`/`--head`, `proposed_rig_scale` (issue #354), and `notes` |
| `basis.json` | `propose` | spec `spine-parts-basis/1` |
| an existing config named by `--write-config` | `propose --head-box`, `assemble --propose-plan`, ordinary `propose`, sampled-turn neck draft (`propose … --full --head --write-config`, issue #826) | issue #356, additive: `assemble --propose-plan` must update `--config` itself; only the selected proposed fields are replaced by whole-value text splices, preserving untouched bytes; absent optional proposal sections and other fields remain; the stage loader validates before atomic replacement, relative paths keep their base, an unchanged update preserves bytes and mtime, and stderr lists changes; no multi-artifact transaction is promised; with `--only-missing` (issue #671) only a `meshes.<part>` or `regions.<part>` entry for a proposed part the config attaches by neither is added, and an `assemble.plan` row for such a part the 1.37.0 arm split makes that the plan does not name, every existing row and entry and every other byte as read |
| a new `--write-config` file | `propose --cloth … --write-config` | complete checked splice text published without overwrite; an intervening creator is refused, while cleanup failure after publication may leave the complete new file present; intentional partial configs retain their existing contract; the `--cloth` config read, byte for byte, but for the entries the recipe drafts (issue #537), measured against the same parts drafted without it: `meshes.<part>` and `regions.<part>` for each part the recipe moves, and `bones`, `constraints` and `motion.tracks` entry by entry by name (issue #552) — an entry the recipe drafts replaced or inserted, one it replaces removed, every other entry kept with its bytes and its place, and a hand edit to an entry the recipe owns refused by name (`PROPOSE_WRITE_CONFIG_CONFLICT`) rather than dropped; a section the input lacks is inserted; with `--from <previous config>` (issue #571) an entry equal to the previous recipe's draft is the recipe's as well |
| `config.json`, `mesh_draft.json` | `mesh-draft` | `config.json` is the config read, byte for byte, but for each drafted part's `meshes` entry; `mesh_draft.json` is spec `rig-parts-mesh-draft/1`: `rules`, `lattice_check`, `draft_check`, `figure_overdraw`, and per lattice part `part`, `mode`, `lattice`, `candidate` (with `bridges` — `units`, `joins` of `span` and `area_px2`, `area_px2`, `overdraw`, and `faint` only when an island was left out as faint — only when the candidate is a bridged one, issue #326), `delta` (under `--more-triangles` only), `readings`, `gate` (each line's `reading`, `pass`, `text`, `margin`), `note`; and `not_compared` (issue #307), only when the config holds an `auto`, `contour`, `influence` or `explicit` entry: per such entry, in config order, `part`, `mode` and `note` — the part was neither drafted nor compared, and a config of lattices alone writes no such key |
| `rig.json`, `motion.json`, `mesh_report.json`, `images/`, `remesh.json` | `remesh` | the input revision's files, `rig.json` and `mesh_report.json` with the part's attachment and row replaced (under `--delta` the row is the input's with its counts, `bones` and influences recomputed and `mode` "delta"), every other file byte for byte; `remesh.json` is spec `rig-parts-remesh/1`: `request` (`part`, `mesh`, `mesh_sha256`, `idle_keys`, `page_edges`, `pack_shape`; under `--delta`, issue #526: `part`, `delta` — the mesh edit as read — `delta_sha256`, `ops`, `applied` — `moved`, `added`, `removed`, `constrained` — `idle_keys`, `page_edges`, `pack_shape`), `versions` (`parts`, `rigc`), `input` (`rig` — `path`, `bytes`, `sha256` per file — `config_sha256`, `parts_json_sha256`), `baseline` (`reproduced`, `not_compared`; under `--delta` `reproduced` holds one sentence: no config is built, the input is the baseline), `target` (`before`, `after`: `vertices`, `triangles`, `hull`), `preserved` (`identical`, `spliced`), `revision` (per file as `input.rig`), `check` (`input`, `revision`: `pass`, `measured`, `not_met`, `skipped`, `physics`, then `line` and `status` — issue #541, additive, the spec stays `rig-parts-remesh/1`: `line` is the last line `check` prints on that tree, byte for byte, and `status` every block's status as that tree's `check.json` records it, by name in the file's order — `gate`, `loop` and `seam` read from their figures, every other block its own `status`, a block the file does not write absent; `scope`) |
| `rig.json`, `motion.json`, `mesh_report.json`, `images/`, `retune.json` | `retune` | the input revision's files, `rig.json` with `constraints` and `invariants.detached` replaced and `motion.json` with `animations.idle` replaced by the config's build, every other file byte for byte; `retune.json` is spec `rig-parts-retune/1`: `request` (`idle_keys`, `page_edges`, `pack_shape`), `versions` (`parts`, `rigc`), `input` (`rig` — `path`, `bytes`, `sha256` per file — `config_sha256`, `parts_json_sha256`), `held` (`compared`, `not_compared`), `changed` (`constraints` — each `name`, `type`, `fields` — `added`, `removed`, `idle`: `tracks_changed`, `duration` as before and after), `preserved` (`identical`, `spliced`), `revision` (per file as `input.rig`), `check` (`input`, `revision`: `pass`, `measured`, `not_met`, `skipped`, `physics`, then `line` and `status` — issue #541, additive, the spec stays `rig-parts-retune/1`: `line` is the last line `check` prints on that tree, byte for byte, and `status` every block's status as that tree's `check.json` records it, by name in the file's order — `gate`, `loop` and `seam` read from their figures, every other block its own `status`, a block the file does not write absent; `scope`) |
| `input-check.json` | `remesh --record-input-check`, `retune --record-input-check` | spec `rig-parts-input-check/1` (issue #617, additive): `versions` (`parts`, `rigc` — `rigc --version`'s whole output), `options` (`page_edges`, `pack_shape`, `requirements` — null, or `path` as resolved and `sha256`), `rig` and `parts` (`dir` as resolved, `files` — `path`, `bytes`, `sha256` per file: every file under `--rig`; `parts.json` and every file under `parts/`), `check` (the input's check side as `remesh.json` carries it); `--input-check` reads it back, and either command's serves the other |
| the scene report | `compose` | spec `spine-parts-scene-report/1` |
| `idle.png`, `idle-indexed.png`, `idle.gif` | `loop`, `build --loop` | APNG and GIF encodings of the rendered idle |

Issue #705 pins setup-seam acceptance to one source-relative scale1 union U of the authored stage and all actual drawn base/checked-set still vertices. U is snapped relative to the source origin, including odd-width half phase.
The existing seam fields and pair pictures use that grid; source/blink and
motion-root frames are unchanged. `sets.<name>` gates its affected numerator
on the same fixed base source-cell denominator A. Non-scenes count the whole U numerator; scenes retain original border and outside-authored exclusions. Padding never enlarges A. Base failure OR any affected-set
failure remains overall failure, with mean 1.0, levels 40/80 and aggregate 50
unchanged. Added `seam_scope` identifies `source-grid/base` or
`source-grid/affected-set`, `denominator_px`, canonical `whole`, diagnostic
`auto_frame_raw` (unrounded mean, display mean, support, counts, scale, viewport),
effect/inheritance reasons, semantic drawing changes and named unavailability,
`domain.states` state/frame/piece/bounds/pose identity, and each raw pair's
whole/affected/inherited counts and reasons. `whole_pairs`
keeps complete canonical raw pair data (boxes/cut metadata included), omitting
`picture` unless its image exists. Semantic signatures preserve original source
attachment UVs/topology/weights, own image content and world vertices/colour,
not atlas pages/UVs or global piece ordinals. Unknown/no-art support stays conservative.
Renderer metadata and exact raster reads use the promised `@rig-c/core/render-shared` entry (rig-c >=2.69.0 <3.0.0). It registers no Spine runtime; where that runtime resolves from rig-c's own package root, the existing `@rig-c/core/render` entry registers the official Spine side explicitly. An install without Spine keeps rig-c's own candidate chooser and gate; candidate or loader failures never select a guessed fallback.

An unavailable, nonfinite, unrepresentable or oversized union, or nonempty official pinned.outside, refuses `CHECK_SEAM_DOMAIN`. Geometry margins outside the authored canvas are included in U, not treated as opaque-clip evidence. State-by-state geometry reads retain bounds/identities rather than all decoded pages or poses. `--keep-stills` keeps
canonical frames in `setup_still/` and fitted diagnostics in `setup_still_auto/`.
There is one extra seam render per checked state and no extra compile/gate.

Issue #716 adds `seam_scope.population` on a measured base or checked set,
without changing that metric or its consumers. Before RGB error is read, each
included comparison sample is attributed by the existing alpha-above0,
top-two-of-2x2 reference rule. `basis` names that rule; `pair_count` and `pairs`
name only genuine observed two-part footprints in source draw order.
`single_art` and `no_reference_art` remain separate buckets. Each row's
`whole_sample_px` equals `scope_sample_px + inherited_sample_px`; base scope
equals whole, and a set uses the unchanged semantic effect mask. The sum of
whole buckets equals `measured_sample_px`, not the mean denominator A. Scenes
retain their existing exclusions. A zero-error comparison can have named pair
support; no genuine pair is explicit, while an unmeasured seam retains SKIP
and no population. This is reference support, not joint or physical-gap
measurement. Existing sparse error rows, boxes, pictures, flags, thresholds,
verdicts, gates and CLI consumer counts are unchanged; no zero-error picture is
created and no new bar or refusal is added.


Skeleton alternate registration accepts an optional `anchor` mapping of one or
two body-18 keypoints to declared base-bone origins (issue #543). One pair holds
scale at 1; two determine scale and offset. The registration bars and painting
pixels are unchanged, and omitting the field retains torso registration.

Painting generation metadata includes `upscale: {model, then}` (issue #698),
read from the same `UPSCALE_MODEL` and `UPSCALE_THEN` constants as the graph.
This adds provenance; it does not change model selection.

Revision ancestry is additive (issue #531): a previous root `remesh.json` or
`retune.json` is preserved at `provenance/<command>-<sha256>.json`, and optional
`input.provenance` rows name its source, path, bytes and SHA-256. The chain survives
same-command and mixed-command revisions without changing their rig splice or
hold. `revision` rows name actual output bytes, including a new `input-check.json`
when recorded, and exclude the new root provenance itself. A first revision has
no parent rows. Hashes and names are deterministic.

Files authors write for this package, each with a spec id the reader holds:
`spine-parts-requirements/1` (`check --requirements`), `spine-parts-scene/1`
(`compose --scene`), `spine-parts-keypoints/1` (`propose --keypoints`),
`spine-parts-bonemap/1` (`compare --map`), `rig-parts-wind-band/1` (`check --wind-band`, `build --wind-band`, issue #590, additive); and one another tool writes, read as that tool defines it: rig-c/review's `rig-review-mesh-edit/1` (`remesh --delta`). The spec ids of files that existed before the rename keep the package's former
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

`dependencies` takes `@rig-c/core` `2.82.0` exactly. Bun 1.4 or later
is the declared floor (`engines.bun` `>=1.4.0`; older 1.4 releases are not tested in
CI, which runs `latest`, and compatibility with an older 1.4 release is handled when
reported as an issue). What this package relies on in rig-c, every import
read off `src/` and `cli.ts`:

- the named entries `@rig-c/core/mesh` (the outline functions, `measureAuthoredMeshFit`,
  `reduceMesh`, `skinningEnvelopeBone`, `writeMeshQualityReport` and their types)
  and `@rig-c/core/meshcompare` (`compareMeshesInMotion`);
- the deep paths its `exports` map carries: `@rig-c/core/src/rig.ts` (`parseRigSpec`,
  `RIG_SPEC_VERSION`, the constraint keys), `@rig-c/core/src/errors.ts`,
  `@rig-c/core/src/png.ts`, `@rig-c/core/src/transform.ts` (the y flip, through
  `src/coords.ts` only), `@rig-c/core/tools/plate.ts` (the PNG codec) and
  `@rig-c/core/tools/font5x7.ts`;
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

The following measurement used the unreleased [core#1595](https://github.com/rig-c/core/issues/1595)
prepared-reference implementation, packaged locally with `rig-c` metadata version
`2.70.0` (tarball SHA-256 `dac8c10631e9c0fbd30b9361155b26cba5526ece618c623e87e8dd20cc3dd92c`).
Its grid-selection replays bind one exact reference and schedule, then compare each
fresh gated candidate.
The number of candidate probes, gated builds and packed-page checks is
unchanged; a changed bound or reference input is refused. In one exclusive Nova
WSL ABBA invocation, using the same rig-c tarball in both arms and two runs per
arm, the strict switched `bottomwear` input derived from public `reference-demo` took 56.00–56.28 s
with one-shot comparison and 50.55–51.40 s with preparation included; the similarly switched public
`reference-sample` input took 18.96–20.41 s and 16.39–18.71 s respectively.
The paired differences were 4.59–5.74 s and 1.70–2.57 s. These are observed
wall times for those inputs, not an execution limit or a machine-wide idle
measurement; load outside the Nova pool was not measured. The prior count
bounds remain the termination guarantee.

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

### Opt-in hybrid provenance (issue #399)

A lower rigid limb piece may carry `limb.hybrid` instead of `limb.cap`:
`{part, upper, width, radius, at, axis}`. Its generated mesh carries
`limb.band`: `{upper, width, radius, at, axis}`. Their source, joint, lower
carrier and measured geometry must agree; the lower rigid piece alone carries
`range`. The default limb records and byte contracts are unchanged. The
existing `LIMB_ONE_BONE` line checks ordinary segments as before; the band
requires exactly its two adjacent carriers. `SEAM_OVER_RANGE` uses the stored
radius and existing rest-art comparison, without changing its bar.

## Explicit motion seam observations (issue #750)

`motion_seams: [{part, neighbour}]` is optional in proposal/config/parts.json.
Absent leaves the existing declaration path unchanged. Readers refuse unknown
parts, self-pairs, unordered duplicates, malformed entries and unknown entry
fields by name. Empty declares no additional pair. Proposal turn/copy/write and
assemble preserve it; check never infers a removed declaration. A declared pair
uses the existing non-root WARN floor and unchanged exits, unless independently
selected by the existing proven body-root FAIL contract.

All played non-root WARN rows may add `worst` and `pose_at_worst`, including
existing limb rows. Worst is the maximum above-floor raw hit, earliest frame
on a tie, gap before ghost on a remaining tie. Pose evidence binds the same
seam geometry's actual setup, frame index, animation, viewport and raw time.
It records carrier-path world axes, parent-relative setup-axis deltas modulo
360, unchanged static ranges and explicit unavailable comparison reasons;
frame0 and source key endpoints are not setup or measured pose substitutes.
No angle bar or new threshold is added. Missing/mismatched data refuses.
Without a declaration only optional WARN evidence changes existing check bytes.
For the declared no-chest control at identical paths, the exact byte projection
of an existing seam container excludes only its selection, rows, derived status
and reason. The historical optional-container bar required exactly seven keys,
`CLEAR` and zero warnings across every animation. Its measured raw exit 1 stays
red: the added greeting keys only the head, but the original idle also keys the
chest and reports an above-floor opening at frames 8–12. The source type also
permits informational `worlds`; neither finding changes the product contract.

[HQ's post-verdict restatement](https://github.com/rig-c/parts/issues/750#issuecomment-6398631279)
corrects that premise. When the baseline omits `SEAM_OVER_MOTION` entirely, audit
the new container against the complete `MotionSeamLine` source type, including
its required and optional fields and referenced types, rather than a hand-kept
key list. Independently verify fps 12, the exact source floor, compiled animation
roster, generated selection and every row against the raw readings. All added
greeting rows must be readable and clean. Any WARN must name an animation that
actually keys a joint on the pair's carrier ancestry, witnessed by the original
authored motion, compiled tracks and actual drawing carriers. The original idle
WARN remains reported with the unchanged floor and exit behavior. Only after
those audits may lossless removal of the new container establish exact equality
of every outside byte. An existing baseline container keeps the narrower field
exclusions above. The original red and the separate post-verdict re-evaluation
are retained together; no input, animation selector or threshold is changed.

The WARN pose reader also requires the published stock coordinate header and
the required source bone/parent roster. It binds the complete geometry frame
cohort to the actual PNG frame set through `readFrameSet` and `boneTrackOf`,
including unselected frames, before reading the worst pose. Identical static
ranges on a bone deduplicate; conflicting ranges are explicitly ambiguous,
never described as no declared range.


## Optional depth sheets (#773)

A wrapper `depth_filename` is a legacy hint. Without explicit `config.depth`,
no depth file is read, validated, fetched or emitted, even when files or
in-memory sheets exist; art/order and legacy output stay unchanged. With the
block, a drawn layer source must be opaque grayscale on its exact grid.
Reader/export APIs take explicit config/run/base context; raw export defaults
to art only. Comfy CLI adds `--config` and `--depth-run full|head`; the block
requires a named run and a named run requires the block. Active download and
source errors remain refusals, never missing-file fallback.
Assembly's optional part `depth` reference holds `image`, `near`, `zScale` and
`sources` (each original `from`, `image`, `sha256`, `crop`, and `reading` with
`orderingMedian`, `sheetMedian`, `relation`). These fields are omitted without
active binding. Persisted authored part references remain active for standalone
rig reading regardless of config opt-in. `rig` adds padded measurement PNGs and the `rig-parts-depth-sheets/1`
`depth_sheets.json` companion only with references (each output `part`, actual
padded `size`, and `depth`; a still split names both slices). Current weighted meshes do
not acquire a Core field or change geometry; #763 owns the generator consumer.
The separate ordering scalar is unchanged. No-image outputs retain legacy bytes.
