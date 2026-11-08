/**
 * Controls for declared occluders (issue #1230), on the generated inputs of
 * `fixtures/occluder_chain.ts`:
 *
 * - `runOccluderConfigChecks`: `config.assemble.occluders` at every config
 *   door, each planted refusal by its code;
 * - `runOccluderCopyChecks`: `ASSEMBLE_OCCLUDER_COLOUR_COPIED` fires on a
 *   planted copy with the planted count, stays silent without it, and the
 *   declaration moves no output byte;
 * - `runOccluderChainChecks`: the chain through `comfy plate --mode occluder`
 *   (run by the comfy harness against the fake ComfyUI): the plate's
 *   decomposition as `--full`, the real painting as `--source`, the occluder's
 *   layer taken from the painting's own decomposition — no assemble change —
 *   leaves no `ASSEMBLE_HIDDEN_EXTENT_ABSENT` cell, where the painting's own
 *   decomposition leaves the occluder's 2,048.
 *
 *   bun tools/check_occluders.ts <work dir>     the first two (no box needed)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assembleStage } from '../src/build.ts';
import { loadConfig, loadEarlyConfig, parseConfig, parseEarlyConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import {
  OCCLUDER_COLOUR_COPIED,
  OCCLUDER_PLATE_BASE_RUN,
  OCCLUDER_PLATE_OCCLUDER,
  OCCLUDER_PLATE_PAINTING,
} from '../src/occluders.ts';
import { type OccluderPlateRecord, readParts } from '../src/parts.ts';
import {
  PLATE_GRAPH_IDS,
  PLATE_MASK_FILE,
  PLATE_OUTPUT_FILE,
  PLATE_RECEIPT_FILE,
  PLATE_RECEIPT_SPEC,
  type PlateReceipt,
  receiptPath,
  receiptText,
  sha256,
} from '../src/plate.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { scratchConfig } from '../src/meshdraft.ts';
import { chainConfig, OCCLUDER, OCCLUDER_PX, PLANT, writeChainInputs, writePlateRun } from '../fixtures/occluder_chain.ts';

type Say = (name: string, pass: boolean, detail: string) => void;

function refusal(run: () => unknown): PartsError | null {
  try { run(); return null; } catch (error) {
    if (error instanceof PartsError) return error;
    throw error;
  }
}

const declaration = (sha: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ image: 'occluder.png', sha256: sha, under: ['behind'], rgb_within: 20, ...extra });

/** Write a valid `rig-parts-plate-receipt/1` occluder plate directory on disk so unit controls need no ComfyUI box. */
function writeSyntheticOccluderPlate(
  plateDir: string,
  opts: { paintingFile: string; occluderFile: string; plateBytes?: Uint8Array },
): { plateBytes: Uint8Array; plateSha: string; maskSha: string; receiptSha: string; paintingSha: string; occluderSha: string } {
  mkdirSync(plateDir, { recursive: true });
  const maskRaster = new Uint8ClampedArray(128 * 128 * 4);
  for (let i = 0; i < 128 * 128; i++) { maskRaster[i * 4 + 3] = 255; }
  const maskBytes = encodePngBytes({ width: 128, height: 128, data: maskRaster });
  const plateBytes = opts.plateBytes ?? maskBytes;
  writeFileSync(join(plateDir, PLATE_MASK_FILE), maskBytes);
  writeFileSync(join(plateDir, PLATE_OUTPUT_FILE), plateBytes);
  const maskSha = sha256(maskBytes);
  const plateSha = sha256(plateBytes);
  const paintingSha = sha256(new Uint8Array(readFileSync(opts.paintingFile)));
  const occluderSha = sha256(new Uint8Array(readFileSync(opts.occluderFile)));
  const receipt: PlateReceipt = {
    spec: PLATE_RECEIPT_SPEC,
    mode: 'occluder',
    painting: { path: receiptPath(plateDir, opts.paintingFile), sha256: paintingSha },
    occluder: { path: receiptPath(plateDir, opts.occluderFile), sha256: occluderSha },
    mask: { source: 'occluder', from: receiptPath(plateDir, opts.occluderFile), path: PLATE_MASK_FILE, sha256: maskSha },
    model: { name: 'synthetic.safetensors', checkpoint_sha256: 'a'.repeat(64), checkpoint_sha256_from: 'declared' },
    params: { grow: 6, holes: true },
    graph: PLATE_GRAPH_IDS.core,
    gpu: 'synthetic',
    output: { path: PLATE_OUTPUT_FILE, sha256: plateSha },
  };
  const receiptBytes = new Uint8Array(Buffer.from(receiptText(receipt), 'utf8'));
  writeFileSync(join(plateDir, PLATE_RECEIPT_FILE), receiptBytes);
  return { plateBytes, plateSha, maskSha, receiptSha: sha256(receiptBytes), paintingSha, occluderSha };
}

