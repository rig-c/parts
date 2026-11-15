/** Issue #1278: final rig-space file replacement, with independent byte and census controls. */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { writeEditorReceiptFixture } from '../fixtures/editor_receipts.ts';
import { C, WHITE, paint } from '../fixtures/assemble_fixture.ts';
import { assembleStage, build } from '../src/build.ts';
import { DEFAULT_PAGE_EDGES } from '../src/check.ts';
import { configFileReferences, parseConfig, parseEarlyConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { scratchConfig } from '../src/meshdraft.ts';
import { readParts, serializeParts, type PartsFile } from '../src/parts.ts';
import { encodePngBytes, readPng } from '../src/raster/png.ts';
import { type Raster } from '../src/raster/types.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
type Receipt = { part: string; file: string; sha256: string; from_sha256: string; editor: string };
type Block = { dir: string; receipts: Receipt[] };
type Input = { source: string; full: string; head: string | null; config: string; part: string };
type Counts = { changed_px: number; changed_counted_px: number; changed_excluded_px: number; removed_opaque_px: number };
const json = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
const save = (file: string, value: unknown): void => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const assembly = (cfg: Record<string, unknown>): Record<string, unknown> => cfg.assemble as Record<string, unknown>;
const problems = (action: () => unknown): string[] => {
  try { action(); return []; } catch (error) {
    if (error instanceof PartsError) return error.problems.map(p => p.code);
    throw error;
  }
};
const run = (input: Input, out: string, config = input.config): void => {
  assembleStage({ source: input.source, full: input.full, head: input.head, config }, {
    partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'),
    recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, 'recomposite_error_rig.png'),
  }, () => {});
};
/** Includes file names, directory entries and exact bytes, including unknown sentinels. */
function snapshot(dir: string): string {
  if (!existsSync(dir)) return 'ABSENT';
  const entries: string[] = [];
  const walk = (at: string, prefix: string): void => {
    for (const e of readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const name = prefix + e.name;
      if (e.isDirectory()) { entries.push('D ' + name); walk(join(at, e.name), name + '/'); }
      else entries.push('F ' + name + ' ' + hash(readFileSync(join(at, e.name))));
    }
  };
  walk(dir, '');
  return entries.join('\n');
}
/** Valid tEXt before IEND: any decode/re-encode loses these bytes. */
export function editedPartPngBytes(image: Raster): Uint8Array {
  const png = Buffer.from(encodePngBytes(image));
  const payload = Buffer.from('Fixture\0edited part byte identity', 'utf8');
  const type = Buffer.from('tEXt');
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([type, payload])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0); type.copy(chunk, 4); payload.copy(chunk, 8);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([png.subarray(0, png.length - 12), chunk, png.subarray(png.length - 12)]);
}
/** Independent RGBA-position census; deletions belong outside the final alpha >8 set. */
function census(before: Raster, after: Raster): Counts {
  const out: Counts = { changed_px: 0, changed_counted_px: 0, changed_excluded_px: 0, removed_opaque_px: 0 };
  for (let p = 0; p < before.width * before.height; p++) {
    const i = p * 4;
    if (![0, 1, 2, 3].some(c => before.data[i + c] !== after.data[i + c])) continue;
    out.changed_px++;
    if (after.data[i + 3] > 8) out.changed_counted_px++; else out.changed_excluded_px++;
    if (before.data[i + 3] > 8 && after.data[i + 3] <= 8) out.removed_opaque_px++;
  }
  return out;
}
/** Separate integer source-over oracle, from output files, in the recorded order and boxes. */
function composedBytes(out: string, parts: PartsFile): Uint8Array {
  const [w, h] = parts.rig_size;
  const image: Raster = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) };
  for (const p of parts.parts) {
    const part = readPng(join(out, 'parts', p.name + '.png'));
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      if (p.x + x < 0 || p.y + y < 0 || p.x + x >= w || p.y + y >= h) continue;
      const src = (y * p.w + x) * 4, dst = ((p.y + y) * w + p.x + x) * 4;
      const a = part.data[src + 3];
      for (let c = 0; c < 3; c++) image.data[dst + c] = Math.floor((part.data[src + c] * a + image.data[dst + c] * (255 - a) + 127) / 255);
    }
  }
  return encodePngBytes(image);
}
function checkReplacement(input: Input, baseline: string, edited: string, bytes: Uint8Array, expected: Counts, receipt: Receipt, say: Say): void {
  const before = readParts(join(baseline, 'parts.json')), after = readParts(join(edited, 'parts.json'));
  const part = after.parts.find(p => p.name === input.part)!;
  const previous = before.parts.find(p => p.name === input.part)!;
  const provenance = part.provenance!;
  const association = provenance.edited_part;
  const geometry = (file: PartsFile): unknown => file.parts.map(p => [p.name, p.from, p.x, p.y, p.w, p.h]);
  const others = before.parts.filter(p => p.name !== input.part);
  say('FILE_BYTES_AND_OTHER_PARTS_UNCHANGED', Buffer.from(bytes).equals(readFileSync(join(edited, 'parts', input.part + '.png'))) &&
    others.every(p => readFileSync(join(baseline, 'parts', p.name + '.png')).equals(readFileSync(join(edited, 'parts', p.name + '.png')))) &&
    JSON.stringify(geometry(before)) === JSON.stringify(geometry(after)),
    `edited file exact bytes; ${others.length} other parts; names, original sources, order and boxes retained`);
  say('RECOMPOSITE_FROM_RECORDED_FILES', Buffer.from(composedBytes(edited, after)).equals(readFileSync(join(edited, 'recomposite_rig.png'))),
    `independent opaque-white source-over of ${after.parts.length} files in recorded order`);
  say('RECEIPT_CENSUS_AND_PARTITION', association !== undefined && association.edit === 'edited_parts[0]' && association.dir === 'edits' &&
    Object.entries(receipt).every(([key, value]) => association.receipt[key as keyof Receipt] === value) &&
    Object.entries(expected).every(([key, value]) => association[key as keyof Counts] === value) &&
    provenance.unchanged_layer_px + provenance.hand_px + provenance.automatic_px === part.opaque_px &&
    provenance.edits.reduce((n, e) => n + e.px, 0) === provenance.hand_px &&
    provenance.automatic.reduce((n, e) => n + e.px, 0) === provenance.automatic_px && part.from === previous.from,
    JSON.stringify({ expected, opaque_px: part.opaque_px, hand_px: provenance.hand_px, receipt: association?.edit }));
  const text = readFileSync(join(edited, 'parts.json'), 'utf8');
  say('METADATA_STRICT_SERIALIZATION_ROUNDTRIP', serializeParts(after) === text &&
    JSON.stringify(readParts(join(edited, 'parts.json')).parts.find(p => p.name === input.part)?.provenance?.edited_part) === JSON.stringify(association),
    'serialize(read(parts.json)) preserves every field and exact bytes');
}
function synthetic(dir: string): Input {
  const cfg = writeEditorReceiptFixture(dir, { author: false });
  // Keep the layer's declared 48x24 box; its bottom-right area is transparent.
  writeFileSync(join(dir, 'full', 'parts', 'topwear.png'), encodePngBytes(paint(48, 24, null, [
    { x0: 0, y0: 0, x1: 36, y1: 24, colour: C }, { x0: 36, y0: 0, x1: 48, y1: 4, colour: C },
  ])));
  writeFileSync(join(dir, 'painting.png'), encodePngBytes(paint(64, 64, WHITE, [
    { x0: 8, y0: 8, x1: 56, y1: 32, colour: C }, { x0: 8, y0: 32, x1: 44, y1: 56, colour: C },
    { x0: 44, y0: 32, x1: 56, y1: 36, colour: C },
  ])));
  save(join(dir, 'config.json'), cfg);
  return { source: join(dir, 'painting.png'), full: join(dir, 'full'), head: null, config: join(dir, 'config.json'), part: 'body' };
}
function editedConfig(input: Input, block: Block, file: string): Record<string, unknown> {
  const cfg = json(input.config);
  for (const ref of configFileReferences(cfg)) {
    const target = resolve(dirname(input.config), ref.value);
    ref.set(ref.at.startsWith('assemble.edited_parts.receipts[') ? relative(dirname(resolve(file)), target).replaceAll('\\', '/') : target);
  }
  assembly(cfg).edited_parts = block;
  save(file, cfg);
  return cfg;
}

