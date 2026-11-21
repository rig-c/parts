/** Generated rectangles expose setup-art and setup-background gaps through the stock gated renderer. */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageRigc, readMotionSeamBackground, motionSeamRequired, type MotionSeamLine, type MotionSeamPair, type MotionCellFrame, type MotionCellSidecar, MOTION_CELLS_FILE, readMotionSeamCellSidecar, publishMotionSeamCells, streamMotionSeamCellSidecar, hashMotionSeamCellSidecar } from '../src/check.ts';
import { checkRow, checkSlotParts, serializeCheckRows } from '../src/checkrow.ts';
import { checkRowSchemaFaults } from './check_row_scope.ts';
import { newRaster } from '../src/raster/types.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { PartsError } from '../src/errors.ts';

type Say = (name: string, ok: boolean, detail: string, why: string) => void;
const animations = ['figure', 'background'];
const pairs: MotionSeamPair[] = [{ pair: 'left|right', a: 'left', b: 'right', declared: ['synthetic split'] }];
const line: MotionSeamLine = { status: 'CLEAR', fps: 12, floor: '', pairs, animations, warnings: 0, rows: [] };

export function renderSeamCellFixture(home: string, cells: boolean): string {
  mkdirSync(join(home, 'images'), { recursive: true });
  const image = newRaster(10, 6);
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 8; x++) image.data.set([80, 140, 200, 255], (y * 10 + x) * 4);
  for (const part of ['left', 'right']) writeFileSync(join(home, 'images', part + '.png'), encodePngBytes(image));
  const rig = { spec: 'rigc-rig/1', name: 'seam_cells', images: 'images', skeleton: { x: -16, y: -8, width: 48, height: 40 },
    bones: [{ name: 'root' }, { name: 'a', parent: 'root' }, { name: 'b', parent: 'root' }],
    slots: [{ name: 'left', bone: 'a', attachment: 'left' }, { name: 'right', bone: 'b', attachment: 'right' }],
    skins: { default: { left: { left: { image: 'left.png', x: 4, y: 2 } }, right: { right: { image: 'right.png', x: 8, y: 2 } } } } };
  writeFileSync(join(home, 'rig.json'), JSON.stringify(rig));
  writeFileSync(join(home, 'motion.json'), JSON.stringify({ spec: 'rigc-motion/1', archetype: 'seam_cells', cut: 'seam_cells', easings: {}, groups: {}, animations: Object.fromEntries(animations.map((name, index) => [name,
    { duration: 1 / 12, loop: false, tracks: ['a', 'b'].map((bone, i) => ({ bone, property: 'translate', keys: [0, 1 / 12].map(t => ({ t, v: [i === 0 ? -8 : 8, index * 20] })) })) }])) }));
  const run = (args: string[]): void => {
    const r = spawnSync(packageRigc(process.cwd()), args, { encoding: 'utf8', timeout: 60000, maxBuffer: 1 << 24 });
    if (r.status !== 0) throw new Error(`seam-cell fixture ${args[0]} exit ${r.status}: ${r.stdout}\n${r.stderr}`);
  };
  run(['build', '--rig', join(home, 'rig.json'), '--motion', join(home, 'motion.json'), '--out', join(home, 'build'), '--profile', 'rig-play', '--pack']);
  const out = join(home, cells ? 'with-cells' : 'without-cells');
  run(['render', '--candidate', join(home, 'build'), '--seam', 'left:right', ...(cells ? ['--seam-cells'] : []), '--fps', '12', '--max', '64', '--out', out]);
  return out;
}

function rawReadings(dir: string): unknown[] {
  const sets = JSON.parse(readFileSync(join(dir, 'frames.json'), 'utf8')) as { sets: Array<{ dir: string }> };
  return sets.sets.map(set => JSON.parse(readFileSync(join(dir, set.dir, 'seam.json'), 'utf8')) as unknown);
}
function withoutCells(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCells);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'cells').map(([key, entry]) => [key, withoutCells(entry)]));
  return value;
}

