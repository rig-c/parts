/**
 * POSIX compose disk census. Build the fetched public demo once using its
 * documented build command, then freeze the build's compose inputs:
 *   bun scripts/measure_compose_preview.ts prepare <lane> <green-demo-build>
 *   bun scripts/measure_compose_preview.ts measure <lane> <label> <keyed|unkeyed> [interval-ms] [--output-profile preview]
 * Use the same lane, fixture and interval for both revisions. The lane must
 * be outside the checkout. Keep inputs/ for the second revision. Runs move
 * their work directories into runs/<label>-<scene>/ after the census.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, copyFileSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync,
  realpathSync, renameSync, writeFileSync,
} from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const cases = ['keyed', 'unkeyed'] as const;
type Scene = typeof cases[number];
const categories = ['extremes', 'idle_frames', 'build', 'composed_rig', 'other', 'total'] as const;
type Category = typeof categories[number];
type Bytes = Record<Category, number>;
const inputManifest = 'inputs.sha256.json';
const repo = realpathSync(resolve(import.meta.dir, '..'));

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fixtureFiles(root: string): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Fixture must contain only regular files and directories: ${path}`);
    }
  }
  walk('');
  return files.sort();
}

function fixtureManifest(root: string) {
  return fixtureFiles(root).map(path => ({ path, sha256: sha256(join(root, path)) }));
}

function prepare(lane: string, build: string): void {
  const check = JSON.parse(readFileSync(join(build, 'check/check.json'), 'utf8'));
  if (check.PASS !== true || check.gate_spine_html_green !== true) throw new Error('The demo build must have a green check and gate');
  const parts = JSON.parse(readFileSync(join(build, 'parts.json'), 'utf8'));
  const [width, height] = parts.rig_size as [number, number];
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Expected positive integer demo rig_size');
  const rigFiles = fixtureFiles(join(build, 'rig/images')).map(file => join('rig/images', file));
  if (rigFiles.length === 0) throw new Error('The demo build has no rig images');

  const inputs = join(lane, 'inputs');
  mkdirSync(inputs);
  const consumed = ['check/check.json', 'parts.json', 'rig/rig.json', 'rig/motion.json', ...rigFiles];
  if (parts.painting_in_rig !== undefined) consumed.push('painting_in_rig.png');
  for (const file of consumed) {
    const target = join(inputs, 'demo', file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(build, file), target);
  }
  const base = {
    spec: 'spine-parts-scene/1', canvas: { width, height },
    characters: [{ id: 'demo', build: 'demo', offset: [0, 0] }], order: ['demo'],
  };
  writeJson(join(inputs, 'unkeyed.json'), base);
  // Give the scene its own closed take so the character idle and all its
  // authored side takes keep their original timing in both cases.
  writeJson(join(inputs, 'keyed.json'), {
    ...base,
    animations: { scene_travel: { duration: 1, loop: true, tracks: [{
      bone: 'root', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [8] }, { t: 1, v: [0] }],
    }] } },
  });
  writeJson(join(lane, inputManifest), fixtureManifest(inputs));
}

function classify(path: string): Exclude<Category, 'total'> {
  if (/^out\/check\/(?:_extremes|extremes)(?:\/|$)/.test(path)) return 'extremes';
  if (/^out\/check\/(?:idle_frames|_loop\/frames)(?:\/|$)/.test(path)) return 'idle_frames';
  if (/^out\/check\/(?:build\/|build-report\.json$|_[^/]+\/(?:[^/]+\/)*(?:build|black_build)\/)/.test(path)) return 'build';
  const gate = /^tmp\/rig-parts-compose-[^/]+\/gate\/(.+)$/.exec(path)?.[1];
  if (gate !== undefined && /^(?:check\/)?build\//.test(gate)) return 'build';
  if (path.startsWith('out/rig/') || (gate !== undefined && /^(?:rig\/)?(?:images\/|rig\.json$|motion\.json$)/.test(gate))) return 'composed_rig';
  return 'other';
}

function zero(): Bytes {
  return { extremes: 0, idle_frames: 0, build: 0, composed_rig: 0, other: 0, total: 0 };
}

/** Logical regular-file lengths per pathname. Active scans can race removals. */
function census(root: string, live: boolean) {
  const bytes = zero();
  let temporaryBytes = 0, files = 0, vanished = 0;
  function walk(path: string): void {
    const absolute = join(root, path);
    try {
      const info = lstatSync(absolute);
      if (info.isDirectory()) {
        for (const entry of readdirSync(absolute)) walk(path ? `${path}/${entry}` : entry);
      } else if (info.isFile()) {
        bytes[classify(path)] += info.size;
        bytes.total += info.size;
        if (path.startsWith('tmp/')) temporaryBytes += info.size;
        files++;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!live || (code !== 'ENOENT' && code !== 'ENOTDIR')) throw error;
      vanished++;
    }
  }
  walk('');
  return { bytes, temporary_bytes: temporaryBytes, files, vanished };
}

