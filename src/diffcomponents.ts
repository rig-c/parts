/** Exhaustive whole-figure error inventory; existing recomposite output is unchanged. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { COVERED_ALPHA, ERROR_LIMIT, coveredMask, errorMask, holeBorders, type PlacedPart } from './assemble.ts';
import { PartsError, type Problem } from './errors.ts';
import { readParts } from './parts.ts';
import { connectedComponents } from './raster/components.ts';
import { decodePngBytes } from './raster/png.ts';
import { newMask } from './raster/types.ts';

export const DIFF_COMPONENTS_SPEC = 'rig-parts-diff-components/1';
export interface DiffBytes { path: string; bytes: Uint8Array }
export interface DiffInputs {
  stack: DiffBytes;
  painting: DiffBytes;
  parts: PlacedPart[];
  /** Same binary figure domain measureRecomposite reads; null means the whole canvas. */
  inside: Uint8Array | null;
}
export interface DiffComponent {
  id: string;
  px: number;
  box: { x: number; y: number; w: number; h: number };
  coverage: 'covered' | 'uncovered' | 'mixed';
  uncovered_px: number;
  borders: { part: string; px: number }[];
}
export interface DiffComponentsReport {
  spec: typeof DIFF_COMPONENTS_SPEC;
  stack: { path: string; sha256: string };
  painting: { path: string; sha256: string };
  definition: {
    metric: 'max-absolute-rgb-channel'; threshold: number; comparison: '>'; connectivity: 8;
    floor_px: number; coordinates: 'native'; y: 'down'; origin: 'top-left'; resampling: 'none';
    covered_alpha_above: number; width: number; height: number; inside_sha256: string | null;
  };
  error_px: number;
  uncovered_error_px: number;
  components: DiffComponent[];
  below_floor: { count: number; px: number; uncovered_px: number };
}
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
function inputFailure(object: string, detail: string): never {
  throw new PartsError([{ code: 'DIFF_COMPONENTS_INPUT', object, detail }]);
}
function reportFailure(detail: string): never {
  throw new PartsError([{ code: 'DIFF_COMPONENTS_REPORT', object: 'diff components report', detail }]);
}

