/**
 * The public examples' expected files, held to a build (issue #1439).
 *
 *   bun tools/regenerate_examples.ts [--check] [--set examples|validation|all] [--only <label>,...]
 *
 * Every file under `examples/<key>/expected/` (and `examples/wind/expected-wave/`)
 * is this package's own build of that example, by the call the chain suite made
 * before #1113: `build --config examples/<key>/config.json --source
 * examples/<key>/inputs/painting.png --full … --head …`, run from the repository
 * root, with `rig.json` carried to its flat form by `flattenRig`. With
 * `--set validation` it is the nine validation variants' `check.json`, built by
 * the chain suite's own producer and written as `fixtures/regenerate_validation.ts`
 * writes it.
 *
 * Writing is Linux only: `seam_scope.domain.states[].pose_sha256` and the last
 * place of `seam_scope.domain.states[].bounds` are measured to differ between
 * machine classes (#1439: the same tree hashes its posed setup to another value on
 * macOS than on Linux), and the files hold the Linux values. `build.model_sha256`
 * was measured equal on both and is compared exactly everywhere.
 * `--check` writes nothing: it builds and compares whole files, byte for byte. On
 * Linux every difference fails; on another platform a difference in one of those
 * fields is printed as `differs by machine class: held to Linux` and does not.
 * CI runs `--check` on Linux in the expected-files job. Each public build
 * also has to compose at its own stage size (issue #1500). Fetched-art builds
 * stay out of the selftest (#1113); this tool is not a suite.
 *
 * Every directory holding a `check.json` carries `machine-class.txt`, one line:
 * the note above, and the sha256 of check.json's key paths in document order,
 * which the tree suite's EXP02 holds the file to without a build.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { flattenRig, rigJsonText, type RigSpec } from '../src/rig.ts';
import { readParts } from '../src/parts.ts';
import { COMPOSE_RUN_FILE } from '../src/runstamp.ts';
import { SCENE_SPEC } from '../src/scene.ts';
import { checkExampleInputs, pinnedExamplesCommit } from '../scripts/example_inputs.ts';
import { VALIDATION_VARIANTS, validationBuild, validationHead } from '../fixtures/validation_cache.ts';
import { validationCheckText } from '../fixtures/regenerate_validation.ts';
import type { ValidationVariant } from '../fixtures/validation.ts';
import { compareExpected, machineClassLine, MACHINE_CLASS_FILE, recordedKeyOrder, show } from './expected_form.ts';

const ROOT = resolve(import.meta.dir, '..');

type Produce = (out: string) => string | Uint8Array;
interface ExpectedFile { name: string; produce: Produce; json: boolean; serialize?: (value: unknown) => string }
interface Target { label: string; dir: string; build: (scratch: string) => string; files: ExpectedFile[]; checkJson: boolean; example?: string }

const text = (path: string): string => readFileSync(path, 'utf8');
const writerJson = (value: unknown): string => `${JSON.stringify(value, null, 1)}\n`;
const copied = (rel: string, json = true): ExpectedFile => ({ name: rel.split('/').at(-1) as string, json, produce: (out) => json ? text(join(out, rel)) : new Uint8Array(readFileSync(join(out, rel))), serialize: json ? writerJson : undefined });

/** The chain call of the pre-#1113 suite, run from the repository root. */
function exampleBuild(key: string, config: string): (scratch: string) => string {
  return (scratch) => {
    const inputs = `examples/${key}/inputs`;
    const out = join(scratch, `${key}-${config.replace(/\.json$/, '')}`);
    const r = spawnSync(process.execPath, [join(ROOT, 'cli.ts'), 'build', '--config', `examples/${key}/${config}`, '--source', `${inputs}/painting.png`,
      '--full', `${inputs}/layers/full`, '--head', `${inputs}/layers/head`, '--out', out], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error(`EXPECTED_BUILD_GREEN: examples/${key}/${config} — build exit ${String(r.status)}; ${((r.stdout ?? '') + (r.stderr ?? '')).split('\n').slice(-6).join(' | ')}`);
    return out;
  };
}

/** Compose the already-built example through the real CLI at its native stage size. */
export function composePublicExample(label: string, build: string, scratch: string): void {
  const [width, height] = readParts(join(build, 'parts.json')).rig_size;
  const scene = join(scratch, `${label}-scene.json`);
  const out = join(scratch, `${label}-compose`);
  writeFileSync(scene, writerJson({ spec: SCENE_SPEC, canvas: { width, height },
    characters: [{ id: label, build: resolve(build), offset: [0, 0] }], order: [label] }));
  const r = spawnSync(process.execPath, [join(ROOT, 'cli.ts'), 'compose', '--scene', scene, '--out', out],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-8).join(' | ');
    throw new Error(`Example ${label} compose exit ${String(r.status)}: ${r.error?.message ?? output}`);
  }
  if (!existsSync(join(out, COMPOSE_RUN_FILE))) throw new Error(`Example ${label} compose exited 0 without ${COMPOSE_RUN_FILE}`);
}

