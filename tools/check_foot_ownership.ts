/** Assembly-only controls for #638. No rig compiler or renderer runs here. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFootOwnershipFixture } from '../fixtures/foot_ownership.ts';
import { assemble, type AssembleResult, setIslandSources, stageFields } from '../src/assemble.ts';
import { assembleStage, type AssembleStageInput, readRuns } from '../src/build.ts';
import { type BoneEntry, loadConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { bonePlaces, inDisc, jointLine, pastJoint, placeBoneEntriesForSkeleton, skeletonLimbJoints } from '../src/limbs.ts';
import { type PartRecord, readParts } from '../src/parts.ts';
import { connectedComponents } from '../src/raster/components.ts';
import { encodePngBytes, readPng, writePng } from '../src/raster/png.ts';
import { newMask, newRaster, type Raster } from '../src/raster/types.ts';
import type { PosePoints } from '../src/skeleton.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
type Image = { record: PartRecord; image: Raster };
type Point = readonly [number, number];

function segmentDistance(a: Point, b: Point, x: number, y: number): number {
  const [ax, ay] = a, [bx, by] = b, dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

/** Independent distance oracle over the supplied pose and authored foot endpoints. */
function footGeometry(dir: string) {
  const fields = stageFields(loadConfig(join(dir, 'config.json')));
  if (fields.bones === undefined || fields.limbs === undefined) throw new Error('generated limb geometry missing');
  const pose = (JSON.parse(readFileSync(join(dir, 'pose.json'), 'utf8')) as { points: PosePoints }).points;
  const joints = skeletonLimbJoints(pose);
  const places = bonePlaces(placeBoneEntriesForSkeleton(fields.bones, new Set(joints.map(([b]) => b)), joints, {}));
  const distance = (side: string, x: number, y: number): number => {
    const b = places.get(`foot_${side}`);
    if (b === undefined || b.end === null) throw new Error(`generated foot_${side} endpoint missing`);
    return segmentDistance(b.at, b.end, x, y);
  };
  const owner = (x: number, y: number): string => {
    const r = distance('r', x + 0.5, y + 0.5), l = distance('l', x + 0.5, y + 0.5);
    // The generated plan draws foot_l after foot_r: the same 0.5-px band as production.
    return Math.abs(r - l) <= 0.5 ? 'l' : r < l ? 'r' : 'l';
  };
  return { places, distance, owner };
}

