#!/usr/bin/env bun
/**
 * The automatic mesh mode (`src/automesh.ts`, issue #126 item 2) measured
 * beside the lattice and the contour mode, by one command:
 *
 *     bun tools/auto_survey.ts [--write <dir>] [<key>=<build dir> ...]
 *
 * - **synthetic**: every case of `fixtures/automesh.ts` — shapes, a refused
 *   topology, regions, two planted limits — geometry only (unweighted: with no
 *   `weightJump` declared, weights move no step). Per case: the source's
 *   vertices (hull) → the result's, triangles, the termination with
 *   `candidatesTried`, the worst residual and the wall time of the call; beside
 *   it the lattice at grid = the case's spacing and the contour mode at the
 *   case's own parameters (threshold 8, the mode's reading).
 * - **examples**: `<key>=<build dir>` is a `rig-parts build --out` directory
 *   of the public example `examples/<key>/` (its `parts.json` and `parts/`).
 *   Every mesh part is switched, alone, to `auto` under {@link POLICY} — ONE
 *   numeric policy, written before any example was reduced and not tuned per
 *   part — and the whole rig stage (`buildRig`) runs: weighted, exactly what
 *   `build` runs, without rigc's gate. Per part: built or refused and why, the
 *   source → result vertices (hull), triangles, bindings, the gated residuals,
 *   the termination, `candidatesTried`, and the wall time of the switched rig
 *   stage less the tracked one's (paired on one machine: one switched run
 *   against the least of three tracked runs, said as such). A refused part's
 *   figure is the time to its refusal, so it is not a cost of the mode. Beside it the tracked mode's counts
 *   (`rig/mesh_report.json` of the build) and the contour mode at issue #106's
 *   stated set (threshold 8, tolerance 1, margin 1, stray 4, spacing = grid).
 * - `--write <dir>` writes `<dir>/<key>.json`: the example's config with every
 *   part that built switched to `auto`, for a real `rig-parts build` through
 *   rigc's gate and `check`. A refused part stays on its tracked mode.
 *
 * Timing is the one clock read in this repository's tools and is not a claim
 * about another machine.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AlphaMask } from '@rig-c/core/mesh';
import { autoReductionInput, autoSource, autoVerdict, gatedFailures, runReduction, terminationText, worstResidual, residuals } from '../src/automesh.ts';
import { parseConfig } from '../src/config.ts';
import { contourMesh } from '../src/contour.ts';
import { PartsError } from '../src/errors.ts';
import { ART_ALPHA, latticeMesh } from '../src/mesh.ts';
import { readParts } from '../src/parts.ts';
import { readPng, type Raster } from '../src/raster/index.ts';
import { type AutoMeshReport, buildRig, type MeshReport } from '../src/rig.ts';
import { AUTO_CASES, examplePolicy } from '../fixtures/automesh.ts';
import { withPolicyMotion } from '../fixtures/automotion.ts';

const ROOT = resolve(import.meta.dir, '..');

/** The one policy every public example part is switched to: `examplePolicy` in fixtures/automesh.ts, where each number's source is stated. */
// The motion block (fixtures/automotion.ts) rides along so a --write config loads (issue #126 item 3 requires it); buildRig does not read it.
const POLICY = (spacing: number): ReturnType<typeof examplePolicy> => withPolicyMotion(examplePolicy(spacing));

const ms = (t0: number): number => Math.round(performance.now() - t0);

function counts(vertices: number, hull: number): string {
  return `${vertices} (${hull})`;
}

function latticeCell(name: string, mask: AlphaMask, grid: number): string {
  const art = { width: mask.width, height: mask.height, data: Uint8Array.from(mask.alpha, (a) => (a > ART_ALPHA ? 1 : 0)) };
  const lm = latticeMesh(name, art, grid);
  return 'code' in lm ? lm.code : counts(lm.vertices.length, lm.hull);
}

