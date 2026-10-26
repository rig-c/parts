/**
 * A fake ComfyUI on 127.0.0.1, for the adapter's controls. No test touches a
 * real box: the selftest only ever hands the adapter this server's URL.
 *
 * It answers the seven routes the adapter calls — `/system_stats`, `/queue`,
 * `/object_info`, `/upload/image`, `/prompt`, `/history/<id>`, `/view` — the
 * way a box running the See-through wrapper does, as far as the adapter reads
 * them: a graph holding `SeeThrough_SavePSD` "writes" the fixture's layer PNGs
 * and a wrapper manifest carrying the graph's own prefix, records the
 * manifest's name in `seethrough_psd_info.log`, and reports two preview
 * images to `/history`; a graph holding `SaveImage` alone saves one painting
 * at twice the `EmptyLatentImage` size.
 *
 * ⚠️ Its `/object_info` is written out by hand from what a real box listed for
 * these classes (required and optional input names, and the enum choices this
 * fixture needs), NOT derived from the graphs the adapter builds: a spec made
 * from the adapter's own graphs would agree with them by construction, and
 * the check it serves would be checking itself.
 *
 * A `mode` plants one fault: a queue that never empties, a history entry with
 * no outputs, a box without the See-through node classes, or a stale
 * `seethrough_psd_info.log` naming another run's manifest.
 */
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { CANVAS, layerRaster, WRAPPER_LAYERS } from './synthetic.ts';

export type FakeMode = 'ok' | 'busy' | 'no-outputs' | 'no-seethrough' | 'stale-manifest' | 'missing-depth';

/** The checkpoint and LoRA names the fake box lists. */
export const FAKE_CHECKPOINT = 'fixture_base.safetensors';
export const FAKE_LORA = 'fixture_style.safetensors';

export interface FakeRequest {
  method: string;
  path: string;
}

export interface FakeComfy {
  /** Exact /view filenames, including failed reads, for activation controls. */
  views: string[];
  url: string;
  requests: FakeRequest[];
  uploads: Map<string, Uint8Array>;
  prompts: unknown[];
  /** Files the fake "wrote" to its output directory, by name. */
  files: Map<string, Uint8Array>;
  stop(): void;
}

const spec = (required: Record<string, unknown>, optional: Record<string, unknown> = {}): unknown => ({ input: { required, optional } });
const T = (t: string): unknown[] => [t, {}];
const E = (choices: string[]): unknown[] => [choices, {}];

const SEETHROUGH_INFO: Record<string, unknown> = {
  SeeThrough_LoadLayerDiffModel: spec(
    { model: E(['layerdifforg/seethroughv0.0.2_layerdiff3d']) },
    { vae_ckpt: T('STRING'), unet_ckpt: T('STRING'), quant_mode: E(['none', 'nf4']), cache_tag_embeds: T('BOOLEAN'), group_offload: T('BOOLEAN'), auto_download: T('BOOLEAN') },
  ),
  SeeThrough_GenerateLayers: spec({ image: T('IMAGE'), layerdiff_model: T('SEETHROUGH_LAYERDIFF_MODEL'), seed: T('INT'), resolution: T('INT'), num_inference_steps: T('INT') }),
  SeeThrough_LoadDepthModel: spec(
    { model: E(['layerdifforg/seethroughv0.0.1_marigold']) },
    { quant_mode: E(['none', 'nf4']), cache_tag_embeds: T('BOOLEAN'), group_offload: T('BOOLEAN'), auto_download: T('BOOLEAN') },
  ),
  SeeThrough_GenerateDepth: spec({ layers: T('SEETHROUGH_LAYERS'), depth_model: T('SEETHROUGH_DEPTH_MODEL'), seed: T('INT') }, { resolution_depth: T('INT') }),
  SeeThrough_PostProcess: spec({ layers_depth: T('SEETHROUGH_LAYERS_DEPTH'), tblr_split: T('BOOLEAN'), use_lama: T('BOOLEAN') }),
  SeeThrough_SavePSD: spec({ parts: T('SEETHROUGH_PARTS'), filename_prefix: T('STRING') }),
};