async function measure(lane: string, label: string, scene: Scene, interval: number, profile: readonly string[]): Promise<void> {
  const inputs = join(lane, 'inputs');
  const frozen = JSON.parse(readFileSync(join(lane, inputManifest), 'utf8'));
  const fixtureMatches = () => JSON.stringify(fixtureManifest(inputs)) === JSON.stringify(frozen);
  if (!fixtureMatches()) throw new Error('Frozen input manifest differs from inputs/');

  const receipt = join(lane, 'runs', `${label}-${scene}`);
  const active = join(lane, 'active');
  const tmp = join(active, 'tmp');
  const timeoutMs = 600_000;
  mkdirSync(dirname(receipt), { recursive: true });
  mkdirSync(receipt);
  mkdirSync(active); // Exclusive. Never clear an earlier or concurrent run.
  mkdirSync(tmp);

  const peak = zero();
  let atTotalPeak = zero(), tempPeak = 0, samples = 0, vanished = 0;
  let lastStart = 0, maxGap = 0, maxScan = 0, totalPeakAt = 0;
  function observe(sample: ReturnType<typeof census>, elapsed: number): void {
    for (const key of categories) peak[key] = Math.max(peak[key], sample.bytes[key]);
    if (sample.bytes.total > atTotalPeak.total) {
      atTotalPeak = sample.bytes;
      totalPeakAt = elapsed;
    }
    tempPeak = Math.max(tempPeak, sample.temporary_bytes);
    samples++;
    vanished += sample.vanished;
  }
  observe(census(active, false), 0);

  const args = [join(repo, 'cli.ts'), 'compose', '--scene', join(inputs, `${scene}.json`), '--out', 'out', ...profile];
  const env = {
    ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp,
    PATH: dirname(process.execPath) + delimiter + (process.env.PATH ?? ''),
  };
  const log = openSync(join(receipt, 'compose.log'), 'wx');
  const started = performance.now();
  const child = (() => {
    try {
      return spawn(process.execPath, args, { cwd: active, env, detached: true, stdio: ['ignore', log, log] });
    } finally { closeSync(log); }
  })();

  let stopReason: string | null = null;
  function stop(reason: string): void {
    stopReason ??= reason;
    if (child.pid === undefined) return;
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  }
  const interrupt = () => stop('interrupted');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const deadline = setTimeout(() => stop('timeout'), timeoutMs);
  const sampler = setInterval(() => {
    const start = performance.now();
    const elapsed = start - started;
    maxGap = Math.max(maxGap, elapsed - lastStart);
    lastStart = elapsed;
    try { observe(census(active, true), elapsed); }
    catch (error) { stop(`census failed: ${String(error)}`); }
    maxScan = Math.max(maxScan, performance.now() - start);
  }, interval);

  const result = await new Promise<{ exit: number | null; signal: string | null; wall_ms: number }>(done => {
    child.once('exit', (exit, signal) => done({ exit, signal, wall_ms: performance.now() - started }));
    child.once('error', error => {
      stopReason = `spawn failed: ${error.message}`;
      done({ exit: null, signal: null, wall_ms: performance.now() - started });
    });
  }).finally(() => {
    clearTimeout(deadline);
    clearInterval(sampler);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  });

  const terminalStart = performance.now() - started;
  maxGap = Math.max(maxGap, terminalStart - lastStart);
  const retained = census(active, false);
  observe(retained, terminalStart);
  const inputsUnchanged = fixtureMatches();
  writeJson(join(receipt, 'measurement.json'), {
    spec: 'compose-disk-census/1', scene, label, argv: [process.execPath, ...args], cwd: active,
    platform: process.platform, architecture: process.arch, bun: Bun.version,
    script_sha256: sha256(import.meta.path), lock_sha256: sha256(join(repo, 'bun.lock')),
    input_manifest_sha256: sha256(join(lane, inputManifest)), inputs_unchanged: inputsUnchanged,
    ...result, timeout_ms: timeoutMs, stop_reason: stopReason,
    sample_interval_ms: interval, samples, longest_sample_start_gap_ms: maxGap, longest_live_scan_ms: maxScan,
    vanished_during_scans: vanished, peak_sampled_bytes: peak, bytes_at_total_peak: atTotalPeak,
    total_peak_at_ms: totalPeakAt, temporary_peak_sampled_bytes: tempPeak, retained,
  });
  renameSync(active, join(receipt, 'work'));
  console.log(join(receipt, 'measurement.json'));
  if (stopReason !== null || !inputsUnchanged || result.exit === null) process.exitCode = 1;
  else process.exitCode = result.exit;
}

const [command, root, arg, scene, sampling = '25', ...profile] = process.argv.slice(2);
const interval = Number(sampling);
const validProfile = profile.length === 0 || (profile.length === 2 && profile[0] === '--output-profile' && profile[1] === 'preview');
if ((process.platform !== 'linux' && process.platform !== 'darwin') || !root || !arg || !validProfile ||
    (command === 'prepare' ? scene !== undefined : command !== 'measure' ||
      (scene !== 'keyed' && scene !== 'unkeyed') || !/^[a-zA-Z0-9_-]+$/.test(arg) ||
      !Number.isSafeInteger(interval) || interval <= 0 || interval > 60_000)) {
  throw new Error('Usage (Linux/macOS): prepare <existing-lane> <green-demo-build> | measure <existing-lane> <label> <keyed|unkeyed> [interval-ms] [--output-profile preview]');
}
const lane = realpathSync(root);
const laneFromRepo = relative(repo, lane);
if (laneFromRepo === '' || (!isAbsolute(laneFromRepo) && laneFromRepo !== '..' && !laneFromRepo.startsWith(`..${sep}`))) {
  throw new Error('The lane must be outside the checkout');
}
if (command === 'prepare') prepare(lane, resolve(arg));
else if (scene === 'keyed' || scene === 'unkeyed') await measure(lane, arg, scene, interval, profile);
