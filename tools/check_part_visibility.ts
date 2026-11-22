/** Generated production controls for layer-record transport through assembly (#1471). */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleConfig } from '../fixtures/assemble_fixture.ts';
import { writeTakeRegionFixture } from '../fixtures/take_region.ts';
import { assembleStage, type AssembleStageInput } from '../src/build.ts';
import { PartsError } from '../src/errors.ts';
import { readParts, VISIBILITY_KEYS } from '../src/parts.ts';
import { checkPartsStage } from '../src/partscheck.ts';
import { encodePngBytes, readPng } from '../src/raster/png.ts';
import type { Raster } from '../src/raster/types.ts';
import { writeVisibilityRecord } from '../src/visibility.ts';

type Say = (name: string, pass: boolean, detail: string, why: string) => void;
type Pixel = (x: number, y: number) => number[];
interface Layer {
  tag: string;
  left: number;
  top: number;
  width: number;
  height: number;
  order: number;
  art: Pixel;
  depth: Pixel;
}

const identity = { prompt_id: 'fixture-1471', input_sha256: 'a'.repeat(64), graph_sha256: 'b'.repeat(64) };
const gray = (level: number): Pixel => () => [level, level, level, 255];
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown): string => JSON.stringify(value);
const same = (a: unknown, b: unknown): boolean => json(a) === json(b);

function png(file: string, width: number, height: number, pixel: Pixel): void {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  writeFileSync(file, encodePngBytes({ width, height, data }));
}

function wrapper(dir: string, layers: readonly Layer[]): void {
  mkdirSync(join(dir, 'parts'), { recursive: true });
  const rows = layers.map(({ tag, left, top, width, height, order, art, depth }) => {
    png(join(dir, 'parts', tag + '.png'), width, height, art);
    png(join(dir, 'parts', tag + '_depth.png'), width, height, depth);
    return { name: tag, filename: tag + '.png', depth_filename: tag + '_depth.png',
      left, top, right: left + width, bottom: top + height, depth_median: order };
  });
  writeFileSync(join(dir, 'layers.json'), json({ width: 64, height: 64, layers: rows }));
}

function record(dir: string): ReturnType<typeof writeVisibilityRecord> {
  const manifest = writeVisibilityRecord(dir, identity);
  writeFileSync(join(dir, 'meta.json'), json({
    prompt_id: identity.prompt_id, uploaded_image_sha256: identity.input_sha256, graph_sha256: identity.graph_sha256,
  }));
  return manifest;
}

function refusal(run: () => unknown): string {
  try { run(); return 'accepted'; }
  catch (error) { if (error instanceof PartsError) return error.problems.map(p => p.code).join(','); throw error; }
}

function plant(path: string, bytes: Uint8Array | string, run: () => unknown): string {
  const original = readFileSync(path);
  try { writeFileSync(path, bytes); return refusal(run); }
  finally { writeFileSync(path, original); }
}

function fixture(dir: string, plan: string[][], fullLayers: readonly Layer[], headLayers: readonly Layer[], rigScale = 1) {
  const full = join(dir, 'full'), head = join(dir, 'head'), config = join(dir, 'config.json');
  const source = join(dir, 'painting.png');
  wrapper(full, fullLayers);
  wrapper(head, headLayers);
  png(source, 64, 64, gray(255));
  const cfg = assembleConfig({ plan, extend: [], headBox: [0, 0, 64, 64], resolution: 64, rigScale });
  const assembly = cfg.assemble as Record<string, unknown>;
  const run = (out: string, fullInput = full, alts?: AssembleStageInput['alts']) => {
    writeFileSync(config, json(cfg));
    return assembleStage({ source, full: fullInput, head, config, alts, project: 'core', seam: 'near-white' },
      { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'flat.png'), errorMap: join(out, 'error.png') }, () => {});
  };
  return { full, head, source, assembly, run };
}

