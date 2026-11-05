/** Generated controls for region-local cleanup and counterfactual seam decisions. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleConfig, C, WHITE, paint, writeRun } from '../fixtures/assemble_fixture.ts';
import { writeTakeRegionFixture } from '../fixtures/take_region.ts';
import { fileSha256 } from '../src/editreceipt.ts';
import { deriveTakenRegion } from '../src/takeregion.ts';
import { readLayers } from '../src/layers.ts';
import { readPng, encodePngBytes } from '../src/raster/png.ts';
import { newMask } from '../src/raster/types.ts';
import { warpSupport } from '../src/raster/warp.ts';
import { coreFootprintChanges, takeFootprint } from './check_take_footprint.ts';
import { firstTakeWriters, takeFootprintObserver } from './observe_take_footprint.ts';

export function runTakeCleanupChecks(dir: string, say: (name: string, pass: boolean, detail: string) => void): void {
  for (const mirror of [false, true]) {
    const home = join(dir, mirror ? 'threshold' : 'joined');
    mkdirSync(home, { recursive: true });
    let raw: Record<string, unknown>;
    const seed: [number, number] = mirror ? [40, 20] : [12, 40];
    if (!mirror) {
      raw = writeTakeRegionFixture(home);
      const path = join(home, 'full/parts/topwear.png'), base = readPng(path);
      // A nine-pixel opaque island is rejected until the missing surround joins it.
      for (let y = 37; y < 40; y++) for (let x = 9; x < 12; x++) base.data[((y - 32) * base.width + x - 8) * 4 + 3] = 255;
      writeFileSync(path, encodePngBytes(base));
    } else {
      const old = [{ x0: 4, y0: 4, x1: 12, y1: 12, colour: C }, { x0: 4, y0: 110, x1: 11, y1: 116, colour: C }];
      const added = { x0: 30, y0: 10, x1: 125, y1: 100, colour: C };
      const face = ['face', 'eyewhite-r', 'eyewhite-l'].map((name, i) => ({ name, depth: 0.5 - i / 10, rects: [{ x0: 4 + i * 4, y0: 20, x1: 8 + i * 4, y1: 24, colour: C }] }));
      writeRun(join(home, 'full'), [{ name: 'topwear', depth: 0.7, rects: old }, ...face], 128);
      writeRun(join(home, 'donor'), [{ name: 'topwear', depth: 0.7, rects: [...old, added] }], 128);
      writeFileSync(join(home, 'painting.png'), encodePngBytes(paint(128, 128, WHITE, [...old, added])));
      raw = assembleConfig({ plan: [['body', 'full', 'topwear']], extend: [], resolution: 128, rigScale: 1 });
      delete (raw.seethrough as Record<string, unknown>).head_box;
      (raw.assemble as Record<string, unknown>).take = [{ run: 'full', run_dir: 'donor', st_input: 'painting.png', part: 'body', seed, reference: { painting: 'painting.png', sha256: fileSha256(join(home, 'painting.png')) } }];
      writeFileSync(join(home, 'requirements.json'), JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 1, targets: [], requirements: [], setup_painting: { rgb_tolerance: 0, regions: [{ name: 'stage', box: [0, 0, 128, 128], max_pixels: 0 }] } }));
    }
    const a = raw.assemble as Record<string, unknown>, takes = a.take, config = join(home, 'config.json');
    const input = { source: join(home, 'painting.png'), full: join(home, 'full'), head: null, config, project: 'core' as const, requirements: join(home, 'requirements.json') };
    const output = (name: string) => ({ partsJson: join(home, name, 'parts.json'), partsDir: join(home, name, 'parts'), recomposite: join(home, name, 'recomposite.png'), errorMap: join(home, name, 'error.png') });
    const observe = takeFootprintObserver(home);
    a.take = []; writeFileSync(config, JSON.stringify(raw));
    const before = observe(input, output('floor'), 'body', 'full:topwear');
    a.take = takes; writeFileSync(config, JSON.stringify(raw));
    const after = observe(input, output('take'), 'body', 'full:topwear');
    const base = readLayers(join(home, 'full')).layers.find(l => l.name === 'topwear')!;
    const donor = readLayers(join(home, 'donor')).layers.find(l => l.name === 'topwear')!;
    const painting = readPng(input.source), selected = deriveTakenRegion(base, donor, painting, seed, 0, 'generated cleanup control');
    // Independent of the new internal selection metadata: derive membership from the known missing rectangle.
    const component = newMask(painting.width, painting.height);
    for (let y = 0; y < component.height; y++) for (let x = 0; x < component.width; x++) component.data[y * component.width + x] = mirror ? +(x >= 30 && x < 125 && y >= 10 && y < 100) : +(x >= 8 && x < 20 && y >= 36 && y < 44 && !(x >= 9 && x < 12 && y >= 37 && y < 40));
    const support = takeFootprint(component, { sx: 1, sy: 1, tx: 0, ty: 0 }, painting.width, painting.height, 'bicubic');
    const reading = coreFootprintChanges(before.result, after.result, 'body', support, firstTakeWriters(before.trace, after.trace));
    const witness = (mirror ? 112 : 38) * painting.width + (mirror ? 6 : 10);
    const retained = before.trace.get('warp')!.data[witness * 4 + 3] === after.trace.get('warp')!.data[witness * 4 + 3];
    say(mirror ? 'REGION_CLEANUP_THRESHOLD_MIRROR' : 'REGION_CLEANUP_JOINED_ISLAND', retained && selected.reading.pixels === component.data.reduce((n, v) => n + v, 0) && reading.other === 0 && reading.beyondProjection === 0, `${mirror ? 'largest component raises the 1% floor above 64 and 42' : 'recovered surround joins a rejected 3x3 island'}; witness retained ${retained}; ${JSON.stringify(reading)}`);
    // Production support and the unchanged independent guard agree at fractional maps too.
    let same = true;
    for (const scale of [0.5, 1, 1.5]) {
      const map = { sx: scale, sy: scale, tx: -0.5, ty: 0.25 }, filter = scale < 1 ? 'bilinear' as const : 'bicubic' as const;
      const expected = takeFootprint(component, map, painting.width, painting.height, filter), actual = warpSupport(component, map, painting.width, painting.height, filter);
      same &&= actual.data.every((v, p) => v === expected.data[p]);
    }
    say(mirror ? 'REGION_THRESHOLD_SUPPORT_IDENTITY' : 'REGION_JOINED_SUPPORT_IDENTITY', same, 'production tap support equals the independent frozen guard at three scales');
  }
}
