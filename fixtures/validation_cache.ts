/** One immutable, gated sample build per input identity and variant in a shard. */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ValidationVariant } from './validation.ts';

export interface ValidationBuild {
  input: string;
  config: string;
  out: string;
  log: string;
  key: string;
  seconds: number;
  reused: boolean;
}
interface BuildReceipt { head: string; key: string; variant: string; seconds: number; output: string }
export const VALIDATION_VARIANTS: readonly ValidationVariant[] = ['standard', 'physics', 'no-neck', 'gesture', 'cloth', 'physics-driven', 'physics-mixed', 'travel', 'structure'];

export function validationFiles(dir: string, skipExpected = false): string[] {
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      if (skipExpected && at === dir && name === 'expected') continue;
      const file = join(at, name);
      if (statSync(file).isDirectory()) walk(file);
      else out.push(relative(dir, file).replaceAll('\\', '/'));
    }
  };
  walk(dir);
  return out;
}
export function validationDigest(dir: string, skipExpected = false): string {
  const hash = createHash('sha256');
  for (const file of validationFiles(dir, skipExpected)) {
    hash.update(file); hash.update('\0'); hash.update(createHash('sha256').update(readFileSync(join(dir, file))).digest());
  }
  return hash.digest('hex');
}
export function validationConfigName(variant: ValidationVariant): string {
  return variant === 'standard' ? 'config.json' : `config.${variant}.json`;
}
export function validationHead(root: string): string {
  const supplied = process.env.RIG_PARTS_VALIDATION_HEAD ?? process.env.GITHUB_SHA ?? process.env.SOURCE_SHA;
  if (supplied !== undefined && /^[a-f0-9]{40}$/.test(supplied)) return supplied;
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const head = git.stdout?.trim() ?? '';
  if (git.status !== 0 || !/^[a-f0-9]{40}$/.test(head)) throw new Error('validation sample requires the actual source head (set RIG_PARTS_VALIDATION_HEAD for source snapshots)');
  return head;
}
export function validationInput(root: string): string | null {
  const dir = join(root, 'fixtures', 'validation-inputs');
  const required = ['inputs/painting.png', 'inputs/layers/full/layers.json', 'inputs/layers/head/layers.json', 'pose.json', 'keypoints.json', 'animations.json', 'requirements.json', ...VALIDATION_VARIANTS.map(validationConfigName)];
  return required.every(file => existsSync(join(dir, file))) ? dir : null;
}

/** Receipt streams are append-only: every attempt, including a refusal, counts. */
export function validationBuildSeconds(cache: string): number {
  const file = join(cache, 'build-times.jsonl');
  if (!existsSync(file)) return 0;
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
    .map(line => (JSON.parse(line) as { seconds: number }).seconds).reduce((a, b) => a + b, 0);
}

export interface ValidationProducerReceipt {
  label?: string;
  head?: string;
  key?: string;
  signal?: string | null;
  variant: string;
  kind?: 'sample-build' | 'feature-producer';
  seconds: number;
  exit: number | null;
}
export interface ValidationStream {
  shard: string;
  builds: ValidationProducerReceipt[];
  sample_count: number;
  feature_count: number;
  sample_seconds: number;
  feature_seconds: number;
  total_seconds: number;
}

/** The stream is observational. Only an individual producer exceeds a time limit. */
function recordValidationProducer(cache: string, row: ValidationProducerReceipt): void {
  mkdirSync(cache, { recursive: true });
  appendFileSync(join(cache, 'build-times.jsonl'), JSON.stringify(row) + '\n');
  const label = row.label ?? row.variant;
  const kind = row.kind ?? 'sample-build';
  console.error(`validation sample producer: ${label} variant ${row.variant} kind ${kind} ${row.seconds.toFixed(3)} s, shard total ${validationBuildSeconds(cache).toFixed(3)} s, exit ${row.exit}`);
  if (row.seconds > 60) throw new Error(`validation producer exceeds 60 s: label ${label}, variant ${row.variant}, kind ${kind}, seconds ${row.seconds}; receipt retained`);
}

