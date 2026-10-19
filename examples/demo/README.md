# demo

A generated full-body character — prompted as an adult woman in a white and pink
frilled idol dress with long puffy sleeves and a layered skirt, very long pink twin
tails, a large ribbon hair bow, a star hair ornament and dangling star earrings —
painted for this repository by issue #227 to replace the clasped-hands painting the
README showed until then (now the fixture `examples/reference-demo`). It is the
README's picture. It was made with a public checkpoint, Hassaku XL (Illustrious)
v1.3 Style A, and no LoRA, on a pose file (`pose.json`, issue #198) that holds the
arms away from the body and the hands apart and open, and the painting was given
one hand-detailer pass. `config.json`'s `generation` block is the painting step's
record and its `x-hand_detailer` the detailer's; its `seed_note` says how seed 71006
was chosen. Its heavy inputs (the painting, the two images See-through was fed, and
the `full` and `head` See-through layer sets) live in the
[parts-examples](https://github.com/rig-c/parts-examples) repository, which also
holds the generation record, the candidate table (sixteen paintings, each with a
one-line reading of its hands), the detailer's graph and mask, and the licence and
the credit line it requires; `bun run fetch-examples` copies them into `inputs/`
here (gitignored).

## Why it exists

- **Hands that read as hands.** The painting it replaces was painted on the
  `stand_clasp` skeleton by a checkpoint that cannot draw interlocked fingers; its
  hands did not read as hands above a thumbnail. This one was chosen by reading a
  crop of each hand at full resolution. No figure chose it: the layer WARN count
  the older examples were chosen on cannot see fingers.
- **The proposal, two corrections.** The config's `bones`, `meshes`, `regions` and
  `motion` are `proposal.json`'s, value for value, but for the points of two chains
  (below) and the two authored additions of issue #224 (`motion.animations_from` and
  `constraints`, *Gestures, expressions and trailing strands* below), and every
  mesh's `grid`: the config keeps the part rule's (`propose --grid-rule part`), and
  `proposal.json` has carried the figure's spacing since issue #265 (grid 32 for every
  lattice but `hair_back` 36 and `earring` 34, already coarser); built with it, every
  `check` bar passes and the figure's triangles fall from 1,816 to 878. Adopting it
  here is a change of its own; its `assemble.plan` is `assemble --propose-plan`'s but for one entry
  (below); its `seethrough.head_box` is `propose --head-box`'s as printed.

## What is tracked

