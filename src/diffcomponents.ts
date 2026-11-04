/** Exhaustive whole-figure error inventory; existing recomposite output is unchanged. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { COVERED_ALPHA, ERROR_LIMIT, coveredMask, errorMask, holeBorders, type PlacedPart } from './assemble.ts';
import { PartsError, type Problem } from './errors.ts';
import { readParts } from './parts.ts';
import { connectedComponents } from './raster/components.ts';
import { decodePngBytes } from './raster/png.ts';
import { newMask, type Raster } from './raster/types.ts';

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

/** Shared by measurement and both command modes; report every invalid numeric field. */
function diffDefinition(floor: number, threshold: number): void {
  const problems: Problem[] = [];
  if (!Number.isSafeInteger(floor) || floor < 1) problems.push({ code: 'DIFF_COMPONENTS_INPUT', object: 'floor_px', detail: `is ${floor}; a positive safe integer is required` });
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) problems.push({ code: 'DIFF_COMPONENTS_INPUT', object: 'threshold', detail: `is ${threshold}; a finite channel threshold in [0,255] is required` });
  if (problems.length > 0) throw new PartsError(problems);
}

/** The codec's failure remains a named input refusal at this command boundary. */
function diffPng(bytes: Uint8Array, label: string): Raster {
  try { return decodePngBytes(bytes, label); }
  catch (err) { return inputFailure(label, `cannot decode PNG: ${JSON.stringify(err instanceof Error ? err.message : err)}; valid PNG bytes are required`); }
}

