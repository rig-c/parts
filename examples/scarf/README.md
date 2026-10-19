# scarf

A generated full-body character — prompted as an adult woman with shoulder-length
straight black hair, a very long red knitted scarf wrapped once around the neck
whose two ends hang free down the front of the body, a beige knit sweater, a dark
green pleated skirt, black tights and brown loafers — made for this repository with
a public checkpoint (Pony Diffusion V6 XL) and no LoRA; `config.json`'s `generation`
block is the whole record, and its `seed_note` says how seed 72004 was chosen from
72001–72006. Its heavy inputs (the painting, the two images See-through was fed, and
the `full` and `head` See-through layer sets) live in the
[parts-examples](https://github.com/rig-c/parts-examples) repository,
which also holds the licence; `bun run fetch-examples` copies them into `inputs/`
here (gitignored).

## Why it exists

- **A hanging element the two reference examples lack.** The scarf is painted inside the
  `topwear` layer; the proposer's two `robe` chains (`robe_r`, `robe_l`, four links
  each) run down that part's two sides, where the scarf ends hang to the thighs, and
  the idle swings them.
- **The first character run through the pipeline with the proposal unedited.** The
  config's `bones`, `meshes` and `motion` are `proposal.json`'s, value for value, but
  for the `robe_r` chain's points (below) and the two authored
  additions of issue #224 (`motion.animations_from` and `constraints`, *Gestures,
  expressions and trailing strands* below) and every mesh's `grid` — the config keeps
  the part rule's (`propose --grid-rule part`), and `proposal.json` has carried the
  figure's spacing, grid 30, since issue #265; built with it, every `check` bar passes
  and the figure's triangles fall from 2,654 to 664; adopting it here is a change of
  its own — and its `regions` are the proposal's for every part but the two shoe patches. Every other
  hand correction is an `assemble.patches` entry (below), with its reason in
  `assemble.patches_note`.
- **Once the one mixed-mode example (issues #118 to #262).** From #118 `meshes.bottomwear`
  was tracked in contour mode (`contour {tolerance 1, margin 1, spacing 12, stray 4}`)
  because the proposal's lattice failed `TIP_OVER_ROOT` on this short skirt (195x116 rig
  px): its upper half travelled 0.113 rig px against the lower half's 0.137 (ratio
  1.207, bar 1.4725), the contour mesh 0.083 against 0.145 (1.738). The reason given then
  — "what fails is the lattice's weighting of this part, not the motion" — was half right:
  what failed was the `chest` segment the proposer gave the skirt, which carried the
  waistband with the breath, and the contour mesh had fewer vertices on that row. Issue
  #262 took the segment off, and the proposal's lattice reads 3.487 (0.040 against
  0.139 at the proposal's breath), above the contour mesh's 2.614 on the same idle; the
  config is the proposal's again in `bottomwear`, and the *Both mesh modes* table below
  is the record of #118's builds.
- **Two rules came from it.** Issue #119's fringe push-back: the `topwear` layer ends
  inside the left sleeve in a fringe below alpha 250 coloured scarf red, which drew as
  a red line down the sleeve; `assemble` now prints, on this config,
  `fringe pushed back: "topwear" 1006 px, where the painting shows "handwear_l" 726 px,
  "bottomwear" 257 px, "hair_side_r" 10 px, "hair_side_l" 7 px, "hair_back" 6 px`.
  And the shoe patches: the tights fade out above the shoe collars, leaving holes no
  run holds.

## What is tracked

