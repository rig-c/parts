import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Plate } from '@rig-c/core/plate';
import type { AttachmentRest, Frame } from '@rig-c/core/render-shared';
import { seamGridOf, seamsOf, setupCellReader, type SeamCell, type SeamGrid } from '@rig-c/core/seam';
import { DRAWN_ALPHA } from '@rig-c/core/passthrough';
import { checkRow } from './checkrow.ts';
import { seamSourceAttachment, type MotionSeamPair } from './check.ts';
import type { Problem } from './errors.ts';
import { BODY_TURN_ANIM, BODY_YAW_DIAL_BONE, PITCH_DIAL_BONE, TURN_BONE, YAW_DIAL_BONE } from './turn.ts';

export const BEHIND_SEAM_LINE = 'BEHIND_PART_SEAMS';
export const UNDECLARED_BEHIND_SEAM_REASON = 'HOLE: no requirements.behind_seams declares an authored threshold T; not measured, never a pass';
export const BEHIND_SEAM_CODE = 'CHECK_BEHIND_PART_SEAMS';
export const BEHIND_SEAM_UNMEASURED_CODE = 'CHECK_BEHIND_PART_SEAMS_UNMEASURED';
export const NO_SOURCE_SETUP_STANDING_REASON = 'no --source painting was supplied; setup standing compares the setup render with the painting';
export const IDLE_STANDING_MOTION_READ_REASON = 'not applicable: motion_opened reads the pair';
export const IDLE_STANDING_NO_ORACLE_REASON = "idle standing is not measured: idle frames have no painting oracle, and the pair's idle reading is motion_opened";

export interface BehindSeams {
  /** Opt in to the rig's declared ranges; never supplies or guesses a range. */
  turn?: true;
  threshold?: number;
  allowance?: number;
  pairs?: Array<{ part: string; neighbour: string; threshold?: number; allowance?: number }>;
}
export type BehindSeamsApi = Pick<typeof import('@rig-c/core/render-shared'), 'projector' | 'pageFor' | 'rasterisePiece' | 'renderFrame'>;
export interface BehindSeamsStockPair {
  pair: string;
  frames: number;
  drawn: number;
  banded: number;
  gapCovered: Array<{ index: number; time: number; cell: number; cells: readonly SeamCell[] }>;
}
export interface BehindSeamsFramesInput {
  pairs: readonly MotionSeamPair[];
  setup: Frame | null;
  idle: readonly Frame[];
  rest: readonly AttachmentRest[];
  pages: Map<string, Plate>;
  stock: readonly BehindSeamsStockPair[] | null;
  fps: number;
  /** Setup painting frame rendered onto the pair's seam grid; absent or null when --source was not supplied. */
  painting?: Frame | null;
  /** Atlas pages for {@link painting}; defaults to {@link pages} when omitted. */
  paintingPages?: ReadonlyMap<string, Plate>;
  turn?: BehindSeamsTurnInput;
  /** Issue #1403 plant only: the samples[] cap; production never sets it ({@link BEHIND_SAMPLE_CAP}). */
  sampleCap?: number;
}
export interface BehindSeamsTurnPose {
  name: string;
  values: Record<string, number>;
  observed_values?: Record<string, number>;
  slider_times?: Record<string, number>;
}
export interface BehindSeamsTurnInput {
  poses: BehindSeamsTurnPose[];
  frames: Array<Frame | null>;
  setup: Frame | null;
  rest: readonly AttachmentRest[];
  stock: readonly BehindSeamsStockPair[] | null;
  reason?: string;
  sourceSkeletonSha256?: string;
  poser?: string;
}
export interface BehindSeamsTurnPair {
  pair: string;
  parts: [string, string];
  threshold: number | null;
  allowance: number;
  frames: BehindSeamsFrame[];
  sampled_poses: number;
  read_poses: number;
  unmeasured_poses: number;
  motion_opened: { status: BehindSeamsCount['status']; max_px: number };
  standing: { status: BehindSeamsCount['status']; max_px: number };
}
export interface BehindSeamsTurnMeasured {
  status: BehindSeamsCount['status'];
  poses: string[];
  pairs: BehindSeamsTurnPair[];
  unmeasured: BehindSeamsMeasured['unmeasured'];
  limitations: string;
}
export interface BehindSeamsSample {
  x: number;
  y: number;
  rear_rgb: [number, number, number];
  rear_weight: number;
  contributors: Array<{ slot: string; weight: number }>;
  distances: [number, number] | null;
  counted: boolean;
}
export interface BehindSeamsCount {
  status: 'PASS' | 'FAIL' | 'SKIP';
  boundary_cells: number;
  geometric_px: number;
  raw_px: number;
  px: number;
  box: [number, number, number, number] | null;
  max_spatial_run_cells: number;
  samples: BehindSeamsSample[];
  /** Issue #1403: present only when the list held more than {@link BEHIND_SAMPLE_CAP} rows; the rows left out. */
  samples_omitted?: number;
}
export type BehindSeamsEndpoint = [grid_x: number, grid_y: number, world_x: number, world_y: number, owner: number];
export interface BehindSeamsUnreadCorridor {
  axis: 'horizontal' | 'vertical';
  /** Spatial order: left/right on a row, top/bottom on a column; owners are not inferred. */
  endpoints: [BehindSeamsEndpoint, BehindSeamsEndpoint];
  cells: Array<[number, number]>;
  cell_count: number;
}
export interface BehindSeamsStanding extends BehindSeamsCount {
  /** Present when standing is SKIP: at setup without --source, or on every idle frame. */
  reason?: string;
  /** Distinct grid cells across all unread corridors, including cross-axis intersections. */
  unread_cells?: number;
  /** Omitted, together with unread_cells, when every corridor's endpoints are readable. */
  unread_corridors?: BehindSeamsUnreadCorridor[];
}
export interface BehindSeamsFrame {
  animation: 'idle' | 'turn' | null;
  pose?: string;
  values?: Record<string, number>;
  observed_values?: Record<string, number>;
  slider_times?: Record<string, number>;
  index: number;
  time: number;
  behind_slots: string[];
  grid: SeamGrid | null;
  motion_opened: BehindSeamsCount;
  standing: BehindSeamsStanding;
}
export interface BehindSeamsHit {
  index: number;
  time: number;
  px: number;
  cell: number;
  area: number;
  box: [number, number, number, number];
}
export interface BehindSeamsReading {
  status: 'PASS' | 'FAIL' | 'SKIP';
  /** Present on the idle standing summary, which is never measured on idle frames. */
  reason?: string;
  frames: BehindSeamsHit[];
  hit_frames: number;
  max_px: number;
  worst: BehindSeamsHit | null;
  spans: Array<{ first: number; last: number; frames: number; seconds: number }>;
  max_run: { frames: number; seconds: number };
  max_spatial_run_cells: number;
  max_spatial_run_world: number;
}
export interface BehindSeamsPair {
  animation: 'idle';
  pair: string;
  parts: [string, string];
  declared: string[];
  threshold: number | null;
  allowance: number;
  setup: BehindSeamsFrame | null;
  frames: BehindSeamsFrame[];
  motion_opened: BehindSeamsReading;
  standing: BehindSeamsReading;
  /** Idle counts only; a read frame has both halves available, even when failing. */
  sampled_frames?: number;
  read_frames?: number;
  unmeasured_frames?: number;
}
export interface BehindSeamsMeasured {
  status: 'PASS' | 'FAIL' | 'SKIP';
  fps: number;
  pairs: BehindSeamsPair[];
  unmeasured: Array<{ pair: string | null; frame: string; reason: string }>;
  limitations: string;
  turn?: BehindSeamsTurnMeasured;
}

/** The orchestration input: only an already gated build and its full stock seam
 * render. Unsupported active worlds/sets must be named, never silently defaulted. */
export interface BehindSeamsInput {
  build: string;
  rig: Record<string, unknown>;
  pairs: readonly MotionSeamPair[];
  stockDir: string | null;
  fps: number;
  /** Stage-resampled painting from --source, or null/undefined when --source was not supplied. */
  painting?: { stage: { x: number; y: number; width: number; height: number }; raster: { width: number; height: number; data: ArrayLike<number> } } | null;
  unsupported?: string;
  turnBuild?: { build?: string; reason?: string };
}

const LIMITATIONS = 'setup and every idle frame; motion uses transported setup-overlap support; standing certifies horizontal and vertical bracketed runs, not all curved or diagonal openings; rear-set attribution is not individual-slot blame; other animations and alternate skins are not measured';
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const freeKey = (k: string, v: unknown): boolean => (k.startsWith('x-') && k.length > 2 && record(v)) || ((k === 'note' || k.endsWith('_note')) && typeof v === 'string');
const keyOf = (a: string, b: string): string => JSON.stringify(a < b ? [a, b] : [b, a]);

