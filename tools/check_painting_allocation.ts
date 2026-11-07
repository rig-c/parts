import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleConfig, writeRun } from '../fixtures/assemble_fixture.ts';
import { paintingGuardFixture } from '../fixtures/painting_guard.ts';
import { paintingOwnerFixture } from '../fixtures/painting_owner.ts';
import { assembleStage } from '../src/build.ts';
import { readLayers } from '../src/layers.ts';
import { PartsError } from '../src/errors.ts';
import { paintingEdges } from '../src/paintingedges.ts';
import { serializeParts } from '../src/parts.ts';
import { newMask, newRaster } from '../src/raster/types.ts';
import { readPng, writePng } from '../src/raster/png.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
interface Event { p: number; status: string; reason: string }
interface Transfer { front: string; receiver: string; owner: string; pixels: { count: number; spans: Array<[number, number, number]> } }
interface Report {
  set: string;
  grid: number[];
  source: { painting_sha256: string };
  stage: string;
  membership: string;
  output_assets: Array<{ part: string; image: string | null }>;
  inherited_parts: string[];
  hidden_parts: string[];
  coverageTransfers: Transfer[];
}

export function runPaintingGuardChecks(say: Say): void {
  for (const mode of ['bridge', 'island'] as const) {
    const fixture = paintingGuardFixture(mode);
    const { source, parts, owner, pixel, ground } = fixture;
    const original = parts.map(raster => Array.from(raster.data.subarray(pixel * 4, pixel * 4 + 4)));
    const legacy = parts.map(raster => ({ ...raster, data: new Uint8ClampedArray(raster.data) }));
    const events: Event[] = [];
    const settings = { painted: new Uint8Array(source.width * source.height).fill(1), editable: [true, true], ground };
    paintingEdges(legacy, source, settings);
    const options = { ...settings, owner, allocationEvent: (event: Event) => events.push(event) };
    const result = paintingEdges(parts, source, options);
    const event = events.find(row => row.p === pixel);
    const applied = parts.map(raster => Array.from(raster.data.subarray(pixel * 4, pixel * 4 + 4)));
    const prefix = mode === 'bridge' ? 'ED1150_RETAINED_FRONT' : 'ED1150_UNANCHORED_RECEIVE';
    say(prefix + '_RELABEL', event?.status === (mode === 'bridge' ? 'retained-front' : 'refused') &&
      event?.reason === (mode === 'bridge' ? 'unique' : 'piece-guard-allocation-held'), JSON.stringify(event ?? null));
    const expectedBehind = mode === 'bridge' ? [30, 0, 170, 255] : [0, 0, 200, 5];
    say(prefix + '_RGBA', JSON.stringify(original) === JSON.stringify([[0, 0, 200, mode === 'bridge' ? 255 : 5], [200, 0, 0, 20]]) &&
      JSON.stringify(applied) === JSON.stringify([expectedBehind, [200, 0, 0, 20]]), JSON.stringify({ original, applied }));
    const rows = result.allocation?.coverageTransfers ?? [];
    const actual = rows.flatMap(row => row.pixels.spans.flatMap(([y, left, right]) =>
      Array.from({ length: right - left }, (_, i) => y * source.width + left + i))).sort((a, b) => a - b);
    const expected = Array.from({ length: source.width * source.height }, (_, p) => p).filter(p =>
      legacy[1].data[p * 4 + 3] > 0 && parts[1].data[p * 4 + 3] === 0 && parts[0].data[p * 4 + 3] > 0);
    say(prefix + '_MEMBERSHIP', !actual.includes(pixel) && JSON.stringify(actual) === JSON.stringify(expected) &&
      rows.every(row => row.front === 'front' && row.receiver === 'behind' && row.owner === 'behind' &&
        row.pixels.count === row.pixels.spans.reduce((n, [, left, right]) => n + right - left, 0)),
      JSON.stringify({ witness: pixel, actual, expected }));
    const protectedParts = paintingGuardFixture(mode);
    const keep = newMask(source.width, source.height); keep.data[pixel] = 1;
    const protectedEvents: Event[] = [];
    const protectedOptions = { ...settings, owner: protectedParts.owner, keep: [null, keep],
      allocationEvent: (row: Event) => protectedEvents.push(row) };
    const protectedResult = paintingEdges(protectedParts.parts, source, protectedOptions);
    say(prefix + '_PROTECTED', !protectedEvents.some(row => row.p === pixel) &&
      protectedParts.parts[1].data[pixel * 4 + 3] === 20 &&
      (protectedResult.allocation?.coverageTransfers ?? []).every(row => row.pixels.spans.every(([y, left, right]) =>
        y !== 16 || pixel % source.width < left || pixel % source.width >= right)), 'locked witness has no allocation event or transfer');
  }
}

