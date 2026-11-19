/** Rig-space whole-file replacements, applied after the last normal raster pass. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { EditorReceipt } from './editreceipt.ts';
import { parseReceiptProducer, type ReceiptProducer } from './receiptproducer.ts';
import { refuseIfAny, type Problem } from './errors.ts';
import { OPAQUE_ALPHA_ABOVE } from './layers.ts';
import { AUTOMATIC_WRITERS, EXCLUDED_PIXEL, NOT_OVERRIDDEN_PIXEL, rgbaEqual, type AutomaticWriter, type PartStageMap, type PixelProvenance, type StageMap, type ValueBaseline } from './provenance.ts';
import { decodePngBytes, encodePngBytes } from './raster/png.ts';
import type { Mask, Raster } from './raster/types.ts';
import type { PlacedPart } from './assemble.ts';
import type { PartDepthReference } from './depthsheets.ts';
import type { PaintingOwner } from './paintingowner.ts';

export type EditedPartReceipt = Omit<EditorReceipt, 'editor'> & { part: string } &
  ({ editor: string; producer?: never } | { producer: ReceiptProducer; editor?: never });

export function orderedEditedPartReceipt(receipt: EditedPartReceipt): EditedPartReceipt {
  const { part, file, sha256, from_sha256, editor, producer } = receipt;
  const fields = { part, file, sha256, from_sha256 };
  if (editor !== undefined) return { ...fields, editor };
  return { ...fields, producer: parseReceiptProducer(producer, 'edited part producer') };
}
export interface EditedParts { dir: string; receipts: EditedPartReceipt[] }
export interface VerifiedEditedPart {
  index: number;
  dir: string;
  receipt: EditedPartReceipt;
  bytes: Uint8Array;
  image: Raster;
}
export interface EditedPartProvenance {
  edit: string;
  dir: string;
  receipt: EditedPartReceipt;
  changed_px: number;
  changed_counted_px: number;
  changed_excluded_px: number;
  removed_opaque_px: number;
}
export interface EditedPartFrontColourOwner {
  owner: string;
  px: number;
  /** Rig-pixel bounding box [x, y, w, h] of changed/added pixels under this front owner within ERROR_LIMIT of the painting. */
  box: [number, number, number, number];
}
export interface EditedPartFrontColourReading {
  edit: string;
  part: string;
  px: number;
  /** Rig-pixel bounding box [x, y, w, h] across all front owners, or null when px === 0. */
  box: [number, number, number, number] | null;
  owners: EditedPartFrontColourOwner[];
}
/** Only held for an edited build, including its region-take counterfactual. */
export interface EditedPartContext {
  baseline: ValueBaseline | null;
  visible?: Mask;
  projected?: Mask;
  paintingGain?: Mask;
  /** Validate newly visible material against declared scalar sources. */
  depthForEdit?: (image: Raster) => { reference: PartDepthReference; image: Raster; clampedSamples: number } | undefined;
  depthClampedSamples?: number;
}
const AT = 'config.assemble.edited_parts';
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Read once: validation, decoding and final emission all use these exact bytes. */
export function readEditedParts(spec: EditedParts | undefined, configPath: string, plan: ReadonlyArray<readonly [string, string, string]>): VerifiedEditedPart[] {
  if (spec === undefined) return [];
  const out: VerifiedEditedPart[] = [], problems: Problem[] = [];
  const names = new Set(plan.map(([name]) => name)), seen = new Set<string>();
  for (const [index, receipt] of spec.receipts.entries()) {
    const object = `${AT}.receipts[${index}] (part "${receipt.part}")`;
    if (seen.has(receipt.part)) problems.push({ code: 'ASSEMBLE_EDITED_PART_DUPLICATE', object, detail: 'names the same part twice; one receipt per plan part is required' });
    seen.add(receipt.part);
    if (!names.has(receipt.part)) problems.push({ code: 'ASSEMBLE_EDITED_PART_UNKNOWN', object, detail: `names "${receipt.part}"; an existing assemble.plan part is required` });
    const path = resolve(dirname(resolve(configPath)), spec.dir, receipt.file);
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(readFileSync(path)); }
    catch { problems.push({ code: 'ASSEMBLE_EDITED_PART_FILE', object, detail: `file "${receipt.file}" in dir "${spec.dir}" is not readable; a PNG relative to edited_parts.dir is required` }); continue; }
    const found = sha(bytes);
    if (found !== receipt.sha256) {
      problems.push({ code: 'ASSEMBLE_EDITED_PART_SHA256', object, detail: `file sha256 is ${found}; receipt sha256 ${receipt.sha256} is required` });
      continue;
    }
    try { out.push({ index, dir: spec.dir, receipt, bytes, image: decodePngBytes(bytes, receipt.file) }); }
    catch (error) { problems.push({ code: 'ASSEMBLE_EDITED_PART_DECODES', object, detail: `file "${receipt.file}" is not a decodable PNG: ${(error as Error).message.split('\n')[0]}` }); }
  }
  refuseIfAny(problems);
  return out;
}

