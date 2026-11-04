/** Public generated region-take fixture. Run directories and PNGs are generated, never tracked. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleConfig, C, Z, WHITE, paint, writeRun } from './assemble_fixture.ts';
import { encodePngBytes, readPng } from '../src/raster/png.ts';

/** The missing material is 12x8 pixels. A wrong-colour donor protrusion of
 * 4x8 pixels touches its left edge and must never enter the derived region. */
export function writeTakeRegionFixture(dir: string): Record<string, unknown> {
  mkdirSync(dir, { recursive: true });
  const body = { x0: 8, y0: 32, x1: 56, y1: 56, colour: C };
  const face = { name: 'face', depth: 0.5, rects: [{ x0: 8, y0: 8, x1: 56, y1: 32, colour: C }] };
  writeRun(join(dir, 'full'), [{ name: 'topwear', depth: 0.7, rects: [body] }, face,
    { name: 'eyewhite-r', depth: 0.1, rects: [{ x0: 36, y0: 16, x1: 44, y1: 24, colour: C }] },
    { name: 'eyewhite-l', depth: 0.05, rects: [{ x0: 44, y0: 16, x1: 52, y1: 24, colour: C }] },
  ]);
  writeRun(join(dir, 'donor'), [{ name: 'topwear', depth: 0.7, rects: [body, { x0: 4, y0: 36, x1: 8, y1: 44, colour: Z }] }]);
  const basePath = join(dir, 'full', 'parts', 'topwear.png');
  const base = readPng(basePath);
  for (let y = 36; y < 44; y++) for (let x = 8; x < 20; x++) base.data[((y - 32) * base.width + x - 8) * 4 + 3] = 0;
  writeFileSync(basePath, encodePngBytes(base));
  writeFileSync(join(dir, 'painting.png'), encodePngBytes(paint(64, 64, WHITE, [body, ...face.rects])));
  const cfg = assembleConfig({ plan: [['body', 'full', 'topwear'], ['face', 'full', 'face']], extend: [], rigScale: 1, resolution: 64 });
  delete (cfg.seethrough as Record<string, unknown>).head_box;
  (cfg.assemble as Record<string, unknown>).take = [{ run: 'full', run_dir: 'donor', st_input: 'painting.png', part: 'body', seed: [12, 40] }];
  writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg));
  // Authored fixture limit. Production takes the same value from requirements.
  writeFileSync(join(dir, 'requirements.json'), JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 1, targets: [], requirements: [], setup_painting: { rgb_tolerance: 0, regions: [{ name: 'stage', box: [0, 0, 64, 64], max_pixels: 0 }] } }));
  return cfg;
}
