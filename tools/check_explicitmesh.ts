#!/usr/bin/env bun
/** #658 controls: named field, immutable payload, and actual image/placement binding. */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { explicitFixture, explicitIslandsFixture, type IslandsExplicitMeshSpec, type SingleExplicitMeshSpec, stoppedLimbFixture } from '../fixtures/explicitmesh.ts';
import { block, islandImages, rigConfig, rigImages, rigParts, writeRigFixture } from '../fixtures/rig.ts';
import { parseConfig, partBoundBones, type ExplicitMeshSpec, type Limb } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { applyTurn, buildRig, rigJsonText, type MeshAttachment } from '../src/rig.ts';
import { explicitImageHash, explicitRegionHash } from '../src/explicitmesh.ts';
import { gateThroughRigc, readRigInputs, rigStage } from '../src/build.ts';
import { DEFAULT_PACK_MODE, flatComposite, flatCompositeForSet, packageRigc, readFrameSet, runCheck, SEAM_MEAN_BAR, SEAM_PX_BAR, seamFigures, setPlacements, STILL_DIR, stillRigForSet } from '../src/check.ts';
import { composeFromFiles, SCENE_SPEC } from '../src/scene.ts';
import { processRigcRunner } from './build-process.ts';
import { notCompared } from '../src/meshdraft.ts';
import { meshStatsRows } from '../src/meshstats.ts';
import { configRoles } from '../src/structure.ts';
import { layoutCompanion, refreshLimbLayout } from '../src/limblayout.ts';

