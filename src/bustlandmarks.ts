import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { bustClearanceDetail, type CharacterConfig, DEFAULT_BUST_ALPHA, DEFAULT_BUST_BONE_L, DEFAULT_BUST_BONE_R, DEFAULT_BUST_CLEARANCE, DEFAULT_BUST_SPACING, loadConfig } from './config.ts';
import { BUST_SHAPE_FIELDS, type BustShapeKey, type ConfigWritePatch, type PendingBustShape } from './configwrite.ts';
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
 * Issue #1539: the comment-only act (`rig-review/act@10`, kind `comments`) is read
 * too. Its rows sit in the one `value.carriers[]` entry of kind `chest-landmarks`,
 * whose `chestLandmarks` rows are act@9's rows unchanged and go through the same
 * row reader and checks. That carrier's `file` (`{path, sha256}`) must equal the
 * envelope's `source.model`, the binding Review writes; the reader holds it to
 * that and records it in the provenance record. Carriers of another kind (the
 * mesh edits) are not this command's and are not read.
 *
 * The row's `sha256` is recomputed and a mismatch is refused: sha256 (lowercase
 * hex) of `JSON.stringify` of the row's raw `edit` with object keys sorted
 * recursively (`Object.keys(v).sort()`) and array order kept. That rule is a
 * copy of Review's request digest; the contract is held in two places, and the
 * selftest computes its fixtures' digests with its own inline copy.
 *
 * The five shape fields the landmarks file does not carry must agree with the
 * config, or, with `--write-config`, are taken into the config's existing
 * `contour.bust` through the CLI's staged config writer. With no `contour.bust`
 * yet, the fields that differ from the defaults are recorded in the sidecar as
 * a pending shape, which `propose --write-config --bust-landmarks` writes with
 * the points and marks applied ({@link readBustSidecar}). The outputs are
 * written to temporary siblings and renamed into place only once both are
 * staged; a failure removes the temporaries and leaves earlier files as they were.
 */

/** The chest-landmarks act schema this command reads; another act version is refused by name. */
export const BUST_LANDMARKS_ACT_SCHEMA = 'rig-review/act@9';
/** Issue #1539: the comment-only act schema, read for its one `chest-landmarks` carrier. */
export const BUST_LANDMARKS_COMMENT_ACT_SCHEMA = 'rig-review/act@10';
/** The two act schemas, as every refusal of the act names them. */
const ACCEPTED_ACTS = `${BUST_LANDMARKS_ACT_SCHEMA} or ${BUST_LANDMARKS_COMMENT_ACT_SCHEMA}`;
/** The act schemas a provenance record may name. */
type ActSchema = typeof BUST_LANDMARKS_ACT_SCHEMA | typeof BUST_LANDMARKS_COMMENT_ACT_SCHEMA;
/** A model file as Review names one: a path and its sha256. */
export interface ModelFile { path: string; sha256: string }
/** The provenance record's spec. */
export const BUST_LANDMARKS_PROVENANCE_SPEC = 'rig-parts-bust-landmarks-provenance/1';
/** The provenance record is written beside `--out` under this suffix, as `depth-bind` writes `<map>.binding.json`. */
export const BUST_LANDMARKS_PROVENANCE_SUFFIX = '.provenance.json';

/** The keys of a row's `edit.bust`: Parts' own `meshes.<part>.contour.bust` shorthand. */
const BUST_KEYS = ['apex_r', 'apex_l', 'cleavage', 'alpha', 'clearance', 'bone_r', 'bone_l', 'spacing'] as const;
/** The bust fields the landmarks file does not carry, in the shorthand's key order (the config writer's list): they
 * must agree with the config, be taken into it, or be left pending in the sidecar, so none is dropped. */
const SHAPE_KEYS = BUST_SHAPE_FIELDS;
type ShapeKey = BustShapeKey;
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
  /** `carrier_file` (issue #1539) is present exactly when `schema` is the comment-only act: the chest carrier's `file`,
   * which equals the act's `source.model`. A chest-landmarks act's record has none, so its bytes are as before. */
  act: { schema: ActSchema; act_id: string; file_sha256: string; carrier_file?: ModelFile };
  row_sha256: string;
  slot: string;
  source: { hash: string; frame: { width: number; height: number } };
  landmarks_sha256: string;
  /**
   * Present only when the config declared no `contour.bust` and the act's shape differs from the defaults: the
   * act's fields whose effective value differs, in the shorthand's key order. `pending` until `propose
   * --write-config --bust-landmarks` writes them with the points, then `applied`.
   */
  shape?: { status: 'pending' | 'applied'; fields: Partial<Record<BustShapeKey, number | string>> };
}

