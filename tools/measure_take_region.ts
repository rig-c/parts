/** Reproduce #1000's public-example byte control and derived public hole.
 * bun tools/measure_take_region.ts --baseline <source snapshot> --out <evidence>
 * The baseline is the unchanged source snapshot with its installed dependencies.
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assembleStage } from '../src/build.ts';
import { loadEarlyConfig } from '../src/config.ts';
import { makeInputs } from '../src/inputs.ts';
import { readLayers } from '../src/layers.ts';
import { connectedComponents } from '../src/raster/components.ts';
import { readPng, writePng } from '../src/raster/png.ts';
import { resize } from '../src/raster/resize.ts';
import { newMask } from '../src/raster/types.ts';
import { deriveTakenRegion, regionPaintingDelta } from '../src/takeregion.ts';

function fileHashes(home: string, dir = home): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(result, fileHashes(home, path));
    else result[relative(home, path)] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return result;
}
const outputs = (dir: string) => ({ partsJson: join(dir, 'parts.json'), partsDir: join(dir, 'parts'), recomposite: join(dir, 'recomposite.png'), errorMap: join(dir, 'error.png') });

/** Plant a hole by deleting the largest painting-matched donor component.
 * No drawn bound enters either config or selection. Inputs are public and copied.
 */
export function measurePublicRegion(example: string, home: string): Record<string, unknown> {
  mkdirSync(home, { recursive: true });
  const sourcePath = join(example, 'inputs', 'painting.png');
  const cfgPath = join(example, 'config.json');
  const cfg = loadEarlyConfig(cfgPath, 'assemble');
  const plan = cfg.assemble.plan.find(entry => entry[1] === 'full' && entry[2] === 'topwear');
  if (plan === undefined) throw new Error('public fixture requires a full-run topwear plan part');
  const source = readPng(sourcePath);
  const original = readLayers(join(example, 'inputs', 'layers', 'full'));
  const donor = original.layers.find(layer => layer.name === plan[2])!;
  const input = makeInputs(source, cfg, 'public fixture').full;
  const painting = resize(input, original.canvas.w, original.canvas.h, 'lanczos3');
  // Authored fixture tolerance, written into the very requirements the stage reads.
  const tolerance = 60;
  const mask = newMask(painting.width, painting.height);
  for (let y = donor.top; y < donor.bottom; y++) for (let x = donor.left; x < donor.right; x++) {
    const offset = ((y - donor.top) * donor.pixels.width + x - donor.left) * 4;
    if (donor.pixels.data[offset + 3] >= 128 && regionPaintingDelta(painting, donor.pixels, (y * painting.width + x) * 4, offset) <= tolerance) mask.data[y * mask.width + x] = 1;
  }
  const components = connectedComponents(mask, 8);
  const largest = components.stats.slice(1).sort((a, b) => b.area - a.area || a.label - b.label)[0];
  if (largest === undefined) throw new Error('public fixture has no matched component');
  const fullPath = join(home, 'full');
  cpSync(join(example, 'inputs', 'layers', 'full'), fullPath, { recursive: true });
  cpSync(join(example, 'inputs', 'layers', 'full'), join(home, 'donor'), { recursive: true });
  const base = { ...donor, pixels: { ...donor.pixels, data: new Uint8ClampedArray(donor.pixels.data) } };
  let seed: [number, number] | undefined;
  for (let p = 0; p < components.labels.length; p++) if (components.labels[p] === largest.label) {
    const x = p % mask.width, y = Math.floor(p / mask.width);
    seed ??= [x, y];
    base.pixels.data[((y - base.top) * base.pixels.width + x - base.left) * 4 + 3] = 0;
  }
  if (donor.file === null) throw new Error('public fixture requires a PNG wrapper run');
  const layerPath = join(fullPath, relative(dirname(original.source), donor.file));
  writePng(layerPath, base.pixels);
  writePng(join(home, 'st_input.png'), input);
  // Keep config-relative auxiliary inputs intact while changing only the take declaration.
  const raw = JSON.parse(readFileSync(cfgPath, 'utf8'));
  if (raw.generation?.control?.skeleton) raw.generation.control.skeleton = resolve(example, raw.generation.control.skeleton);
  raw.assemble.take = [{ run: 'full', run_dir: 'donor', st_input: 'st_input.png', part: plan[0], seed }];
  const config = join(home, 'config.json');
  writeFileSync(config, JSON.stringify(raw));
  const requirements = join(home, 'requirements.json');
  writeFileSync(requirements, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 1, requirements: [], setup_painting: { rgb_tolerance: tolerance, regions: [{ name: 'stage', box: [0, 0, source.width, source.height], max_pixels: 0 }] } }));
  const reading = deriveTakenRegion(base, donor, painting, seed!, tolerance, 'public fixture');
  let covered = 0, outside = 0;
  for (let y = reading.layer.top; y < reading.layer.bottom; y++) for (let x = reading.layer.left; x < reading.layer.right; x++) {
    const after = reading.layer.pixels.data[((y - reading.layer.top) * reading.layer.pixels.width + x - reading.layer.left) * 4 + 3];
    const oldOffset = ((y - base.top) * base.pixels.width + x - base.left) * 4;
    const before = x < base.left || x >= base.right || y < base.top || y >= base.bottom ? 0 : base.pixels.data[oldOffset + 3];
    if (components.labels[y * mask.width + x] === largest.label && after >= 128) covered++;
    if (before < 128 && after >= 128 && components.labels[y * mask.width + x] !== largest.label) outside++;
  }
  const notes: string[] = [];
  assembleStage({ source: sourcePath, full: fullPath, head: join(example, 'inputs', 'layers', 'head'), config, requirements }, outputs(join(home, 'assembled')), line => notes.push(line));
  const row = { planted_hole_px: largest.area, covered_px: covered, coverage_share: covered / largest.area, outside_derived_px: outside, ...reading.reading, notes: notes.filter(line => line.includes('region take')) };
  if (covered / largest.area < 0.95 || outside !== 0) throw new Error(JSON.stringify(row));
  writeFileSync(join(home, 'measurement.json'), JSON.stringify(row, null, 2));
  return row;
}

