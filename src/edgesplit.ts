/** Painting-edge part split on pre-projection plan rasters (#1231). */
import type { Problem } from './errors.ts';
import { refuseIfAny } from './errors.ts';
import type { Raster } from './raster/types.ts';
import { pyRound } from './round.ts';

const EDGE_SPLIT_ALPHA = 128;
const EDGE_SPLIT_STEP = 40;

export interface EdgeSplit {
  over: string;
  under: string;
  /** Half-open rectangle in rig pixels [x0, y0, x1, y1]; scopes the search. */
  band: [number, number, number, number];
}

export interface EdgeSplitReading {
  over: string;
  under: string;
  band: [number, number, number, number];
  columns: number;
  edge_share: number;
  moved_px: number;
  y_star_min: number;
  y_star_max: number;
  over_below_edge_px: number;
}

/** Shared by every config door and the callable assemble API. */
export function edgeSplitProblems(value: unknown, names: ReadonlySet<string> | null = null): Problem[] {
  const at = 'config.assemble.edge_splits', out: Problem[] = [];
  const fail = (code: string, object: string, detail: string): void => { out.push({ code, object, detail }); };
  if (!Array.isArray(value)) {
    fail('CONFIG_FIELD_TYPE', at, 'requires an array of {over, under, band}; omit it for no split');
    return out;
  }
  value.forEach((entry: unknown, i) => {
    const path = `${at}[${i}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      fail('CONFIG_FIELD_TYPE', path, 'requires {over, under, band}');
      return;
    }
    const e = entry as Record<string, unknown>;
    for (const key of Object.keys(e)) {
      if (!['over', 'under', 'band'].includes(key)) {
        fail('CONFIG_KEY_KNOWN', `${path}.${key}`, 'is unknown; only over, under and band are read');
      }
    }
    for (const key of ['over', 'under', 'band']) {
      if (!(key in e)) {
        fail('CONFIG_FIELD_PRESENT', `${path}.${key}`, 'is absent and required; no part or band is inferred');
      }
    }
    for (const key of ['over', 'under'] as const) {
      if (key in e) {
        if (typeof e[key] !== 'string' || e[key] === '') {
          fail('CONFIG_FIELD_TYPE', `${path}.${key}`, `is ${JSON.stringify(e[key])}; a nonempty plan part name is required`);
        } else if (names !== null && !names.has(e[key] as string)) {
          fail('CONFIG_NAME_RESOLVES', `${path}.${key}`, `names "${e[key]}"; a part named in assemble.plan is required — known: ${[...names].join(', ')}`);
        }
      }
    }
    if (typeof e.over === 'string' && e.over !== '' && e.over === e.under) {
      fail('CONFIG_PART_UNIQUE', `${path}.under`, `names "${e.under}", the same part as over; two distinct plan parts are required`);
    }
    if ('band' in e && !(Array.isArray(e.band) && e.band.length === 4 && e.band.every(n => Number.isSafeInteger(n) && n >= 0) && e.band[0] < e.band[2] && e.band[1] < e.band[3])) {
      fail('CONFIG_FIELD_TYPE', `${path}.band`, `is ${JSON.stringify(e.band)}; [x0,y0,x1,y1] as nonnegative safe integers with x0 < x1 and y0 < y1 is required, rig pixels, upper bounds exclusive`);
    }
  });
  return out;
}

/**
 * Splits `over` and `under` plan rasters in place along the strongest painting
 * vertical RGB step in `band`, before source projection.
 */
export function applyEdgeSplits(
  declarations: readonly EdgeSplit[],
  parts: ReadonlyMap<string, Raster>,
  painting: Raster,
  written?: (part: string, pixel: number, cleared: boolean, priorAlpha: number) => void,
): EdgeSplitReading[] {
  refuseIfAny(edgeSplitProblems(declarations, new Set(parts.keys())));
  const { width: W, height: H } = painting;
  const problems: Problem[] = [];
  declarations.forEach((e, i) => {
    if (e.band[2] > W || e.band[3] > H) {
      problems.push({
        code: 'ASSEMBLE_PAINTING_BAND_INSIDE',
        object: `config.assemble.edge_splits[${i}] ("${e.over}" -> "${e.under}")`,
        detail: `band is [${e.band.join(', ')}]; rig is ${W}x${H}, so x1 <= ${W} and y1 <= ${H} are required; no clipping is applied`,
      });
    }
  });
  refuseIfAny(problems);

  const initialAlpha = new Map<string, Uint8Array>();
  for (const e of declarations) {
    if (!initialAlpha.has(e.under)) {
      const r = parts.get(e.under)!;
      const a = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) a[i] = r.data[i * 4 + 3];
      initialAlpha.set(e.under, a);
    }
  }

  const readings: EdgeSplitReading[] = [];
  for (const e of declarations) {
    const overRaster = parts.get(e.over)!;
    const underRaster = parts.get(e.under)!;
    const underInitialAlpha = initialAlpha.get(e.under)!;
    const [x0, y0, x1, y1] = e.band;
    let columns = 0;
    let strongEdgeColumns = 0;
    let movedPx = 0;
    let yStarMin = Infinity;
    let yStarMax = -1;
    let overBelowEdgePx = 0;

    for (let x = x0; x < x1; x++) {
      let yStar = -1;
      let bestStep = -1;
      for (let y = y0; y < y1 && y + 1 < H; y++) {
        const p = (y * W + x) * 4;
        if (overRaster.data[p + 3] < EDGE_SPLIT_ALPHA) continue;
        const q = ((y + 1) * W + x) * 4;
        const step = Math.max(
          Math.abs(painting.data[p] - painting.data[q]),
          Math.abs(painting.data[p + 1] - painting.data[q + 1]),
          Math.abs(painting.data[p + 2] - painting.data[q + 2]),
        );
        if (step > bestStep) {
          bestStep = step;
          yStar = y;
        }
      }
      if (yStar < 0) continue;
      columns++;
      if (bestStep > EDGE_SPLIT_STEP) strongEdgeColumns++;
      if (yStar < yStarMin) yStarMin = yStar;
      if (yStar > yStarMax) yStarMax = yStar;

      for (let y = yStar + 1; y < y1; y++) {
        const idx = y * W + x;
        const p = idx * 4;
        const oa = overRaster.data[p + 3];
        if (oa >= EDGE_SPLIT_ALPHA) {
          const priorUnderAlpha = underInitialAlpha[idx];
          overRaster.data.fill(0, p, p + 4);
          written?.(e.over, idx, true, oa);
          underRaster.data[p] = painting.data[p];
          underRaster.data[p + 1] = painting.data[p + 1];
          underRaster.data[p + 2] = painting.data[p + 2];
          underRaster.data[p + 3] = 255;
          written?.(e.under, idx, false, priorUnderAlpha);
          movedPx++;
        } else if (oa > 0) {
          overRaster.data.fill(0, p, p + 4);
          written?.(e.over, idx, true, oa);
        }
        if (overRaster.data[p + 3] >= EDGE_SPLIT_ALPHA) overBelowEdgePx++;
      }
    }

    readings.push({
      over: e.over,
      under: e.under,
      band: [x0, y0, x1, y1],
      columns,
      edge_share: columns === 0 ? 0 : pyRound(strongEdgeColumns / columns, 3),
      moved_px: movedPx,
      y_star_min: columns === 0 ? 0 : yStarMin,
      y_star_max: columns === 0 ? 0 : yStarMax,
      over_below_edge_px: overBelowEdgePx,
    });
  }
  return readings;
}

export function edgeSplitLines(readings: readonly EdgeSplitReading[]): string[] {
  return readings.map(
    (r) =>
      `  edge split: "${r.over}" -> "${r.under}" band [${r.band.join(', ')}] columns=${r.columns} edge_share=${r.edge_share} moved=${r.moved_px} px y*=${r.y_star_min}..${r.y_star_max} over_below_edge_px=${r.over_below_edge_px}`,
  );
}
