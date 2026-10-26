/** Neutral material coverage constraints, derived from explicit ordered owners. */
import { DEPTH_EYE_CHECK_LABEL, depthRefuse, insideDepthTriangle, type DepthPilot } from './depthinput.ts';
import { depthUV, depthRational as Q, type DepthExactUV, type DepthFraction, type DepthUV } from './depthmesh.ts';
import type { DeformMeshAttachment } from './turn.ts';
import type { Raster } from './raster/types.ts';

export interface CoverageSurface { mesh: DeformMeshAttachment; points: DepthUV[]; z: number[]; image: Raster; }
interface Vertex { uv: DepthUV; xy: DepthUV; cu?: DepthUV; quv: DepthExactUV; qxy: DepthExactUV; qcu?: DepthExactUV; }
interface CarriedCell { polygon: Vertex[]; triangle: number[]; pilotFallback?: boolean; }
export interface CoverageFallback { cellID: string; subject: string; coverer: string; seedTriangle: number; covererTriangle: number; vertices: number; sourceArea: number; uvArea: number; sourceTexelArea: number; field: 'FINAL coverer field; no independent subject relief'; }
export interface CoverageConstraints { fallbacks: CoverageFallback[]; cells: DepthUV[][]; exact: ReadonlyMap<DepthUV, DepthExactUV>; protectedTexels: number; carriedCells: number; ownerAt: (uv: DepthUV) => { ids: number[]; w: number[] } | null; protectedAt: (uv: DepthUV) => boolean; value: (uv: DepthUV) => number | null; }
export function depthAlpha(image: Raster, uv: DepthUV): number {
  const x = uv[0] * image.width - 0.5, y = uv[1] * image.height - 0.5, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  let alpha = 0;
  for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const px = Math.max(0, Math.min(image.width - 1, ix + dx)), py = Math.max(0, Math.min(image.height - 1, iy + dy)); alpha += image.data[(py * image.width + px) * 4 + 3] / 255 * w;
  }
  return alpha;
}
const area = (p: Vertex[]): number => Q.number(p.slice(1, -1).reduce((s, a, i) => Q.add(s, Q.cross(p[0].qxy, a.qxy, p[i + 2].qxy)), Q.from(0)));
function exactInterpolate(p: Vertex, q: Vertex, t: DepthFraction): Vertex {
  const quv = Q.lerp(p.quv, q.quv, t), qxy = Q.lerp(p.qxy, q.qxy, t), qcu = p.qcu && q.qcu ? Q.lerp(p.qcu, q.qcu, t) : undefined;
  return { quv, qxy, uv: quv.map(Q.number) as DepthUV, xy: qxy.map(Q.number) as DepthUV, ...(qcu ? { qcu, cu: qcu.map(Q.number) as DepthUV } : {}) };
}
function split(polygon: Vertex[], qa: DepthExactUV, qb: DepthExactUV, sign: number): [Vertex[], Vertex[]] {
  const polarity = Q.from(sign), sides = polygon.map(p => Q.mul(polarity, Q.cross(qa, qb, p.qxy)));
  const keep: Vertex[] = [], outside: Vertex[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length], dp = sides[i], dq = sides[(i + 1) % polygon.length];
    if (dp.n >= 0n) keep.push(p); if (dp.n <= 0n) outside.push(p);
    if (dp.n * dq.n < 0n) { const v = exactInterpolate(p, q, Q.div(dp, Q.sub(dp, dq))); keep.push(v); outside.push(v); }
  }
  return [keep, outside];
}
function insidePolygon(uv: DepthUV, polygon: Vertex[]): boolean {
  const coords = polygon.flatMap(p => p.uv);
  for (let i = 1; i + 1 < polygon.length; i++) if (insideDepthTriangle(...uv, coords, [0, i, i + 1], 1, 1)) return true;
  return false;
}
export function coverageConstraints(subject: CoverageSurface, coverer: CoverageSurface, alphaMin: number, wholeHost = false, pilot?: DepthPilot): CoverageConstraints {
  if (pilot && (pilot.mode !== 'mixed-alpha-final-coverer' || pilot.label !== DEPTH_EYE_CHECK_LABEL)) depthRefuse('RIG_DEPTH_PILOT', subject.mesh.image, 'explicit exact pilot mode and label required');
  if (alphaMin <= 127.5) depthRefuse('RIG_DEPTH_COVERAGE', subject.mesh.image, 'certified protected/visible plateaus require alphaMin above half opacity');
  const fallbacks: CoverageFallback[] = [], carried: CarriedCell[] = [], cells: Vertex[][] = [], coverXY = coverer.points.flat(); const protectedSeen = new Set<number>();
  // Coverage points are invariant during this call; bounded by the supplied
  // vertex roster and released with this invocation, never a global GCD cache.
  const exactCoverPoints = new Map<number, DepthExactUV>();
  const coverPoint = (id: number): DepthExactUV => { let p = exactCoverPoints.get(id); if (!p) { p = Q.point(coverer.points[id]); exactCoverPoints.set(id, p); } return p; };
  for (let t = 0; t < subject.mesh.triangles.length; t += 3) {
    const ids = subject.mesh.triangles.slice(t, t + 3), original = ids.map(id => ({ uv: depthUV(subject.mesh, id), xy: subject.points[id], quv: Q.point(depthUV(subject.mesh, id)), qxy: Q.point(subject.points[id]) })); let remaining = [original];
    for (let c = 0; c < coverer.mesh.triangles.length && remaining.length; c += 3) {
      const ci = coverer.mesh.triangles.slice(c, c + 3), cp = ci.map(id => coverer.points[id]), sign = Math.sign((cp[1][0] - cp[0][0]) * (cp[2][1] - cp[0][1]) - (cp[1][1] - cp[0][1]) * (cp[2][0] - cp[0][0]));
      if (sign === 0) depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', coverer.mesh.image, 'neutral covering triangle is degenerate');
      const qp = ci.map(coverPoint); let divisor: DepthFraction | undefined;
      const next: Vertex[][] = []; let overlapIndex = 0;
      for (const polygon of remaining) {
        const overlapID = overlapIndex++;
        let interior = polygon; const exterior: Vertex[][] = [];
        for (let edge = 0; edge < 3 && interior.length >= 3; edge++) { const [a, b] = split(interior, qp[edge], qp[(edge + 1) % 3], sign); interior = a; if (b.length >= 3 && area(b) !== 0) exterior.push(b); }
        if (interior.length < 3 || area(interior) === 0) { next.push(polygon); continue; }
        const xs = interior.map(p => p.uv[0] * subject.image.width), ys = interior.map(p => p.uv[1] * subject.image.height); let protectedCount = 0;
        for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(subject.image.height, Math.ceil(Math.max(...ys))); y++) for (let x = Math.max(0, Math.floor(Math.min(...xs))); x < Math.min(subject.image.width, Math.ceil(Math.max(...xs))); x++) {
          const uv: DepthUV = [(x + 0.5) / subject.image.width, (y + 0.5) / subject.image.height]; if (subject.image.data[(y * subject.image.width + x) * 4 + 3] < alphaMin || !insidePolygon(uv, interior)) continue;
          const w = insideDepthTriangle(...uv, subject.mesh.uvs, ids, 1, 1); if (!w) continue;
          const xy: DepthUV = [0, 1].map(k => ids.reduce((s, id, j) => s + subject.points[id][k] * w[j], 0)) as DepthUV, cw = insideDepthTriangle(...xy, coverXY, ci, 1, 1); if (!cw) continue;
          const cuv: DepthUV = [0, 1].map(k => ci.reduce((s, id, j) => s + coverer.mesh.uvs[id * 2 + k] * cw[j], 0)) as DepthUV;
          if (depthAlpha(coverer.image, cuv) * 255 >= alphaMin) { protectedCount++; protectedSeen.add(y * subject.image.width + x); }
        }
        divisor ??= Q.cross(qp[0], qp[1], qp[2]);
        const withCover = interior.map(p => {
          const w = insideDepthTriangle(...p.xy, coverXY, ci, 1, 1); if (!w) return depthRefuse('RIG_DEPTH_COVERAGE', subject.mesh.image, 'overlap vertex has no covering UV');
          const d = divisor!, qw = [Q.div(Q.cross(qp[1], qp[2], p.qxy), d), Q.div(Q.cross(qp[2], qp[0], p.qxy), d), Q.div(Q.cross(qp[0], qp[1], p.qxy), d)];
          const qcu = [0, 1].map(k => ci.reduce((s, id, j) => Q.add(s, Q.mul(Q.from(coverer.mesh.uvs[id * 2 + k]), qw[j])), Q.from(0))) as DepthExactUV;
          return { ...p, qcu, cu: qcu.map(Q.number) as DepthUV };
        });
        const coverXs = withCover.map(p => p.cu![0] * coverer.image.width - 0.5), coverYs = withCover.map(p => p.cu![1] * coverer.image.height - 0.5);
        let min = 255, max = 0;
        for (let y = Math.floor(Math.min(...coverYs)); y <= Math.floor(Math.max(...coverYs)) + 1; y++) for (let x = Math.floor(Math.min(...coverXs)); x <= Math.floor(Math.max(...coverXs)) + 1; x++) { const px = Math.max(0, Math.min(coverer.image.width - 1, x)), py = Math.max(0, Math.min(coverer.image.height - 1, y)), a = coverer.image.data[(py * coverer.image.width + px) * 4 + 3]; min = Math.min(min, a); max = Math.max(max, a); }
        const thresholdLow = 255 - alphaMin;
        const mixed = !wholeHost && min < alphaMin && max > thresholdLow;
        if (mixed && !pilot) depthRefuse('RIG_DEPTH_COVERAGE_ALPHA_UNSUPPORTED', subject.mesh.image, 'mixed-alpha ownership partition is unfinished; strict mode refuses; explicit EYE-CHECK PILOT, not shippable is required for temporary final-coverer carry');
        if (wholeHost || min >= alphaMin || mixed) {
          carried.push({ polygon: withCover, triangle: ci, ...(mixed ? { pilotFallback: true } : {}) });
          if (mixed) {
            const uvArea = Math.abs(Q.number(withCover.slice(1, -1).reduce((s, p, i) => Q.add(s, Q.cross(withCover[0].quv, p.quv, withCover[i + 2].quv)), Q.from(0)))) / 2;
            fallbacks.push({ cellID: `seed:${t / 3}/coverer:${c / 3}/overlap:${overlapID}`, subject: subject.mesh.image, coverer: coverer.mesh.image, seedTriangle: t / 3, covererTriangle: c / 3, vertices: withCover.length, sourceArea: Math.abs(area(withCover)) / 2, uvArea, sourceTexelArea: uvArea * subject.image.width * subject.image.height, field: 'FINAL coverer field; no independent subject relief' });
          }
        }
        cells.push(withCover);
        next.push(...exterior);
      }
      remaining = next;
    }
    cells.push(...remaining);
  }
  const ownerAt = (uv: DepthUV): { ids: number[]; w: number[] } | null => {
    for (const cell of carried) if (insidePolygon(uv, cell.polygon)) {
      const coords = cell.polygon.flatMap(p => p.uv);
      for (let i = 1; i + 1 < cell.polygon.length; i++) { const ids = [0, i, i + 1], w = insideDepthTriangle(...uv, coords, ids, 1, 1); if (!w) continue;
        const xy: DepthUV = [0, 1].map(k => ids.reduce((s, id, j) => s + cell.polygon[id].xy[k] * w[j], 0)) as DepthUV, cw = insideDepthTriangle(...xy, coverXY, cell.triangle, 1, 1);
        if (!cw) depthRefuse('RIG_DEPTH_COVERAGE', subject.mesh.image, 'a constrained overlap cell has no matching covering triangle');
        const cuv: DepthUV = [0, 1].map(k => cell.triangle.reduce((s, id, j) => s + coverer.mesh.uvs[id * 2 + k] * cw[j], 0)) as DepthUV;
        if (!wholeHost && !cell.pilotFallback && depthAlpha(coverer.image, cuv) * 255 <= 255 - alphaMin) continue;
        return { ids: cell.triangle, w: cw };
      }
    }
    return null;
  };
  const protectedAt = (uv: DepthUV): boolean => {
    if (depthAlpha(subject.image, uv) * 255 < alphaMin) return false;
    for (let t = 0; t < subject.mesh.triangles.length; t += 3) {
      const ids = subject.mesh.triangles.slice(t, t + 3), w = insideDepthTriangle(...uv, subject.mesh.uvs, ids, 1, 1); if (!w) continue;
      const xy: DepthUV = [0, 1].map(k => ids.reduce((s, id, j) => s + subject.points[id][k] * w[j], 0)) as DepthUV;
      for (let c = 0; c < coverer.mesh.triangles.length; c += 3) { const ci = coverer.mesh.triangles.slice(c, c + 3), cw = insideDepthTriangle(...xy, coverXY, ci, 1, 1); if (!cw) continue; const cuv: DepthUV = [0, 1].map(k => ci.reduce((s, id, j) => s + coverer.mesh.uvs[id * 2 + k] * cw[j], 0)) as DepthUV; if (wholeHost || depthAlpha(coverer.image, cuv) * 255 >= alphaMin) return true; }
    }
    return false;
  };
  const value = (uv: DepthUV): number | null => { const hit = ownerAt(uv); return hit ? hit.ids.reduce((s, id, i) => s + coverer.z[id] * hit.w[i], 0) : null; };
  return { fallbacks, ownerAt, cells: cells.map(p => p.map(v => v.uv)), exact: new Map(cells.flatMap(p => p.map(v => [v.uv, v.quv] as const))), protectedTexels: protectedSeen.size, carriedCells: carried.length, protectedAt, value };
}
