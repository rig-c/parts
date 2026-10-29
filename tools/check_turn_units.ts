/** Explicit sampled unit depths, independent of lateral surface texture. */
import { asymmetricUnitTurnFixture, unitSupportTurnFixture } from '../fixtures/turn_units.ts';
import { parseConfig } from '../src/config.ts';
import { buildRig, type RigOutput } from '../src/rig.ts';
import type { Problem } from '../src/errors.ts';
import { pyRound } from '../src/round.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
type UnitTrack = { group?: string; property: string; keys: Array<{ t: number; v?: number[]; derive?: { kind: string; degrees: number; carried: number; depth: Record<string, number>; narrowing: boolean } }> };
function units(b: RigOutput, name: string): UnitTrack {
  const anim = b.motion.animations[name] as unknown as { tracks: UnitTrack[] };
  return anim.tracks.find(t => t.group === 'turn_units')!;
}
function build(explicit: boolean) {
  const f = asymmetricUnitTurnFixture(explicit);
  return buildRig(parseConfig(f.config), f.parts, f.images);
}

export function runTurnUnitChecks(say: Say): void {
  runTurnUnitSupportChecks(say);
  const sampled = build(false), explicit = build(true);
  let sampledOracle = true, equal = true, signs = true;
  const readings: string[] = [];
  // The face is a 24-column opaque ramp, 40 + 4*x, zScale=40.
  // Its median is 86. Mirrored outside landmarks clamp to levels 40 and 132.
  const zRef = pyRound(86 * 40 / 255, 4);
  const expected = [40, 132].map(level => pyRound(20 + level * 40 / 255 - zRef, 4));
  for (const [name, band] of [['turn', 15], ['tilt', 12]] as const) {
    const a = units(sampled, name), b = units(explicit, name);
    const depths = a.keys[0].derive!.depth;
    sampledOracle &&= depths.ear_r === expected[0] && depths.ear_l === expected[1] && depths.ear_r !== depths.ear_l;
    equal &&= b.keys.every(k => k.derive === undefined ? k.v?.[0] === 0 : k.derive.depth.ear_r === -4 && k.derive.depth.ear_l === -4);
    const travel = (depth: number, degree: number) => (20 - depth) * Math.sin(degree * Math.PI / 180);
    const minus = travel(-4, -band), plus = travel(-4, band);
    signs &&= minus === -plus && plus > 0 && b.keys[0].derive?.degrees === -band && b.keys[4].derive?.degrees === band && b.keys.every(k => k.derive === undefined || (k.derive.carried === 20 && k.derive.narrowing === false));
    readings.push(`${name}: sampled ${JSON.stringify(depths)}, explicit ${JSON.stringify(b.keys[0].derive!.depth)}, local extremes ${minus}/${plus}`);
  }
  say('UT01_ASYMMETRIC_SURFACE_IS_NOT_EQUAL_LEGACY_DEPTH', sampledOracle, `equal legacy layer depths do not override sampled roles; analytic ramp depths ${expected.join('/')}`);
  say('UT02_EQUAL_EXPLICIT_UNITS_BOTH_AXES', equal && signs, readings.join('; ') + '; same sign within a frame, opposite signs across extrema');
  const noLegacy = asymmetricUnitTurnFixture(false);
  delete (noLegacy.config.turn as { depths?: Record<string, number> }).depths;
  const without = buildRig(parseConfig(noLegacy.config), noLegacy.parts, noLegacy.images);
  say('UT03_LEGACY_DEPTHS_DO_NOT_CHANGE_SAMPLED_BYTES', JSON.stringify(without.rig) === JSON.stringify(sampled.rig) && JSON.stringify(without.motion) === JSON.stringify(sampled.motion), 'removing equal legacy layer depths leaves rig and motion bytes unchanged; no implicit unit conversion');
  const zero = asymmetricUnitTurnFixture();
  (zero.config.turn as { unitDepths: Record<string, number> }).unitDepths = { ear_r: 0, ear_l: 0 };
  const zeroBuild = buildRig(parseConfig(zero.config), zero.parts, zero.images);
  say('UT04_ZERO_IS_AN_EXPLICIT_UNIT_DEPTH', ['turn', 'tilt'].every(name => units(zeroBuild, name).keys.filter(k => k.derive !== undefined).every(k => k.derive!.depth.ear_r === 0 && k.derive!.depth.ear_l === 0)), 'zero overrides asymmetric surface sampling rather than falling through');
  const stripped = (b: RigOutput): string => {
    const motion = structuredClone(b.motion);
    for (const name of ['turn', 'tilt']) {
      const t = (motion.animations[name] as unknown as { tracks: UnitTrack[] }).tracks.find(t => t.group === 'turn_units')!;
      for (const k of t.keys) if (k.derive !== undefined) k.derive.depth = { ear_r: 0, ear_l: 0 };
    }
    return JSON.stringify(motion);
  };
  say('UT05_EXPLICIT_OVERRIDE_CHANGES_ONLY_UNIT_DEPTH_MAPS', JSON.stringify(sampled.rig) === JSON.stringify(explicit.rig) && stripped(sampled) === stripped(explicit) && [...sampled.images].every(([n, a]) => { const b = new Map(explicit.images).get(n); return b !== undefined && a.width === b.width && a.height === b.height && a.data.every((v, i) => v === b.data[i]); }), 'all setup bones, topology, surface deforms, body motion, idle, constraints and image bytes preserved');
}