/** Shape only. Missing T is a valid undeclared reading, never an invented default. */
export function behindSeamsProblems(value: unknown, at: string): Problem[] {
  const problems: Problem[] = [];
  const bad = (object: string, detail: string): void => { problems.push({ code: 'REQUIREMENTS_FIELD', object, detail }); };
  const block = (v: unknown, where: string, pair: boolean): void => {
    if (!record(v)) { bad(where, `is ${JSON.stringify(v)}; requires a behind_seams record with an authored threshold and optional allowance/pair overrides`); return; }
    for (const k of Object.keys(v)) if (!(pair ? ['part', 'neighbour', 'threshold', 'allowance'] : ['threshold', 'allowance', 'pairs', 'turn']).includes(k) && !freeKey(k, v[k])) bad(`${where}.${k}`, 'is not a field this block reads (threshold, allowance, pairs, turn; pair entries name part and neighbour; note or *_note as a string; x-<name> as a record)');
    if (!pair && 'turn' in v && v.turn !== true) bad(`${where}.turn`, 'requires true to read the rig\'s declared turn range endpoints and corners; omit to retain setup/idle only; no ranges are supplied here');
    if ('threshold' in v && (typeof v.threshold !== 'number' || !Number.isInteger(v.threshold) || v.threshold < 0 || v.threshold > 255)) bad(`${where}.threshold`, `is ${JSON.stringify(v.threshold)}; requires an authored integer from 0 through 255; no threshold is derived from the art`);
    if ('allowance' in v && (typeof v.allowance !== 'number' || !Number.isSafeInteger(v.allowance) || v.allowance < 0)) bad(`${where}.allowance`, `is ${JSON.stringify(v.allowance)}; requires a nonnegative safe integer count of seam cells`);
    if (pair) {
      for (const name of ['part', 'neighbour']) if (typeof v[name] !== 'string' || (v[name] as string).trim().length === 0) bad(`${where}.${name}`, 'requires a nonempty named member of a selected motion seam pair');
      if (typeof v.part === 'string' && v.part === v.neighbour) bad(where, `names the same part ${JSON.stringify(v.part)} twice; two different members are required`);
    }
  };
  block(value, at, false);
  if (record(value) && 'pairs' in value) {
    if (!Array.isArray(value.pairs)) bad(`${at}.pairs`, 'requires an array of {part, neighbour, threshold?, allowance?} overrides');
    else {
      const seen = new Set<string>();
      value.pairs.forEach((p, i) => {
        block(p, `${at}.pairs[${i}]`, true);
        if (record(p) && typeof p.part === 'string' && typeof p.neighbour === 'string') {
          const key = keyOf(p.part, p.neighbour);
          if (seen.has(key)) bad(`${at}.pairs[${i}]`, `duplicates pair ${JSON.stringify(p.part + '|' + p.neighbour)}; reversed members name the same pair`);
          seen.add(key);
        }
      });
    }
  }
  return problems;
}

/**
 * Issue #1403: the most `samples[]` rows one count writes. Per-cell samples are
 * a bounded diagnostic sample; the counts are the measurement. Every count,
 * `px`, `box`, hit, span, run and status is computed from all cells before the
 * list is cut, and a list at or under the cap is written as it was.
 */
export const BEHIND_SAMPLE_CAP = 64;

/** One standing candidate: its measured ordinal, cell, chosen distances, whether it qualified, and the smaller distance. */
interface StandingCandidate { ord: number; k: number; d: [number, number]; q: boolean; m: number }

/**
 * Whether standing candidate `a` ranks worse than `b`. The gate counts a cell
 * when both rear-to-front distances exceed the threshold (`qualifies`), so the
 * smaller of the two is the margin the threshold is compared against: a counted
 * cell ranks first, then the larger smaller-distance, then the earlier measured
 * ordinal. No two candidates tie, so the kept set is one set.
 */
export function standingWorse(a: Pick<StandingCandidate, 'ord' | 'q' | 'm'>, b: Pick<StandingCandidate, 'ord' | 'q' | 'm'>): boolean {
  if (a.q !== b.q) return a.q;
  if (a.m !== b.m) return a.m > b.m;
  return a.ord < b.ord;
}

/**
 * The {@link BEHIND_SAMPLE_CAP} worst standing candidates seen so far, without
 * keeping the others: at most `cap` entries live at once.
 */
export class WorstStanding {
  readonly kept: StandingCandidate[] = [];
  seen = 0;
  constructor(readonly cap: number = BEHIND_SAMPLE_CAP) {}
  offer(k: number, d: [number, number], q: boolean): void {
    const c: StandingCandidate = { ord: this.seen++, k, d, q, m: d[0] < d[1] ? d[0] : d[1] };
    if (this.kept.length < this.cap) { this.kept.push(c); return; }
    let weakest = 0;
    for (let i = 1; i < this.kept.length; i++) if (standingWorse(this.kept[weakest], this.kept[i])) weakest = i;
    if (standingWorse(c, this.kept[weakest])) this.kept[weakest] = c;
  }
  /** The kept candidates in measured order. */
  inOrder(): StandingCandidate[] { return [...this.kept].sort((x, y) => x.ord - y.ord); }
}

/**
 * The positions kept from a list of `n` rows that carry no magnitude: all of
 * them at or under `cap`, otherwise floor(j · n / cap) for j = 0 … cap − 1 —
 * `cap` distinct, increasing positions spread across the list, the first row
 * always among them.
 */
export function evenlySpaced(n: number, cap: number = BEHIND_SAMPLE_CAP): number[] {
  if (n <= cap) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: cap }, (_, j) => Math.floor((j * n) / cap));
}

const emptyCount = (status: BehindSeamsCount['status'] = 'SKIP'): BehindSeamsCount => ({ status, boundary_cells: 0, geometric_px: 0, raw_px: 0, px: 0, box: null, max_spatial_run_cells: 0, samples: [] });
type RGB = [number, number, number];
interface Material { alpha: Float64Array; base: Float64Array; delta: Float64Array }
const material = (n: number): Material => ({ alpha: new Float64Array(n), base: new Float64Array(n * 3), delta: new Float64Array(n * 3) });

/** The official callback supplies straight RGB, after tint, before composite byte rounding.
 * Accumulate deviations from the first colour: a constant colour has exactly zero
 * deviation at every alpha, including T=0. There is no epsilon or unpremultiplication
 * of the callback's already straight colour. */
function add(m: Material, k: number, rgb: RGB, a: number): void {
  if (m.alpha[k] === 0) for (let c = 0; c < 3; c++) { m.base[3 * k + c] = rgb[c]; m.delta[3 * k + c] = 0; }
  for (let c = 0; c < 3; c++) m.delta[3 * k + c] = m.delta[3 * k + c] * (1 - a) + (rgb[c] - m.base[3 * k + c]) * a;
  m.alpha[k] = a + m.alpha[k] * (1 - a);
}
function colour(m: Material, k: number): RGB {
  return [0, 1, 2].map(c => m.base[k * 3 + c] + m.delta[k * 3 + c] / m.alpha[k]) as RGB;
}
function distance(m: Material, k: number, to: RGB): number {
  return Math.max(...[0, 1, 2].map(c => Math.abs((m.base[k * 3 + c] - to[c]) + m.delta[k * 3 + c] / m.alpha[k])));
}
function spatialRun(mask: ReadonlySet<number>, width: number, height: number): number {
  let longest = 0;
  for (const [length, lines, step, start] of [[width, height, 1, width], [height, width, width, 1]]) for (let l = 0; l < lines; l++) {
    let run = 0;
    for (let j = 0; j < length; j++) { run = mask.has(l * start + j * step) ? run + 1 : 0; longest = Math.max(longest, run); }
  }
  return longest;
}
function centre(grid: SeamGrid, k: number): [number, number] {
  return [grid.viewport.minX + (k % grid.viewport.width + 0.5) * grid.cell, grid.viewport.maxY - (Math.floor(k / grid.viewport.width) + 0.5) * grid.cell];
}
function counted(count: BehindSeamsCount, cells: ReadonlySet<number>, grid: SeamGrid, allowance: number): void {
  count.px = cells.size;
  count.status = cells.size > allowance ? 'FAIL' : 'PASS';
  count.max_spatial_run_cells = spatialRun(cells, grid.viewport.width, grid.viewport.height);
  for (const k of cells) {
    const [x, y] = centre(grid, k), d = grid.cell / 2;
    if (count.box === null) count.box = [x - d, y - d, x + d, y + d];
    else count.box = [Math.min(count.box[0], x - d), Math.min(count.box[1], y - d), Math.max(count.box[2], x + d), Math.max(count.box[3], y + d)];
  }
}

/** Issue #1405: the unread reason names each ambiguous owner case that occurs, with
 * both members' composite alpha at one endpoint. The named point is the case's first
 * endpoint in scan order, which is `unread_corridors` order: horizontal corridors top
 * to bottom and left to right, then vertical corridors left to right and top to bottom,
 * the left/top endpoint before the right/bottom one. Counts are distinct endpoint cells;
 * a case with none is omitted. */
export function ambiguousOwnerReason(a: string, b: string, corridors: readonly BehindSeamsUnreadCorridor[], cells: number,
  alpha: (gridX: number, gridY: number) => [number, number]): string {
  const byte = (v: number): string => `${Math.round(v * 255 * 100) / 100}/255`;
  const clauses: string[] = [];
  for (const owner of [0, 3]) {
    const seen = new Set<string>();
    let first: BehindSeamsEndpoint | null = null;
    for (const c of corridors) for (const e of c.endpoints) if (e[4] === owner) { seen.add(`${e[0]},${e[1]}`); first ??= e; }
    if (first === null) continue;
    const [ax, bx] = alpha(first[0], first[1]);
    clauses.push(`${owner === 0 ? `neither "${a}" nor "${b}" reaches` : `both "${a}" and "${b}" reach`} 128/255 at ${seen.size} endpoint cell(s), first at world (${first[2]}, ${first[3]}) ("${a}" ${byte(ax)}, "${b}" ${byte(bx)})`);
  }
  return `standing endpoints include ambiguous half-alpha owners: ${corridors.length} unread corridor(s), ${cells} cell(s); ${clauses.join('; ')}; each endpoint requires exactly one member at 128/255 or more; unread corridors are not zero`;
}

interface Corridor { endpoints: Array<[number, number]> }
interface RasterCache { full: Plate; hidden: Plate }

function overWhite(data: Uint8Array, q: number, c: number): number {
  return Math.round((data[q + c] * data[q + 3]) / 255 + 255 * (1 - data[q + 3] / 255));
}

