/** #1314: analytic block fixtures; all sampling belongs to core's rasterizer. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Plate, type RGBA } from '@rig-c/core/plate';
import { pageFor, projector, rasterisePiece, renderFrame, type AttachmentRest, type Frame, type Piece } from '@rig-c/core/render-shared';
import { seamGridOf, seamsOf, setupCellReader, type SeamFrame, type SeamGrid, type SeamPair } from '@rig-c/core/seam';
import { BEHIND_SEAM_LINE, BEHIND_SEAM_CODE, BEHIND_SEAM_UNMEASURED_CODE, behindSeamsProblems,
  measureBehindSeamFrames, behindSeamLines, type BehindSeams, type BehindSeamsFramesInput,
  type BehindSeamsStockPair, type BehindSeamsCount, type BehindSeamsMeasured, type BehindSeamsFrame } from '../src/behindseams.ts';
import { type RigcRunner } from '../src/check.ts';
import { PartsError, type Problem } from '../src/errors.ts';
import { readRequirements } from '../src/requirements.ts';
import { checkStage } from '../src/build.ts';
import { CHECK_PARTS, writeCheckRig } from '../fixtures/checkrig.ts';
import { cropToSpineY } from '../src/coords.ts';
import { CHECK_ROW_FAMILY } from '../src/checkrow.ts';
import { readParts, serializeParts } from '../src/parts.ts';
import { writePng } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
type RGB = [number, number, number];
const FRONT: RGB = [24, 48, 72];
const REAR: RGB = [224, 232, 240];

/** Explicit poses, not an animation implementation or a substitute renderer. */
export interface BehindSeamFixture {
  pair: SeamPair;
  pages: Map<string, Plate>;
  rest: AttachmentRest[];
  setup: SeamFrame;
  frames: SeamFrame[];
}

function rectangle(slot: string, x: number, y: number, width: number, height: number): Piece {
  return { kind: 'region', slot, page: slot, tint: [1, 1, 1, 1],
    world: [x, y, x, y + height, x + width, y + height, x + width, y],
    uvs: [0, 1, 0, 0, 1, 0, 1, 1] };
}

function plate(width: number, height: number, rgb: RGB, alpha = 255): Plate {
  const page = new Plate(width, height);
  page.rect(0, 0, width, height, [...rgb, alpha]);
  return page;
}

function shifted(piece: Piece, x: number, y: number): Piece {
  return { ...piece, world: piece.world.map((value, index) => value + (index % 2 === 0 ? x : y)) };
}

function frame(pieces: Piece[], index: number): SeamFrame {
  return { index, time: index / 12, pieces, attachments: pieces.map(piece => ({
    slot: piece.slot, attachment: piece.slot, vertices: [...piece.world], color: piece.tint,
  })) };
}

function fixture(pages: Map<string, Plate>, setup: Piece[], poses: Piece[][]): BehindSeamFixture {
  return { pair: { a: 'a', b: 'b' }, pages,
    rest: setup.map((piece): AttachmentRest => ({ slot: piece.slot, attachment: piece.slot, kind: 'region',
      vertices: [...piece.world], triangles: [0, 1, 2, 2, 3, 0] })),
    setup: frame(setup, 0), frames: poses.map(frame) };
}

/** Width six, setup overlap one, peak separation two: 6 * 2 = 12 cells. */
export function behindMotionFixture(sharedTranslation = false): BehindSeamFixture {
  const rear = rectangle('rear', -8, -8, 24, 24);
  const a = rectangle('a', 0, 3, 6, 4), b = rectangle('b', 0, 0, 6, 4);
  const pages = new Map([['rear', plate(24, 24, REAR)], ['a', plate(6, 4, FRONT)], ['b', plate(6, 4, FRONT)]]);
  const peak = sharedTranslation ? [rear, shifted(a, 5, 3), shifted(b, 5, 3)] : [rear, shifted(a, 0, 3), b];
  return fixture(pages, [rear, a, b], [[rear, a, b], peak, [rear, a, b]]);
}

export interface StandingFixtureOptions {
  gap?: number;
  a?: RGB;
  b?: RGB;
  rear?: RGB;
  /** Two touching edge texels below half alpha; callback RGB remains straight. */
  edgeAlpha?: number;
  stackedRear?: boolean;
  occluderAlpha?: number;
  /** Peak moves b by one extra cell; trough returns to the standing setup gap. */
  widen?: boolean;
}

/** Four rows: a one/two-cell vertical line contains 4/8 distinct cells. */
export function behindStandingFixture(options: StandingFixtureOptions = {}): BehindSeamFixture {
  const gap = options.gap ?? 1;
  const a = rectangle('a', 0, 0, 4, 4), b = rectangle('b', 4 + gap, 0, 4, 4);
  const rear = rectangle('rear', -1, -1, 12, 6);
  const pages = new Map([['rear', plate(12, 6, options.rear ?? REAR)],
    ['a', plate(4, 4, options.a ?? FRONT)], ['b', plate(4, 4, options.b ?? FRONT)]]);
  if (options.edgeAlpha !== undefined) {
    for (let y = 0; y < 4; y++) {
      pages.get('a')!.set(3, y, [...(options.a ?? FRONT), options.edgeAlpha]);
      pages.get('b')!.set(0, y, [...(options.b ?? FRONT), options.edgeAlpha]);
    }
  }
  const behind = [rear];
  if (options.stackedRear) {
    behind.unshift(rectangle('deep', -1, -1, 12, 6));
    pages.set('deep', plate(12, 6, [144, 160, 176]));
  }
  const later: Piece[] = [];
  if (options.occluderAlpha !== undefined) {
    later.push(rectangle('occluder', -1, -1, 12, 6));
    pages.set('occluder', plate(12, 6, [96, 112, 128], options.occluderAlpha));
  }
  const setup = [...behind, a, b, ...later];
  return fixture(pages, setup, [setup,
    [...behind, a, options.widen ? shifted(b, 1, 0) : b, ...later], setup]);
}

/** Same cells are bracketed on rows AND columns: the cross centre counts once. */
export function behindCrossFixture(): BehindSeamFixture {
  const base = behindStandingFixture();
  const a = rectangle('a', 0, 0, 5, 5), b = rectangle('b', 0, 0, 5, 5);
  const pa = new Plate(5, 5), pb = new Plate(5, 5);
  // Centre (2.5,2.5) has A immediately left/above and B right/below.
  pa.set(1, 2, [...FRONT, 255]); pa.set(2, 1, [...FRONT, 255]);
  pb.set(3, 2, [...FRONT, 255]); pb.set(2, 3, [...FRONT, 255]);
  base.pages.set('a', pa); base.pages.set('b', pb);
  const setup = [base.setup.pieces[0], a, b];
  return fixture(base.pages, setup, [setup, setup, setup]);
}

/** Four one-cell row gaps. An owner-0/3 endpoint makes one or all rows unread. */
function behindAmbiguousFixture(owner: 0 | 3, side: 'left' | 'right', mixed = false): BehindSeamFixture {
  const rear = rectangle('rear', -1, -1, 12, 6);
  const a = rectangle('a', 0, 0, 9, 4), b = rectangle('b', 0, 0, 9, 4);
  const pa = new Plate(9, 4), pb = new Plate(9, 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) pa.set(x, y, [...FRONT, 255]);
    for (let x = 5; x < 9; x++) pb.set(x, y, [...FRONT, 255]);
    if (!mixed || y === 0) {
      // Two 96/255 alphas composite above half, although neither alone reaches it.
      const alpha = owner === 0 ? 96 : 255, x = side === 'left' ? 3 : 5;
      pa.set(x, y, [...FRONT, alpha]); pb.set(x, y, [...FRONT, alpha]);
    }
  }
  const setup = [rear, a, b];
  return fixture(new Map([['rear', plate(12, 6, REAR)], ['a', pa], ['b', pb]]), setup, [setup, setup, setup]);
}

