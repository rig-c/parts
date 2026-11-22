/** #1267 controls. `bun tools/check_classified_plate.ts <scratch dir> [--only PB24]`. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ACCESSORY, BODY, FAR_PROP, hash, indices, NEAR_PROP, SIDE, writeClassifiedPlateInputs, writeClassifiedPlateManifest,
} from '../fixtures/classified_plate.ts';
import { FAKE_FILL, FAKE_LAMA } from '../fixtures/fakecomfy.ts';
import { ComfyClient } from '../src/comfy/client.ts';
import { runBackground } from '../src/comfy/plate.ts';
import { readParts } from '../src/parts.ts';
import { DEFAULT_GROW_PX, type PlateReceipt, verifyPlateReceipt } from '../src/plate.ts';
import { decodePngBytes, encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';

const LABELS = [
  'PB23_LEGACY_FIGURE_PLATE_EXPOSES_BOTH_PROPS_AND_THE_UNDRAWN_ACCESSORY',
  'PB24_CLASSIFIED_FOREGROUND_KEEPS_ACCESSORY_AND_EXCLUDES_BOTH_PROPS',
  'PB25_CLASSIFIED_BACKGROUND_CLIPS_GROWN_PROPS_BEFORE_UPLOAD_AND_PASTE',
  'PB26_UNLABELLED_CLASSIFIED_COMPONENTS_NAME_ROLES_IDS_BOXES_AND_COUNTS',
  'PB27_CLASSIFIED_SOURCE_REFUSES_STALE_PART_PNG_BYTES',
  'PB28_CLASSIFIED_HALF_SCALE_USES_PAINTING_GRID_SUPPORT_AND_COMPONENT_IDS',
] as const;
type Label = typeof LABELS[number];
type Verdict = { label: Label; pass: boolean; detail: string };
type Say = (name: string, pass: boolean, detail: string, why: string) => void;
type Components = ReturnType<typeof writeClassifiedPlateInputs>['components'];

const CLI = join(import.meta.dir, '..', 'cli.ts');
const PREFIX = 'pb-classified-';
const BODY_PIXELS = new Set(indices(BODY));
const ACCESSORY_PIXELS = new Set(indices(ACCESSORY));
const NEAR_PIXELS = new Set(indices(NEAR_PROP));
const FAR_PIXELS = new Set(indices(FAR_PROP));
const raw = (p: number): boolean => BODY_PIXELS.has(p) || ACCESSORY_PIXELS.has(p);
const legacy = (p: number): boolean => raw(p) || NEAR_PIXELS.has(p) || FAR_PIXELS.has(p);

function grown(p: number): boolean {
  const x = p % SIDE, y = Math.floor(p / SIDE);
  // The 8px square halo gives body 32x48 + accessory 24x22 - their 24x12 overlap.
  // 3 columns of the near prop across 6 rows intersect this union; the far prop misses it.
  const inBodyHalo = x >= 16 && x < 48 && y >= 14 && y < 62;
  const inAccessoryHalo = x >= 20 && x < 44 && y >= 4 && y < 26;
  return (inBodyHalo || inAccessoryHalo) && !NEAR_PIXELS.has(p) && !FAR_PIXELS.has(p);
}

function cli(dir: string, name: string, args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  writeFileSync(join(dir, `${name}.log`), output);
  if (r.error !== undefined) throw r.error;
  return { exit: r.status, output };
}

function foreground(dir: string, name: string, painting: string, source: string) {
  const out = join(dir, name);
  return { out, ...cli(dir, name, ['comfy', 'plate', '--mode', 'foreground', '--painting', painting, '--mask-from', source, '--out', out]) };
}

function requireExit(run: ReturnType<typeof cli>, exit: number, label: string): void {
  assert.equal(run.exit, exit, `${label} exit ${run.exit} (wanted ${exit}): ${run.output.trim().split('\n').slice(-4).join(' ')}`);
}

function png(file: string): Raster {
  return decodePngBytes(readFileSync(file), file);
}

function checkRaster(image: Raster, expected: (pixel: number) => ArrayLike<number>, label: string): void {
  assert.deepEqual([image.width, image.height], [SIDE, SIDE], `${label} grid`);
  for (let p = 0; p < SIDE * SIDE; p++) {
    const want = expected(p);
    const found = image.data.subarray(p * 4, p * 4 + 4);
    if (!found.every((v, c) => v === want[c])) {
      assert.fail(`${label} at ${p % SIDE},${Math.floor(p / SIDE)}: ${found} (wanted ${Array.from(want)})`);
    }
  }
}

function checkMask(file: string, expected: (p: number) => boolean, totals: number[], props = [NEAR_PIXELS, FAR_PIXELS]): string {
  const raster = png(file);
  const black = [0, 0, 0, 255], white = [255, 255, 255, 255];
  checkRaster(raster, p => expected(p) ? white : black, 'mask');
  const count = (pixels: Iterable<number>): number => Array.from(pixels).filter(p => raster.data[p * 4] === 255).length;
  const observed = [...props.map(count), count(ACCESSORY_PIXELS), count(BODY_PIXELS), count(Array.from({ length: SIDE * SIDE }, (_, p) => p))];
  assert.deepEqual(observed, totals, 'near, far, accessory, body, total mask pixels');
  return `mask px near=${observed[0]} far=${observed[1]} accessory=${observed[2]} body=${observed[3]} total=${observed[4]}`;
}

function receipt(out: string, mode: 'foreground' | 'background', source: 'figure-mask' | 'classified', from: string): PlateReceipt {
  const path = join(out, 'receipt.json');
  assert.deepEqual(verifyPlateReceipt(path), [], 'receipt verification');
  const record = JSON.parse(readFileSync(path, 'utf8')) as PlateReceipt;
  assert.equal(record.mode, mode);
  assert.equal(record.mask.source, source);
  assert.equal(resolve(out, record.mask.from), from);
  return record;
}

function checkClassification(record: PlateReceipt, path: string, components: Components, near: number, far: number): void {
  assert.equal(record.mask_classification?.manifest_sha256, hash(readFileSync(path)), 'manifest byte digest');
  const props = components.filter(c => c.role === 'background-prop');
  const clips = record.mask_classification?.prop_clips;
  assert.deepEqual(new Map(clips?.map(clip => [clip.id, clip.clipped_px])), new Map([[props[0].id, near], [props[1].id, far]]));
  assert.equal(clips?.length, 2, 'one clip count per prop');
}

/** In-process reply and upload capture for the real background producer. */
class PlateBox extends ComfyClient {
  readonly uploads: Uint8Array[] = [];
  constructor() { super('classified-plate-fixture', { poll: 1, request: 1 }); }
  override async systemStats() { return { devices: [{ name: 'classified plate CPU fixture' }] }; }
  override async objectInfo() {
    const node = (required: Record<string, unknown>) => ({ input: { required } });
    return {
      LoadImage: node({ image: [['fixture.png']] }),
      LoadImageMask: node({ image: [['fixture.png']], channel: [['red']] }),
      INPAINT_LoadInpaintModel: node({ model_name: [[FAKE_LAMA]] }),
      INPAINT_InpaintWithModel: node({ inpaint_model: ['INPAINT_MODEL'], image: ['IMAGE'], mask: ['MASK'], seed: ['INT'] }),
      SaveImage: node({ images: ['IMAGE'], filename_prefix: ['STRING'] }),
    };
  }
  override async uploadImage(bytes: Uint8Array, name: string) { this.uploads.push(bytes.slice()); return name; }
  override async submit() { return 'fixture'; }
  override async waitBehind() {
    return { entry: { outputs: { '5': { images: [{ filename: 'filled.png', subfolder: '', type: 'output' }] } }, status: null }, vramLow: {}, elapsed: 0 };
  }
  override async view() {
    const fill = newRaster(SIDE, SIDE);
    for (let i = 0; i < fill.data.length; i += 4) fill.data.set([...FAKE_FILL, 255], i);
    return encodePngBytes(fill);
  }
}

