/** Loopback-only matte box. Its schema is transcribed independently of the graph builder. */
import type { Graph } from '../src/graphs.ts';
import { decodePngBytes, encodePngBytes } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';

export type MatteFakeMode = 'ok' | 'half' | 'missing-model' | 'bad-model-list' | 'missing-node' | 'wrong-size' | 'empty' | 'color' | 'no-output' | 'error' | 'behind';
const INFO = {
  LoadImage: { input: { required: { image: ['STRING'] } } },
  BiRefNetRMBG: { input: {
    required: { image: ['IMAGE'], model: [['BiRefNet-HR-matting']] },
    optional: { mask_blur: ['INT'], mask_offset: ['INT'], invert_output: ['BOOLEAN'], refine_foreground: ['BOOLEAN'], background: [['Alpha', 'Color']], background_color: ['STRING'] },
  } },
  MaskToImage: { input: { required: { mask: ['MASK'] } } },
  SaveImage: { input: { required: { images: ['IMAGE'], filename_prefix: ['STRING'] } } },
};
export function fakeMatte(mode: MatteFakeMode = 'ok') {
  const paths: string[] = [];
  const uploads: Uint8Array[] = [];
  const prompts: Array<{ prompt: Graph; front?: unknown; number?: unknown }> = [];
  let output: Uint8Array = new Uint8Array();
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      paths.push(`${request.method} ${url.pathname}`);
      if (url.pathname === '/system_stats') return Response.json({ devices: [{ name: 'synthetic GPU', vram_free: 1024 }] });
      if (url.pathname === '/object_info') {
        const info = { ...INFO };
        if (mode === 'missing-node') Reflect.deleteProperty(info, 'BiRefNetRMBG');
        return Response.json(info);
      }
      if (url.pathname === '/models/RMBG') return Response.json(mode === 'missing-model' ? [] : mode === 'bad-model-list' ? null : ['BiRefNet\\BiRefNet-HR-matting.safetensors']);
      if (url.pathname === '/upload/image') {
        const form = await request.formData();
        const file = form.get('image');
        if (!(file instanceof Blob)) return new Response('missing image', { status: 400 });
        uploads.push(new Uint8Array(await file.arrayBuffer()));
        return Response.json({ name: 'uploaded.png', subfolder: '' });
      }
      if (url.pathname === '/prompt') {
        prompts.push(await request.json() as (typeof prompts)[number]);
        const source = decodePngBytes(uploads[0], 'uploaded.png');
        const width = mode === 'wrong-size' ? source.width + 1 : source.width;
        const raster = newRaster(width, source.height);
        // Four hand-computable columns repeat: threshold equality, just above,
        // zero and full foreground. The model itself is not simulated.
        for (let p = 0; p < width * source.height; p++) {
          const value = mode === 'empty' ? 0 : mode === 'half' ? (p % width < width / 2 ? 255 : 0) : [10, 11, 0, 255][p % width % 4];
          raster.data.set([value, mode === 'color' ? value ^ 1 : value, value, 255], p * 4);
        }
        output = encodePngBytes(raster);
        return Response.json({ prompt_id: 'synthetic-prompt' });
      }
      if (url.pathname === '/queue') return Response.json({ queue_running: [], queue_pending: mode === 'behind' ? [[0, 'other'], [1, 'synthetic-prompt']] : [] });
      if (url.pathname === '/history/synthetic-prompt') return Response.json({ 'synthetic-prompt': {
        status: { completed: true, status_str: mode === 'error' ? 'error' : 'success' },
        outputs: mode === 'no-output' ? {} : { '4': { images: [{ filename: 'model-mask.png', subfolder: '', type: 'output' }] } },
      } });
      if (url.pathname === '/view') return new Response(output, { headers: { 'Content-Type': 'image/png' } });
      return new Response('unexpected request', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, paths, uploads, prompts, stop: () => server.stop(true) };
}
