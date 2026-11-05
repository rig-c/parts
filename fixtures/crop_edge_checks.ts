/** Generated crop-edge controls: exact samples and independently derived domains. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as assembleOps from '../src/assemble.ts';
import { assemble, skippedBy, stageFields, type AssembleResult, type PlanProposal } from '../src/assemble.ts';
import { loadConfig } from '../src/config.ts';
import { readWrapperLayers } from '../src/layers.ts';
import { encodePngBytes, readPng } from '../src/raster/png.ts';
import { assembleConfig, C, flatPainting, writeAssembleFixture, writeRun } from './assemble_fixture.ts';

// A retained head-border sample differs from the full layer without crossing
// the rest-error or seam-override thresholds. Copying full RGBA inside is visible.
const HEAD_COLOUR: typeof C = [C[0] + 20, C[1], C[2]];

export function writeCropEdgeFixture(dir: string, reach = 16): void {
  mkdirSync(dir, { recursive: true });
  const layer = (inset: number, colour: typeof C) => [{ name: 'back hair', depth: 0.5, rects: [{ x0: inset, y0: inset, x1: 64 - inset, y1: 64 - inset, colour }] }];
  writeAssembleFixture(dir, assembleConfig({ headBox: [32, 32, 96, 96], plan: [['hair_back', 'head', 'back hair']], extend: [] }), flatPainting(), { full: layer(16 - reach, C), head: layer(0, HEAD_COLOUR) });
}

/** Full layer reaches only below the crop; side/top proposal bytes must stay main's. */
export function writeBottomOnlyCropFixture(dir: string): void {
  writeCropEdgeFixture(dir);
  writeRun(join(dir, 'full'), [{ name: 'back hair', depth: 0.5, rects: [{ x0: 20, y0: 20, x1: 28, y1: 60, colour: C }] }]);
}

/** Identity-grid full layer: 20 rig px left, 6 below the actual crop bottom. */
export function writeMixedCropFixture(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'painting.png'), encodePngBytes(flatPainting()));
  writeFileSync(join(dir, 'config.json'), JSON.stringify(assembleConfig({ headBox: [32, 32, 96, 96], resolution: 128, rigScale: 1, plan: [['hair_back', 'head', 'back hair']], extend: [] })));
  writeRun(join(dir, 'full'), [{ name: 'back hair', depth: 0.5, rects: [{ x0: 12, y0: 40, x1: 64, y1: 102, colour: C }] }], 128);
  writeRun(join(dir, 'head'), [{ name: 'back hair', depth: 0.5, rects: [{ x0: 0, y0: 0, x1: 128, y1: 128, colour: HEAD_COLOUR }] }], 128);
}

export function proposeCropEdgeFixture(dir: string): { text: string; proposal: PlanProposal } {
  const run = spawnSync(process.execPath, ['cli.ts', 'assemble', '--config', join(dir, 'config.json'), '--source', join(dir, 'painting.png'), '--full', join(dir, 'full'), '--head', join(dir, 'head'), '--propose-plan'], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`crop proposal exited ${run.status}: ${run.stdout}${run.stderr}`);
  return { text: run.stdout, proposal: JSON.parse(run.stdout) as PlanProposal };
}

export function cropEdgeBuild(dir: string, declared: boolean): AssembleResult {
  const file = join(dir, declared ? 'config-declared.json' : 'config.json');
  if (declared) {
    const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as { assemble: { extend_below_crop: unknown } };
    config.assemble.extend_below_crop = [{ part: 'hair_back', run: 'full', tag: 'back hair', edges: ['left', 'right', 'top', 'bottom'] }];
    writeFileSync(file, JSON.stringify(config));
  }
  const cfg = loadConfig(file);
  return assemble({ source: readPng(join(dir, 'painting.png')), full: readWrapperLayers(join(dir, 'full')), head: readWrapperLayers(join(dir, 'head')), ...stageFields(cfg), seamRule: 'near-white', projectRule: 'core' });
}

function rgbaAt(result: AssembleResult, x: number, y: number): number[] {
  const part = result.images[0], r = part.record;
  if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) return [0, 0, 0, 0];
  const p = ((y - r.y) * r.w + x - r.x) * 4;
  return Array.from(part.image.data.subarray(p, p + 4));
}

