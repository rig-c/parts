/** Generated production controls for layer-record transport through assembly (#1471). */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleConfig } from '../fixtures/assemble_fixture.ts';
import { writeFrontSlotFixture } from '../fixtures/front_slot.ts';
import { writeTakeRegionFixture } from '../fixtures/take_region.ts';
import { assembleStage, type AssembleStageInput } from '../src/build.ts';
import { PartsError } from '../src/errors.ts';
import { PartVisibility } from '../src/partvisibility.ts';
import { readParts, VISIBILITY_KEYS } from '../src/parts.ts';
import { checkPartsStage } from '../src/partscheck.ts';
import { encodePngBytes, readPng } from '../src/raster/png.ts';
import type { Raster } from '../src/raster/types.ts';
import { VISIBILITY_STATE, writeVisibilityRecord } from '../src/visibility.ts';
import { readSourceStateMap } from '../src/sourcestates.ts';
import { observeVisibilityCoverage, type CoverageRow } from './read_visibility_coverage.ts';

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

export function runVisibilityCoverageCheck(say: Say): void {
  const strip = (...alpha: number[]): Raster => ({ width: alpha.length, height: 1,
    data: Uint8ClampedArray.from(alpha.flatMap(a => [30, 40, 50, a])) });
  const run = () => {
    const live = new PartVisibility();
    const full = strip(8, 10, 255), head = strip(64, 128), warp = strip(9, 132), missing = strip(0, 255);
    live.layer(full, 'full:topwear', Uint8Array.of(0, 0, VISIBILITY_STATE.visible));
    live.layer(head, 'head:face');
    live.warp(full, warp, { sx: 1, sy: 1, tx: -0.5, ty: 0 }, 'bilinear');
    const image = strip(255, 10, 9, 132, 128, 255, 255, 64, 255);
    live.copy(image, 0, full, 2);
    live.copy(image, 1, full, 1);
    live.rows(image, warp, 0, 0, 2, 1, 2);
    live.painting(image, 2, 'rgb', true);
    live.copy(image, 4, head, 1);
    live.painting(image, 4, 'rgb');
    live.copy(image, 5, head, 0);
    live.painting(image, 5, 'both');
    live.copy(image, 6, missing, 1);
    live.painting(image, 6, 'rgb', true);
    live.painting(missing, 0, 'rgb'); // The live ID remains zero on this untracked raster.
    const underfill = strip(64);
    live.underfill(underfill, 0, head, missing, 64, 0);
    live.copy(image, 7, underfill, 0);
    const unmasked = strip(255);
    live.layer(unmasked, 'full:hidden');
    live.copy(image, 8, unmasked, 0);
    const parts = [{ name: 'body', x: 0, y: 0, image }, { name: 'patch', x: 9, y: 0, image: strip(255) }];
    return { state: [...live.states(image).codes], summary: live.summarize(image), overlaps: live.overlaps(parts) };
  };
  const baseline = run();
  let observed: CoverageRow[] = [];
  const restore = observeVisibilityCoverage(new Set(['patch']), rows => { observed = rows; });
  let instrumented: ReturnType<typeof run>;
  try { instrumented = run(); } finally { restore(); }
  const [body, patch] = observed;
  const counts = (row: CoverageRow) => Object.fromEntries(row.combinations.map(({ causes, px }) => [causes.join('+'), px]));
  say('AS1480_COVERAGE_SEPARATES_SINGLE_AND_JOINT_CAUSES', same(instrumented, baseline) && body?.unrecorded_px === 8 &&
    body.opaque_px === 9 && body.recorded_and_unrecorded_px === 1 && body.residual_px === 1 && same(body.first_residual_rig_xy, [6, 0]) &&
    same(counts(body), { full_alpha_9_127: 2, 'full_alpha_1_8+full_alpha_9_127+painting_rgb': 1,
      'head_alpha_128_255+painting_rgb': 1, painting_rgba: 1, 'painting_rgb+residual': 1, head_alpha_9_127: 1, full_without_mask: 1 }) &&
    body.painting_touched_px === 4 && body.clearable_upper_bound_px.painting === 1 && body.clearable_upper_bound_px.full_floor_9 === 2 &&
    patch?.unrecorded_px === 1 && same(counts(patch), { painting_rgba: 1 }),
    json({ state: instrumented.state, coverage: observed.map(row => [row.part, counts(row)]) }),
    'Hand-counts recorded, faint and mixed-support samples, both painting modes, and a planted residual without changing live state or layer IDs.');
}