function readBehindFrame(api: BehindSeamsApi, input: BehindSeamsFramesInput, pair: MotionSeamPair, frame: Frame, setup: boolean,
  stock: BehindSeamsStockPair | undefined, threshold: number, allowance: number, unread: (frame: string, reason: string) => void,
  cache: Map<Frame, Map<string, RasterCache>>, pose?: BehindSeamsTurnPose): BehindSeamsFrame {
  const isIdle = !setup && pose === undefined;
  const label = pose !== undefined ? `turn ${pose.name}` : setup ? 'setup' : `idle frame ${frame.index}`;
  const family = pose !== undefined ? 'BEHIND_PART_SEAMS.turn.pairs[].frames' : setup ? 'BEHIND_PART_SEAMS.pairs[].setup' : 'BEHIND_PART_SEAMS.pairs[].frames';
  const row: BehindSeamsFrame = { ...checkRow(family, 'pair', false, [pair.a, pair.b]), animation: pose !== undefined ? 'turn' : setup ? null : 'idle', index: frame.index, time: frame.time, ...(pose === undefined ? {} : { pose: pose.name, values: { ...pose.values }, ...(pose.observed_values === undefined ? {} : { observed_values: pose.observed_values, slider_times: pose.slider_times }) }), behind_slots: [], grid: null, motion_opened: emptyCount(),
    standing: isIdle ? { ...emptyCount('SKIP'), reason: IDLE_STANDING_NO_ORACLE_REASON } : emptyCount() };
  const fail = (reason: string): BehindSeamsFrame => { unread(label, reason); return row; };
  if (pair.unread !== undefined) return fail(pair.unread);
  if (frame.attachments === undefined) return fail('draw order/whole attachment geometry is unavailable');
  const order = frame.attachments.map(p => p.slot);
  if (new Set(order).size !== order.length || frame.pieces.some(p => !order.includes(p.slot))) return fail('drawn slots have missing or duplicate whole attachments; actual draw order cannot be read');
  const positions = frame.pieces.map(p => order.indexOf(p.slot));
  if (positions.some((p, i) => i > 0 && p < positions[i - 1])) return fail('fragment order disagrees with whole attachment draw order');
  const ia = order.indexOf(pair.a), ib = order.indexOf(pair.b);
  if (ia < 0 || ib < 0 || !frame.pieces.some(p => p.slot === pair.a) || !frame.pieces.some(p => p.slot === pair.b)) return fail('both named front slots must draw on this frame');
  row.behind_slots = order.slice(0, Math.min(ia, ib)).filter(slot => frame.pieces.some(p => p.slot === slot));
  if (row.behind_slots.length === 0) return fail('no eligible slot is drawn strictly behind both pair members (including every fragment)');
  let grid: SeamGrid | null;
  try { grid = seamGridOf({ a: pair.a, b: pair.b }, input.rest, { ...frame, attachments: frame.attachments }, input.pages); }
  catch (e) { return fail(`native seam grid unavailable: ${e instanceof Error ? e.message : String(e)}`); }
  if (grid === null) return fail('native seamGridOf returned no pair grid');
  row.grid = grid;
  const { viewport, cell } = grid, { width, height } = viewport, n = width * height;
  const A = material(n), B = material(n), project = api.projector(viewport);
  try {
    // Ordinary official full/hidden rendering, both transparent and on the SAME
    // native seam grid. No --seam/--hide combination and no PNG nearest sampling.
    let frameCache = cache.get(frame);
    if (frameCache === undefined) { frameCache = new Map(); cache.set(frame, frameCache); }
    const cacheKey = JSON.stringify([grid, row.behind_slots]);
    let rasters = frameCache.get(cacheKey);
    const behind = new Set(row.behind_slots);
    if (rasters === undefined) {
      rasters = { full: api.renderFrame(frame, input.pages, viewport, [0, 0, 0, 0]), hidden: api.renderFrame({ ...frame, pieces: frame.pieces.filter(p => !behind.has(p.slot)) }, input.pages, viewport, [0, 0, 0, 0]) };
      frameCache.set(cacheKey, rasters);
    }
    const measureStanding = pose !== undefined || (setup && input.painting !== undefined && input.painting !== null);
    let paintDiff: ((k: number) => number) | null = null;
    if (setup) {
      if (input.painting === undefined || input.painting === null) {
        row.standing = { ...emptyCount('SKIP'), reason: NO_SOURCE_SETUP_STANDING_REASON };
        unread(label, NO_SOURCE_SETUP_STANDING_REASON);
      } else {
        const paintPages = (input.paintingPages ?? input.pages) as Map<string, Plate>;
        const paintPlate = api.renderFrame(input.painting, paintPages, viewport, [0, 0, 0, 0]);
        paintDiff = (k: number): number => {
          const q = k * 4;
          if (paintPlate.data[q + 3] === 0) return Infinity;
          return Math.max(
            Math.abs(overWhite(rasters!.full.data, q, 0) - overWhite(paintPlate.data, q, 0)),
            Math.abs(overWhite(rasters!.full.data, q, 1) - overWhite(paintPlate.data, q, 1)),
            Math.abs(overWhite(rasters!.full.data, q, 2) - overWhite(paintPlate.data, q, 2)),
          );
        };
      }
    }
    const corridors = new Map<number, Corridor>();
    const support = new Set<number>();
    const unreadCells = new Set<number>(), unreadCorridors: BehindSeamsUnreadCorridor[] = [];
    const half = DRAWN_ALPHA / 255;
    const low = (k: number): boolean => A.alpha[k] + B.alpha[k] * (1 - A.alpha[k]) < half;
    const owner = (k: number): number => A.alpha[k] >= half ? B.alpha[k] >= half ? 3 : 1 : B.alpha[k] >= half ? 2 : 0;
    if (measureStanding) {
      for (const piece of frame.pieces) if (piece.slot === pair.a || piece.slot === pair.b) {
        api.rasterisePiece(api.pageFor(input.pages, piece), piece, project, viewport, (x, y, r, g, b, alpha) => add(piece.slot === pair.a ? A : B, y * width + x, [r, g, b], alpha / 255));
      }
      // A measured overlap is support even when the opening population is empty.
      for (let k = 0; k < n; k++) if (owner(k) === 3) support.add(k);
      for (const [length, lines, step, start] of [[width, height, 1, width], [height, width, width, 1]]) for (let l = 0; l < lines; l++) {
        let j = 0;
        while (j < length) {
          const k = l * start + j * step;
          if (!low(k)) {
            if (j > 0) { const prev = k - step; if (!low(prev) && owner(prev) > 0 && owner(prev) < 3 && owner(k) > 0 && owner(k) < 3 && owner(prev) !== owner(k)) { support.add(prev); support.add(k); } }
            j++; continue;
          }
          const first = j;
          while (j < length && low(l * start + j * step)) j++;
          if (first === 0 || j === length) continue; // outer silhouette, never a bracketed opening
          const left = l * start + (first - 1) * step, right = l * start + j * step;
          const a = owner(left), b = owner(right);
          if (a === 0 || b === 0 || a === 3 || b === 3) {
            const endpoint = (at: number, owner: number): BehindSeamsEndpoint => [at % width, Math.floor(at / width), ...centre(grid, at), owner];
            const cells: Array<[number, number]> = [];
            for (let t = first; t < j; t++) {
              const at = l * start + t * step;
              if (paintDiff !== null && paintDiff(at) <= threshold) continue;
              unreadCells.add(at); cells.push(centre(grid, at));
            }
            if (cells.length === 0) {
              support.add(left); support.add(right);
              continue;
            }
            unreadCorridors.push({ ...checkRow('BEHIND_PART_SEAMS.unread_corridors', 'pair', false, [pair.a, pair.b]),
              axis: step === 1 ? 'horizontal' : 'vertical', endpoints: [endpoint(left, a), endpoint(right, b)], cells, cell_count: cells.length });
            continue;
          }
          if (a === b) continue;
          support.add(left); support.add(right);
          const endpoints: [number, number] = a === 1 ? [left, right] : [right, left];
          for (let t = first; t < j; t++) {
            const at = l * start + t * step;
            const c = corridors.get(at) ?? { endpoints: [] };
            c.endpoints.push(endpoints); corridors.set(at, c);
          }
        }
      }
      row.standing.boundary_cells = support.size;
      if (unreadCorridors.length > 0) {
        row.standing.unread_cells = unreadCells.size;
        row.standing.unread_corridors = unreadCorridors;
      }
    }
    let motionReadable = setup;
    const motionCells = new Map<number, SeamCell>();
    if (!setup) {
      if (stock === undefined || stock.frames !== input.idle.length || stock.drawn !== stock.frames || stock.banded !== stock.frames) unread(label, `stock transported setup-overlap support is unavailable on every ${pose === undefined ? 'idle frame' : 'named turn pose'}; motion-opened is not measured`);
      else {
        motionReadable = true;
        const hits = stock.gapCovered.filter(h => h.index === frame.index);
        if (hits.length > 1) { motionReadable = false; unread(label, 'duplicate stock gapCovered hit for this frame'); }
        for (const hit of hits) {
          if (hit.cell !== cell || hit.time !== frame.time) { motionReadable = false; unread(label, 'stock gapCovered grid side or sample time differs from the native posed grid'); continue; }
          for (const c of hit.cells) {
            const x = Math.round((c.x - viewport.minX) / cell - 0.5), y = Math.round((viewport.maxY - c.y) / cell - 0.5), k = y * width + x;
            const actual = centre(grid, k);
            if (x < 0 || x >= width || y < 0 || y >= height || actual[0] !== c.x || actual[1] !== c.y || motionCells.has(k)) {
              motionReadable = false; unread(label, 'stock gapCovered cell is duplicate or not an exact native seam-grid centre'); continue;
            }
            motionCells.set(k, c);
          }
        }
      }
    }
    const targets = new Set([...corridors.keys(), ...motionCells.keys()]);
    const rear = material(n), weights = new Map<number, Map<string, number>>();
    const surviving = new Set<number>(), underflow = new Set<number>();
    for (const piece of frame.pieces) api.rasterisePiece(api.pageFor(input.pages, piece), piece, project, viewport, (x, y, r, g, b, alpha) => {
      const k = y * width + x;
      if (!targets.has(k)) return;
      const a = alpha / 255, keep = 1 - a;
      const w = weights.get(k) ?? new Map<string, number>();
      for (const [name, weight] of w) {
        const next = weight * keep;
        if (weight > 0 && keep > 0 && next === 0) underflow.add(k);
        w.set(name, next);
      }
      if (behind.has(piece.slot)) {
        add(rear, k, [r, g, b], a); w.set(piece.slot, (w.get(piece.slot) ?? 0) + a); surviving.add(k);
      } else {
        rear.alpha[k] *= keep;
        for (let c = 0; c < 3; c++) rear.delta[k * 3 + c] *= keep;
        // Symbolic survival, independent of transparent output-byte rounding.
        if (alpha === 255) surviving.delete(k);
      }
      weights.set(k, w);
    });
    const sample = (k: number, distances: [number, number] | null, counts: boolean): BehindSeamsSample => {
      const [x, y] = centre(grid, k);
      return { ...checkRow('BEHIND_PART_SEAMS.samples', 'pair', false, [pair.a, pair.b]), x, y, rear_rgb: colour(rear, k), rear_weight: rear.alpha[k],
        contributors: row.behind_slots.filter(slot => (weights.get(k)?.get(slot) ?? 0) > 0).map(slot => ({ ...checkRow('BEHIND_PART_SEAMS.contributors', 'pair', false, [pair.a, pair.b]), slot, weight: weights.get(k)!.get(slot)! })), distances, counted: counts };
    };
    const standingHits = new Set<number>(), motionHits = new Set<number>();
    const cap = input.sampleCap ?? BEHIND_SAMPLE_CAP;
    if (measureStanding) {
      let standingUnderflow = false;
      const worstStanding = new WorstStanding(cap);
      for (const [k, corridor] of corridors) {
        if (!surviving.has(k)) continue;
        if (rear.alpha[k] <= 0 || underflow.has(k)) { unread(label, 'positive symbolic rear contribution underflowed its numeric colour weight'); standingUnderflow = true; continue; }
        row.standing.geometric_px++;
        const dp = paintDiff === null ? Infinity : paintDiff(k);
        let chosen: [number, number] | null = null, raw = false, qualifies = false;
        for (const [a, b] of corridor.endpoints) {
          const d: [number, number] = [distance(rear, k, colour(A, a)), distance(rear, k, colour(B, b))];
          const r = d[0] > 0 && d[1] > 0 && dp > 0, q = d[0] > threshold && d[1] > threshold && dp > threshold;
          if (chosen === null || q && !qualifies || r && !raw) chosen = d;
          raw ||= r; qualifies ||= q;
        }
        if (raw) row.standing.raw_px++;
        if (qualifies) standingHits.add(k);
        worstStanding.offer(k, chosen as [number, number], qualifies);
      }
      row.standing.samples = worstStanding.inOrder().map(c => sample(c.k, c.d, c.q));
      if (worstStanding.seen > cap) row.standing.samples_omitted = worstStanding.seen - cap;
      counted(row.standing, standingHits, grid, allowance);
      // Incomplete coverage cannot certify PASS, but cannot hide a measured failure.
      if (support.size === 0 || unreadCorridors.length > 0 || standingUnderflow) {
        if (row.standing.status !== 'FAIL') row.standing.status = 'SKIP';
        if (unreadCorridors.length > 0) unread(label, ambiguousOwnerReason(pair.a, pair.b, unreadCorridors, unreadCells.size, (x, y) => [A.alpha[y * width + x], B.alpha[y * width + x]]));
        else if (support.size === 0) unread(label, 'no A/B boundary support was measured (no overlap, contact or bracketed corridor)');
      }
    }
    for (const k of motionCells.keys()) {
      if (rasters.hidden.data[k * 4 + 3] !== 0 || rasters.full.data[k * 4 + 3] === 0 || !surviving.has(k)) continue;
      // Stock gapCovered already transports the A/B setup-overlap material.
      // setupTop/setupUnder describe the UNTRANSPORTED world centre and must
      // never be used as a rest-visible mask after a common translation.
      const setupAttachments = input.setup?.attachments;
      const setupOrder = setupAttachments?.map(p => p.slot);
      const setupFront = setupOrder === undefined ? -1 : Math.min(setupOrder.indexOf(pair.a), setupOrder.indexOf(pair.b));
      const sameDrawings = [pair.a, pair.b].every(slot => {
        const restDrawing = setupAttachments?.find(a => a.slot === slot), posedDrawing = frame.attachments!.find(a => a.slot === slot);
        return restDrawing !== undefined && restDrawing.attachment === posedDrawing?.attachment && input.setup!.pieces.some(p => p.slot === slot);
      });
      if (!sameDrawings || setupOrder === undefined || setupFront < 0 || row.behind_slots.some(slot => setupOrder.indexOf(slot) < 0 || setupOrder.indexOf(slot) >= setupFront)) {
        motionReadable = false; unread(label, 'stock transported setup-overlap support cannot be bound to the actually drawn setup pair strictly in front of the complete rear set'); continue;
      }
      if (rear.alpha[k] <= 0 || underflow.has(k)) { motionReadable = false; unread(label, 'positive symbolic rear contribution underflowed its numeric colour weight'); continue; }
      motionHits.add(k);
    }
    // Motion-opened rows carry no distance; keep evenly spaced rows, built only for what is kept.
    const hitCells = [...motionHits];
    row.motion_opened.samples = evenlySpaced(hitCells.length, cap).map(i => sample(hitCells[i], null, true));
    if (hitCells.length > cap) row.motion_opened.samples_omitted = hitCells.length - cap;
    row.motion_opened.boundary_cells = motionCells.size;
    row.motion_opened.geometric_px = motionHits.size; row.motion_opened.raw_px = motionHits.size;
    counted(row.motion_opened, motionHits, grid, allowance);
    if (!motionReadable) row.motion_opened.status = 'SKIP';
    if (isIdle) {
      row.standing = {
        ...emptyCount('SKIP'),
        reason: row.motion_opened.status !== 'SKIP' ? IDLE_STANDING_MOTION_READ_REASON : IDLE_STANDING_NO_ORACLE_REASON,
      };
    }
    return { ...row, ...checkRow(family, 'pair', row.standing.status === 'FAIL' || row.motion_opened.status === 'FAIL', [pair.a, pair.b]) };
  } catch (e) { return fail(`official raster/source reading unavailable: ${e instanceof Error ? e.message : String(e)}`); }
}

