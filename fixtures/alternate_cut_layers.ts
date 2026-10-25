/**
 * Public rectangles: a cut's parent and piece choose their layers independently,
 * and the rig carries synthetic data for all 10 `check --set raised` bars
 * (`gate`, `loop`, `seam`, `BREATH_VISIBLE`, `BLINK_NO_HOLE`, `CHAIN_LAG`,
 * `TIP_OVER_ROOT`, `STILL_REGIONS_DARK`, `TEXTURE_STRETCH`,
 * `ANIMATIONS_DO_NOT_FOLD`).
 *
 * - `topwear` `[8, 8, 40, 48)` (`32x40`): polygon `[[24, 8], [40, 8], [40, 48], [24, 48]]`
 *   cuts its right half (`16x40`) into `sleeve`. In `step`, `author:raised`
 *   occupies `[8, 8, 24, 48)` and `[24, 8, 32, 32)` (`8x24` inside the polygon),
 *   leaving `(36, 40)` as the old-sleeve probe. Both ride `anchor` (`translatey`
 *   amp `2`, `BREATH_VISIBLE`).
 * - `bottomwear` `[44, 28, 56, 52)` (`12x24`): `skirt`, a lattice mesh (`grid: 8,
 *   r: 80`) on the 2-bone chain `skirt0` -> `skirt1` (`[[50, 28], [50, 40]]` ->
 *   `[50, 52]`), swung with `amps: [4, 6], lag: 0.1` (`CHAIN_LAG`,
 *   `TIP_OVER_ROOT`, `TEXTURE_STRETCH`).
 * - `head` run (`head_box: [32, 0, 96, 64]` maps `[x0, y0, x1, y1)` to rig
 *   `[16 + x0 / 2, y0 / 2, 16 + x1 / 2, y1 / 2)`): `face` `[48, 16, 64, 40)` ->
 *   rig `[40, 8, 48, 20)` (`8x12`) on `head` (`STILL_REGIONS_DARK`) and
 *   `eyewhite-r` `[52, 24, 60, 32)` -> rig `[42, 12, 46, 16)` (`4x4`, inside
 *   `face`) on `eye` (`blink.squash = 0.1`, `BLINK_NO_HOLE`).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleConfig, writeAssembleFixture, writeRun, flatPainting, C } from './assemble_fixture.ts';
import { encodePngBytes } from '../src/raster/png.ts';

export function writeAlternateCutLayerFixture(dir: string): void {
  const base = { name: 'topwear', depth: 0.6, rects: [{ x0: 8, y0: 8, x1: 40, y1: 48, colour: C }] };
  const skirt = { name: 'bottomwear', depth: 0.55, rects: [{ x0: 44, y0: 28, x1: 56, y1: 52, colour: C }] };
  const head = [
    { name: 'face', depth: 0.5, rects: [{ x0: 48, y0: 16, x1: 64, y1: 40, colour: C }] },
    { name: 'eyewhite-r', depth: 0.4, rects: [{ x0: 52, y0: 24, x1: 60, y1: 32, colour: C }] },
  ];
  const author = { name: 'author:raised', depth: 0.5, rects: [{ x0: 8, y0: 8, x1: 24, y1: 48, colour: C }, { x0: 24, y0: 8, x1: 32, y1: 32, colour: C }] };
  const cfg = assembleConfig({
    plan: [
      ['body', 'full', 'topwear'],
      ['skirt', 'full', 'bottomwear'],
      ['face', 'head', 'face'],
      ['eyewhite', 'head', 'eyewhite-r'],
    ],
    extend: [],
  });
  const cut = { from: 'body', into: 'sleeve', polygon: [[24, 8], [40, 8], [40, 48], [24, 48]], overlap: 0, draw: 'front' };
  const ass = cfg.assemble as Record<string, unknown>;
  ass.cuts = [cut];
  ass.alternates = [{ name: 'raised', source: 'raised.png', full: 'step', head: 'head', parts: ['body', 'sleeve'] }];
  cfg.bones = [
    { name: 'anchor', parent: 'root', at: [0, 0] },
    { name: 'head', parent: 'root', at: [44, 14] },
    { name: 'eye', parent: 'head', at: [44, 14] },
    { chain: 'skirt', parent: 'root', points: [[50, 28], [50, 40]], tip: [50, 52] },
  ];
  cfg.regions = { body: 'anchor', sleeve: 'anchor', face: 'head', eyewhite: 'eye' };
  cfg.meshes = { skirt: { segments: ['skirt0', 'skirt1'], grid: 8, r: 80 } };
  cfg.motion = {
    duration: 1,
    tracks: [
      { bone: 'anchor', prop: 'translatey', amp: 2, period: 1, phase: 0 },
      { chain: 'skirt', amps: [4, 6], period: 1, phase: 0, lag: 0.1 },
    ],
    blink: { eyes: ['eye'], t: 0.3, squash: 0.1 },
  };
  writeAssembleFixture(dir, cfg, flatPainting(), { full: [base, skirt], head });
  writeFileSync(join(dir, 'raised.png'), encodePngBytes(flatPainting()));
  writeRun(join(dir, 'step'), [base, author]);
}