/** Every extra CLI/stage attempt, including a planted refusal, joins the same stream. */
export function validationProducerReceipt(cache: string, label: string, seconds: number, exit: number | null): void {
  recordValidationProducer(cache, { label, variant: label, seconds, exit, kind: 'feature-producer' });
}

function validationStream(shard: string, builds: ValidationProducerReceipt[]): ValidationStream {
  const sample = builds.filter(row => row.kind !== 'feature-producer');
  const feature = builds.filter(row => row.kind === 'feature-producer');
  const sampleSeconds = sample.reduce((sum, row) => sum + row.seconds, 0);
  const featureSeconds = feature.reduce((sum, row) => sum + row.seconds, 0);
  return { shard, builds, sample_count: sample.length, feature_count: feature.length,
    sample_seconds: sampleSeconds, feature_seconds: featureSeconds, total_seconds: sampleSeconds + featureSeconds };
}

/** Read complete append-only streams after the shard's workers finish. */
export function validationStreams(cache: string): ValidationStream[] {
  const directories = [cache, ...readdirSync(cache).filter(name => name.startsWith('shard-')).map(name => join(cache, name))];
  return directories.flatMap(dir => {
    const file = join(dir, 'build-times.jsonl');
    if (!existsSync(file)) return [];
    const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as ValidationProducerReceipt);
    return [validationStream(relative(cache, dir) || 'direct', rows)];
  });
}

/** Optional on older shard records, but a present stream must account for its rows. */
export function validValidationStreams(raw: unknown): raw is ValidationStream[] {
  if (!Array.isArray(raw)) return false;
  return raw.every((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const stream = entry as Partial<ValidationStream>;
    if (typeof stream.shard !== 'string' || !Array.isArray(stream.builds)) return false;
    for (const entry of stream.builds as unknown[]) {
      if (typeof entry !== 'object' || entry === null) return false;
      const row = entry as Partial<ValidationProducerReceipt>;
      if (typeof row.variant !== 'string' || typeof row.seconds !== 'number' || !Number.isFinite(row.seconds) || row.seconds < 0 ||
          (row.label !== undefined && typeof row.label !== 'string') ||
          (row.kind !== undefined && row.kind !== 'sample-build' && row.kind !== 'feature-producer') ||
          (row.exit !== null && (typeof row.exit !== 'number' || !Number.isFinite(row.exit)))) return false;
    }
    const expected = validationStream(stream.shard, stream.builds);
    return stream.sample_count === expected.sample_count && stream.feature_count === expected.feature_count &&
      stream.sample_seconds === expected.sample_seconds && stream.feature_seconds === expected.feature_seconds && stream.total_seconds === expected.total_seconds;
  });
}

export function validationStreamSummary(shards: readonly ValidationStream[]): string {
  return 'validation sample producers (stderr, never tallied): ' + JSON.stringify({ shards, individual_limit_seconds: 60 });
}

/** The parent prints its local streams. Merge uses streams carried by shard records. */
export function validationBuildSummary(cache: string): string {
  return validationStreamSummary(validationStreams(cache));
}

