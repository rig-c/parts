import { measureRecomposite, recomposite, recompositeRecord } from '../src/assemble.ts';
/** Generated setup-order controls for declared rider gathering opt-outs (#680). */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rigStage } from '../src/build.ts';
import { flatComposite, readFrameSet, runCheck, seamFigures, type RigcRunner, type StageBox } from '../src/check.ts';
import { loadConfig, parseConfig, parseProposalSections, partBoundBones, type CharacterConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { readParts, writeParts, type PartsFile } from '../src/parts.ts';
import { readPng, writePng } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { buildRig, type RigOutput, type RigSpec } from '../src/rig.ts';
import { refreshLimbLayout } from '../src/limblayout.ts';

type Json = Record<string, unknown>;
type Say = (name: string, pass: boolean, detail: string) => void;
const save = (path: string, data: unknown): void => writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
export function gatherOutputBytes(r: RigOutput): unknown {
  return { ...r, images: r.images.map(([n, i]) => [n, i.width, i.height, [...i.data]]) };
}
function refusal(run: () => unknown): string {
  try { run(); return ''; } catch (e) { if (e instanceof PartsError) return e.message; throw e; }
}

/**
 * Fixed before measurement: 64px canvas, 24x36 cloth, 32x28 skirt.
 * Their setup overlap is [16,32)x[32,56) = 384 rig pixels by hand.
 * No consumer art or consumer seam count is used. The two arm sources each
 * declare two segments; the cloth's two-link chain hangs from the right elbow.
 */
export function writeGatherFixture(home: string, region = false): string {
  mkdirSync(join(home, 'parts'), { recursive: true });
  const boxes: Array<[string, string, number, number, number, number, [number, number, number]]> = [
    ['torso', 'full:topwear', 20, 0, 24, 64, [140, 100, 70]],
    ['upperarm_r', 'full:handwear-r', 6, 8, 6, 16, [180, 50, 70]],
    ['forearm_r', 'full:handwear-r', 6, 24, 6, 24, [180, 50, 70]],
    ['upperarm_l', 'full:handwear-l', 52, 8, 6, 16, [180, 50, 70]],
    ['forearm_l', 'full:handwear-l', 52, 24, 6, 24, [180, 50, 70]],
    ['bottomwear', 'full:bottomwear', 16, 32, 32, 28, [30, 50, 150]],
    ['shawl_r', 'full:author:cloth', 8, 20, 24, 36, [230, 190, 30]],
  ];
  const parts: PartsFile = { rig_size: [64, 64], scale_rig_per_source: 1, ghost_px: {}, parts: boxes.map(([name, from, x, y, w, h]) => ({ name, from, x, y, w, h, opaque_px: w * h, projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 })) };
  for (const [name, , , , w, h, rgb] of boxes) {
    const r = newRaster(w, h);
    for (let i = 0; i < w * h; i++) r.data.set([...rgb, 255], i * 4);
    writePng(join(home, 'parts', name + '.png'), r);
  }
  writeParts(join(home, 'parts.json'), parts);
  const config = {
    key: 'gather_fixture',
    assemble: { rig_scale: 1, plan: [['torso', 'full', 'topwear'], ['source_r', 'full', 'handwear-r'], ['source_l', 'full', 'handwear-l'], ['bottomwear', 'full', 'bottomwear'], ['shawl_r', 'full', 'author:cloth']] },
    bones: [
      { name: 'body', parent: 'root', at: [32, 8] },
      { chain: 'sleeve_r', parent: 'body', points: [[9, 8], [9, 24]], tip: [9, 48] },
      { chain: 'sleeve_l', parent: 'body', points: [[55, 8], [55, 24]], tip: [55, 48] },
      { chain: 'drape', parent: 'sleeve_r1', points: [[20, 20], [20, 38]], tip: [20, 56] },
    ],
    limbs: {
      arm_r: { segments: [{ part: 'upperarm_r', from: 'source_r', bone: 'sleeve_r0' }, { part: 'forearm_r', from: 'source_r', bone: 'sleeve_r1', joint: 'elbow' }] },
      arm_l: { segments: [{ part: 'upperarm_l', from: 'source_l', bone: 'sleeve_l0' }, { part: 'forearm_l', from: 'source_l', bone: 'sleeve_l1', joint: 'elbow' }] },
    },
    meshes: region ? {} : { shawl_r: { grid: 6, r: 6, segments: ['drape'] } },
    regions: { torso: 'body', upperarm_r: 'sleeve_r0', forearm_r: 'sleeve_r1', upperarm_l: 'sleeve_l0', forearm_l: 'sleeve_l1', bottomwear: 'body', ...(region ? { shawl_r: 'drape0' } : {}) },
    motion: { duration: 1, tracks: [{ bone: 'body', prop: 'rotate', amp: 0, period: 1, phase: 0 }] },
  };
  const path = join(home, 'config.json'); save(path, config); return path;
}

function inputs(home: string): { parts: PartsFile; images: Map<string, Raster> } {
  const parts = readParts(join(home, 'parts.json'));
  return { parts, images: new Map(parts.parts.map((p) => [p.name, readPng(join(home, 'parts', p.name + '.png'))])) };
}

/** Real core render on the declared canvas grid; every RGBA pixel is compared. */
function setup(home: string, runner: RigcRunner, rig: RigSpec, parts: PartsFile): { different: number; mean: number } {
  const gate = runner(['build', '--rig', join(home, 'rig/rig.json'), '--motion', join(home, 'rig/motion.json'), '--out', join(home, 'unit-build'), '--profile', 'rig-play']);
  if (gate.status !== 0) throw new Error(gate.out);
  const rendered = runner(['render', '--candidate', join(home, 'unit-build'), '--animation', 'idle', '--fps', '1', '--max', '64', '--viewport', '-32,0,64,64', '--out', join(home, 'unit-render')]);
  if (rendered.status !== 0) throw new Error(rendered.out);
  const set = readFrameSet(join(home, 'unit-render')), frame = set.frames[0].image;
  const flat = flatComposite(parts, join(home, 'parts'), set.background);
  let different = 0;
  if (frame.width !== flat.width || frame.height !== flat.height) throw new Error('GENERATED_UNIT_GRID_REQUIRED');
  for (let i = 0; i < flat.data.length; i += 4) if ([0, 1, 2, 3].some((k) => flat.data[i + k] !== frame.data[i + k])) different++;
  const figures = seamFigures(flat, frame, rig.skeleton as StageBox, set.viewport, set.background);
  save(join(home, 'unit-grid.json'), { different, figures, viewport: set.viewport });
  return { different, mean: figures.mean };
}

export function runGatherOptOutChecks(dir: string, say: Say, runner: RigcRunner, frozenBuilder?: typeof buildRig): void {
  mkdirSync(dir, { recursive: true });
  for (const region of [false, true]) {
    const label = region ? 'REGION' : 'MESH', home = join(dir, label), path = writeGatherFixture(home, region);
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Json;
    const cfg = loadConfig(path), { parts, images } = inputs(home), original = buildRig(cfg, parts, images);
    if (frozenBuilder !== undefined) say(`${label}_FROZEN_DEFAULT_BYTES`, equal(gatherOutputBytes(original), gatherOutputBytes(frozenBuilder(cfg, parts, images))), 'every RigOutput field, image dimension and RGBA byte compared with frozen pre-change builder');
    say(`${label}_DEFAULT_REPRODUCTION`, original.rig.slots.findIndex((s) => s.name === 'shawl_r') < original.rig.slots.findIndex((s) => s.name === 'bottomwear'), JSON.stringify(original.rig.slots.map((s) => s.name)));
    const base = structuredClone(raw), regions = base.regions as Json, meshes = base.meshes as Json;
    if (region) regions.shawl_r = { bone: 'drape0', gather: false };
    else (meshes.shawl_r as Json).gather = false;
    save(path, base); const opted = loadConfig(path);
    const result = rigStage({ config: path, parts: home, out: join(home, 'rig') }, runner, join(home, 'scratch'), () => {});
    say(`${label}_AUTHORED_ORDER`, equal(result.rig.slots.map((s) => s.name), parts.parts.map((p) => p.name)), JSON.stringify(result.rig.slots.map((s) => s.name)));
    say(`${label}_ONLY_SLOT_ORDER_CHANGES`, equal(gatherOutputBytes({ ...result, rig: { ...result.rig, slots: original.rig.slots } }), gatherOutputBytes(original)), 'all transforms, bindings, motion, images and reports unchanged');
    const report = runCheck(join(home, 'rig'), join(home, 'check'), runner, home, undefined, undefined, undefined, true, true, undefined, undefined, undefined, undefined, undefined, undefined, true);
    say(`${label}_ACTUAL_SEAM_GATE`, !report.problems.some((p) => p.code === 'CHECK_SEAM_WITHIN_BAR') && typeof report.figures.seam_px_over_40 === 'number', JSON.stringify({ seam: report.figures.seam_px_over_40, unrelated: [...new Set(report.problems.map((p) => p.code))] }));
    const unit = setup(home, runner, result.rig, parts);
    say(`${label}_SETUP_EQUALS_FLAT_RGBA`, unit.different === 0 && unit.mean === 0, JSON.stringify(unit));
    say(`${label}_BINDING_READERS`, partBoundBones(opted).get('shawl_r')?.includes('drape0') === true && refusal(() => parseProposalSections({ bones: opted.bones, meshes: opted.meshes, regions: opted.regions, motion: opted.motion })) === '', 'full/proposal reader accepts the declaration and binds the authored chain');
    const placed = structuredClone(opted); placed.limbs!.arm_r.layout = { parts: ['forearm_r'], after: { part: 'bottomwear' } };
    const layout = buildRig(placed, parts, images);
    say(`${label}_LAYOUT_DOES_NOT_RECAPTURE`, layout.layout !== undefined && !layout.layout.placements[0].slots.includes('shawl_r') && layout.rig.slots.at(-1)?.name === 'shawl_r', JSON.stringify(layout.layout?.placements));
    if (layout.layout !== undefined) {
      const plan = refreshLimbLayout(layout.layout, layout.rig);
      say(`${label}_REPLAY_RETAINS_OPT_OUT`, !plan.placements[0].slots.includes('shawl_r') && layout.rig.slots.at(-1)?.name === 'shawl_r', JSON.stringify(plan.placements));
    }
    const mutations: Array<[string, (x: CharacterConfig) => void]> = [
      ['NON_RIDER', (x) => { x.regions.torso = { bone: 'body', gather: false }; }],
      ['SEGMENT', (x) => { x.regions.forearm_r = { bone: 'sleeve_r1', gather: false }; }],
      ['NO_LIMBS', (x) => { delete x.limbs; }],
      ['OUTSIDE_BINDING', (x) => { if (region) x.regions.shawl_r = { bone: 'body', gather: false }; else x.meshes.shawl_r.segments = [['body', [20, 20], [20, 56]]]; }],
      ['MIXED_BINDING', (x) => { if (region) x.bones.find((b) => 'chain' in b && b.chain === 'drape')!.parent = 'body'; else x.meshes.shawl_r.segments = ['sleeve_r1', 'sleeve_l1']; }],
    ];
    for (const [name, mutate] of mutations) {
      const bad = structuredClone(opted); mutate(bad);
      const message = refusal(() => buildRig(bad, parts, images));
      say(`${label}_${name}_REFUSED`, message.includes('RIG_GATHER_RIDER') && message.includes('gather'), message);
    }
    for (const value of [true, null, 0, 'false']) {
      const bad = structuredClone(base), entry = (region ? (bad.regions as Json).shawl_r : (bad.meshes as Json).shawl_r) as Json; entry.gather = value;
      const message = refusal(() => parseConfig(bad));
      say(`${label}_VALUE_${String(value)}_REFUSED`, message.includes('CONFIG_FIELD_TYPE') && message.includes('.gather'), message);
    }
    if (region) {
      const objectOnly = structuredClone(cfg); objectOnly.regions.shawl_r = { bone: 'drape0' };
      say('OBJECT_WITHOUT_KEY_SAME_OUTPUT', equal(gatherOutputBytes(buildRig(objectOnly, parts, images)), gatherOutputBytes(original)), 'region object bone and historical string bind identically without gather');
      const unknown = structuredClone(base); ((unknown.regions as Json).shawl_r as Json).typo = false;
      say('REGION_OBJECT_UNKNOWN_KEY_REFUSED', refusal(() => parseConfig(unknown)).includes('CONFIG_KEY_KNOWN'), 'only bone and gather, plus the standard annotation/record doors');
      const missing = structuredClone(base); delete ((missing.regions as Json).shawl_r as Json).bone;
      say('REGION_OBJECT_MISSING_BONE_REFUSED', refusal(() => parseConfig(missing)).includes('CONFIG_FIELD_PRESENT'), 'bone remains required');
    }
    const pixels = parts.parts.map((p) => ({ ...p, image: images.get(p.name)!, record: p }));
    const canvas = recomposite(pixels, ...parts.rig_size);
    const metrics = recompositeRecord(measureRecomposite(canvas, canvas, pixels));
    const alt = structuredClone(parts); alt.alternates = [{ name: 'alternate', slots: { shawl_r: 'alternate_shawl_r' }, records: [structuredClone(parts.parts.at(-1)!)], ghost_px: {}, recomposite: metrics }];
    const altImages = new Map(images); altImages.set('alternate_shawl_r', images.get('shawl_r')!);
    const alternate = buildRig(opted, alt, altImages);
    say(`${label}_ALTERNATE_ATTACHMENTS_RETAINED`, equal(alternate.rig.slots.map((s) => s.name), parts.parts.map((p) => p.name)) && Object.hasOwn(alternate.rig.skins.default.shawl_r, 'alternate_shawl_r'), 'all alternate bindings are still classified; attachment and set mapping preserved');
    const shared = structuredClone(opted); shared.limbs!.arm_r.layout = { parts: ['forearm_r'], after: { part: 'torso' } }; shared.limbs!.arm_l.layout = { parts: ['forearm_l'], after: { part: 'torso' } };
    const sharedBuilt = buildRig(shared, parts, images), sharedOrder = sharedBuilt.rig.slots.map((s) => s.name);
    say(
      `${label}_SHARED_TARGET_PRESERVES_OPT_OUT`,
      sharedBuilt.layout !== undefined &&
        !sharedBuilt.layout.placements.some((p) => p.slots.includes('shawl_r')) &&
        sharedOrder.at(-1) === 'shawl_r' &&
        sharedOrder.indexOf('torso') + 1 === sharedOrder.indexOf('forearm_r') &&
        sharedOrder.indexOf('forearm_r') + 1 === sharedOrder.indexOf('forearm_l'),
      JSON.stringify(sharedBuilt.layout?.placements),
    );
    const chained = structuredClone(opted); chained.limbs!.arm_r.layout = { parts: ['forearm_r'], after: { part: 'torso' } }; chained.limbs!.arm_l.layout = { parts: ['forearm_l'], after: { part: 'forearm_r' } };
    say(`${label}_CHAINED_TARGET_STILL_REFUSED`, refusal(() => buildRig(chained, parts, images)).includes('RIG_LAYOUT_CONFLICT'), 'gather does not change mover-as-target placement conflict rules');
    // One source arm starts behind the torso; the other is authored in front.
    // Move only the rear forearm in front: both forearms now draw in front of
    // one torso, with one placement.
    const oneHome = join(home, 'single-placement'), onePath = writeGatherFixture(oneHome, region);
    const one = structuredClone(base);
    ((one.assemble as Json).plan as unknown[][]).splice(0, 2, ['source_r', 'full', 'handwear-r'], ['torso', 'full', 'topwear']);
    (one.limbs as Record<string, Json>).arm_r.layout = { parts: ['forearm_r'], after: { part: 'torso' } };
    const oneParts = readParts(join(oneHome, 'parts.json'));
    const before = ['upperarm_r', 'forearm_r', 'torso', 'upperarm_l', 'forearm_l', 'bottomwear', 'shawl_r'];
    oneParts.parts.sort((a, b) => before.indexOf(a.name) - before.indexOf(b.name));
    writeParts(join(oneHome, 'parts.json'), oneParts); save(onePath, one);
    const single = rigStage({ config: onePath, parts: oneHome, out: join(oneHome, 'rig') }, runner, join(oneHome, 'scratch'), () => {});
    const order = single.rig.slots.map((s) => s.name);
    say(`${label}_ONE_PLACEMENT_BOTH_FOREARMS_CORE_GATED`, order.indexOf('forearm_r') === order.indexOf('torso') + 1 && order.indexOf('forearm_l') > order.indexOf('torso') && single.layout?.placements.length === 1, JSON.stringify({ before, order, placements: single.layout?.placements }));
  }
}
