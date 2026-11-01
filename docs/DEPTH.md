# Depth-driven rigging: a painted head that turns with volume

Move the pointer across the [head-turn demo](https://rig-c.org/demos/head-turn/)
and the painted head follows your gaze. The face comes forward, the hair falls
behind it, the ears keep their place behind the cheeks, and nothing reads as a
paper cut-out being tilted. That is what depth-driven rigging gives a rig this package
builds: a head (and, if you want, a body) that answers two dials, `yaw_dial`
and `pitch_dial`, with that sense of volume. The dials are values, not an
animation. You decide when they move and what moves them — a pointer, a
camera, a script — and the rig guarantees the picture holds together inside
the band it was built for.

This page is for a person deciding whether to try it, and then trying it. It
says what goes in, what each stage prints, how to pick a painting, how to judge
the result, and where the feature stops. The contract — every field, every
refusal, every number — stays in [AUTHORING](AUTHORING.md); this page links
there rather than repeating it.

## The idea at a glance

A flat painting has no depth of its own, so the rig borrows some. Every part
that turns gets a **depth sheet**: a grey image the size of the part where each
pixel says how far forward that bit of paint sits. When the dial turns, each
point of the part slides sideways by its depth times the sine of the angle.
Near points move more, far points move less, and that difference is the
parallax your eye reads as a solid shape. Small features — eyes, mouth, brows —
move as one piece at one depth each, so they slide instead of warping. The back
hair shifts a little the other way, so the head reads as having a back.

Where do the sheets come from? From a depth model you run yourself, one part at
a time. The tools here carry no model, no weights and no downloads; they prepare
the inputs a model needs, and they turn what it returns into sheets a rig can
use. Three things we learned the hard way are built into that path:

- **One part at a time, on neutral grey.** A depth model shown the whole sheet
  of parts reads it as one object and flattens everything. Shown one part on
  grey, it gives that part its own shape.
- **The face is the exception.** Depth models misread painted faces — a fringe
  shadow becomes a step in the forehead. So the face takes a *normal* map
  instead, which the tool integrates into a height field and signs by
  convexity (the middle of a face is nearer than its rim). That integration is
  for the face only: it breaks on anything with an occlusion edge, like hair
  strands or a collar.
- **The numbers that place a part are yours to declare.** A monocular model
  gives relative shape, not scale. How far forward each part sits (its
  `median`) and how deep its own shape is (its `relief`) are declared in rig
  pixels, and the tool never guesses them.

See-through, the layer decomposition this package reads, also writes a per-layer
depth sheet, and a config can register those directly (`config.depth`,
[Per-layer depth sheets](AUTHORING.md#per-layer-depth-sheets-773)). In
side-by-side review, per-part maps from a depth model read better by eye than
a single map of the whole painting, which is why the per-part route below is
the one this page walks.

## The steps, and what you will see

Depth sits between `assemble` and `rig`. You need an assembled build — a
`parts.json` and its `parts/` — and a character config whose `turn.roles`
names each part that turns and says what kind it is: `surface` for the parts
that bend with their sheet (the face, the hair), `unit` for features that move
as one piece, `rear` for what sits behind the head. A body group is declared
the same way under `turn.body.roles`. The roles, the dials and the grid the
surfaces are built on are in [AUTHORING §3, the `turn` row](AUTHORING.md#3-configjson-field-by-field).

### 1. Prepare one inference image per part

Write a small recipe — a separate JSON file, not a field on the character
config — naming the parts you want sheets for, which group each belongs to,
and the medians and reliefs you declare for them:

```json
{
  "spec": "rig-parts-depth/1",
  "prepare": {"longSide": 1024, "paddingFraction": 0.08, "padding": 4},
  "groups": {"head": {"near": "white", "zScale": 30, "pivot": 15}},
  "parts": {
    "face": {"map": "face.json", "source": "normals", "frame": "input", "group": "head", "median": 21, "relief": 13},
    "hair_front": {"map": "hair_front.json", "source": "depth", "frame": "input", "group": "head", "median": 21, "relief": 10},
    "hair_back": {"map": "hair_back.json", "source": "depth", "frame": "input", "group": "head", "median": 15, "relief": 9}
  },
  "clear": []
}
```

Every number there is an authored choice for one character, not a default; the
tool has none. Then:

```sh
rig-parts depth-prepare --parts work/rig --config depth.json --out inference
```

On the public `demo` example, assembled with its tracked config from the
painting and layers in [rig-c/examples](https://github.com/rig-c/examples),
that printed:

```
depth-prepare: 3 part(s); manifest.json binds crop, padding and source/input hashes
```

and wrote `inference/face.png`, `inference/hair_front.png`,
`inference/hair_back.png` — each part upscaled by a whole number until its long
side is at least the declared size, laid on grey with a margin — and
`inference/manifest.json`, which records the hashes of the parts, the recipe
and every image it wrote. That manifest is how the next stage knows the maps
belong to these parts and nothing moved in between.

### 2. Run your depth model

This is your step, with your model, on your machine or wherever you run it.
Read `inference/<part>.png`, write one numeric map per part as JSON
(`rig-parts-map/1`: width, height, channels, and the raw floating-point values
row by row), the same size as the image you read. `"frame": "input"` in the
recipe is what says so, and the manifest binds it, so choose it before you
prepare. Scalar depth is one channel; the face's normals are three signed
channels in image axes. Save the model's actual numbers — a greyscale preview
has already thrown away the normalisation the next stage needs.

What we used: Depth Anything for the parts (V2 Large, and Depth Anything 3's
monocular model), and Lotus's normal model for the face. Any model that
returns a dense relative depth will do; the stage after this does not know
which one you ran. Model licences are the model's own and are not this
package's to restate — the site's [licensing page](https://rig-c.org/docs/licensing/)
says where each kind of term sits.

### 3. Apply the maps as depth sheets

```sh
rig-parts depth-apply --parts work/rig --manifest inference/manifest.json --config depth.json --rig-config config.json --out mapped
```

For each part it normalises the map inside the part's opaque pixels, places it
at your declared median and relief, encodes it as a sheet in the group's
polarity and scale, extends it past the part's edge so there is no cliff at
the silhouette, and prints one line per part. On a one-part check fixture
(a synthetic disc, not a painting) the current code prints:

```
depth-apply: face levels=30 clip=0 reliefRigPixels=10 sign=1
depth-apply: wrote registered parts, config.json and depth-report.json; run rig for the core gate
```

`levels` is how many distinct grey levels the sheet uses, `clip` the share of
pixels that fell outside the group's scale (keep it at or near zero), and
`sign` the convexity sign the face integration chose. `mapped/` is a complete
assembled directory: the art unchanged, a `<part>_depth.png` beside each mapped
part, `parts.json` pointing at them, a copy of your config with the group
pivots written in, and `depth-report.json` with every number and hash. Nothing
in `work/rig` or your original config is touched. Any mismatch — a recipe edited
after prepare, a part that moved, a map of the wrong size, a part your
`turn.roles` does not name — is refused by name before a byte is written.

### 4. Rig, and look

```sh
rig-parts rig --parts mapped --config mapped/config.json --out compiled
```

The rig stage is the ordinary one. With `turn.roles` declared it builds the
depth-sampled turn: `surface` parts become grids that bend with their sheets,
`unit` parts ride a carrier at their own depth, and the motion gains `turn` and
`tilt` animations driven by `yaw_dial` and `pitch_dial` (a body group adds
`body_yaw_dial`). On the check fixture above the compiled motion carried
`idle`, `tilt` and `turn`, and the bones `faceshift`, `face_surface`,
`yaw_dial` and `pitch_dial` beside the head. It also writes
`depth_sheets.json`, which names every sheet the build consumed. rig-c's gate
runs as always; nothing is written unless it passes. `check` and `build` go on
from here as they do for any rig.

**Try it today.** The `look` example in
[rig-c/examples](https://github.com/rig-c/examples/tree/main/look) is a complete
depth-driven head and body turn you can rebuild, with no model and no GPU. It
takes the See-through sheets route, so steps 1 to 3 are already done for you:

```sh
rig-parts assemble --source painting.png --full layers/full --head layers/head --config config.json --out assembled
rig-parts rig --config config.json --parts assembled/rig --out candidate
rigc build --rig candidate/rig.json --motion candidate/motion.json --out built --profile rig-play --pack --page-edges free --pack-shape polygon
```

The motion comes out with `turn`, `tilt` and `body_turn`, and the rig with
`yaw_dial`, `pitch_dial` and `body_dial`, so `look/config.json` is also a worked
`turn.roles` to start your own from. To try the per-part route, run
`depth-prepare` on `assembled/rig` with a recipe like the one above. From step 2
on, the maps are your model's.

## Picking a painting, and judging what you get

**Start from an upright head.** Everything in [PAINTING](PAINTING.md) still
holds — front view, arms clear, plain background — and depth adds one more
requirement. The turn rotates the head about upright yaw and pitch axes, so a
painting whose head is already tilted gets a neck that breaks at the extremes.
That is an input failure, not a tool failure: pick a painting with the eye
line level. The rig stage warns by name (`RIG_TURN_HEAD_ROLL`) when the eye
line it reads is noticeably rolled; take the warning seriously
([Head roll before a declared turn](AUTHORING.md#head-roll-before-a-declared-turn)).

**Judge it the way a person actually sees it.** Volume is read from gaze-like
motion — a pointer wandering irregularly in yaw and pitch at once — or from the
turn combined with a larger movement, such as an arm swinging. A dial swept
back and forth on its own reads flat, however good the sheets are, so do not
judge from a sweep or from the `turn` animation played straight through. Put
the build in a page where the pointer drives both dials; the adapters' look
example shows [how to bind a pointer to declared sliders](https://github.com/rig-c/adapters/blob/main/examples/look/README.md).
Separately, render the setup pose and both yaw endpoints and look at their
difference at native scale: that is where a tear, a clipped sheet or a feature
sliding off the face shows, and it is a check for defects, not for volume.

**Read the report before you read the render.** `depth-report.json` names each
part's relief, scale and clip fraction. A high clip fraction means the declared
numbers do not fit the group's scale; fix the recipe, not the render. Small
units — eyes, mouth, brows, ears — usually look best following the face surface
rather than carrying a sheet of their own: list them under `clear`, or give
them an explicit depth under the group's `unitDepths`. Which depth a unit ends
up using is spelled out in
[Unit depth precedence](AUTHORING.md#unit-depth-precedence).

## What it will not do

- **Depth supplies no unseen drawing.** The rig has one painting. The turn is
  rated for a band around the front view (by default ±15° yaw and ±12° pitch,
  `turn.band`); past it the far cheek and the hidden ear are simply not there.
  A wider turn needs a declared alternate drawing of the face
  (`assemble.alternates`): the build indexes it in `sets.json` with the band's
  threshold, and the player switches to it.
- **It is a projection, not a 3D head.** Points shift in the picture plane by
  their depth; proportions stay the front view's. There is no lighting, no
  silhouette change, no orbit.
- **It does not read depth itself.** No model ships here, and nothing here
  estimates depth or judges a map's quality. The report measures the sheet it
  wrote; whether the shape is right is still your eye's call.
- **It does not fix the input.** A tilted head, a map of the wrong size, a part
  in two islands where normals were asked for — each is warned or refused by
  name, and the remedy is upstream of these commands.

## Where the contract is

- [Per-part provider maps](AUTHORING.md#per-part-provider-maps-897): the recipe
  schema, the map format, the normalisation, the normal integration, and the
  `DEPTH_*` refusal table.
- [Per-layer depth sheets](AUTHORING.md#per-layer-depth-sheets-773): registering
  See-through's own sheets through `config.depth`, and the full surface and
  blended-mesh contract.
- [`turn`](AUTHORING.md#3-configjson-field-by-field) in the config reference:
  roles, dials, the surface grid and its triangle budget, the rated band.
- [Refusals](AUTHORING.md#6-refusals-the-rule-and-what-has-to-change): every
  `FAIL` line ends with `(see rig-parts guide <RULE>)`, and that command prints
  the rule's row.
- For what a turning face can and cannot do with one drawing, rig-c core's
  [face construction guide](https://github.com/rig-c/core/blob/main/docs/FACE.md).
