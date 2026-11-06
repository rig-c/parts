import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import refusalList from '../fixtures/painting_edge_refusals.json';
import followupList from '../fixtures/painting_edge_followup1141.json';
import clampList from '../fixtures/painting_edge_clamp1038.json';
import { paintingOwnerFixture } from '../fixtures/painting_owner.ts';
import { assemble, type AssembleResult } from '../src/assemble.ts';
import { paintingEdges } from '../src/paintingedges.ts';
import { foreignPaintingReceiver, paintingReceiverAt, paintingReceivers, rawPaintingOwner } from '../src/paintingowner.ts';
import { newMask, newRaster } from '../src/raster/types.ts';

type Say = (name: string, pass: boolean, detail: string) => void;

/** The lists are independent, shrinking coordinate budgets (#1038, #1141). */
export function paintingEdgeExceptionHits(example: string, pixels: readonly number[]): { a: number; b: number; other: number } {
  const a = new Set(Object.entries(refusalList).find(([key]) => key === example)?.[1].map(q => q.y * 832 + q.x) ?? []);
  const b = new Set(Object.entries(followupList).find(([key]) => key === example)?.[1].map(q => q.y * 832 + q.x) ?? []);
  const hits = { a: 0, b: 0, other: 0 };
  for (const pixel of new Set(pixels)) {
    if (a.has(pixel)) hits.a++;
    else if (b.has(pixel)) hits.b++;
    else hits.other++;
  }
  return hits;
}

function rgba(output: AssembleResult, name: string, x: number, y: number): number[] {
  const part = output.images.find(q => q.record.name === name)!;
  const local = ((y - part.record.y) * part.record.w + x - part.record.x) * 4;
  return Array.from(part.image.data.subarray(local, local + 4));
}

