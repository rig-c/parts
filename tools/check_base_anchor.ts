/** Generated rectangles: explicit region anchors never infer or rewrite source art. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeAlternateCutLayerFixture } from '../fixtures/alternate_cut_layers.ts';
import { assembleLayerFixture } from './check_alternate_layers.ts';
import { loadConfig, parseConfig, parseEarlyConfig } from '../src/config.ts';
import { readRigInputs, gateThroughRigc, rigOutputTexts } from '../src/build.ts';
import { buildRig, rigJsonText, type RigOutput, type RegionAttachment } from '../src/rig.ts';
import { serializeParts, readParts } from '../src/parts.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { PartsError } from '../src/errors.ts';
import { baseAnchoredReference, flatCompositeForSet, type RigcRunner } from '../src/check.ts';
import { baseAnchorMoves } from '../src/baseanchor.ts';
import { computeExactFrameTransforms } from '../src/coords.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
const refused = (fn: () => unknown): string => { try { fn(); return ''; } catch (e) { if (!(e instanceof PartsError)) throw e; return e.message; } };
export function runBaseAnchorChecks(dir: string, say: Say, runner?: RigcRunner): void {
  const regionSkin = (r: RigOutput): Record<string, Record<string, RegionAttachment>> => r.rig.skins.default as Record<string, Record<string, RegionAttachment>>;
  writeAlternateCutLayerFixture(dir);
  const path = join(dir, 'config.json'), cfg = loadConfig(path), alt = cfg.assemble.alternates![0];
  cfg.assemble.patches = [{ name: 'badge', box: [18, 20, 26, 28], alpha: 'box', draw: 'front' }];
  cfg.regions.badge = 'anchor'; alt.parts!.push('badge'); alt.layers = { sleeve: 'author:raised' };
  const save = (): void => writeFileSync(path, JSON.stringify(cfg));
  save(); const plain = assembleLayerFixture(dir, 'plain'), source = readRigInputs(path, plain);
  const normal = buildRig(source.cfg, source.parts, source.images);
  const sleeve = regionSkin(normal).sleeve;
  say('NORMAL_ART_MEASURED_CONTROL', sleeve.raised_sleeve.x !== sleeve.sleeve.x && !('base_anchor' in normal.sets!.sets.raised), `base ${sleeve.sleeve.x}, art ${sleeve.raised_sleeve.x}`);
  const inputHash = createHash('sha256').update(serializeParts(source.parts)).digest('hex');
  alt.base_anchor = { sleeve: { axes: ['x'], paired: ['badge'] } }; save();
  say('BOTH_CONFIG_DOORS_ACCEPT_BASE_ANCHOR', refused(() => parseConfig(cfg)) === '' && refused(() => parseEarlyConfig(cfg, 'assemble')) === '', 'explicit local x; y is art-measured');
  const out = assembleLayerFixture(dir, 'anchored'), input = readRigInputs(path, out);
  const built = buildRig(input.cfg, input.parts, input.images), skin = regionSkin(built);
  const dx = skin.sleeve.sleeve.x - sleeve.raised_sleeve.x;
  say('REGION_USES_BASE_X_AND_KEEPS_ART_Y', skin.sleeve.raised_sleeve.x === skin.sleeve.sleeve.x && skin.sleeve.raised_sleeve.y === sleeve.raised_sleeve.y, JSON.stringify(skin.sleeve));
  say('PAIRED_PATCH_TAKES_SAME_DISPLACEMENT', skin.badge.raised_badge.x - regionSkin(normal).badge.raised_badge.x === dx, `owner dx ${dx}, patch dx ${skin.badge.raised_badge.x - regionSkin(normal).badge.raised_badge.x}`);
  say('PIXELS_AND_SOURCE_BOXES_UNCHANGED', JSON.stringify(source.parts.alternates![0].records) === JSON.stringify(input.parts.alternates![0].records) && [...source.images].every(([name, image]) => Buffer.from(image.data).equals(Buffer.from(input.images.get(name)!.data))), 'only explicit placement metadata changes in parts.json');
  const mutated = structuredClone(input.parts); mutated.parts.find(p => p.name === 'sleeve')!.x += 3;
  const moved = buildRig(input.cfg, mutated, input.images);
  say('BASE_OFFSET_MUTANT_MOVES_RAISED_SLEEVE_BY_NAME', regionSkin(moved).sleeve.raised_sleeve.x - skin.sleeve.raised_sleeve.x === 3, `raised_sleeve: ${skin.sleeve.raised_sleeve.x} -> ${regionSkin(moved).sleeve.raised_sleeve.x}`);
  say('BASE_OFFSET_MUTANT_MOVES_PAIRED_BADGE_BY_NAME', regionSkin(moved).badge.raised_badge.x - skin.badge.raised_badge.x === 3, 'raised_badge follows the same +3 u shift');
  say('RECORDED_DIRECTIVE_AND_SETS_PROVENANCE', JSON.stringify(readParts(join(out, 'parts.json')).alternates![0].base_anchor) === JSON.stringify(built.sets!.sets.raised.base_anchor), 'assemble record and final sets carry the explicit mode');
  for (const [i, value] of [null, { sleeve: { axes: null } }, { sleeve: null }].entries()) {
    for (const side of ['record', 'config', 'both'] as const) {
      const directConfig = structuredClone(input.cfg), directParts = structuredClone(input.parts);
      if (side !== 'record') (directConfig.assemble.alternates![0] as unknown as Record<string, unknown>).base_anchor = value;
      if (side !== 'config') (directParts.alternates![0] as unknown as Record<string, unknown>).base_anchor = value;
      const message = refused(() => buildRig(directConfig, directParts, input.images));
      say(`DIRECT_${side.toUpperCase()}_MALFORMED_${i}_NAMED`, message.includes('RIG_ALT_BASE_ANCHOR') && (side === 'record' || message.includes('config alternate set')) && (side === 'config' || message.includes('parts.json alternate set')), message);
    }
  }
  const stale = structuredClone(input.cfg); delete stale.assemble.alternates![0].base_anchor;
  say('STALE_DIRECTIVE_REFUSED', refused(() => buildRig(stale, input.parts, input.images)).includes('RIG_ALT_BASE_ANCHOR_MATCH_CONFIG'), 'removing a declaration requires re-assemble');
  const malformed: unknown[] = [null, {}, { sleeve: { axes: [] } }, { sleeve: { axes: ['z'] } }, { sleeve: { axes: ['x', 'x'] } }, { absent: { axes: ['x'] } }, { skirt: { axes: ['x'] } }, { sleeve: { axes: ['x'], paired: ['body'] } }, { sleeve: { axes: ['x'], paired: ['badge', 'badge'] } }, { sleeve: { axes: ['x'], mode: 'guess' } }];
  for (const [i, value] of malformed.entries()) {
    const raw = structuredClone(cfg) as unknown as { assemble: { alternates: Record<string, unknown>[] } }; raw.assemble.alternates[0].base_anchor = value;
    say('NAMED_CONFIG_REFUSAL_' + i, [() => parseConfig(raw), () => parseEarlyConfig(raw, 'assemble')].every(fn => refused(fn).includes('CONFIG_SET_BASE_ANCHOR')), 'full and early doors refuse malformed/uncovered/nonregion/nonpatch declarations');
  }
  const hidden = structuredClone(cfg); hidden.assemble.alternates![0].hides = ['badge'];
  say('HIDDEN_PAIRED_PATCH_REFUSED', refused(() => parseConfig(hidden)).includes('CONFIG_SET_BASE_ANCHOR'), 'a hidden patch is never silently moved');
  const badRecord = JSON.parse(serializeParts(input.parts)); badRecord.alternates[0].base_anchor = { sleeve: { axes: ['z'] } };
  const invalid = join(dir, 'invalid-parts.json'); writeFileSync(invalid, JSON.stringify(badRecord));
  say('SERIALIZED_BAD_DIRECTIVE_REFUSED', refused(() => readParts(invalid)).includes('PARTS_ALT_BASE_ANCHOR'), 'serialized provenance is validated too');
  const both = structuredClone(input.cfg); both.assemble.alternates![0].base_anchor!.sleeve.axes = ['x', 'y'];
  const bothParts = structuredClone(input.parts); bothParts.alternates![0].base_anchor = both.assemble.alternates![0].base_anchor;
  const xy = buildRig(both, bothParts, input.images);
  say('EXPLICIT_BOTH_AXES_INHERITED', regionSkin(xy).sleeve.raised_sleeve.x === skin.sleeve.sleeve.x && regionSkin(xy).sleeve.raised_sleeve.y === skin.sleeve.sleeve.y, 'full base placement requires both axes explicitly');
  const reference = baseAnchoredReference(input.parts, input.parts.alternates![0], built.rig as unknown as Record<string, unknown>);
  const record = input.parts.alternates![0].records.find(p => p.name === 'sleeve')!;
  say('CHECK_REFERENCE_DERIVED_FROM_BASE_RULE', Math.abs(reference.records.find(p => p.name === 'sleeve')!.x - record.x - dx) < 1e-6, 'expected source placement follows declaration, not candidate alternate x');
  const corrupt = structuredClone(built.rig); (corrupt.skins.default.sleeve.raised_sleeve as RegionAttachment).x += 7;
  say('CANDIDATE_OFFSET_MUTANT_CANNOT_MOVE_REFERENCE', JSON.stringify(baseAnchoredReference(input.parts, input.parts.alternates![0], corrupt as unknown as Record<string, unknown>)) === JSON.stringify(reference), 'a wrongly shifted candidate does not launder its own seam reference');
  const fractional = structuredClone(built.rig); (fractional.skins.default.sleeve.sleeve as RegionAttachment).x += .25;
  const fractionalReference = baseAnchoredReference(input.parts, input.parts.alternates![0], fractional as unknown as Record<string, unknown>);
  say('SUBPIXEL_REFERENCE_RENDERS_WITHOUT_PIXEL_EDITS', flatCompositeForSet(input.parts, fractionalReference, join(out, 'parts'), [255, 255, 255, 255]).data.length === input.parts.rig_size[0] * input.parts.rig_size[1] * 4, 'bilinear premultiplied reference only; source PNG unchanged');
  const frames = computeExactFrameTransforms([{name:'root'}, {name:'owner', parent:'root', rotation:90}, {name:'patch', parent:'root'}]);
  const rotated = baseAnchorMoves({owner:{axes:['x'],paired:['patch']}}, new Map([['owner',{bone:'owner',x:3,y:0}]]), new Map([['owner',{bone:'owner',x:1,y:0}],['patch',{bone:'patch',x:0,y:0}]]), frames);
  say('PAIRED_PATCH_USES_WORLD_DELTA_ACROSS_BONES', Math.abs(rotated.get('patch')!.local[0]) < 1e-6 && Math.abs(rotated.get('patch')!.local[1]-2)<1e-6, 'owner local +2x at 90 degrees moves unturned patch +2y');
  if (runner !== undefined) {
    const gate = gateThroughRigc(built.images.map(([n, image]) => [n, encodePngBytes(image)] as const), rigOutputTexts(built, null), runner, join(dir, 'core-gate'), null);
    say('ANCHORED_REGION_REAL_CORE_GATE', gate.length > 0 && gate.every(g => g.status === 0), JSON.stringify(gate.map(g => ({ status: g.status, lines: g.lines }))));
  }
  say('SOURCE_CONTROL_RESTORED_IN_MEMORY', inputHash === createHash('sha256').update(serializeParts(source.parts)).digest('hex') && readFileSync(join(plain, 'parts.json')).length > 0, 'mutants use deep copies, source buffers and records never change');
}
