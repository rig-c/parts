/** Region-take controls through the stage, strict loader and public check metric. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeTakeRegionFixture } from '../fixtures/take_region.ts';
import { assembleStage, readRuns } from '../src/build.ts';
import { parseConfig, parseEarlyConfig, loadEarlyConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { fileSha256, readEditorReceipts } from '../src/editreceipt.ts';
import { readLayers } from '../src/layers.ts';
import { readPng, encodePngBytes } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
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
