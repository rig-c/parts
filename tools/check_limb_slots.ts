/** Narrow generated controls for #646. Full-suite integration is separate. */
import { mock } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeLimbSlotFixture, SLOT_IDENTITIES } from '../fixtures/limb_slots.ts';
import { rigConfig, rigImages, rigParts } from '../fixtures/rig.ts';
import { assembleStage } from '../src/build.ts';
import { loadConfig, parseConfig, type Limb } from '../src/config.ts';
import { coalesceLimbSlots } from '../src/limbslots.ts';
import * as slotModule from '../src/limbslots.ts';
import { readParts, type PartsFile } from '../src/parts.ts';
import { readPng, writePng } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { buildRig, type RigOutput, type RigSpec, type MeshAttachment } from '../src/rig.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
const names = (rig: RigSpec): string[] => rig.slots.map((s) => s.name);
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const save = (path: string, value: unknown): void => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

/** Source PNG contract on one common crop grid; actual rigc render is a separate gate. */
function flat(parts: PartsFile, images: ReadonlyMap<string, Raster>, order: readonly string[]): Raster {
  const out = newRaster(...parts.rig_size);
  for (const name of order) {
    const p = parts.parts.find((p) => p.name === name), img = images.get(name);
    if (p === undefined || img === undefined) throw new Error(`GENERATED_PART_MISSING: ${name}`);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const px = p.x + x, py = p.y + y;
      if (px < 0 || py < 0 || px >= out.width || py >= out.height) continue;
      const i = (y * img.width + x) * 4, j = (py * out.width + px) * 4;
      const a = img.data[i + 3] / 255, b = out.data[j + 3] / 255, c = a + b * (1 - a);
      if (c === 0) continue;
      for (let k = 0; k < 3; k++) out.data[j + k] = Math.round((img.data[i + k] * a + out.data[j + k] * b * (1 - a)) / c);
      out.data[j + 3] = Math.round(c * 255);
    }
  }
  return out;
}

function changed(a: Raster, b: Raster): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error('SAME_GRID_REQUIRED');
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) if ([0, 1, 2, 3].some((k) => a.data[i + k] !== b.data[i + k])) n++;
  return n;
}

/** Exact names of inverted, overlapping source PNG pairs; no colour classifier. */
function overlaps(parts: PartsFile, images: ReadonlyMap<string, Raster>, before: readonly string[], after: readonly string[]) {
  const result: Array<{ pair: [string, string]; overlappingPixels: number }> = [];
  for (let i = 0; i < before.length; i++) for (let j = i + 1; j < before.length; j++) {
    const a = before[i], b = before[j];
    if (after.indexOf(a) < after.indexOf(b)) continue;
    const pa = parts.parts.find((p) => p.name === a), pb = parts.parts.find((p) => p.name === b);
    const ia = images.get(a), ib = images.get(b);
    if (!pa || !pb || !ia || !ib) throw new Error('GENERATED_PAIR_MISSING');
    let n = 0;
    for (let y = Math.max(pa.y, pb.y); y < Math.min(pa.y + pa.h, pb.y + pb.h); y++) for (let x = Math.max(pa.x, pb.x); x < Math.min(pa.x + pa.w, pb.x + pb.w); x++) {
      if (ia.data[((y - pa.y) * ia.width + x - pa.x) * 4 + 3] > 0 && ib.data[((y - pb.y) * ib.width + x - pb.x) * 4 + 3] > 0) n++;
    }
    if (n > 0) result.push({ pair: [a, b], overlappingPixels: n });
  }
  return result;
}

function outputBytes(built: RigOutput): unknown {
  return { ...built, images: built.images.map(([name, r]) => [name, r.width, r.height, [...r.data]]) };
}

/** An in-memory dependency fault, never a product flag or an on-disk mutant. */
function withIdentityCoalescer<T>(run: () => T): { value: T; calls: number } {
  const nativeExports = { ...slotModule };
  const module = import.meta.resolve('../src/limbslots.ts');
  let calls = 0;
  const identity: typeof coalesceLimbSlots = (_limbs, _bones, slots, _skin) => {
    calls++;
    return { slots, owners: [], anchors: [] };
  };
  mock.module(module, () => ({ ...nativeExports, coalesceLimbSlots: identity }));
  try {
    return { value: run(), calls };
  } finally {
    mock.module(module, () => nativeExports);
  }
}

