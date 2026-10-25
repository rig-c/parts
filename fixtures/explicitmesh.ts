/** Four corners of the rig fixture's padded cloth, derived in bone-local Spine pixels. */
import { block, islandImages, rigConfig, rigImages, rigParts } from './rig.ts';
import type { ExplicitMeshIslandSpec, ExplicitMeshSpec } from '../src/config.ts';
import { explicitImageHash, explicitRegionHash } from '../src/explicitmesh.ts';

export type SingleExplicitMeshSpec = ExplicitMeshSpec & {
  explicit: {
    image_sha256: string;
    region_sha256: string;
    uvs: number[];
    triangles: number[];
    hull: number;
    weights: Array<Array<{ bone: string; x: number; y: number; weight: number }>>;
  };
};

export type IslandsExplicitMeshSpec = ExplicitMeshSpec & {
  explicit: {
    image_sha256: string;
    region_sha256: string;
    islands: ExplicitMeshIslandSpec[];
  };
};

export function explicitFixture(): { config: Record<string, unknown>; mesh: SingleExplicitMeshSpec } {
  const parts = rigParts(), image = rigImages().get('cloth');
  if (image === undefined) throw new Error('synthetic cloth missing');
  // The 24x16 padded image starts at crop (6,6). body stands at crop (20,30).
  const mesh: SingleExplicitMeshSpec = { segments: ['body'], explicit: {
    image_sha256: explicitImageHash(image), region_sha256: explicitRegionHash(parts.rig_size, parts.parts[0]),
    uvs: [0, 0, 0, 1, 1, 1, 1, 0], triangles: [0, 1, 2, 0, 2, 3], hull: 4,
    weights: [[-14, 24], [-14, 8], [10, 8], [10, 24]].map(([x, y]) => [{ bone: 'body', x, y, weight: 1 }]),
  } };
  const config = rigConfig(); config.meshes = { cloth: mesh };
  return { config, mesh };
}

/** Two-island explicit cloth over islandImages() (columns 4..11 cleared: two 4x8 = 32 px islands). */
export function explicitIslandsFixture() {
  const parts = rigParts(), images = islandImages(), image = images.get('cloth');
  if (image === undefined) throw new Error('synthetic island cloth missing');
  const mesh: IslandsExplicitMeshSpec = {
    segments: ['body', 'eye'],
    explicit: {
      image_sha256: explicitImageHash(image),
      region_sha256: explicitRegionHash(parts.rig_size, parts.parts[0]),
      islands: [
        {
          slot: 'cloth',
          uvs: [0, 0, 0, 1, 0.5, 1, 0.5, 0],
          triangles: [0, 1, 2, 0, 2, 3],
          hull: 4,
          weights: [[-14, 24], [-14, 8], [-2, 8], [-2, 24]].map(([x, y]) => [{ bone: 'body', x, y, weight: 1 }]),
        },
        {
          slot: 'cloth__island2',
          bone: 'eye',
          uvs: [0.5, 0, 0.5, 1, 1, 1, 1, 0],
          triangles: [0, 1, 2, 0, 2, 3],
          hull: 4,
          weights: [[1, 22], [1, 6], [13, 6], [13, 22]].map(([x, y]) => [{ bone: 'eye', x, y, weight: 1 }]),
        },
      ],
    },
  };
  const config = rigConfig();
  config.meshes = { cloth: mesh };
  return { config, mesh, parts, images };
}

/** Four flat blocks; the stopped lower-link rider must stay between its limb segments. */
export function stoppedLimbFixture() {
  const parts = rigParts(), template = parts.parts[0];
  parts.parts = ['upper', 'unrelated', 'rider', 'lower'].map(name => ({ ...template, name }));
  const images = new Map(parts.parts.map(p => [p.name, block(p.w, p.h)]));
  const config: Record<string, unknown> = {
    key: 'stopped_limb',
    assemble: { rig_scale: 0.5, plan: [['source', 'full', 'legwear'], ['rider', 'full', 'topwear'], ['unrelated', 'head', 'face']] },
    bones: [{ name: 'body', parent: 'root', at: [20, 30] }, { chain: 'leg', parent: 'body', points: [[14, 14], [22, 14]], tip: [30, 14] }],
    limbs: { limb: { segments: [{ part: 'upper', from: 'source', bone: 'leg0' }, { part: 'lower', from: 'source', bone: 'leg1', joint: 'knee' }] } },
    regions: { upper: 'leg0', lower: 'leg1', unrelated: 'body' }, meshes: { rider: { grid: 8, r: 8, segments: ['leg1'] } },
    motion: { duration: 4, tracks: [{ bone: 'body', prop: 'rotate', amp: 0, period: 4, phase: 0 }] },
    stops: [{ chain: 'leg', against: 'body', at: [0, 0], inward: -45, outward: 45, lower: { inward: -45, outward: 45 } }],
  };
  return { config, parts, images };
}
