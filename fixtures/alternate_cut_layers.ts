/** Public rectangles: a cut's parent and piece choose their layers independently. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleConfig, writeAssembleFixture, writeRun, flatPainting, C, HEAD_LAYERS } from './assemble_fixture.ts';
import { encodePngBytes } from '../src/raster/png.ts';

export function writeAlternateCutLayerFixture(dir: string): void {
  // Parent 32*40; polygon removes its right half (16*40). The author piece
  // occupies only 8*24 inside that polygon, leaving a distinct old-sleeve probe.
  const base = { name: 'topwear', depth: 0.6, rects: [{ x0: 8, y0: 8, x1: 40, y1: 48, colour: C }] };
  const author = { name: 'author:raised', depth: 0.5, rects: [{ x0: 8, y0: 8, x1: 24, y1: 48, colour: C }, { x0: 24, y0: 8, x1: 32, y1: 32, colour: C }] };
  const cfg = assembleConfig({ plan: [['body', 'full', 'topwear']], extend: [] });
  const cut = { from: 'body', into: 'sleeve', polygon: [[24, 8], [40, 8], [40, 48], [24, 48]], overlap: 0, draw: 'front' };
  const ass = cfg.assemble as Record<string, unknown>;
  ass.cuts = [cut];
  ass.alternates = [{ name: 'raised', source: 'raised.png', full: 'step', head: 'head', parts: ['body', 'sleeve'] }];
  cfg.regions = { body: 'anchor', sleeve: 'anchor' };
  cfg.motion = { duration: 1, tracks: [{ bone: 'anchor', prop: 'translatey', amp: 2, period: 1, phase: 0 }] };
  writeAssembleFixture(dir, cfg, flatPainting(), { full: [base], head: HEAD_LAYERS });
  writeFileSync(join(dir, 'raised.png'), encodePngBytes(flatPainting()));
  writeRun(join(dir, 'step'), [base, author]);
}