function contourCell(name: string, mask: AlphaMask, tolerance: number, margin: number, spacing: number, stray?: number): string {
  const cm = contourMesh(name, mask, { threshold: ART_ALPHA, tolerance, margin, spacing, ...(stray === undefined ? {} : { stray }), regions: [] });
  return Array.isArray(cm) ? cm.map((p) => p.code).join('+') : counts(cm.vertices.length, cm.hull);
}

// ---------------------------------------------------------------------------
// synthetic
// ---------------------------------------------------------------------------

console.log('## synthetic (fixtures/automesh.ts), geometry only\n');
console.log('| case | shows | lattice V (hull) | contour V (hull) | auto source V (hull) | auto result V (hull) | T | verdict | termination | worst residual | call ms |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of AUTO_CASES) {
  const lat = latticeCell(c.name, c.mask, c.spacing);
  const con = contourCell(c.name, c.mask, 0, 1, c.spacing);
  const t0 = performance.now();
  const source = autoSource(c.name, c.mask, c.spec);
  if (Array.isArray(source)) {
    console.log(`| ${c.name} | ${c.shows} | ${lat} | ${con} | refused | | | ${source.map((p) => p.code).join('+')} | the source is refused before the call | | ${ms(t0)} |`);
    continue;
  }
  const input = autoReductionInput({ part: c.name, mask: c.mask, ox: 0, oy: 0, spec: c.spec, source, weights: null, boneOrder: [] });
  const ran = runReduction(c.name, input);
  const took = ms(t0);
  if ('code' in ran) {
    console.log(`| ${c.name} | ${c.shows} | ${lat} | ${con} | ${counts(source.vertices.length, source.hull)} | | | ${ran.code} | ${ran.detail.slice(0, 160)} | | ${took} |`);
    continue;
  }
  const v = autoVerdict(c.name, ran);
  const cand = ran.report.candidates[0];
  const res = cand.counts === null ? '' : counts(cand.counts.boundaryVertices + cand.counts.interiorVertices, cand.counts.boundaryVertices);
  const w = worstResidual(residuals(ran.report));
  const worst = w === null ? '' : `${w.code}${w.region === null ? '' : `[${w.region}]`} ${w.value} ${w.bound?.op} ${w.bound?.value}`;
  const verdict = v.accepted ? 'accepted' : `refused ${v.problem.code}${gatedFailures(ran.report).length > 0 ? ` (${gatedFailures(ran.report).map((r) => `${r.code}${r.object.region === null ? '' : `[${r.object.region}]`}`).join(', ')})` : ''}`;
  console.log(`| ${c.name} | ${c.shows} | ${lat} | ${con} | ${counts(source.vertices.length, source.hull)} | ${res} | ${cand.counts?.triangles ?? ''} | ${verdict} | ${terminationText(ran.report.termination).slice(0, 220)} | ${worst} | ${took} |`);
}

// ---------------------------------------------------------------------------
// examples
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let write: string | null = null;
const builds: Array<[string, string]> = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--write') {
    write = args[++i] ?? null;
    if (write === null) {
      console.error('auto_survey: --write needs a directory');
      process.exit(2);
    }
    continue;
  }
  const at = args[i].indexOf('=');
  if (at < 1) {
    console.error(`auto_survey: "${args[i]}"; <key>=<build dir> or --write <dir> is required`);
    process.exit(2);
  }
  builds.push([args[i].slice(0, at), args[i].slice(at + 1)]);
}

type Raw = Record<string, unknown> & { meshes: Record<string, Record<string, unknown>> };

