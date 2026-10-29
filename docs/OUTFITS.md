# The outfit transaction

When a second painting of the same character changes only the clothes, the base
skeleton, rest pose, face axis, idle motion, and uncovered body and head parts are
already measured and built. Adding the second outfit is a bounded transaction on the
existing `config.json`: the clothing and sleeve parts re-run through `assemble`,
`rig`, and `check` as an alternate attachment set (`assemble.alternates`), while
every structural and motion stage of the base rig stays byte-for-byte unchanged.

This document specifies:

1. **Inputs** — what files and `assemble.alternates` fields a second outfit takes, and what `out/rig/sets.json` emits.
2. **What is kept (and why)** — the stage-by-stage table of kept vs re-run work and what checks (or does not check) each stage, with `sha256` digests measured on the public outfit fixture before and after adding a second outfit.
3. **What re-runs and the wide-sleeve / overgarment trap** — how region replacement, limb re-cutting, and skirt mesh re-triangulation run on the second outfit, and the named refusals (`CONFIG_LIMB_SET_JOINTS`, `ASSEMBLE_LIMB_JOINT_ON_ART`, `ASSEMBLE_ALT_INPUT_PRESENT`, `ASSEMBLE_ALT_CANVAS_SIZE`) that fire when a wide sleeve or overgarment changes how the arm is segmented.
4. **Composition with other sets** — how an outfit set (`outfit_b`) composes in the same build with mouth viseme subset sets (`a`, `i`, `u`, issue #473) and gesture subset sets (issue #476), and which set takes precedence when two sets touch the same slot.
5. **Verification** — the exact CLI commands and verbatim output for building, checking, and rendering the combined rig.

---

## 1. Inputs

An outfit alternate set requires:

1. **A second source painting** (`painting_b.png`) of the same character at the exact canvas dimensions of the base `assemble.source` (`128x128` in the public fixture).
2. **A segmentation run directory** (`full_b/`) containing the layer PNGs referenced by `assemble.plan` for the parts the outfit replaces (`full:topwear`, `full:bottomwear`, `full:footwear`, `full:handwear-r`). If the head run did not change, `"head"` points to the base `head/` directory.
3. **One entry in `config.assemble.alternates`** naming the set, its inputs, the subset of clothing and limb parts to re-cut (`parts`), any base-only accessories that disappear in the second outfit (`hides`), and—only when the second painting's limb pose differs from the base painting's—its `drawn` bone angles or `skeleton` keypoints.

### `config.json` excerpt (`assemble.alternates`)

In the public outfit fixture (`64x64` rig on a `128x128` canvas, 11 base parts:
`hair_back`, `hairpin`, `topwear`, `bottomwear`, `shoes`, `forearm_r`, `upperarm_r`,
`face`, `eyewhite_r`, `eyewhite_l`, `mouth`), the second outfit `outfit_b` replaces
the five clothing and arm-sleeve parts (`topwear`, `bottomwear`, `shoes`, `forearm_r`,
`upperarm_r`), widens the skirt (`bottomwear`) from `14x24` to `16x24` rig pixels,
and hides the base `hairpin` accessory. Three mouth viseme subset sets (`a`, `i`, `u`)
sit beside it in the same `alternates` array:

```json
{
  "key": "outfit-fixture",
  "seethrough": {
    "resolution": 64,
    "steps": 1,
    "seed": 0,
    "offload": false,
    "head_box": [32, 0, 96, 64]
  },
  "assemble": {
    "rig_scale": 0.5,
    "plan": [
      ["hair_back", "head", "back hair"],
      ["hairpin", "full", "headwear"],
      ["topwear", "full", "topwear"],
      ["bottomwear", "full", "bottomwear"],
      ["shoes", "full", "footwear"],
      ["arm_r", "full", "handwear-r"],
      ["face", "head", "face"],
      ["eyewhite_r", "head", "eyewhite-r"],
      ["eyewhite_l", "head", "eyewhite-l"],
      ["mouth", "head", "mouth"]
    ],
    "extend_below_crop": [
      { "part": "hair_back", "run": "full", "tag": "back hair" }
    ],
    "alternates": [
      {
        "name": "outfit_b",
        "source": "painting_b.png",
        "full": "full_b",
        "head": "head",
        "parts": ["topwear", "bottomwear", "shoes", "upperarm_r", "forearm_r"],
        "hides": ["hairpin"]
      },
      {
        "name": "a",
        "source": "painting.png",
        "full": "full",
        "head": "head_a",
        "parts": ["mouth"]
      },
      {
        "name": "i",
        "source": "painting.png",
        "full": "full",
        "head": "head_i",
        "parts": ["mouth"]
      },
      {
        "name": "u",
        "source": "painting.png",
        "full": "full",
        "head": "head_u",
        "parts": ["mouth"]
      }
    ]
  }
}
```

### Emitted `out/rig/sets.json`

`rig-parts rig` (and `rig-parts build`) writes `out/rig/sets.json` (`spec: "rig-parts-sets/1"`), mapping each set name to the slot-to-attachment bindings it activates (`slots`), any hidden base slots (`hides`), and any per-set `drawn` bone angles:

```json
{
  "spec": "rig-parts-sets/1",
  "sets": {
    "outfit_b": {
      "slots": {
        "topwear": "outfit_b_topwear",
        "bottomwear": "outfit_b_bottomwear",
        "shoes": "outfit_b_shoes",
        "forearm_r": "outfit_b_forearm_r",
        "upperarm_r": "outfit_b_upperarm_r"
      },
      "hides": [
        "hairpin"
      ]
    },
    "a": {
      "slots": {
        "mouth": "a_mouth"
      }
    },
    "i": {
      "slots": {
        "mouth": "i_mouth"
      }
    },
    "u": {
      "slots": {
        "mouth": "u_mouth"
      }
    }
  }
}
```

---

## 2. What is kept (and why)

### Stage-by-stage transaction table

Every stage of the pipeline either keeps its base output untouched or re-runs scoped to the alternate set's declared `parts`:

| Stage / artifact | Kept from the base build | Re-run for `outfit_b` | Check (or why no check runs) |
| --- | --- | --- | --- |
| `see-through` (layer audit) | Base layer audit (`full/`, `head/`) | Optional author read on `full_b/` before editing `config.json` | **No automated build check** (`see-through` is a diagnostic inspection command, not a gate inside `build`). Missing or wrong-sized files in `full_b/` are caught in `assemble` by `ASSEMBLE_ALT_INPUT_PRESENT` and `ASSEMBLE_ALT_CANVAS_SIZE`. |
| `propose` (`bones`, `limbs`, `meshes`, `regions`, `motion`, `turn`) | All proposed sections in `config.json` (`bones` chain points/lengths, `limbs.arm_r` joint coordinates, `meshes.bottomwear` declaration, `regions`, `motion`) | **Not re-run.** Re-running `propose` on `painting_b.png` would draft a second skeleton rather than an outfit on the same rig. | **No cross-file diff check** between two separate configs: keeping a single `config.json` is what holds these sections identical by construction. Loader gates (`CONFIG_ALT_NAME_UNIQUE`, `CONFIG_NAME_RESOLVES`, `CONFIG_ALT_HIDES_DISJOINT`, `CONFIG_LIMB_SET_JOINTS`) validate the `alternates` entry against the kept config. |
| `assemble` (`parts/`, `parts.json`) | Base `parts/<part>.png` (`11` PNGs), `parts.json` `.parts`, `recomposite_rig.png`, `recomposite_error_rig.png` | Cuts only the 5 `parts` of `outfit_b` (`parts/outfit_b_<part>.png`), re-runs the `limbs.arm_r` elbow cut and cap at `[15, 34]` on `full_b:handwear-r`, records `parts.json` `.alternates`, and writes `recomposite_rig_outfit_b.png` | `ASSEMBLE_ALT_INPUT_PRESENT`, `ASSEMBLE_ALT_CANVAS_SIZE`, `ASSEMBLE_PART_OPAQUE`, `ASSEMBLE_LIMB_PIXELS`, `ASSEMBLE_LIMB_JOINT_ON_ART`. Uncovered base parts (`hair_back`, `face`, `eyewhite_r`, `eyewhite_l`, `mouth`, `hairpin`) are not re-read from `full_b/`. |
| `rig` — skeleton & `drawn` rest rotations (`rig.json` `.bones`) | All 14 bones (`root`, `anchor`, `chest`, `head`, `head_up`, `eye_r`, `eye_l`, `mouth`, `arm_r0`, `arm_r1`, `skirt0_ctl`, `skirt0`, `skirt1_ctl`, `skirt1`), their hierarchy, lengths, and base `drawn` rest rotations (`arm_r0: -90`, `arm_r1: -90`, `skirt0: -90`, `skirt1: -90`, `head_up: 90`) | **Not re-run.** Even when an alternate declares its own `drawn` pose, `.bones` stays at the base rest pose; the alternate's `drawn` delta is applied to its attachment offsets (`#465`) and recorded in `sets.json` for track rotation synthesis (`#476`). | Structural: `buildRig` constructs `.bones` once from `config.bones` and `config.motion` before iterating `parts.alternates`. Gated by `rigc` `A01`–`A52` and verified byte-identical in `selftest.ts` (`BU173`). |
| `rig` — face axis (`rig.json` `.invariants.axes`) | `face` axis (`0` deg through `eye_r -> eye_l`), `head_up` (`90` deg, `5` px), and `eye_r`, `eye_l`, `mouth` alignment | **Not re-run.** The eye and mouth bones belong to the base skeleton. | `rigc` assertion `A51_AXIS_BONES_ON_LINE` (tolerance `0.000001` degrees). |
| `rig` — attachments & meshes (`rig.json` `.skins.default`, `sets.json`) | All 11 base attachments under `skins.default.<slot>.<part>`, including the base `bottomwear` mesh (`24` vertices, `30` triangles) | Emits `skins.default.<slot>.outfit_b_<part>` for the 5 covered parts: 4 region attachments (`outfit_b_topwear`, `outfit_b_shoes`, `outfit_b_forearm_r`, `outfit_b_upperarm_r`) and 1 re-triangulated mesh (`outfit_b_bottomwear`, `30` vertices, `40` triangles on the `16x24` skirt), bound to the kept `skirt0` and `skirt1` bones; writes `sets.json` | `RIG_ALT_PART_KNOWN`, `RIG_SET_COVERS_BONE`, `RIG_MESH_WEIGHTS`, and `rigc` mesh assertions (`A19`, `A20`, `A21`, `A34`, `A36`) on every mesh attachment in `skins.default` (both `bottomwear` and `outfit_b_bottomwear`). |
| `rig` — motion (`motion.json`) | Base `animations.idle` (`1` s, `6` tracks, `51` keys: breath on `chest`, blink on `eye_r`/`eye_l`, wave chains on `arm_r0 > arm_r1` and `skirt0_ctl > skirt1_ctl`) | Expands `{"set": "<name>" \| null}` keys in `motion.animations_from` (`speak.json`) against `sets.json` | `RIG_SET_KNOWN`, `CONFIG_SET_COVERS_SLOT`, and `rigc` animation/timeline assertions (`A10`, `A22`–`A30`, `A37`, `A38`). |
| `check` (`out/check/`) | Base setup-pose seam, `BREATH_VISIBLE`, `BLINK_NO_HOLE`, `CHAIN_LAG`, `TIP_OVER_ROOT`, `STILL_REGIONS_DARK`, `TEXTURE_STRETCH`, `LIMB_ONE_BONE` | Packs all `19` regions (`11` base + `5` `outfit_b` + `3` viseme) into `skeleton.png`, runs `seam (outfit_b)` and `RECOMPOSITE_HOLES (outfit_b)` under `--all-sets`, and under `check --set outfit_b` substitutes `outfit_b`'s attachments and `hides` to run `ANIMATIONS_DO_NOT_FOLD` on `outfit_b`'s mesh | `CHECK_SEAM` (`mean \|d\| <= 1.0`, `px_over_40 <= 50 rig px`), `ANIMATIONS_DO_NOT_FOLD` across `idle` and `speak`. **Note:** `BREATH_VISIBLE`, `BLINK_NO_HOLE`, `CHAIN_LAG`, `TIP_OVER_ROOT`, `STILL_REGIONS_DARK`, `TEXTURE_STRETCH`, and `LIMB_ONE_BONE` always measure the base `idle` attachments even when `--set outfit_b` is passed; only `seam (<set>)`, `RECOMPOSITE_HOLES (<set>)`, and `ANIMATIONS_DO_NOT_FOLD` (under `--set <set>`) substitute the alternate set. |

### Measured `sha256` digests: base build vs outfit + viseme build

Building the base config alone (`out_base`, no `assemble.alternates`, no `animations_from`) and building the config with `outfit_b`, `a`, `i`, `u`, and `speak.json` (`out`) produces the exact same bytes on every kept section:

| Section / artifact | `out_base` (base only) | `out` (with `outfit_b` + `a`/`i`/`u` + `speak`) | Status |
| --- | --- | --- | --- |
| `rig.json` `.bones` (14 bones, coordinates, lengths, base `drawn` rotations) | `337b27f126c6e023fc89975a8336f6e238e6d88efcd43e4a4bdb2c4bb530afdf` | `337b27f126c6e023fc89975a8336f6e238e6d88efcd43e4a4bdb2c4bb530afdf` | **Kept (identical)** |
| `rig.json` `.invariants.axes` (`face` axis on `eye_r -> eye_l`, `mouth`) | `eae7351e1206641929b2625359ced7ba31d065756272319b09bc83da50b82498` | `eae7351e1206641929b2625359ced7ba31d065756272319b09bc83da50b82498` | **Kept (identical)** |
| `motion.json` `.animations.idle` (6 tracks, 51 keys) | `87b6a843d36cd4a46fff474ab10e6874a7667f819bfa12d674e75e7dcf70667c` | `87b6a843d36cd4a46fff474ab10e6874a7667f819bfa12d674e75e7dcf70667c` | **Kept (identical)** |
| `rig.json` `.skins.default.bottomwear.bottomwear` (base skirt mesh, `24`v / `30`t) | `9c9bca3e0270160bc557248a250f7e015012161e7f1be7460b4bcb368b917925` | `9c9bca3e0270160bc557248a250f7e015012161e7f1be7460b4bcb368b917925` | **Kept (identical)** |
| `rig.json` `.skins.default.bottomwear.outfit_b_bottomwear` (second skirt mesh, `30`v / `40`t) | *(not present)* | `e15b4ba5a013495d23fe945c7aafb980a12351cdc9ca067b4904ce0d48059701` | **Re-run (added)** |

Why these four stay fixed:

- **`.bones` and base `drawn` rotations**: The character's proportions and joint pivots belong to the body underneath the clothes. Changing `.bones` when a second outfit is added would shift every animation track and every attachment offset on the base rig.
- **`.invariants.axes` (`faceAxis`)**: The eye line (`eye_r -> eye_l`) and `head_up` vector depend only on the head and eye bones, which an outfit change does not move.
- **`.animations.idle`**: The idle animation keys bone transforms (`chest`, `eye_r`, `eye_l`, `arm_r0`, `arm_r1`, `skirt0_ctl`, `skirt1_ctl`), not outfit attachment names. Because the second outfit's regions and meshes bind to those same bones, the kept `idle` drives the new clothes without re-authoring a keyframe.
- **Base attachments**: Every base attachment (`skins.default.<slot>.<part>`) and every base `parts/<part>.png` remains untouched so the default skin still renders the base outfit with zero pixel drift.

---

## 3. What re-runs — and the wide-sleeve / overgarment trap

### How `assemble` and `rig` re-run on `outfit_b`

1. **Scoped part cutting (`assemble`)**: For `outfit_b`, `assemble` reads `painting_b.png` and `full_b/` and cuts only the five parts listed in `outfit_b.parts` (`topwear`, `bottomwear`, `shoes`, `upperarm_r`, `forearm_r`), writing `out/parts/outfit_b_<part>.png` and recording their bounding boxes in `out/parts.json` under `alternates[0].records`.
2. **Limb joint cut and disc cap (`assemble`)**: Because `upperarm_r` and `forearm_r` are segments of `config.limbs.arm_r` (`from: "arm_r"`, cut across the `elbow` joint at `[15, 34]`), `assemble` cuts `full_b:handwear-r` along the kept elbow line and stamps the radius-3 disc cap on `outfit_b_forearm_r`.
3. **Skirt mesh re-triangulation (`rig`)**: `bottomwear` is declared in `config.meshes.bottomwear` (`grid: 6`, `r: 1`, `influences: { maxInfluences: 1 }`, `segments: ["skirt"]`). When `rig` builds `outfit_b_bottomwear` from `out/parts/outfit_b_bottomwear.png` (`16x24` rig px vs the base skirt's `14x24` rig px), it runs contour tracing, grid placement, constrained Delaunay triangulation, and bone-weight allocation anew on `outfit_b_bottomwear.png` (`30` vertices, `40` triangles vs the base mesh's `24` vertices, `30` triangles), binding every vertex to the kept `skirt0` and `skirt1` bones.

### The wide-sleeve / overgarment trap

A second outfit frequently changes sleeve silhouette—replacing a fitted sleeve with a wide bell sleeve, kimono sleeve, cape, or sleeveless vest. Two segmentation and config mistakes happen here, and both are refused by name before any file is written:

#### Trap 1: Partial limb coverage or hiding limb segments (`CONFIG_LIMB_SET_JOINTS`)

If an author lists `"upperarm_r"` in `outfit_b.parts` (for example, because only the upper sleeve changed) and omits `"forearm_r"`, the elbow cut at `[15, 34]` would pair the new upper sleeve with the base forearm cut from a different painting. Likewise, putting `"upperarm_r"` or `"forearm_r"` into `outfit_b.hides` is refused because a subset set over a `config.limbs.<name>` chain must either re-cut all segments of that limb at its joints or leave the entire limb untouched:

```text
[assemble]   FAIL  CONFIG_LIMB_SET_JOINTS: config.assemble.alternates[0].parts — covers ["upperarm_r"] of config.limbs.arm_r, which cuts at the base's joints into ["upperarm_r", "forearm_r"]; a gesture set over a limb chain must cover all 2 of its segment parts so it is cut at the base's joints (see rig-parts guide CONFIG_LIMB_SET_JOINTS)
```

```text
[assemble]   FAIL  CONFIG_LIMB_SET_JOINTS: config.assemble.alternates[0].parts — covers [] (and hides ["upperarm_r", "forearm_r"]) of config.limbs.arm_r, which cuts at the base's joints into ["upperarm_r", "forearm_r"]; a gesture set over a limb chain must cover all 2 of its segment parts so it is cut at the base's joints (see rig-parts guide CONFIG_LIMB_SET_JOINTS)
```

#### Trap 2: Wide sleeve or overgarment swallowed into `topwear` (`ASSEMBLE_PART_OPAQUE`, `ASSEMBLE_LIMB_PIXELS`, `ASSEMBLE_LIMB_JOINT_ON_ART`)

When a wide sleeve or overgarment covers the arm in `painting_b.png`, the segmentation run often merges the sleeve into `full_b/topwear.png`. Depending on how much of `full_b/handwear-r.png` was swallowed into `topwear`, `assemble` refuses `outfit_b` at one of three checks:

1. **The entire arm/sleeve was swallowed into `topwear` (leaving only a speck in `handwear-r`)** — refused by `ASSEMBLE_PART_OPAQUE`:
   ```text
   [assemble]   FAIL  ASSEMBLE_PART_OPAQUE: part "arm_r" (full:handwear-r, config.assemble.plan[3]) (alternate set "outfit_b") — has 0 pixels with alpha above 8 in the rig (no pixel at all; 4 ghost px removed in the run); a part with at least one opaque pixel is required — drop it from the plan or take the tag from the other run (see rig-parts guide ASSEMBLE_PART_OPAQUE)
   ```
2. **The upper sleeve was swallowed into `topwear`, leaving only the hand/wrist below the elbow (`y: 38..46`) in `handwear-r`** — refused by `ASSEMBLE_LIMB_PIXELS`:
   ```text
   [assemble]   FAIL  ASSEMBLE_LIMB_PIXELS: config.limbs.arm_r.segments[0] (part "upperarm_r") (alternate set "outfit_b") — takes 0 of "arm_r"'s 48 opaque pixel(s); a segment with art is required — the joint lines through the bones' origins put none of the limb's pixels on this segment, or another limb's polyline lies nearer every one: move the bones onto the limb's art (see rig-parts guide ASSEMBLE_LIMB_PIXELS)
   ```
3. **Both segments have pixels, but `handwear-r` has a gap across the elbow joint (`[15, 34]`)** — refused by `ASSEMBLE_LIMB_JOINT_ON_ART`:
   ```text
   [assemble]   FAIL  ASSEMBLE_LIMB_JOINT_ON_ART: config.limbs.arm_r.segments[1] (joint "elbow", part "forearm_r") (alternate set "outfit_b") — the joint, "arm_r1"'s origin at [15, 34], lies on none of the limb's art within 1 px along its joint line, so the limb has no width there to size the cap by; a bone origin on the limb's art (alpha above 8) is required — move the bone onto the joint (see rig-parts guide ASSEMBLE_LIMB_JOINT_ON_ART)
   ```

**How to resolve Trap 2 depending on how the second outfit treats the arm:**

- **Case A — The wide sleeve articulates with the arm chain (`arm_r0 > arm_r1`)**: Keep the sleeve pixels in `full_b/handwear-r.png` (separate from `full_b/topwear.png`) so `full_b:handwear-r` covers both segments and the elbow joint at `[15, 34]`, and `"upperarm_r"` and `"forearm_r"` cut cleanly along the limb chain. If the wide sleeve was painted at a different arm angle than the base painting, declare `drawn: { "arm_r0": <deg>, "arm_r1": <deg> }` on `outfit_b` so `assemble` rotates the joint cut to the painted angle (`#476`) and `rig` compensates the attachment offsets back to the base rest pose (`#465`).
- **Case B — Only the torso/skirt clothes changed and the arm is unchanged**: Omit `"upperarm_r"` and `"forearm_r"` from both `outfit_b.parts` and `outfit_b.hides` (`parts: ["topwear", "bottomwear", "shoes"]`, `hides: ["hairpin"]`). Then `assemble` leaves `limbs.arm_r` untouched and the character keeps the base `upperarm_r` and `forearm_r` attachments. (Do not put limb segments into `hides`; as shown under Trap 1, `CONFIG_LIMB_SET_JOINTS` refuses hiding segments of a `config.limbs` chain.)

#### Trap 3: Missing layer file or mismatched canvas size (`ASSEMBLE_ALT_INPUT_PRESENT`, `ASSEMBLE_ALT_CANVAS_SIZE`)

If `full_b/` is missing a layer PNG required by `outfit_b.parts`, or if `painting_b.png` was exported at a different resolution than the base `painting.png`, `assemble` refuses before cutting:

```text
[assemble]   FAIL  ASSEMBLE_ALT_INPUT_PRESENT: alternate set "outfit_b" (part "shoes") — takes full:footwear, which is absent in scratch/outfits/full_b_missing/layers.json; every covered part of the alternate set must be present in its runs, or listed in hides (see rig-parts guide ASSEMBLE_ALT_INPUT_PRESENT)
```

```text
[assemble]   FAIL  ASSEMBLE_ALT_CANVAS_SIZE: painting_b_64.png (alternate set "outfit_b") — is 64x64, while the base source painting is 128x128; every alternate painting must share the base canvas size (see rig-parts guide ASSEMBLE_ALT_CANVAS_SIZE)
```

---

## 4. Composition with other sets (`#473` visemes and `#476` gestures)

An outfit set (`outfit_b`) and subset sets for facial visemes (`a`, `i`, `u` covering `["mouth"]`, issue #473) or limb gestures (covering `["upperarm_r", "forearm_r", "hand_r"]`, issue #476) live in the same `config.assemble.alternates` array and compile into the same `rig.json`, `sets.json`, and packed `skeleton.png`.

### Disjoint slots: outfit + mouth visemes (`outfit_b` + `a` / `i` / `u`)

In the fixture:

- `outfit_b` touches slots `{hairpin, topwear, bottomwear, shoes, forearm_r, upperarm_r}`.
- `a`, `i`, and `u` each touch only slot `{mouth}`.

Because `{hairpin, topwear, bottomwear, shoes, forearm_r, upperarm_r} ∩ {mouth} = ∅`:

1. **In `motion.animations_from` (`speak.json`)**: An attachment track on slot `"mouth"` with keys `[{"t": 0, "set": null}, {"t": 0.25, "set": "a"}, {"t": 0.5, "set": "i"}, {"t": 0.75, "set": "u"}, {"t": 1, "set": null}]` expands through `expandSetAttachmentKeys` into `[{"t": 0, "name": "mouth"}, {"t": 0.25, "name": "a_mouth"}, {"t": 0.5, "name": "i_mouth"}, {"t": 0.75, "name": "u_mouth"}, {"t": 1, "name": "mouth"}]`. It writes no keys on `topwear`, `bottomwear`, `shoes`, `forearm_r`, `upperarm_r`, or `hairpin`.
2. **At runtime or in a consumer applying `sets.json`**: Applying `outfit_b`'s slot map and playing `speak` (or applying viseme set `a`) commutes—applying `outfit_b` then `a`, or `a` then `outfit_b`, produces the exact same slot state:
   ```json
   {
     "hair_back": "hair_back",
     "hairpin": null,
     "topwear": "outfit_b_topwear",
     "bottomwear": "outfit_b_bottomwear",
     "shoes": "outfit_b_shoes",
     "forearm_r": "outfit_b_forearm_r",
     "upperarm_r": "outfit_b_upperarm_r",
     "face": "face",
     "eyewhite_r": "eyewhite_r",
     "eyewhite_l": "eyewhite_l",
     "mouth": "a_mouth"
   }
   ```

### Overlapping slots: precedence rule

When two sets touch the same slot (for example, a base outfit set `outfit_b` that covers `upperarm_r` and `forearm_r`, and a gesture subset set `wave` that also covers `upperarm_r` and `forearm_r`), **the later-applied set (or active animation track key) takes precedence on every overlapping slot and bone**:

- **Static set composition**: Merging set $S_1$ followed by set $S_2$ (`{ ...S_1.slots, ...S_2.slots }` and `{ ...S_1.drawn, ...S_2.drawn }`) binds any shared slot $s \in \text{dom}(S_1) \cap \text{dom}(S_2)$ to $S_2.\text{slots}[s]$ (including `null` when $S_2$ hides $s$), while slots in $\text{dom}(S_1) \setminus \text{dom}(S_2)$ keep $S_1$'s bindings.
- **Animation track expansion (`expandSetAttachmentKeys`)**: Each track in `motion.animations_from` names a single `slot` (`track.slot`). A key `{"t": t, "set": S}` on that track looks up `sets[S].slots[track.slot]` (refusing with `CONFIG_SET_COVERS_SLOT` if `S` does not cover `track.slot`) and, if `sets[S].drawn` covers bones in that limb chain, synthesizes stepped `rotate` keys on those bones for the duration of the key. When a Subsequent key on that track sets `{"t": t_2, "set": "outfit_b"}` (or `{"t": t_2, "set": null}`), the track switches `track.slot` and its chain's `drawn` rotation deltas to `"outfit_b"` (or back to the base rest pose `0`).

---

## 5. Verification

The commands below run on the self-contained outfit fixture (`base_config.json` without alternates vs `config.json` with `outfit_b`, `a`, `i`, `u`, and `speak.json`):

### 1. Build the base rig and the outfit + viseme rig (`--all-sets`)

```sh
rig-parts build --config scratch/outfits/base_config.json --out scratch/outfits/out_base
rig-parts build --config scratch/outfits/config.json --out scratch/outfits/out --all-sets
```

Verbatim output of the combined build (`scratch/outfits/config.json -> scratch/outfits/out --all-sets`):

```text
rig-parts build: scratch/outfits/config.json -> scratch/outfits/out, seam rule near-white, projection rule core, page edges free, pack shape polygon
[assemble] rig-parts assemble: 11 part(s) on a 64x64 rig (0.5 rig px per source px), seam rule near-white, projection rule core
[assemble]   hair_back   head:back hair   9x35      @  37,  10 op=   285 vis=   285 src=    68/    72 unproj=  193 drift=    0 (0.0% of core) merged=133 seam=0
[assemble]   hairpin     full:headwear    16x12     @   4,   2 op=   192 vis=   192 src=    96/    96 unproj=   96 drift=    0 (0.0% of core) merged=0 seam=0
[assemble]   topwear     full:topwear     20x30     @  10,  20 op=   600 vis=   456 src=   208/   208 unproj=  248 drift=    0 (0.0% of core) merged=0 seam=0
[assemble]   bottomwear  full:bottomwear  14x24     @  48,  30 op=   336 vis=   336 src=     0/   200 unproj=  336 drift=  200 (100.0% of core) merged=0 seam=336
[assemble]   shoes       full:footwear    20x6      @  10,  54 op=   120 vis=   120 src=    32/    32 unproj=   88 drift=    0 (0.0% of core) merged=0 seam=0
[assemble]   forearm_r   full:handwear-r  6x15      @  12,  31 op=    88 vis=    72 src=    20/    20 unproj=   52 drift=    0 (0.0% of core) merged=0 seam=0
[assemble]   upperarm_r  full:handwear-r  6x12      @  12,  22 op=    72 vis=    72 src=    20/    20 unproj=   52 drift=    0 (0.0% of core) merged=0 seam=0
[assemble]   face        head:face        12x6      @  16,   8 op=    72 vis=    48 src=     0/     0 unproj=   48 drift=    0 (no core) merged=0 seam=0
[assemble]   eyewhite_r  head:eyewhite-r  4x3       @  17,   9 op=    12 vis=    12 src=     0/     0 unproj=   12 drift=    0 (no core) merged=0 seam=0
[assemble]   eyewhite_l  head:eyewhite-l  4x3       @  23,   9 op=    12 vis=    12 src=     0/     0 unproj=   12 drift=    0 (no core) merged=0 seam=0
[assemble]   mouth       head:mouth       6x2       @  19,  14 op=    12 vis=    12 src=     0/     0 unproj=   12 drift=    0 (no core) merged=0 seam=0
[assemble]   limb cut: "arm_r" opaque 144 = "upperarm_r" 72 + "forearm_r" 72
[assemble]   limb cap: "arm_r" joint "elbow" at [15, 34], on "forearm_r": a disc of radius 3 px (the limb 6 px across the joint line), box [12, 31, 6, 6] — on the upper side of the line 16 px from the layer, none missing
[assemble]   pixels: opaque 1801 = visible 1617 + occluded 184 (10.2%); taken from the painting 444 (24.7%); visible but not projected 1149 (63.8%)
[assemble]   ghost px removed: 13 over 12 layer(s)
[assemble] recomposite vs source: mean |d|=115.09, within 8: 38.9%, error px > 40: 2503, uncovered error px: 2503
[assemble] uncovered holes (8-connected): 1
[assemble]   uncovered hole 1: 2503 px at 0,0 64x64 (between "topwear" 96 px, "hair_back" 84 px, "bottomwear" 72 px, "hairpin" 48 px, "shoes" 48 px, "face" 21 px, "mouth" 8 px)
[assemble] uncovered error by cause: no layer (alpha <= 8 on every layer; only assemble.patches from the painting can cover): 2503 px in 1 component(s) (largest 2503 px at 0,0 64x64); on a layer (alpha > 8 on a layer, below covered alpha 128 in the parts): 0 px
[assemble] wrote scratch/outfits/out/parts.json, 11 PNG(s) in scratch/outfits/out/parts, scratch/outfits/out/recomposite_rig.png, scratch/outfits/out/recomposite_error_rig.png (uncovered error px red, covered error px blue, the painting grey)
[rig] rig-parts rig: outfit-fixture, rig 64x64, 11 part(s)
[rig]   mesh bottomwear   v=  24 t=  30 hull= 16 grid=6 bones=2 infl max 1 mean 1.00 cover 1.00000 loop passes 1
[rig]   bones 14 (2 control) slots 11 meshes 1 regions 10 vertices 24; idle 1 s, 6 track(s), 51 key(s)
[rig]   animations beside the idle, from <project>/scratch/outfits/speak.json as written: speak
[rig]   face axis: 0 degrees, the line through the eye bones eye_r and eye_l (on eyewhite_r and eyewhite_l); eye_r, eye_l, mouth turned to it; invariants.axes "face" holds eye_r, eye_l, mouth to the line through eye_r -> eye_l, tolerance 0.000001 degrees (rigc's A51); head_up under head along the face's up axis, 90 degrees, 5 px (head's origin to the eye midpoint along it)
[rig]   idle keys ctl: 2 mesh-driving bone(s) keyed by the idle, each keyed through a same-origin <bone>_ctl parent
[rig]   rigc build --profile rig-play --pack --page-edges free --pack-shape polygon: exit 0
[rig]     ..    50 assertions: 23 measured (23 passed, 0 failed), 27 skipped, 0 not in profile "rig-play"
[rig]     ..    50 assertions: 24 measured (24 passed, 0 failed), 26 skipped, 0 not in profile "rig-play"
[rig] rig-parts rig: wrote scratch/outfits/out/rig/rig.json, motion.json, mesh_report.json and 19 image(s) under scratch/outfits/out/rig/images
[check] rig-parts check: scratch/outfits/out/rig -> scratch/outfits/out/check
[check]   rigc 2.59.0 at <project>/node_modules/.bin/rigc; entry: cli.ts — @esotericsoftware/spine-core 4.3.13 present
[check]   gate rig-play (rigc build --profile rig-play --pack --page-edges free --pack-shape polygon), verbatim:
[check]   ..    50 assertions: 23 measured (23 passed, 0 failed), 27 skipped, 0 not in profile "rig-play"
[check]   ..    pages=19 regions=19 bones=14 slots=11 animations=2 version=4.3.13 regionAttachments=17 meshAttachments=2 physicsConstraints=0 rig=outfit-fixture_painting profile=rig-play
[check]   ..    pack: skeleton.png 104x120, 19 region(s), 65.6% covered, padding 2, page edges free, shape polygon
[check]   ..    50 assertions: 24 measured (24 passed, 0 failed), 26 skipped, 0 not in profile "rig-play"
[check]   ..    pages=1 regions=19 bones=14 slots=11 animations=2 version=4.3.13 regionAttachments=17 meshAttachments=2 physicsConstraints=0 rig=outfit-fixture_painting profile=rig-play
[check]   pack: skeleton.png 104x120, 19 region(s), 65.6% covered, padding 2, page edges free, shape polygon; page opaque 25.8% (alpha > 0) — spineboy yardstick 1024x256, 40 region(s), 45.8% opaque (alpha > 0), a reference and not a bar
[check]   loop: idle 13 frame(s) at 12 fps, f0000 vs f0012 (t = 1s): max |d| 0 (0 required)
[check]   beside the idle: 1 animation(s), speak — built and gated by rigc with the rig; ANIMATIONS_DO_NOT_FOLD reads each for folds and FEET_STAY_LEVEL for how far the feet turn, every other bar here reads the idle
[check]   seam: setup pose at 60x64, scale 0.8979: mean |d| 0.195 (<= 1.0), 0 px over 40, 0.00 rig px (the count / s²; <= 50), 0 px over 80 (reported)
[check]   seam (outfit_b): setup pose at 64x64, scale 0.9877: mean |d| 0.189 (<= 1.0), 0 px over 40, 0.00 rig px (the count / s²; <= 50), 0 px over 80 (reported)
[check]   seam (a): setup pose at 60x64, scale 0.8979: mean |d| 0.235 (<= 1.0), 0 px over 40, 0.00 rig px (the count / s²; <= 50), 0 px over 80 (reported)
[check]   seam (i): setup pose at 60x64, scale 0.8979: mean |d| 0.197 (<= 1.0), 0 px over 40, 0.00 rig px (the count / s²; <= 50), 0 px over 80 (reported)
[check]   seam (u): setup pose at 60x64, scale 0.8979: mean |d| 0.199 (<= 1.0), 0 px over 40, 0.00 rig px (the count / s²; <= 50), 0 px over 80 (reported)
[check]   BREATH_VISIBLE: PASS — torso_parts topwear; torso_heat_mean 11.231; torso_floor 3.809; feet_parts shoes; feet_heat_max 0; feet_ceiling 0
[check]   BLINK_NO_HOLE: PASS — eye_parts eyewhite_r | eyewhite_l; closed group eyes scaley 0.1 from 0.57s to 0.654s; idle_frames_closed 7; box_px 30; hole_px 0; hole_bar 0; patch_max 0; patch_px_over_40 0
[check]   CHAIN_LAG: PASS — chains arm_r0 > arm_r1: period 1s, phase 0.000 0.100, amp 0.500 1.000 | skirt0_ctl > skirt1_ctl: period 1s, phase 0.000 0.100, amp 1.000 2.000; lags arm_r0 > arm_r1 +0.100 | skirt0_ctl > skirt1_ctl +0.100; min_step 0.1; step_floor 0.001; other_period none; unread none; first_violation null
[check]   TIP_OVER_ROOT: PASS — instrument geometry; parts part bottomwear, root_rig_px 0.069, tip_rig_px 0.263, ratio 3.809 | part forearm_r, unmeasured a limb segment (config.limbs.arm_r), rigid on its one bone "arm_r1": it turns at its joint and does not hang, so it is not held to the bar | part upperarm_r, unmeasured a limb segment (config.limbs.arm_r), rigid on its one bone "arm_r0": it turns at its joint and does not hang, so it is not held to the bar; ratio_floor 1.4725
[check]   STILL_REGIONS_DARK: PASS — face parts face, head_bone head, instrument geometry, still_slots slot face, max_rig_px 2.538e-15, rms_rig_px 8.515e-16, max_rig_px 2.538e-15, at null, rms_rig_px 8.515e-16, tolerance_rig_px 7.034e-13, crossing none, driven_slots none; feet parts shoes, instrument geometry, still_slots slot shoes, max_rig_px 0, rms_rig_px 0, max_rig_px 0, at null, rms_rig_px 0, tolerance_rig_px 3.517e-13, crossing none
[check]   TEXTURE_STRETCH: PASS — meshes 1; triangles 30; frames 13; severity 1.068; severity_ceiling 1.926544; worst slot bottomwear, triangle 13, vertices 14 | 13 | 20, edge 14 | 13, frame 10, ratio 0.936; max_ratio 1.063; min_ratio 0.936; per_mesh slot bottomwear, triangles 30, max_ratio 1.063, max_at triangle 13 (vertices 14 13 20), edge 14-13, idle frame 4, min_ratio 0.936, min_at triangle 13 (vertices 14 13 20), edge 14-13, idle frame 10, severity 1.068
[check]   ANIMATIONS_DO_NOT_FOLD: PASS — 2 animation(s) read by rigc render --folds at 12 fps (idle, speak): 0 folding mesh(es), 0 not declared in may_fold (<= 0)
[check]   FEET_STAY_LEVEL: SKIP — no frame of "idle", "speak" turns a bone above "anchor" (which "shoes" rides), so no foot was seen while its leg was posed; 2 animation(s) read by rigc render --folds --geometry at 12 fps (idle, speak)
[check]     foot  "shoes" on "anchor" (hangs from "root"): SKIP, 0 posed frame(s), so nothing was measured
[check]   STRESS_OFF_CHAIN: SKIP — "forearm_r": a limb segment (config.limbs.arm_r), held to its one bone "arm_r1" by LIMB_ONE_BONE, so it turns rigidly by construction; "upperarm_r": a limb segment (config.limbs.arm_r), rigid on its one bone "arm_r0" by LIMB_ONE_BONE, so it turns rigidly by construction
[check]   LIMB_ONE_BONE: PASS — 2 limb part(s), each bound in rig.json to its one bone with weight 1 (a region on it, or a mesh weighted to it alone)
[check]     limb  "forearm_r" (arm_r) on "arm_r1": PASS
[check]     limb  "upperarm_r" (arm_r) on "arm_r0": PASS
[check]   RECOMPOSITE_HOLES: REPORTED — error_px 2503; uncovered_error_px 2503; hole_count 1; largest px 2503, box 0,0 64x64, borders topwear 96 px | hair_back 84 px | bottomwear 72 px | hairpin 48 px | shoes 48 px | face 21 px | mouth 8 px
[check]   RECOMPOSITE_HOLES (outfit_b): REPORTED — mean_abs 120.573; error_px 2623; uncovered_error_px 2623; hole_count 1; largest px 2623, box 0,0 64x64, borders topwear 96 px | hair_back 84 px | bottomwear 76 px | shoes 48 px | face 28 px | mouth 8 px
[check]   RECOMPOSITE_HOLES (a): REPORTED — mean_abs 112.329; error_px 2443; uncovered_error_px 2443; hole_count 1; largest px 2443, box 0,0 64x64, borders topwear 86 px | hair_back 84 px | bottomwear 72 px | shoes 48 px | hairpin 45 px | face 15 px | mouth 12 px
[check]   RECOMPOSITE_HOLES (i): REPORTED — mean_abs 113.8; error_px 2475; uncovered_error_px 2475; hole_count 1; largest px 2475, box 0,0 64x64, borders topwear 96 px | hair_back 84 px | bottomwear 72 px | shoes 48 px | hairpin 46 px | face 17 px | mouth 16 px
[check]   RECOMPOSITE_HOLES (u): REPORTED — mean_abs 113.8; error_px 2475; uncovered_error_px 2475; hole_count 1; largest px 2475, box 0,0 64x64, borders topwear 96 px | hair_back 84 px | bottomwear 72 px | shoes 48 px | hairpin 47 px | face 19 px | mouth 16 px
[check]   gate: rig-play green (cli.ts, the spine-core 4.3.13 round trip)
[check]   wrote scratch/outfits/out/check/gate_spine-html.txt, scratch/outfits/out/check/contact.png, scratch/outfits/out/check/motion_heat.png, scratch/outfits/out/check/check.json, scratch/outfits/out/check/build/, scratch/outfits/out/check/idle_frames/
[check] check: PASS; 11 of 13 bar(s) measured, 2 skipped (FEET_STAY_LEVEL, STRESS_OFF_CHAIN)
build: PASS — the packed atlas is the artifact; parts/ and rig/ are the intermediates it was made from
  pack: skeleton.png 104x120, 19 region(s), 65.6% covered, padding 2, page edges free, shape polygon; page opaque 25.8% (alpha > 0) — spineboy yardstick 1024x256, 40 region(s), 45.8% opaque (alpha > 0), a reference and not a bar
  scratch/outfits/out/check/build/skeleton.json
  scratch/outfits/out/check/build/skeleton.atlas
  scratch/outfits/out/check/build/skeleton.png
```

### 2. Check the `outfit_b` set directly (`--set outfit_b`) and render `speak`

```sh
rig-parts check --rig scratch/outfits/out/rig --parts scratch/outfits/out --out scratch/outfits/check_outfit_b --set outfit_b
rigc render --candidate scratch/outfits/out/check/build --animation speak --fps 12 --max 64 --out scratch/outfits/speak_frames
```

Verbatim output of `rigc render` on the `speak` animation:

```text
rigc render
  ..    skeleton <project>/scratch/outfits/out/check/build/skeleton.json
  ..    atlas    <project>/scratch/outfits/out/check/build/skeleton.atlas
  ..    poser    rigc core — <project>/scratch/outfits/out/check/build/skeleton.model.json
  ..    60x64px at 12 fps, 1 set(s) -> <project>/scratch/outfits/speak_frames
  ..    speak            13 frame(s), 1.000s + contact.png -> <project>/scratch/outfits/speak_frames/speak
rigc: wrote <project>/scratch/outfits/speak_frames/frames.json
```

The selftest control `BU173_OUTFIT_TRANSACTION_KEEPS_BONES_DRAWN_FACE_AXIS_IDLE_RE_RUNS_CLOTHING_MESH_COMPOSES_VISEMES_AND_REFUSES_SLEEVE_TRAPS` in `selftest.ts` gates every digest, set binding, precedence rule, and wide-sleeve refusal in this document on every run.
