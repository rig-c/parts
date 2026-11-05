import { checkRow, checkSlotRow, checkSlotParts } from './checkrow.ts';
/**
 * Issue #942: the colour step across part boundaries, against the rig's own pieces.
 *
 * The reference is never the painting: a part drawn on top legitimately shows its own colour over the neighbour's
 * line art, so a painting-relative bar refuses correct overlaps (the #942 v1 reading). The reference is the rig's
 * own parts, drawn by the SAME official rasteriser, so bilinear filtering is the same on both sides:
 *
 * - setup frame: each piece's `parts/<name>.png` as a flat quad at its parts.json rectangle (the layer stack
 *   recomposited). A texture stretched into its padded UVs, or a notch the mesh or the texture cuts out of a
 *   piece, makes the rig's render differ from that flat draw; a correct overlap does not, because both sides draw
 *   the top piece.
 * - every idle frame: the posed frame with each piece re-seated on its own parts PNG (padded as the rig image is)
 *   through its own art UVs. A pixel then carries the colour its piece-local point has at rest, so a boundary
 *   pair's step there is the same boundary's step at rest, tracked through the pieces' own UVs.
 *
 * The readout is, per 4-adjacent boundary pair (two different drawn owners, in either the render or the
 * reference), the excess of the rendered step over the reference step: max(0, s_render - s_reference), with
 * s = the largest RGB difference across the pair, both composited over white. The bar is the largest excess over
 * every pair of every measured frame, against the rig's declared `boundary_colour.max_step_excess`. Nothing is
 * derived from the art: no declaration, no measurement (SKIP, never a pass).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Plate } from '@rig-c/core/plate';
import type { Frame, Piece } from '@rig-c/core/render-shared';
import { seamSourceAttachment } from './check.ts';
import { cropToSpineY } from './coords.ts';
import type { Problem } from './errors.ts';
import type { PartsFile } from './parts.ts';
import { readPng } from './raster/png.ts';

export const BOUNDARY_COLOUR_LINE = 'BOUNDARY_COLOUR_STEP';
export const BOUNDARY_COLOUR_CODE = 'CHECK_BOUNDARY_COLOUR_STEP';
export const BOUNDARY_COLOUR_UNMEASURED_CODE = 'CHECK_BOUNDARY_COLOUR_UNMEASURED';
export const BOUNDARY_COLOUR_UNMEASURED_SUFFIX = "; the step against the rig's own pieces cannot be taken, and an untaken reading is never a pass — make the slot draw a parts.json piece, or drop boundary_colour from the requirements file and the bar reports SKIP";
export const UNDECLARED_BOUNDARY_COLOUR_REASON = 'not measured, not a pass: no requirements file declares boundary_colour; declare {"boundary_colour": {"max_step_excess": <0-255>}} in the --requirements file (config.requirements under build) to hold every part boundary of the setup and every idle frame to the rig\'s own pieces';

/** The one declaration: the largest step excess (0-255) the rig allows over its own pieces. No default exists. */
export interface BoundaryColour {
  max_step_excess: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const freeKey = (k: string, v: unknown): boolean => (k.startsWith('x-') && k.length > 2 && isObject(v)) || ((k === 'note' || k.endsWith('_note')) && typeof v === 'string');

/** Shape only: an object holding exactly an authored integer `max_step_excess` from 0 through 255 (and notes). */
export function boundaryColourProblems(value: unknown, at: string): Problem[] {
  if (!isObject(value)) return [{ code: 'REQUIREMENTS_FIELD', object: at, detail: `is ${JSON.stringify(value)?.slice(0, 40)}; requires {"max_step_excess": <an authored integer 0-255>}` }];
  const problems: Problem[] = [];
  for (const k of Object.keys(value)) if (k !== 'max_step_excess' && !freeKey(k, value[k])) problems.push({ code: 'REQUIREMENTS_FIELD', object: `${at}.${k}`, detail: 'is not a field this block reads (max_step_excess; note or *_note as a string; x-<name> as a record)' });
  const v = value.max_step_excess;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > 255) problems.push({ code: 'REQUIREMENTS_FIELD', object: `${at}.max_step_excess`, detail: `is ${JSON.stringify(v)}; requires an authored integer from 0 through 255 — the largest RGB step a part boundary may add over the rig's own pieces; no default is derived from the art` });
  return problems;
}