export function runExplicitMeshChecks(root: string, report: (name: string, ok: boolean, detail: string) => void): number {
  mkdirSync(root, { recursive: true }); let failed = 0;
  const check = (name: string, ok: boolean, detail: string): void => { if (!ok) failed++; report(name, ok, detail); };
  const refused = (fn: () => unknown): PartsError | null => { try { fn(); return null; } catch (e) { if (e instanceof PartsError) return e; throw e; } };
  const codes = (e: PartsError | null): string => e?.problems.map(p => `${p.code} ${p.object}`).join('; ') ?? 'accepted';
  const fixture = explicitFixture(), cfg = parseConfig(fixture.config), parts = rigParts(), images = rigImages();
  const before = JSON.stringify(cfg), built = buildRig(cfg, parts, images), att = built.rig.skins.default.cloth.cloth as MeshAttachment;
  check('GX01_EXPLICIT_CORNERS_ARE_TRANSFERRED_EXACTLY', JSON.stringify(att.uvs) === JSON.stringify(fixture.mesh.explicit.uvs) && JSON.stringify(att.weights) === JSON.stringify(fixture.mesh.explicit.weights) && JSON.stringify(att.triangles) === '[0,1,2,0,2,3]' && att.hull === 4 && att.width === 24 && att.height === 16 && built.meshReport[0].art_coverage === 1,
    'four corners; two triangles; hull four; 24x16 padded image; coverage one');
  check('GX02_THE_HASH_DEFINITIONS_HAVE_INDEPENDENT_CONTROLS', explicitImageHash(images.get('cloth')!) === createHash('sha256').update(new Uint8Array(Array.from({ length: 128 }, () => [200, 120, 80, 255]).flat())).digest('hex') && explicitRegionHash([40, 40], parts.parts[0]) === createHash('sha256').update('[40,40,10,10,16,8]').digest('hex'), 'hand-counted 16x8 pixels and explicit canvas/rectangle JSON');
  const changed = rigImages(); changed.get('cloth')!.data[0]++;
  const imageError = refused(() => buildRig(cfg, parts, changed));
  check('GX03_A_CHANGED_IMAGE_IS_REFUSED_BY_NAME', imageError?.problems.some(p => p.code === 'RIG_EXPLICIT_IMAGE_HASH' && p.object === 'config.meshes.cloth.explicit.image_sha256') === true, codes(imageError));
  const moved = rigParts(); moved.parts[0].x++;
  const regionError = refused(() => buildRig(cfg, moved, images));
  check('GX04_A_CHANGED_PLACEMENT_IS_REFUSED_BY_NAME', regionError?.problems.some(p => p.code === 'RIG_EXPLICIT_REGION_HASH') === true, codes(regionError));
  const precision = explicitFixture(); precision.mesh.explicit.weights[0][0].x = -14.123456789012345; precision.mesh.explicit.uvs[0] = 0.0123456789012345;
  const precisionAtt = buildRig(parseConfig(precision.config), parts, images).rig.skins.default.cloth.cloth as MeshAttachment;
  check('GX05_BIND_FLOATS_AND_UVS_ARE_NOT_NORMALIZED', JSON.stringify(precisionAtt.weights) === JSON.stringify(precision.mesh.explicit.weights) && JSON.stringify(precisionAtt.uvs) === JSON.stringify(precision.mesh.explicit.uvs), 'supplied double values and array order preserved exactly');
  const defective = (change: (mesh: Record<string, unknown>) => void): PartsError | null => { const f = explicitFixture(); change(f.mesh as unknown as Record<string, unknown>); return refused(() => parseConfig(f.config)); };
  const genError = defective(m => { m.grid = 8; m.r = 4; });
  check('GX06_GENERATOR_FIELDS_ARE_NOT_SILENTLY_IGNORED', genError?.problems.filter(p => p.code === 'CONFIG_EXPLICIT_MODE').length === 2, codes(genError));
  const hashError = defective(m => { (m.explicit as Record<string, unknown>).image_sha256 = 'guess'; });
  const missing = defective(m => { delete (m.explicit as Record<string, unknown>).region_sha256; });
  check('GX07_MISSING_AND_INVALID_HASHES_ARE_REFUSED', hashError?.problems.some(p => p.code === 'CONFIG_EXPLICIT_HASH') === true && missing?.problems.some(p => p.code === 'CONFIG_FIELD_PRESENT' && p.object.endsWith('.region_sha256')) === true, `${codes(hashError)}; ${codes(missing)}`);
  const shape = defective(m => { (m.explicit as Record<string, unknown>).weights = []; (m.explicit as Record<string, unknown>).triangles = [0, 1, 12]; });
  check('GX08_MALFORMED_SHAPES_ARE_NAMED_BEFORE_MEASUREMENT', shape?.problems.some(p => p.code === 'CONFIG_EXPLICIT_SHAPE') === true, codes(shape));
  const unknown = defective(m => { (m.explicit as { weights: Array<Array<{ bone: string }>> }).weights[0][0].bone = 'absent'; });
  const unbound = defective(m => { (m.explicit as { weights: Array<Array<{ bone: string }>> }).weights[0][0].bone = 'eye'; });
  const chain = defective(m => { m.segments = ['hem']; });
  check('GX09_WEIGHT_BONES_AND_DIRECT_BINDING_NAMES_RESOLVE', [unknown, unbound, chain].every(e => e?.problems.some(p => p.code === 'CONFIG_NAME_RESOLVES')), `${codes(unknown)}; ${codes(unbound)}; ${codes(chain)}`);
  const annotation = explicitFixture(); Object.assign(annotation.mesh.explicit, { note: 'accepted', 'x-record': { ignored: true } }); Object.assign(annotation.mesh.explicit.weights[0][0], { note: 'do not emit' });
  const clean = buildRig(parseConfig(annotation.config), parts, images);
  check('GX10_NO_ANNOTATION_OR_RECORD_ENTERS_THE_PAYLOAD', rigJsonText(clean.rig) === rigJsonText(built.rig) && JSON.stringify(cfg) === before && rigJsonText(buildRig(cfg, parts, images).rig) === rigJsonText(built.rig), 'same repeated bytes; input unmodified; only named weight fields copied');
  const roles = configRoles({ bones: cfg.bones, meshes: cfg.meshes, regions: cfg.regions, motion: cfg.motion });
  check('GX11_READERS_CLASSIFY_THE_EXPLICIT_BINDING', JSON.stringify(partBoundBones(cfg).get('cloth')) === '["body"]' && roles.get('body')?.role === 'deforms' && meshStatsRows(built.meshReport)[0].mode === 'explicit' && notCompared(cfg.meshes)[0].mode === 'explicit', 'ownership and roles read weights; mesh-stats and mesh-draft name explicit');
  const disk = writeRigFixture(join(root, 'disk')); writeFileSync(disk.config, JSON.stringify(fixture.config));
  const actual = readRigInputs(disk.config, disk.parts);
  const positive = buildRig(actual.cfg, actual.parts, actual.images);
  check('GX12_THE_REAL_INPUT_READER_PRESERVES_THE_PAYLOAD', JSON.stringify((positive.rig.skins.default.cloth.cloth as MeshAttachment).weights) === JSON.stringify(att.weights), 'config loader, parts reader and decoded PNG through readRigInputs');
  const out = join(root, 'gate-refused');
  const denied = refused(() => rigStage({ config: disk.config, parts: disk.parts, out }, () => ({ status: 1, out: 'rigc compile error: planted explicit gate denial' }), join(root, 'gate-scratch'), () => {}));
  check('GX13_GATE_FAILURE_PUBLISHES_NOTHING', denied?.problems.some(p => p.code === 'RIG_RIGC_GREEN') === true && !existsSync(out), codes(denied));
  // Changing only one decoded pixel must also fail through the real disk reader.
  const wrong = explicitFixture(); wrong.mesh.explicit.image_sha256 = '0'.repeat(64); writeFileSync(disk.config, JSON.stringify(wrong.config));
  const actualWrong = readRigInputs(disk.config, disk.parts), noOut = join(root, 'hash-refused');
  let gateCalls = 0;
  const e = refused(() => rigStage({ config: disk.config, parts: disk.parts, out: noOut }, () => { gateCalls++; return { status: 0, out: '' }; }, join(root, 'hash-scratch'), () => {}));
  check('GX14_IMAGE_GUARD_RUNS_BEFORE_THE_GATE_OR_PUBLICATION', e?.problems.some(p => p.code === 'RIG_EXPLICIT_IMAGE_HASH') === true && gateCalls === 0 && !existsSync(noOut), `${codes(e)}; gate calls ${gateCalls}`);
  const stopped = rigConfig(); stopped.stops = [{ chain: 'hem', against: 'body', at: [0, 0], inward: -45, outward: 45, lower: { inward: -45, outward: 45 } }];
  const generated = buildRig(parseConfig(stopped), parts, images);
  const final = generated.rig.skins.default.cloth.cloth as MeshAttachment;
  const transfer = explicitFixture();
  transfer.config.motion = stopped.motion; transfer.config.stops = stopped.stops;
  transfer.mesh.segments = [...new Set([generated.rig.slots.find(s => s.name === 'cloth')!.bone, ...final.weights.flatMap(row => row.map(w => w.bone))])];
  Object.assign(transfer.mesh.explicit, { uvs: final.uvs, triangles: final.triangles, hull: final.hull, weights: final.weights });
  const stoppedTransfer = buildRig(parseConfig(transfer.config), parts, images);
  check('GX15_STOPPED_FINAL_BINDINGS_KEEP_IDLE_CONTROLS_AND_FLOATS', JSON.stringify(stoppedTransfer.rig) === JSON.stringify(generated.rig) && JSON.stringify(stoppedTransfer.motion) === JSON.stringify(generated.motion), 'ordinary generated stopped rig and config-only explicit rebuild: whole rig and motion objects identical');
  const invented = structuredClone(transfer.config) as Record<string, unknown>;
  ((invented.meshes as Record<string, { segments: string[] }>).cloth).segments.push('absent_d');
  const suffix = refused(() => parseConfig(invented));
  check('GX16_A_DRAWN_SUFFIX_IS_NOT_AN_UNKNOWN_NAME_ESCAPE', suffix?.problems.some(p => p.code === 'CONFIG_NAME_RESOLVES') === true, codes(suffix));
  const sourceBindings = structuredClone(transfer.config) as Record<string, unknown>;
  const sourceMesh = (sourceBindings.meshes as Record<string, typeof transfer.mesh>).cloth;
  sourceMesh.segments = sourceMesh.segments.map(b => typeof b === 'string' && b.endsWith('_d') ? b.slice(0, -2) : b);
  for (const row of sourceMesh.explicit.weights) for (const w of row) if (w.bone.endsWith('_d')) w.bone = w.bone.slice(0, -2);
  const rebound = refused(() => buildRig(parseConfig(sourceBindings), parts, images));
  check('GX17_AN_ACCEPTED_PAYLOAD_IS_NEVER_SILENTLY_REBOUND', rebound?.problems.some(p => p.code === 'RIG_EXPLICIT_BINDING') === true, codes(rebound));
  const altParts = rigParts(); altParts.alternates = [{ name: 'other', slots: { cloth: 'other_cloth' }, records: [{ ...altParts.parts[0] }], ghost_px: {}, recomposite: { mean_abs: 0, within_limit: 8, within_share: 1, error_limit: 40, error_px: 0, covered_alpha: 128, uncovered_error_px: 0, hole_count: 0, holes_listed: 0, holes: [] } }];
  const altImages = rigImages(); altImages.set('other_cloth', altImages.get('cloth')!);
  const alternate = refused(() => buildRig(cfg, altParts, altImages));
  check('GX18_BASE_PAYLOAD_IS_NOT_GUESSED_FOR_ALTERNATE_ART', alternate?.problems.some(p => p.code === 'RIG_EXPLICIT_ALTERNATE') === true, codes(alternate));
  const transferPart = (f: ReturnType<typeof stoppedLimbFixture>, part: string) => {
    const original = buildRig(parseConfig(f.config), f.parts, f.images), raw = structuredClone(f.config);
    const accepted = original.rig.skins.default[part][part] as MeshAttachment;
    const record = f.parts.parts.find(p => p.name === part)!;
    const mesh: SingleExplicitMeshSpec = { segments: [...new Set([original.rig.slots.find(s => s.name === part)!.bone, ...accepted.weights.flatMap(row => row.map(w => w.bone))])], explicit: {
      image_sha256: explicitImageHash(f.images.get(part)!), region_sha256: explicitRegionHash(f.parts.rig_size, record),
      uvs: accepted.uvs, triangles: accepted.triangles, hull: accepted.hull, weights: accepted.weights,
    } };
    (raw.meshes as Record<string, unknown>)[part] = mesh;
    delete (raw.regions as Record<string, unknown>)[part];
    return { raw, original, accepted, mesh };
  };
  const limb = stoppedLimbFixture(), acceptedRider = transferPart(limb, 'rider');
  const order = (rig: typeof built.rig): string => JSON.stringify(rig.slots.map(s => s.name));
  check('GX19_STOPPED_GENERATED_LIMB_IS_THE_POSITIVE_ORDER_CONTROL', order(acceptedRider.original.rig) === '["upper","rider","lower","unrelated"]', order(acceptedRider.original.rig));
  const riderInput = JSON.stringify(acceptedRider.mesh.explicit), rider = buildRig(parseConfig(acceptedRider.raw), limb.parts, limb.images);
  check('GX20_ACCEPTED_DRAWN_LINK_RIDER_KEEPS_LIMB_ORDER_AND_PAYLOAD', order(rider.rig) === order(acceptedRider.original.rig) && JSON.stringify(rider.rig.skins.default.rider.rider) === JSON.stringify(acceptedRider.accepted) && JSON.stringify(acceptedRider.mesh.explicit) === riderInput,
    `${order(rider.rig)}; accepted leg1_d weights and input unchanged`);
  const subset = stoppedLimbFixture();
  subset.config.stops = [{ chain: 'leg', links: ['leg1'], against: 'body', at: [0, 0], inward: -45, outward: 45 }];
  const selected = transferPart(subset, 'rider'), selectedBuilt = buildRig(parseConfig(selected.raw), subset.parts, subset.images);
  check('GX21_ONLY_THE_DECLARED_STOP_LINKS_GAIN_OWNERSHIP_ALIASES', JSON.stringify(selected.mesh.segments) === '["leg1_d"]' && order(selectedBuilt.rig) === order(selected.original.rig), order(selectedBuilt.rig));
  const undeclared = structuredClone(selected.raw), undeclaredMesh = (undeclared.meshes as Record<string, SingleExplicitMeshSpec>).rider;
  undeclaredMesh.segments = ['leg0_d'];
  for (const row of undeclaredMesh.explicit.weights) for (const w of row) w.bone = 'leg0_d';
  const unknownAlias = refused(() => buildRig(parseConfig(undeclared), subset.parts, subset.images));
  check('GX22_AN_UNSTOPPED_CHAIN_LINK_DRAWN_ALIAS_IS_REFUSED', unknownAlias?.problems.some(p => p.code === 'CONFIG_NAME_RESOLVES') === true, codes(unknownAlias));
  const laidOut = stoppedLimbFixture();
  (laidOut.config.meshes as Record<string, unknown>).lower = { grid: 8, r: 8, segments: ['leg1'] };
  delete (laidOut.config.regions as Record<string, unknown>).lower;
  (laidOut.config.limbs as Record<string, Limb>).limb.layout = { parts: ['lower'], before: { part: 'unrelated' } };
  const acceptedLower = transferPart(laidOut, 'lower'), lower = buildRig(parseConfig(acceptedLower.raw), laidOut.parts, laidOut.images);
  check('GX23_EXPLICIT_STOPPED_SEGMENT_LAYOUT_RETAINS_SELECTED_RIDERS', order(lower.rig) === order(acceptedLower.original.rig) && JSON.stringify(lower.rig.skins.default.lower.lower) === JSON.stringify(acceptedLower.accepted) && JSON.stringify(lower.layout?.placements[0].slots) === '["rider","lower"]', JSON.stringify(lower.layout?.placements));
  if (lower.layout === undefined) throw new Error('GENERATED_STOPPED_LAYOUT_REQUIRED');
  const replay = refreshLimbLayout(lower.layout, lower.rig), companion = layoutCompanion(replay, lower.rig, rigJsonText(lower.rig));
  check('GX24_STOPPED_LAYOUT_REPLAY_AND_COMPANION_KEEP_ALIAS_PROVENANCE', JSON.stringify(companion.setup_slots) === order(lower.rig) && JSON.stringify(replay.placements[0].slots) === '["rider","lower"]' && JSON.stringify(lower.rig.skins.default.lower.lower) === JSON.stringify(acceptedLower.accepted), JSON.stringify(companion.placements));
  const islFix = explicitIslandsFixture(), islCfg = parseConfig(islFix.config), islBuilt = buildRig(islCfg, islFix.parts, islFix.images);
  const att1 = islBuilt.rig.skins.default.cloth.cloth as MeshAttachment;
  const att2 = islBuilt.rig.skins.default.cloth__island2.cloth__island2 as MeshAttachment;
  const islTransferred = explicitIslandsFixture();
  islTransferred.mesh = {
    segments: ['body', 'eye'],
    explicit: {
      image_sha256: explicitImageHash(islFix.images.get('cloth')!),
      region_sha256: explicitRegionHash(islFix.parts.rig_size, islFix.parts.parts[0]),
      islands: [
        { slot: 'cloth', uvs: [...att1.uvs], triangles: [...att1.triangles], hull: att1.hull, weights: structuredClone(att1.weights) },
        { slot: 'cloth__island2', bone: islBuilt.rig.slots.find(s => s.name === 'cloth__island2')!.bone, uvs: [...att2.uvs], triangles: [...att2.triangles], hull: att2.hull, weights: structuredClone(att2.weights) },
      ],
    },
  } satisfies IslandsExplicitMeshSpec;
  islTransferred.config.meshes = { cloth: islTransferred.mesh };
  const islRebuilt = buildRig(parseConfig(islTransferred.config), islFix.parts, islFix.images);
  const genTwoIsl = buildRig(parseConfig(rigConfig()), islFix.parts, islFix.images);
  const genTwoIslAtt = genTwoIsl.rig.skins.default.cloth.cloth as MeshAttachment;
  const singleOnTwoIslands = explicitFixture();
  singleOnTwoIslands.mesh = {
    segments: [...new Set([genTwoIsl.rig.slots.find(s => s.name === 'cloth')!.bone, ...genTwoIslAtt.weights.flatMap(row => row.map(w => w.bone))])],
    explicit: {
      image_sha256: explicitImageHash(islFix.images.get('cloth')!),
      region_sha256: explicitRegionHash(islFix.parts.rig_size, islFix.parts.parts[0]),
      uvs: [...genTwoIslAtt.uvs],
      triangles: [...genTwoIslAtt.triangles],
      hull: genTwoIslAtt.hull,
      weights: structuredClone(genTwoIslAtt.weights),
    },
  };
  singleOnTwoIslands.config.meshes = { cloth: singleOnTwoIslands.mesh };
  const singleOnTwoBuilt = buildRig(parseConfig(singleOnTwoIslands.config), islFix.parts, islFix.images);
  const islBeforeFix = explicitIslandsFixture();
  const midImg = block(10, 10);
  for (let i = 0; i < 100; i++) midImg.data.set([40, 90, 220, 255], i * 4);
  islBeforeFix.parts.parts.splice(1, 0, {
    ...islBeforeFix.parts.parts[1],
    name: 'mid',
    from: 'full:bottomwear',
    x: 18,
    y: 9,
    w: 10,
    h: 10,
    opaque_px: 100,
  });
  islBeforeFix.images.set('mid', midImg);
  (islBeforeFix.config.assemble as { plan: string[][] }).plan.splice(1, 0, ['mid', 'full', 'bottomwear']);
  (islBeforeFix.config.regions as Record<string, string>).mid = 'body';
  islBeforeFix.mesh.explicit.islands[1].before = 'eye';
  const islBeforeBuilt = buildRig(parseConfig(islBeforeFix.config), islBeforeFix.parts, islBeforeFix.images);
  const islDisk = writeRigFixture(join(root, 'isl-disk'), islFix.config, islFix.images, islFix.parts);
  const islBuildDir = join(root, 'isl-build');
  const islRigOut = join(islBuildDir, 'rig');
  const runner = processRigcRunner(packageRigc(resolve(import.meta.dir, '..')));
  rigStage({ config: islDisk.config, parts: islDisk.parts, out: islRigOut }, runner, join(root, 'isl-rig-scratch'), () => {});
  cpSync(islDisk.parts, islBuildDir, { recursive: true });
  mkdirSync(join(islBuildDir, 'check'), { recursive: true });
  writeFileSync(join(islBuildDir, 'check', 'check.json'), JSON.stringify({ PASS: true, gate_spine_html_green: true }));
  const scenePath = join(root, 'isl-scene.json');
  writeFileSync(scenePath, JSON.stringify({
    spec: SCENE_SPEC,
    canvas: { width: 40, height: 40 },
    characters: [{ id: 'ch', build: islBuildDir, offset: [0, 0] }],
    order: ['ch'],
  }));
  const composed = composeFromFiles(scenePath);
  const composedIsl2 = composed.rig.skins.default['ch:cloth__island2']['ch:cloth__island2'] as MeshAttachment;
  const composeGate = gateThroughRigc(composed.images, [['rig.json', rigJsonText(composed.rig)], ['motion.json', rigJsonText(composed.motion)]], runner, join(root, 'isl-compose-scratch'), DEFAULT_PACK_MODE);
  const islBeforeDisk = writeRigFixture(join(root, 'isl-before-disk'), islBeforeFix.config, islBeforeFix.images, islBeforeFix.parts);
  const islBeforeRigOut = join(root, 'isl-before-rig');
  const islBeforeCheckOut = join(root, 'isl-before-check');
  rigStage({ config: islBeforeDisk.config, parts: islBeforeDisk.parts, out: islBeforeRigOut }, runner, join(root, 'isl-before-scratch'), () => {});
  const islBeforeCheck = runCheck(islBeforeRigOut, islBeforeCheckOut, runner, islBeforeDisk.parts, DEFAULT_PACK_MODE, undefined, undefined, false, true);
  const beforeStill = readFrameSet(join(islBeforeCheckOut, STILL_DIR));
  const plantedOrderRef = flatComposite(islBeforeFix.parts, join(islBeforeDisk.parts, 'parts'), beforeStill.background);
  const plantedOrderSeam = seamFigures(plantedOrderRef, beforeStill.frames[0].image, islBeforeBuilt.rig.skeleton, beforeStill.viewport, beforeStill.background);
  const islHideFix = explicitIslandsFixture();
  (islHideFix.config.assemble as Record<string, unknown>).alternates = [{ name: 'no_cloth', parts: ['eye'], hides: ['cloth'] }];
  const directIslHideCfg = structuredClone(islHideFix.config);
  ((directIslHideCfg.assemble as { alternates: Array<{ hides: string[] }> }).alternates[0]).hides = ['cloth__island2'];
  parseConfig(directIslHideCfg);
  const altNoCloth = {
    name: 'no_cloth',
    parts: ['eye'],
    hides: ['cloth'],
    slots: { eye: 'no_cloth_eye' },
    records: [{ ...islHideFix.parts.parts[1] }],
    ghost_px: {},
    recomposite: {
      mean_abs: 0,
      within_limit: 8,
      within_share: 1,
      error_limit: 40,
      error_px: 0,
      covered_alpha: 128,
      uncovered_error_px: 0,
      hole_count: 0,
      holes_listed: 0,
      holes: [],
    },
  };
  islHideFix.parts.alternates = [altNoCloth];
  islHideFix.images.set('no_cloth_eye', islHideFix.images.get('eye')!);
  const islHideBuilt = buildRig(parseConfig(islHideFix.config), islHideFix.parts, islHideFix.images);
  const islHideSlotOrder = islHideBuilt.rig.slots.map(s => s.name);
  const islHideStillRig = stillRigForSet(islHideBuilt.rig as unknown as Record<string, unknown>, altNoCloth);
  const islHideStillSlots = (islHideStillRig.slots as Array<{ name: string; attachment: string | null }>);
  const islHideDisk = writeRigFixture(join(root, 'isl-hide-disk'), islHideFix.config, islHideFix.images, islHideFix.parts);
  writeFileSync(join(islHideDisk.parts, 'parts', 'no_cloth_eye.png'), readFileSync(join(islHideDisk.parts, 'parts', 'eye.png')));
  const islHideRigOut = join(root, 'isl-hide-rig');
  const islHideCheckOut = join(root, 'isl-hide-check');
  rigStage({ config: islHideDisk.config, parts: islHideDisk.parts, out: islHideRigOut }, runner, join(root, 'isl-hide-scratch'), () => {});
  const islHideCheck = runCheck(islHideRigOut, islHideCheckOut, runner, islHideDisk.parts, DEFAULT_PACK_MODE, undefined, undefined, false, true, 'no_cloth');
  const hideStill = readFrameSet(join(islHideCheckOut, STILL_DIR, 'no_cloth'));
  const hideImg = hideStill.frames[0].image;
  const hideBg = hideStill.background;
  let hiddenIslandsClean = true;
  for (let y = 10; y < 18; y++) {
    for (const x of [10, 11, 12, 13, 22, 23, 24, 25]) {
      const p = (y * hideImg.width + x) * 4;
      if (hideImg.data[p] !== hideBg[0] || hideImg.data[p + 1] !== hideBg[1] || hideImg.data[p + 2] !== hideBg[2]) {
        hiddenIslandsClean = false;
      }
    }
  }
  const baseHideStill = readFrameSet(join(islHideCheckOut, STILL_DIR));
  const hideRef = flatCompositeForSet(islHideFix.parts, altNoCloth, join(islHideDisk.parts, 'parts'), baseHideStill.background, islHideSlotOrder);
  const plantedHideSeam = seamFigures(hideRef, baseHideStill.frames[0].image, islHideBuilt.rig.skeleton, baseHideStill.viewport, baseHideStill.background);
  const islRep = islBuilt.meshReport[0];
  check(
    'GX25_EXPLICIT_TWO_ISLAND_ROUND_TRIP_AND_SLOT_ORDER',
    order(islBuilt.rig) === '["cloth","cloth__island2","eye"]' &&
      order(islBeforeBuilt.rig) === '["cloth","mid","cloth__island2","eye"]' &&
      rigJsonText(buildRig(islCfg, islFix.parts, islFix.images).rig) === rigJsonText(islBuilt.rig) &&
      rigJsonText(islRebuilt.rig) === rigJsonText(islBuilt.rig) &&
      rigJsonText(singleOnTwoBuilt.rig) === rigJsonText(genTwoIsl.rig) &&
      readFileSync(join(islRigOut, 'rig.json'), 'utf8') === rigJsonText(islBuilt.rig) &&
      composedIsl2.path === 'ch.cloth' &&
      composedIsl2.image === 'ch.cloth.png' &&
      composeGate.every(g => g.status === 0) &&
      !islBeforeCheck.problems.some(p => p.code === 'CHECK_SEAM_WITHIN_BAR') &&
      islBeforeCheck.figures.seam_px_over_40 === 0 &&
      (islBeforeCheck.figures.seam_mean ?? 99) <= SEAM_MEAN_BAR &&
      plantedOrderSeam.over40 === 32 &&
      plantedOrderSeam.mean > SEAM_MEAN_BAR &&
      JSON.stringify(islHideBuilt.sets?.sets.no_cloth.hides) === '["cloth","cloth__island2"]' &&
      islHideStillSlots.find(s => s.name === 'cloth')?.attachment === null &&
      islHideStillSlots.find(s => s.name === 'cloth__island2')?.attachment === null &&
      JSON.stringify(setPlacements(islHideFix.parts, altNoCloth, islHideSlotOrder).map(p => p.name)) === '["eye"]' &&
      !islHideCheck.problems.some(p => p.code === 'CHECK_SEAM_WITHIN_BAR') &&
      islHideCheck.figures.sets?.no_cloth.PASS === true &&
      islHideCheck.figures.sets?.no_cloth.seam_px_over_40 === 0 &&
      hiddenIslandsClean &&
      plantedHideSeam.over40 === 64 &&
      (plantedHideSeam.over40 > SEAM_PX_BAR || plantedHideSeam.mean > SEAM_MEAN_BAR) &&
      islBuilt.rig.slots[0].bone === 'body' &&
      islBuilt.rig.slots[1].bone === 'eye' &&
      att1.path === undefined &&
      att1.image === 'cloth.png' &&
      att2.path === 'cloth' &&
      att2.image === 'cloth.png' &&
      JSON.stringify(att1.weights) === JSON.stringify(islFix.mesh.explicit.islands[0].weights) &&
      JSON.stringify(att2.weights) === JSON.stringify(islFix.mesh.explicit.islands[1].weights) &&
      islRep.vertices === 8 &&
      islRep.triangles === 4 &&
      islRep.hull === 8 &&
      JSON.stringify(islRep.bones) === '["body","eye"]' &&
      islRep.art_coverage === 1 &&
      JSON.stringify(partBoundBones(islCfg).get('cloth')) === '["body","eye"]',
    `${order(islBuilt.rig)} -> ${order(islBeforeBuilt.rig)}; beforeSeamOver40=${islBeforeCheck.figures.seam_px_over_40} (planted=${plantedOrderSeam.over40}); hideSet=${JSON.stringify(islHideBuilt.sets?.sets.no_cloth.hides)} (planted=${plantedHideSeam.over40})`,
  );
  const threeIslandCloth = block(16, 8);
  for (let y = 0; y < 8; y++) {
    for (const x of [4, 5, 10, 11]) threeIslandCloth.data.set([0, 0, 0, 0], (y * 16 + x) * 4);
  }
  const threeIslandsImages = islandImages();
  threeIslandsImages.set('cloth', threeIslandCloth);
  const twoOnThreeIslands = explicitIslandsFixture();
  twoOnThreeIslands.mesh.explicit.image_sha256 = explicitImageHash(threeIslandCloth);
  const missingIslErr = refused(() => buildRig(parseConfig(twoOnThreeIslands.config), twoOnThreeIslands.parts, threeIslandsImages));
  const twoOnOneIsland = explicitIslandsFixture();
  twoOnOneIsland.mesh.explicit.image_sha256 = explicitImageHash(images.get('cloth')!);
  const extraIslErr = refused(() => buildRig(parseConfig(twoOnOneIsland.config), parts, images));
  const wrongSlot = explicitIslandsFixture();
  wrongSlot.mesh.explicit.islands[1].slot = 'cloth_piece2';
  const wrongSlotErr = refused(() => parseConfig(wrongSlot.config));
  const bothMode = explicitIslandsFixture();
  (bothMode.mesh.explicit as Record<string, unknown>).uvs = [0, 0, 0, 1, 1, 1, 1, 0];
  const bothModeErr = refused(() => parseConfig(bothMode.config));
  const oneEntry = explicitIslandsFixture();
  oneEntry.mesh.explicit.islands = [oneEntry.mesh.explicit.islands[0]];
  const oneEntryErr = refused(() => parseConfig(oneEntry.config));
  const beforeOnFirst = explicitIslandsFixture();
  beforeOnFirst.mesh.explicit.islands[0].before = 'eye';
  const beforeOnFirstErr = refused(() => parseConfig(beforeOnFirst.config));
  const unknownIslBone = explicitIslandsFixture();
  unknownIslBone.mesh.segments = ['body'];
  for (const row of unknownIslBone.mesh.explicit.islands[1].weights) for (const w of row) w.bone = 'body';
  unknownIslBone.mesh.explicit.islands[1].bone = 'absent';
  const unknownIslBoneErr = refused(() => parseConfig(unknownIslBone.config));
  const undeclaredIslBone = explicitIslandsFixture();
  undeclaredIslBone.mesh.segments = ['body'];
  for (const row of undeclaredIslBone.mesh.explicit.islands[1].weights) for (const w of row) w.bone = 'body';
  undeclaredIslBone.mesh.explicit.islands[1].bone = 'eye';
  const undeclaredIslBoneErr = refused(() => parseConfig(undeclaredIslBone.config));
  const badBeforeTarget = explicitIslandsFixture();
  badBeforeTarget.mesh.explicit.islands[1].before = 'absent_part';
  const badBeforeErr = refused(() => buildRig(parseConfig(badBeforeTarget.config), badBeforeTarget.parts, badBeforeTarget.images));
  const stoppedIsl2 = explicitIslandsFixture();
  stoppedIsl2.mesh.segments = ['body', 'hem1'];
  stoppedIsl2.mesh.explicit.islands[1].bone = 'hem1';
  for (const row of stoppedIsl2.mesh.explicit.islands[1].weights) for (const w of row) w.bone = 'hem1';
  stoppedIsl2.config.stops = [{ chain: 'hem', against: 'body', at: [0, 0], inward: -45, outward: 45, lower: { inward: -45, outward: 45 } }];
  const stoppedIsl2Err = refused(() => buildRig(parseConfig(stoppedIsl2.config), stoppedIsl2.parts, stoppedIsl2.images));
  check(
    'GX26_EXPLICIT_ISLAND_COUNT_AND_SLOT_NAME_REFUSALS',
    missingIslErr?.problems.some(p => p.code === 'RIG_EXPLICIT_ISLAND_COUNT' && p.detail.includes('missing "cloth__island3"')) === true &&
      extraIslErr?.problems.some(p => p.code === 'RIG_EXPLICIT_ISLAND_COUNT' && p.detail.includes('extra "cloth__island2"')) === true &&
      wrongSlotErr?.problems.some(p => p.code === 'CONFIG_EXPLICIT_ISLAND_SLOT' && p.object === 'config.meshes.cloth.explicit.islands[1].slot') === true &&
      bothModeErr?.problems.some(p => p.code === 'CONFIG_EXPLICIT_ISLANDS' && p.object === 'config.meshes.cloth.explicit.uvs') === true &&
      oneEntryErr?.problems.some(p => p.code === 'CONFIG_EXPLICIT_ISLANDS' && p.object === 'config.meshes.cloth.explicit.islands') === true &&
      beforeOnFirstErr?.problems.some(p => p.code === 'CONFIG_EXPLICIT_ISLANDS' && p.object === 'config.meshes.cloth.explicit.islands[0].before') === true &&
      unknownIslBoneErr?.problems.some(p => p.code === 'CONFIG_NAME_RESOLVES' && p.object === 'config.meshes.cloth.explicit.islands[1].bone') === true &&
      undeclaredIslBoneErr?.problems.some(p => p.code === 'CONFIG_NAME_RESOLVES' && p.object === 'config.meshes.cloth.explicit.islands[1].bone') === true &&
      badBeforeErr?.problems.some(p => p.code === 'RIG_NAME_RESOLVES' && p.object === 'config.meshes.cloth.explicit.islands[1].before') === true &&
      stoppedIsl2Err?.problems.some(p => p.code === 'RIG_EXPLICIT_BINDING' && p.object === 'config.meshes.cloth.explicit.islands[1].weights') === true,
    `${codes(missingIslErr)}; ${codes(extraIslErr)}; ${codes(wrongSlotErr)}; ${codes(bothModeErr)}; ${codes(oneEntryErr)}; ${codes(beforeOnFirstErr)}; ${codes(unknownIslBoneErr)}; ${codes(undeclaredIslBoneErr)}; ${codes(badBeforeErr)}; ${codes(stoppedIsl2Err)}`,
  );
  const turnSpec = { pivot: 0.5, depths: { cloth: 0.2, eye: 0.199 } };
  const turnedSingle = explicitFixture();
  turnedSingle.config.turn = turnSpec;
  const turnedSingleBuilt = buildRig(parseConfig(turnedSingle.config), parts, images);
  const turnedSingleAtt = turnedSingleBuilt.rig.skins.default.cloth.cloth as MeshAttachment;
  const turnedIsl2 = explicitIslandsFixture();
  turnedIsl2.config.turn = turnSpec;
  const turnedIsl2Built = buildRig(parseConfig(turnedIsl2.config), turnedIsl2.parts, turnedIsl2.images);
  const turnedIsl2Att1 = turnedIsl2Built.rig.skins.default.cloth.cloth as MeshAttachment;
  const turnedIsl2Att2 = turnedIsl2Built.rig.skins.default.cloth__island2.cloth__island2 as MeshAttachment;
  const stoppedTurnedGenCfg = structuredClone(stopped);
  stoppedTurnedGenCfg.turn = turnSpec;
  const stoppedTurnedGen = buildRig(parseConfig(stoppedTurnedGenCfg), parts, images);
  const stoppedTurnedCfg = structuredClone(transfer.config);
  stoppedTurnedCfg.turn = turnSpec;
  const stoppedTurnedBuilt = buildRig(parseConfig(stoppedTurnedCfg), parts, images);
  const renderTurnCompare = (
    label: string,
    unturnedCfg: Record<string, unknown>,
    turnedCfg: Record<string, unknown>,
    fxImages: Map<string, ReturnType<typeof block>>,
    fxParts: ReturnType<typeof rigParts>,
  ): { sameRestPng: boolean; turnMovesPx: boolean } => {
    const baseDir = join(root, label);
    const unturnedDisk = writeRigFixture(join(baseDir, 'unturned-disk'), unturnedCfg, fxImages, fxParts);
    const turnedDisk = writeRigFixture(join(baseDir, 'turned-disk'), turnedCfg, fxImages, fxParts);
    const unturnedRigOut = join(baseDir, 'unturned-rig');
    const turnedRigOut = join(baseDir, 'turned-rig');
    rigStage({ config: unturnedDisk.config, parts: unturnedDisk.parts, out: unturnedRigOut }, runner, join(baseDir, 'unturned-scratch'), () => {});
    rigStage({ config: turnedDisk.config, parts: turnedDisk.parts, out: turnedRigOut }, runner, join(baseDir, 'turned-scratch'), () => {});
    const unturnedBuild = join(baseDir, 'unturned-build');
    const turnedBuild = join(baseDir, 'turned-build');
    const turnedMotion = JSON.parse(readFileSync(join(turnedRigOut, 'motion.json'), 'utf8')) as { animations: Record<string, unknown> };
    turnedMotion.animations.turn_step = {
      duration: 1,
      loop: false,
      tracks: [{ bone: 'turn', property: 'translate', keys: [{ t: 0, v: [0, 0] }, { t: 1, v: [4, 0] }] }],
    };
    const turnedMotionPath = join(baseDir, 'turned-motion.json');
    writeFileSync(turnedMotionPath, JSON.stringify(turnedMotion));
    const b0 = runner(['build', '--rig', join(unturnedRigOut, 'rig.json'), '--motion', join(unturnedRigOut, 'motion.json'), '--out', unturnedBuild, '--profile', 'spine']);
    const b1 = runner(['build', '--rig', join(turnedRigOut, 'rig.json'), '--motion', turnedMotionPath, '--out', turnedBuild, '--profile', 'spine']);
    if (b0.status !== 0 || b1.status !== 0) throw new Error(`TURN_COMPARE_BUILD_FAILED: ${b0.out}\n${b1.out}`);
    const unturnedIdleOut = join(baseDir, 'unturned-idle');
    const turnedIdleOut = join(baseDir, 'turned-idle');
    const turnedStepOut = join(baseDir, 'turned-step');
    const r0 = runner(['render', '--candidate', unturnedBuild, '--animation', 'idle', '--fps', '1', '--max', '40', '--viewport', '-20,0,40,40', '--out', unturnedIdleOut]);
    const r1 = runner(['render', '--candidate', turnedBuild, '--animation', 'idle', '--fps', '1', '--max', '40', '--viewport', '-20,0,40,40', '--out', turnedIdleOut]);
    const r2 = runner(['render', '--candidate', turnedBuild, '--animation', 'turn_step', '--fps', '1', '--max', '40', '--viewport', '-20,0,40,40', '--out', turnedStepOut]);
    if (r0.status !== 0 || r1.status !== 0 || r2.status !== 0) throw new Error(`TURN_COMPARE_RENDER_FAILED: ${r0.out}\n${r1.out}\n${r2.out}`);
    const unturnedSet = readFrameSet(unturnedIdleOut);
    const turnedSet = readFrameSet(turnedIdleOut);
    const stepSet = readFrameSet(turnedStepOut);
    const sameRestPng = readFileSync(join(unturnedSet.dir, unturnedSet.frames[0].name)).equals(readFileSync(join(turnedSet.dir, turnedSet.frames[0].name)));
    const turnMovesPx = !readFileSync(join(stepSet.dir, stepSet.frames[0].name)).equals(readFileSync(join(stepSet.dir, stepSet.frames[1].name)));
    return { sameRestPng, turnMovesPx };
  };
  const singleTurnRender = renderTurnCompare('turn-single', fixture.config, turnedSingle.config, images, parts);
  const islTurnRender = renderTurnCompare('turn-islands', islFix.config, turnedIsl2.config, islFix.images, islFix.parts);
  const directTurnTwin = explicitFixture();
  directTurnTwin.config.turn = turnSpec;
  directTurnTwin.mesh.segments = ['turn_cloth_body'];
  for (const row of directTurnTwin.mesh.explicit.weights) for (const w of row) w.bone = 'turn_cloth_body';
  const directTurnParseErr = refused(() => parseConfig(directTurnTwin.config));
  const directTurnBuildCfg = parseConfig(turnedSingle.config);
  const directTurnBuildMesh = directTurnBuildCfg.meshes.cloth as ExplicitMeshSpec;
  directTurnBuildMesh.segments = ['turn_cloth_body'];
  for (const row of directTurnBuildMesh.explicit.weights ?? []) for (const w of row) w.bone = 'turn_cloth_body';
  const directTurnBuildErr = refused(() => buildRig(directTurnBuildCfg, parts, images));
  const rawStopAndTurn = structuredClone(sourceBindings);
  rawStopAndTurn.turn = turnSpec;
  const rawStopAndTurnErr = refused(() => buildRig(parseConfig(rawStopAndTurn), parts, images));
  const rawStopSlotOnly = explicitFixture();
  rawStopSlotOnly.config.stops = stopped.stops;
  rawStopSlotOnly.config.turn = turnSpec;
  rawStopSlotOnly.mesh.segments = ['hem1', 'body'];
  const rawStopSlotOnlyErr = refused(() => buildRig(parseConfig(rawStopSlotOnly.config), parts, images));
  check(
    'GX27_EXPLICIT_MESH_AND_ISLANDS_COMPOSE_WITH_TURN_DEPTHS',
    turnedSingleBuilt.rig.slots.find(s => s.name === 'cloth')?.bone === 'turn_cloth_body' &&
      JSON.stringify(turnedSingleAtt.weights) === JSON.stringify(fixture.mesh.explicit.weights.map(row => row.map(w => ({ bone: `turn_cloth_${w.bone}`, x: w.x, y: w.y, weight: w.weight })))) &&
      JSON.stringify(turnedSingleBuilt.meshReport[0].bones) === '["turn_cloth_body"]' &&
      turnedIsl2Built.rig.slots.find(s => s.name === 'cloth')?.bone === 'turn_cloth_body' &&
      turnedIsl2Built.rig.slots.find(s => s.name === 'cloth__island2')?.bone === 'turn_cloth_eye' &&
      JSON.stringify(turnedIsl2Att1.weights) === JSON.stringify(islFix.mesh.explicit.islands[0].weights.map(row => row.map(w => ({ bone: `turn_cloth_${w.bone}`, x: w.x, y: w.y, weight: w.weight })))) &&
      JSON.stringify(turnedIsl2Att2.weights) === JSON.stringify(islFix.mesh.explicit.islands[1].weights.map(row => row.map(w => ({ bone: `turn_cloth_${w.bone}`, x: w.x, y: w.y, weight: w.weight })))) &&
      JSON.stringify(turnedIsl2Built.meshReport[0].bones) === '["turn_cloth_body","turn_cloth_eye"]' &&
      JSON.stringify(stoppedTurnedBuilt.rig) === JSON.stringify(stoppedTurnedGen.rig) &&
      JSON.stringify(stoppedTurnedBuilt.motion) === JSON.stringify(stoppedTurnedGen.motion) &&
      singleTurnRender.sameRestPng &&
      singleTurnRender.turnMovesPx &&
      islTurnRender.sameRestPng &&
      islTurnRender.turnMovesPx &&
      directTurnParseErr?.problems.some(p => p.code === 'CONFIG_NAME_RESOLVES' && p.object === 'config.meshes.cloth.segments[0]') === true &&
      directTurnParseErr?.problems.some(p => p.code === 'CONFIG_NAME_RESOLVES' && p.object === 'config.meshes.cloth.explicit.weights[0][0].bone') === true &&
      directTurnBuildErr?.problems.some(p => p.code === 'RIG_NAME_RESOLVES' && p.object === 'config.meshes.cloth.explicit' && p.detail.includes('"turn_cloth_body"')) === true &&
      rawStopAndTurnErr?.problems.some(p => p.code === 'RIG_EXPLICIT_BINDING' && p.object === 'config.meshes.cloth.explicit.weights') === true &&
      rawStopSlotOnlyErr?.problems.some(p => p.code === 'RIG_EXPLICIT_BINDING' && p.object === 'config.meshes.cloth.explicit.weights') === true,
    `single=${JSON.stringify(turnedSingleBuilt.meshReport[0].bones)} (restEq=${singleTurnRender.sameRestPng}, turnMoves=${singleTurnRender.turnMovesPx}); islands=${JSON.stringify(turnedIsl2Built.meshReport[0].bones)} (restEq=${islTurnRender.sameRestPng}, turnMoves=${islTurnRender.turnMovesPx}); plants=${codes(directTurnParseErr)} | ${codes(directTurnBuildErr)} | ${codes(rawStopAndTurnErr)} | ${codes(rawStopSlotOnlyErr)}`,
  );
  const cfgA = explicitFixture();
  cfgA.config.turn = turnSpec;
  cfgA.mesh.segments = ['body', 'hem0', 'hem1'];
  cfgA.mesh.explicit.weights[0] = [
    { bone: 'hem0', x: 0, y: 0, weight: 0.5 },
    { bone: 'hem1', x: 0, y: 0, weight: 0.5 },
  ];
  const cfgB = explicitFixture();
  cfgB.config.turn = turnSpec;
  cfgB.mesh.segments = ['body', 'hem0', 'hem1'];
  cfgB.mesh.explicit.weights[0] = [
    { bone: 'hem1', x: 0, y: 0, weight: 0.5 },
    { bone: 'hem0', x: 0, y: 0, weight: 0.5 },
  ];
  const plainBoneNames = new Set(built.rig.bones.map(b => b.name));
  const stoppedBoneNames = new Set([
    ...stoppedTurnedBuilt.rig.bones.map(b => b.name),
    ...(stoppedTurnedBuilt.rig.stops ?? []).flatMap(s => s.links.map(l => `${l}_d`)),
  ]);
  const boundNamesResolve =
    ['body', 'hem0', 'hem1'].every(b => plainBoneNames.has(b)) &&
    ['body', 'hem0_d', 'hem1_d'].every(b => stoppedBoneNames.has(b));
  let missingBoneGuard = '';
  try {
    applyTurn(turnSpec, ['cloth', 'eye'], structuredClone(built.rig.bones), [{ name: 'cloth', bone: 'absent_bone', attachment: 'cloth' }], {}, []);
  } catch (err) {
    missingBoneGuard = (err as Error).message;
  }
  const turnOrderA = buildRig(parseConfig(cfgA.config), parts, images);
  const turnOrderB = buildRig(parseConfig(cfgB.config), parts, images);
  const turnClothA = (turnOrderA.rig.constraints?.find(c => c.name === 'turn_cloth') as { bones: string[] } | undefined)?.bones;
  const turnClothB = (turnOrderB.rig.constraints?.find(c => c.name === 'turn_cloth') as { bones: string[] } | undefined)?.bones;
  const plantOrderA = buildRig(parseConfig(cfgA.config), parts, images, undefined, undefined, undefined, false);
  const plantOrderB = buildRig(parseConfig(cfgB.config), parts, images, undefined, undefined, undefined, false);
  const plantTurnClothA = (plantOrderA.rig.constraints?.find(c => c.name === 'turn_cloth') as { bones: string[] } | undefined)?.bones;
  const plantTurnClothB = (plantOrderB.rig.constraints?.find(c => c.name === 'turn_cloth') as { bones: string[] } | undefined)?.bones;
  check(
    'GX28_TURN_TWINS_FOLLOW_BONE_DECLARATION_ORDER_NOT_WEIGHT_ENCOUNTER_ORDER',
    boundNamesResolve &&
      missingBoneGuard === 'applyTurn: bound bone "absent_bone" is not in bones' &&
      JSON.stringify(turnOrderA.rig.bones) === JSON.stringify(turnOrderB.rig.bones) &&
      JSON.stringify(turnOrderA.rig.constraints) === JSON.stringify(turnOrderB.rig.constraints) &&
      JSON.stringify(turnClothA) === '["turn_cloth_body","turn_cloth_hem0","turn_cloth_hem1"]' &&
      JSON.stringify(turnClothB) === '["turn_cloth_body","turn_cloth_hem0","turn_cloth_hem1"]' &&
      JSON.stringify(plantTurnClothA) === '["turn_cloth_body","turn_cloth_hem0","turn_cloth_hem1"]' &&
      JSON.stringify(plantTurnClothB) === '["turn_cloth_body","turn_cloth_hem1","turn_cloth_hem0"]' &&
      JSON.stringify(plantOrderA.rig.bones) !== JSON.stringify(plantOrderB.rig.bones) &&
      JSON.stringify(plantOrderA.rig.constraints) !== JSON.stringify(plantOrderB.rig.constraints),
    `resolved=${boundNamesResolve}; sorted=${JSON.stringify(turnClothA)}===${JSON.stringify(turnClothB)}; planted=${JSON.stringify(plantTurnClothA)} vs ${JSON.stringify(plantTurnClothB)}; guard=${missingBoneGuard}`,
  );
  return failed;
}

if (import.meta.main) {
  const root = resolve(process.argv[2]);
  const bad = runExplicitMeshChecks(root, (n, ok, detail) => console.log(`${ok ? 'PASS' : 'FAIL'} ${n}: ${detail}`));
  process.exitCode = bad > 0 ? 1 : 0;
}
