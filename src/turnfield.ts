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
