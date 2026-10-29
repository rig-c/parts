#!/usr/bin/env bun
/**
 * Issue #326, Stage A: `mesh-draft` keeps the lattice for any part whose art holds a second real island (`dustOf`,
 * `src/meshdraft.ts`). What would a draft per island save? This tool measures it without a line of `src/` changed.
 *
 *     bun tools/island_draft_survey.ts --figure <label> --config <config.json> --parts <dir> --scratch <dir> [--lattice-all] > <run>.json
 *     bun tools/island_draft_survey.ts --page <run.json>… --picture <png> > <page>.md
 *
 * `--parts` is an assembled `rig/` directory (parts.json and parts/). `--lattice-all` turns every `meshes` entry into a
 * lattice at the figure's spacing (`figureGrid`, the spacing `propose` drafts and mesh-draft's S), keeping `r`,
 * `segments`, `exponent`, `rule` and a lattice-shaped `influences` — the lattice config AUTHORING §3 (*Which mode comes
 * out smaller*) built for the trailer, whose own config holds no lattice.
 *
 * Per figure:
 *
 * 1. **Islands.** Every part's art islands by `dustOf` — the rule mesh-draft reads — and whether its config entry is a
 *    lattice, another mesh mode, or no mesh (a region).
 * 2. **Triangles.** For each lattice part `dustOf` keeps for a real piece: the lattice's triangles and overdraw (the
 *    rig stage's lattice, `rigStage` over the config as given), and, per real island, the candidate mesh-draft would
 *    draft (`candidateMesh` at the figure's T and S, `stray` the largest dust island) built by `buildRig` on the part's
 *    image with every other real island cleared to alpha 0 — the contour mode's own `contourMesh`, so its acceptance
 *    (coverage, overshoot, topology) is the one a single island meets. The sum over islands is the per-island count.
 * 3. **One attachment.** The islands' meshes concatenated as they stand (hull = the first island's) are handed to
 *    rigc's gate, which reads one outline per mesh (`traceOutline`, rig-c `src/mesh.ts`); its exit and message are
 *    recorded. Then the islands are joined by a bridge — a quad between the nearest pair of outline edges, the outline
 *    walking island A, crossing to B, walking B and crossing back — which makes one closed outline with
 *    2·V − hull − 2 triangles (two per bridge added), held to `contourTopologyProblems` (`src/contour.ts`: one loop,
 *    hull first and in order, no self-crossing, triangles tiling the outline exactly) before rigc sees it.
 * 4. **Motion.** Where the bridged mesh is lighter than the lattice, mesh-draft's readings 2–5 through its own
 *    instruments: three gate builds of the lattice rig differing in the part's attachment only (lattice, bridged
 *    candidate, the dense reference at `denseGrid`), `compareMeshesInMotion` over the idle (`idleSchedule`) and over
 *    the part's bend set (`bendAnimations`), read by `idleReading`, `bendReading` and `gateVerdict`. Reading 1, the
 *    check bars: the rig stage cannot write the joined mesh from a config, so `checkStage` runs over a copy of the
 *    lattice rig directory with the part's attachment replaced, and `partsNamed` lays its problems on the part.
 *
 * Pure apart from rigc (run as a process, found beside this package) and the scratch directory it writes.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Plate, type RGBA } from '@rig-c/core/tools/plate.ts';
import type { AlphaMask, MeshQualityReport, MotionSchedule } from '@rig-c/core/mesh';
import { compareMeshesInMotion, type MotionComparisonInput } from '@rig-c/core/meshcompare';
import { idleSchedule } from '../src/automotion.ts';
import { checkStage, gateThroughRigc, RIGC_MODEL_DOCUMENT, rigStage } from '../src/build.ts';
import { type CheckReport, findRigc, type RigcRunner } from '../src/check.ts';
import { type CharacterConfig, type LatticeMeshSpec, loadConfigAndAnimations } from '../src/config.ts';
import { contourTopologyProblems, GRID } from '../src/contour.ts';
import { PartsError, problemLine } from '../src/errors.ts';
import { ART_ALPHA, isDust } from '../src/mesh.ts';
import { artPixels, bendAnimations, bendLinks, bendReading, candidateMesh, denseGrid, dustOf, figureRules, gateVerdict, IDLE_BOUND_PX, idleReading, overdrawOf, type PartReadings, partsNamed, type SeamCount } from '../src/meshdraft.ts';
import { IDLE_FPS } from '../src/motion.ts';
import { type PartsFile, readParts } from '../src/parts.ts';
import { figureGrid } from '../src/propose.ts';
import { alphaAbove, connectedComponents } from '../src/raster/index.ts';
import { readPng } from '../src/raster/png.ts';
import type { Raster } from '../src/raster/types.ts';
import { buildRig, type MeshAttachment, rigJsonText, type RigSpec, type WeightEntry } from '../src/rig.ts';
import { pyRound } from '../src/round.ts';
import { rigcRunner } from './production_trial.ts';

const ROOT = resolve(import.meta.dir, '..');
type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------
// 1. islands
// ---------------------------------------------------------------------------

export interface IslandRow {
  part: string;
  /** What the config holds for the part: a lattice, another mesh mode, or no mesh entry at all. */
  entry: 'grid' | 'contour' | 'auto' | 'none';
  islands: number[];
  /** `dustOf`'s reading: "one", "dust only", or its keep sentence. */
  reading: string;
  real: number;
}