- `config.json` — the config the build reads.
- `animations.json` — the named animations beside the idle (issue #224), in rig-c's
  motion-spec shape, which `motion.animations_from` names; *Gestures, expressions and
  trailing strands* below.
- `pose.json` — the pose file `generation.control.skeleton` names, read beside the
  config by `comfy paint`; the copy in parts-examples is the same file.
- `proposal.json` — what `rig-parts propose --parts <build> --source painting.png`
  writes on the parts of the build in `expected/` (selftest `CH06`, `CH901`).
- `sheets/` — `rig-parts sheet` contact sheets, PNG: the painting with the full
  run's layers, with the head run's layers, and with the 23 assembled parts of the
  `expected/` build (the last is also `assets/demo-parts.png`).
- `expected/rig.json` is the flat form: every bone unturned, which is `flattenRig`
  (`src/rig.ts`) of the built rig. A build's `rig/rig.json` turns each chain link along
  its chain, so it carries `rotation` and `length` on the links, and the offsets under
  them in the turned frame, where this file holds unturned offsets only: a plain diff of
  the two shows those bones and the weights bound to them as changed, and the build is
  not broken. The chain suite (`CH03`) compares this file with `flattenRig(built)`, not
  with the built file; compare the same way.
- `expected/` — **this port's own build**, as for `scarf`:
  `rig-parts build --config examples/demo/config.json --source
  inputs/painting.png --full inputs/layers/full --head inputs/layers/head --out
  <dir>`, the call the selftest's chain suite makes. The reference implementation
  never saw this character, so there is no reference output to compare with: the
  chain suite holds the tree to its own output at the commit that added it — a
  determinism check, not a port check. `parts.json` (`assemble`), `motion.json` and
  `mesh_report.json` (`rig`), and `check.json` and `gate_spine-html.txt` (`check`)
  are the build's files as written; `rig.json` is the build's `rig/rig.json`
  carried to its flat form by `flattenRig` (`src/rig.ts`), the form every example's
  `expected/rig.json` is in. Issue #224 moved `rig.json` (the 29 physics constraints),
  `motion.json` (the seven animations after `idle`), `gate_spine-html.txt` (the
  counts it prints: `animations=8`, `physicsConstraints=29`, and one more rule
  measured, 25 of 50 on the packed build) and `check.json` (`loop_physics` names the
  constraints the loop bar leaves out; the idle's figures move by the physics the idle
  itself drives and by the render's viewport, now fitted over the hop and the wave:
  `BREATH_VISIBLE` `torso_heat_mean` 14.056 to 14.271, `TIP_OVER_ROOT` 2.425 / 6.93 /
  6.521 to 2.426 / 6.932 / 6.525, every status as before); `parts.json` and
  `mesh_report.json` did not move. A follow-up raised the twin tails' physics inertia
  from 0.5 to 0.8 (below), which moved `rig.json` (those six values) and `check.json`
  (`torso_heat_mean` 14.271 to 14.352, `hair_back`'s `TEXTURE_STRETCH` 1.056 to 1.062,
  every status as before) and nothing else.
  Issue #252 moved the config's `motion` with the proposal's: the idle is 40 frames at
  12 fps (`duration` 40/12 s, every period scaled with it) and the breath travels 2.5 %
  of the `topwear` part's 237 px height, 5.92 px peak to peak (amplitude 2.96, was 1.3).
  That moved `motion.json` (the idle's keys) and `check.json` (41 idle frames, not 49;
  `torso_heat_mean` 14.352 to 29.905, `TIP_OVER_ROOT` `bottomwear` / `handwear_r` /
  `handwear_l` 2.426 / 6.932 / 6.525 to 2.395 / 4.232 / 4.256, `TEXTURE_STRETCH` 1.097
  to 1.169, now on `bottomwear`; every status as before); `parts.json`, `rig.json`,
  `mesh_report.json` and the gate file did not move.
  Issue #262 took the `chest` segment off `bottomwear` (`['chest', [416, 294],
  [416, 400]]`, which ended on the skirt's top row): a skirt whose art starts below the
  chest bone hangs from the hip line and its chains, and the config follows the proposal.
  Here the breath was not what carried the skirt's upper half — it travels 0.397 rig px
  with the segment and 0.392 without, the rest the chains' — so `check` barely moves.
  That moved `proposal.json` (the segment, and a note naming the rule), `rig.json`
  (`bottomwear`'s weights, and its slot's bone `chest` to `hip`, the first segment's),
  `mesh_report.json` (`chest` off `bottomwear`'s bones; `mean_influences` 3.56 to 3.54)
  and `check.json` (`TIP_OVER_ROOT` `bottomwear` 2.395 to 2.428; `TEXTURE_STRETCH` 1.169
  on `bottomwear` to 1.097 on `hair_front`, `bottomwear` itself 1.019; every status as
  before); `motion.json`, `parts.json` and the gate file did not move.
  Issue #270 took the breath's size off the torso the rig has rather than the garment:
  2.5 % of neck [415, 228] -> hip [416, 420], 192.0 px, is 4.80 px peak to peak
  (amplitude 2.40, was 2.96 off the 237 px `topwear`). Demo moves because its top is not
  its torso either: the `topwear` box runs from y 192, 36 px above the neck bone (the
  collar), to y 429, 9 px below the hip. The config follows the proposal. That moved
  `proposal.json` (the amplitude and the `breath:` note), `motion.json` (the breath's
  keys) and `check.json`: `torso_heat_mean` 29.905 to 25.167, `TIP_OVER_ROOT`
  `handwear_r` / `handwear_l` 4.232 / 4.256 to 4.846 / 4.803 (`bottomwear` 2.428, as
  before), `TEXTURE_STRETCH` per mesh `topwear` 1.095 to 1.077 and `hair_back` 1.062 to
  1.063 (the severity 1.097 on `hair_front`, as before), the face half of
  `STILL_REGIONS_DARK` rms 1.139e-13 to 1.233e-13; every status as before. `rig.json`,
  `mesh_report.json`, `parts.json` and the gate file did not move. The README's animation
  (`assets/demo-idle.png`) was rebuilt with the same command: 704,009 B (it was 725,845 B,
  the build of #252; this config before #270 gives 724,053 B, so it had already gone
  stale with #262).
  Issue #305 moved rig-c from 2.40.0 to 2.47.1. Every build file is byte-identical
  across 2.40.0, 2.45.1, 2.45.2, 2.46.0, 2.47.0 and 2.47.1 (`parts.json`, `rig/`, the packed
  skeleton and the gate file); 2.45.2, whose render no longer ends a frame on a physics
  step's tie (core#1380), moved the idle frames `check` reads and so `check.json`:
  `torso_heat_mean` 25.167 to 25.073, `TIP_OVER_ROOT` `handwear_l` / `handwear_r` /
  `bottomwear` 4.803 / 4.846 / 2.428 to 4.791 / 4.836 / 2.426 (tips 7.049 / 6.959 / 0.952
  to 7.032 / 6.946 / 0.951), `TEXTURE_STRETCH` severity 1.097 to 1.096 (`hair_front`, its
  worst now frame 0 at 1.096, was frame 20 at 0.912; its smallest ratio 0.916), `hair_back`'s
  smallest ratio 0.947 to 0.944 (triangle 185, frame 27), `earring`'s largest at triangle
  22, frame 10; every status as before. The README's animation was rebuilt with the same
  command: 703,909 B, the jump at the wrap max 1 (was 7), 0 px over 40.
  Issue #320 reads the animations beside the idle for folds (`ANIMATIONS_DO_NOT_FOLD`,
  rigc's `render --folds` with the 29 physics constraints left out): the seven clips fold
  no mesh. That added the key to `check.json` after `TEXTURE_STRETCH`, and nothing else in
  it or any other file moved. Issue #333 reads the idle in the same run: it folds no mesh
  either, and `check.json`'s `animations` gains `"idle"` first — nothing else moved.
  Issue #347 dropped the 16 px `chest` segment at the shoulder from `handwear_r` and
  `handwear_l`, in `proposal.json` (the two-blob rule no longer drafts it, and its note
  reads `…, and nothing on chest`) and in the config with it: with the stub, each sleeve's
  first link turned 90°, −90° and 180° stretched its worst edge 2.46 to 254.7 times, and
  without it the sleeve turns rigidly (1.0000). That moved `rig.json` (the two meshes'
  weights, no vertex on `chest`), `mesh_report.json` (those two rows: bones `chest` gone,
  `max_influences` 4 to 3, `mean_influences` 2.73 to 2.34) and `check.json`: the new
  `STRESS_OFF_CHAIN` key after `ANIMATIONS_DO_NOT_FOLD`, PASS on both sleeves, and
  `TIP_OVER_ROOT` `handwear_l` 4.791 to 4.761 (root 1.468 to 1.478) and `handwear_r`
  4.836 to 4.835; the seam (mean 0.147, 0 px over 40), the pack and every status as
  before. `parts.json` and `gate_spine-html.txt` did not move.

## The two corrections

**`hair_back` from the full run** (`assemble.plan_note`). The proposed head box,
1125x1125 at `[268, 0, 1393, 1125]` (it ran 269 px above the painting and
`propose --head-box` shifted it down), is still narrower than the twin tails. With
the proposed plan, `hair_back` from the head run, `assemble` printed
`uncovered error px: 2992` with the two largest holes the tail tips beside the
crop — `uncovered hole 1: 464 px at 692,384 18x69` and
`uncovered hole 2: 373 px at 123,385 13x66`, each between `hair_back` and the page.
From the full run: 2,939 px, the largest hole 48 px. `reference-demo` records the
same edit for the same reason.

**The two outer skirt chains** (the `note` on `skirt_r` and `skirt_l`). The proposal
put `skirt_r` at x 363, 340, 327 and tip 354, and `skirt_l` at 461, 486, 505 and tip
473 — within 90 px of the centre line (x 416) of a skirt 449 px wide. The two sides
of the skirt were then weighted to the still `hip`, and the three chains swinging
together turned the skirt about its middle: one side rose as the other fell, art
crossed the box's fixed mid-line, so the upper half's centroid travelled 0.537 rig px
and the lower half's 0.237, and `check` failed `TIP_OVER_ROOT` (ratio 0.442 against
1.4725) — where, followed pixel by pixel through the posed triangles at idle frame
30, the art of the lower half had moved 1.295 rig px on average and the upper half's
0.099. The bar reads fixed halves by definition (AUTHORING §7), so the skirt has to
stop turning, not the bar. Moved, each joint sits
0.8 of the way from the skirt's centre to its edge in its row (the `bottomwear` art
at alpha above 128, rows 440, 508 and 575), and each tip at the same share in row
610, the hem's last full-width row (the proposal's row 643 holds only the 96 px
centre frill): `skirt_r` `[326, 440]`, `[274, 508]`, `[241, 575]`, tip
`[268, 610]`; `skirt_l` `[498, 440]`, `[551, 508]`, `[589, 575]`, tip `[559, 610]`.
`TIP_OVER_ROOT` reads 2.425 (0.391 upper, 0.948 lower) and `propose --from-config`
prints no LINT line. `skirt_c`, the link counts and the idle tracks are the
proposal's. What else was tried on the same parts, each one change on the proposal,
and what `TIP_OVER_ROOT` read for `bottomwear`:

| change | ratio |
| --- | --- |
| none (the proposal) | 0.442 |
| `bottomwear` in contour mode, spacing 25 (`scarf`'s correction) | 0.449 |
| the `chest` segment taken off `bottomwear` | 0.441 |
| `meshes.bottomwear.r` 25 | 0.445 |
| `exponent` 4 | 0.522 |
| `rule: "heat"` | refused, `RIG_HEAT_ISLAND_SOURCE` (a 2 px island at rig 630,583) |
| the two outer chains' joints at 0.6 of their rows' half-width, tips left in row 643 (at 0.6 of row 610's) | 1.098 |
| the same at 0.8 | 2.629 |
| the same at 0.95 | 3.679 |
| at 0.8, tips in row 610 (tracked) | 2.425 |

The README loop pasted uncorrected stops where the README says to read
`check.json`, naming `bottomwear` on `CHECK_TIP_OVER_ROOT` and nothing else
(selftest `RL01`).

## The build, by figure

`check` 11 of 11 bars measured, PASS (the tenth, issues #320 and #333, reads the idle and the clips beside it for folds; the eleventh, issue #347, turns each sleeve's chain far):

| | |
| --- | --- |
| gate | `50 assertions: 25 measured (25 passed, 0 failed), 25 skipped, 0 not in profile "rig-play"` |
| pack | `skeleton.png 1051x972, 23 region(s), 96.9% covered, padding 2, page edges free, shape polygon` |
| seam | mean 0.147, 0 px over 40, frame scale 0.943777 |
| loop | max \|d\| 0 |
| `TIP_OVER_ROOT` | `bottomwear` 2.426, `handwear_r` 6.932, `handwear_l` 6.525 (floor 1.4725) |
| `TEXTURE_STRETCH` | severity 1.097, `hair_front` (ceiling 1.926544) |
| `BLINK_NO_HOLE` | idle frame 29 closed, hole 0 px |
| `ANIMATIONS_DO_NOT_FOLD` | the idle and the seven clips at 12 fps, the 29 physics constraints left out: no folding mesh |
| `STRESS_OFF_CHAIN` | `handwear_r` and `handwear_l`, each chain's first link turned 90°, −90° and 180°: 1.0000 at every turn (bar 1.0000) |
| `RECOMPOSITE_HOLES` | error px 14,570; uncovered 2,939 in 1,020 holes, the largest 48 px at 204,519 27x25 beside `bottomwear` |
| meshes | 9, 1,192 vertices (`mesh_report.json`) |

`--seam silhouette` changes little here: recomposite error pixels 14,570 → 14,534,
uncovered 2,939 under both. The README's animation is the default build's.

## Gestures, expressions and trailing strands

Issue #224 gave the character named animations beside the idle and physics on its
strands, so a reader has a worked set to copy and the toolchain trailer a rig that can
perform. Everything is authored in two places: `animations.json` (named by
`motion.animations_from`) and the config's `constraints`. Nothing in the package
proposes either, and of the clips `check` judges one thing: that no mesh folds in them
(`ANIMATIONS_DO_NOT_FOLD`, issue #320, which reads the idle too since issue #333).

**The clips.** Each is a one-shot (`loop: false`) that keys only what it needs and
starts and ends at the setup pose, so it plays over the idle on a second track of the
player. None keys a constraint, the draw order, a deform or an attachment. They key the
bones the idle leaves alone — `head` (the idle turns `head_ctl` and `neck`), `chest`
(the idle breathes `chest_ctl`), `hip`, `root`, `mouth`, and the chain links `sleeve_l0`
to `sleeve_l2` (the idle turns the `*_ctl` bones above them) — so the idle's sway, breath
and chain swing stay alive under every clip. Every key carries an ease-in-out Bézier
(`curve`, control points at a quarter and three quarters of the span).

| clip | s | keys |
| --- | --- | --- |
| `tilt` | 1.6 | `head` rotate to 10°, held, a small overshoot past the rest, settles |
| `look_l`, `look_r` | 1.8 | `head` only: translatex ±16 with an overshoot, rotate ∓5°, scalex 0.95 (the near side foreshortened) |
| `smile` | 1.4 | `mouth` scale 1.3 × 0.7 and up 3; `eye_r`, `eye_l` scaley 0.72 (the eyes narrow); `brow_r`, `brow_l` up 4; `head` 5° |
| `startled` | 1.4 | anticipation at 0.12 s (brows down, eyes 0.85, `head` and `chest` down), the start at 0.24 s (brows up 12, eyes 1.25, `mouth` 0.75 × 1.8, `head` and `chest` up 8), a held beat, a settle |
| `wave` | 2.21 | `sleeve_l0` +48°, `sleeve_l1` +20° (the arm out to the side), `sleeve_l2` +10°, −10°, +10° (the hand), back down |
| `hop` | 1.2 | `hip` down 14 (anticipation), `root` up 90 at 0.42 s (`root` carries the shoes, which ride `root`, with the body), `hip` down 18.2 on landing (squash), a small rebound; `chest` scale squashes and stretches 2–4 % |

An expression is what the bones can do, and here that is not much. Every slot holds one
attachment, the part's own image: the mouth widens, narrows and lifts, the eyes narrow
and widen, the brows rise, and no mouth or eye shape is ever swapped for another — there
is no second image to key. On the contact sheets made for this issue (full body at
640 px, with a 2x head crop), `look_l`, `look_r`, `smile` and `startled` differ only
slightly from the idle: the head turn is a shift of a few pixels and the face changes
are a few pixels on parts tens of pixels wide. They are kept as worked examples of the
keys, not as expressions that read at that size.

**The strands.** One `physics` constraint per chain link, on the link bone itself
(`hairback_r0`, not `hairback_r0_ctl`), driving `rotate` only, strength falling to 0.825
and 0.65 of the chain's value down its links so the tip is the softest:

| strands | inertia | strength (root link) | damping | mix |
| --- | --- | --- | --- | --- |
| twin tails `hairback_r`, `hairback_l` | 0.8 | 90 | 0.85 | 1 |
| bangs `bang_r`, `bang_c`, `bang_l`; skirt `skirt_r`, `skirt_c`, `skirt_l` | 0.2 | 200 | 0.85 | 1 |
| arms (sleeves) `sleeve_r`, `sleeve_l` | 0.15 | 250 | 0.85 | 0.6 |

The ribbon bows (`hairpin`) and the earrings (`earring`) are single bones with no
length, and a `rotate` drive on a bone with no length is refused by rig-c's gate
(`A23`, as rig-c's own AUTHORING documents it: with no tip the solver aims the bone at
a world angle); each takes a translation-only constraint
instead (`x` 0.5, `y` 1; inertia 0.3, strength 160 for the bows, 0.5 and 100 for the
earrings) and bounces as one piece.

**What was measured, and against what.** `check` reads the idle alone, so each clip was
read by `check`'s own `TEXTURE_STRETCH` reading (`stretchLine`, `src/check.ts`) applied to
the clip's `rigc render --geometry --fps 30 --max 640` geometry, the clip played alone
from frame 0 with physics on, against the same ceiling, 1.926544 (rig-c 2.45.2 and later,
whose render no longer ends a frame on a physics step's tie; the figures on rig-c 2.40.0 in
brackets where they differ):

| clip | severity | worst mesh |
| --- | --- | --- |
| `tilt` | 1.162 [1.151] | `hair_back` |
| `look_l`, `look_r` | 1.323, 1.331 | `neck` |
| `smile` | 1.075 [1.07] | `hair_back` |
| `startled` | 1.284 | `neck` |
| `wave` | 1.836 [1.829] | `handwear_l` |
| `hop` | 1.648 [1.561] | `hair_back` |

What set the values: the first draft (the arm raised overhead, `sleeve_l0` +55° and
`sleeve_l1` +60°, bangs and skirt at inertia 0.4, strength 120) read 5.327 on `wave`
(`handwear_l`, the inside of the elbow) and 2.285 on `hop` (`bottomwear`; `hair_front`
2.096). The arm does not go higher: with the sleeve constraints left out, +40° / +60°
read 3.082, +60° / +15° 2.185, +80° / +20° 3.195, and +50° / +20° with the hand at ±14°
1.902; the tracked +48° / +20° / ±10° reads 1.829 with the sleeve constraints in (1.836
from rig-c 2.45.2). A wave
overhead tears the elbow of a mesh whose weights blend two links there, so this one is
an arm out to the side with the hand waving. Stiffening the bangs and the skirt to
inertia 0.2, strength 200 brought `hop` to 1.362. The tails then trailed less in the hop
than `scarf`'s ends: at the apex (0.43 s) the last link of each tail sat 20.3 and 19.7
rig px from where the keys put it relative to `head`. One number moved it: the tails'
inertia, 0.5 to 0.8, gives 32.0 and 31.1 at the apex and 46.6 and 45.3 at the landing
(0.73 s; 34.1 and 33.0 before), with `hop` at 1.561 (`hair_back`; 1.648 from rig-c 2.45.2). Lowering the tails'
strength instead saturates (90, 45, 30, 15 give 20.3, 26.7, 29.0, 31.4 at the apex),
and inertia 1 tears `hair_back` in the hop (3.258). The skirt is left as it was.

**Limits.** No bar here reads a clip: the figures above are a measurement made for this
issue, not a gate, and a clip played over the idle on a player's tracks adds the idle's
small motion to them. The render fits its viewport over every animation, so the hop and
the wave moved the idle's figures in `check.json` (above), every status as before.

## Known limits

- **The hands are part of the sleeves.** See-through puts each forearm and hand
  in its `handwear` layer, so the hands swing with the sleeve chains and are not
  posed on their own.
- **The skirt's centre swings least.** `skirt_c` keeps the proposal's points and
  amplitudes; the two moved chains carry the sides.
- **Earrings have no chain.** The proposer found the earring's pendant top off the art
  and proposed no chain (its note); the earrings ride `earring`, a child of `head`,
  which a translation-only physics constraint bounces (issue #224, below) — they
  never swing about their own hooks.