/** Change actual frame order: rear, then intervening, then in front of both. */
export function behindOrderFixture(): BehindSeamFixture {
  const out = behindStandingFixture();
  const [rear, a, b] = out.setup.pieces;
  out.frames = [[rear, a, b], [a, rear, b], [a, b, rear]].map(frame);
  return out;
}

/** No endpoint support: b is above a, with neither common rows nor columns. */
export function behindNoSupportFixture(): BehindSeamFixture {
  const out = behindStandingFixture();
  const [rear, a, b] = out.setup.pieces;
  const setup = [rear, a, shifted(b, 0, 6)];
  return fixture(out.pages, setup, [setup, setup, setup]);
}

/** Each slot's real callbacks, on the grid core derived; no bilinear copy. */
export function behindFixtureSamples(input: BehindSeamFixture, pose: SeamFrame, grid: SeamGrid): Map<string, Map<string, RGBA>> {
  const out = new Map<string, Map<string, RGBA>>();
  const project = projector(grid.viewport);
  for (const piece of pose.pieces) {
    const samples = out.get(piece.slot) ?? new Map<string, RGBA>();
    out.set(piece.slot, samples);
    rasterisePiece(pageFor(input.pages, piece), piece, project, grid.viewport,
      (x, y, r, g, b, alpha) => samples.set(`${x},${y}`, [r, g, b, alpha]));
  }
  return out;
}

export function behindFixtureGrid(input: BehindSeamFixture, pose: SeamFrame): SeamGrid {
  const grid = seamGridOf(input.pair, input.rest, pose, input.pages);
  if (grid === null) throw new Error('synthetic named pair must have an official seam grid');
  return grid;
}

/** Substrate controls run beside the detector controls, never as their substitute. */
export function runBehindSeamFixtureChecks(say: Say): void {
  const moving = behindMotionFixture(), shared = behindMotionFixture(true);
  const raw = (input: BehindSeamFixture) => seamsOf([input.pair], input.rest, input.frames, input.pages, {},
    { cells: setupCellReader(() => input.setup.pieces, input.pages) })[0];
  const opened = raw(moving), translated = raw(shared);
  say('BHS01_OFFICIAL_GAP_COVERED_IS_THE_HAND_COUNTED_RECTANGLE',
    opened.gapCovered?.worst?.px === 12 && opened.gapOpen?.frames.length === 0 &&
      opened.gapCovered.frames.length === 1 && opened.gapCovered.frames[0].index === 1 &&
      opened.gapCovered.frames[0].cells?.length === 12,
    JSON.stringify({ gapCovered: opened.gapCovered, gapOpen: opened.gapOpen }));
  say('BHS02_SHARED_TRANSLATION_HAS_NO_TRANSPORTED_OPENING',
    translated.gapCovered?.frames.length === 0 && translated.gapOpen?.frames.length === 0,
    JSON.stringify({ gapCovered: translated.gapCovered, gapOpen: translated.gapOpen }));
  for (const gap of [1, 2]) {
    const input = behindStandingFixture({ gap });
    const grid = behindFixtureGrid(input, input.setup);
    const full = renderFrame(asFrame(input.setup), input.pages, grid.viewport, [0, 0, 0, 0]);
    const hidden = renderFrame({ ...asFrame(input.setup), pieces: input.setup.pieces.filter(piece => piece.slot !== 'rear') }, input.pages, grid.viewport, [0, 0, 0, 0]);
    const exposed: number[] = [];
    for (let y = 0; y < grid.viewport.height; y++) for (let x = 0; x < grid.viewport.width; x++) {
      const wx = grid.viewport.minX + (x + 0.5) * grid.cell;
      const wy = grid.viewport.maxY - (y + 0.5) * grid.cell;
      // The analytic rectangle only; core pads the grid with exterior cells.
      if (wx > 4 && wx < 4 + gap && wy > 0 && wy < 4 &&
          full.get(x, y)[3] > 0 && hidden.get(x, y)[3] === 0) exposed.push(y * grid.viewport.width + x);
    }
    say(`BHS03_STANDING_FIXTURE_HAS_EXACTLY_FOUR_TIMES_GAP_OFFICIAL_CELLS[${gap}]`,
      grid.cell === 1 && exposed.length === 4 * gap && raw(input).banded === 0,
      JSON.stringify({ gap, cell: grid.cell, exposed: exposed.length, banded: raw(input).banded }));
  }
  for (const alpha of [1, 32, 64, 127]) {
    const input = behindStandingFixture({ gap: 0, rear: FRONT, edgeAlpha: alpha });
    const grid = behindFixtureGrid(input, input.setup);
    const samples = [...behindFixtureSamples(input, input.setup, grid).get('a')!.values()];
    const edge = samples.filter(rgba => rgba[3] === alpha);
    say(`BHS04_OFFICIAL_PARTIAL_ALPHA_CALLBACK_RGB_IS_STRAIGHT[${alpha}]`,
      edge.length === 4 && edge.every(rgba => rgba.slice(0, 3).every((channel, i) => channel === FRONT[i])),
      JSON.stringify({ alpha, edge }));
  }
}

const API = { pageFor, projector, rasterisePiece, renderFrame };
const asFrame = (pose: SeamFrame): Frame => ({ ...pose, pieces: [...pose.pieces], attachments: [...pose.attachments] });

/** Actual stock transport and attribution; no fabricated gapCovered records. */
function stockOf(input: BehindSeamFixture): BehindSeamsStockPair[] {
  const read = seamsOf([input.pair], input.rest, input.frames, input.pages, {},
    { cells: setupCellReader(() => input.setup.pieces, input.pages) })[0];
  return [{ pair: 'a|b', frames: input.frames.length, drawn: read.drawn, banded: read.banded,
    gapCovered: read.gapCovered.frames.map(hit => ({ index: hit.index, time: hit.time, cell: hit.cell, cells: hit.cells ?? [] })) }];
}

function inputOf(input: BehindSeamFixture): BehindSeamsFramesInput {
  return { pairs: [{ pair: 'a|b', a: 'a', b: 'b', declared: ['synthetic explicit seam'] }],
    setup: asFrame(input.setup), idle: input.frames.map(asFrame), rest: input.rest,
    pages: input.pages, stock: stockOf(input), fps: 12 };
}

function measured(input: BehindSeamFixture, declaration: BehindSeams = { threshold: 0 },
  change: Partial<BehindSeamsFramesInput> = {}) {
  const problems: Problem[] = [];
  const reading = measureBehindSeamFrames(API, { ...inputOf(input), ...change }, declaration, problems);
  return { reading, problems, pair: reading.pairs[0], lines: behindSeamLines(reading) };
}

const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const counts = (count: BehindSeamsCount | undefined, expected: number): boolean => count !== undefined && count.px === expected;
const unchangedInput = (input: BehindSeamFixture): string => JSON.stringify({ setup: input.setup, frames: input.frames,
  rest: input.rest, pages: [...input.pages].map(([name, page]) => [name, page.width, page.height, [...page.data]]) });