/** The islands of every part, by `dustOf`. */
export function islandRows(cfg: CharacterConfig, parts: PartsFile, images: ReadonlyMap<string, Raster>): IslandRow[] {
  return parts.parts.map((p) => {
    const spec = cfg.meshes[p.name];
    const entry: IslandRow['entry'] = spec === undefined ? 'none' : 'grid' in spec ? 'grid' : 'auto' in spec ? 'auto' : 'contour';
    const img = images.get(p.name);
    if (img === undefined) return { part: p.name, entry, islands: [], reading: 'no image', real: 0 };
    const d = dustOf(img);
    const art = d.islands.reduce((a, b) => a + b, 0);
    const real = d.islands.filter((n, i) => i === 0 || !isDust(n, art)).length;
    const reading = 'keep' in d ? d.keep : d.dust.length === 0 ? 'one island' : `one island and ${d.dust.length} dust`;
    return { part: p.name, entry, islands: d.islands, reading, real };
  });
}

// ---------------------------------------------------------------------------
// 2. a mesh as integer units, and the join
// ---------------------------------------------------------------------------

/** A mesh with its vertices in 1/GRID px units of the padded image; hull first, in outline order. */
export interface UnitMesh {
  X: number[];
  Y: number[];
  weights: WeightEntry[][];
  triangles: number[];
  hull: number;
}

function unitsOf(att: MeshAttachment): UnitMesh {
  const n = att.uvs.length / 2;
  const X: number[] = [];
  const Y: number[] = [];
  for (let i = 0; i < n; i++) {
    X.push(Math.round(att.uvs[2 * i] * att.width * GRID));
    Y.push(Math.round(att.uvs[2 * i + 1] * att.height * GRID));
  }
  return { X, Y, weights: att.weights.map((w) => w.map((e) => ({ ...e }))), triangles: [...att.triangles], hull: att.hull };
}

function attachmentOfUnits(m: UnitMesh, like: MeshAttachment): MeshAttachment {
  const uvs: number[] = [];
  for (let i = 0; i < m.X.length; i++) uvs.push(m.X[i] / GRID / like.width, m.Y[i] / GRID / like.height);
  return { type: 'mesh', image: like.image, width: like.width, height: like.height, uvs, triangles: m.triangles, hull: m.hull, weights: m.weights };
}

/** Two meshes as they stand, one after the other: two outlines in one vertex list, `hull` the first one's. */
export function concatenated(a: UnitMesh, b: UnitMesh): UnitMesh {
  const off = a.X.length;
  return { X: [...a.X, ...b.X], Y: [...a.Y, ...b.Y], weights: [...a.weights, ...b.weights], triangles: [...a.triangles, ...b.triangles.map((t) => t + off)], hull: a.hull };
}

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/**
 * The two meshes joined by one bridge quad: for outline vertices a (A) and b (B), nearest pairs first, the outline runs
 * A from a's successor round to a, crosses to b, runs B from b round to b's predecessor and crosses back. The quad
 * (a, b, b′, a′) is two triangles wound as the meshes' own. The first pair whose join passes `contourTopologyProblems`
 * is taken; null when none of the first `tries` pairs does.
 */
export function bridged(part: string, A: UnitMesh, B: UnitMesh, tries = 400): { mesh: UnitMesh; gapPx: number; tried: number } | null {
  const pairs: Array<[number, number, number]> = [];
  for (let i = 0; i < A.hull; i++) for (let j = 0; j < B.hull; j++) {
    const dx = A.X[i] - B.X[j];
    const dy = A.Y[i] - B.Y[j];
    pairs.push([dx * dx + dy * dy, i, j]);
  }
  pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  const t0 = A.triangles;
  const sign = Math.sign(orient(A.X[t0[0]], A.Y[t0[0]], A.X[t0[1]], A.Y[t0[1]], A.X[t0[2]], A.Y[t0[2]]));
  const VA = A.X.length;
  for (let k = 0; k < Math.min(tries, pairs.length); k++) {
    const [d2, a, b] = pairs[k];
    const a2 = (a + 1) % A.hull;
    const bp = (b - 1 + B.hull) % B.hull;
    // New order: A's outline from a2 round to a, B's from b round to bp, then A's interior, then B's interior.
    const order: Array<['A' | 'B', number]> = [];
    for (let s = 0; s < A.hull; s++) order.push(['A', (a2 + s) % A.hull]);
    for (let s = 0; s < B.hull; s++) order.push(['B', (b + s) % B.hull]);
    for (let v = A.hull; v < VA; v++) order.push(['A', v]);
    for (let v = B.hull; v < B.X.length; v++) order.push(['B', v]);
    const newA = new Array<number>(VA);
    const newB = new Array<number>(B.X.length);
    order.forEach(([m, v], i) => ((m === 'A' ? newA : newB)[v] = i));
    const X = order.map(([m, v]) => (m === 'A' ? A.X : B.X)[v]);
    const Y = order.map(([m, v]) => (m === 'A' ? A.Y : B.Y)[v]);
    const weights = order.map(([m, v]) => (m === 'A' ? A.weights : B.weights)[v]);
    const tris = [...A.triangles.map((t) => newA[t]), ...B.triangles.map((t) => newB[t])];
    for (const [p, q, r] of [[newA[a], newB[b], newB[bp]], [newA[a], newB[bp], newA[a2]]]) {
      const s = Math.sign(orient(X[p], Y[p], X[q], Y[q], X[r], Y[r]));
      if (s === 0) continue;
      tris.push(...(s === sign ? [p, q, r] : [p, r, q]));
    }
    if (tris.length !== A.triangles.length + B.triangles.length + 6) continue;
    const hull = A.hull + B.hull;
    const verts = X.map((x, i) => [x / GRID, Y[i] / GRID] as [number, number]);
    if (contourTopologyProblems(part, verts, tris, hull).length > 0) continue;
    return { mesh: { X, Y, weights, triangles: tris, hull }, gapPx: pyRound(Math.sqrt(d2) / GRID, 3), tried: k + 1 };
  }
  return null;
}

