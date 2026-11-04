/** Report-only visible-back residual candidates after edge composition (#999). */
import { EDGE_OWNER_ALPHA } from './paintingedges.ts';
import { type Raster, RasterError } from './raster/types.ts';

export const EDGE_PAIR_RESIDUAL = 'EDGE_PAIR_RESIDUAL';
export const EDGE_RESIDUAL_FILE = 'edge_residuals.json';
export interface ResidualPart {
  name: string;
  x: number;
  y: number;
  image: Raster;
}
export interface ResidualPair {
  front: string;
  back: string;
  status: 'measured' | 'skip' | 'unavailable';
  residual_px: number | null;
  /** Rig pixels, [left, top, width, height]. */
  box: [number, number, number, number] | null;
  /** Coordinates reference the existing back part PNG at its parts.json placement.
   * Spans are [y, left, right-exclusive], sorted by y then left. */
  back_pixels: { count: number; spans: Array<[number, number, number]> };
  skipped: string[];
  unavailable: string[];
  unavailable_px: number;
}
export interface EdgeResidualReport {
  spec: 'rig-parts-edge-residuals/1';
  observation: 'visible-back RGB-error components touching one overlapping front boundary; candidates, painting ownership unproven';
  stage: 'final assembled parts after paintingEdges and seam correction';
  grid: [number, number];
  rgb_tolerance: number;
  owner_alpha_above: number;
  connectivity: 8;
  pairs: ResidualPair[];
  summary: { pairs: number; measured: number; skipped: number; unavailable: number; residual_px: number; unassigned_error_px: number };
}

function offset(part: ResidualPart, x: number, y: number): number | null {
  const lx = x - part.x, ly = y - part.y;
  if (lx < 0 || ly < 0 || lx >= part.image.width || ly >= part.image.height) return null;
  return (ly * part.image.width + lx) * 4;
}
function alpha(part: ResidualPart, x: number, y: number): number {
  const at = offset(part, x, y);
  return at === null ? 0 : part.image.data[at + 3];
}
function overlap(a: ResidualPart, b: ResidualPart): boolean {
  const right = Math.min(a.x + a.image.width, b.x + b.image.width);
  const bottom = Math.min(a.y + a.image.height, b.y + b.image.height);
  for (let y = Math.max(a.y, b.y); y < bottom; y++) {
    for (let x = Math.max(a.x, b.x); x < right; x++) {
      if (alpha(a, x, y) > EDGE_OWNER_ALPHA && alpha(b, x, y) > EDGE_OWNER_ALPHA) return true;
    }
  }
  return false;
}
function spans(pixels: number[], width: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const p of pixels.sort((a, b) => a - b)) {
    const x = p % width, y = Math.floor(p / width), previous = out.at(-1);
    if (previous !== undefined && previous[0] === y && previous[2] === x) previous[2]++;
    else out.push([y, x, x + 1]);
  }
  return out;
}

/** Read existing limits, never set a new bar or a reach cap. Components are
 * observations of residual colour error. Semantic painting ownership cannot
 * be established from colour and draw order and is explicitly unproven. */