/** One boundary pair's worst reading: where, in which frame, and the two steps the excess is the difference of. */
export interface BoundaryColourReading {
  parts: [string, string];
  frame: string;
  at: [number, number];
  excess: number;
  rendered_step: number;
  reference_step: number;
}
export interface BoundaryColourUnmeasured {
  slot: string;
  frame: string;
  reason: string;
}
export interface BoundaryColourMeasured {
  status: 'PASS' | 'FAIL';
  instrument: 'rigc renderer, setup and every idle frame';
  reference: 'setup: parts.json flat pieces; idle: each piece re-seated on its own parts PNG through its art UVs';
  max_step_excess: number;
  frames: number;
  boundary_pairs: number;
  worst: BoundaryColourReading | null;
  /** Every part pair over the allowance, its worst reading each, in part-pair order. */
  over: BoundaryColourReading[];
  /** Pieces the reference could not be drawn for; any one makes the line FAIL (never a pass). */
  unmeasured: BoundaryColourUnmeasured[];
  alternates: 'not measured';
}

type Api = typeof import('@rig-c/core/render-shared');

export interface BoundaryColourInput {
  build: string;
  stage: { x: number; y: number; width: number; height: number };
  parts: PartsFile;
  partsDir: string;
  imagesDir: string;
  rig: Record<string, unknown>;
  fps: number;
}

interface Source { flat: Plate; padded: Plate; rec: { x: number; y: number; w: number; h: number } }

function plateOf(r: { width: number; height: number; data: ArrayLike<number> }, pad: number): Plate {
  const p = new Plate(r.width + 2 * pad, r.height + 2 * pad);
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) for (let c = 0; c < 4; c++) p.data[((y + pad) * p.width + x + pad) * 4 + c] = r.data[(y * r.width + x) * 4 + c];
  return p;
}

/**
 * Measure the declared bar on a gated build. `problems` gains one CHECK_BOUNDARY_COLOUR_STEP per part pair over the
 * allowance, and one CHECK_BOUNDARY_COLOUR_UNMEASURED per piece the reference cannot be drawn for.
 */