/** Unit matrix uses arbitrary identities and inspects every attachment/weight. */
function ownershipChecks(say: Say): void {
  const limbs: Record<string, Limb> = {
    first: { segments: [{ part: 'a0', from: 'source', bone: 'u0' }, { part: 'a1', from: 'source', bone: 'u1', joint: 'hinge' }] },
    second: { segments: [{ part: 'b0', from: 'source', bone: 'v0' }, { part: 'b1', from: 'source', bone: 'v1', joint: 'hinge' }] },
  };
  const bones: RigSpec['bones'] = [{ name: 'root', x: 0, y: 0 }, ...[['u0', 'root'], ['u1', 'u0'], ['leaf', 'u1'], ['v0', 'root'], ['v1', 'v0']].map(([name, parent]) => ({ name, parent, x: 0, y: 0 }))];
  const mesh = (...bs: string[]): MeshAttachment => ({ type: 'mesh', image: 'block.png', width: 1, height: 1, uvs: [], triangles: [], hull: 0, weights: [bs.map((bone) => ({ bone, x: 0, y: 0, weight: 1 / bs.length }))] });
  const entries: Array<[string, string]> = [['a1', 'u1'], ['a0', 'u0'], ['b1', 'v1'], ['b0', 'v0'], ['target', 'root'], ['rider', 'leaf'], ['weighted', 'v1'], ['mixed', 'u1'], ['switching', 'u1'], ['outside_mix', 'u1']];
  const slots = entries.map(([name, bone]) => ({ name, bone, attachment: name }));
  const skin: RigSpec['skins']['default'] = Object.fromEntries(entries.map(([name]) => [name, { [name]: { image: 'block.png', x: 0, y: 0 } }]));
  skin.weighted = { base: mesh('u0', 'leaf'), alternate: mesh('u1') };
  skin.mixed = { base: mesh('u1', 'v1') };
  skin.switching.alt = mesh('v1');
  skin.outside_mix = { base: mesh('u1', 'root') };
  const r = coalesceLimbSlots(limbs, bones, slots, skin), owner = new Map(r.owners.map((o) => [o.slot, o]));
  say('ALL_WEIGHTS_AND_ALTERNATES', owner.get('weighted')?.limb === 'first', JSON.stringify(owner.get('weighted')));
  say('MIXED_WEIGHT_NONEXCLUSIVE', owner.get('mixed')?.kind === 'nonexclusive', JSON.stringify(owner.get('mixed')));
  say('SWITCHING_ATTACHMENT_NONEXCLUSIVE', owner.get('switching')?.kind === 'nonexclusive', JSON.stringify(owner.get('switching')));
  say('LIMB_PLUS_OUTSIDE_NONEXCLUSIVE', owner.get('outside_mix')?.kind === 'nonexclusive', JSON.stringify(owner.get('outside_mix')));
  say('STABLE_BLOCKS_AND_RIDERS', equal(r.slots.map((s) => s.name), ['a1', 'a0', 'rider', 'weighted', 'b1', 'b0', 'target', 'mixed', 'switching', 'outside_mix']), JSON.stringify(r.slots.map((s) => s.name)));
  say('IDEMPOTENT', equal(coalesceLimbSlots(limbs, bones, r.slots, skin).slots, r.slots), 'reapplying closure does not change order');
  say('NO_LIMBS_REFERENCE_IDENTITY', coalesceLimbSlots(undefined, bones, slots, skin).slots === slots, 'no limb means no permutation');
  const nested = { ...limbs, nested: { segments: [{ part: 'z0', from: 'source', bone: 'leaf' }, { part: 'z1', from: 'source', bone: 'leaf2', joint: 'hinge' }] } };
  const nest = coalesceLimbSlots(nested, [...bones, { name: 'leaf2', parent: 'leaf', x: 0, y: 0 }], [...slots, { name: 'z0', bone: 'leaf', attachment: 'z0' }, { name: 'z1', bone: 'leaf2', attachment: 'z1' }], { ...skin, z0: { z0: { image: 'block.png', x: 0, y: 0 } }, z1: { z1: { image: 'block.png', x: 0, y: 0 } } });
  say('NESTED_LIMB_BOUNDARY', nest.owners.find((o) => o.slot === 'rider')?.limb === 'nested', 'a declared segment starts its own domain; no ancestor-limb capture');
  const shared = { ...limbs, shared: { segments: limbs.first.segments.map((s) => ({ ...s, part: `other_${s.part}` })) } };
  say('SHARED_SEGMENT_NONEXCLUSIVE', coalesceLimbSlots(shared, bones, slots, skin).owners.find((o) => o.slot === 'rider')?.kind === 'nonexclusive', 'a bone explicitly named by two limbs is not assigned to either');
  const zero = structuredClone(skin); zero.weighted = { base: mesh('u0', 'v0') }; const att = zero.weighted.base as MeshAttachment; att.weights[0][1].weight = 0;
  say('LISTED_ZERO_REFERENCE_CONSERVATIVE', coalesceLimbSlots(limbs, bones, slots, zero).owners.find((o) => o.slot === 'weighted')?.kind === 'nonexclusive', 'all named references are inspected; no numerical epsilon');
}

