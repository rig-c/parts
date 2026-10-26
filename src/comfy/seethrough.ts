/**
 * One See-through run on a ComfyUI box, into a directory in the wrapper form
 * `src/layers.ts` reads: `layers.json` (the wrapper's manifest, the bytes the
 * box wrote), `parts/<tag>.png` (one RGBA PNG per layer), `meta.json` (this
 * run's record) and `previews/` (the two preview sheets the graph saves).
 *
 * The route, in order, each step refusing by name:
 *
 * 1. the box answers `/system_stats`;
 * 2. every node and input of `workflows/seethrough.json` is on the box's
 *    `/object_info` (`checkGraph`) — the wrapper not installed is refused
 *    here, before anything is uploaded;
 * 3. the queue is empty within `--wait` (this never queues behind someone
 *    else's job);
 * 4. the image is uploaded to the box's input directory and the graph queued;
 * 5. `/history/<id>` holds the job within `--timeout`, not in error, with
 *    outputs;
 * 6. the manifest is found the way the wrapper leaves it: SavePSD writes the
 *    layer PNGs and the manifest into the output directory but reports only
 *    the previews to `/history`, and records the manifest's file name in
 *    `output/seethrough_psd_info.log`. That log is overwritten by every run, so
 *    the manifest it names must carry THIS run's prefix — a prefix with a
 *    random suffix per run — or it is refused as another run's;
 * 7. everything is written into a staging directory beside `--out`, read back
 *    through `readWrapperLayers`, and only then moved to `--out`. Emit only
 *    after green: a directory the layer reader would refuse is never left at
 *    the path the next stage reads.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { refuseIfAny } from '../errors.ts';
import { checkGraph, fillSeeThrough, type SeeThroughParams } from '../graphs.ts';
import { readWrapperLayers } from '../layers.ts';
import type { DepthBinding } from '../depthsheets.ts';
import { decodePngBytes } from '../raster/png.ts';
import { ComfyClient, historyImages, refuse } from './client.ts';

export const SEETHROUGH_WORKFLOW = new URL('../../workflows/seethrough.json', import.meta.url);
export const PSD_INFO_LOG = 'seethrough_psd_info.log';

export interface SeeThroughRun {
  image: string;
  out: string;
  /** The prefix before the per-run suffix. */
  prefix: string;
  resolution: number;
  steps: number;
  seed: number;
  offload: boolean;
  lama: boolean;
  quant: 'none' | 'nf4';
  wait: number;
  timeout: number;
  /** Explicit config/run context; absent means legacy art-only capture. */
  depth?: DepthBinding;
}

export interface SeeThroughResult {
  promptId: string;
  prefix: string;
  elapsed: number;
  layers: string[];
  canvas: [number, number];
  previews: string[];
}

/** An out directory that is absent or empty; anything else is refused, because mixing two runs' layers is a set nobody can read. */
export function assertOutFree(out: string): void {
  if (existsSync(out) && readdirSync(out).length > 0) {
    refuse('COMFY_OUT_EMPTY', out, `holds ${readdirSync(out).length} entr(ies); an absent or empty directory is required, so one run's layers are never mixed with another's`);
  }
}

function safeName(name: string): boolean {
  return name !== '' && !name.startsWith('.') && !/[\\/]/.test(name);
}

