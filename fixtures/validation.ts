/**
 * Original validation inputs made of axis-aligned colour blocks. The square
 * canvas and both layer frames are 128 pixels wide, at rig scale one, so
 * layer placement is the identity. No artwork or fetched input is read.
 *
 * The torso has 48 * 44 opaque pixels plus one isolated pixel. The isolated
 * pixel touches the torso only diagonally: one 8-connected component,
 * two 4-connected components of 2112 and one pixels. It is below both dust limits (four pixels and one thousandth of area).
 * Alternating four-row bands give the breathing region an interior signal.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { KEYPOINTS_SPACE, KEYPOINTS_SPEC } from '../src/keypoints.ts';
import { propose, readPartSet, serializeProposal } from '../src/propose.ts';
import { join } from 'node:path';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';

type RGB = [number, number, number];
type Box = [number, number, number, number];
export type ValidationVariant = 'standard' | 'physics' | 'no-neck' | 'gesture' | 'cloth' | 'physics-driven' | 'physics-mixed' | 'travel' | 'structure';
interface Layer { name: string; tag: string; run: 'full' | 'head'; box: Box; colour: RGB; bands?: boolean; dust?: boolean; empty?: boolean }
export const VALIDATION_SIDE = 128;
const LAYERS: readonly Layer[] = [
  { name: 'empty_wings', tag: 'wings', run: 'full', box: [0, 0, 128, 128], colour: [0, 0, 0], empty: true },
  { name: 'arm', tag: 'handwear-r', run: 'full', box: [28, 48, 48, 92], colour: [200, 40, 40] },
  { name: 'hair_back', tag: 'back hair', run: 'head', box: [7, 4, 122, 80], colour: [60, 40, 90] },
  { name: 'bottomwear', tag: 'bottomwear', run: 'full', box: [56, 82, 72, 116], colour: [70, 110, 200] },
  { name: 'topwear', tag: 'topwear', run: 'full', box: [40, 40, 89, 85], colour: [40, 90, 160], bands: true, dust: true },
  { name: 'footwear', tag: 'footwear', run: 'full', box: [48, 116, 80, 124], colour: [70, 50, 30] },
  { name: 'neck', tag: 'neck', run: 'head', box: [58, 38, 70, 50], colour: [200, 150, 120] },
  { name: 'face', tag: 'face', run: 'head', box: [40, 12, 88, 44], colour: [200, 150, 120] },
  { name: 'eyewhite_r', tag: 'eyewhite-r', run: 'head', box: [44, 22, 60, 32], colour: [245, 245, 250] },
  { name: 'eyewhite_l', tag: 'eyewhite-l', run: 'head', box: [68, 22, 84, 32], colour: [245, 245, 250] },
  { name: 'brow_r', tag: 'eyebrow-r', run: 'head', box: [44, 17, 60, 20], colour: [40, 30, 60] },
  { name: 'brow_l', tag: 'eyebrow-l', run: 'head', box: [68, 17, 84, 20], colour: [40, 30, 60] },
  { name: 'nose', tag: 'nose', run: 'head', box: [60, 28, 68, 36], colour: [160, 100, 100] },
  { name: 'mouth', tag: 'mouth', run: 'head', box: [60, 36, 68, 42], colour: [100, 50, 60] },
  { name: 'hairpin', tag: 'headwear', run: 'head', box: [14, 4, 30, 16], colour: [170, 80, 90] },
  { name: 'hair_front', tag: 'front hair', run: 'head', box: [36, 8, 92, 16], colour: [40, 30, 120] },
];

export function validationConfig(variant: ValidationVariant = 'standard'): Record<string, unknown> {
  const config = {
    key: 'validation',
    requirements: 'requirements.json',
    generation: { checkpoint: 'fixture.safetensors', loras: [], trigger: '', identity: 'synthetic blocks', pose: 'standing, arms at sides', costume: 'flat blocks', negative_extra: '', style: 'flat colour', negative_pose: 'cropped', latent: [128, 128], seed: 1, sampler: { steps: 1, cfg: 1, sampler: 'euler', scheduler: 'normal' }, control: { skeleton: 'pose.json', strength: 1, end_percent: 1 } },
    seethrough: { resolution: VALIDATION_SIDE, head_box: [0, 0, 128, 128], steps: 1, seed: 0, offload: false },
    assemble: { rig_scale: 1, plan: LAYERS.filter(l => !['nose', 'empty_wings'].includes(l.name)).map(l => [l.name, l.run, l.tag]) },
    bones: [
      { name: 'anchor', parent: 'root', at: [0, 0] },
      { name: 'hip', parent: 'root', at: [64, 82] },
      { name: 'chest', parent: 'hip', at: [64, 50] },
      { name: 'head', parent: 'root', at: [64, 40] },
      { chain: 'hem', parent: 'hip', points: [[64, 82], [64, 84]], tip: [64, 86] },
      { name: 'eye_r', parent: 'head', at: [52, 27] },
      { name: 'eye_l', parent: 'head', at: [76, 27] },
      { name: 'brow_r', parent: 'head', at: [52, 19] },
      { name: 'brow_l', parent: 'head', at: [76, 19] },
      { name: 'mouth', parent: 'head', at: [64, 39] },
      { chain: 'arm_r', parent: 'chest', points: [[38, 48], [38, 70]], tip: [38, 92] },
    ],
    meshes: {
      topwear: { contour: { tolerance: 1, margin: 2, spacing: 8, maxEdge: 8, stray: 1 }, r: 4, segments: [['chest', [64, 50], [64, 82]]] },
      bottomwear: { grid: 4, r: 2, segments: ['hem'] },
    },
    regions: {
      hairpin: 'head', upperarm_r: 'arm_r0', forearm_r: 'arm_r1', hair_back: 'head', footwear: 'root', neck: 'head', face: 'head',
      eyewhite_r: 'eye_r', eyewhite_l: 'eye_l', brow_r: 'brow_r', brow_l: 'brow_l', mouth: 'mouth', hair_front: 'head',
    },
    limbs: { arm_r: { segments: [
      { part: 'upperarm_r', from: 'arm', bone: 'arm_r0' },
      { part: 'forearm_r', from: 'arm', bone: 'arm_r1', joint: 'elbow' },
    ], front: { parts: ['forearm_r'], after: 'face' } } },
    cloth: { bottomwear: { chains: 1, links: 2, wind: [1, 2], gravity: [1, 2] } },
    motion: {
      duration: 4,
      animations_from: 'animations.json',
      tracks: [
        { bone: 'chest', prop: 'translatey', amp: 1, period: 4, phase: 0 },
        { chain: 'hem', amps: [4, 8], period: 4, phase: 0, lag: 0.1 },
      ],
      blink: { t: 1, eyes: ['eye_r', 'eye_l'], brows: ['brow_r', 'brow_l'], squash: 0.12, brow_drop: 1 },
    },
  } as Record<string, unknown>;
  if (variant === 'no-neck') {
    (config.assemble as { plan: string[][] }).plan = (config.assemble as { plan: string[][] }).plan.filter(p => p[0] !== 'neck');
    delete (config.regions as Record<string, unknown>).neck;
  }
  if (variant === 'structure') {
    const bones = config.bones as Array<{ name?: string; at?: [number, number] }>;
    const head = bones.find(bone => bone.name === 'head');
    const eyes = bones.filter(bone => bone.name === 'eye_r' || bone.name === 'eye_l');
    if (head?.at === undefined || eyes.length !== 2 || eyes.some(eye => eye.at === undefined)) throw new Error('validation structure needs its declared head and eyes');
    // This profile exercises the stage relation with controls only. The main
    // profile separately exercises the generated head_up below the eye line.
    head.at = [head.at[0], Math.min(...eyes.map(eye => (eye.at as [number, number])[1])) - 1];
  }
  if (variant === 'cloth' || variant === 'physics-mixed') config.cloth = { 'back hair': { chains: 1, links: 2, wind: [1, 2], gravity: [1, 2] } };
  if (variant === 'physics' || variant === 'physics-driven') {
    (config.bones as unknown[]).push({ chain: 'hair_fall', parent: 'head', points: [[64, 16], [64, 32]], tip: [64, 52] });
    (config.meshes as Record<string, unknown>).hair_back = { grid: 8, r: 4, segments: ['hair_fall'] };
    delete (config.regions as Record<string, unknown>).hair_back;
    config.constraints = [0, 1].map(i => ({ type: 'physics', name: `hair_${i}_physics`, bone: `hair_fall${i}`, rotate: 1, strength: 80, damping: 0.9, wind: 0.2, gravity: 0.2 }));
  }
  if (variant === 'physics-driven') (config.motion as { tracks: unknown[] }).tracks.push({ bone: 'head', prop: 'rotate', amp: 1, period: 4, phase: 0 });
  if (variant === 'gesture') {
    (config.assemble as Record<string, unknown>).alternates = [{ name: 'wave_r', source: 'inputs/gesture.png', full: 'inputs/layers/gesture', head: 'inputs/layers/head', parts: ['upperarm_r', 'forearm_r'], drawn: { arm_r0: -90, arm_r1: 0 }, front: ['forearm_r'] }];
  }
  if (variant === 'travel') {
    (config.assemble as { plan: string[][] }).plan.push(['sleeve', 'full', 'handwear-l']);
    (config.bones as unknown[]).push({ chain: 'sleeve', parent: 'chest', points: [[98, 48], [98, 50]], tip: [98, 52] });
    (config.bones as unknown[]).push({ name: 'hem_breath', parent: 'hip', at: [64, 82] });
    const hem = (config.bones as Array<{ chain?: string; points?: number[][]; tip?: number[] }>).find(b => b.chain === 'hem');
    if (hem === undefined) throw new Error('validation travel fixture has no hem chain');
    hem.points = [[64, 82], [64, 100]];
    hem.tip = [64, 116];
    (config.meshes as Record<string, unknown>).sleeve = { grid: 4, r: 2, segments: ['sleeve'] };
    (config.meshes as Record<string, unknown>).bottomwear = { grid: 4, r: 2, segments: [['hem_breath', [64, 82], [64, 84]], 'hem'] };
    const tracks = (config.motion as { tracks: Array<{ chain?: string; amps?: number[] }> }).tracks;
    for (const track of tracks) if (track.chain === 'hem' && track.amps !== undefined) track.amps = track.amps.map(a => a / 100);
    const chestTrack = (config.motion as { tracks: Array<{ bone?: string; phase: number }> }).tracks.find(track => track.bone === 'chest');
    if (chestTrack === undefined) throw new Error('validation travel has no chest stimulus');
    chestTrack.phase = 0.017;
    (config.motion as { tracks: unknown[] }).tracks.push(
      { bone: 'hem_breath', prop: 'translatey', amp: 0.1, period: 4, phase: 0 },
      { chain: 'sleeve', amps: [4, 8], period: 4, phase: 0, lag: 0.1 });
  }
  return config;
}

export function writeValidationSample(dir: string, variant: ValidationVariant = 'standard'): void {
  const painting = newRaster(VALIDATION_SIDE, VALIDATION_SIDE);
  for (let p = 0; p < VALIDATION_SIDE * VALIDATION_SIDE; p++) painting.data.set([255, 255, 255, 255], p * 4);
  const frames: Record<'full' | 'head', unknown[]> = { full: [], head: [] };
  const layers: readonly Layer[] = variant === 'travel'
    ? [...LAYERS, { name: 'sleeve', tag: 'handwear-l', run: 'full', box: [88, 48, 108, 92], colour: [200, 40, 40] }] : LAYERS;
  for (const l of layers) {
    const depth = 1 - (l.name === 'hairpin' ? layers.findIndex(layer => layer.name === 'hair_back') + 1 : layers.indexOf(l)) / layers.length;
    const [x0, y0, x1, y1] = l.box;
    const image: Raster = newRaster(x1 - x0, y1 - y0);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      if (l.empty === true) continue;
      if (l.name === 'hair_back' && y >= 12 && (x < 47 || x >= 67)) continue;
      if (l.dust === true && (x >= 48 || y >= 44) && !(x === 48 && y === 44)) continue;
      const c = l.bands === true && Math.floor(y / 4) % 2 === 1 ? [20, 40, 80] : l.colour;
      image.data.set([...c, 255], (y * image.width + x) * 4);
      painting.data.set([...c, 255], ((y0 + y) * VALIDATION_SIDE + x0 + x) * 4);
    }
    const run = join(dir, 'inputs', 'layers', l.run);
    mkdirSync(join(run, 'parts'), { recursive: true });
    writeFileSync(join(run, 'parts', `${l.tag}.png`), encodePngBytes(image));
    frames[l.run].push({ name: l.tag, filename: `${l.tag}.png`, left: x0, top: y0, right: x1, bottom: y1, depth_median: depth });
    if (l.name === 'empty_wings') {
      const head = join(dir, 'inputs', 'layers', 'head');
      mkdirSync(join(head, 'parts'), { recursive: true });
      writeFileSync(join(head, 'parts', 'wings.png'), encodePngBytes(image));
      frames.head.push({ name: l.tag, filename: 'wings.png', left: x0, top: y0, right: x1, bottom: y1, depth_median: depth });
    }
    if (l.run === 'head' && ['face', 'hair_back'].includes(l.name)) {
      const full = join(dir, 'inputs', 'layers', 'full');
      mkdirSync(join(full, 'parts'), { recursive: true });
      writeFileSync(join(full, 'parts', `${l.tag}.png`), encodePngBytes(image));
      frames.full.push({ name: l.tag, filename: `${l.tag}.png`, left: x0, top: y0, right: x1, bottom: y1, depth_median: depth });
    }
  }
  for (const run of ['full', 'head'] as const) writeFileSync(join(dir, 'inputs', 'layers', run, 'layers.json'), JSON.stringify({ prefix: 'validation', width: VALIDATION_SIDE, height: VALIDATION_SIDE, layers: frames[run] }, null, 2) + '\n');
  writeFileSync(join(dir, 'inputs', 'painting.png'), encodePngBytes(painting));
  const points = { r_eye: [52, 27], l_eye: [76, 27], r_ear: [40, 27], l_ear: [88, 27], nose: [64, 34], neck: [64, 46], r_shoulder: [38, 48], r_elbow: [38, 70], r_wrist: [38, 92], l_shoulder: [88, 48], l_elbow: [100, 70], l_wrist: [112, 92], r_hip: [60, 82], l_hip: [68, 82], r_knee: [60, 100], l_knee: [68, 100], r_ankle: [60, 120], l_ankle: [68, 120] };
  writeFileSync(join(dir, 'pose.json'), JSON.stringify({ width: 128, height: 128, points }, null, 2) + '\n');
  writeFileSync(join(dir, 'keypoints.json'), JSON.stringify({ spec: KEYPOINTS_SPEC, space: { ...KEYPOINTS_SPACE }, width: 128, height: 128, source: 'synthetic rectangle geometry', people: [{ id: 'a', joints: Object.fromEntries(Object.entries(points).map(([name, at]) => [name, { state: 'observed', at }])) }] }, null, 2) + '\n');
  writeFileSync(join(dir, 'animations.json'), JSON.stringify({ spec: 'rigc-motion/1', animations: { hold: { duration: 1, tracks: [{ bone: 'anchor', property: 'rotate', keys: [{ t: 0, v: [0] }, { t: 1, v: [0] }] }] } } }, null, 2) + '\n');
  writeFileSync(join(dir, 'requirements.json'), JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [], pinholes: { required: true }, boundary_colour: { max_step_excess: 12 }, seam_over_motion: { required: true } }, null, 2) + '\n');
  writeFileSync(join(dir, 'config.json'), JSON.stringify(validationConfig(variant), null, 2) + '\n');
  const gesture = { ...painting, data: new Uint8ClampedArray(painting.data) };
  const arm = newRaster(42, 32);
  for (let y = 48; y < 80; y++) for (let x = 28; x < 70; x++) {
    if (!(x < 48 && y < 70) && !(y >= 60)) continue;
    arm.data.set([200, 40, 40, 255], ((y - 48) * 42 + x - 28) * 4);
    gesture.data.set([200, 40, 40, 255], (y * VALIDATION_SIDE + x) * 4);
  }
  const folder = join(dir, 'inputs', 'layers', 'gesture');
  mkdirSync(join(folder, 'parts'), { recursive: true });
  writeFileSync(join(folder, 'parts', 'handwear-r.png'), encodePngBytes(arm));
  writeFileSync(join(folder, 'layers.json'), JSON.stringify({ prefix: 'validation', width: VALIDATION_SIDE, height: VALIDATION_SIDE, layers: [{ name: 'handwear-r', filename: 'handwear-r.png', left: 28, top: 48, right: 70, bottom: 80, depth_median: 1 }] }, null, 2) + '\n');
  writeFileSync(join(dir, 'inputs', 'gesture.png'), encodePngBytes(gesture));
}


/** Paste only the recipe's hair entries, derived from this sample's assembled input. */
export function prepareValidationCloth(dir: string, assembled: string, mixed = false): void {
  const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as Record<string, unknown>;
  const recipe = { 'back hair': { chains: 1, links: 2, wind: [1, 2] as [number, number], gravity: [1, 2] as [number, number] } };
  const proposal = propose(readPartSet(assembled), undefined, null, undefined, recipe, true, { noBust: 'synthetic fixture has no bust landmarks' });
  const mesh = proposal.meshes.hair_back;
  if (mesh === undefined || proposal.constraints === undefined || proposal.constraints.length === 0) throw new Error('validation cloth recipe produced no hair mesh or constraints');
  const chains = new Set(mesh.segments.filter((s): s is string => typeof s === 'string'));
  const additions = proposal.bones.filter(b => 'chain' in b && chains.has(b.chain));
  if (additions.length === 0) throw new Error('validation cloth recipe produced no segment chains');
  (config.bones as unknown[]).push(...additions);
  if (mixed) {
    const first = additions[0];
    if (!('chain' in first)) throw new Error('validation mixed physics has no first chain');
    (config.bones as unknown[]).splice((config.bones as unknown[]).length - additions.length, 0,
      { name: 'hair_carrier', parent: first.parent, at: first.points[0] });
    first.parent = 'hair_carrier';
    (config.motion as { tracks: unknown[] }).tracks.push({ bone: 'hair_carrier', prop: 'rotate', amp: 1, period: 4, phase: 0 });
  }
  (config.meshes as Record<string, unknown>).hair_back = mesh;
  delete (config.regions as Record<string, unknown>).hair_back;
  config.constraints = proposal.constraints;
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2) + '\n');
  writeFileSync(join(dir, 'proposal.json'), serializeProposal(proposal));
}

if (import.meta.main) {
  const dir = process.argv[2];
  const variant = process.argv[3] ?? 'standard';
  if (dir === undefined || !['standard', 'physics', 'no-neck', 'gesture', 'cloth', 'physics-driven', 'physics-mixed', 'travel', 'structure'].includes(variant) || process.argv.length > 4) throw new Error('usage: bun fixtures/validation.ts <output-directory> [standard|physics|no-neck|gesture|cloth|physics-driven|physics-mixed|travel|structure]');
  writeValidationSample(dir, variant as ValidationVariant);
}
