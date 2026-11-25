/** A collar band on a torso that other turn parts overlap (#1543): hand-derived travel, refusals by name. */
import { BAND_OVERLAP, bandOverlapTurnFixture, type BandOverlapVariant } from '../fixtures/turn_band_overlap.ts';
import { parseConfig } from '../src/config.ts';
import { buildRig, type MeshAttachment, type RigOutput } from '../src/rig.ts';
import { computeWorldTransforms, toWorld } from '../src/coords.ts';
import { PartsError, type Problem } from '../src/errors.ts';
import { turnKeyFlips } from './measure_turn_flips.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
type Animation = { deform?: Array<{ slot: string; keys: Array<{ vertices?: number[] }> }> };
const SIN15 = Math.sin(Math.PI / 12);

function build(v: BandOverlapVariant): { b?: RigOutput; problems: readonly Problem[] } {
  const f = bandOverlapTurnFixture(v);
  try { return { b: buildRig(parseConfig(f.config), f.parts, f.images), problems: [] }; }
  catch (e) { if (e instanceof PartsError) return { problems: e.problems }; throw e; }
}

/** Torso vertex positions (canvas px, y down) at key indices of turn, tilt and body_turn; 2 is rest. */
function posed(b: RigOutput, keys: readonly [number, number, number]): number[][] {
  const world = computeWorldTransforms(b.rig.bones), att = b.rig.skins.default.topwear.topwear as MeshAttachment;
  const offsets = ['turn', 'tilt', 'body_turn'].map((n, i) => (b.motion.animations[n] as Animation | undefined)?.deform?.find(d => d.slot === 'topwear')?.keys[keys[i]].vertices ?? []);
  let at = 0;
  return att.weights.map(row => {
    let x = 0, y = 0;
    for (const w of row) {
      const [wx, wy] = toWorld(world.get(w.bone)!, w.x + offsets.reduce((s, o) => s + (o[at] ?? 0), 0), w.y + offsets.reduce((s, o) => s + (o[at + 1] ?? 0), 0));
      x += wx * w.weight; y += wy * w.weight; at += 2;
    }
    return [x + 32, BAND_OVERLAP.height - y];
  });
}

/** Triangles whose signed area changes sign from rest over the 5x5x5 key grid. */
function folds(b: RigOutput): number {
  const tri = (b.rig.skins.default.topwear.topwear as MeshAttachment).triangles, rest = posed(b, [2, 2, 2]);
  const area = (p: number[][], i: number) => { const [a, c, d] = [p[tri[i]], p[tri[i + 1]], p[tri[i + 2]]]; return (c[0] - a[0]) * (d[1] - a[1]) - (c[1] - a[1]) * (d[0] - a[0]); };
  let n = 0;
  for (let y = 0; y < 5; y++) for (let p = 0; p < 5; p++) for (let s = 0; s < 5; s++) {
    const q = posed(b, [y, p, s]);
    for (let i = 0; i < tri.length; i += 3) if (area(q, i) * area(rest, i) < 0) n++;
  }
  return n;
}

/**
 * Worst |travel - hand value| at +15 degrees, per vertex. Open column (x >= 36, y 20..46):
 * g = clamp(1 - (y - chin) / band) for y >= chin, 1 above; head yaw -16 sin15 g, body yaw
 * -24 sin15 (1 - g), both the sum. Covered rows (coat + glove, x 22..30, y 60..72): body
 * yaw -24 sin15, the single-group torso's own field.
 */
