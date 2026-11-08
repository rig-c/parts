/**
 * Controls for the step-4 plate producer (issue #1183), judged on what the
 * comfy harness (`fixtures/comfyharness.ts`) left in its work directory: every
 * scenario ran the CLI against the fake ComfyUI on 127.0.0.1, never a real box.
 *
 * The selftest's comfy suite calls `runPlateChecks` with the harness's
 * results; run alone it starts the harness itself:
 *
 *   bun tools/check_plate.ts <work dir>
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FAKE_FILL } from '../fixtures/fakecomfy.ts';
import { assembleConfig } from '../fixtures/assemble_fixture.ts';
import { runOccluderChainChecks } from './check_occluders.ts';
import { cutFillMask } from '../src/assemble.ts';
import { assembleStage } from '../src/build.ts';
import { parseEarlyConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { exportLayers } from '../src/layers.ts';
import { readParts } from '../src/parts.ts';
import { PLATE_RECEIPT_KEYS, PLATE_RECEIPT_OCCLUDER_KEYS, PLATE_RECEIPT_SPEC, runForeground, sha256, verifyPlateReceipt } from '../src/plate.ts';
import { decodePngBytes, encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { readLayerTag } from '../src/tags.ts';

export interface PlateHarnessResult {
  status: number;
  out: string;
  paths: string[];
  uploads: string[];
  prompts: number;
  fronts?: number;
}

type Say = (name: string, pass: boolean, detail: string, why: string) => void;

function failLine(out: string, code: string): string | null {
  return out.split('\n').find((l) => l.includes(`FAIL  ${code}`))?.trim() ?? null;
}

/** Each source plant is restored byte for byte, then accepted through the CLI's foreground entry point. */
function figureBindingChecks(dir: string, painting: string, say: Say): void {
  const root = join(dir, 'plate_figure_source');
  const rig = join(root, 'rig');
  const stampPath = join(root, 'run.json');
  const partsPath = join(rig, 'parts.json');
  const maskPath = join(rig, 'figure_rig.png');
  const paintingPath = join(rig, 'painting_in_rig.png');
  const files = [stampPath, partsPath, maskPath, paintingPath];
  const original = files.map(file => readFileSync(file));
  const md5 = (): string[] => files.map(file => existsSync(file) ? createHash('md5').update(readFileSync(file)).digest('hex') : 'absent');
  const before = md5();
  const stamp = JSON.parse(original[0].toString()) as { spec: string; command: string; outputs: Array<{ path: string; sha256: string }> };
  const parts = JSON.parse(original[1].toString()) as { painting_in_rig: { path: string; sha256: string; resample: string } };
  const writeStamp = (change: (s: typeof stamp) => void): void => {
    const s = structuredClone(stamp);
    change(s);
    writeFileSync(stampPath, JSON.stringify(s));
  };
  const restamp = (path: string): void => writeStamp(s => {
    const entry = s.outputs.find(e => e.path === `rig/${path}`)!;
    entry.sha256 = sha256(readFileSync(join(rig, path)));
  });
  const plants: Array<{ name: string; code: string; plant: () => void }> = [
    { name: 'missing-run', code: 'PLATE_MASK_RUN', plant: () => rmSync(stampPath) },
    { name: 'malformed-run', code: 'PLATE_MASK_RUN', plant: () => writeFileSync(stampPath, '{') },
    { name: 'null-run', code: 'PLATE_MASK_RUN', plant: () => writeFileSync(stampPath, 'null') },
    { name: 'wrong-spec', code: 'PLATE_MASK_RUN', plant: () => writeStamp(s => { s.spec = 'rig-run/0'; }) },
    { name: 'wrong-command', code: 'PLATE_MASK_RUN', plant: () => writeStamp(s => { s.command = 'rig'; }) },
    { name: 'missing-outputs', code: 'PLATE_MASK_RUN', plant: () => writeFileSync(stampPath, JSON.stringify({ ...stamp, outputs: null })) },
    { name: 'missing-entry', code: 'PLATE_MASK_RUN', plant: () => writeStamp(s => { s.outputs = s.outputs.filter(e => e.path !== 'rig/figure_rig.png'); }) },
    { name: 'duplicate-entry', code: 'PLATE_MASK_RUN', plant: () => writeStamp(s => { s.outputs.push(s.outputs.find(e => e.path === 'rig/figure_rig.png')!); }) },
    { name: 'stale-mask', code: 'PLATE_MASK_RUN', plant: () => {
      const r = decodePngBytes(original[2], maskPath);
      r.data.set([255, 255, 255, 255], 0);
      writeFileSync(maskPath, encodePngBytes(r));
    } },
    { name: 'stale-parts', code: 'PLATE_MASK_RUN', plant: () => writeFileSync(partsPath, JSON.stringify({ ...parts, painting_in_rig: undefined })) },
    { name: 'bad-painting-declaration', code: 'PLATE_MASK_PAINTING', plant: () => {
      writeFileSync(partsPath, JSON.stringify({ ...parts, painting_in_rig: { ...parts.painting_in_rig, path: '../other.png' } }));
      restamp('parts.json');
    } },
    { name: 'missing-recorded-painting', code: 'PLATE_MASK_PAINTING', plant: () => rmSync(paintingPath) },
    { name: 'stale-recorded-painting', code: 'PLATE_MASK_RUN', plant: () => writeFileSync(paintingPath, 'stale') },
    { name: 'unstamped-recorded-painting', code: 'PLATE_MASK_RUN', plant: () => writeStamp(s => { s.outputs = s.outputs.filter(e => e.path !== 'rig/painting_in_rig.png'); }) },
    { name: 'undecodable-recorded-painting', code: 'PLATE_MASK_PAINTING', plant: () => {
      writeFileSync(paintingPath, 'not a PNG');
      writeFileSync(partsPath, JSON.stringify({ ...parts, painting_in_rig: { ...parts.painting_in_rig, sha256: sha256(readFileSync(paintingPath)) } }));
      writeStamp(s => {
        for (const file of ['parts.json', 'painting_in_rig.png']) s.outputs.find(e => e.path === `rig/${file}`)!.sha256 = sha256(readFileSync(join(rig, file)));
      });
    } },
    { name: 'declaration-hash-mismatch', code: 'PLATE_MASK_PAINTING', plant: () => {
      writeFileSync(partsPath, JSON.stringify({ ...parts, painting_in_rig: { ...parts.painting_in_rig, sha256: '0'.repeat(64) } }));
      restamp('parts.json');
    } },
  ];
  const evidence: unknown[] = [];
  const run = (name: string): void => { runForeground({ painting, maskFrom: `figure-mask:${rig}`, out: join(dir, `binding-${name}`) }); };
  for (const p of plants) {
    let message = '', restoredGreen = false;
    let planted: string[] = [];
    try {
      p.plant();
      planted = md5();
      try { run(p.name); } catch (err) { message = (err as Error).message; }
    } finally {
      files.forEach((file, i) => writeFileSync(file, original[i]));
    }
    const restored = md5();
    try { run(`${p.name}-restored`); restoredGreen = true; } catch (err) { message += ` restored: ${(err as Error).message}`; }
    const pass = message.includes(p.code) && !existsSync(join(dir, `binding-${p.name}`)) && restoredGreen && restored.join(',') === before.join(',');
    evidence.push({ name: p.name, files, before, planted, restored, message, restoredGreen, pass });
    say(`PB07_FIGURE_SOURCE_${p.name.toUpperCase().replaceAll('-', '_')}_IS_REFUSED_AND_RESTORED`, pass,
      `${p.code}: ${message}; restored accepted ${restoredGreen}; md5 before ${before.join(',')} planted ${planted.join(',')} restored ${restored.join(',')}`,
      'issue #1188: an unstamped or stale source is refused before a plate is written; the restored source is accepted');
  }
  const other = join(dir, 'binding-other-painting.png');
  const r = decodePngBytes(readFileSync(painting), painting);
  r.data[0] ^= 1;
  writeFileSync(other, encodePngBytes(r));
  let message = '';
  try { runForeground({ painting: other, maskFrom: `figure-mask:${rig}`, out: join(dir, 'binding-other-painting') }); }
  catch (err) { message = (err as Error).message; }
  say('PB08_A_DIFFERENT_PAINTING_ON_THE_SAME_GRID_IS_REFUSED', message.includes('PLATE_MASK_PAINTING') && !existsSync(join(dir, 'binding-other-painting')),
    message, 'issue #1188: the stamped painting_in_rig binds decoded opaque RGB, using assemble\'s own conversion');
  const equivalent = join(dir, 'binding-equivalent-painting.png');
  const rgba = decodePngBytes(readFileSync(painting), painting);
  for (let i = 3; i < rgba.data.length; i += 4) rgba.data[i] = 0;
  writeFileSync(equivalent, encodePngBytes(rgba));
  let equivalentGreen = false;
  try {
    runForeground({ painting: equivalent, maskFrom: `figure-mask:${rig}`, out: join(dir, 'binding-equivalent-painting') });
    equivalentGreen = true;
  } catch (err) { message = (err as Error).message; }
  say('PB10_THE_PAINTING_BINDING_USES_ASSEMBLES_OPAQUE_RGB', equivalentGreen,
    equivalentGreen ? 'identical RGB with alpha 0 accepted against the recorded opaque RGB; another RGB value was refused by PB08' : message,
    'painting_in_rig records assemble\'s opaque RGB, so source PNG bytes and source alpha are not its identity');
  writeFileSync(join(dir, 'figure-binding-evidence.json'), JSON.stringify(evidence, null, 2));
}