function reading(frames: readonly BehindSeamsFrame[], kind: 'motion_opened' | 'standing', fps: number, allowance: number, parts: [string, string]): BehindSeamsReading {
  const hits: BehindSeamsHit[] = [];
  let worst: BehindSeamsHit | null = null, spatial = 0, world = 0;
  for (const frame of frames) {
    const r = frame[kind];
    if (frame.grid === null) continue;
    spatial = Math.max(spatial, r.max_spatial_run_cells); world = Math.max(world, r.max_spatial_run_cells * frame.grid.cell);
    if (r.px === 0 || r.box === null) continue;
    const hit: BehindSeamsHit = { ...checkRow('BEHIND_PART_SEAMS.hits', 'pair', r.px > allowance, parts), index: frame.index, time: frame.time, px: r.px, cell: frame.grid.cell, area: r.px * frame.grid.cell ** 2, box: r.box };
    hits.push(hit);
    if (worst === null || hit.px > worst.px) worst = hit;
  }
  const spans: BehindSeamsReading['spans'] = [];
  for (const hit of hits) {
    const prev = spans[spans.length - 1];
    if (prev !== undefined && hit.index === prev.last + 1) { prev.last = hit.index; prev.frames++; prev.seconds = prev.frames / fps; }
    else spans.push({ ...checkRow('BEHIND_PART_SEAMS.spans', 'pair', false, parts), first: hit.index, last: hit.index, frames: 1, seconds: 1 / fps });
  }
  const maxRun = Math.max(0, ...spans.map(s => s.frames));
  return { status: frames.some(f => f[kind].status === 'FAIL') ? 'FAIL' : frames.length === 0 || frames.some(f => f[kind].status === 'SKIP') ? 'SKIP' : 'PASS', frames: hits, hit_frames: hits.length, max_px: worst?.px ?? 0, worst, spans, max_run: { frames: maxRun, seconds: maxRun === 0 ? 0 : maxRun / fps }, max_spatial_run_cells: spatial, max_spatial_run_world: world };
}

/** Pure frame-level entry for generated controls. Production supplies the same
 * official frames and the existing full render's stock cells; no second seamsOf. */
