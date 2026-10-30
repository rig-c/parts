/** Assembly controls for explicit unit depth, using the actual early reader and under-art path. */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { authoredUnitDepthFixture } from '../fixtures/authored_unit_depth.ts';
import { assembleStage } from '../src/build.ts';
import { PartsError } from '../src/errors.ts';
import { buildRig } from '../src/rig.ts';
import { readRigInputs } from '../src/build.ts';
import { readPng, writePng } from '../src/raster/png.ts';
import { readParts, serializeParts, writeParts } from '../src/parts.ts';
import { parseEarlyConfig, type CharacterConfig } from '../src/config.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
export function runAuthoredUnitDepthChecks(dir: string, say: Say): void {
  mkdirSync(dir, { recursive: true });
  const run = (name: string, edit?: (cfg: CharacterConfig, home: string) => void) => {
    const home = join(dir, name), cfg = authoredUnitDepthFixture(home); edit?.(cfg, home);
    const config = join(home, 'config.json'); writeFileSync(config, JSON.stringify(cfg));
    const out = join(home, 'out'); mkdirSync(join(out, 'parts'), { recursive: true });
    try {
      parseEarlyConfig(cfg, 'assemble');
      const result = assembleStage({ source: join(home, 'source.png'), full: home, head: home, config, seam: 'near-white', project: 'core' }, { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite.png'), errorMap: join(out, 'error.png') }, () => {});
      const parts = readParts(join(out, 'parts.json'));
      const raw = JSON.parse(readFileSync(join(out, 'parts.json'), 'utf8')) as { parts: Array<{ name: string; provenance?: { depth?: { kind?: string; values?: Array<{ value: number }> } } }> };
      return { result, parts, raw, config, out, errors: [] as string[] };
    } catch (error) {
      if (!(error instanceof PartsError)) throw error;
      return { result: null, parts: null, raw: null, config, out, errors: error.problems.map(p => `${p.code}: ${p.object} — ${p.detail}`) };
    }
  };
  const explicit = run('explicit');
  const p = explicit.parts?.parts.find(p => p.name === 'token');
  const provenance = explicit.raw?.parts.find(p => p.name === 'token')?.provenance?.depth;
  say('AUD01_EXPLICIT_UNIT_UNDER_ART_ASSEMBLES_WITH_AUTHORED_PROVENANCE', explicit.errors.length === 0 && p !== undefined && p.depth === undefined && provenance?.kind === 'authored-unit' && provenance.values?.some(v => v.value === 7) === true, JSON.stringify({ errors: explicit.errors, provenance }));
  const implicit = run('implicit', cfg => { delete cfg.turn!.unitDepths; });
  say('AUD02_IMPLICIT_UNIT_RETAINS_MATERIAL_REFUSAL', implicit.errors.some(e => e.startsWith('DEPTH_PART_SUPPORT:') && e.includes('token')), implicit.errors.join('; '));
  const surface = run('surface', cfg => { cfg.turn!.roles!.token = 'surface'; });
  say('AUD03_SURFACE_RETAINS_MATERIAL_REFUSAL', surface.errors.some(e => e.startsWith('DEPTH_PART_SUPPORT:') && e.includes('token')), surface.errors.join('; '));
  const passive = run('no-turn', cfg => { delete cfg.turn; delete cfg.depth; });
  say('AUD04_NO_TURN_UNDER_ART_STILL_ASSEMBLES', passive.errors.length === 0 && passive.parts?.parts.some(p => p.name === 'token' && p.depth === undefined) === true, passive.errors.join('; ') || 'no turn or depth block; native byte comparison against pinned main is performed by the measurement command');
  const value = (r: ReturnType<typeof run>) => r.raw?.parts.find(p => p.name === 'token')?.provenance?.depth?.values;
  const partWins = run('part-wins', cfg => { cfg.turn!.unitDepths = { token: 0, token_bone: -4 }; });
  say('AUD05_PART_ZERO_WINS_OVER_BONE', partWins.errors.length === 0 && JSON.stringify(value(partWins)) === JSON.stringify([{ group: 'head', value: 0 }]), JSON.stringify(value(partWins) ?? partWins.errors));
  const bone = run('bone-zero', cfg => { cfg.turn!.unitDepths = { token_bone: 0 }; cfg.regions.token = { bone: 'token_bone', gather: false }; });
  say('AUD06_DISTINCT_REGION_BONE_ZERO_RESOLVES', bone.errors.length === 0 && JSON.stringify(value(bone)) === JSON.stringify([{ group: 'head', bone: 'token_bone', value: 0 }]), JSON.stringify(value(bone) ?? bone.errors));
  const body = (cfg: CharacterConfig) => { cfg.turn = { pivot: 20, unitDepths: { token: 7 }, body: { roles: { face: 'surface', token: 'unit' } } }; };
  const inherited = run('body-inherits', body);
  say('AUD07_BODY_INHERITS_OMITTED_MAP', inherited.errors.length === 0 && JSON.stringify(value(inherited)) === JSON.stringify([{ group: 'body', value: 7 }]), JSON.stringify(value(inherited) ?? inherited.errors));
  const bodyZero = run('body-part-zero', cfg => { body(cfg); cfg.turn!.body!.unitDepths = { token: 0, token_bone: 9 }; });
  say('AUD08_BODY_MAP_REPLACES_HEAD_AND_PART_WINS', bodyZero.errors.length === 0 && JSON.stringify(value(bodyZero)) === JSON.stringify([{ group: 'body', value: 0 }]), JSON.stringify(value(bodyZero) ?? bodyZero.errors));
  const emptyBody = run('body-empty', cfg => { body(cfg); cfg.turn!.body!.unitDepths = {}; });
  say('AUD09_EMPTY_BODY_MAP_DOES_NOT_INHERIT', emptyBody.errors.some(e => e.startsWith('DEPTH_PART_SUPPORT:')), emptyBody.errors.join('; '));
  const surfaceShared = run('shared-surface', cfg => { cfg.turn!.body = { roles: { face: 'surface', token: 'surface' }, unitDepths: { token: 7 } }; });
  const implicitShared = run('shared-implicit', cfg => { cfg.turn!.body = { roles: { face: 'surface', token: 'unit' }, unitDepths: {} }; });
  say('AUD10_SHARED_SURFACE_OR_IMPLICIT_GROUP_NEVER_SKIPPED', [surfaceShared, implicitShared].every(r => r.errors.some(e => e.startsWith('DEPTH_PART_SUPPORT:'))), JSON.stringify([surfaceShared.errors, implicitShared.errors]));
  const both = run('shared-explicit', cfg => { cfg.turn!.body = { roles: { face: 'surface', token: 'unit' }, unitDepths: { token: 9 } }; });
  say('AUD11_SHARED_EXPLICIT_GROUP_VALUES_ARE_BOTH_RECORDED', both.errors.length === 0 && JSON.stringify(value(both)) === JSON.stringify([{ group: 'head', value: 7 }, { group: 'body', value: 9 }]), JSON.stringify(value(both) ?? both.errors));
  const unknown = run('unknown-name', cfg => { cfg.turn!.unitDepths = { token_typo: 7 }; });
  say('AUD12_UNKNOWN_EXPLICIT_NAME_RETAINS_NAMED_REFUSAL', unknown.errors.some(e => e.startsWith('CONFIG_NAME_RESOLVES:')), unknown.errors.join('; '));
  const unrelated = run('unrelated-bone', cfg => { cfg.turn!.unitDepths = { still_bone: 7 }; });
  say('AUD13_UNRELATED_DECLARED_BONE_IS_NOT_THE_CARRIER', unrelated.errors.some(e => e.startsWith('DEPTH_PART_SUPPORT:')), unrelated.errors.join('; '));
  const still = (cfg: CharacterConfig, home: string) => {
    cfg.motion.blink = { t: 0.5, eyes: ['token_bone'], squash: 0.1, still: { token: { row: 13, bone: 'still_bone' } } };
    const art = readPng(join(home, 'legwear.png')), painting = readPng(join(home, 'source.png'));
    for (let x = 0; x < 32; x++) { art.data[(13 * 32 + x) * 4 + 3] = 0; painting.data.set([240, 240, 240, 255], ((30 + 13) * 64 + 16 + x) * 4); }
    writePng(join(home, 'legwear.png'), art); writePng(join(home, 'source.png'), painting);
  };
  const partialStill = run('still-incomplete', (cfg, home) => { still(cfg, home); cfg.turn!.unitDepths = { token_bone: 7 }; });
  const completeStill = run('still-complete', (cfg, home) => { still(cfg, home); cfg.turn!.unitDepths = { token_bone: 7, still_bone: 0 }; });
  say('AUD14_STILL_SPLIT_REQUIRES_EVERY_BONE_UNLESS_PART_OVERRIDE', partialStill.errors.some(e => e.startsWith('DEPTH_PART_SUPPORT:')) && completeStill.errors.length === 0 && JSON.stringify(value(completeStill)) === JSON.stringify([{ group: 'head', bone: 'token_bone', value: 7 }, { group: 'head', bone: 'still_bone', value: 0 }]), JSON.stringify({ partial: partialStill.errors, complete: value(completeStill) ?? completeStill.errors }));
  const stillPart = run('still-part', (cfg, home) => { still(cfg, home); cfg.turn!.unitDepths = { token: 0, token_bone: 7 }; });
  say('AUD15_STILL_PART_OVERRIDE_COVERS_BOTH_PIECES', stillPart.errors.length === 0 && JSON.stringify(value(stillPart)) === JSON.stringify([{ group: 'head', value: 0 }]), JSON.stringify(value(stillPart) ?? stillPart.errors));
  const mesh = (cfg: CharacterConfig) => { delete cfg.regions.token; cfg.meshes.token = { grid: 8, r: 3, segments: ['head'] }; };
  const meshPart = run('mesh-part', cfg => { mesh(cfg); });
  const meshSegment = run('mesh-segment', cfg => { mesh(cfg); cfg.turn!.unitDepths = { head: 7 }; });
  say('AUD16_MESH_PART_OVERRIDE_WORKS_BUT_SEGMENT_NAME_IS_NOT_UNIT_CARRIER', meshPart.errors.length === 0 && meshSegment.errors.some(e => e.startsWith('DEPTH_PART_SUPPORT:')), JSON.stringify({ part: value(meshPart) ?? meshPart.errors, segment: meshSegment.errors }));
  const malformed = run('malformed-sheet', (_cfg, home) => { const im = readPng(join(home, 'legwear_depth.png')); im.data[1]++; writePng(join(home, 'legwear_depth.png'), im); });
  say('AUD17_INPUT_SCALAR_DIAGNOSTICS_ARE_NOT_BYPASSED', malformed.errors.some(e => e.startsWith('DEPTH_SHEET_GREYSCALE:')), malformed.errors.join('; '));
  const missing = run('missing-sheet', (_cfg, home) => { unlinkSync(join(home, 'legwear_depth.png')); });
  say('AUD22_MISSING_DECLARED_SOURCE_SHEET_STILL_REFUSES', missing.errors.some(e => e.startsWith('DEPTH_SHEET_PRESENT:')), missing.errors.join('; '));
  const rear = run('shared-rear', cfg => { cfg.turn!.body = { roles: { face: 'surface', token: 'rear' } }; });
  say('AUD23_SHARED_REAR_ROLE_IS_NOT_A_FULLY_EXPLICIT_UNIT', rear.errors.some(e => e.startsWith('DEPTH_PART_SUPPORT:')), rear.errors.join('; '));
  const wrongValue = run('nonfinite-value', cfg => { cfg.turn!.unitDepths = { token: NaN }; });
  say('AUD18_INVALID_EXPLICIT_VALUE_IS_NOT_SILENTLY_SAMPLED', wrongValue.errors.some(e => e.startsWith('CONFIG_FIELD_TYPE:')), wrongValue.errors.join('; '));
  if (explicit.parts !== null) {
    const file = join(dir, 'roundtrip.json'); writeParts(file, explicit.parts);
    say('AUD19_AUTHORED_PROVENANCE_EXACT_READER_WRITER_ROUNDTRIP', serializeParts(readParts(file)) === serializeParts(explicit.parts), 'optional authored-unit values survive canonical serialization');
    const plants: Array<[string, (raw: Record<string, unknown>) => void]> = [
      ['wrong kind', d => { d.kind = 'sampled'; }], ['empty values', d => { d.values = []; }],
      ['nonfinite', d => { d.values = [{ group: 'head', value: null }]; }],
      ['wrong group', d => { d.values = [{ group: 'other', value: 7 }]; }],
      ['unknown field', d => { d.invented = true; }],
      ['empty bone', d => { d.values = [{ group: 'head', bone: '', value: 7 }]; }],
      ['duplicate', d => { d.values = [{ group: 'head', value: 7 }, { group: 'head', value: 7 }]; }],
      ['part plus bone', d => { d.values = [{ group: 'head', value: 7 }, { group: 'head', bone: 'token_bone', value: 7 }]; }],
    ];
    const refused = plants.map(([name, plant]) => {
      const raw = JSON.parse(serializeParts(explicit.parts!)) as { parts: Array<{ name: string; provenance: { depth: Record<string, unknown> } }> };
      plant(raw.parts.find(p => p.name === 'token')!.provenance.depth); writeFileSync(file, JSON.stringify(raw));
      try { readParts(file); return { name, refused: false }; } catch (error) { if (!(error instanceof PartsError)) throw error; return { name, refused: error.problems.some(p => p.code === 'PARTS_FIELD_TYPE') }; }
    });
    say('AUD20_MALFORMED_AUTHORED_PROVENANCE_PLANTS_REFUSED', refused.every(r => r.refused), JSON.stringify(refused));
    const collision = JSON.parse(serializeParts(explicit.parts)) as { parts: Array<Record<string, unknown>> };
    collision.parts.find(p => p.name === 'token')!.depth = explicit.parts.parts.find(p => p.name === 'face')!.depth;
    writeFileSync(file, JSON.stringify(collision));
    let collisionRefused = false;
    try { readParts(file); } catch (error) { if (!(error instanceof PartsError)) throw error; collisionRefused = error.problems.some(p => p.code === 'PARTS_FIELD_TYPE'); }
    say('AUD24_AUTHORED_AND_TRANSPORTED_DEPTH_CANNOT_BOTH_BE_RECORDED', collisionRefused, 'each individual reference is valid; their coexistence is refused');
    const inputs = readRigInputs(explicit.config, explicit.out), rig = buildRig(inputs.cfg, inputs.parts, inputs.images);
    const animation = rig.motion.animations.turn as { tracks: Array<{ group?: string; keys: Array<{ derive?: { depth?: Record<string, number> } }> }> };
    const depths = animation.tracks.find(t => t.group === 'turn_units')?.keys[0].derive?.depth;
    say('AUD21_RIG_USES_EXPLICIT_VALUE_WITHOUT_OWN_SHEET', depths?.token_bone === 7 && !rig.depthReferences?.some(d => d.part === 'token'), JSON.stringify(depths));
  } else {
    say('AUD19_AUTHORED_PROVENANCE_EXACT_READER_WRITER_ROUNDTRIP', false, 'explicit assembly unavailable');
    say('AUD20_MALFORMED_AUTHORED_PROVENANCE_PLANTS_REFUSED', false, 'explicit assembly unavailable');
    say('AUD24_AUTHORED_AND_TRANSPORTED_DEPTH_CANNOT_BOTH_BE_RECORDED', false, 'explicit assembly unavailable');
    say('AUD21_RIG_USES_EXPLICIT_VALUE_WITHOUT_OWN_SHEET', false, 'explicit assembly unavailable');
  }

}
