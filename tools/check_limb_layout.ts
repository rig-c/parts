/** Public generated controls for explicit producer layout; no pose-consumer claim. */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeLimbSlotFixture } from '../fixtures/limb_slots.ts';
import { syntheticPolicy } from '../fixtures/automesh.ts';
import { withPolicyMotion } from '../fixtures/automotion.ts';
import { rigConfig } from '../fixtures/rig.ts';
import { assembleStage, gateThroughRigc, rigOutputTexts, rigStage } from '../src/build.ts';
import type { RigcRunner } from '../src/check.ts';
import { loadConfig, parseConfig, parseEarlyConfig, type CharacterConfig, type Limb } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { coalesceLimbSlots } from '../src/limbslots.ts';
import { layoutAlias, layoutCompanion, placeLimbLayouts, refreshLimbLayout, validateLimbLayout, LAYOUT_FILE } from '../src/limblayout.ts';
import { readParts, writeParts } from '../src/parts.ts';
import { encodePngBytes, readPng } from '../src/raster/png.ts';
import type { Raster } from '../src/raster/types.ts';
import { buildRig, rigJsonText, type MeshAttachment, type RigOutput, type RigSpec } from '../src/rig.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const save = (path: string, value: unknown): void => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const hash = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex');
const order = (r: RigSpec): string[] => r.slots.map((s) => s.name);
function refused(run: () => unknown): string {
  try { run(); return ''; } catch (e) { if (e instanceof PartsError) return e.message; throw e; }
}
function bytes(r: RigOutput): unknown { return { ...r, images: r.images.map(([n, x]) => [n, x.width, x.height, [...x.data]]) }; }
function files(dir: string): Array<[string, string]> {
  const result: Array<[string, string]> = [];
  const visit = (at: string): void => { for (const e of readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) { const p = join(at, e.name); if (e.isDirectory()) visit(p); else result.push([p.slice(dir.length + 1), hash(readFileSync(p))]); } };
  if (existsSync(dir)) visit(dir);
  return result;
}

/** Arbitrary names and explicit segment identities; the pure matrix is not a core rig fixture. */
function matrix() {
  const limbs: Record<string, Limb> = {
    unit: { segments: [{ part: 'a0', from: 'source', bone: 'x0' }, { part: 'a1', from: 'source', bone: 'x1', joint: 'j1' }, { part: 'a2', from: 'source', bone: 'x2', joint: 'j2' }] },
    other: { segments: [{ part: 'b0', from: 'source', bone: 'y0' }, { part: 'b1', from: 'source', bone: 'y1', joint: 'k1' }] },
  };
  const bones: RigSpec['bones'] = [{ name: 'root', x: 0, y: 0 }, ...[['x0', 'root'], ['x1', 'x0'], ['x2', 'x1'], ['leaf', 'x1'], ['y0', 'root'], ['y1', 'y0']].map(([name, parent]) => ({ name, parent, x: 0, y: 0 }))];
  const pairs = [['a0', 'x0'], ['a1', 'x1'], ['a2', 'x2'], ['b0', 'y0'], ['b1', 'y1'], ['panel', 'root'], ['lower', 'leaf'], ['upper', 'x0'], ['span', 'x0'], ['mixed', 'x1'], ['switch', 'x1']];
  const slots = pairs.map(([name, bone]) => ({ name, bone, attachment: name }));
  const skin: RigSpec['skins']['default'] = Object.fromEntries(pairs.map(([n]) => [n, { [n]: { image: 'block.png', x: 0, y: 0 } }]));
  const mesh = (...bs: string[]): MeshAttachment => ({ type: 'mesh', image: 'block.png', width: 1, height: 1, hull: 0, uvs: [], triangles: [], weights: [bs.map((bone) => ({ bone, x: 0, y: 0, weight: 1 / bs.length }))] });
  skin.span = { span: mesh('x0', 'x1') }; skin.mixed = { mixed: mesh('x1', 'y1') }; skin.switch.alt = mesh('y1');
  const families = new Map(pairs.map(([n]) => [n, [n]]));
  const base = coalesceLimbSlots(limbs, bones, slots, skin);
  const place = () => placeLimbLayouts(limbs, bones, base, skin, families);
  return { limbs, bones, skin, slots, families, base, place, mesh };
}

