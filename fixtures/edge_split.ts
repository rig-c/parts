/** Synthetic skirt-over-thigh fixture and controls for config.assemble.edge_splits (#1231). */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { assemble, DEFAULT_SEAM_RULE, edgeSplitLines, stageFields, type AssembleInput, type AssembleResult } from '../src/assemble.ts';
import { assembleStage } from '../src/build.ts';
import { parseConfig, parseEarlyConfig } from '../src/config.ts';
import type { EdgeSplit } from '../src/edgesplit.ts';
import { PartsError } from '../src/errors.ts';
import { exportLayers, type LayerSet } from '../src/layers.ts';
import { serializeParts } from '../src/parts.ts';
import { provenanceAddsUp } from '../src/provenance.ts';
import { writePng } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
import { readLayerTag } from '../src/tags.ts';
import { assembleConfig } from './assemble_fixture.ts';

export const SKIRT_RGB: readonly [number, number, number] = [45, 55, 110];
export const SKIN_RGB: readonly [number, number, number] = [235, 195, 175];
export const HEM_ROW = 31;
export const OVERRUN_ROWS = 4;
export const BAND_X0 = 16;
export const BAND_X1 = 48;
export const BAND_Y0 = 24;
export const BAND_Y1 = 40;
export const PLANTED_OVERRUN_PX = (BAND_X1 - BAND_X0) * OVERRUN_ROWS;

export const EDGE_SPLIT_DECLARATION: readonly EdgeSplit[] = [
  { over: 'skirt', under: 'thigh', band: [BAND_X0, BAND_Y0, BAND_X1, BAND_Y1] },
];

export function edgeSplitFixture(projectRule: 'core' | 'visible' = 'core'): AssembleInput {
  const width = 64, height = 64;
  const skirt = newRaster(width, height);
  const thigh = newRaster(width, height);
  const source = newRaster(width, height);
  source.data.fill(255);

  for (let y = 16; y <= HEM_ROW; y++) {
    for (let x = BAND_X0; x < BAND_X1; x++) {
      const p = (y * width + x) * 4;
      source.data.set([...SKIRT_RGB, 255], p);
      skirt.data.set([...SKIRT_RGB, 255], p);
    }
  }
  for (let y = HEM_ROW + 1; y < 52; y++) {
    for (let x = BAND_X0; x < BAND_X1; x++) {
      const p = (y * width + x) * 4;
      source.data.set([...SKIN_RGB, 255], p);
      if (y <= HEM_ROW + OVERRUN_ROWS) {
        skirt.data.set([...SKIRT_RGB, 255], p);
      } else {
        thigh.data.set([...SKIN_RGB, 255], p);
      }
    }
  }

  const entries = [
    { name: 'face', pixels: newRaster(width, height) },
    { name: 'eyewhite-r', pixels: newRaster(width, height) },
    { name: 'eyewhite-l', pixels: newRaster(width, height) },
    { name: 'legwear', pixels: thigh },
    { name: 'bottomwear', pixels: skirt },
  ];
  for (let k = 0; k < 3; k++) {
    for (let y = 2; y < 10; y++) {
      for (let x = 2 + k * 12; x < 10 + k * 12; x++) {
        const p = (y * width + x) * 4;
        entries[k].pixels.data.set([90, 90, 90, 255], p);
        source.data.set([90, 90, 90, 255], p);
      }
    }
  }

  const layers: LayerSet['layers'] = entries.map(({ name, pixels }, drawOrder) => {
    const tag = readLayerTag(name);
    if (tag === null) throw new Error('Generated fixture tag does not resolve');
    let opaquePx = 0;
    for (let p = 3; p < pixels.data.length; p += 4) if (pixels.data[p] > 8) opaquePx++;
    return { name, tag, pixels, file: null, left: 0, top: 0, right: width, bottom: height, depth: null, drawOrder, opaquePx };
  });
  const full: LayerSet = { form: 'wrapper', source: 'generated-skirt-hem', canvas: { w: width, h: height }, layers, hidden: [] };
  return {
    source,
    full,
    head: full,
    resolution: width,
    headBox: [0, 0, width, height],
    rigScale: 1,
    single: true,
    plan: [
      ['face', 'full', 'face'],
      ['eye_r', 'full', 'eyewhite-r'],
      ['eye_l', 'full', 'eyewhite-l'],
      ['thigh', 'full', 'legwear'],
      ['skirt', 'full', 'bottomwear'],
    ],
    extend: [],
    patches: [],
    cuts: [],
    seamRule: DEFAULT_SEAM_RULE,
    projectRule,
  };
}