interface ChestRow {
  /** Where the act holds the rows: `value.chestLandmarks`, or `value.carriers[k].chestLandmarks` in a comment-only act. */
  base: string;
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
/** A value as JSON, with a number JSON cannot hold (1e999 reads as Infinity) written as itself, never as null. */
const show = (v: unknown): string => {
  const text = JSON.stringify(v, (_key, x: unknown) => typeof x === 'number' && !Number.isFinite(x) ? `\u0000${String(x)}\u0000` : x);
  return text === undefined ? 'absent' : text.replace(/"\\u0000(-?Infinity|NaN)\\u0000"/g, '$1');
};
/** True when a value holds a number that is not finite, anywhere inside it. */
const nonFinite = (v: unknown): boolean => typeof v === 'number' ? !Number.isFinite(v) : Array.isArray(v) && v.some(nonFinite);
/** The error code of a failed file operation, or UNKNOWN. */
const errorCode = (error: unknown): string => isObject(error) && typeof error.code === 'string' ? error.code : 'UNKNOWN';
/** The rule the row digest is checked by: Review's request digest, a copy of its canonical JSON. */
const DIGEST_RULE = 'sha256 (lowercase hex) of JSON.stringify of the row\'s edit with object keys sorted recursively and array order kept';
/** Review's canonical JSON for the row digest: object keys sorted recursively by `Object.keys(v).sort()`, array order kept. */
const canonicalJson = (value: unknown): string => {
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted)
    : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map(key => [key, sorted(v[key])])) : v;
  return JSON.stringify(sorted(value));
};
const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const isPoint = (v: unknown): v is Point => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n));
const isName = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Read one `<base>[i]` row; every problem it has is pushed, and null returned when any is. */
function readRow(raw: unknown, index: number, problems: Problem[], base: string): ChestRow | null {
  const at = `${base}[${index}]`;
  const before = problems.length;
  const fail = (object: string, detail: string): void => { problems.push({ code: 'BUST_LANDMARKS_ROW', object, detail }); };
  if (!isObject(raw)) {
    fail(at, `is ${show(raw)}; an object with edit and sha256 is required`);
    return null;
  }
  const digest = raw.sha256;
  const edit = raw.edit;
  if (typeof digest !== 'string' || !SHA256_PATTERN.test(digest)) fail(`${at}.sha256`, `is ${show(digest)}; 64 lowercase hex digits are required`);
  else if (isObject(edit)) {
    const computed = sha256(canonicalJson(edit));
    if (computed !== digest) fail(`${at}.sha256`, `is "${digest}"; "${computed}" is required, the digest of this row's edit by ${DIGEST_RULE} (Review's request digest): the edit is not the one the digest names`);
  }
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
      if (!isPoint(bust[key])) fail(`${at}.edit.bust.${key}`, `is ${show(bust[key])}${nonFinite(bust[key]) ? ', a coordinate that is not finite' : ''}; a finite [x, y] point in rig px is required`);
    }
    for (const key of ['alpha', 'clearance', 'spacing'] as const) {
      if (!Object.hasOwn(bust, key)) continue;
      const n = bust[key];
      if (typeof n !== 'number' || !Number.isFinite(n)) fail(`${at}.edit.bust.${key}`, `is ${show(n)}${nonFinite(n) ? ', not finite' : ''}; a finite number is required`);
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
    base, index, slot: edit.slot as string, skin: edit.skin as string, attachment: edit.attachment as string,
    hash: source.hash as string, frame, landmarks, shape, sha256: digest as string,
  };
}

/** A `{path, sha256}` model file, or null when the value is not one. */
const modelFile = (v: unknown): ModelFile | null =>
  isObject(v) && isName(v.path) && typeof v.sha256 === 'string' && SHA256_PATTERN.test(v.sha256) ? { path: v.path, sha256: v.sha256 } : null;

/** The act as read: its schema and id, the rows, and with a comment-only act the chest carrier's `file`. */
interface ReadAct { schema: ActSchema; actId: string; rows: ChestRow[]; carrierFile?: ModelFile }

/** Read the act's envelope and rows: every problem pushed, the rows that read returned. */
function readAct(bytes: Buffer | string, path: string, problems: Problem[]): ReadAct | null {
  if (typeof bytes === 'string') {
    problems.push({ code: 'BUST_LANDMARKS_ACT', object: path, detail: `is not readable (${bytes}); a ${ACCEPTED_ACTS} JSON file is required` });
    return null;
  }
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString('utf8')); }
  catch (error) {
    problems.push({ code: 'BUST_LANDMARKS_ACT', object: path, detail: `does not parse as JSON (${error instanceof Error ? error.message : String(error)}); a ${ACCEPTED_ACTS} JSON file is required` });
    return null;
  }
  if (!isObject(raw)) {
    problems.push({ code: 'BUST_LANDMARKS_ACT', object: path, detail: `is ${show(raw)}; a ${ACCEPTED_ACTS} act object is required` });
    return null;
  }
  const before = problems.length;
  const schema = raw.schema;
  if (schema !== BUST_LANDMARKS_ACT_SCHEMA && schema !== BUST_LANDMARKS_COMMENT_ACT_SCHEMA) {
    problems.push({ code: 'BUST_LANDMARKS_ACT', object: `${path} schema`, detail: `is ${show(schema)}; "${BUST_LANDMARKS_ACT_SCHEMA}" (the chest-landmarks act) or "${BUST_LANDMARKS_COMMENT_ACT_SCHEMA}" (the comment-only act with a chest-landmarks carrier) is required` });
  }
  if (!isName(raw.actId)) problems.push({ code: 'BUST_LANDMARKS_ACT', object: `${path} actId`, detail: `is ${show(raw.actId)}; a non-empty act id is required` });
  const value = raw.value;
  let base = 'value.chestLandmarks';
  let list: unknown = isObject(value) ? value.chestLandmarks : undefined;
  let carrierFile: ModelFile | undefined;
  if (schema === BUST_LANDMARKS_COMMENT_ACT_SCHEMA) {
    const carrier = chestCarrier(raw, path, problems);
    if (carrier === null) return null;
    base = `value.carriers[${carrier.index}].chestLandmarks`;
    list = carrier.rows;
    carrierFile = carrier.file ?? undefined;
  }
  if (!Array.isArray(list) || list.length === 0) {
    problems.push({ code: 'BUST_LANDMARKS_ACT', object: `${path} ${base}`, detail: `is ${Array.isArray(list) ? 'an empty list' : show(list)}; one chest-landmarks row is required` });
    return null;
  }
  const rows = list.map((item, index) => readRow(item, index, problems, base)).filter((row): row is ChestRow => row !== null);
  if (problems.length > before || carrierFile === undefined && schema === BUST_LANDMARKS_COMMENT_ACT_SCHEMA) return null;
  return { schema: schema as ActSchema, actId: raw.actId as string, rows, ...(carrierFile === undefined ? {} : { carrierFile }) };
}

