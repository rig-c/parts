/** Provider-independent floating-point maps. No model or reference depth is read here. */
import { PartsError } from './errors.ts';
import { connectedComponents } from './raster/components.ts';
import { extendDepthSilhouette } from './depthsheets.ts';
import { newRaster, type Raster } from './raster/types.ts';
import { edgeLength } from './length.ts';

export interface NumericMap { spec: 'rig-parts-map/1'; width: number; height: number; channels: 1 | 3; data: number[] }
export function depthMapFail(code: string, object: string, detail: string): never {
  throw new PartsError([{ code, object, detail }]);
}
export function readNumericMap(raw: unknown, at: string): NumericMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return depthMapFail('DEPTH_MAP_FORMAT', at, 'requires a rig-parts-map/1 JSON object');
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some(k => !['spec', 'width', 'height', 'channels', 'data'].includes(k)) || r.spec !== 'rig-parts-map/1' || !Number.isSafeInteger(r.width) || !Number.isSafeInteger(r.height) || Number(r.width) < 1 || Number(r.height) < 1 || (r.channels !== 1 && r.channels !== 3) || !Array.isArray(r.data) || r.data.length !== Number(r.width) * Number(r.height) * r.channels || !r.data.every(x => typeof x === 'number' && Number.isFinite(x))) {
    return depthMapFail('DEPTH_MAP_FORMAT', at, 'requires positive integer width/height, channels 1 or 3 and exactly width*height*channels finite row-major numbers; previews and quantized PNGs are not numeric maps');
  }
  return r as unknown as NumericMap;
}

/** NumPy percentile's linear interpolation on sorted samples, including the even median. */
export function mapQuantile(sorted: readonly number[], q: number): number {
  const p = (sorted.length - 1) * q, i = Math.floor(p), f = p - i;
  return sorted[i] * (1 - f) + sorted[Math.min(i + 1, sorted.length - 1)] * f;
}
export function alphaSupport(art: Raster): Uint8Array {
  return Uint8Array.from({ length: art.width * art.height }, (_, i) => art.data[i * 4 + 3] >= 128 ? 1 : 0);
}

/** Pillow mode-F BOX: discrete box taps, horizontal then vertical float32 passes.
 * Unlike area coverage, BOX gives equal weights to the included pixel centres.
 * Verification compares this operation to an independent Pillow oracle.
 */
export function floatBox(data: ArrayLike<number>, w: number, h: number, width: number, height: number): Float64Array {
  const pass = (src: ArrayLike<number>, sw: number, sh: number, dw: number): Float32Array => {
    const out = new Float32Array(dw * sh), scale = sw / dw;
    for (let x = 0; x < dw; x++) {
      const center = (x + 0.5) * scale, support = Math.max(1, scale) * 0.5;
      const lo = Math.max(0, Math.trunc(center - support + 0.5)), hi = Math.min(sw, Math.trunc(center + support + 0.5));
      const indices: number[] = [];
      for (let i = lo; i < hi; i++) { const d = (i - center + 0.5) / Math.max(1, scale); if (d > -0.5 && d <= 0.5) indices.push(i); }
      if (indices.length === 0) indices.push(Math.min(sw - 1, Math.max(0, Math.floor(center))));
      for (let y = 0; y < sh; y++) { let v = 0; for (const i of indices) v += src[y * sw + i] / indices.length; out[y * dw + x] = v; }
    }
    return out;
  };
  const horizontal = w === width ? Float32Array.from(data) : pass(data, w, h, width);
  if (h === height) return Float64Array.from(horizontal);
  const transpose = new Float32Array(width * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < width; x++) transpose[x * h + y] = horizontal[y * width + x];
  const vertical = pass(transpose, h, width, height), out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = vertical[x * height + y];
  return out;
}

function norm(v: Float64Array): number { let s = 0; for (const x of v) s += x * x; return Math.sqrt(s); }
function eroded(mask: Uint8Array, w: number, h: number, count: number): Uint8Array {
  let cur = mask;
  for (let n = 0; n < count; n++) {
    const next = new Uint8Array(cur.length);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; next[i] = cur[i] && cur[i - 1] && cur[i + 1] && cur[i - w] && cur[i + w] ? 1 : 0; }
    cur = next;
  }
  return cur;
}

/** Matrix-free LSQR over right/down adjacent mask pixels, row order right then down.
 * Paige/Saunders bidiagonalization; atol=btol=1e-6, conlim=1e8, at most 3000
 * iterations. These are algorithm settings, not fitted depth-quality bars.
 */
