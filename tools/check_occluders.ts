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
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { type PlanProposal, proposeFields, proposePlan, proposeSinglePlan } from '../src/assemble.ts';
import { assembleStage, readRuns } from '../src/build.ts';
import { loadConfig, loadEarlyConfig, parseConfig, parseEarlyConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { CORE_ALPHA, exportLayers, OPAQUE_ALPHA_ABOVE, readLayers, type Layer, type LayerSet } from '../src/layers.ts';
import { readLayerTag } from '../src/tags.ts';
import {
  COPIED_ALPHA_ABOVE,
  OCCLUDER_COLOUR_COPIED,
  OCCLUDER_DRAW_CYCLE,
  OCCLUDER_DRAW_ORDER,
  OCCLUDER_EMPTY,
  OCCLUDER_OVER_TAKEN,
  OCCLUDER_PLATE_BASE_RUN,
  OCCLUDER_PLATE_OCCLUDER,
  OCCLUDER_PLATE_PAINTING,
  OCCLUDER_UNHELD,
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
import { scratchConfig } from '../src/meshdraft.ts';
import { encodePngBytes, readPng } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { applyTakenLayers, TAKE_SPLIT_EMPTY, TAKE_SPLIT_OCCLUDER } from '../src/takelayers.ts';
import {
  chainConfig,
  chainPlate,
  DEEPER_OCCLUDER_DEPTH,
  LIMB,
  LIMB_RGB,
  OCCLUDER,
  OCCLUDER_PX,
  OCCLUDER_RGB,
  OCCLUDER_SPECK_ALPHA,
  OCCLUDER_SPECK_BOX,
  OCCLUDER_SPECK_PX,
  PARTIAL_HALF_PX,
  PARTIAL_LOWER_BOX,
  PARTIAL_OCCLUDER_RGB,
  PARTIAL_OVER_BOX,
  PLANT,
  plateRun as buildPlateRun,
  SIDE,
  SOFT_OVER_INNER_BOX,
  SOFT_OVER_INNER_PX,
  SOFT_OVER_RING_ALPHA,
  SOFT_OVER_RING_PX,
  SOFT_OVER_RING_WIDTH,
  writeChainInputs,
  writePartialOverInputs,
  writePlateRun,
  writeSoftOverInputs,
} from '../fixtures/occluder_chain.ts';

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
  const goodWithOver = chainConfig({ occluders: [declaration(occluderSha, { over: ['front'] })] });
  const overReadOk = doors.every((read) => JSON.stringify(read(goodWithOver).assemble.occluders) === JSON.stringify([declaration(occluderSha, { over: ['front'] })]));
  const overEmpty = doors.map((read) => refusal(() => read(chainConfig({ occluders: [declaration(occluderSha, { over: [] })] })))?.problems.some((p) => p.code === 'CONFIG_FIELD_TYPE' && p.object === 'config.assemble.occluders[0].over') === true);
  const overType = doors.map((read) => refusal(() => read(chainConfig({ occluders: [declaration(occluderSha, { over: [1] })] })))?.problems.some((p) => p.code === 'CONFIG_FIELD_TYPE' && p.object === 'config.assemble.occluders[0].over[0]') === true);
  const overDup = doors.map((read) => refusal(() => read(chainConfig({ occluders: [declaration(occluderSha, { over: ['front', 'front'] })] })))?.problems.some((p) => p.code === 'CONFIG_PART_UNIQUE' && p.object === 'config.assemble.occluders[0].over[1]') === true);
  const overUnknown = doors.slice(0, 2).map((read) => refusal(() => read(chainConfig({ occluders: [declaration(occluderSha, { over: ['absent'] })] })))?.problems.find((p) => p.code === 'CONFIG_NAME_RESOLVES' && p.object === 'config.assemble.occluders[0].over[0]'));
  say('OC13_OVER_READS_AND_REFUSES_SHAPE_DUPLICATES_AND_UNKNOWN_NAMES',
    overReadOk && overEmpty.every(Boolean) && overType.every(Boolean) && overDup.every(Boolean) && overUnknown.every((p) => p !== undefined),
    `over read ${overReadOk}; empty ${overEmpty.join('/')}; non-string ${overType.join('/')}; duplicate ${overDup.join('/')}; unknown: ${overUnknown.map((p) => p?.detail ?? 'accepted').join(' | ')}`);
}

function stage(home: string, full: string, cfg: Record<string, unknown>, out: string, head: string | null = null): { lines: string[]; error: PartsError | null } {
  writeFileSync(join(home, 'config.json'), JSON.stringify(cfg));
  const lines: string[] = [];
  const error = refusal(() => assembleStage({ config: join(home, 'config.json'), source: join(home, 'painting.png'), full, head, project: 'visible' },
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

  // Issue #1241 controls (a)-(g): deeper-ranked taken occluder layer (depth 0.9 > limb depth 0.7).
  const deep = join(dir, 'occluder-deeper');
  rmSync(deep, { recursive: true, force: true });
  const extraLayer = newRaster(SIDE, SIDE);
  for (let y = OCCLUDER[1]; y < OCCLUDER[3]; y++) for (let x = OCCLUDER[0]; x < OCCLUDER[2]; x++) extraLayer.data.set([120, 140, 60, 255], (y * SIDE + x) * 4);
  const d = writeChainInputs(deep, null, DEEPER_OCCLUDER_DEPTH, [{ name: 'topwear', pixels: extraLayer, depth: 0.95 }]);
  const plateRunDir = writePlateRun(deep, encodePngBytes(chainPlate()));
  const reqHidden = [{ part: 'behind', occluder: 'front' }];

  // (a) Without `over`, the deeper-ranked case refuses ASSEMBLE_TAKE_PLAN_ORDER.
  const withoutOver = stage(deep, plateRunDir, chainConfig({ require_hidden_extent: reqHidden, occluders: [declaration(d.occluderSha)], take }), 'out-without-over');
  const planOrderProblem = withoutOver.error?.problems.find((q) => q.code === 'ASSEMBLE_TAKE_PLAN_ORDER');
  say('OC14_DEEPER_TAKEN_OCCLUDER_WITHOUT_OVER_REFUSES_TAKE_PLAN_ORDER',
    planOrderProblem !== undefined && planOrderProblem.object === 'full plan parts "behind" / "front"' && planOrderProblem.detail.includes('mixed-run depths 0.7 / 0.9') && planOrderProblem.detail.includes(`supports overlap at ${OCCLUDER_PX} run px`) && !existsSync(join(deep, 'out-without-over')),
    withoutOver.error?.message ?? 'accepted');

  // (b) With `over`, the same case builds (exit 0) and draws the occluder in front: every pixel of OCCLUDER carries OCCLUDER_RGB.
  const withOver = stage(deep, plateRunDir, chainConfig({ require_hidden_extent: reqHidden, occluders: [declaration(d.occluderSha, { over: ['front'] })], take }), 'out-with-over');
  let occluderRgbPx = 0;
  if (withOver.error === null && existsSync(join(deep, 'out-with-over', 'recomposite.png'))) {
    const recomp = readPng(join(deep, 'out-with-over', 'recomposite.png'));
    for (let y = OCCLUDER[1]; y < OCCLUDER[3]; y++) for (let x = OCCLUDER[0]; x < OCCLUDER[2]; x++) {
      const idx = (y * SIDE + x) * 4;
      if (recomp.data[idx] === OCCLUDER_RGB[0] && recomp.data[idx + 1] === OCCLUDER_RGB[1] && recomp.data[idx + 2] === OCCLUDER_RGB[2] && recomp.data[idx + 3] === 255) occluderRgbPx++;
    }
  }
  say('OC15_DEEPER_TAKEN_OCCLUDER_WITH_OVER_BUILDS_AND_DRAWS_IN_FRONT',
    withOver.error === null && copied(withOver.lines).length === 0 && occluderRgbPx === OCCLUDER_PX,
    `${withOver.error?.message ?? 'assembled'}; recomposite occluder rectangle holds OCCLUDER_RGB on ${occluderRgbPx}/${OCCLUDER_PX} px; copied WARN ${copied(withOver.lines).length}`);

  // (c) A planted undeclared mixed-run pair in the same build still refuses ASSEMBLE_TAKE_PLAN_ORDER.
  const cfgWithUndeclared = chainConfig({
    require_hidden_extent: reqHidden,
    occluders: [declaration(d.occluderSha, { over: ['front'] })],
    take: [{ run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['objects', 'topwear'] }],
  });
  (cfgWithUndeclared.assemble as Record<string, unknown>).plan = [
    ['face', 'full', 'face'], ['eye_r', 'full', 'eyewhite-r'], ['eye_l', 'full', 'eyewhite-l'],
    ['behind', 'full', 'legwear'], ['front', 'full', 'objects'], ['undeclared', 'full', 'topwear'],
  ];
  const undeclaredPair = stage(deep, plateRunDir, cfgWithUndeclared, 'out-undeclared-pair');
  const undeclaredProblem = undeclaredPair.error?.problems.find((q) => q.code === 'ASSEMBLE_TAKE_PLAN_ORDER');
  say('OC16_UNDECLARED_MIXED_RUN_PAIR_IN_SAME_BUILD_STILL_REFUSES_PLAN_ORDER',
    undeclaredPair.error?.problems.length === 1 && undeclaredProblem?.object === 'full plan parts "behind" / "undeclared"' && undeclaredProblem.detail.includes('mixed-run depths 0.7 / 0.95') && !existsSync(join(deep, 'out-undeclared-pair')),
    undeclaredPair.error?.message ?? 'accepted');

  // (d) A plan that draws a declared `over` part behind its `under` refuses ASSEMBLE_OCCLUDER_DRAW_ORDER.
  const cfgReversedOver = chainConfig({
    occluders: [declaration(d.occluderSha, { over: ['front'] })],
    take,
  });
  (cfgReversedOver.assemble as Record<string, unknown>).plan = [
    ['face', 'full', 'face'], ['eye_r', 'full', 'eyewhite-r'], ['eye_l', 'full', 'eyewhite-l'],
    ['front', 'full', 'objects'], ['behind', 'full', 'legwear'],
  ];
  const reversedOver = stage(deep, plateRunDir, cfgReversedOver, 'out-reversed-over');
  const drawOrderProblem = reversedOver.error?.problems.find((q) => q.code === OCCLUDER_DRAW_ORDER);
  say('OC17_DECLARED_OVER_DRAWN_BEHIND_UNDER_REFUSES_OCCLUDER_DRAW_ORDER',
    reversedOver.error?.problems.length === 1 && drawOrderProblem?.object === 'full plan parts "front" / "behind"' && drawOrderProblem.detail.includes('config.assemble.occluders[0]') && !existsSync(join(deep, 'out-reversed-over')),
    reversedOver.error?.message ?? 'accepted');

  // (e) Three contradiction plants, each refusing ASSEMBLE_OCCLUDER_DRAW_CYCLE with no build output written.
  const cyclePlants = [
    {
      label: 'same-part',
      occluders: [declaration(d.occluderSha, { under: ['front'], over: ['front'] })],
      expectCycle: 'cycle front -> front',
    },
    {
      label: 'two-entry-swap',
      occluders: [
        declaration(d.occluderSha, { under: ['behind'], over: ['front'] }),
        declaration(d.occluderSha, { under: ['front'], over: ['behind'] }),
      ],
      expectCycle: 'cycle front -> behind -> front',
    },
    {
      label: 'three-entry-cycle',
      occluders: [
        declaration(d.occluderSha, { under: ['behind'], over: ['front'] }),
        declaration(d.occluderSha, { under: ['face'], over: ['behind'] }),
        declaration(d.occluderSha, { under: ['front'], over: ['face'] }),
      ],
      expectCycle: 'cycle front -> behind -> face -> front',
    },
  ];
  const cycleResults = cyclePlants.map(({ label, occluders: occs, expectCycle }) => {
    const outDir = `out-cycle-${label}`;
    const res = stage(deep, plateRunDir, chainConfig({ occluders: occs, take }), outDir);
    const prob = res.error?.problems.find((q) => q.code === OCCLUDER_DRAW_CYCLE);
    const ok = prob !== undefined && prob.detail.includes(expectCycle) && !existsSync(join(deep, outDir));
    return { label, ok, msg: prob ? `${prob.code}: ${prob.object} — ${prob.detail}` : (res.error?.message ?? 'accepted') };
  });
  say('OC18_CONTRADICTORY_OVER_UNDER_DECLARATIONS_REFUSE_DRAW_CYCLE',
    cycleResults.every((r) => r.ok),
    cycleResults.map((r) => `${r.label}: ${r.msg}`).join(' | '));

  // (f) An `over` part that isn't taken refuses ASSEMBLE_OCCLUDER_OVER_TAKEN.
  const untakenOver = stage(deep, plateRunDir, chainConfig({ occluders: [declaration(d.occluderSha, { over: ['front'] })] }), 'out-untaken-over');
  const untakenProblem = untakenOver.error?.problems.find((q) => q.code === OCCLUDER_OVER_TAKEN);
  say('OC19_UNTAKEN_OVER_PART_REFUSES_OCCLUDER_OVER_TAKEN',
    untakenOver.error?.problems.length === 1 && untakenProblem?.object === 'config.assemble.occluders[0].over[0]' && untakenProblem.detail.includes('part "front" (full:objects) is not taken by config.assemble.take') && !existsSync(join(deep, 'out-untaken-over')),
    untakenOver.error?.message ?? 'accepted');

  // Cross-run declared pair: `over` is a `full` row and `under` is a `head` row, with `over` drawn behind `under` in `assemble.plan`.
  const cfgCrossRun = chainConfig({
    occluders: [declaration(d.occluderSha, { over: ['front'] })],
    take,
  });
  (cfgCrossRun.seethrough as Record<string, unknown>).head_box = [0, 0, SIDE, SIDE];
  (cfgCrossRun.assemble as Record<string, unknown>).plan = [
    ['face', 'head', 'face'], ['eye_r', 'head', 'eyewhite-r'], ['eye_l', 'head', 'eyewhite-l'],
    ['front', 'full', 'objects'], ['behind', 'head', 'legwear'],
  ];
  const crossRunOver = stage(deep, plateRunDir, cfgCrossRun, 'out-cross-run-over', plateRunDir);
  const crossRunProblem = crossRunOver.error?.problems.find((q) => q.code === OCCLUDER_DRAW_ORDER);
  say('OC20_CROSS_RUN_DECLARED_OVER_DRAWN_BEHIND_UNDER_REFUSES_OCCLUDER_DRAW_ORDER',
    crossRunOver.error?.problems.length === 1 && crossRunProblem?.object === 'plan parts "front" (full) / "behind" (head)' && crossRunProblem.detail.includes('config.assemble.occluders[0]') && !existsSync(join(deep, 'out-cross-run-over')),
    crossRunOver.error?.message ?? 'accepted');

  // (g) None of the 5 public example configs declares `assemble.occluders` (byte stability of their assembled outputs is checked by CI's "Fetch pinned painting allocation examples" step via `tools/check_painting_public.ts`).
  const root = resolve(import.meta.dir, '..');
  const exampleKeys = ['demo', 'reference-demo', 'reference-sample', 'scarf', 'wind'] as const;
  const exampleRows = exampleKeys.map((key) => {
    const cfg = loadConfig(join(root, 'examples', key, 'config.json'));
    return { key, noOccluders: cfg.assemble.occluders === undefined };
  });
  say('OC21_PUBLIC_EXAMPLES_DECLARE_NO_OCCLUDERS',
    exampleRows.every((r) => r.noOccluders),
    exampleRows.map((r) => `${r.key}: occluders=${String(r.noOccluders ? 'absent' : 'present')}`).join(', '));

  // Issue #1247 controls (OC29-OC31): `assemble --propose-plan` honours `occluders[i].over`, refuses cycles at propose time with no write, and leaves proposals without `over` byte-identical.
  const propDir = join(dir, 'occluder-propose-over');
  rmSync(propDir, { recursive: true, force: true });
  mkdirSync(propDir, { recursive: true });
  const fillBox = (box: readonly [number, number, number, number], rgba: readonly [number, number, number, number]) => {
    const r = newRaster(SIDE, SIDE);
    for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) r.data.set(rgba, (y * SIDE + x) * 4);
    return r;
  };
  const propPaint = fillBox([0, 0, SIDE, SIDE], [250, 250, 250, 255]);
  for (let y = 24; y < 104; y++) for (let x = 32; x < 80; x++) propPaint.data.set([60, 90, 170, 255], (y * SIDE + x) * 4);
  const occRgba: readonly [number, number, number, number] = [OCCLUDER_RGB[0], OCCLUDER_RGB[1], OCCLUDER_RGB[2], 255];
  for (let y = OCCLUDER[1]; y < OCCLUDER[3]; y++) for (let x = OCCLUDER[0]; x < OCCLUDER[2]; x++) propPaint.data.set(occRgba, (y * SIDE + x) * 4);
  const propPaintBytes = encodePngBytes(propPaint);
  const propPaintPath = join(propDir, 'painting.png');
  writeFileSync(propPaintPath, propPaintBytes);
  const propPlate = fillBox([0, 0, SIDE, SIDE], [250, 250, 250, 255]);
  for (let y = 24; y < 104; y++) for (let x = 32; x < 80; x++) propPlate.data.set([60, 90, 170, 255], (y * SIDE + x) * 4);
  const propPlateBytes = encodePngBytes(propPlate);
  const propOcc = fillBox(OCCLUDER, occRgba);
  const propOccBytes = encodePngBytes(propOcc);
  writeFileSync(join(propDir, 'occluder.png'), propOccBytes);
  const propOccSha = sha256(propOccBytes);
  const propFaceLayers = [
    { name: 'face', pixels: fillBox([16, 4, 48, 20], [235, 200, 185, 255]), depth: 0.5 },
    { name: 'eyewhite-r', pixels: fillBox([16, 4, 32, 14], [250, 250, 250, 255]), depth: 0.4 },
    { name: 'eyewhite-l', pixels: fillBox([32, 4, 48, 14], [250, 250, 250, 255]), depth: 0.4 },
  ];
  const makeSet = (entries: ReadonlyArray<{ name: string; pixels: ReturnType<typeof fillBox>; depth: number }>, source: string): LayerSet => {
    const layers: Layer[] = entries.map(({ name, pixels, depth }, drawOrder) => {
      const tag = readLayerTag(name);
      if (tag === null) throw new Error(`generated tag ${name} does not resolve`);
      let opaquePx = 0;
      for (let p = 3; p < pixels.data.length; p += 4) if (pixels.data[p] > 8) opaquePx++;
      return { name, tag, pixels, file: null, left: 0, top: 0, right: SIDE, bottom: SIDE, depth, drawOrder, opaquePx };
    });
    return { form: 'wrapper', source, canvas: { w: SIDE, h: SIDE }, layers, hidden: [] };
  };
  const propOrigDir = join(propDir, 'orig');
  exportLayers(makeSet([...propFaceLayers, { name: 'legwear', pixels: fillBox([32, 24, 80, 104], [60, 90, 170, 255]), depth: 0.7 }, { name: 'objects', pixels: propOcc, depth: DEEPER_OCCLUDER_DEPTH }], 'prop-orig'), propOrigDir);
  writeFileSync(join(propOrigDir, 'meta.json'), JSON.stringify({ prompt_id: 'prop-orig', seed: 42, image_sha256: sha256(propPaintBytes) }));
  const propPlateRunDir = join(propDir, 'plate-run');
  exportLayers(makeSet([...propFaceLayers, { name: 'legwear', pixels: fillBox([32, 24, 80, 104], [60, 90, 170, 255]), depth: 0.7 }], 'prop-plate'), propPlateRunDir);
  writeFileSync(join(propPlateRunDir, 'meta.json'), JSON.stringify({ prompt_id: 'prop-plate', seed: 42, image_sha256: sha256(propPlateBytes) }));

  const makeEarlyCfg = (occluders?: unknown[], single = false): Record<string, unknown> => ({
    key: 'occluder_propose',
    seethrough: { resolution: SIDE, steps: 30, seed: 42, offload: false, ...(single ? {} : { head_box: [0, 0, SIDE, SIDE] }) },
    assemble: {
      rig_scale: 1,
      take: [{ run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['objects'] }],
      ...(occluders === undefined ? {} : { occluders }),
    },
  });
  const runProposeInProcess = (cfgRaw: Record<string, unknown>, cfgName: string, single = false): PlanProposal => {
    const cfgPath = join(propDir, cfgName);
    writeFileSync(cfgPath, `${JSON.stringify(cfgRaw, null, 2)}\n`);
    const early = loadEarlyConfig(cfgPath, 'layers');
    const src = readPng(propPaintPath);
    const runs = applyTakenLayers(readRuns(propPlateRunDir, single ? null : propPlateRunDir), src, { ...early, assemble: { ...early.assemble, plan: undefined } }, cfgPath);
    const fields = proposeFields(early, single ? { w: src.width, h: src.height } : null);
    const g = { sourceW: src.width, sourceH: src.height, ...fields };
    return single ? proposeSinglePlan(runs.full, g) : proposePlan(runs.full, runs.head, g);
  };

  // Without `over`: `objects` (depth 0.9) is drafted BEFORE `legwear` (depth 0.7).
  const propWithoutOver = runProposeInProcess(
    makeEarlyCfg([{ image: 'occluder.png', sha256: propOccSha, under: ['legwear'], rgb_within: 20 }]),
    'cfg-without-over.json',
  );
  const namesWithoutOver = propWithoutOver.plan.map((r) => `${r[0]}:${r[1]}`);
  // Declaring `over: ['objects']` against that un-reordered draft refuses `ASSEMBLE_OCCLUDER_DRAW_ORDER`.
  const contradictCfg = chainConfig({
    occluders: [{ image: 'occluder.png', sha256: propOccSha, under: ['legwear'], over: ['objects'], rgb_within: 20 }],
    take,
  });
  (contradictCfg.seethrough as Record<string, unknown>).head_box = [0, 0, SIDE, SIDE];
  (contradictCfg.assemble as Record<string, unknown>).plan = propWithoutOver.plan;
  const contradictRes = stage(propDir, propPlateRunDir, contradictCfg, 'out-contradict', propPlateRunDir);
  const contradictRefusal = contradictRes.error?.problems.find((q) => q.code === OCCLUDER_DRAW_ORDER);

  // With `over: ['objects']` (via CLI `--propose-plan --write-config`): `objects` moves after `legwear`, keeping every other row's relative order unchanged, and `assembleStage` accepts that draft.
  const cliWriteCfgPath = join(propDir, 'cfg-with-over.json');
  writeFileSync(cliWriteCfgPath, `${JSON.stringify(makeEarlyCfg([{ image: 'occluder.png', sha256: propOccSha, under: ['legwear'], over: ['objects'], rgb_within: 20 }]), null, 2)}\n`);
  const cliPropose = spawnSync(
    process.execPath,
    [join(root, 'cli.ts'), 'assemble', '--source', propPaintPath, '--full', propPlateRunDir, '--head', propPlateRunDir, '--config', cliWriteCfgPath, '--propose-plan', '--write-config', cliWriteCfgPath],
    { encoding: 'utf8' },
  );
  const propWithOver = cliPropose.status === 0 ? (JSON.parse(cliPropose.stdout) as PlanProposal) : null;
  const namesWithOver = propWithOver?.plan.map((r) => `${r[0]}:${r[1]}`) ?? [];
  const acceptCfg = chainConfig({
    occluders: [{ image: 'occluder.png', sha256: propOccSha, under: ['legwear'], over: ['objects'], rgb_within: 20 }],
    take,
  });
  (acceptCfg.seethrough as Record<string, unknown>).head_box = [0, 0, SIDE, SIDE];
  (acceptCfg.assemble as Record<string, unknown>).plan = propWithOver?.plan ?? [];
  const acceptRes = stage(propDir, propPlateRunDir, acceptCfg, 'out-accept-over', propPlateRunDir);

  // Cross-run `full` `over` (`objects`) / `head` `under` (`legwear`, `face`) and single-run `over` (`objects` over `legwear`):
  const propCrossRun = runProposeInProcess(
    makeEarlyCfg([{ image: 'occluder.png', sha256: propOccSha, under: ['legwear', 'face'], over: ['objects'], rgb_within: 20 }]),
    'cfg-cross-over.json',
  );
  const namesCrossRun = propCrossRun.plan.map((r) => `${r[0]}:${r[1]}`);
  const acceptCrossCfg = chainConfig({
    occluders: [{ image: 'occluder.png', sha256: propOccSha, under: ['legwear', 'face'], over: ['objects'], rgb_within: 20 }],
    take,
  });
  (acceptCrossCfg.seethrough as Record<string, unknown>).head_box = [0, 0, SIDE, SIDE];
  (acceptCrossCfg.assemble as Record<string, unknown>).plan = propCrossRun.plan;
  const acceptCrossRes = stage(propDir, propPlateRunDir, acceptCrossCfg, 'out-accept-cross', propPlateRunDir);
  const propSingleWithout = runProposeInProcess(
    makeEarlyCfg([{ image: 'occluder.png', sha256: propOccSha, under: ['legwear'], rgb_within: 20 }], true),
    'cfg-single-without.json',
    true,
  );
  const propSingleWith = runProposeInProcess(
    makeEarlyCfg([{ image: 'occluder.png', sha256: propOccSha, under: ['legwear'], over: ['objects'], rgb_within: 20 }], true),
    'cfg-single-with.json',
    true,
  );
  say(
    'OC29_PROPOSE_PLAN_HONOURS_OCCLUDER_OVER_AND_ASSEMBLES',
    namesWithoutOver.join(',') === 'objects:full,legwear:full,face:head,eyewhite_r:head,eyewhite_l:head' &&
      contradictRefusal !== undefined &&
      cliPropose.status === 0 &&
      namesWithOver.join(',') === 'legwear:full,objects:full,face:head,eyewhite_r:head,eyewhite_l:head' &&
      acceptRes.error === null &&
      namesCrossRun.join(',') === 'legwear:full,face:head,objects:full,eyewhite_r:head,eyewhite_l:head' &&
      acceptCrossRes.error === null &&
      propSingleWithout.plan.map((r) => r[0]).join(',') === 'objects,legwear,face,eyewhite_r,eyewhite_l' &&
      propSingleWith.plan.map((r) => r[0]).join(',') === 'legwear,objects,face,eyewhite_r,eyewhite_l',
    `without over: [${namesWithoutOver.join(', ')}] (contradicts over -> ${contradictRefusal?.code ?? 'accepted'}); with over: [${namesWithOver.join(', ')}] (assemble: ${acceptRes.error?.message ?? 'accepted'}); cross-run over (under legwear+face): [${namesCrossRun.join(', ')}] (assemble: ${acceptCrossRes.error?.message ?? 'accepted'}); single-run: [${propSingleWithout.plan.map((r) => r[0]).join(', ')}] -> [${propSingleWith.plan.map((r) => r[0]).join(', ')}]`,
  );

  // OC23: A declared cycle refuses at propose time with no write (both in-process proposePlan/proposeSinglePlan and CLI `--propose-plan --write-config`).
  const cycleCfgPath = join(propDir, 'cfg-cycle.json');
  const cycleCfgText = `${JSON.stringify(
    makeEarlyCfg([
      { image: 'occluder.png', sha256: propOccSha, under: ['legwear'], over: ['objects'], rgb_within: 20 },
      { image: 'occluder.png', sha256: propOccSha, under: ['objects'], over: ['legwear'], rgb_within: 20 },
    ]),
    null,
    2,
  )}\n`;
  writeFileSync(cycleCfgPath, cycleCfgText);
  const cycleBeforeSha = sha256(new Uint8Array(readFileSync(cycleCfgPath)));
  const directCycleRuns = readRuns(propPlateRunDir, propPlateRunDir);
  const directCycleRefusal = refusal(() =>
    proposePlan(directCycleRuns.full, directCycleRuns.head, {
      sourceW: SIDE,
      sourceH: SIDE,
      resolution: SIDE,
      headBox: [0, 0, SIDE, SIDE],
      rigScale: 1,
      occluderDeclarations: [
        { image: 'occluder.png', sha256: propOccSha, under: ['legwear'], over: ['objects'], rgb_within: 20 },
        { image: 'occluder.png', sha256: propOccSha, under: ['objects'], over: ['legwear'], rgb_within: 20 },
      ],
    }),
  );
  const cliCycle = spawnSync(
    process.execPath,
    [join(root, 'cli.ts'), 'assemble', '--source', propPaintPath, '--full', propPlateRunDir, '--head', propPlateRunDir, '--config', cycleCfgPath, '--propose-plan', '--write-config', cycleCfgPath],
    { encoding: 'utf8' },
  );
  const cycleAfterSha = sha256(new Uint8Array(readFileSync(cycleCfgPath)));
  const leftoverTemps = readdirSync(propDir).filter((f) => f.includes('.config-write-'));
  const cliCycleOut = `${cliCycle.stdout}${cliCycle.stderr}`;
  say(
    'OC30_PROPOSE_PLAN_REFUSES_DECLARED_OCCLUDER_CYCLE_WITH_NO_WRITE',
    directCycleRefusal?.problems.length === 1 &&
      directCycleRefusal.problems[0].code === OCCLUDER_DRAW_CYCLE &&
      cliCycle.status === 1 &&
      cliCycleOut.includes(OCCLUDER_DRAW_CYCLE) &&
      cliCycleOut.includes('cycle objects -> legwear -> objects') &&
      cycleBeforeSha === cycleAfterSha &&
      leftoverTemps.length === 0,
    `proposePlan refusal: ${directCycleRefusal?.problems[0]?.code ?? 'accepted'}; CLI exit ${cliCycle.status} (${cliCycleOut.trim().split('\n')[0] ?? ''}); config sha256 unchanged: ${cycleBeforeSha === cycleAfterSha}; temp residue: ${leftoverTemps.length}`,
  );

  // OC24: Proposal and `--write-config` without `over` are byte-identical to having no `occluders` on both the occluder chain fixture and the propose fixture.
  const chainAbsentCfgPath = join(deep, 'propose-absent.json');
  const chainNoOverCfgPath = join(deep, 'propose-no-over.json');
  const baseChainEarly = (occs?: unknown[]): string =>
    `${JSON.stringify(
      {
        key: 'occluder_chain',
        seethrough: { resolution: SIDE, steps: 30, seed: 42, offload: false },
        assemble: {
          rig_scale: 1,
          take,
          ...(occs === undefined ? {} : { occluders: occs }),
        },
      },
      null,
      2,
    )}\n`;
  writeFileSync(chainAbsentCfgPath, baseChainEarly());
  writeFileSync(chainNoOverCfgPath, baseChainEarly([declaration(d.occluderSha)]));
  const chainAbsentEarly = loadEarlyConfig(chainAbsentCfgPath, 'layers');
  const chainNoOverEarly = loadEarlyConfig(chainNoOverCfgPath, 'layers');
  const deepSrc = readPng(join(deep, 'painting.png'));
  const deepRunsAbsent = applyTakenLayers(readRuns(plateRunDir, null), deepSrc, { ...chainAbsentEarly, assemble: { ...chainAbsentEarly.assemble, plan: undefined } }, chainAbsentCfgPath);
  const deepRunsNoOver = applyTakenLayers(readRuns(plateRunDir, null), deepSrc, { ...chainNoOverEarly, assemble: { ...chainNoOverEarly.assemble, plan: undefined } }, chainNoOverCfgPath);
  const chainPropAbsent = JSON.stringify(proposeSinglePlan(deepRunsAbsent.full, { sourceW: SIDE, sourceH: SIDE, ...proposeFields(chainAbsentEarly, { w: SIDE, h: SIDE }) }), null, 2);
  const chainPropNoOver = JSON.stringify(proposeSinglePlan(deepRunsNoOver.full, { sourceW: SIDE, sourceH: SIDE, ...proposeFields(chainNoOverEarly, { w: SIDE, h: SIDE }) }), null, 2);
  const propAbsent = runProposeInProcess(makeEarlyCfg(undefined), 'cfg-absent.json');
  const writeAbsentPath = join(propDir, 'write-absent.json');
  const writeNoOverPath = join(propDir, 'write-no-over.json');
  const sharedWriteBase = `${JSON.stringify(makeEarlyCfg(undefined), null, 2)}\n`;
  writeFileSync(writeAbsentPath, sharedWriteBase);
  writeFileSync(writeNoOverPath, `${JSON.stringify(makeEarlyCfg([{ image: 'occluder.png', sha256: propOccSha, under: ['legwear'], rgb_within: 20 }]), null, 2)}\n`);
  const cliWriteAbsent = spawnSync(
    process.execPath,
    [join(root, 'cli.ts'), 'assemble', '--source', propPaintPath, '--full', propPlateRunDir, '--head', propPlateRunDir, '--config', writeAbsentPath, '--propose-plan', '--write-config', writeAbsentPath],
    { encoding: 'utf8' },
  );
  const cliWriteNoOver = spawnSync(
    process.execPath,
    [join(root, 'cli.ts'), 'assemble', '--source', propPaintPath, '--full', propPlateRunDir, '--head', propPlateRunDir, '--config', writeNoOverPath, '--propose-plan', '--write-config', writeNoOverPath],
    { encoding: 'utf8' },
  );
  const writtenNoOver = JSON.parse(readFileSync(writeNoOverPath, 'utf8')) as { assemble: Record<string, unknown> };
  delete writtenNoOver.assemble.occluders;
  const writtenAbsent = JSON.parse(readFileSync(writeAbsentPath, 'utf8')) as { assemble: Record<string, unknown> };
  say(
    'OC31_PROPOSE_PLAN_WITHOUT_OVER_IS_BYTE_IDENTICAL',
    chainPropAbsent === chainPropNoOver &&
      JSON.stringify(propAbsent) === JSON.stringify(propWithoutOver) &&
      cliWriteAbsent.status === 0 &&
      cliWriteNoOver.status === 0 &&
      cliWriteAbsent.stdout === cliWriteNoOver.stdout &&
      JSON.stringify(writtenAbsent) === JSON.stringify(writtenNoOver),
    `occluder_chain proposal bytes equal: ${chainPropAbsent === chainPropNoOver}; two-run proposal bytes equal: ${JSON.stringify(propAbsent) === JSON.stringify(propWithoutOver)}; --write-config stdout equal: ${cliWriteAbsent.stdout === cliWriteNoOver.stdout}`,
  );
  // Issue #1242 controls (OC22–OC28): TakeOccluderSplit (`assemble.take` variant with `part`, `tag`, `occluder`).
  const splitHome = join(dir, 'occluder-split');
  rmSync(splitHome, { recursive: true, force: true });
  const sInputs = writeChainInputs(splitHome);
  const limbTotalPx = (LIMB[2] - LIMB[0]) * (LIMB[3] - LIMB[1]); // 9,216
  const visibleLimbPx = limbTotalPx - OCCLUDER_PX; // 7,168
  const visibleDefectBox: [number, number, number, number] = [20, 20, 36, 36]; // 16x16 = 256 px in visible limb
  const visibleDefectRgba: [number, number, number, number] = [220, 40, 200, 200];
  const visibleDefectTargetPx = (visibleDefectBox[2] - visibleDefectBox[0]) * (visibleDefectBox[3] - visibleDefectBox[1]); // 256
  const isInside = (box: readonly number[], x: number, y: number): boolean => x >= box[0] && x < box[2] && y >= box[1] && y < box[3];

  // Build planted plate run: covered 2,048 px is right; a 256 px [20, 20, 36, 36] plant in the visible limb.
  const plantedPlateSet = buildPlateRun(chainPlate());
  const plantedPlateLimb = plantedPlateSet.layers.find((l) => l.name === 'legwear')!;
  for (let y = visibleDefectBox[1]; y < visibleDefectBox[3]; y++) {
    for (let x = visibleDefectBox[0]; x < visibleDefectBox[2]; x++) {
      plantedPlateLimb.pixels.data.set(visibleDefectRgba, (y * SIDE + x) * 4);
    }
  }
  const plantedPlateDir = join(splitHome, 'plate-planted');
  exportLayers(plantedPlateSet, plantedPlateDir);
  writeFileSync(join(plantedPlateDir, 'meta.json'), JSON.stringify({ prompt_id: 'generated-plate-planted', seed: 7 }));

  const readPartCanvas = (outSubdir: string, partName: string): { canvas: Raster; coveredRight: number; visibleRight: number; visibleDefect: number } | null => {
    const pJsonPath = join(splitHome, outSubdir, 'parts.json');
    const pPngPath = join(splitHome, outSubdir, 'parts', `${partName}.png`);
    if (!existsSync(pJsonPath) || !existsSync(pPngPath)) return null;
    const pf = readParts(pJsonPath);
    const meta = pf.parts.find((pt) => pt.name === partName);
    if (!meta) return null;
    const crop = readPng(pPngPath);
    const canvas = newRaster(SIDE, SIDE);
    const bx0 = meta.x, by0 = meta.y;
    for (let cy = 0; cy < crop.height; cy++) {
      for (let cx = 0; cx < crop.width; cx++) {
        const si = (cy * crop.width + cx) * 4;
        const di = ((by0 + cy) * SIDE + (bx0 + cx)) * 4;
        canvas.data.set(crop.data.subarray(si, si + 4), di);
      }
    }
    let coveredRight = 0;
    let visibleRight = 0;
    let visibleDefect = 0;
    for (let y = LIMB[1]; y < LIMB[3]; y++) {
      for (let x = LIMB[0]; x < LIMB[2]; x++) {
        const idx = (y * SIDE + x) * 4;
        const isLimbPixel =
          canvas.data[idx] === LIMB_RGB[0] &&
          canvas.data[idx + 1] === LIMB_RGB[1] &&
          canvas.data[idx + 2] === LIMB_RGB[2] &&
          canvas.data[idx + 3] === 255;
        if (isInside(OCCLUDER, x, y)) {
          if (isLimbPixel) coveredRight++;
        } else {
          if (isLimbPixel) visibleRight++;
          else visibleDefect++;
        }
      }
    }
    return { canvas, coveredRight, visibleRight, visibleDefect };
  };

  // Bar 1 (OC22): Plate only — base is the planted plate run, no split on `behind` -> covered 2,048 is right;
  // the 256 px plant in the visible region shows as the visible defect, counted on the part.
  const bar1Run = stage(
    splitHome,
    plantedPlateDir,
    chainConfig({ require_hidden_extent: reqHidden, occluders: [declaration(sInputs.occluderSha)], take }),
    'out-bar1-plate-only',
  );
  const bar1Parts = bar1Run.error === null ? readParts(join(splitHome, 'out-bar1-plate-only', 'parts.json')) : null;
  const bar1Behind = bar1Parts?.parts.find((pt) => pt.name === 'behind');
  const bar1Canvas = readPartCanvas('out-bar1-plate-only', 'behind');
  say('OC22_PLATE_ONLY_KEEPS_COVERED_2048_AND_SHOWS_256_PX_VISIBLE_DEFECT',
    bar1Run.error === null &&
      bar1Canvas?.coveredRight === OCCLUDER_PX &&
      bar1Canvas?.visibleRight === visibleLimbPx - visibleDefectTargetPx &&
      bar1Canvas?.visibleDefect === visibleDefectTargetPx &&
      bar1Behind?.opaque_px === limbTotalPx &&
      bar1Parts?.recomposite?.error_px === visibleDefectTargetPx,
    `${bar1Run.error?.message ?? 'assembled'}; covered=${bar1Canvas?.coveredRight}/${OCCLUDER_PX}, visible_right=${bar1Canvas?.visibleRight}/${visibleLimbPx}, visible_defect=${bar1Canvas?.visibleDefect} (want ${visibleDefectTargetPx}), behind.opaque_px=${bar1Behind?.opaque_px}, recomposite.error_px=${bar1Parts?.recomposite?.error_px}`);

  // Bar 2 (OC23): Painting-run whole-layer take of `legwear` -> visible 7,168 is right, and the hidden extent is missing on 2,048 px.
  const wholeTake = [{ run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['legwear', 'objects'] }];
  const bar2Refused = stage(
    splitHome,
    plantedPlateDir,
    chainConfig({ require_hidden_extent: reqHidden, occluders: [declaration(sInputs.occluderSha)], take: wholeTake }),
    'out-bar2-whole-refused',
  );
  const bar2Absent = bar2Refused.error?.problems.find((pr) => pr.code === 'ASSEMBLE_HIDDEN_EXTENT_ABSENT');
  const bar2Unchecked = stage(
    splitHome,
    plantedPlateDir,
    chainConfig({ occluders: [declaration(sInputs.occluderSha)], take: wholeTake }),
    'out-bar2-whole-unchecked',
  );
  const bar2Canvas = readPartCanvas('out-bar2-whole-unchecked', 'behind');
  const bar2MissingHidden = bar2Canvas !== null ? OCCLUDER_PX - bar2Canvas.coveredRight : -1;
  say('OC23_WHOLE_LAYER_PAINTING_TAKE_HAS_VISIBLE_7168_AND_MISSES_2048_HIDDEN_EXTENT',
    bar2Absent?.detail.includes(`${OCCLUDER_PX} enclosed-hole rig cells of ${OCCLUDER_PX}`) === true &&
      bar2Unchecked.error === null &&
      bar2Canvas?.visibleRight === visibleLimbPx &&
      bar2Canvas?.visibleDefect === 0 &&
      bar2Canvas?.coveredRight === 0 &&
      bar2MissingHidden === OCCLUDER_PX,
    `with require_hidden_extent: ${bar2Absent?.detail.split(';')[0] ?? 'accepted'}; without: visible_right=${bar2Canvas?.visibleRight}/${visibleLimbPx}, covered_right=${bar2Canvas?.coveredRight}, missing_hidden=${bar2MissingHidden}`);

  // Bar 3 (OC24): Split take -> covered_px = 2,048 from base and visible_px = 7,168 from donor;
  // 9,216 opaque px, 0 hidden-extent holes, 0 copied occluder px, and parts.json round-trips `split`.
  const splitTake = [
    { run: 'full', run_dir: 'orig', st_input: 'painting.png', part: 'behind', tag: 'legwear', occluder: 0 },
    { run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['objects'] },
  ];
  const bar3Run = stage(
    splitHome,
    plantedPlateDir,
    chainConfig({ require_hidden_extent: reqHidden, occluders: [declaration(sInputs.occluderSha)], take: splitTake }),
    'out-bar3-split',
  );
  const bar3PartsPath = join(splitHome, 'out-bar3-split', 'parts.json');
  const bar3Parts = bar3Run.error === null && existsSync(bar3PartsPath) ? readParts(bar3PartsPath) : null;
  const bar3Behind = bar3Parts?.parts.find((pt) => pt.name === 'behind');
  const bar3Split = bar3Behind?.taken_layers?.[0]?.split;
  const bar3Canvas = readPartCanvas('out-bar3-split', 'behind');
  const wantSplit = {
    occluder: 0,
    image: 'occluder.png',
    sha256: sInputs.occluderSha,
    covered_px: OCCLUDER_PX,
    visible_px: visibleLimbPx,
  };
  const badSplitPath = join(splitHome, 'out-bar3-split', 'parts-bad-split.json');
  if (bar3Parts !== null) {
    const rawSplit = JSON.parse(readFileSync(bar3PartsPath, 'utf8')) as { parts: Array<{ name: string; taken_layers?: Array<{ split?: Record<string, unknown> }> }> };
    const bEntry = rawSplit.parts.find((pt) => pt.name === 'behind');
    if (bEntry?.taken_layers?.[0]?.split) bEntry.taken_layers[0].split.covered_px = 0;
    writeFileSync(badSplitPath, JSON.stringify(rawSplit));
  }
  const badSplitRefusal = bar3Parts !== null ? refusal(() => readParts(badSplitPath))?.problems.find((pr) => pr.code === 'PARTS_TAKEN_LAYERS' && pr.detail.includes('covered_px and visible_px')) : undefined;
  say('OC24_SPLIT_TAKE_MERGES_COVERED_2048_AND_VISIBLE_7168_AND_ROUND_TRIPS_PARTS_JSON',
    bar3Run.error === null &&
      copied(bar3Run.lines).length === 0 &&
      bar3Behind?.opaque_px === limbTotalPx &&
      bar3Canvas?.coveredRight === OCCLUDER_PX &&
      bar3Canvas?.visibleRight === visibleLimbPx &&
      bar3Canvas?.visibleDefect === 0 &&
      bar3Parts?.recomposite?.error_px === 0 &&
      JSON.stringify(bar3Split) === JSON.stringify(wantSplit) &&
      badSplitRefusal !== undefined,
    `${bar3Run.error?.message ?? 'assembled'}; opaque_px=${bar3Behind?.opaque_px}/${limbTotalPx}, covered=${bar3Canvas?.coveredRight}, visible=${bar3Canvas?.visibleRight}, visible_defect=${bar3Canvas?.visibleDefect}, copied_warn=${copied(bar3Run.lines).length}, split=${JSON.stringify(bar3Split)}, reader_plant=${badSplitRefusal?.code ?? 'accepted'}`);

  // Bar 4 (OC25): Identity on visible only — taint at (64,64) deep inside occluder (beyond 5x5 collar) passes with differing = 0;
  // taint at (20,20) on visible limb refuses ASSEMBLE_TAKE_INPUT_IDENTITY.
  const taintedCoveredInput = chainPlate();
  for (let y = OCCLUDER[1]; y < OCCLUDER[3]; y++) for (let x = OCCLUDER[0]; x < OCCLUDER[2]; x++) taintedCoveredInput.data.set([...OCCLUDER_RGB, 255], (y * SIDE + x) * 4);
  taintedCoveredInput.data.set([0, 255, 0, 255], (64 * SIDE + 64) * 4);
  writeFileSync(join(splitHome, 'st-input-covered-taint.png'), encodePngBytes(taintedCoveredInput));

  const taintedVisibleInput = chainPlate();
  for (let y = OCCLUDER[1]; y < OCCLUDER[3]; y++) for (let x = OCCLUDER[0]; x < OCCLUDER[2]; x++) taintedVisibleInput.data.set([...OCCLUDER_RGB, 255], (y * SIDE + x) * 4);
  taintedVisibleInput.data.set([0, 255, 0, 255], (20 * SIDE + 20) * 4);
  writeFileSync(join(splitHome, 'st-input-visible-taint.png'), encodePngBytes(taintedVisibleInput));

  const bar4CoveredOk = stage(
    splitHome,
    plantedPlateDir,
    chainConfig({
      require_hidden_extent: reqHidden,
      occluders: [declaration(sInputs.occluderSha)],
      take: [
        { run: 'full', run_dir: 'orig', st_input: 'st-input-covered-taint.png', part: 'behind', tag: 'legwear', occluder: 0 },
        { run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['objects'] },
      ],
    }),
    'out-bar4-covered-taint',
  );
  const bar4CoveredParts = bar4CoveredOk.error === null ? readParts(join(splitHome, 'out-bar4-covered-taint', 'parts.json')) : null;
  const bar4CoveredDiff = bar4CoveredParts?.parts.find((pt) => pt.name === 'behind')?.taken_layers?.[0]?.differing_px;

  const bar4VisibleRefused = stage(
    splitHome,
    plantedPlateDir,
    chainConfig({
      require_hidden_extent: reqHidden,
      occluders: [declaration(sInputs.occluderSha)],
      take: [
        { run: 'full', run_dir: 'orig', st_input: 'st-input-visible-taint.png', part: 'behind', tag: 'legwear', occluder: 0 },
        { run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['objects'] },
      ],
    }),
    'out-bar4-visible-taint',
  );
  const bar4IdProb = bar4VisibleRefused.error?.problems.find((pr) => pr.code === 'ASSEMBLE_TAKE_INPUT_IDENTITY');
  say('OC25_SPLIT_IDENTITY_CHECKS_VISIBLE_SUPPORT_ONLY',
    bar4CoveredOk.error === null &&
      bar4CoveredDiff === 0 &&
      bar4IdProb !== undefined &&
      bar4IdProb.detail.includes('1 differing pixel(s), bbox [20, 20, 21, 21]') &&
      !existsSync(join(splitHome, 'out-bar4-visible-taint')),
    `covered taint (64,64): ${bar4CoveredOk.error?.message ?? `differing_px=${bar4CoveredDiff}`}; visible taint (20,20): ${bar4IdProb ? `${bar4IdProb.code}: ${bar4IdProb.detail}` : (bar4VisibleRefused.error?.message ?? 'accepted')}`);

  // Bar 5a (OC26): ASSEMBLE_TAKE_SPLIT_OCCLUDER ×3 (bad index, not in `under`, in `over`).
  const splitOccPlants = [
    {
      label: 'bad-index',
      occluders: [declaration(sInputs.occluderSha)],
      takeItem: { run: 'full' as const, run_dir: 'orig', st_input: 'painting.png', part: 'behind', tag: 'legwear', occluder: 1 },
      expectSubstr: 'does not exist in config.assemble.occluders',
    },
    {
      label: 'not-in-under',
      occluders: [declaration(sInputs.occluderSha)],
      takeItem: { run: 'full' as const, run_dir: 'orig', st_input: 'painting.png', part: 'face', tag: 'face', occluder: 0 },
      expectSubstr: 'not in config.assemble.occluders[0].under',
    },
    {
      label: 'in-over',
      occluders: [declaration(sInputs.occluderSha, { under: ['behind'], over: ['front'] })],
      takeItem: { run: 'full' as const, run_dir: 'orig', st_input: 'painting.png', part: 'front', tag: 'objects', occluder: 0 },
      expectSubstr: 'in config.assemble.occluders[0].over',
    },
  ];
  const basePlateLayerSet = readLayers(plantedPlateDir);
  const splitOccResults = splitOccPlants.map(({ label, occluders: occs, takeItem, expectSubstr }) => {
    const takeList =
      takeItem.tag === 'objects'
        ? [takeItem]
        : [takeItem, { run: 'full' as const, run_dir: 'orig', st_input: 'painting.png', tags: ['objects'] }];
    const cfg = chainConfig({ occluders: occs, take: takeList });
    const cfgProb = refusal(() => parseConfig(cfg))?.problems.find((pr) => pr.code === TAKE_SPLIT_OCCLUDER);
    const earlyProb = refusal(() => parseEarlyConfig(cfg, 'assemble'))?.problems.find((pr) => pr.code === TAKE_SPLIT_OCCLUDER);
    const stageOut = `out-bar5-occ-${label}`;
    const stageRes = stage(splitHome, plantedPlateDir, cfg, stageOut);
    const stageProb = stageRes.error?.problems.find((pr) => pr.code === TAKE_SPLIT_OCCLUDER);
    const directProb = refusal(() =>
      applyTakenLayers(
        { full: basePlateLayerSet, head: basePlateLayerSet, single: true },
        readPng(sInputs.painting),
        {
          seethrough: { resolution: SIDE, steps: 20, seed: 42, offload: false },
          assemble: {
            take: takeList,
            plan: [
              ['face', 'full', 'face'],
              ['eye_r', 'full', 'eyewhite-r'],
              ['eye_l', 'full', 'eyewhite-l'],
              ['behind', 'full', 'legwear'],
              ['front', 'full', 'objects'],
            ],
            occluders: occs.map((o) => ({
              image: String(o.image),
              sha256: String(o.sha256),
              under: o.under as string[],
              ...(o.over !== undefined ? { over: o.over as string[] } : {}),
              rgb_within: Number(o.rgb_within),
            })),
          },
        },
        join(splitHome, 'config.json'),
      ),
    )?.problems.find((pr) => pr.code === TAKE_SPLIT_OCCLUDER);
    const ok =
      cfgProb?.detail.includes(expectSubstr) === true &&
      earlyProb?.detail.includes(expectSubstr) === true &&
      stageProb?.detail.includes(expectSubstr) === true &&
      directProb?.detail.includes(expectSubstr) === true &&
      !existsSync(join(splitHome, stageOut));
    return { label, ok, detail: directProb?.detail ?? 'accepted' };
  });
  say('OC26_SPLIT_OCCLUDER_REFUSES_BAD_INDEX_NOT_IN_UNDER_AND_IN_OVER',
    splitOccResults.every((r) => r.ok),
    splitOccResults.map((r) => `${r.label}: ${r.detail}`).join(' | '));

  // Bar 5b (OC27): ASSEMBLE_TAKE_SPLIT_EMPTY ×2 (empty covered, empty visible).
  const emptyCoveredPlateSet = buildPlateRun(chainPlate());
  const emptyCoveredLimb = emptyCoveredPlateSet.layers.find((l) => l.name === 'legwear')!;
  for (let y = OCCLUDER[1]; y < OCCLUDER[3]; y++) {
    for (let x = OCCLUDER[0]; x < OCCLUDER[2]; x++) {
      emptyCoveredLimb.pixels.data.set([0, 0, 0, 0], (y * SIDE + x) * 4);
    }
  }
  const emptyCoveredPlateDir = join(splitHome, 'plate-empty-covered');
  exportLayers(emptyCoveredPlateSet, emptyCoveredPlateDir);
  writeFileSync(join(emptyCoveredPlateDir, 'meta.json'), JSON.stringify({ prompt_id: 'generated-plate-empty-covered', seed: 7 }));

  const emptyVisibleDonorSet = readLayers(join(splitHome, 'orig'));
  const emptyVisibleLimb = emptyVisibleDonorSet.layers.find((l) => l.name === 'legwear')!;
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      if (isInside(OCCLUDER, x, y)) emptyVisibleLimb.pixels.data.set([...LIMB_RGB, 255], (y * SIDE + x) * 4);
      else emptyVisibleLimb.pixels.data.set([0, 0, 0, 0], (y * SIDE + x) * 4);
    }
  }
  const emptyVisibleDonorDir = join(splitHome, 'orig-empty-visible');
  exportLayers(emptyVisibleDonorSet, emptyVisibleDonorDir);
  writeFileSync(join(emptyVisibleDonorDir, 'meta.json'), JSON.stringify({ prompt_id: 'generated-orig-empty-visible', seed: 42 }));

  const emptyCoveredRun = stage(
    splitHome,
    emptyCoveredPlateDir,
    chainConfig({ occluders: [declaration(sInputs.occluderSha)], take: splitTake }),
    'out-bar5-empty-covered',
  );
  const emptyCoveredProb = emptyCoveredRun.error?.problems.find((pr) => pr.code === TAKE_SPLIT_EMPTY);

  const emptyVisibleRun = stage(
    splitHome,
    plantedPlateDir,
    chainConfig({
      occluders: [declaration(sInputs.occluderSha)],
      take: [
        { run: 'full', run_dir: 'orig-empty-visible', st_input: 'painting.png', part: 'behind', tag: 'legwear', occluder: 0 },
        { run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['objects'] },
      ],
    }),
    'out-bar5-empty-visible',
  );
  const emptyVisibleProb = emptyVisibleRun.error?.problems.find((pr) => pr.code === TAKE_SPLIT_EMPTY);
  say('OC27_SPLIT_EMPTY_REFUSES_ZERO_COVERED_AND_ZERO_VISIBLE_SUPPORT',
    emptyCoveredProb?.detail.includes('covered_px is 0') === true &&
      emptyCoveredProb?.detail.includes(`visible_px is ${visibleLimbPx}`) === true &&
      !existsSync(join(splitHome, 'out-bar5-empty-covered')) &&
      emptyVisibleProb?.detail.includes(`covered_px is ${OCCLUDER_PX}`) === true &&
      emptyVisibleProb?.detail.includes('visible_px is 0') === true &&
      !existsSync(join(splitHome, 'out-bar5-empty-visible')),
    `empty covered: ${emptyCoveredProb?.detail ?? 'accepted'}; empty visible: ${emptyVisibleProb?.detail ?? 'accepted'}`);

  // Bar 7 (OC28): Seam at the occluder edge — number of (covered px, visible 4-neighbour) pairs
  // where the split part's alpha is > COPIED_ALPHA_ABOVE (128) on one side and <= 128 on the other.
  // Fixture as is (plate limb = painting limb = LIMB): 0.
  // Planted narrower-limb plate [16, 16, 64, 112] (right edge inside OCCLUDER [48, 32, 80, 96]): 96.
  const countOccluderEdgeSeams = (partCanvas: Raster, occMask: Raster): number => {
    let seams = 0;
    const dirs: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let y = 0; y < SIDE; y++) {
      for (let x = 0; x < SIDE; x++) {
        if (occMask.data[(y * SIDE + x) * 4 + 3] <= COPIED_ALPHA_ABOVE) continue;
        const covOpaque = partCanvas.data[(y * SIDE + x) * 4 + 3] > COPIED_ALPHA_ABOVE;
        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= SIDE || ny < 0 || ny >= SIDE) continue;
          if (occMask.data[(ny * SIDE + nx) * 4 + 3] > COPIED_ALPHA_ABOVE) continue;
          const visOpaque = partCanvas.data[(ny * SIDE + nx) * 4 + 3] > COPIED_ALPHA_ABOVE;
          if (covOpaque !== visOpaque) seams++;
        }
      }
    }
    return seams;
  };
  const occMaskRaster = readPng(sInputs.occluder);
  const fullPlateDir = writePlateRun(splitHome, encodePngBytes(chainPlate()));
  const fullSplitRun = stage(
    splitHome,
    fullPlateDir,
    chainConfig({ occluders: [declaration(sInputs.occluderSha)], take: splitTake }),
    'out-bar7-full-limb',
  );
  const fullSplitCanvas = readPartCanvas('out-bar7-full-limb', 'behind');
  const fullSeams = fullSplitCanvas !== null ? countOccluderEdgeSeams(fullSplitCanvas.canvas, occMaskRaster) : -1;

  const narrowPlateSet = buildPlateRun(chainPlate());
  const narrowLimb = narrowPlateSet.layers.find((l) => l.name === 'legwear')!;
  for (let y = LIMB[1]; y < LIMB[3]; y++) {
    for (let x = 64; x < LIMB[2]; x++) {
      narrowLimb.pixels.data.set([0, 0, 0, 0], (y * SIDE + x) * 4);
    }
  }
  const narrowPlateDir = join(splitHome, 'plate-narrow');
  exportLayers(narrowPlateSet, narrowPlateDir);
  writeFileSync(join(narrowPlateDir, 'meta.json'), JSON.stringify({ prompt_id: 'generated-plate-narrow', seed: 7 }));
  const narrowSplitRun = stage(
    splitHome,
    narrowPlateDir,
    chainConfig({ occluders: [declaration(sInputs.occluderSha)], take: splitTake }),
    'out-bar7-narrow-limb',
  );
  const narrowSplitCanvas = readPartCanvas('out-bar7-narrow-limb', 'behind');
  const narrowSeams = narrowSplitCanvas !== null ? countOccluderEdgeSeams(narrowSplitCanvas.canvas, occMaskRaster) : -1;
  say('OC28_OCCLUDER_EDGE_SEAM_COUNT_IS_0_ON_MATCHED_LIMB_AND_96_ON_NARROW_PLATE',
    fullSplitRun.error === null && narrowSplitRun.error === null && fullSeams === 0 && narrowSeams === 96,
    `matched limb [16,16,112,112]: seam_pairs=${fullSeams} (want 0); narrower plate limb [16,16,64,112]: seam_pairs=${narrowSeams} (want 96)`);

  // Issue #1246 controls (OC32–OC37): partial-`over` twin, automatic `under` visible-projection guard,
  // opt-in `painting:<part>` occluder part, `ASSEMBLE_OCCLUDER_EMPTY`, and `ASSEMBLE_OCCLUDER_UNHELD`.
  const partHome = join(dir, 'occluder-part-twin');
  rmSync(partHome, { recursive: true, force: true });
  const pInputs = writePartialOverInputs(partHome);
  const partialTake = [{ run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['objects'] }];

  const partialCfgWithPart = (): Record<string, unknown> => {
    const cfg = chainConfig({
      occluders: [declaration(pInputs.occluderSha, { over: ['front'], part: 'occ_fg' })],
      take: partialTake,
    });
    (cfg.regions as Record<string, unknown>).occ_fg = 'root';
    return cfg;
  };

  const placePartOnCanvas = (outDir: string, partName: string, dx = 0, dy = 0): Raster | null => {
    const pJsonPath = join(partHome, outDir, 'parts.json');
    const pPngPath = join(partHome, outDir, 'parts', `${partName}.png`);
    if (!existsSync(pJsonPath) || !existsSync(pPngPath)) return null;
    const pf = readParts(pJsonPath);
    const meta = pf.parts.find((pt) => pt.name === partName);
    if (!meta) return null;
    const crop = readPng(pPngPath);
    const canvas = newRaster(SIDE, SIDE);
    for (let cy = 0; cy < crop.height; cy++) {
      for (let cx = 0; cx < crop.width; cx++) {
        const tx = meta.x + cx + dx;
        const ty = meta.y + cy + dy;
        if (tx < 0 || tx >= SIDE || ty < 0 || ty >= SIDE) continue;
        const si = (cy * crop.width + cx) * 4;
        const di = (ty * SIDE + tx) * 4;
        canvas.data.set(crop.data.subarray(si, si + 4), di);
      }
    }
    return canvas;
  };

  const compositeStack = (layersInDrawOrder: ReadonlyArray<{ name: string; raster: Raster }>): Raster => {
    const out = newRaster(SIDE, SIDE);
    out.data.fill(255);
    for (const { raster } of layersInDrawOrder) {
      for (let p = 0; p < SIDE * SIDE; p++) {
        const sa = raster.data[p * 4 + 3] / 255;
        if (sa <= 0) continue;
        const da = 1 - sa;
        out.data[p * 4] = Math.round(raster.data[p * 4] * sa + out.data[p * 4] * da);
        out.data[p * 4 + 1] = Math.round(raster.data[p * 4 + 1] * sa + out.data[p * 4 + 1] * da);
        out.data[p * 4 + 2] = Math.round(raster.data[p * 4 + 2] * sa + out.data[p * 4 + 2] * da);
        out.data[p * 4 + 3] = 255;
      }
    }
    return out;
  };

  // Bar 1 (OC32): (i) Rest — of the 2,048 occluder px, top-most holder at alpha >= 250 is `front` (`over`) on 1,024
  // and `occ_fg` (`part`) on 1,024 (`0` for `behind`, `0` empty); draw order is `behind < occ_fg < front`.
  const twinWithPartRun = stage(partHome, pInputs.plateRunDir, partialCfgWithPart(), 'out-with-part');
  const twinPartsFile = twinWithPartRun.error === null ? readParts(join(partHome, 'out-with-part', 'parts.json')) : null;
  const twinPartNames = twinPartsFile?.parts.map((pt) => pt.name) ?? [];
  const behindIdx = twinPartNames.indexOf('behind');
  const occFgIdx = twinPartNames.indexOf('occ_fg');
  const frontIdx = twinPartNames.indexOf('front');
  const stackCanvases = twinPartNames
    .map((name) => ({ name, raster: placePartOnCanvas('out-with-part', name) }))
    .filter((entry): entry is { name: string; raster: Raster } => entry.raster !== null);

  let topOverPx = 0;
  let topOccPartPx = 0;
  let topUnderPx = 0;
  let topEmptyPx = 0;
  for (let y = OCCLUDER[1]; y < OCCLUDER[3]; y++) {
    for (let x = OCCLUDER[0]; x < OCCLUDER[2]; x++) {
      const p = (y * SIDE + x) * 4;
      let holder: string | null = null;
      for (let i = stackCanvases.length - 1; i >= 0; i--) {
        if (stackCanvases[i].raster.data[p + 3] >= 250) {
          holder = stackCanvases[i].name;
          break;
        }
      }
      if (holder === 'front') topOverPx++;
      else if (holder === 'occ_fg') topOccPartPx++;
      else if (holder === 'behind') topUnderPx++;
      else topEmptyPx++;
    }
  }
  say('OC32_PARTIAL_OVER_REST_HOLDERS_SPLIT_1024_OVER_AND_1024_OCCLUDER_PART',
    twinWithPartRun.error === null &&
      behindIdx >= 0 &&
      occFgIdx === behindIdx + 1 &&
      occFgIdx < frontIdx &&
      topOverPx === PARTIAL_HALF_PX &&
      topOccPartPx === PARTIAL_HALF_PX &&
      topUnderPx === 0 &&
      topEmptyPx === 0 &&
      twinPartsFile?.recomposite?.error_px === 0,
    `${twinWithPartRun.error?.message ?? 'assembled'}; order=${twinPartNames.join('->')}; top holders at alpha>=250 over ${OCCLUDER_PX} occluder px: front=${topOverPx}, occ_fg=${topOccPartPx}, behind=${topUnderPx}, empty=${topEmptyPx}; recomposite.error_px=${twinPartsFile?.recomposite?.error_px}`);

  // Bar 2 (OC33): (i') No ghost — occluder part's px intersect `over` part's held core (alpha >= 250) = 0;
  // `occ_fg` holds only the lower 1,024 px [48, 64, 80, 96) with exact counts (`PARTS_COUNTS_ADD_UP` and `ASSEMBLE_COUNTS_ADD_UP`).
  const occFgMeta = twinPartsFile?.parts.find((pt) => pt.name === 'occ_fg');
  const occFgCanvas = placePartOnCanvas('out-with-part', 'occ_fg');
  const frontCanvas = placePartOnCanvas('out-with-part', 'front');
  let ghostOverlapPx = 0;
  let lowerExactPx = 0;
  let outsideLowerOpaquePx = 0;
  if (occFgCanvas !== null && frontCanvas !== null) {
    for (let y = 0; y < SIDE; y++) {
      for (let x = 0; x < SIDE; x++) {
        const p = (y * SIDE + x) * 4;
        const occAlpha = occFgCanvas.data[p + 3];
        const frontAlpha = frontCanvas.data[p + 3];
        if (occAlpha > 0 && frontAlpha >= CORE_ALPHA) ghostOverlapPx++;
        if (isInside(PARTIAL_LOWER_BOX, x, y)) {
          if (
            occFgCanvas.data[p] === PARTIAL_OCCLUDER_RGB[0] &&
            occFgCanvas.data[p + 1] === PARTIAL_OCCLUDER_RGB[1] &&
            occFgCanvas.data[p + 2] === PARTIAL_OCCLUDER_RGB[2] &&
            occAlpha === 255
          ) {
            lowerExactPx++;
          }
        } else if (occAlpha > 0) {
          outsideLowerOpaquePx++;
        }
      }
    }
  }
  say('OC33_OCCLUDER_PART_EXCLUDES_OVER_HELD_CORE_WITH_ZERO_GHOST_OVERLAP',
    occFgMeta !== undefined &&
      occFgMeta.from === 'painting:occ_fg' &&
      occFgMeta.x === PARTIAL_LOWER_BOX[0] &&
      occFgMeta.y === PARTIAL_LOWER_BOX[1] &&
      occFgMeta.w === PARTIAL_LOWER_BOX[2] - PARTIAL_LOWER_BOX[0] &&
      occFgMeta.h === PARTIAL_LOWER_BOX[3] - PARTIAL_LOWER_BOX[1] &&
      occFgMeta.opaque_px === PARTIAL_HALF_PX &&
      occFgMeta.visible_px === PARTIAL_HALF_PX &&
      occFgMeta.occluded_px === 0 &&
      occFgMeta.projected_core_px === PARTIAL_HALF_PX &&
      occFgMeta.source_px_taken === PARTIAL_HALF_PX &&
      ghostOverlapPx === 0 &&
      lowerExactPx === PARTIAL_HALF_PX &&
      outsideLowerOpaquePx === 0,
    `occ_fg: from=${occFgMeta?.from}, box=[${occFgMeta?.x},${occFgMeta?.y},${occFgMeta?.w},${occFgMeta?.h}], opaque=${occFgMeta?.opaque_px}, visible=${occFgMeta?.visible_px}, occluded=${occFgMeta?.occluded_px}, overlap_with_over_core=${ghostOverlapPx}, lower_exact=${lowerExactPx}/${PARTIAL_HALF_PX}, outside_lower=${outsideLowerOpaquePx}`);

  // Bar 3 (OC34): (ii) Motion, `under` — in assembled `parts/behind.png`, 0 of the 2,048 occluder px carry projected
  // painting (`PARTIAL_OCCLUDER_RGB`) and all 2,048 equal `LIMB_RGB`; translating `behind` by dx = -32 out from
  // behind the occluder and re-reading those 2,048 px on the posed frame gives 2,048 `LIMB_RGB` and 0 projected;
  // cut pieces and limb segments derived from `behind` inherit the guard (whereas undeclared `--project visible`
  // projects 1,024 painting occluder px onto `behind`).
  const behindCanvas = placePartOnCanvas('out-with-part', 'behind');
  let behindBaseAtOccluder = 0;
  let behindProjectedAtOccluder = 0;
  if (behindCanvas !== null) {
    for (let y = OCCLUDER[1]; y < OCCLUDER[3]; y++) {
      for (let x = OCCLUDER[0]; x < OCCLUDER[2]; x++) {
        const p = (y * SIDE + x) * 4;
        if (
          behindCanvas.data[p] === LIMB_RGB[0] &&
          behindCanvas.data[p + 1] === LIMB_RGB[1] &&
          behindCanvas.data[p + 2] === LIMB_RGB[2] &&
          behindCanvas.data[p + 3] === 255
        ) {
          behindBaseAtOccluder++;
        } else if (
          behindCanvas.data[p] === PARTIAL_OCCLUDER_RGB[0] &&
          behindCanvas.data[p + 1] === PARTIAL_OCCLUDER_RGB[1] &&
          behindCanvas.data[p + 2] === PARTIAL_OCCLUDER_RGB[2]
        ) {
          behindProjectedAtOccluder++;
        }
      }
    }
  }
  const underDx = -32;
  const posedUnderStack = compositeStack(
    twinPartNames
      .map((name) => ({ name, raster: placePartOnCanvas('out-with-part', name, name === 'behind' ? underDx : 0, 0) }))
      .filter((entry): entry is { name: string; raster: Raster } => entry.raster !== null),
  );
  let posedUnderBasePx = 0;
  let posedUnderProjectedPx = 0;
  for (let y = OCCLUDER[1]; y < OCCLUDER[3]; y++) {
    for (let x = OCCLUDER[0] + underDx; x < OCCLUDER[2] + underDx; x++) {
      const p = (y * SIDE + x) * 4;
      if (
        posedUnderStack.data[p] === LIMB_RGB[0] &&
        posedUnderStack.data[p + 1] === LIMB_RGB[1] &&
        posedUnderStack.data[p + 2] === LIMB_RGB[2]
      ) {
        posedUnderBasePx++;
      } else if (
        posedUnderStack.data[p] === PARTIAL_OCCLUDER_RGB[0] &&
        posedUnderStack.data[p + 1] === PARTIAL_OCCLUDER_RGB[1] &&
        posedUnderStack.data[p + 2] === PARTIAL_OCCLUDER_RGB[2]
      ) {
        posedUnderProjectedPx++;
      }
    }
  }

  // Control without occluders declaration: `--project visible` projects the lower 1,024 occluder px onto `behind`
  // because max-channel diff 60 <= DRIFT_LIMIT (90).
  const undeclaredRun = stage(partHome, pInputs.plateRunDir, chainConfig({ take: partialTake }), 'out-undeclared');
  const undeclaredBehind = placePartOnCanvas('out-undeclared', 'behind');
  let undeclaredProjectedPx = 0;
  if (undeclaredBehind !== null) {
    for (let y = OCCLUDER[1]; y < OCCLUDER[3]; y++) {
      for (let x = OCCLUDER[0]; x < OCCLUDER[2]; x++) {
        const p = (y * SIDE + x) * 4;
        if (
          undeclaredBehind.data[p] === PARTIAL_OCCLUDER_RGB[0] &&
          undeclaredBehind.data[p + 1] === PARTIAL_OCCLUDER_RGB[1] &&
          undeclaredBehind.data[p + 2] === PARTIAL_OCCLUDER_RGB[2]
        ) {
          undeclaredProjectedPx++;
        }
      }
    }
  }

  // Also verify cut piece derived from `behind` inherits the `under` keep guard.
  const cutCfg = partialCfgWithPart();
  (cutCfg.assemble as Record<string, unknown>).cuts = [
    {
      from: 'behind',
      into: 'behind_lower',
      polygon: [[16, 64], [112, 64], [112, 112], [16, 112]],
      draw: { before: 'front' },
      overlap: 0,
    },
  ];
  (cutCfg.regions as Record<string, unknown>).behind_lower = 'root';
  const cutRun = stage(partHome, pInputs.plateRunDir, cutCfg, 'out-with-cut');
  const cutLowerCanvas = placePartOnCanvas('out-with-cut', 'behind_lower');
  let cutLowerBasePx = 0;
  if (cutLowerCanvas !== null) {
    for (let y = PARTIAL_LOWER_BOX[1]; y < PARTIAL_LOWER_BOX[3]; y++) {
      for (let x = PARTIAL_LOWER_BOX[0]; x < PARTIAL_LOWER_BOX[2]; x++) {
        const p = (y * SIDE + x) * 4;
        if (
          cutLowerCanvas.data[p] === LIMB_RGB[0] &&
          cutLowerCanvas.data[p + 1] === LIMB_RGB[1] &&
          cutLowerCanvas.data[p + 2] === LIMB_RGB[2] &&
          cutLowerCanvas.data[p + 3] === 255
        ) {
          cutLowerBasePx++;
        }
      }
    }
  }
  say('OC34_UNDER_KEEPS_BASE_SURFACE_UNDER_OCCLUDER_AT_REST_AND_IN_MOTION',
    behindBaseAtOccluder === OCCLUDER_PX &&
      behindProjectedAtOccluder === 0 &&
      posedUnderBasePx === OCCLUDER_PX &&
      posedUnderProjectedPx === 0 &&
      undeclaredRun.error === null &&
      undeclaredProjectedPx > 0 &&
      cutRun.error === null &&
      cutLowerBasePx === PARTIAL_HALF_PX,
    `behind occluder px: base=${behindBaseAtOccluder}/${OCCLUDER_PX}, projected=${behindProjectedAtOccluder}; posed dx=${underDx}: base=${posedUnderBasePx}/${OCCLUDER_PX}, projected=${posedUnderProjectedPx}; undeclared control projected=${undeclaredProjectedPx}; cut piece behind_lower base=${cutLowerBasePx}/${PARTIAL_HALF_PX}`);

  // Bar 4 (OC35): (ii') Motion, `over` — translating `front` (`over`) away by dx = +36 vacates the upper 1,024 px
  // [48, 32, 80, 64), which read `LIMB_RGB` on all 1,024 px and `PARTIAL_OCCLUDER_RGB` on 0 px.
  const overDx = 36;
  const posedOverStack = compositeStack(
    twinPartNames
      .map((name) => ({ name, raster: placePartOnCanvas('out-with-part', name, name === 'front' ? overDx : 0, 0) }))
      .filter((entry): entry is { name: string; raster: Raster } => entry.raster !== null),
  );
  let vacatedUpperBasePx = 0;
  let vacatedUpperOccluderPx = 0;
  let lowerStillOccluderPx = 0;
  for (let y = PARTIAL_OVER_BOX[1]; y < PARTIAL_OVER_BOX[3]; y++) {
    for (let x = PARTIAL_OVER_BOX[0]; x < PARTIAL_OVER_BOX[2]; x++) {
      const p = (y * SIDE + x) * 4;
      if (
        posedOverStack.data[p] === LIMB_RGB[0] &&
        posedOverStack.data[p + 1] === LIMB_RGB[1] &&
        posedOverStack.data[p + 2] === LIMB_RGB[2]
      ) {
        vacatedUpperBasePx++;
      } else if (
        posedOverStack.data[p] === PARTIAL_OCCLUDER_RGB[0] &&
        posedOverStack.data[p + 1] === PARTIAL_OCCLUDER_RGB[1] &&
        posedOverStack.data[p + 2] === PARTIAL_OCCLUDER_RGB[2]
      ) {
        vacatedUpperOccluderPx++;
      }
    }
  }
  for (let y = PARTIAL_LOWER_BOX[1]; y < PARTIAL_LOWER_BOX[3]; y++) {
    for (let x = PARTIAL_LOWER_BOX[0]; x < PARTIAL_LOWER_BOX[2]; x++) {
      const p = (y * SIDE + x) * 4;
      if (
        posedOverStack.data[p] === PARTIAL_OCCLUDER_RGB[0] &&
        posedOverStack.data[p + 1] === PARTIAL_OCCLUDER_RGB[1] &&
        posedOverStack.data[p + 2] === PARTIAL_OCCLUDER_RGB[2]
      ) {
        lowerStillOccluderPx++;
      }
    }
  }
  say('OC35_POSED_OVER_TRANSLATION_VACATES_UPPER_1024_TO_UNDER_BASE_SURFACE',
    vacatedUpperBasePx === PARTIAL_HALF_PX &&
      vacatedUpperOccluderPx === 0 &&
      lowerStillOccluderPx === PARTIAL_HALF_PX,
    `posed front dx=+${overDx}: vacated upper [48,32,80,64) base=${vacatedUpperBasePx}/${PARTIAL_HALF_PX}, occluder_ghost=${vacatedUpperOccluderPx}; lower [48,64,80,96) held by occ_fg=${lowerStillOccluderPx}/${PARTIAL_HALF_PX}`);

  // Bar 5a (OC36): `ASSEMBLE_OCCLUDER_EMPTY` when `over` holds all 2,048 px, plus the four config name/attach doors
  // (`CONFIG_FIELD_TYPE`, `CONFIG_PART_NAME`, `CONFIG_PART_UNIQUE`, `CONFIG_PART_ATTACHED`).
  const fullOverWithPartCfg = chainConfig({
    occluders: [declaration(sInputs.occluderSha, { over: ['front'], part: 'occ_fg' })],
    take: [{ run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['objects'] }],
  });
  (fullOverWithPartCfg.regions as Record<string, unknown>).occ_fg = 'root';
  const emptyOccPartRun = stage(splitHome, fullPlateDir, fullOverWithPartCfg, 'out-empty-occ-part');
  const emptyOccProb = emptyOccPartRun.error?.problems.find((pr) => pr.code === OCCLUDER_EMPTY);

  const partFieldTypeProb = refusal(() =>
    parseConfig(chainConfig({ occluders: [declaration(pInputs.occluderSha, { part: '' })] })),
  )?.problems.find((pr) => pr.code === 'CONFIG_FIELD_TYPE' && pr.object === 'config.assemble.occluders[0].part');
  const partNameProb = refusal(() =>
    parseConfig(chainConfig({ occluders: [declaration(pInputs.occluderSha, { part: 'bad/name' })] })),
  )?.problems.find((pr) => pr.code === 'CONFIG_PART_NAME' && pr.object === 'config.assemble.occluders[0].part');
  const partUniquePlanProb = refusal(() =>
    parseConfig(chainConfig({ occluders: [declaration(pInputs.occluderSha, { part: 'behind' })] })),
  )?.problems.find((pr) => pr.code === 'CONFIG_PART_UNIQUE' && pr.object === 'config.assemble.occluders[0].part');
  const partUnattachedProb = refusal(() =>
    parseConfig(chainConfig({ occluders: [declaration(pInputs.occluderSha, { part: 'occ_fg' })] })),
  )?.problems.find((pr) => pr.code === 'CONFIG_PART_ATTACHED' && pr.object === 'part "occ_fg"');
  say('OC36_OCCLUDER_PART_PLANTS_REFUSE_EMPTY_AND_CONFIG_NAME_ATTACH_DOORS',
    emptyOccProb !== undefined &&
      emptyOccProb.object === 'config.assemble.occluders[0].part (part "occ_fg")' &&
      !existsSync(join(splitHome, 'out-empty-occ-part')) &&
      partFieldTypeProb !== undefined &&
      partNameProb !== undefined &&
      partUniquePlanProb !== undefined &&
      partUnattachedProb !== undefined,
    `EMPTY: ${emptyOccProb?.detail ?? 'accepted'}; TYPE: ${partFieldTypeProb?.code ?? 'accepted'}; NAME: ${partNameProb?.code ?? 'accepted'}; UNIQUE: ${partUniquePlanProb?.code ?? 'accepted'}; ATTACHED: ${partUnattachedProb?.code ?? 'accepted'}`);

  // Bar 5b (OC37): `ASSEMBLE_OCCLUDER_UNHELD` 3-case control:
  // (1) partial-`over` twin without `part` fires with 1,024 (`first at 48,64`);
  // (2) same twin with `part` is silent;
  // (3) full-`over` chain without `part` is silent.
  const twinWithoutPartRun = stage(
    partHome,
    pInputs.plateRunDir,
    chainConfig({ occluders: [declaration(pInputs.occluderSha, { over: ['front'] })], take: partialTake }),
    'out-without-part',
  );
  const unheldLinesWithoutPart = twinWithoutPartRun.lines.filter((l) => l.includes(OCCLUDER_UNHELD));
  const unheldLinesWithPart = twinWithPartRun.lines.filter((l) => l.includes(OCCLUDER_UNHELD));
  const fullOverUnheldLines = fullSplitRun.lines.filter((l) => l.includes(OCCLUDER_UNHELD));
  say('OC37_OCCLUDER_UNHELD_WARN_FIRES_WITHOUT_PART_AND_IS_SILENT_WHEN_HELD',
    twinWithoutPartRun.error === null &&
      unheldLinesWithoutPart.length === 1 &&
      unheldLinesWithoutPart[0].includes(`${PARTIAL_HALF_PX} rig px`) &&
      unheldLinesWithoutPart[0].includes(`first at ${PARTIAL_LOWER_BOX[0]},${PARTIAL_LOWER_BOX[1]}`) &&
      unheldLinesWithPart.length === 0 &&
      fullOverUnheldLines.length === 0,
    `partial without part: ${unheldLinesWithoutPart[0] ?? 'silent'}; partial with part: ${unheldLinesWithPart.length} WARNs; full-over without part: ${fullOverUnheldLines.length} WARNs`);

  // Issue #1251 controls (OC38–OC41):
  // OC38: Soft-edge `over` twin (ring width 4 px at alpha 200 = 704 px, inner [52,36,76,92) = 1,344 px at alpha 255).
  const softHome = join(dir, 'occluder-soft-twin');
  rmSync(softHome, { recursive: true, force: true });
  const softInputs = writeSoftOverInputs(softHome);
  const softTake = [{ run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['objects'] }];
  const softCfgWithPart = (): Record<string, unknown> => {
    const cfg = chainConfig({
      occluders: [declaration(softInputs.occluderSha, { over: ['front'], part: 'occ_fg' })],
      take: softTake,
    });
    (cfg.regions as Record<string, unknown>).occ_fg = 'root';
    return cfg;
  };
  const placeSoftPartOnCanvas = (outDir: string, partName: string, dx = 0, dy = 0): Raster | null => {
    const pJsonPath = join(softHome, outDir, 'parts.json');
    const pPngPath = join(softHome, outDir, 'parts', `${partName}.png`);
    if (!existsSync(pJsonPath) || !existsSync(pPngPath)) return null;
    const pf = readParts(pJsonPath);
    const meta = pf.parts.find((pt) => pt.name === partName);
    if (!meta) return null;
    const cropImg = readPng(pPngPath);
    const canvas = newRaster(SIDE, SIDE);
    for (let cy = 0; cy < cropImg.height; cy++) {
      for (let cx = 0; cx < cropImg.width; cx++) {
        const tx = meta.x + cx + dx;
        const ty = meta.y + cy + dy;
        if (tx < 0 || tx >= SIDE || ty < 0 || ty >= SIDE) continue;
        const si = (cy * cropImg.width + cx) * 4;
        const di = (ty * SIDE + tx) * 4;
        canvas.data.set(cropImg.data.subarray(si, si + 4), di);
      }
    }
    return canvas;
  };
  const softWithPartRun = stage(softHome, softInputs.plateRunDir, softCfgWithPart(), 'out-soft-with-part');
  const softPartsFile = softWithPartRun.error === null ? readParts(join(softHome, 'out-soft-with-part', 'parts.json')) : null;
  const softPartNames = softPartsFile?.parts.map((pt) => pt.name) ?? [];
  const softStackCanvases = softPartNames
    .map((name) => ({ name, raster: placeSoftPartOnCanvas('out-soft-with-part', name) }))
    .filter((entry): entry is { name: string; raster: Raster } => entry.raster !== null);
  const softOccFgMeta = softPartsFile?.parts.find((pt) => pt.name === 'occ_fg');
  const softOccFgCanvas = placeSoftPartOnCanvas('out-soft-with-part', 'occ_fg');
  const softFrontCanvas = placeSoftPartOnCanvas('out-soft-with-part', 'front');
  const softBehindCanvas = placeSoftPartOnCanvas('out-soft-with-part', 'behind');
  let softRestOverPx = 0;
  let softRestOccPartPx = 0;
  let softRestUnderPx = 0;
  let softPartRingExactPx = 0;
  let softPartOutsideRingPx = 0;
  let softPlantedOldRestUnderPx = 0;
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const p = (y * SIDE + x) * 4;
      const inOcc = isInside(OCCLUDER, x, y);
      const inInner = isInside(SOFT_OVER_INNER_BOX, x, y);
      const occAlpha = softOccFgCanvas?.data[p + 3] ?? 0;
      if (inOcc && !inInner) {
        if (occAlpha === 255) softPartRingExactPx++;
      } else if (occAlpha > 0) {
        softPartOutsideRingPx++;
      }
      if (!inOcc) continue;
      let holder: string | null = null;
      for (let i = softStackCanvases.length - 1; i >= 0; i--) {
        if (softStackCanvases[i].raster.data[p + 3] >= CORE_ALPHA) {
          holder = softStackCanvases[i].name;
          break;
        }
      }
      if (holder === 'front') softRestOverPx++;
      else if (holder === 'occ_fg') softRestOccPartPx++;
      else if (holder === 'behind') softRestUnderPx++;
      // Planted old rule: part subtracts front support at alpha > 128 (`COPIED_ALPHA_ABOVE`), so alpha 200 on the ring excludes `occ_fg`.
      const frontA = softFrontCanvas?.data[p + 3] ?? 0;
      const oldOccPartA = frontA > COPIED_ALPHA_ABOVE ? 0 : 255;
      const behindA = softBehindCanvas?.data[p + 3] ?? 0;
      const oldTopHolder = frontA >= CORE_ALPHA ? 'front' : oldOccPartA >= CORE_ALPHA ? 'occ_fg' : behindA >= CORE_ALPHA ? 'behind' : null;
      if (oldTopHolder === 'behind') softPlantedOldRestUnderPx++;
    }
  }
  const softUnheldWarnings = softWithPartRun.lines.filter((l) => l.includes(OCCLUDER_UNHELD));
  // Bar 6 measurement (report only): moving `front` off the occluder by dx = +36 vacates the 704 ring px, which read `occ_fg` (`PARTIAL_OCCLUDER_RGB`).
  const softPosedOverStack = compositeStack(
    softPartNames
      .map((name) => ({ name, raster: placeSoftPartOnCanvas('out-soft-with-part', name, name === 'front' ? overDx : 0, 0) }))
      .filter((entry): entry is { name: string; raster: Raster } => entry.raster !== null),
  );
  let vacatedSoftRingOccColourPx = 0;
  let vacatedSoftInnerBasePx = 0;
  for (let y = OCCLUDER[1]; y < OCCLUDER[3]; y++) {
    for (let x = OCCLUDER[0]; x < OCCLUDER[2]; x++) {
      const p = (y * SIDE + x) * 4;
      const inInner = isInside(SOFT_OVER_INNER_BOX, x, y);
      if (
        !inInner &&
        softPosedOverStack.data[p] === PARTIAL_OCCLUDER_RGB[0] &&
        softPosedOverStack.data[p + 1] === PARTIAL_OCCLUDER_RGB[1] &&
        softPosedOverStack.data[p + 2] === PARTIAL_OCCLUDER_RGB[2]
      ) {
        vacatedSoftRingOccColourPx++;
      } else if (
        inInner &&
        softPosedOverStack.data[p] === LIMB_RGB[0] &&
        softPosedOverStack.data[p + 1] === LIMB_RGB[1] &&
        softPosedOverStack.data[p + 2] === LIMB_RGB[2]
      ) {
        vacatedSoftInnerBasePx++;
      }
    }
  }
  say('OC38_SOFT_EDGE_OVER_RING_IS_COVERED_BY_OCCLUDER_PART_WITH_ZERO_UNDER_REST_HOLDERS',
     SOFT_OVER_RING_WIDTH === 4 &&
      SOFT_OVER_RING_ALPHA === 200 &&
      SOFT_OVER_INNER_PX === 1344 &&
      SOFT_OVER_RING_PX === 704 &&
      softWithPartRun.error === null &&
      softRestUnderPx === 0 &&
      softRestOverPx === 1344 &&
      softRestOccPartPx === 704 &&
      softUnheldWarnings.length === 0 &&
      softOccFgMeta?.opaque_px === 704 &&
      softPartRingExactPx === 704 &&
      softPartOutsideRingPx === 0 &&
      softPlantedOldRestUnderPx === 704,
    `ring=${SOFT_OVER_RING_PX} (2048-1344); rest holders: behind=${softRestUnderPx} (want 0), front=${softRestOverPx}, occ_fg=${softRestOccPartPx}; UNHELD=${softUnheldWarnings.length}; part_ring_px=${softPartRingExactPx}/${SOFT_OVER_RING_PX} (outside=${softPartOutsideRingPx}); planted old (>128) rest under=${softPlantedOldRestUnderPx}; posed dx=+${overDx} vacated ring occ_colour=${vacatedSoftRingOccColourPx}, inner base=${vacatedSoftInnerBasePx}`);

  // OC39: Speck plants — isolated speck [41,48,44,56) (24 px at alpha 20 in 9..32, 5 px off the x=48 core) produces 0 part px
  // both without grow and under grow 3; under the planted old > 8 footprint it produces 24 part px.
  const speckNoGrowCfg = chainConfig({
    occluders: [declaration(softInputs.speckOccluderSha, { image: 'occluder_speck.png', over: ['front'], part: 'occ_fg' })],
    take: partialTake,
  });
  (speckNoGrowCfg.regions as Record<string, unknown>).occ_fg = 'root';
  writeFileSync(join(partHome, 'occluder_speck.png'), readFileSync(softInputs.speckOccluder));
  const speckNoGrowRun = stage(partHome, pInputs.plateRunDir, speckNoGrowCfg, 'out-speck-no-grow');
  const speckNoGrowCanvas = placePartOnCanvas('out-speck-no-grow', 'occ_fg');
  const speckGrow3Cfg = chainConfig({
    occluders: [declaration(softInputs.speckOccluderSha, { image: 'occluder_speck.png', over: ['front'], part: 'occ_fg', grow: 3 })],
    take: partialTake,
  });
  (speckGrow3Cfg.regions as Record<string, unknown>).occ_fg = 'root';
  const speckGrow3Run = stage(partHome, pInputs.plateRunDir, speckGrow3Cfg, 'out-speck-grow-3');
  const speckGrow3Canvas = placePartOnCanvas('out-speck-grow-3', 'occ_fg');
  const speckRaster = readPng(softInputs.speckOccluder);
  let speckNoGrowPartPx = 0;
  let speckGrow3PartPx = 0;
  let plantedOldGt8SpeckPartPx = 0;
  for (let y = OCCLUDER_SPECK_BOX[1]; y < OCCLUDER_SPECK_BOX[3]; y++) {
    for (let x = OCCLUDER_SPECK_BOX[0]; x < OCCLUDER_SPECK_BOX[2]; x++) {
      const p = (y * SIDE + x) * 4;
      if ((speckNoGrowCanvas?.data[p + 3] ?? 0) > 0) speckNoGrowPartPx++;
      if ((speckGrow3Canvas?.data[p + 3] ?? 0) > 0) speckGrow3PartPx++;
      const occA = speckRaster.data[p + 3];
      const frontA = frontCanvas?.data[p + 3] ?? 0;
      if (occA > OPAQUE_ALPHA_ABOVE && frontA < CORE_ALPHA) plantedOldGt8SpeckPartPx++;
    }
  }
  say('OC39_OCCLUDER_SPECK_BELOW_128_IS_EXCLUDED_FROM_PART_AND_GROW',
    OCCLUDER_SPECK_PX === 24 &&
      OCCLUDER_SPECK_ALPHA === 20 &&
      OCCLUDER[0] - OCCLUDER_SPECK_BOX[2] + 1 === 5 &&
      speckNoGrowRun.error === null &&
      speckGrow3Run.error === null &&
      speckNoGrowPartPx === 0 &&
      speckGrow3PartPx === 0 &&
      plantedOldGt8SpeckPartPx === 24,
    `speck [41,48,44,56) (24 px at alpha 20, 5 px off core x=48): no-grow part_px=${speckNoGrowPartPx} (want 0), grow-3 part_px=${speckGrow3PartPx} (want 0), planted old (>8) part_px=${plantedOldGt8SpeckPartPx} (want 24)`);

  // OC40: Placement (item 3) — when a piece cut from `under` (`behind_cuff`) sits after `front` (`over`) in the plan,
  // `occ_fg` is placed immediately before the first `over` slot (`occ_fg` index 4 < `front` index 5 < `behind_cuff` index 6),
  // with 0 px of `behind_cuff` inside the occluder; planted old placement (after last `under`-derived slot) puts `occ_fg` at index 6 > `front` index 4.
  const placeAfterOverCfg = partialCfgWithPart();
  (placeAfterOverCfg.assemble as Record<string, unknown>).cuts = [
    {
      from: 'behind',
      into: 'behind_cuff',
      polygon: [[84, 64], [112, 64], [112, 112], [84, 112]],
      draw: 'front',
      overlap: 0,
    },
  ];
  (placeAfterOverCfg.regions as Record<string, unknown>).behind_cuff = 'root';
  const placeAfterOverRun = stage(partHome, pInputs.plateRunDir, placeAfterOverCfg, 'out-place-before-over');
  const placeAfterOverParts = placeAfterOverRun.error === null ? readParts(join(partHome, 'out-place-before-over', 'parts.json')) : null;
  const placeOrderNames = placeAfterOverParts?.parts.map((pt) => pt.name) ?? [];
  const placeOccFgIdx = placeOrderNames.indexOf('occ_fg');
  const placeFrontIdx = placeOrderNames.indexOf('front');
  const placeCuffIdx = placeOrderNames.indexOf('behind_cuff');
  const cuffCanvas = placePartOnCanvas('out-place-before-over', 'behind_cuff');
  const pOccRaster = readPng(pInputs.occluder);
  let cuffInsideOccluderPx = 0;
  if (cuffCanvas !== null) {
    for (let p = 0; p < SIDE * SIDE; p++) {
      if (cuffCanvas.data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE && pOccRaster.data[p * 4 + 3] > COPIED_ALPHA_ABOVE) {
        cuffInsideOccluderPx++;
      }
    }
  }
  const baseOrderWithoutOccPart = placeOrderNames.filter((n) => n !== 'occ_fg');
  const plantedOldLastUnderIdx = Math.max(baseOrderWithoutOccPart.indexOf('behind'), baseOrderWithoutOccPart.indexOf('behind_cuff'));
  const plantedOldOrder = [...baseOrderWithoutOccPart];
  plantedOldOrder.splice(plantedOldLastUnderIdx + 1, 0, 'occ_fg');
  const plantedOldOccFgIdx = plantedOldOrder.indexOf('occ_fg');
  const plantedOldFrontIdx = plantedOldOrder.indexOf('front');
  say('OC40_OCCLUDER_PART_PLACED_BEFORE_FIRST_OVER_SLOT_WHEN_UNDER_PIECE_SITS_AFTER',
    placeAfterOverRun.error === null &&
      placeOccFgIdx === 4 &&
      placeFrontIdx === 5 &&
      placeCuffIdx === 6 &&
      placeOccFgIdx < placeFrontIdx &&
      cuffInsideOccluderPx === 0 &&
      plantedOldOccFgIdx === 6 &&
      plantedOldFrontIdx === 4 &&
      plantedOldOccFgIdx > plantedOldFrontIdx,
    `order=${placeOrderNames.join('->')} (occ_fg=${placeOccFgIdx} < front=${placeFrontIdx} < behind_cuff=${placeCuffIdx}); cuff_inside_occluder=${cuffInsideOccluderPx}; planted old order=${plantedOldOrder.join('->')} (occ_fg=${plantedOldOccFgIdx} > front=${plantedOldFrontIdx})`);

  // OC41: Grow (item 5) — on OCCLUDER [48,32,80,96) (w=32, h=64, 2,048 px):
  // grow 0 -> 2,048 px and no `occluder_grow`; grow 2 -> (32+4)(64+4) = 2,448 px; grow 3 -> (32+6)(64+6) = 2,660 px;
  // `occluder_grow` round-trips through `readParts`; plants `grow: 1.5`, `grow: -1`, `grow: "2"` refuse `CONFIG_FIELD_TYPE`.
  const growCfg = (grow?: number): Record<string, unknown> => {
    const cfg = chainConfig({
      plan: [['face', 'full', 'face'], ['eye_r', 'full', 'eyewhite-r'], ['eye_l', 'full', 'eyewhite-l'], ['behind', 'full', 'legwear']],
      occluders: [declaration(pInputs.occluderSha, { part: 'occ_fg', ...(grow === undefined ? {} : { grow }) })],
    });
    delete (cfg.regions as Record<string, unknown>).front;
    (cfg.regions as Record<string, unknown>).occ_fg = 'root';
    return cfg;
  };
  const grow0Run = stage(partHome, pInputs.plateRunDir, growCfg(0), 'out-grow-0');
  const grow2Run = stage(partHome, pInputs.plateRunDir, growCfg(2), 'out-grow-2');
  const grow3Run = stage(partHome, pInputs.plateRunDir, growCfg(3), 'out-grow-3');
  const grow0Raw = grow0Run.error === null ? (JSON.parse(readFileSync(join(partHome, 'out-grow-0', 'parts.json'), 'utf8')) as Record<string, unknown>) : null;
  const grow0Parts = grow0Run.error === null ? readParts(join(partHome, 'out-grow-0', 'parts.json')) : null;
  const grow2Parts = grow2Run.error === null ? readParts(join(partHome, 'out-grow-2', 'parts.json')) : null;
  const grow3Parts = grow3Run.error === null ? readParts(join(partHome, 'out-grow-3', 'parts.json')) : null;
  const grow0Occ = grow0Parts?.parts.find((pt) => pt.name === 'occ_fg');
  const grow2Occ = grow2Parts?.parts.find((pt) => pt.name === 'occ_fg');
  const grow3Occ = grow3Parts?.parts.find((pt) => pt.name === 'occ_fg');
  const badGrowPartsPath = join(partHome, 'bad-occluder-grow-parts.json');
  if (grow2Parts !== null) {
    const rawBadGrow = JSON.parse(readFileSync(join(partHome, 'out-grow-2', 'parts.json'), 'utf8')) as { occluder_grow: Array<Record<string, unknown>> };
    rawBadGrow.occluder_grow[0].grow = 0;
    writeFileSync(badGrowPartsPath, JSON.stringify(rawBadGrow));
  }
  const growPartsReaderRefusal = grow2Parts !== null ? refusal(() => readParts(badGrowPartsPath))?.problems.find((pr) => pr.code === 'PARTS_FIELD_TYPE' && pr.object.includes('occluder_grow[0] field "grow"')) : undefined;
  const growFloatProb = refusal(() => parseConfig(chainConfig({ occluders: [declaration(pInputs.occluderSha, { grow: 1.5 })] })))?.problems.find((pr) => pr.code === 'CONFIG_FIELD_TYPE' && pr.object === 'config.assemble.occluders[0].grow');
  const growNegProb = refusal(() => parseConfig(chainConfig({ occluders: [declaration(pInputs.occluderSha, { grow: -1 })] })))?.problems.find((pr) => pr.code === 'CONFIG_FIELD_TYPE' && pr.object === 'config.assemble.occluders[0].grow');
  const growStrProb = refusal(() => parseConfig(chainConfig({ occluders: [declaration(pInputs.occluderSha, { grow: '2' })] })))?.problems.find((pr) => pr.code === 'CONFIG_FIELD_TYPE' && pr.object === 'config.assemble.occluders[0].grow');
  say('OC41_OCCLUDER_GROW_DILATES_CORE_RECORDS_PARTS_JSON_AND_REFUSES_BAD_TYPES',
    grow0Run.error === null &&
      grow2Run.error === null &&
      grow3Run.error === null &&
      grow0Raw !== null &&
      !('occluder_grow' in grow0Raw) &&
      grow0Parts?.occluder_grow === undefined &&
      grow0Occ?.opaque_px === 2048 &&
      grow2Occ?.opaque_px === 2448 &&
      grow3Occ?.opaque_px === 2660 &&
      JSON.stringify(grow2Parts?.occluder_grow) === JSON.stringify([{ occluder: 0, image: 'occluder.png', grow: 2, covered_px_before: 2048, covered_px_after: 2448 }]) &&
      JSON.stringify(grow3Parts?.occluder_grow) === JSON.stringify([{ occluder: 0, image: 'occluder.png', grow: 3, covered_px_before: 2048, covered_px_after: 2660 }]) &&
      growPartsReaderRefusal !== undefined &&
      growFloatProb !== undefined &&
      growNegProb !== undefined &&
      growStrProb !== undefined,
    `w=32,h=64: grow0=${grow0Occ?.opaque_px} (occluder_grow=${grow0Parts?.occluder_grow}), grow2=${grow2Occ?.opaque_px} (${JSON.stringify(grow2Parts?.occluder_grow)}), grow3=${grow3Occ?.opaque_px} (${JSON.stringify(grow3Parts?.occluder_grow)}); plants: float=${growFloatProb?.code}, neg=${growNegProb?.code}, str=${growStrProb?.code}, parts=${growPartsReaderRefusal?.code}`);
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
