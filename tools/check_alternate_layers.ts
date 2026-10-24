/** Reader-validated source controls, with normal/defect/edge cases before pixel readings. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAlternateLayerFixture, raisedArmLayer } from '../fixtures/alternate_layers.ts';
import { writeRun, C, type RunLayerSpec } from '../fixtures/assemble_fixture.ts';
import { writeFootOwnershipFixture } from '../fixtures/foot_ownership.ts';
import { writeSubsetCoverFixture } from '../fixtures/subset_cover.ts';
import { assembleStage } from '../src/build.ts';
import { loadConfig, parseConfig, parseEarlyConfig, type CharacterConfig } from '../src/config.ts';
import { readLayers } from '../src/layers.ts';
import { readParts } from '../src/parts.ts';
import { readPng, encodePngBytes } from '../src/raster/png.ts';
import { alternateLayerSources } from '../src/alternatelayers.ts';
import { PartsError } from '../src/errors.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
const save = (path: string, value: unknown): void => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
function refused(run: () => unknown): string {
  try { run(); return ''; } catch (e) { if (e instanceof PartsError) return e.message; throw e; }
}
export function assembleLayerFixture(dir: string, name: string): string {
  const out = join(dir, name);
  assembleStage({ source: join(dir, 'painting.png'), full: join(dir, 'full'), head: join(dir, 'head'), config: join(dir, 'config.json'), seam: 'near-white', project: 'core' },
    { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, 'recomposite_error_rig.png') }, () => {});
  return out;
}
const override = (cfg: CharacterConfig): void => { cfg.assemble.alternates![0].layers = { upperarm_r: 'author:raised', forearm_r: 'author:raised' }; };
const samePngs = (a: string, b: string): boolean => readdirSync(join(a, 'parts')).every(n => readFileSync(join(a, 'parts', n)).equals(readFileSync(join(b, 'parts', n))));
export function runAlternateLayerChecks(dir: string, say: Say): void {
  const make = (name: string): { d: string; cfg: CharacterConfig } => {
    const d = join(dir, name); writeAlternateLayerFixture(d); return { d, cfg: loadConfig(join(d, 'config.json')) };
  };
  const f = make('raised');
  const read = readLayers(join(f.d, 'step'));
  say('NORMAL_REAL_READERS', read.layers.some(l => l.name === 'author:raised' && l.opaquePx > 0) && parseEarlyConfig(f.cfg, 'assemble') !== null, 'full config, early config and wrapper layer readers accept the public generated controls');
  const defect = refused(() => assembleLayerFixture(f.d, 'defect'));
  say('DEFECT_WRONG_TAG_JOINT_REFUSAL', defect.includes('ASSEMBLE_LIMB_JOINT_ON_ART') && defect.includes('alternate set "raised"') && !existsSync(join(f.d, 'defect')), defect);
  const author = raisedArmLayer();
  writeRun(join(f.d, 'step'), [{ ...author, name: 'handwear-r' }, author]);
  const canonical = assembleLayerFixture(f.d, 'canonical');
  say('NORMAL_DOCUMENTED_SOURCE_CONTROL', readParts(join(canonical, 'parts.json')).alternates![0].records.length === 2, 'the same pixels under the planned tag assemble on the current toolchain');
  const untouched = readFileSync(join(f.d, 'config.json'), 'utf8');
  const empty = structuredClone(f.cfg); empty.assemble.alternates![0].layers = {}; save(join(f.d, 'config.json'), empty);
  const emptyOut = assembleLayerFixture(f.d, 'empty');
  say('EDGE_EMPTY_MAP_BYTE_IDENTICAL', samePngs(canonical, emptyOut) && readFileSync(join(canonical, 'parts.json')).equals(readFileSync(join(emptyOut, 'parts.json'))), 'empty selection is byte-identical to absent selection');
  writeFileSync(join(f.d, 'config.json'), untouched);
  const absentAgain = assembleLayerFixture(f.d, 'absent-again');
  say('EDGE_ABSENT_FIELD_BYTE_IDENTICAL', samePngs(canonical, absentAgain) && readFileSync(join(canonical, 'parts.json')).equals(readFileSync(join(absentAgain, 'parts.json'))), 'no new output key or pixel without layers');
  const wrong: RunLayerSpec = { name: 'handwear-r', depth: 0.6, rects: [{ x0: 48, y0: 16, x1: 56, y1: 56, colour: C }] };
  writeRun(join(f.d, 'step'), [wrong, author]); override(f.cfg); save(join(f.d, 'config.json'), f.cfg);
  say('BOTH_CONFIG_DOORS_ACCEPT', refused(() => parseConfig(f.cfg)) === '' && refused(() => parseEarlyConfig(f.cfg, 'assemble')) === '', 'per covered segment author layer names');
  const out = assembleLayerFixture(f.d, 'selected'), parts = readParts(join(out, 'parts.json'));
  const alt = parts.alternates![0], lower = alt.records.find(p => p.name === 'forearm_r')!;
  const png = readPng(join(out, 'parts', 'raised_forearm_r.png'));
  // The source strip and angle are defined above, before this reading; the
  // canonical tag replacement is the independently assembled pixel reference.
  say('AUTHOR_PIXELS_AT_DRAWN_ANGLE', samePngs(out, canonical) && lower.from === 'full:author:raised' && lower.w > 8 && lower.h > 8 && png.data.some((v, i) => i % 4 === 3 && v > 8), JSON.stringify({ from: lower.from, box: [lower.x, lower.y, lower.w, lower.h], drawn: alt.drawn }));
  say('BASE_PLAN_AND_OUTPUT_UNCHANGED', JSON.stringify(f.cfg.assemble.plan) === JSON.stringify([['sleeve', 'full', 'handwear-r']]) && JSON.stringify(parts.parts) === JSON.stringify(readParts(join(canonical, 'parts.json')).parts), 'only alternate source provenance changes');
  say('CAP_SELECTED_SOURCE_LEDGER', JSON.stringify(lower.limb?.cap) === JSON.stringify(readParts(join(canonical, 'parts.json')).alternates![0].records.find(p => p.name === 'forearm_r')!.limb?.cap), JSON.stringify(lower.limb?.cap));
  const missing = structuredClone(f.cfg); missing.assemble.alternates![0].layers!.forearm_r = 'author:absent'; save(join(f.d, 'config.json'), missing);
  const missingError = refused(() => assembleLayerFixture(f.d, 'missing'));
  say('MISSING_AUTHOR_NAMED_NO_OUTPUT', missingError.includes('ASSEMBLE_ALT_INPUT_PRESENT') && missingError.includes('author:absent') && !existsSync(join(f.d, 'missing')), missingError);
  for (const [name, value] of [['NULL', null], ['ARRAY', []], ['NUMBER', 4], ['UNKNOWN_PART', { absent: 'author:raised' }], ['SOURCE_NOT_COVERED', { sleeve: 'author:raised' }], ['BAD_LAYER', { forearm_r: 'author:' }], ['SLASH', { forearm_r: 'author:a/b' }], ['UNKNOWN_TAG', { forearm_r: 'missing-tag' }], ['NONSTRING', { forearm_r: 9 }]] as const) {
    const raw = structuredClone(f.cfg) as unknown as { assemble: { alternates: Array<Record<string, unknown>> } }; raw.assemble.alternates[0].layers = value;
    const a = refused(() => parseConfig(raw)), b = refused(() => parseEarlyConfig(raw, 'assemble'));
    say('BOTH_DOORS_REFUSE_' + name, a.includes('layers') && b.includes('layers'), a + '; ' + b);
  }
  const hidden = structuredClone(f.cfg); delete hidden.assemble.alternates![0].parts; hidden.assemble.alternates![0].hides = ['upperarm_r', 'forearm_r'];
  say('HIDDEN_TARGET_REFUSED', refused(() => parseConfig(hidden)).includes('CONFIG_SET_LAYERS'), 'layers cannot select hidden output');
  const tag = structuredClone(f.cfg); tag.assemble.alternates![0].layers = { upperarm_r: 'handwear-r', forearm_r: 'handwear-r' };
  say('NAMED_TAG_SELECTION_ACCEPTED', refused(() => parseConfig(tag)) === '', 'the existing layer-name grammar includes public tags');
  // Mixed choices: the tag holds only upper art; the lower must be cut out
  // of the complete author arm, not emitted as that entire arm.
  writeRun(join(f.d, 'step'), [{ name: 'handwear-r', depth: 0.6, rects: [author.rects[0]] }, author]);
  const mixed = structuredClone(f.cfg); mixed.assemble.alternates![0].layers = { forearm_r: 'author:raised' }; save(join(f.d, 'config.json'), mixed);
  const mixedOut = assembleLayerFixture(f.d, 'mixed'), mp = readParts(join(mixedOut, 'parts.json')).alternates![0].records;
  say('MIXED_SOURCE_RETAINS_LOGICAL_JOINT_CUT', readFileSync(join(mixedOut, 'parts', 'raised_forearm_r.png')).equals(readFileSync(join(canonical, 'parts', 'raised_forearm_r.png'))) && mp.find(p => p.name === 'upperarm_r')!.from === 'full:handwear-r' && mp.find(p => p.name === 'forearm_r')!.limb?.of === 'sleeve', JSON.stringify(mp.map(p => ({ name: p.name, from: p.from, of: p.limb?.of, box: [p.x, p.y, p.w, p.h] }))));
  const plan = mixed.assemble.plan, limbs = mixed.limbs!;
  const before = JSON.stringify({ plan, limbs }); alternateLayerSources(plan, [], limbs, new Set(['upperarm_r', 'forearm_r']), mixed.assemble.alternates![0].layers);
  say('SELECTOR_PRESERVES_CALLER_INPUT', before === JSON.stringify({ plan, limbs }), 'no base-plan or source-limb mutation');

  for (const name of ['constructor', 'toString', '__proto__']) {
    const selected = alternateLayerSources([[name, 'full', 'topwear'], ['other', 'full', 'neck']], [], {}, new Set([name, 'other']), { other: 'author:other' });
    say('INHERITED_NAME_' + name.toUpperCase(), selected.plan[0][2] === 'topwear' && selected.plan[1][2] === 'author:other', 'only own map entries select layers; inherited JavaScript properties are not authored choices');
  }
  const ordered = alternateLayerSources(f.cfg.assemble.plan, [], f.cfg.limbs!, new Set(['upperarm_r', 'forearm_r']), { upperarm_r: 'author:raised', forearm_r: 'handwear-r' });
  const reversed = alternateLayerSources(f.cfg.assemble.plan, [], f.cfg.limbs!, new Set(['upperarm_r', 'forearm_r']), { forearm_r: 'handwear-r', upperarm_r: 'author:raised' });
  say('MAP_KEY_ORDER_DOES_NOT_CHANGE_SOURCES', JSON.stringify(ordered) === JSON.stringify(reversed) && JSON.stringify([...ordered.groups]) === JSON.stringify([...reversed.groups]), 'source identity follows plan/segment order');
  writeRun(join(f.d, 'step'), [author]); save(join(f.d, 'config.json'), f.cfg);
  const authorOnly = assembleLayerFixture(f.d, 'author-only');
  say('REPLACED_TAG_NOT_REQUIRED', samePngs(authorOnly, out), 'a fully overridden alternate does not require the original tag to exist');
  writeRun(join(f.d, 'step'), [wrong, author]);
  const emptyFile = readLayers(join(f.d, 'step')).layers.find(l => l.name === 'author:raised')!.file!;
  const transparent = readPng(emptyFile); transparent.data.fill(0); writeFileSync(emptyFile, encodePngBytes(transparent));
  readLayers(join(f.d, 'step'));
  const emptyAuthor = refused(() => assembleLayerFixture(f.d, 'empty-author'));
  say('EMPTY_AUTHOR_NAMED_NO_OUTPUT', emptyAuthor.includes('ASSEMBLE_ALT_INPUT_PRESENT') && emptyAuthor.includes('author:raised') && emptyAuthor.includes('0 opaque pixels') && !existsSync(join(f.d, 'empty-author')), emptyAuthor);

  // Existing source-bound rules must still read the selected author layer.
  for (const layout of ['islands', 'connected'] as const) {
    const d = join(dir, layout); writeFootOwnershipFixture(d, layout);
    const original = assembleLayerFixture(d, 'original'), cfg = loadConfig(join(d, 'config.json'));
    const run = readLayers(join(d, 'step'));
    // Add author copies through the actual wrapper format; preserve canvas/bboxes.
    const manifest = JSON.parse(readFileSync(join(d, 'step', 'layers.json'), 'utf8')) as { layers: Array<Record<string, unknown>> };
    const source = manifest.layers.find(l => l.name === 'footwear')!;
    writeFileSync(join(d, 'step', 'author_shoes.png'), readFileSync(run.layers.find(l => l.name === 'footwear')!.file!));
    manifest.layers.push({ ...source, name: 'author:shoes', filename: 'author_shoes.png', depth_median: 0.39 }); save(join(d, 'step', 'layers.json'), manifest);
    readLayers(join(d, 'step'));
    for (const a of cfg.assemble.alternates!) a.layers = Object.fromEntries(a.parts!.filter(p => p.startsWith('foot_')).map(p => [p, 'author:shoes']));
    save(join(d, 'config.json'), cfg); const selected = assembleLayerFixture(d, 'selected');
    say(layout.toUpperCase() + '_OWNERSHIP_SAME_PIXELS', samePngs(original, selected) && run.layers.some(l => l.name === 'footwear'), 'author source follows existing island/source-segment/cap ownership rules');
    const limbSource = manifest.layers.find(l => l.name === 'legwear')!;
    writeFileSync(join(d, 'step', 'author_legs.png'), readFileSync(run.layers.find(l => l.name === 'legwear')!.file!));
    manifest.layers.push({ ...limbSource, name: 'author:legs', filename: 'author_legs.png', depth_median: 0.58 }); save(join(d, 'step', 'layers.json'), manifest); readLayers(join(d, 'step'));
    for (const a of cfg.assemble.alternates!) a.layers = { ...a.layers, [a.name === 'step_r' ? 'shin_r' : 'shin_l']: 'author:legs' };
    save(join(d, 'config.json'), cfg); const sharedMixed = assembleLayerFixture(d, 'shared-mixed');
    say(layout.toUpperCase() + '_MIXED_SHARED_OWNERSHIP_SAME_PIXELS', samePngs(original, sharedMixed), 'mixed layers preserve the other limb ownership, islands and cap routing');

  }
  const d = join(dir, 'exclusion'); writeSubsetCoverFixture(d); const original = assembleLayerFixture(d, 'original');
  const cfg = loadConfig(join(d, 'config.json')), manifest = JSON.parse(readFileSync(join(d, 'step', 'layers.json'), 'utf8')) as { layers: Array<Record<string, unknown>> };
  writeFileSync(join(d, 'step', 'author_leg.png'), readFileSync(readLayers(join(d, 'step')).layers.find(l => l.name === 'legwear')!.file!));
  manifest.layers.push({ ...manifest.layers.find(l => l.name === 'legwear')!, name: 'author:leg', filename: 'author_leg.png', depth_median: 0.59 }); save(join(d, 'step', 'layers.json'), manifest); readLayers(join(d, 'step'));
  cfg.assemble.alternates![0].layers = { thigh: 'author:leg', shin: 'author:leg' }; save(join(d, 'config.json'), cfg);
  const selected = assembleLayerFixture(d, 'selected');
  say('BASE_EXCLUSION_SAME_PIXELS', samePngs(original, selected), 'selected author limb retains base-cover exclusion');
}