function solveEdges(a: Int32Array, b: Int32Array, rhs: Float64Array, size: number): { z: Float64Array; iterations: number; residual: number } {
  const mul = (v: Float64Array, out: Float64Array): void => { for (let i = 0; i < a.length; i++) out[i] = v[b[i]] - v[a[i]]; };
  const trans = (u: Float64Array, out: Float64Array): void => { out.fill(0); for (let i = 0; i < a.length; i++) { out[b[i]] += u[i]; out[a[i]] -= u[i]; } };
  const z = new Float64Array(size), u = rhs.slice(), v = new Float64Array(size);
  let beta = norm(u); const bnorm = beta;
  if (beta === 0) return { z, iterations: 0, residual: 0 };
  for (let i = 0; i < u.length; i++) u[i] /= beta;
  trans(u, v); let alpha = norm(v);
  if (alpha === 0) return { z, iterations: 0, residual: beta };
  for (let i = 0; i < v.length; i++) v[i] /= alpha;
  const w = v.slice(), av = new Float64Array(u.length), atu = new Float64Array(size);
  let rhobar = alpha, phibar = beta, anorm = 0, ddnorm = 0, xnorm = 0, xxnorm = 0, zeta = 0, cs2 = -1, sn2 = 0, iterations = 0, residual = beta;
  for (; iterations < 3000;) {
    iterations++; mul(v, av);
    for (let i = 0; i < u.length; i++) u[i] = av[i] - alpha * u[i];
    beta = norm(u);
    if (beta > 0) {
      for (let i = 0; i < u.length; i++) u[i] /= beta;
      anorm = Math.sqrt(anorm * anorm + alpha * alpha + beta * beta);
      trans(u, atu);
      for (let i = 0; i < v.length; i++) v[i] = atu[i] - beta * v[i];
      alpha = norm(v);
      if (alpha > 0) for (let i = 0; i < v.length; i++) v[i] /= alpha;
    }
    const rho = edgeLength(rhobar, beta), cs = rhobar / rho, sn = beta / rho;
    const theta = sn * alpha; rhobar = -cs * alpha;
    const phi = cs * phibar; phibar = sn * phibar;
    const tau = sn * phi;
    for (let i = 0; i < z.length; i++) { const d = w[i] / rho; z[i] += phi * d; ddnorm += d * d; w[i] = v[i] - theta / rho * w[i]; }
    const delta = sn2 * rho, gambar = -cs2 * rho, right = phi - delta * zeta;
    const zbar = right / gambar; xnorm = Math.sqrt(xxnorm + zbar * zbar);
    const gamma = edgeLength(gambar, theta); cs2 = gambar / gamma; sn2 = theta / gamma; zeta = right / gamma; xxnorm += zeta * zeta;
    residual = Math.abs(phibar);
    const arnorm = alpha * Math.abs(tau), acond = anorm * Math.sqrt(ddnorm);
    if (acond >= 1e8 || arnorm <= 1e-6 * anorm * residual || residual <= 1e-6 * bnorm + 1e-6 * anorm * xnorm) break;
  }
  return { z, iterations, residual };
}

export interface NormalHeight { data: Float64Array; sign: 1 | -1; coreMinusRim: number; iterations: number; residual: number }
/** Normals are signed XYZ in image axes (x right/y down), not RGB previews.
 * Half-resolution stride, step2 edge trapezoids, cross-erosion core/rim sign.
 * Convexity selects between a height and its negation without an answer key.
 */
