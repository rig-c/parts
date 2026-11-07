/** Public flat blocks with hand-counted projection-input cover. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleConfig, writeRun, type RunLayerSpec } from './assemble_fixture.ts';
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
}
