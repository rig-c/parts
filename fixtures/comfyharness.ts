#!/usr/bin/env bun
/**
 * Drives `rig-parts comfy` against the fake ComfyUI of `fakecomfy.ts`, one
 * scenario per fake, and prints what happened as one JSON object. The selftest
 * runs this as a child process and judges the result: the selftest itself is
 * synchronous, and a server has to be answering while the CLI runs, so both
 * live here, the CLI spawned without blocking the server's event loop.
 *
 *   bun fixtures/comfyharness.ts <work dir>
 *
 * Every host handed to the CLI is this process's own 127.0.0.1 server (or,
 * for the unreachable case, a port that server just released), and
 * `COMFY_HOST` is removed from the child's environment, so no scenario can
 * reach a real box.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePngBytes } from '../src/raster/png.ts';
import { FAKE_CHECKPOINT, FAKE_LORA, type FakeMode, startFakeComfy } from './fakecomfy.ts';
import { newRaster } from '../src/raster/types.ts';
import { writeRunStamp } from '../src/runstamp.ts';
import { sha256 } from '../src/plate.ts';
import { CANVAS, layerRaster, minimalConfig, WRAPPER_LAYERS } from './synthetic.ts';

const ROOT = join(import.meta.dir, '..');
const work = process.argv[2];
if (work === undefined) {
  console.error('usage: bun fixtures/comfyharness.ts <work dir>');
  process.exit(2);
}
mkdirSync(work, { recursive: true });

/** The generation block of the paint scenarios; `latent` is tiny so the skeleton and the fake painting are too. */
function paintConfig(checkpoint: string): Record<string, unknown> {
  return {
    ...minimalConfig(),
    generation: {
      checkpoint,
      loras: [{ name: FAKE_LORA, strength: 0.6 }],
      trigger: '',
      identity: '1girl, solo, adult woman, short black hair',
      sampler: { steps: 4, cfg: 6.0, sampler: 'euler_ancestral', scheduler: 'normal' },
      costume: 'grey coat, symmetrical composition, black boots',
      negative_extra: '2girls',
      style: 'anime illustration, (white background:1.3)',
      negative_pose: 'cropped, out of frame',
      latent: [16, 24],
      seed: 5,
      control: { skeleton: 'stand_clasp', strength: 0.8, end_percent: 0.7 },
    },
  };
}

/**
 * A config as it stands before anything else exists: `key` and `generation`,
 * no See-through block, no rig. `comfy paint` reads it through the early door;
 * its seed differs from `paintConfig`'s so the request can only have carried it
 * from this file.
 */
function paintOnlyConfig(): Record<string, unknown> {
  const g = paintConfig(FAKE_CHECKPOINT).generation as Record<string, unknown>;
  return { key: 'paint_only', generation: { ...g, seed: 11 } };
}

/**
 * `paintOnlyConfig` with what nothing may read written into it (issue #70):
 * an annotation, a `<name>_note` and an `x-` record inside
 * `generation.sampler`, records in `generation`, in `generation.control` and
 * in a LoRA, and records at the top level — an object, an array, a number and
 * null. `edit` then changes the generation block, for the planted negative and
 * for the sampler written in another key order.
 */
function paintRecordsConfig(edit: (g: Record<string, unknown>) => void = () => {}): Record<string, unknown> {
  const base = paintOnlyConfig();
  const g = base.generation as Record<string, unknown>;
  const generation: Record<string, unknown> = {
    ...g,
    sampler: { ...(g.sampler as Record<string, unknown>), note: 'four steps is enough for a flat fixture', steps_note: 'a remark on one field', 'x-tried': [{ steps: 8, why: 'no visible gain' }] },
    loras: (g.loras as Array<Record<string, unknown>>).map((l) => ({ ...l, 'x-source': { licence: 'fixture' } })),
    control: { ...(g.control as Record<string, unknown>), 'x-why': 'hands in front' },
    seed_note: 'seed 11 picked by eye',
    'x-seeds_tried': [{ seed: 3, why: 'two figures' }, { seed: 7, why: 'cropped feet' }],
    'x-attempts': 2,
  };
  edit(generation);
  return { ...base, generation, 'x-status': { gate: 'green', build: '0.9.0' }, 'x-count': 3, 'x-empty': null, 'x-list': ['a', 1, null] };
}