export function edgeSplitConfig(declaration: unknown = EDGE_SPLIT_DECLARATION): Record<string, unknown> {
  const input = edgeSplitFixture();
  const cfg = assembleConfig({ plan: input.plan, extend: [], headBox: input.headBox, resolution: input.resolution, rigScale: input.rigScale });
  delete (cfg.seethrough as Record<string, unknown>).head_box;
  return { ...cfg, assemble: { ...(cfg.assemble as object), edge_splits: declaration } };
}

function samplePart(result: AssembleResult, name: string, x: number, y: number): [number, number, number, number] {
  const part = result.images.find(p => p.record.name === name);
  if (part === undefined) throw new Error(`Missing part ${name}`);
  const rx = x - part.record.x, ry = y - part.record.y;
  if (rx < 0 || ry < 0 || rx >= part.image.width || ry >= part.image.height) return [0, 0, 0, 0];
  const p = (ry * part.image.width + rx) * 4;
  return [part.image.data[p], part.image.data[p + 1], part.image.data[p + 2], part.image.data[p + 3]];
}

function problemsOf(run: () => unknown): PartsError | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof PartsError) return error;
    throw error;
  }
}

type Say = (name: string, pass: boolean, detail: string) => void;

export function runEdgeSplitConfigChecks(say: Say): void {
  const doors = [
    parseConfig,
    (raw: Record<string, unknown>) => parseEarlyConfig(raw, 'assemble'),
    (raw: Record<string, unknown>) => parseEarlyConfig(raw, 'layers'),
  ];
  say(
    'ES01_VALID_DECLARATION_LOADS_AT_EVERY_DOOR',
    doors.every(read => JSON.stringify(read(edgeSplitConfig()).assemble.edge_splits) === JSON.stringify(EDGE_SPLIT_DECLARATION)),
    'full, assemble and layers doors preserve config.assemble.edge_splits',
  );
  const bad: Array<{ name: string; value: unknown; code: string }> = [
    { name: 'not_array', value: true, code: 'CONFIG_FIELD_TYPE' },
    { name: 'null_entry', value: [null], code: 'CONFIG_FIELD_TYPE' },
    { name: 'missing_band', value: [{ over: 'skirt', under: 'thigh' }], code: 'CONFIG_FIELD_PRESENT' },
    { name: 'empty_over', value: [{ over: '', under: 'thigh', band: [16, 24, 48, 40] }], code: 'CONFIG_FIELD_TYPE' },
    { name: 'bad_band_order', value: [{ over: 'skirt', under: 'thigh', band: [48, 24, 16, 40] }], code: 'CONFIG_FIELD_TYPE' },
    { name: 'bad_band_negative', value: [{ over: 'skirt', under: 'thigh', band: [-1, 24, 48, 40] }], code: 'CONFIG_FIELD_TYPE' },
    { name: 'bad_band_float', value: [{ over: 'skirt', under: 'thigh', band: [16, 24, 48, 40.5] }], code: 'CONFIG_FIELD_TYPE' },
    { name: 'unknown_key', value: [{ over: 'skirt', under: 'thigh', band: [16, 24, 48, 40], extra: 1 }], code: 'CONFIG_KEY_KNOWN' },
    { name: 'unknown_over_part', value: [{ over: 'unknown_part', under: 'thigh', band: [16, 24, 48, 40] }], code: 'CONFIG_NAME_RESOLVES' },
    { name: 'unknown_under_part', value: [{ over: 'skirt', under: 'unknown_part', band: [16, 24, 48, 40] }], code: 'CONFIG_NAME_RESOLVES' },
    { name: 'same_over_and_under', value: [{ over: 'skirt', under: 'skirt', band: [16, 24, 48, 40] }], code: 'CONFIG_PART_UNIQUE' },
  ];
  for (const { name, value, code } of bad) {
    say(
      `ES02_REFUSES_${name.toUpperCase()}`,
      doors.every(read => problemsOf(() => read(edgeSplitConfig(value)))?.problems.some(p => p.code === code) === true),
      `every config door refused ${name} with ${code}`,
    );
  }
}

