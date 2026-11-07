/**
 * Controls for the step-4 plate producer (issue #1183), judged on what the
 * comfy harness (`fixtures/comfyharness.ts`) left in its work directory: every
 * scenario ran the CLI against the fake ComfyUI on 127.0.0.1, never a real box.
 *
 * The selftest's comfy suite calls `runPlateChecks` with the harness's
 * results; run alone it starts the harness itself:
 *
 *   bun tools/check_plate.ts <work dir>
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FAKE_FILL } from '../fixtures/fakecomfy.ts';
import { PLATE_RECEIPT_KEYS, PLATE_RECEIPT_SPEC, runForeground, sha256, verifyPlateReceipt } from '../src/plate.ts';
import { decodePngBytes, encodePngBytes } from '../src/raster/png.ts';

export interface PlateHarnessResult {
  status: number;
  out: string;
  paths: string[];
  uploads: string[];
  prompts: number;
  fronts?: number;
}

type Say = (name: string, pass: boolean, detail: string, why: string) => void;

function failLine(out: string, code: string): string | null {
  return out.split('\n').find((l) => l.includes(`FAIL  ${code}`))?.trim() ?? null;
}

/** Each source plant is restored byte for byte, then accepted through the CLI's foreground entry point. */
function figureBindingChecks(dir: string, painting: string, say: Say): void {
  const root = join(dir, 'plate_figure_source');
  const rig = join(root, 'rig');
  const stampPath = join(root, 'run.json');
  const partsPath = join(rig, 'parts.json');
  const maskPath = join(rig, 'figure_rig.png');
  const paintingPath = join(rig, 'painting_in_rig.png');
  const files = [stampPath, partsPath, maskPath, paintingPath];
  const original = files.map(file => readFileSync(file));
  const md5 = (): string[] => files.map(file => existsSync(file) ? createHash('md5').update(readFileSync(file)).digest('hex') : 'absent');
  const before = md5();
  const stamp = JSON.parse(original[0].toString()) as { spec: string; command: string; outputs: Array<{ path: string; sha256: string }> };
  const parts = JSON.parse(original[1].toString()) as { painting_in_rig: { path: string; sha256: string; resample: string } };
  const writeStamp = (change: (s: typeof stamp) => void): void => {
    const s = structuredClone(stamp);
    change(s);
    writeFileSync(stampPath, JSON.stringify(s));
  };
  const restamp = (path: string): void => writeStamp(s => {
    const entry = s.outputs.find(e => e.path === `rig/${path}`)!;
    entry.sha256 = sha256(readFileSync(join(rig, path)));
  });
  const plants: Array<{ name: string; code: string; plant: () => void }> = [
    { name: 'missing-run', code: 'PLATE_MASK_RUN', plant: () => rmSync(stampPath) },
    { name: 'malformed-run', code: 'PLATE_MASK_RUN', plant: () => writeFileSync(stampPath, '{') },
    { name: 'null-run', code: 'PLATE_MASK_RUN', plant: () => writeFileSync(stampPath, 'null') },
    { name: 'wrong-spec', code: 'PLATE_MASK_RUN', plant: () => writeStamp(s => { s.spec = 'rig-run/0'; }) },
    { name: 'wrong-command', code: 'PLATE_MASK_RUN', plant: () => writeStamp(s => { s.command = 'rig'; }) },
    { name: 'missing-outputs', code: 'PLATE_MASK_RUN', plant: () => writeFileSync(stampPath, JSON.stringify({ ...stamp, outputs: null })) },
    { name: 'missing-entry', code: 'PLATE_MASK_RUN', plant: () => writeStamp(s => { s.outputs = s.outputs.filter(e => e.path !== 'rig/figure_rig.png'); }) },
    { name: 'duplicate-entry', code: 'PLATE_MASK_RUN', plant: () => writeStamp(s => { s.outputs.push(s.outputs.find(e => e.path === 'rig/figure_rig.png')!); }) },
    { name: 'stale-mask', code: 'PLATE_MASK_RUN', plant: () => {
      const r = decodePngBytes(original[2], maskPath);
      r.data.set([255, 255, 255, 255], 0);
      writeFileSync(maskPath, encodePngBytes(r));
    } },
    { name: 'stale-parts', code: 'PLATE_MASK_RUN', plant: () => writeFileSync(partsPath, JSON.stringify({ ...parts, painting_in_rig: undefined })) },
    { name: 'bad-painting-declaration', code: 'PLATE_MASK_PAINTING', plant: () => {
      writeFileSync(partsPath, JSON.stringify({ ...parts, painting_in_rig: { ...parts.painting_in_rig, path: '../other.png' } }));
      restamp('parts.json');
    } },
    { name: 'missing-recorded-painting', code: 'PLATE_MASK_PAINTING', plant: () => rmSync(paintingPath) },
    { name: 'stale-recorded-painting', code: 'PLATE_MASK_RUN', plant: () => writeFileSync(paintingPath, 'stale') },
    { name: 'unstamped-recorded-painting', code: 'PLATE_MASK_RUN', plant: () => writeStamp(s => { s.outputs = s.outputs.filter(e => e.path !== 'rig/painting_in_rig.png'); }) },
    { name: 'undecodable-recorded-painting', code: 'PLATE_MASK_PAINTING', plant: () => {
      writeFileSync(paintingPath, 'not a PNG');
      writeFileSync(partsPath, JSON.stringify({ ...parts, painting_in_rig: { ...parts.painting_in_rig, sha256: sha256(readFileSync(paintingPath)) } }));
      writeStamp(s => {
        for (const file of ['parts.json', 'painting_in_rig.png']) s.outputs.find(e => e.path === `rig/${file}`)!.sha256 = sha256(readFileSync(join(rig, file)));
      });
    } },
    { name: 'declaration-hash-mismatch', code: 'PLATE_MASK_PAINTING', plant: () => {
      writeFileSync(partsPath, JSON.stringify({ ...parts, painting_in_rig: { ...parts.painting_in_rig, sha256: '0'.repeat(64) } }));
      restamp('parts.json');
    } },
  ];
  const evidence: unknown[] = [];
  const run = (name: string): void => { runForeground({ painting, maskFrom: `figure-mask:${rig}`, out: join(dir, `binding-${name}`) }); };
  for (const p of plants) {
    let message = '', restoredGreen = false;
    let planted: string[] = [];
    try {
      p.plant();
      planted = md5();
      try { run(p.name); } catch (err) { message = (err as Error).message; }
    } finally {
      files.forEach((file, i) => writeFileSync(file, original[i]));
    }
    const restored = md5();
    try { run(`${p.name}-restored`); restoredGreen = true; } catch (err) { message += ` restored: ${(err as Error).message}`; }
    const pass = message.includes(p.code) && !existsSync(join(dir, `binding-${p.name}`)) && restoredGreen && restored.join(',') === before.join(',');
    evidence.push({ name: p.name, files, before, planted, restored, message, restoredGreen, pass });
    say(`PB07_FIGURE_SOURCE_${p.name.toUpperCase().replaceAll('-', '_')}_IS_REFUSED_AND_RESTORED`, pass,
      `${p.code}: ${message}; restored accepted ${restoredGreen}; md5 before ${before.join(',')} planted ${planted.join(',')} restored ${restored.join(',')}`,
      'issue #1188: an unstamped or stale source is refused before a plate is written; the restored source is accepted');
  }
  const other = join(dir, 'binding-other-painting.png');
  const r = decodePngBytes(readFileSync(painting), painting);
  r.data[0] ^= 1;
  writeFileSync(other, encodePngBytes(r));
  let message = '';
  try { runForeground({ painting: other, maskFrom: `figure-mask:${rig}`, out: join(dir, 'binding-other-painting') }); }
  catch (err) { message = (err as Error).message; }
  say('PB08_A_DIFFERENT_PAINTING_ON_THE_SAME_GRID_IS_REFUSED', message.includes('PLATE_MASK_PAINTING') && !existsSync(join(dir, 'binding-other-painting')),
    message, 'issue #1188: the stamped painting_in_rig binds decoded opaque RGB, using assemble\'s own conversion');
  const equivalent = join(dir, 'binding-equivalent-painting.png');
  const rgba = decodePngBytes(readFileSync(painting), painting);
  for (let i = 3; i < rgba.data.length; i += 4) rgba.data[i] = 0;
  writeFileSync(equivalent, encodePngBytes(rgba));
  let equivalentGreen = false;
  try {
    runForeground({ painting: equivalent, maskFrom: `figure-mask:${rig}`, out: join(dir, 'binding-equivalent-painting') });
    equivalentGreen = true;
  } catch (err) { message = (err as Error).message; }
  say('PB10_THE_PAINTING_BINDING_USES_ASSEMBLES_OPAQUE_RGB', equivalentGreen,
    equivalentGreen ? 'identical RGB with alpha 0 accepted against the recorded opaque RGB; another RGB value was refused by PB08' : message,
    'painting_in_rig records assemble\'s opaque RGB, so source PNG bytes and source alpha are not its identity');
  writeFileSync(join(dir, 'figure-binding-evidence.json'), JSON.stringify(evidence, null, 2));
}