const image = join(work, 'input.png');
writeFileSync(image, encodePngBytes(layerRaster(WRAPPER_LAYERS[0])));
writeFileSync(join(work, 'paint.json'), JSON.stringify(paintConfig(FAKE_CHECKPOINT)));
writeFileSync(join(work, 'paint_missing_ckpt.json'), JSON.stringify(paintConfig('not_on_the_box.safetensors')));
writeFileSync(join(work, 'paint_only.json'), JSON.stringify(paintOnlyConfig()));
writeFileSync(join(work, 'paint_no_generation.json'), JSON.stringify({ key: 'paint_only' }));
writeFileSync(join(work, 'paint_records.json'), JSON.stringify(paintRecordsConfig()));
writeFileSync(join(work, 'paint_records_plant.json'), JSON.stringify(paintRecordsConfig((g) => { (g.sampler as Record<string, unknown>).cfg = 6.5; })));
writeFileSync(
  join(work, 'paint_reordered.json'),
  JSON.stringify((() => {
    const c = paintOnlyConfig();
    const g = c.generation as Record<string, unknown>;
    const s = g.sampler as Record<string, unknown>;
    return { ...c, generation: { ...g, sampler: { scheduler: s.scheduler, sampler: s.sampler, cfg: s.cfg, steps: s.steps } } };
  })()),
);

// Issue #860: use the existing early config door, without a finished rig.
for (const [name, seethrough] of Object.entries({
  high: { resolution: 1024, steps: 30, seed: 43, offload: true },
  low: { resolution: 64, steps: 1, seed: 0, offload: false },
  resolution1: { resolution: 1, steps: 1, seed: 0, offload: false },
  resolution63: { resolution: 63, steps: 1, seed: 0, offload: false },
  invalid: { resolution: 1024, steps: 30, seed: -1, offload: true },
})) writeFileSync(join(work, `st-${name}.json`), JSON.stringify({ key: 'fixture', seethrough, assemble: { rig_scale: 1 } }));

writeFileSync(join(work, 'config.json'), readFileSync(join(work, 'st-high.json')));

