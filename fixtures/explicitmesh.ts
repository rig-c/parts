/** Four corners of the rig fixture's padded cloth, derived in bone-local Spine pixels. */
import { rigConfig, rigImages, rigParts } from './rig.ts';
import type { ExplicitMeshSpec } from '../src/config.ts';
import { explicitImageHash, explicitRegionHash } from '../src/explicitmesh.ts';

export function explicitFixture(): { config: Record<string, unknown>; mesh: ExplicitMeshSpec } {
  const parts = rigParts(), image = rigImages().get('cloth');
  if (image === undefined) throw new Error('synthetic cloth missing');
  // The 24x16 padded image starts at crop (6,6). body stands at crop (20,30).
  const mesh: ExplicitMeshSpec = { segments: ['body'], explicit: {
    image_sha256: explicitImageHash(image), region_sha256: explicitRegionHash(parts.rig_size, parts.parts[0]),
    uvs: [0, 0, 0, 1, 1, 1, 1, 0], triangles: [0, 1, 2, 0, 2, 3], hull: 4,
    weights: [[-14, 24], [-14, 8], [10, 8], [10, 24]].map(([x, y]) => [{ bone: 'body', x, y, weight: 1 }]),
  } };
  const config = rigConfig(); config.meshes = { cloth: mesh };
  return { config, mesh };
}