function exampleTargets(): Target[] {
  const full = (key: string): Target => ({
    label: key, example: key, dir: `examples/${key}/expected`, build: exampleBuild(key, 'config.json'), checkJson: true,
    files: [
      copied('parts.json'),
      { name: 'rig.json', json: true, serialize: rigJsonText, produce: (out) => rigJsonText(flattenRig(JSON.parse(text(join(out, 'rig', 'rig.json'))) as RigSpec)) },
      copied('rig/motion.json'), copied('rig/mesh_report.json'), copied('check/check.json'),
      copied('check/gate_spine-html.txt', false), copied('painting_in_rig.png', false),
    ],
  });
  const wave: Target = {
    label: 'wind-wave', example: 'wind', dir: 'examples/wind/expected-wave', build: exampleBuild('wind', 'config.wave.json'), checkJson: false,
    files: [copied('parts.json'), copied('rig/rig.json'), copied('rig/motion.json'), copied('rig/mesh_report.json'), copied('rig/sets.json'), copied('painting_in_rig.png', false)],
  };
  const keys = readdirSync(join(ROOT, 'examples'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(ROOT, 'examples', entry.name, 'config.json')))
    .map(entry => entry.name).sort();
  return [...keys.map(full), wave];
}

function validationTargets(): Target[] {
  const head = validationHead(ROOT);
  return VALIDATION_VARIANTS.map((variant: ValidationVariant): Target => ({
    label: `validation:${variant}`, dir: `fixtures/validation-inputs/expected/${variant}`, checkJson: true,
    build: (scratch) => {
      const b = validationBuild(ROOT, join(scratch, 'validation-cache'), head, variant);
      if (b === null) throw new Error(`EXPECTED_BUILD_GREEN: validation ${variant} — the validation sample inputs are incomplete`);
      return b.out;
    },
    files: [{ name: 'check.json', json: true, serialize: (v) => JSON.stringify(v, null, 2) + '\n', produce: (out) => validationCheckText(out, variant) }],
  }));
}

function readArgs(argv: readonly string[]): { check: boolean; set: 'examples' | 'validation' | 'all'; only: string[] | null } | string {
  let check = false, set: 'examples' | 'validation' | 'all' = 'examples', only: string[] | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') check = true;
    else if (argv[i] === '--set') {
      const v = argv[++i];
      if (v !== 'examples' && v !== 'validation' && v !== 'all') return `--set takes examples, validation or all; got ${JSON.stringify(v)}`;
      set = v;
    } else if (argv[i] === '--only') {
      const v = argv[++i];
      if (v === undefined || v === '') return '--only takes a comma-separated list of target labels (demo, wind-wave, validation:standard, ...)';
      only = v.split(',');
    } else return `${JSON.stringify(argv[i])} is no flag of this tool; it takes --check, --set examples|validation|all and --only <label>[,<label>...]`;
  }
  if (only !== null && !check) return '--only compares a subset; it writes nothing, so it needs --check';
  return { check, set, only };
}

