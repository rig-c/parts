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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePngBytes } from '../src/raster/png.ts';
import { FAKE_CHECKPOINT, FAKE_LORA, type FakeMode, startFakeComfy } from './fakecomfy.ts';
import { layerRaster, minimalConfig, WRAPPER_LAYERS } from './synthetic.ts';

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
    results[s.name] = { status: r.status, out: r.out, paths: fake.requests.map((q) => `${q.method} ${q.path}`), uploads: [...fake.uploads.keys()], prompts: fake.prompts.length };
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

console.log(JSON.stringify({ image, results }));
