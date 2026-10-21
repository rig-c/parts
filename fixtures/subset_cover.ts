/** Synthetic, hand-counted source for issue #637; no painting or corpus is imported. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleConfig, C, HEAD_LAYERS, NAVY, paint, type RunLayerSpec, writeAssembleFixture, writeRun } from './assemble_fixture.ts';

/**
 * A 8x40 limb rooted at (26,10), cut at (26,30). A diagonal cover occupies
 * rows 8..(15 + x - 22) over its eight columns: 5+6+...+12 = 68 limb pixels.
 * Both base and step layers contain the whole limb; only the painting hides it.
 */
export function writeSubsetCoverFixture(dir: string, cover = true, carry = false): void {
  const limb: RunLayerSpec = { name: 'legwear', depth: 0.6, rects: [{ x0: 22, y0: 10, x1: 30, y1: 50, colour: C }] };
  const covering: RunLayerSpec = { name: 'bottomwear', depth: 0.4, rects: Array.from({ length: 8 }, (_, i) => ({ x0: 22 + i, y0: 8, x1: 23 + i, y1: 15 + i, colour: NAVY })) };
  const cfg = assembleConfig({ plan: [['legs', 'full', 'legwear'], ...(cover ? [['bottomwear', 'full', 'bottomwear']] : [])], extend: [] });
  cfg.bones = [
    { name: 'hip', parent: 'root', at: [26, 10] },
    { chain: 'leg_r', parent: 'hip', points: [[26, 10], [26, 30]], tip: [26, 50] },
  ];
  cfg.limbs = { leg_r: { segments: [{ part: 'thigh', from: 'legs', bone: 'leg_r0' }, { part: 'shin', from: 'legs', bone: 'leg_r1', joint: 'knee' }] } };
  cfg.regions = { thigh: 'leg_r0', shin: 'leg_r1', ...(cover ? { bottomwear: 'hip' } : {}) };
  (cfg.assemble as Record<string, unknown>).alternates = [{ name: 'step', source: 'painting.png', full: 'step', head: 'head', parts: ['thigh', 'shin', ...(cover && carry ? ['bottomwear'] : [])] }];
  const rects = [limb, ...(cover ? [covering] : [])].flatMap((l) => l.rects);
  const painting = paint(128, 128, C, rects.map((r) => ({ ...r, x0: r.x0 * 2, y0: r.y0 * 2, x1: r.x1 * 2, y1: r.y1 * 2 })));
  const full = [limb, ...(cover ? [covering] : [])];
  writeAssembleFixture(dir, cfg, painting, { full, head: HEAD_LAYERS });
  writeRun(join(dir, 'step'), full);
}

/**
 * Generated rectangles: a horizontal shin crosses the other leg; the ankle's
 * default cap copies upper art across that crossing. The connected shoe layer
 * has a two-column connector and a standing shoe. No corpus data is used.
 */
export function writeSubsetCapFixture(dir: string): void {
  const cfg = assembleConfig({ plan: [['legs', 'full', 'legwear'], ['shoes', 'full', 'footwear']], extend: [] });
  cfg.bones = [
    {"name": "hip", "parent": "root", "at": [32, 10]},
    {"name": "arm_r0", "parent": "hip", "at": [20, 2]},
    {"chain": "leg_r", "parent": "hip", "points": [[26, 10], [26, 30]], "tip": [26, 50]},
    {"chain": "leg_l", "parent": "hip", "points": [[38, 10], [38, 30]], "tip": [38, 50]},
    {"name": "foot_r", "parent": "leg_r1", "at": [26, 50], "tip": [34, 50], "inherit": "noRotationOrReflection"},
    {"name": "foot_l", "parent": "leg_l1", "at": [38, 50], "tip": [46, 50], "inherit": "noRotationOrReflection"},
  ];
  cfg.limbs = {
    "leg_r": {"segments": [{"part": "thigh_r", "from": "legs", "bone": "leg_r0"}, {"part": "shin_r", "from": "legs", "bone": "leg_r1", "joint": "knee"}, {"part": "foot_r", "from": "shoes", "bone": "foot_r", "joint": "ankle"}]},
    "leg_l": {"segments": [{"part": "thigh_l", "from": "legs", "bone": "leg_l0"}, {"part": "shin_l", "from": "legs", "bone": "leg_l1", "joint": "knee"}, {"part": "foot_l", "from": "shoes", "bone": "foot_l", "joint": "ankle"}]},
  };
  cfg.regions = {
    "thigh_r": "leg_r0",
    "shin_r": "leg_r1",
    "foot_r": "foot_r",
    "thigh_l": "leg_l0",
    "shin_l": "leg_l1",
    "foot_l": "foot_l",
  };
  (cfg.assemble as Record<string, unknown>).alternates = [{"name": "step_r", "source": "painting.png", "full": "step", "head": "head", "skeleton": "pose.json", "parts": ["thigh_r", "shin_r", "foot_r"]}, {"name": "step_l", "source": "painting.png", "full": "step", "head": "head", "skeleton": "pose.json", "parts": ["thigh_l", "shin_l", "foot_l"]}];
  const leg = (rects: number[][]): RunLayerSpec => ({ name: 'legwear', depth: 0.6, rects: rects.map(([x0,y0,x1,y1]) => ({x0,y0,x1,y1,colour:C})) });
  const shoe = (rects: number[][]): RunLayerSpec => ({ name: 'footwear', depth: 0.4, rects: rects.map(([x0,y0,x1,y1]) => ({x0,y0,x1,y1,colour:C})) });
  writeAssembleFixture(dir, cfg, paint(128,128,C,[]), {full:[leg([[22,10,30,50],[34,10,42,50]]),shoe([[24,48,48,54]])],head:HEAD_LAYERS});
  writeRun(join(dir,'step'), [leg([[22,10,30,34],[30,26,46,34],[34,10,42,50]]),shoe([[44,28,56,34],[44,34,46,50],[36,48,48,54]])]);
  writeFileSync(join(dir,'pose.json'), JSON.stringify({"width":64,"height":64,"points":{"nose":[32,1],"neck":[32,2],"r_shoulder":[20,2],"r_elbow":[16,6],"r_wrist":[14,9],"l_shoulder":[44,2],"l_elbow":[48,6],"l_wrist":[50,9],"r_eye":[31,1],"l_eye":[33,1],"r_ear":[30,1],"l_ear":[34,1],"r_hip":[26,10],"r_knee":[26,30],"r_ankle":[46,30],"l_hip":[38,10],"l_knee":[38,30],"l_ankle":[38,50]}})+'\n');
}
