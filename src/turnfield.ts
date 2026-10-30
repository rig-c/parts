/** Sampling an existing emitted triangle field is not resampling its source sheet. */
import { PartsError } from './errors.ts';

export interface TurnTriangleField {
  label: string;
  points: ReadonlyArray<readonly number[]>;
  triangles: readonly number[];
  vectors: ReadonlyArray<readonly number[]>;
}

/** Lowest triangle index on a shared edge; no epsilon or extrapolation. */
export function turnTriangleCoordinates(points: ReadonlyArray<readonly number[]>, triangles: readonly number[], x: number, y: number): { ids: number[]; weights: number[] } | null {
  for (let i = 0; i < triangles.length; i += 3) {
    const ids = triangles.slice(i, i + 3), [a, b, c] = ids.map(j => points[j]);
    if (a === undefined || b === undefined || c === undefined) continue;
    const cross = (p: readonly number[], q: readonly number[]) => (p[0] - x) * (q[1] - y) - (p[1] - y) * (q[0] - x);
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (area === 0) continue;
    const weights = [cross(b, c) / area, cross(c, a) / area, cross(a, b) / area];
    if (weights.every(w => w >= 0)) return { ids, weights };
  }
  return null;
}

/** A requested setup-grid cell and its exact caller-computed world point. */
export interface TurnTriangleQuery { x: number; y: number; point: readonly number[] }

/**
 * Rasterise only requested cells, in triangle order. Sparse sorted sample rows
 * bound the storage to the query set, not a world/canvas rectangle. One adjacent
 * row/cell is conservatively visited at each bbox edge; this is a broad phase,
 * never an epsilon in the barycentric test. The original arithmetic below is
 * the sole acceptance rule, including zero-area skips and first-triangle ties.
 */
export function rasterTurnTriangleOwnership(points: ReadonlyArray<readonly number[]>, triangles: readonly number[], queries: readonly TurnTriangleQuery[]) {
  const key = (x: number, y: number) => `${x},${y}`;
  const unique = new Map(queries.map(q => [key(q.x, q.y), q]));
  const byY = new Map<number, TurnTriangleQuery[]>();
  for (const q of unique.values()) {
    const row = byY.get(q.point[1]);
    if (row === undefined) byY.set(q.point[1], [q]); else row.push(q);
  }
  const rows = [...byY].sort((a, b) => a[0] - b[0]).map(([y, cells]) => ({ y, cells: cells.sort((a, b) => a.point[0] - b.point[0]) }));
  const bound = <T>(values: readonly T[], value: number, coordinate: (v: T) => number, upper: boolean): number => {
    let lo = 0, hi = values.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1, n = coordinate(values[mid]); if (n < value || (upper && n === value)) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const owners = new Map<string, { ids: number[]; weights: number[] }>();
  for (let i = 0; i < triangles.length; i += 3) {
    const ids = triangles.slice(i, i + 3), [a, b, c] = ids.map(j => points[j]);
    if (a === undefined || b === undefined || c === undefined) continue;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (area === 0) continue;
    const minX = Math.min(a[0], b[0], c[0]), maxX = Math.max(a[0], b[0], c[0]);
    const minY = Math.min(a[1], b[1], c[1]), maxY = Math.max(a[1], b[1], c[1]);
    const fromY = Math.max(0, bound(rows, minY, r => r.y, false) - 1), toY = Math.min(rows.length, bound(rows, maxY, r => r.y, true) + 1);
    for (let yi = fromY; yi < toY; yi++) {
      const row = rows[yi].cells;
      const fromX = Math.max(0, bound(row, minX, q => q.point[0], false) - 1), toX = Math.min(row.length, bound(row, maxX, q => q.point[0], true) + 1);
      for (let xi = fromX; xi < toX; xi++) {
        const q = row[xi], k = key(q.x, q.y);
        if (owners.has(k)) continue;
        const [x, y] = q.point;
        const cross = (p: readonly number[], r: readonly number[]) => (p[0] - x) * (r[1] - y) - (p[1] - y) * (r[0] - x);
        const weights = [cross(b, c) / area, cross(c, a) / area, cross(a, b) / area];
        if (weights.every(w => w >= 0)) owners.set(k, { ids, weights });
      }
    }
  }
  return { at: (x: number, y: number) => owners.get(key(x, y)) ?? null };
}

/** Named refusal outside support; never fall back to target depth or nearest geometry. */
export function sampleTurnTriangleField(field: TurnTriangleField, point: readonly number[], object: string): [number, number] {
  const fail = (detail: string): never => { throw new PartsError([{ code: 'RIG_TURN_SURFACE_OVERLAP_SUPPORT', object, detail: `neighbour "${field.label}" ${detail}` }]); };
  if (point.length !== 2 || !point.every(Number.isFinite) || field.points.length !== field.vectors.length
    || field.points.some(p => p.length !== 2 || !p.every(Number.isFinite)) || field.vectors.some(v => v.length !== 2 || !v.every(Number.isFinite))
    || field.triangles.length === 0 || field.triangles.length % 3 !== 0 || field.triangles.some(i => !Number.isSafeInteger(i) || i < 0 || i >= field.points.length)) return fail('requires finite setup points, one emitted vector per point and existing triangle indices; supply the actual attachment field');
  const hit = turnTriangleCoordinates(field.points, field.triangles, point[0], point[1]);
  if (hit === null) return fail(`has no triangle covering setup (${point[0]}, ${point[1]}); provide actual covering support; no extrapolation or target-field fallback is permitted`);
  const [a, b, c] = hit.ids.map(i => field.vectors[i]), [u, v] = hit.weights;
  // Translation-invariant form: constant fields remain exactly constant.
  return [c[0] + u * (a[0] - c[0]) + v * (b[0] - c[0]), c[1] + u * (a[1] - c[1]) + v * (b[1] - c[1])];
}
