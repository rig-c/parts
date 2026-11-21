/**
 * Issue #1383: painted-outline specks at an ownership boundary go through the
 * editor route. The edit's provenance records how many opaque pixels were
 * removed and where, and an edit whose file does not match its receipt is
 * refused. Nothing here decides which pixels are outline: the fixture's edit
 * names them by hand.
 *
 * The fixture is `writeEditorReceiptFixture` (64x64 rig, rig_scale 1) with the
 * body layer (`topwear`, rig [8, 56) x [32, 56)) carrying a dark outline along
 * its top edge, rig row 32, where it meets the face ([8, 56) x [8, 32)), and a
 * thicker stroke end on rig row 33, columns 48..55. The painting carries the same
 * outline, so the assembled body (box 8,32 48x24) holds it opaque.
 *
 * The edit removes two outline fragments, in part pixels:
 * - A: row 0, x 0..2 — 3 px, box [0, 0, 3, 1];
 * - B: row 0, x 40..41 and row 1, x 42 (rig 48, 49 on row 32 and 50 on row
 *   33) — 3 px joined diagonally, so one 8-connected region, box [40, 0, 3, 2].
 * removed_opaque_px = 6; removed_opaque_regions = [A, B] in y, x order.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { writeEditorReceiptFixture } from '../fixtures/editor_receipts.ts';
import { C, NAVY, WHITE, paint, writeRun } from '../fixtures/assemble_fixture.ts';
import { assembleStage } from '../src/build.ts';
import { PartsError } from '../src/errors.ts';
import { readParts, serializeParts } from '../src/parts.ts';
import { encodePngBytes, readPng } from '../src/raster/png.ts';
import type { Raster } from '../src/raster/types.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
type Receipt = { part: string; file: string; sha256: string; from_sha256: string; editor: string };
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const save = (file: string, value: unknown): void => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

/** Removed positions, part pixels. */
export const OUTLINE_SPECKS: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 0], [2, 0], [40, 0], [41, 0], [42, 1]];
/** The record computed by hand from OUTLINE_SPECKS (see the module comment). */
export const OUTLINE_SPECK_REGIONS = [{ box: [0, 0, 3, 1], px: 3 }, { box: [40, 0, 3, 2], px: 3 }];

function outlineFixture(dir: string): { input: { source: string; full: string; head: null }; raw: Record<string, unknown> } {
  const raw = writeEditorReceiptFixture(dir, { author: false });
  // Run pixels are rig pixels here: the top edge row 32 and the stroke end, row 33 columns 48..55.
  const outline = [{ x0: 8, y0: 32, x1: 56, y1: 33, colour: NAVY }, { x0: 48, y0: 33, x1: 56, y1: 34, colour: NAVY }];
  writeRun(join(dir, 'full'), [
    { name: 'topwear', depth: 0.7, rects: [{ x0: 8, y0: 32, x1: 56, y1: 56, colour: C }, ...outline] },
    { name: 'face', depth: 0.5, rects: [{ x0: 8, y0: 8, x1: 56, y1: 32, colour: C }] },
    { name: 'eyewhite-r', depth: 0.1, rects: [{ x0: 36, y0: 16, x1: 44, y1: 24, colour: C }] },
    { name: 'eyewhite-l', depth: 0.05, rects: [{ x0: 44, y0: 16, x1: 52, y1: 24, colour: C }] },
  ]);
  writeFileSync(join(dir, 'painting.png'), encodePngBytes(paint(64, 64, WHITE, [{ x0: 8, y0: 8, x1: 56, y1: 56, colour: C }, ...outline])));
  return { input: { source: join(dir, 'painting.png'), full: join(dir, 'full'), head: null }, raw };
}

const outputs = (out: string) => ({ partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'),
  recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, 'recomposite_error_rig.png') });
function codes(action: () => unknown): string[] {
  try { action(); return []; } catch (error) {
    if (error instanceof PartsError) return error.problems.map(p => `${p.code}: ${p.object} ${p.detail}`);
    throw error;
  }
}
function snapshot(dir: string): string {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile()).map(e => join(e.parentPath, e.name))
    .sort().map(f => `${f.slice(dir.length)} ${hash(readFileSync(f))}`).join('\n');
}

