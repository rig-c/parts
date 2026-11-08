/**
 * `comfy plate --mode background`: the figure-removed background plate of a
 * painting, inpainted on a ComfyUI box over a source mask (issue #1183).
 *
 * The route, in order, each step refusing by name:
 *
 * 1. the source mask is read (`src/plate.ts`); with none, the run is refused
 *    before anything is written and before the host is reached;
 * 2. the declared checkpoint sha256 and, for `core`, the checkpoint name are
 *    checked;
 * 3. the box answers `/system_stats` and names its GPU;
 * 4. every node, input and model of the chosen graph is on the box's
 *    `/object_info` (`checkGraph`) — a box without the inpaint pack is refused
 *    here for `lama`, before anything is uploaded;
 * 5. the painting and the grown mask (for off-grid `core`, padded to the next
 *    multiple of 8 on the right and bottom with `grid_transform` recorded) are
 *    uploaded and the graph is appended
 *    to the queue: behind every other job, never in front, nothing reordered
 *    and nothing cancelled; a wait past `--wait` while pending is refused
 *    naming the job's place (`COMFY_QUEUE_BEHIND`);
 * 6. the box's image is read back, required at the uploaded size (then cropped
 *    at `[0, 0]` back to the painting's size for off-grid `core`), pasted
 *    into the painting inside the mask only, and written with its receipt
 *    through `publishPlate` (staged, read back, then moved).
 */
import { refuseIfAny } from '../errors.ts';
import { checkGraph, type Graph } from '../graphs.ts';
import {
  assertPlateOutFree,
  CORE_DEFAULTS,
  type CoreParams,
  corePlateGraph,
  cropCoreGrid,
  declaredChecksum,
  type FigureMask,
  growMask,
  type LamaParams,
  LAMA_MODEL,
  lamaPlateGraph,
  maskImage,
  parseMaskFrom,
  pasteInside,
  PLATE_GRAPH_IDS,
  type PlateGraph,
  type PlateReceipt,
  prepareCoreGrid,
  publishPlate,
  readPlatePainting,
  readSourceMask,
} from '../plate.ts';
import { OPAQUE_ALPHA_ABOVE } from '../layers.ts';
import { decodePngBytes, encodePngBytes } from '../raster/png.ts';
import { ComfyClient, historyImages, refuse } from './client.ts';

export interface BackgroundRun {
  painting: string;
  maskFrom: string | undefined;
  out: string;
  graph: PlateGraph;
  /** The model file the graph loads: the LaMa model for `lama`, the checkpoint for `core`. */
  model: string | undefined;
  checkpointSha256: string | undefined;
  seed: number;
  growPx: number;
  steps: number;
  prompt: string | undefined;
  negative: string | undefined;
  wait: number;
  timeout: number;
}

/** The GPU the box runs on, as `/system_stats` names its torch device. */
export function gpuName(stats: Record<string, unknown>, host: string): string {
  const devices = Array.isArray(stats.devices) ? stats.devices : [];
  const names = devices.map((d) => (typeof d === 'object' && d !== null ? (d as Record<string, unknown>).name : undefined)).filter((n): n is string => typeof n === 'string' && n !== '');
  if (names.length !== 1) {
    refuse('COMFY_GPU_NAMED', `GET ${host}/system_stats`, `names ${names.length} device(s); exactly one is required, because the receipt records the GPU (the same seed gives other pixels on another GPU)`);
  }
  return names[0];
}

