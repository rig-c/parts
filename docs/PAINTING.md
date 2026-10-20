# The painting: what makes one riggable

rig-parts starts from one painting of one character. Making that painting is
yours — on your own GPU, with any generator, or by hand — and this package runs
no model. But a painting the pipeline cannot rig fails late: a sleeve layer that
holds the torso, a leg chain that drags the other leg, a dance clip that tears.
This page lists what the painting must be, why the pipeline needs each thing, and
what breaks without it; gives one generation recipe that passes the check, and what it measured; says how
to paint alternate art for a limb; and describes `rig-parts painting`, the check
that reads the painting before See-through runs on it.

There are two ways in:

- **A generated painting**, decomposed by [See-through](https://github.com/shitagaki-lab/see-through)
  into layers. Everything below is about this route.
- **An artist's own layered file** (a PSD, one layer per part): [AUTHORING §4,
  *For artists*](AUTHORING.md#for-artists-your-own-layered-file-issue-359) and
  *The correction loop*. The requirements below still hold for the figure — a
  limb the artist draws against the body is as hard to move — but there is no
  See-through step to fail, and an artist can paint what a joint hides as a
  `<layer>:hidden` layer.

For the environment that makes a painting (an NVIDIA GPU, an Apple Silicon Mac, or
none), see [rig-c/getting-started](https://github.com/rig-c/getting-started).

## The requirements

Each requirement says what the pipeline needs, what fails without it, and whether
`rig-parts painting` reads it (and under which rule) or only an eye can.

| requirement | why the pipeline needs it | what fails without it | read by |
| --- | --- | --- | --- |
| **Front view** | the proposer and the keypoint file read the subject's right on the image's left of a figure facing the viewer, and the eyes, the blink and the head turn are drafted from a face toward the viewer | a back view has no face part for `propose` to draft from (`PROPOSE_FACE_PRESENT`, or the face-less fallback its first note names) | an eye |
| **Full body, inside the frame** — hair and ribbons too | the figure's height is the proposer's yardstick, and the feet carry the leg chain's last link | a cropped foot is a leg with no ankle; a figure touching the edge reads as background that is not plain. Long hair and trailing ribbons are figure: where they reach the edge they fail the border, and where they curl round the figure into a ring they close off the background between the arms and the body (*What the recipe measured*, below) | `PAINTING_BACKGROUND_PLAIN`; a ring, `PAINTING_ARM_CLEAR` and `PAINTING_HANDS_APART` |
| **Arms clear of the body** (an A-pose: arms down and out, a gap under each arm) | See-through separates what it can see; an arm with background round it becomes its own `handwear` and sleeve layers | an arm painted against the side is cut into a layer that holds part of the torso, and no rotation of its bone can swing it clear without dragging the torso's pixels | `PAINTING_ARM_CLEAR`: a gap on the line from each wrist to the hip of its side |
| **Hands apart and open** | each hand is a part on its own arm's chain; open fingers read as a hand at a thumbnail | clasped or touching hands are one `handwear` layer, split only by an `assemble.cuts` polygon drawn by hand; and the clasped hands the README showed until issue #227 did not read as hands above a thumbnail (`examples/demo/README.md`) | `PAINTING_HANDS_APART`: a gap on the line between the wrists. Hands that meet close a loop of arms round the torso, so both arms are refused with them |
| **Legs apart, with a visible gap** | the leg chain needs the legs painted apart (two legs that touch are one column See-through cannot split), and limbs are cut at their joints (#349, AUTHORING §3, *Limbs*), so each knee must be its own | legs that touch at the knee or the ankle come back as one `legwear` silhouette, a cut at the knee takes the other leg's pixels, and a step drags both | `PAINTING_LEGS_APART`: a gap on the line between the knees and on the line between the ankles |
| **Feet facing front** | a foot seen from the front stays inside its leg's column, below the ankle the leg chain ends at | not measured in this repository; read the leg parts on the `sheet` | an eye (body-18 has no foot points) |
| **A plain light background** | See-through and `assemble` read near-white as background (every channel above 235, the one test the assemble rim and the layer plausibility figures share) | scenery, a floor, a cast shadow, a gradient or a vignette is read as more figure — a layer of haze (`PLAN_LAYER_BACKGROUND`), or pixels that belong to no part | `PAINTING_BACKGROUND_PLAIN`: every border pixel near-white or unpainted |
| **Nothing held, no prop across a limb** | each part rides one bone; a prop belongs to no tag See-through knows | a held object joins the hands (`PAINTING_HANDS_APART`) or lands in a hand or garment layer and moves with the wrong bone | partly: a prop that joins the hands is `PAINTING_HANDS_APART`; anything else, an eye |
| **Clothing that leaves the joints unoccluded** | limbs are cut at the elbow and the knee (#349); each lower part carries a cap painted from what the joint hides | long sleeves and tights are fine; a cape over the elbows, a wide skirt over the knees or a forearm in front of the skirt's flare puts two parts' pixels on one joint. `assemble` names the missing cap pixels in its `limb cap:` lines | partly: a skirt over the knees is `PAINTING_LEGS_APART`, a forearm across a skirt is `PAINTING_ARM_CLEAR`; anything on an elbow — a cape, a sleeve's frill, a bow — an eye (no rule reads the elbow; *What the recipe measured*) |
| **Resolution and aspect** | See-through runs on a square (`inputs` pads the painting white to a square of its longer side) at `seethrough.resolution` (1024 by default), and a second run on a crop round the head, because the eyes of a full-figure run are too small to separate. A standing figure is taller than wide; `comfy paint` writes twice its latent (832x1216 → 1664x2432) | a landscape painting is padded above and below and spends See-through's square on white; a small painting leaves the head crop too few pixels for the eyes | an eye; `inputs` refuses a translucent painting (`INPUTS_PAINTING_OPAQUE`) and a head box off it |

**One painting, one character.** The keypoint file may hold several people, and
`--person` names the one checked; the pipeline rigs one.

## The check: `rig-parts painting`

```
rig-parts painting --keypoints <keypoints.json> [--person <id>] <painting.png>
```

It runs on the CPU, before See-through, on the painting and its body-18 joints:
the same keypoint file `propose --keypoints` reads (AUTHORING §3, *A posed
figure*), from any estimator or written by hand, measured on this painting (its
`width` and `height` are the painting's, `KEYPOINTS_IMAGE_SIZE`). It writes
nothing. It prints the figure, every joint and every gap with its count, then
`PASS` and exit 0, or a `FAIL` line per refusal and exit 1. Each `FAIL` line ends
with `(see rig-parts guide <RULE>)`, which prints the rule's row in
[AUTHORING §6](AUTHORING.md#6-refusals-the-rule-and-what-has-to-change).

**DWPose on a faceless figure** (issue #578). Measured on eight seeds of one
frontal, faceless wooden-mannequin painting (SDXL base 1.0, legs apart,
1664x2432), DWPose `dw-ll_ucoco_384` through ComfyUI's DWPreprocessor at
resolution 1024, it did three things a keypoint file must not keep:

- **It may find no person.** With its default bbox detector (`yolox_l.onnx`) it
  returned no person on 8 of the 8 seeds; with `bbox_detector` None it returned
  one on 8 of 8. Run it with `bbox_detector` None.
- **It may read the figure from behind.** With `bbox_detector` None the sides came
  back mirrored on 7 of the 8: `r_shoulder` image-right of `l_shoulder` (on one
  seed x 978 against 697) and `r_hip` image-right of `l_hip` (907 against 753).
  The keypoint file's `r` / `l` are the subject's sides, so on a figure facing the
  viewer `r_shoulder` is on the image's left (`src/keypoints.ts`, AUTHORING §3).
  Check that `r_shoulder` lies image-left of `l_shoulder` and `r_hip` image-left of
  `l_hip`, and swap each `r_` / `l_` pair of a file where they do not.
- **Its hips may sit on the pelvis.** On that seed, after the swap, the hips were
  at painting y 1117.0 and 1113.1 and the hip domes at y 1246 — 129 and 133
  painting px lower (64.5 and 66.5 rig px at an `assemble.rig_scale` of 0.5). The shoulders
  landed on the torso's edge (x 697.4 and 978.5) rather than on the balls (652 and
  1010). Move the hips and the shoulders onto the joints before `propose`.

What it reads, each a definition with no tuned number:

- **Ground** — a pixel the package already calls background: alpha 8 or less
  (unpainted, the layer reader's cut), or every colour channel above 235
  (near-white, the assemble stage's and the plausibility figures' test).
- **Background** — the ground that reaches the edge: ground 4-connected to ground
  on the border. A white blouse inside its line art is ground but not background,
  so it is figure.
- **Figure** — everything that is not background.
- **A gap** between two joints — at least one background pixel on the straight
  line between them, sampled once per pixel the line crosses.

The rules: `PAINTING_BACKGROUND_PLAIN` (every border pixel is ground),
`PAINTING_JOINTS_STATED` (the wrists, knees and ankles are `observed` with a
position; a hip is `observed` or `occluded` with a position),
`PAINTING_JOINT_ON_FIGURE` (every observed joint's pixel, and every occluded hip's,
is figure), `PAINTING_ARM_CLEAR`, `PAINTING_HANDS_APART` and `PAINTING_LEGS_APART`
(the gaps in the table above).

**An occluded hip** (issue #372). A skirt hides the hips on most clothed figures —
on every one of the 24 paintings behind the recipe below — and `occluded` with a
position is how the keypoint file says so: the joint is where its producer
estimated it, and the painting does not show it. The check reads an occluded hip
when the arm's gap read from it is **well defined**, which it decides from what it
reads:

- the hip **carries a position**. The keypoint reader already holds every position
  inside the image (`KEYPOINTS_POSITION_INSIDE`), so every sample of the line from
  the wrist to the hip is a pixel of the painting;
- that position's pixel **is figure** (`PAINTING_JOINT_ON_FIGURE`, which reads an
  occluded hip as it reads an observed joint). An estimate placed on the background
  would put a background pixel at the end of the arm's own line, and the arm would
  pass on the estimate rather than on the painting.

A hip with no position is still refused (`PAINTING_JOINTS_STATED`): it gives the arm
rule no line to read. Only the hips: an occluded wrist is a hand the painting does
not show, and an occluded knee or ankle is a leg whose gap cannot be read. The
joints line counts occluded hips apart (`joints: 16 observed, 2 occluded with a
position (r_hip, l_hip), 18 on the figure`), and an arm's gap line says when it was
read from one.

What it does not read: a front view (a file with every `r_` / `l_` pair swapped
draws the same lines between the same points — the two arm lines trade names, the
hands, knees and ankles lines run between the same two joints — so it reads as the
unswapped file does: on the selftest's painting fixture both print the same counts
and `PASS`), the feet, a prop that does not join the hands, anything on an elbow (a
cape, a sleeve's frill, a bow), the hands' fingers,
the face. A green `painting` says
the joints and the silhouette hold the requirements it reads, not that the
painting is good. A shadow or a floor enclosed by the background is figure to it;
the border rule sees it only where it reaches the edge.

## A recipe that is one way, not the only way

Anyone with a different generator reads the requirements above, not this. This is
one way that passes `painting`: the `generation` block and the pose file of seed
372108, painted by `rig-parts comfy paint` for issue #372 as one of 24 candidates,
and chosen to be the next public example — a character for a wind demo, where hair
and cloth move by physics under a side gust. It is the public example `wind`: its
painting, See-through layers and generation record are in
[parts-examples](https://github.com/rig-c/parts-examples) (`wind/`), and its config,
proposal and build are [`examples/wind`](../examples/wind/README.md). The block:

```json
"generation": {
  "checkpoint": "hassakuXLIllustrious_v13StyleA.safetensors",
  "loras": [],
  "trigger": "",
  "identity": "1girl, solo, adult woman, very long twin tails reaching the knees, deep blue hair, amber eyes, large red hair ribbons with long trailing ends",
  "sampler": { "steps": 30, "cfg": 6.0, "sampler": "euler_ancestral", "scheduler": "normal" },
  "costume": "white blouse with long fitted sleeves, red ribbon bow at the collar with long trailing ribbon ends, very wide flared tiered skirt, three ruffled layers, petticoat, skirt above the knees, knees visible, white thighhighs, red ankle boots, fully clothed, empty hands",
  "negative_extra": "revealing clothes, bare shoulders, off shoulder, 2girls, multiple girls, holding, bag, weapon, clouds, cloud, sun, sky, sky background, grey background, blue background, gradient background, scenery, outdoors, from behind, back view, back of head, facing away, vignette, beige background, brown background, dark background, black background, spotlight, lighting gradient, flat color, cel shading, monochrome, lineart, long skirt, knee-length skirt, cape, legs together, knees together, crossed legs, hands on skirt, holding skirt, wide sleeves",
  "pose": "full body, head to toe, entire body in frame, front view, facing viewer, looking at viewer, standing, legs apart, arms spread away from body, arms out to the sides, hands apart away from skirt, open hands, spread fingers, relaxed pose, gentle smile, feet visible, feet facing forward, shoes",
  "style": "anime illustration, detailed, soft shading, (white background:1.3), simple background, plain background",
  "negative_pose": "cropped, out of frame, cut off feet, close-up, portrait, upper body, from side, profile, sitting, kneeling, dynamic pose, arms raised, hand on face, contact shadow, cast shadow, floor, multiple views, reference sheet",
  "latent": [832, 1216],
  "seed": 372108,
  "control": { "skeleton": "pose.json", "strength": 0.8, "end_percent": 0.7 }
}
```

and the pose file it names, `pose.json` (OpenPose body-18 points on the 832x1216
latent canvas, x right, y down):

```json
{
  "width": 832,
  "height": 1216,
  "points": {
    "nose": [416, 176],
    "neck": [416, 252],
    "r_shoulder": [340, 272],
    "r_elbow": [258, 418],
    "r_wrist": [168, 540],
    "l_shoulder": [492, 272],
    "l_elbow": [574, 418],
    "l_wrist": [664, 540],
    "r_hip": [374, 612],
    "r_knee": [352, 862],
    "r_ankle": [326, 1100],
    "l_hip": [458, 612],
    "l_knee": [480, 862],
    "l_ankle": [506, 1100],
    "r_eye": [398, 160],
    "l_eye": [434, 160],
    "r_ear": [378, 170],
    "l_ear": [454, 170]
  }
}
```

**What `comfy paint` adds.** The prompt the sampler reads is not only the block's
words. `comfy paint` puts a fixed head in front of each side (`POSITIVE_HEAD` and
`NEGATIVE_HEAD` in `src/graphs.ts`, the reference implementation's, verbatim) — on
this Illustrious checkpoint as on the Pony one, where its `score_*` words come
from. A reader copying this recipe to another generator copies these too, or
knows they are left out:

- positive head: `score_9, score_8_up, score_7_up, source_anime, masterpiece, best quality, highly detailed`
- negative head: `score_4, score_3, score_2, score_1, worst quality, low quality, lowres, blurry, jpeg artifacts, nsfw, nude, naked, cleavage, underwear, sexual, suggestive, child, loli, shota, kid, toddler, text, watermark, signature, logo, bad anatomy, bad hands, extra fingers, deformed, mutated`

The positive is then the head, `trigger`, `identity`, `costume`, `pose` and
`style`, joined with `, `; the negative is the head, `negative_extra` and
`negative_pose`. The two strings seed 372108 was sampled with, as `comfy paint`
recorded them beside the painting:

```
positive: score_9, score_8_up, score_7_up, source_anime, masterpiece, best quality, highly detailed, 1girl, solo, adult woman, very long twin tails reaching the knees, deep blue hair, amber eyes, large red hair ribbons with long trailing ends, white blouse with long fitted sleeves, red ribbon bow at the collar with long trailing ribbon ends, very wide flared tiered skirt, three ruffled layers, petticoat, skirt above the knees, knees visible, white thighhighs, red ankle boots, fully clothed, empty hands, full body, head to toe, entire body in frame, front view, facing viewer, looking at viewer, standing, legs apart, arms spread away from body, arms out to the sides, hands apart away from skirt, open hands, spread fingers, relaxed pose, gentle smile, feet visible, feet facing forward, shoes, anime illustration, detailed, soft shading, (white background:1.3), simple background, plain background
negative: score_4, score_3, score_2, score_1, worst quality, low quality, lowres, blurry, jpeg artifacts, nsfw, nude, naked, cleavage, underwear, sexual, suggestive, child, loli, shota, kid, toddler, text, watermark, signature, logo, bad anatomy, bad hands, extra fingers, deformed, mutated, revealing clothes, bare shoulders, off shoulder, 2girls, multiple girls, holding, bag, weapon, clouds, cloud, sun, sky, sky background, grey background, blue background, gradient background, scenery, outdoors, from behind, back view, back of head, facing away, vignette, beige background, brown background, dark background, black background, spotlight, lighting gradient, flat color, cel shading, monochrome, lineart, long skirt, knee-length skirt, cape, legs together, knees together, crossed legs, hands on skirt, holding skirt, wide sleeves, cropped, out of frame, cut off feet, close-up, portrait, upper body, from side, profile, sitting, kneeling, dynamic pose, arms raised, hand on face, contact shadow, cast shadow, floor, multiple views, reference sheet
```

**What `painting` read on it**, with the wrists, knees and ankles read by eye on the
painting at full size (on a 50 px grid) and the hips — under the skirt — at the pose
file's hips x2. Written `observed`, as the check required until this change (the
two paths shortened):

```
rig-parts painting: painting_372108.png, joints from kp/eye_372108.json person "a" (source: read by eye from the painting at full resolution on a 50 px grid (wrists, knees, ankles); hips under the skirt taken from the pose file x2; head and shoulders from the pose file x2 (not read by the check))
  painting 1664x2432: background 2558081 px, figure 1488767 px; border 8188 px, 0 not background-coloured
  joints: 18 observed, 18 on the figure
  gap right arm (r_wrist to r_hip): 60 of 429 sampled pixels are background
  gap left arm (l_wrist to l_hip): 76 of 415 sampled pixels are background
  gap hands (r_wrist to l_wrist): 157 of 1011 sampled pixels are background
  gap knees (r_knee to l_knee): 137 of 261 sampled pixels are background
  gap ankles (r_ankle to l_ankle): 248 of 351 sampled pixels are background
  PASS  the painting holds every requirement this check reads (docs/PAINTING.md); what only an eye reads is listed there
```

The same file with the two hips `occluded` (their honest state, read since this
change; *An occluded hip*, above) reads the same five gaps:

```
  painting 1664x2432: background 2558081 px, figure 1488767 px; border 8188 px, 0 not background-coloured
  joints: 16 observed, 2 occluded with a position (r_hip, l_hip), 18 on the figure
  gap right arm (r_wrist to r_hip): 60 of 429 sampled pixels are background (r_hip occluded, read at its position)
  gap left arm (l_wrist to l_hip): 76 of 415 sampled pixels are background (l_hip occluded, read at its position)
  gap hands (r_wrist to l_wrist): 157 of 1011 sampled pixels are background
  gap knees (r_knee to l_knee): 137 of 261 sampled pixels are background
  gap ankles (r_ankle to l_ankle): 248 of 351 sampled pixels are background
  PASS  the painting holds every requirement this check reads (docs/PAINTING.md); what only an eye reads is listed there
```

What each part does:

- **The checkpoint** is public: [Hassaku XL (Illustrious)](https://civitai.com/models/140272)
  v1.3 Style A, no LoRA. `scarf` and the two reference examples used
  [Pony Diffusion V6 XL](https://civitai.com/models/257749) with the same sampler.
- **The control skeleton** is what holds the pose; a pose asked for in words
  alone is one the sampler is free to ignore (`src/skeleton.ts`). `comfy paint`
  draws the pose file as OpenPose body-18 in the annotator's own style and applies
  it through `controlnet-openpose-sdxl-1.0` at strength 0.8, ending at 0.7 of the
  steps. A pose file carries no words, so `generation.pose` is required beside it.
  This one is the public `demo`'s pose file (`examples/demo/pose.json`) with the
  head, neck and shoulders unchanged and the limbs moved, latent px:

  | joint | `demo` | this recipe |
  | --- | --- | --- |
  | wrists | (206, 590), (626, 590) | (168, 540), (664, 540) — 72 px above the hips' line, 206 px out from each hip |
  | elbows | (282, 440), (550, 440) | (258, 418), (574, 418) |
  | hips | (378, 612), (454, 612) | (374, 612), (458, 612) |
  | knees | (384, 862), (448, 862) — 64 px apart | (352, 862), (480, 862) — 128 px apart |
  | ankles | (388, 1100), (444, 1100) — 56 px apart | (326, 1100), (506, 1100) — 180 px apart |

  The paintings followed it: on the seven candidates whose joints were read by
  eye, every wrist, knee and ankle lies within 38 painting px (in x or in y) of the
  pose file's x2. On this one the eye read the wrists at (320, 1080) and
  (1330, 1080), the knees at (700, 1720) and (960, 1720), and the ankles at
  (655, 2190) and (1005, 2190).
- **The pose words** repeat what the skeleton asks — legs apart, arms out, hands
  apart and open, feet forward — and the **negatives** refuse what breaks a rig: a
  held object, a background that is not plain, a back or side view, a crop, a cast
  shadow or a floor, and what closes the legs or covers them (`long skirt`,
  `knee-length skirt`, `cape`, `legs together`, `knees together`, `crossed legs`).
- **The seed** is chosen by looking and by `painting`: generate several, run the
  check on each, then read what it cannot (below). This one was chosen over the
  others that passed because its ribbons wrap the twin tails (free ribbon arcs
  become the rest shape a physics constraint swings from), its hair hangs at rest
  (a candidate painted with its tails already swept out was a blown rest shape),
  it has the widest two-layer skirt (the largest wind surface), and its tails
  hang behind the figure, so they come out under a side gust. Two other passing
  candidates were set aside because they read as a well-known existing character.

## What the recipe measured

24 paintings, seeds 372001-372008, 372101-372108 and 372201-372208, on the pose
file above under three wordings of the hair and the skirt (the block above is the
second; the first asked for twin tails "reaching the thighs" and a "wide flared
layered ruffled miniskirt", the third added "layered skirt"). Screened with
`painting` on the pose file's joints x2 — a screen, not a reading: a pose-file
joint can land off the limb, which three did (`PAINTING_JOINT_ON_FIGURE`, on a
wrist or an ankle), and the seven best were then read by eye. On that screen:

- **Spreading the knees and the ankles in the pose file holds a gap.** The knee
  gap held in 23 of 24 paintings and the ankle gap in 24 of 24, on Hassaku XL
  v1.3 Style A. The one knee miss painted an overskirt down to the shins, which
  joins the legs whatever the skeleton says. On the `demo` painting, painted from
  knees 64 and ankles 56 latent px apart, `painting` refuses both.
- **What clears `PAINTING_ARM_CLEAR` is the wrists' height above the skirt's
  flare, not a narrow skirt.** With the wrists 72 latent px above the hips' line
  (the `demo`'s are 22), both arm gaps held in 23 of 24 paintings, the widest
  skirts among them: this recipe's two-layer skirt, at 60 and 76 background px on
  the eye-read arm lines, and a three-tier ruffled skirt at 59 and 74. The one miss
  is the hair ring below. On the `demo` painting the forearms hang across the
  flare and both arms are refused.
- **Long hair and ribbons that reach the frame fail the border.** 6 of the 9
  refusals were `PAINTING_BACKGROUND_PLAIN`: twin tails or a ribbon's trailing
  end painted out to the edge: 1 of 8 under the first wording (tails "reaching the
  thighs"), 5 of 16 under the other two (tails "reaching the knees", "large red
  hair ribbons with long trailing ends") — counts, not a rate any other prompt will
  repeat. One of the six
  also curled its hair round the figure into a ring: the white between the arms
  and the body was no longer connected to the edge, so it was not background, and
  both arms and the hands were refused with the border (`PAINTING_ARM_CLEAR` x2,
  `PAINTING_HANDS_APART`). The remedy, **untested here**: leave a margin round
  where the hair falls — the pose file decides where the figure sits, and this
  one puts the wrists 168 latent px from each side — and ask for hair no longer
  than the frame holds; `painting` says whether a seed kept it inside.
- **`painting` cannot see the elbow.** Body-18 has an elbow point, but no rule reads
  it, and 3 of the 7 best candidates passed with something on it: two with short
  puff sleeves whose frilled cuff ends on the elbow, one with ribbons tied in
  bows at the elbows. The costume's "long fitted sleeves" did not prevent either.
  It is an eye check: look at each elbow at full size before See-through runs.
  Prompt advice, **untested here**: add `puffy sleeves, short sleeves, puff
  sleeves, elbow ribbon, ribbon on arm` to `negative_extra`.

## Alternate art for a limb

A rig plays its base art in every pose; where a limb turns somewhere the base art
cannot follow (behind the head, toward the camera), the mesh folds.
[rig-c/pose#6](https://github.com/rig-c/pose/issues/6) lets `rig-pose retarget`
switch to an alternate drawing of the limb for those spans, and its report's
`uncovered` list names every fold no alternate covers — that list is the answer
to *which* angles to paint.

To paint one without the character drifting, repaint only the limb:

1. **Start from the base painting**, not from a new generation: the face, the
   costume and the colours stay the base painting's pixels.
2. **Inpaint with a mask along the old and the new limb**: the region the limb
   leaves and the region it moves into, from the shoulder (or hip) down. Keep the
   face out of the mask.
3. **Use the key skeleton as the control**: the body-18 pose the alternate depicts,
   in the painting's space — the same skeleton the pose map's `alternates` entry
   records — drawn the way `comfy paint` draws a pose file.
4. **Run See-through on the result and take the limb's layers** (the sleeve, the
   hand); the rest of that run is discarded. The base rig's other parts stay the
   base painting's.

`comfy paint` does not run an inpainting graph; the demo's hand-detailer pass is
the same idea at hand scale (a masked repaint on the same checkpoint, recorded
beside its painting in parts-examples).
