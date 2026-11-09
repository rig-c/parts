#!/usr/bin/env bun
/** Issue #531 and #1256: revision-chain metadata controls and nested --rig gate-copy controls for remesh and retune. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DRAFT_COARSE_GRID, DRAFT_COSTLY_GRID, writeDraftFixtureWithContour } from '../fixtures/meshdraft.ts';
import { RIGC_MODEL_DOCUMENT, rigStage } from '../src/build.ts';
import { packageRigc, type RigcRunner } from '../src/check.ts';
import { PartsError } from '../src/errors.ts';
import { carryProvenance, GATE_TEXT_FILES, hashRows, pngsOf, PROVENANCE_FILE, readTree, remeshStage, sha256, textsOf, type FileTree } from '../src/remesh.ts';
import { RETUNE_FILE, retuneStage } from '../src/retune.ts';
import { rigJsonText, type RigOutput } from '../src/rig.ts';
import { rigOutputFiles, writeRunStamp } from '../src/runstamp.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function runRevisionChainChecks(dir: string, say: Say): void {
  const root = resolve(import.meta.dir, '..');
  const advance = (tree: FileTree, file: 'remesh.json' | 'retune.json'): FileTree => {
    const carried = carryProvenance(tree, tree, file);
    const record = { spec: file === 'remesh.json' ? 'rig-parts-remesh/1' : 'rig-parts-retune/1', input: { rig: hashRows(tree), ...(carried.parents.length === 0 ? {} : { provenance: carried.parents }) }, revision: hashRows(carried.revision) };
    carried.revision.set(file, bytes(rigJsonText(record)));
    return carried.revision;
  };
  for (const key of ['demo', 'reference-demo', 'reference-sample', 'scarf', 'wind']) {
    const base = readTree(join(root, 'examples', key, 'expected'));
    for (const [first, second] of [['remesh.json', 'remesh.json'], ['retune.json', 'retune.json'], ['remesh.json', 'retune.json'], ['retune.json', 'remesh.json']] as const) {
      const parent = advance(base, first), output = advance(parent, second);
      const at = join(dir, key, `${first}-${second}`);
      for (const [file, data] of output) { mkdirSync(join(at, file, '..'), { recursive: true }); writeFileSync(join(at, file), data); }
      const written = readTree(at);
      const record = JSON.parse(readFileSync(join(at, second), 'utf8')) as { input: { provenance: Array<{ source: string; path: string; sha256: string; bytes: number }> }; revision: unknown };
      const before = parent.get(first) as Uint8Array;
      const row = record.input.provenance.find((r) => r.source === first);
      const recovered = row === undefined ? undefined : written.get(row.path);
      const listed = new Map(written); listed.delete(second);
      const identical = same(hashRows(output), hashRows(advance(parent, second)));
      say(`RH698_${key.toUpperCase().replace(/-/g, '_')}_${first.slice(0, -5).toUpperCase()}_${second.slice(0, -5).toUpperCase()}`,
        same(record.revision, hashRows(listed)) && recovered !== undefined && row?.sha256 === sha256(before) && row.bytes === before.length && sha256(recovered) === sha256(before) && identical,
        `${record.input.provenance.length} parent row(s); ${hashRows(listed).length} written hash rows agree; parent recoverable ${recovered !== undefined && sha256(recovered) === sha256(before)}; repeat identical ${identical}; metadata writer only, command acceptance pending`);
    }
  }
  const original = bytes('{"spec":"legacy","bytes":"kept exactly"}\n');
  const file = `provenance/remesh-${sha256(original)}.json`;
  const planted: FileTree = new Map([['remesh.json', original], [file, bytes('different')]]);
  let collision = false;
  try { carryProvenance(planted, planted, 'remesh.json'); }
  catch (e) { collision = e instanceof PartsError && e.problems.some((p) => p.code === 'REMESH_PRESERVED' && p.object === file); }
  say('RH698_A_PARENT_ARCHIVE_COLLISION_IS_REFUSED_WITHOUT_CHANGING_INPUT', collision && new TextDecoder().decode(planted.get(file)) === 'different', `collision refused ${collision}; input untouched`);
}

function rigcRunner(): { rigc: string; runner: RigcRunner } {
  const rigc = packageRigc(resolve(import.meta.dir, '..'));
  const runner: RigcRunner = (args) => {
    const r = spawnSync(rigc, [...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
    return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  return { rigc, runner };
}

/**
 * Populate `<input>/check/build/` with the real `rigc build --profile rig-play --pack --page-edges free --pack-shape polygon`
 * output (including core >=3.5.0's nested `check/build/run.json` stamp and the binary `check/build/skeleton.png` atlas page)
 * plus the root `run.json` stamp `rig-parts rig` writes.
 */