export function measureBoundaryColour(api: Api, input: BoundaryColourInput, declared: BoundaryColour, problems: Problem[]): BoundaryColourMeasured {
  const skeleton = join(input.build, 'skeleton.json'), atlas = join(input.build, 'skeleton.atlas');
  const candidate = api.loadCandidate({ skeletonText: readFileSync(skeleton, 'utf8'), atlasText: readFileSync(atlas, 'utf8'), atlasDir: input.build, label: 'boundary colour' }, { skeleton, atlas }, undefined);
  const opts = { geometry: true, texture: true };
  const setup = api.throughPoser(candidate.choice, (p) => api.sampleSetupPose(p, opts)).value[0];
  const idle = api.throughPoser(candidate.choice, (p) => api.sampleAnimation(p, 'idle', input.fps, opts)).value;
  const W = input.stage.width, H = input.stage.height;
  const vp = { minX: input.stage.x, minY: input.stage.y, maxX: input.stage.x + W, maxY: input.stage.y + H, scale: 1, width: W, height: H };
  const project = api.projector(vp);
  const slotParts = checkSlotParts(input.rig, input.parts.parts.map(p => p.name));
  const records = new Map(input.parts.parts.map((p) => [p.name, p]));
  const sources = new Map<string, Source | string>();
  const unmeasured: BoundaryColourUnmeasured[] = [];
  const unmeasuredSeen = new Set<string>();
  const sourceOf = (frame: Frame, piece: Piece, label: string): Source | null => {
    const fail = (reason: string): null => {
      const key = `${piece.slot}\u0000${reason}`;
      if (!unmeasuredSeen.has(key)) { unmeasuredSeen.add(key); unmeasured.push({ slot: piece.slot, frame: label, reason }); }
      return null;
    };
    if (piece.kind === 'mesh' && piece.source !== undefined) return fail('the piece is clipped; a clipped piece has no flat reference');
    if (piece.texture === undefined) return fail('the renderer gave no art UVs for the piece');
    const drawn = (frame.attachments ?? []).filter((a) => a.slot === piece.slot);
    if (drawn.length !== 1) return fail(`the frame draws ${drawn.length} attachment(s) on the slot; one is required`);
    // The drawn attachment is resolved by name the way the seam's source mapping is (an entry's explicit `name`, or
    // else its key), so a skin entry renamed under another key still reads its own image.
    let image: string;
    try { image = String(seamSourceAttachment(input.rig, piece.slot, String(drawn[0].attachment)).image); }
    catch (e) { return fail(`the skin resolves no single image drawing for attachment "${String(drawn[0].attachment)}" (${e instanceof Error ? e.message : String(e)})`); }
    let got = sources.get(image);
    if (got === undefined) {
      const name = image.replace(/\.png$/, '');
      const rec = records.get(name);
      const partPng = join(input.partsDir, `${name}.png`), rigPng = join(input.imagesDir, image);
      if (rec === undefined) got = `parts.json holds no record "${name}" for the image "${image}"`;
      else if (!existsSync(partPng) || !existsSync(rigPng)) got = `${existsSync(partPng) ? `the rig image "${image}"` : `the parts image "${name}.png"`} is absent`;
      else {
        const src = readPng(partPng), rigImg = readPng(rigPng);
        const dx = rigImg.width - src.width, dy = rigImg.height - src.height;
        if (src.width !== rec.w || src.height !== rec.h) got = `parts/${name}.png is ${src.width}x${src.height}, its record ${rec.w}x${rec.h}`;
        else if (dx !== dy || dx < 0 || dx % 2 !== 0) got = `the rig image "${image}" is ${rigImg.width}x${rigImg.height}, not parts/${name}.png's ${src.width}x${src.height} with one even pad on every side`;
        else got = { flat: plateOf(src, 0), padded: plateOf(src, dx / 2), rec };
      }
      sources.set(image, got);
    }
    return typeof got === 'string' ? fail(got) : got;
  };
  const own = (frame: Frame, pages: Map<string, Plate>, pieces: Piece[]): { data: Uint8Array; owner: Int32Array } => {
    const plate = api.renderFrame({ ...frame, pieces }, pages, vp, [255, 255, 255, 255]);
    const owner = new Int32Array(W * H).fill(-1);
    pieces.forEach((piece, i) => api.rasterisePiece(api.pageFor(pages, piece), piece, project, vp, (x, y, _r, _g, _b, a) => { if (a > 0) owner[y * W + x] = i; }));
    return { data: plate.data, owner };
  };
  const pairsWorst = new Map<string, BoundaryColourReading>();
  let worst: BoundaryColourReading | null = null;
  let boundaryPairs = 0;
  const readFrame = (frame: Frame, label: string, flat: boolean): void => {
    const pages = new Map<string, Plate>(candidate.pages);
    const ok: boolean[] = [];
    const refPieces = frame.pieces.map((piece, i): Piece => {
      const s = sourceOf(frame, piece, label);
      ok.push(s !== null);
      if (s === null) return piece;
      const page = `boundary-colour:${i}`;
      if (flat) {
        const { x, y, w, h } = s.rec;
        const wx = (rx: number): number => rx + vp.minX, wy = (ry: number): number => vp.minY + cropToSpineY(ry, H);
        pages.set(page, s.flat);
        // rasteriseQuad reads world/uv pairs 0, 1, 2 as (s=1,t=0), the origin, (s=0,t=1).
        return { kind: 'region', slot: piece.slot, page, tint: piece.tint, ...(piece.dark === undefined ? {} : { dark: piece.dark }), world: [wx(x + w), wy(y), wx(x), wy(y), wx(x), wy(y + h), wx(x + w), wy(y + h)], uvs: [1, 0, 0, 0, 0, 1, 1, 1] };
      }
      pages.set(page, s.padded);
      const { uvWindow: _window, ...rest } = piece;
      return { ...rest, page, uvs: (piece.texture as { artUvs: number[] }).artUvs } as Piece;
    });
    if (ok.some((v) => !v)) return;
    const r = own(frame, candidate.pages, frame.pieces), f = own(frame, pages, refPieces);
    const slots = frame.pieces.map((p) => p.slot);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      for (const d of [1, W]) {
        if ((d === 1 && x + 1 >= W) || (d === W && y + 1 >= H)) continue;
        const q = p + d;
        let a = r.owner[p], b = r.owner[q];
        if (a < 0 || b < 0 || a === b) { a = f.owner[p]; b = f.owner[q]; if (a < 0 || b < 0 || a === b) continue; }
        boundaryPairs++;
        let sr = 0, sf = 0;
        for (let c = 0; c < 3; c++) { sr = Math.max(sr, Math.abs(r.data[p * 4 + c] - r.data[q * 4 + c])); sf = Math.max(sf, Math.abs(f.data[p * 4 + c] - f.data[q * 4 + c])); }
        const excess = Math.max(0, sr - sf);
        const pair: [string, string] = slots[a] < slots[b] ? [slots[a], slots[b]] : [slots[b], slots[a]];
        const key = pair.join('|');
        const reading: BoundaryColourReading = { parts: pair, frame: label, at: [x, y], excess, rendered_step: sr, reference_step: sf };
        const prev = pairsWorst.get(key);
        if (prev === undefined || excess > prev.excess) pairsWorst.set(key, reading);
        if (worst === null || excess > worst.excess) worst = reading;
      }
    }
  };
  readFrame(setup, 'setup', true);
  for (const frame of idle) readFrame(frame, `idle frame ${frame.index} (t ${+frame.time.toFixed(4)} s)`, false);
  const over = [...pairsWorst.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, v]) => v).filter((v) => v.excess > declared.max_step_excess);
  for (const u of unmeasured) problems.push({ code: BOUNDARY_COLOUR_UNMEASURED_CODE, object: `slot "${u.slot}" (${u.frame})`, detail: `${u.reason}${BOUNDARY_COLOUR_UNMEASURED_SUFFIX}` });
  for (const o of over) problems.push({ code: BOUNDARY_COLOUR_CODE, object: `part pair "${o.parts[0]}|${o.parts[1]}"`, detail: `${o.frame}, stage pixel (${o.at[0]}, ${o.at[1]}): step excess ${o.excess} > declared max_step_excess ${declared.max_step_excess} (rendered step ${o.rendered_step}, the rig's own pieces ${o.reference_step}); a texture stretched into its padded UVs or a notch cut out of a piece shows here — fix the rig image or mesh of that pair (AUTHORING, failure map)` });
  return {
    status: over.length === 0 && unmeasured.length === 0 ? 'PASS' : 'FAIL',
    instrument: 'rigc renderer, setup and every idle frame',
    reference: 'setup: parts.json flat pieces; idle: each piece re-seated on its own parts PNG through its art UVs',
    max_step_excess: declared.max_step_excess,
    frames: 1 + idle.length,
    boundary_pairs: boundaryPairs,
    worst,
    over: over.map(r => ({ ...r, ...checkRow('BOUNDARY_COLOUR_STEP.over', 'pair', true, r.parts) })),
    unmeasured: unmeasured.map(r => ({ ...r, ...checkSlotRow('BOUNDARY_COLOUR_STEP.unmeasured', false, r.slot, slotParts) })),
    alternates: 'not measured',
  };
}

