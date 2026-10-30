/** Authored source-painting limits over actual renderer setup pixels (#887). */
import { refuseIfAny, type Problem } from './errors.ts';
import type { Raster } from './raster/types.ts';

export const SETUP_PAINTING_LINE = 'SETUP_MATCHES_PAINTING';
export interface SetupPaintingRegion {
  name: string;
  /** Stage pixels, x right/y down: [x, y, width, height], exclusive far edge. */
  box: [number, number, number, number];
  /** Maximum count over the entire named region. Absent means SKIP. */
  max_pixels?: number;
}
export interface SetupPainting {
  /** A pixel counts when its maximum RGB difference is strictly greater. */
  rgb_tolerance: number;
  regions: SetupPaintingRegion[];
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const free = (k: string, v: unknown): boolean => (k.startsWith('x-') && k.length > 2) || ((k === 'note' || k.endsWith('_note')) && typeof v === 'string');

/** Shape only: no default limit, inferred box, art alignment or slot name. */
export function setupPaintingProblems(value: unknown, at: string): Problem[] {
  const problems: Problem[] = [];
  const fail = (where: string, detail: string): void => { problems.push({ code: 'REQUIREMENTS_FIELD', object: where, detail }); };
  const keys = (v: Record<string, unknown>, allowed: string[], where: string): void => {
    for (const k of Object.keys(v)) if (!allowed.includes(k) && !free(k, v[k])) fail(`${where}.${k}`, `is unknown; fields are ${allowed.join(', ')}`);
  };
  if (!object(value)) return [{ code: 'REQUIREMENTS_FIELD', object: at, detail: 'requires {rgb_tolerance, regions: [{name, box, max_pixels?}]}' }];
  keys(value, ['rgb_tolerance', 'regions'], at);
  if (!integer(value.rgb_tolerance) || value.rgb_tolerance < 0 || value.rgb_tolerance > 255) fail(`${at}.rgb_tolerance`, 'requires an authored integer from 0 through 255; difference strictly above it counts');
  if (!Array.isArray(value.regions) || value.regions.length === 0) fail(`${at}.regions`, 'requires a nonempty list of named source-grid regions');
  else {
    const names = new Set<string>();
    value.regions.forEach((r, i) => {
      const where = `${at}.regions[${i}]`;
      if (!object(r)) { fail(where, 'requires {name, box, max_pixels?}'); return; }
      keys(r, ['name', 'box', 'max_pixels'], where);
      if (typeof r.name !== 'string' || r.name.trim() === '') fail(`${where}.name`, 'requires a nonempty region name');
      else { if (names.has(r.name)) fail(`${where}.name`, `declares region "${r.name}" twice`); names.add(r.name); }
      if (!Array.isArray(r.box) || r.box.length !== 4 || !r.box.every(integer) || r.box[0] < 0 || r.box[1] < 0 || r.box[2] <= 0 || r.box[3] <= 0 || !Number.isSafeInteger(r.box[0] + r.box[2]) || !Number.isSafeInteger(r.box[1] + r.box[3])) fail(`${where}.box`, 'requires nonnegative integer x/y and positive integer width/height in stage pixels, with finite integer far edges');
      if ('max_pixels' in r && (!integer(r.max_pixels) || r.max_pixels < 0)) fail(`${where}.max_pixels`, 'requires a nonnegative authored integer pixel count, or omission for SKIP');
    });
  }
  return problems;
}

export function setupPaintingBounds(value: SetupPainting, width: number, height: number): Problem[] {
  return value.regions.flatMap(r => r.box[0] + r.box[2] > width || r.box[1] + r.box[3] > height
    ? [{ code: 'REQUIREMENTS_FIELD', object: `setup_painting region "${r.name}" box`, detail: `[${r.box.join(', ')}] exceeds the declared ${width}x${height} stage; regions use its native pixel grid, not a fitted render` }] : []);
}

export interface SetupPaintingSlot {
  slot: string;
  /** Bounding box of failing pixel centres, in stage-grid pixels. */
  box: [number, number, number, number];
  pixel_count: number;
}
export interface SetupPaintingReading extends SetupPaintingRegion {
  status: 'PASS' | 'FAIL' | 'SKIP';
  pixel_count: number;
  limit: number | null;
  slots: SetupPaintingSlot[];
}
export interface SetupPaintingLine {
  status: 'PASS' | 'FAIL' | 'SKIP';
  instrument: 'rigc renderer setup textured pieces';
  registration: 'declared stage grid, scale 1, no fitting';
  compositing: 'source-over white, RGBA8';
  figure: 'source figureSilhouette union rendered alpha > 0';
  ownership: 'last actual drawn piece with sampled alpha > 0; uncovered explicit';
  rgb_tolerance: number;
  regions: SetupPaintingReading[];
  reason?: string;
}

/** Pixel metric only. Caller supplies the actual renderer's textured setup and
 * its per-pixel drawn-piece owners on precisely the source grid. RGB under
 * zero alpha is ignored: both observations are source-over white first.
 * Region totals count each pixel once, even with translucent contributors.
 */
export function setupPaintingLine(
  declared: SetupPainting, source: Raster, setup: Raster, figure: Uint8Array,
  owners: Int32Array, slots: readonly string[], problems: Problem[],
): SetupPaintingLine {
  refuseIfAny(setupPaintingProblems(declared, 'setup_painting'));
  refuseIfAny(setupPaintingBounds(declared, source.width, source.height));
  const W = source.width, H = source.height, n = W * H;
  if (setup.width !== W || setup.height !== H || figure.length !== n || owners.length !== n || source.data.length !== n * 4 || setup.data.length !== n * 4 || owners.some(i => i < -1 || i >= slots.length)) {
    refuseIfAny([{ code: 'CHECK_SETUP_PAINTING_MEASURED', object: SETUP_PAINTING_LINE, detail: 'requires actual setup pixels, figure domain and renderer owners on the declared native source grid; no fitted registration or guessed owner is substituted' }]);
  }
  const regions = declared.regions.map<SetupPaintingReading>(r => {
    const rows = new Map<string, { pixels: number; x0: number; y0: number; x1: number; y1: number }>();
    let count = 0;
    for (let y = r.box[1]; y < r.box[1] + r.box[3]; y++) for (let x = r.box[0]; x < r.box[0] + r.box[2]; x++) {
      const p = y * W + x, q = p * 4;
      if (figure[p] === 0 && setup.data[q + 3] === 0) continue;
      let delta = 0;
      for (let c = 0; c < 3; c++) {
        const white = (image: Raster): number => Math.round(image.data[q + c] * image.data[q + 3] / 255 + 255 * (1 - image.data[q + 3] / 255));
        delta = Math.max(delta, Math.abs(white(source) - white(setup)));
      }
      if (delta <= declared.rgb_tolerance) continue;
      count++;
      const slot = owners[p] < 0 ? '(uncovered)' : slots[owners[p]], row = rows.get(slot);
      if (row === undefined) rows.set(slot, { pixels: 1, x0: x, y0: y, x1: x + 1, y1: y + 1 });
      else { row.pixels++; row.x0 = Math.min(row.x0, x); row.y0 = Math.min(row.y0, y); row.x1 = Math.max(row.x1, x + 1); row.y1 = Math.max(row.y1, y + 1); }
    }
    const status = r.max_pixels === undefined ? 'SKIP' : count > r.max_pixels ? 'FAIL' : 'PASS';
    const result: SetupPaintingReading = { ...r, status, pixel_count: count, limit: r.max_pixels ?? null,
      slots: [...rows].map(([slot, row]) => ({ slot, box: [row.x0, row.y0, row.x1 - row.x0, row.y1 - row.y0], pixel_count: row.pixels })) };
    if (status === 'FAIL') {
      for (const row of result.slots) problems.push({ code: 'CHECK_SETUP_MATCHES_PAINTING', object: `region "${r.name}" slot "${row.slot}"`, detail: `box [${row.box.join(', ')}], pixelcount ${row.pixel_count}; region pixelcount ${count} > declared limit ${r.max_pixels}, RGB tolerance ${declared.rgb_tolerance}; compare the actual setup to the source painting on the declared stage grid` });
    }
    return result;
  });
  const noLimit = regions.some(r => r.status === 'SKIP');
  return { status: regions.some(r => r.status === 'FAIL') ? 'FAIL' : noLimit ? 'SKIP' : 'PASS', instrument: 'rigc renderer setup textured pieces', registration: 'declared stage grid, scale 1, no fitting', compositing: 'source-over white, RGBA8', figure: 'source figureSilhouette union rendered alpha > 0', ownership: 'last actual drawn piece with sampled alpha > 0; uncovered explicit', rgb_tolerance: declared.rgb_tolerance, regions,
    ...(noLimit ? { reason: 'a region has no declared max_pixels; it is measured as SKIP, never PASS' } : {}) };
}

export function setupPaintingLines(line: SetupPaintingLine): string[] {
  return [`${SETUP_PAINTING_LINE}: ${line.status}${line.reason === undefined ? '' : ` — ${line.reason}`}; ${line.registration}; ${line.compositing}`,
    ...line.regions.flatMap(r => [`${SETUP_PAINTING_LINE}: region "${r.name}" ${r.status} — box [${r.box.join(', ')}], pixelcount ${r.pixel_count}, limit ${r.limit ?? 'undeclared (SKIP)'}, RGB tolerance ${line.rgb_tolerance}`,
      ...r.slots.map(s => `${SETUP_PAINTING_LINE}: slot "${s.slot}" region "${r.name}" — box [${s.box.join(', ')}], pixelcount ${s.pixel_count}; region total ${r.pixel_count}, limit ${r.limit ?? 'undeclared (SKIP)'}`)])];
}
