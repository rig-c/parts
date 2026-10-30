/** Layer identity receipts, retained independently of part names and derived geometry. */
import type { Problem } from './errors.ts';
import { readLayerTag } from './tags.ts';
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
    if (Object.keys(o).some(k => !keys.includes(k)) || keys.some(k => !(k in o)) ||
        (o.run !== 'full' && o.run !== 'head') || tag === null || tag.group === 'author' ||
        ['run_dir', 'st_input', 'prompt_id'].some(k => typeof o[k] !== 'string' || !(o[k] as string).trim()) ||
        !Number.isSafeInteger(o.seed) || (o.seed as number) < 0 ||
        ['support_px', 'checked_px'].some(k => !Number.isSafeInteger(o[k]) || (o[k] as number) <= 0) || o.differing_px !== 0) {
      fail('each source requires exactly run, See-through tag, run_dir, st_input, prompt_id, nonnegative safe integer seed, positive support_px/checked_px and differing_px 0'); continue;
    }
    const key = JSON.stringify([o.run, o.tag, o.run_dir]);
    if (seen.has(key)) fail(`duplicate source ${key}; each source must appear once`);
    seen.add(key);
  }
  return problems;
}