function matrixChecks(say: Say): void {
  const m = matrix();
  say('UNDECLARED_REFERENCE_IDENTITY', m.place().slots === m.base.slots && m.place().plan === undefined, '646 permutation reference, no plan');
  m.limbs.unit.layout = { before: { part: 'panel' } };
  const whole = m.place();
  say('WHOLE_BEFORE_WITH_INHERITED_CLOSURE', equal(whole.slots.map((s) => s.name), ['b0', 'b1', 'a0', 'a1', 'a2', 'lower', 'upper', 'span', 'panel', 'mixed', 'switch']), JSON.stringify(whole.plan?.placements));
  m.limbs.unit.layout = { parts: ['a1'], after: { part: 'panel' } };
  const partial = m.place();
  say('PARTIAL_AFTER_WITH_LOWER_RIDER_ONLY', equal(partial.slots.map((s) => s.name), ['a0', 'a2', 'upper', 'span', 'b0', 'b1', 'panel', 'a1', 'lower', 'mixed', 'switch']), JSON.stringify(partial.plan?.placements));
  say('WHOLE_SCOPE_MUTANT_DIFFERS', !equal(partial.slots, whole.slots), 'dragging upper segment/riders is detected');
  m.limbs.unit.layout = { after: { limb: 'other' } };
  const pair = m.place();
  say('WHOLE_LIMB_PAIR_ADJACENT', pair.slots.findIndex((s) => s.name === 'b1') + 1 === pair.slots.findIndex((s) => s.name === 'a0'), JSON.stringify(pair.plan?.placements));
  m.limbs.unit.layout = { parts: ['a1'], after: { part: 'panel' } };
  const altered = structuredClone(m.skin); altered.a1 = { a1: m.mesh('x1', 'y1') };
  const badMember = refused(() => placeLimbLayouts(m.limbs, m.bones, m.base, altered, m.families));
  say('NONEXCLUSIVE_MEMBER_REFUSED', badMember.includes('RIG_LAYOUT_NONEXCLUSIVE') && badMember.includes('a1'), badMember);
  const zero = structuredClone(altered); (zero.a1.a1 as MeshAttachment).weights[0][1].weight = 0;
  say('LISTED_ZERO_FOREIGN_REFERENCE_REFUSED', refused(() => placeLimbLayouts(m.limbs, m.bones, m.base, zero, m.families)).includes('RIG_LAYOUT_NONEXCLUSIVE'), 'all listed references, including zero, use the existing conservative ownership contract');
  m.limbs.unit.layout = { before: { part: 'switch' } };
  const badTarget = refused(m.place);
  say('ALTERNATE_MIXED_TARGET_REFUSED', badTarget.includes('RIG_LAYOUT_NONEXCLUSIVE') && badTarget.includes('switch'), badTarget);
  m.limbs.unit.layout = { before: { limb: 'other' } }; m.limbs.other.layout = { after: { part: 'panel' } };
  const conflict = refused(m.place);
  say('CHAINED_PAIR_PART_CONFLICT', conflict.includes('RIG_LAYOUT_CONFLICT') && conflict.includes('config.limbs.unit.layout') && conflict.includes('config.limbs.other.layout'), conflict);
  m.limbs.other.layout = { after: { limb: 'unit' } };
  say('RECIPROCAL_REFUSED', refused(m.place).includes('RIG_LAYOUT_CONFLICT'), refused(m.place));
  delete m.limbs.other.layout; m.limbs.unit.layout = { before: { limb: 'unit' } };
  say('SELF_REFUSED', refused(m.place).includes('RIG_LAYOUT_CONFLICT'), refused(m.place));
  m.limbs.unit.layout = { before: { part: 'absent' } };
  say('UNREPRESENTABLE_REFUSED', refused(m.place).includes('RIG_LAYOUT_UNREPRESENTABLE'), refused(m.place));
  m.limbs.unit.layout = { parts: ['a1'], after: { part: 'panel' } };
  const r = m.place(); if (!r.plan) throw new Error('GENERATED_LAYOUT_PLAN_REQUIRED');
  const rig: RigSpec = { spec: 'rigc-rig/1', name: 'matrix', images: 'images', skeleton: { x: 0, y: 0, width: 1, height: 1 }, bones: m.bones, slots: r.slots, skins: { default: structuredClone(m.skin) } };
  rig.skins.default.span = { span: m.mesh('x1') };
  const refreshed = refreshLimbLayout(r.plan, rig);
  say('REPLAY_RECOMPUTES_NEW_EXCLUSIVE_RIDER', refreshed.placements[0].slots.includes('span'), JSON.stringify(refreshed.placements));
  rig.skins.default.a1 = { a1: m.mesh('y1') };
  say('REPLAY_FOREIGN_BINDING_REFUSED', refused(() => validateLimbLayout(refreshed, rig)).includes('RIG_LAYOUT_NONEXCLUSIVE'), 'no stale membership after accepted-candidate replacement');
  rig.skins.default.a1 = { a1: m.mesh('emitted_alias') }; layoutAlias(refreshed, 'x1', 'emitted_alias');
  say('EXPLICIT_ALIAS_PROVENANCE', refused(() => validateLimbLayout(refreshed, rig)) === '', 'generated aliases use an actual original/emitted pair, never suffix parsing');
  const text = rigJsonText(rig), companion = layoutCompanion(refreshed, rig, text);
  say('COMPANION_EXACT_HASH_AND_NO_CORE_FIELD', companion.rig.sha256 === hash(text) && companion.sets === undefined && !Object.hasOwn(rig, 'layout') && equal(companion.setup_slots, order(rig)), JSON.stringify(companion));
  say('STALE_RIG_TEXT_REFUSED', refused(() => layoutCompanion(refreshed, rig, rigJsonText({ ...rig, name: 'stale' }))).includes('RIG_LAYOUT_UNREPRESENTABLE'), 'final source object must match final accepted text');
  // Two disjoint declarations: the lower source scope is independent of the other limb/panel pair.
  const d = matrix(); d.limbs.unit.layout = { parts: ['a1'], after: { part: 'a0' } }; d.limbs.other.layout = { before: { part: 'panel' } };
  const first = d.place(); const reverse = placeLimbLayouts({ other: d.limbs.other, unit: d.limbs.unit }, d.bones, d.base, d.skin, d.families);
  say('DISJOINT_DECLARATION_ORDER_DETERMINISM', equal(first.slots, reverse.slots) && equal(first.plan?.placements, reverse.plan?.placements), JSON.stringify(first.plan?.placements));
  const f = matrix(); f.slots.splice(6, 0, { name: 'top_piece', bone: 'root', attachment: 'top_piece' }); f.skin.top_piece = { top_piece: { image: 'block.png', x: 0, y: 0 } }; f.families.set('panel', ['panel', 'top_piece']); f.limbs.unit.layout = { after: { part: 'panel' } };
  const family = placeLimbLayouts(f.limbs, f.bones, coalesceLimbSlots(f.limbs, f.bones, f.slots, f.skin), f.skin, f.families);
  say('GENERATED_TARGET_FAMILY_NO_SUFFIX', equal(family.plan?.placements[0].target_slots, ['panel', 'top_piece']), JSON.stringify(family.plan?.placements));
}