export function measureBehindSeamFrames(api: BehindSeamsApi, input: BehindSeamsFramesInput, declared: BehindSeams, problems: Problem[]): BehindSeamsMeasured {
  const line: BehindSeamsMeasured = { status: 'SKIP', fps: input.fps, pairs: [], unmeasured: [], limitations: LIMITATIONS };
  const cache = new Map<Frame, Map<string, RasterCache>>();
  const selected = new Set(input.pairs.map(p => keyOf(p.a, p.b)));
  const unread = (pair: MotionSeamPair | null, frame: string, reason: string, required: boolean): void => {
    const entry = { ...checkRow('BEHIND_PART_SEAMS.unmeasured', pair === null ? 'rig' : 'pair', required, pair === null ? [] : [pair.a, pair.b]), pair: pair?.pair ?? null, frame, reason: `HOLE: ${reason}` };
    if (line.unmeasured.some(u => u.pair === entry.pair && u.frame === frame && u.reason === entry.reason)) return;
    line.unmeasured.push(entry);
    if (required) problems.push({ code: BEHIND_SEAM_UNMEASURED_CODE, object: `${pair?.pair ?? BEHIND_SEAM_LINE} (${frame})`, detail: `${entry.reason}; a declared required reading cannot pass unmeasured` });
  };
  const start = problems.length;
  const shape = behindSeamsProblems(declared, 'requirements.behind_seams');
  problems.push(...shape);
  if (shape.length > 0) { line.status = 'FAIL'; return line; }
  for (const p of declared.pairs ?? []) if (!selected.has(keyOf(p.part, p.neighbour))) unread(null, 'declaration', `override pair "${p.part}|${p.neighbour}" is not in motionSeamSelection; an override does not create an adjacent pair`, true);
  if (input.pairs.length === 0) unread(null, 'selection', 'no selected motion seam pair; no boundary population was measured', declared.threshold !== undefined);
  const rows = input.pairs.map(pair => {
    const override = declared.pairs?.find(p => keyOf(p.part, p.neighbour) === keyOf(pair.a, pair.b));
    const threshold = override?.threshold ?? declared.threshold ?? null, allowance = override?.allowance ?? declared.allowance ?? 0;
    const stockRows = input.stock?.filter(s => s.pair === pair.pair) ?? [];
    return { pair, threshold, allowance, stock: stockRows.length === 1 ? stockRows[0] : undefined,
      setup: null as BehindSeamsFrame | null, frames: [] as BehindSeamsFrame[] };
  });
  const rate = Number.isFinite(input.fps) && input.fps > 0;
  const cadence = rate && input.idle.every((f, i) => f.index === i && (f.time === i / input.fps || f.time === i * (1 / input.fps)));
  for (const r of rows) {
    if (r.threshold === null) { unread(r.pair, 'declaration', 'no authored threshold T; this pair is SKIP, never a pass', false); continue; }
    if (!rate) unread(r.pair, 'idle', 'frame cadence is unavailable', true);
    if (input.setup === null) unread(r.pair, 'setup', 'actual setup pose is unavailable; idle frame zero is not setup', true);
    if (input.idle.length === 0) unread(r.pair, 'idle', 'no idle frames were read', true);
    else if (!cadence) unread(r.pair, 'idle', 'missing, duplicate or off-cadence idle frame; every frame at the declared fps is required', true);
  }
  // All pairs share a frame's hidden-set cache. Release its native rasters before
  // the next pose: memory grows with one frame, not animation length.
  const observe = (frame: Frame, setup: boolean): void => {
    for (const r of rows) if (r.threshold !== null) {
      const note = (where: string, reason: string): void => unread(r.pair, where, reason, true);
      const value = readBehindFrame(api, input, r.pair, frame, setup, r.stock, r.threshold, r.allowance, note, cache);
      if (setup) r.setup = value;
      else r.frames.push(value);
    }
    cache.clear();
  };
  if (rate && input.setup !== null) observe(input.setup, true);
  if (cadence) for (const frame of input.idle) observe(frame, false);
  for (const r of rows) {
    const { pair, threshold, allowance, setup, frames } = r;
    const parts: [string, string] = [pair.a, pair.b];
    const motion = reading(frames, 'motion_opened', input.fps, allowance, parts);
    if ((setup === null || setup.motion_opened.status === 'SKIP') && motion.status !== 'FAIL') motion.status = 'SKIP';
    const idleStandingReason = motion.status !== 'SKIP' ? IDLE_STANDING_MOTION_READ_REASON : IDLE_STANDING_NO_ORACLE_REASON;
    for (const f of frames) f.standing.reason = idleStandingReason;
    const standing: BehindSeamsReading = { ...reading(frames, 'standing', input.fps, allowance, parts), status: 'SKIP', reason: idleStandingReason };
    if (motion.max_px > allowance) {
      problems.push({ code: BEHIND_SEAM_CODE, object: `pair "${pair.pair}" motion_opened`, detail: `idle frame ${motion.worst?.index} (${motion.max_px} cells) exceeds allowance ${allowance}; authored threshold ${threshold}, native seam cells, no one-cell floor or rest mask` });
    }
    if ((setup?.standing.px ?? 0) > allowance) {
      problems.push({ code: BEHIND_SEAM_CODE, object: `pair "${pair.pair}" setup standing`, detail: `setup (${setup!.standing.px} cells) exceeds allowance ${allowance}; authored threshold ${threshold}, native seam cells, no one-cell floor or rest mask` });
    }
    const failed = motion.status === 'FAIL' || setup?.standing.status === 'FAIL' || line.unmeasured.some(u => u.pair === pair.pair && threshold !== null);
    const readFrames = frames.filter(f => f.motion_opened.status !== 'SKIP' &&
      !line.unmeasured.some(u => u.pair === pair.pair && u.frame === `idle frame ${f.index}`)).length;
    line.pairs.push({ ...checkRow('BEHIND_PART_SEAMS.pairs', 'pair', failed, parts), animation: 'idle', pair: pair.pair, parts, declared: [...pair.declared], threshold, allowance, setup, frames, motion_opened: motion, standing,
      sampled_frames: input.idle.length, read_frames: readFrames, unmeasured_frames: input.idle.length - readFrames });
  }
  line.status = problems.length > start ? 'FAIL' : line.pairs.length === 0 || line.pairs.some(p => p.threshold === null || p.setup === null || p.setup.standing.status === 'SKIP' || p.motion_opened.status === 'SKIP') ? 'SKIP' : 'PASS';
  if (declared.turn === true) {
    line.turn = measureBehindTurnFrames(api, input, declared, problems);
    if (line.turn.status === 'FAIL' || problems.length > start) line.status = 'FAIL';
    else if (line.turn.status === 'SKIP' && line.status !== 'FAIL') line.status = 'SKIP';
  }
  return line;
}

/** Turn observations are independent t=0 reset samples, never temporal spans. */
function measureBehindTurnFrames(api: BehindSeamsApi, input: BehindSeamsFramesInput, declared: BehindSeams, problems: Problem[]): BehindSeamsTurnMeasured {
  const turn = input.turn;
  const result: BehindSeamsTurnMeasured = { status: 'SKIP', poses: turn?.poses.map(p => p.name) ?? [], pairs: [], unmeasured: [],
    limitations: 'independent setup-reset turn endpoints and full range corners only; no sweep, idle motion, temporal spans or alternate skins; standing and transported setup-overlap are separate' };
  if (turn?.poser !== undefined) result.limitations += `; poser ${turn.poser}`;
  if (turn?.sourceSkeletonSha256 !== undefined) result.limitations += `; original skeleton sha256 ${turn.sourceSkeletonSha256}`;
  const required = declared.threshold !== undefined || declared.pairs?.some(p => p.threshold !== undefined) === true;
  let mandatoryUnread = false;
  const unread = (pair: MotionSeamPair | null, frame: string, reason: string, mandatory: boolean): void => {
    result.unmeasured.push({ ...checkRow('BEHIND_PART_SEAMS.turn.unmeasured', pair === null ? 'rig' : 'pair', mandatory, pair === null ? [] : [pair.a, pair.b]), pair: pair?.pair ?? null, frame, reason: `HOLE: ${reason}` });
    if (mandatory) mandatoryUnread = true;
    if (mandatory) problems.push({ code: BEHIND_SEAM_UNMEASURED_CODE, object: `${pair?.pair ?? BEHIND_SEAM_LINE} (${frame})`, detail: `HOLE: ${reason}; required turn reading cannot pass unmeasured` });
  };
  if (turn === undefined || turn.poses.length === 0) {
    unread(null, 'turn', turn?.reason ?? 'no declared finite turn dial range; turn is SKIP, never a pass', required);
    result.pairs = input.pairs.map(pair => {
      const override = declared.pairs?.find(p => keyOf(p.part, p.neighbour) === keyOf(pair.a, pair.b));
      return { ...checkRow('BEHIND_PART_SEAMS.turn.pairs', 'pair', required, [pair.a, pair.b]), pair: pair.pair, parts: [pair.a, pair.b],
        threshold: override?.threshold ?? declared.threshold ?? null, allowance: override?.allowance ?? declared.allowance ?? 0,
        frames: [], sampled_poses: 0, read_poses: 0, unmeasured_poses: 0,
        motion_opened: { status: 'SKIP', max_px: 0 }, standing: { status: 'SKIP', max_px: 0 } };
    });
    return result;
  }
  if (turn.reason !== undefined) unread(null, 'turn', turn.reason, required);
  const complete = turn.frames.length === turn.poses.length && new Set(turn.poses.map(p => p.name)).size === turn.poses.length;
  if (!complete) unread(null, 'turn', 'missing or duplicate named turn sample; every preselected endpoint and corner is required', required);
  const frames = turn.frames.filter((f): f is Frame => f !== null);
  const posedInput: BehindSeamsFramesInput = { ...input, setup: turn.setup, idle: frames, rest: turn.rest, stock: turn.stock };
  const cache = new Map<Frame, Map<string, RasterCache>>();
  for (const pair of input.pairs) {
    const override = declared.pairs?.find(p => keyOf(p.part, p.neighbour) === keyOf(pair.a, pair.b));
    const threshold = override?.threshold ?? declared.threshold ?? null, allowance = override?.allowance ?? declared.allowance ?? 0;
    const parts: [string, string] = [pair.a, pair.b];
    const stockRows = turn.stock?.filter(s => s.pair === pair.pair) ?? [];
    const rows: BehindSeamsFrame[] = [];
    if (threshold === null) unread(pair, 'turn declaration', 'no authored threshold T; turn pair is SKIP, never a pass', false);
    else {
      if (turn.setup === null) unread(pair, 'turn setup', 'actual turn setup pose is unavailable', true);
      for (const [index, pose] of turn.poses.entries()) {
        const frame = turn.frames[index];
        if (frame === undefined || frame === null || frame.index !== index || frame.time !== 0) {
          unread(pair, `turn ${pose.name}`, 'preselected turn pose is missing or has the wrong identity; it cannot become zero cells', true);
          continue;
        }
        const row = readBehindFrame(api, posedInput, pair, frame, false, stockRows.length === 1 ? stockRows[0] : undefined,
          threshold, allowance, (where, why) => unread(pair, where, why, true), cache, pose);
        rows.push(row); cache.clear();
        for (const kind of ['motion_opened', 'standing'] as const) if (row[kind].status === 'FAIL') problems.push({ code: BEHIND_SEAM_CODE,
          object: `pair "${pair.pair}" turn ${pose.name} ${kind}`, detail: `${row[kind].px} native seam cells exceeds allowance ${allowance}; authored threshold ${threshold}; independent declared turn pose` });
      }
    }
    const read = rows.filter(row => row.motion_opened.status !== 'SKIP' && row.standing.status !== 'SKIP' &&
      !result.unmeasured.some(u => u.pair === pair.pair && u.frame === `turn ${row.pose}`)).length;
    const aggregate = (kind: 'motion_opened' | 'standing'): BehindSeamsTurnPair['standing'] => ({
      status: rows.some(r => r[kind].status === 'FAIL') ? 'FAIL' : complete && rows.length === turn.poses.length && rows.every(r => r[kind].status === 'PASS') ? 'PASS' : 'SKIP',
      max_px: Math.max(0, ...rows.map(r => r[kind].px)),
    });
    const motion = aggregate('motion_opened'), standing = aggregate('standing');
    result.pairs.push({ ...checkRow('BEHIND_PART_SEAMS.turn.pairs', 'pair', motion.status === 'FAIL' || standing.status === 'FAIL' || threshold !== null && read !== turn.poses.length, parts),
      pair: pair.pair, parts, threshold, allowance, frames: rows, sampled_poses: turn.poses.length, read_poses: read, unmeasured_poses: turn.poses.length - read,
      motion_opened: motion, standing });
  }
  if (input.pairs.length === 0) unread(null, 'turn selection', 'no selected seam pair; turn boundary population is unavailable', required);
  result.status = result.pairs.some(p => p.motion_opened.status === 'FAIL' || p.standing.status === 'FAIL') || mandatoryUnread ? 'FAIL'
    : result.pairs.length === 0 || result.pairs.some(p => p.motion_opened.status === 'SKIP' || p.standing.status === 'SKIP') ? 'SKIP' : 'PASS';
  return result;
}

