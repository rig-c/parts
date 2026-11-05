/** Independent pixel oracles over the declared validation painting. */
import { join } from 'node:path';
import { readPng } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { makeInputs } from '../src/inputs.ts';
import { readLayers } from '../src/layers.ts';
import { proposeHeadBox } from '../src/headbox.ts';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.ts';

export interface ValidationReading { ok: boolean; defectRefused: boolean; detail: string }
function equal(a: Raster | null, b: Raster): boolean {
  return a !== null && a.width === b.width && a.height === b.height && a.data.every((v, i) => v === b.data[i]);
}
function white(w: number, h: number): Raster { const r = newRaster(w, h); r.data.fill(255); return r; }
function paste(source: Raster, target: Raster, dx: number, dy: number): void {
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    target.data.set(source.data.subarray((y * source.width + x) * 4, (y * source.width + x + 1) * 4), ((dy + y) * target.width + dx + x) * 4);
  }
}
function transpose(source: Raster): Raster {
  const target = newRaster(source.height, source.width);
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    target.data.set(source.data.subarray((y * source.width + x) * 4, (y * source.width + x + 1) * 4), (x * target.width + y) * 4);
  }
  return target;
}
export function validationInputReadings(input: string): Record<'crop' | 'transpose' | 'headBox', ValidationReading> {
  const image = readPng(join(input, 'inputs', 'painting.png'));
  const full = readLayers(join(input, 'inputs', 'layers', 'full'));
  const face = full.layers.find(layer => layer.name === 'face');
  if (face === undefined) throw new Error('validation full run has no declared face');
  const side = face.right - face.left;
  const box: [number, number, number, number] = [face.left, face.top, face.right, face.top + side];
  const crop = newRaster(side, side), shifted = newRaster(side, side);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const at = ((box[1] + y) * image.width + box[0] + x) * 4;
    crop.data.set(image.data.subarray(at, at + 4), (y * side + x) * 4);
    shifted.data.set(image.data.subarray(at + 4, at + 8), (y * side + x) * 4);
  }
  const through = loadConfig(join(input, 'config.json')).seethrough;
  if (through === undefined) throw new Error('validation config has no declared See-through settings');
  const gotCrop = makeInputs(image, { seethrough: { ...through, head_box: box } }, 'validation crop');
  const portrait = white(image.width, image.height + 32); paste(image, portrait, 0, 16);
  const expected = white(portrait.height, portrait.height); paste(portrait, expected, 16, 0);
  const gotPortrait = makeInputs(portrait, {}, 'validation portrait');
  const landscape = transpose(portrait), expectedTurn = transpose(expected);
  const gotTurn = makeInputs(landscape, {}, 'validation landscape');
  const topAligned = white(expectedTurn.width, expectedTurn.height); paste(landscape, topAligned, 0, 0);
  const head = proposeHeadBox(full, { w: image.width, h: image.height });
  const config = JSON.parse(readFileSync(join(input, 'config.json'), 'utf8')) as { seethrough: { head_box: number[] } };
  const matches = (value: readonly number[]): boolean => value.join(',') === head.head_box.join(',');
  const wrong = [...config.seethrough.head_box]; wrong[0]++;
  return {
    crop: { ok: equal(gotCrop.full, image) && equal(gotCrop.head, crop), defectRefused: !equal(shifted, crop), detail: `full ${image.width}x${image.height} unchanged; head ${box.join(',')} checked by independent row strides; one-pixel shifted crop differs` },
    transpose: { ok: equal(gotPortrait.full, expected) && equal(gotTurn.full, expectedTurn) && gotPortrait.padLeft === 16 && gotPortrait.padTop === 0 && gotTurn.padLeft === 0 && gotTurn.padTop === 16,
      defectRefused: !equal(topAligned, expectedTurn), detail: `portrait ${portrait.width}x${portrait.height}, left 16; landscape ${landscape.width}x${landscape.height}, top 16; independent white-square oracle, top-aligned defect differs` },
    headBox: { ok: matches(config.seethrough.head_box), defectRefused: !matches(wrong), detail: `declared ${config.seethrough.head_box.join(',')}; proposed ${head.head_box.join(',')}; shifted declaration refused` },
  };
}
