# rig-parts

**AI-authored 2D character rigs from one anime painting, verified before they
are written.** rig-parts generates no images. The painting and See-through layers
come from models the user runs on their GPU or a web demo; this package ships no
weights. The optional `comfy` adapter drives the user's own ComfyUI host and models.
rig-parts takes a single character painting and the layers
[See-through](https://github.com/shitagaki-lab/see-through) decomposed it into,
merges them into measured rig-space parts, authors weighted meshes, bone chains
and a looping idle over them in [rig-c](https://github.com/rig-c/core)'s
spec, and hands that spec to rig-c to compile, gate, pack, render and check.
It is built for agents that cannot see the image: every stage prints named,
numeric findings, a refusal names the object, the value found and the value
required, nothing is written after a red, and no value is invented where the
input is silent.

## What you get

<p align="center">
  <img src="https://raw.githubusercontent.com/rig-c/parts/main/assets/demo-source.png" alt="The demo painting: a generated full-body character in a white and pink idol dress with a layered skirt and long pink twin tails, standing with her arms held away from her body and her hands open" height="420" />
  <img src="https://raw.githubusercontent.com/rig-c/parts/main/assets/demo-idle.png" alt="The same character rigged, breathing, blinking once and swaying her hair, sleeves and skirt in a 3.3-second loop" height="420" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/rig-c/parts/main/assets/demo-parts.png" alt="Contact sheet of the painting and the 23 assembled parts it was split into: hair, sleeves, legs, boots, neck, skirt, bodice, earrings, hair ornaments, ears, face, brows, mouth and eyes" width="100%" />
</p>

<p align="center"><em>
The painting was generated for this repository with a public checkpoint (Hassaku XL
(Illustrious) v1.3 Style A, by Ikena, Fair AI Public License 1.0-SD) and no LoRA, on a
pose that holds the hands apart, then given one hand-detailer pass; its generation
record, See-through layers and licence are in
<a href="https://github.com/rig-c/examples">rig-c/examples</a>.
See-through ran twice, once on the whole figure and once on a square head crop.
Then one command: <code>rig-parts build --loop --lead-in 3</code>. The proposer's bones, meshes,
regions and motion were used as proposed but for one correction, written in the
config beside the values it replaced: the two outer skirt chains were moved out to
0.8 of the skirt's half-width (the proposal's, within 90 px of the centre of a skirt
449 px wide, swung it about its middle and failed <code>TIP_OVER_ROOT</code>, 0.442
against 1.4725; moved, 2.425). One input-stage edit: <code>hair_back</code> is taken
from the full run, because the twin tails leave the head crop sideways (a plan edit).
<code>check</code> printed, verbatim:<br/>
<code>50 assertions: 24 measured (24 passed, 0 failed), 26 skipped, 0 not in profile "rig-play"</code><br/>
<code>loop: idle 41 frame(s) at 12 fps, f0000 vs f0040 (t = 3.333333333333333s) with the rig's 29 physics constraint(s) left out (named on the `loop physics:` line; rendered with them, the ends need not meet — `build --loop --lead-in &lt;n&gt;`): max |d| 0 (0 required)</code><br/>
<code>seam: setup pose at 654x1216, scale 0.9438: mean |d| 0.147 (&lt;= 1.0), 0 px over 40, 0.00 rig px (the count / s²; &lt;= 50), 0 px over 80 (reported)</code><br/>
<code>pack: skeleton.png 1051x972, 23 region(s), 96.9% covered, padding 2, page edges free, shape polygon</code><br/>
The loop is that build's indexed APNG, 40 frames at 12 fps, 703,909 bytes, one
256-entry palette at a measured error of max 71, mean 0.636 per channel over every
frame (the lossless APNG beside it, the exactness record, is 4,449,233 bytes; the
GIF, at the same error, 760,058). The rig's hair, skirt, sleeves, bows and earrings
carry physics, which rigc's render starts from rest, so the idle is played three
periods ahead and the loop is the fourth: the frame one period after its first differs
from it by max 1 level, 0 px over 40 (<code>--lead-in</code>). Frame 29 (2.417 s) is the
closed eye: the blink holds for 0.084 s, one 12 fps frame rounded up; the painting is
shown at half size, resampled and written by this package's PNG codec (nothing here
encodes JPEG). <code>rig-parts sheet</code> made the contact sheet. Its
<code>expected/</code> is this port's own build (<a href="examples/demo/README.md">examples/demo</a>).
</em></p>

<p align="center"><em>
The hanging element, <code>examples/scarf</code>: Pony Diffusion V6 XL, no LoRA, a very long
red scarf whose ends hang free, and the first character run through this pipeline
with its proposal used unedited — the only hand corrections are four
<code>assemble.patches</code>, each answering an <code>uncovered hole</code> line.
<code>check</code> passes 9 of 9 with every mesh on the lattice and with every mesh
switched to the contour mode. It has no reference output: its <code>expected/</code>
is this port's own build (<a href="examples/scarf/README.md">examples/scarf</a>).
</em></p>

