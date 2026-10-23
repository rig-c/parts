/** Issue #543: declared-anchor loader and registration controls on flat-fixture coordinates. */
import { limbConfig, LIMBS, LIMB_BONES } from '../fixtures/assemble_fixture.ts';
import { parseConfig, type BoneEntry } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { registerSkeleton, registeredWithinBar } from '../src/limbs.ts';
import { scaledPoints, type PosePoints } from '../src/skeleton.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
export function runSetAnchorChecks(say: Say): void {
  const bones = LIMB_BONES.slice(0, 2) as unknown as BoneEntry[];
  const points: PosePoints = { ...scaledPoints('stand_sides', 64, 64), neck: [32.5, 8], r_shoulder: [15, 10], r_elbow: [15, 30], r_wrist: [15, 50], r_hip: [32.5, 8] };
  const none = registerSkeleton(bones, points);
  const one = registerSkeleton(bones, points, { neck: 'hip' });
  const displaced = registerSkeleton(bones, { ...points, neck: [34, 8] }, { neck: 'hip' });
  const two = registerSkeleton(bones, { ...points, r_shoulder: [15.5, 10] }, { r_shoulder: 'sleeve_r0', r_hip: 'hip' });
  const reversed = registerSkeleton(bones, { ...points, r_shoulder: [15.5, 10] }, { r_hip: 'hip', r_shoulder: 'sleeve_r0' });
  say('AK698_ONE_ANCHOR_REGISTERS_AN_ARM_ONLY_BASE_AND_EXCEEDING_THE_OFFSET_BAR_FAILS',
    !none.ok && none.missing.join() === 'bottom' && one.ok && one.scale === 1 && one.offset.join() === '-0.5,0' && registeredWithinBar(one) && displaced.ok && displaced.offset.join() === '-2,0' && !registeredWithinBar(displaced),
    `without anchor ${JSON.stringify(none)}; declared anchor ${JSON.stringify(one)}; displaced ${JSON.stringify(displaced)}`);
  say('AK698_TWO_ANCHORS_READ_SCALE_AND_OFFSET_IN_CANONICAL_KEYPOINT_ORDER', two.ok && two.scale === 1 && two.offset.join() === '-0.5,0' && JSON.stringify(two) === JSON.stringify(reversed), JSON.stringify(two));
  const scaled = (factor: number) => registerSkeleton(bones, { ...points, r_shoulder: [15 / factor, 10 / factor], r_hip: [32 / factor, 8 / factor] }, { r_shoulder: 'sleeve_r0', r_hip: 'hip' });
  const near = scaled(1.005), far = scaled(1.02);
  const collapsed = registerSkeleton(bones, { ...points, r_shoulder: [32, 8], r_hip: [32, 8] }, { r_shoulder: 'sleeve_r0', r_hip: 'hip' });
  say('AK698_TWO_ANCHORS_MEASURE_SCALE_WITH_THE_EXISTING_BAR_AND_REFUSE_COINCIDENT_POINTS',
    near.ok && near.scale === 1.005 && near.offset.join() === '0,0' && registeredWithinBar(near) && far.ok && far.scale === 1.02 && !registeredWithinBar(far) && !collapsed.ok,
    `within ${JSON.stringify(near)}; over ${JSON.stringify(far)}; collapsed ${JSON.stringify(collapsed)}`);
  const cfg = limbConfig({ arm_r: LIMBS.arm_r }, LIMB_BONES.slice(0, 2));
  const assemble = cfg.assemble as Record<string, unknown>; assemble.plan = [['arm', 'full', 'handwear-r']];
  assemble.alternates = [{ name: 'pose', skeleton: 'pose.json', anchor: { neck: 'hip' } }];
  const problems = (edit: (alt: Record<string, unknown>) => void): string[] => {
    const candidate = structuredClone(cfg); const alt = ((candidate.assemble as Record<string, unknown>).alternates as Array<Record<string, unknown>>)[0]; edit(alt);
    try { parseConfig(candidate); return []; } catch (e) { if (!(e instanceof PartsError)) throw e; return e.problems.map((p) => `${p.code} ${p.object}`); }
  };
  const cases: Array<[string, (a: Record<string, unknown>) => void, string]> = [
    ['unknown point', (a) => a.anchor = { mystery: 'hip' }, 'CONFIG_KEY_KNOWN config.assemble.alternates[0].anchor.mystery'],
    ['unknown bone', (a) => a.anchor = { neck: 'missing' }, 'CONFIG_NAME_RESOLVES config.assemble.alternates[0].anchor.neck'],
    ['empty', (a) => a.anchor = {}, 'CONFIG_FIELD_TYPE config.assemble.alternates[0].anchor'],
    ['three', (a) => a.anchor = { neck: 'hip', r_hip: 'hip', l_hip: 'hip' }, 'CONFIG_FIELD_TYPE config.assemble.alternates[0].anchor'],
    ['no skeleton', (a) => { delete a.skeleton; }, 'CONFIG_FIELD_PRESENT config.assemble.alternates[0].skeleton'],
  ];
  const actual = cases.map(([name, edit, code]) => ({ name, actual: problems(edit), code }));
  say('AK698_THE_LOADER_ACCEPTS_A_DECLARED_ANCHOR_AND_NAMES_EVERY_INVALID_REFERENCE', problems(() => {}).length === 0 && actual.every((r) => r.actual.includes(r.code)), JSON.stringify(actual));
}