/**
 * Issue #1539: the one `chest-landmarks` carrier of a comment-only act, its rows and its `file` bound to the act's
 * `source.model`. None is `BUST_LANDMARKS_NO_CHEST_CARRIER`; a `file` that is missing, malformed or not the model
 * the act is bound to is `BUST_LANDMARKS_CARRIER_FILE` (`file` null then, the rows still read so every problem is
 * named at once). Other carriers (mesh edits) are not read.
 */
function chestCarrier(raw: Record<string, unknown>, path: string, problems: Problem[]): { index: number; rows: unknown; file: ModelFile | null } | null {
  const value = raw.value;
  const carriers = isObject(value) ? value.carriers : undefined;
  if (carriers !== undefined && !Array.isArray(carriers)) {
    problems.push({ code: 'BUST_LANDMARKS_ACT', object: `${path} value.carriers`, detail: `is ${show(carriers)}; a list of carriers is required` });
    return null;
  }
  const list = carriers ?? [];
  const chest = list.flatMap((c: unknown, index) => isObject(c) && c.kind === 'chest-landmarks' ? [{ index, carrier: c }] : []);
  if (chest.length === 0) {
    const found = !isObject(value) ? `value is ${show(value)}` : carriers === undefined ? 'has no carriers'
      : `has ${list.length === 0 ? 'an empty carrier list' : `carriers of kind ${list.map((c: unknown) => show(isObject(c) ? c.kind : c)).join(', ')}`} and none of kind "chest-landmarks"`;
    problems.push({
      code: 'BUST_LANDMARKS_NO_CHEST_CARRIER', object: `${path} value.carriers`,
      detail: `act ${show(raw.actId)} (${BUST_LANDMARKS_COMMENT_ACT_SCHEMA}) ${found}; one value.carriers[] entry of kind "chest-landmarks", with chestLandmarks rows and a file equal to source.model, is required: the comment-only act carries the chest points only there (a mesh-edits carrier is not this command's)`,
    });
    return null;
  }
  if (chest.length > 1) {
    problems.push({ code: 'BUST_LANDMARKS_ACT', object: `${path} value.carriers`, detail: `has ${chest.length} carriers of kind "chest-landmarks" (value.carriers[${chest.map(c => c.index).join('], [')}]); one is required, as Review writes each carrier kind at most once` });
    return null;
  }
  const { index, carrier } = chest[0];
  const at = `${path} value.carriers[${index}].file`;
  const file = modelFile(carrier.file);
  const model = isObject(raw.source) ? modelFile(raw.source.model) : null;
  const before = problems.length;
  if (file === null) problems.push({ code: 'BUST_LANDMARKS_CARRIER_FILE', object: at, detail: `is ${show(carrier.file)}; {path, sha256}, a non-empty path and 64 lowercase hex digits, is required: the model file the points were placed on` });
  if (model === null) {
    const found = isObject(raw.source) ? raw.source.model : raw.source;
    problems.push({ code: 'BUST_LANDMARKS_CARRIER_FILE', object: `${path} source.model`, detail: `is ${show(found)}; {path, sha256}, a non-empty path and 64 lowercase hex digits, is required: the chest carrier's file is bound to the model the act was made on` });
  }
  if (file !== null && model !== null && (file.path !== model.path || file.sha256 !== model.sha256)) {
    const differs = [file.path === model.path ? '' : 'path', file.sha256 === model.sha256 ? '' : 'sha256'].filter(Boolean).join(' and ');
    problems.push({ code: 'BUST_LANDMARKS_CARRIER_FILE', object: at, detail: `is ${show(file)}; source.model ${show(model)} is required (the ${differs} differ${differs.includes(' and ') ? '' : 's'}): the points were placed on another model file than the one the act is bound to` });
  }
  return { index, rows: carrier.chestLandmarks, file: problems.length > before ? null : file };
}