/** Each seethrough: source plant is restored byte for byte, then accepted through the CLI's foreground entry point. */
function seethroughBindingChecks(dir: string, painting: string, say: Say): void {
  const root = join(dir, 'st-ok');
  const metaPath = join(root, 'meta.json');
  const layersPath = join(root, 'layers.json');
  const facePath = join(root, 'parts', 'face.png');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    image_sha256: string;
    layers: Array<{ path: string; sha256: string }>;
    [k: string]: unknown;
  };
  const files = [metaPath, layersPath, ...meta.layers.map((e) => join(root, e.path))];
  const original = files.map((file) => readFileSync(file));
  const md5 = (): string[] => files.map((file) => existsSync(file) ? createHash('md5').update(readFileSync(file)).digest('hex') : 'absent');
  const before = md5();
  const writeMeta = (change: (m: typeof meta) => void): void => {
    const m = structuredClone(meta);
    change(m);
    writeFileSync(metaPath, JSON.stringify(m));
  };
  const plants: Array<{ name: string; code: string; plant: () => void }> = [
    { name: 'missing-meta', code: 'PLATE_MASK_RUN', plant: () => rmSync(metaPath) },
    { name: 'malformed-meta', code: 'PLATE_MASK_RUN', plant: () => writeFileSync(metaPath, '{') },
    { name: 'null-meta', code: 'PLATE_MASK_RUN', plant: () => writeFileSync(metaPath, 'null') },
    { name: 'legacy-meta', code: 'PLATE_MASK_RUN', plant: () => {
      const m = structuredClone(meta) as Record<string, unknown>;
      delete m.image_sha256;
      delete m.layers;
      writeFileSync(metaPath, JSON.stringify(m));
    } },
    { name: 'bad-layer-entry', code: 'PLATE_MASK_RUN', plant: () => writeMeta((m) => { m.layers[0] = { path: '', sha256: 'bad' }; }) },
    { name: 'missing-layer-hash', code: 'PLATE_MASK_RUN', plant: () => writeMeta((m) => { m.layers = m.layers.filter((e) => e.path !== 'parts/face.png'); }) },
    { name: 'duplicate-layer-hash', code: 'PLATE_MASK_RUN', plant: () => writeMeta((m) => { m.layers.push(m.layers.find((e) => e.path === 'parts/face.png')!); }) },
    { name: 'extra-layer-hash', code: 'PLATE_MASK_RUN', plant: () => writeMeta((m) => { m.layers.push({ path: 'parts/extra.png', sha256: '0'.repeat(64) }); }) },
    { name: 'tampered-layer', code: 'PLATE_MASK_RUN', plant: () => {
      const r = decodePngBytes(original[files.indexOf(facePath)], facePath);
      r.data[0] ^= 1;
      writeFileSync(facePath, encodePngBytes(r));
    } },
    { name: 'other-painting', code: 'PLATE_MASK_PAINTING', plant: () => writeMeta((m) => { m.image_sha256 = '0'.repeat(64); }) },
  ];
  const evidence: unknown[] = [];
  const run = (name: string): void => { runForeground({ painting, maskFrom: `seethrough:${root}`, out: join(dir, `st-binding-${name}`) }); };
  for (const p of plants) {
    let message = '', restoredGreen = false;
    let planted: string[] = [];
    try {
      p.plant();
      planted = md5();
      try { run(p.name); } catch (err) { message = (err as Error).message.replaceAll('\n', ' '); }
    } finally {
      files.forEach((file, i) => writeFileSync(file, original[i]));
    }
    const restored = md5();
    try { run(`${p.name}-restored`); restoredGreen = true; } catch (err) { message += ` restored: ${(err as Error).message.replaceAll('\n', ' ')}`; }
    const detail = `${p.code}: ${message}; restored accepted ${restoredGreen}; md5 before ${before.join(',')} planted ${planted.join(',')} restored ${restored.join(',')}`;
    const pass = message.includes(p.code) && !existsSync(join(dir, `st-binding-${p.name}`)) && restoredGreen && restored.join(',') === before.join(',') && !detail.includes('\n');
    evidence.push({ name: p.name, files, before, planted, restored, message, restoredGreen, pass });
    say(`PB11_SEETHROUGH_SOURCE_${p.name.toUpperCase().replaceAll('-', '_')}_IS_REFUSED_AND_RESTORED`, pass,
      detail,
      'issue #1188: an unstamped, legacy, tampered or mismatched seethrough: source is refused before a plate is written; the restored source is accepted');
  }
  writeFileSync(join(dir, 'seethrough-binding-evidence.json'), JSON.stringify(evidence, null, 2));
}

/** Pixels outside the receipt's mask that differ from the painting, and pixels inside it that are not the fake's fill. */
function pasteBack(dir: string, painting: string): { outsideDiff: number; insideWrong: number; inside: number } | null {
  try {
    const p = decodePngBytes(new Uint8Array(readFileSync(painting)), painting);
    const m = decodePngBytes(new Uint8Array(readFileSync(join(dir, 'mask.png'))), 'mask');
    const o = decodePngBytes(new Uint8Array(readFileSync(join(dir, 'plate.png'))), 'plate');
    let outsideDiff = 0, insideWrong = 0, inside = 0;
    for (let i = 0; i < p.width * p.height; i++) {
      if (m.data[i * 4] === 255) {
        inside++;
        if (o.data[i * 4] !== FAKE_FILL[0] || o.data[i * 4 + 1] !== FAKE_FILL[1] || o.data[i * 4 + 2] !== FAKE_FILL[2] || o.data[i * 4 + 3] !== 255) insideWrong++;
      } else if ([0, 1, 2, 3].some((c) => o.data[i * 4 + c] !== p.data[i * 4 + c])) outsideDiff++;
    }
    return { outsideDiff, insideWrong, inside };
  } catch {
    return null;
  }
}

/** The receipt fields the occluder controls read. */
interface OccluderReceipt {
  mode?: string;
  painting?: { sha256?: string };
  occluder?: { path?: string; sha256?: string };
  mask?: { source?: string; sha256?: string };
  output?: { sha256?: string };
  params?: { grow_px?: number; holes?: boolean; mask_alpha_above?: number };
  model?: { name?: string; checkpoint_sha256?: string };
}

/**
 * Issue #1230: `--mode occluder`. The receipt binds the painting, the occluder, the mask bytes, grow, holes and the
 * model; the mask is the occluder's alpha above 0 grown 1 px (the ring's pocket filled only under --holes); the plate
 * is the painting outside the mask and the box's fill inside it; an occluder off the painting's grid is refused by
 * name before any request.
 */
