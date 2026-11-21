/** #1314: analytic block fixtures; all sampling belongs to core's rasterizer. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { Plate, type RGBA } from '@rig-c/core/plate';
import { pageFor, projector, rasterisePiece, renderFrame, type AttachmentRest, type Frame, type Piece } from '@rig-c/core/render-shared';
import { seamGridOf, seamsOf, setupCellReader, type SeamFrame, type SeamGrid, type SeamPair } from '@rig-c/core/seam';
import { BEHIND_SEAM_LINE, BEHIND_SEAM_CODE, BEHIND_SEAM_UNMEASURED_CODE,
  NO_PARTS_SETUP_STANDING_REASON, IDLE_STANDING_MOTION_READ_REASON, IDLE_STANDING_NO_ORACLE_REASON, CONTACT_MOTION_SUPPORT, CONTACT_LIMITATIONS,
  TURN_STANDING_MOTION_READ_REASON, TURN_STANDING_NO_ORACLE_REASON, behindSeamsProblems,
  measureBehindSeamFrames, measureBehindSeams, behindSeamLines, BEHIND_SAMPLE_CAP, evenlySpaced, standingWorse, behindTurnPlan, behindTurnAnimations, behindTurnAnimationName, type BehindSeams, type BehindSeamsFramesInput,
  type BehindSeamsStockPair, type BehindSeamsCount, type BehindSeamsMeasured, type BehindSeamsFrame } from '../src/behindseams.ts';
import { officialRenderer, type RigcRunner } from '../src/check.ts';
import { PartsError, type Problem } from '../src/errors.ts';
import { readRequirements } from '../src/requirements.ts';
import { checkStage } from '../src/build.ts';
import { CHECK_PARTS, writeCheckRig } from '../fixtures/checkrig.ts';
import { cropToSpineY } from '../src/coords.ts';
import { CHECK_ROW_FAMILY, serializeCheckRows } from '../src/checkrow.ts';
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
  recomposite?: SeamFrame | null;
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

function frame(pieces: readonly Piece[], index: number): SeamFrame {
  return { index, time: index / 12, pieces: [...pieces], attachments: pieces.map(piece => ({
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

/** By hand from {@link behindAmbiguousFixture} (issue #1405): one one-cell row corridor per
 * ambiguous row, each with one ambiguous endpoint cell at world x 3.5 (left) or 5.5 (right);
 * the top row (world y 3.5) is first in scan order; alpha is 96 (owner 0) or 255 (owner 3). */
function ambiguousFixtureReason(owner: 0 | 3, x: number, rows: number): string {
  const alpha = owner === 0 ? 96 : 255;
  return `standing endpoints include ambiguous half-alpha owners: ${rows} unread corridor(s), ${rows} cell(s); ` +
    `${owner === 0 ? 'neither "a" nor "b" reaches' : 'both "a" and "b" reach'} 128/255 at ${rows} endpoint cell(s), ` +
    `first at world (${x}, 3.5) ("a" ${alpha}/255, "b" ${alpha}/255); each endpoint requires exactly one member at 128/255 or more; unread corridors are not zero`;
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

/** Closed-gap recomposite over the fixture canvas: any rear colour exposed in a planted setup gap differs from FRONT. */
const CLOSED_RECOMPOSITE_PAGE = 'fixture:closed-recomposite';
const CLOSED_RECOMPOSITE_FRAME: Frame = asFrame(frame([{ ...rectangle('recomposite', -8, -8, 64, 32), page: CLOSED_RECOMPOSITE_PAGE }], 0));

function inputOf(input: BehindSeamFixture): BehindSeamsFramesInput {
  const recomposite = input.recomposite === undefined ? CLOSED_RECOMPOSITE_FRAME : input.recomposite === null ? null : asFrame(input.recomposite);
  const pages = input.recomposite === undefined ? new Map([...input.pages, [CLOSED_RECOMPOSITE_PAGE, plate(64, 32, FRONT)]]) : input.pages;
  return { pairs: [{ pair: 'a|b', a: 'a', b: 'b', declared: ['synthetic explicit seam'] }],
    setup: asFrame(input.setup), idle: input.frames.map(asFrame), rest: input.rest,
    pages, stock: stockOf(input), fps: 12, recomposite };
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
      closed.pair.setup?.standing.status === 'PASS' && closed.pair.setup.standing.px === 0 &&
      closed.pair.motion_opened.status === 'PASS' && closed.pair.motion_opened.max_px === 0 &&
      closed.pair.standing.status === 'SKIP' && closed.pair.standing.reason === IDLE_STANDING_MOTION_READ_REASON &&
      closed.pair.standing.max_px === 0,
    brief(closed));
  for (const gap of [1, 2]) {
    const read = measured(behindStandingFixture({ gap }));
    const plantedMatching = measured(behindStandingFixture({ gap }), { threshold: 0 },
      { recomposite: asFrame(behindStandingFixture({ gap }).setup) });
    say(`BHS07_STANDING_LINE_COUNTS_SETUP_IDLE_AND_TROUGH[${gap}]`,
      counts(read.pair?.setup?.standing, 4 * gap) && read.pair.setup!.standing.status === 'FAIL' &&
        read.pair.setup!.standing.max_spatial_run_cells === 4 &&
        read.pair.frames.every(row => row.standing.status === 'SKIP' && row.standing.reason === IDLE_STANDING_NO_ORACLE_REASON && row.standing.px === 0) &&
        read.pair.standing.status === 'SKIP' && read.pair.standing.reason === IDLE_STANDING_NO_ORACLE_REASON &&
        read.pair.standing.max_px === 0 && read.pair.motion_opened.status === 'SKIP' &&
        read.problems.some(p => p.code === BEHIND_SEAM_CODE && p.object === 'pair "a|b" setup standing' && p.detail.includes(`setup (${4 * gap} cells)`)) &&
        read.reading.unmeasured.length > 0 && read.reading.status !== 'PASS' &&
        plantedMatching.pair.setup!.standing.px === 0, brief(read));
  }
  const narrowSetup = measured(behindStandingFixture({ gap: 1 }));
  const wideSetup = measured(behindStandingFixture({ gap: 2 }));
  say('BHS08_WIDENING_RETAINS_REST_VISIBLE_BASELINE_AND_SEPARATE_SPATIAL_RUN',
    counts(narrowSetup.pair?.setup?.standing, 4) && counts(wideSetup.pair?.setup?.standing, 8) &&
      narrowSetup.pair.setup!.standing.max_spatial_run_cells === 4 &&
      wideSetup.pair.setup!.standing.max_spatial_run_cells === 4 &&
      equal(narrowSetup.pair.setup!.standing.box, [4, 0, 5, 4]) &&
      equal(wideSetup.pair.setup!.standing.box, [4, 0, 6, 4]) &&
      wideSetup.pair.standing.status === 'SKIP' && wideSetup.pair.standing.reason === IDLE_STANDING_NO_ORACLE_REASON,
    brief(narrowSetup, wideSetup));
  // Issue #1409: the gap-0 pair touches at setup with no overlap band, so motion_opened reads its transported contact edges
  // (4 rows, nothing moves: 0 cells) and the line is PASS. plantNoContact withholds that support: the former named HOLE.
  const touching = measured(behindStandingFixture({ gap: 0 }));
  const touchingNoContact = measured(behindStandingFixture({ gap: 0 }), { threshold: 0 }, { plantNoContact: true });
  say('BHS09_ZERO_LENGTH_BRACKET_IS_CLOSED_SUPPORT_NOT_A_HOLE',
    touching.pair?.setup?.standing.status === 'PASS' && touching.pair.setup.standing.boundary_cells > 0 &&
      touching.pair.setup.standing.px === 0 && !touching.reading.unmeasured.some(u => u.frame === 'setup') &&
      touching.pair.standing.status === 'SKIP' && touching.pair.standing.reason === IDLE_STANDING_MOTION_READ_REASON &&
      touching.pair.frames.every(row => row.standing.status === 'SKIP' && row.standing.reason === IDLE_STANDING_MOTION_READ_REASON && row.standing.px === 0) &&
      touching.pair.motion_opened.status === 'PASS' && touching.pair.motion_support === CONTACT_MOTION_SUPPORT &&
      touching.reading.status === 'PASS' && touching.problems.length === 0 &&
      touchingNoContact.pair.motion_opened.status === 'SKIP' && touchingNoContact.reading.status !== 'PASS' &&
      touchingNoContact.pair.standing.reason === IDLE_STANDING_NO_ORACLE_REASON && touchingNoContact.pair.motion_support === undefined,
    brief(touching, touchingNoContact));
  const unsupported = measured(behindNoSupportFixture());
  say('BHS10_NO_BRACKET_SUPPORT_IS_UNMEASURED_NOT_CLOSED',
    unsupported.pair?.setup?.standing.status === 'SKIP' && unsupported.pair.setup.standing.boundary_cells === 0 &&
      unsupported.reading.status !== 'PASS' &&
      unsupported.reading.unmeasured.some(u => u.frame === 'setup' && u.reason.includes('no A/B boundary support was measured')) &&
      unsupported.problems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE && problem.object === 'a|b (setup)'),
    brief(unsupported));
  for (const alpha of [1, 32, 64, 127]) {
    const read = measured(behindStandingFixture({ gap: 0, rear: FRONT, edgeAlpha: alpha }));
    const row = read.pair?.setup;
    say(`BHS11_IDENTICAL_STRAIGHT_RGB_REAR_NEVER_FIRES_ACROSS_ALPHA_RAMPS[${alpha}]`,
      row !== null && row !== undefined && row.standing.status === 'PASS' &&
        row.standing.geometric_px === 8 && row.standing.raw_px === 0 && row.standing.px === 0 &&
        row.standing.samples.length === 8 && row.standing.samples.every(sample =>
          sample.rear_weight > 0 && sample.rear_weight < 1 && equal(sample.rear_rgb, FRONT) &&
          equal(sample.distances, [0, 0]) && !sample.counted), brief(read));
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
      counts(read.pair?.setup?.standing, row.px) &&
        read.pair.setup!.standing.status === (row.px === 0 ? 'PASS' : 'FAIL') &&
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
  const setupAllowed = measured(behindStandingFixture(), { threshold: 0, allowance: 4 });
  const setupTooSmall = measured(behindStandingFixture(), { threshold: 0, allowance: 3 });
  say('BHS15_ALLOWANCE_EQUALITY_PASSES_AND_ONE_CELL_LESS_FAILS_BOTH_HALVES',
    allowed.reading.status === 'PASS' && allowed.problems.length === 0 &&
      allowed.pair.motion_opened.max_px === 12 &&
      tooSmall.pair.motion_opened.status === 'FAIL' &&
      tooSmall.problems.some(problem => problem.code === BEHIND_SEAM_CODE && problem.object === 'pair "a|b" motion_opened') &&
      setupAllowed.pair.setup?.standing.status === 'PASS' && setupAllowed.pair.setup.standing.px === 4 &&
      !setupAllowed.problems.some(problem => problem.code === BEHIND_SEAM_CODE) &&
      setupTooSmall.pair.setup?.standing.status === 'FAIL' &&
      setupTooSmall.problems.some(problem => problem.code === BEHIND_SEAM_CODE && problem.object === 'pair "a|b" setup standing'),
    brief(allowed, tooSmall, setupAllowed, setupTooSmall));
  const override = measured(moving, { threshold: 255, allowance: 0,
    pairs: [{ part: 'b', neighbour: 'a', threshold: 0, allowance: 12 }] });
  const setupOverride = measured(behindStandingFixture(), { threshold: 255, allowance: 0,
    pairs: [{ part: 'b', neighbour: 'a', threshold: 0, allowance: 4 }] });
  say('BHS16_REVERSED_PAIR_OVERRIDE_REPLACES_RIG_THRESHOLD_AND_ALLOWANCE',
    override.reading.status === 'PASS' && override.pair.threshold === 0 && override.pair.allowance === 12 &&
      override.pair.motion_opened.max_px === 12 &&
      setupOverride.pair.threshold === 0 && setupOverride.pair.allowance === 4 &&
      setupOverride.pair.setup?.standing.status === 'PASS' && setupOverride.pair.setup.standing.px === 4,
    brief(override, setupOverride));
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
  const orderBase = behindOrderFixture();
  const ordered = measured(orderBase);
  const orderedIntervening = measured({ ...orderBase, setup: orderBase.frames[1] });
  const orderedFront = measured({ ...orderBase, setup: orderBase.frames[2] });
  say('BHS19_BEHIND_SET_USES_EACH_FRAMES_DRAW_ORDER',
    equal(ordered.pair?.frames.map(frame => frame.behind_slots), [['rear'], [], []]) &&
      equal([ordered, orderedIntervening, orderedFront].map(r => r.pair.setup?.behind_slots), [['rear'], [], []]) &&
      ordered.pair.setup?.standing.px === 4 &&
      [orderedIntervening, orderedFront].every(r => r.pair.setup?.standing.geometric_px === 0 &&
        r.reading.unmeasured.some(u => u.frame === 'setup' && u.reason.includes('no eligible slot'))) &&
      ordered.reading.unmeasured.length > 0 &&
      ordered.reading.status !== 'PASS', brief(ordered, orderedIntervening, orderedFront));
  const covered = measured(behindStandingFixture({ occluderAlpha: 255 }));
  const partial = measured(behindStandingFixture({ occluderAlpha: 128 }));
  say('BHS20_OPAQUE_LATER_OCCLUDER_REMOVES_REAR_PARTIAL_ALPHA_DOES_NOT',
    covered.pair?.setup?.standing.geometric_px === 0 && covered.pair.setup.standing.px === 0 &&
      partial.pair.setup?.standing.geometric_px === 4 && partial.pair.setup.standing.px === 4 &&
      partial.pair.setup.standing.samples.every(sample => Math.abs(sample.rear_weight - 127 / 255) <= Number.EPSILON), brief(covered, partial));
  const cross = measured(behindCrossFixture());
  say('BHS21_ROW_AND_COLUMN_CORRIDORS_COUNT_THE_CROSS_CENTRE_ONCE',
    counts(cross.pair?.setup?.standing, 1) && cross.pair.setup!.standing.samples.length === 1 &&
      cross.pair.setup!.standing.status === 'FAIL', brief(cross));
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
      fragmentsRead.pair.setup!.standing.status === 'FAIL', brief(fragmentsRead));

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
  const standingUnallowed = measured(behindStandingFixture(), { threshold: 0, allowance: 3,
    pairs: [{ part: 'a', neighbour: 'b', allowance: 3 }] });
  say('BHS37_PAIR_ALLOWANCE_PASSES_STANDING_WITHOUT_CERTIFYING_UNREAD_MOTION',
    standingAllowed.pair?.setup?.standing.status === 'PASS' && standingAllowed.pair.setup.standing.px === 4 &&
      standingAllowed.pair.allowance === 4 && standingAllowed.pair.standing.status === 'SKIP' &&
      standingAllowed.pair.standing.reason === IDLE_STANDING_NO_ORACLE_REASON &&
      standingAllowed.pair.motion_opened.status === 'SKIP' &&
      standingAllowed.reading.status === 'FAIL' &&
      !standingAllowed.problems.some(problem => problem.code === BEHIND_SEAM_CODE) &&
      standingAllowed.problems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE) &&
      standingUnallowed.pair?.setup?.standing.status === 'FAIL' &&
      standingUnallowed.problems.some(problem => problem.code === BEHIND_SEAM_CODE), brief(standingAllowed, standingUnallowed));

  const distinctSetup = behindStandingFixture();
  // Idle frame zero is widened, but setup keeps the original one-cell line.
  distinctSetup.frames[0] = frame(distinctSetup.frames[0].pieces.map(piece => piece.slot === 'b' ? shifted(piece, 1, 0) : piece), 0);
  const separate = measured(distinctSetup);
  const plantedFrameZeroSetup = measured({ ...distinctSetup, setup: distinctSetup.frames[0] });
  say('BHS38_AUTHORED_SETUP_IS_NOT_REPLACED_BY_IDLE_FRAME_ZERO',
    counts(separate.pair?.setup?.standing, 4) && counts(plantedFrameZeroSetup.pair?.setup?.standing, 8) &&
      separate.pair.frames[0].standing.status === 'SKIP' &&
      separate.pair.frames[0].standing.reason === IDLE_STANDING_NO_ORACLE_REASON, brief(separate, plantedFrameZeroSetup));

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
  const mixedSetup = localised.pair.setup!;
  say('BHS44_MIXED_UNREAD_CORRIDOR_RETAINS_MEASURED_FAILURE',
    mixedSetup.standing.status === 'FAIL' && mixedSetup.standing.px === 3 &&
      mixedSetup.standing.geometric_px === 3 && mixedSetup.standing.raw_px === 3 && mixedSetup.standing.samples.length === 3 &&
      mixedSetup.standing.unread_cells === 1 && mixedSetup.standing.unread_corridors?.length === 1 &&
      localised.pair.standing.status === 'SKIP' && localised.pair.standing.reason === IDLE_STANDING_MOTION_READ_REASON &&
      localised.pair.standing.max_px === 0 &&
      localised.pair.frames.every(row => row.motion_opened.status === 'PASS' && row.standing.status === 'SKIP' && row.standing.reason === IDLE_STANDING_MOTION_READ_REASON) &&
      localised.pair.sampled_frames === 3 && localised.pair.read_frames === 3 && localised.pair.unmeasured_frames === 0 &&
      localised.reading.status === 'FAIL' &&
      localised.problems.some(problem => problem.code === BEHIND_SEAM_CODE && problem.object === 'pair "a|b" setup standing' && problem.detail.includes('setup (3 cells)')) &&
      localised.problems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE && problem.object === 'a|b (setup)') &&
      localised.reading.unmeasured.some(row => row.frame === 'setup' && row.reason.includes('ambiguous half-alpha owners')),
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
    const row = onlyUnread.pair.setup!;
    const setupSkipLines = onlyUnread.lines.filter(line => line.includes('pair "a|b" setup SKIP') && line.includes('unread corridors are not zero'));
    say(`BHS46_ONLY_AMBIGUOUS_OWNER_IS_UNREAD_WITHOUT_INFERENCE[${owner},${side}]`,
      row.standing.status === 'SKIP' && row.standing.px === 0 && row.standing.samples.length === 0 &&
        row.standing.unread_cells === 4 && row.standing.unread_corridors?.length === 4 &&
        row.standing.unread_corridors.every(corridor => corridor.axis === 'horizontal' && corridor.cell_count === 1 &&
          equal(corridor.endpoints.map(endpoint => endpoint[4]), expectedOwners)) &&
        equal(row.standing.unread_corridors.map(corridor => corridor.cells), [[[4.5, 3.5]], [[4.5, 2.5]], [[4.5, 1.5]], [[4.5, 0.5]]]) &&
        onlyUnread.pair.standing.status === 'SKIP' &&
        onlyUnread.reading.status === 'FAIL' && onlyUnread.problems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE && problem.object === 'a|b (setup)') &&
        !onlyUnread.problems.some(problem => problem.code === BEHIND_SEAM_CODE) &&
        setupSkipLines.length === 1 &&
        setupSkipLines[0] === `${BEHIND_SEAM_LINE}: pair "a|b" setup SKIP — HOLE: ${ambiguousFixtureReason(owner, side === 'left' ? 3.5 : 5.5, 4)}`,
      JSON.stringify({ owner, side, reading: summary(onlyUnread.reading), unread: onlyUnread.pair.setup!.standing.unread_corridors, setupSkipLines }));
  }

  const withinBarMixed = measured(ambiguousMixed, { threshold: 40, allowance: 3 });
  const fullyUnread = measured(behindAmbiguousFixture(3, 'left', false), { threshold: 40 });
  const unmeasuredSetupLine = (line: string): boolean => line.includes('pair "a|b" setup ') && line.includes('HOLE:');
  const setupLine = (line: string): boolean => line.includes('pair "a|b" setup ');
  const mixedLogVerdict = (failLines: readonly string[], allowedLines: readonly string[], unreadLines: readonly string[]): boolean => {
    const failFrames = failLines.filter(unmeasuredSetupLine);
    const allowedFrames = allowedLines.filter(unmeasuredSetupLine);
    const unreadFrames = unreadLines.filter(unmeasuredSetupLine);
    return failFrames.length === 1 && allowedFrames.length === 1 && unreadFrames.length === 1 &&
      !failFrames[0].includes('SKIP') &&
      failFrames[0] === `${BEHIND_SEAM_LINE}: pair "a|b" setup standing FAIL, 3 cells — unread corridors: 1 (cells 1); HOLE: ${ambiguousFixtureReason(3, 3.5, 1)}` &&
      !allowedFrames[0].includes('SKIP') &&
      allowedFrames[0] === `${BEHIND_SEAM_LINE}: pair "a|b" setup standing 3 cells — unread corridors: 1 (cells 1); HOLE: ${ambiguousFixtureReason(3, 3.5, 1)}` &&
      failLines.filter(setupLine).every(line => !line.includes('SKIP') && line.includes('3 cells')) &&
      allowedLines.filter(setupLine).every(line => !line.includes('SKIP') && line.includes('3 cells')) &&
      unreadFrames[0] === `${BEHIND_SEAM_LINE}: pair "a|b" setup SKIP — HOLE: ${ambiguousFixtureReason(3, 3.5, 4)}`;
  };
  const oldTextMutant = localised.reading.unmeasured.map(u =>
    `${BEHIND_SEAM_LINE}: ${u.pair === null ? 'rig' : `pair "${u.pair}"`} ${u.frame} SKIP — ${u.reason}`);
  const fixtureReadings = [closed, opened, touching, cross, localised, withinBarMixed, fullyUnread];
  const jsonBefore = fixtureReadings.map(result => JSON.stringify(result.reading));
  const jsonAfter = fixtureReadings.map(result => {
    behindSeamLines(result.reading);
    return JSON.stringify(result.reading);
  });
  say('BHS50_MIXED_FRAME_LOG_LINE_REPORTS_COUNTED_STATUS_AND_UNREAD_CORRIDOR_CLAUSE',
    mixedLogVerdict(localised.lines, withinBarMixed.lines, fullyUnread.lines) &&
      !mixedLogVerdict(oldTextMutant, withinBarMixed.lines, fullyUnread.lines) &&
      !mixedLogVerdict(localised.lines, oldTextMutant, fullyUnread.lines) &&
      equal(jsonBefore, jsonAfter),
    JSON.stringify({ failSetup: localised.lines.find(unmeasuredSetupLine),
      allowedSetup: withinBarMixed.lines.find(unmeasuredSetupLine),
      unreadSetup: fullyUnread.lines.find(unmeasuredSetupLine),
      mutantRejected: !mixedLogVerdict(oldTextMutant, withinBarMixed.lines, fullyUnread.lines),
      jsonUnchanged: equal(jsonBefore, jsonAfter) }));

  const crossUnread = behindCrossFixture();
  crossUnread.pages.get('b')!.set(1, 2, [...FRONT, 255]);
  crossUnread.pages.get('b')!.set(2, 1, [...FRONT, 255]);
  const unreadCross = measured(crossUnread, { threshold: 40 });
  const crossRow = unreadCross.pair.setup!;
  say('BHS47_CROSS_AXIS_UNREAD_CELL_UNION_COUNTS_CENTRE_ONCE',
    crossRow.standing.status === 'SKIP' &&
      crossRow.standing.px === 0 && crossRow.standing.unread_cells === 1 && crossRow.standing.unread_corridors?.length === 2 &&
      equal(crossRow.standing.unread_corridors.map(corridor => [corridor.axis, corridor.cell_count, corridor.cells]),
        [['horizontal', 1, [[2.5, 2.5]]], ['vertical', 1, [[2.5, 2.5]]]]) &&
      equal(crossRow.standing.unread_corridors.map(corridor => corridor.endpoints),
        [[[2, 3, 1.5, 2.5, 3], [4, 3, 3.5, 2.5, 2]], [[3, 2, 2.5, 3.5, 3], [3, 4, 2.5, 1.5, 2]]]) &&
      unreadCross.reading.status === 'FAIL' && unreadCross.problems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE && problem.object === 'a|b (setup)'),
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
  const underflowSetup = numericUnread.pair.setup!;
  say('BHS49_NUMERIC_REAR_UNDERFLOW_REMAINS_UNMEASURED_WITHOUT_ENDPOINT_AMBIGUITY',
    underflowSetup.standing.status === 'SKIP' && underflowSetup.standing.px === 0 &&
      !Object.hasOwn(underflowSetup.standing, 'unread_cells') && !Object.hasOwn(underflowSetup.standing, 'unread_corridors') &&
      numericUnread.pair.read_frames === 0 && numericUnread.pair.unmeasured_frames === 3 &&
      numericUnread.reading.status === 'FAIL' && numericUnread.problems.some(problem => problem.code === BEHIND_SEAM_UNMEASURED_CODE &&
        problem.object === 'a|b (setup)' && problem.detail.includes('underflowed its numeric colour weight')),
    brief(numericUnread));
}

