/**
 * Issue #1473 (#884, second half): the source texels a pose shows that the
 * See-through run recorded as hidden or could not decide.
 *
 * A part with `source_visibility` carries a per-texel state map
 * (`source_state_map`, src/sourcestates.ts). `occluded` there means the run's
 * own layers hid that material in the painting: it is the run's guess at what
 * lies under a front layer, not paint the artist was seen to put down.
 * `partial-top`, `depth-tie` and `mixed-source-states` are material the record
 * could not decide. In the setup pose a part's occluded texels normally lie
 * under the part that hid them; a key that moves that part away shows them.
 *
 * The reading, frame by frame, on the gated build, through rig-c's own
 * renderer (`@rig-c/core/render-shared`) at stage scale 1 — the setup pose and
 * every animation of the build at the check's fps:
 *
 * - a stage pixel is DRAWN by a piece when `rasterisePiece` paints it at
 *   {@link DRAWN_ALPHA} of 255 or more with the piece's own page and tint —
 *   rig-c's own `drawnCells` test;
 * - a pixel is the piece's UNCOVERED pixel when that piece is the last one in
 *   the frame's draw order to draw it: no piece drawn after it reaches half
 *   opacity there;
 * - the pixel SHOWS a state when the same piece, re-seated through its own art
 *   UVs on an indicator page made from its map (alpha 255 on the texels of that
 *   state, 0 elsewhere, tint 1), is painted there at alpha above 0: some texel
 *   the renderer's sampler weights for that pixel holds the state.
 *
 * Both readings are the renderer's arithmetic on the posed frame, not a
 * geometric estimate of where a texel lands. A count is of stage pixels at
 * scale 1, which equals texels where a piece is drawn unscaled and pixel
 * aligned. A pixel whose sampled texels hold two of the states counts for
 * each. Nothing here is a pass without an authored limit.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Plate } from '@rig-c/core/plate';
import { DRAWN_ALPHA } from '@rig-c/core/passthrough';
import type { Frame, Piece } from '@rig-c/core/render-shared';
import { seamSourceAttachment } from './check.ts';
import { checkRow, checkSlotParts, checkSlotRow } from './checkrow.ts';
import { PartsError, type Problem } from './errors.ts';
import { partImageReference, type PartRecord, type PartsFile } from './parts.ts';
import { readPng } from './raster/png.ts';
import { EXPOSED_SOURCE_STATES, readSourceStateMap, SOURCE_STATE, type ExposedSourceState } from './sourcestates.ts';

export const SOURCE_EXPOSURE_LINE = 'SOURCE_EXPOSURE';
export const SOURCE_EXPOSURE_CODE = 'CHECK_SOURCE_EXPOSURE';
export const SOURCE_EXPOSURE_UNMEASURED_CODE = 'CHECK_SOURCE_EXPOSURE_UNMEASURED';
const NO_LIMIT = 'no requirements file declares source_exposure.max_px, so this is a measurement, never a pass';

/** The one declaration: the most stage pixels of one state one part may show in one frame. No default exists. */
export interface SourceExposure {
  max_px: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const freeKey = (k: string, v: unknown): boolean => (k.startsWith('x-') && k.length > 2 && isObject(v)) || ((k === 'note' || k.endsWith('_note')) && typeof v === 'string');

/** Shape only: an object holding exactly an authored nonnegative safe integer `max_px` (and notes). */
export function sourceExposureProblems(value: unknown, at: string): Problem[] {
  if (!isObject(value)) return [{ code: 'REQUIREMENTS_FIELD', object: at, detail: `is ${JSON.stringify(value)?.slice(0, 40)}; requires {"max_px": <an authored nonnegative integer>}` }];
  const problems: Problem[] = [];
  for (const k of Object.keys(value)) if (k !== 'max_px' && !freeKey(k, value[k])) problems.push({ code: 'REQUIREMENTS_FIELD', object: `${at}.${k}`, detail: 'is not a field this block reads (max_px; note or *_note as a string; x-<name> as a record)' });
  const v = value.max_px;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) problems.push({ code: 'REQUIREMENTS_FIELD', object: `${at}.max_px`, detail: `is ${JSON.stringify(v)}; requires an authored nonnegative integer — the most stage pixels of one recorded-hidden or undecided state one part may show in one frame; no default is derived from the art` });
  return problems;
}

