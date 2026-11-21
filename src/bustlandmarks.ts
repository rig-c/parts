import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { type CharacterConfig, DEFAULT_BUST_ALPHA, DEFAULT_BUST_BONE_L, DEFAULT_BUST_BONE_R, DEFAULT_BUST_CLEARANCE, DEFAULT_BUST_SPACING, loadConfig } from './config.ts';
import { SHA256_PATTERN } from './editreceipt.ts';
import { PartsError, type Problem } from './errors.ts';
import { type PartsFile, readParts } from './parts.ts';

/**
 * `rig-parts bust-landmarks` (issue #1382): the file `propose --bust-landmarks`
 * reads, written from the one chest row of a Review chest-landmarks act, with a
 * provenance record beside it.
 *
 * The act is read as JSON by path and only what this command uses is validated:
 * the envelope's `schema` and `actId`, and from each `value.chestLandmarks[]`
 * row its `edit.slot`, `edit.skin`, `edit.attachment`, `edit.basis`,
 * `edit.source.hash`, `edit.source.frame`, `edit.bust` and `sha256`. Review is
 * not imported; its grammar for the act is its own, and this reader refuses by
 * name what it cannot use.
 *
 * The row's `sha256` is recorded as the act gives it and is not recomputed: the
 * act's writer digests the edit through a canonical serializer this package
 * does not carry, so a digest computed here would be a guess at that rule.
 */

/** The act schema this command reads; another act version is refused by name. */
export const BUST_LANDMARKS_ACT_SCHEMA = 'rig-review/act@9';
/** The provenance record's spec. */
export const BUST_LANDMARKS_PROVENANCE_SPEC = 'rig-parts-bust-landmarks-provenance/1';
/** The provenance record is written beside `--out` under this suffix, as `depth-bind` writes `<map>.binding.json`. */
export const BUST_LANDMARKS_PROVENANCE_SUFFIX = '.provenance.json';

/** The keys of a row's `edit.bust`: Parts' own `meshes.<part>.contour.bust` shorthand. */
const BUST_KEYS = ['apex_r', 'apex_l', 'cleavage', 'alpha', 'clearance', 'bone_r', 'bone_l', 'spacing'] as const;
/** The bust fields the landmarks file does not carry; they must agree with the config so none is dropped. */
const SHAPE_KEYS = ['alpha', 'clearance', 'spacing', 'bone_r', 'bone_l'] as const;
type ShapeKey = (typeof SHAPE_KEYS)[number];
type Shape = { alpha: number; clearance: number; spacing: number; bone_r: string; bone_l: string };
const SHAPE_DEFAULTS: Shape = {
  alpha: DEFAULT_BUST_ALPHA,
  clearance: DEFAULT_BUST_CLEARANCE,
  spacing: DEFAULT_BUST_SPACING,
  bone_r: DEFAULT_BUST_BONE_R,
  bone_l: DEFAULT_BUST_BONE_L,
};

type Point = [number, number];

/** The landmarks file, in the key order `propose --bust-landmarks` documents. */
export interface BustLandmarksFile {
  apex_r: Point;
  apex_l: Point;
  cleavage?: Point;
}

/** The provenance record written beside the landmarks file. Fixed key order, no clock. */
export interface BustLandmarksProvenance {
  spec: typeof BUST_LANDMARKS_PROVENANCE_SPEC;
  act: { schema: typeof BUST_LANDMARKS_ACT_SCHEMA; act_id: string; file_sha256: string };
  row_sha256: string;
  slot: string;
  source: { hash: string; frame: { width: number; height: number } };
  landmarks_sha256: string;
}

interface ChestRow {
  index: number;
  slot: string;
  skin: string;
  attachment: string;
  hash: string;
  frame: { width: number; height: number };
  landmarks: BustLandmarksFile;
  shape: Partial<Shape>;
  sha256: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: unknown): string => JSON.stringify(v) ?? 'absent';
