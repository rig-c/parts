/** Flat blocks only: a 16x24 panel overlaps a rigid 24x12 belt by two rows. */
import type { PartsFile } from '../src/parts.ts';
import { block } from './rig.ts';

export function waistFixture() {
  const rec = (name: string, from: string, x: number, y: number, w: number, h: number): PartsFile['parts'][number] => ({ name, from, x, y, w, h, opaque_px: w * h, projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 });
  const parts: PartsFile = { rig_size: [64, 64], scale_rig_per_source: 1, parts: [rec('panel', 'full:topwear', 24, 8, 16, 24), rec('belt', 'full:bottomwear', 20, 30, 24, 12)], ghost_px: {} };
  const config: Record<string, unknown> = {
    key: 'waist-blocks', assemble: { rig_scale: 1, plan: [['panel', 'full', 'topwear'], ['belt', 'full', 'bottomwear']] },
    bones: [{ name: 'pivot', parent: 'root', at: [32, 44] }, { name: 'carrier', parent: 'pivot', at: [32, 24] }],
    meshes: { panel: { grid: 10, r: 1, segments: [['carrier', [32, 8], [32, 36]], ['pivot', [32, 36], [32, 50]]] } },
    regions: { belt: 'pivot' },
    motion: { duration: 1, tracks: [{ bone: 'carrier', prop: 'rotate', amp: 0, period: 1, phase: 0 }] },
  };
  return { parts, config, images: new Map([['panel', block(16, 24)], ['belt', block(24, 12)]]) };
}
