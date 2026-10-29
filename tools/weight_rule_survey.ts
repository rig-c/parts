#!/usr/bin/env bun
import { regionBone } from '../src/config.ts';
/**
 * Issue #161, Stage A: weight rules measured against hand-painted weights, on a public editor export, before any
 * mechanism. One command writes the evidence page and its picture:
 *
 *     bun run fetch-examples          # once: examples/*\/inputs (the sample face, part 4)
 *     bun tools/weight_rule_survey.ts --exports <dir> --images <dir> --picture docs/evidence/weight-rules.png > docs/evidence/weight-rules.md
 *
 * `--exports` is a directory holding Esoteric Software's spineboy example export (`spineboy-pro.json` and the atlas
 * it loads through, `spineboy.atlas`), `--images` the project's untrimmed images, and the directory above `--exports`
 * holds the project's `license.txt`. None of it is in this repository or in the package: the page records the
 * directory's basename, the skeleton file's sha256 and the licence's lines, never a path.
 *
 * Four parts, each a function below and each held by the `auto-mesh` suite's WX01-WX06:
 *
 * 1. **The rules on the authored vertices** ({@link ruleVectors}, {@link boneHeat}, {@link capFloor},
 *    {@link columnsOf}): per weighted mesh, the rigger's weight vector at every vertex against the package's rule
 *    (`influences`, src/weights.ts) with the mesh's own bound bones as segments from the export's setup pose, the same
 *    rule with cap 8, and two tool rules — bone heat and bone heat with cap 4.
 * 2. **The posed displacement** ({@link skinPoint}, {@link localOffset}, {@link nearestRank}): every rule-weighted mesh
 *    against the authored-weighted mesh, both skinned from the same bone world transforms, which rig-c's public
 *    `@rig-c/core/render` entry (`spinePoser`) poses through spine-core over every animation of the export.
 * 3. **The footprint region on the public sample** ({@link footprintRegion}, {@link lidReading}): the sample's face
 *    under the plain rule, the plain rule plus a bone-and-band region per lash whose polygon is that lash's footprint
 *    on the face (src/localweights.ts), and bone heat — each against issue #160's lid field, with #160's measure.
 * 4. **The picture** ({@link picture}): wires and weights on a blank plate (no image of the export is drawn), drawn
 *    on rig-c's `tools/plate.ts` (whose text is `tools/font5x7.ts`).
 *
 * Nothing under `src/` is changed or extended. Bone heat is this tool's rule, not the package's.
 *
 * Output: Markdown on standard output; wall times on standard error. Exit 1 when an input is missing; 0 otherwise.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Plate, type RGBA } from '@rig-c/core/tools/plate.ts';
import { type CharacterConfig, loadConfig } from '../src/config.ts';
import { growSilhouette } from '../src/contour.ts';
import { localInfluences, type WeightRegion } from '../src/localweights.ts';
import { readParts } from '../src/parts.ts';
import { connectedComponents, fillHoles, type Mask, newMask, readPng } from '../src/raster/index.ts';
import { PAD } from '../src/rig.ts';
import { DEFAULT_LIMITS, type Influence, type InfluenceLimits, influences, type Segment, segmentDistance } from '../src/weights.ts';
import { assembleExample, installedRigc, missingInputs, pinnedInputs } from './auto_motion_survey.ts';
import { distanceToPixels, faceFixture, FACE, footprintMask, islandOutlines, type PlacedPart } from './feature_contour_survey.ts';

const ROOT = resolve(import.meta.dir, '..');

type Pt = readonly [number, number];
/** A weight vector: bones and their shares. */
export type Vec = ReadonlyArray<{ bone: string; weight: number }>;

// ---------------------------------------------------------------------------
// 1. the rules and the columns
// ---------------------------------------------------------------------------

/**
 * The package's rule's `r`: the median of the `r` the three public examples declare on their meshes (`r` is a
 * required per-mesh field with no package default, so there is no package value to take). Read off the tracked
 * configs by {@link publicR}; the page prints the list it was taken from.
 */
export function publicR(): { r: number; from: number[] } {
  const from: number[] = [];
  for (const k of ['reference-demo', 'reference-sample', 'scarf']) {
    const raw = JSON.parse(readFileSync(join(ROOT, 'examples', k, 'config.json'), 'utf8')) as { meshes: Record<string, { r: number }> };
    for (const m of Object.values(raw.meshes)) from.push(m.r);
  }
  from.sort((a, b) => a - b);
  const n = from.length;
  return { r: n % 2 === 1 ? from[(n - 1) / 2] : (from[n / 2 - 1] + from[n / 2]) / 2, from };
}

/** The cap and floor `influences()` applies, on a list already aggregated per bone: sorted (stable), the top `maxInfluences` normalised, those under `minWeight` dropped, normalised again. */
export function capFloor(list: Vec, limits: InfluenceLimits): Influence[] {
  const top = [...list].sort((x, y) => y.weight - x.weight).slice(0, limits.maxInfluences);
  let s = 0;
  for (const e of top) s += e.weight;
  const kept = top.map((e) => ({ bone: e.bone, weight: e.weight / s })).filter((e) => e.weight >= limits.minWeight);
  let s2 = 0;
  for (const e of kept) s2 += e.weight;
  return kept.map((e) => ({ bone: e.bone, weight: e.weight / s2 }));
}

/** The heaviest bone of a vector; a tie goes to the bone first in `order` (the skeleton's). Null for an empty vector. */
export function heaviestOf(v: Vec, order: readonly string[]): string | null {
  let best: string | null = null;
  let bw = -Infinity;
  let bi = Infinity;
  for (const e of v) {
    const i = order.indexOf(e.bone);
    if (e.weight > bw || (e.weight === bw && i < bi)) {
      best = e.bone;
      bw = e.weight;
      bi = i;
    }
  }
  return best;
}

const shareIn = (v: Vec, bone: string): number => v.reduce((s, e) => (e.bone === bone ? s + e.weight : s), 0);

/** L1 between two vectors over the union of their bones (0-2 for two normalised vectors). */
export function l1(a: Vec, b: Vec): number {
  const bones = new Set([...a.map((e) => e.bone), ...b.map((e) => e.bone)]);
  let s = 0;
  for (const bone of bones) s += Math.abs(shareIn(a, bone) - shareIn(b, bone));
  return s;
}

/** The card's weight columns over a set of vertices: mean L1, the share with the same heaviest bone, the mean weight the rule puts on the authored heaviest bone, and the authored heaviest weight itself. */
export interface Columns {
  vertices: number;
  l1: number;
  same: number;
  onAuthored: number;
  authoredHeaviest: number;
}

export function columnsOf(pairs: ReadonlyArray<{ authored: Vec; rule: Vec }>, order: readonly string[]): Columns {
  let sl = 0;
  let same = 0;
  let on = 0;
  let ah = 0;
  for (const { authored, rule } of pairs) {
    const h = heaviestOf(authored, order);
    sl += l1(authored, rule);
    if (h !== null && heaviestOf(rule, order) === h) same++;
    if (h !== null) {
      on += shareIn(rule, h);
      ah += shareIn(authored, h);
    }
  }
  const n = pairs.length;
  return { vertices: n, l1: sl / n, same: same / n, onAuthored: on / n, authoredHeaviest: ah / n };
}

/**
 * Bone heat, this tool's rule. The discretisation is the image grid: one unknown per pixel of the silhouette (4-connected
 * neighbours; a neighbour off the silhouette is no neighbour — no flux through the boundary). Each bone's sources are the
 * silhouette pixels whose centre lies within `band` px of one of its segments; in a 4-connected component of the
 * silhouette that no such pixel of a bone lies in, that bone's source is the component's pixel nearest its segments
 * among those no bone holds yet (bones in order; ties: raster order), or the nearest of all when every pixel there is
 * held. A pixel two bones claim goes to the bone whose segment is nearer its centre, a tie to the bone
 * listed first. Per bone, the field is 1 on its sources, 0 on every other bone's, and the discrete Laplace equation
 * elsewhere, solved by successive over-relaxation (Gauss-Seidel over-relaxed by `omega` = 2 / (1 + sin(pi / L)), L the
 * mask's longer side) in raster order from 0, until the largest change in one sweep is under `tolerance` or
 * `maxIterations` sweeps have run.
 */
export interface HeatSpec {
  tolerance: number;
  maxIterations: number;
  band: number;
}

export const HEAT: HeatSpec = { tolerance: 1e-7, maxIterations: 20000, band: 0.75 };

export interface HeatResult {
  bones: string[];
  /** One field per bone, row-major over the mask; 0 off the silhouette. */
  fields: Float64Array[];
  iterations: number[];
  converged: boolean[];
  /** The largest |x - mean of its neighbours| over the free pixels, over every bone, after the solve. */
  residual: number;
  omega: number;
  /** Source pixels each bone holds after the claims are settled. */
  sources: number[];
  /** Bones that took a nearest pixel in some component (no pixel within the band there). */
  nearest: string[];
}

