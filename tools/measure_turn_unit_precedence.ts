/** Reproducible synthetic C3 receipts; gates and rendering are explicit Nova commands. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { UNIT_PRECEDENCE_MODES, unitPrecedenceFixture } from '../fixtures/turn_unit_precedence.ts';
import { readRigInputs, rigOutputTexts } from '../src/build.ts';
import { buildRig } from '../src/rig.ts';
import { writeParts } from '../src/parts.ts';
import { readPng, writePng } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
import { parseRigSpec } from '@rig-c/core/rig';
import { parseMotionSpec } from '@rig-c/core/motion';
import { readModel, poseRawSetup, poseRawAnimation } from '@rig-c/core/core';
import { loadCandidate } from '@rig-c/core/render-shared';
import { emittedUnitDepths, runTurnUnitPrecedenceChecks } from './check_turn_unit_precedence.ts';

const [mode, input, output] = process.argv.slice(2);
if (mode === '--help') {
  console.log('bun tools/measure_turn_unit_precedence.ts --prepare|--dry-read|--measure|--targeted|--pictures <input-dir> [output-dir]');
  process.exit(0);
}
if (!input || !['--prepare', '--dry-read', '--measure', '--targeted', '--pictures'].includes(mode)) throw new Error('use --help for the exact modes');
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
if (mode === '--prepare') {
  const rows = [];
  for (const key of UNIT_PRECEDENCE_MODES) {
    const f = unitPrecedenceFixture(key), home = join(input, key);
    mkdirSync(join(home, 'parts'), { recursive: true });
    save(join(home, 'config.json'), f.config); writeParts(join(home, 'parts.json'), f.parts);
    for (const p of f.parts.parts) {
      writePng(join(home, 'parts', `${p.name}.png`), f.images.get(p.name)!);
      if (p.depth) writePng(join(home, 'parts', p.depth.image), f.images.get(p.depth.image)!);
    }
    const { cfg, parts, images } = readRigInputs(join(home, 'config.json'), home), b = buildRig(cfg, parts, images), rig = join(home, 'rig');
    mkdirSync(join(rig, 'images'), { recursive: true });
    for (const [name, text] of rigOutputTexts(b, null)) writeFileSync(join(rig, name), text);
    for (const [name, image] of b.images) writePng(join(rig, 'images', name), image);
    parseRigSpec(JSON.parse(readFileSync(join(rig, 'rig.json'), 'utf8')), key);
    parseMotionSpec(JSON.parse(readFileSync(join(rig, 'motion.json'), 'utf8')), key);
    rows.push({ key, readers: 'readRigInputs -> buildRig -> Core parseRigSpec + parseMotionSpec', exit: 0 });
  }
  save(join(input, 'readers.json'), rows); console.log(JSON.stringify({ prepared: rows.length, exit: 0 }));
} else if (mode === '--dry-read') {
  const rows = [];
  for (const key of UNIT_PRECEDENCE_MODES) {
    const home = resolve(input, key, 'built');
    readModel(readFileSync(join(home, 'skeleton.model.json'), 'utf8'));
    const candidate = loadCandidate({ skeletonText: readFileSync(join(home, 'skeleton.json'), 'utf8'), atlasText: readFileSync(join(home, 'skeleton.atlas'), 'utf8'), atlasDir: home, label: key }, { skeleton: join(home, 'skeleton.json'), atlas: join(home, 'skeleton.atlas') }, 'core');
    rows.push({ key, core: candidate.choice.core !== null, path: home });
  }
  save(join(input, 'downstream-readers.json'), rows); console.log(JSON.stringify({ read: rows.length, core: rows.every(r => r.core), exit: 0 }));
} else if (mode === '--targeted') {
  mkdirSync(input, { recursive: true });
  let passed = 0, failed = 0;
  const rows: Array<{ name: string; ok: boolean; detail: string }> = [];
  const say = (name: string, ok: boolean, detail: string) => { if (ok) passed++; else failed++; rows.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); };
  runTurnUnitPrecedenceChecks(say);
  save(join(input, 'targeted.json'), { passed, failed, rows }); console.log(`TARGETED passed=${passed} failed=${failed}`); process.exitCode = failed ? 1 : 0;
} else if (mode === '--measure') {
  if (!output) throw new Error('measurement requires output-dir'); mkdirSync(output, { recursive: true });
  const rows = [];
  for (const key of UNIT_PRECEDENCE_MODES) {
    const home = join(input, key), { cfg, parts, images } = readRigInputs(join(home, 'config.json'), home), b = buildRig(cfg, parts, images);
    const doc = readModel(readFileSync(join(home, 'built/skeleton.model.json'), 'utf8')), rest = poseRawSetup(doc), duration = (b.motion.animations.turn as { duration: number }).duration;
    const poses = poseRawAnimation(doc, 'turn', [duration / 2, duration / 2]);
    rows.push({ key, depths: emittedUnitDepths(b), poses: poses.map((p, i) => ({ pose: ['min', 'neutral', 'max'][i], time: p.animationTime, units: ['token_r', 'token_l'].map(slot => ({ slot, vertices: p.drawn.find(d => d.slot === slot)!.vertices, rest: rest.drawn.find(d => d.slot === slot)!.vertices })) })) });
  }
  save(join(output, 'measurements.json'), rows); console.log(JSON.stringify(rows));
} else if (mode === '--pictures') {
  if (!output) throw new Error('picture receipts require output-dir'); mkdirSync(output, { recursive: true });
  const rows: Array<{ key: string; path: string; sha256: string; nativePanel: number[]; classification: string }> = [];
  for (const key of UNIT_PRECEDENCE_MODES) {
    const source = join(input, key, 'turn@16fps', 'extremes.png'), p = readPng(source), home = join(output, key); mkdirSync(home, { recursive: true });
    const add = (name: string, image: ReturnType<typeof newRaster>) => { const path = join(home, name); writePng(path, image); rows.push({ key, path: resolve(path), sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), nativePanel: [80, 80], classification: 'synthetic only' }); };
    for (const [i, name] of ['rest', 'min', 'max', 'diff', 'min-rest', 'max-rest'].entries()) {
      const q = newRaster(80, 80); for (let y = 0; y < 80; y++) q.data.set(p.data.subarray((y * p.width + i * 80) * 4, (y * p.width + i * 80 + 80) * 4), y * 80 * 4); add(name + '.png', q);
    }
    const contact = newRaster(240, 80); for (let y = 0; y < 80; y++) contact.data.set(p.data.subarray(y * p.width * 4, (y * p.width + 240) * 4), y * 240 * 4); add('rest-min-max.png', contact);
    const nn = newRaster(960, 320); for (let y = 0; y < 320; y++) for (let x = 0; x < 960; x++) { const at = (Math.floor(y / 4) * 240 + Math.floor(x / 4)) * 4; nn.data.set(contact.data.subarray(at, at + 4), (y * 960 + x) * 4); } add('boundaries-4x-nn.png', nn);
  }
  save(join(output, 'pictures.json'), rows); console.log(JSON.stringify({ pictures: rows.length, sets: UNIT_PRECEDENCE_MODES.length }));
}