export function runPartVisibilityChecks(dir: string, say: Say): void {
  runVisibilityCoverageCheck(say);
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
  const primaryManifest = join(exact.full, 'visibility.json');
  const withheldPrimaryManifest = join(dir, 'withheld-visibility.json');
  renameSync(primaryManifest, withheldPrimaryManifest);
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
  renameSync(withheldPrimaryManifest, primaryManifest);
  const primaryOnlyOut = join(dir, 'recorded-primary');
  exact.run(primaryOnlyOut, exact.full, alts);
  renameSync(primaryManifest, withheldPrimaryManifest);
  const primaryOnly = checkPartsStage(primaryOnlyOut, join(dir, 'primary-only-check'), () => {});
  const primaryRows = primaryOnly.reported.filter(row => row.code === 'PARTS_INVENTED_MATERIAL');
  const primaryHoles = primaryOnly.holes.filter(row => row.code === 'PARTS_INVENTED_MATERIAL');
  say('AS1471_RECORDED_PRIMARY_REPORTS_UNMEASURED_ALTERNATE', primaryOnly.exit_code === 0 &&
    same(primaryRows.map(row => [row.set, row.part]), [[null, 'back'], [null, 'front']]) &&
    primaryRows[0]?.occluded_px === 64 && same(primaryHoles.map(row => row.reason), [
      '2 parts lack validated source_visibility: part "back" in alternate set "alt", part "front" in alternate set "alt"',
    ]), json({ reported: primaryRows, holes: primaryHoles }),
    'Preserve both primary measurements and identify every alternate part that lacks a measurement.');

  record(alternate.full);
  const alternateOut = join(dir, 'recorded-alternate');
  exact.run(alternateOut, exact.full, alts);
  const alternateParts = readParts(join(alternateOut, 'parts.json'));
  const altBack = alternateParts.alternates?.[0]?.records[0];
  const altCheck = checkPartsStage(alternateOut, join(dir, 'alternate-check'), () => {});
  say('AS1471_ALTERNATE_HAS_OWN_RECORD_AND_LEGACY_COUNTS', same(altBack?.source_visibility, expected) &&
    VISIBILITY_KEYS.every(key => altBack?.[key] === legacy?.[key]) &&
    alternateParts.parts.every(part => part.source_visibility === undefined) &&
    altCheck.reported.some(row => row.code === 'PARTS_INVENTED_MATERIAL' && row.set === 'alt' && row.part === 'back') &&
    same(altCheck.holes.filter(row => row.code === 'PARTS_INVENTED_MATERIAL').map(row => row.reason), [
      '2 parts lack validated source_visibility: part "back" in primary set, part "front" in primary set',
    ]),
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

  // Issue #1473: every recorded part's state map is written beside it, bound by SHA-256, its counts the record's own.
  const mapped = readParts(partsPath);
  const mapRead = mapped.parts.map(p => { try { return readSourceStateMap(join(output, 'parts'), p, readPng(join(output, 'parts', `${p.name}.png`))).length; } catch (e) { return e instanceof PartsError ? e.problems.map(q => q.code).join(',') : String(e); } });
  const altRecord = readParts(join(alternateOut, 'parts.json')).alternates?.[0]?.records[0];
  const altMap = altRecord?.source_state_map;
  say('AS1473_RECORDED_PARTS_CARRY_A_STATE_MAP_THAT_MATCHES_THEIR_COUNTS', mapped.parts.every(p => p.source_state_map?.image === `${p.name}_source_states.png`) &&
    mapRead.every(n => typeof n === 'number') &&
    readParts(join(noRecordOut, 'parts.json')).parts.every(p => p.source_state_map === undefined) && !existsSync(join(noRecordOut, 'parts', 'back_source_states.png')) &&
    altMap !== undefined && existsSync(join(alternateOut, 'parts', altMap.image)) && sha(readFileSync(join(alternateOut, 'parts', altMap.image))) === altMap.sha256,
    json({ primary: mapRead, alternate: altMap?.image ?? null }),
    'Each map is read back through the check-side reader: present, hashed as declared, and counted to the record. A part with no record writes no map.');
}

/** Issue #1474: pixels where the record shows the part drawn behind and hides the part drawn in front. */
export function runSourceOverlapChecks(dir: string, say: Say): void {
  const face: Layer = { tag: 'face', left: 16, top: 16, width: 32, height: 32, order: 0.5, art: () => [40, 0, 0, 255], depth: gray(20) };
  // The back layer is 16x16 at (16, 16); the front 8x16 at (24, 16) covers its right half: 8 columns by 16 rows.
  // Row 3 is a thin stroke nearer than the front, crossing the front's left edge; row 6 ties the front's depth;
  // row 9 is the front at alpha 200 on top (partial-top); row 12 is the back below the record's alpha floor.
  const strokeRow = 3, tieRow = 6, partialRow = 9, faintRow = 12;
  const back = (stroke: boolean): Layer => ({ tag: 'back hair', left: 16, top: 16, width: 16, height: 16, order: 0.8,
    art: (_x, y) => [90, 110, 160, y === faintRow ? 127 : 255],
    depth: (_x, y) => gray(stroke && y === strokeRow ? 5 : y === tieRow ? 20 : 30)(0, 0) });
  const front: Layer = { tag: 'topwear', left: 24, top: 16, width: 8, height: 16, order: 0.2,
    art: (_x, y) => [140, 30, 40, y === partialRow ? 200 : 255], depth: gray(20) };
  const plan = [['back', 'full', back(true).tag], ['front', 'full', front.tag]];
  const planted = fixture(join(dir, 'stroke'), plan, [back(true), front], [face]);
  const manifest = record(planted.full);
  const output = join(dir, 'stroke-parts'), partsPath = join(output, 'parts.json');
  planted.run(output);
  const [rear, ahead] = readParts(partsPath).parts;
  const undecided = { 'partial-top': 8, 'depth-tie': 8, 'mixed-source-states': 0 };
  const expected = [{ front: 'front', source_layers: ['full:back hair', 'full:topwear'], overlap_px: 128, inverted_px: 8,
    agreeing_px: 96, unordered_px: 0, undecided_px: undecided, unrecorded_px: 8 }];
  say('AS1474_PLANTED_STROKE_INVERSION_NAMES_BOTH_PARTS', same(rear.source_overlaps, expected) && same(ahead.source_overlaps, []) &&
    rear.opaque_px === 256 && ahead.opaque_px === 128,
    json({ back: rear.source_overlaps, front: ahead.source_overlaps }),
    'The 8 overlap pixels of the stroke row are inverted. The tie row and the partial-top row are 8 each, counted apart. The faint row is unrecorded, and the other 12 rows (96 px) agree with the draw order.');
  const lines: string[] = [];
  const checked = checkPartsStage(output, join(dir, 'stroke-check'), line => lines.push(line));
  const rows = checked.reported.filter(row => row.code === 'PARTS_DRAW_ORDER_INVERTED');
  say('AS1474_CHECK_PARTS_REPORTS_INVERSION', checked.exit_code === 0 && same(rows, [{ code: 'PARTS_DRAW_ORDER_INVERTED', set: null, part: 'back', ...expected[0] }]) &&
    lines.includes('PARTS_DRAW_ORDER_INVERTED: REPORTED part "back" behind part "front" — inverted 8 of 128 overlapping px (full:back hair, full:topwear); ' +
      'agreeing 96, unordered 0, undecided (partial-top 8, depth-tie 8, mixed-source-states 0), unrecorded 8'),
    json(rows), 'The pair is a measurement row with its line, not a pass.');

  const agrees = fixture(join(dir, 'agrees'), plan, [back(false), front], [face]);
  record(agrees.full);
  const agreed = agrees.run(join(dir, 'agrees-parts')).parts.parts[0].source_overlaps;
  say('AS1474_AGREEING_OVERLAP_READS_ZERO', same(agreed, [{ ...expected[0], source_layers: [], inverted_px: 0, agreeing_px: 104 }]),
    json(agreed), 'Without the stroke, the stroke row agrees with the draw order too: 104 agreeing, 0 inverted, no layers.');

  const scaledOverlap = (scale: number, stroke: boolean) => {
    const label = `scale-${scale}-${stroke ? 'stroke' : 'agree'}`;
    const scaled = fixture(join(dir, label), plan, [back(stroke), front], [face], scale);
    record(scaled.full);
    const out = join(dir, `${label}-parts`);
    scaled.run(out);
    return { out, path: join(out, 'parts.json'), parts: readParts(join(out, 'parts.json')) };
  };
  const half = scaledOverlap(0.5, true);
  const doubleScale = scaledOverlap(2, true);
  const halfRow = half.parts.parts[0].source_overlaps![0];
  const twiceRow = doubleScale.parts.parts[0].source_overlaps![0];
  say('AS1477_NATIVE_STROKE_SURVIVES_THE_OUTPUT_SAMPLE_GRID', halfRow.inverted_px === 0 && twiceRow.inverted_px === 17 &&
    same(halfRow.native_samples, { overlap_px: 128, inverted_px: 8 }) && same(twiceRow.native_samples, halfRow.native_samples),
    json({ half: halfRow, twice: twiceRow }),
    'The eight native stroke samples fall on an odd source row skipped at half scale. Their registered cells still overlap at both scales.');

  const halfAgree = scaledOverlap(0.5, false).parts.parts[0].source_overlaps![0];
  const nativeLines: string[] = [];
  const nativeReport = checkPartsStage(half.out, join(dir, 'native-stroke-check'), line => nativeLines.push(line));
  const nativeRow = nativeReport.reported.find(row => row.code === 'PARTS_DRAW_ORDER_INVERTED');
  say('AS1477_WITNESSES_REPORT_AND_KEEP_THE_AGREEING_CONTROL', same(halfAgree.native_samples, { overlap_px: 128, inverted_px: 0 }) &&
    nativeReport.exit_code === 0 && nativeRow?.code === 'PARTS_DRAW_ORDER_INVERTED' && same(nativeRow.native_samples, halfRow.native_samples) &&
    nativeLines.some(line => line.endsWith('native sample witnesses 8 of 128 attributable overlapping px')),
    json({ agrees: halfAgree, report: nativeRow }), 'The native counts round trip independently of the output-pixel partition.');

  const invalidNative = readParts(half.path);
  const invalidRow = invalidNative.parts[0].source_overlaps![0];
  invalidRow.native_samples = { overlap_px: 7, inverted_px: 8 };
  const badNativeCount = plant(half.path, json(invalidNative), () => readParts(half.path));
  invalidRow.native_samples = { overlap_px: 8, inverted_px: -1 };
  const badNativeType = plant(half.path, json(invalidNative), () => readParts(half.path));
  say('AS1477_INVALID_NATIVE_SAMPLE_COUNTS_ARE_REFUSED', badNativeCount === 'PARTS_COUNTS_ADD_UP' && badNativeType === 'PARTS_FIELD_TYPE',
    `inverted exceeds overlap: ${badNativeCount}; negative inversion: ${badNativeType}`,
    'Both native counts must be safe nonnegative integers, and inversions must fit in their native overlap.');

  const rejectOut = join(dir, 'refused');
  const maskPath = join(planted.full, manifest.layers.find(layer => layer.tag === front.tag)!.record.path);
  const tampered = readFileSync(maskPath);
  tampered[strokeRow * front.width] = 1;
  const badRecord = plant(maskPath, tampered, () => planted.run(rejectOut));
  const badParts = readParts(partsPath);
  badParts.parts[0].source_overlaps![0].inverted_px++;
  const miscount = plant(partsPath, json(badParts), () => readParts(partsPath));
  badParts.parts[0].source_overlaps![0].inverted_px--;
  badParts.parts[0].source_overlaps![0].front = 'back';
  const backwards = plant(partsPath, json(badParts), () => readParts(partsPath));
  say('AS1474_TAMPERED_RECORD_OR_ROW_REFUSED', badRecord === 'VISIBILITY_HASH' && !existsSync(rejectOut) &&
    miscount === 'PARTS_COUNTS_ADD_UP' && backwards === 'PARTS_FIELD_TYPE',
    `front state byte ${badRecord}, inverted count raised ${miscount}, front naming the carrying part ${backwards}`,
    'A changed state byte is refused before emission; a row whose classes do not sum, or whose front is not drawn later, is refused on read.');

  const noRecordOut = join(dir, 'no-record-parts');
  renameSync(join(planted.full, 'visibility.json'), join(dir, 'withheld-visibility.json'));
  planted.run(noRecordOut);
  const legacy = readParts(join(noRecordOut, 'parts.json'));
  const noLines: string[] = [];
  const noRecord = checkPartsStage(noRecordOut, join(dir, 'no-record-check'), line => noLines.push(line));
  say('AS1474_NO_RECORD_WRITES_NO_OVERLAPS', legacy.parts.every(p => p.source_overlaps === undefined) &&
    !readFileSync(join(noRecordOut, 'parts.json'), 'utf8').includes('source_overlaps') &&
    !noRecord.reported.some(row => row.code === 'PARTS_DRAW_ORDER_INVERTED') &&
    !noRecord.holes.some(row => row.code === 'PARTS_DRAW_ORDER_INVERTED') && !noLines.some(line => line.includes('PARTS_DRAW_ORDER_INVERTED')),
    json(noRecord.reported), 'With no record, parts.json has no overlap key and check-parts prints no row, line or HOLE for it.');

  // The #664 front-slot fixture: plan order draws the arm behind the torso, and the set "chest" draws its forearm on
  // forearm_r_front, after the face. Here the set also covers the torso, and its run is recorded with the arm layer
  // nearer than the topwear, so where the gesture forearm [8, 28) x [29, 36) crosses the torso [18, 44) x [16, 50)
  // (10 columns by 7 rows, 70 px) the forearm is visible and the torso occluded. Drawn on its front slot, that agrees.
  const slotHome = join(dir, 'front-slot');
  const slotCfg = writeFrontSlotFixture(slotHome);
  const [chest] = (slotCfg.assemble as { alternates: Array<{ parts: string[] }> }).alternates;
  chest.parts.push('torso');
  writeFileSync(join(slotHome, 'config.json'), json(slotCfg));
  const chestFull = join(slotHome, 'chest_full'), chestLayers = join(chestFull, 'layers.json');
  const chestRun = JSON.parse(readFileSync(chestLayers, 'utf8')) as {
    layers: { name: string; left: number; top: number; right: number; bottom: number; depth_filename?: string }[];
  };
  for (const layer of chestRun.layers) {
    layer.depth_filename = `${layer.name}_depth.png`;
    png(join(chestFull, 'parts', layer.depth_filename), layer.right - layer.left, layer.bottom - layer.top, gray(layer.name === 'topwear' ? 30 : 10));
  }
  writeFileSync(chestLayers, json(chestRun));
  record(chestFull);
  // A plain white set painting: projection then keeps the layer art (as in the stroke fixture) instead of painting
  // pixels from outside the record over it.
  png(join(slotHome, 'chest.png'), 128, 128, gray(255));
  const slotOut = join(slotHome, 'out');
  assembleStage({ source: join(slotHome, 'painting.png'), full: join(slotHome, 'full'), head: join(slotHome, 'head'), config: join(slotHome, 'config.json'), seam: 'near-white', project: 'core' },
    { partsJson: join(slotOut, 'parts.json'), partsDir: join(slotOut, 'parts'), recomposite: join(slotOut, 'flat.png'), errorMap: join(slotOut, 'error.png') }, () => {});
  const slotSet = readParts(join(slotOut, 'parts.json')).alternates?.find(set => set.name === 'chest');
  const pairRows = (slotSet?.records ?? []).flatMap(part => (part.source_overlaps ?? []).map(row => ({ back: part.name, ...row })))
    .filter(row => [row.back, row.front].includes('forearm_r') && [row.back, row.front].includes('torso'));
  const slotParts = join(slotOut, 'parts.json');
  const twice = readParts(slotParts);
  const twiceSet = twice.alternates!.find(set => set.name === 'chest')!;
  const torsoRow = twiceSet.records.find(part => part.name === 'torso')!.source_overlaps!.find(row => row.front === 'forearm_r')!;
  twiceSet.records.find(part => part.name === 'forearm_r')!.source_overlaps!.push({ ...torsoRow, front: 'torso' });
  const reversed = plant(slotParts, json(twice), () => readParts(slotParts));
  say('AS1474_FRONT_SLOT_PAIR_FOLLOWS_THE_SET_DRAW_ORDER', same(slotSet?.front, ['forearm_r']) && pairRows.length === 1 &&
    pairRows[0].back === 'torso' && pairRows[0].front === 'forearm_r' && pairRows[0].overlap_px === 70 &&
    pairRows[0].agreeing_px === 70 && pairRows[0].inverted_px === 0 && reversed === 'PARTS_FIELD_TYPE',
    `${json(pairRows)}; the same pair added back in the other direction: ${reversed}`,
    'The set draws the forearm on its front slot after the torso, so the 70 crossing pixels agree; in plan order they read inverted. A set reports each pair of records once.');
}