/** Evidence stays bounded: never stringify every raster sample or row metadata. */
function summary(reading: BehindSeamsMeasured) {
  const count = (value: BehindSeamsCount) => ({ status: value.status, support: value.boundary_cells,
    geometric: value.geometric_px, raw: value.raw_px, px: value.px, spatial: value.max_spatial_run_cells,
    sample_count: value.samples.length, first: value.samples[0] === undefined ? null : {
      rgb: value.samples[0].rear_rgb, weight: value.samples[0].rear_weight, distances: value.samples[0].distances,
    } });
  const frame = (value: BehindSeamsFrame) => ({ index: value.index, behind: value.behind_slots,
    motion: count(value.motion_opened), standing: count(value.standing) });
  return { status: reading.status, fps: reading.fps, pairs: reading.pairs.map(pair => ({ pair: pair.pair,
    threshold: pair.threshold, allowance: pair.allowance, setup: pair.setup === null ? null : frame(pair.setup),
    frames: pair.frames.map(frame), motion: { status: pair.motion_opened.status, max: pair.motion_opened.max_px,
      hits: pair.motion_opened.hit_frames, worst: pair.motion_opened.worst?.index },
    standing: { status: pair.standing.status, max: pair.standing.max_px, hits: pair.standing.hit_frames,
      worst: pair.standing.worst?.index, run: pair.standing.max_run, spatial: pair.standing.max_spatial_run_cells },
  })), unmeasured: reading.unmeasured };
}
const brief = (...results: ReturnType<typeof measured>[]): string => JSON.stringify(results.map(result => ({
  reading: summary(result.reading), problems: result.problems.map(problem => ({ code: problem.code, object: problem.object })),
})));

