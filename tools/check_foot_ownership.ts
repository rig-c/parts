/** Assembly-only controls for #638. No rig compiler or renderer runs here. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFootOwnershipFixture } from '../fixtures/foot_ownership.ts';
import { assemble, type AssembleResult, setIslandSources, stageFields } from '../src/assemble.ts';
import { assembleStage, readRuns } from '../src/build.ts';
import { type BoneEntry, loadConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { bonePlaces, placeBoneEntriesForSkeleton, skeletonLimbJoints } from '../src/limbs.ts';
import { type PartRecord, readParts } from '../src/parts.ts';
import { connectedComponents } from '../src/raster/components.ts';
import { encodePngBytes, readPng, writePng } from '../src/raster/png.ts';
import { newMask, type Raster } from '../src/raster/types.ts';
import type { PosePoints } from '../src/skeleton.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
type Image = { record: PartRecord; image: Raster };

function areas({ image }: Image): number[] {
  const mask = newMask(image.width, image.height);
  for (let p = 0; p < mask.data.length; p++) mask.data[p] = image.data[p * 4 + 3] > 8 ? 1 : 0;
  return connectedComponents(mask, 8).stats.slice(1).map((s) => s.area).sort((a, b) => b - a);
}

function pixels({ record, image }: Image): string[] {
  const out: string[] = [];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (image.data[(y * image.width + x) * 4 + 3] > 8) out.push(`${record.x + x},${record.y + y}`);
  }
  return out.sort();
}

export function runFootOwnershipChecks(dir: string, say: Say): void {
  const run = (d: string, name: string): string => {
    const out = join(d, name), log: string[] = [];
    assembleStage({ source: join(d, 'painting.png'), full: join(d, 'full'), head: join(d, 'head'), config: join(d, 'config.json'), seam: 'near-white', project: 'core' },
      { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, 'recomposite_error_rig.png') }, (l) => log.push(l));
    writeFileSync(join(out, 'raw.log'), `${log.join('\n')}\n`);
    return out;
  };
  const foot = (out: string, side: string): Image => {
    const record = readParts(join(out, 'parts.json')).alternates?.find((a) => a.name === `step_${side}`)?.records.find((r) => r.name === `foot_${side}`);
    if (record === undefined) throw new Error(`generated step_${side} foot record missing`);
    return { record, image: readPng(join(out, 'parts', `step_${side}_foot_${side}.png`)) };
  };
  const files = (d: string): string[] => ['parts.json', 'recomposite_rig.png', 'recomposite_error_rig.png', ...readdirSync(join(d, 'parts')).sort().map((f) => `parts/${f}`)];
  const same = (a: string, b: string): boolean => files(a).every((f) => readFileSync(join(a, f)).equals(readFileSync(join(b, f))));
  const isolated = join(dir, 'islands'); writeFootOwnershipFixture(isolated);
  const green = run(isolated, 'nearest');
  const greenAreas = ['r', 'l'].map((s) => areas(foot(green, s)));
  say('UF00_EVERY_SET_FOOT_KEEPS_ONE_OF_TWO_SHOE_ISLANDS', greenAreas.every((a) => a.length > 0 && (a[1] ?? 0) <= a[0] * 0.01),
    `right/left island areas ${JSON.stringify(greenAreas)}; second/largest ${greenAreas.map((a) => (a[1] ?? 0) / a[0]).join('/')}`);
  const logs = readFileSync(join(green, 'raw.log'), 'utf8');
  say('UF01_FOOTWEAR_IS_INCLUDED_IN_THE_STAGE_OWNERSHIP_LEDGER', ['r', 'l'].every((s) => logs.includes(`LINT set "step_${s}" foot_${s}: shoes holds 2 islands`)),
    logs.split('\n').filter((l) => /foot_[rl]: shoes holds/.test(l)).join('; '));

  // Direct assembly freezes the set's placed bones and changes only the footwear
  // ownership source. The leg layer still goes through the #609 split.
  const direct = (d: string, side: 'r' | 'l', skipFoot = false, missingTip = false, jointEndOnly = false): AssembleResult => {
    const fields = stageFields(loadConfig(join(d, 'config.json')));
    const all = fields.limbs;
    if (all === undefined || fields.bones === undefined) throw new Error('generated limb geometry missing');
    const own = { [`leg_${side}`]: all[`leg_${side}`] }, other = side === 'r' ? 'l' : 'r';
    const pose = (JSON.parse(readFileSync(join(d, 'pose.json'), 'utf8')) as { points: PosePoints }).points;
    const joints = skeletonLimbJoints(pose);
    const bones = placeBoneEntriesForSkeleton(fields.bones, new Set(joints.map(([b]) => b)), joints, {});
    const fromJoints = jointEndOnly ? bones.flatMap((b): BoneEntry[] => 'chain' in b && b.chain === `leg_${side}`
      ? b.points.map((at, k) => ({ name: `${b.chain}${k}`, parent: k === 0 ? b.parent : `${b.chain}${k - 1}`, at })) : [b]) : bones;
    const placed = missingTip ? fromJoints.map((b) => 'name' in b && b.name === `foot_${side}` ? { ...b, tip: undefined } : b) : fromJoints;
    return assemble({ ...fields, ...readRuns(join(d, 'step'), join(d, 'head')), source: readPng(join(d, 'painting.png')), limbs: own, bones: placed,
      seamRule: 'near-white', projectRule: 'core', limbUnderCover: true,
      limbIslands: setIslandSources(all, own).filter((s) => !skipFoot || s !== 'shoes'),
      otherLimbs: { limbs: { [`leg_${other}`]: all[`leg_${other}`] }, unposed: { [`leg_${other}`]: [] }, baseArt: {},
        drawOrder: ['thigh_r', 'shin_r', 'thigh_l', 'shin_l', 'foot_r', 'foot_l'], pose: 'skeleton' },
    });
  };
  const imageOf = (r: AssembleResult, name: string): Image => {
    const image = r.images.find((q) => q.record.name === name);
    if (image === undefined) throw new Error(`generated ${name} image missing`);
    return image;
  };
  const save = (name: string, result: AssembleResult): void => {
    const out = join(dir, name); mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'measurements.json'), `${JSON.stringify({ islands: result.islands, splits: result.splits, parts: result.images.map((q) => ({ record: q.record, areas: areas(q) })) }, null, 2)}\n`);
    for (const q of result.images) writePng(join(out, `${q.record.name}.png`), q.image);
  };
  const positive = direct(isolated, 'l'), mutant = direct(isolated, 'l', true);
  save('direct-islands', positive); save('skip-foot-mutant', mutant);
  const pa = areas(imageOf(positive, 'foot_l')), ma = areas(imageOf(mutant, 'foot_l'));
  say('UF02_SKIPPING_ONLY_FOOT_OWNERSHIP_RESTORES_BOTH_SHOES', pa.length === 1 && ma.length === 2 && ma[1] > ma[0] * 0.01,
    `positive ${JSON.stringify(pa)}, skip-foot mutant ${JSON.stringify(ma)}; mutant second/largest ${ma[1] / ma[0]}`);
  const legPixels = (r: AssembleResult): string => JSON.stringify(r.images.filter((q) => q.record.name !== 'foot_l').map((q) => pixels(q)));
  say('UF03_THE_SKIP_FOOT_MUTANT_PRESERVES_LEG_OWNERSHIP', legPixels(positive) === legPixels(mutant) && positive.splits.length > 0 && JSON.stringify(positive.splits) === JSON.stringify(mutant.splits),
    `leg pixels identical ${legPixels(positive) === legPixels(mutant)}; #609 split rows ${positive.splits.length}/${mutant.splits.length}`);

  const joined = join(dir, 'connected'); writeFootOwnershipFixture(joined, 'connected');
  const connected = run(joined, 'nearest');
  const ca = ['r', 'l'].map((s) => areas(foot(connected, s)));
  say('UF04_CONNECTED_FOOTWEAR_ALSO_LEAVES_ONE_ISLAND_PER_SET_FOOT', ca.every((a) => a.length > 0 && (a[1] ?? 0) <= a[0] * 0.01), `right/left island areas ${JSON.stringify(ca)}`);
  const cr = direct(joined, 'r'), cl = direct(joined, 'l'); save('direct-connected-r', cr); save('direct-connected-l', cl);
  // A segment-distance oracle independent of limbPolyline/polylineDist2. The
  // supplied foot bones inherit no rotation: the skeleton moves each ankle,
  // and the authored toe offset supplies the other endpoint. No guessed toe.
  const fields = stageFields(loadConfig(join(joined, 'config.json')));
  const pose = (JSON.parse(readFileSync(join(joined, 'pose.json'), 'utf8')) as { points: PosePoints }).points;
  const placed = placeBoneEntriesForSkeleton(fields.bones ?? [], new Set(skeletonLimbJoints(pose).map(([b]) => b)), skeletonLimbJoints(pose), {});
  const places = bonePlaces(placed);
  const segmentDistance = (a: readonly number[], b: readonly number[], x: number, y: number): number => {
    const [ax, ay] = a, [bx, by] = b, dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  };
  const distance = (side: string, x: number, y: number): number => {
    const b = places.get(`foot_${side}`);
    if (b === undefined || b.end === null) throw new Error(`generated foot_${side} endpoint missing`);
    return segmentDistance(b.at, b.end, x, y);
  };
  const wholeDistance = (side: string, x: number, y: number): number => Math.min(...[`leg_${side}0`, `leg_${side}1`, `foot_${side}`].map((name) => {
    const b = places.get(name);
    if (b === undefined || b.end === null) throw new Error(`generated ${name} endpoint missing`);
    return segmentDistance(b.at, b.end, x, y);
  }));
  const raw = readPng(join(joined, 'step', 'parts', 'footwear.png'));
  const layer = readRuns(join(joined, 'step'), join(joined, 'head')).full.layers.find((l) => l.name === 'footwear');
  if (layer === undefined) throw new Error('generated footwear missing');
  const kept = [new Set(pixels(imageOf(cr, 'foot_r'))), new Set(pixels(imageOf(cl, 'foot_l')))];
  let readings = 0, wrong = 0, wholeLegWrong = 0;
  for (let y = 0; y < raw.height; y++) for (let x = 0; x < raw.width; x++) {
    if (raw.data[(y * raw.width + x) * 4 + 3] <= 8) continue;
    const rx = layer.left + x, ry = layer.top + y;
    const dr = distance('r', rx + 0.5, ry + 0.5), dl = distance('l', rx + 0.5, ry + 0.5);
    const own = Math.abs(dr - dl) <= 0.5 ? 1 : dr < dl ? 0 : 1;
    const key = `${rx},${ry}`;
    readings++;
    if (!kept[own].has(key) || kept[1 - own].has(key)) wrong++;
    const wr = wholeDistance('r', rx + 0.5, ry + 0.5), wl = wholeDistance('l', rx + 0.5, ry + 0.5);
    if (Math.abs(wr - wl) > 0.5 && (wr < wl ? 0 : 1) !== own) wholeLegWrong++;
  }
  say('UF05_FOOT_PIXELS_FOLLOW_ANKLE_TO_TOE_DISTANCE_AND_DRAW_ORDER', readings > 0 && wrong === 0 && wholeLegWrong > 0,
    `${readings} footwear pixels; wrong owners ${wrong}; whole-leg distance disagrees on ${wholeLegWrong} pixels; endpoints ${JSON.stringify(['r', 'l'].map((s) => places.get(`foot_${s}`)))}`);
  const noFoot = direct(joined, 'r', true); save('skip-connected-foot-mutant', noFoot);
  say('UF06_SKIPPING_CONNECTED_FOOT_OWNERSHIP_RETAINS_THE_OTHER_SHOE', pixels(imageOf(noFoot, 'foot_r')).length > pixels(imageOf(cr, 'foot_r')).length && !JSON.stringify(noFoot.splits).includes('foot_r'),
    `fixed ${pixels(imageOf(cr, 'foot_r')).length} px; skip-foot ${pixels(imageOf(noFoot, 'foot_r')).length} px`);
  let refusal = '';
  try { direct(joined, 'r', false, true); } catch (err) { if (!(err instanceof PartsError)) throw err; refusal = String(err); }
  say('UF07_MISSING_FOOT_ENDPOINT_IS_REFUSED_BY_NAME', refusal.includes('ASSEMBLE_ALT_LIMB_POSE') && refusal.includes('foot_r') && refusal.includes('no tip'), refusal);
  const split = join(dir, 'per-side'); writeFootOwnershipFixture(split, 'per-side');
  const sg = run(split, 'nearest'), sm = run(split, 'again');
  // No shared footwear source exists here; disabling the ownership path is a
  // control for the prior per-side behavior (including all base/set PNG bytes).
  const perSide = direct(split, 'l'), perSideOff = direct(split, 'l', true);
  const sideSame = perSide.images.every((q, i) => JSON.stringify(q.record) === JSON.stringify(perSideOff.images[i].record) &&
    Buffer.from(encodePngBytes(q.image)).equals(Buffer.from(encodePngBytes(perSideOff.images[i].image))));
  say('UF08_PER_SIDE_FOOTWEAR_OUTPUTS_ARE_BYTE_IDENTICAL', sideSame, `${perSide.images.length} image/record pairs identical to foot ownership disabled ${sideSame}`);
  say('UF09_REPEATING_THE_SAME_INPUT_WRITES_IDENTICAL_BYTES', same(sg, sm) && same(green, run(isolated, 'again')), `per-side repeat ${same(sg, sm)}; shared repeat ${same(green, join(isolated, 'again'))}`);
  const nextJoint = direct(joined, 'r', false, false, true); save('next-joint-endpoint', nextJoint);
  const jointsSame = cr.images.every((q, i) => JSON.stringify(q.record) === JSON.stringify(nextJoint.images[i].record) &&
    Buffer.from(encodePngBytes(q.image)).equals(Buffer.from(encodePngBytes(nextJoint.images[i].image))));
  say('UF10_A_NEXT_SOURCE_JOINT_SUPPLIES_THE_NONTERMINAL_SEGMENT_END', jointsSame,
    `${cr.images.length} image/record pairs identical when the thigh and shin end at the supplied next joints, with no separate tip`);
}
