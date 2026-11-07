/** Public flat blocks with hand-counted projection-input cover. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAlternateCutLayerFixture } from './alternate_cut_layers.ts';
import { writeArtistFixture } from './artist.ts';
import { assembleConfig, writeRun, writeAssembleFixture, limbConfig, LIMB_FULL, HEAD_LAYERS, flatPainting, type RunLayerSpec } from './assemble_fixture.ts';
import { assembleStage } from '../src/build.ts';
import { readLayers } from '../src/layers.ts';
import { newRaster } from '../src/raster/types.ts';
import { writePng } from '../src/raster/png.ts';
import { SOURCE_COVER_FILE, sourceCoverReport, sourceCoverRun } from '../src/sourcecover.ts';
import { frontOf, pixelOwners, planRanks } from '../src/assemble.ts';
import { newMask } from '../src/raster/types.ts';
import type { PlanEntry } from '../src/config.ts';

type Report = ReturnType<typeof sourceCoverReport>;
type Say = (name: string, ok: boolean, detail: string) => void;

export function runSourceCoverChecks(parent: string, say: Say): void {
  const dir = join(parent, 'source-cover');
  mkdirSync(dir, { recursive: true });
  const plan: PlanEntry[] = [['neck', 'full', 'neck'], ['face', 'head', 'face']];
  const block = (name: string, depth: number, x: number, y: number, w: number, h: number): RunLayerSpec => ({
    name, depth, rects: [{ x0: x, y0: y, x1: x + w, y1: y + h, colour: [100, 110, 120] }],
  });
  const full = [block('neck', 0.8, 8, 32, 48, 24), block('author:duplicate', 0.1, 16, 36, 16, 16)];
  const head = [block('face', 0.8, 8, 8, 48, 48), block('author:duplicate', 0.1, 24, 24, 16, 16)];
  writeRun(join(dir, 'full'), full, 64);
  writeRun(join(dir, 'head'), head, 64);
  writeRun(join(dir, 'alternate-full'), [full[0], block('author:duplicate', 0.1, 16, 36, 12, 12)], 64);
  const painting = newRaster(64, 64);
  for (let p = 0; p < 64 * 64; p++) painting.data.set([90, 100, 110, 255], p * 4);
  writePng(join(dir, 'painting.png'), painting);
  const config = assembleConfig({ plan, extend: [], headBox: [16, 0, 48, 32], resolution: 64, rigScale: 1 });
  Object.assign(config.assemble as object, { project: 'visible', seam: 'silhouette' });
  const input = { source: join(dir, 'painting.png'), full: join(dir, 'full'), head: join(dir, 'head'), config: join(dir, 'config.json') };
  const out = join(dir, 'out');
  const outputs = { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite.png'), errorMap: join(out, 'error.png') };
  const run = () => {
    writeFileSync(input.config, JSON.stringify(config));
    const result = assembleStage(input, outputs, () => {});
    const report = JSON.parse(readFileSync(join(out, SOURCE_COVER_FILE), 'utf8')) as Report;
    return { result, report };
  };
  const spans = (x: number, y: number, w: number, h: number) => Array.from({ length: h }, (_, row) => [y + row, x, x + w]);
  const membership = (report: Report): unknown => report.sets[0].parts.flatMap(part =>
    part.covered_by.filter(owner => !owner.planned).map(owner => ({ part: part.part, ...owner })));
  const expected = [
    { part: 'neck', source: 'full:author:duplicate', planned: false, pixels: { count: 256, spans: spans(16, 36, 16, 16) } },
    { part: 'face', source: 'head:author:duplicate', planned: false, pixels: { count: 64, spans: spans(28, 12, 8, 8) } },
  ];
  const matches = (report: Report) => JSON.stringify(membership(report)) === JSON.stringify(expected);
  const primary = run();
  const dropped = structuredClone(primary.report);
  dropped.sets[0].parts[0].covered_by = [];
  const wrongOwner = structuredClone(primary.report);
  wrongOwner.sets[0].parts[0].covered_by[0].source = 'full:neck';
  say('AS1158_SOURCE_COVER_EXACT_MEMBERSHIP_AND_PLANTED_OWNERS',
    primary.report.spec === 'rig-parts-source-cover/1' && primary.report.stage === 'source-projection-input' &&
    primary.report.sets.length === 1 && matches(primary.report) && !matches(dropped) && !matches(wrongOwner),
    `neck 256 px, face 64 px; positive ${matches(primary.report)}, dropped ${matches(dropped)}, wrong owner ${matches(wrongOwner)}`);
  const source = primary.report.sets[0].sources.find(layer => layer.source === 'full:author:duplicate');
  say('AS1158_SOURCE_COVER_BINDS_INPUTS_AND_ZERO_RANK',
    source?.plan_rank === -1 && source.depth_median === 0.1 && source.draw_order === 1 && source.input_layer === 'author:duplicate' &&
    primary.report.sets[0].inputs.every(row => row.sha256 === createHash('sha256').update(readFileSync(join(dir, row.run, row.file))).digest('hex')),
    'both real-loader manifests are hash-bound; unplanned duplicate retains depth and input identity');

  // A separate alternate input has a 12-by-12 duplicate, rather than the primary's 16-by-16.
  Object.assign(config.assemble as object, { alternates: [{ name: 'variant', source: 'painting.png', full: 'alternate-full', head: 'head', parts: ['neck'] }] });
  const alternate = run();
  const variant = alternate.report.sets.find(set => set.set === 'variant');
  say('AS1158_SOURCE_COVER_ALTERNATE_EVALUATES_AND_INHERITS',
    variant?.parts.length === 1 && variant.parts[0].part === 'neck' && variant.parts[0].covered_by[0]?.pixels.count === 144 &&
    JSON.stringify(variant.inherited_parts) === JSON.stringify([{ part: 'face', set: null }]) &&
    variant.output_assets.find(asset => asset.part === 'face')?.image === 'face.png' &&
    variant.output_assets.find(asset => asset.part === 'neck')?.image === 'variant_neck.png' && matches(alternate.report),
    'variant neck has its own 144 px reading; face explicitly references the primary and its image');

  // Reuse the same output under core projection with both duplicate entries removed.
  delete (config.assemble as Record<string, unknown>).alternates;
  Object.assign(config.assemble as object, { project: 'core' });
  writeRun(join(dir, 'full'), [full[0]], 64);
  writeRun(join(dir, 'head'), [head[0]], 64);
  const empty = run();
  say('AS1158_SOURCE_COVER_EMPTY_FILE_REPLACES_PREVIOUS_SETS',
    empty.report.sets.length === 1 && empty.report.sets[0].set === null &&
    empty.report.sets[0].parts.length === 2 && empty.report.sets[0].parts.every(part => part.covered_by.length === 0),
    'core projection still writes the file, with both empty rows and no stale alternate');

  // Direct owner-site semantics include held support and planned-owner classification.
  const loaded = readLayers(join(dir, 'full'));
  const duplicate = { ...loaded.layers[0], name: 'author:duplicate', drawOrder: 1 };
  const layers = { ...loaded, layers: [loaded.layers[0], duplicate] };
  const raster = newRaster(1, 1); raster.data.set([100, 110, 120, 255]);
  const ranks = planRanks(layers.layers.map(layer => layer.name), 'full', plan);
  const owners = pixelOwners([raster, raster], ranks);
  const kept = newMask(1, 1); kept.data[0] = 1;
  const reading = sourceCoverRun('full', layers, loaded, [raster, raster], ranks, plan,
    [{ part: 'face', run: 'full', tag: 'author:duplicate' }], owners, (o, i) => frontOf(o, i, ranks), [kept, null]);
  const planned: PlanEntry[] = [...plan, ['cover', 'full', 'author:duplicate']];
  const plannedRanks = planRanks(layers.layers.map(layer => layer.name), 'full', planned);
  const plannedReading = sourceCoverRun('full', layers, loaded, [raster, raster], plannedRanks, planned, [],
    pixelOwners([raster, raster], plannedRanks), (o, i) => frontOf(o, i, plannedRanks), null);
  say('AS1158_SOURCE_COVER_HELD_AND_EXTEND_ONLY_ARE_EXPLICIT',
    reading.parts[0].held_under_cover_px === 1 && reading.parts[0].covered_by.length === 0 &&
    reading.sources[1].plan_rank === -1 && reading.sources[1].extend_parts.join(',') === 'face' &&
    reading.sources[1].input_layer === null && reading.sources[1].prepared && kept.data[0] === 1 && owners[0] === 1 &&
    plannedReading.parts[0].covered_by[0]?.planned === true && plannedReading.parts[1].covered_by.length === 0,
    'held own support has a separate count; extend-only stays unplanned; a planned front owner is identified as planned');

  const cloned = { ...loaded, layers: loaded.layers.map(layer => ({ ...layer,
    pixels: { ...layer.pixels, data: new Uint8ClampedArray(layer.pixels.data) } })) };
  const clonePlan: PlanEntry[] = [['neck', 'full', 'neck']];
  const cloneReading = () => sourceCoverRun('full', cloned, loaded, [raster], [0], clonePlan, [], new Int32Array([0]), () => false, null);
  const identical = cloneReading();
  cloned.layers[0].pixels.data[0]++;
  const changed = cloneReading();
  say('AS1158_PREPARED_COMPARES_MATERIAL_CONTENT',
    !identical.sources[0].prepared && changed.sources[0].prepared,
    'a distinct byte-identical buffer is unprepared; changing one RGBA channel marks preparation');


  const cutDir = join(dir, 'source-only');
  writeAlternateCutLayerFixture(cutDir);
  const cutConfigPath = join(cutDir, 'config.json');
  const cutConfig = JSON.parse(readFileSync(cutConfigPath, 'utf8')) as { assemble: { cuts: Array<Record<string, unknown>>; alternates: unknown[]; project?: string } };
  cutConfig.assemble.alternates = [{ name: 'source-only', source: 'raised.png', full: 'step', head: 'head',
    parts: ['sleeve'], cuts: cutConfig.assemble.cuts }];
  writeFileSync(cutConfigPath, JSON.stringify(cutConfig));
  const cutOut = join(cutDir, 'out');
  assembleStage({ config: cutConfigPath, source: join(cutDir, 'painting.png'), full: join(cutDir, 'full'), head: join(cutDir, 'head') },
    { partsJson: join(cutOut, 'parts.json'), partsDir: join(cutOut, 'parts'), recomposite: join(cutOut, 'recomposite.png'), errorMap: join(cutOut, 'error.png') }, () => {});
  const cutReport = JSON.parse(readFileSync(join(cutOut, SOURCE_COVER_FILE), 'utf8')) as Report;
  const cutSet = cutReport.sets.find(set => set.set === 'source-only');
  say('AS1158_SOURCE_ONLY_CUT_PARENT_IS_NOT_AN_ALTERNATE_PART',
    cutSet !== undefined && cutSet.parts.some(part => part.part === 'sleeve' && part.source_of === 'body' &&
      part.support_px === 1280 && part.covered_by.some(owner => owner.source === 'full:author:raised' && owner.pixels.count === 832)) &&
    cutSet.inherited_parts.some(part => part.part === 'body' && part.set === null) &&
    cutSet.sources.some(layer => layer.source === 'full:topwear' && layer.planned_parts.includes('body')) &&
    cutSet.output_assets.some(asset => asset.part === 'sleeve' && asset.image === 'source-only_sleeve.png') &&
    cutSet.parts.every(part => !cutSet.inherited_parts.some(inherited => inherited.part === part.part)),
    'cut-from body remains an inherited asset and an evaluated source; only covered parts receive alternate part rows');

  cutConfig.assemble.project = 'visible';
  cutConfig.assemble.alternates = [{ name: 'uncovered', source: 'raised.png', full: 'step', head: 'head',
    parts: ['body'], cuts: cutConfig.assemble.cuts.map(cut => ({ ...cut, into: 'alternate-only' })) }];
  writeFileSync(cutConfigPath, JSON.stringify(cutConfig));
  assembleStage({ config: cutConfigPath, source: join(cutDir, 'painting.png'), full: join(cutDir, 'full'), head: join(cutDir, 'head') },
    { partsJson: join(cutOut, 'parts.json'), partsDir: join(cutOut, 'parts'), recomposite: join(cutOut, 'recomposite.png'), errorMap: join(cutOut, 'error.png') }, () => {});
  const assetReport = JSON.parse(readFileSync(join(cutOut, SOURCE_COVER_FILE), 'utf8')) as Report;
  const assetSet = assetReport.sets.find(set => set.set === 'uncovered');
  const allocation = JSON.parse(readFileSync(join(cutOut, 'painting_allocation.uncovered.json'), 'utf8')) as { output_assets: Report['sets'][number]['output_assets'] };
  say('AS1158_UNCOVERED_ALTERNATE_ONLY_ASSET_IS_NULL',
    assetSet?.output_assets.some(asset => asset.part === 'alternate-only' && asset.image === null) === true &&
    !existsSync(join(cutOut, 'parts', 'alternate-only.png')) &&
    JSON.stringify(allocation.output_assets) === JSON.stringify(assetSet.output_assets),
    'both reports map a filtered alternate-only cut to null; the primary emits no such image');

  const limbDir = join(dir, 'segments');
  const limbCfg = limbConfig();
  Object.assign(limbCfg.assemble as object, { alternates: [{ name: 'segments', source: 'painting.png', full: 'full', head: 'head', parts: ['upperarm_r', 'forearm_r'] }] });
  writeAssembleFixture(limbDir, limbCfg, flatPainting(), { full: LIMB_FULL, head: HEAD_LAYERS });
  const limbOut = join(limbDir, 'out');
  assembleStage({ config: join(limbDir, 'config.json'), source: join(limbDir, 'painting.png'), full: join(limbDir, 'full'), head: join(limbDir, 'head') },
    { partsJson: join(limbOut, 'parts.json'), partsDir: join(limbOut, 'parts'), recomposite: join(limbOut, 'recomposite.png'), errorMap: join(limbOut, 'error.png') }, () => {});
  const limbReport = JSON.parse(readFileSync(join(limbOut, SOURCE_COVER_FILE), 'utf8')) as Report;
  const limbSet = limbReport.sets.find(set => set.set === 'segments');
  say('AS1158_COVERED_SEGMENTS_RETAIN_THEIR_SOURCE_ROW',
    limbSet?.parts.length === 2 && ['upperarm_r', 'forearm_r'].every(name => limbSet.parts.some(part =>
      part.part === name && part.source_of === 'arm' && part.source === 'full:handwear-r' && part.support_px === 320)) &&
    limbSet.parts.every(part => !limbSet.inherited_parts.some(inherited => inherited.part === part.part)),
    'both arm segments carry the complete arm input reading and remain disjoint from inherited assets');


  const singleDir = join(dir, 'padded-single');
  writeArtistFixture(singleDir, { portrait: true });
  const singleOut = join(singleDir, 'out');
  const singleResult = assembleStage({ config: join(singleDir, 'config.json'), source: join(singleDir, 'painting.png'), full: join(singleDir, 'art.psd'), head: null },
    { partsJson: join(singleOut, 'parts.json'), partsDir: join(singleOut, 'parts'), recomposite: join(singleOut, 'recomposite.png'), errorMap: join(singleOut, 'error.png') }, () => {});
  const singleReport = JSON.parse(readFileSync(join(singleOut, SOURCE_COVER_FILE), 'utf8')) as Report;
  const singleSources = singleReport.sets[0].sources;
  say('AS1158_SINGLE_RUN_PADDING_IS_NOT_SOURCE_PREPARATION',
    (singleResult.parts.single_run_pad?.left ?? 0) > 0 && singleSources.length > 0 &&
    singleSources.every(layer => layer.run === 'full' && layer.input_layer === layer.layer && !layer.prepared),
    'portrait PSD requires centering pad; every unprepared source retains prepared false against the padded baseline');
}