export function runLimbLayoutChecks(dir: string, say: Say, runner: RigcRunner, frozenBuilder?: typeof buildRig): void {
  mkdirSync(dir, { recursive: true }); matrixChecks(say);
  const home = join(dir, 'generated'); writeLimbSlotFixture(home, false, true);
  const path = join(home, 'config.json'), raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const mutate = (layout: unknown): Record<string, unknown> => { const c = structuredClone(raw); (c.limbs as Record<string, Record<string, unknown>>).branchB.layout = layout; return c; };
  const valid = mutate({ parts: ['tileB1'], after: { part: 'tileD' } });
  say('FULL_AND_EARLY_CONFIG_POSITIVE', refused(() => parseConfig(valid)) === '' && refused(() => parseEarlyConfig(valid, 'assemble')) === '', 'both config doors accept explicit source segment and produced target');
  for (const [name, layout, code] of [
    ['BOTH_SIDES', { before: { part: 'tileD' }, after: { limb: 'branchC' } }, 'CONFIG_LAYOUT_TARGET'],
    ['NO_SIDE', {}, 'CONFIG_LAYOUT_TARGET'],
    ['BOTH_TARGET_KINDS', { before: { limb: 'branchC', part: 'tileD' } }, 'CONFIG_LAYOUT_TARGET'],
    ['UNKNOWN_LIMB', { before: { limb: 'missing_limb' } }, 'CONFIG_LAYOUT_NAME'],
    ['PROTOTYPE_IS_NOT_A_LIMB', { before: { limb: 'toString' } }, 'CONFIG_LAYOUT_NAME'],
    ['UNKNOWN_PART', { before: { part: 'missing_part' } }, 'CONFIG_LAYOUT_NAME'],
    ['CONSUMED_PART', { before: { part: 'sourceB' } }, 'CONFIG_LAYOUT_NAME'],
    ['RIDER_NOT_SELECTOR', { parts: ['tileE'], before: { part: 'tileD' } }, 'CONFIG_LAYOUT_SCOPE'],
    ['FOREIGN_SEGMENT', { parts: ['tileC1'], before: { part: 'tileD' } }, 'CONFIG_LAYOUT_SCOPE'],
    ['NONCONSECUTIVE', { parts: ['tileB0', 'leafB'], before: { part: 'tileD' } }, 'CONFIG_LAYOUT_SCOPE'],
    ['DUPLICATE', { parts: ['tileB1', 'tileB1'], before: { part: 'tileD' } }, 'CONFIG_LAYOUT_SCOPE'],
  ] as const) {
    const c = mutate(layout), full = refused(() => parseConfig(c)), early = refused(() => parseEarlyConfig(c, 'assemble'));
    say(`CONFIG_${name}_REFUSED`, full.includes(code) && early.includes(code) && full.includes('config.limbs.branchB.layout'), `${full} | early ${early}`);
  }
  const assemble = (dest: string) => assembleStage({ source: join(home, 'painting.png'), full: join(home, 'full'), head: join(home, 'head'), config: path, project: 'core', seam: 'near-white' }, { partsJson: join(dest, 'parts.json'), partsDir: join(dest, 'parts'), recomposite: join(dest, 'recomposite.png'), errorMap: join(dest, 'error.png') }, () => {});
  const assembled = join(home, 'assembled'); assemble(assembled); const assembledBytes = files(assembled);
  save(path, valid); const again = join(home, 'declared-assembled'); assemble(again);
  say('DECLARATION_PRESERVES_ALL_ASSEMBLE_BYTES', equal(assembledBytes, files(again)), 'parts.json, source PNGs and both recomposites stay in authored order');
  const parts = readParts(join(assembled, 'parts.json')), images = new Map(parts.parts.map((p) => [p.name, readPng(join(assembled, 'parts', `${p.name}.png`))]));
  const cfg = parseConfig(valid), original = buildRig(parseConfig(raw), parts, images), selected = buildRig(cfg, parts, images);
  say('ACTUAL_BUILDER_PARTIAL_SCOPE', selected.layout?.placements[0].slots.includes('tileB1') === true && !selected.layout.placements[0].slots.includes('tileB0') && !equal(order(selected.rig), order(original.rig)), JSON.stringify(selected.layout?.placements));
  if (frozenBuilder !== undefined) say('NO_LAYOUT_FROZEN_646_ALL_BUILDER_BYTES', equal(bytes(original), bytes(frozenBuilder(parseConfig(raw), parts, images))), 'independent frozen 646 source, every builder field and image byte');
  const inheritedCfg = structuredClone(cfg); inheritedCfg.regions.tileE = 'branchB1';
  const altParts = structuredClone(parts), patch = parts.parts.find((p) => p.name === 'tileE');
  if (!patch || !parts.recomposite) throw new Error('GENERATED_PATCH_REQUIRED');
  altParts.alternates = [{ name: 'alternate', slots: { tileE: 'alternate_tileE' }, records: [structuredClone(patch)], ghost_px: {}, recomposite: parts.recomposite }];
  const altImages = new Map(images); altImages.set('alternate_tileE', images.get('tileE') as Raster);
  const alt = buildRig(inheritedCfg, altParts, altImages);
  say('INHERITED_RIDER_AND_ALTERNATE_CLOSURE', alt.layout?.placements[0].slots.includes('tileE') === true && alt.sets?.sets.alternate.slots.tileE === 'alternate_tileE', JSON.stringify(alt.layout?.placements));
  const reboundCfg = structuredClone(inheritedCfg);
  reboundCfg.constraints = [{ type: 'physics', name: 'held_branch', bone: 'branchB0', rotate: 1 }];
  // This fixture's core-measured rest is 135 degrees: outward 45 reaches 180.
  reboundCfg.stops = [{ chain: 'branchB', links: ['branchB0'], against: 'junction', at: [0, 0], inward: 0, outward: 45 }];
  reboundCfg.turn = { pivot: 0.8, depths: Object.fromEntries(parts.parts.map((p) => [p.name, p.name === 'tileD' ? 0.8 : 0.2])) };
  const rebound = buildRig(reboundCfg, altParts, altImages), reboundTexts = rigOutputTexts(rebound, null);
  const reboundCompanion = layoutCompanion(rebound.layout!, rebound.rig, reboundTexts[0][1], reboundTexts.find(([n]) => n === 'sets.json')?.[1]);
  say('STOPS_TURN_FINAL_RIG_AND_SETS_HASH', rebound.rig.stops?.length === 1 && rebound.turn !== null && reboundCompanion.sets?.sha256 === hash(reboundTexts.find(([n]) => n === 'sets.json')![1]), JSON.stringify(reboundCompanion));
  const splitCfg = structuredClone(cfg), splitImages = new Map(altImages), split = structuredClone(images.get('tileE') as Raster); split.data.fill(0, 2 * split.width * 4, 3 * split.width * 4); splitImages.set('tileE', split);
  // The region blinks on leafB; its still piece independently binds branchB1.
  // Both declared consecutive segments are selected, while tileB0 stays out.
  if (splitCfg.limbs) splitCfg.limbs.branchB.layout = { parts: ['tileB1', 'leafB'], after: { part: 'tileD' } };
  splitCfg.motion.duration = 4; splitCfg.motion.blink = { t: 1, eyes: ['leafB'], brows: ['junction'], squash: 0.12, brow_drop: 1, still: { tileE: { row: patch.y + 2, bone: 'branchB1' } } };
  const stillPath = join(home, 'still-config.json'); save(stillPath, splitCfg);
  const splitLoaded = loadConfig(stillPath), splitBuilt = buildRig(splitLoaded, parts, splitImages);
  say('ACTUAL_STILL_INHERITS_SELECTED_SOURCE', splitLoaded.regions.tileE === 'leafB' && splitLoaded.motion.blink?.still?.tileE.bone === 'branchB1' && splitBuilt.layout?.placements[0].slots.includes('tileE_still') === true && splitBuilt.layout.placements[0].slots.includes('tileE') && !splitBuilt.layout.placements[0].slots.includes('tileB0'), JSON.stringify({ loaded: true, placements: splitBuilt.layout?.placements }));
  const foreignStillCfg = structuredClone(splitCfg); foreignStillCfg.motion.blink!.still!.tileE.bone = 'branchC1';
  const foreignStillPath = join(home, 'foreign-still-config.json'); save(foreignStillPath, foreignStillCfg);
  const foreignStill = buildRig(loadConfig(foreignStillPath), parts, splitImages), foreignTexts = rigOutputTexts(foreignStill, null);
  const foreignGate = gateThroughRigc(foreignStill.images.map(([n, r]) => [n, encodePngBytes(r)] as const), foreignTexts, runner, join(home, 'foreign-still-core-gate'), null);
  say('FOREIGN_STILL_NOT_FORCED_WITH_ITS_SOURCE_PART', foreignGate.every((g) => g.status === 0) && foreignStill.layout?.placements[0].slots.includes('tileE') === true && !foreignStill.layout.placements[0].slots.includes('tileE_still'), JSON.stringify({ loaded: true, gates: foreignGate.map((g) => g.status), placements: foreignStill.layout?.placements }));
  for (const [label, candidate] of [['rebind', rebound], ['still', splitBuilt]] as const) {
    const candidateTexts = rigOutputTexts(candidate, null);
    const gates = gateThroughRigc(candidate.images.map(([n, r]) => [n, encodePngBytes(r)] as const), candidateTexts, runner, join(home, label + '-core-gate'), null);
    say(`${label.toUpperCase()}_ACTUAL_CORE_GATE`, gates.every((g) => g.status === 0), JSON.stringify(gates.map((g) => ({ status: g.status, lines: g.lines }))));
  }
  const out = join(home, 'rig'), scratch = join(home, 'scratch');
  const noLayoutCfg = structuredClone(raw); save(path, noLayoutCfg);
  const stageArgs = { config: path, parts: assembled, out };
  const stageLogs: string[] = []; rigStage(stageArgs, runner, scratch, (l) => stageLogs.push(l)); const noLayoutFiles = files(out);
  save(path, valid); const staged = rigStage(stageArgs, runner, scratch, () => {});
  const emitted = JSON.parse(readFileSync(join(out, LAYOUT_FILE), 'utf8')) as { rig: { sha256: string }; setup_slots: string[] };
  say('ACTUAL_CORE_GATED_COMPANION', emitted.rig.sha256 === hash(readFileSync(join(out, 'rig.json'))) && equal(emitted.setup_slots, order(staged.rig)) && !Object.hasOwn(JSON.parse(readFileSync(join(out, 'rig.json'), 'utf8')), 'layout'), JSON.stringify(emitted));
  // The exact serializer used on the settled replay path gates a changed final candidate.
  const replayed: RigOutput = { ...alt, rig: structuredClone(alt.rig) };
  const attachment = replayed.rig.skins.default.tileE.tileE;
  if ('type' in attachment) throw new Error('GENERATED_REGION_REQUIRED'); attachment.x += 0.125;
  const finalTexts = rigOutputTexts(replayed, null), pngs = replayed.images.map(([n, r]) => [n, encodePngBytes(r)] as const);
  const replayGate = gateThroughRigc(pngs, finalTexts, runner, join(home, 'replay-gate'), null);
  const after = layoutCompanion(replayed.layout!, replayed.rig, finalTexts[0][1], finalTexts.find(([n]) => n === 'sets.json')?.[1]);
  const beforeTexts = rigOutputTexts(alt, null);
  say('REPLAY_BOUNDARY_GATES_FINAL_ACCEPTED_BYTES', replayGate.every((g) => g.status === 0) && after.rig.sha256 === hash(finalTexts[0][1]) && after.rig.sha256 !== hash(beforeTexts[0][1]), JSON.stringify({ gates: replayGate.map((g) => g.status), companion: after }));
  say('REPLAY_INITIAL_TEXT_MUTANT_REFUSED', refused(() => layoutCompanion(replayed.layout!, replayed.rig, beforeTexts[0][1])).includes('RIG_LAYOUT_UNREPRESENTABLE'), 'initial candidate text cannot label the gated replacement');
  writeParts(join(assembled, 'parts.json'), altParts); writeFileSync(join(assembled, 'parts', 'alternate_tileE.png'), encodePngBytes(altImages.get('alternate_tileE') as Raster)); save(path, inheritedCfg);
  rigStage(stageArgs, runner, scratch, () => {});
  const withSets = JSON.parse(readFileSync(join(out, LAYOUT_FILE), 'utf8')) as { sets?: { sha256: string } };
  say('ACTUAL_EMITTED_SETS_HASH', withSets.sets?.sha256 === hash(readFileSync(join(out, 'sets.json'))), JSON.stringify(withSets));
  const beforeRed = files(out); let gateCalls = 0;
  const red = refused(() => rigStage(stageArgs, () => { gateCalls++; return { status: 1, out: 'PLANTED_GATE_RED' }; }, scratch, () => {}));
  say('RED_GATE_PRESERVES_ALL_OWNED_FILES', gateCalls === 1 && red.includes('RIG_RIGC_GREEN') && equal(beforeRed, files(out)), red);
  const invalidConfig = mutate({ before: { limb: 'missing_limb' } }); save(path, invalidConfig); let earlyCalls = 0;
  const earlyRed = refused(() => rigStage(stageArgs, () => { earlyCalls++; return { status: 0, out: '' }; }, scratch, () => {}));
  say('UNKNOWN_REFERENCE_BEFORE_GATE_OR_EMIT', earlyCalls === 0 && earlyRed.includes('CONFIG_LAYOUT_NAME') && equal(beforeRed, files(out)), earlyRed);
  const conflictingConfig = mutate({ before: { limb: 'branchC' } }); (conflictingConfig.limbs as Record<string, Record<string, unknown>>).branchC.layout = { after: { part: 'tileD' } }; save(path, conflictingConfig);
  const conflictRed = refused(() => rigStage(stageArgs, () => { earlyCalls++; return { status: 0, out: '' }; }, scratch, () => {}));
  say('CONFLICT_BEFORE_GATE_OR_EMIT', earlyCalls === 0 && conflictRed.includes('RIG_LAYOUT_CONFLICT') && equal(beforeRed, files(out)), conflictRed);
  writeParts(join(assembled, 'parts.json'), parts); save(path, raw);
  // sets.json is an existing independent output; use the original no-layout directory census for its existing fields.
  const cleanOut = join(home, 'clean-rig'); rigStage({ ...stageArgs, out: cleanOut }, runner, scratch, () => {});
  writeFileSync(join(cleanOut, LAYOUT_FILE), 'STALE_OWNED_COMPANION'); const logs: string[] = [];
  rigStage({ ...stageArgs, out: cleanOut }, runner, scratch, (l) => logs.push(l));
  say('SUCCESSFUL_UNDECLARED_REMOVES_STALE_COMPANION', !existsSync(join(cleanOut, LAYOUT_FILE)) && equal(noLayoutFiles, files(cleanOut)), 'only the new owned companion is removed after successful green; all 646 output files retained');
  say('UNDECLARED_OUTPUT_LOG_SHAPE_UNCHANGED', equal(stageLogs.map((s) => s.replaceAll(out, '<out>')), logs.map((s) => s.replaceAll(cleanOut, '<out>'))), 'same stage and rigc lines, only the fixture output-directory spelling normalized');
  const automaticCfg: CharacterConfig = structuredClone(inheritedCfg); delete automaticCfg.regions.tileB1;
  automaticCfg.meshes.tileB1 = { auto: withPolicyMotion(syntheticPolicy(4)), segments: ['branchB'], r: 8 };
  const referenceMotion = parseConfig(rigConfig()).motion;
  automaticCfg.motion = { duration: referenceMotion.duration, tracks: referenceMotion.tracks.map((t) => 'chain' in t ? { ...t, chain: 'branchB' } : t) };
  if (automaticCfg.limbs) automaticCfg.limbs.branchB.layout = { before: { part: 'tileD' } };
  save(path, automaticCfg); const automatic = rigStage({ ...stageArgs, out: join(home, 'automatic-rig') }, runner, scratch, () => {});
  say('AUTOMATIC_MESH_ACTUAL_STAGE_AND_FINAL_HASH', automatic.autoMotion.length > 0 && JSON.parse(readFileSync(join(home, 'automatic-rig', LAYOUT_FILE), 'utf8')).rig.sha256 === hash(readFileSync(join(home, 'automatic-rig', 'rig.json'))), 'normal automatic motion gate retained; replay search selection is not claimed by this control');
  cpSync(out, join(dir, 'producer-fixture'), { recursive: true });
  save(join(dir, 'PRODUCER-FIXTURE.json'), { schema: 'rig-parts-layout/1', rig: JSON.parse(readFileSync(join(out, 'rig.json'), 'utf8')), layout: JSON.parse(readFileSync(join(out, LAYOUT_FILE), 'utf8')), consumer: 'pose346 unavailable until its actual reader/depth mapping; producer adjacency only' });
}