export function runOccluderConfigChecks(dir: string, say: Say): void {
  const home = join(dir, 'occluder-config');
  rmSync(home, { recursive: true, force: true });
  const { occluderSha, painting, occluder } = writeChainInputs(home);
  writeSyntheticOccluderPlate(join(home, 'plate-out'), { paintingFile: painting, occluderFile: occluder });
  const doors = [parseConfig, (raw: Record<string, unknown>) => parseEarlyConfig(raw, 'assemble'), (raw: Record<string, unknown>) => parseEarlyConfig(raw, 'layers')];
  const good = chainConfig({ occluders: [declaration(occluderSha)] });
  const goodWithPlate = chainConfig({ occluders: [declaration(occluderSha, { plate: 'plate-out' })] });
  say('OC01_DECLARATION_READS_AT_EVERY_DOOR',
    doors.every((read) => JSON.stringify(read(good).assemble.occluders) === JSON.stringify([declaration(occluderSha)])) &&
      doors.every((read) => JSON.stringify(read(goodWithPlate).assemble.occluders) === JSON.stringify([declaration(occluderSha, { plate: 'plate-out' })])),
    'full, assemble and layers retain the declaration with and without optional plate');
  const shaped = [
    { value: { occluders: true }, code: 'CONFIG_FIELD_TYPE' },
    { value: { occluders: [declaration(occluderSha, { extra: 1 })] }, code: 'CONFIG_KEY_KNOWN' },
    { value: { occluders: [{ image: 'occluder.png', sha256: occluderSha, under: ['behind'] }] }, code: 'CONFIG_FIELD_PRESENT' },
    { value: { occluders: [declaration('not-a-sha')] }, code: 'CONFIG_FIELD_TYPE' },
    { value: { occluders: [declaration(occluderSha, { under: [] })] }, code: 'CONFIG_FIELD_TYPE' },
    { value: { occluders: [declaration(occluderSha, { rgb_within: 256 })] }, code: 'CONFIG_FIELD_TYPE' },
    { value: { occluders: [declaration(occluderSha, { plate: '' })] }, code: 'CONFIG_FIELD_TYPE' },
  ];
  const shapeRows = shaped.map(({ value, code }) => doors.map((read) => refusal(() => read(chainConfig(value)))?.problems.some((p) => p.code === code) === true));
  say('OC02_SHAPE_PLANTS_ARE_REFUSED_AT_EVERY_DOOR', shapeRows.every((row) => row.every(Boolean)), shaped.map(({ code }, i) => `${code} ${shapeRows[i].join('/')}`).join('; '));
  const unknown = chainConfig({ occluders: [declaration(occluderSha, { under: ['absent'] })] });
  const named = doors.slice(0, 2).map((read) => refusal(() => read(unknown))?.problems.find((p) => p.code === 'CONFIG_NAME_RESOLVES' && p.object === 'config.assemble.occluders[0].under[0]'));
  say('OC03_AN_UNKNOWN_UNDER_PART_IS_REFUSED_AT_THE_PLAN_DOORS', named.every((p) => p !== undefined), named.map((p) => p?.detail ?? 'accepted').join(' | '));
  // File doors: the loaders that know the config's directory read the image, its sha256 and any declared plate directory.
  const loaders = [(path: string) => loadConfig(path), (path: string) => loadEarlyConfig(path, 'assemble'), (path: string) => loadEarlyConfig(path, 'layers')];
  const file = (name: string, cfg: Record<string, unknown>): string => { const path = join(home, name); writeFileSync(path, JSON.stringify(cfg)); return path; };
  const okPath = file('ok.json', goodWithPlate);
  const badSha = file('bad-sha.json', chainConfig({ occluders: [declaration('0'.repeat(64))] }));
  const missing = file('missing.json', chainConfig({ occluders: [declaration(occluderSha, { image: 'absent.png' })] }));
  const missingPlate = file('missing-plate.json', chainConfig({ occluders: [declaration(occluderSha, { plate: 'absent-plate' })] }));
  const accepted = loaders.map((load) => refusal(() => load(okPath)) === null);
  const shaCodes = loaders.map((load) => refusal(() => load(badSha))?.problems.find((p) => p.code === 'CONFIG_OCCLUDER_SHA256'));
  const missingCodes = loaders.map((load) => refusal(() => load(missing))?.problems.find((p) => p.code === 'CONFIG_FILE_PRESENT' && p.object === 'config.assemble.occluders[0].image'));
  const missingPlateCodes = loaders.map((load) => refusal(() => load(missingPlate))?.problems.find((p) => p.code === 'CONFIG_FILE_PRESENT' && p.object === 'config.assemble.occluders[0].plate'));
  say('OC04_A_BAD_SHA_AND_A_MISSING_FILE_ARE_REFUSED_BY_NAME_AT_EVERY_LOADER',
    accepted.every(Boolean) && shaCodes.every((p) => p?.detail.includes(occluderSha) === true) && missingCodes.every((p) => p !== undefined) && missingPlateCodes.every((p) => p !== undefined),
    `declared bytes accepted ${accepted.join('/')}; bad sha: ${shaCodes.map((p) => p?.code ?? 'accepted').join('/')}; missing file: ${missingCodes.map((p) => p?.code ?? 'accepted').join('/')}; missing plate: ${missingPlateCodes.map((p) => p?.code ?? 'accepted').join('/')}`);
  // The scratch config mesh-draft and remesh write elsewhere rebases every config-relative file through
  // configFileReferences; a relative occluder image and plate directory must survive it. Control: the same text copied without the rebase.
  const scratch = scratchConfig(okPath, readFileSync(okPath, 'utf8'), join(home, 'scratch'), new Map());
  const rebasedEntry = (JSON.parse(readFileSync(scratch, 'utf8')) as { assemble: { occluders: Array<{ image: string; plate?: string }> } }).assemble.occluders[0];
  const copiedPath = join(home, 'scratch-copy', 'config.json');
  mkdirSync(join(home, 'scratch-copy'), { recursive: true });
  writeFileSync(copiedPath, readFileSync(okPath));
  const scratchLoads = refusal(() => loadEarlyConfig(scratch, 'assemble'));
  const copiedLoads = refusal(() => loadEarlyConfig(copiedPath, 'assemble'))?.problems.find((p) => p.code === 'CONFIG_FILE_PRESENT' && p.object === 'config.assemble.occluders[0].image');
  say('OC08_A_RELATIVE_OCCLUDER_IMAGE_SURVIVES_THE_SCRATCH_CONFIG_REBASE',
    rebasedEntry.image === join(home, 'occluder.png') && rebasedEntry.plate === join(home, 'plate-out') && scratchLoads === null && copiedLoads !== undefined,
    `rebased image ${rebasedEntry.image === join(home, 'occluder.png') ? 'resolves to the config directory\'s occluder.png' : JSON.stringify(rebasedEntry.image)} and plate ${rebasedEntry.plate === join(home, 'plate-out') ? 'resolves to plate-out' : JSON.stringify(rebasedEntry.plate)}; scratch config ${scratchLoads?.message ?? 'loads'}; un-rebased copy ${copiedLoads?.code ?? 'accepted'}`);
}

