/** Layer identity receipts, retained independently of part names and derived geometry. */
import { createHash } from 'node:crypto';
import type { Raster } from './raster/types.ts';
import type { Problem } from './errors.ts';
import { readLayerTag } from './tags.ts';
export interface TakenLayerTransport {
  crop: [number, number, number, number];
  donor_canvas: [number, number];
  target_canvas: [number, number];
  scale: [number, number];
  translate: [number, number];
  filter: 'exact' | 'bilinear';
  input_rgba_sha256: string;
  before_rgba_sha256: string;
  after_rgba_sha256: string;
}
/** Verify a transported run canvas against its sealed receipt before downstream assembly. */
export function takenTransportProblems(transport: TakenLayerTransport, image: Raster, at: string): Problem[] {
  const actual = createHash('sha256').update(image.data).digest('hex');
  if (image.width !== transport.target_canvas[0] || image.height !== transport.target_canvas[1] || actual !== transport.after_rgba_sha256) {
    return [{ code: 'PARTS_TAKEN_LAYERS', object: at,
      detail: `transported canvas ${image.width}x${image.height}, RGBA sha256 ${actual}; receipt requires ${transport.target_canvas.join('x')}, RGBA sha256 ${transport.after_rgba_sha256}` }];
  }
  return [];
}
export interface TakenLayerSource {
  run: 'full' | 'head';
  tag: string;
  run_dir: string;
  st_input: string;
  prompt_id: string;
  seed: number;
  support_px: number;
  checked_px: number;
  differing_px: 0;
  transport?: TakenLayerTransport;
}
export function unionTakenSources(lists: readonly (readonly TakenLayerSource[] | undefined)[]): TakenLayerSource[] {
  const out: TakenLayerSource[] = [];
  for (const list of lists) for (const item of list ?? []) if (!out.some(p => p.run === item.run && p.tag === item.tag && p.run_dir === item.run_dir)) out.push(item);
  return out;
}
/** Strict parts reader: unknown fields and partial or invented identity receipts are refused. */
export function takenSourceProblems(value: unknown, at: string): Problem[] {
  const problems: Problem[] = [];
  const fail = (detail: string): void => { problems.push({ code: 'PARTS_TAKEN_LAYERS', object: at, detail }); };
  const keys = ['run', 'tag', 'run_dir', 'st_input', 'prompt_id', 'seed', 'support_px', 'checked_px', 'differing_px'];
  if (!Array.isArray(value) || value.length === 0) { fail('a non-empty list of verified layer sources is required'); return problems; }
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) { fail('each source must be a complete identity receipt'); continue; }
    const o = item as Record<string, unknown>;
    const tag = typeof o.tag === 'string' ? readLayerTag(o.tag) : null;
    if (Object.keys(o).some(k => !keys.includes(k) && k !== 'transport') || keys.some(k => !(k in o)) ||
        (o.run !== 'full' && o.run !== 'head') || tag === null || tag.group === 'author' ||
        ['run_dir', 'st_input', 'prompt_id'].some(k => typeof o[k] !== 'string' || !(o[k] as string).trim()) ||
        !Number.isSafeInteger(o.seed) || (o.seed as number) < 0 ||
        ['support_px', 'checked_px'].some(k => !Number.isSafeInteger(o[k]) || (o[k] as number) <= 0) || o.differing_px !== 0) {
      fail('each source requires exactly run, See-through tag, run_dir, st_input, prompt_id, nonnegative safe integer seed, positive support_px/checked_px and differing_px 0'); continue;
    }
    if (o.transport !== undefined) {
      const t = o.transport as Record<string, unknown> | null;
      const fields = ['crop', 'donor_canvas', 'target_canvas', 'scale', 'translate', 'filter', 'input_rgba_sha256', 'before_rgba_sha256', 'after_rgba_sha256'];
      const pair = (v: unknown, positive: boolean, integer: boolean): v is number[] => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n) && (!positive || n > 0) && (!integer || Number.isSafeInteger(n)));
      if (typeof t !== 'object' || t === null || Array.isArray(t) || Object.keys(t).length !== fields.length || fields.some(k => !(k in t)) ||
          !Array.isArray(t.crop) || t.crop.length !== 4 || !t.crop.every(n => Number.isSafeInteger(n) && n >= 0) || t.crop[2] <= t.crop[0] || t.crop[3] <= t.crop[1] ||
          !pair(t.donor_canvas, true, true) || !pair(t.target_canvas, true, true) || !pair(t.scale, true, false) || !pair(t.translate, false, false) ||
          (t.filter !== 'exact' && t.filter !== 'bilinear') ||
          ['input_rgba_sha256', 'before_rgba_sha256', 'after_rgba_sha256'].some(k => typeof t[k] !== 'string' || !/^[0-9a-f]{64}$/.test(t[k] as string))) {
        fail('transport requires exactly crop, donor_canvas, target_canvas, scale, translate, filter and three lowercase RGBA SHA-256 hashes');
      } else if ((t.filter === 'exact') !== (t.scale[0] === 1 && t.scale[1] === 1 && t.translate.every(Number.isSafeInteger))) {
        fail('transport filter exact requires unit scale and integer translation; every other map requires bilinear');
      }
    }
    const key = JSON.stringify([o.run, o.tag, o.run_dir]);
    if (seen.has(key)) fail(`duplicate source ${key}; each source must appear once`);
    seen.add(key);
  }
  return problems;
}
