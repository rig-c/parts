#!/usr/bin/env bun
/**
 * The contour mesh (`src/contour.ts`, issue #84 step 1) measured beside the
 * lattice (`src/mesh.ts`), by one instrument, on generated masks and on the
 * public examples' parts.
 *
 *     bun tools/contour_survey.ts [<key>=<build dir> ...]
 *
 * - **masks**: every case of `fixtures/contour.ts` that builds, at its own
 *   parameters, beside `latticeMesh` at the grid whose vertex count is
 *   closest to the contour mesh's (a tie takes the larger grid), and beside
 *   the lattice at grid 1 px — the finest. Then the tolerance x margin sweep
 *   over five generated shapes: which margins pass coverage and overshoot at
 *   each tolerance, and the overshoot each passing cell measured (a margin
 *   above 0 and below 1 px is refused by name, so the sweep's margins are 0
 *   and 1 or more).
 * - **examples**: `<key>=<build dir>` is a `rig-parts build --out` directory
 *   of the public example `examples/<key>/` — its `rig/images/<part>.png` are
 *   the padded images the rig stage gave `latticeMesh`, and
 *   `examples/<key>/config.json` names the mesh parts and their grids. Each
 *   mesh part is one row: the lattice the tracked config builds, and the
 *   contour mesh at threshold 8, tolerance 1, margin 1, `stray` 4 and a
 *   background spacing equal to that part's lattice grid, with no region — the
 *   one stated set of parameters (issue #106's), with the pixels the margin's
 *   growth and its pinch fill added. Nothing is accepted or refused on these
 *   rows; they are a table.
 *
 * Both meshes are measured by the same calls: rig-c's
 * `measureAuthoredMeshFit` (coverage, overshoot), the shoelace area of the
 * triangles, and `triangleQuality`. "enclosed" is mesh area minus covered art
 * pixels, px². Timing is not measured here.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { measureAuthoredMeshFit, type AlphaMask } from '@rig-c/core/mesh';
import { contourMesh, type ContourParams, triangleQuality } from '../src/contour.ts';
import { ART_ALPHA, latticeMesh } from '../src/mesh.ts';
import { connectedComponents, readPng } from '../src/raster/index.ts';
import { BUILDING, blocks } from '../fixtures/contour.ts';

const ROOT = resolve(import.meta.dir, '..');

interface Row {
  vertices: number;
  hull: number;
  triangles: number;
  area: number;
  enclosed: number;
  coverage: string;
  overshoot: number;
  minAngle: number;
  maxRatio: number;
  /** For a contour row: the pixels the growth, the pinch fill and the grown silhouette's enclosure added. */
  added?: string;
}

function measure(mask: AlphaMask, vertices: Array<[number, number]>, triangles: number[], hull: number): Row {
  const fit = measureAuthoredMeshFit(mask, ART_ALPHA + 1, vertices, triangles);
  let twice = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [vertices[triangles[t]], vertices[triangles[t + 1]], vertices[triangles[t + 2]]];
    twice += (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }
  const q = triangleQuality(vertices, triangles);
  return {
    vertices: vertices.length,
    hull,
    triangles: triangles.length / 3,
    area: Math.round(Math.abs(twice) * 50) / 100,
    enclosed: Math.round((Math.abs(twice) / 2 - fit.coveredArt) * 100) / 100,
    coverage: `${fit.coveredArt}/${fit.artPixels}`,
    overshoot: fit.overshoot,
    minAngle: Math.round(q.smallestAngle.value * 100) / 100,
    maxRatio: Math.round(q.largestEdgeRatio.value * 100) / 100,
  };
}

function lattice(name: string, mask: AlphaMask, grid: number): Row | string {
  const art = { width: mask.width, height: mask.height, data: Uint8Array.from(mask.alpha, (a) => (a > ART_ALPHA ? 1 : 0)) };
  const lm = latticeMesh(name, art, grid);
  if ('code' in lm) return lm.code;
  return measure(mask, lm.vertices, lm.triangles, lm.hull);
}