function stage(home: string, full: string, cfg: Record<string, unknown>, out: string): { lines: string[]; error: PartsError | null } {
  writeFileSync(join(home, 'config.json'), JSON.stringify(cfg));
  const lines: string[] = [];
  const error = refusal(() => assembleStage({ config: join(home, 'config.json'), source: join(home, 'painting.png'), full, head: null, project: 'visible' },
    { partsJson: join(home, out, 'parts.json'), partsDir: join(home, out, 'parts'), recomposite: join(home, out, 'recomposite.png'), errorMap: join(home, out, 'error.png') }, (line) => lines.push(line)));
  return { lines, error };
}

const copied = (lines: readonly string[]): string[] => lines.filter((l) => l.includes(OCCLUDER_COLOUR_COPIED));

export function runOccluderCopyChecks(dir: string, say: Say): void {
  const planted = join(dir, 'occluder-copy-planted'), clean = join(dir, 'occluder-copy-clean');
  for (const d of [planted, clean]) rmSync(d, { recursive: true, force: true });
  const p = writeChainInputs(planted, PLANT), c = writeChainInputs(clean);
  const fired = stage(planted, join(planted, 'orig'), chainConfig({ occluders: [declaration(p.occluderSha)] }), 'out');
  const want = PLANT.exact + PLANT.within;
  const line = copied(fired.lines);
  say('OC05_A_PLANTED_COPY_FIRES_WITH_THE_PLANTED_COUNT',
    fired.error === null && line.length === 1 && line[0].startsWith(`WARN  ${OCCLUDER_COLOUR_COPIED}: config.assemble.occluders[0] part "behind" — ${want} rig px`) && line[0].includes(`first at ${OCCLUDER[0]},${OCCLUDER[1]}`),
    `${fired.error?.message ?? 'assembled'}; planted ${PLANT.exact} exact + ${PLANT.within} at 20 off + ${PLANT.beyond} at 21 off, want ${want}; ${line.join(' | ') || 'no WARN'}`);
  const silent = stage(clean, join(clean, 'orig'), chainConfig({ occluders: [declaration(c.occluderSha)] }), 'declared');
  say('OC06_WITHOUT_THE_PLANT_THE_FINDING_IS_SILENT', silent.error === null && copied(silent.lines).length === 0, `${silent.error?.message ?? 'assembled'}; ${copied(silent.lines).join(' | ') || 'no WARN'}`);
  const plain = stage(clean, join(clean, 'orig'), chainConfig({}), 'plain');
  const files = ['parts.json', 'recomposite.png', 'error.png', 'parts/behind.png', 'parts/front.png'];
  const same = files.filter((f) => existsSync(join(clean, 'plain', f)) && readFileSync(join(clean, 'plain', f)).equals(readFileSync(join(clean, 'declared', f))));
  say('OC07_THE_DECLARATION_MOVES_NO_OUTPUT_BYTE', plain.error === null && same.length === files.length, `${same.length}/${files.length} files byte-identical with and without config.assemble.occluders`);

  // Issue #1237: plate binding controls on `config.assemble.occluders[i].plate` and `parts.json.occluder_plates`.
  const plateHome = join(dir, 'occluder-plate-binding');
  rmSync(plateHome, { recursive: true, force: true });
  const inputs = writeChainInputs(plateHome);
  const goodPlate = writeSyntheticOccluderPlate(join(plateHome, 'plate-good'), {
    paintingFile: inputs.painting,
    occluderFile: inputs.occluder,
  });
  const plateRun = writePlateRun(plateHome, goodPlate.plateBytes);
  const take = [{ run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['objects'] }];
  const boundRun = stage(plateHome, plateRun, chainConfig({ occluders: [declaration(inputs.occluderSha, { plate: 'plate-good' })], take }), 'out-bound');
  const boundPartsPath = join(plateHome, 'out-bound', 'parts.json');
  const roundTripped = boundRun.error === null && existsSync(boundPartsPath) ? readParts(boundPartsPath) : null;
  const wantRecord: OccluderPlateRecord = {
    receipt: 'plate-good/receipt.json',
    receipt_sha256: goodPlate.receiptSha,
    occluder_sha256: inputs.occluderSha,
    painting_sha256: goodPlate.paintingSha,
    output_sha256: goodPlate.plateSha,
    mask_sha256: goodPlate.maskSha,
  };
  const badPartsPath = join(plateHome, 'out-bound', 'parts-bad.json');
  if (roundTripped !== null) {
    const rawBad = JSON.parse(readFileSync(boundPartsPath, 'utf8')) as { occluder_plates: Array<Record<string, unknown>> };
    rawBad.occluder_plates[0].output_sha256 = 'not-a-sha';
    writeFileSync(badPartsPath, JSON.stringify(rawBad));
  }
  const readerRefusal = roundTripped !== null ? refusal(() => readParts(badPartsPath))?.problems.find((pr) => pr.code === 'PARTS_FIELD_TYPE' && pr.object.includes('occluder_plates[0] field "output_sha256"')) : undefined;
  say('OC09_BOUND_OCCLUDER_PLATE_WRITES_PARTS_JSON_AND_ROUND_TRIPS',
    boundRun.error === null && JSON.stringify(roundTripped?.occluder_plates) === JSON.stringify([wantRecord]) && readerRefusal !== undefined,
    `${boundRun.error?.message ?? 'assembled'}; occluder_plates=${JSON.stringify(roundTripped?.occluder_plates)}; reader plant: ${readerRefusal?.code ?? 'accepted'}`);

  // Plant 1: plate receipt's occluder.sha256 !== declared occluder sha256 -> ASSEMBLE_OCCLUDER_PLATE_OCCLUDER.
  const altOccRaster = new Uint8ClampedArray(128 * 128 * 4);
  altOccRaster[3] = 255;
  const altOccBytes = encodePngBytes({ width: 128, height: 128, data: altOccRaster });
  const otherOccluderFile = join(plateHome, 'other-occluder.png');
  writeFileSync(otherOccluderFile, altOccBytes);
  writeSyntheticOccluderPlate(join(plateHome, 'plate-wrong-occluder'), {
    paintingFile: inputs.painting,
    occluderFile: otherOccluderFile,
    plateBytes: goodPlate.plateBytes,
  });
  const badOccRun = stage(plateHome, plateRun, chainConfig({ occluders: [declaration(inputs.occluderSha, { plate: 'plate-wrong-occluder' })], take }), 'out-bad-occ');
  const badOccProb = badOccRun.error?.problems.find((pr) => pr.code === OCCLUDER_PLATE_OCCLUDER && pr.object === 'config.assemble.occluders[0].plate');
  say('OC10_MISMATCHED_OCCLUDER_PLATE_OCCLUDER_SHA_IS_REFUSED',
    badOccProb !== undefined && !existsSync(join(plateHome, 'out-bad-occ', 'parts.json')),
    badOccProb !== undefined ? `${badOccProb.code}: ${badOccProb.detail}` : `unexpected: ${badOccRun.error?.message ?? 'assembled'}`);

  // Plant 2: plate receipt's painting.sha256 !== --source painting sha256 -> ASSEMBLE_OCCLUDER_PLATE_PAINTING.
  const otherPaintingFile = join(plateHome, 'other-painting.png');
  writeFileSync(otherPaintingFile, altOccBytes);
  writeSyntheticOccluderPlate(join(plateHome, 'plate-wrong-painting'), {
    paintingFile: otherPaintingFile,
    occluderFile: inputs.occluder,
    plateBytes: goodPlate.plateBytes,
  });
  const badPaintRun = stage(plateHome, plateRun, chainConfig({ occluders: [declaration(inputs.occluderSha, { plate: 'plate-wrong-painting' })], take }), 'out-bad-paint');
  const badPaintProb = badPaintRun.error?.problems.find((pr) => pr.code === OCCLUDER_PLATE_PAINTING && pr.object === 'config.assemble.occluders[0].plate');
  say('OC11_MISMATCHED_OCCLUDER_PLATE_PAINTING_SHA_IS_REFUSED',
    badPaintProb !== undefined && !existsSync(join(plateHome, 'out-bad-paint', 'parts.json')),
    badPaintProb !== undefined ? `${badPaintProb.code}: ${badPaintProb.detail}` : `unexpected: ${badPaintRun.error?.message ?? 'assembled'}`);

  // Plant 3: plate receipt's output.sha256 !== base (--full) run's meta.json image_sha256 -> ASSEMBLE_OCCLUDER_PLATE_BASE_RUN.
  writeFileSync(join(plateHome, 'orig', 'meta.json'), JSON.stringify({ prompt_id: 'generated-original', seed: 42, image_sha256: goodPlate.paintingSha }));
  const badBaseRun = stage(plateHome, join(plateHome, 'orig'), chainConfig({ occluders: [declaration(inputs.occluderSha, { plate: 'plate-good' })] }), 'out-bad-base');
  const badBaseProb = badBaseRun.error?.problems.find((pr) => pr.code === OCCLUDER_PLATE_BASE_RUN && pr.object === 'config.assemble.occluders[0].plate');
  say('OC12_MISMATCHED_OCCLUDER_PLATE_BASE_RUN_SHA_IS_REFUSED',
    badBaseProb !== undefined && badBaseProb.detail.includes(goodPlate.plateSha) && badBaseProb.detail.includes(goodPlate.paintingSha) && !existsSync(join(plateHome, 'out-bad-base', 'parts.json')),
    badBaseProb !== undefined ? `${badBaseProb.code}: ${badBaseProb.detail}` : `unexpected: ${badBaseRun.error?.message ?? 'assembled'}`);
}