interface BehindTurnDial { bone: string; field: 'rotation' | 'x' | 'y'; min: number; max: number; setup: number }
/** Read emitted declarations, not config defaults, dial-name guesses or animation times. */
export function behindTurnPlan(rig: Record<string, unknown>): { dials: BehindTurnDial[]; poses: BehindSeamsTurnPose[]; reason?: string } {
  const bones = (Array.isArray(rig.bones) ? rig.bones : []).filter(record);
  const sliders = (Array.isArray(rig.constraints) ? rig.constraints : []).filter(record).filter(c => c.type === 'slider' &&
    ([YAW_DIAL_BONE, PITCH_DIAL_BONE, BODY_YAW_DIAL_BONE, TURN_BONE].includes(String(c.bone)) || ['turn', 'tilt', BODY_TURN_ANIM].includes(String(c.animation))));
  const dials: BehindTurnDial[] = [];
  for (const c of sliders) {
    const matched = bones.filter(b => b.name === c.bone), field = c.property === 'rotate' ? 'rotation' : c.property === 'x' ? 'x' : c.property === 'y' ? 'y' : null;
    if (typeof c.bone !== 'string' || matched.length !== 1 || field === null || c.local !== true ||
      typeof c.from !== 'number' || !Number.isFinite(c.from) || typeof c.max !== 'number' || !Number.isFinite(c.max) || c.from >= c.max || dials.some(d => d.bone === c.bone)) {
      return { dials: [], poses: [], reason: `turn slider "${String(c.name)}" has no unique local dial with finite increasing from/max range; no range is invented` };
    }
    const setup = matched[0][field] ?? 0;
    if (typeof setup !== 'number' || !Number.isFinite(setup) || setup < c.from || setup > c.max) return { dials: [], poses: [], reason: `turn dial "${c.bone}" has no finite in-range setup value` };
    dials.push({ bone: c.bone, field, min: c.from, max: c.max, setup });
  }
  if (bones.some(b => b.name === TURN_BONE) && !dials.some(d => d.bone === TURN_BONE)) return { dials: [], poses: [], reason: `legacy dial "${TURN_BONE}" has no declared finite range; no x range is invented` };
  if (dials.length === 0) return { dials, poses: [], reason: 'no declared turn dial; turn is SKIP, never a pass' };
  const poses: BehindSeamsTurnPose[] = [], seen = new Set<string>();
  const add = (values: Record<string, number>): void => {
    const key = JSON.stringify(values);
    if (!seen.has(key)) { seen.add(key); poses.push({ name: dials.map(d => `${d.bone}=${values[d.bone]}`).join(','), values }); }
  };
  const setup = Object.fromEntries(dials.map(d => [d.bone, d.setup]));
  for (const dial of dials) for (const value of [dial.min, dial.max]) add({ ...setup, [dial.bone]: value });
  const corners = (index: number, values: Record<string, number>): void => {
    if (index === dials.length) { add(values); return; }
    const dial = dials[index];
    for (const value of [dial.min, dial.max]) corners(index + 1, { ...values, [dial.bone]: value });
  };
  corners(0, {});
  return { dials, poses };
}

/** One gated copy can carry every selected pose. Motion keys are offsets from
 * setup, so convert planned absolute locals to the public timeline schema. */
export function behindTurnAnimations(rig: Record<string, unknown>): Record<string, { duration: number; tracks: Array<{ bone: string; property: string; keys: Array<{ t: number; v: number[] }> }> }> {
  const plan = behindTurnPlan(rig);
  return Object.fromEntries(plan.poses.map(pose => [behindTurnAnimationName(pose.name), {
    duration: 0,
    tracks: plan.dials.map(d => ({ bone: d.bone, property: d.field === 'rotation' ? 'rotate' : d.field === 'x' ? 'translatex' : 'translatey',
      keys: [{ t: 0, v: [pose.values[d.bone] - d.setup] }] })),
  }]));
}
/** Injective safe encoding of the pose name, including every UTF-16 code unit;
 * no index, truncation or per-pose digest can hide a sample identity. */
export function behindTurnAnimationName(name: string): string {
  return `_behind_seams_turn_${name.split('').map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('')}`;
}

/** Read the throwaway gated copy through the same public facade as idle.
 * No skeleton, model, setup or poser implementation is changed here. */
