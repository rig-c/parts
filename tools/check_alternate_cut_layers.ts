/** Controls precede the regression assertion; all assembly goes through real readers. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAlternateCutLayerFixture } from '../fixtures/alternate_cut_layers.ts';
import { assembleLayerFixture } from './check_alternate_layers.ts';
import { rigStage } from '../src/build.ts';
import { runCheck, type CheckReport, type RigcRunner } from '../src/check.ts';
import { loadConfig, type CharacterConfig } from '../src/config.ts';
import { readLayers } from '../src/layers.ts';
import { readParts, type PartRecord } from '../src/parts.ts';
import { readPng, encodePngBytes } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
import { paint, C, writeRun } from '../fixtures/assemble_fixture.ts';
import { PartsError } from '../src/errors.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
const EXPECTED_TEN_BARS = [
  'gate',
  'loop',
  'seam',
  'BREATH_VISIBLE',
  'BLINK_NO_HOLE',
  'CHAIN_LAG',
  'TIP_OVER_ROOT',
  'STILL_REGIONS_DARK',
  'TEXTURE_STRETCH',
  'ANIMATIONS_DO_NOT_FOLD',
] as const;

export function runAlternateCutLayerChecks(dir: string, say: Say, runner: RigcRunner): void {
  const d = join(dir, 'independent-cut'); writeAlternateCutLayerFixture(d);
  const path = join(d, 'config.json'), cfg = loadConfig(path), alt = cfg.assemble.alternates![0];
  const save = (): void => writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
  const records = (out: string): PartRecord[] => readParts(join(out, 'parts.json')).alternates![0].records;
  const at = (out: string, name: string, x: number, y: number): number => {
    const p = records(out).find(p => p.name === name)!;
    if (x < p.x || x >= p.x + p.w || y < p.y || y >= p.y + p.h) return 0;
    const r = readPng(join(out, 'parts', `raised_${name}.png`));
    return r.data[((y - p.y) * r.width + x - p.x) * 4 + 3];
  };
  const same = (a: string, b: string): boolean => readFileSync(join(a, 'parts.json')).equals(readFileSync(join(b, 'parts.json'))) &&
    readdirSync(join(a, 'parts')).every(n => readFileSync(join(a, 'parts', n)).equals(readFileSync(join(b, 'parts', n))));
  say('CUT_REAL_READERS', readLayers(join(d, 'step')).layers.length === 2 && alt.parts!.length === 2, 'full config and actual layer reader accept the generated cut control');
  const absent = assembleLayerFixture(d, 'absent');
  say('CUT_ABSENT_PARTITION', at(absent, 'body', 36, 40) === 0 && at(absent, 'sleeve', 36, 40) === 255, 'normal cut removes the old-sleeve probe from body');
  alt.layers = {}; save(); const empty = assembleLayerFixture(d, 'empty');
  say('CUT_EMPTY_MAP_IDENTITY', same(absent, empty), 'absent and empty layers map preserve every parts.json and PNG byte');
  alt.layers = { body: 'author:raised', sleeve: 'author:raised' }; save(); const sameLayer = assembleLayerFixture(d, 'same-layer');
  say('CUT_SAME_LAYER_CONTROL', at(sameLayer, 'body', 28, 16) === 0 && at(sameLayer, 'sleeve', 28, 16) === 255 && records(sameLayer).every(p => p.from === 'full:author:raised'), 'both outputs choose the same author source; the polygon still partitions it');
  alt.layers = { sleeve: 'author:raised' }; save(); const selected = assembleLayerFixture(d, 'selected');
  const body = records(selected).find(p => p.name === 'body')!, sleeve = records(selected).find(p => p.name === 'sleeve')!;
  say('CUT_INDEPENDENT_PIECE_REMOVES_PARENT_POLYGON', at(selected, 'body', 36, 40) === 0 && at(selected, 'body', 28, 16) === 0 && at(selected, 'body', 16, 16) === 255 && at(selected, 'sleeve', 28, 16) === 255 && at(selected, 'sleeve', 36, 40) === 0 && body.from === 'full:topwear' && sleeve.from === 'full:author:raised', JSON.stringify({ body, sleeve, oldSleeveAlpha: at(selected, 'body', 36, 40) }));
  alt.layers = { body: 'author:raised' }; save(); const parentOnly = assembleLayerFixture(d, 'parent-only');
  say('CUT_PARENT_SELECTION_DOES_NOT_SELECT_PIECE', at(parentOnly, 'body', 28, 16) === 0 && at(parentOnly, 'sleeve', 36, 40) === 255 && records(parentOnly).find(p => p.name === 'body')!.from === 'full:author:raised' && records(parentOnly).find(p => p.name === 'sleeve')!.from === 'full:topwear', 'parent chooses author art; absent piece choice retains its original planned layer');
  alt.layers = { sleeve: 'author:raised' }; alt.cuts = structuredClone(cfg.assemble.cuts!); alt.cuts[0].overlap = 1; save();
  const band = assembleLayerFixture(d, 'band');
  say('CUT_OVERLAP_BAND_STAYS_ON_PARENT', at(band, 'body', 24, 40) === 255 && at(band, 'body', 36, 40) === 0 && at(band, 'sleeve', 36, 40) === 0, 'the parent keeps its own one-pixel band even where selected piece art is absent');
  alt.cuts[0].overlap = 0; alt.cuts[0].under = 'under.png'; alt.cuts[0].under_fill = 'colour';
  writeFileSync(join(d, 'under.png'), encodePngBytes(paint(16, 40, C, []))); save();
  const under = assembleLayerFixture(d, 'under');
  say('CUT_UNDER_USES_REMOVED_PARENT_PIXELS', at(under, 'body', 36, 40) === 255 && at(under, 'sleeve', 36, 40) === 0 && records(under).find(p => p.name === 'body')!.opaque_px === 32 * 40, 'under fills all 16*40 removed parent pixels, including pixels outside the 8*24 independent piece');
  delete alt.cuts;
  const expectRefusal = (name: string, code: string): void => {
    save(); let message = '';
    try { assembleLayerFixture(d, name); } catch (e) { if (!(e instanceof PartsError)) throw e; message = e.message; }
    say(name, message.includes(code), message);
  };
  alt.layers = { sleeve: 'author:missing' }; expectRefusal('CUT_MISSING_SELECTED_LAYER', 'ASSEMBLE_ALT_INPUT_PRESENT');
  alt.layers = { sleeve: 'author:raised' };
  // The independently selected layer needs only piece art, not a second body.
  const originalRun = readLayers(join(d, 'step'));
  writeRun(join(d, 'step'), [
    { name: 'topwear', depth: 0.6, rects: [{ x0: 8, y0: 8, x1: 40, y1: 48, colour: C }] },
    { name: 'author:raised', depth: 0.5, rects: [{ x0: 24, y0: 8, x1: 32, y1: 32, colour: C }] },
  ]); save(); const pieceOnly = assembleLayerFixture(d, 'piece-only');
  say('CUT_SELECTED_SOURCE_NEEDS_NO_PARENT_REMAINDER', at(pieceOnly, 'body', 36, 40) === 0 && records(pieceOnly).find(p => p.name === 'sleeve')!.opaque_px === 8 * 24 && originalRun.layers.length === 2, 'selected source holds only the cut piece; it is never emitted as a substitute parent');
  alt.cuts = structuredClone(cfg.assemble.cuts!); alt.cuts[0].polygon = [[32, 32], [40, 32], [40, 48], [32, 48]];
  expectRefusal('CUT_SELECTED_POLYGON_MUST_HOLD_ART', 'ASSEMBLE_CUT_PIXELS');
  delete alt.cuts;
  cfg.assemble.cuts!.push({ from: 'body', into: 'badge', polygon: [[8, 8], [16, 8], [16, 16], [8, 16]], overlap: 0, draw: 'front' });
  cfg.regions.badge = 'anchor'; alt.parts!.push('badge'); alt.cuts = structuredClone(cfg.assemble.cuts!); alt.cuts[1].polygon = structuredClone(alt.cuts[0].polygon);
  expectRefusal('CUT_DIFFERENT_LAYERS_DO_NOT_BYPASS_OVERLAP', 'ASSEMBLE_CUT_OVERLAP');

  const ld = join(dir, 'cut-backed-limb'); writeAlternateCutLayerFixture(ld);
  const lc = loadConfig(join(ld, 'config.json')), la = lc.assemble.alternates![0];
  lc.bones.push({ chain: 'arm', parent: 'root', points: [[28, 8], [28, 20]], tip: [28, 32] });
  lc.limbs = { arm: { segments: [{ part: 'upper', from: 'sleeve', bone: 'arm0' }, { part: 'lower', from: 'sleeve', bone: 'arm1', joint: 'elbow' }] } };
  delete lc.regions.sleeve; lc.regions.upper = 'arm0'; lc.regions.lower = 'arm1';
  la.parts = ['body', 'upper', 'lower']; la.cuts = structuredClone(lc.assemble.cuts!); la.layers = { lower: 'author:raised' };
  writeFileSync(join(ld, 'config.json'), JSON.stringify(lc, null, 2) + '\n');
  let limbRefusal = '';
  try { loadConfig(join(ld, 'config.json')); } catch (e) { if (!(e instanceof PartsError)) throw e; limbRefusal = e.message; }
  say('CUT_GESTURE_CUSTOM_POLYGONS_STILL_REFUSED', limbRefusal.includes('CONFIG_LIMB_SET_JOINTS'), limbRefusal);

  // Issue #726: check --set raised on the alternates fixture measures all 10 of 10 bars (0 SKIP) and each of the
  // five bars that previously skipped (BLINK_NO_HOLE, CHAIN_LAG, TIP_OVER_ROOT, STILL_REGIONS_DARK, TEXTURE_STRETCH)
  // fails on its planted mutant.
  const runSetCheck = (name: string, mutateCfg?: (c: CharacterConfig) => void, mutateOut?: (out: string) => void): CheckReport => {
    const md = join(dir, name);
    writeAlternateCutLayerFixture(md);
    const mc = loadConfig(join(md, 'config.json'));
    mc.assemble.alternates![0].layers = { sleeve: 'author:raised' };
    if (mutateCfg !== undefined) mutateCfg(mc);
    writeFileSync(join(md, 'config.json'), JSON.stringify(mc, null, 2) + '\n');
    const out = assembleLayerFixture(md, 'out');
    rigStage({ config: join(md, 'config.json'), parts: out, out: join(out, 'rig') }, runner, join(md, 'scratch'), () => {});
    if (mutateOut !== undefined) mutateOut(out);
    return runCheck(join(out, 'rig'), join(out, 'check'), runner, out, undefined, undefined, undefined, false, false, 'raised');
  };
  const green = runSetCheck('set-check-green');
  say(
    'CUT_SET_CHECK_ALL_TEN_BARS_MEASURED',
    green.figures.PASS === true &&
      green.figures.sets?.raised?.PASS === true &&
      green.bars.skipped.length === 0 &&
      JSON.stringify(green.bars.measured) === JSON.stringify(EXPECTED_TEN_BARS),
    JSON.stringify({ measured: green.bars.measured, skipped: green.bars.skipped, setPass: green.figures.sets?.raised?.PASS }),
  );
  const blinkMutant = runSetCheck('set-check-blink-mutant', undefined, (out) => {
    const emptyFace = newRaster(8, 12);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) emptyFace.data.set([...C, 255], (y * 8 + x) * 4);
    writeFileSync(join(out, 'parts', 'face.png'), encodePngBytes(emptyFace));
    const padded = newRaster(12, 16);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) padded.data.set([...C, 255], ((y + 2) * 12 + (x + 2)) * 4);
    writeFileSync(join(out, 'rig', 'images', 'face.png'), encodePngBytes(padded));
  });
  say(
    'CUT_SET_CHECK_BLINK_NO_HOLE_MUTANT_FAILS',
    blinkMutant.figures.PASS === false &&
      blinkMutant.figures.BLINK_NO_HOLE.status === 'FAIL' &&
      JSON.stringify(blinkMutant.problems.map((p) => p.code)) === JSON.stringify(['CHECK_BLINK_NO_HOLE']),
    JSON.stringify({ codes: blinkMutant.problems.map((p) => p.code), blink: blinkMutant.figures.BLINK_NO_HOLE }),
  );
  const chainLagMutant = runSetCheck('set-check-chain-lag-mutant', (mc) => {
    const tr = mc.motion.tracks[1];
    if ('chain' in tr) tr.lag = 0;
  });
  say(
    'CUT_SET_CHECK_CHAIN_LAG_MUTANT_FAILS',
    chainLagMutant.figures.PASS === false &&
      chainLagMutant.figures.CHAIN_LAG.status === 'FAIL' &&
      JSON.stringify(chainLagMutant.problems.map((p) => p.code)) === JSON.stringify(['CHECK_CHAIN_LAG']),
    JSON.stringify({ codes: chainLagMutant.problems.map((p) => p.code), chain: chainLagMutant.figures.CHAIN_LAG }),
  );
  const tipOverRootMutant = runSetCheck('set-check-tip-over-root-mutant', (mc) => {
    const tr = mc.motion.tracks[1];
    if ('chain' in tr) tr.amps = [1, 1];
    mc.motion.tracks.push({ bone: 'skirt0', prop: 'translatex', amp: 8, period: 1, phase: 0 });
  });
  say(
    'CUT_SET_CHECK_TIP_OVER_ROOT_MUTANT_FAILS',
    tipOverRootMutant.figures.PASS === false &&
      tipOverRootMutant.figures.TIP_OVER_ROOT.status === 'FAIL' &&
      JSON.stringify(tipOverRootMutant.problems.map((p) => p.code)) === JSON.stringify(['CHECK_TIP_OVER_ROOT']),
    JSON.stringify({ codes: tipOverRootMutant.problems.map((p) => p.code), tip: tipOverRootMutant.figures.TIP_OVER_ROOT }),
  );
  const stillRegionsMutant = runSetCheck('set-check-still-regions-mutant', (mc) => {
    delete mc.regions.face;
    mc.meshes.face = { segments: [['head', [44, 8], [44, 14]], ['anchor', [44, 14], [44, 20]]], grid: 8, r: 80 };
    const tr = mc.motion.tracks[0];
    if ('bone' in tr) tr.amp = 6;
  });
  say(
    'CUT_SET_CHECK_STILL_REGIONS_DARK_MUTANT_FAILS',
    stillRegionsMutant.figures.PASS === false &&
      stillRegionsMutant.figures.STILL_REGIONS_DARK.status === 'FAIL' &&
      JSON.stringify(stillRegionsMutant.problems.map((p) => p.code)) === JSON.stringify(['CHECK_STILL_REGIONS_DARK']),
    JSON.stringify({ codes: stillRegionsMutant.problems.map((p) => p.code), still: stillRegionsMutant.figures.STILL_REGIONS_DARK }),
  );
  const textureStretchMutant = runSetCheck('set-check-texture-stretch-mutant', (mc) => {
    delete mc.regions.body;
    mc.bones.push({ name: 'hem', parent: 'root', at: [16, 48] });
    mc.meshes.body = { segments: [['anchor', [16, 8], [16, 12]], ['hem', [16, 44], [16, 48]]], grid: 8, r: 4 };
    mc.motion.tracks.push({ bone: 'hem', prop: 'translatey', base: -20, amp: 20, period: 1, phase: 0.25 });
  });
  say(
    'CUT_SET_CHECK_TEXTURE_STRETCH_MUTANT_FAILS',
    textureStretchMutant.figures.PASS === false &&
      textureStretchMutant.figures.TEXTURE_STRETCH.status === 'FAIL' &&
      JSON.stringify(textureStretchMutant.problems.map((p) => p.code)) === JSON.stringify(['CHECK_TEXTURE_STRETCH']),
    JSON.stringify({ codes: textureStretchMutant.problems.map((p) => p.code), stretch: textureStretchMutant.figures.TEXTURE_STRETCH }),
  );
}
