/** Public source blocks: an 8x2 collar strip, absent from the full-run neck. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPng, writePng } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { readLayerTag } from '../src/tags.ts';
import type { Layer, LayerSet } from '../src/layers.ts';
import type { Geometry } from '../src/assemble.ts';
import type { PlanEntry } from '../src/config.ts';
import { armSplitConfigText } from './arm_split_upgrade.ts';
import { MERGED_ARM_KEY_SKELETON, MERGED_ARM_SLEEVE_RGB, MERGED_ARM_HAND_RGB, MERGED_ARM_DISTINCT_DRAPE_RGB } from './assemble_fixture.ts';

export function neckDraftFixture(strip = true) {
  const N = 64;
  const block = (x: number, y: number, w: number, h: number, rgb: number[]): Raster => {
    const p = newRaster(N, N);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) p.data.set([...rgb, 255], (j * N + i) * 4);
    return p;
  };
  const skin = [220, 160, 100], ink = [30, 40, 50];
  const clean = block(28, 24, 8, 14, skin), dirty = { ...clean, data: clean.data.slice() };
  if (strip) for (let y = 38; y < 40; y++) for (let x = 24; x < 32; x++) dirty.data.set([...ink, 255], (y * N + x) * 4);
  const makeLayer = (name: string, pixels: Raster, depth: number, drawOrder: number): Layer => ({ name, tag: readLayerTag(name)!, pixels, file: null, left: 0, top: 0, right: N, bottom: N, depth, drawOrder, opaquePx: pixels.data.filter((v, i) => i % 4 === 3 && v > 8).length });
  const full: LayerSet = { source: 'public-full', form: 'wrapper', canvas: { w: N, h: N }, hidden: [], layers: [makeLayer('topwear', block(16, 38, 32, 22, [70, 100, 160]), 0.7, 0), makeLayer('neck', clean, 0.5, 1), makeLayer('face', block(24, 8, 16, 16, skin), 0.3, 2)] };
  const head: LayerSet = { ...full, source: 'public-head', layers: [makeLayer('neck', dirty, 0.5, 0), makeLayer('face', block(24, 8, 16, 16, skin), 0.3, 1)] };
  const geometry: Geometry = { sourceW: N, sourceH: N, resolution: N, headBox: [0, 0, N, N], rigScale: 1 };
  const plan: PlanEntry[] = [['shirt', 'full', 'topwear'], ['throat', 'head', 'neck'], ['portrait', 'head', 'face']];
  return { full, head, geometry, plan, block, skin, ink };
}

/** Actual wrapper files for CLI/readers; scalar levels are constant and hand-computable. */
export function writeNeckDraftFixture(dir: string, strip = true) {
  const f = neckDraftFixture(strip);
  const fullDir = join(dir, 'full'), headDir = join(dir, 'head');
  for (const [home, set] of [[fullDir, f.full], [headDir, f.head]] as const) {
    mkdirSync(home, { recursive: true });
    const layers = set.layers.map(l => {
      const filename = `${l.name}.png`, depth_filename = `${l.name}_depth.png`;
      writePng(join(home, filename), l.pixels);
      const scalar = newRaster(64, 64), level = l.name === 'neck' ? 204 : 102;
      for (let i = 0; i < 64 * 64; i++) scalar.data.set([level, level, level, 255], i * 4);
      writePng(join(home, depth_filename), scalar);
      return { name: l.name, filename, depth_filename, left: 0, top: 0, right: 64, bottom: 64, depth_median: l.depth };
    });
    writeFileSync(join(home, 'layers.json'), JSON.stringify({ width: 64, height: 64, layers }));
  }
  const painting = f.block(0, 0, 64, 64, [245, 245, 245]);
  for (const l of [f.full.layers[1], f.full.layers[0], f.full.layers[2]]) for (let i = 0; i < 64 * 64; i++) if (l.pixels.data[i * 4 + 3] > 0) painting.data.set(l.pixels.data.subarray(i * 4, i * 4 + 4), i * 4);
  const source = join(dir, 'painting.png'); writePng(source, painting);
  const config = {
    key: 'neck_blocks', seethrough: { resolution: 64, steps: 1, seed: 1, offload: true, head_box: [0, 0, 64, 64] },
    assemble: { rig_scale: 1, plan: f.plan, extend_below_crop: [] }, depth: { zScale: 20 },
    bones: [{ name: 'hip', parent: 'root', at: [32, 56] }, { name: 'chest', parent: 'hip', at: [32, 44] }, { name: 'neck', parent: 'chest', at: [32, 32] }, { name: 'head', parent: 'neck', at: [32, 20] }],
    meshes: { shirt: { grid: 4, r: 3, segments: [['chest', [32, 44], [32, 60]]] }, throat: { grid: 4, r: 3, segments: [['chest', [32, 44], [32, 32]], ['head', [32, 20], [32, 8]]] }, portrait: { grid: 4, r: 3, segments: [['head', [32, 20], [32, 8]]] } },
    regions: {}, motion: { duration: 2, tracks: [{ bone: 'hip', prop: 'rotate', amp: 0, period: 2, phase: 0 }] },
    turn: { pivot: 10, roles: { portrait: 'surface', throat: 'surface' }, body: { pivot: 10, bone: 'chest', counter: 0.1, grid: [5, 5], roles: { shirt: 'surface', throat: 'surface' } } },
  };
  const configPath = join(dir, 'config.json'); writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return { ...f, source, config, configPath, fullDir, headDir };
}

/** File-backed pose plus the existing hand-counted merged arm, registered on the 64px run. */
export function writeNeckDraftReviewFixture(dir: string) {
  const f = writeNeckDraftFixture(dir);
  const arm = newRaster(64, 64);
  for (const [x, y, w, h, rgb] of [
    [8, 4, 14, 16, MERGED_ARM_SLEEVE_RGB],
    [10, 20, 10, 6, MERGED_ARM_HAND_RGB],
    [8, 26, 14, 16, MERGED_ARM_DISTINCT_DRAPE_RGB],
  ] as const) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) arm.data.set([...rgb, 255], (j * 64 + i) * 4);
  }
  writePng(join(f.fullDir, 'handwear-r.png'), arm);
  const manifest = JSON.parse(readFileSync(join(f.fullDir, 'layers.json'), 'utf8'));
  manifest.layers.push({ name: 'handwear-r', filename: 'handwear-r.png', left: 0, top: 0, right: 64, bottom: 64, depth_median: 0.35 });
  writeFileSync(join(f.fullDir, 'layers.json'), JSON.stringify(manifest));
  const painting = newRaster(64, 64);
  painting.data.set(readPng(f.source).data);
  for (let i = 0; i < 64 * 64; i++) if (arm.data[i * 4 + 3] > 0) painting.data.set(arm.data.subarray(i * 4, i * 4 + 4), i * 4);
  writePng(f.source, painting);
  const config = JSON.parse(readFileSync(f.configPath, 'utf8'));
  config.generation = JSON.parse(armSplitConfigText()).generation;
  config.generation.control.skeleton = 'poses/control.json';
  config.assemble.plan.push(['sleeves', 'full', 'handwear-r']);
  config.regions.sleeves = 'chest';
  mkdirSync(join(dir, 'poses'), { recursive: true });
  const posePath = join(dir, 'poses', 'control.json');
  writeFileSync(posePath, JSON.stringify({ width: 128, height: 128, points: MERGED_ARM_KEY_SKELETON.points }));
  writeFileSync(f.configPath, JSON.stringify(config, null, 2) + '\n');
  return { ...f, posePath };
}
