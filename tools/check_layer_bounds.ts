#!/usr/bin/env bun
/** Analytical opacity controls; real readers and CLI, generated inputs only. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writePsdFixture } from '../fixtures/synthetic.ts';
import { bodyCoreBox, bodyOpaqueBox, CORE_ALPHA, layerCoreBox, layerFigures, layerOpaqueBox, OPAQUE_ALPHA_ABOVE, pct, readLayers, times, type Layer, type LayerSet, type OpaqueBox } from '../src/layers.ts';
import { CORE_ALPHA as ASSEMBLE_CORE_ALPHA, pixelOwners } from '../src/assemble.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
import { BODY_TAGS, HEAD_TAGS, readLayerTag } from '../src/tags.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
type Pixel = readonly [number, number, number];
const ROOT = resolve(import.meta.dir, '..');
const boxText = (b: OpaqueBox | null): string => b === null ? 'none' : [b.left, b.top, b.right, b.bottom].join(',');

function painted(name: string, left: number, top: number, width: number, height: number, points: readonly Pixel[]): Layer {
  const tag = readLayerTag(name);
  if (tag === null) throw new Error(`control names an unknown layer: ${name}`);
  const pixels = newRaster(width, height);
  for (const [x, y, alpha] of points) pixels.data.set([70, 90, 110, alpha], (y * width + x) * 4);
  return { name, tag, file: null, left, top, right: left + width, bottom: top + height, pixels, depth: 0.5, drawOrder: 0, opaquePx: points.filter(p => p[2] > 8).length };
}

const layerSet = (layers: Layer[]): LayerSet => ({ form: 'wrapper', source: 'synthetic', canvas: { w: 12, h: 10 }, layers: layers.map((l, i) => ({ ...l, drawOrder: i, depth: 1 - i / 100 })), hidden: [] });

function wrapper(dir: string, set: LayerSet): void {
  mkdirSync(dir, { recursive: true });
  const layers = set.layers.map((l, i) => {
    const filename = `${i}.png`;
    writeFileSync(join(dir, filename), encodePngBytes(l.pixels));
    return { name: l.name, filename, left: l.left, top: l.top, right: l.right, bottom: l.bottom, depth_median: l.depth };
  });
  writeFileSync(join(dir, 'layers.json'), JSON.stringify({ width: set.canvas.w, height: set.canvas.h, layers }));
}

/** Frozen 11-column formatter from the origin baseline, independent of the new CLI fields. */
function legacyLines(set: LayerSet): string[] {
  const figures = layerFigures(set);
  const rows = set.layers.map((l, i) => [String(l.drawOrder), l.name, l.tag.group, `${l.left},${l.top}`, `${l.right},${l.bottom}`, `${l.pixels.width}x${l.pixels.height}`, String(l.opaquePx), l.depth === null ? '-' : l.depth.toFixed(4), pct(figures[i].translucent), pct(figures[i].background), times(figures[i].areaRatio)]);
  const head = ['order', 'name', 'group', 'left,top', 'right,bottom', 'size', 'opaque_px', 'depth', 'translucent', 'background', 'area'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const line = (cells: string[]): string => `  ${cells.map((c, i) => c.padEnd(widths[i])).join('  ')}`.trimEnd();
  return [line(head), ...rows.map(line)];
}

function hasLegacyPrefix(old: string, current: string): boolean {
  const prefix = Buffer.from(old);
  const bytes = Buffer.from(current);
  return bytes.subarray(0, prefix.length).equals(prefix) && bytes.subarray(prefix.length, prefix.length + 2).equals(Buffer.from('  '));
}

export function runLayerBoundsChecks(dir: string, report: Say): number {
  let failed = 0;
  const say: Say = (name, ok, detail) => { if (!ok) failed++; report(name, ok, detail); };
  const normal = painted('topwear', 2, 3, 8, 6, [[1, 1, 250], [4, 3, 251]]);
  const foot = painted('footwear', 4, 8, 1, 1, [[0, 0, 255]]);
  const base = layerSet([normal, foot]);
  const expected = '3,4,7,7';
  say('LB01_OFFSET_BOTH_BOXES', boxText(layerOpaqueBox(normal)) === expected && boxText(layerCoreBox(normal)) === expected, 'alpha 250/251 at local (1,1) and (4,3), offset (2,3): both boxes [3,4,7,7), 4x3');
  say('LB02_CANVAS_BOX_DEFECT_IS_DISTINGUISHED', boxText(layerOpaqueBox(normal)) !== [normal.left, normal.top, normal.right, normal.bottom].join(','), 'the 8x6 manifest box includes transparent margins; it cannot stand for the opaque box');
  const threshold = painted('topwear', 2, 3, 3, 1, [[0, 0, 7], [1, 0, 8], [2, 0, 9]]);
  say('LB03_THRESHOLD_BELOW_EQUAL_ABOVE', OPAQUE_ALPHA_ABOVE === 8 && boxText(layerOpaqueBox(threshold)) === '4,3,5,4', '7 and 8 are excluded; only alpha 9 paints the one-pixel box');
  const coreBoundary = painted('topwear', 2, 3, 3, 1, [[0, 0, 249], [1, 0, 250], [2, 0, 251]]);
  say('LB18_CORE_INCLUSIVE_BOUNDARY_AND_EXISTING_EXPORT', CORE_ALPHA === 250 && CORE_ALPHA === ASSEMBLE_CORE_ALPHA && boxText(layerOpaqueBox(coreBoundary)) === '2,3,5,4' && boxText(layerCoreBox(coreBoundary)) === '3,3,5,4' && [...pixelOwners([coreBoundary.pixels], null)].join(',') === '-1,0,0', '249 is drawn but not CORE; 250/251 are CORE; assemble keeps its existing export and ownership comparison');
  const coreMargin = painted('topwear', 2, 3, 8, 6, [[0, 0, 249], [1, 1, 250], [4, 3, 251]]);
  say('LB19_CORE_MARGIN_DIFFERS_FROM_DRAWN', boxText(layerOpaqueBox(coreMargin)) === '2,3,7,7' && boxText(layerCoreBox(coreMargin)) === '3,4,7,7', 'the below-CORE source pixel extends only drawn(a>8); transparent margins and source offsets remain exact');
  const haze = layerSet([painted('topwear', 0, 0, 1, 1, [[0, 0, 8]]), painted('bottomwear', 0, 0, 1, 1, [[0, 0, 8]])]);
  say('LB04_MASK_UNION_IS_NOT_OVER_COMPOSITING', bodyOpaqueBox(haze) === null && 255 * (1 - (1 - 8 / 255) ** 2) > 8, 'both individual masks are empty even though the analytical over-composite alpha exceeds 8');
  const coreHaze = layerSet([painted('topwear', 0, 0, 1, 1, [[0, 0, 249]]), painted('bottomwear', 0, 0, 1, 1, [[0, 0, 249]])]);
  say('LB20_CORE_MASK_UNION_IS_NOT_OVER_COMPOSITING', bodyCoreBox(coreHaze) === null && boxText(bodyOpaqueBox(coreHaze)) === '0,0,1,1' && 255 * (1 - (1 - 249 / 255) ** 2) >= CORE_ALPHA, 'two alpha-249 masks cannot accumulate into the source CORE union, though their over-composite would cross 250');
  const empty = painted('neckwear', 0, 0, 12, 10, [[0, 0, 0]]);
  say('LB05_TRANSPARENT_RGB_HAS_NO_BOX', layerOpaqueBox(empty) === null && layerCoreBox(empty) === null && bodyOpaqueBox(layerSet([empty])) === null && bodyCoreBox(layerSet([empty])) === null, 'nonzero RGB with alpha 0 makes neither box nor either body-group height');
  const corner = painted('topwear', 0, 0, 12, 10, [[11, 9, 255]]);
  say('LB06_LAST_PIXEL_EXCLUSIVE_BOUNDS', boxText(layerOpaqueBox(corner)) === '11,9,12,10' && boxText(layerCoreBox(corner)) === '11,9,12,10', 'both thresholds retain exclusive right/bottom at the last canvas pixel');
  const union = bodyOpaqueBox(base);
  say('LB07_UNION_HEIGHT_NOT_SUM', boxText(union) === '3,4,7,9' && union !== null && union.bottom - union.top === 5 && boxText(bodyCoreBox(base)) === '3,4,7,9' && [bodyOpaqueBox, bodyCoreBox].every(fn => boxText(fn({ ...base, layers: [...base.layers].reverse() })) === '3,4,7,9'), 'rows 4..6 and row 8 span height 5 at both thresholds; layer heights sum to 4; order cannot change either union');
  for (const name of [...BODY_TAGS, 'handwear-r', 'handwear-l', 'hand-r', 'hand-l', 'drape-r', 'drape-l']) {
    const l = painted(name, 11, 9, 1, 1, [[0, 0, 255]]);
    say(`LB08_BODY_${name.replaceAll(' ', '_')}`, [bodyOpaqueBox, bodyCoreBox].every(fn => boxText(fn(layerSet([...base.layers, l]))) === '3,4,12,10'), 'both unions include this existing body tag even when it extends beyond the clothing');
  }
  const excluded = [...HEAD_TAGS, 'eyewhite-r', 'ears-l', 'author:probe'].map(name => painted(name, 0, 0, 1, 1, [[0, 0, 255]]));
  say('LB09_HEAD_AND_AUTHOR_EXCLUDED', [bodyOpaqueBox, bodyCoreBox].every(fn => excluded.every(l => boxText(fn(layerSet([...base.layers, l]))) === '3,4,7,9') && fn(layerSet(excluded)) === null), 'face, headwear, every head tag and author layers do not enter either body union');
  const hidden = { ...corner, name: 'topwear:hidden', of: 'topwear' };
  say('LB10_HIDDEN_ART_EXCLUDED', [bodyOpaqueBox, bodyCoreBox].every(fn => boxText(fn({ ...base, hidden: [hidden] })) === '3,4,7,9'), 'hidden art at the last canvas pixel never extends either drawn body-group union');

  const soft = painted('author:soft', 11, 9, 1, 1, [[0, 0, 249]]);
  const input = layerSet([...base.layers, empty, ...excluded.slice(0, 2), excluded.at(-1)!, soft]);
  const wrapperDir = join(dir, 'wrapper');
  wrapper(wrapperDir, input);
  const parsed = readLayers(wrapperDir);
  say('LB11_WRAPPER_REAL_READER', [bodyOpaqueBox, bodyCoreBox].every(fn => boxText(fn(parsed)) === '3,4,7,9') && [layerOpaqueBox, layerCoreBox].every(fn => boxText(fn(parsed.layers[0])) === expected), 'both cuts of the real PNG/manifest reading retain local raster dimensions and canvas offsets');
  const psd = join(dir, 'bounds.psd');
  writePsdFixture(psd, 12, 10, [normal, foot].map(l => ({ name: l.name, left: l.left, top: l.top, pixels: l.pixels })));
  const parsedPsd = readLayers(psd);
  say('LB12_PSD_REAL_READER', [bodyOpaqueBox, bodyCoreBox].every(fn => boxText(fn(parsedPsd)) === '3,4,7,9') && [layerOpaqueBox, layerCoreBox].every(fn => boxText(fn(parsedPsd.layers[0])) === expected), 'both cuts of the PSD reading retain source placement independently of manifest and depth');

  for (const path of [wrapperDir, psd]) {
    const result = spawnSync('bun', [join(ROOT, 'cli.ts'), 'layers', path], { cwd: ROOT, encoding: 'utf8' });
    const out = result.stdout ?? '';
    const lines = out.split('\n');
    const current = [lines.find(l => l.startsWith('  order  ')) ?? '', ...lines.filter(l => /^ {2}\d+ {2}/.test(l))];
    const legacy = legacyLines(readLayers(path));
    const label = path === psd ? 'PSD' : 'WRAPPER';
    const exact = current.length === legacy.length && legacy.every((old, i) => hasLegacyPrefix(old, current[i]));
    say(`LB13_${label}_EXACT_LEGACY_PREFIX`, result.status === 0 && exact && current[0].includes('drawn(a>8)_left,top') && current[0].includes('opaque(a>=250)_right,bottom') && current[0].includes('opaque(a>=250)_size') && out.includes('legacy opaque_px remains alpha > 8'), exact ? 'all original header/row bytes remain prefixes; only threshold-labelled trailing columns are added' : JSON.stringify({ status: result.status, stdout: out, stderr: result.stderr }));
    const corrupt = Buffer.from(current[1]); corrupt[2] ^= 1;
    say(`LB14_${label}_ONE_BYTE_PLANT_DETECTED`, !hasLegacyPrefix(legacy[1], corrupt.toString()), 'changing one original draw-order byte must fail the prefix comparison');
    say(`LB15_${label}_UNION_UNITS`, out.includes('body-group union [opaque(a>=250)]: 3,4 to 7,9; size 4x5; height 5 INPUT-CANVAS px') && out.includes('body-group union [drawn(a>8)]: 3,4 to 7,9; size 4x5; height 5 INPUT-CANVAS px') && out.includes('not an anatomical height'), 'the CORE height and separate drawn union name their thresholds and input-canvas units');
    if (path === wrapperDir) {
      say('LB16_TRANSPARENT_LAYER_NAMED', out.includes('layer "neckwear": no drawn(a>8) box (no pixels with alpha > 8)') && out.includes('layer "neckwear": no opaque(a>=250) box (no pixels with alpha >= 250)') && current.find(l => /\sneckwear\s/.test(l))?.includes('none') === true, 'a fully transparent named layer keeps its old row and explicitly has neither box');
      say('LB21_DRAWN_PRESENT_CORE_EMPTY_NAMED', out.includes('layer "author:soft": no opaque(a>=250) box (no pixels with alpha >= 250); drawn(a>8) box is present'), 'a raw-positive alpha-249 source is explicitly CORE-empty, without being called fully transparent');
    }
  }
  const onlyHead = join(dir, 'head-only'); wrapper(onlyHead, layerSet([excluded[0]]));
  const absent = spawnSync('bun', [join(ROOT, 'cli.ts'), 'layers', onlyHead], { cwd: ROOT, encoding: 'utf8' });
  say('LB17_EMPTY_BODY_IS_UNAVAILABLE', absent.status === 0 && absent.stdout.includes('body-group union [opaque(a>=250)]: none; height unavailable INPUT-CANVAS px') && absent.stdout.includes('body-group union [drawn(a>8)]: none; height unavailable INPUT-CANVAS px') && !absent.stdout.includes('height 0'), 'a readable head-only decomposition has neither invented body-group height');
  const softBody = join(dir, 'soft-body'); wrapper(softBody, layerSet([painted('topwear', 2, 3, 1, 1, [[0, 0, 249]])]));
  const softRun = spawnSync('bun', [join(ROOT, 'cli.ts'), 'layers', softBody], { cwd: ROOT, encoding: 'utf8' });
  say('LB22_BODY_DRAWN_PRESENT_CORE_UNAVAILABLE', softRun.status === 0 && softRun.stdout.includes('body-group union [opaque(a>=250)]: none; height unavailable INPUT-CANVAS px') && softRun.stdout.includes('body-group union [drawn(a>8)]: 2,3 to 3,4; size 1x1; height 1 INPUT-CANVAS px'), 'source CORE can be unavailable while the same unchanged body group has drawn support');
  const cropSet = layerSet([painted('topwear', 0, 0, 1, 2, [[0, 0, 250], [0, 1, 251]])]);
  // The fixture controller supplies these roles to its evidence, never to the role-unaware CLI.
  const artifact = (set: LayerSet, role: 'full' | 'head'): string => {
    const box = bodyCoreBox(set);
    const sourceHash = createHash('sha256');
    for (const layer of set.layers) sourceHash.update(encodePngBytes(layer.pixels));
    return JSON.stringify({ role, sourceSha256: sourceHash.digest('hex'), height: box === null ? null : box.bottom - box.top });
  };
  const fullArtifact = artifact(base, 'full');
  const headArtifact = artifact(cropSet, 'head');
  const fullHash = createHash('sha256').update(fullArtifact).digest('hex');
  const acceptsFullReference = (text: string): boolean => createHash('sha256').update(text).digest('hex') === fullHash && (JSON.parse(text) as { role: string }).role === 'full';
  say('LB23_SCALE_REFERENCE_BOUND_TO_FULL_ARTIFACT', bodyCoreBox(base)!.bottom - bodyCoreBox(base)!.top === 5 && bodyCoreBox(cropSet)!.bottom - bodyCoreBox(cropSet)!.top === 2 && acceptsFullReference(fullArtifact) && !acceptsFullReference(headArtifact) && !acceptsFullReference(headArtifact.replace('"role":"head"', '"role":"full"')), 'the full evidence artifact has height 5; substituting the head height 2 or relabelling that artifact fails the full role/hash binding');
  const headDir = join(dir, 'head-crop'); wrapper(headDir, cropSet);
  const cropRun = spawnSync('bun', [join(ROOT, 'cli.ts'), 'layers', headDir], { cwd: ROOT, encoding: 'utf8' });
  say('LB24_HEAD_HAS_GENERIC_UNION_WITHOUT_NEW_FIGURE_SCALE_LINE', cropRun.status === 0 && cropRun.stdout.includes('body-group union [opaque(a>=250)]: 0,0 to 1,2; size 1x2; height 2 INPUT-CANVAS px') && !cropRun.stdout.split('\n').some(line => /^\s*(?:figure[- ]height|rig[_ ]scale|scale guidance)\s*[:[]/i.test(line)), 'a head-crop fixture still prints its generic union; a new figure-height or scale-advice line would fail this control; existing plausibility figure phrases are untouched');
  return failed;
}

if (import.meta.main) {
  const dir = mkdtempSync(join(tmpdir(), 'rig-parts-layer-bounds-'));
  try {
    const failed = runLayerBoundsChecks(dir, (name, ok, detail) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`));
    process.exitCode = failed === 0 ? 0 : 1;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