export async function runSeeThrough(client: ComfyClient, run: SeeThroughRun, say: (line: string) => void): Promise<SeeThroughResult> {
  const depth = run.depth?.config === undefined ? undefined : run.depth;
  if (!existsSync(run.image)) refuse('COMFY_IMAGE_PRESENT', run.image, 'no such file; the PNG See-through is to decompose is required');
  const bytes = new Uint8Array(readFileSync(run.image));
  const img = decodePngBytes(bytes, run.image);
  assertOutFree(run.out);

  await client.systemStats();
  const prefix = `${run.prefix}_${crypto.randomUUID().slice(0, 8)}`;
  const uploadName = `${prefix}_input.png`;
  const template: unknown = JSON.parse(readFileSync(SEETHROUGH_WORKFLOW, 'utf8'));
  const params: SeeThroughParams = { image: uploadName, seed: run.seed, resolution: run.resolution, steps: run.steps, quant: run.quant, offload: run.offload, lama: run.lama, prefix };
  const info = await client.objectInfo();
  refuseIfAny(checkGraph(fillSeeThrough(template, params), info, client.host, new Set(['1.image'])));
  say(`  box: every node and input of workflows/seethrough.json is on its /object_info`);

  const waited = await client.waitQueueEmpty(run.wait, say);
  say(`  queue empty${waited > 0.05 ? ` after ${waited.toFixed(1)} s` : ''}`);
  const ref = await client.uploadImage(bytes, uploadName);
  say(`  uploaded ${run.image} (${img.width}x${img.height}) as input/${ref}`);
  const graph = fillSeeThrough(template, { ...params, image: ref });
  const vramBefore = await client.vramFree();
  const id = await client.submit(graph, 'rig-parts');
  say(`  queued prompt ${id} (prefix ${prefix}); GPU job started`);
  const { entry, vramLow, elapsed } = await client.waitHistory(id, run.timeout);
  say(`  GPU job finished in ${elapsed.toFixed(1)} s`);
  const previews = historyImages(entry);
  if (previews.length === 0) {
    refuse('COMFY_HISTORY_OUTPUTS', `prompt ${id}`, `lists outputs from node(s) ${Object.keys(entry.outputs).join(', ')} and no image; the graph's two preview SaveImage nodes are required to have saved`);
  }

  const infoLog = new TextDecoder().decode(await client.view(PSD_INFO_LOG)).trim();
  if (infoLog === '' || /[\\/]/.test(infoLog)) {
    refuse('COMFY_MANIFEST_NAMED', `output/${PSD_INFO_LOG}`, `holds ${JSON.stringify(infoLog.slice(0, 200))}; the file name of the manifest SavePSD wrote is required`);
  }
  const manifestBytes = await client.view(infoLog);
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Record<string, unknown>;
  } catch (err) {
    return refuse('COMFY_MANIFEST_NAMED', `output/${infoLog}`, `does not parse as JSON (${(err as Error).message})`);
  }
  if (manifest.prefix !== prefix) {
    refuse(
      'COMFY_MANIFEST_IS_THIS_RUN',
      `output/${infoLog}`,
      `carries prefix ${JSON.stringify(manifest.prefix)}; this run's prefix ${JSON.stringify(prefix)} is required — ${PSD_INFO_LOG} names the last manifest any run wrote, and this one is not ours`,
    );
  }
  const layers = Array.isArray(manifest.layers) ? (manifest.layers as Array<Record<string, unknown>>) : [];
  if (layers.length === 0) refuse('COMFY_MANIFEST_NAMED', `output/${infoLog}`, 'lists no layers; a See-through run writes one per tag');
  const bad = layers.filter((l) => typeof l.name !== 'string' || !safeName(l.name) || typeof l.filename !== 'string' || !safeName(l.filename) || (depth !== undefined && 'depth_filename' in l && (typeof l.depth_filename !== 'string' || !safeName(l.depth_filename))));
  if (bad.length > 0) {
    refuse('COMFY_LAYER_NAME', `output/${infoLog}`, `names ${bad.length} layer(s) whose name or filename is not a plain file name (first ${JSON.stringify(bad[0]).slice(0, 200)}); each becomes parts/<name>.png`);
  }

  const parent = dirname(run.out);
  mkdirSync(parent, { recursive: true });
  const stage = join(parent, `.${basename(run.out)}.partial-${prefix}`);
  mkdirSync(join(stage, 'parts'), { recursive: true });
  mkdirSync(join(stage, 'previews'), { recursive: true });
  try {
    for (const p of previews) writeFileSync(join(stage, 'previews', basename(p.filename)), await client.view(p.filename, p.subfolder, p.type));
    for (const l of layers) writeFileSync(join(stage, 'parts', `${l.name as string}.png`), await client.view(l.filename as string));
    if (depth !== undefined) for (const l of layers) if ('depth_filename' in l) writeFileSync(join(stage, 'parts', `${l.name as string}_depth.png`), await client.view(l.depth_filename as string));
    writeFileSync(join(stage, 'layers.json'), manifestBytes);
    const set = readWrapperLayers(stage, depth);
    const meta = {
      prompt_id: id,
      image: run.image,
      elapsed_s: Math.round(elapsed * 10) / 10,
      vram_free_before_gb: vramBefore,
      vram_free_low_gb: vramLow,
      prefix,
      seed: run.seed,
      resolution: run.resolution,
      steps: run.steps,
      quant: run.quant,
      offload: run.offload,
      lama: run.lama,
      layer_count: layers.length,
      layer_names: layers.map((l) => l.name as string),
      canvas: [set.canvas.w, set.canvas.h],
    };
    writeFileSync(join(stage, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
    if (existsSync(run.out)) rmdirSync(run.out);
    renameSync(stage, run.out);
    return {
      promptId: id,
      prefix,
      elapsed,
      layers: layers.map((l) => l.name as string),
      canvas: [set.canvas.w, set.canvas.h],
      previews: previews.map((p) => basename(p.filename)),
    };
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  }
}