for (const [key, dir] of builds) {
  const raw = JSON.parse(readFileSync(join(ROOT, 'examples', key, 'config.json'), 'utf8')) as Raw;
  const parts = readParts(join(dir, 'parts.json'));
  const images = new Map<string, Raster>();
  for (const p of parts.parts) images.set(p.name, readPng(join(dir, 'parts', `${p.name}.png`)));
  const tracked = JSON.parse(readFileSync(join(dir, 'rig', 'mesh_report.json'), 'utf8')) as MeshReport[];
  // The tracked rig stage, three times: the first run pays the engine's warm-up, so the least of the three is the base.
  let t0 = 0;
  let base = Infinity;
  for (let k = 0; k < 3; k++) {
    t0 = performance.now();
    buildRig(parseConfig(raw), parts, images);
    base = Math.min(base, ms(t0));
  }
  console.log(`\n## ${key}: every mesh part switched alone to auto (POLICY), the whole rig stage; tracked rig stage ${base} ms\n`);
  console.log('| part | tracked V (hull) | contour #106 V (hull) | auto source V (hull) | auto result V (hull) | T | bindings | verdict | termination | coverage / overshoot / undercut / boundary dev (threshold 1) | ms over tracked |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  const switched = JSON.parse(JSON.stringify(raw)) as Raw;
  const totals = { tracked: 0, auto: 0, built: 0, refused: 0 };
  for (const [part, m] of Object.entries(raw.meshes)) {
    const spacing = typeof m.grid === 'number' ? m.grid : ((m.contour as { spacing: number }).spacing);
    const tr = tracked.find((r) => r.part === part);
    const img = readPng(join(dir, 'rig', 'images', `${part}.png`));
    const alpha = new Uint8Array(img.width * img.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
    const con = contourCell(part, { width: img.width, height: img.height, alpha }, 1, 1, spacing, 4);
    const cfg = JSON.parse(JSON.stringify(raw)) as Raw;
    cfg.meshes[part] = { auto: POLICY(spacing), r: m.r, segments: m.segments };
    t0 = performance.now();
    let row: AutoMeshReport | null = null;
    let why = '';
    try {
      const out = buildRig(parseConfig(cfg), parts, images);
      row = out.meshReport.find((r) => r.part === part && 'mode' in r && r.mode === 'auto') as AutoMeshReport;
    } catch (err) {
      if (!(err instanceof PartsError)) throw err;
      why = err.problems.map((p) => `${p.code}: ${p.detail}`).join(' | ');
    }
    const over = ms(t0) - base;
    const trCell = tr === undefined ? '' : counts(tr.vertices, tr.hull);
    if (row === null) {
      totals.refused++;
      const code = why.slice(0, why.indexOf(':'));
      console.log(`| ${part} | ${trCell} | ${con} | | | | | refused ${code} | ${why.slice(code.length + 2, code.length + 2 + 260).replace(/\|/g, '/')} | | ${over} |`);
      continue;
    }
    totals.built++;
    totals.tracked += tr?.vertices ?? 0;
    totals.auto += row.vertices;
    switched.meshes[part] = cfg.meshes[part];
    const s = row.source.counts;
    const r = row.result.counts;
    const cell = (code: string): string => {
      const x = row?.residuals.find((q) => q.code === code && q.region === null && !(code === 'MQ_OVERSHOOT' && q.state === 'undeclared'));
      return x === undefined ? '-' : `${x.value}`;
    };
    const t = row.termination;
    const tried = t.reason === 'no-further-valid-reduction' || t.reason === 'budget-exhausted' ? ` (${t.candidatesTried} tried)` : '';
    console.log(
      `| ${part} | ${trCell} | ${con} | ${s === null ? '' : counts(s.boundaryVertices + s.interiorVertices, s.boundaryVertices)} | ${counts(r.boundaryVertices + r.interiorVertices, r.boundaryVertices)} | ${r.triangles} | ${r.bindings} | accepted | ${t.reason}${tried} | ${cell('MQ_COVERAGE')} / ${cell('MQ_OVERSHOOT')} / ${cell('MQ_UNDERCUT')} / ${cell('MQ_BOUNDARY_DEVIATION')} | ${over} |`,
    );
  }
  console.log(`\n${key}: ${totals.built} part(s) accepted, ${totals.refused} refused; over the accepted parts the tracked mode has ${totals.tracked} vertices and auto ${totals.auto}`);
  if (write !== null) {
    mkdirSync(write, { recursive: true });
    writeFileSync(join(write, `${key}.json`), `${JSON.stringify(switched, null, 2)}\n`);
    console.log(`wrote ${join(write, `${key}.json`)}`);
  }
}
