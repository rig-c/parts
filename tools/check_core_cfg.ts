/** Focused production-entry controls for `comfy plate --graph core` `--cfg` (`PLATE_CORE_CFG`, issue #1216). */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FAKE_CHECKPOINT, FAKE_FILL, startFakeComfy } from '../fixtures/fakecomfy.ts';
import { ComfyClient } from '../src/comfy/client.ts';
import { type BackgroundRun, runBackground } from '../src/comfy/plate.ts';
import { OPAQUE_ALPHA_ABOVE } from '../src/layers.ts';
import {
  CORE_DEFAULTS,
  coreCfg,
  corePlateGraph,
  growMask,
  maskImage,
  pasteInside,
  PLATE_GRAPH_IDS,
  PLATE_RECEIPT_KEYS,
  type PlateReceipt,
  readSourceMask,
  sha256,
  verifyPlateReceipt,
} from '../src/plate.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { writeRunStamp } from '../src/runstamp.ts';
import { reportMeasuredCase, RunTally, tallyFaults, TEXT_FILE, treeFiles, treeGuideCase } from '../selftest.ts';

const CORE_RECEIPT_PARAMS_KEYS = ['seed', 'grow_px', 'steps', 'cfg', 'sampler', 'scheduler', 'denoise', 'prompt', 'negative', 'mask_alpha_above'] as const;

interface Case {
  name: string;
  ok: boolean;
  detail: string;
}

const cases: Case[] = [];
const check = (name: string, ok: boolean, detail: string): void => {
  cases.push({ name: `CC1216_${name}`, ok, detail: JSON.stringify(detail) });
};