/** The outline-speck route; every expected value is computed by hand from the fixture. */
export function runOutlineSpeckChecks(dir: string, say: Say): void {
  mkdirSync(dir, { recursive: true });
  const { input, raw } = outlineFixture(join(dir, 'input'));
  const variant = (name: string, assemble: Record<string, unknown>): string => {
    const cfg = structuredClone(raw);
    Object.assign(cfg.assemble as Record<string, unknown>, { stage_map: true }, assemble);
    const file = join(dir, 'input', `${name}.json`); save(file, cfg); return file;
  };
  const stage = (config: string, out: string): string[] => codes(() => assembleStage({ ...input, config }, outputs(out), () => {}));
  const baselineConfig = variant('baseline', {});
  const baseline = join(dir, 'baseline');
  const baseCodes = stage(baselineConfig, baseline);
  const original = readPng(join(baseline, 'parts', 'body.png'));
  const at = (image: Raster, x: number, y: number): number[] => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
  const outlineHeld = OUTLINE_SPECKS.every(([x, y]) => JSON.stringify(at(original, x, y)) === JSON.stringify([...NAVY, 255]));
  say('FIXTURE_OUTLINE_IS_IN_THE_ASSEMBLED_PART', baseCodes.length === 0 && original.width === 48 && original.height === 24 && outlineHeld,
    `refusals ${baseCodes.length}; body ${original.width}x${original.height}; the six removed positions are opaque navy before the edit: ${outlineHeld}`);

  const image: Raster = { width: original.width, height: original.height, data: new Uint8ClampedArray(original.data) };
  for (const [x, y] of OUTLINE_SPECKS) image.data.set([0, 0, 0, 0], (y * image.width + x) * 4);
  const bytes = encodePngBytes(image);
  mkdirSync(join(dir, 'input', 'edits'), { recursive: true });
  writeFileSync(join(dir, 'input', 'edits', 'body.png'), bytes);
  const receipt: Receipt = { part: 'body', file: 'body.png', sha256: hash(bytes), from_sha256: hash(readFileSync(join(baseline, 'parts', 'body.png'))), editor: 'technical fixture' };
  const receipted = variant('receipted', { edited_parts: { dir: 'edits', receipts: [receipt] } });
  const first = join(dir, 'first'), second = join(dir, 'second');
  const firstCodes = stage(receipted, first), secondCodes = stage(receipted, second);
  const record = firstCodes.length === 0 ? readParts(join(first, 'parts.json')).parts.find(p => p.name === 'body')?.provenance?.edited_part : undefined;
  const mapEntry = firstCodes.length === 0
    ? (JSON.parse(readFileSync(join(first, 'stage-map.json'), 'utf8')) as { parts: Array<{ name: string; edited_part?: unknown }> }).parts.find(p => p.name === 'body')?.edited_part
    : undefined;
  say('RECEIPTED_EDIT_RECORDS_COUNT_AND_LOCATION', firstCodes.length === 0 && record?.removed_opaque_px === 6 && record.changed_px === 6 &&
    JSON.stringify(record.removed_opaque_regions) === JSON.stringify(OUTLINE_SPECK_REGIONS) &&
    JSON.stringify((mapEntry as { removed_opaque_regions?: unknown } | undefined)?.removed_opaque_regions) === JSON.stringify(OUTLINE_SPECK_REGIONS),
    `refusals ${firstCodes.length}; removed_opaque_px ${record?.removed_opaque_px} (6 required); parts.json regions ${JSON.stringify(record?.removed_opaque_regions)}; stage-map regions ${JSON.stringify((mapEntry as { removed_opaque_regions?: unknown } | undefined)?.removed_opaque_regions)}; required ${JSON.stringify(OUTLINE_SPECK_REGIONS)}`);
  const text = firstCodes.length === 0 ? readFileSync(join(first, 'parts.json'), 'utf8') : '';
  say('RECORD_KEY_ORDER_AND_READER_ROUNDTRIP', text.length > 0 && serializeParts(readParts(join(first, 'parts.json'))) === text &&
    JSON.stringify(Object.keys(record ?? {})) === JSON.stringify(['edit', 'dir', 'receipt', 'changed_px', 'changed_counted_px', 'changed_excluded_px', 'removed_opaque_px', 'removed_opaque_regions']),
    `keys ${JSON.stringify(Object.keys(record ?? {}))}; serialize(read(parts.json)) equals the written bytes`);
  say('TWO_RUNS_WRITE_THE_SAME_BYTES', secondCodes.length === 0 && firstCodes.length === 0 && snapshot(first) === snapshot(second),
    `${snapshot(first).split('\n').length} files compared by sha256 across two runs of one config`);

  // An edit that changes colour and removes nothing writes no location record.
  const recolour: Raster = { width: original.width, height: original.height, data: new Uint8ClampedArray(original.data) };
  recolour.data.set([...C, 255], 0);
  const recolourBytes = encodePngBytes(recolour);
  writeFileSync(join(dir, 'input', 'edits', 'recolour.png'), recolourBytes);
  const recolourConfig = variant('recolour', { edited_parts: { dir: 'edits', receipts: [{ ...receipt, file: 'recolour.png', sha256: hash(recolourBytes) }] } });
  const recolourOut = join(dir, 'recolour'), recolourCodes = stage(recolourConfig, recolourOut);
  const kept = recolourCodes.length === 0 ? readParts(join(recolourOut, 'parts.json')).parts.find(p => p.name === 'body')?.provenance?.edited_part : undefined;
  const recolourText = recolourCodes.length === 0 ? readFileSync(join(recolourOut, 'parts.json'), 'utf8') + readFileSync(join(recolourOut, 'stage-map.json'), 'utf8') : '';
  say('EDIT_REMOVING_NOTHING_WRITES_NO_LOCATION', recolourCodes.length === 0 && kept?.removed_opaque_px === 0 && kept.changed_px === 1 &&
    !('removed_opaque_regions' in kept) && !recolourText.includes('removed_opaque_regions'),
    `refusals ${recolourCodes.length}; removed_opaque_px ${kept?.removed_opaque_px}; changed_px ${kept?.changed_px}; field absent from parts.json and stage-map.json`);

  // The same edit without a matching receipt: the file is never applied.
  const stale = { ...receipt, sha256: receipt.from_sha256 };
  for (const required of [false, true]) {
    const ledger = required ? { editor_receipts: { required: true, receipts: [] } } : {};
    const staleOut = join(dir, `stale-${required}`);
    const staleCodes = stage(variant(`stale-${required}`, { ...ledger, edited_parts: { dir: 'edits', receipts: [stale] } }), staleOut);
    say(`UNRECEIPTED_REMOVAL_REFUSED_REQUIRED_${required ? 'TRUE' : 'ABSENT'}`, staleCodes.length === 1 && staleCodes[0].startsWith('ASSEMBLE_EDITED_PART_SHA256: ') &&
      staleCodes[0].includes(`file sha256 is ${receipt.sha256}; receipt sha256 ${stale.sha256} is required`) && !existsSync(join(staleOut, 'parts.json')),
      `${staleCodes.join(' | ') || 'no refusal'}; outputs written: ${existsSync(join(staleOut, 'parts.json'))}`);
    const noRowOut = join(dir, `no-row-${required}`);
    const noRowCodes = stage(variant(`no-row-${required}`, { ...ledger, edited_parts: { dir: 'edits', receipts: [] } }), noRowOut);
    const body = noRowCodes.length === 0 ? readParts(join(noRowOut, 'parts.json')).parts.find(p => p.name === 'body') : undefined;
    say(`EDIT_WITHOUT_A_RECEIPT_ROW_IS_NOT_APPLIED_REQUIRED_${required ? 'TRUE' : 'ABSENT'}`, noRowCodes.length === 0 && body?.provenance?.edited_part === undefined &&
      hash(readFileSync(join(noRowOut, 'parts', 'body.png'))) === receipt.from_sha256,
      `refusals ${noRowCodes.length}; body.png is the unedited assembled bytes; no edited_part record`);
  }

  // The reader holds the location record to its count, box and order.
  const plantReader = (name: string, mutate: (regions: Array<{ box: number[]; px: number }>) => unknown, expected: string): void => {
    const file = JSON.parse(text) as { parts: Array<{ name: string; provenance: { edited_part: { removed_opaque_regions: unknown } } }> };
    const entry = file.parts.find(p => p.name === 'body')!.provenance.edited_part;
    entry.removed_opaque_regions = mutate(structuredClone(OUTLINE_SPECK_REGIONS));
    const planted = join(dir, `reader-${name}`); mkdirSync(planted, { recursive: true });
    writeFileSync(join(planted, 'parts.json'), JSON.stringify(file));
    const found = codes(() => readParts(join(planted, 'parts.json')));
    say(`READER_REFUSES_${name}`, found.length === 1 && found[0].includes(expected), found.join(' | ') || 'no refusal');
  };
  plantReader('PX_SUM', r => { r[1].px = 2; return r; }, 'PARTS_COUNTS_ADD_UP: part "body" provenance edited_part.removed_opaque_regions px sum to 5; removed_opaque_px 6 is required');
  plantReader('BOX_OUTSIDE_PART', r => { r[1].box = [46, 0, 3, 2]; return r; }, 'PARTS_COUNTS_ADD_UP: part "body" provenance edited_part.removed_opaque_regions[1] is box [46, 0, 3, 2] px 3; a box of at least 1x1 inside the part\'s 48x24 pixels and px from 1 to its area 6 is required');
  plantReader('ORDER', r => [r[1], r[0]], 'PARTS_FIELD_TYPE: part "body" provenance edited_part.removed_opaque_regions[1] box [0, 0, 3, 1] follows box [40, 0, 3, 2]; the order y, x, h, w, px is required');
  plantReader('SHAPE', () => [], 'PARTS_FIELD_TYPE: part "body" provenance edited_part.removed_opaque_regions is []; a non-empty list of {box: [x, y, w, h], px} with safe integers is required');
}
