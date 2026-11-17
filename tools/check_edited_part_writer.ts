/** Issue #1328: command-level receipt recording and the existing build baseline authority. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { writeEditorReceiptFixture } from '../fixtures/editor_receipts.ts';
import { assembleStage, build, type BuildStages } from '../src/build.ts';
import { DEFAULT_PAGE_EDGES } from '../src/check.ts';
import { loadConfig } from '../src/config.ts';
import { readEditorReceipts } from '../src/editreceipt.ts';
import type { EditedPartReceipt, EditedParts } from '../src/editedparts.ts';
import { readEditedParts } from '../src/editedparts.ts';
import { PartsError } from '../src/errors.ts';
import { jsonValueSpan } from '../src/meshdraft.ts';
import { encodePngBytes, readPng } from '../src/raster/png.ts';
import { editedPartPngBytes } from './check_edited_parts.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const text = (file: string): string => readFileSync(file, 'utf8');
const raw = (file: string): Record<string, unknown> => JSON.parse(text(file)) as Record<string, unknown>;
const assembly = (config: Record<string, unknown>): Record<string, unknown> => config.assemble as Record<string, unknown>;
const block = (file: string): EditedParts => assembly(raw(file)).edited_parts as EditedParts;
const save = (file: string, value: unknown): void => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const receiptPath = ['assemble', 'edited_parts', 'receipts'] as const;
function withoutRow(source: string, index: number): string {
  const span = jsonValueSpan(source, [...receiptPath, index]);
  return source.slice(0, span.start) + '<receipt>' + source.slice(span.end);
}
function valueBytes(source: string, index: number): string {
  const span = jsonValueSpan(source, [...receiptPath, index]);
  return source.slice(span.start, span.end);
}

export function runEditedPartWriterChecks(dir: string, say: Say): void {
  const cfg = writeEditorReceiptFixture(dir, { author: false });
  const config = join(dir, 'config.json'), baseline = join(dir, 'baseline');
  const source = join(dir, 'painting.png'), full = join(dir, 'full');
  assembleStage({ source, full, head: null, config }, {
    partsJson: join(baseline, 'parts.json'), partsDir: join(baseline, 'parts'),
    recomposite: join(baseline, 'recomposite_rig.png'), errorMap: join(baseline, 'recomposite_error_rig.png'),
  }, () => {});
  const from = join(baseline, 'parts', 'body.png'), file = join(dir, 'edited.png');
  const image = readPng(from); image.data[0] ^= 1;
  writeFileSync(file, editedPartPngBytes(image));
  // Identical decoded baseline pixels with extra PNG metadata: from_sha256 is
  // the supplied file's bytes, never the writer's reconstruction of the pixels.
  const wrong = join(dir, 'wrong.png'); writeFileSync(wrong, editedPartPngBytes(readPng(from)));
  const otherFile = join(baseline, 'parts', 'face.png');
  const other: EditedPartReceipt = { editor: 'untouched declaration', part: 'face', file: 'baseline/parts/face.png',
    from_sha256: sha(readFileSync(otherFile)), sha256: sha(readFileSync(otherFile)) };
  assembly(cfg).edited_parts = { dir: '.', receipts: [other] };
  save(config, cfg);
  // Deliberate non-canonical spelling outside the row the command owns.
  const seed = text(config).replace('"duration": 1', '"duration" : 1e0').replace('"editor": "untouched declaration"', '"editor"  :  "untouched declaration"');
  writeFileSync(config, seed);
  const editor = 'fixture editor\nsecond line';
  const cli = (args: string[]): { status: number | null; out: string; stdout: string; stderr: string } => {
    const result = spawnSync(process.execPath, [join(import.meta.dir, '..', 'cli.ts'), 'edited-part', ...args], { encoding: 'utf8', cwd: dir });
    if (result.error) throw result.error;
    return { status: result.status, out: result.stdout + result.stderr, stdout: result.stdout, stderr: result.stderr };
  };
  const args = ['--config', config, '--part', 'body', '--file', file, '--from', from, '--editor', editor];
  const replace = (flag: string, value: string): string[] => args.map((arg, i) => args[i - 1] === flag ? value : arg);
  const appended = cli(args), afterInsert = text(config), rows = block(config).receipts;
  const expected: EditedPartReceipt = { part: 'body', file: 'edited.png', sha256: sha(readFileSync(file)), from_sha256: sha(readFileSync(from)), editor };
  say('APPEND_HASHES_AND_ONE_ESCAPED_LOG_LINE', appended.status === 0 && rows.length === 2 &&
    JSON.stringify(rows[1]) === JSON.stringify(expected) && appended.stdout.trimEnd() ===
    `edited-part: part "body" sha256=${expected.sha256} from_sha256=${expected.from_sha256} editor=${JSON.stringify(editor)}` &&
    appended.stderr === `config ${resolve(config)}: added assemble.edited_parts.receipts[1]\n`,
    `exit ${appended.status}; encoded byte hashes, fixed key order, editor escaped on one stdout line; shared change line on stderr`);
  const insertPoint = jsonValueSpan(seed, [...receiptPath, 0]).end;
  const insertedEnd = jsonValueSpan(afterInsert, [...receiptPath, 1]).end;
  say('APPEND_PRESERVES_EVERY_PREEXISTING_BYTE', afterInsert.slice(0, insertPoint) + afterInsert.slice(insertedEnd) === seed &&
    valueBytes(afterInsert, 0) === valueBytes(seed, 0), 'one insertion after the last row; all preexisting bytes retained');
  const replaced = cli(replace('--editor', 'replacement editor')), afterReplace = text(config);
  say('REPLACE_NO_DUPLICATE_AND_OTHER_BYTES_IDENTICAL', replaced.status === 0 && block(config).receipts.filter(r => r.part === 'body').length === 1 &&
    block(config).receipts.length === 2 && withoutRow(afterInsert, 1) === withoutRow(afterReplace, 1) &&
    valueBytes(afterReplace, 0) === valueBytes(seed, 0) && replaced.stderr === `config ${resolve(config)}: replaced assemble.edited_parts.receipts[1]\n`,
    `exit ${replaced.status}; only the body row changes, reported by the shared writer`);
  const checked = loadConfig(config), editedSpec = checked.assemble.edited_parts!;
  const verified = readEditedParts(editedSpec, config, checked.assemble.plan);
  const legacy = readEditorReceipts({ receipts: editedSpec.receipts.map(r => ({ ...r, file: relative(dirname(config), resolve(dirname(config), editedSpec.dir, r.file)).replaceAll('\\', '/') })) }, config);
  say('EXISTING_RECEIPT_READERS_VERIFY_WRITTEN_HASHES', verified.length === 2 && legacy.problems.length === 0 && legacy.bySha.has(expected.sha256),
    'readEditedParts and readEditorReceipts both verify the writer output without changing either reader');
  const tampered = { ...expected, sha256: '0'.repeat(64) };
  say('EXISTING_RECEIPT_READER_REJECTS_PLANTED_HASH', readEditorReceipts({ receipts: [tampered] }, config).problems.some(p => p.code === 'ASSEMBLE_EDITOR_RECEIPT_SHA256'),
    'planted wrong sha256 is refused by the unchanged reader');

  const noPng = join(dir, 'not-png'); writeFileSync(noPng, 'not a PNG');
  const tiny = join(dir, 'tiny.png'); writeFileSync(tiny, encodePngBytes({ width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) }));
  const refusalCases: Array<[string, string[], string]> = [
    ['UNKNOWN_PART', replace('--part', 'absent'), 'ASSEMBLE_EDITED_PART_UNKNOWN'],
    ['FILE_UNREADABLE', replace('--file', join(dir, 'absent.png')), 'EDITED_PART_FILE'],
    ['FROM_UNREADABLE', replace('--from', join(dir, 'absent.png')), 'EDITED_PART_FILE'],
    ['FILE_NON_PNG', replace('--file', noPng), 'EDITED_PART_PNG'],
    ['FROM_NON_PNG', replace('--from', noPng), 'EDITED_PART_PNG'],
    ['SIZE', replace('--file', tiny), 'EDITED_PART_SIZE'],
    ['WHITESPACE_EDITOR', replace('--editor', ' \t '), 'EDITED_PART_ARGUMENT'],
    ['BLANK_PART', replace('--part', ''), 'EDITED_PART_ARGUMENT'],
    ['BLANK_CONFIG', replace('--config', ''), 'EDITED_PART_ARGUMENT'],
    ['BLANK_RIG_CONFIG', [...args, '--rig-config', ''], 'EDITED_PART_ARGUMENT'],
  ];
  for (const flag of ['--file', '--from', '--editor']) {
    const index = args.indexOf(flag);
    refusalCases.push([`MISSING_${flag.slice(2).toUpperCase()}`, args.filter((_, i) => i !== index && i !== index + 1), 'USAGE']);
    refusalCases.push([`BLANK_${flag.slice(2).toUpperCase()}`, replace(flag, ''), 'EDITED_PART_ARGUMENT']);
  }
  for (const [name, input, code] of refusalCases) {
    const before = text(config), result = cli(input);
    say(name + '_REFUSES_WITHOUT_WRITE', result.status !== 0 && result.out.includes(code + ':') && text(config) === before,
      `${code}; exit ${result.status}; config byte-identical`);
  }
  const beforeMissingBlock = text(config), withoutBlock = raw(config); delete assembly(withoutBlock).edited_parts;
  save(config, withoutBlock); const missingBlockText = text(config), absentBlock = cli(args);
  say('MISSING_BLOCK_REFUSES_WITHOUT_WRITE', absentBlock.status === 1 && absentBlock.out.includes('EDITED_PART_BLOCK:') && text(config) === missingBlockText,
    `exit ${absentBlock.status}; explicit block required`);
  writeFileSync(config, beforeMissingBlock);

  const rigDir = join(dir, 'explicit-rig'); mkdirSync(rigDir);
  const rigConfig = join(rigDir, 'named.json');
  const secondary = raw(config); assembly(secondary).edited_parts = { dir: '../', receipts: [] };
  delete secondary.motion; save(rigConfig, secondary);
  const beforePair = [text(config), text(rigConfig)], refusedPair = cli([...args, '--rig-config', rigConfig]);
  say('SECOND_CONFIG_VALIDATED_BEFORE_EITHER_WRITE', refusedPair.status === 1 && refusedPair.out.includes('CONFIG_FIELD_PRESENT:') &&
    text(config) === beforePair[0] && text(rigConfig) === beforePair[1], `exit ${refusedPair.status}; invalid second full config leaves both unchanged`);
  secondary.motion = raw(config).motion; save(rigConfig, secondary);
  (secondary.motion as Record<string, unknown>).animations_from = 'missing-animations.json'; save(rigConfig, secondary);
  const sidecarBefore = [text(config), text(rigConfig)], missingSidecar = cli([...args, '--rig-config', rigConfig]);
  say('SECOND_FULL_LOADER_REFUSAL_CANCELS_EVERY_STAGE', missingSidecar.status === 1 && missingSidecar.out.includes('CONFIG_FILE_PRESENT:') &&
    text(config) === sidecarBefore[0] && text(rigConfig) === sidecarBefore[1] &&
    [dir, rigDir].every(at => readdirSync(at).every(name => !name.includes('.rig-parts-'))),
    `exit ${missingSidecar.status}; full staged loader resolves motion sidecar; both configs and staging cleanup preserved`);
  delete (secondary.motion as Record<string, unknown>).animations_from; save(rigConfig, secondary);
  const explicit = cli([...args, '--rig-config', rigConfig]);
  say('EXPLICIT_SECOND_CONFIG_AND_ITS_OWN_RELATIVE_PATH', explicit.status === 0 && block(rigConfig).receipts.length === 1 &&
    JSON.stringify(block(rigConfig).receipts[0]) === JSON.stringify(expected) &&
    explicit.stderr.split('\n').filter(Boolean).length === 2 && explicit.stderr.includes(`config ${resolve(rigConfig)}: added assemble.edited_parts.receipts[0]`),
    `exit ${explicit.status}; distinct config directory and edited_parts.dir resolve the same PNG; one shared change line per config`);
  const undiscovered = join(dir, 'rig-config.json'); save(undiscovered, secondary); const undiscoveredBefore = text(undiscovered);
  const noDiscovery = cli(args);
  say('NO_CONFIG_FILENAME_DISCOVERY', noDiscovery.status === 0 && text(undiscovered) === undiscoveredBefore,
    'planted rig-config.json remains byte-identical when --rig-config is absent');
  const beforeRepeat = text(config), repeat = cli(args);
  say('EMPTY_ARRAY_INSERTION_AND_REPEAT_ARE_DETERMINISTIC', explicit.status === 0 && noDiscovery.status === 0 &&
    repeat.status === 0 && text(config) === beforeRepeat && block(rigConfig).receipts.length === 1 &&
    repeat.stderr === `config ${resolve(config)}: unchanged\n`,
    'empty second ledger gains one row; repeated writer is byte-identical');

  // The real build wrapper and real assemble own the baseline decision. The rig
  // stage is a sentinel: this control claims baseline acceptance, not a core gate.
  let rigCalls = 0;
  const stages: BuildStages = { assemble: assembleStage, rig: () => { rigCalls++; throw new PartsError([{ code: 'CONFIG_FIELD_TYPE', object: 'baseline-control', detail: 'rig sentinel reached after baseline acceptance' }]); }, check: () => { throw new Error('unexpected check stage'); } };
  const runBuild = (name: string): { result: ReturnType<typeof build>; lines: string[] } => {
    const lines: string[] = [];
    const result = build({ source, full, head: null, config, out: join(dir, name), loop: false, pageEdges: DEFAULT_PAGE_EDGES }, {
      rig: () => { throw new Error('unexpected core runner'); }, check: () => { throw new Error('unexpected core runner'); },
      checkBin: 'unused-baseline-control', scratch: join(dir, 'scratch'), stages,
    }, line => lines.push(line));
    return { result, lines };
  };
  // Keep only the writer's row; the unrelated row was used for byte controls.
  const sole = raw(config); assembly(sole).edited_parts = { dir: '.', receipts: [block(config).receipts.find(r => r.part === 'body')!] }; save(config, sole);
  const wrongWriter = cli(replace('--from', wrong)), wrongBuild = runBuild('wrong-build');
  const wrongHash = sha(readFileSync(wrong));
  say('WRONG_FROM_WRITER_SUCCEEDS_BUILD_REFUSES_BOTH_HASHES', wrongWriter.status === 0 && wrongBuild.result.stoppedAt === 'assemble' && rigCalls === 0 &&
    wrongBuild.lines.some(line => line.includes('ASSEMBLE_EDITED_PART_BASELINE:') && line.includes(wrongHash) && line.includes(expected.from_sha256)) && !existsSync(join(dir, 'wrong-build')),
    `writer exit ${wrongWriter.status}; build stops at assemble with current and recorded hashes, before output or rig`);
  const correctWriter = cli(args), correctBuild = runBuild('correct-build');
  say('CORRECT_FROM_BUILD_ACCEPTS_BASELINE_AND_REACHES_RIG', correctWriter.status === 0 && correctBuild.result.stoppedAt === 'rig' && rigCalls === 1 &&
    !correctBuild.lines.some(line => line.includes('ASSEMBLE_EDITED_PART_BASELINE:')) &&
    readFileSync(join(dir, 'correct-build', 'parts', 'body.png')).equals(readFileSync(file)),
    `writer exit ${correctWriter.status}; real build/assemble accepts receipt and emits exact edited bytes, then reaches injected rig sentinel`);
  say('NO_STAGED_FILES_LEFT', [dir, rigDir].every(at => readdirSync(at).every(name => !name.includes('.edited-part-') && !name.includes('.rig-parts-'))),
    'successful writes and validation refusals leave no staging files');
}