/** One part, one state, one frame with at least one pixel shown. */
export interface SourceExposureRow {
  part: string;
  state: ExposedSourceState;
  px: number;
  frame: string;
  animation: string | null;
  index: number;
  time: number;
}
export interface SourceExposureUnmeasured { slot: string; frame: string; reason: string }

export interface SourceExposureMeasured {
  /** REPORTED without a declared limit — a measurement, never a pass. */
  status: 'REPORTED' | 'PASS' | 'FAIL';
  instrument: string;
  reading: string;
  max_px: number | null;
  /** Primary parts whose map was read, in parts.json order. */
  parts: string[];
  /** How many of each mapped part's texels hold each reported state. */
  texels: Array<{ part: string } & Record<ExposedSourceState, number>>;
  frames: number;
  animations: string[];
  rows: SourceExposureRow[];
  unmeasured: SourceExposureUnmeasured[];
  alternates: 'not measured';
  reason?: string;
}

export interface SourceExposureInput {
  build: string;
  stage: { x: number; y: number; width: number; height: number };
  parts: PartsFile | null;
  /** The directory holding the part PNGs and their maps (`<--parts>/parts`). */
  partsDir: string;
  imagesDir: string;
  rig: Record<string, unknown>;
  fps: number;
}

type Api = Pick<typeof import('@rig-c/core/render-shared'), 'loadCandidate' | 'throughPoser' | 'sampleSetupPose' | 'sampleAnimation' | 'projector' | 'pageFor' | 'rasterisePiece'>;

/** True when some primary part carries a map: the only case the line is measured or written without a declaration. */
export function hasSourceStateMaps(parts: PartsFile | null): boolean {
  return parts !== null && parts.parts.some(p => p.source_state_map !== undefined);
}

/** Read every primary map before anything is rendered; a bad map is refused by name, all at once. */
export function readSourceStateMaps(parts: PartsFile, partsDir: string): Map<string, Uint8Array> {
  const maps = new Map<string, Uint8Array>();
  const problems: Problem[] = [];
  for (const part of parts.parts) {
    if (part.source_state_map === undefined) continue;
    try { maps.set(part.name, readSourceStateMap(partsDir, part, readPng(join(partsDir, `${part.name}.png`)))); }
    catch (e) { if (e instanceof PartsError) problems.push(...e.problems); else throw e; }
  }
  if (problems.length > 0) throw new PartsError(problems);
  return maps;
}

const frameLabel = (animation: string | null, frame: Frame): string =>
  animation === null ? 'setup' : `${animation} frame ${frame.index} (t ${+frame.time.toFixed(4)} s)`;

/**
 * Measure on the gated build. With `declared`, every row over `max_px` is one
 * CHECK_SOURCE_EXPOSURE problem and every unmeasured piece or absent map one
 * CHECK_SOURCE_EXPOSURE_UNMEASURED problem; without it nothing is a problem.
 */