const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const isPoint = (v: unknown): v is Point => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n));
const isName = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Read one `value.chestLandmarks[i]` row; every problem it has is pushed, and null returned when any is. */
function readRow(raw: unknown, index: number, problems: Problem[]): ChestRow | null {
  const at = `value.chestLandmarks[${index}]`;
  const before = problems.length;
  const fail = (object: string, detail: string): void => { problems.push({ code: 'BUST_LANDMARKS_ROW', object, detail }); };
  if (!isObject(raw)) {
    fail(at, `is ${show(raw)}; an object with edit and sha256 is required`);
    return null;
  }
  const digest = raw.sha256;
  if (typeof digest !== 'string' || !SHA256_PATTERN.test(digest)) fail(`${at}.sha256`, `is ${show(digest)}; 64 lowercase hex digits are required`);
  const edit = raw.edit;
  if (!isObject(edit)) {
    fail(`${at}.edit`, `is ${show(edit)}; an object with slot, skin, attachment, basis, source and bust is required`);
    return null;
  }
  for (const key of ['slot', 'skin', 'attachment'] as const) {
    if (!isName(edit[key])) fail(`${at}.edit.${key}`, `is ${show(edit[key])}; a non-empty name is required`);
  }
  if (edit.basis !== 'setup') fail(`${at}.edit.basis`, `is ${show(edit.basis)}; "setup" is required: the points are setup-pose rig px`);
  const source = edit.source;
  let frame: { width: number; height: number } | null = null;
  if (!isObject(source)) fail(`${at}.edit.source`, `is ${show(source)}; an object with hash and frame is required`);
  else {
    if (typeof source.hash !== 'string' || !SHA256_PATTERN.test(source.hash)) fail(`${at}.edit.source.hash`, `is ${show(source.hash)}; 64 lowercase hex digits are required`);
    const f = source.frame;
    const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
    if (!isObject(f) || !positive(f.width) || !positive(f.height)) fail(`${at}.edit.source.frame`, `is ${show(f)}; {width, height} in positive finite rig px is required`);
    else frame = { width: f.width, height: f.height };
  }
  const bust = edit.bust;
  const shape: Partial<Shape> = {};
  if (!isObject(bust)) fail(`${at}.edit.bust`, `is ${show(bust)}; an object with apex_r, apex_l and optional cleavage is required`);
  else {
    for (const key of Object.keys(bust)) {
      if (!(BUST_KEYS as readonly string[]).includes(key)) fail(`${at}.edit.bust.${key}`, `is unknown; contour.bust takes ${BUST_KEYS.join(', ')}`);
    }
    for (const key of ['apex_r', 'apex_l', 'cleavage'] as const) {
      if (key === 'cleavage' && !Object.hasOwn(bust, key)) continue;
      if (!isPoint(bust[key])) fail(`${at}.edit.bust.${key}`, `is ${show(bust[key])}; a finite [x, y] point in rig px is required`);
    }
    for (const key of ['alpha', 'clearance', 'spacing'] as const) {
      if (!Object.hasOwn(bust, key)) continue;
      const n = bust[key];
      if (typeof n !== 'number' || !Number.isFinite(n)) fail(`${at}.edit.bust.${key}`, `is ${show(n)}; a finite number is required`);
      else shape[key] = n;
    }
    for (const key of ['bone_r', 'bone_l'] as const) {
      if (!Object.hasOwn(bust, key)) continue;
      const name = bust[key];
      if (!isName(name)) fail(`${at}.edit.bust.${key}`, `is ${show(name)}; a non-empty bone name is required`);
      else shape[key] = name;
    }
  }
  if (problems.length > before || !isObject(bust) || frame === null || !isObject(source)) return null;
  const landmarks: BustLandmarksFile = { apex_r: [...(bust.apex_r as Point)], apex_l: [...(bust.apex_l as Point)] };
  if (Object.hasOwn(bust, 'cleavage')) landmarks.cleavage = [...(bust.cleavage as Point)];
  return {
    index, slot: edit.slot as string, skin: edit.skin as string, attachment: edit.attachment as string,
    hash: source.hash as string, frame, landmarks, shape, sha256: digest as string,
  };
}