export function runPartVisibilityChecks(dir: string, say: Say): void {
  const face: Layer = { tag: 'face', left: 16, top: 16, width: 32, height: 32, order: 0.5, art: () => [40, 0, 0, 255], depth: gray(20) };
  const back: Layer = { tag: 'back hair', left: 16, top: 16, width: 16, height: 16, order: 0.8,
    art: x => [20, 35, 70, x === 15 ? 127 : 255], depth: gray(20) };
  const front: Layer = { tag: 'topwear', left: 16, top: 16, width: 12, height: 16, order: 0.2,
    art: x => [76, 30, 12, x >= 4 && x < 8 ? 200 : 255], depth: x => gray(x < 8 ? 10 : 20)(x, 0) };
  const plan = [['back', 'full', back.tag], ['front', 'full', front.tag]];
  const exact = fixture(join(dir, 'integer'), plan, [back, front], [face]);
  const manifest = record(exact.full);
  const output = join(dir, 'integer-parts'), partsPath = join(output, 'parts.json');
  exact.run(output, join(exact.full, 'layers.json'));
  const { parts: [rear] } = readParts(partsPath);
  const expected = {
    source_layers: ['full:back hair'], visible_px: 48, occluded_px: 64,
    undecided_px: { 'partial-top': 64, 'depth-tie': 64, 'mixed-source-states': 0 }, unrecorded_px: 16,
  };
  const lines: string[] = [];
  const checked = checkPartsStage(output, join(dir, 'integer-check'), line => lines.push(line));
  const measurement = checked.reported.filter(row => row.code === 'PARTS_INVENTED_MATERIAL').find(row => row.part === 'back');
  say('AS1471_RECORDED_VISIBILITY_PARTITIONS_OPAQUE', rear.opaque_px === 256 && same(rear.source_visibility, expected) &&
    rear.visible_px === 128 && rear.occluded_px === 128,
    json(rear.source_visibility), 'Four columns each are occluded, partial-top, and depth-tie. Three far columns are visible and the last column (alpha 127) is below the record floor.');
  say('AS1471_CHECK_PARTS_MEASURES_WITH_EXPOSURE_HOLE', checked.exit_code === 0 && measurement?.occluded_px === 64 &&
    same(measurement.undecided_px, expected.undecided_px) && !checked.holes.some(row => row.code === 'PARTS_INVENTED_MATERIAL') &&
    lines.some(line => line.startsWith('PARTS_INVENTED_MATERIAL: REPORTED part "back" — occluded 64 px')) &&
    checked.holes.some(row => row.code === 'PARTS_INVENTED_EXPOSURE'),
    json(measurement), 'Part-level material counts are measurements. Pose exposure is still a HOLE.');

  const rejectOut = join(dir, 'refused');
  const maskPath = join(exact.full, manifest.layers.find(layer => layer.tag === back.tag)!.record.path);
  const tampered = readFileSync(maskPath);
  tampered[0] = 1;
  const badHash = plant(maskPath, tampered, () => exact.run(rejectOut));
  const imageHash = plant(join(exact.full, 'parts', 'back hair.png'), 'not a PNG', () => exact.run(rejectOut));
  const metaPath = join(exact.full, 'meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
  const badIdentity = plant(metaPath, json({ ...meta, prompt_id: 'another-prompt' }), () => exact.run(rejectOut));
  const malformedMeta = plant(metaPath, json({ ...meta, uploaded_image_sha256: 'absent' }), () => exact.run(rejectOut));
  say('AS1471_TAMPERED_RECORD_REFUSED_BEFORE_EMISSION',
    badHash === 'VISIBILITY_HASH' && imageHash === 'VISIBILITY_HASH' && badIdentity === 'VISIBILITY_MANIFEST' && malformedMeta === 'VISIBILITY_SOURCE' && !existsSync(rejectOut),
    `state byte ${badHash}, layer bytes ${imageHash}, prompt ${badIdentity}, malformed meta ${malformedMeta}`,
    'Use producer metadata for the expected identity and refuse tampering before assemble publishes anything.');

  const badParts = readParts(partsPath);
  badParts.parts[0].source_visibility!.occluded_px++;
  let badReport: ReturnType<typeof checkPartsStage> | undefined;
  const sum = plant(partsPath, json(badParts), () => {
    badReport = checkPartsStage(output, join(dir, 'miscount-check'), () => {});
    readParts(partsPath);
  });
  say('AS1471_READER_REFUSES_PLANTED_MISCOUNT', sum === 'PARTS_COUNTS_ADD_UP' && badReport?.exit_code === 1 &&
    badReport.refusals.some(row => row.code === 'PARTS_COUNTS_ADD_UP' && row.detail.includes('sum to 257; opaque_px 256 is required')),
    `readParts ${sum}, check-parts ${badReport?.exit_code}`, 'Raise a recorded count by one while preserving the opaque control.');

  const basePart = readFileSync(join(output, 'parts', 'back.png'));
  const edit = readPng(join(output, 'parts', 'back.png'));
  edit.data[3] = 0;
  edit.data[4] = 127;
  const editBytes = encodePngBytes(edit);
  const editDir = join(dir, 'integer', 'edited');
  mkdirSync(editDir);
  writeFileSync(join(editDir, 'back.png'), editBytes);
  exact.assembly.edited_parts = { dir: 'edited', receipts: [{ part: 'back', file: 'back.png', editor: 'fixture',
    from_sha256: sha(basePart), sha256: sha(editBytes) }] };
  const [{ record: replaced }] = exact.run(join(dir, 'edited-parts')).images;
  delete exact.assembly.edited_parts;
  say('AS1471_VISIBILITY_COUNTS_FOLLOW_WHOLE_PART_EDIT', replaced.opaque_px === 255 &&
    same(replaced.source_visibility, { ...expected, occluded_px: 62, unrecorded_px: 17 }),
    json(replaced.source_visibility), 'One occluded pixel is removed and one other occluded pixel is painted over by the outside-record replacement.');

  const noRecordOut = join(dir, 'no-record-parts');
  renameSync(join(exact.full, 'visibility.json'), join(dir, 'withheld-visibility.json'));
  exact.run(noRecordOut);
  const noRecord = checkPartsStage(noRecordOut, join(dir, 'no-record-check'), () => {});
  say('AS1471_NO_RECORD_PRESERVES_LEGACY_FIELDS', readParts(join(noRecordOut, 'parts.json')).parts.every(p => p.source_visibility === undefined) &&
    basePart.equals(readFileSync(join(noRecordOut, 'parts', 'back.png'))) &&
    noRecord.holes.find(row => row.code === 'PARTS_INVENTED_MATERIAL')?.line ===
      'PARTS_INVENTED_MATERIAL: HOLE — no validated producer-bound per-pixel painted-versus-invented record',
    json(noRecord.holes.find(row => row.code === 'PARTS_INVENTED_MATERIAL')),
    'A missing sibling manifest leaves legacy metadata and part PNGs intact.');

  const solidRear = { ...back, art: () => [20, 35, 70, 255] };
  const halfFront = { ...front, width: 8, art: () => [76, 30, 12, 255], depth: gray(10) };
  const scaled = fixture(join(dir, 'scaled'), plan, [solidRear, halfFront], [face], 2);
  record(scaled.full);
  const scaledBack = scaled.run(join(dir, 'scaled-parts')).parts.parts[0];
  say('AS1471_BICUBIC_COUNTS_MIXED_TAPS', scaledBack.source_visibility?.undecided_px['mixed-source-states'] === 99 &&
    scaledBack.source_visibility.unrecorded_px === 0,
    json(scaledBack.source_visibility),
    'Three fractional columns have nonzero taps on both sides of the overlap boundary. Each spans all 33 opaque output rows.');

  const underfill = fixture(join(dir, 'underfill'), [['face', 'head', 'face']], [face], [
    { ...face, art: (x, y) => [220, 0, 0, y === 10 && x === 10 ? 128 : y === 10 && x === 11 ? 0 : 255] },
  ]);
  underfill.assembly.head_face_underfill = true;
  record(underfill.full);
  const [{ record: filled, image }] = underfill.run(join(dir, 'underfill-parts')).images;
  const at = (art: Raster, x: number, y: number): number[] => {
    const offset = ((y - filled.y) * art.width + x - filled.x) * 4;
    return [...art.data.subarray(offset, offset + 4)];
  };
  say('AS1471_HEAD_UNDERFILL_TRACKS_BOTH_LAYER_CONTRIBUTORS', same(filled.source_visibility?.source_layers, ['full:face', 'head:face']) &&
    same(at(image, 26, 26), [130, 0, 0, 255]) && same(at(image, 27, 26), [40, 0, 0, 255]) &&
    filled.source_visibility?.visible_px === 1 && filled.source_visibility.unrecorded_px === 1023,
    json(filled.source_visibility), 'One hole takes full-run art alone. The adjacent semitransparent pixel blends the recorded and outside-record layers.');

  const alternate = fixture(join(dir, 'alternate'), plan, [back, front], [face]);
  const alts = [{ name: 'alt', source: alternate.source, full: alternate.full, head: alternate.head }];
  const legacy = exact.run(join(dir, 'legacy-alternate'), exact.full, alts).parts.alternates?.[0]?.records[0];
  record(alternate.full);
  const alternateOut = join(dir, 'recorded-alternate');
  exact.run(alternateOut, exact.full, alts);
  const alternateParts = readParts(join(alternateOut, 'parts.json'));
  const altBack = alternateParts.alternates?.[0]?.records[0];
  const altCheck = checkPartsStage(alternateOut, join(dir, 'alternate-check'), () => {});
  say('AS1471_ALTERNATE_HAS_OWN_RECORD_AND_LEGACY_COUNTS', same(altBack?.source_visibility, expected) &&
    VISIBILITY_KEYS.every(key => altBack?.[key] === legacy?.[key]) &&
    alternateParts.parts.every(part => part.source_visibility === undefined) &&
    altCheck.reported.some(row => row.code === 'PARTS_INVENTED_MATERIAL' && row.set === 'alt' && row.part === 'back'),
    json(altBack?.source_visibility), 'An alternate uses its own full run record while the primary set keeps its record-free fields.');

  const regionHome = join(dir, 'region'), regionFull = join(regionHome, 'full');
  const cfg = writeTakeRegionFixture(regionHome);
  const layersPath = join(regionFull, 'layers.json');
  const run = JSON.parse(readFileSync(layersPath, 'utf8')) as {
    layers: { name: string; left: number; top: number; right: number; bottom: number; depth_filename?: string }[];
  };
  run.layers.forEach((layer, i) => {
    layer.depth_filename = `${layer.name}_depth.png`;
    png(join(regionFull, 'parts', layer.depth_filename), layer.right - layer.left, layer.bottom - layer.top, gray(20 - i * 3));
  });
  writeFileSync(layersPath, json(run));
  record(regionFull);
  const runRegion = (name: string) => {
    const out = join(regionHome, name), config = join(regionHome, 'config.json');
    writeFileSync(config, json(cfg));
    return assembleStage({ full: regionFull, source: join(regionHome, 'painting.png'), head: null, config },
      { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'flat.png'), errorMap: join(out, 'error.png') }, () => {});
  };
  const assembly = cfg.assemble as Record<string, unknown>;
  const take = assembly.take;
  delete assembly.take;
  const before = runRegion('before');
  assembly.take = take;
  const after = runRegion('after');
  const [body, neighbour] = after.images;
  say('AS1471_REGION_TAKE_MEASURES_RETAINED_NEIGHBOUR_AND_DONOR', body.record.opaque_px === before.images[0].record.opaque_px + 96 &&
    body.record.source_visibility?.source_layers.includes('full:topwear') === true && body.record.source_visibility.unrecorded_px >= 96 &&
    same(neighbour.record.source_visibility, before.images[1].record.source_visibility) &&
    Buffer.from(neighbour.image.data).equals(Buffer.from(before.images[1].image.data)),
    `body ${json(body.record.source_visibility)}, retained ${json(neighbour.record.source_visibility)}`,
    'The 12 by 8 donor region lies outside the full record. The retained neighbour preserves the pre-take pixels and their measurements.');
}