export function integrateNormals(map: NumericMap, art: Raster, at: string): NormalHeight {
  const support = alphaSupport(art);
  const islands = connectedComponents({ width: art.width, height: art.height, data: support }, 4).count - 1;
  if (islands !== 1) return depthMapFail('DEPTH_NORMAL_ISLANDS', at, `has ${islands} four-connected alpha>=128 islands; exactly one closed convex part is required, use scalar depth for occlusion-separated parts`);
  if (map.channels !== 3 || map.width !== art.width || map.height !== art.height) return depthMapFail('DEPTH_MAP_SIZE', at, `normal map is ${map.width}x${map.height}x${map.channels}; registered art ${art.width}x${art.height}x3 is required`);
  const w = Math.ceil(map.width / 2), h = Math.ceil(map.height / 2), mask = new Uint8Array(w * h), px = new Float64Array(w * h), py = new Float64Array(w * h), ids = new Int32Array(w * h).fill(-1);
  let count = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const src = 2 * y * map.width + 2 * x, i = y * w + x;
    mask[i] = support[src]; if (!mask[i]) continue;
    ids[i] = count++;
    const nx = map.data[src * 3], ny = map.data[src * 3 + 1], nz = map.data[src * 3 + 2], length = edgeLength(edgeLength(nx, ny), nz);
    if (length < 1e-12 || !Number.isFinite(length)) return depthMapFail('DEPTH_NORMAL_VECTOR', `${at} (${x * 2},${y * 2})`, 'has zero or overflowing length; a finite nonzero representable signed XYZ vector is required');
    const divisor = Math.max(Math.abs(nz), 0.15 * length);
    px[i] = Math.fround(-nx / divisor); py[i] = Math.fround(-ny / divisor);
  }
  const sampledIslands = connectedComponents({ width: w, height: h, data: mask }, 4).count - 1;
  if (sampledIslands !== 1) return depthMapFail('DEPTH_NORMAL_ISLANDS', at, `half-resolution mask has ${sampledIslands} islands; provide a larger registered input so stride2 keeps one island`);
  const aa: number[] = [], bb: number[] = [], rr: number[] = [];
  for (const [dx, dy, g] of [[1, 0, px], [0, 1, py]] as const) {
    for (let y = 0; y < h - dy; y++) for (let x = 0; x < w - dx; x++) {
      const i = y * w + x, j = (y + dy) * w + x + dx;
      if (mask[i] && mask[j]) { aa.push(ids[i]); bb.push(ids[j]); rr.push(Math.fround(g[i] + g[j])); }
    }
  }
  const solve = solveEdges(Int32Array.from(aa), Int32Array.from(bb), Float64Array.from(rr), count);
  const core = eroded(mask, w, h, Math.max(3, Math.trunc(0.12 * Math.sqrt(count)))), inner = eroded(mask, w, h, 3);
  let cv = 0, rv = 0, cn = 0, rn = 0;
  for (let i = 0; i < mask.length; i++) { if (core[i]) { cv += solve.z[ids[i]]; cn++; } if (mask[i] && !inner[i]) { rv += solve.z[ids[i]]; rn++; } }
  const d = cv / cn - rv / rn;
  if (!cn || !rn || !Number.isFinite(d) || Math.abs(d) < 1e-12) return depthMapFail('DEPTH_NORMAL_CONVEXITY', at, `core ${cn}, rim ${rn}, core-minus-rim ${d}; a resolved convex interior is required, use a larger mask or scalar source`);
  const sign = d >= 0 ? 1 : -1, data = new Float64Array(w * h);
  for (let i = 0; i < mask.length; i++) if (mask[i]) data[i] = Math.fround(solve.z[ids[i]] * sign);
  return { data, sign, coreMinusRim: d, iterations: solve.iterations, residual: solve.residual };
}

export interface MapSheetReading { levels: number; clipFraction: number; reliefRigPixels: number; rawMedian: number; rawP5: number; rawP95: number }
export function mapToSheet(data: ArrayLike<number>, art: Raster, median: number, relief: number, near: 'black' | 'white', zScale: number, at: string): { sheet: Raster; reading: MapSheetReading } {
  const support = alphaSupport(art), values: number[] = [];
  for (let i = 0; i < support.length; i++) if (support[i]) values.push(data[i]);
  if (!values.length) return depthMapFail('DEPTH_MAP_SUPPORT', at, 'has no alpha>=128 pixels; a part with declared support is required');
  values.sort((a, b) => a - b);
  const med = mapQuantile(values, 0.5), lo = mapQuantile(values, 0.05), hi = mapQuantile(values, 0.95), spread = hi - lo;
  if (![med, lo, hi, spread].every(Number.isFinite)) return depthMapFail('DEPTH_MAP_FORMAT', at, 'normalization overflows finite arithmetic; provide finite representable median and percentile spread');
  if (spread === 0 && relief !== 0) return depthMapFail('DEPTH_MAP_SPREAD', at, `p5=p95=${lo} but relief=${relief}; a nonflat map or explicit relief 0 is required`);
  const sheet = newRaster(art.width, art.height), seeds = newRaster(art.width, art.height), levels = new Set<number>(); let clipped = 0;
  for (let i = 0; i < support.length; i++) {
    const z = median + relief * (spread === 0 ? 0 : (data[i] - med) / spread), unit = Math.max(0, Math.min(1, near === 'white' ? z / zScale : 1 - z / zScale));
    if (!Number.isFinite(z) && support[i]) return depthMapFail('DEPTH_MAP_FORMAT', at, `world depth at support pixel ${i} overflows; declare representable median/relief and raw numbers`);
    // Uint8ClampedArray implements ties-to-even, as numpy.round does.
    sheet.data[i * 4] = unit * 255; sheet.data[i * 4 + 1] = sheet.data[i * 4 + 2] = sheet.data[i * 4]; sheet.data[i * 4 + 3] = 255;
    seeds.data[i * 4 + 3] = support[i] ? 255 : 0;
    if (support[i]) { levels.add(sheet.data[i * 4]); if (z <= 0 || z >= zScale) clipped++; }
  }
  return { sheet: extendDepthSilhouette(sheet, seeds), reading: { levels: levels.size, clipFraction: clipped / values.length, reliefRigPixels: relief, rawMedian: med, rawP5: lo, rawP95: hi } };
}