function occluderChecks(dir: string, painting: string, R: Record<string, PlateHarnessResult>, say: Say): void {
  const hash = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
  const occluderPath = join(dir, 'plate_occluder.png');
  const paintingPx = decodePngBytes(new Uint8Array(readFileSync(painting)), painting);
  // The ring is 8x8 at [20, 10] with a 4x4 pocket: grown 1 px it is the 10x10 square (100 px) with the pocket filled,
  // and the square less the pocket eroded 1 px (2x2) without.
  const expected = { 'plate-occ-holes': { px: 100, holes: true }, 'plate-occ-ring': { px: 96, holes: false } } as const;
  const lines: string[] = [];
  let ok = true;
  for (const [name, want] of Object.entries(expected)) {
    const r = R[name];
    const out = join(dir, name);
    const receiptFile = join(out, 'receipt.json');
    if (r?.status !== 0 || !existsSync(receiptFile)) { ok = false; lines.push(`${name}: exit ${r?.status}, ${r?.out.trim().split('\n').pop()}`); continue; }
    const rec = JSON.parse(readFileSync(receiptFile, 'utf8')) as OccluderReceipt;
    const mask = decodePngBytes(new Uint8Array(readFileSync(join(out, 'mask.png'))), 'mask.png');
    const plate = decodePngBytes(new Uint8Array(readFileSync(join(out, 'plate.png'))), 'plate.png');
    let inside = 0, outsideDiffer = 0, insideNotFill = 0;
    for (let p = 0; p < mask.width * mask.height; p++) {
      const m = mask.data[p * 4] === 255;
      if (m) inside++;
      if (!m && [0, 1, 2, 3].some((c) => plate.data[p * 4 + c] !== paintingPx.data[p * 4 + c])) outsideDiffer++;
      if (m && (plate.data[p * 4] !== FAKE_FILL[0] || plate.data[p * 4 + 1] !== FAKE_FILL[1] || plate.data[p * 4 + 2] !== FAKE_FILL[2])) insideNotFill++;
    }
    const bound = rec.mode === 'occluder' && Object.keys(rec).join(',') === PLATE_RECEIPT_OCCLUDER_KEYS.join(',') &&
      rec.painting?.sha256 === hash(painting) && rec.occluder?.sha256 === hash(occluderPath) && rec.occluder?.path === '../plate_occluder.png' &&
      rec.mask?.source === 'occluder' && rec.mask?.sha256 === hash(join(out, 'mask.png')) && rec.output?.sha256 === hash(join(out, 'plate.png')) &&
      rec.params?.grow_px === 1 && rec.params?.holes === want.holes && rec.params?.mask_alpha_above === 0 &&
      rec.model?.name === 'big-lama.pt' && rec.model?.checkpoint_sha256 === 'ab'.repeat(32) && verifyPlateReceipt(receiptFile).length === 0;
    if (!bound || inside !== want.px || outsideDiffer !== 0 || insideNotFill !== 0) ok = false;
    lines.push(`${name}: receipt keys ${Object.keys(rec).join(',')}, occluder ${rec.occluder?.path} ${rec.occluder?.sha256 === hash(occluderPath) ? 'sha matches' : 'sha DIFFERS'}, mask ${inside} px (want ${want.px}), holes ${rec.params?.holes}, grow ${rec.params?.grow_px}, model ${rec.model?.name}; outside differing ${outsideDiffer}, inside not fill ${insideNotFill}; bound ${bound}`);
  }
  say('PB15_OCCLUDER_MODE_RECEIPT_BINDS_PAINTING_OCCLUDER_MASK_GROW_HOLES_AND_MODEL', ok, lines.join('; '),
    'issue #1230: the occluder plate is the source of hidden surface behind a declared occluder, so its receipt names every input that made it');

  // A planted occluder sha in the receipt is caught by the reader.
  const copy = join(dir, 'plate-occ-holes-planted');
  rmSync(copy, { recursive: true, force: true });
  cpSync(join(dir, 'plate-occ-holes'), copy, { recursive: true });
  const planted = JSON.parse(readFileSync(join(copy, 'receipt.json'), 'utf8')) as OccluderReceipt;
  if (planted.occluder !== undefined) planted.occluder.sha256 = '0'.repeat(64);
  writeFileSync(join(copy, 'receipt.json'), `${JSON.stringify(planted, null, 2)}\n`);
  const caught = verifyPlateReceipt(join(copy, 'receipt.json'));
  say('PB16_A_PLANTED_OCCLUDER_SHA_IN_THE_RECEIPT_IS_CAUGHT', caught.some((q) => q.code === 'PLATE_RECEIPT_HASH' && q.object.endsWith(' occluder')), JSON.stringify(caught),
    'issue #1230: the occluder is read back against its bytes like the painting, the mask and the output');

  const narrow = R['plate-occ-narrow'];
  const line = narrow === undefined ? null : failLine(narrow.out, 'PLATE_OCCLUDER_GRID');
  say('PB17_AN_OCCLUDER_OFF_THE_PAINTINGS_GRID_IS_REFUSED_BY_NAME_BEFORE_ANY_REQUEST',
    narrow?.status === 1 && line !== null && line.includes('63x48') && line.includes('64x48') && narrow.paths.length === 0 && narrow.uploads.length === 0 && narrow.prompts === 0 && !existsSync(join(dir, 'plate-occ-narrow')),
    `exit ${narrow?.status}, "${line ?? 'no PLATE_OCCLUDER_GRID line'}", requests ${narrow?.paths.length}, uploads ${narrow?.uploads.length}, prompts ${narrow?.prompts}`,
    'issue #1230: the occluder is read on the painting\'s grid and never fitted; a mismatch is refused before the box is reached');

  runOccluderChainChecks(dir, join(dir, 'plate-occ-chain'), (name, pass, detail) => say(name, pass, detail,
    'issue #1230: the occluder plate is a source of hidden surface the painting\'s own decomposition never paints, reached through the existing take route'));
  cutUnderPlateChecks(dir, say);
  cutFillMaskScaleChecks(say);
}

/**
 * Issue #1230: `assemble --emit-fill-masks <dir>` and `assemble.cuts[i].under: { plate: "<dir>" }`.
 * - Synthetic 64x64 (`rig_scale: 1`) cut fixture: `skirt` (`from`, `[16, 48) x [12, 52)` = `1,280` opaque px)
 *   cut by `sash` (`into`, polygon `[[24, 20], [40, 20], [40, 44], [24, 44]]` = `16 x 24 = 384` px, `draw: "front"`,
 *   `overlap: 2` -> `144` band px, `240` cleared interior px at `[26, 38) x [22, 42)`).
 */