function runBehindSeamRequirementChecks(dir: string, say: Say): void {
  const write = (name: string, value?: unknown): string => {
    const path = join(dir, name + '.json');
    writeFileSync(path, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [],
      ...(value === undefined ? {} : { behind_seams: value }) }) + '\n');
    return path;
  };
  const declaration: BehindSeams = { threshold: 10, allowance: 12, turn: true, pairs: [{ part: 'a', neighbour: 'b', threshold: 11, allowance: 4 }] };
  const read = readRequirements(write('declared', declaration));
  const again = readRequirements(write('roundtrip', read.behind_seams));
  say('BHS27_REAL_REQUIREMENTS_READER_PRESERVES_OPTIONAL_BLOCK_AND_OVERRIDES',
    readRequirements(write('absent')).behind_seams === undefined && equal(read.behind_seams, declaration) &&
      equal(again.behind_seams, declaration) && equal(readRequirements(write('missing-t', {})).behind_seams, {}),
    JSON.stringify({ present: read.behind_seams, roundtrip: again.behind_seams }));
  const invalid: Array<{ label: string; value: unknown }> = [
    { label: 'null', value: null }, { label: 'number', value: 1 }, { label: 'array', value: [] },
    ...[false, 0, {}, { yaw: [-15, 15] }].map(turn => ({ label: 'turn-' + JSON.stringify(turn), value: { turn } })),
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

/** A three-block variant of the established check fixture, generated only in this suite's temp directory.
 * When asymmetricSetupGap is true, images/back.png leaves a 2-row setup gap (y 38..39) across 10 overlap columns
 * (x 16..25, crop sx 20..29 -> 20 geometric cells) while keeping a 2x2 setup overlap on x 26..27 (crop sx 30..31);
 * parts/back.png closes the left 6 of those gap columns (x 16..21, crop sx 20..25 -> 12 counted cells, world box
 * [-4, 40, 2, 42]) and leaves the right 4 gap columns (x 22..25, crop sx 26..29 -> 8 excused cells) open in the
 * flat recomposite. */
/** contactOnly (issue #1409): back stops at crop row 40 where front starts, so the pair touches with no overlap band. */
export function writeBehindSeamCheckRig(dir: string, asymmetricSetupGap = true, contactOnly = false): void {
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
    const rigImage = newRaster(part.w, part.h);
    const partImage = newRaster(part.w, part.h);
    let opaque = 0;
    // The back's bottom is at crop y42; front starts at crop y40: two rows overlap.
    // Carrier translation +4 opens two rows over rear at peak; trough returns closed.
    for (let y = 2; y < part.h - 2; y++) for (let x = 2; x < part.w - 2; x++) {
      if ((part.name === 'back' && y >= (contactOnly ? 40 : 42)) || (part.name === 'front' && y < 20)) continue;
      const rgb = part.name === 'rear' ? REAR : FRONT;
      const inSetupGap = asymmetricSetupGap && part.name === 'back' && y >= 38 && x >= 16 && x < 26;
      const inRecompositeGap = asymmetricSetupGap && part.name === 'back' && y >= 38 && x >= 22 && x < 26;
      if (!inSetupGap) rigImage.data.set([...rgb, 255], (y * part.w + x) * 4);
      if (!inRecompositeGap) {
        partImage.data.set([...rgb, 255], (y * part.w + x) * 4);
        opaque++;
      }
    }
    part.opaque_px = opaque;
    writePng(join(dir, 'images', part.name + '.png'), rigImage);
    writePng(join(dir, 'parts', part.name + '.png'), partImage);
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

/** Bounded diagnostics: full native samples remain in check.json, not one case line. */
function turnBrief(turn: BehindSeamsMeasured['turn']) {
  return turn === undefined ? null : { status: turn.status, poses: turn.poses, unmeasured: turn.unmeasured,
    pairs: turn.pairs.map(p => ({ pair: p.pair, sampled: p.sampled_poses, read: p.read_poses, unread: p.unmeasured_poses,
      motion: p.motion_opened, standing: p.standing,
      frames: p.frames.map(f => ({ pose: f.pose, motion: { status: f.motion_opened.status, px: f.motion_opened.px },
        standing: { status: f.standing.status, px: f.standing.px, unread_cells: f.standing.unread_cells } })) })) };
}

/** Fixed endpoints and full corners, stated before any detector call. */
export function runBehindTurnPrimitiveChecks(say: Say): void {
  const rig = {
    bones: ['yaw_dial', 'pitch_dial', 'torso_control'].map(name => ({ name, rotation: 0 })),
    constraints: [['yaw', 'turn', 'yaw_dial', 15], ['pitch', 'tilt', 'pitch_dial', 12], ['torso', 'body_turn', 'torso_control', 10]].map(([name, animation, bone, band]) =>
      ({ type: 'slider', name, animation, bone, property: 'rotate', local: true, from: -Number(band), max: Number(band) })),
  };
  const plan = behindTurnPlan(rig);
  const expected = [
    [-15, 0, 0], [15, 0, 0], [0, -12, 0], [0, 12, 0], [0, 0, -10], [0, 0, 10],
    [-15, -12, -10], [-15, -12, 10], [-15, 12, -10], [-15, 12, 10],
    [15, -12, -10], [15, -12, 10], [15, 12, -10], [15, 12, 10],
  ];
  say('BHS51_TURN_PLAN_IS_DECLARED_ENDPOINTS_AND_FULL_CORNERS',
    plan.reason === undefined && equal(plan.poses.map(p => Object.values(p.values)), expected) && new Set(plan.poses.map(p => p.name)).size === 14 &&
      behindTurnPlan({ ...rig, constraints: rig.constraints.slice(0, 1) }).poses.length === 2,
    JSON.stringify({ poses: plan.poses, oneDial: behindTurnPlan({ ...rig, constraints: rig.constraints.slice(0, 1) }).poses }));
  const legacy = behindTurnPlan({ bones: [{ name: 'turn', x: 0 }] });
  const invalid = behindTurnPlan({ ...rig, constraints: [{ ...rig.constraints[0], max: undefined }] });
  say('BHS52_TURN_NEVER_INVENTS_MISSING_DIAL_RANGES',
    legacy.poses.length === 0 && legacy.reason?.includes('legacy dial "turn"') === true && invalid.poses.length === 0 && invalid.reason?.includes('finite increasing') === true && behindTurnPlan({}).poses.length === 0,
    JSON.stringify({ legacy, invalid, absent: behindTurnPlan({}) }));
  const moving = behindMotionFixture(), idle = { ...moving, frames: moving.frames.map(() => moving.setup) };
  idle.frames = idle.frames.map((f, index) => ({ ...f, index, time: index / 12 }));
  const native = stockOf(moving);
  // Exactly two declared endpoints. Idle stays closed; the positive endpoint alone opens 12 cells.
  const poses = [{ name: 'yaw_dial=-15', values: { yaw_dial: -15 } }, { name: 'yaw_dial=15', values: { yaw_dial: 15 } }];
  const frames = [moving.frames[0], moving.frames[1]].map((f, index) => ({ ...asFrame(f), index, time: 0 }));
  const turn: NonNullable<BehindSeamsFramesInput['turn']> = { poses, frames, setup: asFrame(moving.setup), rest: moving.rest,
    stock: native.map(s => ({ ...s, frames: 2, drawn: 2, banded: 2, gapCovered: s.gapCovered.map(hit => ({ ...hit, time: 0 })) })) };
  const base = measured(idle), red = measured(idle, { threshold: 0, turn: true }, { turn });
  say('BHS53_TURN_ONLY_SEAM_FAIL_LEAVES_IDLE_AND_SETUP_UNCHANGED',
    base.reading.status === 'PASS' && red.reading.status === 'FAIL' && equal(red.reading.pairs, base.reading.pairs) &&
      red.reading.turn?.pairs[0].motion_opened.status === 'FAIL' && red.reading.turn.pairs[0].motion_opened.max_px === 12 &&
      red.reading.turn.pairs[0].standing.status === 'SKIP' && red.reading.turn.pairs[0].standing.reason === TURN_STANDING_MOTION_READ_REASON &&
      red.reading.turn.pairs[0].standing.max_px === 0 &&
      red.reading.turn.pairs[0].frames.every(f => f.standing.status === 'SKIP' && f.standing.reason === TURN_STANDING_MOTION_READ_REASON &&
        f.standing.px === 0 && f.standing.box === null && f.standing.samples.length === 0 &&
        !Object.hasOwn(f.standing, 'unread_cells') && !Object.hasOwn(f.standing, 'unread_corridors')) &&
      red.reading.turn.pairs[0].sampled_poses === 2 && red.reading.turn.pairs[0].read_poses === 2 &&
      red.reading.turn.pairs[0].frames[1].pose === 'yaw_dial=15' && red.reading.turn.pairs[0].frames[1].motion_opened.px === 12 &&
      red.problems.some(p => p.code === BEHIND_SEAM_CODE && p.object === 'pair "a|b" turn yaw_dial=15 motion_opened') &&
      !red.problems.some(p => p.object.includes('turn') && p.object.endsWith('standing')) &&
      red.reading.turn.limitations === 'independent setup-reset turn endpoints and full range corners only; no sweep, idle motion, temporal spans or alternate skins; standing is not measured on turn poses, and motion_opened is the turn reading' &&
      red.lines.some(l => l.includes('turn yaw_dial=15') && l.includes(`standing SKIP (${TURN_STANDING_MOTION_READ_REASON}), 0 cells`)),
    JSON.stringify({ idle: base.reading.status, turn: turnBrief(red.reading.turn), codes: red.problems.map(p => p.code) }));
  const fixed = { ...turn, frames: frames.map((_, index) => ({ ...asFrame(moving.setup), index, time: 0 })),
    stock: turn.stock!.map(s => ({ ...s, gapCovered: [] })) };
  const green = measured(idle, { threshold: 0, turn: true }, { turn: fixed });
  const allowed = measured(idle, { threshold: 0, allowance: 12, turn: true }, { turn });
  say('BHS54_REPAIRED_TURN_AND_AUTHORED_ALLOWANCE_PASS', green.reading.status === 'PASS' && green.reading.turn?.status === 'PASS' &&
    allowed.reading.status === 'PASS' && allowed.reading.turn?.pairs[0].motion_opened.max_px === 12,
    JSON.stringify({ green: turnBrief(green.reading.turn), allowed: allowed.reading.turn?.status }));
  const dropped = measured(idle, { threshold: 0, turn: true }, { turn: { ...turn, frames: frames.slice(0, 1) } });
  const unread = measured(idle, { threshold: 0, turn: true }, { turn: { ...turn, stock: null } });
  const completeControl = (r: BehindSeamsMeasured): boolean => r.turn?.poses.length === 2 && r.turn.pairs[0]?.frames.length === 2 && r.turn.pairs[0].read_poses === 2;
  say('BHS55_SAMPLE_DROPPING_MUTANT_CANNOT_PASS_THE_CONTROL', completeControl(red.reading) && !completeControl(dropped.reading) &&
    dropped.reading.status === 'FAIL' && (dropped.reading.turn?.pairs[0].unmeasured_poses ?? 0) > 0 && dropped.problems.some(p => p.code === BEHIND_SEAM_UNMEASURED_CODE) &&
    unread.reading.status === 'FAIL' && unread.reading.turn?.pairs[0].motion_opened.status === 'SKIP',
    JSON.stringify({ dropped: turnBrief(dropped.reading.turn), unread: unread.reading.turn?.status, mutantRejected: !completeControl(dropped.reading) }));
  const missing = measured(idle, { threshold: 0, turn: true });
  const optional = measured(idle, { turn: true });
  say('BHS56_OPT_IN_WITH_NO_DIAL_PERSISTS_SKIP_AND_HOLE', missing.reading.turn?.status === 'SKIP' &&
    missing.reading.turn.unmeasured.some(u => u.frame === 'turn' && u.reason.startsWith('HOLE:')) &&
    missing.reading.status === 'FAIL' && missing.problems.some(p => p.code === BEHIND_SEAM_UNMEASURED_CODE) &&
    optional.reading.turn?.status === 'SKIP' && !optional.problems.some(p => p.code === BEHIND_SEAM_UNMEASURED_CODE),
    JSON.stringify({ required: missing.reading.turn, optional: optional.reading.turn }));
  say('BHS57_NO_OPT_IN_IGNORES_TURN_INPUT_BYTE_FOR_BYTE', JSON.stringify(base.reading) === JSON.stringify(measured(idle, { threshold: 0 }, { turn }).reading) &&
    !Object.hasOwn(base.reading, 'turn') && !base.lines.some(l => l.includes(': turn ')), 'No opt-in: identical serialized reading, no turn key or turn console rows.');
  const overrides: BehindSeams = { turn: true, pairs: [{ part: 'a', neighbour: 'b', threshold: 0 }] };
  const pairs = [...inputOf(idle).pairs, { pair: 'a|other', a: 'a', b: 'other', declared: ['explicit'] }];
  const overrideOnly = measured(idle, overrides, { turn: fixed, pairs });
  const overrideRed = measured(idle, overrides, { turn, pairs });
  say('BHS61_OVERRIDE_ONLY_T_DOES_NOT_MAKE_OPTIONAL_PAIR_HOLE_FAIL',
    overrideOnly.reading.turn?.pairs[0].motion_opened.status === 'PASS' &&
    overrideOnly.reading.turn.pairs[1].motion_opened.status === 'SKIP' &&
    overrideOnly.reading.turn.unmeasured.some(u => u.pair === 'a|other' && u.reason.startsWith('HOLE:')) &&
    overrideOnly.reading.turn.status === 'SKIP' && !overrideOnly.problems.some(p => p.code.startsWith('CHECK_BEHIND_PART_SEAMS')) &&
    overrideRed.reading.turn?.status === 'FAIL' && overrideRed.problems.some(p => p.code === BEHIND_SEAM_CODE),
    JSON.stringify({ positive: turnBrief(overrideOnly.reading.turn), problems: overrideOnly.problems, defect: overrideRed.reading.turn?.status }));
  const offsetRig = { bones: [{ name: 'yaw_dial', rotation: 2 }, { name: 'pitch_dial', x: 3 }, { name: 'body_yaw_dial', y: 4 }],
    constraints: ['rotate', 'x', 'y'].map((property, i) => ({ type: 'slider', name: String(i), bone: ['yaw_dial', 'pitch_dial', 'body_yaw_dial'][i], property, local: true, from: -5, max: 5 })) };
  const offsetPlan = behindTurnPlan(offsetRig), animations = behindTurnAnimations(offsetRig);
  say('BHS62_ONE_ANIMATION_PER_POSE_USES_PUBLIC_OFFSET_TIMELINE_SCHEMA',
    Object.keys(animations).length === offsetPlan.poses.length && equal(animations, behindTurnAnimations(offsetRig)) &&
    equal(Object.keys(animations), offsetPlan.poses.map(p => behindTurnAnimationName(p.name))) &&
    behindTurnAnimationName('a,b=1') !== behindTurnAnimationName('a/b=1') &&
    behindTurnAnimationName('\ud800') !== behindTurnAnimationName('\ufffd') &&
    /^[a-zA-Z0-9_]+$/.test(behindTurnAnimationName('a/b=1')) &&
    Object.values(animations).every((a, i) => a.duration === 0 && a.tracks.length === 3 &&
      equal(a.tracks.map(t => t.property), ['rotate', 'translatex', 'translatey']) &&
      a.tracks.every((t, d) => t.keys.length === 1 && t.keys[0].t === 0 && t.keys[0].v[0] + offsetPlan.dials[d].setup === offsetPlan.poses[i].values[t.bone])) &&
    Object.keys(behindTurnAnimations({})).length === 0,
    JSON.stringify({ names: Object.keys(animations), first: Object.values(animations)[0], setup: offsetPlan.dials.map(d => d.setup) }));
}

/** Real emitted slider constraints, consumed by rigc's own existing poser. */
export function writeBehindSeamTurnCheckRig(dir: string, repaired = false): void {
  writeBehindSeamCheckRig(dir, false);
  const rigPath = join(dir, 'rig.json'), motionPath = join(dir, 'motion.json');
  const rig = JSON.parse(readFileSync(rigPath, 'utf8')) as { bones: Array<Record<string, unknown>>; constraints?: Array<Record<string, unknown>> };
  const motion = JSON.parse(readFileSync(motionPath, 'utf8')) as { animations: Record<string, { duration: number; loop: boolean; tracks: Array<Record<string, unknown>> }> };
  motion.animations.idle.tracks = motion.animations.idle.tracks.filter(t => t.bone !== 'carrier_ctl');
  for (const [bone, animation, band] of [['yaw_dial', 'turn', 15], ['pitch_dial', 'tilt', 12], ['body_yaw_dial', 'body_turn', 10]] as const) {
    rig.bones.push({ name: bone, parent: 'root', x: 0, y: 0 });
    (rig.constraints ??= []).push({ type: 'slider', name: bone, bone, property: 'rotate', local: true,
      animation, from: -band, to: 0, scale: 1 / (2 * band), max: band, additive: true, mix: 1 });
    motion.animations[animation] = { duration: 1, loop: false, tracks: [{ bone: 'carrier_ctl', property: 'translatey',
      keys: [{ t: 0, v: [0] }, { t: 0.5, v: [0] }, { t: 1, v: [animation === 'turn' && !repaired ? 4 : 0] }] }] };
  }
  writeFileSync(rigPath, JSON.stringify(rig) + '\n');
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
  const run = (name: string, requirements?: string, refuseTurn = false) => {
    const lines: string[] = [], calls: string[] = [];
    const turnBuilds: Array<{ args: string[]; rig: Record<string, unknown>; motion: Record<string, unknown> }> = [];
    const out = join(dir, name);
    const report = checkStage({ rig: input, out, noExtremes: true,
      ...(requirements === undefined ? {} : { requirements }) }, args => {
      calls.push(args[0]);
      if (args[0] === 'build' && args.some(a => a.includes('_behind_seams_turn'))) {
        turnBuilds.push({ args: [...args], rig: JSON.parse(readFileSync(args[args.indexOf('--rig') + 1], 'utf8')) as Record<string, unknown>,
          motion: JSON.parse(readFileSync(args[args.indexOf('--motion') + 1], 'utf8')) as Record<string, unknown> });
        if (refuseTurn) return { status: 1, out: 'FAIL PLANTED_TURN_COPY_GATE: synthetic build refusal' };
      }
      return rigc(args);
    }, 'fixture-rigc', line => lines.push(line));
    const figures = JSON.parse(readFileSync(join(out, 'check.json'), 'utf8')) as Record<string, unknown>;
    return { report, figures, lines, calls, turnBuilds, turnScratchRemoved: !existsSync(join(out, '_behind_seams_turn')) };
  };
  const undeclared = run('undeclared');
  const empty = run('empty-requirements', requirement('empty'));
  const red = run('declared-mutant', requirement('declared', { threshold: 0 }));
  const block = red.figures[BEHIND_SEAM_LINE] as BehindSeamsMeasured | undefined;
  say('BHS40_ACTUAL_CHECK_STAGE_CONNECTS_READER_STOCK_DETECTOR_AND_REQUIRED_FAILURE',
    block?.status === 'FAIL' && block.pairs.some(pair => pair.motion_opened.max_px > 0 &&
      pair.setup?.standing.status === 'FAIL' && pair.setup.standing.px === 12 &&
      pair.setup.standing.geometric_px === 20 && pair.setup.standing.raw_px === 12 &&
      equal(pair.setup.standing.box?.map(v => Math.round(v)), [-4, 40, 2, 42]) &&
      pair.standing.status === 'SKIP' && pair.standing.reason === IDLE_STANDING_MOTION_READ_REASON && pair.standing.max_px === 0) &&
      red.report.behindSeams !== null && equal(red.report.behindSeams, block) && red.figures.PASS === false &&
      red.report.problems.some(problem => problem.code === BEHIND_SEAM_CODE && problem.object === 'pair "back|front" setup standing') &&
      red.report.problems.some(problem => problem.code === BEHIND_SEAM_CODE && problem.object === 'pair "back|front" motion_opened') &&
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
  const missingTurn = run('turn-no-dial', requirement('turn-no-dial', { threshold: 0, turn: true }));
  const missingBlock = missingTurn.figures[BEHIND_SEAM_LINE] as BehindSeamsMeasured;
  say('BHS58_CHECK_JSON_PERSISTS_NO_DIAL_SKIP_AND_REQUIRED_HOLE', missingBlock.turn?.status === 'SKIP' &&
    missingBlock.turn.unmeasured.some(u => u.reason.includes('no declared turn dial')) && missingTurn.figures.PASS === false &&
    missingTurn.report.problems.some(p => p.code === BEHIND_SEAM_UNMEASURED_CODE), JSON.stringify(missingBlock.turn));
  writeBehindSeamTurnCheckRig(input);
  const noOpt = run('turn-no-opt', requirement('turn-no-opt', { threshold: 0 }));
  const turned = run('turn-declared', requirement('turn-opt', { threshold: 0, turn: true }));
  const noOptBlock = noOpt.figures[BEHIND_SEAM_LINE] as BehindSeamsMeasured, turnedBlock = turned.figures[BEHIND_SEAM_LINE] as BehindSeamsMeasured;
  say('BHS59_ACTUAL_TURN_POSER_READS_ALL_ENDPOINTS_AND_CORNERS_WITH_IDLE_UNCHANGED',
    noOptBlock.status === 'PASS' && turnedBlock.status === 'FAIL' && equal(noOptBlock.pairs, turnedBlock.pairs) &&
      turnedBlock.turn?.poses.length === 14 && turnedBlock.turn.pairs[0].frames.length === 14 &&
      turnedBlock.turn.pairs[0].read_poses === 14 &&
      turnedBlock.turn.pairs[0].motion_opened.status === 'FAIL' && turnedBlock.turn.pairs[0].motion_opened.max_px === 22 &&
      turnedBlock.turn.pairs[0].standing.status === 'SKIP' && turnedBlock.turn.pairs[0].standing.reason === TURN_STANDING_MOTION_READ_REASON &&
      turnedBlock.turn.pairs[0].standing.max_px === 0 &&
      turnedBlock.turn.pairs[0].frames.every(f => f.standing.status === 'SKIP' && f.standing.reason === TURN_STANDING_MOTION_READ_REASON &&
        f.standing.px === 0 && f.standing.box === null && f.standing.samples.length === 0) &&
      turned.report.problems.some(p => p.code === BEHIND_SEAM_CODE && p.object.includes('yaw_dial=15') && p.object.endsWith('motion_opened')) &&
      !turned.report.problems.some(p => p.object.includes('turn') && p.object.endsWith('standing')),
    JSON.stringify({ idle: noOptBlock.status, turn: turnBrief(turnedBlock.turn), problems: turned.report.problems }));
  writeBehindSeamTurnCheckRig(input, true);
  const repaired = run('turn-repaired', requirement('turn-fixed', { threshold: 0, turn: true }));
  const repairedBlock = repaired.figures[BEHIND_SEAM_LINE] as BehindSeamsMeasured;
  say('BHS60_ACTUAL_TURN_POSER_REPAIRED_POSITIVE_CONTROL', repairedBlock.status === 'PASS' && repairedBlock.turn?.status === 'PASS' &&
    repairedBlock.turn.pairs[0].read_poses === 14 && repairedBlock.turn.pairs[0].motion_opened.max_px === 0 &&
    repairedBlock.turn.pairs[0].standing.status === 'SKIP' && repairedBlock.turn.pairs[0].standing.reason === TURN_STANDING_MOTION_READ_REASON &&
    repairedBlock.turn.pairs[0].standing.max_px === 0 && !repaired.report.problems.some(p => p.code === BEHIND_SEAM_CODE || p.code === BEHIND_SEAM_UNMEASURED_CODE),
    JSON.stringify({ turn: turnBrief(repairedBlock.turn), problems: repaired.report.problems }));
  const originalRig = JSON.parse(readFileSync(join(input, 'rig.json'), 'utf8')) as Record<string, unknown>;
  const originalMotion = JSON.parse(readFileSync(join(input, 'motion.json'), 'utf8')) as { animations: Record<string, unknown> };
  const copy = repaired.turnBuilds[0];
  const originalConstraints = originalRig.constraints;
  const copiedAnimations = copy?.motion.animations as Record<string, unknown> | undefined;
  say('BHS63_SINGLE_GATED_COPY_PRESERVES_SETUP_SLIDERS_PACK_AND_INPUTS',
    noOpt.turnBuilds.length === 0 && noOpt.turnScratchRemoved && repaired.turnBuilds.length === 1 && repaired.turnScratchRemoved &&
    copy !== undefined && copy.args[copy.args.indexOf('--profile') + 1] === 'rig-play' && copy.args.includes('--pack') &&
    copy.args.includes('--page-edges') && copy.args.includes('--pack-shape') && typeof copy.rig.images === 'string' && isAbsolute(copy.rig.images) &&
    equal({ ...copy.rig, images: originalRig.images }, originalRig) && equal(copy.rig.constraints, originalConstraints) &&
    copiedAnimations !== undefined && Object.entries(originalMotion.animations).every(([name, a]) => equal(copiedAnimations[name], a)) &&
    Object.keys(copiedAnimations).length === Object.keys(originalMotion.animations).length + 14 &&
    repairedBlock.turn!.pairs[0].frames.every(f => f.observed_values !== undefined && equal(Object.keys(f.observed_values), Object.keys(f.values!)) &&
      Object.keys(f.observed_values).every(b => Math.fround(f.observed_values![b]) === Math.fround(f.values![b])) && Object.keys(f.slider_times ?? {}).length === 3),
    JSON.stringify({ noOptBuilds: noOpt.turnBuilds.length, copies: repaired.turnBuilds.length, cleaned: repaired.turnScratchRemoved, args: copy?.args }));
  const refused = run('turn-copy-refused', requirement('turn-refused', { threshold: 0, turn: true }), true);
  const refusedBlock = refused.figures[BEHIND_SEAM_LINE] as BehindSeamsMeasured;
  say('BHS64_TURN_COPY_GATE_REFUSAL_IS_REQUIRED_HOLE_WITH_IDLE_RETAINED',
    refused.turnBuilds.length === 1 && refused.turnScratchRemoved && equal(refusedBlock.pairs, repairedBlock.pairs) &&
    refusedBlock.turn?.status === 'FAIL' && refusedBlock.turn.pairs[0].read_poses === 0 &&
    refusedBlock.turn.unmeasured.some(u => u.reason.includes('gated turn copy build refused') && u.reason.includes('PLANTED_TURN_COPY_GATE')) &&
    refused.report.problems.some(p => p.code === BEHIND_SEAM_UNMEASURED_CODE) && refused.figures.PASS === false &&
    refused.figures.gate_spine_html_green === repaired.figures.gate_spine_html_green,
    JSON.stringify({ turn: turnBrief(refusedBlock.turn), problems: refused.report.problems.map(p => p.code), cleaned: refused.turnScratchRemoved }));
}

/** #1403: two blocks `gap` cells apart over a rear whose red rises 7 per texel column; four rows. */
export function behindWideStandingFixture(gap: number): BehindSeamFixture {
  const a = rectangle('a', 0, 0, 4, 4), b = rectangle('b', 4 + gap, 0, 4, 4);
  const width = 10 + gap, rear = rectangle('rear', -1, -1, width, 6);
  const page = new Plate(width, 6);
  for (let x = 0; x < width; x++) page.rect(x, 0, 1, 6, [7 * x, 48, 72, 255]);
  const setup = [rear, a, b];
  return fixture(new Map([['rear', page], ['a', plate(4, 4, FRONT)], ['b', plate(4, 4, FRONT)]]), setup, [setup]);
}

/** #1403: behindMotionFixture `width` cells wide; the peak lifts a by three, opening two rows of `width` cells. */
export function behindWideMotionFixture(width: number): BehindSeamFixture {
  const rear = rectangle('rear', -8, -8, width + 16, 24);
  const a = rectangle('a', 0, 3, width, 4), b = rectangle('b', 0, 0, width, 4);
  const pages = new Map([['rear', plate(width + 16, 24, REAR)], ['a', plate(width, 4, FRONT)], ['b', plate(width, 4, FRONT)]]);
  return fixture(pages, [rear, a, b], [[rear, a, b], [rear, shifted(a, 0, 3), b], [rear, a, b]]);
}

/** Every samples[] list a reading writes: setup, idle frames and turn poses, both halves. */
function sampleLists(reading: BehindSeamsMeasured): BehindSeamsCount[] {
  const frames = [...reading.pairs.flatMap(p => [...(p.setup === null ? [] : [p.setup]), ...p.frames]), ...(reading.turn?.pairs.flatMap(p => p.frames) ?? [])];
  return frames.flatMap(f => [f.standing, f.motion_opened]);
}
/** The #1403 row ceiling: no samples[] list over the cap. A ceiling on rows, not a memory test. */
const underCeiling = (reading: BehindSeamsMeasured): boolean => sampleLists(reading).every(c => c.samples.length <= BEHIND_SAMPLE_CAP);
/** Everything but the samples list and its omitted count, which the cap may change. */
const withoutSamples = (reading: BehindSeamsMeasured): string => JSON.stringify(reading, (key, value) => key === 'samples' || key === 'samples_omitted' ? undefined : value);

function runBehindSampleCapChecks(say: Say): void {
  // Standing: 30 gap columns x 4 rows = 120 cells. Rear red 7c at texel column c = world column + 1, so the
  // distance to FRONT (24, 48, 72) is 7c - 24 on both sides; c = 5 .. 34. Threshold 100 counts c >= 18
  // (17 columns, 68 cells); the 64 worst are c = 19 .. 34, whose centres are world x 18.5 .. 33.5.
  const wide = behindWideStandingFixture(30);
  const capped = measured(wide, { threshold: 100 }), open = measured(wide, { threshold: 100 }, { sampleCap: Infinity });
  const cs = capped.pair.setup!.standing, os = open.pair.setup!.standing;
  const rank = os.samples.map((sample, ord) => ({ sample, ord, q: sample.counted, m: Math.min(...(sample.distances as [number, number])) }));
  const worst = [...rank].sort((x, y) => standingWorse(x, y) ? -1 : standingWorse(y, x) ? 1 : 0).slice(0, BEHIND_SAMPLE_CAP).sort((x, y) => x.ord - y.ord).map(r => r.sample);
  const xs = [...new Set(cs.samples.map(sample => sample.x))].sort((x, y) => x - y);
  say('BHS1403_STANDING_LIST_OVER_THE_CAP_KEEPS_THE_64_WORST_AND_NAMES_THE_REST',
    os.samples.length === 120 && os.samples.filter(sample => sample.counted).length === 68 && os.samples_omitted === undefined &&
      cs.samples.length === BEHIND_SAMPLE_CAP && cs.samples_omitted === 120 - BEHIND_SAMPLE_CAP && equal(cs.samples, worst) &&
      equal(xs, Array.from({ length: 16 }, (_, i) => 18.5 + i)) && cs.px === 68 && withoutSamples(capped.reading) === withoutSamples(open.reading),
    JSON.stringify({ uncapped: os.samples.length, counted: os.samples.filter(sample => sample.counted).length, kept: cs.samples.length,
      omitted: cs.samples_omitted, kept_x: [xs[0], xs[xs.length - 1], xs.length], px: cs.px, counts_equal: withoutSamples(capped.reading) === withoutSamples(open.reading) }));
  // Motion-opened: 40 wide, two open rows at the peak = 80 hits; positions floor(j * 80 / 64), j = 0 .. 63.
  const motion = behindWideMotionFixture(40);
  const mc = measured(motion), mo = measured(motion, { threshold: 0 }, { sampleCap: Infinity });
  const peak = mc.pair.frames[1].motion_opened, peakOpen = mo.pair.frames[1].motion_opened;
  const spaced = Array.from({ length: 64 }, (_, j) => Math.floor((j * 80) / 64));
  say('BHS1403_MOTION_LIST_OVER_THE_CAP_KEEPS_64_EVENLY_SPACED_IN_MEASURED_ORDER',
    peakOpen.samples.length === 80 && peakOpen.px === 80 && peak.samples.length === BEHIND_SAMPLE_CAP && peak.samples_omitted === 16 &&
      equal(evenlySpaced(80), spaced) && equal(peak.samples, spaced.map(i => peakOpen.samples[i])) && peak.px === 80 &&
      withoutSamples(mc.reading) === withoutSamples(mo.reading),
    JSON.stringify({ uncapped: peakOpen.samples.length, kept: peak.samples.length, omitted: peak.samples_omitted, px: peak.px,
      standing_kept: mc.pair.frames[1].standing.samples.length, counts_equal: withoutSamples(mc.reading) === withoutSamples(mo.reading) }));
  // At or under the cap the written bytes are today's: the uncapped path is the definition.
  const small = [measured(behindStandingFixture()), measured(behindMotionFixture())];
  const smallOpen = [measured(behindStandingFixture(), { threshold: 0 }, { sampleCap: Infinity }), measured(behindMotionFixture(), { threshold: 0 }, { sampleCap: Infinity })];
  const bytes = small.map(r => serializeCheckRows({ [BEHIND_SEAM_LINE]: r.reading })), openBytes = smallOpen.map(r => serializeCheckRows({ [BEHIND_SEAM_LINE]: r.reading }));
  say('BHS1403_LISTS_AT_OR_UNDER_THE_CAP_SERIALIZE_BYTE_IDENTICALLY',
    bytes.every((b, i) => b === openBytes[i] && !b.includes('samples_omitted')) &&
      small[0].pair.setup!.standing.samples.length === 4 && small[1].pair.frames[1].motion_opened.samples.length === 12,
    JSON.stringify({ bytes: bytes.map(b => b.length), identical: bytes.map((b, i) => b === openBytes[i]),
      standing: small[0].pair.setup!.standing.samples.length, motion: small[1].pair.frames[1].motion_opened.samples.length }));
  // Plant: the cap removed, the row ceiling fires; the capped readings stay under it.
  say('BHS1403_ROW_CEILING_FIRES_WITH_THE_CAP_REMOVED',
    underCeiling(capped.reading) && underCeiling(mc.reading) && !underCeiling(open.reading) && !underCeiling(mo.reading),
    JSON.stringify({ ceiling: BEHIND_SAMPLE_CAP, capped_max: Math.max(...sampleLists(capped.reading).map(c => c.samples.length), ...sampleLists(mc.reading).map(c => c.samples.length)),
      planted_max: Math.max(...sampleLists(open.reading).map(c => c.samples.length), ...sampleLists(mo.reading).map(c => c.samples.length)) }));
}

/** Issue #1405, "neither" case: plate columns 0..3 of a are opaque and 6..9 of b; both
 * paint column 4 below 128/255 (a 100, b 90; together 1 - (155/255)(165/255) >= 1/2), so column 4 is
 * an owner-0 endpoint and column 5 the one-cell corridor, on each of four rows. */
function behindNeitherFixture(aEdge: number, bEdge: number | null, frontRgb: RGB = FRONT): BehindSeamFixture {
  const rear = rectangle('rear', -2, -2, 26, 8);
  const a = rectangle('a', 0, 0, 10, 4), b = rectangle('b', 0, 0, 10, 4);
  const pa = new Plate(10, 4), pb = new Plate(10, 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) pa.set(x, y, [...frontRgb, 255]);
    for (let x = 6; x < 10; x++) pb.set(x, y, [...frontRgb, 255]);
    pa.set(4, y, [...frontRgb, aEdge]);
    if (bEdge !== null) pb.set(4, y, [...frontRgb, bEdge]);
  }
  const setup = [rear, a, b];
  return fixture(new Map([['rear', plate(26, 8, REAR)], ['a', pa], ['b', pb]]), setup, [setup, setup, setup]);
}

/** Issue #1405, "both" case: a covers columns 0..aEnd-1; b covers 4..5 and 8..11 with a
 * hole at 6..7. With aEnd 6 the overlap reaches the hole: column 5 is an owner-3 endpoint
 * and columns 6..7 the corridor, on each of four rows. */
function behindBothFixture(aEnd: number, bColumns: (x: number) => boolean): BehindSeamFixture {
  const rear = rectangle('rear', -2, -2, 26, 8);
  const a = rectangle('a', 0, 0, 12, 4), b = rectangle('b', 0, 0, 12, 4);
  const pa = new Plate(12, 4), pb = new Plate(12, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 12; x++) {
    if (x < aEnd) pa.set(x, y, [...FRONT, 255]);
    if (bColumns(x)) pb.set(x, y, [...FRONT, 255]);
  }
  const setup = [rear, a, b];
  return fixture(new Map([['rear', plate(26, 8, REAR)], ['a', pa], ['b', pb]]), setup, [setup, setup, setup]);
}

function runBehindUnreadRemedyChecks(say: Say): void {
  const holed = (x: number): boolean => (x >= 4 && x < 6) || x >= 8;
  // By hand: four one-cell (neither) or two-cell (both) row corridors at setup; the top row's endpoint is first.
  const neitherReason = 'standing endpoints include ambiguous half-alpha owners: 4 unread corridor(s), 4 cell(s); ' +
    'neither "a" nor "b" reaches 128/255 at 4 endpoint cell(s), first at world (4.5, 3.5) ("a" 100/255, "b" 90/255); ' +
    'each endpoint requires exactly one member at 128/255 or more; unread corridors are not zero';
  const bothReason = 'standing endpoints include ambiguous half-alpha owners: 4 unread corridor(s), 8 cell(s); ' +
    'both "a" and "b" reach 128/255 at 4 endpoint cell(s), first at world (5.5, 3.5) ("a" 255/255, "b" 255/255); ' +
    'each endpoint requires exactly one member at 128/255 or more; unread corridors are not zero';
  const frames = ['setup'];
  const names = (result: ReturnType<typeof measured>, reason: string): boolean =>
    frames.every(frame => result.reading.unmeasured.some(u => u.pair === 'a|b' && u.frame === frame && u.reason === `HOLE: ${reason}`)) &&
    frames.every(frame => result.problems.some(p => p.code === BEHIND_SEAM_UNMEASURED_CODE && p.object === `a|b (${frame})` &&
      p.detail === `HOLE: ${reason}; a declared required reading cannot pass unmeasured`));
  const ambiguous = (result: ReturnType<typeof measured>): number =>
    result.reading.unmeasured.filter(u => u.reason.includes('ambiguous half-alpha owners')).length;
  const evidence = (...results: ReturnType<typeof measured>[]): string => JSON.stringify(results.map(result => ({
    status: result.reading.status, setup: result.pair.setup?.standing.status, setup_px: result.pair.setup?.standing.px,
    idle: result.pair.standing.status, idle_max: result.pair.standing.max_px,
    reasons: [...new Set(result.reading.unmeasured.map(u => u.reason))] })));

  const neither = measured(behindNeitherFixture(100, 90), { threshold: 12 });
  say('BHU01_NEITHER_OWNER_LINE_NAMES_BOTH_MEMBERS_ALPHA_AND_POINT',
    names(neither, neitherReason) && neither.pair.setup?.standing.status === 'SKIP' && neither.pair.setup.standing.px === 0 &&
      neither.pair.setup.standing.unread_corridors?.every(c => c.endpoints[0][4] === 0 && c.endpoints[1][4] === 2) === true &&
      neither.lines.includes(`${BEHIND_SEAM_LINE}: pair "a|b" setup SKIP — HOLE: ${neitherReason}`), evidence(neither));
  const both = measured(behindBothFixture(6, holed), { threshold: 12 });
  say('BHU02_BOTH_OWNERS_LINE_NAMES_BOTH_MEMBERS_ALPHA_AND_POINT',
    names(both, bothReason) && both.pair.setup?.standing.status === 'SKIP' && both.pair.setup.standing.px === 0 &&
      both.pair.setup.standing.unread_corridors?.every(c => c.endpoints[0][4] === 3 && c.endpoints[1][4] === 2) === true &&
      both.pair.motion_opened.status === 'PASS', evidence(both));

  // Remedy: one member at >= 128/255 at the endpoint, the other not painting it; the corridor is then read at setup.
  const aOwns = measured(behindNeitherFixture(128, 90), { threshold: 12 });
  const bLeaves = measured(behindNeitherFixture(100, null), { threshold: 12 });
  const bTrimmed = measured(behindBothFixture(6, x => x === 4 || x >= 8), { threshold: 12 });
  const holeFilled = measured(behindBothFixture(6, x => x >= 4), { threshold: 12 });
  say('BHU03_ONE_OWNER_AT_THE_ENDPOINT_CLEARS_THE_LINE_AND_THE_CORRIDOR_IS_READ',
    [aOwns, bLeaves, bTrimmed, holeFilled].every(result => ambiguous(result) === 0 && result.pair.setup?.standing.unread_corridors === undefined) &&
      // column 5 x 4 rows; columns 4..5 x 4 rows; columns 6..7 x 4 rows; no corridor.
      aOwns.pair.setup?.standing.status === 'FAIL' && aOwns.pair.setup.standing.px === 4 &&
      bLeaves.pair.setup?.standing.status === 'FAIL' && bLeaves.pair.setup.standing.px === 8 &&
      bTrimmed.pair.setup?.standing.status === 'FAIL' && bTrimmed.pair.setup.standing.px === 8 &&
      holeFilled.reading.status === 'PASS' && holeFilled.pair.setup?.standing.status === 'PASS' && holeFilled.pair.setup.standing.px === 0 &&
      holeFilled.pair.standing.status === 'SKIP' && holeFilled.pair.standing.reason === IDLE_STANDING_MOTION_READ_REASON &&
      holeFilled.pair.standing.max_px === 0,
    evidence(aOwns, bLeaves, bTrimmed, holeFilled));

  // BHU04 (issue #1405, #1408): with T below the 200-step recomposite distance (|224 - 24| = 200), the ambiguous-owner
  // line is present and stays unread when allowance is raised (allowance 1000 never clears it); with T at or above the
  // recomposite distance (T = 200, 255), the cells match the recomposite within T so the ambiguous-owner line is absent
  // AND those same thresholds make the corresponding readable-endpoint cells uncountable (px === 0).
  // In behindNeitherFixture(128, 90, [0, 0, 0]), endpoint contrast is max(|224-0|,|232-0|,|240-0|) = 240 while recomposite
  // distance to FRONT [24, 48, 72] is 200: at T = 199 it counts 4 cells, and at T = 200 endpoint contrast (240 > 200)
  // still holds so only the recomposite rule (dr = 200 > 200 is false) makes those 4 cells uncountable (px === 0).
  const belowDeclarations: BehindSeams[] = [{ threshold: 199 }, { threshold: 12, allowance: 1000 },
    { threshold: 199, allowance: 1000 }, { threshold: 12, pairs: [{ part: 'a', neighbour: 'b', threshold: 0, allowance: 1000 }] }];
  const kept = belowDeclarations.flatMap(declaration => [measured(behindNeitherFixture(100, 90), declaration), measured(behindBothFixture(6, holed), declaration)]);
  const atOrAboveDeclarations: BehindSeams[] = [{ threshold: 200 }, { threshold: 255 },
    { threshold: 12, pairs: [{ part: 'a', neighbour: 'b', threshold: 255, allowance: 0 }] }];
  const droppedAmbiguous = atOrAboveDeclarations.flatMap(declaration => [measured(behindNeitherFixture(100, 90), declaration), measured(behindBothFixture(6, holed), declaration)]);
  const blackEndpointAt199 = measured(behindNeitherFixture(128, 90, [0, 0, 0]), { threshold: 199 });
  const uncountableReadable = atOrAboveDeclarations.flatMap(declaration => [measured(behindNeitherFixture(128, 90, [0, 0, 0]), declaration), measured(behindBothFixture(6, x => x === 4 || x >= 8), declaration)]);
  say('BHU04_THRESHOLD_ALLOWANCE_AND_PAIR_OVERRIDE_LEAVE_THE_LINE_IN_PLACE',
    kept.every((result, i) => names(result, i % 2 === 0 ? neitherReason : bothReason) && result.reading.status === 'FAIL') &&
      droppedAmbiguous.every(result => ambiguous(result) === 0 &&
        result.pair.setup?.standing.unread_corridors === undefined &&
        result.pair.setup?.standing.unread_cells === undefined) &&
      // On behindNeitherFixture(100, 90), dropping its only corridor leaves 0 boundary support (no-support HOLE);
      // on behindBothFixture(6, holed), columns 4..5 supply overlap support so setup standing is PASS 0.
      droppedAmbiguous.every((result, i) => i % 2 === 0
        ? result.pair.setup?.standing.status === 'SKIP' && result.pair.setup.standing.boundary_cells === 0 &&
          result.reading.unmeasured.some(u => u.frame === 'setup' && u.reason.includes('no A/B boundary support was measured'))
        : result.pair.setup?.standing.status === 'PASS' && result.pair.setup.standing.px === 0) &&
      blackEndpointAt199.pair.setup?.standing.status === 'FAIL' && blackEndpointAt199.pair.setup.standing.px === 4 &&
      uncountableReadable.every(result => result.pair.setup?.standing.status === 'PASS' && result.pair.setup.standing.px === 0),
    evidence(...kept, ...droppedAmbiguous, blackEndpointAt199, ...uncountableReadable));
}

const MID: RGB = [150, 40, 40];

/** Build a fixture whose default recomposite is its own setup pose ("matches its recomposite" by construction). */
function matchingFixture(pages: Map<string, Plate>, setup: Piece[], poses: Piece[][], recompositePieces: Piece[] = setup): BehindSeamFixture {
  return { ...fixture(pages, setup, poses), recomposite: frame(recompositePieces, 0) };
}

/** Issue #1408, 7a: a and b do not touch; third part c is painted between them on every row. */
function behind7aFixture(cOrder: 'behind' | 'between' = 'behind'): BehindSeamFixture {
  const rear = rectangle('rear', -2, -2, 26, 8);
  const a = rectangle('a', 0, 0, 4, 4), b = rectangle('b', 14, 0, 4, 4), c = rectangle('c', 6, 0, 6, 4);
  const pages = new Map([['rear', plate(26, 8, REAR)], ['a', plate(4, 4, FRONT)], ['b', plate(4, 4, FRONT)], ['c', plate(6, 4, MID)]]);
  const setup = cOrder === 'behind' ? [rear, c, a, b] : [rear, a, c, b];
  return matchingFixture(pages, setup, [setup, setup, setup]);
}

/** Issue #1408, 7b: a and b touch on 3 top rows (or overlap 1 col when overlapped=true); b's foot sits 6 cells away on 7 bottom rows. */
function behind7bFixture(overlapped = false): BehindSeamFixture {
  const rear = rectangle('rear', -2, -2, 20, 14);
  const aWidth = overlapped ? 5 : 4;
  const a = rectangle('a', 0, 0, aWidth, 10), b = rectangle('b', 4, 0, 10, 10);
  const pb = new Plate(10, 10);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if (y < 3 || x >= 6) pb.set(x, y, [...FRONT, 255]);
  const pages = new Map([['rear', plate(20, 14, REAR)], ['a', plate(aWidth, 10, FRONT)], ['b', pb]]);
  const setup = [rear, a, b];
  return matchingFixture(pages, setup, [setup, setup, setup]);
}

/** Issue #1408, 7c / 7c-widen: plain contact at setup; when widen=true, b moves one cell right on idle frame 1. */
function behind7cFixture(widen = false): BehindSeamFixture {
  const rear = rectangle('rear', -2, -2, 26, 8);
  const a = rectangle('a', 0, 0, 4, 4), b = rectangle('b', 4, 0, 4, 4);
  const pages = new Map([['rear', plate(26, 8, REAR)], ['a', plate(4, 4, FRONT)], ['b', plate(4, 4, FRONT)]]);
  const setup = [rear, a, b];
  const peak = widen ? [rear, a, shifted(b, 1, 0)] : setup;
  return matchingFixture(pages, setup, [setup, peak, setup]);
}

/** Issue #1408, 8-apart: painted touching in recomposite (b at x=4), assembled one cell apart at setup (b at x=5). */
function behind8ApartFixture(): BehindSeamFixture {
  const rear = rectangle('rear', -2, -2, 26, 8);
  const a = rectangle('a', 0, 0, 4, 4), bAssembled = rectangle('b', 5, 0, 4, 4), bPainted = rectangle('b', 4, 0, 4, 4);
  const pages = new Map([['rear', plate(26, 8, REAR)], ['a', plate(4, 4, FRONT)], ['b', plate(4, 4, FRONT)]]);
  const setup = [rear, a, bAssembled];
  return matchingFixture(pages, setup, [setup, setup, setup], [rear, a, bPainted]);
}

function shiftAllPieces(fx: BehindSeamFixture, dx: number, dy = 0): BehindSeamFixture {
  const moved = fx.setup.pieces.map(p => shifted(p, dx, dy));
  return { ...fx, frames: [frame(fx.setup.pieces, 0), frame(moved, 1), frame(fx.setup.pieces, 2)] };
}

function runBehindRecompositeChecks(dir: string, say: Say, rigc: RigcRunner): void {
  const T: BehindSeams = { threshold: 12 };
  // 7a: members do not touch; c painted between them -> setup standing 0; code-path plant (plantSkipRecomposite) fails 40 (c behind) / 16 (c between).
  const fx7aBehind = behind7aFixture('behind');
  const fx7aBetween = behind7aFixture('between');
  const read7aBehind = measured(fx7aBehind, T);
  const read7aBetween = measured(fx7aBetween, T);
  const plant7aBehind = measured(fx7aBehind, T, { plantSkipRecomposite: true });
  const plant7aBetween = measured(fx7aBetween, T, { plantSkipRecomposite: true });
  say('BHP01_7A_PAINTED_INTERVENING_PART_READS_SETUP_STANDING_ZERO_AND_PLANT_FAILS_40',
    read7aBehind.pair.setup?.standing.status === 'PASS' && read7aBehind.pair.setup.standing.px === 0 &&
      read7aBehind.pair.setup.standing.raw_px === 0 && read7aBehind.pair.setup.standing.geometric_px === 40 &&
      read7aBetween.pair.setup?.standing.status === 'PASS' && read7aBetween.pair.setup.standing.px === 0 &&
      read7aBetween.pair.setup.standing.raw_px === 0 && read7aBetween.pair.setup.standing.geometric_px === 16 &&
      plant7aBehind.pair.setup?.standing.status === 'FAIL' && plant7aBehind.pair.setup.standing.px === 40 &&
      plant7aBetween.pair.setup?.standing.status === 'FAIL' && plant7aBetween.pair.setup.standing.px === 16,
    brief(read7aBehind, read7aBetween, plant7aBehind, plant7aBetween));

  // 7b: members touch on 3 rows; one member's foot sits 6 cells away on 7 rows -> setup standing 0; code-path plant fails 42.
  const fx7b = behind7bFixture();
  const read7b = measured(fx7b, T);
  const plant7b = measured(fx7b, T, { plantSkipRecomposite: true });
  say('BHP02_7B_PARTIAL_CONTACT_WITH_DISTANT_FOOT_NOTCH_READS_SETUP_STANDING_ZERO',
    read7b.pair.setup?.standing.status === 'PASS' && read7b.pair.setup.standing.px === 0 &&
      read7b.pair.setup.standing.raw_px === 0 && read7b.pair.setup.standing.geometric_px === 42 &&
      plant7b.pair.setup?.standing.status === 'FAIL' && plant7b.pair.setup.standing.px === 42,
    brief(read7b, plant7b));

  // 7c: contact only -> PASS 0 at setup.
  const read7c = measured(behind7cFixture(false), T);
  say('BHP03_7C_CONTACT_ONLY_READS_PASS_ZERO_AT_SETUP',
    read7c.pair.setup?.standing.status === 'PASS' && read7c.pair.setup.standing.px === 0 &&
      read7c.pair.setup.standing.boundary_cells === 8 && read7c.pair.setup.standing.geometric_px === 0,
    brief(read7c));

  // 8-apart: painted touching, assembled one cell apart -> FAIL 4 at setup.
  const read8Apart = measured(behind8ApartFixture(), T);
  say('BHP04_8_APART_PAINTED_TOUCHING_ASSEMBLED_ONE_CELL_APART_FAILS_4_AT_SETUP',
    read8Apart.pair.setup?.standing.status === 'FAIL' && read8Apart.pair.setup.standing.px === 4 &&
      read8Apart.pair.setup.standing.raw_px === 4 && read8Apart.pair.setup.standing.geometric_px === 4 &&
      equal(read8Apart.pair.setup.standing.box, [4, 0, 5, 4]) &&
      read8Apart.problems.some(p => p.code === BEHIND_SEAM_CODE && p.object === 'pair "a|b" setup standing' && p.detail.includes('setup (4 cells)')),
    brief(read8Apart));

  // common-shift: every part moves one cell on idle frame 1 -> no false idle cells. The code-path plant
  // (plantMeasureIdleStanding) measures standing on idle frames without an oracle, so every idle frame (0, 1 and 2,
  // unshifted and shifted alike) counts 40 cells on 7a and 35 cells on 7b-overlapped.
  const fx7bShift = shiftAllPieces(behind7bFixture(true), 1);
  const fx7aShift = shiftAllPieces(behind7aFixture('behind'), 1);
  const fx7cShift = shiftAllPieces(behind7cFixture(false), 1);
  const shift7bOverlapped = measured(fx7bShift, T);
  const shift7a = measured(fx7aShift, T);
  const shift7c = measured(fx7cShift, T);
  const shift7cNoContact = measured(fx7cShift, T, { plantNoContact: true });
  const plantIdle7a = measured(fx7aShift, T, { plantMeasureIdleStanding: true });
  const plantIdle7b = measured(fx7bShift, T, { plantMeasureIdleStanding: true });
  say('BHP05_COMMON_SHIFT_EVERY_PART_MOVES_ONE_CELL_ON_IDLE_READS_NO_FALSE_IDLE_CELLS_AND_PLANT_FAILS',
    shift7bOverlapped.reading.status === 'PASS' && shift7bOverlapped.problems.length === 0 &&
      shift7bOverlapped.pair.setup?.standing.status === 'PASS' && shift7bOverlapped.pair.setup.standing.px === 0 &&
      shift7bOverlapped.pair.motion_opened.status === 'PASS' && shift7bOverlapped.pair.motion_opened.max_px === 0 &&
      shift7bOverlapped.pair.standing.status === 'SKIP' && shift7bOverlapped.pair.standing.reason === IDLE_STANDING_MOTION_READ_REASON &&
      shift7bOverlapped.pair.standing.max_px === 0 &&
      shift7bOverlapped.pair.frames.every(f => f.standing.px === 0 && f.motion_opened.px === 0 && f.standing.reason === IDLE_STANDING_MOTION_READ_REASON) &&
      shift7a.pair.frames.every(f => f.standing.px === 0 && f.motion_opened.px === 0 && f.standing.reason === IDLE_STANDING_NO_ORACLE_REASON) &&
      // Issue #1409: 7c is contact-only, so motion_opened reads its transported contact edges: 0 cells under the common shift.
      shift7c.pair.frames.every(f => f.standing.px === 0 && f.motion_opened.status === 'PASS' && f.motion_opened.px === 0 && f.standing.reason === IDLE_STANDING_MOTION_READ_REASON) &&
      shift7c.reading.status === 'PASS' && shift7c.problems.length === 0 &&
      shift7cNoContact.pair.frames.every(f => f.motion_opened.status === 'SKIP' && f.standing.reason === IDLE_STANDING_NO_ORACLE_REASON) &&
      plantIdle7a.pair.standing.status === 'FAIL' && plantIdle7a.pair.standing.max_px === 40 &&
      equal(plantIdle7a.pair.frames.map(f => f.standing.px), [40, 40, 40]) &&
      plantIdle7a.problems.some(p => p.code === BEHIND_SEAM_CODE && p.object === 'pair "a|b" standing') &&
      plantIdle7b.pair.standing.status === 'FAIL' && plantIdle7b.pair.standing.max_px === 35 &&
      equal(plantIdle7b.pair.frames.map(f => f.standing.px), [35, 35, 35]),
    brief(shift7bOverlapped, shift7a, shift7c, shift7cNoContact, plantIdle7a, plantIdle7b));

  // 7c-widen (issue #1409): one member moves one cell away on idle frame 1. The 4 setup contact edges (x = 4, rows 0..3) are
  // carried to x = 4 by a and x = 5 by b; each sweep holds the cell centre (4.5, y + 0.5), drawn by neither member, and a's map
  // carries it back onto b's setup material: 4 rear cells, box [4, 0, 5, 4] (by hand). plantNoContact returns the former HOLE.
  const read7cWiden = measured(behind7cFixture(true), T);
  const hole7cWiden = measured(behind7cFixture(true), T, { plantNoContact: true });
  say('BHP06_7C_WIDEN_CONTACT_ONLY_IDLE_OPENING_FAILS_4_CELLS_FROM_TRANSPORTED_CONTACT_EDGES',
    read7cWiden.pair.setup?.standing.status === 'PASS' && read7cWiden.pair.setup.standing.px === 0 &&
      read7cWiden.reading.status === 'FAIL' && read7cWiden.reading.unmeasured.length === 0 &&
      read7cWiden.pair.motion_opened.status === 'FAIL' && read7cWiden.pair.motion_opened.max_px === 4 &&
      equal(read7cWiden.pair.frames.map(f => f.motion_opened.px), [0, 4, 0]) &&
      read7cWiden.pair.standing.status === 'SKIP' && read7cWiden.pair.standing.reason === IDLE_STANDING_MOTION_READ_REASON &&
      read7cWiden.problems.length === 1 && read7cWiden.problems[0].code === BEHIND_SEAM_CODE &&
      read7cWiden.problems[0].object === 'pair "a|b" motion_opened' &&
      hole7cWiden.reading.status === 'FAIL' && hole7cWiden.pair.motion_opened.status === 'SKIP' &&
      hole7cWiden.pair.standing.reason === IDLE_STANDING_NO_ORACLE_REASON &&
      hole7cWiden.reading.unmeasured.length === 3 &&
      hole7cWiden.reading.unmeasured.every(u => u.reason === 'HOLE: stock transported setup-overlap support is unavailable on every idle frame; motion-opened is not measured') &&
      hole7cWiden.problems.every(p => p.code === BEHIND_SEAM_UNMEASURED_CODE),
    brief(read7cWiden, hole7cWiden));

  // No --parts: setup standing is the named SKIP, and the combined line is not PASS (tested at frame reader, measureBehindSeams, and checkStage).
  // Also verifies that measureBehindSeams refuses a recomposite whose rig_size differs from stage without silent resampling.
  const noPartsFrames = measured({ ...behindMotionFixture(true), recomposite: null }, T);
  const noPartsDir = join(dir, 'no-parts-check');
  const noPartsInput = join(noPartsDir, 'input');
  writeBehindSeamCheckRig(noPartsInput, false);
  rmSync(join(noPartsInput, 'parts.json'), { force: true });
  rmSync(join(noPartsInput, 'parts'), { recursive: true, force: true });
  const noPartsReq = join(noPartsDir, 'req.json');
  writeFileSync(noPartsReq, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [], behind_seams: T }) + '\n');
  const noPartsLines: string[] = [];
  const noPartsOut = join(noPartsDir, 'out');
  const noPartsReport = checkStage({ rig: noPartsInput, out: noPartsOut, requirements: noPartsReq, noExtremes: true },
    rigc, 'fixture-rigc', line => noPartsLines.push(line));
  const noPartsBlock = noPartsReport.behindSeams;
  const mismatchProblems: Problem[] = [];
  const mismatchReading = measureBehindSeams(officialRenderer(), {
    build: join(noPartsOut, 'build'),
    rig: JSON.parse(readFileSync(join(noPartsInput, 'rig.json'), 'utf8')) as Record<string, unknown>,
    pairs: [{ pair: 'back|front', a: 'back', b: 'front', declared: ['motion_seams'] }],
    stockDir: null,
    fps: 12,
    recomposite: { stage: { x: -24, y: 0, width: 48, height: 80 }, raster: newRaster(24, 40) },
  }, T, mismatchProblems);
  say('BHP07_NO_PARTS_SETUP_STANDING_IS_NAMED_SKIP_AND_COMBINED_LINE_IS_NOT_PASS',
    noPartsFrames.pair.setup?.standing.status === 'SKIP' &&
      noPartsFrames.pair.setup.standing.reason === NO_PARTS_SETUP_STANDING_REASON &&
      noPartsFrames.pair.setup.standing.px === 0 &&
      noPartsFrames.reading.status === 'FAIL' &&
      noPartsFrames.reading.unmeasured.some(u => u.pair === 'a|b' && u.frame === 'setup' && u.reason === `HOLE: ${NO_PARTS_SETUP_STANDING_REASON}`) &&
      noPartsFrames.problems.some(p => p.code === BEHIND_SEAM_UNMEASURED_CODE && p.object === 'a|b (setup)' && p.detail.includes('--parts')) &&
      noPartsBlock !== null && noPartsBlock.status === 'FAIL' &&
      noPartsBlock.unmeasured.some(u => u.frame === 'setup' && u.reason === `HOLE: ${NO_PARTS_SETUP_STANDING_REASON}`) &&
      noPartsReport.problems.some(p => p.code === BEHIND_SEAM_UNMEASURED_CODE && p.detail.includes('--parts')) &&
      noPartsLines.some(l => l.includes(NO_PARTS_SETUP_STANDING_REASON)) &&
      mismatchReading.status === 'FAIL' &&
      mismatchReading.unmeasured.some(u => u.reason.includes("parts.json rig_size (24x40) differs from rig stage (48x80); setup standing does not resample the parts' recomposite")) &&
      mismatchProblems.some(p => p.code === BEHIND_SEAM_UNMEASURED_CODE && p.detail.includes('does not resample')),
    JSON.stringify({ frames: summary(noPartsFrames.reading), stage: noPartsBlock === null ? null : summary(noPartsBlock),
      mismatch: mismatchReading.unmeasured }));

  // Matching rig with a half-alpha rear in the gap reads setup 0 (both full render and recomposite flatten on white to the same RGB;
  // straight rear colour [224,232,240] differs from white-flattened [239,243,247] by 15 > threshold 12).
  const halfRearBase = behindStandingFixture({ gap: 1 });
  halfRearBase.pages.set('rear', plate(12, 6, REAR, 128));
  const halfRearMatching: BehindSeamFixture = { ...halfRearBase, recomposite: halfRearBase.setup };
  const halfRearRead = measured(halfRearMatching, T);
  const halfRearClosedGap = measured(halfRearBase, T);
  say('BHP08_MATCHING_RIG_WITH_HALF_ALPHA_REAR_IN_GAP_READS_SETUP_ZERO',
    halfRearRead.pair.setup?.standing.status === 'PASS' && halfRearRead.pair.setup.standing.px === 0 &&
      halfRearRead.pair.setup.standing.raw_px === 0 && halfRearRead.pair.setup.standing.geometric_px === 4 &&
      halfRearClosedGap.pair.setup?.standing.status === 'FAIL' && halfRearClosedGap.pair.setup.standing.px === 4,
    brief(halfRearRead, halfRearClosedGap));

  // Ambiguous endpoint corridor whose cells all match the recomposite is not unread:
  // - when the pair has real boundary support (e.g. overlap in bothBase, or a clean contact row in neitherWithContact), setup standing is PASS 0;
  // - when the fixture's ONLY corridor is ambiguous (owner 0) and fully matched (neitherBase), dropping it does not fabricate support, so setup standing reads the no-support HOLE (item B9);
  // - with a closed-gap recomposite, both fixtures are unread with the #1411 message.
  const holed = (x: number): boolean => (x >= 4 && x < 6) || x >= 8;
  const neitherBase = behindNeitherFixture(100, 90);
  const neitherWithContact = behindNeitherFixture(100, 90);
  // Give row 3 unambiguous contact at columns 4 (a=255) and 5 (b=255), while rows 0..2 stay owner-0 ambiguous corridors.
  neitherWithContact.pages.get('a')!.set(4, 3, [...FRONT, 255]);
  neitherWithContact.pages.get('b')!.set(4, 3, [0, 0, 0, 0]);
  neitherWithContact.pages.get('b')!.set(5, 3, [...FRONT, 255]);
  const bothBase = behindBothFixture(6, holed);
  const neitherOnlyMatching = measured({ ...neitherBase, recomposite: neitherBase.setup }, T);
  const neitherContactMatching = measured({ ...neitherWithContact, recomposite: neitherWithContact.setup }, T);
  const bothMatching = measured({ ...bothBase, recomposite: bothBase.setup }, T);
  const neitherClosed = measured(neitherBase, T);
  const bothClosed = measured(bothBase, T);
  say('BHP09_AMBIGUOUS_ENDPOINT_CORRIDOR_MATCHING_RECOMPOSITE_IS_NOT_UNREAD_AND_DOES_NOT_FABRICATE_SUPPORT',
    neitherOnlyMatching.pair.setup?.standing.status === 'SKIP' &&
      neitherOnlyMatching.pair.setup.standing.px === 0 &&
      neitherOnlyMatching.pair.setup.standing.boundary_cells === 0 &&
      neitherOnlyMatching.pair.setup.standing.unread_corridors === undefined &&
      neitherOnlyMatching.pair.setup.standing.unread_cells === undefined &&
      !neitherOnlyMatching.reading.unmeasured.some(u => u.reason.includes('ambiguous half-alpha owners')) &&
      neitherOnlyMatching.reading.unmeasured.some(u => u.frame === 'setup' && u.reason.includes('no A/B boundary support was measured')) &&
      neitherContactMatching.pair.setup?.standing.status === 'PASS' &&
      neitherContactMatching.pair.setup.standing.px === 0 &&
      neitherContactMatching.pair.setup.standing.boundary_cells === 2 &&
      neitherContactMatching.pair.setup.standing.unread_corridors === undefined &&
      neitherContactMatching.pair.setup.standing.unread_cells === undefined &&
      bothMatching.reading.status === 'PASS' && bothMatching.problems.length === 0 &&
      bothMatching.pair.setup?.standing.status === 'PASS' && bothMatching.pair.setup.standing.px === 0 &&
      bothMatching.pair.setup.standing.unread_corridors === undefined && bothMatching.pair.setup.standing.unread_cells === undefined &&
      neitherClosed.pair.setup?.standing.status === 'SKIP' && neitherClosed.pair.setup.standing.unread_corridors?.length === 4 &&
      neitherClosed.reading.unmeasured.some(u => u.frame === 'setup' && u.reason.includes('neither "a" nor "b" reaches 128/255 at 4 endpoint cell(s)')) &&
      bothClosed.pair.setup?.standing.status === 'SKIP' && bothClosed.pair.setup.standing.unread_corridors?.length === 4 &&
      bothClosed.reading.unmeasured.some(u => u.frame === 'setup' && u.reason.includes('both "a" and "b" reach 128/255 at 4 endpoint cell(s)')),
    brief(neitherOnlyMatching, neitherContactMatching, bothMatching, neitherClosed, bothClosed));

  // A cell outside the recomposite's canvas is not excused.
  const outOfCanvasBase = behindStandingFixture({ gap: 1 });
  const shortRecomposite = frame([{ ...rectangle('recomposite', 0, 0, 4, 4), page: 'a' }], 0);
  const outOfCanvasRead = measured({ ...outOfCanvasBase, recomposite: shortRecomposite }, T);
  say('BHP10_CELL_OUTSIDE_RECOMPOSITE_CANVAS_IS_NOT_EXCUSED',
    outOfCanvasRead.pair.setup?.standing.status === 'FAIL' && outOfCanvasRead.pair.setup.standing.px === 4,
    brief(outOfCanvasRead));

  // Production registration (item C12): real checkStage with an asymmetric setup gap vs parts' flat recomposite.
  // In the rig's setup render (images/back.png), 10 columns x 2 rows = 20 geometric cells expose rear at crop sx 20..29, sy 38..39;
  // in parts/back.png, only the left 6 of those columns (crop sx 20..25, world x -4..2, y 40..42 -> 12 cells) are closed, while
  // the right 4 columns (crop sx 26..29 -> 8 cells) are already open in the recomposite. Flipping UVs vertically gives 20 cells
  // (box [-4, 40, 6, 42]); flipping horizontally gives 16 cells (box [-2, 40, 6, 42]).
  const regDir = join(dir, 'asymmetric-registration');
  const regInput = join(regDir, 'input');
  writeBehindSeamCheckRig(regInput, true);
  const regReq = join(regDir, 'req.json');
  writeFileSync(regReq, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [], behind_seams: T }) + '\n');
  const regReport = checkStage({ rig: regInput, out: join(regDir, 'out'), requirements: regReq, noExtremes: true },
    rigc, 'fixture-rigc', () => {});
  const regSetup = regReport.behindSeams?.pairs[0]?.setup?.standing;
  say('BHP11_PRODUCTION_REGISTRATION_ASYMMETRIC_RECOMPOSITE_ORACLE',
    regSetup?.status === 'FAIL' && regSetup.geometric_px === 20 && regSetup.raw_px === 12 &&
      regSetup.px === 12 && regSetup.max_spatial_run_cells === 6 &&
      equal(regSetup.box?.map(v => Math.round(v)), [-4, 40, 2, 42]) &&
      regReport.problems.some(p => p.code === BEHIND_SEAM_CODE && p.object === 'pair "back|front" setup standing' && p.detail.includes('setup (12 cells)')),
    JSON.stringify({ setup: regSetup, problems: regReport.problems }));

  // Idle motion_opened consecutive-frame spans, max_run, max_spatial_run_world and worst.index (item C13),
  // plus per-frame idle standing reason independence when one frame's motion_opened is SKIP (item C16).
  const baseMotion = behindMotionFixture();
  const [mRear, mA, mB] = baseMotion.setup.pieces;
  const twoFrameOpen: BehindSeamFixture = {
    ...baseMotion,
    recomposite: baseMotion.setup,
    frames: [
      frame([mRear, mA, mB], 0),
      frame([mRear, shifted(mA, 0, 2), mB], 1),
      frame([mRear, shifted(mA, 0, 3), mB], 2),
      frame([mRear, mA, mB], 3),
    ],
  };
  const twoFrameRead = measured(twoFrameOpen, T);
  const mo = twoFrameRead.pair.motion_opened;
  // Item C16: frame 2 drops slot 'b' so frame 2's motion_opened is SKIP while frames 0 and 1 have motion_opened read (and frame 1 fails).
  const baseStock = stockOf(baseMotion);
  const partialIdleSkip = measureBehindSeamFrames(API, {
    ...inputOf({ ...baseMotion, recomposite: baseMotion.setup }),
    idle: [asFrame(baseMotion.frames[0]), asFrame(baseMotion.frames[1]), asFrame(frame([mRear, mA], 2))],
    stock: baseStock,
  }, T, []);
  const pf = partialIdleSkip.pairs[0].frames;
  say('BHP12_MOTION_OPENED_CONSECUTIVE_IDLE_SPANS_MAX_RUN_AND_PER_FRAME_IDLE_REASON',
    mo.status === 'FAIL' && mo.hit_frames === 2 && mo.max_px === 12 &&
      mo.worst?.index === 2 && mo.worst.px === 12 &&
      mo.spans.length === 1 && mo.spans[0].first === 1 && mo.spans[0].last === 2 &&
      mo.spans[0].frames === 2 && mo.spans[0].seconds === 2 / 12 &&
      mo.max_run.frames === 2 && mo.max_run.seconds === 2 / 12 &&
      mo.max_spatial_run_cells === 6 && mo.max_spatial_run_world === 6 &&
      pf[0]?.motion_opened.status === 'PASS' && pf[0].standing.reason === IDLE_STANDING_MOTION_READ_REASON &&
      pf[1]?.motion_opened.status === 'FAIL' && pf[1].standing.reason === IDLE_STANDING_MOTION_READ_REASON &&
      pf[2]?.motion_opened.status === 'SKIP' && pf[2].standing.reason === IDLE_STANDING_NO_ORACLE_REASON,
    JSON.stringify({ motion_opened: mo, frame_reasons: pf.map(f => [f.index, f.motion_opened.status, f.standing.reason]) }));

  // Issue #1412 (BHT01–BHT03): turn standing is never measured; motion_opened is the turn reading.
  const TTurn: BehindSeams = { threshold: 12, turn: true };
  const turnInputOf = (fx: BehindSeamFixture, poseNames: readonly string[] = ['yaw_dial=-15', 'yaw_dial=15']): NonNullable<BehindSeamsFramesInput['turn']> => {
    const poses = poseNames.map((name, i) => ({ name, values: { yaw_dial: i === 0 ? -15 : 15 * i } }));
    const seamFrames = poseNames.map((_, index) => ({ ...(fx.frames[index] ?? fx.setup), index, time: 0 }));
    const turnFrames = seamFrames.map(asFrame);
    const read = seamsOf([fx.pair], fx.rest, seamFrames, fx.pages, {},
      { cells: setupCellReader(() => fx.setup.pieces, fx.pages) })[0];
    const stock: BehindSeamsStockPair[] = [{
      pair: 'a|b',
      frames: seamFrames.length,
      drawn: read.drawn,
      banded: read.banded,
      gapCovered: read.gapCovered.frames.map(hit => ({ index: hit.index, time: 0, cell: hit.cell, cells: hit.cells ?? [] })),
    }];
    return { poses, frames: turnFrames, setup: asFrame(fx.setup), rest: fx.rest, stock };
  };

  // BHT01: a turn fixture matching its own art, whose pair members do not touch and have a third part c painted between them
  // (7a: 4 rows x 10 gap columns = 40 cells with c behind, 4 rows x 4 uncovered columns = 16 cells with c between; and
  // 7b-overlapped: 3 top overlap rows so motion_opened reads PASS, plus 7 bottom rows x 5 gap columns = 35 cells), reads no
  // turn standing cells. The tool-only plant (plantMeasureTurnStanding) restores turn standing measurement and fails with the
  // hand-computed 40, 16 and 35 cells on every turn pose.
  const turn7aBehind = measured(fx7aShift, TTurn, { turn: turnInputOf(fx7aShift) });
  const turn7aBetween = measured(shiftAllPieces(behind7aFixture('between'), 1), TTurn, { turn: turnInputOf(shiftAllPieces(behind7aFixture('between'), 1)) });
  const turn7bOverlapped = measured(fx7bShift, TTurn, { turn: turnInputOf(fx7bShift) });
  const plantTurn7aBehind = measured(fx7aShift, TTurn, { turn: turnInputOf(fx7aShift), plantMeasureTurnStanding: true });
  const plantTurn7aBetween = measured(shiftAllPieces(behind7aFixture('between'), 1), TTurn, { turn: turnInputOf(shiftAllPieces(behind7aFixture('between'), 1)), plantMeasureTurnStanding: true });
  const plantTurn7bOverlapped = measured(fx7bShift, TTurn, { turn: turnInputOf(fx7bShift), plantMeasureTurnStanding: true });
  say('BHT01_TURN_PAINTED_INTERVENING_PART_READS_NO_TURN_STANDING_CELLS_AND_PLANT_FAILS_40',
    turn7aBehind.reading.turn?.pairs[0].standing.status === 'SKIP' &&
      turn7aBehind.reading.turn.pairs[0].standing.reason === TURN_STANDING_NO_ORACLE_REASON &&
      turn7aBehind.reading.turn.pairs[0].standing.max_px === 0 &&
      turn7aBehind.reading.turn.pairs[0].frames.every(f => f.standing.status === 'SKIP' && f.standing.reason === TURN_STANDING_NO_ORACLE_REASON &&
        f.standing.px === 0 && f.standing.raw_px === 0 && f.standing.geometric_px === 0 && f.standing.boundary_cells === 0 &&
        f.standing.box === null && f.standing.samples.length === 0) &&
      !turn7aBehind.problems.some(p => p.code === BEHIND_SEAM_CODE) &&
      turn7aBetween.reading.turn?.pairs[0].standing.status === 'SKIP' &&
      turn7aBetween.reading.turn.pairs[0].standing.max_px === 0 &&
      turn7aBetween.reading.turn.pairs[0].frames.every(f => f.standing.px === 0 && f.standing.reason === TURN_STANDING_NO_ORACLE_REASON) &&
      turn7bOverlapped.reading.status === 'PASS' && turn7bOverlapped.reading.turn?.status === 'PASS' &&
      turn7bOverlapped.problems.length === 0 &&
      turn7bOverlapped.reading.turn.pairs[0].motion_opened.status === 'PASS' &&
      turn7bOverlapped.reading.turn.pairs[0].motion_opened.max_px === 0 &&
      turn7bOverlapped.reading.turn.pairs[0].standing.status === 'SKIP' &&
      turn7bOverlapped.reading.turn.pairs[0].standing.reason === TURN_STANDING_MOTION_READ_REASON &&
      turn7bOverlapped.reading.turn.pairs[0].standing.max_px === 0 &&
      turn7bOverlapped.reading.turn.pairs[0].frames.every(f => f.standing.status === 'SKIP' && f.standing.reason === TURN_STANDING_MOTION_READ_REASON && f.standing.px === 0) &&
      plantTurn7aBehind.reading.turn?.pairs[0].standing.status === 'FAIL' &&
      plantTurn7aBehind.reading.turn.pairs[0].standing.max_px === 40 &&
      equal(plantTurn7aBehind.reading.turn.pairs[0].frames.map(f => f.standing.px), [40, 40]) &&
      plantTurn7aBehind.problems.some(p => p.code === BEHIND_SEAM_CODE && p.object === 'pair "a|b" turn yaw_dial=-15 standing') &&
      plantTurn7aBetween.reading.turn?.pairs[0].standing.status === 'FAIL' &&
      plantTurn7aBetween.reading.turn.pairs[0].standing.max_px === 16 &&
      equal(plantTurn7aBetween.reading.turn.pairs[0].frames.map(f => f.standing.px), [16, 16]) &&
      plantTurn7bOverlapped.reading.turn?.pairs[0].standing.status === 'FAIL' &&
      plantTurn7bOverlapped.reading.turn.pairs[0].standing.max_px === 35 &&
      equal(plantTurn7bOverlapped.reading.turn.pairs[0].frames.map(f => f.standing.px), [35, 35]),
    JSON.stringify({ turn7a: turnBrief(turn7aBehind.reading.turn), turn7b: turnBrief(turn7bOverlapped.reading.turn),
      plant7a: turnBrief(plantTurn7aBehind.reading.turn), plant7aBetween: turnBrief(plantTurn7aBetween.reading.turn),
      plant7b: turnBrief(plantTurn7bOverlapped.reading.turn) }));

  // BHT02 (issue #1409): 7c-widen on turn poses. The pair is contact-only (banded 0), so motion_opened reads its transported
  // setup contact edges: pose yaw_dial=-15 is setup (0 cells), pose yaw_dial=15 moves b one cell right (4 cells, by hand as in
  // BHP06). plantNoContact returns the former named HOLE; plantMeasureTurnStanding still measures pose 1's 4 standing cells.
  const fx7cTurnWiden = behind7cFixture(true);
  const turn7cWiden = measured(fx7cTurnWiden, TTurn, { turn: turnInputOf(fx7cTurnWiden) });
  const holeTurn7cWiden = measured(fx7cTurnWiden, TTurn, { turn: turnInputOf(fx7cTurnWiden), plantNoContact: true });
  const plantTurn7cWiden = measured(fx7cTurnWiden, TTurn, { turn: turnInputOf(fx7cTurnWiden), plantMeasureTurnStanding: true });
  const tp = turn7cWiden.reading.turn?.pairs[0];
  say('BHT02_TURN_CONTACT_ONLY_OPENING_FAILS_FROM_TRANSPORTED_CONTACT_EDGES_AND_THE_PLANT_KEEPS_THE_HOLE',
    turn7cWiden.reading.status === 'FAIL' && turn7cWiden.reading.turn?.status === 'FAIL' && tp !== undefined &&
      tp.motion_opened.status === 'FAIL' && tp.motion_opened.max_px === 4 && tp.motion_support === CONTACT_MOTION_SUPPORT &&
      equal(tp.frames.map(f => f.motion_opened.px), [0, 4]) &&
      tp.standing.status === 'SKIP' && tp.standing.reason === TURN_STANDING_MOTION_READ_REASON && tp.standing.max_px === 0 &&
      tp.sampled_poses === 2 && tp.read_poses === 2 && tp.unmeasured_poses === 0 &&
      turn7cWiden.reading.turn.unmeasured.length === 0 &&
      turn7cWiden.problems.some(p => p.code === BEHIND_SEAM_CODE && p.object === 'pair "a|b" turn yaw_dial=15 motion_opened') &&
      !turn7cWiden.problems.some(p => p.code === BEHIND_SEAM_UNMEASURED_CODE) &&
      turn7cWiden.lines.some(l => l.includes('turn yaw_dial=15') && l.includes(`motion_opened FAIL, 4 cells (support ${CONTACT_MOTION_SUPPORT})`)) &&
      holeTurn7cWiden.reading.turn?.pairs[0].motion_opened.status === 'SKIP' &&
      holeTurn7cWiden.reading.turn.pairs[0].standing.reason === TURN_STANDING_NO_ORACLE_REASON &&
      holeTurn7cWiden.reading.turn.pairs[0].read_poses === 0 && holeTurn7cWiden.reading.turn.unmeasured.length === 2 &&
      holeTurn7cWiden.reading.turn.unmeasured.every(u => u.reason === 'HOLE: stock transported setup-overlap support is unavailable on every named turn pose; motion-opened is not measured') &&
      holeTurn7cWiden.problems.every(p => p.code === BEHIND_SEAM_UNMEASURED_CODE) &&
      plantTurn7cWiden.reading.turn?.pairs[0].standing.status === 'FAIL' &&
      plantTurn7cWiden.reading.turn.pairs[0].standing.max_px === 4 &&
      equal(plantTurn7cWiden.reading.turn.pairs[0].frames.map(f => f.standing.px), [0, 4]) &&
      plantTurn7cWiden.problems.some(p => p.code === BEHIND_SEAM_CODE && p.object === 'pair "a|b" turn yaw_dial=15 standing'),
    JSON.stringify({ turn: turnBrief(turn7cWiden.reading.turn), problems: turn7cWiden.problems.map(p => p.object), hole: turnBrief(holeTurn7cWiden.reading.turn), plant: turnBrief(plantTurn7cWiden.reading.turn) }));

  // BHC10 (issue #1409): a new turn control. Every part moves one cell together on pose yaw_dial=15 of the contact-only 7c:
  // both maps carry each contact edge to x = 5, a degenerate sweep that holds no cell centre: 0 cells, turn PASS (by hand).
  // A10 on turn: b ten cells away on yaw_dial=15 reads 32 cells with lower_bound_cells 8 and lower_bound_poses 1.
  const fx7cTurnShift = shiftAllPieces(behind7cFixture(false), 1);
  const turn7cShift = measured(fx7cTurnShift, TTurn, { turn: turnInputOf(fx7cTurnShift) });
  const fxTurnFar = contactMovedFixture(10);
  const turnFar = measured(fxTurnFar, TTurn, { turn: turnInputOf(fxTurnFar) });
  const ts = turn7cShift.reading.turn?.pairs[0], tf = turnFar.reading.turn?.pairs[0];
  say('BHC10_TURN_CONTACT_ONLY_COMMON_SHIFT_PASSES_AND_A_FAR_POSE_CARRIES_ITS_LOWER_BOUND',
    turn7cShift.reading.turn?.status === 'PASS' && ts !== undefined && ts.motion_opened.status === 'PASS' && ts.motion_opened.max_px === 0 &&
      ts.motion_support === CONTACT_MOTION_SUPPORT && ts.read_poses === 2 && ts.motion_opened.lower_bound_poses === undefined &&
      turn7cShift.reading.turn.limitations.endsWith(CONTACT_LIMITATIONS) &&
      tf !== undefined && tf.motion_opened.status === 'FAIL' && tf.motion_opened.max_px === 32 && tf.motion_opened.lower_bound_poses === 1 &&
      equal(tf.frames.map(f => f.motion_opened.lower_bound_cells), [undefined, 8]) &&
      turnFar.lines.some(l => l.includes('turn yaw_dial=15') && l.includes(`motion_opened FAIL, 32 cells (support ${CONTACT_MOTION_SUPPORT}, lower bound: 8 uncounted)`)),
    JSON.stringify({ shift: turnBrief(turn7cShift.reading.turn), far: turnBrief(turnFar.reading.turn) }));

  // BHT03: each turn pose keeps its own standing reason (one pose with motion_opened read and one with it SKIP in the same
  // reading, under both pair-level FAIL and pair-level SKIP), and ambiguous endpoint owners on turn poses produce no unread
  // corridors or unmeasured[] rows unless plantMeasureTurnStanding is set.
  const turnStock3: BehindSeamsStockPair[] = [{
    pair: 'a|b',
    frames: 3,
    drawn: 3,
    banded: 3,
    gapCovered: baseStock[0].gapCovered.map(hit => ({ ...hit, time: 0 })),
  }];
  const baseMotionMatching: BehindSeamFixture = { ...baseMotion, recomposite: baseMotion.setup };
  const mixedTurnFail = measured(baseMotionMatching, TTurn, {
    turn: {
      poses: [
        { name: 'yaw_dial=-15', values: { yaw_dial: -15 } },
        { name: 'yaw_dial=15', values: { yaw_dial: 15 } },
        { name: 'pitch_dial=-12', values: { pitch_dial: -12 } },
      ],
      frames: [
        { ...asFrame(baseMotion.frames[0]), index: 0, time: 0 },
        { ...asFrame(baseMotion.frames[1]), index: 1, time: 0 },
        { ...asFrame(frame([mRear, mA], 2)), index: 2, time: 0 },
      ],
      setup: asFrame(baseMotion.setup),
      rest: baseMotion.rest,
      stock: turnStock3,
    },
  });
  const mixedTurnSkip = measured(baseMotionMatching, TTurn, {
    turn: {
      poses: [
        { name: 'yaw_dial=-15', values: { yaw_dial: -15 } },
        { name: 'yaw_dial=15', values: { yaw_dial: 15 } },
      ],
      frames: [
        { ...asFrame(baseMotion.frames[0]), index: 0, time: 0 },
        { ...asFrame(frame([mRear, mA], 1)), index: 1, time: 0 },
      ],
      setup: asFrame(baseMotion.setup),
      rest: baseMotion.rest,
      stock: [{ pair: 'a|b', frames: 2, drawn: 2, banded: 2, gapCovered: [] }],
    },
  });
  const bothTurnFx: BehindSeamFixture = { ...bothBase, recomposite: bothBase.setup };
  const turnAmbiguousClean = measured(bothTurnFx, TTurn, { turn: turnInputOf(bothTurnFx) });
  const turnAmbiguousPlanted = measured(bothTurnFx, TTurn, { turn: turnInputOf(bothTurnFx), plantMeasureTurnStanding: true });
  const tfFail = mixedTurnFail.reading.turn?.pairs[0].frames ?? [];
  const tfSkip = mixedTurnSkip.reading.turn?.pairs[0].frames ?? [];
  say('BHT03_TURN_EACH_POSE_KEEPS_ITS_OWN_REASON_AND_AMBIGUOUS_CORRIDORS_DISAPPEAR',
    mixedTurnFail.reading.turn?.pairs[0].motion_opened.status === 'FAIL' &&
      mixedTurnFail.reading.turn.pairs[0].standing.reason === TURN_STANDING_MOTION_READ_REASON &&
      mixedTurnFail.reading.turn.pairs[0].sampled_poses === 3 &&
      mixedTurnFail.reading.turn.pairs[0].read_poses === 2 &&
      mixedTurnFail.reading.turn.pairs[0].unmeasured_poses === 1 &&
      tfFail[0]?.motion_opened.status === 'PASS' && tfFail[0].standing.reason === TURN_STANDING_MOTION_READ_REASON &&
      tfFail[1]?.motion_opened.status === 'FAIL' && tfFail[1].standing.reason === TURN_STANDING_MOTION_READ_REASON &&
      tfFail[2]?.motion_opened.status === 'SKIP' && tfFail[2].standing.reason === TURN_STANDING_NO_ORACLE_REASON &&
      mixedTurnSkip.reading.turn?.pairs[0].motion_opened.status === 'SKIP' &&
      mixedTurnSkip.reading.turn.pairs[0].standing.reason === TURN_STANDING_NO_ORACLE_REASON &&
      mixedTurnSkip.reading.turn.pairs[0].read_poses === 1 &&
      mixedTurnSkip.reading.turn.pairs[0].unmeasured_poses === 1 &&
      tfSkip[0]?.motion_opened.status === 'PASS' && tfSkip[0].standing.reason === TURN_STANDING_MOTION_READ_REASON &&
      tfSkip[1]?.motion_opened.status === 'SKIP' && tfSkip[1].standing.reason === TURN_STANDING_NO_ORACLE_REASON &&
      turnAmbiguousClean.reading.status === 'PASS' && turnAmbiguousClean.reading.turn?.status === 'PASS' &&
      turnAmbiguousClean.reading.turn.unmeasured.length === 0 &&
      turnAmbiguousClean.reading.turn.pairs[0].read_poses === 2 &&
      turnAmbiguousClean.reading.turn.pairs[0].frames.every(f => f.standing.unread_corridors === undefined && f.standing.unread_cells === undefined) &&
      turnAmbiguousPlanted.reading.turn?.status === 'FAIL' &&
      turnAmbiguousPlanted.reading.turn.unmeasured.some(u => u.reason.includes('ambiguous half-alpha owners')) &&
      turnAmbiguousPlanted.reading.turn.pairs[0].frames.every(f => f.standing.unread_corridors?.length === 4 && f.standing.unread_cells === 8),
    JSON.stringify({
      fail_poses: tfFail.map(f => [f.pose, f.motion_opened.status, f.standing.reason]),
      skip_poses: tfSkip.map(f => [f.pose, f.motion_opened.status, f.standing.reason]),
      ambiguous_clean: turnBrief(turnAmbiguousClean.reading.turn),
      ambiguous_planted: turnBrief(turnAmbiguousPlanted.reading.turn),
    }));
}

