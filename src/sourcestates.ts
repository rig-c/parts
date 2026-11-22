/**
 * The per-texel source-state map beside a part with `source_visibility` (#1473).
 *
 * `source_visibility` counts a part's opaque texels by the state the producing
 * See-through run recorded for the material each one came from. The map puts
 * those states where they lie: one PNG the part's size, every channel of a
 * texel holding its state code and alpha 255 everywhere, bound into
 * `parts.json` by SHA-256 as `source_state_map`. `check` reads it to say which
 * of those texels a pose shows.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPAQUE_ALPHA_ABOVE } from './layers.ts';
import { PartsError, type Problem } from './errors.ts';
import type { PartRecord, PartSourceVisibility, SOURCE_UNDECIDED_REASONS } from './parts.ts';
import { decodePngBytes, encodePngBytes } from './raster/png.ts';
import { newRaster, type Raster } from './raster/types.ts';

/**
 * A texel's code in the map. `none` is a texel at alpha 8 or less in the part
 * PNG, which `source_visibility` does not count; every other code is the one
 * state `source_visibility` counted the texel under.
 */
export const SOURCE_STATE = {
  none: 0,
  visible: 1,
  occluded: 2,
  'partial-top': 3,
  'depth-tie': 4,
  'mixed-source-states': 5,
  unrecorded: 6,
} as const;
export type SourceStateName = keyof typeof SOURCE_STATE;
/**
 * The states `check` reports when a pose shows them, in report order: `occluded`, then `source_visibility`'s
 * undecided reasons in their order. Spelled out rather than spread from `SOURCE_UNDECIDED_REASONS`, because
 * parts.ts reaches this module through partvisibility.ts and a value import back would read it before it is
 * initialised; the type below holds the two lists equal.
 */
export const EXPOSED_SOURCE_STATES = ['occluded', 'partial-top', 'depth-tie', 'mixed-source-states'] as const;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const EXPOSED_STATES_MATCH_RECORD: Same<typeof EXPOSED_SOURCE_STATES, readonly ['occluded', ...typeof SOURCE_UNDECIDED_REASONS]> = true;
export type ExposedSourceState = typeof EXPOSED_SOURCE_STATES[number];

/** The map's file name in `parts/`, beside `<part>.png`. */
export function sourceStateMapImage(part: string): string {
  return `${part}_source_states.png`;
}

/** The map as a PNG raster: each code in R, G and B, alpha 255. */
export function sourceStateRaster(codes: Uint8Array, width: number, height: number): Raster {
  const r = newRaster(width, height);
  for (let p = 0; p < width * height; p++) r.data.set([codes[p], codes[p], codes[p], 255], p * 4);
  return r;
}