/** Read the act's envelope and rows: every problem pushed, the rows that read returned. */
function readAct(bytes: Buffer | null, path: string, problems: Problem[]): { actId: string; rows: ChestRow[] } | null {
  if (bytes === null) {
    problems.push({ code: 'BUST_LANDMARKS_ACT', object: path, detail: `is not readable; a ${BUST_LANDMARKS_ACT_SCHEMA} JSON file is required` });
    return null;
  }
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString('utf8')); }
  catch (error) {
    problems.push({ code: 'BUST_LANDMARKS_ACT', object: path, detail: `does not parse as JSON (${error instanceof Error ? error.message : String(error)}); a ${BUST_LANDMARKS_ACT_SCHEMA} JSON file is required` });
    return null;
  }
  if (!isObject(raw)) {
    problems.push({ code: 'BUST_LANDMARKS_ACT', object: path, detail: `is ${show(raw)}; a ${BUST_LANDMARKS_ACT_SCHEMA} act object is required` });
    return null;
  }
  const before = problems.length;
  if (raw.schema !== BUST_LANDMARKS_ACT_SCHEMA) problems.push({ code: 'BUST_LANDMARKS_ACT', object: `${path} schema`, detail: `is ${show(raw.schema)}; "${BUST_LANDMARKS_ACT_SCHEMA}" is required (the chest-landmarks act)` });
  if (!isName(raw.actId)) problems.push({ code: 'BUST_LANDMARKS_ACT', object: `${path} actId`, detail: `is ${show(raw.actId)}; a non-empty act id is required` });
  const value = raw.value;
  const list = isObject(value) ? value.chestLandmarks : undefined;
  if (!Array.isArray(list) || list.length === 0) {
    problems.push({ code: 'BUST_LANDMARKS_ACT', object: `${path} value.chestLandmarks`, detail: `is ${Array.isArray(list) ? 'an empty list' : show(list)}; one chest-landmarks row is required` });
    return null;
  }
  const rows = list.map((item, index) => readRow(item, index, problems)).filter((row): row is ChestRow => row !== null);
  return problems.length > before ? null : { actId: raw.actId as string, rows };
}

/** One chest row: the landmarks file names no part, and `propose` drafts one chest carrier, so one row is required. */
function oneRow(rows: readonly ChestRow[], problems: Problem[]): ChestRow | null {
  if (rows.length === 1) return rows[0];
  const bySlot = new Map<string, number[]>();
  for (const row of rows) bySlot.set(row.slot, [...(bySlot.get(row.slot) ?? []), row.index]);
  for (const [slot, indices] of bySlot) {
    if (indices.length > 1) {
      problems.push({ code: 'BUST_LANDMARKS_PART_ROWS', object: `slot "${slot}"`, detail: `has ${indices.length} rows (value.chestLandmarks[${indices.join('], [')}]); one row per part is required` });
    }
  }
  if (bySlot.size > 1) {
    problems.push({ code: 'BUST_LANDMARKS_ROWS', object: 'value.chestLandmarks', detail: `names ${bySlot.size} parts (${[...bySlot.keys()].map(s => `"${s}"`).join(', ')}); one chest row is required, because propose drafts one chest carrier and the landmarks file names no part` });
  }
  return null;
}

/** The five shape fields after defaults, from a partial spec. */
const effective = (spec: Partial<Shape>): Shape => ({ ...SHAPE_DEFAULTS, ...spec });

