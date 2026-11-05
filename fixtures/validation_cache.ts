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

/** Every extra CLI/stage producer, including a planted refusal, shares the shard budget. */
export function validationProducerReceipt(cache: string, label: string, seconds: number, exit: number | null): void {
  mkdirSync(cache, { recursive: true });
  const stop = join(cache, 'STOP.json');
  if (existsSync(stop)) throw new Error('validation sample producer already stopped');
  appendFileSync(join(cache, 'build-times.jsonl'), JSON.stringify({ variant: label, seconds, exit, kind: 'feature-producer' }) + '\n');
  const total = validationBuildSeconds(cache);
  console.error(`validation sample producer: ${label} ${seconds.toFixed(3)} s, shard total ${total.toFixed(3)} s, exit ${exit}`);
  if (seconds > 60 || total > 120) {
    writeFileSync(stop, JSON.stringify({ label, seconds, total, individualLimit: 60, shardLimit: 120 }));
    throw new Error('validation sample producer exceeded its fixed 60 s or shard 120 s bar; receipts retained');
  }
}

/** The parent prints actual per-shard receipts, including extra workflow producers. */
export function validationBuildSummary(cache: string): string {
  const directories = [cache, ...readdirSync(cache).filter(name => name.startsWith('shard-')).map(name => join(cache, name))];
  const shards = directories.flatMap(dir => {
    const file = join(dir, 'build-times.jsonl');
    if (!existsSync(file)) return [];
    const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { variant: string; seconds: number; exit: number | null });
    return [{ shard: relative(cache, dir) || 'direct', builds: rows, total_seconds: rows.reduce((sum, row) => sum + row.seconds, 0) }];
  });
  return 'validation sample producers (stderr, never tallied): ' + JSON.stringify({ shards,
    individual_limit_seconds: 60, shard_limit_seconds: 120 });
}

/** A null input is a HOLE. A failed/corrupt producer is an error, never a HOLE. */
export function validationBuild(root: string, cache: string, head: string, variant: ValidationVariant = 'standard', inputOverride?: string): ValidationBuild | null {
  const input = inputOverride ?? validationInput(root);
  if (input === null) return null;
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('validation sample head must be a full commit SHA');
  const config = join(input, validationConfigName(variant));
  if (!existsSync(config) || !existsSync(join(input, 'inputs', 'painting.png'))) return null;
  mkdirSync(cache, { recursive: true });
  const stop = join(cache, 'STOP.json');
  if (existsSync(stop)) throw new Error('validation sample producer stopped: ' + readFileSync(stop, 'utf8'));
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
      if (existsSync(stop)) throw new Error('validation sample producer stopped while waiting');
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
    appendFileSync(join(cache, 'build-times.jsonl'), JSON.stringify({ head, key, variant, seconds, exit: r.status, signal: r.signal }) + '\n');
    const total = validationBuildSeconds(cache);
    console.error(`validation sample build: ${variant} ${seconds.toFixed(3)} s, shard total ${total.toFixed(3)} s, head ${head}, inputs ${inputs}`);
    if (seconds > 60 || total > 120) {
      writeFileSync(stop, JSON.stringify({ variant, seconds, total, individualLimit: 60, shardLimit: 120 }));
      throw new Error('validation sample build exceeded its fixed 60 s or shard 120 s bar; receipts retained');
    }
    if (r.status !== 0) {
      writeFileSync(stop, JSON.stringify({ variant, exit: r.status, signal: r.signal }));
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