/** Issue #1415: a 4-column x 4-row gap (world x 4..8, y 0..4 = 16 gap cells) between a (x 0..4) and b (x 8..12)
 * over rear (-1..-1, 16x6, REAR [224,232,240]), with an optional later part drawn in front of both pair members
 * over the right half of the gap (world x 6..8, y 0..4 = 2 columns x 4 rows = 8 covered cells; left half x 4..6,
 * y 0..4 = 8 uncovered cells). The occluder uses REAR [224,232,240] so over covered cells the full render's
 * white-flattened RGB remains [224,232,240], differing from the closed-gap recomposite FRONT [24,48,72] by
 * max(|224-24|,|232-48|,|240-72|) = 200 > T = 0, and straight rear RGB differs from both endpoints A/B FRONT by
 * 200 > T = 0. Thus only `surviving.delete(k)` at alpha === 255 excludes the 8 covered cells from `geometric_px`,
 * `raw_px` and `px`. */
export function behindPartialLaterOccluderFixture(occluderAlpha?: number): BehindSeamFixture {
  const rear = rectangle('rear', -1, -1, 16, 6);
  const a = rectangle('a', 0, 0, 4, 4), b = rectangle('b', 8, 0, 4, 4);
  const pages = new Map([['rear', plate(16, 6, REAR)], ['a', plate(4, 4, FRONT)], ['b', plate(4, 4, FRONT)]]);
  const later: Piece[] = [];
  if (occluderAlpha !== undefined) {
    later.push(rectangle('occluder', 6, 0, 2, 4));
    pages.set('occluder', plate(2, 4, REAR, occluderAlpha));
  }
  const setup = [rear, a, b, ...later];
  return fixture(pages, setup, [setup, setup, setup]);
}

