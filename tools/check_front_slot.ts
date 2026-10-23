/**
 * Public generated controls for issue #664, a limb segment's front slot: a
 * gesture set over an arm draws its forearm on `forearm_r_front`, placed after
 * the face, so the forearm reads in front of the torso while the base arm stays
 * behind it. Every expectation is read off the flat-block fixture
 * (`fixtures/front_slot.ts`), whose geometry its module doc derives.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRONT_PROBE, ARM, TORSO, writeFrontSlotFixture } from '../fixtures/front_slot.ts';
import { assembleStage, readRigInputs, rigStage } from '../src/build.ts';
import { flatCompositeForSet, readFrameSet, rigToFrameMap, runCheck, seamFigures, stillRigForSet, type RigcRunner, type StageBox, STILL_DIR } from '../src/check.ts';
import { parseConfig, parseEarlyConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import type { MotionSpec } from '../src/motion.ts';
import { readParts } from '../src/parts.ts';
import type { Raster } from '../src/raster/types.ts';
import { buildRig, expandSetAttachmentKeys, type RigSpec } from '../src/rig.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
type Json = Record<string, unknown>;

function refused(run: () => unknown): string {
  try {
    run();
    return '';
  } catch (e) {
    if (e instanceof PartsError) return e.message;
    throw e;
  }
}

const readJson = (path: string): Json => JSON.parse(readFileSync(path, 'utf8')) as Json;

/** Assemble and rig one fixture directory into `<dir>/out`; returns that directory. */
function build(dir: string, runner: RigcRunner): string {
  const out = join(dir, 'out');
  assembleStage(
    { source: join(dir, 'painting.png'), full: join(dir, 'full'), head: join(dir, 'head'), config: join(dir, 'config.json'), seam: 'near-white', project: 'core' },
    { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, 'recomposite_error_rig.png') },
    () => {},
  );
  rigStage({ config: join(dir, 'config.json'), parts: out, out: join(out, 'rig') }, runner, join(dir, 'scratch'), () => {});
  return out;
}

/** `check --set chest --keep-stills` over a built directory; returns the check directory. */
function check(out: string, runner: RigcRunner, set: string | undefined = 'chest'): { dir: string; sets: Json } {
  const dir = join(out, 'check');
  const report = runCheck(join(out, 'rig'), dir, runner, out, undefined, undefined, undefined, false, true, set) as unknown as Json;
  const figures = (report.figures ?? {}) as Json;
  return { dir, sets: (figures.sets ?? report.sets ?? {}) as Json };
}

/** The frame pixel a rig pixel's centre lands on, under the still's viewport. */
function frameAt(rig: Json, frameSet: ReturnType<typeof readFrameSet>, at: readonly [number, number]): number[] {
  const sk = rig.skeleton as StageBox;
  const m = rigToFrameMap(sk, sk.height, frameSet.viewport);
  const fx = Math.round(m.sx * at[0] + m.tx);
  const fy = Math.round(m.sy * at[1] + m.ty);
  const img = frameSet.frames[0].image;
  const p = (fy * img.width + fx) * 4;
  return Array.from(img.data.subarray(p, p + 3));
}

/** Which of the two fixture colours a pixel is nearer to (largest channel |d|). */
function nearer(rgb: readonly number[]): 'ARM' | 'TORSO' {
  const d = (c: readonly number[]): number => Math.max(...c.map((v, i) => Math.abs(v - rgb[i])));
  return d(ARM) <= d(TORSO) ? 'ARM' : 'TORSO';
}