export function measureSourceExposure(api: Api, input: SourceExposureInput, declared: SourceExposure | undefined, problems: Problem[]): SourceExposureMeasured {
  const instrument = `rigc renderer at stage scale 1: the setup pose and every animation of the build at ${input.fps} fps`;
  const reading = `a stage pixel is shown by a part when its piece is the last in draw order the renderer paints there at ${DRAWN_ALPHA}/255 or more, and the same piece re-seated on its source-state map paints a texel of that state there; counted per part, state and frame`;
  const base = { instrument, reading, max_px: declared?.max_px ?? null, alternates: 'not measured' as const };
  if (input.parts === null || !hasSourceStateMaps(input.parts)) {
    const reason = input.parts === null ? 'no parts.json was read' : 'no part in parts.json carries a source_state_map; assemble writes one for each part from a See-through run with a visibility record';
    if (declared !== undefined) problems.push({ code: SOURCE_EXPOSURE_UNMEASURED_CODE, object: 'requirements.source_exposure', detail: `${reason}; an untaken reading is never a pass` });
    return { status: declared === undefined ? 'REPORTED' : 'FAIL', ...base, parts: [], texels: [], frames: 0, animations: [], rows: [], unmeasured: [], reason };
  }
  const parts = input.parts;
  const maps = readSourceStateMaps(parts, input.partsDir);
  const records = new Map(parts.parts.map(p => [p.name, p]));
  const skeleton = join(input.build, 'skeleton.json'), atlas = join(input.build, 'skeleton.atlas');
  const candidate = api.loadCandidate({ skeletonText: readFileSync(skeleton, 'utf8'), atlasText: existsSync(atlas) ? readFileSync(atlas, 'utf8') : null, atlasDir: input.build, label: 'source exposure' }, { skeleton, atlas }, undefined);
  const opts = { geometry: true, texture: true };
  const W = input.stage.width, H = input.stage.height;
  const vp = { minX: input.stage.x, minY: input.stage.y, maxX: input.stage.x + W, maxY: input.stage.y + H, scale: 1, width: W, height: H };
  const project = api.projector(vp);
  const slotParts = checkSlotParts(input.rig, parts.parts.map(p => p.name), parts.alternates?.map(set => set.name) ?? []);
  // Per image: the indicator page of each reported state the map holds, padded as the rig image is.
  const indicators = new Map<string, { part: string; pages: Partial<Record<ExposedSourceState, Plate>> } | string>();
  const indicatorsOf = (image: string): { part: string; pages: Partial<Record<ExposedSourceState, Plate>> } | string => {
    const got = indicators.get(image);
    if (got !== undefined) return got;
    const name = image.replace(/\.png$/, '');
    const rec: PartRecord | undefined = records.get(name);
    const codes = maps.get(name);
    let out: { part: string; pages: Partial<Record<ExposedSourceState, Plate>> } | string;
    if (rec === undefined || codes === undefined) out = '';
    else {
      const rigPng = join(input.imagesDir, image);
      const rigImg = existsSync(rigPng) ? readPng(rigPng) : null;
      const dx = rigImg === null ? 0 : rigImg.width - rec.w, dy = rigImg === null ? 0 : rigImg.height - rec.h;
      if (rigImg === null) out = `the rig image "${image}" is absent`;
      else if (dx !== dy || dx < 0 || dx % 2 !== 0) out = `the rig image "${image}" is ${rigImg.width}x${rigImg.height}, not ${partImageReference(rec).path}'s ${rec.w}x${rec.h} with one even pad on every side`;
      else {
        const pad = dx / 2;
        const pages: Partial<Record<ExposedSourceState, Plate>> = {};
        for (const state of EXPOSED_SOURCE_STATES) {
          const code = SOURCE_STATE[state];
          if (!codes.includes(code)) continue;
          const plate = new Plate(rec.w + 2 * pad, rec.h + 2 * pad);
          for (let y = 0; y < rec.h; y++) for (let x = 0; x < rec.w; x++) {
            if (codes[y * rec.w + x] === code) plate.data.set([255, 255, 255, 255], ((y + pad) * plate.width + x + pad) * 4);
          }
          pages[state] = plate;
        }
        out = { part: name, pages };
      }
    }
    indicators.set(image, out);
    return out;
  };
  const unmeasured: SourceExposureUnmeasured[] = [];
  const unmeasuredSeen = new Set<string>();
  const rows: SourceExposureRow[] = [];
  const readFrame = (frame: Frame, animation: string | null): void => {
    const label = frameLabel(animation, frame);
    const top = new Int32Array(W * H).fill(-1);
    frame.pieces.forEach((piece, i) => api.rasterisePiece(api.pageFor(candidate.pages, piece), piece, project, vp, (x, y, _r, _g, _b, a) => { if (a >= DRAWN_ALPHA) top[y * W + x] = i; }));
    const counts = new Map<string, number>();
    frame.pieces.forEach((piece, i) => {
      const drawn = (frame.attachments ?? []).filter(a => a.slot === piece.slot);
      let image: string;
      try { image = drawn.length === 1 ? String(seamSourceAttachment(input.rig, piece.slot, String(drawn[0].attachment)).image) : ''; }
      catch { image = ''; }
      const source = image === '' ? '' : indicatorsOf(image);
      if (source === '') return; // a piece no mapped part draws: it covers, and is not read
      const fail = (reason: string): void => {
        const key = `${piece.slot}\u0000${reason}`;
        if (!unmeasuredSeen.has(key)) { unmeasuredSeen.add(key); unmeasured.push({ slot: piece.slot, frame: label, reason }); }
      };
      if (typeof source === 'string') { fail(source); return; }
      if (piece.kind === 'mesh' && piece.source !== undefined) { fail('the piece is clipped; a clipped piece has no art-UV source map'); return; }
      if (piece.texture === undefined || piece.texture.artUvs.length !== piece.uvs.length) { fail('the renderer gave no art UVs for the piece'); return; }
      for (const state of EXPOSED_SOURCE_STATES) {
        const plate = source.pages[state];
        if (plate === undefined) continue;
        const page = `source-exposure:${state}`;
        const { uvWindow: _window, dark: _dark, ...rest } = piece;
        const seated = { ...rest, page, tint: [1, 1, 1, 1], uvs: piece.texture.artUvs } as Piece;
        let n = 0;
        api.rasterisePiece(plate, seated, project, vp, (x, y, _r, _g, _b, a) => { if (a > 0 && top[y * W + x] === i) n++; });
        if (n > 0) counts.set(`${source.part}\u0000${state}`, (counts.get(`${source.part}\u0000${state}`) ?? 0) + n);
      }
    });
    for (const part of parts.parts) for (const state of EXPOSED_SOURCE_STATES) {
      const px = counts.get(`${part.name}\u0000${state}`);
      if (px !== undefined) rows.push({ part: part.name, state, px, frame: label, animation, index: frame.index, time: frame.time });
    }
  };
  const setup = api.throughPoser(candidate.choice, p => api.sampleSetupPose(p, opts)).value[0];
  readFrame(setup, null);
  let frames = 1;
  const animations = [...candidate.facts.animations];
  for (const animation of animations) {
    const sampled = api.throughPoser(candidate.choice, p => api.sampleAnimation(p, animation, input.fps, opts)).value;
    for (const frame of sampled) readFrame(frame, animation);
    frames += sampled.length;
  }
  const over = declared === undefined ? [] : rows.filter(r => r.px > declared.max_px);
  if (declared !== undefined) {
    for (const r of over) problems.push({ code: SOURCE_EXPOSURE_CODE, object: `part "${r.part}"`, detail: `shows ${r.px} stage px of ${r.state} source material at ${r.frame}; declared max_px ${declared.max_px} is required — keep the covering part over that material in this pose, paint the material (an under image or an edited part, so its texels leave the record), or raise source_exposure.max_px knowingly (AUTHORING, failure map)` });
    for (const u of unmeasured) problems.push({ code: SOURCE_EXPOSURE_UNMEASURED_CODE, object: `slot "${u.slot}" (${u.frame})`, detail: `${u.reason}; the exposure of its mapped part cannot be read, and an untaken reading is never a pass` });
  }
  const texels = parts.parts.filter(p => maps.has(p.name)).map(p => {
    const codes = maps.get(p.name) as Uint8Array;
    return { part: p.name, ...Object.fromEntries(EXPOSED_SOURCE_STATES.map(state => [state, codes.filter(c => c === SOURCE_STATE[state]).length])) } as { part: string } & Record<ExposedSourceState, number>;
  });
  return {
    status: declared === undefined ? 'REPORTED' : over.length === 0 && unmeasured.length === 0 ? 'PASS' : 'FAIL',
    ...base,
    parts: texels.map(t => t.part),
    texels,
    frames,
    animations,
    rows: rows.map(r => ({ ...r, ...checkRow('SOURCE_EXPOSURE.rows', 'part', declared !== undefined && r.px > declared.max_px, [r.part]) })),
    unmeasured: unmeasured.map(u => ({ ...u, ...checkSlotRow('SOURCE_EXPOSURE.unmeasured', declared !== undefined, u.slot, slotParts) })),
  };
}