/** Check the row against parts.json and the config: slot, frame and shape fields. */
function checkRow(row: ChestRow, parts: PartsFile | null, config: CharacterConfig | null, problems: Problem[]): void {
  const at = `value.chestLandmarks[${row.index}]`;
  if (parts !== null) {
    const [width, height] = parts.rig_size;
    if (row.frame.width !== width || row.frame.height !== height) {
      problems.push({ code: 'BUST_LANDMARKS_FRAME', object: `${at}.edit.source.frame`, detail: `is ${row.frame.width}x${row.frame.height}; parts.json's rig_size ${width}x${height} is required, the frame the points are rig px in` });
    }
    if (!parts.parts.some(p => p.name === row.slot)) {
      problems.push({ code: 'BUST_LANDMARKS_SLOT', object: `${at}.edit.slot`, detail: `is "${row.slot}"; a part parts.json lists is required` });
    }
  }
  if (row.attachment !== row.slot) {
    problems.push({ code: 'BUST_LANDMARKS_SLOT', object: `${at}.edit.attachment`, detail: `is "${row.attachment}"; "${row.slot}" is required: a contour part's slot and attachment are both its part name` });
  }
  if (row.skin !== 'default') {
    problems.push({ code: 'BUST_LANDMARKS_SLOT', object: `${at}.edit.skin`, detail: `is "${row.skin}"; "default" is required: this package writes every mesh into the default skin` });
  }
  if (config === null) return;
  const mesh = Object.hasOwn(config.meshes, row.slot) ? config.meshes[row.slot] : undefined;
  if (mesh === undefined || !('contour' in mesh)) {
    const found = mesh === undefined ? 'no mesh in config.meshes' : `a ${['grid', 'auto', 'influence', 'explicit'].find(m => m in mesh) ?? 'non-contour'} mesh`;
    problems.push({ code: 'BUST_LANDMARKS_SLOT', object: `${at}.edit.slot`, detail: `"${row.slot}" has ${found}; a part whose config.meshes entry is a contour mesh is required (the chest carrier propose drafts)` });
    return;
  }
  // No contour.bust yet (a first draft made with --no-bust) reads as the defaults: propose drafts contour.bust from the
  // three points alone, so the defaults are the values the redraft builds with.
  const declared = mesh.contour.bust;
  const configShape = effective(declared === undefined ? {} : {
    ...(declared.alpha === undefined ? {} : { alpha: declared.alpha }),
    ...(declared.clearance === undefined ? {} : { clearance: declared.clearance }),
    ...(declared.spacing === undefined ? {} : { spacing: declared.spacing }),
    ...(declared.bone_r === undefined ? {} : { bone_r: declared.bone_r }),
    ...(declared.bone_l === undefined ? {} : { bone_l: declared.bone_l }),
  });
  const actShape = effective(row.shape);
  for (const key of SHAPE_KEYS as readonly ShapeKey[]) {
    if (actShape[key] !== configShape[key]) {
      const from = declared === undefined ? 'the default (the config declares no contour.bust)' : declared[key] === undefined ? 'the default' : 'the config';
      problems.push({
        code: 'BUST_LANDMARKS_SHAPE', object: `${at}.edit.bust.${key}`,
        detail: `is ${show(actShape[key])}${row.shape[key] === undefined ? ' (absent, the default)' : ''}; meshes.${row.slot}.contour.bust.${key} ${show(configShape[key])}, ${from}, is required: the landmarks file carries no ${key}, so a different value would be dropped`,
      });
    }
  }
}