function setup(dir: string, scale: 1 | 0.5) {
  const source = writeClassifiedPlateInputs(dir, scale);
  const assembled = cli(dir, 'assemble', ['assemble', '--source', source.painting, '--full', source.full, '--head', source.head,
    '--config', source.config, '--out', source.assemble]);
  requireExit(assembled, 0, 'assemble');
  const parts = readParts(source.parts);
  assert.deepEqual(parts.rig_size, [SIDE * scale, SIDE * scale]);
  assert.deepEqual(parts.parts.map(p => [p.name, p.x, p.y, p.w, p.h, p.opaque_px]),
    [['body', 24 * scale, 22 * scale, 16 * scale, 32 * scale, 512 * scale * scale]]);
  return { ...source, manifest: writeClassifiedPlateManifest(dir, source, true) };
}

function checkRoleRefusal(run: ReturnType<typeof foreground>, components: Components): void {
  requireExit(run, 1, 'unlabelled foreground');
  assert.ok(/^\s*FAIL  PLATE_COMPONENT_ROLE:/m.test(run.output), 'missing PLATE_COMPONENT_ROLE');
  assert.ok(!existsSync(run.out), 'unlabelled foreground published an output');
  const template = run.output.match(/"components"\s*:\s*(\[\s*\{[^\]]*\}\s*\])/);
  assert.ok(template, 'missing paste-ready components array');
  const entries = JSON.parse(template[1]) as Array<{ id: string; role: string }>;
  assert.deepEqual(entries.map(entry => entry.id).sort(), components.map(c => c.id).sort(), 'template component IDs');
  assert.ok(entries.every(entry => entry.role === '' && Object.keys(entry).length === 2), 'template needs a blank role for each ID');
  const inventory = run.output.replace(template[0], '');
  for (const { id, rect: { x0, y0, x1, y1 } } of components) {
    const count = (x1 - x0) * (y1 - y0);
    const row = inventory.split('\n').find(line => line.includes(id) && line.includes('painting box'));
    assert.ok(row, `missing inventory row for ${id}`);
    assert.match(row, new RegExp(`\\b${count}\\s+px\\b`), `missing pixel count for ${id}`);
    assert.ok(row.includes(JSON.stringify([x0, y0, x1 - x0, y1 - y0])), `missing painting-grid bounding box for ${id}`);
  }
}