export function runBehindLaterOpaqueArtChecks(say: Say): void {
  // Hand derivation from behindPartialLaterOccluderFixture:
  // - Gap between a (x 0..4, y 0..4) and b (x 8..12, y 0..4): 4 columns (x = 4..8, centres 4.5, 5.5, 6.5, 7.5)
  //   x 4 rows (y = 0..4, centres 3.5, 2.5, 1.5, 0.5) = 16 gap cells; boundary_cells = 8 (x = 3.5 and x = 8.5 x 4 rows).
  // - Later occluder covers the right 2 gap columns (x = 6..8, centres 6.5, 7.5) x 4 rows = 8 covered cells,
  //   leaving the left 2 gap columns (x = 4..6, centres 4.5, 5.5) x 4 rows = 8 uncovered cells.
  // - Without the occluder: all 4 x 4 = 16 gap cells survive with rear_weight = 1 -> geometric_px = 16, raw_px = 16,
  //   px = 16, box = [4, 0, 8, 4], max_spatial_run_cells = 4 (4 columns per row and 4 rows per column), 16 samples.
  // - With the opaque occluder (alpha = 255, keep = 0): `if (alpha === 255) surviving.delete(k)` removes the 8 covered
  //   cells from `surviving` before the standing loop increments `geometric_px`, so the rule changes `geometric_px`
  //   (16 -> 8) and consequently `raw_px` (16 -> 8), `px` (16 -> 8) and `samples.length` (16 -> 8), with box [4, 0, 6, 4],
  //   max_spatial_run_cells = 4 (vertical run of 4 rows on each uncovered column), and no setup `unmeasured[]` underflow row.
  const withoutOccluder = measured(behindPartialLaterOccluderFixture());
  const withOpaqueOccluder = measured(behindPartialLaterOccluderFixture(255));
  const sWithout = withoutOccluder.pair.setup!.standing;
  const sOpaque = withOpaqueOccluder.pair.setup!.standing;
  say('BHO01_LATER_OPAQUE_PART_OVER_PARTIAL_GAP_REMOVES_COVERED_CELLS_FROM_GEOMETRIC_AND_COUNTED_PX',
    sWithout.status === 'FAIL' && sWithout.boundary_cells === 8 &&
      sWithout.geometric_px === 16 && sWithout.raw_px === 16 && sWithout.px === 16 &&
      equal(sWithout.box, [4, 0, 8, 4]) && sWithout.max_spatial_run_cells === 4 &&
      sWithout.samples.length === 16 &&
      sWithout.samples.every(sample => sample.rear_weight === 1 && equal(sample.rear_rgb, REAR) &&
        equal(sample.distances, [200, 200]) && sample.counted) &&
      !withoutOccluder.reading.unmeasured.some(u => u.frame === 'setup') &&
      sOpaque.status === 'FAIL' && sOpaque.boundary_cells === 8 &&
      sOpaque.geometric_px === 8 && sOpaque.raw_px === 8 && sOpaque.px === 8 &&
      equal(sOpaque.box, [4, 0, 6, 4]) && sOpaque.max_spatial_run_cells === 4 &&
      sOpaque.samples.length === 8 &&
      sOpaque.samples.every(sample => (sample.x === 4.5 || sample.x === 5.5) &&
        sample.rear_weight === 1 && equal(sample.rear_rgb, REAR) &&
        equal(sample.distances, [200, 200]) && sample.counted) &&
      !withOpaqueOccluder.reading.unmeasured.some(u => u.frame === 'setup') &&
      withOpaqueOccluder.problems.some(p => p.code === BEHIND_SEAM_CODE && p.object === 'pair "a|b" setup standing' && p.detail.includes('setup (8 cells)')),
    brief(withoutOccluder, withOpaqueOccluder));

  // Half-alpha variant (alpha = 128, a = 128/255, keep = 1 - 128/255 = 127/255):
  // - Alpha 128 !== 255 so none of the 8 covered cells (x = 6.5, 7.5 x 4 rows) is removed from `surviving`.
  // - On the 8 covered cells, `rear.alpha[k]` and `weights.get(k).get('rear')` are scaled by `keep = 127/255`,
  //   leaving `rear_weight = 127/255` and straight `rear_rgb = [224, 232, 240]` (distance 200 to both endpoints and
  //   to the closed-gap recomposite). On the 8 uncovered cells (x = 4.5, 5.5 x 4 rows), `rear_weight = 1`.
  // - All 16 gap cells remain in `surviving` and count: geometric_px = 16, raw_px = 16, px = 16, box = [4, 0, 8, 4].
  const withHalfOccluder = measured(behindPartialLaterOccluderFixture(128));
  const sHalf = withHalfOccluder.pair.setup!.standing;
  const uncoveredSamples = sHalf.samples.filter(sample => sample.x === 4.5 || sample.x === 5.5);
  const coveredSamples = sHalf.samples.filter(sample => sample.x === 6.5 || sample.x === 7.5);
  say('BHO02_LATER_HALF_ALPHA_PART_OVER_PARTIAL_GAP_KEEPS_ALL_CELLS_AND_SCALES_COVERED_REAR_WEIGHT',
    sHalf.status === 'FAIL' && sHalf.boundary_cells === 8 &&
      sHalf.geometric_px === 16 && sHalf.raw_px === 16 && sHalf.px === 16 &&
      equal(sHalf.box, [4, 0, 8, 4]) && sHalf.max_spatial_run_cells === 4 &&
      sHalf.samples.length === 16 && uncoveredSamples.length === 8 && coveredSamples.length === 8 &&
      uncoveredSamples.every(sample => sample.rear_weight === 1 && equal(sample.rear_rgb, REAR) &&
        equal(sample.distances, [200, 200]) && sample.counted &&
        sample.contributors.length === 1 && sample.contributors[0].slot === 'rear' && sample.contributors[0].weight === 1) &&
      coveredSamples.every(sample => Math.abs(sample.rear_weight - 127 / 255) <= Number.EPSILON &&
        equal(sample.rear_rgb, REAR) && equal(sample.distances, [200, 200]) && sample.counted &&
        sample.contributors.length === 1 && sample.contributors[0].slot === 'rear' &&
        Math.abs(sample.contributors[0].weight - 127 / 255) <= Number.EPSILON) &&
      !withHalfOccluder.reading.unmeasured.some(u => u.frame === 'setup') &&
      withHalfOccluder.problems.some(p => p.code === BEHIND_SEAM_CODE && p.object === 'pair "a|b" setup standing' && p.detail.includes('setup (16 cells)')),
    brief(withHalfOccluder));
}

