/** Region-take controls through the stage, strict loader and public check metric. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeTakeRegionFixture } from '../fixtures/take_region.ts';
import { assemble, stageFields, regionTakeTargets, DEFAULT_PROJECT_RULE, DEFAULT_SEAM_RULE, retainRegionNeighbours, type AssembleResult } from '../src/assemble.ts';
import type { Mask } from '../src/raster/types.ts';
import { assembleStage, readRuns } from '../src/build.ts';
import { parseConfig, parseEarlyConfig, loadEarlyConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { fileSha256, readEditorReceipts } from '../src/editreceipt.ts';
import { readLayers } from '../src/layers.ts';
import { readPng, encodePngBytes } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
import { crop } from '../src/raster/composite.ts';
import { makeInputs } from '../src/inputs.ts';
import { setupPaintingLine } from '../src/setuppainting.ts';
import { applyTakenRegions, deriveTakenRegion, regionPaintingDelta } from '../src/takeregion.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
export function runTakeRegionChecks(dir: string, say: Say): void {
  const fresh = (name: string) => {
    const home = join(dir, name);
    return { home, cfg: writeTakeRegionFixture(home) };
  };
  const save = (home: string, cfg: unknown): void => writeFileSync(join(home, 'config.json'), JSON.stringify(cfg));
  const message = (action: () => unknown): string => {
    try { action(); return ''; }
    catch (error) { if (error instanceof PartsError) return error.message; throw error; }
  };
  const stage = (home: string, withRequirements = true) => {
    const notes: string[] = [];
    const result = assembleStage({ source: join(home, 'painting.png'), full: join(home, 'full'), head: null, config: join(home, 'config.json'), ...(withRequirements ? { requirements: join(home, 'requirements.json') } : {}) },
      { partsJson: join(home, 'out', 'parts.json'), partsDir: join(home, 'out', 'parts'), recomposite: join(home, 'out', 'recomposite.png'), errorMap: join(home, 'out', 'error.png') }, line => notes.push(line));
    return { result, notes };
  };
  const positive = fresh('positive');
  const before = readFileSync(join(positive.home, 'full', 'parts', 'topwear.png'));
  const good = stage(positive.home);
  const record = good.result.parts.parts.find(part => part.name === 'body')!;
  const output = readPng(join(positive.home, 'out', 'parts', 'body.png'));
  let covered = 0, outside = 0;
  for (let y = 36; y < 44; y++) for (let x = 8; x < 20; x++) if (output.data[((y - record.y) * output.width + x - record.x) * 4 + 3] >= 128) covered++;
  for (let y = 36; y < 44; y++) for (let x = 4; x < 8; x++) {
    if (x >= record.x && y >= record.y && x < record.x + record.w && y < record.y + record.h && output.data[((y - record.y) * output.width + x - record.x) * 4 + 3] >= 128) outside++;
  }
  say('REGION_HOLE_COVERAGE_AND_OUTSIDE', covered / 96 >= 0.95 && outside === 0, `covered ${covered}/96 planted px; outside derived region ${outside} px`);
  say('REGION_REPORT_AND_INPUT_IMMUTABILITY', good.notes.some(line => line.includes('96 run px; box [8, 36, 12, 8]') && line.includes('painting-match share 1; RGB tolerance 0')) && before.equals(readFileSync(join(positive.home, 'full', 'parts', 'topwear.png'))), good.notes.filter(line => line.includes('region take')).join(' | '));

  const cfg = loadEarlyConfig(join(positive.home, 'config.json'), 'assemble');
  const ledger = readEditorReceipts(cfg.assemble.editor_receipts, join(positive.home, 'config.json'));
  const runs = readRuns(join(positive.home, 'full'), null);
  const painting = readPng(join(positive.home, 'painting.png'));
  const donor = readLayers(join(positive.home, 'donor')).layers[0];
  const base = runs.full.layers.find(layer => layer.name === 'topwear')!;
  const derived = deriveTakenRegion(base, donor, painting, [12, 40], 0, 'fixture');
  const mutant = deriveTakenRegion(base, donor, painting, [12, 40], 255, 'fixture mutant');
  const takenOutside = (layer: typeof base): number => {
    let n = 0;
    for (let y = layer.top; y < layer.bottom; y++) for (let x = layer.left; x < layer.right; x++) {
      const alpha = layer.pixels.data[((y - layer.top) * layer.pixels.width + x - layer.left) * 4 + 3];
      const old = x < base.left || x >= base.right || y < base.top || y >= base.bottom ? 0 : base.pixels.data[((y - base.top) * base.pixels.width + x - base.left) * 4 + 3];
      const inRegion = x >= 8 && x < 20 && y >= 36 && y < 44;
      if (alpha >= 128 && old < 128 && !inRegion) n++;
    }
    return n;
  };
  say('REGION_WIDENED_TOLERANCE_MUTANT_FAILS_OUTSIDE_BAR', takenOutside(derived.layer) === 0 && takenOutside(mutant.layer) === 32, `outside bar (required 0): original ${takenOutside(derived.layer)} PASS; tolerance=255 mutant ${takenOutside(mutant.layer)} FAIL`);
  const disconnectedBase = { ...base, pixels: { ...base.pixels, data: new Uint8ClampedArray(base.pixels.data) } };
  disconnectedBase.pixels.data[((48 - base.top) * base.pixels.width + 40 - base.left) * 4 + 3] = 0;
  const disconnected = deriveTakenRegion(disconnectedBase, donor, painting, [12, 40], 0, 'disconnected');
  say('REGION_ONLY_SEEDED_COMPONENT', disconnected.reading.pixels === 96 && disconnected.layer.pixels.data[((48 - disconnected.layer.top) * disconnected.layer.pixels.width + 40 - disconnected.layer.left) * 4 + 3] === 0, JSON.stringify(disconnected.reading));

  const source = newRaster(32, 1), samples = newRaster(32, 1);
  for (let p = 0; p < 32; p++) {
    source.data.set([p * 8, 255 - p * 8, 33, [0, 127, 128, 255][p % 4]], p * 4);
    samples.data.set([255 - p * 8, p * 8, 34, [255, 128, 127, 0][p % 4]], p * 4);
  }
  let agree = true, observations = 0;
  for (const tolerance of [0, 1, 63, 127, 254, 255]) for (let p = 0; p < 32; p++) {
    const reading = setupPaintingLine({ rgb_tolerance: tolerance, regions: [{ name: 'pixel', box: [p, 0, 1, 1], max_pixels: 0 }] }, source, samples, new Uint8Array(32).fill(1), new Int32Array(32), ['part'], []);
    agree &&= (reading.regions[0].pixel_count === 0) === (regionPaintingDelta(source, samples, p * 4, p * 4) <= tolerance);
    observations++;
  }
  say('REGION_METRIC_AGREES_WITH_PUBLIC_SETUP_CHECK_PER_PIXEL', agree, `${observations} pixel/tolerance verdicts, including alpha 0, 127, 128 and 255`);
  const alphaBase = { ...base, pixels: { ...base.pixels, data: new Uint8ClampedArray(base.pixels.data) } };
  alphaBase.pixels.data[((40 - base.top) * base.pixels.width + 12 - base.left) * 4 + 3] = 127;
  say('REGION_ALPHA_127_IS_MISSING_128_IS_COVERED', deriveTakenRegion(alphaBase, donor, painting, [12, 40], 0, 'alpha 127').reading.pixels === 96 && (() => {
    alphaBase.pixels.data[((40 - base.top) * base.pixels.width + 12 - base.left) * 4 + 3] = 128;
    return message(() => deriveTakenRegion(alphaBase, donor, painting, [12, 40], 0, 'alpha 128')).includes('ASSEMBLE_REGION_TAKE_SEED');
  })(), 'base coverage threshold 128');
  const donor127 = { ...donor, pixels: { ...donor.pixels, data: new Uint8ClampedArray(donor.pixels.data) } };
  for (let p = 3; p < donor127.pixels.data.length; p += 4) donor127.pixels.data[p] = 127;
  say('REGION_EMPTY_AND_SEED_REFUSALS', message(() => deriveTakenRegion(base, donor127, painting, [12, 40], 0, 'alpha')).includes('ASSEMBLE_REGION_TAKE_EMPTY') && message(() => deriveTakenRegion(base, donor, painting, [0, 0], 0, 'seed')).includes('ASSEMBLE_REGION_TAKE_SEED'), 'donor alpha 127 yields zero qualifying pixels; seed [0,0] touches none');
  say('REGION_ABSENT_DECLARATION_PRESERVES_RUN_IDENTITY', (() => {
    const clean = { ...cfg, assemble: { ...cfg.assemble, take: [] } };
    const input = { ...runs, notes: [] };
    return applyTakenRegions(input, painting, clean, join(positive.home, 'config.json'), undefined, ledger) === input;
  })(), 'no region declaration returns the exact input runs');

  const noRequirement = fresh('no-requirement');
  const noLimit = fresh('no-limit');
  writeFileSync(join(noLimit.home, 'requirements.json'), JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 1, targets: [], requirements: [] }));
  for (const item of [noRequirement, noLimit]) {
    const text = message(() => stage(item.home, item === noLimit));
    say('REGION_TOLERANCE_REQUIRED_BEFORE_EMISSION', text.includes('ASSEMBLE_REGION_TAKE_TOLERANCE') && !existsSync(join(item.home, 'out')), text);
  }
  for (const [name, mutate, code] of [
    ['crop', (home: string) => { const p = join(home, 'donor', 'layers.json'); const value = JSON.parse(readFileSync(p, 'utf8')); value.width = 65; writeFileSync(p, JSON.stringify(value)); }, 'ASSEMBLE_REGION_TAKE_GEOMETRY'],
    ['input-crop', (home: string) => { const p = readPng(join(home, 'painting.png')); p.data[0] ^= 1; writeFileSync(join(home, 'different.png'), encodePngBytes(p)); const c = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')); c.assemble.take[0].st_input = 'different.png'; save(home, c); }, 'ASSEMBLE_REGION_TAKE_GEOMETRY'],
    ['part-missing', (home: string) => { const p = join(home, 'donor', 'layers.json'); const value = JSON.parse(readFileSync(p, 'utf8')); value.layers[0].name = 'neck'; value.layers[0].filename = 'parts/topwear.png'; writeFileSync(p, JSON.stringify(value)); }, 'ASSEMBLE_REGION_TAKE_PART'],
    ['seed-outside', (home: string) => { const c = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')); c.assemble.take[0].seed = [64, 0]; save(home, c); }, 'ASSEMBLE_REGION_TAKE_SEED'],
  ] as const) {
    const item = fresh(name); mutate(item.home);
    const text = message(() => stage(item.home));
    say('REGION_NAMED_REFUSAL_' + name.toUpperCase().replaceAll('-', '_'), text.includes(code) && !existsSync(join(item.home, 'out')), text);
  }
  const declarations = (positive.cfg.assemble as { take: Array<Record<string, unknown>> }).take;
  for (const [name, entry, expected] of [
    ['polygon', { ...declarations[0], polygon: [[0, 0], [1, 1], [1, 0]] }, 'CONFIG_KEY_KNOWN'],
    ['rectangle', { ...declarations[0], box: [0, 0, 2, 2] }, 'CONFIG_KEY_KNOWN'],
    ['brush', { ...declarations[0], brush: [[0, 0]] }, 'CONFIG_KEY_KNOWN'],
    ['fractional seed', { ...declarations[0], seed: [0.5, 0] }, 'CONFIG_FIELD_TYPE'],
    ['missing seed', { ...declarations[0], seed: undefined }, 'CONFIG_FIELD_TYPE'],
    ['unknown part', { ...declarations[0], part: 'absent' }, 'CONFIG_NAME_RESOLVES'],
  ] as const) {
    const raw = { ...positive.cfg, assemble: { ...(positive.cfg.assemble as Record<string, unknown>), take: [entry] } };
    const readers = name === 'unknown part' ? [() => parseEarlyConfig(raw, 'assemble'), () => parseConfig(raw)] : [() => parseEarlyConfig(raw, 'layers'), () => parseEarlyConfig(raw, 'assemble'), () => parseConfig(raw)];
    say('REGION_LOADER_' + name.toUpperCase().replaceAll(' ', '_'), readers.every(read => message(read).includes(expected)), expected);
  }
  const duplicate = { ...positive.cfg, assemble: { ...(positive.cfg.assemble as Record<string, unknown>), take: [declarations[0], declarations[0]] } };
  say('REGION_DUPLICATE_DECLARATIONS_REFUSED', [() => parseEarlyConfig(duplicate, 'layers'), () => parseEarlyConfig(duplicate, 'assemble'), () => parseConfig(duplicate)].every(read => message(read).includes('CONFIG_TAKE_UNIQUE')), 'one region donor per target part at all config doors');
  const setup = { rgb_tolerance: 0, regions: [{ name: 'stage', box: [0, 0, 64, 64] as [number, number, number, number] }] };
  const bound = { ...cfg, depth: { zScale: 1 } };
  say('REGION_ACTIVE_DEPTH_BINDING_REFUSED', message(() => applyTakenRegions({ ...runs, notes: [] }, painting, bound, join(positive.home, 'config.json'), setup, ledger)).includes('ASSEMBLE_REGION_TAKE_BINDING'), 'region samples cannot inherit an unrelated scalar atlas');
  const proposed = spawnSync(process.execPath, ['cli.ts', 'assemble', '--source', join(positive.home, 'painting.png'), '--full', join(positive.home, 'full'), '--config', join(positive.home, 'config.json'), '--propose-plan'], { encoding: 'utf8' });
  say('REGION_PLAN_PROPOSAL_REFUSES_BOUND_DECLARATION', proposed.status !== 0 && (proposed.stdout + proposed.stderr).includes('ASSEMBLE_REGION_TAKE_PLAN'), proposed.stdout + proposed.stderr);
}

/** The same author donor must fail without its receipt and pass with it. */
export function runTakeRegionReceiptChecks(dir: string, say: Say): void {
  for (const mode of ['required', 'trace_parts'] as const) {
    const home = join(dir, mode);
    const cfg = writeTakeRegionFixture(home);
    for (const run of ['full', 'donor']) {
      const path = join(home, run, 'layers.json');
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as { layers: Array<{ name: string; filename: string }> };
      const material = manifest.layers.find(layer => layer.name === 'topwear')!;
      material.name = 'author:material';
      material.filename = 'parts/topwear.png';
      writeFileSync(path, JSON.stringify(manifest));
    }
    const assemble = cfg.assemble as Record<string, unknown>;
    assemble.plan = [['body', 'full', 'author:material'], ['face', 'full', 'face']];
    const receipt = (file: string) => ({ file, sha256: fileSha256(join(home, file)), from_sha256: '0'.repeat(64), editor: 'photocraft-cli' });
    const baseReceipt = receipt('full/parts/topwear.png');
    const donorReceipt = receipt('donor/parts/topwear.png');
    const config = join(home, 'config.json');
    assemble.editor_receipts = { [mode]: true, receipts: [baseReceipt] };
    writeFileSync(config, JSON.stringify(cfg));
    const run = (out: string) => assembleStage(
      { source: join(home, 'painting.png'), full: join(home, 'full'), head: null, config, requirements: join(home, 'requirements.json') },
      { partsJson: join(home, out, 'parts.json'), partsDir: join(home, out, 'parts'), recomposite: join(home, out, 'recomposite.png'), errorMap: join(home, out, 'error.png') }, () => {},
    );
    let missing = '';
    try { run('missing'); }
    catch (error) { if (error instanceof PartsError) missing = error.message; else throw error; }
    say('REGION_DONOR_RECEIPT_MISSING_' + mode.toUpperCase(),
      missing.includes('ASSEMBLE_EDITOR_RECEIPT_MISSING') && missing.includes('region take') && missing.includes('author:material') && missing.includes(`editor_receipts.${mode} is true`) && !existsSync(join(home, 'missing')),
      missing || `unreceipted author donor accepted under ${mode}`);
    assemble.editor_receipts = { [mode]: true, receipts: [baseReceipt, donorReceipt] };
    writeFileSync(config, JSON.stringify(cfg));
    const good = run('receipted');
    say('REGION_RECEIPTED_AUTHOR_DONOR_ACCEPTED_' + mode.toUpperCase(),
      good.parts.parts.some(part => part.name === 'body' && part.from === 'full:author:material') && fileSha256(join(home, donorReceipt.file)) === donorReceipt.sha256,
      `same donor accepted under ${mode} with a verified receipt, sha256 ${donorReceipt.sha256}`);
  }
}

