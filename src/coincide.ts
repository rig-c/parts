/** Report-only missing support observations on the native setup grid (#998). */
import { refuseIfAny } from './errors.ts';
import { connectedComponents } from './raster/components.ts';
import { assertBinary, type Mask } from './raster/types.ts';

export const COINCIDE_LINE = 'PART_SUPPORT_REPORT';
export const SUPPORT_GRID_CODE = 'CHECK_SUPPORT_GRID';
export type SupportBox = [number, number, number, number];
/** Independent stage-grid witness, supplied by the producer. Never derive it
 * from the final alpha or from the part's cropped PNG rectangle. */
export interface SupportDomain {
  part: string;
  mask: Mask;
  provenance: { kind: 'cut-polygon' | 'limb-capsule'; entry: string };
}
export interface UnavailableSupportDomain { part: string; reason: string }
export type SupportDomainReading = SupportDomain | UnavailableSupportDomain;
export interface SupportPart { name: string; mask: Mask }
export interface SupportPair {
  front: string;
  back: string;
  status: 'measured' | 'unavailable';
  reason?: string;
  boundary_length_px: number | null;
  /** Bounds of the shared unit segments, exclusive far edge. */
  box: SupportBox | null;
  /** Missing cells in B's domain under F, a candidate bound, not inferred art. */
  continuation_candidate_area_px: number | null;
}
export interface UnownedReading {
  status: 'measured' | 'unavailable';
  reason?: string;
  area_px: number | null;
  regions: Array<{ box: SupportBox; area_px: number }>;
}
export interface SupportReport {
  status: 'REPORTED' | 'WARN';
  grid: [number, number];
  alpha: 'alpha >= 128';
  pair_registration: string;
  unowned_registration: string;
  boundary: '4-neighbour unit pixel-cell edges, exact coincidence';
  pairs: SupportPair[];
  coverage: { measured: number; total: number };
  unowned: UnownedReading;
  reason?: string;
}

/** Parts are ordered back to front. A boundary segment is counted only when
 * the adjacent F cell is missing from B AND belongs to B's independent domain.
 * No dilation, inferred continuation, limit or gate is applied. */
export function supportReport(
  width: number, height: number, parts: readonly SupportPart[],
  domains: readonly SupportDomainReading[], paintedFigure: Mask | null,
  unavailableReason = 'independent support domain is unavailable',
): SupportReport {
  const check = (mask: Mask): void => {
    assertBinary('support report', mask);
    if (mask.data.length !== width * height || mask.width !== width || mask.height !== height) refuseIfAny([{ code: SUPPORT_GRID_CODE, object: 'support report mask', detail: `is ${mask.width}x${mask.height} with ${mask.data.length} cells; requires ${width}x${height} and ${width * height} cells on the native grid` }]);
  };
  for (const part of parts) check(part.mask);
  for (const domain of domains) if ('mask' in domain) check(domain.mask);
  if (paintedFigure !== null) check(paintedFigure);
  if (new Set(parts.map(p => p.name)).size !== parts.length || new Set(domains.map(d => d.part)).size !== domains.length) throw new Error('support report requires unique part and domain names');
  const pairs: SupportPair[] = [];
  for (let back = 0; back < parts.length; back++) for (let front = back + 1; front < parts.length; front++) {
    const B = parts[back], F = parts[front], domain = domains.find(d => d.part === B.name);
    if (domain === undefined || !('mask' in domain)) {
      pairs.push({ front: F.name, back: B.name, status: 'unavailable', reason: `${B.name}: ${domain === undefined ? unavailableReason : domain.reason}`, boundary_length_px: null, box: null, continuation_candidate_area_px: null });
      continue;
    }
    let length = 0, area = 0, x0 = width, y0 = height, x1 = 0, y1 = 0;
    const edge = (a: number, b: number, x: number, y: number, dx: number, dy: number): void => {
      if (B.mask.data[a] === 0 || B.mask.data[b] !== 0 || F.mask.data[a] !== 0 || F.mask.data[b] === 0 || domain.mask.data[a] === 0 || domain.mask.data[b] === 0) return;
      length++;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + dx); y1 = Math.max(y1, y + dy);
    };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (domain.mask.data[p] !== 0 && F.mask.data[p] !== 0 && B.mask.data[p] === 0) area++;
      if (x + 1 < width) { edge(p, p + 1, x + 1, y, 0, 1); edge(p + 1, p, x + 1, y, 0, 1); }
      if (y + 1 < height) { edge(p, p + width, x, y + 1, 1, 0); edge(p + width, p, x, y + 1, 1, 0); }
    }
    pairs.push({ front: F.name, back: B.name, status: 'measured', boundary_length_px: length,
      box: length === 0 ? null : [x0, y0, x1 - x0, y1 - y0], continuation_candidate_area_px: area });
  }
  const unowned = unownedSupport(width, height, parts, paintedFigure);
  return { status: pairs.some(p => (p.boundary_length_px ?? 0) > 0) || (unowned.area_px ?? 0) > 0 ? 'WARN' : 'REPORTED',
    grid: [width, height], alpha: 'alpha >= 128', pair_registration: 'caller-supplied native masks', unowned_registration: 'caller-supplied native masks', boundary: '4-neighbour unit pixel-cell edges, exact coincidence',
    pairs, coverage: { measured: pairs.filter(p => p.status === 'measured').length, total: pairs.length }, unowned };
}

/** Painted cells outside the supplied actual setup union, including open edges. */
export function unownedSupport(width: number, height: number, parts: readonly SupportPart[], paintedFigure: Mask | null): UnownedReading {
  let unowned: UnownedReading = { status: 'unavailable', reason: 'source painting and its painted silhouette are unavailable; supply --source', area_px: null, regions: [] };
  if (paintedFigure !== null) {
    const missing = paintedFigure.data.slice();
    for (const part of parts) for (let p = 0; p < missing.length; p++) if (part.mask.data[p] !== 0) missing[p] = 0;
    const regions = connectedComponents({ width, height, data: missing }, 4).stats.slice(1).map(s => ({ box: [s.left, s.top, s.width, s.height] as SupportBox, area_px: s.area }));
    unowned = { status: 'measured', area_px: regions.reduce((sum, r) => sum + r.area_px, 0), regions };
  }
  return unowned;
}

export function supportLines(report: SupportReport): string[] {
  return [`${COINCIDE_LINE}: ${report.status} — ${report.coverage.measured} of ${report.coverage.total} pairs measured; pairs on ${report.pair_registration}; unowned on ${report.unowned_registration}${report.reason === undefined ? '' : `; ${report.reason}`}`,
    ...report.pairs.map(p => `${COINCIDE_LINE}: back "${p.back}" front "${p.front}" ${p.status} — ${p.status === 'unavailable' ? p.reason : `boundary ${p.boundary_length_px} px, box ${JSON.stringify(p.box)}, continuation candidate ${p.continuation_candidate_area_px} px`}`),
    `${COINCIDE_LINE}: unowned ${report.unowned.status} — ${report.unowned.status === 'unavailable' ? report.unowned.reason : `${report.unowned.area_px} px, ${report.unowned.regions.length} regions`}`,
    ...report.unowned.regions.map(r => `${COINCIDE_LINE}: unowned box ${JSON.stringify(r.box)}, area ${r.area_px} px`)];
}
