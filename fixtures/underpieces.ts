import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { guideRule } from '../src/guide.ts';
import { provenanceAddsUp } from '../src/provenance.ts';
/** Generated rigid rectangles only; the oracle samples explicit rigid rotations. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rigConfig } from './rig.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import type { PartsFile, PartRecord } from '../src/parts.ts';
import { encodePngBytes } from '../src/raster/png.ts';

export const underDeclaration = () => ({ name: 'joint_under', seam: { neighbours: ['upper', 'lower'], at: [32, 31], normal: [0, 1] }, carrier: 'upper', side: 'negative', donor: 'lower', box: [25, 24, 39, 31] });
export function underFixture() {
  const cfg = rigConfig();
  cfg.assemble = { rig_scale: 1, plan: [['upper', 'full', 'topwear'], ['lower', 'full', 'bottomwear']] };
  cfg.bones = [{ name: 'upper', parent: 'root', at: [32, 8] }, { name: 'lower', parent: 'upper', at: [32, 31] }];
  cfg.meshes = {}; cfg.regions = { upper: 'upper', lower: 'lower' };
  cfg.motion = { duration: 4, tracks: [{ bone: 'lower', prop: 'rotate', amp: 30, period: 4, phase: 0 }] };
  const upper = newRaster(16, 24), lower = newRaster(16, 32);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 16; x++) if (!(y >= 17 && y < 22 && x >= 2 && x < 14)) upper.data.set([160, 90, 40, 255], (y * 16 + x) * 4);
  for (let p = 0; p < 16 * 32; p++) lower.data.set([160, 90, 40, 255], p * 4);
  const rec = (name: string, from: string, y: number, image: Raster): PartRecord => ({ name, from, x: 24, y, w: image.width, h: image.height, opaque_px: image.data.filter((_, i) => i % 4 === 3 && image.data[i] > 8).length, projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 });
  const parts: PartsFile = { rig_size: [64, 64], scale_rig_per_source: 1, parts: [rec('upper', 'full:topwear', 8, upper), rec('lower', 'full:bottomwear', 24, lower)], ghost_px: {} };
  return { cfg, parts, images: new Map([['upper', upper], ['lower', lower]]) };
}
export function underPose(parts: PartsFile, images: ReadonlyMap<string, Raster>, angle: number, carrierAngle = 0): Raster {
  const out = newRaster(64, 64), a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), parent = carrierAngle * Math.PI / 180, pc = Math.cos(parent), ps = Math.sin(parent);
  for (const p of parts.parts) {
    const image = images.get(p.name)!;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const dx0 = x + 0.5 - 32, dy0 = y + 0.5 - 8;
      let px = 32 + pc * dx0 - ps * dy0, py = 8 + ps * dx0 + pc * dy0;
      if (p.name === 'lower') { const dx = px - 32, dy = py - 31; px = 32 + c * dx - s * dy; py = 31 + s * dx + c * dy; }
      const ix = Math.floor(px - p.x), iy = Math.floor(py - p.y);
      if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) continue;
      const at = (iy * image.width + ix) * 4;
      if (image.data[at + 3] > 0) out.data.set(image.data.subarray(at, at + 4), (y * 64 + x) * 4);
    }
  }
  return out;
}
export function underHoles(image: Raster): number {
  let holes = 0;
  // Fixed interior joint opening: 12x5 at x26..37/y25..29, behind the moving donor.
  for (let y = 25; y < 30; y++) for (let x = 26; x < 38; x++) if (image.data[(y * 64 + x) * 4 + 3] === 0) holes++;
  return holes;
}
export function underVisuals(dir: string, prefix: string, parts: PartsFile, images: ReadonlyMap<string, Raster>): number[] {
  mkdirSync(dir, { recursive: true });
  const frames = [0, -30, 30].map(a => underPose(parts, images, a));
  const diff = newRaster(64, 64);
  for (let i = 0; i < diff.data.length; i++) diff.data[i] = i % 4 === 3 ? 255 : Math.abs(frames[1].data[i] - frames[2].data[i]);
  [...frames, diff].forEach((f, i) => {
    const label = ['setup', 'min', 'max', 'diff'][i];
    writeFileSync(join(dir, `${prefix}-${label}.png`), encodePngBytes(f));
    for (const scale of [1, 4]) {
      const boundary = newRaster(24 * scale, 24 * scale);
      for (let y = 0; y < boundary.height; y++) for (let x = 0; x < boundary.width; x++) { const p = ((20 + Math.floor(y / scale)) * 64 + 20 + Math.floor(x / scale)) * 4; boundary.data.set(f.data.subarray(p, p + 4), (y * boundary.width + x) * 4); }
      writeFileSync(join(dir, `${prefix}-${label}-boundary-${scale}x.png`), encodePngBytes(boundary));
    }
  });
  return frames.map(underHoles);
}

import { addUnderPieces, underOrderProblems, underPieceProblems, type UnderPiece } from '../src/underpieces.ts';
import { parseConfig, parseEarlyConfig, type CharacterConfig } from '../src/config.ts';
import { buildRig, rigJsonText } from '../src/rig.ts';
import { readParts, serializeParts } from '../src/parts.ts';
import { PartsError } from '../src/errors.ts';
import { assemble, cutPatch, type AssembleInput } from '../src/assemble.ts';
import type { LayerSet } from '../src/layers.ts';
import { readLayerTag } from '../src/tags.ts';
import { coalesceLimbSlots } from '../src/limbslots.ts';
import { decodePngBytes } from '../src/raster/png.ts';

export function underInput(): AssembleInput {
  const f = underFixture(), source = newRaster(64, 64);
  for (let p = 0; p < 4096; p++) source.data.set([160, 90, 40, 255], p * 4);
  const full: LayerSet = { form: 'wrapper', source: 'synthetic', canvas: { w: 64, h: 64 }, hidden: [], layers: f.parts.parts.map((p, i) => ({ name: p.from.slice(5), tag: readLayerTag(p.from.slice(5))!, file: null, pixels: f.images.get(p.name)!, left: p.x, top: p.y, right: p.x + p.w, bottom: p.y + p.h, depth: 1 - i * 0.1, drawOrder: i, opaquePx: p.opaque_px })) };
  return { source, full, head: full, resolution: 64, headBox: [0, 0, 64, 64], rigScale: 1, plan: [['upper', 'full', 'topwear'], ['lower', 'full', 'bottomwear']], patches: [], cuts: [], extend: [], seamRule: 'near-white', projectRule: 'core', bones: parseConfig(f.cfg).bones, regions: { upper: 'upper', lower: 'lower' }, meshes: {} };
}
function cropByte(image: Raster, d: UnderPiece, i: number): number {
  const p = Math.floor(i / 4), w = d.box[2] - d.box[0];
  return image.data[((d.box[1] - 24 + Math.floor(p / w)) * image.width + d.box[0] - 24 + p % w) * 4 + i % 4];
}
export function runUnderPieceChecks(dir: string, say: (name: string, ok: boolean, detail: string) => void): void {
  mkdirSync(dir, { recursive: true });
  const f = underFixture(), d = underDeclaration() as UnderPiece;
  const config = () => { const raw = underFixture().cfg; (raw.assemble as Record<string, unknown>).under_pieces = [d]; return raw; };
  const cfg = parseConfig(config());
  const base = f.parts.parts.map(record => ({ record, image: f.images.get(record.name)! }));
  const output = addUnderPieces([d], base, cfg, [64, 64]);
  const parts: PartsFile = { ...f.parts, parts: output.map(p => p.record) }, images = new Map(output.map(p => [p.record.name, p.image]));
  const error = (fn: () => unknown) => { try { fn(); return ''; } catch (e) { return e instanceof PartsError ? e.problems.map(p => p.code).join(',') : String(e); } };
  const holes = [-30, 0, 30].map(a => underHoles(underPose(f.parts, f.images, a))), closed = [-30, 0, 30].map(a => underHoles(underPose(parts, images, a)));
  say('RED_FIXED_SKELETON', holes[0] > 0 && holes[1] === 0 && holes[2] > 0, `normal/defect extrema: ${holes.join('/')}; generated rigid rectangles only`);
  say('EXACT_CROP_AND_CLOSED', closed.every(n => n === 0) && output[0].record.name === d.name && images.get(d.name)!.data.every((v, i) => v === cropByte(f.images.get('lower')!, d, i)), `closed ${closed.join('/')}; crop ${images.get(d.name)!.data.length} RGBA bytes; order ${output.map(p => p.record.name)}`);
  const out = buildRig(cfg, parts, images);
  say('FINAL_SLOT_AND_SKELETON', underOrderProblems([d], out.rig.slots).length === 0 && JSON.stringify(buildRig(parseConfig(f.cfg), f.parts, f.images).rig.bones) === JSON.stringify(out.rig.bones), `final ${out.rig.slots.map(s => `${s.name}:${s.bone}`)}; fixed bones identical`);
  const transparent = underFixture(); transparent.images.get('lower')!.data.set([17, 39, 211, 0], 4); transparent.images.get('lower')!.data.set([23, 78, 154, 7], 8); transparent.images.get('lower')!.data.set([96, 31, 18, 128], 12);
  const special = addUnderPieces([d], transparent.parts.parts.map(record => ({ record, image: transparent.images.get(record.name)! })), cfg, [64, 64])[0].image;
  say('TRANSPARENT_RGB_AND_PARTIAL_ALPHA', special.data.every((v, i) => v === cropByte(transparent.images.get('lower')!, d, i)) && decodePngBytes(encodePngBytes(special), 'exact crop').data.every((v, i) => v === special.data[i]), `all ${special.data.length} bytes equal, including [${special.data.slice(0, 12)}], through PNG codec`);
  const empty = underFixture(); empty.images.get('lower')!.data.fill(0);
  say('EMPTY_DONOR', error(() => addUnderPieces([d], empty.parts.parts.map(record => ({ record, image: empty.images.get(record.name)! })), cfg, [64, 64])).includes('ASSEMBLE_UNDER_EMPTY'), 'zero-alpha donor is refused at the seam');
  const foreign = { ...d, box: [24, 24, 40, 33] as [number, number, number, number] };
  say('FOREIGN_SIDE', error(() => addUnderPieces([foreign], base, cfg, [64, 64])).includes('ASSEMBLE_UNDER_FOREIGN_SIDE'), '32 nontransparent pixels past explicit line; nothing is masked');
  const translucent = underFixture(); translucent.images.get('lower')!.data.forEach((_, i, a) => { if (i % 4 === 3) a[i] = 8; });
  say('SUBTHRESHOLD_SEAM_AND_ZERO_NORMAL', error(() => addUnderPieces([d], translucent.parts.parts.map(record => ({ record, image: translucent.images.get(record.name)! })), cfg, [64,64])).includes('ASSEMBLE_UNDER_EMPTY') && underPieceProblems([{ ...d, seam: { ...d.seam, normal: [0, 0] } }]).some(p => p.code === 'CONFIG_UNDER_PIECE'), 'alpha 8 gives no seam art; zero normal is named, never normalized');
  const solidUpper = underFixture(); solidUpper.images.get('upper')!.data.forEach((_, i, a) => { a[i] = [160,90,40,255][i % 4]; });
  const rotated = [-15,15].flatMap(parent => [-30,30].map(angle => {
    const actual = underPose(parts, images, angle, parent), reference = underPose(solidUpper.parts, solidUpper.images, angle, parent);
    let holes = 0; for (let p=0; p<4096; p++) if (reference.data[p*4+3] > 0 && actual.data[p*4+3] === 0) holes++;
    return holes;
  }));
  say('CARRIER_ROTATION_CLOSURE', rotated.every(n => n===0), `parent +/-15 and relative child +/-30: holes ${rotated.join('/')}; independent solid upstream reference`);
  say('WRONG_SIDE_AND_GEOMETRY', error(() => addUnderPieces([{ ...d, side: 'positive' }], base, cfg, [64, 64])).includes('ASSEMBLE_UNDER_GEOMETRY') && error(() => addUnderPieces([{ ...d, seam: { ...d.seam, at: [32, 30] } }], base, cfg, [64, 64])).includes('ASSEMBLE_UNDER_GEOMETRY'), 'carrier side and seam point checked against named parent/child origins');
  say('MALFORMED_FIELDS', underPieceProblems([{ ...d, auto: true }]).length > 0 && underPieceProblems([{ ...d, seam: { ...d.seam, normal: [0, 2] } }]).length > 0, 'unknown field and non-unit normal refused');
  say('UNKNOWN_DONOR_AND_BOX', error(() => addUnderPieces([{ ...d, donor: 'missing' }], base, cfg, [64, 64])).includes('ASSEMBLE_UNDER_DONOR') && error(() => addUnderPieces([{ ...d, box: [0, 0, 40, 32] }], base, cfg, [64, 64])).includes('ASSEMBLE_UNDER_BOX'), 'named donor and bounded exact crop required');
  say('OUTPUT_COLLISION', error(() => addUnderPieces([{ ...d, name: 'upper' }], base, cfg, [64, 64])).includes('ASSEMBLE_UNDER_NAME'), 'output never replaces a neighbour');
  const moved = [...parts.parts.slice(1), parts.parts[0]];
  say('WRONG_INPUT_ORDER', error(() => buildRig(cfg, { ...parts, parts: moved }, images)).includes('RIG_UNDER_DRAW_ORDER'), 'piece moved to front is refused on final slots');
  const corrupt = new Map(images); const bad = { ...images.get(d.name)!, data: images.get(d.name)!.data.slice() }; bad.data[0] ^= 1; corrupt.set(d.name, bad);
  say('TAMPERED_RGBA', error(() => buildRig(cfg, parts, corrupt)).includes('RIG_UNDER_PROVENANCE'), 'one copied colour byte changed is refused');
  say('UNDECLARED_METADATA', error(() => buildRig(parseConfig(f.cfg), parts, images)).includes('RIG_UNDER_PROVENANCE'), 'stale under-piece without a declaration refused');
  const at = join(dir, 'parts.json'); writeFileSync(at, serializeParts(parts));
  say('PROVENANCE_ROUNDTRIP', JSON.stringify(readParts(at).parts[0].under_piece) === JSON.stringify(d), `seam, carrier, side, donor and exact crop retained: ${JSON.stringify(d)}`);
  const input = underInput(), baseline = assemble(input), added = assemble({ ...input, underPieces: [d] });
  say('ASSEMBLE_INTEGRATION', added.images[0].record.name === d.name && added.images[0].image.data.every((v, i) => v === cropByte(baseline.images[1].image, d, i)) && added.images.slice(1).every((p, i) => encodePngBytes(p.image).every((v, j) => v === encodePngBytes(baseline.images[i].image)[j])), 'late exact crop after legacy raster passes, neighbour PNG bytes unchanged');
  const declaredEarly = { ...config(), seethrough: { resolution: 64, steps: 1, seed: 1, offload: false } };
  say('ASSEMBLE_CENSUS', added.parts.parts.every(p => p.provenance !== undefined && provenanceAddsUp(p.provenance, p.opaque_px)), `all ${added.parts.parts.length} records include copied crop in final pixel census`);
  say('BOTH_CONFIG_DOORS', error(() => parseEarlyConfig(declaredEarly, 'assemble')) === '' && cfg.assemble.under_pieces?.[0].carrier === 'upper', 'assemble and full readers admit the same field');
  // A lower carrier belongs to a nested limb. Gathering moves it after upper.
  const lowerD: UnderPiece = { ...d, carrier: 'lower', side: 'positive', box: [24, 31, 40, 40] };
  const lowerParts = addUnderPieces([lowerD], base, cfg, [64, 64]);
  const lowerCfg: CharacterConfig = { ...cfg, assemble: { ...cfg.assemble, under_pieces: [lowerD] }, limbs: { parent: { segments: [{ part: 'upper', from: 'source_upper', bone: 'upper' }] }, nested: { segments: [{ part: 'lower', from: 'source_lower', bone: 'lower' }] } } };
  const nested = error(() => buildRig(lowerCfg, { ...f.parts, parts: lowerParts.map(p => p.record) }, new Map(lowerParts.map(p => [p.record.name, p.image]))));
  const fakeSlots = [{ name: d.name, bone: 'lower', attachment: d.name }, { name: 'upper', bone: 'upper', attachment: 'upper' }, { name: 'lower', bone: 'lower', attachment: 'lower' }];
  const fakeSkin = Object.fromEntries(fakeSlots.map(s => [s.name, { [s.name]: { image: s.name, x: 0, y: 0 } }]));
  const grouped = coalesceLimbSlots(lowerCfg.limbs, [{ name: 'root', x: 0, y: 0 }, { name: 'upper', parent: 'root', x: 0, y: 0 }, { name: 'lower', parent: 'upper', x: 0, y: 0 }], fakeSlots, fakeSkin);
  say('NESTED_LIMB_FINAL_ORDER', nested.includes('RIG_UNDER_DRAW_ORDER') && underOrderProblems([lowerD], grouped.slots).length === 1, `nested gather ${grouped.slots.map(s => s.name)}; builder ${nested}`);
  const cutInput = underInput();
  cutInput.cuts = [{ from: 'lower', into: 'copy', polygon: [[25,24],[39,24],[39,31],[25,31]], draw: 'back', overlap: 4 }];
  const cutRoute = assemble(cutInput), cutDonor = cutRoute.images.find(p => p.record.name === 'lower')!;
  const capInput = underInput(); capInput.limbs = { joint: { segments: [{part:'upper_segment',from:'upper',bone:'upper'},{part:'lower_segment',from:'lower',bone:'lower',joint:'elbow',cap_shape:'ball'}] } };
  const capRoute = assemble(capInput);
  const patchSource = underInput().source; patchSource.data.set([17,39,211,0], (24*64+25)*4);
  const patch = cutPatch({name:'patch',box:[25,24,39,31],alpha:'box',draw:'back'},patchSource,null)!;
  say('LEGACY_ROUTES_SCOPE', cutRoute.images.length===3 && cutRoute.images[0].record.name==='copy' && cutDonor.image.data.every((v,i)=>v===baseline.images[1].image.data[i]) && capRoute.images.length===2 && capRoute.images.find(p=>p.record.limb?.cap!==undefined)?.record.limb?.bone==='lower' && patch.image.data[3]===255, `retained-overlap cut makes ${cutRoute.images.length} pieces and preserves donor (so a broad no-route claim is false); ball makes ${capRoute.images.length} pieces, cap on lower; patch alpha 0 -> ${patch.image.data[3]}`);
  const transparentInput = underInput();
  const pixels = transparentInput.full.layers[1].pixels;
  for(let x=1;x<15;x++)pixels.data.set([17,39,211,0],x*4);
  transparentInput.cuts = cutInput.cuts;
  const trimmed = assemble(transparentInput).images.find(p=>p.record.name==='copy')!.record;
  say('LEGACY_CUT_TRIMS_TRANSPARENT_BORDER', trimmed.y!==d.box[1] || trimmed.h!==d.box[3]-d.box[1], `retained-overlap cut with transparent top edge outputs y=${trimmed.y}, h=${trimmed.h}; declared exact crop y=${d.box[1]}, h=${d.box[3]-d.box[1]}`);
  const depthInput = underInput(), sheet = newRaster(16,24);
  for(let p=0;p<384;p++)sheet.data.set([80,80,80,255],p*4);
  depthInput.full.layers[0].depthSheet={file:'synthetic-depth.png',sha256:createHash('sha256').update(encodePngBytes(sheet)).digest('hex'),pixels:sheet,reading:{orderingMedian:1,sheetMedian:80,relation:'indeterminate'},near:'black',zScale:10};
  depthInput.depth={zScale:10};
  const depthBase=assemble(depthInput), depthAllowed=assemble({...depthInput,underPieces:[d]});
  const collision=error(()=>assemble({...depthInput,underPieces:[{...d,name:'upper_depth'}]}));
  say('OTHER_PART_DEPTH_ART_COLLISION', collision.includes('DEPTH_SHEET_UNAMBIGUOUS') && depthBase.images.find(p=>p.record.name==='upper')?.record.depth?.image==='upper_depth.png' && depthAllowed.images.find(p=>p.record.name==='lower')?.record.depth===undefined, `donor lower has no depth; unrelated upper owns upper_depth.png; positive distinct name accepted, colliding generated artwork -> ${collision}`);
  const rigidMetadata=base.map(p=>({...p,record:{...p.record,limb:{name:'joint',segment:p.record.name==='upper'?0:1,of:p.record.name,bone:p.record.name}}}));
  const bandMetadata=rigidMetadata.map(p=>p.record.name!=='lower'?p:{...p,record:{...p.record,limb:{...p.record.limb,band:{upper:'upper',width:4,radius:8,at:[32,31] as [number,number],axis:[0,1] as [number,number]}}}});
  const bandError=error(()=>addUnderPieces([d],bandMetadata,cfg,[64,64]));
  const bandParts={...f.parts,parts:bandMetadata.map(p=>p.record)};
  say('HYBRID_BAND_IS_NOT_RIGID', error(()=>addUnderPieces([d],rigidMetadata,cfg,[64,64]))==='' && bandError.includes('ASSEMBLE_UNDER_GEOMETRY') && error(()=>buildRig(cfg,bandParts,f.images)).includes('ASSEMBLE_UNDER_GEOMETRY'), `ordinary limb metadata accepted; planted generated band rejected at direct assembly and rig call before hybrid mesh generation: ${bandError}`);
  const hybridRaw=underFixture().cfg;
  hybridRaw.bones=[{name:'upper',parent:'root',at:[32,8],tip:[32,31]},{name:'lower',parent:'upper',at:[32,31],tip:[32,56]}];
  (hybridRaw.assemble as Record<string,unknown>).plan=[['lower','full','bottomwear']];
  hybridRaw.limbs={joint:{segments:[{part:'upper_segment',from:'lower',bone:'upper'},{part:'lower_segment',from:'lower',bone:'lower',joint:'elbow',hybrid:{part:'band',width:4}}]}};
  hybridRaw.regions={upper_segment:'upper',lower_segment:'lower'};
  const hybridBaseCfg=parseConfig(hybridRaw), hybridInput={...underInput(),plan:hybridBaseCfg.assemble.plan,bones:hybridBaseCfg.bones,limbs:hybridBaseCfg.limbs,regions:hybridBaseCfg.regions};
  const generatedBand=assemble(hybridInput).parts.parts.find(p=>p.name==='band');
  (hybridRaw.assemble as Record<string,unknown>).under_pieces=[{...d,seam:{...d.seam,neighbours:['upper_segment','band']},donor:'lower_segment'}];
  const hybridCfg=parseConfig(hybridRaw);
  say('FULL_LOADER_GENERATED_BAND_REFUSED',generatedBand?.limb?.band!==undefined && error(()=>assemble({...hybridInput,underPieces:hybridCfg.assemble.under_pieces})).includes('ASSEMBLE_UNDER_GEOMETRY'),'full loader admits canonical hybrid source, base assembler makes the band, neighbour declaration is refused before crop/rig emission');
  const guide=readFileSync(new URL('../docs/AUTHORING.md',import.meta.url),'utf8');
  const rules=['CONFIG_UNDER_PIECE','ASSEMBLE_UNDER_GEOMETRY','ASSEMBLE_UNDER_NAME','ASSEMBLE_UNDER_DONOR','ASSEMBLE_UNDER_BOX','ASSEMBLE_UNDER_EMPTY','ASSEMBLE_UNDER_FOREIGN_SIDE','PARTS_UNDER_PIECE','RIG_UNDER_PROVENANCE','RIG_UNDER_DRAW_ORDER'];
  say('GUIDE_ROWS_AND_STABILITY_FIELD',rules.every(rule=>!('problem' in guideRule(guide,rule))) && /- \*\*assemble\*\*[^\n]*`under_pieces`/.test(readFileSync(new URL('../docs/STABILITY.md',import.meta.url),'utf8')), `${rules.length} refusal lookups use the real guide parser; stable assemble field declared`);
  const noDecl = buildRig(parseConfig(f.cfg), f.parts, f.images);
  say('ABSENT_IDENTITY', addUnderPieces(undefined, base, cfg, [64, 64]) === base && rigJsonText(noDecl.rig).length > 0, 'no declaration returns original part list; origin equality measured in external receipt');
}