export function writeStageFixture(directory: string, noTransfers = false, guard = false): void {
  const input = paintingOwnerFixture(directory);
  if (guard) {
    const generated = paintingGuardFixture('bridge');
    const rasters = [generated.source, ...generated.parts].map(raster => {
      const canvas = newRaster(64, 64);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const rgba = x < raster.width && y < raster.height
          ? raster.data.subarray((y * raster.width + x) * 4, (y * raster.width + x + 1) * 4)
          : [255, 255, 255, raster === generated.source ? 255 : 0];
        canvas.data.set(rgba, (y * 64 + x) * 4);
      }
      return canvas;
    });
    input.source = rasters[0];
    input.full.layers.forEach((layer, i) => { layer.pixels = rasters[i + 1]; });
  }
  if (noTransfers) for (let y = 4; y < 60; y++) for (let x = 4; x < 60; x++) input.full.layers[1].pixels.data[(y * 64 + x) * 4 + 3] = 255;
  const config = assembleConfig({ plan: input.plan, extend: [], headBox: [0, 0, 64, 64], resolution: 64, rigScale: 1 });
  Object.assign(config.assemble as object, { project: 'visible', seam: 'near-white' });
  writeFileSync(join(directory, 'config.json'), JSON.stringify(config));
  writePng(join(directory, 'painting.png'), input.source);
  writeRun(join(directory, 'full'), input.full.layers.map(layer => ({ name: layer.name, depth: 0.5,
    rects: [{ x0: 0, y0: 0, x1: 64, y1: 64, colour: [0, 0, 0] }] })), 64);
  for (const layer of input.full.layers) writePng(join(directory, 'full', 'parts', layer.name + '.png'), layer.pixels);
  writeRun(join(directory, 'head'), [{ name: 'head', depth: 0.5,
    rects: [{ x0: 8, y0: 8, x1: 24, y1: 24, colour: [20, 40, 60] }] }], 64);
  readLayers(join(directory, 'full'));
  readLayers(join(directory, 'head'));
}