/** A null input is a HOLE. A failed/corrupt producer is an error, never a HOLE. */
export function validationBuild(root: string, cache: string, head: string, variant: ValidationVariant = 'standard', inputOverride?: string): ValidationBuild | null {
  const input = inputOverride ?? validationInput(root);
  if (input === null) return null;
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('validation sample head must be a full commit SHA');
  const config = join(input, validationConfigName(variant));
  if (!existsSync(config) || !existsSync(join(input, 'inputs', 'painting.png'))) return null;
  mkdirSync(cache, { recursive: true });
  const inputs = validationDigest(input, true);
  const key = createHash('sha256').update(JSON.stringify({ head, inputs })).digest('hex');
  const entry = join(cache, `${key}-${variant}`);
  const hit = (): ValidationBuild | null => {
    if (!existsSync(entry)) return null;
    const receipt = JSON.parse(readFileSync(join(entry, 'green.json'), 'utf8')) as BuildReceipt;
    if (receipt.key !== key || receipt.head !== head || receipt.variant !== variant ||
        validationDigest(join(entry, 'build')) !== receipt.output) throw new Error('validation sample cached output does not match its green receipt');
    return { input, config, out: join(entry, 'build'), log: readFileSync(join(entry, 'build.log'), 'utf8'), key, seconds: receipt.seconds, reused: true };
  };
  const previous = hit();
  if (previous !== null) return previous;
  const lock = `${entry}.lock`;
  const until = performance.now() + 65000;
  for (;;) {
    try { mkdirSync(lock); break; }
    catch (error) {
      if (!existsSync(lock)) throw error;
      const ready = hit();
      if (ready !== null) return ready;
      if (performance.now() >= until) throw new Error('validation sample producer did not finish within its bounded wait');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  const stage = join(cache, `${key}-${variant}-stage-${process.pid}`);
  try {
    const ready = hit();
    if (ready !== null) return ready;
    mkdirSync(stage);
    const started = performance.now();
    const typedConfig = relative(root, config).replaceAll('\\', '/');
    const images = variant === 'travel' ? join(input, 'inputs', 'travel') : join(input, 'inputs');
    const r = spawnSync(process.execPath, [join(root, 'cli.ts'), 'build', '--config', typedConfig,
      '--source', join(images, 'painting.png'), '--full', join(images, 'layers', 'full'),
      '--head', join(images, 'layers', 'head'), '--out', join(stage, 'build')],
    { cwd: root, encoding: 'utf8', timeout: 61000, maxBuffer: 1 << 28 });
    const seconds = (performance.now() - started) / 1000;
    const log = (r.stdout ?? '') + (r.stderr ?? '');
    writeFileSync(join(stage, 'producer.log'), log);
    writeFileSync(join(stage, 'build.log'), log);
    recordValidationProducer(cache, { label: 'build', kind: 'sample-build', head, key, variant, seconds, exit: r.status, signal: r.signal });
    if (r.status !== 0) {
      throw new Error('validation sample build refused: ' + log.split('\n').slice(-16).join('\n'));
    }
    if (validationDigest(input, true) !== inputs) throw new Error('validation sample inputs changed while the producer was reading');
    const check = JSON.parse(readFileSync(join(stage, 'build', 'check', 'check.json'), 'utf8')) as { PASS?: boolean };
    if (check.PASS !== true) throw new Error('validation sample producer wrote no green check verdict');
    const tail = log.trimEnd().split('\n').slice(-4).map(line => line.trim());
    const artifactPaths = ['skeleton.json', 'skeleton.atlas', 'skeleton.png'].map(name => join(stage, 'build', 'check', 'build', name));
    if (!tail[0]?.startsWith('pack: ') || tail.slice(1).join('\n') !== artifactPaths.join('\n') || artifactPaths.some(file => !existsSync(file))) throw new Error('validation sample producer did not end with its three existing artifact identities');
    // Publication moves the directory; keep the raw producer log, and project
    // paths in the replay log to those same published filesystem objects.
    writeFileSync(join(stage, 'build.log'), log.replaceAll(join(stage, 'build'), join(entry, 'build')));
    const receipt: BuildReceipt = { head, key, variant, seconds, output: validationDigest(join(stage, 'build')) };
    writeFileSync(join(stage, 'green.json'), JSON.stringify(receipt) + '\n');
    renameSync(stage, entry);
    const result = hit();
    if (result === null) throw new Error('validation sample publication disappeared');
    return { ...result, reused: false };
  } finally { rmSync(lock, { recursive: true }); }
}

/** The parent sets one directory for its workers; unrelated invocations never share it. */
export function validationScope(root: string): { cache: string; head: string } {
  const cache = process.env.RIG_PARTS_VALIDATION_CACHE;
  if (cache === undefined) throw new Error('validation sample cache must be owned by the selftest parent');
  return { cache: resolve(cache), head: validationHead(root) };
}