function runBehindSeamPrimitiveChecks(say: Say): void {
  const moving = behindMotionFixture(), shared = behindMotionFixture(true);
  const before = unchangedInput(moving), opened = measured(moving), closed = measured(shared);
  say('BHS05_MOTION_RECTANGLE_FAILS_WITH_NO_BACKGROUND_HOLE',
    counts(opened.pair?.setup?.motion_opened, 0) &&
      equal(opened.pair?.frames.map(row => row.motion_opened.px), [0, 12, 0]) &&
      opened.pair.motion_opened.status === 'FAIL' && opened.pair.motion_opened.max_px === 12 &&
      opened.pair.motion_opened.hit_frames === 1 && opened.pair.motion_opened.worst?.index === 1 &&
      opened.reading.status === 'FAIL' && opened.problems.some(problem => problem.code === BEHIND_SEAM_CODE),
    brief(opened));
  say('BHS06_REAL_SETUP_BAND_SHARED_TRANSLATION_IS_A_COMPLETE_PASS',
    closed.reading.status === 'PASS' && closed.reading.unmeasured.length === 0 && closed.problems.length === 0 &&
      closed.pair.motion_opened.status === 'PASS' && closed.pair.standing.status === 'PASS' &&
      closed.pair.motion_opened.max_px === 0 && closed.pair.standing.max_px === 0,
    brief(closed));
  for (const gap of [1, 2]) {
    const read = measured(behindStandingFixture({ gap }));
    say(`BHS07_STANDING_LINE_COUNTS_SETUP_IDLE_AND_TROUGH[${gap}]`,
      counts(read.pair?.setup?.standing, 4 * gap) && equal(read.pair.frames.map(row => row.standing.px), [4 * gap, 4 * gap, 4 * gap]) &&
        read.pair.standing.status === 'FAIL' && read.pair.standing.hit_frames === 3 &&
        read.pair.standing.max_px === 4 * gap && read.pair.standing.worst?.index === 0 &&
        read.pair.standing.max_run.frames === 3 && read.pair.motion_opened.status === 'SKIP' &&
        read.reading.unmeasured.length > 0 && read.reading.status !== 'PASS', brief(read));
  }
  const widening = measured(behindStandingFixture({ widen: true }));
  say('BHS08_WIDENING_RETAINS_REST_VISIBLE_BASELINE_AND_SEPARATE_SPATIAL_RUN',
    counts(widening.pair?.setup?.standing, 4) && equal(widening.pair.frames.map(row => row.standing.px), [4, 8, 4]) &&
      widening.pair.standing.worst?.index === 1 && widening.pair.standing.max_run.frames === 3 &&
      widening.pair.standing.max_run.seconds === 3 / 12 && widening.pair.standing.max_spatial_run_cells === 4 &&
      widening.pair.standing.max_spatial_run_world === 4 && widening.pair.standing.spans.length === 1 &&
      widening.pair.standing.spans[0].first === 0 && widening.pair.standing.spans[0].last === 2,
    brief(widening));
  const touching = measured(behindStandingFixture({ gap: 0 }));
  say('BHS09_ZERO_LENGTH_BRACKET_IS_CLOSED_SUPPORT_NOT_A_HOLE',
    touching.pair?.setup?.standing.status === 'PASS' && touching.pair.setup.standing.boundary_cells > 0 &&
      touching.pair.setup.standing.px === 0 && touching.pair.standing.status === 'PASS' &&
      touching.pair.frames.every(row => row.standing.status === 'PASS' && row.standing.boundary_cells > 0 && row.standing.px === 0) &&
      touching.pair.motion_opened.status === 'SKIP' && touching.reading.status !== 'PASS', brief(touching));
  const unsupported = measured(behindNoSupportFixture());
  say('BHS10_NO_BRACKET_SUPPORT_IS_UNMEASURED_NOT_CLOSED',
    unsupported.pair?.standing.status === 'SKIP' && unsupported.reading.status !== 'PASS' &&
      unsupported.reading.unmeasured.length > 0 && unsupported.problems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE),
    brief(unsupported));
  for (const alpha of [1, 32, 64, 127]) {
    const read = measured(behindStandingFixture({ gap: 0, rear: FRONT, edgeAlpha: alpha }));
    const rows = [read.pair?.setup, ...read.pair.frames];
    say(`BHS11_IDENTICAL_STRAIGHT_RGB_REAR_NEVER_FIRES_ACROSS_ALPHA_RAMPS[${alpha}]`,
      rows.every(row => row !== null && row !== undefined && row.standing.status === 'PASS' &&
        row.standing.geometric_px === 8 && row.standing.raw_px === 0 && row.standing.px === 0 &&
        row.standing.samples.length === 8 && row.standing.samples.every(sample =>
          sample.rear_weight > 0 && sample.rear_weight < 1 && equal(sample.rear_rgb, FRONT) &&
          equal(sample.distances, [0, 0]) && !sample.counted)), brief(read));
  }
  const truth = [
    { label: 'both', a: FRONT, b: FRONT, rear: REAR, px: 4 },
    { label: 'only-a', a: FRONT, b: REAR, rear: REAR, px: 0 },
    { label: 'only-b', a: REAR, b: FRONT, rear: REAR, px: 0 },
    { label: 'neither', a: FRONT, b: FRONT, rear: FRONT, px: 0 },
  ];
  for (const row of truth) {
    const read = measured(behindStandingFixture(row));
    say(`BHS12_MAX_CHANNEL_COLOUR_MUST_DIFFER_FROM_BOTH_NEIGHBOURS[${row.label}]`,
      counts(read.pair?.setup?.standing, row.px) && read.pair.frames.every(frame => frame.standing.px === row.px) &&
        read.pair.setup!.standing.geometric_px === 4 && read.pair.setup!.standing.raw_px === row.px,
      brief(read));
  }
  // Only blue changes; an average-channel metric would incorrectly suppress 11 > 10.
  for (const distance of [10, 11]) {
    const read = measured(behindStandingFixture({ rear: [24, 48, 72 + distance] }), { threshold: 10 });
    say(`BHS13_THRESHOLD_IS_STRICT_AND_MAX_CHANNEL_NOT_CHANNEL_MEAN[${distance}]`,
      counts(read.pair?.setup?.standing, distance === 10 ? 0 : 4) && read.pair.setup!.standing.raw_px === 4 &&
        read.pair.setup!.standing.samples.every(sample => equal(sample.distances, [distance, distance])), brief(read));
  }
  for (const neighbour of ['a', 'b'] as const) {
    const neighbourRgb: RGB = [24, 48, 73];
    const equalityAtOne = measured(behindStandingFixture({ [neighbour]: neighbourRgb, rear: [24, 48, 83] }), { threshold: 10 });
    say(`BHS14_THRESHOLD_EQUALITY_AT_EITHER_NEIGHBOUR_EXCLUDES_THE_CELL[${neighbour}]`,
      equalityAtOne.pair?.setup?.standing.px === 0 && equalityAtOne.pair.setup.standing.samples.every(sample =>
        sample.distances !== null && Math.min(...sample.distances) === 10 && Math.max(...sample.distances) === 11), brief(equalityAtOne));
  }
  const allowed = measured(moving, { threshold: 0, allowance: 12 });
  const tooSmall = measured(moving, { threshold: 0, allowance: 11 });
  say('BHS15_ALLOWANCE_EQUALITY_PASSES_AND_ONE_CELL_LESS_FAILS_BOTH_HALVES',
    allowed.reading.status === 'PASS' && allowed.problems.length === 0 &&
      allowed.pair.motion_opened.max_px === 12 && allowed.pair.standing.max_px === 12 &&
      tooSmall.pair.motion_opened.status === 'FAIL' && tooSmall.pair.standing.status === 'FAIL' &&
      tooSmall.problems.some(problem => problem.code === BEHIND_SEAM_CODE), brief(allowed, tooSmall));
  const override = measured(moving, { threshold: 255, allowance: 0,
    pairs: [{ part: 'b', neighbour: 'a', threshold: 0, allowance: 12 }] });
  say('BHS16_REVERSED_PAIR_OVERRIDE_REPLACES_RIG_THRESHOLD_AND_ALLOWANCE',
    override.reading.status === 'PASS' && override.pair.threshold === 0 && override.pair.allowance === 12 &&
      override.pair.motion_opened.max_px === 12 && override.pair.standing.max_px === 12, brief(override));
  const pairT = measured(shared, { pairs: [{ part: 'a', neighbour: 'b', threshold: 0 }] });
  say('BHS17_PAIR_AUTHORED_THRESHOLD_NEEDS_NO_GLOBAL_DEFAULT',
    pairT.reading.status === 'PASS' && pairT.pair.threshold === 0 && pairT.pair.allowance === 0, brief(pairT));
  const stack = behindStandingFixture({ stackedRear: true }), stacked = measured(stack);
  const grid = behindFixtureGrid(stack, stack.setup);
  const hidden = (slots: string[]) => renderFrame({ ...asFrame(stack.setup), pieces: stack.setup.pieces.filter(piece => !slots.includes(piece.slot)) }, stack.pages, grid.viewport, [0, 0, 0, 0]);
  const oneHidden = hidden(['rear']), allHidden = hidden(['deep', 'rear']);
  const x = Math.floor((4.5 - grid.viewport.minX) / grid.cell), y = Math.floor((grid.viewport.maxY - 0.5) / grid.cell);
  say('BHS18_ALL_STACKED_REAR_SLOTS_ARE_HIDDEN_TOGETHER',
    equal(stacked.pair?.setup?.behind_slots, ['deep', 'rear']) && counts(stacked.pair.setup?.standing, 4) &&
      oneHidden.get(x, y)[3] === 255 && allHidden.get(x, y)[3] === 0 &&
      stacked.pair.setup!.standing.samples.every(sample => sample.contributors.some(contributor => contributor.slot === 'rear') &&
        sample.contributors.every(contributor => contributor.slot !== 'deep' || contributor.weight === 0)), brief(stacked));
  const ordered = measured(behindOrderFixture());
  say('BHS19_BEHIND_SET_USES_EACH_FRAMES_DRAW_ORDER',
    equal(ordered.pair?.frames.map(frame => frame.behind_slots), [['rear'], [], []]) &&
      ordered.pair.frames[0].standing.px === 4 && ordered.pair.frames.slice(1).every(frame => frame.standing.geometric_px === 0) &&
      ordered.reading.unmeasured.length > 0 &&
      ordered.reading.status !== 'PASS', brief(ordered));
  const covered = measured(behindStandingFixture({ occluderAlpha: 255 }));
  const partial = measured(behindStandingFixture({ occluderAlpha: 128 }));
  say('BHS20_OPAQUE_LATER_OCCLUDER_REMOVES_REAR_PARTIAL_ALPHA_DOES_NOT',
    covered.pair?.setup?.standing.geometric_px === 0 && covered.pair.setup.standing.px === 0 &&
      partial.pair.setup?.standing.geometric_px === 4 && partial.pair.setup.standing.px === 4 &&
      partial.pair.setup.standing.samples.every(sample => Math.abs(sample.rear_weight - 127 / 255) <= Number.EPSILON), brief(covered, partial));
  const cross = measured(behindCrossFixture());
  say('BHS21_ROW_AND_COLUMN_CORRIDORS_COUNT_THE_CROSS_CENTRE_ONCE',
    counts(cross.pair?.setup?.standing, 1) && cross.pair.setup!.standing.samples.length === 1 &&
      cross.pair.frames.every(frame => frame.standing.px === 1), brief(cross));
  const noRear = behindMotionFixture();
  noRear.setup = frame(noRear.setup.pieces.filter(piece => piece.slot !== 'rear'), 0);
  noRear.frames = noRear.frames.map(pose => frame(pose.pieces.filter(piece => piece.slot !== 'rear'), pose.index));
  const unavailable = [
    { label: 'behind', fixture: noRear, change: {} },
    { label: 'idle', fixture: shared, change: { idle: [] } },
    { label: 'setup', fixture: shared, change: { setup: null } },
    { label: 'stock-render', fixture: shared, change: { stock: null } },
    { label: 'pair-population', fixture: shared, change: { pairs: [] } },
  ] satisfies Array<{ label: string; fixture: BehindSeamFixture; change: Partial<BehindSeamsFramesInput> }>;
  for (const row of unavailable) {
    const read = measured(row.fixture, { threshold: 0 }, row.change);
    say(`BHS22_AUTHORED_THRESHOLD_MANDATORY_UNREAD_IS_A_NAMED_FAILURE[${row.label}]`,
      read.reading.status === 'FAIL' && read.reading.unmeasured.length > 0 &&
        read.problems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE) &&
        read.lines.some(line => line.includes('HOLE')), brief(read));
  }
  const missingPair = measured(shared, { threshold: 0 }, { pairs: [{ pair: 'a|missing', a: 'a', b: 'missing', declared: ['synthetic missing slot'], unread: 'slot missing is absent' }] });
  say('BHS23_DECLARED_MISSING_SLOT_NAMES_THE_UNREAD_POPULATION',
    missingPair.reading.status === 'FAIL' && missingPair.reading.unmeasured.some(row => row.pair === 'a|missing') &&
      missingPair.problems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE), brief(missingPair));
  // Undeclared orchestration does not call the declared-only frame instrument.
  const absent = behindSeamLines(null);
  const missingT = measured(moving, {});
  say('BHS24_ABSENT_DECLARATION_AND_ABSENT_AUTHORED_T_ARE_SKIP_HOLES',
    absent.some(line => line.includes('SKIP')) && absent.some(line => line.includes('HOLE')) &&
      missingT.reading.status === 'SKIP' && missingT.problems.length === 0 && missingT.lines.some(line => line.includes('SKIP')) &&
      missingT.lines.some(line => line.includes('HOLE')),
    JSON.stringify({ absent, missingT: summary(missingT.reading) }));
  const noSource = behindMotionFixture();
  noSource.pages = new Map(noSource.pages); noSource.pages.delete('rear');
  // Keep core's valid stock; remove the colour source only for the production reader.
  const sourceProblems: Problem[] = [];
  let sourceRefusal: unknown = null;
  let sourceStatus: string | undefined;
  try { sourceStatus = measureBehindSeamFrames(API, { ...inputOf(moving), pages: noSource.pages }, { threshold: 0 }, sourceProblems).status; }
  catch (error) { sourceRefusal = error; }
  say('BHS25_MISSING_REAR_SOURCE_CANNOT_BECOME_A_ZERO_PASS',
    sourceStatus === 'FAIL' && sourceProblems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE) ||
      sourceRefusal instanceof Error && sourceRefusal.message.includes('rear'),
    JSON.stringify({ sourceStatus, problems: sourceProblems, refusal: String(sourceRefusal) }));
  say('BHS26_READER_KEEPS_PAIR_PROVENANCE_GRID_LIMITATIONS_AND_INPUT_BYTES',
    equal(opened.pair?.declared, ['synthetic explicit seam']) && opened.pair.frames.every(row => row.grid?.cell === 1) &&
      /curv|diagonal/i.test(opened.reading.limitations) && unchangedInput(moving) === before,
    JSON.stringify({ pair: opened.pair.pair, declared: opened.pair.declared,
      cells: opened.pair.frames.map(row => row.grid?.cell), limitations: opened.reading.limitations, unchanged: unchangedInput(moving) === before }));

  const movingTear = behindMotionFixture();
  movingTear.frames[1] = frame(movingTear.frames[1].pieces.map(piece =>
    piece.slot === 'rear' ? piece : shifted(piece, 5, 3)), 1);
  const shiftedStock = stockOf(movingTear), shiftedTear = measured(movingTear);
  say('BHS30_COMMON_TRANSLATION_PLUS_TEAR_KEEPS_ALL_TWELVE_TRANSPORTED_CELLS',
    shiftedStock[0].gapCovered.length === 1 && shiftedStock[0].gapCovered[0].cells.length === 12 &&
      shiftedStock[0].gapCovered[0].cells.every(cell => cell.y > 7) &&
      equal(shiftedTear.pair?.frames.map(row => row.motion_opened.px), [0, 12, 0]) &&
      shiftedTear.pair.motion_opened.max_px === 12 && shiftedTear.pair.motion_opened.status === 'FAIL',
    JSON.stringify({ stock: shiftedStock[0].gapCovered.map(hit => ({ index: hit.index, cells: hit.cells.length })),
      detector: summary(shiftedTear.reading) }));

  const unavailableProblems: Problem[] = [];
  let rendererStatus: string | undefined, rendererRefusal: unknown = null;
  try {
    rendererStatus = measureBehindSeamFrames({ ...API, renderFrame: () => { throw new Error('synthetic renderer unavailable'); } },
      inputOf(moving), { threshold: 0 }, unavailableProblems).status;
  } catch (error) { rendererRefusal = error; }
  say('BHS31_UNAVAILABLE_OFFICIAL_RENDER_NEVER_RETURNS_ZERO_PASS',
    rendererStatus === 'FAIL' && unavailableProblems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE) ||
      rendererRefusal instanceof Error && rendererRefusal.message.includes('synthetic renderer unavailable'),
    JSON.stringify({ status: rendererStatus, problems: unavailableProblems.map(problem => problem.code), refusal: String(rendererRefusal) }));

  const mixture = behindStandingFixture({ stackedRear: true });
  const topRear = mixture.pages.get('rear')!;
  for (let y = 0; y < topRear.height; y++) for (let x = 0; x < topRear.width; x++) topRear.set(x, y, [...REAR, 128]);
  const mixed = measured(mixture);
  // Opaque deep colour weighted 127/255 plus the nearer colour weighted 128/255.
  const expectedRgb: RGB = [144, 160, 176].map((channel, i) => (channel * 127 + REAR[i] * 128) / 255) as RGB;
  say('BHS32_STACKED_PARTIAL_ALPHA_REAR_USES_SURVIVING_SET_MIXTURE',
    counts(mixed.pair?.setup?.standing, 4) && mixed.pair.setup!.standing.samples.every(sample =>
      sample.rear_rgb.every((channel, i) => Math.abs(channel - expectedRgb[i]) <= 8 * Number.EPSILON * 255) &&
      Math.abs(sample.rear_weight - 1) <= Number.EPSILON &&
      sample.contributors.some(contributor => contributor.slot === 'deep' && Math.abs(contributor.weight - 127 / 255) <= Number.EPSILON) &&
      sample.contributors.some(contributor => contributor.slot === 'rear' && contributor.weight === 128 / 255)),
    brief(mixed));

  const ignoredOverride = measured(shared, { threshold: 0, pairs: [{ part: 'a', neighbour: 'unselected', threshold: 10 }] });
  say('BHS33_PAIR_OVERRIDE_CANNOT_SILENTLY_CREATE_OR_IGNORE_A_SELECTED_PAIR',
    ignoredOverride.reading.status === 'FAIL' && ignoredOverride.problems.length > 0,
    brief(ignoredOverride));

  const fragmented = behindStandingFixture();
  // One rear slot with two disjoint fragments; both fragments together cover the line.
  const fragments = [rectangle('rear', -1, -1, 12, 3), rectangle('rear', -1, 2, 12, 3)];
  fragmented.pages.set('rear', plate(12, 3, REAR));
  fragmented.setup = { ...fragmented.setup, pieces: [...fragments, ...fragmented.setup.pieces.filter(piece => piece.slot !== 'rear')] };
  fragmented.frames = fragmented.frames.map(pose => ({ ...pose, pieces: [...fragments, ...pose.pieces.filter(piece => piece.slot !== 'rear')] }));
  const fragmentsRead = measured(fragmented);
  say('BHS34_ALL_FRAGMENTS_OF_ONE_REAR_SLOT_CONTRIBUTE_WITHOUT_DUPLICATE_SLOT_NAMES',
    equal(fragmentsRead.pair?.setup?.behind_slots, ['rear']) && counts(fragmentsRead.pair.setup?.standing, 4) &&
      fragmentsRead.pair.frames.every(row => row.standing.px === 4), brief(fragmentsRead));

  const missingAttachments = inputOf(shared);
  missingAttachments.idle = missingAttachments.idle.map(pose => ({ ...pose, attachments: undefined }));
  const attribution = measured(shared, { threshold: 0 }, missingAttachments);
  say('BHS35_UNREAD_ATTACHMENT_PROVENANCE_IS_NOT_A_MEASURED_ZERO',
    attribution.reading.status === 'FAIL' && attribution.reading.unmeasured.length > 0 &&
      attribution.problems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE), brief(attribution));

  const occludedMotion = behindMotionFixture();
  const occluder = rectangle('occluder', -8, -8, 24, 24);
  occludedMotion.pages.set('occluder', plate(24, 24, [96, 112, 128]));
  occludedMotion.setup = frame([...occludedMotion.setup.pieces, occluder], 0);
  occludedMotion.frames = occludedMotion.frames.map(pose => frame([...pose.pieces, occluder], pose.index));
  const occluded = measured(occludedMotion);
  say('BHS36_LATER_OPAQUE_OCCLUDER_SUPPRESSES_MOTION_REAR_ATTRIBUTION',
    stockOf(occludedMotion)[0].gapCovered[0].cells.length === 12 && occluded.pair.motion_opened.max_px === 0 &&
      occluded.pair.motion_opened.status === 'PASS' && occluded.pair.frames.every(frame => frame.motion_opened.geometric_px === 0), brief(occluded));

  const standingAllowed = measured(behindStandingFixture(), { threshold: 0, allowance: 3,
    pairs: [{ part: 'a', neighbour: 'b', allowance: 4 }] });
  say('BHS37_PAIR_ALLOWANCE_PASSES_STANDING_WITHOUT_CERTIFYING_UNREAD_MOTION',
    standingAllowed.pair?.standing.status === 'PASS' && standingAllowed.pair.standing.max_px === 4 &&
      standingAllowed.pair.allowance === 4 && standingAllowed.pair.motion_opened.status === 'SKIP' &&
      standingAllowed.reading.status === 'FAIL' && standingAllowed.problems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE), brief(standingAllowed));

  const distinctSetup = behindStandingFixture();
  // Idle frame zero is widened, but setup keeps the original one-cell line.
  distinctSetup.frames[0] = frame(distinctSetup.frames[0].pieces.map(piece => piece.slot === 'b' ? shifted(piece, 1, 0) : piece), 0);
  const separate = measured(distinctSetup);
  say('BHS38_AUTHORED_SETUP_IS_NOT_REPLACED_BY_IDLE_FRAME_ZERO',
    counts(separate.pair?.setup?.standing, 4) && separate.pair.frames[0].standing.px === 8 &&
      separate.pair.standing.hit_frames === 3 && separate.pair.standing.worst?.index === 0, brief(separate));

  const incomplete = stockOf(shared);
  incomplete[0] = { ...incomplete[0], drawn: 2, banded: 2 };
  const missingFrame = measured(shared, { threshold: 0 }, { stock: incomplete });
  say('BHS39_STOCK_MISSING_A_SAMPLED_FRAME_CANNOT_CERTIFY_MOTION',
    missingFrame.reading.status === 'FAIL' && missingFrame.pair.motion_opened.status === 'SKIP' &&
      missingFrame.reading.unmeasured.length > 0 && missingFrame.problems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE), brief(missingFrame));
  say('BHS43_RENDERED_LINES_NAME_THE_PAIR_AND_BOTH_INDEPENDENT_HALVES',
    opened.lines.some(line => line.includes(BEHIND_SEAM_LINE) && line.includes('FAIL')) &&
      opened.lines.some(line => line.includes('a|b')) &&
      opened.lines.some(line => /motion[_ -]opened/i.test(line)) && opened.lines.some(line => /standing/i.test(line)),
    JSON.stringify({ line_count: opened.lines.length, has_pair: opened.lines.some(line => line.includes('a|b')),
      has_motion: opened.lines.some(line => /motion[_ -]opened/i.test(line)), has_standing: opened.lines.some(line => /standing/i.test(line)) }));

  const ambiguousMixed = behindAmbiguousFixture(3, 'left', true);
  const localised = measured(ambiguousMixed, { threshold: 40 });
  const mixedRows = [localised.pair.setup!, ...localised.pair.frames];
  say('BHS44_MIXED_UNREAD_CORRIDOR_RETAINS_MEASURED_FAILURE',
    mixedRows.every(row => row.standing.status === 'FAIL' && row.standing.px === 3 &&
      row.standing.geometric_px === 3 && row.standing.raw_px === 3 && row.standing.samples.length === 3 &&
      row.standing.unread_cells === 1 && row.standing.unread_corridors?.length === 1) &&
      localised.pair.standing.status === 'FAIL' && localised.pair.standing.max_px === 3 &&
      localised.pair.frames.every(row => row.motion_opened.status === 'PASS') &&
      localised.pair.sampled_frames === 3 && localised.pair.read_frames === 0 && localised.pair.unmeasured_frames === 3 &&
      localised.reading.status === 'FAIL' &&
      localised.problems.some(problem => problem.code === BEHIND_SEAM_CODE && problem.object === 'pair "a|b" standing' && problem.detail.includes('3 cells')) &&
      localised.problems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE) &&
      localised.reading.unmeasured.some(row => row.reason.includes('ambiguous half-alpha owners')),
    JSON.stringify({ measured: summary(localised.reading), problems: localised.problems,
      unread: localised.pair.setup!.standing.unread_corridors,
      read_frames: localised.pair.read_frames, unmeasured_frames: localised.pair.unmeasured_frames }));

  const mixedCorridor = localised.pair.setup!.standing.unread_corridors?.[0];
  // Native unit grid is padded one cell: x starts at -1 and top y is 5.
  say('BHS45_UNREAD_CORRIDOR_NAMES_ENDPOINT_GRID_WORLD_OWNERS_AND_CELL_CENTRES',
    mixedCorridor?.axis === 'horizontal' && mixedCorridor.cell_count === 1 &&
      equal(mixedCorridor.endpoints, [[4, 1, 3.5, 3.5, 3], [6, 1, 5.5, 3.5, 2]]) &&
      equal(mixedCorridor.cells, [[4.5, 3.5]]) &&
      CHECK_ROW_FAMILY in mixedCorridor && mixedCorridor[CHECK_ROW_FAMILY] === 'BEHIND_PART_SEAMS.unread_corridors' &&
      'row_scope' in mixedCorridor && mixedCorridor.row_scope === 'pair' &&
      'row_kind' in mixedCorridor && mixedCorridor.row_kind === 'evidence' &&
      'row_subjects' in mixedCorridor && equal(mixedCorridor.row_subjects, ['a', 'b']) &&
      equal(localised.reading, measured(ambiguousMixed, { threshold: 40 }).reading),
    JSON.stringify({ corridor: mixedCorridor, grid: localised.pair.setup!.grid }));

  for (const owner of [0, 3] as const) for (const side of ['left', 'right'] as const) {
    const onlyUnread = measured(behindAmbiguousFixture(owner, side), { threshold: 40 });
    const expectedOwners = side === 'left' ? [owner, 2] : [1, owner];
    const rows = [onlyUnread.pair.setup!, ...onlyUnread.pair.frames];
    const frameSkipLines = onlyUnread.lines.filter(line => line.includes('idle frame ') && line.includes('unread corridors are not zero'));
    say(`BHS46_ONLY_AMBIGUOUS_OWNER_IS_UNREAD_WITHOUT_INFERENCE[${owner},${side}]`,
      rows.every(row => row.standing.status === 'SKIP' && row.standing.px === 0 && row.standing.samples.length === 0 &&
        row.standing.unread_cells === 4 && row.standing.unread_corridors?.length === 4 &&
        row.standing.unread_corridors.every(corridor => corridor.axis === 'horizontal' && corridor.cell_count === 1 &&
          equal(corridor.endpoints.map(endpoint => endpoint[4]), expectedOwners)) &&
        equal(row.standing.unread_corridors.map(corridor => corridor.cells), [[[4.5, 3.5]], [[4.5, 2.5]], [[4.5, 1.5]], [[4.5, 0.5]]])) &&
        onlyUnread.pair.standing.status === 'SKIP' && onlyUnread.pair.read_frames === 0 && onlyUnread.pair.unmeasured_frames === 3 &&
        onlyUnread.reading.status === 'FAIL' && onlyUnread.problems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE) &&
        !onlyUnread.problems.some(problem => problem.code === BEHIND_SEAM_CODE) &&
        frameSkipLines.length === 3 && frameSkipLines.every((line, i) =>
          line === `${BEHIND_SEAM_LINE}: pair "a|b" idle frame ${i} SKIP — HOLE: standing endpoints include ambiguous half-alpha owners; unread corridors are not zero`),
      JSON.stringify({ owner, side, reading: summary(onlyUnread.reading), unread: onlyUnread.pair.setup!.standing.unread_corridors, frameSkipLines }));
  }

  const withinBarMixed = measured(ambiguousMixed, { threshold: 40, allowance: 3 });
  const fullyUnread = measured(behindAmbiguousFixture(3, 'left', false), { threshold: 40 });
  const mixedLogVerdict = (failLines: readonly string[], allowedLines: readonly string[], unreadLines: readonly string[]): boolean => {
    const failFrames = failLines.filter(line => line.includes('idle frame '));
    const allowedFrames = allowedLines.filter(line => line.includes('idle frame '));
    const unreadFrames = unreadLines.filter(line => line.includes('idle frame '));
    return failFrames.length === 3 && allowedFrames.length === 3 && unreadFrames.length === 3 &&
      failFrames.every((line, i) => !line.includes('SKIP') &&
        line.includes(`idle frame ${i} standing FAIL, 3 cells — unread corridors: 1 (cells 1); HOLE:`)) &&
      allowedFrames.every((line, i) => !line.includes('SKIP') &&
        line.includes(`idle frame ${i} standing 3 cells — unread corridors: 1 (cells 1); HOLE:`)) &&
      !failLines.some(line => line.includes('setup') && line.includes('SKIP')) &&
      !allowedLines.some(line => line.includes('setup') && line.includes('SKIP')) &&
      unreadFrames.every((line, i) => line === `${BEHIND_SEAM_LINE}: pair "a|b" idle frame ${i} SKIP — HOLE: standing endpoints include ambiguous half-alpha owners; unread corridors are not zero`);
  };
  const oldTextMutant = localised.reading.unmeasured.map(u =>
    `${BEHIND_SEAM_LINE}: ${u.pair === null ? 'rig' : `pair "${u.pair}"`} ${u.frame} SKIP — ${u.reason}`);
  const mixedJsonBefore = JSON.stringify(localised.reading);
  say('BHS50_MIXED_FRAME_LOG_LINE_REPORTS_COUNTED_STATUS_AND_UNREAD_CORRIDOR_CLAUSE',
    mixedLogVerdict(localised.lines, withinBarMixed.lines, fullyUnread.lines) &&
      !mixedLogVerdict(oldTextMutant, withinBarMixed.lines, fullyUnread.lines) &&
      !mixedLogVerdict(localised.lines, oldTextMutant, fullyUnread.lines) &&
      mixedJsonBefore === JSON.stringify(measured(ambiguousMixed, { threshold: 40 }).reading),
    JSON.stringify({ failFrame0: localised.lines.find(line => line.includes('idle frame 0')),
      allowedFrame0: withinBarMixed.lines.find(line => line.includes('idle frame 0')),
      unreadFrame0: fullyUnread.lines.find(line => line.includes('idle frame 0')),
      mutantRejected: !mixedLogVerdict(oldTextMutant, withinBarMixed.lines, fullyUnread.lines) }));

  const crossUnread = behindCrossFixture();
  crossUnread.pages.get('b')!.set(1, 2, [...FRONT, 255]);
  crossUnread.pages.get('b')!.set(2, 1, [...FRONT, 255]);
  const unreadCross = measured(crossUnread, { threshold: 40 });
  say('BHS47_CROSS_AXIS_UNREAD_CELL_UNION_COUNTS_CENTRE_ONCE',
    [unreadCross.pair.setup!, ...unreadCross.pair.frames].every(row => row.standing.status === 'SKIP' &&
      row.standing.px === 0 && row.standing.unread_cells === 1 && row.standing.unread_corridors?.length === 2 &&
      equal(row.standing.unread_corridors.map(corridor => [corridor.axis, corridor.cell_count, corridor.cells]),
        [['horizontal', 1, [[2.5, 2.5]]], ['vertical', 1, [[2.5, 2.5]]]]) &&
      equal(row.standing.unread_corridors.map(corridor => corridor.endpoints),
        [[[2, 3, 1.5, 2.5, 3], [4, 3, 3.5, 2.5, 2]], [[3, 2, 2.5, 3.5, 3], [3, 4, 2.5, 1.5, 2]]])) &&
      unreadCross.reading.status === 'FAIL' && unreadCross.problems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE),
    JSON.stringify({ unread: unreadCross.pair.setup!.standing.unread_corridors,
      distinct: unreadCross.pair.setup!.standing.unread_cells, status: unreadCross.reading.status }));

  say('BHS48_UNAMBIGUOUS_OFFICIAL_OUTPUTS_OMIT_UNREAD_EXTENSION_FIELDS',
    [closed, opened, touching, cross].every(result =>
      [result.pair.setup!, ...result.pair.frames].every(row => [row.standing, row.motion_opened].every(count =>
        !Object.hasOwn(count, 'unread_cells') && !Object.hasOwn(count, 'unread_corridors'))) &&
      !JSON.stringify(result.reading).includes('"unread_cells"') && !JSON.stringify(result.reading).includes('"unread_corridors"')),
    'Official shared-translation, moving-opening, touching and cross fixtures omit both optional fields in setup and idle JSON.');

  const underflowFixture = behindStandingFixture();
  // (1 - 254/255)^140 underflows float64 while symbolic rear survival stays positive.
  underflowFixture.pages.set('veil', plate(12, 6, FRONT, 254));
  const veils = Array.from({ length: 140 }, (_, i) => ({ ...rectangle(`veil-${i}`, -1, -1, 12, 6), page: 'veil' }));
  underflowFixture.setup = frame([...underflowFixture.setup.pieces, ...veils], 0);
  underflowFixture.frames = underflowFixture.frames.map(pose => frame([...pose.pieces, ...veils], pose.index));
  const numericUnread = measured(underflowFixture, { threshold: 40 });
  say('BHS49_NUMERIC_REAR_UNDERFLOW_REMAINS_UNMEASURED_WITHOUT_ENDPOINT_AMBIGUITY',
    [numericUnread.pair.setup!, ...numericUnread.pair.frames].every(row => row.standing.status === 'SKIP' && row.standing.px === 0 &&
      !Object.hasOwn(row.standing, 'unread_cells') && !Object.hasOwn(row.standing, 'unread_corridors')) &&
      numericUnread.pair.read_frames === 0 && numericUnread.pair.unmeasured_frames === 3 &&
      numericUnread.reading.status === 'FAIL' && numericUnread.problems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE &&
        problem.detail.includes('underflowed its numeric colour weight')),
    brief(numericUnread));
}

