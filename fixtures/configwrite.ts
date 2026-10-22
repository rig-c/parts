/** Synthetic config fields for #356; no artwork, model output or private data. */
import { rigConfig } from './rig.ts';
import { parseConfig } from '../src/config.ts';
import type { Proposal } from '../src/propose.ts';

export function configWriteFixture(): Record<string, unknown> {
  return {
    ...rigConfig(),
    note: 'Preserve this authored note.',
    'x-record': { path: '../source.png', nested: { a: 1, b: [false, null, 'kept'] } },
    seethrough: { resolution: 64, steps: 1, seed: 0, offload: false, head_box: [0, 0, 8, 8] },
    constraints: [],
  };
}
export function configWriteProposal(): Proposal {
  const base = parseConfig(rigConfig());
  return {
    bones: base.bones, meshes: base.meshes, regions: base.regions,
    motion: { duration: 4, tracks: [{ chain: 'hem', amps: [1, 2], period: 4, phase: 0, lag: 0.1 }] },
    proposed_rig_scale: 0.5,
    notes: ['This belongs only in the proposal.'],
  };
}