export function runEdgeSplitChecks(dir: string, say: Say): void {
  for (const projectRule of ['core', 'visible'] as const) {
    const baseInput = edgeSplitFixture(projectRule);
    const base = assemble(baseInput);
    const empty = assemble({ ...baseInput, edgeSplits: [] });
    say(
      `ES03_ABSENT_AND_EMPTY_ARE_BYTE_IDENTICAL_${projectRule.toUpperCase()}`,
      serializeParts(base.parts) === serializeParts(empty.parts) &&
        base.images.every((p, i) => Buffer.from(p.image.data).equals(Buffer.from(empty.images[i].image.data))),
      `project=${projectRule}: empty edgeSplits matches omitted declaration byte-for-byte`,
    );

    let unsplitOverBelowHem = 0;
    for (let y = HEM_ROW + 1; y < BAND_Y1; y++) {
      for (let x = BAND_X0; x < BAND_X1; x++) {
        if (samplePart(base, 'skirt', x, y)[3] >= 128) unsplitOverBelowHem++;
      }
    }
    const split = assemble({ ...baseInput, edgeSplits: EDGE_SPLIT_DECLARATION });
    const reading = split.edgeSplits[0];
    let splitOverBelowHem = 0;
    let underSkinMatched = 0;
    let aboveHemUnchanged = true;
    for (let y = 16; y <= HEM_ROW; y++) {
      for (let x = BAND_X0; x < BAND_X1; x++) {
        if (samplePart(split, 'skirt', x, y).join(',') !== samplePart(base, 'skirt', x, y).join(',')) aboveHemUnchanged = false;
      }
    }
    for (let y = HEM_ROW + 1; y < BAND_Y1; y++) {
      for (let x = BAND_X0; x < BAND_X1; x++) {
        if (samplePart(split, 'skirt', x, y)[3] > 0) splitOverBelowHem++;
        const u = samplePart(split, 'thigh', x, y);
        if (y <= HEM_ROW + OVERRUN_ROWS && u[0] === SKIN_RGB[0] && u[1] === SKIN_RGB[1] && u[2] === SKIN_RGB[2] && u[3] === 255) {
          underSkinMatched++;
        }
      }
    }
    say(
      `ES04_HEMSPLIT_MOVES_OVERRUN_TO_UNDER_${projectRule.toUpperCase()}`,
      unsplitOverBelowHem === PLANTED_OVERRUN_PX &&
        reading !== undefined &&
        reading.columns === BAND_X1 - BAND_X0 &&
        reading.edge_share >= 0.9 &&
        reading.moved_px === PLANTED_OVERRUN_PX &&
        reading.y_star_min === HEM_ROW &&
        reading.y_star_max === HEM_ROW &&
        reading.over_below_edge_px === 0 &&
        splitOverBelowHem === 0 &&
        underSkinMatched === PLANTED_OVERRUN_PX &&
        aboveHemUnchanged &&
        split.parts.parts.every(p => provenanceAddsUp(p.provenance!, p.opaque_px)),
      `project=${projectRule}: unsplit overrun=${unsplitOverBelowHem}, moved_px=${reading?.moved_px}, edge_share=${reading?.edge_share}, y*=${reading?.y_star_min}..${reading?.y_star_max}, over_below_edge_px=${reading?.over_below_edge_px}, underSkinMatched=${underSkinMatched}`,
    );
  }

  const offCanvas = problemsOf(() =>
    assemble({ ...edgeSplitFixture(), edgeSplits: [{ over: 'skirt', under: 'thigh', band: [16, 24, 65, 40] }] }),
  );
  say(
    'ES05_OFF_CANVAS_BAND_REFUSED',
    offCanvas?.problems.some(p => p.code === 'ASSEMBLE_PAINTING_BAND_INSIDE') === true,
    `off-canvas x1=65 refused with ASSEMBLE_PAINTING_BAND_INSIDE`,
  );

  const tieInput = edgeSplitFixture('core');
  for (let x = BAND_X0; x < BAND_X1; x++) {
    for (let y = 24; y < 40; y++) {
      const p = (y * 64 + x) * 4;
      const rgb = y <= 28 ? [40, 40, 40] : y <= 31 ? [140, 140, 140] : [240, 240, 240];
      tieInput.source.data.set([...rgb, 255], p);
    }
  }
  const tieRes = assemble({ ...tieInput, edgeSplits: EDGE_SPLIT_DECLARATION });
  say(
    'ES07_TIE_BREAK_KEEPS_TOPMOST_ROW',
    tieRes.edgeSplits[0]?.y_star_min === 28 &&
      tieRes.edgeSplits[0]?.y_star_max === 28 &&
      tieRes.edgeSplits[0]?.moved_px === (BAND_X1 - BAND_X0) * (HEM_ROW + OVERRUN_ROWS - 28),
    `tie between y=28 and y=31 (both step 100) resolved to topmost y*=${tieRes.edgeSplits[0]?.y_star_min}`,
  );

  const stageDir = join(dir, 'stage');
  const input = edgeSplitFixture('core');
  exportLayers(input.full, join(stageDir, 'full'));
  writePng(join(stageDir, 'painting.png'), input.source);
  writeFileSync(join(stageDir, 'config.json'), JSON.stringify(edgeSplitConfig()));
  const logs: string[] = [];
  const stageRes = assembleStage(
    { config: join(stageDir, 'config.json'), source: join(stageDir, 'painting.png'), full: join(stageDir, 'full'), head: null },
    {
      partsJson: join(stageDir, 'parts.json'),
      partsDir: join(stageDir, 'parts'),
      recomposite: join(stageDir, 'recomposite.png'),
      errorMap: join(stageDir, 'error.png'),
    },
    line => logs.push(line),
  );
  const expectedLine = edgeSplitLines(stageRes.edgeSplits)[0];
  say(
    'ES06_ASSEMBLE_STAGE_REPORT_AND_CONSOLE_LINE',
    stageRes.edgeSplits.length === 1 &&
      expectedLine !== undefined &&
      logs.includes(expectedLine) &&
      expectedLine.includes(`columns=${BAND_X1 - BAND_X0}`) &&
      expectedLine.includes('edge_share=1') &&
      expectedLine.includes(`moved=${PLANTED_OVERRUN_PX} px`) &&
      expectedLine.includes(`y*=${HEM_ROW}..${HEM_ROW}`) &&
      expectedLine.includes('over_below_edge_px=0') &&
      readFileSync(join(stageDir, 'parts.json'), 'utf8').length > 0,
    expectedLine ?? 'missing console line',
  );
}

try {
  describe('config.assemble.edge_splits (#1231)', () => {
    test('config doors accept valid edge_splits and refuse unknown parts, bad bands, and unknown keys', () => {
      const results: Array<{ name: string; pass: boolean; detail: string }> = [];
      runEdgeSplitConfigChecks((name, pass, detail) => results.push({ name, pass, detail }));
      for (const r of results) {
        expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
      }
    });

    test('synthetic skirt-over-thigh fixture splits at the painted hem under core and visible projection', () => {
      const dir = mkdtempSync(join(tmpdir(), 'edge-split-'));
      try {
        const results: Array<{ name: string; pass: boolean; detail: string }> = [];
        runEdgeSplitChecks(dir, (name, pass, detail) => results.push({ name, pass, detail }));
        for (const r of results) {
          expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
} catch {
  // Imported outside the bun test runner (e.g. selftest or CLI harness).
}