/** A refused row's cell: the code, and for islands what the islands hold — the figure step 2's policy turns on. */
function refusal(mask: AlphaMask, codes: string[], detail: string): string {
  if (codes[0] !== 'CONTOUR_ONE_ISLAND') return `${codes.join('+')}${codes[0] === 'CONTOUR_TRACE' ? ` (${/pixel corner \([0-9,]+\)/.exec(detail)?.[0] ?? ''})` : ''}`;
  const comp = connectedComponents({ width: mask.width, height: mask.height, data: Uint8Array.from(mask.alpha, (a) => (a > ART_ALPHA ? 1 : 0)) }, 4);
  const areas = comp.stats.slice(1).map((s) => s.area).sort((a, b) => b - a);
  const rest = areas.slice(1);
  return `ONE_ISLAND: ${areas.length} islands, largest ${areas[0]} px; the other ${rest.length} hold ${rest.reduce((a, b) => a + b, 0)} px (largest ${rest[0]}, ${rest.filter((a) => a <= 4).length} of them 4 px or less)`;
}

function contour(name: string, mask: AlphaMask, params: ContourParams): Row | string {
  const m = contourMesh(name, mask, params);
  if (Array.isArray(m)) return refusal(mask, m.map((p) => p.code), m[0].detail);
  return { ...measure(mask, m.vertices, m.triangles, m.hull), added: `${m.report.grownPixels} / ${m.report.pinchFilledPixels} / ${m.report.grownHolePixels}` };
}

const cells = (r: Row | string): string =>
  typeof r === 'string' ? `${r} | | | | | | | |` : `${r.vertices} (${r.hull}) | ${r.triangles} | ${r.area} | ${r.enclosed} | ${r.coverage} | ${r.overshoot} | ${r.minAngle} / ${r.maxRatio} | ${r.added ?? ''}`;
const HEAD = 'V (hull) | T | area px² | enclosed px² | covered/art | overshoot px | min angle° / max edge ratio | grown / pinch-filled / grown-hole px';

console.log('## generated masks\n');
console.log(`| mask | mode | ${HEAD} |`);
console.log(`|---|---|${'---|'.repeat(8)}`);
for (const c of BUILDING) {
  const cm = contourMesh(c.name, c.mask, c.params);
  if (Array.isArray(cm)) {
    console.log(`| ${c.name} | contour | ${cm.map((p) => p.code).join('+')} | | | | | | |`);
    continue;
  }
  let best = 1;
  let bestGap = Infinity;
  for (let g = 1; g <= Math.max(c.mask.width, c.mask.height); g++) {
    const r = lattice(c.name, c.mask, g);
    if (typeof r === 'string') continue;
    const gap = Math.abs(r.vertices - cm.vertices.length);
    if (gap <= bestGap) {
      bestGap = gap;
      best = g;
    }
  }
  console.log(`| ${c.name} | contour s=${c.params.spacing}${c.params.regions.length > 0 ? ' +region' : ''} | ${cells(measure(c.mask, cm.vertices, cm.triangles, cm.hull))} |`);
  console.log(`| ${c.name} | lattice grid ${best} (nearest V) | ${cells(lattice(c.name, c.mask, best))} |`);
  console.log(`| ${c.name} | lattice grid 1 | ${cells(lattice(c.name, c.mask, 1))} |`);
}