// Filesystem interception stays in a child process, never in the suite's shared module registry.
const editedReadObserver = `
import { mock } from 'bun:test';
import * as fs from 'node:fs';
import { resolve } from 'node:path';
const [root, config] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(config, 'utf8'));
const reads = [];
let active = false;
const read = fs.readFileSync;
mock.module('node:fs', () => ({ ...fs, readFileSync(path, ...options) {
  if (active && typeof path === 'string') reads.push(resolve(path));
  return Reflect.apply(read, fs, [path, ...options]);
} }));
const { parseEarlyConfig } = await import(root + '/src/config.ts');
const { readEditedParts } = await import(root + '/src/editedparts.ts');
const cfg = parseEarlyConfig(raw, 'assemble');
active = true;
const parts = readEditedParts(cfg.assemble.edited_parts, config, cfg.assemble.plan);
active = false;
console.log(JSON.stringify({ reads, count: parts.length }));
`;

/** Issue #1281: declarations are checked against actual reader I/O and exact emitted PNG files. */
function checkFileReferences(dir: string, input: Input, baseline: string, bodyBytes: Uint8Array, say: Say): void {
  const source = join(dir, 'reference-source');
  const block: Block = { dir: 'pair-edits', receipts: ['body', 'face'].map((part, i) => {
    const original = readFileSync(join(baseline, 'parts', part + '.png'));
    const bytes = i === 0 ? bodyBytes : editedPartPngBytes(readPng(join(baseline, 'parts', part + '.png')));
    const file = i === 0 ? 'first/deep/body.png' : 'second/face.png';
    const path = join(source, 'pair-edits', file);
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
    return { part, file, sha256: hash(bytes), from_sha256: hash(original), editor: 'technical reference fixture' };
  }) };
  const file = join(source, 'config.json');
  const raw = editedConfig(input, block, file);
  const before = JSON.stringify(raw);
  const refs = configFileReferences(raw);
  const names = block.receipts.map((_, i) => `assemble.edited_parts.receipts[${i}].file`);
  const script = join(dir, 'observe-edited-reads.ts'); writeFileSync(script, editedReadObserver);
  const observation = spawnSync(process.execPath, [script, resolve(import.meta.dir, '..'), file], { encoding: 'utf8', timeout: 30000 });
  if (observation.status !== 0) throw new Error(`edited read observer exit ${observation.status}: ${observation.stderr}`);
  const observed = JSON.parse(observation.stdout.trim()) as { reads: string[]; count: number };
  const declared = refs.map(r => resolve(source, r.value));
  const sameFiles = (paths: string[]): boolean => observed.count === 2 && paths.length === 2 &&
    new Set(paths).size === 2 && JSON.stringify([...paths].sort()) === JSON.stringify([...observed.reads].sort());
  say('REFERENCES_EQUAL_ACTUAL_READER_FILES', sameFiles(declared) && before === JSON.stringify(raw) &&
    JSON.stringify(refs.map(r => r.at)) === JSON.stringify(names) &&
    JSON.stringify(refs.map(r => r.value)) === '["pair-edits/first/deep/body.png","pair-edits/second/face.png"]',
    JSON.stringify({ declared, observed, unchanged: before === JSON.stringify(raw) }));
  say('REFERENCE_CENSUS_REJECTS_MISSING_EXTRA_DUPLICATE_AND_BARE_FILES',
    !sameFiles(declared.slice(0, 1)) && !sameFiles([...declared, join(source, block.dir)]) &&
    !sameFiles([declared[0], declared[0]]) && !sameFiles(block.receipts.map(r => resolve(source, r.file))),
    'same actual-read oracle rejects a missing receipt, a directory row, a duplicated row and dir-relative values');

  const destination = join(dir, 'relative-destination'); mkdirSync(destination);
  const repointed = structuredClone(raw), repointedBlock = assembly(repointed).edited_parts as Block;
  const expected: Uint8Array[] = [];
  const targets = ['copied/nested/one.png', 'elsewhere/two.png'];
  const originalFiles = block.receipts.map(r => r.file);
  configFileReferences(repointed).forEach((ref, i) => {
    const bytes = readFileSync(resolve(source, ref.value)); expected.push(bytes);
    const target = resolve(destination, targets[i]); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
    ref.set(targets[i]);
  });
  const relocated = join(destination, 'config.json'); save(relocated, repointed);
  const roundtrip = configFileReferences(json(relocated));
  say('RELATIVE_REPOINT_ROUNDTRIPS_TWO_NESTED_RECEIPTS', repointedBlock.dir === block.dir &&
    JSON.stringify(roundtrip.map(r => r.value)) === JSON.stringify(targets) &&
    JSON.stringify(roundtrip.map(r => r.at)) === JSON.stringify(names) &&
    roundtrip.every((ref, i) => hash(readFileSync(resolve(destination, ref.value))) === block.receipts[i].sha256) &&
    JSON.stringify(block.receipts.map(r => r.file)) === JSON.stringify(originalFiles),
    JSON.stringify({ dir: repointedBlock.dir, values: roundtrip.map(r => r.value), files: repointedBlock.receipts.map(r => r.file) }));
  const output = join(dir, 'relative-output'); run(input, output, relocated);
  const exact = (out: string): boolean => block.receipts.every((r, i) => Buffer.from(expected[i]).equals(readFileSync(join(out, 'parts', r.part + '.png'))));
  say('RELATIVE_CONFIG_ASSEMBLES_EXACT_EDITED_PNG_BYTES', exact(output) &&
    block.receipts.every((r, i) => !Buffer.from(encodePngBytes(readPng(join(output, 'parts', r.part + '.png')))).equals(Buffer.from(expected[i]))),
    'both repointed PNGs retain their distinct ancillary chunk bytes through the real assemble stage');
  const wrong = structuredClone(repointed);
  (assembly(wrong).edited_parts as Block).receipts[1].file = 'absent.png';
  const wrongFile = join(destination, 'wrong.json'); save(wrongFile, wrong);
  const wrongOut = join(dir, 'wrong-reference-output');
  say('RELATIVE_REPOINT_MISSING_SECOND_FILE_REFUSES', problems(() => run(input, wrongOut, wrongFile)).includes('ASSEMBLE_EDITED_PART_FILE') && !existsSync(wrongOut),
    'a planted wrong second reference is refused before output emission by the production reader');

  const scratchDir = join(dir, 'scratch', 'nested');
  const scratchFile = scratchConfig(file, JSON.stringify(raw), scratchDir, new Map());
  const scratch = json(scratchFile), scratchRefs = configFileReferences(scratch);
  const scratchOut = join(dir, 'scratch-output'); run(input, scratchOut, scratchFile);
  say('SCRATCH_CONFIG_RESOLVES_ORIGINAL_FILES_AND_ASSEMBLES_EXACT_BYTES',
    (assembly(scratch).edited_parts as Block).dir === block.dir &&
    JSON.stringify(scratchRefs.map(r => resolve(dirname(scratchFile), r.value))) === JSON.stringify(declared) && exact(scratchOut),
    'production scratchConfig shared by mesh-draft and remesh keeps the shared dir and exact original file targets');
  const broken = structuredClone(raw);
  for (const ref of configFileReferences(broken)) ref.set(resolve(source, ref.value));
  say('OLD_ABSOLUTE_SCRATCH_RELOCATION_IS_REFUSED', problems(() => parseEarlyConfig(broken, 'assemble')).includes('CONFIG_FIELD_TYPE'),
    'the former absolute relocation is a planted regression; the relative-only loader still refuses it');

  const ordinary = { requirements: 'spec.json', motion: { animations_from: 'motion/extra.json' },
    generation: { control: { skeleton: 'pose.json' } }, assemble: { occluders: [{ image: 'front.png', plate: 'plate' }] } };
  const ordinaryFile = scratchConfig(file, JSON.stringify(ordinary), join(dir, 'scratch-ordinary'), new Map());
  const ordinaryExpected = { requirements: resolve(source, 'spec.json'), motion: { animations_from: resolve(source, 'motion/extra.json') },
    generation: { control: { skeleton: resolve(source, 'pose.json') } },
    assemble: { occluders: [{ image: resolve(source, 'front.png'), plate: resolve(source, 'plate') }] }, meshes: {} };
  say('NO_BLOCK_SCRATCH_ORDINARY_REFERENCES_KEEP_ABSOLUTE_BYTES',
    readFileSync(ordinaryFile, 'utf8') === JSON.stringify(ordinaryExpected, null, 2) + '\n',
    'without edited_parts all five ordinary references retain the former absolute relocation and serialized bytes');

  const plain = json(input.config), plainText = JSON.stringify(plain);
  const plainFile = scratchConfig(input.config, plainText, join(dir, 'scratch-plain'), new Map());
  const plainOut = join(dir, 'scratch-plain-output'); run(input, plainOut, plainFile);
  say('NO_BLOCK_SCRATCH_CONFIG_AND_ALL_OUTPUT_BYTES_UNCHANGED',
    readFileSync(plainFile, 'utf8') === JSON.stringify({ ...plain, meshes: { ...(plain.meshes as Record<string, unknown>) } }, null, 2) + '\n' &&
    snapshot(plainOut) === snapshot(baseline) && snapshot(output) !== snapshot(baseline),
    'no-block scratch text follows the unchanged serializer and all emitted bytes match baseline; edited output differs');
}