/** Refuse an output that lands in the parts directory or over an input. */
function checkOut(out: string, inputs: { act: string; config: string; parts: string }, problems: Problem[]): void {
  // Symlinks resolved where the path exists; a new file is its existing directory's real path plus its name.
  const real = (p: string): string => {
    if (existsSync(p)) return realpathSync(p);
    return existsSync(dirname(p)) ? join(realpathSync(dirname(p)), basename(p)) : p;
  };
  const partsDir = real(inputs.parts);
  for (const [flag, path] of [['--out', out], [`--out's provenance record`, out + BUST_LANDMARKS_PROVENANCE_SUFFIX]] as const) {
    const target = real(path);
    if (target === partsDir || target.startsWith(partsDir + sep)) {
      problems.push({ code: 'BUST_LANDMARKS_OUT', object: flag, detail: `is ${path}, inside --parts ${inputs.parts}; a path outside the parts directory is required` });
    }
    for (const [name, input] of [['--from-act', inputs.act], ['--config', inputs.config]] as const) {
      if (target === real(input)) problems.push({ code: 'BUST_LANDMARKS_OUT', object: flag, detail: `is ${path}, the ${name} input; a path that is no input is required` });
    }
  }
}

/** Collect a reader's refusal into `problems` instead of throwing it. */
function collect<T>(read: () => T, problems: Problem[]): T | null {
  try { return read(); }
  catch (error) {
    if (error instanceof PartsError) {
      problems.push(...error.problems);
      return null;
    }
    throw error;
  }
}

/** The landmarks file's bytes: the keys `propose --bust-landmarks` reads, in its order. */
export function bustLandmarksText(landmarks: BustLandmarksFile): string {
  const out: BustLandmarksFile = { apex_r: landmarks.apex_r, apex_l: landmarks.apex_l };
  if (landmarks.cleavage !== undefined) out.cleavage = landmarks.cleavage;
  return JSON.stringify(out, null, 2) + '\n';
}

/**
 * Read the act, `parts.json` and the config, check the one chest row against them, and only when every check
 * has passed write `out` and `out` + {@link BUST_LANDMARKS_PROVENANCE_SUFFIX}. Every problem is collected and
 * thrown once.
 */
export function bustLandmarksFromAct(input: { act: string; parts: string; config: string; out: string }): {
  landmarks: BustLandmarksFile; provenance: BustLandmarksProvenance; out: string; provenancePath: string;
} {
  const problems: Problem[] = [];
  const actPath = resolve(input.act), partsDir = resolve(input.parts), configPath = resolve(input.config), out = resolve(input.out);
  checkOut(out, { act: actPath, config: configPath, parts: partsDir }, problems);
  let actBytes: Buffer | null = null;
  try { actBytes = readFileSync(actPath); } catch { actBytes = null; }
  const act = readAct(actBytes, input.act, problems);
  const parts = collect(() => readParts(join(partsDir, 'parts.json')), problems);
  const config = collect(() => loadConfig(configPath), problems);
  const row = act === null ? null : oneRow(act.rows, problems);
  if (row !== null) checkRow(row, parts, config, problems);
  if (problems.length > 0 || act === null || row === null || actBytes === null) throw new PartsError(problems);
  const text = bustLandmarksText(row.landmarks);
  const provenance: BustLandmarksProvenance = {
    spec: BUST_LANDMARKS_PROVENANCE_SPEC,
    act: { schema: BUST_LANDMARKS_ACT_SCHEMA, act_id: act.actId, file_sha256: sha256(actBytes) },
    row_sha256: row.sha256,
    slot: row.slot,
    source: { hash: row.hash, frame: { width: row.frame.width, height: row.frame.height } },
    landmarks_sha256: sha256(text),
  };
  const provenancePath = out + BUST_LANDMARKS_PROVENANCE_SUFFIX;
  for (const [path, bytes] of [[out, text], [provenancePath, JSON.stringify(provenance, null, 2) + '\n']] as const) {
    try { writeFileSync(path, bytes); }
    catch (error) {
      const code = isObject(error) && typeof error.code === 'string' ? error.code : 'UNKNOWN';
      throw new PartsError([{ code: 'BUST_LANDMARKS_OUT', object: path, detail: `could not be written (${code}); a writable path in an existing directory is required` }]);
    }
  }
  return { landmarks: row.landmarks, provenance, out, provenancePath };
}