function travelError(b: RigOutput, band: boolean) {
  const { chin, band: width, headPivot, bodyPivot } = BAND_OVERLAP;
  const rest = posed(b, [2, 2, 2]), head = posed(b, [4, 2, 2]), body = posed(b, [2, 2, 4]), both = posed(b, [4, 2, 4]);
  let open = 0, covered = 0, openN = 0, coveredN = 0;
  for (const [i, [x, y]] of rest.entries()) {
    if (x >= 36 && y >= 20 && y <= 46) {
      const g = band ? Math.min(1, Math.max(0, y < chin ? 1 : 1 - (y - chin) / width)) : 0;
      const wantHead = -headPivot * SIN15 * g, wantBody = -bodyPivot * SIN15 * (1 - g);
      open = Math.max(open, Math.abs(head[i][0] - x - wantHead), Math.abs(body[i][0] - x - wantBody), Math.abs(both[i][0] - x - wantHead - wantBody));
      openN++;
    }
    if (x >= 22 && x <= 30 && y >= 60 && y <= 72) {
      covered = Math.max(covered, Math.abs(body[i][0] - x + bodyPivot * SIN15), Math.abs(head[i][0] - x));
      coveredN++;
    }
  }
  return { open, openN, covered, coveredN };
}

const tally = (problems: readonly Problem[]) => {
  const counts: Record<string, number> = {};
  for (const p of problems) counts[p.code] = (counts[p.code] ?? 0) + 1;
  return counts;
};

/** Vertices whose positive weights span the head-group collar and a body bone, by index. */
function mixedVertices(b: RigOutput): Set<number> {
  const att = b.rig.skins.default.topwear.topwear as MeshAttachment;
  return new Set(att.weights.flatMap((row, i) => row.some(w => w.weight > 0 && w.bone === 'collar') && row.some(w => w.weight > 0 && w.bone !== 'collar') ? [i] : []));
}

/** The torso's emitted deform timelines on the three turn animations, as JSON. */
const torsoDeform = (b: RigOutput) => JSON.stringify(['turn', 'tilt', 'body_turn'].map(n => (b.motion.animations[n] as Animation | undefined)?.deform?.filter(d => d.slot === 'topwear')));

export function runTurnBandOverlapChecks(say: Say): void {
  const TOL = 0.00002; // float32 offsets: the worst reading on every variant is 7.9e-6 px
  const single = build('single'), banded = build('band-depth');
  const singleErr = single.b === undefined ? undefined : travelError(single.b, false);
  say('BV01_SINGLE_GROUP_TORSO_UNDER_COVERS_BUILDS_WITH_ITS_OWN_FIELD',
    singleErr !== undefined && singleErr.open < TOL && singleErr.covered < TOL && singleErr.openN > 0 && singleErr.coveredN > 0 && folds(single.b!) === 0,
    singleErr === undefined ? `refused: ${JSON.stringify(tally(single.problems))}` : `${JSON.stringify(singleErr)}; folds ${folds(single.b!)}`);
  const bandErr = banded.b === undefined ? undefined : travelError(banded.b, true);
  const mixed = banded.b === undefined ? new Set<number>() : mixedVertices(banded.b);
  say('BV02_BAND_UNDER_COVERS_BUILDS_LINEAR_FALLOFF_AND_PURE_ROWS_KEEP_SINGLE_GROUP_FIELD',
    bandErr !== undefined && bandErr.open < TOL && bandErr.covered < TOL && bandErr.openN > 0 && bandErr.coveredN > 0 && mixed.size > 0 && folds(banded.b!) === 0,
    bandErr === undefined ? `refused: ${JSON.stringify(tally(banded.problems))}` : `${JSON.stringify(bandErr)}; mixed vertices ${mixed.size}; folds ${folds(banded.b!)}`);
  // Covers over the band itself: the band keeps its blended field, so the torso's deform is band-depth's, byte for byte.
  const reference = banded.b === undefined ? '' : torsoDeform(banded.b);
  for (const [id, variant] of [['BV03', 'scarf-behind'], ['BV04', 'scarf-front']] as const) {
    const { b, problems } = build(variant);
    say(`${id}_${variant.toUpperCase().replace('-', '_')}_BAND_UNDER_A_COVER_KEEPS_ITS_BLENDED_FIELD`,
      b !== undefined && reference !== '' && torsoDeform(b) === reference && folds(b) === 0,
      b === undefined ? `refused: ${JSON.stringify(tally(problems))}` : `torso deform equals band-depth's: ${torsoDeform(b) === reference}; folds ${folds(b)}`);
  }
  // The back hair over the band and over the coat: the band is declared, so it is not owned and builds.
  const groups = build('band-groups');
  say('BV05_BAND_UNDER_BOTH_GROUPS_KEEPS_ITS_BLENDED_FIELD', groups.b !== undefined && folds(groups.b) === 0,
    groups.b === undefined ? `refused: ${JSON.stringify(tally(groups.problems))}` : `folds ${folds(groups.b)}`);
  // A declaration is intent: the same mixing with no region declared (#806's shape) is still owned, and refused by name.
  for (const [id, variant, code] of [['BV06', 'rim-depth', 'RIG_TURN_SURFACE_OVERLAP_DEPTH'], ['BV07', 'rim-groups', 'RIG_TURN_SURFACE_OVERLAP_GROUPS']] as const) {
    const { b, problems } = build(variant);
    say(`${id}_${variant.toUpperCase().replace('-', '_')}_UNDECLARED_MIX_UNDER_A_COVER_IS_REFUSED`,
      b === undefined && problems.length > 0 && problems.every(p => p.code === code),
      b === undefined ? `refused: ${JSON.stringify(tally(problems))}` : 'built');
  }
  // The Parts-only fold reading (tools/measure_turn_flips.ts): silent on the band build, and it names a planted fold.
  if (banded.b === undefined) { say('BV08_FOLD_READING_IS_SILENT_ON_A_BUILT_BAND', false, 'band-depth refused'); return; }
  const clean = turnKeyFlips(banded.b);
  // The topwear is the one explicit-weight mesh; the five grid parts are generators rigc expands, named as not read.
  say('BV08_FOLD_READING_IS_SILENT_ON_A_BUILT_BAND', clean.flips.length === 0 && clean.unread.length === 5 && clean.unread.every(u => u.endsWith('a grid generator rigc expands')) && !clean.unread.some(u => u.startsWith('topwear/')),
    `${clean.flips.length} fold(s); not read: ${clean.unread.join('; ')}`);
  say('BV09_FOLD_READING_NAMES_A_PLANTED_FOLD', plantedFoldNamed(banded.b), 'triangle 0 of topwear reflected across its far edge at turn key 4 only');
}

