/** Reproducible synthetic #825 pixel attribution. Run on the render pool. */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { assemble, projectSource, checkGeometry, layerToRig, sourceInRig, planRanks } from '../src/assemble.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { crop } from '../src/raster/index.ts';
import { readPng } from '../src/raster/png.ts';
import { softOccluderFixture, softTrailDiff, yieldLimbCoverFixture, SOFT_BAND, SOFT_SIZE, SOFT_SKIN } from '../fixtures/soft_occluder.ts';

const out = resolve(process.argv[2] ?? 'render/soft-occluder');
mkdirSync(out, { recursive: true });
const input = softOccluderFixture();
const result = assemble(input);
const under = result.images.find(p => p.record.name === 'under')!;
const frame = checkGeometry({ sourceW: SOFT_SIZE, sourceH: SOFT_SIZE, resolution: SOFT_SIZE, headBox: input.headBox, rigScale: 1 });
const projected = input.full.layers.map(l => layerToRig(l.pixels, frame, 'full'));
const stats = projectSource(projected, sourceInRig(input.source, SOFT_SIZE, SOFT_SIZE), frame, 'full', 'core', planRanks(input.full.layers.map(l => l.name), 'full', input.plan));
const rows = [];
for (let y = SOFT_BAND[1]; y < SOFT_BAND[3]; y++) for (let x = SOFT_BAND[0]; x < SOFT_BAND[2]; x++) {
  const q = ((y - under.record.y) * under.record.w + x - under.record.x) * 4;
  const rgba = Array.from(under.image.data.subarray(q, q + 4));
  const p = y * SOFT_SIZE + x;
  const afterProjection = Array.from(projected[0].data.subarray(p * 4, p * 4 + 4));
  rows.push({ x, y, own: [...SOFT_SKIN], coverAlpha: input.full.layers[1].pixels.data[p * 4 + 3], painting: Array.from(input.source.data.subarray(p * 4, p * 4 + 4)), afterProjection, originalRefused: stats[0].refusedMask?.data[p] === 1, closingRetookRefusal: stats[0].refusedMask?.data[p] === 1 && stats[0].takenMask.data[p] === 1, seamChanged: rgba.some((v, c) => v !== afterProjection[c]), final: rgba, changed: rgba.some((v, c) => v !== SOFT_SKIN[c]) });
}
writeFileSync(join(out, 'under.png'), encodePngBytes(under.image));
writeFileSync(join(out, 'painting.png'), encodePngBytes(input.source));
writeFileSync(join(out, 'recomposite.png'), encodePngBytes(result.recomposite));
writeFileSync(join(out, 'pixels.json'), JSON.stringify(rows, null, 2) + '\n');
console.log(JSON.stringify({ band: SOFT_BAND, changed: rows.filter(p => p.changed).length, total: rows.length, provenance: under.record.provenance, parts: result.parts.parts.map(p => ({ name: p.name, core: p.projected_core_px, taken: p.source_px_taken, refused: p.refused_drift_px, seam: p.seam_override_px })) }, null, 2));