export function runFrontSlotChecks(dir: string, say: Say, runner: RigcRunner): void {
  mkdirSync(dir, { recursive: true });
  // ---- the green fixture: limb front declared, set chest draws forearm_r in front -----------------------------------
  const green = join(dir, 'front');
  const cfgRaw = writeFrontSlotFixture(green);
  const out = build(green, runner);
  const rig = readJson(join(out, 'rig', 'rig.json'));
  const slots = (rig.slots as Array<{ name: string; bone: string; attachment?: string | null }>);
  const names = slots.map((s) => s.name);
  const front = slots.find((s) => s.name === 'forearm_r_front');
  const base = slots.find((s) => s.name === 'forearm_r');
  // By hand: plan order arm, torso, face; the arm limb's two slots are one block (#646), then torso, face; the face
  // has no still, so its family is ["face"] and forearm_r_front is the slot right after it — the last of five.
  say(
    'FS01_FRONT_SLOT_IS_RIGHT_AFTER_THE_TARGET_FAMILY_WITH_NO_SETUP_ATTACHMENT',
    front !== undefined && base !== undefined && names.indexOf('forearm_r_front') === names.indexOf('face') + 1 && names.length === 5 && front.attachment === null && front.bone === base.bone,
    `slots ${JSON.stringify(slots)}; by hand: forearm_r_front at index(face)+1 of 5, attachment null, bone of forearm_r`,
  );

  const sets = readJson(join(out, 'rig', 'sets.json'));
  const chest = ((sets.sets as Json).chest ?? {}) as { slots?: Json; hides?: string[] };
  const partsFile = readParts(join(out, 'parts.json'));
  const alt = partsFile.alternates?.find((a) => a.name === 'chest');
  // Planted: the same fixture without the set's front draws forearm_r on its base slot.
  const plain = join(dir, 'set-without-front');
  writeFrontSlotFixture(plain, { setFront: false });
  const plainOut = build(plain, runner);
  const plainSets = readJson(join(plainOut, 'rig', 'sets.json'));
  const plainChest = ((plainSets.sets as Json).chest ?? {}) as { slots?: Json; hides?: string[] };
  say(
    'FS02_SETS_JSON_COVERS_THE_FRONT_SLOT_AND_HIDES_THE_BASE_SLOT',
    chest.slots?.forearm_r_front === 'chest_forearm_r' && !Object.hasOwn(chest.slots ?? {}, 'forearm_r') && (chest.hides ?? []).includes('forearm_r') &&
      JSON.stringify(alt?.front) === '["forearm_r"]' && alt?.slots.forearm_r_front === 'chest_forearm_r' &&
      plainChest.slots?.forearm_r === 'chest_forearm_r' && !Object.hasOwn(plainChest.slots ?? {}, 'forearm_r_front') && plainChest.hides === undefined,
    `front: sets.json chest ${JSON.stringify(chest)}, parts.json front ${JSON.stringify(alt?.front)}; planted (no set front): ${JSON.stringify(plainChest)}`,
  );

  // ---- check --set chest: the still draws the forearm over the torso -----------------------------------------------
  const greenCheck = check(out, runner);
  const greenStill = readFrameSet(join(greenCheck.dir, STILL_DIR, 'chest'));
  const plainCheck = check(plainOut, runner);
  const plainStill = readFrameSet(join(plainCheck.dir, STILL_DIR, 'chest'));
  const greenPx = frameAt(rig, greenStill, FRONT_PROBE);
  const plainPx = frameAt(readJson(join(plainOut, 'rig', 'rig.json')), plainStill, FRONT_PROBE);
  const stillRig = stillRigForSet(rig, alt ?? { name: 'none', slots: {}, records: [], ghost_px: {}, recomposite: partsFile.recomposite as NonNullable<typeof partsFile.recomposite> });
  const stillSlots = (stillRig.slots as Array<{ name: string; attachment?: string | null }>);
  const stillOk = stillSlots.find((s) => s.name === 'forearm_r_front')?.attachment === 'chest_forearm_r' && stillSlots.find((s) => s.name === 'forearm_r')?.attachment === null;
  say(
    'FS03_CHECK_SET_STILL_DRAWS_THE_FOREARM_OVER_THE_TORSO',
    stillOk && nearer(greenPx) === 'ARM' && nearer(plainPx) === 'TORSO',
    `rig px ${FRONT_PROBE.join(',')} (forearm [8,28)x[29,36) over torso [18,44)x[16,50), by hand): front ${JSON.stringify(greenPx)} -> ${nearer(greenPx)}; planted set without front ${JSON.stringify(plainPx)} -> ${nearer(plainPx)}; still rig: forearm_r_front shows chest_forearm_r and forearm_r shows nothing ${stillOk}`,
  );

  // ---- base setup render: front declared and empty vs not declared -------------------------------------------------
  const undeclared = join(dir, 'undeclared');
  writeFrontSlotFixture(undeclared, { limbFront: false, setFront: false });
  const undeclaredOut = build(undeclared, runner);
  const baseFrame = (o: string): { png: Buffer; vp: string } => {
    const c = check(o, runner, undefined);
    const fs = readFrameSet(join(c.dir, STILL_DIR));
    return { png: readFileSync(join(fs.dir, fs.frames[0].name)), vp: JSON.stringify(fs.viewport) };
  };
  const declaredFrame = baseFrame(plainOut);
  const undeclaredFrame = baseFrame(undeclaredOut);
  const plainRig = readJson(join(plainOut, 'rig', 'rig.json'));
  const undeclaredRig = readJson(join(undeclaredOut, 'rig', 'rig.json'));
  const withoutFront = { ...plainRig, slots: (plainRig.slots as Array<{ name: string }>).filter((s) => s.name !== 'forearm_r_front') };
  const sameRig = JSON.stringify(withoutFront) === JSON.stringify(undeclaredRig);
  const sameParts = readFileSync(join(plainOut, 'parts.json')).equals(readFileSync(join(undeclaredOut, 'parts.json')));
  const sameSets = readFileSync(join(plainOut, 'rig', 'sets.json')).equals(readFileSync(join(undeclaredOut, 'rig', 'sets.json')));
  say(
    'FS04_A_DECLARED_EMPTY_FRONT_SLOT_LEAVES_THE_SETUP_RENDER_PIXEL_IDENTICAL',
    declaredFrame.png.equals(undeclaredFrame.png) && declaredFrame.vp === undeclaredFrame.vp && sameRig && sameParts && sameSets,
    `setup still f0 bytes equal ${declaredFrame.png.equals(undeclaredFrame.png)}, viewport equal ${declaredFrame.vp === undeclaredFrame.vp}; rig.json equal less the one front slot ${sameRig}; parts.json equal ${sameParts}; sets.json equal ${sameSets}`,
  );

  // ---- an ordinary part named like a front slot (review of #667) -------------------------------------------------------
  // No limb declares front; the upper arm is authored as `forearm_r_front`. The set covers both arm parts, so its record
  // maps `forearm_r` and `forearm_r_front`: two parts, not one part twice, so nothing may be refused as a front slot.
  const lookalike = join(dir, 'lookalike');
  writeFrontSlotFixture(lookalike, { limbFront: false, setFront: false, upperName: 'forearm_r_front' });
  let lookalikeError = '';
  let lookalikeSlots: string[] = [];
  try {
    const lookOut = build(lookalike, runner);
    lookalikeSlots = Object.keys(((readJson(join(lookOut, 'rig', 'sets.json')).sets as Json).chest as Json).slots as Json).sort();
  } catch (e) {
    lookalikeError = (e as Error).message;
  }
  say(
    'FS07_A_PART_NAMED_LIKE_A_FRONT_SLOT_IS_AN_ORDINARY_PART',
    lookalikeError === '' && JSON.stringify(lookalikeSlots) === JSON.stringify(['forearm_r', 'forearm_r_front']),
    `no front declared, upper arm authored as "forearm_r_front": build ${lookalikeError === '' ? 'green' : `refused (${lookalikeError.slice(0, 200)})`}; set chest maps ${JSON.stringify(lookalikeSlots)}`,
  );

  // ---- refusals by name ----------------------------------------------------------------------------------------------
  const mutate = (edit: (c: Json) => void): Json => {
    const c = structuredClone(cfgRaw);
    edit(c);
    return c;
  };
  const limb = (c: Json): Json => ((c.limbs as Json).arm_r as Json);
  const set0 = (c: Json): Json => (((c.assemble as Json).alternates as Json[])[0]);
  const positive = refused(() => parseConfig(cfgRaw)) === '' && refused(() => parseEarlyConfig(cfgRaw, 'assemble')) === '';
  const configCases: Array<[string, string, Json]> = [
    ['CONFIG_FRONT_SCOPE', 'foreign part', mutate((c) => { limb(c).front = { parts: ['torso'], after: 'face' }; })],
    ['CONFIG_FRONT_SCOPE', 'empty', mutate((c) => { limb(c).front = { parts: [], after: 'face' }; })],
    ['CONFIG_FRONT_SCOPE', 'repeated', mutate((c) => { limb(c).front = { parts: ['forearm_r', 'forearm_r'], after: 'face' }; })],
    ['CONFIG_FRONT_NAME', 'unknown part', mutate((c) => { limb(c).front = { parts: ['forearm_r'], after: 'nothing_here' }; })],
    ['CONFIG_FRONT_NAME', 'consumed layer', mutate((c) => { limb(c).front = { parts: ['forearm_r'], after: 'arm' }; })],
    ['CONFIG_FRONT_NAME', 'own segment', mutate((c) => { limb(c).front = { parts: ['forearm_r'], after: 'upperarm_r' }; })],
    ['CONFIG_FRONT_NAME', 'slot name taken', mutate((c) => { ((c.assemble as Json).plan as unknown[]).push(['forearm_r_front', 'head', 'face']); })],
    ['CONFIG_FRONT_LAYOUT', 'front with layout', mutate((c) => { limb(c).layout = { after: { part: 'torso' } }; })],
    ['CONFIG_SET_FRONT', 'not covered', mutate((c) => { set0(c).front = ['torso']; })],
    ['CONFIG_SET_FRONT', 'no limb front', mutate((c) => { delete limb(c).front; })],
  ];
  const configResults = configCases.map(([code, what, c]) => {
    const full = refused(() => parseConfig(c));
    const early = refused(() => parseEarlyConfig(c, 'assemble'));
    return { code, what, ok: full.includes(code) && early.includes(code), full };
  });

  // RIG_SET_FRONT_BOTH: a parts.json set record mapping both forearm_r and forearm_r_front.
  const inputs = readRigInputs(join(green, 'config.json'), out);
  const both = structuredClone(inputs.parts);
  const bothAlt = both.alternates?.[0];
  if (bothAlt !== undefined) bothAlt.slots = { ...bothAlt.slots, forearm_r: 'chest_forearm_r' };
  const bothMsg = refused(() => buildRig(inputs.cfg, both, inputs.images));
  const greenRig = buildRig(inputs.cfg, inputs.parts, inputs.images);

  // CONFIG_SET_FRONT_KEYED: a {"set"} key on the front part's track; the upper arm (drawn on its base slot) expands.
  const keyed = (slot: string): { msg: string; motion: MotionSpec } => {
    const motion = structuredClone(greenRig.motion) as MotionSpec;
    (motion.animations as Record<string, unknown>).gesture = { duration: 1, loop: false, tracks: [{ slot, property: 'attachment', keys: [{ t: 0, set: 'chest' }] }] };
    const r = structuredClone(greenRig.rig) as RigSpec;
    return { msg: refused(() => expandSetAttachmentKeys(r, greenRig.sets, motion)), motion };
  };
  const keyedForearm = keyed('forearm_r');
  const keyedFront = keyed('forearm_r_front');
  const keyedUpper = keyed('upperarm_r');
  const upperTrack = ((keyedUpper.motion.animations as Record<string, Json>).gesture.tracks as Json[])[0];
  const upperV = ((upperTrack.keys as Json[])[0]).v;
  const allCodes = [
    ...configResults.map((r) => r.ok),
    bothMsg.includes('RIG_SET_FRONT_BOTH') && bothMsg.includes('forearm_r'),
    keyedForearm.msg.includes('CONFIG_SET_FRONT_KEYED') && keyedFront.msg.includes('CONFIG_SET_FRONT_KEYED'),
  ];
  say(
    'FS05_EACH_REFUSAL_FIRES_BY_NAME_ON_A_MINIMAL_BAD_INPUT',
    positive && allCodes.every((x) => x) && keyedUpper.msg === '' && upperV === 'chest_upperarm_r',
    `green config accepted by both doors ${positive}; ${configResults.map((r) => `${r.code} (${r.what}) ${r.ok}`).join('; ')}; RIG_SET_FRONT_BOTH ${bothMsg.includes('RIG_SET_FRONT_BOTH')}; CONFIG_SET_FRONT_KEYED on forearm_r ${keyedForearm.msg.includes('CONFIG_SET_FRONT_KEYED')}, on forearm_r_front ${keyedFront.msg.includes('CONFIG_SET_FRONT_KEYED')}; positive: upperarm_r key expands to ${JSON.stringify(upperV)} (refusal ${JSON.stringify(keyedUpper.msg)})`,
  );

  // ---- the set's seam: composite follows the front order ------------------------------------------------------------
  const figure = (greenCheck.sets.chest ?? {}) as Json;
  const stage = rig.skeleton as StageBox;
  const frame = greenStill.frames[0].image;
  const composite = (order?: readonly string[]): Raster => flatCompositeForSet(partsFile, alt ?? partsFile.alternates?.[0] as NonNullable<typeof alt>, join(out, 'parts'), greenStill.background, order);
  const followed = seamFigures(composite(names), frame, stage, greenStill.viewport, greenStill.background);
  const planted = seamFigures(composite(), frame, stage, greenStill.viewport, greenStill.background);
  // By hand: the forearm's set art over the torso is rows 29..35 x columns 18..27 of the forearm block — 70 rig px
  // the planted (parts order) composite draws as torso, each more than 40 apart in a channel (ARM vs NAVY: 180).
  say(
    'FS06_THE_SET_SEAM_COMPOSITES_IN_FRONT_ORDER_AND_PARTS_ORDER_REPORTS_THE_OVERLAP',
    figure.PASS === true && figure.seam_px_over_40 === followed.over40 && followed.over40 < planted.over40 && planted.over40 >= 70,
    `check --set chest: seam_px_over_40 ${String(figure.seam_px_over_40)}, PASS ${String(figure.PASS)}; front-order composite over40 ${followed.over40}; planted parts-order composite over40 ${planted.over40} (by hand at least the 70 overlap rig px at frame scale ${greenStill.viewport.scale.toFixed(3)})`,
  );

}
