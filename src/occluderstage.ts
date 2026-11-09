/**
 * The assemble stage's reading of `config.assemble.occluders` (issues #1230, #1237):
 * each declaration's image read and held to its sha256 and to the painting's
 * size, each `under` part's selected source layer placed on the rig grid the
 * way the hidden-extent reading places it (after any take, before projection
 * or cleanup), every copied-colour pixel counted ({@link occluderColourCopies}),
 * and each declared `plate` receipt verified and bound to the occluder, the
 * `--source` painting and the base (`--full`) See-through run's input image.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { checkGeometry, layerToRigSplit, occluderCoreMask, padSingleRun, sourceInRig } from './assemble.ts';
import type { PlanEntry } from './config.ts';
import { SHA256_PATTERN } from './editreceipt.ts';
import { PartsError } from './errors.ts';
import type { LayerSet } from './layers.ts';
import {
  type OccluderDeclaration,
  OCCLUDER_PLATE_BASE_RUN,
  OCCLUDER_PLATE_OCCLUDER,
  OCCLUDER_PLATE_PAINTING,
  occluderColourCopies,
  occluderColourWarning,
} from './occluders.ts';
import type { OccluderPlateRecord } from './parts.ts';
import { PLATE_RECEIPT_FILE, type PlateReceipt, sha256, verifyPlateReceipt } from './plate.ts';
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

export interface OccluderPlateBindInput {
  occluders: readonly OccluderDeclaration[];
  configPath: string;
  sourcePath: string;
  fullPath: string;
}

export interface OccluderInput {
  declaration: OccluderDeclaration;
  image: Raster;
}

export function readOccluderInputs(occluders: readonly OccluderDeclaration[], configPath: string, source: Raster): OccluderInput[] {
  return occluders.map((d, i) => {
    const at = `config.assemble.occluders[${i}]`;
    const path = resolve(dirname(resolve(configPath)), d.image);
    const bytes = new Uint8Array(readFileSync(path));
    const found = createHash('sha256').update(bytes).digest('hex');
    if (found !== d.sha256) refuse('CONFIG_OCCLUDER_SHA256', `${at}.sha256`, `is ${d.sha256}; ${d.image} has sha256 ${found} — declare the bytes the occluder image holds`);
    const image = decodePngBytes(bytes, path);
    if (image.width !== source.width || image.height !== source.height) {
      refuse('ASSEMBLE_OCCLUDER_GRID', `${at}.image`, `is ${image.width}x${image.height}; the painting's ${source.width}x${source.height} is required — the occluder is read on the painting's grid and never fitted`);
    }
    return { declaration: d, image };
  });
}

export function occluderStageWarnings(input: OccluderStageInput): string[] {
  const { source, runs } = input;
  const frame = checkGeometry({ sourceW: source.width, sourceH: source.height, resolution: input.resolution, headBox: input.headBox, rigScale: input.rigScale, ...(runs.single ? { single: true } : {}) }, { full: runs.full, head: runs.head });
  const full = runs.single ? padSingleRun(runs.full, frame, input.resolution) : runs.full;
  const painting = sourceInRig(source, frame.W, frame.H);
  const lines: string[] = [];
  const occluderInputs = readOccluderInputs(input.occluders, input.configPath, source);
  const occluderCoreMasks = occluderInputs.map(({ image }) => occluderCoreMask(image, frame.W, frame.H).coreBefore);
  occluderInputs.forEach(({ declaration: d, image }, i) => {
    // A rig pixel reads the occluder at the source pixel its centre falls in.
    const sx = (x: number): number => Math.min(source.width - 1, Math.floor((x + 0.5) * source.width / frame.W));
    const sy = (y: number): number => Math.min(source.height - 1, Math.floor((y + 0.5) * source.height / frame.H));
    const alpha = (x: number, y: number): number => image.data[(sy(y) * source.width + sx(x)) * 4 + 3];
    const parts = d.under.flatMap((name) => {
      const row = input.plan.find(([part]) => part === name);
      if (row === undefined) return [];
      const layer = (row[1] === 'full' ? full : runs.head).layers.find((l) => l.name === row[2]);
      return layer === undefined ? [] : [{ name, image: layerToRigSplit(layer, input.resolution, frame, row[1], occluderCoreMasks) }];
    });
    for (const copy of occluderColourCopies(parts, painting, alpha, d.rgb_within)) lines.push(occluderColourWarning(i, copy, d.rgb_within));
  });
  return lines;
}

/**
 * Verify and bind each declared `config.assemble.occluders[i].plate` (issue #1237):
 * 1. `verifyPlateReceipt` holds the receipt's own schema and sibling files (`plate.png`, `mask.png`).
 * 2. `receipt.occluder.sha256` must equal `config.assemble.occluders[i].sha256` (`ASSEMBLE_OCCLUDER_PLATE_OCCLUDER`).
 * 3. `receipt.painting.sha256` must equal the `--source` painting's sha256 (`ASSEMBLE_OCCLUDER_PLATE_PAINTING`).
 * 4. `receipt.output.sha256` must equal the base (`--full`) See-through run's `meta.json` `image_sha256` (`ASSEMBLE_OCCLUDER_PLATE_BASE_RUN`).
 */