export function boneHeat(sil: Mask, segs: readonly Segment[], spec: HeatSpec = HEAT): HeatResult {
  const { width: w, height: h, data } = sil;
  const bones: string[] = [];
  for (const s of segs) if (!bones.includes(s.bone)) bones.push(s.bone);
  const K = bones.length;
  const n = w * h;
  const dist = bones.map(() => new Float64Array(n).fill(Infinity));
  for (let i = 0; i < n; i++) {
    if (data[i] !== 1) continue;
    const p: [number, number] = [(i % w) + 0.5, Math.floor(i / w) + 0.5];
    for (const s of segs) {
      const k = bones.indexOf(s.bone);
      const d = segmentDistance(p, s.a, s.b);
      if (d < dist[k][i]) dist[k][i] = d;
    }
  }
  const cc = connectedComponents(sil, 4);
  const owner = new Int32Array(n).fill(-1);
  const claim = (i: number, k: number): void => {
    const o = owner[i];
    if (o < 0 || dist[k][i] < dist[o][i] || (dist[k][i] === dist[o][i] && k < o)) owner[i] = k;
  };
  const inBand: boolean[][] = Array.from({ length: cc.count }, () => new Array<boolean>(K).fill(false));
  for (let i = 0; i < n; i++) {
    if (data[i] !== 1) continue;
    for (let k = 0; k < K; k++) {
      if (dist[k][i] <= spec.band) {
        claim(i, k);
        inBand[cc.labels[i]][k] = true;
      }
    }
  }
  const nearest = new Set<string>();
  for (let c = 1; c < cc.count; c++) {
    for (let k = 0; k < K; k++) {
      if (inBand[c][k]) continue;
      // The nearest pixel no bone holds yet; only when every pixel of the component is held, the nearest of all,
      // contested by distance like any other claim.
      let bi = -1;
      for (let i = 0; i < n; i++) if (cc.labels[i] === c && owner[i] < 0 && (bi < 0 || dist[k][i] < dist[k][bi])) bi = i;
      if (bi < 0) for (let i = 0; i < n; i++) if (cc.labels[i] === c && (bi < 0 || dist[k][i] < dist[k][bi])) bi = i;
      if (bi >= 0) {
        claim(bi, k);
        nearest.add(bones[k]);
      }
    }
  }
  const free: number[] = [];
  const start: number[] = [0];
  const nbr: number[] = [];
  for (let i = 0; i < n; i++) {
    if (data[i] !== 1 || owner[i] >= 0) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    if (x > 0 && data[i - 1] === 1) nbr.push(i - 1);
    if (x < w - 1 && data[i + 1] === 1) nbr.push(i + 1);
    if (y > 0 && data[i - w] === 1) nbr.push(i - w);
    if (y < h - 1 && data[i + w] === 1) nbr.push(i + w);
    free.push(i);
    start.push(nbr.length);
  }
  const F = Int32Array.from(free);
  const S = Int32Array.from(start);
  const N = Int32Array.from(nbr);
  const omega = 2 / (1 + Math.sin(Math.PI / Math.max(w, h)));
  const fields: Float64Array[] = [];
  const iterations: number[] = [];
  const converged: boolean[] = [];
  const sources: number[] = [];
  let residual = 0;
  for (let k = 0; k < K; k++) {
    const x = new Float64Array(n);
    let held = 0;
    for (let i = 0; i < n; i++) {
      if (owner[i] === k) {
        x[i] = 1;
        held++;
      }
    }
    sources.push(held);
    let it = 0;
    let done = F.length === 0;
    while (!done && it < spec.maxIterations) {
      it++;
      let maxD = 0;
      for (let j = 0; j < F.length; j++) {
        const i = F[j];
        const a = S[j];
        const b = S[j + 1];
        let s = 0;
        for (let q = a; q < b; q++) s += x[N[q]];
        const nx = x[i] + omega * (s / (b - a) - x[i]);
        const d = Math.abs(nx - x[i]);
        if (d > maxD) maxD = d;
        x[i] = nx;
      }
      if (maxD < spec.tolerance) done = true;
    }
    for (let j = 0; j < F.length; j++) {
      let s = 0;
      for (let q = S[j]; q < S[j + 1]; q++) s += x[N[q]];
      residual = Math.max(residual, Math.abs(x[F[j]] - s / (S[j + 1] - S[j])));
    }
    fields.push(x);
    iterations.push(it);
    converged.push(done);
  }
  return { bones, fields, iterations, converged, residual, omega, sources, nearest: [...nearest] };
}

/** The silhouette pixel whose centre is nearest `p` (ties: raster order); -1 for an empty mask. */
export function nearestPixel(sil: Mask, p: Pt): number {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < sil.data.length; i++) {
    if (sil.data[i] !== 1) continue;
    const dx = (i % sil.width) + 0.5 - p[0];
    const dy = Math.floor(i / sil.width) + 0.5 - p[1];
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Bone heat's vector at `p`: every bone's field at the nearest silhouette pixel, clamped at 0, normalised; zero shares left out. */
export function heatAt(res: HeatResult, sil: Mask, p: Pt): Influence[] {
  const i = nearestPixel(sil, p);
  const raw = res.bones.map((bone, k) => ({ bone, weight: i < 0 ? 0 : Math.max(0, res.fields[k][i]) }));
  const s = raw.reduce((t, e) => t + e.weight, 0);
  return raw.filter((e) => e.weight > 0).map((e) => ({ bone: e.bone, weight: e.weight / s }));
}

/** The four rules' vectors at one point: `p` and `segs` in the rule's frame, `heat` the bone heat already solved for the same segments (`hp` the point in its mask's frame). */
export type RuleName = 'current' | 'cap8' | 'heat' | 'heat4';
export const RULES: readonly RuleName[] = ['current', 'cap8', 'heat', 'heat4'];
export const CAP8: InfluenceLimits = { maxInfluences: 8, minWeight: DEFAULT_LIMITS.minWeight };

export function ruleVectors(p: Pt, segs: readonly Segment[], r: number, heat: HeatResult, sil: Mask, hp: Pt): Record<RuleName, Influence[]> {
  const hv = heatAt(heat, sil, hp);
  return {
    current: influences([p[0], p[1]], segs, r, DEFAULT_LIMITS),
    cap8: influences([p[0], p[1]], segs, r, CAP8),
    heat: hv,
    heat4: capFloor(hv, DEFAULT_LIMITS),
  };
}

// ---------------------------------------------------------------------------
// 2. skinning and the displacement statistics
// ---------------------------------------------------------------------------

/** A bone's world transform: the linear part [a b; c d] and the origin, world units, y up (rig-c's `BoneSnapshot`). */
export interface Xf {
  a: number;
  b: number;
  c: number;
  d: number;
  worldX: number;
  worldY: number;
}

/** The bone-local offset of a world point: the inverse of the bone's world transform applied to it. */
export function localOffset(m: Xf, p: Pt): [number, number] {
  const det = m.a * m.d - m.b * m.c;
  const x = p[0] - m.worldX;
  const y = p[1] - m.worldY;
  return [(m.d * x - m.b * y) / det, (-m.c * x + m.a * y) / det];
}

/** Linear blend skinning: Σ wᵢ (Mᵢ·offsetᵢ + tᵢ) — Spine's weighted vertex, which `MeshAttachment.computeWorldVertices` computes. */
export function skinPoint(v: ReadonlyArray<{ bone: string; weight: number; offset: Pt }>, pose: ReadonlyMap<string, Xf>): [number, number] {
  let x = 0;
  let y = 0;
  for (const e of v) {
    const m = pose.get(e.bone);
    if (m === undefined) throw new Error(`weight_rule_survey: no posed bone ${e.bone}`);
    x += e.weight * (m.a * e.offset[0] + m.b * e.offset[1] + m.worldX);
    y += e.weight * (m.c * e.offset[0] + m.d * e.offset[1] + m.worldY);
  }
  return [x, y];
}

/** The nearest-rank percentile: the ceil(q·n)-th smallest value (q in (0, 1]); NaN for an empty list. */
export function nearestRank(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(q * s.length) - 1)];
}

// ---------------------------------------------------------------------------
// 3. the footprint region and the lid reading
// ---------------------------------------------------------------------------

/**
 * A bone-and-band region whose polygon is a layer's footprint on a base part: the layer's pixels at alpha >= 8 on the
 * base's filled silhouette (#160's {@link footprintMask}), in the base's padded frame (`pad` px), holes filled and
 * diagonal pinches filled by the contour mode's rule (`growSilhouette` at margin 0), traced at pixel corners by rig-c's
 * tracer; the largest island is the polygon, the rest are counted. Refused by name when the layer leaves no footprint.
 */