/** The lines `check` prints for a written block. */
export function sourceExposureLines(line: SourceExposureMeasured): string[] {
  if (line.parts.length === 0) return [`${SOURCE_EXPOSURE_LINE}: ${line.status} — not measured: ${line.reason ?? 'no mapped part'}`];
  const worst = line.rows.reduce<SourceExposureRow | null>((w, r) => (w === null || r.px > w.px ? r : w), null);
  const limit = line.max_px === null ? NO_LIMIT : `declared max_px ${line.max_px} per part, state and frame`;
  const head = `${SOURCE_EXPOSURE_LINE}: ${line.status} — ${line.parts.length} part(s) with a source-state map, ${line.frames} frame(s) read (setup${line.animations.length === 0 ? '' : `, ${line.animations.join(', ')}`}); ` +
    `${line.rows.length} row(s)${worst === null ? ', no recorded-hidden or undecided texel shown' : `, worst part "${worst.part}" ${worst.state} ${worst.px} px at ${worst.frame}`}; ${limit}`;
  return [
    head,
    ...line.rows.map(r => `  shown part "${r.part}" ${r.state} ${r.px} px — ${r.frame}${line.max_px !== null && r.px > line.max_px ? ` > max_px ${line.max_px}` : ''}`),
    ...line.unmeasured.map(u => `  unmeasured slot "${u.slot}" — ${u.frame}: ${u.reason}`),
  ];
}