function cutUnderPlateChecks(dir: string, say: Say): void {
  const root = join(dir, 'cut-under-plate');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const cliPath = join(import.meta.dir, '..', 'cli.ts');
  const fakeComfyPath = join(import.meta.dir, '..', 'fixtures', 'fakecomfy.ts');

  const W = 64, H = 64;
  const sourceRaster = newRaster(W, H);
  const layerRaster = newRaster(W, H);
  const faceLayers = (['face', 'eyewhite-r', 'eyewhite-l'] as const).map((name, k) => {
    const px = newRaster(W, H);
    for (let y = 2; y < 10; y++) {
      for (let x = 2 + k * 10; x < 10 + k * 10; x++) {
        px.data.set([90, 90, 90, 255], (y * W + x) * 4);
      }
    }
    return { name, tag: readLayerTag(name)!, pixels: px, file: null, left: 0, top: 0, right: W, bottom: H, depth: 0.4 - k * 0.01, drawOrder: k, opaquePx: 64 };
  });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const inSkirt = x >= 16 && x < 48 && y >= 12 && y < 52;
      const inSash = x >= 24 && x < 40 && y >= 20 && y < 44;
      if (inSash) {
        sourceRaster.data.set([210, 60, 70, 255], idx);
        layerRaster.data.set([210, 60, 70, 255], idx);
      } else if (inSkirt) {
        sourceRaster.data.set([70, 90, 160, 255], idx);
        layerRaster.data.set([70, 90, 160, 255], idx);
      } else {
        sourceRaster.data.set([245, 245, 245, 255], idx);
      }
    }
  }
  for (const fl of faceLayers) {
    for (let i = 0; i < W * H; i++) {
      if (fl.pixels.data[i * 4 + 3] > 0) sourceRaster.data.set([90, 90, 90, 255], i * 4);
    }
  }
  const sourcePath = join(root, 'source.png');
  writeFileSync(sourcePath, encodePngBytes(sourceRaster));
  const fullDir = join(root, 'full');
  exportLayers({
    form: 'wrapper',
    source: 'synthetic-cut',
    canvas: { w: W, h: H },
    layers: [...faceLayers, { name: 'bottomwear', tag: readLayerTag('bottomwear')!, pixels: layerRaster, file: null, left: 0, top: 0, right: W, bottom: H, depth: 0.5, drawOrder: 3, opaquePx: 1280 }],
    hidden: [],
  }, fullDir);

  const polygon: Array<[number, number]> = [[24, 20], [40, 20], [40, 44], [24, 44]];
  const makeConfig = (cuts: unknown[], extraAssemble: Record<string, unknown> = {}): Record<string, unknown> => {
    const cfg = assembleConfig({
      plan: [['face', 'full', 'face'], ['eye_r', 'full', 'eyewhite-r'], ['eye_l', 'full', 'eyewhite-l'], ['skirt', 'full', 'bottomwear']],
      extend: [],
      resolution: W,
      rigScale: 1,
    });
    delete (cfg.seethrough as Record<string, unknown>).head_box;
    return {
      ...cfg,
      assemble: { ...(cfg.assemble as Record<string, unknown>), ...(cuts.length > 0 ? { cuts } : {}), ...extraAssemble },
      regions: cuts.length > 0 ? { face: 'root', eye_r: 'root', eye_l: 'root', skirt: 'root', sash: 'root' } : { face: 'root', eye_r: 'root', eye_l: 'root', skirt: 'root' },
      meshes: {},
    };
  };

  const beforeCfgPath = join(root, 'config-before.json');
  writeFileSync(beforeCfgPath, JSON.stringify(makeConfig([{ from: 'skirt', into: 'sash', polygon, draw: 'front', overlap: 2 }]), null, 2));
  const noCutsCfgPath = join(root, 'config-no-cuts.json');
  writeFileSync(noCutsCfgPath, JSON.stringify(makeConfig([]), null, 2));

  // PB19: --emit-fill-masks writes <dir>/<into>.png on the painting grid and refuses a config with no cuts (exit 2).
  const masksDir = join(root, 'masks');
  const emitRun = spawnSync('bun', [cliPath, 'assemble', '--source', sourcePath, '--full', fullDir, '--config', beforeCfgPath, '--emit-fill-masks', masksDir], { encoding: 'utf8' });
  const maskFile = join(masksDir, 'sash.png');
  const maskDecoded = existsSync(maskFile) ? decodePngBytes(readFileSync(maskFile), maskFile) : null;
  let maskWhitePx = 0, maskZeroPx = 0, maskInsideMatch = true;
  if (maskDecoded !== null) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const r = maskDecoded.data[i], g = maskDecoded.data[i + 1], b = maskDecoded.data[i + 2], a = maskDecoded.data[i + 3];
        const want = x >= 24 && x < 40 && y >= 20 && y < 44;
        if (r === 255 && g === 255 && b === 255 && a === 255) {
          maskWhitePx++;
          if (!want) maskInsideMatch = false;
        } else if (r === 0 && g === 0 && b === 0 && a === 0) {
          maskZeroPx++;
          if (want) maskInsideMatch = false;
        } else {
          maskInsideMatch = false;
        }
      }
    }
  }
  const emptyMasksDir = join(root, 'masks-empty');
  const emptyEmitRun = spawnSync('bun', [cliPath, 'assemble', '--source', sourcePath, '--full', fullDir, '--config', noCutsCfgPath, '--emit-fill-masks', emptyMasksDir], { encoding: 'utf8' });
  say(
    'PB19_EMIT_FILL_MASKS_WRITES_POLYGON_INTERSECT_FROM_ON_THE_PAINTING_GRID_AND_REFUSES_EMPTY_CUTS',
    emitRun.status === 0 && maskDecoded?.width === W && maskDecoded?.height === H && maskWhitePx === 384 && maskZeroPx === 3712 && maskInsideMatch &&
      emptyEmitRun.status === 2 && (emptyEmitRun.stdout ?? '').includes('--emit-fill-masks requires at least one entry in config.assemble.cuts') && !existsSync(emptyMasksDir),
    `emit exit ${emitRun.status}, sash.png ${maskDecoded?.width}x${maskDecoded?.height} white=${maskWhitePx} (want 384, overlap band included) zero=${maskZeroPx} (want 3712) exactBox=${maskInsideMatch}; empty-cuts exit ${emptyEmitRun.status}, out absent=${!existsSync(emptyMasksDir)}`,
    'issue #1230 bar 1: --emit-fill-masks emits opaque white over (polygon ∩ from alpha > 0), including the overlap band, on the painting grid, and exits 2 when cuts is empty',
  );

  // Run `comfy plate --mode occluder` against the fake ComfyUI server to produce `<plate>/plate.png` and `<plate>/receipt.json`.
  const plateDir = join(root, 'plate-sash');
  const plateRunner = `
    import { startFakeComfy } from ${JSON.stringify(fakeComfyPath)};
    const fake = startFakeComfy('ok');
    try {
      const env = { ...process.env };
      delete env.COMFY_HOST;
      const proc = Bun.spawn([
        'bun', ${JSON.stringify(cliPath)}, 'comfy', 'plate', '--mode', 'occluder',
        '--painting', ${JSON.stringify(sourcePath)},
        '--occluder', ${JSON.stringify(maskFile)},
        '--out', ${JSON.stringify(plateDir)},
        '--host', fake.url,
        '--checkpoint-sha256', ${JSON.stringify('ab'.repeat(32))},
        '--grow', '1', '--wait', '2',
      ], { env, stdout: 'pipe', stderr: 'pipe' });
      const status = await proc.exited;
      if (status !== 0) {
        console.error(await new Response(proc.stderr).text() || await new Response(proc.stdout).text());
        process.exit(status);
      }
    } finally {
      fake.stop();
    }
  `;
  const plateRun = spawnSync('bun', ['-e', plateRunner], { encoding: 'utf8' });

  const runAssemble = (cfgPath: string, outSub: string, srcOverride = sourcePath) => {
    const outDir = join(root, outSub);
    const rigDir = join(outDir, 'rig');
    const res = assembleStage(
      { source: srcOverride, full: fullDir, head: null, config: cfgPath, seam: 'near-white', project: 'core' },
      { partsJson: join(rigDir, 'parts.json'), partsDir: join(rigDir, 'parts'), recomposite: join(outDir, 'recomposite.png'), errorMap: join(outDir, 'error.png') },
      () => {},
    );
    return { res, outDir, rigDir, partsJson: join(rigDir, 'parts.json') };
  };

  // Count transparent pixels inside `skirt`'s pre-cut footprint [16, 48) x [12, 52) when `sash` is drawn over `skirt` with offset `dx`.
  const countFootprintHoles = (rigDir: string, partsFile: ReturnType<typeof readParts>, dx: number): number => {
    const canvas = newRaster(W, H);
    for (const name of ['skirt', 'sash'] as const) {
      const rec = partsFile.parts.find((p) => p.name === name)!;
      const img = decodePngBytes(readFileSync(join(rigDir, 'parts', `${name}.png`)), name);
      const offX = name === 'sash' ? dx : 0;
      for (let py = 0; py < rec.h; py++) {
        for (let px = 0; px < rec.w; px++) {
          const tx = rec.x + px + offX, ty = rec.y + py;
          if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
          const si = (py * rec.w + px) * 4;
          const sa = img.data[si + 3];
          if (sa === 0) continue;
          const di = (ty * W + tx) * 4;
          canvas.data.set([img.data[si], img.data[si + 1], img.data[si + 2], sa], di);
        }
      }
    }
    let holes = 0;
    for (let y = 12; y < 52; y++) {
      for (let x = 16; x < 48; x++) {
        if (canvas.data[(y * W + x) * 4 + 3] === 0) holes++;
      }
    }
    return holes;
  };

  const afterCfgPath = join(root, 'config-after.json');
  writeFileSync(
    afterCfgPath,
    JSON.stringify(
      makeConfig(
        [{ from: 'skirt', into: 'sash', polygon, draw: 'front', overlap: 2, under: { plate: 'plate-sash' } }],
        { editor_receipts: { receipts: [], required: true, trace_parts: false } },
      ),
      null,
      2,
    ),
  );
  const beforeAsm = runAssemble(beforeCfgPath, 'out-before');
  const afterAsm = plateRun.status === 0 ? runAssemble(afterCfgPath, 'out-after') : null;
  const beforeRead = readParts(beforeAsm.partsJson);
  const afterRead = afterAsm === null ? null : readParts(afterAsm.partsJson);
  const beforeOwn = beforeRead.cut_ownership?.[0];
  const afterOwn = afterRead?.cut_ownership?.[0];
  const up = afterOwn?.under_plate;
  const restBeforeHoles = countFootprintHoles(beforeAsm.rigDir, beforeRead, 0);
  const dispBeforeHoles = countFootprintHoles(beforeAsm.rigDir, beforeRead, 16);
  const restAfterHoles = afterAsm === null || afterRead === null ? -1 : countFootprintHoles(afterAsm.rigDir, afterRead, 0);
  const dispAfterHoles = afterAsm === null || afterRead === null ? -1 : countFootprintHoles(afterAsm.rigDir, afterRead, 16);
  const hashFile = (p: string): string => sha256(readFileSync(p));
  const hashesMatch = up !== undefined &&
    up.receipt === 'plate-sash/receipt.json' &&
    up.receipt_sha256 === hashFile(join(plateDir, 'receipt.json')) &&
    up.occluder_sha256 === hashFile(maskFile) &&
    up.painting_sha256 === hashFile(sourcePath) &&
    up.output_sha256 === hashFile(join(plateDir, 'plate.png')) &&
    up.mask_sha256 === hashFile(join(plateDir, 'mask.png'));
  say(
    'PB20_CUT_UNDER_PLATE_FILLS_REMOVED_NON_BAND_PIXELS_CLOSES_DISPLACED_SEAM_AND_RECORDS_UNDER_PLATE',
    plateRun.status === 0 &&
      beforeOwn?.moved_in_opaque_px === 384 && beforeOwn?.retained_band_opaque_px === 144 && beforeOwn?.cleared_opaque_px === 240 && beforeOwn?.under_filled_px === 0 && beforeOwn?.net_cleared_opaque_px === 240 && beforeOwn?.under_plate === undefined &&
      afterOwn?.moved_in_opaque_px === 384 && afterOwn?.retained_band_opaque_px === 144 && afterOwn?.cleared_opaque_px === 240 && afterOwn?.under_filled_px === 240 && afterOwn?.net_cleared_opaque_px === 0 &&
      restBeforeHoles === 0 && dispBeforeHoles === 240 && restAfterHoles === 0 && dispAfterHoles === 0 && hashesMatch,
    `plate exit ${plateRun.status}; before filled=${beforeOwn?.under_filled_px} netCleared=${beforeOwn?.net_cleared_opaque_px} holes(rest=${restBeforeHoles}, dx+16=${dispBeforeHoles}); after filled=${afterOwn?.under_filled_px} netCleared=${afterOwn?.net_cleared_opaque_px} holes(rest=${restAfterHoles}, dx+16=${dispAfterHoles}); under_plate hashesMatch=${hashesMatch}`,
    'issue #1230 bars 1-3: under: { plate } fills all 240 non-band cut pixels, closes the 240-px displaced seam to 0, round-trips cut_ownership[0].under_plate through readParts, and is exempt from editor_receipts.required',
  );

  // PB21: planted config and receipt/stage faults fail with their exact codes.
  const catchCode = (fn: () => unknown): string => {
    try {
      fn();
      return 'NO_ERROR';
    } catch (err) {
      if (err instanceof PartsError) return err.problems.map((p) => p.code).join(',');
      throw err;
    }
  };
  const cfgEmptyObj = catchCode(() => parseEarlyConfig(makeConfig([{ from: 'skirt', into: 'sash', polygon, draw: 'front', overlap: 2, under: {} }]) as never, 'assemble'));
  const cfgEmptyStr = catchCode(() => parseEarlyConfig(makeConfig([{ from: 'skirt', into: 'sash', polygon, draw: 'front', overlap: 2, under: { plate: '' } }]) as never, 'assemble'));
  const cfgExtraKey = catchCode(() => parseEarlyConfig(makeConfig([{ from: 'skirt', into: 'sash', polygon, draw: 'front', overlap: 2, under: { plate: 'x', extra: 1 } }]) as never, 'assemble'));

  const writePlantCfg = (name: string, cutOverride: Record<string, unknown>, extraAsm: Record<string, unknown> = {}): string => {
    const p = join(root, `config-${name}.json`);
    writeFileSync(p, JSON.stringify(makeConfig([{ from: 'skirt', into: 'sash', polygon, draw: 'front', overlap: 2, under: { plate: 'plate-sash' }, ...cutOverride }], extraAsm), null, 2));
    return p;
  };

  const missingReceiptCode = catchCode(() => runAssemble(writePlantCfg('missing-receipt', { under: { plate: 'no-such-plate' } }), 'out-missing'));

  const tamperedPlateDir = join(root, 'plate-tampered');
  cpSync(plateDir, tamperedPlateDir, { recursive: true });
  const tpBytes = readFileSync(join(tamperedPlateDir, 'plate.png'));
  tpBytes[tpBytes.length - 16] ^= 0xff;
  writeFileSync(join(tamperedPlateDir, 'plate.png'), tpBytes);
  const tamperedPlateCode = catchCode(() => runAssemble(writePlantCfg('tampered-plate', { under: { plate: 'plate-tampered' } }), 'out-tampered'));

  const bgModeDir = join(root, 'plate-bg-mode');
  cpSync(plateDir, bgModeDir, { recursive: true });
  const bgRec = JSON.parse(readFileSync(join(bgModeDir, 'receipt.json'), 'utf8')) as Record<string, unknown>;
  bgRec.mode = 'background';
  delete bgRec.occluder;
  writeFileSync(join(bgModeDir, 'receipt.json'), `${JSON.stringify(bgRec, null, 2)}\n`);
  const bgModeCode = catchCode(() => runAssemble(writePlantCfg('bg-mode', { under: { plate: 'plate-bg-mode' } }), 'out-bg-mode'));

  const otherSourcePath = join(root, 'other-source.png');
  const otherSourceRaster = newRaster(W, H);
  otherSourceRaster.data.set(sourceRaster.data);
  otherSourceRaster.data[0] ^= 1;
  writeFileSync(otherSourcePath, encodePngBytes(otherSourceRaster));
  const paintingMismatchCode = catchCode(() => runAssemble(afterCfgPath, 'out-painting-mismatch', otherSourcePath));

  const movedPolygon: Array<[number, number]> = [[25, 20], [41, 20], [41, 44], [25, 44]];
  const maskMismatchCode = catchCode(() => runAssemble(writePlantCfg('moved-poly', { polygon: movedPolygon }), 'out-mask-mismatch'));

  const stringUnderPng = join(root, 'string-under.png');
  const stringUnderRaster = newRaster(16, 24);
  for (let i = 0; i < 16 * 24; i++) stringUnderRaster.data.set([70, 90, 160, 255], i * 4);
  writeFileSync(stringUnderPng, encodePngBytes(stringUnderRaster));
  const stringNoReceiptCode = catchCode(() =>
    runAssemble(
      writePlantCfg('string-no-receipt', { under: 'string-under.png' }, { editor_receipts: { receipts: [], required: true } }),
      'out-string-no-receipt',
    ),
  );

  const plantsPass =
    cfgEmptyObj === 'CONFIG_FIELD_PRESENT' &&
    cfgEmptyStr === 'CONFIG_FIELD_TYPE' &&
    cfgExtraKey === 'CONFIG_KEY_KNOWN' &&
    missingReceiptCode === 'CONFIG_FILE_PRESENT' &&
    tamperedPlateCode === 'PLATE_RECEIPT_HASH' &&
    bgModeCode === 'PLATE_RECEIPT_KEYS' &&
    paintingMismatchCode === 'ASSEMBLE_UNDER_PLATE_PAINTING' &&
    maskMismatchCode === 'ASSEMBLE_UNDER_PLATE_MASK' &&
    stringNoReceiptCode === 'ASSEMBLE_EDITOR_RECEIPT_MISSING';
  say(
    'PB21_CUT_UNDER_PLATE_REFUSES_PLANTED_CONFIG_AND_RECEIPT_FAULTS_BY_CODE',
    plantsPass,
    `under:{} -> ${cfgEmptyObj}; under:{plate:""} -> ${cfgEmptyStr}; under:{plate:"x",extra:1} -> ${cfgExtraKey}; missing receipt -> ${missingReceiptCode}; tampered plate.png -> ${tamperedPlateCode}; mode:"background" -> ${bgModeCode}; changed --source -> ${paintingMismatchCode}; polygon+1px -> ${maskMismatchCode}; string under without editor receipt -> ${stringNoReceiptCode}`,
    'issue #1230 bar 4: every config and receipt/stage plant on cuts[i].under fails with its exact refusal code',
  );
}