export function edgePairResiduals(parts: readonly ResidualPart[], painting: Raster, composite: Raster, tolerance: number): EdgeResidualReport {
  const W = painting.width, H = painting.height, size = W * H;
  if (composite.width !== W || composite.height !== H) throw new RasterError('edgePairResiduals: composite and painting require the same native rig grid');
  const n = parts.length;
  const owner = new Int32Array(size).fill(-1);
  const pure = new Uint8Array(size);
  const visible = new Uint32Array(n);
  const errors = new Uint8Array(size);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      for (let i = n - 1; i >= 0; i--) {
        if (alpha(parts[i], x, y) > EDGE_OWNER_ALPHA) { owner[p] = i; visible[i]++; break; }
      }
      const back = owner[p];
      if (back >= 0) {
        let opaque = alpha(parts[back], x, y) === 255;
        for (let i = back + 1; i < n && opaque; i++) if (alpha(parts[i], x, y) > 0) opaque = false;
        pure[p] = opaque ? 1 : 0;
      }
      let delta = 0;
      for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(composite.data[p * 4 + c] - painting.data[p * 4 + c]));
      errors[p] = delta > tolerance ? 1 : 0;
    }
  }
  const neighbours = (p: number, visit: (q: number) => void): void => {
    const x = p % W, y = Math.floor(p / W);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx === 0 && dy === 0) || x + dx < 0 || x + dx >= W || y + dy < 0 || y + dy >= H) continue;
        visit((y + dy) * W + x + dx);
      }
    }
  };
  const adjacency = new Uint8Array(n * n);
  for (let p = 0; p < size; p++) {
    if (owner[p] < 0) continue;
    neighbours(p, q => {
      if (owner[q] > owner[p]) adjacency[owner[q] * n + owner[p]] = 1;
    });
  }
  const rows = new Map<number, ResidualPair>();
  const selected = new Map<number, number[]>();
  for (let front = 1; front < n; front++) {
    for (let back = 0; back < front; back++) {
      const row: ResidualPair = { front: parts[front].name, back: parts[back].name, status: 'measured', residual_px: 0, box: null, back_pixels: { count: 0, spans: [] }, skipped: [], unavailable: [], unavailable_px: 0 };
      if (!overlap(parts[front], parts[back])) { row.status = 'skip'; row.skipped.push('no alpha overlap above the existing owner floor'); }
      else if (visible[front] === 0 || visible[back] === 0) {
        row.status = 'unavailable';
        row.unavailable.push(visible[front] === 0 ? 'front has no visible boundary observation' : 'back has no visible pixel observation');
        row.residual_px = null;
      } else if (adjacency[front * n + back] === 0) { row.status = 'skip'; row.skipped.push('no exposed front/back boundary'); }
      rows.set(front * n + back, row);
    }
  }
  const visited = new Uint8Array(size);
  let unassigned = 0;
  for (let start = 0; start < size; start++) {
    if (errors[start] === 0 || visited[start] === 1) continue;
    const back = owner[start];
    if (back < 0) { visited[start] = 1; unassigned++; continue; }
    const queue = [start], fronts = new Set<number>();
    let mixed = false;
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const p = queue[cursor];
      if (pure[p] === 0) mixed = true;
      neighbours(p, q => {
        const front = owner[q];
        if (front > back && rows.get(front * n + back)?.status === 'measured') fronts.add(front);
        if (errors[q] === 1 && owner[q] === back && visited[q] === 0) { visited[q] = 1; queue.push(q); }
      });
    }
    if (fronts.size !== 1 || mixed) {
      unassigned += queue.length;
      for (const front of fronts) {
        const row = rows.get(front * n + back)!;
        row.unavailable_px += queue.length;
        const reason = mixed ? 'residual component includes partial-alpha or additional foreground contribution' : 'residual component touches multiple overlapping fronts';
        if (!row.unavailable.includes(reason)) row.unavailable.push(reason);
      }
      continue;
    }
    const front = [...fronts][0], key = front * n + back;
    const pixels = selected.get(key) ?? [];
    for (const pixel of queue) pixels.push(pixel);
    selected.set(key, pixels);
  }
  for (const [key, row] of rows) {
    const pixels = selected.get(key) ?? [];
    row.back_pixels = { count: pixels.length, spans: spans(pixels, W) };
    if (pixels.length > 0) {
      let left = W, top = H, right = 0, bottom = 0;
      for (const p of pixels) { const x = p % W, y = Math.floor(p / W); left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1); }
      row.box = [left, top, right - left, bottom - top];
    }
    if (row.unavailable.length > 0) {
      row.status = 'unavailable';
      row.residual_px = null;
      // Retained candidates still count when this pair's attribution is unavailable.
      unassigned += pixels.length;
    }
    else if (row.status === 'measured') row.residual_px = pixels.length;
  }
  const pairs = [...rows.values()];
  return {
    spec: 'rig-parts-edge-residuals/1',
    observation: 'visible-back RGB-error components touching one overlapping front boundary; candidates, painting ownership unproven',
    stage: 'final assembled parts after paintingEdges and seam correction',
    grid: [W, H], rgb_tolerance: tolerance, owner_alpha_above: EDGE_OWNER_ALPHA, connectivity: 8, pairs,
    summary: { pairs: pairs.length, measured: pairs.filter(p => p.status === 'measured').length, skipped: pairs.filter(p => p.status === 'skip').length, unavailable: pairs.filter(p => p.status === 'unavailable').length, residual_px: pairs.reduce((sum, p) => sum + (p.residual_px ?? 0), 0), unassigned_error_px: unassigned },
  };
}

export function edgeResidualLines(report: EdgeResidualReport): string[] {
  const s = report.summary;
  return [
    `${EDGE_PAIR_RESIDUAL}: ${s.measured} of ${s.pairs} pairs measured, ${s.skipped} skipped, ${s.unavailable} unavailable; ${s.residual_px} candidate px, ${s.unassigned_error_px} unassigned error px; painting ownership unproven; report only`,
    ...report.pairs.map(p => `${EDGE_PAIR_RESIDUAL}: front "${p.front}", back "${p.back}" ${p.status}; residual px ${p.residual_px ?? 'unavailable'}, box ${p.box === null ? 'none' : `[${p.box.join(', ')}]`}, back pixels ${p.back_pixels.count}${p.skipped.length === 0 ? '' : `; skipped ${p.skipped.join(', ')}`}${p.unavailable.length === 0 ? '' : `; unavailable ${p.unavailable.join(', ')}`}`),
  ];
}