function main(): number {
  const args = readArgs(process.argv.slice(2));
  if (typeof args === 'string') { console.error(`usage: bun tools/regenerate_examples.ts [--check] [--set examples|validation|all] [--only <label>,...]\n${args}`); return 64; }
  if (!args.check && process.platform !== 'linux') {
    console.error(`EXPECTED_WRITTEN_ON_LINUX: refusing to write on ${process.platform} — pose_sha256 and the last place of bounds in the expected check.json files are held to the Linux values; regenerate on Linux (the remote pool), or compare with --check`);
    return 1;
  }
  const all = [...(args.set === 'validation' ? [] : exampleTargets()), ...(args.set === 'examples' ? [] : validationTargets())];
  const unknown = (args.only ?? []).filter((label) => !all.some((t) => t.label === label));
  if (unknown.length > 0) { console.error(`--only names no target of --set ${args.set}: ${unknown.join(', ')}; the targets are ${all.map((t) => t.label).join(', ')}`); return 64; }
  const targets = args.only === null ? all : all.filter((t) => (args.only as string[]).includes(t.label));
  if (args.set !== 'validation') {
    const pin = pinnedExamplesCommit(text(join(ROOT, 'scripts', 'fetch-examples.sh')));
    const inputs = new Set(all.flatMap(target => target.example === undefined ? [] : [target.example]));
    const missing = [...inputs].flatMap(key => checkExampleInputs(join(ROOT, 'examples', key, 'inputs'), `examples/${key}/inputs`, pin));
    if (missing.length > 0) { console.error(`${missing.join('\n')}\nEXPECTED_INPUTS_FETCHED: run \`bun run fetch-examples\` first`); return 1; }
  }
  const scratch = mkdtempSync(join(tmpdir(), 'rig-parts-examples-'));
  let ok = false;
  try {
    const produced: Array<{ target: Target; out: Map<string, string | Uint8Array> }> = [];
    for (const target of targets) {
      const started = performance.now();
      const out = target.build(scratch);
      const files = new Map(target.files.map((f) => [f.name, f.produce(out)] as const));
      if (target.checkJson) files.set(MACHINE_CLASS_FILE, machineClassLine(files.get('check.json') as string));
      produced.push({ target, out: files });
      console.log(`built ${target.label} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
      if (args.check && target.example !== undefined) {
        const startedCompose = performance.now();
        composePublicExample(target.label, out, scratch);
        console.log(`composed ${target.label} in ${((performance.now() - startedCompose) / 1000).toFixed(1)} s`);
      }
    }
    if (!args.check) {
      // Emit after green: every build passed before one file is written.
      for (const { target, out } of produced) for (const [name, data] of out) {
        const path = join(ROOT, target.dir, name);
        const before = existsSync(path) ? readFileSync(path) : null;
        writeFileSync(path, data);
        console.log(`${before !== null && Buffer.from(before).equals(Buffer.from(typeof data === 'string' ? Buffer.from(data) : data)) ? 'unchanged' : 'wrote    '} ${target.dir}/${name}`);
      }
      ok = true;
      return 0;
    }
    const faults: string[] = [], machine: string[] = [];
    let compared = 0;
    for (const { target, out } of produced) for (const [name, data] of out) {
      const rel = `${target.dir}/${name}`, path = join(ROOT, rel);
      compared++;
      if (!existsSync(path)) { faults.push(`EXPECTED_IS_THE_BUILD: ${rel} — absent; the build writes it`); continue; }
      const spec = target.files.find((f) => f.name === name);
      const sidecar = name === MACHINE_CLASS_FILE;
      if (sidecar && process.platform !== 'linux') {
        // The digest covers key paths only, which no machine class moves; compare it alone.
        const want = recordedKeyOrder(text(path)), got = recordedKeyOrder(data as string);
        if (want !== got) faults.push(`EXPECTED_IS_THE_BUILD: ${rel} — check.json key order sha256: expected ${show(want)}, built ${show(got)}`);
        continue;
      }
      const r = compareExpected(rel, new Uint8Array(readFileSync(path)), data, process.platform, sidecar ? false : (spec?.json ?? false), spec?.serialize);
      faults.push(...r.faults); machine.push(...r.machine);
    }
    for (const line of [...machine, ...faults]) console.log(line);
    console.log(`regenerate-examples --check: ${compared} file(s) compared on ${process.platform}; ${faults.length} difference(s) from the build; ${machine.length} machine-class difference(s) held to Linux`);
    ok = faults.length === 0;
    return ok ? 0 : 1;
  } finally {
    if (ok) rmSync(scratch, { recursive: true, force: true });
    else console.error(`scratch kept at ${scratch}`);
  }
}

if (import.meta.main) process.exit(main());