/** Issue #1230 (Codex review): the fill mask covers a cut piece's whole footprint on the painting grid when the rig is smaller or larger than the painting. */
function cutFillMaskScaleChecks(say: Say): void {
  const count = (r: Raster): number => { let n = 0; for (let p = 0; p < r.width * r.height; p++) if (r.data[p * 4 + 3] === 255) n++; return n; };
  const piece = (side: number, box: readonly [number, number, number, number]): Raster => {
    const r = newRaster(side, side);
    for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) r.data[(y * side + x) * 4 + 3] = 255;
    return r;
  };
  // rig 16x16 with an 8x8 piece at [4,12) -> painting 64x64: footprint [16,48)^2 = 1,024 px (a forward map gives 64).
  const down = count(cutFillMask(piece(16, [4, 4, 12, 12]), 64, 64));
  // rig 64x64 with a 32x32 piece at [16,48) -> painting 32x32: footprint [8,24)^2 = 256 px.
  const up = count(cutFillMask(piece(64, [16, 16, 48, 48]), 32, 32));
  // rig_scale 1: identity, 384 px.
  const same = count(cutFillMask(piece(64, [24, 20, 40, 44]), 64, 64));
  say(
    'PB22_THE_CUT_FILL_MASK_COVERS_THE_PIECES_WHOLE_FOOTPRINT_ON_THE_PAINTING_GRID_AT_ANY_RIG_SCALE',
    down === 1024 && up === 256 && same === 384,
    `rig 16 -> painting 64: ${down} (want 1024); rig 64 -> painting 32: ${up} (want 256); rig = painting: ${same} (want 384)`,
    'issue #1230: a forward rig -> painting mapping leaves the mask sparse when the rig is smaller than the painting, and comfy plate would keep the piece\'s colour in the gaps',
  );
}

