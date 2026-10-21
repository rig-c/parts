/** Public flat blocks for #646; no art, anatomical naming rule or appearance claim. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { flatPainting, HEAD_LAYERS, limbConfig, LIMB_FULL, LIMB_PLAN, writeAssembleFixture } from './assemble_fixture.ts';

/** Rename identities, including chain expansions, while retaining source tags. */
export const SLOT_IDENTITIES: Readonly<Record<string, string>> = {
  hip: 'junction', sleeve_r: 'branchA', sleeve_r0: 'branchA0', sleeve_r1: 'branchA1',
  leg_r: 'branchB', leg_r0: 'branchB0', leg_r1: 'branchB1',
  leg_l: 'branchC', leg_l0: 'branchC0', leg_l1: 'branchC1',
  foot_r: 'leafB', foot_l: 'leafC', arm_r: 'unitA',
  upperarm_r: 'tileA0', forearm_r: 'tileA1', thigh_r: 'tileB0', shin_r: 'tileB1',
  thigh_l: 'tileC0', shin_l: 'tileC1', legs: 'sourceB', shoes: 'sourceC', arm: 'sourceA',
  screen: 'tileD', crest_r: 'tileE', crest_l: 'tileF',
};

export function renameSlotIdentities(value: unknown): unknown {
  if (typeof value === 'string') return SLOT_IDENTITIES[value] ?? value;
  if (Array.isArray(value)) return value.map(renameSlotIdentities);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [SLOT_IDENTITIES[k] ?? k, renameSlotIdentities(v)]));
  return value;
}

/**
 * The existing segment blocks are already adjacent. An unrelated screen is
 * AFTER them and BEFORE two front patches explicitly bound to their foot bones.
 * The positive screen is disjoint from every limb. The planted screen overlaps
 * the right patch: this is a separate generated input, never a setup promise.
 */
export function writeLimbSlotFixture(dir: string, overlap = false, generic = false): void {
  const cfg = limbConfig();
  const assemble = cfg.assemble as Record<string, unknown>;
  assemble.plan = [...LIMB_PLAN, ['screen', 'full', 'topwear']];
  assemble.patches = [
    { name: 'crest_r', box: [29, 50, 39, 55], alpha: 'box', draw: 'front' },
    { name: 'crest_l', box: [43, 50, 53, 55], alpha: 'box', draw: 'front' },
  ];
  cfg.regions = { ...(cfg.regions as Record<string, string>), screen: 'hip', crest_r: 'foot_r', crest_l: 'foot_l' };
  // An explicit static track closes the declared idle duration at rigc's gate.
  cfg.motion = { duration: 1, tracks: [{ bone: 'hip', prop: 'rotate', amp: 0, base: 0, period: 1, phase: 0 }] };
  const [x0, y0, x1, y1] = overlap ? [30, 48, 38, 56] : [56, 10, 64, 18];
  writeAssembleFixture(dir, cfg, flatPainting(), {
    full: [...LIMB_FULL, { name: 'topwear', depth: 0.3, rects: [{ x0, y0, x1, y1, colour: [0, 0, 0] }] }],
    head: HEAD_LAYERS,
  });
  if (generic) {
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify(renameSlotIdentities(JSON.parse(readFileSync(path, 'utf8'))), null, 2) + '\n');
  }
}