export function runPaintingAllocationChecks(say: Say): void {
  runPaintingGuardChecks(say);
  const directory = mkdtempSync(join(tmpdir(), 'painting-allocation-'));
  try {
    const primary = join(directory, 'primary'), alternate = join(directory, 'alternate');
    writeStageFixture(primary, true); writeStageFixture(alternate);
    const input = { config: join(primary, 'config.json'), source: join(primary, 'painting.png'),
      full: join(primary, 'full'), head: join(primary, 'head') };
    const alt = { source: join(alternate, 'painting.png'), full: join(alternate, 'full'), head: join(alternate, 'head') };
    const output = join(directory, 'out');
    const outs = { partsJson: join(output, 'parts.json'), partsDir: join(output, 'parts'),
      recomposite: join(output, 'recomposite.png'), errorMap: join(output, 'error.png') };
    const logs: string[] = [];
    const result = assembleStage({ ...input, alts: [{ name: 'one', ...alt }, { name: 'two', ...alt }] }, outs, line => logs.push(line));
    const file = (name: string) => join(output, `painting_allocation.${name}.json`);
    const read = (name: string): Report | null => existsSync(file(name)) ? JSON.parse(readFileSync(file(name), 'utf8')) as Report : null;
    const one = read('one'), two = read('two');
    say('ED1150_ALTERNATE_DIFFERENT_MEMBERSHIPS', one !== null &&
      JSON.stringify(one.coverageTransfers) !== JSON.stringify(result.paintingEdges?.allocation?.coverageTransfers),
      JSON.stringify({ primary: result.paintingEdges?.allocation?.coverageTransfers, alternate: one?.coverageTransfers }));
    say('ED1150_PRIMARY_EMPTY_ALTERNATE_PRESENT', result.paintingEdges?.allocation?.coverageTransfers.length === 0 &&
      (one?.coverageTransfers.length ?? 0) > 0, 'empty primary transfers do not suppress an alternate report');
    say('ED1150_TWO_SETS_SHARE_COORDINATES', one?.set === 'one' && two?.set === 'two' &&
      JSON.stringify(one.coverageTransfers) === JSON.stringify(two.coverageTransfers) &&
      JSON.stringify(one.coverageTransfers) === JSON.stringify([{ front: 'front', receiver: 'behind', owner: 'behind',
        pixels: { count: 55, spans: Array.from({ length: 55 }, (_, i) => [i + 4, 32, 33]) } }]) &&
      one.source.painting_sha256 === createHash('sha256').update(readFileSync(alt.source)).digest('hex') &&
      JSON.stringify(one.grid) === '[64,64]' && one.membership === 'pre-filter-alternate-assembly' &&
      one.stage === 'paintingEdges after piece guarding and restoration', 'set, source, grid and stage qualify identical coordinates');
    say('ED1150_ALTERNATE_LOG_NAMES_SET_AND_FILE', ['one', 'two'].every(name => logs.some(line =>
      line.includes('PAINTING_EDGE_COVERAGE_TRANSFER') && line.includes(`set "${name}"`) && line.includes(`painting_allocation.${name}.json`))),
      'each diagnostic names its set and report');
    const config = JSON.parse(readFileSync(input.config, 'utf8')) as { assemble: Record<string, unknown> };
    config.assemble.alternates = [{ name: 'partial', ...alt, parts: ['front'], hides: ['behind'] }];
    writeFileSync(input.config, JSON.stringify(config));
    assembleStage(input, outs, () => {});
    const partial = read('partial');
    say('ED1150_PARTIAL_SET_HIDES_AND_ASSETS', partial?.membership === 'pre-filter-alternate-assembly' &&
      partial.hidden_parts.includes('behind') && !partial.inherited_parts.includes('behind') &&
      partial.output_assets.some(row => row.part === 'front' && row.image === 'partial_front.png') &&
      partial.output_assets.some(row => row.part === 'behind' && row.image === null) && partial.coverageTransfers.length === 0,
      'pre-filter reading distinguishes exported assets, inherited parts and hidden parts');
    say('ED1150_STALE_ALTERNATES_REMOVED', !existsSync(file('one')) && !existsSync(file('two')) && partial !== null,
      'reuse removes reports for sets omitted from the new assembly');
    config.assemble.alternates = [{ name: 'inherited', ...alt, parts: ['front'] }];
    writeFileSync(input.config, JSON.stringify(config));
    assembleStage(input, outs, () => {});
    const inherited = read('inherited');
    say('ED1150_PARTIAL_SET_INHERITS_BASE', inherited?.inherited_parts.join() === 'behind' &&
      inherited.hidden_parts.length === 0 && inherited.output_assets.some(row => row.part === 'behind' && row.image === 'behind.png') &&
      inherited.coverageTransfers.length === 0,
      JSON.stringify(inherited));
    const unrelated = file('user-output');
    writeFileSync(unrelated, 'user-owned output');
    delete config.assemble.alternates; writeFileSync(input.config, JSON.stringify(config));
    assembleStage(input, outs, () => {});
    say('ED1150_NO_ALTERNATES_REMOVES_LAST_REPORT', !existsSync(file('partial')) && !existsSync(file('inherited')), 'reuse without alternates removes their last report');
    say('ED1150_PATTERN_MATCHING_NON_REPORT_SURVIVES', readFileSync(unrelated, 'utf8') === 'user-owned output',
      'reuse removes only paths recorded by the previous primary report');
    const configured = { ...outs, partsJson: file('inherited') };
    config.assemble.alternates = [{ name: 'inherited', ...alt, parts: ['front'] }];
    writeFileSync(input.config, JSON.stringify(config));
    assembleStage(input, outs, () => {});
    delete config.assemble.alternates; writeFileSync(input.config, JSON.stringify(config));
    let reusedParts: string | undefined;
    try { reusedParts = serializeParts(assembleStage(input, configured, () => {}).parts); }
    catch (err) {
      // A removed parts file can also fail its later support-domain reader.
      if (!(err instanceof Error) || !('code' in err) || err.code !== 'ENOENT' ||
          !('path' in err) || err.path !== configured.partsJson) throw err;
    }
    say('ED1150_PREVIOUS_REPORT_REUSED_AS_OUTPUT_SURVIVES', reusedParts !== undefined && existsSync(configured.partsJson) &&
      readFileSync(configured.partsJson, 'utf8') === reusedParts,
      'parts metadata written before cleanup survives with its exact serialized content');
    const heldDirectory = join(directory, 'held');
    writeStageFixture(heldDirectory, false, true);
    const heldInput = { source: join(heldDirectory, 'painting.png'), full: join(heldDirectory, 'full'), head: join(heldDirectory, 'head') };
    const heldEvents: Event[] = [];
    assembleStage({ ...input, alts: [{ name: 'held', ...heldInput }],
      allocationEvent: (event, set) => { if (set === 'held') heldEvents.push(event); } }, outs, () => {});

    const held = read('held');
    say('ED1150_ALTERNATE_HELD_PERSISTED', held !== null && held.coverageTransfers.length === 0 &&
      heldEvents.some(event => event.p === 16 * 64 + 21 && event.status === 'retained-front' && event.reason === 'unique'),
      JSON.stringify({ events: heldEvents.filter(event => event.p === 16 * 64 + 21), report: held }));
    config.assemble.keep_under_occluders = ['behind'];
    writeFileSync(input.config, JSON.stringify(config));
    const protectedEvents: Event[] = [];
    const protectedResult = assembleStage({ ...input, alts: [{ name: 'protected', ...alt }],
      allocationEvent: (event, set) => { if (set === 'protected') protectedEvents.push(event); } }, outs, () => {});
    const protectedReport = read('protected');
    const protectedRecord = protectedResult.parts.alternates!.find(set => set.name === 'protected')!.records!.find(part => part.name === 'front')!;
    const protectedRaster = readPng(join(outs.partsDir, 'protected_front.png'));
    const protectedAlpha = protectedRaster.data[((40 - protectedRecord.y) * protectedRaster.width + 32 - protectedRecord.x) * 4 + 3];
    say('ED1150_ALTERNATE_PROTECTED_PERSISTED', protectedReport !== null &&
      JSON.stringify(protectedReport.coverageTransfers) === JSON.stringify([{ front: 'front', receiver: 'behind', owner: 'behind',
        pixels: { count: 28, spans: Array.from({ length: 28 }, (_, i) => [i + 4, 32, 33]) } }]) &&
      one!.coverageTransfers.some(row => row.pixels.spans.some(([y, left, right]) => y === 40 && left <= 32 && right > 32)) &&
      !protectedEvents.some(event => event.p === 40 * 64 + 32) && protectedAlpha === 95 &&
      protectedReport.coverageTransfers.every(row => row.pixels.spans.every(([y, left, right]) =>
        y !== 40 || 32 < left || 32 >= right)), JSON.stringify(protectedReport));
    delete config.assemble.keep_under_occluders; writeFileSync(input.config, JSON.stringify(config));
    let collision = false;
    try { assembleStage({ ...input, alts: [{ name: 'one', ...alt }] }, { ...outs, partsJson: file('one') }, () => {}); }
    catch (err) { if (!(err instanceof PartsError)) throw err; collision = err.problems.some(row => row.code === 'PAINTING_ALLOCATION_UNAMBIGUOUS'); }
    say('ED1150_REPORT_COLLISION_REFUSED_BEFORE_WRITE', collision && !existsSync(file('one')),
      'report and parts metadata cannot share an output path');
    const allocCollision = (a: string, b: string): PartsError | null => {
      const colOut = join(directory, `col-${a}`);
      try {
        assembleStage({ ...input, alts: [{ name: a, ...alt }, { name: b, ...alt }] },
          { partsJson: join(colOut, 'parts.json'), partsDir: join(colOut, 'parts'), recomposite: join(colOut, 'recomposite.png'), errorMap: join(colOut, 'error.png') }, () => {});
        return null;
      } catch (err) { if (err instanceof PartsError) return err; throw err; }
    };
    const caseAllocErr = allocCollision('Warm', 'warm');
    const nfdAllocErr = allocCollision('\u00e9', 'e\u0301');
    const nearMissOut = join(directory, 'col-near-miss');
    assembleStage({ ...input, alts: [{ name: 'Warm', ...alt }, { name: 'cool', ...alt }] },
      { partsJson: join(nearMissOut, 'parts.json'), partsDir: join(nearMissOut, 'parts'), recomposite: join(nearMissOut, 'recomposite.png'), errorMap: join(nearMissOut, 'error.png') }, () => {});
    say('ED1172_CASE_AND_UNICODE_COLLIDING_ALLOCATION_SETS_REFUSED_BEFORE_WRITE',
      caseAllocErr?.problems.some(row => row.code === 'PAINTING_ALLOCATION_UNAMBIGUOUS' && row.detail.includes('"Warm"') && row.detail.includes('"warm"')) === true &&
      !existsSync(join(directory, 'col-Warm')) &&
      nfdAllocErr?.problems.some(row => row.code === 'PAINTING_ALLOCATION_UNAMBIGUOUS' && row.detail.includes('"\u00e9"') && row.detail.includes('"e\u0301"')) === true &&
      !existsSync(join(directory, 'col-\u00e9')) &&
      existsSync(join(nearMissOut, 'painting_allocation.Warm.json')) &&
      existsSync(join(nearMissOut, 'painting_allocation.cool.json')),
      JSON.stringify({ caseProblems: caseAllocErr?.problems.filter(p => p.code === 'PAINTING_ALLOCATION_UNAMBIGUOUS'), nfdProblems: nfdAllocErr?.problems.filter(p => p.code === 'PAINTING_ALLOCATION_UNAMBIGUOUS') }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

if (import.meta.main) {
  let failures = 0;
  runPaintingAllocationChecks((name, pass, detail) => {
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`);
    if (!pass) failures++;
  });
  process.exitCode = failures === 0 ? 0 : 1;
}