/** Do two outlines (hull vertices, units) share any point: an edge of one meeting an edge of the other, or a vertex of one inside the other. Exact in integers. */
export function outlinesMeet(A: UnitMesh, B: UnitMesh): boolean {
  const seg = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean => {
    const d1 = Math.sign(orient(cx, cy, dx, dy, ax, ay));
    const d2 = Math.sign(orient(cx, cy, dx, dy, bx, by));
    const d3 = Math.sign(orient(ax, ay, bx, by, cx, cy));
    const d4 = Math.sign(orient(ax, ay, bx, by, dx, dy));
    if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    const on = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): boolean => Math.min(px, qx) <= rx && rx <= Math.max(px, qx) && Math.min(py, qy) <= ry && ry <= Math.max(py, qy);
    return (d1 === 0 && on(cx, cy, dx, dy, ax, ay)) || (d2 === 0 && on(cx, cy, dx, dy, bx, by)) || (d3 === 0 && on(ax, ay, bx, by, cx, cy)) || (d4 === 0 && on(ax, ay, bx, by, dx, dy));
  };
  for (let i = 0; i < A.hull; i++) {
    const i2 = (i + 1) % A.hull;
    for (let j = 0; j < B.hull; j++) {
      const j2 = (j + 1) % B.hull;
      if (seg(A.X[i], A.Y[i], A.X[i2], A.Y[i2], B.X[j], B.Y[j], B.X[j2], B.Y[j2])) return true;
    }
  }
  const inside = (P: UnitMesh, x: number, y: number): boolean => {
    let c = false;
    for (let i = 0, j = P.hull - 1; i < P.hull; j = i++) {
      if (P.Y[i] > y !== P.Y[j] > y && (x - P.X[i]) * (P.Y[j] - P.Y[i]) * Math.sign(P.Y[j] - P.Y[i]) < (P.X[j] - P.X[i]) * (y - P.Y[i]) * Math.sign(P.Y[j] - P.Y[i])) c = !c;
    }
    return c;
  };
  return inside(A, B.X[0], B.Y[0]) || inside(B, A.X[0], A.Y[0]);
}

/** The nearest pair of pixels of labels `a` and `b` (squared distance, then index), each on its island's 4-boundary. */
export function shortestGap(labels: ArrayLike<number>, w: number, h: number, a: number, b: number): { d: number; p: number; q: number } {
  const edge = (l: number): number[] => {
    const out: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (labels[i] !== l) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || labels[i - 1] !== l || labels[i + 1] !== l || labels[i - w] !== l || labels[i + w] !== l) out.push(i);
    }
    return out;
  };
  const A = edge(a);
  const B = edge(b);
  let best = { d: Infinity, p: -1, q: -1 };
  for (const p of A) for (const q of B) {
    const dx = (p % w) - (q % w);
    const dy = Math.floor(p / w) - Math.floor(q / w);
    const d = dx * dx + dy * dy;
    if (d < best.d) best = { d, p, q };
  }
  return best;
}