/** `plateDir` is the harness's `comfy plate --mode occluder` output on the chain's painting and occluder (`<work>/occ-chain`). */
export function runOccluderChainChecks(work: string, plateDir: string, say: Say): void {
  const home = join(work, 'occ-chain');
  const receiptPath = join(plateDir, 'receipt.json');
  if (!existsSync(receiptPath)) { say('PB18_THE_CHAIN_THROUGH_THE_OCCLUDER_PLATE_LEAVES_NO_ABSENT_CELL', false, `no plate at ${plateDir}`); return; }
  const receiptBytes = new Uint8Array(readFileSync(receiptPath));
  const receipt = JSON.parse(Buffer.from(receiptBytes).toString('utf8')) as { occluder?: { sha256?: string }; painting?: { sha256?: string }; output?: { sha256?: string }; mask?: { sha256?: string } };
  const plateBytes = new Uint8Array(readFileSync(join(plateDir, 'plate.png')));
  const occluderSha = sha256(new Uint8Array(readFileSync(join(home, 'occluder.png'))));
  rmSync(join(home, 'plate-run'), { recursive: true, force: true });
  const run = writePlateRun(home, plateBytes);
  const meta = JSON.parse(readFileSync(join(run, 'meta.json'), 'utf8')) as { image_sha256: string };
  const plateRel = relative(home, plateDir).replace(/\\/g, '/');
  const declared = { require_hidden_extent: [{ part: 'behind', occluder: 'front' }], occluders: [declaration(occluderSha)] };
  // Without the new source: the painting's own decomposition leaves the occluder's cells absent.
  const before = stage(home, join(home, 'orig'), chainConfig(declared), 'out-orig');
  const absent = before.error?.problems.find((p) => p.code === 'ASSEMBLE_HIDDEN_EXTENT_ABSENT');
  // Through it, declaring `plate` on the occluder entry: the plate's run as --full, the occluder's layer taken from the painting's run (st_input = the painting).
  const take = [{ run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['objects'] }];
  const after = stage(home, run, chainConfig({ require_hidden_extent: declared.require_hidden_extent, occluders: [declaration(occluderSha, { plate: plateRel })], take }), 'out-plate');
  const parts = after.error === null ? readParts(join(home, 'out-plate', 'parts.json')) : null;
  const behind = parts?.parts.find((x) => x.name === 'behind'), front = parts?.parts.find((x) => x.name === 'front');
  const rec = parts?.occluder_plates?.[0];
  const bound = rec !== undefined &&
    rec.receipt === `${plateRel}/receipt.json` &&
    rec.receipt_sha256 === sha256(receiptBytes) &&
    rec.occluder_sha256 === occluderSha &&
    rec.painting_sha256 === sha256(new Uint8Array(readFileSync(join(home, 'painting.png')))) &&
    rec.output_sha256 === meta.image_sha256 &&
    rec.mask_sha256 === receipt.mask?.sha256;
  say('PB18_THE_CHAIN_THROUGH_THE_OCCLUDER_PLATE_LEAVES_NO_ABSENT_CELL',
    absent?.detail.includes(`${OCCLUDER_PX} enclosed-hole rig cells of ${OCCLUDER_PX}`) === true && after.error === null && copied(after.lines).length === 0 &&
      behind?.opaque_px === 96 * 96 && front?.taken_layers?.[0]?.st_input === 'painting.png' && front.taken_layers[0].differing_px === 0 && bound,
    `painting's run: ${absent === undefined ? 'no ABSENT refusal' : absent.detail.split(';')[0]}; plate's run: ${after.error?.message ?? `assembled, behind ${behind?.opaque_px} px, front taken from st_input ${front?.taken_layers?.[0]?.st_input} differing ${front?.taken_layers?.[0]?.differing_px}`}; copied WARN ${copied(after.lines).length}; parts.json occluder_plates[0] bound ${bound}`);
}

if (import.meta.main) {
  const work = process.argv[2];
  if (work === undefined) {
    console.error('usage: bun tools/check_occluders.ts <work dir>');
    process.exit(2);
  }
  mkdirSync(work, { recursive: true });
  let bad = 0;
  const say: Say = (name, pass, detail) => {
    if (!pass) bad++;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
  };
  runOccluderConfigChecks(work, say);
  runOccluderCopyChecks(work, say);
  process.exit(bad === 0 ? 0 : 1);
}