/** `connect` is called only after every local check has passed, so a refused run never resolves a host or reaches a box. */
export async function runBackground(connect: () => ComfyClient, run: BackgroundRun, say: (line: string) => void): Promise<PlateReceipt> {
  // Local first: no source mask, a bad checksum or a missing checkpoint is refused before the box is reached.
  const from = parseMaskFrom(run.maskFrom);
  const painting = readPlatePainting(run.painting);
  const { width: W, height: H } = painting.raster;
  const source: FigureMask = readSourceMask(from.source, from.dir, W, H, painting.raster, painting.bytes);
  const checkpoint = declaredChecksum(run.checkpointSha256);
  if (run.graph === 'core' && run.model === undefined) {
    refuse('PLATE_MODEL_GIVEN', '--model', 'is absent; the core graph needs the checkpoint the box loads, by its name on the box — there is no default checkpoint');
  }
  assertPlateOutFree(run.out);
  const mask = growMask(source, run.growPx);
  const prepared = run.graph === 'core' ? prepareCoreGrid(painting.raster, mask) : { painting: painting.raster, mask };
  const uploadPaintingBytes = prepared.transform === undefined ? painting.bytes : encodePngBytes(prepared.painting);
  const uploadMaskBytes = encodePngBytes(maskImage(prepared.mask));
  const model = run.model ?? LAMA_MODEL;
  const lama: LamaParams = { seed: run.seed, grow_px: run.growPx };
  const core: CoreParams = { seed: run.seed, grow_px: run.growPx, steps: run.steps, cfg: CORE_DEFAULTS.cfg, sampler: CORE_DEFAULTS.sampler, scheduler: CORE_DEFAULTS.scheduler, denoise: CORE_DEFAULTS.denoise, prompt: run.prompt ?? CORE_DEFAULTS.prompt, negative: run.negative ?? CORE_DEFAULTS.negative };
  const prefix = `rig_parts_plate_${crypto.randomUUID().slice(0, 8)}`;
  const build = (p: string, m: string): Graph => (run.graph === 'lama' ? lamaPlateGraph(p, m, model, lama, prefix) : corePlateGraph(p, m, model, core, prefix));

  const client = connect();
  const gpu = gpuName(await client.systemStats(), client.host);
  const info = await client.objectInfo();
  refuseIfAny(checkGraph(build(`${prefix}_painting.png`, `${prefix}_mask.png`), info, client.host, new Set(['1.image', '2.image'])));
  say(`  box: every node, input and model of the ${run.graph} graph is on its /object_info; GPU ${gpu}`);

  const paintingRef = await client.uploadImage(uploadPaintingBytes, `${prefix}_painting.png`);
  const maskRef = await client.uploadImage(uploadMaskBytes, `${prefix}_mask.png`);
  say(`  uploaded ${run.painting} (${prepared.painting.width}x${prepared.painting.height}) and its mask (${mask.inside.reduce((a, b) => a + b, 0)} px, grown ${run.growPx} px)`);
  const id = await client.submit(build(paintingRef, maskRef), 'rig-parts');
  say(`  appended prompt ${id} to the queue (behind any other job; nothing reordered or cancelled)`);
  const { entry, elapsed } = await client.waitBehind(id, run.wait, run.timeout, say);
  say(`  GPU job finished ${elapsed.toFixed(1)} s after it was queued`);
  const images = historyImages(entry);
  if (images.length !== 1) refuse('COMFY_HISTORY_OUTPUTS', `prompt ${id}`, `lists ${images.length} image(s); the graph's one SaveImage is required to have saved exactly one`);
  const got = decodePngBytes(await client.view(images[0].filename, images[0].subfolder, images[0].type), images[0].filename);
  const [expectedW, expectedH] = prepared.transform === undefined ? [W, H] : prepared.transform.padded;
  if (got.width !== expectedW || got.height !== expectedH) {
    refuse(
      'COMFY_PLATE_SIZE',
      `prompt ${id} ${images[0].filename}`,
      `is ${got.width}x${got.height}; ${prepared.transform === undefined ? `the painting's ${W}x${H}` : `the padded core grid ${expectedW}x${expectedH} (for painting ${W}x${H})`} is required — the plate is pasted into the painting pixel for pixel, never resized`,
    );
  }
  const inpainted = prepared.transform === undefined ? got : cropCoreGrid(got, prepared.transform);

  return publishPlate({
    out: run.out,
    stageTag: prefix,
    mode: 'background',
    paintingPath: run.painting,
    paintingBytes: painting.bytes,
    source: from.source,
    sourceDir: from.dir,
    mask,
    plate: pasteInside(painting.raster, inpainted, mask),
    model: { name: model, checkpoint_sha256: checkpoint, checkpoint_sha256_from: 'declared' },
    params: run.graph === 'lama' ? { ...lama, mask_alpha_above: OPAQUE_ALPHA_ABOVE } : { ...core, mask_alpha_above: OPAQUE_ALPHA_ABOVE },
    graph: PLATE_GRAPH_IDS[run.graph],
    gpu,
    gridTransform: prepared.transform,
  });
}