export function footprintRegion(base: PlacedPart, layer: PlacedPart, pad: number, bone: string, band: number): { region: WeightRegion; px: number; islands: number } | { refused: string } {
  const raw = footprintMask(base, layer);
  const w = raw.width + 2 * pad;
  const h = raw.height + 2 * pad;
  const m = newMask(w, h);
  for (let y = 0; y < raw.height; y++) for (let x = 0; x < raw.width; x++) m.data[(y + pad) * w + x + pad] = raw.data[y * raw.width + x];
  const grown = growSilhouette(fillHoles(m), 0).mask;
  const isl = islandOutlines(grown);
  if (isl.length === 0) return { refused: `FOOTPRINT_EMPTY: layer "${layer.name}" has no pixel at alpha >= 8 on "${base.name}"'s filled silhouette` };
  const first = isl[0];
  if ('refused' in first) return { refused: `FOOTPRINT_TRACE: layer "${layer.name}" — ${first.refused}` };
  return { region: { name: `${layer.name}-footprint`, shape: 'polygon', points: first.outline.map(([x, y]) => [x, y]), band, bone }, px: first.px, islands: isl.length };
}

/** The lid reading of one rule: #160's measure, |lid share − lid field| · |T|, over the edge samples and over the art; and where the heaviest bone is a lid bone, on and off the footprint. */
export interface LidReading {
  edgeMax: number;
  edgeP95: number;
  artMax: number;
  artP95: number;
  /** Share of footprint pixel centres whose heaviest bone is a lid bone. */
  insideLid: number;
  /** Share of art pixel centres off the footprint whose heaviest bone is a lid bone. */
  outsideLid: number;
}

export function lidReading(vec: (p: Pt) => Vec, lids: readonly string[], order: readonly string[], field: (p: Pt) => number, T: number, edge: readonly Pt[], inside: readonly Pt[], outside: readonly Pt[]): LidReading {
  const share = (v: Vec): number => lids.reduce((s, b) => s + shareIn(v, b), 0);
  const dEdge = edge.map((p) => Math.abs(share(vec(p)) - field(p)) * T);
  const dArt = [...inside, ...outside].map((p) => Math.abs(share(vec(p)) - field(p)) * T);
  const lidHeavy = (ps: readonly Pt[]): number => (ps.length === 0 ? NaN : ps.filter((p) => lids.includes(heaviestOf(vec(p), order) ?? '')).length / ps.length);
  return { edgeMax: Math.max(0, ...dEdge), edgeP95: nearestRank(dEdge, 0.95), artMax: Math.max(0, ...dArt), artP95: nearestRank(dArt, 0.95), insideLid: lidHeavy(inside), outsideLid: lidHeavy(outside) };
}

// ---------------------------------------------------------------------------
// the export, read
// ---------------------------------------------------------------------------

export const SKELETON = 'spineboy-pro.json';
export const ATLAS = 'spineboy.atlas';
/** The reference frames' rate: rig-c's bench reference for this skeleton is sampled at 12 fps (its `frames.json`, stride 1). */
export const FPS = 12;
/** The card's bound: a mesh is "within 2 px" when its 95th-percentile displacement is at most this. */
export const BOUND = 2;

interface ExportMesh {
  key: string;
  slot: string;
  name: string;
  image: string;
  width: number;
  height: number;
  uvs: number[];
  triangles: number[];
  /** Per vertex, the authored influences: bone, weight and the bone-local offset the export stores. */
  authored: Array<Array<{ bone: string; weight: number; offset: Pt }>>;
  bones: string[];
}

interface SkinJson {
  name: string;
  attachments: Record<string, Record<string, { type?: string; path?: string; uvs?: number[]; vertices?: number[]; triangles?: number[]; width?: number; height?: number }>>;
}

interface SkeletonJson {
  bones: Array<{ name: string; length?: number }>;
  skins: SkinJson[];
  animations?: Record<string, { attachments?: Record<string, Record<string, Record<string, unknown>>> }>;
}

export function weightedMeshes(doc: SkeletonJson): ExportMesh[] {
  const out: ExportMesh[] = [];
  const order = doc.bones.map((b) => b.name);
  for (const skin of doc.skins) {
    for (const [slot, atts] of Object.entries(skin.attachments)) {
      for (const [name, a] of Object.entries(atts)) {
        if (a.type !== 'mesh' || a.uvs === undefined || a.vertices === undefined || a.vertices.length === a.uvs.length) continue;
        const v = a.vertices;
        const authored: ExportMesh['authored'] = [];
        let i = 0;
        const used = new Set<string>();
        while (i < v.length) {
          const k = v[i++];
          const row: Array<{ bone: string; weight: number; offset: Pt }> = [];
          for (let j = 0; j < k; j++) {
            const bone = order[v[i]];
            row.push({ bone, weight: v[i + 3], offset: [v[i + 1], v[i + 2]] });
            used.add(bone);
            i += 4;
          }
          authored.push(row);
        }
        out.push({ key: `${skin.name}/${slot}/${name}`, slot, name, image: a.path ?? name, width: a.width ?? NaN, height: a.height ?? NaN, uvs: a.uvs, triangles: a.triangles ?? [], authored, bones: order.filter((b) => used.has(b)) });
      }
    }
  }
  return out;
}

/** Least-squares affine map from `src` to `dst` (x' = p0 x + p1 y + p2, likewise y'), and its largest residual. */
export function affineFit(src: readonly Pt[], dst: readonly Pt[]): { map: (p: Pt) => [number, number]; residual: number; scale: number } {
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const bx = [0, 0, 0];
  const by = [0, 0, 0];
  for (let i = 0; i < src.length; i++) {
    const r = [src[i][0], src[i][1], 1];
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) A[j][k] += r[j] * r[k];
      bx[j] += r[j] * dst[i][0];
      by[j] += r[j] * dst[i][1];
    }
  }
  const solve = (b: number[]): number[] => {
    const M = A.map((row, j) => [...row, b[j]]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  };
  const px = solve(bx);
  const py = solve(by);
  const map = (p: Pt): [number, number] => [px[0] * p[0] + px[1] * p[1] + px[2], py[0] * p[0] + py[1] * p[1] + py[2]];
  let residual = 0;
  for (let i = 0; i < src.length; i++) {
    const q = map(src[i]);
    residual = Math.max(residual, Math.hypot(q[0] - dst[i][0], q[1] - dst[i][1]));
  }
  return { map, residual, scale: Math.sqrt(Math.abs(px[0] * py[1] - px[1] * py[0])) };
}

/** A bone's segment from its world transform: origin to origin + length along its world x axis. */
export function boneSegment(bone: string, m: Xf, length: number): Segment {
  return { bone, a: [m.worldX, m.worldY], b: [m.worldX + length * m.a, m.worldY + length * m.c] };
}

interface MeshRun {
  mesh: ExportMesh;
  columns: Record<RuleName, Columns>;
  pairs: Record<RuleName, Array<{ authored: Vec; rule: Vec }>>;
  disp: Record<RuleName, number[]>;
  worst: { animation: string; frame: number; value: number; pose: Map<string, Xf> } | null;
  vectors: Array<Record<RuleName, Influence[]>>;
  setupWorld: Array<[number, number]>;
  fit: { residual: number; scale: number };
  heat: HeatResult;
  silPx: number;
  frames: number;
  /** Bones bone heat left with no source pixel, and how near their segment comes to another bone's at setup (world px). */
  zeroSource: Array<{ bone: string; near: string; gap: number }>;
}

/** The page's rows for the export, from the rules alone — the measurement is `measureExport` in `main`. */
function f(v: number | null | undefined, d = 3): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number.isFinite(v) ? String(Number(v.toFixed(d))) : String(v);
}
const pct = (v: number): string => (Number.isNaN(v) ? '—' : `${(v * 100).toFixed(1)} %`);

// ---------------------------------------------------------------------------
// 4. the picture
// ---------------------------------------------------------------------------

const INK: RGBA = [20, 20, 20, 255];
const PAPER: RGBA = [255, 255, 255, 255];
const GHOST: RGBA = [200, 200, 200, 255];
const WIRE: RGBA = [40, 90, 200, 255];
const RED: RGBA = [220, 40, 40, 255];
const BONES: readonly RGBA[] = [
  [230, 120, 20, 255],
  [30, 150, 60, 255],
  [140, 60, 190, 255],
  [20, 150, 190, 255],
  [190, 40, 120, 255],
  [120, 120, 20, 255],
];

export interface StripPanel {
  title: string;
  points: ReadonlyArray<readonly [number, number]>;
  heaviest: readonly string[];
  caption: string[];
}

export interface Strip {
  label: string;
  bones: readonly string[];
  triangles: readonly number[];
  authored: ReadonlyArray<readonly [number, number]>;
  panels: readonly StripPanel[];
}

