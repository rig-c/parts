/** Public rectangles for alternate layer selection; no consumer art or motion. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleConfig, writeAssembleFixture, writeRun, paint, C, WHITE, HEAD_LAYERS, type RunLayerSpec } from './assemble_fixture.ts';
import { encodePngBytes } from '../src/raster/png.ts';

export function raisedArmLayer(): RunLayerSpec {
  const layer: RunLayerSpec = { name: 'author:raised', depth: 0.5, rects: [{ x0: 20, y0: 16, x1: 44, y1: 24, colour: C }] };
  // Pixel centres in the strip x+y=60, bounded along x-y; a 45 degree forearm.
  for (let y = 4; y < 24; y++) for (let x = 36; x < 58; x++) {
    if (Math.abs(x + 0.5 + y + 0.5 - 60) <= 5 && x - y >= 16 && x - y <= 44) layer.rects.push({ x0: x, y0: y, x1: x + 1, y1: y + 1, colour: C });
  }
  return layer;
}

export function writeAlternateLayerFixture(dir: string): void {
  const base: RunLayerSpec = { name: 'handwear-r', depth: 0.6, rects: [{ x0: 20, y0: 16, x1: 28, y1: 56, colour: C }] };
  const wrong: RunLayerSpec = { ...base, rects: [{ x0: 48, y0: 16, x1: 56, y1: 56, colour: C }] };
  const author = raisedArmLayer();
  const cfg = assembleConfig({ plan: [['sleeve', 'full', 'handwear-r']], extend: [] });
  cfg.bones = [{ chain: 'arm_r', parent: 'root', points: [[24, 20], [24, 36]], tip: [24, 52] }];
  cfg.regions = { upperarm_r: 'arm_r0', forearm_r: 'arm_r1' };
  cfg.meshes = {};
  cfg.motion = { duration: 1, tracks: [{ bone: 'arm_r0', prop: 'rotate', amp: 0, period: 1, phase: 0 }] };
  cfg.limbs = { arm_r: { segments: [{ part: 'upperarm_r', from: 'sleeve', bone: 'arm_r0' }, { part: 'forearm_r', from: 'sleeve', bone: 'arm_r1', joint: 'elbow' }] } };
  (cfg.assemble as Record<string, unknown>).alternates = [{ name: 'raised', source: 'raised.png', full: 'step', head: 'head', parts: ['upperarm_r', 'forearm_r'], drawn: { arm_r0: 0, arm_r1: 45 } }];
  const picture = (layer: RunLayerSpec) => paint(128, 128, WHITE, layer.rects.map(r => ({ ...r, x0: r.x0 * 2, y0: r.y0 * 2, x1: r.x1 * 2, y1: r.y1 * 2 })));
  writeAssembleFixture(dir, cfg, picture(base), { full: [base], head: HEAD_LAYERS });
  writeFileSync(join(dir, 'raised.png'), encodePngBytes(picture(author)));
  writeRun(join(dir, 'step'), [wrong, author]);
}