// Issue #1183: the plate's inputs. A painting on the See-through fixture's canvas whose every pixel differs from
// its neighbours, an assemble-shaped figure-mask source, and a directory holding no source at all.
const platePainting = join(work, 'plate_painting.png');
{
  const r = newRaster(CANVAS.w, CANVAS.h);
  for (let y = 0; y < CANVAS.h; y++) for (let x = 0; x < CANVAS.w; x++) r.data.set([(x * 3 + y) % 250, (y * 5) % 250, (x + y * 2) % 250, 255], (y * CANVAS.w + x) * 4);
  writeFileSync(platePainting, encodePngBytes(r));
}
const figureMaskRoot = join(work, 'plate_figure_source');
const figureMaskDir = join(figureMaskRoot, 'rig');
mkdirSync(figureMaskDir, { recursive: true });
{
  const r = newRaster(CANVAS.w, CANVAS.h);
  let px = 0;
  for (let y = 0; y < CANVAS.h; y++) for (let x = 0; x < CANVAS.w; x++) {
    const v = x >= 20 && x < 40 && y >= 10 && y < 40 ? 255 : 0;
    if (v === 255) px++;
    r.data.set([v, v, v, 255], (y * CANVAS.w + x) * 4);
  }
  writeFileSync(join(figureMaskDir, 'figure_rig.png'), encodePngBytes(r));
  const painting = readFileSync(platePainting);
  writeFileSync(join(figureMaskDir, 'painting_in_rig.png'), painting);
  writeFileSync(join(figureMaskDir, 'parts.json'), JSON.stringify({
    painting_in_rig: { path: 'painting_in_rig.png', sha256: sha256(painting), resample: 'lanczos3-rgb-opaque' },
    scene: { figure_alpha_above: 8, figure_px: px, figure_mask: 'figure_rig.png' },
  }));
  writeRunStamp({ pkg: { name: '@rig-c/parts', version: '0.0.0' }, command: 'assemble',
    startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:00.000Z',
    outDir: figureMaskRoot, configPath: join(work, 'config.json'),
    outputPaths: ['rig/parts.json', 'rig/figure_rig.png', 'rig/painting_in_rig.png'] });
}
const noSourceDir = join(work, 'plate_no_source');
mkdirSync(noSourceDir, { recursive: true });
const unstampedRoot = join(work, 'plate_unstamped_source');
const staleRoot = join(work, 'plate_stale_source');
cpSync(figureMaskRoot, unstampedRoot, { recursive: true });
rmSync(join(unstampedRoot, 'run.json'));
cpSync(figureMaskRoot, staleRoot, { recursive: true });
writeFileSync(join(staleRoot, 'rig', 'figure_rig.png'), readFileSync(platePainting));
const otherPainting = join(work, 'plate_other_painting.png');
{
  const r = newRaster(CANVAS.w, CANVAS.h);
  r.data.fill(255);
  writeFileSync(otherPainting, encodePngBytes(r));
}
/** A declared checksum: any 64 hex characters, since the box is never asked. */
const PLATE_SHA = 'ab'.repeat(32);

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (k !== 'COMFY_HOST' && v !== undefined) env[k] = v;

