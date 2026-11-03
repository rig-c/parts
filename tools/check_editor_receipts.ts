/** Generated controls for #946: editor receipts held to the bytes on disk, demanded only when declared required. */
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RECEIPT_AUTHOR_FILE, writeEditorReceiptFixture } from '../fixtures/editor_receipts.ts';
import { assembleStage, readRuns } from '../src/build.ts';
import { loadEarlyConfig, parseConfig, parseEarlyConfig } from '../src/config.ts';
import { editedConfigImages, editedRunImages, fileSha256, missingReceipts, readEditorReceipts, receiptFor } from '../src/editreceipt.ts';
import { PartsError } from '../src/errors.ts';
import { readPng, encodePngBytes } from '../src/raster/png.ts';

type Say = (name: string, pass: boolean, detail: string) => void;

const FROM = 'a'.repeat(64);

export function runEditorReceiptChecks(dir: string, say: Say): void {
  const run = (d: string, out = 'out', alts?: Array<{ name: string; source: string; full: string }>) => assembleStage({ source: join(d, 'painting.png'), full: join(d, 'full'), head: null, config: join(d, 'config.json'), seam: 'near-white', project: 'core', ...(alts === undefined ? {} : { alts }) },
    { partsJson: join(d, out, 'parts.json'), partsDir: join(d, out, 'parts'), recomposite: join(d, out, 'recomposite.png'), errorMap: join(d, out, 'error.png') }, () => {});
  const message = (action: () => unknown): string => { try { action(); return ''; } catch (e) { if (e instanceof PartsError) return e.message; throw e; } };
  const codes = (action: () => unknown): string[] => { try { action(); return []; } catch (e) { if (e instanceof PartsError) return e.problems.map(p => `${p.code} ${p.object}`); throw e; } };
  const save = (d: string, cfg: Record<string, unknown>): void => writeFileSync(join(d, 'config.json'), JSON.stringify(cfg));
  const receipts = (cfg: Record<string, unknown>, block: unknown): Record<string, unknown> => { (cfg.assemble as Record<string, unknown>).editor_receipts = block; return cfg; };
  const fresh = (name: string, options: { author?: boolean; hidden?: boolean } = {}) => { const d = join(dir, name); const cfg = writeEditorReceiptFixture(d, options); return { d, cfg, sha: options.author === false ? '' : fileSha256(join(d, RECEIPT_AUTHOR_FILE)) }; };
  const receipt = (sha: string, file = RECEIPT_AUTHOR_FILE) => ({ file, sha256: sha, from_sha256: FROM, editor: 'an image editor' });

  // Undeclared: today's behaviour, the control every other case is compared with.
  const plain = fresh('undeclared');
  let plainOk = false;
  try { run(plain.d); plainOk = existsSync(join(plain.d, 'out', 'parts.json')); } catch (e) { say('UNDECLARED_ASSEMBLES', false, e instanceof Error ? e.message : String(e)); }
  if (plainOk) say('UNDECLARED_ASSEMBLES', true, 'no editor_receipts block: an author layer without a receipt assembles as before');

  // Positive control: required, one receipt whose sha256 is the file's.
  const good = fresh('positive'); save(good.d, receipts(good.cfg, { required: true, receipts: [receipt(good.sha)] }));
  let goodMessage = '';
  try { run(good.d); } catch (e) { goodMessage = e instanceof Error ? e.message : String(e); }
  const same = goodMessage === '' && plainOk && readFileSync(join(good.d, 'out', 'parts.json')).equals(readFileSync(join(plain.d, 'out', 'parts.json')));
  say('MATCHING_RECEIPT_PASSES_BYTE_IDENTICAL', same, goodMessage || `parts.json equals the undeclared build's: ${same}`);

  // Planted: an edited image without a receipt, under required.
  const bare = fresh('missing'); save(bare.d, receipts(bare.cfg, { required: true, receipts: [] }));
  const bareMessage = message(() => run(bare.d));
  say('EDITED_IMAGE_WITHOUT_RECEIPT_REFUSED', bareMessage.startsWith('ASSEMBLE_EDITOR_RECEIPT_MISSING: full:author:hand — ') && bareMessage.includes(`sha256 ${bare.sha}`) && !existsSync(join(bare.d, 'out')), bareMessage || 'accepted');

  // Planted: a receipt whose sha256 is not the file's; verified with and without required.
  const wrong = 'b'.repeat(64);
  for (const required of [true, undefined]) {
    const f = fresh(required === true ? 'mismatch-required' : 'mismatch-declared'); save(f.d, receipts(f.cfg, { ...(required === undefined ? {} : { required }), receipts: [receipt(wrong)] }));
    const m = message(() => run(f.d));
    say(required === true ? 'MISMATCHING_SHA256_REFUSED' : 'MISMATCHING_SHA256_REFUSED_WITHOUT_REQUIRED',
      m.startsWith(`ASSEMBLE_EDITOR_RECEIPT_SHA256: config.assemble.editor_receipts.receipts[0] (file "${RECEIPT_AUTHOR_FILE}") — the file's bytes hash to sha256 ${f.sha}; the receipt's sha256 ${wrong} is required`) && !existsSync(join(f.d, 'out')), m || 'accepted');
  }

  // Planted: the image edited after its receipt was written (one byte of one pixel).
  const edited = fresh('edited-after'); save(edited.d, receipts(edited.cfg, { required: true, receipts: [receipt(edited.sha)] }));
  const png = join(edited.d, RECEIPT_AUTHOR_FILE); const img = readPng(png); img.data[0] ^= 1; writeFileSync(png, encodePngBytes(img));
  const after = fileSha256(png); const editedMessage = message(() => run(edited.d));
  say('IMAGE_CHANGED_AFTER_RECEIPT_REFUSED', editedMessage.includes('ASSEMBLE_EDITOR_RECEIPT_SHA256') && editedMessage.includes(`hash to sha256 ${after}`) && editedMessage.includes(`ASSEMBLE_EDITOR_RECEIPT_MISSING: full:author:hand`), editedMessage || 'accepted');

  // Planted: a receipt naming no file.
  const gone = fresh('no-file'); save(gone.d, receipts(gone.cfg, { receipts: [receipt(gone.sha, 'absent.png')] }));
  const goneMessage = message(() => run(gone.d));
  say('RECEIPT_FILE_ABSENT_REFUSED', goneMessage.startsWith('ASSEMBLE_EDITOR_RECEIPT_FILE: config.assemble.editor_receipts.receipts[0] (file "absent.png")'), goneMessage || 'accepted');

  // Planted: a hidden-art layer is an edited image too.
  const hidden = fresh('hidden', { hidden: true }); save(hidden.d, receipts(hidden.cfg, { required: true, receipts: [receipt(hidden.sha)] }));
  const hiddenCodes = codes(() => run(hidden.d));
  say('HIDDEN_ART_WITHOUT_RECEIPT_REFUSED', hiddenCodes.length === 1 && hiddenCodes[0] === 'ASSEMBLE_EDITOR_RECEIPT_MISSING full:face:hidden', JSON.stringify(hiddenCodes));

  // Unedited input: required on a run with no author or hidden layer demands nothing and moves no byte.
  const clean = fresh('unedited', { author: false }); run(clean.d, 'plain');
  save(clean.d, receipts(clean.cfg, { required: true, receipts: [] })); run(clean.d, 'required');
  say('UNEDITED_INPUT_UNCHANGED_UNDER_REQUIRED', readFileSync(join(clean.d, 'plain', 'parts.json')).equals(readFileSync(join(clean.d, 'required', 'parts.json'))), 'no author-made or hidden-art layer: nothing to receipt');

  // Planted: an alternate set's own edited image is demanded too; the base's receipt does not cover other bytes.
  const alt = fresh('alternate'); save(alt.d, receipts(alt.cfg, { required: true, receipts: [receipt(alt.sha)] }));
  cpSync(join(alt.d, 'full'), join(alt.d, 'alt-full'), { recursive: true });
  const altPng = join(alt.d, 'alt-full', 'parts', 'author:hand.png'); const altImg = readPng(altPng); altImg.data[0] ^= 1; writeFileSync(altPng, encodePngBytes(altImg));
  const altCodes = codes(() => run(alt.d, 'out', [{ name: 'raised', source: join(alt.d, 'painting.png'), full: join(alt.d, 'alt-full') }]));
  say('ALTERNATE_SET_EDITED_IMAGE_REFUSED', altCodes.includes('ASSEMBLE_EDITOR_RECEIPT_MISSING alternate set "raised" full:author:hand') && !altCodes.some(c => c.endsWith(' full:author:hand') && !c.includes('raised')), JSON.stringify(altCodes));

  // Cut unders and limb caps are named as the config names them; matched by content.
  const under = editedConfigImages(join(dir, 'positive', 'config.json'), [{ into: 'sleeve', under: RECEIPT_AUTHOR_FILE }, { into: 'cuff' }], { arm: { segments: [{ part: 'upper' }, { part: 'lower', cap: 'absent-cap.png' }] } });
  const ledger = readEditorReceipts({ required: true, receipts: [receipt(good.sha)] }, join(good.d, 'config.json'));
  const underProblems = missingReceipts(readEditorReceipts({ required: true, receipts: [] }, join(good.d, 'config.json')), under);
  say('UNDER_AND_CAP_NAMED_BY_CONFIG_PATH', under.length === 2 && under[0].object === 'config.assemble.cuts[0].under (part "sleeve")' && under[1].object === 'config.limbs.arm.segments[1].cap (part "lower")' &&
    missingReceipts(ledger, under).length === 0 && underProblems.length === 1 && underProblems[0].object === under[0].object, JSON.stringify({ under, underProblems }));

  // The lookup #947 traces through, and the run images' names.
  const images = editedRunImages(readRuns(join(good.d, 'full'), null));
  const found = receiptFor(ledger, resolve(good.d, RECEIPT_AUTHOR_FILE));
  say('RECEIPT_LOOKUP_BY_CONTENT', images.length === 1 && images[0].object === 'full:author:hand' && found?.at === 'config.assemble.editor_receipts.receipts[0]' && receiptFor(ledger, join(good.d, 'painting.png')) === null, JSON.stringify({ images: images.map(i => i.object), found: found?.at }));

  // The loader: shape, form and consistency at every config door; nothing about the file is read there.
  const base = JSON.parse(readFileSync(join(good.d, 'config.json'), 'utf8')) as Record<string, unknown>;
  const loaderCases: Array<[string, unknown, string, string]> = [
    ['REQUIRED_NOT_BOOLEAN', { required: 'yes', receipts: [] }, 'CONFIG_FIELD_TYPE', 'config.assemble.editor_receipts.required'],
    ['RECEIPTS_ABSENT', { required: true }, 'CONFIG_FIELD_PRESENT', 'config.assemble.editor_receipts.receipts'],
    ['SHA256_NOT_HEX', { receipts: [{ ...receipt(good.sha), sha256: good.sha.toUpperCase() }] }, 'CONFIG_FIELD_TYPE', 'config.assemble.editor_receipts.receipts[0].sha256'],
    ['FROM_EQUALS_SHA256', { receipts: [{ ...receipt(good.sha), from_sha256: good.sha }] }, 'CONFIG_EDITOR_RECEIPT', 'config.assemble.editor_receipts.receipts[0].from_sha256'],
    ['EDITOR_EMPTY', { receipts: [{ ...receipt(good.sha), editor: '' }] }, 'CONFIG_FIELD_TYPE', 'config.assemble.editor_receipts.receipts[0].editor'],
    ['FIELD_UNKNOWN', { receipts: [{ ...receipt(good.sha), tool: 'x' }] }, 'CONFIG_KEY_KNOWN', 'config.assemble.editor_receipts.receipts[0].tool'],
    ['FIELD_ABSENT', { receipts: [{ file: RECEIPT_AUTHOR_FILE, sha256: good.sha, editor: 'an image editor' }] }, 'CONFIG_FIELD_PRESENT', 'config.assemble.editor_receipts.receipts[0].from_sha256'],
    ['FILE_TWICE', { receipts: [receipt(good.sha), receipt(good.sha)] }, 'CONFIG_EDITOR_RECEIPT', 'config.assemble.editor_receipts.receipts[1].file'],
  ];
  for (const [name, block, code, object] of loaderCases) {
    const raw = JSON.parse(JSON.stringify(base)) as Record<string, unknown>; receipts(raw, block);
    const doors = [() => parseEarlyConfig(raw as never, 'assemble'), () => parseEarlyConfig(raw as never, 'layers'), () => parseConfig(raw as never)];
    const hits = doors.map(door => codes(door).includes(`${code} ${object}`));
    say(`LOADER_${name}`, hits.every(Boolean), `${code} ${object} at assemble/layers/full doors: ${hits.join('/')}`);
  }
  const accepted = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  say('LOADER_ACCEPTS_VALID_BLOCK', codes(() => loadEarlyConfig(join(good.d, 'config.json'), 'assemble')).length === 0 && codes(() => parseEarlyConfig(accepted as never, 'layers')).length === 0 && codes(() => parseConfig(accepted as never)).length === 0, 'a valid block passes every door');

  // The command line: exit 1 and the refusal line, nothing written.
  const cli = spawnSync(process.execPath, ['cli.ts', 'assemble', '--source', join(bare.d, 'painting.png'), '--full', join(bare.d, 'full'), '--config', join(bare.d, 'config.json'), '--out', join(bare.d, 'cli')], { encoding: 'utf8' });
  say('CLI_EXIT_1_NAMES_THE_IMAGE', cli.status === 1 && `${cli.stdout}${cli.stderr}`.includes('ASSEMBLE_EDITOR_RECEIPT_MISSING: full:author:hand') && !existsSync(join(bare.d, 'cli', 'rig')), `exit ${cli.status}: ${`${cli.stdout}${cli.stderr}`.trim().split('\n')[0]}`);
}
