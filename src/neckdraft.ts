/** #812: source-first drafting into an explicitly authored sampled body turn. */
import { assemble, checkGeometry, fullLayerToHead, headGarmentOverlaps, headGarmentWarning, placeLayer, stageFields, type AssembleResult, type AssembleInput } from './assemble.ts';
import { cloneConfig, type CharacterConfig } from './config.ts';
import { type LayerSet } from './layers.ts';
import { PartsError } from './errors.ts';
import { extendDepthSilhouette } from './depthsheets.ts';
import { type PartsFile } from './parts.ts';
import type { Raster } from './raster/types.ts';
import { sampleUnitPartDepth } from './turn.ts';
import { pyRound } from './round.ts';
import { partGrid } from './propose.ts';

function refuse(code: string, object: string, detail: string): never { throw new PartsError([{ code, object, detail }]); }
export interface NeckDraft { config: CharacterConfig; assembled: AssembleResult; notes: string[] }

/** No inference of a body turn, depth units, source art or anatomical endpoints. */
export function draftIndependentNeck(input: { config: CharacterConfig; source: Raster; full: LayerSet; head: LayerSet; base: string; under?: AssembleInput['under']; caps?: AssembleInput['caps']; previous?: { parts: PartsFile; images: ReadonlyMap<string, Raster> } }): NeckDraft {
  const cfg = cloneConfig(input.config), body = cfg.turn?.body;
  if (body === undefined) return refuse('PROPOSE_NECK_BODY_TURN', 'config.turn.body', 'is absent; declare the sampled body turn before drafting an independent neck');
  // Body overrides the entire fallback map; snapshot before removing the legacy neck entry.
  const unitDepths = { ...(body.unitDepths ?? cfg.turn?.unitDepths) };
  const rows = cfg.assemble.plan.filter(([, , tag]) => tag === 'neck');
  if (rows.length !== 1) return refuse('PROPOSE_NECK_PLAN', 'config.assemble.plan', `has ${rows.length} neck rows; one unambiguous neck source is required`);
  const [part] = rows[0];
  const fullNeck = input.full.layers.find(l => l.name === 'neck');
  if (fullNeck === undefined) return refuse('PROPOSE_NECK_FULL_SOURCE', `part "${part}"`, 'full-run neck layer is missing; supply --full with a clean neck layer, then rerun propose');
  const fields = stageFields(cfg), g = { ...fields, sourceW: input.source.width, sourceH: input.source.height };
  const frame = checkGeometry(g, input);
  const notes = headGarmentOverlaps(input.full, input.head, g, cfg.assemble.plan).map(headGarmentWarning);
  const projected = fullLayerToHead(placeLayer(fullNeck, fields.resolution), frame, fields.resolution);
  notes.push('neck source: full-run provenance avoids the head-crop warning; opaque overlap alone does not identify collar line art or distinguish normal seam underlap. Inspect the full source and rendered setup/extremes before accepting the draft');
  const pivot = body.pivot ?? cfg.turn?.pivot;
  if (pivot === undefined) return refuse('PROPOSE_NECK_DEPTH_INPUT', 'config.turn.body.pivot', 'and config.turn.pivot are absent; declare the body pivot in the existing depth world units');
  const neck = cfg.bones.find(b => 'name' in b && b.name === 'neck');
  const head = cfg.bones.find(b => 'name' in b && b.name === 'head');
  const carrier = body.bone ?? (cfg.bones.some(b => 'name' in b && b.name === 'chest') ? 'chest' : 'hip');
  if (neck === undefined || !('at' in neck) || head === undefined || !('at' in head) || !cfg.bones.some(b => 'name' in b && b.name === carrier)) return refuse('PROPOSE_NECK_CARRIER', `part "${part}"`, `neck/head landmarks or body carrier "${carrier}" are missing; declare their named bones and coordinates`);
  // This path changes a source, not structural cuts/alternate sets that require their own readers.
  if (cfg.assemble.cuts?.some(c => c.from === part || c.into === part) || cfg.assemble.alternates?.length || Object.values(cfg.limbs ?? {}).some(l => l.segments.some(s => s.from === part)) || cfg.assemble.extend_below_crop?.some(e => e.part === part)) return refuse('PROPOSE_NECK_REASSEMBLY', `part "${part}"`, 'this neck has a cut, limb split or extension, or the config has alternate sets; first assemble the clean full-run neck with the existing assemble command and draft its base config without those neck operations or alternate sets');
  cfg.assemble.plan = cfg.assemble.plan.map(row => row[0] === part ? [part, 'full', 'neck'] : row);
  const unit = `${part}_part`;
  const found = cfg.bones.find(b => 'name' in b && b.name === unit);
  if (found !== undefined && (!('at' in found) || found.parent !== carrier || JSON.stringify(found.at) !== JSON.stringify(neck.at))) return refuse('PROPOSE_NECK_BONE_UNIQUE', unit, 'already names a different bone; rename that bone before drafting the neck unit');
  if (found === undefined) cfg.bones.splice(cfg.bones.indexOf(neck) + 1, 0, { name: unit, parent: carrier, at: [...neck.at] });
  const current = cfg.meshes[part];
  const [grid, r] = partGrid(input.previous?.parts.parts.find(p => p.name === part) ?? { w: projected.width, h: projected.height });
  cfg.meshes[part] = { grid: current !== undefined && 'grid' in current ? current.grid : grid, r: current !== undefined && 'r' in current ? current.r : r, segments: [[unit, [...neck.at], [...head.at]]] };
  delete cfg.regions[part];
  if (cfg.turn!.roles !== undefined) delete cfg.turn!.roles[part];
  if (cfg.turn!.unitDepths !== undefined) delete cfg.turn!.unitDepths[part];
  body.roles[part] = 'unit';
  // Stage fields now see the new role before any color/fringe ownership operation.
  const assembled = assemble({ source: input.source, full: input.full, head: input.head, ...stageFields(cfg), under: input.under, caps: input.caps, seamRule: 'near-white', projectRule: 'core', depth: cfg.depth, depthBase: input.base });
  for (const row of assembled.depthClamps ?? []) notes.push(`depth edge clamp ${row.part}: ${row.samples} visible samples less than 1 source pixel outside the crop; edge texels retained`);
  const rec = assembled.parts.parts.find(p => p.name === part)!;
  const image = assembled.images.find(p => p.record.name === part)!.image;
  const own = assembled.images.find(p => p.record.name === part)!;
  let ref = rec.depth, scalar = own.depthImage, art = image, population = 'new full-run opaque neck texels';
  if (ref === undefined || scalar === undefined) {
    const old = input.previous?.parts.parts.find(p => p.name === part);
    const oldSheet = old?.depth === undefined ? undefined : input.previous?.images.get(old.depth.image);
    if (old?.depth === undefined || oldSheet === undefined) return refuse('PROPOSE_NECK_DEPTH_INPUT', `part "${part}"`, 'full-run scalar depth sheet and previous parts.json neck depth sheet are missing; supply config.depth with near/zScale and the source sheet, or reassemble parts with its existing scalar depth input');
    ref = old.depth; scalar = oldSheet; art = { ...oldSheet, data: new Uint8ClampedArray(oldSheet.width * oldSheet.height * 4) };
    let n = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const ox = rec.x + x - old.x, oy = rec.y + y - old.y;
      if (image.data[(y * image.width + x) * 4 + 3] < 128 || ox < 0 || oy < 0 || ox >= old.w || oy >= old.h) continue;
      art.data[(oy * old.w + ox) * 4 + 3] = 255; n++;
    }
    if (n === 0) return refuse('PROPOSE_NECK_DEPTH_INPUT', `part "${part}"`, 'new art has no opaque overlap with the previous scalar sheet; supply a registered full-run neck scalar sheet');
    population = `${n} new-art opaque texels overlapping previous registered neck sheet`;
  }
  const surface = Object.entries(body.roles).find(([, role]) => role === 'surface')?.[0];
  const surf = assembled.images.find(p => p.record.name === surface);
  if (surf?.record.depth === undefined || surf.depthImage === undefined) return refuse('PROPOSE_NECK_DEPTH_INPUT', `turn.body surface "${surface ?? '(none)'}"`, 'the first declared body surface or its scalar depth sheet is missing; declare a body surface and assemble its config.depth input');
  const zNeck = sampleUnitPartDepth(scalar, art, ref);
  const zRef = sampleUnitPartDepth(extendDepthSilhouette(surf.depthImage, surf.image), surf.image, surf.record.depth);
  const value = pyRound(pivot + zNeck - zRef, 4);
  body.unitDepths = { ...unitDepths, [part]: value };
  notes.push(`neck: "${part}" takes full:neck; sibling bone "${unit}" under "${carrier}", one rigid segment from neck to head; reassembled with the CLI defaults seam=near-white/project=core (source rules are not recorded in parts.json); turn.body.roles.${part} = unit (no head role)`);
  notes.push(`neck depth: turn.body.unitDepths.${part} = ${value} = round4(body pivot ${pivot} + neck world median ${zNeck} - first body surface "${surface}" world median ${zRef}); median over ${population}, sheet "${ref.image}", near=${ref.near}, zScale=${ref.zScale}; levelToDepthZ applies the declared polarity, not depth_median`);
  return { config: cfg, assembled, notes };
}