function populateNestedRigBuild(input: string, config: string, rig: RigOutput, runner: RigcRunner): { sourceHash: string } {
  writeRunStamp({
    pkg: { name: '@rig-c/parts', version: 'selftest' },
    command: 'rig',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    outDir: input,
    configPath: config,
    outputPaths: rigOutputFiles(rig),
  });
  const checkBuild = join(input, 'check', 'build');
  const pack = runner(['build', '--rig', join(input, 'rig.json'), '--motion', join(input, 'motion.json'), '--out', checkBuild, '--profile', 'rig-play', '--pack', '--page-edges', 'free', '--pack-shape', 'polygon']);
  if (pack.status !== 0) throw new Error(`rigc build failed (${pack.status}): ${pack.out}`);
  const modelSkins = (JSON.parse(readFileSync(join(checkBuild, RIGC_MODEL_DOCUMENT), 'utf8')) as { skins: Array<{ name: string; attachments: Record<string, Record<string, unknown>> }> }).skins;
  const sourceHash = sha256(bytes(JSON.stringify(modelSkins.find((s) => s.name === 'default')?.attachments.strip.strip)));
  return { sourceHash };
}

function caughtEnoent(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    return err?.code === 'ENOENT' ? err.message : `unexpected: ${String(e)}`;
  }
}

function preservedByteCount(inTree: FileTree, outTree: FileTree, spliced: ReadonlySet<string>): { preserved: number; expected: number; drifted: string[] } {
  const drifted: string[] = [];
  let preserved = 0;
  let expected = 0;
  for (const [k, b] of inTree) {
    if (spliced.has(k)) continue;
    expected++;
    const got = outTree.get(k);
    if (got !== undefined && got.byteLength === b.byteLength && sha256(got) === sha256(b)) preserved++;
    else drifted.push(k);
  }
  return { preserved, expected, drifted };
}

