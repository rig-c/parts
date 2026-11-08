/** Synthetic producer/reader controls, also imported by the comfy suite. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { readSourceMask, sha256 } from '../src/plate.ts';
import { prepareSeeThroughInput } from '../src/seethrough-transform.ts';
import { OPAQUE_ALPHA_ABOVE } from '../src/layers.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { decodePngBytes, encodePngBytes } from '../src/raster/png.ts';

type Say = (name: string, ok: boolean, detail: string, why: string) => void;

/** Encode an 8-bit RGB-only (colorType 2, no alpha channel) PNG for the LoadImage RGB-only control. */
function encodeRgb24Png(r: Raster): Uint8Array {
  const chunk = (type: string, body: Uint8Array): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length, 0);
    const typeAndBody = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(body)]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndBody) >>> 0, 0);
    return Buffer.concat([len, typeAndBody, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(r.width, 0);
  ihdr.writeUInt32BE(r.height, 4);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 2; // colorType 2 (truecolor RGB, no alpha)
  const raw = Buffer.alloc(r.height * (1 + r.width * 3));
  for (let y = 0; y < r.height; y++) {
    const row = y * (1 + r.width * 3);
    raw[row] = 0; // filter 0
    for (let x = 0; x < r.width; x++) {
      const si = (y * r.width + x) * 4;
      const di = row + 1 + x * 3;
      raw[di] = r.data[si];
      raw[di + 1] = r.data[si + 1];
      raw[di + 2] = r.data[si + 2];
    }
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', new Uint8Array(0)),
    ]),
  );
}