if (import.meta.main) {
  const baselineIndex = process.argv.indexOf('--baseline'), outIndex = process.argv.indexOf('--out');
  if (baselineIndex < 0 || outIndex < 0) throw new Error('requires --baseline <source snapshot> --out <evidence>');
  const baseline = resolve(process.argv[baselineIndex + 1]), out = resolve(process.argv[outIndex + 1]);
  const old = await import(pathToFileURL(join(baseline, 'src', 'build.ts')).href) as typeof import('../src/build.ts');
  const examples = resolve(import.meta.dir, '..', 'examples');
  const hashes = [];
  for (const key of ['demo', 'reference-demo', 'reference-sample', 'scarf', 'wind']) {
    const example = join(examples, key);
    const input = { source: join(example, 'inputs', 'painting.png'), full: join(example, 'inputs', 'layers', 'full'), head: join(example, 'inputs', 'layers', 'head'), config: join(example, 'config.json') };
    old.assembleStage(input, outputs(join(out, key, 'baseline')), () => {});
    assembleStage(input, outputs(join(out, key, 'current')), () => {});
    const before = fileHashes(join(out, key, 'baseline')), after = fileHashes(join(out, key, 'current'));
    const equal = JSON.stringify(before) === JSON.stringify(after);
    const aggregate = createHash('sha256').update(JSON.stringify(after)).digest('hex');
    hashes.push({ example: key, equal, aggregate_sha256: aggregate, files: after });
    console.log(JSON.stringify(hashes.at(-1)));
    if (!equal) throw new Error(`no-region byte control failed on ${key}`);
  }
  const publicRegion = measurePublicRegion(join(examples, 'demo'), join(out, 'public-hole'));
  writeFileSync(join(out, 'report.json'), JSON.stringify({ hashes, publicRegion }, null, 2));
  console.log(JSON.stringify(publicRegion));
}