/** Issue #1256: remesh gate copy receives only rig.json, motion.json and images/; nested files in --rig are preserved byte-for-byte. */
export function runRemeshGateCopyChecks(dir: string, say: Say): void {
  mkdirSync(dir, { recursive: true });
  const { rigc, runner } = rigcRunner();
  const versions = { parts: 'selftest', rigc: 'selftest' };
  const fx = writeDraftFixtureWithContour(join(dir, 'fx'), DRAFT_COARSE_GRID);
  const input = join(dir, 'input');
  const rigOut = rigStage({ config: fx.config, parts: fx.parts, out: input }, runner, join(dir, 'input-gate'), () => {});
  const { sourceHash } = populateNestedRigBuild(input, fx.config, rigOut, runner);
  const inTree = readTree(input);
  const stamp = JSON.parse(readFileSync(join(input, 'check', 'build', 'run.json'), 'utf8')) as { spec?: string; command?: string };
  const pngBytes = inTree.get('check/build/skeleton.png');
  const pngMagic = pngBytes !== undefined && pngBytes.byteLength > 8 && pngBytes[0] === 0x89 && pngBytes[1] === 0x50 && pngBytes[2] === 0x4e && pngBytes[3] === 0x47;
  const gateTexts = textsOf(inTree).map(([k]) => k);
  const gatePngs = pngsOf(inTree).map(([k]) => k);

  const gridReq = join(dir, 'grid.json');
  writeFileSync(gridReq, `${JSON.stringify({ grid: DRAFT_COSTLY_GRID, r: 8, segments: ['tail'] })}\n`);
  const deltaReq = join(dir, 'delta.json');
  writeFileSync(
    deltaReq,
    `${JSON.stringify({
      schema: 'rig-review-mesh-edit/1',
      slot: 'strip',
      skin: 'default',
      attachment: 'strip',
      source: { vertexCount: 126, triangleCount: 164, hullLength: 86, hash: sourceHash },
      units: 'crop px, x right, y down; vertex ids are source indices, added vertices take the next id in op order, removed ids are not reused',
      basis: 'setup',
      preview: 'preview only — the producer retriangulates; the ops are a request over the original triangulation, not a mesh',
      ops: [{ op: 'move', v: 100, from: [18, 156], to: [19.5, 154] }],
    })}\n`,
  );

  const outMesh = join(dir, 'out-mesh');
  remeshStage({ rig: input, config: fx.config, parts: fx.parts, part: 'strip', mesh: gridReq, out: outMesh }, runner, rigc, versions, join(dir, 'scratch-mesh'), () => {});
  const outMeshTree = readTree(outMesh);
  const meshPreserved = preservedByteCount(inTree, outMeshTree, new Set(['rig.json', 'mesh_report.json']));

  const outDelta = join(dir, 'out-delta');
  remeshStage({ rig: input, config: fx.config, parts: fx.parts, part: 'strip', delta: deltaReq, out: outDelta }, runner, rigc, versions, join(dir, 'scratch-delta'), () => {});
  const outDeltaTree = readTree(outDelta);
  const deltaPreserved = preservedByteCount(inTree, outDeltaTree, new Set(['rig.json', 'mesh_report.json']));

  const outPlantMesh = join(dir, 'out-plant-mesh');
  const enoentMesh = caughtEnoent(() =>
    remeshStage({ rig: input, config: fx.config, parts: fx.parts, part: 'strip', mesh: gridReq, out: outPlantMesh }, runner, rigc, versions, join(dir, 'scratch-plant-mesh'), () => {}, { unfilteredGateTexts: true }),
  );
  const outPlantDelta = join(dir, 'out-plant-delta');
  const enoentDelta = caughtEnoent(() =>
    remeshStage({ rig: input, config: fx.config, parts: fx.parts, part: 'strip', delta: deltaReq, out: outPlantDelta }, runner, rigc, versions, join(dir, 'scratch-plant-delta'), () => {}, { unfilteredGateTexts: true }),
  );
  const inAfter = readTree(input);
  const inputUntouched = same(hashRows(inTree), hashRows(inAfter));

  const ok =
    stamp.spec === 'rigc-run/1' &&
    stamp.command === 'build' &&
    pngMagic &&
    same(gateTexts, [...GATE_TEXT_FILES]) &&
    same(gatePngs, ['mark.png', 'strip.png']) &&
    inTree.size === 11 &&
    outMeshTree.has(PROVENANCE_FILE) &&
    meshPreserved.preserved === 9 &&
    meshPreserved.expected === 9 &&
    meshPreserved.drifted.length === 0 &&
    outDeltaTree.has(PROVENANCE_FILE) &&
    deltaPreserved.preserved === 9 &&
    deltaPreserved.expected === 9 &&
    deltaPreserved.drifted.length === 0 &&
    enoentMesh !== null &&
    enoentMesh.includes('gate/check/build/run.json') &&
    !existsSync(outPlantMesh) &&
    enoentDelta !== null &&
    enoentDelta.includes('gate-input/check/build/run.json') &&
    !existsSync(outPlantDelta) &&
    inputUntouched;

  say(
    'RM35_A_NESTED_CHECK_BUILD_TREE_WITH_RUN_JSON_AND_BINARY_ATLAS_IS_PRESERVED_AND_THE_UNFILTERED_GATE_COPY_FAILS_ENOENT',
    ok,
    `input ${inTree.size} file(s) (check/build/run.json spec=${stamp.spec ?? 'none'}, check/build/skeleton.png ${pngBytes?.byteLength ?? 0}B PNG=${pngMagic}); gate texts=[${gateTexts.join(',')}], pngs=[${gatePngs.join(',')}]; --mesh preserved ${meshPreserved.preserved}/${meshPreserved.expected} non-spliced file(s) (drifted: ${meshPreserved.drifted.join(',') || 'none'}); --delta preserved ${deltaPreserved.preserved}/${deltaPreserved.expected} non-spliced file(s) (drifted: ${deltaPreserved.drifted.join(',') || 'none'}); planted unfilteredGateTexts: --mesh=${enoentMesh ?? 'green'}, --delta=${enoentDelta ?? 'green'}`,
  );
}