export interface FacePanel {
  title: string;
  width: number;
  height: number;
  /** Per pixel: -1 off the art, else the lid share 0..1. */
  share: Float64Array;
  footprint: Uint8Array;
  caption: string[];
}

/** The picture: one row per spineboy strip (authored / rules, posed at the worst frame, world y up drawn up) and one for the sample face (lid share per pixel, footprint in ink). Wires and weights only: no texel of the export. */
export function picture(strips: readonly Strip[], face: readonly FacePanel[]): Plate {
  const gap = 12;
  const box = 200;
  const capH = 4 * 10;
  const faceScale = 2;
  const stripW = Math.max(...strips.map((s) => s.panels.length)) * (box + gap) + gap;
  const faceW = face.reduce((n, p) => n + p.width * faceScale + gap, gap);
  const W = Math.max(stripW, faceW, 420);
  const faceH = face.length === 0 ? 0 : Math.max(...face.map((p) => p.height)) * faceScale + 14 + capH + gap;
  const H = gap + strips.length * (14 + box + capH + gap) + faceH + 16;
  const plate = new Plate(W, H);
  plate.rect(0, 0, W, H, PAPER);
  let oy = gap;
  for (const s of strips) {
    plate.text(s.label.toUpperCase(), gap, oy, 1, INK);
    oy += 14;
    const all = [...s.authored, ...s.panels.flatMap((p) => p.points)];
    const x0 = Math.min(...all.map((p) => p[0]));
    const x1 = Math.max(...all.map((p) => p[0]));
    const y0 = Math.min(...all.map((p) => p[1]));
    const y1 = Math.max(...all.map((p) => p[1]));
    const sc = (box - 8) / Math.max(x1 - x0, y1 - y0, 1);
    s.panels.forEach((p, k) => {
      const ox = gap + k * (box + gap);
      const at = (q: readonly [number, number]): [number, number] => [ox + 4 + (q[0] - x0) * sc, oy + 4 + (y1 - q[1]) * sc];
      plate.frame(ox, oy, box, box, 1, GHOST);
      const wire = (pts: ReadonlyArray<readonly [number, number]>, colour: RGBA): void => {
        for (let t = 0; t + 2 < s.triangles.length; t += 3) {
          for (let e = 0; e < 3; e++) {
            const a = at(pts[s.triangles[t + e]]);
            const b = at(pts[s.triangles[t + ((e + 1) % 3)]]);
            plate.line(a[0], a[1], b[0], b[1], 1, colour);
          }
        }
      };
      if (k > 0) wire(s.authored, GHOST);
      wire(p.points, WIRE);
      p.points.forEach((q, i) => {
        if (k > 0) {
          const a = at(s.authored[i]);
          const b = at(q);
          plate.line(a[0], a[1], b[0], b[1], 1, RED);
        }
        const c = at(q);
        plate.disc(c[0], c[1], 2, BONES[Math.max(0, s.bones.indexOf(p.heaviest[i])) % BONES.length]);
      });
      [p.title, ...p.caption].forEach((line, i) => plate.text(line.toUpperCase().slice(0, 32), ox, oy + box + 4 + i * 10, 1, INK));
    });
    const lx = gap + s.panels.length * (box + gap);
    s.bones.forEach((b, i) => {
      if (lx + 60 > W) return;
      plate.disc(lx + 3, oy + 8 + i * 12, 3, BONES[i % BONES.length]);
      plate.text(b.toUpperCase().slice(0, 14), lx + 10, oy + 5 + i * 12, 1, INK);
    });
    oy += box + capH + gap;
  }
  if (face.length > 0) {
    plate.text('SAMPLE FACE: LID SHARE (GREY 0, RED 1), LASH FOOTPRINT IN INK', gap, oy, 1, INK);
    oy += 14;
    let ox = gap;
    for (const p of face) {
      for (let y = 0; y < p.height; y++) {
        for (let x = 0; x < p.width; x++) {
          const i = y * p.width + x;
          const s = p.share[i];
          if (s < 0) continue;
          const t = Math.min(1, Math.max(0, s));
          const c: RGBA = p.footprint[i] === 1 ? INK : [Math.round(235 - 15 * t), Math.round(235 - 205 * t), Math.round(235 - 205 * t), 255];
          plate.rect(ox + x * faceScale, oy + y * faceScale, faceScale, faceScale, c);
        }
      }
      [p.title, ...p.caption].forEach((line, i) => plate.text(line.toUpperCase().slice(0, 40), ox, oy + p.height * faceScale + 4 + i * 10, 1, INK));
      ox += p.width * faceScale + gap;
    }
  }
  return plate;
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

function argOf(args: readonly string[], name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

interface FaceRun {
  rows: Array<{ rule: string; reading: LidReading; refused: string | null }>;
  regions: Array<{ layer: string; bone: string; px: number; islands: number; points: number } | { layer: string; refused: string }>;
  /** Every band tried for the footprint regions, #160's first, and how many samples two regions both reach there. */
  tried: Array<{ band: number; overlaps: number }>;
  accepted: number | null;
  T: number;
  band: number;
  r: number;
  segs: string[];
  edge: number;
  inside: number;
  outside: number;
  heat: { iterations: number; converged: boolean; residual: number; omega: number };
  panels: FacePanel[];
}

/** Part 3: the sample face. */
function faceRun(cfg: CharacterConfig, parts: readonly PlacedPart[], r: number): FaceRun {
  const { fixture, derivation } = faceFixture(cfg, parts);
  const face = parts.find((p) => p.name === FACE.part);
  if (face === undefined) throw new Error('weight_rule_survey: the sample has no face part');
  const ox = face.x - PAD;
  const oy = face.y - PAD;
  const at = (name: string): [number, number] => {
    const b = cfg.bones.find((e) => 'name' in e && e.name === name);
    if (b === undefined || !('at' in b)) throw new Error(`weight_rule_survey: the sample declares no bone ${name}`);
    return [b.at[0] - ox, b.at[1] - oy];
  };
  const raw = JSON.parse(readFileSync(join(ROOT, 'examples', 'reference-sample', 'config.json'), 'utf8')) as { meshes: Record<string, { segments: unknown[] }> };
  const headSeg = raw.meshes.neck.segments.find((s): s is [string, [number, number], [number, number]] => Array.isArray(s) && s[0] === 'head');
  if (headSeg === undefined) throw new Error('weight_rule_survey: the sample neck mesh declares no head segment');
  const lidOf: Record<string, string> = { lash_l: regionBone(cfg.regions.lash_l), lash_r: regionBone(cfg.regions.lash_r) };
  const lids = FACE.lashes.map((l) => lidOf[l]);
  const segs: Segment[] = [
    { bone: 'head', a: [headSeg[1][0] - ox, headSeg[1][1] - oy], b: [headSeg[2][0] - ox, headSeg[2][1] - oy] },
    ...lids.map((b) => ({ bone: b, a: at(b), b: at(b) })),
  ];
  const order = ['head', ...lids];
  const T = fixture.T[1];
  const band = derivation.band;
  const regionsAt = (bandAt: number): { regions: WeightRegion[]; rows: FaceRun['regions'] } => {
    const regions: WeightRegion[] = [];
    const rows: FaceRun['regions'] = [];
    for (const l of FACE.lashes) {
      const layer = parts.find((p) => p.name === l);
      if (layer === undefined) throw new Error(`weight_rule_survey: the sample has no ${l}`);
      const fr = footprintRegion(face, layer, PAD, lidOf[l], bandAt);
      if ('refused' in fr) rows.push({ layer: l, refused: fr.refused });
      else {
        regions.push(fr.region);
        rows.push({ layer: l, bone: lidOf[l], px: fr.px, islands: fr.islands, points: fr.region.shape === 'polygon' ? fr.region.points.length : 0 });
      }
    }
    return { regions, rows };
  };
  const { width: w, height: h, alpha } = fixture.mask;
  const lashMask = new Uint8Array(w * h);
  for (const l of FACE.lashes) {
    const layer = parts.find((p) => p.name === l) as PlacedPart;
    const m = footprintMask(face, layer);
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.data[y * m.width + x] === 1) lashMask[(y + PAD) * w + x + PAD] = 1;
  }
  const inside: Pt[] = [];
  const outside: Pt[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x] >= 1) (lashMask[y * w + x] === 1 ? inside : outside).push([x + 0.5, y + 0.5]);
  const samples = [...fixture.edge, ...inside, ...outside];
  const sil = newMask(w, h);
  for (let i = 0; i < w * h; i++) sil.data[i] = alpha[i] >= 1 ? 1 : 0;
  const silF = fillHoles(sil);
  const t = performance.now();
  const heat = boneHeat(silF, segs);
  console.error(`weight_rule_survey: face bone heat ${Math.round(performance.now() - t)} ms, iterations ${heat.iterations.join('/')}`);
  const plain = (p: Pt): Vec => influences([p[0], p[1]], segs, r, DEFAULT_LIMITS);
  const overlapsAt = (regions: readonly WeightRegion[]): number => samples.filter((p) => !('influences' in localInfluences([p[0], p[1]], segs, r, regions, DEFAULT_LIMITS))).length;
  const withRegions =
    (regions: readonly WeightRegion[], on: readonly Segment[]) =>
    (p: Pt): Vec => {
      const li = localInfluences([p[0], p[1]], on, r, regions, DEFAULT_LIMITS);
      if (!('influences' in li)) throw new Error(`weight_rule_survey: a sample two regions reach at (${p[0]}, ${p[1]}) — the band search admitted an overlap`);
      return li.influences;
    };
  const heatV = (p: Pt): Vec => heatAt(heat, silF, p);
  // The band: #160's (|T|) first; when the package would refuse the two regions there (a sample both reach —
  // RIG_CONTOUR_REGIONS_OVERLAP in the rig stage), the largest whole-pixel band below it at which no sample is reached by both.
  const tried: Array<{ band: number; overlaps: number }> = [];
  let accepted: { band: number; regions: WeightRegion[]; rows: FaceRun['regions'] } | null = null;
  for (let bnd = band; bnd >= 1 && accepted === null; bnd--) {
    const at = regionsAt(bnd);
    const o = overlapsAt(at.regions);
    tried.push({ band: bnd, overlaps: o });
    if (o === 0) accepted = { band: bnd, ...at };
  }
  const rows: FaceRun['rows'] = [];
  const read = (name: string, vec: (p: Pt) => Vec): void => {
    rows.push({ rule: name, reading: lidReading(vec, lids, order, fixture.field, T, fixture.edge, inside, outside), refused: null });
  };
  const cases: Array<[string, (p: Pt) => Vec]> = [['PLAIN RULE', plain]];
  read(`plain rule (influences, r ${r}, cap 4, floor 0.03)`, plain);
  if (accepted !== null) {
    const v = withRegions(accepted.regions, segs);
    read(`plain rule + one footprint region per lash, band ${accepted.band} px`, v);
    cases.push([`PLAIN + FOOTPRINT, BAND ${accepted.band}`, v]);
    // The same regions with the lid bones left out of the segments: the region alone declares where a lid bone acts.
    const headOnly = withRegions(accepted.regions, segs.filter((sg) => !lids.includes(sg.bone)));
    read(`head segment only + one footprint region per lash, band ${accepted.band} px`, headOnly);
    cases.push([`HEAD ONLY + FOOTPRINT, BAND ${accepted.band}`, headOnly]);
  }
  read('bone heat (tool rule)', heatV);
  cases.push(['BONE HEAT', heatV]);
  const panels: FacePanel[] = cases.map(([title, vec], k) => {
    const share = new Float64Array(w * h).fill(-1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x] >= 1) share[y * w + x] = lids.reduce((s, b) => s + shareIn(vec([x + 0.5, y + 0.5]), b), 0);
    const row = rows[k].reading;
    return { title, width: w, height: h, share, footprint: lashMask, caption: [`LID LINE MAX ${f(row.edgeMax, 2)} P95 ${f(row.edgeP95, 2)} PX`, `FACE MAX ${f(row.artMax, 2)} P95 ${f(row.artP95, 2)} PX`, `T ${T} PX`] };
  });
  return {
    rows,
    regions: (accepted ?? regionsAt(band)).rows,
    tried,
    accepted: accepted === null ? null : accepted.band,
    T,
    band,
    r,
    segs: segs.map((s) => `${s.bone} (${f(s.a[0] + ox, 2)}, ${f(s.a[1] + oy, 2)}) -> (${f(s.b[0] + ox, 2)}, ${f(s.b[1] + oy, 2)})`),
    edge: fixture.edge.length,
    inside: inside.length,
    outside: outside.length,
    heat: { iterations: Math.max(...heat.iterations), converged: heat.converged.every(Boolean), residual: heat.residual, omega: heat.omega },
    panels,
  };
}

