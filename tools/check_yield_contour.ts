/** Independent populations for the accepted opaque contour (#841). */
import { assemble, checkGeometry, projectSource, finishYieldedProjection } from '../src/assemble.ts';
import { yieldContourFixture } from '../fixtures/yield_contour.ts';
import { newMask } from '../src/raster/index.ts';
import { provenanceAddsUp } from '../src/provenance.ts';
import { rimPixel } from '../fixtures/yield_rim.ts';

export function runYieldContourChecks(say: (name: string, pass: boolean, detail: string) => void): void {
  const input = yieldContourFixture(), raw = input.full.layers[1].pixels;
  const stats = projectSource(input.full.layers.map(l => structuredClone(l.pixels)), input.source, checkGeometry({ sourceW: 64, sourceH: 64, resolution: 64, headBox: [0, 0, 64, 64], rigScale: 1 }), 'full');
  const run = (enabled: boolean, options: Parameters<typeof yieldContourFixture>[0] = {}) => assemble({ ...yieldContourFixture(options), yieldRefused: enabled });
  const off = run(false), on = run(true);
  const front = (r: ReturnType<typeof assemble>) => r.images.find(p => p.record.name === 'front')!;
  let population = 0, rawMin = 255, rawMax = 0, maxDifference = 0, residual = 0, opaque = 0, holes = 0, holderWrong = 0, awayChanged = 0;
  for (let y = 8; y < 56; y++) for (let x = 8; x < 56; x++) {
    const p = y * 64 + x, interior = x >= 24 && x < 40 && y >= 24 && y < 40;
    const band = !interior && x >= 20 && x < 44 && y >= 20 && y < 44;
    const a = rimPixel(front(on), x, y), b = rimPixel(front(off), x, y);
    if (band) {
      const s = stats[1];
      if (s.coreMask?.data[p] === 1 && s.refusedMask?.data[p] === 0 && s.takenMask.data[p] === 1) population++;
      const delta = Math.abs(raw.data[p * 4] - 100); rawMin = Math.min(rawMin, delta); rawMax = Math.max(rawMax, delta);
      const d = Math.max(...a.slice(0, 3).map(v => Math.abs(v - 100))); maxDifference = Math.max(maxDifference, d); if (d > 0) residual++;
      if (a[3] === 255) opaque++;
    } else if (!interior && a.some((v, i) => v !== b[i])) awayChanged++;
    if (interior) {
      if (on.recomposite.data[p * 4 + 3] !== 255) holes++;
      if (a[3] !== 0 || on.recomposite.data[p * 4] !== 100) holderWrong++;
    }
  }
  say('AS841_ACCEPTED_OPAQUE_CONTOUR_FINISHES_WITH_ZERO_DIFFERENCE', population === 320 && rawMin === 90 && rawMax === 90 && opaque === 320 && maxDifference === 0,
    JSON.stringify({ population, rawMin, rawMax, opaque, residual, maxDifference, refused: stats[1].refused, yielded: on.yieldReadings?.find(r => r.part === 'front')?.yielded, finished: on.yieldReadings?.find(r => r.part === 'front')?.finishedProjection }));
  say('AS841_BODY_HOLDER_AND_DISTANT_WEIGHTS_ARE_PRESERVED', holes === 0 && holderWrong === 0 && awayChanged === 0, JSON.stringify({ holes, holderWrong, awayChanged }));
  const controls = [{ name: 'no-seed', options: { refuse: false } }, { name: 'mismatch', options: { mismatch: true } }, { name: 'soft-holder', options: { holderAlpha: 249 } }].map(({ name, options }) => {
    const a = front(run(false, options)), b = front(run(true, options));
    return { name, same: JSON.stringify(a.record) === JSON.stringify(b.record) && a.image.data.every((v, i) => v === b.image.data[i]) };
  });
  say('AS841_NO_YIELDED_SEED_LEAVES_ACCEPTED_PIXELS_UNCHANGED', controls.every(r => r.same), JSON.stringify(controls));
  // A nonzero residual outside the seed footprint detects accidental global finishing.
  const distant = (enabled: boolean) => {
    const input = yieldContourFixture();
    for (let y = 24; y < 40; y++) for (let x = 10; x < 13; x++) input.full.layers[1].pixels.data[(y * 64 + x) * 4] = 190;
    return assemble({ ...input, yieldRefused: enabled });
  };
  const da = front(distant(false)), db = front(distant(true)); let distantError = 0, distantChanges = 0;
  for (let y = 24; y < 40; y++) for (let x = 10; x < 13; x++) {
    const a = rimPixel(da, x, y), b = rimPixel(db, x, y); distantError = Math.max(distantError, Math.abs(a[0] - 100)); if (a.some((v, i) => v !== b[i])) distantChanges++;
  }
  say('AS841_DISTANT_NONZERO_FEATHER_IS_BYTE_PRESERVED', distantError > 0 && distantChanges === 0, JSON.stringify({ distantError, distantChanges }));
  // The seed does not authorize a ring pixel over an opaque mismatch.
  const partial = (enabled: boolean) => {
    const input = yieldContourFixture();
    for (let y = 24; y < 40; y++) for (let x = 20; x < 24; x++) input.full.layers[0].pixels.data[(y * 64 + x) * 4] = 0;
    return assemble({ ...input, yieldRefused: enabled });
  };
  const pa = front(partial(false)), pb = front(partial(true)); let mismatchChanges = 0;
  for (let y = 24; y < 40; y++) for (let x = 20; x < 24; x++) if (rimPixel(pa, x, y).some((v, i) => v !== rimPixel(pb, x, y)[i])) mismatchChanges++;
  say('AS841_MATCH_IS_REQUIRED_PER_ACCEPTED_SAMPLE', mismatchChanges === 0 && (partial(true).yieldReadings?.find(r => r.part === 'front')?.finishedProjection ?? 0) > 0, JSON.stringify({ mismatchChanges }));
  const edgeRows = [0, 7, 90, 91].map(drift => {
    const a = front(run(false, { drift })), r = run(true, { drift }), b = front(r);
    let error = 0, rgbChanges = 0, cleared = 0;
    for (let y = 20; y < 44; y++) for (let x = 20; x < 44; x++) {
      if (x >= 24 && x < 40 && y >= 24 && y < 40) continue;
      const aa = rimPixel(a, x, y), bb = rimPixel(b, x, y);
      error = Math.max(error, ...bb.slice(0, 3).map(v => Math.abs(v - 100)));
      if (aa.slice(0, 3).some((v, i) => v !== bb[i])) rgbChanges++;
      if (bb[3] === 0) cleared++;
    }
    return { drift, error, rgbChanges, cleared };
  });
  say('AS841_ACCEPTED_LIMIT_AND_ORIGINAL_REFUSAL_KEEP_DISTINCT_SEMANTICS', edgeRows.every(r => r.drift <= 90 ? r.error === 0 && r.cleared === 0 : r.rgbChanges === 0 && r.cleared === 320), JSON.stringify(edgeRows));

  // These plants enter the actual RGB writer, even if an upstream support
  // collector accidentally includes the protected pixel. (23,32) has residual 27.
  const protectedRows = ['positive', 'keptRetake', 'merge', 'ring', 'derived-piece', 'no-behind', 'not-core', 'not-taken', 'original-refusal', 'soft-alpha', 'not-connected', 'outside-footprint'].map(plant => {
    const f = yieldContourFixture(), images = f.full.layers.map(l => structuredClone(l.pixels));
    const st = projectSource(images, f.source, checkGeometry({ sourceW: 64, sourceH: 64, resolution: 64, headBox: [0, 0, 64, 64], rigScale: 1 }), 'full')[1];
    const q = 32 * 64 + 23, footprint = newMask(64, 64), kept = newMask(64, 64), region = newMask(64, 64), ring = newMask(64, 64), merged = new Int32Array(4096).fill(-1), behind = new Int32Array(4096);
    footprint.data[q] = 1; region.data.fill(1);
    if (plant === 'keptRetake') kept.data[q] = 1;
    if (plant === 'merge') merged[q] = 0;
    if (plant === 'ring') ring.data[q] = 1;
    if (plant === 'derived-piece') region.data[q] = 0;
    if (plant === 'no-behind') behind[q] = -1;
    if (plant === 'not-core') st.coreMask!.data[q] = 0;
    if (plant === 'not-taken') st.takenMask.data[q] = 0;
    if (plant === 'original-refusal') st.refusedMask!.data[q] = 1;
    if (plant === 'soft-alpha') images[1].data[q * 4 + 3] = 249;
    if (plant === 'outside-footprint') footprint.data[q] = 0;
    const before = Array.from(images[1].data.subarray(q * 4, q * 4 + 4)); let writes = 0;
    const finished = finishYieldedProjection(images[1], f.source, st, footprint, new Int32Array(plant === 'not-connected' ? [] : [q]), { kept, region, merged, ring, behind }, () => { writes++; });
    const after = Array.from(images[1].data.subarray(q * 4, q * 4 + 4));
    return { plant, finished, writes, before, after, pass: plant === 'positive' ? finished === 1 && writes === 1 && after[0] === 100 && after[3] === before[3] : finished === 0 && writes === 0 && before.every((v, i) => v === after[i]) };
  });
  say('AS841_FINISH_WRITER_PROTECTS_KEPT_MERGED_RING_AND_DERIVED_SAMPLES', protectedRows.every(r => r.pass), JSON.stringify(protectedRows));
  const records = on.parts.parts;
  const frontProvenance = front(on).record.provenance;
  say('AS841_PROJECTION_PROVENANCE_AND_COUNTS_STILL_PARTITION_OUTPUT', records.every(p => p.provenance !== undefined && provenanceAddsUp(p.provenance, p.opaque_px)) && frontProvenance?.automatic.some(a => a.stage === 'sourceProjection' && a.px >= 140) === true && front(on).record.source_px_taken === front(off).record.source_px_taken && on.yieldReadings?.find(r => r.part === 'front')?.finishedProjection === 140,
    JSON.stringify({ front: frontProvenance, taken: front(on).record.source_px_taken, originalTaken: front(off).record.source_px_taken, yielded: on.yieldReadings?.find(r => r.part === 'front') }));

}

if (import.meta.main) {
  let failures = 0;
  runYieldContourChecks((name, pass, detail) => { console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`); if (!pass) failures++; });
  process.exitCode = failures > 0 ? 1 : 0;
}