/** One chest row: the landmarks file names no part, and `propose` drafts one chest carrier, so one row is required. */
function oneRow(rows: readonly ChestRow[], problems: Problem[]): ChestRow | null {
  if (rows.length === 1) return rows[0];
  const base = rows[0]?.base ?? 'value.chestLandmarks';
  const bySlot = new Map<string, number[]>();
  for (const row of rows) bySlot.set(row.slot, [...(bySlot.get(row.slot) ?? []), row.index]);
  for (const [slot, indices] of bySlot) {
    if (indices.length > 1) {
      problems.push({ code: 'BUST_LANDMARKS_PART_ROWS', object: `slot "${slot}"`, detail: `has ${indices.length} rows (${base}[${indices.join('], [')}]); one row per part is required` });
    }
  }
  if (bySlot.size > 1) {
    problems.push({ code: 'BUST_LANDMARKS_ROWS', object: base, detail: `names ${bySlot.size} parts (${[...bySlot.keys()].map(s => `"${s}"`).join(', ')}); one chest row is required, because propose drafts one chest carrier and the landmarks file names no part` });
  }
  return null;
}

/** Where one field of the shape the points are checked with came from (issue #1441). */
export type BustShapeSource = 'the config' | 'the pending record' | 'the default';
/** The shape the three points are checked with: each field's value and where it came from. */
export type EffectiveBustShape = { readonly [K in BustShapeKey]: { readonly value: unknown; readonly source: BustShapeSource } };

/**
 * Issue #1441: the shape the points are checked with, the one the config write will hold. Each field is the pending
 * record's where it names one, else the config's declared `contour.bust` field, else the default. The one rule, read
 * by `propose --bust-landmarks` on both routes and by `bust-landmarks` before it writes the landmarks file.
 */
export function effectiveBustShape(declared: Readonly<Record<string, unknown>> | undefined, pending: Readonly<Partial<Record<BustShapeKey, unknown>>> | undefined): EffectiveBustShape {
  const pick = (key: BustShapeKey): { value: unknown; source: BustShapeSource } =>
    pending !== undefined && Object.hasOwn(pending, key) && pending[key] !== undefined ? { value: pending[key], source: 'the pending record' }
      : declared !== undefined && Object.hasOwn(declared, key) && declared[key] !== undefined ? { value: declared[key], source: 'the config' }
        : { value: SHAPE_DEFAULTS[key], source: 'the default' };
  return { alpha: pick('alpha'), clearance: pick('clearance'), bone_r: pick('bone_r'), bone_l: pick('bone_l'), spacing: pick('spacing') };
}

/** The two fields the clearance rule reads (`bustClearanceDetail`): the ones a refusal of the points names. */
export const BUST_POINT_SHAPE_FIELDS = ['alpha', 'clearance'] as const;

/** The clause a refusal of the points carries: the two fields the clearance rule reads, each with its source. */
export function bustShapeClause(shape: EffectiveBustShape): string {
  return `the shape checked: alpha ${show(shape.alpha.value)} (${shape.alpha.source}), clearance ${show(shape.clearance.value)} (${shape.clearance.source})`;
}

/** The five shape fields after defaults, from a partial spec. */
const effective = (spec: Partial<Shape>): Shape => ({ ...SHAPE_DEFAULTS, ...spec });

/** One shape field `--write-config` writes into `contour.bust`: the act's value, or, with no value, the key removed. */
type ShapeField = { key: ShapeKey; value?: number | string };

/**
 * Check the row against parts.json and the config: slot, frame and shape fields. Against a declared
 * `contour.bust`, a shape field whose effective value differs is refused, or, with `writeConfig`, returned as a
 * field to write: the act's value where the act spells it out, the key's removal where the act omits it. With no
 * `contour.bust`, a field that differs from the default is returned as pending, for the sidecar.
 */
/**
 * Issue #1443: the act moves the points when apex_r or apex_l differs from the declared one in either coordinate, or
 * when its cleavage differs from the declared one. An act with no cleavage moves the points too: propose derives one
 * from a midline this command does not have, so it cannot be held equal, and the pending path loses nothing (propose
 * writes the points and the shape in one staged write).
 */
export function bustPointsMoved(act: { apex_r: readonly number[]; apex_l: readonly number[]; cleavage?: readonly number[] }, declared: { apex_r: readonly number[]; apex_l: readonly number[]; cleavage: readonly number[] }): boolean {
  const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
  return !same(act.apex_r, declared.apex_r) || !same(act.apex_l, declared.apex_l) || act.cleavage === undefined || !same(act.cleavage, declared.cleavage);
}

