import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FAKE_CHECKPOINT, FAKE_LAMA, FAKE_LORA } from '../fixtures/fakecomfy.ts';
import { CANVAS, layerRaster, WRAPPER_LAYERS } from '../fixtures/synthetic.ts';
import { ComfyClient } from '../src/comfy/client.ts';
import { runSeeThrough, SEETHROUGH_WORKFLOW } from '../src/comfy/seethrough.ts';
import { failLine, PartsError } from '../src/errors.ts';
import { checkGraph, fillSeeThrough } from '../src/graphs.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';

const spec = (required: Record<string, unknown>, optional: Record<string, unknown> = {}): unknown => ({ input: { required, optional } });
const T = (t: string): unknown[] => [t, {}];
const E = (choices: string[]): unknown[] => [choices, {}];

const HEALTHY_OBJECT_INFO: Record<string, unknown> = {
  LoadImage: spec({ image: E(['already_on_the_box.png']) }),
  LoadImageMask: spec({ image: E(['already_on_the_box.png']), channel: E(['alpha', 'red', 'green', 'blue']) }),
  JoinImageWithAlpha: spec({ image: T('IMAGE'), alpha: T('MASK') }),
  SaveImage: { input: { required: { images: T('IMAGE'), filename_prefix: T('STRING') }, hidden: { prompt: 'PROMPT', extra_pnginfo: 'EXTRA_PNGINFO' } } },
  CheckpointLoaderSimple: spec({ ckpt_name: E([FAKE_CHECKPOINT]) }),
  LoraLoader: spec({ model: T('MODEL'), clip: T('CLIP'), lora_name: E([FAKE_LORA]), strength_model: T('FLOAT'), strength_clip: T('FLOAT') }),
  INPAINT_LoadInpaintModel: spec({ model_name: E([FAKE_LAMA]) }),
  INPAINT_InpaintWithModel: spec({ inpaint_model: T('INPAINT_MODEL'), image: T('IMAGE'), mask: T('MASK'), seed: T('INT') }, { optional_upscale_model: T('UPSCALE_MODEL') }),
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

const UNIT_MS = 10;
const delay = (nominalSeconds: number): Promise<void> => new Promise((r) => setTimeout(r, nominalSeconds * UNIT_MS));
const jsonResponse = (v: unknown, status = 200): Response =>
  new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });

function catchPartsError(fn: () => Promise<unknown>): Promise<PartsError | null> {
  return fn().then(
    () => null,
    (err: unknown) => {
      if (err instanceof PartsError) return err;
      throw err;
    },
  );
}