export function runPaintingOwnerChecks(say: Say): void {
  const art = newRaster(1, 1); art.data.set([1, 2, 3, 255]);
  const empty = newRaster(1, 1);
  const owner = rawPaintingOwner([{ name: 'a', raster: art }, { name: 'b', raster: empty }], 1);
  const part = (name: string) => ({ name, image: art, region: null });
  const direct = paintingReceivers(owner, [part('a')], []);
  const cut = paintingReceivers(owner, [part('child')], [['a', 'child']]);
  say('ED1038_IDENTITY_AND_DECLARED_DESCENDANT', paintingReceiverAt(direct, 0).target === 0 &&
    paintingReceiverAt(cut, 0).target === 0 && !foreignPaintingReceiver(cut, 0, 0), 'identity and explicit lineage carry the declared owner');
  const overlap = paintingReceivers(owner, [part('left'), part('right')], [['a', 'left'], ['a', 'right']]);
  const missing = paintingReceivers(owner, [part('unknown')], []);
  const multi = paintingReceivers(owner, [part('child')], [['a', 'child'], ['b', 'child']]);
  const cycle = paintingReceivers(owner, [part('child')], [['a', 'child'], ['child', 'a']]);
  say('ED1038_PLANTED_LINEAGE_REFUSALS', paintingReceiverAt(overlap, 0).reason === 'multiple-receivers' &&
    missing.faults[0].reason === 'missing-lineage' && multi.faults[0].reason === 'multiple-ancestors' &&
    cycle.faults[0].reason === 'cycle' && foreignPaintingReceiver(overlap, 0, 0) && foreignPaintingReceiver(missing, 0, 0),
    'overlap, undeclared output, multiple ancestors and cycle refuse known-owner copies');
  const region = newMask(1, 1);
  const unsupported = paintingReceivers(owner, [{ name: 'a', image: art, region }], []);
  const absent = paintingReceivers(owner, [{ name: 'a', image: empty, region: null }], []);
  say('ED1038_PLANTED_SUPPORT_AND_REGION_REFUSALS', paintingReceiverAt(unsupported, 0).reason === 'no-supported-receiver' &&
    paintingReceiverAt(absent, 0).reason === 'no-supported-receiver', 'positive frozen support and declared region are both required');
  say('ED1038_PLANTED_OWNER_REFUSALS', paintingReceiverAt({ ...direct, pixels: new Int32Array([-1]) }, 0).reason === 'no-owner' &&
    paintingReceiverAt({ ...direct, pixels: new Int32Array([-2]) }, 0).reason === 'mixed-owner' &&
    paintingReceiverAt({ ...direct, roots: new Int32Array([-1]) }, 0).reason === 'receiver-owner-mismatch', 'absent/mixed owner and wrong root refuse by name');
  const sizeA = Object.values(refusalList).reduce((n, rows) => n + rows.length, 0);
  const sizeB = Object.values(followupList).reduce((n, rows) => n + rows.length, 0);
  const valid = Object.keys(refusalList).every(key => {
    const a = Object.entries(refusalList).find(([name]) => key === name)![1];
    const b = Object.entries(followupList).find(([name]) => key === name)![1];
    const hits = paintingEdgeExceptionHits(key, [...a, ...b].map(q => q.y * 832 + q.x));
    return hits.a === a.length && hits.b === b.length && hits.other === 0 &&
      [...a, ...b].every(q => Number.isInteger(q.x) && Number.isInteger(q.y) && q.x >= 0 && q.x < 832 && q.y >= 0 && q.y < 1216);
  });
  say('ED1038_SEPARATE_FROZEN_COORDINATE_LISTS', sizeA === 151 && sizeB === 34 && valid &&
    followupList.wind.filter(q => q.cause === 'cause unclosed').length === 1, `A ${sizeA}, B ${sizeB}, separate coordinate budgets and cause-unclosed tag`);
  say('ED1038_PLANTED_UNLISTED_COORDINATE', paintingEdgeExceptionHits('demo', [0]).other === 1 &&
    paintingEdgeExceptionHits('unknown', [0]).other === 1, 'a new coordinate or unknown example has no exception');

  // The added raw-name clamps are frozen main writes on owned descendants.
  const validClampList = (rows: ReadonlyArray<{ x: number; y: number }>): boolean => rows.length === 34 &&
    new Set(rows.map(q => q.y * 832 + q.x)).size === rows.length &&
    rows.every(q => Number.isInteger(q.x) && Number.isInteger(q.y) && q.x >= 0 && q.x < 832 && q.y >= 0 && q.y < 1216);
  say('ED1038_FROZEN_LEGACY_DESCENDANT_CLAMP_LIST', validClampList(clampList.wind) &&
    !validClampList(clampList.wind.slice(1)) &&
    !validClampList([...clampList.wind.slice(0, -1), clampList.wind[0]]) &&
    !validClampList([...clampList.wind.slice(0, -1), { x: -1, y: 0 }]),
    `wind legacy descendant clamps ${clampList.wind.length}; planted count, duplicate and bounds failures`);

  // A declared cut keeps its raw ancestor even where its region refuses a
  // receiver. Its surviving legacy FRONT write remains clean by lineage.
  {
    const width = 24, height = 9;
    const painting = newRaster(width, height), back = newRaster(width, height), front = newRaster(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      painting.data.set(x < 10 ? [200, 0, 0, 255] : [0, 0, 200, 255], offset);
      back.data.set([0, 0, 200, 255], offset);
      const alpha = x <= 7 ? 255 : x === 8 ? 200 : x === 9 ? 140 : x === 10 ? 100 : x === 11 ? 50 : 0;
      front.data.set([200, 0, 0, alpha], offset);
    }
    const pixel = 4 * width + 9;
    const region = newMask(width, height); region.data.fill(1); region.data[pixel] = 0;
    const clone = () => [back, front].map(r => ({ ...r, data: new Uint8ClampedArray(r.data) }));
    const legacy = clone(), fixed = clone();
    const supplied = rawPaintingOwner([{ name: 'back', raster: back }, { name: 'source-front', raster: front }], width * height);
    const contract = paintingReceivers(supplied,
      [{ name: 'back', image: back, region: null }, { name: 'cut-front', image: front, region }], [['source-front', 'cut-front']]);
    const settings = { painted: new Uint8Array(width * height).fill(1), editable: [true, true] };
    paintingEdges(legacy, painting, settings);
    const result = paintingEdges(fixed, painting, { ...settings, owner: contract });
    const offset = pixel * 4;
    const expected = legacy[1].data.subarray(offset, offset + 4);
    const oldPredicate = contract.names[contract.pixels[pixel]] !== contract.receiverNames[1];
    say('ED1038_CUT_DESCENDANT_CLEAN_REFUSAL_FRONT_SURVIVES',
      paintingReceiverAt(contract, pixel).reason === 'no-supported-receiver' && contract.roots[1] === contract.pixels[pixel] &&
      oldPredicate && expected[3] === 255 && front.data[offset + 3] === 140 &&
      expected.every((v, c) => v === fixed[1].data[offset + c]) && (result.allocation?.refused['no-supported-receiver'] ?? 0) > 0,
      `legacy/fixed/pre alpha ${expected[3]}/${fixed[1].data[offset + 3]}/${front.data[offset + 3]}, old name predicate ${oldPredicate}`);
  }

  const directory = mkdtempSync(join(tmpdir(), 'painting-owner-'));
  try {
    const input = paintingOwnerFixture(join(directory, 'strip'));
    const output = assemble(input);
    const again = assemble(input);
    const composite = Array.from(output.recomposite.data.subarray(3808 * 4, 3808 * 4 + 4));
    say('ED1038_PRODUCTION_STRIP_RECONSTRUCTS_WITH_HELD_CLEAR', composite.join() === '26,46,66,255' &&
      output.parts.recomposite!.error_px === 0 && output.paintingEdges?.allocation?.supplier === owner.supplier,
      `composite ${composite}, >40 errors ${output.parts.recomposite!.error_px}`);
    say('ED1038_PRODUCTION_IS_DETERMINISTIC_AND_INPUT_READ_ONLY', JSON.stringify(output.parts) === JSON.stringify(again.parts) &&
      output.recomposite.data.every((v, i) => v === again.recomposite.data[i]) && input.full.layers[1].pixels.data[(8 * 64 + 32) * 4 + 3] === 5,
      'repeat output agrees and the soft source rim retains its alpha');
    // A direct legacy call is the planted foreign write on the same strip.
    const back = { ...input.full.layers[0].pixels, data: new Uint8ClampedArray(input.full.layers[0].pixels.data) };
    const front = { ...input.full.layers[1].pixels, data: new Uint8ClampedArray(input.full.layers[1].pixels.data) };
    const old = [back, front];
    const owned = old.map(r => ({ ...r, data: new Uint8ClampedArray(r.data) }));
    const contract = paintingReceivers(rawPaintingOwner(old.map((raster, i) => ({ name: i === 0 ? 'behind' : 'front', raster })), 4096),
      owned.map((image, i) => ({ name: i === 0 ? 'behind' : 'front', image, region: null })), []);
    const options = { painted: new Uint8Array(4096).fill(1), editable: [true, true] };
    paintingEdges(old, input.source, options);
    const ownedResult = paintingEdges(owned, input.source, { ...options, owner: contract });
    const p = 8 * 64 + 32;
    say('ED1038_PLANTED_FOREIGN_FRONT_AND_OWNER_ALLOCATION', old[1].data[p * 4 + 3] > 0 && owned[1].data[p * 4 + 3] === 0 &&
      [0, 1, 2].every(c => owned[0].data[p * 4 + c] === input.source.data[p * 4 + c]), 'legacy foreign FRONT write fires, owner-aware BEHIND keeps its own painting pixel');
    const transfers = ownedResult.allocation?.coverageTransfers ?? [];
    const transferred = transfers.flatMap(row => row.pixels.spans.flatMap(([y, left, right]) =>
      Array.from({ length: right - left }, (_, x) => y * 64 + left + x)));
    const expected = Array.from({ length: 4096 }, (_, pixel) => pixel).filter(pixel =>
      old[1].data[pixel * 4 + 3] > 0 && owned[1].data[pixel * 4 + 3] === 0 && owned[0].data[pixel * 4 + 3] > 0);
    say('ED1146_ACCEPTED_BEHIND_TRANSFER_NAMES_EXACT_MEMBERSHIP',
      transferred.includes(p) && transfers.every(row => row.front === 'front' && row.receiver === 'behind' && row.owner === 'behind') &&
      JSON.stringify([...transferred].sort((a, b) => a - b)) === JSON.stringify(expected) &&
      transfers.reduce((n, row) => n + row.pixels.count, 0) === transferred.length,
      `legacy FRONT positive -> applied clear, BEHIND covered: ${transferred.length} pixels; witness ${p}`);
    const legacyResult = paintingEdges(old.map(r => ({ ...r, data: new Uint8ClampedArray(r.data) })), input.source, options);
    say('ED1146_OMITTED_OWNER_HAS_NO_TRANSFER_REPORT', legacyResult.allocation === undefined,
      'a legacy call supplies no owner transfer reading');
    // The raw owner can cover a pixel whose assembled receiver has only soft
    // support. An opaque receive there must still pass piece preservation.
    const heldParts = input.full.layers.map(q => ({ ...q.pixels, data: new Uint8ClampedArray(q.pixels.data) }));
    const heldRaw = input.full.layers.map(q => ({ ...q.pixels, data: new Uint8ClampedArray(q.pixels.data) }));
    const heldPixel = 8 * 64 + 34;
    heldRaw[1].data[heldPixel * 4 + 3] = 255;
    const heldContract = paintingReceivers(rawPaintingOwner(heldRaw.map((raster, i) => ({ name: i === 0 ? 'behind' : 'front', raster })), 4096),
      heldParts.map((image, i) => ({ name: i === 0 ? 'behind' : 'front', image, region: null })), []);
    const heldResult = paintingEdges(heldParts, input.source, { ...options, owner: heldContract });
    say('ED1038_PLANTED_OWNER_ZERO_RECEIVE_ISLAND_IS_HELD', heldParts[1].data[heldPixel * 4 + 3] === 5 &&
      (heldResult.allocation?.refused['front-owner-zero-coverage-held'] ?? 0) > 0,
      `held alpha ${heldParts[1].data[heldPixel * 4 + 3]}, refusal ${heldResult.allocation?.refused['front-owner-zero-coverage-held'] ?? 0}`);
    say('ED1146_HELD_ALLOCATION_IS_ABSENT_FROM_TRANSFERS',
      (heldResult.allocation?.coverageTransfers ?? []).every(row => row.pixels.spans.every(([y, left, right]) =>
        y !== 8 || heldPixel % 64 < left || heldPixel % 64 >= right)),
      'the held owner-zero receive is absent from accepted transfer membership');
    const kept = input.full.layers.map(q => ({ ...q.pixels, data: new Uint8ClampedArray(q.pixels.data) }));
    const keep = newMask(64, 64); keep.data[p] = 1;
    const keptResult = paintingEdges(kept, input.source, { ...options, owner: contract, keep: [null, keep] });
    say('ED1146_PROTECTED_FRONT_CLEAR_IS_ABSENT_FROM_TRANSFERS',
      kept[1].data[p * 4 + 3] === 5 &&
      (keptResult.allocation?.coverageTransfers ?? []).every(row => row.pixels.spans.every(([y, left, right]) =>
        y !== 8 || p % 64 < left || p % 64 >= right)),
      'a protected FRONT keeps its original coverage and has no accepted transfer row');
    const zero = assemble(paintingOwnerFixture(join(directory, 'zero'), true));
    let received = 0;
    for (let y = 4; y < 60; y++) if (rgba(zero, 'front', 31, y).join() === '120,130,140,255') received++;
    say('ED1038_PRODUCTION_OWNER_ZERO_RECEIVES_OPAQUE_PAINT', received === 56 && zero.parts.recomposite!.error_px === 0,
      `own-P receives ${received}/56, >40 errors ${zero.parts.recomposite!.error_px}`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