/** Issue #1409: the exact serialized readings of three band pairs at the commit that added contact-edge support. A band pair
 * never enters the contact branch, so these bytes are a fixed expectation, not a second run of the same code. */
const BAND_READING_SHA256 = 'f8adc2d092d461b8baaeb53a55854df21705f0384772c3d1da98dc173dba5558';

/** Issue #1409: 7c with b moved dx cells right on idle frame 1 (a [0,4)x[0,4), b [4,8)x[0,4); contact only at setup). */
function contactMovedFixture(dx: number): BehindSeamFixture {
  const rear = rectangle('rear', -2, -2, 26, 8);
  const a = rectangle('a', 0, 0, 4, 4), b = rectangle('b', 4, 0, 4, 4);
  const pages = new Map([['rear', plate(26, 8, REAR)], ['a', plate(4, 4, FRONT)], ['b', plate(4, 4, FRONT)]]);
  const setup = [rear, a, b];
  return matchingFixture(pages, setup, [setup, [rear, a, shifted(b, dx, 0)], setup]);
}

/** Issue #1409: 7b (contact on the 3 top rows, a 6 x 7 painted notch below) with b one cell right ('widen') or every part one
 * cell right ('shift') on idle frame 1; withC adds a third part c, drawn behind both, that fills the notch. */