<p align="center"><em>
Two more characters are tracked as fixtures and not shown:
<code>examples/reference-demo</code> and <code>examples/reference-sample</code>, the two
the reference implementation ran (published as <code>demo</code> and <code>sample</code>
until issue #227, which took the clasped-hands painting off display). Their
<code>expected/</code> is that implementation's own output, which the selftest holds
this port to.
</em></p>

## What it takes in

- **One painting** — a PNG of one character that a rig can be cut from: front view,
  arms clear of the body, hands apart and open, legs apart with a gap, on a plain
  light background. [docs/PAINTING.md](docs/PAINTING.md) says what each requirement
  is for and what breaks without it, gives one generation recipe, and describes
  `rig-parts painting`, which checks a painting against its body-18 joints before
  See-through runs. To set up the machine that makes the painting and the layers,
  see [rig-c/getting-started](https://github.com/rig-c/getting-started).
- **Its See-through layers, twice**: one run on the whole figure (the painting padded
  white to a square) and one on a square crop around the head, because the eyes of a
  full-figure run are too small to separate. Either form See-through reaches you in
  is read:
  - the **ComfyUI wrapper form** — a directory holding `layers.json` and one RGBA PNG
    per layer (flat beside the manifest, or under `parts/<tag>.png`);
  - an **upstream `.psd`** — one pixel layer per tag, the layer name being the tag,
    the stacking order being the draw order.
- **A character config** (`config.json`) — the part plan, the head box, the bones,
  which bones may pull which layer, the idle's sines, and optionally `constraints`
  in rig-c's own rig-spec shape (ik, transform, path, physics, slider), handed
  to rigc as written once every bone they name resolves; a scene target is a bone
  under `root` a constraint names. `src/config.ts` is its
  schema and documents every field; the loader refuses an unknown or a missing field
  by name, and reads nothing under `note`, a `<name>_note` (a string) or a key
  beginning `x-` (any JSON — a project's own records, such as a past build's gate
  results). [docs/AUTHORING.md](docs/AUTHORING.md) says where each value comes from.

## What it gives out

`rig-parts build` ends the way a Spine editor export does — with **one packed atlas
page** (issue #2):

| path under `--out` | what |
| --- | --- |
| `check/build/skeleton.json`, `skeleton.atlas`, `skeleton.png` | **the artifact** — Spine 4.3 skeleton data and one packed page, written by `rigc build --pack --page-edges free --pack-shape polygon` and gated under `rig-play` (named `spine-html` before rig-c 2.50.0), which holds every rule `spine` measures (on reference-demo, rigc 2.1.3 and 2.10.1: the 14 rules `validate --profile spine` measures are among the build's 24; 16 are not in `spine`) |
| `parts/*.png`, `parts.json`, `recomposite_rig.png`, `recomposite_error_rig.png` | the loose parts, each cropped to its alpha box; the record of where every part came from, how many of its pixels were re-taken from the painting, and the recomposite's uncovered holes with their boxes; the flat stack of parts; its error map — red where no part covers a pixel the painting has, blue where a part covers it in the wrong colour |
| `rig/` | `rig.json` and `motion.json` in rig-c's spec, `mesh_report.json`, the padded `images/` |
| `check/` | both gate files verbatim, the idle's frames and their `geometry.json` (skinned vertices per frame), `contact.png`, `motion_heat.png`, `check.json` (with `pack_mode`, the `--page-edges` and `--pack-shape` the page was packed under) |
| `idle.png`, `idle-indexed.png`, `idle.gif` | with `--loop`: the idle as a lossless APNG (the exactness record), an indexed APNG with one shared palette (the small one) and a GIF; the last two print their palette error |

The last lines of a green build are the pack line, printed beside the Spine example
export's `spineboy.png` as a yardstick (a reference, not a bar), and the three
artifact paths — here for `examples/reference-sample`:

```
build: PASS — the packed atlas is the artifact; parts/ and rig/ are the intermediates it was made from
  pack: skeleton.png 477x1151, 20 region(s), 95.0% covered, padding 2, page edges free, shape polygon; page opaque 54.8% (alpha > 0) — spineboy yardstick 1024x256, 40 region(s), 45.8% opaque (alpha > 0), a reference and not a bar
  out/check/build/skeleton.json
  out/check/build/skeleton.atlas
  out/check/build/skeleton.png
```

The page's edges are free by default: rigc picks the least-area page the parts need,
not the next power of two. On the two reference examples, packed by rectangles, that is 967x1338
and 479x1166, where a power-of-two page is 1024x2048 and 512x2048, and covered goes from 56.3 % to 91.2 % and
from 49.7 % to 93.4 %. The cost is the one rigc's help states: *"region attachments
sampling within 1 LSB of the loose build rather than exactly"*. Measured on both
examples, every idle frame stays within 1 level of the power-of-two build's. The atlas says
`filter: Linear, Linear` and has no `repeat` line, so `--page-edges pot` is for a
consumer that mipmaps or repeats the page; it writes exactly the page builds wrote
before the flag existed. The measurements are in
[AUTHORING §5, *Page edges*](docs/AUTHORING.md#5-after-each-stage-what-to-read).

The pack shape is `polygon` by default (rig-c 2.1): a region only meshes draw is
packed by its emitted hull, so a neighbour may sit inside its rectangle where the hull
is not; a region attachment stays its rectangle. On the two examples that takes the
free page from 967x1338 to 922x1348 (covered 91.2 % to 95.0 %, 3.9 % less area) and
from 479x1166 to 477x1151 (93.4 % to 95.0 %, 1.7 % less), at the cost class `free`
already has: every idle frame within 1 level of the `rect` build's, and no figure in
`check.json` but `pack_mode` moves. `--pack-shape rect` writes the page and atlas
0.7.0 wrote. The measurements are in
[AUTHORING §5, *Pack shape*](docs/AUTHORING.md#5-after-each-stage-what-to-read).

The packer is rig-c's, and no other: a packed region is a lossless copy, and an
atlas written by anything else would have no oracle behind it.

## Painting → parts → rig → browser

| stage | tool | what it owns |
| --- | --- | --- |
| painting + See-through layers → parts and specs | **rig-parts** (npm `@rig-c/parts`) | the merge of two runs, the measurements, the rig spec and motion spec |
| specs → Spine skeleton data | **[rig-c](https://github.com/rig-c/core)** (npm `rig-c`) | compile, the gate (rigc's own validator in an install; the round trip through `spine-core` where the runtime is beside it, as in this repository's CI), the named assertions, the packer, the renderer |
| skeleton data → a page | **[rig-play](https://github.com/rig-c/play)** (npm `@rig-c/play`; formerly spine-html), a sibling project | a DOM renderer; rigc's `rig-play` profile is its policy, and every build here is gated under that profile as well as under `spine` |

rig-parts never writes Spine data itself. Everything on disk under `check/build/`
was written by rig-c after its own gate passed.

## Getting See-through layers

See-through is required; how you run it is not. rig-parts does not vendor, embed or
redistribute See-through code or weights — run it by any of these and point
rig-parts at what it wrote:

| Route | Where | Output rig-parts reads |
| --- | --- | --- |
| Hugging Face Space | [24yearsold/see-through-demo](https://huggingface.co/spaces/24yearsold/see-through-demo) (ZeroGPU) | the `.psd` it produces; upload `st_input_full.png`, the white-padded square from `inputs`, for the full run, and `st_input_head.png` for the separate head run |
| ModelScope demo | [ljsabc/See-Through](https://modelscope.cn/studios/ljsabc/See-Through), linked from the upstream README | the `.psd` it produces |
| Upstream CLI | `python inference/scripts/inference_psd.py --srcp <image> --save_to_psd` in a checkout of [shitagaki-lab/see-through](https://github.com/shitagaki-lab/see-through) | the `.psd` in `workspace/layerdiff_output/` |
| ComfyUI wrapper | [jtydhr88/ComfyUI-See-through](https://github.com/jtydhr88/ComfyUI-See-through) on your own ComfyUI box; the optional `comfy` adapter (`rig-parts comfy seethrough`) drives it | the `layers.json` + PNGs it writes |

Use the square `inputs` outputs on the Space too. Its [app calls `apply_layerdiff`](https://huggingface.co/spaces/24yearsold/see-through-demo/blob/049a1ab07908e404aad03f73431dd1a98f88202c/app.py#L110-L118),
which [calls `center_square_pad_resize`](https://huggingface.co/spaces/24yearsold/see-through-demo/blob/049a1ab07908e404aad03f73431dd1a98f88202c/common/utils/inference_utils.py#L78-L83).
That [preprocessing function](https://huggingface.co/spaces/24yearsold/see-through-demo/blob/049a1ab07908e404aad03f73431dd1a98f88202c/common/utils/cv.py#L254-L274)
pads a non-square upload before resizing; the centre-crop reported in
[#356](https://github.com/rig-c/parts/issues/356) is not the current source path.
`st_input_full.png` supplies the explicit white padding that rig-parts maps back
to the original painting. This is a source inspection, not a new demo run.

**The head run is needed on every route that was read.** See-through's model
already separates the head in a second stage of its own: it crops the head the
first stage found, runs the face tags on that crop at the same `resolution`, and
pastes the result back **resized to the full image's scale**. So the face comes
back at the full run's pixel density whichever route ran it, and the separate
head run on `st_input_head.png` is what gives the eyes more pixels
(read on 2026-09-28 at see-through `a25a549` and wrapper 0.5.0 `98d754b`):

- *Hugging Face Space* — the same two-stage code, with `resolution` capped at
  1280 (768 by default): the head run is still needed.
- *ModelScope demo* — its code was not read, so what the head run adds on that
  route has not been measured.
- *Upstream CLI* — the `.psd` frame is the `resolution`-sided square the first
  stage ran on (1280 by default), and the head stage is pasted into it at that
  scale: the head run is still needed.
- *ComfyUI wrapper* — `SeeThrough_GenerateLayers` runs both stages with no input
  to change the second, at most `resolution` 2048, which on the examples' 2432 px
  square is 1.19 source px per layer px against 0.77 and 0.47 for their head
  crops; at the 1024 the examples ran, the full run's right eye white is 22×13 px
  and the head run's 60×38: the head run is still needed.

**See-through is required; ComfyUI is not.** The wrapper is one route among
four, and `rig-parts comfy` is only a convenience for that route: every
stage after See-through reads files, whichever route wrote them. On the two
reference examples each run took 171–199 s through the wrapper, and on the demo 179 s (each run's
`meta.json`, in [rig-c/examples](https://github.com/rig-c/examples)).

### The two images See-through is fed: `inputs`

```sh
rig-parts inputs --source painting.png --config config.json --out <dir>
```

cuts the two images See-through is fed: the painting centred on a white square
(`st_input_full.png`) and, when the config sets `seethrough.head_box`, that
box at its exact size (`st_input_head.png`). Pure raster, no GPU.

### The optional ComfyUI adapter

For a user who has a ComfyUI box, two
commands drive it; nothing else in the pipeline needs one:

```sh
rig-parts comfy paint --config config.json --out <dir> --host http://<box>:8188
rig-parts comfy seethrough --image st_input_full.png --out layers/full --host http://<box>:8188
```

`comfy paint` asks the user's models to generate `painting_<seed>.png` from the config's inline
`generation` block — checkpoint, LoRAs, sampler, and an optional OpenPose
control skeleton it draws itself — and records the prompts verbatim beside it.
`comfy seethrough` runs the [ComfyUI-See-through](https://github.com/jtydhr88/ComfyUI-See-through)
wrapper on one image and writes the wrapper form `layers` reads. The host comes
from `--host` or `COMFY_HOST` and has no default; before anything is uploaded
the graph is checked against the box's `/object_info`, so a missing node class
or model is refused by name, and the adapter waits for an empty queue rather
than queueing behind someone else's job.

The painting graph uses `4x-AnimeSharp.pth`, then Lanczos resizing. The
[creator's card](https://huggingface.co/Kim2091/AnimeSharp/blob/7696d95ced82b0c1f2a41f6ac73336133f0a90e1/README.md)
declares CC BY-NC-SA 4.0. When `generation.control` is set, the intended OpenPose
ControlNet is [xinsir/controlnet-openpose-sdxl-1.0](https://huggingface.co/xinsir/controlnet-openpose-sdxl-1.0/blob/23f966cd5cfdd3f7729c903e243d87152162d2b7/README.md),
whose card declares Apache-2.0. Install its `diffusion_pytorch_model.safetensors`
on the host as `controlnet-openpose-sdxl-1.0.safetensors`, or select its installed
filename with `generation.control.model`. A filename alone does not verify the
weights. [NOTICE](NOTICE.md#models-named-by-the-optional-painting-graph) pins the
sources and records their declared terms; those declarations do not assign a
blanket licence to output images. The graph's automatic upscaler selection is
unchanged; the owner decision is tracked separately in [#428](https://github.com/rig-c/parts/issues/428).

`--offload` selects the wrapper's CUDA group-offload path on the **ComfyUI host**:
its [LayerDiff and depth loaders](https://github.com/jtydhr88/ComfyUI-See-through/blob/98d754bf04f668647919ab750eccb0e0640faa81/nodes.py#L395-L475)
call `enable_group_offload('cuda', ...)`. Omit it for a local Mac/MPS host. A Mac
running this CLI may pass it to a remote CUDA host. This describes that offload
path; it is not a claim that the remaining model stack has been verified on MPS.

The [wrapper README at `98d754b`](https://github.com/jtydhr88/ComfyUI-See-through/blob/98d754bf04f668647919ab750eccb0e0640faa81/README.md#L22-L28)
describes a combined Decompose node and names `24yearsold/seethroughv0.0.1_marigold`
for depth. The shipped `workflows/seethrough.json` instead sends
`SeeThrough_GenerateLayers`, `SeeThrough_GenerateDepth` and `SeeThrough_PostProcess`,
and selects `layerdifforg/seethroughv0.0.1_marigold`, matching the wrapper's
[implemented depth default](https://github.com/jtydhr88/ComfyUI-See-through/blob/98d754bf04f668647919ab750eccb0e0640faa81/nodes.py#L82-L85).
Use the graph's node classes and the host's `/object_info` when checking the adapter.

## The loop, for an agent

```sh
rig-parts inputs --source painting.png --config config.json --out inputs   # st_input_full.png; the config needs assemble.rig_scale
#    See-through on st_input_full.png (external, or `rig-parts comfy seethrough`) -> layers/full
rig-parts layers layers/full                      # every layer: box, opaque px, depth, plausibility figures; WARN lines
rig-parts propose --head-box --full layers/full --canvas 1664x2432
#    -> seethrough.head_box into config.json
rig-parts inputs --source painting.png --config config.json --out inputs   # now st_input_head.png too
#    See-through on st_input_head.png (external, or `rig-parts comfy seethrough`) -> layers/head
rig-parts sheet --source painting.png --layers layers/full --layers layers/head --out sheets/layers.png
rig-parts assemble --propose-plan --source painting.png --full layers/full --head layers/head --config config.json
#    -> assemble.plan and extend_below_crop
rig-parts assemble --source painting.png --full layers/full --head layers/head --config config.json --out work
#    -> work/rig: parts.json and parts/; the config holds no bones, meshes, regions or motion yet
#    -> read the `uncovered hole N:` lines and look at work/render/recomposite_error_rig.png:
#       red is painting that no part holds, and no later gate can see it
#    -> a large red hole neither run holds? add an assemble.patches entry (cut from the painting) and assemble again
rig-parts propose --parts work/rig --source painting.png --out work
#    -> proposal.json, basis.json (what each bone rests on) and render/landmarks.png; per-bone coverage lines;
#       correct it, copy bones/meshes/regions/limbs/motion/constraints/turn/proposed_rig_scale into config.json, each it wrote
#       (limbs only with --keypoints, constraints only with --cloth, turn only with --full/--head;
#       a limbs block left out is refused next)
rig-parts propose --parts work/rig --source painting.png --out work --from-config config.json
#    -> LINT lines; exit 1 while any remain
rig-parts build --config config.json --source painting.png --full layers/full --head layers/head --out out --loop
#    -> read out/check/check.json; every FAIL line names what has to change
```

At each step the config holds only what that step reads; the one table of what
that is, step by step, is [docs/AUTHORING.md §4](docs/AUTHORING.md#4-the-command-order).
The command-order controls exercise the hand-copy route above on each fetched
example from a config holding only what the first step reads (`RL01`). The optional
`--write-config` forms below save the proposed fields; `RL01` does not exercise
that flag. On `demo` the
proposal pasted uncorrected stops at the last step, naming its `bottomwear` on
`CHECK_TIP_OVER_ROOT` — the correction its tracked config records there, the two outer
skirt chains moved (issue #227, [its README](examples/demo/README.md)); on `scarf`,
since issue #262, it builds green, and on `wind` too. `wind`'s config declares the cloth
recipe and its limbs, so the block runs on it again with that `cloth` block authored,
`--cloth config.json` on the drafting `propose` line and its tracked `keypoints.json` on both
`propose --parts` lines (`RL05`): it pastes `limbs` and `constraints` with the rest and gives
back the tracked config, section for section ([its README](examples/wind/README.md)).
On `demo`, which tracks the pose file it was painted on, the block runs again with
`--keypoints` on both `propose --parts` lines (`RL03`): the proposal then also drafts
`limbs`, the step's list carries them, and the run ends where `RL01` ends. The joints
are that pose file scaled to the painting, not read off it, so this shows what the
loop carries, not where the joints are. On `wind`, which tracks the joints read off its
painting (`keypoints.json`), `RL03` runs with those. The list as it stood before issue #375, four
sections, stops at `--from-config` naming every limb part (`RL04`).

`propose` is deliberately not a step of `build`: the proposal is a draft to correct
against its overlay, and a config with bones is `build`'s input. `rig`, `check` and
`loop` are the same stages one at a time. [docs/AUTHORING.md](docs/AUTHORING.md) is
the guide an agent authors from — every config field, what to look at after each
stage, what each refusal means and which field it points at — and
[`skills/rig-parts/SKILL.md`](skills/rig-parts/SKILL.md) is the same loop as an
agent skill.

## Commands

| command | does |
| --- | --- |
| `inputs --source <png> --config <json> --out <dir>` | the two images See-through is fed: the painting on a white square, and the head box's crop once the config has one |
| `comfy paint --config --out [--host]` | optional: generate the painting on a ComfyUI box from the config's `generation` block |
| `comfy seethrough --image --out [--host]` | optional: run the ComfyUI See-through wrapper on one image and write the form `layers` reads |
| `layers <dir \| layers.json \| file.psd>` | print every layer of a decomposition: draw order, name, tag group, box, size, opaque pixels, depth, and its translucent, background and area figures; a `WARN` line for a layer `--propose-plan` will leave out |
| `sheet --source <png> --layers <path>… --out <png>` | a labelled contact sheet of the painting and every layer or part |
| `assemble --propose-plan … [--write-config <config>]` | propose `assemble.plan` and `extend_below_crop` from the two runs, leaving out an implausible layer with a note naming the rule, naming in a note any full-run body no planned part covers, and naming every layer no row takes with why (empty, taken from the other run only, a plausibility rule; `nose`, never planned, with the row that lets `propose` read the head's pitch) |
| `assemble --source --full --head --config --out [--seam] [--project]` | merge the two runs into rig-space parts, `parts.json`, the recomposite and its error map, and list the uncovered holes |
| `propose --head-box --full <run> --canvas WxH [--no-back-hair] [--write-config <config>]` | propose `seethrough.head_box` from the full run, held inside the painting; `--no-back-hair` leaves the back-hair layer out of that proposal |
| `propose --parts --source --out [--compare <config>] [--write-config <config> [--only-missing]]` | propose bones, meshes, regions and an idle; draw the overlay; print, per bone, which check read it or that none did and why (its role, its kind of segment), and write `basis.json` beside the proposal — what each bone rests on (a joint, a part's mask, a ratio, other bones) and, with `--compare`, whether the config's bone differs |
| `propose … --keypoints <file> [--person <id>]` | read a posed figure's joints from one explicit file (space, image size, people, each joint observed, occluded or missing, its source): a joint with a position places the neck, hip, chest or a sleeve chain as given, a note says how every joint was used or which rule stood in, and LINT reads the torso and sleeves along the joints instead of by screen y ([AUTHORING §3](docs/AUTHORING.md)) |
| `propose … --grid-rule figure\|part` | how each drafted lattice's spacing is chosen: `figure` (the default) one spacing for the figure, round(H / 37) rig px, a part already coarser keeping its own, with a note on its calibration and cost; `part` the reference's rule, a tenth of the part's short side (the oracle examples are proposed under it) |
| `propose … --from-config <config>` | draw and LINT the config's current bones (by the joints too, given `--keypoints`) |
| `compare --left <file> --right <file> [--map <bonemap.json>]` | compare two skeletons — a config, a proposal or a `rig.json` — bone by bone: origin, parent, tip, length and direction per pair, the bones neither side pairs, the required ones missing, and each side's roles read off the spec; no frame is guessed, and nothing pairs by resemblance (`propose --compare` reads origins only) |
| `rig --config --parts --out [--idle-keys ctl\|direct]` | author `rig.json` + `motion.json`, written only after rig-c's gate is green; each mesh is in the mode its config entry names — `grid` (the lattice, what `propose` writes), `contour` (the traced outline with declared interior points) or `auto` (the contour mesh at alpha 1 and above, reduced and locally refined by rig-c's `reduceMesh` under the author's declared bounds, written only when its motion against the unreduced source on the idle passes the author's `motion` bounds through rig-c's `compareMeshesInMotion`; [AUTHORING §3](docs/AUTHORING.md)); every chain link is turned along its chain and carries its `length`, so a physics constraint added later has a lever, with every offset under it in the turned frame so nothing moves; `--idle-keys` says whether the idle's keys on mesh-driving bones go through `<bone>_ctl` parents (default) or stay on the bones with `invariants.idleDrivesMeshes` declared; the config's `constraints` go to rigc as written, and a two-bone ik over keyed links needs `--idle-keys direct` (on `rig` or `build`) |
| `check --rig --out [--parts] [--source] [--requirements]` | build packed, gated under `rig-play`, render the idle, measure seam, loop and the six judgement lines (mesh texture stretch among them, from the idle's `render --geometry`), and report the recomposite's holes from `parts.json`; on a rig spec with no `parts.json` or no `idle` (a merged rig, issue #77) the gate still runs and every line that needs the missing input says SKIP by name; `--source <painting.png>` adds `SETUP_POSE_VS_SOURCE`, the setup pose against the painting by assemble's recomposite figures; `--requirements <scene.json>` measures what a scene declares of the motion — a contact, a follow fraction, an aim, a joint range, a mesh's stretch, the seam between two parts over the motion — each against the author's own bar, from rig-c's posed frames, one line each, PASS, FAIL or NOT MEASURABLE (AUTHORING §7, *Declared requirements*) |
| `loop --frames <dir> --out <file.gif \| file.png> [--palette]` | encode a rendered idle as a looping GIF, lossless APNG, or indexed APNG (`--palette`) |
| `build --config --source --full --head --out [--seam] [--project] [--loop] [--lead-in <periods>] [--requirements] [--seam-pairs] [--keep-stills] [--idle-keys ctl\|direct]` | assemble, rig and check in one process, stopping at the first refusal; `--requirements`, `--seam-pairs` and `--keep-stills` are forwarded to check, `--idle-keys` to rig; `--lead-in` (with `--loop`) encodes the loop from the last of n + 1 idle periods played back to back, for a rig whose physics does not end where the render starts it |
| `compose --scene <scene.json> --out [--requirements] [--accept]` | bind several characters' green builds into one rig (or, under `--accept`, builds failing only the bars named — for looking, not shipping): every name prefixed `<id>:` under one shared root, each character's offset added at its first-level bones, an optional background plate (its provenance recorded, judged by nothing) drawn first, and the draw order between the characters' slots as the scene file declares it — nothing inferred, nothing scaled; gated through rig-c as `rig` is, then checked ([AUTHORING §7](docs/AUTHORING.md), *Composing several characters*) |
| `guide <RULE \| §<n> \| §<n>.<m> \| §<n>.<m>.<k>>` | print the one row of [docs/AUTHORING.md](docs/AUTHORING.md) that names a rule (a refusal and the bar it enforces, `CHECK_<LINE>` and `<LINE>`, print together), or one section, `###` subsection or `####` under it, read from the installed file when it runs |

`rig-parts --help` has every flag. Exit codes: 0 done, 1 input refused (every
reason is a FAIL line), 2 a usage error or a command this version does not implement.
Every FAIL line ends with `(see rig-parts guide <RULE>)`, the command that prints the
guide's row for that rule, and each row is anchored on the web as
`docs/AUTHORING.md#<RULE>`.

What 1.0.0 holds stable — these commands and their flags, the config
fields, the files a build writes and their spec ids, the environment, and what this
package relies on in rig-c — and what is not, is [docs/STABILITY.md](docs/STABILITY.md).
Coming from 0.16.0: [docs/MIGRATION.md](docs/MIGRATION.md).

`--write-config <config.json>` saves the three proposals above into an existing
regular config file: `seethrough.head_box`, `assemble.plan` plus
`assemble.extend_below_crop`, or the present config sections of an ordinary
proposal. For `assemble --propose-plan`, the destination must name `--config`
itself; a different destination is a usage error. Other fields and absent optional
sections remain; proposal notes are not copied. Changed whole values are spliced
into the original text, preserving untouched bytes. Stage loaders validate the candidate, including `proposed_rig_scale`,
before atomic replacement. Relative paths keep the config's directory as their
base. Changes are listed on stderr; the head-box and plan JSON on stdout remain.
An identical update leaves bytes and mtime untouched. Without the flag no config
is changed. This commits the config file, not a transaction across the proposal
artifacts.

With `--cloth <config.json>`, the flag requires a **new** destination and applies
the recipe's entry ownership: recipe-owned entries are spliced into the cloth
config while hand entries and unrelated text survive; conflicts are refused.
The destination must also be separate from all four artifacts under `--out`:
`proposal.json`, `basis.json`, `render/landmarks.png`, `render/landmarks_head.png`.
Aliases, including directory symlinks and hardlinks, count as collisions too.
Fresh output is published without overwriting a file created while the command
runs. Its already-checked splice text may be a partial config; it is not passed
through the full-config loader. If removing the staged temporary fails after
publication, the error may accompany an already-published complete config.
`--from <previous.json>` retains the previous-recipe comparison.
With `--only-missing` (issue #671), an ordinary proposal's `--write-config` adds
only `meshes.<part>` or `regions.<part>` for each proposed part the config
attaches by neither, entry by entry, and, for a part the 1.37.0 arm split makes
(`full:drape-<s>`, `full:hand-<s>`) that `assemble.plan` does not name, its plan
row beside the arm's row; every existing row and entry and every other byte
stays as read, and nothing else of the proposal is written. The candidate passes
the full loader first, so an entry on a bone the config does not declare is
refused naming the part and the bone; nothing missing leaves bytes and mtime
untouched. It is the upgrade path for a config proposed before the 1.37.0 arm
split ([MIGRATION](docs/MIGRATION.md#after-1370-merged-arm-layers-are-split-issue-490)),
and a usage error with `--head-box`, `--cloth` or `--from-config`.
`--from-config` proposes nothing and cannot be combined with `--write-config`.
[AUTHORING §4](docs/AUTHORING.md#4-the-command-order) describes all four modes.

## What it does not do

These are limits of the approach, stated so nobody reads more into a green run:

- **rig-parts generates no images.** The painting and See-through layers are made
  by models the user runs on their GPU or a web demo. No weights ship here; the
  optional `comfy` adapter drives the user's own ComfyUI host and models.
- **One depth value per layer.** See-through gives each layer a single depth, so a
  layer that is in front of another in one place and behind it in another is drawn
  right in the still (the painting's own pixels are projected onto it) and wrong once
  it moves.
- **No expression or lip-sync, and no jiggle.** The mouth is one layer; there is no
  mouth-shape set and no expression axis, and nothing here proposes, keys or judges a
  soft region. An expression that moves the face's parts, and a jiggle, can be built on
  the rig it writes ([below](#what-can-be-built-on-top)); lip-sync cannot.
- **Occluded pixels are See-through's synthesis**, not the artist's. How much of a rig
  that is, is below.
- **No success rate is claimed.** Ten characters have been measured stage by stage
  against the reference implementation this package ports — the two public examples
  here and eight private ones, one See-through seed each — and all ten check green
  on the gates, the seam and the loop. The judgement lines `check` added since
  (issue #11) have been measured on the three public examples only (the third,
  `scarf`, was made after the port and has no reference output). That is an
  existence proof, not a rate.
- **`loop` writes GIF and APNG (lossless and indexed), not WebP**: an animated WebP needs a VP8/VP8L
  encoder, which this package does not carry.
- **The proposer reads the torso by screen y unless it is told the pose.** Its ratios
  put the hip below `bottomwear`'s top edge and the chest above it, and hang the sleeves
  from the shoulders. A figure whose joints are not there — reclining, an arm raised, or
  seated in a skirt that does not start at the hip — needs `propose --keypoints`; sitting
  alone does not, but a clean LINT does not show the hip is right (it asks only that the
  hip be below the chest and the shoulders), so read the overlay ([AUTHORING §3](docs/AUTHORING.md)). The
  file of joints comes from any pose
  estimator or a hand; this package does not estimate a pose itself, and its
  keypoint support has been measured on generated figures and on files read off the
  examples' own configs, and on one reported estimator output: RTMPose whole-body
  through rtmlib on one painting built green with the estimated file unedited
  ([#356](https://github.com/rig-c/parts/issues/356)). That is one measurement,
  not an estimator success rate; it has not been re-run here.
- **The proposer reads tags, not pictures.** A swinging element painted inside another
  layer (a sash tail in the skirt), hair that is none of the shapes it knows, and
  whether an accessory swings are the corrector's to add. The one accessory shape it
  measures is a hanging strand on a headwear or earwear layer: each gets a pendulum
  chain, and a strand it cannot chain is named in a note rather than left stiff.

### What can be built on top

This package makes no expression and no jiggle, but the rig it writes is the material for
both, and the config has a field for each; `examples/demo` and `examples/scarf` carry a worked
set of each (issue #224: a hop, a head tilt, a wave or a bow, and physics on the hair, the
skirt, the sleeves and the scarf ends; also two head turns, a smile and a startle, which at
full-body size read as small moves of the head and face rather than as expressions —
one image per slot leaves the face only what its bones can do). [docs/AUTHORING.md](docs/AUTHORING.md) has a recipe
for each — a config fragment, the `check` lines it passes with, and its limit:

- [**Expressions and other named animations**](docs/AUTHORING.md#recipe-expressions-and-other-named-animations):
  the face's parts are bones; animations written over them in rig-c's motion-spec shape and
  named by `motion.animations_from` are built and gated beside the idle on every build. Keys
  carry core motion fields, including raw `curve` control points in absolute time/value
  coordinates ([core key format](https://github.com/rig-c/core/blob/main/docs/AUTHORING.md#45-keys--times-values-curves));
  the linked recipe includes a core-gated example. One
  attachment per slot, so a part moves, turns and scales but is never swapped for another
  image; `check` measures the idle alone.
- [**A soft region driven by physics**](docs/AUTHORING.md#recipe-a-soft-region-driven-by-physics)
  (a bust, the hips): a bone the config authors, a contour-mode region that hands it the patch,
  and a `physics` constraint on it; `examples/reference-sample` carries one. Under its slow
  4 s idle the bust moves at most 0.066 rig px and the hips not at all: the spring answers
  faster keys on the body. Its `hop`, a named animation keying only `hip`, moves the
  bust up to 6.702 and the hips up to 4.609 rig px; the region's `band` caps how far a patch may
  go before the texture-stretch ceiling, and `check` measures the idle alone.

### How much of a rig the model painted

`parts.json` splits each part's opaque pixels (`opaque_px`) into `visible_px` — no
later layer of its See-through run is opaque in front of them — and `occluded_px`,
and counts the visible ones whose colour was not taken from the painting
(`visible_not_projected_px`). On the four examples, from the totals of their
`expected/parts.json` (the default `--project core`; `scarf`'s painting patches are
whole painting pixels, so they count as taken):

| | opaque px | occluded | visible, not projected | taken from the painting |
| --- | --- | --- | --- | --- |
| `demo` | 362,441 | 69,098 (19.1 %) | 67,164 (18.5 %) | 226,179 (62.4 %) |
| `scarf` | 283,813 | 78,503 (27.7 %) | 56,699 (20.0 %) | 148,611 (52.4 %) |
| `reference-sample` | 298,363 | 79,122 (26.5 %) | 35,979 (12.1 %) | 183,262 (61.4 %) |
| `reference-demo` | 765,924 | 202,343 (26.4 %) | 75,626 (9.9 %) | 487,955 (63.7 %) |

The occluded share is art the painting does not show — a back-hair layer, a neck, the
parts of an ear under the hair — and is See-through's synthesis by necessity; it is
what the decomposition is for. The visible-but-not-projected share is synthesis where
the painting was there to be taken: a part too thin for the reference rule's 5x5
eroded core, an anti-aliased fringe below alpha 250, a rim beside a layer in front, a
pixel refused for drift. `--project visible` keeps the erosion only along a rim with a
layer in front, which takes that share to 22,476 (7.5 %) on `reference-sample` and 49,672 (6.5 %)
on `reference-demo` (from the `parts.json` of a `--project visible` build). On the eleven thin
head parts — brows, lashes, irises, eye whites, ears, mouth — it takes 296 of
`reference-sample`'s 1,289 visible pixels where `core` takes 110, and 824 of `reference-demo`'s 2,162
where `core` takes 343. What neither rule takes is the fringe: a per-pixel
classification of those parts under `visible`, recorded with the change that added
the flag, puts 813 of `reference-sample`'s 993 still-unprojected pixels and 879 of `reference-demo`'s
1,338 below alpha 250. Where such a fringe keeps the stack off the painting and a part
beneath holds the pixel in the painting's colour, `assemble` clears it instead, and
the assemble line and `parts.json` say how many pixels, of which part, over which
(AUTHORING §5, *The fringe push-back*; the figures in this section were measured
before it, at v0.14.0, but for the `demo` row, which is its `expected/parts.json`
as this port wrote it in issue #227).

## Requirements

[Bun](https://bun.sh) 1.2 or later. `npm i -D @rig-c/parts` installs the
`rig-parts` command (`npm install -g @rig-c/parts` puts it on `PATH`); it hands off
to Bun and says so in one sentence if Bun is not on `PATH`. **`@rig-c/parts` is the
package's name; versions 1.0.0-rc.1 to 1.5.3 were published as `rig-parts`, and
versions up to 0.16.0
as `spine-parts`, its former name**, and the install keeps a `spine-parts` command
beside `rig-parts` for the transition, the same launcher under both names. On npm
both former names stay published beside `@rig-c/parts` at every version, as aliases
carrying the same files with only the `name` in `package.json` changed, so a
project that depends on either keeps receiving every release; a new
install names `@rig-c/parts` ([RELEASING.md](RELEASING.md), *The registry side*). rig-c
comes with it as a dependency. No Spine runtime does: since
rig-c 2.0 the installed `rigc` gates every build with its own validator over the
compiled model document, and `rigc --version` says `entry: cli_core.ts —
@esotericsoftware/spine-core absent`. With `@esotericsoftware/spine-core` installed
beside it, the same `rigc` runs the spine-core round trip instead, as this repository's
selftest and CI do; `check.json`'s `rigc_entry` records which one gated a build.

## Licence posture

rig-parts is MIT. It writes rig-c's input, and rig-c writes Spine skeleton data. If a
product integrates a Spine Runtime to play that data, the integration is under Esoteric
Software's Spine Runtimes License: permitted under Section 2 of the Spine Editor License
Agreement, or otherwise on the condition that each user of the product obtains their own
Spine Editor license. What those terms turn on is the integration, as rig-c's
[NOTICE.md](https://github.com/rig-c/core/blob/main/NOTICE.md) states it, not the data as
a file. Neither package installs `spine-core`; this repository uses it in development,
for the round trip in its selftest and CI. [NOTICE.md](NOTICE.md) records that chain and every other
third-party term this package touches, See-through's included.

## Development

```sh
bun install
bun run typecheck        # tsc --noEmit, strict
bun run lint             # one rule: no explicit any
bun run fetch-examples   # the public examples' paintings and layers, into examples/*/inputs (needs a network); each file held to its blob id at the pinned commit, a stale one replaced by name
bun run selftest         # every gate's controls; with the examples fetched, build on each of them against its expected/
bun run selftest -- --summary-json summary.json  # also write rig-selftest-summary/1 (per-suite PASS/FAIL/SKIP counts, holes, partial flag and exit)
bun run smoke            # pack, install into an empty directory, run from the install (needs a network)
```

`bun run selftest -- --summary-json <file>` writes a machine-readable summary (`spec: "rig-selftest-summary/1"`, `tool: "rig-parts"`) derived from the same `RunTally` that prints the console summary: `exit` (`0 | 1 | 2`), `partial` (`boolean`), `only` (`string[] | null`), `faults`, `totals` (`suites`, `ran`, `skipped_suites`, `controls`, `passed`, `failed`, `skipped`, `holes`), per-suite `suites` entries (`suite`, `ran`, `controls`, `passed`, `failed`, `skipped`, `status`, `reason`), `skips` (`{ suite, name, reason, hole }`), and `holes` (`{ suite, name, reason }`). See [AUTHORING §8](docs/AUTHORING.md#machine-readable-selftest-summary---summary-json-issue-725) for the full shape.

The generated `foot-ownership` suite can be run alone with
`bun run selftest -- --only foot-ownership` (exit 2 means a green partial run,
not a full-tree verdict). Issue #638's revised acceptance requires zero foreign-leg
components and reports historical own-cap components separately; it was changed
after measurement, and the historical case did not pass the original second-island
1% bar. Issue #637 additionally preserves assigned own-cap connections under covers:
the generated default is now one connected component, retaining the historical
own-cap pixels and their bridge. The controls require both historical measurements
and current connected ownership, with no foreign-leg pixels.
[AUTHORING's limb section](docs/AUTHORING.md#limbs-cut-at-their-joints-limbs-issue-349)
records the generated default-cap case and its preservation controls.

[CLAUDE.md](CLAUDE.md) is the doctrine, [CONTRIBUTING.md](CONTRIBUTING.md) the
practice, [RELEASING.md](RELEASING.md) the cut, [docs/STABILITY.md](docs/STABILITY.md)
the interface it holds.

## Licence

MIT — see [LICENSE](LICENSE). Third-party terms: [NOTICE.md](NOTICE.md).
