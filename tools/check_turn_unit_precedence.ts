/** Named controls for the documented unit-depth precedence; no forced helper fallback. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unitPrecedenceFixture, type UnitPrecedenceMode } from '../fixtures/turn_unit_precedence.ts';
import { parseConfig } from '../src/config.ts';
import { buildRig, type RigOutput } from '../src/rig.ts';
import { PartsError } from '../src/errors.ts';
import { pyRound } from '../src/round.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
type UnitAnimation = { tracks: Array<{ group?: string; keys: Array<{ derive?: { depth: Record<string, number> } }> }> };
export function emittedUnitDepths(b: RigOutput): Record<string, number> {
  const a = b.motion.animations.turn as unknown as UnitAnimation;
  return a.tracks.find(t => t.group === 'turn_units')!.keys[0].derive!.depth;
}
export function runTurnUnitPrecedenceChecks(say: Say): void {
  const build = (mode: UnitPrecedenceMode) => { const f = unitPrecedenceFixture(mode); return buildRig(parseConfig(f.config), f.parts, f.images); };
  const pl = build('part-low'), ph = build('part-high'), bl = build('bone-low'), bh = build('bone-high');
  const sl = build('surface-low'), sh = build('surface-high'), sc = build('surface-changed');
  const explicit = { token_l_bone: 8, token_r_bone: 0 };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const depthsMatch = (a: Record<string, number>, expected: Record<string, number>) => Object.keys(a).length === Object.keys(expected).length && Object.entries(expected).every(([name, value]) => a[name] === value);
  say('UDP01_PART_OVERRIDE_WINS_OVER_BONE_AND_OWN_SHEET', depthsMatch(emittedUnitDepths(pl), explicit) && same(pl.rig, ph.rig) && same(pl.motion, ph.motion), `conflicting bone -4 loses to part depths; explicit zero retained; ${JSON.stringify(emittedUnitDepths(pl))}`);
  say('UDP02_BONE_OVERRIDE_WINS_OVER_OWN_SHEET', depthsMatch(emittedUnitDepths(bl), explicit) && same(bl.rig, bh.rig) && same(bl.motion, bh.motion), `distinct part/bone names; ${JSON.stringify(emittedUnitDepths(bl))}`);
  // Face ramp 40+4*x, median 86, opaque interior samples at local columns 2/21.
  const ref = pyRound(86 * 40 / 255, 4);
  const normal = { token_l_bone: pyRound(20 + 124 * 40 / 255 - ref, 4), token_r_bone: pyRound(20 + 48 * 40 / 255 - ref, 4) };
  say('UDP03_PRIMARY_SURFACE_MASKS_OWN_SHEET_WITHOUT_OVERRIDES', depthsMatch(emittedUnitDepths(sl), normal) && same(sl.rig, sh.rig) && same(sl.motion, sh.motion), `own levels 40/220; primary samples 48/124 and median86; ${JSON.stringify(emittedUnitDepths(sl))}`);
  const reversed = { token_l_bone: normal.token_r_bone, token_r_bone: normal.token_l_bone };
  say('UDP04_PRIMARY_SURFACE_CHANGE_MOVES_UNIT_DEPTHS', depthsMatch(emittedUnitDepths(sc), reversed) && !same(sl.motion, sc.motion), `same own sheets, reversed primary ramp; ${JSON.stringify(emittedUnitDepths(sc))}`);
  const references = (b: RigOutput) => b.depthReferences?.filter(r => r.part.startsWith('token_')).map(r => r.depth.sources[0].sha256);
  say('UDP05_MASKED_OWN_SHEETS_STILL_RECORDED', references(sl)?.length === 2 && references(sh)?.length === 2 && !same(references(sl), references(sh)), 'own sheets retain distinct provenance/companions even when rig/motion bytes do not change');
  const f = unitPrecedenceFixture('surface-low'), turn = f.config.turn as { roles: Record<string, string> };
  for (const [part, role] of Object.entries(turn.roles)) if (role === 'surface') delete turn.roles[part];
  let refusal = '';
  try { parseConfig(f.config); } catch (e) { if (!(e instanceof PartsError)) throw e; refusal = e.problems.map(p => p.code).join(','); }
  say('UDP06_REMOVING_REQUIRED_SURFACES_DOES_NOT_SELECT_FALLBACK', refusal.includes('CONFIG_TURN_SURFACE_REQUIRED'), refusal);
  const stability = readFileSync(resolve('docs/STABILITY.md'), 'utf8');
  say('UDP07_STABILITY_NAMES_ACTIVE_WEIGHTED_AND_BODY_CONSUMERS', !/Current weighted meshes do\s+not acquire a Core field or change geometry/.test(stability) && stability.includes('turn.body') && stability.includes('per-influence'), 'passive companions distinguished from active surface geometry; stale blanket planted by the pre-edit source is refused');
}