function sampleBehindTurn(api: typeof import('@rig-c/core/render-shared'), input: BehindSeamsInput,
  accepted: ReturnType<typeof api.loadCandidate>, acceptedSetup: Frame | null, acceptedPoser: string): BehindSeamsTurnInput {
  const plan = behindTurnPlan(input.rig);
  const empty: BehindSeamsTurnInput = { poses: plan.poses, frames: [], setup: null, rest: [], stock: null };
  if (plan.reason !== undefined) return { ...empty, reason: plan.reason };
  try {
    empty.sourceSkeletonSha256 = createHash('sha256').update(readFileSync(join(input.build, 'skeleton.json'))).digest('hex');
    if (input.turnBuild?.reason !== undefined) throw new Error(input.turnBuild.reason);
    const build = input.turnBuild?.build;
    if (build === undefined) throw new Error('gated turn animation copy is unavailable');
    const skeleton = join(build, 'skeleton.json'), atlas = join(build, 'skeleton.atlas');
    const atlasText = readFileSync(atlas, 'utf8');
    if (atlasText !== readFileSync(join(input.build, 'skeleton.atlas'), 'utf8')) throw new Error('turn copy atlas text differs from accepted build');
    const candidate = api.loadCandidate({ skeletonText: readFileSync(skeleton, 'utf8'), atlasText, atlasDir: build, label: 'behind seams turn samples' }, { skeleton, atlas }, undefined);
    if (candidate.pages.size !== accepted.pages.size || [...accepted.pages].some(([name, page]) => {
      const other = candidate.pages.get(name);
      return other === undefined || other.width !== page.width || other.height !== page.height || !Buffer.from(other.data).equals(Buffer.from(page.data));
    })) throw new Error('turn copy decoded atlas pages differ from accepted build');
    const observed = api.throughPoser(candidate.choice, poser => {
      const opts = { geometry: true, texture: true };
      const setup = api.sampleSetupPose(poser, opts)[0] ?? null;
      if (setup === null || JSON.stringify(setup) !== JSON.stringify(acceptedSetup)) throw new Error('turn copy setup geometry differs from accepted build');
      const poses: BehindSeamsTurnPose[] = [];
      const frames = plan.poses.map((pose, index) => {
        const name = behindTurnAnimationName(pose.name);
        const samples = api.sampleAnimation(poser, name, input.fps, { ...opts, channels: true });
        if (samples.length !== 1 || samples[0].time !== 0) throw new Error(`turn ${pose.name}: animation "${name}" does not supply exactly one t=0 sample`);
        const frame = samples[0];
        if (frame.channelError !== undefined || frame.channels === undefined) throw new Error(`turn ${pose.name}: dial channels unavailable`);
        const observed_values: Record<string, number> = {}, slider_times: Record<string, number> = {};
        for (const dial of plan.dials) {
          const property = dial.field === 'rotation' ? 'rotate' : `translate.${dial.field}`;
          const local = frame.channels.filter(c => JSON.stringify(c.path) === JSON.stringify(['bone', dial.bone, property]));
          const want = pose.values[dial.bone];
          // The compiler stores float32 keys; compare at that declared precision.
          if (local.length !== 1 || !Number.isFinite(local[0].value) || Math.fround(local[0].value) !== Math.fround(want)) throw new Error(`turn ${pose.name}: dial "${dial.bone}" did not reach planned local ${want}`);
          observed_values[dial.bone] = local[0].value;
          const slider = (Array.isArray(input.rig.constraints) ? input.rig.constraints : []).filter(record).find(c => c.type === 'slider' && c.bone === dial.bone);
          const times = frame.channels.filter(c => JSON.stringify(c.path) === JSON.stringify(['slider', slider?.name, 'mapped-time']));
          if (times.length !== 1 || !Number.isFinite(times[0].value)) throw new Error(`turn ${pose.name}: slider on "${dial.bone}" has no finite mapped-time observation`);
          slider_times[String(slider!.name)] = times[0].value;
        }
        poses.push({ ...pose, observed_values, slider_times });
        return { ...frame, index, time: 0 };
      });
      const rest = poser.rest(undefined, [setup.attachments ?? [], ...frames.map(f => f.attachments ?? [])]);
      return { poses, frames, setup, rest };
    });
    if (observed.poser !== acceptedPoser) throw new Error(`turn copy poser "${observed.poser}" differs from accepted "${acceptedPoser}"`);
    const { poses, frames, setup, rest } = observed.value;
    const sources = sourceProblems(input.rig, [setup, ...frames]);
    if (sources.length > 0) throw new Error(sources.join('; '));
    const pairs = input.pairs.filter(p => p.unread === undefined);
    const stock = seamsOf(pairs, rest, frames.map(f => ({ ...f, attachments: f.attachments ?? [] })), candidate.pages, {},
      { cells: setupCellReader(() => setup.pieces, candidate.pages) }).map((read, i) => ({ pair: pairs[i].pair,
        frames: frames.length, drawn: read.drawn, banded: read.banded,
        gapCovered: read.gapCovered.frames.map(hit => ({ index: hit.index, time: hit.time, cell: hit.cell, cells: hit.cells ?? [] })) }));
    return { poses, frames, setup, rest, stock, sourceSkeletonSha256: empty.sourceSkeletonSha256, poser: observed.poser };
  } catch (e) { return { ...empty, reason: `official turn copy unread: ${e instanceof Error ? e.message : String(e)}` }; }
}

function jsonAt(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!record(value)) throw new Error('required sidecar is not an object');
  return value;
}

/** Consume the existing render, including zero-hit pairs. Shape, pose, cadence,
 * world and cell detail are checked before an absent hit can mean zero. */
function stockOf(dir: string, pairs: readonly MotionSeamPair[], fps: number, setup: Frame, idle: readonly Frame[], rest: readonly AttachmentRest[]): BehindSeamsStockPair[] {
  const sidecar = jsonAt(join(dir, 'frames.json'));
  if (sidecar.spec !== 'rigc-frames/1' || ['skin', 'slots', 'hidden', 'environment', 'preroll', 'physicsMode'].some(k => sidecar[k] !== undefined)) throw new Error('stock full render has an unavailable specification, skin, slot subset, environment, preroll or physics mode');
  const sets = Array.isArray(sidecar.sets) ? sidecar.sets.filter(record).filter(s => s.animation === 'idle') : [];
  if (sets.length !== 1) throw new Error('stock full render requires exactly one idle frame set');
  const set = sets[0];
  if (set.fps !== fps || set.stride !== 1 || set.sampled !== idle.length || set.written !== idle.length || idle.length === 0 || typeof set.dir !== 'string' || isAbsolute(set.dir)) throw new Error('stock idle must have every sampled frame written, stride 1, at the same fps as the official sampled poses');
  const home = resolve(dir, set.dir), rel = relative(resolve(dir), home);
  if (isAbsolute(rel) || /^\.\.(?:[\\/]|$)/.test(rel)) throw new Error('stock idle directory leaves its full-render root');
  const geometry = jsonAt(join(home, 'geometry.json'));
  if (geometry.spec !== 'rigc-geometry/1' || geometry.animation !== 'idle' || geometry.fps !== fps || ['skin', 'environment', 'preroll', 'physicsMode'].some(k => geometry[k] !== undefined) || !record(geometry.setup) || !Array.isArray(geometry.frames)) throw new Error('stock whole attachment geometry is unavailable or belongs to a different pose/world');
  const posed = geometry.frames;
  const different = idle.some((f, i) => { const p: unknown = posed[i]; return !record(p) || p.index !== f.index || p.time !== f.time || JSON.stringify(p.attachments) !== JSON.stringify(f.attachments); });
  if (posed.length !== idle.length || JSON.stringify(geometry.setup.attachments) !== JSON.stringify(setup.attachments) || JSON.stringify(geometry.rest) !== JSON.stringify(rest) || different) throw new Error('official setup/rest/idle geometry or draw order differs from the existing full stock seam render');
  const file = jsonAt(join(home, 'seam.json'));
  if (file.spec !== 'rigc-seam/1' || file.animation !== 'idle' || file.fps !== fps || file.skin !== undefined || !Array.isArray(file.pairs) || file.pairs.length !== pairs.length) throw new Error('stock seam pair order, animation, skin or fps is unavailable');
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  return pairs.map((want, i) => {
    const p: unknown = (file.pairs as unknown[])[i];
    if (!record(p) || p.a !== want.a || p.b !== want.b || !Number.isSafeInteger(p.drawn) || !Number.isSafeInteger(p.banded) || typeof p.drawn !== 'number' || typeof p.banded !== 'number' || p.banded < 0 || p.drawn < p.banded || p.drawn > idle.length || p.status !== (p.banded > 0 ? 'read' : 'skip') || !record(p.gapCovered) || !Array.isArray(p.gapCovered.frames)) throw new Error(`stock pair "${want.pair}" has unavailable drawn/banded/gapCovered evidence`);
    const seen = new Set<number>();
    const gapCovered = p.gapCovered.frames.map((hit: unknown) => {
      if (!record(hit) || !Number.isSafeInteger(hit.index) || typeof hit.index !== 'number' || hit.index < 0 || hit.index >= idle.length || seen.has(hit.index) || !finite(hit.time) || hit.time !== idle[hit.index].time || !finite(hit.cell) || hit.cell <= 0 || !Number.isSafeInteger(hit.px) || typeof hit.px !== 'number' || hit.px <= 0 || !Array.isArray(hit.cells) || hit.cells.length !== hit.px || !Array.isArray(hit.box) || hit.box.length !== 4 || !hit.box.every(finite)) throw new Error(`stock pair "${want.pair}" requires unique complete gapCovered hits and --seam-cells detail`);
      seen.add(hit.index);
      const cells: SeamCell[] = hit.cells.map((c: unknown) => {
        if (!record(c) || !finite(c.x) || !finite(c.y) || !(c.setupTop === null || typeof c.setupTop === 'string' && c.setupTop.length > 0) || !(c.setupUnder === null || typeof c.setupUnder === 'string' && c.setupUnder.length > 0) || c.setupTop === null && c.setupUnder !== null || c.setupTop !== null && c.setupTop === c.setupUnder) throw new Error(`stock pair "${want.pair}" has unread world cell/setup attribution`);
        return { x: c.x, y: c.y, setupTop: c.setupTop, setupUnder: c.setupUnder };
      });
      return { index: hit.index, time: hit.time, cell: hit.cell, cells };
    });
    return { pair: want.pair, frames: idle.length, drawn: p.drawn, banded: p.banded, gapCovered };
  });
}

