/** Generated controls for rig-parts diff-drafts (issue #1369); no consumer data. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pngChunk } from '@rig-c/core/plate';
import { recomposite, type PlacedPart } from '../src/assemble.ts';
import {
  DIFF_DRAFTS_SPEC,
  diffDraftsCommand,
  measureDiffDrafts,
  serializeDiffDrafts,
  type DiffDraftsReport,
} from '../src/diffdrafts.ts';
import { PartsError } from '../src/errors.ts';
import { type PartRecord, type PartsFile, writeParts } from '../src/parts.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';

type Say = (name: string, pass: boolean, detail: string) => void;

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function caught(fn: () => unknown): PartsError | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof PartsError ? err : null;
  }
}

function filledRaster(w: number, h: number, rgba: readonly [number, number, number, number]): Raster {
  const r = newRaster(w, h);
  for (let i = 0; i < w * h; i++) r.data.set(rgba, i * 4);
  return r;
}

function makePartRecord(name: string, from: string, x: number, y: number, w: number, h: number, image: Raster): PartRecord {
  let opaquePx = 0;
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > 8) opaquePx++;
  return {
    name,
    from,
    x,
    y,
    w,
    h,
    opaque_px: opaquePx,
    visible_px: opaquePx,
    occluded_px: 0,
    projected_core_px: opaquePx,
    source_px_taken: opaquePx,
    visible_not_projected_px: 0,
    refused_drift_px: 0,
    merged_px: 0,
    seam_override_px: 0,
  };
}

interface SyntheticPartSpec {
  name: string;
  from: string;
  x: number;
  y: number;
  w: number;
  h: number;
  image: Raster;
  rawBytes?: Uint8Array;
}

function writeDraftDirectory(
  dir: string,
  layout: 'build' | 'assemble',
  rigSize: [number, number],
  specs: readonly SyntheticPartSpec[],
): { partsSha256: string; partHashes: Map<string, string> } {
  const baseDir = layout === 'build' ? dir : join(dir, 'rig');
  const partsDir = join(baseDir, 'parts');
  const renderDir = layout === 'build' ? dir : join(dir, 'render');
  mkdirSync(partsDir, { recursive: true });
  mkdirSync(renderDir, { recursive: true });

  const placed: PlacedPart[] = [];
  const records: PartRecord[] = [];
  const partHashes = new Map<string, string>();

  for (const s of specs) {
    const record = makePartRecord(s.name, s.from, s.x, s.y, s.w, s.h, s.image);
    records.push(record);
    placed.push({ record, image: s.image });
    const bytes = s.rawBytes ?? encodePngBytes(s.image);
    writeFileSync(join(partsDir, `${s.name}.png`), bytes);
    partHashes.set(s.name, sha256(bytes));
  }

  const file: PartsFile = {
    rig_size: rigSize,
    scale_rig_per_source: 1,
    parts: records,
    ghost_px: {},
  };
  const partsJsonPath = join(baseDir, 'parts.json');
  writeParts(partsJsonPath, file);
  const partsSha256 = sha256(new Uint8Array(readFileSync(partsJsonPath)));

  const comp = recomposite(placed, rigSize[0], rigSize[1]);
  writeFileSync(join(renderDir, 'recomposite_rig.png'), encodePngBytes(comp));

  return { partsSha256, partHashes };
}

/** Insert a valid ancillary tEXt chunk before the 12-byte IEND chunk so file bytes differ while decoded RGBA pixels match. */
function reencodePngWithAncillaryChunk(pngBytes: Uint8Array): Uint8Array {
  const textChunk = pngChunk('tEXt', new TextEncoder().encode('Comment\0re-encoded'));
  const iendOffset = pngBytes.length - 12;
  const out = new Uint8Array(pngBytes.length + textChunk.length);
  out.set(pngBytes.subarray(0, iendOffset), 0);
  out.set(textChunk, iendOffset);
  out.set(pngBytes.subarray(iendOffset), iendOffset + textChunk.length);
  return out;
}

function baseDraftSpecs(): SyntheticPartSpec[] {
  return [
    { name: 'back', from: 'full:back hair', x: 2, y: 2, w: 6, h: 4, image: filledRaster(6, 4, [20, 40, 200, 255]) },
    { name: 'face', from: 'head:face', x: 6, y: 4, w: 5, h: 5, image: filledRaster(5, 5, [240, 200, 180, 255]) },
    { name: 'hair', from: 'head:front hair', x: 12, y: 3, w: 4, h: 6, image: filledRaster(4, 6, [220, 30, 50, 255]) },
  ];
}