/**
 * Reflect triangle 0's first vertex 1.5x across the opposite edge at the
 * topwear's turn key 4, in world units mapped back through each weight's bone,
 * and require the reading to name exactly that triangle at that key.
 */
function plantedFoldNamed(source: RigOutput): boolean {
  const b = structuredClone(source), att = b.rig.skins.default.topwear.topwear as MeshAttachment;
  const timeline = (b.motion.animations.turn as Animation).deform!.find(d => d.slot === 'topwear')!;
  const world = computeWorldTransforms(b.rig.bones), rest = posed(b, [2, 2, 2]);
  const [a, p, q] = att.triangles.slice(0, 3).map(v => [rest[v][0], BAND_OVERLAP.height - rest[v][1]]);
  const ex = q[0] - p[0], ey = q[1] - p[1], t = ((a[0] - p[0]) * ex + (a[1] - p[1]) * ey) / (ex * ex + ey * ey);
  const dx = 3 * (p[0] + t * ex - a[0]), dy = 3 * (p[1] + t * ey - a[1]);
  const size = att.weights.reduce((n, row) => n + 2 * row.length, 0);
  const key = timeline.keys[4], offsets = key.vertices ?? new Array<number>(size).fill(0);
  let at = att.weights.slice(0, att.triangles[0]).reduce((n, row) => n + 2 * row.length, 0);
  for (const w of att.weights[att.triangles[0]]) {
    const m = world.get(w.bone)!, det = m.a * m.d - m.b * m.c;
    offsets[at] += (m.d * dx - m.b * dy) / det; offsets[at + 1] += (-m.c * dx + m.a * dy) / det; at += 2;
  }
  key.vertices = offsets;
  const { flips } = turnKeyFlips(b);
  return flips.length > 0 && flips.every(f => f.animation === 'turn' && f.key === 4 && f.slot === 'topwear') && flips.some(f => f.triangle === 0);
}