function behind7bMovedFixture(mode: 'static' | 'widen' | 'shift', withC = false): BehindSeamFixture {
  const base = behind7bFixture();
  const [rear, a, b] = base.setup.pieces;
  const pages = new Map(base.pages);
  const behind = [rear];
  if (withC) { pages.set('c', plate(6, 7, MID)); behind.push(rectangle('c', 4, 0, 6, 7)); }
  const setup = [...behind, a, b];
  const peak = mode === 'widen' ? [...behind, a, shifted(b, 1, 0)] : mode === 'shift' ? setup.map(p => shifted(p, 1, 0)) : setup;
  return matchingFixture(pages, setup, [setup, peak, setup]);
}

/** Issue #1409, faint overlap: a [0,5) whose last column (x = 4) is alpha 96, b [4,8). symmetric: b's first column is alpha 96 too,
 * so no cell is drawn at 128/255 by either member alone next to the other; otherwise b is opaque there. */
function behindFaintFixture(symmetric: boolean, widen: boolean): BehindSeamFixture {
  const rear = rectangle('rear', -2, -2, 26, 8);
  const a = rectangle('a', 0, 0, 5, 4), b = rectangle('b', 4, 0, 4, 4);
  const pa = plate(5, 4, FRONT), pb = plate(4, 4, FRONT);
  for (let y = 0; y < 4; y++) { pa.set(4, y, [...FRONT, 96]); if (symmetric) pb.set(0, y, [...FRONT, 96]); }
  const pages = new Map([['rear', plate(26, 8, REAR)], ['a', pa], ['b', pb]]);
  const setup = [rear, a, b];
  return matchingFixture(pages, setup, [setup, widen ? [rear, a, shifted(b, 1, 0)] : setup, setup]);
}

