#!/usr/bin/env bun
/** #658 controls: named field, immutable payload, and actual image/placement binding. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { explicitFixture } from '../fixtures/explicitmesh.ts';
import { rigConfig, rigImages, rigParts, writeRigFixture } from '../fixtures/rig.ts';
import { parseConfig, partBoundBones } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { buildRig, rigJsonText, type MeshAttachment } from '../src/rig.ts';
import { explicitImageHash, explicitRegionHash } from '../src/explicitmesh.ts';
import { readRigInputs, rigStage } from '../src/build.ts';
import { notCompared } from '../src/meshdraft.ts';
import { meshStatsRows } from '../src/meshstats.ts';
import { configRoles } from '../src/structure.ts';

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
  return failed;
}

if (import.meta.main) {
  const root = resolve(process.argv[2]);
  const bad = runExplicitMeshChecks(root, (n, ok, detail) => console.log(`${ok ? 'PASS' : 'FAIL'} ${n}: ${detail}`));
  process.exitCode = bad > 0 ? 1 : 0;
}
