/** A collar band on a torso that other turn parts overlap (#1543, #1548): hand-derived travel, refusals by name. */
import { createHash } from 'node:crypto';
import { BAND_COVER_FIXTURE, BAND_OVERLAP, bandCoverTurnFixture, bandOverlapTurnFixture, type BandOverlapVariant } from '../fixtures/turn_band_overlap.ts';
import { parseConfig } from '../src/config.ts';
import { buildRig, type MeshAttachment, type RigOutput } from '../src/rig.ts';
import { computeWorldTransforms, toWorld } from '../src/coords.ts';
import { extendDepthSilhouette, sampleDepthFloat } from '../src/depthsheets.ts';
import { PartsError, type Problem } from '../src/errors.ts';
import { levelToDepthZ } from '../src/turn.ts';
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
  runBandCoverChecks(say);
}

function buildCover(opts?: Parameters<typeof bandCoverTurnFixture>[0], mutate?: (raw: Record<string, unknown>) => void): { b?: RigOutput; problems: readonly Problem[] } {
  const f = bandCoverTurnFixture(opts);
  mutate?.(f.config);
  try { return { b: buildRig(parseConfig(f.config), f.parts, f.images), problems: [] }; }
  catch (e) { if (e instanceof PartsError) return { problems: e.problems }; throw e; }
}

