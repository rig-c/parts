/** Optional GPU matte adapter. Local validation precedes host resolution. */
import { refuseIfAny } from '../errors.ts';
import { checkGraph } from '../graphs.ts';
import { assertMatteOutFree, matteGraph, matteGraphHash, matteParams, matteSelection, MATTE_GRAPH_ID, MATTE_MODEL, MATTE_MODEL_FILE, MATTE_NODE, publishMatte, type MatteReceipt } from '../matte.ts';
import { declaredChecksum, readPlatePainting, sha256 } from '../plate.ts';
import { encodePngBytes } from '../raster/png.ts';
import { prepareSeeThroughInput } from '../seethrough-transform.ts';
import { ComfyClient, historyImages, refuse } from './client.ts';
import { gpuName } from './plate.ts';

export interface MatteRun {
  painting: string;
  out: string;
  node: string | undefined;
  model: string | undefined;
  checkpointSha256: string | undefined;
  resolution: number;
  threshold: number;
  wait: number;
  timeout: number;
}
export async function runMatte(connect: () => ComfyClient, run: MatteRun, say: (line: string) => void): Promise<MatteReceipt> {
  matteSelection(run.node, run.model);
  const params = matteParams(run.resolution, run.threshold);
  const checkpoint = declaredChecksum(run.checkpointSha256);
  const painting = readPlatePainting(run.painting);
  assertMatteOutFree(run.out);
  const prepared = prepareSeeThroughInput(painting.raster, run.resolution);
  const input = prepared.transform === undefined ? painting.bytes : encodePngBytes(prepared.image);
  const client = connect();
  const gpu = gpuName(await client.systemStats(), client.host);
  const prefix = `rig_parts_matte_${crypto.randomUUID().slice(0, 8)}`;
  const info = await client.objectInfo();
  refuseIfAny(checkGraph(matteGraph(`${prefix}.png`, prefix), info, client.host, new Set(['1.image'])));
  const files = await client.modelFiles('RMBG');
  if (!files.some(f => f.replaceAll('\\', '/') === MATTE_MODEL_FILE)) refuse('MATTE_MODEL_INSTALLED', MATTE_MODEL_FILE, 'is absent from /models/RMBG; a selector entry alone does not establish installed weights, and automatic download is not permitted');
  const image = await client.uploadImage(input, `${prefix}.png`);
  const graph = matteGraph(image, prefix);
  const id = await client.submit(graph, 'rig-parts');
  say(`  appended matte prompt ${id} behind all queued jobs`);
  const { entry } = await client.waitBehind(id, run.wait, run.timeout, say);
  const outputs = historyImages(entry);
  if (outputs.length !== 1) refuse('COMFY_HISTORY_OUTPUTS', `matte prompt ${id}`, `lists ${outputs.length} images; exactly one saved model mask is required`);
  const output = outputs[0];
  const raw = await client.view(output.filename, output.subfolder, output.type);
  return publishMatte(run.out, run.painting, painting.bytes, raw, {
    model: { node: MATTE_NODE, name: MATTE_MODEL, checkpoint_sha256: checkpoint, checkpoint_sha256_from: 'declared' },
    params, graph: { id: MATTE_GRAPH_ID, api: graph, sha256: matteGraphHash(graph) }, gpu,
    input_transform: prepared.transform ?? null, input_sha256: sha256(input),
  });
}