export function runDiffDraftChecks(dir: string, say: Say): void {
  const root = join(dir, 'diff-drafts-unit');
  mkdirSync(root, { recursive: true });

  const leftAssemble = join(root, 'left-assemble');
  const rightBuild = join(root, 'right-build');
  const leftMeta = writeDraftDirectory(leftAssemble, 'assemble', [20, 16], baseDraftSpecs());
  const rightMeta = writeDraftDirectory(rightBuild, 'build', [20, 16], baseDraftSpecs());

  // 1. Two identical outputs (across assemble layout and build layout) and deterministic repeat bytes.
  const outIdenticalA = join(root, 'identical-a.json');
  const outIdenticalB = join(root, 'identical-b.json');
  const repA = diffDraftsCommand(['--left', leftAssemble, '--right', rightBuild, '--out', outIdenticalA]);
  const repB = diffDraftsCommand(['--left', rightBuild, '--right', leftAssemble, '--out', outIdenticalB]);
  const bytesA = readFileSync(outIdenticalA, 'utf8');
  const bytesB = readFileSync(outIdenticalB, 'utf8');
  const identicalOk =
    repA.spec === DIFF_DRAFTS_SPEC &&
    Object.keys(repA).join(',') === 'spec,left,right,canvas,order,parts,composite,summary' &&
    repA.left.parts_sha256 === leftMeta.partsSha256 &&
    repA.left.part_count === 3 &&
    repA.right.parts_sha256 === rightMeta.partsSha256 &&
    repA.right.part_count === 3 &&
    JSON.stringify(repA.canvas) === '{"width":20,"height":16}' &&
    repA.order === 'same' &&
    JSON.stringify(repA.summary) === '{"same":3,"changed":0,"added":0,"removed":0}' &&
    JSON.stringify(repA.composite) === '{"changed_px":0,"colour_px":0,"alpha_px":0,"bounds":null}' &&
    repA.parts.map((p) => p.name).join(',') === 'back,face,hair' &&
    repA.parts.every(
      (p) =>
        p.status === 'same' &&
        p.left !== undefined &&
        p.right !== undefined &&
        p.left.sha256 === leftMeta.partHashes.get(p.name) &&
        p.right.sha256 === rightMeta.partHashes.get(p.name) &&
        JSON.stringify(p.left.box) === JSON.stringify(p.right.box) &&
        p.left.index === p.right.index &&
        !('pixels' in p) &&
        !('pixels_equal' in p),
    ) &&
    bytesA === bytesB &&
    serializeDiffDrafts(repA) === bytesA &&
    !bytesA.includes(root);
  say(
    'AS1369_01_IDENTICAL_OUTPUTS_REPORT_EVERY_PART_SAME_ZERO_PIXELS_AND_DETERMINISTIC_BYTES',
    identicalOk,
    `order=${repA.order}, summary=${JSON.stringify(repA.summary)}, composite=${JSON.stringify(repA.composite)}, bytesEqual=${bytesA === bytesB}`,
  );

  // 2. Planted one-part repaint edit of 5 pixels on "hair" (x=12, y=3, w=4, h=6):
  //    - 3 pure-colour edits at crop (1,1)->rig(13,4), (2,1)->rig(14,4), (1,2)->rig(13,5)
  //    - 1 pure-alpha edit at crop (3,4)->rig(15,7)
  //    - 1 colour+alpha edit at crop (2,4)->rig(14,7)
  //    Expected: changed_px=5, colour_px=4, alpha_px=2, bounds={x:13, y:4, w:3, h:4}, pixels_equal=false.
  const repaintedSpecs = baseDraftSpecs();
  const hairSpec = repaintedSpecs[2];
  const setHairPixel = (cx: number, cy: number, rgba: readonly [number, number, number, number]): void => {
    hairSpec.image.data.set(rgba, (cy * hairSpec.w + cx) * 4);
  };
  setHairPixel(1, 1, [10, 30, 50, 255]);
  setHairPixel(2, 1, [220, 90, 50, 255]);
  setHairPixel(1, 2, [220, 30, 120, 255]);
  setHairPixel(3, 4, [220, 30, 50, 128]);
  setHairPixel(2, 4, [100, 100, 100, 200]);
  const rightRepaint = join(root, 'right-repaint');
  writeDraftDirectory(rightRepaint, 'build', [20, 16], repaintedSpecs);
  const outRepaint = join(root, 'repaint.json');
  const repRepaint = diffDraftsCommand(['--left', leftAssemble, '--right', rightRepaint, '--out', outRepaint]);
  const hairRepaint = repRepaint.parts.find((p) => p.name === 'hair');
  const wantRepaintPixels = { changed_px: 5, colour_px: 4, alpha_px: 2, bounds: { x: 13, y: 4, w: 3, h: 4 } };
  // recomposite composites over opaque white [255,255,255,255], so the pure-alpha edit at (15,7) blends with white and changes composite RGB while composite alpha stays 255 everywhere.
  const wantRepaintComposite = { changed_px: 5, colour_px: 5, alpha_px: 0, bounds: { x: 13, y: 4, w: 3, h: 4 } };
  const repaintOk =
    JSON.stringify(repRepaint.summary) === '{"same":2,"changed":1,"added":0,"removed":0}' &&
    repRepaint.parts.filter((p) => p.name !== 'hair').every((p) => p.status === 'same' && !('pixels' in p) && !('pixels_equal' in p)) &&
    hairRepaint?.status === 'changed' &&
    hairRepaint.pixels_equal === false &&
    JSON.stringify(hairRepaint.left?.box) === '{"x":12,"y":3,"w":4,"h":6}' &&
    JSON.stringify(hairRepaint.right?.box) === '{"x":12,"y":3,"w":4,"h":6}' &&
    JSON.stringify(hairRepaint.pixels) === JSON.stringify(wantRepaintPixels) &&
    JSON.stringify(repRepaint.composite) === JSON.stringify(wantRepaintComposite);
  say(
    'AS1369_02_PLANTED_ONE_PART_REPAINT_SPLITS_COLOUR_AND_ALPHA_WITH_HAND_BOUNDS',
    repaintOk,
    `hair=${JSON.stringify({ status: hairRepaint?.status, pixels_equal: hairRepaint?.pixels_equal, pixels: hairRepaint?.pixels })}, composite=${JSON.stringify(repRepaint.composite)}`,
  );

  // 3. Re-encoded part (different PNG sha256, identical decoded RGBA pixels and box -> changed, pixels_equal: true, 0 px)
  //    and moved part with same art (same PNG sha256, box x 12 -> 14 -> changed, pixels_equal: true, 24 changed_px).
  const reencodedSpecs = baseDraftSpecs();
  reencodedSpecs[2] = { ...reencodedSpecs[2], rawBytes: reencodePngWithAncillaryChunk(encodePngBytes(reencodedSpecs[2].image)) };
  const rightReencoded = join(root, 'right-reencoded');
  writeDraftDirectory(rightReencoded, 'build', [20, 16], reencodedSpecs);
  const repReencoded = diffDraftsCommand(['--left', leftAssemble, '--right', rightReencoded, '--out', join(root, 'reencoded.json')]);
  const hairReencoded = repReencoded.parts.find((p) => p.name === 'hair');

  const movedSpecs = baseDraftSpecs();
  movedSpecs[2] = { ...movedSpecs[2], x: 14 };
  const rightMoved = join(root, 'right-moved');
  writeDraftDirectory(rightMoved, 'build', [20, 16], movedSpecs);
  const repMoved = diffDraftsCommand(['--left', leftAssemble, '--right', rightMoved, '--out', join(root, 'moved.json')]);
  const hairMoved = repMoved.parts.find((p) => p.name === 'hair');
  const wantMovedPixels = { changed_px: 24, colour_px: 24, alpha_px: 24, bounds: { x: 12, y: 3, w: 6, h: 6 } };
  const wantMovedComposite = { changed_px: 24, colour_px: 24, alpha_px: 0, bounds: { x: 12, y: 3, w: 6, h: 6 } };

  const reencodedAndMovedOk =
    hairReencoded?.status === 'changed' &&
    hairReencoded.left?.sha256 !== hairReencoded.right?.sha256 &&
    hairReencoded.pixels_equal === true &&
    JSON.stringify(hairReencoded.pixels) === '{"changed_px":0,"colour_px":0,"alpha_px":0,"bounds":null}' &&
    hairMoved?.status === 'changed' &&
    hairMoved.left?.sha256 === hairMoved.right?.sha256 &&
    JSON.stringify(hairMoved.left?.box) === '{"x":12,"y":3,"w":4,"h":6}' &&
    JSON.stringify(hairMoved.right?.box) === '{"x":14,"y":3,"w":4,"h":6}' &&
    hairMoved.pixels_equal === true &&
    JSON.stringify(hairMoved.pixels) === JSON.stringify(wantMovedPixels) &&
    JSON.stringify(repMoved.composite) === JSON.stringify(wantMovedComposite);
  say(
    'AS1369_03_REENCODED_AND_MOVED_PARTS_REPORT_PIXELS_EQUAL_TRUE_WITH_HAND_COUNTS',
    reencodedAndMovedOk,
    `reencoded=${JSON.stringify({ status: hairReencoded?.status, pixels_equal: hairReencoded?.pixels_equal, pixels: hairReencoded?.pixels })}, moved=${JSON.stringify({ status: hairMoved?.status, leftBox: hairMoved?.left?.box, rightBox: hairMoved?.right?.box, pixels_equal: hairMoved?.pixels_equal, pixels: hairMoved?.pixels })}`,
  );

  // 4. Added part, removed part, and changed draw order.
  const baseSpecs = baseDraftSpecs();
  const addedRemovedSpecs: SyntheticPartSpec[] = [
    baseSpecs[1], // face at index 0 (was 1)
    baseSpecs[2], // hair at index 1 (was 2)
    { name: 'ribbon', from: 'head:headwear', x: 1, y: 12, w: 3, h: 2, image: filledRaster(3, 2, [250, 220, 40, 255]) }, // added at index 2
  ];
  const rightAddedRemoved = join(root, 'right-added-removed');
  writeDraftDirectory(rightAddedRemoved, 'assemble', [20, 16], addedRemovedSpecs);
  const repAddRem = diffDraftsCommand(['--left', leftAssemble, '--right', rightAddedRemoved, '--out', join(root, 'add-rem.json')]);
  const backRow = repAddRem.parts.find((p) => p.name === 'back');
  const faceRow = repAddRem.parts.find((p) => p.name === 'face');
  const ribbonRow = repAddRem.parts.find((p) => p.name === 'ribbon');

  const reorderedSpecs: SyntheticPartSpec[] = [baseSpecs[0], baseSpecs[2], baseSpecs[1]];
  const rightReordered = join(root, 'right-reordered');
  writeDraftDirectory(rightReordered, 'build', [20, 16], reorderedSpecs);
  const repReorder = diffDraftsCommand(['--left', leftAssemble, '--right', rightReordered, '--out', join(root, 'reordered.json')]);

  const addRemOrderOk =
    repAddRem.order === 'changed' &&
    JSON.stringify(repAddRem.summary) === '{"same":2,"changed":0,"added":1,"removed":1}' &&
    repAddRem.parts.map((p) => p.name).join(',') === 'back,face,hair,ribbon' &&
    backRow?.status === 'removed' &&
    JSON.stringify(backRow.left?.box) === '{"x":2,"y":2,"w":6,"h":4}' &&
    backRow.left?.index === 0 &&
    !('right' in backRow) &&
    !('pixels' in backRow) &&
    !('pixels_equal' in backRow) &&
    faceRow?.status === 'same' &&
    faceRow.left?.index === 1 &&
    faceRow.right?.index === 0 &&
    JSON.stringify(faceRow.left?.box) === '{"x":6,"y":4,"w":5,"h":5}' &&
    JSON.stringify(faceRow.right?.box) === '{"x":6,"y":4,"w":5,"h":5}' &&
    ribbonRow?.status === 'added' &&
    JSON.stringify(ribbonRow.right?.box) === '{"x":1,"y":12,"w":3,"h":2}' &&
    ribbonRow.right?.index === 2 &&
    !('left' in ribbonRow) &&
    !('pixels' in ribbonRow) &&
    !('pixels_equal' in ribbonRow) &&
    repReorder.order === 'changed' &&
    JSON.stringify(repReorder.summary) === '{"same":3,"changed":0,"added":0,"removed":0}' &&
    repReorder.parts.find((p) => p.name === 'face')?.left?.index === 1 &&
    repReorder.parts.find((p) => p.name === 'face')?.right?.index === 2 &&
    repReorder.parts.find((p) => p.name === 'hair')?.left?.index === 2 &&
    repReorder.parts.find((p) => p.name === 'hair')?.right?.index === 1;
  say(
    'AS1369_04_ADDED_REMOVED_AND_REORDERED_PARTS_CARRY_SIDE_BOXES_AND_INDICES',
    addRemOrderOk,
    `addRem=${JSON.stringify({ order: repAddRem.order, summary: repAddRem.summary, back: backRow, ribbon: ribbonRow })}, reorder=${JSON.stringify({ order: repReorder.order, summary: repReorder.summary })}`,
  );

  // 5. Planted refusals: missing parts.json, ambiguous layout, canvas mismatch, --out exists, --out inside input, and multi-problem collection.
  const emptyDir = join(root, 'empty-dir');
  mkdirSync(emptyDir, { recursive: true });
  const otherCanvasDir = join(root, 'other-canvas');
  writeDraftDirectory(otherCanvasDir, 'build', [24, 16], baseDraftSpecs());
  const bothLayoutsDir = join(root, 'both-layouts');
  writeDraftDirectory(bothLayoutsDir, 'build', [20, 16], baseDraftSpecs());
  writeDraftDirectory(bothLayoutsDir, 'assemble', [20, 16], baseDraftSpecs());

  const missingPartsErr = caught(() => diffDraftsCommand(['--left', emptyDir, '--right', rightBuild, '--out', join(root, 'unused-1.json')]));
  const bothLayoutsErr = caught(() => diffDraftsCommand(['--left', bothLayoutsDir, '--right', rightBuild, '--out', join(root, 'unused-2.json')]));
  const canvasErr = caught(() => diffDraftsCommand(['--left', leftAssemble, '--right', otherCanvasDir, '--out', join(root, 'unused-3.json')]));
  const outExistsErr = caught(() => diffDraftsCommand(['--left', leftAssemble, '--right', rightBuild, '--out', outIdenticalA]));
  const outInsideLeftErr = caught(() => diffDraftsCommand(['--left', leftAssemble, '--right', rightBuild, '--out', join(leftAssemble, 'inside.json')]));
  const outInsideRightErr = caught(() => diffDraftsCommand(['--left', leftAssemble, '--right', rightBuild, '--out', join(rightBuild, 'nested', 'inside.json')]));
  const collectedErr = caught(() => diffDraftsCommand(['--left', leftAssemble, '--right', otherCanvasDir, '--out', join(leftAssemble, 'inside.json')]));
  const directBadCanvas = caught(() =>
    measureDiffDrafts(
      { partsSha256: leftMeta.partsSha256, rigSize: [20, 16], parts: [], recomposite: newRaster(20, 16) },
      { partsSha256: rightMeta.partsSha256, rigSize: [20, 18], parts: [], recomposite: newRaster(20, 18) },
    ),
  );

  const refusalsOk =
    missingPartsErr?.problems.length === 1 &&
    missingPartsErr.problems[0].code === 'DIFF_DRAFTS_INPUT' &&
    missingPartsErr.problems[0].object === '--left' &&
    missingPartsErr.problems[0].detail.includes('holds neither parts.json (build layout) nor rig/parts.json (assemble layout)') &&
    bothLayoutsErr?.problems.length === 1 &&
    bothLayoutsErr.problems[0].code === 'DIFF_DRAFTS_INPUT' &&
    bothLayoutsErr.problems[0].detail.includes('holds both parts.json and rig/parts.json') &&
    canvasErr?.problems.length === 1 &&
    canvasErr.problems[0].code === 'DIFF_DRAFTS_CANVAS' &&
    canvasErr.problems[0].object === 'canvas' &&
    canvasErr.problems[0].detail.includes('left is 20x16 and right is 24x16') &&
    outExistsErr?.problems.length === 1 &&
    outExistsErr.problems[0].code === 'DIFF_DRAFTS_OUT' &&
    outExistsErr.problems[0].detail.includes('already exists') &&
    readFileSync(outIdenticalA, 'utf8') === bytesA &&
    outInsideLeftErr?.problems.length === 1 &&
    outInsideLeftErr.problems[0].code === 'DIFF_DRAFTS_OUT' &&
    outInsideLeftErr.problems[0].detail.includes('is inside --left') &&
    !existsSync(join(leftAssemble, 'inside.json')) &&
    outInsideRightErr?.problems.length === 1 &&
    outInsideRightErr.problems[0].code === 'DIFF_DRAFTS_OUT' &&
    outInsideRightErr.problems[0].detail.includes('is inside --right') &&
    collectedErr?.problems.map((p) => p.code).join(',') === 'DIFF_DRAFTS_OUT,DIFF_DRAFTS_CANVAS' &&
    directBadCanvas?.problems.map((p) => p.code).join(',') === 'DIFF_DRAFTS_CANVAS';
  say(
    'AS1369_05_REFUSALS_COLLECT_AND_THROW_ONCE_FOR_MISSING_LAYOUT_CANVAS_MISMATCH_AND_OUT_COLLISIONS',
    refusalsOk,
    `missing=${missingPartsErr?.problems[0]?.code}, bothLayouts=${bothLayoutsErr?.problems[0]?.code}, canvas=${canvasErr?.problems[0]?.code}, outExists=${outExistsErr?.problems[0]?.code}, insideLeft=${outInsideLeftErr?.problems[0]?.code}, insideRight=${outInsideRightErr?.problems[0]?.code}, collected=${collectedErr?.problems.map((p) => p.code).join('+')}`,
  );
}

