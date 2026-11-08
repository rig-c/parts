/** Focused production-entry controls for `comfy plate --graph core` pad-to-8 (`grid_transform`, issue #1209). */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FAKE_CHECKPOINT, FAKE_FILL, startFakeComfy } from '../fixtures/fakecomfy.ts';
import { ComfyClient } from '../src/comfy/client.ts';
import { type BackgroundRun, runBackground } from '../src/comfy/plate.ts';
import { OPAQUE_ALPHA_ABOVE } from '../src/layers.ts';
import {
  CORE_DEFAULTS,
  CORE_GRID_TRANSFORM_KEYS,
  type CoreGridTransform,
  coreGridTransform,
  corePlateGraph,
  growMask,
  maskImage,
  pasteInside,
  PLATE_GRAPH_IDS,
  PLATE_RECEIPT_GRID_TRANSFORM_KEYS,
  PLATE_RECEIPT_KEYS,
  type PlateReceipt,
  readSourceMask,
  runForeground,
  sha256,
  verifyPlateReceipt,
} from '../src/plate.ts';
import { decodePngBytes, encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { writeRunStamp } from '../src/runstamp.ts';
import { reportMeasuredCase, RunTally, tallyFaults, TEXT_FILE, treeFiles, treeGuideCase } from '../selftest.ts';

interface Case {
  name: string;
  ok: boolean;
  detail: string;
}

const cases: Case[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  cases.push({ name: `CG1209_${name}`, ok, detail: JSON.stringify(detail) });
};

const root = join(import.meta.dir, '..');
const work = mkdtempSync(join(tmpdir(), 'parts-core-grid-'));
const SHA = 'c'.repeat(64);

function makeGradientPainting(w: number, h: number): Raster {
  const r = newRaster(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      r.data.set([(x * 17 + y * 31 + 11) % 251, (x * 23 + y * 7 + 43) % 251, (x * 13 + y * 19 + 89) % 251, 255], (y * w + x) * 4);
    }
  }
  return r;
}

/** Build a stamped `figure-mask:` source directory whose mask includes the right/bottom edges to exercise mask padding. */
function makeFigureSource(tag: string, paintingRaster: Raster, paintingBytes: Uint8Array, maskBox: [number, number, number, number]): string {
  const srcRoot = join(work, `src-${tag}`);
  const rigDir = join(srcRoot, 'rig');
  mkdirSync(rigDir, { recursive: true });
  const configPath = join(srcRoot, 'config.json');
  writeFileSync(configPath, JSON.stringify({ key: tag, assemble: { rig_scale: 1 } }));
  const maskRaster = newRaster(paintingRaster.width, paintingRaster.height);
  let px = 0;
  for (let y = 0; y < paintingRaster.height; y++) {
    for (let x = 0; x < paintingRaster.width; x++) {
      const inside = x >= maskBox[0] && x < maskBox[2] && y >= maskBox[1] && y < maskBox[3];
      const v = inside ? 255 : 0;
      if (inside) px++;
      maskRaster.data.set([v, v, v, 255], (y * paintingRaster.width + x) * 4);
    }
  }
  writeFileSync(join(rigDir, 'figure_rig.png'), encodePngBytes(maskRaster));
  writeFileSync(join(rigDir, 'painting_in_rig.png'), paintingBytes);
  writeFileSync(
    join(rigDir, 'parts.json'),
    JSON.stringify({
      painting_in_rig: { path: 'painting_in_rig.png', sha256: sha256(paintingBytes), resample: 'lanczos3-rgb-opaque' },
      scene: { figure_alpha_above: 8, figure_px: px, figure_mask: 'figure_rig.png' },
    }),
  );
  writeRunStamp({
    pkg: { name: '@rig-c/parts', version: '0.0.0' },
    command: 'assemble',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:00.000Z',
    outDir: srcRoot,
    configPath,
    outputPaths: ['rig/parts.json', 'rig/figure_rig.png', 'rig/painting_in_rig.png'],
  });
  return rigDir;
}

async function cli(args: string[]): Promise<{ code: number; out: string }> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (k !== 'COMFY_HOST' && v !== undefined) env[k] = v;
  const child = Bun.spawn([process.execPath, join(root, 'cli.ts'), ...args], { cwd: work, env, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, out: out + err };
}