export function runCropEdgeChecks(dir: string, say: (name: string, ok: boolean, detail: string) => void): void {
  const positive = join(dir, 'crop-positive'), negative = join(dir, 'crop-under-eight');
  writeCropEdgeFixture(positive);
  writeCropEdgeFixture(negative, 3);
  const base = cropEdgeBuild(positive, false), head = cropEdgeBuild(positive, true);
  const counts = { left: 0, right: 0, top: 0, bottom: 0 };
  let insideChanged = 0, contrast = 0, newRestFlags = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const old = rgbaAt(base, x, y), next = rgbaAt(head, x, y);
    const inside = x + 0.5 >= 16 && x + 0.5 < 48 && y + 0.5 >= 16 && y + 0.5 < 48;
    if (inside && old.some((v, c) => v !== next[c])) insideChanged++;
    if (inside && old[3] > 0 && old[0] !== C[0]) contrast++;
    if (next[3] >= 128) {
      if (x + 0.5 < 16) counts.left++;
      if (x + 0.5 >= 48) counts.right++;
      if (y + 0.5 < 16) counts.top++;
      if (y + 0.5 >= 48) counts.bottom++;
    }
    const p = (y * 64 + x) * 4;
    const flagged = (r: AssembleResult): boolean => C.some((v, c) => Math.abs(r.recomposite.data[p + c] - v) > 40);
    if (flagged(head) && !flagged(base)) newRestFlags++;
  }
  say('AS260_EXPLICIT_CROP_EDGES_KEEP_INSIDE_AND_COPY_ALL_FOUR_OUTSIDES', Object.values(counts).every(n => n === 16 * 64) && insideChanged === 0 && contrast > 0,
    JSON.stringify({ counts, insideChanged, contrastingInsideSamples: contrast, expectedPerEdge: 16 * 64 }));
  say('AS261_EXPLICIT_CROP_EDGES_ADD_NO_REST_FLAGS', newRestFlags === 0 && head.figures.errorPx === 0 && base.figures.errorPx === 3072,
    JSON.stringify({ newRestFlags, baseline: base.figures.errorPx, declared: head.figures.errorPx }));
  const invalid = [[], ['diagonal'], ['left', 'left']].map((edges, i) => {
    const config = JSON.parse(readFileSync(join(positive, 'config-declared.json'), 'utf8')) as { assemble: { extend_below_crop: { edges: unknown }[] } };
    config.assemble.extend_below_crop[0].edges = edges;
    const file = join(positive, `invalid-${i}.json`);
    writeFileSync(file, JSON.stringify(config));
    try { loadConfig(file); return false; } catch (error) { return String(error).includes('config.assemble.extend_below_crop[0].edges'); }
  });
  say('AS264_CROP_EDGES_REFUSE_EMPTY_UNKNOWN_AND_DUPLICATE_DECLARATIONS', invalid.every(Boolean), JSON.stringify(invalid));
  const fractional = join(dir, 'crop-half-pixel');
  writeCropEdgeFixture(fractional);
  const fractionalConfig = JSON.parse(readFileSync(join(fractional, 'config.json'), 'utf8')) as { seethrough: { head_box: number[] }; assemble: { rig_scale: number } };
  fractionalConfig.seethrough.head_box = [33, 33, 97, 97];
  writeFileSync(join(fractional, 'config.json'), JSON.stringify(fractionalConfig));
  const box = fractionalConfig.seethrough.head_box.map(v => v * fractionalConfig.assemble.rig_scale);
  const halfBase = cropEdgeBuild(fractional, false), halfHead = cropEdgeBuild(fractional, true);
  const halfCounts = { left: 0, right: 0, top: 0, bottom: 0 };
  const full = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) };
  for (let p = 0; p < 64 * 64; p++) full.data.set([...C, 255], p * 4);
  const selected = assembleOps.beyondCrop(full, box, ['left', 'right', 'top', 'bottom']);
  let halfInsideChanged = 0, selectedInside = 0, mutantInsideChanged = 0, boundarySamples = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const next = rgbaAt(halfHead, x, y), old = rgbaAt(halfBase, x, y), p = y * 64 + x;
    const inside = x + 0.5 >= box[0] && x + 0.5 < box[2] && y + 0.5 >= box[1] && y + 0.5 < box[3];
    if (inside) {
      if (next.some((v, c) => v !== old[c])) halfInsideChanged++;
      selectedInside += selected.data[p];
      if (x + 0.5 === box[0] || y + 0.5 === box[1]) boundarySamples++;
      // Planted old predicate: its copy must make the same inside oracle red.
      const asymmetric = x < box[0] || x >= box[2] || y < box[1] || y >= box[3];
      if (asymmetric && old.some((v, c) => v !== full.data[p * 4 + c])) mutantInsideChanged++;
    }
    if (next[3] < 128) continue;
    if (x + 0.5 < box[0]) halfCounts.left++;
    if (x + 0.5 >= box[2]) halfCounts.right++;
    if (y + 0.5 < box[1]) halfCounts.top++;
    if (y + 0.5 >= box[3]) halfCounts.bottom++;
  }
  // Integer centres in a half-open interval: first index ceil(edge - 1/2).
  const expected = { left: Math.ceil(box[0] - 0.5) * full.height, right: (full.width - Math.ceil(box[2] - 0.5)) * full.height, top: Math.ceil(box[1] - 0.5) * full.width, bottom: (full.height - Math.ceil(box[3] - 0.5)) * full.width };
  say('AS265_CROP_EDGES_KEEP_FRACTIONAL_BOUNDARIES', Object.entries(halfCounts).every(([edge, n]) => n === expected[edge as keyof typeof expected]) && halfInsideChanged === 0 && selectedInside === 0 && boundarySamples > 0,
    JSON.stringify({ halfCounts, expectedFromPixelCentres: expected, halfInsideChanged, selectedInside, boundarySamples, bounds: box }));
  say('AS267_ASYMMETRIC_CROP_COPY_FAILS_THE_INSIDE_BAR', halfInsideChanged === 0 && mutantInsideChanged > 0, JSON.stringify({ correctInsideChanged: halfInsideChanged, asymmetricInsideChanged: mutantInsideChanged }));
  const reason = skippedBy('back hair', [['hair_back', 'head', 'back hair']], [{ part: 'hair_back', run: 'full', tag: 'back hair', edges: ['left'] }], null, 44, null);
  say('AS266_CROP_COVERAGE_REASON_NAMES_EXPLICIT_EDGES_WITHOUT_BOTTOM_SEEDING', reason.includes('edges [left]') && reason.includes('alpha >= 128') && !reason.includes('probe') && !reason.includes('reaches it nowhere'), reason);
  const proposed = proposeCropEdgeFixture(positive).proposal.extend_below_crop, under = proposeCropEdgeFixture(negative).proposal.extend_below_crop;
  say('AS262_CROP_PROPOSAL_USES_EACH_EDGE_AND_EXCLUDES_UNDER_EIGHT', proposed.length === 2 && proposed[0].edges === undefined && JSON.stringify(proposed[1].edges) === JSON.stringify(['left', 'right', 'top']) && under.length === 0,
    JSON.stringify({ proposed, under, positiveExtentPixels: 16, negativeExtentPixels: 3 }));
  const bottomOnly = join(dir, 'crop-bottom-only');
  writeBottomOnlyCropFixture(bottomOnly);
  const bottomEntries = proposeCropEdgeFixture(bottomOnly).proposal.extend_below_crop;
  say('AS269_BOTTOM_ONLY_CROP_PROPOSAL_STAYS_LEGACY', bottomEntries.length === 1 && bottomEntries[0].edges === undefined, JSON.stringify(bottomEntries));
  const mixed = join(dir, 'crop-legacy-and-left');
  writeMixedCropFixture(mixed);
  const mixedEntries = proposeCropEdgeFixture(mixed).proposal.extend_below_crop;
  say('AS268_CROP_PROPOSAL_ADDS_SIDE_WITHOUT_REPLACING_LEGACY_BOTTOM', mixedEntries.length === 2 && mixedEntries[0].edges === undefined && JSON.stringify(mixedEntries[1].edges) === JSON.stringify(['left']), JSON.stringify({ mixedEntries, leftExtentPixels: 20, belowActualCrop: 6, belowLegacyLine: 10 }));
  say('AS263_CROP_NOTICE_NAMES_UNCOVERED_EDGES_ONLY', base.cropClipped?.length === 1 && base.cropClipped[0].includes('3072 uncovered px') && ['left 1024', 'right 1024', 'top 1024', 'bottom 1024'].every(e => base.cropClipped![0].includes(e)) && head.cropClipped?.length === 0,
    JSON.stringify({ omitted: base.cropClipped, declared: head.cropClipped }));
}