async function runControl(dir: string, label: Label, fixture: ReturnType<typeof setup>): Promise<string> {
  const { painting, manifest, components } = fixture;
  switch (label) {
    case LABELS[0]: {
      const run = foreground(dir, 'legacy', painting, `figure-mask:${fixture.rig}`);
      requireExit(run, 0, 'legacy foreground');
      const rec = receipt(run.out, 'foreground', 'figure-mask', fixture.rig);
      assert.equal(rec.mask_classification, undefined, 'legacy receipt classification');
      const mask = join(run.out, 'mask.png');
      assert.equal(hash(readFileSync(mask)), hash(readFileSync(fixture.figure)), 'unmodified producer mask');
      return `CLI exit 0; ${checkMask(mask, legacy, [42, 40, 48, 512, 642])}; original mask digest and legacy receipt verified`;
    }
    case LABELS[1]: {
      const run = foreground(dir, 'foreground', painting, `classified:${manifest}`);
      requireExit(run, 0, 'classified foreground');
      checkClassification(receipt(run.out, 'foreground', 'classified', manifest), manifest, components, 0, 0);
      const reading = checkMask(join(run.out, 'mask.png'), raw, [0, 0, 48, 512, 560]);
      const original = png(painting);
      checkRaster(png(join(run.out, 'plate.png')), p => raw(p) ? original.data.subarray(p * 4, p * 4 + 4) : [0, 0, 0, 0], 'foreground plate');
      return `CLI exit 0; ${reading}; transparent outside support; manifest digest and clips 0/0 verified`;
    }
    case LABELS[2]: {
      const out = join(dir, 'background');
      const box = new PlateBox();
      const lines: string[] = [];
      const record = await runBackground(() => box, {
        painting, maskFrom: `classified:${manifest}`, out, graph: 'lama', model: undefined, checkpointSha256: 'ab'.repeat(32),
        seed: 0, growPx: DEFAULT_GROW_PX, steps: 30, prompt: undefined, negative: undefined, wait: 1, timeout: 1,
      }, line => lines.push(line));
      writeFileSync(join(dir, 'background.log'), `${lines.join('\n')}\n`);
      const persisted = receipt(out, 'background', 'classified', manifest);
      assert.deepEqual(record, persisted, 'returned and persisted receipt');
      assert.equal(record.params.grow_px, 8, 'default grow radius');
      checkClassification(persisted, manifest, components, 18, 0);
      for (const { id, clipped_px } of persisted.mask_classification!.prop_clips) {
        assert.ok(lines.includes(`  classified background prop ${id}: clipped ${clipped_px} grown px`), `missing clip log for ${id}`);
      }
      const mask = join(out, 'mask.png');
      const reading = checkMask(mask, grown, [0, 0, 48, 512, 1758]);
      assert.deepEqual(box.uploads.map(hash), [hash(readFileSync(painting)), hash(readFileSync(mask))], 'painting and clipped mask uploads');
      const original = png(painting);
      checkRaster(png(join(out, 'plate.png')), p => grown(p) ? [...FAKE_FILL, 255] : original.data.subarray(p * 4, p * 4 + 4), 'background plate');
      return `grow 8; ${reading}; uploads=2; paste, manifest digest and logged clips 18/0 verified`;
    }
    case LABELS[3]: {
      const unlabelled = writeClassifiedPlateManifest(dir, fixture, false);
      checkRoleRefusal(foreground(dir, 'unlabelled', painting, `classified:${unlabelled}`), components);
      const declaration = JSON.parse(readFileSync(manifest, 'utf8')) as { components: Array<{ id: string; role: string }> };
      const [first, ...others] = declaration.components;
      const plants = [
        { name: 'partial', entries: others },
        { name: 'duplicate', entries: [...declaration.components, first] },
        { name: 'unknown', entries: [...declaration.components, { id: '0'.repeat(64), role: 'figure-accessory' }] },
      ];
      for (const { name, entries } of plants) {
        const file = join(dir, `${name}.json`);
        writeFileSync(file, JSON.stringify({ ...declaration, components: entries }));
        checkRoleRefusal(foreground(dir, name, painting, `classified:${file}`), components);
      }
      return 'CLI exit 1 for blank, partial, duplicate, and unknown labels; PLATE_COMPONENT_ROLE prints all 3 IDs, boxes, counts and blank roles; no output';
    }
    case LABELS[4]: {
      const before = readFileSync(fixture.body);
      const changed = decodePngBytes(before, fixture.body);
      changed.data[0] ^= 1;
      const planted = encodePngBytes(changed);
      const originalHash = hash(before), plantedHash = hash(planted);
      assert.notEqual(plantedHash, originalHash, 'plant must change PNG bytes');
      writeFileSync(join(dir, 'stale-body.png'), planted);
      let run: ReturnType<typeof foreground>;
      try {
        writeFileSync(fixture.body, planted);
        run = foreground(dir, 'stale', painting, `classified:${manifest}`);
      } finally {
        writeFileSync(fixture.body, before);
      }
      requireExit(run, 1, 'stale foreground');
      const refusal = run.output.split('\n').find(line => /^\s*FAIL  PLATE_COMPONENT_SOURCE:/.test(line));
      assert.ok(refusal !== undefined && refusal.includes('body.png'),
        `missing PLATE_COMPONENT_SOURCE for body.png: ${run.output.trim().split('\n').slice(-3).join(' ')}`);
      assert.ok(refusal.includes(originalHash) && refusal.includes(plantedHash), 'refusal must name the stamped and stale PNG digests');
      assert.ok(!existsSync(run.out), 'stale foreground published an output');
      assert.equal(hash(readFileSync(fixture.body)), originalHash, 'original body PNG restored');
      const restored = foreground(dir, 'stale-restored', painting, `classified:${manifest}`);
      requireExit(restored, 0, 'restored foreground');
      receipt(restored.out, 'foreground', 'classified', manifest);
      return 'stale CLI exit 1; PLATE_COMPONENT_SOURCE names body.png; no output; restored original digest and CLI exit 0';
    }
    case LABELS[5]: {
      const figure = png(fixture.figure);
      assert.deepEqual([figure.width, figure.height], [32, 32], 'assemble figure grid');
      let figurePx = 0;
      for (let i = 0; i < figure.data.length; i += 4) if (figure.data[i] === 255) figurePx++;
      // Native body/accessory/near/far are 512 + 48 + 48 + 64 px; each rig pixel covers 4.
      assert.equal(figurePx, 168, 'assemble figure pixels at scale 0.5');
      const unlabelled = writeClassifiedPlateManifest(dir, fixture, false);
      checkRoleRefusal(foreground(dir, 'unlabelled', painting, `classified:${unlabelled}`), components);
      const run = foreground(dir, 'foreground', painting, `classified:${manifest}`);
      requireExit(run, 0, 'half-scale classified foreground');
      checkClassification(receipt(run.out, 'foreground', 'classified', manifest), manifest, components, 0, 0);
      const props = components.filter(c => c.role === 'background-prop').map(c => new Set(indices(c.rect)));
      const reading = checkMask(join(run.out, 'mask.png'), raw, [0, 0, 48, 512, 560], props);
      return `32x32 assemble figure 168 px; CLI exit 1 names all 3 painting-grid IDs and boxes (48/48/64 px); CLI exit 0; 64x64 ${reading}`;
    }
  }
}

