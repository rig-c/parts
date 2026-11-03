/**
 * Issue #946: one 64x64 run whose `author:hand` layer is an edited image by
 * the input's own declaration (issue #256). Flat colour blocks; the painting
 * is their union, so the stage assembles it with no other refusal.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleConfig, paint, C, WHITE, writeRun, type RunLayerSpec } from './assemble_fixture.ts';
import { encodePngBytes } from '../src/raster/png.ts';

/** The author layer's file as `writeRun` writes it, relative to the fixture directory. */
export const RECEIPT_AUTHOR_FILE = 'full/parts/author:hand.png';

export function writeEditorReceiptFixture(dir: string, options: { author?: boolean; hidden?: boolean } = {}): Record<string, unknown> {
  mkdirSync(dir, { recursive: true });
  const block = (name: string, depth: number | null, box: number[]): RunLayerSpec => ({ name, depth, rects: [{ x0: box[0], y0: box[1], x1: box[2], y1: box[3], colour: C }] });
  const author = options.author !== false;
  const layers = [block('topwear', 0.7, [8, 32, 56, 56]), block('face', 0.5, [8, 8, 56, 32]), block('eyewhite-r', 0.1, [36, 16, 44, 24]), block('eyewhite-l', 0.05, [44, 16, 52, 24])];
  if (author) layers.push(block('author:hand', 0.3, [20, 40, 32, 52]));
  if (options.hidden === true) layers.push(block('face:hidden', null, [12, 12, 20, 20]));
  writeRun(join(dir, 'full'), layers);
  writeFileSync(join(dir, 'painting.png'), encodePngBytes(paint(64, 64, WHITE, [{ x0: 8, y0: 8, x1: 56, y1: 56, colour: C }])));
  const plan: Array<[string, string, string]> = [['body', 'full', 'topwear'], ['face', 'full', 'face']];
  if (author) plan.push(['hand', 'full', 'author:hand']);
  const cfg = assembleConfig({ plan, extend: [], rigScale: 1, resolution: 64 });
  delete (cfg.seethrough as Record<string, unknown>).head_box;
  writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg));
  return cfg;
}
