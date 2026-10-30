/** Verified replacement in an existing full/head run; never writes or forges a run manifest. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { EarlyConfig, PlanEntry, Run } from './config.ts';
import { CORE_KERNEL, fullPlanBand } from './assemble.ts';
import { makeInputs } from './inputs.ts';
import { OPAQUE_ALPHA_ABOVE, readLayers, type Layer, type LayerSet } from './layers.ts';
import { PartsError, refuseIfAny, type Problem } from './errors.ts';
import { dilate } from './raster/morph.ts';
import { newMask, type Raster } from './raster/types.ts';
import { readPng } from './raster/png.ts';
import type { TakenLayerSource } from './takesource.ts';

export interface TakeLayers {
  run: Run;
  run_dir: string;
  /** The exact PNG supplied to See-through, resolved from the config directory. */
  st_input: string;
  tags: string[];
}
function refuse(code: string, object: string, detail: string): never { throw new PartsError([{ code, object, detail }]); }
function metadata(path: string): { prompt_id: string; seed: number } {
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { return refuse('ASSEMBLE_TAKE_META', path, 'a readable meta.json with prompt_id and seed from the donor run is required'); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return refuse('ASSEMBLE_TAKE_META', path, 'a metadata object with prompt_id and seed is required');
  const o = value as Record<string, unknown>;
  if (typeof o.prompt_id !== 'string' || !o.prompt_id.trim() || !Number.isSafeInteger(o.seed) || (o.seed as number) < 0) return refuse('ASSEMBLE_TAKE_META', path, 'a nonempty prompt_id and nonnegative safe integer seed are required; neither is invented');
  return { prompt_id: o.prompt_id, seed: o.seed as number };
}
function identity(layer: Layer, canvas: LayerSet['canvas'], donor: Raster, target: Raster, object: string): { support: number; checked: Uint8Array } {
  const mask = newMask(canvas.w, canvas.h); let support = 0;
  for (let y = 0; y < layer.pixels.height; y++) for (let x = 0; x < layer.pixels.width; x++) if (layer.pixels.data[(y * layer.pixels.width + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE) {
    mask.data[(layer.top + y) * canvas.w + layer.left + x] = 1; support++;
  }
  if (support === 0) return refuse('ASSEMBLE_TAKE_SUPPORT', object, `has 0 pixels of alpha above ${OPAQUE_ALPHA_ABOVE}; a nonempty taken layer is required`);
  const grown = dilate(mask, CORE_KERNEL, CORE_KERNEL);
  const checked = new Uint8Array(target.width * target.height);
  // A run pixel is a cell on st_input, not a sample that can be rounded to a
  // neighbouring centre. Compare EVERY intersecting input cell before any resize.
  for (let y = 0; y < canvas.h; y++) for (let x = 0; x < canvas.w; x++) if (grown.data[y * canvas.w + x] === 1) {
    for (let iy = Math.floor(y * target.height / canvas.h); iy < Math.ceil((y + 1) * target.height / canvas.h); iy++)
      for (let ix = Math.floor(x * target.width / canvas.w); ix < Math.ceil((x + 1) * target.width / canvas.w); ix++) checked[iy * target.width + ix] = 1;
  }
  let differing = 0, x0 = target.width, y0 = target.height, x1 = 0, y1 = 0;
  for (let p = 0; p < checked.length; p++) if (checked[p] === 1 && [0, 1, 2, 3].some(c => donor.data[p * 4 + c] !== target.data[p * 4 + c])) {
    differing++; const x = p % target.width, y = Math.floor(p / target.width); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
  }
  if (differing > 0) return refuse('ASSEMBLE_TAKE_INPUT_IDENTITY', object, `${differing} differing pixel(s), bbox [${x0}, ${y0}, ${x1}, ${y1}] in st_input pixels (right/bottom exclusive); exact RGBA identity under alpha > ${OPAQUE_ALPHA_ABOVE}, grown by ${CORE_KERNEL}x${CORE_KERNEL}, is required`);
  return { support, checked };
}
export function takeLayerNote(source: TakenLayerSource): string {
  return `take ${source.run}:${source.tag} from ${source.run_dir}; prompt_id ${source.prompt_id}; seed ${source.seed}; st_input ${source.st_input}; support ${source.support_px} run px; checked ${source.checked_px} input px; differing ${source.differing_px}; alpha > ${OPAQUE_ALPHA_ABOVE}, ${CORE_KERNEL}x${CORE_KERNEL} margin`;
}
/** Intersection of original alpha supports in the common target-run canvas; no bbox or dilation proxy. */
function supportOverlap(a: Layer, b: Layer): number {
  let px = 0;
  for (let y = Math.max(a.top, b.top); y < Math.min(a.bottom, b.bottom); y++)
    for (let x = Math.max(a.left, b.left); x < Math.min(a.right, b.right); x++) {
      if (a.pixels.data[((y - a.top) * a.pixels.width + x - a.left) * 4 + 3] > OPAQUE_ALPHA_ABOVE &&
          b.pixels.data[((y - b.top) * b.pixels.width + x - b.left) * 4 + 3] > OPAQUE_ALPHA_ABOVE) px++;
    }
  return px;
}
/** Apply every declaration together, so replacing all tied layers from one run can retain its known order. */
export function applyTakenLayers(runs: { full: LayerSet; head: LayerSet; single: boolean }, painting: Raster, cfg: Pick<EarlyConfig, 'seethrough' | 'depth'> & { assemble: { take?: TakeLayers[]; plan?: PlanEntry[] } }, configPath: string): { full: LayerSet; head: LayerSet; single: boolean; notes: string[] } {
  const declarations = cfg.assemble.take ?? [];
  if (declarations.length === 0) return { ...runs, notes: [] };
  if (cfg.depth !== undefined || [...runs.full.layers, ...runs.head.layers].some(l => l.depthSheet !== undefined)) return refuse('ASSEMBLE_TAKE_DEPTH_SHEET', 'config.assemble.take', 'active scalar depth sheets have no mixed-run binding; disable the depth opt-in or assemble a separately bound run before taking layers (numeric depth_median ordering is retained)');
  const inputs = makeInputs(painting, cfg, 'take target painting');
  const base = dirname(resolve(configPath));
  const lists = { full: [...runs.full.layers], head: [...runs.head.layers] };
  const origins = new Map<Layer, string>();
  const notes: string[] = [], seen = new Set<string>();
  for (const d of declarations) {
    const at = `config.assemble.take run "${d.run_dir}" (${d.run})`;
    if (d.run === 'head' && runs.single) return refuse('ASSEMBLE_TAKE_GEOMETRY', at, 'there is no --head run; choose full or supply a head run');
    const target = d.run === 'head' ? inputs.head : runs.single && (runs.full.canvas.w !== runs.full.canvas.h) ? painting : inputs.full;
    const set = runs[d.run];
    const donor = readLayers(resolve(base, d.run_dir));
    const meta = metadata(resolve(base, d.run_dir, 'meta.json'));
    let image: Raster;
    try { image = readPng(resolve(base, d.st_input)); } catch { return refuse('ASSEMBLE_TAKE_INPUT', at, `st_input "${d.st_input}" must name the original readable PNG supplied to the donor run`); }
    if (target === null || donor.canvas.w !== set.canvas.w || donor.canvas.h !== set.canvas.h || image.width !== target.width || image.height !== target.height) return refuse('ASSEMBLE_TAKE_GEOMETRY', at, `donor canvas ${donor.canvas.w}x${donor.canvas.h}, target canvas ${set.canvas.w}x${set.canvas.h}, donor st_input ${image.width}x${image.height}, target st_input ${target?.width ?? 0}x${target?.height ?? 0}; equal canvases and equal input dimensions are required (full uses squarePad; head uses head_box)`);
    const union = new Uint8Array(image.width * image.height);
    for (const tag of d.tags) {
      const key = `${d.run}:${tag}`;
      if (seen.has(key)) return refuse('ASSEMBLE_TAKE_UNIQUE', at, `tag "${tag}" replaces ${key} twice; declare one donor per target tag`);
      seen.add(key);
      const layer = donor.layers.find(l => l.name === tag);
      if (layer === undefined) return refuse('ASSEMBLE_TAKE_TAG_IN_RUN', at, `tag "${tag}" is absent; a named See-through tag held by that donor is required`);
      const checked = identity(layer, donor.canvas, image, target, `${at} tag "${tag}"`);
      for (let p = 0; p < union.length; p++) union[p] |= checked.checked[p];
      const source: TakenLayerSource = { run: d.run, tag, run_dir: d.run_dir, st_input: d.st_input, prompt_id: meta.prompt_id, seed: meta.seed, support_px: checked.support, checked_px: checked.checked.reduce((a, b) => a + b, 0), differing_px: 0 };
      const replacement: Layer = { ...layer, takenLayers: [source] };
      lists[d.run] = [...lists[d.run].filter(l => l.name !== tag), replacement];
      origins.set(replacement, resolve(base, d.run_dir));
      notes.push(takeLayerNote(source));
    }
    notes.push(`take union ${d.run} from ${d.run_dir}: checked ${union.reduce((a, b) => a + b, 0)} input px; differing 0`);
  }
  for (const run of ['full', 'head'] as const) {
    const list = lists[run], targetOrigin = resolve(dirname(runs[run].source));
    const origin = (l: Layer): string => origins.get(l) ?? targetOrigin;
    const problems: Problem[] = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (origin(list[i]) !== origin(list[j]) && (list[i].depth === null || list[j].depth === null || list[i].depth === list[j].depth)) problems.push({ code: 'ASSEMBLE_TAKE_DEPTH_AMBIGUOUS', object: `${run}: "${list[i].name}" (${origin(list[i])}) / "${list[j].name}" (${origin(list[j])})`, detail: `depths ${list[i].depth} / ${list[j].depth}; distinct numeric depths across runs are required; manifest order resolves ties only inside the same run` });
    refuseIfAny(problems);
    list.sort((a, b) => a.depth === null || b.depth === null || a.depth === b.depth ? a.drawOrder - b.drawOrder : b.depth - a.depth);
    lists[run] = list.map((l, drawOrder) => ({ ...l, drawOrder }));
    const selected = (cfg.assemble.plan ?? []).filter(p => p[1] === run).map(p => ({ part: p[0], layer: list.find(l => l.name === p[2]) }));
    for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) {
      const a = selected[i], b = selected[j];
      if (a.layer === undefined || b.layer === undefined || origin(a.layer) === origin(b.layer)) continue;
      const overlap = supportOverlap(a.layer, b.layer);
      if (overlap === 0) continue;
      // Only full rows in a two-run plan have the proposer's fallback roles.
      // Head rows and one-run plans retain the scalar order, as do peers in a band.
      const band = !runs.single && run === 'full' ? fullPlanBand(a.layer.name) - fullPlanBand(b.layer.name) : 0;
      const reversed = band === 0 ? list.indexOf(a.layer) > list.indexOf(b.layer) : band > 0;
      if (reversed) problems.push({ code: 'ASSEMBLE_TAKE_PLAN_ORDER', object: `${run} plan parts "${a.part}" / "${b.part}"`, detail: `plan order reverses ${band === 0 ? `mixed-run depths ${a.layer.depth} / ${b.layer.depth}; put the larger depth behind` : `two-run full-layer roles "${a.layer.name}" / "${b.layer.name}"; order back hair, body, headwear/earwear, face, head details, front hair`}; supports overlap at ${overlap} run px (alpha > ${OPAQUE_ALPHA_ABOVE}); use assemble --propose-plan` });
    }
    refuseIfAny(problems);
    const replaced = new Set(declarations.filter(d => d.run === run).flatMap(d => d.tags));
    if (runs[run].hidden.some(l => replaced.has(l.of)) || declarations.some(d => d.run === run && readLayers(resolve(base, d.run_dir)).hidden.some(l => d.tags.includes(l.of)))) return refuse('ASSEMBLE_TAKE_HIDDEN', run, 'a replaced layer has hidden companion art; separate hidden provenance is not declared, so the combination is refused');
  }
  const full = { ...runs.full, layers: lists.full }, head = runs.single ? full : { ...runs.head, layers: lists.head };
  return { full, head, single: runs.single, notes };
}
