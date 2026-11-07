/** Synthetic producer/reader controls, also imported by the comfy suite. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceMask, sha256 } from '../src/plate.ts';
import { prepareSeeThroughInput } from '../src/seethrough-transform.ts';
import { OPAQUE_ALPHA_ABOVE } from '../src/layers.ts';
import { newRaster } from '../src/raster/types.ts';
import { encodePngBytes } from '../src/raster/png.ts';

type Say = (name: string, ok: boolean, detail: string, why: string) => void;

export function runSeeThroughTransformChecks(dir: string, say: Say): void {
  const source = newRaster(2, 4);
  source.data.fill(255);
  const paintingBytes = encodePngBytes(source);
  const prepared = prepareSeeThroughInput(source, 4);
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
  say('STX01_RECORDED_NON_SQUARE_MASK_ROUND_TRIPS', difference === 0 && prepared.transform?.pad.join() === '1,0' && prepared.image.data[3] === 0,
    `painting 2x4, target 4x4, pad [1,0], difference ${difference} px`, 'issue #1197: a representable mask returns to its source grid using the recorded transform');
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
  const reduced = prepareSeeThroughInput(detail, 2);
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
  const unchanged = prepareSeeThroughInput(square, 2);
  say('STX04_SQUARE_INPUT_PREPARATION_IS_ABSENT', unchanged.image === square && unchanged.transform === undefined &&
    Buffer.from(encodePngBytes(unchanged.image)).equals(Buffer.from(encodePngBytes(square))),
    'square source kept by identity, transform absent, encoded PNG bytes identical', 'issue #1197: the original square upload and metadata branch is retained even when resolution differs');
}