function runTurnUnitSupportChecks(say: Say): void {
  const buildSupport = (support: Parameters<typeof unitSupportTurnFixture>[0], explicit = false) => {
    const f = unitSupportTurnFixture(support, explicit);
    return buildRig(parseConfig(f.config), f.parts, f.images) as RigOutput & { turnWarnings?: Problem[] };
  };
  const warnings = (b: ReturnType<typeof buildSupport>) => b.turnWarnings ?? [];
  say('UT06_OPAQUE_INTERIOR_AND_EDGE_SILENT', ['inside', 'edge'].every(s => warnings(buildSupport(s as 'inside' | 'edge')).length === 0), 'generic tokens on fully opaque interior and boundary pixels need no extrapolation warning');
  const outside = buildSupport('outside'), outsideWarnings = warnings(outside);
  say('UT07_OUTSIDE_SAMPLE_NAMES_RAW_CLAMP_AND_ART_ALPHA', outsideWarnings.length === 2 && outsideWarnings.every(w => w.code === 'RIG_TURN_UNIT_DEPTH_SUPPORT' && w.detail.includes('face_depth.png') && w.detail.includes('art alpha 255') && w.detail.includes('outside')) && ['token_r', 'token_l'].every(p => outsideWarnings.some(w => w.object.includes(p))), JSON.stringify(outsideWarnings));
  for (const [support, alpha] of [['transparent', 0], ['fringe', 127]] as const) {
    const ws = warnings(buildSupport(support));
    say(support === 'transparent' ? 'UT08_TRANSPARENT_ART_SUPPORT_WARN' : 'UT09_FRINGE_ART_SUPPORT_WARN', ws.length === 2 && ws.every(w => w.detail.includes(`art alpha ${alpha}`) && w.detail.includes('inside') && w.detail.includes('face_depth.png')), JSON.stringify(ws));
  }
  const explicit = unitSupportTurnFixture('outside', true);
  (explicit.config.turn as { unitDepths: Record<string, number> }).unitDepths = { token_r: 0, token_l: 0 };
  const zero = buildRig(parseConfig(explicit.config), explicit.parts, explicit.images) as RigOutput & { turnWarnings?: Problem[] };
  say('UT10_EXPLICIT_DEPTH_BYPASSES_SUPPORT_WARNING', warnings(buildSupport('outside', true)).length === 0 && warnings(buildSupport('transparent', true)).length === 0 && warnings(zero).length === 0, 'explicit part overrides, including zero, use no cross-part sample and produce no support warning');
  const repeat = buildSupport('outside');
  say('UT11_WARNING_ORDER_DETERMINISTIC', outsideWarnings.length === 2 && JSON.stringify(outsideWarnings) === JSON.stringify(warnings(repeat)), 'one warning per sampled unit/bone in declaration order on repeated builds');
}
