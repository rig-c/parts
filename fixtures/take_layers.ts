/** Public generated rectangles for verified cross-run layer replacement (#866). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleConfig, paint, C, WHITE, writeRun, type RunLayerSpec } from './assemble_fixture.ts';
import { encodePngBytes } from '../src/raster/png.ts';

export function writeTakeFixture(dir: string): Record<string, unknown> {
  mkdirSync(dir, { recursive: true });
  const block = (name: string, depth: number, box: number[]): RunLayerSpec => ({ name, depth, rects: [{ x0: box[0], y0: box[1], x1: box[2], y1: box[3], colour: C }] });
  writeRun(join(dir, 'full'), [block('topwear', 0.7, [8, 32, 56, 56]), block('face', 0.5, [8, 8, 56, 32]), block('front hair', 0.3, [8, 8, 32, 16]), block('eyewhite-r', 0.1, [36, 16, 44, 24]), block('eyewhite-l', 0.05, [44, 16, 52, 24])]);
  writeRun(join(dir, 'donor'), [block('front hair', 0.2, [8, 8, 32, 16])]);
  const target = paint(64, 64, WHITE, [{ x0: 8, y0: 8, x1: 56, y1: 56, colour: C }]);
  writeFileSync(join(dir, 'painting.png'), encodePngBytes(target));
  const input = { ...target, data: new Uint8ClampedArray(target.data) };
  input.data[(63 * 64) * 4] = 0; // Outside the taken support and its margin.
  writeFileSync(join(dir, 'donor-input.png'), encodePngBytes(input));
  writeFileSync(join(dir, 'donor', 'meta.json'), JSON.stringify({ prompt_id: 'generated-prompt', seed: 43 }));
  const cfg = assembleConfig({ plan: [['body', 'full', 'topwear'], ['face', 'full', 'face'], ['hair', 'full', 'front hair']], extend: [], rigScale: 1, resolution: 64 });
  delete (cfg.seethrough as Record<string, unknown>).head_box;
  (cfg.assemble as Record<string, unknown>).take = [{ run: 'full', run_dir: 'donor', st_input: 'donor-input.png', tags: ['front hair'] }];
  writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg));
  return cfg;
}

/** #869: hollow head + donor hair whose scalar depth contradicts its head role. */
export function writeTakeFallbackFixture(dir: string): Record<string, unknown> {
  mkdirSync(dir, { recursive: true });
  const block = (name: string, depth: number, box: number[], colour = C): RunLayerSpec => ({ name, depth, rects: [{ x0: box[0], y0: box[1], x1: box[2], y1: box[3], colour }] });
  const hair = [40, 100, 120] as typeof C;
  const full = [block('topwear', 0.7, [8, 32, 52, 60]), block('face', 0.5, [8, 8, 56, 32]),
    block('handwear-r', 0.32, [52, 40, 64, 60]), block('front hair', 0.3, [8, 8, 32, 20], hair)];
  const donor = [block('front hair', 0.6, [8, 8, 32, 20], hair), block('headwear', 0.25, [24, 4, 40, 20])];
  writeRun(join(dir, 'full'), full);
  writeRun(join(dir, 'donor'), donor);
  writeRun(join(dir, 'head'), [block('face', 0.5, [16, 24, 48, 32]), block('mouth', 0.1, [32, 24, 48, 34])]);
  writeFileSync(join(dir, 'painting.png'), encodePngBytes(paint(64, 64, WHITE,
    [...full.filter(l => l.name !== 'front hair'), donor[1], donor[0]].flatMap(l => l.rects))));
  writeFileSync(join(dir, 'donor', 'meta.json'), JSON.stringify({ prompt_id: 'generated-fallback', seed: 43 }));
  const cfg = assembleConfig({ plan: [], extend: [], headBox: [0, 0, 64, 64], rigScale: 1, resolution: 64 });
  (cfg.assemble as Record<string, unknown>).take = [{ run: 'full', run_dir: 'donor', st_input: 'painting.png', tags: ['front hair', 'headwear'] }];
  writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg));
  return cfg;
}
