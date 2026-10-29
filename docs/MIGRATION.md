# Migrating from 0.16.0

0.16.0 was the last version published under the package's former name. This page is
what changed between it and 1.0.0 for a user of the command, an author of a config
and a reader of the files a build writes; what 1.0.0 holds stable is
[STABILITY.md](STABILITY.md). It comes in two parts: 0.16.0 to the release candidate
1.0.0-rc.1, then what landed between the candidate and 1.0.0. Every figure is quoted
from the pull request that measured it.

## In one paragraph

Install `@rig-c/parts` (the package's name after 1.5.3; *After 1.5.3* below). A
config that built on 0.16.0 loads and builds unchanged: every config change since is
a new, opt-in field inside a new mesh mode. The bytes a config without that mode
builds moved once, by a declared exception (every mesh triangle's vertex order,
#133); apart from it, each change since 0.16.0 that touched the code was measured
against the tree before it on the three public examples' builds, and moved no byte
of them. Inside the automatic mode, one change after the candidate moves declared
bytes, named in *Since 1.0.0-rc.1*: the skinning envelope's reference (#169).

## From 0.16.0 to 1.0.0-rc.1

### The package name

| | 0.16.0 | 1.0.0-rc.1 and 1.0.0 |
| --- | --- | --- |
| npm package | the former name | `rig-parts`; the alias `spine-parts` is published beside it at every version, the same files with only the `name` in `package.json` changed |
| command | the former name | `rig-parts`; the install also keeps the alias `spine-parts` as a second command on the same launcher, for the transition |
| repository | the former repository name (GitHub redirects it) | `firejune/rig-parts` |
| selftest variables | the `SPINE_PARTS_` names | `RIG_PARTS_CORPUS`, `RIG_PARTS_SELFTEST_JOBS`, each read first, with the former `SPINE_PARTS_` name read when it is not set |
| spec ids of the files authors write and this package writes | `spine-parts-requirements/1`, `spine-parts-scene/1`, `spine-parts-keypoints/1`, `spine-parts-bonemap/1`, `spine-parts-basis/1`, `spine-parts-scene-report/1` | unchanged: they name a file format, not the tool, so a file written before the rename still reads |
| public examples repository | `spine-parts-examples` | unchanged (it keeps the name it was published under) |

What to do: install with `npm install -g @rig-c/parts` and write `rig-parts` in scripts.
A script or a dependant that names the alias `spine-parts` keeps working and keeps
receiving every release; how long the alias stays is RELEASING.md's *The alias stays
until its retirement questions have written answers*. No build output carries the
package name: a grep of all 330 files the three example builds write found neither
spelling (#142). The console does: the lines that name the tool (5 per build: the
`build`, `assemble`, `rig` twice and `check` lines) now say `rig-parts`. Where a
config uses a constraint or `--idle-keys direct`, the `why` prose this package writes
into `rig.json`'s invariants names `rig-parts` too; that prefix is the one known
output change of the rename (#142).

### rig-c, as this package sees it

The dependency is `rig-c` `^2.33.0` at 1.0.0 (`^2.31.0` at 1.0.0-rc.1; the moves
between the two are in *Since 1.0.0-rc.1*), where 0.16.0 took the same upstream
package under its former npm name at `^2.15.0`; that name is spelled only in `CHANGELOG.md`.
The upstream package was renamed on npm at 2.20.4 with the same `exports` map
(#138), and every import, probe and sentence here names `rig-c`. A project that
installed the former upstream name beside this package installs nothing more:
`rig-c` comes as a dependency. No Spine runtime is a dependency, as in 0.16.0.

### Scoped core dependency

The current dependency is `@rig-c/core` at exactly `2.82.0`, replacing the literal
`rig-c` dependency described for earlier versions above. The alias remains
published. Imports retain their subpaths: `rig-c/mesh` becomes
`@rig-c/core/mesh`, and `rig-c/core` becomes `@rig-c/core/core`. The command
remains `rigc`. Installing the canonical core beside this package no longer
adds the legacy package as a second compiler and command owner.

### The config

**A config that built on 0.16.0 loads unchanged.** The loader's only change between
the two is one more optional key, `auto`, on `meshes.<part>`, and the objects under it;
no key was removed, renamed or made required outside it, and no CLI flag was added or
removed (`git diff v0.16.0` of `src/config.ts` and `cli.ts`). `grid` and `contour`
meshes read exactly as before, and `propose` still writes `grid`.

What an author who adopts the new mode meets (AUTHORING §3, *An automatic mesh*):

- **`meshes.<part>.auto`**, the third mesh mode (#131): the contour mesh at alpha 1
  and above, reduced and locally refined by rig-c's `reduceMesh` under declared
  bounds. Exactly one of `grid`, `contour` and `auto` per mesh.
- **`motion` is required in it** (#134): at least `maxLocalDeformation`, the bound
  the reduced mesh's motion against its unreduced source on the idle must meet
  before the part is written. A part the idle cannot deform is refused, never
  passed.
- **`maxOvershoot` and `maxUndercut` take `null`** (#139), in `sourceBounds` and in
  `targets.artFit`: measured and reported, not bounded. Leaving the field out is
  still refused by name.
- **The acceptance loop** (#141) replays a less-reduced step when the motion gate
  refuses the full reduction; it needs no field. **`motion.selection`** (#151,
  opt-in) replaces its bisection with a budgeted multi-interval search.
- **The Stage B opt-ins** (#147): `boundaryRuns`, `retriangulate`, `removalOrder`.
- **`motion.gradation`** (#150, opt-in): the author's G for rig-c's allocation
  contrast row.
- **`motion.residual`** (#152, opt-in): the skinning residual as a per-step veto.

Without any of these the mode's output is what it was before each was added: every
pull request that added one compared the opt-out run against the tree before it,
byte for byte.

### The bytes a build writes

| change | what moved | measured |
| --- | --- | --- |
| #131, the automatic mode | nothing for a config without `auto` | 330 of 330 files of the three example builds identical, main at rig-c 2.15.0 against the change at 2.19.0 |
| #133, the winding | **the declared exception**: every mesh `triangles` triple `[a, b, c]` is written `[a, c, b]` (counter-clockwise in Spine world), in `rig.json`, the compiled `skeleton.json`, `skeleton.model.json` and the render's `geometry.json`; the `TEXTURE_STRETCH` entries in `check.json` that print a triangle's vertices and edge print them in that order; `spine.sha256` follows the skeleton bytes | every rendered PNG byte-identical before and after; the triangle index, the unordered edge, the frame, the ratio and the severity unchanged |
| #134, #137 to #142, #146, #147, #150, #152 | nothing | 330 of 330 at each, against the tree before it; the console differs in the one `rigc <version>` line per build where rig-c moved |
| #172 unit 1b, one mask under `stray` | nothing for a part without `auto.source.stray`; a part that declares it now builds where its extra islands at or under the figure refused it (`REDUCE_SOURCE_FAILS_ITS_ART_BOUNDS`): the islands are cleared from the art every reader of the mesh takes, and its row gains `stray_cleared` (islands, pixels, art pixels) and its mesh line a `stray cleared` clause; the written image is the part as assembled | the selftest's `SY01`–`SY06` on a synthetic crumb part; a part without `stray` reads the very mask object it read before (`SY03`) |
| #151, the multi-interval selection | nothing without `motion.selection` | measured on the selftest's fixture configs, not the example builds: rig.json, motion.json, mesh_report.json and the printed log identical in all six configurations; #152 then measured the example builds against the tree #151 left, 330 of 330 |

What to do: a consumer that compares a build with one 0.16.0 wrote, byte for byte,
expects the #133 exception and nothing else; one that reads the meshes (a renderer,
a culling pass, rig-c's own orientation rows) now reads every triangle
counter-clockwise in Spine world, as rig-c writes its own. Spine does not cull, so
nothing draws differently.

## Since 1.0.0-rc.1

Every change below is additive to the interface: a field that was refused is now
accepted, or a build that was refused now builds; nothing a 1.0.0-rc.1 config could
say is removed or reads differently, outside the declared byte move below. No CLI
flag was added or removed.

- **Density-only regions** (#156, opt-in): an `auto.regions` entry may leave out both
  `bone` and `band` to ask rig-c for density without touching any weight. One without
  the other is refused by name (`CONFIG_REGION_BAND_NEEDS_BONE`,
  `CONFIG_REGION_BONE_NEEDS_BAND`; at 1.0.0-rc.1 the same input was refused
  `CONFIG_FIELD_PRESENT`, naming the missing field), and a region with both reads as
  before. A config without such a region builds as before.
- **The skinning envelope's reference** (#169), **the declared byte move**: under
  `motion.residual`, the envelope rig-c's reducer is sent is derived against the
  lowest common ancestor of the slot's bone and every bone the part's weights bind,
  where 1.0.0-rc.1 derived it against the slot's bone and, when a bound bone did not
  hang below it, sent no target, so the residual veto did not apply. Such a part's
  reduction, written mesh and `mesh_report.json` row move; a part whose bound bones
  all hang below the slot's bone makes the same call as before. The
  `skinning_residual` row keeps its shape: its `reference` names the bone the envelope
  was derived against, and a part whose reference is not the slot's bone carries a
  second `rule` sentence naming the rule. `ENVELOPE_BONE_NOT_BELOW_REFERENCE` keeps
  its name and its check.
- **rig-c `^2.33.0`** (#163, #166, #173, from `^2.31.0`): 2.32.1 refuses, by name, a
  refinement insertion whose triangle would read as degenerate (`MQ_DEGENERATE`)
  instead of writing it (rigc#1311); 2.32.2 no longer misrefuses a motion sample on an
  edge two triangles share (`COMPARE_UV_CARRIER_NOT_UNIQUE`, rigc#1323); 2.33.0 adds
  named interior lines, which this package does not send. The three example builds
  are byte-identical across the move (#173).

What to do: nothing for a config without `auto`. A config under `auto` that declares
`motion.residual` may write a different mesh than 1.0.0-rc.1 did, as above; a
consumer that compares builds byte for byte with 1.0.0-rc.1 expects that move and
nothing else.

## After 1.5.3: the scoped name

| | 1.0.0 to 1.5.3 | after 1.5.3 |
| --- | --- | --- |
| npm package | `rig-parts` | `@rig-c/parts`; `rig-parts` and the alias `spine-parts` are published beside it at every version as aliases, the same files with only the `name` in `package.json` changed |
| command | `rig-parts`, and the alias `spine-parts` on the same launcher | unchanged |
| repository | `firejune/rig-parts` (GitHub redirects it) | `rig-c/parts`, beside `rig-c/core` (npm `@rig-c/core`, alias `rig-c`) and `rig-c/play` |
| spec ids, the config, the bytes a build writes | | unchanged |

What to do: install with `npm i -D @rig-c/parts` (or `npm install -g @rig-c/parts`);
command lines do not change. A dependant that names `rig-parts` keeps receiving
every release under it (#222).

## After 1.14.0: the idle is read for folds

| | 1.14.0 | after 1.14.0 |
| --- | --- | --- |
| `check.json`'s `ANIMATIONS_DO_NOT_FOLD` | written only when `motion.json` holds an animation beside the idle; its `animations` lists those | written whenever `motion.json` holds an animation, a rig of the idle alone included; its `animations` lists every one read, the idle first (#333) |
| the console's fold line | `N animation(s) beside the idle read by rigc render --folds …` | `N animation(s) read by rigc render --folds …`, the idle counted and named |
| the summary of a rig with an idle and no other animation | `… of 9 bar(s) measured …` | `… of 10 bar(s) measured …` |
| `may_fold` naming `"animation": "idle"` | refused, `REQUIREMENTS_MAY_FOLD` (the bar did not read the idle) | accepted like any animation name; a fold it names is listed with its why and not held, and one that does not fold fails the bar |

The reading is the one #320 made for the other animations — one `rigc render --folds` at
12 fps over the build with its physics constraints left out — and now takes the idle in
the same run. A rig whose idle turns a mesh triangle over against the setup pose, which
`check` passed before, fails it, naming the idle and quoting rigc's line. On the four
public examples and the trailer no idle folds [measured for #333, rig-c 2.47.1], so no
verdict moved; every example's `expected/check.json` moved by the key and nothing else.
`reference-demo`, an idle alone, gains the whole key after `TEXTURE_STRETCH`:

```diff
@@ -259,6 +259,18 @@
     "severity": 1.074
    }
   ]
+ },
+ "ANIMATIONS_DO_NOT_FOLD": {
+  "status": "PASS",
+  "animations": [
+   "idle"
+  ],
+  "fps": 12,
+  "physics_left_out": 0,
+  "folding": [],
+  "folding_undeclared": 0,
+  "declared_not_folding": [],
+  "bar": 0
  },
  "RECOMPOSITE_HOLES": {
```

and `demo`, `scarf` and `reference-sample` gain `"idle"` as the first entry of its
`animations`.

What to do: nothing for a rig whose idle does not fold. A consumer that reads
`check.json` finds the key on every rig with an animation. An idle that folds on purpose
is declared, `"may_fold": [{ "slot": …, "animation": "idle", "why": … }]`, in the
`--requirements` file.

## After 1.14.0: faint islands under `contour.bridges`

`contour.bridges` shipped in 1.14.0 meshing every island past `stray` and bridging it.
The patch after it reads islands in a fixed order (issue #326, HQ's ruling): dust first
(`stray`), then **faint** islands — every pixel's alpha under 64 — left out and named,
then every visible island bridged whatever its bridge costs. No field was added and
no declared form changed.

| change | what moved | measured |
| --- | --- | --- |
| #326, faint islands left out | only a part that declares `contour.bridges` and holds a faint island (not the largest): its mesh, its `mesh_report.json` row (`contour.bridges.faint`, and `art_coverage`, which counts those pixels as art not covered) and, from `mesh-draft`, its written entry's note and `mesh_draft.json`'s `candidate.bridges.faint`. A part without a faint island writes the bytes 1.14.0 wrote | demo `earring` (the only such part a `mesh-draft` of the public examples drafts): its 8, 2 and 1 px specks, brightest alpha 17, 17 and 11, are left out — 33 → 26 triangles, overdraw 4.82 → 1.94; the idle rendered at scale 1.01 differs from the build of #335 (the change 1.14.0 carries) by at most 9 of 255 levels on at most 38 px where the specks were (4 frames; elsewhere 158 px differ by 1 level, as they do with the earring slot hidden), and `check`'s seam bar reads 0 px over 40 on both |

What to do: nothing for a config without `contour.bridges`. A part that declares it and
holds a faint island no longer draws that island; if those pixels matter, keep the
lattice for that part.

## After 1.17.0: an artist's own file

Issue #359 makes an artist's layered PSD an input in its own right (AUTHORING §4,
*For artists* and *The correction loop*). Nothing a config already builds changes:
every new form was refused or a usage error before, so no byte any existing build
writes moves (the selftest's existing controls and the examples' `expected/` are
unchanged by it).

| change | before | after |
| --- | --- | --- |
| `assemble`, `--propose-plan` and `build` without `--head` | a usage error (exit 2) | one run: the full run must hold `face`, `eyewhite-r` and `eyewhite-l`, painted (`ASSEMBLE_SINGLE_RUN_FACE`); every row takes `"full"` (`ASSEMBLE_SINGLE_RUN_PLAN`); no `seethrough.head_box` (`ASSEMBLE_SINGLE_RUN_HEAD_BOX`) |
| `propose --full`/`--head` over runs with no depth on any part's layer (a PSD) | refused, `PROPOSE_TURN_DEPTH_PRESENT` on every part (exit 1) | no `turn`, one note `turn: SKIP — <runs> carry no depth_median …`, the proposal written (exit 0); a run where some parts' layers carry a depth and others do not is still refused part by part, and the detail now says so |
| a wrapper `layers.json` with `depth_median: null` | refused, `LAYERS_FIELD_PRESENT` | `null` on every drawn layer reads in the manifest's order; a mix is `LAYERS_DEPTH_ALL_OR_NONE` |
| a layer named `<layer>:hidden` | refused, `LAYERS_TAG_KNOWN` | a hidden-art layer, listed apart and never drawn; read as a cut's `under` and a limb segment's cap where the config names no file (`ASSEMBLE_HIDDEN_ONE_SOURCE` when it names one too) |
| `layers` on a PSD, or on a manifest with no depth | the table | the table and one `SKIP  depth:` line naming the file |
| `parts.json`, a limb segment's `cap` | `image_px` with a cap file | `image_layer` after `image_px` when the image was a hidden-art layer |

What to do: nothing. A consumer that matched `PROPOSE_TURN_DEPTH_PRESENT` to detect a
PSD run reads the `turn: SKIP` note instead.

Issue #366 lets that one run be a file that is not square (AUTHORING §4, *For
artists*: the canvas). Two-run builds and a square file at `seethrough.resolution`
are read exactly as before — no `single_run_pad` block, no `padded:` line, the same
bytes (the selftest's existing single-run controls and the examples' `expected/` are
unchanged by it).

| change | before | after |
| --- | --- | --- |
| one run whose file is not the `resolution` square, no side above it | refused, `ASSEMBLE_RUN_CANVAS` | padded to the square, centred (the odd pixel right or bottom), and assembled in the file's pixels; `parts.json` ends with `single_run_pad` (`file_size`, `side`, `left`, `top`) and `assemble` prints a `padded:` line under `one run:` |
| one run whose file has a side above `resolution` | refused, `ASSEMBLE_RUN_CANVAS` | still refused by that code; the detail now says padding cannot shrink a file and names the resolution that would hold it |
| one run with a painting of another size than the file | read: the run mapped onto the painting at the painting's scale | refused, `ASSEMBLE_SINGLE_RUN_SOURCE` — §4 already required the same size |
| a `parts.json` with `single_run_pad` | refused, `PARTS_KEY_KNOWN` | read; a block that is not the centring, or disagrees with `rig_size`, is `PARTS_SINGLE_RUN_PAD` |

What to do: nothing, unless a single-run painting was not the file's own size — pass
the file flattened.

### And a check before See-through (`painting`, issue #350)

A new command, `rig-parts painting --keypoints <k.json> [--person <id>]
<painting.png>`, reads a painting against its body-18 joints before See-through runs
and refuses what a rig cannot be cut from (arms against the body, hands together,
legs without a gap, a joint off the figure, a background that is not plain;
[PAINTING.md](PAINTING.md)). It reads the keypoint file `propose --keypoints` reads
and writes nothing; no other command changed, and no byte any build writes moves.

| change | before | after |
| --- | --- | --- |
| `rig-parts painting` | a usage error, `unknown command` (exit 2) | the check: exit 0 PASS, 1 with a `FAIL  PAINTING_…` line per refusal |
| the README's input bullet for the painting | one sentence | the requirements, linked to `docs/PAINTING.md`, which ships in the package |

What to do: nothing. Run `painting` on a new painting before See-through.

### And `painting` reads an occluded hip (issue #372)

A skirt hides the hips on most clothed figures, and the keypoint file says so with
`occluded`. `painting` refused that state, which taught a writer to call an
estimated hip `observed`. It now reads an occluded hip when the arm's gap from it is
well defined: the hip carries a position (inside the image, as the keypoint reader
holds every position) and that position's pixel is figure (PAINTING.md, *An occluded
hip*). No other command changed, and no byte any build writes moves.

| change | before | after |
| --- | --- | --- |
| a hip `occluded` with a position, on the figure | `PAINTING_JOINTS_STATED` (exit 1) | read: its arm's gap is measured from it, and the run passes or fails on the gaps |
| a hip `occluded` with a position, on the background | `PAINTING_JOINTS_STATED` | `PAINTING_JOINT_ON_FIGURE`, as an observed joint there is |
| a hip `occluded` with no position, or `missing` | `PAINTING_JOINTS_STATED` | the same rule; the detail now says a hip may be occluded with a position |
| a wrist, knee or ankle `occluded` | `PAINTING_JOINTS_STATED` | unchanged; the detail adds that only a hip may be occluded |
| the `joints:` line | `joints: <n> observed, <m> on the figure` | the same when no hip is occluded; otherwise `joints: <n> observed, <k> occluded with a position (<hips>), <m> on the figure` |
| a gap line read from an occluded hip | — | ends ` (<hip> occluded, read at its position)` |

What to do: write a hip a skirt hides as `occluded` with its estimate. A file that
wrote it `observed` reads the same gaps as before.

### And cloth and hair that answer the world (`propose --cloth`, issue #364)

A config may hold a `cloth` block — one recipe per tag, `bottomwear`, `back hair` and
`front hair` (AUTHORING §3, *Recipe: cloth and hair that answer the world*) — and
`propose --cloth <config.json>` drafts that tag's pieces as trees of physics links
in place of the keyed chains. Without `--cloth` nothing the proposer writes moves;
`rig` and `build` do not read `cloth` at all, so no byte any build writes moves
either (the examples' `expected/` and every existing control are unchanged).

| change | before | after |
| --- | --- | --- |
| `cloth` in a config | refused, `CONFIG_KEY_KNOWN` | vouched by every loader (`CONFIG_FIELD_*`, and the `CONFIG_CLOTH_*` rules of AUTHORING §6), read by `propose --cloth` only |
| `propose --cloth <config.json>` | a usage error, flag not taken (exit 2) | the recipe's trees, their `constraints` in proposal.json, one note per piece; a recipe that drafts nothing, `PROPOSE_CLOTH_DRAFTED` (exit 1) |
| `proposal.json` | no `constraints` | `constraints` after `motion`, with `--cloth` only |

What to do: nothing. To draft a skirt or hair that the consumer's wind and gravity move,
add a `cloth` block and propose with `--cloth`; copy each of `bones`, `meshes`, `regions`,
`limbs`, `motion`, `constraints`, `turn`, `motion_seams` and `proposed_rig_scale` the proposal wrote into the config, as before
(`constraints` is the one `--cloth` adds).

## After 1.20.0: the seam over a joint's range

Issue #360 (item 13) reads the seam with each limb joint bent, not only at rest. A
segment's `range` in `config.limbs` was metadata no stage read; it is now carried into
the lower part's `parts.json` record, and `check` poses the joint at the range's two
ends and its middle (AUTHORING §7, `SEAM_OVER_RANGE`). Nothing a config without a
`range` builds changes: no field is written, nothing more is rendered, and no byte any
existing build writes moves (no public example declares `limbs`; the chain suite holds
their `parts.json` and `check.json` to `expected/`).

| change | before | after |
| --- | --- | --- |
| `parts.json`, a limb segment below a joint whose config segment declares `range` | no `range` | `range` (`[min, max]`, as declared) after `joint` |
| a `parts.json` with a limb `range` | refused, `PARTS_KEY_KNOWN` | read; on the upper segment `PARTS_FIELD_PRESENT`, not two numbers with `min <= 0 <= max` `PARTS_FIELD_TYPE` |
| `check` on a rig whose `parts.json` holds a limb `range` | the range not read | `SEAM_OVER_RANGE` in `check.json` after `LIMB_ONE_BONE`, its console lines after the limb lines, one more bar counted in the summary, `CHECK_SEAM_OVER_RANGE` on a pose over the rest-pose seam's bar; `compose --accept` takes it |

What to do: nothing. To have a joint read, declare its `range`; a joint that opens when
bent wants a cap that covers the turn.

## After 1.37.0: the seam in motion

Issue #493 reads every declared neighbour pair — each limb's two segments at a joint
(`config.limbs`), and each `--requirements` `seam`'s two parts — in every animation
`motion.json` holds, the idle included, by rig-c's seam reading (`rigc render --seam`,
rig-c 2.60.0, then the dependency's floor). It is a warning, never a bar: a seam that
opens in motion may be intended, so no exit status, no `check: PASS` and no bar count
moves (AUTHORING §6, `SEAM_OVER_MOTION`).

| change | before | after |
| --- | --- | --- |
| the `rig-c` dependency | `^2.59.0` | `^2.60.0`, the first with `render --seam` |
| `check` on a rig whose `parts.json` holds a limb segment, or under a `--requirements` with a `seam` | not read | `SEAM_OVER_MOTION` in `check.json` after `SEAM_OVER_RANGE`, its console lines after the range lines, one `WARN seam` line per pair and animation over the one-cell floor, and `; N warning(s) (SEAM_OVER_MOTION, not a bar)` at the end of the summary |
| `check` on any other rig | — | one console line, `SEAM_OVER_MOTION: SKIP — …`, naming why; no key in `check.json`, nothing more rendered |

What to do: nothing. A warning names the pair, the animation, the frames and the cells;
an opening that is not intended wants a cap that covers the turn, or a motion that bends
less.

## After 1.37.0: merged arm layers are split (issue #490)

Issue #490 splits a full-run `handwear-<s>` layer that See-through merged — the sleeve,
the bare hand at `<s>_wrist`, and an overgarment drape reaching more than a forearm's
length below the wrist, the drape's colour at least 80 off the sleeve's — into
`drape-<s>`, `handwear-<s>` and `hand-<s>`, whenever the config carries
`generation.control.skeleton` (the wrist and the forearm are read off it). `assemble`
rewrites a plan's lone `full` `handwear-<s>` row into three: `drape_<s>` behind, the
row's own part (the sleeve, which keeps `handwear-<s>`), and `hand_<s>` in front.

Who is affected: a config proposed before 1.37.0 whose plan takes `handwear-<s>` from
the full run and that carries `generation.control.skeleton` — and only where that layer
is a merged arm run; a config whose arm layer holds the sleeve alone builds as before.
Its `meshes` and `regions` never named the two new parts, so `rig` refuses each by name
(issue #671):

```
RIG_PART_ATTACHED: part "drape_r" — is in parts.json and has neither a config.meshes nor a config.regions entry; exactly one is required — the full run's merged arm layer was split into this part (issue #490, from 1.37.0), …
```

| change | before | after |
| --- | --- | --- |
| `assemble.plan` as `assemble` reads it, a lone `["<name>", "full", "handwear-<s>"]` row over a merged arm run | the row | `["drape_<s>", "full", "drape-<s>"]`, the row, `["hand_<s>", "full", "hand-<s>"]` |
| `parts.json` | one part holding sleeve, hand and drape | `drape_<s>` (`full:drape-<s>`), the sleeve part (`full:handwear-<s>`), `hand_<s>` (`full:hand-<s>`) |
| `rig` on a config without entries for them | — | `RIG_PART_ATTACHED` for each, the detail naming this entry and `--only-missing` |
| `propose … --write-config <config> --only-missing` | — | new (issue #671): adds only the plan rows and entries the config lacks for them |

What to do, keeping every entry you tuned — one command, after `assemble` has written
the split parts:

```
rig-parts propose --parts <work/rig> --source <painting> --out <dir> --write-config config.json --only-missing
```

For each part the config attaches by neither `meshes` nor `regions`, it adds what is
missing and nothing else (issue #671):

- a part from `full:drape-<s>` or `full:hand-<s>` that `assemble.plan` does not name gains
  its plan row where `assemble` rewrites it: `["drape_<s>", "full", "drape-<s>"]` just
  before the row that takes `handwear-<s>` from the full run, `["hand_<s>", "full",
  "hand-<s>"]` just after it. `assemble` then takes the plan as written and makes the
  same `parts.json` byte for byte. The config loader reads `meshes` and `regions` against
  the parts the plan makes, so the entries need the rows;
- the part gains `meshes.<part>` or `regions.<part>` as the proposal drafts it.

Every existing plan row, every existing entry, every other section and every other byte
stays as read, each addition is spliced in alone, and stderr names each row and entry
added. The full loader reads the result before it replaces the file: an entry on a bone
your config does not declare is refused naming the part and the bone, and nothing is
written. A second run with nothing missing changes no byte.

Or by hand, the same four additions: the two plan rows above, and a region for each part.
`propose` drafts both as regions: `hand_<s>` on the tip link of `sleeve_<s>` where it
drafts a sleeve chain (a handwear part over 500 px, or the arm drafted from
`--keypoints`; its note reads `hand_<s> (full:hand-<s>): split hand -> region on
sleeve_<s>2, the tip link of sleeve_<s>` for a three-link chain); otherwise `hand_<s>`,
like `drape_<s>` always, rides the trunk bone by its box's centre height — `head` above
the neck line, `chest` above the hip, else `hip` (its note reads `drape_<s>
(full:drape-<s>): no rule -> region on hip`). Confirm against the notes `propose` prints
for your parts; the bone must be one your config declares.

**An alternate set made before 1.37.0** that covers the split sleeve (a set over the part
that takes `handwear-<s>`) still covers only that part. The split made `hand_<s>` and
`drape_<s>` parts of their own, so while the set is active the base draws them beside the
set's own sleeve art, which still holds the hand it was painted with. `check --set` then
fails the set's seam (`CHECK_SEAM_WITHIN_BAR`, issue #671); its detail names the parts and
this entry. What to do: add them to the set's `hides`, for example `"hides": ["hand_r",
"drape_r"]`, or only `hand_<s>` if the set's painting still shows the base drape. This is
a judgement on the set's own art, so `--only-missing` does not write it.

## After 1.38.0: cloth that comes to rest on the idle

Issue #501 reads every physics chain by its tip on the idle `check` renders (physics on,
rigc's default environment): a chain settles at the first frame from which its tip moves
slower than 0.01694 rig px/s to the idle's last frame, and the line warns when one
settles before the loop's length is out. It is a warning, never a bar: cloth at rest
while the character stands may be intended, so no exit status, no `check: PASS` and no
bar count moves (AUTHORING §6, `CLOTH_SETTLES`).

| change | before | after |
| --- | --- | --- |
| `check` on a rig with a physics constraint and an idle | not read | `CLOTH_SETTLES` in `check.json` after `SEAM_OVER_MOTION` (where that is written; else where it would be), its console lines after the `SEAM_OVER_MOTION` lines, one `WARN chain` line per chain that settles, and the summary's warning clause names it: `; N warning(s) (CLOTH_SETTLES, not a bar)`, or `(SEAM_OVER_MOTION, CLOTH_SETTLES, not a bar)` with N their sum where both read |
| `check` on any other rig | — | one console line, `CLOTH_SETTLES: SKIP — …`, naming why; no key in `check.json` |
| the public examples' `expected/check.json` | — | `demo`, `reference-sample`, `scarf` and `wind` gain the block: `wind`'s skirt (eight trees and the swing) and `reference-sample`'s `hip_jiggle` settle, every chain an idle key drives does not |

What to do: nothing. A warning names the chain and the second it comes to rest; a chain
that should keep moving wants an environment at render (`rigc render --environment`;
AUTHORING §3, *What moves them*, has a worked schedule for `wind`) or a consumer's
animation that moves the bone it hangs from. The drafted idle keys no hip: issue #502
measured a hip sway at the idle's period on every public example, and each failed a bar.

## Opt-in hybrid joint bands (issue #399)

A lower limb segment may declare `hybrid: {part, width?}` to replace its cap
with one generated two-bone band. Its neighbours remain rigid regions. The
full axial width is source-derived unless explicitly supplied; no generated
band attachment entry is added to the config. See AUTHORING's *Hybrid joint
bands* for the source, name, width and overlap refusals. Existing configs need
no change. The parts reader gains `limb.hybrid` and `limb.band` records only
for this mode, and the recorded lower range is measured once. The normal
one-bone rule and existing range thresholds remain unchanged.

## Explicit motion seam declarations and posed WARN evidence (issue #750)

New proposals can include optional `motion_seams: [{part, neighbour}]` alongside
the other proposed config sections. Carry it through assemble into parts.json.
Each pair names two existing output parts, once regardless of direction; the
strict readers name malformed, self, duplicate and unresolved declarations.
Check observes declared pairs in every supplied animation with the existing
non-root WARN floor; bars and exit status are unchanged. Existing body-root
FAIL semantics remain in force for independently selected root pairs.

Older authored configs acquire no declaration automatically. Keep the originals
and use exported `draftMotionSeams(config, parts)` on the frozen authored
structure and source-provenance parts, preserving every other config value in
a derived input and recording the added declaration. Check does not run that
generator; removing a declaration silences its independently declared pair.

Existing played limb WARNs as well as newly declared WARNs gain same-render
worst-frame pose evidence. Read relative angles as setup-axis deltas modulo
360, alongside unchanged static ranges; unsupported comparisons carry an
unavailable reason. The geometry setup, actual raw frame/time and parent
matrices replace no source motion keys and introduce no angle threshold.

The WARN pose reader also requires the published stock coordinate header and
the required source bone/parent roster. It binds the complete geometry frame
cohort to the actual PNG frame set through `readFrameSet` and `boneTrackOf`,
including unselected frames, before reading the worst pose. Identical static
ranges on a bone deduplicate; conflicting ranges are explicitly ambiguous,
never described as no declared range.
