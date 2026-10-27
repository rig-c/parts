/** The explicit two-bone top/bottom waist driver; no anatomical name matching. */
import { regionBone, type CharacterConfig, type Point } from './config.ts';
import type { Problem } from './errors.ts';
import { ART_ALPHA } from './mesh.ts';
import { tagOf, type PartsFile } from './parts.ts';
import type { Mask } from './raster/types.ts';
import { capAndFloor, influences, type Influence, type InfluenceLimits, type Segment } from './weights.ts';

export interface WaistPair { top: string; bottom: string; lower: string; upper: string }

/** Only a unique, explicitly bound pair enables the correction. Other mesh modes keep their contract. */
export function waistPairs(
  parts: PartsFile['parts'], cfg: Pick<CharacterConfig, 'meshes' | 'regions'>,
  segments: ReadonlyMap<string, readonly Segment[]>, bones: ReadonlyMap<string, { parent: string | null }>,
): { pairs: Map<string, WaistPair>; problems: Problem[] } {
  const pairs = new Map<string, WaistPair>(), problems: Problem[] = [];
  const bottoms = parts.filter((p) => tagOf(p.from) === 'bottomwear' && cfg.meshes[p.name] === undefined && cfg.regions[p.name] !== undefined);
  for (const p of parts) {
    const mesh = cfg.meshes[p.name];
    if (p.limb?.band !== undefined || tagOf(p.from) !== 'topwear' || mesh === undefined || !('grid' in mesh) || (mesh.rule ?? 'distance') !== 'distance') continue;
    const names = [...new Set((segments.get(p.name) ?? []).map((s) => s.bone))];
    if (names.length !== 2) continue;
    const candidates: WaistPair[] = [];
    for (const bottom of bottoms) {
      const lower = regionBone(cfg.regions[bottom.name]);
      if (!names.includes(lower)) continue;
      const upper = names.find((n) => n !== lower) as string;
      let ancestor = bones.get(upper)?.parent ?? null;
      while (ancestor !== null && ancestor !== lower) ancestor = bones.get(ancestor)?.parent ?? null;
      if (ancestor === lower) candidates.push({ top: p.name, bottom: bottom.name, lower, upper });
    }
    if (candidates.length > 1) problems.push({ code: 'RIG_WAIST_PAIR', object: `mesh "${p.name}"`, detail: `has ${candidates.length} eligible rigid bottomwear partners (${candidates.map((c) => c.bottom).join(', ')}); one explicit binding pair is required, never the first part` });
    else if (candidates.length === 1) pairs.set(p.name, candidates[0]);
  }
  const byBottom = new Map<string, WaistPair[]>();
  for (const pair of pairs.values()) byBottom.set(pair.bottom, [...(byBottom.get(pair.bottom) ?? []), pair]);
  for (const [bottom, owners] of byBottom) if (owners.length > 1) {
    problems.push({ code: 'RIG_WAIST_PAIR', object: `region "${bottom}"`, detail: `has ${owners.length} eligible topwear drivers (${owners.map((p) => p.top).join(', ')}); a shared bottom cannot choose the first field` });
    for (const pair of owners) pairs.delete(pair.top);
  }
  return { pairs, problems };
}

export interface WaistBand { pair: WaistPair; anchor: number; hem: number; plateau: number }

/** Painted hem is the last alpha>8 row; one source texel above it begins H-only support. */
export function waistBand(pair: WaistPair, art: Mask, anchor: number): WaistBand | Problem {
  let hem = -1;
  for (let y = 0; y < art.height; y++) for (let x = 0; x < art.width; x++) if (art.data[y * art.width + x] !== 0) hem = y;
  const plateau = hem - 1;
  if (hem < 0 || !Number.isFinite(anchor) || anchor >= plateau) return {
    code: 'RIG_WAIST_HEIGHT', object: `mesh "${pair.top}"`,
    detail: `upper bone "${pair.upper}" anchor is image row ${anchor}, painted hem is ${hem} (last alpha > ${ART_ALPHA} row); the anchor must be strictly above its H-only plateau at row ${plateau}, one source texel before an existing painted hem`,
  };
  return { pair, anchor, hem, plateau };
}

/** Apply the existing cap/floor ONCE to the height driver; upper vertices use the unchanged distance call. */
export function waistInfluences(
  at: Point, imageY: number, band: WaistBand,
  segments: readonly Segment[], radius: number, limits: InfluenceLimits, exponent: number,
): Influence[] | Problem {
  if (imageY <= band.anchor) return influences(at, segments, radius, limits, exponent);
  const t = Math.min(1, (imageY - band.anchor) / (band.plateau - band.anchor));
  const uncut = influences(at, segments, radius, { maxInfluences: Number.MAX_SAFE_INTEGER, minWeight: 0 }, exponent);
  const lower = uncut.find((w) => w.bone === band.pair.lower);
  if (lower === undefined || !uncut.some((w) => w.bone === band.pair.upper)) return { code: 'RIG_WAIST_BINDING', object: `mesh "${band.pair.top}"`, detail: `distance shares name [${uncut.map((w) => w.bone).join(', ')}]; the declared pair "${band.pair.upper}"/"${band.pair.lower}" is required before height transfer` };
  const h = lower.weight + (1 - lower.weight) * t;
  // Keep the segment declaration's first-appearance order for an exact cap tie.
  return capAndFloor([...new Set(segments.map((s) => s.bone))].map((bone) => [bone, bone === band.pair.lower ? h : 1 - h] as const), limits);
}