function append(runs: Array<[number, number]>, id: number): void {
  const last = runs[runs.length - 1];
  if (last?.[0] === id) last[1]++;
  else runs.push([id, 1]);
}
function reader(runs: ReadonlyArray<readonly [number, number]>): () => number {
  let at = 0, used = 0;
  return () => {
    const [id, length] = runs[at];
    if (++used === length) { at++; used = 0; }
    return id;
  };
}

/** Validate every baseline before replacing any image. No output writes here. */
export function replaceEditedParts(
  placed: PlacedPart[],
  edits: readonly VerifiedEditedPart[],
  plan: ReadonlySet<string>,
  map: StageMap,
  contexts: ReadonlyMap<PlacedPart, EditedPartContext>,
  painting: Raster,
  owner: PaintingOwner,
  errorLimit: number,
): EditedPartFrontColourReading[] {
  const problems: Problem[] = [], seen = new Set<string>();
  for (const edit of edits) {
    const { receipt, image } = edit, part = placed.find(p => p.record.name === receipt.part);
    const object = `${AT}.receipts[${edit.index}] (part "${receipt.part}")`;
    if (seen.has(receipt.part)) problems.push({ code: 'ASSEMBLE_EDITED_PART_DUPLICATE', object, detail: 'names the same part twice; one receipt per plan part is required' });
    seen.add(receipt.part);
    if (!plan.has(receipt.part) || part === undefined) {
      problems.push({ code: 'ASSEMBLE_EDITED_PART_UNKNOWN', object, detail: 'requires an existing plan part emitted under the same name; a part consumed by limb splitting is not a final plan part' });
      continue;
    }
    const found = sha(encodePngBytes(part.image));
    if (found !== receipt.from_sha256) problems.push({ code: 'ASSEMBLE_EDITED_PART_BASELINE', object, detail: `the current assembled PNG sha256 is ${found}; receipt from_sha256 ${receipt.from_sha256} is required` });
    if (image.width !== part.record.w || image.height !== part.record.h) problems.push({ code: 'ASSEMBLE_EDITED_PART_SIZE', object, detail: `edited PNG is ${image.width}x${image.height}; assembled box ${part.record.w}x${part.record.h} is required` });
    const actual = sha(edit.bytes);
    if (actual !== receipt.sha256) problems.push({ code: 'ASSEMBLE_EDITED_PART_SHA256', object, detail: `edited bytes sha256 is ${actual}; receipt sha256 ${receipt.sha256} is required` });
  }
  refuseIfAny(problems);
  const readings: EditedPartFrontColourReading[] = [];
  for (const edit of edits) {
    const part = placed.find(p => p.record.name === edit.receipt.part)!;
    const old = part.image, record = part.record, context = contexts.get(part)!;
    const stage = map.parts.find(p => p.name === record.name)!;
    const previous = reader(stage.runs), preSeam = reader(stage.pre_seam_writer_runs);
    const name = `edited_parts[${edit.index}]`;
    let id = map.edits.indexOf(name) + 1;
    if (id === 0) { map.edits.push(name); id = map.edits.length; }
    const metadata: EditedPartProvenance = { edit: name, dir: edit.dir,
      receipt: orderedEditedPartReceipt(edit.receipt),
      changed_px: 0, changed_counted_px: 0, changed_excluded_px: 0, removed_opaque_px: 0 };
    const next: PartStageMap = { name: stage.name, x: stage.x, y: stage.y, w: stage.w, h: stage.h,
      excluded_px: 0, runs: [], pre_seam_writer_runs: [], edited_part: metadata };
    const provenance: PixelProvenance = { unchanged_layer_px: 0, hand_px: 0, automatic_px: 0, edits: [], automatic: [],
      ...(record.provenance?.depth === undefined ? {} : { depth: record.provenance.depth }), edited_part: metadata };
    const counts = new Map<number, number>();
    let opaque = 0, visible = 0, projected = 0, paintingGain = 0;
    const partOwnerIndex = owner.names.indexOf(record.name);
    const byOwner = new Map<number, { px: number; left: number; top: number; right: number; bottom: number }>();
    let frontColourPx = 0, fcLeft = map.rig_size[0], fcTop = map.rig_size[1], fcRight = 0, fcBottom = 0;
    const baseline = context.baseline;
    for (let p = 0; p < old.width * old.height; p++) {
      const offset = p * 4, prior = previous(), priorSeam = preSeam();
      const changed = !rgbaEqual(old.data, offset, edit.image.data, offset);
      const counted = edit.image.data[offset + 3] > OPAQUE_ALPHA_ABOVE;
      if (changed) {
        metadata.changed_px++;
        if (counted) metadata.changed_counted_px++; else metadata.changed_excluded_px++;
      }
      if (old.data[offset + 3] > OPAQUE_ALPHA_ABOVE && !counted) metadata.removed_opaque_px++;
      if (!counted) { next.excluded_px++; append(next.runs, EXCLUDED_PIXEL); append(next.pre_seam_writer_runs, EXCLUDED_PIXEL); continue; }
      opaque++;
      const x = record.x + p % record.w, y = record.y + Math.floor(p / record.w);
      const q = y * map.rig_size[0] + x;
      if (changed && partOwnerIndex >= 0) {
        const ownerIndex = owner.pixels[q];
        if (ownerIndex > partOwnerIndex) {
          const qOffset = q * 4;
          const dMax = Math.max(
            Math.abs(edit.image.data[offset] - painting.data[qOffset]),
            Math.abs(edit.image.data[offset + 1] - painting.data[qOffset + 1]),
            Math.abs(edit.image.data[offset + 2] - painting.data[qOffset + 2]),
          );
          if (dMax <= errorLimit) {
            frontColourPx++;
            if (x < fcLeft) fcLeft = x;
            if (y < fcTop) fcTop = y;
            if (x + 1 > fcRight) fcRight = x + 1;
            if (y + 1 > fcBottom) fcBottom = y + 1;
            const prev = byOwner.get(ownerIndex);
            if (prev === undefined) {
              byOwner.set(ownerIndex, { px: 1, left: x, top: y, right: x + 1, bottom: y + 1 });
            } else {
              prev.px++;
              if (x < prev.left) prev.left = x;
              if (y < prev.top) prev.top = y;
              if (x + 1 > prev.right) prev.right = x + 1;
              if (y + 1 > prev.bottom) prev.bottom = y + 1;
            }
          }
        }
      }
      if (context.visible?.data[q] === 1) visible++;
      if (context.visible?.data[q] === 1 && context.projected?.data[q] === 1) projected++;
      if (context.paintingGain?.data[q] === 1) paintingGain++;
      const u = x - (baseline?.x ?? 0), v = y - (baseline?.y ?? 0);
      const sameRaw = baseline !== null && u >= 0 && v >= 0 && u < baseline.image.width && v < baseline.image.height &&
        rgbaEqual(edit.image.data, offset, baseline.image.data, (v * baseline.image.width + u) * 4);
      const writer = changed ? sameRaw ? 0 : id : prior;
      append(next.runs, writer);
      append(next.pre_seam_writer_runs, !changed && writer === AUTOMATIC_WRITERS.seamOverride ? priorSeam : NOT_OVERRIDDEN_PIXEL);
      if (writer === 0) provenance.unchanged_layer_px++;
      else if (writer > 0) provenance.hand_px++;
      else provenance.automatic_px++;
      counts.set(writer, (counts.get(writer) ?? 0) + 1);
    }
    provenance.edits = map.edits.flatMap((edit, i) => counts.has(i + 1) ? [{ edit, px: counts.get(i + 1)! }] : []);
    provenance.automatic = (Object.keys(AUTOMATIC_WRITERS) as AutomaticWriter[]).flatMap(stage => counts.has(AUTOMATIC_WRITERS[stage]) ? [{ stage, px: counts.get(AUTOMATIC_WRITERS[stage])! }] : []);
    record.opaque_px = opaque;
    // Visibility/projection masks describe the normal source passes. Intersect
    // them with final alpha; newly painted pixels outside those masks are occluded.
    record.visible_px = visible; record.occluded_px = opaque - visible;
    record.visible_not_projected_px = visible - projected;
    if (record.painting_extension_px !== undefined) record.painting_extension_px = paintingGain;
    record.provenance = provenance;
    const scalar = context.depthForEdit?.(edit.image);
    if (scalar !== undefined) {
      record.depth = scalar.reference;
      part.depthImage = scalar.image;
      context.depthClampedSamples = scalar.clampedSamples;
    }
    part.image = edit.image;
    part.encodedBytes = edit.bytes;
    map.parts[map.parts.indexOf(stage)] = next;
    const owners: EditedPartFrontColourOwner[] = [...byOwner.entries()]
      .sort(([a], [b]) => a - b)
      .map(([ownerIndex, b]) => ({
        owner: owner.names[ownerIndex],
        px: b.px,
        box: [b.left, b.top, b.right - b.left, b.bottom - b.top],
      }));
    readings.push({
      edit: name,
      part: record.name,
      px: frontColourPx,
      box: frontColourPx === 0 ? null : [fcLeft, fcTop, fcRight - fcLeft, fcBottom - fcTop],
      owners,
    });
  }
  return readings;
}

/** Measurement-only lines for front-part painting colour carried by an edited part (#1290). */
export function editedPartFrontColourLines(readings: readonly EditedPartFrontColourReading[], errorLimit: number): string[] {
  return readings.flatMap(r =>
    r.owners.length === 0
      ? [`  edited part front colour: part "${r.part}" (${r.edit}) 0 px, front owner none, box none (within ${errorLimit} of painting; measurement, no declared limit)`]
      : r.owners.map(o => `  edited part front colour: part "${r.part}" (${r.edit}) front owner "${o.owner}" ${o.px} px, box [${o.box.join(', ')}] (within ${errorLimit} of painting; measurement, no declared limit)`),
  );
}
