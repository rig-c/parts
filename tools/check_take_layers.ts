/** Generated end-to-end controls for #866; the real stage and strict parts reader. */
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAlternateLayerFixture } from '../fixtures/alternate_layers.ts';
import { writeTakeFixture } from '../fixtures/take_layers.ts';
import { assembleStage, readRuns } from '../src/build.ts';
import { readParts } from '../src/parts.ts';
import { loadEarlyConfig, parseConfig, parseEarlyConfig } from '../src/config.ts';
import { makeInputs } from '../src/inputs.ts';
import { applyTakenLayers } from '../src/takelayers.ts';
import { writeRun, paint, C, WHITE } from '../fixtures/assemble_fixture.ts';
import { spawnSync } from 'node:child_process';
import { PartsError } from '../src/errors.ts';
import { readPng, encodePngBytes } from '../src/raster/png.ts';

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
  say('INPUT_DIMENSIONS_REFUSED_WITHOUT_RESAMPLING', dimsMessage.includes('ASSEMBLE_TAKE_GEOMETRY'), dimsMessage);
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

}