/** Issue #1409: 7c static, where b draws a second fragment (its own bottom half) on idle frame 1 when extra is set. */
function behindFragmentFixture(extra: boolean): BehindSeamFixture {
  const fx = contactMovedFixture(0);
  if (extra) {
    const [rear, a, b] = fx.frames[1].pieces;
    fx.frames[1] = { ...fx.frames[1], pieces: [rear, a, b, { ...b, world: [4, 0, 4, 2, 8, 2, 8, 0], uvs: [0, 1, 0, 0.5, 1, 0.5, 1, 1] }] };
  }
  return fx;
}

/** Issue #1409 review: `piece` as the same quad drawn as a mesh, and with `clipped` marked as a clip's cut (`Mesh.source`). The
 * source is each drawn triangle itself, so the picture and the vertices are unchanged: only the clip mark differs. */
function asMesh(piece: Piece, clipped: boolean): Piece {
  const triangles = [0, 1, 2, 2, 3, 0];
  const corner = (values: ArrayLike<number>) => triangles.flatMap(i => [values[i * 2], values[i * 2 + 1]]);
  return { kind: 'mesh', slot: piece.slot, page: piece.page, tint: piece.tint, world: Array.from(piece.world), uvs: Array.from(piece.uvs), triangles,
    ...(clipped ? { source: { world: corner(piece.world), uvs: corner(piece.uvs) } } : {}) };
}

/** Case A (b one cell right on idle frame 1) with b drawn as a mesh, clipped at setup or on idle frame 1 (or nowhere). */
function contactClippedFixture(where: 'none' | 'setup' | 'frame'): BehindSeamFixture {
  const fx = contactMovedFixture(1);
  const swap = (f: SeamFrame, clipped: boolean): SeamFrame => ({ ...f, pieces: f.pieces.map(p => p.slot === 'b' ? asMesh(p, clipped) : p) });
  return { ...fx, setup: swap(fx.setup, where === 'setup'), frames: fx.frames.map((f, i) => swap(f, where === 'frame' && i === 1)) };
}

const HOLE_NO_SUPPORT_IDLE = 'HOLE: stock transported setup-overlap support is unavailable on every idle frame; motion-opened is not measured';

export function runBehindContactChecks(dir: string, say: Say, rigc: RigcRunner): void {
  const T: BehindSeams = { threshold: 12 };
  const NC: Partial<BehindSeamsFramesInput> = { plantNoContact: true };
  const held = (r: ReturnType<typeof measured>): boolean => r.pair.motion_opened.status === 'SKIP' && r.pair.motion_support === undefined &&
    r.reading.unmeasured.length === 3 && r.reading.unmeasured.every(u => u.reason === HOLE_NO_SUPPORT_IDLE) &&
    r.problems.length === 3 && r.problems.every(p => p.code === BEHIND_SEAM_UNMEASURED_CODE);

  // Case A, by hand: 4 contact edges at x = 4; b +1 sweeps each to [4, 5]; the 4 centres x = 4.5 are drawn by neither member and
  // carried back by a's map onto b's setup material: frames [0, 4, 0], box [4, 0, 5, 4], no lower bound.
  const caseA = measured(contactMovedFixture(1), T), caseAHeld = measured(contactMovedFixture(1), T, NC);
  const fA = caseA.pair.frames[1].motion_opened;
  say('BHC02_CONTACT_ONLY_MEMBER_MOVES_ONE_CELL_AWAY_FAILS_4_REAR_CELLS',
    caseA.reading.status === 'FAIL' && equal(caseA.pair.frames.map(f => f.motion_opened.px), [0, 4, 0]) &&
      equal(fA.box, [4, 0, 5, 4]) && fA.boundary_cells === 4 && fA.lower_bound_cells === undefined &&
      caseA.pair.motion_opened.lower_bound_frames === undefined &&
      caseA.pair.motion_support === CONTACT_MOTION_SUPPORT && caseA.pair.frames.every(f => f.motion_support === CONTACT_MOTION_SUPPORT) &&
      caseA.reading.limitations.endsWith(CONTACT_LIMITATIONS) && caseA.reading.unmeasured.length === 0 &&
      caseA.problems.length === 1 && caseA.problems[0].code === BEHIND_SEAM_CODE && caseA.problems[0].object === 'pair "a|b" motion_opened' &&
      held(caseAHeld),
    brief(caseA, caseAHeld));

  // Case B and static, by hand: under a common shift both maps carry each edge to x = 5 (a segment: no cell centre); with
  // nothing moving each edge stays at x = 4. Both read 0 and the line PASSes; plantNoContact returns both to the HOLE.
  const caseB = measured(shiftAllPieces(behind7cFixture(false), 1), T), caseBHeld = measured(shiftAllPieces(behind7cFixture(false), 1), T, NC);
  const still = measured(behind7cFixture(false), T), stillHeld = measured(behind7cFixture(false), T, NC);
  say('BHC03_CONTACT_ONLY_COMMON_SHIFT_AND_STATIC_PAIRS_PASS',
    caseB.reading.status === 'PASS' && caseB.problems.length === 0 && caseB.pair.motion_opened.status === 'PASS' &&
      caseB.pair.motion_opened.max_px === 0 && caseB.pair.motion_support === CONTACT_MOTION_SUPPORT &&
      still.reading.status === 'PASS' && still.problems.length === 0 && still.pair.motion_opened.max_px === 0 &&
      held(caseBHeld) && held(stillHeld),
    brief(caseB, still, caseBHeld, stillHeld));

  // Third part, by hand: 7b's contact is the 3 top rows (x = 4, rows 7..9); b +1 opens x = 4.5 there: 3 cells, box [4, 7, 5, 10].
  // The 42-cell notch (painted background, or c behind both) is outside every sweep and is never counted. Common shift and
  // static read 0.
  const t1 = measured(behind7bMovedFixture('widen'), T), t2 = measured(behind7bMovedFixture('widen', true), T);
  const t3 = measured(behind7bMovedFixture('shift', true), T), t0 = measured(behind7bMovedFixture('static'), T);
  say('BHC04_PAINTED_AREA_BETWEEN_MEMBERS_IS_NEVER_COUNTED_ONLY_THE_CONTACT_ROWS',
    [t1, t2].every(r => r.reading.status === 'FAIL' && equal(r.pair.frames.map(f => f.motion_opened.px), [0, 3, 0]) &&
      equal(r.pair.frames[1].motion_opened.box, [4, 7, 5, 10]) && r.pair.motion_support === CONTACT_MOTION_SUPPORT) &&
      [t3, t0].every(r => r.reading.status === 'PASS' && r.pair.motion_opened.max_px === 0 && r.problems.length === 0),
    brief(t1, t2, t3, t0));

  // No band and no contact (7a, b +1): the named HOLE, its text unchanged, no marker, LIMITATIONS unchanged.
  const fx7a = behind7aFixture('behind');
  const n = measured({ ...fx7a, frames: [fx7a.frames[0], frame(fx7a.setup.pieces.map(p => p.slot === 'b' ? shifted(p, 1, 0) : p), 1), fx7a.frames[2]] }, T);
  say('BHC05_NO_BAND_AND_NO_CONTACT_KEEPS_THE_NAMED_HOLE_TEXT',
    held(n) && n.reading.status === 'FAIL' && !n.reading.limitations.includes(CONTACT_LIMITATIONS),
    brief(n));

  // Lower bound, by hand: b +10 exposes 4 rows x 10 columns = 40 rear cells inside the sweeps [4, 14]; a's map carries x in [4, 8)
  // and b's map x in [10, 14) back onto setup material: 32 counted; x in [8, 10) is carried back by neither: 8 uncounted.
  const far = measured(contactMovedFixture(10), T);
  say('BHC06_A_SEPARATION_PAST_THE_MEMBER_WIDTH_CARRIES_ITS_LOWER_BOUND',
    far.reading.status === 'FAIL' && equal(far.pair.frames.map(f => f.motion_opened.px), [0, 32, 0]) &&
      equal(far.pair.frames.map(f => f.motion_opened.lower_bound_cells), [undefined, 8, undefined]) &&
      far.pair.motion_opened.lower_bound_frames === 1 &&
      far.lines.some(l => l.includes(`support ${CONTACT_MOTION_SUPPORT}, lower bound on 1 frame(s)`)) &&
      fA.lower_bound_cells === undefined,
    brief(far));

  // A member drawing a second fragment on a frame is refused by name on that frame; the one-fragment control reads.
  const frag = measured(behindFragmentFixture(true), T), whole = measured(behindFragmentFixture(false), T);
  say('BHC07_A_MEMBER_WITH_TWO_FRAGMENTS_IS_REFUSED_BY_NAME',
    frag.reading.status === 'FAIL' && equal(frag.pair.frames.map(f => f.motion_opened.status), ['PASS', 'SKIP', 'PASS']) &&
      frag.reading.unmeasured.length === 1 && frag.reading.unmeasured[0].frame === 'idle frame 1' &&
      frag.reading.unmeasured[0].reason === 'HOLE: setup contact support requires one drawn fragment per pair member: pair "a|b" member "b" draws 2 fragments on idle frame 1; 1 is required; motion-opened is not measured' &&
      frag.problems.length === 1 && frag.problems[0].code === BEHIND_SEAM_UNMEASURED_CODE && frag.problems[0].object === 'a|b (idle frame 1)' &&
      whole.reading.status === 'PASS' && whole.pair.motion_support === CONTACT_MOTION_SUPPORT,
    brief(frag, whole));

  // Issue #1409 review: a clipped member's drawing is the clip's cut, not its attachment's vertices, so it is not carried.
  // b drawn as a mesh, otherwise identical: unclipped it reads case A ([0, 4, 0]); clipped on idle frame 1 that frame is a
  // named HOLE; clipped at setup every idle frame is.
  const clipHole = (where: string): string => `HOLE: setup contact support requires unclipped pair members: pair "a|b" member "b" is cut by a clip ${where}, so its drawing is no longer its attachment's and cannot be carried through its attachment map; motion-opened is not measured`;
  const meshWhole = measured(contactClippedFixture('none'), T), clipFrame = measured(contactClippedFixture('frame'), T);
  const clipSetup = measured(contactClippedFixture('setup'), T);
  say('BHC11_A_CLIPPED_CONTACT_MEMBER_IS_REFUSED_BY_NAME',
    meshWhole.reading.status === 'FAIL' && equal(meshWhole.pair.frames.map(f => f.motion_opened.px), [0, 4, 0]) &&
      meshWhole.pair.motion_support === CONTACT_MOTION_SUPPORT && meshWhole.reading.unmeasured.length === 0 &&
      clipFrame.reading.status === 'FAIL' && equal(clipFrame.pair.frames.map(f => f.motion_opened.status), ['PASS', 'SKIP', 'PASS']) &&
      clipFrame.pair.frames[1].motion_opened.px === 0 && clipFrame.pair.frames[1].motion_support === undefined &&
      clipFrame.reading.unmeasured.length === 1 && clipFrame.reading.unmeasured[0].frame === 'idle frame 1' &&
      clipFrame.reading.unmeasured[0].reason === clipHole('on idle frame 1') &&
      clipFrame.problems.length === 1 && clipFrame.problems[0].code === BEHIND_SEAM_UNMEASURED_CODE && clipFrame.problems[0].object === 'a|b (idle frame 1)' &&
      clipSetup.pair.motion_opened.status === 'SKIP' && clipSetup.pair.motion_support === undefined &&
      clipSetup.reading.unmeasured.length === 3 && clipSetup.reading.unmeasured.every(u => u.reason === clipHole('at setup')),
    brief(meshWhole, clipFrame, clipSetup));

  // Faint overlap, by hand. Symmetric: both members draw x = 4 at 96/255 on 4 rows: no band, no contact edge (x = 4 is drawn by
  // neither at 128/255), so a named HOLE that says why. Asymmetric: b draws x = 4 opaque, a at 96: a-only x = 3 borders b-only
  // x = 4, so 4 contact edges; b +1 sweeps x = 4.5, but a's 96/255 edge still draws there, so the all-behind-hidden render is
  // not transparent and motion_opened counts 0 of its 4 support cells.
  const faintHole = 'HOLE: pair "a|b" has no overlap band and no setup contact edge: its members overlap only below 128/255 at setup (4 cell(s) drawn by both at positive alpha, none by both at 128/255 or more, and no cell drawn by one member alone borders a cell drawn by the other alone); motion-opened is not measured';
  const faintSym = measured(behindFaintFixture(true, true), T), faintAsym = measured(behindFaintFixture(false, true), T);
  say('BHC08_A_FAINT_OVERLAP_PAIR_HAS_A_NAMED_HOLE_OR_READS_ITS_CONTACT_EDGES',
    faintSym.reading.status === 'FAIL' && faintSym.pair.motion_opened.status === 'SKIP' && faintSym.pair.motion_support === undefined &&
      [0, 1, 2].every(i => faintSym.reading.unmeasured.some(u => u.frame === `idle frame ${i}` && u.reason === faintHole)) &&
      !faintSym.reading.unmeasured.some(u => u.reason === HOLE_NO_SUPPORT_IDLE) &&
      faintAsym.reading.status === 'PASS' && faintAsym.pair.motion_support === CONTACT_MOTION_SUPPORT &&
      equal(faintAsym.pair.frames.map(f => f.motion_opened.boundary_cells), [0, 4, 0]) &&
      equal(faintAsym.pair.frames.map(f => f.motion_opened.px), [0, 0, 0]),
    brief(faintSym, faintAsym));

  // Production path: a contact-only rig through checkStage. back stops at crop row 40 where front starts; the carrier lifts back
  // 4 rows on idle frame 1 over the 12 shared columns (crop x 20..31): 4 x 12 = 48 rear cells (by hand).
  const input = join(dir, 'input');
  writeBehindSeamCheckRig(input, false, true);
  const req = join(dir, 'req.json');
  writeFileSync(req, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [], behind_seams: { threshold: 0 } }) + '\n');
  const report = checkStage({ rig: input, out: join(dir, 'out'), requirements: req, noExtremes: true }, rigc, 'fixture-rigc', () => {});
  const block = report.behindSeams, pair = block?.pairs.find(p => p.pair === 'back|front');
  say('BHC09_CONTACT_ONLY_RIG_THROUGH_CHECK_STAGE_COUNTS_48_CELLS',
    block !== null && block !== undefined && block.status === 'FAIL' && pair !== undefined && pair.motion_support === CONTACT_MOTION_SUPPORT &&
      pair.motion_opened.max_px === 48 && pair.motion_opened.worst?.index === 1 && pair.setup?.standing.status === 'PASS' &&
      report.problems.some(p => p.code === BEHIND_SEAM_CODE && p.object === 'pair "back|front" motion_opened'),
    JSON.stringify({ reading: block === null || block === undefined ? null : summary(block), problems: report.problems.map(p => [p.code, p.object]) }));

  const bandBytes = JSON.stringify([measured(behindMotionFixture(), { threshold: 0 }), measured(behindMotionFixture(true), { threshold: 0 }),
    measured(behind7bFixture(true), T)].map(r => ({ reading: r.reading, problems: r.problems })));
  const bandDigest = createHash('sha256').update(bandBytes).digest('hex');
  say('BHC01_BAND_PAIR_READINGS_ARE_BYTE_IDENTICAL_TO_THE_FIXED_EXPECTATION', bandDigest === BAND_READING_SHA256,
    JSON.stringify({ sha256: bandDigest, bytes: bandBytes.length }));
}