const root = join(import.meta.dir, '..');
const work = mkdtempSync(join(tmpdir(), 'parts-core-cfg-'));
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
  const w = 8, h = 8;
  const raster = makeGradientPainting(w, h);
  const bytes = encodePngBytes(raster);
  const painting = join(work, 'ongrid-8x8.png');
  writeFileSync(painting, bytes);
  const rigDir = makeFigureSource('on-8x8', raster, bytes, [2, 2, 5, 5]);
  const growPx = 1;
  const sourceMask = readSourceMask('figure-mask', rigDir, w, h, raster, bytes);
  const grownMask = growMask(sourceMask, growPx);

  // 1. `--cfg 3` (via CLI and via runBackground, plus fractional `4.5`) reaches KSampler (`inputs.cfg === 3`) and `receipt.json` `params.cfg === 3`.
  const cfg3CliOut = join(work, 'out-cfg3-cli');
  const cfg3CliBox = startFakeComfy('ok');
  let cfg3CliRes: { code: number; out: string };
  try {
    cfg3CliRes = await cli([
      'comfy', 'plate', '--mode', 'background', '--painting', painting,
      '--mask-from', `figure-mask:${rigDir}`, '--out', cfg3CliOut,
      '--graph', 'core', '--model', FAKE_CHECKPOINT, '--checkpoint-sha256', SHA,
      '--seed', '17', '--grow', String(growPx), '--cfg', '3', '--host', cfg3CliBox.url, '--poll', '0.001',
    ]);
  } finally {
    cfg3CliBox.stop();
  }
  const cfg3CliReceiptPath = join(cfg3CliOut, 'receipt.json');
  const cfg3CliReceipt = JSON.parse(readFileSync(cfg3CliReceiptPath, 'utf8')) as PlateReceipt;
  const cfg3CliPrompt = cfg3CliBox.prompts[0] as Record<string, { class_type?: string; inputs?: Record<string, unknown> }> | undefined;
  const cfg3CliKSampler = cfg3CliPrompt?.['7'];
  check(
    'CFG_3_CLI_REACHES_KSAMPLER_AND_RECEIPT',
    cfg3CliRes.code === 0 &&
      existsSync(cfg3CliReceiptPath) &&
      verifyPlateReceipt(cfg3CliReceiptPath).length === 0 &&
      cfg3CliKSampler?.class_type === 'KSampler' &&
      cfg3CliKSampler.inputs?.cfg === 3 &&
      cfg3CliKSampler.inputs?.denoise === CORE_DEFAULTS.denoise &&
      Object.keys(cfg3CliReceipt.params).join(',') === CORE_RECEIPT_PARAMS_KEYS.join(',') &&
      (cfg3CliReceipt.params as { cfg?: unknown }).cfg === 3,
    `exit=${cfg3CliRes.code}, ksampler.cfg=${String(cfg3CliKSampler?.inputs?.cfg)}, receipt.params.cfg=${String((cfg3CliReceipt.params as { cfg?: unknown }).cfg)}, keys=${Object.keys(cfg3CliReceipt.params).join(',')}`,
  );

  // Also test fractional `--cfg 4.5` via `runBackground`.
  const cfg45Out = join(work, 'out-cfg45-api');
  const cfg45Box = startFakeComfy('ok');
  let cfg45Receipt: PlateReceipt;
  try {
    cfg45Receipt = await runBackground(
      () => new ComfyClient(cfg45Box.url, { poll: 0.001, request: 1 }),
      {
        painting,
        maskFrom: `figure-mask:${rigDir}`,
        out: cfg45Out,
        graph: 'core',
        model: FAKE_CHECKPOINT,
        checkpointSha256: SHA,
        seed: 17,
        growPx,
        steps: CORE_DEFAULTS.steps,
        cfg: 4.5,
        prompt: undefined,
        negative: undefined,
        wait: 0.01,
        timeout: 1,
      },
      () => {},
    );
  } finally {
    cfg45Box.stop();
  }
  const cfg45Prompt = cfg45Box.prompts[0] as Record<string, { class_type?: string; inputs?: Record<string, unknown> }> | undefined;
  check(
    'CFG_FRACTIONAL_RUNBACKGROUND_REACHES_KSAMPLER_AND_RECEIPT',
    cfg45Prompt?.['7']?.inputs?.cfg === 4.5 &&
      (cfg45Receipt.params as { cfg?: unknown }).cfg === 4.5 &&
      verifyPlateReceipt(join(cfg45Out, 'receipt.json')).length === 0,
    `ksampler.cfg=${String(cfg45Prompt?.['7']?.inputs?.cfg)}, receipt.params.cfg=${String((cfg45Receipt.params as { cfg?: unknown }).cfg)}`,
  );

  // 2. No `--cfg` is byte-identical to today (`CORE_DEFAULTS.cfg` = 6) across KSampler, receipt, uploads, and outputs, and matches explicit `--cfg 6`.
  const defaultOut = join(work, 'out-default-cli');
  const defaultBox = startFakeComfy('ok');
  let defaultCliRes: { code: number; out: string };
  try {
    defaultCliRes = await cli([
      'comfy', 'plate', '--mode', 'background', '--painting', painting,
      '--mask-from', `figure-mask:${rigDir}`, '--out', defaultOut,
      '--graph', 'core', '--model', FAKE_CHECKPOINT, '--checkpoint-sha256', SHA,
      '--seed', '17', '--grow', String(growPx), '--host', defaultBox.url, '--poll', '0.001',
    ]);
  } finally {
    defaultBox.stop();
  }
  const explicit6Out = join(work, 'out-explicit6-cli');
  const explicit6Box = startFakeComfy('ok');
  let explicit6CliRes: { code: number; out: string };
  try {
    explicit6CliRes = await cli([
      'comfy', 'plate', '--mode', 'background', '--painting', painting,
      '--mask-from', `figure-mask:${rigDir}`, '--out', explicit6Out,
      '--graph', 'core', '--model', FAKE_CHECKPOINT, '--checkpoint-sha256', SHA,
      '--seed', '17', '--grow', String(growPx), '--cfg', '6', '--host', explicit6Box.url, '--poll', '0.001',
    ]);
  } finally {
    explicit6Box.stop();
  }
  const uploadEntries = [...defaultBox.uploads.entries()];
  const uploadedPaintingName = uploadEntries.find(([k]) => k.endsWith('_painting.png'))?.[0] ?? '';
  const uploadedPaintingBytes = uploadEntries.find(([k]) => k.endsWith('_painting.png'))?.[1];
  const uploadedMaskName = uploadEntries.find(([k]) => k.endsWith('_mask.png'))?.[0] ?? '';
  const uploadedMaskBytes = uploadEntries.find(([k]) => k.endsWith('_mask.png'))?.[1];
  const prefix = uploadedPaintingName.replace(/_painting\.png$/, '');
  const expectedGraph = corePlateGraph(
    uploadedPaintingName,
    uploadedMaskName,
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
    prefix,
  );
  const expectedInpainted = newRaster(w, h);
  for (let p = 0; p < w * h; p++) expectedInpainted.data.set([...FAKE_FILL, 255], p * 4);
  const expectedPlateBytes = encodePngBytes(pasteInside(raster, expectedInpainted, grownMask));
  const expectedMaskBytes = encodePngBytes(maskImage(grownMask));
  const expectedReceiptText = `${JSON.stringify(
    {
      spec: 'rig-parts-plate-receipt/1',
      mode: 'background',
      painting: { path: '../ongrid-8x8.png', sha256: sha256(bytes) },
      mask: { source: 'figure-mask', from: '../src-on-8x8/rig', path: 'mask.png', sha256: sha256(expectedMaskBytes) },
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
      output: { path: 'plate.png', sha256: sha256(expectedPlateBytes) },
    },
    null,
    2,
  )}\n`;
  const explicit6UploadedPaintingName = [...explicit6Box.uploads.entries()].find(([k]) => k.endsWith('_painting.png'))?.[0] ?? '';
  const explicit6UploadedMaskName = [...explicit6Box.uploads.entries()].find(([k]) => k.endsWith('_mask.png'))?.[0] ?? '';
  const explicit6Prefix = explicit6UploadedPaintingName.replace(/_painting\.png$/, '');
  const expectedExplicit6Graph = corePlateGraph(
    explicit6UploadedPaintingName,
    explicit6UploadedMaskName,
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
    explicit6Prefix,
  );
  const defaultReceiptText = readFileSync(join(defaultOut, 'receipt.json'), 'utf8');
  const explicit6ReceiptText = readFileSync(join(explicit6Out, 'receipt.json'), 'utf8');
  const defaultReceiptObj = JSON.parse(defaultReceiptText) as PlateReceipt;
  check(
    'DEFAULT_OMITTED_CFG_IS_BYTE_IDENTICAL_TO_TODAY_AND_EXPLICIT_6',
    defaultCliRes.code === 0 &&
      explicit6CliRes.code === 0 &&
      CORE_DEFAULTS.cfg === 6.0 &&
      Object.keys(defaultReceiptObj).join(',') === PLATE_RECEIPT_KEYS.join(',') &&
      defaultReceiptText === expectedReceiptText &&
      explicit6ReceiptText === expectedReceiptText &&
      uploadedPaintingBytes !== undefined &&
      sha256(uploadedPaintingBytes) === sha256(bytes) &&
      uploadedMaskBytes !== undefined &&
      sha256(uploadedMaskBytes) === sha256(expectedMaskBytes) &&
      JSON.stringify(defaultBox.prompts[0]) === JSON.stringify(expectedGraph) &&
      JSON.stringify(explicit6Box.prompts[0]) === JSON.stringify(expectedExplicit6Graph) &&
      sha256(readFileSync(join(defaultOut, 'plate.png'))) === sha256(expectedPlateBytes) &&
      sha256(readFileSync(join(explicit6Out, 'plate.png'))) === sha256(expectedPlateBytes) &&
      sha256(readFileSync(join(defaultOut, 'mask.png'))) === sha256(expectedMaskBytes) &&
      verifyPlateReceipt(join(defaultOut, 'receipt.json')).length === 0,
    `defaultExit=${defaultCliRes.code}, explicit6Exit=${explicit6CliRes.code}, receiptExact=${defaultReceiptText === expectedReceiptText}, explicit6Exact=${explicit6ReceiptText === expectedReceiptText}, graphExact=${JSON.stringify(defaultBox.prompts[0]) === JSON.stringify(expectedGraph)}`,
  );

  // 3. Invalid `--cfg` values (`0`, `-1`, `-0.5`, `abc`, `NaN`, `Infinity`, `-Infinity`, `""`, `"   "`) are refused by `PLATE_CORE_CFG` before the box is reached.
  const invalidCliValues = ['0', '-1', '-0.5', 'abc', 'NaN', 'Infinity', '-Infinity', '', '   '];
  for (const [idx, bad] of invalidCliValues.entries()) {
    const badOut = join(work, `out-bad-cli-${idx}`);
    const badBox = startFakeComfy('ok');
    let res: { code: number; out: string };
    try {
      res = await cli([
        'comfy', 'plate', '--mode', 'background', '--painting', painting,
        '--mask-from', `figure-mask:${rigDir}`, '--out', badOut,
        '--graph', 'core', '--model', FAKE_CHECKPOINT, '--checkpoint-sha256', SHA,
        '--cfg', bad, '--host', badBox.url, '--poll', '0.001',
      ]);
    } finally {
      badBox.stop();
    }
    const label = bad === '' ? 'EMPTY' : bad.trim() === '' ? 'WHITESPACE' : bad.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
    check(
      `INVALID_CFG_CLI_${label}_REFUSED_BEFORE_BOX`,
      res.code === 1 &&
        res.out.includes('FAIL  PLATE_CORE_CFG:') &&
        badBox.requests.length === 0 &&
        badBox.uploads.size === 0 &&
        badBox.prompts.length === 0 &&
        !existsSync(badOut),
      `val=${JSON.stringify(bad)}, exit=${res.code}, requests=${badBox.requests.length}, uploads=${badBox.uploads.size}, prompts=${badBox.prompts.length}, out=${res.out.trim()}`,
    );
  }

  // Also test invalid `--cfg` values handed to `runBackground` directly (numeric and string) before the box is reached.
  const invalidApiValues: Array<[string, number | string]> = [
    ['ZERO_NUM', 0],
    ['NEG_ONE_NUM', -1],
    ['NAN_NUM', Number.NaN],
    ['POS_INF_NUM', Number.POSITIVE_INFINITY],
    ['NEG_INF_NUM', Number.NEGATIVE_INFINITY],
    ['STRING_ABC', 'abc'],
  ];
  for (const [label, bad] of invalidApiValues) {
    const badOut = join(work, `out-bad-api-${label}`);
    const badBox = startFakeComfy('ok');
    let errMsg = '';
    try {
      const run: BackgroundRun = {
        painting,
        maskFrom: `figure-mask:${rigDir}`,
        out: badOut,
        graph: 'core',
        model: FAKE_CHECKPOINT,
        checkpointSha256: SHA,
        seed: 17,
        growPx,
        steps: CORE_DEFAULTS.steps,
        cfg: bad,
        prompt: undefined,
        negative: undefined,
        wait: 0.01,
        timeout: 1,
      };
      await runBackground(() => new ComfyClient(badBox.url, { poll: 0.001, request: 1 }), run, () => {});
    } catch (err) {
      errMsg = (err as Error).message;
    } finally {
      badBox.stop();
    }
    check(
      `INVALID_CFG_API_${label}_REFUSED_BEFORE_BOX`,
      errMsg.includes('PLATE_CORE_CFG:') &&
        badBox.requests.length === 0 &&
        badBox.uploads.size === 0 &&
        badBox.prompts.length === 0 &&
        !existsSync(badOut),
      `val=${String(bad)}, requests=${badBox.requests.length}, err=${errMsg}`,
    );
  }

  // 4. `--cfg` with `--graph lama` (explicit and default) is refused by `PLATE_CORE_CFG` before the box is reached; `--mode foreground` with `--cfg` is refused by `USAGE`.
  for (const [tag, extraArgs] of [
    ['EXPLICIT_LAMA', ['--graph', 'lama']],
    ['DEFAULT_LAMA', []],
    ['LAMA_WITH_INVALID_CFG', ['--graph', 'lama', '--cfg', '0']],
  ] as const) {
    const lamaOut = join(work, `out-lama-${tag}`);
    const lamaBox = startFakeComfy('ok');
    let res: { code: number; out: string };
    try {
      const args = [
        'comfy', 'plate', '--mode', 'background', '--painting', painting,
        '--mask-from', `figure-mask:${rigDir}`, '--out', lamaOut,
        '--checkpoint-sha256', SHA, '--host', lamaBox.url, '--poll', '0.001',
        ...(tag === 'LAMA_WITH_INVALID_CFG' ? extraArgs : [...extraArgs, '--cfg', '3']),
      ];
      res = await cli(args);
    } finally {
      lamaBox.stop();
    }
    check(
      `CFG_ON_${tag}_CLI_REFUSED_AS_PLATE_CORE_CFG_BEFORE_BOX`,
      res.code === 1 &&
        res.out.includes('FAIL  PLATE_CORE_CFG:') &&
        res.out.includes('is for --graph core; the lama graph takes no CFG parameter') &&
        lamaBox.requests.length === 0 &&
        lamaBox.uploads.size === 0 &&
        lamaBox.prompts.length === 0 &&
        !existsSync(lamaOut),
      `exit=${res.code}, requests=${lamaBox.requests.length}, out=${res.out.trim()}`,
    );
  }

  const lamaApiOut = join(work, 'out-lama-api');
  const lamaApiBox = startFakeComfy('ok');
  let lamaApiErr = '';
  try {
    await runBackground(
      () => new ComfyClient(lamaApiBox.url, { poll: 0.001, request: 1 }),
      {
        painting,
        maskFrom: `figure-mask:${rigDir}`,
        out: lamaApiOut,
        graph: 'lama',
        model: undefined,
        checkpointSha256: SHA,
        seed: 17,
        growPx,
        steps: CORE_DEFAULTS.steps,
        cfg: 3,
        prompt: undefined,
        negative: undefined,
        wait: 0.01,
        timeout: 1,
      },
      () => {},
    );
  } catch (err) {
    lamaApiErr = (err as Error).message;
  } finally {
    lamaApiBox.stop();
  }
  check(
    'CFG_ON_LAMA_API_REFUSED_AS_PLATE_CORE_CFG_BEFORE_BOX',
    lamaApiErr.includes('PLATE_CORE_CFG:') &&
      lamaApiErr.includes('is for --graph core; the lama graph takes no CFG parameter') &&
      lamaApiBox.requests.length === 0 &&
      lamaApiBox.uploads.size === 0 &&
      lamaApiBox.prompts.length === 0 &&
      !existsSync(lamaApiOut),
    `requests=${lamaApiBox.requests.length}, err=${lamaApiErr}`,
  );

  const fgOut = join(work, 'out-fg-cfg');
  const fgRes = await cli([
    'comfy', 'plate', '--mode', 'foreground', '--painting', painting,
    '--mask-from', `figure-mask:${rigDir}`, '--out', fgOut, '--cfg', '3',
  ]);
  check(
    'CFG_ON_FOREGROUND_REFUSED_AS_USAGE',
    fgRes.code === 2 &&
      fgRes.out.includes('FAIL  USAGE: comfy plate --mode foreground runs no box and no model; --cfg is for --mode background') &&
      !existsSync(fgOut),
    `exit=${fgRes.code}, out=${fgRes.out.trim()}`,
  );

  // 5. `--denoise` is NOT exposed and is refused as an unknown flag (`USAGE`), and `coreCfg` helper unit checks hold.
  const denoiseOut = join(work, 'out-denoise');
  const denoiseRes = await cli([
    'comfy', 'plate', '--mode', 'background', '--painting', painting,
    '--mask-from', `figure-mask:${rigDir}`, '--out', denoiseOut,
    '--graph', 'core', '--model', FAKE_CHECKPOINT, '--checkpoint-sha256', SHA, '--denoise', '0.8',
  ]);
  check(
    'DENOISE_FLAG_NOT_EXPOSED_REFUSED_AS_USAGE',
    denoiseRes.code === 2 &&
      denoiseRes.out.includes('FAIL  USAGE: comfy plate does not take "--denoise"') &&
      CORE_DEFAULTS.denoise === 1.0 &&
      !existsSync(denoiseOut) &&
      coreCfg(undefined, 'core') === 6.0 &&
      coreCfg(undefined, 'lama') === 6.0 &&
      coreCfg('3.5', 'core') === 3.5 &&
      coreCfg(2, 'core') === 2,
    `exit=${denoiseRes.code}, out=${denoiseRes.out.trim()}`,
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
    tally.of('core-cfg', () => {
      console.log('\n── core-cfg: KSampler cfg, receipt params and fake box ──');
      let failures = 0;
      const say = (name: string, ok: boolean, detail: string, why: string): void => {
        failures += reportMeasuredCase(name, ok, detail, why);
      };
      for (const test of cases) say(test.name, test.ok, test.detail, 'issue #1216: comfy plate --graph core --cfg through production writer, reader and CLI');
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
  console.log(`core-cfg controls ${tally.total}, failures ${tally.failures}, tally faults ${faults.length}`);
  process.exitCode = tally.failures || faults.length ? 1 : 0;
} finally {
  rmSync(work, { recursive: true, force: true });
}