function runBehindSeamRequirementChecks(dir: string, say: Say): void {
  const write = (name: string, value?: unknown): string => {
    const path = join(dir, name + '.json');
    writeFileSync(path, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [],
      ...(value === undefined ? {} : { behind_seams: value }) }) + '\n');
    return path;
  };
  const declaration: BehindSeams = { threshold: 10, allowance: 12, pairs: [{ part: 'a', neighbour: 'b', threshold: 11, allowance: 4 }] };
  const read = readRequirements(write('declared', declaration));
  const again = readRequirements(write('roundtrip', read.behind_seams));
  say('BHS27_REAL_REQUIREMENTS_READER_PRESERVES_OPTIONAL_BLOCK_AND_OVERRIDES',
    readRequirements(write('absent')).behind_seams === undefined && equal(read.behind_seams, declaration) &&
      equal(again.behind_seams, declaration) && equal(readRequirements(write('missing-t', {})).behind_seams, {}),
    JSON.stringify({ present: read.behind_seams, roundtrip: again.behind_seams }));
  const invalid: Array<{ label: string; value: unknown }> = [
    { label: 'null', value: null }, { label: 'number', value: 1 }, { label: 'array', value: [] },
    ...[-1, 256, 0.5, '10'].map(threshold => ({ label: 'threshold-' + String(threshold), value: { threshold } })),
    ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '4'].map(allowance => ({ label: 'allowance-' + String(allowance), value: { allowance } })),
    { label: 'unknown', value: { threshold: 0, surprise: 1 } }, { label: 'pairs-object', value: { pairs: {} } },
    { label: 'pairs-null', value: { pairs: null } }, { label: 'pair-null', value: { pairs: [null] } },
    { label: 'missing-names', value: { pairs: [{}] } }, { label: 'empty-name', value: { pairs: [{ part: '', neighbour: 'b' }] } },
    { label: 'same-name', value: { pairs: [{ part: 'a', neighbour: 'a' }] } },
    { label: 'pair-t', value: { pairs: [{ part: 'a', neighbour: 'b', threshold: 256 }] } },
    { label: 'pair-allowance', value: { pairs: [{ part: 'a', neighbour: 'b', allowance: -1 }] } },
    { label: 'pair-unknown', value: { pairs: [{ part: 'a', neighbour: 'b', surprise: 1 }] } },
    { label: 'duplicate-reversed', value: { pairs: [{ part: 'a', neighbour: 'b' }, { part: 'b', neighbour: 'a' }] } },
  ];
  for (const row of invalid) {
    const direct = behindSeamsProblems(row.value, 'behind_seams');
    let problems: readonly Problem[] = [];
    try { readRequirements(write('invalid-' + row.label, row.value)); }
    catch (error) { if (!(error instanceof PartsError)) throw error; problems = error.problems; }
    say(`BHS28_INVALID_BLOCK_REFUSED_THROUGH_ACTUAL_REQUIREMENTS_READER[${row.label}]`,
      direct.length > 0 && direct.every(problem => problem.code === 'REQUIREMENTS_FIELD') &&
        problems.some(problem => problem.code === 'REQUIREMENTS_FIELD' && problem.object.includes('behind_seams')),
      JSON.stringify({ direct, problems }));
  }
  for (const threshold of [0, 255]) {
    const value = { threshold, allowance: 0, pairs: [{ part: 'a', neighbour: 'b', threshold, allowance: 0 }] };
    say(`BHS29_AUTHORED_BOUNDARY_VALUES_AND_ZERO_ALLOWANCE_LOAD[${threshold}]`,
      behindSeamsProblems(value, 'behind_seams').length === 0 && equal(readRequirements(write('valid-' + threshold, value)).behind_seams, value), JSON.stringify(value));
  }
}

