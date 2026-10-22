# Third-party notices

rig-parts' own code is MIT (see `LICENSE`). It depends on, reads the output
of, or reimplements the behaviour of the third-party work below, each under its
own terms. Naming a project here identifies where something comes from; it does
not imply that its authors endorse rig-parts.

Every statement below is either quoted from the named source or marked
**[observed]** with the date and the place it was read. Upstream terms can
change; check the source when it matters.

## 1. See-through

rig-parts takes See-through's output as its input. **rig-parts does not
vendor, embed or redistribute See-through code or weights**: the user runs
See-through by one of the routes in the README (*See-through routes*) and points
rig-parts at what it wrote.

- Project: [shitagaki-lab/see-through](https://github.com/shitagaki-lab/see-through)
- Paper: Jian Lin, Chengze Li, Haoyun Qin, Kwun Wang Chan, Yanghua Jin, Hanyuan
  Liu, Stephen Chun Wang Choy, Xueting Liu, *See-through: Single-image Layer
  Decomposition for Anime Characters*, SIGGRAPH 2026,
  [arXiv:2602.03749](https://arxiv.org/abs/2602.03749)
- Licence: Apache License 2.0 — **[observed 2026-09-27]** the repository's
  licence as GitHub reports it.

### The ComfyUI wrapper

- Project: [jtydhr88/ComfyUI-See-through](https://github.com/jtydhr88/ComfyUI-See-through)
- Licence: **[observed 2026-09-27]** there is no `LICENSE` file in the
  repository (`LICENSE` on the default branch `master` returns 404, and GitHub
  reports no licence); `pyproject.toml` declares `license = "MIT"`.

rig-parts reads the wrapper's `layers.json` manifest format; it contains no
wrapper code.

### Weights

| Weights | Licence as stated on the model card | Observed |
| --- | --- | --- |
| [`layerdifforg/seethroughv0.0.2_layerdiff3d`](https://huggingface.co/layerdifforg/seethroughv0.0.2_layerdiff3d) | `license:apache-2.0` tag | 2026-09-27, Hugging Face model API |
| (same card, after its 2026-09-28 commit *"Add licence terms, NOTICE and base model metadata"*) | `license:openrail++` tag; the card's *Licence* section says the maintainers' own contributions are Apache-2.0 and the weights also inherit the licences of the models they are derived from — Animagine XL 4.0 / Stable Diffusion XL 1.0 (CreativeML Open RAIL++-M) and LayerDiffuse (CreativeML Open RAIL-M) | 2026-09-28, Hugging Face model API and card |
| [`layerdifforg/seethroughv0.0.1_marigold`](https://huggingface.co/layerdifforg/seethroughv0.0.1_marigold) | no licence tag on the card | 2026-09-27, Hugging Face model API |
| (same card, after its 2026-09-28 revision) | `license:openrail++` tag | 2026-09-28, Hugging Face model API |

Maintainer statement, on the Hugging Face discussion
[`layerdifforg/seethroughv0.0.2_layerdiff3d/discussions/1`](https://huggingface.co/layerdifforg/seethroughv0.0.2_layerdiff3d/discussions/1)
(user `24yearsold`, 2026-04-07): *"Yes all our models are aligned with our main
repo to use Apache 2.0."* The 2026-09-28 card revision above narrows that: Apache-2.0 for the maintainers' contributions, with the base models' Open RAIL terms inherited. rig-parts does not distribute these weights; a user who fetches them accepts the terms the card states on the day they fetch.

### Training data

The paper describes its own supervision this way: *"we introduce a scalable
engine that bootstraps high-quality supervision from commercial Live2D models,
capturing pixel-perfect semantics and hidden geometry."* That is the paper's
description of how See-through was trained. rig-parts does not use,
include or redistribute any of that data, any Live2D model, or anything derived
from them beyond the layers See-through itself writes for the user's own image.

## 2. Spine Runtimes, through rig-c

rig-parts depends on [`rig-c`](https://www.npmjs.com/package/rig-c)
(MIT, same author), which compiles and validates Spine skeleton data. Its round
trip runs through `@esotericsoftware/spine-core`, part of the
[Spine Runtimes](https://github.com/EsotericSoftware/spine-runtimes), under the
[Spine Runtimes License Agreement](https://esotericsoftware.com/spine-runtimes-license).
Since rig-c 2.0 neither package installs the runtime: rig-c carries it
only as a development dependency, and an install of rig-c gates a build with
its own validator. rig-parts does not install it either; it is this repository's
development dependency, at the version rig-c develops against, for the round
trip in the selftest and CI and the selftest's posing oracle.
rig-c's [NOTICE.md](https://github.com/rig-c/core/blob/main/NOTICE.md)
sets out the chain in full; briefly, as a restatement of Esoteric Software's
terms and not a term of this project:

1. What rig-parts produces is input to rig-c, whose output **is Spine
   skeleton data**.
2. A product that plays it with **a Spine Runtime** has integrated the Spine
   Runtimes; what the terms turn on is **the integration**. Integrating a Spine
   Runtime into a product is permitted **under Section 2 of the Spine Editor
   License Agreement**, or otherwise on the condition that **each user of the
   product obtains their own Spine Editor license** and the product carries the
   Runtimes licence and copyright notice.
3. rig-c does not install `spine-core`, and rig-parts does not either. The terms
   in 2 apply where a Spine Runtime is integrated — a product that plays the data
   with one, and this repository, whose development dependency it is — and
   nothing in this chain attaches to the skeleton data as a file.

rig-parts also imports rig-c's own modules directly, by deep path: its PNG codec
(`tools/plate.ts`, `src/png.ts`), its 5x7 label font (`tools/font5x7.ts`) and
its coordinate conversion (`src/transform.ts`). Those are rig-c's MIT code.

## 3. Checkpoints

Generating the painting is an **optional** adapter (`rig-parts comfy paint`).
The checkpoint, any LoRA and any ControlNet it runs are the user's: rig-parts
ships none and downloads none, and the terms that govern an image they produce
are the terms of those models. A painting from any other source works the same
way.

The images this repository ships, and the public examples' paintings, were
generated with one of two checkpoints, with no LoRA; neither checkpoint is
redistributed.

- `assets/demo-*` and the `demo` example's painting (since issue #227):
  `hassakuXLIllustrious_v13StyleA.safetensors`,
  [Hassaku XL (Illustrious)](https://civitai.com/models/140272) v1.3 Style A, by
  Ikena. Credit, as sharing it requires: *Painted with Hassaku XL (Illustrious)
  v1.3 Style A by Ikena (https://civitai.com/models/140272), Fair AI Public
  License 1.0-SD.* **[observed 2026-10-11]** The model page's version and licence
  section reads "All Models using the Fair AI Public License 1.0-SD license", and
  CivitAI's model API reported `allowCommercialUse: ["RentCivit", "Rent", "Image"]`,
  `allowNoCredit: false`, `allowDerivatives: true` and `allowDifferentLicense: false`.
- `assets/sample-parts.png` and the `scarf`, `reference-sample` and `reference-demo`
  paintings: `ponyDiffusionV6XL_v6StartWithThisOne.safetensors`,
  [Pony Diffusion V6 XL](https://civitai.com/models/257749). **[observed
  2026-09-27]** CivitAI's model API reported for it `allowCommercialUse: ["Image",
  "RentCivit"]`, `allowNoCredit: false`, `allowDerivatives: true` and
  `allowDifferentLicense: false`: generated images may be used commercially and
  the model must be credited, which this line does.

The [parts-examples](https://github.com/rig-c/parts-examples) README records
both, beside each character's generation record.

### Models named by the optional painting graph

**[observed 2026-10-22]** In `src/graphs.ts`, the intended OpenPose ControlNet is
[xinsir/controlnet-openpose-sdxl-1.0](https://huggingface.co/xinsir/controlnet-openpose-sdxl-1.0/blob/23f966cd5cfdd3f7729c903e243d87152162d2b7/README.md).
That revision's card declares `license: apache-2.0`. Its
[`diffusion_pytorch_model.safetensors`](https://huggingface.co/xinsir/controlnet-openpose-sdxl-1.0/blob/23f966cd5cfdd3f7729c903e243d87152162d2b7/diffusion_pytorch_model.safetensors)
is the source for the host-local name `controlnet-openpose-sdxl-1.0.safetensors`.
The graph uses that name only when `generation.control` is configured and
`generation.control.model` is absent; a configured model filename replaces it.
The local filename alone does not identify or verify the installed weights.

**[observed 2026-10-22]** The graph always names `4x-AnimeSharp.pth` for model
upscaling, followed by Lanczos resizing. The source is
[Kim2091/AnimeSharp at `7696d95`](https://huggingface.co/Kim2091/AnimeSharp/blob/7696d95ced82b0c1f2a41f6ac73336133f0a90e1/4x-AnimeSharp.pth),
and the [creator's card at that revision](https://huggingface.co/Kim2091/AnimeSharp/blob/7696d95ced82b0c1f2a41f6ac73336133f0a90e1/README.md)
declares CC BY-NC-SA 4.0, including its NonCommercial condition. rig-parts ships
neither model and grants no additional rights to their weights. These observations
record the models' declared terms; they do not assign a blanket licence to output
images. The existing upscaler selection is unchanged. Whether to require explicit
selection is the separate, deferred owner decision in
[#428](https://github.com/rig-c/parts/issues/428).

## 4. Behaviour reimplemented, not code copied

The raster operations in `src/raster/` reproduce the documented behaviour of
calls the reference implementation made, so that the port measures the same
numbers — [OpenCV](https://github.com/opencv/opencv) (Apache-2.0),
[SciPy](https://github.com/scipy/scipy) (BSD-3-Clause) and
[Pillow](https://github.com/python-pillow/Pillow) (MIT-CMU). They are written in
TypeScript for this package and contain none of those projects' code; each
function's comment says which call it stands in for and what was measured.

## 5. npm dependencies

| Package | Licence | Why |
| --- | --- | --- |
| [`rig-c`](https://www.npmjs.com/package/rig-c) | MIT | compile, gate, render and check; its PNG codec, font and coordinate conversion |
| [`ag-psd`](https://www.npmjs.com/package/ag-psd) | MIT | reading an upstream See-through `.psd` |
| ↳ [`pako`](https://www.npmjs.com/package/pako) | MIT AND Zlib | ag-psd's deflate |
| ↳ [`base64-js`](https://www.npmjs.com/package/base64-js) | MIT | ag-psd's base64 |

Development only, not installed with the package: `typescript` (Apache-2.0),
`eslint` (MIT), `typescript-eslint` (MIT), `@types/bun` (MIT), and
[`@esotericsoftware/spine-core`](https://www.npmjs.com/package/@esotericsoftware/spine-core)
(Spine Runtimes License; section 2), pinned to the version rig-c develops
against (`TY10`): the round trip in the selftest and CI, the selftest's posing
oracle, and `tools/atlas_population.ts` and `tools/idle_cost.ts`.
