/** Seeded, painting-matched additions to one planned part (#1000). */
import { dirname, resolve } from 'node:path';
import type { AssembleConfig, Run } from './config.ts';
import { PartsError, refuseIfAny } from './errors.ts';
import { editedRunImages, fileSha256, missingReceipts, type ReceiptLedger } from './editreceipt.ts';
import { makeInputs } from './inputs.ts';
import { OPAQUE_ALPHA_ABOVE, readLayers, type Layer, type LayerSet } from './layers.ts';
import { connectedComponents } from './raster/components.ts';
import { readPng } from './raster/png.ts';
import { resize } from './raster/resize.ts';
import { newMask, newRaster, type Raster } from './raster/types.ts';
import type { SetupPainting } from './setuppainting.ts';
import type { TakeLayers } from './takelayers.ts';

export interface TakeRegion {
  run: Run;
  run_dir: string;
  st_input: string;
  part: string;
  /** One integer pixel on the target run canvas, x right and y down. */
  seed: [number, number];
  /** PNG bytes, explicitly bound to the stage source or a separate painting. */
  reference?: { source: true; sha256: string } | { painting: string; sha256: string };
}
export type TakeDeclaration = TakeLayers | TakeRegion;
export interface RegionReading {
  part: string;
  run: Run;
  run_dir: string;
  pixels: number;
  /** Run pixels, [left, top, width, height]. */
  box: [number, number, number, number];
  painting_match_share: number;
  rgb_tolerance: number;
}
const IMPLICIT_REFERENCE_WARNING = 'ASSEMBLE_REGION_TAKE_REFERENCE_IMPLICIT';

type Runs = { full: LayerSet; head: LayerSet; single: boolean; notes: string[] };

function refuse(code: string, object: string, detail: string): never {
  throw new PartsError([{ code, object, detail }]);
}

/** Mirrors setupPaintingLine, src/setuppainting.ts:117-122. Agreement is
 * checked through that function's public signature, including alpha rounding. */
export function regionPaintingDelta(source: Raster, donor: Raster, sourceOffset: number, donorOffset: number): number {
  let delta = 0;
  for (let channel = 0; channel < 3; channel++) {
    const white = (image: Raster, offset: number): number => Math.round(
      image.data[offset + channel] * image.data[offset + 3] / 255 + 255 * (1 - image.data[offset + 3] / 255),
    );
    delta = Math.max(delta, Math.abs(white(source, sourceOffset) - white(donor, donorOffset)));
  }
  return delta;
}

function offsetAt(layer: Layer, x: number, y: number): number | null {
  if (x < layer.left || x >= layer.right || y < layer.top || y >= layer.bottom) return null;
  return ((y - layer.top) * layer.pixels.width + x - layer.left) * 4;
}

/** Copy exactly the seed's 8-connected qualifying component. Inputs stay intact. */
export function deriveTakenRegion(base: Layer, donor: Layer, painting: Raster, seed: readonly [number, number], tolerance: number, at: string): { layer: Layer; reading: Omit<RegionReading, 'part' | 'run' | 'run_dir'> } {
  const { width, height } = painting;
  const qualifying = newMask(width, height);
  let candidates = 0;
  for (let y = donor.top; y < donor.bottom; y++) for (let x = donor.left; x < donor.right; x++) {
    const donorOffset = offsetAt(donor, x, y)!;
    const baseOffset = offsetAt(base, x, y);
    if (baseOffset !== null && base.pixels.data[baseOffset + 3] >= 128) continue;
    if (donor.pixels.data[donorOffset + 3] < 128) continue;
    if (regionPaintingDelta(painting, donor.pixels, (y * width + x) * 4, donorOffset) > tolerance) continue;
    qualifying.data[y * width + x] = 1;
    candidates++;
  }
  if (candidates === 0) return refuse('ASSEMBLE_REGION_TAKE_EMPTY', at, 'derived 0 qualifying run pixels; base alpha < 128, donor alpha >= 128 and painting match within the declared setup_painting.rgb_tolerance are required');
  const [sx, sy] = seed;
  if (!Number.isSafeInteger(sx) || !Number.isSafeInteger(sy) || sx < 0 || sy < 0 || sx >= width || sy >= height || qualifying.data[sy * width + sx] !== 1) {
    return refuse('ASSEMBLE_REGION_TAKE_SEED', at, `seed [${seed.join(', ')}] touches no qualifying component on the ${width}x${height} run canvas; an integer qualifying pixel is required`);
  }
  const components = connectedComponents(qualifying, 8);
  const label = components.labels[sy * width + sx];
  const stats = components.stats[label];
  const left = Math.min(base.left, stats.left), top = Math.min(base.top, stats.top);
  const right = Math.max(base.right, stats.left + stats.width), bottom = Math.max(base.bottom, stats.top + stats.height);
  const pixels = newRaster(right - left, bottom - top);
  for (let y = base.top; y < base.bottom; y++) for (let x = base.left; x < base.right; x++) {
    const from = offsetAt(base, x, y)!;
    pixels.data.set(base.pixels.data.subarray(from, from + 4), ((y - top) * pixels.width + x - left) * 4);
  }
  for (let y = stats.top; y < stats.top + stats.height; y++) for (let x = stats.left; x < stats.left + stats.width; x++) {
    if (components.labels[y * width + x] !== label) continue;
    const from = offsetAt(donor, x, y)!;
    pixels.data.set(donor.pixels.data.subarray(from, from + 4), ((y - top) * pixels.width + x - left) * 4);
  }
  let opaquePx = 0;
  for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i] > OPAQUE_ALPHA_ABOVE) opaquePx++;
  return {
    layer: { ...base, pixels, left, top, right, bottom, opaquePx },
    reading: { pixels: stats.area, box: [stats.left, stats.top, stats.width, stats.height], painting_match_share: 1, rgb_tolerance: tolerance },
  };
}

