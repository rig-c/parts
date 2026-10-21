# Authoring a character with rig-parts

This is the guide an agent authors from. It assumes you cannot see the painting,
the layers or the rig: what you have is this page, the tool's printed lines, and
the files it writes. Every refusal the tool prints names a rule, an object, the
value found and the value required — §6 maps each rule to the field or input that
has to change — and ends with `(see rig-parts guide RULE)`. That command prints the
rule's one row of this page, read from the installed file when it runs; nothing is
kept apart from this file. `rig-parts guide §<n>` prints a section, `§<n>.<m>`
the m-th `###` under it and `§<n>.<m>.<k>` the k-th `####` under that, counted as
the file stands. Each row's first cell starts with an anchor named for its
rule, so `AUTHORING.md#RULE` on github.com lands on the row.

The worked example throughout is [`examples/reference-sample`](https://github.com/rig-c/parts/tree/main/examples/reference-sample): its
`config.json` is a complete, loading config, `proposal.json` is what the proposer
wrote for it, and `expected/` is what the reference implementation produced from
the same inputs — except `check.json`, which this port's `build` regenerates since
the reference has no judgement lines (§7). `bun run fetch-examples` puts its painting and See-through layers
into `examples/reference-sample/inputs/` in a clone of the repository.

A path this page names that the installed package does not hold — anything under
`examples/`, `docs/evidence/`, `tools/`, `fixtures/` or `scripts/`, and the scripts
`bun run` names — is in the repository, https://github.com/rig-c/parts; the package holds the files
`package.json` lists under `files` (`npm pack --dry-run` prints them).

The examples' names: `reference-sample` and `reference-demo` are the two characters
the reference implementation ran (published as `sample` and `demo` until issue #227),
kept as fixtures because their `expected/` is that implementation's own output; every
figure this guide quotes for them was measured on them. `demo` is the painting the
README shows since issue #227 and `scarf` the hanging-element example; both have
`expected/` from this port's own build, and a figure quoted for them says so.
In every example, `expected/rig.json` is the flat form: every bone unturned, which is
`flattenRig` (`src/rig.ts`) of the built rig. A build's `rig/rig.json` carries
`rotation` and `length` on its chain links, and the offsets under them in the turned
frame (§5, the `rig` row), where that file holds unturned offsets only, so the two
differ as text and not as a rig: the chain suite (`CH03`) compares `expected/rig.json`
with `flattenRig(built)`, not with the built file.

## 1. Prerequisites

| what | why | how |
| --- | --- | --- |
| [Bun](https://bun.sh) 1.2 or later | rig-parts and rig-c are Bun programs | `npm install -g @rig-c/parts` installs the command; it says so if Bun is missing |
| [rig-c](https://www.npmjs.com/package/rig-c) | compiles, gates, packs and renders every rig; rig-parts writes no Spine data itself | installed with rig-parts as a dependency (`node_modules/.bin/rigc`); with no Spine runtime beside it, it gates with its own validator, and `rigc --version` says `entry: cli_core.ts` |
| [See-through](https://github.com/shitagaki-lab/see-through), somewhere | the layer decomposition is the input | any route in README *Getting See-through layers*; it runs twice per character, outside this tool |
| a GPU, wherever See-through runs | See-through is a diffusion model | nothing in rig-parts itself uses a GPU |

The painting is yours to bring: a PNG of one character, front-facing, full body,
taller than wide, on a plain light background. How it was made is not read by any
stage (`config.generation` is recorded for the optional adapter only).

## 2. The folder

Nothing in rig-parts requires a layout; every command takes paths. The one the
examples use, and the one this guide assumes:

```
<key>/
  config.json               the character config (§3)
  inputs/painting.png       the painting
  inputs/st_input_full.png  what See-through's full run was fed: the painting, white-padded to a square
  inputs/st_input_head.png  what its head run was fed: the square crop at seethrough.head_box
  inputs/layers/full/       the full run (wrapper form: layers.json + parts/<tag>.png), or full.psd
  inputs/layers/head/       the head run, the same
  proposal.json             what `propose` wrote (§4, step 7)
  basis.json                what each proposed bone rests on, written beside proposal.json (§4, step 7)
  keypoints.json            optional: where the figure's joints are, for `propose --keypoints` (§3, *A posed figure*)
  out/                      what `build` writes (§5)
```

## 3. `config.json`, field by field

`src/config.ts` is the schema and the loader. Every key is known or refused
(`CONFIG_KEY_KNOWN`); a required key that is missing is `CONFIG_FIELD_PRESENT`.
There are two open doors, and nothing reads what stands behind either. An
annotation: `note`, and any key ending in `_note`, may hold a string anywhere an
object is — write a hand correction's reason there, beside the value it corrected
(the examples do). A record: any key beginning `x-` with a name after it may hold
any JSON value in the same places — a project's own provenance, such as the gate
results of a past build (`"x-status": {…}`) or the seeds a search rejected, with
reasons (`generation.x-seeds_tried`). The record test comes first, so
`x-seed_note` is a record. `xstatus`, `x_status`, `X-status` and a bare `x-` are
not record names and are refused like any unknown key. The doors are not open in
`meshes`, `regions` or `motion.blink.still`: their keys are part names, and an
`x-` key there is a part like any other. Every refusal of an unknown key, of a
retired one and of an annotation that is not a string says where a record goes.

**Coordinates** in `bones`, `meshes` and `motion` are **rig pixels, y down, origin
top-left** — the parts' own space, which is the painting times `assemble.rig_scale`.
`root` is added by the rig stage at the bottom centre of the rig canvas; never
declare it.

"Where it comes from" is one of: **proposed** (a command prints or writes a value
you copy and check), **authored** (you decide it), **recorded** (a fact about a run,
read by no CPU stage).

| field | read by | where it comes from |
| --- | --- | --- |
| `key` | every stage's report | authored; the examples use the directory name |
| `generation.*` | the optional `comfy` adapter only; no CPU stage | recorded: checkpoint, LoRAs, sampler, prompt parts, `latent`, `seed`, `control` |
| `generation.control.skeleton` | `comfy paint` — the OpenPose control image, drawn at `latent` | **authored**: a built-in standing pose, `"stand_sides"` or `"stand_clasp"`, or (issue #198) any other string, read as a path relative to the config file's directory to a pose file `{"width": W, "height": H, "points": {"nose": [x, y], "neck": [x, y], …}}` — `width` x `height` is the canvas and must be `generation.latent` (the points are not scaled; `CONFIG_POSE_CANVAS`), and `points` holds the 18 body-18 keypoints of `src/skeleton.ts` by name (`nose`, `neck`, `r_shoulder`, `r_elbow`, `r_wrist`, `l_shoulder`, `l_elbow`, `l_wrist`, `r_hip`, `r_knee`, `r_ankle`, `l_hip`, `l_knee`, `l_ankle`, `r_eye`, `l_eye`, `r_ear`, `l_ear`; `r`/`l` the subject's sides), each `[x, y]` in canvas px, x right, y down, `0 <= x <= W`, `0 <= y <= H`. The image is drawn from the file exactly as from a built-in (same renderer, same size), written as `control_pose-<first 12 hex of its sha256>.png`. A pose file carries no words, so `generation.pose` is required beside it (`CONFIG_FIELD_PRESENT`). The file is read wherever the config is read from a path, every problem at once: no such file — a misspelt built-in lands here too — or one that cannot be read (`CONFIG_FILE_PRESENT`), not JSON (`CONFIG_IS_JSON`), not an object, a size that is not a whole positive px count, a point that is not two numbers (`CONFIG_FIELD_TYPE`), a key besides the three (`CONFIG_KEY_KNOWN`) or written twice (`CONFIG_KEY_UNIQUE`), `points` holding other than the 18 names (`CONFIG_POSE_KEYPOINTS`, with the count found and required), a point off the canvas (`CONFIG_POSE_IN_CANVAS`, naming the point and the canvas size) |
| `seethrough.resolution` | assemble — each run's canvas must be `resolution` square (`ASSEMBLE_RUN_CANVAS`); with one run (no `--head`, issue #366) the file may be smaller on either side, and is padded to the `resolution` square, centred | recorded from the See-through runs; 1024 in both examples. With one run it is the square the file is read on: at least the file's longer side (`ASSEMBLE_RUN_CANVAS` otherwise), and nothing a part records depends on how much larger |
| `seethrough.steps`, `.seed`, `.offload` | no CPU stage | recorded from the runs |
| `seethrough.head_box` | inputs (cuts the head image there; optional at the first call); assemble — where the head run sits on the painting | **proposed** by `propose --head-box` from the full run, square, source pixels, shifted inside the painting when needed; the head run must then be fed exactly that crop. With one run (no `--head`, issue #359: an artist's own file, §4 *For artists*) it is left out — there is no crop to place — and a config that sets it is refused (`ASSEMBLE_SINGLE_RUN_HEAD_BOX`) |
| `seethrough.arm_split` | assemble, `assemble --propose-plan` — separates a single full-run `handwear-r` or `handwear-l` layer that holds both overlapping arms into both arm tags | **authored**, optional (issue #439): `{x?: number, line?: [[x, y], …], order: ["handwear-r", "handwear-l"] \| ["handwear-l", "handwear-r"]}` in `seethrough.resolution` full-run pixels. Exactly one of `x` (image column, `0 <= x <= resolution`) or `line` (a polyline of two or more `[x, y]` points in `[0, resolution]`, interpolated in x along y and clamped above/below its endpoints) is required (`CONFIG_FIELD_PRESENT`, `CONFIG_FIELD_TYPE`), and `order` is `[back_tag, front_tag]`, the draw order of the two separated arm layers (`CONFIG_FIELD_PRESENT`, `CONFIG_FIELD_TYPE`). Pixels at `< splitX(y)` go to `handwear-r` (image left, the subject's right arm) and pixels at `>= splitX(y)` go to `handwear-l` (image right, the subject's left arm). A split line that cuts a horizontal opaque run of the arm layer into more than two segments is refused (`ASSEMBLE_ARM_SPLIT_CUTS_ARM`). Without the declaration, when one arm layer's 8-connected component reaches both wrists under `propose --keypoints`, `propose` emits an `overlapping-arms` `LINT` naming the part, both wrists and `seethrough.arm_split`; absent, no byte of any output moves |
| `assemble.rig_scale` | assemble — the rig is `trunc(w × rig_scale)` x `trunc(h × rig_scale)`, and every rig-px value after it (`bones`, `meshes`, `motion`, `patches`, `cuts`) is in that rig's pixels; `check --source` (`CHECK_SOURCE_SIZE`) and `compose` (`SCENE_RIG_SCALE_AGREES`) read it back off `parts.json` | authored; rig pixels per source pixel. 0.5 in both examples (a 1664x2432 painting makes an 832x1216 rig). **Keep the figure about 1,100 to 1,200 rig px tall** — the `H` of `propose`'s `mesh spacing:` note, the height of the parts' boxes together — so for another painting, about 1,150 over the figure's height in painting px: that is the size the proposer's spacing divisor was calibrated at (H 1106–1185, the `mesh spacing` note says so) and the size of the two examples `check`'s bars are derived from, and the proposer and `check` also hold fixed rig-px values that do not scale with it (the fringe's 10 px step, the trunk segments' 18, 20, 30 and 100 px, the 15 px wrist tolerance, the 10-row pendant floor, the seam bar's 50 rig px over 40). What else it trades, measured on `demo` with the README loop from a fresh config at 0.25, 0.5 and 1 (issue #345, rig-c 2.47.1): the same plan and the same ten chains; every bar but the one the uncorrected `demo` always fails (`bottomwear` `TIP_OVER_ROOT`, the README loop's `RL01`) passing at all three; the atlas page 418x606, 832x1205 and 1825x2047; the figure's mesh spacing 16, 32 and 64, so 830, 868 and 932 triangles; the breath 2.5 % of a torso that scales with it; and the proposed bones, scaled to 0.5, off the 0.5 proposal's by up to 38 px at 0.25 and 22.5 px at 1 (the hairpin's origin; the skirt roots 20 and 10.5) — the fixed-px values above. `propose` records it on the proposal as `proposed_rig_scale` (issue #354), and changing `assemble.rig_scale` after the rig sections are written is refused (`CONFIG_PROPOSED_RIG_SCALE`): without that refusal `demo`'s tracked config built at 0.25 gated green and `check` failed only `TIP_OVER_ROOT` on both sleeves (`propose --from-config` named 54 `LINT` lines, links off the art) — re-run `assemble` and `propose` at the new scale. Absent: `CONFIG_FIELD_PRESENT`; 0, negative or not a number: `CONFIG_FIELD_TYPE`; a rig under 1x1: `ASSEMBLE_RIG_SIZE` |
| `assemble.plan` | assemble; also the list every `meshes`/`regions` key must come from | **proposed** by `assemble --propose-plan`. `[part name, "full" \| "head", See-through tag]`, in draw order back to front. Names are free; roles come from the tag. A layer the author made and added to a run takes `author:<label>` in the tag's place, and has no role (§5, *A layer the author made*). When `generation.control.skeleton` is present and a full-run `handwear-r` or `handwear-l` layer merges sleeve, bare hand and overgarment drape into one layer — a skin-coloured hand cluster (`>= 40` run px, `GHOST_MIN_AREA`, measured `516..4,787` run px across the 9-standee corpus) lies within `0.35` forearm lengths of `<s>_wrist` and non-skin pixels reach more than `1.0x` the forearm length (`<s>_elbow -> <s>_wrist`) below `<s>_wrist` (issue #490; measured `-0.15x..0.45x` on the 6 clean standees vs `1.25x..2.02x` on the 3 merged standees, placing `1.0x` inside the `0.45x..1.25x` gap) — the layer is split into `drape-<s>`, `handwear-<s>` and `hand-<s>` (back to front) when the Euclidean RGB distance between the sleeve median colour above `<s>_wrist` and the drape median colour below `<s>_wrist` is at least `80` (`ARM_DRAPE_COLOR_DISTANCE`, measured `103.6..236.0` on the two distinct-colour merged standees vs `20.8..28.2` on the same-colour merged standee, placing `80` between `28.2` and `103.6`), or refused with `SEETHROUGH_ARM_RUN_MERGED` when the distance is under `80` |
| `assemble.extend_below_crop` | assemble | **proposed** with the plan: `{part, run, tag}` — a head-run part that reaches the bottom of the head crop is continued from a full-run layer, whole connected components |
| `assemble.patches` | assemble; `meshes`/`regions` keys may name them too | **authored**, optional: `[{name, box, alpha, draw}]` — an extra part cut from the **painting** itself, for figure no See-through layer holds (a hem both runs dropped). `box` is `[x0, y0, x1, y1]` in **rig** pixels, `x1`/`y1` exclusive — the space of `parts.json` and `recomposite_rig.png`, where the hole is found; `alpha` is `"silhouette"` (the painting's figure silhouette inside the box, the one `--seam silhouette` uses) or `"box"` (the whole box); `draw` is `"back"`, `"front"` or `{"before": "<plan part>"}`. A patch is always a region: its bone is `regions.<name>`, in the one place every region's bone lives, and a `meshes` entry for it is refused. `draw` sets assembled part order; an exclusively bound limb rider's final rig slot joins that limb's block (see the limbs subsection). See §5 for how to place one |
| `assemble.cuts` | assemble; `meshes`/`regions` keys may name the new parts too, and must (each is a part like any other) | **authored**, optional (issue #170): `[{from, into, polygon, draw, overlap, under, under_fill}]`, `under` and `under_fill` optional — a plan part's layer cut by a polygon the author draws: the pixels of plan part `from` whose **centre** lies inside `polygon` (even-odd; a centre exactly on an edge is outside) leave `from` and make the new part `into`, colour and alpha, so every pixel of the layer ends in exactly one of the two. `polygon` is `[[x, y], …]`, at least three points, non-negative integer **rig** pixels — the space of `parts.json` and of the patches' boxes. The file that shows the layer in those coordinates is `assemble`'s own `rig/parts/<from>.png`, placed at its `parts.json` `x`, `y` (the PNG's pixel `(i, j)` is rig pixel `(x + i, y + j)`), or `render/recomposite_rig.png`, the whole rig 1:1; the contact sheets (`sheet`) are scaled and carry no coordinates. `draw` is `"back"`, `"front"` or `{"before": "<plan part>"}`, as for a patch (to keep the setup pose, draw the piece immediately in front of `from` — `{"before": "<the plan part after from>"}`, or `"front"` when `from` is the last plan part; `{"before": "<from>"}` draws it behind `from`, which `under` refuses as `ASSEMBLE_UNDER_DRAW` because the fill would hide it). `from` must be a plan part (`CONFIG_NAME_RESOLVES`; a patch or another cut's piece is refused; a part a limb takes may be cut where no segment of the limb holds it, issue #564, §5 *Limbs*), `into` a new name (`CONFIG_PART_UNIQUE`), the polygon three or more integer points (`CONFIG_FIELD_TYPE`). The piece's `parts.json` record carries `from`'s `<run>:<tag>` and its own counts, each split from the layer's by where the pixel lies; it is a mesh or a region under its own name, and the coverage rule holds it like a plan part. What the config cannot know the stage refuses: a polygon point past the rig (`ASSEMBLE_CUT_INSIDE`), two cuts of one part sharing a pixel (`ASSEMBLE_CUT_OVERLAP`), a cut that takes none of the layer's opaque pixels or leaves `from` none (`ASSEMBLE_CUT_PIXELS`), a cut of a part a limb takes that takes a pixel a segment of the limb holds (`ASSEMBLE_CUT_CROSSES_LIMB`). `overlap` is required, a non-negative integer of rig pixels with no default (`CONFIG_FIELD_TYPE`): the **band** — the polygon's pixels within `overlap` px of its edge by Chebyshev distance (the polygon's mask less its erosion by a `2 * overlap + 1` square) — stays in `from` as well as going to the piece, so the piece's resampled edge has art under it; the counts stay a strict partition and the band is the base's extra copy, printed on the `cut:` line. At `0` the two abut and `check`'s seam bar judges the edge between them (`CHECK_SEAM_WITHIN_BAR`, §5). A band only covers the edge at rest: a piece that swings well clear of where it was painted shows the hole it leaves, and a thin piece's band shows a ghost of the piece. `under` (issue #193), optional, is the author's image of what lies under the piece: a PNG path relative to the config's directory (`CONFIG_FIELD_TYPE` unless a non-empty string), in rig pixels over the polygon's **bounding box** — the least and greatest polygon x and y, so the image is `max x − min x` by `max y − min y` and its pixel `(i, j)` is rig pixel `(min x + i, min y + j)`. Where the cut removed pixels from `from` — the piece's pixels (alpha above 0) less the band — `from` takes the image's pixel, colour and alpha wherever the image's alpha is at least the alpha the cut removed there (**filled**); elsewhere `from` stays empty there (**left empty**): a transparent pixel is the author's statement that nothing lies under it (the background, or a part drawn behind), and a less opaque one is not half-filled. The image is read nowhere else, so its pixels over the band, over the box outside the polygon or where the layer had no art never change `from`. The `cut:` line then ends `; under <n> px filled, <m> px left empty` (`n + m` is every removed pixel), so an unintended hole is a number in the log, not a guess; the filled pixels count in `from`'s `opaque_px` and `occluded_px` (the piece is drawn over them), never as visible or projected. The stage refuses: a file that is not there (`ASSEMBLE_UNDER_PRESENT`) or not a PNG (`ASSEMBLE_UNDER_DECODES`), an image not exactly the box's size (`ASSEMBLE_UNDER_SIZE`, both sizes given), an image that fills none of the removed pixels — all transparent there, or another file (`ASSEMBLE_UNDER_EMPTY`; to leave the whole hole, drop `under`), and a piece drawn behind `from` (`ASSEMBLE_UNDER_DRAW`: the fill would hide it; draw it `"front"` or `{"before": "<the plan part after from>"}`). Producing the image is the author's, by whatever means; absent, `from` keeps only its band. `under_fill` (issue #360), optional, is the one value `"colour"` (`CONFIG_FIELD_TYPE` on any other): the same pixels are filled and left empty, and a filled pixel takes the image's **colour** at the alpha the cut removed there instead of the image's alpha, so `from`'s alpha is the uncut layer's wherever the image fills and its silhouette does not grow — an opaque image over a soft edge leaves the edge soft. It applies to the part's hidden-art layer as well as to a file; a cut with neither is refused (`ASSEMBLE_UNDER_FILL_SOURCE`). The `cut:` line's filled count then says how many took the colour only: `; under 190 px filled (190 colour only, at the alpha the cut removed), 0 px left empty`. Absent, a filled pixel takes the image's colour and alpha, as above |
| `assemble.alternates` | assemble, rig, check (`--set`, `--all-sets`) | **authored**, optional (issues #454, #465, #472, #473, #476): `[{name, source?, full?, head?, head_box?, parts?, hides?, cuts?, skeleton?, drawn?}]` — alternate painting sets assembled into `<out>/rig/parts/<set>_<part>.png` (`parts.json` `alternates`), attached on each covered slot in `rig.json` as `<set>_<part>` beside the base attachment, and indexed in `<out>/rig/sets.json` (`rig-parts-sets/1`: `sets.<set>.slots`, `.hides`, `.drawn` when present, and `.threshold: {yaw: 15, pitch: 12}` when the set replaces `face` on a rig with `turn` or `turn`/`tilt` slider animations). `source`, `full` and `head` may instead be given on the CLI with `--alt <name>=<source>:<full>[:<head>]`. `parts` lists the subset of parts the set replaces (default: every part not in `hides`); a **subset set** (issue #473, e.g. mouth visemes `a`, `i`, `u` with `"parts": ["mouth"]`) cuts only its covered parts from the alternate runs (refusing with `ASSEMBLE_ALT_INPUT_PRESENT` if a covered part's layer is missing or empty), writes only `{slot: "<set>_<slot>"}` in `sets.json` so `@rig-c/play`'s `setSet(name)` switches those slots while leaving every other slot on its base attachment (and `setSet(null)` restores the base pose), may be keyed on a slot attachment track in `motion.animations_from` as `{"t": …, "set": "<name>" \| null}` (`CONFIG_SET_COVERS_SLOT` if `"set"` is undeclared or does not cover the track's slot), and under `check --set <name>` counts `ANIMATIONS_DO_NOT_FOLD` only on its own covered slots; `hides` lists slots the set hides (`null` in `sets.json`). A **gesture subset set** (issue #476) covers a limb chain declared in `config.limbs.<limb>` (all of its segment `part`s; with `drawn` alone, cut at the base's joints posed to the set's own `drawn` angles by `poseBoneEntriesForDrawn`, each segment keeping the base's length; with `skeleton` (issue #539), cut at the skeleton's own joint positions by `placeBoneEntriesForSkeleton` — each covered bone the body-18 table names (`sleeve_*`, `arm_*0`/`arm_*1`, `leg_*0`/`leg_*1`) at its skeleton origin with the skeleton segment's own length and direction (`drawn` overriding the direction of a bone it names), and a covered bone the table does not name (a hand link `arm_r2`, a single `foot_r`) placed from its parent's new place — its base offset from the parent, stretched along the parent by the parent's length change and turned by its turn, so a link or a foot at the parent's end lands on the skeleton's end — with its base length and the drawn or base direction, so a foreshortened shin or forearm is cut where it is painted; naming the unsplit `from` layer, covering only some segments of the limb, or declaring polygon `cuts` on a limb set is refused with `CONFIG_LIMB_SET_JOINTS`) and carries `drawn` (or `skeleton`) for the covered bones only (giving `drawn` for an uncovered bone is refused with `CONFIG_SET_COVERS_BONE` / `RIG_SET_COVERS_BONE`; uncovered bones keep the base's `drawn`). A subset set's limb part takes no pixel that a base part drawn after it, which the set neither covers nor hides, covers at setup (issue #587): the set's attachment is drawn in the base slot's place, so that base part is drawn over it and what the set's painting shows there is that base part (shorts over a leg set's thigh top, which See-through synthesised in the set's leg layer); `assemble` clears those pixels — the base part's PNG at alpha above 8, at its `parts.json` x, y, on the shared canvas — from the set's part once its limbs are cut, before any count — its `merged_px` and its cap's record too (issue #603): a cap pixel it clears leaves the count it was in (`layer_px`, `image_px`, `upper_px`, `lower_px`, `lower_kept_px`) for the cap's `excluded_px`, written only when above 0, so every count is the written PNG's — and prints `LINT set "<set>" <part>: <n> px under <base part> excluded` per part and base part that took a pixel (n counts alpha above 8); a set that carries that base part itself (`"parts": ["thigh_l", "shin_l", "bottomwear"]`) excludes nothing and writes what it wrote before. A subset set that names one limb side of a layer more limbs take (issue #588: `"parts": ["thigh_r", "shin_r"]` where `leg_r` and `leg_l` both take the one `legs` layer) would put every pixel of that layer on its one limb, so each of its parts would hold a piece of both legs; when the set's layer holds more than one island (8-connected pixels with alpha above 8) of at least 1 % of its largest (issue #608: the ghost clean-up's own share; a smaller island is a speck, which goes with the island nearest it — the one holding the pixel centre nearest one of the speck's, none when two are equally near — and is never an island of its own), each segment part keeps the island its joints fall on — its bone's origin and the next segment's bone's origin, at the set's own bones, a joint on the island of a pixel whose square holds the point, and a joint on no island on the one island whose nearest pixel centre lies within the radius of the cap cut at that joint (`cap.radius`: an ankle just past the legwear's edge, on the shoe) — and drops the rest, once its limbs are cut and before the exclusion above, and `assemble` prints `LINT set "<set>" <part>: <layer part> holds <n> islands (8-connected, alpha above 8)[, and <s> speck(s) under 1 % of the largest (<f> px), each with the island nearest it], kept the one under <bone> [x, y] and <bone> [x, y][ (<e> px off it, within its cap's radius <r>)] (<k> px), dropped <m> (<d> px)` per part (k and d count the part's pixels above alpha 8, m the islands it lost one from, and `dropped none` when it lost none); a joint on no island with none or two within that radius, or with no cap cut at it (a limb's first joint), and a segment whose joints fall on two, are refused with `ASSEMBLE_ALT_LIMB_ISLAND` rather than guessed. A layer of one island — specks aside — may hold both legs over each other (a folded shin across the standing leg; issue #609): each of the set's segment parts then keeps the pixels nearer its own limb's segment line — the polyline of only its segments taking that source, their bone origins and the last segment's supplied tip or following segment's joint (issue #638) — than the other limb's, both in the set's pose, and gives the rest away, once its limbs are cut and before the exclusion above; a pixel whose two distances differ by 0.5 px or less (the overlap band: half a pixel, the reach by which a pixel centre is read as on a line) goes to the limb whose part there is drawn later in the base's draw order, and the `LINT set` line above counts what each part kept, gave and held in the band. The other limb stands where the set's `skeleton` places it — its keypoints place every limb bone of the body-18 table, the other leg's as well as the set's own (its `drawn` and `drawnLength` stay the covered bones') — and never at the base's place: a set that does not place it (a `drawn` set, which may not name a bone it does not cover, or a set with neither) is refused with `ASSEMBLE_ALT_LIMB_POSE` when its layer has art where the base draws that limb, and when it has none nothing says the layer holds it and the layer is cut as before; two limbs whose segment lines run closer than the limb's half-width over most of where their art can meet are refused with `ASSEMBLE_ALT_LIMB_OVERLAP`. A set that carries every limb of the layer is cut as before. For a subset set, where a limb's own source layer holds art (`alpha > 8`) under another layer of that run drawn in front (`alpha > 8`, by the projection's plan/depth order), the limb keeps its own layer pixels through projection, limb cutting, island/nearest-line assignment, base-footprint exclusion, fringe clearing and seam correction (issue #637). Those pixels are occluded, never counted as painting projection; no base footprint or painting colour replaces them. After source-art island/nearest-line assignment, a source-transparent cap pixel is assigned before protection, in both doors: its centre is compared against only the segments taking the recipient's source, at the set's supplied bones (ankle-to-toe for a separate foot source), with the existing 0.5 px overlap band and base draw order. A missing last endpoint is refused with `ASSEMBLE_ALT_LIMB_POSE`; an actual following joint may supply that endpoint, never a guessed point. An unposed other limb with base art beneath these cap pixels is likewise refused; without such overlap the existing compatible path retains the cap without inventing the other limb's pose. A pixel cleared by this assignment is never restored. `CAP_FROM_UPPER` records a copy made before assignment and alone proves no ownership: only a retained copy is protected beneath the upper segment, which is drawn over it. The source-art island selection itself is unchanged. Other retained cap pixels (from the layer or a supplied cap image) are protected under an actual front layer even where the lower source is transparent. Protection follows each assigned piece through exclusion, fringe clearing and seam correction; it never restores a pixel ownership removed. Cap pixels removed during ownership leave their original counts for `excluded_px`, just as excluded pixels do, so the cap ledger describes the written PNG. Target assignment reconciles this ledger even when there are no source-transparent cap candidates and when a direct caller does not request cover protection. Unprotected source pixels still obey the base-footprint exclusion. Missing limb/cap art is never extended or guessed. Base builds and uncovered, unexcluded sets keep their existing bytes. `skeleton` (a pose file path relative to the config's directory, `{"width": W, "height": H, "points": {…}}` with all 18 body-18 keypoints on the canvas, validated by the same rules as `generation.control.skeleton`: `CONFIG_FILE_PRESENT`, `CONFIG_IS_JSON`, `CONFIG_FIELD_TYPE`, `CONFIG_KEY_KNOWN`, `CONFIG_KEY_UNIQUE`, `CONFIG_POSE_CANVAS`, `CONFIG_POSE_KEYPOINTS`, `CONFIG_POSE_IN_CANVAS`) or `drawn` (`{<bone>: <worldDegrees>}`, each bone resolved against `bones`, `CONFIG_NAME_RESOLVES`) declares the posed angles the alternate was painted at (issue #465); when `skeleton` is given, `assemble` derives `drawn` from its 18 keypoints (filtered to covered bones on a subset set, with `drawn` overriding any bone named in both), records both `skeleton` (scaled by `assemble.rig_scale` to rig px) and `drawn` in `parts.json` `alternates` — and, when the skeleton placed the set's limb bones (issue #539), `drawnLength` (`{<bone>: <ratio>}`, each covered table bone's skeleton segment length over its base length, 6 places) and `registration` (`{offset: [dx, dy], scale}`: the similarity without rotation, about the canvas origin, that maps the skeleton's torso — the mean of its shoulders `r_shoulder`/`l_shoulder` to the mean of its hips `r_hip`/`l_hip`, read where the base declares the bone rooted there, `sleeve_*0`/`arm_*0` and `leg_*0` — onto those base bones' origins, 6 places), both also written to `sets.json`; the set's painting must be registered, its torso within 1 rig px and 1 % in scale of the base's, or the set is refused by name before any joint is cut (`ASSEMBLE_ALT_SKELETON_REGISTERED`, with the offset and scale the painting would need) — and the `rig` stage writes `<set>_*` region and mesh attachments in the bone-local frame of `poseRigBonesForDrawn(bones, drawn)` (weighting limb segments directly from `skeleton`'s joint endpoints when `skeleton` is present) and emits `drawn` in `sets.json` so `rig-pose` and `check --set <name>` / `--all-sets` pose the bones at `drawn` without rotating the already-posed art a second time |
| `assemble.head_face_underfill` | assemble, `assemble --propose-plan` | **authored**, optional (issue #492): `boolean` (`CONFIG_FIELD_TYPE` on any other). When both runs exist and `full:face` has at least `200` opaque run px (`PROPOSE_MIN_PX`), the stage maps `full:face` into the head canvas via `fullLayerToHead` and measures how much of its hole-filled silhouette (`alpha > 8`) is covered by `head:face` (`alpha > 8`). A head-run `face` covering less than `75 %` (`HEAD_FACE_COVERAGE_FLOOR`, measured `0.0 %..48.6 %` on hollow/omitted head runs vs `84.8 %..99.6 %` on clean head runs across the 4 public examples and 9-standee corpus) is refused with `SEETHROUGH_HEAD_RUN_HOLLOW` unless `head_face_underfill: true` is declared. When `head_face_underfill: true` is declared and `head:face` exists (`opaqueRunPx >= 200`), `fullLayerToHead(full:face)` is composited under `head:face` on the head canvas (`alpha = max(headAlpha, fullAlpha)`, RGB blended by `headAlpha / 255`) before `head:face` is placed in rig space (`underfill=<N>px(full:face)` on the `face` part log line and a `face: head_face_underfill composited …` note in `assemble --propose-plan`). The fill restores transparent pixels only and leaves the cut's own edge where it is — a hollow whose edge is not under hair stays visible, and that is the author's to fix at the cut. When `head:face` has fewer than `200` opaque pixels, `SEETHROUGH_HEAD_RUN_HOLLOW` still fires even under `head_face_underfill: true` because the head run omitted the face layer and cannot supply a jawline |
| `limbs` | assemble (the cut and the caps), rig (through `regions`), check (`LIMB_ONE_BONE`) | **proposed** by `propose --keypoints` (issue #349), then checked: `{<limb>: {segments: [{part, from, bone}, {part, from, bone, joint, range?, cap?, edge?, cap_shape?, cut_band?}, …]}}`, the upper segment first. The rule is *Limbs: cut at their joints* below the table. `part` is a new part (`CONFIG_PART_NAME`, `CONFIG_PART_UNIQUE` against the plan, patches, cuts and every other limb part); `from` a plan part or a cut's piece (`CONFIG_NAME_RESOLVES`) — the layer the segment's pixels come from, which is cut into the limb parts and is not itself made: a `meshes` or `regions` entry for it is `CONFIG_NAME_RESOLVES`, and the segments of one limb that take one part are consecutive (`CONFIG_LIMB_FROM_RUN`); `bone` a declared bone, each segment's the child of the one before (`CONFIG_LIMB_BONES_CHAIN`); the upper segment names no `joint`, `range`, `cap`, `edge`, `cap_shape` or `cut_band` (`CONFIG_KEY_KNOWN`), every other names its `joint` (`CONFIG_FIELD_PRESENT`) — the joint is its bone's origin; `range` is `[min, max]` degrees from rest with `min <= 0 <= max` (`CONFIG_LIMB_RANGE`), which `assemble` writes into the lower part's `parts.json` record and `check` poses the joint at — its two ends and its middle — reading the seam there (`SEAM_OVER_RANGE`, issue #360; rig-c needs no rotation limit); `cap` a PNG path relative to the config's directory (`CONFIG_FIELD_TYPE`); `edge` `"feather"` (issue #360), the one value it takes, and `cap_shape` `"disc"` (issue #360) or `"ball"` (issue #579) (`CONFIG_FIELD_TYPE` on any other) — the cut's geometry at that joint, *Limbs: cut at their joints* below; absent, the cut is hard and the cap the layer's half-disc of half the limb's width; `cut_band` a whole number of px, 1 or more (`CONFIG_FIELD_TYPE`), on a segment that takes the segment above's part — between two layers nothing is cut, so a band there is `CONFIG_KEY_KNOWN` — places the cut within that many px of the joint line (issue #360, *Limbs: cut at their joints*); absent, the cut is the joint line. Each limb part is attached like any part — `regions.<part>`, which must be the segment's `bone` (`CONFIG_LIMB_BONE`), or a mesh, which `check` holds to that bone alone (`LIMB_ONE_BONE`). With `limbs`, `assemble` reads `bones` too (`CONFIG_FIELD_PRESENT` without it). Absent, nothing is cut at a joint and no byte of any output moves |
| `bones` | rig; `propose --from-config` | **proposed** by `propose`, then corrected. A single bone `{name, parent, at, tip?}` or a chain `{chain, parent, points, tip, link_inherit?}` whose links are named `<chain>0 … <chain>n`. Parents come before children. In `rig.json` each link is **turned along its chain** — `rotation` is the direction from its origin to the next link's (the last link's to `tip`) and `length` that distance (issue #73), so a physics constraint added downstream finds a lever; under `--idle-keys ctl` the link's `<link>_ctl` carries the turn and the length and the link sits at local rotation 0 beneath it. A single bone with a `tip` is turned the same way, towards its tip, with that distance as its length (issue #239); a tip on the bone's own origin is refused (`RIG_TIP_DISTINCT`). The five face bones `eye_r`, `eye_l`, `brow_r`, `brow_l` and `mouth` (by name, when one has no tip of its own) are turned to the eye line — the line through the origins of `eye_r` and `eye_l` as `bones` writes them, read image-left to image-right, drawn when parts.json holds both an `eyewhite-r` and an `eyewhite-l` part — so the blink's `scaley` squashes across the eye line on a tilted head; move an eye bone and the line moves with it. With one eyewhite or none, or an eye bone missing, the rig stage's `face axis:` line says so and they keep the page's axes. A bone under a face bone keeps the face's axis. With the line, `rig.json` also declares `invariants.axes` — one entry, `"face"`, through `eye_r` and `eye_l`, holding the turned face bones (and their controls) — so rig-c's gate holds the build to the line; the line is the one rigc draws through the same two bones, so the tolerance is only the float floor — the largest gap the emitted (float32) bones have to it, rounded up to 6 places plus one 6-place unit — and the `face axis:` line prints it. With the line the rig stage also adds `head_up` (issue #250): a slotless bone under `head`, at head's origin, turned to the eye line + 90 degrees and as long as the eye midpoint lies from head's origin along that axis — the head's frame, which a rule that needs it reads; `head` keeps its own frame, so no key on it or under it changes meaning, and a config bone of that name is refused (`RIG_HEAD_UP_NAME_FREE`). A face bone with its own `tip` is held too (issue #258), in a second entry, `"face_tips"`, when its tip lies along the line within whole-pixel rounding — a tip written in whole pixels sits at most sqrt(2)/2 px off the point of the line it stands for, so its direction may sit up to asin((sqrt(2)/2) / length) degrees off — with its tolerance measured the same way; a tip further off is the bone's own axis, and the `face axis:` line names it with its gap and that bound. A failure is rig-c's `A51_BONES_LIE_ALONG_THEIR_DECLARED_AXIS` line, which names the bone and the fix (rig-c's `docs/AUTHORING.md` §3.7 and §5.2); with no line no entry is written and A51 reports SKIP. Every region on a turned bone is turned back, so the setup pose does not move. Any other single bone keeps world rotation 0; one whose parent is a link is turned back upright. A single bone may declare `inherit` (issue #348): what it takes from its parent's transform, one of rig-c's own mode names exactly as rig-c's table spells them — `normal`, `onlyTranslation`, `noRotationOrReflection`, `noScale`, `noScaleOrReflection` (rig-c's `RigBone.inherit`) — written to that bone in `rig.json` as declared; any other spelling, `"NoScale"` included (the runtime would fold its first letter; nothing here folds or maps), is refused (`CONFIG_BONE_INHERIT`), and a chain takes no `inherit` (`CONFIG_KEY_KNOWN`). A chain may instead declare `link_inherit` (issue #369), an object mapping its own expanded link names to those same modes, for example `"link_inherit": {"leg_r1": "noScale"}`. Only the named link changes; omitted links inherit normally. A key outside this chain is `CONFIG_NAME_RESOLVES`, with this chain's valid link names in the detail; a non-object or non-string mode is `CONFIG_FIELD_TYPE`, and another mode spelling is `CONFIG_BONE_INHERIT`. The mode is forwarded to the expanded link, or to its control under `--idle-keys ctl`, by the same rule as a single bone. This is an authored opt-in: `propose` does not add it. Its setup rotation is the turn from where rig-c's own poser puts the bone with no rotation of its own under that mode, so it still stands upright (or along its tip) at the setup pose. Where the idle gives the bone a `<bone>_ctl`, the mode goes on the control: the control is the bone the parent's rotation reaches, and the bone under it inherits normally, so the idle's keys moved onto the control still turn it. A foot that does not take its shin's rotation (`noRotationOrReflection` or `onlyTranslation`) keeps its shoe level while the leg is posed (`FEET_STAY_LEVEL`, §7); which mode is the author's. `noScale` keeps a shin or shoe's shape under a scaled parent but still takes the parent's rotation: a shoe that must also stay level needs a separate rotation constraint, for example a transform constraint from an unrotated bone. This does not change the proposed feet's existing inheritance or `FEET_STAY_LEVEL` default. An automatic mesh weighted through a bone with a mode other than `normal` gets no derived amplitude (its row names the bone) and no residual envelope (rig-c's `SKINNING_RANGE_UNSUPPORTED`). Absent, `rig.json` carries no `inherit` and no byte moves |
| `meshes.<part>` | rig | **proposed**, then corrected. Exactly one of `grid` (the lattice: cell size, px — what `propose` writes: by default one spacing for the figure, round(H / 37) rig px with H the height of every part's box together, a part whose tenth of its short side is already coarser keeping that, and under `propose --grid-rule part` the reference's tenth of the part's short side clamped to 5..36, issue #265), `contour` (the outline mode, authored; the next row and "A contour mesh" below) or `auto` (the automatic mode, authored; "An automatic mesh" below) — two, or none, is `CONFIG_MESH_MODE`. In every mode: `r` (added to every distance before weighting: `w = 1/(d + r)²`), `segments` (a chain name, a bone name with a `tip`, or `[bone, [x0,y0], [x1,y1]]`), and, **authored**, optional, `exponent` (issue #161): a number above 0 that replaces the 2 in that rule, `w = 1/(d + r)^exponent` — a larger one hands each vertex more fully to its nearest bone; absent is 2 and changes no byte, a value that is not a number above 0 is `CONFIG_FIELD_TYPE` at `meshes.<part>.exponent`, and a declared one is echoed as `exponent` in the mesh's `mesh_report.json` row; the exponent is the distance rule's, so declared beside `rule: "heat"` it is refused (`CONFIG_FIELD_TYPE` at `meshes.<part>.exponent`). The segment list is the one authored decision about a layer: which bones may pull it. The slot's bone is the first segment's. Optional `rule` (issue #161): `"distance"` — the rule above, and what an absent `rule` means (every byte is the same) — or `"heat"`, bone heat over the part's own silhouette, in every mode: the lattice's art (alpha above 8, less any island a declared `stray` left out) with holes filled, or for `contour` and `auto` the silhouette their outline is traced from (that mode's art — alpha above 8 for `contour`, alpha 1 and above for `auto` — less any island a declared `stray` left out, holes filled, grown by its `margin`); each bound bone's sources are the silhouette pixels whose centre lies within 0.75 px of its segment (a pixel two bones reach goes to the nearer, a tie to the first listed), held at 1 for that bone and 0 for the others; the field is solved by row-major Gauss–Seidel over-relaxation to a sweep change under 1e-7 within 20000 sweeps; a vertex reads the nearest silhouette pixel and takes the same cap and floor (and `regions`) as the distance rule; `r` is not read. The mesh's `mesh_report.json` row gains `heat` (the constants, each bone's sources and sweeps, the residual). Any other value is `CONFIG_FIELD_TYPE`; a bound bone with no source pixel is `RIG_HEAT_BONE_SOURCE`, an island no bone has a source in `RIG_HEAT_ISLAND_SOURCE`, a solve past its sweep bound `RIG_HEAT_CONVERGED` — none is weighted 0. The rule is chosen per mesh, so `RIG_HEAT_BONE_SOURCE` names three remedies: move the segment onto the art, take the bone out of `segments`, or keep this part on the distance rule — the one to take when the bone anchors the part from outside its art (a torso bone under a neck), since the first moves a bone another part placed and the second drops the anchor (issue #303). On a lattice, `RIG_HEAT_ISLAND_SOURCE` on an island that is dust — at most 4 px and at most 0.1 % of the part's art px, `mesh-draft`'s line — names `meshes.<part>.stray` and the figure that leaves it out, with the value declared; an island above that line keeps the segment remedy, a real piece being a real authoring question. In every mode the mesh's `mesh_report.json` row's `bones` names the bones the emitted model binds for the attachment — the sorted set its weights in the written `rig.json` name, so a `turn` twin (`turn_<part>_<bone>`) or a stopped link's `<link>_d` where those rebind it, never the segment bone it stands for — the same list in every mode, `remesh --delta`'s included (issue #536) |
| `meshes.<part>.influence` | rig | **authored**, optional (issue #378), a mode beside `grid`, `contour` and `auto`: `{cell, radius, across, max, shape, hold_tip?}`, every field but `hold_tip` required, none defaulted. rig-c's `segments` lattice over the part at `cell` px, each vertex pulled by every link of the mesh's `segments` within `radius` px of it — a pull that falls to exactly 0 at `radius` (`shape` `"linear"` or `"smooth"`), across the `segments` entries or only within the nearest one (`across`), the strongest `max` kept. The lattice and the shares are computed by rig-c's own promised functions (`buildSegmentsLattice`, `segmentDistance`, `influenceShares`), so the rule is rig-c's (its AUTHORING §3.4.7), and the mesh is written with explicit weights like every other mode. `radius` is a length on this part: the rig stage measures the farthest lattice vertex's distance to its nearest link and refuses a radius at or under it (`RIG_INFLUENCE_REACH`), naming the distance. `propose --cloth` drafts it when a recipe declares `influence` and no `radius` (issue #518): the farthest vertex's distance plus 3 of the part's lattice cells, printed on a `LINT` line with both figures. Measured on the cloth fixture and the public `wind` example (#513: 8 covered parts, `render --folds` with the physics on under wind and a hip sway of 8° and 30°): a radius just above the floor folds **more** than the lattice (one skirt went from 0 to 55 folded frames), and a larger one is **not** safer (one fringe folded again at about 3–4× its farthest distance); +2 to +6 cells read 0 on every part, +2 at the edge. That reading counted folds only; read against `check` as well (the rig as built, under the wind schedule +1 → −1 → calm, `build --environment`, the three covered `wind` parts at the same number of cells), the window that holds is **+2 to +3 cells**, and +4 is the ceiling: `wind` `bottomwear`'s `CHECK_TIP_OVER_ROOT` ratio is 1.898 on the lattice, 1.801 at +2 cells, 1.590 at +3 and **1.471 at +4**, under the floor 1.4725, so the build fails there, and 1.351 at +6 (#513, rig-parts 1.52.0, rigc 2.60.0; the lattice, +3 and +4 read again on rig-parts 1.54.0, rigc 2.60.0, the same figures, #599). The drafted +3 sits in that window, one cell under the ceiling (no radius between +3 and +4 was read), and the window is a hypothesis until a third subject — each edge rests on one part — so state `radius` in the recipe to keep your own. `r`, `exponent`, `rule`, `influences`, `stray` and `ribs` belong to the distance rule or another mode and are refused beside it (`CONFIG_INFLUENCE_MODE`). `hold_tip` (issue #615) — `true` only, or absent: the pulled shares are smoothed by the lattice's held-fork passes (the cloth recipe's `split.hold_tip` sentence below: four passes of 1-ring mesh-edge averaging, self weight 0.5, floor 0.005) capped at the declared `max`, so no vertex binds more than `max` bones; absent, the shares are rig-c's as pulled and every byte is the one written before the field existed (`false`, a second spelling of absent, is `CONFIG_FIELD_TYPE`). The mesh's `mesh_report.json` row echoes it in `influence`. `propose --cloth` writes it, with `max` raised to at least 8 (the lattice's smoothing cap), on the parts a recipe with `influence` and `split.hold_tip: true` meshes; the rig stage reads it off the mesh and never the recipe. Measured on `wind` `bottomwear` and the cloth fixture's skirt under a 60° hip sway (#615, `render --folds`, physics on): `wind` `bottomwear` folds 41 frames as drafted before the field (max 6) and **0** with `hold_tip` and max 8, against its lattice's 5; with `hold_tip` at max 6 it reads 23, and at max 8 without `hold_tip` 3; the fixture skirt (recipe given `split.hold_tip`) reads 20 before and 0 with it, against its lattice's 0, and 0 at max 8 without it. So the raised `max` carries most of the gap and the smoothing the rest on `wind` (rig-parts 1.54.0, rigc 2.60.0; a split skirt without `hold_tip` is not smoothed and reads its 44 as before). For cloth and hair that should bend as one surface across its chains |
| `meshes.<part>.contour` | rig | **authored**, optional (issue #84): `{tolerance, margin, spacing, maxEdge?, budget?, stray?, bridges?, regions?, bust?}`. `tolerance` — rig-c's Douglas–Peucker tolerance on the traced outline, px, 0 or more; `margin` — how far the silhouette grows before it is traced, px: 0, or 1 or more (a pixel joins when its centre lies within `margin` of an art pixel's centre; a value above 0 and below 1 adds nothing and is refused, `CONFIG_FIELD_TYPE`); `spacing` — the background interior spacing, px, above 0; `maxEdge` (issue #265) — the longest outline edge, px, above 0: every simplified edge longer than it is cut into `ceil(length / maxEdge)` equal pieces, each cut point on the 1/256 px grid, before any region or rib touches the outline (absent: nothing is cut, and no byte moves; under 2/256 px the rig stage refuses it, `CONTOUR_PARAMETER`, because two cut points could snap together); the row echoes it in `params` and counts the points it added in `contour.outlineCut`, both only when declared; `budget` — the most vertices the mesh may have (refused above it, nothing thinned); `stray` — the largest island, in art pixels, that may be left out of the mesh (absent: none is); `bridges` (issue #326) — `true`, its one value: islands are read in this order — **dust first** (those `stray` leaves out), **then faint islands** (every pixel's alpha under 64, a quarter of full opacity: left out the same way, their pixels kept in the image but not meshed, so not drawn, and named in the row's `contour.bridges.faint` with their px, brightest alpha and box), **then every visible island is meshed and bridged, whatever the bridge costs** — overdraw is reported, never a reason to drop art; the largest island, or a tie for it, is never left out, faint or not: dropping it would draft the part without its art, and a part whose main body is faint is a question about the layer, which the plan and the author own, not one for the mesh — and the pieces are joined into the one outline rig-c takes by bridges — the kept islands, holes filled, grow together by `margin`, so islands closer than about twice the margin are one grown silhouette, traced as one; each silhouette is traced, simplified, capped, refined and triangulated as a one-island mesh is; then, starting from the silhouette with the most art, the nearest pair of a vertex on the joined outline and one on a silhouette still apart whose quad holds (wound as the mesh, crossing no outline, holding no other vertex, one closed outline after) is joined by that quad, two triangles over no art, until none is apart. Coverage and overshoot read the silhouettes' triangles; a bridge's area is in `meshArea` and in the row's `contour.bridges` (`islands`, `units`, and per join `unit`, `span` — its two crossing edges, px — `area`, `vertices`, `pair`; and `faint`, only when an island was left out as faint), and the row's `params` echoes `bridges`, both only when declared; `art_coverage` counts a faint island's pixels as art not covered. Absent, a second island is refused as below and no byte moves; on one island it writes the mesh the undeclared entry writes. Any other value is `CONFIG_FIELD_TYPE`; beside `ribs` it is `CONTOUR_PARAMETER` (a rib runs across one outline); a join no pair makes is `CONTOUR_BRIDGE`. A bridge stretches with whatever pulls its two ends apart, so it belongs on a part whose pieces ride one bone — the only case `mesh-draft` drafts; a bridge adds no vertex (issue #570): its four corners, `contour.bridges.joins[].vertices`, are outline vertices of the two silhouettes it joins, and they are weighted as every vertex of the mesh is, by distance to every bone the mesh's `segments` name — no step of the weighting reads which island a vertex lies on, so where two islands ride two bones (two legs in one `legwear` on `leg_r` and `leg_l`) each island's vertices, the corners among them, take weight from the other island's bones too (selftest `CW100`: on its fixture the left island's two corners each take 0.35821 from the right island's bone, and none of its vertices less than 0.30431), and a part whose pieces must not pull each other is split into one part per piece; `regions` — local deformation regions, each `{name, shape, bone, spacing, band}` with `shape` `"circle"` (`cx, cy, r`) or `"polygon"` (`points`, 3 or more): `bone` is the region's control bone (any bone `bones` declares), `spacing` the interior spacing inside the region and its band, `band` the width the bone's weight falls across. Every length and position is **rig px**, like every other in the config; the part image is the rig less `(x − 4, y − 4)` (its box less the pad), a translation, so a length is the same number in both. A region's `cx`, `cy`, `r`, `band` and `points` are multiples of 1/256 px (`CONFIG_FIELD_TYPE` otherwise); region names are unique per mesh (`CONFIG_REGION_NAME_UNIQUE`). `bust` (issue #475) — `{apex_r, apex_l, cleavage, alpha?: 0.22, clearance?: 3.8, bone_r?: "boob_r", bone_l?: "boob_l", spacing?: 14}`: derives the two circular regions `bust_r` and `bust_l` from the three rig-px landmarks `apex_r`, `apex_l` and `cleavage` (multiples of 1/256 px, `CONFIG_FIELD_TYPE` otherwise; projecting the torso midline `neck → chest → hip` onto `apex_r → apex_l` misses the cleavage by 14–93 px across all five calibrated 3/4-yaw characters, so all three points are required). With `d_s = \|cleavage − apex_s\|` and `D = \|apex_r − apex_l\|`, each side `s ∈ {r, l}` is placed at `cx = apex_s[0]`, `cy = apex_s[1]` with outer radius `R_s = d_s − clearance`, core radius `r_s = round(alpha × R_s)` and `band_s = round(R_s) − r_s` (`alpha` = 0.22, `clearance` = 3.8 px, `spacing` = 14 px, `bone_r` = `"boob_r"`, `bone_l` = `"boob_l"` by default, reproducing the five calibrated example characters within `<= 6 px`, max `\|ΔR\| = 5 px`, max `\|Δr\| = 3 px`). Refused when `clearance <= 0`, `R_r + R_l >= D`, or a derived `r_s` or `band_s` is not positive (`CONFIG_BUST_CLEARANCE`), when `bone_r` or `bone_l` is not declared in `bones` (`CONFIG_NAME_RESOLVES`), or when `contour.regions` also names `bust_r` or `bust_l` (`CONFIG_REGION_NAME_UNIQUE`). Both `propose` and `rig` read `contour.bust` through `contourRegionsOf` (`deriveBustRegions`), and hand-written `contour.regions` entries build byte-identically when `bust` is absent. The alpha threshold is not a field: art is alpha above 8, the lattice's and `check`'s |
| `meshes.<part>.ribs` | rig | **authored**, optional (issue #188), in the `contour` and `auto` modes: `{<chain>: {stations}, …}`, each key a chain this mesh's `segments` name. Each link of the chain gets a row of vertices across the part at its origin and at `stations` points evenly between its origin and its end (`stations`, a whole number, 0 or more, required; a chain of L links carries L × (stations + 1) ribs), each rib a row of vertices across the part, kept as a row of locked edges; the rule is "Ribs along a chain" under "A contour mesh". Absent places none and changes no byte. Refused: a lattice mesh with ribs (`CONFIG_RIBS_MODE` — its vertices are its grid's corners), a key that is not one of the mesh's chains (`CONFIG_NAME_RESOLVES`), an object naming no chain or a `stations` that is not a whole number from 0 (`CONFIG_FIELD_TYPE`); at the rig stage `CONTOUR_RIB_ART`, `CONTOUR_RIB_LINK`, `CONTOUR_RIB_CROSSING`, `CONTOUR_RIB_EDGE` (the contour refusals). The mesh's `mesh_report.json` row gains `ribs` — the declaration, the ribs placed and the vertices they hold — and its contour report (the source's, in `auto`) lists each rib's vertices |
| `meshes.<part>.influences` | rig | **authored**, optional (issue #284), in the `grid` and `contour` modes: `{maxInfluences?, floor?}`, at least one. `maxInfluences` — the most bones that pull one vertex, a whole number 1 or more, or `null`, no cap (every bone the mesh's `segments` name; `null` is the config's spelling of a bound declared absent, as in `maxOvershoot` and `weightJump`); absent is 4. `floor` — `"cut"` (the capped shares normalised, any under 0.03 dropped, the rest normalised again; what an absent `floor` means) or `"continuous"` (0.03 subtracted from every capped share, those at or below 0 dropped, the rest normalised again, so a bone fades out of a vertex instead of leaving it in one step). Absent, the mesh is weighted at 4 and the cut and every byte is the one written before the field existed; declared, it applies under either `rule`, and is echoed as `influences` in the mesh's `mesh_report.json` row. `propose` never writes it, and `mesh-draft` carries a lattice's declaration to the contour candidate it drafts. A cap that is not a whole number 1 or more or `null` (the string `"none"` included), another `floor`, or an object naming neither is `CONFIG_FIELD_TYPE`; a vertex the declared cut leaves with no bone is `RIG_INFLUENCES_KEPT`; beside `auto` it is `CONFIG_INFLUENCES_MODE` (that mode's cap and floor are `auto.influences`). What each setting trades is "The weight cut" below |
| `meshes.<part>.stray` | rig | **authored**, optional (issue #303), in the `grid` mode: the largest island, in art pixels, that may be left out of the lattice — the contour mode's `contour.stray`, with the same meaning, over the same islands (the 4-connected islands of the art, alpha above 8): every island of `stray` art px or fewer is cleared from the art the lattice and, under `rule: "heat"`, its silhouette are built over, except an island as large as the largest, which is never left out (two equal largest pieces both stay). Unlike the contour mode an island above the figure is not refused — the lattice bridges every island it keeps, as it always has. An island that sits in a cell the lattice keeps for other art leaves the lattice unchanged: there `stray` changes only the silhouette `rule: "heat"` reads, and gives back no triangle (demo `bottomwear`'s 2 px island, in the cell kept for the hem's tip, is that case). Absent, nothing is left out and every byte is the one written before the field existed; a figure that leaves nothing out changes no byte of `rig.json` or `motion.json`. The part's image is not touched: a pixel left out stays in it, and is drawn only where a cell kept for other art happens to cover it; `art_coverage` is over all the art, the islands left out included. Declared, the mesh's `mesh_report.json` row echoes `stray` and adds `stray_cleared` (`islands`, `pixels`, `art_pixels`, after `influences`), and the rig stage's mesh line ends `stray <n> left out <i> island(s), <p> of <a> art px`. A value that is not a whole number from 0 is `CONFIG_FIELD_TYPE`; beside `contour` or `auto` it is `CONFIG_STRAY_MODE` (those modes state it in `contour.stray` and `auto.source.stray`). `propose` and `mesh-draft` never write it |
| `regions.<part>` | rig | **proposed**: the bone a rigid part rides. Every plan part is exactly one of a mesh or a region (`CONFIG_PART_ATTACHED`) |
| `motion.duration` | rig; check (the loop is measured at this time) | proposed as 40 frames at 12 fps, `40/12` s, written `3.3333333333333335` (issue #252; the reference proposed 4 s, and every period it drafted is scaled with it so each track keeps its cycles per idle); a whole number of 1/12 s ticks, because `check` renders at 12 fps and compares frame 0 with the frame at this time — read within 10^-9 s (`TIME_SLACK`, issue #244), since a whole number of frames is often not exact in binary: rigc's 40th frame sits at `40 × (1/12)` = `3.333333333333333`. Half a frame off is `CHECK_LOOP_LAST_FRAME_AT_DURATION` |
| `motion.tracks` | rig | **proposed**, then tuned. Single `{bone, prop, amp, period, phase, base?}` or chain `{chain, amps, period, phase, lag}` — one amplitude per link, link `i` at phase `phase + lag·i`. Every `period` must divide `duration` (`CONFIG_PERIOD_DIVIDES_DURATION`). A bone property is keyed by one track (`CONFIG_BONE_PROPERTY_KEYED_ONCE`): a chain keys `rotate` on every link, the blink's `eyes` group `scaley` and its `brows` group `translatey` on every member, so a single track on any of those is a second track on it — rigc would refuse it one stage later, `animation "idle" has two tracks on eye.scaley`. The proposed breath (issues #252, #270) is `chest` `translatey` travelling 2.5 % of the torso's length peak to peak — the distance from the `neck` bone to the `hip` bone as the proposal writes them, the run the chest sits half way along, whichever rule placed them — (amplitude half of it to two decimals, `base` the amplitude, so the chest rises from the setup pose and returns); the `breath:` note prints the fraction, the length, the two bones and the pixels. Until #270 it was 2.5 % of the `topwear` part's height, and a sweater to the thighs (`scarf`, 690 px) breathed 2.9 times as deep as `demo`; on neck → hip `scarf` reads 431 px (10.78 px) and `demo` 192 px (4.80 px). Neck and hip on one point: no length to scale by, so the breath keeps the reference's amplitude 1.3 (2.6 px peak to peak) and the note says so — scale it to the figure. `chest` `scalex` and the `head` and `neck` rolls are a ratio and angles and are proposed the same on every figure. A chain link is turned along its chain (the `bones` row), so a `translatex`/`translatey` key on a bone whose parent is a turned link, or a `scale`/`shear` key on a turned link, would move or stretch along the link and not along the picture's axis: the rig stage refuses it (`RIG_KEY_FRAME_UNTURNED`); `rotate` is keyed on any bone |
| `motion.blink` | rig | **proposed**: `{t, eyes, brows, squash, brow_drop}`; the whole blink, `t` to `t + 0.364` s (`t + 0.314` s without brows: the brows' keys are the ones that end last), must fit inside the idle (`RIG_BLINK_INSIDE_IDLE`). The `eyes` group's `scaley` squashes every part on the eye bones about the bone's origin, the eyewhite's centre. Optional: a figure with no `eyewhite-r`/`-l` part has no eye bone, so `propose` writes no `blink` and notes `no blink: no eyewhite part (looked for: eyewhite-r, eyewhite-l), …`; with eyes and no `eyebrow-r`/`-l` part it writes the blink without `brows` and `brow_drop` and notes `blink without brows: …`. `brows` and `brow_drop` are stated together or not at all (`CONFIG_BLINK_BROWS_PAIRED`), and a group that names no bone is refused (`CONFIG_BLINK_GROUP_MEMBERS`) — rigc would refuse it one stage later, `group "eyes" declares no members` — as is a group that names one bone twice (`CONFIG_BLINK_GROUP_UNIQUE`; rigc: `group "eyes" names member "eye" twice`). An `irides-*` or `eyelash-*` part on a side with no eyewhite has no eye bone to ride: `propose` places it on `head` as a region, which the blink does not move, and notes `no eyewhite part for eye_r (looked for: eyewhite-r): iris (head:irides-r) is placed on head as a region, …`. The timing is fixed, not a field (table below) |
| `motion.blink.still` | rig | **proposed** only for a lash `propose` notes (below), then checked: `{<part>: {row, bone}}` — the rows of that region part above `row` (rig px, y down) are drawn by a second slot `<part>_still` on `bone` and do not blink; rows from `row` down keep the part's slot and blink. The part must be a region on a bone `eyes` names, `bone` one it does not (`CONFIG_STILL_OFF_THE_BLINK`), and `row` a row of the part with no art across its whole width (`RIG_STILL_ROW_CLEAR`) |
| `motion.animations_from` | rig; check (named; read for folds) | optional, never proposed (issue #183): a path, relative to the config file's directory, to a file in rig-c's motion-spec shape, `{"spec": "rigc-motion/1", "animations": {"<name>": {"duration": …, "tracks": [...]}, …}}` — an expression, a gesture, anything beside the idle. On every `rig` and `build` each of its animations is written into `rig/motion.json` after `idle`, as read: nothing added, re-keyed or judged here (except `derive` keys on `turn`/`tilt`, issue #436, and `{"t": …, "set": "<name>" \| null}` keys on slot `"attachment"` tracks, issue #473, which expand to `"v": "<set>_<slot>"` or `"v": null` when the set hides the slot, or `"v": "<slot>"` for `null`, refused with `CONFIG_SET_COVERS_SLOT` when the set is undeclared or does not cover the track's slot), and each is rigc's to accept or refuse at the rig stage's gate, in rigc's words. It may name what `motion.json` already holds — the bones `bones` declares, the easings `shut` and `open`, the groups `eyes` and `brows` when the blink writes them — and nothing else from the file reaches it. The loader refuses, every problem at once: no such file or one that cannot be read (`CONFIG_FILE_PRESENT`), text that is not JSON (`CONFIG_IS_JSON`), a file that is not an object, a `spec` other than `"rigc-motion/1"`, an `animations` that is not a table of objects (`CONFIG_FIELD_TYPE`), any other key — rig-c's `easings`, `groups`, `setup`, `physics`, `mix`, `archetype` and `cut` included, which would be read and not written (`CONFIG_KEY_KNOWN`), an animation named `idle` (`CONFIG_ANIMATION_NAME_FREE`), and a key written twice in one object of the file, which JSON would fold into its last value without a word (`CONFIG_KEY_UNIQUE`). `check` names the others on one line (`beside the idle: …`) and reads each for folds, with the idle — `ANIMATIONS_DO_NOT_FOLD` (§7, issues #320, #333); every other bar reads the idle. Absent, `motion.json` holds the idle alone, byte for byte as before, and `check` reads that idle for folds |
| `constraints` | rig (handed to rig-c as `rig.json`'s `constraints`); `compare` and the coverage lines (roles) | **authored**, optional; `propose` writes none, but with `--cloth` (issue #364), where it writes the recipe's physics and swing transforms (*Recipe: cloth and hair that answer the world*, below). A list of constraints in **rig-c's own rig-spec shape** (`RigConstraint`: `ik`, `transform`, `path`, `physics`, `slider` — rig-c's `src/rig.ts` documents every field), in the order rigc applies them. The loader checks only what this package owns: each entry is an object with a `type` rigc names (`CONFIG_CONSTRAINT_TYPE_KNOWN`) and a non-empty `name`, unique within its kind as rigc finds constraints (`CONFIG_CONSTRAINT_NAME_UNIQUE`; an ik and a transform may share one); every bone it names — `bones`, an ik's `target`, a transform's `source`, a physics or slider constraint's `bone` — is a bone `bones` declares, a chain link as `<chain><i>` (`CONFIG_NAME_RESOLVES`); the bone a constraint follows does not sit under a bone it drives (`CONFIG_CONSTRAINT_TARGET_DETACHED`). Every other field (`mix`, `softness`, `properties`, a path's `slot`, a slider's `animation`) and every value is rigc's to accept or refuse at the rig stage's gate, in rigc's words (`RIG_RIGC_GREEN`) — an ik's `bones` as a shape too: from rig-c 2.15.0 rigc refuses an ik over more than two bones, or over a pair whose second bone is not the first's child (issue #103; this loader refused both itself until then). A note and an `x-` record may ride on an entry; the rig stage leaves them out of what it hands rigc. Under the default `--idle-keys ctl` a two-bone ik whose child link the idle keys is split by that link's control, and rigc refuses the pair: run `rig --idle-keys direct` or `build --idle-keys direct` (the rig stage adds that sentence, naming the flag on the command that ran, to rigc's line; `build` forwards it to its rig stage, issue #95). Each bone a constraint follows is declared to rigc as `invariants.detached` from every bone it drives, which rigc's gate rule `A25` checks |
| `stops` | rig (handed to rig-c as `rig.json`'s `stops`, and moves slots, mesh weights and child bones on stopped links onto `<link>_d`); `propose --from-config` (`LINT stop on <chain> …`) | **authored**, optional (issues #404, #447): `[{chain, links?, against, at, inward, outward, lower?: {inward, outward}}]` — rig-c's leg stops (`RigStop`, rig-c 2.56.0, `rig-c/src/stop.ts`). `chain` is a chain `bones` declares (`CONFIG_NAME_RESOLVES`, `RIG_NAME_RESOLVES`); `links`, optional, is a non-empty list of links of that chain (`CONFIG_NAME_RESOLVES`, `CONFIG_FIELD_TYPE`), or absent for every link of `chain` in chain order; `against` is a bone `bones` declares, a chain link as `<chain><i>` (`CONFIG_NAME_RESOLVES`, `RIG_NAME_RESOLVES`); `at` is `[x, y]` in `against`'s local space, as rig-c's stop takes it (`CONFIG_FIELD_TYPE`): since each chain link (`leg_r0`, `leg_r1`) is turned to point along its segment (`+x` from origin to next link or tip, `+y` 90° counter-clockwise in Spine world), `at: [d, n]` sits `d` px from `against`'s origin toward its end and `n` px perpendicular to it; `inward`, `outward` and `lower.inward`, `lower.outward` are finite numbers (`CONFIG_FIELD_TYPE`). Every other stop rule — non-negative bounds, each stopped link written by a constraint, `against` not under the stopped chain, the aim not degenerate, `\|rest\| + outward <= 180°` (`RIG_STOP_BOUNDS`) — is rigc's to accept or refuse at the rig stage's gate, in rigc's words (`RIG_RIGC_GREEN`). **Rising-limb / prone geometry (issue #447):** rig-c's `expandStops` aims `<chain>_rest` from `links[0]`'s setup origin at `<chain>_touch` (`at` in `against`'s local frame) and clamps `<link>_d` inside `[rest − inward, rest + outward]`; Spine wraps rotation at `±180°`, so `\|rest\| + outward <= 180°` is required (`RIG_STOP_BOUNDS`). Whenever `<chain>_touch` lies **above** `links[0]`'s root in rig pixels (`ty < y0`, i.e. higher Spine `y` — e.g. stopping a hanging cloth chain against a rising shin `leg_<s1>` in a prone or kneeling pose where the knee sits below `links[0]` and the ankle above it, so positive `at[0]` walks upward along the shin past `links[0]`'s root), `rest` lands in the upper half-plane (`\|rest\| > 90°`) and `\|rest\| + outward` exceeds `180°`. Stop against the descending thigh (`leg_<s0>`), set `links` to start at a link whose root sits above `<chain>_touch`, or omit the stop when the rising shin sits outside the hanging chain's sweep; `propose --from-config` prints `LINT stop on <chain> …` with the exact coordinates and angles when `<chain>_touch` lies above `links[0]`'s root or `\|rest\| + outward > 180°`. For every stopped link `<link>`, the rig stage moves any slot on `<link>`, any mesh weight on `<link>`, and any bone whose parent is `<link>` (a branched cloth tree's branches hanging from `<trunk_last>`, before `--idle-keys ctl` adds `<bone>_ctl` and before `turn` adds `turn_<part>_<bone>`) onto `<link>_d`, the drawn link bone rig-c's `expandStops` creates at `<link>`'s setup frame to carry the clamped rotation. Absent, `rig.json` carries no `stops` and no byte of any output moves |
| `turn` | rig (adds the turn control) | **proposed** only with `propose --full`/`--head` (issue #251), then corrected: `{pivot, depths, deform?, band?, radius?, surface?: {radius?}, head?: {pivot?, radius?}}`. `depths` holds, per part, the See-through layer's `depth_median` the part came from (larger = further back), read from the run the part was assembled from; a `painting:` patch has none and is not carried. A rider (issue #271) — a part from an `eyewhite`, `irides`, `eyelash`, `eyebrow`, `nose` or `mouth` layer — is drafted at the `face` part's depth, 0.001 nearer when parts.json draws it after the face and 0.001 further when before: See-through makes no depth of its own for the eye group (it cuts them from one depth map of the combined eyes) and clamps nose and mouth to the face's median − 0.001, and the two runs' own medians for these layers disagreed by up to 0.47 and swapped their order against the face. Every other layer — ears, headwear and earwear included — keeps its own median, unless it rides another part's bone. With no `face` part, or more than one, the riders keep their own and a note says so. A rider by bone (issue #535) — a part every *ownable* bone of which (a chain link, or a bone no other bone hangs from; `head`, `chest` and any bone with a child are shared and never count on their own) is *hosted* by another carried part, the host of a bone being the carried part that binds it (its region's bone; a mesh's `segments`, `contour` and `auto` regions' bones) with the most `opaque_px`, the earlier in parts.json on a tie, and which hosts no bone itself — is drafted at its host's depth, 0.001 nearer when drawn after the host and 0.001 further when before, and a note names the host, the bones and its own median: a pin, clip or ornament on the back hair's links travels with the back hair, not with its own layer's depth. `propose` reads the proposal's own `bones`, `meshes` and `regions`; the face riders are read by their tag first and never by their bones. A part bound to two hosts' bones rides neither and a note says so. In the rig stage, an authored depth on a rider by bone whose fraction differs from its host's by more than 0.1 of the dial (`TURN_RIDER_APART`, a share of `pivot − nearest`) is refused (`CONFIG_TURN_RIDER_DEPTH`); the host is read off `parts.json`'s `opaque_px`, so the config loader cannot see it. One note lists each part's depth and where it came from; a carrier the other run places more than 10 % of `pivot − nearest` away gets a note naming both values and the run read — the two runs are not reconciled. `pivot` is the depth that stays put; `propose` drafts the mean of the parts' depths weighted by `opaque_px`, the one depth at which the painted pixels' centroid does not slide under the dial. The rig stage adds a bone `turn` under `root` at its origin that nothing keys — its local x is the dial, in rig px — and carries each part by `(pivot − depth) / (pivot − nearest depth)` of it: the nearest part all of it, a part behind the pivot the other way, a part at the pivot not at all. Each part rides leaf twins (`turn_<part>_<bone>`, an identity child of every bone its slot and weights bind) moved by one `transform` constraint (`turn_<part>`, after the config's own); the idle's keys, the `<bone>_ctl` controls and a physics constraint stay on the bones, and the dial moves none of them. Optional `deform` (`Partial<FaceDeformFractions>`, issue #436) overrides the Set B ×2.5 face surface deformation table (`FACE_DEFORM_FRACTIONS`, checked against `FACE_DEFORM_RANGES` by `CONFIG_TURN_DEFORM_RANGE`); when `applyFaceSurfaceDeform` runs on a rig whose `motion` carries `tilt` or `turn` slider `derive` keys, it requires `config.turn` (`CONFIG_TURN_REQUIRED`, issue #478; `propose --full`/`--head` drafts it), promotes `face` on `head` (or `turn_face_head` when `turn` is declared) to the uneven 5×5 grid mesh, keys `face`, `hair_front` and `hair_back` deform timelines and ear/topknot tracks from `evalPitchFaceSurface` and `evalYawFaceSurface`, and samples the same deform field across each `features` member's rest span (`featRx = (24 / 106) · W`, `featRy = (12 / 128) · H`) with its depth fraction `z / zRef` as the field's angle input and chord foreshortening (`scalex` narrowing on the leading side and widening on the trailing side, `scaley` on pitch) so every feature's bounding box stays inside the deformed face plate across the rated band (issue #468). On yaw (`issue #479`), `evalYawFaceSurface` evaluates a **cylinder projection** (`cylinderYawDx`: `Δx(x, θ, R) = R · (sin(clamp(arcsin(clamp(x / R, −1, 1)) − θ, −π/2, π/2)) − clamp(x / R, −1, 1))`) of radius `R` (`turnSurfaceRadius`: `turn.surface.radius ?? turn.radius ?? turn.head.radius`, positive rig px checked by `CONFIG_FIELD_TYPE`, defaulting to half the face plate's opaque width `W / 2`) tapered by a cubic Hermite outline weight (`wOutline = 1` for `\|ux\| <= 0.7`, reaching `0` at `\|ux\| = 1.0`) so features slide across a fixed outline (`iris` shift within `±2%` of `cylinderYawDx`), the trailing cheek strip widens (`>= 1.54×` at `±15°`), and the leading jaw edge holds fixed (`0 px` shift) unless explicit horizontal `turn.deform` overrides (`turn_mid_x`, `turn_lead_compress_x`, `turn_trail_shift_x`) request the flat yaw table. On yaw (`issue #478`), `applyFaceSurfaceDeform` also derives a **head-only pivot** (`headTurnPivot`: `turn.head.pivot` when authored, otherwise the `opaque_px`-weighted mean of `depths[part]` across the head parts `DEFAULT_HEAD_TURN_PARTS` — `face`, `hair_front`, `hair_back`, `ear_r`, `ear_l`, `hairpin` — from `parts.json`, falling back to `turn.pivot`) so a forward torso or arm in `turn.depths` does not pull the head's rotation axis in front of `face`: `hair_back` (`depth_median > headPivot`, negative `headTurnFraction`) and `hairpin` behind `headPivot` translate opposite to the face's turn (`dx = s · turn_face_center_x · W · (headPivot − depth) / (headPivot − nearestHeadDepth)`), emerging on the trailing side to compensate for the leading-cheek foreshortening and keeping the combined head silhouette width near-constant across `±15°` without any same-sign `turn_hair_back_cheek_x` term. Optional `band` (`number` or `{yaw?, pitch?}`, positive degrees, issue #472) declares the rig's rated face turn band (default `FACE_RATED_BAND`: `yaw <= 15°`, `pitch <= 12°`); declaring a `turn.band` or a `motion.animations_from` `turn`/`tilt` `derive.degrees` above `±15°` yaw or `±12°` pitch without an `assemble.alternates` entry that replaces `face` is refused (`CONFIG_FACE_BAND_EXCEEDED`), and on a single-plate rig `applyFaceSurfaceDeform` adds self-targeting transform constraints `yaw_clamp` (`[-15, 15]`) and `pitch_clamp` (`[-12, 12]`) ahead of the slider constraints so driving `yaw` or `pitch` beyond the rated band clamps at the boundary. At rest: with `turn` declared, no pixel differs by more than 1 level at dial 0 (not byte-identical; the cause is float noise in the identity child bones, and the constraints add nothing); without `turn`, byte-identical. Neither `pivot` nor `depths` has a default (`CONFIG_FIELD_PRESENT`); `pivot` and `head.pivot` must lie behind the nearest part (`CONFIG_TURN_PIVOT_BEHIND_NEAREST`). Absent, no control is added and no byte of any output moves |
| `scene` | assemble (the recomposite, its holes and the figure's mask); check, through `parts.json`'s `scene` block (`RECOMPOSITE_HOLES`, the seam) | **authored**, optional; `propose` writes none (issue #242). `{}` declares the painting a scene: the figure and its surroundings in one image, See-through's full run holding only the figure. With it, `assemble` reads the recomposite figures, the hole list and the `uncovered:` lines inside the figure — the rig pixels where any full-run layer's alpha is above 8 (`OPAQUE_ALPHA_ABOVE`, the cut every layer's painted pixels are read by) — each line starting `inside the figure (config.scene: …, <n> of <m> rig px)`; writes that figure as `figure_rig.png` (white on black) beside the recomposite, and a `scene` block in `parts.json`; flags error pixels on the error map inside it only (outside, the painting grey); and `check` leaves out of the seam every frame pixel whose composite sample reaches the painting's outermost row or column, saying how many (`seam_border` in `check.json`, and on the seam line). It takes no field: the figure and its threshold are derived. A key in it other than a record or an annotation is `CONFIG_KEY_KNOWN`. Absent, no byte of any output moves |
| `cloth` | `propose --cloth` only; no other stage reads it, so it moves no byte of any build | **authored**, optional (issue #364): one recipe per tag, `{"bottomwear": {…}, "back hair": {…}, "front hair": {…}}`, each `{chains, links, wind, gravity, split?, length_ratio?, strength?, damping?, alternate_damping?, translate?, swing?, part?, influence?}`. `influence` (issue #518) — `{across, max, shape, radius?}`: the parts this recipe meshes are drafted in the influence mode (`meshes.<part>.influence` above) at their lattice's cell, with `across`, `max` and `shape` as declared (each required — the reading behind the radius did not vary them) and `radius` as declared or, absent, drafted as the farthest vertex's distance plus 3 cells (the `influence.radius` row); without it the parts keep their lattice. `chains` — trees across the piece (for `back hair`, per side of the eye axis), a whole number, 1 or more; `links` — links from root to tip on every path, 1 or more; `split` — `{at, into}`: the first `at` links are the trunk, which forks into `into` (2 or more) branches; `at` below `links` (`CONFIG_CLOTH_SPLIT_BEFORE_TIP`); `length_ratio` — a path's last link over its first, above 0, default 0.5; `strength` — `{trunk, branch, edge}`, each above 0 and below the spring's stability bound (`CONFIG_CLOTH_SPRING_STABLE`), default 100 / 100 / 50; `damping` — in [0, 1], absent: rig-c's default; `alternate_damping` — the odd trees' damping, in [0, 1], beside `damping` and different from it (`CONFIG_CLOTH_ALTERNATE_DIFFERS`); `wind`, `gravity` — `[root, tip]`, each 0 or more, tip at or above root (`CONFIG_CLOTH_RESPONSE_GROWS_TO_TIP`); `translate` — the x and y mix of a dangling end's flutter, above 0 and at most 1; `swing` — `bottomwear` only, `{scales}`, one positive scale per tree (`CONFIG_CLOTH_SWING_SCALE_PER_TREE`); `part` — `bottomwear` only (`CONFIG_CLOTH_PART_ON_BOTTOMWEAR`), a non-empty part or cut-piece name: the `topwear` part that holds a skirt See-through returned inside it (a dress), or its skirt piece cut by `assemble.cuts`, which takes the skirt's trees (issue #402, *A skirt inside topwear* below; the part is checked by `propose`, `PROPOSE_CLOTH_PART`). The two defaults are the recipe's own, measured on its synthetic fixture (the recipe below). The recipe below says what each field drafts. The config written: `propose --cloth <config.json> --write-config <out.json>` (issue #537) writes this config's own text back with the sections the recipe drafts spliced in — `meshes.<part>` and `regions.<part>`, and `bones`, `constraints` and `motion.tracks` entry by entry by name (issue #552) — and every other byte as read; `--from <previous config>` (issue #571) takes an entry equal to the previous recipe's draft as the recipe's (*The config written*, under the recipe below) |
| `proposed_rig_scale` | assemble, rig, build, `propose --from-config`/`--compare` | **proposed** by `propose` (issue #354): `parts.json`'s `scale_rig_per_source`, the `assemble.rig_scale` the rig sections (`bones`, `meshes`, `limbs`, `motion`) were drafted at. Held equal to `assemble.rig_scale` when present (`CONFIG_PROPOSED_RIG_SCALE`; 0, negative or not a number: `CONFIG_FIELD_TYPE`). Absent on a hand-authored config, where no byte of any output moves |
| `requirements` | build (read in place of `--requirements` when the flag is not given), and so its check | **authored**, optional, never proposed (issue #556): a path, relative to the config file's directory, to the `spine-parts-requirements/1` file the build's check reads (§7, *Declared requirements*) — so a rig that needs one (a `not_swinging` part, a `may_fold`) rebuilds from its config alone. `build` reads it before assemble, as it reads the flag's file, and `check.json`'s `requirements.file` records it with `path` as declared. Given beside `--requirements`, the two must name the same file once resolved, or a file of the same bytes, and the declaration is read and recorded (a build given both writes what the config alone writes); otherwise `BUILD_REQUIREMENTS_CONFLICT`, naming both. Not a non-empty string: `CONFIG_FIELD_TYPE`; no such file, where the config is read from a path: `CONFIG_FILE_PRESENT`. `check`, `compose`, `mesh-draft`, `remesh` and `retune` do not read it: their `--requirements` is the only door. Absent, nothing is read and no byte of any output moves |

**One drawing, one band; beyond it, another drawing (issue #472).** A single front-facing
`face` plate has one painted outline, one nose ridge, and two eyes in front-view topology.
Within the rated single-plate band (`FACE_RATED_BAND`: `yaw ±15°`, `pitch ±12°`),
`applyFaceSurfaceDeform` bends the 5×5 `face` mesh and carries the features along the same
surface field with chord foreshortening (`#468`), keeping every feature inside the face
plate without inventing unpainted geometry. Past `±15°` yaw or `±12°` pitch, a 3/4 or
profile turn is a topological change — the far cheek disappears behind the bridge of the
nose, the jawline shifts to a three-quarter contour, and the far eye changes silhouette —
which warping one front plate can only fake as a stretched rubber mask. Rather than
silently extrapolating a single plate into angles it does not depict, `rig-parts` refuses
any `turn.band` or `turn`/`tilt` `derive.degrees` above `±15°` / `±12°` unless an
`assemble.alternates` entry supplies a second `face` drawing (`CONFIG_FACE_BAND_EXCEEDED`),
clamps the single-plate `yaw` and `pitch` controls at `±15` and `±12` via `yaw_clamp` and
`pitch_clamp`, and, when an alternate face set is declared, omits the clamps and records
`"threshold": {"yaw": 15, "pitch": 12}` on that set in `sets.json` so the consumer swaps
plates at the rated boundary.

**A scene target is an ordinary bone.** A target the scene places — a point a hand
reaches for, a face something turns toward — is a single bone parented to `root`,
`{"name": "tgt", "parent": "root", "at": [x, y]}`, that a constraint names as its
`target` (an ik) or `source` (a transform). There is no other bone kind: it binds no
art, nothing in the idle keys it, and `compare` and the coverage lines call it a
`target`. Its `at` is where it rests; the scene moves it later. The rig stage declares
it detached from the bones its constraint drives (`invariants.detached`), so rigc's
gate refuses the built rig if it is ever re-parented under them. What `--idle-keys`
does to a constraint, measured through rig-c 2.10.1 on the selftest's rig
fixture (a two-link chain whose links the idle keys and a mesh is weighted to, its
4 s idle rendered at 12 fps), the first row again through 2.15.0 (issue #103); the
selftest's `RG56`–`RG58` hold every row on the installed rigc:

| constraint on the chain | `--idle-keys ctl` | `--idle-keys direct` |
| --- | --- | --- |
| ik over both links, target under `root` | refused by rigc (from 2.15.0; `RIG_RIGC_GREEN`): `<link1>_ctl` stands between the links, so the pair is not a parent and its child — at 2.10.1 it gated green and the tip missed the target by 2.58 rig px in every frame. rigc's sentence ends with a remedy a config cannot follow (it names the control); the rig stage adds one naming `--idle-keys direct` on the command that ran | gates green; tip on the target in every frame (largest gap 1.7e-7) |
| ik over one link (an aim) | gates green | gates green; the same per-frame tip distances as `ctl` (0.67 to 0.90 rig px; an aim is not a reach) |
| physics on a link (`rotate`) | gates green | gates green; the link's world rotation within 1.7e-9 degrees of `ctl`'s in every frame |
| transform on a link (`rotate` from the target) | gates green; the link's world rotation is the target's | the same |

The blink's timing is the tree's (`BLINK` in `src/motion.ts`), in seconds after
`motion.blink.t`:

| phase | eyes (`scaley` 1 → `squash` → 1) | brows (`translatey` 0 → `-brow_drop` → 0) | easing |
| --- | --- | --- | --- |
| shut | 0.07 | 0.08 | `shut` |
| hold | **0.084** (the reference: 0.04) | **0.084** (the reference: 0.04) | none |
| open | 0.16 | 0.20 | `open` |

The holds are the one departure from the reference implementation, and the reason is
the loop (issue #32). `check` renders the idle at 12 fps, a frame every 0.083333 s, and
the loop is encoded from those frames. A 0.04 s hold is shorter than a frame, so it
held a frame only for some `t`: at the examples' 2.3 s the eyes were shut from 2.37 s to
2.41 s, between frames 28 (2.333 s, `scaley` 0.8356) and 29 (2.417 s, 0.2435), and over
every key time the 6-decimal grid can write, 129,999 of the 250,000 phases against the
frame grid showed no closed frame. A closed window at least one frame long holds a frame
wherever it starts, so the hold is 1/12 s rounded up to the third place; the brows' hold
grew by the same 0.044 s, so they still reach their drop 0.01 s after the lids shut and
leave it 0.01 s after the lids open. The rig stage refuses a hold under one frame by
name (`RIG_BLINK_HOLD_SPANS_A_FRAME`, §6), counted over the same 250,000 phases.

The proposer's reach (from `src/propose.ts`): roles come from each part's tag —
`face` makes `hip`/`chest`/`neck`/`head`, the eyewhites make the eye bones (irides and
lashes ride them, or `head` on a side with no eyewhite), brows are
told apart by position, `bottomwear` makes the hip and three skirt chains,
`handwear` makes sleeve chains (one blob or two), `front hair` makes fringe chains
and a lock chain for each strand that hangs below the chin, `back hair` makes a bun
bone or two hanging chains, and `headwear`/`earwear` get a rigid bone and a pendant
chain — or, when the accessory has hanging strands, one pendulum chain per strand
(below). What it cannot know — something painted inside another layer that should
swing, hair of another shape, whether an accessory swings — is yours to add, and
`notes` in `proposal.json` says where it guessed. A part from a layer you made by hand
(`author:<label>`, §5, *A layer the author made*) has no tag, so no rule reads it: it
rides the nearest trunk bone until `regions.<part>` names its bone, and its note says so.

**The fringe stands in the head's frame (issue #249).** The three fringe chains,
`bang_r`, `bang_c` and `bang_l`, are a template: columns at 0.25, 0.5 and 0.75 of the
face box's width, with the reference's 10 px outward step per link. The columns run
along the head's down axis — the perpendicular of the eye line through `eye_r` and
`eye_l` as `bones` writes them, the roll the `head frame:` note prints — and each root
sits 13 px below where the part's art starts on its column (the run of art that crosses
the brow line), so on a tilted head the chains lean with the head and start on the hair,
not on a hat above it. The opaque shape cannot separate locks painted inside one mass of
hair, so a note names the part and says the columns are a template: move them onto the
locks. With no eye pair the columns stand on the page, and the note says why. `lint`
holds every chain hung from `head` on a head-run `front hair` mesh whose tip is no lower
than the chin (the face box's bottom centre, along that axis; a strand hanging past the
chin hangs with its weight): a link that drifts across the head's down axis by more than
the template's widest step plus a pixel's rounding at each end (10 + sqrt(2) px, an
angle of atan(11.41 / reach) for the link's reach down the axis) is a
`LINT <link> at … runs to … N degrees off the head's down axis` line. The page-vertical
template the proposer wrote before issue #249 fires it on any head tilted more than a few
degrees (the trailer character, 23.7 degrees: all six links; `reference-demo`, 3.2
degrees, and `reference-sample`, -4.9 degrees: one link each).

**Two chains on one lattice (issue #314).** `lint` swings every pair of chains a lattice
mesh's `segments` both name, both keyed by a chain track, on the rig stage's own lattice and
weights (`src/squeeze.ts`: the part padded as the rig stage pads it, `latticeMesh`, and
`influences` under the mesh's `r`, `exponent`, `influences` and `stray`, rounded as the
lattice rounds — so its vertex and triangle numbers are the ones `rig.json` and `check`
use). Each link turns as the idle's sine states it at every frame `check` renders, every
other bone held at the setup pose, and each edge is read by `check`'s own reader. A pair
whose worst edge is past `TEXTURE_STRETCH`'s bar (max(ratio, 1/ratio) above 1.926544)
prints
`LINT <a> and <b> on mesh '<part>' squeeze it: swung together, every other bone held, edge <i>-<j> of triangle <t> closes to <r> times its rest length at idle frame <f> (max(ratio, 1/ratio) <s>; <= 1.926544 is required, check's TEXTURE_STRETCH bar) — vertex <i> rides <bone> <w>, vertex <j> rides <bone> <w>; alone, <a> reads <x> and <b> <y>. Their tips are <d> px apart and …`
(`stretch it` and `opens` when the edge grows). The end names the amplitudes and the
remedies whose own figure passes the bar: with the two chains' amplitudes opposed link for
link, `give both the same sign (then <s'>)` — `<s'>` the same reading with the second
chain's signs turned; `drop one chain` when each alone passes, or `drop <b>, which alone is
past the bar too` when only one does; and, when none passes,
`lower the amplitudes`. A contour or automatic mesh, or `rule: "heat"`, is not rebuilt here:
a `note: squeeze not read: …` line names the mesh and its pairs. What it predicts is
`check`'s measurement without the other bones' motion. Measured: on `fixtures/squeeze.ts`
(two chains 39 px apart at their tips, the proposer's mirrored back-hair amplitudes) it
names the triangle, edge and frame `check` fails, 2.494 predicted against 2.488 measured,
and one sign passes both (1.054); on the four public examples it prints nothing; on
`reference-demo` the back-hair pair reads 1.393 at `hair_back` edge 43-42, frame 26 — the
edge and frame `check` reports as that example's worst, 1.388, the figure the bar is the
square of — and 1.075 with one sign; on `reference-sample` the sleeve pair reads 1.230 at
the edge and frame `check` reads 1.227 at.

**Why the back hair mirrors.** The proposer drafts `hairback_r` with amplitudes
`[0.6, 1.4, 2.4]` and `hairback_l` with their negatives, while the fringe, lock and skirt chains share one sign (the two sleeve chains are mirrored
the same way). The mirror is the reference proposer's draft,
ported as it was (`src/propose.ts`, `SIDES`); no reason is recorded with it. Opposed, the
two tips swing towards each other and apart on the same beat. On two hanks far apart that
costs nothing a bar reads (`demo`, tips 371 px apart: 1.050 for the pair, as for either
alone), and on one mass with the two chains close it squeezes the lattice between them
(issue #314: tips 39 px apart, an edge at 0.065 of its rest length). Whether the hair is one
mass is not something the proposer can read off the opaque shape — both chains always hang
on the one `back hair` part — so the draft is unchanged and the squeeze is measured instead,
by the lint above.

**A posed figure: `propose --keypoints`.** Without joints the proposer reads the
torso by screen y: the hip 0.14 face heights below `bottomwear`'s top edge (or below
the waist: *The hip*, below), the chest half way up to the neck, sleeves hanging from the
shoulders. A figure whose joints are not where those rules put them — a reclining
figure, an arm raised or crossed, or a seated figure whose skirt does not start at
the hip — is told where its joints are with one explicit file (issue #75,
`src/keypoints.ts`). Sitting alone does not call for it: a seated figure whose skirt
starts at the waist has its hip there (issue #314: a seated character proposed without
joints, its hip placed and `lint` clean, built green once its back-hair chains were
fixed). But a clean `lint` does not say the hip is right: the screen-y rules ask only
that the hip be below the chest and below 0.25 of the figure's height, and a hip at a
seated skirt's top passes both (selftest `PR56`: the rule's hip 28 px above where the
thighs leave the torso, no LINT line) — read the overlay, and where the hip or a sleeve
is off its joint, give the joints. A pose file named by
`generation.control.skeleton` is not that file and is not offered as its default:
the control skeleton is what was asked of the model, not where the joints ended up
(a consumer measured a generated picture not following the control's raised hand),
so `keypoints.json` is read off the generated picture:

```json
{
  "spec": "spine-parts-keypoints/1",
  "space": { "units": "painting-px", "origin": "top-left", "y": "down" },
  "width": 1664, "height": 2432,
  "source": "what produced this file (recorded, never interpreted)",
  "people": [
    { "id": "a", "joints": {
        "neck":    { "state": "observed", "at": [826, 464] },
        "l_elbow": { "state": "occluded", "at": [1030, 926], "score": 0.4 },
        "r_ear":   { "state": "missing" } } }
  ]
}
```

The space is stated and any other is refused (`KEYPOINTS_SPACE_STATED`); `width`
and `height` are the painting's and are held to `--source` (`KEYPOINTS_IMAGE_SIZE`).
Joint names are the body-18 names of `src/skeleton.ts` (`nose`, `neck`,
`r_shoulder` … `l_ear`), and `r` / `l` are the **subject's** sides. Each joint is
`observed` (with `at`), `occluded` (`at` optional — when given it is the producer's
estimate and said as that) or `missing` (no `at`); a joint the file does not list is
missing. A `score` is the producer's and is printed beside the joint; nothing here
computes one. With more than one person, `--person <id>` names one; nothing picks.
Painting px reach rig px by the overlay's own map, `x * W/width`, `y * H/height`
(0.5 for both examples).

What a joint with a position places, as given — no ratio is applied over it:

| bone | from | when the joint has no position |
| --- | --- | --- |
| `neck` | `neck` | the rule: half way from the chin to the neck part's bottom (or 0.12 face heights below the chin), on the eye axis |
| `hip` | the midpoint of `r_hip` and `l_hip` — a point between two joints, said as that | the hip rule (bottomwear top, the waist, or 0.32 of the figure); one hip alone is said to be unused |
| `chest` | its rule, half way from neck to hip, taken along the line between the placed ends | the rule as before when neither end is a joint |
| `sleeve_<s>` | `<s>_shoulder` → `<s>_elbow` (two links), tip at `<s>_wrist`, with the two-blob rule's first two amplitudes; the arm is a limb (issue #349), `arm_<s>`: its handwear part is cut at the elbow into `upperarm_<s>` on link 0 and `forearm_<s>` on link 1, each a region — no mesh, no chest stub — when every handwear part over 500 px holds one such wrist within 15 px of its art (the larger of the x and y gaps, the LINT's own tolerance), is bound one by `--wrist-snap` (below), or is that side's hanging arm whose wrist drifted off the arm layer onto another layer (issue #491, below); when pre-separated `handwear-r` and `handwear-l` parts cross so that `<s>_wrist` lies on the opaque art of its own side's `handwear-<s>` part and also within 15 px of the opposite side's `handwear-<other>` part, it resolves to its own side (issue #458) | the sleeve rule places every sleeve chain, and each arm joint's note says why: for a wrist on no part, `… lies on the art of no handwear part within 15 px, so it does not say which sleeve it ends; the nearest is <part>, <d> px from its art by the larger of the x and y gaps (--wrist-snap <d> would bind it)` — `(beyond --wrist-snap <px>)` when the flag was given and fell short, and `the nearest are <a> and <b>, each <d> px …, so no tolerance says which` when two parts tie |
| `eye_<s>`, `head`, the face box | not moved: they are measured off the parts | the note prints the eye joint's distance from the eye bone, with no bar |
| `leg_<s>` (issue #241), `foot_<s>` | on a `legwear` part over 500 px: `<s>_hip` → `<s>_knee` (two links), tip at `<s>_ankle`, parent `hip` — when every such part holds the ankle of a leg whose three joints are given, within 15 px of its art; a part holding both ankles gets a chain per leg. The leg is a limb (issue #349), `leg_<s>`: the part is cut at the knee into `thigh_<s>` on link 0 and `shin_<s>` on link 1, each a region — no mesh, no `hip` stub (until #349 the thigh was meshed with one, which pinned it to the hip as the chest stub pinned a sleeve); two legs on one part are split between the two limbs by the cut. When every leg's ankle lies within 15 px of the art of exactly one `footwear` part over 500 px, each leg gets `foot_<s>`, a single bone at the ankle under `leg_<s>1` with `inherit` `"noRotationOrReflection"`, and the footwear part is cut between the feet as `foot_<s>`, the limb's third segment; otherwise no foot is drafted and the note gives each ankle's distance to the nearest footwear art. No idle track: the chain is drafted whatever the pose, and whether the legs move is the scene's. A note per limb says what was cut and why | no leg with all three joints: no chain, and the part is the trunk rule's region with the note it always had, byte for byte. A complete leg whose ankle lies on no legwear part, or on two: no chain, and a note `<parts>: no leg chain — <why>; the trunk rule places it` |
| the trunk parts' segments (issue #243) | on the `neck` (head run), `topwear` and `bottomwear` meshes, each `[bone, from, to]` segment the rule drafts down the screen is laid along neck → hip, the line the chest is placed on — `neck` + 18 px along it to `chest`; a topwear part's `chest` segment from its art's nearest reach toward the neck end to 20 px short of `hip`, and its `hip` segment from there to 100 px past `hip`; a bottomwear part's `chest` segment, when it has one (issue #262: only when its art reaches above `chest`), from 30 px short of `chest` to 20 px short of `hip` — and the bottomwear waist segment runs across that line, 5 px past `hip`, over 0.09 to 0.91 of the art's width across it. The `head` segment on the neck mesh and the one-blob sleeve rule's chest segment are not moved. A note, `trunk segments (<parts>): laid along neck -> hip …`, gives the line's angle | neither end a joint: the vertical draft, byte for byte. Neck and hip on one point: no line, the vertical draft, and a note says so. An upright line over boxes tight on their art writes the vertical draft's bytes |

**`--wrist-snap <px>`** (issue #199), with `--keypoints` only, declares a tolerance
for a wrist that lies on no handwear part within the built-in 15 px — hands folded
together, or a sleeve painted over the hand. `<px>` is an integer above 15 (the
distance is counted in whole px, so a fraction would bind exactly what its floor
binds, and 15 or less binds nothing the built-in does not); anything else is refused
as a usage error naming the value, as is the flag without `--keypoints` or with
`--from-config`, which proposes nothing. Such a wrist is measured to every handwear
part's art by the larger of the x and y gaps — the measure of the built-in 15 px —
and bound to the one nearest part when it is at most `<px>` away; two parts tied
nearest bind neither. A bound wrist's joint lines say `(the wrist is bound to <part>
by --wrist-snap)`, and a note says which wrist went to which part and how far:

    wrist snap: r_wrist at [x, y] lies on no handwear part within 15 px; --wrist-snap <px> bound it to <part>, the nearest, <d> px from its art by the larger of the x and y gaps

A wrist already on a part is not moved by the flag, and without the flag nothing
changes, byte for byte. Choosing the tolerance automatically is not done: the note
for an unbound wrist prints the distance that would have bound it.

**A hanging arm's wrist off its arm layer (`PROPOSE_WRIST_OFF_LAYER`, issue #491)** —
when an arm hangs (`elbow.y > shoulder.y` and `wrist.y > elbow.y`) on its side's
handwear part (`handwear-<s>`, or that side's sleeve of a two-part handwear pair
whose shoulder and elbow both lie within 15 px of the part and whose art reaches at
least 18 px below the elbow) and the keypoint detector's `<s>_wrist` lands off the
arm layer (for example on a warm-toned skirt or dress below the hand), the elbow
cut comes from the limb chain (`<s>_shoulder` → `<s>_elbow` → the bottom extent of
the arm layer), not from the off-layer wrist read, and a `PROPOSE_WRIST_OFF_LAYER`
note names the arm layer, the layer the wrist landed on, the chain tip, and the
chain-derived elbow cut:

    PROPOSE_WRIST_OFF_LAYER: r_wrist at [x, y] lies outside <part> (<from>)'s mask (<d> px from its art by the larger of the x and y gaps, on <other>); chain sleeve_r places its tip at <part>'s bottom extent [tx, ty] instead of r_wrist, and limb arm_r places the elbow cut at [ex, ey] ([ex.x, ey.y]) from the limb chain (r_shoulder [sx, sy] -> r_elbow [ex, ey] -> [tx, ty])

**One handwear part holding both wrists** — two sleeves and the hands decomposed as
one piece, not clasped at the midline — gets both arms' limbs on its one part, and a note says so:

    one handwear part holds both wrists: r_wrist and l_wrist both end on <part>, so limbs arm_r and arm_l both take it, and the cut gives each pixel to the arm whose bones pass nearest it; where the arms touch or cross in its art that split is a line no painting draws — to draw it yourself, cut one sleeve out of <part> with an assemble.cuts entry (a polygon round it) and name the piece as that arm's from

An `assemble.cuts` entry (§3; §5, *Cutting a piece out of a layer*) draws the split by hand;
the proposer does not.

**A figure of one material: limbs from one layer (issue #577).** A wooden mannequin,
a statue or a robot of one finish reaches See-through as one garment: the whole body
in `topwear`, `legwear` and `footwear` near-empty and left out of the plan below the
floor of 150 px. No handwear or legwear part carries a limb, so the rules above
draft none. With `--keypoints`, an arm whose shoulder, elbow and wrist are given
when **no** handwear part is over 500 px, and a leg whose hip, knee and ankle are
given when **no** legwear part is over 500 px, is drafted from the **figure layer**:
the one `topwear` part over 500 px (no cut piece) whose art holds, within 15 px by
the larger of the x and y gaps, every joint of those limbs and the origins of
`hip`, `chest` and `neck` — and, when both legs are drafted, whose art breaks on the
line from `r_knee` to `l_knee` and on the line from `r_ankle` to `l_ankle` (the
reading `PAINTING_LEGS_APART` makes): a robe over both legs is one column there,
and would be split into legs it does not have. Within 15 px is not on the art: each
cut the draft makes on the layer — the trunk's at `chest` and `neck`, each arm's at
its elbow, each leg's at its knee — must lie on that limb's own art within 1 px
along its joint line, read by assemble's own test (the run `ASSEMBLE_LIMB_JOINT_ON_ART`
refuses a cut without, each pixel the limb's whose bones pass nearest it), or the
draft is a config assemble refuses (issue #629, selftest `PR560`). A part a cloth
recipe names (`config.cloth.<tag>.part` or `.parts`) is no candidate either: it
keeps the recipe's mesh — a limb takes every pixel of its part, so cut into limbs
the recipe's trees would move no artwork — and a note names it and the recipe;
when it is the only part that holds the joints, `PROPOSE_FIGURE_LAYER` refuses it by
name (issue #631, `PR561`). The arms are the sleeve chains and
`arm_<s>` limbs and the legs the `leg_<s>` chains and limbs above, on that part,
and the trunk is a limb of its own, `trunk` — `trunk_hip` on `hip`, `trunk_chest`
on `chest` below the joint at chest's origin, `trunk_neck` on `neck` past the
neck's — because a limb takes every pixel of its part: without it the torso and
the neck would go to the nearest arm or leg. Each pixel goes to the limb whose
bones pass nearest it, the rule two legs on one legwear part are split by. A limb
whose route has a part keeps it: with a handwear part on each arm, the arms are the
sleeve rule's and only the legs and the trunk come from the figure (selftest
`PR551`). A note names the layer and why:

    <part> (<from>): the figure layer — no handwear part and no legwear part are over 500 px, and its art holds within 15 px every joint of arm_r, arm_l, leg_r, leg_l and the origins of hip, chest and neck; limbs trunk (trunk_hip on hip, trunk_chest on chest, trunk_neck on neck, cut at the chest's and the neck's origins) and arm_r, arm_l, leg_r, leg_l split it between them by the cut, each pixel to the limb whose bones pass nearest it — the rule one legwear part holding both legs is split by (issue #577)

Two topwear parts that both hold everything are decided by their opaque px in the
31x31 squares about those points (the square the 15 px tolerance reads), and the
note adds both counts; a tie is refused, `PROPOSE_FIGURE_LAYER`. A topwear part that
misses one gets no limb, keeps the topwear rule, and a `figure layer: …` note names
the first point it misses, the line on which its legs are one column, or the cut
whose joint line misses its art, with the nearest pixel on that line and how far. With no
topwear part over 500 px nothing is said and nothing moves. A garment figure whose
tags carry its limbs is drafted byte for byte as before: the public examples'
proposals are unchanged. The fixture is `fixtures/mannequin.ts`: one `topwear`
layer of 7,856 px drafted into the trunk, both arms and both legs by `propose
--keypoints` with no hand re-sort, and the draft built `check: PASS` (selftest
`PR554`). Its feet stay in the shins: no footwear part is over 500 px, so no
`foot_<s>` is drafted, and the note says so.

Every other joint (`nose`, ears, the knees and ankles no leg chain used; the eyes
with no eyewhite) is named with its state in one note: no bone is authored from it. Every joint the proposer
could use gets its own note — `used as given for bone X`, `used as the producer's
estimate for bone X`, or `missing: the rule "…" placed bone X instead` — after every
note the rules wrote. LINT then reads the torso by the relations the joints declare:
where `neck`, `r_hip` and `l_hip` all have a position, along the line from the neck
to the hips' midpoint the chest must fall strictly between them, the hip past the
chest, and the hip nearer the hips than the neck — these replace the two screen-y
torso lines; and each `sleeve_<s>` chain's links and tip must advance from
`<s>_shoulder` toward `<s>_wrist`. The first lines say which rule set ran and on what
basis (`lint rule set: joints …` or `lint rule set: screen — …`). The off-art check is
unchanged, and `--from-config … --keypoints` lints a corrected config the same way.
Without `--keypoints` nothing changes, byte for byte. Two rules still read the screen
under keypoints and are not this file's to change: the skirt chains hang down from
the hip, and a part no rule claims rides the trunk bone its centre is nearest by y.

**A figure with no `face` part** (turned away, or half hidden behind a partner,
so See-through found hair and a neck and no face) still gets a proposal. The face
box every rule scales by is derived from the head run's hair (`front hair`,
`back hair`: their highest top) and its `neck` (its top, and its centre x for the
axis): with `L` the span from the hair's top to the neck's top, the face is
1.067 `L` tall, its top 0.131 `L` below the hair's, its width 0.798 of its height.
Those ratios are the means of the two public examples (`reference-demo` 1.073 / 0.105 /
0.820, `reference-sample` 1.061 / 0.158 / 0.777) — a sample of two. On each example
re-assembled without its face, the derived box put `head` and `neck` within
5.0 px (0.038 face heights) of the with-face proposal's, `chest` and `hip` at
the same pixel. The first note says so —
`no face part: face box derived from the head run's hair (…; top y=…) and neck (…), a span of … px — … (ratios measured on the two public examples); …`
— and names each face-reading rule left with nothing to read (eye bones and blink,
brows, mouth). Correct `head` and `neck` against the overlay. With no head-run
hair or neck there is nothing to derive from, and `PROPOSE_FACE_PRESENT` still
refuses (§6).

Two rules read the figure rather than one tag, and each says so in a note:

- **The hip.** It sits 0.14 face heights below `bottomwear`'s top edge — unless
  that is above 0.25 of the figure's height (every part's union, top row to bottom
  row), which is a long robe tagged `bottomwear` that starts at the collar. Then
  the note `hip: <part> (<from>) starts at y=…, so its top + 0.14 face heights
  (y=…) is above 0.25 of the figure height (y=…, figure y …): its top edge is not
  the waist` is followed by one of `hip from the waist: silhouette narrowest at
  y=170 (width 51 px, shoulders 80 px at y=96), hip 0.14 face heights below it` —
  the torso layers (`neck`, `neckwear`, `topwear`, `bottomwear`, `legwear`,
  `footwear`) at their narrowest between the shoulder line (their widest row
  within one face height below the neck) and the figure's middle, and at most
  0.8 of the shoulders — or `hip from 0.32 of figure height (no waist found: …)`,
  naming why. Without `bottomwear` the hip is 0.32 of the figure height, as before
  (`no bottomwear: hip from 0.32 of figure height`). Neither published example
  meets either branch: their hips sit at 0.436 (`reference-demo`) and 0.342 (`reference-sample`) of
  their figures.
- **What a skirt hangs from** (issue #262). A `bottomwear` part whose art starts
  below the `chest` bone's origin (along neck → hip where the joints give that line,
  down the screen otherwise) hangs from the waist: its mesh takes the hip line and
  its three skirt chains, and no `chest` segment, with the note `<part> (<from>):
  its art starts … px below chest's origin, so it hangs from the waist — …`. With a
  `chest` segment ending at the waist the waistband takes some `chest` weight and the
  breath lifts the skirt's root while its hem, on the chains, stays: on `scarf` that
  was `TIP_OVER_ROOT` 0.300 at the proposal's breath (upper half 0.492 rig px, hem
  0.148), and 2.614 without the segment. A `bottomwear` that reaches above the chest —
  the long robe of the hip rule above — has art on the chest and keeps the segment.
- **Clasped hands.** When every `handwear` part together is one blob (over
  500 px) at most half the shoulders' width and centred within a quarter of it
  of the eye axis, it is the hands clasped in front, not two sleeves: it rides
  `hip` as a region, no sleeve chain is made, and the note reads `handwear is one
  blob (<parts>) WxH px centred at x=…: at most 0.5 of the shoulder width (… px
  at y=…) and within 0.25 of it of the eye axis x=…, so clasped hands: a region on
  hip, no sleeve chains`. Two sleeves hanging from the shoulders are at least as
  wide as them: the examples' one-blob sleeves are 1.51 and 1.58 shoulder widths,
  and keep their two chains.

**Hanging strands** (tassels, cords, drop earrings) on a `headwear` or `earwear`
layer — the two tags the proposer has an accessory rule for; any other tag rides a
trunk bone as a region and says so in its own note. A strand is an 8-connected
sub-shape of the layer's **pendant rows** (the run of rows at the bottom narrower
than 35 % of its widest row; the whole layer for `earwear` or a layer that is over
80 % pendant) that is at least **3×** as tall as wide, at least **0.2** of the
layer's height and at least **10** rows. On the public examples nothing is one: the
reference-demo's hairpin pendant sub-shapes measure 0.54 and 0.89 tall-per-wide and its
earrings 1.04 and 1.08, so both proposals are unchanged. Every layer with strands
gets exactly one note carrying each strand's column centroid, first–last row and
width, and what became of it (two of the selftest's fixtures, PR12 and PR15):

    crown (head:headwear): 2 hanging strands at x=7,92, y 16-55,16-55, width 5,5 -> pendulum chains hairpin_strand0_, hairpin_strand1_
    veil (full:headwear): 1 hanging strand at x=20, y 120-159, width 5 -- no chain proposed (it rides the head as a region)

`-- no chain proposed` is the line to act on: that strand hangs stiff unless you add
a chain. It is written for a second layer of the tag (a region cannot swing) and for
a strand whose chain would leave the art (`...; no chain proposed at x=151 (a chain
down it would run off the art)`). The chain rule: `<bone>_strand<k>_` (links
`<bone>_strand<k>_0`, `_1`), two links at the strand's top row and 0.45 of the way
down, each at the strand's column centroid in a 24-row band, tip on its last row —
the reference tassel's shape and sway (`amps [4, 7]`, period 2, phase 0.2, lag
0.12). On a layer with a body it hangs from the layer's bone, as the tassel does,
and the mesh adds one segment of that bone across the body's full width at its mean
row, so the body stays on its bone (on the selftest's crown: 0.55 px off it over the
idle with that segment, 1.07 without; the tassel tips swing 5.0). On an all-pendant
layer each chain hangs from `head`, with a `head` stub above each strand. Strands
replace the single pendant chain: a chain at the mean x of two strands hangs between
them.

**The lash that carries a crease** (issue #26). See-through sometimes paints the
double-eyelid crease into the `eyelash` layer, and the blink squashes the whole layer
about the eye bone — so the crease is squashed with it, on one eye and not the other.
`propose` notes an `eyelash-r`/`-l` part that reaches more than 35 % of its own height
above its eyewhite's top, or is more than 1.2 times the height of its pair; on the two
examples the four lashes reach 17-26 % (4-6 px, the lash line itself) and the pairs are
1.00 and 1.04 apart, so neither is noted. When such a lash has a row between its top and
the eyewhite's top with no art across its whole width, the lowest such row is proposed as
`motion.blink.still` on `head`, and the rows above it stop blinking; when it has none, the
note says so and nothing is cut — clear a row between the crease and the lash line in the
part, or leave the crease to blink. The cut has to be a clear row: two pieces cut through
art are each resampled against their own transparent edge, and on the reference-demo example a cut
through its lash line changed 36 px of the setup-pose render (up to 7 levels, at render
scale 0.942) and up to 21 levels in the idle frames where the head rolls; a clear-row cut
changed none, at rest or rolled. The eye bone is not moved: scaling about the eyewhite's
top edge instead would close the eye upward onto the upper lid and still move whatever sits
above it by (1 − squash) × its height above the pivot, so the cut, not the pivot, is what
holds the crease.

### Limbs: cut at their joints (`limbs`, issue #349)

**A limb is separate parts, cut at its joints, each rigid on its own bone.** The upper arm,
the forearm with the hand, the thigh, the shin and the foot are each a part on one bone with
weight 1, and a bend is a rotation at the joint, never a deformed mesh. A limb mesh blended
along a chain and bent hard is what every "grotesque" verdict on a posed rig came from (the
exam's walk, rig-c/pose's demo); a part on one bone cannot do that, and `check`'s
`LIMB_ONE_BONE` refuses a limb part bound to a second bone by name. Everything below this
section about fitting a mesh to motion — the weight cut, the contour and automatic modes, ribs,
the physics recipe — is for the parts that have no joints: the skirt, the clothing, the hair,
the torso.

**Assembled order and final rig slot order are distinct** (issue #646). Assembly keeps
`parts.json` and its recomposite in the authored part order, including each patch's
`draw`. At rig time, each declared limb gathers its exclusively bound rider slots
locally into its existing segment block. The block's anchor is its first segment
slot in the original setup draw order; block-anchor order and each limb's owned
slots' internal relative order are stable. This applies to every declared limb,
without inferring an anatomical pair or a torso target. A front painting patch
bound exclusively to a foot therefore stays in front of that limb's own earlier
slots, but need not remain globally in front of every unrelated slot in the rig.

Ownership reads explicit region bindings and every weight of every base/alternate
attachment, following the bone graph to a declared segment boundary. A still slot
is read from its own binding. Mixed bindings spanning limbs, a limb and outside
bones, or attachments with different owners are nonexclusive and are not forced
into one block; complete closure is not promised across them. With no declared
limbs, rig output is unchanged. Gathering riders can cross an intervening part
whose pixels overlap them, so setup RGBA equality must be measured on the authored
input. Public generated setup comparisons are evidence for those inputs, not a
universal promise that all art keeps its compositing order.

**Explicit adjacency** (issue #647) is optional and takes effect at **rig time**,
after every base and alternate attachment has been built. For example, on an
existing limb named `unit_a`:

```json
"layout": { "before": { "limb": "unit_b" } }
```

Exactly one of `before` and `after` is required, and its target names exactly one
`limb` or produced `part`. It means immediately adjacent in setup slot order, with
the subject block before or after the stationary target block. It does not name
an anatomical role or request a pose depth policy. A consumed source layer is not
a produced part: name the emitted segment part instead.

Without `parts`, the subject is its whole exclusive limb block, including its
inherited riders. To move only a source-bound segment scope, write, for example:

```json
"layout": { "parts": ["piece_a_lower"], "after": { "part": "panel" } }
```

`parts` is a nonempty list of this limb's own **consecutive segment-part names**,
not numeric indices or rider names. List order does not reorder the art. Inherited
riders move only when every base/alternate binding belongs entirely to the selected
segment boundaries. A rider spanning selected and unselected boundaries stays
unforced, as does mixed ownership across limbs. Partial layout explicitly overrides
whole-limb closure for that scope: it never drags an unselected upper segment along
with the selected lower one. A target limb is its whole exclusive block; a target
part uses its actual generated slot family, including a still piece, without
suffix matching. A requested segment or target with mixed bindings is refused.

Only disjoint placements are supported. Self, reciprocal, chained/shared-slot,
and pair/part conflicts name both declaration paths and the shared slot; no
constraint solver chooses a winner. Internal block order and all unselected
slots' mutual order are stable. Declaring placement may change visible occlusion;
assembly's part/PNG/recomposite order and every setup seam bar remain unchanged,
so check can still refuse a setup whose occlusion differs from its authored stack.

A declared layout writes **`layout.json`**, `spec: "rig-parts-layout/1"`, beside
`rig.json` and optional `sets.json`. The companion records the SHA-256 of those
**exact final accepted bytes**, final `setup_slots`, and deterministic `placements`
with `limb`, selected segment `parts`, authored `before`/`after`, resolved `slots`
and `target_slots`. It is never a new core RigSpec field or a fictitious alternate
set. Replayed candidates re-resolve closure before their gate. All metadata checks
precede output; only a successful green undeclared `rig` removes its stale owned
companion. With no layout declaration, output and log bytes retain the preceding
limb-closure path and no companion is emitted.

Producer adjacency is **not consumer motion acceptance**. Pose 0.42 does not read
this companion. Pose issue #346 owns its actual reader and explicit depth-source
mapping, including a refusal when a part/scope has no supported depth source. Do
not infer it from names, parents, weights, an ordinal or a zero-depth fallback.

`propose --keypoints` drafts the block from the body-18 joints (§3, *A posed figure*): an arm
whose shoulder, elbow and wrist are given is `arm_<s>`, `upperarm_<s>` on `sleeve_<s>0` and
`forearm_<s>` on `sleeve_<s>1`, cut at `elbow`; a leg whose hip, knee and ankle are given is
`leg_<s>`, `thigh_<s>` on `leg_<s>0` and `shin_<s>` on `leg_<s>1`, cut at `knee`, and — when
every leg's ankle lies on one footwear part — `foot_<s>` on a bone of its own at the ankle under
the shin, `inherit` `"noRotationOrReflection"`, so the shoe keeps its setup angle while the leg
turns (`FEET_STAY_LEVEL`, §7). Nothing else is a limb: hair chains and physics sleeves are not,
and a config without `limbs` builds as it always did. Then `assemble` with the block cuts the
layers, as follows; every step is arithmetic on the declared bones and the layer's pixels
(`src/limbs.ts`):

- **Which limb.** A part a limb takes (`from`) goes wholly to the limbs that take it. With two —
  See-through's one `legwear` holding both legs — each pixel goes to the limb whose polyline (its
  bones' origins in order, then the last bone's end) passes nearest the pixel's centre, a tie to
  the limb declared first. No polygon is drawn, and each leg's lower part carries its own cap.
  When the two limbs cross in an X on one part (issue #446), nearest-bone splitting cuts a straight
  line through the crossing; declare `config.limbs.<covering>.split` on the covering limb — either
  `{"line": [[x, y], …]}` (a polyline of two or more points in rig px along the covering limb's
  seam) or `{"edge": "painting"}` (traces the covering limb's dark outline stroke at or below the
  part's Otsu luma split, or its uncrossed silhouette width, across the crossing) — so the covering
  limb's pixels stay on the covering limb and the seam follows the limb. Without `split`, the
  nearest-bone split stays and `propose`'s `LINT` names the crossing.
  For a subset alternate set (issues #588, #609 and #638), ownership applies to every
  segment source, including a separate `footwear` layer holding both shoes. With
  separate islands, each segment keeps the island under its joints; with one shared
  island, pixels go to the nearer line in the set's pose, using only the segments
  that take that source. Footwear therefore reads each leg's ankle-to-toe segment,
  not its thigh or shin. The toe comes from the foot bone's authored `tip`, placed
  with that bone in the set; a missing endpoint on a shared one-island source is
  `ASSEMBLE_ALT_LIMB_POSE`, never a guessed length or direction. The existing
  overlap band and draw order settle near ties. A source already holding only
  that side follows the existing path.
  Issue #638's acceptance was **changed after measurement** (decision alternative 3):
  foreign-leg components must be zero, with own-cap components counted separately.
  That historical measurement did not satisfy the original second-island <=1% bar.
  On the public generated default-cap control, explicit pre-#637 test settings
  (`setCover: "painting"`, `setCapOwnership: "source"`, neither a CLI/config option)
  retain the whole-limb-line mutant's islands `[97,16]` and the source-segment
  line's `[104,16]`. All 16 pixels of the separate component are `CAP_FROM_UPPER`
  copies from the same leg's shin, strictly owned by that foot's ankle-to-toe
  segment. Issue #637 additionally preserves the assigned own-cap connection
  through covering layers: the current default is one connected `[272]` component,
  with the same 16 pixels and their 64-pixel bridge retained, and zero foreign-leg
  pixels. Copy provenance alone grants no protection; target ownership is assigned
  first, through the same source-segment helper as the ordinary source art. The
  controls preserve the historical pixels byte for byte in the current default,
  detect a planted foreign owner, causally remove each upper-source copy, and
  reject deleting valid own-cap art. Neither change alters the cap's shape.
- **The joint line.** Between two segments the joint is the lower bone's origin, and the line
  runs through it perpendicular to the limb's axis there — the sum of the upper bone's and the
  lower bone's unit directions, so on a bent limb the bisector. A pixel whose centre is past the
  line (its dot product with the axis, from the joint, above 0) goes to the lower segment.
  Segments from different parts (the shin's legwear, the foot's footwear) are not cut at all:
  each takes its limb's share of its own part.
- **The cap.** Each lower segment carries an overlap past its joint: the pixels within half the
  limb's width of the joint, on the upper side of the line — a disc about the limb's width across,
  so a bend shows no gap. The width is read along the joint line: the limb's art (alpha above 8,
  both segments' parts) within half a pixel of the line, the run through the joint (its nearest
  pixel within 1 px of it, neighbours at most 1.5 px apart), first to last plus one pixel, to 3
  places. The tool invents no pixel of it: each is the `cap` image's where that image is not
  transparent, else the layer's where the limb has art there, else the **upper segment's** art
  there (issue #557 — the shin's pixels where the boot's layer does not reach over the knee, the
  shin's again for a shoe that starts below the ankle line; until #557 only `cap_shape: "disc"`
  read it), else **missing**. The line `assemble` prints for each joint counts them and gives the
  cap's box, `[x, y, w, h]` in rig px (`N px from "<upper>"` only where the upper segment gave a
  pixel, so a full cap prints what it printed):

      limb cap: "arm_r" joint "elbow" at [332, 424], on "forearm_r": a disc of radius 19.9165 px (the limb 39.833 px across the joint line), box [312, 404, 40, 40] — on the upper side of the line 621 px from the layer, 7 px missing — …

  The missing pixels are where no layer of the limb has a pixel: where the painting hides the limb,
  or where the disc passes its outline — the half-disc is half the limb's width about the bone's
  origin, so a bone off the limb's middle puts the far side of the disc past the outline (every
  missing pixel on the public `wind` example is that: 9 to 72 per joint, each on one side, none
  within the half-width about the joint). **A cap with missing pixels is short** (issue #557): its
  record carries `short_px: {left, right}` — the missing pixels by side of the limb's axis at the
  joint line, `left` where a pixel centre's offset across the axis is 0 or above (the side toward
  smaller x when the limb hangs down the rig), `right` the other, the two adding up to
  `missing_px` — and `assemble` prints one `LINT` line after its `limb cap:` line:

      LINT "shin_r" cap at [34, 30] (limb "leg_r", joint "knee", radius 4 px): short_px left 0, right 3: no layer gives them — 3 px of the disc on the upper side of the cut, where neither the layer of "boots" nor that of "legs" has a pixel of the limb; the rest of the disc is filled, 17 px from "shin_r"'s layer, 6 px from "thigh_r"; under cap_shape "disc" the disc is the half-width about the joint, 4 px, and 3 of them lie within it

  The last clause, on a cap without `cap_shape`, counts how many of them the disc of the
  half-width about the joint would still hold: none means `cap_shape: "disc"` closes the
  shortfall (it does on every `wind` joint). A full cap writes no `short_px` and prints no `LINT`.
  Paint them — and, if the layer's own pixels carry the limb's outline across the cap, the whole
  cap — into a `w`x`h` image whose pixel `(i, j)` is rig pixel `(x + i, y + j)`, and name it in
  the segment's `cap`; its transparent pixels keep the layer's. The record is `parts.json`'s
  `limb.cap` on the lower part. A cap image of another size is `ASSEMBLE_LIMB_CAP_SIZE`, one
  transparent over every cap pixel `ASSEMBLE_LIMB_CAP_EMPTY`.
- **`cap_shape: "disc"`** (issue #360, opt-in on the segment below the joint). The cap becomes a
  disc of the limb's **half-width about the joint**: the distance from the joint to the nearer end of
  the same run along the joint line (each end half a pixel past its centre), to 3 places — half the
  width when the bone sits in the middle of the limb, less when it sits off it, so the disc lies on
  the limb's art across the line either way. It is measured, never typed; a joint on the very edge of
  the run has none and is `ASSEMBLE_LIMB_JOINT_ON_ART`. The cap's pixels come from the image, then
  the layer, then **the upper segment's art** where the lower's layer has none (the shin painted down
  to the ankle is the shoe's cap) — the plain cap's order too since issue #557 — and only where no
  segment has art are they missing. The `limb cap:` line adds `N px from "<upper>"` always, and the
  record `shape` and `upper_px` (without the shape, `upper_px` only when above 0). The upper piece's
  **corner** at the cut is kept where it is: on a joint off the limb's middle, a corner trimmed to the
  disc leaves a notch at rest when no piece takes it, or a stub out of the bent lower piece's outline
  when the lower takes it (pictured in the pull request that added these two fields).
- **`cap_shape: "ball"`** (issue #579, opt-in on the segment below the joint). The disc of
  `cap_shape: "disc"` — the same radius — on **both** sides of the joint line: a hinge whose painting
  shows a V-notch beside the joint (a wooden mannequin's elbow, knee or ankle) turns on a ball, and a
  whole disc about the pivot is the one shape a turn maps onto itself. The upper half is filled exactly
  as `"disc"` fills it. The lower half is written into the **lower** piece from the cap image, which now
  covers the whole disc, and only where the piece's own pixel is **transparent — alpha 0**, the reading
  the upper half's fill gives a layer's pixel and the image's; where the piece paints a pixel, however
  faint, it is left as painted, so no pixel the lower layer paints changes. Where the piece is
  transparent and the image gives no pixel, the pixel is **missing**, counted as the upper half's are:
  in `missing_px` and `short_px`, with the `LINT` line. The tool generates none of the ball; the image
  is the author's. The `limb cap:` line counts the lower half apart, after the upper side's counts, and
  the record adds `lower_px` (written), `lower_kept_px` (left as painted) and `lower_missing_px`, with
  `shape` `"ball"` and `upper_px`:

      limb cap: "arm_r" joint "elbow" at [27, 32], on "forearm_r": a disc of radius 15 px (cap_shape "ball": the joint's distance to the nearer side of the limb, 30 px across the joint line), box [12, 17, 30, 30] — on the upper side of the line 358 px from the cap image, 0 px from the layer, 0 px from "upperarm_r", none missing; cap_shape "ball": on the lower side of the line 64 px written into "forearm_r" from the cap image where its layer is transparent (alpha 0), 294 px left as painted, none missing

  (the notched hinge of the check suite's ball control: an arm 30 px wide, a V-notch of 8 rows below
  the elbow line cut from both edges, 64 of its pixels inside the disc). An image that gives no pixel
  the cap takes — transparent over the upper half and over every lower-half pixel where the piece is
  transparent — is `ASSEMBLE_LIMB_CAP_EMPTY`. `check` holds a ball joint to the rest-pose seam's bar
  and to the `"disc"` record's no-pixel bar at each pose of its range (`SEAM_OVER_RANGE`, issue #598),
  over the whole disc, both halves — what the ball writes.
- **`edge: "feather"`** (issue #360, opt-in on the segment below the joint). The upper piece fades
  out across the overlap band instead of stopping at the joint line. The band is the disc about the
  joint that the lower piece covers at every turn — the distance to the nearest pixel it does not
  hold at alpha 255, less sqrt(2), a bilinear sample's reach, and at most the cap's radius — and each
  upper pixel inside it, above the line, keeps alpha × (its distance above the line ÷ the band's
  height there): 0 on the line, 1 on the band's arc. Over art that stays opaque under it at any
  angle, the rest pose composites to the hard cut's bytes and no bend shows through the fade what
  lies behind the limb. A pixel the fade lowers to alpha 8 or below (`OPAQUE_ALPHA_ABOVE`) leaves the
  upper piece's region (its opacity is held by the lower piece's cap beneath), and the rest of the
  ramp is kept through `pushBackFringe` when another limb crosses in front of the joint (issue #444).
  The `limb cap:` line adds `edge "feather": N px of "<upper>" faded …`, and
  the record `edge`, `feather_radius` and `feathered_px`.
- **`cut_band: N`** (issue #360, opt-in on the segment below a joint whose two segments take one
  part). The cut is placed rather than typed: of the lines parallel to the joint line at whole-pixel
  offsets `-N .. N` along the axis, the one that crosses the fewest **stroke pixels**. A line crosses
  the pixels a joint line runs through (the limb's art whose centre lies within half a pixel of it,
  across the run of art through its point — the reading the limb's width uses); a stroke pixel is one
  of those, over the whole band, whose integer BT.601 luma is at or below the **Otsu split** of their
  luma histogram (the dark class of the two that maximise the between-class variance). The split is
  derived from the band's own art and no threshold is typed: art of one luma has no split and so no
  stroke. Ties go to the line nearer the joint, then to the upper side, so with nothing to avoid the
  joint line itself is chosen. The bone does not move — the joint, the cap's disc and the limb's width
  stay at its origin; only the line that splits the pixels between the two pieces moves, and the cap
  takes the disc's pixels on the upper side of that line (under `edge: "feather"` the fade runs from
  that line to the band's arc). The art read is the layer as the cut splits it, before the seam pass
  recolours what the painting shows. A cut off the joint line leaves a sliver of one piece on the other
  side of the pivot; `SEAM_OVER_RANGE` reads what that costs at a bend. A band with a line off the
  limb's art is `ASSEMBLE_LIMB_CUT_BAND`. The `limb cap:` line adds `cut_band N: the cut
  <k> px before|past the joint line (toward "<part>"), through [x, y], crosses <n> stroke px; the joint
  line crosses <m> (stroke: luma <T> or below, the Otsu split of the <px> px …)`, and the record
  `cut_band`, `cut_offset`, `cut_at`, `cut_crossed`, `joint_crossed`, `band_px` and, when the band has
  a split, `stroke_luma_max`.
- **A cut from a limb's layer** (issue #564). An `assemble.cuts` entry may take pixels from a part a
  limb takes — the top of a shoe See-through painted into `legwear`, which the shin would otherwise
  hold and draw a second time over the foot. The cut is made first and the limb cuts what the part
  keeps, so the pixels leave the shin and are drawn once, by the piece; `parts.json` records the
  piece's `cut_from` as the limb's part, which the reader finds as the segments' `limb.of`. The cut
  may lie only where no segment of the limb holds the layer: the segments taking the part run from
  the joint above the first of them (when it sits below one) to the joint below the last (when one
  follows), and every pixel the cut takes must lie **past the lower line** (the ankle under a shin) or
  **before the upper line and outside that joint's cap disc**, which the run's own layer fills there.
  A pixel anywhere between is `ASSEMBLE_CUT_CROSSES_LIMB`, naming the limb, the first pixel, the
  segment's band it lies in (or the cap) and the line it must lie past. The piece is a part like any
  other: give it a `regions` (or `meshes`) entry — for a piece past the lower line, the bone of the
  segment below that joint, which the `cut:` line names
  (`; "shoe_top" lies past joint "ankle" of limb "leg_r", in the band of "foot_r" on bone "foot_r"`).
  A cap is read from the parts after the cut, so its `short_px` counts what the cut left; a piece
  past the lower line takes nothing a cap reads (a cap is the disc's upper side), and leaves it as it
  was.
- **Draw order.** A limb stands where its upper segment's part stood in the plan, its parts
  lowest first, so the upper is drawn over the lower at every joint: upper arm over forearm,
  thigh over shin, shin over foot. The parts it took leave the order.
- **What `check` reads.** `LIMB_ONE_BONE` (§7) holds every limb part to its one bone in
  `rig.json`. A segment that declares a `range` is bent there: `SEAM_OVER_RANGE` (§7, issue
  #360) poses its joint at the range's two ends and its middle and reads the rest-pose seam's
  bar at each, against the same pose with the joint's own art drawn under the limb — so a cap
  that does not cover the turn is a FAIL naming the joint and the angle, where the rest pose
  showed nothing. A joint whose cap is `cap_shape: "disc"` or `"ball"` (issue #598) is held to
  more: no pixel of its disc over 40 at any pose, the disc being the cap's whole claim — for a ball
  both halves of it, the lower piece's included, so a ball whose image leaves the lower half unpainted
  fails at a bend. Each pose's row also prints the
  **contour step** (issue #557), the step the eye sees in the outline where the cut meets it — a
  reading, never a bar (§7). `TIP_OVER_ROOT` does not read a limb part (it turns at its joint; it does not
  hang), and its row says so.

The first character built this way (the exam-01 test rig, issue #349) read, per joint, 5 to 10
missing cap pixels at the elbows and knees and 468 and 562 at the ankles, where the shoe starts
below the ankle line.

### The weight cut (`meshes.<part>.influences`, issue #284)

This section and the mesh sections after it are for parts with no joints; a limb is cut at
its joints instead (*Limbs: cut at their joints*, above).

The distance rule (and bone heat) shares a vertex among the bones its mesh's segments name,
then cuts the list: the 4 largest kept, any share under 0.03 dropped. Both numbers are the
reference implementation's (`[:4]` and `>= 0.03`), carried over as port constants. Neither
is a limit of the format — spine-core reads a weighted vertex as a bone count followed by
that many bindings, with no bound on the count — and rig-c neither refuses nor warns above
four: its one assertion on a mesh's weights, `A20_MESH_WEIGHTS_COHERENT`, checks that they
are coherent, not how many there are (`docs/evidence/weight-cap.md`, *Where four comes
from*, in the repository). The cut is where a vertex changes hands in one step, and in the
lattice and contour modes a mesh may declare it:

```json
"bottomwear": { "grid": 25, "r": 10, "segments": [["hip", [232, 425], [601, 425]], "skirt_r", "skirt_c", "skirt_l"], "influences": { "maxInfluences": 6, "floor": "continuous" } }
```

**When to reach for it:** a part that folds where two chains meet, or at the end of a curl.
The default does not move; a fold is today found by looking at a build that passes every
bar, and this field is what there is to turn once one is seen.

**What it trades.** Every figure below is issue #284 Stage E's, verbatim from
[`docs/evidence/weight-cap.md`](https://github.com/rig-c/parts/blob/main/docs/evidence/weight-cap.md), on every lattice mesh of `demo`,
`scarf` and the trailer (`rig-c/trailer` at a99d976): the inverted triangles at the bend
sets (±15° on every chain link; on the trailer also ± the film's own bends, after the
slash), the largest idle displacement against today's rig in rig px (the part in the
survey's tables), and the cost — bindings (one per bone per vertex) in the whole
`rig.json`, `rig.json`'s length and the compiled `skeleton.json`'s, in bytes. Every
setting passed every `check` bar on all three examples, and `rigc render`'s time did not
separate them (the run's own spread was as large). "Cap none" is the survey's name for
`maxInfluences: null`.

| setting | inverted at the bends: demo / scarf / trailer ±15° / trailer film | idle vs today, rig px: demo / scarf / trailer | bindings: demo / scarf / trailer | `rig.json` bytes: demo / scarf / trailer | `skeleton.json` bytes: demo / scarf / trailer |
| --- | --- | --- | --- | --- | --- |
| cap 4, cut (today, absent) | 1 / 36 / 6 / 7 | — | 3008 / 4192 / 5014 | 471635 / 665178 / 773228 | 648296 / 886481 / 993045 |
| cap 4, continuous | 1 / 42 / 5 / 0 | 1.252 / 0.676 / 1.471 | 3008 / 4192 / 5014 | 471627 / 665230 / 773235 | 648282 / 886533 / 993052 |
| cap 5, cut | 1 / 35 / 5 / 1 | 1.853 / 1.291 / 1.875 | 3257 / 4546 / 5337 | 502053 / 707658 / 812385 | 670404 / 917493 / 1021528 |
| cap 5, continuous | 1 / 46 / 3 / 0 | 1.293 / 1.139 / 1.580 | 3257 / 4546 / 5337 | 502059 / 707681 / 812407 | 670410 / 917516 / 1021550 |
| cap 6, cut | 1 / 41 / 7 / 0 | 2.417 / 1.274 / 2.235 | 3423 / 4787 / 5562 | 522287 / 736622 / 839712 | 685243 / 938707 / 1041677 |
| cap 6, continuous | 1 / 45 / 3 / 0 | 1.329 / 1.132 / 1.750 | 3423 / 4787 / 5561 | 522272 / 736693 / 839600 | 685228 / 938778 / 1041595 |
| cap 8, cut | 1 / 43 / 20 / 3 | 3.350 / 1.274 / 3.106 | 3532 / 4969 / 5692 | 535476 / 758656 / 855632 | 694930 / 954712 / 1053604 |
| cap 8, continuous | 1 / 46 / 7 / 0 | 1.365 / 1.122 / 2.248 | 3532 / 4969 / 5692 | 535455 / 758684 / 855638 | 694909 / 954740 / 1053610 |
| cap none, cut | 1 / 43 / 22 / 3 | 3.350 / 1.291 / 3.179 | 3514 / 4987 / 5684 | 533305 / 760874 / 854648 | 693337 / 956381 / 1052864 |
| cap none, continuous | 1 / 47 / 7 / 0 | 1.365 / 1.114 / 2.197 | 3513 / 4987 / 5684 | 533169 / 760956 / 854631 | 693238 / 956463 / 1052847 |
| every bone, nothing dropped (the survey's reference; not a setting) | 0 / 36 / 0 / 0 | 3.350 / 1.336 / 3.286 | 5446 / 8969 / 9087 | 770980 / 1244841 / 1270495 | 866749 / 1314917 / 1358750 |

In the survey's words: cap 5 adds 6.4–8.4 % bindings, cap 6 10.9–14.2 %, cap 8 13.5–18.5 %,
no cap 13.4–19.0 %; `rig.json` grows 5.1–6.5 % at cap 5 and 10.5–14.4 % with no cap, the
compiled `skeleton.json` 2.9–3.5 % and 6.0–7.9 %; nothing dropped at all costs 81–114 % more
bindings. Read per part, where the folds are: on the trailer the skirt's hem corner at the
film's bends folds 5 today and none at caps 5 and 6 with either floor, and none at any cap
with the continuous floor; the long hair's curl tips fold 4 at ±15° today and none at caps
5 and 6 with the continuous floor, and more, not fewer, above six with the cut (17 at cap
8, 19 with no cap); demo's one fold, on the fringe, is there under every setting. The idle
moves under every setting that changes a weight: that column is the price of the change
itself, not a defect of the setting, and it is what to look at on the part before keeping
one. The survey's own pages hold the per-part tables and the pictures.

**What a declaration writes.** On `demo` and `scarf`, a config declaring each setting on
every lattice mesh writes, at every lattice vertex, the bones and weights the survey wrote
for that setting (measured when the field landed: 0 vertices differ in each of the twenty
builds), so the bindings and the largest count are the table's. `rig.json`'s length matches
the table at cap 4 and is a little shorter above it (demo at cap 5: 500517 bytes against
the survey's 502053), because the survey bound a bone new to a vertex at an offset read off
the rendered setup pose, and the rig stage writes that offset exactly, as it writes every
other. Under the continuous floor a share can round to 0, so such a mesh is rounded as a
contour region is (each share to 5 places, a 0 dropped, the remainder to the heaviest); under
the cut it is rounded as the lattice always was. In the contour mode a region's bone counts
toward the cap like any other (*The vertex's weights* in `src/localweights.ts`).

### Which mode comes out smaller (issue #307)

The names suggest that `auto`, the mode that reduces a mesh, is the smallest. Measured on one
figure, it is not always: a reduction held to a large declared bend keeps many vertices to stay
near its dense source, and on such a part the outline `mesh-draft` drafts over a coarse grid
came out two to three times lighter. On parts that bend little, `auto` was far the smallest.

The figure is the trailer's (`rig-c/trailer`, 1108 px tall). Triangles per part, as the rig
stage's `mesh` lines print them: the kept modes from commit 45becfb; the `auto` counts of the
three parts that left it from the commit before, 24bd8ec (each `auto` with the film's bends
declared as `auto.stimulus` and `auto.motion.maxLocalDeformation` 3 px); the lattice column each
part at `"grid": 30`, the spacing `propose` drafts for this figure, in 45becfb's config
(`topwear` left on `auto`); and `mesh-draft` run over that lattice config. The bends are the
largest turns the trailer's `WORKING.md` states for its film, not re-measured here.

| part | the film bends it | `auto`, bends declared, 3 px | `mesh-draft` | lattice at `"grid": 30` |
| --- | --- | --- | --- | --- |
| `bottomwear` | 24° | 276 | 132 | 140 |
| `handwear_r` | 33° | 148 | 49 | 52 |
| `hairpin` | 95° (refused by `auto`; `contour` at its own spacing 13: 120) | — | 47, kept on its lattice (below) | 46 |
| `legwear` | 12° | 77 | — | 176 |
| `hair_back` | a few degrees | 28 | — | 120 |
| `handwear_l` | 4° | 31 | — | 72 |
| `neck` | — | 7 | — | 12 |
| `hair_front` | 11° | 112 | — | 114 |

Every count reproduces with `@rig-c/parts` 1.11.0 and rig-c 2.47.0 (the trailer's pins at
45becfb, both configs over the same assembled parts), and the lattice and `mesh-draft` columns
again with this package on rig-c 2.40.0. `mesh-draft` kept the hairpin on its lattice: its
candidate, 47 triangles, sat 1.055 rig px from the lattice over the idle against a line of 1, and
had one triangle more than the lattice's 46 (with the hairpin's lattice declaring
`influences: {floor: "continuous"}`, as 45becfb's contour entry does, the idle reads 0.822 and
passes, and the triangle line alone keeps it). The trailer's 47 is that candidate, written by
hand. The film's two cuts were compared at their most different frame, enlarged; no difference
showed, and every `check` bar passed on both.

So, before keeping an `auto` entry on a part a chain or physics bends far: build the part once on
a lattice, run `mesh-draft` (§4, step 12), and compare the two `mesh` lines. Nothing else reports
the difference; `mesh-draft` names every `auto` or `contour` entry as not compared, because it
drafts lattice entries only. This is one figure, and the two examples here were not measured this
way.

### A contour mesh (`meshes.<part>.contour`, issue #84)

The lattice keeps every grid cell that holds an art pixel, so its boundary and its interior
density are one number: a finer `grid` tightens the outline and densifies the whole part at
once. A contour mesh separates them. Its outline is rig-c's own trace of the part's
silhouette — the art with its holes filled, grown by `margin` (a pixel joins when its centre lies
within `margin` of an art pixel's centre: at 1 its four neighbours, from √2 its 3x3 block), with
any diagonal pinch the growth made filled (both clear pixels of it, repeated until none is left)
— then `simplifyClosedPolygon(tolerance)` (issue #106: this replaced rigc's `offsetPolygon`,
which folded the outline over any notch narrower than twice the margin; a grown silhouette is a
set of pixels and its trace cannot cross itself — a narrow notch grows shut instead). Its
interior vertices are the ones declared — each region's boundary, its band's outer edge and its
own `spacing` grid inside region and band, then the background `spacing` grid — and the
triangulation is a constrained Delaunay one that never crosses the outline (`src/contour.ts`).
Where the outline passes through a region and its band, the outline is cut there at the
region's `spacing` too (issue #110): points are inserted exactly on its edges, held to the same
keep radius (half the spacing) from the edge's ends and from each other, so the outline encloses
the same pixels and only gains vertices. Without it an outline edge crossing the band is held by
its two ends alone — no interior point may sit within half a spacing of the outline — and one
long edge from inside the region (`g` = 1) to past its band (`g` = 0) spreads the region's
motion along its whole length. A region whose band reaches no outline edge changes no hull
vertex; one that does keeps every hull vertex in the same order from index 0, and a vertex moves
up only by the points inserted before it.

**Weights.** A region's bone takes `g` at a vertex: 1 inside the region (its edge included),
`1 − d/band` at a distance `d` past it, 0 at `d ≥ band` (with `band` 0, a step) — linear, no
curve. The rest, `1 − g`, is shared among the segment bones exactly as the lattice shares a
vertex (`w = 1/(d + r)²`, at most 4 bones, the 0.03 floor inside that share). A vertex no
region reaches is weighted and rounded exactly as a lattice vertex at the same point would be.
With a region present: a region bone that is also a segment bone is one entry,
`g + (1 − g)·share`; when the segment share already holds 4 bones and the region's bone is not
one of them, the lightest segment bone is dropped (never `g`); the 0.03 floor is not applied
again to the scaled shares; the weights are rounded to 5 places, an entry rounding to 0 is
dropped, and the remainder goes to the heaviest entry, so each vertex sums to exactly 1
(`src/localweights.ts`, `roundShares` in `src/rig.ts`). The 1 and the 0 are decided exactly on
the 1/256 px grid; only a value in between is a floating-point figure. A region's bone counts
as a mesh bone, so an idle key on it moves to `<bone>_ctl` under `--idle-keys ctl` like a
segment bone's.

**What it reports.** `mesh_report.json`'s row for a contour mesh carries `mode: "contour"`, the
parameters it ran at, `src/contour.ts`'s whole report (outline and interior vertex counts,
triangles, coverage, overshoot and its bound, enclosed transparent area, the smallest angle and
largest edge ratio with their triangles, the islands and pixels left out, and what the traced
silhouette holds besides the art, each pixel counted once: `filledHolePixels` (the art's own
holes), `grownPixels` (added by the margin), `pinchFilledPixels` (added by the pinch fill) and
`grownHolePixels` (transparent pixels the grown silhouette encloses — a notch whose mouth grew
shut))
and, per region, the vertices its bone reaches (`g > 0`) and holds alone (`g = 1`).
`art_coverage` is over all the part's art, stray islands included (in the automatic mode it is
not: there the islands `source.stray` leaves out are cleared from every reader's art, see
`source.stray` below). A lattice mesh's row is
unchanged.

**Refusals** — every one names the part, the value found and the value required, and every
contour refusal in a run is listed together; nothing falls back to the lattice:

| rule | means | change |
| --- | --- | --- |
| <a id="CONTOUR_COVERAGE"></a>`CONTOUR_COVERAGE` | an art pixel lies outside the mesh after the margin and simplification | raise `margin` or lower `tolerance` |
| <a id="CONTOUR_OVERSHOOT"></a>`CONTOUR_OVERSHOOT` | the mesh reaches further than `margin + tolerance + 1` px past the art | lower `margin` or `tolerance`; a grown pixel is within `margin` of art by definition, so what passes the bound is simplification, or a transparent pocket the grown silhouette closed (counted in `grownHolePixels`) |
| <a id="CONTOUR_BUDGET"></a>`CONTOUR_BUDGET` | more vertices than `budget` | coarser `spacing` or region `spacing`, or a larger `budget` |
| <a id="CONTOUR_ONE_ISLAND"></a>`CONTOUR_ONE_ISLAND` | the art is more than one 4-connected island (every island's pixel count named); with `stray` declared, an island other than the largest above it, or a tie for the largest | `stray`, if the extra islands are stray pixels you accept not drawing; `bridges: true`, if the pieces ride one bone (issue #326); otherwise a part that is two pieces stays a lattice part, or is split |
| <a id="CONTOUR_BRIDGE"></a>`CONTOUR_BRIDGE` | under `bridges`, a grown silhouette no bridge can join: of every pair of a vertex on the joined outline and one on a silhouette still apart, none gives a quad wound as the mesh that crosses no outline, holds no other vertex and leaves one closed outline (the silhouettes joined and apart named by art px). The case selftest `CT107` plants: a tolerance that simplifies one outline straight across its notch and through the piece standing in it | lower `tolerance`, or keep the lattice for this part |
| <a id="CONTOUR_TRACE"></a>`CONTOUR_TRACE` | rigc's tracer refuses a diagonal pinch (two pixels meeting at one corner) in the silhouette before it grows, in its words. A pinch through a hole is not one (the hole is filled first), and no island with its holes filled has one (selftest `CE08`, over every island of every 4x4 mask), so this is a guard; a pinch the growth makes is filled, not refused | the lattice, or the art |
| <a id="CONTOUR_SELF_INTERSECTION"></a>`CONTOUR_SELF_INTERSECTION` | the simplified outline crosses itself, or too few vertices are left | lower `tolerance` |
| <a id="CONTOUR_INDEX"></a><a id="CONTOUR_GRID"></a><a id="CONTOUR_COINCIDENT_VERTICES"></a><a id="CONTOUR_ZERO_AREA_TRIANGLE"></a><a id="CONTOUR_ONE_LOOP"></a><a id="CONTOUR_TILING"></a>`CONTOUR_INDEX`, `CONTOUR_GRID`, `CONTOUR_COINCIDENT_VERTICES`, `CONTOUR_ZERO_AREA_TRIANGLE`, `CONTOUR_ONE_LOOP`, `CONTOUR_TILING` | the built mesh fails a topology check (a bug, not an authoring error) | report it |
| <a id="CONTOUR_PART_HAS_ART"></a>`CONTOUR_PART_HAS_ART` | no pixel above alpha 8 | re-run assemble |
| <a id="CONTOUR_PARAMETER"></a>`CONTOUR_PARAMETER` | a parameter `src/contour.ts` cannot run at: a margin above 0 and below 1 px (it would add no pixel), a spacing whose keep radius (half of it) snaps to 0, a polygon whose band folds it, a part over 32768 px | the named field |
| <a id="RIG_CONTOUR_REGIONS_OVERLAP"></a>`RIG_CONTOUR_REGIONS_OVERLAP` | a vertex two regions both reach (`g > 0`); the detail names the vertex and both regions (and, when a `contour.bust` region is one of them, the `contour.bust.clearance` that clears the vertex) | move the regions apart, narrow a band, or raise `contour.bust.clearance` |
| <a id="CONTOUR_RIB_ART"></a>`CONTOUR_RIB_ART` | a rib's point (a link origin or a station) is not on the part's art (its pixel at or below the threshold) or not inside the outline, or a point between its ends falls within 1/256 px of the outline — a rib that leaves the art | move the chain onto the part, or leave the chain out of `ribs` |
| <a id="CONTOUR_RIB_LINK"></a>`CONTOUR_RIB_LINK` | a chain link shorter than the outline's `tolerance` (or of no length), or a joint where the chain turns straight back on itself; the detail names the chain, the link and the tolerance field | fewer, longer links, or a lower `tolerance` |
| <a id="CONTOUR_RIB_CROSSING"></a>`CONTOUR_RIB_CROSSING` | two ribs cross, touch or share an end (both named, with their ends) | fewer `stations`, or a chain that bends less sharply inside a wide part |
| <a id="CONTOUR_RIB_EDGE"></a>`CONTOUR_RIB_EDGE` | a rib's consecutive vertices could not be joined by an edge (no edge across them could be flipped) — a guard: the rule keeps every other point off a rib | report it |

**Ribs along a chain** (`meshes.<part>.ribs`, issue #188). A rib is a row of vertices across
the part at a joint of a chain the mesh is bound to, or at a station along one of its links;
what a rib does to how the part deforms is not claimed. For each chain `ribs` names,
`src/contour.ts` (`placeRibs`) places, in part-image px:

- **where**: on each link k (from `points[k]` to `points[k + 1]`, the last to the tip) a rib at
  its origin and at `points[k] + m/(stations + 1) · (end − origin)`, m = 1..`stations`; the tip
  carries none;
- **across**: along n = (−d_y, d_x)/|d|, d the link's direction — at a joint between two links
  the sum of their unit directions, the bend's bisector;
- **clipped to the art**: the point must be on the part's art (its pixel above the mode's
  threshold) and inside the outline; from it the line runs both ways to the first point where it
  meets the outline the mode traced (art, holes filled, grown by `margin`, simplified at
  `tolerance`), and those two points, on the 1/256 px grid, are the rib's ends. Each end joins
  the hull on the edge it lands on (or is that edge's vertex), moved off the edge by at most
  1/512 px; coverage, overshoot and self-intersection then read the outline with them;
- **between**: the point itself (so the joint is a vertex), and each half from an end to the
  point cut into ⌈half / spacing⌉ equal parts at the mode's background `spacing`
  (`auto.source.spacing` in the automatic mode);
- **kept a row**: no other interior point is kept within half a spacing of a rib, every
  consecutive pair of a rib is made an edge of the triangulation (edges across it are flipped
  until it is one) and locked, as an outline edge is — so `nonDelaunayEdges` does not count it.

Nothing reads a weight: every vertex is weighted as any other at its point. The rib on a strand
painted inside a wider layer runs across the whole opaque run there, sleeve and body included —
cutting the strand out is #170's. In the automatic mode every rib vertex is added to
`protect.vertices` (after the author's, as written) and each rib is sent to rig-c's
`reduceMesh` as a named line (`lines`, rig-c 2.33.0; `maxDeviation` 0), so the reduction keeps
every rib vertex and its post-pass flips no rib edge; the result's measurement carries one
`MQ_LINE_DEVIATION` row per rib.

**The window between coverage and overshoot**, measured in #106 (`tools/contour_survey.ts`, five
generated shapes, margins 0, 1, 1.5, 2, 2.5, 3): the smallest margin that covered every art
pixel was 0 at tolerance 0.5, 1 at tolerance 1 and 1.5, 1.5 at 2, and 3 at 3 (a two-horned
crescent; the other four 1.5 or less). No cell refused overshoot, and along each tolerance, once
a margin passed every larger one passed — where the offset this replaced moved an acute corner
up to 4 × margin and closed the window from above. That is the generated shapes: on a real part
a larger margin can close a gap whose enclosed pocket lies further from the art than the bound,
which the overshoot check refuses (reference-demo's hairpin builds at margin 1 and refuses at 1.5, 2
and 3: 5.39 px). On the public examples at tolerance 1, margin 1, `stray` 4 and spacing = the
part's grid, 13 of the 14 mesh parts build; the 14th is reference-demo's earring, two pieces.

**When not to use it.** A part that is two pieces (reference-demo's earring: 411 and 358 px) — keep
the lattice, which bridges islands, or split the part. And a part nothing deforms locally: at
tolerance 1 the contour outline is dense, and on the examples' 13 parts the contour mesh used
more vertices than the lattice at the same spacing (reference-demo 1785 against 1431, reference-sample 974 against
852) while enclosing 5.8 and 9.8 times less transparent area (reference-demo 25078 against 144782 px², reference-sample
6563 against 64445), with thinner triangles — smallest angles 2.46°–11.31° against the lattice's
12.09°–45° (#106). Switched, every part that builds: reference-sample passes `check` (9 of 9;
`TEXTURE_STRETCH` 1.227 → 1.384, ceiling 1.927); reference-demo's gate is green but `check` refuses
`TEXTURE_STRETCH` on its back hair (2.535: an edge of a contour triangle squeezed to 0.394 of
its length in the idle), and with the back hair left on the lattice it passes 9 of 9 (1.388 →
1.68).

**Why reference-demo's back hair fails, and what passes** (issue #115). The squeezed edge is an
outline edge 2 px long, near the hair's tip, whose two ends sit either side of a step in the
weight field: one end keeps `hairback_l1` at 0.031, the other drops it, because a weight under
0.03 is dropped (`src/weights.ts`, the reference's `>= 0.03`). `hairback_l1` and `hairback_r2`
swing half a period apart, so that 0.03 step moves the two ends 1.2 px against each other — on
a 2 px edge, a ratio of 0.394 to 1.639. Re-deriving every vertex's weights by the same formula
with the drop and the four-bone cut both left out (an off-tree measurement, not a proposal)
gives 1.316 on the contour mesh and 1.336 on the lattice: the lattice's 36 px edges hide the
step, the outline's 2 px edges show it. Interior vertices cannot change it — an outline edge is
in every triangulation — so the background spacing does not move the figure (36, 24, 18 and
12 px all give 2.535). Raising `tolerance` to 1.5 removes every short edge across a step (the
shortest is then 8.2 px) and the part passes (1.345; with every buildable reference-demo part switched,
`check` passes 9 of 9 at 1.68), at 313 vertices against the lattice's 268 and 18155.5 px²
enclosed against 58346. The window is one value wide on this part: 1.25 keeps the same 2 px
edge (2.535) and 1.75 leaves art uncovered at margin 1. No other switched part of either
example comes near it: the largest length change on any edge under 5 px is 1.349 px on the
back hair and 0.784 px at most elsewhere, where a 2 px edge fails once it shortens by
0.962 px (2 − 2 / 1.926544). The mode is for a part with a declared soft region inside a stable surround; on the
generated fixture of `tools/local_compare.ts` it reached a local shape error (0.336 px at most,
63 vertices) the lattice reached only at grid 2, with 1025 vertices (re-run on the grown outline
in #106, the same figures).

**On real parts the generated result did not carry over unchanged** (issues #107 and #110,
`bun tools/real_compare.ts --work <dir> --examples reference-demo,reference-sample --builds --sweep`, a declared test region on two reference-demo
parts — a place to measure, not a claim about the painting; the region spacing chosen by vertex
count alone). On `bottomwear` (a region of radius 65 px inside the part) the contour mesh passes
the same rule: 336 vertices against the lattice's 352, largest local shape error 1.535 px against
7.613. On `hair_front` (radius 11 px, beside the part's own outline) it did not until the outline
was cut inside the region's band: one 35 px outline edge ran from inside the region (`g` = 1) to
past its band (`g` = 0), and every pose's worst pixel sat in a 7.1° triangle on it, 0.74 px from
the outline — 4.481 px against the lattice's 2.453, at 119 vertices against 123, at every
tolerance that builds (1, 1.25, 1.5; 1.75 and up leave art uncovered at margin 1, 0.5 and below
cannot fit 123 vertices). With the outline cut there it passes: 120 vertices, 0.333 px against
2.453, transition 1.335 against 2.543, deformation outside 0.997 against 2.168; the lattice
needs grid 2 (2590 vertices) to match it. Moving a region still opens the seam with the part
drawn beside it — over the idle, translated, by 5.19 px (lattice with the region's weights) and
5.76 px (contour) on `hair_front` against the face, 6.91 and 5.84 px on `bottomwear` against the
shoes, beyond what the same idle opens without the region — and `check`'s seam bar does not see
it (0.326 or 0.327 in every variant: it compares the setup pose). A declared `seam` requirement
does (§7, *Declared requirements*; the region translated, the idle at 12 fps): `hair_front`
against `face` reads 3.022 px on the tracked build and on the lattice variant — the idle's own
sway, at frame 23 — and 6.809 (lattice + region) or 6.888 (contour) at frame 0, at pixel
372,135 or 373,130 inside the region; `bottomwear` against `shoes` reads 6.478 (frame 8) and
11.410 or 10.489 at frame 27, pixel 375,1192. `TEXTURE_STRETCH` does: the
translated region fails it in both modes on `bottomwear` (2.314 lattice, 2.448 contour) and in the
contour mode on `hair_front` (2.183; lattice 1.552), where the face half of `STILL_REGIONS_DARK`
failed in both (its pixel reading, until issue #123; not re-measured since). The ceiling is 1.927. The outline cut moved the stretch little (`hair_front`
contour, per pose, before → after: still 1.152 → 1.149, rotate 1.444 → 1.415, translate 2.186 →
2.183, scale 1.771 → 1.670) and the translated seam from 5.70 to 5.76 px.

### An automatic mesh (`meshes.<part>.auto`, issue #126)

The third mode asks for an economical mesh under declared quality bounds instead of a spacing.
It is opt-in per mesh: `propose` still writes `grid`, a config that names no `auto` builds byte
for byte as before, and the top-level default does not change. The reduction itself is chosen
on geometry alone; the result is then written only when its **motion** is measured against its
unreduced source on the rig's idle and passes the author's bounds (step 4). The steps
(`src/automesh.ts`, `src/automotion.ts`):

1. **The source** — this package's contour mesh over the padded part image at **alpha 1 and
   above** (the threshold rig-c's authored-fit gate uses; the lattice and contour modes stay
   at alpha above 8), at `source.tolerance`, `source.margin` and the background `source.spacing`,
   with no region. It is gated by the contour mode's own checks, and their refusals
   (`CONTOUR_*`, the detail ending "the automatic mode's source, at alpha 1 and above") refuse the
   part. One reading differs from the contour mode's: the source's overshoot is measured with the
   background flooded **8-connected** (rig-c 2.23.0's `measureAuthoredMeshFit` at connectivity 8,
   the fill rig-c's `MQ_OVERSHOOT` and `reduceMesh`'s admission read), so a pocket of background
   joined to the outside only at a corner counts as outside and a source spanning it is refused
   here (`CONTOUR_OVERSHOOT`, "the background flooded 8-connected"), with the number rig-c would
   read, rather than by rig-c's admission after the call. The row's `source.contour` says so
   (`fitConnectivity: 8`); the contour mode keeps its 4-connected reading and writes no such key. Its weights are the contour mode's — segments and region falloff — under the author's
   `influences`, with no 0.03 floor unless the author writes one.
2. **The call** — rig-c's `reduceMesh` (`rig-c/mesh`, 2.28.x) refines inside the declared
   regions, then removes vertices while every declared bound still holds. Every number it is
   handed is one of the fields below; `preset` is null (no preset exists yet: a preset will be a
   named, versioned set of these numbers, expanded into the report), and no deform key or linked
   mesh is passed (this package writes none). The three Stage B opt-ins (below) are handed over
   only when written.
3. **Acceptance** — the result is written only when rig-c's report ends
   `no-further-valid-reduction`, or `budget-exhausted` with `best-meeting-every-bound`, and its
   candidate is `accepted` with every row that has a declared bound at `pass`. Anything else
   refuses the part (below); nothing falls back to the lattice or to the source.
4. **Motion** — the rig stage builds the rig twice through rigc's gate: as written (the
   **candidate**, the reduced mesh, packed as `--out` receives it) and with that one attachment
   swapped for the unreduced source — its UVs, triangles and hull as `reduceMesh` was handed them,
   its own weights bound the same way (the **reference**, `build --profile rig-play` without
   `--pack`: the same gate over the compile, and nothing reads a reference's pages). rig-c's
   `compareMeshesInMotion` (`rig-c/meshcompare`) poses both model documents on the idle
   exactly as `check` renders it — `idle` at 12 fps over its duration, physics reset at 0 and
   stepped by 1/12 s, no warm-up — at the render's frames (`grid`, i/12 s) and a frame interval's 0.381966 past each (`irr`, frames the render never
   draws), and measures how far the reduced mesh carries each art pixel from where the source
   carries it (`MQ_LOCAL_DEFORMATION`, world units = rig px), its triangles' stretch and squash
   from the setup pose, and the triangles it turns over (`MQ_INVERSION`). The part is written
   only when rig-c's verdict is `accepted` (geometry and motion both pass). Nothing chooses the
   full reduction by motion, so every frame of this comparison is held out from selection. A part the idle cannot deform
   is refused before anything is compiled: the idle has to key, with changing values, a bone that
   moves some of the bones the part is weighted to and not all of them (a key on their shared
   ancestor, or on the one bone a single-bone part binds, moves every vertex by one affine map and
   would read 0 over nothing). Constraints are not read for this: a part only a constraint moves
   is refused, never passed — unless its author declares the motion, `stimulus` (issue #196,
   the field table below and *A part only physics moves* after the physics recipe): each
   declared bend is two more frames, every link of the chain turned by +`degrees` and by
   −`degrees`, walked in both builds at time 0 beside the idle's, and its links count as keys
   by the rule above.
5. **The acceptance loop** (rig-c 2.24.0, rigc#1266 mechanism 2; `src/autoreplay.ts`) — only
   when step 4 refuses the full reduction on motion (`AUTO_MESH_MOTION`). rig-c reports every
   accepted **operation** of the call (`acceptedAt`: N entries `{ step, kind, count,
   sourceVertices }` since rig-c 2.25.0 — the attempt number, `insertion`, `removal` or
   `boundary-run`, the vertices it inserted or removed and their source indices; the first I of
   them, up to the last of kind `insertion`, are the refinement's, the rest removals and boundary
   runs) and replays the call to any operation n by `stopAfterAccepted: n`, byte for byte the mesh
   the call held after that operation. A boundary run is one step however many vertices it
   removes, so every count below — N, I, the chosen step, ⌈log₂(N − I)⌉ — is in operations. The stage first compares the source with
   itself on the idle's `grid` frames (a source the gate would refuse leaves the part refused as
   in step 4, and nothing is searched), then **bisects** over the removal steps strictly between
   I and N: each probe replays step n, holds it to step 3's acceptance (the termination rig-c
   promised, `replayed-to-accepted-step` with that step, and every declared geometry row
   passing), builds the rig with that step through rigc's gate without packing, and compares it
   with the source on the `grid` frames only — the irr frames are not walked at all, so they
   cannot inform the choice. It keeps the largest step it saw pass. Validity along the order is
   not monotone (the contract measured it), so the search finds *a* passing prefix, not
   necessarily the last, and at most ⌈log₂(N − I)⌉ replays are taken — derived from the steps,
   not an author number. The one field that changes the search is the opt-in
   `motion.selection` (*The multi-interval selection*, below); without it the search is this
   bisection and the stage writes the bytes it wrote before the field existed. The chosen step is then
   written into the rig, which goes through rigc's gate again exactly as written, and is
   compared with the source on the **whole** idle with the grid frames declared `selection` and
   the irr frames held out; it is written only when that comparison is `accepted` on every
   frame, the held-out ones included. A step at or below I (the source, refined or not) is never
   written as an automatic result: when no removal step passes, the part is refused with "no
   reduction passes the motion bound". A part the gate accepts in step 4 runs no replay. Since
   rig-c 2.24.0 the report carries `acceptedAt`, last in `changes`; since 2.25.0 one entry per
   operation; since 2.26.0 five more geometry rows (below).

**The multi-interval selection** (issue #148; opt-in, `motion.selection: { "policy":
"multi-interval", "maxProbes": <n> }`). The bisection keeps the step it lands on; where validity
is not monotone, a later step with fewer vertices may pass in an interval it never visits (the
synthetic fixture shows one: control `MO52`). With the field, step 5's search becomes:

- **The order.** The bisection first, whole — its own result is always among the tested — then,
  while fewer than `maxProbes` distinct steps have been replayed, the midpoint (rounded down) of
  the longest run of removal steps not yet replayed, the lower run when two are equally long.
  It depends only on the answers, so two runs make the same probes. Each step is replayed at
  most once: the budget counts distinct replays, never a repeat.
- **The budget** is the author's whole number (1 or more; never defaulted, never derived). It
  must hold the bisection: below ⌈log₂(N − I)⌉ the part is refused
  `AUTO_MESH_SELECTION_BUDGET`, naming N, I and the number required, before any replay. There
  is no unbounded walk: at most `maxProbes` replays, each one unpacked gated build and one
  comparison.
- **The choice.** Among the tested steps that passed on the `grid` frames, the fewest vertices —
  each replay's own count, read off its mesh, never inferred from the step number (a boundary run
  removes several vertices in one operation) — and the lower step on a tie. The source (step I,
  refined or not) and the full result (step N) bound the domain and are never candidates. It is
  the **best among tested candidates**: never the last, the minimal or a complete walk, unless
  the row's `termination` says `every-removal-step-tested`.
- **The roles.** Every frame a probe reads is a `grid` frame, declared `selection` in the final
  comparison; the irr frames are read once, by that final comparison on the whole idle, and are
  held out. A chosen step that fails held out is refused as under the bisection, and **no second
  candidate is taken** — nothing reads a held-out result to choose. A probe that read a frame the
  final comparison holds out (or does not declare) is refused `AUTO_MESH_SELECTION_ROLES` and the
  held-out claim withdrawn; the shipped search never does this.
- **Nothing tested passed**: refused `AUTO_MESH_MOTION`, "no reduction passes the motion bound
  among the tested candidates", every probe named; a step never replayed is not claimed to fail.

It cannot skip an operation inside a prefix — every candidate is the call's own mesh after its
n-th accepted operation — and it does not change what the economy of the automatic mode is
measured against; it only looks at more prefixes of the same call.

**The skinning residual as a per-step veto** (issue #126, rig-c 2.31.0; opt-in,
`motion.residual: { "maxResidual": <px> }`). Without the field nothing is sent and the stage is
byte for byte what it was. With it, rig-c's `reduceMesh` receives `targets.skinning` — the
envelope below and the author's bound — and, in rig-c's words, "every removal, boundary run and
post-pass is held to `MQ_SKINNING_RESIDUAL` against the call's own source and refused by name
when over it": a step whose result's residual exceeds the bound is a refusal like any other
(`MQ_SKINNING_RESIDUAL: <value> against <= <bound>`), the working mesh as it was, the search going
on within the budget. Refinement insertions are not vetoed one by one; the refinement's outcome is
held to it whole before any removal. `acceptedAt` records accepted operations only, so a replay
(step 5) under the veto is the same call's mesh after its n-th accepted operation, byte for byte.

- **What the value is.** "The largest over the samples carried by both meshes of
  Σk εk·|Δsk| + Σk |Δw̄k|·(εk·|p − ck| + τk): a bound, under the declared envelope only, on how
  far the candidate draws a UV from where the source draws it — positions only; it certifies no
  orientation, stretch or squash, no motion outside the envelope, and replaces no motion
  comparison" (rig-c's `SKINNING_READING`). Drawing px: the part's own pixels (pageScale 1), the
  same unit as `maxLocalDeformation`. It is **not the motion verdict**: the motion comparison of
  step 4 still runs on every written candidate and still decides, so a residual that passes
  never writes a part the comparison refuses. It is conservative, never understating the posed
  error rig-c measured, and loose on scale and multi-bone chains (rig-c measured 0.26–0.72 of
  the posed error there, 1.000 on a pure rotation).
- **The envelope is derived, never written** (`src/autoenvelope.ts`). The reference is the
  lowest common ancestor of the slot's bone (`segments[0]`'s) and every bone the part's source
  weights bind — the deepest bone on all their ancestries, read off the rig as written (#165).
  When every bound bone hangs below the slot's bone that is the slot's bone itself, and the
  envelope is the one derived before #165, byte for byte. When a bound bone hangs in a sibling
  subtree — a skirt link beside the chest, the hip above it — the reference is the bone they
  share, and the slot's bone is sent as one more bone, with its own range, **only when the
  weights bind it**: rig-c's envelope holds every bone either mesh binds and no other, and
  refuses one neither binds (`SKINNING_BONE_UNKNOWN`). The row's `reference` names the bone
  used and its `rule` says which of the two cases it is. For every bone sent, rig-c's
  `skinningEnvelopeBone({ referenceChain, chain })` composes the chain from the root to the
  reference and from the reference's child down to the bone, each bone's range read off the
  idle this package writes: rotation and scale as the [min, max] of every key value and Bézier
  control value, translation as the length of the largest |x| and |y| offsets, the pivot the
  bone's setup joint in the part's drawing frame, and the setup the rig's (no scale, shear or
  inherit mode is written). An author cannot supply one (`CONFIG_KEY_KNOWN`).
- **Not measurable** — the veto is then **not applied** and the comparison accepts or refuses
  the part alone, as without the field; no number is invented. Each stop is named with its bone
  and code: a bone a constraint drives (an ik's, transform's or path's `bones`, a physics
  constraint's `bone`) is handed to rig-c with that kind as its source and refused by rig-c,
  `SKINNING_RANGE_UNSUPPORTED` in its words — rig-c certifies only ranges declared by keys and
  exposes no range read off a posed walk; a shear key (`ENVELOPE_SHEAR_KEYED`: rig-c's range has
  no shear field); a slider in the rig (`ENVELOPE_SLIDER_UNREAD`: it drives an animation's bones,
  which are not read). `ENVELOPE_BONE_NOT_BELOW_REFERENCE` — a bound bone with no chain to the
  reference, which the helper cannot compose — keeps its name and its check, and is
  **unreachable by construction** since #165: a common ancestor is above every bound bone, and
  in one skeleton (one root) a common ancestor always exists. It would fire only on a bone
  list with two roots, which is not a skeleton; the selftest plants that case so the check is
  seen to fire.
- **The bound is the author's** number, 0 or more, never defaulted. The tracked evidence uses 1,
  the policy's motion bound: the residual bounds the same displacement the motion row measures,
  without posing, so the distance already accepted for the posed reading is its first reading.
- **What it costs.** Every step the rows let through is measured once more, carried rather than
  recomputed (rig-c measured the carried call at 1.4–5.8 times the call without it on recorded
  inputs, under a stand-in envelope); a veto changes the trajectory, so the result is a different
  reduction, not the same steps checked twice.
- rig-c's report does not count the steps the veto refused; `tools/veto_tally.ts` counts them
  over the very call (the survey prints them).

The public examples' evidence is re-run from the tree: `bun run fetch-examples`, then
`bun tools/auto_motion_survey.ts` switches each part item 2 accepted on geometry to `auto`, alone,
under `examplePolicy` (`fixtures/automesh.ts`) plus `policyMotion` (`fixtures/automotion.ts`), runs
the real rig stage with the motion gate and the acceptance loop, and prints two tables — the full
reduction's comparison and the loop's outcome per part (N, the chosen step, the replays, the
candidates they tried, the selection and held-out values) — every row from rig-c's report, the
schedule walked and each refusal's text, the same bytes on every run of one tree (each part's
wall time goes to standard error, not into the table).

| field | means |
| --- | --- |
| `source.tolerance`, `source.margin`, `source.spacing` | the contour mode's parameters for the source, px (margin 0, or 1 or more) |
| `source.stray` | optional: the largest island, in art pixels at alpha 1 and above, that may be left out, as in the contour mode (absent: none is; an island other than the largest above it is still `CONTOUR_ONE_ISLAND`). Unlike the contour mode, the islands left out are cleared from the art **every reader of the mesh takes** (issue #172): the reduction's `art` and its `sourceBounds`, the result's `targets.artFit`, `art_coverage`, and the motion gate's art bounds all read the mask the outline was traced from, so a part whose only extra islands are at or under the figure builds where it refused (`REDUCE_SOURCE_FAILS_ITS_ART_BOUNDS`) before. What was cleared is named: the row's `stray_cleared` — `islands`, `pixels`, and `art_pixels` (the part's art at alpha 1 and above with those islands counted in), present whenever `stray` is declared (zeros when nothing was left out), absent otherwise — and the part's mesh line prints `stray cleared N island(s), P of A art px` when N is above 0. The image is not touched: `rig/images/<part>.png` is the part as assembled, so a cleared pixel the written mesh's triangles reach is still drawn and one outside them is not. That is the one answer every reader of the image gives: `check` reads `parts/<part>.png` as assembled, through the attachment's rest triangles (`CHECK_TIP_OVER_ROOT`, `CHECK_STILL_REGIONS_DARK`, a `seam` requirement's pairs) or composited flat against the render (`CHECK_SEAM_WITHIN_BAR`), and the runtime draws the rig's image through the same triangles; clearing the rig's image alone would make `check` count pixels the runtime no longer draws. On the public examples the declared crumbs carry alpha 24 or less (docs/evidence/production-trial-stray.md) |
| `sourceBounds.{minCoverage, maxOvershoot, maxUndercut}` | what the source must already meet at alpha 1 and above: the share of art pixel centres covered (0..1), the furthest a covered pixel may sit outside the filled silhouette (px, or `null`), the furthest an uncovered art pixel may sit from the covered set (px, or `null`) |
| `targets.artFit.{minCoverage, maxOvershoot, maxUndercut}` | the same three for the result |
| `targets.maxBoundaryDeviation` | the largest Hausdorff distance between the result's outline and the source's, px |
| `targets.minAngle` | optional: the smallest triangle angle, degrees; absent, it is reported and not gated |
| `influences.{maxInfluences, minWeight}` | the cap on bindings per vertex (1 or more) and the floor below which a share is dropped (0 up to 1; 0 drops only shares that are 0 on the weight grid) — for the source's weights and every inserted vertex |
| `budget.maxCandidates` | the most steps rig-c may try (each insertion and each removal attempt counts one); 0 returns the source |
| `minArtSamples` | the fewest art pixels a raster row is taken over, 1 or more |
| `motion` | **required**: `maxLocalDeformation` (rig px, 0 or more — how far the reduced mesh may carry any art pixel from where its source carries it, at any frame); optional `maxStretch` / `minStretch` (ratios; absent, the rows are reported and not gated); optional `deformMayFold` (absent is **false**: a triangle that turns over refuses the part; true declares the slot in `invariants.deformMayFold` and lists every fold instead); optional `gradation` (px per px, 0 or more, or `null`; the author's G for `MQ_ALLOCATION_CONTRAST`, never derived — absent or `null`, the contrast reads `not-measurable` naming it; see *The allocation rows* below); optional `selection` (`{ "policy": "multi-interval", "maxProbes": <whole number, 1 or more> }`; absent, the acceptance loop is the bisection — see *The multi-interval selection* above); optional `residual` (`{ "maxResidual": <px, 0 or more> }`; absent, nothing is sent — see *The skinning residual as a per-step veto* above) |
| `protect` | optional; each field optional: `hull` (true keeps every source outline vertex; absent is **false**, the default agreed for this mode), `vertices` and `edges` (source vertex indices and pairs that must survive), `regionBoundaries` (region names whose outline vertices must survive), `weightJump` (an L1 weight difference above which a source edge is kept; absent is none), `influences` (bones never pruned from a vertex; every region's bone is added) |
| `regions` | optional, each `{name, shape, bone?, band?, maxEdgeLength, transition, grade, minArtSamples}` with `shape` `"circle"` (`cx, cy, r`) or `"polygon"` (`points`): `bone` and `band` are the control bone and its weight falloff exactly as a contour region's (rig px, multiples of 1/256 px), written together (the region weights its bone and asks for density) or not at all (density only, issue #155; one without the other is refused by name); `maxEdgeLength` is L0, the longest an edge meeting the region may be, px; outside it, across `transition` px, the bound relaxes as `L0 + grade·d`; `transition` 0 is a hard edge; `minArtSamples` is the region's own sample floor |
| `boundaryRuns` | optional, `{ maxVertices }`, a whole number 2 or more, no default: each removal pass first tries to replace a run of 2 to `maxVertices` consecutive source-hull vertices with one chord, as one step held to every declared row (below) |
| `retriangulate` | optional, `"delaunay"`: once the reduction ends, the kept vertices are re-triangulated by Delaunay flips, taken whole only when every declared row still passes (below) |
| `removalOrder` | optional, `"deformation-load"`: the single removals are tried in ascending predicted load instead of ascending source index (below) |
| `stimulus` | optional (issue #196), `{ "chain", "degrees" }` or a non-empty list of them: a bend the motion gate measures the part against, for a part no idle key deforms (*A part only physics moves*, after the physics recipe). `chain` is a chain this mesh's `segments` name, each named once; `degrees` a number above 0. Each link of the chain is turned by +`degrees` and by −`degrees` about its joint — a `rotate` key on the link, so the chain curls — in two animations of duration 0 (`stimulus <chain> +<degrees>`, `stimulus <chain> -<degrees>`) that only the comparison's builds carry: the reference and a candidate built from the written rig with them added (`build --profile rig-play` without `--pack`, one more gated build per part); `rig/motion.json` never holds them. Each is walked at time 0, right after the physics reset, so the pose is the declared bend and no constraint has moved it; the idle is walked as before, so where idle keys also move the part both are measured, against the one `motion` bound. The acceptance loop's probes walk them too, as `selection` beside the grid frames. The row echoes `stimulus` (chain, degrees, links, the two animation names); absent, nothing is added and every byte is the same. A chain the segments do not name is `CONFIG_NAME_RESOLVES`, `degrees` that is not a number above 0 `CONFIG_FIELD_TYPE`, both at the field; an animation of `motion.animations_from` already called by one of the two names is `AUTO_MESH_MOTION_INPUT`. The amplitude (*The allocation rows*) is still derived from the idle alone |

**A bound declared absent.** `maxOvershoot` and `maxUndercut`, in `sourceBounds` and in
`targets.artFit`, each take a number of px 0 or more or `null`. `null` means *measured and
reported, not bounded*: rig-c (2.21.0 and later) still measures the row, reports it `undeclared`
with its value and no bound, and never refuses the part or stops a reduction step on it. Leaving
the field out is not the same thing and is still refused by name (`CONFIG_FIELD_PRESENT`), as
rig-c refuses it: an omission cannot be told from a forgotten field. `minCoverage` has no such
form. Write `null` where the policy deliberately accepts loss the distance cannot express — for
instance a coverage floor below 1, where every uncovered pixel is at least 1 px from the covered
set, so an undercut of 0 cannot hold beside it — rather than a large number, which would read as a
measured limit. The row in `mesh_report.json` echoes the `null` in `settings`, carries the
residual as rig-c reports it (`state: "undeclared"`, the value, `bound: null`), and
`worst_residual` never picks it; the `build` line prints it after the worst residual as
`overshoot <value> (not bounded)` / `undercut <value> (not bounded)`. The motion gate holds the
reference and the candidate to the same bounds, `null` included.

**Stage B opt-ins** (rigc#1271, rig-c 2.25.0–2.28.0). Three fields, each the author's and each
absent by default: left out, it is not sent and the call — mesh and report — is the one it was
before the field existed. What each promises and does not is rig-c's (its docs/MESH_REDUCTION.md
§8, the three *Stage B* subsections):

- `boundaryRuns: { maxVertices }` — the boundary half of the reduction. A traced source hull is
  simplified at about the same 1 px the deviation bound is measured at, so a single removal
  almost always leaves a sagitta over it; one chord for a run of vertices can meet it. A run is
  2 to `maxVertices` surviving source-hull vertices, removed as **one** operation held to every
  declared row exactly as a single removal is, before that pass's single removals; it is one
  `acceptedAt` entry (`kind: "boundary-run"`, `count` ≥ 2), so the acceptance loop replays to it
  like any step. Each run tried costs a candidate against `budget.maxCandidates`.
- `retriangulate: "delaunay"` — the interior half. After the reduction ends (a replay's
  included) the kept vertices are re-triangulated by Lawson flips toward Delaunay: no vertex
  added, moved or removed, so UVs and weights are the removals'; no outline edge, protected edge
  or edge a region holds is flipped. The pass is taken whole only when every declared row still
  passes, and otherwise the mesh is returned as the removals left it with the row that refused
  it named. It is not a step: `acceptedAt` and the replay are the call's without it, and a replay
  to step k is byte for byte the budget cut at that step followed by the same pass (`MO43`
  holds it on this package's inputs). rig-c does not promise that passing motion is monotone
  along the steps under it; the acceptance loop finds a passing prefix, not necessarily the last,
  as it always did.
- `removalOrder: "deformation-load"` — each pass tries its single removals in ascending
  L · Δshare (the longest edge the removal's hole adds, times half the L1 weight difference
  across it), ties by source index; boundary runs keep their own order. It reads weights only:
  on an unweighted source it is the default order.

A malformed value — `maxVertices` 1 or 2.5, `null`, another spelling — is refused by the loader by
name (`CONFIG_FIELD_TYPE`, `CONFIG_FIELD_PRESENT`, `CONFIG_KEY_KNOWN`). The row echoes each field
set in `settings` (after `preset`) and, in `result`, `boundary_runs` (the runs taken and the
vertices they removed) and `retriangulation` (`taken`, `flips`, `sweeps`, `refusedBy`); the
`build` line adds `; boundary runs <= k: r run(s), v vertex(es)`, `; retriangulate delaunay taken,
n flip(s)` (or `refused by <row>`) and `; removal order deformation-load`. A part that sets none
writes none of these. `bun tools/auto_motion_survey.ts --config
baseline,boundaryRuns,retriangulate,removalOrder,all` runs the eight public parts under each
(`docs/evidence/auto-stageb-survey.md`).

**The allocation rows** (rig-c 2.26.0, rigc#1280). rig-c reports five more geometry rows on every
reduction: `MQ_GRADE` (the sharpest change of local edge size across an edge), `MQ_MIN_ANGLE_P10`
(the tenth percentile of the triangles' smallest angles), `MQ_ALLOCATION_CONTRAST` (Δ, density no
declared need explains, with economy E), `MQ_DEFORM_LOAD` (the largest L · Δshare · θ / 4 — a
location reading, not predicted motion) and `MQ_BOUNDARY_NECESSARY` (B\*, the fewest source-hull
vertices an outline can keep with every static row held). Every one is `undeclared`: no field
declares a bound on any of them (a `targets.maxGrade` or the like is refused,
`CONFIG_KEY_KNOWN`), none is ever required or the `worst_residual`, and each lands in the row's
`residuals` as rig-c reports it. Δ and the load read a **motion amplitude** — per idle track,
θ = ‖M − I‖ for each pair of bound bones the track turns or scales against each other, an ε in
px, and an attachment-wide gradation G (rig-c 2.29.0). The tracks are not an author field: the
rig stage derives them from the idle it writes (`src/autoamplitude.ts` — θ from each track's
keys, 2 sin(α/2) for a rotation, |s − 1| for a scale, 0 for a translation; ε the part's
`motion.maxLocalDeformation`). **G is the author's**, `motion.gradation`, because nothing a rig
declares fixes it (rig-c measured every candidate derivation, rigc#1291). In rig-c's own words,
G (px per px, 0 or more) "is how fast the mesh may coarsen away from something that needs
density — an edge of the B\* outline, a triangle whose weights turn under the declared motion.
At d px from a need of size h the reading allows edges up to h + G · d, exactly the form of a
region's `grade` … if the author would grade a region at some rate on this mesh, that rate is the
G to declare." A larger G lets a need relax sooner, so more dense vertices read as removable and Δ
and E rise; at 0 nothing reads as removable. rig-c's fixtures used 0.75, "a value those fixtures
chose, not a default rigc holds", and this package holds none either.

The amplitude is sent to `reduceMesh` and to the motion gate's comparison whenever its tracks are
derived, with `gradation` as written or `null` when the config leaves it out. Then:

- `MQ_DEFORM_LOAD` is **measured** — the largest L · Δshare · θ / 4, px, a location reading and
  not predicted motion; it never reads G. It is `undeclared` (no bound, never the
  `worst_residual`), and the build line prints it after the unbounded art rows:
  `; deform load <value> px (undeclared)`.
- `MQ_ALLOCATION_CONTRAST` (Δ, with economy E in its `allocation.contrast`) is `not-measurable`
  naming `motionAmplitude.gradation` unless the author set one; with one it is measured,
  `undeclared`, and printed as `; allocation contrast <value> (undeclared)`.
- On the comparison, each build's setup section measures the load; Δ there stays
  `not-measurable` (naming the gradation when it is null, and otherwise
  `targets.maxBoundaryDeviation`, which a comparison does not declare).
- The row's `settings.motionAmplitude` is rig-c's echo of what it read, and `motion_amplitude`
  says `{ "sent": true, "stops": [] }`.

No mesh, step, verdict or acceptance reads either row, so writing a gradation changes the report
and nothing the rig writes. A shear track, a constraint, a motion bound of 0, or a pair moved by
two bones of one group still stop the tracks by name (`"sent": false`, each term in `stops`), and
then nothing is sent and both rows read `not-measurable`.

A circle is handed to rig-c as the regular polygon with the fewest sides, 3 or more,
circumscribed about the circle, whose outline lies within 1/256 px of it (the grid the region's
numbers are on); the rule and its error are echoed in the region's `approximation`. The weights
still read the circle.

A region takes one of two forms, told apart by `bone` (issue #155):

- **Weight and density** — `bone` and `band` written. Inside the shape the bone takes weight 1,
  falling off across `band` as in the contour mode, and rig-c refines the mesh there to the
  region's density. Use it where a control bone should move that patch of the part on its own
  (a pinch, a fold) and the mesh needs the vertices to carry it.
- **Density only** — neither written. rig-c refines the mesh there to the same density, and the
  weights are untouched: no vertex takes a share from the region, the row's bone list and
  `protect.influences` gain nothing, and every source vertex is weighted exactly as with the
  region left out. A vertex rig-c inserts there carries rig-c's interpolation of the source
  triangle that holds it (its contract §6), the rule every inserted vertex follows in either
  form. Use it to place density by itself — where the art's shading, a joint or a field says
  the mesh needs vertices — so that a change in the vertex count or the motion verdict against
  the same part without the region is a change in density alone. The row writes its `bone` and
  `band` as `null`, and its counts of vertices reached and bound as 0.

`bone` without `band`, or `band` without `bone`, is neither form and is refused by name. Two
regions that both weight a bone and both reach one source vertex is `RIG_CONTOUR_REGIONS_OVERLAP`,
as in the contour mode. A density-only region decides no weight, so it may overlap any region:
rig-c holds each region's density rows on its own, the smallest bound applying to an edge two of
them hold.

**What it reports.** `mesh_report.json`'s row carries `mode: "auto"`, `settings` (every number
the call saw, the threshold and the circle approximations included), `source` (the contour
mesh's report and rig-c's counts of it), `stray_cleared` — only when `source.stray` is
declared: the islands and pixels cleared from every reader's art, and the art pixels they were
part of — `result` (boundary and interior vertices,
triangles, bindings, vertices removed and inserted), every `residuals` row with its state, value
and bound, `worst_residual` (the declared row nearest its bound, as the share of the bound used)
and `worst_region`, the `termination` with its reason and `candidatesTried`, what the weights
lost to the grid (`sharesDroppedOnGrid`, `sharesPruned`, `droppedAtFivePlaces`), per region the
source vertices its bone reaches and the result vertices bound to it, `motion_amplitude` (whether
the allocation rows' amplitude was sent, and every term that stopped it; what was sent is rig-c's
echo in `settings.motionAmplitude`), `skinning_residual` — only under `motion.residual`: `rule`
(what the residual is and that it is not the motion verdict), `max_residual`, `sent` (whether the
veto was applied), `reference`, `envelope` (each bone's `linear`, `pivot` and `translation` as
sent, or null), `stops` (each bone and code that left it not measurable), and `measured` (the
written mesh's own `MQ_SKINNING_RESIDUAL`: state, value, bound, the worst sample's UV and pixel
with the value's covariance and lever sums there, the samples carried); the row is also among
`residuals`, declared with its bound — `replay` — only on a part
the acceptance loop wrote at a replayed step (step 5): `rule` (the search in words, "a passing
prefix, not necessarily the last"), `accepted_steps` (N, in operations), `refinement_steps` (I), `chosen_step`,
`replays` and `max_replays`, `candidates_tried` across the replays, `full` (the full result's
reading that the gate refused), every probe (step, pass/fail, value and frame on the grid frames),
and `selection` and `held_out` (the chosen step's value and worst frame per role). Under
`motion.selection` the `replay` object is the multi-interval search's instead: `rule` ("the best
among tested candidates"), `policy`, `max_probes`, `accepted_steps`, `refinement_steps`,
`chosen_step`, `bisection_step` (the bisection's own result inside the search), `replays`,
`candidates_tried`, `termination` (`every-removal-step-tested` or `budget-exhausted`), `tested`
(the replayed steps, ascending), `passing_intervals` (runs of tested passing steps with no tested
failure between), `untested_intervals` (runs of removal steps never replayed), `chosen`
(`vertices`, `boundary`, `interior`, `triangles`, `bindings` of the written mesh), `full`, every
probe with its `vertices`, `roles` (`selection: "grid"`, `held_out: "irr"`, and the distinct
frames the probes read), then `selection` and `held_out`. The row's other
fields are then that step's, its `termination` `replayed-to-accepted-step` — `deformation` — the motion
gate's verdict, the bounds echoed (`deformMayFold` included), each motion row (`MQ_INVERSION`,
`MQ_LOCAL_DEFORMATION` and one per region, `MQ_SQUASH`, `MQ_STRETCH`) with its state, value, bound,
worst frame and sample counts, and the schedule walked (frames per phase, held out, selection) —
`quality_report`, the whole `mesh-quality-report/1` document of the reduction, and
`motion_report`, the whole `compare` document of the motion gate, inside the row so one file holds
every part's evidence. `art_coverage` is over alpha above 8, comparable with the
other modes; the alpha-1 coverage is a residual. `build` prints one line per auto mesh: source →
result counts (hull + interior), bindings, the termination, the worst residual, each art bound
declared `null` with its value and `(not bounded)`, under `motion.residual`
`; residual <value> <= <bound> (a pose-free bound, not the motion verdict)` or
`; residual not measurable: <bone> <code>, … (veto not applied; the motion comparison decides)`, and
`motion <value> <= <bound> at <frame>` (the frame id is `idle@<phase>@<time>`), and the reference
build's gate lines after the candidate's. A part written at a replayed step adds
`; replayed to accepted step <n> of <N> after <k> replay(s); selection <value> <= <bound> at
<frame>; held out <value> <= <bound> at <frame>`, and the stage prints one `replay "<part>"` line
with every probe, then the gate of the rig as written and its references. Under
`motion.selection` that line reads `replay "<part>": multi-interval selection over the removal
steps …, <k> replay(s) of at most <maxProbes> (maxProbes), ended <termination>: <step> <verdict>
<value> v=<vertices>, …; the bisection kept step <b>; the fewest vertices among the tested
passing steps: step <n>, <v> vertices (best among tested candidates)`. Weights are written by `roundShares` on every vertex (5 places, zeros
dropped, the heaviest entry closes): the 0.03 floor that makes the lattice's last-entry close
safe is the author's to choose here.

**Refusals** — every one names the part and the rule; nothing falls back. The config's own
rules hold here as everywhere — a missing or out-of-range number, a Stage B opt-in that is not
exactly a value rig-c accepts, a field the mode does not have (`CONFIG_FIELD_PRESENT`,
`CONFIG_FIELD_TYPE`, `CONFIG_KEY_KNOWN`), an unknown bone or region name
(`CONFIG_NAME_RESOLVES`) — and their rows are §6's, *The config*:

| rule | means |
| --- | --- |
| <a id="CONFIG_MESH_MODE"></a>`CONFIG_MESH_MODE` | two of `grid`, `contour`, `auto` and `influence`, or no mode at all |
| <a id="CONFIG_REGION_NAME_UNIQUE"></a>`CONFIG_REGION_NAME_UNIQUE` | a region named twice in one mesh's `regions` (or `bust_r` / `bust_l` declared in `contour.regions` alongside `contour.bust`) — every one named in one run |
| <a id="CONFIG_REGION_BAND_NEEDS_BONE"></a><a id="CONFIG_REGION_BONE_NEEDS_BAND"></a>`CONFIG_REGION_BAND_NEEDS_BONE`, `CONFIG_REGION_BONE_NEEDS_BAND` | a region with a `band` and no `bone`, or a `bone` and no `band`: write both for a region that weights its bone, neither for a density-only region (issue #155) |
| `CONTOUR_*` | the source is refused by the contour mode's own checks at alpha 1 and above — most often `CONTOUR_ONE_ISLAND`: faint pixels the alpha-above-8 modes never saw are islands here |
| <a id="AUTO_MESH_INPUT"></a>`AUTO_MESH_INPUT` | rig-c refused the call's input by throwing (a protected vertex the source does not have), in its words and code |
| <a id="AUTO_MESH_TERMINATION"></a>`AUTO_MESH_TERMINATION` | rig-c returned no mesh: `invalid-input` (the source fails its own `sourceBounds`, a region it refuses, protected influences over the cap), `unsupported-topology`, or `budget-exhausted` with `none-met-the-targets`; or, in the acceptance loop, a replay that does not end as rig-c's contract promises (`replayed-to-accepted-step` at the step asked, `candidatesTried` the full run's `acceptedAt[n − 1].step`, its `acceptedAt` the full run's first n operations, each the same `step`, `kind`, `count` and `sourceVertices`) |
| <a id="AUTO_MESH_ACCEPTED"></a>`AUTO_MESH_ACCEPTED` | rig-c returned a mesh that is not accepted; the detail names every declared row not passing and the constraint that stopped it |
| <a id="AUTO_MESH_NO_STIMULUS"></a>`AUTO_MESH_NO_STIMULUS` | neither the idle nor a declared `stimulus` moves some of the part's bound bones against the others, so no frame deforms it — the detail names the bones with no motion against each other and the field to declare; missing stimulus is not a pass; declare `meshes.<part>.auto.stimulus`, put the part in `contour` or `grid` mode, or key a bone it binds |
| <a id="AUTO_MESH_MOTION"></a>`AUTO_MESH_MOTION` | the reduced mesh against its source on the idle is not accepted and the acceptance loop wrote no step in its place: "no reduction passes the motion bound" (the full result's failing rows and every probe named; under `motion.selection`, "… among the tested candidates", with `maxProbes` and the termination), or the chosen step passes on the grid frames and not on the whole idle (its selection and held-out values and worst frames named); when the source itself is not accepted against itself, one sentence first (issue #280): "the unreduced source itself fails <where> (<row> <value> against <bound>), so no replayed step can pass — change the source (its spacing or its outline) or lower the stimulus", `<where>` a declared stimulus by its animation's name (`at stimulus hem +150`), `at idle frame <id>`, or `in its geometry` for a geometry row, the stimulus remedy only when it was read at one; then the full result's rows, for the record. No search runs, and the stage's `replay "<part>"` line names the same place |
| <a id="AUTO_MESH_SELECTION_BUDGET"></a>`AUTO_MESH_SELECTION_BUDGET` | `motion.selection.maxProbes` is below ⌈log₂(N − I)⌉, the bisection the multi-interval search runs whole first; N, I and the number required named; nothing replayed |
| <a id="AUTO_MESH_SELECTION_ROLES"></a>`AUTO_MESH_SELECTION_ROLES` | a multi-interval choice whose probes read a frame the final comparison holds out, or one it does not declare `selection`; the frames named, the held-out claim withdrawn |
| <a id="AUTO_MESH_MOTION_INPUT"></a>`AUTO_MESH_MOTION_INPUT` | the comparison could not be made: rig-c refused its input (its code carried — `COMPARE_REFERENCE_FAILS` when the source fails its own `sourceBounds`, `COMPARE_INPUTS_DIFFER`, …), the reference build is red at rigc's gate, or a gate build wrote no `skeleton.model.json`; in the acceptance loop, a replayed step's build that rigc's gate refuses |

**What rig-c cannot refine.** Refinement inserts only inside a region and its band (the
contract's P16). rig-c 2.19.0 stopped by name when an edge's far end lay further beyond the
band than the edge's bound; 2.19.1 and later implement the decision on issue #126 that an edge leaving the
band at a point is not held to it, so a coarse source refines. With `transition` 0 the authored
boundary stays held, and an edge from the region to a vertex further out than its bound — or one
that crosses the region with no point of it inside to split at — is still stopped by name
(`AUTO_MESH_ACCEPTED`, the detail naming P16).

### Recipe: expressions and other named animations

The package proposes no expression and keys nothing but the idle; what it gives is a rig whose
face is bones (`eye_r`, `eye_l`, `brow_r`, `brow_l`, `mouth` on `reference-sample`) and one door for
animations you write over them, `motion.animations_from` (the row above, issues #183 and #569).
Name a file in rig-c's motion-spec shape, its path relative to the directory `config.json` sits
in — not the working directory:

```jsonc
// config.json
"motion": { "duration": 4.0, "tracks": [ … ], "blink": { … },
            "animations_from": "animations.json" }
```

A whole file, one looping animation over two bones the config declares — an expression is the
same shape over the face bones, and `examples/demo/animations.json` holds seven more:

```json
{ "spec": "rigc-motion/1",
  "animations": {
    "sway": { "duration": 2, "loop": true, "tracks": [
      { "bone": "chest", "property": "rotate", "keys": [
        { "t": 0, "v": [0] }, { "t": 0.5, "v": [3] }, { "t": 1.5, "v": [-3] }, { "t": 2, "v": [0] } ] },
      { "bone": "head", "property": "rotate", "keys": [
        { "t": 0, "v": [0] }, { "t": 1, "v": [-2] }, { "t": 2, "v": [0] } ] } ] } } }
```

- **`spec` is required.** Without it the loader refuses
  `CONFIG_FIELD_PRESENT: config.motion.animations_from (<file>).spec — is absent and required:
  write "spec": "rigc-motion/1" beside "animations", …`, and another value is `CONFIG_FIELD_TYPE`
  naming the value found and `"rigc-motion/1"`.
- **Key times strictly increase within a track, and the last is at `duration`** — rig-c's rule
  (its AUTHORING §4.5, "`t` is in seconds and must strictly increase"; R7: no key past the
  declared duration, and a duration more than a frame longer than the last key is refused).
  `loop` is a player hint rigc does not emit (its §4.3).
- **The cycle-boundary trap.** A looping animation's boundary is one key, at `t = duration`; to
  close the loop without a jump give it the value of the key at `t = 0`, as both tracks above do.
  Writing that boundary key twice (`t: 2` and `t: 2` here) is a duplicate time, and it is rigc's
  verdict at the rig stage's gate, not this loader's: `RIG_RIGC_GREEN` quotes rigc's
  `CE_COMPILE_KEY_TIMES_NOT_INCREASING` line, `animation "<name>" bone "<bone>" <property>: key
  times must strictly increase (at t=<t>)`. That line names the animation, the track and the time,
  and the file it came from is the one the rig stage's line just above it names
  (`animations beside the idle, from <file> as written: …`) — rigc reads the merged `motion.json`
  in a scratch directory, so its own path is not yours. Remove the second key.
- **The path resolves beside the config.** A file that is not there is `CONFIG_FILE_PRESENT:
  config.motion.animations_from — names "<as typed>", resolved against the config's directory
  <dir> (not the working directory) to <file>, which is no such file; …`: move the file there, or
  write the path from that directory.

**Which way a key moves a bone.** A `rotate` value is degrees added to the bone's setup
rotation, counter-clockwise positive in the rig's y-up space — rig-c's convention (its
AUTHORING §3.2, `rotation`: "degrees, counter-clockwise, y up"; its `src/transform.ts`, "World
rotation in degrees, CCW, y up") — and the rendered image shows the same turn, so on the
painting a positive key swings a hanging arm toward the image's right and up, a negative one
toward the image's left and up. `translatex` and `translatey` are in the bone's parent's axes,
y up, so the positive `translatey` on `brow_r` above raises the brow. Measured on `demo` (one
key at time 0, rendered by rigc on its 330x512 grid): `sleeve_l0`, the sleeve on the image's
right, at +30 moved its hand bone `sleeve_l2` 43.9 px right and 27.6 px up, at −30 51.8 px left
(toward the body) and 2.0 px down; `sleeve_r0`, on the image's left, at +30 moved `sleeve_r2`
51.9 px right, toward the body — so `demo`'s `wave` raises the image's right arm with
`sleeve_l0` at +48 (selftest `RG99` holds the sign on the rig fixture).

`demo`'s `wave` in full, as [`examples/demo/animations.json`](https://github.com/rig-c/parts/blob/main/examples/demo/animations.json)
holds it (`curve` is rig-c's escape from a named easing, its AUTHORING R6): the arm out to the
side and held, a bend further down the arm, the hand rocked ±10°, back down.

```jsonc
"wave": {
  "duration": 2.21,
  "loop": false,
  "tracks": [
    {
      "bone": "sleeve_l0",
      "property": "rotate",
      "keys": [
        {"t": 0, "v": [0], "curve": [0.0875, 0, 0.2625, 48]},
        {"t": 0.35, "v": [48], "curve": [0.69, 48, 1.37, 48]},
        {"t": 1.71, "v": [48], "curve": [1.835, 48, 2.085, 0]},
        {"t": 2.21, "v": [0]}
      ]
    },
    {
      "bone": "sleeve_l1",
      "property": "rotate",
      "keys": [
        {"t": 0, "v": [0], "curve": [0.0875, 0, 0.2625, 20]},
        {"t": 0.35, "v": [20], "curve": [0.69, 20, 1.37, 20]},
        {"t": 1.71, "v": [20], "curve": [1.835, 20, 2.085, 0]},
        {"t": 2.21, "v": [0]}
      ]
    },
    {
      "bone": "sleeve_l2",
      "property": "rotate",
      "keys": [
        {"t": 0, "v": [0], "curve": [0.0875, 0, 0.2625, 0]},
        {"t": 0.35, "v": [0], "curve": [0.3925, 0, 0.4775, 10]},
        {"t": 0.52, "v": [10], "curve": [0.605, 10, 0.775, -10]},
        {"t": 0.86, "v": [-10], "curve": [0.945, -10, 1.115, 10]},
        {"t": 1.2, "v": [10], "curve": [1.285, 10, 1.455, 0]},
        {"t": 1.54, "v": [0], "curve": [1.7075, 0, 2.0425, 0]},
        {"t": 2.21, "v": [0]}
      ]
    }
  ]
}
```

**Which link bends where.** A sleeve chain the proposer drafts without `--keypoints` (the
two-blob rule, `src/propose.ts`) divides the `handwear` part's height in three, not the arm
at its joints: its links stand at 0, 1/3 and 2/3 of the way from 15 px below the part's top
row to 6 px above its bottom row, and its tip 3 px above the bottom row. On `demo`, `sleeve_l`'s
links stand at y 260, 381 and 502, tip 626 (rig px), and on `scarf` at 277, 413 and 550, tip
689; on both paintings the elbow lies between links 1 and 2 and the wrist between link 2 and
the tip [observed: the chain drawn over the painting and read by eye, issue #345]. So
`sleeve_l1` turns the arm part way down the upper arm, and `sleeve_l2` part way down the
forearm, hand included: `wave`'s +20 on `sleeve_l1` is that bend, not an elbow's. Place the
links on the joints (`bones`, the chain's `points`) before keying a bend that must read as
an elbow. Under `--keypoints` the chain is `<s>_shoulder` → `<s>_elbow`, tip at `<s>_wrist`
(§3, *A posed figure*): two links, the second the forearm from the elbow, and no `sleeve_l2`,
so a clip keying `sleeve_l2` names a bone that rig lacks. `propose --keypoints` on `demo`'s
parts, fed its generation control pose doubled to painting px (what was asked of the model,
not where the joints ended — read for the chain's shape only), wrote `sleeve_l`
`[[492, 272], [550, 440]]`, tip `[626, 590]`, amplitudes `[-0.2, -0.6]`.

`build` writes `surprised` into `rig/motion.json` after `idle`, gates it with the rig, and
`check` names it on a line of its own and reads it for folds (`ANIMATIONS_DO_NOT_FOLD`, §7,
issue #320). [`examples/reference-sample`](https://github.com/rig-c/parts/tree/main/examples/reference-sample), in the repository, carries one such file,
`animations.json` with `hop` (the recipe below); on it `build` printed (this tree, rig-c as
`package.json` pins it):

```
[rig]   animations beside the idle, from …/animations.json as written: hop
[check]   beside the idle: 1 animation(s), hop — built and gated by rigc with the rig; ANIMATIONS_DO_NOT_FOLD reads each for folds, every other bar here reads the idle
[check]   ANIMATIONS_DO_NOT_FOLD: PASS — 2 animation(s) read by rigc render --folds at 12 fps, with its 2 physics constraint(s) on and off (idle, hop): 0 folding mesh(es), 0 not declared in may_fold (<= 0)
[check]   STRESS_OFF_CHAIN: SKIP — "sleeves": its weights ride 2 chains ("sleeve_r0_ctl", "sleeve_l0_ctl"): turning one stretches the part toward the other by construction; a part riding one chain is read until a limbs block names each limb
[check] check: PASS; 10 of 11 bar(s) measured, 1 skipped (STRESS_OFF_CHAIN); 1 warning(s) (CLOTH_SETTLES, not a bar)
```

A bone the rig lacks is rigc's refusal at the rig stage, in rigc's words (`RIG_RIGC_GREEN`); a
fault in the file itself is the loader's (the row above names each one).

**Worked sets.** [`examples/demo/animations.json`](https://github.com/rig-c/parts/blob/main/examples/demo/animations.json) and [`examples/scarf/animations.json`](https://github.com/rig-c/parts/blob/main/examples/scarf/animations.json)
(issue #224; in the repository, not the package) carry `tilt`, `look_l`, `look_r`, `smile`, `startled`, a gesture (`wave` on
`demo`, `bow` on `scarf`) and `hop`, each a one-shot that keys only what it needs; the
examples' READMEs ([demo](https://github.com/rig-c/parts/blob/main/examples/demo/README.md), [scarf](https://github.com/rig-c/parts/blob/main/examples/scarf/README.md)) list what each keys and why. Two rules make a clip layer over the idle on
a player's second track rather than replace it:

- **Key the bones the idle leaves alone.** The idle turns and breathes the `*_ctl` bones
  the rig stage writes (`head_ctl`, `chest_ctl`, a chain's `<chain><i>_ctl`) and `neck`; the
  bone under each (`head`, `chest`, `<chain><i>`) is free. A `look_l` that keys `head` alone
  leaves the idle's sway alive under it; one that keys `head_ctl` or `neck` stops it for as
  long as the clip holds the key.
- **Key no constraint, draw order, deform or attachment.** A player mixing tracks refuses
  those; bones are all a clip needs.

**Strands that trail.** A chain whose links lag the body is one `physics` constraint per
link in `constraints`, on the link bone (`hairback_r0`, not `hairback_r0_ctl`), driving
`rotate`; the examples soften it down the chain: every link takes the root link's `inertia`,
`damping`, `mass` and `mix`, and link i of n (i = 0 at the root) takes the root link's `strength` times
1 − 0.35 · i / (n − 1), so the last link is the softest at 0.65 of the root's. `demo`'s right
twin tail, the three links of chain `hairback_r`, as
[`examples/demo/config.json`](https://github.com/rig-c/parts/blob/main/examples/demo/config.json) (in the repository)
holds it:

```json
"constraints": [
  { "type": "physics", "name": "hairback_r0_phys", "bone": "hairback_r0", "rotate": 1, "inertia": 0.8, "strength": 90.0, "damping": 0.85, "mass": 1, "mix": 1 },
  { "type": "physics", "name": "hairback_r1_phys", "bone": "hairback_r1", "rotate": 1, "inertia": 0.8, "strength": 74.25, "damping": 0.85, "mass": 1, "mix": 1 },
  { "type": "physics", "name": "hairback_r2_phys", "bone": "hairback_r2", "rotate": 1, "inertia": 0.8, "strength": 58.5, "damping": 0.85, "mass": 1, "mix": 1 },
  … ]
```

`scarf`'s scarf ends, four links each, take the same shape at inertia 0.7: `strength` 70,
61.8333, 53.6667 and 45.5 down `robe_r` ([`examples/scarf/config.json`](https://github.com/rig-c/parts/blob/main/examples/scarf/config.json)).
What these values do, measured on the clips and not by any bar: in `demo`'s `hop` the last
link of each tail sat 46.6 and 45.3 rig px from where the keys put it relative to `head` at
the landing (0.73 s); inertia 1 tore `hair_back` in that hop (`TEXTURE_STRETCH` 3.258 against
1.926544), and lowering `strength` instead of raising inertia saturates (the demo README,
*The strands*). A single bone with no `length` (a bow, an earring, a bun) cannot take a
`rotate` drive (rig-c's `A23`) and takes `x`/`y` instead — `demo`'s bows `"x": 0.5, "y": 1`,
inertia 0.3, strength 160. The values that read on the examples, and the ones refused on the
way there, are in their READMEs, in the repository:
[`examples/demo/README.md`](https://github.com/rig-c/parts/blob/main/examples/demo/README.md) and
[`examples/scarf/README.md`](https://github.com/rig-c/parts/blob/main/examples/scarf/README.md).

**Under the idle alone** a strand trails by what its constraint's values make of a slow
swing, and the soft-region recipe's *Limits* (below) is the same finding for a jiggle: a slow
idle barely moves a stiff spring, and faster keys — a hop, a turn, in a named animation — are
what it answers. Measured on `demo` (issue #345, rig-c 2.47.1: the idle rendered at 30 fps
with `--geometry`, the build against the same build with `constraints` removed, each link's
world angle compared frame by frame): the twin tails' last links (`hairback_r2` and
`hairback_l2`, inertia 0.8, strength 58.5, the values above) trail their keyed angle by at
most 2.753° and 1.720° — `hairback_r2`'s tip 9.96 rig px, where the idle swings that link's
world angle through 9.276°, and 2.612° in the idle's second half, so not the physics reset's
transient; the bangs' last links (inertia 0.2, strength 130) by at most 0.127°, the skirt's
0.073°, the sleeves' 0.054°. A strand that reads stiff under the idle is not broken: key it
in a clip, or soften it as the tails are softened.

**Limits.** Every slot holds one attachment, the part's own image, so an expression moves,
turns and scales the face's parts and never swaps one for another: there is no second mouth
or eye shape to key, and no lip-sync. `check` reads an animation beside the idle for folds
alone (`ANIMATIONS_DO_NOT_FOLD`, §7, which reads the idle too): beyond rigc's gate, no seam,
stretch or hole bar has read it. On the
examples each clip was read by `check`'s own `TEXTURE_STRETCH` reading applied to the clip's
`rigc render --geometry` (their READMEs give the figures); that is a measurement, not a
gate, and it is where an arm raised overhead was found to tear `demo`'s elbow (5.327
against 1.926544).

**A raised arm moves its `handwear` part only.** The proposer meshes each `handwear` part on
its sleeve chain and the `topwear` part on `chest` and `hip` alone (§3, *the trunk parts'
segments* and the sleeve rule), so arm art See-through left inside `topwear` — a puff
sleeve, a shoulder cap — stays with the torso while the arm leaves it. On `demo`, whose puff
sleeves are in `handwear`, `wave` (rendered at 30 fps with `--geometry`, physics left out,
issue #345) moves `handwear_l`'s vertices up to 443.2 rig px and every other slot's by 0.
To make such art follow the arm, cut it out of `topwear` with an `assemble.cuts` entry and
give the piece a mesh on the `sleeve_<s>` chain (§5, *Cutting a piece out of a layer*, the move
`scarf`'s `robe_r` measured); that cut has not been measured on a sleeve.

### Recipe: a soft region driven by physics

A jiggle (a bust, the hips) is a patch of one part that lags behind the body. The package
proposes none and judges none; what it gives is the three pieces to build one, all in the
config. [`examples/reference-sample`](https://github.com/rig-c/parts/tree/main/examples/reference-sample) carries a worked one (issue #183, PR #187), and its config is the
fragment below, cut to the bust:

```jsonc
"bones": [ …,
  { "name": "chest_jiggle", "parent": "chest", "at": [419, 320] }, … ],
"meshes": { "topwear": {
  "contour": { "tolerance": 1, "margin": 1, "spacing": 18, "stray": 4,
    "regions": [ { "name": "bust", "shape": "circle", "cx": 419, "cy": 320, "r": 28,
                   "bone": "chest_jiggle", "spacing": 6, "band": 16 } ] },
  "r": 8, "segments": [ ["chest", [419, 223], [419, 437]], ["hip", [419, 437], [419, 557]] ] } },
"constraints": [
  { "type": "physics", "name": "bust_phys", "bone": "chest_jiggle",
    "x": 0.5, "y": 1, "inertia": 0.25, "strength": 120, "damping": 0.92, "mass": 1, "mix": 1 } ]
```

- **A bone the config authors**, under the bone the patch rides on. `propose` writes no such
  bone and no constraint; it is yours, and nothing keys it — the constraint moves it.
- **A region in a `contour` (or `auto`) mesh** that hands the patch to that bone: weight 1
  inside the shape, falling to 0 across `band` (*A contour mesh*, above). A `grid` mesh carries
  no region, so the part moves from the lattice to the outline mode first; `reference-sample` traced
  `topwear` at its former grid spacing (18) and `bottomwear` at 28. Place the shape on the
  patch alone: on `reference-sample` one circle at the hip centre reached the clasped hands, painted
  inside `bottomwear`, so the hips are two side circles (`hip_r`, `hip_l`) on one bone.
- **A `physics` constraint** on that bone in `constraints`, in rig-c's shape; every field but
  the bone is rigc's to accept.

A region adds vertices: its `spacing` is finer than the mesh's, and every one of them is a
triangle more for the runtime to skin. Before the first build, count them:
`rig-parts mesh-stats --config config.json --parts work/rig` (issue #566; `work` is step 7's `assemble --out`, §4) runs the rig stage's own
mesh construction over the assembled parts, without rigc, without `check`, and prints one line
per mesh — `mesh-stats: topwear — contour 320 vertices, 568 triangles` on `reference-sample` —
and the total, `mesh-stats: total 1908 triangles over 6 mesh(es)`, the counts the build's
`mesh_report.json` will hold (§4, *Counting the triangles before a build*). On `reference-sample`
it runs in under a second; the build it saves runs the render and `check` as well.

`build` on `reference-sample` as tracked (PR #187; the values above are the ones tuned for its `hop`, issue #183):

```
check: PASS; 10 of 11 bar(s) measured, 1 skipped (STRESS_OFF_CHAIN)
loop physics: 2 physics constraint(s) left out of the loop's frames, reported, not judged — "bust_phys" on bone "chest_jiggle" (rig.json), "hip_phys" on bone "hip_jiggle" (rig.json)
loop: idle 49 frame(s) at 12 fps, f0000 vs f0048 (t = 4s) with the rig's 2 physics constraint(s) left out (named on the `loop physics:` line; rendered with them, the ends need not meet — `build --loop --lead-in <n>`): max |d| 0 (0 required)
```

(`9 of 9` until issue #320, whose fold bar reads `hop`; the two other lines are as they were.)

The `loop physics:` line is the loop bar saying what it did not read (§7, *loop*): rig-c's
render resets physics at frame 0 and steps it, so the idle's last frame differs from its first
by whatever the spring is still doing; the bar is read off the same rig with every physics
constraint left out, and the constraints left out are listed, reported and not judged
(`check.json`'s `loop_physics`, PR #184). It is not a measure of the jiggle.

**Limits.** The idle drives the spring, and a slow idle barely moves it. Measured on `reference-sample`
(PR #187, rig-c `render --geometry`, the physics build against the same build with
`constraints` removed): under its 4 s breath (`chest` `translatey` amplitude 1.3 px), the bust
moves at most 0.155 rig px (idle frame 3, t 0.25 s); the hips move 0.000 at all 49 frames,
because the idle keys `chest` and never `hip`, so a child of `hip` receives no motion. A spring
of strength 100 trails a parent moving at about 2 px/s by the order of speed over its angular
frequency, about 0.2 px (PR #187, from the definition): no setting makes a 4 s breath read as a
jiggle (with the values tracked now, `bust_phys` inertia 0.25, strength 120, damping 0.92, the
idle moves the bust at most 0.066 rig px, idle frame 2). Faster keys on the parent bone — a hop,
a turn, in a named animation (the recipe above) or a consumer's own — are what the spring
answers. `reference-sample`'s `animations.json` holds one, `hop` (1 s: `hip` `translate` y down 5, up 24,
landing at -6 at 0.45 s, settling at 0.55 s; nothing keys the jiggle bones): rendered at 30 fps
against the same build without its constraints, the bust moves at most 6.702 rig px and the hips
(`hip_phys` inertia 0.2, strength 160, damping 0.88, mass 1.5) at most 4.609 (frame 14, at the
landing), and both overshoot after it, 3.27 and 1.35 rig px (frames 21 and 22). These are rig-c
2.45.2's renders, whose physics no longer ends a frame on a step's tie; on rig-c 2.40.0 the same
build read 6.583 and 4.432 (frame 13) and 3.38 and 1.38, which
[`docs/evidence/sample-hop.png`](https://github.com/rig-c/parts/blob/main/docs/evidence/sample-hop.png) shows. No bar here judges the jiggle, and two limits follow from that:

- **The region's `band` caps the displacement.** The patch moves as one piece and the band is
  where the mesh stretches to follow it, so physics values that carry the patch further than
  its band absorbs squeeze or stretch the band's triangles past the texture-stretch ceiling.
  `check` reads the idle alone and does not see it; check's own reading applied to `hop`'s
  geometry with PR #187's values (inertia 0.5, strength 100, damping 0.85, mass 1, a bone
  displacement of 9.85 rig px against bands of 16 and 12) gives
  `CHECK_TEXTURE_STRETCH: mesh "bottomwear" triangle 13 (vertices 5 183 6), edge 6-5, idle frame 13 — the edge is 0.233 times its rest length (max(ratio, 1/ratio) 4.29); <= 1.926544 is required`
  and `topwear` 2.597; with the values tracked now it reads 1.719 (`topwear`) and 1.602
  (`bottomwear`) (1.697 and 1.566 on rig-c 2.40.0, before 2.45.2's render clock). Tune the constraint against the animation that drives it, not the idle.

#### A part only physics moves, in the automatic mode

A tie, a strand or a hem whose chain only a `physics` constraint turns has no idle key that
deforms it, so `auto` refuses it, `AUTO_MESH_NO_STIMULUS`, naming the bones with no motion and
the field: the motion gate measures against motion, and the package derives none from a
constraint. Declare the bend in `meshes.<part>.auto.stimulus` (issue #196, the field table in
*An automatic mesh*):

```jsonc
"scarf": { "auto": { …, "motion": { "maxLocalDeformation": 1 },
                     "stimulus": { "chain": "robe_r", "degrees": 9 } },
           "r": 6, "segments": [ "robe_r" ] }
```

Choose `degrees` as the largest bend, per link, that the physics is expected to reach in the
animations that drive it: the mesh is held only to what was declared, so a smaller bend passes a
mesh that tears at the real one, and nothing here checks the declaration against the
constraint. The recipe for a thin strand only physics moves is therefore two steps: put its
chain on the strand's own art, and declare the stimulus. The chain's position decides whether
the motion bound can be held at all: on the scarf strap cut out of the sweater, with the chain
on the strap (the tracked example's), the automatic mesh passes at the default
`maxLocalDeformation` 1 with 68 vertices (the contour mesh's 133); with the chain beside the
strap, as the proposal first placed it, the same part is refused `AUTO_MESH_MOTION` at 1 and
passes only at 3, with its hull alone (31 vertices) — a hull cannot hold a bend the chain does
not run through. Raising the bound is the author's choice, not the package's; moving the chain
is the fix.
- **An added animation can move the idle's figures.** The render's viewport is fitted over
  every animation, and the idle frames share it, so an animation that travels further than the
  idle redraws the idle at another size: adding `hop` to `reference-sample` narrowed the idle render from
  201 to 198 px wide and moved `check.json`'s `BREATH_VISIBLE` `torso_heat_mean` from 7.8 to
  7.705, every status unchanged, although `check` reads the idle alone.

### Recipe: cloth and hair that answer the world

Issue #364. Cloth and hair move **by physics, not by keyed animation** (the owner's
direction, 2026-10-13), so that a rig in a scene answers the scene — the body under
it moving, a gust from the side. The config's `cloth` block declares the recipe per
tag, and `propose --cloth <config.json>` drafts it; the proposal is copied into the
config as always, `constraints` with the rest. Without `--cloth` nothing the proposer
writes changes. The recipe makes the rig **respond**; driving it — a hip key, a walk,
the wind — is the consumer's, and the recipe drafts no key and no stimulus.

```jsonc
"cloth": {
  "bottomwear": { "chains": 4, "links": 3, "split": { "at": 1, "into": 2 },
                  "damping": 0.85, "alternate_damping": 0.7,
                  "wind": [2, 10], "gravity": [5, 30], "translate": 0.2,
                  "swing": { "scales": [1.3, 1, 1, 1.3] } },
  "back hair":  { "chains": 2, "links": 3, "split": { "at": 1, "into": 2 }, "wind": [1, 8], "gravity": [4, 24] },
  "front hair": { "chains": 1, "links": 3, "wind": [1, 6], "gravity": [2, 12], "translate": 0.2 }
}
```

(The selftest's fixture recipe, `fixtures/cloth.ts`: values chosen to exercise every
rule, not advice. It leaves `length_ratio` and `strength` out, so the recipe's own
defaults are what is built and measured below.)

What each rule drafts (`src/cloth.ts` holds them):

| rule | drafts | from |
| --- | --- | --- |
| where | `bottomwear`: from `hip`, the root row 20 px below hip's y (the keyed chains' row), the tip row 4 px above the cloth's own bottom under each column (4 px above the part box's bottom when every column reaches the bottom band, or 4 px above where the cloth's alpha ends under that column on a floor-spread skirt whose middle hem ends above bare thighs; a column with no cloth below the root row gets no tree drafted there and emits a note saying so, issue #438). `back hair` that reaches below the shoulders: from `head`, per side of the eye axis (twin tails are a side each), the eye line to 4 px above its bottom. `front hair`: each strand that hangs below the chin (the lock rule's), from `head`, 0.22 face heights above the eye line to 5 px below the strand; the fringe's three columns keep their two links and their places | the keyed chains' own rows, which these replace |
| trees | tree k of `chains` owns the cell k/N .. (k+1)/N of the art's width in every row, and its links sit at the cell's centre in the 24-row band there, so a piece that widens fans its trees. On `back hair`, `chains` is optional (issues #390, #445, #461): when omitted, `propose --cloth` derives the tree count on each side from the side's **visible hair masses** — connected components of the `back hair` part's alpha below the eye-line root row (after skipping any undivided crown rows that bridge continuously across the eye axis), merged when they touch within one mesh grid cell — placing `max(1, floor(w / (4 * grid)) + 1)` trees inside each mass across its root-row opaque width `w` (one tree per `4 * grid` of horizontal reach, where a tree's segment weight `1 / (d + r)^2` with `r ≈ 0.42 * grid` drops to `MIN_WEIGHT = 0.03` at `2 * grid` on each side of the trunk), rooted at that mass's own top row and with every link inside that mass's column range; `propose`'s `LINT` names the masses it found and their columns when a side's tree count or link leaves them. An explicit `chains` that exceeds what the narrower side's opaque width at the eye-line root row holds (`max(1, min(floor(w_r / grid), floor(w_l / grid)))`) or places a root off the 15 px dilated art is refused (`PROPOSE_CLOTH_BACK_HAIR_CHAINS`). With `split`, the trunk's tip is the fork, and branch b of `into` follows the centre of its share of the cell. Chains are named `<prefix><k>_` (trunk) and `<prefix><k><a, b, …>_` (branches): `skirt`, `hairback_r`/`hairback_l`, `lockt`. With `split.hold_tip: true` (issues #403, #392), sibling branches keep `strength.branch` across the fork, the mesh's `r` is raised to `grid`, and the rig stage blends each fork's sibling branch weight shares across four passes of 1-ring mesh-edge averaging (self weight 0.5, floor 0.005, cap 8 influences) — every share alike, trunk, branch and fixed bones, none held in place — holding the triangles where two branches' cells meet; when the recipe also declares `influence`, the drafted influence mesh carries `hold_tip: true` and `max` at least 8, and the rig stage smooths it by the same passes capped at that `max` (issue #615, the `meshes.<part>.influence` row) | `chains`, `links`, `split` |
| lengths | link j's length is the first's times q^j, q = `length_ratio`^(1/(links − 1)), the whole spanning root row to tip row: the links shorten toward the tip | `length_ratio` (default 0.5, below) |
| stiffness | a trunk link takes `strength.trunk`, a branch link `strength.branch`, and the edge — the outermost branch on each outer side of the piece (both sides of a skirt or a strand; the outer side of each back-hair side; or, under `split.hold_tip: true` with `strength` left out, kept at `strength.branch` so a fork's sibling branches do not pull apart at the default 2:1 stiffness), or without `split` the outermost tree — `strength.edge`; a fringe column is a trunk, its outer two the edge. **Strength does not fall along a chain**: a tip reads soft because each link turns on top of every link above it, so the motion accumulates down the chain at one strength. Only the edge is declared softer | `strength` (default trunk 100, branch 100, edge 50, below) |
| response | link j of an n-link path takes `wind` and `gravity` at j/(n − 1) of the way from the root value to the tip value; a single-link path takes the tip value. Each is a scalar **multiplier** of the environment the consumer sets (spine-core's skeleton `windX, windY`, `gravityX, gravityY`; rig-c 2.52.0's live track `setEnvironment`, rig-play 1.10.0's `environment()`): no direction is drafted | `wind`, `gravity` |
| out of phase | the odd trees take `alternate_damping`, the even ones `damping` | `damping`, `alternate_damping` |
| flutter | the last link of every path gets a second physics constraint, `<bone>_translate`, moving x and y by `translate`, with the link's stiffness and damping and **no** wind or gravity response. spine-core scales a translate spring's response by the skeleton's reference scale (100) and a rotation's by the link's length over it, so one response on both pushes an end about 100/length times further than it turns it (the table below) | `translate` |
| part / parts | `part` (a string on `bottomwear` only, issue #402): the named `topwear` part takes the skirt's rule as the `bottomwear` parts do — trees from `hip` over its art below the hip, its waist line, and, as its art reaches above the chest, the chest segment the long-robe `bottomwear` keeps — in place of the two robe chains the topwear rule drafts; the prefix is `skirt` when it is the only skirt, `skirt_<part>` beside another. A `bottomwear` part lying on the named part's tree links rides them and drafts no trees of its own (issue #416, *What rides a dress* below). `parts` (or `part` as a list, on any tag, issue #437): a non-empty list of distinct part names in root-to-tip order (`["hair_back", "hair_back_front"]`) that share one set of trees drafted from the root part's origin to the last part's tip, each part's mesh receiving only the link segments whose span crosses its opaque art (`spanCrosses > 0`) | `part`, `parts` |
| swing | `bottomwear` only: a bone `<prefix>_swing` under `hip` at the centre of the root row, one link long, straight down, with physics (the trunk's stiffness, the root's response); each tree's first link takes the swing's rotation times its scale — a transform `<swing>_<k>`, local source and target, additive, the swing's setup rotation in hip's frame (−90: hip is drafted unturned) subtracted — and no physics of its own | `swing.scales` |

Every link but a swing-driven first link gets `<bone>_physics` (`rotate` 1), and no
idle key: the drafted idle keys none of the trees. A recipe that drafts nothing —
its tag on no part, or `back hair` that ends above the shoulders (a bun) — is refused,
`PROPOSE_CLOTH_DRAFTED`.

**A keyed sibling left behind (issue #572).** Taking the trees' idle keys can leave a
keyed bone the only keyed child of its parent — a bun under `head` once the fringe and
the locks are on physics — and `CHAIN_LAG` then reads parent and child as one chain
whose amplitudes must not fall toward the tip, so that sibling's amplitude may need
raising to its parent's. `propose --cloth` reads the keyed chains after the recipe with
`CHAIN_LAG`'s own reader (in the config written under `--write-config`, else in the
proposal), and for each link of a chain only the recipe made whose amplitude is below the
link above's prints `LINT <bone> under <parent>: amplitude <a> below the link above's <b>
in the keyed chain …`, naming the siblings whose keys went and the config field, with
`<b>` the least that passes. It changes no amplitude: the keyed amplitude is the author's.

**The edge's strength on a turning head** (measured, not a bar). The edge default, 50,
stays: no bar this package holds fails at it. On the public
[Getting Started](https://github.com/rig-c/getting-started) walkthrough's character,
with `front hair` at `chains` 1, `links` 3 (its side locks are the edge), the hello's
head turn reads `face|hair_front` through `SEAM_OVER_MOTION` (declared by a `seam`
requirement, which makes the pair read; a warning, never a bar) at max 131 px over 6
frames with `edge` 50 and 75 px over 4 frames with `edge` 100; the `seam` requirement's
own reading, `largest_px`, is 7.98 and 6.69. A recipe whose strands trail a head turn
further than the scene allows declares a stiffer `strength.edge`.

**The config written (issue #537).** `propose --cloth <config.json> --write-config
<out.json>` writes, beside `proposal.json`, the `--cloth` config's own text with what the
recipe drafts spliced in, the way `mesh-draft` writes its config: `rig --config <out.json>`
builds it, and an editor that changes a recipe rebuilds through it rather than merging
the proposal itself. What is spliced is measured on each run, not listed: the same parts
are drafted again without the recipe, and each config section whose value differs is
the recipe's. An object section is spliced entry by entry — `meshes.<part>` and
`regions.<part>` for each part the recipe moved (a part it takes from `regions` into
`meshes` leaves `regions`), `motion.tracks` and nothing else under `motion`, so
`duration`, `blink` and `animations_from` keep their bytes — and so are `bones`,
`constraints` and `motion.tracks` (issue #552), by each entry's name: a bone by `name`
or `chain` (one namespace, as a mesh segment resolves either), a constraint by `name`,
a track by `chain` or by `bone` and `prop` together. An entry the recipe drafts (one the
draft with the recipe holds and the draft without it lacks or holds differently) is
replaced in place, or, when the input lacks it, inserted after the input's entry that
precedes it in the drafted array (the nearest earlier drafted entry the array holds),
else at the end of the array; an entry the recipe replaces (a plain chain it drafts as
trees) is removed; **every other entry is kept, its bytes and its place** — a bone, a
chain, a constraint or a track added by hand survives a `--write-config`. An entry the
recipe re-drafts or removes that the author changed by hand (it equals neither draft) is
not dropped: the run is refused, `PROPOSE_WRITE_CONFIG_CONFLICT`, naming the entry
(`config.constraints[40] "skirt0a_0_physics"` in CL207), the first field the hand edit holds and
what the draft writes there, every conflict at once and nothing written; take the draft
by removing the hand edit, or leave the recipe out for that part. **A changed recipe
(issue #571).** The draft of the recipe as it stood before a change is neither of the
two drafts, so a config holding that draft untouched would read as hand-edited at every
entry the change moves (29 refusals on the public `wind` example with
`cloth.bottomwear.links` 3 → 4). `--from <previous config>`, given beside
`--write-config`, names the config the recipe is changed from: its `cloth` block is read
as `--cloth`'s is (a missing file or a missing `cloth` block is refused by the same
codes), and the same parts are drafted a third time with it. An entry equal to that
previous recipe's draft is then the recipe's, as one equal to the draft without the
recipe is: replaced by the draft, or removed where the draft no longer holds the name
(a link the change took away). An entry equal to none of the three drafts is still
refused, `PROPOSE_WRITE_CONFIG_CONFLICT`, the detail reading "it equals neither the draft,
the draft without the recipe, nor the previous recipe's draft" and naming the first field
that differs from the previous recipe's draft (the entry a person most likely edited
from). **A dropped recipe (issue #630).** A change can remove one tag's recipe and
keep another's (`back hair` taken out of `cloth`, `bottomwear` left in). That tag's
entries are then the draft without the recipe again, so every entry the previous
recipe drafted and the recipe now leaves to the plain draft goes back to it: its plain
chains and their tracks inserted (beside their drafted neighbours, as above), its trees
and their constraints removed, its `meshes.<part>` (and any `regions.<part>`) replaced
by the plain draft's — where the input holds that entry as the previous recipe's draft
wrote it, or lacks it in a section it holds. A hand edit to one of those entries is
refused by name as any other, `PROPOSE_WRITE_CONFIG_CONFLICT` (`config.meshes.hair_back`
in CL221, the field read against the previous recipe's draft); the tags the change keeps
do not move. Before #630 the write exited 0 with the dropped tag's old mesh kept and its
plain chains missing (CL222 keeps that writer as the selftest's mutant). The write line
ends `--from <path>: n entries taken as the previous recipe's draft, m entries returned
to the plain draft`. Apart from a dropped recipe's entries, `meshes.<part>` and
`regions.<part>` are unchanged by `--from`: a mesh the recipe drafts is replaced whole
already, and one all three drafts agree at is not touched.
Without `--from` every rule and every byte is the writer's before #571; with a `--from`
whose recipe equals `--cloth`'s the previous draft is the draft, and the written config
is byte for byte the one written without it (CL209–CL212 hold each on the cloth fixture,
CL213–CL215 on `wind`; CL220–CL223 the dropped recipe on the cloth fixture, CL224 on
`wind`, where dropping `back hair` writes the run's proposal value for value). The written config is the recipe's draft, not a verdict on it: on
`wind`, `links` 3 → 4 writes the skirt entries of its proposal value for value, and that
draft fails `CHECK_TIP_OVER_ROOT` on the skirt in `build`; 3 → 2 builds green (CL215). A `meshes.<part>` the
recipe drafts is still the draft's whole, as a hand-edited lattice does not survive
`mesh-draft`, and a mesh it does not draft keeps its bytes. Every other byte is the
input's; a section the input lacks (a config holding only `key` and `cloth`) is
inserted whole. On the selftest's cloth fixture (CL201 prints the figures) the recipe
removes six plain chains from `bones` and their nine tracks from `motion.tracks`,
inserts its trees, moves `meshes.hair_back`, `meshes.hair_front` and `meshes.skirt`,
and inserts `constraints`; with bones, constraints, a track and a mesh added by hand
(CL205) the written config differs from the input only at those entries; `limbs` is not
moved on the public `wind` example with its keypoints, whose tracked config the flag
wrote back byte for byte (measured once, when the flag landed). The text is written as stated: a relative path in it
(`motion.animations_from`, `generation.control.skeleton`) resolves against the directory
the written config sits in, so the out path belongs beside the input, and when it is not
a note names each such path. Refused before anything is written: `--write-config`
without `--cloth` or beside `--from-config`, and `--from` without `--write-config`
(`USAGE`), an out path that exists or that
the run writes itself (`PROPOSE_WRITE_CONFIG_FRESH`), a hand edit to an entry the
recipe owns (`PROPOSE_WRITE_CONFIG_CONFLICT`), and a text whose splice does not
parse to the config with the sections set — a key stated twice
(`PROPOSE_WRITE_CONFIG_SPLICE`); a recipe that drafts nothing is
`PROPOSE_CLOTH_DRAFTED` as without the flag.

**A skirt inside topwear (issue #402).** The recipe finds a skirt by the `bottomwear`
tag alone. When See-through returns the skirt inside `topwear` (a dress), nothing is
tagged `bottomwear`, and the proposer does not pick the dress by its shape: with
`--cloth`, a `topwear` part whose box reaches 0.25 face heights below the hip (the
topwear rule's own waist line) and whose art is wider across its last 24 rows than in
the 24-row band at the hip is **named in a note** — the part, its art's rows below the
hip, and the field — and in `PROPOSE_CLOTH_DRAFTED`'s line when a `bottomwear` recipe
found no part. The author declares it, `"bottomwear": { …, "part": "<name>" }`, instead
of moving the layer. Why a name and not a draft, measured on the public examples' builds
(this port's assemble, the proposer's hip): `scarf`'s `topwear`, an outer robe over a
separate `bottomwear` skirt, passes the same shape (rows 658 to 890 below the hip at y
657; 287 px across its last rows against 271 at the hip), so a draft by shape would hang
a second set of skirt trees on a robe; `wind`'s `topwear`, a blouse whose sleeves reach
the hip band, does not (350 px against 493). Without `--cloth` nothing is named, so every
example's proposal is the one it was. What a declared dress drafts, measured on the
selftest's dress fixture (`fixtures/cloth.ts`, flat colour; RG480 prints the figures):
one lattice on chest, hip and the trees, built green through the gate with no split of
the mesh; the bodice is not held wholly to the chest — a vertex above the hip carries up
to 0.258 of its weight on the trees; and `check`'s `BREATH_VISIBLE`, which reads every
`topwear` part as the torso, read the dress's idle heat at 1.592 against the floor
3.809, where the same dress with the robe chains read 3.9 — the half on the trees has
no idle key. Neither is barred here; both are the dress's to weigh before declaring it.
Since issue #411 the bar reads the breath alone, and on that fixture the breath moves
the dress 0.106 and the robe-chained dress 2.62: both fail, and the 3.9 was the robe
chains' keyed swing below the hip, not the breath (the CK502 and CK503 controls).

**A skirt cut at the waist (issue #412).** `cloth.bottomwear.part` resolves the exact
name in the assembled `parts.json`, after `assemble.cuts`. It may name the lower
piece cut from a `topwear` dress, for example `"part": "skirt_piece"` for a cut
`from: "dress", into: "skirt_piece"`. The piece keeps `cut_from: "dress"` and its
source tag; it receives the same skirt recipe over its own art. When that art starts
below chest, the existing waist-hung rule omits the chest segment. The retained
bodice, when it stops above the waist line, keeps its trunk segments without robe
chains falling below its art. This names one target: other cut pieces remain
excluded from automatic tag rules, and an unknown name, a non-topwear source or a
target ending above the waist line is still `PROPOSE_CLOTH_PART`. Without `part`,
cut selection and proposals are unchanged. The named piece also carries an
overlapping hem by the same rule below.

**What rides a dress** (issue #416). With `part` declared, a `bottomwear` part lying on
the dress — a ruffle hem See-through returned as a layer of its own — rides the dress's
tree links by the rule a part wrapped round a tail does (*What rides a tail*, below): each
of its pixels over the dress's art is given to the span of the dress's mesh nearest it
(a fixed segment, chest or the waist line, or one tree link), and the part rides when one
of those spans is a link. Its mesh's segments are then the spans it lies on, it drafts
no trees of its own, and a note names each span with its pixel count; a `bottomwear` part
over no link keeps its own trees. Before, the hem took the skirt's recipe by its tag as
well, so one skirt carried two sets of trees, each on its own physics. Measured once on
the selftest's dress fixture with a 112x26 hem across its last tier (`fixtures/cloth.ts`,
`HEM`; the hip from joints at y 164; rig-c 2.54.0, `check`'s idle, physics on), before
this rule and with it: the trees drafted went from four (`skirt_hem0_`, `skirt_hem1_`,
`skirt_dress0_`, `skirt_dress1_`) to two (`skirt0_`, `skirt1_`), and their physics
constraints from 8 to 4; `TEXTURE_STRETCH` read 1.275 both ways (its worst mesh is the
back hair), the hem's own mesh 1.034 with its own trees and 1.045 riding, and the largest
opening of the hem's seam with the dress 0.502 and 0.432 px (CK510 holds the one set and
the pass). The hip rule still reads a `bottomwear` part's top edge as the waist, so a
hem and no hip joints put the hip at the hem: on the same fixture without joints, y 277,
and the dress's trees run up from y 297 to 286. Without `part` nothing here runs.

**What rides a tail** (issue #391). An accessory wrapped round a tail the `back hair`
recipe drafts — a ribbon, in See-through's `headwear` or `earwear` layer — rides that
tail's links, not `head`: under the recipe the tail moves by the world, and a part left on
`head` stays where the tail was. Which links is read off the overlap, never off the
part's name: each of the part's pixels over the tail's art is given to the span of the
back hair's mesh nearest it (its fixed segment on `head`, or one tree link, the distance
the weights read), and the part rides when one of those spans is a link. Its mesh's
segments are then the spans it lies on — each link by name, the head's span written
out — so every vertex weights by the rule the tail's own art does, the pixels off the
tail (a ribbon's loops) included; no accessory bone, pendant or strand chain is drafted
for it, and a note names each span with its pixel count. A part over no link keeps the
accessory rule. It is part of the recipe's drafting, not a field: the rule reads only
the art, and without the recipe no tail moves by the world and nothing here runs. On
`wind` (rig-c 2.54.0, `rigc render --environment`, idle frame 200 of 200 at 60 fps,
0.916 px per rig px), the ribbon pixels painted over the tail that are drawn where the
tail has no hair went from 2,429 at calm and 8,363 at wind (10, 0) to 30 and 230; the
230 all lie within 3.6 px of the hair's edge, where the ribbon's mesh and the hair's are
two different lattices.

**Every spring is stable at its step (A23's inequality).** Per step spine-core does
`v += −strength·x·step·massInverse`, `x += v·step`, `v *= d` with d = damping^(60·step);
in (x, v·step) that is the matrix [[1 − k, 1], [−d·k, d]] with
k = strength·massInverse·step², and both eigenvalues are inside the unit circle exactly
when **0 < k < 2(1 + damping^(60·step))**. The recipe sets no `fps` or `mass`, so step is
1/60 and massInverse 1 (rig-c's defaults), and a damping left out is rig-c's 0.85. The
loader refuses a strength, declared or default, at or past the bound at any damping the
recipe runs at (`CONFIG_CLOTH_SPRING_STABLE`). The defaults against it:

| strength | k = strength/3600 | bound at damping 0.85 (rig-c's default) | at 0.7 | at 0 (the lowest) | at 1 |
| --- | --- | --- | --- | --- | --- |
| 100 (trunk, branch) | 0.027778 | 3.7 | 3.4 | 2 | 4 |
| 50 (edge) | 0.013889 | 3.7 | 3.4 | 2 | 4 |

**The defaults are the recipe's own, measured here** on the cloth fixture
(`fixtures/cloth.ts`: a skirt of four trees on a swing, twin-tail back hair of two trees
a side, a lock and the fringe; its recipe above; rig-c 2.47.1's build and `check`, and
for the environment rig-c's live track, `setEnvironment`, which rig-c has from 2.52.0,
read with 2.53.0). Candidates, each with the others at the
default (`TEXTURE_STRETCH` severity, ceiling 1.927; then, under wind (1, 0) against
calm (0, 0), gravity (0, 1) throughout, each held three idle cycles, the largest vertex
displacement of `hair_back`, `skirt` and `hair_front`, and how far the origin of the last
link of the right side's outer edge branch, `hairback_r0a_1`, moves against that of the
inner branch beside it, `hairback_r0b_1`, in rig px):

| candidate | TEXTURE_STRETCH | wind (1, 0) vs calm: hair_back / skirt / hair_front | edge / inner branch |
| --- | --- | --- | --- |
| **default: strength 100 / 100 / 50, length_ratio 0.5** | **1.382** | **10.299 / 3.390 / 2.119** | **5.608 / 3.846** |
| edge 100 (no softer edge) | 1.125 | 8.126 / 2.480 / 1.091 | 3.857 / 3.846 |
| edge 25 | 2.062, **FAIL** | 14.355 / 4.931 / 4.014 | 8.333 / 3.846 |
| length_ratio 1 (equal links) | 1.516 | 13.677 / 4.133 / 2.721 | 5.208 / 3.348 |
| length_ratio 0.25 | 1.217 | 7.841 / 2.762 / 1.731 | 5.513 / 4.083 |

The rule the defaults were chosen by: the edge visibly softer than the branch beside it
(edge 100 makes them one), every bar green (edge 25 stretches the texture past the
ceiling), and among the ratios that do shorten the links toward the tip (1 does not) the
one that answers the wind most. The figures are this fixture's; on other art the same
reading, `check` and a gust, is how to tune them.

The flutter's split, measured on the same fixture (`TEXTURE_STRETCH` severity, the
translate mix at 0.2 / 0.5 / 1): as drafted, no response on the translate, 1.382 /
1.388 / 1.398; given the link's own wind and gravity, 1.65 / 3.233 (**FAIL**) /
3.814 (**FAIL**).

**What moves them.** Physics answers motion of the bones above it and the environment.
The drafted idle keys `chest` (the breath) and the head chain, never `hip`, and the
recipe adds no key: under the idle alone a skirt's trees move only by the environment. Under rigc's default environment that motion is the physics reset at frame 0 dying out, and `check` says so by name: `CLOTH_SETTLES` (§6, issue #501) warns on each chain whose tip comes to rest before the idle's loop length — on `wind`, the skirt's eight trees and its swing, between 1.5 and 2.75 s of a 3.333 s idle.
`rigc render` and `check` pose under spine-core's default, wind (1, 0) and gravity
(0, 1), so on the fixture `check` reads `check: PASS`, `TEXTURE_STRETCH` 1.382,
`TIP_OVER_ROOT` ratio 15.06 (root 0.095, tip 1.438 rig px), `CHAIN_LAG` PASS,
`ANIMATIONS_DO_NOT_FOLD` 0 folding meshes (read, when this was measured, with the physics
left out; since issue #363 the bar reads physics on and off side by side), and
`rigc render --folds` on the same build **with** all of its physics constraints reads 0 of 3
meshes folding at 12, 24 and 60 fps. Under an explicit environment set through the live
track's `setEnvironment` — wind (1, 0) for one idle cycle, then (−1, 0) for one, then
calm (0, 0) for one, gravity (0, 1) throughout, on one looping track — the frame at the
end of each wind phase, against the calm frame at the same idle time, moves `hair_back`
by up to 10.396 and 10.188, `skirt` 3.390 and 3.382, and `hair_front` 2.131 and 2.104 rig
px, either way alike; held three cycles each from a fresh track, 10.299 / 10.277,
3.390 / 3.382 and 2.119 / 2.115.

**A standing cloth is the consumer's to drive** (issue #502). The drafted idle keys no
`hip`, and that is a measured decision, not an omission. A hip sway was tried on every
public example: a `motion.tracks` entry `{ "bone": "hip", "prop": "rotate", "amp": a,
"period": <the idle's>, "phase": 0 }` at the breathing period, a = 0.1°, 0.2° and 0.3°
(this port's build of each, rig-c 2.60.0, `check`'s idle at 12 fps). Every sway keeps the
chains it reaches above `CLOTH_SETTLES`'s floor, and every one turns a passing `check` red:

| example | chains no idle key drives | 0.1° | 0.2° and 0.3° | idle frames changed by 0.1° |
| --- | --- | --- | --- | --- |
| `demo` | 0 | `CHAIN_LAG` | `CHAIN_LAG`, `TIP_OVER_ROOT` | 11.91 % of pixels, up to 148 levels |
| `scarf` | 0 | `CHAIN_LAG`, `TIP_OVER_ROOT` | the same | the framing box changes, 201 to 202 px wide |
| `wind` | 9, the skirt | `CHAIN_LAG`, `BREATH_VISIBLE`, `STILL_REGIONS_DARK` | those and `TIP_OVER_ROOT` | 17.42 %, up to 203 |
| `reference-sample` | 1, `hip_jiggle` | `CHAIN_LAG` | the same | 29.42 %, up to 121 |
| `reference-demo` | 0 (no physics) | `CHAIN_LAG` | the same | 47.63 %, up to 222 |

Two of those are not the amplitude's to fix. `CHAIN_LAG` reads a lag modulo half a cycle
and passes only a step of 0.001 to 0.25 of a cycle (§7), so every keyed chain under one
parent must start within a quarter cycle of the others; the keyed chains under `hip` start at phases from the neck's 0.08 to the third
skirt chain's 0.38: a span of 0.30 cycle on `demo`, `scarf`, `reference-sample` and
`reference-demo`, so no phase of a hip turn at the idle's period has all of them lagging
it. `wind`'s span, 0.08 to 0.29, admits phase 0.06, and there 0.1° still fails
`BREATH_VISIBLE`, `STILL_REGIONS_DARK` and `TIP_OVER_ROOT`. And the legs hang from `hip`:
a hip turn moves the feet (0.857 rig px at 0.1° on `wind`), which a standing character
holds still. So a cloth that should move while the character stands is moved by the
world, which the consumer sets when it plays the rig (rig-c's live track
`setEnvironment`, rig-play's `environment()`). `rigc render --environment` reads the
same world from a file, to look at the response before a player exists (rig-c's
AUTHORING §8.4: each step holds from its `t`, x right and y down). A worked schedule for
`wind`, tracked as `examples/wind/breeze.json`, is a breeze that changes every half
second:

```json
{
  "spec": "rigc-environment/1",
  "steps": [
    { "t": 0, "wind": [0.4, 0] },
    { "t": 0.5, "wind": [1, 0] },
    { "t": 1, "wind": [0.2, 0] },
    { "t": 1.5, "wind": [0.8, 0] },
    { "t": 2, "wind": [0.3, 0] },
    { "t": 2.5, "wind": [1, 0] },
    { "t": 3, "wind": [0.4, 0] }
  ]
}
```

```bash
rigc render --candidate out/check/build --animation idle --fps 12 --max 640 --geometry \
  --environment examples/wind/breeze.json --out out/breeze
```

Read by `CLOTH_SETTLES`'s own definition on the `geometry.json` that writes, none of the
16 chains settles. The nine that settle under the default world keep moving to the last
frame: the skirt's eight trees end at 7.66 to 23.79 rig px/s, and the swing at 2.778
(selftest `CH21` holds this). `check` without `--environment` reads the default world, so
`wind`'s tracked `check.json` keeps its WARN; `check --environment examples/wind/breeze.json`
takes every reading under the breeze instead (§6, *The world the readings are taken in*). The WARN states what the rig does with nothing driving it;
it is not a fault (`CH20` holds that the idle keys no hip and that the chains which
settle are exactly the ones no idle key drives). A soft region with no wind response,
such as `reference-sample`'s `hip_jiggle`, is not reached by an environment at all:
`rigc render --environment` refuses the schedule by name, since no physics constraint
answers wind. It answers the body, so what moves it is a consumer's animation that
moves `hip`, such as a walk or a turn, not the idle.

**Not in this recipe.**

- **Weights across neighbouring chains** (rig-c/core#1415's per-vertex weights, a vertex
  following the links of several trees): issue #378.
- **A stop at the legs** is not needed for this recipe. On a copy of the fixture with two
  thighs drawn behind the skirt, under the environment alone (wind (1, 0), then (−1, 0),
  then calm) no skirt link that clears the thighs at rest crosses into one: 0 crossings.
  A consumer's hip motion can make the hem cross: on the same copy, under a hip sway
  applied to it through the live track (±8 degrees and ±12 px, a 2 s period), skirt links
  cross on 224 (calm) and 228 (wind (1, 0)) of 360 steps. That case is `config.stops`
  (issues #404, #447, §2 `stops`): each entry clamps its chain's links against a limb
  bone (`against`, e.g. `leg_r0`) at `at: [x, y]` in `against`'s local frame (`+x`
  along the bone from its origin to its next link or tip). Because rig-c's stop aims
  `<chain>_rest` from `links[0]`'s origin at `<chain>_touch` (`at` on `against`) and
  requires `|rest| + outward <= 180°` so Spine's `±180°` wrap sits outside the outward
  bound (`RIG_STOP_BOUNDS`), `<chain>_touch` must lie below `links[0]`'s root in rig
  pixels (`ty >= y0`). On a prone or kneeling pose where the thigh (`leg_<s0>`, hip ->
  knee) descends and the shin (`leg_<s1>`, knee -> ankle) rises upward toward the ankle,
  `leg_<s1>`'s local `+x` points upward, so a positive `at[0]` on `leg_<s1>` can place
  `<chain>_touch` above `links[0]`'s root (`|rest| > 90°`): stop against the descending
  thigh `leg_<s0>` instead, restrict `links` to links rooted above `<chain>_touch`, or
  omit the stop on a rising shin that lies outside the hanging chain's sweep. When
  `--keypoints` drafts leg chains, a note says so.

### Recipe: planted feet on a parts figure (issue #570)

A dance moves the hip and leaves the feet where they stand. A rig whose legs ride `hip` —
`demo` as tracked draws `legwear` as a region on it — carries the bottom of `legwear` with
every step the hip takes, while `shoes`, on `root`, stay. Planted feet are three authored
pieces, each measured below; `propose` writes none of them.

- **A foot target under `root`.** One single bone per leg, `foot_r` and `foot_l`, parented to
  `root` at the leg chain's `tip`, the ankle. Nothing keys it, so the ankle stays put whatever the
  hip does. A target under the leg is refused before anything is built
  (`CONFIG_CONSTRAINT_TARGET_DETACHED`, §6): driving the leg would move what it follows.
- **A two-bone `ik` per leg** in `constraints`, over the chain's two links (`leg_r0`,
  `leg_r1`), aimed at that leg's target. The loader accepts it and rigc builds it. Two rules come
  with it. **`bendPositive` is `true` on `leg_r` and `false` on `leg_l`** (`leg_r` on the
  image's left, as `propose` names it): that pair bends both knees outward when the hip sinks,
  on `demo` and on the fixture below; the reverse pair bends them inward. **Each knee lies on
  its hip → ankle line** (the chain's middle point on the segment from its first point to its
  tip), or off it only on the side the knee bends to: the solver bends a knee to the side
  `bendPositive` names, so a knee drawn to the other side is turned over at the setup pose and
  the leg leaves its art. On the fixture `leg_r`'s knee drawn 1 px inward fails
  `CHECK_SEAM_WITHIN_BAR`, and 1 px outward builds green. Under `--idle-keys ctl` an idle key on a leg link splits the pair (the `constraints`
  row, §3); the recipe keys no leg link.
- **`legwear` as one mesh on both chains.** A `contour` mesh whose `segments` are both legs,
  `["leg_r", "leg_l"]`, so each vertex follows the shin it lies on. Where the vertices lie
  decides the reading more than the weighting rule does. On `demo`, the exam's ankle reading
  (below), rig px, the same dance, every build `check: PASS`:

  | `legwear` | targets at the bottom of the legwear (y 1076) | targets inside the boot (y 1112) |
  | --- | --- | --- |
  | lattice, `grid` 32 | 4.29 | 6.42 |
  | lattice, `grid` 32, `exponent` 6 | 8.82 | 9.3 |
  | lattice, `grid` 32, `rule: "heat"` | — | 9.3 |
  | contour, `spacing` 32 | 2.2 | — |
  | contour, `spacing` 32, `exponent` 6 | 1.6 | — |

  A sharper falloff moves the lattice's reading up and the contour's down: the lattice's
  lowest row sits where its cells fall, the outline's on the art's own edge. On the fixture's
  8 px legs an outline left uncut
  is one long edge per side, and the slivers it makes fold when the knee bends
  (`CHECK_ANIMATIONS_DO_NOT_FOLD`); `maxEdge` (the `contour` row, §3) cuts it. `shoes` stays a
  region on `root`.

The fragment, on a 64 px figure (the selftest's fixture: two legs 8 px wide at x 30..37 and
44..51, rows 12..49, joined by a band over rows 6..11; two shoes over rows 50..54). Write your
own figure's points, and keep each knee on its line:

```json
{
  "bones": [
    { "name": "hip", "parent": "root", "at": [41, 4] },
    { "chain": "leg_r", "parent": "hip", "points": [[34, 6], [34, 28]], "tip": [34, 50] },
    { "chain": "leg_l", "parent": "hip", "points": [[48, 6], [48, 28]], "tip": [48, 50] },
    { "name": "foot_r", "parent": "root", "at": [34, 50] },
    { "name": "foot_l", "parent": "root", "at": [48, 50] }
  ],
  "constraints": [
    { "type": "ik", "name": "leg_r_ik", "bones": ["leg_r0", "leg_r1"], "target": "foot_r", "bendPositive": true },
    { "type": "ik", "name": "leg_l_ik", "bones": ["leg_l0", "leg_l1"], "target": "foot_l", "bendPositive": false }
  ],
  "meshes": {
    "legwear": { "contour": { "tolerance": 1, "margin": 1, "spacing": 4, "maxEdge": 4 }, "r": 4, "segments": ["leg_r", "leg_l"] }
  },
  "regions": { "shoes": "root" },
  "motion": {
    "duration": 1,
    "tracks": [{ "bone": "hip", "prop": "translatey", "amp": 0.5, "period": 1, "phase": 0, "base": 0.5 }],
    "animations_from": "dance.json"
  },
  "requirements": "feet.json"
}
```

`dance.json`, the dance setting: the hip travels 3 px to either side over 4 s and sinks 3 px
every half second, and nothing keys a leg or a foot.

```json
{
  "spec": "rigc-motion/1",
  "animations": {
    "dance": {
      "duration": 4,
      "loop": true,
      "tracks": [
        { "bone": "hip", "property": "translatex", "keys": [{ "t": 0, "v": [0] }, { "t": 1, "v": [3] }, { "t": 2, "v": [0] }, { "t": 3, "v": [-3] }, { "t": 4, "v": [0] }] },
        { "bone": "hip", "property": "translatey", "keys": [{ "t": 0, "v": [0] }, { "t": 0.5, "v": [-3] }, { "t": 1, "v": [0] }, { "t": 1.5, "v": [-3] }, { "t": 2, "v": [0] }, { "t": 2.5, "v": [-3] }, { "t": 3, "v": [0] }, { "t": 3.5, "v": [-3] }, { "t": 4, "v": [0] }] }
      ]
    }
  }
}
```

`feet.json`, the scene's statement that the ankles stay (*Declared requirements*, §7): each
shin's tip against the stage point it stands on.

```json
{
  "spec": "spine-parts-requirements/1",
  "fps": 12,
  "requirements": [
    { "name": "RIGHT_ANKLE_STAYS", "kind": "contact", "animation": "dance", "bone": "leg_r1", "point": "tip", "target": { "stage": [34, 50] }, "within_px": 0.5 },
    { "name": "LEFT_ANKLE_STAYS", "kind": "contact", "animation": "dance", "bone": "leg_l1", "point": "tip", "target": { "stage": [48, 50] }, "within_px": 0.5 }
  ]
}
```

**What the bars read.**

- **The `contact` requirements** read the planted feet directly. On the fixture each reads
  0.102154 px, at the frame where the hip stands 3 px aside: the leg then has to reach
  sqrt(44² + 3²) = 44.102154 px with 44 px of bone, and the solver stretches it straight. Without
  the two `ik` constraints the shins ride the hip and each reads 3.354102 px, the hip's own
  largest travel, sqrt(1.5² + 3²) at t = 0.5 s (`CHECK_REQUIREMENT_MET`). Selftest `CK540`–`CK544` build this fragment as
  written here, and each planted copy above.
- **`FEET_STAY_LEVEL`** (§7) reads a `footwear` part on a bone that hangs from another. Here
  `shoes` rides `root`, so the line is not written: the shoe cannot turn.
- **`not_planted`** (*Declared requirements*) is not declared: the feet are planted, so the
  feet halves of `BREATH_VISIBLE` and `STILL_REGIONS_DARK` read `shoes` as they read any foot.
  A `stretch` requirement on `legwear` can only name leg links in its `held_by` (issue #321),
  since the mesh's `segments` are the two chains.
- **The exam's ankle reading** (rig-c/exam's grading, `on_her_feet`) takes, for each leg, the
  middle of `legwear`'s lowest vertices (its bottom 4 %, split into two legs at the widest gap)
  against the `shoes` vertex nearest it, and reads the largest change of that offset over the
  frames: at most 6.0 rig px. On `demo` with this recipe (contour `legwear`, exponent 2) and the
  same dance scaled to the figure (the hip ±18 px aside, 16 px down; `topwear` travels at least
  39.4 px from `shoes`), the build is `check: PASS; 11 of 11` and the reading is 2.2 rig px;
  with `exponent` 6 on `legwear`, 1.6. The same dance on `demo` as tracked, whose legs ride the
  hip, reads 18.36.

## 4. The command order

Two steps are external: the See-through runs (by any route; the optional `comfy seethrough` adapter is only a client for a ComfyUI box). Everything else is this tool.

**What the config holds at each step.** The config fills in as the loop runs, and
each step reads it through the loader for that point, which requires exactly what
the step reads. `src/config.ts` states it once (`CONFIG_REQUIRES`), the loaders take
their required keys from there, and the selftest compares this table with it
(`AS15`). Every loader refuses unknown and retired keys and checks `generation`
whenever it is present; a section a later step writes may already be there, and an
early loader does not read it.

| loader | steps | requires | the step also refuses without |
| --- | --- | --- | --- |
| `paint` | 0 `comfy paint` | `key`, `generation` | — |
| `layers` | 1 and 4 `inputs`, 6 `assemble --propose-plan` | `key`, `seethrough`, `assemble.rig_scale` | `seethrough.head_box`, for `--propose-plan` only (`ASSEMBLE_FIELD_PRESENT`) |
| `assemble` | 7 `assemble` | `key`, `seethrough`, `assemble.rig_scale`, `assemble.plan` | `seethrough.head_box` (`ASSEMBLE_FIELD_PRESENT`) |
| `full` | 8 `propose --from-config`, `propose --compare`, `compare` (a side that states a `key`), `rig`, 9 `build` | `key`, `assemble.rig_scale`, `assemble.plan`, `bones`, `meshes`, `regions`, `motion` | for `build`, the `assemble` row's too: its assemble stage reads through that loader after this one |
| `cloth` | 8 `propose --cloth` (issue #364) | `key`, `cloth` | every other key must still be one a config knows; only `cloth` is vouched for. Every other loader vouches for `cloth` too when it is present |

A missing field is `CONFIG_FIELD_PRESENT` naming it; a missing `generation` names
the fields the block holds, and a missing `assemble.plan` names
`assemble --propose-plan`, which prints one. `build` runs `rig`, so it asks the
full loader before its assemble stage writes anything.

0. **The painting (optional).** `rig-parts comfy paint --config config.json --out inputs --host <url>`
   generates `painting_<seed>.png` on a ComfyUI box; any other route to a painting
   skips this step and leaves `generation` out. Config: the `paint` row.
1. **The full image.** `rig-parts inputs --source inputs/painting.png --config config.json --out inputs`
   writes `st_input_full.png`, the painting centred on a white square of its longer
   side: white left and right of a portrait painting, above and below a landscape
   one. The pad is See-through's input only; `propose --head-box` and `assemble` map
   the full run back through it, so the rig stays in the painting's pixels — unlike
   a painting padded to a square by hand, whose padding becomes part of the rig.
   Config: the `layers` row, `head_box` not yet. A translucent painting is refused
   (`INPUTS_PAINTING_OPAQUE`).
2. **See-through, full run** (external).
3. `rig-parts layers inputs/layers/full` — read it. A refusal here is about the
   files, not the art (§6, *Reading the inputs*). A `WARN` line is about the art: a
   layer See-through made that is not plausibly part of the figure, which step 6
   leaves out (§6, *Plausibility*). It refuses nothing.
4. `rig-parts propose --head-box --full inputs/layers/full --canvas <W>x<H>` →
   `seethrough.head_box`. Run `rig-parts inputs` again: it now also writes
   `st_input_head.png`, the painting cropped to that box at its exact size.
5. **See-through, head run** (external), on that crop. See-through's own second,
   head stage does not replace it: that stage's layers are pasted back at the full
   run's scale on every route that was read (README *Getting See-through layers*),
   so the full run's eyes stay at its density — 22×13 px for reference-demo's right eye
   white at `resolution` 1024, against 60×38 px in the head run.
6. `rig-parts assemble --propose-plan --source … --full … --head … --config config.json`
   → paste `plan` and `extend_below_crop` into `config.assemble`. Config: the
   `layers` row, with `head_box`.
   Read `notes`: every layer not planned — each tag a layer of either run holds that no
   row takes — is named there once, `<tag>: in no plan row — …`, with why, run by run: the
   run holds no such layer; the proposer takes that tag from the other run only
   (`PROPOSE_HEAD_TAGS` in `src/assemble.ts` lists the tags it takes from the head run,
   and every other tag comes from the full run); the layer is empty, its opaque count (run
   pixels of alpha above 8 after ghost clean-up) below the proposer's floor of 150
   (`PROPOSE_MIN_PX`, `src/assemble.ts`); or it crosses a plausibility rule, and the
   layer's own note, last, gives its figures and the rule (§6, *Plausibility*; a layer
   only such a note leaves out is named by it alone). On the four examples the
   `neckwear`, `tail`, `wings`, `objects` and `eyewear` layers hold 62 to 74 px in each
   run, so each is named empty (or taken from the other run only). `nose` is never
   planned — the reference implementation's rule, which this port keeps; the reference
   records no reason — and its note gives both runs' counts and what a nose part buys:
   `propose`'s `head pitch:` note reads where the nose sits between the eye midpoint and
   the mouth only off a part tagged `nose`, so the note names the row to add,
   `["nose", "head", "nose"]` after the row that takes `face` (the run whose layer holds
   more of the nose). With that one row added to a copy of each config, `demo` reads
   0.474 and `scarf` 0.564 (the figures `FRONTAL_REFERENCE` in `src/propose.ts` quotes),
   and the recomposite moves by 2 error px on `demo` (14,570 to 14,568) and none on
   `scarf`, uncovered error px unchanged on both. A full-run layer holding a body
   no planned part covers — long hair that leaves the head crop sideways, or a
   head-run part that stops above the crop line so `extend_below_crop` continues
   nothing — is named with the body, the rule that skipped it and the two
   continuations (take the part from the full run, or add the full-run layer as a
   second part behind it). The plan is not changed; which continuation fits is
   yours.
7. `rig-parts assemble … --out work` — read its `uncovered hole` and `uncovered:` lines and look at
   `work/render/recomposite_error_rig.png` (§5): red is painting no part holds, which
   no later stage can see — then
   `rig-parts propose --parts work/rig --source inputs/painting.png --out work` →
   `work/proposal.json` and `work/render/landmarks.png` (+ `_head`). Copy
   each of `bones`, `meshes`, `regions`, `limbs`, `motion`, `constraints`, `turn` and `proposed_rig_scale` it
   wrote into the config: `limbs` is written only with `--keypoints`, `constraints`
   only with `--cloth` and `turn` only with `--full`/`--head` (`PROPOSAL_CONFIG_SECTIONS` in `src/propose.ts` is the list,
   and the selftest's `TY18` holds this sentence to it). A `limbs` block left out
   is refused at step 8 by the name of every part it cuts: `CONFIG_NAME_RESOLVES`
   on each limb part the meshes or regions attach, `CONFIG_PART_ATTACHED` on the
   layer it would have cut (`RL04`). Then read what
   was looked at. After the LINT summary, one `coverage <bone> [<role>]:` line
   per bone says `checked, clean` (and which checks read it), `checked, LINT`,
   or `not checked` and why — its role (a `control` binds nothing and may sit
   off the art by design; the role is `src/structure.ts`'s, as `compare`
   prints it), a single bone named as a segment or an explicit
   `[bone, from, to]` segment (the off-art check reads only chain links), a
   region, a mesh that names no part, a torso bone absent, a chain the joints
   declare no line for — and a `coverage:` summary counts the three apart.
   A `not checked` bone is one nothing verified: look at it on
   `landmarks.png`. `work/basis.json` (spec `spine-parts-basis/1`) says, per
   proposed bone, what its origin and its stated tip rest on: `joint` (which,
   with its state and score as the keypoint file declared them), `mask` (which
   part, which measure), `ratio` (which rule, which constants) or `derived`
   (which bones), and `fallback` when a rule stood a value in because what it
   reads was empty; `frame` says where the face box, the eye axis and line,
   the figure and the torso came from. A `ratio` bone or one with a
   `fallback` is a guess to check first. Add `--compare config.json` to have
   each bone also say whether the config's differs (origin, tip, parent, in
   px) or is `proposal only`, and `config_only` list the bones the proposal
   lacks. No confidence is computed. Config for
   `assemble`: the `assemble` row — no rig section yet, because this `propose`
   drafts them from the parts `assemble` writes.
   For a posed figure (seated, reclining), add `--keypoints keypoints.json` (and
   `--person <id>` when the file holds more than one person): the joints it gives
   place the neck, hip, chest and sleeves (§3, *A posed figure*).
8. Correct, then `rig-parts propose … --from-config config.json` to redraw the
   config's own bones and LINT them — every chain link against its mesh's art, and
   the single bones `hip` and `chest` against each other and the figure (a config
   without them prints a `note:` that those lines did not run); repeat until it
   prints no LINT line (exit 0). Add the same `--keypoints` to lint by the joints.
   Config from here on: the `full` row.
   `rig-parts compare --left work/proposal.json --right config.json` says what the
   correction changed, bone by bone: each origin, parent, tip, length and direction
   as its own figure, and the bones renamed, added or removed by name (§5). It reads
   no parts and no painting, and fails only on a bone a `--map` file's `required`
   list names that is missing (exit 1). A proposal is read under the loader's own
   rules for `bones`, `meshes`, `regions` and `motion`.
9. `rig-parts build --config config.json --source inputs/painting.png --full … --head … --out out [--loop]`
   — assemble, rig and check in one process. `propose` is not part of it, on purpose:
   a proposal is a draft, and the config you corrected is the input. How long it takes
   is §8 (the two reference examples, 12.7 s and 27.5 s wall clock on one machine): a
   run your harness stopped before its last line printed no verdict, which is not a
   failed build — the build's verdict is its `check:` line or a named refusal (§5, §6).
   `--idle-keys direct` is forwarded to the rig stage as `rig` takes it; a config
   with a two-bone ik over chain links the idle keys needs it (§3, `constraints`).
   Every flag `check` takes is forwarded to the check stage, taken by `build` as
   its own, or refused by name (issue #257; `CHECK_FLAGS_IN_BUILD` in
   `src/build.ts` is the one list, and the `cli` suite holds it to `check`'s own
   refusal): `--page-edges`, `--pack-shape`, `--requirements`, `--seam-pairs` and
   `--keep-stills` are forwarded, so `build --seam-pairs` writes the rows
   `check --seam-pairs` writes on the same rig; `--out` is `build`'s (the check
   writes under `<out>/check`); `--rig` and `--parts` are refused, because the
   check reads the rig and the parts the build wrote (`<out>/rig`, `<out>`);
   `--source` is the painting assemble reads and is not handed to the check, so
   `check.json` carries no `SETUP_POSE_VS_SOURCE` — run
   `rig-parts check --rig out/rig --parts out --out <dir> --source inputs/painting.png`
   for that line.
   `rig-parts compare --left config.json --right out/rig/rig.json` reads the rig
   the build wrote against the config it came from: the rig's stage carries it into
   rig px, so every origin reads 0, each chain link's tip, length and direction its
   config's, and every `<bone>_ctl` the rig stage inserted is the bone between a
   keyed mesh bone and its parent (§5).
10. **What a scene requires (optional).** When the motion a scene asks of the rig
    is known — a hand that stays on a cup, a sleeve that takes half an arm's turn, a
    joint that must stay inside a range — write it into a
    `spine-parts-requirements/1` file and hand it to `check` (or `build`):
    `rig-parts check --rig out/rig --parts out --out out/scene --requirements scene.json`.
    Every bar in it is yours; `check` supplies none, solves nothing and poses every
    frame through rig-c (§7, *Declared requirements*). A rig composed of
    several characters is measured the same way, `--rig` naming the composed spec.
11. **Several characters in one rig (optional).** Run steps 0–9 for each
    character on its own, isolated input, to a green `build`. Then write a
    `spine-parts-scene/1` file — the canvas, each character's build and offset,
    an optional background plate with its provenance, and the draw order between
    the characters' slots — and run
    `rig-parts compose --scene scene.json --out scene [--requirements req.json]`
    (§7, *Composing several characters*). Nothing in steps 0–9 changes for it, and
    nothing is inferred from the art: the order, the offsets and the plate's
    provenance are yours.
12. **A coarser mesh where it holds (optional, issue #265).** Once `build` is
    green, `rig-parts mesh-draft --config config.json --parts out --out draft`
    drafts, for every `grid` mesh, a traced outline around a coarse grid —
    `contour` at tolerance and margin T = max(1, round(H / 554)), `maxEdge` and
    `spacing` S = round(H / 37), H the height of the union of the parts' boxes,
    and `stray` when the part's only extra islands are dust (at most 4 px and
    0.1 % of its art). A part with a real second island (issue #326) is drafted
    per island — `bridges: true`, the islands joined into one outline by
    bridges, `stray` leaving out the dust — **only when every island is carried
    by the same bones**: every vertex of the part's lattice, as the rig stage
    weights it, is bound to one bone and the same one, so no piece moves
    against another and no bridge stretches. A part whose lattice binds two
    bones or more keeps its lattice, and its note names them; no two-bone join
    is drafted. A bridge covers no art: the part's `candidate.bridges` in
    `mesh_draft.json` gives each join's span and area and the share of the
    candidate's overdraw they draw (`overdraw`), and the five readings below
    read the bridged mesh as they read any candidate. Islands are read in a
    fixed order: dust first (`stray`, above); then **faint** islands — every
    pixel's alpha under 64 — are left out of the draft and the line names
    each (`LEFT OUT as faint`, its px, its brightest alpha, its box;
    `candidate.bridges.faint`): not meshed, so not drawn, and if those pixels
    matter to you, keep the lattice for that part; then every visible island
    is bridged, whatever its bridge costs — overdraw is reported, never a
    reason to drop art. On the public examples the faint islands a draft
    reaches peak at alpha 11–17 (demo `earring`'s 8, 2 and 1 px specks) and
    every visible one at 255. Each candidate is
    kept only where it holds against that part's
    lattice: every `check` bar that reads the part passes; within 1 rig px of
    the lattice over the idle; at the bend set (every chain link the part's
    segments name turned 15° about its joint, both ways) no more inverted
    triangles than the lattice and a worst sample within 10 % of the lattice's,
    both against a denser lattice of the same part; and no more triangles than
    the lattice. The lattice is your config's own `grid` entry — for meshes
    `propose` drafted, the figure's spacing (§3, `meshes.<part>`) — and is what
    a part that fails keeps. The gate is a judgment relative to that lattice,
    not an absolute quality: when the lattice coarsens, the reference moves with
    it (moving the examples from the part rule's lattices to the figure's, on
    #295, flipped nine readings with no candidate changed). With
    `--more-triangles` a candidate that holds the four motion readings is drafted
    even with more triangles than its lattice; `mesh_draft.json` then records each
    part's `delta` (triangles and overdraw), the trade the outline makes — fewer
    pixels drawn over transparency, at the cost of triangles. Every motion reading is rig-c's
    (`check`, and `compareMeshesInMotion` over three unpacked gate builds). It
    writes `draft/config.json` — your config's text with each drafted part's
    entry replaced, its `note` saying what it was measured against — and
    `draft/mesh_draft.json`, every part's readings, each with its margin to its line (`gate[].margin`: the value, the line and the percent inside it, negative past it). Your config is not touched:
    read the report and the pictures, then copy the entries you accept. A part
    that keeps its lattice is named with each reading it failed and by how much.
    The two divisors are calibrated on three figures of similar size (1106 to
    1185 px), and the bend set is a calibration, not your animation: a chain
    your animations or physics bend further than 15° a link was not measured
    there. An `auto` or `contour` entry is yours and is left as it is, and it
    is compared with nothing: a `NOT COMPARED` line and the report's
    `not_compared` name each such part, since which mode comes out smaller is
    measured, not named (§3, *Which mode comes out smaller*; issue #307). A
    relative `motion.animations_from` or `generation.control.skeleton` keeps its
    text, so it resolves against `draft/`; the command says so.

The selftest runs this order, with the README's flags, on each fetched example from
a config holding only `key`, `seethrough` and `assemble.rig_scale`, pasting each
proposal in as the steps above say (`RL01`); every step must exit 0.

### Counting the triangles before a build (`mesh-stats`, issue #566)

`rig-parts mesh-stats --config config.json --parts work/rig` prints the vertices and triangles of
every mesh the config states and their total, against the parts `assemble` wrote (step 7's
`work/rig`, or a `build --out` directory, which holds `parts.json` and `parts/` itself), in seconds.
It is the rig stage's mesh construction itself — the same function the rig stage writes
`mesh_report.json` from — run without rigc, without `check` and without writing a file, so a
config can be tuned to a triangle budget before the first build and between builds:

```
mesh-stats: hair_back — lattice 155 vertices, 226 triangles
…
mesh-stats: total 1816 triangles over 9 mesh(es)
```

(`demo` as tracked, nine lattices.) The package holds no triangle budget: a budget is the
consumer's, and the command prints no line against one. One line per mesh, in parts.json's
order, the row order of `mesh_report.json`; the mode is `lattice` for a `grid` entry,
`contour`, `auto` or `influence`. An `auto` part's count is its reduction's result: when rigc's
motion gate refuses that result, the rig stage replays an earlier accepted step, which needs
rigc, and the line says so. A problem the rig stage would refuse — a part with no PNG, an
outline that does not close, a name `bones` does not declare — is the rig stage's own refusal,
by the same name, exit 1; it takes no `--requirements`, because the rig stage's meshes read
none, and no `--idle-keys`, because where the idle's keys go moves no vertex.

### For artists: your own layered file (issue #359)

An artist's layered file is an input in its own right: you paint the figure in
layers, the tool reads them, and an agent does the data work. Nothing below asks
for See-through.

**What to paint.** One pixel layer per part, named by its tag. `rig-parts layers
--template art.psd --canvas <side>x<side>` writes a PSD holding one empty layer per
name the rig reads, bottom first: `back hair`, `neck`, `neckwear`, `topwear`,
`handwear-r`, `handwear-l`, `bottomwear`, `legwear`, `footwear`, `tail`, `wings`,
`objects`, `headwear`, `face`, `irides-r`, `irides-l`, `eyebrow-r`, `eyebrow-l`,
`eyewhite-r`, `eyewhite-l`, `eyelash-r`, `eyelash-l`, `eyewear`, `ears-r`, `ears-l`,
`earwear`, `nose`, `mouth`, `front hair` — 29 names: the 24 See-through tags
(`src/tags.ts`) less `head`, which upstream never emits and no stage reads, with the
six split tags as their halves, `-r` being the character's right (the smaller x).
The order is a starting stack, not a rule. Paint the layers the figure has and
delete the rest: an empty layer is refused (`PSD_LAYER_HAS_PIXELS`). A layer you
need that no tag fits is `author:<label>` (§5, *A layer the author made*).

- **The face, separated.** `face`, `eyewhite-r` and `eyewhite-l`, each painted, are
  what lets one file stand for See-through's two runs: the face box comes from
  `face`, the eye bones and the blink from the eyewhites. Without them the run is
  refused (`ASSEMBLE_SINGLE_RUN_FACE`, one line per tag missing).
- **The stacking order is the draw order**, bottom first. A PSD carries no depth,
  and none is invented: `layers` prints one `SKIP  depth:` line naming the file,
  and the turn draft (`propose --full`) skips it (`turn: SKIP`).
- **Flatten each layer.** Normal blending, 100 % opacity, no clipping layer, no
  layer mask, 8-bit RGB: each is refused by name (`PSD_LAYER_PLAIN` naming the
  layer and what it carries, `PSD_IS_RGB8`), because the composite it would make
  is not one the reader can see. Groups are read through (pass-through or normal
  blending only). A switched-off layer is refused too, except a hidden-art layer.
- **Small pieces.** A layer's pieces under 40 px, and under 1 % of its largest
  piece, are removed as See-through's specks (`GHOST_MIN_AREA`, `assemble`'s
  `ghost px removed:` line counts them), and `--propose-plan` leaves out a layer
  under 150 px (a note names it); both are in run pixels, so paint at the size
  the rig needs.
- **The canvas.** One run is one canvas, of any shape no side of which is above
  `seethrough.resolution` (`ASSEMBLE_RUN_CANVAS` otherwise: padding cannot shrink a
  file, so set `resolution` to at least the longer side). The painting — `--source`,
  the file flattened and saved as an opaque PNG — is the same size
  (`ASSEMBLE_SINGLE_RUN_SOURCE` otherwise). A file that is not the `resolution`
  square is padded to it before it is read, the way `inputs` pads a painting for
  See-through (issue #366): centred, each margin `floor((resolution - side) / 2)`,
  the odd pixel to the right or the bottom, the pad transparent. The rig holds no
  pad — it is the file times `rig_scale`, so a part's box over `rig_scale` is its
  box in the file — and `parts.json` records the pad in `single_run_pad` (§5); a
  `padded:` line under `one run:` prints the four margins. A 75 x 128 file at
  resolution 128 is padded left 26, right 27; a square file at the resolution is
  not padded, and its `parts.json` has no such block.
- **Hidden art.** A layer named `<layer>:hidden` — `handwear-r:hidden`, the forearm
  under the sleeve; `topwear:hidden`, the shirt under a scarf's tail — is that
  layer's art where something covers it. It is never drawn and never a part, and
  it may be switched off in the file. `assemble` reads it as the `under` of a cut
  of that layer's part (§3, `assemble.cuts`) and as the cap of a limb segment that
  takes that part (§3, *Limbs*), wherever the config names no file for them; a
  config that names one as well is refused (`ASSEMBLE_HIDDEN_ONE_SOURCE`), since
  reading either would be a guess. A cut of a part with hidden art is a cut with an
  `under`, so its piece is drawn in front of the part (`ASSEMBLE_UNDER_DRAW`
  otherwise), and a cut the hidden art holds nothing under fills 0 and says so. One `hidden art:` line per such layer names
  what read it, or says nothing did. Its name is the tag plus a suffix, so it
  needs no config field to say whose it is; a `:hidden` layer whose layer the file
  does not hold is refused (`LAYERS_HIDDEN_OF_PRESENT`).

**The commands.** The config holds no `seethrough.head_box`. Leave `--head` out
everywhere:

```sh
rig-parts layers art.psd
rig-parts assemble --propose-plan --source painting.png --full art.psd --config config.json
rig-parts assemble --source painting.png --full art.psd --config config.json --out .
rig-parts propose --parts rig --source painting.png --out .
rig-parts build --config config.json --source painting.png --full art.psd --out build
```

`--propose-plan` writes every row from the full run, and its first note says the
file was read as both runs; the assemble stage refuses a row that takes `"head"`
or an `extend_below_crop` entry (`ASSEMBLE_SINGLE_RUN_PLAN`), and prints `one run:`
under its first line.

**What you get back.** `parts/<name>.png` and `parts.json` (where every part came
from and what it measured), `rig.json` and `motion.json`, and from `build` the packed
atlas — `check/build/skeleton.json`, `.atlas` and `.png` — that a Spine runtime
loads, with `check/contact.png` and the idle frames to look at.

### The correction loop (issue #359)

A parse can be wrong: a patch painted into the wrong layer, two layers that should
be one, a split along a painted edge. An agent cannot edit a PSD, so the loop runs
on the wrapper form instead, which any image library edits:

1. **Export.** `rig-parts layers --export work art.psd` writes `work/layers.json`
   and one PNG per layer (`<index>_<name>.png`), drawn layers in draw order, then
   the hidden-art layers; `depth_median` is `null` throughout, which the reader
   takes as "the manifest's order is the draw order". The export is read back at
   once and must reproduce the file's reading — layers, boxes, pixels, order — or
   it is refused (`LAYERS_EXPORT_ROUND_TRIP`).
2. **Read.** `rig-parts layers work` (the table and its `WARN` lines),
   `assemble --full work …` (the part lines, `recomposite vs source`, the
   `uncovered hole` and `uncovered:` lines) and `render/recomposite_error_rig.png`
   (uncovered error red, covered error blue). A pixel in the wrong layer shows as
   error where that layer is drawn behind another part and the painting is
   near-white there (the seam override leaves near-white alone), or as `drift=`
   and `seam=` counts on the part drawn over it when it is not: projection and the
   seam override repaint that part to the painting's colour, so the error map
   stays clean while the part carries the wrong art.
3. **Fix** the PNGs and `layers.json`: move the pixels, and when a layer's art
   leaves its box, grow the PNG and the box together (`LAYERS_PNG_MATCHES_BBOX`
   otherwise).
4. **Re-run** from step 2 on `work`.

**A worked example** (the selftest's, `fixtures/artist.ts`): a 128-px file whose
right eyewhite was painted half into `back hair` — the 8 x 10 patch at
`[52, 22, 60, 32]`, near-white, behind the face. Assembled from the export:

```
recomposite vs source: mean |d|=0.40, within 8: 99.5%, error px > 40: 80, uncovered error px: 0
```

80 covered error pixels, blue on the error map, in one 8 x 10 block; the face's
part line says `drift=60`, the block's pixels inside the face's projection core
whose colour is more than 90 off the painting's. The fix:
in `work/00_back_hair.png` clear the block (it is `back hair`'s pixels
`(20..27, 18..27)`, box `[32, 4, 96, 48]`); widen `work/03_eyewhite-r.png` from
8 x 10 to 16 x 10, painting the block into its right half; and set that layer's
`right` from 52 to 60 in `layers.json`. Re-run: `error px > 40: 0`, the clean
file's figure, and every part is the clean file's but `hair_back`, which keeps an
80-px hole behind the face where the hair under the eye was never painted — every
one of them occluded, so nothing shows it at rest; paint it there if the face will
move off it (`AS245`).

## 5. After each stage: what to read

| stage | read | green looks like | a common red |
| --- | --- | --- | --- |
| `layers` | the table, then one `author-made: layer "author:<label>" — …` line per layer the author made (group `author` in the table; §5, *A layer the author made*), then the `WARN` lines | every tag the plan will need has opaque pixels; one `face` in the head run; `0 WARN line(s)` | a run whose layer PNG is not its box's size (`LAYERS_PNG_MATCHES_BBOX`); a `WARN  PLAN_LAYER_…` line (§6, *Plausibility*) |
| `sheet` of both runs | the tile list (and the sheet, if you can see) | eyes, irises, lashes and brows as left/right pairs in the head run | a head box that cut off an ornament: move `head_box`, re-run the head crop |
| `assemble` | one line per part — its counts (`op=` opaque, `vis=` visible, `src=` taken / candidates, `unproj=` visible but not projected, `drift=<n> (<p>% of core)`, `merged=`, `seam=`; *parts.json*, below). `drift=` is `refused_drift_px` in rig px and its share of the part's candidates, `projected_core_px`, which it is a subset of (issue #314); no bar reads either. On the four public examples the share runs to 94.5 % (`scarf` `hair_back`, 479 of 507) and the count to 26,472 (`scarf` `topwear`, 22.3 %), and the seam override repaints refused top-most pixels afterwards, so a large count says where See-through's colour was not taken, not that the part is unlike the painting: the `drift:` line below is the one that names a body of them another part holds. Then the `pixels:` totals (opaque = visible + occluded; taken; visible but not projected), then `recomposite vs source: mean \|d\|, within 8, error px > 40, uncovered error px`, then `uncovered holes (8-connected): N` and the largest five as `uncovered hole K: <px> px at x,y wxh (between "<part>" <px> px, …)`, then one `uncovered: <n> of the <N> uncovered error px lie on the full run's "<tag>", in a body of <px> px at x,y wxh; <the rule that left it out>` line per full-run layer the plan does not take from the full run whose uncovered error holds a body (5x5-opened, 8-connected, at least 150 full-run px in rig px), then one `drift: "<part>" refuses <n> px of <run>:<tag> (its colour more than 90 off the painting, max channel), in a body of <px> px at x,y wxh (…); by the plan's draw order "<holder>" holds <px> px of it (…), "<holder>" drawn in front of "<part>"` line per part whose drift refusals hold a body (the same opening and bar) that another part holds in the draw order — that layer is not what the painting shows there (none on the five public paintings), then, per subset alternate set, one `LINT set "<set>" <part>: <layer part> holds <n> islands (8-connected, alpha above 8)[, and <s> speck(s) under 1 % of the largest (<f> px), each with the island nearest it], kept the one under <joints> (<k> px), dropped <m> (<d> px)` line per limb part cut from a layer of more than one island when the set names one limb side of it (issue #588; issue #608: a joint taken to the nearest island reads `<bone> [x, y] (<e> px off it, within its cap's radius <r>)`, and a part that lost no pixel `dropped none`), then one `LINT set "<set>" <part>: <layer part> holds <limb> and <other limb> in one island (8-connected, alpha above 8), split by the nearest segment line at the set's bones: kept <k> px (<share>), gave <m> px (<share>) to <other limb>; <b> px in the overlap band (nearer one line than the other by 0.5 px or less) went to the limb drawn in front, <bk> kept and <bg> given` line per limb part cut from a layer of one island that a limb the set does not carry also takes (issue #609; k, m and b count the part's pixels above alpha 8, each share of the part's pixels before the split, 3 places) and one `LINT set "<set>" <part>: <n> px under <base part> excluded` line per subset alternate set's limb part and base part drawn over it that the set does not replace which took a pixel (issue #587, `assemble.alternates` above; none on the public examples, which declare no alternate set); and look at `render/recomposite_error_rig.png`. Between the part lines and the totals, one `author-made: part "<part>" (<run>:author:<label>) — …` line per part from a layer the author made (below, *A layer the author made*), then one `cut: "<part>" opaque <n> = "<part>" <kept> + "<piece>" <taken> …` line per part an `assemble.cuts` entry cut (below; it ends `; under <n> px filled, <m> px left empty` when a cut of that part has `under`), then — with `config.limbs` (issue #349) — one `limb cut: "<part>" opaque <n> = "<segment part>" <px> + …` line per part a limb takes and one `limb cap:` line per joint, its cap's pixels from the cap image, from the layer and missing, and its box (under `cap_shape: "ball"`, issue #579, then the lower half's pixels written, left as painted and missing), followed on a short cap by one `LINT "<part>" cap at [x, y] … short_px left <n>, right <m>: no layer gives them …` line (issue #557) — from the upper segment where it gave a pixel (under `cap_shape: "disc"` always), under `edge: "feather"` the pixels faded, under `cut_band` the line the cut was placed on and the stroke pixels it and the joint line cross (issue #360) (§3, *Limbs: cut at their joints*), then one `fringe pushed back: "<part>" <px> px, where the painting shows "<holder>" <px> px, …` line per part whose fringe was cleared (below) | on the examples: `reference-sample` 0.83 / 98.0 % / 4,359 / 1,185, 259 holes, the largest 94 px; `reference-demo` 2.34 / 95.8 % / 10,340 / 1,564, 453 holes, the largest 70 px (default rule) — many slivers along part edges, no hole a region could hide | one large hole: part of the figure is in no layer — a plan entry is missing, hair left the head crop sideways (reference-demo's `hair_back` is taken from the full run for that reason), or See-through split one garment into two and left the space between them in neither (a skirt as two trouser legs); the `between` parts say where. When neither run holds it at all, an `assemble.patches` entry cuts it from the painting (below) |
| `propose` | `note:` lines, `LINT` lines, the `coverage` lines, `landmarks.png`, `basis.json` | no LINT line: every chain link lies on its mesh's art, and the hip is below the chest and the figure's top quarter; the `coverage:` summary says how many bones that verdict covers — a `not checked` bone was read by no check (its line says why), and a `ratio` or `fallback` bone in `basis.json` is a guess | a link off the art (a bone on the background) — move it onto the layer; `LINT <link> at … runs to … N degrees off the head's down axis …` — a fringe link that does not lean with the head (§3, the fringe in the head's frame): move it along the lock it drives; `LINT <bone> under <parent>: amplitude <a> below the link above's <b> in the keyed chain …` — under `--cloth`, a keyed sibling the recipe left the only keyed child of its parent, which `CHAIN_LAG` would refuse (issue #572, §3 *A keyed sibling left behind*): raise the field it names to `<b>` or more in size; `LINT hairback_… on mesh '<part>' (side <r\|l>): <N> tree(s) for <M> visible hair mass(es) (mass 0 columns x=<minX>..<maxX>, y=<minY>..<maxY>; …)` — back-hair cloth trees whose count does not match the side's visible hair masses (`max(1, floor(w / (4 * grid)) + 1)` per mass) or whose link or tip leaves its mass's column range (issues #445, #461): omit `chains` on `cloth."back hair"` or draft trees per visible hair mass inside its columns; `LINT <a_limb> and <b_limb> on <part> (<from>) cross at [x, y] with no per-limb split: …` — two limbs sharing one layer cross in an X without a per-limb split (issue #446): declare `config.limbs.<covering>.split` (`{ "line": [[x, y], …] }` or `{ "edge": "painting" }`, §3 *Which limb*); `LINT foot_<s> at [x, y], the <s>_ankle joint and leg_<s>1's tip, lies on none of leg_<s>'s art within 1 px along its joint line (the nearest of it on that line is the pixel [x, y], D px from the joint): …` — an ankle keypoint off its leg's art on the line `assemble` sizes the ankle's cap by (issue #517): `propose` drafts every leg without its ankle cut, the shoe layer stays one part, and nothing is moved onto the art; move that ankle keypoint onto the leg's or the shoe's art and re-run `propose` (`(the line crosses none of it)` when no art lies on that line at all); `LINT stop on <chain> (<firstLink> at [x0, y0]) against <against> (at [ax, ay]) places <chain>_touch at [tx, ty], above <firstLink>'s root (rest R deg, \|rest\| + outward B deg): …` — a stop's contact point `<chain>_touch` lies above `links[0]`'s root in rig px or pushes `\|rest\| + outward` past `180°` (issue #447, §2 `stops`): stop against the descending limb bone below `firstLink`, set `links` to start at a link below `<chain>_touch`, or omit the stop on a rising limb; `LINT hip at [x, y] is not below chest at [x, y]: …` or `LINT hip at [x, y] is above 0.25 of the figure height (figure y T..B, so hip y must be at least L): a hip at the shoulders` — move `hip` down to the waist (and `chest` between it and the neck); a `hanging strand … -- no chain proposed` note — that strand hangs stiff until you add a chain down the x and rows it names (§3); a `no blink: …` or `blink without brows: …` note — the idle will not blink (or its brows will not drop), because no part came from an `eyewhite` (or `eyebrow`) layer; the note names the tags looked for; a `no eyewhite part for eye_<s> …` note — the iris and lash parts it names ride `head` and do not blink, because no `eyewhite-<s>` part made that side's eye bone: take the eyewhite from the other run, or keep them on `head`; a `no face part: face box derived from …` note (always the first) — `head`, `neck` and every face-height scale come from a box guessed off the hair and neck (§3): check `head` and `neck` on `landmarks_head.png` and move them; when it adds `the blink shuts the eyes over no face part`, read `BLINK_NO_HOLE` after `check` — an eye with no face under it can open a hole (the `reference-sample` with only its face removed: 587 px). Under `--keypoints`: the `lint rule set:` line first (joints, or screen and why), then the joint notes — `missing: the rule "…" placed bone X instead` is a bone still guessed; `not used — …` names why an arm's joints did not place its sleeve (for a wrist on no part, the nearest part and the `--wrist-snap` that would bind it); a `wrist snap: …` note is a wrist bound past 15 px by the flag — check that chain's tip on `landmarks.png`; a `one handwear part holds both wrists` note is two chains on one mesh — cut the part with `assemble.cuts` to separate them; `LINT chest at … is not between the neck joint …`, `LINT hip at … is not past chest …`, `LINT hip at … is nearer the neck joint …` and `LINT <chain><i> at … does not advance from <s>_shoulder toward <s>_wrist` are the joint-frame lines: move that bone between, past or along the joints they name |
| `compare` | one line per pair (origin, parent, tip, length, direction — or SKIP and why), then the per-row summary, the unmapped bones of each side, `required:`, each side's roles and the `controls:` line | proposal against the config you corrected: the rows you changed and no others. Config against the `rig.json` `build` writes for it: measured on both examples, every origin within 6.19e-7 px (the rig's offsets are written to 6 places) and every chain link's tip and length within 4.99e-4 px (`length` is written to 3), printed to three places as `0.000` (a signed figure as `+0.000` or `-0.000`); `parent … is the right's ancestor at depth 2, <bone>_ctl between` for every keyed mesh bone, no `DIFFERENT` and no `NOT MAPPED` | `parent DIFFERENT: left a, right b` — a bone hangs from another parent than the other side's; `frames not related` — a rig with no stage (`skeleton.width`/`height`), two configs at different `rig_scale`: the distance rows SKIP, so declare the frame in a `--map` file if the author knows it; `FAIL  STRUCTURE_REQUIRED_PRESENT` — a bone the map requires is missing through its pairs |
| `rig` (inside `build`) | one line per mesh: vertices, triangles, bones, influences, `cover`; the `bones` line; the `idle keys` line; then rigc's gate lines (with A15's declared SKIP under `--idle-keys direct`); in `rig.json`, each chain link's (or its `_ctl`'s) `length` and `rotation` | `cover 1.00000` on every mesh, both gate summaries `0 failed` (the compile and the packed pages); every link's `length` the distance to the next link and `rotation` its direction (Spine degrees, counter-clockwise, y up, local to the parent), every offset under it — a child bone's `x, y`, a weight's bind `x, y`, a region's `x, y` — in that turned frame, and a region on a link carrying `rotation` that turns it back upright. Nothing moved: `flattenRig` (`src/rig.ts`) turns every offset back and gives the unturned numbers | `RIG_LATTICE_ONE_LOOP`: change that mesh's `grid` |
| `check` (inside `build`) | the gate lines verbatim, the pack line, `loop:` (and `loop physics:` when the rig declares a physics constraint, §7), `seam:`, the six judgement lines, then — when `motion.json` holds an animation, the idle included — `ANIMATIONS_DO_NOT_FOLD` and one `folds` line per folding mesh, rigc's own (issues #320, #333), then — where a `footwear` part rides a bone that hangs from another — `FEET_STAY_LEVEL` and one `foot` line per such part (issue #348), then — when `parts.json` names a `handwear` part and there is an idle — `STRESS_OFF_CHAIN` (issue #347), then — where `parts.json` holds a limb segment's part — `LIMB_ONE_BONE` and one `limb` line per such part (issue #349), then — where a limb record carries a `range` — `SEAM_OVER_RANGE` and one `joint` line per joint and angle (issue #360), then `SEAM_OVER_MOTION` — a SKIP naming why on a rig that declares no neighbour pair, else the pairs read in every animation and one `WARN seam` line per pair and animation over the one-cell floor (issue #493, a warning and never a bar), then `CLOTH_SETTLES` — a SKIP naming why on a rig with no physics constraint, else the chains read and one `WARN chain` line per chain whose tip comes to rest before the idle's loop length (issue #501, a warning and never a bar), `RECOMPOSITE_HOLES` and, under `--source`, `SETUP_POSE_VS_SOURCE` (§7), `check.json`; the last line says how many of the bars measured — nine, ten with the fold bar, one more each with the feet-level bar, the stress bar, the limb bar and the range bar — and names the ones that said SKIP, then — where `SEAM_OVER_MOTION` read a pair — how many warnings it printed, `; N warning(s) (SEAM_OVER_MOTION, not a bar)` — with `CLOTH_SETTLES` named beside it, and N their sum, where the rig declares a physics constraint — which no bar counts | `check: PASS; 11 of 11 bar(s) measured, 0 skipped` on `demo` and `scarf`, whose sleeves each ride one chain; `check: PASS; 10 of 11 bar(s) measured, 1 skipped (STRESS_OFF_CHAIN)` on `reference-demo` and `reference-sample`, whose one `sleeves` mesh rides both sleeve chains (issue #347) — no example writes `FEET_STAY_LEVEL`, every shoe riding `root`; a judgement line SKIP only where the character lacks what it reads; on a rig spec with no `parts.json` or no `idle` (a merged rig, §7 *Measuring a rig rig-parts did not assemble*), PASS with the skipped bars named | `CHECK_SEAM_WITHIN_BAR` or `CHECK_LOOP_CLOSES` (§6); `CHECK_ANIMATIONS_DO_NOT_FOLD` — a clip turns a mesh over (§6); `CHECK_STRESS_OFF_CHAIN` — a sleeve weighted off its chain (§6); `CHECK_LIMB_ONE_BONE` — a limb part on a second bone (§6); `CHECK_SEAM_OVER_RANGE` — a joint that opens when bent (§6) |
| `check --requirements` (and `build --requirements`) | after the lines above, one line per declared requirement, `NAME: PASS`, `FAIL` or `NOT MEASURABLE — …` with its figures, the bar as declared and the worst frame; then `requirements: N declared — M measured (P PASS, F FAIL), K NOT MEASURABLE; not declared: <kinds>`; `check.json`'s `requirements` block, first its `file` record (issue #556); the renders under `requirements/` (§7, *Declared requirements*) — `build` reads `config.requirements` in place of the flag when it is not given | every line PASS and `0 NOT MEASURABLE`; a follow's `released_copy` says whether rigc's consumer-driven door was taken on the throwaway copy; a `stretch` line's `held_by` (issue #321), right after `worst`, names the bones the worst edge's two vertices hang on and their idle chains, in `CHECK_TEXTURE_STRETCH`'s words (§6) and by the same function, on a PASS as on a FAIL | `CHECK_REQUIREMENT_MET` (a figure past its bar; the line names the frame) or `CHECK_REQUIREMENT_MEASURABLE` (the quantity is undefined in the frames: a tip or an axis on a bone of length 0, an aim with no line, a follow no frame of which reaches its least drive); the last line then reads `check: FAIL — B bar(s) not met, R declared requirement(s) not PASS` |
| `compose` | the `[compose]` lines: one per character (its offset, its scale, its placed bounds, the shift and how many first-level bones, regions on `root` and weights bound to `root` it moved, its bone, slot, track and constraint counts, its `rig_scale` and idle), the declared order and the slot count it expands to, rigc's gate lines; then the `[check]` lines as for `check`, and `scene.json` | both gate summaries `0 failed`, `check: PASS` with the bars that measured and the ones that said SKIP named — on a composed rig `4 of 9`: the gate, the loop, `CHAIN_LAG` and `TEXTURE_STRETCH` (there is no `parts.json`; each character's own `build` measured all nine). `scene.json`'s `order.slots` is the order the compiled skeleton draws | a `SCENE_*` refusal (§6, *compose*) — the scene file, a build, or the order; `COMPOSE_RIGC_GREEN` — rigc's own line, quoted |
| `loop` (inside `build --loop`, or `loop --frames … --out …`) | the dropped-duplicate line, or, when the end frame is not frame 0, the jump line: its max \|d\| and px over 40, then why — under `build`, `the rig holds N physics constraint(s), and rigc's render starts every one at rest at frame 0` with the remedy `build --loop --lead-in <n>`, or `the rig holds no physics constraint, so the idle itself does not close` (`CHECK_LOOP_CLOSES`); under `loop --frames`, which reads frames alone, both causes (issue #325); under `build --lead-in`, the lead-in line in its place (the frames kept and the jump at the wrap); each file's line, then `loop: idle.png N B (lossless); idle-indexed.png N B (max …, mean …); idle.gif N B (max …, mean …)` | `f0048.png equals f0000.png byte for byte, so it is dropped` | `LOOP_ENCODE` (§6) |

`RECOMPOSITE_HOLES` is `REPORTED`, never judged, and its count reads large: for scale, the
four examples, each a green build, report 259 (`reference-sample`), 291 (`scarf`), 453
(`reference-demo`) and 1,020 (`demo`) uncovered holes, holding 1,185, 1,365, 1,564 and
2,939 uncovered error px, the largest hole 94, 63, 70 and 48 px (each example's
`expected/parts.json`, its `recomposite` block, in the repository) — hundreds of slivers
along part edges are what a green build reports; one hole of hundreds of px is the red
the `assemble` row above describes.

`loop` writes three files from one frame set, and they are not interchangeable.
`idle.png` (`loop --out x.png`) is the lossless APNG: every frame decodes to the
rendered frame byte for byte, so it is the exactness record. `idle-indexed.png`
(`loop --out x.png --palette`) is an indexed APNG — colour type 3, one palette for
every frame (255 median-cut colours and one transparent entry, alpha graded per
entry, no dithering, filter None) — and is the small file to show. `idle.gif`
(`loop --out x.gif`) is the same median cut in a GIF. The indexed APNG and the GIF
print their palette error, per channel over R, G and B of every frame (and alpha's
max for the APNG); a figure is a measurement of the file, not a bar. On the demo
(the README's animation since issue #224's follow-up: `build --loop --lead-in 3`), with
the breath of issue #270 (2.5 % of neck -> hip, 4.80 px peak to peak): 4,449,233 B lossless,
703,909 B indexed and 760,058 B GIF, both palette files at max 71, mean 0.636 (rig-c 2.45.2
and later, whose render no longer ends a frame on a physics step's tie; on rig-c 2.40.0,
4,446,263, 704,009 and 760,294 B at max 70, mean 0.631); on the
40-frame idle of issue #252 (rig-c 2.40.0, the breath 2.5 % of the topwear's height, 5.92 px):
4,514,756 B lossless, 725,845 B indexed and 784,074 B GIF, at the same error; on the 4 s idle before it
(rig-c 2.33.0): 5,148,992, 727,486 and 781,526 B at max 69, mean 0.630 — the two share one quantiser, so their error is the same by
construction and the size is the difference. From issue #227 until then, `build --loop`
with default flags, before the demo carried physics: 5,832,634, 827,857 and 889,063 B
at max 65, mean 0.879.

**`build --loop --lead-in <n>`** is for a rig with physics. rigc's render resets every
physics constraint at frame 0, so such an idle does not end where it starts: on the demo
(issue #224's strands, the tails at inertia 0.8) frame 0 and frame 48 of the 4 s idle differ by max |d|
132, 626 px over 40, and on its 40-frame idle (rig-c 2.47.1) frame 0 and frame 40 by max |d| 143,
914 px over 40; the plain loop keeps every frame and jumps at the wrap, and its line says so
with those figures, the count of constraints and this flag (issue #325) — while `check`'s
`loop:` line, read with the constraints left out, says max |d| 0 and that they were left out. With `--lead-in n` the build
renders the idle played n + 1 times back to back (`idle_lead_in`, the build's other
animations kept so the viewport is fitted as for the idle frames), keeps the last
period, drops its end frame (the next period's first) and prints how far that end frame
is from the first kept one — the jump the loop will show. The settling is the rig's, not
a constant: on the demo's 4 s idle, `--lead-in 1` and `2` each still read max |d| 117, 305 px over 40, and `3` reads max 1, 0 px over 40; on its 40-frame idle (issue #252, a shorter period and a breath twice as far), `3` reads max 1, 0 px over 40 (max 7 before rig-c 2.45.2, whose render no longer ends a frame on a physics step's tie). The idle
must repeat without an invented value — every track keyed from 0 to the duration, ending
where it starts — or the build refuses it (`LOOP_LEAD_IN_IDLE`). `check` and its bars
read `check/idle_frames/` as before; only the loop files move. On reference-demo with `--seam silhouette`
(the README's animation until issue #227, rig-c 2.1.3, and 2.10.1 to the byte):
13,645,503 B lossless, 1,706,719 B indexed and 1,812,288 B GIF at max 57, mean 1.601;
with `--pack-shape rect` the same build writes 13,645,350, 1,706,520 and 1,812,238 B,
and with `--page-edges pot --pack-shape rect` 13,645,519, 1,706,785 and 1,812,625 B,
all at the same error (2.10.1 reproduces both). The loop shows the blink closed: the
eyes' hold is at least one 12 fps frame (below), so whatever `motion.blink.t` is, one
idle frame lands inside it, and `check.json`'s `BLINK_NO_HOLE.idle_frames_closed`
names it — `[29]` on the two reference examples and on the demo.

`--seam near-white` (the default) is the reference implementation's rule: where the
flat stack of parts differs from the painting by more than 60, the top part takes the
painting's colour — except where the painting is near-white, which protects the page
and also every white garment. `--seam silhouette` protects near-white pixels only
outside the figure. On reference-demo it lowers recomposite error pixels from 10,340 to
8,644 (`assemble`'s `error px > 40`, at v1.5.2); on reference-sample it changes nothing
(4,359 under both). At v0.14.0 reference-demo's were 11,050 and 9,540, and no check bar
changed. The default stays
the reference's so the examples stay comparable with it.

**The fringe push-back** (issue #119; under either seam rule, no flag). Both places
that write the painting's colour into a part act only at alpha 250 and above, so a
part's anti-aliased fringe in another garment's colour — a scarf's red left on the
edge of a sweater layer, over the sleeve — reaches the rig as See-through drew it,
and `check`'s seam cannot see it (it compares the setup pose with the same parts).
Before the seam override, `assemble` clears a part's pixel when the stack there
differs from the painting by more than 60 (the seam override's own test, and its
rule's near-white guard), the part is drawn after the pixel's holder — the top-most
part at alpha 250 or above — and the holder's own colour is within 60 of the
painting's: the painting shows the holder there, so the pixel is the holder's to
draw. A pixel nothing holds stays (clearing it would open the page), and so does one
over a holder in another colour (clearing it would hand the holder the front part's
colour). The clearing never splits a part's art: a crumb it cuts off is cleared too,
and a cleared bridge to opaque art is put back, so no part gains an island
(`CONTOUR_ONE_ISLAND` reads the islands it read before). `parts.json` records each part's cleared pixels by holder
(`fringe_pushed_back`), the counts in it are taken after, and the assemble line above
names them. On the examples (default flags, measured against the v0.14.0 build of
the same inputs): `reference-demo` 1,193 px over 16 parts, recomposite error pixels 11,050 →
10,340; `reference-sample` 276 px over 15 parts, 4,512 → 4,359; uncovered error pixels and
holes unchanged on both, `check` 9 of 9 on both. The `--project` comparison in
this section and the `SETUP_POSE_VS_SOURCE` example figures in §7 were measured
before it, at v0.14.0; the `--seam` figures above are v1.5.2's.

**Page edges.** `rig`, `check` and `build` pack through `rigc build --pack
--page-edges <v>`, and hand the value to rigc verbatim. The default is `free`,
the least-area page the parts need. `--page-edges pot` is the opt-out: a power of
two on both edges, which is the page every build wrote before this flag. The pack
line says which one ran, because rigc writes `, page edges free` after the padding under
`free`. Measured on the two examples by `tools/atlas_population.ts` with rigc 1.5.1, and
again with rigc 2.0.3, 2.1.3 and 2.10.1 under `--pack-shape rect` (the frames table
by the same idle render), which reproduced every figure in both tables and the one
check figure below (2.10.1: pages, atlases, idle frames and `check.json` byte-identical
to 2.1.3's):

| build | page | covered | page opaque | page / figure |
| --- | --- | --- | --- | --- |
| reference-demo, `pot` | 1024x2048 | 56.3 % | 36.8 % | 2.651 |
| reference-demo, `free` | 967x1338 | 91.2 % | 59.7 % | 1.636 |
| reference-sample, `pot` | 512x2048 | 49.7 % | 28.7 % | 3.294 |
| reference-sample, `free` | 479x1166 | 93.4 % | 53.9 % | 1.755 |

rigc's help states the cost: *"a smaller page, at the cost of region attachments
sampling within 1 LSB of the loose build rather than exactly"*. On these builds
every one of the 49 idle frames differs from the `pot` build, by at most 1 level
in any channel:

| example | idle frames that differ | pixels that differ (all 49 frames) | max \|d\| |
| --- | --- | --- | --- |
| reference-demo | 49 of 49 | 2,373 | 1 |
| reference-sample | 49 of 49 | 651 | 1 |

Only one check figure moved. It had no bar: reference-sample's reported screen-space face
mean in `STILL_REGIONS_DARK`, 11.475 under `pot` and 11.472 under `free` (a pixel
figure the line no longer reports since issue #123; it reads geometry, which the page
does not enter). Every
barred figure and every status is the same under both. The atlas rigc writes says
`filter: Linear, Linear` and has no `repeat` line, so choose `pot` for a consumer
that mipmaps or repeats the page.

**Pack shape.** `rig`, `check` and `build` also hand rigc `--pack-shape <v>`
verbatim (rig-c 2.1.0 and later). `rect` keeps every region's cell apart, the
only packing before 2.1. `polygon`, the default here (rigc's own is `rect`), packs a
region that only meshes draw by its emitted hull, so a neighbour may sit inside its
rectangle where the hull is not, with the padding kept between footprints; a region
attachment stays its rectangle. rigc gates the result on the packed pages with
`A49_PACKED_FOOTPRINTS_DO_NOT_OVERLAP` (SKIP on the compile pass, where every part has
its own page; PASS on the packed pass, both shapes, both examples). The pack line ends
`, shape rect` or `, shape polygon` under either, and `check.json`'s `pack_mode` records
both flags. Measured on the two examples with rig-c 2.1.3, and again with 2.10.1,
whose pages, atlases, idle frames and `check.json` are byte-identical to 2.1.3's under
both shapes and both edges (the full entry, spine-core 4.3.13 beside it),
`rig-parts build` with `--page-edges free` and each shape, the table columns by
`tools/atlas_population.ts`:

| build | page | page area | covered | page opaque | page / figure |
| --- | --- | --- | --- | --- | --- |
| reference-demo, `rect` | 967x1338 | 1,293,846 | 91.2 % | 59.7 % | 1.636 |
| reference-demo, `polygon` | 922x1348 | 1,242,856 (−3.9 %) | 95.0 % | 62.1 % | 1.571 |
| reference-sample, `rect` | 479x1166 | 558,514 | 93.4 % | 53.9 % | 1.755 |
| reference-sample, `polygon` | 477x1151 | 549,027 (−1.7 %) | 95.0 % | 54.8 % | 1.725 |

Covered is Σ region rectangles over page area, as rigc prints it; under `polygon` the
rectangles may overlap where a hull leaves room, so it is not a union and can exceed
100 %. Page opaque is the measure of what the page holds. Under `--page-edges pot` the
shape changes nothing on these two examples: both shapes write 1024x2048 and 512x2048,
and the idle frames are identical.

The cost, from `rect` to `polygon` (the idle `check` renders, `rigc render --animation
idle --fps 12 --max 640`, compared frame by frame, max over R, G, B and A):

| example | idle frames that differ | pixels that differ (all 49 frames) | max \|d\| |
| --- | --- | --- | --- |
| reference-demo | 49 of 49 | 2,594 | 1 |
| reference-sample | 49 of 49 | 740 | 1 |

That is the class `free` already costs (the table above, measured by the same
comparison), a little larger. No figure in `check.json` moved but `pack_mode`: every
bar, every status and every reported figure is the same under both shapes.
`--pack-shape rect` gives back the page and atlas 0.7.0 wrote: on both examples
they are byte-identical to rigc 2.0.3's `--page-edges free` build of the same rig (the
skeleton JSON differs only in its relative `images` path), and selftest `CK53` holds
`rect` to rigc's own rectangle page.

The hull ceiling (rig-parts #58: hull area over rectangle area, 0.812 on reference-demo and
0.814 on reference-sample) is not what the packer realises here: the hollows inside the meshes'
rectangles are worth only what fits into them. On the polygon pages, read off the
atlas, reference-demo's packed rectangles overlap in 21 pairs (17 a region attachment inside a
mesh's rectangle, 4 a mesh inside another's) and reference-sample's in 12 (10 and 2); no two
region attachments overlap. Meshes in place of regions would be rigc's stage 2 of
polygon packing (firejune/rigc#1093), which rigc measured and folded: on the three
production rigs most favourable to it, it adds 0.15 % of the rectangle area over
stage 1 at tolerance 0, and nothing at the mesher's tolerance 1 or under `pot`; on
these two examples −0.3 to −1.3 points. No build converts a region attachment.

Which layer of a run owns a pixel — the one that may take the painting's pixel there
— follows the plan: where two planned layers of one run are both opaque (`alpha >=
250`), the one the plan draws in front owns it, whatever See-through's depth says
(issue #255). A layer no plan entry takes keeps its depth: where it is in front, the
painting shows a layer the rig does not draw, and no planned part takes that pixel.
The proposer writes each run's parts in depth order, so on a proposed plan the two
agree; they differ only where an author reorders the plan, and on the five public
paintings no pixel changes owner.

`--project core` (the default) is the reference's projection rule: a layer takes the
painting's pixel only inside its top-most `alpha >= 250` area eroded by a 5x5 square,
so a part a few pixels wide (a lash, a brow, an iris) takes none. `--project visible`
keeps the erosion only along a rim where a layer of the run in front owns the pixel, and
takes every other top-most `alpha >= 250` pixel; neither rule takes a fringe pixel
(alpha below 250). On the examples it lowered the pixels that are visible but not
projected from 36,227 to 22,476 (`reference-sample`) and 76,801 to 49,672 (`reference-demo`), recomposite
error pixels from 4,512 to 4,116 and 11,050 to 9,820, and the check seam from 0.207 to
0.206 and 0.326 to 0.325, with no other check figure changed. The default stays the
reference's so the examples stay comparable with it. `build` takes both flags.

**`rig --idle-keys ctl|direct`** (and `build --idle-keys`, which forwards the
value to its rig stage; without the flag, or with `ctl`, a build writes and prints
what it did before `build` took the flag). rig-c's `A15_IDLE_NO_MESH_BONE_KEYS`
(profile `rig-play`, named `spine-html` before rig-c 2.50.0) refuses an idle that
keys a bone a mesh is weighted to. `ctl` (the default, the reference's answer) gives every such bone a same-origin
`<bone>_ctl` parent and moves its keys there, which passes A15 on any rig-c;
the stage prints `idle keys ctl: N mesh-driving bone(s) keyed …`. `direct` keys the
bones themselves and writes `invariants.idleDrivesMeshes: { "why": … }` into
`rig.json` (rig-c 1.3.0 or later), so A15 reports
`SKIP  A15_IDLE_NO_MESH_BONE_KEYS: declared by the rig (…): idle keys N bone(s) that
drive M mesh attachment(s) totalling V vertices …`, which the stage prints; with no
mesh-driving bone keyed it declares nothing, because rigc refuses a declaration
that switches nothing off. The two write the same slots, skins and keys (`RG18`).
Measured on the examples with `bun tools/idle_cost.ts` (rig-parts #13): `direct`
has 41 bones for reference-demo's 72 and 32 for reference-sample's 56; every shown mesh moves on
every idle frame under both (8 of 8 and 6 of 6, so 0 a dirty-skip renderer could
skip); the pose costs 14.8 against 15.3 us per frame (reference-demo) and 8.3 against 8.8 us
(reference-sample), the difference all in `updateWorldTransform`; the rendered idle frames
differ by at most one level in a channel. The default stays `ctl`: the examples'
`expected/rig.json` and `motion.json` are the reference's output, and the
declaration is in the rig spec only, so `rigc validate <build> --profile rig-play`
run on a `direct` build (it has no rig spec to read) refuses A15 once per keyed
bone. No stage runs `validate`: the gate is `rigc build`, which reads the rig spec
and its declaration, and is green on both (`RG19`).

**Patching a hole no layer holds.** When an `uncovered hole` stays large after the
plan is right — both See-through runs dropped a piece of the figure, red in
`recomposite_error_rig.png` — add an `assemble.patches` entry:
the box round the hole in rig pixels, `alpha: "silhouette"` so the page round the
figure is not taken, and a `regions.<name>` bone. Draw it `"back"` (or
`{"before": …}` the part it belongs under) and let the box **reach under its
neighbours**: on the selftest's hem fixture a box that only abutted them raised
`check`'s seam from 0.323 to 0.86 with 16 px over 40, and one reaching two rows
under each measured 0.267 with none [observed] — two regions that merely meet
leave a resampled edge between them in the render. The patch is config, so every
`build` cuts it again; it is never a file added after the build. Re-run `assemble`
and read `uncovered error px` again: a patch covering `n` of the uncovered error
pixels lowers it by exactly `n` (the selftest's `AS17` plants that and counts it).

**Cutting a piece out of a layer.** When one See-through layer holds two things that
must move apart — a scarf end painted into the sweater's `topwear`, both arms in one
`handwear` — add an `assemble.cuts` entry (§3): open `rig/parts/<part>.png` from an
earlier `assemble`, add its `parts.json` `x`, `y` to a pixel's column and row to get
rig pixels, and draw the polygon round the piece. The stage prints, between the part
lines and the `fringe pushed back` lines, one line per cut part in the `pixels:`
line's shape, counted when the cut is made (before the fringe push-back and the seam
pass, which the records are counted after):

    cut: "topwear" opaque 134452 = "topwear" 118973 + "scarf" 15479; band 593 px held by both

A part a limb takes may be cut too — the shoe's top painted into `legwear`, cut below the
ankle so the shin does not hold it — where no segment of the limb holds the pixels; the `cut:`
line then names the joint the piece lies past and the bone of the segment there (§5, *Limbs*,
*A cut from a limb's layer*, issue #564).

Give the piece a `meshes` entry over the bones that should carry it, and take those
bones out of the part it left: on the public `scarf`, the scarf end `robe_r` runs down,
cut out of `topwear` into its own mesh on `robe_r` (and `robe_r` dropped from `topwear`'s
segments) leaves every `topwear` vertex still at wind 6 where the uncut mesh moved
one by 101.5 px [observed, `docs/evidence/scarf-cut.png`]. Where the cut runs through
opaque art, `overlap` decides the seam: at 0 the pieces abut, each edge is resampled
against transparency, and on that cut the seam bar read 170 px over 40 against 50
allowed (`CHECK_SEAM_WITHIN_BAR`); at 1 it read 8, at 2 it read 3, at 4 it read 2
(the uncut build reads 2) [observed]. Those four readings drew the piece behind
`topwear` (`{"before": "topwear"}`); drawn in front of it (`{"before": "brow_r"}`,
the plan part after `topwear`), as the setup pose asks, the same cut reads 26 px over
40 at `overlap` 1, 8 and 16 alike, 24 of them along the cut line, which a wider band
does not reach (§7, *seam*) [observed, issue #202].

A band covers the edge at rest; when the piece swings clear, the layer has nothing
where it was. `under` (§3) is the author's image of what lies there, in rig pixels
over the polygon's bounding box: `from` takes it where the cut removed its pixels and
the image is at least as opaque as the layer was, a transparent pixel leaves its pixel
empty (nothing lies under it), the piece must be drawn in front of `from`
(`ASSEMBLE_UNDER_DRAW`), and the `cut:` line counts both, so an unintended hole is a
number in the log:

    cut: "topwear" opaque 134452 = "topwear" 118973 + "scarf" 15479; band 593 px held by both; under 3991 px filled, 11079 px left empty

That is the scarf cut (overlap 1, the piece drawn `{"before": "brow_r"}`) with an
80x540 image of each row's nearest `topwear` pixel outside the polygon, down to row
681 and transparent below it; `check` passes with the seam bar at 26 px over 40, as
without the image [observed, `docs/evidence/scarf-under.png`]. Whether the sweater
continues under that scarf end at all is the author's call: continued as a line from
its edge just above the polygon (x 306) to its edge at its hem (x 316, row 681), its
outline lies right of every removed pixel, and an image of only that silhouette fills
none of the 15,070 — `ASSEMBLE_UNDER_EMPTY` [observed]. Producing the image is the
author's.

**A layer the author made** (issue #256). A cut covers a piece one polygon over a
planned part can take. When the piece is a layer you made by hand outside the tool — a
hand laid over a hip, taken out of `handwear`; a loop of hair over a shoulder, taken
out of `back hair` — add it to the run it belongs to and name it `author:<label>`: in
the wrapper form an entry in `layers.json` (its `depth_median` places it in the run's
draw order) and its PNG, in a PSD a layer of that name. `<label>` is yours, and must be
a part name with no colon (not empty, not starting with `.` or whitespace, not ending
with whitespace, no slash or backslash); a run holds each name once. It is not a
See-through tag, and every stage says so: `layers` prints it in the group `author` and
adds one `author-made: layer "author:<label>" — …` line; `--propose-plan` drafts it
from the run that holds it, at its place in that run's draw order, as the part
`<label>`, with a note (one both runs hold is drafted once, from the full run, and the
note says how to take the head run's too); `assemble` records it as
`<run>:author:<label>` in `parts.json` and prints one `author-made: part "<part>"
(<run>:author:<label>) — …` line after the part lines; and `propose` gives it no role
— no rule reads it, it rides the nearest trunk bone as a region, and the note says the
bone is `regions.<part>`'s to name (or give it a mesh in `meshes`). Its draw position is
its place in `assemble.plan`, like any part's.

Do not borrow an unused See-through tag for it instead (`tail`, `wings`): `layers`
prints it as a body layer, `parts.json` records it as See-through's `tail`, and
`propose` reads it as a tail — a role the part does not have (selftest `AS229`).

`parts.json` holds one record per part, in **assembled** draw order: the plan's, with each patch
and each cut's piece where its `draw` puts it (`"back"` patches first in their own
order, then `"back"` pieces; each `{"before": X}` patch, then each such piece,
immediately behind `X`; `"front"` patches last, then `"front"` pieces). This is also the
recomposite order. The final rig locally gathers exclusively bound limb riders into
their existing segment blocks as described above; assembled `front` does not mean
global final-slot front when that closure moves a rider. Its counts:

| field | counts |
| --- | --- |
| `opaque_px` | the part PNG's pixels with alpha above 8 |
| `visible_px` | of those, the ones no later layer of their See-through run is opaque (alpha >= 250) in front of — a pixel copied in below the head crop is judged in its extend layer's run |
| `occluded_px` | the rest of `opaque_px`: art the painting does not show, See-through's synthesis by necessity |
| `projected_core_px` | the projection rule's candidates: top-most `alpha >= 250`, eroded (`core`) or kept off a front rim (`visible`) |
| `source_px_taken` | of those, the ones that took the painting's pixel (the reference's count, before any merge) |
| `visible_not_projected_px` | visible pixels whose colour did not come from projection — too thin for the core, a fringe, a rim, refused for drift, or a merge ring |
| `refused_drift_px` | candidates refused because See-through's pixel and the painting's differ by more than 90. On top-most pixels the seam override repaints refused pixels afterwards, so the field is not a count of pixels left unlike the painting: measured on scarf's `topwear`, 24,944 of 26,472 (issue #255) |
| `merged_px` | pixels brought in below the head crop, and the ring that closes their seam |
| `seam_override_px` | pixels the seam pass recoloured to the painting |

A part's `from` is `<full|head>:<tag>` — the See-through run and tag, which every
role (`propose`) and every judgement-line region (`check`) is read from — or, for a
patch, `painting:<its own name>`; a cut's piece carries the `<run>:<tag>` of the part
it was cut from, so two records may share one, and names that part in `cut_from` (issue
#230; written on a piece only). The records are in draw order, so a piece drawn `"back"`
or before its base comes first, and only `cut_from` says which of the two the cut made.
The reader refuses a `cut_from` that names no part of the file, the piece itself, another
piece, or a part on another layer (`PARTS_CUT_FROM_KNOWN`). A `parts.json` written before
1.6.0 has no `cut_from` and still reads; `propose` alone refuses it when two of its parts
share a layer (`PROPOSE_CUT_FROM_RECORDED`): re-run assemble. **A patch is 100 % source**: every pixel is the
painting's, so it is all visible and all taken — `visible_px`, `projected_core_px`
and `source_px_taken` equal `opaque_px`, and `occluded_px`,
`visible_not_projected_px`, `refused_drift_px` and `merged_px` are 0. The reader
refuses a `painting:` record that says anything else, or that names another part
(`PARTS_FROM_KNOWN`, `PARTS_COUNTS_ADD_UP`). No tag rule reads a patch: `propose`
puts it on the nearest trunk bone as a region with a note, and `check` counts it
in no region. No tag rule reads a cut's piece either (issue #230): its base already took
the tag's rule, and a rule that runs once per part of a tag would name the base's bones
and chains a second time, so the piece rides the nearest trunk bone as a region with a
note saying so — give it a mesh in `meshes` if it should bend. The one exception is the
sleeve rule, which names its chains by side and takes a cut sleeve as a blob of its own
(the `one handwear part holds both wrists` note, §3).

With one run whose file is not the `seethrough.resolution` square (issue #366, §4
*For artists*), `parts.json` ends with a `single_run_pad` block: where the file sat on
the square it was read on. Two runs and a file that is the square write none.

| field | holds |
| --- | --- |
| `file_size` | the file's `[w, h]` — the painting's too |
| `side` | the square's side, `seethrough.resolution` |
| `left`, `top` | the margins, `floor((side - w) / 2)` and `floor((side - h) / 2)`; the right and the bottom take the remainder |

Run pixel `(x, y)` is file pixel `(x - left, y - top)`, and a part's box over
`scale_rig_per_source` is its box in the file. The reader refuses margins that are not
that centring, a file larger than its square or equal to it, and a `rig_size` that is
not `file_size` times the scale, truncated (`PARTS_SINGLE_RUN_PAD`).

`visible_px + occluded_px = opaque_px`, and every projected pixel is visible; the stage
refuses (`ASSEMBLE_COUNTS_ADD_UP`) rather than write counts that break either, and the
reader refuses a record that breaks them (`PARTS_COUNTS_ADD_UP`). The three visibility
counts are this port's: a `parts.json` the reference wrote has none of them and still
reads, but a record with only some of them is refused. The `pixels:` line after the
per-part lines prints their totals.

After the records, `parts.json` holds a `recomposite` block (this port's too; the
reference's files have none and still read): the flat stack of every part, composited
on white in plan order, against the painting resampled into the rig.

| field | holds |
| --- | --- |
| `mean_abs` | mean over pixels of the mean-channel \|d\|, to 3 places |
| `within_limit`, `within_share` | the share of pixels (to 4 places) whose mean-channel \|d\| is at most `within_limit` (8) |
| `error_limit`, `error_px` | pixels whose max-channel \|d\| is above `error_limit` (40) |
| `covered_alpha`, `uncovered_error_px` | of those, the ones where no part has alpha above `covered_alpha` (128) |
| `hole_count` | the 8-connected components of the uncovered error pixels |
| `holes_listed`, `holes` | the largest `holes_listed` (5) of them, largest first (ties: top row, then left column), each `{px, x, y, w, h, borders}`: its area, its box in rig pixels (y down), and every part with a covered pixel 8-adjacent to it, as `{part, px}` — how many such pixels it covers — most first, then plan order; `borders` is empty for a hole that touches no part |

The areas of every hole sum to `uncovered_error_px`; the reader refuses a block whose
figures disagree (`PARTS_COUNTS_ADD_UP`), whose holes are not largest first
(`PARTS_HOLES_LARGEST_FIRST`), whose box leaves the rig (`PARTS_BOX_INSIDE_RIG`) or
whose border names no part of the file (`PARTS_HOLE_PART_KNOWN`).

`recomposite_error_rig.png`, beside `recomposite_rig.png` (`render/` under `assemble
--out`, the top of `build --out`), is the same measurement as a picture at rig size:
**red** (255, 0, 0) is an uncovered error pixel — painting that no part holds;
**blue** (0, 0, 255) a covered error pixel — a part there, in a colour more than 40
off; every other pixel is the painting in light grey (`192 + luma / 4`, so 192 to
255). The painting is dimmed rather than dropped so a hole reads against the figure it
falls in at contact-sheet size, and grey so no painting pixel can be either flag
colour. Opaque, and the same bytes on every run.

## 6. Refusals: the rule, and what has to change

Every refusal is `FAIL  RULE: object — detail (see rig-parts guide RULE)`, and the
command at the end prints the rule's row below. Inside `build` it is printed under the
stage's prefix (`[assemble]   FAIL  …`), and the build stops there. A line that quotes a
rigc failure (`RIG_RIGC_GREEN`, `CHECK_RIGC_GREEN`) keeps rigc's own pointer inside the
quote, and this package's goes after it. Every rule the source can print has exactly one
row in this page's `rule` and `line` tables; the selftest holds that (`TY16`).

### Reading the inputs

| rule | means | change |
| --- | --- | --- |
| <a id="LAYERS_INPUT_KIND"></a>`LAYERS_INPUT_KIND` | the path is neither a directory with `layers.json`, a `layers.json`, nor a `.psd` | the `--full`/`--head` path |
| <a id="LAYERS_MANIFEST_PRESENT"></a><a id="LAYERS_MANIFEST_IS_JSON"></a><a id="LAYERS_FIELD_PRESENT"></a><a id="LAYERS_KEY_KNOWN"></a>`LAYERS_MANIFEST_PRESENT`, `LAYERS_MANIFEST_IS_JSON`, `LAYERS_FIELD_PRESENT`, `LAYERS_KEY_KNOWN` | the wrapper's `layers.json` is missing, unparsable, or not the wrapper's shape | the run's output directory; re-export it |
| <a id="LAYERS_PNG_PRESENT"></a><a id="LAYERS_PNG_UNAMBIGUOUS"></a><a id="LAYERS_PNG_DECODES"></a><a id="LAYERS_PNG_MATCHES_BBOX"></a>`LAYERS_PNG_PRESENT`, `LAYERS_PNG_UNAMBIGUOUS`, `LAYERS_PNG_DECODES`, `LAYERS_PNG_MATCHES_BBOX` | a layer's PNG is missing, found in two places, not a PNG, or not its box's size | the run's files |
| <a id="LAYERS_TAG_KNOWN"></a><a id="LAYERS_NAME_UNIQUE"></a><a id="LAYERS_BBOX_INSIDE_CANVAS"></a>`LAYERS_TAG_KNOWN`, `LAYERS_NAME_UNIQUE`, `LAYERS_BBOX_INSIDE_CANVAS` | a layer name that is neither a See-through v3 tag nor `author:<label>` (or is `author:` with a label that is empty, starts with `.` or whitespace, ends with whitespace, or holds a slash, backslash or colon — the detail says which), a repeated name, a box off the canvas | the run (these are See-through's own outputs); a layer you added by hand is named `author:<label>` (§5, *A layer the author made*) |
| <a id="PSD_FILE_PRESENT"></a><a id="PSD_PARSES"></a><a id="PSD_IS_RGB8"></a><a id="PSD_HAS_LAYERS"></a><a id="PSD_LAYER_PLAIN"></a><a id="PSD_LAYER_HAS_PIXELS"></a>`PSD_FILE_PRESENT`, `PSD_PARSES`, `PSD_IS_RGB8`, `PSD_HAS_LAYERS`, `PSD_LAYER_PLAIN`, `PSD_LAYER_HAS_PIXELS` | the `.psd` is missing, unreadable, not 8-bit RGB, has no layer, or has a layer that is hidden (a hidden-art layer, `<layer>:hidden`, may be), not at full opacity, blended other than normal, clipped, masked, or without pixels | the `.psd`; an artist's file: §4, *For artists* |
| <a id="LAYERS_DEPTH_ALL_OR_NONE"></a>`LAYERS_DEPTH_ALL_OR_NONE` | some drawn layers of a wrapper `layers.json` carry a `depth_median` and others carry `null` (issue #359): a mix has no one draw order | a number on every drawn layer (a See-through run), or `null` on every one (an export of a PSD: the manifest's order is then the draw order) |
| <a id="LAYERS_HIDDEN_OF_PRESENT"></a><a id="LAYERS_HIDDEN_NO_DEPTH"></a>`LAYERS_HIDDEN_OF_PRESENT`, `LAYERS_HIDDEN_NO_DEPTH` | a hidden-art layer, `<layer>:hidden` (issue #359), belongs to a drawn layer the input does not hold; or, in a wrapper `layers.json`, carries a `depth_median` other than `null` (it is never drawn) | the layer's name, or the layer it names; `depth_median: null` |
| <a id="LAYERS_EXPORT_DIR_EMPTY"></a>`LAYERS_EXPORT_DIR_EMPTY` | `layers --export <dir>` was given a file, or a directory that is not empty (issue #359): a file left there could be read in place of the one written | a new directory, or empty it |
| <a id="LAYERS_EXPORT_ROUND_TRIP"></a>`LAYERS_EXPORT_ROUND_TRIP` | the export, read back, differs from the input's reading (the detail names the first difference) — an exporter bug, not an input problem | report it with the input named |
| <a id="ASSEMBLE_SOURCE_PRESENT"></a><a id="ASSEMBLE_SOURCE_DECODES"></a>`ASSEMBLE_SOURCE_PRESENT`, `ASSEMBLE_SOURCE_DECODES` | the painting is missing or not a PNG | `--source` |
| <a id="SHEET_SOURCE_PRESENT"></a><a id="SHEET_PNG_PRESENT"></a>`SHEET_SOURCE_PRESENT`, `SHEET_PNG_PRESENT` | `sheet`'s painting, or a part PNG a `parts.json` lists, is missing | `--source`, `--layers` |

### Plausibility (`WARN` in `layers`, a note in `assemble --propose-plan`)

See-through writes every tag, and on some seeds it paints a layer the character does
not have: **[observed]** on one full-figure seed (issue #21), a `wings` layer of
490,296 px, mostly translucent grey that had absorbed the white background, on a
character with no wings. Proposed as an ordinary part it became an 832 x 1096 part and
the recomposite error rose to mean |d| 15.01. These are not refusals — the files are
fine — so `layers` prints a `WARN` line and exits 0, and `--propose-plan` leaves the
layer out of the plan, out of the head-run fallback and out of `extend_below_crop`.

`layers` prints three figures for every layer, each over its **opaque** pixels (alpha
above 8, the table's `opaque_px`), on the layer as read:

| column | figure |
| --- | --- |
| `translucent` | the share of opaque pixels with alpha below 128 |
| `background` | the share of opaque pixels whose own colour (straight alpha) has a min channel above 235 — the seam rule's "near-white", applied to the layer |
| `area` | opaque pixels over the opaque pixels of the union of every **other** layer of the run ("the rest of the figure"); `-` when no other layer has any |

Not over alpha above 0: See-through hazes whole canvases at alpha 1..8 (reference-demo's
full-run face is 99.1 % translucent that way and 4.2 % over its opaque pixels). Not
over the whole union: a layer is part of it, so it could never be more than 1x.

| rule | crossed when | [observed] on the two examples' 116 layers (four runs) |
| --- | --- | --- |
| <a id="PLAN_LAYER_TRANSLUCENT"></a>`PLAN_LAYER_TRANSLUCENT` | judged, and `translucent` above 50 % | the most translucent judged layer is 17.8 % (reference-sample, full run, `front hair`) |
| <a id="PLAN_LAYER_BACKGROUND"></a>`PLAN_LAYER_BACKGROUND` | judged, `background` above 50 %, and `translucent` above 25 % | the most background-coloured judged layer is 21.9 % (reference-demo, head run, `topwear`, a white dress); of judged layers above 10 % background, the most translucent is 5.6 % (reference-demo, full run, `handwear-r`) |
| <a id="PLAN_LAYER_OVERSIZED"></a>`PLAN_LAYER_OVERSIZED` | `area` above 4x | the largest is 1.681x (reference-demo, head run, `back hair`, which fills the crop) |

**Judged** means `area` at least 0.05x (or `-`). The two colour rules skip smaller
layers on purpose: **[observed]** all 27 example layers of 150 px or more that are above
25 % translucent are small features — lashes, brows, mouths, noses, ears, irises, eye
whites, an earring — antialiased strokes that are mostly rim, and the largest of them is
0.011x; 23 of the 116 layers are judged. The background rule needs translucency too,
because an opaque white garment has the page's colour and is a real part.

No example layer crosses a rule, so their proposals are unchanged. For the haze the
selftest plants (`PU03`, `PU06`: near-white, four pixels in five at alpha 40, 2.000x the
rest of the figure), the `WARN` line and the note say the same thing:

```
  WARN  PLAN_LAYER_TRANSLUCENT: layer "wings" — 80.0% translucent, 100.0% background-coloured, 2.000x the rest of the figure; at most 50% translucent (alpha below 128) for a layer at least 0.05x the rest of the figure is required, so --propose-plan leaves it out
"wings: full run layer 80.0% translucent, 100.0% background-coloured, 2.000x the rest of the figure -> not proposed by PLAN_LAYER_TRANSLUCENT (…), PLAN_LAYER_BACKGROUND (…)"
```

A full-run hair layer the head-run hair would have been extended from says `-> not
extended below the crop by …` instead. **Change:** nothing, when the character does not
have that part. When it does (a real translucent veil, a real white cape that the run
drew faintly), the layer is See-through's best attempt at it: add the entry to
`assemble.plan` by hand and read `assemble`'s `recomposite vs source` figures — or re-run
See-through with another seed.

### The config

| rule | means | change |
| --- | --- | --- |
| <a id="CONFIG_FILE_PRESENT"></a><a id="CONFIG_IS_JSON"></a>`CONFIG_FILE_PRESENT`, `CONFIG_IS_JSON` | no such file, or not JSON; for a file the config names (`motion.animations_from`, `requirements`), the path is read relative to the config's directory, and the `motion.animations_from` line names the path as typed, that directory and what the two resolved to (issue #569) | `--config`; a file the config names: put it at the resolved path, or write the path from the config's directory |
| <a id="CONFIG_KEY_KNOWN"></a><a id="CONFIG_KEY_RETIRED"></a><a id="CONFIG_FIELD_PRESENT"></a><a id="CONFIG_FIELD_TYPE"></a>`CONFIG_KEY_KNOWN`, `CONFIG_KEY_RETIRED`, `CONFIG_FIELD_PRESENT`, `CONFIG_FIELD_TYPE` | an unknown key (a retired one says what replaces it), a missing one (a `motion.animations_from` file with no `spec` is told to write `"spec": "rigc-motion/1"` and the whole file's shape, issue #569), a wrong type (`bones[i].link_inherit` must be an object whose values are strings); a project's own record under a plain key, or an annotation (`note`, `<name>_note`) holding something other than a string; in `meshes.<part>.auto` (§3, *An automatic mesh*), a missing or out-of-range number, a Stage B opt-in that is not exactly a value rig-c accepts, or a field the mode does not have — a bound on one of the five allocation rows, or an authored `motionAmplitude` (it is derived, never written); under `comfy paint`, `CONFIG_FIELD_PRESENT` on `config.generation`: a config with no `generation` block (the line names the fields it holds) | the named field; a record goes under a key beginning `x-` (any JSON, read by nothing), a remark under `note` or `<name>_note` (a string) — §3; under `comfy paint`, `config.generation` |
| <a id="CONFIG_KEY_UNIQUE"></a>`CONFIG_KEY_UNIQUE` | a key written twice in one object of a file the config names — the pose file `generation.control.skeleton` names, or the `motion.animations_from` file; JSON keeps only the last value, so every other would be dropped without a word | that file: each key once |
| <a id="CONFIG_ANIMATION_NAME_FREE"></a>`CONFIG_ANIMATION_NAME_FREE` | the `motion.animations_from` file holds an animation named `idle`, the animation `config.motion` writes | rename that animation |
| <a id="CONFIG_HEAD_BOX_SQUARE"></a>`CONFIG_HEAD_BOX_SQUARE` | `seethrough.head_box` is not a non-empty square | `head_box` — take `propose --head-box`'s |
| <a id="CONFIG_TAG_KNOWN"></a><a id="CONFIG_PART_NAME"></a><a id="CONFIG_PART_UNIQUE"></a>`CONFIG_TAG_KNOWN`, `CONFIG_PART_NAME`, `CONFIG_PART_UNIQUE` | a plan or extend entry names neither a v3 tag nor `author:<label>` (an `author:` tag with a malformed label says what the label must be), a part name that is not a file name, or a part or layer twice — a patch named like a plan part or another patch, and a cut's `into` named like a plan part, a patch or another cut's, included | `assemble.plan`, `assemble.patches`, `assemble.cuts` |
| <a id="CONFIG_NAME_RESOLVES"></a>`CONFIG_NAME_RESOLVES` | a parent, segment, region, track, blink member, blink still part or bone, extend part, patch or cut `draw.before`, or cut `from` names nothing declared above it (a cut's `from` must be a plan part); or a constraint's `bones`, `target`, `source` or `bone` names a bone `bones` does not declare (the detail names the constraint and lists the bones that exist); in `meshes.<part>.auto`, a bone or region name nothing declares; or `bones[i].link_inherit` names a link outside its own chain (the detail lists that chain's expanded links) | the named reference, or the declaration it needs |
| <a id="CONFIG_BONE_UNIQUE"></a>`CONFIG_BONE_UNIQUE` | a bone or chain declared twice, or `root` declared | `bones` |
| <a id="CONFIG_BONE_INHERIT"></a>`CONFIG_BONE_INHERIT` | a single bone's `inherit`, or a chain's `link_inherit.<link>`, is a string that is not one of rig-c's five mode names as its table spells them (issue #348); the line lists all five. `"NoScale"` is refused too: the runtime would fold the first letter, and this loader folds and maps nothing | `bones[i].inherit` or `bones[i].link_inherit.<link>` — `normal`, `onlyTranslation`, `noRotationOrReflection`, `noScale` or `noScaleOrReflection` (§3, `bones`) |
| <a id="CONFIG_LIMB_BONE"></a><a id="CONFIG_LIMB_BONES_CHAIN"></a><a id="CONFIG_LIMB_FROM_RUN"></a><a id="CONFIG_LIMB_RANGE"></a>`CONFIG_LIMB_BONE`, `CONFIG_LIMB_BONES_CHAIN`, `CONFIG_LIMB_FROM_RUN`, `CONFIG_LIMB_RANGE` | `config.limbs` (issue #349): a limb part's `regions` entry names a bone other than its segment's; a segment's bone is not the child of the segment above's (the lower segment turns about the joint on a bone that hangs from the upper's); two segments of one limb take one part with another part between them; a `range` without `min <= 0 <= max` | `regions.<part>` the segment's `bone`; `bones` (parent the lower bone under the upper) or the segment's `bone`; the segments' order or `from`; the `range` (degrees from rest, rest in it) |
| <a id="CONFIG_PART_ATTACHED"></a>`CONFIG_PART_ATTACHED` | a plan part or a cut's piece with neither or both of a mesh and a region; a patch with a mesh, or with no region | `meshes` / `regions` |
| <a id="CONFIG_RIBS_MODE"></a>`CONFIG_RIBS_MODE` | `meshes.<part>.ribs` on a lattice (`grid`) mesh: its vertices are its grid's corners, which no row can move (issue #188) | put the part in `contour` or `auto`, or remove `ribs` |
| <a id="CONFIG_INFLUENCES_MODE"></a>`CONFIG_INFLUENCES_MODE` | `meshes.<part>.influences` on an automatic (`auto`) mesh: that mode's cap and floor are `auto.influences`, which rig-c's reduction is handed (issue #284) | declare them in `auto.influences`, or remove `influences` |
| <a id="CONFIG_STRAY_MODE"></a>`CONFIG_STRAY_MODE` | `meshes.<part>.stray` on a contour (`contour`) or automatic (`auto`) mesh: those modes state the largest island they may leave out in `contour.stray` and `auto.source.stray`, which their trace reads (issue #303) | declare it there, or remove `stray` |
| <a id="CONFIG_INFLUENCE_MODE"></a>`CONFIG_INFLUENCE_MODE` | `r`, `exponent`, `rule`, `influences`, `stray` or `ribs` beside `meshes.<part>.influence` (issue #378): the field belongs to the distance rule or another mode, and an influence mesh reads none of it | remove the field; the influence block states the reach, the cap and the falloff |
| <a id="CONFIG_PATCH_BOX"></a>`CONFIG_PATCH_BOX` | an `assemble.patches` box with `x1 <= x0` or `y1 <= y0` | that patch's `box` (`x1`, `y1` are exclusive) |
| <a id="CONFIG_AMPS_MATCH_CHAIN"></a>`CONFIG_AMPS_MATCH_CHAIN` | a chain track's `amps` is not one per link | that track's `amps` |
| <a id="CONFIG_PERIOD_DIVIDES_DURATION"></a>`CONFIG_PERIOD_DIVIDES_DURATION` | a period that is not a whole fraction of the idle — the loop could not close | that track's `period`, or `motion.duration` |
| <a id="CONFIG_BLINK_GROUP_MEMBERS"></a>`CONFIG_BLINK_GROUP_MEMBERS` | `motion.blink.eyes` or `motion.blink.brows` is `[]`: a group with no members, which rigc refuses at the gate | a figure with no eyewhite part has nothing to blink: leave `motion.blink` out; one with no eyebrow part: leave `brows` and `brow_drop` out |
| <a id="CONFIG_BLINK_GROUP_UNIQUE"></a>`CONFIG_BLINK_GROUP_UNIQUE` | `motion.blink.eyes` or `motion.blink.brows` names one bone more than once; the detail gives the bone and every index it sits at. rigc refuses it at the gate (`group "eyes" names member "eye" twice`) | name each bone once: the group keys every member it names |
| <a id="CONFIG_BONE_PROPERTY_KEYED_ONCE"></a>`CONFIG_BONE_PROPERTY_KEYED_ONCE` | two tracks key one bone property: two single tracks, a single track on a chain link's `rotate`, or a single track on a blink member's `scaley` (`eyes`) or `translatey` (`brows`); the detail names the property and every track by its config path. rigc refuses it at the gate (`animation "idle" has two tracks on eye.scaley; merge them into one track`) | merge them into one track, or key another property or bone |
| <a id="CONFIG_BLINK_BROWS_PAIRED"></a>`CONFIG_BLINK_BROWS_PAIRED` | `motion.blink.brows` without `brow_drop`, or `brow_drop` without `brows` | state both or neither |
| <a id="CONFIG_STILL_OFF_THE_BLINK"></a>`CONFIG_STILL_OFF_THE_BLINK` | a `motion.blink.still` entry names a region on a bone the blink's `eyes` does not name (nothing to hold still), or its `bone` is one the blink's `eyes` names (the still piece would blink) | that entry's part, or its `bone` — the eye bone's parent, `head` as proposed |
| <a id="CONFIG_CONSTRAINT_TYPE_KNOWN"></a>`CONFIG_CONSTRAINT_TYPE_KNOWN` | a `constraints` entry's `type` is not one of rig-c's five: `ik`, `transform`, `path`, `physics`, `slider` (spelled as rigc spells them; `IK` is not `ik`) | that entry's `type` |
| <a id="CONFIG_CONSTRAINT_NAME_UNIQUE"></a>`CONFIG_CONSTRAINT_NAME_UNIQUE` | two `constraints` entries of one kind share a `name`; rigc finds a constraint by its kind and its name, so an ik and a transform may share one | rename one |
| <a id="CONFIG_CONSTRAINT_TARGET_DETACHED"></a>`CONFIG_CONSTRAINT_TARGET_DETACHED` | the bone an ik follows (`target`) or a transform reads (`source`) is one of the bones that constraint drives, or sits under one (the detail gives the line of parents) — driving them would move what they follow. This package's refusal: rig-c 2.15.0 gates such a rig green when nothing declares the parentage (measured on the selftest's rig fixture, issue #103) | a bone beside the chain; a scene target is a single bone parented to `root` (§3) |
| <a id="CONFIG_TURN_PIVOT_BEHIND_NEAREST"></a>`CONFIG_TURN_PIVOT_BEHIND_NEAREST` | `turn.pivot` is at or in front of the nearest part's depth: the law `(pivot − depth) / (pivot − nearest)` has no value there, and in front of it every part travels against the dial | a pivot above the smallest depth in `turn.depths` |
| <a id="CONFIG_TURN_RIDER_DEPTH"></a>`CONFIG_TURN_RIDER_DEPTH` | the rig stage, with `turn`: a part that rides another part's bone (issue #535 — every ownable bone it binds is hosted by one other carried part, the one binding it with the most `opaque_px`) has a `turn.depths` entry whose fraction `(pivot − depth) / (pivot − nearest)` differs from its host's by more than `TURN_RIDER_APART` (0.1) of the dial, so the turn would move it off what it is pinned to; the detail names the part, its host, the bones, both depths, both fractions, the difference and the bound | the host's depth − 0.001 when parts.json draws the part after its host (+ 0.001 when before), or redraft the turn with `propose --full`/`--head` |
| <a id="CONFIG_CLOTH_SPLIT_BEFORE_TIP"></a>`CONFIG_CLOTH_SPLIT_BEFORE_TIP` | a `cloth` recipe's `split.at` is at or past its `links`: the trunk would leave no link for the branches (issue #364) | `split.at` below `links`, or leave `split` out |
| <a id="CONFIG_CLOTH_RESPONSE_GROWS_TO_TIP"></a>`CONFIG_CLOTH_RESPONSE_GROWS_TO_TIP` | a `cloth` recipe's `wind` or `gravity` is `[root, tip]` with tip below root: the response grows from the root to the tip, where the motion accumulates down the chain | that pair |
| <a id="CONFIG_CLOTH_ALTERNATE_DIFFERS"></a>`CONFIG_CLOTH_ALTERNATE_DIFFERS` | a `cloth` recipe's `alternate_damping` without `damping`, or equal to it: neighbouring trees are declared out of phase, and an alternate that alternates nothing declares nothing | `damping` beside it, a different value, or leave `alternate_damping` out |
| <a id="CONFIG_CLOTH_SWING_SCALE_PER_TREE"></a>`CONFIG_CLOTH_SWING_SCALE_PER_TREE` | `swing` on a tag other than `bottomwear`, or `swing.scales` not one scale per tree (`chains`) | one scale per tree, in tree order across the skirt |
| <a id="CONFIG_CLOTH_PART_ON_BOTTOMWEAR"></a>`CONFIG_CLOTH_PART_ON_BOTTOMWEAR` | `part` as a string on a `cloth` recipe for a tag other than `bottomwear` (issue #402; a list of parts in `parts` or `part` is accepted on any tag, issue #437) | leave it out there, or pass a list of parts in root-to-tip order (`parts: [...]`); a single string `part` hands the skirt's recipe to a `topwear` part that holds a skirt (a dress) |
| <a id="CONFIG_CLOTH_PARTS_UNIQUE"></a>`CONFIG_CLOTH_PARTS_UNIQUE` | a `cloth` recipe sets both `part` and `parts`, or its part list names the same part more than once (issue #437) | set at most one of `part` or `parts`, and list each part once in root-to-tip order |
| <a id="CONFIG_CLOTH_SPRING_STABLE"></a>`CONFIG_CLOTH_SPRING_STABLE` | a `cloth` recipe's strength — declared, or the default 100 / 100 / 50 — whose spring is unstable at a damping the recipe runs at (`damping`, `alternate_damping`, or rig-c's 0.85 when `damping` is left out): k = strength·massInverse·step² at or past 2(1 + damping^(60·step)), step 1/60 and mass 1 (rig-c's defaults; the recipe sets neither). The detail gives k and the bound | a lower strength, or a higher damping |
| <a id="CONFIG_TURN_BONE_FREE"></a>`CONFIG_TURN_BONE_FREE` | the config has `turn` and `bones` declares a bone named `turn`, the control the rig stage adds | rename that bone |
| <a id="CONFIG_TURN_DEFORM_RANGE"></a>`CONFIG_TURN_DEFORM_RANGE` | an entry in `turn.deform` lies outside its allowed `[min, max]` interval in `FACE_DEFORM_RANGES` (`src/turn.ts`, issue #436); the detail gives the value found, the interval required and the default fraction | put that `turn.deform.<key>` inside the stated range, or remove it to take the Set B ×2.5 default |
| <a id="CONFIG_TURN_EAR_DEPTH_RANGE"></a>`CONFIG_TURN_EAR_DEPTH_RANGE` | an ear track (`group: "ears"` or `bone: "ear_r" \| "ear_l"`) in `turn` or `tilt` declares a `derive.depth` outside `EAR_DEPTH_RANGE` (`[-50, 0]`, `src/turn.ts`, issue #477); the detail gives the value found and the interval required | put the ear `derive.depth` in `[-50, 0]` (at or behind the head pivot, e.g. `-14`) |
| <a id="CONFIG_TURN_REQUIRED"></a>`CONFIG_TURN_REQUIRED` | `motion.animations_from` carries `turn` or `tilt` `derive` keys while `config.turn` is absent, or an attached head part (`face`, `hair_front`, `hair_back`) is missing from `config.turn.depths` (issue #478): without `turn.depths` the head pivot and back-of-head counter-parallax cannot be derived | run `propose --full` (or `--head`) to draft `config.turn`, or declare `config.turn` with `pivot` and `depths` covering `face`, `hair_front` and `hair_back` |
| <a id="CONFIG_FACE_BAND_EXCEEDED"></a>`CONFIG_FACE_BAND_EXCEEDED` | `turn.band` or a `motion.animations_from` `turn`/`tilt` `derive.degrees` exceeds the single-plate rated band (`FACE_RATED_BAND`: `yaw <= 15°`, `pitch <= 12°`, issue #472) while no `assemble.alternates` entry replaces `face`; the detail gives the requested angle, the rated limit and both remedies | clamp the angle to `±15°` yaw / `±12°` pitch, or declare an `assemble.alternates` entry covering `face` for the 3/4 or profile plate |
| <a id="CONFIG_PROPOSED_RIG_SCALE"></a>`CONFIG_PROPOSED_RIG_SCALE` | `proposed_rig_scale` (the `scale_rig_per_source` `propose` drafted the rig sections at, issue #354) differs from `assemble.rig_scale`: the coordinates in `bones`, `meshes`, `limbs` and `motion` are in that rig canvas's pixels and do not scale when `assemble.rig_scale` changes | re-run `assemble` and `propose` at the new `assemble.rig_scale`, or restore `assemble.rig_scale` to `proposed_rig_scale` |
| <a id="CONFIG_BUST_CLEARANCE"></a>`CONFIG_BUST_CLEARANCE` | `meshes.<part>.contour.bust` (issue #475): `clearance <= 0`, `R_r + R_l >= \|apex_r − apex_l\|` (the derived outer radii overlap or touch across the apex span `D`, or `cleavage` sits off the segment so `d_r + d_l − 2·clearance >= D`), or a derived `R_s`, `r_s = round(alpha × R_s)` or `band_s = round(R_s) − r_s` is not positive; the detail names `clearance`, `R_r + R_l` and `D` | raise `contour.bust.clearance` so `0 < clearance < d_s` and `R_r + R_l < \|apex_r − apex_l\|`, or place `cleavage` between `apex_r` and `apex_l` |
| <a id="CONFIG_SET_COVERS_SLOT"></a>`CONFIG_SET_COVERS_SLOT` | `motion.animations_from` (issue #473): a track key carries `"set": "<name>" \| null` on a track other than `property: "attachment"`, names an alternate set not declared in `assemble.alternates`, or names an alternate set that does not cover the track's `slot` (neither in `slots` nor in `hides`); the detail names the set, the slot and the slots that set covers | declare the set in `assemble.alternates`, add the slot to that set's `parts` (or `hides`), or key `"set"` on a slot the set covers |
| <a id="CONFIG_SET_COVERS_BONE"></a>`CONFIG_SET_COVERS_BONE` | `assemble.alternates[i].drawn.<bone>` (issue #476): a subset set (`parts` present) states a `drawn` world angle for a bone none of its covered parts ride; the detail names the bone, the set, and the bones its covered parts ride | remove the uncovered bone from that set's `drawn`, or add the part that rides it to `parts` |
| <a id="CONFIG_LIMB_SET_JOINTS"></a>`CONFIG_LIMB_SET_JOINTS` | `assemble.alternates[i]` (issue #476): a gesture set over a limb chain declared in `config.limbs.<limb>` names the unsplit `from` layer instead of the limb's segment `part`s, covers (or hides) only a subset of the limb chain's segments, or declares custom polygon `cuts` on the limb; the detail names the limb and its segment parts | cover all segment `part`s of `config.limbs.<limb>` in `parts` with no custom `cuts`, so `assemble` cuts the set at the base's joints |

### inputs

| rule | means | change |
| --- | --- | --- |
| <a id="INPUTS_SOURCE_PRESENT"></a>`INPUTS_SOURCE_PRESENT` | no such painting | `--source` |
| <a id="INPUTS_PAINTING_OPAQUE"></a>`INPUTS_PAINTING_OPAQUE` | the painting has a pixel below alpha 255 | the painting |
| <a id="INPUTS_HEAD_BOX_INSIDE"></a>`INPUTS_HEAD_BOX_INSIDE` | `seethrough.head_box` leaves the painting (the crop is not padded) | `head_box` — take `propose --head-box`'s |

### painting

`rig-parts painting --keypoints <k.json> <painting.png>` (issue #350) reads the painting
before See-through runs on it. *Background* is ground (alpha 8 or less, or every channel
above 235) connected to the painting's edge; the *figure* is the rest; a *gap* is one
background pixel on the straight line between two joints. [PAINTING.md](PAINTING.md)
says why each requirement exists and what breaks without it.

| rule | means | change |
| --- | --- | --- |
| <a id="PAINTING_SOURCE_PRESENT"></a><a id="PAINTING_SOURCE_DECODES"></a>`PAINTING_SOURCE_PRESENT`, `PAINTING_SOURCE_DECODES` | the painting is missing or not a PNG | the path |
| <a id="PAINTING_BACKGROUND_PLAIN"></a>`PAINTING_BACKGROUND_PLAIN` | a border pixel is neither near-white nor unpainted: scenery, a floor, a gradient or a vignette reaches the edge, or the figure is cut by the frame; the detail counts them and names the first | a painting on a plain light background with the whole figure inside the frame (PAINTING.md, *Background*) |
| <a id="PAINTING_JOINTS_STATED"></a>`PAINTING_JOINTS_STATED` | a wrist, knee or ankle is `occluded` or `missing` in the keypoint file, or a hip has no position: the gap rules read those eight joints, and a hand or foot the painting does not show is a limb nothing can rig. A hip may be `occluded` (a skirt hides it on most clothed figures, issue #372) when its arm's gap is **well defined**: it carries a position — inside the image, which the keypoint reader holds (`KEYPOINTS_POSITION_INSIDE`), so the wrist-to-hip line's every sample is a pixel of the painting — and that pixel is figure (`PAINTING_JOINT_ON_FIGURE`). A hip `occluded` with no position, or `missing`, is refused: there is no line to read | a painting that shows it; or the joint, if the estimator missed one the painting shows; for a hip under a skirt, `occluded` with its estimated position (PAINTING.md, *An occluded hip*) |
| <a id="PAINTING_JOINT_ON_FIGURE"></a>`PAINTING_JOINT_ON_FIGURE` | an observed joint's pixel, or an occluded hip's, is background. For an occluded hip the detail adds that the arm's gap would be the estimate's own background, not one between the arm and the body | the keypoint file (measured on this painting?), or the painting; an occluded hip's estimate, moved onto the figure it is hidden under |
| <a id="PAINTING_ARM_CLEAR"></a>`PAINTING_ARM_CLEAR` | the line from a wrist to the hip of its side crosses no background: the arm is painted against the body. Hands that meet close a loop round the torso, so this fires with `PAINTING_HANDS_APART` on both sides | a painting with the arm held away from the body (PAINTING.md, *Arms*) |
| <a id="PAINTING_HANDS_APART"></a>`PAINTING_HANDS_APART` | the line between the two wrists crosses no background: hands clasped or touching | a painting with the hands apart and open (PAINTING.md, *Hands*) |
| <a id="PAINTING_LEGS_APART"></a>`PAINTING_LEGS_APART` | the line between the knees, or between the ankles, crosses no background: the legs are one column there (a long skirt over the knees is refused here too) | a painting with the legs apart and a visible gap at the knees and the ankles (PAINTING.md, *Legs*) |

### The optional ComfyUI adapter (`comfy paint`, `comfy seethrough`)

| rule | means | change |
| --- | --- | --- |
| <a id="COMFY_HOST_GIVEN"></a><a id="COMFY_REACHABLE"></a><a id="COMFY_REQUEST_OK"></a>`COMFY_HOST_GIVEN`, `COMFY_REACHABLE`, `COMFY_REQUEST_OK` | no `--host`/`COMFY_HOST`, nothing answering there, or a non-200 answer | the host, or the box |
| <a id="COMFY_NODE_PRESENT"></a><a id="COMFY_INPUT_KNOWN"></a><a id="COMFY_INPUT_SET"></a><a id="COMFY_CHOICE_PRESENT"></a>`COMFY_NODE_PRESENT`, `COMFY_INPUT_KNOWN`, `COMFY_INPUT_SET`, `COMFY_CHOICE_PRESENT` | the box's `/object_info` lacks a node class the graph uses, an input it sets, an input it must set, or a model file it names | install the node or model on the box, or the config value naming it |
| <a id="COMFY_QUEUE_EMPTY"></a><a id="COMFY_PROMPT_ACCEPTED"></a><a id="COMFY_HISTORY_WITHIN"></a><a id="COMFY_RUN_OK"></a>`COMFY_QUEUE_EMPTY`, `COMFY_PROMPT_ACCEPTED`, `COMFY_HISTORY_WITHIN`, `COMFY_RUN_OK` | someone else's job kept the queue busy past `--wait`, the box rejected the graph, the job did not finish within `--timeout`, or it ended in error (quoted) | `--wait`/`--timeout`, or what the quoted error names |
| <a id="COMFY_HISTORY_OUTPUTS"></a><a id="COMFY_VIEW_PRESENT"></a><a id="COMFY_MANIFEST_NAMED"></a><a id="COMFY_MANIFEST_IS_THIS_RUN"></a><a id="COMFY_LAYER_NAME"></a>`COMFY_HISTORY_OUTPUTS`, `COMFY_VIEW_PRESENT`, `COMFY_MANIFEST_NAMED`, `COMFY_MANIFEST_IS_THIS_RUN`, `COMFY_LAYER_NAME` | the job's outputs are missing, unreadable, belong to another run, or name a layer that is not a plain file name | the wrapper's version on the box; report it |
| <a id="COMFY_IMAGE_PRESENT"></a><a id="COMFY_OUT_EMPTY"></a><a id="COMFY_OUT_FREE"></a>`COMFY_IMAGE_PRESENT`, `COMFY_OUT_EMPTY`, `COMFY_OUT_FREE` | no `--image`, an `--out` that already holds files, or a seed whose painting is already on disk | `--image`, `--out`, `--seed0` |
| <a id="COMFY_PAINTING_SIZE"></a>`COMFY_PAINTING_SIZE` | the painting `comfy paint` got back is not twice the latent (a config with no `generation` block is `CONFIG_FIELD_PRESENT`, §6 *The config*) | `config.generation` |
| <a id="CONFIG_POSE_CANVAS"></a><a id="CONFIG_POSE_KEYPOINTS"></a><a id="CONFIG_POSE_IN_CANVAS"></a>`CONFIG_POSE_CANVAS`, `CONFIG_POSE_KEYPOINTS`, `CONFIG_POSE_IN_CANVAS` | the pose file `generation.control.skeleton` names states another canvas than `generation.latent`, holds other than the 18 body-18 keypoints, or puts one off its canvas | the pose file (§3, the `generation.control.skeleton` row) |

### assemble

| rule | means | change |
| --- | --- | --- |
| <a id="ASSEMBLE_FIELD_PRESENT"></a>`ASSEMBLE_FIELD_PRESENT` | `seethrough.head_box` is missing | `propose --head-box` proposes it (§3) |
| <a id="ASSEMBLE_RIG_SIZE"></a>`ASSEMBLE_RIG_SIZE` | `rig_scale` makes an empty rig | `assemble.rig_scale` |
| <a id="ASSEMBLE_HEAD_BOX_INSIDE"></a>`ASSEMBLE_HEAD_BOX_INSIDE` | the head box is outside the painting | `head_box` — `propose --head-box` holds it inside |
| <a id="ASSEMBLE_RUN_CANVAS"></a>`ASSEMBLE_RUN_CANVAS` | a run's canvas is not `resolution` square; with one run (issue #366), a side of the file is above `resolution` — a smaller one is padded, a larger one would have to be shrunk | `seethrough.resolution`, or the run |
| <a id="ASSEMBLE_SINGLE_RUN_SOURCE"></a>`ASSEMBLE_SINGLE_RUN_SOURCE` | with no `--head` (issue #366), the painting `--source` names is not the one run's file's size: the painting is the file flattened, and every part's box maps back to the file through it | the painting — the file flattened, at the file's size |
| <a id="ASSEMBLE_SINGLE_RUN_FACE"></a>`ASSEMBLE_SINGLE_RUN_FACE` | with no `--head` (issue #359), the one run holds no painted layer for one of `face`, `eyewhite-r`, `eyewhite-l` — the parts the head run exists to separate (one problem per tag) | paint the layer, or give the head run with `--head` |
| <a id="ASSEMBLE_SINGLE_RUN_PLAN"></a>`ASSEMBLE_SINGLE_RUN_PLAN` | with no `--head`, a plan row takes `"head"`, or an `extend_below_crop` entry continues a part below a crop there is not | `"full"` in the row; remove the entry |
| <a id="ASSEMBLE_SINGLE_RUN_HEAD_BOX"></a>`ASSEMBLE_SINGLE_RUN_HEAD_BOX` | with no `--head`, the config sets `seethrough.head_box`, which places a head run there is not | remove `head_box`, or give the head run with `--head` |
| <a id="ASSEMBLE_ARM_SPLIT_CUTS_ARM"></a>`ASSEMBLE_ARM_SPLIT_CUTS_ARM` | `seethrough.arm_split` cuts a horizontal opaque run of the arm layer into more than two segments (issue #439; the detail gives the row, the run and the split x) | `seethrough.arm_split`: move `x` or `line` so each horizontal opaque run of the arm layer is split at most once |
| <a id="SEETHROUGH_ARM_RUN_MERGED"></a>`SEETHROUGH_ARM_RUN_MERGED` | a full-run `handwear-r` or `handwear-l` layer merges sleeve, bare hand (`>= 40` skin run px around `<s>_wrist`, `GHOST_MIN_AREA`) and overgarment into one arm layer with non-skin pixels reaching more than `1.0x` the forearm length (`<s>_elbow -> <s>_wrist`) below `<s>_wrist` (measured `-0.15x..0.45x` on the 6 clean standees vs `1.25x..2.02x` on the 3 merged standees), and the sleeve above `<s>_wrist` and the drape below `<s>_wrist` have Euclidean RGB distance `< 80` (`ARM_DRAPE_COLOR_DISTANCE`, measured `20.8..28.2` when same-coloured vs `103.6..236.0` when distinct) so the stage cannot split them by colour (issue #490; the detail gives the hand px, the non-skin span, the forearm length and both RGB medians) | re-seed `config.seethrough.seed`, split the merged layer into `author:` layers in the full run, or cut the overgarment from the sleeve in `config.assemble.cuts` |
| <a id="SEETHROUGH_HEAD_RUN_HOLLOW"></a>`SEETHROUGH_HEAD_RUN_HOLLOW` | `full:face` has at least `200` opaque run px (`PROPOSE_MIN_PX`) and `head:face` covers less than `75 %` (`HEAD_FACE_COVERAGE_FLOOR`, measured `0.0 %..48.6 %` on hollow/omitted head runs vs `84.8 %..99.6 %` on clean head runs across the 4 public examples and 9-standee corpus) of `fullLayerToHead(full:face)`'s hole-filled silhouette (`alpha > 8`) in the head canvas while `config.assemble.head_face_underfill: true` is not declared, or `head:face` has fewer than `200` opaque pixels so there is no head-run `face` layer to under-fill (issue #492; the detail gives the full-run mapped count, the head-run overlap and upper/lower half shares) | re-seed `config.seethrough.seed`, or set `config.assemble.head_face_underfill: true` when `head:face` exists so the stage composites `fullLayerToHead(full:face)` under `head:face` on the head canvas (the fill restores transparent pixels only and leaves the cut's own edge where it is — a hollow whose edge is not under hair stays visible, and that is the author's to fix at the cut) |
| <a id="ASSEMBLE_PLAN_TAG_IN_RUN"></a><a id="ASSEMBLE_EXTEND_TAG_IN_RUN"></a>`ASSEMBLE_PLAN_TAG_IN_RUN`, `ASSEMBLE_EXTEND_TAG_IN_RUN` | an entry takes a tag its run does not hold (the detail lists what it does hold) | that entry's run or tag |
| <a id="ASSEMBLE_PART_OPAQUE"></a>`ASSEMBLE_PART_OPAQUE` | a part ended with no opaque pixel | drop the entry, or take the tag from the other run |
| <a id="ASSEMBLE_PATCH_BOX_INSIDE"></a>`ASSEMBLE_PATCH_BOX_INSIDE` | a patch's box reaches past the rig (the painting times `rig_scale`; the detail gives the size) | that patch's `box` — it is in rig pixels, not painting pixels |
| <a id="ASSEMBLE_PATCH_OPAQUE"></a>`ASSEMBLE_PATCH_OPAQUE` | a patch takes no pixel: a `"silhouette"` patch whose box holds none of the figure | move the box onto the figure, or `"alpha": "box"` |
| <a id="ASSEMBLE_CUT_INSIDE"></a>`ASSEMBLE_CUT_INSIDE` | a cut's polygon has a point past the rig (the detail gives the points and the size) | that cut's `polygon` — it is in rig pixels, not painting pixels |
| <a id="ASSEMBLE_CUT_OVERLAP"></a>`ASSEMBLE_CUT_OVERLAP` | two cuts of one part share a rig pixel (the detail gives the count and the first, `x,y`) | one of the two polygons: a pixel goes to one part |
| <a id="ASSEMBLE_CUT_PIXELS"></a>`ASSEMBLE_CUT_PIXELS` | a cut takes none of its part's opaque pixels (alpha above 8), or a part's cuts leave it none | draw the polygon over the art; to move the whole layer, rename the plan part instead |
| <a id="ASSEMBLE_CUT_CROSSES_LIMB"></a>`ASSEMBLE_CUT_CROSSES_LIMB` | a cut whose `from` a limb takes takes a pixel inside the limb: between the joint above its segments that take the part and the joint below them, or in the upper joint's cap disc (the detail gives the limb, the count, the first `x,y`, the segment's band or the cap, and the line it must lie past) | the polygon: past the lower joint's line or before the upper's and outside its cap — or leave the pixels to the limb's segments (§5, *Limbs*) |
| <a id="ASSEMBLE_UNDER_PRESENT"></a><a id="ASSEMBLE_UNDER_DECODES"></a>`ASSEMBLE_UNDER_PRESENT`, `ASSEMBLE_UNDER_DECODES` | a cut's `under` names no file (relative to the config's directory), or a file that is not a PNG; every cut's is named in one refusal | that cut's `under` |
| <a id="ASSEMBLE_UNDER_SIZE"></a>`ASSEMBLE_UNDER_SIZE` | a cut's `under` image is not the size of its polygon's bounding box (the detail gives both, and the box's corner) | the image: `max x − min x` by `max y − min y` of the polygon, in rig pixels |
| <a id="ASSEMBLE_UNDER_EMPTY"></a>`ASSEMBLE_UNDER_EMPTY` | a cut's `under` image fills none of the pixels the cut removed: its alpha is below the alpha removed at every one (all transparent there, or another file) | the image or its path; to leave the whole hole, drop `under` |
| <a id="ASSEMBLE_UNDER_FILL_SOURCE"></a>`ASSEMBLE_UNDER_FILL_SOURCE` | a cut declares `under_fill` and has no under to fill with: it names no `under` file and its part has no hidden-art layer (issue #360) | name the cut's `under`, or drop `under_fill` |
| <a id="ASSEMBLE_UNDER_DRAW"></a>`ASSEMBLE_UNDER_DRAW` | a cut with `under` draws its piece behind its part, which the fill would hide it under | that cut's `draw`: `"front"`, or `{"before": …}` the plan part after its `from` |
| <a id="ASSEMBLE_LIMB_TAKES"></a><a id="ASSEMBLE_LIMB_PIXELS"></a>`ASSEMBLE_LIMB_TAKES`, `ASSEMBLE_LIMB_PIXELS` | a part a limb takes has no opaque pixel, or a limb segment gets none of it — the joint lines through the bones' origins put none of the limb's pixels on it, or another limb's polyline is nearer every one (issue #349) | the bones: their origins on the limb's art, each joint where the limb bends |
| <a id="ASSEMBLE_LIMB_JOINT"></a><a id="ASSEMBLE_LIMB_JOINT_ON_ART"></a>`ASSEMBLE_LIMB_JOINT`, `ASSEMBLE_LIMB_JOINT_ON_ART` | a joint has no line — the upper bone has no length, or the limb folds straight back on itself — or its bone's origin lies on none of the limb's art within 1 px along the line, so the limb has no width there to size the cap by (issue #349) — the detail names the nearest pixel of the limb's art on that line and its distance from the joint, or says the line crosses none of it (issue #517); under `cap_shape: "disc"`, also a bone's origin on the very edge of the run, which has no half-width about it (issue #360) | the joint's bone: on the limb's art, at the joint |
| <a id="ASSEMBLE_LIMB_CUT_BAND"></a>`ASSEMBLE_LIMB_CUT_BAND` | a segment's `cut_band` reaches past the limb: a line of its band, the detail names the one nearest the joint and a point it passes through, crosses none of the limb's art within 1 px of that point, so a cut placed there would cut nothing (issue #360) | `cut_band`: the widest band whose every line crosses the limb, which the detail gives |
| <a id="ASSEMBLE_LIMB_CAP_PRESENT"></a><a id="ASSEMBLE_LIMB_CAP_DECODES"></a><a id="ASSEMBLE_LIMB_CAP_SIZE"></a><a id="ASSEMBLE_LIMB_CAP_EMPTY"></a>`ASSEMBLE_LIMB_CAP_PRESENT`, `ASSEMBLE_LIMB_CAP_DECODES`, `ASSEMBLE_LIMB_CAP_SIZE`, `ASSEMBLE_LIMB_CAP_EMPTY` | a segment's `cap` names no file (relative to the config's directory) or one that is not a PNG; an image not the size of the cap's box (the detail gives both, and the box's corner); or one transparent over every cap pixel (issue #349) — under `cap_shape: "ball"`, over the upper half and over every lower-half pixel where the lower piece is transparent (issue #579) | the image: the box the `limb cap:` line prints, `w`x`h`, its pixel `(i, j)` rig pixel `(x + i, y + j)`; to keep the layer's cap, drop `cap` |
| <a id="ASSEMBLE_HIDDEN_ONE_SOURCE"></a>`ASSEMBLE_HIDDEN_ONE_SOURCE` | a cut's `under`, or a limb segment's `cap`, names a file, and the part it reads also has a hidden-art layer (`<layer>:hidden`, issue #359): reading either would be a guess | remove the file from the config, or the hidden-art layer from the input |
| <a id="ASSEMBLE_ALT_INPUT_PRESENT"></a>`ASSEMBLE_ALT_INPUT_PRESENT` | an alternate painting set (`assemble.alternates` or `--alt`, issue #454) is missing `source` or `full`, names a file or directory that is not on disk, or lacks a covered part's layer in its runs | give `source` and `full` on the alternate set, or list an occluded part in `hides` |
| <a id="ASSEMBLE_ALT_CANVAS_SIZE"></a>`ASSEMBLE_ALT_CANVAS_SIZE` | an alternate painting's canvas size differs from the primary painting's (issue #454; the detail gives both sizes) | the alternate painting: the primary painting's canvas size, so its parts land in the same rig frame |
| <a id="ASSEMBLE_ALT_SKELETON"></a>`ASSEMBLE_ALT_SKELETON` | an alternate set's `skeleton` file (`assemble.alternates[i].skeleton`, issue #465) is not JSON or does not hold `{"width": W, "height": H, "points": {…the 18 body-18 keypoints}}` | that set's `skeleton` file |
| <a id="ASSEMBLE_ALT_SKELETON_REGISTERED"></a>`ASSEMBLE_ALT_SKELETON_REGISTERED` | an alternate set whose `skeleton` places its limb bones (issue #539) is not registered on the base: the similarity without rotation that maps the skeleton's torso (the mean of its shoulders to the mean of its hips, where the base declares `sleeve_*0`/`arm_*0` and `leg_*0`) onto those base bones' origins is more than 1 rig px off (the offset's length) or more than 1 % off in scale; the detail gives the offset `[dx, dy]` rig px and the scale the painting would need (`p -> scale * p + offset`, about the canvas origin) and the bones read. Also when the base declares no bone at one end of the torso, or the skeleton's torso has no length. Refused before any joint is cut | the set's painting and skeleton, registered: the figure at the base figure's torso place and scale on the same canvas (`ASSEMBLE_ALT_CANVAS_SIZE` forbids another canvas); or, on a base with no torso bones, `drawn` in place of `skeleton` |
| <a id="ASSEMBLE_ALT_LIMB_ISLAND"></a>`ASSEMBLE_ALT_LIMB_ISLAND` | a subset alternate set names one limb side of a layer more limbs take, the set's layer holds more than one island (8-connected, alpha above 8, at least 1 % of its largest — issue #608), and a segment's joint — its bone's origin, or the next segment's — lies on no island and none or two of them lie within the radius of the cap cut at that joint, or no cap is cut at it (a limb's first joint), or its joints lie on two, so no one island is the limb's to keep (issue #588; the detail gives every island's pixels and box, the joints, and for a joint off the art each island's distance and the radius) | the set's bones or `drawn`, a joint on its limb's art or within its cap's radius of it; one stroke of art from joint to joint; or a layer that holds the limb alone |
| <a id="ASSEMBLE_ALT_LIMB_POSE"></a>`ASSEMBLE_ALT_LIMB_POSE` | a subset alternate set names one limb side of a layer more limbs take, the set's layer holds one island (8-connected, alpha above 8, specks aside), it has art where the base build draws another limb of that layer (the detail gives the pixels and the base parts), and the set does not place that limb — no bone of it, nor an ancestor, is placed by the set's `skeleton` (the body-18 table's arm and leg bones) or named in its `drawn`; the pixels are split by the nearest segment line in the set's pose, and the other limb's place is never taken from the base's (issue #609). Also a source-transparent cap overlapping an unposed other limb's base art, or a cap target source segment with no supplied tip or following joint (issue #637) | a `skeleton` whose keypoints place the other limb (`drawn` may not name a bone the set does not cover, `CONFIG_SET_COVERS_BONE`); or a set that carries the other limb's parts too; or a layer that holds the set's limb alone |
| <a id="ASSEMBLE_ALT_LIMB_OVERLAP"></a>`ASSEMBLE_ALT_LIMB_OVERLAP` | a subset alternate set's layer of one island holds its limb and another limb the set places, and in the set's pose the other limb's segment line runs within the limb's half-width (the least `cap.radius` of its joints) of the limb's, across it, at more than half of the readings 1 px apart along the limb's line where the other line passes within twice that — the limbs lie over each other, so no line between them says whose a pixel is (a crossing at angle θ reads cos θ / 2, under half; issue #609; the detail gives the readings, the half-width and the share); also when the limb has no joint to measure its half-width at | a layer that holds the set's limb alone; or a set that carries the other limb's parts too |
| <a id="ASSEMBLE_COUNTS_ADD_UP"></a>`ASSEMBLE_COUNTS_ADD_UP` | a part's visible and occluded counts do not add up to its opaque pixels, or a projected pixel is not visible, or a cut part's pieces do not add up to it — an assembler bug, not an input problem | report it with the part named; nothing was written |

### propose

| rule | means | change |
| --- | --- | --- |
| <a id="HEADBOX_FACE_PRESENT"></a><a id="HEADBOX_RUN_SQUARE"></a><a id="HEADBOX_CANVAS_SIZE"></a><a id="HEADBOX_FITS_CANVAS"></a>`HEADBOX_FACE_PRESENT`, `HEADBOX_RUN_SQUARE`, `HEADBOX_CANVAS_SIZE`, `HEADBOX_FITS_CANVAS` | the full run has no face or is not square; `--canvas` is not a positive size; or the painting cannot hold the proposed box at its size — its shorter side is the bound (shrinking it would cut the head) | `--full`, `--canvas`, or the painting |
| <a id="PROPOSE_SOURCE_PRESENT"></a><a id="PROPOSE_PNG_PRESENT"></a><a id="PROPOSE_PNG_MATCHES_BOX"></a>`PROPOSE_SOURCE_PRESENT`, `PROPOSE_PNG_PRESENT`, `PROPOSE_PNG_MATCHES_BOX` | the painting or a part PNG is missing, or a PNG is not its box | `--source`, `--parts` (re-run assemble) |
| <a id="PROPOSE_FACE_PRESENT"></a>`PROPOSE_FACE_PRESENT` | no part comes from a `face` layer, and the face-less fallback cannot derive a face box either: it needs the head run's `neck` and at least one head-run `front hair`/`back hair` part whose top is above the neck's, and the message names the half that is missing. With both, `propose` does not refuse — it derives the box and says so in its first note (§5) | `assemble.plan`: take the face, or the head run's hair and neck |
| <a id="PROPOSE_CUT_FROM_RECORDED"></a>`PROPOSE_CUT_FROM_RECORDED` | two parts share one layer and none of them records `cut_from`: a `parts.json` an `assemble` before 1.6.0 wrote with `assemble.cuts`. The records are in draw order, so which is the plan part and which the piece cannot be read off the file; the message names the parts and the layer. Every other reader still takes the file | `--parts`: re-run assemble (1.6.0+) to record `cut_from` |
| <a id="PROPOSE_LIMB_PARTS"></a>`PROPOSE_LIMB_PARTS` | `parts.json` holds a standalone or incomplete limb part `config.limbs` cut at its joints (issues #349, #440) that cannot be reassembled into the source part `of` (a missing segment or `cap` record, or `of` still present beside the limb parts); a complete `assemble` output with `config.limbs` reconstructs its pre-limb parts in the same run | `--parts` a complete `assemble` output (every segment of each limb, with its `cap` record) or a build assembled with `config.limbs` left out; `propose --from-config` reads the config's bones on either build |
| <a id="PROPOSE_FIGURE_LAYER"></a>`PROPOSE_FIGURE_LAYER` | with `--keypoints` (issue #577): a limb is drafted from the figure layer (no handwear or legwear part over 500 px for it), and two or more `topwear` parts each hold every joint and the trunk bones' origins within 15 px with the same opaque px in the 31x31 squares about them, so nothing says which is the figure; or the only `topwear` parts that hold them are named by a cloth recipe (`config.cloth.<tag>.part` or `.parts`, issue #631), whose mesh a limb would take (§3, *A figure of one material*) | leave the others out of `assemble.plan`, or give the arms and legs their own handwear and legwear layers; for a recipe's part, take it out of the recipe |
| <a id="PROPOSE_CLOTH_DRAFTED"></a>`PROPOSE_CLOTH_DRAFTED` | with `--cloth` (issue #364): the config's `cloth` block holds a recipe for a tag the proposer drafts no chain on — no part has that tag, or every `back hair` part ends above the shoulders (a bun bone, no chain). A `bottomwear` recipe with no `bottomwear` part names every `topwear` part shaped like a skirt (issue #402) | leave that recipe out, or assemble the layer it is for, or declare the named part in `cloth.bottomwear.part` |
| <a id="PROPOSE_CLOTH_PART"></a>`PROPOSE_CLOTH_PART` | with `--cloth` (issues #402, #437): `cloth.bottomwear.part` (a string) names no part, a part or cut piece whose source is not `topwear` (a `bottomwear` part takes the recipe by its tag already), or a target whose box ends above the hip + 0.25 face heights, the topwear rule's waist line; or `cloth.<tag>.parts` (or `part` as a list, issue #437) names a part not in `parts.json`, a part no link of the drafted tree crosses (`spanCrosses == 0`), or parts out of root-to-tip depth order along the chain | name the `topwear` part or its cut skirt piece that holds the skirt (or leave `part` out), or list only parts in `parts.json` that the drafted tree links cross in root-to-tip order |
| <a id="PROPOSE_WRITE_CONFIG_FRESH"></a>`PROPOSE_WRITE_CONFIG_FRESH` | with `--write-config` (issue #537): the out path exists, or is a file the run writes itself (`proposal.json`, `basis.json` under `--out`); the config is written to a new file, never over the `--cloth` config or an earlier one | name a file that does not exist yet, beside the `--cloth` config |
| <a id="PROPOSE_WRITE_CONFIG_CONFLICT"></a>`PROPOSE_WRITE_CONFIG_CONFLICT` | with `--write-config` (issue #552): an entry of `bones`, `constraints` or `motion.tracks` the recipe re-drafts or removes was changed by hand in the `--cloth` config — it equals neither the draft with the recipe nor the draft without it — so the write would drop the hand edit; the object is the entry (`config.constraints[40] "skirt0a_0_physics"` in CL207), the detail names the first field the hand edit holds and what the draft writes there. With `--from <previous config>` (issue #571) an entry equal to the previous recipe's draft is the recipe's too, and the conflict is an entry that equals neither the draft, the draft without the recipe, nor the previous recipe's draft: the detail says so and reads the first differing field against the previous recipe's draft. Also a name the config states twice where the recipe drafts it. Every conflict is named at once and nothing is written | take the draft by removing the hand edit (or the entry), or leave the recipe out for that part (its `cloth` block); state a name once |
| <a id="PROPOSE_WRITE_CONFIG_SPLICE"></a>`PROPOSE_WRITE_CONFIG_SPLICE` | with `--write-config` (issue #537): the `--cloth` config's text with the drafted sections spliced in does not parse to that config with them set, and the message names the first key that moved — the text states a key twice, so the splice lands on the first and the parse keeps the last | state each key once in the `--cloth` config |
| <a id="PROPOSE_CLOTH_BACK_HAIR_CHAINS"></a>`PROPOSE_CLOTH_BACK_HAIR_CHAINS` | with `--cloth` (issues #390, #445, #461): `cloth."back hair".chains` exceeds what the narrower side's opaque width at the eye-line root row holds at the part's mesh grid (`max(1, min(floor(w_r / grid), floor(w_l / grid)))`), or places a tree root outside the 15 px dilated art mask of the `back hair` part (e.g. an inner twin-tail root over the face where the hair has no pixel); the message names the part, each side's root-row width, the grid spacing, and any off-art root with its pixel alpha | lower `cloth."back hair".chains` to at most the max fit named in the message, or omit `chains` so `propose --cloth` derives the tree count per visible hair mass on each side from its root-row width |
| <a id="PROPOSE_ACCESSORY_BODY"></a>`PROPOSE_ACCESSORY_BODY` | an accessory has nothing above its pendant rows to hang its bone on | that part's plan entry, or author its bones by hand |
| <a id="PROPOSE_TURN_RUN_GIVEN"></a><a id="PROPOSE_TURN_LAYER_PRESENT"></a><a id="PROPOSE_TURN_DEPTH_PRESENT"></a>`PROPOSE_TURN_RUN_GIVEN`, `PROPOSE_TURN_LAYER_PRESENT`, `PROPOSE_TURN_DEPTH_PRESENT` | with `--full`/`--head` (issue #251): a part came from a run whose layers were not given, the run given holds no layer of the part's tag, or its layer carries no `depth_median` while another part's layer carries one; a run with no depth on any part's layer (a PSD, or an export of one) is not refused — the turn is skipped, and the note says `turn: SKIP` and names the run (issue #359) | give the run the parts were assembled from, as the wrapper's `layers.json` |
| <a id="BASIS_RECORDS_EVERY_BONE"></a><a id="BASIS_NAMES_RESOLVE"></a><a id="BASIS_KIND_KNOWN"></a><a id="BASIS_KIND_HOLDS"></a>`BASIS_RECORDS_EVERY_BONE`, `BASIS_NAMES_RESOLVE`, `BASIS_KIND_KNOWN`, `BASIS_KIND_HOLDS` | `propose --keypoints`'s record of how it placed each bone, `basis.json`, does not hold to the proposal it was written with: a proposed bone with no record, one recorded twice or out of the proposal's order; a part, bone or frame quantity it names that is not there; a placement kind outside the known ones; or a placement that does not hold what its kind says (a joint placement with no joint, a non-joint one with a joint, a derived one with no bone, a constant that is not finite). Nothing is written | a proposer bug, not an input problem: report it with the line |
| <a id="KEYPOINTS_FILE_PRESENT"></a><a id="KEYPOINTS_IS_JSON"></a><a id="KEYPOINTS_KEY_KNOWN"></a><a id="KEYPOINTS_FIELD_PRESENT"></a><a id="KEYPOINTS_FIELD_TYPE"></a>`KEYPOINTS_FILE_PRESENT`, `KEYPOINTS_IS_JSON`, `KEYPOINTS_KEY_KNOWN`, `KEYPOINTS_FIELD_PRESENT`, `KEYPOINTS_FIELD_TYPE` | the `--keypoints` file is absent, not JSON, has a key this reader does not know, lacks one of `spec`, `space`, `width`, `height`, `source`, `people`, or holds a value of the wrong type (a size that is not a whole positive px count, an empty `source`, no people) | the keypoint file (§3, *A posed figure*) |
| <a id="KEYPOINTS_SPEC_KNOWN"></a><a id="KEYPOINTS_SPACE_STATED"></a>`KEYPOINTS_SPEC_KNOWN`, `KEYPOINTS_SPACE_STATED` | the file is not `spine-parts-keypoints/1`, or states a space other than painting-px, origin top-left, y down | convert the file to that space; it is not read as if it were in it |
| <a id="KEYPOINTS_JOINT_KNOWN"></a><a id="KEYPOINTS_JOINT_STATE"></a><a id="KEYPOINTS_POSITION_STATED"></a><a id="KEYPOINTS_POSITION_INSIDE"></a>`KEYPOINTS_JOINT_KNOWN`, `KEYPOINTS_JOINT_STATE`, `KEYPOINTS_POSITION_STATED`, `KEYPOINTS_POSITION_INSIDE` | a joint name outside body-18, a state outside observed / occluded / missing, an observed joint with no `at` or a missing one with one, or a position outside the `width`x`height` image | that joint |
| <a id="KEYPOINTS_PERSON_UNIQUE"></a><a id="KEYPOINTS_PERSON_CHOSEN"></a>`KEYPOINTS_PERSON_UNIQUE`, `KEYPOINTS_PERSON_CHOSEN` | two people share an id; or the file holds more than one person and no `--person` names one, or `--person` names none of them (the message lists the ids) | `--person <id>` |
| <a id="KEYPOINTS_IMAGE_SIZE"></a>`KEYPOINTS_IMAGE_SIZE` | the file's `width`x`height` is not the `--source` painting's | a file measured on this painting |
| <a id="PARTS_FILE_PRESENT"></a><a id="PARTS_IS_JSON"></a><a id="PARTS_KEY_KNOWN"></a><a id="PARTS_FIELD_PRESENT"></a><a id="PARTS_FIELD_TYPE"></a><a id="PARTS_NAME_UNIQUE"></a><a id="PARTS_FROM_KNOWN"></a><a id="PARTS_CUT_FROM_KNOWN"></a><a id="PARTS_BOX_INSIDE_RIG"></a><a id="PARTS_COUNTS_ADD_UP"></a><a id="PARTS_HOLES_LARGEST_FIRST"></a><a id="PARTS_HOLE_PART_KNOWN"></a><a id="PARTS_SINGLE_RUN_PAD"></a>`PARTS_*` (`PARTS_FILE_PRESENT`, `PARTS_IS_JSON`, `PARTS_KEY_KNOWN`, `PARTS_FIELD_PRESENT`, `PARTS_FIELD_TYPE`, `PARTS_NAME_UNIQUE`, `PARTS_FROM_KNOWN`, `PARTS_CUT_FROM_KNOWN`, `PARTS_BOX_INSIDE_RIG`, `PARTS_COUNTS_ADD_UP`, `PARTS_HOLES_LARGEST_FIRST`, `PARTS_HOLE_PART_KNOWN`, `PARTS_SINGLE_RUN_PAD`) | the `parts.json` read is not assemble's contract (`PARTS_COUNTS_ADD_UP`: `visible_px + occluded_px` is not `opaque_px`, `visible_not_projected_px` is above `visible_px`, or the `recomposite` block's figures disagree — more uncovered than error pixels, a hole larger than its box, the wrong number of holes listed, listed areas that do not sum to `uncovered_error_px`; the last two codes are the block's order and its border names; `PARTS_SINGLE_RUN_PAD`: the `single_run_pad` block's margins are not the centring, its file is not smaller than its square, or `rig_size` is not the file at the scale, issue #366 — §5) | re-run assemble; do not edit `parts.json` |

### compare

| rule | means | change |
| --- | --- | --- |
| <a id="STRUCTURE_FILE_PRESENT"></a><a id="STRUCTURE_FILE_IS_JSON"></a><a id="STRUCTURE_FORM"></a>`STRUCTURE_FILE_PRESENT`, `STRUCTURE_FILE_IS_JSON`, `STRUCTURE_FORM` | a `--left` or `--right` path is missing, not JSON, or not one of the three sides `compare` reads: a file that states a `spec` other than rig-c's rig spec, or none of `spec` (a rig.json), `key` (a config) or `bones` (a proposal) | the path |
| <a id="STRUCTURE_RIG_SPEC"></a><a id="STRUCTURE_NAME_RESOLVES"></a>`STRUCTURE_RIG_SPEC`, `STRUCTURE_NAME_RESOLVES` | rig-c's rig spec reader refuses a rig.json side (its words quoted), or a rig.json side's weight, constraint or skin names a bone or slot its own bones or slots do not declare | that side's file |
| <a id="STRUCTURE_MAP_FIELD"></a><a id="STRUCTURE_MAP_KEY_KNOWN"></a>`STRUCTURE_MAP_FIELD`, `STRUCTURE_MAP_KEY_KNOWN` | the `--map` file is not a JSON object stating `"spec": "spine-parts-bonemap/1"`, a field is of the wrong shape (`pairs` a list of [left name, right name]; `required` a list of left bone names, each once; `frame` `{"scale": <number above 0>, "offset": [x, y]}`, neither assumed; `note` a string), or it holds a key the reader does not read | the map |
| <a id="STRUCTURE_MAP_RESOLVES"></a><a id="STRUCTURE_MAP_ONE_TO_ONE"></a>`STRUCTURE_MAP_RESOLVES`, `STRUCTURE_MAP_ONE_TO_ONE` | a pair names a bone its side does not have (the detail says when it is a bone of the other side: a pair is [left, right]), or pairs one bone twice | that pair |
| <a id="STRUCTURE_REQUIRED_PRESENT"></a>`STRUCTURE_REQUIRED_PRESENT` | a bone the map's `required` names is absent on either side through the pairing; this is the comparison's own FAIL, printed after its lines, exit 1 | the side that lacks it, or the pairing |

### rig

| rule | means | change |
| --- | --- | --- |
| <a id="RIG_PART_PRESENT"></a><a id="RIG_PART_ATTACHED"></a>`RIG_PART_PRESENT`, `RIG_PART_ATTACHED` | a `meshes`/`regions` key that is not in `parts.json`, a part with neither, or a `painting:` part with a mesh | the config and the plan must name the same parts; a patch is a region |
| <a id="RIG_PNG_PRESENT"></a><a id="RIG_PNG_MATCHES_BOX"></a><a id="RIG_PART_HAS_ART"></a>`RIG_PNG_PRESENT`, `RIG_PNG_MATCHES_BOX`, `RIG_PART_HAS_ART` | a part's PNG is missing, the wrong size, or has no art pixel | re-run assemble |
| <a id="RIG_NAME_RESOLVES"></a><a id="RIG_SEGMENT_DEFINED"></a><a id="RIG_CHAIN_POINTS"></a>`RIG_NAME_RESOLVES`, `RIG_SEGMENT_DEFINED`, `RIG_CHAIN_POINTS` | a segment names an undeclared bone, a bone with no `tip` and no next link, or a chain too short to make a link | that bone's `tip`, or write the segment out as `[bone, [x0,y0], [x1,y1]]` |
| <a id="RIG_INFLUENCES_KEPT"></a>`RIG_INFLUENCES_KEPT` | a mesh's declared `influences` leaves a vertex with no bone: every capped share is under 0.03 (at or under it, for the continuous floor). The largest of k shares is at least 1/k, so this needs 34 or more kept bones; the default cap of 4 never reaches it (issue #284). The detail names the first vertex, how many more, and its largest share | declare `maxInfluences` 33 or less, or name fewer bones in `segments` |
| <a id="RIG_LATTICE_ONE_LOOP"></a>`RIG_LATTICE_ONE_LOOP` | the lattice over a part does not close into one outline even after the repair passes | that mesh's `grid` |
| <a id="RIG_CONTROL_NAME_FREE"></a>`RIG_CONTROL_NAME_FREE` | a keyed, mesh-weighted bone needs `<bone>_ctl` and that name is taken | rename the declared bone |
| <a id="RIG_HEAD_UP_NAME_FREE"></a>`RIG_HEAD_UP_NAME_FREE` | `config.bones` declares `head_up`, the bone the rig stage adds under `head` to carry the face's up axis (issue #250) | rename that bone |
| <a id="RIG_TIP_DISTINCT"></a>`RIG_TIP_DISTINCT` | a single bone's `tip` is its own `at`: a bone turns from its origin towards its tip (issue #239), and a tip on the origin has no direction | another `tip`, or leave the tip out |
| <a id="RIG_HEAT_BONE_SOURCE"></a>`RIG_HEAT_BONE_SOURCE` | under `meshes.<part>.rule` `"heat"`, a bone the mesh's `segments` bind holds no source pixel: no silhouette pixel centre within 0.75 px of its segment is nearer it than another bound bone's (the segment is quoted in rig px). A bone with no source is not weighted 0 | move its segment onto the art, take the bone out of `segments`, or keep this part on the distance rule (`rule` `"distance"`, or none: the rule is per mesh) |
| <a id="RIG_HEAT_ISLAND_SOURCE"></a>`RIG_HEAT_ISLAND_SOURCE` | under rule `"heat"`, a 4-connected island of the part's silhouette holds no bound bone's source pixel, so the heat equation has no answer there; nothing is borrowed from the nearest island. The detail gives the island's size and corner, and, for an island at mesh-draft's dust line, the `stray` that would leave it out | a segment within 0.75 px of the island, the `stray` the detail names, or the distance rule |
| <a id="RIG_HEAT_CONVERGED"></a>`RIG_HEAT_CONVERGED` | under rule `"heat"`, a bone's field still changes by more than the tolerance after the most sweeps the solve takes (the figures quoted); nothing half-solved is written | a smaller part, or the distance rule |
| <a id="FLATTEN_REGION_UPRIGHT"></a>`FLATTEN_REGION_UPRIGHT` | `flattenRig` (`src/rig.ts`), the reference's unturned form of a built rig — which only the repository's `scripts/rig_oracle.ts` calls, no command — met a region whose `rotation` does not cancel its bone's turn, so its flat form would be drawn turned | a repository tool's input, not an author's: report it with the line |
| <a id="RIG_TURN_NAME_FREE"></a>`RIG_TURN_NAME_FREE` | with `turn`: a twin (`turn_<part>_<bone>`), the control `turn` or a transform constraint `turn_<part>` the turn writes is a name the rig already holds | rename the declared bone or constraint |
| <a id="RIG_KEY_FRAME_UNTURNED"></a>`RIG_KEY_FRAME_UNTURNED` | a `translate` key on a bone whose parent is a chain link turned along its chain, or a `scale`/`shear` key (a track, or the blink's `eyes`/`brows` group) on a turned link: the key would act along the link's axis, not the picture's; the detail names the track, the bone and the turn | key the chain's own parent, or key `rotate`; a link whose turn is 0 (a level chain) keeps every key |
| <a id="RIG_BLINK_INSIDE_IDLE"></a>`RIG_BLINK_INSIDE_IDLE` | the blink runs outside the idle | `motion.blink.t` |
| <a id="RIG_BLINK_HOLD_SPANS_A_FRAME"></a>`RIG_BLINK_HOLD_SPANS_A_FRAME` | the tree's `BLINK.hold` is shorter than one frame at `IDLE_FPS`, so for some `motion.blink.t` no idle frame — and no frame of the loop — shows the closed eye; the detail counts the phases that miss and names the first | nothing in the config: `BLINK.hold` in `src/motion.ts`, at least `1/IDLE_FPS` s (§3) |
| <a id="CONFIG_LAYOUT_TARGET"></a>`CONFIG_LAYOUT_TARGET` | `config.limbs.<name>.layout` declares both or neither `before`/`after`, or a target declares both or neither `limb`/`part` | write one immediate placement side and one typed named target |
| <a id="CONFIG_LAYOUT_NAME"></a>`CONFIG_LAYOUT_NAME` | a layout names no declared target limb or produced part; a consumed source layer is not an emitted part | use the declared limb or produced segment/part names printed in the detail |
| <a id="CONFIG_LAYOUT_SCOPE"></a>`CONFIG_LAYOUT_SCOPE` | layout `parts` is empty, duplicated, nonconsecutive, foreign, or names a rider instead of an own source-bound segment part | select distinct consecutive own segment-part references; inherited riders are proven separately |
| <a id="RIG_LAYOUT_NONEXCLUSIVE"></a>`RIG_LAYOUT_NONEXCLUSIVE` | a requested segment family/target, or an accepted replay's bindings, span owners or leave the selected segment scope across base/alternate attachments | correct the named bindings or scope; mixed ownership is never forced and no stale proof is emitted |
| <a id="RIG_LAYOUT_UNREPRESENTABLE"></a>`RIG_LAYOUT_UNREPRESENTABLE` | the named slot family is absent, a target is not contiguous, the accepted slot population/adjacency changed, or final rig text is stale | use an emitted contiguous target and the exact final accepted source; unrelated slots are not absorbed |
| <a id="RIG_LAYOUT_CONFLICT"></a>`RIG_LAYOUT_CONFLICT` | layout declarations share a slot, target themselves, or form a reciprocal/chained pair; both field paths are printed | declare one disjoint pair, with each participating slot in only that placement |
| <a id="RIG_STILL_ROW_INSIDE_PART"></a><a id="RIG_STILL_ROW_CLEAR"></a><a id="RIG_STILL_PIECES_HAVE_ART"></a><a id="RIG_STILL_NAME_FREE"></a>`RIG_STILL_ROW_INSIDE_PART`, `RIG_STILL_ROW_CLEAR`, `RIG_STILL_PIECES_HAVE_ART`, `RIG_STILL_NAME_FREE` | a `motion.blink.still` row that is not strictly inside the part, that crosses art (a cut through art changes the render even at rest), that leaves one piece with no art, or whose `<part>_still` slot name another part already has | that entry's `row` — a row with no art between the crease and the lash line — or rename the other part |
| <a id="RIG_SET_COVERS_BONE"></a>`RIG_SET_COVERS_BONE` | `assemble.alternates[i].drawn.<bone>` (issue #476): a subset set in `parts.json` `alternates` (`parts` present) states a `drawn` world angle for a bone none of its covered slots ride; the detail names the bone, the set, and the covered bones | remove the uncovered bone from that set's `drawn`, or add the part that rides it to `parts` |
| <a id="RIG_INFLUENCE_REACH"></a>`RIG_INFLUENCE_REACH` | an influence mesh's `radius` is at or under the distance from its farthest lattice vertex to that vertex's nearest link (issue #378): a link pulls only when it is nearer than `radius`, so that vertex would be pulled by none. The vertex, where it is and the distance are named | a `radius` above the distance named, or a segment nearer that part of the art |
| <a id="RIG_INFLUENCE_LATTICE"></a>`RIG_INFLUENCE_LATTICE` | rig-c's segments lattice refused the part at the declared `cell` (no pixel of the part holds art, or the cell is not a whole number of at least 1); rig-c's message is quoted | a part with art, or a whole `cell` of at least 1 |
| <a id="RIG_RIGC_GREEN"></a>`RIG_RIGC_GREEN` | rig-c refused the rig; its own FAIL or compile-error line is quoted, and nothing was written. A `constraints` field rigc does not read, or a value it refuses, is this line in rigc's words (`constraint "aim" (ik) has a key this compiler does not read: "mixx" (did you mean "mix"?)`), as is `A25_DETACHED_BONE_PARENTAGE` on a declared scene target. So is an ik whose `bones` are more than two, or two of which the second is not the first's child: from rig-c 2.15.0 its rig-spec parser refuses both by name (`ik constraint "reach" names 3 bones …`, `ik constraint "reach": "hem1" is not a child of "body" ("hem0" stands between) …`; firejune/rigc#1205), and this package no longer refuses them itself (issue #103; it did from #92 while rigc's gate passed them). Under `--idle-keys ctl` a two-bone ik over a chain link and its child link is that second refusal too, because the child's `<link>_ctl` stands between them; rigc's remedy names the control, which a config cannot, so when rigc's line says that control alone stands between, the rig stage adds a sentence naming `--idle-keys direct` on the command that ran | the field rigc's line names; for the split pair, `rig --idle-keys direct` or `build --idle-keys direct`, as the line says, which keys the link in place — rig-c's own AUTHORING §5 maps each of its assertions (`node_modules/rig-c/docs/AUTHORING.md`) |

### mesh-draft

| rule | means | change |
| --- | --- | --- |
| <a id="MESH_DRAFT_FIGURE"></a>`MESH_DRAFT_FIGURE` | parts.json holds no part, or the figure is so short that `round(H / 37)` is 0: nothing raises the spacing | nothing to draft on this figure; author a `contour` entry by hand |
| <a id="MESH_DRAFT_LATTICE_GREEN"></a>`MESH_DRAFT_LATTICE_GREEN` | the config as written does not build or does not check PASS; each of its problems is quoted. The gate holds every candidate to the lattice it would replace, so that lattice must be green first | make `build` green, then run `mesh-draft` |
| <a id="MESH_DRAFT_BEND_NAMES"></a>`MESH_DRAFT_BEND_NAMES` | `motion.json` (with `animations_from`) already holds an animation named `mesh-draft <part> +15` or `-15`, the names the bend set is walked as | rename that animation |
| <a id="MESH_DRAFT_COMPARE_BUILD"></a>`MESH_DRAFT_COMPARE_BUILD` | rigc's gate refused one of the three comparison builds (the drafted rig with every candidate as its lattice, its candidate or its dense reference); rigc's lines are quoted | read rigc's line; nothing was written |
| <a id="MESH_DRAFT_COMPARE"></a>`MESH_DRAFT_COMPARE` | rig-c's `compareMeshesInMotion` refused the comparison's input, with rig-c's code | read rig-c's code; nothing was written |

A part that fails a reading is not a refusal: it keeps its lattice, the command
exits 0, and `mesh_draft.json` and the console name the reading and the amount.

### remesh

| rule | means | change |
| --- | --- | --- |
| <a id="REMESH_OUT_FRESH"></a>`REMESH_OUT_FRESH` | `--out` exists, or lies inside `--rig`: a revision is a new directory beside the input, never written over it | name a directory that does not exist yet |
| <a id="REMESH_INPUT_PRESENT"></a>`REMESH_INPUT_PRESENT` | `--rig` is not the directory `rig` writes: `rig.json`, `motion.json`, `mesh_report.json` or `images/` is missing | point `--rig` at a `rig` output (`build`'s `rig/`) |
| <a id="REMESH_INPUT_WRITTEN"></a>`REMESH_INPUT_WRITTEN` | `rig.json` or `mesh_report.json` is not the text this package's writer prints for its value (reformatted, or written by something else); the revision is spliced as text, so it could not carry every other byte over | use the files as `rig` wrote them |
| <a id="REMESH_MESH_JSON"></a>`REMESH_MESH_JSON` | `--mesh` is missing, does not parse, or is not one JSON object | write the entry `config.json` would hold at `meshes.<part>`; its fields are then the config loader's to judge (`CONFIG_*` at `meshes.<part>`) |
| <a id="REMESH_TARGET_MESH"></a>`REMESH_TARGET_MESH` | `--part` is not a `mesh` attachment of the input rig (`skins.default.<part>.<part>`), or not an entry of the config's `meshes` | name a part the rig meshes and the config states |
| <a id="REMESH_TARGET_CLOSED"></a>`REMESH_TARGET_CLOSED` | a `linkedmesh` borrows the part's geometry, or an animation keys a `deform` timeline on it: both index the vertex list the remesh replaces | remesh the source and its links together by rebuilding from the config |
| <a id="REMESH_BASELINE_MISMATCH"></a>`REMESH_BASELINE_MISMATCH` | the config as written does not build, or does not reproduce the input's part (its attachment, image or `mesh_report.json` row) or its bones — or, for an `auto` entry, its motion; the first differing leaf is named. A part the producer cannot reproduce is not one it can re-fit with every other byte kept | pass the config and parts the input was built from |
| <a id="REMESH_CANDIDATE_REFUSED"></a>`REMESH_CANDIDATE_REFUSED` | the rig stage refused the requested entry — its mode's own checks, an `auto` entry's bounds or its motion gate; each problem is quoted with its measured figure, and nothing was written | loosen the bound the quoted problem names, or ask for another mode |
| <a id="REMESH_REQUEST_HELD"></a>`REMESH_REQUEST_HELD` | the requested entry moves a bone (a `<bone>_ctl` added or dropped), a motion key, or the part's image: no longer a remesh of one part | make it a config change and rebuild |
| <a id="REMESH_PRESERVED"></a>`REMESH_PRESERVED` | the spliced revision differs from the input outside the part's attachment and its report row; the file and the part that moved are named | a defect in this package: report it with the line |
| <a id="REMESH_RIGC_GREEN"></a>`REMESH_RIGC_GREEN` | rigc's build gate refused the revision (its lines quoted), or `rigc --version` named no version for the provenance | read rigc's line; nothing was written |
| <a id="REMESH_CHECK_HELD"></a>`REMESH_CHECK_HELD` | `check` on the revision did not measure a bar it measured on the input, or failed a bar the input met; the revision's own FAIL line is quoted | ask for a finer entry, or a different mode, for the part the line names |
| <a id="REMESH_DELTA_JSON"></a>`REMESH_DELTA_JSON` | `--delta` is missing, does not parse, is not one object, its `schema` is not `rig-review-mesh-edit/1`, or `slot`, `skin`, `attachment` or `source` is not of its shape | export the mesh edit from rig-c/review as it writes it |
| <a id="REMESH_DELTA_BASIS"></a>`REMESH_DELTA_BASIS` | the mesh edit's `basis` is not `"setup"`: it was drawn over a pose, and the producer binds setup positions, so it is refused rather than posed back (the basis found is quoted) | edit the mesh in setup space (rig-c/review #100) and export again |
| <a id="REMESH_DELTA_OPS"></a>`REMESH_DELTA_OPS` | `ops` is not an array, or holds more than 300 ops — review's own cap per attachment | split the edit: apply the first part, then edit the revision |
| <a id="REMESH_DELTA_SOURCE"></a>`REMESH_DELTA_SOURCE` | the mesh edit was not drawn over this part's mesh: its `slot` or `attachment` is not `--part`, its skin is not `default`, a `source` count (`vertexCount`, `triangleCount`, `hullLength`) or `source.hash` is not the input's (both figures quoted; the hash is SHA-256 of the part's entry in rigc's `skeleton.model.json` over the input); or the input's bindings are not where its uvs and `parts.json` place the image, so no position can be bound | export the edit from the revision you pass as `--rig` |
| <a id="REMESH_DELTA_OP"></a>`REMESH_DELTA_OP` | one op, named `ops[i]` and quoted, does not apply at its place in the replay: an unknown kind, a non-finite number, an id out of range or already removed, a `from` that is not the live position within 0.001 px, a position outside the part's image, a split of an edge the producer's triangulation does not hold or outside its triangles, a free `add` outside every triangle, a move that folds its ring, a removal that leaves fewer than 3 vertices, ends a constraint or leaves a ring no ear clips, an `edge` that duplicates a constraint, is a hull edge, runs through a vertex or crosses the hull or a constraint, or an `unedge` of any edge this edit did not constrain | read the op the line names; an edge the producer flipped is not one review can unedge — redraw it with `edge`, or move the vertices |
| <a id="REMESH_DELTA_TOPOLOGY"></a>`REMESH_DELTA_TOPOLOGY` | the replayed mesh breaks an outline rule (`contourTopologyProblems`' code quoted: one loop, the hull first, every triangle wound one way, no self-intersection, no coincident vertices), or holds more interior edges that are not locally Delaunay than the input did; or the input's own triangles are not wound one way | read the quoted code; the ops that made it are the edit's last ones |
| <a id="REMESH_BONE_ORDER"></a>`REMESH_BONE_ORDER` | a bone of the input names a parent that is not declared before it — later in `bones` (`bones[i]` named), or nowhere once rig-c has expanded the rig's `stops` (issue #613). The delta's positions are read through the setup frames, which rig-c poses parents first, as rigc's rig reader resolves them (`CE_RIG_BONE_PARENT_ORDER`); the bones are not sorted into an order rigc would not load. rigc's gate over the input refuses such a rig first, so the line means rigc and its library read the bones apart | a defect between this package and rigc: report it with the line |
| <a id="REMESH_INPUT_CHECK_FILE"></a>`REMESH_INPUT_CHECK_FILE` | `--input-check` names no file, a file that does not parse, one whose `spec` is not `rig-parts-input-check/1`, or one whose `versions`, `options`, `rig`, `parts` or `check` is not of the record's shape (issue #617); read before anything is built, nothing written | pass the `input-check.json` a `--record-input-check` run wrote |
| <a id="REMESH_INPUT_CHECK_BOUND"></a>`REMESH_INPUT_CHECK_BOUND` | a row of the `--input-check` record is not this run's (issue #617): a file under `--rig` or `--parts` (`parts.json`, `parts/`) added, missing or of other bytes, the rig or parts directory, the requirements file (absent, present, or of another path or bytes), `--page-edges`, `--pack-shape`, this package's version or `rigc --version`'s output; the row, the value recorded and the value required are named. The record is a check of another input, so it is not reused; nothing was built or written | run once with `--record-input-check` over this input, or leave `--input-check` off to measure the input again |
| <a id="REMESH_INPUT_CHECK_MOVED"></a>`REMESH_INPUT_CHECK_MOVED` | under `--record-input-check`, a file under `--rig` or `--parts` (or the requirements file) is not the same bytes after check-input read it as when the input was first hashed; the file and both digests are named. The check may have measured bytes the record's rows do not name, so neither the record nor the revision is written | leave the input alone while the run measures it, and run again |
| <a id="REMESH_BONES_POSED"></a>`REMESH_BONES_POSED` | rig-c cannot pose the input's bones at the setup pose — its expansion of the rig's `stops`, or its evaluation of the bones (a bone `inherit` the runtime resolves to no mode), refuses with the sentence quoted; nothing was written | read rig-c's sentence; rigc's gate over the input passed, so report it with the line |

A remesh changes one part's mesh and nothing else: every file of the input but
`rig.json` and `mesh_report.json` is copied as bytes, `rig.json` keeps every byte
outside the part's attachment, and the parts the config does not reproduce — repairs
accepted after the config was written — are carried over as they are. `remesh.json`
names the input's SHA-256 per file, the request, both versions, the part's counts
before and after and both checks, and quotes `check`'s own physics line as the scope
of the revision's check. Each check side carries what the hold reads (`pass`,
`measured`, `not_met`, `skipped`, `physics`) and, from issue #541, what `check`
itself reports on that tree: `line`, the last line it prints (`check: PASS; …`),
byte for byte — one function composes it for both — and `status`, every block's
status as that tree's `check.json` records it (`gate`, `loop` and `seam` from their
figures, every other block its own `status`: `PASS`, `FAIL`, `SKIP`, `WARN`,
`CLEAR`, `REPORTED`). A consumer need not run `check` again on the revision: it
binds the block to the files by the `revision` hash rows. A warning's status is
carried, never held: a revision whose `CLOTH_SETTLES` is a `WARN` where the input's
is `CLEAR` is written.

**The input's check, measured once** (issue #617). Every remesh runs `check` on the
input as well as on the revision, and for a strip of candidates against one inspected
rig the input's check is the same every time. `--record-input-check` writes
`input-check.json` into `--out` beside `remesh.json` (spec `rig-parts-input-check/1`):
what that check read — every file under `--rig`, `parts.json` and every file under
`parts/` by SHA-256, the two directories as resolved (check's own text can name them),
the requirements file's path and SHA-256, `--page-edges`, `--pack-shape`, this package's
version and `rigc --version`'s whole output — and the input's check side as
`remesh.json` carries it. A later run given `--input-check <input-check.json>` compares
every row with its own input before anything is built; when every row is its own it
prints `check-input: not run — <file> (rig-parts-input-check/1) is bound to this input
by N sha256 row(s) …` in place of the input's check, and its `check.input` is the
recorded one, byte for byte. A row that is not its own is refused by name
(`REMESH_INPUT_CHECK_BOUND`, the row, the value recorded and the value required), and
nothing is written. The record's rows are hashed when the run starts and again right
after the input's check has read the input; a file that moved in between is refused by
name with both digests (`REMESH_INPUT_CHECK_MOVED`), so a record never pairs rows with a
check measured from other bytes. The revision is always measured. `retune` reads and writes the same
record, so either command's serves the other over the same input. Without either flag
nothing printed or written changes.

**`--delta <mesh-edit.json>`** (in place of `--mesh`, exactly one of the two; issue
#526) reads rig-c/review's mesh edit, `rig-review-mesh-edit/1`: `slot`, `skin`,
`attachment`, `source` (`vertexCount`, `triangleCount`, `hullLength`, `hash`), `units`,
`basis` and up to 300 `ops`, each one of `move {v, from, to}`, `add {at, onEdge?}`,
`remove {v}`, `edge {a, b}` and `unedge {a, b}`. Positions are crop px of the rig canvas
(x right, y down): a vertex's position is its part-local px (`uv × (width, height)`)
plus the image's origin, `parts.json`'s `x, y` less the pad of 4. Vertex ids are the
attachment's indices; an added vertex takes the next id; a removed id is never reused.
`basis` must be `"setup"`. Review only records the ops; the producer retriangulates,
replaying them in order over the input part's own mesh:

- `move`: `from` must be the live position within 0.001 px; the uv and every binding's
  bone-local `x, y` are recomputed from `to` through the setup frames, the shares kept.
  The setup frames are the bones as rigc reads them (issue #613): a rig with `stops` is
  expanded first by rig-c's own `expandStops`, so a link that hangs from a drawn link
  `<link>_d` — which `rig.json`'s `bones` never declares — is posed on it; a rig
  without `stops` is posed from its `bones` as written. A bone the frames cannot pose
  is refused by name (`REMESH_BONE_ORDER`, `REMESH_BONES_POSED`).
- `add` with `onEdge`: the edge is split, two triangles into four (one into two on a
  hull edge, whose loop gains the vertex); its shares are the two ends' blended by the
  parameter along the edge. Without `onEdge`: the triangle holding the point is split in
  three (on an edge, as `onEdge`), its shares the corners' barycentric blend. Both are
  rounded as the lattice rounds shares (5 places, the heaviest closing the sum).
- `remove`: the vertex and its triangles go, and the ring is ear-clipped by exact
  orientation; a hull vertex's two hull neighbours become adjacent.
- `edge`: a constraint — an existing edge is marked, a missing one is made by flipping
  the edges its segment crosses.
- `unedge`: only an edge this edit constrained. Every other edge belongs to the
  producer's triangulation, which differs from the one review drew as soon as a flip
  runs, so an `unedge` of it is refused rather than guessed at.

After every op the Delaunay condition is restored by edge flips that never flip a hull
edge or a constraint, and the result is measured: the outline rules and no more
non-Delaunay interior edges than the input had. The output writes the hull loop first,
the other vertices after in id order, uvs to 6 places and bindings as `rig` writes them;
every vertex the edit neither moves nor removes keeps its uv pair and weight entries
byte for byte. No config entry is built — the baseline is the input itself, held to the
edit by `source`'s counts and `source.hash` (rigc's build over the input) — and the
part's `mesh_report.json` row is the input's with `vertices`, `triangles`, `hull`,
`bones`, `max_influences` and `mean_influences` recomputed and `mode` "delta"; its other
keys describe the mesh the edit was drawn over. The splice, the preserve assertion, the
gate and `check` are the `--mesh` path's. A constraint is a statement about this
revision's triangulation only: the rig spec has no field for it, so a later edit of the
revision reads it as any other edge.

### retune

| rule | means | change |
| --- | --- | --- |
| <a id="RETUNE_OUT_FRESH"></a>`RETUNE_OUT_FRESH` | `--out` exists, or lies inside `--rig`: a revision is a new directory beside the input, never written over it | name a directory that does not exist yet |
| <a id="RETUNE_INPUT_PRESENT"></a>`RETUNE_INPUT_PRESENT` | `--rig` is not the directory `rig` writes: `rig.json`, `motion.json`, `mesh_report.json` or `images/` is missing | point `--rig` at a `rig` output (`build`'s `rig/`, or a `remesh` or `retune` revision) |
| <a id="RETUNE_INPUT_WRITTEN"></a>`RETUNE_INPUT_WRITTEN` | `rig.json` or `motion.json` is not the text this package's writer prints for its value (reformatted, or written by something else); the revision is spliced as text, so it could not carry every other byte over | use the files as `rig` wrote them |
| <a id="RETUNE_CONFIG_REFUSED"></a>`RETUNE_CONFIG_REFUSED` | the rig stage refused the config as written — the loader, a mesh's own checks, an `auto` mesh's motion gate under the new idle, or rigc's gate; each problem is quoted, and nothing was written | change the field the quoted problem names |
| <a id="RETUNE_REQUEST_HELD"></a>`RETUNE_REQUEST_HELD` | the config's build does not state the input's `stops`, `bones` (a bone moved, renamed, added, re-inherited, or a `<bone>_ctl` added or dropped), `slots`, `skeleton`, `images`, an image file, an `invariants` entry other than `detached`, or a byte of `motion.json` outside `animations.idle` (`animations_from`, the groups, the easings, the face deform); the first differing leaf is named | make it a config change and rebuild with `rig --config` |
| <a id="RETUNE_PRESERVED"></a>`RETUNE_PRESERVED` | the spliced revision differs from the input outside `rig.json`'s `constraints` and `invariants.detached` and `motion.json`'s `animations.idle`; the file and the path that moved are named | a defect in this package: report it with the line |
| <a id="RETUNE_RIGC_GREEN"></a>`RETUNE_RIGC_GREEN` | rigc's build gate refused the revision (its lines quoted), or `rigc --version` named no version for the provenance | read rigc's line; nothing was written |
| <a id="RETUNE_CHECK_HELD"></a>`RETUNE_CHECK_HELD` | `check` on the revision did not measure a bar it measured on the input, or failed a bar the input met; the revision's own FAIL line is quoted | soften the constraint or the idle track the line names |
| <a id="RETUNE_INPUT_CHECK_FILE"></a>`RETUNE_INPUT_CHECK_FILE` | as [`REMESH_INPUT_CHECK_FILE`](#REMESH_INPUT_CHECK_FILE), under `retune` | pass the `input-check.json` a `--record-input-check` run of either command wrote |
| <a id="RETUNE_INPUT_CHECK_BOUND"></a>`RETUNE_INPUT_CHECK_BOUND` | as [`REMESH_INPUT_CHECK_BOUND`](#REMESH_INPUT_CHECK_BOUND), under `retune`; read before the rebuild | run once with `--record-input-check` over this input, or leave `--input-check` off |
| <a id="RETUNE_INPUT_CHECK_MOVED"></a>`RETUNE_INPUT_CHECK_MOVED` | as [`REMESH_INPUT_CHECK_MOVED`](#REMESH_INPUT_CHECK_MOVED), under `retune` | leave the input alone while the run measures it, and run again |

A retune replaces a rig's physics and its idle and nothing else. The config is built
once through the rig stage; from that build `rig.json` takes `constraints` and
`invariants.detached` (which the rig stage derives from the constraints), and
`motion.json` takes `animations.idle`. Every other byte is the input's: every
attachment and image, every `mesh_report.json` row and every other animation, so a
mesh the config does not reproduce — a `remesh` revision, or a repair accepted after
the config was written — is carried over as it is. What the build must state as the
input does is held, and a config that moves it is refused rather than half-applied:
a `stops` change (it rewires bones, slots and weights onto the drawn links
`<link>_d`, so it is outside what a retune holds byte for byte), a moved, renamed or
re-`inherit`ed bone, a new control bone under `--idle-keys ctl`, a redrawn image, or a
change to `animations_from`. No mesh is compared or written, so a `meshes` change in
the config is left out of the revision — `retune.json`'s `held.not_compared` says so;
`remesh` is the producer of a mesh. `retune.json` names the input's SHA-256 per file,
what was held, which constraint fields changed (and which constraints were added or
removed), how many idle tracks changed and the idle's duration before and after, both
versions and both checks, and quotes `check`'s own physics line as the scope of the
revision's check. The check sides are `remesh`'s, `line` and `status` included
(issue #541): `check`'s own last line and every block's status on that tree, so a
consumer binds them to the revision by the `revision` hash rows instead of running
`check` a second time.
`--record-input-check` and `--input-check` are `remesh`'s (issue #617; see *The
input's check, measured once* above), read before the rebuild and refused as
`RETUNE_INPUT_CHECK_BOUND`, `RETUNE_INPUT_CHECK_FILE` and `RETUNE_INPUT_CHECK_MOVED`.

### rig-c's mesh refusals, quoted in a line

rig-c's mesh library refuses a malformed input by throwing with a code of its own. This
package does not print those as lines of their own: it quotes the code inside its own
line — `AUTO_MESH_INPUT` and `AUTO_MESH_MOTION_INPUT` (§3, *An automatic mesh*),
`MESH_DRAFT_COMPARE`, and the `residual not measurable: <bone> <CODE>` clause of an
automatic mesh's row — and the row is here, not in rig-c's guide (rig-c's mesh
documents do not ship). Each is an input this package built; none is an author's field.

| rule | means | change |
| --- | --- | --- |
| <a id="REDUCE_INPUT_MISSING"></a>`REDUCE_INPUT_MISSING` | a field of the input this package handed rig-c's `reduceMesh`, `measureMeshQuality` or `skinningEnvelopeBone` is missing or not of its shape (rig-c gives no field a default); the field and what it requires are quoted | an input this package built, not an author's: report it with the line |
| <a id="REDUCE_INPUT_LINE"></a>`REDUCE_INPUT_LINE` | the input names a line source without the lines it indexes, or a line source that is not `{ id, mesh }` | an input this package built, not an author's: report it with the line |
| <a id="REDUCE_MASK_SIZE"></a>`REDUCE_MASK_SIZE` | the art mask handed with a part is not a whole, non-empty size, or holds a byte count other than width × height | an input this package built, not an author's: report it with the line |
| <a id="REDUCE_ART_RASTERS_MISMATCH"></a>`REDUCE_ART_RASTERS_MISMATCH` | the art rasters passed beside an input were taken for another input (another mask size, threshold or frame), or the step rasters were made over another rasters object | an input this package built, not an author's: report it with the line |
| <a id="REDUCE_UV_RANGE"></a>`REDUCE_UV_RANGE` | a source vertex's UV is outside 0..1 beyond rig-c's slack (its A22) | an input this package built, not an author's: report it with the line |
| <a id="REDUCE_THRESHOLD_RANGE"></a>`REDUCE_THRESHOLD_RANGE` | the art threshold is not a whole number in 1..255 | an input this package built, not an author's: report it with the line |
| <a id="COMPARE_INPUT_MISSING"></a>`COMPARE_INPUT_MISSING` | a field of the input this package handed rig-c's `compareMeshesInMotion` is missing or malformed, two builds share an id, or one attachment is listed twice | an input this package built, not an author's: report it with the line |
| <a id="COMPARE_INPUTS_DIFFER"></a>`COMPARE_INPUTS_DIFFER` | a candidate build differs from the reference outside what the comparison may vary (the compared mesh's vertices, UVs, triangles, hull, edges and weights); the path and both values are quoted | an input this package built, not an author's: report it with the line |
| <a id="COMPARE_REFERENCE_FAILS"></a>`COMPARE_REFERENCE_FAILS` | the reference — the unreduced source — fails its own art fit at the setup pose (coverage, overshoot or undercut against `sourceBounds`); a deviation from a reference that does not carry its own art is not evidence | the source, which is the author's: `meshes.<part>.auto.sourceBounds`, or the source's `spacing` or outline (`auto.source`) |
| <a id="COMPARE_UV_CARRIER_NOT_UNIQUE"></a>`COMPARE_UV_CARRIER_NOT_UNIQUE` | a sample lies in two UV triangles that do not meet there at a shared vertex or edge: the mesh's UVs overlap or fold, so no one triangle carries it | an input this package built, not an author's: report it with the line |
| <a id="COMPARE_WARMUP_UNSUPPORTED"></a>`COMPARE_WARMUP_UNSUPPORTED` | a physics warm-up other than 0 was asked of the comparison; physics resets at time 0 and steps from there | an input this package built, not an author's: report it with the line |
| <a id="SKINNING_RANGE_UNSUPPORTED"></a>`SKINNING_RANGE_UNSUPPORTED` | `skinningEnvelopeBone` was handed a bone range not declared by the bone's own keys (a physics swing, a range read off a posed schedule), or a bone whose setup scale is not uniform; the bound is not proven, so it is refused | nothing to change for the build: inside the residual clause it means the residual veto was not applied to that bone, and the motion comparison decides |

### check and build

| rule | means | change |
| --- | --- | --- |
| <a id="CHECK_RIGC_PRESENT"></a>`CHECK_RIGC_PRESENT` | no `rigc` binary found (every place looked is listed) | `bun install` |
| <a id="CHECK_RIGC_PACKAGE"></a>`CHECK_RIGC_PACKAGE` | `node_modules/.bin/rigc` is missing under the package root named: this lookup (the selftest's, issue #337) takes this package's own rigc and no other — no directory above, no `PATH` | `bun install` in that root |
| <a id="CHECK_INPUT_PRESENT"></a><a id="CHECK_INPUT_IS_JSON"></a><a id="CHECK_PART_PNG_PRESENT"></a><a id="CHECK_PART_PNG_MATCHES_BOX"></a><a id="CHECK_PART_SLOT_PRESENT"></a><a id="CHECK_RIG_STAGE_PRESENT"></a><a id="CHECK_RIG_STAGE_IS_THE_CANVAS"></a><a id="CHECK_RIG_ROOT_BONE"></a><a id="CHECK_IDLE_PRESENT"></a>`CHECK_INPUT_PRESENT`, `CHECK_INPUT_IS_JSON`, `CHECK_PART_PNG_PRESENT`, `CHECK_PART_PNG_MATCHES_BOX`, `CHECK_PART_SLOT_PRESENT`, `CHECK_RIG_STAGE_PRESENT`, `CHECK_RIG_STAGE_IS_THE_CANVAS`, `CHECK_RIG_ROOT_BONE`, `CHECK_IDLE_PRESENT` | the rig directory is incomplete or disagrees with `parts.json` (`CHECK_PART_SLOT_PRESENT`: a part with no slot of its own name, which the judgement lines render it by; `CHECK_INPUT_PRESENT` on `--set` / `--all-sets`: no `parts.json`, no `alternates`, or the named set is not in `alternates`). `motion.json` is required even with no animation in it, because `rigc build` takes `--motion` (a spec with `"animations": {}` builds green); `CHECK_IDLE_PRESENT` is an `idle` that is there with no positive `duration` — an absent `idle` is measured around (§7). `CHECK_INPUT_PRESENT` on `…/parts.json`: `--parts` named a directory without `parts.json` — most often `parts/` itself — or, without `--parts`, the rig directory has none while the directory above it does (build's layout, `<out>/rig` under `<out>/parts.json`). The detail says it: "--parts names the directory holding parts.json and parts/, not parts/ itself (after build, that is build's --out, whose rig is <out>/rig); without --parts it is --rig", and names the parent when the parent holds `parts.json`. With neither (no `--parts`, and no `parts.json` beside `rig.json` or above it), the rig is measured without parts and nothing is refused (§7) | re-run rig (`build` does both); for `…/parts.json`, `--parts` — the directory above `parts/` |
| <a id="CHECK_SOURCE_SIZE"></a>`CHECK_SOURCE_SIZE` | the painting `--source` names is not this rig's: no single `rig_scale` takes its width and height to the stage's (assemble makes the canvas `trunc(w × rig_scale)` x `trunc(h × rig_scale)`), or, with `parts.json` read, its `scale_rig_per_source` does not; or the stage is not whole pixels. Refused before anything is built | the painting the rig was made from — the stage's own size, or the painting `assemble` was given |
| <a id="CHECK_SOURCE_PNG"></a>`CHECK_SOURCE_PNG` | `--source` names a file that does not read as a PNG | a PNG |
| <a id="CHECK_SOURCE_GRID"></a>`CHECK_SOURCE_GRID` | the setup-pose still and its black-tinted twin (the coverage `SETUP_POSE_VS_SOURCE` reads) did not come back on one grid over one opaque background | a rigc problem; report it |
| <a id="CHECK_RIGC_VERSION"></a>`CHECK_RIGC_VERSION` | `rigc --version` is below 1.4.0, or prints no version: its `render` has no `--geometry`, which `TEXTURE_STRETCH` reads. Refused before anything is built | `bun install` (this package depends on rig-c ^2.20.4), or put a newer `rigc` first on `PATH` |
| <a id="CHECK_RIGC_ENTRY"></a><a id="CHECK_RIGC_ENTRY_READS"></a>`CHECK_RIGC_ENTRY`, `CHECK_RIGC_ENTRY_READS` | `rigc --version` names no entry (a rigc below 2.0.0), or names one in neither launcher form (`entry: cli.ts — @esotericsoftware/spine-core <v> present`, `entry: cli_core.ts — @esotericsoftware/spine-core absent — …`); `check.json`'s `rigc_entry` records the one that gated the build | `bun install` |
| <a id="CHECK_RIGC_GREEN"></a>`CHECK_RIGC_GREEN` | a rigc step failed; its line is quoted | as `RIG_RIGC_GREEN` |
| <a id="CHECK_LOOP_LAST_FRAME_AT_DURATION"></a>`CHECK_LOOP_LAST_FRAME_AT_DURATION` | the idle's last frame does not sit at `duration` | `motion.duration` — a whole number of 1/12 s |
| <a id="CHECK_LOOP_CLOSES"></a>`CHECK_LOOP_CLOSES` | frame 0 and the frame at `duration` differ (max and first pixel quoted); with a physics constraint, the frames of the rig with every physics constraint left out, and the object says so (§7, *loop*) | a track whose last key is not its first |
| <a id="CHECK_SEAM_WITHIN_BAR"></a>`CHECK_SEAM_WITHIN_BAR` | the setup pose (or, under `--set <name>` / `--all-sets`, an alternate set's setup pose posed at its `drawn` bone angles with its `<set>_*` attachments and `hides` applied, issue #465) does not reproduce the flat stack of parts (`recomposite_rig.png`, or `recomposite_rig_<set>.png`) | read the `seam pair` lines and `check/seam/` (`check/seam_<set>/`) pictures (§7; magenta = a counted pixel, cyan = the box round them): the pair, its boxes and the pixels counted. Usually a region or mesh placed off its part; compare with `recomposite_rig.png` (`recomposite_rig_<set>.png`). A pair of one layer cut in two with `differing_copies_px` is the cut line: move the polygon's edge, not `overlap` |
| <a id="CHECK_BREATH_VISIBLE"></a>`CHECK_BREATH_VISIBLE` | the breath alone barely moves the torso (`topwear`, rendered alone, the idle with and without its breath tracks — issue #411; the whole idle's figure is printed beside it, and motion that is not the breath's is not counted), or the idle has no breath track at all — or the feet (`footwear`), rendered alone, move at all | the chest's breath tracks (`motion.tracks` on `chest`), or the torso mesh's `segments`; for the feet, the bone their region rides (`regions.<part>`, `root` in both examples) |
| <a id="CHECK_BLINK_NO_HOLE"></a>`CHECK_BLINK_NO_HOLE` | with the blink held shut, the eyewhite box shows the page where the open eye had art | the layer under the eye: the `face` part has no art there. Take the face from the other run, or add a part under the eye; `motion.blink.squash` only hides the hole less |
| <a id="CHECK_CHAIN_LAG"></a>`CHECK_CHAIN_LAG` | a rotate track leads (or does not lag) the keyed bone above it, or a chain link swings less than the link above — or, in a chain that carries a part the scene file declares `rests`, more than the link above (issue #245; the object names the part and the file). A lag refusal (issue #580) prints the step, then the two phases it read — as the sine reader returns them, a negative amplitude read as amplitude > 0 at phase + 0.5 — then their difference, folded into (−¼, ¼] cycle because a sine's sign is half a cycle (so flipping an amplitude's sign does not change the step), then the child phases that pass for this parent: `phase step -0.230 cycle(s); >= 0.001 is required — … Phases read: "chest" 0.000, "sleeve_l0" 0.270 …; the step is their difference, 0.270, folded into (-1/4, 1/4] cycle … here a "sleeve_l0" phase in [0.001, 0.250] or [0.501, 0.750]` | for a lag, that chain track's `phase`/`lag`: a child phase from the parent's + 0.001 to + 0.25, modulo 0.5 — the windows the line prints. A larger phase helps only inside them: a child 0.25 to 0.5 above its parent still reads as a lead, and a negated `amps` moves nothing. For a swing, its `amps` (non-decreasing toward the tip; non-increasing on a chain declared resting) |
| <a id="CHECK_TIP_OVER_ROOT"></a>`CHECK_TIP_OVER_ROOT` | a `handwear`/`bottomwear` part's art in the lower half of its box travels less than 1.4725 times as far as in the upper half, measured from the idle's posed geometry (rig px quoted) | the chain track's `amps` (grow toward the tip), or the mesh's `segments` (the chain must be among them), or its mode: on `scarf`'s short skirt the proposal's lattice read 1.207 and the same part in `contour` mode 1.738 with the same segments and idle (issue #118) — both carried the `chest` segment #262 removed, after which the lattice reads 3.487. When the detail says `the root travels with the breath (x px of y px): it is carried by \`<bone>\`` (issue #262) the chain is not the cause: a bone an idle `translate` track moves (the breath) moves the root more than the tip, and with that translate held still (the part posed again without it, in proportion to each vertex's weight on the bone and those under it) the ratio passes — the row adds `carried_by`, `breath_rig_px`, `root_without_breath_rig_px` and `tip_without_breath_rig_px`; take that bone's segment off the mesh, or bind the root to the bone the part hangs from. A part the scene file declares `rests` (issue #245) is held the other way, its tip half's travel at most its root half's (ratio ≤ 1); the detail then reads `the scene file's rests declares its tip at rest, so a ratio <= 1 is required`, and for it the fix is the chain's `amps` (shrinking toward the tip) or the mesh's tip weighted to a bone the idle does not swing |
| <a id="CHECK_STILL_REGIONS_DARK"></a>`CHECK_STILL_REGIONS_DARK` | a slot of the face's still set (the `face` slots and every slot drawn over the face that the head bone alone carries) moves relative to the bone the face's slot rides, or a `footwear` slot moves on the screen, by more than the arithmetic's own rounding — measured from the idle's posed geometry (the slot, its largest displacement in rig px, the idle frame and the tolerance quoted) | on the face: a face mesh with a weight on a bone other than the head (`segments`), or one deformed by another bone; on the feet: a mesh weighted to a swinging bone, or a region on the wrong bone. A bang swinging over the face is not this line's failure: its depth is reported (`crossing`), with no bar |
| <a id="CHECK_TEXTURE_STRETCH"></a>`CHECK_TEXTURE_STRETCH` | a mesh triangle's edge, in some idle frame, is more than 1.926544 times its rest length or less than 1/1.926544 of it (the mesh, triangle, its three vertices, the edge and the frame are named, and — issue #314 — the bones the edge's two vertices hang on: each vertex's two largest weights from `rig.json`, `vertex <i> is weighted to "<bone>" <w>, …`, then `on the idle's chains, the chain from "<first link>" carries "<bone>", …` — each chain `CHAIN_LAG` reads named once, by its first link — with a bone on no chain said, or `none of these bones hangs on a chain of the idle`); or a rest edge has length 0 | the chain tracks' `amps` on the bones that mesh is weighted to (the stretch grows with them), or the mesh's `segments` — a vertex blending two bones that swing against each other. Two chains named, with opposed amplitudes: give both one sign, or drop one — `propose --from-config` measures the pair before a build (§3, *Two chains on one lattice*). An edge whose two ends disagree on whether a bone's small share survives the 0.03 cut (one vertex keeps the bone at a few hundredths, the next drops it — read the two vertices' weights the line quotes): declare `influences: {floor: "continuous"}` on that mesh first, `rule: "heat"` second; the weight `exponent` moves the figure without removing the cut (issue #115, `reference-demo` `hair_back` as contour at tolerance 1, rig-c 2.47.1: 2.535 as drafted; continuous floor 1.422, heat 1.816, both PASS; exponent 1.5 / 3 / 4 / 6 read 2.564 / 1.902 / 2.119 / 4.816, the one pass on the same cut at another edge) |
| <a id="CHECK_ANIMATIONS_DO_NOT_FOLD"></a>`CHECK_ANIMATIONS_DO_NOT_FOLD` | an animation, the idle included, turns a mesh triangle over against the setup pose on some frame, read by `rigc render --folds` over the build with its physics on — and with its physics constraints left out beside it when the rig declares any, so each row reports `physics_on` and `physics_off` side by side (issues #320, #333, #363); the object names the animation and the mesh, the detail quotes rigc's line — the frames, the worst frame, which triangles, their world box and setup-pose area — and when the fold appears only with physics on, names the physics constraint(s) on the mesh's bones and the worst frame. After rigc's line it names what the worst frame's folded triangles hang on (issue #567), in `TEXTURE_STRETCH`'s words: each vertex's dominant bone is its largest weight in `rig.json`, the triangles whose vertices share one set of dominant bones are one group (the set in `rig.json`'s bone order), and each group lists its first 6 triangles (`triangles 63, 78, 79 dominated by "knee_r", "knee_l"`, past 6 `… and N more`) and spells out its first triangle's vertices — the largest two weights of each, and the idle chains those bones hang on; 3 groups are written and the rest counted (`; … and N more group(s), M triangle(s)`). An attachment the skin does not hold, or a triangle its table does not reach, is said, not guessed. Or a `may_fold` entry of the `--requirements` file names a slot and animation that does not fold: an exception that excepts nothing | the physics constraint(s) the line names (lower `inertia`, raise `strength`, or lower `damping`), the clip's keys on the bones the line names (a bend past what the weights carry, two bones turned toward each other until the rows between them pass, a translate that carries one row of vertices past the next), or the mesh's `segments`; to look, `rigc inspect --candidate <out>/check/build --show art,folds,mesh --animation <name> --at <the worst frame's time> --zoom folds`. A fold the art means (a sleeve behind the body) is declared, `"may_fold": [{ "slot": …, "animation": …, "why": … }]` (§7, *Declared requirements*); a stale entry is taken out |
| <a id="CHECK_FEET_STAY_LEVEL"></a>`CHECK_FEET_STAY_LEVEL` | a `footwear` part riding a bone that hangs from another turns more than ±10 degrees from its setup pose on a frame where a bone above that bone is turned (issue #348) — the bar is HQ's line (rig-c/parts#347 ruling 4), not a figure measured here; the object names the part, its bone and the bone it hangs from, the detail the animation, frame and time, the turned bone and its turn, the drawing's turn, and every bone the turn came through with its `inherit` | config.bones' `inherit` on the foot's bone (§3, `bones`): a mode that does not take the parent's rotation (`noRotationOrReflection`, `onlyTranslation`) keeps the drawing at its setup angle; which mode is the author's. Or the clip's keys on the foot's own bone, which turn the shoe whatever its mode |
| <a id="CHECK_STRESS_OFF_CHAIN"></a>`CHECK_STRESS_OFF_CHAIN` | a mesh from a See-through `handwear` layer that rides one chain of the idle does not turn rigidly with it: with the chain's first link turned 90°, −90° or 180° on a throwaway copy (physics left out, posed by rigc, issue #347), its worst edge reads above 1.0000 as max(ratio, 1/ratio) against the setup pose. The object names the mesh, the link and the turn; the detail quotes the edge and names each bone the mesh is weighted to off the chain, with how many vertices carry it and the largest weight. Or the turned render shows no mesh on the slot: not read is not a pass | the mesh's `segments`: drop the segment on the bone the line names (a 16 px `chest` stub at the shoulder, as `propose` drafted until issue #347), so the sleeve rides its chain alone. Measured (rigc 2.47.1): `demo`'s sleeves read 2.46 to 254.7 with the stub and 1.0000 without it, and the setup-pose seam does not move (mean 0.147, 0 px over 40, both ways) |
| <a id="CHECK_LIMB_ONE_BONE"></a>`CHECK_LIMB_ONE_BONE` | a part a `config.limbs` segment made is bound in `rig.json` to a bone besides its segment's — a mesh weighted to a second bone, or a slot on another bone — or to none (issue #349); the object names the part, its limb and its bone, the detail every other bone | `regions.<part>` the segment's bone, or a mesh whose `segments` name that bone alone: a bend is a rotation at the joint |
| <a id="CHECK_SEAM_OVER_RANGE"></a>`CHECK_SEAM_OVER_RANGE` | a limb joint with a declared `range` (issue #360), bent to one of its range's ends or its middle, fails the rest-pose seam's bar against the same pose with the joint's own art drawn under the limb — the bend uncovers the joint; the object names the joint, its limb and segment, the part, the bone and the angle. Under `cap_shape: "disc"` (issue #360, unit B) or `"ball"` (issue #598), also any pixel of the disc over 40 at a pose, under the seam's bar or not. Also a joint the line cannot read (its bone has no parent in `rig.json`, no slot shows its limb, or its cap's disc holds no opaque art), and, refused, two renders of the bent copy that rigc did not put on one grid | a cap that covers the turn: the layer's art within the cap's radius on the upper side of the joint line, or a `cap` image painting what the layer lacks (`limb cap:` names the missing pixels); or a narrower `range` |
| <a id="SEAM_OVER_MOTION"></a>`SEAM_OVER_MOTION` | **a warning, never a refusal** (issue #493; the owner's ruling, 2026-10-18: a seam that opens in motion may be intended). Every declared neighbour pair — each limb's two segments at a joint, the upper and the one below (`parts.json`'s limb records, `config.limbs`), and under `--requirements` each `seam`'s `part` and `neighbour`, one pair however many declare it — read in every animation `motion.json` holds, the idle included, by rig-c's seam reading: one `rigc render --seam <a>:<b>,… --fps 12` over the packed build as played (physics on), whose `seam.json` (`rigc-seam/1`, rig-c's AUTHORING §8.8) names per pair and frame a **gap** (background inside the joint) or a **ghost** (one piece's overlap band swung clear of its partner), each frame's cells (`px`, one texel of the coarser drawing — a rig px on a build at scale 1), its cell size and its world box. Printed per pair and animation with a frame over the floor: `WARN seam "<a>\|<b>" opens on N frame(s) [<frames>] max <px> px in "<animation>" — over the one-cell floor`, then how many more frames rigc named that were under it. **The floor**: a frame's gap or ghost is reported when it holds more cells than its box is long (its longer side, in cells) — thicker than one cell. A cell is drawn when the renderer paints its centre at half opacity, so an outline that moves by less than a cell flips the cells along it: a line one cell deep, joined or scattered, holds at most as many cells as its box is long, and a hole of any area more. The rule types no number; measured on `examples/wind`'s idle, rigc names 43 openings over its six limb pairs (the two elbows, 1 to 5 cells, boxes up to 17 cells long), every one one cell thick, and on rig-c's `gallery/walk` 13 joint cracks of 1 to 3 cells, all one cell thick. `check.json`'s `SEAM_OVER_MOTION` holds `status` (`WARN`, `CLEAR`), `fps`, `floor`, `pairs`, `animations`, `warnings` and one row per pair and animation (`opens` and `px` over the floor, `max_px`, `under_floor`, rigc's `status`, `drawn` and `banded`); it moves no exit status, no `check: PASS` and no bar count — the summary ends `; N warning(s) (SEAM_OVER_MOTION, not a bar)`. **SKIP**, named: no pair declared (no limb segment, no `seam`; then `check.json` has no key), no `parts.json`, no animation, every pair naming a slot `rig.json` lacks (each printed `not read`), or rigc reading no band on any frame of any pair (rigc's own `skip`: the two drawings share no cell at rest) — nothing measured, never a pass | if the opening is not intended: a cap that covers the turn (`config.limbs`, *Limbs: cut at their joints*; `limb cap:` names the pixels the layer lacks), or a motion that bends that joint less; if it is intended, nothing |
| <a id="CLOTH_SETTLES"></a>`CLOTH_SETTLES` | **a warning, never a refusal** (issue #501; the owner's ruling: cloth at rest while the character stands may be intended). Every physics chain, read by its tip on the idle `check` renders — `rigc render --animation idle --fps 12 --geometry`, physics on, rigc's default environment. A chain is a **physics leaf** — a bone a physics constraint names (`rig.json`'s `constraints` or `motion.json`'s `physics`) with no such bone under it — and the run of physics bones above it; its tip is the leaf's end (origin plus `length` along its world x axis), or its origin when the leaf has no length; its speed between frames is the tip's distance over their time, from the idle's `geometry.json`. A chain **settles** at the first frame from which every speed to the idle's last frame is under the floor, and each one that does — before the loop's length is out — prints `WARN chain "<root>" .. "<tip>" (N physics link(s)) settles at <t> s of the <d> s idle — its tip's end under 0.01694 rig px/s from there to the last frame (fastest on the idle <v> rig px/s)`. **The floor**, 0.01694 rig px/s, is derived, not chosen: half the slowest tip an idle key drives on the public examples (the repository's floor rule, half the weaker figure) — measured with this port's build of each (rig-c 2.60.0), over the 31 chains a keyed bone at or above the leaf drives (`demo` 12, `reference-sample` 1, `scarf` 11, `wind` 7) the slowest frame-to-frame tip speed is `scarf`'s `skirt_l2`, 0.03388 rig px/s; the ten no key drives — `wind`'s skirt, eight trees and the swing, hung from a `hip` its idle never keys, and `reference-sample`'s `hip_jiggle` — fall under it from 1.5 to 2.75 s on a 3.333 s idle (`hip_jiggle` at 0 s: it never moves) and end at 0.0025 rig px/s or less. `check.json`'s `CLOTH_SETTLES` holds `status` (`WARN`, `CLEAR`), `fps`, `frames`, `duration`, `floor_rig_px_per_s`, `floor`, `levers`, `warnings` and one row per chain (`tip`, `root`, `links`, `point` — `end` or `origin` — `settles_at`, null when it does not, `max_rig_px_per_s`, `min_rig_px_per_s`); it moves no exit status, no `check: PASS` and no bar count — the summary's warning clause names it, `; N warning(s) (CLOTH_SETTLES, not a bar)` (with `SEAM_OVER_MOTION` before it, and N their sum, where that read a pair). It reads the idle alone, one loop from rigc's physics reset at frame 0: a chain that settles later than the idle is long is not seen. **SKIP**, named: no physics constraint (then `check.json` has no key), or no idle — nothing measured, never a pass | if the chain should move while the character stands, one of the consumer's two levers: an environment at render (`rigc render --environment`, wind and gravity in time — rig-c's AUTHORING §8.4), or a consumer's animation that moves the bone the chain hangs from. The drafted idle keys no hip, by measurement: a hip turn at the idle's period fails a bar on all five public examples (issue #502, §3 *What moves them*). A `cloth` recipe's skirt hangs from `hip`, which the drafted idle never keys (§3, *Recipe: cloth and hair that answer the world*, *What moves them*, which has a worked schedule for `wind`). If it is intended, nothing |
| <a id="CHECK_FOLDS_READ"></a>`CHECK_FOLDS_READ` | the fold render's `frames.json` names no set for an animation, a `folds.json` is missing, not `rigc-folds/1`, another animation's or another rate's, or a folding mesh has no line rigc printed for it | a rigc problem; report it, with `rigc --version` |
| <a id="CHECK_SEAM_FRAME_SIZE"></a><a id="FRAMES_SIDECAR"></a><a id="CHECK_GEOMETRY_FILE"></a>`CHECK_SEAM_FRAME_SIZE`, `FRAMES_SIDECAR`, `CHECK_GEOMETRY_FILE` | rigc's render is not what its `frames.json` says, or its `geometry.json` is not a whole `rigc-geometry/1` export of the frames beside it (a frame count, a mesh whose vertex count differs from its rest entry; for the face half, another viewport than `frames.json`'s, other frame indices, the head bone or a feature's bone missing from a frame, a non-finite transform or time) | a rigc problem; report it |
| <a id="LOOP_ENCODE"></a>`LOOP_ENCODE` | the loop encoder refused a frame (translucent pixel in a GIF, a size change) | the frames; for a translucent frame write the lossless or the indexed APNG, which keep alpha |
| <a id="LOOP_LEAD_IN_IDLE"></a>`LOOP_LEAD_IN_IDLE` | `build --lead-in`: the idle cannot be repeated without inventing a value (a track not keyed from 0 to the duration, or ending where it does not start; a field besides `duration`, `loop`, `note`, `tracks`), the motion already has an `idle_lead_in`, or the render did not write whole periods | the refusal names the track or field; the demo's idle, as the rig stage writes it, repeats as written |
| <a id="CHECK_PACK_LINE_READS"></a>`CHECK_PACK_LINE_READS` | rigc printed a `pack:` line that is not `pack: <page> <W>x<H>, <N> region(s), <P>% covered, padding <D>`, then `, page edges free` or nothing, then `, shape rect`, `, shape polygon` or nothing (rig-c 2.1 prints the shape; 1.5–2.0 printed none, read as `rect`); an unknown shape is this refusal; the line is quoted | a rigc this package does not know the output of; report it, with `rigc --version` |
| <a id="CHECK_PACK_PAGE_EDGES"></a>`CHECK_PACK_PAGE_EDGES` | the pack line disagrees with the `--page-edges` the build was run with — its `, page edges free` clause is there under `pot` or missing under `free`, or a `pot` page is not a power of two on both edges | a rigc problem; report it, with `rigc --version` |
| <a id="CHECK_PACK_SHAPE"></a>`CHECK_PACK_SHAPE` | the pack line disagrees with the `--pack-shape` the build was run with — it ends `, shape rect` under `polygon` or `, shape polygon` under `rect`, or it has no shape clause (the 1.5–2.0 form, read as `rect`) under `polygon` | a rigc older than 2.1.0 on `PATH`: rigc 2.0.3 takes `--pack-shape` without a word, packs by rectangles and prints the form with no shape clause, so this refusal is what catches it — `bun install` (this package depends on rig-c ^2.20.4); otherwise a rigc problem, report it with `rigc --version` |
| <a id="BUILD_ARTIFACT_PRESENT"></a>`BUILD_ARTIFACT_PRESENT` | the packed build lacks its `.json`, `.atlas` or page | a rigc problem; report it |
| <a id="BUILD_REQUIREMENTS_CONFLICT"></a>`BUILD_REQUIREMENTS_CONFLICT` | `build --requirements <file>` names a file with other bytes than the one `config.requirements` declares (issue #556): the detail names both, each resolved (the flag against the working directory, the declaration against the config's) with its sha256 — or `no such file`. Refused before assemble writes anything. The same file by both, or a copy of its bytes, is not refused: the declaration is read and recorded | drop the flag to build from the config's file, or point `config.requirements` at the flag's |
| <a id="REQUIREMENTS_FILE"></a>`REQUIREMENTS_FILE` | `--requirements` names no file, or one that does not parse as a JSON object. Refused before anything is built (by `build`, before assemble) | the path of a `spine-parts-requirements/1` file |
| <a id="REQUIREMENTS_FIELD"></a>`REQUIREMENTS_FIELD` | a field of the file is missing, of the wrong type, or not one the format reads: `spec`, `fps` (no default), `requirements`, each requirement's `name` (letters, digits, underscores; once each), `kind`, `animation` and its kind's fields — every bar among them (`within_px`, `fraction`, `tolerance`, `least_drive` above 0, `within_degrees` from 0 to 180, `lo_degrees` ≤ `hi_degrees`, `within_ratio` ≥ 1) — and each target's `bone`, `animation` and exactly one of `at` and `keys` (times strictly increasing), and `not_planted`, `not_swinging`, `rises` and `rests` when given (each a non-empty list of part names, each once; no part both in `not_swinging` and in `rises` or `rests`), and `may_fold` when given (a non-empty list of `{ "slot", "animation", "why" }`, every one a non-blank string, each pair once; issue #320). `note`, `*_note` (strings) and `x-…` (any value) are read by nothing, as in the config | write the field; the bar is yours |
| <a id="REQUIREMENTS_RESOLVES"></a>`REQUIREMENTS_RESOLVES` | a bone, an `ik` or `transform` constraint (by name and `constraint_type`, as rig-c resolves it), a slot, a mesh attachment or an animation the file names is not in `rig.json` or `motion.json`, or a seam's part or a `not_planted`, `not_swinging`, `rises` or `rests` name is not in `parts.json` — the detail lists the ones that are; or an animation whose name cannot be a directory. Refused before anything is built | the name as the rig spells it |
| <a id="REQUIREMENTS_CONSTRAINT_DRIVES"></a>`REQUIREMENTS_CONSTRAINT_DRIVES` | a `follow` names a bone its constraint does not constrain, or a property it does not drive: an `ik` drives `rotate` only; a `transform` drives `rotate` when a `to` names `rotate`, `translate` when one names `x` or `y` | the constraint's own bone and property |
| <a id="REQUIREMENTS_TARGET_PARENT"></a>`REQUIREMENTS_TARGET_PARENT` | a scene target's bone is the root or is not parented to it, or the root is not at rest at the origin, or the animation keys the root — a stage point is a bone's position only under a root that stands still at the origin | a bone under the root for the scene to place |
| <a id="REQUIREMENTS_TARGET"></a>`REQUIREMENTS_TARGET` | a scene target places one bone twice for one animation, places it for an animation no requirement measures, has a key outside the animation's `[0, duration]`, or sits in a group the animation translates | one placement per bone and animation, inside it, for an animation a requirement reads |
| <a id="REQUIREMENTS_SELF_TARGET"></a>`REQUIREMENTS_SELF_TARGET` | a `contact` whose `target` is its own `bone` and `point` (0 apart by construction), or an `aim` whose `target` is a point of the aimed bone itself — its tip lies on its own axis (0 degrees by construction), its origin gives no line at all (issue #540): a PASS would say nothing. Refused before anything is built, beside the file's other refusals; a bone's tip against its own origin is a contact like any other (it reads the bone's length), and a stage target is never one | a different bone (or a stage point, for an aim), or for a contact the bone's other point |
| <a id="CHECK_REQUIREMENTS_FRAMES"></a>`CHECK_REQUIREMENTS_FRAMES` | a requirement render did not write every frame rigc sampled, or the as-declared, released and full renders of a follow sampled different frames | a rigc problem; report it |
| <a id="CHECK_REQUIREMENT_MET"></a>`CHECK_REQUIREMENT_MET` | a declared requirement measured outside its bar; the figure, its frame and the bar are quoted | the rig or its motion (§7, *Declared requirements*) — or the bar, if the scene asks less |
| <a id="CHECK_REQUIREMENT_MEASURABLE"></a>`CHECK_REQUIREMENT_MEASURABLE` | a declared requirement is NOT MEASURABLE: what it asks is undefined in the frames, and the reason is quoted. Not a pass | the declaration (a bone with a length, a target off the bone's origin, a least drive the constraint reaches) or the rig |
| <a id="REQUIREMENTS_MAY_FOLD"></a>`REQUIREMENTS_MAY_FOLD` | a `may_fold` entry names a slot with no mesh attachment — a region is one quad and cannot fold (issue #320). Refused before anything is built. Before issue #333 an entry naming the idle was refused here too; the bar reads the idle now, and `idle` is an animation name like any other | a mesh slot |
| <a id="REQUIREMENTS_NOT_PLANTED"></a>`REQUIREMENTS_NOT_PLANTED` | a `not_planted` name is a part `check` does not read as a planted foot — it does not come from a See-through `footwear` layer — or there is no `parts.json` to choose the feet by (issue #231). Refused before anything is built | a `footwear` part's name |
| <a id="REQUIREMENTS_TIP_EXCEPTION"></a>`REQUIREMENTS_TIP_EXCEPTION` | a `not_swinging`, `rises` or `rests` name is a part `TIP_OVER_ROOT` does not read — not from a See-through `handwear` or `bottomwear` layer — or there is no `parts.json` (refused before anything is built); or a `rises` part is not carried by a chain that rises: the chain's **last link**, at the setup pose, runs other than up — from its origin along its `length` (the extent the rig stage turns a link to), or, a last link with no length, from the link before's origin to its own — the detail giving the link read and the direction measured (refused after the idle is rendered, before `check.json` is written) (issues #231, #322; until #322 it read the chain's first link's origin to its last's, which refused a folded arm — a link that hangs, then a forearm raised) | a swinging part's name; for `rises`, a part whose chain does rise |
| <a id="CHECK_ENVIRONMENT"></a>`CHECK_ENVIRONMENT` | `check --environment` (or `build --environment`, forwarded): the schedule is refused, the detail rigc's own sentence verbatim. Read once by rig-c's reader (`readEnvironmentSchedule`, `rig-c/src/environment.ts`) before anything is built — nothing at the path, a file that is not JSON or not an object, a `spec` other than `rigc-environment/1`, a key besides `spec`, `steps` or a step's `t`, `wind`, `gravity`, no step, a `t` not finite, below 0 or not after the step before, a `wind` or `gravity` not a pair of finite numbers (JSON's `1e999` reads as `Infinity` and is refused), a step stating neither — and `--out` is not written (`build` refuses under `[assemble]`, before it assembles). After the build, what `rigc render --environment` refuses of a well-formed schedule on this rig, quoted from its `--environment <path>:` line: no physics constraint, a half no constraint answers, two steps on one frame at 12 fps, a step after the last frame of the animation rendered. Also refused before anything is built: a `motion.json` with no animation, where no render `check` makes could pose the schedule | the schedule — rigc's sentence names the entry, the field, the value found and the value required; for a rig with no physics constraint, drop the flag: no world moves it |
| <a id="REQUIREMENTS_SEAM"></a>`REQUIREMENTS_SEAM` | a `seam` cannot be read against the rig: there is no `parts.json` (a merged rig, §7 *Measuring a rig rig-parts did not assemble*), or the two parts' art does not meet at the setup pose (no 4-adjacent pair). Refused before anything is built | two parts whose art touches, on a rig with its `parts.json` |

**The world the readings are taken in** (`--environment`, issue #538). A physics chain
answers the world as well as the bones above it, and `check` without the flag reads
rigc's default world, wind (1, 0) and gravity (0, 1) — not the one a person watched in
the review editor. `check --environment <schedule.json>` hands a `rigc-environment/1`
schedule (§3, *What moves them*) to every render whose frames a bar or a warning reads,
and to none that writes a product: the idle render (`TIP_OVER_ROOT`, `STILL_REGIONS_DARK`,
`TEXTURE_STRETCH`, `CLOTH_SETTLES`), the physics-on half of `ANIMATIONS_DO_NOT_FOLD`, the
parts `BREATH_VISIBLE` renders alone, `SEAM_OVER_MOTION` and the `--requirements`
renders. The renders with the physics left out — the loop's keyed render, the fold
bar's physics-off half, `STRESS_OFF_CHAIN`'s turned copy and `SEAM_OVER_RANGE`'s bent
copy — take none: no world moves a skeleton with no physics constraint, and
`rigc render` refuses a schedule on one (`the skeleton declares no physics constraint,
so no environment moves anything in it`, rig-c 2.60.0, measured on the fold bar's off
half). The setup-pose stills (the seam, `BLINK_NO_HOLE`, `SETUP_POSE_VS_SOURCE`) take
none either: each is a 0.1 s animation read at its first frame, and rigc refuses a step
after its last (`entry 1's t 0.5 falls after the last frame of every set drawn`,
measured). `build --loop` encodes a product and takes none. One line,
`environment: <path>, rigc-environment/1, <n> step(s), sha256 <16 hex>`, says which
schedule, and `check.json` carries `environment` — `path` as the command line gave it,
the `sha256` of the bytes read, `steps` — after `pack_mode`; without the flag neither
is written and no render argument moves.

The world before the first step is the runtime's, so a still schedule is the one that
states it: `{ "t": 0, "wind": [1, 0], "gravity": [0, 1] }` reads what a run without the
flag reads — on the cloth fixture (selftest `CK514`), the same idle frames and the same
`check.json` but for its `environment` key. Wind `[0, 0]` is not that world but a calm,
and it moves the readings: on the same fixture `TEXTURE_STRETCH` 1.382 → 1.214 and
`TIP_OVER_ROOT`'s ratio 15.061 → 7.216. A gust that moves the chains moves the bars:
wind (1, 0), then (40, 0) from 0.5 s, reads `TEXTURE_STRETCH` 32.181 (FAIL, `hair_back`
triangle 258), two meshes folding under `ANIMATIONS_DO_NOT_FOLD` (FAIL; none without the
flag) and 8 `CLOTH_SETTLES` warnings for 9 (selftest `CK515`).

### compose

Every refusal below is collected with the others and printed at once, under
`[compose]`; nothing is written (`rig/`, `scene.json` and `check/` are cleared first
and stay absent).

| rule | means | change |
| --- | --- | --- |
| <a id="SCENE_FILE"></a><a id="SCENE_SPEC"></a><a id="SCENE_FIELD_PRESENT"></a><a id="SCENE_FIELD_TYPE"></a><a id="SCENE_KEY_KNOWN"></a>`SCENE_FILE`, `SCENE_SPEC`, `SCENE_FIELD_PRESENT`, `SCENE_FIELD_TYPE`, `SCENE_KEY_KNOWN` | the scene file is missing, not a JSON object, not `spine-parts-scene/1`, or a field is missing, of the wrong type or not one the format reads (`canvas` two positive integers; `characters` at least one, each `id`, `build`, `offset` — an offset is never assumed (0, 0) — and an optional `scale`, a positive finite number: 0, a negative number or a non-number is refused at `characters[i].scale`; `order` a list of strings). `note`, `*_note` (strings) and `x-…` (any value) are read by nothing | the field |
| <a id="SCENE_ID_UNIQUE"></a><a id="SCENE_ID_FORM"></a>`SCENE_ID_UNIQUE`, `SCENE_ID_FORM` | an `id` repeated, empty, or holding `:` — the separator of a prefixed name — or `/`, `\` or a leading `.`, because an id begins every image file of its character | another id |
| <a id="SCENE_PLATE_PROVENANCE"></a><a id="SCENE_PLATE_PRESENT"></a><a id="SCENE_PLATE_SIZE"></a>`SCENE_PLATE_PROVENANCE`, `SCENE_PLATE_PRESENT`, `SCENE_PLATE_SIZE` | the plate's `provenance` is not `observed`, `generated` or `unknown`; its image is missing or not a PNG; it is not the canvas's size (it is drawn at canvas (0, 0) and never scaled) | the plate |
| <a id="SCENE_BUILD_PRESENT"></a>`SCENE_BUILD_PRESENT` | a build directory, or a file `build` writes in it (`parts.json`, `rig/rig.json`, `rig/motion.json` with an `idle`, an image its skin names, `check/check.json`), is missing | run `build` for that character |
| <a id="SCENE_BUILD_GREEN"></a>`SCENE_BUILD_GREEN` | the build's own `check/check.json` does not say `PASS` and `gate_spine_html_green`; under an accept list (`--accept`, `characters[].accept`), it failed a bar the list does not name, its gate is red, a declared requirement is not PASS, or it names no failing bar — the bars not met and the ones accepted are listed | finish that character first: compose binds finished characters. To look at the scene meanwhile, name the failing bars (§7, *Composing several characters*) |
| <a id="SCENE_ACCEPT_KNOWN"></a>`SCENE_ACCEPT_KNOWN` | an `--accept` name, or one in a character's `accept`, is not a bar `check` holds a build to: a problem code (`CHECK_LOOP_CLOSES`) where the bar's name (`loop`) belongs, a misspelling, or `gate`, which is rig-c's and never accepted | one of the names the message lists |
| <a id="SCENE_BUILD_FIELD_KNOWN"></a>`SCENE_BUILD_FIELD_KNOWN` | a build's `rig.json` or `motion.json` carries a key compose does not know how to prefix or place, or a root with a transform of its own | a rig `build` wrote; a rig written by something else is `check`'s to measure (§7, *Measuring a rig rig-parts did not assemble*), not compose's to merge |
| <a id="SCENE_RIG_SCALE_AGREES"></a>`SCENE_RIG_SCALE_AGREES` | the characters' `parts.json` `scale_rig_per_source` differ (each named) | one `assemble.rig_scale` for every character; `characters[].scale` sizes a placed character, it does not make two `rig_scale`s one |
| <a id="SCENE_SCALE_EXACT"></a>`SCENE_SCALE_EXACT` | a character at a `scale` other than 1 carries something no per-character value can scale: a physics constraint with a nonzero `wind` or `gravity` (Spine applies both through the skeleton's `referenceScale`, which the composed skeleton holds once for every character), a track whose `property` compose does not know to be a length or not, or a translate key whose `v` is neither a list of numbers nor a map of them | `scale` 1 for that character, or rebuild it at another `assemble.rig_scale` |
| <a id="SCENE_DURATION_AGREES"></a>`SCENE_DURATION_AGREES` | the characters' idles are of different durations (each named) | one `motion.duration` |
| <a id="SCENE_CHARACTER_INSIDE_CANVAS"></a>`SCENE_CHARACTER_INSIDE_CANVAS` | a character's part boxes, placed at its offset, leave the canvas (the boxes and the canvas px quoted) | the offset, or the canvas |
| <a id="SCENE_ORDER_RESOLVES"></a>`SCENE_ORDER_RESOLVES` | an order entry names no character, or `<id>:<slot>` names a slot that character does not have (its slots listed) | the entry |
| <a id="SCENE_ORDER_ONCE"></a><a id="SCENE_ORDER_COMPLETE"></a>`SCENE_ORDER_ONCE`, `SCENE_ORDER_COMPLETE` | a slot is drawn twice (a slot entry repeated, or an id listed twice), or never (the character's id is absent and some of its slots are named nowhere — they are listed) | name each slot once, or the id for the slots not named elsewhere |
| <a id="SCENE_NAME_PREFIXED"></a><a id="SCENE_NAME_RESOLVES"></a>`SCENE_NAME_PREFIXED`, `SCENE_NAME_RESOLVES` | a build's constraint, `stops` entry or `invariants.detached` names a bone its own character does not declare — one another character does (`…_PREFIXED`, naming the prefixed names it could have meant) or none does (`…_RESOLVES`); or a `--requirements` name (bone, target bone, constraint, slot, attachment, seam part) is a bare name some character holds, which the composed rig holds only prefixed | a bone of the same character; in a requirements file, `<id>:<name>` |
| <a id="SCENE_ROOT_SHARED"></a>`SCENE_ROOT_SHARED` | a character's idle keys `root` (a track, or a group holding it), or one of its constraints or `stops` entries names `root`: the root is every character's, so either would move or reach them all | key, constrain or stop a bone of the character's own |
| <a id="SCENE_INVARIANT_AGREES"></a>`SCENE_INVARIANT_AGREES` | two characters declare `invariants.idleDrivesMeshes` with different `why`s | rebuild with this package's `--idle-keys direct`, whose `why` is one sentence |
| <a id="SCENE_IMAGE_NAME_FREE"></a>`SCENE_IMAGE_NAME_FREE` | two images compose to one file name (`<id>.<file>`: an id `x` with an image `y.cloth.png`, and an id `x.y` with `cloth.png`) | another id |
| <a id="COMPOSE_RIGC_GREEN"></a>`COMPOSE_RIGC_GREEN` | rig-c refused the composed rig; its line is quoted. A field compose carries as written (a constraint's `mix`, a slot's setup attachment) is rigc's to judge | the build whose field it names |
| `REQUIREMENTS_*` | the `--requirements` file, as for `check` | as for `check` |

### The command line

| rule | means | change |
| --- | --- | --- |
| <a id="USAGE"></a>`USAGE` | the call is malformed: an unknown command or flag, a flag given twice or without its value, a required flag missing, or two flags that exclude each other; the line says which. Exit 2, and nothing runs | the call — `rig-parts --help` lists the commands, and a command's refusal of a flag it does not take lists the flags it does |
| <a id="NOT_IMPLEMENTED"></a>`NOT_IMPLEMENTED` | the command is registered for a later version and does nothing in this one; exit 2. No command is today (`LATER` in `cli.ts` is empty) | a version that implements it |
| <a id="GUIDE_FILE_PRESENT"></a>`GUIDE_FILE_PRESENT` | `rig-parts guide` found no `docs/AUTHORING.md` beside the `cli.ts` it runs from | reinstall the package: the file is in its `files` |
| <a id="GUIDE_RULE_KNOWN"></a>`GUIDE_RULE_KNOWN` | `rig-parts guide <RULE>`: no row of this guide names the rule. The line, on stderr, lists the three nearest names the guide does hold; nothing is printed in their place | one of the names listed, spelled as the line printed it |
| <a id="GUIDE_SECTION_KNOWN"></a>`GUIDE_SECTION_KNOWN` | `rig-parts guide §<n>`, `§<n>.<m>` or `§<n>.<m>.<k>`: there is no such section, or no such subsection under the one it names; the line, on stderr, names the deepest section that exists and lists its sections | a number the detail lists |

## 7. The bars `check` enforces, and what only an eye answers today

`check.json`'s `PASS` is true exactly when all of these hold (the reference
implementation's bars) — each one that measured; a rig with no `parts.json` or no
`idle` skips the ones that read it, by name (*Measuring a rig rig-parts did not
assemble*, at the end of this section):

- `gate_spine-html.txt`: every summary line `(N passed, 0 failed)` — the packed build
  under the `rig-play` profile, gated once over the compile and once over the packed
  pages on disk. There is no `spine` gate of its own: `rig-play` holds every rule
  `spine` measures (on reference-demo, rigc 1.5.1 and 2.0.3: `validate --profile spine`'s 14
  measured rules are all among the build's 23, the 15 others not in `spine`; rigc
  2.1.3 and 2.10.1: the same 14 among the build's 24, which adds
  `A49_PACKED_FOOTPRINTS_DO_NOT_OVERLAP` on the packed pass, 16 not in `spine`; `CH09`
  holds it on every fetched example);
- **seam**: the setup-pose render against the flat composite of `parts/`: mean
  max-channel |d| ≤ 1.0 of 255, and at most 50 **rig** pixels over 40 — the
  frame pixels over 40 divided by s², `s` the frame scale the `seam:` line
  prints and `check.json`'s `seam_frame_scale` holds (issue #216). The frame
  holds s² pixels per rig pixel, so a stack that parts from the render over a
  fixed area of the rig reads s² times as many frame pixels: on the public
  `reference-sample` a part moved 2 rig px read 400, 891 and 1,560 frame px over 40 at
  s = 1.0, 1.5 and 2.0, and 400, 396 and 390 rig px; reference-sample as built read
  3, 3 and 7 frame px [measured, issue #216]. Divided by s² the bar reads the
  same rig at every scale, and at s = 1 it is the reference's count. The mean
  is a share of the frame and needs no such division (0.242, 0.188 and 0.226 on
  reference-sample as built; 0.353, 0.305 and 0.340 with the part moved).
  `seam_px_over_40` and `seam_px_over_80` stay frame pixels, and so does each
  pair's count below. The bar reads one
  frame, the setup-pose still, never the idle. When it fails (or when `check
  --seam-pairs` asks, or `build --seam-pairs`, which forwards it, pass or fail), the pixels over 40 are split by the pair of
  parts that answers for each (issue #202): the two parts drawn last among those
  whose art (alpha above 0) lies in the 2x2 rig pixels the composite's bilinear
  reference-sample reads for that frame pixel, lower first, `(no art)` standing in where
  fewer than two do. Each pair is a console line `seam pair <i> of <n>: "<a>" /
  "<b>" at the setup pose: <count> px over 40 (<count> over 80), frame box x
  <x0>..<x1>, y <y0>..<y1>, rig box …, picture seam/<i>_<a>_<b>.png` (in the
  picture, **magenta = a counted pixel**, cyan = the box round them), worst first,
  and a row of `check.json`'s `seam_pairs` (`parts`, `px_over_40`, `px_over_80`,
  `frame_box` in frame pixels, `rig_box` in the rig pixels of `parts.json` and
  `cuts[].polygon`, `picture`); `CHECK_SEAM_WITHIN_BAR`'s line quotes the worst.
  The picture, under `check/seam/`, is the setup-pose frame with that pair's
  counted pixels painted magenta (255, 0, 255) and a cyan box one pixel outside
  them. A passing run not asked writes neither the key nor the directory. A pair
  of one layer cut in two (both parts' `from` the same, `assemble.cuts`) carries
  `cut`: the layer and `differing_copies_px`, how many of its pixels read a pixel
  both parts hold in different colours. The band a cut declares is **not**
  excluded from the count, because the two copies are not one drawing: the piece
  takes the painting where it is seen and the base keeps the layer's colour under
  it. Along the cut line the render draws the upper part's resampled edge over
  the lower part's own resampled copy, where the flat stack is resampled once, so
  the two part where the copies differ and where the art changes colour across the
  line; only the band's outermost pixel and the one across the line are read, so
  the band's width does not enter. On the public `scarf` cut (piece drawn in front
  of `topwear`) the count read 26 px over 40 at `overlap` 1, 8 and 16 alike, the
  band 593, 4,886 and 9,508 px (the `cut:` line): 24 of the 26 are `"topwear" /
  "scarf"` along the cut line, 16 of them reading a band pixel where `topwear`
  holds the layer's colour and `scarf` the painting's, the other 8 where the cut
  line runs along the scarf's red edge [observed, issue #202]. A wider band moves
  neither; the polygon's edge does — run it through art of one colour on both
  sides, in both copies, which `rig/parts/<from>.png` and `rig/parts/<into>.png`
  show pixel for pixel. The composite meets the frame pixel centre to pixel
  centre: rig pixel index u lands on frame index s·u + t + 0.5·(s − 1), `s` the
  scale the `seam:` line prints (issue #209; the reference implementation's map
  lacks the last term, so the two agree only at s = 1). `check --keep-stills`
  (and `build --keep-stills`, which forwards it) leaves that frame — rigc's render directory, its `frames.json` (viewport,
  background) beside the PNG — under `check/setup_still/`;
- **loop**: idle frame 0 against the frame at `t = duration`: max |d| exactly 0. The bar
  measures the keys (issue #183): a rig that declares a physics constraint — a `rig.json`
  `constraints` entry of `type` `"physics"`, or an entry of `motion.json`'s `physics`
  table — has the two frames read from the same rig and motion with every one left out
  (with a skin's `physics` list and any track keying one), built and rendered as the idle
  is, because rig-c's render resets physics at frame 0 and steps it, so the last frame
  differs from the first by what the simulation is still doing. The constraints left out
  are counted on the `loop:` line itself (`… (t = <duration>s) with the rig's N physics
  constraint(s) left out (…): max |d| 0`, issue #325), printed on one line of their own,
  `loop physics: … "<name>" on bone "<bone>" (rig.json|motion.json)`, and written as `check.json`'s `loop_physics` after
  `loop_max_diff`; they are reported, not judged. A rig with none is measured from the
  idle render itself, exactly as before, and writes no such line or key.

On the examples: `reference-sample` 23/23, seam 0.207 with 0 pixels over 40, loop 0;
`reference-demo` (default rule) 23/23, seam 0.326 with 2 pixels over 40, loop 0.

A green gate cannot see a wrong animation, so `check` also writes six **judgement
lines** (issue #11; `TEXTURE_STRETCH`, issue #31), each a key of `check.json` and a console line
`NAME: PASS|FAIL|SKIP — <figures and bars>`, read the same way as the lines above: a
FAIL makes `PASS` false and prints its own `FAIL  CHECK_<NAME>` line (§6); a SKIP
says why the rig gave the line nothing to read, and is neither a pass nor a failure —
report it as not verified. Every region is chosen by the See-through tag in
`parts.json`'s `from`, never by a part's name. Heat is a pixel's largest per-channel
change from idle frame 0, in levels of 255, on the idle's 640-pixel grid.

Each bar follows one rule: a floor is half the weaker example's figure and a ceiling
twice the worse one's, so the weaker example clears it by a factor of two; a bar the
model itself fixes (a part on an unkeyed bone does not move, a lag is above 0, a hole
is 0 pixels) is that value, not a margin — and where the model's value is an error
the model fixes at "nothing moves" and the instrument reads exactly (the still regions,
from geometry since issue #123), the bar is the arithmetic's own rounding, derived, not
measured. A bar is set once, from the figures of the day it was set, and is not chased: the torso floor 3.809 is half of reference-sample's 7.618, which reads 7.617 since the chain links are turned (issue #73), a factor of 1.9997. The figures are this port's, measured on
the two examples [observed]:

| line | measures | bar | `reference-demo` | `reference-sample` | SKIP when |
| --- | --- | --- | --- | --- | --- |
| <a id="BREATH_VISIBLE"></a>`BREATH_VISIBLE` | the torso: the breath alone (issue #411). The breath bones are every bone an idle track translates, and the breath tracks every idle track that translates or scales one of them (the drafted breath: `chest` `translatey` and `scalex`). The `topwear` parts are rendered alone (`rigc render --slot`) from one throwaway build that carries, beside every animation, the idle with those tracks held at rest (0 for a translate, 1 for a scale, at each track's first and last key time — the bone as it stands without them, the idle still keyed to its end), so the two idles share a grid; per pixel, the largest \|(with_t − with_0) − (without_t − without_0)\| over the frames and channels, meaned over their box (`torso_heat_mean`). Motion in both renders — a keyed cloth swing, physics answering the world — cancels; physics the breath sets moving counts. Until #411 the figure was the whole idle's heat over the box, which a keyed swing passed for a torso that did not breathe; a refusal still prints that whole-idle figure beside the breath's. An idle with no breath track reads 0 and fails, naming why — a torso that does not breathe is what the bar finds, so it is not a SKIP. The feet: `footwear` parts alone, heat max over theirs | torso mean ≥ 3.809; feet max ≤ 0 | 15.251; 0 | 7.617; 0 | no `topwear` and no `footwear` part. One of the two absent (issue #323): the other half is measured and decides the line, which then carries `halves_measured` `"1 of 2"` first, then each half's own status — `torso_status`, `feet_status` — the absent half's `SKIP` with its `torso_reason` or `feet_reason`; a run that measured both halves writes the keys it always wrote |
| <a id="BLINK_NO_HOLE"></a>`BLINK_NO_HOLE` | the setup pose with every `scaley` track on the eyewhite slots' bones held at its closed value, against the setup pose, at full size: pixels in the eyewhite box that show the page where the open eye had art | 0 px | 0 | 0 | no `eyewhite` part, or no `scaley` track on its bones goes below its first key |
| ″ (reported) | the same box: each closed-eye pixel's max-channel distance to the nearest colour the open eye's box holds — max, and pixels over 40 | none | 15; 0 | 11; 0 | as above |
| <a id="CHAIN_LAG"></a>`CHAIN_LAG` | `motion.json`'s rotate tracks read as sines (DFT of the keys: period, amplitude, phase) and arranged by the bone tree — a keyed bone's parent is its nearest keyed ancestor | every lag ≥ 0.001 cycle; amplitude non-decreasing down each unbranched chain — non-increasing down a chain that carries a part declared `rests` (issue #245) | lags 0.040 (neck to head) to 0.120; 12 chains | lags 0.040 to 0.100; 9 chains | no rotate track under another of the same period |
| <a id="TIP_OVER_ROOT"></a>`TIP_OVER_ROOT` | each `handwear`/`bottomwear` part: how far the centroid of its art travels in the lower half of its box against the upper half — the art's AREA centroid inside each fixed half (cut at h/2), every art pixel (alpha above 8) carried through its attachment's posed triangles from the idle's `geometry.json` and clipped to the half exactly, rig px; `instrument: "geometry"` in the line (issue #118) | ratio ≥ 1.4725; a part declared `rests`, ratio ≤ 1 (issue #245) | `bottomwear` 3.222, `sleeves` 4.721 | `bottomwear` 4.956, `sleeves` 11.830 | no such part |
| <a id="STILL_REGIONS_DARK"></a>`STILL_REGIONS_DARK` | from the idle's posed geometry (`geometry.json`), `instrument: "geometry"` in each half (issue #123). **Face:** the still set — the `face` slots, and every slot drawn after the first of them whose art overlaps a face part's at the setup pose, that the head bone alone carries (a region on it, or a mesh whose every weight is it) and that the idle does not key by slot (`deform`, `sequence`, a slot track: `driven_slots`). The head bone is the bone the `face` parts' slot rides in `rig.json`. Each still slot's art (alpha above 8), carried through its posed attachment and back through the head bone's setup-to-frame map on every idle frame, against its setup position: `max_rig_px` (and where, `at`, when it is a motion), `rms_rig_px`, per slot in `still_slots`. **Feet:** the `footwear` slots the same way in screen space — they ride the root, which the idle does not key, so the screen is their own frame. **Reported, no bar:** `crossing` — per slot drawn after the still set's first slot and not in it, how deep its art reaches into the region (`face` on top at the setup pose, clear of where `eyewhite`, `irides`, `eyelash`, `eyebrow` and `mouth` go in the head's frame; for the feet, `footwear` on top), `depth_rig_px`, and the most of it covered on one frame, `area_rig_px2` | each half's `max_rig_px` ≤ its `tolerance_rig_px`: nothing moves, up to the arithmetic's rounding, √2 × 2 × 35 × M² × ulp(C) (below) | face 4.202e-13 ≤ 2.286e-11; `hair_front` crossing 2.816 rig px deep, 89.395 rig px² (frame 47); feet 0 ≤ 2.814e-12 | face 4.418e-13 ≤ 2.286e-11 (`face`, `ear_l`, `ear_r`); `hair_front` 2.194 deep, 50.605 rig px² (frame 23); feet 0 ≤ 2.814e-12 | no `face` and no `footwear` part (one of the two absent leaves that half unmeasured; so do face parts on two slot bones, or idle frames with no `geometry.json`) |
| <a id="TEXTURE_STRETCH"></a>`TEXTURE_STRETCH` | every mesh triangle's three edges in every idle frame, read from the `geometry.json` the idle render writes (`rigc render --geometry`, rig-c 1.4.0 or later): skinned length over rest length, the rest being the setup pose's bones with no deform. The figure is the rig's worst max(ratio, 1/ratio); each mesh's largest and smallest ratio, with triangle, vertices, edge and frame, is the detail | max(ratio, 1/ratio) ≤ 1.926544 | 1.388: `hair_back` triangle 449, edge 42-43 at 0.720 in frame 26 (largest stretch 1.291, frame 2) | 1.227: `sleeves` triangle 169, edge 126-51 at 0.815 in frame 28 (largest stretch 1.196, frame 5) | the rig draws no mesh, or the render wrote no `geometry.json` |
| <a id="ANIMATIONS_DO_NOT_FOLD"></a>`ANIMATIONS_DO_NOT_FOLD` | every animation, the idle included, through `rigc render --folds` at 12 fps over the build with its physics stepping and, when the rig declares physics constraints, over the keyed build with them left out beside it (issue #363): the meshes with a triangle turned over against the setup pose on some frame, less those the requirements file's `may_fold` declares (below) | 0 undeclared folding meshes, and no `may_fold` entry that matches no fold | 0, over `idle` | 0, over `idle` and `hop`, 2 physics constraints on and off | never SKIP: written whenever `motion.json` holds an animation |
| <a id="FEET_STAY_LEVEL"></a>`FEET_STAY_LEVEL` | issue #348. Each `footwear` part whose slot's bone hangs from another bone (rig.json's `parent`; a part on `root` hangs from nothing and is not read), over every animation, the idle included, from the same `rigc render --folds` run, which then also writes `--geometry`: on each frame where a bone above the part's bone — its parent or any bone over that — has a world rotation other than its setup pose's (no threshold; the nearest is named), the drawing's turn: the least-squares rotation carrying the attachment's setup-pose vertices onto the frame's, both centred (a region's four corners turn exactly with its bone). **This is the reading of "the sole's angle"**: no rig data marks a sole, so level is the drawing's setup angle, the painting's own; a declared sole line would replace it if one ever exists | every read foot within ±10 degrees — HQ's line (rig-c/parts#347 ruling 4), not a figure measured here | not written: the shoes ride `root` | not written: the shoes ride `root` | SKIP when no frame turns a bone above any read foot (not counted as measured); not written at all when no `footwear` part hangs from a bone, or `motion.json` holds no animation, so the examples' `check.json` keep their keys |
| <a id="STRESS_OFF_CHAIN"></a>`STRESS_OFF_CHAIN` | each mesh from a See-through `handwear` layer whose weights ride exactly one chain the idle keys: the chain's first link turned 90°, −90° and 180° from its setup rotation (interim, issue #347: until a config block declares each limb and its joint's range), one `rigc build --profile spine` and one `rigc render --geometry` of a copy with its physics constraints left out; per turn, the part's worst edge as max(ratio, 1/ratio) against the setup pose, at four places, and the bones it is weighted to off the chain. A part riding two chains, or none, or not a weighted mesh, is listed under `not_read` with the reason, and so is a part a `config.limbs` segment made (issue #349): `LIMB_ONE_BONE` holds it to its one bone, so it turns rigidly by construction | 1.0000 — the part turning rigidly with its chain; float32 noise on rigid sleeves measured at most 1.0000090 | SKIP: `sleeves` rides 2 chains | SKIP: `sleeves` rides 2 chains | no part comes from a `handwear` layer or the motion has no idle (the line is not written); every `handwear` part not read (SKIP, each reason) |
| <a id="LIMB_ONE_BONE"></a>`LIMB_ONE_BONE` | issue #349. Each part `parts.json` records as a limb segment's (`limb`), read off `rig.json` alone, nothing rendered: the bones its attachments are bound to — a mesh's weights, or its slot's bone for a region — against its segment's bone (under `config.turn`, that bone's leaf twin counts as the bone) | every limb part bound to its one bone alone, weight 1 | not written: no limbs | not written: no limbs | never: written only when `parts.json` holds a limb part, so the examples' `check.json` keep their keys |
| <a id="SEAM_OVER_RANGE"></a>`SEAM_OVER_RANGE` | issue #360. Each limb part `parts.json` records with a `range` (`config.limbs.<limb>.segments[k].range`): a copy of the rig with its physics constraints left out, its joint's bone keyed `rotate` to the range's min, its middle and its max (each angle once, rigc's sense, counter-clockwise on screen), one `rigc build --profile spine` and two `rigc render`s on one grid — one with the joint's own art drawn under the limb (the limb's parts at rest inside the cap's disc, one pixel in from every edge of what is opaque there, on the bone the joint's bone hangs from), one with it hidden (`--hide`); per pose, the seam figures of the second against the first. Issue #557: per pose also the **contour step**, a reading and never a bar — on the frame with the joint's art hidden, lines across the upper segment (perpendicular to its bone's direction at the setup pose, origin to the joint) one frame pixel apart, from one cap radius before the joint line to one past it; on each, from the axis outward on each side, the outline's extent (the first sample within 40 of the background, out to two radii); the step on a side is the largest change between adjacent lines, in rig px, `left` and `right` as the cap's `short_px` names them. A limb whose outline the bend keeps reads one frame pixel, 1 / s rig px (1.161 at the synthetic fixtures' s 0.861413); the unfilled two-layer knee of the selftest reads 11.609 on the opening side at ±15° and the filled one 1.161. The row prints it; `check.json` carries it (`step_px` on each pose) only for a joint whose cap record carries `short_px` | the rest-pose seam's: mean \|d\| ≤ 1.0 and ≤ 50 rig px over 40 at every pose; a `cap_shape: "disc"` or `"ball"` joint also 0 frame px over 40 (issue #598: the ball over its whole disc; the row says `shape`) | not written: no limbs | not written: no limbs | never: written only when `parts.json` holds a limb record with a `range`, so the examples' `check.json` keep their keys |

**`TIP_OVER_ROOT` is measured from geometry, not pixels (issue #118).** Until #118 the
line rendered each part alone at `--max 640` and took, per half of its frame box, the
centroid of every pixel that was not the background; its fields were `root_px` and
`tip_px`, frame px. A half that travels under a frame pixel puts that centroid at the
mercy of which edge pixels the grid flips: over `--max` 620–660 the pixel figure
scattered around the exact one by up to 0.3 frame px whatever the travel [observed,
13 half-bands on the three examples and a variant], and every **root** half on every
example travels 0.04–0.6 frame px, so the ratio's denominator was noise — reference-sample's
`bottomwear` read 4.187–6.849 over the sweep, reference-demo's `sleeves` 2.960–6.503, and reference-sample
with its skirt amplitudes ×0.1 read 0.512–13.53, FAIL or PASS by the grid. The exact
reading of the same definition is the same at every size (4.007 on that skirt, a PASS).
The fields are now `root_rig_px` and `tip_rig_px`, rig px, beside `instrument:
"geometry"`, so an old and a new `check.json` are not read as one instrument. The bar
is the one set from the pixel instrument (half of reference-demo's `bottomwear` 2.945, by the
rule above, not chased); reference-demo's exact 3.222 clears it 2.19 times. The figures the two
instruments give the examples, and `scarf` (whose `bottomwear` was tracked in contour
mode because its lattice failed the line, until issue #262 found the cause in a `chest`
segment and the lattice read 3.487 — its README):

| part | pixel, `--max 640` (until #118) | geometry |
| --- | --- | --- |
| `reference-demo` `bottomwear`, `sleeves` | 2.990, 3.287 | 3.222, 4.721 |
| `reference-sample` `bottomwear`, `sleeves` | 4.396, 12.475 | 4.956, 11.830 |
| `scarf` `handwear_r`, `handwear_l` | 6.242, 5.558 | 6.683, 5.345 |
| `scarf` `bottomwear`, lattice / contour | 4.537 / 2.661 | 1.207 / 1.738 |

The part rendered alone at up to `--max 8000` — the motion spanning pixels — converges
on the geometric figure (`scarf`'s lattice `bottomwear` 1.337, 1.316, 1.285, 1.270 at
1200, 2400, 4800, 8000), with one gap not explained: `reference-sample`'s `bottomwear` tip reads
2.342 rig px there against 2.596 from geometry, its root agreeing to 0.4 %.

**`STILL_REGIONS_DARK` is measured from geometry too, and its scope changed (issue #123).**

**What it read until #123.** The face half compared two pixel figures on the idle's
640-pixel grid:
- the heat mean over the face outline carried into the head's frame;
- twice the same mean taken off a calibration render, which moved the whole rig rigidly
  with the head.

Both were means of about one level, and both moved with the grid. Over `--max` 620–660
on the three examples:
- reference-demo read 1.03–1.16 times its calibration;
- reference-sample read 0.95–1.07;
- scarf read 0.99–1.38, with its head-frame mean between 1.350 and 1.869.

The feet half was a screen-space heat mean held to 3.244.

**What the old figures actually read.** Measured exactly from the geometry, they read
nothing that moved.

In all three examples `hair_front` is drawn over the face and weighted to `head` and six
bang bones. Its art swings into the face outline, relative to the head, on every idle
frame:

| | `reference-demo` | `reference-sample` | `scarf` |
| --- | --- | --- | --- |
| deepest reach into the face | 2.816 rig px | 2.194 rig px | 2.479 rig px |
| most face area covered on one frame | 89.395 rig px² | 50.605 rig px² | 31.908 rig px² |

The pixel region dropped a rim of `1 + 1/scale` rig px around every pixel that was not
face. That rim measured 2.83–3.09 rig px over the sweep, which is wider than the bangs
ever reach. Inside it, nothing but the face was on top, and the face moves exactly 0.

So:
- the old wording, "a bang whose art crosses the face outline", passed the examples only
  because the region trimmed the band the bangs swing in;
- the old figure was resampler noise divided by resampler noise.

An exact reading of that wording fails all three examples. Every allowed depth between 0
and about 2.7 rig px would be a number chosen to keep them green.

**What it asks now.** The question is whether the face, and the parts over it that the
head carries, keep their place relative to the head bone.

The still set is derived from the rig and the motion, never from a list:
- the `face` slots;
- every slot drawn after the first of them, overlapping a face part's art at the setup
  pose, carried by the head bone alone, and not keyed by slot in the idle.

A blink or a brow moves on a bone of its own, so it is not in the set; its motion is
intended. A bang weighted to its chain is not in the set either. How deep it swings into
the face is reported per slot as `crossing`, with no bar.

The feet half is the same reading for the `footwear` slots, in screen space.

**The bar is 0 in meaning.** The figure may exceed 0 only by the arithmetic's own
rounding. That rounding is derived, not measured:
- **The arithmetic is double precision.** rigc's core poser reads vertex coordinates and
  weights through `Math.fround`, computes in doubles, and `geometry.json` carries the
  doubles. The float32 inputs are the same in the rest vertex and the posed one, so they
  cancel.
- **35 roundings stand on the longest path to one coordinate:**
  - 4 for the rest vertex and 4 for the posed vertex;
  - 11 for the head's setup-to-frame map;
  - 15 for carrying the vertex back through it;
  - 1 for the difference.
- **Each rounding is bounded.** It is at most 2 M² ulp(C), where M is the largest matrix
  entry (at least 1) and C the largest coordinate.
- **The tolerance follows:** √2 × 2 × 35 × M² × ulp(C). On the three examples it is
  2.286e-11 rig px for the face and 1.407e-12 to 2.814e-12 for the feet.

The examples read 4.2e-13 to 4.4e-13 on the face and exactly 0 on the feet. The
tolerance is a numerical one only; no visual allowance is in it.

**Which other lines see the eyes and the bangs.** `BLINK_NO_HOLE` checks one thing: with
the blink held shut, no background shows inside the eyewhite box. It does not look at
what covers the eyes. Nothing in `check` judges a bang over an eye or over the face; the
reported `crossing` depth is the only instrument for it.

**Before and after, the same builds, only `IDLE_MAX_PX` changed** (scratch copies of the
tree):

| `--max` | before: face mean / calibration (ratio), feet mean, reference-demo · reference-sample · scarf | after: face `max_rig_px`, feet `max_rig_px`, all three |
| --- | --- | --- |
| 620 | 1.283 / 1.196 (1.07), 1.504 · 0.933 / 0.900 (1.04), 0 · 1.350 / 1.360 (0.99), 0 | 4.202e-13, 0 · 4.418e-13, 0 · 4.224e-13, 0 |
| 640 | 1.328 / 1.145 (1.16), 1.619 · 0.898 / 0.897 (1.00), 0 · 1.869 / 1.352 (1.38), 0 | the same |
| 660 | 1.297 / 1.118 (1.16), 1.606 · 0.882 / 0.887 (0.99), 0 · 1.578 / 1.310 (1.20), 0 | the same |

The `STILL_REGIONS_DARK` line is byte-identical at 620, 630, 640, 650 and 660 on every
example.

The selftest's planted cases (by hand):

| plant | before (every size) | after (every size) |
| --- | --- | --- |
| a foot whose root moves `fround(0.05)` rig px | PASS, heat 0.779–0.785 | FAIL, 0.05 rig px |
| a face mesh weighted to a bone sliding `fround(0.05)` under a rolling head | PASS, 0.851–0.855 against 0.936–0.948 | FAIL, 0.05 rig px |

**`STRESS_OFF_CHAIN`: a sleeve turned far (issue #347).** The idle moves a sleeve a few
degrees, so a sleeve that only looks right at rest passes every idle bar and is first seen
broken by whoever poses it. This bar poses it first. For each part from a See-through
`handwear` layer whose weights ride exactly one chain the idle keys, the chain's first link
(the bone the idle keys) is turned 90°, −90° and 180° from its setup rotation — the card's
arm raised, arm across and arm behind the head — on a throwaway copy with its physics
constraints left out: one `rigc build --profile spine`, one `rigc render --geometry` at
rigc's smallest `--max` (the reading is world units), and the part's worst edge as
max(ratio, 1/ratio) against the setup pose, the quantity `TEXTURE_STRETCH` reads. A part
weighted to its chain alone turns with the link as one piece, so it reads exactly 1; the bar
is that reading at four places, **1.0000** — not a margin: the rigid sleeves of `demo` and of
a test rig read 1.0000038 to 1.0000090 (float32 bone arithmetic), and the same sleeves with a
16 px `chest` segment at the shoulder read 2.41 to 1,498 (rigc 2.47.1). A vertex weighted to a
bone the turn does not move is pulled between the two, and the line names that bone, how many
vertices carry it and the largest weight: the segment on it in `meshes.<part>.segments` is
the one to drop. `propose` drafted that stub on every sleeve until issue #347; `demo` and
`scarf` carried it, and dropping it moved neither the setup-pose seam nor any bar's status.
Two limits, both stated rather than guessed. **The turns are interim:** a config block that
names each limb and its joint's declared range is the next card, and the bar then poses each
limb at its range's ends. **The scope is the `handwear` tag:** a part riding two chains (one
mesh for both sleeves, as `reference-demo` and `reference-sample` have) stretches between them
by construction and is listed under `not_read` with that reason, and a one-chain pendant on
another tag is not read — `reference-demo`'s `hairpin`, its tassel turned 180°, reads 23.7.

**`ANIMATIONS_DO_NOT_FOLD`: every animation, the idle included (issues #320, #333, #363).** The one
bar that reads an animation other than the idle, and it reads the idle with them, written — as
a key of `check.json` after `TEXTURE_STRETCH`, and a console line after the judgement lines —
whenever `motion.json` holds an animation: a rig of the idle alone writes it too, and the
summary counts ten bars. `TEXTURE_STRETCH` reads how far the idle's triangles stretch; a
triangle that turns inside out is this bar's defect, on the idle as on any clip (issue #333;
until then the idle was read for folds by hand, beside the build). It is rig-c's reading, not this package's:
`rigc render --folds` over every animation of the build with its physics stepping on the render clock (issue #363),
and, when the rig declares physics constraints, over the keyed build with its physics left out beside it, at 12 fps (the idle's rate, under
`--requirements` too: the file's `fps` is its requirements', and a file moves only what it
declares), with frames drawn at rigc's smallest
`--max`, 16, because the reading is of posed vertices in world units and the frame size does
not change it (on `scarf`, `hop`'s `folds.json` was byte-identical at 16 and 640). A mesh
triangle **folds** at a frame when its orientation is the opposite of its orientation at the
setup pose (rig-c AUTHORING §8.3). The bar is 0 folding meshes, but those the requirements
file's `may_fold` declares — `{ "slot", "animation", "why" }`, the fold the art means, named on
the line with its why — and an entry that matches no fold fails, as rig-c refuses an
exemption that exempts nothing.

| field | what |
| --- | --- |
| `status` | `PASS` or `FAIL` |
| `animations` | every animation, the idle included, in `motion.json`'s order: each one read |
| `fps` | the rate the reading sampled at |
| `physics_left_out` | how many physics constraints the rig declares — stepped in `physics_on` and left out in `physics_off` (0 without any) |
| `folding` | one row per mesh that folds in an animation: `animation`, `slot`, `attachment`, `frames` (how many show a folded triangle), `worst_frame`, `worst_triangles`, `triangles` (the mesh's), `physics_on` and `physics_off` (`{ frames, worst_frame, worst_triangles, line }` or null, side by side so a reader sees which folds physics adds), `physics_constraints` (the physics constraints on the mesh's bones, `"<name> on <bone>"`, when the fold appears only with physics on; empty otherwise), `declared` (the `may_fold` why, or null) and `line`, rigc's printed line verbatim |
| `folding_undeclared` | the rows no `may_fold` entry takes: the bar's figure |
| `declared_not_folding` | the `may_fold` entries no row matches, each a failure |
| `bar` | 0 |

⭐ **Judged with physics on, and reported with physics on and off side by side** (issue #363).
Before issue #363 the check stripped every physics constraint before posing (issues #320, #333),
so a skirt whose physics flipped it over the hips (inertia 0.75, strength 100, damping 0.975 on
all nine links: 30 of 104 triangles folded on a dance rig, and 47 of 292 on `demo`'s `hop`)
passed unchanged. Now `check` poses the animations with physics stepping on the render clock, and
also poses the keyed build (physics left out) when the rig declares physics constraints, reporting
`physics_on` and `physics_off` side by side on every folding row and naming the mesh, the physics
constraint(s) on its bones and the worst frame when a fold appears only with physics on. On `scarf`,
lowering the short skirt's `inertia` from 0.12 to 0.1 keeps `hop` fold-free at 12 fps as well as at
10, 15, 24, 30, 36, 48 and 60 fps.

On the examples: `demo` (the idle and 7 animations), `scarf` (the idle and 7),
`reference-sample` (the idle and 1), `reference-demo` (the idle alone) and `wind` (the idle alone) read no folding mesh
with physics on or off, and neither does the trailer's idle (`rig-c/trailer`, its parts built by this tree, and its film
rig's `idle` and `show`). What the
reading adds to `check`, measured with `/usr/bin/time` on `demo`'s keyed build (median of
three, user + sys, a machine under load, so the wall figures are not quoted): one run over the
idle and its 7 animations 4.1 s, the idle alone 2.9 s, and the same rig with its 7 animations
copied to 21 — 7.5 s, so about 0.24 s per animation of `demo`'s length (1.2 to 2.2 s) at 12 fps
past a fixed 2.4 s. At `--max 640`, the idle render's size, the same run took 17.6 s.

After them, one **reported line** with no bar:

| line | reports | bar | `reference-demo` | `reference-sample` | SKIP when |
| --- | --- | --- | --- | --- | --- |
| <a id="RECOMPOSITE_HOLES"></a>`RECOMPOSITE_HOLES` | `parts.json`'s `recomposite` block (§5), read rather than measured — under `config.scene` (issue #242) it was measured inside the figure, and the line's first figure, `declared_scene`, says so: `error_px`, `uncovered_error_px`, `hole_count`, and the largest hole's `px`, `box` (`x,y wxh`) and `borders` (`<part> <px> px`) | none — status `REPORTED`, never FAIL, and `PASS` does not read it | 1,564 px in 453 holes; largest 70 px at 351,155 6x22, `hair_back` 53 px, `hair_front` 12 px | 1,185 px in 259 holes; largest 94 px at 479,412 7x34, `sleeves` 42 px, `topwear` 40 px, `bottomwear` 6 px | `parts.json` has no `recomposite` block (the reference's files) |

It exists because no gate can see what it reports. The seam compares the setup pose
with the flat stack **of the parts**, so a pixel of the painting that no part holds is
missing from both sides and the seam passes over it — a white gap between two legs
See-through made of one skirt built green with 7,671 uncovered pixels (issue #25). The line puts that class of defect into
`check.json`, where an agent that reads only `check.json` sees it. It is not a bar for
the reason the colour-patch half of `BLINK_NO_HOLE` is not one: no threshold is
derivable from the examples — both hold hundreds of holes of a few dozen pixels along
part edges, and whether a hole matters depends on where it is, which the box and the
bordering parts say and a count cannot. Read it as a figure, quote it in a report, and
look at `recomposite_error_rig.png` when the largest hole is more than a sliver.

Under `--source <painting.png>`, a second reported line, also never a FAIL
(issue #77):

| line | reports | bar | `reference-demo` | `reference-sample` | SKIP when |
| --- | --- | --- | --- | --- | --- |
| <a id="SETUP_POSE_VS_SOURCE"></a>`SETUP_POSE_VS_SOURCE` | the setup pose against the painting, by `assemble`'s own `measureRecomposite` over the stage's pixels — `mean_abs` and `within_share` (mean channel, within 8), `error_px` (max channel over 40), `uncovered_error_px` (of those, where the pose has alpha 128 or less), `hole_count` and the largest hole's box — with `painting_px`, `stage_px`, `render_px` and `render_scale` beside them. The painting is resampled onto the stage as assemble resamples it (lanczos3, alpha dropped). rigc renders onto an opaque grey, so the pose over white and its alpha are read off a second still of the same pose with every slot tinted black; both are carried onto the stage with the seam's map turned round (bilinear) | none — status `REPORTED`; assemble applies no bar to the figures it measures, so none is derived here | 3.146 / 93.43 % / 12,399 / 1,732, 518 holes, the largest 61 px at 351,157 6x20 (assemble's recomposite: 2.391 / 95.81 % / 11,050 / 1,564, 453) | 1.095 / 97.30 % / 5,348 / 1,239, 313 holes, the largest 88 px at 479,416 6x29 (assemble's: 0.835 / 97.95 % / 4,512 / 1,185, 259) | not written without `--source` |

The figures are assemble's by construction, not a second definition beside them;
what differs is what they are taken of — the pose rigc draws, not the flat stack —
and the gap between the two columns above is that drawing: the render's resampling at
its scale (0.942 on reference-demo, 1.012 on reference-sample) and the warp back onto the stage,
which soften every part edge by a pixel or two. It moves with the render's grid
[observed, reference-demo's still rendered at four sizes: mean 2.663 at scale 1.0003, 3.091
at 1.0073, 3.146 at 0.942, 3.186 at 1.884], so compare the line with itself across
rigs or edits, and with `RECOMPOSITE_HOLES` for where a hole is, not digit for digit
with the recomposite. On the examples the line reads the same with and without
`parts.json` (the still's grid does not move).

What each figure is, and is not:

- **The seam is the answer to "at rest, no gap, white rim or doubled line between
  layers".** A gap shows the page, a rim a colour no part has there, a doubled line a
  part drawn off its place; each changes the setup-pose render against the flat stack,
  which is what the seam bar measures. No separate line is written for it.
- **The blink is measured at the setup pose, not in an idle frame.** Since issue #32
  an idle frame does fall inside the closed window — on both examples the eyes are
  fully shut from 2.37 s to 2.454 s and `idle_frames_closed` is `[29]` (2.417 s) — but
  that frame also carries the idle's sway, so it is not a comparison of what the blink
  alone changed. rigc's `render` takes no time, so the closed pose is a throwaway
  animation holding the blink tracks' closed value, built and rendered beside the
  seam's still on the same grid. `idle_frames_closed` is what says the loop shows the
  closed eye; before #32 it was `[]` on both examples, with the 0.04 s hold between
  frames 28 and 29.
- **The colour-patch figure is not reliable enough for a bar.** "Nearest colour in the
  open eye's box" counts a legitimate colour the open eye never showed (skin under the
  lid) as a patch, and a patch the open eye happened to contain as none. It is
  reported, and 15 and 11 on the examples are what a clean lid looks like.
- **A lag is read modulo half a cycle.** A sine's sign is half a cycle of phase, and
  the keys cannot tell `amp −0.6, phase 0.2` from `amp 0.6, phase 0.7` — the mirrored
  chains of both examples are written the first way — so the reading folds a step into
  (−¼, ¼] of a cycle and reports amplitudes unsigned. A lag of a quarter cycle or more
  cannot be told from a lead, and the refusal says so: it prints the raw phases, the
  fold and the child phases that pass, two windows half a cycle apart (§6,
  `CHECK_CHAIN_LAG`; issue #580). Tracks whose keys are not a sampled sine are listed as
  `unread`, and a keyed bone under a keyed ancestor of another period (reference-demo's
  tassel under the head) is listed in `other_period` and not compared.
- **Tip over root is a centroid, not a displacement.** Art entering or leaving a half
  moves its centroid too. The halves' mean heat was the brief's first choice and was
  rejected: heat is texture times motion, and on reference-demo's sleeves the lower half's
  mean heat is 1.1 times the upper half's while its centroid travels 3.7 times as far.
  The halves split the box across its rows, which assumes the part hangs — true of a
  front-facing standing figure, the only input this tool takes.
- **Stretch is read on edges, both ways, and the ceiling doubles |ln r|.** Compression
  distorts a texture as much as stretch — an edge at half its rest length squeezes
  the texels on it by the factor an edge at twice its length spreads them — so the
  figure is max(ratio, 1/ratio), and on both examples the worst triangle is a
  compression (reference-demo 0.720, reference-sample 0.815). The ceiling rule is applied to the quantity
  whose zero means "nothing happened", as it is for heat: for a ratio that is |ln r|,
  so twice reference-demo's |ln 1.388| is ln(1.388²) = ln 1.926544 and reference-sample clears it by 3.2
  times. Doubling the ratio itself (2.776) was rejected: its zero is not at 1, and it
  passes an edge drawn at 2.7 times its rest length. The rest is the art's own
  proportions — on both examples every rest edge equals its `uvs` edge times the
  attachment's size to within 2.4e-5, the uvs' six-decimal rounding.
- **The face is measured in the head's frame (issue #33), from geometry (issue #123).**
  - **Until #33** the face half read the screen-space heat map. There the head's
    intended roll lit the outline on both examples, 16.988 and 11.475.
  - **#33 moved the reading into the head bone's frame.** Its ceiling became twice a
    calibration render's resampler error: the whole rig moved rigidly as the idle
    moves the head.
  - **That reading's region dropped a rim** of `1 + 1/scale` rig px around every
    pixel that was not face. Measured over the rim instead, both examples sat at 1.31
    and 1.34 times their calibration, and the excess was the bangs' art sliding over
    the rim.
  - **Issue #123 measured the same question exactly** and found the trimmed rim was
    the whole story: the bangs reach 2.2–2.8 rig px into the face outline. The rim
    was wider than that, so the pixel figure only ever read resampler noise
    (*`STILL_REGIONS_DARK` is measured from geometry too*, above).
  - **The line now asks what it can answer exactly:** whether the still set keeps its
    place relative to the head bone, up to the arithmetic's rounding.
  - **The line still does not judge a face that moves with the bone its own slot
    rides.** That is the head moving, whatever the bone. A face region on the wrong
    bone is for the feet half and the eye lines to catch.
- **What the still set leaves out, and why.** The blink and the brows move features on
  bones of their own, by design, so those slots are not in the set. A slot the idle keys
  by slot (`deform`, `sequence`, a slot track) moves by design too, and is listed in
  `driven_slots` instead. A bang weighted to its chain moves over the face by design;
  its depth is reported per slot in `crossing`, which no bar reads.
- **The feet are measured in screen space.** They ride the root, which the idle does not
  key, so the screen is their own frame.
  - Until #123 the feet half read the screen-space heat. On reference-demo the long skirt,
    drawn under the shoes, swings beside them and lit their rim to 1.622.
  - From the geometry, nothing drawn over the shoes enters them on any example, and
    the shoes move exactly 0.
  - A foot moved `fround(0.05)` rig px read a heat mean of 0.78 against the old
    ceiling of 3.244 at every grid, a PASS. It now fails by its 0.05.

Nothing is left that only an eye answers. "No visible texture stretch" left this list
with issue #31 (`TEXTURE_STRETCH`), and "the face outline held still in the head's own
frame" with issue #33 (the face half of `STILL_REGIONS_DARK`, above, read from geometry
since issue #123). A bang over the face or the eyes is still an eye's to judge: `check`
reports how deep it swings (`crossing`) and nothing more.

### Measuring a rig rig-parts did not assemble

`check` takes a rig spec — `rig.json` and `motion.json`, the `rigc-rig/1` and
`rigc-motion/1` pair `rigc build` compiles — not a compiled `skeleton.json`, because
the gate is `rigc build`. A rig merged from several rig-parts outputs — by
`compose` (below), or outside the package (prefixed names, one root, a plate region
at slot 0) — is such a spec, with no
`parts.json` beside it and possibly no `idle`. Each bar then measures exactly when what
it reads is there, and says SKIP with the reason when it is not:

| bar or line | reads | SKIP when |
| --- | --- | --- |
| the gate | the rig spec | never — it always runs, on whatever the spec declares |
| loop | the `idle` | no `idle` in `motion.json` (`check.json`: `loop_max_diff` null, `skipped.loop` the reason) |
| seam | `parts.json` and `parts/` | no `parts.json` (`seam_*` null, `skipped.seam` the reason) |
| `BREATH_VISIBLE`, `BLINK_NO_HOLE`, `TIP_OVER_ROOT`, `STILL_REGIONS_DARK` | `parts.json`'s tags and the idle | either missing, or as in the table above |
| `CHAIN_LAG`, `TEXTURE_STRETCH` | the idle (and `rig.json`) | no `idle`, or as in the table above |
| `ANIMATIONS_DO_NOT_FOLD` | every animation, the idle included, through `rigc render --folds` | never SKIP: written when `motion.json` holds an animation, the idle alone included (issue #333), absent when it holds none (with or without a `parts.json`) |
| `STRESS_OFF_CHAIN` | `parts.json`'s tags, the idle's chains, `rig.json`'s weights, and a turned copy rigc poses | written only when `parts.json` names a `handwear` part and there is an idle (absent on a rig with no `parts.json`); SKIP when no such part rides exactly one chain, each part's reason |
| `SEAM_OVER_RANGE` | `parts.json`'s limb records with a `range`, and a bent copy rigc renders | written only when a limb record carries a `range` (absent on a rig with no `parts.json`); never SKIP — a joint it cannot read is a FAIL naming why |
| `SEAM_OVER_MOTION` | `parts.json`'s limb records and `--requirements` seams, and every animation through `rigc render --seam` | a warning, not a bar: SKIP, printed and named, with no `parts.json` (absent from `check.json`), no pair declared, or no animation |
| `RECOMPOSITE_HOLES` | `parts.json`'s `recomposite` block | no `parts.json`, or no block |
| `SETUP_POSE_VS_SOURCE` | the rig spec and the painting | no `--source` |

`PASS` reads every bar that measured, and the last console line says how many did:
`check: PASS; 1 of 9 bar(s) measured, 8 skipped (loop, seam, …)` is a rig with no animation at
all whose gate is green and nothing else was looked at. Without an idle no idle is rendered
(`idle_frames/`, `contact.png` and `motion_heat.png` are not written). Reference-demo's own
rig directory, copied away from its `parts.json`, reads `5 of 10`: the gate, the loop,
`CHAIN_LAG`, `TEXTURE_STRETCH` and, since issue #333, `ANIMATIONS_DO_NOT_FOLD` over its idle.

### Composing several characters (`compose`, issue #74)

`rig-parts compose --scene <scene.json> --out <dir> [--requirements <file.json>] [--accept <bar>[,<bar>…]]`
binds characters this package already built into one rig. Each character runs the
single-character path (§4, steps 0–9) on its own, already isolated input to a green
`build` first; compose reads what that build wrote and changes nothing in it.

```
{ "spec": "spine-parts-scene/1",
  "canvas": { "width": 1664, "height": 1216 },
  "plate": { "image": "plate.png", "provenance": "generated", "note": "…" },
  "characters": [
    { "id": "demo",   "build": "out-demo",   "offset": [0, 0] },
    { "id": "sample", "build": "out-sample", "offset": [832, 0] } ],
  "order": [ "demo", "sample" ] }
```

| field | what it is |
| --- | --- |
| `canvas` | the shared stage, canvas px, y down. The composed rig's stage is the canvas, `root` at its bottom centre, as a single character's is its own |
| `plate` | optional. `image` (relative to the scene file) is a PNG of exactly the canvas's size; `provenance` is `observed` (the painting's own pixels), `generated` or `unknown` (a residual after the people were removed is `unknown` where they stood, and the author says so); `note` is free text. Both are copied into `scene.json` and **judged by nothing** |
| `characters[].id` | the prefix: every bone, slot, attachment (skin entry), constraint (its name, and every bone and path slot it names), `stops` entry (its `chain`, `links` and `against`, issue #431), `invariants.detached` bone, track, group and easing of that character is renamed `<id>:<name>`. `root` is the one shared root. A name resolves to exactly one character, and nothing resolves across characters without its prefix |
| `characters[].build` | a `build --out` directory (relative to the scene file) whose own `check/check.json` is green |
| `characters[].offset` | `[x, y]`, a translation from the build's rig px to canvas px. Every character is built at one `assemble.rig_scale`, so its rig px are canvas px at scale 1 |
| `characters[].scale` | optional, a positive number; absent is 1, and 1 composes to the bytes a scene without the key writes. The character's size on the canvas, about its stage's top-left corner: a rig px `p` lands at canvas px `scale * p + offset` (issue #197). A character scaled up past its art is drawn soft — the art is not resampled; rebuild it at a higher `assemble.rig_scale` if that matters |
| `characters[].accept` | optional, a list of bar names: the bars this character's own check may have failed and still be composed (issue #203). `compose --accept <bar>[,<bar>…]` is the same list for every character; the two are joined, so the command line applies to every character and a character's list adds to it. Each name is one of the bars `check`'s summary names, less the gate — `loop`, `seam`, `BREATH_VISIBLE`, `BLINK_NO_HOLE`, `CHAIN_LAG`, `TIP_OVER_ROOT`, `STILL_REGIONS_DARK`, `TEXTURE_STRETCH`, `ANIMATIONS_DO_NOT_FOLD` (issue #320), `STRESS_OFF_CHAIN` (issue #347); anything else is `SCENE_ACCEPT_KNOWN`. A build is taken when every bar its `check.json` failed is named; its gate red, a declared requirement not PASS, or a bar not named is `SCENE_BUILD_GREEN` as before. **It is for looking, not for shipping:** the `[compose]` line says which failing bars were accepted, `scene.json` records them as the character's `accepted`, the composed rig's own check measures them again and reports them as it finds them, and the run exits 1 even when that check is PASS (a composed rig has no `parts.json`, so the seam and four judgement lines say SKIP there). A list that accepts nothing — every build green — composes to the bytes a scene without one writes |
| `order` | the draw order, back to front: a character id (its slots not named elsewhere, in its own order) or one `<id>:<slot>`. Every slot of every character is drawn exactly once. Interleaving is written by naming slots: `["a", "b:arm_l", "b"]` draws `b`'s left arm between `a` and the rest of `b` |

What is composed:

- **Images are `<id>.<file>`, not `<id>:<file>`.** rig-c names an atlas region
  by its PNG's basename, and an atlas region line that holds `:` is read as a
  `key: value` line: measured through rig-c 2.15.0 on reference-demo renamed
  `demo:<name>` with images `demo:<file>`, `A07_ATLAS_TEXT_SHAPE` fails once per
  region; with the images under a `demo/` folder the rig gates green but the region
  keeps the bare basename, so two characters' `face` would collide. So the
  attachment is `demo:face` and its region `demo.face`, and the compiled skeleton
  carries Spine's `path` for each attachment where the two names differ.
- **The offset is applied once,** to what the character places in `root`'s own
  frame: its first-level bones (the bones whose parent is `root`), and a region on a
  slot `root` carries or a mesh weight bound to `root` — both public examples'
  `shoes` ride `root`. Every other offset, weight bind and region in a rig spec is
  local to a bone the shift already moved. In Spine's axes the shift is the
  character's stage corner carried to its canvas place — `scene.json` records it per
  character, with what it moved. The root is shared, so a character whose idle keys
  it, or whose constraint or stop names it, is refused (`SCENE_ROOT_SHARED`): it would move
  every character.
- **The scale** (issue #197) is applied with the offset: every length the character
  carries is multiplied by it exactly where Spine's own loader multiplies by its
  `scale` (`SkeletonJson.js`, spine-core 4.3) — each bone's `x`, `y` and `length`;
  each region's `x`, `y`, and its drawn size through `scaleX`/`scaleY` (rig-c reads
  `width`/`height` off the PNG); each weight's bind `x`, `y`; an ik's `softness`; a
  transform's `x`, `y` and, in its `properties`, the `offset` of an `x`/`y` source and
  the `offset` and `max` of an `x`/`y` target, its `scale` by the target's unit over
  the source's; a path's `position` under `positionMode` Fixed and its `spacing` under
  `spacingMode` Length or Fixed; a physics `limit`; a slider driven by a bone's `x` or
  `y`, its `from` scaled and its `scale` divided; each stop's `at` offset in its
  `against` bone's local frame (issue #431); and the translate keys (`translate`,
  `translatex`, `translatey`), their curves' values with them. An absent field whose
  Spine default is not 0 (a physics `limit`, 5000; a transform target's `max`, 1; a
  slider's `scale`, 1) is written as that default scaled. Degrees, mixes, ratios,
  physics rates, a stop's `inward`/`outward` bounds and a mesh's `width`/`height` (its image's, nonessential) are not
  lengths and stay. Then what sits in `root`'s own frame takes the shift, so the
  character's stage corner lands at `offset`. `scene.json` writes `scale` beside the
  offset only when it is not 1, and the `[compose]` line always prints it.
- **The plate** is a region on the bone `plate` under `root`, the first slot, its
  image at canvas (0, 0).
- **One `idle`** holds every character's tracks; the characters' idles must be of one
  duration. Constraints and `stops` entries are carried in character order with their
  `invariants.detached`; `invariants.idleDrivesMeshes` once, when any character
  declares it.
- **Every animation beside a character's idle** — what `motion.animations_from`
  wrote into its `motion.json` (§3) — rides along as `<id>:<name>` after the idle,
  its tracks' bones, groups and easings prefixed as the idle's are and every other
  value as written; the scene schedules none of them, they are the consumer's to
  play. Each is read with the idle's own key lists, so a key compose does not know
  how to prefix is `SCENE_BUILD_FIELD_KNOWN`, as it is on the idle, and a track of
  one that keys `root` is `SCENE_ROOT_SHARED` (issue #183).
- **Gated as `rig` gates its own:** `rigc build --profile rig-play --pack`, the
  compile and the packed pages on disk, in a scratch directory; `--out` receives
  `rig/` (`rig.json`, `motion.json`, `images/`) and `scene.json` only when it is
  green. Then `check` runs over `rig/` into `check/`, as on any rig it did not
  build: without a `parts.json` the seam, `BREATH_VISIBLE`, `BLINK_NO_HOLE`,
  `TIP_OVER_ROOT`, `STILL_REGIONS_DARK` and `RECOMPOSITE_HOLES` say SKIP and why,
  and the gate, the loop, `CHAIN_LAG` and `TEXTURE_STRETCH` measure.
  `--requirements` is forwarded, and its names are `<id>:<name>`. Every bar and
  requirement measures the composed rig in canvas px, after each character's
  `scale`: a ratio (`TEXTURE_STRETCH`'s edge against its rest length) or an angle
  (`CHAIN_LAG`, a `range` in degrees) does not move with it, while a requirement's
  px figures and its px bar are canvas px — a character composed at 0.5 shows half
  the px its own `build` measured.
- **`scene.json`** (`spine-parts-scene-report/1`): the scene file's path as given,
  the canvas, the rig's name (the ids joined by `+`), the pack flags, the plate (its
  image, provenance, note, bone, slot, size, `judged_by: "nothing"`), per character
  its build, offset, `scale` (only when it is not 1), `rig_size`, `rig_scale`, placed bounds (the union of its part
  boxes, canvas px), shift and what it moved (`shifted`: the first-level bones, the
  regions on `root`, the count of weights bound to `root`), its counts and `accepted`
  (the failing bars of its own check that an accept list took, only when there are any), and the
  order —
  as declared and as the slot list it expands to, `judged_by: "nothing"`.

A scene of one character at offset (0, 0) on a canvas of its own size, with no
plate, composes to that character's own build renamed only: on both public
examples `rig.json`, `motion.json`, every image, the atlas, the packed page and
every idle frame are byte-identical once `<id>:` and `<id>.` are taken off, and
`skeleton.json` and `skeleton.model.json` equal as values but for Spine's `path`
and the model's `spine.sha256`, which on each side is the sha256 of its own
`skeleton.json` and so changes with the names (selftest `CH910`).

**Not offered.** Reconciling two `rig_scale`s (one is required; `scale` sizes a
character, it does not resample its art); a non-uniform scale, a flip or a rotation
of a character; any order, overlap or occlusion inferred from an image — the order is the author's,
and a per-pixel vote that holds for a still pose would not hold once the bodies
move; person detection, segmentation, isolation or occlusion completion (each
character's input arrives isolated); a composed `parts.json`, so the bars that
read See-through tags are measured per character by its own `build`, not over the
scene; a rig `build` did not write.

### Declared requirements (`--requirements`)

The bars above are this package's. What a *scene* asks of the rig's motion — that
a hand stays on a cup, that a sleeve takes half of what an arm's constraint asks of
it, that a joint stays inside a range — is the scene's knowledge (issue #87), so it
travels in a file `check` is given, `--requirements <file>` (`build` forwards it).
Every bar in it is the author's; a missing one is refused by name. Nothing here
solves, guesses a value or chooses a bar: every pose is rig-c's, read from the
world transforms `rigc render --geometry` writes (`rigc-geometry/1`). Coordinates in
the file are stage px, y down, as in the config; a stage pixel is one Spine world
unit (the stage box maps to the world by a translation and the y flip,
`src/coords.ts`); angles are degrees.

```json
{
  "spec": "spine-parts-requirements/1",
  "fps": 12,
  "targets": [{ "bone": "cup", "animation": "reach", "keys": [{ "t": 0, "at": [44, 32] }, { "t": 1, "at": [50, 32] }] }],
  "requirements": [
    { "name": "HAND_ON_CUP", "kind": "contact", "animation": "reach", "bone": "forearm", "point": "tip", "target": { "bone": "cup", "point": "origin" }, "within_px": 0.5 },
    { "name": "SLEEVE_HALF", "kind": "follow", "animation": "reach", "constraint": "sleeve_tf", "constraint_type": "transform", "bone": "sleeve", "property": "rotate", "fraction": 0.5, "tolerance": 0.05, "least_drive": 2 },
    { "name": "EYES_ON_CUP", "kind": "aim", "animation": "reach", "bone": "gaze", "target": { "bone": "cup", "point": "origin" }, "within_degrees": 3 },
    { "name": "ELBOW", "kind": "range", "animation": "reach", "bone": "forearm", "lo_degrees": -10, "hi_degrees": 150 },
    { "name": "SLEEVE_SKIN", "kind": "stretch", "animation": "reach", "slot": "sleeve", "attachment": "sleeve", "within_ratio": 1.3 },
    { "name": "CUFF_ON_HAND", "kind": "seam", "animation": "reach", "part": "sleeve", "neighbour": "hand", "within_px": 1 }
  ]
}
```

**Where a rebuild finds the file** (issue #556). A rig that passes only under its
requirements — a rigid shorts piece in `not_swinging`, a fold the art means in
`may_fold` — rebuilds green only if the next caller knows the file. `check.json`'s
`requirements` block opens with `file`: `path` as the caller wrote it (`--requirements`
as typed, or `config.requirements` as declared — never resolved, so a build moved to
another directory writes the same bytes), the `sha256` of the bytes read, and `keys`,
the file's top-level keys in its order, so a reader sees what it asked without opening
it. `config.requirements` (§3) declares the file beside the config, and `build` reads
it when the flag is not given: a build with `--requirements reqs.json`, typed from the
config's directory, and a rebuild from a config declaring `"requirements": "reqs.json"`
write the same bytes, every file (selftest `BU178`). A flag naming other bytes than the
declaration is `BUILD_REQUIREMENTS_CONFLICT` (`BU179`); the same file by both, or a copy
of it, builds what the config alone builds (`BU180`). Without either, no `requirements`
block is written and no byte moves.

**Which config a build read** (issue #607). `build` records its config in the same
shape, just before the `requirements` block: `"config": { "path", "sha256" }`, `path`
as `--config` was typed (a relative path stays relative) and `sha256` of the bytes the
build's full loader parsed, so a reader ties a build to its config by digest rather than
by where the files sit (selftest `BU210`, `BU211`). `check` reads no config and writes
no `config` record; otherwise its `check.json` is the build's (`BU212`).

**Feet that are not planted** (issue #231). The feet halves of `BREATH_VISIBLE` and
`STILL_REGIONS_DARK` assume a figure that stands: every `footwear` part holds still.
Whether the figure stands is the scene's knowledge, so a scene where it sits and its
legs swing says so here, by part: `"not_planted": ["shoes"]`. Each name must be a
`footwear` part in `parts.json` (`REQUIREMENTS_RESOLVES`, `REQUIREMENTS_NOT_PLANTED`).
A declared part is left out of both feet halves, and the declaration is the first
figure of each line it relaxes — `declared_not_planted` in `BREATH_VISIBLE`, and in
`STILL_REGIONS_DARK`'s `feet` — in `check.json` and on the console, so a relaxed bar
never reads as a passed one. With every foot declared, the torso is still measured
(`feet_parts` `[]`, `feet_heat_max` null) and the feet half reads `unmeasured` with
the reason. The field absent, nothing changes: every `footwear` part is a planted foot.

**Swinging parts that do not hang** (issue #231). `TIP_OVER_ROOT` reads every
`handwear` and `bottomwear` part as hanging: the lower half of its box is the tip's.
Two declarations, by part, say where that does not hold. `"not_swinging": ["under"]`
— a piece cut off and left still — leaves the part out of the bar; its row reads
`unmeasured` with the reason. `"rises": ["arm"]` — a forearm raised from the elbow —
reads the part's **upper** half as the tip's (its row carries `tip_half: "upper"`),
and only after checking the chain that carries it does rise: the part's bound bones
walked up to a chain `CHAIN_LAG` reads, the chain's **last link** at the setup pose —
from its origin along its `length`, the extent the rig stage turns a link to, or, a
last link with no length, from the link before's origin to its own — read along its
longer axis, must run up, or the declaration is refused naming the link and the
direction measured. The last link is read because the tip half is its art: a folded
arm — an upper arm hanging to the elbow, a forearm raised above the shoulder — rises
at its last link though its first runs down (issue #322; until then the first link's
origin to the last's was read, and such an arm was refused). The row then carries
`tip_read` after `tip_half`, the reading that let it rise, e.g. `"arm0_ctl >
arm1_ctl: its last link arm1_ctl, from its origin along its length 30, runs up (0,
30 world px)"`. The line's first figures after `status` are
`declared_not_swinging` and `declared_rises`. Each name must be a swinging part in
`parts.json`, and no part may be in both lists.

**Swinging parts whose tip rests** (issue #245). `not_swinging` leaves a part with no
bar at all; when the scene knows the tip is at rest — a hand lying on the bed while
the shoulder moves with the breath — it says so: `"rests": ["hem"]`. The part is
measured with the same two halves and held to the opposite relation: its tip half
travels no further than its root half, ratio ≤ 1 (`rest_ratio_ceiling` after
`ratio_floor`) — the declaration's own relation, not a margin read off the examples,
none of which declares it. With a root that does not move, the tip must not either.
Its row carries `declared: "rests"` after the part's name, the line's
`declared_rests` follows the other two declarations, and a tip that swings anyway is
`CHECK_TIP_OVER_ROOT` naming the declaration. `CHAIN_LAG` reads the chains carrying
each declared part (its bound bones walked up to a chain, as for `rises`) the same
way: their amplitudes must not grow toward the tip; their lag is kept, since the
declaration says how far the tip moves and not when. That line's first figures are
`declared_rests` and `resting_chains`. Each name must be a swinging part in
`parts.json` and not one `not_swinging` names; a part may both rise and rest.

**Folds the art means** (issue #320). `ANIMATIONS_DO_NOT_FOLD` holds every animation, the
idle included (issue #333), to no mesh triangle turned over against the setup pose (§7). When a clip folds a
mesh on purpose — a sleeve that tucks behind the body as the arm crosses it — the scene says
so, by slot and animation, with its reason:
`"may_fold": [{ "slot": "handwear_l", "animation": "dance", "why": "the cuff tucks behind the chest on the cross step" }]`.
The fold's row in the line carries `declared`, the why, the console's `folds` line ends
`— declared in may_fold: <why>`, and it is not held to the bar. Each entry is three names, no
default — a `why` left blank is refused, as is an empty list, a field the entry does not read
and a pair declared twice (`REQUIREMENTS_FIELD`); the slot must hold a mesh and the
animation must be one `motion.json` declares — `idle` is one like any other
(`REQUIREMENTS_RESOLVES`, `REQUIREMENTS_MAY_FOLD`);
and an entry whose slot does not fold in its animation fails the line
(`CHECK_ANIMATIONS_DO_NOT_FOLD`, `declared_not_folding`) — an exception that excepts nothing
is taken out of the file, as rig-c refuses one for `invariants.deformMayFold`.

`fps` and `requirements` are required as always; a file that declares only exceptions
is `{ "spec": "spine-parts-requirements/1", "fps": 12, "requirements": [], "not_planted": ["shoes"], "not_swinging": ["under"], "rises": ["arm"], "rests": ["hem"] }`.

**Four outcomes, never merged** (#87):

| outcome | when | what it does to the run |
| --- | --- | --- |
| not declared | the file states no requirement of that kind | the summary line names the kind; not a pass, not a skip of something asked. Without `--requirements` nothing is read, written or printed for it |
| refused | the file cannot be read against the rig (§6, `REQUIREMENTS_*`) | refused by name before anything is built (exit 1) |
| not measurable | it reads and the rig builds, and the quantity is undefined in the frames | `NAME: NOT MEASURABLE — <why>` with the figures that show it, `CHECK_REQUIREMENT_MEASURABLE`; the run does not PASS |
| measured | otherwise | `PASS` or `FAIL` against the author's bar, with the figures and the worst frame; a FAIL is `CHECK_REQUIREMENT_MET` |

**The six kinds**, each over every frame of its animation sampled at the file's `fps`:

| kind | declares | measures | not measurable when |
| --- | --- | --- | --- |
| `contact` | `bone`, `point` (`origin` or `tip`), `target` (`{ "bone", "point" }` or `{ "stage": [x, y] }`), `within_px` | the largest distance between the two points, and its frame; a tip is the origin plus `length` along the bone's x axis | a tip on a bone of length 0, on either side |
| `aim` | `bone`, `target`, `within_degrees` | the largest angle between the bone's axis and the line from its origin to the target; the distance is not judged | the bone has length 0; a frame whose target sits on the origin has no line and is not counted, and with no line on any frame the requirement is not measurable |
| `range` | `bone`, `lo_degrees`, `hi_degrees` | the bone's world rotation less its parent's (the world's, for the root), less the same at the setup pose, as a signed shortest angle: the least and the greatest, and their frames | — |
| `stretch` | `slot`, `attachment` (a mesh), `within_ratio` | `TEXTURE_STRETCH`'s own per-mesh measure (imported, not rewritten): the mesh's worst max(ratio, 1/ratio) over the frames; `held_by` names what the worst edge's two vertices hang on, as `CHECK_TEXTURE_STRETCH` does (issue #321) | a rest edge of length 0; no frame shows the mesh |
| `follow` | `constraint`, `constraint_type` (`ik` or `transform`), `bone`, `property` (`rotate` or `translate`), `fraction`, `tolerance`, `least_drive` | below | no frame's drive reaches `least_drive` (the line prints the largest drive there was) |
| `seam` | `part`, `neighbour` (two part names: each is drawn by the slot of its name), `within_px` | below | no seam pair reads on any frame (each pixel off its attachment's rest geometry, or the slot shows nothing) |

A `contact` held against its own bone and point, and an `aim` at a point of the aimed bone itself, read 0 by construction (or, an aim at its own origin, no line at all), so they are refused before anything is built (`REQUIREMENTS_SELF_TARGET`, issue #540); a bone's tip against its own origin stays a contact, measured.

**`follow`**, #87's definition to the letter: "bone A takes a fraction `f` of what
constraint C asks of it" is measured from three poses of the same rig over the same
frames, each posed by rig-c and differing in one thing only — *as declared*, the
rig as written, `A(t)`; *released*, C's mix for that property forced to 0 and every
key of that mix in the animation removed, `A0(t)`; *full*, forced to 1, keys removed,
`A1(t)`. For `translate` A is the bone's world origin; for `rotate`, `atan2(c, a)` in
degrees, every difference a signed shortest angle (the line notes a largest drive
over 90°: a drive beyond 180° is not told from its complement). The drive is
`d(t) = A1(t) − A0(t)`; a frame counts when `|d(t)| ≥ least_drive`; the measured
fraction is `F = Σ⟨A(t) − A0(t), d(t)⟩ / Σ|d(t)|²` over the frames that count; PASS
when `|F − fraction| ≤ tolerance`. The line also carries the frames that counted, the
largest drive and its frame, and the largest residual `|A − A0 − F·d|` and its frame
— figures with no bar. It measures the realised follow, not the number in `mix`: a
keyed mix, a later constraint on the bone or physics on it show up in `A(t)` alone.
"Keys removed" is written as every key of that mix holding the forced value (its
curve channel's two value numbers with it), which poses what removing them under a
setup mix of that value poses, while every other field those keys state stays as
written. An ik's mix is `mix`; a transform's is `mixRotate` for `rotate`, and `mixX`
and `mixY` for `translate`.

The released copy rests muted throughout whenever no other animation keys that mix,
and rig-c's gate refuses that — `A47_IK_CONSTRAINT_NOT_MUTED_THROUGHOUT`,
`A48_TRANSFORM_CONSTRAINT_NOT_MUTED_THROUGHOUT`. When rigc refuses the released copy
for that constraint and for nothing else, the copy — never the rig under test —
declares it in `invariants.consumerDrivenMix`, rigc's own door for a mix the consumer
drives, and the line's `released_copy` says so; the full copy drops the constraint's
own declaration if the rig has one, since at 1 it rests live. Any other red line from
a copy is refused, `CHECK_RIGC_GREEN`, quoting rigc.

**`seam`** (issue #111): the seam bar (§7) compares the setup pose with the flat stack
of parts, so it cannot see two parts part in motion. A `seam` requirement can. Its
pairs are read off `parts.json`'s art at the setup pose: every pair (a, b) of
4-adjacent stage pixels with a an art pixel of `part` (alpha above 8, the threshold
meshes are built from) and b an art pixel of `neighbour` that is not `part`'s. On
each frame, each pixel centre's displacement from rest is read off its attachment in
`geometry.json` — the rest triangle holding it and the same barycentric mix of that
triangle's posed vertices (a region is the runtime's two triangles) — and a pair's
opening is the distance between the two displacements: how far the two sides moved
apart or across, in stage px. The line carries the largest opening, its frame and
its pair (`"part" pixel x,y against "neighbour" pixel x,y`), the pair count, and the
pair-frames not read: a pixel no rest triangle holds, or a slot showing nothing, is
counted, never read as 0. It is an upper bound on any gap: what shows through
depends on what is drawn under the seam. Two parts turning together by θ read
2 sin(θ/2) px across a pair one pixel apart (0.105 px at 6°), not 0. A part on a
bone's sway opens its seams by that sway, so the bar is the scene's: what it
declares is how far that pair may part.

**Scene targets.** A `targets` entry names a bone whose parent is the root and gives
it a stage point (`"at": [x, y]`) or stage points at stated times (`"keys"`), linear
between them, the first held before and the last after, for one named animation.
`check` writes it onto a throwaway copy — the bone's setup position is the first
point, the rest are translate keys from it, through the one y door, and the
animation's own translation tracks on that bone are dropped — and poses the copy
through rig-c; a follow's released and full copies carry the same placement. A
root that is not at rest at the origin, or that the animation moves, is refused,
because the stage point would not be the bone's position. In a rig composed of
several characters, a target can simply be another character's bone, named as the
composed rig names it.

**Where it is written**, under `--out`: `requirements/as-declared/<animation>/` (the
render each requirement on that animation reads: the rig under test's own build, or a
copy with its scene targets placed), and, per follow, `requirements/released/<name>/`
and `requirements/full/<name>/` — each a `rigc render` frame set with its
`geometry.json`. The copies' specs and builds are scratch, removed before the stage
returns. `check.json` gains `requirements` — `fps`, the summary and each line by name
— before `PASS`, and `PASS` needs every declared requirement to PASS.

The selftest holds each kind and outcome to a hand value on a generated rig
(`fixtures/reqrig.ts`): a two-bone ik that reaches its scene target holds its contact
and one 5 px short fails it at the frame it is short; an aim-only one-bone ik with a
far target passes and is not judged on distance; a follow at mix 0.5 measures 0.5 on
an ik and on a transform, and the same ik with its mix keyed 0, 1, 1 measures
3.5 / 5 = 0.7 and fails a declared 0.5; a follow whose target asks nothing and a tip
on a bone of length 0 are NOT MEASURABLE and the run is not PASS (`CK68`–`CK79`,
`RQ01`–`RQ22`). A seam between two parts on one rolling bone holds and reads only
2 sin(θ/2) px; the same back part sliding 3 px under its bone opens it by 3 at the
frame the slide peaks; a seam on a rig with no `parts.json` is refused before anything
is built (`CK83`–`CK85`, `RQ30`–`RQ35`).

## 8. What one character costs

| step | reference-sample | reference-demo | source |
| --- | --- | --- | --- |
| painting (GPU) | 20.2 s | 18.3 s | `generation.json` `elapsed_s`, in [parts-examples](https://github.com/rig-c/parts-examples) |
| See-through full run (GPU) | 194.9 s | 198.5 s | `inputs/layers/full/meta.json` `elapsed_s` |
| See-through head run (GPU) | 170.9 s | 171.4 s | `inputs/layers/head/meta.json` `elapsed_s` |
| `build` (CPU, user + sys) | 14.6 s | 30.7 s | measured with `/usr/bin/time -p` on an Apple M4 machine under other load, rigc's child processes included; wall clock 12.7 s and 27.5 s |

About 6.5 minutes of GPU and under a minute of CPU per character, before any hand
correction. The GPU figures are one run each on one machine; the painting's figure
excludes choosing among seeds (reference-demo was chosen from eighteen candidates).
Since issue #33 `check` runs one more `rigc build` and one more idle render (the face
calibration, §7); the idle's `geometry.json` is the one issue #31 already writes. The `build` row
was not re-measured: A/B against the tree before that change, alternating on one
machine under a load average of 5 to 11, the difference in user + sys was +5.6 and
+0.8 s on reference-demo and +6.5 and −1.6 s on reference-sample over two rounds — inside what
the load moves the same build by (the pre-change reference-demo build alone took 43.6 to
45.8 s there). Since issue #123 that build and render are gone again — the still regions read the
idle's geometry — and the `build` row was not re-measured for it either.
