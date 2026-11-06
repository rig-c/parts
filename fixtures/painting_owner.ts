import { join } from 'node:path';
import { assembleConfig, writeAssembleFixture } from './assemble_fixture.ts';
import { type AssembleInput, stageFields } from '../src/assemble.ts';
import { loadConfig } from '../src/config.ts';
import { readWrapperLayers } from '../src/layers.ts';
import { readPng } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';

/** Generated strip with independent painting and layer colours (#1038). */
export function paintingOwnerFixture(directory: string, ownerZero = false): AssembleInput {
  writeAssembleFixture(directory, assembleConfig());
  const base = {
    source: readPng(join(directory, 'painting.png')),
    full: readWrapperLayers(join(directory, 'full')),
    head: readWrapperLayers(join(directory, 'head')),
    ...stageFields(loadConfig(join(directory, 'config.json'))),
  };
  const painting = newRaster(64, 64), behind = newRaster(64, 64), front = newRaster(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const offset = (y * 64 + x) * 4;
    painting.data.set([255, 255, 255, 255], offset);
    if (x < 4 || x >= 60 || y < 4 || y >= 60) continue;
    behind.data.set([230, 220, 210, 255], offset);
    front.data.set([20, 40, 60, x < 32 ? 255 : x < 35 ? (y >= 32 ? 95 : 5) : 0], offset);
    painting.data.set(x < 32 ? [20, 40, 60, 255] : x === 32
      ? (y >= 32 ? [30, 50, 70, 255] : [80, 90, 100, 255]) : [120, 130, 140, 255], offset);
    if (ownerZero && (x === 31 || x === 32)) painting.data.set([120, 130, 140, 255], offset);
    if (ownerZero && x === 31) front.data[offset + 3] = 180;
  }
  const layers = [
    { ...base.full.layers.find(l => l.name === 'topwear')!, pixels: behind, left: 0, top: 0, right: 64, bottom: 64, opaquePx: 3136 },
    { ...base.full.layers.find(l => l.name === 'bottomwear')!, pixels: front, left: 0, top: 0, right: 64, bottom: 64, opaquePx: 28 * 56 + 3 * 28 },
  ];
  return {
    ...base, source: painting, full: { ...base.full, layers }, head: { ...base.head, layers: [] },
    resolution: 64, headBox: [0, 0, 64, 64], rigScale: 1,
    plan: [['behind', 'full', 'topwear'], ['front', 'full', 'bottomwear']],
    extend: [], seamRule: 'near-white', projectRule: 'visible', stageMap: true,
  };
}