/** Issue #1256: retune shares textsOf/pngsOf with remesh; nested files in --rig are preserved byte-for-byte and planted unfiltered copy fails ENOENT. */
export function runRetuneGateCopyChecks(dir: string, say: Say): void {
  mkdirSync(dir, { recursive: true });
  const { rigc, runner } = rigcRunner();
  const versions = { parts: 'selftest', rigc: 'selftest' };
  const fxDir = join(dir, 'fx');
  const fx = writeDraftFixtureWithContour(fxDir, DRAFT_COARSE_GRID);
  const base = JSON.parse(readFileSync(fx.config, 'utf8')) as Record<string, unknown>;
  const physics = { name: 'tail1_physics', type: 'physics', bone: 'tail1', rotate: 1, inertia: 0.5, strength: 60, damping: 0.85, mass: 1, mix: 1 };
  base.constraints = [physics];
  writeFileSync(fx.config, `${JSON.stringify(base, null, 2)}\n`);
  const damping = join(fxDir, 'config-damping.json');
  writeFileSync(damping, `${JSON.stringify({ ...base, constraints: [{ ...physics, damping: 0.7 }] }, null, 2)}\n`);

  const input = join(dir, 'input');
  const rigOut = rigStage({ config: fx.config, parts: fx.parts, out: input }, runner, join(dir, 'input-gate'), () => {});
  populateNestedRigBuild(input, fx.config, rigOut, runner);
  const inTree = readTree(input);

  const outRetune = join(dir, 'out-retune');
  retuneStage({ rig: input, config: damping, parts: fx.parts, out: outRetune }, runner, rigc, versions, join(dir, 'scratch-retune'), () => {});
  const outRetuneTree = readTree(outRetune);
  const retunePreserved = preservedByteCount(inTree, outRetuneTree, new Set(['rig.json']));

  const outPlant = join(dir, 'out-plant');
  const enoentPlant = caughtEnoent(() =>
    retuneStage({ rig: input, config: damping, parts: fx.parts, out: outPlant }, runner, rigc, versions, join(dir, 'scratch-plant'), () => {}, { unfilteredGateTexts: true }),
  );
  const inputUntouched = same(hashRows(inTree), hashRows(readTree(input)));

  const ok =
    inTree.size === 11 &&
    outRetuneTree.has(RETUNE_FILE) &&
    retunePreserved.preserved === 10 &&
    retunePreserved.expected === 10 &&
    retunePreserved.drifted.length === 0 &&
    enoentPlant !== null &&
    enoentPlant.includes('check/build/run.json') &&
    !existsSync(outPlant) &&
    inputUntouched;

  say(
    'RN14_A_NESTED_CHECK_BUILD_TREE_WITH_RUN_JSON_AND_BINARY_ATLAS_IS_PRESERVED_BY_RETUNE_AND_THE_UNFILTERED_GATE_COPY_FAILS_ENOENT',
    ok,
    `input ${inTree.size} file(s); retune preserved ${retunePreserved.preserved}/${retunePreserved.expected} unchanged file(s) (9 non-spliced + motion.json; drifted: ${retunePreserved.drifted.join(',') || 'none'}); planted unfilteredGateTexts: ${enoentPlant ?? 'green'}`,
  );
}

if (import.meta.main) {
  const root = mkdtempSync(join(tmpdir(), 'parts-revision-chain-'));
  let failed = 0;
  let measured = 0;
  const report: Say = (name, ok, detail) => {
    measured++;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
  };
  try {
    runRevisionChainChecks(join(root, 'chain'), report);
    runRemeshGateCopyChecks(join(root, 'remesh-1256'), report);
    runRetuneGateCopyChecks(join(root, 'retune-1256'), report);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log(`REVISION_CHAIN ${failed === 0 ? 'PASS' : 'FAIL'}: ${failed} failure(s), ${measured} control(s)`);
  process.exitCode = failed === 0 && measured > 0 ? 0 : 1;
}
