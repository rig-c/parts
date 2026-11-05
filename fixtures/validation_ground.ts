/** A declared white margin keeps original sample art out of the ground ring. */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configFileReferences } from '../src/config.ts';
import { readPng, encodePngBytes } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';

export function validationGroundView(input: string, output: string): string {
  const margin = 8;
  const painting = readPng(join(input, 'inputs', 'painting.png'));
  const padded = newRaster(painting.width + margin * 2, painting.height + margin * 2); padded.data.fill(255);
  for (let y = 0; y < painting.height; y++) padded.data.set(painting.data.subarray(y * painting.width * 4, (y + 1) * painting.width * 4), ((y + margin) * padded.width + margin) * 4);
  const images = join(output, 'inputs'); mkdirSync(images, { recursive: true });
  writeFileSync(join(images, 'painting.png'), encodePngBytes(padded));
  cpSync(join(input, 'inputs', 'layers'), join(images, 'layers'), { recursive: true });
  for (const run of ['full', 'head']) {
    const file = join(images, 'layers', run, 'layers.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as { width: number; height: number; layers: Array<{ left: number; top: number; right: number; bottom: number }> };
    manifest.width += margin * 2; manifest.height += margin * 2;
    for (const layer of manifest.layers) { layer.left += margin; layer.right += margin; layer.top += margin; layer.bottom += margin; }
    writeFileSync(file, JSON.stringify(manifest));
  }
  const raw = JSON.parse(readFileSync(join(input, 'config.json'), 'utf8')) as Record<string, unknown>;
  for (const reference of configFileReferences(raw)) reference.set(join(input, reference.value));
  const through = raw.seethrough as { head_box: number[]; resolution: number };
  through.head_box = [0, 0, padded.width, padded.height]; through.resolution += margin * 2;
  const point = (p: number[]): number[] => p.map(v => v + margin);
  for (const bone of raw.bones as Array<{ at?: number[]; points?: number[][]; tip?: number[] }>) {
    if (bone.at !== undefined) bone.at = point(bone.at);
    if (bone.tip !== undefined) bone.tip = point(bone.tip);
    if (bone.points !== undefined) bone.points = bone.points.map(point);
  }
  for (const mesh of Object.values(raw.meshes as Record<string, { segments: Array<string | [string, number[], number[]]> }>)) {
    mesh.segments = mesh.segments.map(segment => typeof segment === 'string' ? segment : [segment[0], point(segment[1]), point(segment[2])]);
  }
  writeFileSync(join(output, 'config.json'), JSON.stringify(raw));
  return output;
}