/** A 4-connected pixel path from p to q (both included), stepping along the axis with more left to go, x on a tie. */
export function pixelPath(p: number, q: number, w: number): number[] {
  let [x, y] = [p % w, Math.floor(p / w)];
  const [qx, qy] = [q % w, Math.floor(q / w)];
  const out = [p];
  while (x !== qx || y !== qy) {
    if (Math.abs(qx - x) >= Math.abs(qy - y)) x += Math.sign(qx - x);
    else y += Math.sign(qy - y);
    out.push(y * w + x);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. one figure
// ---------------------------------------------------------------------------

export interface IslandMesh {
  px: number;
  triangles: number;
  vertices: number;
  hull: number;
  overdraw: number;
  refused: string | null;
}

export interface PartRun {
  part: string;
  rule: string;
  segments: string;
  lattice: { grid: number; triangles: number; overdraw: number; art_px: number };
  islands: IslandMesh[];
  /** Σ over islands, the bridges' 2 per join not counted. */
  sum: number | null;
  joined: { triangles: number; overdraw: number; bridges: Array<{ gap_px: number; tried: number }> } | null;
  joinRefused: string | null;
  /** Pairs of islands (by px) whose candidate outlines meet: no bridge can hold them as one simple loop. */
  overlaps: Array<[number, number]>;
  /** Islands whose outlines meet, meshed as one by a pixel path (an emulation of tracing their grown union). */
  groups: Array<IslandMesh & { islands: number[]; path_px: number }>;
  /** rigc's gate on the islands concatenated without a bridge. */
  unbridgedGate: { status: number; lines: string[] } | null;
  bridgedGate: { status: number; lines: string[] } | null;
  readings: Omit<PartReadings, 'bars'> | null;
  /** check's PASS on the lattice rig and on it with the joined attachment, and the latter's problems. */
  check: { lattice: boolean; drafted: boolean; problems: string[] } | null;
  gate: Array<{ reading: string; pass: boolean; text: string }>;
  /** Picture data: the lattice's and the joined mesh's triangles in padded-image px, and the image. */
  draw: { width: number; height: number; lattice: number[][]; joined: number[][] } | null;
}

export interface FigureRun {
  figure: string;
  config: string;
  latticeAll: boolean;
  rigc: string;
  rules: { height: number; tolerance: number; spacing: number };
  islandRows: IslandRow[];
  parts: PartRun[];
}

function latticeConfigText(path: string, grid: number): string {
  const o = JSON.parse(readFileSync(path, 'utf8')) as Json;
  const dir = dirname(resolve(path));
  const meshes = o.meshes as Record<string, Json>;
  for (const [k, m] of Object.entries(meshes)) {
    const inf = m.influences as Json | undefined;
    const latticeInf = inf !== undefined && !('minWeight' in inf) ? inf : undefined;
    meshes[k] = { grid, r: m.r, segments: m.segments, ...(m.exponent === undefined ? {} : { exponent: m.exponent }), ...(m.rule === undefined ? {} : { rule: m.rule }), ...(latticeInf === undefined ? {} : { influences: latticeInf }) };
  }
  const motion = o.motion as Json | undefined;
  if (motion !== undefined && typeof motion.animations_from === 'string' && !isAbsolute(motion.animations_from)) motion.animations_from = resolve(dir, motion.animations_from);
  const control = (o.generation as Json | undefined)?.control as Json | undefined;
  if (control !== undefined && typeof control.skeleton === 'string' && !isAbsolute(control.skeleton) && control.skeleton.endsWith('.json')) control.skeleton = resolve(dir, control.skeleton);
  return `${JSON.stringify(o, null, 2)}\n`;
}

const att = (rig: RigSpec, part: string): MeshAttachment => (rig.skins.default[part] as Record<string, MeshAttachment>)[part];
const NO_ART_FIT = { minCoverage: 0, maxOvershoot: null, maxUndercut: null };

function trianglesPx(a: MeshAttachment): number[][] {
  const out: number[][] = [];
  for (let t = 0; t < a.triangles.length; t += 3) {
    const tri: number[] = [];
    for (const v of [a.triangles[t], a.triangles[t + 1], a.triangles[t + 2]]) tri.push(pyRound(a.uvs[2 * v] * a.width, 4), pyRound(a.uvs[2 * v + 1] * a.height, 4));
    out.push(tri);
  }
  return out;
}

export function runFigure(figure: string, configIn: string, partsDir: string, scratch: string, latticeAll: boolean): FigureRun {
  mkdirSync(scratch, { recursive: true });
  const parts = readParts(join(partsDir, 'parts.json'));
  const rules = figureRules(parts);
  if ('code' in rules) throw new PartsError([rules]);
  let config = resolve(configIn);
  if (latticeAll) {
    config = join(scratch, 'lattice-config.json');
    writeFileSync(config, latticeConfigText(configIn, figureGrid(parts.parts).grid));
  }
  const { config: cfg } = loadConfigAndAnimations(config);
  const images = new Map<string, Raster>();
  for (const p of parts.parts) images.set(p.name, readPng(join(partsDir, 'parts', `${p.name}.png`)));
  const rows = islandRows(cfg, parts, images);
  const bin = findRigc(ROOT, process.env.PATH ?? '');
  const rigc: RigcRunner = rigcRunner(bin, { n: 0 });
  const log = (l: string): void => void process.stderr.write(`${l}\n`);

  const run: FigureRun = { figure, config: configIn, latticeAll, rigc: bin, rules: { height: rules.height, tolerance: rules.tolerance, spacing: rules.spacing }, islandRows: rows, parts: [] };
  const targets = rows.filter((r) => r.entry === 'grid' && r.real > 1);
  if (targets.length === 0) return run;

  // The lattice rig, as mesh-draft's baseline builds it.
  const latticeDir = join(scratch, 'lattice', 'rig');
  rigStage({ config, parts: partsDir, out: latticeDir }, rigc, join(scratch, 'lattice', 'gate'), (l) => log(`[${figure} lattice] ${l}`));
  const latticeRig = JSON.parse(readFileSync(join(latticeDir, 'rig.json'), 'utf8')) as RigSpec;
  const motion = JSON.parse(readFileSync(join(latticeDir, 'motion.json'), 'utf8')) as Json;
  let baseCheck: CheckReport | null = null;
  const pngNames = [...new Set(Object.values(latticeRig.skins.default).flatMap((s) => Object.values(s as Record<string, { image?: string }>).map((a) => a.image)).filter((x): x is string => typeof x === 'string'))].sort();
  const pngs: Array<[string, Uint8Array]> = pngNames.map((f) => [f, new Uint8Array(readFileSync(join(latticeDir, 'images', f)))]);

  for (const t of targets) {
    const part = t.part;
    const spec = cfg.meshes[part] as LatticeMeshSpec;
    const img = images.get(part) as Raster;
    const lat = att(latticeRig, part);
    const art = artPixels(img);
    const pr: PartRun = {
      part,
      rule: spec.rule ?? 'distance',
      segments: JSON.stringify(spec.segments),
      lattice: { grid: spec.grid, triangles: lat.triangles.length / 3, overdraw: overdrawOf(lat, art), art_px: art },
      islands: [],
      sum: null,
      joined: null,
      joinRefused: null,
      overlaps: [],
      groups: [],
      unbridgedGate: null,
      bridgedGate: null,
      readings: null,
      check: null,
      gate: [],
      draw: null,
    };
    run.parts.push(pr);

    // Per real island: the image with every other real island cleared, meshed as mesh-draft's candidate.
    const comp = connectedComponents(alphaAbove(img, ART_ALPHA), 4);
    const labels = comp.stats.map((st, i) => ({ i, area: st.area })).slice(1).sort((p, q) => q.area - p.area || p.i - q.i);
    const real = labels.filter((l, k) => k === 0 || !isDust(l.area, art));
    const dust = labels.filter((l) => !real.includes(l));
    const stray = dust.length === 0 ? undefined : Math.max(...dust.map((d) => d.area));
    const cand = candidateMesh(spec, rules, stray);
    /** The part's image with every real island outside `keep` cleared, and `path` pixels set to art. */
    const keepOnly = (keep: ReadonlySet<number>, path: readonly number[]): Raster => {
      const data = new Uint8ClampedArray(img.data);
      const out = new Set(real.filter((r) => !keep.has(r.i)).map((r) => r.i));
      for (let i = 0; i < img.width * img.height; i++) if (out.has(comp.labels[i])) data[i * 4 + 3] = 0;
      for (const i of path) data[i * 4 + 3] = 255;
      return { width: img.width, height: img.height, data };
    };
    const meshOf = (one: Raster, px: number): { mesh: UnitMesh; row: IslandMesh } => {
      try {
        const built = buildRig({ ...cfg, meshes: { ...cfg.meshes, [part]: cand } }, parts, new Map([...images, [part, one]]));
        const a = att(built.rig, part);
        if (a.width !== lat.width || a.height !== lat.height || a.image !== lat.image) throw new Error(`island image ${a.image} ${a.width}x${a.height} is not the lattice's ${lat.image} ${lat.width}x${lat.height}`);
        return { mesh: unitsOf(a), row: { px, triangles: a.triangles.length / 3, vertices: a.uvs.length / 2, hull: a.hull, overdraw: overdrawOf(a, px), refused: null } };
      } catch (err) {
        if (!(err instanceof PartsError)) throw err;
        const named = err.problems.filter((p) => p.object.includes(`"${part}"`) || p.detail.includes(`"${part}"`));
        return { mesh: { X: [], Y: [], weights: [], triangles: [], hull: 0 }, row: { px, triangles: 0, vertices: 0, hull: 0, overdraw: 0, refused: (named.length > 0 ? named : err.problems).map(problemLine).join('; ') } };
      }
    };
    const meshes: UnitMesh[] = [];
    for (const isl of real) {
      const m = meshOf(keepOnly(new Set([isl.i]), []), isl.area);
      pr.islands.push(m.row);
      meshes.push(m.mesh);
    }
    if (pr.islands.some((i) => i.refused !== null)) {
      pr.joinRefused = 'an island\'s candidate was refused by the contour mode';
      continue;
    }
    pr.sum = pr.islands.reduce((t, i) => t + i.triangles, 0);

    // Outlines that meet cannot be one simple loop, whatever the bridge. Such islands are grouped (union-find over
    // the pairs that meet) and each group is meshed as one island: its islands joined by the shortest 4-connected
    // pixel path between them, set to art — an emulation of tracing the group's grown silhouette as one.
    const parent = real.map((_r, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const meetEdges: Array<[number, number]> = [];
    for (let i = 0; i < meshes.length; i++) for (let j = i + 1; j < meshes.length; j++) if (outlinesMeet(meshes[i], meshes[j])) {
      pr.overlaps.push([real[i].area, real[j].area]);
      meetEdges.push([i, j]);
    }
    const units: UnitMesh[] = [];
    for (let g = 0; g < real.length; g++) {
      for (const [i, j] of meetEdges) if (find(i) !== find(j)) parent[find(j)] = find(i);
    }
    const groups = new Map<number, number[]>();
    for (let i = 0; i < real.length; i++) groups.set(find(i), [...(groups.get(find(i)) ?? []), i]);
    for (const members of groups.values()) {
      if (members.length === 1) {
        units.push(meshes[members[0]]);
        continue;
      }
      // A spanning tree of the group: each member after the first joined to the nearest already in.
      const path: number[] = [];
      const inTree = [members[0]];
      for (const m of members.slice(1)) {
        let best: { d: number; p: number; q: number } | null = null;
        for (const t of inTree) {
          const g = shortestGap(comp.labels, img.width, img.height, real[t].i, real[m].i);
          if (best === null || g.d < best.d) best = g;
        }
        const b0 = best as { d: number; p: number; q: number };
        path.push(...pixelPath(b0.p, b0.q, img.width).filter((i) => img.data[i * 4 + 3] <= ART_ALPHA));
        inTree.push(m);
      }
      const px = members.reduce((t, i) => t + real[i].area, 0);
      const gm = meshOf(keepOnly(new Set(members.map((i) => real[i].i)), path), px);
      pr.groups.push({ islands: members.map((i) => real[i].area), path_px: path.length, ...gm.row });
      if (gm.row.refused !== null) break;
      units.push(gm.mesh);
    }
    if (pr.groups.some((g) => g.refused !== null)) {
      pr.joinRefused = 'a group of islands whose outlines meet was refused by the contour mode when joined by a pixel path';
      continue;
    }
    for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) if (outlinesMeet(units[i], units[j])) pr.joinRefused = 'after grouping, two units\' outlines still meet';
    if (pr.joinRefused !== null) continue;

    const gateOf = (label: string, a: MeshAttachment): { status: number; lines: string[]; doc: string | null } => {
      const rig = JSON.parse(rigJsonText(latticeRig)) as RigSpec;
      rig.skins.default[part] = { [part]: a };
      let doc: string | null = null;
      const [g] = gateThroughRigc(pngs, [['rig.json', rigJsonText(rig)], ['motion.json', rigJsonText(motionWithBends)]], rigc, join(scratch, `${part}-${label}`), null, (dir) => {
        const p = join(dir, RIGC_MODEL_DOCUMENT);
        doc = readFileSync(p, 'utf8');
      });
      return { status: g.status, lines: g.lines.map((l) => l.trim()).filter((l) => /error|refus|outline|loop|hull|FAIL|PASS|tile/i.test(l)).slice(0, 6), doc };
    };
    const links = bendLinks(cfg, spec.segments);
    const bends = bendAnimations([{ part, links }]);
    const motionWithBends = { ...motion, animations: { ...(motion.animations as Json), ...bends } };

    // The islands as they stand: one vertex list, two outlines.
    let cat = units[0];
    for (let k = 1; k < units.length; k++) cat = concatenated(cat, units[k]);
    if (units.length > 1) {
      const u = gateOf('unbridged', attachmentOfUnits(cat, lat));
      pr.unbridgedGate = { status: u.status, lines: u.lines };
    }

    // Bridged: join the largest island with each next one in turn.
    let joined = units[0];
    const bridges: Array<{ gap_px: number; tried: number }> = [];
    for (let k = 1; k < units.length; k++) {
      const j = bridged(part, joined, units[k]);
      if (j === null) {
        pr.joinRefused = `no bridge between the joined units and unit ${k + 1} passes contourTopologyProblems within the 400 nearest outline pairs`;
        break;
      }
      joined = j.mesh;
      bridges.push({ gap_px: j.gapPx, tried: j.tried });
    }
    if (pr.joinRefused !== null) continue;
    const ja = attachmentOfUnits(joined, lat);
    pr.joined = { triangles: ja.triangles.length / 3, overdraw: overdrawOf(ja, art), bridges };
    pr.draw = { width: lat.width, height: lat.height, lattice: trianglesPx(lat), joined: trianglesPx(ja) };
    const bg = gateOf('bridged', ja);
    pr.bridgedGate = { status: bg.status, lines: bg.lines };
    if (bg.status !== 0 || bg.doc === null) continue;
    if (pr.joined.triangles >= pr.lattice.triangles) continue;

    // Readings 2-5 through mesh-draft's instruments.
    const latDoc = gateOf('lattice', lat);
    const denseLat: LatticeMeshSpec = { grid: denseGrid(art), r: spec.r, segments: spec.segments, ...(spec.exponent === undefined ? {} : { exponent: spec.exponent }), ...(spec.rule === undefined ? {} : { rule: spec.rule }), ...(spec.influences === undefined ? {} : { influences: spec.influences }) };
    const denseRig = buildRig({ ...cfg, meshes: { ...cfg.meshes, [part]: denseLat } }, parts, images).rig;
    const denseDoc = gateOf('dense', att(denseRig, part));
    if (latDoc.doc === null || denseDoc.doc === null) throw new Error(`${part}: a comparison build did not gate (lattice ${latDoc.status}, dense ${denseDoc.status})`);
    const png = readPng(join(latticeDir, 'images', lat.image));
    const alpha = new Uint8Array(png.width * png.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = png.data[i * 4 + 3];
    const mask: AlphaMask = { width: png.width, height: png.height, alpha };
    const compare = (reference: string, cands: string[], schedule: MotionSchedule, perFrame: boolean): MeshQualityReport => {
      const input: MotionComparisonInput = {
        reference: { id: 'reference', model: reference },
        candidates: cands.map((m, i) => ({ id: `candidate ${i}`, model: m })),
        attachments: [{ attachment: { skin: null, slot: part, attachment: part }, art: { mask, threshold: 1, frame: { space: 'part-local-drawing-px-y-down', width: mask.width, height: mask.height, pageScale: 1, conversion: 'texels = px * pageScale' } }, finalThreshold: 1, minArtSamples: 1, regions: [] }],
        referenceArtFit: NO_ART_FIT,
        candidateArtFit: NO_ART_FIT,
        schedule,
        bounds: { maxLocalDeformation: IDLE_BOUND_PX },
        motionRequired: false,
        perFrame,
      };
      return compareMeshesInMotion(input);
    };
    const idle = compare(latDoc.doc, [bg.doc], idleSchedule(), false);
    const frames = Object.keys(bends).map((animation) => ({ animation, times: [0] }));
    const bend = frames.length === 0 ? null : compare(denseDoc.doc, [latDoc.doc, bg.doc], { frames, phases: ['grid'], physics: { mode: 'step', dt: 1 / IDLE_FPS, warmupSteps: 0 }, selection: [] }, true);
    const read = links.length === 0 ? null : bend === null ? 'no bend comparison ran' : bendReading(bend, part, 1);
    const readings: Omit<PartReadings, 'bars'> = { idle: idleReading(idle, part), bend: read === null || typeof read === 'string' ? read : { links, ...read }, triangles: { lattice: pr.lattice.triangles, candidate: pr.joined.triangles } };
    pr.readings = readings;
    // Reading 1: check over the lattice rig directory with this part's attachment replaced, against check over the
    // lattice rig itself; a failing problem is laid on the part by mesh-draft's own partsNamed.
    const checkDir = join(scratch, `${part}-check-rig`);
    cpSync(latticeDir, checkDir, { recursive: true });
    const swapped = JSON.parse(readFileSync(join(latticeDir, 'rig.json'), 'utf8')) as RigSpec;
    swapped.skins.default[part] = { [part]: ja };
    writeFileSync(join(checkDir, 'rig.json'), rigJsonText(swapped));
    const quiet = (): void => undefined;
    if (baseCheck === null) baseCheck = checkStage({ rig: latticeDir, parts: partsDir, out: join(scratch, 'lattice-check'), seamPairs: true }, rigc, bin, quiet);
    const drafted = checkStage({ rig: checkDir, parts: partsDir, out: join(scratch, `${part}-check`), seamPairs: true }, rigc, bin, quiet);
    const seamsOf = (r: CheckReport): SeamCount[] => (r.figures.seam_pairs ?? []).map((x) => ({ parts: x.parts, px_over_40: x.px_over_40 }));
    const bars = drafted.problems.filter((q) => partsNamed(q, [part], { draft: seamsOf(drafted), lattice: seamsOf(baseCheck as CheckReport) }).length > 0).map(problemLine);
    pr.check = { lattice: (baseCheck as CheckReport).figures.PASS, drafted: drafted.figures.PASS, problems: drafted.problems.map(problemLine) };
    pr.gate = gateVerdict({ ...readings, bars }).lines.map((l) => ({ reading: l.reading, pass: l.pass, text: l.text }));
  }
  return run;
}

// ---------------------------------------------------------------------------
// 4. the page and the picture
// ---------------------------------------------------------------------------

const BG: RGBA = [255, 255, 255, 255];
const LAT: RGBA = [60, 90, 200, 255];
const JOIN: RGBA = [200, 60, 40, 255];
const INK: RGBA = [20, 20, 20, 255];

/** One row per drawn part: its lattice (blue) and its bridged per-island mesh (red), each over a pale silhouette of the art's triangles. */
export function picture(runs: readonly FigureRun[]): Plate {
  const items = runs.flatMap((r) => r.parts.filter((p) => p.draw !== null).map((p) => ({ label: `${r.figure} ${p.part}`, p })));
  const CELL = 260;
  const PADY = 18;
  const W = 2 * CELL + 30;
  const H = Math.max(1, items.length) * (CELL + PADY) + 10;
  const plate = new Plate(W, H);
  plate.rect(0, 0, W, H, BG);
  items.forEach(({ label, p }, k) => {
    const d = p.draw as NonNullable<PartRun['draw']>;
    const s = Math.min((CELL - 10) / d.width, (CELL - 10) / d.height);
    const y0 = k * (CELL + PADY) + PADY;
    plate.text(`${label}: lattice ${p.lattice.triangles} / per island ${p.joined?.triangles ?? '-'}`, 10, y0 - 13, 1, INK);
    for (const [col, tris, x0] of [[LAT, d.lattice, 10], [JOIN, d.joined, CELL + 20]] as const) {
      plate.frame(x0, y0, CELL, CELL, 1, [200, 200, 200, 255]);
      for (const t of tris) {
        for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) plate.line(x0 + 5 + t[2 * i] * s, y0 + 5 + t[2 * i + 1] * s, x0 + 5 + t[2 * j] * s, y0 + 5 + t[2 * j + 1] * s, 1, col);
      }
    }
  });
  return plate;
}

const f3 = (v: number): string => String(pyRound(v, 3));

export function page(runs: readonly FigureRun[]): string {
  const out: string[] = [];
  out.push('| figure | H (px) | T | S | parts | lattice parts | lattice parts with 2+ real islands | other parts with 2+ real islands |');
  out.push('| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for (const r of runs) {
    const multi = r.islandRows.filter((x) => x.real > 1);
    const fmt = (x: IslandRow): string => `${x.part} (${x.entry}; ${x.islands.slice(0, x.real).join(' + ')} px${x.islands.length > x.real ? `, +${x.islands.length - x.real} dust` : ''})`;
    out.push(`| ${r.figure}${r.latticeAll ? ' (every mesh a lattice at S)' : ''} | ${r.rules.height} | ${r.rules.tolerance} | ${r.rules.spacing} | ${r.islandRows.length} | ${r.islandRows.filter((x) => x.entry === 'grid').length} | ${multi.filter((x) => x.entry === 'grid').map(fmt).join('; ') || 'none'} | ${multi.filter((x) => x.entry !== 'grid').map(fmt).join('; ') || 'none'} |`);
  }
  out.push('');
  out.push('Per lattice part kept for a real piece: the lattice, each island\'s candidate (mesh-draft\'s, on the part\'s image with the other real islands cleared), their sum, and the islands joined by bridges into one attachment.');
  out.push('');
  out.push('| figure | part | rule | lattice grid | lattice triangles | lattice overdraw | islands (px: triangles, overdraw) | Σ islands | outlines that meet, meshed as one (islands px; path px; triangles) | joined (+2 per bridge) | joined overdraw | bridge gap (px) | rigc, unbridged | rigc, bridged |');
  out.push('| --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- | ---: | ---: | --- | --- | --- |');
  for (const r of runs) for (const p of r.parts) {
    const isl = p.islands.map((i) => (i.refused === null ? `${i.px}: ${i.triangles}, ${f3(i.overdraw)}` : `${i.px}: refused`)).join('; ');
    const g = (x: PartRun['unbridgedGate']): string => (x === null ? '— (one unit)' : `exit ${x.status}`);
    out.push(`| ${r.figure} | ${p.part} | ${p.rule} | ${p.lattice.grid} | ${p.lattice.triangles} | ${f3(p.lattice.overdraw)} | ${isl} | ${p.sum ?? '—'} | ${p.groups.map((g) => `${g.islands.join(' + ')}; ${g.path_px}; ${g.refused === null ? g.triangles : 'refused'}`).join(' / ') || 'none'} | ${p.joined?.triangles ?? '—'} | ${p.joined === null ? '—' : f3(p.joined.overdraw)} | ${p.joined?.bridges.map((b) => f3(b.gap_px)).join(', ') ?? '—'} | ${g(p.unbridgedGate)} | ${g(p.bridgedGate)} |`);
  }
  out.push('');
  out.push('mesh-draft\'s five readings on the joined mesh, where it is lighter than the lattice (reading 1: \`check\` over the lattice rig with the part\'s attachment replaced, problems laid on the part by \`partsNamed\`):');
  out.push('');
  for (const r of runs) for (const p of r.parts) {
    if (p.gate.length === 0) continue;
    out.push(`- ${r.figure} ${p.part}: ${p.gate.every((l) => l.pass) ? 'PASS' : 'FAIL'}${p.check === null ? '' : ` (check: lattice rig ${p.check.lattice ? 'PASS' : 'FAIL'}, with the joined mesh ${p.check.drafted ? 'PASS' : 'FAIL'}${p.check.problems.length === 0 ? '' : `: ${p.check.problems.join('; ')}`})`}`);
    for (const l of p.gate) out.push(`  - ${l.pass ? 'pass' : 'FAIL'} ${l.reading}: ${l.text}`);
  }
  out.push('');
  out.push('rigc\'s lines on the unbridged concatenation (one per part, the first that names the outline):');
  out.push('');
  for (const r of runs) for (const p of r.parts) {
    if (p.unbridgedGate === null) continue;
    out.push(`- ${r.figure} ${p.part}: exit ${p.unbridgedGate.status} — \`${(p.unbridgedGate.lines.find((l) => /outline|loop|hull/i.test(l)) ?? p.unbridgedGate.lines[0] ?? '').slice(0, 400)}\``);
  }
  for (const r of runs) for (const p of r.parts) if (p.joinRefused !== null) out.push(`- ${r.figure} ${p.part}: not joined — ${p.joinRefused}${p.islands.filter((i) => i.refused !== null).map((i) => `; island ${i.px} px: ${i.refused}`).join('')}`);
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// cli
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const opt = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i < 0 ? undefined : argv[i + 1];
  };
  if (argv.includes('--page')) {
    const files = argv.slice(argv.indexOf('--page') + 1).filter((a, i, all) => !a.startsWith('--') && (i === 0 || all[i - 1] !== '--picture'));
    const runs = files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as FigureRun);
    const pic = opt('--picture');
    if (pic !== undefined) picture(runs).writePng(pic);
    process.stdout.write(page(runs));
  } else {
    const [figure, config, parts, scratch] = [opt('--figure'), opt('--config'), opt('--parts'), opt('--scratch')];
    if (figure === undefined || config === undefined || parts === undefined || scratch === undefined) {
      process.stderr.write('usage: island_draft_survey.ts --figure <label> --config <config.json> --parts <dir> --scratch <dir> [--lattice-all]\n');
      process.exit(2);
    }
    process.stdout.write(`${JSON.stringify(runFigure(figure, config, parts, scratch, argv.includes('--lattice-all')), null, 2)}\n`);
  }
}