- `config.json` — the config the build reads.
- `animations.json` — the named animations beside the idle (issue #224), in rig-c's
  motion-spec shape, which `motion.animations_from` names; *Gestures, expressions and
  trailing strands* below.
- `proposal.json` — what `rig-parts propose --parts <build> --source painting.png`
  writes on the parts of the build in `expected/` (selftest `CH06`, `CH901`). #119
  moved the first two points of the `robe_l` chain by 1 and 2 px from what the
  proposer wrote on the parts assembled before it (`[503, 410]`, `[513, 541]` →
  `[502, 410]`, `[511, 541]`); the config followed the proposal in those two values.
  The config leaves the proposal in one chain (issue #196): the proposer's `robe_r`
  (`[318, 410]`, `[306, 541]`, `[303, 672]`, `[304, 803]`, tip `[295, 886]`) put its
  first two joints on the sleeve, 18 px right of the tie's painted pixels in those rows,
  and its tip 20 px below the fringe, on no art; the config's points are on the tie
  (`[298, 410]`, `[284, 541]`, `[280, 672]`, `[304, 803]`, tip `[295, 860]`), the link
  count and the idle track the proposal's, and the entry's `note` says why. `robe_l` is
  the proposal's: no tie pixel is painted on its side above row 600, where the sleeve
  covers the tie (`docs/evidence/scarf-chain-moved.png` shows `robe_r` before and after).
- `sheets/` — `rig-parts sheet` contact sheets, written by this port as PNG (reference-demo's
  and reference-sample's are the reference implementation's JPEGs): the painting with the full
  run's layers, the painting with the head run's layers, and the painting with the
  24 assembled parts of the `expected/` build.
- `expected/rig.json` is the flat form: every bone unturned, which is `flattenRig`
  (`src/rig.ts`) of the built rig. A build's `rig/rig.json` turns each chain link along
  its chain, so it carries `rotation` and `length` on the links, and the offsets under
  them in the turned frame, where this file holds unturned offsets only: a plain diff of
  the two shows those bones and the weights bound to them as changed, and the build is
  not broken. The chain suite (`CH03`) compares this file with `flattenRig(built)`, not
  with the built file; compare the same way.
- `expected/` — **this port's own build**, rebuilt by issue #118 (which moved
  `bottomwear` to contour mode and `TIP_OVER_ROOT` to the geometry; `parts.json` did
  not move) and by issue #196 (which moved `robe_r` onto the tie: `rig.json`,
  `mesh_report.json` and `check.json` moved, `parts.json`, `motion.json` and the gate
  file did not):
  `rig-parts build --config examples/scarf/config.json --source
  inputs/painting.png --full inputs/layers/full --head inputs/layers/head --out
  <dir>`, the call the selftest's chain suite makes. The reference implementation
  never saw this character, so there is no reference output to compare with: the
  chain suite holds the tree to its own earlier output — a determinism check, not a
  port check. `parts.json` (`assemble`), `motion.json` and `mesh_report.json`
  (`rig`), and `check.json` and `gate_spine-html.txt` (`check`) are the build's files
  as written; `rig.json` is the build's `rig/rig.json` carried to its flat form by
  `flattenRig` (`src/rig.ts`), the form the reference wrote and reference-demo's and reference-sample's
  `expected/rig.json` are in, so the chain suite (`CH03`) and the structure suite
  (`ST25`) read the examples the same way. Issue #126 turned every mesh triangle counter-clockwise in Spine world, the winding rig-c reads a mesh in (the reference, and this port before it, wrote them clockwise there). The declared exception, and nothing else: every mesh `triangles` triple `[a, b, c]` is `[a, c, b]` in `rig.json`; the `check.json` `TEXTURE_STRETCH` entries that print a triangle's vertices and edge print them in that order (16 here, 52 over the three examples; the triangle, frame and figures are unchanged); and the untracked `skeleton.model.json`'s `spine.sha256`, which follows the skeleton bytes. Every rendered frame of the build is pixel-equal before and after. Issue #209 carried the seam's composite onto the render's pixel centres — the setup-pose still renders at frame scale 1.0107 here, not 1 — which moved `check.json`'s `seam_mean` from 0.211 to 0.206, with every other figure as before. Issue #216 judges the seam's pixel count in rig pixels — the frame count divided by s², so the bar reads one rig the same at every frame scale — and writes the scale it divides by as `check.json`'s `seam_frame_scale` (1.010705 here) after the three seam figures; that key is the only byte that moved, and the verdict is as before (2 frame px over 40, 1.96 rig px, against 50). The seam row of the table below is the three builds before it. Issue #224 moved
  `rig.json` (the 30 physics constraints), `motion.json` (the seven animations after
  `idle`), `gate_spine-html.txt` (`animations=8`, `physicsConstraints=30`, and one more
  rule measured, 25 of 50 on the packed build) and `check.json` (`loop_physics` names the
  constraints the loop bar leaves out; the idle's figures move by the physics the idle
  itself drives and by the render's viewport, now fitted over the hop:
  `BREATH_VISIBLE` `torso_heat_mean` 16.038 to 15.509, `TIP_OVER_ROOT` `handwear_r`,
  `handwear_l`, `bottomwear` 6.683 / 5.345 / 1.738 to 6.672 / 5.334 / 1.763,
  `TEXTURE_STRETCH` 1.098 to 1.097, every status as before; the table under *Both mesh
  modes* is the builds of issue #118, before it); `parts.json` and `mesh_report.json`
  did not move.
  Issue #252 moved the config's `motion` with the proposal's (the idle 40 frames at 12
  fps, `duration` 40/12 s, every period scaled with it; the breath authored at 1.55,
  0.449 % of the robe, until issue #262 below),
  which moved `motion.json` (the idle's keys) and `check.json` (41 idle frames, not 49;
  `torso_heat_mean` 15.509 to 16.263, `TIP_OVER_ROOT` `handwear_r` / `handwear_l` /
  `bottomwear` 6.672 / 5.334 / 1.763 to 6.152 / 5.022 / 1.534, `TEXTURE_STRETCH` 1.097
  to 1.098; every status as before); `parts.json`, `rig.json`, `mesh_report.json` and
  the gate file did not move.
  Issue #262 took the `chest` segment off `bottomwear`: the proposer drafted the skirt
  `['chest', [414, 411], [414, 637]]`, ending 5 px above its art, and the waistband's
  vertices took up to 0.076 of `chest`, so the proposal's breath (2.5 % of the 690 px
  robe, amplitude 8.62) moved the skirt's upper half 0.492 rig px against its hem's
  0.148 (`TIP_OVER_ROOT` 0.300). A skirt whose art starts below the chest bone now hangs
  from the hip line and its chains, and the config follows the proposal there and in the
  breath, whose authored 1.55 and `note` are gone. Measured at the proposal's breath, the
  segment alone moves `bottomwear` from 0.300 to 2.614 (upper half 0.056) and its
  `TEXTURE_STRETCH` from 1.208 to 1.036, and nothing else. With the segment gone the contour correction had no reason left (above), so
  `bottomwear` went back to the proposal's lattice, grid 12. Against the build before it,
  that moved `proposal.json` (the segment, and a note naming the rule), `rig.json`
  (`bottomwear`'s mesh, its weights, and its slot's bone `chest` to `hip`, the first
  segment's), `mesh_report.json` (`bottomwear`'s row, the lattice's), `motion.json` (the
  breath's keys), the gate file's pack line (392x1270, 96.0 % covered, to 393x1273, 95.5 %)
  and `check.json`: `torso_heat_mean` 16.263 to 30.836, `TIP_OVER_ROOT` `handwear_r` /
  `handwear_l` / `bottomwear` 6.152 / 5.022 / 1.534 to 2.006 / 1.925 / 3.487,
  `TEXTURE_STRETCH` 1.098 (`hair_front`) to 1.337 (`topwear`, which the breath now
  stretches in full; `bottomwear` 1.037 to 1.018), 2633 triangles to 2654, the face half of
  `STILL_REGIONS_DARK` rms 1.22e-13 to 1.311e-13 and its reported crossing depth 2.474 to
  2.524; every status as before. `parts.json` did not move.
  Issue #270 took the breath's size off the torso the rig has rather than the garment:
  2.5 % of neck [412, 226] -> hip [414, 657], 431.0 px, is 10.78 px peak to peak
  (amplitude 5.39, was 8.62 off the 690 px robe), and the config follows the proposal.
  That moved `proposal.json` (the amplitude and the `breath:` note), `motion.json` (the
  breath's keys) and `check.json`: `torso_heat_mean` 30.836 to 25.208, `TIP_OVER_ROOT`
  `handwear_r` / `handwear_l` 2.006 / 1.925 to 2.634 / 2.456 (`bottomwear` 3.487, as
  before: the skirt no longer rides the chest), `TEXTURE_STRETCH` 1.337 to 1.211, on
  `topwear` both, the face half of `STILL_REGIONS_DARK` rms 1.311e-13 to 1.305e-13 and
  its reported crossing depth 2.524 to 2.498; every status as before. `rig.json`,
  `mesh_report.json`, `parts.json` and the gate file did not move.
  Issue #305 moved rig-c from 2.40.0 to 2.47.1. Every build file is byte-identical
  across 2.40.0, 2.45.1, 2.45.2, 2.46.0, 2.47.0 and 2.47.1 (`parts.json`, `rig/`, the packed
  skeleton and the gate file); 2.45.2, whose render no longer ends a frame on a physics
  step's tie (core#1380), moved the idle frames `check` reads and so `check.json`:
  `torso_heat_mean` 25.208 to 24.777, `TIP_OVER_ROOT` `handwear_r` 2.634 to 2.632 (tip
  6.451 to 6.447) and `bottomwear` 3.487 to 3.437 (root 0.04 to 0.041), `TEXTURE_STRETCH`
  `topwear`'s smallest ratio 0.958 to 0.961 (the same triangle, frame 32, was 31) and
  `hair_front`'s largest 1.097 to 1.096; every status as before.
  Issue #320 reads the animations beside the idle for folds (`ANIMATIONS_DO_NOT_FOLD`,
  rigc's `render --folds` with the 30 physics constraints left out): the seven clips fold
  no mesh. That added the key to `check.json` after `TEXTURE_STRETCH`, and nothing else in
  it or any other file moved. Issue #333 reads the idle in the same run: it folds no mesh
  either, and `check.json`'s `animations` gains `"idle"` first — nothing else moved. With the physics in, at 12 fps, `hop` folds `bottomwear` (3
  of 308 triangles, frames 7–8) — and at none of 10, 15, 24, 30, 36, 48 or 60 fps: the
  physics step's, which is why the bar reads the keys.
  Issue #347 dropped the 16 px `chest` segment at the shoulder from `handwear_r` and
  `handwear_l`, in `proposal.json` (the two-blob rule no longer drafts it, and its note
  reads `…, and nothing on chest`) and in the config with it: with the stub, each sleeve's
  first link turned 90°, −90° and 180° stretched its worst edge 4.25 to 1,498 times, and
  without it the sleeve turns rigidly (1.0000). That moved `rig.json` (the two meshes'
  weights, no vertex on `chest`), `mesh_report.json` (those two rows: bones `chest` gone,
  `max_influences` 4 to 3, `mean_influences` 2.22 to 1.98 and 2.18 to 1.94) and
  `check.json`: the new `STRESS_OFF_CHAIN` key after `ANIMATIONS_DO_NOT_FOLD`, PASS on both
  sleeves, `TIP_OVER_ROOT` `handwear_r` root 2.449 to 2.45 and `handwear_l` 2.456 to 2.46
  (root 2.459 to 2.456), and `TEXTURE_STRETCH` `handwear_r` 1.021 to 1.029 (now triangle
  119, frames 5 and 25); the seam (mean 0.206, 2 px over 40), the pack and every status as
  before. `parts.json` and `gate_spine-html.txt` did not move.

## The four patches

Each patch answers an `uncovered hole N:` line of `assemble` (re-measured on this
tree with the patches left out of a scratch copy of the config; the boxes are the
ones `patches_note` records):

| patch | box (rig px) | draw | region | the line that asked for it |
| --- | --- | --- | --- | --- |
| `hair_side_r` | 349,81 – 416,214 | `back` | `head` | `uncovered hole 1: 976 px at 351,83 63x129 (between "hair_back" 172 px, "topwear" 22 px, "hair_front" 20 px)` |
| `hair_side_l` | 456,126 – 484,216 | `back` | `head` | `uncovered hole 2: 244 px at 458,128 24x86 (between "hair_back" 101 px, "topwear" 12 px)` |
| `shoe_gap_r` | 370,1090 – 410,1131 | before `shoes` | `root` | with the hair patches in: `uncovered hole 5: 62 px at 372,1095 8x34` and `uncovered hole 2: 111 px at 397,1092 11x37` (both between `shoes` and `legwear`) |
| `shoe_gap_l` | 416,1089 – 458,1150 | before `shoes` | `root` | with the hair patches in: `uncovered hole 1: 125 px at 418,1095 18x45` and `uncovered hole 3: 82 px at 447,1091 9x57` (both between `shoes` and `legwear`) |

All four take `"alpha": "silhouette"`; each box is its hole (or the union of its two
holes) grown by 2 px. The side hair is in neither run (the head run's back hair stops
inside it, the full run's is haze); the proposer, run on the patched parts, proposes
`hip` for the two shoe patches, and the config keeps them on `root`, the shoes' own
bone. With all four, the recomposite's uncovered error is 1,365 px in 291 holes, the
largest 63 px at 347,803 3x60 beside `topwear` (`check.json`, `RECOMPOSITE_HOLES`;
2,921 px with no patch, 1,752 px with the hair patches alone).

## Gestures, expressions and trailing strands

Issue #224 gave the character the same set of named animations as `demo` (its README
has the rule they follow: one-shots that key only bones the idle leaves alone, ease-in-out
Bézier keys, no constraint, draw-order, deform or attachment key) and physics on its
strands, with the values this figure takes:

| clip | s | keys |
| --- | --- | --- |
| `tilt` | 1.6 | `head` rotate to 6°, held, overshoot, settle |
| `look_l`, `look_r` | 1.8 | `head` only: translatex ±10 with an overshoot, rotate ∓4°, scalex 0.95 |
| `smile` | 1.4 | `mouth` scale 1.3 × 0.7 and up 3; `eye_r`, `eye_l` scaley 0.72; `brow_r`, `brow_l` up 4; `head` 3° |
| `startled` | 1.4 | anticipation at 0.12 s, the start at 0.24 s (brows up 12, eyes 1.25, `mouth` 0.75 × 1.8, `chest` up 8), a held beat, a settle; `head` is not keyed (below) |
| `bow` | 1.8 | `chest` down 18 and scaley 0.94, `head` down 18 and scaley 0.86, held, back |
| `hop` | 1.2 | as `demo`'s: `hip` down 14, `root` up 90 at 0.42 s, `hip` down 18.2 on landing, a rebound; `chest` squash and stretch |

The head moves less than `demo`'s, and `startled` does not lift it, because the face's
lower edge is not covered: there is no neck part (*Known limits*), and the `hair_back`
layer, which See-through painted grey, shows in the gap under the chin as soon as the
head turns or rises. `bow` in place of `wave`: the arms hang straight beside the body,
and the arm raised by its first link reads, by `check`'s `TEXTURE_STRETCH` reading on the
clip (below), 1.864 at +25° and 2.366 at +35° (`handwear_l`, ceiling 1.926544) — a wave
that low does not read as one.

One `physics` constraint per chain link, on the link bone, driving `rotate` only, strength
falling down the links to 0.65 of the root link's:

| strands | inertia | strength (root link) | damping | mix |
| --- | --- | --- | --- | --- |
| scarf ends `robe_r`, `robe_l` | 0.7 | 70 | 0.85 | 1 |
| bangs `bang_r`, `bang_c`, `bang_l` | 0.12 | 300 | 0.85 | 1 |
| skirt `skirt_r`, `skirt_c`, `skirt_l` (issue #363: was 0.12, which folded 3 of 308 triangles of `bottomwear` on frames 7–8 of `hop` at 12 fps) | 0.1 | 300 | 0.85 | 1 |
| arms (sleeves) `sleeve_r`, `sleeve_l` | 0.15 | 250 | 0.85 | 0.6 |
| the bun, `bun` (no length: translation only, `x` 0.5, `y` 1) | 0.15 | 300 | 0.85 | 1 |

The bun first took inertia 0.4, strength 120, and the hop then read
`CHECK_TEXTURE_STRETCH: mesh "hair_back" triangle 167 (vertices 116 124 125), edge 125-116, idle frame 18 — the edge is 0.123 times its rest length (max(ratio, 1/ratio) 8.125); <= 1.926544 is required`;
at 0.15 and 300 it reads 1.279 there. The side hair (`hair_side_r`, `hair_side_l`) stays
rigid on `head`: both are region parts with no mesh to bend, and `hair_side_r`'s art
holds part of the face; no chain was tried on them.

Measured as on `demo` (`check`'s `TEXTURE_STRETCH` reading applied to each clip's
`rigc render --geometry --fps 30 --max 640`, the clip alone from frame 0, physics on;
ceiling 1.926544; rig-c 2.45.2 and later, whose render no longer ends a frame on a physics
step's tie, with rig-c 2.40.0's figure in brackets where it differs): `tilt` 1.025 [1.023],
`look_l` 1.121 [1.108], `look_r` 1.118, `smile` 1.015 [1.014] (all `hair_front`),
`startled` 1.152 (`topwear`), `bow` 1.246 (`hair_back`), `hop` 1.403 [1.336]
(`hair_front`). No bar reads a clip; these are a measurement made for the issue, not a
gate.

## Known limits

- **The centre scarf end is stiff.** It hangs inside `topwear`, whose mesh is weighted
  to `chest`, `hip` and the `robe_r` and `robe_l` chains on the two side ends; no
  chain runs down the centre, so it moves only with the torso.
- **The short skirt moves little.** Its hem travels 0.145 rig px over the idle — 0.077
  frame px at `--max 640`. Until issue #118 `check` read `TIP_OVER_ROOT` off rendered
  pixels, and in that regime the figure was set by the render grid: the lattice build
  read 0.901 to 6.401 over `--max` 620–660 (4.537, a PASS, at 640), the contour build
  1.344 to 5.689. `check` now measures it from `geometry.json`, which no render size
  enters, so `--max` no longer moves the figure: 1.207 on the lattice and 1.738 on the
  contour build, at every size.
- **No neck part.** The scarf covers the neck and `assemble --propose-plan` proposes
  none, so the face-less fallback of issue #76 has nothing to derive a face from: with
  the face plan entries removed, `propose` refuses with `PROPOSE_FACE_PRESENT` naming
  the missing neck (selftest `CH912`), where reference-demo and reference-sample get a fallback proposal
  (`CH902`).

## Both mesh modes

Issue #118's builds, before issue #262 (whose rule took the `chest` segment off
`bottomwear`, after which `expected/` is the lattice build): then `expected/` was the
mixed build, every mesh on the proposal's lattice but `bottomwear` in contour mode. The lattice build is the same command on a scratch copy of
`config.json` with `bottomwear` back on `grid: 12` (the proposal's), and the contour
build one whose every mesh's `grid` is replaced by
`contour: {tolerance: 1, margin: 1, spacing: <that grid>, stray: 4}` — #108's
parameter set. The three builds' `check`, `TIP_OVER_ROOT` measured from the geometry
(issue #118):

| | lattice | mixed (`expected/`) | contour |
| --- | --- | --- | --- |
| `check` | FAIL, `TIP_OVER_ROOT`; 9 of 9 bars measured | PASS, 9 of 9 bars measured | PASS, 9 of 9 bars measured |
| seam | mean 0.211, 2 px over 40 | mean 0.211, 2 px over 40 | mean 0.214, 2 px over 40 |
| `TEXTURE_STRETCH` severity (ceiling 1.926544) | 1.106, `bottomwear` | 1.098, `hair_front` | 1.144, `hair_front` |
| `TIP_OVER_ROOT` `bottomwear`: upper / lower half, rig px; ratio | 0.113 / 0.137; 1.207 | 0.083 / 0.145; 1.738 | 0.083 / 0.145; 1.738 |
| pack (`build`'s last pack line) | 393x1273, 24 regions, 95.5% covered | 392x1270, 24 regions, 96.0% covered | 377x1264, 24 regions, 100.2% covered |

Per mesh part: V (hull) · enclosed px² · overshoot px · smallest angle° from
`bun tools/contour_survey.ts scarf=<lattice build>`, and the stretch severity from each
build's `check.json` (`TEXTURE_STRETCH.per_mesh`):

| part | grid | lattice | contour | stretch, lattice / contour |
| --- | --- | --- | --- | --- |
| `hair_back` | 12 | 159 (52) · 3455 · 12.53 · 39.81 | 151 (57) · 566 · 2 · 8.48 | 1.027 / 1.027 |
| `hair_front` | 8 | 143 (58) · 1773 · 9.22 · 32.01 | 119 (50) · 422.5 · 2 · 9.46 | 1.098 / 1.144 |
| `handwear_r` | 9 | 382 (120) · 4579 · 10.44 · 37.87 | 291 (65) · 917 · 2 · 4.4 | 1.021 / 1.021 |
| `handwear_l` | 8 | 478 (132) · 4168 · 9.22 · 41.19 | 364 (55) · 962 · 2 · 2.6 | 1.022 / 1.027 |
| `topwear` | 29 | 239 (84) · 30230 · 32.20 · 17.24 | 283 (153) · 2599.5 · 2 · 3.69 | 1.051 / 1.112 |
| `bottomwear` | 12 | 182 (54) · 3563 · 13.04 · 42.51 | 179 (69) · 528.5 · 2 · 7.7 | 1.106 / 1.036 |

All six parts build in both modes; over them the lattice uses 1583 vertices and
encloses 47768 px² of transparent area, the contour mesh 1387 and 5996.
