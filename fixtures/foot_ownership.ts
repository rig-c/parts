/** Generated geometry for issue #638; no painting or corpus is imported. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleConfig, C, flatPainting, HEAD_LAYERS, type RunLayerSpec, writeAssembleFixture, writeRun } from './assemble_fixture.ts';

export type FootLayout = 'islands' | 'connected' | 'per-side';

/** Two legs and explicit ankle-to-toe bones, all coordinates in the 64x64 rig frame. */
export function writeFootOwnershipFixture(dir: string, layout: FootLayout = 'islands'): void {
  const legs: RunLayerSpec = { name: 'legwear', depth: 0.6, rects: [
    { x0: 22, y0: 10, x1: 30, y1: 50, colour: C },
    { x0: 34, y0: 10, x1: 42, y1: 50, colour: C },
  ] };
  const shoe = (x: number, y: number) => ({ x0: x - 2, y0: y - 2, x1: x + 10, y1: y + 4, colour: C });
  const layers = (raised: boolean): RunLayerSpec[] => {
    const r = shoe(raised ? 46 : 26, raised ? 30 : 50), l = shoe(38, 50);
    return [raised ? { ...legs, rects: [
      { x0: 22, y0: 10, x1: 30, y1: 34, colour: C },
      { x0: 30, y0: 26, x1: 46, y1: 34, colour: C },
      legs.rects[1],
    ] } : legs, ...(layout === 'per-side'
      ? [{ name: 'author:shoe-r', depth: 0.4, rects: [r] }, { name: 'author:shoe-l', depth: 0.4, rects: [l] }]
      : [{ name: 'footwear', depth: 0.4, rects: [r, l, ...(layout === 'connected' && raised ? [{ x0: 44, y0: 33, x1: 46, y1: 49, colour: C }] : [])] }])];
  };
  const cfg = assembleConfig({ plan: [
    ['legs', 'full', 'legwear'],
    ...(layout === 'per-side' ? [['shoe_r', 'full', 'author:shoe-r'], ['shoe_l', 'full', 'author:shoe-l']] : [['shoes', 'full', 'footwear']]),
  ], extend: [] });
  cfg.bones = [
    { name: 'hip', parent: 'root', at: [32, 10] },
    { name: 'arm_r0', parent: 'hip', at: [20, 2] },
    { chain: 'leg_r', parent: 'hip', points: [[26, 10], [26, 30]], tip: [26, 50] },
    { chain: 'leg_l', parent: 'hip', points: [[38, 10], [38, 30]], tip: [38, 50] },
    { name: 'foot_r', parent: 'leg_r1', at: [26, 50], tip: [34, 50], inherit: 'noRotationOrReflection' },
    { name: 'foot_l', parent: 'leg_l1', at: [38, 50], tip: [46, 50], inherit: 'noRotationOrReflection' },
  ];
  cfg.limbs = Object.fromEntries(['r', 'l'].map((s) => [`leg_${s}`, { segments: [
    { part: `thigh_${s}`, from: 'legs', bone: `leg_${s}0` },
    { part: `shin_${s}`, from: 'legs', bone: `leg_${s}1`, joint: 'knee' },
    { part: `foot_${s}`, from: layout === 'per-side' ? `shoe_${s}` : 'shoes', bone: `foot_${s}`, joint: 'ankle', cap_shape: 'disc' },
  ] }]));
  cfg.regions = Object.fromEntries(['r', 'l'].flatMap((s) => [[`thigh_${s}`, `leg_${s}0`], [`shin_${s}`, `leg_${s}1`], [`foot_${s}`, `foot_${s}`]]));
  (cfg.assemble as Record<string, unknown>).alternates = ['r', 'l'].map((s) => ({
    name: `step_${s}`, source: 'painting.png', full: 'step', head: 'head', skeleton: 'pose.json', parts: [`thigh_${s}`, `shin_${s}`, `foot_${s}`],
  }));
  writeAssembleFixture(dir, cfg, flatPainting(), { full: layers(false), head: HEAD_LAYERS });
  writeRun(join(dir, 'step'), layers(true));
  writeFileSync(join(dir, 'pose.json'), `${JSON.stringify({ width: 64, height: 64, points: {
    nose: [32, 1], neck: [32, 2], r_shoulder: [20, 2], r_elbow: [16, 6], r_wrist: [14, 9], l_shoulder: [44, 2], l_elbow: [48, 6], l_wrist: [50, 9],
    r_eye: [31, 1], l_eye: [33, 1], r_ear: [30, 1], l_ear: [34, 1],
    r_hip: [26, 10], r_knee: [26, 30], r_ankle: [46, 30], l_hip: [38, 10], l_knee: [38, 30], l_ankle: [38, 50],
  } }, null, 2)}\n`);
}
