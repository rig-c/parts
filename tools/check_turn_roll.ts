/** Report-only head-roll controls on the existing hand-computable face fixture. */
import { faceConfig, faceImages, faceParts } from '../fixtures/rig.ts';
import { weightedSurfaceEarFixture } from '../fixtures/turn_surface.ts';
import { parseConfig } from '../src/config.ts';
import { buildRig } from '../src/rig.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
// Fixed before implementation: midpoint of the measured public control maximum
// (4.864514437760526 degrees) and the tilted input (32.106255955117845 degrees).
const LIMIT = 18.485385196439186;
const CODE = 'RIG_TURN_HEAD_ROLL';

export function runTurnRollChecks(say: Say): void {
  const fixture = (degrees?: number, turn = true, eyes: ReadonlyArray<'r' | 'l'> = ['r', 'l']) => {
    const raw = faceConfig(eyes);
    if (degrees !== undefined) {
      const bones = raw.bones as Array<{ name: string; at: [number, number] }>;
      bones.find(b => b.name === 'eye_r')!.at = [20, 32];
      bones.find(b => b.name === 'eye_l')!.at = [36, 32 - 16 * Math.tan(degrees * Math.PI / 180)];
    }
    const parts = faceParts(eyes);
    if (turn) raw.turn = { pivot: 0.8, depths: Object.fromEntries(parts.parts.map(p => [p.name, 0.4])) };
    const before = JSON.stringify(raw);
    const result = buildRig(parseConfig(raw), parts, faceImages());
    return { raw, before, result };
  };
  const rolled = fixture();
  const warning = rolled.result.turnWarnings?.find(w => w.code === CODE);
  say('HTR01_TILTED_HEAD_IS_NAMED_WITH_ROLL_AND_LIMIT', warning?.object === 'part "face"' && warning.detail.includes('36.869898') && warning.detail.includes('18.485385') && warning.detail.includes('eye_r') && warning.detail.includes('eye_l'), warning === undefined ? 'silent tilted head with a declared turn' : JSON.stringify(warning));
  const below = fixture(LIMIT - 0.001), above = fixture(LIMIT + 0.001), negative = fixture(-LIMIT - 0.001);
  const warns = (f: ReturnType<typeof fixture>) => f.result.turnWarnings?.some(w => w.code === CODE) ?? false;
  say('HTR02_PLANTED_PUBLIC_LIMIT_BOTH_SIGNS_AND_JUST_UNDER', !warns(below) && warns(above) && warns(negative), `limit ${LIMIT}; below ${below.result.faceAxis.degrees}: ${warns(below)}; above ${above.result.faceAxis.degrees}: ${warns(above)}; negative ${negative.result.faceAxis.degrees}: ${warns(negative)}`);
  const level = fixture(0), noTurn = fixture(undefined, false), missing = fixture(undefined, true, ['r']);
  say('HTR03_LEVEL_ABSENT_TURN_AND_MISSING_EYE_ARE_SILENT', !warns(level) && !warns(noTurn) && !warns(missing) && missing.result.faceAxis.degrees === null, `level ${level.result.faceAxis.degrees}; no turn ${noTurn.result.faceAxis.degrees}; missing ${missing.result.faceAxis.none}`);
  const right = faceConfig();
  const bones = right.bones as Array<{name: string; at: [number, number]}>;
  const a = bones.find(b => b.name === 'eye_r')!, b = bones.find(b => b.name === 'eye_l')!;
  [a.at, b.at] = [b.at, a.at];
  right.turn = rolled.raw.turn;
  const reversed = buildRig(parseConfig(right), faceParts(), faceImages());
  say('HTR04_EYE_ORDER_DOES_NOT_CHANGE_THE_WARNING', JSON.stringify(reversed.turnWarnings?.filter(w => w.code === CODE)) === JSON.stringify(rolled.result.turnWarnings?.filter(w => w.code === CODE)), `image-left-to-right roll ${reversed.faceAxis.degrees}`);
  const serialized = JSON.stringify({ rig: rolled.result.rig, motion: rolled.result.motion, meshReport: rolled.result.meshReport });
  say('HTR05_WARNING_NEVER_SERIALIZES_OR_EDITS_CONFIG', JSON.stringify(rolled.raw) === rolled.before && !serialized.includes(CODE) && !serialized.includes('turnWarnings') && warning !== undefined, 'caller config unchanged; no warning field in rig, motion or mesh report; buildRig returned normally');
  const sampled = weightedSurfaceEarFixture();
  const eyeParts = faceParts().parts.filter(p => p.from.includes('eyewhite'));
  sampled.parts.parts.push(...eyeParts);
  for (const p of eyeParts) sampled.images.set(p.name, faceImages().get(p.name)!);
  (sampled.config.bones as unknown[]).push({ name: 'eye_r', parent: 'head', at: [20, 28] }, { name: 'eye_l', parent: 'head', at: [36, 16] });
  sampled.config.regions = { ...(sampled.config.regions as Record<string, string>), eyewhite_r: 'eye_r', eyewhite_l: 'eye_l' };
  (sampled.config.assemble as {plan: string[][]}).plan.push(...eyeParts.map(p => [p.name, 'head', p.from.split(':')[1]]));
  const turn = sampled.config.turn as {roles: Record<string, string>; unitDepths: Record<string, number>; body: unknown};
  for (const p of eyeParts) { turn.roles[p.name] = 'unit'; turn.unitDepths[p.name] = 0; }
  const sampledResult = buildRig(parseConfig(sampled.config), sampled.parts, sampled.images);
  say('HTR06_SAMPLED_HEAD_TURN_USES_THE_SAME_ROLL', sampledResult.turnWarnings?.some(w => w.code === CODE && w.object === 'part "face"') === true, `sampled head roll ${sampledResult.faceAxis.degrees}; ${JSON.stringify(sampledResult.turnWarnings?.filter(w => w.code === CODE))}`);
  sampled.config.turn = { body: turn.body };
  const bodyOnly = buildRig(parseConfig(sampled.config), sampled.parts, sampled.images);
  say('HTR07_BODY_ONLY_TURN_IS_SILENT_ON_A_ROLLED_HEAD', bodyOnly.faceAxis.degrees! > LIMIT && !bodyOnly.turnWarnings?.some(w => w.code === CODE), `body-only config, measured head roll ${bodyOnly.faceAxis.degrees}; no head depths or roles; ${JSON.stringify(bodyOnly.turnWarnings ?? [])}`);
}

if (import.meta.main) {
  let failures = 0;
  runTurnRollChecks((name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); if (!ok) failures++; });
  process.exitCode = failures === 0 ? 0 : 1;
}