export function runSeamCellChecks(home: string, say: Say, base: Record<string, unknown> = {}): void {
  const plain = renderSeamCellFixture(home, false), flagged = renderSeamCellFixture(home, true);
  const rig = JSON.parse(readFileSync(join(home, 'rig.json'), 'utf8')) as Record<string, unknown>;
  const slots = checkSlotParts(rig, ['left', 'right']);
  const rows = readMotionSeamBackground(flagged, animations, 12, pairs, slots);
  const oldRows = readMotionSeamBackground(plain, animations, 12, pairs);
  const evidence: MotionCellSidecar = { spec: 'rig-parts-seam-cells/1', frames: [] };
  const errors: import('../src/errors.ts').Problem[] = [], oldErrors: import('../src/errors.ts').Problem[] = [];
  const required = motionSeamRequired(line, rows, 'synthetic requirements', errors, evidence);
  const old = motionSeamRequired(line, oldRows, 'synthetic requirements', oldErrors);
  const baseSeams = base.SEAM_OVER_MOTION !== null && typeof base.SEAM_OVER_MOTION === 'object' ? base.SEAM_OVER_MOTION : {};
  const document = (value: typeof required): Record<string, unknown> => ({ ...base, PASS: false, SEAM_OVER_MOTION: { ...baseSeams, required: value } });
  const report = document(required);
  const frames = evidence.frames;
  const countsHold = JSON.stringify(withoutCells(rawReadings(flagged))) === JSON.stringify(rawReadings(plain)) &&
    rows.every(row => row.hits.length > 0 && row.hits.every(hit => hit.cells?.length === hit.px));
  const classes = animations.map(animation => [...new Set(frames.filter(f => f.animation === animation).flatMap(f => f.cells.map(c => c.class)))]);
  const otherRows = readMotionSeamBackground(flagged, animations, 12, pairs, new Map());
  const rawNames = frames.filter(f => f.animation === 'figure').flatMap(f => f.cells.map(c => c.setupTop));
  say('SO32_OPEN_CELLS_KEEP_COUNTS_AND_CLASSIFY_SETUP_ART_AND_BACKGROUND', countsHold && required.status === 'FAIL' && slots.get('left') === 'left' && slots.get('right') === 'right' &&
    JSON.stringify(classes) === '[["figure"],["background"]]' && rawNames.includes('left') && rawNames.includes('right') &&
    otherRows.find(row => row.animation === 'figure')?.hits.every(hit => hit.cells?.every(cell => cell.class === 'other')) === true &&
    JSON.stringify(errors) === JSON.stringify(oldErrors) &&
    JSON.stringify(required.pairs.map(({ open_frames: _cells, ...p }) => p)) === JSON.stringify(old.pairs),
    JSON.stringify({ countsHold, classes, frames: frames.length, px: frames.map(f => f.px), status: required.status }),
    'Stock gated rectangles split over setup art, then above all setup art. Unknown top slots classify other. Counts, verdict and refusals stay unchanged.');
  const faults = [...checkRowSchemaFaults({ SEAM_OVER_MOTION: { required } }), ...checkRowSchemaFaults(evidence)];
  const planted = { ...evidence, unregistered_copy: frames };
  const unregistered = checkRowSchemaFaults(planted);
  say('SO33_OPEN_CELL_ROWS_REQUIRE_REGISTERED_PATHS', faults.length === 0 && unregistered.some(f => f.includes('unregistered_copy') && f.includes('unregistered object-row path')),
    JSON.stringify({ faults, planted: unregistered.slice(0, 2) }),
    'Inline frame rows and both sidecar arrays carry registered provenance. A copied sidecar frame/cell array at an unregistered path refuses.');
  const sets = JSON.parse(readFileSync(join(flagged, 'frames.json'), 'utf8')) as { sets: Array<{ dir: string }> };
  const path = join(flagged, sets.sets[0].dir, 'seam.json'), original = readFileSync(path, 'utf8');
  const refusal = (kind: 'gapOpen' | 'gapCovered', worst: boolean, missing: boolean): boolean => {
    const doc = JSON.parse(original) as { pairs: Array<Record<'gapOpen' | 'gapCovered', { frames: Array<Record<string, unknown>>; worst: Record<string, unknown> | null }>> };
    const hit = structuredClone(doc.pairs[0].gapOpen.frames[0]);
    if (missing) delete hit.cells;
    else hit.cells = [];
    if (worst) doc.pairs[0][kind].worst = hit;
    else doc.pairs[0][kind].frames[0] = hit;
    writeFileSync(path, JSON.stringify(doc));
    try { readMotionSeamBackground(flagged, animations, 12, pairs, slots); return false; }
    catch (error) { return error instanceof PartsError && error.problems.some(p => p.code === 'FRAMES_SIDECAR' && p.detail.includes('cells.length === px')); }
    finally { writeFileSync(path, original); }
  };
  const plants = (['gapOpen', 'gapCovered'] as const).flatMap(kind => [false, true].flatMap(worst => [false, true].map(missing => ({ kind, worst, missing, refused: refusal(kind, worst, missing) }))));
  say('SO34_REQUESTED_CELLS_MISSING_OR_COUNT_MISMATCH_ARE_REFUSED', plants.every(p => p.refused) && readFileSync(path, 'utf8') === original,
    JSON.stringify({ plants: plants.length, refused: plants.filter(p => p.refused).length, restored: readFileSync(path, 'utf8') === original }),
    'Missing and unequal cells refuse for frame/worst in open/covered hits. Original sidecar bytes are restored.');

  const published = join(home, 'published');
  mkdirSync(published, { recursive: true });
  const check = join(published, 'check.json'), cellPath = join(published, MOTION_CELLS_FILE);
  const publish = (): void => publishMotionSeamCells(published, required, evidence, () => writeFileSync(check, serializeCheckRows(report)));
  publish();
  const firstCheck = readFileSync(check, 'utf8'), firstCells = readFileSync(cellPath, 'utf8');
  const repeat: MotionCellSidecar = { spec: 'rig-parts-seam-cells/1', frames: [] };
  const repeated = motionSeamRequired(line, readMotionSeamBackground(renderSeamCellFixture(home, true), animations, 12, pairs, slots), 'synthetic requirements', [], repeat);
  publishMotionSeamCells(published, repeated, repeat, () => writeFileSync(check, serializeCheckRows(document(repeated))));
  const deterministic = firstCheck === readFileSync(check, 'utf8') && firstCells === readFileSync(cellPath, 'utf8');
  const sidecarRefuses = (block: typeof required, fragment: string): boolean => {
    try { readMotionSeamCellSidecar(published, block); return false; }
    catch (error) { return error instanceof PartsError && error.problems.some(p => p.code === 'FRAMES_SIDECAR' && p.detail.includes(fragment)); }
  };
  const mismatch = structuredClone(required);
  if (mismatch.pairs[0].open_frames?.[0]) mismatch.pairs[0].open_frames[0].classes.background++;
  const countsRefused = sidecarRefuses(mismatch, 'must sum to gapOpen px');
  writeFileSync(cellPath, firstCells + '\n');
  const digestRefused = sidecarRefuses(required, 'SHA-256');
  rmSync(cellPath);
  const missingRefused = sidecarRefuses(required, 'missing or unreadable');
  writeFileSync(cellPath, firstCells);
  say('SO35_SIDECAR_PARTITIONS_DIGEST_AND_MISSING_FILE_REFUSE', countsRefused && digestRefused && missingRefused,
    JSON.stringify({ countsRefused, digestRefused, missingRefused }),
    'Inline class counts sum to the same gapOpen px and match the sidecar. Missing or changed cell evidence is FRAMES_SIDECAR, never a fallback.');
  let rolledBack = false;
  try { publishMotionSeamCells(published, required, evidence, () => { writeFileSync(check, 'partial'); throw new Error('planted publication failure'); }); }
  catch (error) { rolledBack = error instanceof Error && error.message === 'planted publication failure'; }
  const restored = readFileSync(check, 'utf8') === firstCheck && readFileSync(cellPath, 'utf8') === firstCells;
  publishMotionSeamCells(published, old, { spec: 'rig-parts-seam-cells/1', frames: [] }, () => writeFileSync(check, serializeCheckRows(document(old))));
  const absentWhenNotRequested = !existsSync(cellPath);
  publish();
  say('SO36_SIDECAR_PUBLICATION_IS_DETERMINISTIC_AND_ROLLS_BACK', deterministic && rolledBack && restored && absentWhenNotRequested,
    JSON.stringify({ deterministic, rolledBack, restored, absentWhenNotRequested }),
    'A fresh render publishes identical bytes; failed publication restores both old files. A rerun without requested cells removes its stale sidecar.');

  const cells500 = Array.from({ length: 500 }, (_, i) => ({ ...checkRow('seam_cells.frames[].cells', 'rig', false, []),
    x: i % 25 + 0.5, y: 19.5 - Math.floor(i / 25), setupTop: null, setupUnder: null, class: 'background' as const }));
  const sizeFor = (count: number): { check: number; sidecar: number; without: number } => {
    const sample: MotionCellSidecar = { spec: 'rig-parts-seam-cells/1', frames: [] };
    const hits = Array.from({ length: count }, (_, index) => ({ index, time: index / 12, px: 500, cell: 1, box: [0, 0, 25, 20] as [number, number, number, number], cells: cells500 }));
    const sampleRows = [{ pair: pairs[0].pair, animation: 'idle', frames: 49, drawn: 49, banded: 49, status: 'read' as const, hits }];
    const sampleLine = { ...line, animations: ['idle'] };
    const block = motionSeamRequired(sampleLine, sampleRows, 'synthetic requirements', [], sample);
    const noCells = motionSeamRequired(sampleLine, sampleRows.map(row => ({ ...row, hits: row.hits.map(({ cells: _cells, ...hit }) => hit) })), 'synthetic requirements', []);
    const out = join(home, 'plant-' + count);
    mkdirSync(out, { recursive: true });
    publishMotionSeamCells(out, block, sample, () => writeFileSync(join(out, 'check.json'), serializeCheckRows(document(block))));
    return { check: Buffer.byteLength(readFileSync(join(out, 'check.json'))), sidecar: Buffer.byteLength(readFileSync(join(out, MOTION_CELLS_FILE))), without: Buffer.byteLength(serializeCheckRows(document(noCells))) };
  };
  const sizes = { single500: sizeFor(1), sustained49x500: sizeFor(49) };
  say('SO37_SUSTAINED_CELL_ARRAYS_STAY_OUT_OF_CHECK_JSON', sizes.sustained49x500.check - sizes.sustained49x500.without < 1_000_000 && sizes.sustained49x500.sidecar > 1_000_000,
    JSON.stringify(sizes), 'Actual writer/reader publication measures 49 frames of 500 cells. Counts stay inline and the full arrays are in the digest-bound sidecar.');

  const emptyCellsFrame: MotionCellFrame = {
    ...checkRow('seam_cells.frames', 'pair', false, ['left', 'right']),
    pair: 'left|right', animation: 'idle', index: 0, time: 0, px: 0, cell: 1, box: [0, 0, 10, 6], cells: [],
  };
  const secondPairFrame: MotionCellFrame = {
    ...checkRow('seam_cells.frames', 'pair', false, ['upper', 'lower']),
    pair: 'upper|lower', animation: 'idle', index: 3, time: 0.25, px: 2, cell: 0.5, box: [-4, -2, 8, 6],
    cells: [
      { ...checkRow('seam_cells.frames[].cells', 'part', false, ['upper']), x: 0.25, y: 1.75, setupTop: 'upper', setupUnder: 'lower', class: 'figure' },
      { ...checkRow('seam_cells.frames[].cells', 'rig', false, []), x: 0.75, y: 1.75, setupTop: 'unmapped', setupUnder: null, class: 'other' },
    ],
  };
  const identityDocs: ReadonlyArray<readonly [string, MotionCellSidecar]> = [
    ['empty_frames', { spec: 'rig-parts-seam-cells/1', frames: [] }],
    ['empty_cells_frame', { spec: 'rig-parts-seam-cells/1', frames: [emptyCellsFrame] }],
    ['one_frame', { spec: 'rig-parts-seam-cells/1', frames: [frames[0]] }],
    ['multi_frame_pairs', { spec: 'rig-parts-seam-cells/1', frames: [...frames, secondPairFrame] }],
  ];
  const identityResults = identityDocs.map(([label, doc]) => {
    const whole = serializeCheckRows(doc);
    const wholeSha = createHash('sha256').update(whole).digest('hex');
    const chunks: string[] = [];
    streamMotionSeamCellSidecar(doc, c => chunks.push(c));
    const streamed = chunks.join('');
    const streamedSha = hashMotionSeamCellSidecar(doc);
    const droppedSha = createHash('sha256').update(chunks.slice(1).join('')).digest('hex');
    return { label, bytesEqual: streamed === whole, shaEqual: streamedSha === wholeSha, droppedDiffers: droppedSha !== wholeSha, bytes: Buffer.byteLength(whole), sha256: streamedSha };
  });
  say('SCS01_STREAMED_SIDECAR_MATCHES_SERIALIZE_CHECK_ROWS_BYTES_AND_SHA256',
    identityResults.every(r => r.bytesEqual && r.shaEqual && r.droppedDiffers),
    JSON.stringify(identityResults.map(({ label, bytesEqual, shaEqual, bytes }) => ({ label, bytesEqual, shaEqual, bytes }))),
    'Streamed sidecar chunks and SHA-256 equal whole-string serializeCheckRows across empty-frames, empty-cells, single-frame and multi-pair documents.');

  const boundedPairs: MotionSeamPair[] = [
    { pair: 'left|right', a: 'left', b: 'right', declared: ['synthetic split'] },
    { pair: 'upper|lower', a: 'upper', b: 'lower', declared: ['synthetic split 2'] },
  ];
  const boundedLine: MotionSeamLine = { status: 'CLEAR', fps: 12, floor: '', pairs: boundedPairs, animations: ['figure', 'background'], warnings: 0, rows: [] };
  const boundedCounts = [1, 3, 2, 4] as const;
  const boundedRows = [
    {
      pair: 'left|right', animation: 'figure', frames: 2, drawn: 2, banded: 2, status: 'read' as const,
      hits: [0, 1].map(idx => ({ index: idx, time: idx / 12, px: boundedCounts[idx], cell: 1, box: [0, 0, 10, 6] as [number, number, number, number], cells: cells500.slice(0, boundedCounts[idx]) })),
    },
    {
      pair: 'upper|lower', animation: 'background', frames: 2, drawn: 2, banded: 2, status: 'read' as const,
      hits: [0, 1].map(idx => ({ index: idx, time: idx / 12, px: boundedCounts[idx + 2], cell: 1, box: [0, 0, 12, 8] as [number, number, number, number], cells: cells500.slice(0, boundedCounts[idx + 2]) })),
    },
  ];
  const boundedEvidence: MotionCellSidecar = { spec: 'rig-parts-seam-cells/1', frames: [] };
  const boundedRequired = motionSeamRequired(boundedLine, boundedRows, 'synthetic requirements', [], boundedEvidence);
  const sinkChunks: string[] = [];
  streamMotionSeamCellSidecar(boundedEvidence, c => sinkChunks.push(c));
  const chunkByteLengths = sinkChunks.map(c => Buffer.byteLength(c));
  const expectedHeadBytes = Buffer.byteLength(`{\n "spec": ${JSON.stringify(boundedEvidence.spec)},\n "frames": [\n`);
  const expectedTailBytes = Buffer.byteLength(' ]\n}\n');
  const expectedFrameChunkBytes = boundedEvidence.frames.map((frame, i) =>
    Buffer.byteLength(`  ${JSON.stringify(frame, null, 1).replaceAll('\n', '\n  ')}${i + 1 < boundedEvidence.frames.length ? ',\n' : '\n'}`));
  const expectedMaxChunkBytes = Math.max(...expectedFrameChunkBytes);
  const expectedTotalBytes = expectedHeadBytes + expectedFrameChunkBytes.reduce((a, b) => a + b, 0) + expectedTailBytes;
  const maxChunkBytes = Math.max(...chunkByteLengths);
  const totalStreamedBytes = chunkByteLengths.reduce((a, b) => a + b, 0);
  const boundedDir = join(home, 'bounded');
  mkdirSync(boundedDir, { recursive: true });
  publishMotionSeamCells(boundedDir, boundedRequired, boundedEvidence, () => writeFileSync(join(boundedDir, 'check.json'), serializeCheckRows(document(boundedRequired))));
  const straddledRead = readMotionSeamCellSidecar(boundedDir, boundedRequired, 17);
  const straddledCells = straddledRead?.frames.map(f => f.cells.length) ?? [];
  const missingCellDoc: MotionCellSidecar = {
    spec: 'rig-parts-seam-cells/1',
    frames: boundedEvidence.frames.map((f, i) => (i === 1 ? { ...f, cells: f.cells.slice(0, f.cells.length - 1) } : f)),
  };
  const missingCellDir = join(home, 'bounded-missing-cell');
  mkdirSync(missingCellDir, { recursive: true });
  writeFileSync(join(missingCellDir, MOTION_CELLS_FILE), serializeCheckRows(missingCellDoc));
  const missingCellReq = { ...boundedRequired, cells: { path: MOTION_CELLS_FILE, sha256: hashMotionSeamCellSidecar(missingCellDoc) } };
  let missingCellRefused = false;
  try { readMotionSeamCellSidecar(missingCellDir, missingCellReq); }
  catch (error) { missingCellRefused = error instanceof PartsError && error.problems.some(p => p.code === 'FRAMES_SIDECAR' && p.detail.includes('cells.length === gapOpen px')); }
  const nonCanonicalText = JSON.stringify(boundedEvidence);
  const nonCanonicalDir = join(home, 'bounded-noncanonical');
  mkdirSync(nonCanonicalDir, { recursive: true });
  writeFileSync(join(nonCanonicalDir, MOTION_CELLS_FILE), nonCanonicalText);
  const nonCanonicalReq = { ...boundedRequired, cells: { path: MOTION_CELLS_FILE, sha256: createHash('sha256').update(nonCanonicalText).digest('hex') } };
  let layoutDepartureRefused = false;
  try { readMotionSeamCellSidecar(nonCanonicalDir, nonCanonicalReq); }
  catch (error) { layoutDepartureRefused = error instanceof PartsError && error.problems.some(p => p.code === 'FRAMES_SIDECAR' && p.detail.includes('requires canonical rig-parts-seam-cells/1 streamed frame layout')); }
  say('SCS02_STREAMED_CHUNKS_ARE_BOUNDED_BY_ONE_FRAME_AND_READER_REFUSES_LAYOUT_OR_CELL_COUNT_DEPARTURES',
    sinkChunks.length === boundedEvidence.frames.length + 2 &&
      chunkByteLengths[0] === 50 && chunkByteLengths[0] === expectedHeadBytes &&
      chunkByteLengths[chunkByteLengths.length - 1] === 5 && chunkByteLengths[chunkByteLengths.length - 1] === expectedTailBytes &&
      JSON.stringify(chunkByteLengths.slice(1, -1)) === JSON.stringify(expectedFrameChunkBytes) &&
      maxChunkBytes === expectedMaxChunkBytes && totalStreamedBytes === expectedTotalBytes && maxChunkBytes < totalStreamedBytes / 2 &&
      JSON.stringify(straddledCells) === '[1,3,2,4]' && missingCellRefused && layoutDepartureRefused,
    JSON.stringify({ chunks: sinkChunks.length, chunkByteLengths, maxChunkBytes, totalStreamedBytes, straddledCells, missingCellRefused, layoutDepartureRefused }),
    'Sink receives head (50 B), one chunk per frame bounded by the single largest frame, and tail (5 B). Chunk-straddled reader loads frame cells on demand and refuses missing cells or non-canonical layouts.');

  const midFreshDir = join(home, 'mid-stream-fresh');
  mkdirSync(midFreshDir, { recursive: true });
  const midFreshCheck = join(midFreshDir, 'check.json'), midFreshCells = join(midFreshDir, MOTION_CELLS_FILE);
  writeFileSync(midFreshCheck, firstCheck);
  let midFreshPartialBytes = 0, midFreshThrew = false;
  try {
    publishMotionSeamCells(midFreshDir, boundedRequired, boundedEvidence, () => { writeFileSync(midFreshCheck, 'should-not-run'); }, (_chunk, index) => {
      if (index === 1) {
        midFreshPartialBytes = statSync(midFreshCells).size;
        throw new Error('planted mid-stream sidecar failure');
      }
    });
  } catch (error) {
    midFreshThrew = error instanceof Error && error.message === 'planted mid-stream sidecar failure';
  }
  const midFreshNoPartialSidecar = !existsSync(midFreshCells) && readFileSync(midFreshCheck, 'utf8') === firstCheck;
  let midExistingPartialBytes = 0, midExistingThrew = false;
  try {
    publishMotionSeamCells(published, boundedRequired, boundedEvidence, () => { writeFileSync(check, 'should-not-run'); }, (_chunk, index) => {
      if (index === 1) {
        midExistingPartialBytes = statSync(cellPath).size;
        throw new Error('planted mid-stream overwrite failure');
      }
    });
  } catch (error) {
    midExistingThrew = error instanceof Error && error.message === 'planted mid-stream overwrite failure';
  }
  const midExistingRestored = readFileSync(cellPath, 'utf8') === firstCells && readFileSync(check, 'utf8') === firstCheck;
  say('SCS03_MID_STREAM_WRITE_FAILURE_LEAVES_NO_PARTIAL_SIDECAR_AND_ROLLS_BACK',
    midFreshThrew && midFreshPartialBytes > 50 && midFreshPartialBytes < expectedTotalBytes && midFreshNoPartialSidecar &&
      midExistingThrew && midExistingPartialBytes > 50 && midExistingPartialBytes < expectedTotalBytes && midExistingRestored,
    JSON.stringify({ midFreshPartialBytes, midFreshNoPartialSidecar, midExistingPartialBytes, midExistingRestored }),
    'A write failure after streaming the first frame removes the partial sidecar when none existed and restores both files when one did.');

  writeFileSync(join(home, 'measurements.json'), JSON.stringify({ sizes, classes, countsHold, raw: withoutCells(rawReadings(flagged)), required }, null, 1) + '\n');
}

if (import.meta.main) {
  const home = process.argv[2];
  if (!home) throw new Error('provide fixture output directory');
  if (process.argv.includes('--raw')) {
    const out = renderSeamCellFixture(home, false);
    writeFileSync(join(home, 'raw.json'), JSON.stringify(rawReadings(out), null, 1) + '\n');
  } else {
    let failed = 0;
    const baseAt = process.argv.indexOf('--base');
    const base = baseAt < 0 ? {} : JSON.parse(readFileSync(process.argv[baseAt + 1], 'utf8')) as Record<string, unknown>;
    runSeamCellChecks(home, (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); if (!ok) failed++; }, base);
    process.exitCode = failed === 0 ? 0 : 1;
  }
}