export function runEditedPartChecks(dir: string, say: Say): void {
  mkdirSync(dir, { recursive: true });
  const input = synthetic(join(dir, 'input'));
  const baseline = join(dir, 'baseline'); run(input, baseline);
  const original = readPng(join(baseline, 'parts', 'body.png'));
  const image = structuredClone(original);
  const set = (x: number, y: number, rgba: number[]): void => image.data.set(rgba, (y * image.width + x) * 4);
  for (let x = 36; x < 44; x++) set(x, 8, [41, 97, 151, x < 42 ? 192 : 64]);
  for (let y = 0; y < 6; y++) for (let x = 0; x <= y; x++) set(20 - x, 14 + y, [0, 0, 0, 0]);
  set(46, 20, [5, 7, 9, 0]);
  const bytes = editedPartPngBytes(image), edits = join(dir, 'edits'); mkdirSync(edits);
  writeFileSync(join(edits, 'body.png'), bytes);
  const receipt: Receipt = { part: 'body', file: 'body.png', sha256: hash(bytes),
    from_sha256: hash(readFileSync(join(baseline, 'parts', 'body.png'))), editor: 'technical fixture' };
  const block: Block = { dir: 'edits', receipts: [receipt] };
  const cfgFile = join(dir, 'edited.json'), cfg = editedConfig(input, block, cfgFile);
  const edited = join(dir, 'edited'); run(input, edited, cfgFile);
  say('ANCILLARY_ENCODING_IS_DISTINGUISHABLE', !Buffer.from(encodePngBytes(readPng(join(edits, 'body.png')))).equals(Buffer.from(bytes)) &&
    Buffer.from(readPng(join(edits, 'body.png')).data).equals(Buffer.from(image.data)),
    'valid tEXt chunk changes file encoding while decoded RGBA remains identical');
  checkReplacement(input, baseline, edited, bytes, census(original, image), receipt, say);
  const delta = census(original, image);
  const editedPart = readParts(join(edited, 'parts.json')).parts.find(p => p.name === input.part)!;
  say('HAND_COUNTS_ONLY_SURVIVING_CHANGED_OPAQUE', editedPart.provenance?.hand_px === delta.changed_counted_px &&
    editedPart.provenance?.edits.find(e => e.edit === 'edited_parts[0]')?.px === delta.changed_counted_px &&
    delta.changed_counted_px > 0 && delta.changed_excluded_px > 0,
    'novel-color strand is hand-attributed; deleted wedge and transparent RGB change are outside that partition');

  say('DELETION_EXCLUDED_FROM_FINAL_PARTITION', delta.removed_opaque_px > 0 && delta.changed_excluded_px > delta.removed_opaque_px &&
    delta.changed_px === delta.changed_counted_px + delta.changed_excluded_px,
    'removed opaque wedge contributes to changed_excluded_px; the separate transparent RGB edit is excluded too');

  const noBlock = join(dir, 'no-block'); run(input, noBlock);
  say('NO_BLOCK_COMPLETE_OUTPUT_BYTES_REPEAT', snapshot(baseline) === snapshot(noBlock) &&
    !readFileSync(join(noBlock, 'parts.json'), 'utf8').includes('edited_part'),
    'all default files, directories and bytes repeat; edited metadata remains absent');
  const emptyCfg = json(input.config); assembly(emptyCfg).edited_parts = { dir: 'unread-absent', receipts: [] };
  save(join(dir, 'empty.json'), emptyCfg); const empty = join(dir, 'empty'); run(input, empty, join(dir, 'empty.json'));
  say('EMPTY_BLOCK_COMPLETE_OUTPUT_BYTES_UNCHANGED', snapshot(empty) === snapshot(baseline), 'empty receipts do not read a missing directory or move any output byte');

  checkFileReferences(dir, input, baseline, bytes, say);

  // Every dedicated refusal is checked against both a missing output and a successful output with unknown nested files.
  const tooWide: Raster = { width: image.width + 1, height: image.height, data: new Uint8ClampedArray((image.width + 1) * image.height * 4) };
  const tooTall: Raster = { width: image.width, height: image.height + 1, data: new Uint8ClampedArray(image.width * (image.height + 1) * 4) };
  for (const [name, raster] of [['wide', tooWide], ['tall', tooTall]] as const) writeFileSync(join(edits, name + '.png'), encodePngBytes(raster));
  writeFileSync(join(edits, 'invalid.png'), 'not a PNG');
  const cases: Array<[string, string, Block]> = [
    ['UNKNOWN_PART', 'ASSEMBLE_EDITED_PART_UNKNOWN', { ...block, receipts: [{ ...receipt, part: 'not_in_plan' }] }],
    ['MISSING_FILE', 'ASSEMBLE_EDITED_PART_FILE', { ...block, receipts: [{ ...receipt, file: 'absent.png' }] }],
    ['SHA256_MISMATCH', 'ASSEMBLE_EDITED_PART_SHA256', { ...block, receipts: [{ ...receipt, sha256: 'b'.repeat(64) }] }],
    ['STALE_BASELINE', 'ASSEMBLE_EDITED_PART_BASELINE', { ...block, receipts: [{ ...receipt, from_sha256: 'c'.repeat(64) }] }],
    ...(['wide', 'tall'] as const).map(name => [name.toUpperCase() + '_BOX', 'ASSEMBLE_EDITED_PART_SIZE', { ...block, receipts: [{ ...receipt, file: name + '.png', sha256: hash(readFileSync(join(edits, name + '.png'))) }] }] as [string, string, Block]),
    ['DUPLICATE_PART', 'ASSEMBLE_EDITED_PART_DUPLICATE', { ...block, receipts: [receipt, receipt] }],
    ['INVALID_PNG', 'ASSEMBLE_EDITED_PART_DECODES', { ...block, receipts: [{ ...receipt, file: 'invalid.png', sha256: hash(readFileSync(join(edits, 'invalid.png'))) }] }],
  ];
  for (const [name, code, bad] of cases) {
    const badFile = join(dir, name + '.json'); editedConfig(input, bad, badFile);
    const absent = join(dir, name + '-absent'), existing = join(dir, name + '-existing');
    cpSync(edited, existing, { recursive: true }); mkdirSync(join(existing, 'keep'));
    writeFileSync(join(existing, 'keep', 'sentinel.bin'), Buffer.from([0, 255, 13, 10]));
    const before = snapshot(existing);
    const absentCodes = problems(() => run(input, absent, badFile));
    const existingCodes = problems(() => run(input, existing, badFile));
    say(name + '_REFUSES_ATOMICALLY', absentCodes.includes(code) && existingCodes.includes(code) &&
      !existsSync(absent) && snapshot(existing) === before,
      `${code}; absent=[${absentCodes.join(',')}], existing=[${existingCodes.join(',')}]; successful tree and nested sentinel unchanged`);
    // Exercise the actual build wrapper: a refusal must precede its output reset, not only assemble's writes.
    const wrappedExisting = join(dir, name + '-build-existing'), wrappedAbsent = join(dir, name + '-build-absent');
    cpSync(existing, wrappedExisting, { recursive: true });
    const wrappedBefore = snapshot(wrappedExisting);
    let laterCalls = 0;
    const blockedRunner = (): { status: number; out: string } => { laterCalls++; return { status: 1, out: 'unexpected post-assemble runner' }; };
    const wrapped = [wrappedAbsent, wrappedExisting].map(out => {
      const lines: string[] = [];
      const result = build({ ...input, config: badFile, out, loop: false, pageEdges: DEFAULT_PAGE_EDGES },
        { rig: blockedRunner, check: blockedRunner, checkBin: 'unused-refusal-control', scratch: join(dir, 'unused-scratch') }, line => lines.push(line));
      return result.stoppedAt === 'assemble' && lines.some(line => line.includes(code + ':'));
    });
    say(name + '_BUILD_WRAPPER_REFUSES_BEFORE_RESET', wrapped.every(Boolean) && laterCalls === 0 &&
      !existsSync(wrappedAbsent) && snapshot(wrappedExisting) === wrappedBefore,
      `${code}; actual build wrapper stops at assemble; absent output and successful tree plus sentinel unchanged; ${laterCalls} later runner calls`);

  }
  const loaderCases: Array<[string, (raw: Record<string, unknown>) => void]> = [
    ['BLOCK_ARRAY', raw => { assembly(raw).edited_parts = []; }],
    ['DIR_MISSING', raw => { delete (assembly(raw).edited_parts as Record<string, unknown>).dir; }],
    ['RECEIPTS_NOT_ARRAY', raw => { (assembly(raw).edited_parts as Record<string, unknown>).receipts = {}; }],
    ['PART_EMPTY', raw => { ((assembly(raw).edited_parts as Block).receipts[0]).part = ''; }],
    ['FILE_ABSOLUTE', raw => { (assembly(raw).edited_parts as Block).receipts[0].file = resolve(edits, 'body.png'); }],
    ['HASH_MALFORMED', raw => { (assembly(raw).edited_parts as Block).receipts[0].sha256 = 'wrong'; }],
    ['BASELINE_HASH_MALFORMED', raw => { (assembly(raw).edited_parts as Block).receipts[0].from_sha256 = 'wrong'; }],
    ['EDITOR_EMPTY', raw => { (assembly(raw).edited_parts as Block).receipts[0].editor = ''; }],
  ];
  const doors = (raw: Record<string, unknown>): Array<() => unknown> => [() => parseEarlyConfig(raw as never, 'assemble'), () => parseEarlyConfig(raw as never, 'layers'), () => parseConfig(raw as never)];
  say('CONFIG_ACCEPTED_AT_ALL_DOORS', doors(cfg).every(door => problems(door).length === 0), 'published block accepted by assemble, layers and full config doors');
  for (const [name, mutate] of loaderCases) {
    const raw = structuredClone(cfg); mutate(raw);
    const codes = doors(raw).map(door => problems(door));
    say('CONFIG_' + name + '_REFUSED', codes.every(row => row.some(code => ['CONFIG_FIELD_TYPE', 'CONFIG_FIELD_PRESENT', 'CONFIG_KEY_KNOWN'].includes(code))), codes.map(row => row.join(',')).join(' / '));
  }

  // Whole-file association is separate from attribution of surviving, changed counted pixels.
  const transparent = structuredClone(original); transparent.data.set([17, 31, 47, 0], (20 * original.width + 46) * 4);
  const transparentBytes = editedPartPngBytes(transparent); writeFileSync(join(edits, 'transparent.png'), transparentBytes);
  const tr = { ...receipt, file: 'transparent.png', sha256: hash(transparentBytes) };
  const trConfig = join(dir, 'transparent.json'); editedConfig(input, { dir: 'edits', receipts: [tr] }, trConfig);
  const trOut = join(dir, 'transparent'); run(input, trOut, trConfig);
  const trPart = readParts(join(trOut, 'parts.json')).parts.find(p => p.name === input.part)!;
  const trMeta = trPart.provenance?.edited_part;
  say('TRANSPARENT_RGB_COUNTS_OUTSIDE_HAND_PARTITION', trMeta?.changed_px === 1 && trMeta.changed_counted_px === 0 && trMeta.changed_excluded_px === 1 && trMeta.removed_opaque_px === 0 &&
    trPart.provenance?.hand_px === readParts(join(baseline, 'parts.json')).parts.find(p => p.name === input.part)?.provenance?.hand_px &&
    readFileSync(join(trOut, 'parts', 'body.png')).equals(Buffer.from(transparentBytes)),
    'one alpha-zero RGB change; one excluded change, no removed opaque pixel, unchanged hand partition, whole-file bytes retained');

  const traceCfg = structuredClone(cfg); assembly(traceCfg).editor_receipts = { trace_parts: true, receipts: [] }; assembly(traceCfg).stage_map = true;
  const traceFile = join(dir, 'trace.json'); save(traceFile, traceCfg); const traceOut = join(dir, 'trace'); run(input, traceOut, traceFile);
  const map = json(join(traceOut, 'stage-map.json'));
  const sidecar = (map.parts as Array<Record<string, unknown>>).find(p => p.name === input.part);
  const meta = readParts(join(traceOut, 'parts.json')).parts.find(p => p.name === input.part)?.provenance?.edited_part;
  say('TRACE_WHOLE_FILE_INCLUDES_TRANSPARENT_AND_UNCHANGED', JSON.stringify(sidecar?.edited_part) === JSON.stringify(meta) && meta !== undefined &&
    meta.receipt.sha256 === hash(bytes) && (map.edits as string[]).includes('edited_parts[0]') &&
    (sidecar?.runs as Array<[number, number]>).reduce((n, r) => n + r[1], 0) === original.width * original.height,
    'sidecar and provenance share the full receipt; writer runs cover the whole crop, excluded pixels retain their partition code');

  const valid = json(join(edited, 'parts.json'));
  const mutateCases: Array<[string, (metadata: Record<string, unknown>) => void]> = [
    ['UNKNOWN_FIELD', m => { m.unrecognized = true; }],
    ['NEGATIVE_COUNT', m => { m.changed_px = -1; }],
    ['FRACTIONAL_COUNT', m => { m.changed_excluded_px = 0.5; }],
    ['COUNT_PARTITION_MISMATCH', m => { m.changed_px = Number(m.changed_px) + 1; }],
    ['REMOVED_EXCEEDS_EXCLUDED', m => { m.removed_opaque_px = Number(m.changed_excluded_px) + 1; }],
    ['RECEIPT_PART_MISMATCH', m => { (m.receipt as Record<string, unknown>).part = 'face'; }],
    ['NESTED_RECEIPT_UNKNOWN_FIELD', m => { (m.receipt as Record<string, unknown>).extra = true; }],
    ['NESTED_RECEIPT_BAD_HASH', m => { (m.receipt as Record<string, unknown>).sha256 = 'wrong'; }],
    ['NESTED_RECEIPT_ABSOLUTE_FILE', m => { (m.receipt as Record<string, unknown>).file = resolve(edits, 'body.png'); }],
    ['EDIT_REFERENCE_MALFORMED', m => { m.edit = 'edited_parts[bad]'; }],
  ];
  for (const [name, mutate] of mutateCases) {
    const raw = structuredClone(valid);
    const part = (raw.parts as Array<Record<string, unknown>>).find(p => p.name === input.part)!;
    mutate((part.provenance as Record<string, unknown>).edited_part as Record<string, unknown>);
    const home = join(dir, 'metadata-' + name); cpSync(edited, home, { recursive: true }); save(join(home, 'parts.json'), raw);
    const codes = problems(() => readParts(join(home, 'parts.json')));
    say('METADATA_' + name + '_REFUSED', codes.some(c => c === 'PARTS_FIELD_TYPE' || c === 'PARTS_COUNTS_ADD_UP'), codes.join(',') || 'accepted malformed receipt association');
  }
}