/**
 * CI's baseline is the identity-coalescer fault around each actual builder call.
 * An optional frozen-original builder is external evidence only: when supplied,
 * every fault baseline is compared with it. No history or private input is read.
 */
export function runLimbSlotChecks(dir: string, say: Say, frozenOriginal?: typeof buildRig): void {
  mkdirSync(dir, { recursive: true });
  ownershipChecks(say);
  const baseline = (label: string, ...args: Parameters<typeof buildRig>): RigOutput => {
    const native = slotModule.coalesceLimbSlots;
    const fault = withIdentityCoalescer(() => buildRig(...args));
    say(`${label}_IDENTITY_FAULT_OBSERVED`, fault.calls === 1, `builder called the identity dependency ${fault.calls} time(s)`);
    say(`${label}_NATIVE_FUNCTION_RESTORED`, slotModule.coalesceLimbSlots === native, 'try/finally restored the exact function');
    if (frozenOriginal !== undefined) say(`${label}_FROZEN_ORIGINAL_EQUIVALENCE`, equal(outputBytes(fault.value), outputBytes(frozenOriginal(...args))), 'independent frozen original agrees with identity fault on every emitted byte');
    return fault.value;
  };
  const native = slotModule.coalesceLimbSlots, planted = new Error('PLANTED_IDENTITY_SCOPE_THROW');
  let caught: unknown;
  try { withIdentityCoalescer(() => { throw planted; }); } catch (error) { caught = error; }
  say('NATIVE_FUNCTION_RESTORED_AFTER_THROW', caught === planted && slotModule.coalesceLimbSlots === native, 'a planted throw cannot leave the dependency fault installed');
  for (const [label, overlap, generic] of [['positive', false, false], ['overlap', true, false], ['generic', false, true]] as const) {
    const home = join(dir, label), assembled = join(home, 'assembled');
    writeLimbSlotFixture(home, overlap, generic);
    assembleStage({ source: join(home, 'painting.png'), full: join(home, 'full'), head: join(home, 'head'), config: join(home, 'config.json'), project: 'core', seam: 'near-white' }, { partsJson: join(assembled, 'parts.json'), partsDir: join(assembled, 'parts'), recomposite: join(assembled, 'recomposite.png'), errorMap: join(assembled, 'error.png') }, () => {});
    const cfg = loadConfig(join(home, 'config.json')), parts = readParts(join(assembled, 'parts.json'));
    const images = new Map(parts.parts.map((p) => [p.name, readPng(join(assembled, 'parts', `${p.name}.png`))]));
    const built = buildRig(cfg, parts, images), before = parts.parts.map((p) => p.name), after = names(built.rig);
    const expected = ['foot_r', 'shin_r', 'thigh_r', 'crest_r', 'foot_l', 'shin_l', 'thigh_l', 'crest_l', 'forearm_r', 'upperarm_r', 'screen'].map((n) => generic ? SLOT_IDENTITIES[n] ?? n : n);
    say(`${label}_EXPLICIT_CLOSURE`, equal(after, expected), JSON.stringify(after));
    const source = flat(parts, images, before), current = flat(parts, images, after), pixels = changed(source, current);
    const pairs = overlaps(parts, images, before, after);
    say(`${label}_SETUP_PNG_CONTRACT`, overlap ? pixels > 0 && pairs.some((p) => p.pair.includes('screen') && p.pair.includes('crest_r')) : pixels === 0, JSON.stringify({ pixels, pairs }));
    writePng(join(home, 'before-flat.png'), source); writePng(join(home, 'after-flat.png'), current);
    save(join(home, 'layout.json'), { before, after, pixels, pairs, scope: 'source PNG grid; actual rig render is independent' });
    save(join(home, 'built-rig.json'), built.rig);
    {
      const old = baseline(label, cfg, parts, images);
      say(`${label}_ORIGINAL_ORDER_NEGATIVE`, equal(names(old.rig), before) && !equal(before, after), JSON.stringify(names(old.rig)));
      say(`${label}_ONLY_SLOT_PERMUTATION`, equal(outputBytes({ ...built, rig: { ...built.rig, slots: old.rig.slots } }), outputBytes(old)), 'images, bindings, bones, motion, sets and reports unchanged');
    }
    if (label !== 'positive') continue;
    const altParts = structuredClone(parts), patch = parts.parts.find((p) => p.name === 'crest_r');
    if (!patch || !parts.recomposite) throw new Error('GENERATED_PATCH_AND_RECOMPOSITE_REQUIRED');
    altParts.alternates = [{ name: 'alternate', slots: { crest_r: 'alternate_crest_r' }, records: [structuredClone(patch)], ghost_px: {}, recomposite: parts.recomposite }];
    const altImages = new Map(images); altImages.set('alternate_crest_r', images.get('crest_r') as Raster);
    const alt = buildRig(cfg, altParts, altImages);
    say('EMITTED_ALTERNATE_RETAINED', equal(names(alt.rig), after) && Object.hasOwn(alt.rig.skins.default.crest_r, 'alternate_crest_r') && alt.sets?.sets.alternate.slots.crest_r === 'alternate_crest_r', 'existing slot, actual alternate attachment and set mapping');
    const stillCfg = structuredClone(cfg), stillImages = new Map(images), split = structuredClone(images.get('crest_r') as Raster);
    split.data.fill(0, 2 * split.width * 4, 3 * split.width * 4);
    stillImages.set('crest_r', split);
    stillCfg.motion.duration = 4;
    stillCfg.motion.blink = { t: 1, eyes: ['foot_r'], brows: ['hip'], squash: 0.12, brow_drop: 1, still: { crest_r: { row: patch.y + 2, bone: 'foot_l' } } };
    const still = buildRig(stillCfg, parts, stillImages), stillOrder = names(still.rig);
    say('STILL_USES_OWN_BINDING', stillOrder.indexOf('crest_r_still') > stillOrder.indexOf('thigh_l') && stillOrder.indexOf('crest_r_still') < stillOrder.indexOf('crest_l'), JSON.stringify(stillOrder));
    {
      const old = baseline('still', stillCfg, parts, stillImages);
      say('STILL_ONLY_SLOT_PERMUTATION', equal(outputBytes({ ...still, rig: { ...still.rig, slots: old.rig.slots } }), outputBytes(old)), 'the still is classified independently of its source part');
    }
    const rebound = structuredClone(cfg);
    rebound.stops = [{ chain: 'leg_r', against: 'hip', at: [0, 0], inward: 90, outward: 90, lower: { inward: 90, outward: 90 } }];
    rebound.turn = { pivot: 0.8, depths: Object.fromEntries(parts.parts.map((p) => [p.name, p.name === 'screen' ? 0.8 : 0.2])) };
    const stopped = buildRig(rebound, altParts, altImages);
    save(join(home, 'rebound-rig.json'), stopped.rig);
    save(join(home, 'rebound-turn.json'), stopped.turn);
    say('STOPS_TURN_AND_ALTERNATES', equal(names(stopped.rig), after) && stopped.turn !== null && stopped.rig.stops?.length === 1 && Object.hasOwn(stopped.rig.skins.default.crest_r, 'alternate_crest_r'), 'ownership captured before rebind; all attachments remain');
    {
      const old = baseline('rebind', rebound, altParts, altImages);
      say('REBIND_ONLY_SLOT_PERMUTATION', equal(outputBytes({ ...stopped, rig: { ...stopped.rig, slots: old.rig.slots } }), outputBytes(old)), 'original twin, bone and constraint enumeration retained');
    }
  }
  for (const [label, raw] of [['undefined', rigConfig()], ['empty', { ...rigConfig(), limbs: {} }]] as const) {
    const cfg = parseConfig(raw), parts = rigParts(), images = rigImages();
    say(`NO_LIMBS_${label.toUpperCase()}_ALL_OUTPUT_BYTES`, equal(outputBytes(buildRig(cfg, parts, images)), outputBytes(baseline(`no_limbs_${label}`, cfg, parts, images))), 'full emitted builder output including image bytes');
  }
  writeFileSync(join(dir, 'README.txt'), 'Generated flat blocks only. PNG composition is distinct from rigc compile/packed gate/render and pinned pose consumption. No forearm/torso or appearance claim.\n');
}