/** Count every neighbour RGBA difference outside the declared rig-grid support. */
export function regionNeighbourChanges(before: AssembleResult, after: AssembleResult, target: string, support: Mask): number {
  const pixel = (part: AssembleResult['images'][number] | undefined, x: number, y: number, channel: number): number => {
    if (part === undefined) return 0;
    const { record, image } = part;
    if (x < record.x || y < record.y || x >= record.x + image.width || y >= record.y + image.height) return 0;
    return image.data[((y - record.y) * image.width + x - record.x) * 4 + channel];
  };
  const names = new Set([...before.images, ...after.images].map(p => p.record.name));
  let changed = 0;
  for (const name of names) {
    if (name === target) continue;
    const a = before.images.find(p => p.record.name === name), b = after.images.find(p => p.record.name === name);
    for (let y = 0; y < support.height; y++) for (let x = 0; x < support.width; x++) {
      if (support.data[y * support.width + x] === 1) continue;
      if ([0, 1, 2, 3].some(c => pixel(a, x, y, c) !== pixel(b, x, y, c))) changed++;
    }
  }
  return changed;
}

export function runTakeContainmentChecks(dir: string, say: Say): void {
  const cfg = writeTakeRegionFixture(dir);
  const config = join(dir, 'config.json'), paintingPath = join(dir, 'painting.png');
  const stageNotes: string[] = [];
  const stage = (source = paintingPath) => assembleStage(
    { source, full: join(dir, 'full'), head: null, config, requirements: join(dir, 'requirements.json') },
    { partsJson: join(dir, 'out', 'parts.json'), partsDir: join(dir, 'out', 'parts'), recomposite: join(dir, 'out', 'recomposite.png'), errorMap: join(dir, 'out', 'error.png') }, line => stageNotes.push(line),
  );
  const take = (cfg.assemble as { take: Array<Record<string, unknown>> }).take;
  const save = () => writeFileSync(config, JSON.stringify(cfg));
  const declaration = { ...take[0] };
  take.length = 0; save(); const before = stage();
  take.push(declaration); save(); const after = stage();
  const support: Mask = { width: 64, height: 64, data: new Uint8Array(64 * 64) };
  for (let y = 34; y < 46; y++) for (let x = 6; x < 22; x++) support.data[y * 64 + x] = 1;
  const observed = regionNeighbourChanges(before, after, 'body', support);
  const planted = { ...after, images: after.images.map(p => p.record.name === 'face' ? { ...p, image: { ...p.image, data: new Uint8ClampedArray(p.image.data) } } : p) };
  planted.images.find(p => p.record.name === 'face')!.image.data[0] ^= 1;
  say('REGION_NEIGHBOUR_CONTAINMENT_AND_PLANTED_SPREAD', observed === 0 && regionNeighbourChanges(before, planted, 'body', support) === 1, `outside component plus 2 px: ${observed}; planted neighbour spread: ${regionNeighbourChanges(before, planted, 'body', support)}`);
  const loaded = loadEarlyConfig(config, 'assemble'), runs = readRuns(join(dir, 'full'), null), painting = readPng(paintingPath);
  const ledger = readEditorReceipts(undefined, config), setup = { rgb_tolerance: 0, regions: [] };
  const first = applyTakenRegions({ ...runs, notes: [] }, painting, loaded, config, setup, ledger, paintingPath);
  const alternate = { ...painting, data: new Uint8ClampedArray(painting.data) };
  for (let p = 0; p < alternate.data.length; p += 4) for (let c = 0; c < 3; c++) alternate.data[p + c] = 255 - alternate.data[p + c];
  writeFileSync(join(dir, 'alternate-input.png'), encodePngBytes(alternate));
  loaded.assemble.take![0].st_input = 'alternate-input.png';
  const second = applyTakenRegions({ ...runs, notes: [] }, alternate, loaded, config, setup, ledger, paintingPath);
  say('REGION_FIXED_REFERENCE_MASK_IS_SOURCE_INDEPENDENT', first.notes.join() === second.notes.join() && first.full.layers.every((p, i) => p.pixels.data.every((v, j) => v === second.full.layers[i].pixels.data[j])), 'same declared painting, inverted projection source, identical selected run bytes and reading');
  const refusal = (mutate: () => void, code: string): boolean => {
    const previous = readFileSync(join(dir, 'out', 'parts.json'));
    mutate(); save();
    try { stage(); return false; }
    catch (error) {
      if (error instanceof PartsError) return error.problems.some(p => p.code === code) && previous.equals(readFileSync(join(dir, 'out', 'parts.json')));
      throw error;
    }
  };
  say('REGION_UNRESOLVABLE_REFERENCE_REFUSED', refusal(() => { take[0].reference = { painting: 'absent-reference.png', sha256: fileSha256(paintingPath) }; }, 'ASSEMBLE_REGION_TAKE_REFERENCE'), 'ASSEMBLE_REGION_TAKE_REFERENCE');
  say('REGION_MISMATCHED_REFERENCE_REFUSED', refusal(() => { take[0].reference = { painting: 'painting.png', sha256: '0'.repeat(64) }; }, 'ASSEMBLE_REGION_TAKE_REFERENCE_MATCH'), 'ASSEMBLE_REGION_TAKE_REFERENCE_MATCH');
  take[0].reference = { source: true, sha256: fileSha256(paintingPath) }; save();
  say('REGION_SOURCE_REFERENCE_ACCEPTED', stage().parts.parts.some(p => p.name === 'body'), 'explicit source binding hashes the stage source PNG');
  const targets = new Set(['body']);
  const changedPopulation = (removed: boolean): boolean => {
    const placed = removed ? after.images.filter(p => p.record.name !== 'face') : [...after.images, { ...after.images[0], record: { ...after.images[0].record, name: 'extra' } }];
    try {
      retainRegionNeighbours(placed, before.images, targets);
      return false;
    } catch (error) {
      if (error instanceof PartsError) return error.problems.some(p => p.code === 'ASSEMBLE_REGION_TAKE_CONTAINMENT');
      throw error;
    }
  };
  say('REGION_NEIGHBOUR_POPULATION_CHANGES_REFUSED', changedPopulation(false) && changedPopulation(true), 'added and removed neighbours each refuse ASSEMBLE_REGION_TAKE_CONTAINMENT');
  delete take[0].reference;
  save();
  stageNotes.length = 0;
  const implicitResult = stage();
  const implicitWarnings = stageNotes.filter(line => line.startsWith('WARN  ASSEMBLE_REGION_TAKE_REFERENCE_IMPLICIT:'));
  const implicitCfg = loadEarlyConfig(config, 'assemble');
  const implicitRuns = applyTakenRegions({ ...runs, notes: [] }, painting, implicitCfg, config, setup, ledger);
  const legacyPredicate = deriveTakenRegion(runs.full.layers.find(layer => layer.name === 'topwear')!, readLayers(join(dir, 'donor')).layers[0], painting, [12, 40], 0, 'shipped predicate');
  const implicitLayer = implicitRuns.full.layers.find(layer => layer.name === 'topwear')!;
  const implicitMaskMatches = implicitLayer.pixels.data.every((byte, i) => byte === legacyPredicate.layer.pixels.data[i]) && legacyPredicate.reading.pixels === 96;
  take[0].reference = { source: true, sha256: fileSha256(paintingPath) };
  save();
  const basePath = join(dir, 'full', 'parts', 'topwear.png'), empty = readPng(basePath);
  empty.data.fill(0); writeFileSync(basePath, encodePngBytes(empty));
  say('REGION_RECOVERS_EMPTY_TARGET_WITH_CONTAINMENT', stage().parts.parts.find(p => p.name === 'body')!.opaque_px > 0, 'counterfactual empty target stays internal; recovered target is measured normally');
  const rectangular = join(dir, 'rectangular');
  const rectangularCfg = writeTakeRegionFixture(rectangular);
  const rectangularPainting = newRaster(96, 64);
  rectangularPainting.data.fill(255);
  for (let y = 0; y < 64; y++) rectangularPainting.data.set(painting.data.subarray(y * 64 * 4, (y + 1) * 64 * 4), y * 96 * 4);
  const rectangularPath = join(rectangular, 'painting.png');
  writeFileSync(rectangularPath, encodePngBytes(rectangularPainting));
  for (const run of ['full', 'donor']) {
    const path = join(rectangular, run, 'layers.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest.width = 96;
    writeFileSync(path, JSON.stringify(manifest));
  }
  (rectangularCfg.assemble as { take: Array<Record<string, unknown>> }).take[0].reference = { painting: 'painting.png', sha256: fileSha256(rectangularPath) };
  const rectangularConfig = join(rectangular, 'config.json');
  writeFileSync(rectangularConfig, JSON.stringify(rectangularCfg));
  const rectangularRuns = readRuns(join(rectangular, 'full'), null);
  const rectangularReading = applyTakenRegions({ ...rectangularRuns, notes: [] }, rectangularPainting, loadEarlyConfig(rectangularConfig, 'assemble'), rectangularConfig, setup, ledger);
  say('REGION_RECTANGULAR_SINGLE_REFERENCE_HAS_NO_PADDING_TRANSFORM', rectangularReading.notes.some(line => line.includes('"scale":[1,1],"origin":[0,0]')), 'rectangular single-run predicate reads the unpadded painting; its logged origin is [0,0]');
  say('REGION_IMPLICIT_REFERENCE_PRESERVES_SHIPPED_MASK', implicitMaskMatches, 'absent reference reads the stage painting; identical run bytes to the shipped predicate, 96 selected cells');
  say('REGION_IMPLICIT_REFERENCE_WARNS_ONCE', implicitWarnings.length === 1 && !stageNotes.some(line => line.startsWith('FAIL')), implicitWarnings.join(' | '));
  say('REGION_IMPLICIT_REFERENCE_CONTAINS_NEIGHBOURS', regionNeighbourChanges(before, implicitResult, 'body', support) === 0, 'absent reference has zero neighbour changes beyond the component plus 2 px');
}


/** Target-derived pieces must keep the same post-take material as their source. */
export function runTakeDerivedChecks(dir: string, say: Say): void {
  const pixel = (result: AssembleResult, name: string, x: number, y: number, c: number): number => {
    const p = result.images.find(p => p.record.name === name);
    if (p === undefined || x < p.record.x || y < p.record.y || x >= p.record.x + p.image.width || y >= p.record.y + p.image.height) return 0;
    return p.image.data[((y - p.record.y) * p.image.width + x - p.record.x) * 4 + c];
  };
  for (const mode of ['cut', 'limb'] as const) {
    const home = join(dir, mode), raw = writeTakeRegionFixture(home);
    const a = raw.assemble as Record<string, unknown>;
    const regions = raw.regions as Record<string, string>;
    if (mode === 'cut') {
      a.cuts = [{ from: 'body', into: 'panel', polygon: [[8, 34], [24, 34], [24, 46], [8, 46]], overlap: 0, draw: 'front' }];
      regions.panel = 'anchor';
    } else {
      raw.bones = [{ name: 'anchor', parent: 'root', at: [0, 0] }, { chain: 'arm', parent: 'anchor', points: [[14, 32], [14, 44]], tip: [14, 56] }];
      raw.limbs = { arm: { segments: [{ part: 'upper', from: 'body', bone: 'arm0' }, { part: 'lower', from: 'body', bone: 'arm1', joint: 'joint' }] } };
      regions.upper = 'arm0'; regions.lower = 'arm1';
    }
    const config = join(home, 'config.json');
    const save = () => writeFileSync(config, JSON.stringify(raw));
    const declarations = a.take;
    const stage = (name: string) => assembleStage(
      { source: join(home, 'painting.png'), full: join(home, 'full'), head: null, config, requirements: join(home, 'requirements.json') },
      { partsJson: join(home, name, 'parts.json'), partsDir: join(home, name, 'parts'), recomposite: join(home, name, 'recomposite.png'), errorMap: join(home, name, 'error.png') }, () => {},
    );
    a.take = []; save(); const before = stage('before');
    a.take = declarations; save(); const after = stage('after');
    const cfg = loadEarlyConfig(config, 'assemble'), source = readPng(join(home, 'painting.png'));
    const runs = readRuns(join(home, 'full'), null), ledger = readEditorReceipts(undefined, config);
    const taken = applyTakenRegions({ ...runs, notes: [] }, source, cfg, config, { rgb_tolerance: 0, regions: [] }, ledger);
    const oracle = assemble({ source, full: taken.full, head: taken.head, ...stageFields(cfg, { w: 64, h: 64 }), seamRule: DEFAULT_SEAM_RULE, projectRule: DEFAULT_PROJECT_RULE });
    const descendants = mode === 'cut' ? ['panel'] : ['upper', 'lower'];
    const matches = (result: AssembleResult): boolean => descendants.every(name => {
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) for (let c = 0; c < 4; c++) if (pixel(result, name, x, y, c) !== pixel(oracle, name, x, y, c)) return false;
      return true;
    });
    const mutant = { ...after, images: [...after.images] };
    retainRegionNeighbours(mutant.images, before.images, new Set(['body']));
    say(`REGION_${mode.toUpperCase()}_DESCENDANT_AND_OLD_TARGET_MUTANT`, matches(after) && !matches(mutant), `post-take descendant pixels match independently assembled material; old target-name-only restoration fails: ${!matches(mutant)}`);
    if (mode === 'cut') {
      const count = after.cuts[0];
      const piece = after.images.find(p => p.record.name === 'panel')!;
      const base = after.images.find(p => p.record.name === 'body')!;
      const ownership = after.parts.cut_ownership![0];
      say('REGION_CUT_OWNERSHIP_MATCHES_EMITTED_PARTS', count.before === count.kept + count.taken && count.taken === piece.record.opaque_px && count.kept === base.record.opaque_px && ownership.moved_in_opaque_px === piece.record.opaque_px && piece.record.opaque_px === 192, JSON.stringify({ count, piece: piece.record.opaque_px, base: base.record.opaque_px, ownership }));
      let projectionMatches = true;
      for (let y = 36; y < 44; y++) for (let x = 8; x < 20; x++) for (let c = 0; c < 4; c++) if (pixel(after, 'panel', x, y, c) !== taken.full.layers.find(l => l.name === 'topwear')!.pixels.data[((y - 32) * 48 + x - 8) * 4 + c]) projectionMatches = false;
      say('REGION_CUT_CROSSES_SELECTED_COMPONENT', projectionMatches, 'all 96 taken cells inside the polygon retain the post-take source RGBA');
    }
    const basePath = join(home, 'full', 'parts', 'topwear.png'), empty = readPng(basePath);
    empty.data.fill(0); writeFileSync(basePath, encodePngBytes(empty));
    say(`REGION_EMPTY_TARGET_${mode.toUpperCase()}_DESCENDANTS`, stage('empty').images.filter(p => descendants.includes(p.record.name)).every(p => p.record.opaque_px > 0), 'empty counterfactual descendants are internal; actual recovered pieces remain required to contain art');
  }
  const closure = regionTakeTargets(['body'], [{ from: 'body', into: 'panel', polygon: [[0, 0], [1, 0], [1, 1]], overlap: 0, draw: 'front' }], { limb: { segments: [{ part: 'upper', from: 'panel', bone: 'a' }, { part: 'lower', from: 'panel', bone: 'b', joint: 'joint', hybrid: { part: 'band' } }] } });
  say('REGION_TRANSITIVE_CUT_LIMB_HYBRID_TARGET_CLOSURE', ['body', 'panel', 'upper', 'lower', 'band'].every(name => closure.has(name)) && !closure.has('painting_patch'), [...closure].join(', '));
  const capClosure = regionTakeTargets(['body'], [], { limb: { segments: [{ part: 'upper', from: 'body', bone: 'a' }, { part: 'lower', from: 'other', bone: 'b', joint: 'joint' }] } });
  say('REGION_UPPER_SOURCE_CAP_DESCENDANT', capClosure.has('lower') && !capClosure.has('other'), 'lower caps can copy taken upper-source art without making the independent source itself a target');
}

