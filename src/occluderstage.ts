/**
 * The assemble stage's reading of `config.assemble.occluders` (issue #1230):
 * each declaration's image read and held to its sha256 and to the painting's
 * size, each `under` part's selected source layer placed on the rig grid the
 * way the hidden-extent reading places it (after any take, before projection
 * or cleanup), and every copied-colour pixel counted ({@link occluderColourCopies}).
 * It returns WARN lines and changes no output byte.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { checkGeometry, layerToRig, padSingleRun, placeLayer, sourceInRig } from './assemble.ts';
import type { PlanEntry } from './config.ts';
import { PartsError } from './errors.ts';
import type { LayerSet } from './layers.ts';
import { type OccluderDeclaration, occluderColourCopies, occluderColourWarning } from './occluders.ts';
import { decodePngBytes } from './raster/png.ts';
import type { Raster } from './raster/types.ts';

function refuse(code: string, object: string, detail: string): never {
  throw new PartsError([{ code, object, detail }]);
}

export interface OccluderStageInput {
  occluders: readonly OccluderDeclaration[];
  configPath: string;
  source: Raster;
  runs: { full: LayerSet; head: LayerSet; single: boolean };
  plan: readonly PlanEntry[];
  resolution: number;
  headBox: [number, number, number, number];
  rigScale: number;
}

export function occluderStageWarnings(input: OccluderStageInput): string[] {
  const { source, runs } = input;
  const frame = checkGeometry({ sourceW: source.width, sourceH: source.height, resolution: input.resolution, headBox: input.headBox, rigScale: input.rigScale, ...(runs.single ? { single: true } : {}) }, { full: runs.full, head: runs.head });
  const full = runs.single ? padSingleRun(runs.full, frame, input.resolution) : runs.full;
  const painting = sourceInRig(source, frame.W, frame.H);
  const lines: string[] = [];
  input.occluders.forEach((d, i) => {
    const at = `config.assemble.occluders[${i}]`;
    const path = resolve(dirname(resolve(input.configPath)), d.image);
    const bytes = new Uint8Array(readFileSync(path));
    const found = createHash('sha256').update(bytes).digest('hex');
    if (found !== d.sha256) refuse('CONFIG_OCCLUDER_SHA256', `${at}.sha256`, `is ${d.sha256}; ${d.image} has sha256 ${found} — declare the bytes the occluder image holds`);
    const image = decodePngBytes(bytes, path);
    if (image.width !== source.width || image.height !== source.height) {
      refuse('ASSEMBLE_OCCLUDER_GRID', `${at}.image`, `is ${image.width}x${image.height}; the painting's ${source.width}x${source.height} is required — the occluder is read on the painting's grid and never fitted`);
    }
    // A rig pixel reads the occluder at the source pixel its centre falls in.
    const sx = (x: number): number => Math.min(source.width - 1, Math.floor((x + 0.5) * source.width / frame.W));
    const sy = (y: number): number => Math.min(source.height - 1, Math.floor((y + 0.5) * source.height / frame.H));
    const alpha = (x: number, y: number): number => image.data[(sy(y) * source.width + sx(x)) * 4 + 3];
    const parts = d.under.flatMap((name) => {
      const row = input.plan.find(([part]) => part === name);
      if (row === undefined) return [];
      const layer = (row[1] === 'full' ? full : runs.head).layers.find((l) => l.name === row[2]);
      return layer === undefined ? [] : [{ name, image: layerToRig(placeLayer(layer, input.resolution), frame, row[1]) }];
    });
    for (const copy of occluderColourCopies(parts, painting, alpha, d.rgb_within)) lines.push(occluderColourWarning(i, copy, d.rgb_within));
  });
  return lines;
}
