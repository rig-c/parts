/** Hand-computable rectangles reaching check's parts-file readers (#1176). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../src/config.ts';
import { writeMaterialSources } from '../src/cutmaterialio.ts';
import { type PartsFile, writeParts } from '../src/parts.ts';
import { writePng } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
import { buildRig } from '../src/rig.ts';
import { writeSupportDomains } from '../src/supportdomains.ts';

export function writePartsReaderFixture(home: string): void {
  mkdirSync(join(home, 'parts'), { recursive: true });
  mkdirSync(join(home, 'rig', 'images'), { recursive: true });
  const boxes: Array<[string, string, number, number, number, number]> = [
    ['upper', 'full:handwear-r', 2, 2, 6, 8],
    ['lower', 'full:handwear-r', 2, 10, 6, 8],
    ['face', 'head:face', 12, 2, 8, 8],
    ['skirt', 'full:bottomwear', 12, 10, 8, 12],
  ];
  const parts: PartsFile = {
    rig_size: [32, 24], scale_rig_per_source: 1, ghost_px: {},
    parts: boxes.map(([name, from, x, y, w, h]) => ({
      name, from, x, y, w, h, opaque_px: w * h, projected_core_px: 0,
      source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0,
    })),
  };
  parts.parts[0].limb = { name: 'arm', segment: 0, of: 'arm_source', bone: 'arm0' };
  parts.parts[1].limb = {
    name: 'arm', segment: 1, of: 'arm_source', bone: 'arm1', joint: 'elbow', range: [-5, 5],
    cap: { at: [5, 10], width: 6, radius: 3, box: [2, 7, 6, 6], layer_px: 0, missing_px: 0 },
  };
  const images = new Map(boxes.map(([name, , , , w, h]) => {
    const image = newRaster(w, h);
    for (let i = 0; i < image.data.length; i += 4) image.data.set([128, 128, 128, 255], i);
    writePng(join(home, 'parts', name + '.png'), image);
    return [name, image] as const;
  }));
  const config = parseConfig({
    key: 'reader_fixture',
    assemble: { rig_scale: 1, plan: [['arm_source', 'full', 'handwear-r'], ['face', 'head', 'face'], ['skirt', 'full', 'bottomwear']] },
    bones: [
      { name: 'body', parent: 'root', at: [16, 12] },
      { name: 'head', parent: 'body', at: [16, 6] },
      { chain: 'arm', parent: 'body', points: [[5, 2], [5, 10]], tip: [5, 18] },
    ],
    limbs: { arm: { segments: [{ part: 'upper', from: 'arm_source', bone: 'arm0' }, { part: 'lower', from: 'arm_source', bone: 'arm1', joint: 'elbow' }] } },
    regions: { upper: 'arm0', lower: 'arm1', face: 'head', skirt: 'body' }, meshes: {},
    motion: { duration: 1, tracks: [{ bone: 'body', prop: 'translatey', amp: 0, period: 1, phase: 0 }] },
  });
  writeParts(join(home, 'parts.json'), parts);
  const built = buildRig(config, parts, images);
  writeFileSync(join(home, 'rig', 'rig.json'), JSON.stringify(built.rig));
  writeFileSync(join(home, 'rig', 'motion.json'), JSON.stringify(built.motion));
  for (const [name, image] of built.images) writePng(join(home, 'rig', 'images', name), image);
  writeMaterialSources(join(home, 'parts.json'), join(home, 'parts'), parts, [{
    part: 'lower', from: ['full:handwear-r'], source_sha256: ['0'.repeat(64)],
    edges: [{ a: [2, 10], b: [8, 10], inward: [0, 1], opaque_t: [[0, 1]], opaque_intervals: 1, opaque_length_px: 6 }],
  }]);
  writeSupportDomains(join(home, 'parts.json'), join(home, 'parts'), parts, [], '{}');
  writeFileSync(join(home, 'requirements.json'), JSON.stringify({
    spec: 'spine-parts-requirements/1', fps: 1,
    requirements: [{ name: 'elbow', kind: 'seam', animation: 'idle', part: 'upper', neighbour: 'lower', within_px: 1 }],
    cut_material: [{ part: 'lower', joint: 'elbow', at: [5, 10], axis: [0, 1], reach_px: 1, bend_degrees: [-5, 5] }],
    boundary_colour: { max_step_excess: 255 },
  }));
}