const CORE_INFO: Record<string, unknown> = {
  LoadImage: spec({ image: E(['already_on_the_box.png']) }),
  SaveImage: { input: { required: { images: T('IMAGE'), filename_prefix: T('STRING') }, hidden: { prompt: 'PROMPT', extra_pnginfo: 'EXTRA_PNGINFO' } } },
  CheckpointLoaderSimple: spec({ ckpt_name: E([FAKE_CHECKPOINT]) }),
  EmptyLatentImage: spec({ width: T('INT'), height: T('INT'), batch_size: T('INT') }),
  CLIPTextEncode: spec({ text: T('STRING'), clip: T('CLIP') }),
  KSampler: spec({
    model: T('MODEL'), seed: T('INT'), steps: T('INT'), cfg: T('FLOAT'), sampler_name: E(['euler_ancestral']), scheduler: E(['normal']),
    positive: T('CONDITIONING'), negative: T('CONDITIONING'), latent_image: T('LATENT'), denoise: T('FLOAT'),
  }),
  VAEDecode: spec({ samples: T('LATENT'), vae: T('VAE') }),
  // the newer COMBO spelling, as a real box lists this one
  UpscaleModelLoader: spec({ model_name: ['COMBO', { options: ['4x-AnimeSharp.pth'] }] }),
  ImageUpscaleWithModel: spec({ upscale_model: T('UPSCALE_MODEL'), image: T('IMAGE') }),
  ImageScaleBy: spec({ image: T('IMAGE'), upscale_method: E(['nearest-exact', 'lanczos']), scale_by: T('FLOAT') }),
  LoraLoader: spec({ model: T('MODEL'), clip: T('CLIP'), lora_name: E([FAKE_LORA]), strength_model: T('FLOAT'), strength_clip: T('FLOAT') }),
  ControlNetLoader: spec({ control_net_name: E(['controlnet-openpose-sdxl-1.0.safetensors']) }),
  ControlNetApplyAdvanced: spec(
    { positive: T('CONDITIONING'), negative: T('CONDITIONING'), control_net: T('CONTROL_NET'), image: T('IMAGE'), strength: T('FLOAT'), start_percent: T('FLOAT'), end_percent: T('FLOAT') },
    { vae: T('VAE') },
  ),
};

/** The painting the fake saves: a flat block, so a test can compare its bytes. */
export function fakePainting(w: number, h: number): Raster {
  const r = newRaster(w, h);
  for (let i = 0; i < w * h; i++) r.data.set([250, 248, 246, 255], i * 4);
  return r;
}

type Node = { class_type: string; inputs: Record<string, unknown> };