/** Pixels outside the receipt's mask that differ from the painting, and pixels inside it that are not the fake's fill. */
function pasteBack(dir: string, painting: string): { outsideDiff: number; insideWrong: number; inside: number } | null {
  try {
    const p = decodePngBytes(new Uint8Array(readFileSync(painting)), painting);
    const m = decodePngBytes(new Uint8Array(readFileSync(join(dir, 'mask.png'))), 'mask');
    const o = decodePngBytes(new Uint8Array(readFileSync(join(dir, 'plate.png'))), 'plate');
    let outsideDiff = 0, insideWrong = 0, inside = 0;
    for (let i = 0; i < p.width * p.height; i++) {
      if (m.data[i * 4] === 255) {
        inside++;
        if (o.data[i * 4] !== FAKE_FILL[0] || o.data[i * 4 + 1] !== FAKE_FILL[1] || o.data[i * 4 + 2] !== FAKE_FILL[2] || o.data[i * 4 + 3] !== 255) insideWrong++;
      } else if ([0, 1, 2, 3].some((c) => o.data[i * 4 + c] !== p.data[i * 4 + c])) outsideDiff++;
    }
    return { outsideDiff, insideWrong, inside };
  } catch {
    return null;
  }
}

export function runPlateChecks(dir: string, painting: string, R: Record<string, PlateHarnessResult>, say: Say): void {
  figureBindingChecks(dir, painting, say);
  const nothingAsked = (r: PlateHarnessResult | undefined): boolean => r !== undefined && r.paths.length === 0 && r.uploads.length === 0 && r.prompts === 0;
  const nothingWritten = (name: string): boolean => !existsSync(join(dir, name));
  const noUpload = (r: PlateHarnessResult | undefined): boolean => r !== undefined && r.uploads.length === 0 && r.prompts === 0 && !r.paths.includes('POST /upload/image');

  const bound = ['plate-unstamped', 'plate-stale-mask', 'plate-other-painting'].map(n => [n, R[n]] as const);
  say('PB09_BACKGROUND_REFUSES_UNBOUND_FIGURE_SOURCES_BEFORE_ANY_REQUEST',
    bound.every(([n, r]) => r?.status === 1 && failLine(r.out, n === 'plate-other-painting' ? 'PLATE_MASK_PAINTING' : 'PLATE_MASK_RUN') !== null && nothingAsked(r) && nothingWritten(n)),
    bound.map(([n, r]) => `${n}: exit ${r?.status}, requests ${r?.paths.length}, uploads ${r?.uploads.length}, prompts ${r?.prompts}; ${r?.out}`).join('; '),
    'issue #1188: background checks source provenance before connecting to the fake ComfyUI');

  // 1. a missing node or model is refused by name before anything is uploaded; core still runs on that box
  const noPack = R['plate-no-inpaint-lama'], noModel = R['plate-missing-model'], coreOnBare = R['plate-no-inpaint-core'];
  const nodeLine = noPack === undefined ? null : failLine(noPack.out, 'COMFY_NODE_PRESENT');
  const modelLine = noModel === undefined ? null : failLine(noModel.out, 'COMFY_CHOICE_PRESENT');
  say(
    'PB01_A_MISSING_NODE_OR_MODEL_IS_REFUSED_BY_NAME_BEFORE_UPLOAD_AND_CORE_STILL_RUNS_WITHOUT_THE_PACK',
    noPack?.status === 1 && nodeLine !== null && nodeLine.includes('INPAINT_') && noUpload(noPack) && noPack.paths.includes('GET /object_info') && nothingWritten('plate-no-inpaint-lama') &&
      noModel?.status === 1 && modelLine !== null && modelLine.includes('not_on_the_box.pt') && noUpload(noModel) && nothingWritten('plate-missing-model') &&
      coreOnBare?.status === 0 && existsSync(join(dir, 'plate-no-inpaint-core', 'receipt.json')),
    `no pack: exit ${noPack?.status}, "${nodeLine ?? 'no COMFY_NODE_PRESENT line'}", uploads ${noPack?.uploads.length}, prompts ${noPack?.prompts}; missing model: exit ${noModel?.status}, "${modelLine ?? 'no COMFY_CHOICE_PRESENT line'}", uploads ${noModel?.uploads.length}; core on the same box: exit ${coreOnBare?.status}`,
    'issue #1183 bar 1: the capability check runs against /object_info before anything is uploaded; a box without the inpaint pack refuses lama cleanly and still runs core',
  );

  // 2. no source mask: refused by name, nothing written, no job (no request at all)
  const noMask = ['plate-no-mask', 'plate-no-source', 'plate-no-scene', 'plate-fg-no-mask'].map((n) => [n, R[n]] as const);
  say(
    'PB02_WITH_NO_SOURCE_MASK_THE_PLATE_IS_REFUSED_BY_NAME_WRITES_NOTHING_AND_RUNS_NO_JOB',
    noMask.every(([n, r]) => r?.status === 1 && failLine(r.out, 'PLATE_MASK_SOURCE') !== null && nothingAsked(r) && nothingWritten(n)),
    noMask.map(([n, r]) => `${n}: exit ${r?.status}, "${r === undefined ? 'not run' : failLine(r.out, 'PLATE_MASK_SOURCE') ?? 'no PLATE_MASK_SOURCE line'}", requests ${r?.paths.length}, out ${nothingWritten(n) ? 'absent' : 'WRITTEN'}`).join('; '),
    'issue #1183 bar 2: the mask comes from a source (See-through figure layers or the declared figure mask), never a hand polygon; with none the command names what is missing and touches nothing',
  );

  // 3. receipt hashes match the bytes on disk, and a planted mismatch is caught
  const receipts = ['plate-lama-ok', 'plate-core-ok', 'plate-fg'].map((n) => [n, join(dir, n, 'receipt.json')] as const);
  const clean = receipts.map(([n, f]) => [n, existsSync(f) ? verifyPlateReceipt(f) : [{ code: 'ABSENT', object: f, detail: '' }]] as const);
  const keyOrder = receipts.every(([, f]) => existsSync(f) && Object.keys(JSON.parse(readFileSync(f, 'utf8')) as object).join(',') === PLATE_RECEIPT_KEYS.join(','));
  const plants: Array<[string, string, string]> = [];
  for (const [field, file] of [['output', 'plate.png'], ['mask', 'mask.png']] as const) {
    const copy = join(dir, `plate-lama-ok-plant-${field}`);
    cpSync(join(dir, 'plate-lama-ok'), copy, { recursive: true });
    const bytes = readFileSync(join(copy, file));
    bytes[bytes.length - 20] ^= 0xff;
    writeFileSync(join(copy, file), bytes);
    const caught = verifyPlateReceipt(join(copy, 'receipt.json')).find((p) => p.code === 'PLATE_RECEIPT_HASH' && p.object.endsWith(` ${field}`));
    plants.push([field, caught === undefined ? '' : caught.code, caught?.detail ?? '']);
  }
  {
    const copy = join(dir, 'plate-lama-ok-plant-painting');
    cpSync(join(dir, 'plate-lama-ok'), copy, { recursive: true });
    const r = JSON.parse(readFileSync(join(copy, 'receipt.json'), 'utf8')) as { painting: { sha256: string } };
    r.painting.sha256 = '0'.repeat(64);
    writeFileSync(join(copy, 'receipt.json'), JSON.stringify(r, null, 2));
    const caught = verifyPlateReceipt(join(copy, 'receipt.json')).find((p) => p.code === 'PLATE_RECEIPT_HASH' && p.object.endsWith(' painting'));
    plants.push(['painting', caught === undefined ? '' : caught.code, caught?.detail ?? '']);
  }
  const lama = existsSync(receipts[0][1]) ? (JSON.parse(readFileSync(receipts[0][1], 'utf8')) as Record<string, unknown>) : {};
  const fg = existsSync(receipts[2][1]) ? (JSON.parse(readFileSync(receipts[2][1], 'utf8')) as Record<string, unknown>) : {};
  const model = lama.model as { checkpoint_sha256_from?: unknown } | null | undefined;
  say(
    'PB03_THE_RECEIPT_HASHES_MATCH_THE_BYTES_ON_DISK_AND_A_PLANTED_MISMATCH_IS_CAUGHT',
    clean.every(([, p]) => p.length === 0) && keyOrder && plants.every(([, c]) => c === 'PLATE_RECEIPT_HASH') &&
      lama.spec === PLATE_RECEIPT_SPEC && lama.gpu === 'cuda:0 Fake GPU' && model?.checkpoint_sha256_from === 'declared' &&
      fg.model === null && fg.gpu === null && fg.graph === 'rig-parts/plate-foreground/1',
    `${clean.map(([n, p]) => `${n}: ${p.length === 0 ? 'verifies' : p.map((x) => x.code).join(',')}`).join('; ')}; key order ${keyOrder ? 'as PLATE_RECEIPT_KEYS' : 'OTHER'}; planted: ${plants.map(([f, c]) => `${f} -> ${c || 'NOT CAUGHT'}`).join(', ')}; lama gpu ${JSON.stringify(lama.gpu)}, checksum from ${JSON.stringify(model?.checkpoint_sha256_from)}; foreground model ${JSON.stringify(fg.model)}, gpu ${JSON.stringify(fg.gpu)}`,
    'issue #1183 bar 3: the receipt is what create binds to; a hash that is not the file\'s is a receipt for other bytes',
  );

  // 4. outside the mask the plate is the painting byte for byte (the fake drifts every outside red byte by one)
  const pb = ['plate-lama-ok', 'plate-core-ok'].map((n) => [n, pasteBack(join(dir, n), painting)] as const);
  const fgPaste = (() => {
    try {
      const p = decodePngBytes(new Uint8Array(readFileSync(painting)), painting);
      const m = decodePngBytes(new Uint8Array(readFileSync(join(dir, 'plate-fg', 'mask.png'))), 'mask');
      const o = decodePngBytes(new Uint8Array(readFileSync(join(dir, 'plate-fg', 'plate.png'))), 'plate');
      let bad = 0;
      for (let i = 0; i < p.width * p.height; i++) for (let c = 0; c < 4; c++) if (o.data[i * 4 + c] !== (m.data[i * 4] === 255 ? p.data[i * 4 + c] : 0)) bad++;
      return bad;
    } catch {
      return -1;
    }
  })();
  // The witness: one outside byte moved by the fake's drift is seen.
  const witness = (() => {
    try {
      const copy = join(dir, 'plate-core-ok-plant-outside');
      cpSync(join(dir, 'plate-core-ok'), copy, { recursive: true });
      const m = decodePngBytes(new Uint8Array(readFileSync(join(copy, 'mask.png'))), 'mask');
      const o = decodePngBytes(new Uint8Array(readFileSync(join(copy, 'plate.png'))), 'plate');
      const i = m.data.findIndex((v, k) => k % 4 === 0 && v === 0);
      o.data[i] = (o.data[i] + 1) % 256;
      writeFileSync(join(copy, 'plate.png'), encodePngBytes(o));
      return pasteBack(copy, painting)?.outsideDiff ?? -1;
    } catch {
      return -1;
    }
  })();
  say(
    'PB04_OUTSIDE_THE_MASK_THE_BACKGROUND_PLATE_IS_THE_PAINTING_BYTE_FOR_BYTE_AND_THE_FOREGROUND_IS_THE_PAINTING_INSIDE_IT',
    pb.every(([, x]) => x !== null && x.outsideDiff === 0 && x.insideWrong === 0 && x.inside > 0) && fgPaste === 0 && witness === 1,
    `${pb.map(([n, x]) => `${n}: ${x === null ? 'unreadable' : `${x.outsideDiff} outside px differ, ${x.insideWrong} of ${x.inside} inside px not the box's`}`).join('; ')} (the fake added +1 to every red byte outside the mask); foreground: ${fgPaste} byte(s) not painting-inside/zero-outside; planted, one outside red byte moved by 1 -> ${witness} px seen`,
    'ruling 1 for #1183: the paste-back is inside the mask only, so a float round trip on the box cannot move a pixel the figure did not cover',
  );

  // 5. queue: appended behind others, never in front; a long wait is refused with the queue place
  const busy = R['plate-busy'], behind = R['plate-behind'];
  const behindLine = behind === undefined ? null : failLine(behind.out, 'COMFY_QUEUE_BEHIND');
  const fronts = Object.entries(R).filter(([n]) => n.startsWith('plate-')).reduce((a, [, r]) => a + (r.fronts ?? 0), 0);
  say(
    'PB05_THE_PLATE_JOB_IS_APPENDED_BEHIND_OTHERS_AND_A_LONG_WAIT_IS_REFUSED_WITH_ITS_QUEUE_PLACE',
    busy?.status === 0 && behind?.status === 1 && behindLine !== null && /place 2 of 2 pending with 2 job\(s\) ahead/.test(behindLine) && behind.prompts === 1 && fronts === 0 && nothingWritten('plate-behind') &&
      !(busy?.paths ?? []).some((p) => p.startsWith('POST /queue') || p.startsWith('POST /interrupt')) && !(behind?.paths ?? []).some((p) => p.startsWith('POST /queue') || p.startsWith('POST /interrupt')),
    `someone else running: exit ${busy?.status} (queued behind it); stuck behind two: exit ${behind?.status}, "${behindLine ?? 'no COMFY_QUEUE_BEHIND line'}"; /prompt bodies asking for the front: ${fronts}; no POST /queue or /interrupt sent`,
    'ruling 4 for #1183: the plate appends behind other jobs, never cuts in, never reorders or cancels; on a long wait it stops and says where it stands',
  );

  // 6. --checkpoint-sha256: malformed or absent is refused by name before any request; the valid one is recorded
  const badSha = R['plate-bad-sha'], noSha = R['plate-no-sha'], goodSha = R['plate-lama-ok'];
  const shaLine = (r: PlateHarnessResult | undefined): string | null => (r === undefined ? null : failLine(r.out, 'PLATE_CHECKPOINT_SHA256'));
  const declared = (model as { checkpoint_sha256?: unknown } | null | undefined)?.checkpoint_sha256;
  say(
    'PB06_A_MALFORMED_OR_ABSENT_CHECKPOINT_SHA256_IS_REFUSED_BY_NAME_WITH_NO_REQUEST_AND_NOTHING_WRITTEN',
    badSha?.status === 1 && shaLine(badSha)?.includes('"not-a-hash"') === true && nothingAsked(badSha) && nothingWritten('plate-bad-sha') &&
      noSha?.status === 1 && shaLine(noSha)?.includes('is absent') === true && nothingAsked(noSha) && nothingWritten('plate-no-sha') &&
      goodSha?.status === 0 && declared === 'ab'.repeat(32) && model?.checkpoint_sha256_from === 'declared',
    `malformed: exit ${badSha?.status}, "${shaLine(badSha) ?? 'no PLATE_CHECKPOINT_SHA256 line'}", requests ${badSha?.paths.length}, out ${nothingWritten('plate-bad-sha') ? 'absent' : 'WRITTEN'}; absent: exit ${noSha?.status}, "${shaLine(noSha) ?? 'no PLATE_CHECKPOINT_SHA256 line'}", requests ${noSha?.paths.length}, out ${nothingWritten('plate-no-sha') ? 'absent' : 'WRITTEN'}; valid (the harness's 64 hex characters): exit ${goodSha?.status}, recorded ${JSON.stringify(declared)} from ${JSON.stringify(model?.checkpoint_sha256_from)}`,
    'ruling 3 for #1183: the box reports no hash, so the receipt carries a declared one; a missing or malformed declaration is refused before the box is reached, never recorded',
  );
}

if (import.meta.main) {
  const work = process.argv[2];
  if (work === undefined) {
    console.error('usage: bun tools/check_plate.ts <work dir>');
    process.exit(2);
  }
  const h = spawnSync('bun', [join(import.meta.dir, '..', 'fixtures', 'comfyharness.ts'), work], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const parsed = JSON.parse((h.stdout ?? '').trim().split('\n').pop() ?? '{}') as { platePainting: string; results: Record<string, PlateHarnessResult> };
  let bad = 0;
  runPlateChecks(work, parsed.platePainting, parsed.results, (name, pass, detail) => {
    if (!pass) bad++;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
  });
  process.exit(bad === 0 ? 0 : 1);
}