/** The lines `check` prints: the undeclared SKIP, or the measured line and one per part pair over the allowance. */
export function boundaryColourLines(line: BoundaryColourMeasured | null): string[] {
  if (line === null) return [`${BOUNDARY_COLOUR_LINE}: SKIP — ${UNDECLARED_BOUNDARY_COLOUR_REASON}`];
  const w = line.worst;
  return [
    `${BOUNDARY_COLOUR_LINE}: ${line.status} — ${line.boundary_pairs} boundary pair reading(s) over ${line.frames} frame(s) (setup and every idle frame), worst step excess ${w === null ? 'none (no boundary)' : `${w.excess} at part pair "${w.parts.join('|')}" ${w.frame} (${w.at.join(', ')})`}, declared max_step_excess ${line.max_step_excess}; ${line.reference}; alternate sets not measured`,
    ...line.over.map((o) => `${BOUNDARY_COLOUR_LINE}: part pair "${o.parts.join('|')}" FAIL — ${o.frame} (${o.at.join(', ')}), step excess ${o.excess} > ${line.max_step_excess} (rendered ${o.rendered_step}, own pieces ${o.reference_step})`),
    ...line.unmeasured.map((u) => `${BOUNDARY_COLOUR_LINE}: slot "${u.slot}" NOT MEASURED — ${u.frame}: ${u.reason}`),
  ];
}