/** Source identity and the independently bound colour predicate use one frame. */
export function runTakeReferenceGeometryChecks(dir: string, say: Say): void {
  for (const padded of [false, true]) {
    const home = join(dir, padded ? 'padded' : 'square');
    const cfg = writeTakeRegionFixture(home);
    if (padded) (cfg.seethrough as Record<string, unknown>).head_box = [0, 0, 48, 48];
    const config = join(home, 'config.json');
    const paintingPath = join(home, 'painting.png');
    const platePath = join(home, 'plate.png');
    const original = readPng(paintingPath);
    const reference = padded ? crop(original, 8, 0, 48, 64) : original;
    writeFileSync(paintingPath, encodePngBytes(reference));
    const plate = { ...reference, data: new Uint8ClampedArray(reference.data) };
    plate.data[0] ^= 1;
    const take = (cfg.assemble as { take: Array<Record<string, unknown>> }).take;
    take[0].st_input = 'plate-input.png';
    take[0].reference = { painting: 'painting.png', sha256: fileSha256(paintingPath) };
    const stage = () => {
      writeFileSync(config, JSON.stringify(cfg));
      writeFileSync(platePath, encodePngBytes(plate));
      const inputs = makeInputs(plate, loadEarlyConfig(config, 'assemble'), 'generated plate');
      writeFileSync(join(home, 'plate-input.png'), encodePngBytes(inputs.full));
      return assembleStage(
        { source: platePath, full: join(home, 'full'), head: padded ? join(home, 'full') : null, config, requirements: join(home, 'requirements.json') },
        { partsJson: join(home, 'out', 'parts.json'), partsDir: join(home, 'out', 'parts'), recomposite: join(home, 'out', 'recomposite.png'), errorMap: join(home, 'out', 'error.png') }, () => {},
      );
    };
    const shift = padded ? 8 : 0;
    const selected = (result: AssembleResult): number => {
      const body = result.images.find(part => part.record.name === 'body')!;
      let pixels = 0;
      for (let y = 36; y < 44; y++) for (let x = 8 - shift; x < 20 - shift; x++) {
        if (body.image.data[((y - body.record.y) * body.image.width + x - body.record.x) * 4 + 3] >= 128) pixels++;
      }
      return pixels;
    };
    const initial = selected(stage());
    // Uniform colour substitution on half of the generated hole.
    for (let y = 36; y < 44; y++) for (let x = 14 - shift; x < 20 - shift; x++) reference.data[(y * reference.width + x) * 4] ^= 255;
    writeFileSync(paintingPath, encodePngBytes(reference));
    take[0].reference = { painting: 'painting.png', sha256: fileSha256(paintingPath) };
    const referencePlant = selected(stage());
    for (let y = 36; y < 44; y++) for (let x = 14 - shift; x < 20 - shift; x++) reference.data[(y * reference.width + x) * 4] ^= 255;
    writeFileSync(paintingPath, encodePngBytes(reference));
    take[0].reference = { painting: 'painting.png', sha256: fileSha256(paintingPath) };
    for (let y = 36; y < 44; y++) for (let x = 14 - shift; x < 20 - shift; x++) plate.data[(y * plate.width + x) * 4] ^= 255;
    const sourcePlant = selected(stage());
    say(padded ? 'REGION_PADDED_REFERENCE_COLOUR_AND_SOURCE_GEOMETRY' : 'REGION_REFERENCE_COLOUR_AND_SOURCE_GEOMETRY', initial === 96 && referencePlant === 48 && sourcePlant === 96, `selected cells initial ${initial}, reference-only colour plant ${referencePlant}, source-only colour plant ${sourcePlant}, source ${plate.width}x${plate.height}, run 64x64`);
  }
}