/** Hash and decode each source from the same buffer. No alignment or resampling. */
export function measureDiffComponents(input: DiffInputs, floor: number, threshold = ERROR_LIMIT): DiffComponentsReport {
  diffDefinition(floor, threshold);
  const stack = diffPng(input.stack.bytes, input.stack.path);
  const painting = diffPng(input.painting.bytes, input.painting.path);
  const W = painting.width, H = painting.height;
  if (stack.width !== W || stack.height !== H) inputFailure('stack', `is ${stack.width}x${stack.height}; painting ${W}x${H} is required, with no resampling`);
  if (input.inside !== null) {
    const bad = input.inside.findIndex(v => v !== 0 && v !== 1);
    if (input.inside.length !== W * H || bad >= 0) inputFailure('inside', `has ${input.inside.length} pixels, first nonbinary value ${bad < 0 ? 'none' : `${input.inside[bad]} at index ${bad}`}; ${W * H} binary 0/1 pixels in the painting's native frame are required`);
  }
  const names = new Set<string>();
  for (const { record: p, image } of input.parts) {
    if (!p.name || names.has(p.name) || ![p.x, p.y, p.w, p.h].every(Number.isSafeInteger) || p.x < 0 || p.y < 0 || p.w < 1 || p.h < 1 || p.x + p.w > W || p.y + p.h > H || image.width !== p.w || image.height !== p.h || image.data.length < p.w * p.h * 4) inputFailure(`part "${p.name}"`, `box ${p.x},${p.y} ${p.w}x${p.h}, image ${image.width}x${image.height} with ${image.data.length} RGBA bytes, duplicate name ${names.has(p.name)}; a unique nonempty name and an integer in-canvas matching box with four RGBA bytes per pixel are required on ${W}x${H}`);
    names.add(p.name);
  }
  const covered = coveredMask(input.parts, W, H);
  const err = errorMask(stack, painting, input.inside, threshold);
  const mask = newMask(W, H); mask.data.set(err);
  const cc = connectedComponents(mask, 8);
  const first = new Float64Array(cc.stats.length).fill(-1);
  const uncovered = new Float64Array(cc.stats.length);
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
  try { writeFileSync(path, serializeDiffComponents(report)); }
  catch (err) { inputFailure(path, `cannot write report: ${JSON.stringify(err instanceof Error ? err.message : err)}; a writable output file path is required`); }
  return report;
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const shown = (v: unknown): string => v === undefined ? 'missing' : Array.isArray(v) ? `array with ${v.length} entries` : typeof v === 'number' && !Number.isFinite(v) ? String(v) : JSON.stringify(v);
/** Recompute the inventory against the supplied bytes and coverage/domain. A capped or edited report is refused. */
export function readDiffComponents(text: string, input: DiffInputs): DiffComponentsReport {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (err) { return reportFailure(`cannot parse JSON: ${JSON.stringify(err instanceof Error ? err.message : err)}; valid JSON is required`); }
  if (!object(raw)) return reportFailure(`found ${shown(raw)}; a ${DIFF_COMPONENTS_SPEC} report object is required`);
  if (raw.spec !== DIFF_COMPONENTS_SPEC) return reportFailure(`spec is ${shown(raw.spec)}; ${DIFF_COMPONENTS_SPEC} is required`);
  if (!object(raw.stack) || !object(raw.painting) || !object(raw.definition)) return reportFailure(`stack=${shown(raw.stack)}, painting=${shown(raw.painting)}, definition=${shown(raw.definition)}; all three objects are required`);
  const bindings: Problem[] = [];
  for (const key of ['stack', 'painting'] as const) {
    const binding = raw[key] as Record<string, unknown>;
    const required = sha(input[key].bytes);
    if (binding.sha256 !== required) bindings.push({ code: 'DIFF_COMPONENTS_BINDING', object: key,
      detail: `sha256 is ${shown(binding.sha256)}; ${required} is required for the bytes actually measured` });
  }
  if (bindings.length > 0) throw new PartsError(bindings);
  const floor = raw.definition.floor_px, threshold = raw.definition.threshold;
  if (typeof floor !== 'number' || typeof threshold !== 'number') return reportFailure(`definition floor_px=${shown(floor)}, threshold=${shown(threshold)}; both must be numbers`);
  const expected = measureDiffComponents(input, floor, threshold);
  const differences: Problem[] = [];
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
    if (value.length === 0) inputFailure(key, 'is ""; a nonempty value is required');
    flags.set(key, value);
  }
  for (const key of ['--stack', '--painting', '--parts', '--floor']) if (!flags.has(key)) inputFailure(key, 'is missing; an explicit value is required');
  if (flags.has('--out') === flags.has('--verify')) inputFailure('arguments', `has --out=${flags.has('--out')} and --verify=${flags.has('--verify')}; exactly one is required`);
  const numericFlag = (key: string): number => {
    const value = flags.get(key)!;
    if (value.trim().length === 0) inputFailure(key, `is ${JSON.stringify(value)}; an explicit number is required`);
    return Number(value);
  };
  const floor = numericFlag('--floor'), threshold = flags.has('--threshold') ? numericFlag('--threshold') : ERROR_LIMIT;
  diffDefinition(floor, threshold);
  const bytes = (path: string): DiffBytes => {
    try { return { path, bytes: readFileSync(path) }; } catch (err) { return inputFailure(path, `cannot read file: ${JSON.stringify(err instanceof Error ? err.message : err)}; readable input bytes are required`); }
  };
  const partsPath = flags.get('--parts')!;
  const parts = readParts(partsPath);
  const placed = parts.parts.map(record => ({ record, image: diffPng(bytes(join(dirname(partsPath), 'parts', `${record.name}.png`)).bytes, record.name) }));
  const stack = bytes(flags.get('--stack')!), painting = bytes(flags.get('--painting')!);
  let inside: Uint8Array | null = null;
  if (flags.has('--figure')) {
    const image = diffPng(bytes(flags.get('--figure')!).bytes, '--figure');
    const reference = diffPng(painting.bytes, painting.path);
    if (image.width !== reference.width || image.height !== reference.height) inputFailure('--figure', `is ${image.width}x${image.height}; painting ${reference.width}x${reference.height} is required, with no resampling`);
    inside = new Uint8Array(image.width * image.height);
    for (let p = 0; p < inside.length; p++) {
      const s = p * 4, v = image.data[s];
      if ((v !== 0 && v !== 255) || image.data[s+1] !== v || image.data[s+2] !== v || image.data[s+3] !== 255) inputFailure('--figure', `pixel ${p % image.width},${Math.floor(p / image.width)} is RGBA [${Array.from(image.data.slice(s,s+4)).join(',')}]; opaque black [0,0,0,255] or white [255,255,255,255] is required`);
      inside[p] = v === 255 ? 1 : 0;
    }
  }
  const input = { stack, painting, parts: placed, inside };
  if (flags.has('--verify')) {
    const path = flags.get('--verify')!;
    const report = readDiffComponents(new TextDecoder().decode(bytes(path).bytes), input);
    if (report.definition.floor_px !== floor || report.definition.threshold !== threshold) inputFailure('definition', `report floor_px=${report.definition.floor_px}, threshold=${report.definition.threshold}; caller floor_px=${floor}, threshold=${threshold} are required`);
  } else writeDiffComponents(flags.get('--out')!, input, floor, threshold);
}
