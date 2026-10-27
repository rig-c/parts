/** Flat blocks only: a 16x24 panel overlaps a rigid 24x12 belt by two rows. */
import type { PartsFile } from '../src/parts.ts';
import { block } from './rig.ts';

export function waistFixture() {
  const rec = (name: string, from: string, x: number, y: number, w: number, h: number): PartsFile['parts'][number] => ({ name, from, x, y, w, h, opaque_px: w * h, projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 });
  const parts: PartsFile = { rig_size: [64, 64], scale_rig_per_source: 1, parts: [rec('panel', 'full:topwear', 24, 8, 16, 24), rec('belt', 'full:bottomwear', 20, 30, 24, 12)], ghost_px: {} };
  const config: Record<string, unknown> = {
    waist: { top: 'panel', bottom: 'belt', upper: 'carrier', lower: 'pivot', bone: 'belt_waist', constraint: 'belt_rotation' },
    key: 'waist-blocks', assemble: { rig_scale: 1, plan: [['panel', 'full', 'topwear'], ['belt', 'full', 'bottomwear']] },
    bones: [{ name: 'pivot', parent: 'root', at: [32, 44] }, { name: 'carrier', parent: 'pivot', at: [32, 24] }],
    meshes: { panel: { grid: 10, r: 1, segments: [['carrier', [32, 8], [32, 36]], ['pivot', [32, 36], [32, 50]]] } },
    regions: { belt: 'pivot' },
    motion: { duration: 1, tracks: [{ bone: 'carrier', prop: 'rotate', amp: 0, period: 1, phase: 0 }] },
  };
  return { parts, config, images: new Map([['panel', block(16, 24)], ['belt', block(24, 12)]]) };
}

/** Both paired drawings move to declared front slots; original base slots are hidden by the set. */
export function waistFrontFixture() {
  const f = waistFixture();
  f.config.assemble = {
    rig_scale: 1, plan: [['fabric', 'full', 'topwear'], ['trim', 'full', 'bottomwear'], ['marker', 'full', 'handwear-r']],
    alternates: [{ name: 'front', source: 'front.png', full: 'front-full', head: 'head', parts: ['panel', 'belt'], front: ['panel', 'belt'] }],
  };
  f.config.waist = { top: 'panel', bottom: 'belt', upper: 'stem1', lower: 'stem0', bone: 'belt_waist', constraint: 'belt_rotation' };
  f.config.bones = [{ chain: 'stem', parent: 'root', points: [[32,44],[32,24]], tip: [32,8] }];
  f.config.meshes = { panel: { grid: 10, r: 1, segments: [['stem1',[32,8],[32,36]],['stem0',[32,36],[32,50]]] } };
  f.config.regions = { belt: 'stem0', marker: 'root' };
  f.config.limbs = { strip: { segments: [{ part: 'belt', from: 'trim', bone: 'stem0' }, { part: 'panel', from: 'fabric', bone: 'stem1', joint: 'fold' }], front: { parts: ['panel','belt'], after: 'marker' } } };
  f.config.motion = { duration: 1, tracks: [{ bone: 'stem1', prop: 'rotate', amp: 0, period: 1, phase: 0 }] };
  f.parts.parts[0].limb = { name: 'strip', segment: 1, of: 'fabric', bone: 'stem1', joint: 'fold' };
  f.parts.parts[1].limb = { name: 'strip', segment: 0, of: 'trim', bone: 'stem0' };
  f.parts.alternates = [{ name: 'front', parts: ['panel','belt'], front: ['panel','belt'], slots: {panel_front:'front_panel',belt_front:'front_belt'}, hides:['panel','belt'], records: structuredClone(f.parts.parts), ghost_px: {}, recomposite: {mean_abs:0,within_limit:0,within_share:0,error_limit:0,error_px:0,covered_alpha:0,uncovered_error_px:0,hole_count:0,holes_listed:0,holes:[]} }];
  f.parts.parts.push({ name:'marker',from:'full:handwear-r',x:48,y:8,w:4,h:4,opaque_px:16,projected_core_px:0,source_px_taken:0,refused_drift_px:0,merged_px:0,seam_override_px:0 });
  f.images.set('marker',block(4,4)); f.images.set('front_panel',block(16,24)); f.images.set('front_belt',block(24,12));
  return f;
}

/** Generated rectangular band, followed by a wider flat skirt. No painted corpus. */
export function waistPivotFixture() {
  const f = waistFixture();
  const bottom = block(24, 22);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 24; x++) if (x < 4 || x >= 20) bottom.data[(y * 24 + x) * 4 + 3] = 0;
  const record = f.parts.parts[1]; record.h = 22; record.opaque_px = 16 * 10 + 24 * 12;
  f.images.set('belt', bottom);
  return f;
}

/** One source-row step in the original flat band; forces a non-horizontal copy boundary. */
export function waistSharedCopyFixture() {
  const f=waistPivotFixture(),bottom=f.images.get('belt')!;
  for(let x=4;x<12;x++)bottom.data[x*4+3]=0;
  f.parts.parts[1].opaque_px-=8;
  return f;
}