export function bindOccluderPlates(input: OccluderPlateBindInput): OccluderPlateRecord[] {
  const withPlates = input.occluders.map((d, i) => ({ d, i })).filter((x) => x.d.plate !== undefined);
  if (withPlates.length === 0) return [];
  const configDir = dirname(resolve(input.configPath));
  const paintingSha = sha256(new Uint8Array(readFileSync(resolve(input.sourcePath))));
  const fullDir = resolve(input.fullPath);
  const metaPath = existsSync(fullDir) && statSync(fullDir).isDirectory() ? join(fullDir, 'meta.json') : join(dirname(fullDir), 'meta.json');
  const out: OccluderPlateRecord[] = [];
  for (const { d, i } of withPlates) {
    const at = `config.assemble.occluders[${i}].plate`;
    const plateRel = d.plate as string;
    const plateDir = resolve(configDir, plateRel);
    const receiptFile = join(plateDir, PLATE_RECEIPT_FILE);
    if (!existsSync(plateDir) || !statSync(plateDir).isDirectory() || !existsSync(receiptFile) || !statSync(receiptFile).isFile()) {
      refuse('CONFIG_FILE_PRESENT', at, `names ${plateRel} (${plateDir}), which holds no ${PLATE_RECEIPT_FILE}; a comfy plate --mode occluder output directory relative to the config's directory is required`);
    }
    const problems = verifyPlateReceipt(receiptFile);
    if (problems.length > 0) throw new PartsError(problems);
    const receiptBytes = new Uint8Array(readFileSync(receiptFile));
    const receiptSha = sha256(receiptBytes);
    const receipt = JSON.parse(Buffer.from(receiptBytes).toString('utf8')) as PlateReceipt;
    if (receipt.mode !== 'occluder' || receipt.occluder === undefined) {
      refuse('PLATE_RECEIPT_KEYS', at, `names ${receiptFile} with mode ${JSON.stringify(receipt.mode)}; an occluder plate receipt (mode "occluder") is required`);
    }
    if (receipt.occluder.sha256 !== d.sha256) {
      refuse(OCCLUDER_PLATE_OCCLUDER, at, `receipt ${receiptFile} binds occluder.sha256 ${receipt.occluder.sha256}; config.assemble.occluders[${i}].sha256 is ${d.sha256}`);
    }
    if (receipt.painting.sha256 !== paintingSha) {
      refuse(OCCLUDER_PLATE_PAINTING, at, `receipt ${receiptFile} binds painting.sha256 ${receipt.painting.sha256}; --source ${input.sourcePath} has sha256 ${paintingSha}`);
    }
    if (!existsSync(metaPath) || !statSync(metaPath).isFile()) {
      refuse(OCCLUDER_PLATE_BASE_RUN, at, `receipt ${receiptFile} binds output.sha256 ${receipt.output.sha256}, but base run ${input.fullPath} has no meta.json (${metaPath}) to bind image_sha256`);
    }
    let baseRunSha: unknown;
    try {
      baseRunSha = (JSON.parse(readFileSync(metaPath, 'utf8')) as { image_sha256?: unknown }).image_sha256;
    } catch (err) {
      refuse(OCCLUDER_PLATE_BASE_RUN, at, `base run meta.json (${metaPath}) does not parse as JSON: ${(err as Error).message}`);
    }
    if (typeof baseRunSha !== 'string' || !SHA256_PATTERN.test(baseRunSha) || receipt.output.sha256 !== baseRunSha) {
      refuse(OCCLUDER_PLATE_BASE_RUN, at, `receipt ${receiptFile} binds output.sha256 ${receipt.output.sha256}; base (--full) See-through run ${metaPath} image_sha256 is ${typeof baseRunSha === 'string' ? baseRunSha : JSON.stringify(baseRunSha)}`);
    }
    out.push({
      receipt: `${plateRel.replace(/\\/g, '/').replace(/\/+$/, '')}/${PLATE_RECEIPT_FILE}`,
      receipt_sha256: receiptSha,
      occluder_sha256: receipt.occluder.sha256,
      painting_sha256: receipt.painting.sha256,
      output_sha256: receipt.output.sha256,
      mask_sha256: receipt.mask.sha256,
    });
  }
  return out;
}