export function startFakeComfy(mode: FakeMode): FakeComfy {
  const views: string[] = [];
  const requests: FakeRequest[] = [];
  const uploads = new Map<string, Uint8Array>();
  const prompts: unknown[] = [];
  const files = new Map<string, Uint8Array>();
  const history = new Map<string, unknown>();
  let serial = 0;
  const json = (v: unknown, status = 200): Response => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });

  const run = (graph: Record<string, Node>): Record<string, unknown> => {
    const nodes = Object.entries(graph);
    const save = nodes.find(([, n]) => n.class_type === 'SeeThrough_SavePSD');
    const outputs: Record<string, unknown> = {};
    if (save !== undefined) {
      const prefix = String(save[1].inputs.filename_prefix);
      const stamp = `00000000_000000_${String(serial).padStart(8, '0')}`;
      const layers = WRAPPER_LAYERS.map((l) => {
        const filename = `${prefix}_${stamp}_${l.name}.png`;
        files.set(filename, encodePngBytes(layerRaster(l)));
        // Hand-analytic mock writer: opaque scalar data, independently encoded
        // from the fixture's declared median. No image estimation is involved.
        const depth = newRaster(l.width, l.height), level = Math.floor(l.depth * 255 + 0.5);
        for (let i = 0; i < l.width * l.height; i++) depth.data.set([level, level, level, 255], i * 4);
        if (mode !== 'missing-depth') files.set(`${prefix}_${stamp}_${l.name}_depth.png`, encodePngBytes(depth));

        return { name: l.name, filename, left: l.left, top: l.top, right: l.left + l.width, bottom: l.top + l.height, depth_median: l.depth, depth_filename: `${prefix}_${stamp}_${l.name}_depth.png` };
      });
      const manifestName = `${prefix}_${stamp}_layers.json`;
      files.set(manifestName, new TextEncoder().encode(JSON.stringify({ prefix, timestamp: stamp, layers, width: CANVAS.w, height: CANVAS.h }, null, 2)));
      if (mode === 'stale-manifest') {
        files.set('an_earlier_run_layers.json', new TextEncoder().encode(JSON.stringify({ prefix: 'an_earlier_run', timestamp: stamp, layers, width: CANVAS.w, height: CANVAS.h })));
        files.set('seethrough_psd_info.log', new TextEncoder().encode('an_earlier_run_layers.json\n'));
      } else files.set('seethrough_psd_info.log', new TextEncoder().encode(`${manifestName}\n`));
    }
    for (const [id, n] of nodes) {
      if (n.class_type !== 'SaveImage') continue;
      const name = `${String(n.inputs.filename_prefix)}_00001_.png`;
      const latent = nodes.find(([, x]) => x.class_type === 'EmptyLatentImage')?.[1];
      const img = latent !== undefined ? fakePainting(2 * Number(latent.inputs.width), 2 * Number(latent.inputs.height)) : fakePainting(4, 4);
      files.set(name, encodePngBytes(img));
      outputs[id] = { images: [{ filename: name, subfolder: '', type: 'output' }] };
    }
    return outputs;
  };

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      requests.push({ method: req.method, path: u.pathname });
      if (u.pathname === '/system_stats') return json({ system: { comfyui_version: 'fake' }, devices: [{ name: 'cuda:0 Fake GPU', vram_free: 8 * 1024 ** 3 }] });
      if (u.pathname === '/queue') {
        return json(mode === 'busy' ? { queue_running: [[0, 'someone-else']], queue_pending: [] } : { queue_running: [], queue_pending: [] });
      }
      if (u.pathname === '/object_info') return json(mode === 'no-seethrough' ? CORE_INFO : { ...CORE_INFO, ...SEETHROUGH_INFO });
      if (u.pathname === '/upload/image' && req.method === 'POST') {
        const form = await req.formData();
        const file = form.get('image');
        if (!(file instanceof File)) return json({ error: 'no image field' }, 400);
        uploads.set(file.name, new Uint8Array(await file.arrayBuffer()));
        return json({ name: file.name, subfolder: '', type: 'input' });
      }
      if (u.pathname === '/prompt' && req.method === 'POST') {
        const body = (await req.json()) as { prompt: Record<string, Node> };
        prompts.push(body.prompt);
        const id = `fake-${++serial}`;
        const outputs = run(body.prompt);
        history.set(id, { outputs: mode === 'no-outputs' ? {} : outputs, status: { status_str: 'success', completed: true, messages: [] } });
        return json({ prompt_id: id, number: serial, node_errors: {} });
      }
      const h = /^\/history\/(.+)$/.exec(u.pathname);
      if (h !== null) {
        const id = decodeURIComponent(h[1]);
        return json(history.has(id) ? { [id]: history.get(id) } : {});
      }
      if (u.pathname === '/view') {
        views.push(u.searchParams.get('filename') ?? '');
        const bytes = files.get(u.searchParams.get('filename') ?? '');
        return bytes === undefined ? new Response('not found', { status: 404 }) : new Response(bytes);
      }
      return new Response('not found', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, views, requests, uploads, prompts, files, stop: () => server.stop(true) };
}