if (process.argv.includes('--render')) {
  const run = (args: string[]) => {
    const r = spawnSync('bun', [fileURLToPath(import.meta.resolve('@rig-c/core/cli')), ...args], { encoding: 'utf8' });
    writeFileSync(join(out, `command-${command++}.log`), `${JSON.stringify(args)}\n${r.stdout}${r.stderr}`);
    if (r.status !== 0) throw new Error(`rigc ${args[0]} exit ${r.status}: ${r.stderr || r.stdout}`);
  };
  let command = 0;
  const variants = ['off', 'on', 'oracle', 'opaque-off', 'opaque-on', 'none-off', 'none-on'] as const;
  const measurements: Record<string, unknown> = {};
  for (const variant of variants) {
    const edge = variant.startsWith('opaque') ? 'opaque' : variant.startsWith('none') ? 'none' : 'soft';
    const fixture = softOccluderFixture(edge), enabled = variant === 'on' || variant.endsWith('-on');
    const r = assemble({ ...fixture, ...(enabled ? { keepUnderOccluders: ['under'] } : {}) });
    const d = join(out, variant), images = join(d, 'images');
    mkdirSync(images, { recursive: true });
    const skins: Record<string, Record<string, object>> = {};
    for (const p of r.images) {
      let image = p.image;
      if (variant === 'oracle' && p.record.name === 'under') image = crop(fixture.full.layers[0].pixels, p.record.x, p.record.y, p.record.w, p.record.h);
      writeFileSync(join(images, p.record.name + '.png'), encodePngBytes(image));
      const moving = p.record.name === 'under';
      skins[p.record.name] = { [p.record.name]: { image: p.record.name + '.png', x: p.record.x + p.record.w / 2 - (moving ? 44 : 0), y: SOFT_SIZE - p.record.y - p.record.h / 2 - (moving ? SOFT_SIZE - 34 : 0) } };
    }
    writeFileSync(join(d, 'rig.json'), JSON.stringify({ spec: 'rigc-rig/1', name: 'soft-occluder', images: 'images', skeleton: { x: 0, y: 0, width: SOFT_SIZE, height: SOFT_SIZE }, bones: [{ name: 'root', x: 0, y: 0 }, { name: 'moving', parent: 'root', x: 44, y: SOFT_SIZE - 34 }], slots: r.images.map(p => ({ name: p.record.name, bone: p.record.name === 'under' ? 'moving' : 'root', attachment: p.record.name })), skins: { default: skins } }, null, 2));
    writeFileSync(join(d, 'motion.json'), JSON.stringify({ spec: 'rigc-motion/1', archetype: 'soft-occluder', cut: 'soft-occluder', easings: {}, groups: {}, animations: { rotate: { duration: 1, loop: false, tracks: [{ bone: 'moving', property: 'rotate', keys: [{ t: 0, v: [0] }, { t: 0.75, v: [30] }, { t: 1, v: [30] }] }] } } }, null, 2));
    run(['build', '--rig', join(d, 'rig.json'), '--motion', join(d, 'motion.json'), '--out', join(d, 'build')]);
    run(['render', '--candidate', join(d, 'build'), '--out', join(d, 'frames'), '--fps', '4', '--viewport', '0,0,96,96', '--max', '96', '--extremes']);
    const extremes = JSON.parse(readFileSync(join(d, 'frames/rotate@4fps/extremes.json'), 'utf8'));
    if (extremes.status !== 'READ') throw new Error(JSON.stringify(extremes));
    const plate = readPng(join(d, 'frames/rotate@4fps/extremes.png'));
    if (plate.width !== SOFT_SIZE * 6) throw new Error('native render grid differs');
    for (const [i, panel] of ['setup', 'min', 'max', 'absdiff'].entries()) writeFileSync(join(d, panel + '.png'), encodePngBytes(crop(plate, i * SOFT_SIZE, 0, SOFT_SIZE, SOFT_SIZE)));
    measurements[variant] = { roi: softTrailDiff(r.images.find(p => p.record.name === 'under')!), extremes };
  }
  const nativeRoi: Record<string, { changed: number; population: number }> = {};
  for (const variant of ['off', 'on', 'oracle']) {
    const min = readPng(join(out, variant, 'min.png')), max = readPng(join(out, variant, 'max.png'));
    let changed = 0, population = 0;
    for (let y = 42; y < 50; y++) for (let x = 32; x < 56; x++) {
      const dx = x + 0.5 - 44, dy = y + 0.5 - 34;
      const sx = 44 + dx * Math.sqrt(3) / 2 - dy / 2, sy = 34 + dx / 2 + dy * Math.sqrt(3) / 2;
      if (sx < 34 || sx >= 54 || sy < 36 || sy >= 42) continue;
      population++;
      const p = (y * SOFT_SIZE + x) * 4;
      if ([0, 1, 2, 3].some(c => min.data[p + c] !== max.data[p + c])) changed++;
    }
    nativeRoi[variant] = { changed, population };
  }
  let onOracleDifferent = 0;
  for (const panel of ['setup', 'min', 'max', 'absdiff']) {
    const on = readPng(join(out, 'on', panel + '.png')), oracle = readPng(join(out, 'oracle', panel + '.png'));
    for (let p = 0; p < on.data.length; p += 4) if ([0, 1, 2, 3].some(c => on.data[p + c] !== oracle.data[p + c])) onOracleDifferent++;
  }
  measurements.nativeRoi = nativeRoi;
  measurements.onOracleDifferent = onOracleDifferent;
  writeFileSync(join(out, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
  console.log(JSON.stringify({ nativeRoi, onOracleDifferent }));
  if (nativeRoi.off.changed === 0 || nativeRoi.on.changed !== 0 || nativeRoi.oracle.changed !== 0 || onOracleDifferent !== 0) throw new Error('native extrema assertion failed');
}

if (process.argv.includes('--red-origin')) {
  const origin = process.argv[process.argv.indexOf('--red-origin') + 1];
  const old = await import(pathToFileURL(join(resolve(origin), 'src/assemble.ts')).href);
  const previous = old.assemble(softOccluderFixture());
  const reading = softTrailDiff(previous.images.find((p: { record: { name: string } }) => p.record.name === 'under'));
  const assertion = { assertion: 'rotating hem abs(max-min) ROI must have zero travelling ink', expected: 0, actual: reading.count, population: reading.population, alphaHoles: reading.alphaHoles, baseline: 'API origin' };
  writeFileSync(join(out, 'red-assertion.json'), JSON.stringify(assertion, null, 2) + '\n');
  console.log(JSON.stringify(assertion));
  if (reading.count !== 0) process.exit(1);
}

if (process.argv.includes('--combined-origin')) {
  const origin = process.argv[process.argv.indexOf('--combined-origin') + 1];
  const old = await import(pathToFileURL(join(resolve(origin), 'src/assemble.ts')).href);
  const previous = old.assemble(yieldLimbCoverFixture());
  const current = assemble(yieldLimbCoverFixture());
  // A private copy is the planted negative; source and dependencies stay intact.
  const text = readFileSync(resolve('src/assemble.ts'), 'utf8');
  if (!text.includes('if (keptRetake[orderIdx]?.data[p] === 1)')) throw new Error('combined guard not found');
  const mutant = text.replace('if (keptRetake[orderIdx]?.data[p] === 1)', 'if (keepInOrder[orderIdx]?.data[p] === 1)').replaceAll("from './", "from '../src/");
  if (mutant === text) throw new Error('combined guard mutant was not planted');
  // Keep the copy directly below render so relative source imports are exact.
  const copyPath = resolve('render/mutant-assemble825.ts');
  writeFileSync(copyPath, mutant);
  const faulty = await import(pathToFileURL(copyPath).href);
  const planted = faulty.assemble(yieldLimbCoverFixture());
  const equal = (a: typeof current, b: typeof current): boolean => JSON.stringify(a.parts) === JSON.stringify(b.parts) && a.images.length === b.images.length && a.images.every((p, i) => Buffer.compare(Buffer.from(encodePngBytes(p.image)), Buffer.from(encodePngBytes(b.images[i].image))) === 0);
  const reading = { originEqualsCurrent: equal(previous, current), mutantEqualsCurrent: equal(planted, current), origin: previous.yieldReadings, current: current.yieldReadings, mutant: planted.yieldReadings, mutantCopy: 'render/mutant-assemble825.ts' };
  writeFileSync(join(out, 'combined-old-path.json'), JSON.stringify(reading, null, 2) + '\n');
  console.log(JSON.stringify(reading));
  if (!reading.originEqualsCurrent) throw new Error('combined default-off old-path control failed');
}
