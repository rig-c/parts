/** Generated end-to-end controls for #866; the real stage and strict parts reader. */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAlternateLayerFixture } from '../fixtures/alternate_layers.ts';
import { chainConfig, chainPlate, LIMB, SIDE, writeChainInputs, writePlateRun } from '../fixtures/occluder_chain.ts';
import { writeTakeFixture } from '../fixtures/take_layers.ts';
import { checkGeometry, layerToRig, layerToRigSplit, occluderCoreMask, placeLayer } from '../src/assemble.ts';
import { assembleStage, readRuns } from '../src/build.ts';
import { createHash } from 'node:crypto';
import { crop } from '../src/raster/composite.ts';
import { newRaster } from '../src/raster/types.ts';
import { takenSourceProblems, takenTransportProblems } from '../src/takesource.ts';
import { readParts, serializeParts } from '../src/parts.ts';
import { loadEarlyConfig, parseConfig, parseEarlyConfig } from '../src/config.ts';
import { readLayers } from '../src/layers.ts';
import { makeInputs } from '../src/inputs.ts';
import { applyTakenLayers } from '../src/takelayers.ts';
import { writeRun, paint, C, WHITE } from '../fixtures/assemble_fixture.ts';
import { spawnSync } from 'node:child_process';
import { PartsError } from '../src/errors.ts';
import { readPng, encodePngBytes } from '../src/raster/png.ts';
import { runTakeRegionChecks, runTakeRegionReceiptChecks, runTakeContainmentChecks, runTakeDerivedChecks, runTakeReferenceGeometryChecks, runTakeReferenceBranchChecks, runTakeSourceOpacityChecks } from './check_take_region.ts';
import { runTakePlanOrderChecks } from './check_take_plan_order.ts';
import { runTakeCleanupChecks } from './check_take_cleanup.ts';
import { runTakeFootprintChecks } from './check_take_footprint.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
export function runTakeLayerChecks(dir: string, say: Say): void {
  const save = (d: string, cfg: unknown): void => writeFileSync(join(d, 'config.json'), JSON.stringify(cfg));
  const run = (d: string, out = 'out') => assembleStage({ source: join(d, 'painting.png'), full: join(d, 'full'), head: null, config: join(d, 'config.json'), seam: 'near-white', project: 'core' },
    { partsJson: join(d, out, 'parts.json'), partsDir: join(d, out, 'parts'), recomposite: join(d, out, 'recomposite.png'), errorMap: join(d, out, 'error.png') }, () => {});
  const message = (action: () => unknown): string => { try { action(); return ''; } catch (e) { if (e instanceof PartsError) return e.message; throw e; } };
  const d = join(dir, 'positive'); writeTakeFixture(d);
  let positive = '';
  try {
    const result = run(d); const p = readPng(join(d, 'painting.png'));
    const records = readParts(join(d, 'out', 'parts.json'));
    const text = readFileSync(join(d, 'out', 'parts.json'), 'utf8');
    say('POSITIVE_RECOMPOSITE_AND_PROVENANCE', result.recomposite.data.every((v, i) => v === p.data[i]) && records.parts.some(r => r.from === 'full:front hair' && r.taken_layers?.[0].support_px === 192 && r.taken_layers[0].checked_px === 336 && r.taken_layers[0].differing_px === 0) && text.includes('generated-prompt') && text.includes('"seed": 43'), JSON.stringify(records.parts.find(r => r.name === 'hair')?.taken_layers));
    positive = 'assembled';
  } catch (e) { positive = e instanceof Error ? e.message : String(e); say('POSITIVE_RECOMPOSITE_AND_PROVENANCE', false, positive); }
  const bad = join(dir, 'pixel'); writeTakeFixture(bad);
  const input = readPng(join(bad, 'donor-input.png')); input.data[(10 * 64 + 10) * 4] ^= 1; writeFileSync(join(bad, 'donor-input.png'), encodePngBytes(input));
  const mismatch = message(() => run(bad));
  say('ONE_PIXEL_REFUSED', mismatch.includes('ASSEMBLE_TAKE_INPUT_IDENTITY') && mismatch.includes('front hair') && mismatch.includes('1 differing pixel') && mismatch.includes('[10, 10, 11, 11]') && !existsSync(join(bad, 'out')), mismatch || `accepted; positive ${positive}`);
  const missing = join(dir, 'missing'); const cfg = writeTakeFixture(missing);
  ((cfg.assemble as Record<string, unknown>).take as Array<Record<string, unknown>>)[0].tags = ['mouth']; save(missing, cfg);
  const absent = message(() => run(missing));
  say('MISSING_TAG_REFUSED', absent.includes('ASSEMBLE_TAKE_TAG_IN_RUN') && absent.includes('mouth') && !existsSync(join(missing, 'out')), absent || 'accepted');
  const take = (cfg: Record<string, unknown>): Array<Record<string, unknown>> => (cfg.assemble as Record<string, unknown>).take as Array<Record<string, unknown>>;
  const fresh = (name: string) => { const d = join(dir, name); const cfg = writeTakeFixture(d); return { d, cfg }; };
  const changeDepth = (d: string, value: number | null): void => {
    const p = join(d, 'donor', 'layers.json'), o = JSON.parse(readFileSync(p, 'utf8')) as { layers: Array<{ depth_median: number | null }> };
    o.layers[0].depth_median = value; writeFileSync(p, JSON.stringify(o));
  };
  const margin = fresh('margin'); const m = readPng(join(margin.d, 'donor-input.png')); m.data[(6 * 64 + 6) * 4] ^= 1; writeFileSync(join(margin.d, 'donor-input.png'), encodePngBytes(m));
  const marginMessage = message(() => run(margin.d));
  say('MARGIN_PIXEL_REFUSED', marginMessage.includes('ASSEMBLE_TAKE_INPUT_IDENTITY') && marginMessage.includes('[6, 6, 7, 7]'), marginMessage);
  const alpha = fresh('alpha'); const a = readPng(join(alpha.d, 'donor-input.png')); a.data[(10 * 64 + 10) * 4 + 3] = 254; writeFileSync(join(alpha.d, 'donor-input.png'), encodePngBytes(a));
  const alphaMessage = message(() => run(alpha.d));
  say('ALPHA_IDENTITY_IS_EXACT', alphaMessage.includes('ASSEMBLE_TAKE_INPUT_IDENTITY') && alphaMessage.includes('1 differing pixel'), alphaMessage);
  for (const depth of [0.5, null]) {
    const f = fresh(depth === null ? 'null' : 'tie'); changeDepth(f.d, depth); const error = message(() => run(f.d));
    say(depth === null ? 'NULL_DEPTH_REFUSED' : 'MIXED_DEPTH_TIE_REFUSED', error.includes('ASSEMBLE_TAKE_DEPTH_AMBIGUOUS') && !existsSync(join(f.d, 'out')), error);
  }
  const reversed = fresh('reverse'); (reversed.cfg.assemble as Record<string, unknown>).plan = [['hair', 'full', 'front hair'], ['face', 'full', 'face'], ['body', 'full', 'topwear']]; save(reversed.d, reversed.cfg);
  const reversedMessage = message(() => run(reversed.d));
  say('REVERSED_MIXED_PLAN_REFUSED', reversedMessage.includes('ASSEMBLE_TAKE_PLAN_ORDER'), reversedMessage);
  const repairedPlan = spawnSync(process.execPath, ['cli.ts', 'assemble', '--propose-plan', '--source', join(reversed.d, 'painting.png'), '--full', join(reversed.d, 'full'), '--config', join(reversed.d, 'config.json')], { encoding: 'utf8' });
  say('PROPOSER_REPAIRS_PREVIOUS_PLAN_ORDER', repairedPlan.status === 0 && repairedPlan.stdout.includes('generated-prompt'), 'existing reversed plan is ignored when drafting its replacement; identity and depth ambiguity still checked');
  const dims = fresh('dimensions'); writeFileSync(join(dims.d, 'donor-input.png'), encodePngBytes(paint(32, 32, WHITE, [])));
  const dimsMessage = message(() => run(dims.d));
  say('INPUT_DIMENSIONS_REFUSED_WITHOUT_RESAMPLING', dimsMessage === 'ASSEMBLE_TAKE_GEOMETRY: config.assemble.take run "donor" (full) — donor canvas 64x64, target canvas 64x64, donor st_input 32x32, target st_input 64x64; equal canvases and equal input dimensions are required (full uses squarePad; head uses head_box)', dimsMessage);
  const canvas = fresh('canvas'); const canvasFile = join(canvas.d, 'donor', 'layers.json'); const canvasMeta = JSON.parse(readFileSync(canvasFile, 'utf8')) as Record<string, unknown>; canvasMeta.width = 65; writeFileSync(canvasFile, JSON.stringify(canvasMeta));
  const canvasMessage = message(() => run(canvas.d));
  say('RUN_CANVAS_MISMATCH_REFUSED', canvasMessage.includes('ASSEMBLE_TAKE_GEOMETRY'), canvasMessage);
  for (const meta of [{ seed: 43 }, { prompt_id: 'generated-prompt' }, { prompt_id: '', seed: 43 }, { prompt_id: 'generated-prompt', seed: 0.5 }]) {
    const f = fresh('meta-' + Object.keys(meta).join('-') + String(Object.values(meta).join('-'))); writeFileSync(join(f.d, 'donor', 'meta.json'), JSON.stringify(meta)); const error = message(() => run(f.d));
    say('METADATA_NOT_INVENTED', error.includes('ASSEMBLE_TAKE_META'), error);
  }
  const noInput = fresh('missing-input'); take(noInput.cfg)[0].st_input = 'absent.png'; save(noInput.d, noInput.cfg); const noInputMessage = message(() => run(noInput.d));
  say('INPUT_REQUIRED', noInputMessage.includes('ASSEMBLE_TAKE_INPUT'), noInputMessage);
  const plan = spawnSync(process.execPath, ['cli.ts', 'assemble', '--propose-plan', '--source', join(d, 'painting.png'), '--full', join(d, 'full'), '--config', join(d, 'config.json')], { encoding: 'utf8' });
  say('PLAN_NOTE_NAMES_IDENTITY_AND_SOURCE', plan.status === 0 && plan.stdout.includes('generated-prompt') && plan.stdout.includes('support 192 run px; checked 336 input px; differing 0') && plan.stdout.includes('take union full'), plan.stdout.trim());
  const untaken = fresh('absent'); delete (untaken.cfg.assemble as Record<string, unknown>).take; save(untaken.d, untaken.cfg); run(untaken.d);
  (untaken.cfg.assemble as Record<string, unknown>).take = []; save(untaken.d, untaken.cfg); run(untaken.d, 'empty');
  say('EMPTY_AND_ABSENT_BYTE_IDENTICAL', readFileSync(join(untaken.d, 'out', 'parts.json')).equals(readFileSync(join(untaken.d, 'empty', 'parts.json'))), 'no take leaves the existing parts contract unchanged');
  const recordPath = join(d, 'out', 'parts.json');
  if (existsSync(recordPath)) {
    const original = readFileSync(recordPath, 'utf8');
    for (const mutate of [(v: Record<string, unknown>) => { delete v.seed; }, (v: Record<string, unknown>) => { v.extra = true; }, (v: Record<string, unknown>) => { v.differing_px = 1; }, (v: Record<string, unknown>) => { v.support_px = 0; }]) {
      const json = JSON.parse(original) as { parts: Array<{ taken_layers?: Array<Record<string, unknown>> }> }; const src = json.parts.find(p => p.taken_layers !== undefined)!.taken_layers![0]; mutate(src); writeFileSync(recordPath, JSON.stringify(json));
      const error = message(() => readParts(recordPath)); say('STRICT_PARTS_READER_REFUSES_BAD_RECEIPT', error.includes('PARTS_TAKEN_LAYERS'), error);
    }
    writeFileSync(recordPath, original);
  }
  const duplicate = fresh('duplicate'); take(duplicate.cfg).push({ ...take(duplicate.cfg)[0] });
  say('DUPLICATE_DECLARATIONS_REFUSED_AT_BOTH_CONFIG_DOORS', [() => parseEarlyConfig(duplicate.cfg, 'layers'), () => parseEarlyConfig(duplicate.cfg, 'assemble')].every(load => message(load).includes('CONFIG_TAKE_UNIQUE')) && message(() => parseConfig(duplicate.cfg)).includes('CONFIG_TAKE_UNIQUE'), 'one donor per run/tag, validated by layers, assemble and full config readers');
  const head = fresh('head-map');
  (head.cfg.seethrough as Record<string, unknown>).head_box = [16, 0, 48, 32]; take(head.cfg)[0].run = 'head';
  writeRun(join(head.d, 'head'), [{ name: 'front hair', depth: 0.4, rects: [{ x0: 8, y0: 8, x1: 32, y1: 16, colour: C }] }]);
  const headImage = paint(32, 32, WHITE, [{ x0: 0, y0: 8, x1: 32, y1: 32, colour: C }]); writeFileSync(join(head.d, 'donor-input.png'), encodePngBytes(headImage)); save(head.d, head.cfg);
  const mapped = () => applyTakenLayers(readRuns(join(head.d, 'full'), join(head.d, 'head')), readPng(join(head.d, 'painting.png')), loadEarlyConfig(join(head.d, 'config.json'), 'layers'), join(head.d, 'config.json'));
  const mappedResult = mapped(); const headReceipt = mappedResult.head.layers.find(l => l.name === 'front hair')?.takenLayers?.[0];
  say('HEAD_CROP_MAP_EXACT_UNSAMPLED_PIXELS', headReceipt?.checked_px === 84 && mappedResult.full.layers.every(l => l.takenLayers === undefined), JSON.stringify(headReceipt));
  headImage.data[(5 * 32 + 5) * 4] ^= 1; writeFileSync(join(head.d, 'donor-input.png'), encodePngBytes(headImage)); const headError = message(mapped);
  say('HEAD_MAP_ONE_PIXEL_REFUSED', headError.includes('ASSEMBLE_TAKE_INPUT_IDENTITY') && headError.includes('[5, 5, 6, 6]'), headError);
  const cut = fresh('cut');
  (cut.cfg.assemble as Record<string, unknown>).cuts = [{ from: 'hair', into: 'lock', polygon: [[8, 8], [20, 8], [20, 16], [8, 16]], draw: 'front', overlap: 0 }]; save(cut.d, cut.cfg);
  const cutResult = run(cut.d); const pieces = cutResult.parts.parts.filter(p => p.name === 'hair' || p.name === 'lock');
  say('CUT_DERIVATIVES_RETAIN_SOURCE_AND_ROLE', pieces.length === 2 && pieces.every(p => p.from === 'full:front hair' && p.taken_layers?.[0].prompt_id === 'generated-prompt'), JSON.stringify(pieces.map(p => ({ name: p.name, from: p.from, taken_layers: p.taken_layers }))));

  const limbs = join(dir, 'limbs'); writeAlternateLayerFixture(limbs);
  const lc = JSON.parse(readFileSync(join(limbs, 'config.json'), 'utf8')) as Record<string, unknown>; const la = lc.assemble as Record<string, unknown>; delete la.alternates;
  cpSync(join(limbs, 'full'), join(limbs, 'donor'), { recursive: true });
  writeFileSync(join(limbs, 'donor', 'meta.json'), JSON.stringify({ prompt_id: 'generated-limb-prompt', seed: 101 }));
  la.take = [{ run: 'full', run_dir: 'donor', st_input: 'painting.png', tags: ['handwear-r'] }]; save(limbs, lc);
  const limbResult = assembleStage({ source: join(limbs, 'painting.png'), full: join(limbs, 'full'), head: join(limbs, 'head'), config: join(limbs, 'config.json'), seam: 'near-white', project: 'core' },
    { partsJson: join(limbs, 'out', 'parts.json'), partsDir: join(limbs, 'out', 'parts'), recomposite: join(limbs, 'out', 'recomposite.png'), errorMap: join(limbs, 'out', 'error.png') }, () => {});
  const limbParts = readParts(join(limbs, 'out', 'parts.json')).parts;
  say('LIMB_DERIVATIVES_RETAIN_TAKEN_SOURCE', limbResult.parts.parts.length === 2 && limbParts.every(p => p.limb !== undefined && p.from === 'full:handwear-r' && p.taken_layers?.[0].prompt_id === 'generated-limb-prompt'), JSON.stringify(limbParts.map(p => ({ name: p.name, from: p.from, taken_layers: p.taken_layers }))));
  const known = fresh('same-run-null'); cpSync(join(known.d, 'full'), join(known.d, 'donor'), { recursive: true });
  const kp = join(known.d, 'donor', 'layers.json'), km = JSON.parse(readFileSync(kp, 'utf8')) as { layers: Array<{ name: string; depth_median: number | null }> };
  for (const l of km.layers) l.depth_median = null; writeFileSync(kp, JSON.stringify(km)); take(known.cfg)[0].tags = km.layers.map(l => l.name); save(known.d, known.cfg);
  const knownResult = run(known.d);
  say('SAME_DONOR_NULL_ORDER_RETAINED', knownResult.parts.parts.every(p => p.taken_layers?.[0].prompt_id === 'generated-prompt'), 'all drawn layers from one donor keep its manifest order; no cross-run null comparison');

  const padded = fresh('full-pad');
  const pp = paint(64, 48, WHITE, [{ x0: 8, y0: 8, x1: 56, y1: 48, colour: C }]); writeFileSync(join(padded.d, 'painting.png'), encodePngBytes(pp));
  (padded.cfg.seethrough as Record<string, unknown>).head_box = [16, 0, 48, 32]; cpSync(join(padded.d, 'full'), join(padded.d, 'head'), { recursive: true });
  const pi = paint(64, 64, WHITE, [{ x0: 8, y0: 16, x1: 56, y1: 56, colour: C }]); writeFileSync(join(padded.d, 'donor-input.png'), encodePngBytes(pi)); save(padded.d, padded.cfg);
  const paddedResult = applyTakenLayers(readRuns(join(padded.d, 'full'), join(padded.d, 'head')), pp, loadEarlyConfig(join(padded.d, 'config.json'), 'layers'), join(padded.d, 'config.json'));
  say('FULL_INPUT_USES_EXACT_VERTICAL_PAD', paddedResult.full.layers.find(l => l.name === 'front hair')?.takenLayers?.[0].checked_px === 336, '64x48 painting padded 8 rows above and below; comparison stays in original 64x64 st_input cells');
  const multi = fresh('union');
  cpSync(join(multi.d, 'full'), join(multi.d, 'donor'), { recursive: true }); take(multi.cfg)[0].tags = ['front hair', 'face']; save(multi.d, multi.cfg);
  const mu = applyTakenLayers(readRuns(join(multi.d, 'full'), null), readPng(join(multi.d, 'painting.png')), loadEarlyConfig(join(multi.d, 'config.json'), 'layers'), join(multi.d, 'config.json'));
  say('UNION_COUNTS_OVERLAP_ONCE', mu.notes.includes('take union full from donor: checked 1456 input px; differing 0'), mu.notes.join(' | '));
  const unchangedInputs = makeInputs(readPng(join(d, 'painting.png')), loadEarlyConfig(join(d, 'config.json'), 'layers'), 'fixture');
  say('ORIGINAL_INPUTS_STAY_UNCHANGED', unchangedInputs.full.width === 64 && readPng(join(d, 'donor-input.png')).data[63 * 64 * 4] === 0, 'the author-supplied donor difference outside support remains on disk');

  for (const which of ['full', 'donor']) {
    const hidden = fresh('hidden-' + which), path = join(hidden.d, which, 'layers.json');
    const hm = JSON.parse(readFileSync(path, 'utf8')) as { layers: Array<Record<string, unknown>> };
    const hair = hm.layers.find(l => l.name === 'front hair')!;
    writeFileSync(join(hidden.d, which, String(hair.filename)), readFileSync(join(hidden.d, which, 'parts', 'front hair.png')));
    // A hidden layer has its own PNG; it must never be inherited from the other run.
    hm.layers.push({ ...hair, name: 'front hair:hidden', filename: 'hidden.png', depth_median: null });
    writeFileSync(join(hidden.d, which, 'hidden.png'), readFileSync(join(hidden.d, which, 'parts', 'front hair.png'))); writeFileSync(path, JSON.stringify(hm));
    const error = message(() => run(hidden.d)); say('HIDDEN_COMPANION_MIXING_REFUSED', error.includes('ASSEMBLE_TAKE_HIDDEN') && !existsSync(join(hidden.d, 'out')), which + ': ' + error);
  }
  const scalar = fresh('scalar'); scalar.cfg.depth = { zScale: 1 }; save(scalar.d, scalar.cfg); const scalarMessage = message(() => run(scalar.d));
  say('ACTIVE_SCALAR_DEPTH_REFUSED', scalarMessage.includes('ASSEMBLE_TAKE_DEPTH_SHEET'), scalarMessage);
  const emptyLayer = fresh('no-support'); const ep = join(emptyLayer.d, 'donor', 'parts', 'front hair.png'), ei = readPng(ep); for (let p = 3; p < ei.data.length; p += 4) ei.data[p] = 8; writeFileSync(ep, encodePngBytes(ei));
  const emptyMessage = message(() => run(emptyLayer.d)); say('ALPHA_EIGHT_IS_NOT_SUPPORT', emptyMessage.includes('ASSEMBLE_TAKE_SUPPORT'), emptyMessage);
  const direct = fresh('duplicate-runtime'); const dc = loadEarlyConfig(join(direct.d, 'config.json'), 'layers'); dc.assemble.take!.push({ ...dc.assemble.take![0] });
  const duplicateMessage = message(() => applyTakenLayers(readRuns(join(direct.d, 'full'), null), readPng(join(direct.d, 'painting.png')), dc, join(direct.d, 'config.json')));
  say('RUNTIME_DUPLICATE_REFUSED', duplicateMessage.includes('ASSEMBLE_TAKE_UNIQUE'), duplicateMessage);
  const absentHead = fresh('missing-head'); take(absentHead.cfg)[0].run = 'head'; save(absentHead.d, absentHead.cfg); const absentHeadMessage = message(() => run(absentHead.d));
  say('NO_HEAD_TARGET_IS_REFUSED', absentHeadMessage.includes('ASSEMBLE_TAKE_GEOMETRY'), absentHeadMessage);
  const hints = fresh('inactive-hint'); const hp = join(hints.d, 'donor', 'layers.json'), hi = JSON.parse(readFileSync(hp, 'utf8')) as { layers: Array<Record<string, unknown>> }; hi.layers[0].depth_filename = 'absent-depth.png'; writeFileSync(hp, JSON.stringify(hi));
  say('INACTIVE_DEPTH_HINT_STAYS_INACTIVE', run(hints.d).parts.parts.some(p => p.name === 'hair' && p.depth === undefined && p.taken_layers?.length === 1), 'missing legacy depth file is not read while depth is inactive; no target sheet survives replacement');
  runTakePlanOrderChecks(join(dir, 'fallback-order'), say);
  runTakeRegionChecks(join(dir, 'region'), say);
  runTakeRegionReceiptChecks(join(dir, 'region-receipts'), say);
  runTakeContainmentChecks(join(dir, 'region-containment'), say);
  runTakeDerivedChecks(join(dir, 'region-derived'), say);
  runCropTakeChecks(join(dir, 'crop'), say);
  runTakeReferenceGeometryChecks(join(dir, 'reference-geometry'), say);
  runTakeReferenceBranchChecks(join(dir, 'reference-branches'), say);
  runTakeSourceOpacityChecks(join(dir, 'source-opacity'), say);
  runTakeFootprintChecks(join(dir, 'footprint'), say);
  runTakeCleanupChecks(join(dir, 'cleanup'), say);
  runOccluderSplitRigGridChecks(join(dir, 'occluder-split-rig'), say);
}