/** The comfy suite is synchronous. The child runs the async fake box and emits one verdict per control. */
export function runClassifiedPlateChecks(work: string, say: Say): void {
  const r = spawnSync(process.execPath, [import.meta.path, work, '--json'], { encoding: 'utf8' });
  let verdicts: Verdict[];
  try {
    verdicts = JSON.parse(r.stdout ?? '');
    assert.deepEqual(verdicts.map(row => row.label), [...LABELS]);
    assert.equal(r.status, verdicts.every(row => row.pass) ? 0 : 1);
  } catch {
    say(LABELS[0], false, `classified control subprocess exit ${r.status}: ${(r.error?.message ?? r.stderr ?? '').trim().split('\n').slice(-3).join(' ')}`, '#1267 classified control harness');
    return;
  }
  for (const { label, pass, detail } of verdicts) say(label, pass, detail, '#1267 classified plate source');
}

async function main(): Promise<void> {
  const [work, option, value, ...extra] = process.argv.slice(2);
  const only = LABELS.find(label => label === value || label.split('_', 1)[0] === value);
  const json = option === '--json';
  if (work === undefined || extra.length !== 0 || (option === '--only' ? only === undefined : (option !== undefined && !json) || value !== undefined)) {
    console.error(`usage: bun tools/check_classified_plate.ts <scratch dir> [--only <PB number or label>]\n${LABELS.join('\n')}`);
    process.exit(2);
  }
  mkdirSync(work, { recursive: true });
  const dir = mkdtempSync(join(resolve(work), PREFIX));
  const verdicts: Verdict[] = [];
  function report(label: Label, pass: boolean, detail: string): void {
    verdicts.push({ label, pass, detail: detail.replace(/\s+/g, ' ').slice(0, 1000) });
  }
  const selected = only === undefined ? LABELS : [only];
  const unscaled = selected.filter(label => label !== LABELS[5]);
  try {
    if (unscaled.length > 0) {
      const fixture = setup(dir, 1);
      for (const label of unscaled) {
        try { report(label, true, await runControl(dir, label, fixture)); }
        catch (err) { report(label, false, (err as Error).message); }
      }
    }
  } catch (err) {
    for (const label of unscaled) report(label, false, `fixture setup: ${(err as Error).message}`);
  }
  if (selected.includes(LABELS[5])) {
    const scaled = join(dir, 'scaled');
    const label = LABELS[5];
    try {
      const fixture = setup(scaled, 0.5);
      try { report(label, true, await runControl(scaled, label, fixture)); }
      catch (err) { report(label, false, (err as Error).message); }
    } catch (err) { report(label, false, `fixture setup: ${(err as Error).message}`); }
  }
  if (json) console.log(JSON.stringify(verdicts));
  else {
    for (const { label, pass, detail } of verdicts) console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}\n      ${detail}`);
    console.log(`Evidence ${dir}`);
  }
  process.exit(verdicts.every(row => row.pass) ? 0 : 1);
}

if (import.meta.main) await main();