export function runPlateChecks(dir: string, painting: string, R: Record<string, PlateHarnessResult>, say: Say): void {
  figureBindingChecks(dir, painting, say);
  seethroughBindingChecks(dir, painting, say);
  occluderChecks(dir, painting, R, say);
  const nothingAsked = (r: PlateHarnessResult | undefined): boolean => r !== undefined && r.paths.length === 0 && r.uploads.length === 0 && r.prompts === 0;
  const nothingWritten = (name: string): boolean => !existsSync(join(dir, name));
  const noUpload = (r: PlateHarnessResult | undefined): boolean => r !== undefined && r.uploads.length === 0 && r.prompts === 0 && !r.paths.includes('POST /upload/image');

  const bound = ['plate-unstamped', 'plate-stale-mask', 'plate-other-painting'].map(n => [n, R[n]] as const);
  const boundDetail = bound.map(([n, r]) => `${n}: exit ${r?.status}, requests ${r?.paths.length}, uploads ${r?.uploads.length}, prompts ${r?.prompts}; "${r === undefined ? 'not run' : failLine(r.out, n === 'plate-other-painting' ? 'PLATE_MASK_PAINTING' : 'PLATE_MASK_RUN') ?? 'no refusal line'}"`).join('; ');
  say('PB09_BACKGROUND_REFUSES_UNBOUND_FIGURE_SOURCES_BEFORE_ANY_REQUEST',
    bound.every(([n, r]) => r?.status === 1 && failLine(r.out, n === 'plate-other-painting' ? 'PLATE_MASK_PAINTING' : 'PLATE_MASK_RUN') !== null && nothingAsked(r) && nothingWritten(n)) && !boundDetail.includes('\n'),
    boundDetail,
    'issue #1188: background checks source provenance before connecting to the fake ComfyUI');

  const stBound = ['plate-st-legacy-meta', 'plate-st-tampered-layer', 'plate-st-other-painting'].map((n) => [n, R[n]] as const);
  const stBoundDetail = stBound.map(([n, r]) => `${n}: exit ${r?.status}, requests ${r?.paths.length}, uploads ${r?.uploads.length}, prompts ${r?.prompts}; "${r === undefined ? 'not run' : failLine(r.out, n === 'plate-st-other-painting' ? 'PLATE_MASK_PAINTING' : 'PLATE_MASK_RUN') ?? 'no refusal line'}"`).join('; ');
  say('PB12_BACKGROUND_REFUSES_UNBOUND_SEETHROUGH_SOURCES_BEFORE_ANY_REQUEST',
    stBound.every(([n, r]) => r?.status === 1 && failLine(r.out, n === 'plate-st-other-painting' ? 'PLATE_MASK_PAINTING' : 'PLATE_MASK_RUN') !== null && nothingAsked(r) && nothingWritten(n)) && !stBoundDetail.includes('\n'),
    stBoundDetail,
    'issue #1188: background checks seethrough: meta.json and layer hashes before connecting to the fake ComfyUI');

  // Concurrent foreground runs and pre-existing fixed staging collision check
  const fixedStageDecoy = join(dir, '.binding-fg-stage.partial-foreground');
  mkdirSync(fixedStageDecoy, { recursive: true });
  writeFileSync(join(fixedStageDecoy, 'plate.png'), 'corrupt-decoy');
  let decoyClean = false;
  try {
    runForeground({ painting, maskFrom: `seethrough:${join(dir, 'st-ok')}`, out: join(dir, 'binding-fg-stage') });
    decoyClean = verifyPlateReceipt(join(dir, 'binding-fg-stage', 'receipt.json')).length === 0 && existsSync(join(fixedStageDecoy, 'plate.png'));
  } finally {
    rmSync(fixedStageDecoy, { recursive: true, force: true });
  }
  const same1 = R['plate-fg-concurrent-same-1'], same2 = R['plate-fg-concurrent-same-2'];
  const diffA = R['plate-fg-concurrent-a'], diffB = R['plate-fg-concurrent-b'];
  const sameStatuses = [same1?.status, same2?.status].sort();
  const sameLoser = same1?.status === 1 ? same1 : same2;
  const sameLoserLine = sameLoser === undefined ? null : failLine(sameLoser.out, 'PLATE_OUT_EMPTY');
  const sameWinnerValid = existsSync(join(dir, 'plate-fg-concurrent-same', 'receipt.json')) && verifyPlateReceipt(join(dir, 'plate-fg-concurrent-same', 'receipt.json')).length === 0;
  const diffValid = diffA?.status === 0 && diffB?.status === 0 &&
    verifyPlateReceipt(join(dir, 'plate-fg-concurrent-a', 'receipt.json')).length === 0 &&
    verifyPlateReceipt(join(dir, 'plate-fg-concurrent-b', 'receipt.json')).length === 0;
  const leftoverPartials = readdirSync(dir).filter((f) => f.includes('.partial-'));
  const concurrentDetail = `decoy fixed staging untouched & output valid: ${decoyClean}; sibling runs: exit ${diffA?.status},${diffB?.status} valid ${diffValid}; same --out runs: exits ${sameStatuses.join(',')} winner valid ${sameWinnerValid} loser "${sameLoserLine ?? 'none'}"; leftover .partial-* dirs: ${leftoverPartials.length}`;
  say('PB13_CONCURRENT_FOREGROUND_RUNS_USE_UNIQUE_STAGING_AND_DO_NOT_COLLIDE',
    decoyClean && diffValid && sameStatuses[0] === 0 && sameStatuses[1] === 1 && sameLoserLine !== null && sameWinnerValid && leftoverPartials.length === 0 && !concurrentDetail.includes('\n'),
    concurrentDetail,
    'issue #1188 P2: foreground staging uses mkdtempSync per run so concurrent runs do not share a staging directory');

  const midWait = R['plate-out-filled-mid-wait'];
  const midWaitLine = midWait === undefined ? null : failLine(midWait.out, 'PLATE_OUT_EMPTY');
  const midWaitPreserved = existsSync(join(dir, 'plate-out-filled-mid-wait', 'occupied.txt')) && !existsSync(join(dir, 'plate-out-filled-mid-wait', 'receipt.json'));
  const midWaitDetail = `exit ${midWait?.status}, prompts ${midWait?.prompts}, preserved occupied.txt without receipt.json: ${midWaitPreserved}, leftover .partial-* dirs: ${leftoverPartials.length}; "${midWaitLine ?? 'no PLATE_OUT_EMPTY line'}"`;
  say('PB14_AN_OUT_FILLED_MID_WAIT_IS_REFUSED_AS_PLATE_OUT_EMPTY',
    midWait?.status === 1 && midWait.prompts === 1 && midWaitLine !== null && midWaitPreserved && leftoverPartials.length === 0 && !midWaitDetail.includes('\n'),
    midWaitDetail,
    'issue #1188 P2: publishPlate re-checks --out and refuses an output directory filled during a queue wait as PLATE_OUT_EMPTY instead of raw ENOTEMPTY');

  // 1. a missing node or model is refused by name before anything is uploaded; core still runs on that box
  const noPack = R['plate-no-inpaint-lama'], noModel = R['plate-missing-model'], coreOnBare = R['plate-no-inpaint-core'];
  const nodeLine = noPack === undefined ? null : failLine(noPack.out, 'COMFY_NODE_PRESENT');
  const modelLine = noModel === undefined ? null : failLine(noModel.out, 'COMFY_CHOICE_PRESENT');
  say(
    'PB01_A_MISSING_NODE_OR_MODEL_IS_REFUSED_BY_NAME_BEFORE_UPLOAD_AND_CORE_STILL_RUNS_WITHOUT_THE_PACK',
    noPack?.status === 1 && nodeLine !== null && nodeLine.includes('INPAINT_') && noUpload(noPack) && noPack.paths.includes('GET /object_info') && nothingWritten('plate-no-inpaint-lama') &&
      noModel?.status === 1 && modelLine !== null && modelLine.includes('not_on_the_box.pt') && noUpload(noModel) && nothingWritten('plate-missing-model') &&
      coreOnBare?.status === 0 && existsSync(join(dir, 'plate-no-inpaint-core', 'receipt.json')),
    `no pack: exit ${noPack?.status}, "${nodeLine ?? 'no COMFY_NODE_PRESENT line'}", uploads ${noPack?.uploads.length}, prompts ${noPack?.prompts}; missing model: exit ${noModel?.status}, "${modelLine ?? 'no COMFY_CHOICE_PRESENT line'}", uploads ${noModel?.uploads.length}; core on the same box: exit ${coreOnBare?.status}`,
    'issue #1183 bar 1: the capability check runs against /object_info before anything is uploaded; a box without the inpaint pack refuses lama cleanly and still runs core',
  );

  // 2. no source mask: refused by name, nothing written, no job (no request at all)
  const noMask = ['plate-no-mask', 'plate-no-source', 'plate-no-scene', 'plate-fg-no-mask'].map((n) => [n, R[n]] as const);
  say(
    'PB02_WITH_NO_SOURCE_MASK_THE_PLATE_IS_REFUSED_BY_NAME_WRITES_NOTHING_AND_RUNS_NO_JOB',
    noMask.every(([n, r]) => r?.status === 1 && failLine(r.out, 'PLATE_MASK_SOURCE') !== null && nothingAsked(r) && nothingWritten(n)),
    noMask.map(([n, r]) => `${n}: exit ${r?.status}, "${r === undefined ? 'not run' : failLine(r.out, 'PLATE_MASK_SOURCE') ?? 'no PLATE_MASK_SOURCE line'}", requests ${r?.paths.length}, out ${nothingWritten(n) ? 'absent' : 'WRITTEN'}`).join('; '),
    'issue #1183 bar 2: the mask comes from a source (See-through figure layers or the declared figure mask), never a hand polygon; with none the command names what is missing and touches nothing',
  );

  // 3. receipt hashes match the bytes on disk, and a planted mismatch is caught
  const receipts = ['plate-lama-ok', 'plate-core-ok', 'plate-fg'].map((n) => [n, join(dir, n, 'receipt.json')] as const);
  const clean = receipts.map(([n, f]) => [n, existsSync(f) ? verifyPlateReceipt(f) : [{ code: 'ABSENT', object: f, detail: '' }]] as const);
  const keyOrder = receipts.every(([, f]) => existsSync(f) && Object.keys(JSON.parse(readFileSync(f, 'utf8')) as object).join(',') === PLATE_RECEIPT_KEYS.join(','));
  const plants: Array<[string, string, string]> = [];
  for (const [field, file] of [['output', 'plate.png'], ['mask', 'mask.png']] as const) {
    const copy = join(dir, `plate-lama-ok-plant-${field}`);
    cpSync(join(dir, 'plate-lama-ok'), copy, { recursive: true });
    const bytes = readFileSync(join(copy, file));
    bytes[bytes.length - 20] ^= 0xff;
    writeFileSync(join(copy, file), bytes);
    const caught = verifyPlateReceipt(join(copy, 'receipt.json')).find((p) => p.code === 'PLATE_RECEIPT_HASH' && p.object.endsWith(` ${field}`));
    plants.push([field, caught === undefined ? '' : caught.code, caught?.detail ?? '']);
  }
  {
    const copy = join(dir, 'plate-lama-ok-plant-painting');
    cpSync(join(dir, 'plate-lama-ok'), copy, { recursive: true });
    const r = JSON.parse(readFileSync(join(copy, 'receipt.json'), 'utf8')) as { painting: { sha256: string } };
    r.painting.sha256 = '0'.repeat(64);
    writeFileSync(join(copy, 'receipt.json'), JSON.stringify(r, null, 2));
    const caught = verifyPlateReceipt(join(copy, 'receipt.json')).find((p) => p.code === 'PLATE_RECEIPT_HASH' && p.object.endsWith(' painting'));
    plants.push(['painting', caught === undefined ? '' : caught.code, caught?.detail ?? '']);
  }
  const lama = existsSync(receipts[0][1]) ? (JSON.parse(readFileSync(receipts[0][1], 'utf8')) as Record<string, unknown>) : {};
  const fg = existsSync(receipts[2][1]) ? (JSON.parse(readFileSync(receipts[2][1], 'utf8')) as Record<string, unknown>) : {};
  const model = lama.model as { checkpoint_sha256_from?: unknown } | null | undefined;
  say(
    'PB03_THE_RECEIPT_HASHES_MATCH_THE_BYTES_ON_DISK_AND_A_PLANTED_MISMATCH_IS_CAUGHT',
    clean.every(([, p]) => p.length === 0) && keyOrder && plants.every(([, c]) => c === 'PLATE_RECEIPT_HASH') &&
      lama.spec === PLATE_RECEIPT_SPEC && lama.gpu === 'cuda:0 Fake GPU' && model?.checkpoint_sha256_from === 'declared' &&
      fg.model === null && fg.gpu === null && fg.graph === 'rig-parts/plate-foreground/1',
    `${clean.map(([n, p]) => `${n}: ${p.length === 0 ? 'verifies' : p.map((x) => x.code).join(',')}`).join('; ')}; key order ${keyOrder ? 'as PLATE_RECEIPT_KEYS' : 'OTHER'}; planted: ${plants.map(([f, c]) => `${f} -> ${c || 'NOT CAUGHT'}`).join(', ')}; lama gpu ${JSON.stringify(lama.gpu)}, checksum from ${JSON.stringify(model?.checkpoint_sha256_from)}; foreground model ${JSON.stringify(fg.model)}, gpu ${JSON.stringify(fg.gpu)}`,
    'issue #1183 bar 3: the receipt is what create binds to; a hash that is not the file\'s is a receipt for other bytes',
  );

  // 4. outside the mask the plate is the painting byte for byte (the fake drifts every outside red byte by one)
  const pb = ['plate-lama-ok', 'plate-core-ok'].map((n) => [n, pasteBack(join(dir, n), painting)] as const);
  const fgPaste = (() => {
    try {
      const p = decodePngBytes(new Uint8Array(readFileSync(painting)), painting);
      const m = decodePngBytes(new Uint8Array(readFileSync(join(dir, 'plate-fg', 'mask.png'))), 'mask');
      const o = decodePngBytes(new Uint8Array(readFileSync(join(dir, 'plate-fg', 'plate.png'))), 'plate');
      let bad = 0;
      for (let i = 0; i < p.width * p.height; i++) for (let c = 0; c < 4; c++) if (o.data[i * 4 + c] !== (m.data[i * 4] === 255 ? p.data[i * 4 + c] : 0)) bad++;
      return bad;
    } catch {
      return -1;
    }
  })();
  // The witness: one outside byte moved by the fake's drift is seen.
  const witness = (() => {
    try {
      const copy = join(dir, 'plate-core-ok-plant-outside');
      cpSync(join(dir, 'plate-core-ok'), copy, { recursive: true });
      const m = decodePngBytes(new Uint8Array(readFileSync(join(copy, 'mask.png'))), 'mask');
      const o = decodePngBytes(new Uint8Array(readFileSync(join(copy, 'plate.png'))), 'plate');
      const i = m.data.findIndex((v, k) => k % 4 === 0 && v === 0);
      o.data[i] = (o.data[i] + 1) % 256;
      writeFileSync(join(copy, 'plate.png'), encodePngBytes(o));
      return pasteBack(copy, painting)?.outsideDiff ?? -1;
    } catch {
      return -1;
    }
  })();
  say(
    'PB04_OUTSIDE_THE_MASK_THE_BACKGROUND_PLATE_IS_THE_PAINTING_BYTE_FOR_BYTE_AND_THE_FOREGROUND_IS_THE_PAINTING_INSIDE_IT',
    pb.every(([, x]) => x !== null && x.outsideDiff === 0 && x.insideWrong === 0 && x.inside > 0) && fgPaste === 0 && witness === 1,
    `${pb.map(([n, x]) => `${n}: ${x === null ? 'unreadable' : `${x.outsideDiff} outside px differ, ${x.insideWrong} of ${x.inside} inside px not the box's`}`).join('; ')} (the fake added +1 to every red byte outside the mask); foreground: ${fgPaste} byte(s) not painting-inside/zero-outside; planted, one outside red byte moved by 1 -> ${witness} px seen`,
    'ruling 1 for #1183: the paste-back is inside the mask only, so a float round trip on the box cannot move a pixel the figure did not cover',
  );

  // 5. queue: appended behind others, never in front; a long wait is refused with the queue place
  const busy = R['plate-busy'], behind = R['plate-behind'];
  const behindLine = behind === undefined ? null : failLine(behind.out, 'COMFY_QUEUE_BEHIND');
  const fronts = Object.entries(R).filter(([n]) => n.startsWith('plate-')).reduce((a, [, r]) => a + (r.fronts ?? 0), 0);
  say(
    'PB05_THE_PLATE_JOB_IS_APPENDED_BEHIND_OTHERS_AND_A_LONG_WAIT_IS_REFUSED_WITH_ITS_QUEUE_PLACE',
    busy?.status === 0 && behind?.status === 1 && behindLine !== null && /place 2 of 2 pending with 2 job\(s\) ahead/.test(behindLine) && behind.prompts === 1 && fronts === 0 && nothingWritten('plate-behind') &&
      !(busy?.paths ?? []).some((p) => p.startsWith('POST /queue') || p.startsWith('POST /interrupt')) && !(behind?.paths ?? []).some((p) => p.startsWith('POST /queue') || p.startsWith('POST /interrupt')),
    `someone else running: exit ${busy?.status} (queued behind it); stuck behind two: exit ${behind?.status}, "${behindLine ?? 'no COMFY_QUEUE_BEHIND line'}"; /prompt bodies asking for the front: ${fronts}; no POST /queue or /interrupt sent`,
    'ruling 4 for #1183: the plate appends behind other jobs, never cuts in, never reorders or cancels; on a long wait it stops and says where it stands',
  );

  // 6. --checkpoint-sha256: malformed or absent is refused by name before any request; the valid one is recorded
  const badSha = R['plate-bad-sha'], noSha = R['plate-no-sha'], goodSha = R['plate-lama-ok'];
  const shaLine = (r: PlateHarnessResult | undefined): string | null => (r === undefined ? null : failLine(r.out, 'PLATE_CHECKPOINT_SHA256'));
  const declared = (model as { checkpoint_sha256?: unknown } | null | undefined)?.checkpoint_sha256;
  say(
    'PB06_A_MALFORMED_OR_ABSENT_CHECKPOINT_SHA256_IS_REFUSED_BY_NAME_WITH_NO_REQUEST_AND_NOTHING_WRITTEN',
    badSha?.status === 1 && shaLine(badSha)?.includes('"not-a-hash"') === true && nothingAsked(badSha) && nothingWritten('plate-bad-sha') &&
      noSha?.status === 1 && shaLine(noSha)?.includes('is absent') === true && nothingAsked(noSha) && nothingWritten('plate-no-sha') &&
      goodSha?.status === 0 && declared === 'ab'.repeat(32) && model?.checkpoint_sha256_from === 'declared',
    `malformed: exit ${badSha?.status}, "${shaLine(badSha) ?? 'no PLATE_CHECKPOINT_SHA256 line'}", requests ${badSha?.paths.length}, out ${nothingWritten('plate-bad-sha') ? 'absent' : 'WRITTEN'}; absent: exit ${noSha?.status}, "${shaLine(noSha) ?? 'no PLATE_CHECKPOINT_SHA256 line'}", requests ${noSha?.paths.length}, out ${nothingWritten('plate-no-sha') ? 'absent' : 'WRITTEN'}; valid (the harness's 64 hex characters): exit ${goodSha?.status}, recorded ${JSON.stringify(declared)} from ${JSON.stringify(model?.checkpoint_sha256_from)}`,
    'ruling 3 for #1183: the box reports no hash, so the receipt carries a declared one; a missing or malformed declaration is refused before the box is reached, never recorded',
  );
}

if (import.meta.main) {
  const work = process.argv[2];
  if (work === undefined) {
    console.error('usage: bun tools/check_plate.ts <work dir>');
    process.exit(2);
  }
  const h = spawnSync('bun', [join(import.meta.dir, '..', 'fixtures', 'comfyharness.ts'), work], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const parsed = JSON.parse((h.stdout ?? '').trim().split('\n').pop() ?? '{}') as { platePainting: string; results: Record<string, PlateHarnessResult> };
  let bad = 0;
  runPlateChecks(work, parsed.platePainting, parsed.results, (name, pass, detail) => {
    if (!pass) bad++;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
  });
  process.exit(bad === 0 ? 0 : 1);
}