/** Suite-local planted controls for the optional source-painting crop declaration. */
function runCropTakeChecks(dir: string, say: Say): void {
  mkdirSync(dir, { recursive: true });
  const source = paint(64, 64, WHITE, [{ x0: 16, y0: 0, x1: 48, y1: 32, colour: C }]);
  // Break colour symmetry so a one-pixel registration error cannot pass identity.
  for (let y = 0; y < 32; y++) for (let x = 16; x < 48; x++) source.data[(y * 64 + x) * 4] = x + y;
  const supplied = crop(source, 16, 0, 32, 32);
  const inputPath = join(dir, 'input.png');
  writeFileSync(inputPath, encodePngBytes(supplied));
  const donorDir = join(dir, 'donor');
  writeRun(donorDir, [{ name: 'front hair', depth: 0.4, rects: [{ x0: 4, y0: 4, x1: 20, y1: 12, colour: C }] }]);
  const manifestPath = join(donorDir, 'layers.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { width: number; height: number };
  manifest.width = 32; manifest.height = 32;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(join(donorDir, 'meta.json'), JSON.stringify({ prompt_id: 'generated-crop-control', seed: 43 }));
  const donor = readLayers(donorDir);
  const material = donor.layers[0];
  for (let p = 0; p < material.pixels.data.length; p += 4) {
    material.pixels.data[p] = 173; material.pixels.data[p + 1] = 99; material.pixels.data[p + 2] = 37; material.pixels.data[p + 3] = 129;
  }
  writeFileSync(material.file!, encodePngBytes(material.pixels));
  const target = { ...donor, source: join(dir, 'target', 'layers.json'), canvas: { w: 64, h: 64 }, layers: [] };
  const cfg = { seethrough: { resolution: 64, steps: 30, seed: 42, offload: true }, assemble: { take: [{ run: 'full' as const, run_dir: 'donor', st_input: 'input.png', tags: ['front hair'], crop: { box: [16, 0, 48, 32] as [number, number, number, number], resample: 'bilinear' as const } }] } };
  const invoke = (c = cfg, set = target) => applyTakenLayers({ full: set, head: set, single: true }, source, c, join(dir, 'config.json')).full.layers[0];
  const error = (f: () => unknown): string => { try { f(); return ''; } catch (e) { if (e instanceof PartsError) return e.message; throw e; } };
  const exact = invoke();
  const t = exact.takenLayers![0].transport!;
  const expected = newRaster(64, 64);
  for (let y = 0; y < material.pixels.height; y++) expected.data.set(material.pixels.data.subarray(y * material.pixels.width * 4, (y + 1) * material.pixels.width * 4), ((y + material.top) * 64 + material.left + 16) * 4);
  const hash = (bytes: Uint8ClampedArray): string => createHash('sha256').update(bytes).digest('hex');
  say('CROP_EXACT_TRANSLUCENT_RGBA_IS_A_BYTE_COPY', t.filter === 'exact' && t.scale.join(',') === '1,1' && t.translate.join(',') === '16,0' && Buffer.from(exact.pixels.data).equals(Buffer.from(expected.data)) && t.after_rgba_sha256 === hash(expected.data), 'unit-scale integer-offset transport preserves [173,99,37,129] without premultiplication');
  say('CROP_RECEIPT_HAS_VALID_INPUT_AND_OUTPUT_HASHES', takenSourceProblems(exact.takenLayers, 'test').length === 0 && t.input_rgba_sha256 === hash(supplied.data), JSON.stringify(t));
  const shifted = structuredClone(cfg); shifted.assemble.take[0].crop.box = [17, 0, 49, 32];
  const shiftedError = error(() => invoke(shifted));
  say('CROP_WRONG_ORIGIN_REFUSED_BY_INPUT_IDENTITY', shiftedError.includes('ASSEMBLE_TAKE_INPUT_IDENTITY'), shiftedError);
  const changed = { ...supplied, data: new Uint8ClampedArray(supplied.data) }; changed.data[(6 * 32 + 6) * 4] ^= 1;
  writeFileSync(inputPath, encodePngBytes(changed));
  const changedError = error(() => invoke());
  say('CROP_WRONG_INPUT_REFUSED', changedError.includes('ASSEMBLE_TAKE_INPUT_IDENTITY'), changedError);
  writeFileSync(inputPath, encodePngBytes(supplied));
  const schema = writeTakeFixture(join(dir, 'schema'));
  const schemaTake = (schema.assemble as Record<string, unknown>).take as Array<Record<string, unknown>>;
  schemaTake[0].crop = { box: [16, 0, 48, 32], resample: 'bilinear' };
  say('CROP_VALID_OPTIONAL_FIELD_ACCEPTED_AT_ALL_CONFIG_DOORS',
    [() => parseEarlyConfig(schema, 'layers'), () => parseEarlyConfig(schema, 'assemble'), () => parseConfig(schema)].every(load => error(load) === ''),
    'the optional whole-layer declaration is accepted by early layers, assemble and full config readers');
  const records = readParts(join(dir, '..', 'positive', 'out', 'parts.json'));
  records.parts[0].taken_layers = exact.takenLayers;
  const recordsPath = join(dir, '..', 'positive', 'out', 'crop-reader.json');
  writeFileSync(recordsPath, serializeParts(records));
  say('CROP_TRANSPORT_SURVIVES_ORDERED_PARTS_WRITER_AND_READER',
    JSON.stringify(readParts(recordsPath).parts[0].taken_layers) === JSON.stringify(exact.takenLayers),
    'strict parts reader round-trips every transport field through the production ordered writer');
  for (const mutate of [
    (value: Record<string, unknown>) => { delete value.scale; },
    (value: Record<string, unknown>) => { value.extra = true; },
    (value: Record<string, unknown>) => { value.after_rgba_sha256 = 'invalid'; },
  ]) {
    const broken = JSON.parse(serializeParts(records)) as { parts: Array<{ taken_layers: Array<{ transport: Record<string, unknown> }> }> };
    mutate(broken.parts[0].taken_layers[0].transport);
    writeFileSync(recordsPath, JSON.stringify(broken));
    const refusal = error(() => readParts(recordsPath));
    say('CROP_PARTS_READER_REFUSES_MALFORMED_TRANSPORT', refusal.includes('PARTS_TAKEN_LAYERS'), refusal);
  }
  const fractional = structuredClone(cfg); fractional.assemble.take[0].crop.box = [16.5, 0, 48.5, 32];
  say('CROP_FRACTIONAL_BOX_REFUSED_AT_CONFIG_DOORS', [() => parseEarlyConfig(fractional, 'layers'), () => parseEarlyConfig(fractional, 'assemble')].every(load => error(load).includes('CONFIG_FIELD_TYPE')), 'fractional source registration is never accepted');
  const scaled = invoke(cfg, { ...target, canvas: { w: 63, h: 63 } });
  const st = scaled.takenLayers![0].transport!;
  say('CROP_FRACTIONAL_RUN_PHASE_USES_DECLARED_RESAMPLE', st.filter === 'bilinear' && st.translate[0] === 15.75 && st.scale[0] === 63 / 64 && st.after_rgba_sha256 === hash(scaled.pixels.data), JSON.stringify(st));
  const altered = new Uint8ClampedArray(scaled.pixels.data); altered[(8 * 63 + 24) * 4] ^= 1;
  const cleanTransport = takenTransportProblems(st, scaled.pixels, 'resampled fixture');
  const tamperedTransport = takenTransportProblems(st, { ...scaled.pixels, data: altered }, 'resampled fixture');
  say('CROP_RESAMPLED_OUTPUT_TAMPER_BREAKS_RECEIPT', cleanTransport.length === 0 && tamperedTransport.length === 1 && tamperedTransport[0].code === 'PARTS_TAKEN_LAYERS',
    `production verifier clean ${cleanTransport.length}, tampered ${tamperedTransport.map(p => p.code).join(',')}`);
  const malformed = structuredClone(scaled.takenLayers!); malformed[0].transport!.filter = 'exact';
  say('CROP_RECEIPT_READER_REFUSES_FALSE_EXACT_MAP', takenSourceProblems(malformed, 'test').some(p => p.code === 'PARTS_TAKEN_LAYERS'), 'fractional phase cannot claim an exact byte copy');
  for (const mutation of [
    (c: typeof cfg) => { c.assemble.take[0].crop.box = [16, 0, 80, 32]; },
    (c: typeof cfg) => { c.assemble.take[0].crop.box = [16, 0, 48, 16]; },
  ]) {
    const c = structuredClone(cfg); mutation(c);
    const refusal = error(() => invoke(c));
    say('CROP_OUTSIDE_OR_MISMATCHED_INPUT_REFUSED', refusal.includes('ASSEMBLE_TAKE_CROP') || refusal.includes('ASSEMBLE_TAKE_INPUT_IDENTITY'), refusal);
  }
  const omitted = structuredClone(cfg) as { seethrough: typeof cfg.seethrough; assemble: { take: Array<Omit<typeof cfg.assemble.take[0], 'crop'> & { crop?: typeof cfg.assemble.take[0]['crop'] }> } };
  delete omitted.assemble.take[0].crop;
  const legacy = error(() => applyTakenLayers({ full: target, head: target, single: true }, source, omitted, join(dir, 'config.json')));
  say('CROP_OMITTED_RETAINS_LEGACY_GEOMETRY_MESSAGE', legacy === `ASSEMBLE_TAKE_GEOMETRY: config.assemble.take run "donor" (full) — donor canvas 32x32, target canvas 64x64, donor st_input 32x32, target st_input 64x64; equal canvases and equal input dimensions are required (full uses squarePad; head uses head_box)`, legacy);
  const absentFilter = structuredClone(cfg) as unknown as { seethrough: unknown; assemble: { take: Array<{ crop: { resample?: string } }> } };
  delete absentFilter.assemble.take[0].crop.resample;
  say('CROP_RESAMPLE_MUST_BE_EXPLICIT', error(() => parseEarlyConfig(absentFilter, 'layers')).includes('CONFIG_FIELD_PRESENT'), 'the crop declaration never guesses a resample');
  const headCfg = { ...cfg, seethrough: { ...cfg.seethrough, head_box: [16, 0, 48, 32] as [number, number, number, number] }, assemble: { take: cfg.assemble.take.map(item => ({ ...item, run: 'head' as const })) } };
  const head = applyTakenLayers({ full: target, head: { ...target, canvas: { w: 32, h: 32 } }, single: false }, source, headCfg, join(dir, 'config.json')).head.layers[0];
  say('CROP_TARGET_HEAD_USES_ITS_DECLARED_ORIGIN', head.takenLayers?.[0].transport?.translate.join(',') === '0,0' && head.pixels.data[(4 * 32 + 4) * 4 + 3] === 129, 'painting crop [16,0,48,32] and the same target head box cancel their origins');
  const native = applyTakenLayers({ full: { ...target, canvas: { w: 64, h: 48 } }, head: target, single: true }, crop(source, 0, 0, 64, 48), cfg, join(dir, 'config.json')).full.layers[0];
  say('CROP_NATIVE_RECTANGULAR_TARGET_ADDS_NO_SQUARE_PAD', native.takenLayers?.[0].transport?.translate.join(',') === '16,0' && native.pixels.height === 48, 'the shipped nonsquare single-run target uses original painting coordinates');
  const shortCfg = structuredClone(cfg); shortCfg.assemble.take[0].crop.box = [16, 0, 48, 16];
  const shortInput = makeInputs(crop(source, 16, 0, 32, 16), cfg, 'short crop').full;
  writeFileSync(inputPath, encodePngBytes(shortInput));
  const outsideError = error(() => invoke(shortCfg));
  say('CROP_SUPPORTED_MATERIAL_IN_DONOR_PADDING_REFUSED', outsideError.includes('ASSEMBLE_TAKE_CROP'), outsideError);
  const shortManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { layers: Array<{ top: number; bottom: number }> };
  shortManifest.layers[0].top = 12; shortManifest.layers[0].bottom = 20;
  writeFileSync(manifestPath, JSON.stringify(shortManifest));
  const unpadded = invoke(shortCfg);
  say('CROP_NONSQUARE_DONOR_REMOVES_ITS_VERTICAL_PAD', unpadded.takenLayers?.[0].transport?.translate.join(',') === '16,-8' && unpadded.pixels.data[(4 * 64 + 20) * 4 + 3] === 129, '32x16 crop has 8 white rows above and below; supported donor [4,12] maps exactly to target [20,4]');
  shortManifest.layers[0].top = 4; shortManifest.layers[0].bottom = 12;
  writeFileSync(manifestPath, JSON.stringify(shortManifest));
  writeFileSync(inputPath, encodePngBytes(supplied));
  const region = structuredClone(schema) as unknown as { seethrough: unknown; assemble: { take: Array<Record<string, unknown>> } };
  delete region.assemble.take[0].tags; region.assemble.take[0].part = 'hair'; region.assemble.take[0].seed = [1, 1];
  const regionError = error(() => parseEarlyConfig(region, 'layers'));
  say('CROP_REGION_DECLARATION_ACCEPTED', regionError === '', regionError || 'crop is shared by whole-layer and region take declarations');
  const smallHeadCfg = { ...headCfg, seethrough: { ...headCfg.seethrough, head_box: [16, 0, 32, 16] as [number, number, number, number] } };
  const offTarget = error(() => applyTakenLayers({ full: target, head: { ...target, canvas: { w: 16, h: 16 } }, single: false }, source, smallHeadCfg, join(dir, 'config.json')));
  say('CROP_SUPPORT_OFF_TARGET_HEAD_CANVAS_IS_REFUSED', offTarget.includes('ASSEMBLE_TAKE_CROP') && offTarget.includes('outside the declared painting crop or target canvas'),
    offTarget || 'accepted supported donor cells outside the smaller head box');

  for (const [side, canvas] of [[600, 700], [16, 49]]) {
    const unitDir = join(dir, `nonbinary-unit-${side}-${canvas}`);
    mkdirSync(unitDir, { recursive: true });
    const unitSource = paint(side, side, WHITE, []);
    writeFileSync(join(unitDir, 'input.png'), encodePngBytes(unitSource));
    writeRun(join(unitDir, 'donor'), [{ name: 'front hair', depth: 0.4, rects: [{ x0: 4, y0: 4, x1: 20, y1: 12, colour: C }] }], canvas);
    const unitPixels = readPng(join(unitDir, 'donor/parts/front hair.png'));
    for (let p = 0; p < unitPixels.data.length; p += 4) unitPixels.data.set([173, 99, 37, 129], p);
    writeFileSync(join(unitDir, 'donor/parts/front hair.png'), encodePngBytes(unitPixels));
    writeFileSync(join(unitDir, 'donor/meta.json'), JSON.stringify({ prompt_id: 'generated-integer-ratio-control', seed: 0 }));
    const unitDonor = readLayers(join(unitDir, 'donor'));
    const unitTarget = { ...unitDonor, source: join(unitDir, 'target/layers.json'), layers: [] };
    const unitCfg = { ...cfg, seethrough: { ...cfg.seethrough, resolution: canvas }, assemble: { take: [{ ...cfg.assemble.take[0], crop: { box: [0, 0, side, side] as [number, number, number, number], resample: 'bilinear' as const } }] } };
    const unit = applyTakenLayers({ full: unitTarget, head: unitTarget, single: true }, unitSource, unitCfg, join(unitDir, 'config.json')).full.layers[0];
    const unitReceipt = unit.takenLayers![0].transport!;
    const unitExpected = newRaster(canvas, canvas);
    for (let y = 0; y < unitPixels.height; y++) unitExpected.data.set(unitPixels.data.subarray(y * unitPixels.width * 4, (y + 1) * unitPixels.width * 4), ((y + 4) * canvas + 4) * 4);
    say('CROP_INTEGER_RATIO_UNIT_MAP_AVOIDS_FLOAT_ROUND_TRIP', unitReceipt.filter === 'exact' && unitReceipt.scale.join(',') === '1,1' &&
      Buffer.from(unit.pixels.data).equals(Buffer.from(unitExpected.data)),
      `side ${side}, canvas ${canvas}; integer products equal; chained float ${side / canvas * canvas / side}; filter ${unitReceipt.filter}; output agrees with independent translucent RGBA copy`);
  }
}

/** Issue #1251 item 4: rig-grid occluder-split controls across rig_scale 1, 0.5 and 1.5, plus planted run-grid split. */
function runOccluderSplitRigGridChecks(dir: string, say: Say): void {
  mkdirSync(dir, { recursive: true });
  const { occluderSha } = writeChainInputs(dir);
  // Distinct base RGB on the plate run's legwear so bicubic taps across the occluder edge are exposed.
  const basePlate = chainPlate();
  for (let y = LIMB[1]; y < LIMB[3]; y++) {
    for (let x = LIMB[0]; x < LIMB[2]; x++) {
      basePlate.data.set([40, 80, 140, 255], (y * SIDE + x) * 4);
    }
  }
  const fullDir = writePlateRun(dir, encodePngBytes(basePlate));

  const painting = readPng(join(dir, 'painting.png'));
  const occImg = readPng(join(dir, 'occluder.png'));
  const rawCfg = chainConfig({
    occluders: [{ image: 'occluder.png', sha256: occluderSha, under: ['behind'], over: ['front'], rgb_within: 20 }],
    take: [
      { run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['objects'] },
      { run: 'full', run_dir: 'orig', st_input: 'painting.png', part: 'behind', tag: 'legwear', occluder: 0 },
    ],
  });
  const cfgPath = join(dir, 'config.json');
  writeFileSync(cfgPath, JSON.stringify(rawCfg));

  const baseSet = readLayers(fullDir);
  const donorSet = readLayers(join(dir, 'orig'));
  const baseLayer = baseSet.layers.find((l) => l.name === 'legwear')!;
  const donorLayer = donorSet.layers.find((l) => l.name === 'legwear')!;
  const taken = applyTakenLayers(
    { full: baseSet, head: baseSet, single: true },
    painting,
    loadEarlyConfig(cfgPath, 'assemble'),
    cfgPath,
  );
  const splitLayer = taken.full.layers.find((l) => l.name === 'legwear')!;

  const scales = [1, 0.5, 1.5] as const;
  const insideResidueByScale: number[] = [];
  const stageInsideResidueByScale: number[] = [];
  const outsideDiffByScale: number[] = [];
  const insideInteriorDiffByScale: number[] = [];
  const outsideInteriorDiffByScale: number[] = [];
  let plantedInside15 = -1;
  let plantedInsideInterior15 = -1;
  let plantedOutside15 = -1;
  let plantedOutsideInterior15 = -1;

  for (const scale of scales) {
    (rawCfg.assemble as Record<string, unknown>).rig_scale = scale;
    writeFileSync(cfgPath, JSON.stringify(rawCfg));
    const outDir = join(dir, `out-${scale}`);
    const stageRes = assembleStage(
      { source: join(dir, 'painting.png'), full: fullDir, head: null, config: cfgPath, seam: 'near-white', project: 'visible' },
      { partsJson: join(outDir, 'parts.json'), partsDir: join(outDir, 'parts'), recomposite: join(outDir, 'recomposite.png'), errorMap: join(outDir, 'error.png') },
      () => {},
    );
    const behindPlaced = stageRes.images.find((p) => p.record.name === 'behind')!;
    const frame = checkGeometry(
      { sourceW: SIDE, sourceH: SIDE, resolution: SIDE, headBox: [0, 0, SIDE, SIDE], rigScale: scale, single: true },
      { full: taken.full, head: taken.head },
    );
    const { W, H } = frame;
    const behindCanvas = newRaster(W, H);
    for (let y = 0; y < behindPlaced.image.height; y++) {
      for (let x = 0; x < behindPlaced.image.width; x++) {
        const s = (y * behindPlaced.image.width + x) * 4;
        const d = ((behindPlaced.record.y + y) * W + (behindPlaced.record.x + x)) * 4;
        behindCanvas.data.set(behindPlaced.image.data.subarray(s, s + 4), d);
      }
    }

    const { coreBefore } = occluderCoreMask(occImg, W, H);
    const baseRig = layerToRig(placeLayer(baseLayer, SIDE), frame, 'full');
    const donorRig = layerToRig(placeLayer(donorLayer, SIDE), frame, 'full');
    const splitRig = layerToRigSplit(splitLayer, SIDE, frame, 'full', [coreBefore]);
    // Planted old order: split on the run grid (splitLayer.pixels is the run-grid merge), then warp once.
    const plantedOldRig = layerToRigSplit({ ...splitLayer, occluderSplit: undefined }, SIDE, frame, 'full', [coreBefore]);

    const awayFromEdge = (x: number, y: number, target: number): boolean => {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          if (coreBefore.data[ny * W + nx] !== target) return false;
        }
      }
      return true;
    };
    const pxDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray, p: number): boolean =>
      a[p * 4] !== b[p * 4] || a[p * 4 + 1] !== b[p * 4 + 1] || a[p * 4 + 2] !== b[p * 4 + 2] || a[p * 4 + 3] !== b[p * 4 + 3];

    let insideResidue = 0;
    let stageInsideResidue = 0;
    let outsideDiff = 0;
    let insideInteriorDiff = 0;
    let outsideInteriorDiff = 0;
    let oldInside = 0;
    let oldInsideInterior = 0;
    let oldOutside = 0;
    let oldOutsideInterior = 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (coreBefore.data[p] === 1) {
          const interior = awayFromEdge(x, y, 1);
          if (pxDiff(splitRig.data, baseRig.data, p)) {
            insideResidue++;
            if (interior) insideInteriorDiff++;
          }
          if (pxDiff(behindCanvas.data, baseRig.data, p)) stageInsideResidue++;
          if (pxDiff(plantedOldRig.data, baseRig.data, p)) {
            oldInside++;
            if (interior) oldInsideInterior++;
          }
        } else {
          const interior = awayFromEdge(x, y, 0);
          if (pxDiff(splitRig.data, donorRig.data, p)) {
            outsideDiff++;
            if (interior) outsideInteriorDiff++;
          }
          if (pxDiff(plantedOldRig.data, donorRig.data, p)) {
            oldOutside++;
            if (interior) oldOutsideInterior++;
          }
        }
      }
    }
    insideResidueByScale.push(insideResidue);
    stageInsideResidueByScale.push(stageInsideResidue);
    outsideDiffByScale.push(outsideDiff);
    insideInteriorDiffByScale.push(insideInteriorDiff);
    outsideInteriorDiffByScale.push(outsideInteriorDiff);
    if (scale === 1.5) {
      plantedInside15 = oldInside;
      plantedInsideInterior15 = oldInsideInterior;
      plantedOutside15 = oldOutside;
      plantedOutsideInterior15 = oldOutsideInterior;
    }
  }

  say(
    'OCCLUDER_SPLIT_RIG_GRID_RESIDUE_ZERO_ACROSS_SCALES',
    insideResidueByScale[0] === 0 &&
      insideResidueByScale[1] === 0 &&
      insideResidueByScale[2] === 0 &&
      stageInsideResidueByScale[0] === 0 &&
      stageInsideResidueByScale[1] === 0 &&
      stageInsideResidueByScale[2] === 0,
    `inside-occluder residue at rig_scale [1, 0.5, 1.5] = [${insideResidueByScale.join(', ')}] (assembled behind.png = [${stageInsideResidueByScale.join(', ')}])`,
  );
  say(
    'OCCLUDER_SPLIT_PLANTED_RUN_GRID_ORDER_FIRES_423_AT_1_5X',
    plantedInside15 === 423 && plantedOutside15 === 441,
    `planted run-grid split + single warp at rig_scale 1.5 leaves ${plantedInside15} inside residue px and ${plantedOutside15} outside bleed px`,
  );
  say(
    'OCCLUDER_SPLIT_OUTSIDE_EQUALS_PLACED_RUN_ACROSS_SCALES',
    outsideDiffByScale[0] === 0 && outsideDiffByScale[1] === 0 && outsideDiffByScale[2] === 0,
    `outside-occluder differing px vs placed donor run at rig_scale [1, 0.5, 1.5] = [${outsideDiffByScale.join(', ')}]`,
  );
  say(
    'OCCLUDER_SPLIT_INTERIOR_BEYOND_CHEBYSHEV_2_EQUALS_PLACED_RUN',
    insideInteriorDiffByScale[0] === 0 &&
      insideInteriorDiffByScale[1] === 0 &&
      insideInteriorDiffByScale[2] === 0 &&
      outsideInteriorDiffByScale[0] === 0 &&
      outsideInteriorDiffByScale[1] === 0 &&
      outsideInteriorDiffByScale[2] === 0 &&
      plantedInsideInterior15 === 0 &&
      plantedOutsideInterior15 === 0,
    `Chebyshev distance > 2 differing px inside=[${insideInteriorDiffByScale.join(', ')}], outside=[${outsideInteriorDiffByScale.join(', ')}], planted@1.5=[${plantedInsideInterior15}, ${plantedOutsideInterior15}]`,
  );

  // Item 1 guard control: replacing a split layer's pixels with a new Raster copy and changing 1 opaque px
  // falls back to plain layerToRig(placeLayer(layer)), whereas a plant without the identity guard drops the change.
  const frame1 = checkGeometry(
    { sourceW: SIDE, sourceH: SIDE, resolution: SIDE, headBox: [0, 0, SIDE, SIDE], rigScale: 1, single: true },
    { full: taken.full, head: taken.head },
  );
  const { coreBefore: core1 } = occluderCoreMask(occImg, frame1.W, frame1.H);
  const copiedPixels: typeof splitLayer.pixels = {
    width: splitLayer.pixels.width,
    height: splitLayer.pixels.height,
    data: new Uint8ClampedArray(splitLayer.pixels.data),
  };
  const witnessIdx = (64 * SIDE + 64) * 4;
  copiedPixels.data.set([250, 10, 200, 255], witnessIdx);
  const replacedLayer = { ...splitLayer, pixels: copiedPixels };
  const guardedRig = layerToRigSplit(replacedLayer, SIDE, frame1, 'full', [core1]);
  const plainRig = layerToRig(placeLayer(replacedLayer, SIDE), frame1, 'full');
  const unguardedPlantLayer = {
    ...replacedLayer,
    occluderSplit: { ...splitLayer.occluderSplit!, merged: copiedPixels },
  };
  const unguardedRig = layerToRigSplit(unguardedPlantLayer, SIDE, frame1, 'full', [core1]);
  const guardedMatchesPlain = Buffer.from(guardedRig.data).equals(Buffer.from(plainRig.data));
  const witnessShown =
    guardedRig.data[witnessIdx] === 250 &&
    guardedRig.data[witnessIdx + 1] === 10 &&
    guardedRig.data[witnessIdx + 2] === 200 &&
    guardedRig.data[witnessIdx + 3] === 255;
  const plantDropsWitness =
    unguardedRig.data[witnessIdx] === 40 &&
    unguardedRig.data[witnessIdx + 1] === 80 &&
    unguardedRig.data[witnessIdx + 2] === 140 &&
    !Buffer.from(unguardedRig.data).equals(Buffer.from(plainRig.data));
  say(
    'OCCLUDER_SPLIT_PIXELS_IDENTITY_GUARD_FALLS_BACK_ON_REPLACED_PIXELS',
    guardedMatchesPlain && witnessShown && plantDropsWitness,
    `guarded matches plain layerToRig=${guardedMatchesPlain}, witness=[${guardedRig.data.subarray(witnessIdx, witnessIdx + 4).join(',')}], unguarded plant witness=[${unguardedRig.data.subarray(witnessIdx, witnessIdx + 4).join(',')}]`,
  );
}