// The sweep: five generated shapes, pixel centres tested against the shape.
const shape = (w: number, h: number, inside: (x: number, y: number) => boolean): AlphaMask => {
  const m = blocks(w, h, []);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x + 0.5, y + 0.5)) m.alpha[y * w + x] = 255;
  return m;
};
const sweep: Record<string, AlphaMask> = {
  'disc r18': shape(48, 48, (x, y) => (x - 24) ** 2 + (y - 24) ** 2 <= 18 ** 2),
  'triangle (apex ~70°)': shape(64, 48, (x, y) => y > 4 && y < 44 && Math.abs(x - 32) < (y - 4) * 0.7),
  'crescent (two horns)': shape(64, 64, (x, y) => (x - 32) ** 2 + (y - 32) ** 2 <= 26 ** 2 && (x - 44) ** 2 + (y - 28) ** 2 > 20 ** 2),
  'spike 2 px on a block': shape(48, 48, (x, y) => (y > 24 && y < 44 && x > 6 && x < 42) || (x > 22 && x < 25 && y > 3 && y <= 25)),
  'diagonal bar 12 px': shape(64, 64, (x, y) => Math.abs((x - y) / Math.SQRT2) < 6 && x > 6 && x < 58),
};
const TOLS = [0.5, 1, 1.5, 2, 3];
const MARGINS = [0, 1, 1.5, 2, 2.5, 3];
console.log(`\n## tolerance x margin (spacing 8, no region): margins that build, with the overshoot measured; C = coverage refused, O = overshoot refused\n`);
console.log(`| shape | tolerance | ${MARGINS.map((m) => `m ${m}`).join(' | ')} |`);
console.log(`|---|---|${'---|'.repeat(MARGINS.length)}`);
for (const [name, m] of Object.entries(sweep)) {
  for (const t of TOLS) {
    const row = MARGINS.map((g) => {
      const r = contourMesh(name, m, { threshold: ART_ALPHA, tolerance: t, margin: g, spacing: 8, regions: [] });
      if (!Array.isArray(r)) return `ok ${r.report.overshoot}`;
      return r.map((p) => (p.code === 'CONTOUR_COVERAGE' ? 'C' : p.code === 'CONTOUR_OVERSHOOT' ? 'O' : p.code)).join('+');
    });
    console.log(`| ${name} | ${t} | ${row.join(' | ')} |`);
  }
}

for (const arg of process.argv.slice(2)) {
  const at = arg.indexOf('=');
  if (at < 1) {
    console.error(`contour_survey: "${arg}"; <key>=<build dir> is required`);
    process.exit(2);
  }
  const key = arg.slice(0, at);
  const dir = arg.slice(at + 1);
  const cfg = JSON.parse(readFileSync(join(ROOT, 'examples', key, 'config.json'), 'utf8')) as { meshes: Record<string, { grid: number }> };
  console.log(`\n## ${key}: every mesh part, the tracked config's lattice and the contour mesh at threshold ${ART_ALPHA}, tolerance 1, margin 1, stray 4, spacing = grid\n`);
  console.log(`| part | grid | mode | ${HEAD} |`);
  console.log(`|---|---|---|${'---|'.repeat(8)}`);
  const total = { lattice: 0, contour: 0, latticeEnclosed: 0, contourEnclosed: 0, refused: 0 };
  for (const [part, { grid }] of Object.entries(cfg.meshes)) {
    const img = readPng(join(dir, 'rig', 'images', `${part}.png`));
    const alpha = new Uint8Array(img.width * img.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
    const mask: AlphaMask = { width: img.width, height: img.height, alpha };
    const l = lattice(part, mask, grid);
    const c = contour(part, mask, { threshold: ART_ALPHA, tolerance: 1, margin: 1, spacing: grid, stray: 4, regions: [] });
    console.log(`| ${part} | ${grid} | lattice | ${cells(l)} |`);
    console.log(`| ${part} | ${grid} | contour | ${cells(c)} |`);
    if (typeof l !== 'string' && typeof c !== 'string') {
      total.lattice += l.vertices;
      total.latticeEnclosed += l.enclosed;
      total.contour += c.vertices;
      total.contourEnclosed += c.enclosed;
    } else total.refused++;
  }
  console.log(`\n${key}, over the parts both modes built: lattice ${total.lattice} vertices, ${Math.round(total.latticeEnclosed)} px² enclosed; contour ${total.contour} vertices, ${Math.round(total.contourEnclosed)} px² enclosed; ${total.refused} part(s) refused by one mode`);
}