export function runSeeThroughTransformChecks(dir: string, say: Say): void {
  const source = newRaster(2, 4);
  source.data.fill(255);
  const paintingBytes = encodePngBytes(source);
  const prepared = prepareSeeThroughInput(source, 4, 'rgba-zero');
  const root = join(dir, 'transform-source');
  mkdirSync(join(root, 'parts'), { recursive: true });
  const layer = newRaster(4, 4);
  // Source x=0 maps to target x=1, with no resampling at scale 1.
  for (let y = 0; y < 4; y++) layer.data.set([255, 255, 255, 255], (y * 4 + 1) * 4);
  const layerBytes = encodePngBytes(layer);
  writeFileSync(join(root, 'parts', 'face.png'), layerBytes);
  writeFileSync(join(root, 'layers.json'), JSON.stringify({ width: 4, height: 4, layers: [{ name: 'face', filename: 'face.png', left: 0, top: 0, right: 4, bottom: 4, depth_median: 0.5 }] }));
  const meta = { image_sha256: sha256(paintingBytes), layers: [{ path: 'parts/face.png', sha256: sha256(layerBytes) }], input_transform: prepared.transform };
  const stamp = (value: unknown): void => writeFileSync(join(root, 'meta.json'), JSON.stringify(value));
  const read = (): Uint8Array => readSourceMask('seethrough', root, 2, 4, source, paintingBytes).inside;
  stamp(meta);
  const found = read();
  const expected = Uint8Array.from([1, 0, 1, 0, 1, 0, 1, 0]);
  const difference = found.reduce((sum, value, i) => sum + Number(value !== expected[i]), 0);
  say('STX01_RECORDED_NON_SQUARE_MASK_ROUND_TRIPS', difference === 0 && prepared.transform?.pad.join() === '1,0' && prepared.transform.pad_fill === 'rgba-zero' && prepared.image.data[3] === 0,
    `painting 2x4, target 4x4, pad [1,0], pad_fill ${String(prepared.transform?.pad_fill)}, difference ${difference} px`, 'issue #1197/#1205: a representable mask returns to its source grid using the recorded rgba-zero transform');
  const legacyPrepared = prepareSeeThroughInput(source, 4, 'rgb-black-opaque');
  stamp({ ...meta, input_transform: legacyPrepared.transform });
  const legacyFound = read();
  const legacyDiff = legacyFound.reduce((sum, value, i) => sum + Number(value !== expected[i]), 0);
  say('STX01B_LEGACY_RGB_BLACK_OPAQUE_RECORD_READS_AS_RECORDED', legacyDiff === 0 && legacyPrepared.transform?.pad_fill === 'rgb-black-opaque',
    `2.27.2 pad_fill ${String(legacyPrepared.transform?.pad_fill)}, difference ${legacyDiff} px`, 'issue #1205: existing 2.27.2 meta.json records with pad_fill "rgb-black-opaque" remain readable by plate/matte');
  const plants = [
    ['missing-record', { ...meta, input_transform: undefined }, 'PLATE_MASK_GRID'],
    ['wrong-source', { ...meta, image_sha256: '0'.repeat(64) }, 'PLATE_MASK_PAINTING'],
    ['wrong-scale', { ...meta, input_transform: { ...prepared.transform, scale: 2 } }, 'PLATE_MASK_GRID'],
    ['wrong-grid', { ...meta, input_transform: { ...prepared.transform, source: [3, 4] } }, 'PLATE_MASK_GRID'],
    ['wrong-offset', { ...meta, input_transform: { ...prepared.transform, pad: [-1, 0] } }, 'PLATE_MASK_GRID'],
    ['wrong-resample', { ...meta, input_transform: { ...prepared.transform, resample: 'unknown' } }, 'PLATE_MASK_GRID'],
    ['wrong-pad-fill', { ...meta, input_transform: { ...prepared.transform, pad_fill: 'transparent' } }, 'PLATE_MASK_GRID'],
    ['wrong-target', { ...meta, input_transform: { ...prepared.transform, target: [8, 8] } }, 'PLATE_MASK_GRID'],
    ['null-record', { ...meta, input_transform: null }, 'PLATE_MASK_GRID'],
  ] as const;
  for (const [name, value, code] of plants) {
    stamp(value);
    let message = '';
    try { read(); } catch (err) { message = String(err); }
    say(`STX02_${name.toUpperCase().replaceAll('-', '_')}`, message.includes(code), `${name} -> ${message.includes(code) ? code : message}`,
      'issue #1197: missing or invalid geometry and mismatched painting bytes are refused by name');
  }
  // Reducing the padded 4x4 grid to 2x2 loses a one-column source detail.
  const detail = newRaster(2, 4);
  for (let x = 0; x < 2; x++) detail.data.set([255, 255, 255, 255], x * 4);
  const reduced = prepareSeeThroughInput(detail, 2, 'rgba-zero');
  const small = reduced.image;
  const smallBytes = encodePngBytes(small);
  writeFileSync(join(root, 'parts', 'face.png'), smallBytes);
  writeFileSync(join(root, 'layers.json'), JSON.stringify({ width: 2, height: 2, layers: [{ name: 'face', filename: 'face.png', left: 0, top: 0, right: 2, bottom: 2, depth_median: 0.5 }] }));
  stamp({ ...meta, input_transform: reduced.transform, layers: [{ path: 'parts/face.png', sha256: sha256(smallBytes) }] });
  const bounded = read();
  const boundedExpected = Uint8Array.from([1, 1, 1, 1, 0, 0, 0, 0]);
  const originalDetail = Uint8Array.from([1, 1, 0, 0, 0, 0, 0, 0]);
  const lost = bounded.reduce((sum, v, i) => sum + Number(v !== originalDetail[i]), 0);
  say('STX03_SUB_GRID_DETAIL_HAS_THE_DECLARED_NEAREST_SAMPLE_RESULT', bounded.every((v, i) => v === boundedExpected[i]) && lost === 2 && small.data[3] > OPAQUE_ALPHA_ABOVE,
    `one source row becomes two rows, difference from original ${lost} px, nearest-sample bytes [${bounded.join()}]`,
    'issue #1197: parts Lanczos3 reduction loses one-row detail; nearest-pixel-centres returns its declared bounded result');
  const square = newRaster(4, 4);
  square.data.fill(127);
  const unchanged = prepareSeeThroughInput(square, 2, 'rgba-zero');
  say('STX04_SQUARE_INPUT_PREPARATION_IS_ABSENT', unchanged.image === square && unchanged.transform === undefined &&
    Buffer.from(encodePngBytes(unchanged.image)).equals(Buffer.from(encodePngBytes(square))),
    'square source kept by identity, transform absent, encoded PNG bytes identical', 'issue #1197: the original square upload and metadata branch is retained even when resolution differs');

  const probe = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fake-probe', join(dir, 'fake-probe')], { encoding: 'utf8' });
  let probeRes: {
    nonSquareOk: boolean;
    nonSquareDetail: string;
    squareOk: boolean;
    squareDetail: string;
  } | null = null;
  try {
    probeRes = JSON.parse((probe.stdout ?? '').trim().split('\n').pop() ?? '');
  } catch {
    probeRes = null;
  }
  say('STX05_NON_SQUARE_TRANSPARENT_PAD_REACHES_SEETHROUGH_GENERATE_LAYERS',
    probe.status === 0 && probeRes?.nonSquareOk === true,
    probeRes?.nonSquareDetail ?? `exit ${probe.status}: ${probe.stdout} ${probe.stderr}`,
    'issue #1205: JoinImageWithAlpha rejoins LoadImage IMAGE and MASK so non-square padded pixels arrive at SeeThrough_GenerateLayers with alpha 0, whereas bypassing JoinImageWithAlpha turns the pad opaque (255)');
  say('STX06_OPAQUE_SQUARE_AND_RGB_ONLY_PNG_REACH_MODEL_WITH_OPAQUE_ALPHA',
    probe.status === 0 && probeRes?.squareOk === true,
    probeRes?.squareDetail ?? `exit ${probe.status}: ${probe.stdout} ${probe.stderr}`,
    'issue #1205: opaque square RGBA and RGB-only (colorType 2) square uploads keep identical upload bytes, omit input_transform, and reach SeeThrough_GenerateLayers with alpha 255 everywhere');
}