async function controls(): Promise<void> {
  // 1. Off-grid painting (13x10 -> padded 16x16), with figure mask reaching the right/bottom edge after grow.
  const offW = 13, offH = 10;
  const offRaster = makeGradientPainting(offW, offH);
  const offBytes = encodePngBytes(offRaster);
  const offPainting = join(work, 'offgrid-13x10.png');
  writeFileSync(offPainting, offBytes);
  const offRigDir = makeFigureSource('off-13x10', offRaster, offBytes, [8, 5, 13, 10]);
  const offSourceMask = readSourceMask('figure-mask', offRigDir, offW, offH, offRaster, offBytes);
  const growPx = 1;
  const offGrownMask = growMask(offSourceMask, growPx);

  const offCoreOut = join(work, 'out-off-core');
  const offCoreBox = startFakeComfy('ok');
  let offCoreCli: { code: number; out: string };
  try {
    offCoreCli = await cli([
      'comfy', 'plate', '--mode', 'background', '--painting', offPainting,
      '--mask-from', `figure-mask:${offRigDir}`, '--out', offCoreOut,
      '--graph', 'core', '--model', FAKE_CHECKPOINT, '--checkpoint-sha256', SHA,
      '--seed', '17', '--grow', String(growPx), '--host', offCoreBox.url, '--poll', '0.001',
    ]);
  } finally {
    offCoreBox.stop();
  }
  const offCoreReceiptPath = join(offCoreOut, 'receipt.json');
  check('OFFGRID_CORE_RUNS_AND_VERIFIES', offCoreCli.code === 0 && existsSync(offCoreReceiptPath) && verifyPlateReceipt(offCoreReceiptPath).length === 0, `exit ${offCoreCli.code}, ${offCoreCli.out.trim()}`);
  const offCoreReceipt = JSON.parse(readFileSync(offCoreReceiptPath, 'utf8')) as PlateReceipt;
  const expectedTransform: CoreGridTransform = {
    source: [13, 10],
    padded: [16, 16],
    pad: [0, 0],
    pad_fill: 'edge-replicate',
    mask_pad_fill: 'zero',
    inverse: 'crop',
  };
  check(
    'OFFGRID_CORE_RECEIPT_TRANSFORM_AND_KEY_ORDER',
    Object.keys(offCoreReceipt).join(',') === PLATE_RECEIPT_GRID_TRANSFORM_KEYS.join(',') &&
      offCoreReceipt.grid_transform !== undefined &&
      Object.keys(offCoreReceipt.grid_transform).join(',') === CORE_GRID_TRANSFORM_KEYS.join(',') &&
      JSON.stringify(offCoreReceipt.grid_transform) === JSON.stringify(expectedTransform),
    `keys=${Object.keys(offCoreReceipt).join(',')}, grid_transform=${JSON.stringify(offCoreReceipt.grid_transform)}`,
  );

  // Verify the uploaded painting is 16x16 with exact edge-replicate in the pad region, and the uploaded mask is 16x16 with 0 in the pad region.
  const uploads = [...offCoreBox.uploads.entries()];
  const uploadedPaintingBytes = uploads.find(([k]) => k.endsWith('_painting.png'))?.[1];
  const uploadedMaskBytes = uploads.find(([k]) => k.endsWith('_mask.png'))?.[1];
  const uploadedPainting = uploadedPaintingBytes === undefined ? undefined : decodePngBytes(uploadedPaintingBytes, 'uploaded painting');
  const uploadedMask = uploadedMaskBytes === undefined ? undefined : decodePngBytes(uploadedMaskBytes, 'uploaded mask');
  let edgeReplicateBad = 0;
  let maskPadBad = 0;
  let maskSourceBad = 0;
  if (uploadedPainting !== undefined && uploadedMask !== undefined) {
    for (let y = 0; y < 16; y++) {
      const sy = Math.min(y, offH - 1);
      for (let x = 0; x < 16; x++) {
        const sx = Math.min(x, offW - 1);
        const srcIdx = (sy * offW + sx) * 4;
        const dstIdx = (y * 16 + x) * 4;
        for (let c = 0; c < 4; c++) {
          if (uploadedPainting.data[dstIdx + c] !== offRaster.data[srcIdx + c]) edgeReplicateBad++;
        }
        const mR = uploadedMask.data[dstIdx], mG = uploadedMask.data[dstIdx + 1], mB = uploadedMask.data[dstIdx + 2], mA = uploadedMask.data[dstIdx + 3];
        if (x < offW && y < offH) {
          const want = offGrownMask.inside[y * offW + x] === 1 ? 255 : 0;
          if (mR !== want || mG !== want || mB !== want || mA !== 255) maskSourceBad++;
        } else if (mR !== 0 || mG !== 0 || mB !== 0 || mA !== 255) {
          maskPadBad++;
        }
      }
    }
  }
  check(
    'OFFGRID_CORE_UPLOADED_PAINTING_IS_PADDED_EDGE_REPLICATE',
    uploadedPainting?.width === 16 && uploadedPainting.height === 16 && edgeReplicateBad === 0,
    `uploaded=${uploadedPainting?.width}x${uploadedPainting?.height}, edgeReplicateBad=${edgeReplicateBad}`,
  );
  check(
    'OFFGRID_CORE_UPLOADED_MASK_PAD_IS_ZERO_CONTEXT',
    uploadedMask?.width === 16 && uploadedMask.height === 16 && maskSourceBad === 0 && maskPadBad === 0 && offGrownMask.inside[9 * offW + 12] === 1,
    `uploadedMask=${uploadedMask?.width}x${uploadedMask?.height}, cornerInHole=${offGrownMask.inside[9 * offW + 12]}, maskSourceBad=${maskSourceBad}, maskPadBad=${maskPadBad}`,
  );

  // Verify the cropped output plate.png is 13x10, inside pixels equal FAKE_FILL, and outside pixels equal the painting byte-for-byte.
  const offPlateRaster = decodePngBytes(readFileSync(join(offCoreOut, 'plate.png')), 'plate.png');
  const offMaskRaster = decodePngBytes(readFileSync(join(offCoreOut, 'mask.png')), 'mask.png');
  let insideCount = 0, outsideCount = 0, insideBad = 0, outsideBad = 0;
  for (let p = 0; p < offW * offH; p++) {
    const i = p * 4;
    if (offGrownMask.inside[p] === 1) {
      insideCount++;
      if (offPlateRaster.data[i] !== FAKE_FILL[0] || offPlateRaster.data[i + 1] !== FAKE_FILL[1] || offPlateRaster.data[i + 2] !== FAKE_FILL[2] || offPlateRaster.data[i + 3] !== 255) insideBad++;
    } else {
      outsideCount++;
      for (let c = 0; c < 4; c++) if (offPlateRaster.data[i + c] !== offRaster.data[i + c]) outsideBad++;
    }
  }
  check(
    'OFFGRID_CORE_CROPPED_OUTPUT_MATCHES_PAINTING_OUTSIDE_HOLE',
    offPlateRaster.width === offW && offPlateRaster.height === offH && offMaskRaster.width === offW && offMaskRaster.height === offH &&
      insideCount === 36 && outsideCount === 94 && insideBad === 0 && outsideBad === 0,
    `plate=${offPlateRaster.width}x${offPlateRaster.height}, mask=${offMaskRaster.width}x${offMaskRaster.height}, inside=${insideCount} (bad ${insideBad}), outside=${outsideCount} (bad ${outsideBad})`,
  );

  // Also check single-axis off-grid dimensions (width-only 13x8 -> 16x8, height-only 8x10 -> 8x16).
  check(
    'SINGLE_AXIS_OFFGRID_TRANSFORMS',
    JSON.stringify(coreGridTransform(13, 8)?.padded) === '[16,8]' &&
      JSON.stringify(coreGridTransform(8, 10)?.padded) === '[8,16]' &&
      coreGridTransform(16, 8) === undefined,
    `13x8->${JSON.stringify(coreGridTransform(13, 8)?.padded)}, 8x10->${JSON.stringify(coreGridTransform(8, 10)?.padded)}, 16x8->${String(coreGridTransform(16, 8))}`,
  );

  // 2. On-grid core (8x8) is byte-identical to today: receipt (9 keys, no grid_transform), uploads (exact original bytes), graph, and outputs.
  const onW = 8, onH = 8;
  const onRaster = makeGradientPainting(onW, onH);
  const onBytes = encodePngBytes(onRaster);
  const onPainting = join(work, 'ongrid-8x8.png');
  writeFileSync(onPainting, onBytes);
  const onRigDir = makeFigureSource('on-8x8', onRaster, onBytes, [2, 2, 5, 5]);
  const onSourceMask = readSourceMask('figure-mask', onRigDir, onW, onH, onRaster, onBytes);
  const onGrownMask = growMask(onSourceMask, growPx);
  const onCoreOut = join(work, 'out-on-core');
  const onCoreBox = startFakeComfy('ok');
  let onCoreReceipt: PlateReceipt;
  try {
    onCoreReceipt = await runBackground(
      () => new ComfyClient(onCoreBox.url, { poll: 0.001, request: 1 }),
      {
        painting: onPainting,
        maskFrom: `figure-mask:${onRigDir}`,
        out: onCoreOut,
        graph: 'core',
        model: FAKE_CHECKPOINT,
        checkpointSha256: SHA,
        seed: 17,
        growPx,
        steps: CORE_DEFAULTS.steps,
        prompt: undefined,
        negative: undefined,
        wait: 0.01,
        timeout: 1,
      },
      () => {},
    );
  } finally {
    onCoreBox.stop();
  }
  const onUploadEntries = [...onCoreBox.uploads.entries()];
  const onUploadedPaintingName = onUploadEntries.find(([k]) => k.endsWith('_painting.png'))?.[0] ?? '';
  const onUploadedPaintingBytes = onUploadEntries.find(([k]) => k.endsWith('_painting.png'))?.[1];
  const onUploadedMaskName = onUploadEntries.find(([k]) => k.endsWith('_mask.png'))?.[0] ?? '';
  const onUploadedMaskBytes = onUploadEntries.find(([k]) => k.endsWith('_mask.png'))?.[1];
  const onPrefix = onUploadedPaintingName.replace(/_painting\.png$/, '');
  const expectedOnGraph = corePlateGraph(
    onUploadedPaintingName,
    onUploadedMaskName,
    FAKE_CHECKPOINT,
    {
      seed: 17,
      grow_px: growPx,
      steps: CORE_DEFAULTS.steps,
      cfg: CORE_DEFAULTS.cfg,
      sampler: CORE_DEFAULTS.sampler,
      scheduler: CORE_DEFAULTS.scheduler,
      denoise: CORE_DEFAULTS.denoise,
      prompt: CORE_DEFAULTS.prompt,
      negative: CORE_DEFAULTS.negative,
    },
    onPrefix,
  );
  const expectedOnInpainted = newRaster(onW, onH);
  for (let p = 0; p < onW * onH; p++) expectedOnInpainted.data.set([...FAKE_FILL, 255], p * 4);
  const expectedOnPlateBytes = encodePngBytes(pasteInside(onRaster, expectedOnInpainted, onGrownMask));
  const expectedOnMaskBytes = encodePngBytes(maskImage(onGrownMask));
  const onReceiptDiskText = readFileSync(join(onCoreOut, 'receipt.json'), 'utf8');
  const expectedOnReceiptText = `${JSON.stringify(
    {
      spec: 'rig-parts-plate-receipt/1',
      mode: 'background',
      painting: { path: '../ongrid-8x8.png', sha256: sha256(onBytes) },
      mask: { source: 'figure-mask', from: '../src-on-8x8/rig', path: 'mask.png', sha256: sha256(expectedOnMaskBytes) },
      model: { name: FAKE_CHECKPOINT, checkpoint_sha256: SHA, checkpoint_sha256_from: 'declared' },
      params: {
        seed: 17,
        grow_px: growPx,
        steps: CORE_DEFAULTS.steps,
        cfg: CORE_DEFAULTS.cfg,
        sampler: CORE_DEFAULTS.sampler,
        scheduler: CORE_DEFAULTS.scheduler,
        denoise: CORE_DEFAULTS.denoise,
        prompt: CORE_DEFAULTS.prompt,
        negative: CORE_DEFAULTS.negative,
        mask_alpha_above: OPAQUE_ALPHA_ABOVE,
      },
      graph: PLATE_GRAPH_IDS.core,
      gpu: 'cuda:0 Fake GPU',
      output: { path: 'plate.png', sha256: sha256(expectedOnPlateBytes) },
    },
    null,
    2,
  )}\n`;
  check(
    'ONGRID_CORE_BYTE_IDENTICAL_RECEIPT_UPLOADS_AND_GRAPH',
    Object.keys(onCoreReceipt).join(',') === PLATE_RECEIPT_KEYS.join(',') &&
      !('grid_transform' in onCoreReceipt) &&
      onReceiptDiskText === expectedOnReceiptText &&
      onUploadedPaintingBytes !== undefined &&
      sha256(onUploadedPaintingBytes) === sha256(onBytes) &&
      onUploadedMaskBytes !== undefined &&
      sha256(onUploadedMaskBytes) === sha256(expectedOnMaskBytes) &&
      JSON.stringify(onCoreBox.prompts[0]) === JSON.stringify(expectedOnGraph) &&
      sha256(readFileSync(join(onCoreOut, 'plate.png'))) === sha256(expectedOnPlateBytes) &&
      verifyPlateReceipt(join(onCoreOut, 'receipt.json')).length === 0,
    `keys=${Object.keys(onCoreReceipt).join(',')}, uploadShaMatches=${onUploadedPaintingBytes !== undefined && sha256(onUploadedPaintingBytes) === sha256(onBytes)}, graphMatches=${JSON.stringify(onCoreBox.prompts[0]) === JSON.stringify(expectedOnGraph)}`,
  );

  // 3. Lama and foreground on the off-grid 13x10 painting carry no grid_transform and keep exact 13x10 uploads/outputs.
  const offLamaOut = join(work, 'out-off-lama');
  const offLamaBox = startFakeComfy('ok');
  let offLamaReceipt: PlateReceipt;
  try {
    offLamaReceipt = await runBackground(
      () => new ComfyClient(offLamaBox.url, { poll: 0.001, request: 1 }),
      {
        painting: offPainting,
        maskFrom: `figure-mask:${offRigDir}`,
        out: offLamaOut,
        graph: 'lama',
        model: undefined,
        checkpointSha256: SHA,
        seed: 17,
        growPx,
        steps: CORE_DEFAULTS.steps,
        prompt: undefined,
        negative: undefined,
        wait: 0.01,
        timeout: 1,
      },
      () => {},
    );
  } finally {
    offLamaBox.stop();
  }
  const lamaUploadedPainting = [...offLamaBox.uploads.entries()].find(([k]) => k.endsWith('_painting.png'))?.[1];
  const offFgOut = join(work, 'out-off-fg');
  const offFgReceipt = runForeground({ painting: offPainting, maskFrom: `figure-mask:${offRigDir}`, out: offFgOut });
  check(
    'OFFGRID_LAMA_AND_FOREGROUND_OMIT_GRID_TRANSFORM',
    Object.keys(offLamaReceipt).join(',') === PLATE_RECEIPT_KEYS.join(',') &&
      !('grid_transform' in offLamaReceipt) &&
      lamaUploadedPainting !== undefined &&
      sha256(lamaUploadedPainting) === sha256(offBytes) &&
      verifyPlateReceipt(join(offLamaOut, 'receipt.json')).length === 0 &&
      Object.keys(offFgReceipt).join(',') === PLATE_RECEIPT_KEYS.join(',') &&
      !('grid_transform' in offFgReceipt) &&
      verifyPlateReceipt(join(offFgOut, 'receipt.json')).length === 0,
    `lamaKeys=${Object.keys(offLamaReceipt).join(',')}, fgKeys=${Object.keys(offFgReceipt).join(',')}`,
  );

  // 4. Receipt round-trip and planted missing, unexpected, malformed and tampered grid_transform refusals.
  const insertTransformBeforeOutput = (raw: Record<string, unknown>, transform: unknown): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const k of PLATE_RECEIPT_GRID_TRANSFORM_KEYS) {
      out[k] = k === 'grid_transform' ? transform : raw[k];
    }
    return out;
  };
  const receiptPlants: Array<{
    name: string;
    sourceDir: string;
    code: string;
    mutate: (raw: Record<string, unknown>) => Record<string, unknown>;
  }> = [
    {
      name: 'MISSING_ON_OFFGRID_CORE',
      sourceDir: offCoreOut,
      code: 'PLATE_RECEIPT_GRID_TRANSFORM',
      mutate: (raw) => {
        const copy = { ...raw };
        delete copy.grid_transform;
        return copy;
      },
    },
    {
      name: 'UNEXPECTED_ON_ONGRID_CORE',
      sourceDir: onCoreOut,
      code: 'PLATE_RECEIPT_GRID_TRANSFORM',
      mutate: (raw) => insertTransformBeforeOutput(raw, expectedTransform),
    },
    {
      name: 'UNEXPECTED_ON_OFFGRID_LAMA',
      sourceDir: offLamaOut,
      code: 'PLATE_RECEIPT_GRID_TRANSFORM',
      mutate: (raw) => insertTransformBeforeOutput(raw, expectedTransform),
    },
    {
      name: 'UNEXPECTED_ON_OFFGRID_FOREGROUND',
      sourceDir: offFgOut,
      code: 'PLATE_RECEIPT_GRID_TRANSFORM',
      mutate: (raw) => insertTransformBeforeOutput(raw, expectedTransform),
    },
    {
      name: 'MALFORMED_NULL_TRANSFORM',
      sourceDir: offCoreOut,
      code: 'PLATE_RECEIPT_GRID_TRANSFORM',
      mutate: (raw) => ({ ...raw, grid_transform: null }),
    },
    {
      name: 'MALFORMED_EMPTY_OBJECT_TRANSFORM',
      sourceDir: offCoreOut,
      code: 'PLATE_RECEIPT_GRID_TRANSFORM',
      mutate: (raw) => ({ ...raw, grid_transform: {} }),
    },
    {
      name: 'MALFORMED_TRANSFORM_KEY_ORDER',
      sourceDir: offCoreOut,
      code: 'PLATE_RECEIPT_GRID_TRANSFORM',
      mutate: (raw) => ({
        ...raw,
        grid_transform: {
          padded: [16, 16],
          source: [13, 10],
          pad: [0, 0],
          pad_fill: 'edge-replicate',
          mask_pad_fill: 'zero',
          inverse: 'crop',
        },
      }),
    },
    {
      name: 'WRONG_TOPLEVEL_POSITION',
      sourceDir: offCoreOut,
      code: 'PLATE_RECEIPT_KEYS',
      mutate: (raw) => {
        const out: Record<string, unknown> = {};
        for (const k of PLATE_RECEIPT_KEYS) out[k] = raw[k];
        out.grid_transform = raw.grid_transform;
        return out;
      },
    },
    {
      name: 'TAMPERED_SOURCE_DIMS',
      sourceDir: offCoreOut,
      code: 'PLATE_RECEIPT_GRID_TRANSFORM',
      mutate: (raw) => ({ ...raw, grid_transform: { ...(raw.grid_transform as object), source: [16, 16] } }),
    },
    {
      name: 'TAMPERED_PADDED_DIMS',
      sourceDir: offCoreOut,
      code: 'PLATE_RECEIPT_GRID_TRANSFORM',
      mutate: (raw) => ({ ...raw, grid_transform: { ...(raw.grid_transform as object), padded: [24, 16] } }),
    },
    {
      name: 'TAMPERED_PAD_OFFSET',
      sourceDir: offCoreOut,
      code: 'PLATE_RECEIPT_GRID_TRANSFORM',
      mutate: (raw) => ({ ...raw, grid_transform: { ...(raw.grid_transform as object), pad: [1, 0] } }),
    },
    {
      name: 'TAMPERED_PAD_FILL',
      sourceDir: offCoreOut,
      code: 'PLATE_RECEIPT_GRID_TRANSFORM',
      mutate: (raw) => ({ ...raw, grid_transform: { ...(raw.grid_transform as object), pad_fill: 'rgba-zero' } }),
    },
    {
      name: 'TAMPERED_MASK_PAD_FILL',
      sourceDir: offCoreOut,
      code: 'PLATE_RECEIPT_GRID_TRANSFORM',
      mutate: (raw) => ({ ...raw, grid_transform: { ...(raw.grid_transform as object), mask_pad_fill: 'one' } }),
    },
    {
      name: 'TAMPERED_INVERSE',
      sourceDir: offCoreOut,
      code: 'PLATE_RECEIPT_GRID_TRANSFORM',
      mutate: (raw) => ({ ...raw, grid_transform: { ...(raw.grid_transform as object), inverse: 'nearest-pixel-centres' } }),
    },
  ];
  for (const plant of receiptPlants) {
    const dir = join(work, `plant-${plant.name}`);
    cpSync(plant.sourceDir, dir, { recursive: true });
    const receiptPath = join(dir, 'receipt.json');
    const raw = JSON.parse(readFileSync(receiptPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(receiptPath, `${JSON.stringify(plant.mutate(raw), null, 2)}\n`);
    const problems = verifyPlateReceipt(receiptPath);
    const hit = problems.find((p) => p.code === plant.code);
    check(
      `RECEIPT_PLANT_${plant.name}`,
      hit !== undefined && verifyPlateReceipt(join(plant.sourceDir, 'receipt.json')).length === 0,
      hit !== undefined ? `${hit.code}: ${hit.object} — ${hit.detail}` : `expected ${plant.code}, got ${JSON.stringify(problems)}`,
    );
  }

  // 5. Box returning the wrong size (e.g. unpadded 13x10 instead of padded 16x16) is refused as COMFY_PLATE_SIZE and leaves no output.
  const wrongSizeBox = startFakeComfy('ok');
  const origView = ComfyClient.prototype.view;
  const wrongSizeOut = join(work, 'out-wrong-size');
  let wrongSizeMessage = '';
  try {
    ComfyClient.prototype.view = async function () {
      return encodePngBytes(newRaster(offW, offH));
    };
    const run: BackgroundRun = {
      painting: offPainting,
      maskFrom: `figure-mask:${offRigDir}`,
      out: wrongSizeOut,
      graph: 'core',
      model: FAKE_CHECKPOINT,
      checkpointSha256: SHA,
      seed: 17,
      growPx,
      steps: CORE_DEFAULTS.steps,
      prompt: undefined,
      negative: undefined,
      wait: 0.01,
      timeout: 1,
    };
    await runBackground(() => new ComfyClient(wrongSizeBox.url, { poll: 0.001, request: 1 }), run, () => {});
  } catch (err) {
    wrongSizeMessage = (err as Error).message;
  } finally {
    ComfyClient.prototype.view = origView;
    wrongSizeBox.stop();
  }
  check(
    'BOX_WRONG_SIZE_REFUSED_AS_COMFY_PLATE_SIZE',
    wrongSizeMessage.includes('COMFY_PLATE_SIZE') && wrongSizeMessage.includes('16x16') && !existsSync(wrongSizeOut),
    wrongSizeMessage || 'expected COMFY_PLATE_SIZE',
  );
}

try {
  if (!process.argv.includes('--rows-only')) await controls();
  const tally = new RunTally();
  const log = console.log;
  console.log = (...values: unknown[]) => {
    const line = values.map(String).join(' ');
    tally.observe(line);
    log(line);
  };
  try {
    tally.of('core-grid', () => {
      console.log('\n── core-grid: pad-to-8 transform, receipts and fake box ──');
      let failures = 0;
      const say = (name: string, ok: boolean, detail: string, why: string): void => {
        failures += reportMeasuredCase(name, ok, detail, why);
      };
      for (const test of cases) say(test.name, test.ok, test.detail, 'issue #1209: off-grid core pad-to-8 transform through production writer, reader and CLI');
      const text = treeFiles()
        .filter((file) => TEXT_FILE.test(file))
        .map((file) => [file, readFileSync(join(root, file), 'utf8')] as const);
      treeGuideCase(text, say);
      return failures;
    });
  } finally {
    console.log = log;
  }
  const faults = tallyFaults(tally.blocks, tally.gutter, tally.total);
  for (const fault of faults) console.error(fault);
  console.log(`core-grid controls ${tally.total}, failures ${tally.failures}, tally faults ${faults.length}`);
  process.exitCode = tally.failures || faults.length ? 1 : 0;
} finally {
  rmSync(work, { recursive: true, force: true });
}