/** The PNG bytes the map is written as, and their SHA-256. */
export function encodeSourceStateMap(codes: Uint8Array, width: number, height: number): { image: Raster; bytes: Uint8Array; sha256: string } {
  const image = sourceStateRaster(codes, width, height);
  const bytes = encodePngBytes(image);
  return { image, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** The counts `source_visibility` holds, read off the codes. */
export function sourceStateCounts(codes: Uint8Array): Omit<PartSourceVisibility, 'source_layers'> {
  const n = new Array<number>(7).fill(0);
  for (const c of codes) n[c]++;
  return {
    visible_px: n[SOURCE_STATE.visible],
    occluded_px: n[SOURCE_STATE.occluded],
    undecided_px: { 'partial-top': n[SOURCE_STATE['partial-top']], 'depth-tie': n[SOURCE_STATE['depth-tie']], 'mixed-source-states': n[SOURCE_STATE['mixed-source-states']] },
    unrecorded_px: n[SOURCE_STATE.unrecorded],
  };
}

/**
 * Read and verify a part's map: the file is present, its bytes hash to the
 * declared SHA-256, it decodes to the part's size with alpha 255 and R = G = B
 * holding a known code, its nonzero codes lie exactly on the part PNG's texels
 * above alpha 8, and its counts equal `source_visibility`. Every problem is
 * collected and thrown once. `partsDir` is the directory holding the part PNGs.
 */
export function readSourceStateMap(partsDir: string, part: PartRecord, partImage: Raster, label = `part "${part.name}"`): Uint8Array {
  const declared = part.source_state_map;
  const visibility = part.source_visibility;
  if (declared === undefined || visibility === undefined) throw new Error(`readSourceStateMap: ${label} carries no source_state_map`);
  const path = join(partsDir, declared.image);
  const at = `${label} source_state_map (${declared.image})`;
  const problems: Problem[] = [];
  const fail = (code: string, detail: string): void => { problems.push({ code, object: at, detail }); };
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(readFileSync(path)); }
  catch {
    throw new PartsError([{ code: 'PARTS_SOURCE_STATE_MAP_PRESENT', object: at, detail: `${path} is not readable; re-run assemble, which writes the map beside the part PNG` }]);
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== declared.sha256) {
    throw new PartsError([{ code: 'PARTS_SOURCE_STATE_MAP_SHA256', object: at, detail: `sha256 is ${actual}; declared ${declared.sha256} is required — the map was changed after assemble wrote it; re-run assemble` }]);
  }
  let image: Raster;
  try { image = decodePngBytes(bytes, path); }
  catch { throw new PartsError([{ code: 'PARTS_SOURCE_STATE_MAP_FORMAT', object: at, detail: 'is not a decodable PNG' }]); }
  if (image.width !== part.w || image.height !== part.h || partImage.width !== part.w || partImage.height !== part.h) {
    throw new PartsError([{ code: 'PARTS_SOURCE_STATE_MAP_FORMAT', object: at, detail: `is ${image.width}x${image.height} beside a ${partImage.width}x${partImage.height} part PNG; the record's ${part.w}x${part.h} is required for both` }]);
  }
  const codes = new Uint8Array(part.w * part.h);
  let badCode = 0, firstBad = -1, offMaterial = 0, firstOff = -1;
  for (let p = 0; p < codes.length; p++) {
    const [r, g, b, a] = image.data.subarray(p * 4, p * 4 + 4);
    if (r !== g || g !== b || a !== 255 || r > SOURCE_STATE.unrecorded) { badCode++; if (firstBad < 0) firstBad = p; continue; }
    codes[p] = r;
    const material = partImage.data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE;
    if (material !== (r !== SOURCE_STATE.none)) { offMaterial++; if (firstOff < 0) firstOff = p; }
  }
  const xy = (p: number): string => `(${p % part.w}, ${Math.floor(p / part.w)})`;
  if (badCode > 0) fail('PARTS_SOURCE_STATE_MAP_FORMAT', `has ${badCode} texel(s) that are not R = G = B = a code 0-${SOURCE_STATE.unrecorded} at alpha 255, first ${xy(firstBad)}`);
  if (offMaterial > 0) fail('PARTS_SOURCE_STATE_MAP_COUNTS', `has ${offMaterial} texel(s) whose code disagrees with the part PNG's alpha above ${OPAQUE_ALPHA_ABOVE}, first ${xy(firstOff)}; code 0 exactly where the part is not material is required`);
  if (problems.length === 0) {
    const counted = sourceStateCounts(codes);
    const want = { visible_px: visibility.visible_px, occluded_px: visibility.occluded_px, undecided_px: { 'partial-top': visibility.undecided_px['partial-top'], 'depth-tie': visibility.undecided_px['depth-tie'], 'mixed-source-states': visibility.undecided_px['mixed-source-states'] }, unrecorded_px: visibility.unrecorded_px };
    if (JSON.stringify(counted) !== JSON.stringify(want)) fail('PARTS_SOURCE_STATE_MAP_COUNTS', `counts ${JSON.stringify(counted)}; source_visibility's ${JSON.stringify(want)} is required`);
  }
  if (problems.length > 0) throw new PartsError(problems);
  return codes;
}