if (import.meta.main && process.argv[2] === '--fake-probe') {
  const { startFakeComfy } = await import('../fixtures/fakecomfy.ts');
  const { ComfyClient } = await import('../src/comfy/client.ts');
  const { runSeeThrough } = await import('../src/comfy/seethrough.ts');
  const probeDir = process.argv[3];
  mkdirSync(probeDir, { recursive: true });
  const fake = startFakeComfy('ok');
  try {
    const client = new ComfyClient(fake.url, { request: 5, poll: 0.01 });

    // 1. Non-square 16x32 opaque source -> 64x64 target (padded 32x32, pad left=8, scale=2; target painted x in [16, 48), Lanczos3 support is 3 source px = 6 target px around x=16 and x=48).
    const nonSq = newRaster(16, 32);
    for (let i = 0; i < 16 * 32; i++) nonSq.data.set([200, 100, 50, 255], i * 4);
    const nonSqFile = join(probeDir, 'nonsquare.png');
    writeFileSync(nonSqFile, encodePngBytes(nonSq));
    const nonSqOut = join(probeDir, 'nonsquare-out');
    await runSeeThrough(client, { image: nonSqFile, out: nonSqOut, prefix: 'stx_nonsq', resolution: 64, steps: 1, seed: 0, offload: false, lama: false, quant: 'none', wait: 1, timeout: 5 }, () => {});
    const nonSqMeta = JSON.parse(readFileSync(join(nonSqOut, 'meta.json'), 'utf8')) as { input_transform?: { pad_fill?: string; pad?: number[] } };
    const sentGraph = fake.prompts[0] as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    const delivered = fake.layerInputs[0];
    let padMaxAlpha = 0;
    let paintedMinAlpha = 255;
    for (let y = 0; y < delivered.height; y++) {
      for (let x = 0; x < delivered.width; x++) {
        const a = delivered.data[(y * delivered.width + x) * 4 + 3];
        if (x < 10 || x >= 54) padMaxAlpha = Math.max(padMaxAlpha, a);
        else if (x >= 22 && x < 42) paintedMinAlpha = Math.min(paintedMinAlpha, a);
      }
    }
    // Planted bypass: submit the same graph with node 3 wired directly to ["1", 0] (bypassing JoinImageWithAlpha).
    const plantedGraph = structuredClone(sentGraph);
    plantedGraph['3'].inputs.image = ['1', 0];
    await client.submit(plantedGraph, 'plant');
    const bypassed = fake.layerInputs[1];
    const bypassPadAlpha = bypassed.data[3]; // (0,0) in the left pad column

    const joinWired =
      sentGraph['10']?.class_type === 'JoinImageWithAlpha' &&
      JSON.stringify(sentGraph['10'].inputs.image) === '["1",0]' &&
      JSON.stringify(sentGraph['10'].inputs.alpha) === '["1",1]' &&
      JSON.stringify(sentGraph['3'].inputs.image) === '["10",0]';
    const nonSquareOk =
      joinWired &&
      nonSqMeta.input_transform?.pad_fill === 'rgba-zero' &&
      padMaxAlpha === 0 &&
      paintedMinAlpha === 255 &&
      bypassPadAlpha === 255;
    const nonSquareDetail = `JoinImageWithAlpha wired=${joinWired}, meta.pad_fill=${String(nonSqMeta.input_transform?.pad_fill)}, padMaxAlpha=${padMaxAlpha}, paintedMinAlpha=${paintedMinAlpha}, plantedDirectLoadImagePadAlpha=${bypassPadAlpha}`;

    // 2. Opaque square inputs: (a) 64x64 RGBA PNG (colorType 6) and (b) 64x64 RGB-only PNG (colorType 2).
    const sqRaster = newRaster(64, 64);
    for (let i = 0; i < 64 * 64; i++) sqRaster.data.set([(i * 7) & 255, (i * 13) & 255, (i * 29) & 255, 255], i * 4);
    const sqRgbaBytes = encodePngBytes(sqRaster);
    const sqRgb24Bytes = encodeRgb24Png(sqRaster);
    const sqRgbaFile = join(probeDir, 'sq-rgba.png');
    const sqRgb24File = join(probeDir, 'sq-rgb24.png');
    writeFileSync(sqRgbaFile, sqRgbaBytes);
    writeFileSync(sqRgb24File, sqRgb24Bytes);

    const sqRgbaOut = join(probeDir, 'sq-rgba-out');
    const sqRgb24Out = join(probeDir, 'sq-rgb24-out');
    await runSeeThrough(client, { image: sqRgbaFile, out: sqRgbaOut, prefix: 'stx_sq_rgba', resolution: 64, steps: 1, seed: 0, offload: false, lama: false, quant: 'none', wait: 1, timeout: 5 }, () => {});
    await runSeeThrough(client, { image: sqRgb24File, out: sqRgb24Out, prefix: 'stx_sq_rgb24', resolution: 64, steps: 1, seed: 0, offload: false, lama: false, quant: 'none', wait: 1, timeout: 5 }, () => {});

    const rgbaMeta = JSON.parse(readFileSync(join(sqRgbaOut, 'meta.json'), 'utf8')) as Record<string, unknown>;
    const rgb24Meta = JSON.parse(readFileSync(join(sqRgb24Out, 'meta.json'), 'utf8')) as Record<string, unknown>;
    const rgbaUpload = fake.uploads.get(`${String(rgbaMeta.prefix)}_input.png`);
    const rgb24Upload = fake.uploads.get(`${String(rgb24Meta.prefix)}_input.png`);
    const rgbaModel = fake.layerInputs[2];
    const rgb24Model = fake.layerInputs[3];

    const uploadIdentical =
      rgbaUpload !== undefined &&
      rgb24Upload !== undefined &&
      Buffer.from(rgbaUpload).equals(Buffer.from(sqRgbaBytes)) &&
      Buffer.from(rgb24Upload).equals(Buffer.from(sqRgb24Bytes)) &&
      rgb24Upload[25] === 2;
    const modelIdentical =
      Buffer.from(rgbaModel.data).equals(Buffer.from(sqRaster.data)) &&
      Buffer.from(rgb24Model.data).equals(Buffer.from(sqRaster.data));
    const transformAbsent = !('input_transform' in rgbaMeta) && !('input_transform' in rgb24Meta);
    const squareOk = uploadIdentical && modelIdentical && transformAbsent;
    const squareDetail = `rgba+rgb24(colorType=${String(rgb24Upload?.[25])}) uploadBytesIdentical=${uploadIdentical}, modelInputEqualsOpaqueSource=${modelIdentical}, inputTransformAbsent=${transformAbsent}`;

    console.log(JSON.stringify({ nonSquareOk, nonSquareDetail, squareOk, squareDetail }));
    process.exit(nonSquareOk && squareOk ? 0 : 1);
  } finally {
    fake.stop();
  }
}
