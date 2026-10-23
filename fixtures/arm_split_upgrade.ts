/**
 * Synthetic, hand-counted source for issue #671: a config in the shape `propose` gave it before 1.37.0, built on
 * the current version, where 1.37.0's arm split (issue #490) makes two parts the config never named. Flat colour
 * blocks only, no painting or corpus is imported.
 *
 * The runs are the assemble fixture's flat figure (`FULL_LAYERS`, `HEAD_LAYERS`, 128 px painting, 64 px runs,
 * `rig_scale` 0.5, so a full-run pixel is a rig pixel) with the #490 merged arm layer (`MERGED_ARM_SPLIT_FULL`):
 * `handwear-r` holds a sleeve [8, 22) x [4, 20), a bare hand [10, 20) x [20, 26) and an overgarment drape
 * [8, 22) x [26, 42) in a colour 192.6 off the sleeve's. The config carries `generation.control.skeleton`, a pose
 * file (`pose.json`) with `MERGED_ARM_KEY_SKELETON`'s points, so `assemble` splits the layer into `drape_r`
 * (`full:drape-r`, 224 px, box y 26 h 16), `sleeves` (`full:handwear-r`, 224 px) and `hand_r` (`full:hand-r`,
 * 60 px, box y 20 h 6), and rewrites the plan's lone `["sleeves", "full", "handwear-r"]` row into three
 * (`assemble_fixture.ts` derives every count).
 *
 * The config is the old shape: its plan is the one before the split (no drape or hand row), and `meshes` /
 * `regions` attach every part the plan names — `hair_back`, `topwear`, `bottomwear`, `shoes`, `face`, `sleeves` —
 * and neither `drape_r` nor `hand_r`. Two values are the author's own, which no proposal over these parts writes:
 * `meshes.topwear.grid` 7 (the proposal's lattice spacing here is 2, a figure 56 px tall over the divisor 37) and
 * `regions.sleeves` `"chest"` (the proposal puts the 224-px sleeve, under the 500-px sleeve rule's floor, on the
 * trunk bone nearest its centre, y 12, above the neck: `head`). The text is written by hand in two layouts — the
 * mesh on one line, the regions on one line — so a section rewritten whole, as `JSON.stringify` lays it out,
 * cannot land on the same bytes.
 *
 * What `propose` drafts for the two new parts, by its trunk rule (anything no rule claims rides `head` above the
 * neck line, `chest` above the hip, else `hip`, by its box's centre y): the neck line is the face's chin row 20
 * plus 0.12 of its 12-px height, 21.44 (there is no neck part: the neck layer is a ghost speck); `hand_r`'s centre
 * is 20 + 6 / 2 = 23, between it and the hip, so `chest`; `drape_r`'s is 26 + 16 / 2 = 34, at or below the hip
 * (the proposal's hip bone, read off it in the suite, at y 32), so `hip`. There is no sleeve chain (the sleeve is
 * under 500 px), so `hand_r` takes the trunk rule rather than the tip link of `sleeve_r`. Both are declared bones
 * of the config; the `hip: false` twin is the same config without `hip`, where `drape_r`'s bone is undeclared.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXTEND, flatPainting, HEAD_LAYERS, MERGED_ARM_KEY_SKELETON, MERGED_ARM_SPLIT_FULL, PLAN, writeAssembleFixture } from './assemble_fixture.ts';

/** The pre-1.37 plan: the flat fixture's five rows and the arm layer as one part, as `propose-plan` wrote it before the split. */
export const ARM_SPLIT_OLD_PLAN: Array<[string, 'full' | 'head', string]> = [...PLAN, ['sleeves', 'full', 'handwear-r']];

/**
 * The plan as `assemble` rewrites it (`mergedArmSplitPlan`): the drape behind the sleeve, the hand in front. A config
 * whose plan already says so is the 1.37 shape, which the config loader reads the drape and hand entries against.
 */
export const ARM_SPLIT_NEW_PLAN: Array<[string, 'full' | 'head', string]> = [...PLAN, ['drape_r', 'full', 'drape-r'], ['sleeves', 'full', 'handwear-r'], ['hand_r', 'full', 'hand-r']];