async function cli(args: string[]): Promise<{ status: number; out: string }> {
  const p = Bun.spawn(['bun', join(ROOT, 'cli.ts'), ...args], { cwd: work, env, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { status: await p.exited, out: out + err };
}

interface Scenario {
  name: string;
  mode: FakeMode;
  args: (url: string, out: string) => string[];
}

const fast = ['--timeout', '5', '--poll', '0.05'];
const st = (url: string, out: string, wait = '2'): string[] => [
  'comfy', 'seethrough', '--image', image, '--out', out, '--host', url, '--resolution', '512', '--steps', '3', '--seed', '7', '--offload', '--wait', wait, ...fast,
];
/** A background plate run; `mask` null leaves --mask-from out, `sha` null leaves --checkpoint-sha256 out. */
const plate = (url: string, out: string, graph: 'lama' | 'core', mask: string | null = `seethrough:${join(work, 'st-ok')}`, extra: string[] = [], wait = '2', sha: string | null = PLATE_SHA): string[] => [
  'comfy', 'plate', '--mode', 'background', '--painting', platePainting, ...(mask === null ? [] : ['--mask-from', mask]), '--out', out, '--graph', graph,
  ...(sha === null ? [] : ['--checkpoint-sha256', sha]), '--seed', '9', '--grow', '1', '--host', url, '--wait', wait, ...fast, ...extra,
];
const scenarios: Scenario[] = [
  { name: 'st-ok', mode: 'ok', args: (u, o) => st(u, o) },
  // The guide supplies image/out/host only: a config beside the command is not discovered.
  { name: 'st-guide', mode: 'ok', args: (u, o) => ['comfy', 'seethrough', '--image', image, '--out', o, '--host', u] },
  { name: 'st-config', mode: 'ok', args: (u, o) => ['comfy', 'seethrough', '--image', image, '--out', o, '--host', u, '--config', join(work, 'st-high.json')] },
  { name: 'st-config1', mode: 'ok', args: (u, o) => ['comfy', 'seethrough', '--image', image, '--out', o, '--host', u, '--config', join(work, 'st-resolution1.json')] },
  { name: 'st-config63', mode: 'ok', args: (u, o) => ['comfy', 'seethrough', '--image', image, '--out', o, '--host', u, '--config', join(work, 'st-resolution63.json')] },
  { name: 'st-config1-cli64', mode: 'ok', args: (u, o) => ['comfy', 'seethrough', '--image', image, '--out', o, '--host', u, '--config', join(work, 'st-resolution1.json'), '--resolution', '64'] },
  { name: 'st-cli-resolution1', mode: 'ok', args: (u, o) => ['comfy', 'seethrough', '--image', image, '--out', o, '--host', u, '--resolution', '1'] },
  { name: 'st-mixed', mode: 'ok', args: (u, o) => ['comfy', 'seethrough', '--image', image, '--out', o, '--host', u, '--config', join(work, 'st-high.json'), '--seed', '0'] },
  { name: 'st-config-low', mode: 'ok', args: (u, o) => ['comfy', 'seethrough', '--image', image, '--out', o, '--host', u, '--config', join(work, 'st-low.json')] },
  { name: 'st-flags-low', mode: 'ok', args: (u, o) => ['comfy', 'seethrough', '--image', image, '--out', o, '--host', u, '--config', join(work, 'st-high.json'), '--resolution', '64', '--steps', '1', '--seed', '0', '--no-offload'] },
  { name: 'st-flags-high', mode: 'ok', args: (u, o) => [...st(u, o), '--config', join(work, 'st-low.json')] },
  { name: 'st-conflicting-offload', mode: 'ok', args: (u, o) => [...st(u, o), '--no-offload'] },
  { name: 'st-invalid-config', mode: 'ok', args: (u, o) => [...st(u, o), '--config', join(work, 'st-invalid.json')] },
  { name: 'st-invalid-seed', mode: 'ok', args: (u, o) => ['comfy', 'seethrough', '--image', image, '--out', o, '--host', u, '--config', join(work, 'st-high.json'), '--seed', '-1'] },
  { name: 'st-busy', mode: 'busy', args: (u, o) => st(u, o, '0.3') },
  { name: 'st-no-outputs', mode: 'no-outputs', args: (u, o) => st(u, o) },
  { name: 'st-no-seethrough', mode: 'no-seethrough', args: (u, o) => st(u, o) },
  { name: 'st-stale', mode: 'stale-manifest', args: (u, o) => st(u, o) },
  { name: 'paint-ok', mode: 'ok', args: (u, o) => ['comfy', 'paint', '--config', join(work, 'paint.json'), '--out', o, '--host', u, '--seeds', '2', '--wait', '2', ...fast] },
  { name: 'paint-only', mode: 'ok', args: (u, o) => ['comfy', 'paint', '--config', join(work, 'paint_only.json'), '--out', o, '--host', u, '--wait', '2', ...fast] },
  { name: 'paint-records', mode: 'ok', args: (u, o) => ['comfy', 'paint', '--config', join(work, 'paint_records.json'), '--out', o, '--host', u, '--wait', '2', ...fast] },
  { name: 'paint-records-plant', mode: 'ok', args: (u, o) => ['comfy', 'paint', '--config', join(work, 'paint_records_plant.json'), '--out', o, '--host', u, '--wait', '2', ...fast] },
  { name: 'paint-reordered', mode: 'ok', args: (u, o) => ['comfy', 'paint', '--config', join(work, 'paint_reordered.json'), '--out', o, '--host', u, '--wait', '2', ...fast] },
  { name: 'paint-no-generation', mode: 'ok', args: (u, o) => ['comfy', 'paint', '--config', join(work, 'paint_no_generation.json'), '--out', o, '--host', u, '--wait', '2', ...fast] },
  { name: 'paint-missing-ckpt', mode: 'ok', args: (u, o) => ['comfy', 'paint', '--config', join(work, 'paint_missing_ckpt.json'), '--out', o, '--host', u, '--wait', '2', ...fast] },
  // Issue #1183. st-ok runs first, so its wrapper output is the See-through source mask.
  { name: 'plate-lama-ok', mode: 'ok', args: (u, o) => plate(u, o, 'lama') },
  { name: 'plate-core-ok', mode: 'ok', args: (u, o) => plate(u, o, 'core', `figure-mask:${figureMaskDir}`, ['--model', FAKE_CHECKPOINT]) },
  { name: 'plate-busy', mode: 'busy', args: (u, o) => plate(u, o, 'lama') },
  { name: 'plate-behind', mode: 'behind', args: (u, o) => plate(u, o, 'lama', undefined, [], '0.3') },
  { name: 'plate-no-inpaint-lama', mode: 'no-inpaint', args: (u, o) => plate(u, o, 'lama') },
  { name: 'plate-no-inpaint-core', mode: 'no-inpaint', args: (u, o) => plate(u, o, 'core', undefined, ['--model', FAKE_CHECKPOINT]) },
  { name: 'plate-missing-model', mode: 'ok', args: (u, o) => plate(u, o, 'lama', undefined, ['--model', 'not_on_the_box.pt']) },
  { name: 'plate-no-mask', mode: 'ok', args: (u, o) => plate(u, o, 'lama', null) },
  { name: 'plate-no-source', mode: 'ok', args: (u, o) => plate(u, o, 'lama', `seethrough:${noSourceDir}`) },
  { name: 'plate-no-scene', mode: 'ok', args: (u, o) => plate(u, o, 'lama', `figure-mask:${noSourceDir}`) },
  { name: 'plate-bad-sha', mode: 'ok', args: (u, o) => plate(u, o, 'lama', undefined, [], '2', 'not-a-hash') },
  { name: 'plate-no-sha', mode: 'ok', args: (u, o) => plate(u, o, 'lama', undefined, [], '2', null) },
  { name: 'plate-fg', mode: 'ok', args: (u, o) => ['comfy', 'plate', '--mode', 'foreground', '--painting', platePainting, '--mask-from', `figure-mask:${figureMaskDir}`, '--out', o] },
  { name: 'plate-fg-no-mask', mode: 'ok', args: (u, o) => ['comfy', 'plate', '--mode', 'foreground', '--painting', platePainting, '--out', o] },
  { name: 'plate-unstamped', mode: 'ok', args: (u, o) => plate(u, o, 'lama', `figure-mask:${join(unstampedRoot, 'rig')}`) },
  { name: 'plate-stale-mask', mode: 'ok', args: (u, o) => plate(u, o, 'lama', `figure-mask:${join(staleRoot, 'rig')}`) },
  { name: 'plate-other-painting', mode: 'ok', args: (u, o) => {
    const args = plate(u, o, 'lama', `figure-mask:${figureMaskDir}`);
    args[args.indexOf('--painting') + 1] = otherPainting;
    return args;
  } },
];

const results: Record<string, unknown> = {};
for (const s of scenarios) {
  const fake = startFakeComfy(s.mode);
  const out = join(work, s.name);
  try {
    const r = await cli(s.args(fake.url, out));
    const uploads = join(work, `${s.name}.uploads`);
    mkdirSync(uploads, { recursive: true });
    for (const [name, bytes] of fake.uploads) writeFileSync(join(uploads, name), bytes);
    writeFileSync(join(work, `${s.name}.prompts.json`), JSON.stringify(fake.prompts, null, 1));
    results[s.name] = { status: r.status, out: r.out, paths: fake.requests.map((q) => `${q.method} ${q.path}`), uploads: [...fake.uploads.keys()], prompts: fake.prompts.length, fronts: fake.fronts };
  } finally {
    fake.stop();
  }
}

// a port that was answering a moment ago and is not now
const gone = startFakeComfy('ok');
const goneUrl = gone.url;
gone.stop();
const r = await cli(st(goneUrl, join(work, 'st-unreachable')));
results['st-unreachable'] = { status: r.status, out: r.out, paths: [], uploads: [], prompts: 0 };

console.log(JSON.stringify({ image, platePainting, results }));
