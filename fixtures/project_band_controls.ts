/** Hand-derived rectangles for additive core projection, without assembly I/O. */
import { checkGeometry, projectSource } from '../src/assemble.ts';
import { newMask, newRaster, type Raster } from '../src/raster/types.ts';

type Say = (name: string, ok: boolean, detail: string, why: string) => void;

export function runProjectBandControls(say: Say): void {
  const W = 32;
  const at = (x: number, y: number): number => y * W + x;
  const frame = checkGeometry({ sourceW: W, sourceH: W, resolution: W, headBox: [0, 0, W, W], rigScale: 1 });
  const layer = (left = 8, right = 24): Raster => {
    const r = newRaster(W, W);
    for (let y = 8; y < 24; y++) for (let x = left; x < right; x++) r.data.set([100, 110, 120, 255], at(x, y) * 4);
    return r;
  };
  const painting = (): Raster => {
    const r = newRaster(W, W);
    for (let p = 0; p < W * W; p++) r.data.set([10, 20, 30, 255], p * 4);
    return r;
  };
  const same = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => a.length === b.length && Array.from(a).every((v, i) => v === b[i]);
  // Sigma 1 has offsets -4..4. All queried accepted rectangles are away
  // from the image border: no reflected sample can reach them.
  const taps = Array.from({ length: 9 }, (_, i) => Math.exp(-((i - 4) ** 2) / 2));
  const sum = taps.reduce((a, b) => a + b, 0);
  const k = taps.map(v => v / sum);
  const weight = (x: number, y: number, lo: number, hi: number, top: number, bottom: number): number => {
    let wx = 0, wy = 0;
    for (let d = -4; d <= 4; d++) {
      if (x + d >= lo && x + d < hi) wx += k[d + 4];
      if (y + d >= top && y + d < bottom) wy += k[d + 4];
    }
    return Math.fround(wx * wy);
  };
  const blended = (old: number, source: number, w: number): number => Math.trunc(Math.fround(
    Math.fround(w * source) + Math.fround(Math.fround(1 - w) * old)));
  for (const rule of ['core', 'visible'] as const) {
    const r = layer(), before = new Uint8ClampedArray(r.data), expected = new Uint8ClampedArray(before);
    const lo = rule === 'core' ? 10 : 8, hi = rule === 'core' ? 22 : 24;
    for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) {
      const w = weight(x, y, lo, hi, lo, hi), q = at(x, y) * 4;
      for (let c = 0; c < 3; c++) expected[q + c] = blended(before[q + c], 10 + 10 * c, w);
    }
    const writes: number[] = [];
    const [st] = projectSource([r], painting(), frame, 'full', rule, null, null, (_, p) => writes.push(p));
    const n = (hi - lo) ** 2;
    const masks = st.core === n && st.taken === n && st.refused === 0 &&
      Array.from({ length: W * W }, (_, p) => {
        const x = p % W, y = Math.floor(p / W), accepted = x >= lo && x < hi && y >= lo && y < hi ? 1 : 0;
        return st.coreMask?.data[p] === accepted && st.takenMask.data[p] === accepted && st.refusedMask?.data[p] === 0 && st.clear.data[p] === 1;
      }).every(Boolean);
    const expectedWrites = Array.from({ length: W * W }, (_, p) => p).filter(p => [0, 1, 2].some(c => before[p * 4 + c] !== expected[p * 4 + c]));
    say(rule === 'core' ? 'AS1275_CORE_BAND_USES_ORIGINAL_GAUSSIAN_WITH_UNCHANGED_MASKS_AND_CORE_RGB' : 'AS1275_VISIBLE_RETAINS_ITS_ORIGINAL_BYTES_MASKS_AND_WRITES',
      same(r.data, expected) && masks && same(writes, expectedWrites) && r.data[at(8, 16) * 4] < 100,
      `${rule}: core/taken/refused ${st.core}/${st.taken}/${st.refused}; rim red ${r.data[at(8, 16) * 4]}/${expected[at(8, 16) * 4]}; changed ${writes.length}/${expectedWrites.length}`,
      '16x16 opaque rectangle; core erosion is [10,22)^2 (144), visible is [8,24)^2 (256). RGB is the independently normalized nine-tap Gaussian blend; alpha and all masks are checked cell by cell. The old core-only write loop leaves the positive rim red at 100.');
  }
  const gates: string[] = [];
  let gatesOk = true;
  for (const gate of ['owner', 'keep', 'alpha', 'drift', 'distance'] as const) {
    const r = layer(), src = painting(), keep = newMask(W, W), front = newRaster(W, W);
    const x = gate === 'distance' ? 5 : 8, y = 16, q = at(x, y) * 4;
    if (gate === 'owner') front.data.set([100, 110, 120, 255], q);
    if (gate === 'keep') keep.data[at(x, y)] = 1;
    if (gate === 'alpha') r.data[q + 3] = 249;
    if (gate === 'drift') src.data[q] = 9; // 91 off; the positive fixture is exactly 90 off.
    if (gate === 'distance') r.data.set([100, 110, 120, 255], q); // Five columns from accepted core: outside sigma-one Gaussian support.
    const before = r.data.slice(q, q + 4);
    const [st] = projectSource([r, front], src, frame, 'full', 'core', [0, 1], [keep, null]);
    const n = gate === 'owner' || gate === 'keep' || gate === 'alpha' ? 139 : 144;
    const ok = st.core === n && st.taken === n && st.refused === 0 && same(r.data.subarray(q, q + 4), before);
    gatesOk &&= ok;
    gates.push(`${gate}: ${Array.from(r.data.subarray(q, q + 4))}, taken=${st.taken}`);
  }
  say('AS1275_CORE_BAND_RESPECTS_OWNER_KEEP_ALPHA_DRIFT_AND_GAUSSIAN_FOOTPRINT', gatesOk, gates.join('; '),
    'Each excluded rim sample retains original RGBA. One missing top pixel at (8,16) removes five cells from the first eroded column: 144-5=139; drift and the isolated sample leave 144. Alpha 249 is excluded; drift 90 is admitted by the positive control and 91 refused here; column 5 is five columns from accepted core column 10, outside the original radius-four Gaussian footprint.');
  const spur = layer(), spurPixel = at(7, 16), spurWrites: number[] = [];
  spur.data.set([100, 110, 120, 255], spurPixel * 4);
  const [spurStats] = projectSource([spur], painting(), frame, 'full', 'core', null, null, (_, p) => spurWrites.push(p));
  const spurWeight = weight(7, 16, 10, 22, 10, 22);
  const expectedSpur = [100, 110, 120].map((v, c) => blended(v, 10 + c * 10, spurWeight)).concat(255);
  say('AS1275_CORE_BAND_RETAINS_ORIGINAL_GAUSSIAN_SUPPORT_THREE_COLUMNS_FROM_CORE',
    spurWeight > 0 && same(spur.data.subarray(spurPixel * 4, spurPixel * 4 + 4), expectedSpur) &&
    same(expectedSpur, [99, 109, 119, 255]) && spurWrites.includes(spurPixel) &&
    spurStats.core === 144 && spurStats.taken === 144 && spurStats.refused === 0 && spurStats.coreMask?.data[spurPixel] === 0 && spurStats.takenMask.data[spurPixel] === 0,
    `column-7 RGBA ${Array.from(spur.data.subarray(spurPixel * 4, spurPixel * 4 + 4))}; expected ${expectedSpur}; core/taken/refused ${spurStats.core}/${spurStats.taken}/${spurStats.refused}`,
    'The single opaque sample at column 7 creates no extra eroded core. Accepted columns start at 10: original Gaussian taps at offsets 3 and 4 supply nonzero weight, yielding 99/109/119 after float32 blending and truncation. An added radius-two cutoff or the old core-only loop incorrectly leaves 100/110/120.');
  const alpha250 = layer();
  alpha250.data[at(8, 16) * 4 + 3] = 250;
  projectSource([alpha250], painting(), frame, 'full', 'core');
  say('AS1275_OPAQUE_THRESHOLD_250_RECEIVES_BAND_RGB_WITHOUT_ALPHA_CHANGE',
    alpha250.data[at(8, 16) * 4] === blended(100, 10, weight(8, 16, 10, 22, 10, 22)) && alpha250.data[at(8, 16) * 4 + 3] === 250,
    `alpha-250 rim ${Array.from(alpha250.data.subarray(at(8, 16) * 4, at(8, 16) * 4 + 4))}`,
    'Alpha 250 belongs to the opaque top set just like 255; the same accepted rectangle supplies its original Gaussian weight. The adjacent negative uses 249.');
  const head = layer(), headBefore = new Uint8ClampedArray(head.data), expectedHead = new Uint8ClampedArray(headBefore);
  const headFrame = { ...frame, headBox: [0, 8, 32, 32] as [number, number, number, number] };
  for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) {
    const core = x >= 10 && x < 22 && y >= 10 && y < 22;
    // Head window is [3,29) x [11,29); accepted core is [10,22) x [11,22).
    if (!core && y < 11) continue;
    const w = weight(x, y, 10, 22, 11, 22), q = at(x, y) * 4;
    for (let c = 0; c < 3; c++) expectedHead[q + c] = blended(headBefore[q + c], 10 + 10 * c, w);
  }
  const [headStats] = projectSource([head], painting(), headFrame, 'head', 'core');
  say('AS1275_HEAD_BAND_STAYS_IN_WINDOW_WHILE_EXISTING_CORE_FEATHER_IS_PRESERVED',
    same(head.data, expectedHead) && headStats.core === 144 && headStats.taken === 132 && headStats.refused === 0 &&
    head.data[at(8, 9) * 4] === 100 && head.data[at(8, 16) * 4] < 100 && head.data[at(10, 10) * 4] < 100,
    `head core/taken/refused ${headStats.core}/${headStats.taken}/${headStats.refused}; outside rim ${head.data[at(8, 9) * 4]}, inside rim ${head.data[at(8, 16) * 4]}, historical outside-window core ${head.data[at(10, 10) * 4]}`,
    'Head inset is three: accepted rectangle has 12*11=132 cells. New rim writes obey the window; existing core Gaussian writes immediately outside it retain the historical formula.');
  for (const kind of ['thin', 'refused', 'window'] as const) {
    const r = kind === 'thin' ? layer(8, 11) : layer(), src = painting();
    if (kind === 'refused') for (let p = 0; p < W * W; p++) src.data[p * 4] = 9;
    const before = new Uint8ClampedArray(r.data), writes: number[] = [];
    const noWindow = { ...frame, headBox: [0, 0, 8, 8] as [number, number, number, number] };
    const [st] = projectSource([r], src, kind === 'window' ? noWindow : frame, kind === 'window' ? 'head' : 'full', 'core', null, null, (_, p) => writes.push(p));
    say(kind === 'thin' ? 'AS1275_EMPTY_ERODED_CORE_CHANGES_NO_BYTES' : kind === 'refused' ? 'AS1275_ALL_REFUSED_CORE_CHANGES_NO_BYTES' : 'AS1275_WINDOW_WITHOUT_ACCEPTED_CORE_CHANGES_NO_BYTES',
      same(r.data, before) && writes.length === 0 && st.taken === 0 && st.core === (kind === 'thin' ? 0 : 144) && st.refused === (kind === 'refused' ? 144 : 0),
      `${kind}: core/taken/refused ${st.core}/${st.taken}/${st.refused}; writes ${writes.length}`,
      'A three-column strip erodes to nothing; a 16x16 rectangle entirely 91 off has 144 refused core cells; a head window [3,5)^2 misses the core. With no accepted seed none permits a projection byte or callback.');
  }
}