/** Parts 1 and 2: the export. The poser comes from rig-c's public `@rig-c/core/render` entry, imported here so the selftest's import of this file does not load the Spine runtime. */
async function exportRun(exportsDir: string, imagesDir: string, r: number): Promise<{ runs: MeshRun[]; ladder: Array<{ r: number; columns: Columns; within: number; p95: number[] }>; selfCheck: { max: number; compared: number; skipped: number }; animations: Array<{ name: string; frames: number }>; strips: Strip[] }> {
  const { loadPosedSkeleton, spinePoser } = await import('@rig-c/core/render');
  const doc = JSON.parse(readFileSync(join(exportsDir, SKELETON), 'utf8')) as SkeletonJson;
  const data = loadPosedSkeleton(join(exportsDir, SKELETON), join(exportsDir, ATLAS), 'weight_rule_survey reads the bones');
  const poser = spinePoser(data);
  const order = doc.bones.map((b) => b.name);
  const length = new Map(doc.bones.map((b) => [b.name, b.length ?? 0]));
  const setup = new Map<string, Xf>(poser.setup(undefined).bones().map((b) => [b.name, b]));
  const meshes = weightedMeshes(doc);
  const rungs = [2, r, 10, 20].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
  type Prepared = { mesh: ExportMesh; segs: Segment[]; setupWorld: Array<[number, number]>; vectors: Array<Record<RuleName, Influence[]>>; ladder: Map<number, Influence[][]>; fit: { residual: number; scale: number }; heat: HeatResult; silPx: number };
  const prepared: Prepared[] = [];
  for (const mesh of meshes) {
    const t = performance.now();
    const setupWorld = mesh.authored.map((v) => skinPoint(v, setup));
    const img = readPng(join(imagesDir, `${mesh.image}.png`));
    if (img.width !== mesh.width || img.height !== mesh.height) throw new Error(`weight_rule_survey: ${mesh.key} — images/${mesh.image}.png is ${img.width}x${img.height}; the mesh states ${mesh.width}x${mesh.height}`);
    const pix: Pt[] = mesh.authored.map((_v, i) => [mesh.uvs[i * 2] * img.width, mesh.uvs[i * 2 + 1] * img.height]);
    const fit = affineFit(setupWorld, pix);
    const segs = mesh.bones.map((b) => boneSegment(b, setup.get(b) as Xf, length.get(b) ?? 0));
    const segsPx: Segment[] = segs.map((s) => ({ bone: s.bone, a: fit.map(s.a), b: fit.map(s.b) }));
    const sil = newMask(img.width, img.height);
    for (let i = 0; i < sil.data.length; i++) sil.data[i] = img.data[i * 4 + 3] >= 1 ? 1 : 0;
    const silF = fillHoles(sil);
    const heat = boneHeat(silF, segsPx);
    const vectors = setupWorld.map((p, i) => ruleVectors(p, segs, r, heat, silF, pix[i]));
    const ladder = new Map(rungs.map((rr) => [rr, setupWorld.map((p) => influences([p[0], p[1]], segs, rr, DEFAULT_LIMITS))]));
    let silPx = 0;
    for (const v of silF.data) silPx += v;
    prepared.push({ mesh, segs, setupWorld, vectors, ladder, fit: { residual: fit.residual, scale: fit.scale }, heat, silPx });
    console.error(`weight_rule_survey: ${mesh.key} ${mesh.authored.length} vertices, heat ${Math.round(performance.now() - t)} ms, iterations ${heat.iterations.join('/')}`);
  }
  // Offsets: each rule's bones, the setup world point in that bone's frame; the authored rows keep the export's own.
  const ruleRows = prepared.map((pp) => {
    const per: Record<string, Array<Array<{ bone: string; weight: number; offset: Pt }>>> = {};
    for (const rule of RULES) per[rule] = pp.vectors.map((v, i) => v[rule].map((e) => ({ bone: e.bone, weight: e.weight, offset: localOffset(setup.get(e.bone) as Xf, pp.setupWorld[i]) })));
    for (const rr of rungs) per[`r${rr}`] = (pp.ladder.get(rr) as Influence[][]).map((v, i) => v.map((e) => ({ bone: e.bone, weight: e.weight, offset: localOffset(setup.get(e.bone) as Xf, pp.setupWorld[i]) })));
    return per;
  });
  const disp = prepared.map(() => new Map<string, number[]>());
  const worst = prepared.map((): MeshRun['worst'] => null);
  const deformed = new Set<string>();
  for (const [an, a] of Object.entries(doc.animations ?? {})) for (const [skin, slots] of Object.entries(a.attachments ?? {})) for (const [slot, atts] of Object.entries(slots)) for (const name of Object.keys(atts)) deformed.add(`${an}|${skin}/${slot}/${name}`);
  let selfMax = 0;
  let compared = 0;
  let skipped = 0;
  const frameCounts: Array<{ name: string; frames: number }> = [];
  for (const anim of poser.animations) {
    const count = Math.round(anim.duration * FPS);
    frameCounts.push({ name: anim.name, frames: count + 1 });
    poser.animation(anim.name, undefined, FPS, count, (i, posed) => {
      const pose = new Map<string, Xf>(posed.bones().map((b) => [b.name, b]));
      const shown = new Map(posed.attachments().map((x) => [`${x.slot}/${x.attachment}`, x.vertices]));
      prepared.forEach((pp, m) => {
        const runtime = shown.get(`${pp.mesh.slot}/${pp.mesh.name}`);
        if (runtime === undefined) return;
        const auth = pp.mesh.authored.map((v) => skinPoint(v, pose));
        if (deformed.has(`${anim.name}|${pp.mesh.key}`)) skipped++;
        else {
          compared++;
          auth.forEach((q, k) => (selfMax = Math.max(selfMax, Math.hypot(q[0] - runtime[k * 2], q[1] - runtime[k * 2 + 1]))));
        }
        for (const [name, rows] of Object.entries(ruleRows[m])) {
          const list = disp[m].get(name) ?? [];
          let frameMax = 0;
          rows.forEach((v, k) => {
            const q = skinPoint(v, pose);
            const d = Math.hypot(q[0] - auth[k][0], q[1] - auth[k][1]);
            list.push(d);
            frameMax = Math.max(frameMax, d);
          });
          disp[m].set(name, list);
          const w = worst[m];
          if (name === 'current' && (w === null || frameMax > w.value)) worst[m] = { animation: anim.name, frame: i, value: frameMax, pose: new Map([...pose].map(([k, v]) => [k, { a: v.a, b: v.b, c: v.c, d: v.d, worldX: v.worldX, worldY: v.worldY }])) };
        }
      });
    });
  }
  const runs: MeshRun[] = prepared.map((pp, m) => {
    const pairs = {} as MeshRun['pairs'];
    const columns = {} as MeshRun['columns'];
    const dd = {} as MeshRun['disp'];
    for (const rule of RULES) {
      pairs[rule] = pp.mesh.authored.map((v, i) => ({ authored: v, rule: pp.vectors[i][rule] }));
      columns[rule] = columnsOf(pairs[rule], order);
      dd[rule] = disp[m].get(rule) ?? [];
    }
    const frames = (disp[m].get('current') ?? []).length / Math.max(1, pp.mesh.authored.length);
    const zeroSource = pp.heat.bones
      .filter((_b, k) => pp.heat.sources[k] === 0)
      .map((bone) => {
        const mine = pp.segs.find((sg) => sg.bone === bone) as Segment;
        let near = '';
        let gap = Infinity;
        for (const o of pp.segs) {
          if (o.bone === bone) continue;
          const g = Math.min(segmentDistance(mine.a, o.a, o.b), segmentDistance(mine.b, o.a, o.b), segmentDistance(o.a, mine.a, mine.b), segmentDistance(o.b, mine.a, mine.b));
          if (g < gap) {
            gap = g;
            near = o.bone;
          }
        }
        return { bone, near, gap };
      });
    return { mesh: pp.mesh, columns, pairs, disp: dd, worst: worst[m], vectors: pp.vectors, setupWorld: pp.setupWorld, fit: pp.fit, heat: pp.heat, silPx: pp.silPx, frames, zeroSource };
  });
  const ladder = rungs.map((rr) => {
    const all = prepared.flatMap((pp) => pp.mesh.authored.map((v, i) => ({ authored: v, rule: (pp.ladder.get(rr) as Influence[][])[i] })));
    const p95 = disp.map((d) => nearestRank(d.get(`r${rr}`) ?? [], 0.95));
    return { r: rr, columns: columnsOf(all, order), within: p95.filter((v) => v <= BOUND).length, p95 };
  });
  // The strips: the three meshes with the largest current-rule 95th percentile, one per slot (ties by key), posed at
  // the current rule's worst frame — authored, current rule, bone heat.
  const ranked = runs.map((run, m) => ({ run, m })).filter(({ run }) => run.worst !== null);
  ranked.sort((x, y) => nearestRank(y.run.disp.current, 0.95) - nearestRank(x.run.disp.current, 0.95) || (x.run.mesh.key < y.run.mesh.key ? -1 : 1));
  const strips: Strip[] = [];
  const slots = new Set<string>();
  for (const { run, m } of ranked) {
    if (slots.has(run.mesh.slot) || strips.length === 3) continue;
    slots.add(run.mesh.slot);
    const w = run.worst as NonNullable<MeshRun['worst']>;
    const authored = run.mesh.authored.map((v) => skinPoint(v, w.pose));
    const panel = (title: string, rule: RuleName | null): StripPanel => {
      const pts = rule === null ? authored : ruleRows[m][rule].map((v) => skinPoint(v, w.pose));
      const vecs: Vec[] = rule === null ? run.mesh.authored : run.vectors.map((v) => v[rule]);
      const d = rule === null ? [] : run.disp[rule];
      const atFrame = pts.map((q, k) => Math.hypot(q[0] - authored[k][0], q[1] - authored[k][1]));
      return {
        title,
        points: pts,
        heaviest: vecs.map((v) => heaviestOf(v, order) ?? ''),
        caption: rule === null ? ['AS PAINTED'] : [`THIS FRAME MAX ${f(Math.max(...atFrame), 2)} PX`, `ALL FRAMES P95 ${f(nearestRank(d, 0.95), 2)} MAX ${f(Math.max(...d), 2)}`],
      };
    };
    strips.push({
      label: `${run.mesh.name}: ${w.animation} frame ${w.frame} at ${FPS} fps`,
      bones: run.mesh.bones,
      triangles: run.mesh.triangles,
      authored,
      panels: [panel('AUTHORED', null), panel(`CURRENT RULE R ${r}`, 'current'), panel('BONE HEAT', 'heat')],
    });
  }
  return { runs, ladder, selfCheck: { max: selfMax, compared, skipped }, animations: frameCounts, strips };
}