/** A three-block variant of the established check fixture, generated only in this suite's temp directory. */
function writeBehindSeamCheckRig(dir: string): void {
  writeCheckRig(dir, { peak: 0, duration: 1 / 6 });
  const rigPath = join(dir, 'rig.json');
  const rig = JSON.parse(readFileSync(rigPath, 'utf8')) as {
    bones: Array<Record<string, unknown>>;
    slots: Array<{ name: string; bone: string; attachment: string }>;
    skins: Record<string, Record<string, Record<string, Record<string, unknown>>>>;
  };
  rig.bones.push({ name: 'carrier_ctl', parent: 'root', x: 0, y: 0 }, { name: 'carrier', parent: 'carrier_ctl', x: 0, y: 0 });
  rig.slots.find(slot => slot.name === 'back')!.bone = 'carrier';
  rig.slots.unshift({ name: 'rear', bone: 'root', attachment: 'rear' });
  const back = CHECK_PARTS[0];
  rig.skins.default.rear = { rear: { image: 'rear.png', x: -24 + back.x + back.w / 2,
    y: cropToSpineY(back.y + back.h / 2, 80) } };
  writeFileSync(rigPath, JSON.stringify(rig) + '\n');
  const parts = readParts(join(dir, 'parts.json'));
  parts.parts.unshift({ ...parts.parts[0], name: 'rear' });
  parts.motion_seams = [{ part: 'back', neighbour: 'front' }];
  for (const part of parts.parts) {
    const image = newRaster(part.w, part.h);
    let opaque = 0;
    // The back's bottom is at crop y42; front starts at crop y40: two rows overlap.
    // Carrier translation +4 opens two rows over rear at peak; trough returns closed.
    for (let y = 2; y < part.h - 2; y++) for (let x = 2; x < part.w - 2; x++) {
      if ((part.name === 'back' && y >= 42) || (part.name === 'front' && y < 20)) continue;
      image.data.set([...(part.name === 'rear' ? REAR : FRONT), 255], (y * part.w + x) * 4);
      opaque++;
    }
    part.opaque_px = opaque;
    writePng(join(dir, 'images', part.name + '.png'), image);
    writePng(join(dir, 'parts', part.name + '.png'), image);
  }
  writeFileSync(join(dir, 'parts.json'), serializeParts(parts));
  const motionPath = join(dir, 'motion.json');
  const motion = JSON.parse(readFileSync(motionPath, 'utf8')) as {
    animations: { idle: { tracks: unknown[] } };
  };
  motion.animations.idle.tracks.push({ bone: 'carrier_ctl', property: 'translatey',
    keys: [{ t: 0, v: [0] }, { t: 1 / 12, v: [4] }, { t: 1 / 6, v: [0] }] });
  writeFileSync(motionPath, JSON.stringify(motion) + '\n');
}