/** The two parts the split adds, with the region bone the module doc derives for each. */
export const ARM_SPLIT_ADDED: ReadonlyArray<readonly [string, string]> = [
  ['drape_r', 'hip'],
  ['hand_r', 'chest'],
];

/** The author's own values, which no proposal over these parts writes. */
export const ARM_SPLIT_HAND_TUNED = { topwearGrid: 7, sleevesRegion: 'chest' } as const;

const GENERATION = {
  checkpoint: 'model.safetensors',
  loras: [],
  trigger: '',
  identity: 'adult woman, long coat',
  sampler: { steps: 4, cfg: 6, sampler: 'euler', scheduler: 'normal' },
  costume: 'long coat',
  negative_extra: '',
  style: 'flat colour',
  negative_pose: 'cropped',
  latent: [128, 128],
  seed: 1,
  pose: 'standing, arms at sides',
  control: { skeleton: 'pose.json', strength: 0.8, end_percent: 0.7 },
};

const line = (v: unknown): string => JSON.stringify(v);

/** The fixture's twins: see {@link armSplitConfigText}. */
export interface ArmSplitOptions {
  /** Declare the `hip` bone (default true). */
  hip?: boolean;
  /** Write {@link ARM_SPLIT_NEW_PLAN} instead of the pre-1.37 plan (default false). */
  splitPlan?: boolean;
}

/**
 * The config's text, by hand. `hip` false leaves the hip bone out (chest then hangs from root and the bottomwear
 * rides chest), the planted twin for a missing part whose proposed bone the config does not declare. `splitPlan`
 * writes the plan's drape and hand rows, every other byte the same.
 */
export function armSplitConfigText(opts: ArmSplitOptions = {}): string {
  const hip = opts.hip ?? true;
  const bones = [
    ...(hip ? ['    { "name": "hip", "parent": "root", "at": [20, 44] },'] : []),
    `    { "name": "chest", "parent": "${hip ? 'hip' : 'root'}", "at": [20, 30] },`,
    '    { "name": "neck", "parent": "chest", "at": [22, 20] },',
    '    { "name": "head", "parent": "neck", "at": [22, 16] }',
  ];
  return [
    '{',
    '  "key": "arm-split-upgrade",',
    `  "generation": ${JSON.stringify(GENERATION, null, 2).split('\n').join('\n  ')},`,
    `  "seethrough": { "resolution": 64, "steps": 1, "seed": 0, "offload": false, "head_box": [32, 0, 96, 64] },`,
    '  "assemble": {',
    '    "rig_scale": 0.5,',
    `    "plan": ${line(opts.splitPlan === true ? ARM_SPLIT_NEW_PLAN : ARM_SPLIT_OLD_PLAN)},`,
    `    "extend_below_crop": ${line(EXTEND)}`,
    '  },',
    '  "bones": [',
    ...bones,
    '  ],',
    '  "meshes": {',
    `    "topwear": { "grid": ${ARM_SPLIT_HAND_TUNED.topwearGrid}, "r": 4, "segments": [["chest", [20, 20], [20, 49]]] }`,
    '  },',
    `  "regions": { "hair_back": "head", "bottomwear": "${hip ? 'hip' : 'chest'}", "shoes": "root", "face": "head", "sleeves": "${ARM_SPLIT_HAND_TUNED.sleevesRegion}" },`,
    '  "motion": { "duration": 1, "tracks": [{ "bone": "chest", "prop": "rotate", "amp": 0, "base": 0, "period": 1, "phase": 0 }] }',
    '}',
    '',
  ].join('\n');
}


/** The fixture in `dir`: `painting.png`, `full/`, `head/`, `pose.json`, and `config.json` as {@link armSplitConfigText} writes it. */
export function writeArmSplitFixture(dir: string, opts: ArmSplitOptions = {}): string {
  writeAssembleFixture(dir, {}, flatPainting(), { full: MERGED_ARM_SPLIT_FULL, head: HEAD_LAYERS });
  const { latent, points } = MERGED_ARM_KEY_SKELETON;
  writeFileSync(join(dir, 'pose.json'), `${JSON.stringify({ width: latent[0], height: latent[1], points }, null, 2)}\n`);
  const text = armSplitConfigText(opts);
  writeFileSync(join(dir, 'config.json'), text);
  return text;
}