describe('ComfyClient timeout and poll resilience (#1232)', () => {
  test('Bar 1: /object_info answering in 35 s and 45 s (above the 30 s request cap) passes under --wait 120 and refuses under --wait 20', async () => {
    let objectInfoDelaySeconds = 35;
    const files = new Map<string, Uint8Array>();
    const history = new Map<string, unknown>();
    let serial = 0;

    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === '/system_stats') {
          return jsonResponse({ system: { comfyui_version: 'stub' }, devices: [{ name: 'cuda:0 Stub GPU', vram_free: 8 * 1024 ** 3 }] });
        }
        if (u.pathname === '/object_info') {
          await delay(objectInfoDelaySeconds);
          return jsonResponse(HEALTHY_OBJECT_INFO);
        }
        if (u.pathname === '/upload/image' && req.method === 'POST') {
          const form = await req.formData();
          const file = form.get('image');
          const name = file instanceof File ? file.name : 'uploaded.png';
          return jsonResponse({ name, subfolder: '', type: 'input' });
        }
        if (u.pathname === '/prompt' && req.method === 'POST') {
          const body = (await req.json()) as { prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }> };
          const id = `prompt-${++serial}`;
          const save = Object.entries(body.prompt).find(([, n]) => n.class_type === 'SeeThrough_SavePSD');
          const prefix = String(save?.[1].inputs.filename_prefix ?? 'spine_parts');
          const stamp = `00000000_000000_${String(serial).padStart(8, '0')}`;
          const topShift = (CANVAS.w - CANVAS.h) / 2;
          const layers = WRAPPER_LAYERS.map((l) => {
            const filename = `${prefix}_${stamp}_${l.name}.png`;
            files.set(filename, encodePngBytes(layerRaster(l)));
            return { name: l.name, filename, left: l.left, top: l.top + topShift, right: l.left + l.width, bottom: l.top + topShift + l.height, depth_median: l.depth };
          });
          const manifestName = `${prefix}_${stamp}_layers.json`;
          files.set(manifestName, new TextEncoder().encode(JSON.stringify({ prefix, timestamp: stamp, layers, width: CANVAS.w, height: CANVAS.w }, null, 2)));
          files.set('seethrough_psd_info.log', new TextEncoder().encode(`${manifestName}\n`));
          const preview = encodePngBytes(newRaster(4, 4));
          files.set(`${prefix}_p1.png`, preview);
          files.set(`${prefix}_p2.png`, preview);
          history.set(id, {
            outputs: {
              '8': { images: [{ filename: `${prefix}_p1.png`, subfolder: '', type: 'output' }] },
              '9': { images: [{ filename: `${prefix}_p2.png`, subfolder: '', type: 'output' }] },
            },
            status: { status_str: 'success', completed: true, messages: [] },
          });
          return jsonResponse({ prompt_id: id, number: serial, node_errors: {} });
        }
        if (u.pathname === '/queue') {
          return jsonResponse({ queue_running: [], queue_pending: [] });
        }
        const h = /^\/history\/(.+)$/.exec(u.pathname);
        if (h !== null) {
          const id = decodeURIComponent(h[1]);
          return jsonResponse(history.has(id) ? { [id]: history.get(id) } : {});
        }
        if (u.pathname === '/view') {
          const bytes = files.get(u.searchParams.get('filename') ?? '');
          return bytes === undefined ? new Response('not found', { status: 404 }) : new Response(bytes);
        }
        return new Response('not found', { status: 404 });
      },
    });

    const dir = mkdtempSync(join(tmpdir(), 'comfy-1232-bar1-'));
    try {
      const host = `http://127.0.0.1:${server.port}`;
      const template: unknown = JSON.parse(readFileSync(SEETHROUGH_WORKFLOW, 'utf8'));
      const graph = fillSeeThrough(template, {
        image: 'input.png',
        seed: 42,
        resolution: 512,
        steps: 10,
        quant: 'none',
        offload: true,
        lama: false,
        prefix: 'probe',
      });

      // 1a. 35 s /object_info (above 30 s request cap) passes preflight, checkGraph, and full runSeeThrough.
      objectInfoDelaySeconds = 35;
      const client35 = new ComfyClient(host, { poll: 3, request: 30, wait: 120, unitMs: UNIT_MS });
      const inputPng = join(dir, 'input.png');
      writeFileSync(inputPng, encodePngBytes(newRaster(CANVAS.w, CANVAS.h)));
      const res35 = await runSeeThrough(
        client35,
        {
          image: inputPng,
          out: join(dir, 'out-35'),
          prefix: 'spine_parts',
          resolution: CANVAS.w,
          steps: 3,
          seed: 7,
          offload: true,
          lama: false,
          quant: 'none',
          wait: 120,
          timeout: 120,
        },
        () => {},
      );
      expect(res35.promptId).toBe('prompt-1');
      expect(res35.layers.length).toBe(WRAPPER_LAYERS.length);

      // 1b. 45 s /object_info under --wait 120 proceeds and passes checkGraph.
      objectInfoDelaySeconds = 45;
      const client45Ok = new ComfyClient(host, { poll: 3, request: 30, wait: 120, unitMs: UNIT_MS });
      await client45Ok.systemStats();
      const info45 = await client45Ok.objectInfo(120);
      expect(checkGraph(graph, info45, host, new Set(['1.image']))).toEqual([]);

      // 1c. 45 s /object_info under --wait 20 is refused when the 20 s wait bound expires.
      const client45Short = new ComfyClient(host, { poll: 3, request: 30, wait: 20, unitMs: UNIT_MS });
      await client45Short.systemStats();
      const err20 = await catchPartsError(() => client45Short.objectInfo(20));
      expect(err20).not.toBeNull();
      expect(err20?.problems[0].code).toBe('COMFY_REACHABLE');
      expect(err20?.problems[0].detail).toContain('did not answer within 20 s');
    } finally {
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Bar 2: a closed port is refused COMFY_REACHABLE at once', async () => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        return jsonResponse({});
      },
    });
    const host = `http://127.0.0.1:${server.port}`;
    server.stop(true);

    const client = new ComfyClient(host, { poll: 3, request: 30, wait: 1800 });
    const t0 = performance.now();
    const err = await catchPartsError(() => client.systemStats());
    const elapsedMs = performance.now() - t0;

    expect(err).not.toBeNull();
    expect(err?.problems[0].code).toBe('COMFY_REACHABLE');
    expect(err?.problems[0].object).toBe(`GET ${host}/system_stats`);
    expect(err?.problems[0].detail).toContain('could not be reached');
    expect(elapsedMs).toBeLessThan(1000);
  });

  test('Bar 3: a stub that stalls /queue for 45 s mid-run (past the 30 s request cap) keeps waiting within budget and fetches the result', async () => {
    const promptId = 'queued-job-45s-stall';
    let queueCalls = 0;
    let historyCalls = 0;
    let systemStatsCalls = 0;
    const seenRequests: string[] = [];

    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        const u = new URL(req.url);
        seenRequests.push(`${req.method} ${u.pathname}`);
        if (u.pathname === '/system_stats') {
          systemStatsCalls++;
          // Even if /system_stats stalls during a running VRAM poll, it must not abort the job.
          if (systemStatsCalls === 2) await delay(35);
          return jsonResponse({ devices: [{ name: 'cuda:0 Stub GPU', vram_free: 6 * 1024 ** 3 }] });
        }
        if (u.pathname === '/queue') {
          queueCalls++;
          if (queueCalls === 1) {
            return jsonResponse({ queue_running: [[1, promptId]], queue_pending: [] });
          }
          if (queueCalls === 2) {
            // Stall for 45 nominal seconds (past the 30 s request cap).
            await delay(45);
            return jsonResponse({ queue_running: [[1, promptId]], queue_pending: [] });
          }
          return jsonResponse({ queue_running: [], queue_pending: [] });
        }
        if (u.pathname === `/history/${promptId}`) {
          historyCalls++;
          if (historyCalls === 1) {
            // Also stall the first /history poll past the 30 s request cap.
            await delay(35);
          }
          return jsonResponse({
            [promptId]: {
              outputs: { '9': { images: [{ filename: 'done_00001_.png', subfolder: '', type: 'output' }] } },
              status: { status_str: 'success', completed: true, messages: [] },
            },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });

    try {
      const host = `http://127.0.0.1:${server.port}`;
      const client = new ComfyClient(host, { poll: 3, request: 30, wait: 120, unitMs: UNIT_MS });
      const lines: string[] = [];
      const result = await client.waitBehind(promptId, 120, 180, (l) => lines.push(l));

      expect(result.entry.outputs['9']?.images?.[0]?.filename).toBe('done_00001_.png');
      expect(queueCalls).toBeGreaterThanOrEqual(3);
      expect(historyCalls).toBeGreaterThanOrEqual(2);
      expect(lines).toContain(`  prompt ${promptId} is running`);
      expect(seenRequests.some((r) => r.includes('/interrupt') || r.startsWith('POST /queue') || r.startsWith('POST /prompt'))).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test('Bar 4: when the budget runs out after queueing, the refusal text contains the prompt id and never cancels or reorders', async () => {
    let mode: 'pending-stall' | 'running-stall' | 'history-stall' = 'pending-stall';
    const seenRequests: string[] = [];

    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        const u = new URL(req.url);
        seenRequests.push(`${req.method} ${u.pathname}`);
        if (u.pathname === '/system_stats') {
          return jsonResponse({ devices: [{ name: 'cuda:0 Stub GPU', vram_free: 8 * 1024 ** 3 }] });
        }
        if (u.pathname === '/queue') {
          if (mode === 'pending-stall') {
            await delay(45);
            return jsonResponse({ queue_running: [[0, 'other-job']], queue_pending: [[1, 'prompt-pending-id']] });
          }
          if (mode === 'running-stall') {
            if (seenRequests.filter((r) => r === 'GET /queue').length === 1) {
              return jsonResponse({ queue_running: [[1, 'prompt-running-id']], queue_pending: [] });
            }
            await delay(45);
            return jsonResponse({ queue_running: [[1, 'prompt-running-id']], queue_pending: [] });
          }
          return jsonResponse({ queue_running: [], queue_pending: [] });
        }
        if (u.pathname.startsWith('/history/')) {
          await delay(45);
          return jsonResponse({});
        }
        return new Response('not found', { status: 404 });
      },
    });

    try {
      const host = `http://127.0.0.1:${server.port}`;
      const client = new ComfyClient(host, { poll: 3, request: 30, unitMs: UNIT_MS });

      // 4a. Pending budget (--wait 40) runs out after a timed-out /queue poll -> names prompt id.
      mode = 'pending-stall';
      const errPending = await catchPartsError(() => client.waitBehind('prompt-pending-id', 40, 120, () => {}));
      expect(errPending).not.toBeNull();
      expect(errPending?.problems[0].code).toBe('COMFY_QUEUE_BEHIND');
      const textPending = (errPending?.problems ?? []).map(failLine).join('\n');
      expect(textPending).toContain('prompt prompt-pending-id');
      expect(textPending).toContain('--wait 40 s');

      // 4b. Running budget (--timeout 40) runs out after a timed-out /queue poll -> names prompt id.
      seenRequests.length = 0;
      mode = 'running-stall';
      const errRunning = await catchPartsError(() => client.waitBehind('prompt-running-id', 120, 40, () => {}));
      expect(errRunning).not.toBeNull();
      expect(errRunning?.problems[0].code).toBe('COMFY_HISTORY_WITHIN');
      const textRunning = (errRunning?.problems ?? []).map(failLine).join('\n');
      expect(textRunning).toContain('prompt prompt-running-id');
      expect(textRunning).toContain('--timeout 40 s');

      // 4c. History budget (--timeout 40) runs out after a timed-out /history/<id> poll -> names prompt id.
      seenRequests.length = 0;
      mode = 'history-stall';
      const errHistory = await catchPartsError(() => client.waitBehind('prompt-history-id', 120, 40, () => {}));
      expect(errHistory).not.toBeNull();
      expect(errHistory?.problems[0].code).toBe('COMFY_HISTORY_WITHIN');
      const textHistory = (errHistory?.problems ?? []).map(failLine).join('\n');
      expect(textHistory).toContain('prompt prompt-history-id');
      expect(textHistory).toContain('--timeout 40 s');

      expect(seenRequests.some((r) => r.includes('/interrupt') || r.startsWith('POST /queue') || r.startsWith('POST /prompt'))).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});