function runBehindSeamIntegrationChecks(dir: string, say: Say, rigc: RigcRunner): void {
  const input = join(dir, 'input');
  writeBehindSeamCheckRig(input);
  const before = ['rig.json', 'motion.json', 'parts.json'].map(name => readFileSync(join(input, name), 'utf8'));
  const requirement = (name: string, behind?: BehindSeams): string => {
    const path = join(dir, name + '.json');
    writeFileSync(path, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [],
      ...(behind === undefined ? {} : { behind_seams: behind }) }) + '\n');
    return path;
  };
  const run = (name: string, requirements?: string) => {
    const lines: string[] = [], calls: string[] = [];
    const out = join(dir, name);
    const report = checkStage({ rig: input, out, noExtremes: true,
      ...(requirements === undefined ? {} : { requirements }) }, args => {
      calls.push(args[0]);
      return rigc(args);
    }, 'fixture-rigc', line => lines.push(line));
    const figures = JSON.parse(readFileSync(join(out, 'check.json'), 'utf8')) as Record<string, unknown>;
    return { report, figures, lines, calls };
  };
  const undeclared = run('undeclared');
  const empty = run('empty-requirements', requirement('empty'));
  const red = run('declared-mutant', requirement('declared', { threshold: 0 }));
  const block = red.figures[BEHIND_SEAM_LINE] as BehindSeamsMeasured | undefined;
  say('BHS40_ACTUAL_CHECK_STAGE_CONNECTS_READER_STOCK_DETECTOR_AND_REQUIRED_FAILURE',
    block?.status === 'FAIL' && block.pairs.some(pair => pair.motion_opened.max_px > 0 && pair.standing.max_px > 0) &&
      red.report.behindSeams !== null && equal(red.report.behindSeams, block) && red.figures.PASS === false &&
      red.report.problems.some(problem => problem.code === BEHIND_SEAM_CODE) &&
      red.lines.some(line => line.includes(BEHIND_SEAM_LINE) && line.includes('FAIL')) &&
      red.calls.includes('build') && red.calls.includes('render'),
    JSON.stringify({ reading: block === undefined ? null : summary(block),
      problems: red.report.problems.map(problem => problem.code), calls: red.calls }));
  const legacy = (figures: Record<string, unknown>) => {
    const { requirements: _requirements, [BEHIND_SEAM_LINE]: _behind, ...rest } = figures;
    return rest;
  };
  say('BHS41_NO_DECLARATION_OMITS_BLOCK_AND_PRESERVES_EXISTING_FIGURES',
    !Object.hasOwn(undeclared.figures, BEHIND_SEAM_LINE) && !Object.hasOwn(empty.figures, BEHIND_SEAM_LINE) &&
      equal(legacy(undeclared.figures), legacy(empty.figures)) &&
      !undeclared.report.problems.some(problem => problem.code === BEHIND_SEAM_CODE || problem.code === BEHIND_SEAM_UNMEASURED_CODE) &&
      !empty.report.problems.some(problem => problem.code === BEHIND_SEAM_CODE || problem.code === BEHIND_SEAM_UNMEASURED_CODE),
    JSON.stringify({ absent: !Object.hasOwn(undeclared.figures, BEHIND_SEAM_LINE),
      empty: !Object.hasOwn(empty.figures, BEHIND_SEAM_LINE), legacy_equal: equal(legacy(undeclared.figures), legacy(empty.figures)),
      before: undeclared.report.problems.map(problem => problem.code), after: empty.report.problems.map(problem => problem.code) }));
  say('BHS42_ACTUAL_CHECK_FIXTURE_INPUTS_ARE_NOT_REWRITTEN',
    before.every((bytes, i) => bytes === readFileSync(join(input, ['rig.json', 'motion.json', 'parts.json'][i]), 'utf8')),
    'Generated synthetic rig, motion and part records retained byte for byte through three actual checkStage calls.');
}

export function runBehindSeamChecks(dir: string, say: Say, rigc: RigcRunner): void {
  mkdirSync(dir, { recursive: true });
  runBehindSeamFixtureChecks(say);
  runBehindSeamPrimitiveChecks(say);
  runBehindSeamRequirementChecks(dir, say);
  runBehindSeamIntegrationChecks(join(dir, 'pipeline'), say, rigc);
}