function sourceProblems(rig: Record<string, unknown>, frames: readonly Frame[]): string[] {
  const slots = (Array.isArray(rig.slots) ? rig.slots : []).filter(record);
  const reasons = new Set<string>();
  const seen = new Set<string>();
  for (const frame of frames) for (const piece of frame.pieces) {
    const matches = slots.filter(s => s.name === piece.slot);
    if (matches.length !== 1) { reasons.add(`slot "${piece.slot}" has no unique rig source/order declaration`); continue; }
    if (matches[0].blend !== undefined && matches[0].blend !== 'normal') { reasons.add(`slot "${piece.slot}" uses unsupported blend ${JSON.stringify(matches[0].blend)}; source-over contribution is unmeasured`); continue; }
    const attached = frame.attachments?.filter(a => a.slot === piece.slot) ?? [];
    if (attached.length !== 1 || piece.texture === undefined || piece.texture.artUvs.length !== piece.uvs.length) { reasons.add(`slot "${piece.slot}" has unavailable whole attachment/art-UV source evidence`); continue; }
    const key = JSON.stringify([piece.slot, attached[0].attachment]);
    if (seen.has(key)) continue;
    seen.add(key);
    try { seamSourceAttachment(rig, piece.slot, attached[0].attachment); }
    catch (e) { reasons.add(`slot "${piece.slot}" attachment "${attached[0].attachment}" source unread: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return [...reasons];
}

/** Production reader. It neither builds nor emits files, and never substitutes
 * its own seam algorithm for the full stock gapCovered result. */
export function measureBehindSeams(api: typeof import('@rig-c/core/render-shared'), input: BehindSeamsInput, declared: BehindSeams, problems: Problem[]): BehindSeamsMeasured {
  const empty: BehindSeamsFramesInput = { pairs: input.pairs, setup: null, idle: [], rest: [], pages: new Map(), stock: null, fps: input.fps };
  const active = declared.threshold !== undefined || declared.pairs?.some(p => p.threshold !== undefined) === true;
  if (!active) {
    if (declared.turn === true) {
      const plan = behindTurnPlan(input.rig);
      empty.turn = { poses: plan.poses, frames: [], setup: null, rest: [], stock: null,
        reason: plan.reason ?? 'no authored threshold T; turn samples are not measured, never a pass' };
    }
    return measureBehindSeamFrames(api, empty, declared, problems);
  }
  const fail = (reason: string): BehindSeamsMeasured => {
    const line = measureBehindSeamFrames(api, empty, declared, problems);
    line.status = 'FAIL';
    line.unmeasured.push({ ...checkRow('BEHIND_PART_SEAMS.unmeasured', 'rig', true, []), pair: null, frame: 'render/source', reason: `HOLE: ${reason}` });
    problems.push({ code: BEHIND_SEAM_UNMEASURED_CODE, object: BEHIND_SEAM_LINE, detail: `HOLE: ${reason}; required setup and idle cannot pass unmeasured` });
    return line;
  };
  if (input.unsupported !== undefined) return fail(input.unsupported);
  let candidate: ReturnType<typeof api.loadCandidate>;
  let sampled: { setup: Frame | null; idle: Frame[]; rest: AttachmentRest[] };
  let acceptedPoser: string;
  try {
    const skeleton = join(input.build, 'skeleton.json'), atlas = join(input.build, 'skeleton.atlas');
    candidate = api.loadCandidate({ skeletonText: readFileSync(skeleton, 'utf8'), atlasText: readFileSync(atlas, 'utf8'), atlasDir: input.build, label: 'behind-part seams' }, { skeleton, atlas }, undefined);
    const observed = api.throughPoser(candidate.choice, p => {
      const opts = { geometry: true, texture: true };
      const setup = api.sampleSetupPose(p, opts)[0] ?? null;
      const idle = p.animations.some(a => a.name === 'idle') ? api.sampleAnimation(p, 'idle', input.fps, opts) : [];
      const rest = p.rest(undefined, [...(setup?.attachments === undefined ? [] : [setup.attachments]), ...idle.map(f => f.attachments ?? [])]);
      return { setup, idle, rest };
    });
    sampled = observed.value;
    acceptedPoser = observed.poser;
    const sources = sourceProblems(input.rig, [...(sampled.setup === null ? [] : [sampled.setup]), ...sampled.idle]);
    if (sources.length > 0) return fail(sources.join('; '));
  } catch (e) { return fail(`official renderer/source unavailable: ${e instanceof Error ? e.message : String(e)}`); }
  let stock: BehindSeamsStockPair[] | null = null, stockError: string | null = null;
  try {
    if (input.stockDir === null || sampled.setup === null) throw new Error('existing full stock seam render/setup is unavailable');
    stock = stockOf(input.stockDir, input.pairs.filter(p => p.unread === undefined), input.fps, sampled.setup, sampled.idle, sampled.rest);
  } catch (e) { stockError = e instanceof Error ? e.message : String(e); }
  let painting: Frame | null = null;
  let paintingPages: ReadonlyMap<string, Plate> | undefined;
  if (input.painting !== undefined && input.painting !== null) {
    const { stage, raster } = input.painting;
    const page = new Plate(raster.width, raster.height);
    page.data.set(raster.data);
    const pageName = 'behind-seams:painting';
    paintingPages = new Map([[pageName, page]]);
    const wx0 = stage.x, wx1 = stage.x + stage.width, wy0 = stage.y, wy1 = stage.y + stage.height;
    painting = { index: 0, time: 0, pieces: [{ kind: 'region', slot: 'painting', page: pageName, tint: [1, 1, 1, 1],
      world: [wx1, wy1, wx0, wy1, wx0, wy0, wx1, wy0], uvs: [1, 0, 0, 0, 0, 1, 1, 1] }] };
  }
  const line = measureBehindSeamFrames(api, { ...sampled, pairs: input.pairs, pages: candidate.pages, stock, fps: input.fps,
    painting, ...(paintingPages === undefined ? {} : { paintingPages }),
    ...(declared.turn === true ? { turn: sampleBehindTurn(api, input, candidate, sampled.setup, acceptedPoser) } : {}) }, declared, problems);
  if (stockError !== null) {
    line.status = 'FAIL';
    line.unmeasured.push({ ...checkRow('BEHIND_PART_SEAMS.unmeasured', 'rig', true, []), pair: null, frame: 'stock render', reason: `HOLE: ${stockError}` });
    problems.push({ code: BEHIND_SEAM_UNMEASURED_CODE, object: 'stock full seam render', detail: `HOLE: ${stockError}; unavailable stock coverage cannot become zero motion-opened cells` });
  }
  return line;
}

/** Null has no JSON/tally effect, but its console declaration is always honest. */
export function behindSeamLines(line: BehindSeamsMeasured | null): string[] {
  if (line === null) return [`${BEHIND_SEAM_LINE}: SKIP — ${UNDECLARED_BEHIND_SEAM_REASON}`];
  return [
    `${BEHIND_SEAM_LINE}: ${line.status} — ${line.pairs.length} selected pair(s), setup separately and every idle frame at ${line.fps} fps; ${line.limitations}`,
    ...line.pairs.flatMap(p => {
      const setup = p.setup;
      const summary = (kind: 'motion_opened' | 'standing'): string => {
        const r = p[kind], w = r.worst;
        if (r.reason !== undefined) {
          return `${BEHIND_SEAM_LINE}: pair "${p.pair}" ${kind} ${r.status} — ${r.reason}; threshold ${p.threshold === null ? 'undeclared' : p.threshold}, allowance ${p.allowance}`;
        }
        return `${BEHIND_SEAM_LINE}: pair "${p.pair}" ${kind} ${r.status} — ${r.hit_frames}/${p.frames.length} idle hit frames, sampled/read/unmeasured ${p.sampled_frames ?? p.frames.length}/${p.read_frames ?? 0}/${p.unmeasured_frames ?? 0}, max_px ${r.max_px}, max_run ${r.max_run.frames} frames (${r.max_run.seconds} s), max_spatial_run_cells ${r.max_spatial_run_cells} (${r.max_spatial_run_world} world units), earliest worst ${w === null ? 'none' : `frame ${w.index} t ${w.time}, cell ${w.cell}, box [${w.box.join(', ')}]`}; threshold ${p.threshold === null ? 'undeclared' : p.threshold}, allowance ${p.allowance}`;
      };
      const setupStanding = setup === null ? '' : setup.standing.reason !== undefined ? `${setup.standing.status} (${setup.standing.reason}), ${setup.standing.px} cells` : setup.standing.px > 0 && setup.standing.status === 'SKIP' ? `${setup.standing.px} cells` : `${setup.standing.status}, ${setup.standing.px} cells`;
      return [summary('motion_opened'), summary('standing'), `${BEHIND_SEAM_LINE}: pair "${p.pair}" setup ${setup === null ? 'SKIP — HOLE: setup not read' : `standing ${setupStanding}; motion_opened ${setup.motion_opened.status}, ${setup.motion_opened.px} cells; behind [${setup.behind_slots.join(', ')}]`}`];
    }),
    ...(line.turn === undefined ? [] : [
      `${BEHIND_SEAM_LINE}: turn ${line.turn.status} — ${line.turn.poses.length} preselected endpoint/corner pose(s); ${line.turn.limitations}`,
      ...line.turn.pairs.flatMap(p => p.frames.map(f => `${BEHIND_SEAM_LINE}: pair "${p.pair}" turn ${f.pose} — motion_opened ${f.motion_opened.status}, ${f.motion_opened.px} cells; standing ${f.standing.status}, ${f.standing.px} cells; threshold ${p.threshold}, allowance ${p.allowance}`)),
      ...line.turn.unmeasured.map(u => `${BEHIND_SEAM_LINE}: ${u.pair === null ? 'rig' : `pair "${u.pair}"`} ${u.frame} SKIP — ${u.reason}`),
    ]),
    ...line.unmeasured.map(u => {
      const target = u.pair === null ? 'rig' : `pair "${u.pair}"`;
      const pair = u.pair === null ? undefined : line.pairs.find(p => p.pair === u.pair);
      const frame = pair === undefined ? undefined : u.frame === 'setup' ? pair.setup ?? undefined : pair.frames.find(f => `idle frame ${f.index}` === u.frame);
      const corridors = frame?.standing.unread_corridors;
      if (frame !== undefined && frame.standing.px > 0 && corridors !== undefined && corridors.length > 0 && u.reason.includes('unread corridors')) {
        const status = frame.standing.status === 'FAIL' ? `FAIL, ${frame.standing.px} cells` : `${frame.standing.px} cells`;
        return `${BEHIND_SEAM_LINE}: ${target} ${u.frame} standing ${status} — unread corridors: ${corridors.length} (cells ${frame.standing.unread_cells ?? 0}); ${u.reason}`;
      }
      return `${BEHIND_SEAM_LINE}: ${target} ${u.frame} SKIP — ${u.reason}`;
    }),
  ];
}
