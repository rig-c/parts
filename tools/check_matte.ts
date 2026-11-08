/** Focused production-entry controls. Run on CI or the remote pool, never a real GPU. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeComfy, FAKE_CHECKPOINT, FAKE_FILL } from '../fixtures/fakecomfy.ts';
import { fakeMatte, type MatteFakeMode } from '../fixtures/fakematte.ts';
import { runMatte, type MatteRun } from '../src/comfy/matte.ts';
import { ComfyClient } from '../src/comfy/client.ts';
import { matteGraph, matteGraphHash, MATTE_KEYS, type MatteReceipt } from '../src/matte.ts';
import { readSourceMask, runForeground, sha256 } from '../src/plate.ts';
import { decodePngBytes, encodePngBytes } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
import { RunTally, reportMeasuredCase, tallyFaults, treeGuideCase, treeFiles, TEXT_FILE } from '../selftest.ts';

interface Case { name: string; ok: boolean; detail: string }
const cases: Case[] = [];
// Preserve child diagnostics as a single detail line so their gutter words cannot enter RunTally.
const check = (name: string, ok: boolean, detail: string): void => {
  cases.push({ name: `MT1204_${name}`, ok, detail: JSON.stringify(detail) });
};
const root = join(import.meta.dir, '..');
const work = mkdtempSync(join(tmpdir(), 'parts-matte-'));
const painting = join(work, 'painting.png');
const square = newRaster(8, 8);
for (let p = 0; p < 64; p++) square.data.set([90, 100, 110, 255], p * 4);
writeFileSync(painting, encodePngBytes(square));
const defaults: MatteRun = {
  painting, out: join(work, 'matte'), node: 'BiRefNetRMBG', model: 'BiRefNet-HR-matting',
  checkpointSha256: 'a'.repeat(64), resolution: 64, threshold: 10, wait: 0.01, timeout: 1,
};
async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, join(root, 'cli.ts'), ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, out: out + err };
}
async function fakeRun(mode: MatteFakeMode, changes: Partial<MatteRun> = {}) {
  const box = fakeMatte(mode);
  const run = { ...defaults, out: join(work, `run-${mode}-${cases.length}`), ...changes };
  let receipt: MatteReceipt | undefined;
  let message = '';
  try { receipt = await runMatte(() => new ComfyClient(box.url, { poll: 0.001, request: 1 }), run, () => {}); }
  catch (error) { message = (error as Error).message; }
  finally { box.stop(); }
  return { receipt, message, run, ...box };
}
function refused(name: string, code: string, action: () => void): void {
  let message = '';
  try { action(); } catch (error) { message = (error as Error).message; }
  check(name, message.includes(code), message || `expected ${code}`);
}
function source(dir: string, bytes = new Uint8Array(readFileSync(painting))) {
  return readSourceMask('matte', dir, 8, 8, square, bytes);
}

async function controls(): Promise<void> {
  const graph = matteGraph('painting.png', 'fixture');
  check('MODEL_READS_LOADIMAGE_IMAGE', JSON.stringify(graph['2'].inputs.image) === '["1",0]' && graph['1'].class_type === 'LoadImage', 'model receives IMAGE index 0, which carries RGB independently of PNG alpha');
  const badWire = structuredClone(graph);
  badWire['2'].inputs.image = ['1', 1];
  check('MASK_WIRE_PLANT_DIFFERS', JSON.stringify(badWire['2'].inputs.image) !== JSON.stringify(graph['2'].inputs.image), 'planted MASK index 1 differs from the production transport');
  const box = fakeMatte();
  let result: Awaited<ReturnType<typeof cli>>;
  try {
    result = await cli(['comfy', 'matte', '--painting', painting, '--out', defaults.out, '--node', defaults.node!, '--model', defaults.model!, '--checkpoint-sha256', defaults.checkpointSha256!, '--resolution', '64', '--host', box.url, '--poll', '0.001']);
    check('CLI_WRITES_RECEIPT', result.code === 0 && existsSync(join(defaults.out, 'receipt.json')), `exit ${result.code}, ${result.out.trim()}`);
    check('SQUARE_UPLOAD_BYTE_IDENTITY', box.uploads.length === 1 && sha256(box.uploads[0]) === sha256(readFileSync(painting)), 'square source bytes compared directly to the fake box upload');
    check('APPENDS_ONLY', box.prompts.length === 1 && box.prompts[0].front === undefined && box.prompts[0].number === undefined && !box.paths.some(path => /interrupt|cancel|delete/.test(path)), 'one submission without front/number, no cancellation endpoint');
  } finally { box.stop(); }
  if (!existsSync(join(defaults.out, 'receipt.json'))) return;
  const original = JSON.parse(readFileSync(join(defaults.out, 'receipt.json'), 'utf8')) as MatteReceipt;
  const bound = source(defaults.out);
  check('THRESHOLD_HAND_COUNTS', bound.inside.reduce((a, b) => a + b, 0) === 32 && [...bound.inside.slice(0, 4)].join() === '0,1,0,1', '8 rows * 2 repeated blocks * 2 foreground pixels = 32, equality excluded');
  check('ORDERED_COMPLETE_RECEIPT', Object.keys(original).join() === MATTE_KEYS.join() && original.input_transform === null && original.model.checkpoint_sha256_from === 'declared' && original.graph.sha256 === matteGraphHash(original.graph.api), 'ordered schema, square fast path and declared checkpoint source');
  const foreground = join(work, 'foreground');
  const fg = await cli(['comfy', 'plate', '--mode', 'foreground', '--painting', painting, '--mask-from', `matte:${defaults.out}`, '--out', foreground]);
  check('CLI_PLATE_CONSUMES_MATTE', fg.code === 0 && existsSync(join(foreground, 'plate.png')), `exit ${fg.code}, ${fg.out.trim()}`);
  const fgRaster = decodePngBytes(readFileSync(join(foreground, 'plate.png')), 'foreground');
  check('FOREGROUND_PIXELS_MATCH', fgRaster.data.every((value, i) => value === (bound.inside[Math.floor(i / 4)] ? square.data[i] : 0)), 'every RGBA foreground/output pixel matches the source mask');

  // The same hand-computable mask represented by each existing source writes identical PNGs.
  // Synthetic stripe layers use the supported author:<label> namespace and flat filenames.
  const legacyRoot = join(work, 'figure-source');
  const rig = join(legacyRoot, 'rig');
  mkdirSync(rig, { recursive: true });
  const finalMask = readFileSync(join(defaults.out, 'mask.png'));
  const partsBytes = new TextEncoder().encode(JSON.stringify({ scene: { figure_mask: 'figure_rig.png' } }));
  writeFileSync(join(rig, 'figure_rig.png'), finalMask);
  writeFileSync(join(rig, 'parts.json'), partsBytes);
  writeFileSync(join(legacyRoot, 'run.json'), JSON.stringify({ spec: 'rig-run/1', command: 'assemble', outputs: [
    { path: 'rig/figure_rig.png', sha256: sha256(finalMask) }, { path: 'rig/parts.json', sha256: sha256(partsBytes) },
  ] }));
  const seethrough = join(work, 'layer-source');
  mkdirSync(seethrough, { recursive: true });
  const stripe = newRaster(1, 8);
  stripe.data.fill(255);
  const stripeBytes = encodePngBytes(stripe);
  const stripes = [1, 3, 5, 7].map(x => ({ name: `author:stripe_${x}`, filename: `stripe_${x}.png`, left: x, top: 0, right: x + 1, bottom: 8, depth_median: 0.5 }));
  for (const layer of stripes) writeFileSync(join(seethrough, layer.filename), stripeBytes);
  writeFileSync(join(seethrough, 'layers.json'), JSON.stringify({ prefix: 'fixture', timestamp: 'fixture', width: 8, height: 8, layers: stripes }));
  writeFileSync(join(seethrough, 'meta.json'), JSON.stringify({ image_sha256: sha256(readFileSync(painting)), layers: stripes.map(layer => ({ path: layer.filename, sha256: sha256(stripeBytes) })) }));
  for (const [kind, dir] of [['figure-mask', rig], ['seethrough', seethrough]] as const) {
    const out = join(work, `${kind}-foreground`);
    runForeground({ painting, maskFrom: `${kind}:${dir}`, out });
    check(`EXISTING_${kind.toUpperCase().replaceAll('-', '_')}_BYTES`, ['plate.png', 'mask.png'].every(file => sha256(readFileSync(join(out, file))) === sha256(readFileSync(join(foreground, file)))), 'same hand-computable source mask gives byte-identical mask and foreground PNGs');
  }
  for (const graph of ['lama', 'core'] as const) {
    const plateBox = startFakeComfy('ok');
    const out = join(work, `background-${graph}`);
    try {
      const result = await cli(['comfy', 'plate', '--mode', 'background', '--painting', painting, '--mask-from', `matte:${defaults.out}`, '--out', out, '--graph', graph, '--model', graph === 'core' ? FAKE_CHECKPOINT : 'big-lama.pt', '--checkpoint-sha256', 'a'.repeat(64), '--grow', '0', '--host', plateBox.url, '--poll', '0.001']);
      const pixels = result.code === 0 ? decodePngBytes(readFileSync(join(out, 'plate.png')), graph) : undefined;
      check(`BACKGROUND_${graph.toUpperCase()}_READS_MATTE`, result.code === 0 && pixels !== undefined && pixels.data.every((value, i) => value === (bound.inside[Math.floor(i / 4)] ? [...FAKE_FILL, 255][i % 4] : square.data[i])), `exit ${result.code}, ${result.out.trim()}`);
    } finally { plateBox.stop(); }
  }

  const plants: Array<{ name: string; code: string; change: (dir: string, receipt: MatteReceipt) => void }> = [
    { name: 'MISSING_RECEIPT', code: 'MATTE_RECEIPT', change: dir => rmSync(join(dir, 'receipt.json')) },
    { name: 'LEGACY_RECEIPT', code: 'MATTE_RECEIPT', change: (dir, receipt) => { Reflect.deleteProperty(receipt, 'graph'); writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt)); } },
    { name: 'NULL_RECEIPT', code: 'MATTE_RECEIPT', change: dir => writeFileSync(join(dir, 'receipt.json'), 'null') },
    { name: 'RAW_TAMPER', code: 'MATTE_HASH', change: dir => writeFileSync(join(dir, 'model-mask.png'), 'tampered') },
    { name: 'MASK_TAMPER', code: 'MATTE_HASH', change: dir => writeFileSync(join(dir, 'mask.png'), 'tampered') },
    { name: 'MISSING_MASK', code: 'MATTE_HASH', change: dir => rmSync(join(dir, 'mask.png')) },
    { name: 'PATH_ESCAPE', code: 'MATTE_RECEIPT', change: (dir, receipt) => { receipt.output.path = '../mask.png'; writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt)); } },
    { name: 'GRAPH_MASK_WIRE', code: 'MATTE_RECEIPT', change: (dir, receipt) => { receipt.graph.api['2'].inputs.image = ['1', 1]; receipt.graph.sha256 = matteGraphHash(receipt.graph.api); writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt)); } },
    { name: 'GRAPH_HASH', code: 'MATTE_RECEIPT', change: (dir, receipt) => { receipt.graph.sha256 = '0'.repeat(64); writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt)); } },
    { name: 'TRANSFORM', code: 'MATTE_GRID', change: (dir, receipt) => { Reflect.set(receipt, 'input_transform', {}); writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt)); } },
    { name: 'INPUT_HASH', code: 'MATTE_GRID', change: (dir, receipt) => { receipt.input_sha256 = '0'.repeat(64); writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt)); } },
    { name: 'RECORDED_GRID', code: 'MATTE_GRID', change: (dir, receipt) => { receipt.output.width++; writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt)); } },
    { name: 'REHASHED_PIXEL_REPAIR', code: 'MATTE_VALUES', change: (dir, receipt) => {
      const bytes = readFileSync(join(dir, 'mask.png'));
      const raster = decodePngBytes(bytes, 'mask');
      raster.data.set([255, 255, 255, 255], 0);
      const changed = encodePngBytes(raster);
      writeFileSync(join(dir, 'mask.png'), changed);
      receipt.output.sha256 = sha256(changed);
      writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt));
    } },
  ];
  for (const plant of plants) {
    const dir = join(work, plant.name);
    cpSync(defaults.out, dir, { recursive: true });
    plant.change(dir, structuredClone(original));
    const output = join(work, `${plant.name}-output`);
    refused(plant.name, plant.code, () => runForeground({ painting, maskFrom: `matte:${dir}`, out: output }));
    check(`${plant.name}_NO_OUTPUT`, !existsSync(output), 'refused source leaves no plate output');
    check(`${plant.name}_POSITIVE_CONTROL`, source(defaults.out).inside.reduce((a, b) => a + b, 0) === 32, 'immutable original remains accepted');
  }
  const foreign = new Uint8Array(readFileSync(painting));
  foreign[foreign.length - 1] ^= 1;
  refused('FOREIGN_PAINTING', 'MATTE_PAINTING', () => source(defaults.out, foreign));
  refused('PAINTING_ABSENT', 'MATTE_PAINTING', () => readSourceMask('matte', defaults.out, 8, 8));

  for (const [mode, code] of [
    ['missing-model', 'MATTE_MODEL_INSTALLED'], ['bad-model-list', 'MATTE_MODEL_INSTALLED'], ['missing-node', 'COMFY_NODE_PRESENT'],
    ['wrong-size', 'MATTE_GRID'], ['empty', 'MATTE_EMPTY'], ['color', 'MATTE_VALUES'],
    ['no-output', 'COMFY_HISTORY_OUTPUTS'], ['error', 'COMFY_RUN_OK'], ['behind', 'COMFY_QUEUE_BEHIND'],
  ] as const) {
    const got = await fakeRun(mode);
    check(`BOX_${mode.toUpperCase().replaceAll('-', '_')}`, got.message.includes(code) && !existsSync(got.run.out), got.message || `expected ${code}`);
    if (mode === 'missing-model' || mode === 'missing-node' || mode === 'bad-model-list') check(`PREUPLOAD_${mode.toUpperCase().replaceAll('-', '_')}`, got.uploads.length === 0 && got.prompts.length === 0, 'refused before upload or submit');
  }
  const localPlants: Array<[string, string, Partial<MatteRun>]> = [
    ['NODE_REQUIRED', 'MATTE_MODEL', { node: undefined }], ['MODEL_REQUIRED', 'MATTE_MODEL', { model: undefined }],
    ['RESOLUTION', 'MATTE_PARAMS', { resolution: 65 }], ['THRESHOLD', 'MATTE_PARAMS', { threshold: 255 }],
    ['CHECKSUM', 'PLATE_CHECKPOINT_SHA256', { checkpointSha256: undefined }], ['OCCUPIED_OUT', 'MATTE_OUT_EMPTY', { out: defaults.out }],
  ];
  for (const [name, code, changes] of localPlants) {
    const got = await fakeRun('ok', changes);
    check(name, got.message.includes(code) && got.paths.length === 0, got.message || `expected ${code}`);
  }
  const nonSquare = newRaster(4, 2);
  nonSquare.data.fill(255);
  const nonSquarePath = join(work, 'non-square.png');
  writeFileSync(nonSquarePath, encodePngBytes(nonSquare));
  const mapped = await fakeRun('half', { painting: nonSquarePath });
  check('NON_SQUARE_TRANSFORM', mapped.receipt?.input_transform?.pad_fill === 'rgb-black-opaque' && mapped.receipt?.raw_output.width === 64 && mapped.receipt.output.width === 4 && mapped.receipt.output.height === 2, 'recorded #1197 transform and native output dimensions');
  if (mapped.receipt !== undefined) {
    const mask = readSourceMask('matte', mapped.run.out, 4, 2, nonSquare, readFileSync(nonSquarePath));
    check('NON_SQUARE_HAND_COUNTS', [...mask.inside].join() === '1,1,0,0,1,1,0,0', 'two rows of two foreground columns after recorded pixel-centre mapping');
  }
  const emptyMapped = await fakeRun('ok', { painting: nonSquarePath });
  check('NON_SQUARE_EMPTY_AFTER_INVERSE', emptyMapped.message.includes('MATTE_EMPTY') && !existsSync(emptyMapped.run.out), emptyMapped.message);

}

try {
  if (!process.argv.includes('--rows-only')) await controls();
  const tally = new RunTally();
  const log = console.log;
  console.log = (...values: unknown[]) => { const line = values.map(String).join(' '); tally.observe(line); log(line); };
  try {
    tally.of('matte', () => {
      console.log('\n── matte: source receipts and fake box ──');
      let failures = 0;
      const say = (name: string, ok: boolean, detail: string, why: string): void => { failures += reportMeasuredCase(name, ok, detail, why); };
      for (const test of cases) say(test.name, test.ok, test.detail, 'issue #1204: synthetic input through production writer, reader and CLI');
      const text = treeFiles().filter(file => TEXT_FILE.test(file)).map(file => [file, readFileSync(join(root, file), 'utf8')] as const);
      treeGuideCase(text, say);
      return failures;
    });
  } finally { console.log = log; }
  const faults = tallyFaults(tally.blocks, tally.gutter, tally.total);
  for (const fault of faults) console.error(fault);
  console.log(`matte controls ${tally.total}, failures ${tally.failures}, tally faults ${faults.length}`);
  process.exitCode = tally.failures || faults.length ? 1 : 0;
} finally { rmSync(work, { recursive: true, force: true }); }