/** Called beside whole-layer take, before assembly or any output emission. */
export function applyTakenRegions(runs: Runs, painting: Raster, cfg: AssembleConfig, configPath: string, setup: SetupPainting | undefined, receipts: ReceiptLedger, sourcePath?: string): Runs {
  const declarations = (cfg.assemble.take ?? []).filter((item): item is TakeRegion => 'part' in item);
  if (declarations.length === 0) return runs;
  const tolerance = setup?.rgb_tolerance;
  if (typeof tolerance !== 'number' || !Number.isSafeInteger(tolerance) || tolerance < 0 || tolerance > 255) {
    return refuse('ASSEMBLE_REGION_TAKE_TOLERANCE', 'config.assemble.take', 'a region take requires --requirements declaring setup_painting.rgb_tolerance, the same authored integer check reads; no default is supplied');
  }
  if (cfg.depth !== undefined || [...runs.full.layers, ...runs.head.layers].some(layer => layer.depthSheet !== undefined)) {
    return refuse('ASSEMBLE_REGION_TAKE_BINDING', 'config.assemble.take', 'active scalar depth sheets have no region donor binding; a run without active scalar depth is required');
  }
  const lists = { full: [...runs.full.layers], head: [...runs.head.layers] };
  const notes = [...runs.notes];
  if (declarations.some(item => item.reference === undefined)) {
    notes.push(`WARN  ${IMPLICIT_REFERENCE_WARNING}: config.assemble.take — reference is absent; uses --source for the colour predicate; declare reference to bind its PNG sha256`);
  }
  const seen = new Set<string>();
  for (const declaration of declarations) {
    const at = `config.assemble.take part "${declaration.part}" from "${declaration.run_dir}"`;
    const plan = cfg.assemble.plan.find(entry => entry[0] === declaration.part && entry[1] === declaration.run);
    if (plan === undefined) return refuse('ASSEMBLE_REGION_TAKE_PART', at, `requires a plan part named "${declaration.part}" in target run "${declaration.run}"`);
    const key = `${plan[1]}:${plan[2]}`;
    if (seen.has(key) || (cfg.assemble.take ?? []).some(item => 'tags' in item && item.run === plan[1] && item.tags.includes(plan[2]))) {
      return refuse('ASSEMBLE_REGION_TAKE_PART', at, `target ${key} is taken more than once; one region donor or whole-layer donor per target is required`);
    }
    seen.add(key);
    const reference = declaration.reference;
    let referencePainting = painting;
    let referenceHash: string | undefined;
    if (reference !== undefined) {
      const referencePath = 'source' in reference ? sourcePath : resolve(dirname(resolve(configPath)), reference.painting);
      try {
        if (referencePath === undefined) throw new Error('source path is absent');
        referenceHash = fileSha256(referencePath);
        referencePainting = readPng(referencePath);
      } catch { return refuse('ASSEMBLE_REGION_TAKE_REFERENCE', at, 'reference must name a readable PNG with its declared sha256; a source binding requires the stage source path'); }
      if (referenceHash !== reference.sha256 || referencePainting.width !== painting.width || referencePainting.height !== painting.height) {
        return refuse('ASSEMBLE_REGION_TAKE_REFERENCE_MATCH', at, `reference sha256 ${referenceHash}, expected ${reference.sha256}; reference ${referencePainting.width}x${referencePainting.height}, source ${painting.width}x${painting.height}; matching hash and painting dimensions are required`);
      }
    }
    const inputs = makeInputs(referencePainting, cfg, reference === undefined ? 'region take painting' : 'region take reference');
    const set = runs[declaration.run];
    const donor = readLayers(resolve(dirname(resolve(configPath)), declaration.run_dir));
    refuseIfAny(missingReceipts(receipts, editedRunImages(
      { full: donor, head: donor, single: true },
      `region take "${declaration.run}:${declaration.part}" donor "${declaration.run_dir}" `,
    )));
    const target = declaration.run === 'head' ? inputs.head : runs.single && set.canvas.w !== set.canvas.h ? referencePainting : inputs.full;
    let supplied: Raster;
    try { supplied = readPng(resolve(dirname(resolve(configPath)), declaration.st_input)); }
    catch { return refuse('ASSEMBLE_REGION_TAKE_GEOMETRY', at, `st_input "${declaration.st_input}" must name the original readable donor input PNG so its geometry can be checked`); }
    if ((declaration.run === 'head' && runs.single) || target === null || donor.canvas.w !== set.canvas.w || donor.canvas.h !== set.canvas.h || supplied.width !== target.width || supplied.height !== target.height || supplied.data.some((byte, i) => byte !== target.data[i])) {
      return refuse('ASSEMBLE_REGION_TAKE_GEOMETRY', at, `donor canvas ${donor.canvas.w}x${donor.canvas.h}, target canvas ${set.canvas.w}x${set.canvas.h}, donor input ${supplied.width}x${supplied.height}; equal canvases and exact target input RGBA are required to establish one crop; cropped donors await #973`);
    }
    const base = lists[declaration.run].find(layer => layer.name === plan[2]);
    const material = donor.layers.find(layer => layer.name === plan[2]);
    if (base === undefined || material === undefined) return refuse('ASSEMBLE_REGION_TAKE_PART', at, `tag "${plan[2]}" is absent from ${base === undefined ? 'the base' : 'the donor'} run; both must hold the plan part's tag`);
    if (base.depthSheet !== undefined || material.depthSheet !== undefined || [...set.hidden, ...donor.hidden].some(layer => layer.of === plan[2])) {
      return refuse('ASSEMBLE_REGION_TAKE_BINDING', at, 'hidden companions or active depth sheets require independent region bindings; a part without those companions is required');
    }
    const source = resize(target, set.canvas.w, set.canvas.h, 'lanczos3');
    const derived = deriveTakenRegion(base, material, source, declaration.seed, tolerance, at);
    lists[declaration.run] = lists[declaration.run].map(layer => layer === base ? derived.layer : layer);
    const reading: RegionReading = { part: declaration.part, run: declaration.run, run_dir: declaration.run_dir, ...derived.reading };
    const pad = target === referencePainting ? [0, 0] : declaration.run === 'head' ? inputs.headBox! : [-inputs.padLeft, -inputs.padTop];
    const transform = { scale: [set.canvas.w / target.width, set.canvas.h / target.height], origin: [pad[0], pad[1]], filter: 'lanczos3' };
    if (reference !== undefined) notes.push(`region reference ${reading.run}:${reading.part}: sha256 ${referenceHash}; binding ${'source' in reference ? 'source' : 'painting'}; painting-to-run ${JSON.stringify(transform)}`);
    notes.push(`region take ${reading.run}:${reading.part} from ${reading.run_dir}: ${reading.pixels} run px; box [${reading.box.join(', ')}] (left, top, width, height); painting-match share ${reading.painting_match_share}; RGB tolerance ${reading.rgb_tolerance}; seed [${declaration.seed.join(', ')}], 8-connected`);
  }
  const full = { ...runs.full, layers: lists.full };
  return { full, head: runs.single ? full : { ...runs.head, layers: lists.head }, single: runs.single, notes };
}
