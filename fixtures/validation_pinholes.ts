/** One missing texel in an original synthetic block, in an independent copy. */
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPng, encodePngBytes } from '../src/raster/png.ts';

export function validationPinholeView(input: string, output: string): string {
  cpSync(input, output, { recursive: true });
  const path = join(output, 'inputs', 'layers', 'full', 'parts', 'topwear.png');
  const image = readPng(path);
  const manifest = JSON.parse(readFileSync(join(output, 'inputs', 'layers', 'full', 'layers.json'), 'utf8')) as { layers: Array<{ name: string; left: number; top: number }> };
  const layer = manifest.layers.find(layer => layer.name === 'topwear');
  if (layer === undefined) throw new Error('validation pinhole needs topwear');
  const x = 80 - layer.left, y = 60 - layer.top;
  if (x < 0 || x >= image.width || y < 0 || y >= image.height || image.data[(y * image.width + x) * 4 + 3] !== 255) throw new Error('declared validation pinhole texel is not opaque topwear');
  image.data[(y * image.width + x) * 4 + 3] = 0;
  writeFileSync(path, encodePngBytes(image));
  writeFileSync(join(output, 'requirements.json'), JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [] }));
  writeFileSync(join(output, 'README.md'), '`ASSEMBLE_PINHOLES: SKIP` — undeclared; the planted missing texel is `80,60 1x1`. See https://github.com/rig-c/parts/issues/953.\n');
  return output;
}