function checkRow(row: ChestRow, parts: PartsFile | null, config: CharacterConfig | null, writeConfig: boolean, problems: Problem[]): { fields: ShapeField[]; pending: PendingBustShape['fields']; moved: boolean } {
  const at = `${row.base}[${row.index}]`;
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
  if (config === null) return { fields: [], pending: {}, moved: false };
  const mesh = Object.hasOwn(config.meshes, row.slot) ? config.meshes[row.slot] : undefined;
  if (mesh === undefined || !('contour' in mesh)) {
    const found = mesh === undefined ? 'no mesh in config.meshes' : `a ${['grid', 'auto', 'influence', 'explicit'].find(m => m in mesh) ?? 'non-contour'} mesh`;
    problems.push({ code: 'BUST_LANDMARKS_SLOT', object: `${at}.edit.slot`, detail: `"${row.slot}" has ${found}; a part whose config.meshes entry is a contour mesh is required (the chest carrier propose drafts)` });
    return { fields: [], pending: {}, moved: false };
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
  // Issue #1443: with the points moved, the shape is not written against the config's old points: it waits in the
  // sidecar like a first draft's, and propose writes it with the new points.
  const moved = declared !== undefined && bustPointsMoved(row.landmarks, declared);
  const fields: ShapeField[] = [];
  const pending: PendingBustShape['fields'] = {};
  for (const key of SHAPE_KEYS) {
    if (actShape[key] === configShape[key]) continue;
    const spelled = row.shape[key];
    // No contour.bust yet: the field differs from the default, so the act spells it. It is left pending in the
    // sidecar for propose --write-config to write with the three points (shape fields alone make no contour.bust).
    // Points moved (issue #1443): the same, and a field the act leaves out where the config declares another value
    // is pending as the default's value, since the record holds values and the act's shape is the default there.
    if (declared === undefined || moved) {
      pending[key] = spelled ?? SHAPE_DEFAULTS[key];
      continue;
    }
    if (writeConfig) {
      fields.push(spelled === undefined ? { key } : { key, value: spelled });
      continue;
    }
    const from = declared[key] === undefined ? 'the default' : 'the config';
    problems.push({
      code: 'BUST_LANDMARKS_SHAPE', object: `${at}.edit.bust.${key}`,
      detail: `is ${show(actShape[key])}${spelled === undefined ? ' (absent, the default)' : ''}; meshes.${row.slot}.contour.bust.${key} ${show(configShape[key])}, ${from}, is required: the landmarks file carries no such field; run again with --write-config to take the act's value into the config; propose --write-config keeps the config's shape fields on the redraft (#1428)`,
    });
  }
  // Issue #1441: the points against the shape propose will check them with, so this command refuses what propose
  // refuses. The config after this command: the act's fields with --write-config, else the declared ones. A cleavage
  // the act leaves out is derived by propose from a midline this command does not have, so it is checked there.
  const after = declared === undefined ? undefined : writeConfig && !moved ? { ...row.shape } : { ...declared };
  const shape = effectiveBustShape(after, pending);
  const { apex_r, apex_l, cleavage } = row.landmarks;
  if (cleavage !== undefined && typeof shape.alpha.value === 'number' && typeof shape.clearance.value === 'number') {
    const detail = bustClearanceDetail({ apex_r, apex_l, cleavage }, shape.alpha.value, shape.clearance.value);
    if (detail !== null) problems.push({ code: 'CONFIG_BUST_CLEARANCE', object: `${at}.edit.bust`, detail: `${detail}; ${bustShapeClause(shape)}` });
  }
  return { fields, pending, moved };
}

/** A path's device and inode, or null when nothing is there. */
function identity(path: string): { dev: number; ino: number; file: boolean; directory: boolean } | null {
  try {
    const stat = statSync(path);
    return { dev: stat.dev, ino: stat.ino, file: stat.isFile(), directory: stat.isDirectory() };
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Refuse an output that lands in the parts directory, over an input (by path, or as a hard link to it: same device
 * and inode, compared where the output exists, as the staged config writer compares its target), over a directory,
 * or over an existing file that is not writable.
 */
function checkOut(out: string, inputs: { act: string; config: string; parts: string }, problems: Problem[]): void {
  // Symlinks resolved where the path exists; a new file is its existing directory's real path plus its name.
  const real = (p: string): string => {
    if (existsSync(p)) return realpathSync(p);
    return existsSync(dirname(p)) ? join(realpathSync(dirname(p)), basename(p)) : p;
  };
  const partsDir = real(inputs.parts);
  const sources = [['--from-act', inputs.act], ['--config', inputs.config], ['--parts', join(inputs.parts, 'parts.json')]] as const;
  for (const [flag, path] of [['--out', out], [`--out's provenance record`, out + BUST_LANDMARKS_PROVENANCE_SUFFIX]] as const) {
    const refuse = (detail: string): void => { problems.push({ code: 'BUST_LANDMARKS_OUT', object: flag, detail: `is ${path}, ${detail}` }); };
    const target = real(path);
    if (target === partsDir || target.startsWith(partsDir + sep)) refuse(`inside --parts ${inputs.parts}; a path outside the parts directory is required`);
    let found: ReturnType<typeof identity>;
    try { found = identity(path); }
    catch (error) {
      refuse(`which cannot be read (${errorCode(error)}); a path that is no input is required`);
      continue;
    }
    for (const [name, input] of sources) {
      if (target === real(input)) {
        if (name !== '--parts') refuse(`the ${name} input; a path that is no input is required`);
        continue;
      }
      let source: ReturnType<typeof identity> = null;
      try { source = identity(input); } catch { source = null; }
      if (found !== null && source !== null && found.dev === source.dev && found.ino === source.ino) {
        refuse(`a hard link to the ${name} input ${input} (the same device and inode); a path that is no input is required`);
      }
    }
    if (found === null) continue;
    if (!found.file) refuse(`an existing ${found.directory ? 'directory' : 'non-file'}; a file path is required`);
    else {
      try { accessSync(path, constants.W_OK); }
      catch (error) { refuse(`an existing file that is not writable (${errorCode(error)}); a writable path is required, and the earlier file is kept`); }
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

/** What a checked act writes: the two files' bytes, and the config patch `--write-config` stages. */
export interface BustLandmarksPlan {
  landmarks: BustLandmarksFile;
  provenance: BustLandmarksProvenance;
  out: string;
  provenancePath: string;
  /** The landmarks file's bytes, then the provenance record's. */
  texts: readonly [string, string];
  /** With `writeConfig`: the act's shape fields that differ from the config's `contour.bust`; null when none differs. */
  configPatch: ConfigWritePatch | null;
  /** Issue #1443: the config declares `contour.bust` and the act moves its points ({@link bustPointsMoved}), so a
   * differing shape is pending in the record and the config is not written. */
  moved: boolean;
}

/**
 * Read the act, `parts.json` and the config and check the one chest row against them. Every problem, `prior`
 * included, is collected and thrown once; nothing is written here.
 */
export function planBustLandmarks(input: { act: string; parts: string; config: string; out: string; writeConfig?: boolean }, prior: readonly Problem[] = []): BustLandmarksPlan {
  const problems: Problem[] = [...prior];
  const actPath = resolve(input.act), partsDir = resolve(input.parts), configPath = resolve(input.config), out = resolve(input.out);
  checkOut(out, { act: actPath, config: configPath, parts: partsDir }, problems);
  let actBytes: Buffer | string;
  try { actBytes = readFileSync(actPath); } catch (error) { actBytes = errorCode(error); }
  const act = readAct(actBytes, input.act, problems);
  const parts = collect(() => readParts(join(partsDir, 'parts.json')), problems);
  const config = collect(() => loadConfig(configPath), problems);
  const row = act === null ? null : oneRow(act.rows, problems);
  const { fields, pending, moved } = row === null ? { fields: [], pending: {}, moved: false } : checkRow(row, parts, config, input.writeConfig === true, problems);
  if (problems.length > 0 || act === null || row === null || typeof actBytes === 'string') throw new PartsError(problems);
  const text = bustLandmarksText(row.landmarks);
  const provenance: BustLandmarksProvenance = {
    spec: BUST_LANDMARKS_PROVENANCE_SPEC,
    act: {
      schema: act.schema, act_id: act.actId, file_sha256: sha256(actBytes),
      ...(act.carrierFile === undefined ? {} : { carrier_file: { path: act.carrierFile.path, sha256: act.carrierFile.sha256 } }),
    },
    row_sha256: row.sha256,
    slot: row.slot,
    source: { hash: row.hash, frame: { width: row.frame.width, height: row.frame.height } },
    landmarks_sha256: sha256(text),
    ...(Object.keys(pending).length === 0 ? {} : { shape: { status: 'pending' as const, fields: pending } }),
  };
  return {
    landmarks: row.landmarks, provenance, out, provenancePath: out + BUST_LANDMARKS_PROVENANCE_SUFFIX,
    texts: [text, JSON.stringify(provenance, null, 2) + '\n'],
    configPatch: fields.length === 0 ? null : { kind: 'bust-shape', part: row.slot, fields },
    moved,
  };
}

/** Narrow file operations, supplied only by failure controls; the command uses the real ones. */
export interface BustLandmarksFiles { replace?: (from: string, to: string) => void }

/** Both outputs staged beside their destinations: `commit` renames them in, `cancel` removes them, `undo` puts back what a commit replaced. */
export interface StagedBustLandmarks { commit(): void; cancel(): void; undo(): void }

/**
 * Write both outputs to temporary siblings (`.<name>.rig-parts.tmp`, created exclusively, so a leftover is refused
 * by name rather than overwritten). A destination that exists is written through its symlinks, and its bytes and
 * mode are kept for `undo`. A failure at any step removes the temporaries and puts back every file it replaced.
 */
export function stageBustLandmarks(plan: BustLandmarksPlan, files: BustLandmarksFiles = {}): StagedBustLandmarks {
  return stageReplacements([[plan.out, plan.texts[0]], [plan.provenancePath, plan.texts[1]]], files);
}

/** {@link stageBustLandmarks} over any files: also the sidecar `propose` marks applied beside its staged config write. */
export function stageReplacements(writes: ReadonlyArray<readonly [string, string]>, files: BustLandmarksFiles = {}): StagedBustLandmarks {
  const failure = (path: string, action: string, error: unknown): Problem => (
    error instanceof PartsError ? error.problems[0] : { code: 'BUST_LANDMARKS_OUT', object: path, detail: `${action} (${errorCode(error)}); a writable path in an existing directory is required, and the earlier files are kept` });
  // The planner refuses a directory or an unreadable destination by name; one that became so since is refused here, never thrown raw.
  const slots = writes.map(([path, text]) => {
    try {
      const dest = existsSync(path) ? realpathSync(path) : path;
      let previous: { bytes: Buffer; mode: number } | null = null;
      if (existsSync(dest)) {
        const stat = lstatSync(dest);
        if (!stat.isFile()) throw new PartsError([{ code: 'BUST_LANDMARKS_OUT', object: path, detail: `is an existing ${stat.isDirectory() ? 'directory' : 'non-file'}; a file path is required, and nothing was written` }]);
        previous = { bytes: readFileSync(dest), mode: stat.mode & 0o777 };
      }
      return { dest, text, temp: join(dirname(dest), `.${basename(dest)}.rig-parts.tmp`), previous, owned: false, placed: false };
    } catch (error) { throw new PartsError([failure(path, 'could not be read before it is replaced', error)]); }
  });
  const cancel = (): void => {
    const problems: Problem[] = [];
    for (const slot of slots) {
      if (!slot.owned) continue;
      try { rmSync(slot.temp, { force: true }); slot.owned = false; }
      catch (error) { problems.push(failure(slot.temp, 'the temporary could not be removed; remove it by hand', error)); }
    }
    if (problems.length > 0) throw new PartsError(problems);
  };
  const undo = (): void => {
    const problems: Problem[] = [];
    for (const slot of [...slots].reverse()) {
      if (!slot.placed) continue;
      try {
        if (slot.previous === null) rmSync(slot.dest, { force: true });
        else writeFileSync(slot.dest, slot.previous.bytes, { mode: slot.previous.mode });
        slot.placed = false;
      } catch (error) { problems.push(failure(slot.dest, 'the earlier file could not be put back', error)); }
    }
    if (problems.length > 0) throw new PartsError(problems);
  };
  /** Clean up after `error` at `path`, and throw it with every cleanup failure beside it. */
  const fail = (path: string, action: string, error: unknown): never => {
    const problems = [failure(path, action, error)];
    for (const step of [undo, cancel]) {
      try { step(); } catch (cleanup) { if (cleanup instanceof PartsError) problems.push(...cleanup.problems); else throw cleanup; }
    }
    throw new PartsError(problems);
  };
  for (const slot of slots) {
    try {
      writeFileSync(slot.temp, slot.text, { flag: 'wx', mode: slot.previous?.mode ?? 0o666 });
      slot.owned = true;
    } catch (error) {
      // An exclusive create that failed made no file of ours; one that failed mid-write did.
      if (errorCode(error) !== 'EEXIST' && existsSync(slot.temp)) slot.owned = true;
      fail(slot.temp, `could not be staged${errorCode(error) === 'EEXIST' ? ': a leftover temporary is there; remove it' : ''}`, error);
    }
  }
  return {
    cancel,
    undo,
    commit(): void {
      for (const slot of slots) {
        try {
          (files.replace ?? renameSync)(slot.temp, slot.dest);
          slot.owned = false;
          slot.placed = true;
        } catch (error) { fail(slot.dest, 'could not be replaced', error); }
      }
    },
  };
}

/**
 * Plan, stage and commit without a config write: the outputs are written only when every check has passed, both
 * or neither.
 */
export function bustLandmarksFromAct(input: { act: string; parts: string; config: string; out: string }, files: BustLandmarksFiles = {}): BustLandmarksPlan {
  const plan = planBustLandmarks(input);
  stageBustLandmarks(plan, files).commit();
  return plan;
}

/** The record beside a landmarks file `propose --bust-landmarks` reads, checked; `pending` is its shape still to write. */
export interface BustSidecar {
  path: string;
  provenance: BustLandmarksProvenance;
  /** The reviewed shape still to write onto the chest carrier, or null (none recorded, or already applied). */
  pending: PendingBustShape | null;
  /** The record's bytes with its shape marked applied, written beside the config write that applies it. */
  appliedText: string | null;
}

/**
 * Issue #1382: read `<landmarks>.provenance.json` beside a landmarks file, if there is one. None there is null, and
 * `propose` reads the landmarks file as before. One there must be a well-formed record of this spec whose
 * `landmarks_sha256` is the landmarks file's own digest; anything else is refused by name, every problem at once.
 */
export function readBustSidecar(landmarksPath: string, landmarksBytes: Uint8Array): BustSidecar | null {
  const path = landmarksPath + BUST_LANDMARKS_PROVENANCE_SUFFIX;
  try { lstatSync(path); }
  catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw new PartsError([{ code: 'PROPOSE_BUST_SIDECAR', object: path, detail: `cannot be read (${errorCode(error)}); the provenance record bust-landmarks wrote, or no file at this path, is required` }]);
  }
  const problems: Problem[] = [];
  const fail = (object: string, detail: string): void => { problems.push({ code: 'PROPOSE_BUST_SIDECAR', object, detail }); };
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    const why = error instanceof SyntaxError ? `does not parse as JSON (${error.message})` : `cannot be read (${errorCode(error)})`;
    throw new PartsError([{ code: 'PROPOSE_BUST_SIDECAR', object: path, detail: `${why}; the provenance record bust-landmarks wrote is required` }]);
  }
  if (!isObject(raw)) throw new PartsError([{ code: 'PROPOSE_BUST_SIDECAR', object: path, detail: `is ${show(raw)}; a ${BUST_LANDMARKS_PROVENANCE_SPEC} object is required` }]);
  const keys = ['spec', 'act', 'row_sha256', 'slot', 'source', 'landmarks_sha256', 'shape'];
  for (const key of Object.keys(raw)) if (!keys.includes(key)) fail(`${path} ${key}`, `is unknown; ${BUST_LANDMARKS_PROVENANCE_SPEC} takes ${keys.join(', ')}`);
  if (raw.spec !== BUST_LANDMARKS_PROVENANCE_SPEC) fail(`${path} spec`, `is ${show(raw.spec)}; "${BUST_LANDMARKS_PROVENANCE_SPEC}" is required`);
  const hex = (v: unknown): v is string => typeof v === 'string' && SHA256_PATTERN.test(v);
  const act = raw.act;
  // Issue #1539: a comment-only act's record carries the chest carrier's file; a chest-landmarks act's carries none.
  const comment = isObject(act) && act.schema === BUST_LANDMARKS_COMMENT_ACT_SCHEMA;
  const carrierFile = isObject(act) ? act.carrier_file : undefined;
  if (!isObject(act) || (act.schema !== BUST_LANDMARKS_ACT_SCHEMA && !comment) || !isName(act.act_id) || !hex(act.file_sha256)
    || (comment ? modelFile(carrierFile) === null : Object.hasOwn(act, 'carrier_file'))) {
    fail(`${path} act`, `is ${show(act)}; {schema: "${BUST_LANDMARKS_ACT_SCHEMA}", act_id, file_sha256}, or {schema: "${BUST_LANDMARKS_COMMENT_ACT_SCHEMA}", act_id, file_sha256, carrier_file: {path, sha256}}, is required`);
  }
  if (!hex(raw.row_sha256)) fail(`${path} row_sha256`, `is ${show(raw.row_sha256)}; 64 lowercase hex digits are required`);
  if (!isName(raw.slot)) fail(`${path} slot`, `is ${show(raw.slot)}; the chest carrier's part name is required`);
  const source = raw.source;
  const frame = isObject(source) ? source.frame : undefined;
  if (!isObject(source) || !hex(source.hash) || !isObject(frame) || typeof frame.width !== 'number' || typeof frame.height !== 'number') {
    fail(`${path} source`, `is ${show(source)}; {hash, frame: {width, height}} is required`);
  }
  if (!hex(raw.landmarks_sha256)) fail(`${path} landmarks_sha256`, `is ${show(raw.landmarks_sha256)}; 64 lowercase hex digits are required`);
  let shape: BustLandmarksProvenance['shape'];
  if (Object.hasOwn(raw, 'shape')) {
    const s = raw.shape;
    const fields = isObject(s) ? s.fields : undefined;
    if (!isObject(s) || (s.status !== 'pending' && s.status !== 'applied') || !isObject(fields) || Object.keys(fields).length === 0) {
      fail(`${path} shape`, `is ${show(s)}; {status: "pending" or "applied", fields: one or more of ${SHAPE_KEYS.join(', ')}} is required`);
    } else {
      const read: PendingBustShape['fields'] = {};
      for (const key of Object.keys(fields)) if (!(SHAPE_KEYS as readonly string[]).includes(key)) fail(`${path} shape.fields.${key}`, `is unknown; contour.bust's shape fields are ${SHAPE_KEYS.join(', ')}`);
      for (const key of SHAPE_KEYS) {
        if (!Object.hasOwn(fields, key)) continue;
        const v = fields[key];
        const ok = key === 'bone_r' || key === 'bone_l' ? isName(v) : typeof v === 'number' && Number.isFinite(v);
        if (!ok) fail(`${path} shape.fields.${key}`, `is ${show(v)}; ${key === 'bone_r' || key === 'bone_l' ? 'a non-empty bone name' : 'a finite number'} is required`);
        else read[key] = v as number | string;
      }
      shape = { status: s.status, fields: read };
    }
  }
  if (problems.length > 0) throw new PartsError(problems);
  const computed = sha256(landmarksBytes);
  if (raw.landmarks_sha256 !== computed) {
    throw new PartsError([{ code: 'PROPOSE_BUST_SIDECAR_DIGEST', object: `${path} landmarks_sha256`, detail: `is "${raw.landmarks_sha256 as string}"; "${computed}" is required, the sha256 of ${landmarksPath}'s bytes: the landmarks file is not the one this record was written with` }]);
  }
  const a = act as Record<string, unknown>, src = source as Record<string, unknown>, f = frame as Record<string, unknown>;
  const provenance: BustLandmarksProvenance = {
    spec: BUST_LANDMARKS_PROVENANCE_SPEC,
    act: {
      schema: a.schema as ActSchema, act_id: a.act_id as string, file_sha256: a.file_sha256 as string,
      ...(comment ? { carrier_file: modelFile(carrierFile) as ModelFile } : {}),
    },
    row_sha256: raw.row_sha256 as string,
    slot: raw.slot as string,
    source: { hash: src.hash as string, frame: { width: f.width as number, height: f.height as number } },
    landmarks_sha256: computed,
    ...(shape === undefined ? {} : { shape }),
  };
  const pending = shape?.status === 'pending' ? { part: provenance.slot, fields: shape.fields } : null;
  const appliedText = pending === null ? null : JSON.stringify({ ...provenance, shape: { status: 'applied', fields: pending.fields } }, null, 2) + '\n';
  return { path, provenance, pending, appliedText };
}
