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

## Parts-stage integrity report

`rig-parts check-parts --parts <assembled-dir> --out <disjoint-report-dir>
[--json]` writes `parts-check.json`, spec `rig-parts-parts-check/1`.
Exit 0 is not a quality pass. No #945/#884 defect class is measured yet.
The six quality HOLEs are always present. They name plate ghost, plate structure,
plate smear, stepped fill, invented material and invented-material exposure.

The top-level key order is `spec`, `stage`, `inputs`, `parts`, `refusals`,
`reported`, `holes`, `exit_code`. `stage` is `parts`. `inputs` is sorted by
relative POSIX path. Each row has `path`, `status`, `sha256`, in that order.
Status is `read`, `missing`, `unreadable` or optional `absent`; SHA-256 is null
unless the file was read. The inventory binds regular files under `--parts`,
including primary and alternate PNGs, declared depth images, `parts.json`,
`painting_in_rig.png` and present source-cover/allocation reports. Missing
required references are explicit inventory rows. Symlinks and special files
are refused. Inputs are hashed again before atomic publication.

Base and alternate `scene.figure_mask` are declared but not consumed, read,
hashed or bound by this command. Their standalone-assemble location is tracked
in [#1177](https://github.com/rig-c/parts/issues/1177). The plate is outside this
command's inputs. `painting_in_rig` is written beside `parts.json` in both
standalone assemble and build layouts and is consumed and hash-checked.

`parts` preserves primary names, alternate records, the source-cover inventory
and allocation reports. Embedded object keys are sorted, and producer array
order is retained. `refusals` rows have `code`, `object`, `found`, `required`,
`detail`; reused metadata-reader diagnostics retain their code and detail with
null structured values when the reader supplies none. A refused input produces
a report and exit 1. `reported` rows have `code`, `set`, `part`, `source`, `count`,
`spans`; unplanned direct cover is reported without a refusal. `holes` rows have
`code`, `object`, `reason`, `line`. Absent source cover or allocation adds its
own HOLE; malformed present reports are refused. A HOLE carries no measured zero.

Bad arguments (exit 2), overlapping output, changing inputs, internal exceptions
and publication failures (exit 1) produce no new report. After parsing `--out`
and checking overlap, the command removes exactly `parts-check.json` and
`parts-check.json.tmp` there before reading inputs. Failed input reads cannot
leave an earlier success report. Bad arguments that prevent resolving `--out`
cannot remove a prior report. The CLI resolves an existing `--parts` root to its
real path before reading, including a symlinked root. Consumers bind the report
and current input hashes and read its `exit_code`. A sibling temporary file is
exclusively created, cleaned up after a failed write, then renamed into place.
Identical inputs produce identical report bytes on repeat
runs and under output roots with different parents.

The diagnostic code vocabulary below is closed for `rig-parts-parts-check/1`,
including reused reader and invocation codes. Adding a code requires a new spec
version. The generated controls derive literals from `src/parts.ts`,
`src/takesource.ts`, `src/depthsheets.ts`, `src/setfocus.ts` and `src/partscheck.ts`,
compare this list with the command's allowlist, and plant an undeclared code.

<!-- parts-check:codes -->
- `CONFIG_SET_FOCUS`
- `PARTS_ALT_BASE_ANCHOR`
- `PARTS_ALT_TIPS`
- `PARTS_ALT_TIPS_SOURCE`
- `PARTS_BOX_INSIDE_RIG`
- `PARTS_CHECK_INPUT_CHANGED`
- `PARTS_CHECK_INPUT_READ`
- `PARTS_CHECK_INTERNAL`
- `PARTS_CHECK_OUTPUT`
- `PARTS_CHECK_PNG_READ`
- `PARTS_CHECK_PUBLISH`
- `PARTS_CHECK_REPORT`
- `PARTS_COUNTS_ADD_UP`
- `PARTS_CUT_FROM_KNOWN`
- `PARTS_DEPTH_REFERENCE`
- `PARTS_FIELD_PRESENT`
- `PARTS_FIELD_TYPE`
- `PARTS_FILE_PRESENT`
- `PARTS_FROM_KNOWN`
- `PARTS_HOLES_LARGEST_FIRST`
- `PARTS_HOLE_PART_KNOWN`
- `PARTS_HYBRID_PAIR`
- `PARTS_INVENTED_EXPOSURE`
- `PARTS_INVENTED_MATERIAL`
- `PARTS_IS_JSON`
- `PARTS_KEY_KNOWN`
- `PARTS_MOTION_SEAM`
- `PARTS_NAME_UNIQUE`
- `PARTS_PAINTING_ALLOCATION`
- `PARTS_PAINTING_OPAQUE`
- `PARTS_PAINTING_PNG`
- `PARTS_PAINTING_PRESENT`
- `PARTS_PAINTING_SHA256`
- `PARTS_PAINTING_SIZE`
- `PARTS_PLATE_GHOST`
- `PARTS_PLATE_SMEAR`
- `PARTS_PLATE_STEPS`
- `PARTS_PLATE_STRUCTURE`
- `PARTS_SINGLE_RUN_PAD`
- `PARTS_SOURCE_COVER`
- `PARTS_TAKEN_LAYERS`
- `PARTS_UNPLANNED_SOURCE_COVER`
- `PROPOSE_PNG_MATCHES_BOX`
- `USAGE`
<!-- /parts-check:codes -->

## Programmatic config file references

`@rig-c/parts/src/config.ts` exports `configFileReferences(raw: unknown):
ConfigFileReference[]` and the `ConfigFileReference` type (issue #1134).
Each reference has `at: string` (a dotted config field), `value: string`
(the declared path), and `set(value: string): void`, which changes that field
on the supplied object. Enumeration itself does not mutate, validate, read files,
or resolve paths. Empty and non-string values are omitted; invalid fields remain
for the loader to diagnose. Built-in control skeleton names are excluded.
The loader's file-field declarations determine membership; no separate list is
maintained. Resolve `value` against the source config directory when relocating.
Existing deep package paths remain available.

The same subpath exports `checkFileReferences(raw: unknown, configFile: string,
requirements?: RequirementsFile): CheckFileReference[]` and the
`CheckFileReference` type (issue #1138). `requirements` is the value returned by
`readRequirements` from `@rig-c/parts/src/requirements.ts`. The result lists every
file `check` reads from a config and its requirements. Each row has `at: string`
(the dotted field) and `value: string` (the path relative to the config's
directory). Rows come in this order: the `configFileReferences` rows, then
`requirements.setup_painting.figure_mask.path` and
`requirements.setup_painting.backdrop.path` when they are declared. Setup images
resolve through the same code the check's readers use. Enumeration neither reads
files nor changes its inputs. Inputs that resolve from the rig or parts directory
(seam and `cut_material` part images, `cut_material_sources.json`) are not listed,
because the caller already carries that directory with the check.

## Programmatic parts file references

`@rig-c/parts/src/parts.ts` exports `partsFileReferences(dir: string):
PartsFileReference[]` and the `PartsFileReference` type. `dir` holds the assemble
output's `parts.json`. Each row has `path: string`, relative to that directory,
and `role: 'part' | 'alternate' | 'depth' | 'painting' | 'figure_mask'`. The paths use `/`.
The complete output-reference fields and their roles are below.

| Field | Relative path | Role |
| --- | --- | --- |
| `parts[].name` | `parts/<name>.png` | `part` |
| `alternates[].name` with `records[].name` | `parts/<set>_<name>.png` | `alternate` |
| Base or alternate record `depth.image` | `parts/<depth.image>` | `depth` |
| `painting_in_rig.path` | Exactly `painting_in_rig.png` | `painting` |
| Base or alternate `scene.figure_mask` | Exactly `figure_rig.png` | `figure_mask` |

Painting and figure masks sit beside the manifest. Shared base/alternate scene
references collapse to one row. Depth source provenance filenames and
`taken_layers` donor directories/input names are historical identity receipts
and are omitted. There is no separate attachment field.
Rows are sorted by path, then role, in UTF-16 code-unit order, with duplicate path/role pairs
collapsed. A path with several roles retains each role. Every PNG that
parts.json references is listed. A listed file missing on disk is the consumer's
refusal. Unreferenced extras are outside the identity. Historical source
provenance is retained in the manifest and is outside the output-file identity. The function reads and validates
only the manifest, using the production readers' path resolvers. A missing manifest
refuses with `PARTS_FILE_PRESENT`, malformed JSON with `PARTS_IS_JSON`, and
invalid fields with the same named rules as `readParts`. It never opens,
hashes or decodes PNGs and preserves the manifest reader's named refusals.
Legacy manifests may omit alternates, depth and painting declarations.

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
| `diff-components` | `--stack`, `--painting`, `--parts`, `--floor`; optional `--threshold`, `--figure`; exactly one of `--out`, `--verify` (issue #1005; exhaustive native error inventory, with byte-bound reader) |
| `depth-prepare` | `--parts`, `--config`, `--out` (issue #897; separate numeric-depth recipe) |
| `depth-apply` | `--parts`, `--manifest`, `--config`, `--rig-config`, `--out` (issue #897; original character config is read-only) |
| `layers` | one positional path: a wrapper directory, a `layers.json` or a `.psd`; with it, optional `--export` (a directory to write the wrapper form into, issue #359); or `--template` with `--canvas` and no path; or a positional head run with `--full`, `--source`, `--config` together for `PLAN_HEAD_GARMENT_OVERLAP` (issue #826) |
| `sheet` | `--source`, `--layers` (repeatable), `--out`; optional `--cell`, `--cols` |
| `inputs` | `--source`, `--config`, `--out` |
| `comfy` | `paint`: `--config`, `--out`; optional `--seeds`, `--seed0`, `--host`, `--wait`, `--timeout`, `--poll` |
| `comfy` | `matte`: `--painting`, `--out`, `--node` (`BiRefNetRMBG`), `--model` (`BiRefNet-HR-matting`), `--checkpoint-sha256` (declared, required); optional `--resolution`, `--threshold`, `--host`, `--wait`, `--timeout`, `--poll` (issue #1204) |
| `comfy` | `plate`: `--mode` (`background` or `foreground`), `--painting`, `--mask-from` (`seethrough:<dir>`, `figure-mask:<dir>` or `matte:<dir>`), `--out`; with `--mode background` also `--checkpoint-sha256` (required) and optional `--graph` (`lama` or `core`), `--model` (required with `core`), `--seed`, `--grow`, `--steps`, `--cfg`, `--prompt`, `--negative` (the last four with `core` only), `--host`, `--wait`, `--timeout`, `--poll` (issue #1183, additive) |
| `comfy` | `seethrough`: `--image`, `--out`; optional `--resolution`, `--steps`, `--seed`, `--prefix`, `--offload`, `--no-offload`, `--lama`, `--nf4`, `--host`, `--wait`, `--timeout`, `--poll`, `--config` (See-through settings and optional depth block), `--depth-run` (`full` or `head`, required with the block) |
| `assemble` | `--propose-plan` with `--source`, `--full`, `--config`, optional `--head`, `--write-config` (must name `--config` itself, issue #356); or `--source`, `--full`, `--config`, `--out`, optional `--head` (without it, one run: issue #359), `--seam` (near-white, silhouette), `--project` (core, visible), `--alt` (repeatable `<name>=<source>:<full>[:<head>]`, issue #454), `--requirements` (source-bound cut-material evidence only when the file declares `cut_material`, issue #888) |
| `head-crop-preflight` | `--full`, `--canvas`, `--head-box` (JSON coordinate array); read-only advice before the head run, original alpha > 8 samples (issue #1082) |
| `propose` | `--head-box` with `--full`, `--canvas`; optional `--no-back-hair`, `--write-config` (existing config, issue #356) |
| `propose` | `--parts`, `--source`, `--out`; optional `--compare` or `--from-config` (one of them), `--keypoints`, `--person` and `--wrist-snap` (each with `--keypoints`), `--full`, `--head` (the turn control's depths; not with `--from-config`), `--grid-rule` (`figure` or `part`, the drafted lattice's spacing; not with `--from-config`), `--cloth` (a config whose `cloth` block is the recipe, issue #364; not with `--from-config`), `--write-config` (existing config for an ordinary proposal, issue #356; a new file with `--cloth`, issue #537; not with `--from-config` — additive: without it nothing `propose` writes changes), `--from` (the config the recipe is changed from, only with `--write-config`, issue #571 — additive: without it nothing `--write-config` writes changes), `--only-missing` (only with `--parts` and `--write-config`, not with `--cloth` or `--from-config`, issue #671 — additive: without it nothing `--write-config` writes changes)  `--bust-landmarks` (rig-pixel apex_r/apex_l and optional cleavage), or `--no-bust` (non-blank omission reason), one required when drafting a chest-holding torso, both incompatible with `--from-config` |
| `propose` | `--parts`, `--source`, `--out`, `--full`, `--head`, `--write-config` together: the [neck draft](AUTHORING.md#a-neck-that-moves-on-its-own) for an existing config with `turn.body` and one neck plan row; reassembles under `<out>/rig`, preserves the sampled turn and drafts a rigid neck unit (issue #826) |
| `compare` | `--left`, `--right`; optional `--map` |
| `rig` | `--config`, `--parts`, `--out`; optional `--idle-keys` (ctl, direct), `--page-edges` (pot, free), `--pack-shape` (rect, polygon) |
| `check-parts` | `--parts`, `--out`; optional `--json` |
| `check` | `--rig`, `--out`; optional `--parts`, `--source`, `--page-edges`, `--pack-shape`, `--requirements`, `--seam-pairs`, `--keep-stills`, `--no-extremes` (issue #829), `--set` or `--all-sets` (issue #454), `--environment` (issue #538, additive), `--wind-band` (issue #590, additive), `--json` (issue #904) |
| `loop` | `--frames`, `--out`; optional `--palette` |
| `build` | `--config`, `--source`, `--full`, `--out`; optional `--head` (as for `assemble`), `--seam`, `--project`, `--page-edges`, `--pack-shape`, `--loop`, `--lead-in`, `--requirements`, `--idle-keys`, `--seam-pairs`, `--keep-stills`, `--no-extremes` (issue #829), `--alt` (as for `assemble`, issue #454), `--set` or `--all-sets` (as for `check`, issue #454), `--environment` (as for `check`, issue #538, additive), `--wind-band` (as for `check`, issue #590, additive) |
| `compose` | `--scene`, `--out`; optional `--requirements`, `--accept` |
| `mesh-draft` | `--config`, `--parts`, `--out`; optional `--requirements`, `--idle-keys` (ctl, direct), `--page-edges` (pot, free), `--pack-shape` (rect, polygon), `--more-triangles` |
| `mesh-stats` | `--config`, `--parts` (issue #566, additive: prints, writes nothing) |
| `remesh` | `--rig`, `--config`, `--parts`, `--part`, `--out`, and one of `--mesh` or `--delta` (issue #526); optional `--requirements`, `--idle-keys` (ctl, direct), `--page-edges` (pot, free), `--pack-shape` (rect, polygon), `--record-input-check` and `--input-check` (issue #617, additive: without them nothing `remesh` prints or writes changes) |
| `retune` | `--rig`, `--config`, `--parts`, `--out`; optional `--requirements`, `--idle-keys` (ctl, direct), `--page-edges` (pot, free), `--pack-shape` (rect, polygon), `--record-input-check` and `--input-check` (as for `remesh`, issue #617, additive) |
| `painting` | one positional path, the painting; `--keypoints`; optional `--person`, `--form` (`standee` or `illustration`, issue #931) |
| `guide` | one positional argument: a rule name, `§<n>`, `§<n>.<m>` or `§<n>.<m>.<k>` |
| (none) | `--version`, `--help` |
<!-- /stable:commands -->

`TY13` holds the first column to the commands `cli.ts` dispatches, the set of
flags in the table to the flags `cli.ts` spells, and each command's listed flags
to its parser's `TAKES` row in both directions. Repeated proposal modes share one
command's flag union; `comfy paint` and `comfy seethrough` are checked separately.
Required combinations within a mode remain the CLI's; the `cli` suite's controls
read them from the help.

The [command reference](AUTHORING.md#command-reference) describes each mode;
[writing proposed config fields](AUTHORING.md#writing-proposed-config-fields)
records the existing-file and fresh-file destinations and byte-preservation rules.

`assemble --project visible` adds optional `edge_residuals.json` beside
`parts.json` (issue #999), a report-only front/back residual candidate sidecar.
Its observations add no acceptance bar to the existing outputs.

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
  A declared head turn (`depths` or `roles`) reports `RIG_TURN_HEAD_ROLL`
  when the absolute setup eye-line roll exceeds the limit displayed as
  18.485385 degrees
  (issue #903). This empirical limit is the midpoint of the measured public
  control maximum, 4.864514 degrees, and `three-quarter`,
  32.106256 degrees (the comparison uses the unrounded midpoint). The warning
  names the face/eye parts, the eye
  bones, signed roll and limit. It is report-only: no refusal, field, pose or
  emitted-byte change. No head turn, a body-only turn, or an unreadable eye
  line adds no warning; unreadable retains the existing face-axis reason.
  See [Head roll before a declared turn](AUTHORING.md#head-roll-before-a-declared-turn)
  for the measurement scope and its limits.
- **`scene`** (issue #242) declares the painting a scene — the figure and what
  is round it — and takes no field: `{}`. With it `assemble` reads the
  recomposite inside the figure (the union of the full run's layers at alpha
  above 8), writes the figure as `figure_rig.png` beside the recomposite (and,
  when standalone `assemble` puts `parts.json` in another directory, beside
  `parts.json` too, issue #1177) and a `scene` block in `parts.json`, and `check` leaves the painting's border rows
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
- **assemble** — required: `rig_scale`, `plan` (from plain `assemble` on); optional: `seam`, `project`, `ground`, `extend_below_crop`, `patches`, `cuts`, `alternates`, `head_face_underfill`, `yield_refused`, `stage_map`, `keep_under_occluders`, `require_hidden_extent`, `extend_painting`, `take`, `editor_receipts`
- **assemble.require_hidden_extent[i]** — required: `part`, `occluder`
- **assemble.alternates[i]** — required: `name`; optional: `source`, `full`, `head`, `parts`, `hides`, `head_box`, `cuts`, `skeleton`, `anchor`, `base_anchor`, `drawn`, `tips`, `front`, `layers`, `focus` (issues #454, #465, #543, #652, #664, #666, #719, #780). `focus` is an authored finite `[x, y]` in painting pixels, within its canvas (edges included), refused as CONFIG_SET_FOCUS before assemble output when invalid; only when present, `parts.json` records it with focus_source_size and `sets.json` emits it in setup-world coordinates through the actual rig resize and `src/coords.ts`. Absent focus emits no field or inferred value; changing/removing it requires reassembly
- **assemble.extend_below_crop[i]** — required: `part`, `run`, `tag`; optional: `edges` (left, right, top, bottom; explicit edges require a head-run part and the full-run layer of the same tag)
- **assemble.extend_painting[i]** — required: `part`, `band`, `max_distance`; optional: `min_held_alpha`, `order` (issues #848, #854, #855; explicit final layer-derived part, half-open rig band and positive four-neighbour path bound; base painting only). The optional integer floor 1–255 admits exact original alpha-over coverage strictly below it; absent or 1 blocks every nonzero holder. Only selected target samples below the floor may take painting RGBA; target samples at/above the floor and every non-target holder remain exact. By default overlapping reachable claims refuse. With `order` on every entry (unique nonnegative safe integers), lower values claim first and their gains block later candidates and paths; array order never breaks ties or supplies missing precedence
- **assemble.take[i]** — required: `run`, `run_dir`, `st_input`; optional: `tags`, `part`, `seed`, `reference`, `crop` (issues #866, #973, #1000, #1031). Whole-layer entries require `tags`; region entries require `part` and `seed`. An absent `reference` preserves the shipped `source: true` predicate and emits one named implicit-reference warning; only an explicitly declared painting reference makes the mask invariant to changes in `--source`
- **assemble.take[i].crop** — required when present: `box`, `resample` (issue #973, additive, whole-layer entries only). `box` is an inside nonempty integer source-painting `[left, top, right, bottom]` with exclusive right/bottom. `resample: "bilinear"` is required explicitly. Donor input must match the square-padded crop under taken support plus its margin. Unit scale and integer translation copy RGBA exactly; other maps use the declared premultiplied float32 affine filter. Absent, the shipped geometry predicate and refusal message remain unchanged. Region entries reject this field
- **assemble.take[i].reference** — required: `sha256`; optional: `source`, `painting` (issue #1031). Exactly one of `source: true` or a config-relative `painting` PNG is required. The reference governs colour only and geometry follows `--source`. A region take requires an opaque `--source` because its donor must match the run input and the inputs command refuses see-through paintings, so flatten the plate first.
- **assemble.editor_receipts** — required: `receipts`; optional: `required` (issue #946, additive), `trace_parts` (issue #947, additive)
- **assemble.editor_receipts.receipts[i]** — required: `file`, `sha256`, `from_sha256`, `editor` (issue #946)
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

`assemble.seam` accepts `near-white` or `silhouette` (issue #905). CLI
`--seam` overrides config, then the existing `near-white` default applies.
Invalid values refuse as `CONFIG_FIELD_TYPE` at `config.assemble.seam`;
an absent field preserves existing output bytes.

`assemble.project` accepts `core` or `visible` (issue #953). CLI
`--project` overrides config, then the existing `core` default applies.
Invalid values refuse as `CONFIG_FIELD_TYPE` at `config.assemble.project`;
an absent field preserves existing output bytes. The bytes `visible` writes
are not promised across versions (issue #953 resolves its edges from the
painting).

`assemble.ground` accepts `plain` or `busy` (issue #996). Invalid values refuse
as `CONFIG_FIELD_TYPE` at `config.assemble.ground`; an absent field and `plain`
preserve existing output bytes. It is read by `visible` only, whose bytes are
not promised. The `ASSEMBLE_GROUND_PLAIN` warning prints under `visible` only, is a
report line and never changes output.

`TY14` holds the set of field names in backticks above to the set of names the
loader's object checks spell (every `c.object(…)` in `src/config.ts`, with the lists
they name), in both directions, and refuses an object check whose key list it cannot
read. It holds the names, not their nesting or which are required: the `config`
suite's controls hold those, refusal by refusal.

The values a field takes (`retriangulate` is "delaunay", `removalOrder`
"deformation-load", `selection.policy` "multi-interval"; the units and ranges of
every number) are AUTHORING §3's tables, and the loader refuses any other by name.

## Files this package writes

### Source cover report

`assemble` and the assemble stage of `build` always write `source_cover.json`
beside `parts.json`, with spec `rig-parts-source-cover/1`. `stage`, `predicate`
and `sets` declare projection-input cover. Each set includes its painting hash,
rig grid, hash-bound inputs, effective source inventory, evaluated part rows,
inherited primary references, hidden parts and output asset mappings. Cover
rows carry owning source identity, planned membership and native pixel counts
and spans. A derived alternate row's optional `source_of` names its parent
source-plan reading before partitioning. Held-under-cover support is separate.
Empty readings remain explicit.
The report measures direct cover before projection and downstream processing.
The field semantics are documented in AUTHORING's source projection cover entry.

### Plate receipt

`comfy plate` (issue #1183) writes `receipt.json` beside `plate.png` and
`mask.png`, spec `rig-parts-plate-receipt/1`. Its keys, their order and their
meaning do not change within the spec; a key added, removed or redefined is a
new spec version. Every path in it is relative to the receipt's directory.

| key | meaning |
| --- | --- |
| `spec` | `"rig-parts-plate-receipt/1"` |
| `mode` | `"background"` or `"foreground"` |
| `painting` | `{ path, sha256 }` of the painting read |
| `mask` | `{ source, from, path, sha256 }`: `source` is `"seethrough"`, `"figure-mask"` or `"matte"`, `from` the source directory, `path` the mask actually used (`mask.png`, opaque white inside) |
| `model` | `{ name, checkpoint_sha256, checkpoint_sha256_from }`, or null for `foreground`. `checkpoint_sha256` is the `--checkpoint-sha256` value, lower-cased; `checkpoint_sha256_from` is `"declared"`: the box reports no hash, so this field is **declared, not measured** |
| `params` | every parameter of the run, the seed included, in a fixed order per graph: `lama` — `seed`, `grow_px`, `mask_alpha_above`; `core` — `seed`, `grow_px`, `steps`, `cfg` (`--cfg`, default `6`), `sampler`, `scheduler`, `denoise`, `prompt`, `negative`, `mask_alpha_above`; `foreground` — `mask_alpha_above` |
| `graph` | `"rig-parts/plate-background-lama/1"`, `"rig-parts/plate-background-core/1"`, or the fixed local id `"rig-parts/plate-foreground/1"` |
| `gpu` | the device `/system_stats` names (the same seed gives other pixels on another GPU), or null for `foreground` |
| `grid_transform` | present only when `mode` is `"background"`, `graph` is `"rig-parts/plate-background-core/1"`, and the painting's width or height is not a multiple of 8 (issue #1209, additive): `{ source: [width, height], padded: [ceil(width/8)*8, ceil(height/8)*8], pad: [0, 0], pad_fill: "edge-replicate", mask_pad_fill: "zero", inverse: "crop" }` in that key order. Omitted for on-grid `core`, `lama`, and `foreground` |
| `output` | `{ path, sha256 }` of `plate.png` |

The receipt is read back against the bytes on disk before `<out>` is published;
a hash that is not its file's refuses the run. `verifyPlateReceipt` also
re-derives `grid_transform` from the decoded painting, `mode` and `graph`, and
refuses a missing, unexpected, malformed or mismatched transform as
`PLATE_RECEIPT_GRID_TRANSFORM`. For off-grid `--graph core` paintings, the
uploaded painting is padded on the right and bottom by replicating its edge
pixels (`pad_fill: "edge-replicate"`), the uploaded grown mask is padded with
zero (`mask_pad_fill: "zero"`, kept as context outside the hole), the box's
output is required at `padded` dimensions (`COMFY_PLATE_SIZE` otherwise) and
cropped at `[0, 0]` back to `source` before pasting inside the native mask, so
pixels outside the hole equal the painting byte for byte. On-grid `core`
paintings retain their original upload bytes, graph and 9-key receipt. Because
every painting grid is covered by this transform, `PLATE_CORE_GRID` is retired.

### Matte source receipt

`comfy matte` writes `model-mask.png` (the exact downloaded grayscale model
output), `mask.png` (opaque binary mask on the painting grid) and `receipt.json`,
spec `rig-parts-matte-receipt/1`. Node and model are explicit flags. The supported
pair is `BiRefNetRMBG` / `BiRefNet-HR-matting`. The model file must also appear in
`/models/RMBG` before any upload. Queue submission appends behind existing jobs.
The node has blur and offset zero, inversion and foreground refinement disabled.

The ordered receipt keys are `spec`, `painting`, `model`, `params`, `graph`,
`gpu`, `input_transform`, `input_sha256`, `raw_output`, `output`. `painting`
records its relative path and the SHA-256 of the source file bytes. `model`
records node, name, `checkpoint_sha256` and `checkpoint_sha256_from: "declared"`.
`params` records every node option, resolution, threshold and
`mask_rule: "red-above-threshold"`. `graph` records
`id: "rig-parts/matte-BiRefNetRMBG/1"`, the submitted API graph and its SHA-256
(over UTF-8 `JSON.stringify(api)`). `gpu` is the device the server names.
`raw_output` and `output` each record a fixed relative path, SHA-256, width and
height. Paths to output masks cannot redirect the reader to another file.

For a non-square painting, `input_transform` uses the #1197 shape documented
below. Its `pad_fill` describes the model's input after `LoadImage` IMAGE
separates alpha from RGB. The matte graph feeds that IMAGE output to the model.
`input_sha256` binds the prepared PNG upload. Square paintings retain their
original upload bytes and record a null transform. Resolution defaults to 1024
and applies to the non-square prepared square. It must be a multiple of 8 in
[64,2048]. The threshold defaults to 10 and must be an integer in [0,254].
Each grayscale byte strictly above the threshold becomes foreground. The recorded
nearest-pixel-centre inverse maps that classification to the painting grid.

`--mask-from matte:<dir>` binds the supplied painting's exact bytes, both mask
file hashes, the prepared input, the complete graph, and the final mask's exact
reproduction from the raw mask and recorded parameters. Missing or legacy
receipts, another painting, tampering, inconsistent geometry and empty masks
are named refusals before any plate output or network request. A matte source is
available to both plate modes. Staged output is read back before publication.

### Head-crop preflight stdout

`head-crop-preflight` writes one JSON object followed by a newline on success,
with `spec: "rig-parts/head-crop-preflight/1"`. Its fields are

| field | meaning |
| --- | --- |
| `head_box` | supplied `[left, top, right, bottom]` in painting coordinates |
| `source_canvas` | supplied painting `{ w, h }` |
| `run_canvas` | full-run `{ w, h }` |
| `drawn_alpha_above` | exclusive alpha threshold, `8` |
| `pixel_grid` | `"full-run"`, the native sample grid |
| `registration` | `{ scale_source_per_run, pad_left, pad_top }`, mapping run sample centres into painting coordinates |
| `layers` | rows in full-run layer order, including zero-hit tags |
| `layers[].tag` | full-run layer name |
| `layers[].drawn_px` | native samples above the alpha threshold |
| `layers[].sides` | `{ top_px, left_px, right_px }`, samples beyond those crop edges |
| `layers[].bottom_px` | samples beyond the bottom, separate for `extend_below_crop` |

Corner samples count on both edges. Counts remain native samples before ghost
cleanup. A positive count reports clipping and unknown input is not a negative.
Each hit tag gets one `HEAD_CROP_PREFLIGHT` advice line on stderr. Valid clipping
exits zero. Malformed geometry or a box outside the painting is refused before
JSON is emitted. This command writes no files.


`assemble` and `build` declare `painting_in_rig` in parts.json as
`{ path: "painting_in_rig.png", sha256, resample: "lanczos3-rgb-opaque" }`.
The sibling PNG is the exact rig-resolution raster assemble used: source RGB
forced opaque before PIL-exact Lanczos3 resizing to `rig_size`. Package readers
verify its file hash, dimensions and opaque alpha. Legacy manifests may omit it.
Readers released through 2.17.0 refuse this new top-level key as
`PARTS_KEY_KNOWN`; use a reader that supports the declaration.
Adding the declaration makes earlier revision and depth receipts stale under
their existing whole-file parts.json identity contract; regenerate them.
Check's setup-painting comparison still flattens over its backdrop at source
resolution before resizing; it can differ for non-opaque paintings.

| file | written by | what is stable |
| --- | --- | --- |
| `stage-map.json` | `assemble`, `build`, under `assemble.stage_map: true` | `rig-parts-stage-map/1`, cropped last-writer and pre-seam RLE maps with writer dictionaries and excluded counts. See [Per-pixel stage map](AUTHORING.md#per-pixel-stage-map). |
| `parts.json`, `parts/<name>.png` | `assemble`, `build` | one record per part: `from` (`<run>:<tag>` with a See-through v3 tag, `<run>:author:<label>` for a layer the author made — issue #256, read by no role rule — or `painting:<name>` for a patch), `cut_from` on a cut's piece only (the plan part it was cut from, issue #230), `limb` on a limb segment's part only (issue #349: `name`, `segment`, `of`, `bone`, and below a joint `joint`, `range` when the config segment declares one (issue #360), and `cap` — `at`, `width`, `radius`, `box`, `layer_px`, `image_px` with a cap image, `image_layer` after it when that image was a hidden-art layer — issue #359, `<run>:<layer>:hidden` — `missing_px`, `short_px` (`left`, `right`) after it only when `missing_px` is above 0 (issue #557, additive), `excluded_px` after them only on a subset set's limb part whose cap the set exclusion took a pixel of (issue #603, additive: each pixel taken out of the count it was in, so the cap's counts are the written PNG's), then `shape` and `upper_px` under the segment's `cap_shape` — `upper_px` without the shape only when the upper segment gave a pixel (issue #557, additive) — and after them `lower_px`, `lower_kept_px` and `lower_missing_px` under `cap_shape: "ball"` (issue #579, additive), and `edge`, `feather_radius` and `feathered_px` under its `edge`, and `cut_band`, `cut_offset`, `cut_at`, `cut_crossed`, `joint_crossed`, `band_px` and `stroke_luma_max` (when the band has a split) under its `cut_band`, issue #360), the box `x`, `y`, `w`, `h` (rig px), the pixel counts `src/parts.ts` documents (`opaque_px`, `visible_px`, `occluded_px`, `projected_core_px`, `source_px_taken`, `visible_not_projected_px`, `refused_drift_px`, `merged_px` — on a subset set's limb part counted after the set exclusion, issue #603 — `seam_override_px`, and `fringe_pushed_back` when not empty); per-part `provenance` (`unchanged_layer_px`, `hand_px`, `automatic_px`, `edits`, `automatic`, additive, issue #823); optional top-level `motion_seams`, `alternates` and `cut_ownership` (one row per cut, independent of RGBA equality, issue #823); `rig_size`, `scale_rig_per_source`, `ghost_px`, `recomposite`, and `scene` (`figure_alpha_above`, `figure_px`, `figure_mask`) under `config.scene` only, with the figure's mask `figure_rig.png` beside the recomposite (issue #242), and the same bytes beside `parts.json` when the two directories differ (issue #1177); `single_run_pad` (`file_size`, `side`, `left`, `top`) last, only for one run whose file is not the `seethrough.resolution` square (issue #366) |
| `rig/rig.json`, `rig/motion.json`, `rig/images/` | `rig`, `build`, `compose` | rig-c's rig spec and motion spec, `spec` `rigc-rig/1` and `rigc-motion/1`: the format is rig-c's, and this package writes only what rig-c's parser accepts; a bone carries `inherit` only where config.bones declares one, rig-c's mode name as written (issue #348) |
| `rig/mesh_report.json` | `rig`, `build` | one row per mesh: `part`, `vertices`, `triangles`, `hull`, `bones` (the sorted names the attachment's weights bind in the written `rig.json`, in every mode — since 1.49.1 (issue #536) a rig with `turn` or `stops` names the twins and `<link>_d` bones there, where the row named the segment bones they replace: a fix of a wrong name, not a format change; a rig with neither writes the bytes it wrote), `max_influences`, `mean_influences`, `art_coverage`, then `grid` (a lattice); or `mode` "explicit" with `image_sha256` and `region_sha256` (the verified guards; counts and coverage are measured from the supplied mesh, no legacy generator report is adopted); `mode` "contour" with `params`, `contour`, `regions` (`params.maxEdge` and `contour.outlineCut` only when the mesh declares `contour.maxEdge`; `params.bridges` and `contour.bridges` — `islands`, `units`, `joins`, and `faint` only when an island was left out as faint — only when it declares `contour.bridges`); or `mode` "influence" with `influence` (as declared), `reach` (`farthest`, `at`, `nearest`, `capped`, `widest`) and `lattice` (rig-c's `SegmentsLatticeReport`: `cols`, `rows`, `artCells`, `keptCells`, `passes`, `islands`) (issue #378); or `mode` "auto" with `settings`, `source`, `result`, `residuals`, `worst_residual`, `worst_region`, `motion_amplitude`, `termination`, `weights`, `regions`, `deformation`, `quality_report` (rig-c's `mesh-quality-report/1` document whole), `motion_report`, and, only when they apply, `stray_cleared` (after `source`, when `source.stray` is declared), `skinning_residual` and `replay` (`AutoMeshReport` in `src/rig.ts`); in every mode, `exponent` when the mesh declares one (after `grid`, or after `mode`); `influences`, as declared, when a lattice or contour mesh declares it (after `exponent`, or where `exponent` would be); `stray` and `stray_cleared` when a lattice mesh declares `stray` (after `influences`, or where `influences` would be); `ribs` when a contour or auto mesh declares them (after `exponent`, or after `mode`), and then `contour.ribs` (`source.contour.ribs` in the automatic mode) |
| `check/check.json` and the rest of `check/` | `check`, `build`, `compose` | the reference's fields in its order (`gate_spine_html_green`, `rigc_entry`, `pack_mode`, `environment` after it under `--environment` only (issue #538, additive: `path` as given, `sha256`, `steps`), `loop_max_diff`, the seam figures — `seam_mean`, `seam_px_over_40`, `seam_px_over_80` and, from issue #216, `seam_frame_scale`, the frame scale the bar divides the count by), `loop_physics` after `loop_max_diff` when the rig declares a physics constraint, `seam_border` after the seam figures when `parts.json` declares a scene (issue #242), `seam_pairs` after the seam figures when the seam bar fails or `--seam-pairs` asks (each row's picture under `check/seam/`; `--keep-stills` leaves the setup-pose still and its `frames.json` under `check/setup_still/`), then the judgement lines (`BREATH_VISIBLE`, `BLINK_NO_HOLE`, `CHAIN_LAG`, `TIP_OVER_ROOT`, `STILL_REGIONS_DARK`, `TEXTURE_STRETCH`), `ANIMATIONS_DO_NOT_FOLD` after them when `motion.json` holds an animation, the idle included — on every rig with an idle since issue #333 (issues #320, #363: `status`, `animations`, `fps`, `physics_left_out`, `folding` — each `animation`, `slot`, `attachment`, `frames`, `worst_frame`, `worst_triangles`, `triangles`, `physics_on`, `physics_off`, `physics_constraints`, `declared`, `line` — `folding_undeclared`, `declared_not_folding`, `bar`), `FEET_STAY_LEVEL` after it when a `footwear` part rides a bone that hangs from another and `motion.json` holds an animation (issue #348: `status`, `reason` on a SKIP only, `animations`, `fps`, `physics_left_out`, `bar_degrees`, `bar`, `feet` — each `part`, `bone`, `hangs_from`, `status`, `frames_posed`, `worst`), `LIMB_ONE_BONE` after it (and after `STRESS_OFF_CHAIN` where that is written) when `parts.json` holds a limb segment's part (issue #349: `status`, `parts` — each `part`, `limb`, `bone`, `status`, `others`), `SEAM_OVER_RANGE` after it when a limb record carries a `range` (issue #360: `status`, `frame_scale`, `physics_left_out`, `bar` — `mean`, `rig_px_over_40`, `level` — and `joints`, each `part`, `limb`, `segment`, `joint`, `bone`, `range`, `at`, `radius`, `under_px`, `status`, `poses` — each `degrees`, `status`, `mean`, `px_over_40`, `px_over_80`, `rig_px_over_40`, and `step_px` (`left`, `right`) only on a joint whose cap record carries `short_px` (issue #557, additive) — and `unread` on a joint not read), `SEAM_OVER_MOTION` after it when `parts.json` holds a limb segment or `--requirements` a `seam` (issue #493 retains existing pair warnings; issue #686 gates GAP on proven body-root pairs only (gap-only; mixed ghost remains INFO until rig-c/core#1555 supplies owners): `status` — `WARN`, `CLEAR`, `SKIP` or `FAIL` — `reason` on a SKIP only, `fps`, `floor`, `pairs` — each `pair`, `a`, `b`, `declared`, optional `root` (`limb`, `bone`, `parent`) on a proven body-root pair, and `unread` on a pair not read — `animations`, `warnings`, `rows` — each `pair`, `animation`, `status`, `drawn`, `banded`, `opens`, `px`, `max_px`, `under_floor`, and only on new-root rows stock `gapOpen` plus UNDER-owned `ghostA`/`ghostB` cells selected by resolved per-frame draw order gate their summed count against the unchanged strict one-cell floor on the original raw kind boxes (their union when both kinds contribute), never narrowed partition boxes, while `gapCovered` and OVER-owned ghost cells are excluded (issue #711); `cells` retains partition counts, UNDER owner and counted total, `worst` retains frame/count/cell/box, and `roots` retains status, mode `gap-open+under-ghost`, ghost_owner `resolved-draw-order`, pairs, failed, reason and optional unmeasured bindings; eligible candidates whose valid setup bands are all zero retain a named unmeasured root and SKIP bar, including when no pair is selected; measured root FAIL wins over SKIP, while measured PASS plus an unmeasured root remains SKIP; every eligible body drawing with stock setup `banded > 0` is selected, including both when a parent is shared; issue #708 resolves a body slot on its exact generated turn child to the same named carrier only after unique identity-bone/control/per-part-transform proof, without changing pair identity, setup selection or the direct-carrier path; setup-only observation preserves the authored motion and default drawing, root-free inputs add no setup compile/render, and no animation remains SKIP rather than a measured zero; existing internal pair warnings and their exits are unchanged; issue #941 adds optional `required` only under the requirements file's `seam_over_motion.required: true` — `status` (`PASS` or `FAIL`), `mode` `gap-open`, `bar_px` 0, `pairs` (each `pair`, `class` — `body-root`, `internal-joint` or `explicit` — `frames`, `background_frames`, `max_px`) and `failed` — and with it the key is written even when no pair is declared; issue #591 adds optional `worlds` on physics rigs with readable declared pairs and animations: `default` and `still`, each `wind`, `gravity`, `status` (`REPORTED` or `SKIP`), `reason` on SKIP, `dir` only when rendered (relative to check.json: `seam_motion/default` or `seam_motion/still`, the complete retained render with frames.json and each animation's raw seam.json), and `rows` — pair, animation, status, drawn, banded, `gap` and `ghost`, each `max_px` and `worst` only; worst carries `index`, `px`, `cell`, `box`. Per-frame hits stay in the raw sidecars. These raw reference readings add no bar or warning and leave the custom environment reading unchanged), `CLOTH_SETTLES` after it when the rig declares a physics constraint and has an idle (issue #501, a warning and not a bar: `status` — `WARN` or `CLEAR` — `fps`, `frames`, `duration`, `floor_rig_px_per_s`, `floor`, `levers`, `warnings`, `rows` — each `tip`, `root`, `links`, `point`, `settles_at`, `max_rig_px_per_s`, `min_rig_px_per_s`), `RECOMPOSITE_HOLES` (its first figure `declared_scene` when `parts.json` declares a scene), `SETUP_POSE_VS_SOURCE`, `WIND_BAND` after it under `--wind-band` only (issue #590, additive: `status` `"REPORTED"`, `spec` `"rig-parts-wind-band/1"`, `path` as given, `sha256`, `steady_wind_only` `true`, `gravity` `[0, 1]`, `min`, `max`, `step`, `steps`, `fps`, `animations`, `max_gap`, `max_ghost`, `holds_from`, `holds_to`, `pairs_holding_all`, and `pairs` — each `pair`, `a`, `b`, `holds_all`, `holds_from`, `holds_to`, `first_break_below`, `first_break_above`, `worst_gap`, `worst_ghost`, `steps`), `skipped`, `config` under `build` only (issue #607, additive: `path` as `--config` was typed, `sha256` of the bytes the build read; `check` and `compose` read no config and write none), a `requirements` block under `--requirements` (or `build`'s `config.requirements`) — `file` first from issue #556, additive: `path` as typed or declared, `sha256`, `keys` — and `PASS`; `check/build/skeleton.json`, `.atlas` and `.png` are the packed artifact rig-c writes. Missing stock partitions or resolved owner are named refusals, never zero. No whole-box exemption or consumer compositor remains; internal warnings and reference raw readings are unchanged. |
| `part_support_domains.json` | `assemble`, `build` | optional `rig-parts-support-domains/1` independent cut masks and unavailable reasons, with per-domain config-entry provenance and parts/PNG/payload digests; additive beside parts.json, whose bytes and PNGs are unchanged. Legacy output may omit it. `PART_SUPPORT_REPORT` reads pairs in the assembly placement frame and Unowned in actual setup, never as an acceptance gate. |
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
| the scene report | `compose` | spec `spine-parts-scene-report/1`; the plate block carries `sha256` of the plate PNG's bytes after `size` (issue #1183, additive under *What "stable" means here*: a new report key in a minor version, so the spec stays `/1`) |
| `idle.png`, `idle-indexed.png`, `idle.gif` | `loop`, `build --loop` | APNG and GIF encodings of the rendered idle |
| `run.json` | `rig`, `assemble` | spec `rig-run/1` (issue #1165, additive): `spec`, `package` (`name`, `version`), `command` (`"rig"` or `"assemble"`), `started_at` and `finished_at` (UTC ISO-8601 millisecond timestamps ending in `Z`, read in the CLI layer), `config` (`path` relative to `--out`, `sha256` of the config file on disk), and `outputs` (`path` relative to `--out`, `sha256` of each written output file on disk, sorted by `path` in code-unit order and excluding `run.json` itself); written only after the command's gate is green |

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
Renderer metadata and exact raster reads use the promised `@rig-c/core/render-shared` entry (from rig-c 2.69.0). It registers no Spine runtime; where that runtime resolves from rig-c's own package root, the existing `@rig-c/core/render` entry registers the official Spine side explicitly. An install without Spine keeps rig-c's own candidate chooser and gate; candidate or loader failures never select a guessed fallback.

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

See-through run metadata (`meta.json`, written by `comfy seethrough`) includes
`image_sha256` (the SHA-256 of the original `--image` PNG bytes) and `layers`
(each written layer PNG's `{path, sha256}`, `path` relative to the run
directory) (issue #1188, additive under *What "stable" means here*). `comfy
plate` with `--mask-from seethrough:<dir>` binds every layer file read and
`--painting` against those hashes and refuses a legacy `meta.json` that lacks
them.

Non-square inputs are prepared by parts before upload (issues #1197, #1205).
Their additive `input_transform` records `source: [width,height]`,
`padded: [side,side]`, `pad: [left,top]` in padded pixels, `scale` (target
side divided by padded side), `resample: "parts-lanczos3-rgba"`,
`pad_fill: "rgba-zero"` (`"rgb-black-opaque"` for a graph that reads `LoadImage`
IMAGE only, and on 2.27.2 `seethrough` records, which readers continue to accept),
`target: [resolution,resolution]` and `inverse: "nearest-pixel-centres"`.
The enclosing `image_sha256` is the single source-image hash. Preparation
zero-fills the square, places the source at floor-centred offsets, and runs
parts' RGBA Lanczos3 resampler. The wrapper receives the configured square.
In `workflows/seethrough.json`, `LoadImage`'s `IMAGE` (output 0) and `MASK`
(output 1) rejoin through ComfyUI's core `JoinImageWithAlpha` node before
`SeeThrough_GenerateLayers`, so the 4-channel RGBA image reaches the model
with `alpha = 0` on the padded area and `page_alpha` masks layer alpha to zero
outside the source rectangle, matching the wrapper's internal pad semantics.
Square inputs keep the existing upload bytes, omit `input_transform`, and for
opaque square inputs (whether RGBA or RGB-only PNG) reach the model with the
same `alpha = 255` tensor as before; a square input that itself carries
transparent pixels now has that transparency forwarded to the model instead of
dropped at `LoadImage`.
For each source pixel `(x,y)`, the inverse samples the layer union at
`floor((x+left+0.5)*scale), floor((y+top+0.5)*scale)`.
Exactness holds for representable masks, and detail below the See-through
grid's resolution is not recovered. Missing records on another grid and
invalid records refuse `PLATE_MASK_GRID`, while mismatched source bytes
refuse `PLATE_MASK_PAINTING`. Existing runs are never backfilled.

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

### Run stamp (`run.json`, spec `rig-run/1`)

The CLI commands `rig` and `assemble` (when writing `--out`) write `<out>/run.json`
after all stage gates pass and all other output files are on disk:

```json
{
  "spec": "rig-run/1",
  "package": { "name": "@rig-c/parts", "version": "<package.json version>" },
  "command": "rig",
  "started_at": "2026-11-07T00:00:00.000Z",
  "finished_at": "2026-11-07T00:00:01.000Z",
  "config": { "path": "../config.json", "sha256": "<hex>" },
  "outputs": [
    { "path": "images/cloth.png", "sha256": "<hex>" },
    { "path": "mesh_report.json", "sha256": "<hex>" },
    { "path": "motion.json", "sha256": "<hex>" },
    { "path": "rig.json", "sha256": "<hex>" }
  ]
}
```

Key order is fixed as shown; `outputs` is sorted by `/`-separated `path` in UTF-16
code-unit order. Every `path` in `config` and `outputs` is relative to the `--out`
directory (`../`-prefixed when `--config` sits outside `--out`; never an absolute or
home path). Every `sha256` is computed from the bytes on disk after writing. A refused
run writes no `run.json`. By default, `started_at` and `finished_at` record wall-clock
time read in `cli.ts` (`src/` remains pure). With that default, `run.json` is outside
the byte-for-byte
determinism comparisons (`RG03`, `RG19`, `AS07`); for the same input at the same
relative `--config` layout, two `run.json` files differ only in `started_at` and
`finished_at`.

Set `SOURCE_DATE_EPOCH` to opt into a fixed clock: both timestamps equal that
instant in UTC ISO format, without adding a stamp field. The value must match
`^(0|[1-9][0-9]*)$` and be at most 253402300799 seconds
(9999-12-31T23:59:59Z), preserving the four-digit-year ISO form.
253402300800 and above are refused. Empty, negative,
fractional, non-numeric, noncanonical and out-of-range values refuse
`RUN_STAMP_EPOCH`, naming the variable, found value and requirement before any
output is written or an existing stamp is removed. Unset preserves the existing
wall-clock path and stamp format. Fixed clocks make stamps byte-identical for
identical inputs and the same relative config layout.

`outputs` lists exactly the files the stage wrote in this run, derived from what the
stage returns, not from a walk of `--out`: a stray or earlier file under `--out` is
neither hashed nor listed. Before the stage starts, the command removes an earlier
`<out>/run.json`, so a run the stage refuses, into a reused `--out`, leaves no stamp
(a usage error, exit 2, stops before that and touches nothing under `--out`). A
`package.json` without a non-empty `name` and `version` refuses `RUN_STAMP_PACKAGE`
and writes no stamp. `build` and the in-process stages write no `run.json`.

`rig-run/1` is stable: its keys, their order and their meaning do not change within
the spec. A key added, removed or redefined is a new spec version.

## Environment

The installed package reads two environment variables and no other: `PATH`, where
the launcher finds Bun and the CLI finds the `rigc` its own `node_modules` holds,
and `COMFY_HOST`, which `comfy paint` and `comfy seethrough` read when `--host` is
not given (it has no default). `RIG_PARTS_CORPUS` and `RIG_PARTS_SELFTEST_JOBS`,
with their former `SPINE_PARTS_` names read when they are not set, are the
selftest's, a development interface of this repository: the selftest does not ship
in the package.

## rig-c

`dependencies` takes `@rig-c/core` `3.0.0` exactly. Bun 1.4 or later
is the declared floor (`engines.bun` `>=1.4.0`; older 1.4 releases are not tested in
CI, which runs `latest`, and compatibility with an older 1.4 release is handled when
reported as an issue). What this package relies on in rig-c, every import
read off `src/` and `cli.ts`:

- the named entries its `exports` map carries (from `@rig-c/core` 3.0.0 `./*.ts` deep
  file paths are gone, and `TY39` refuses any in the tree):
  `@rig-c/core/mesh` (the outline functions, `measureAuthoredMeshFit`, `reduceMesh`,
  `skinningEnvelopeBone`, `writeMeshQualityReport` and their types),
  `@rig-c/core/meshcompare` (`compareMeshesInMotion`, `comparePreparedMotion`,
  `prepareMotionReference`), `@rig-c/core/compile` (`f32`), `@rig-c/core/core`
  (`RUNTIME_PI`), `@rig-c/core/deformgen` (`evaluateDeformTransform`),
  `@rig-c/core/environment` (`ENVIRONMENT_SPEC`, `EnvironmentError`,
  `environmentResponse`, `readEnvironmentSchedule`), `@rig-c/core/errors`
  (`CompileError`), `@rig-c/core/font5x7` (`GLYPH_H`, `drawText`),
  `@rig-c/core/passthrough` (`DRAWN_ALPHA`), `@rig-c/core/plate` (the PNG codec),
  `@rig-c/core/png` (`assertPng`), `@rig-c/core/render` (`GeometryFile`,
  `GeometryFrame`), `@rig-c/core/render-shared` (`Viewport`), `@rig-c/core/rig`
  (`parseRigSpec`, `RIG_SPEC_VERSION`, the constraint keys and types),
  `@rig-c/core/stop` (`expandStops`) and `@rig-c/core/transform` (the y flip and
  frame transforms, through `src/coords.ts` only);
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
padded `size`, and `depth`; a still split names both slices). Passive references
add these companions without changing weighted geometry. Active `"surface"`
roles in `turn.roles` and `turn.body.roles` consume registered sheets:
region surfaces emit Core grid generators with `generator.depth`; authored
weighted surfaces keep their topology and bindings and emit sampled per-influence
inverse-bind deform offsets in motion, without adding a Core attachment depth
field. Head yaw/pitch and independent body yaw use their existing turn groups.
Blended surfaces retain the documented per-group masks and setup-overlap
neighbour field rules in [AUTHORING](AUTHORING.md#per-layer-depth-sheets-773).
`RIG_TURN_BODY_UNCOVERED` is a report-only warning for a shown torso part
without a body role that has opaque setup-triangle overlap with a moved body
surface and different emitted endpoint displacement. It names the part, surface,
times, vectors and relative travel. Head/neck bindings, transparent/excluded
alpha, explicit/inherited body roles and identical inherited motion are excluded as
described in [AUTHORING](AUTHORING.md#missing-body-turn-coverage). It assigns
no role or depth and changes no emitted file bytes.
The unit-depth precedence and its primary-surface sampling are documented in
[AUTHORING](AUTHORING.md#unit-depth-precedence).
The separate ordering scalar is unchanged. No-image outputs retain legacy bytes.

### Declared setup-painting regions

| Optional field | Additive contract |
| --- | --- |
| `setup_painting.figure_mask` | Verified source-grid alpha support restricts region counts and opts busy-ground visible assembly into bounded hole and interior-translucency restoration; omission preserves the shipped domain and output bytes. |

The optional `setup_painting.figure_mask` (issue #974, additive) declares a
`path` and byte `sha256` for independent figure alpha support on the original
painting grid. Paths resolve relative to requirements. Alpha above zero is
sampled at nearest source pixel centres onto the stage, with empty support
refused. Region limits count only inside that support. Outside-mask uncovered
mismatches have their own unbarred stage-wide row. The verified declaration is
recorded in the report. Omitting it preserves existing output bytes and the
shipped domain predicate. Assemble reads the same requirements declaration through
the explicit requirements flag or config.requirements. Busy-ground visible
restoration requires pre-step and assembled four-neighbour support, prefers the
frontmost pre-step holder, then nearest pre-step owner with frontmost ties.
Keep, feather, locked and moving-pair boundaries remain excluded. Plain-ground
assembly keeps its existing path.
Busy-ground visible assembly validates config.requirements and its flag correspondence, refusing malformed requirements or unverifiable figure masks before writing.

The optional `setup_painting` key in `spine-parts-requirements/1` adds a
`SETUP_MATCHES_PAINTING` measurement when declared. It requires authored
`rgb_tolerance` and named native-stage boxes. Each optional `max_pixels` is
that whole region's limit; omission is SKIP, never PASS. The optional boolean
`setup_painting.required` (issue #943, additive) is the author's declaration
that the check may not SKIP: with `true`, an absent `rgb_tolerance`, `regions`
or region `max_pixels` is refused by name as `SETUP_PAINTING_REQUIRED_LIMIT`
when the file is read, before anything is built, and no limit is derived; a
fully limited declaration measures, prints and writes the same bytes as
without the field. Absent or `false`, every reading in this section is
unchanged. `build` hands its `--source` painting to its check when, and only
when, the requirements file it reads declares `setup_painting` (issue #978),
so the declaration reads the verdict `check --source` reads on the same output;
a build whose requirements do not declare it, or that reads none, writes the
bytes it wrote before. The optional `pinholes` key (issue #944, additive) declares
`assemble`'s pinhole bar: with `{"required": true}`, `assemble` (and `build`'s
assemble) refuses every pinhole of the base set's flat parts stack by name as
`ASSEMBLE_PINHOLES` before anything is written — the bar is 0 and takes no
value. Absent or `false`, nothing is measured, the console's
`ASSEMBLE_PINHOLES: SKIP` line says so, and no exit code, file or other line
moves. The optional `seam_over_motion` key (issue #941, additive)
declares `check`'s background bar: with `{"required": true}`, every declared
`SEAM_OVER_MOTION` pair — body-root, internal-joint and explicit — is refused
by name as `CHECK_SEAM_OVER_MOTION_REQUIRED` on any frame of any animation (12
fps, every frame) with rigc `gapOpen` cells above 0, and a line or pair that
measured nothing is refused too; `check.json`'s `SEAM_OVER_MOTION` gains
`required`. The bar is 0 and takes no value. Absent or `false`, nothing is read
and no exit code, line or byte moves; the existing warnings and the body-root
bar are unchanged.
The optional `boundary_colour` key (issue #942, additive) declares `check`'s
`BOUNDARY_COLOUR_STEP` bar: with `{"max_step_excess": <0-255>}` (an authored
integer; no default exists), `check` measures every part boundary of the setup
and every idle frame against the rig's own pieces, writes the
`BOUNDARY_COLOUR_STEP` block to `check.json`, and refuses each part pair over
the allowance as `CHECK_BOUNDARY_COLOUR_STEP`, or a reading it cannot take as
`CHECK_BOUNDARY_COLOUR_UNMEASURED`. Absent, nothing is measured or written,
the console's `BOUNDARY_COLOUR_STEP: SKIP` line says so, and no exit code,
file or other line moves. With `--source` but
no declaration, the console, `check.json` and the report's skipped-bar list now
say SKIP with the reason and the `--requirements` declaration remedy; exit
codes stay unchanged. No metric, region or limit is invented. Without source
and without the key, the line stays absent. Declared output bytes and renderer
calls remain unchanged. `check --json` prints the completed `check.json` bytes
to stdout and keeps the ordinary check's exit code; early input refusals and
usage errors keep their existing named text and exits. `build --json` is refused
with a `check --json` remedy; build keeps its multi-stage text report. Other requirement fields
remain independent. The [authoring contract](AUTHORING.md#setup-against-the-painting)
defines white compositing, the figure domain, strict RGB comparison, top
contributor attribution and named measurement refusals. The check observes the
actual renderer setup at scale 1; it neither fits the art nor duplicates core
validation. Only this declared check composites source RGBA over white at its
original resolution **before** existing Lanczos3 stage resampling. Setup RGBA
is composited on the native stage grid. Source readers preserve alpha; the
global RGB-only source helper and checks without this declaration are unchanged.

The optional `cut_material` block in `--requirements` declares a part, joint,
independent stage-pixel centre, inward axis, reach and continuous bend interval.
`assemble --requirements` and `build --requirements` write source-edge evidence
only for that explicit block; `check --requirements` refuses unavailable or
stale evidence rather than reconstructing original art from emitted siblings.
Without the block the API reading is SKIP; CLI stdout and emitted bytes remain unchanged.
See [Source before scissors](AUTHORING.md#source-before-scissors).

### Scene plate editor receipts

`scene.plate.editor_receipts` (issue #966, additive) is optional and uses the
assemble receipt ledger shape, including `required` and `trace_parts`.
Receipt file paths resolve against the scene file. Declared receipts are
verified even without `required`; when required, the plate needs a verified
receipt matching its bytes. Receipt refusals occur before compose writes new
artifacts. As before, compose creates `--out` and clears its owned outputs,
including an earlier `rig/` and `scene.json`, before input validation, so a
refused re-run can remove earlier artifacts. Omitting the field preserves
exit codes and `scene.json` bytes. The existing required
`provenance` field is preserved. It declares pixel origin, while the receipt
verifies file identity and records the author's edit declaration.

### Editor receipts

The optional `assemble.editor_receipts` block (issue #946, additive) records
images edited in an image editor. Absent, no file is read and every output is
byte-identical. Declared, every receipt's `file` must exist and hash to its
`sha256` (`ASSEMBLE_EDITOR_RECEIPT_FILE`, `ASSEMBLE_EDITOR_RECEIPT_SHA256`);
`from_sha256` and `editor` are the author's declaration, held to form and to
`from_sha256` differing from `sha256` (`CONFIG_EDITOR_RECEIPT`). The optional
boolean `required` is the author's declaration that no edited image may go
without one: with `true`, every author-made layer, hidden-art layer, cut
`under` and limb `cap` the build reads needs a receipt matching its bytes
(`ASSEMBLE_EDITOR_RECEIPT_MISSING`), refused before anything is assembled.
Absent or `false`, nothing is demanded; a build whose receipts all verify
writes the same bytes as without the block. No input accepted before the block
existed changes its exit code: the refusals fire only on a block that input
could not have held. The optional boolean `trace_parts` (issue #947, additive)
is the author's declaration that every part's pixels trace to a layer of the
split or to a receipted image: with `true`, receipts are demanded as under
`required`, and every shape the config draws through a part (a cut's
`polygon`, `seethrough.arm_split`, a limb's `split.line`, a patch's `box`, a
painting extension's `band`) is refused (`ASSEMBLE_PART_SOURCE`) before
anything is assembled. Absent or `false`, nothing more is demanded and no byte
moves.

## Provider-map depth stages (#897)

The opt-in `depth-prepare` and `depth-apply` commands accept the separate
`rig-parts-depth/1` recipe and finite floating-point `rig-parts-map/1` JSON.
Prepared provenance is `rig-parts-depth-inputs/1`; application writes
`rig-parts-depth-report/1`, standard part depth references and a relocated
character config. Their schemas, frames, alpha threshold, normalization,
encoding, convexity sign and refusal remedies are in
[AUTHORING](AUTHORING.md#per-part-provider-maps-897). No existing build path
calls these stages; no-config builds retain their existing behavior and bytes.
Group numbers and unit depths are explicit; no provider or absolute scale is
inferred. A new depth stage never replaces Core's rig gate.
`relief` is an explicit rig-pixel value, not an implicit width multiplier.
Part-width and head-referenced calibrations are authored recipe choices;
changing a calibration requires preparing its recipe again. Compare the same
provider maps and preserve their provenance. Each report row names the part,
declared relief, group `zScale` and clipping over original alpha>=128 support;
it remains a measurement rather than a shape-quality gate.

The requirements file's `fps` becomes optional when no declared measurement
reads that rate (issue #965, additive for readers). Measurements in
`requirements` still require a positive `fps`, with no default. Declarations
whose instruments use their own rate keep that rate.
The output `check.json` omits `requirements.fps` when the file supplies no `fps`.

### Crop donor transport receipts (issue #973)

Whole-layer `parts[].taken_layers[]` optionally adds `transport` when its config
entry declares `crop`. The ordered fields are `crop`, `donor_canvas`,
`target_canvas`, `scale`, `translate`, `filter`, `input_rgba_sha256`,
`before_rgba_sha256` and `after_rgba_sha256`. Hashes bind whole-canvas row-major
straight RGBA before and after transport, and the donor input reconstructed from
the declared crop. `filter: "exact"` requires unit scale and integer translation.
Other maps carry `"bilinear"`. The strict reader refuses incomplete or malformed
transport records. Absent, the existing receipt fields and bytes are unchanged.
The output hash describes transport before downstream assembly, independently of
final part geometry. Existing no-take inputs emit no transport metadata.

### Region take source compatibility (issue #1054)

A see-through `--source` with an opaque explicit painting reference was accepted
when donor geometry followed the reference and is now refused with
`INPUTS_PAINTING_OPAQUE` before the donor is read. The reference remains a colour
binding. The donor continues to be bound to the opaque PNG accepted by `inputs`.


The check document's row objects additionally carry `row_scope` (`part`,
`pair`, `rig`), `row_kind` (`finding`, `evidence`), and `row_subjects` (one part,
two parts, or an empty list respectively). These are additive; legacy `scope`,
`kind`, measurements, statuses and exit decisions are unchanged. There is no
top-level check spec/version tag to bump. See [Consumer check rows](AUTHORING.md#consumer-check-rows-issue-1089)
for the producer-derived family table and the boundary between rows and summaries.
