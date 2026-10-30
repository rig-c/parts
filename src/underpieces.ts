import type { PixelProvenance } from './provenance.ts';
/** Explicit rigid seam geometry and exact donor crops; no raster synthesis. */
import type { BoneEntry, RegionSpec } from './config.ts';
import type { PartRecord } from './parts.ts';
import type { Raster } from './raster/types.ts';
import { newRaster } from './raster/types.ts';
import { refuseIfAny, type Problem } from './errors.ts';

export interface UnderPiece {
  name: string;
  seam: { neighbours: [string, string]; at: [number, number]; normal: [number, number] };
  carrier: string;
  side: 'negative' | 'positive';
  donor: string;
  /** Exclusive rig-pixel rectangle; donor is an assembled part, not the painting. */
  box: [number, number, number, number];
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const name = (v: unknown): v is string => typeof v === 'string' && v.trim() === v && v.length > 0 && !v.startsWith('.') && !/[\\/:]/.test(v);
const point = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n));
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).every(k => names.includes(k)) && names.every(k => Object.hasOwn(v, k));
export function underPieceProblems(value: unknown, at = 'config.assemble.under_pieces'): Problem[] {
  const out: Problem[] = [], seen = new Set<string>();
  const fail = (object: string, detail: string) => out.push({ code: 'CONFIG_UNDER_PIECE', object, detail });
  if (!Array.isArray(value) || value.length === 0) return [{ code: 'CONFIG_UNDER_PIECE', object: at, detail: 'a nonempty array of {name, seam: {neighbours, at, normal}, carrier, side, donor, box} is required; omit the field for no under-piece' }];
  value.forEach((v, i) => {
    const where = `${at}[${i}]`;
    if (!object(v) || !keys(v, ['name', 'seam', 'carrier', 'side', 'donor', 'box'])) { fail(where, 'exactly name, seam, carrier, side, donor and box are required'); return; }
    for (const k of ['name', 'carrier', 'donor']) if (!name(v[k])) fail(`${where}.${k}`, 'a nonempty file-safe name is required');
    if (typeof v.name === 'string') { if (seen.has(v.name)) fail(`${where}.name`, `duplicates "${v.name}"; each output name is unique`); seen.add(v.name); }
    if (v.side !== 'negative' && v.side !== 'positive') fail(`${where}.side`, '"negative" or "positive" is required, relative to seam.normal');
    const s = v.seam;
    if (!object(s) || !keys(s, ['neighbours', 'at', 'normal']) || !Array.isArray(s.neighbours) || s.neighbours.length !== 2 || !s.neighbours.every(name) || s.neighbours[0] === s.neighbours[1] || !point(s.at) || !point(s.normal) || Math.abs(Math.hypot(...s.normal) - 1) > 1e-9) fail(`${where}.seam`, 'two distinct neighbour part names, finite at [x,y], and a unit normal [nx,ny] are required');
    if (!Array.isArray(v.box) || v.box.length !== 4 || !v.box.every(n => Number.isSafeInteger(n) && n >= 0) || v.box[2] <= v.box[0] || v.box[3] <= v.box[1]) fail(`${where}.box`, 'a nonempty nonnegative integer rig-pixel [x0,y0,x1,y1] rectangle is required; upper limits are exclusive');
  });
  return out;
}
export function orderedUnderPiece(d: UnderPiece): UnderPiece {
  return { name: d.name, seam: { neighbours: [...d.seam.neighbours], at: [...d.seam.at], normal: [...d.seam.normal] }, carrier: d.carrier, side: d.side, donor: d.donor, box: [...d.box] };
}
interface Placed { record: PartRecord; image: Raster }
interface Context { bones?: readonly BoneEntry[]; regions?: Readonly<Record<string, RegionSpec>>; meshes?: Readonly<Record<string, unknown>> }
const regionBone = (v: RegionSpec | undefined) => typeof v === 'string' ? v : v?.bone;
function geometry(d: UnderPiece, context: Context, parts: readonly Placed[]): void {
  const fail = (detail: string): never => { refuseIfAny([{ code: 'ASSEMBLE_UNDER_GEOMETRY', object: `under-piece "${d.name}"`, detail }]); throw new Error('unreachable'); };
  const bones = (context.bones ?? []).flatMap(b => 'name' in b ? [b] : []);
  const names = d.seam.neighbours.map(n => {
    const p = parts.find(p => p.record.name === n);
    if (p === undefined || p.record.limb?.band !== undefined || context.meshes?.[n] !== undefined) return fail(`neighbour "${n}" requires an existing rigid part`);
    return p.record.limb?.bone ?? regionBone(context.regions?.[n]);
  });
  const a = bones.find(b => b.name === names[0]), b = bones.find(b => b.name === names[1]);
  if (a === undefined || b === undefined || (a.parent !== b.name && b.parent !== a.name)) fail(`neighbours ${d.seam.neighbours.join('/')} require adjacent, explicitly positioned single bones; found ${names.join('/')}`);
  const parent = a!.parent === b!.name ? b! : a!, child = a!.parent === b!.name ? a! : b!;
  const dx = child.at[0] - parent.at[0], dy = child.at[1] - parent.at[1], length = Math.hypot(dx, dy);
  if (length === 0 || d.seam.at.some((v, i) => v !== child.at[i]) || Math.abs(d.seam.normal[0] - dx / length) > 1e-9 || Math.abs(d.seam.normal[1] - dy / length) > 1e-9) fail(`at must equal child "${child.name}" origin ${JSON.stringify(child.at)}, normal must point from "${parent.name}" to it; found ${JSON.stringify(d.seam)}`);
  const expected = d.carrier === parent.name ? 'negative' : d.carrier === child.name ? 'positive' : null;
  if (expected === null || d.side !== expected) fail(`carrier "${d.carrier}" side "${d.side}" must name one neighbour bone and its ${expected ?? 'declared'} half-plane`);
}
/** Snapshot all donors before adding any output: under-pieces cannot donate to one another. */
export function addUnderPieces(declarations: readonly UnderPiece[] | undefined, parts: readonly Placed[], context: Context, size: readonly [number, number], provenance?: (d: UnderPiece, image: Raster, donor: PartRecord) => PixelProvenance): Placed[] {
  if (declarations === undefined) return parts as Placed[];
  refuseIfAny(underPieceProblems(declarations));
  const out = [...parts];
  for (const d of declarations) {
    geometry(d, context, parts);
    const fail = (code: string, detail: string): never => { refuseIfAny([{ code, object: `under-piece "${d.name}" (donor "${d.donor}")`, detail }]); throw new Error('unreachable'); };
    if (out.some(p => p.record.name === d.name)) fail('ASSEMBLE_UNDER_NAME', 'the output name is already a part; choose a new name');
    const donor = parts.find(p => p.record.name === d.donor);
    if (donor === undefined || donor.image === undefined || donor.image.width !== donor.record.w || donor.image.height !== donor.record.h || donor.record.depth !== undefined) fail('ASSEMBLE_UNDER_DONOR', 'an existing assembled part without a depth sheet is required');
    const p = donor!.record, [x0, y0, x1, y1] = d.box;
    if (x1 > size[0] || y1 > size[1] || x0 < p.x || y0 < p.y || x1 > p.x + p.w || y1 > p.y + p.h) fail('ASSEMBLE_UNDER_BOX', `crop ${JSON.stringify(d.box)} must lie inside the rig and donor box ${JSON.stringify([p.x, p.y, p.x + p.w, p.y + p.h])}; no padding or resize is performed`);
    const image = newRaster(x1 - x0, y1 - y0);
    let opaque = 0, atSeam = 0, foreign = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const from = ((y - p.y) * p.w + x - p.x) * 4, to = ((y - y0) * image.width + x - x0) * 4;
      image.data.set(donor!.image.data.subarray(from, from + 4), to);
      const alpha = image.data[to + 3];
      if (alpha > 8) opaque++;
      if (alpha === 0) continue;
      const dot = (x + 0.5 - d.seam.at[0]) * d.seam.normal[0] + (y + 0.5 - d.seam.at[1]) * d.seam.normal[1];
      if (d.side === 'negative' ? dot > 0 : dot < 0) foreign++;
      if (alpha > 8 && Math.hypot(x + 0.5 - d.seam.at[0], y + 0.5 - d.seam.at[1]) <= 1) atSeam++;
    }
    if (foreign > 0) fail('ASSEMBLE_UNDER_FOREIGN_SIDE', `${foreign} nontransparent crop pixels lie outside carrier "${d.carrier}" side "${d.side}"; select a crop containing only the declared carrier side, never mask foreign art`);
    if (atSeam === 0) fail('ASSEMBLE_UNDER_EMPTY', `donor crop has ${atSeam} pixels with alpha > 8 within one rig pixel of seam.at ${JSON.stringify(d.seam.at)}; art at the seam is required`);
    const record: PartRecord = { name: d.name, from: p.from, x: x0, y: y0, w: image.width, h: image.height, opaque_px: opaque, projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0, under_piece: orderedUnderPiece(d), ...(p.from.startsWith('painting:') ? { visible_px: opaque, occluded_px: 0, projected_core_px: opaque, source_px_taken: opaque, visible_not_projected_px: 0 } : {}), ...(p.taken_layers === undefined ? {} : { taken_layers: p.taken_layers }) };
    if (provenance !== undefined) record.provenance = provenance(d, image, p);
    out.splice(Math.min(...d.seam.neighbours.map(n => out.findIndex(p => p.record.name === n))), 0, { record, image });
  }
  return out;
}
/** Check actual output order after every rig rewrite; provenance alone cannot prove placement. */
export function underOrderProblems(declarations: readonly UnderPiece[] | undefined, slots: readonly { name: string; bone: string }[]): Problem[] {
  return (declarations ?? []).flatMap(d => {
    const i = slots.findIndex(s => s.name === d.name), neighbours = d.seam.neighbours.map(n => slots.findIndex(s => s.name === n));
    return i < 0 || neighbours.some(n => n < 0 || i >= n) || slots[i]?.bone !== d.carrier ? [{ code: 'RIG_UNDER_DRAW_ORDER', object: `under-piece "${d.name}"`, detail: `final slot index ${i} on "${slots[i]?.bone ?? 'absent'}", neighbours ${d.seam.neighbours.map((n, k) => `"${n}" at ${neighbours[k]}`).join(', ')}; slot must be strictly before both, on carrier "${d.carrier}" — use a compatible limb gather/turn layout` }] : [];
  });
}