/** Callable by the issue's separately coordinated public-example measurement; no art is embedded here. */
export function runEditedPartPublicChecks(dir: string, input: Input, say: Say): void {
  mkdirSync(dir, { recursive: true });
  const baseline = join(dir, 'baseline'); run(input, baseline);
  const original = readPng(join(baseline, 'parts', input.part + '.png'));
  const image = structuredClone(original);
  const alpha = (x: number, y: number): number => image.data[(y * image.width + x) * 4 + 3];
  const strand: Array<[number, number]> = [], wedge: Array<[number, number]> = [];
  outer: for (let y = 1; y < image.height - 1; y++) for (let x = 1; x < image.width - 9; x++) {
    if (alpha(x, y) === 0 || !Array.from({ length: 9 }, (_, i) => alpha(x + i + 1, y) === 0).every(Boolean)) continue;
    const rgb = Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3));
    for (let i = 1; i <= 8; i++) { image.data.set([...rgb, i < 6 ? 192 : i === 6 ? 128 : 64], (y * image.width + x + i) * 4); strand.push([x + i, y]); }
    break outer;
  }
  outer: for (let y = Math.floor(image.height / 2); y < image.height - 12; y++) {
    let edge = -1;
    for (let x = 4; x < image.width - 4; x++) if (alpha(x, y) > 0 && alpha(x + 1, y) === 0) edge = x;
    if (edge < 8) continue;
    const points: Array<[number, number]> = [];
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx <= dy; dx++) if (alpha(edge - dx, y + dy) > 0) points.push([edge - dx, y + dy]);
    if (points.length < 12) continue;
    for (const [x, yy] of points) image.data.fill(0, (yy * image.width + x) * 4, (yy * image.width + x + 1) * 4);
    wedge.push(...points); break outer;
  }
  say('PUBLIC_STRAND_AND_WEDGE_FIXTURE_EXISTS', strand.length > 0 && wedge.length > 0, `added ${strand.length} strand pixels; removed ${wedge.length} edge-wedge pixels; technical alpha fixture`);
  if (strand.length === 0 || wedge.length === 0) return;
  const edits = join(dir, 'edits'); mkdirSync(edits); const bytes = editedPartPngBytes(image);
  writeFileSync(join(edits, 'edited.png'), bytes);
  const receipt: Receipt = { part: input.part, file: 'edited.png', sha256: hash(bytes), from_sha256: hash(readFileSync(join(baseline, 'parts', input.part + '.png'))), editor: 'technical public-example fixture' };
  const cfgFile = join(dir, 'edited.json'); editedConfig(input, { dir: 'edits', receipts: [receipt] }, cfgFile);
  const edited = join(dir, 'edited'); run(input, edited, cfgFile);
  checkReplacement(input, baseline, edited, bytes, census(original, image), receipt, namePrefix(say));
  save(join(dir, 'fixture.json'), { part: input.part, strand, wedge, ...census(original, image), receipt });
}
function namePrefix(say: Say): Say { return (name, pass, detail) => say('PUBLIC_' + name, pass, detail); }

/** Narrow issue-bar control entrypoint; a fresh explicit output directory retains its evidence. */
if (import.meta.main) {
  const out = process.argv[2];
  if (process.argv.length !== 3 || !out || existsSync(out)) {
    console.error('Usage: bun tools/check_edited_parts.ts <fresh-output-directory>');
    process.exitCode = 64;
  } else {
    let count = 0, failed = 0;
    try {
      runEditedPartChecks(resolve(out), (name, pass, detail) => {
        count++; if (!pass) failed++;
        console.log(`${pass ? 'PASS' : 'FAIL'} EP1278${String(count).padStart(2, '0')}_${name}: ${detail}`);
      });
    } catch (error) {
      failed++; console.error('FAIL edited-parts control crashed: ' + (error instanceof Error ? error.message : String(error)));
    }
    console.log(`edited-parts controls: cases=${count}; failed=${failed}`);
    process.exitCode = failed === 0 ? 0 : 1;
  }
}