/** Hash and decode each source from the same buffer. No alignment or resampling. */
export function measureDiffComponents(input: DiffInputs, floor: number, threshold = ERROR_LIMIT): DiffComponentsReport {
  if (!Number.isSafeInteger(floor) || floor < 1) inputFailure('floor_px', `is ${floor}; a positive safe integer is required`);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) inputFailure('threshold', `is ${threshold}; a finite channel threshold in [0,255] is required`);
  const stack = decodePngBytes(input.stack.bytes, input.stack.path);
  const painting = decodePngBytes(input.painting.bytes, input.painting.path);
  const W = painting.width, H = painting.height;
  if (stack.width !== W || stack.height !== H) inputFailure('stack', `is ${stack.width}x${stack.height}; painting ${W}x${H} is required, with no resampling`);
  if (input.inside !== null && (input.inside.length !== W * H || input.inside.some(v => v !== 0 && v !== 1))) inputFailure('inside', `requires a binary mask of ${W * H} pixels in the painting's native frame`);
  const names = new Set<string>();
  for (const { record: p, image } of input.parts) {
    if (!p.name || names.has(p.name) || ![p.x, p.y, p.w, p.h].every(Number.isSafeInteger) || p.x < 0 || p.y < 0 || p.w < 1 || p.h < 1 || p.x + p.w > W || p.y + p.h > H || image.width !== p.w || image.height !== p.h) inputFailure(`part "${p.name}"`, `requires a unique name and an in-canvas integer box matching its image, on ${W}x${H}`);
    names.add(p.name);
  }
  const covered = coveredMask(input.parts, W, H);
  const err = errorMask(stack, painting, input.inside, threshold);
  const mask = newMask(W, H); mask.data.set(err);
  const cc = connectedComponents(mask, 8);
  const first = new Int32Array(cc.stats.length).fill(-1);
  const uncovered = new Uint32Array(cc.stats.length);
  let errorPx = 0, uncoveredPx = 0;
  for (let p = 0; p < err.length; p++) if (err[p]) {
    const label = cc.labels[p];
    if (first[label] === -1) first[label] = p;
    errorPx++;
    if (!covered[p]) { uncovered[label]++; uncoveredPx++; }
  }
  const components: DiffComponent[] = [];
  const below = { count: 0, px: 0, uncovered_px: 0 };
  for (const s of cc.stats.slice(1).filter(s => s.area > 0).sort((a,b) => first[a.label] - first[b.label])) {
    const u = uncovered[s.label];
    if (s.area < floor) { below.count++; below.px += s.area; below.uncovered_px += u; continue; }
    components.push({ id: `p${first[s.label]}-n${s.area}`, px: s.area,
      box: { x: s.left, y: s.top, w: s.width, h: s.height },
      coverage: u === 0 ? 'covered' : u === s.area ? 'uncovered' : 'mixed', uncovered_px: u,
      borders: holeBorders(input.parts, cc, s, W, H, COVERED_ALPHA) });
  }
  return { spec: DIFF_COMPONENTS_SPEC,
    stack: { path: input.stack.path, sha256: sha(input.stack.bytes) },
    painting: { path: input.painting.path, sha256: sha(input.painting.bytes) },
    definition: { metric: 'max-absolute-rgb-channel', threshold, comparison: '>', connectivity: 8, floor_px: floor,
      coordinates: 'native', y: 'down', origin: 'top-left', resampling: 'none', covered_alpha_above: COVERED_ALPHA,
      width: W, height: H, inside_sha256: input.inside === null ? null : sha(input.inside) },
    error_px: errorPx, uncovered_error_px: uncoveredPx, components, below_floor: below };
}
export function serializeDiffComponents(report: DiffComponentsReport): string { return JSON.stringify(report, null, 2) + '\n'; }
export function writeDiffComponents(path: string, input: DiffInputs, floor: number, threshold = ERROR_LIMIT): DiffComponentsReport {
  const report = measureDiffComponents(input, floor, threshold);
  writeFileSync(path, serializeDiffComponents(report));
  return report;
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Recompute the inventory against the supplied bytes and coverage/domain. A capped or edited report is refused. */
export function readDiffComponents(text: string, input: DiffInputs): DiffComponentsReport {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return reportFailure('requires valid JSON'); }
  if (!object(raw) || raw.spec !== DIFF_COMPONENTS_SPEC || !object(raw.stack) || !object(raw.painting) || !object(raw.definition)) return reportFailure(`requires ${DIFF_COMPONENTS_SPEC} with stack, painting and definition objects`);
  const bindings: Problem[] = [];
  for (const key of ['stack', 'painting'] as const) {
    const binding = raw[key] as Record<string, unknown>;
    const required = sha(input[key].bytes);
    if (binding.sha256 !== required) bindings.push({ code: 'DIFF_COMPONENTS_BINDING', object: key,
      detail: `sha256 is ${JSON.stringify(binding.sha256) ?? 'missing'}; ${required} is required for the bytes actually measured` });
  }
  if (bindings.length > 0) throw new PartsError(bindings);
  const floor = raw.definition.floor_px, threshold = raw.definition.threshold;
  if (typeof floor !== 'number' || typeof threshold !== 'number') return reportFailure('definition requires numeric floor_px and threshold');
  const expected = measureDiffComponents(input, floor, threshold);
  const differences: Problem[] = [];
  const shown = (v: unknown): string => v === undefined ? 'missing' : Array.isArray(v) ? `array with ${v.length} entries` : JSON.stringify(v);
  const fail = (path: string, found: unknown, required: unknown): void => {
    differences.push({ code: 'DIFF_COMPONENTS_REPORT', object: path,
      detail: `found ${shown(found)}; required ${shown(required)} from the exhaustive measurement; regenerate the report` });
  };
  const compare = (found: unknown, required: unknown, path: string): void => {
    if (Array.isArray(required)) {
      if (!Array.isArray(found)) { fail(path, found, required); return; }
      if (found.length !== required.length) fail(`${path}.length`, found.length, required.length);
      for (let i = 0; i < Math.max(found.length, required.length); i++) compare(found[i], required[i], `${path}[${i}]`);
    } else if (object(required)) {
      if (!object(found)) { fail(path, found, required); return; }
      for (const key of Object.keys(required)) compare(found[key], required[key], `${path}.${key}`);
      for (const key of Object.keys(found).sort()) if (!Object.hasOwn(required, key)) {
        const field = /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
        fail(field, found[key], undefined);
      }
    } else if (found !== required) fail(path, found, required);
  };
  compare(raw, expected, 'report');
  if (differences.length > 0) throw new PartsError(differences);
  return expected;
}