/** Issue #1406: four horizontal rows, each with an owner-3 left endpoint at x = 3 (world x = 3.5),
 * `gap` low-alpha interior cells at x = 4 .. 3 + gap (world x = 4.5 .. 3.5 + gap), and an owner-2
 * right endpoint at x = 4 + gap (world x = 4.5 + gap), with a closed-gap FRONT recomposite over the
 * full width so every interior cell has dRecomposite = 200 > T. */
export function behindWideAmbiguousFixture(gap: number): BehindSeamFixture {
  const width = 8 + gap;
  const rear = rectangle('rear', -1, -1, width + 4, 6);
  const a = rectangle('a', 0, 0, width, 4), b = rectangle('b', 0, 0, width, 4);
  const pa = new Plate(width, 4), pb = new Plate(width, 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) pa.set(x, y, [...FRONT, 255]);
    for (let x = 4 + gap; x < width; x++) pb.set(x, y, [...FRONT, 255]);
    pb.set(3, y, [...FRONT, 255]);
  }
  const setup = [rear, a, b];
  const recomposite = frame([{ ...rectangle('recomposite', -1, -1, width + 4, 6), page: 'recomposite' }], 0);
  return {
    ...fixture(new Map([['rear', plate(width + 4, 6, REAR)], ['a', pa], ['b', pb], ['recomposite', plate(width + 4, 6, FRONT)]]), setup, [setup]),
    recomposite,
  };
}

/** Issue #1406: four horizontal rows with distinct gap lengths (row 0 = 1, row 1 = 64, row 2 = 65, row 3 = 510),
 * so one setup frame exercises below-cap, exact-cap, cap+1 and 510-cell corridors together. */
export function behindMixedLengthAmbiguousFixture(gaps: readonly [number, number, number, number] = [1, 64, 65, 510]): BehindSeamFixture {
  const maxGap = Math.max(...gaps), width = 8 + maxGap;
  const rear = rectangle('rear', -1, -1, width + 4, 6);
  const a = rectangle('a', 0, 0, width, 4), b = rectangle('b', 0, 0, width, 4);
  const pa = new Plate(width, 4), pb = new Plate(width, 4);
  for (let y = 0; y < 4; y++) {
    const g = gaps[y];
    for (let x = 0; x < 4; x++) pa.set(x, y, [...FRONT, 255]);
    for (let x = 4 + g; x < width; x++) pb.set(x, y, [...FRONT, 255]);
    pb.set(3, y, [...FRONT, 255]);
  }
  const setup = [rear, a, b];
  const recomposite = frame([{ ...rectangle('recomposite', -1, -1, width + 4, 6), page: 'recomposite' }], 0);
  return {
    ...fixture(new Map([['rear', plate(width + 4, 6, REAR)], ['a', pa], ['b', pb], ['recomposite', plate(width + 4, 6, FRONT)]]), setup, [setup]),
    recomposite,
  };
}

/** Issue #1406: synthetic SxS one-pair rig that maximises unread corridors at setup:
 * p0 and p1 both paint a 1-px opaque perimeter [24,48,72,255] with a transparent (S-2)x(S-2) interior
 * (owner = 3 on all 4*(S-1) perimeter cells, low() = true on all (S-2)^2 interior cells), while
 * images/rear.png is REAR [224,232,240,255] and parts/rear.png is FRONT [24,48,72,255] (pixel (0,0)
 * transparent for A19), giving dRecomposite = 200 > T on all (S-2)^2 interior cells and producing
 * 2*(S-2) unread corridors (S-2 horizontal + S-2 vertical) of cell_count = S-2 each. */
export function writeMaxUnreadBehindSeamCheckRig(dir: string, S = 512): { rigDir: string; reqPath: string } {
  const rigDir = join(dir, 'rig');
  rmSync(rigDir, { recursive: true, force: true });
  mkdirSync(join(rigDir, 'images'), { recursive: true });
  mkdirSync(join(rigDir, 'parts'), { recursive: true });
  const rearImg = newRaster(S, S), rearPart = newRaster(S, S);
  for (let i = 1; i < S * S; i++) {
    rearImg.data.set([...REAR, 255], i * 4);
    rearPart.data.set([...FRONT, 255], i * 4);
  }
  writePng(join(rigDir, 'images', 'rear.png'), rearImg);
  writePng(join(rigDir, 'parts', 'rear.png'), rearPart);
  const frontRaster = newRaster(S, S);
  for (let x = 0; x < S; x++) {
    frontRaster.data.set([...FRONT, 255], x * 4);
    frontRaster.data.set([...FRONT, 255], ((S - 1) * S + x) * 4);
  }
  for (let y = 1; y < S - 1; y++) {
    frontRaster.data.set([...FRONT, 255], (y * S) * 4);
    frontRaster.data.set([...FRONT, 255], (y * S + (S - 1)) * 4);
  }
  for (const name of ['p0', 'p1']) {
    writePng(join(rigDir, 'images', `${name}.png`), frontRaster);
    writePng(join(rigDir, 'parts', `${name}.png`), frontRaster);
  }
  const stage = { x: -S / 2, y: 0, width: S, height: S };
  const center = { x: stage.x + S / 2, y: stage.y + cropToSpineY(S / 2, S) };
  const partOrder = ['rear', 'p0', 'p1'];
  writeFileSync(join(rigDir, 'rig.json'), JSON.stringify({
    spec: 'rigc-rig/1',
    name: 'unread_probe',
    images: 'images',
    skeleton: stage,
    bones: [{ name: 'root', x: 0, y: 0 }],
    slots: partOrder.map(name => ({ name, bone: 'root', attachment: name })),
    skins: { default: Object.fromEntries(partOrder.map(name => [name, { [name]: { image: `${name}.png`, x: center.x, y: center.y } }])) },
  }) + '\n');
  writeFileSync(join(rigDir, 'motion.json'), JSON.stringify({
    spec: 'rigc-motion/1',
    archetype: 'unread_probe',
    cut: 'unread_probe',
    easings: {},
    groups: {},
    animations: { idle: { duration: 1 / 12, loop: true, tracks: [{ bone: 'root', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 1 / 12, v: [0] }] }] } },
  }) + '\n');
  writeFileSync(join(rigDir, 'parts.json'), serializeParts({
    rig_size: [S, S],
    scale_rig_per_source: 1,
    parts: partOrder.map(name => ({
      name,
      from: 'full:topwear',
      x: 0,
      y: 0,
      w: S,
      h: S,
      opaque_px: name === 'rear' ? S * S - 1 : 4 * (S - 1),
      projected_core_px: 0,
      source_px_taken: 0,
      refused_drift_px: 0,
      merged_px: 0,
      seam_override_px: 0,
    })),
    motion_seams: [{ part: 'p0', neighbour: 'p1' }],
    ghost_px: {},
  }));
  const reqPath = join(dir, 'requirements.json');
  writeFileSync(reqPath, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [], behind_seams: { threshold: 12 } }) + '\n');
  return { rigDir, reqPath };
}

const withoutCorridorCells = (reading: BehindSeamsMeasured): string =>
  JSON.stringify(reading, (key, value) => key === 'cells' || key === 'cells_omitted' ? undefined : value);

function runBehindUnreadCorridorCapChecks(dir: string, say: Say, rigc: RigcRunner): void {
  const rowYs = [3.5, 2.5, 1.5, 0.5];
  // 1. Exactly 64 cells per corridor: 64 entries, no cells_omitted, bytes identical to uncapped/fixed expectation.
  const fx64 = behindWideAmbiguousFixture(64);
  const capped64 = measured(fx64, { threshold: 12 }), open64 = measured(fx64, { threshold: 12 }, { sampleCap: Infinity });
  const c64 = capped64.pair.setup!.standing.unread_corridors ?? [];
  const expected64 = rowYs.map((y, r) => ({
    [CHECK_ROW_FAMILY]: 'BEHIND_PART_SEAMS.unread_corridors',
    row_scope: 'pair',
    row_kind: 'evidence',
    row_subjects: ['a', 'b'],
    axis: 'horizontal',
    endpoints: [[4, r + 1, 3.5, y, 3], [69, r + 1, 68.5, y, 2]],
    cells: Array.from({ length: 64 }, (_, i) => [4.5 + i, y]),
    cell_count: 64,
  }));
  const bytes64 = serializeCheckRows({ [BEHIND_SEAM_LINE]: capped64.reading });
  const openBytes64 = serializeCheckRows({ [BEHIND_SEAM_LINE]: open64.reading });
  say('BHK01_CORRIDOR_OF_64_CELLS_HAS_NO_CELLS_OMITTED_AND_SERIALIZES_IDENTICALLY',
    c64.length === 4 &&
      c64.every(c => c.cells.length === 64 && c.cell_count === 64 && c.cells_omitted === undefined && !Object.hasOwn(c, 'cells_omitted')) &&
      capped64.pair.setup!.standing.unread_cells === 256 && open64.pair.setup!.standing.unread_cells === 256 &&
      serializeCheckRows(c64) === serializeCheckRows(expected64) &&
      bytes64 === openBytes64 && !bytes64.includes('cells_omitted'),
    JSON.stringify({ corridors: c64.length, cell_count: c64[0]?.cell_count, kept: c64[0]?.cells.length,
      unread_cells: capped64.pair.setup!.standing.unread_cells, bytes: bytes64.length, identical: bytes64 === openBytes64 }));

  // 2. Corridors of 65 and 510 cells: 64 entries kept, cells_omitted 1 and 446, cell_count 65 and 510,
  // evenlySpaced first (index 0) and last (index floor(63*n/64): 63 for 65, 502 for 510) cells present, order kept, unread_cells unchanged.
  const fx65 = behindWideAmbiguousFixture(65), fx510 = behindWideAmbiguousFixture(510);
  const capped65 = measured(fx65, { threshold: 12 }), open65 = measured(fx65, { threshold: 12 }, { sampleCap: Infinity });
  const capped510 = measured(fx510, { threshold: 12 }), open510 = measured(fx510, { threshold: 12 }, { sampleCap: Infinity });
  const c65 = capped65.pair.setup!.standing.unread_corridors ?? [], o65 = open65.pair.setup!.standing.unread_corridors ?? [];
  const c510 = capped510.pair.setup!.standing.unread_corridors ?? [], o510 = open510.pair.setup!.standing.unread_corridors ?? [];
  const idx65 = evenlySpaced(65, BEHIND_SAMPLE_CAP), idx510 = evenlySpaced(510, BEHIND_SAMPLE_CAP);
  const checkOverCap = (corridors: typeof c65, uncapped: typeof o65, n: number, idx: number[]): boolean =>
    corridors.length === 4 && uncapped.length === 4 &&
    corridors.every((c, r) => {
      const y = rowYs[r];
      const full = Array.from({ length: n }, (_, i) => [4.5 + i, y] as [number, number]);
      return c.cells.length === BEHIND_SAMPLE_CAP && c.cell_count === n && c.cells_omitted === n - BEHIND_SAMPLE_CAP &&
        uncapped[r].cells.length === n && uncapped[r].cell_count === n && uncapped[r].cells_omitted === undefined &&
        equal(uncapped[r].cells, full) && equal(c.cells, idx.map(i => full[i])) &&
        equal(c.cells[0], full[idx[0]]) && equal(c.cells[BEHIND_SAMPLE_CAP - 1], full[idx[BEHIND_SAMPLE_CAP - 1]]) &&
        c.cells.every((pt, i) => pt[1] === y && (i === 0 || pt[0] > c.cells[i - 1][0]));
    });
  say('BHK02_CORRIDORS_OF_65_AND_510_KEEP_64_EVENLY_SPACED_CELLS_IN_ORDER_AND_PRESERVE_COUNTS',
    idx65[0] === 0 && idx65[63] === 63 && idx510[0] === 0 && idx510[63] === 502 &&
      checkOverCap(c65, o65, 65, idx65) && checkOverCap(c510, o510, 510, idx510) &&
      capped65.pair.setup!.standing.unread_cells === 4 * 65 && open65.pair.setup!.standing.unread_cells === 4 * 65 &&
      capped510.pair.setup!.standing.unread_cells === 4 * 510 && open510.pair.setup!.standing.unread_cells === 4 * 510 &&
      withoutCorridorCells(capped65.reading) === withoutCorridorCells(open65.reading) &&
      withoutCorridorCells(capped510.reading) === withoutCorridorCells(open510.reading),
    JSON.stringify({
      c65: { count: c65[0]?.cell_count, kept: c65[0]?.cells.length, omitted: c65[0]?.cells_omitted, first: c65[0]?.cells[0], last: c65[0]?.cells[63], unread_cells: capped65.pair.setup!.standing.unread_cells },
      c510: { count: c510[0]?.cell_count, kept: c510[0]?.cells.length, omitted: c510[0]?.cells_omitted, first: c510[0]?.cells[0], last: c510[0]?.cells[63], unread_cells: capped510.pair.setup!.standing.unread_cells },
    }));

  // 3. Multi-corridor invariant: cells.length + (cells_omitted ?? 0) === cell_count across mixed lengths [1, 64, 65, 510].
  const mixedFx = behindMixedLengthAmbiguousFixture([1, 64, 65, 510]);
  const mixedCapped = measured(mixedFx, { threshold: 12 }), mixedOpen = measured(mixedFx, { threshold: 12 }, { sampleCap: Infinity });
  const mc = mixedCapped.pair.setup!.standing.unread_corridors ?? [], mo = mixedOpen.pair.setup!.standing.unread_corridors ?? [];
  const invariantHolds = (corridors: typeof mc): boolean =>
    corridors.every(c => c.cells.length <= BEHIND_SAMPLE_CAP &&
      c.cells.length + (c.cells_omitted ?? 0) === c.cell_count &&
      (c.cell_count <= BEHIND_SAMPLE_CAP ? !Object.hasOwn(c, 'cells_omitted') : c.cells_omitted === c.cell_count - BEHIND_SAMPLE_CAP));
  say('BHK03_MULTI_CORRIDOR_INVARIANT_AND_CELL_CEILING_HOLD_AND_FAIL_WHEN_UNCAPPED',
    mc.length === 4 && equal(mc.map(c => c.cell_count), [1, 64, 65, 510]) &&
      equal(mc.map(c => c.cells.length), [1, 64, 64, 64]) &&
      equal(mc.map(c => c.cells_omitted ?? null), [null, null, 1, 446]) &&
      mixedCapped.pair.setup!.standing.unread_cells === 1 + 64 + 65 + 510 &&
      mixedOpen.pair.setup!.standing.unread_cells === 1 + 64 + 65 + 510 &&
      invariantHolds(mc) && invariantHolds(c64) && invariantHolds(c65) && invariantHolds(c510) &&
      !invariantHolds(mo) && !invariantHolds(o65) && !invariantHolds(o510),
    JSON.stringify({ counts: mc.map(c => c.cell_count), kept: mc.map(c => c.cells.length), omitted: mc.map(c => c.cells_omitted ?? null),
      unread_cells: mixedCapped.pair.setup!.standing.unread_cells, uncapped_max: Math.max(...mo.map(c => c.cells.length)) }));

  // 4. Size control on the 512x512 one-pair hollow-perimeter rig through checkStage:
  // Hand derivation:
  // - 512x512 stage with a 1-px perimeter of owner 3 and a 510x510 low-alpha interior where dRecomposite = 200 > 12:
  //   510 horizontal + 510 vertical = 1,020 unread corridors, each of cell_count = 510, unread_cells = 510^2 = 260,100.
  // - With BEHIND_SAMPLE_CAP = 64: each corridor keeps 64 cells and omits 510 - 64 = 446 cells (65,280 kept cells total).
  // - Byte upper bound for check.json: 1,020 corridors * 64 cells * 90 B/cell = 5,875,200 B, plus 1,020 * 600 B corridor
  //   headers = 612,000 B, plus 112,800 B for the rest of check.json = 6,600,000 B ceiling (uncapped 520,200 cells is ~42.89 MB).
  const sizeHome = join(dir, 'unread-512');
  const { rigDir, reqPath } = writeMaxUnreadBehindSeamCheckRig(sizeHome, 512);
  const checkOut = join(sizeHome, 'check');
  const report = checkStage({ rig: rigDir, out: checkOut, requirements: reqPath, noExtremes: true }, rigc, 'fixture-rigc', () => {});
  const checkBytes = Buffer.byteLength(readFileSync(join(checkOut, 'check.json')));
  const behind = report.figures[BEHIND_SEAM_LINE] as BehindSeamsMeasured;
  const setupStanding = behind.pairs[0]?.setup?.standing;
  const setupCorridors = setupStanding?.unread_corridors ?? [];
  const BYTE_CEILING = 6_600_000;
  say('BHK04_512_SQUARE_MAX_UNREAD_RIG_KEEPS_EXACT_COUNTS_AND_WRITES_CHECK_JSON_UNDER_BOUND',
    setupStanding !== undefined && setupStanding.unread_cells === 260_100 &&
      setupCorridors.length === 1_020 &&
      setupCorridors.filter(c => c.axis === 'horizontal').length === 510 &&
      setupCorridors.filter(c => c.axis === 'vertical').length === 510 &&
      setupCorridors.every(c => c.cell_count === 510 && c.cells.length === 64 && c.cells_omitted === 446 &&
        c.cells.length + (c.cells_omitted ?? 0) === c.cell_count) &&
      checkBytes < BYTE_CEILING,
    JSON.stringify({ corridors: setupCorridors.length, unread_cells: setupStanding?.unread_cells,
      kept_cells: setupCorridors.reduce((s, c) => s + c.cells.length, 0),
      omitted_cells: setupCorridors.reduce((s, c) => s + (c.cells_omitted ?? 0), 0),
      check_json_bytes: checkBytes, ceiling_bytes: BYTE_CEILING }));
}

export function runBehindSeamChecks(dir: string, say: Say, rigc: RigcRunner): void {
  mkdirSync(dir, { recursive: true });
  runBehindSeamFixtureChecks(say);
  runBehindSampleCapChecks(say);
  runBehindSeamPrimitiveChecks(say);
  runBehindLaterOpaqueArtChecks(say);
  runBehindUnreadCorridorCapChecks(dir, say, rigc);
  runBehindTurnPrimitiveChecks(say);
  runBehindUnreadRemedyChecks(say);
  runBehindRecompositeChecks(join(dir, 'recomposite'), say, rigc);
  runBehindSeamRequirementChecks(dir, say);
  runBehindSeamIntegrationChecks(join(dir, 'pipeline'), say, rigc);
  runBehindContactChecks(join(dir, 'contact'), say, rigc);
}
