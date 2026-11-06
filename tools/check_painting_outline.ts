/** Known coverage at a busy-ground silhouette's first inner ring (#1152). */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleConfig, writeAssembleFixture, writeRun } from '../fixtures/assemble_fixture.ts';
import { assemble, stageFields } from '../src/assemble.ts';
import { loadConfig } from '../src/config.ts';
import { readWrapperLayers } from '../src/layers.ts';
import { readPng, writePng } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
const SIZE = 64;
const COVERAGE = 180;
const SAMPLE = [31, 32] as const;
const GROUND = [200, 60, 60] as const;

function knownCoverage(directory: string, foreground: number): { alpha: number; straight: number[]; overGround: number[]; truth: number[] } {
  const painting = newRaster(SIZE, SIZE);
  const layer = newRaster(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const offset = (y * SIZE + x) * 4;
    const background = x < 40 ? GROUND : [40, 120, 180];
    const inside = y >= 4 && y < 60 && x >= 4 && x < 32;
    const alpha = !inside ? 0 : x === 31 ? COVERAGE : 255;
    const colour = x === 31 ? foreground : 230;
    layer.data.set([colour, colour, colour, alpha], offset);
    painting.data.set([...background.map(c => Math.round((colour * alpha + c * (255 - alpha)) / 255)), 255], offset);
  }
  const config = assembleConfig({ plan: [['surface', 'full', 'topwear']], extend: [], resolution: SIZE, rigScale: 1, headBox: [0, 0, SIZE, SIZE] });
  const declaration = config.assemble as Record<string, unknown>;
  declaration.ground = 'busy';
  declaration.project = 'visible';
  writeAssembleFixture(directory, config, painting, { full: [{ name: 'topwear', depth: 0.5, rects: [{ x0: 0, y0: 0, x1: SIZE, y1: SIZE, colour: [230, 230, 230] }] }], head: [] });
  writeRun(join(directory, 'full'), [{ name: 'topwear', depth: 0.5, rects: [{ x0: 0, y0: 0, x1: SIZE, y1: SIZE, colour: [230, 230, 230] }] }], SIZE);
  writeRun(join(directory, 'head'), [{ name: 'face', depth: 0.5, rects: [{ x0: 16, y0: 16, x1: 24, y1: 24, colour: [230, 230, 230] }] }], SIZE);
  writePng(join(directory, 'full', 'parts', 'topwear.png'), layer);
  const loaded = loadConfig(join(directory, 'config.json'));
  if (loaded.assemble.project !== 'visible' || loaded.assemble.ground !== 'busy') throw new Error('outline fixture must declare visible busy ground');
  const input = {
    source: readPng(join(directory, 'painting.png')),
    full: readWrapperLayers(join(directory, 'full')),
    head: readWrapperLayers(join(directory, 'head')),
    ...stageFields(loaded),
    projectRule: loaded.assemble.project, seamRule: 'near-white' as const,
  };
  const output = assemble(input);
  const part = output.images.find(q => q.record.name === 'surface')!;
  const [x, y] = SAMPLE;
  const offset = ((y - part.record.y) * part.image.width + x - part.record.x) * 4;
  const rgba = Array.from(part.image.data.subarray(offset, offset + 4));
  return {
    alpha: rgba[3], straight: rgba.slice(0, 3),
    overGround: GROUND.map((c, i) => Math.round((rgba[i] * rgba[3] + c * (255 - rgba[3])) / 255)),
    truth: Array.from(painting.data.subarray((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3)),
  };
}

export function runPaintingOutlineChecks(say: Say): void {
  const directory = mkdtempSync(join(tmpdir(), 'painting-outline-'));
  try {
    for (const [name, foreground] of [['DARK_OUTLINE', 40], ['GRADED_COVERAGE', 120]] as const) {
      const sample = knownCoverage(join(directory, name), foreground);
      const error = Math.abs(sample.alpha - COVERAGE);
      say(`ED1152_BUSY_${name}_RETAINS_KNOWN_ALPHA`, error === 0,
        `alpha ${sample.alpha}, truth ${COVERAGE}, absolute error ${error}; straight ${sample.straight}; over ground ${sample.overGround}, painting ${sample.truth}`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  let failures = 0;
  runPaintingOutlineChecks((name, pass, detail) => {
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
    if (!pass) failures++;
  });
  process.exitCode = failures > 0 ? 1 : 0;
}