/** CLI adapter: explicit native PNGs, plus assembled parts for coverage; optional figure mask is never inferred. */
export function diffComponentsCommand(args: string[]): void {
  const allowed = ['--stack', '--painting', '--parts', '--figure', '--floor', '--threshold', '--out', '--verify'];
  const flags = new Map<string,string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!allowed.includes(key) || flags.has(key) || value === undefined || value.startsWith('--')) inputFailure('arguments', `requires unique ${allowed.join(', ')} flags with values; found ${key}`);
    flags.set(key, value);
  }
  for (const key of ['--stack', '--painting', '--parts', '--floor']) if (!flags.has(key)) inputFailure(key, 'is missing; an explicit value is required');
  if (flags.has('--out') === flags.has('--verify')) inputFailure('arguments', 'requires exactly one of --out or --verify');
  const bytes = (path: string): DiffBytes => {
    try { return { path, bytes: readFileSync(path) }; } catch { return inputFailure(path, 'cannot read file; readable input bytes are required'); }
  };
  const partsPath = flags.get('--parts')!;
  const parts = readParts(partsPath);
  const placed = parts.parts.map(record => ({ record, image: decodePngBytes(bytes(join(dirname(partsPath), 'parts', `${record.name}.png`)).bytes, record.name) }));
  const stack = bytes(flags.get('--stack')!), painting = bytes(flags.get('--painting')!);
  let inside: Uint8Array | null = null;
  if (flags.has('--figure')) {
    const image = decodePngBytes(bytes(flags.get('--figure')!).bytes, '--figure');
    const reference = decodePngBytes(painting.bytes, painting.path);
    if (image.width !== reference.width || image.height !== reference.height) inputFailure('--figure', 'requires the painting dimensions, with no resampling');
    inside = new Uint8Array(image.width * image.height);
    for (let p = 0; p < inside.length; p++) {
      const s = p * 4, v = image.data[s];
      if ((v !== 0 && v !== 255) || image.data[s+1] !== v || image.data[s+2] !== v || image.data[s+3] !== 255) inputFailure('--figure', 'requires opaque binary black/white pixels');
      inside[p] = v === 255 ? 1 : 0;
    }
  }
  const input = { stack, painting, parts: placed, inside };
  const numericFlag = (key: string): number => {
    const value = flags.get(key)!;
    if (value.trim().length === 0) inputFailure(key, `is ${JSON.stringify(value)}; an explicit number is required`);
    return Number(value);
  };
  const floor = numericFlag('--floor'), threshold = flags.has('--threshold') ? numericFlag('--threshold') : ERROR_LIMIT;
  if (flags.has('--verify')) {
    const path = flags.get('--verify')!;
    const report = readDiffComponents(new TextDecoder().decode(bytes(path).bytes), input);
    if (report.definition.floor_px !== floor || report.definition.threshold !== threshold) inputFailure('definition', 'report floor/threshold differ from the caller flags');
  } else writeDiffComponents(flags.get('--out')!, input, floor, threshold);
}
