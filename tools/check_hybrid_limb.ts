/** Source-bound hybrid controls; no compiler or renderer in the unit suite. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hybridConfig, writeHybridFixture } from '../fixtures/hybrid_limb.ts';
import { assembleStage } from '../src/build.ts';
import { limbLine, sweepJoints, sweepUnderlay } from '../src/check.ts';
import { loadConfig, parseConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { readParts, serializeParts } from '../src/parts.ts';
import { hashRows, readTree } from '../src/remesh.ts';
import { buildRig, rigJsonText } from '../src/rig.ts';

export function prepareHybrid(dir: string, mode: boolean, width?: number, turns = 0) {
  writeHybridFixture(dir, mode, width, turns);
  const out = join(dir, 'parts'); mkdirSync(out, { recursive: true });
  const a = assembleStage({ source: join(dir, 'painting.png'), full: join(dir, 'full'), head: join(dir, 'head'), config: join(dir, 'config.json'), seam: 'near-white', project: 'core' },
    { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite.png'), errorMap: join(out, 'error.png') }, () => {});
  const cfg = loadConfig(join(dir, 'config.json'));
  const parsed = readParts(join(out, 'parts.json'));
  const images = new Map(a.images.map((p) => [p.record.name, p.image]));
  const r = buildRig(cfg, parsed, images, undefined, 'direct');
  return { a, cfg, parsed, images, r, out };
}
function refusal(fn: () => unknown): string {
  try { fn(); return ''; } catch (e) { if (e instanceof PartsError) return e.message; throw e; }
}
type Say = (name: string, pass: boolean, detail: string) => void;
export function runHybridLimbChecks(dir: string, say: Say): void {
  const a = prepareHybrid(join(dir, 'auto'), true);
  const band = a.parsed.parts.find((p) => p.limb?.band !== undefined);
  const h = band?.limb?.band;
  say('SOURCE_WIDTH', h?.width === 12 && h.upper === 'upper' && h.at.join(',') === '30,30' && h.axis.join(',') === '0,1', JSON.stringify(h));
  const b = prepareHybrid(join(dir, 'explicit'), true, 12);
  say('EXPLICIT_WIDTH_EQUALS_DERIVED', serializeParts(a.parsed) === serializeParts(b.parsed) && rigJsonText(a.r.rig) === rigJsonText(b.r.rig), 'declared 12 equals source run half-width 6 twice');
  say('RIGID_OUTSIDE_BAND', ['proximal', 'distal'].every((n) => !('type' in a.r.rig.skins.default[n][n])) && 'type' in a.r.rig.skins.default.joint_band.joint_band, 'two regions and one generated band mesh');
  const problems: Array<{ code: string; object: string; detail: string }> = [];
  say('TWO_CARRIERS_ONLY', limbLine(a.parsed, { ...a.r.rig }, problems)?.status === 'PASS' && problems.length === 0, JSON.stringify(problems));
  const mutant = structuredClone(a.r.rig);
  const attachment = mutant.skins.default.joint_band.joint_band;
  if (!('weights' in attachment)) throw new Error('hybrid mesh absent');
  attachment.weights = attachment.weights.map((ws) => ws.filter((w) => w.bone === 'upper').map((w) => ({ ...w, weight: 1 })));
  say('ONE_CARRIER_PLANT_REFUSED', limbLine(a.parsed, { ...mutant }, [])?.status === 'FAIL', 'losing lower carrier is not ordinary rigid ownership');
  const j = sweepJoints(a.parsed);
  const under = sweepUnderlay(a.parsed, (n) => a.images.get(n)!, j[0]);
  say('ONE_RANGE_AND_BAND_ART_IN_UNDERLAY', j.length === 1 && under.px > 0 && j[0].part === 'distal', `${j.length} joint; ${under.px} reference pixels`);
  for (const [name, value] of [['ZERO', 0], ['NEGATIVE', -1], ['INFINITE', Infinity]] as const) {
    say(`WIDTH_${name}_REFUSED`, refusal(() => parseConfig(hybridConfig(true, value))).includes('hybrid.width'), String(value));
  }
  say('SPAN_REFUSED', refusal(() => prepareHybrid(join(dir, 'wide'), true, 48)).includes('ASSEMBLE_HYBRID_WIDTH'), 'full width 48 reaches beyond upper span 22');
  const cfg = hybridConfig(true); const limbs = cfg.limbs as { arm: { segments: Array<{ hybrid?: { part: string } }> } };
  limbs.arm.segments[1].hybrid = { part: 'proximal' };
  say('NAME_COLLISION_REFUSED', refusal(() => parseConfig(cfg)).includes('CONFIG_PART_UNIQUE'), 'band cannot replace a region');
  const stale = structuredClone(a.cfg); delete stale.limbs?.arm.segments[1].hybrid;
  say('STALE_DECLARATION_REFUSED', refusal(() => buildRig(stale, a.parsed, a.images, undefined, 'direct')).includes('RIG_HYBRID_SOURCE'), 'assembled band needs matching current declaration');
  const noBand = structuredClone(a.parsed); noBand.parts = noBand.parts.filter((p) => p.limb?.band === undefined);
  writeFileSync(join(dir, 'missing-band.json'), serializeParts(noBand));
  say('MISSING_BAND_REFUSED', refusal(() => readParts(join(dir, 'missing-band.json'))).includes('PARTS_HYBRID_PAIR'), 'a joint cannot reference a missing band');
  const rigid = structuredClone(a.cfg); delete rigid.regions.proximal;
  rigid.meshes.proximal = { grid: 1, r: 1, segments: ['upper'] };
  say('NONREGION_NEIGHBOUR_REFUSED', refusal(() => buildRig(rigid, a.parsed, a.images, undefined, 'direct')).includes('RIG_HYBRID_RIGID'), 'outer pieces must remain rigid regions');
  const foreign = structuredClone(a.r.rig);
  const foreignMesh = foreign.skins.default.joint_band.joint_band;
  if (!('weights' in foreignMesh)) throw new Error('band mesh absent');
  foreignMesh.weights[0].push({ bone: 'root', x: 0, y: 0, weight: 0.1 });
  say('THIRD_CARRIER_REFUSED', limbLine(a.parsed, {...foreign}, [])?.status === 'FAIL', 'an unrelated carrier is not admitted');
  const upperOnly = hybridConfig(true) as Record<string, unknown>;
  const upperLimbs = upperOnly.limbs as { arm: { segments: Array<Record<string, unknown>> } };
  upperLimbs.arm.segments[0].hybrid = {part:'wrong'};
  say('UPPER_SEGMENT_REFUSED', refusal(() => parseConfig(upperOnly)).includes('CONFIG_KEY_KNOWN'), 'band declaration belongs below its joint');
  const cutOption = hybridConfig(true) as Record<string, unknown>;
  (cutOption.limbs as typeof upperLimbs).arm.segments[1].cap_shape = 'disc';
  say('CUT_OPTIONS_REFUSED', refusal(() => parseConfig(cutOption)).includes('CONFIG_HYBRID_CUT'), 'a cap is not an implicit fallback under a band');
  const missingBone = hybridConfig(true) as Record<string, unknown>;
  (missingBone.limbs as typeof upperLimbs).arm.segments[1].bone = 'absent';
  say('UNKNOWN_BONE_REFUSED', refusal(() => parseConfig(missingBone)).includes('CONFIG_NAME_RESOLVES'), 'bone identity is resolved by the actual config loader');
  for (const turns of [1, 2, 3]) {
    const rotated = prepareHybrid(join(dir, `rotated-${turns}`), true, undefined, turns);
    const rb = rotated.parsed.parts.find((p) => p.limb?.band !== undefined);
    say(`ROTATED_${turns}_QUARTERS`, rb?.opaque_px === band?.opaque_px && rb?.limb?.band?.width === h?.width && limbLine(rotated.parsed, {...rotated.r.rig}, [])?.status === 'PASS', 'exactly rotated source and bones retain the measured width, pixel count and two carriers');
  }
  const invalidAssembly = (name: string, edit: (raw: Record<string, unknown>) => void): string => {
    const d = join(dir, name); writeHybridFixture(d);
    const config = join(d, 'config.json'), raw = JSON.parse(readFileSync(config, 'utf8')) as Record<string, unknown>;
    edit(raw); writeFileSync(config, JSON.stringify(raw));
    return refusal(() => assembleStage({source:join(d,'painting.png'),full:join(d,'full'),head:join(d,'head'),config,seam:'near-white',project:'core'},
      {partsJson:join(d,'out/parts.json'),partsDir:join(d,'out/parts'),recomposite:join(d,'out/recomposite.png'),errorMap:join(d,'out/error.png')},()=>{}));
  };
  const offArt = invalidAssembly('off-art', (raw) => {
    for (const b of raw.bones as Array<{at:number[];tip:number[]}>) { b.at[0] = 55; b.tip[0] = 55; }
  });
  say('NO_ART_CROSSING_REFUSED', offArt.includes('ASSEMBLE_LIMB_JOINT_ON_ART'), offArt.split('\n')[0]);
  const overlapping = invalidAssembly('overlap', (raw) => {
    const bones = raw.bones as Array<{name:string;parent:string;at:number[];tip:number[]}>;
    bones[1].tip = [30,42]; bones.push({name:'last',parent:'lower',at:[30,42],tip:[30,56]});
    const limbs = raw.limbs as {arm:{segments:Array<Record<string,unknown>>}};
    limbs.arm.segments.push({part:'last',from:'sleeve',bone:'last',joint:'cuff',hybrid:{part:'cuff_band'}});
    (raw.regions as Record<string,string>).last = 'last';
  });
  say('ADJACENT_BANDS_REFUSED', overlapping.includes('ASSEMBLE_HYBRID_OVERLAP'), overlapping.split('\n')[0]);
  const cut = prepareHybrid(join(dir, 'cut'), false);
  say('ABSENT_HAS_NO_BAND_FIELDS', !serializeParts(cut.parsed).includes('"band"') && !serializeParts(cut.parsed).includes('"hybrid"') && cut.r.meshReport.length === 0, 'historical cut path only');
  const again = prepareHybrid(join(dir, 'again'), true);
  say('DETERMINISTIC_PART_BYTES', JSON.stringify(hashRows(readTree(a.out))) === JSON.stringify(hashRows(readTree(again.out))), 'same paths, byte counts and hashes, no tolerance');
  const before = readTree(a.out), planted = new Map(before);
  const first = [...planted.keys()][0]; const bytes = new Uint8Array(planted.get(first)!); bytes[0] ^= 1; planted.set(first, bytes);
  const equal = (x: typeof before, y: typeof before) => JSON.stringify(hashRows(x)) === JSON.stringify(hashRows(y));
  say('BYTE_IDENTITY_PLANT', !equal(before, planted), first);
  const added = new Map(before); added.set('added', new Uint8Array([0]));
  const deleted = new Map(before); deleted.delete(first);
  say('PATH_IDENTITY_PLANTS', !equal(before, added) && !equal(before, deleted), 'added and removed paths differ');
  // The generated metadata passes through the actual strict reader.
  const damaged = JSON.parse(readFileSync(join(a.out, 'parts.json'), 'utf8')) as { parts: Array<{ limb?: { band?: { width: number } } }> };
  const damagedBand = damaged.parts.find((p) => p.limb?.band)?.limb?.band;
  if (damagedBand === undefined) throw new Error('band record absent');
  damagedBand.width = 0;
  writeFileSync(join(dir, 'bad-parts.json'), JSON.stringify(damaged));
  say('PARTS_WIDTH_REFUSED', refusal(() => readParts(join(dir, 'bad-parts.json'))).includes('PARTS_FIELD_TYPE'), 'invalid recorded width cannot reach rig');
}
if (import.meta.main) {
  const dir = process.argv[2]; if (!dir) throw new Error('output path required');
  mkdirSync(dir, { recursive: true }); let failed = 0;
  runHybridLimbChecks(dir, (name, pass, detail) => { console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`); if (!pass) failed++; });
  process.exitCode = failed ? 1 : 0;
}