function components({ record, image }: Image): Array<Array<[number, number]>> {
  const mask = newMask(image.width, image.height);
  for (let p = 0; p < mask.data.length; p++) mask.data[p] = image.data[p * 4 + 3] > 8 ? 1 : 0;
  const cc = connectedComponents(mask, 8);
  const out: Array<Array<[number, number]>> = Array.from({ length: cc.count - 1 }, () => []);
  for (let p = 0; p < mask.data.length; p++) if (cc.labels[p] > 0) {
    out[cc.labels[p] - 1].push([record.x + p % image.width, record.y + Math.floor(p / image.width)]);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Foreign ownership is measured independently of component size or colour. */
function ownership(image: Image, side: string, geometry: ReturnType<typeof footGeometry>) {
  const foreign: Image = { record: image.record, image: newRaster(image.image.width, image.image.height) };
  let foreignPx = 0;
  for (const [x, y] of components(image).flat()) if (geometry.owner(x, y) !== side) {
    foreign.image.data[((y - image.record.y) * foreign.image.width + x - image.record.x) * 4 + 3] = 255;
    foreignPx++;
  }
  return { areas: areas(image), foreignPx, foreignComponents: areas(foreign) };
}

function rgbaAt({ record, image }: Image, x: number, y: number): number[] {
  if (x < record.x || y < record.y || x >= record.x + image.width || y >= record.y + image.height) return [0, 0, 0, 0];
  const p = ((y - record.y) * image.width + x - record.x) * 4;
  return Array.from(image.data.subarray(p, p + 4));
}

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
  const run = (d: string, name: string, split: AssembleStageInput['setSplit'] = 'nearest'): string => {
    const out = join(d, name), log: string[] = [];
    assembleStage({ source: join(d, 'painting.png'), full: join(d, 'full'), head: join(d, 'head'), config: join(d, 'config.json'), seam: 'near-white', project: 'core', setSplit: split },
      { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, 'recomposite_error_rig.png') }, (l) => log.push(l));
    writeFileSync(join(out, 'raw.log'), `${log.join('\n')}\n`);
    return out;
  };
  const setPart = (out: string, side: string, name: string): Image => {
    const record = readParts(join(out, 'parts.json')).alternates?.find((a) => a.name === `step_${side}`)?.records.find((r) => r.name === name);
    if (record === undefined) throw new Error(`generated step_${side} ${name} record missing`);
    return { record, image: readPng(join(out, 'parts', `step_${side}_${name}.png`)) };
  };
  const foot = (out: string, side: string): Image => setPart(out, side, `foot_${side}`);
  const files = (d: string): string[] => ['parts.json', 'recomposite_rig.png', 'recomposite_error_rig.png', ...readdirSync(join(d, 'parts')).sort().map((f) => `parts/${f}`)];
  const same = (a: string, b: string): boolean => files(a).every((f) => readFileSync(join(a, f)).equals(readFileSync(join(b, f))));
  const isolated = join(dir, 'islands'); writeFootOwnershipFixture(isolated);
  const green = run(isolated, 'nearest');
  const greenAreas = ['r', 'l'].map((s) => areas(foot(green, s)));
  const isolatedGeometry = footGeometry(isolated);
  const greenOwners = ['r', 'l'].map((s) => ownership(foot(green, s), s, isolatedGeometry));
  say('UF00_EVERY_SET_FOOT_HAS_ZERO_FOREIGN_LEG_COMPONENTS', greenOwners.every((o) => o.areas.length > 0 && o.foreignPx === 0),
    `right/left areas ${JSON.stringify(greenAreas)}; ownership ${JSON.stringify(greenOwners)}`);
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
      seamRule: 'near-white', projectRule: 'core',
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
  const positiveOwner = ownership(imageOf(positive, 'foot_l'), 'l', isolatedGeometry);
  const mutantOwner = ownership(imageOf(mutant, 'foot_l'), 'l', isolatedGeometry);
  say('UF02_SKIPPING_ONLY_FOOT_OWNERSHIP_RESTORES_A_FOREIGN_SHOE_COMPONENT', positiveOwner.foreignPx === 0 && mutantOwner.foreignComponents.length > 0,
    `positive areas ${JSON.stringify(pa)}, skip-foot areas ${JSON.stringify(ma)}; foreign positive/mutant ${JSON.stringify([positiveOwner, mutantOwner])}`);
  const legPixels = (r: AssembleResult): string => JSON.stringify(r.images.filter((q) => q.record.name !== 'foot_l').map((q) => pixels(q)));
  say('UF03_THE_SKIP_FOOT_MUTANT_PRESERVES_LEG_OWNERSHIP', legPixels(positive) === legPixels(mutant) && positive.splits.length > 0 && JSON.stringify(positive.splits) === JSON.stringify(mutant.splits),
    `leg pixels identical ${legPixels(positive) === legPixels(mutant)}; #609 split rows ${positive.splits.length}/${mutant.splits.length}`);

  const joined = join(dir, 'connected'); writeFootOwnershipFixture(joined, 'connected');
  const connected = run(joined, 'nearest');
  const ca = ['r', 'l'].map((s) => areas(foot(connected, s)));
  const connectedGeometry = footGeometry(joined);
  const connectedOwners = ['r', 'l'].map((s) => ownership(foot(connected, s), s, connectedGeometry));
  say('UF04_CONNECTED_FOOTWEAR_HAS_ZERO_FOREIGN_LEG_COMPONENTS', connectedOwners.every((o) => o.areas.length > 0 && o.foreignPx === 0),
    `right/left island areas ${JSON.stringify(ca)}; ownership ${JSON.stringify(connectedOwners)}`);
  const cr = direct(joined, 'r'), cl = direct(joined, 'l'); save('direct-connected-r', cr); save('direct-connected-l', cl);
  // A segment-distance oracle independent of limbPolyline/polylineDist2. The
  // supplied foot bones inherit no rotation: the skeleton moves each ankle,
  // and the authored toe offset supplies the other endpoint. No guessed toe.
  const { places, distance } = connectedGeometry;
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

  // HQ changed acceptance after measuring this case (issue #638, alternative 3):
  // foreign-leg components must be zero; own-cap art is counted separately.
  // These figures do NOT satisfy the original <=1% second-island bar. Cap/exclusion
  // repair belongs to #637; no component is deleted or cap shape changed here.
  const def = join(dir, 'default-cap'); writeFootOwnershipFixture(def, 'connected', 'default');
  const fixed = run(def, 'nearest'), whole = run(def, 'whole-limb-mutant', 'whole-limb');
  const defRight = foot(fixed, 'r'), defLeft = foot(fixed, 'l'), beforeRight = foot(whole, 'r');
  const defGeometry = footGeometry(def);
  const beforeAreas = areas(beforeRight), afterAreas = areas(defRight);
  say('UF11_DEFAULT_CAP_RETAINS_THE_MEASURED_97_16_TO_104_16_CASE',
    JSON.stringify(beforeAreas) === '[97,16]' && JSON.stringify(afterAreas) === '[104,16]',
    `whole-limb mutant ${JSON.stringify(beforeAreas)} -> source segments ${JSON.stringify(afterAreas)}; second/largest before ${beforeAreas[1] / beforeAreas[0]}, after ${afterAreas[1] / afterAreas[0]}; original 1% bar not met`);
  const defOwners = [ownership(defRight, 'r', defGeometry), ownership(defLeft, 'l', defGeometry)];
  say('UF12_DEFAULT_CAP_POSITIVE_HAS_ZERO_FOREIGN_LEG_COMPONENTS', defOwners.every((o) => o.foreignPx === 0 && o.foreignComponents.length === 0),
    `right/left ${JSON.stringify(defOwners)}; acceptance changed after measurement to foreign-leg zero, own-cap separate`);
  const runs = readRuns(join(def, 'step'), join(def, 'head'));
  const source = runs.full.layers.find((l) => l.name === 'footwear');
  if (source === undefined) throw new Error('generated default footwear missing');
  const sourceAt = (x: number, y: number): number[] => rgbaAt({ image: source.pixels, record: { ...defRight.record, x: source.left, y: source.top } }, x, y);
  const ownCaps = components(defRight).filter((c) => c.every(([x, y]) => sourceAt(x, y)[3] === 0 && defGeometry.owner(x, y) === 'r'));
  const beforeCaps = components(beforeRight).filter((c) => c.every(([x, y]) => sourceAt(x, y)[3] === 0));
  const cap = defRight.record.limb?.cap;
  const ankle = defGeometry.places.get('foot_r'), shin = defGeometry.places.get('leg_r1');
  if (cap === undefined || ankle === undefined || ankle.end === null || shin === undefined) throw new Error('generated cap geometry missing');
  const cut = jointLine(shin.at, ankle.at, ankle.end);
  if (cut === null) throw new Error('generated ankle joint line missing');
  const upper = setPart(fixed, 'r', 'shin_r');
  const capPixels = ownCaps.flat();
  const margins = capPixels.map(([x, y]) => defGeometry.distance('l', x + 0.5, y + 0.5) - defGeometry.distance('r', x + 0.5, y + 0.5));
  const fromUpper = cap.image_px === undefined && cap.image_layer === undefined && runs.full.hidden.length === 0 &&
    capPixels.every(([x, y]) => sourceAt(x, y)[3] === 0 && inDisc(cap.at, cap.radius, x, y) && !pastJoint(cut, x, y) &&
      rgbaAt(upper, x, y)[3] > 0 && JSON.stringify(rgbaAt(defRight, x, y)) === JSON.stringify(rgbaAt(upper, x, y)));
  // In cutLimbs' priority order, no cap image + transparent lower layer + an
  // upper pixel is exactly CAP_FROM_UPPER (3). UF16 causally plants its absence;
  // colour equality here verifies a copy, never chooses an owner.
  say('UF13_ALL_16_SEPARATE_PIXELS_ARE_OWN_CAP_FROM_UPPER', ownCaps.length === 1 && capPixels.length === 2 * 8 && fromUpper &&
    (cap.upper_px ?? 0) >= capPixels.length && margins.every((d) => d > 0.5) && JSON.stringify(ownCaps) === JSON.stringify(beforeCaps),
    `own-cap areas ${JSON.stringify(ownCaps.map((c) => c.length))}; CAP_FROM_UPPER branch ${fromUpper}; distance advantage ${Math.min(...margins)}..${Math.max(...margins)}; cap ${JSON.stringify(cap)}`);
  const deleted: Image = { record: defRight.record, image: { ...defRight.image, data: new Uint8ClampedArray(defRight.image.data) } };
  for (const [x, y] of capPixels) {
    const p = ((y - deleted.record.y) * deleted.image.width + x - deleted.record.x) * 4;
    deleted.image.data.fill(0, p, p + 4);
  }
  writePng(join(fixed, 'planted-delete-own-cap.png'), deleted.image);
  const lostOwnCap = capPixels.filter(([x, y]) => rgbaAt(deleted, x, y)[3] === 0).length;
  say('UF14_COMPONENT_DELETION_MUTANT_IS_REJECTED_FOR_LOSING_OWN_CAP', lostOwnCap === 16 && capPixels.every(([x, y]) =>
    JSON.stringify(rgbaAt(defRight, x, y)) === JSON.stringify(rgbaAt(beforeRight, x, y))) && ownership(deleted, 'r', defGeometry).foreignPx === 0,
    `fixed keeps all ${capPixels.length} own-cap pixels byte-identical to before; deletion mutant areas ${JSON.stringify(areas(deleted))}, lost valid own-cap ${lostOwnCap}; zero foreign alone cannot excuse deletion`);
  const [W, H] = readParts(join(fixed, 'parts.json')).rig_size;
  const planted: Image = { record: { ...defRight.record, x: 0, y: 0, w: W, h: H }, image: newRaster(W, H) };
  for (const image of [defRight, defLeft]) for (const [x, y] of components(image).flat()) planted.image.data.set(rgbaAt(image, x, y), (y * W + x) * 4);
  writePng(join(fixed, 'planted-foreign-shoe.png'), planted.image);
  const plantedOwner = ownership(planted, 'r', defGeometry);
  say('UF15_PLANTED_FOREIGN_OWNER_COMPONENT_IS_REFUSED_BY_THE_REVISED_BAR', defOwners[0].foreignPx === 0 &&
    plantedOwner.foreignPx === pixels(defLeft).length && plantedOwner.foreignComponents.length > 0,
    `positive foreign ${defOwners[0].foreignPx}; planted ${JSON.stringify(plantedOwner)}; planted owner is measured at the same supplied foot segments`);
  const upperLayer = runs.full.layers.find((l) => l.name === 'legwear');
  if (upperLayer === undefined) throw new Error('generated upper layer missing');
  // Remove one supplied upper pixel at a time. Clearing the whole 2x8 block
  // would sever the input leg layer and correctly trigger the island gate.
  const causal = capPixels.map(([x, y], index) => {
    const noUpper = join(dir, `upper-pixel-${index}`); writeFootOwnershipFixture(noUpper, 'connected', 'default');
    const knocked = readPng(join(noUpper, 'step', 'parts', 'legwear.png'));
    const p = ((y - upperLayer.top) * knocked.width + x - upperLayer.left) * 4;
    knocked.data.fill(0, p, p + 4);
    writePng(join(noUpper, 'step', 'parts', 'legwear.png'), knocked);
    const noUpperFoot = foot(run(noUpper, 'nearest'), 'r');
    return { at: [x, y], copyGone: rgbaAt(noUpperFoot, x, y)[3] === 0, radius: noUpperFoot.record.limb?.cap?.radius, upperPx: noUpperFoot.record.limb?.cap?.upper_px };
  });
  say('UF16_EACH_OF_16_CAP_COPIES_REQUIRES_ITS_SUPPLIED_UPPER_PIXEL', causal.length === 16 &&
    causal.every((p) => p.copyGone && p.radius === cap.radius && p.upperPx === (cap.upper_px ?? 0) - 1),
    `${causal.filter((p) => p.copyGone).length}/${causal.length} causal upper-pixel knockouts; cap radius stays ${cap.radius}, upper_px ${cap.upper_px} -> ${(cap.upper_px ?? 0) - 1}; gates remain enabled, positive input untouched`);
  const beforeOwners = ['r', 'l'].map((s) => ownership(foot(whole, s), s, defGeometry));
  say('UF17_WHOLE_LIMB_LINE_MUTANT_RETAINS_FOREIGN_LEG_PIXELS', beforeOwners.some((o) => o.foreignPx > 0) &&
    defOwners.every((o) => o.foreignPx === 0), `before ${JSON.stringify(beforeOwners)}; after ${JSON.stringify(defOwners)}; own-cap [16] survives both`);
  writeFileSync(join(fixed, 'ownership.json'), `${JSON.stringify({ beforeAreas, afterAreas, beforeOwners, ownership: defOwners, ownCapAreas: ownCaps.map((c) => c.length), capPixels, margins, fromUpper, plantedOwner, lostOwnCap, causal }, null, 2)}\n`);
}