/** Every weighted mesh in each `*.json` of the exports directory: the page's "what was read" table. */
function exportCensus(exportsDir: string): Array<{ file: string; sha256: string; bones: number; meshes: number; weighted: number; animations: number }> {
  const out: Array<{ file: string; sha256: string; bones: number; meshes: number; weighted: number; animations: number }> = [];
  for (const file of ['spineboy-ess.json', SKELETON]) {
    const path = join(exportsDir, file);
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path);
    const doc = JSON.parse(bytes.toString('utf8')) as SkeletonJson;
    let meshes = 0;
    for (const s of doc.skins) for (const atts of Object.values(s.attachments)) for (const a of Object.values(atts)) if (a.type === 'mesh') meshes++;
    out.push({ file, sha256: createHash('sha256').update(bytes).digest('hex'), bones: doc.bones.length, meshes, weighted: weightedMeshes(doc).length, animations: Object.keys(doc.animations ?? {}).length });
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const exportsDir = argOf(args, '--exports');
  const imagesDir = argOf(args, '--images');
  const picturePath = argOf(args, '--picture');
  if (exportsDir === null || imagesDir === null) {
    console.error('weight_rule_survey: --exports <dir> and --images <dir> are required (the spineboy export and its images; see the header)');
    process.exit(1);
  }
  const licencePath = join(dirname(resolve(exportsDir)), 'license.txt');
  for (const p of [join(exportsDir, SKELETON), join(exportsDir, ATLAS), licencePath]) {
    if (!existsSync(p)) {
      console.error(`weight_rule_survey: ${basename(p)} is not where the header says (${basename(dirname(p))}/)`);
      process.exit(1);
    }
  }
  const missing = missingInputs(['reference-sample']);
  if (missing.length > 0) {
    console.error('weight_rule_survey: no fetched examples/reference-sample/inputs; run `bun run fetch-examples` first');
    process.exit(1);
  }
  const { r, from } = publicR();
  const census = exportCensus(exportsDir);
  const ex = await exportRun(exportsDir, imagesDir, r);
  const work = mkdtempSync(join(tmpdir(), 'rig-parts-weight-rule-survey-'));
  let face: FaceRun;
  try {
    const asm = assembleExample(work, 'reference-sample');
    const cfg = loadConfig(join(ROOT, 'examples', 'reference-sample', 'config.json'));
    const parts = readParts(join(asm, 'parts.json')).parts.map((p) => ({ name: p.name, x: p.x, y: p.y, img: readPng(join(asm, 'parts', `${p.name}.png`)) }));
    face = faceRun(cfg, parts, r);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const licence = readFileSync(licencePath, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const strips = ex.strips;
  if (picturePath !== null) picture(strips, face.panels).writePng(picturePath);
  console.log(page({ exportsName: basename(resolve(exportsDir)), imagesName: basename(resolve(imagesDir)), census, licence, r, rFrom: from, ex, face, strips }).join('\n'));
}

interface PageInput {
  exportsName: string;
  imagesName: string;
  census: ReturnType<typeof exportCensus>;
  licence: string[];
  r: number;
  rFrom: number[];
  ex: Awaited<ReturnType<typeof exportRun>>;
  face: FaceRun;
  strips: Strip[];
}

/** The rule names as the page prints them. */
export const RULE_TEXT: Record<RuleName, string> = {
  current: 'current rule (`influences`: 1/(d + r)², cap 4, floor 0.03)',
  cap8: 'the same, cap 8',
  heat: 'bone heat (tool rule; every bone, no cap, no floor)',
  heat4: 'bone heat, cap 4 (and floor 0.03, as `influences` applies them)',
};

/** The ranking as the rows state it: which rule has the lowest pooled L1, per mesh where bone heat beats the current rule, and the meshes no rule brings within the bound. */
export function ranking(runs: readonly MeshRun[], overall: Record<RuleName, Columns>): { heatCloser: boolean; heatWins: string[]; heatLoses: string[]; unreached: string[]; reached: Array<{ mesh: string; rules: RuleName[] }> } {
  const heatCloser = overall.heat.l1 < overall.current.l1 && overall.heat.l1 < overall.cap8.l1;
  const heatWins = runs.filter((r) => r.columns.heat.l1 < r.columns.current.l1).map((r) => r.mesh.name);
  const heatLoses = runs.filter((r) => r.columns.heat.l1 >= r.columns.current.l1).map((r) => r.mesh.name);
  const reached = runs.map((r) => ({ mesh: r.mesh.name, rules: RULES.filter((q) => nearestRank(r.disp[q], 0.95) <= BOUND) }));
  return { heatCloser, heatWins, heatLoses, unreached: reached.filter((x) => x.rules.length === 0).map((x) => x.mesh), reached: reached.filter((x) => x.rules.length > 0) };
}

/** The page, from the rows alone: no time, no path, no machine. */
export function page(p: PageInput): string[] {
  const { ex, face } = p;
  const runs = ex.runs;
  const order = runs.length === 0 ? [] : [...new Set(runs.flatMap((r) => r.mesh.bones))];
  const overall = {} as Record<RuleName, Columns>;
  for (const rule of RULES) overall[rule] = columnsOf(runs.flatMap((r) => r.pairs[rule]), order);
  const within = (rule: RuleName): number => runs.filter((r) => nearestRank(r.disp[rule], 0.95) <= BOUND).length;
  const rk = ranking(runs, overall);
  const frames = ex.animations.reduce((n, a) => n + a.frames, 0);
  const out: string[] = [];
  out.push('# Weight rules against hand-painted weights (issue #161, Stage A)', '');
  out.push(
    `Generated by \`bun tools/weight_rule_survey.ts\`; every figure below is the tool's, none typed. The installed rig-c ${installedRigc()}. The picture, read first: [weight-rules.png](weight-rules.png) — wires and weights on a blank plate (no image of the export is drawn): the three spineboy meshes with the largest gap, each posed at its worst frame under the current rule, authored / current rule / bone heat (grey: the authored mesh under each rule's; red: each vertex's displacement; dots: each vertex's heaviest bone), and the sample face's lid share per rule (grey 0, red 1; the lash footprints in ink).`,
    '',
  );
  out.push('## What was read', '');
  out.push(
    `Esoteric Software's spineboy example, read from a directory named \`${p.exportsName}\` (and its images from \`${p.imagesName}\`) outside this repository; nothing from it is copied into this tree. The project's licence, as its \`license.txt\` states it: ${p.licence.map((l) => `"${l}"`).join(' ')} The picture therefore draws no image of it.`,
    '',
    '| File | sha256 | Bones | Meshes | Weighted meshes | Animations |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...p.census.map((c) => `| \`${c.file}\` | \`${c.sha256}\` | ${c.bones} | ${c.meshes} | ${c.weighted} | ${c.animations} |`),
    '',
    `Every weighted mesh of \`${SKELETON}\` is measured. The other exports beside it in rig-c's checkout are rigs agents authored for rig-c's benchmark, not a rigger's painted weights, and are not read.`,
    '',
  );
  out.push('## The rules', '');
  out.push(
    `On the authored vertices, at the export's setup pose, with the mesh's own bound bones (every bone any of its vertices names) as the candidates, in skeleton order. A bone's segment is its setup origin to origin + length along its world x axis (a bone of length 0 is its point — a segment the package's loader would refuse as \`RIG_SEGMENT_DEFINED\`, kept here because the export declares it so). Distances are in the export's world units, which are the images' pixels (the affine fit from setup world to image pixels below has scale 1 to four places on every mesh).`,
    '',
    `- **r = ${p.r}**: \`r\` is a required per-mesh field with no package default (src/config.ts), so the package has no value of its own; ${p.r} is the median of the ${p.rFrom.length} values the three public examples declare (${p.rFrom.join(', ')}). The ladder at the end shows the current rule at other values.`,
    ...RULES.map((q) => `- **${q}** — ${RULE_TEXT[q]}.`),
    `- **Bone heat, as computed here** (this tool's rule, not the package's): the discretisation is the image grid at the export's scale — one unknown per pixel of the image's silhouette (alpha >= 1, holes filled), 4-neighbour Laplacian, no flux through the silhouette's edge; each bone's sources are the pixels whose centre lies within ${HEAT.band} px of its segment (mapped into the image by the fit), a component no such pixel reaches taking its nearest pixel no bone holds; a pixel two bones claim goes to the nearer. Per bone, 1 on its sources and 0 on the others'; successive over-relaxation (Gauss-Seidel, ω = 2/(1 + sin(π/L)), L the image's longer side) in raster order from 0, to a largest per-sweep change under ${HEAT.tolerance} or ${HEAT.maxIterations} sweeps. A vertex takes the fields at the silhouette pixel nearest its UV position, normalised.`,
    '',
    'Columns: mean L1 between the rule\'s vector and the authored vector (0-2); the share of vertices whose heaviest bone is the authored heaviest (a tie goes to the bone first in skeleton order); the mean weight the rule puts on the authored heaviest bone; and the authored heaviest weight itself, for reference. Weights are the rule\'s unrounded output (the rig stage rounds to five places).',
    '',
  );
  out.push('## Overall — every weighted mesh pooled, each vertex once', '');
  out.push(
    `${runs.length} meshes, ${overall.current.vertices} vertices. Displacement: ${frames} frames over ${ex.animations.length} animations (below).`,
    '',
    '| Rule | Mean L1 to the authored vector (0-2) | Same heaviest bone | Weight on the authored heaviest bone | Authored heaviest | Meshes within 2 px (p95) |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...RULES.map((q) => `| ${q} | ${f(overall[q].l1)} | ${pct(overall[q].same)} | ${f(overall[q].onAuthored)} | ${f(overall[q].authoredHeaviest)} | ${within(q)} of ${runs.length} |`),
    '',
  );
  out.push('## Per mesh — weights', '');
  out.push(
    '| Mesh | Vertices | Bound bones | Rule | L1 | Same heaviest | On authored heaviest | Authored heaviest |',
    '| --- | ---: | --- | --- | ---: | ---: | ---: | ---: |',
  );
  for (const run of runs) for (const q of RULES) out.push(`| ${run.mesh.name} | ${run.mesh.authored.length} | ${run.mesh.bones.join(', ')} | ${q} | ${f(run.columns[q].l1)} | ${pct(run.columns[q].same)} | ${f(run.columns[q].onAuthored)} | ${f(run.columns[q].authoredHeaviest)} |`);
  out.push('');
  out.push('## Per mesh — posed displacement against the authored weights', '');
  out.push(
    `Both meshes are skinned (linear blend, Spine's weighted vertex) from the same bone world transforms, which rig-c's public \`@rig-c/core/render\` entry poses through spine-core (\`spinePoser\`: \`AnimationState\`, one \`update(1/fps)\` per frame from the setup pose) at ${FPS} fps — the rate of rig-c's reference frames for this skeleton — frames 0..round(duration × ${FPS}) of each animation, which is the reference's own frame count for every one of the eleven. A rule's vertex keeps the authored mesh's setup position: its offset in each of its bones' frames is that position read in the bone's setup frame, so the two meshes coincide at the setup pose and differ only by how the weights share the motion. A mesh is measured only in the frames where its slot shows it. Displacement is the distance between the two meshes' same vertex, px of the export's scale; p95 is the nearest-rank 95th percentile over every vertex of every frame shown, and "within 2 px" is p95 <= ${BOUND}.`,
    '',
    `The skinning is checked against the runtime: the authored mesh as skinned here against spine-core's own world vertices for it, in every frame no deform timeline keys that attachment — ${ex.selfCheck.compared} mesh-frames, largest difference ${ex.selfCheck.max.toExponential(2)} px; ${ex.selfCheck.skipped} mesh-frames carry a deform timeline (the feet, in \`hoverboard\`), which neither side applies here.`,
    '',
    '| Mesh | Frames shown | current p95 / max | cap8 p95 / max | heat p95 / max | heat4 p95 / max | Rules within 2 px |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
  );
  for (const run of runs) {
    const cell = (q: RuleName): string => `${f(nearestRank(run.disp[q], 0.95), 2)} / ${f(Math.max(0, ...run.disp[q]), 2)}`;
    const ok = RULES.filter((q) => nearestRank(run.disp[q], 0.95) <= BOUND);
    out.push(`| ${run.mesh.name} | ${run.frames} | ${cell('current')} | ${cell('cap8')} | ${cell('heat')} | ${cell('heat4')} | ${ok.length === 0 ? 'none' : ok.join(', ')} |`);
  }
  out.push('', '| Animation | Frames |', '| --- | ---: |', ...ex.animations.map((a) => `| ${a.name} | ${a.frames} |`), '');
  out.push('## The ranking', '');
  out.push(
    `- **Pooled L1:** bone heat ${f(overall.heat.l1)} against the current rule ${f(overall.current.l1)} and cap 8 ${f(overall.cap8.l1)} — bone heat is ${rk.heatCloser ? '' : '**not** '}the closest rule on this export.`,
    `- **Per mesh:** bone heat's L1 is below the current rule's on ${rk.heatWins.length} of ${runs.length} (${rk.heatWins.join(', ') || 'none'}) and not below it on ${rk.heatLoses.length} (${rk.heatLoses.join(', ') || 'none'}).`,
    `- **Within the bound:** ${rk.reached.length === 0 ? 'no mesh is within 2 px under any rule' : rk.reached.map((x) => `${x.mesh} (${x.rules.join(', ')})`).join('; ')}. **No rule reaches:** ${rk.unreached.join(', ') || 'none'}.`,
    `- **Sharper than any rule:** the authored heaviest weight averages ${f(overall.current.authoredHeaviest)}; the rules put ${RULES.map((q) => `${f(overall[q].onAuthored)} (${q})`).join(', ')} on that bone.`,
    '',
  );
  out.push('## The current rule at other r', '');
  out.push(
    `The same columns for the current rule (cap 4, floor 0.03) at r = ${ex.ladder.map((l) => l.r).join(', ')}, every weighted mesh pooled; "within 2 px" counts meshes whose posed p95 is at most ${BOUND}.`,
    '',
    '| r | Mean L1 | Same heaviest | On authored heaviest | Meshes within 2 px | Smallest mesh p95 px |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
    ...ex.ladder.map((l) => `| ${l.r} | ${f(l.columns.l1)} | ${pct(l.columns.same)} | ${f(l.columns.onAuthored)} | ${l.within} of ${runs.length} | ${f(Math.min(...l.p95), 2)} |`),
    '',
  );
  out.push('## Bone heat, as solved', '');
  out.push(
    '| Mesh | Silhouette px | Fit residual px | Fit scale | Sweeps per bone | Converged | Source px per bone | Bones sourced at a nearest pixel in some component |',
    '| --- | ---: | ---: | ---: | --- | --- | --- | --- |',
    ...runs.map((r) => `| ${r.mesh.name} | ${r.silPx} | ${f(r.fit.residual, 4)} | ${f(r.fit.scale, 4)} | ${r.heat.iterations.join(' / ')} | ${r.heat.converged.every(Boolean) ? 'all' : 'NOT ALL'} | ${r.heat.bones.map((b, k) => `${b} ${r.heat.sources[k]}`).join(', ')} | ${r.heat.nearest.join(', ') || '—'} |`),
    '',
    `Residual after the solve (largest |x − mean of neighbours| over every free pixel and bone): ${runs.map((r) => `${r.mesh.name} ${r.heat.residual.toExponential(1)}`).join(', ')}. A bone with 0 source pixels has none left after the claims — every pixel within the band of it is nearer another bone's segment — and its heat is 0 everywhere on that mesh: ${runs.flatMap((r) => r.zeroSource.map((z) => `${r.mesh.name}: ${z.bone}, whose segment comes within ${f(z.gap, 3)} px of ${z.near}'s at setup`)).join('; ') || 'none'}.`,
    '',
  );
  out.push('## The footprint region on the public sample (issue #160\'s face)', '');
  out.push(
    `The sample's \`face\`, padded as the rig stage pads it, with #160's lid motion and measure (tools/feature_contour_survey.ts \`faceFixture\`): the lids translate straight down by T = ${face.T} px (the taller eyewhite footprint's box height) with the head still, and a point p moves by w(p)·T, so its displacement against #160's lid field — 1 on the two lash footprints, falling linearly to 0 at ${face.band} px from them — is |w(p) − field(p)|·|T|, w the lid bones' summed share. Read over the lash outlines (${face.edge} samples every 0.25 px: the lid line) and over every art pixel centre (${face.inside} on the lash footprints, ${face.outside} off them). Each rule is evaluated at the point itself — the limit of a fine mesh; no mesh is built.`,
    '',
    `Candidates: ${face.segs.join('; ')} (rig px): the head segment the example declares on its \`neck\` mesh, and the lash layers' bones (\`regions\`: lash_l → eye_l, lash_r → eye_r) as their points — the sample is a region attachment there and declares no segment for them. r = ${face.r}. The footprint regions: per lash, a polygon region on that lash's eye bone whose polygon is the lash's footprint on the face (pixels at alpha >= 8 on the face's filled silhouette, holes and pinches filled, traced at pixel corners; the largest island): ${face.regions.map((x) => ('refused' in x ? `${x.layer} refused — ${x.refused}` : `${x.layer} → ${x.bone}, ${x.px} px, ${x.islands} island(s), ${x.points} polygon points`)).join('; ')}.`,
    '',
    `The band: #160's ${face.band} px first. ${face.tried.map((t) => `${t.band} px: ${t.overlaps} sample(s) both regions reach`).join('; ')}${face.accepted === null ? ' — no band below it is accepted' : ` — so at ${face.band} px the rig stage would refuse the pair by name (\`RIG_CONTOUR_REGIONS_OVERLAP\`), and the rows below use ${face.accepted} px, the largest whole-pixel band no sample is reached by both at`}.`,
    '',
    '| Rule | Lid line max px | Lid line p95 px | Face max px | Face p95 px | Heaviest bone a lid, on the footprint | Heaviest bone a lid, off it |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...face.rows.map((x) => `| ${x.rule} | ${f(x.reading.edgeMax, 2)} | ${f(x.reading.edgeP95, 2)} | ${f(x.reading.artMax, 2)} | ${f(x.reading.artP95, 2)} | ${pct(x.reading.insideLid)} | ${pct(x.reading.outsideLid)} |`),
    '',
    `Bone heat on the face: the largest sweep count ${face.heat.iterations}, ${face.heat.converged ? 'every bone converged' : 'NOT every bone converged'}, residual ${face.heat.residual.toExponential(1)}, ω ${f(face.heat.omega, 4)}. The lid line is the footprint's own outline, so a footprint region holds it at the lid's full share by construction; what the rows add is what each rule does to the rest of the face under the same motion.`,
    '',
  );
  out.push('## Not measured', '');
  out.push(
    '- The geodesic rule the card lists: not implemented here.',
    '- Deform timelines (the feet in `hoverboard`): applied by neither side; the displacement is the bones\' alone.',
    `- Other exports: \`spineboy-ess.json\` has no mesh; rig-c's other example exports are agent-authored and not hand-painted.`,
    '- The sample\'s own blink (a squash of the eye bones) is not the motion read here; #160\'s translation is, so the two surveys measure the same thing.',
    '',
  );
  out.push('## Re-running this evidence', '');
  out.push(
    `The spineboy export and images from rig-c's checkout (\`examples/spineboy/{export,images}\`, the licence beside them); the public sample at commit ${pinnedInputs()} (\`bun run fetch-examples\`); rig-c ${installedRigc()} as \`bun install --frozen-lockfile\` installs it. Nothing is written but standard output and the picture (the sample is assembled in a temporary directory, removed afterwards).`,
    '',
    '```sh',
    'bun install --frozen-lockfile',
    'bun run fetch-examples',
    'bun tools/weight_rule_survey.ts --exports <rigc>/examples/spineboy/export --images <rigc>/examples/spineboy/images --picture docs/evidence/weight-rules.png > docs/evidence/weight-rules.md',
    '```',
  );
  return out;
}

if (import.meta.main) await main();