function runBandCoverChecks(say: Say): void {
  const TOL = 0.00002;
  const { chin, band: width, headCoverDepth, headOwnOvershootDepth, bodyDepth, headPivot, headZRef } = BAND_COVER_FIXTURE;
  const covered = buildCover({ cover: 'face' });
  const uncovered = buildCover();

  // Face mean travel at ±15° from its 5x5 grid over padded [22-4..42+4] x [4-4..28+4], computed from definition.
  const fFix = bandCoverTurnFixture({ cover: 'face' });
  const faceRec = fFix.parts.parts.find(p => p.name === 'face')!;
  const faceExt = extendDepthSilhouette(fFix.images.get(faceRec.depth!.image)!, fFix.images.get('face')!);
  let facePos15 = 0, faceN = 0;
  for (let r = 0; r <= 5; r++) for (let c = 0; c <= 5; c++) {
    const gx = faceRec.x - 4 + (c / 5) * (faceRec.w + 8), gy = faceRec.y - 4 + (r / 5) * (faceRec.h + 8);
    const z = levelToDepthZ(sampleDepthFloat(faceExt, gx - faceRec.x, gy - faceRec.y), faceRec.depth!);
    facePos15 += -(headPivot + z - headZRef) * SIN15;
    faceN++;
  }
  const faceMeanPos = facePos15 / faceN, faceMeanNeg = -faceMeanPos;

  const evalCover = (b: RigOutput, headD: number) => {
    const rest = posed(b, [2, 2, 2]);
    const hPos = posed(b, [4, 2, 2]), hNeg = posed(b, [0, 2, 2]);
    const bPos = posed(b, [2, 2, 4]), bNeg = posed(b, [2, 2, 0]);
    const bothPos = posed(b, [4, 2, 4]), bothNeg = posed(b, [0, 2, 0]);
    let maxErr = 0, bandVertsOutsideFace = 0;
    const bandRows: Array<[number, number, number, number, number, number]> = [];
    const chestRows: Array<[number, number, number, number, number, number]> = [];
    for (const [i, [x, y]] of rest.entries()) {
      const g = Math.min(1, Math.max(0, y <= chin ? 1 : 1 - (y - chin) / width));
      if (g > 0 && y > faceRec.y + faceRec.h - 1) bandVertsOutsideFace++;
      if (x >= 36 && y >= 20 && y <= 46) {
        const wH = -headD * SIN15 * g, wB = -bodyDepth * SIN15 * (1 - g);
        maxErr = Math.max(
          maxErr,
          Math.abs(hPos[i][0] - x - wH),
          Math.abs(hNeg[i][0] - x + wH),
          Math.abs(bPos[i][0] - x - wB),
          Math.abs(bNeg[i][0] - x + wB),
          Math.abs(bothPos[i][0] - x - wH - wB),
          Math.abs(bothNeg[i][0] - x + wH + wB),
        );
      }
      const row: [number, number, number, number, number, number] = [
        hPos[i][0] - x, hNeg[i][0] - x, bPos[i][0] - x, bNeg[i][0] - x, bothPos[i][0] - x, bothNeg[i][0] - x,
      ];
      if (y > chin && y < chin + width) bandRows.push(row);
      else if (y >= 42 && y <= 60) chestRows.push(row);
    }
    const meanAt = (rs: typeof bandRows, k: number) => rs.reduce((s, r) => s + r[k], 0) / rs.length;
    const bandMean = [0, 1, 2, 3, 4, 5].map(k => meanAt(bandRows, k));
    const chestMean = [0, 1, 2, 3, 4, 5].map(k => meanAt(chestRows, k));
    const between = (a: number, m: number, c: number) => (a <= m && m <= c) || (a >= m && m >= c);
    const monotone =
      between(faceMeanPos, bandMean[0], chestMean[0]) &&
      between(faceMeanNeg, bandMean[1], chestMean[1]) &&
      between(0, bandMean[2], chestMean[2]) &&
      between(0, bandMean[3], chestMean[3]) &&
      between(faceMeanPos, bandMean[4], chestMean[4]) &&
      between(faceMeanNeg, bandMean[5], chestMean[5]);
    return { maxErr, monotone, bandVertsOutsideFace, bandMean, chestMean, flips: turnKeyFlips(b).flips.length, gridFolds: folds(b) };
  };

  const covRead = covered.b === undefined ? undefined : evalCover(covered.b, headCoverDepth);
  say(
    'BV10_BAND_COVER_READS_COVER_SHEET_AT_REGION_BONE_AND_TURNS_MONOTONICALLY',
    covRead !== undefined && covRead.maxErr < TOL && covRead.monotone && covRead.bandVertsOutsideFace > 0 && covRead.flips === 0 && covRead.gridFolds === 0,
    covRead === undefined
      ? `refused: ${JSON.stringify(tally(covered.problems))}`
      : `maxErr=${covRead.maxErr.toExponential(2)}, monotone=${covRead.monotone}, outsideFace=${covRead.bandVertsOutsideFace}, face=[${faceMeanPos.toFixed(2)}, 0, ${faceMeanPos.toFixed(2)}], band=[${covRead.bandMean[0].toFixed(2)}, ${covRead.bandMean[2].toFixed(2)}, ${covRead.bandMean[4].toFixed(2)}], chest=[${covRead.chestMean[0].toFixed(2)}, ${covRead.chestMean[2].toFixed(2)}, ${covRead.chestMean[4].toFixed(2)}], folds=${covRead.gridFolds}`,
  );

  // Planted defect: without `cover`, the band reads topwear's own sheet (depth 46 vs face 16..18 and chest 24) and overshoots both.
  const uncovRead = uncovered.b === undefined ? undefined : evalCover(uncovered.b, headOwnOvershootDepth);
  say(
    'BV11_ABSENT_BAND_COVER_REPRODUCES_TORSO_SHEET_OVERSHOOT',
    uncovRead !== undefined && uncovRead.maxErr < TOL && !uncovRead.monotone && uncovRead.bandMean[0] < faceMeanPos && uncovRead.bandMean[4] < uncovRead.chestMean[4],
    uncovRead === undefined
      ? `refused: ${JSON.stringify(tally(uncovered.problems))}`
      : `maxErr=${uncovRead.maxErr.toExponential(2)}, monotone=${uncovRead.monotone}, band+15=[head ${uncovRead.bandMean[0].toFixed(2)} vs face ${faceMeanPos.toFixed(2)}, both ${uncovRead.bandMean[4].toFixed(2)} vs chest ${uncovRead.chestMean[4].toFixed(2)}]`,
  );

  // Absent cover moves no byte: omitting `cover` and `cover: undefined` serialize identically.
  const fOmit = bandCoverTurnFixture(), fUndef = bandCoverTurnFixture({ cover: undefined });
  const outOmit = JSON.stringify(buildRig(parseConfig(fOmit.config), fOmit.parts, fOmit.images));
  const outUndef = JSON.stringify(buildRig(parseConfig(fUndef.config), fUndef.parts, fUndef.images));
  say('BV12_ABSENT_BAND_COVER_MOVES_NO_BYTE', outOmit === outUndef && outOmit.length > 0, `serialized length ${outOmit.length}, equal=${outOmit === outUndef}`);

  // Planted CONFIG_TURN_BAND_COVER refusals: unknown part, wrong-group surface, unit role, missing depth sheet, own-group bone, non-surface target.
  const rUnknown = buildCover({ cover: 'missing_part' });
  const rWrongGroup = buildCover({ cover: 'coat' });
  const rUnitRole = buildCover({ cover: 'eyewhite_r' });
  const rNoSheet = buildCover({ cover: 'face', omitFaceDepth: true });
  const rSameGroup = buildCover({ cover: 'face', regionBone: 'torso' });
  const rNoTurnSurface = buildCover({ cover: 'face' }, raw => { raw.turn = { pivot: 16, roles: { face: 'surface' } }; });
  const coverRefusals = [
    ['unknown', rUnknown, 'missing_part'],
    ['wrong-group', rWrongGroup, 'coat'],
    ['unit-role', rUnitRole, 'eyewhite_r'],
    ['no-sheet', rNoSheet, 'carries no depth sheet'],
    ['same-group', rSameGroup, 'torso'],
    ['non-surface-target', rNoTurnSurface, 'topwear'],
  ] as const;
  say(
    'BV13_BAND_COVER_REFUSES_INVALID_PART_ROLE_SHEET_AND_GROUP_BY_NAME',
    coverRefusals.every(([, r, needle]) => r.b === undefined && r.problems.some(p => p.code === 'CONFIG_TURN_BAND_COVER' && p.detail.includes(needle))),
    coverRefusals.map(([k, r]) => `${k}:${r.problems.map(p => p.code).join('+') || 'built'}`).join(', '),
  );

  // Planted RIG_TURN_BAND_COVER_SUPPORT refusals: bone outside cover rect, and bone on semi-transparent jaw edge (alpha 211 < 255).
  const rOutside = buildCover({ cover: 'face', collarAt: [32, 30] });
  const rSemi = buildCover({ cover: 'face', collarAt: [32, 27], jawEdgeAlpha: 211 });
  const outProb = rOutside.problems.find(p => p.code === 'RIG_TURN_BAND_COVER_SUPPORT');
  const semiProb = rSemi.problems.find(p => p.code === 'RIG_TURN_BAND_COVER_SUPPORT');
  say(
    'BV14_BAND_COVER_REFUSES_OUTSIDE_OR_NON_OPAQUE_REGION_BONE_SUPPORT',
    rOutside.b === undefined &&
      rSemi.b === undefined &&
      outProb !== undefined &&
      outProb.detail.includes('"collar"') &&
      outProb.detail.includes('[32, 30]') &&
      outProb.detail.includes('alpha 0') &&
      semiProb !== undefined &&
      semiProb.detail.includes('"collar"') &&
      semiProb.detail.includes('[32, 27]') &&
      semiProb.detail.includes('alpha 211'),
    `outside=${outProb?.detail ?? 'none'} | semi=${semiProb?.detail ?? 'none'}`,
  );

  runBandCoverBindingChecks(say, covered.b, uncovered.b);
}

