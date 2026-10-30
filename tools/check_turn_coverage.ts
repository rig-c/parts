/** Missing declarations are warnings, never inferred roles or depth values. */
import { runTurnOwnershipChecks } from './check_turn_ownership.ts';
import { weightedSurfaceFixture } from '../fixtures/turn_surface.ts';
import { block } from '../fixtures/rig.ts';
import { parseConfig } from '../src/config.ts';
import { buildRig } from '../src/rig.ts';
import { warnUncoveredBodyTurn } from '../src/turncoverage.ts';
import type { Depth25DTurnOptions } from '../src/turn.ts';
import type { Problem } from '../src/errors.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
function fixture() {
  const f = weightedSurfaceFixture();
  f.parts.parts.push({ ...f.parts.parts[2], name: 'patch', from: 'full:neckwear', x: 24, y: 42, w: 8, h: 8, opaque_px: 64, depth: undefined });
  f.images.set('patch', block(8, 8));
  (f.config.assemble as { plan: string[][] }).plan.push(['patch', 'full', 'neckwear']);
  f.config.regions = { patch: 'chest' };
  return f;
}
export function runTurnCoverageChecks(say: Say): void {
  runTurnOwnershipChecks(say);
  const build = (f: ReturnType<typeof fixture>) => buildRig(parseConfig(f.config), f.parts, f.images);
  const defect = build(fixture());
  const warning = defect.turnWarnings?.find(p => p.code === 'RIG_TURN_BODY_UNCOVERED' && p.object === 'part "patch"');
  say('TCV01_UNLISTED_OPAQUE_PATCH_NAMES_BOTH_ENDPOINT_DISPLACEMENTS', warning?.detail.includes('surface "topwear"') === true && warning.detail.includes('t=0: part displacement [0, 0]') && warning.detail.includes('t=1.875: part displacement [0, 0]') && !warning.detail.includes('relative 0 rig px'), warning?.detail ?? 'silent patch dx=0 over moving topwear');
  const covered = fixture(); (covered.config.turn as { body: { roles: Record<string, string>; unitDepths?: Record<string, number> } }).body.roles.patch = 'unit';
  (covered.config.turn as { body: { unitDepths: Record<string, number> } }).body.unitDepths = { patch: 20 };
  const registered = build(covered);
  say('TCV02_EXPLICIT_ROLE_COUNTS_AS_COVERAGE_WITHOUT_A_SEAM_CLAIM', !registered.turnWarnings?.some(p => p.code === 'RIG_TURN_BODY_UNCOVERED' && p.object === 'part "patch"'), 'explicit unit role is covered; a warning is not an all-frame seam acceptance test');
  const distant = fixture(); distant.parts.parts.at(-1)!.x = 0;
  const transparent = fixture(); for (let i = 3; i < transparent.images.get('patch')!.data.length; i += 4) transparent.images.get('patch')!.data[i] = 127;
  const outside = fixture(); (outside.config.regions as Record<string, string>).patch = 'head';
  say('TCV03_NO_BBOX_OR_TRANSPARENT_OR_HEAD_SUBTREE_FALSE_POSITIVE', [distant, transparent, outside].every(f => !build(f).turnWarnings?.some(p => p.code === 'RIG_TURN_BODY_UNCOVERED' && p.object === 'part "patch"')), 'no opaque intersection, alpha127 and head/neck subtree are outside this body coverage diagnostic');
  const warnings: Problem[] = [];
  const geometry = (part: string) => ({ part, slot: part, attachment: part, canvas: [8, 8] as const, triangles: [0, 1, 2, 0, 2, 3], weights: [[0, 0], [8, 0], [8, 8], [0, 8]].map(([x, y]) => [{ bone: 'chest', x: x - 4, y: y - 4, weight: 1 }]) });
  const opts: Depth25DTurnOptions = { warnings, turn: { body: { roles: { surface: 'surface' } } }, parts: ['surface', 'patch'].map(name => ({ name, x: 0, y: 0, w: 8, h: 8 })), images: new Map(['surface', 'patch'].map(n => [n, block(8, 8)])), regions: { surface: 'chest', patch: 'chest' }, stills: {}, boneLandmarks: new Map(), hasAlternateFaceSet: false, coverageMeshes: ['surface', 'patch'].map(geometry) };
  const rig = { bones: [{ name: 'root', x: 0, y: 0 }, { name: 'chest', parent: 'root', x: 0, y: 4 }] };
  const motion = { animations: { body_turn: { tracks: [{ bone: 'chest', property: 'translatex', keys: [{ t: 0, v: [3] }, { t: 1, v: [-3] }] }] } } };
  warnUncoveredBodyTurn(rig, motion, opts);
  say('TCV04_IDENTICAL_INHERITED_CARRIER_IS_COVERED', warnings.length === 0, 'actual endpoint displacement +3/-3 on both drawings, despite absent patch role; no relative motion');
  const zero = structuredClone(motion); zero.animations.body_turn.tracks[0].keys.forEach(k => k.v = [0]);
  warnUncoveredBodyTurn(rig, zero, opts);
  say('TCV05_UNMOVED_SURFACE_IS_NOT_A_COVERAGE_DEFECT', warnings.length === 0, 'no moved surface at either endpoint');
  const relativeWarnings: Problem[] = [];
  const separate = { ...rig, bones: [...rig.bones, { name: 'surface_frame', parent: 'chest', x: 0, y: 0 }] };
  const separateMeshes = opts.coverageMeshes!.map(m => m.part === 'surface' ? { ...m, weights: m.weights.map(row => row.map(w => ({ ...w, bone: 'surface_frame' }))) } : m);
  const separateMotion = structuredClone(motion); separateMotion.animations.body_turn.tracks[0].bone = 'surface_frame';
  warnUncoveredBodyTurn(separate, separateMotion, { ...opts, warnings: relativeWarnings, coverageMeshes: separateMeshes });
  const relative = relativeWarnings.find(p => p.code === 'RIG_TURN_BODY_UNCOVERED')?.detail;
  say('TCV08_RELATIVE_ENDPOINT_ORACLE_USES_BOTH_ACTUAL_FIELDS', relative?.includes('t=0: part displacement [0, 0], surface displacement [3, 0], relative 3 rig px') === true && relative.includes('t=1: part displacement [0, 0], surface displacement [-3, 0], relative 3 rig px'), relative ?? 'missing fixed +3/-3 surface with stationary patch');

  const excluded = fixture(); const source = excluded.images.get('topwear')!;
  for (let y = 42; y < 50; y++) for (let x = 24; x < 32; x++) source.data[((y - 38) * source.width + x - 16) * 4 + 3] = 0;
  say('TCV06_EXCLUDED_SOURCE_ALPHA_IS_NOT_OVERLAP', !build(excluded).turnWarnings?.some(p => p.code === 'RIG_TURN_BODY_UNCOVERED' && p.object === 'part "patch"'), 'setup alpha excludes the whole patch intersection; a shared rectangle is insufficient');
  say('TCV07_DIAGNOSTICS_DO_NOT_SERIALIZE_OR_ASSIGN_A_ROLE', !(defect.rig as unknown as Record<string, unknown>).turnWarnings && !(defect.motion as unknown as Record<string, unknown>).turnWarnings && (fixture().config.turn as { body: { roles: Record<string, string> } }).body.roles.patch === undefined, 'report-only warnings; caller config and emitted rig/motion schemas unchanged');
}
