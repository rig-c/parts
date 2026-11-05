/** Generated crop-edge controls: exact integer samples, no authored boundaries. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assemble, skippedBy, stageFields, type AssembleResult } from '../src/assemble.ts';
import { loadConfig } from '../src/config.ts';
import { readWrapperLayers } from '../src/layers.ts';
import { readPng } from '../src/raster/png.ts';
import { assembleConfig, C, flatPainting, writeAssembleFixture } from './assemble_fixture.ts';

export function writeCropEdgeFixture(dir: string, reach = 16): void {
  mkdirSync(dir, { recursive: true });
  const layer = (inset: number) => [{ name: 'back hair', depth: 0.5, rects: [{ x0: inset, y0: inset, x1: 64 - inset, y1: 64 - inset, colour: C }] }];
  writeAssembleFixture(dir, assembleConfig({ headBox: [32, 32, 96, 96], plan: [['hair_back', 'head', 'back hair']], extend: [] }), flatPainting(), { full: layer(16 - reach), head: layer(0) });
}

export function cropEdgeBuild(dir: string, declared: boolean): AssembleResult {
  const file = join(dir, declared ? 'config-declared.json' : 'config.json');
  if (declared) {
    const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as { assemble: { extend_below_crop: unknown } };
    config.assemble.extend_below_crop = [{ part: 'hair_back', run: 'full', tag: 'back hair', edges: ['left', 'right', 'top', 'bottom'] }];
    writeFileSync(file, JSON.stringify(config));
  }
  const cfg = loadConfig(file);
  return assemble({ source: readPng(join(dir, 'painting.png')), full: readWrapperLayers(join(dir, 'full')), head: readWrapperLayers(join(dir, 'head')), ...stageFields(cfg),
    seamRule: 'near-white', projectRule: 'core' });
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
  let insideChanged = 0, unexpected = 0, newRestFlags = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const old = rgbaAt(base, x, y), next = rgbaAt(head, x, y);
    const inside = x >= 16 && x < 48 && y >= 16 && y < 48;
    if (inside && old.some((v, c) => v !== next[c])) insideChanged++;
    if (next[3] >= 128) {
      if (x < 16) counts.left++;
      if (x >= 48) counts.right++;
      if (y < 16) counts.top++;
      if (y >= 48) counts.bottom++;
    }
    if (next.some((v, c) => v !== [...C, 255][c])) unexpected++;
    const p = (y * 64 + x) * 4;
    const flagged = (r: AssembleResult): boolean => C.some((v, c) => Math.abs(r.recomposite.data[p + c] - v) > 40);
    if (flagged(head) && !flagged(base)) newRestFlags++;
  }
  say('AS260_EXPLICIT_CROP_EDGES_KEEP_INSIDE_AND_COPY_ALL_FOUR_OUTSIDES', Object.values(counts).every(n => n === 1024) && insideChanged === 0,
    JSON.stringify({ counts, insideChanged, colourDeparturesFromFlatPainting: unexpected, expectedPerEdge: 16 * 64 }));
  say('AS261_EXPLICIT_CROP_EDGES_ADD_NO_REST_FLAGS', newRestFlags === 0 && head.figures.errorPx === 0 && base.figures.errorPx === 3072,
    JSON.stringify({ newRestFlags, baseline: base.figures.errorPx, declared: head.figures.errorPx }));
  const propose = (d: string): { edges?: string[] }[] => {
    const run = spawnSync(process.execPath, ['cli.ts', 'assemble', '--config', join(d, 'config.json'), '--source', join(d, 'painting.png'), '--full', join(d, 'full'), '--head', join(d, 'head'), '--propose-plan'], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`crop proposal exited ${run.status}: ${run.stdout}${run.stderr}`);
    return (JSON.parse(run.stdout) as { extend_below_crop: { edges?: string[] }[] }).extend_below_crop;
  };
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
  const fractionalConfig = JSON.parse(readFileSync(join(fractional, 'config.json'), 'utf8')) as { seethrough: { head_box: number[] } };
  fractionalConfig.seethrough.head_box = [33, 33, 97, 97];
  writeFileSync(join(fractional, 'config.json'), JSON.stringify(fractionalConfig));
  const halfBase = cropEdgeBuild(fractional, false), halfHead = cropEdgeBuild(fractional, true);
  const halfCounts = { left: 0, right: 0, top: 0, bottom: 0 };
  let halfInsideChanged = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const next = rgbaAt(halfHead, x, y), old = rgbaAt(halfBase, x, y);
    if (x >= 16.5 && x < 48.5 && y >= 16.5 && y < 48.5 && next.some((v, c) => v !== old[c])) halfInsideChanged++;
    if (next[3] < 128) continue;
    if (x < 16.5) halfCounts.left++;
    if (x >= 48.5) halfCounts.right++;
    if (y < 16.5) halfCounts.top++;
    if (y >= 48.5) halfCounts.bottom++;
  }
  say('AS265_CROP_EDGES_KEEP_FRACTIONAL_BOUNDARIES', halfCounts.left === 17 * 64 && halfCounts.right === 15 * 64 && halfCounts.top === 17 * 64 && halfCounts.bottom === 15 * 64 && halfInsideChanged === 0,
    JSON.stringify({ halfCounts, halfInsideChanged, bounds: [16.5, 16.5, 48.5, 48.5] }));
  const reason = skippedBy('back hair', [['hair_back', 'head', 'back hair']], [{ part: 'hair_back', run: 'full', tag: 'back hair', edges: ['left'] }], null, 44, null);
  say('AS266_CROP_COVERAGE_REASON_NAMES_EXPLICIT_EDGES_WITHOUT_BOTTOM_SEEDING', reason.includes('edges [left]') && reason.includes('alpha >= 128') && !reason.includes('probe') && !reason.includes('reaches it nowhere'), reason);
  const proposed = propose(positive), under = propose(negative);
  say('AS262_CROP_PROPOSAL_USES_EACH_EDGE_AND_EXCLUDES_UNDER_EIGHT', JSON.stringify(proposed[0]?.edges) === JSON.stringify(['left', 'right', 'top', 'bottom']) && under.length === 0,
    JSON.stringify({ proposed, under, positiveReach: 16, negativeReach: 3 }));
  say('AS263_CROP_NOTICE_NAMES_UNCOVERED_EDGES_ONLY', base.cropClipped?.length === 1 && base.cropClipped[0].includes('3072 uncovered px') && ['left 1024', 'right 1024', 'top 1024', 'bottom 1024'].every(e => base.cropClipped![0].includes(e)) && head.cropClipped?.length === 0,
    JSON.stringify({ omitted: base.cropClipped, declared: head.cropClipped }));
}