function collarChain(raw: Record<string, unknown>): void {
  const bones = raw.bones as Array<{ name: string }>;
  raw.bones = [
    ...bones.filter(b => b.name !== 'collar'),
    { chain: 'collar', parent: 'head', points: [[32, 26]], tip: [32, 34] },
  ];
  // Use weighted surfaces so applyStops sees named bindings on both neighbours.
  raw.regions = { eyewhite_r: 'eye_r', eyewhite_l: 'eye_l' };
  Object.assign(raw.meshes!, {
    face: { grid: 4, r: 20, segments: [['head', [32, 28], [32, 4]]] },
    coat: { grid: 4, r: 20, segments: [['torso', [32, 90], [32, 44]]] },
  });
}

function runBandCoverBindingChecks(say: Say, covered?: RigOutput, uncovered?: RigOutput): void {
  const stopCollar = (raw: Record<string, unknown>) => {
    collarChain(raw);
    raw.stops = [{ chain: 'collar', against: 'head', at: [4, 0], inward: -30, outward: 30 }];
  };
  const sha = (b?: RigOutput) => b === undefined ? 'refused' : createHash('sha256').update(JSON.stringify(b)).digest('hex');
  const coverRefusal = (result: ReturnType<typeof buildCover>, code: string, index: number, ...detail: string[]) => {
    const [problem] = result.problems;
    return result.b === undefined && result.problems.length === 1 && problem.code === code
      && problem.object === `config.meshes.topwear.contour.regions[${index}].cover`
      && detail.every(s => problem.detail.includes(s));
  };

  const stoppedCover = buildCover({ cover: 'face', regionBone: 'collar0' }, stopCollar);
  say('BV15_BAND_COVER_REFUSES_DECLARED_STOPPED_LINK',
    coverRefusal(stoppedCover, 'CONFIG_TURN_BAND_COVER', 0, 'region "collar"', 'cover "face"', 'stopped link "collar0"', '"collar0_d"'),
    stoppedCover.problems.map(p => p.detail).join(' | ') || 'built');

  // SHA-256 of the whole serialized buildRig result on the pre-#1559 tree.
  const stoppedAbsent = buildCover({ regionBone: 'collar0' }, stopCollar);
  const stoppedSha = sha(stoppedAbsent.b);
  const att = stoppedAbsent.b?.rig.skins.default.topwear.topwear;
  const drawn = att !== undefined && 'type' in att && att.weights.some(row => row.some(w => w.bone === 'collar0_d' && w.weight > 0));
  say('BV16_STOPPED_BAND_WITHOUT_COVER_KEEPS_BUILD_BYTES',
    drawn && stoppedSha === 'de8a697815569131f9e43335562bc4c42aa9ed68c580ac6923d5eb67c6a7142a',
    `positive collar0_d influence=${drawn}; build sha256=${stoppedSha}`);

  const chainCover = buildCover({ cover: 'face', regionBone: 'collar0' }, collarChain);
  const chainSha = sha(chainCover.b), coveredSha = sha(covered), uncoveredSha = sha(uncovered);
  say('BV17_UNSTOPPED_BANDS_KEEP_BUILD_BYTES',
    chainSha === '257486a84c1a7e31f7014fc6c623aed72567b572cf29a183276d126ab9d115af'
      && coveredSha === 'a7211212d83a03ed6e024e6ddf12f084c1a323f8af4668ae7ba58e3a3df38634'
      && uncoveredSha === 'daf0e125f47831fd59f389fb31b2572ea58798f09d4ab4678bb5bb515e0be09b',
    `build sha256 chain=${chainSha}, covered=${coveredSha}, absent=${uncoveredSha}`);

  const outside = buildCover({ cover: 'face' }, raw => {
    // The active collar shares its bone and cover with the second region.
    // A bone-level check sees its positive weights and would miss the off-mesh region.
    const { regions } = (raw.meshes as { topwear: { contour: { regions: Array<Record<string, unknown>> } } }).topwear.contour;
    regions.push({ ...regions[0], name: 'off_mesh', points: [[0, 0], [4, 0], [4, 4], [0, 4]] });
    (raw.turn as { roles: Record<string, string> }).roles.topwear = 'surface';
  });
  say('BV18_BAND_COVER_REFUSES_REGION_WITH_ZERO_POSITIVE_INFLUENCES',
    coverRefusal(outside, 'RIG_TURN_BAND_COVER_SUPPORT', 1, 'region "off_mesh"', 'bone "collar"', 'no mesh vertex', 'cover "face"'),
    outside.problems.map(p => p.detail).join(' | ') || 'built');

  const noBlend = buildCover({ cover: 'face' }, raw => {
    (raw.meshes as { topwear: { segments: unknown[] } }).topwear.segments = [['collar', [32, 26], [32, 34]]];
  });
  say('BV19_BAND_COVER_REFUSES_OTHER_GROUP_WITHOUT_BLENDED_ATTACHMENT',
    coverRefusal(noBlend, 'RIG_TURN_BAND_COVER_SUPPORT', 0, 'region "collar"', 'cover "face"', 'no attachment', 'other-group deform'),
    noBlend.problems.map(p => p.detail).join(' | ') || 'built');
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
