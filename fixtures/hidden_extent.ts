/** Generated source material for the enclosed-hole refusal, with independently counted rectangles. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assemble, DEFAULT_SEAM_RULE, stageFields, type AssembleInput, type AssembleResult } from '../src/assemble.ts';
import { assembleStage } from '../src/build.ts';
import { parseConfig, parseEarlyConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { exportLayers, type LayerSet } from '../src/layers.ts';
import { serializeParts } from '../src/parts.ts';
import { writePng } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
import { readLayerTag } from '../src/tags.ts';
import { assembleConfig } from './assemble_fixture.ts';

interface FixtureOptions {
  absent: boolean;
  soft: boolean;
  alpha?: number;
  openEdge?: boolean;
}

export function hiddenExtentFixture(options: FixtureOptions): AssembleInput {
  const width = 128, height = 128;
  const behind = newRaster(width, height), front = newRaster(width, height);
  for (let y = 16; y < 112; y++) for (let x = 16; x < 112; x++) {
    const covered = x >= 48 && x < 80 && y >= 32 && y < 96;
    let alpha = 255;
    if (covered) alpha = options.alpha ?? (options.absent ? 0 : y < 54 ? 255 : y < 75 ? 128 : 9);
    // A separate boundary control connects the cavity to the exterior and retains one cover column.
    if (options.openEdge && x === 48 && y >= 32 && y < 96) alpha = 255;
    if (options.openEdge && y === 64 && x >= 80) alpha = 0;
    behind.data.set([60, 100, 160, alpha], (y * width + x) * 4);
  }
  for (let y = 32; y < 96; y++) for (let x = 48; x < 80; x++) front.data.set([180, 60, 40, options.soft ? 128 : 255], (y * width + x) * 4);
  const entries = [
    { name: 'face', pixels: newRaster(width, height) },
    { name: 'eyewhite-r', pixels: newRaster(width, height) },
    { name: 'eyewhite-l', pixels: newRaster(width, height) },
    { name: 'author:behind', pixels: behind },
    { name: 'author:front', pixels: front },
  ];
  for (let k = 0; k < 3; k++) for (let y = 2; y < 10; y++) for (let x = 2 + k * 12; x < 10 + k * 12; x++) entries[k].pixels.data.set([90, 90, 90, 255], (y * width + x) * 4);
  const layers: LayerSet['layers'] = entries.map(({ name, pixels }, drawOrder) => {
    const tag = readLayerTag(name);
    if (tag === null) throw new Error('Generated fixture tag does not resolve');
    let opaquePx = 0;
    for (let p = 3; p < pixels.data.length; p += 4) if (pixels.data[p] > 8) opaquePx++;
    return { name, tag, pixels, file: null, left: 0, top: 0, right: width, bottom: height, depth: null, drawOrder, opaquePx };
  });
  const full: LayerSet = { form: 'wrapper', source: 'generated-swing', canvas: { w: width, h: height }, layers, hidden: [] };
  const source = newRaster(width, height);
  source.data.fill(255);
  for (const layer of layers) for (let p = 0; p < width * height; p++) {
    const alpha = layer.pixels.data[p * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) source.data[p * 4 + c] = Math.round(layer.pixels.data[p * 4 + c] * alpha + source.data[p * 4 + c] * (1 - alpha));
  }
  return { source, full, head: full, resolution: 128, headBox: [0, 0, 128, 128], rigScale: 1, single: true,
    plan: [['face', 'full', 'face'], ['eye_r', 'full', 'eyewhite-r'], ['eye_l', 'full', 'eyewhite-l'], ['behind', 'full', 'author:behind'], ['front', 'full', 'author:front']],
    extend: [], patches: [], cuts: [], seamRule: DEFAULT_SEAM_RULE, projectRule: 'visible' };
}

export function hiddenExtentConfig(declaration: unknown): Record<string, unknown> {
  const input = hiddenExtentFixture({ absent: false, soft: false });
  const cfg = assembleConfig({ plan: input.plan, extend: [], headBox: input.headBox, resolution: input.resolution, rigScale: input.rigScale });
  delete (cfg.seethrough as Record<string, unknown>).head_box;
  return { ...cfg, assemble: { ...(cfg.assemble as object), require_hidden_extent: declaration } };
}

function problems(run: () => unknown): PartsError | null {
  try { run(); return null; } catch (error) {
    if (error instanceof PartsError) return error;
    throw error;
  }
}

const DECLARATION = [{ part: 'behind', occluder: 'front' }];
type Say = (name: string, pass: boolean, detail: string) => void;

export function runHiddenExtentConfigChecks(say: Say): void {
  const doors = [parseConfig, (raw: Record<string, unknown>) => parseEarlyConfig(raw, 'assemble'), (raw: Record<string, unknown>) => parseEarlyConfig(raw, 'layers')];
  say('CF1047_SOURCE_PAIR_READS_AT_EVERY_DOOR', doors.every(read => JSON.stringify(read(hiddenExtentConfig(DECLARATION)).assemble.require_hidden_extent) === JSON.stringify(DECLARATION)), 'full, assemble and layers retain the directed source pair');
  const invalid = [
    { value: true, code: 'CONFIG_FIELD_TYPE' },
    { value: [{}], code: 'CONFIG_FIELD_PRESENT' },
    { value: [{ part: 1, occluder: 'front' }], code: 'CONFIG_FIELD_TYPE' },
    { value: [{ part: 'behind', occluder: 'front', extra: true }], code: 'CONFIG_KEY_KNOWN' },
    { value: [...DECLARATION, ...DECLARATION], code: 'CONFIG_PART_UNIQUE' },
    { value: [{ part: 'behind', occluder: 'behind' }], code: 'CONFIG_HIDDEN_EXTENT_ORDER' },
  ];
  say('CF1047_DECLARATION_SHAPES_HAVE_NAMED_REFUSALS', invalid.every(({ value, code }) => doors.every(read => problems(() => read(hiddenExtentConfig(value)))?.problems.some(p => p.code === code))), 'shape, missing field, type, extra field, duplicate and self controls');
  const scoped = [
    { value: [{ part: 'absent', occluder: 'front' }], code: 'CONFIG_NAME_RESOLVES' },
    { value: [{ part: 'front', occluder: 'behind' }], code: 'CONFIG_HIDDEN_EXTENT_ORDER' },
  ];
  say('CF1047_SOURCE_NAMES_AND_ORDER_RESOLVE', scoped.every(({ value, code }) => doors.slice(0, 2).every(read => problems(() => read(hiddenExtentConfig(value)))?.problems.some(p => p.code === code))), 'unknown source and reversed source-family order refused at the full and assemble doors');
}

function alphaAt(result: AssembleResult, name: string, x: number, y: number): number {
  const part = result.images.find(p => p.record.name === name);
  if (part === undefined) throw new Error('Generated part missing');
  const rx = x - part.record.x, ry = y - part.record.y;
  return rx < 0 || ry < 0 || rx >= part.image.width || ry >= part.image.height ? 0 : part.image.data[(ry * part.image.width + rx) * 4 + 3];
}

export function runHiddenExtentChecks(dir: string, say: Say): void {
  for (const soft of [false, true]) {
    const input = hiddenExtentFixture({ absent: true, soft });
    const emitted = assemble(input);
    let exposed = 0;
    for (let y = 32; y < 96; y++) for (let x = 48; x < 80; x++) {
      if (alphaAt(emitted, 'front', x, y) > 8 && alphaAt(emitted, 'front', x - 64, y) === 0 && alphaAt(emitted, 'behind', x, y) === 0) exposed++;
    }
    const refused = problems(() => assemble({ ...input, requireHiddenExtent: DECLARATION }));
    say(`AS1047_ABSENT_SOURCE_REFUSES_${soft ? 'SOFT' : 'OPAQUE'}`, exposed === 32 * 64 && refused?.problems.some(p => p.code === 'ASSEMBLE_HIDDEN_EXTENT_ABSENT' && p.object.includes('"behind"') && p.object.includes('"front"') && p.detail.includes('2048 enclosed-hole rig cells of 2048')) === true,
      `production output exposes ${exposed} cells after front +64 x; ${refused?.message}`);
    const present = hiddenExtentFixture({ absent: false, soft });
    const plain = assemble(present), declared = assemble({ ...present, requireHiddenExtent: DECLARATION });
    say(`AS1047_PRESENT_SOURCE_IS_RETAINED_${soft ? 'SOFT' : 'OPAQUE'}`, serializeParts(plain.parts) === serializeParts(declared.parts) && plain.images.every((p, i) => Buffer.from(p.image.data).equals(Buffer.from(declared.images[i].image.data))),
      'all parts metadata and RGBA equal under the declaration; own alpha 9, 128 and 255 remain material');
  }
  const base = hiddenExtentFixture({ absent: false, soft: false });
  const alpha8 = problems(() => assemble({ ...hiddenExtentFixture({ absent: false, soft: false, alpha: 8 }), requireHiddenExtent: DECLARATION }));
  const alpha9 = problems(() => assemble({ ...hiddenExtentFixture({ absent: false, soft: false, alpha: 9 }), requireHiddenExtent: DECLARATION }));
  say('AS1047_SOURCE_ALPHA_FLOOR_IS_EIGHT', alpha8?.problems.some(p => p.code === 'ASSEMBLE_HIDDEN_EXTENT_ABSENT') === true && alpha9 === null, 'original own alpha 8 absent, 9 present, through production assembly');
  const edge = problems(() => assemble({ ...hiddenExtentFixture({ absent: true, soft: false, openEdge: true }), requireHiddenExtent: DECLARATION }));
  say('AS1047_OPEN_EDGE_IS_OUTSIDE_THE_DOMAIN', edge === null, 'one retained front column overlaps support; a one-pixel four-connected path to the exterior opens the missing domain');
  const multiple = problems(() => assemble({ ...hiddenExtentFixture({ absent: true, soft: false }), requireHiddenExtent: [...DECLARATION, { part: 'eye_r', occluder: 'front' }] }));
  say('AS1047_ALL_PAIRS_READ_AND_EMPTY_OVERLAP_REFUSES', multiple?.problems.some(p => p.code === 'ASSEMBLE_HIDDEN_EXTENT_ABSENT') === true && multiple.problems.some(p => p.code === 'ASSEMBLE_HIDDEN_EXTENT_UNMEASURED' && p.object.includes('"eye_r"')), 'one absent source plus one unmeasured source collected together');

  const missing = { ...base, full: { ...base.full, layers: base.full.layers.filter(layer => layer.name !== 'author:front') }, requireHiddenExtent: DECLARATION };
  const ancestry = problems(() => assemble(missing));
  say('AS1047_MISSING_ORIGINAL_ANCESTRY_REFUSES', ancestry?.problems.some(p => p.code === 'ASSEMBLE_HIDDEN_EXTENT_UNMEASURED') === true, 'an unavailable original cover is not measured as alpha zero');
  const blocked = hiddenExtentFixture({ absent: true, soft: false });
  const front = blocked.full.layers.find(layer => layer.name === 'author:front')!;
  const pixels = { ...front.pixels, data: new Uint8ClampedArray(front.pixels.data) };
  const blocker = { ...front, name: 'author:blocker', pixels, drawOrder: blocked.full.layers.length };
  const blockedInput: AssembleInput = { ...blocked, full: { ...blocked.full, layers: [...blocked.full.layers, blocker] }, plan: [...blocked.plan, ['blocker', 'full', 'author:blocker']], requireHiddenExtent: DECLARATION };
  const coveredByOther = problems(() => assemble(blockedInput));
  for (let p = 3; p < pixels.data.length; p += 4) if (pixels.data[p] > 0) pixels.data[p] = 8;
  const ghostCover = problems(() => assemble(blockedInput));
  say('AS1047_FRONTMOST_COVER_AND_GHOST_FLOOR', coveredByOther?.problems.some(p => p.code === 'ASSEMBLE_HIDDEN_EXTENT_UNMEASURED') === true && ghostCover?.problems.some(p => p.code === 'ASSEMBLE_HIDDEN_EXTENT_ABSENT') === true, 'front-most other source owns cover, alpha 8 cannot hide the declared front');

  const paintingCover = problems(() => assemble({ ...base, patches: [{ name: 'painting_cover', box: [0, 0, 128, 128], alpha: 'box', draw: 'front' }], requireHiddenExtent: [{ part: 'behind', occluder: 'painting_cover' }] }));
  say('AS1047_PAINTING_PATCH_IS_NOT_A_SOURCE_DECLARATION', paintingCover?.problems.some(p => p.code === 'CONFIG_NAME_RESOLVES') === true, 'direct production API also requires an original plan source, rather than a painting patch name');

  const original = hiddenExtentFixture({ absent: true, soft: false });
  const selected = problems(() => assemble({ ...base, requireHiddenExtent: DECLARATION, regionTake: { full: original.full, head: original.head, targets: ['behind'] } }));
  say('AS1047_SELECTED_REGION_SOURCE_IS_MEASURED', selected === null, 'the emitted selected source carries the extent, and an un-emitted pre-take counterfactual cannot veto it');

  const home = join(dir, 'hidden-extent');
  mkdirSync(home, { recursive: true });
  const input = hiddenExtentFixture({ absent: true, soft: false });
  exportLayers(input.full, join(home, 'full'));
  writePng(join(home, 'painting.png'), input.source);
  writeFileSync(join(home, 'config.json'), JSON.stringify(hiddenExtentConfig(DECLARATION)));
  const files = ['parts.json', 'parts', 'recomposite.png', 'error.png'];
  for (const file of files) writeFileSync(join(home, file), 'retained');
  const refusal = problems(() => assembleStage({ config: join(home, 'config.json'), source: join(home, 'painting.png'), full: join(home, 'full'), head: null },
    { partsJson: join(home, files[0]), partsDir: join(home, files[1]), recomposite: join(home, files[2]), errorMap: join(home, files[3]) }, () => {}));
  say('AS1047_NORMAL_STAGE_REFUSES_BEFORE_WRITING', refusal?.problems.some(p => p.code === 'ASSEMBLE_HIDDEN_EXTENT_ABSENT') === true && files.every(file => readFileSync(join(home, file), 'utf8') === 'retained'), 'config loader, run loader and assembly stage leave all prior outputs intact');
  const presentInput = hiddenExtentFixture({ absent: false, soft: false });
  exportLayers(presentInput.full, join(home, 'present-full'));
  exportLayers(input.full, join(home, 'alternate'));
  const altConfig = hiddenExtentConfig(DECLARATION);
  const altAssembly = altConfig.assemble as Record<string, unknown>;
  altAssembly.alternates = [{ name: 'missing', source: 'painting.png', full: 'alternate' }];
  writeFileSync(join(home, 'config.json'), JSON.stringify(altConfig));
  const outputs = { partsJson: join(home, files[0]), partsDir: join(home, files[1]), recomposite: join(home, files[2]), errorMap: join(home, files[3]) };
  const stageInput = { config: join(home, 'config.json'), source: join(home, 'painting.png'), full: join(home, 'present-full'), head: null };
  const alternateAbsent = problems(() => assembleStage(stageInput, outputs, () => {}));
  altAssembly.alternates = [{ name: 'partial', source: 'painting.png', full: 'alternate', parts: ['behind'] }];
  writeFileSync(join(home, 'config.json'), JSON.stringify(altConfig));
  const partial = problems(() => assembleStage(stageInput, outputs, () => {}));
  say('AS1047_ALTERNATES_READ_OR_REFUSE_INCOMPLETE_SOURCE_PAIRS', alternateAbsent?.problems.some(p => p.code === 'ASSEMBLE_HIDDEN_EXTENT_ABSENT' && p.object.includes('missing')) === true && partial?.problems.some(p => p.code === 'ASSEMBLE_HIDDEN_EXTENT_UNMEASURED' && p.object.includes('partial')) === true && files.every(file => readFileSync(join(home, file), 'utf8') === 'retained'), JSON.stringify({ complete: alternateAbsent?.problems, partial: partial?.problems, retained: files.every(file => readFileSync(join(home, file), 'utf8') === 'retained') }));

  const fields = stageFields(parseEarlyConfig(hiddenExtentConfig([]), 'assemble'), { w: 128, h: 128 });
  const undeclared = assemble(base), empty = assemble({ ...base, ...fields });
  say('AS1047_EMPTY_DECLARATION_IS_BYTE_IDENTICAL', serializeParts(undeclared.parts) === serializeParts(empty.parts) && undeclared.images.every((p, i) => Buffer.from(p.image.data).equals(Buffer.from(empty.images[i].image.data))), 'empty array and omitted declaration have identical production bytes');
}