export function runDiffDraftCliChecks(dir: string, say: Say, cli: string): void {
  const root = join(dir, 'diff-drafts-cli');
  mkdirSync(root, { recursive: true });

  const leftDir = join(root, 'left');
  const rightDir = join(root, 'right');
  writeDraftDirectory(leftDir, 'assemble', [20, 16], baseDraftSpecs());
  const edited = baseDraftSpecs();
  edited[0].image.data.set([200, 40, 200, 255], 0);
  writeDraftDirectory(rightDir, 'build', [20, 16], edited);

  const run = (args: string[]) => spawnSync('bun', [cli, ...args], { encoding: 'utf8' });
  const out1 = join(root, 'cli-diff-1.json');
  const out2 = join(root, 'cli-diff-2.json');
  const r1 = run(['diff-drafts', '--left', leftDir, '--right', rightDir, '--out', out1]);
  const r2 = run(['diff-drafts', '--left', leftDir, '--right', rightDir, '--out', out2]);
  const parsed = r1.status === 0 && existsSync(out1) ? (JSON.parse(readFileSync(out1, 'utf8')) as DiffDraftsReport) : null;
  const sameBytes = r1.status === 0 && r2.status === 0 && readFileSync(out1, 'utf8') === readFileSync(out2, 'utf8');

  const existing = run(['diff-drafts', '--left', leftDir, '--right', rightDir, '--out', out1]);
  const inside = run(['diff-drafts', '--left', leftDir, '--right', rightDir, '--out', join(leftDir, 'bad.json')]);
  const missingFlag = run(['diff-drafts', '--left', leftDir, '--right', rightDir]);
  const unknownFlag = run(['diff-drafts', '--left', leftDir, '--right', rightDir, '--out', join(root, 'u.json'), '--bogus', '1']);
  const noValue = run(['diff-drafts', '--left']);

  const cliOk =
    r1.status === 0 &&
    parsed?.spec === DIFF_DRAFTS_SPEC &&
    parsed.summary.changed === 1 &&
    parsed.parts.find((p) => p.name === 'back')?.pixels?.changed_px === 1 &&
    parsed.parts.find((p) => p.name === 'back')?.pixels?.colour_px === 1 &&
    parsed.parts.find((p) => p.name === 'back')?.pixels?.alpha_px === 0 &&
    parsed.parts.find((p) => p.name === 'back')?.pixels_equal === false &&
    sameBytes &&
    existing.status === 1 &&
    existing.stdout.includes('DIFF_DRAFTS_OUT') &&
    inside.status === 1 &&
    inside.stdout.includes('DIFF_DRAFTS_OUT') &&
    missingFlag.status === 1 &&
    missingFlag.stdout.includes('DIFF_DRAFTS_INPUT') &&
    unknownFlag.status === 2 &&
    unknownFlag.stdout.includes('USAGE: diff-drafts does not take "--bogus"') &&
    noValue.status === 2 &&
    noValue.stdout.includes('USAGE: diff-drafts --left requires a value');
  say(
    'CL1369_01_DIFF_DRAFTS_CLI_WRITES_REPORT_AND_REFUSES_BAD_FLAGS_AND_OUT_COLLISIONS',
    cliOk,
    `r1=${r1.status}, sameBytes=${sameBytes}, existing=${existing.status}, inside=${inside.status}, missingFlag=${missingFlag.status}, unknownFlag=${unknownFlag.status}, noValue=${noValue.status}`,
  );
}
