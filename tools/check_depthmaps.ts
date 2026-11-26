/** Independent analytic controls for #897; no private art or measured expectations. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { RECEIPT_AUTHOR_FILE, writeEditorReceiptFixture } from '../fixtures/editor_receipts.ts';
import { rigParts } from '../fixtures/rig.ts';
import { failLine, PartsError } from '../src/errors.ts';
import { configFileReferences } from '../src/config.ts';
import { alphaSupport, floatBox, integrateNormals, mapToSheet, readNumericMap, type NumericMap } from '../src/depthmaps.ts';
import { applyDepth, bindDepthMap, parseDepthRecipe, prepareDepth } from '../src/depthworkflow.ts';
import { depthImageReference, readParts, writeParts } from '../src/parts.ts';
import { assemblyConfigChanges, assemblyConfigReading } from '../src/assembly-reading.ts';
import { assembleStage, readRigInputs } from '../src/build.ts';
import { buildRig } from '../src/rig.ts';
import { depthReading } from '../src/depthsheets.ts';
import { type EditedPartReceipt } from '../src/editedparts.ts';
import { type EditorReceipt, readEditorReceipts } from '../src/editreceipt.ts';
import { relocateConfigReferences } from '../src/configrelocation.ts';
import { scratchConfig } from '../src/meshdraft.ts';
import { isSkeletonName, KEYPOINT_NAMES } from '../src/skeleton.ts';
import { encodePngBytes, readPng, writePng } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
import { editedPartPngBytes } from './check_edited_parts.ts';
type Say = (name: string, ok: boolean, detail: string) => void;
const json = (p: string, v: unknown): void => writeFileSync(p, JSON.stringify(v) + '\n');
const codes = (fn: () => unknown): string[] => { try { fn(); return []; } catch (e) { if (!(e instanceof PartsError)) throw e; return e.problems.map(p => `${p.code}: ${p.object}`); } };
function files(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name), key = prefix + ent.name;
    if (ent.isDirectory()) Object.assign(out, files(path, key + '/')); else out[key] = readFileSync(path).toString('hex');
  }
  return out;
}
const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const pretty = (raw: unknown): string => JSON.stringify(raw, null, 2) + '\n';
type Obj = Record<string, unknown>;
type EditedBlock = { dir: string; receipts: EditedPartReceipt[] };

/** #1311: file identity is authored; only the shared directory may move. */
function canonicalEditedBlock(block: EditedBlock, original: EditedBlock, expectedDir: string): boolean {
  return block.dir === expectedDir && block.receipts.length === original.receipts.length &&
    block.receipts.every((receipt, i) => Object.entries(original.receipts[i]).every(([key, value]) =>
      receipt[key as keyof EditedPartReceipt] === value));
}

/** The pre-#1283 private list, retained as an independent output oracle and bug plant. */
function legacyDepthConfig(raw: Obj, rigConfig: string, out: string, pivot: number): Obj {
  const result = structuredClone(raw);
  (result.turn as Obj).pivot = pivot;
  const motion = result.motion as Obj | undefined;
  if (typeof motion?.animations_from === 'string') motion.animations_from = relative(resolve(out), resolve(dirname(rigConfig), motion.animations_from));
  const control = (result.generation as Obj | undefined)?.control as Obj | undefined;
  if (typeof control?.skeleton === 'string' && !isSkeletonName(control.skeleton)) control.skeleton = relative(resolve(out), resolve(dirname(rigConfig), control.skeleton));
  if (typeof result.requirements === 'string') result.requirements = relative(resolve(out), resolve(dirname(rigConfig), result.requirements));
  return result;
}

/** Narrow #1283 proof: real core-gated build, two receipts, and default/legacy output bytes. */
export function runDepthRelocationChecks(dir: string, say: Say): void {
  const input = join(dir, 'input'), config = writeEditorReceiptFixture(input, { author: false });
  config.bones = [...(config.bones as Obj[]), { name: 'head', parent: 'anchor', at: [32, 32] }];
  config.regions = { ...(config.regions as Obj), face: 'head' };
  config.turn = { pivot: 30, roles: { face: 'surface' } };
  // Match the flat-block breath track in fixtures/alternate_cut_layers.ts.
  config.motion = { duration: 1, tracks: [{ bone: 'anchor', prop: 'translatey', amp: 2, period: 1, phase: 0 }] };
  // Supply the surface's authored scalar input so the initial full build can run its real gate.
  const initialDepth = newRaster(48, 24);
  for (let i = 0; i < 48 * 24; i++) initialDepth.data.set([128, 128, 128, 255], i * 4);
  const initialDepthPath = resolve(input, 'face-depth.png'); writePng(initialDepthPath, initialDepth);
  config.depth = { full: { layers: { face: { image: initialDepthPath, near: 'white', zScale: 100 } } } };
  const configPath = join(input, 'config.json'); json(configPath, config);
  const assemble = (cfg: string, out: string): void => {
    assembleStage({ source: join(input, 'painting.png'), full: join(input, 'full'), head: null, config: cfg }, {
      partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'),
      recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, 'recomposite_error_rig.png'),
    }, () => {});
  };
  const baseline = join(dir, 'baseline'); assemble(configPath, baseline);
  const baselineParts = readParts(join(baseline, 'parts.json'));
  const face = baselineParts.parts.find(p => p.name === 'face')!;
  const art = readPng(join(baseline, 'parts/face.png'));
  const data = Array.from({ length: face.w * face.h }, (_, i) => i % face.w + 2 * Math.floor(i / face.w));
  const recipe = parseDepthRecipe({ spec: 'rig-parts-depth/1', prepare: { longSide: 48, paddingFraction: 0, padding: 0 },
    groups: { head: { near: 'white', zScale: 100, pivot: 31 } },
    parts: { face: { map: 'map.json', source: 'depth', frame: 'part', group: 'head', median: 50, relief: 10 } }, clear: [] });
  const recipePath = join(dir, 'depth.json'), mapPath = join(dir, 'map.json'); json(recipePath, recipe);
  json(mapPath, { spec: 'rig-parts-map/1', width: face.w, height: face.h, channels: 1, data });
  const { sheet, reading } = mapToSheet(data, art, 50, 10, 'white', 100, 'face');
  const sheetBytes = encodePngBytes(sheet), mapSha256 = sha256(readFileSync(mapPath));
  const generation = { checkpoint: 'fixture', loras: [], trigger: '', identity: 'fixture',
    sampler: { steps: 1, cfg: 1, sampler: 'fixture', scheduler: 'fixture' }, costume: 'fixture', negative_extra: '',
    style: 'fixture', negative_pose: 'fixture', latent: [64, 64], seed: 0, pose: 'standing',
    control: { skeleton: 'pose.json', strength: 1, end_percent: 1 } };
  json(join(input, 'pose.json'), { width: 64, height: 64, points: Object.fromEntries(KEYPOINT_NAMES.map(name => [name, [32, 32]])) });
  json(join(input, 'animations.json'), { spec: 'rigc-motion/1', animations: { extra: { duration: 1, tracks: [] } } });
  json(join(input, 'requirements.json'), { spec: 'spine-parts-requirements/1', fps: 12, requirements: [] });
  const legacy = { ...config, requirements: 'requirements.json', motion: { ...(config.motion as Obj), animations_from: 'animations.json' }, generation };
  const relativeDepth = { full: { layers: { face: { image: 'face-depth.png', near: 'white', zScale: 100 } } } };
  const absolute = { ...legacy, requirements: resolve(input, 'requirements.json'),
    motion: { ...legacy.motion, animations_from: resolve(input, 'animations.json') },
    generation: { ...generation, control: { ...generation.control, skeleton: resolve(input, 'pose.json') } } };
  const builtin = { ...legacy, generation: { ...generation, control: { ...generation.control, skeleton: 'stand_clasp' } } };
  const digests = new Map<string, string | undefined>();
  for (const [name, raw] of [['DEFAULT', config], ['RELATIVE', { ...legacy, depth: relativeDepth }], ['ABSOLUTE', absolute], ['BUILTIN', builtin]] as const) {
    const cfg = join(input, name.toLowerCase() + '.json'), out = join(dir, 'legacy-' + name.toLowerCase()); json(cfg, raw);
    const caseBaseline = name === 'DEFAULT' ? baseline : join(dir, 'baseline-' + name.toLowerCase());
    if (name !== 'DEFAULT') assemble(cfg, caseBaseline);
    const caseParts = readParts(join(caseBaseline, 'parts.json'));
    digests.set(name, caseParts.assembly_config?.sha256);
    const prepared = join(dir, 'prepared-' + name.toLowerCase());
    const manifest = prepareDepth({ parts: caseBaseline, config: recipePath, out: prepared });
    const manifestPath = join(prepared, 'manifest.json'), preparedFace = manifest.parts[0];
    const expectedParts = JSON.parse(readFileSync(join(caseBaseline, 'parts.json'), 'utf8')) as { parts: Obj[] };
    expectedParts.parts.find(p => p.name === 'face')!.depth = { image: 'face_depth.png', near: 'white', zScale: 100,
      sources: [{ from: face.from, image: 'map.json', sha256: mapSha256, crop: [0, 0, face.w, face.h], reading: depthReading(sheet, art, null) }] };
    const expectedReport = (cfg: string): unknown => ({ spec: 'rig-parts-depth-report/1', partsSha256: sha256(readFileSync(join(caseBaseline, 'parts.json'))),
      recipeSha256: sha256(pretty(recipe)), manifestSha256: sha256(readFileSync(manifestPath)), rigConfigSha256: sha256(readFileSync(cfg)),
      alpha: 128, normalization: 'median, linear p5..p95', extension: 'nearest alpha>=128, row-major ties', cleared: [],
      parts: [{ part: 'face', group: 'head', source: 'depth', frame: 'part', sourceSha256: preparedFace.sourceSha256,
        mapSha256, inputSha256: preparedFace.inputSha256, sheetSha256: sha256(sheetBytes), median: 50, relief: 10,
        near: 'white', zScale: 100, pivot: 31, ...reading, sign: 1 }] });
    applyDepth({ parts: caseBaseline, manifest: manifestPath, config: recipePath, rigConfig: cfg, out });
    // No expected byte is read from applyDepth's output. The old function owns config text;
    // analytic map/manifest inputs own the new sheet, manifest and report; source bytes own retained files.
    const expectedConfig = legacyDepthConfig(raw, cfg, out, 31) as Obj;
    if (name === 'RELATIVE') expectedConfig.depth = { full: { layers: {
      face: { ...relativeDepth.full.layers.face, image: relative(out, initialDepthPath) },
    } } };
    const expected: Record<string, string> = { ...files(caseBaseline), 'parts/face_depth.png': Buffer.from(sheetBytes).toString('hex'),
      'parts.json': Buffer.from(pretty(expectedParts)).toString('hex'),
      'config.json': Buffer.from(pretty(expectedConfig)).toString('hex'),
      'depth-report.json': Buffer.from(pretty(expectedReport(cfg))).toString('hex') };
    if (face.depth !== undefined && depthImageReference(face.depth).path !== 'parts/face_depth.png') delete expected[depthImageReference(face.depth).path];
    const actual = files(out), names = Object.keys(expected).sort();
    const mismatches = [...new Set([...names, ...Object.keys(actual)])].filter(key => actual[key] !== expected[key]);
    say('DMP1283_' + name + '_LEGACY_OUTPUT_BYTES', mismatches.length === 0,
      JSON.stringify({ expectedFiles: names, actualFiles: Object.keys(actual).sort(), mismatches }));
    const read = readRigInputs(join(out, 'config.json'), out);
    say('DMP1283_' + name + '_OUTPUT_READER', caseParts.assembly_config !== undefined &&
      read.parts.assembly_config?.sha256 === caseParts.assembly_config.sha256 &&
      read.cfg.turn?.pivot === 31 && read.images.has('face_depth.png') &&
      (name === 'DEFAULT' || (read.cfg.requirements !== undefined && read.from !== null)),
      'actual output reader retains the assembly stamp and resolves the legacy inputs and generated depth sheet');
  }

  const relativeParts = readParts(join(dir, 'baseline-relative/parts.json'));
  const builtinParts = readParts(join(dir, 'baseline-builtin/parts.json'));
  const builtinName = join(input, 'changed-builtin.json'), missing = join(input, 'missing-pose.json');
  json(builtinName, { ...builtin, generation: { ...generation, control: { ...generation.control, skeleton: 'stand_sides' } } });
  json(missing, { ...legacy, generation: { ...generation, control: { ...generation.control, skeleton: 'missing.json' } } });
  const skeletonField = 'generation.control.skeleton';
  const relativeDigest = digests.get('RELATIVE'), absoluteDigest = digests.get('ABSOLUTE');
  const relocatedParts = readParts(join(dir, 'legacy-relative/parts.json'));
  const relocatedDigest = assemblyConfigReading(join(dir, 'legacy-relative/config.json'), relocatedParts).sha256;
  say('DMP1385_RELOCATED_SKELETON_CONTENT',
    relativeDigest !== undefined && relativeDigest === absoluteDigest && relativeDigest === relocatedDigest,
    JSON.stringify({ relativeDigest, absoluteDigest, relocatedDigest }));
  const pose = join(input, 'pose.json'), poseBytes = readFileSync(pose);
  writeFileSync(pose, Buffer.concat([poseBytes, Buffer.from('\n')]));
  try {
    const changed = assemblyConfigChanges(join(input, 'relative.json'), relativeParts);
    say('DMP1385_SKELETON_FILE_BYTES_STALE', changed.join(',') === skeletonField, JSON.stringify(changed));
  } finally {
    writeFileSync(pose, poseBytes);
  }
  const sheetBefore = readFileSync(initialDepthPath);
  initialDepth.data.set([133, 133, 133, 255], 0);
  writePng(initialDepthPath, initialDepth);
  try {
    const changed = assemblyConfigChanges(join(input, 'relative.json'), relativeParts);
    say('DMP1385_DEPTH_FILE_BYTES_STALE', changed.join(',') === 'depth', JSON.stringify(changed));
  } finally {
    writeFileSync(initialDepthPath, sheetBefore);
  }
  const builtinChanged = assemblyConfigChanges(builtinName, builtinParts);
  say('DMP1385_BUILTIN_NAME_STALE', builtinChanged.join(',') === skeletonField, JSON.stringify(builtinChanged));
  const missingFaults = codes(() => assemblyConfigReading(missing, relativeParts));
  say('DMP1385_MISSING_SKELETON_REFUSED', missingFaults.includes('CONFIG_FILE_PRESENT: config.' + skeletonField), JSON.stringify(missingFaults));

  const edits = join(input, 'edits'), receipts: EditedPartReceipt[] = [];
  for (const [i, part] of ['face', 'body'].entries()) {
    const before = readFileSync(join(baseline, 'parts', part + '.png')), image = readPng(join(baseline, 'parts', part + '.png'));
    image.data[(Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4] += i + 1;
    const bytes = editedPartPngBytes(image), file = part + '/paint.png';
    mkdirSync(join(edits, part), { recursive: true }); writeFileSync(join(edits, file), bytes);
    receipts.push({ part, file, sha256: sha256(bytes), from_sha256: sha256(before), editor: 'synthetic depth relocation fixture' });
  }
  const edited = { ...config, assemble: { ...(config.assemble as Obj), edited_parts: { dir: 'edits', receipts } } };
  const editedPath = join(input, 'edited.json'); json(editedPath, edited);
  const built = join(dir, 'build'), cli = join(import.meta.dir, '../cli.ts');
  const run = spawnSync(process.execPath, [cli, 'build', '--source', join(input, 'painting.png'), '--full', join(input, 'full'),
    '--config', editedPath, '--out', built, '--no-extremes'], { encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 23 });
  writeFileSync(join(dir, 'build.stdout.txt'), run.stdout ?? ''); writeFileSync(join(dir, 'build.stderr.txt'), run.stderr ?? '');
  const checkPath = join(built, 'check/check.json');
  const check = existsSync(checkPath) ? JSON.parse(readFileSync(checkPath, 'utf8')) as { PASS: boolean; gate_spine_html_green: boolean; rigc_entry: { entry: string; spine_core: string | null } } : null;
  const builtGreen = run.status === 0 && check?.PASS === true && check.gate_spine_html_green === true;
  say('DMP1283_EDITED_FULL_BUILD_REAL_CORE_GATE', builtGreen,
    JSON.stringify({ exit: run.status, signal: run.signal, error: run.error?.message, gate: check?.gate_spine_html_green,
      entry: check?.rigc_entry, logs: ['build.stdout.txt', 'build.stderr.txt'],
      ...(builtGreen ? {} : { outputTail: ((run.stdout ?? '') + (run.stderr ?? '')).slice(-4000) }) }));
  if (!builtGreen) return;

  const cliRun = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 1 << 23,
  });
  const cliOutput = (run: ReturnType<typeof cliRun>): string => run.stdout + run.stderr;
  const boundHandoff = (name: string, parts: string, cfg: string, expectStamp = true): string => {
    const prepared = join(dir, name + '-inference'), bound = join(dir, name + '-bound');
    const rig = join(dir, name + '-rig'), map = join(dir, name + '-map.json');
    const bindingRecipe = join(dir, name + '-recipe.json');
    writeFileSync(map, readFileSync(mapPath));
    json(bindingRecipe, { ...recipe, parts: { face: { ...recipe.parts.face, map: relative(dir, map) } } });
    const prepare = cliRun('depth-prepare', '--parts', parts, '--config', bindingRecipe, '--out', prepared);
    const bind = cliRun('depth-bind', '--map', map, '--input', join(prepared, 'face.png'), '--part', 'face');
    const apply = (config: string, out: string) => cliRun('depth-apply', '--parts', parts, '--manifest',
      join(prepared, 'manifest.json'), '--config', bindingRecipe, '--rig-config', config, '--out', out);
    const applied = apply(cfg, bound);
    const boundConfig = join(bound, 'config.json');
    const rigged = cliRun('rig', '--parts', bound, '--config', boundConfig, '--out', rig);
    const before = readParts(join(parts, 'parts.json')).assembly_config;
    const afterPath = join(bound, 'parts.json');
    const after = existsSync(afterPath) ? readParts(afterPath).assembly_config : undefined;
    const runs = [prepare, bind, applied, rigged];
    const rigSheets = join(rig, 'depth_sheets.json');
    say('DMP1388_' + name + '_BOUND_RIG',
      runs.every(run => run.status === 0) && !cliOutput(applied).includes('DEPTH_MAP_BINDING_ABSENT') &&
      (before !== undefined) === expectStamp && JSON.stringify(before) === JSON.stringify(after) &&
      existsSync(rigSheets) && JSON.parse(readFileSync(rigSheets, 'utf8')).spec === 'rig-parts-depth-sheets/1',
      JSON.stringify(runs.map(run => ({ exit: run.status, stderr: run.stderr, error: run.error?.message }))));
    if (name === 'ASSEMBLED') {
      const stale = join(dirname(cfg), 'stale-resolution.json');
      const raw = JSON.parse(readFileSync(cfg, 'utf8'));
      raw.seethrough.resolution += 1;
      json(stale, raw);
      const rejected = join(dir, 'stale-depth-out'), attempt = apply(stale, rejected);
      const staleField = 'assembly config changed at config.seethrough.resolution; re-run assemble';
      const refusal = (run: ReturnType<typeof cliRun>): boolean =>
        run.status === 1 && cliOutput(run).includes('ASSEMBLY_CONFIG_STALE:') && cliOutput(run).includes(staleField);
      say('DMP1388_STALE_DEPTH_INPUT_NO_OUTPUT', refusal(attempt) && !existsSync(rejected),
        JSON.stringify({ exit: attempt.status, output: cliOutput(attempt), outputExists: existsSync(rejected) }));
      if (applied.status === 0) {
        const staleBound = join(bound, 'stale-resolution.json'), out = join(dir, 'stale-rig-out');
        const relocated = JSON.parse(readFileSync(boundConfig, 'utf8'));
        relocated.seethrough.resolution += 1;
        json(staleBound, relocated);
        const rejectedRig = cliRun('rig', '--parts', bound, '--config', staleBound, '--out', out);
        say('DMP1388_STALE_BOUND_CONFIG_REFUSED', refusal(rejectedRig),
          JSON.stringify({ exit: rejectedRig.status, output: cliOutput(rejectedRig) }));
      }
    }
    return bound;
  };
  const cliAssembly = join(dir, 'cli-assembly');
  const assembled = cliRun('assemble', '--source', join(input, 'painting.png'), '--full', join(input, 'full'),
    '--config', configPath, '--out', cliAssembly);
  say('DMP1388_ASSEMBLE_CLI', assembled.status === 0 && existsSync(join(cliAssembly, 'rig/parts.json')),
    JSON.stringify({ exit: assembled.status, stderr: assembled.stderr }));
  if (assembled.status === 0) boundHandoff('ASSEMBLED', join(cliAssembly, 'rig'), configPath);
  const boundEdited = boundHandoff('EDITED', built, editedPath);
  say('DMP1388_BOUND_EDITED_ART_BYTES', receipts.every(receipt => {
    const output = join(boundEdited, 'parts', receipt.part + '.png');
    return existsSync(output) && readFileSync(output).equals(readFileSync(join(edits, receipt.file)));
  }), 'both bound edited PNGs retain the authored bytes');
  const legacyParts = join(dir, 'unstamped');
  cpSync(baseline, legacyParts, { recursive: true });
  const legacyManifest = join(legacyParts, 'parts.json'), unstamped = JSON.parse(readFileSync(legacyManifest, 'utf8'));
  delete unstamped.assembly_config;
  json(legacyManifest, unstamped);
  const legacyRigConfig = join(input, 'legacy-rig.json');
  const legacyRaw = { ...config };
  delete legacyRaw.seethrough;
  json(legacyRigConfig, legacyRaw);
  boundHandoff('LEGACY', legacyParts, legacyRigConfig, false);

  const editedPrepared = join(dir, 'edited-prepared'); prepareDepth({ parts: built, config: recipePath, out: editedPrepared });
  const depthOut = join(dir, 'edited-depth');
  applyDepth({ parts: built, manifest: join(editedPrepared, 'manifest.json'), config: recipePath, rigConfig: editedPath, out: depthOut });
  const emitted = JSON.parse(readFileSync(join(depthOut, 'config.json'), 'utf8')) as typeof edited;
  const relocated = emitted.assemble.edited_parts;
  say('DMP1283_TWO_RECEIPTS_RELATIVE_POSIX_AND_SAME_FILES', canonicalEditedBlock(relocated, edited.assemble.edited_parts, '../input/edits') &&
    relocated.receipts.every((r, i) => !isAbsolute(r.file) && !r.file.includes('\\') &&
      readFileSync(resolve(depthOut, relocated.dir, r.file)).equals(readFileSync(join(edits, receipts[i].file)))),
    JSON.stringify(relocated));
  const reassembled = join(dir, 'reassembled'); assemble(join(depthOut, 'config.json'), reassembled);
  const exact = (out: string): boolean => receipts.every(r => readFileSync(join(out, 'parts', r.part + '.png')).equals(readFileSync(join(edits, r.file))));
  say('DMP1283_EDITED_BUILD_DEPTH_REASSEMBLE_RECEIPT_BYTES', exact(built) && exact(depthOut) && exact(reassembled),
    'two distinct edited PNGs, including ancillary encoding, survive full build, depth-prepare, depth-apply and real reassembly');

  // Reuse the same core-gated build, edited PNGs and prepare manifest. No new full build.
  const base = join(dir, 'nested-base'), configDir = join(base, 'configs/a/b'), receiptDir = join(base, 'inputs/set');
  mkdirSync(configDir, { recursive: true }); mkdirSync(receiptDir, { recursive: true });
  const nestedBlock: EditedBlock = { dir: '../../../inputs/set', receipts: receipts.map((r, i) => {
    const file = i === 0 ? 'hair_back.png' : 'body.png';
    writeFileSync(join(receiptDir, file), readFileSync(join(edits, r.file)));
    return { ...r, file };
  }) };
  const nestedRaw = { ...config, assemble: { ...(config.assemble as Obj), edited_parts: nestedBlock } };
  const nestedConfig = join(configDir, 'config.json'); json(nestedConfig, nestedRaw);
  const sourceConfigBytes = readFileSync(nestedConfig);
  const sourceBytes = nestedBlock.receipts.map(r => readFileSync(join(receiptDir, r.file)));
  const nestedOut = join(configDir, 'mapped'), expectedDir = '../../../../inputs/set';
  applyDepth({ parts: built, manifest: join(editedPrepared, 'manifest.json'), config: recipePath, rigConfig: nestedConfig, out: nestedOut });
  const readBlock = (file: string): EditedBlock =>
    (JSON.parse(readFileSync(file, 'utf8')) as { assemble: { edited_parts: EditedBlock } }).assemble.edited_parts;
  const nestedEmitted = readBlock(join(nestedOut, 'config.json'));
  const canonicalName = 'DMP1311_INSIDE_CONFIG_CANONICAL_RECEIPTS';
  const checkCanonical = (block: EditedBlock, report: Say): void =>
    report(canonicalName, canonicalEditedBlock(block, nestedBlock, expectedDir),
      'dir ../../../../inputs/set; original hair_back.png and body.png receipts unchanged');
  checkCanonical(nestedEmitted, say);
  const nestedReassembled = join(dir, 'nested-reassembled'); assemble(join(nestedOut, 'config.json'), nestedReassembled);
  const receiptBytesMatch = (block: EditedBlock, configAt: string, assembled: string): boolean =>
    block.receipts.length === sourceBytes.length && block.receipts.every((r, i) => {
      const resolved = resolve(configAt, block.dir, r.file), emittedPart = join(assembled, 'parts', r.part + '.png');
      const hash = sha256(sourceBytes[i]);
      return hash === nestedBlock.receipts[i].sha256 && sha256(readFileSync(join(receiptDir, nestedBlock.receipts[i].file))) === hash &&
        existsSync(resolved) && sha256(readFileSync(resolved)) === hash &&
        existsSync(emittedPart) && sha256(readFileSync(emittedPart)) === hash;
    });
  say('DMP1311_INSIDE_CONFIG_SOURCE_RESOLVED_REASSEMBLED_HASHES',
    receiptBytesMatch(nestedEmitted, nestedOut, nestedReassembled) &&
    receiptBytesMatch(nestedEmitted, nestedOut, nestedOut),
    'both source, resolved receipt, depth output and reassembled PNG SHA-256 equal the authored receipt');
  const rigImageHashesMatch = (out: string): boolean => {
    const rig = readRigInputs(join(out, 'config.json'), out);
    return nestedBlock.receipts.every(r => {
      const image = rig.images.get(r.part);
      return image !== undefined && sha256(Buffer.from(image.data)) ===
        sha256(Buffer.from(readPng(join(receiptDir, r.file)).data));
    });
  };
  say('DMP1311_INSIDE_CONFIG_RIG_READER_IMAGE_HASHES', rigImageHashesMatch(nestedOut),
    'actual rig reader has both part images; decoded pixel SHA-256 equals each source receipt PNG');

  const otherOut = join(base, 'output/deeper');
  applyDepth({ parts: built, manifest: join(editedPrepared, 'manifest.json'), config: recipePath, rigConfig: nestedConfig, out: otherOut });
  const otherEmitted = readBlock(join(otherOut, 'config.json'));
  say('DMP1311_OTHER_DEPTH_CANONICAL_RECEIPTS', canonicalEditedBlock(otherEmitted, nestedBlock, '../../inputs/set'),
    'same configs/a/b input, output/deeper destination; dir ../../inputs/set and original receipt files unchanged');
  const otherReassembled = join(dir, 'other-depth-reassembled'); assemble(join(otherOut, 'config.json'), otherReassembled);
  say('DMP1311_OTHER_DEPTH_SOURCE_RESOLVED_REASSEMBLED_HASHES',
    receiptBytesMatch(otherEmitted, otherOut, otherReassembled) && receiptBytesMatch(otherEmitted, otherOut, otherOut),
    'both source, resolved receipt, other-depth output and reassembled PNG SHA-256 equal the authored receipt');
  say('DMP1311_OTHER_DEPTH_RIG_READER_IMAGE_HASHES', rigImageHashesMatch(otherOut),
    'actual rig reader has both part images; decoded pixel SHA-256 equals each source receipt PNG');

  // Restore the old caller's folding using the unchanged public setter on a clone.
  // Enumerate once: every reference retains its pre-rewrite value and setter closure.
  const plantedRaw = structuredClone(nestedRaw), refs = configFileReferences(plantedRaw);
  for (const ref of refs) ref.set(relative(resolve(nestedOut), resolve(configDir, ref.value)));
  const planted = plantedRaw.assemble.edited_parts;
  const plantResults: { name: string; ok: boolean }[] = [];
  const plantSay: Say = (name, ok) => { plantResults.push({ name, ok }); };
  checkCanonical(planted, plantSay);
  say('DMP1311_OLD_CALLER_FOLDING_NAMED_FAIL_NOT_CRASH', plantResults.length === 1 &&
    plantResults[0].name === canonicalName && !plantResults[0].ok && planted.dir === nestedBlock.dir &&
    planted.receipts[0].file === '../../../inputs/set/hair_back.png' &&
    receiptBytesMatch(planted, nestedOut, nestedReassembled),
    'captured FAIL DMP1311_INSIDE_CONFIG_CANONICAL_RECEIPTS; old caller folding still resolves the same PNG hashes');

  const scratchDir = join(configDir, 'mesh-draft');
  const scratchFile = scratchConfig(nestedConfig, sourceConfigBytes.toString('utf8'), scratchDir, new Map());
  const scratchBlock = readBlock(scratchFile), scratchAssembled = join(dir, 'scratch-reassembled');
  say('DMP1311_MESH_DRAFT_INSIDE_CONFIG_CANONICAL_RECEIPTS', canonicalEditedBlock(scratchBlock, nestedBlock, expectedDir),
    'production scratchConfig rebases the shared dir and retains both original receipt files');
  assemble(scratchFile, scratchAssembled);
  say('DMP1311_MESH_DRAFT_SOURCE_RESOLVED_REASSEMBLED_HASHES', receiptBytesMatch(scratchBlock, scratchDir, scratchAssembled),
    'both scratch receipt targets and reassembled PNG SHA-256 equal the original source receipts');
  say('DMP1311_SOURCE_CONFIG_AND_RECEIPTS_UNCHANGED', readFileSync(nestedConfig).equals(sourceConfigBytes) &&
    nestedBlock.receipts.every((r, i) => readFileSync(join(receiptDir, r.file)).equals(sourceBytes[i])),
    'inside/other-depth apply, rig readers, cloned setter plant and mesh scratch leave source config and PNG bytes untouched');
  const plantedConfig = join(depthOut, 'legacy-config.json');
  json(plantedConfig, legacyDepthConfig(edited, editedPath, depthOut, 31));
  const refusedOut = join(dir, 'legacy-refused'), refused = codes(() => assemble(plantedConfig, refusedOut));
  say('DMP1283_OLD_PRIVATE_LIST_REFUSES_BOTH_RECEIPTS', refused.length === 2 &&
    receipts.every((r, i) => refused.includes(`ASSEMBLE_EDITED_PART_FILE: config.assemble.edited_parts.receipts[${i}] (part "${r.part}")`)) &&
    !existsSync(refusedOut), JSON.stringify({ refusals: refused, outputExists: existsSync(refusedOut) }));

  // #1533: rig-config one directory above --out with editor_receipts.receipts[].file; rebase + skip-rebase plant + missing-file refusal.
  const authorSourcePath = join(receiptDir, 'author_hand.png');
  writeFileSync(authorSourcePath, sourceBytes[0]);
  const authorSourceSha = sha256(sourceBytes[0]);
  const editorReceipt: EditorReceipt = {
    file: '../../../inputs/set/author_hand.png',
    sha256: authorSourceSha,
    from_sha256: '0'.repeat(64),
    editor: 'synthetic editor receipt fixture',
  };
  const editorReceiptsBlock = { required: true, receipts: [editorReceipt] };
  const nestedWithEditorReceipts = {
    ...nestedRaw,
    assemble: { ...(nestedRaw.assemble as Obj), editor_receipts: editorReceiptsBlock },
  };
  const editorReceiptConfig = join(configDir, 'editor-receipt-config.json');
  json(editorReceiptConfig, nestedWithEditorReceipts);
  const editorReceiptConfigBytes = readFileSync(editorReceiptConfig);
  const editorReceiptOut = join(configDir, 'mapped-editor-receipts');
  const expectedEditorReceiptFile = '../../../../inputs/set/author_hand.png';
  applyDepth({ parts: built, manifest: join(editedPrepared, 'manifest.json'), config: recipePath, rigConfig: editorReceiptConfig, out: editorReceiptOut });
  const emittedEditorReceiptCfg = JSON.parse(readFileSync(join(editorReceiptOut, 'config.json'), 'utf8')) as {
    assemble: { edited_parts: EditedBlock; editor_receipts: { required?: boolean; receipts: EditorReceipt[] } };
  };
  const emittedEditorReceipt = emittedEditorReceiptCfg.assemble.editor_receipts.receipts[0];
  const resolvedFromSource = resolve(configDir, editorReceipt.file);
  const resolvedFromOut = resolve(editorReceiptOut, emittedEditorReceipt.file);
  const checkEditorReceiptRebased = (block: { required?: boolean; receipts: EditorReceipt[] }, report: Say): void => {
    const r = block.receipts[0];
    const target = resolve(editorReceiptOut, r.file);
    const ledger = readEditorReceipts(block, join(editorReceiptOut, 'config.json'));
    const ok = block.required === true && block.receipts.length === 1 &&
      r.file === expectedEditorReceiptFile && r.sha256 === authorSourceSha &&
      r.from_sha256 === editorReceipt.from_sha256 && r.editor === editorReceipt.editor &&
      target === resolvedFromSource && existsSync(target) && sha256(readFileSync(target)) === authorSourceSha &&
      ledger.problems.length === 0 && ledger.bySha.get(authorSourceSha)?.path === resolvedFromSource;
    report('DMP1533_EDITOR_RECEIPTS_REBASED_ONE_DIR_BELOW_RIG_CONFIG', ok,
      JSON.stringify({ file: r.file, expected: expectedEditorReceiptFile, resolvedFromSource, target, problems: ledger.problems }));
  };
  checkEditorReceiptRebased(emittedEditorReceiptCfg.assemble.editor_receipts, say);
  const editorReceiptReassembled = join(dir, 'editor-receipt-reassembled');
  assemble(join(editorReceiptOut, 'config.json'), editorReceiptReassembled);
  say('DMP1533_EDITOR_RECEIPTS_AND_EDITED_PARTS_REASSEMBLE_FROM_MAPPED_OUT',
    canonicalEditedBlock(emittedEditorReceiptCfg.assemble.edited_parts, nestedBlock, expectedDir) &&
    resolvedFromOut === resolvedFromSource &&
    receiptBytesMatch(emittedEditorReceiptCfg.assemble.edited_parts, editorReceiptOut, editorReceiptReassembled) &&
    readFileSync(editorReceiptConfig).equals(editorReceiptConfigBytes),
    JSON.stringify({ editedDir: emittedEditorReceiptCfg.assemble.edited_parts.dir, receiptFile: emittedEditorReceipt.file }));

  // Plant that skips rebasing editor_receipts.receipts[].file turns the control red and fails downstream assembly.
  const skippedEditorReceiptBlock = { ...editorReceiptsBlock, receipts: [{ ...editorReceipt }] };
  const skippedPlantResults: { name: string; ok: boolean; detail: string }[] = [];
  checkEditorReceiptRebased(skippedEditorReceiptBlock, (name, ok, detail) => { skippedPlantResults.push({ name, ok, detail }); });
  const skippedPlantCfg = join(editorReceiptOut, 'skipped-editor-receipt-config.json');
  json(skippedPlantCfg, { ...emittedEditorReceiptCfg, assemble: { ...emittedEditorReceiptCfg.assemble, editor_receipts: skippedEditorReceiptBlock } });
  const skippedRefusedOut = join(dir, 'skipped-editor-receipt-refused');
  const skippedRefusals = codes(() => assemble(skippedPlantCfg, skippedRefusedOut));
  say('DMP1533_PLANT_SKIPPING_EDITOR_RECEIPT_REBASE_TURNS_CONTROL_RED',
    skippedPlantResults.length === 1 && !skippedPlantResults[0].ok &&
    skippedRefusals.includes(`ASSEMBLE_EDITOR_RECEIPT_FILE: config.assemble.editor_receipts.receipts[0] (file "${editorReceipt.file}")`) &&
    !existsSync(skippedRefusedOut),
    JSON.stringify({ controlPassed: skippedPlantResults[0]?.ok, refusals: skippedRefusals, outputExists: existsSync(skippedRefusedOut) }));

  // Any editor_receipts path that cannot resolve is refused by name (field, value, where it would resolve) before anything is written.
  const missingReceiptFile = '../../../inputs/set/missing_receipt.png';
  const missingReceiptResolved = resolve(configDir, missingReceiptFile);
  const missingEditorReceiptCfg = join(configDir, 'missing-editor-receipt-config.json');
  json(missingEditorReceiptCfg, {
    ...nestedRaw,
    assemble: {
      ...(nestedRaw.assemble as Obj),
      editor_receipts: { receipts: [{ ...editorReceipt, file: missingReceiptFile }] },
    },
  });
  const missingReceiptOut = join(configDir, 'mapped-missing-receipt');
  let missingReceiptError = '';
  try {
    applyDepth({ parts: built, manifest: join(editedPrepared, 'manifest.json'), config: recipePath, rigConfig: missingEditorReceiptCfg, out: missingReceiptOut });
  } catch (e) {
    if (!(e instanceof PartsError)) throw e;
    missingReceiptError = e.problems.map(p => `${p.code}: ${p.object} — ${p.detail}`).join(' | ');
  }
  say('DMP1533_UNRESOLVABLE_EDITOR_RECEIPT_REFUSED_BEFORE_EMIT',
    missingReceiptError.includes(`ASSEMBLE_EDITOR_RECEIPT_FILE: config.assemble.editor_receipts.receipts[0] (file "${missingReceiptFile}")`) &&
    missingReceiptError.includes(`names ${missingReceiptResolved}, which is no such file`) &&
    !existsSync(missingReceiptOut),
    missingReceiptError);

  // Same-depth --out (sibling directory of configDir) leaves relative paths starting without ../ or at same depth unchanged when --out is at the same depth.
  const sameDepthOut = join(dirname(configDir), 'mapped-same-depth');
  applyDepth({ parts: built, manifest: join(editedPrepared, 'manifest.json'), config: recipePath, rigConfig: editorReceiptConfig, out: sameDepthOut });
  const sameDepthEmitted = JSON.parse(readFileSync(join(sameDepthOut, 'config.json'), 'utf8')) as typeof emittedEditorReceiptCfg;
  say('DMP1533_SAME_DEPTH_OUT_PRESERVES_DEPTH_RELATIVE_BYTES',
    sameDepthEmitted.assemble.edited_parts.dir === nestedBlock.dir &&
    sameDepthEmitted.assemble.editor_receipts.receipts[0].file === editorReceipt.file &&
    readEditorReceipts(sameDepthEmitted.assemble.editor_receipts, join(sameDepthOut, 'config.json')).problems.length === 0,
    JSON.stringify({ dir: sameDepthEmitted.assemble.edited_parts.dir, file: sameDepthEmitted.assemble.editor_receipts.receipts[0].file }));

  // Full census of every relative-path field depth-apply copies through relocateConfigReferences:
  // 1. requirements, 2. motion.animations_from, 3. generation.control.skeleton,
  // 4. assemble.occluders[i].image, 5. assemble.occluders[i].plate,
  // 6. assemble.edited_parts.dir (with assemble.edited_parts.receipts[i].file kept dir-relative),
  // 7. assemble.editor_receipts.receipts[i].file,
  // 8. assemble.cuts[i].under (string and {plate}),
  // 9. assemble.alternates[i].{source,full,head,skeleton} and cuts[j].under (string and {plate}),
  // 10. assemble.take[i].{run_dir,st_input,reference.painting},
  // 11. limbs.<limb>.segments[i].cap,
  // 12. depth.{full,head}.{atlas.image,layers.<layer>.image}.
  const censusConfigDir = join(base, 'census/sub'), censusOutDir = join(censusConfigDir, 'mapped');
  const censusAssetsDir = join(base, 'census/assets');
  mkdirSync(censusConfigDir, { recursive: true }); mkdirSync(censusAssetsDir, { recursive: true });
  const censusFiles = [
    'req.json', 'anim.json', 'pose.json', 'occ.png', 'plate-dir', 'cut-under.png', 'cut-plate',
    'alt-src.png', 'alt-full', 'alt-head', 'alt-skel.json', 'alt-under.png', 'alt-plate',
    'take-run', 'take-input.png', 'take-ref.png', 'limb-cap.png',
    'full-atlas.png', 'full-layer.png', 'head-atlas.png', 'head-layer.png', 'receipt-art.png',
  ] as const;
  for (const f of censusFiles) writeFileSync(join(censusAssetsDir, f), f);
  writeFileSync(join(censusAssetsDir, 'edits-dir', 'part.png'), (() => { mkdirSync(join(censusAssetsDir, 'edits-dir'), { recursive: true }); return 'part'; })());
  const relFromConfig = (f: string): string => `../assets/${f}`;
  const relFromOut = (f: string): string => `../../assets/${f}`;
  const censusRaw = {
    requirements: relFromConfig('req.json'),
    motion: { animations_from: relFromConfig('anim.json') },
    generation: { control: { skeleton: relFromConfig('pose.json') } },
    assemble: {
      occluders: [{ image: relFromConfig('occ.png'), plate: relFromConfig('plate-dir') }],
      edited_parts: { dir: relFromConfig('edits-dir'), receipts: [{ part: 'face', file: 'part.png', sha256: 'a'.repeat(64), from_sha256: 'b'.repeat(64), editor: 'fixture' }] },
      editor_receipts: { receipts: [{ file: relFromConfig('receipt-art.png'), sha256: 'c'.repeat(64), from_sha256: 'd'.repeat(64), editor: 'fixture' }, { file: RECEIPT_AUTHOR_FILE, sha256: 'e'.repeat(64), from_sha256: 'f'.repeat(64), editor: 'fixture' }] },
      cuts: [{ under: relFromConfig('cut-under.png') }, { under: { plate: relFromConfig('cut-plate') } }],
      alternates: [{
        name: 'alt',
        source: relFromConfig('alt-src.png'),
        full: relFromConfig('alt-full'),
        head: relFromConfig('alt-head'),
        skeleton: relFromConfig('alt-skel.json'),
        cuts: [{ under: relFromConfig('alt-under.png') }, { under: { plate: relFromConfig('alt-plate') } }],
      }],
      take: [{
        run_dir: relFromConfig('take-run'),
        st_input: relFromConfig('take-input.png'),
        reference: { painting: relFromConfig('take-ref.png') },
      }],
    },
    limbs: { arm: { segments: [{ cap: relFromConfig('limb-cap.png') }] } },
    depth: {
      full: { atlas: { image: relFromConfig('full-atlas.png') }, layers: { face: { image: relFromConfig('full-layer.png') } } },
      head: { atlas: { image: relFromConfig('head-atlas.png') }, layers: { face: { image: relFromConfig('head-layer.png') } } },
    },
  };
  const relocatedCensus = structuredClone(censusRaw);
  relocateConfigReferences(relocatedCensus, censusConfigDir, censusOutDir, 'relative');
  const expectedCensus = {
    requirements: relFromOut('req.json'),
    motion: { animations_from: relFromOut('anim.json') },
    generation: { control: { skeleton: relFromOut('pose.json') } },
    assemble: {
      occluders: [{ image: relFromOut('occ.png'), plate: relFromOut('plate-dir') }],
      edited_parts: { dir: relFromOut('edits-dir'), receipts: [{ part: 'face', file: 'part.png', sha256: 'a'.repeat(64), from_sha256: 'b'.repeat(64), editor: 'fixture' }] },
      editor_receipts: { receipts: [{ file: relFromOut('receipt-art.png'), sha256: 'c'.repeat(64), from_sha256: 'd'.repeat(64), editor: 'fixture' }, { file: `../${RECEIPT_AUTHOR_FILE}`, sha256: 'e'.repeat(64), from_sha256: 'f'.repeat(64), editor: 'fixture' }] },
      cuts: [{ under: relFromOut('cut-under.png') }, { under: { plate: relFromOut('cut-plate') } }],
      alternates: [{
        name: 'alt',
        source: relFromOut('alt-src.png'),
        full: relFromOut('alt-full'),
        head: relFromOut('alt-head'),
        skeleton: relFromOut('alt-skel.json'),
        cuts: [{ under: relFromOut('alt-under.png') }, { under: { plate: relFromOut('alt-plate') } }],
      }],
      take: [{
        run_dir: relFromOut('take-run'),
        st_input: relFromOut('take-input.png'),
        reference: { painting: relFromOut('take-ref.png') },
      }],
    },
    limbs: { arm: { segments: [{ cap: relFromOut('limb-cap.png') }] } },
    depth: {
      full: { atlas: { image: relFromOut('full-atlas.png') }, layers: { face: { image: relFromOut('full-layer.png') } } },
      head: { atlas: { image: relFromOut('head-atlas.png') }, layers: { face: { image: relFromOut('head-layer.png') } } },
    },
  };
  say('DMP1533_EVERY_COPIED_RELATIVE_PATH_FIELD_REBASES_TO_OUT',
    JSON.stringify(relocatedCensus) === JSON.stringify(expectedCensus),
    JSON.stringify(relocatedCensus));
}
/** Narrow identity proof: synthetic file readers and CLI only; no renderer or inference. */
export function runDepthBindingChecks(dir: string, say: Say): void {
  const source = join(dir, 'source'); mkdirSync(join(source, 'parts'), { recursive: true });
  const art = newRaster(4, 4);
  for (let i = 0; i < 16; i++) art.data.set([200, 120, 80, 255], i * 4);
  const pf = rigParts(); pf.rig_size = [100, 100];
  pf.parts = [{ ...pf.parts[0], name: 'face', from: 'full:face', x: 10, y: 10, w: 4, h: 4, opaque_px: 16 }];
  writeParts(join(source, 'parts.json'), pf); writePng(join(source, 'parts/face.png'), art);
  const rigConfig = join(dir, 'rig-config.json');
  json(rigConfig, { key: 'fixture', assemble: { rig_scale: .5, plan: [['face', 'full', 'face']] }, bones: [{ name: 'head', parent: 'root', at: [40, 40] }], meshes: {}, regions: { face: 'head' }, motion: { duration: 1, tracks: [] }, turn: { pivot: 30, roles: { face: 'surface' } } });
  const configPath = join(dir, 'depth.json');
  json(configPath, { spec: 'rig-parts-depth/1', prepare: { longSide: 4, paddingFraction: 0, padding: 0 }, groups: { head: { near: 'white', zScale: 100, pivot: 30 } }, parts: { face: { map: 'raw.json', source: 'depth', frame: 'part', group: 'head', median: 50, relief: 10 } }, clear: [] });
  json(join(dir, 'raw.json'), { spec: 'rig-parts-map/1', width: 4, height: 4, channels: 1, data: Array.from({ length: 16 }, (_, i) => i) });
  const prepared = join(dir, 'prepared'), out = join(dir, 'applied');
  const manifest = prepareDepth({ parts: source, config: configPath, out: prepared });
  const args = { parts: source, config: configPath, manifest: join(prepared, 'manifest.json'), rigConfig, out };
  applyDepth(args, () => {});
  // #1284: receipts belong to maps, not the mutable prepare manifest or recipe.
  const cli1284 = (out: string) => spawnSync(process.execPath, [join(import.meta.dir, '../cli.ts'), 'depth-apply', '--parts', source,
    '--config', configPath, '--manifest', args.manifest, '--rig-config', rigConfig, '--out', out], { encoding: 'utf8' });
  const legacyCli1284 = cli1284(join(dir, 'legacy-cli'));
  say('DMP1284_LEGACY_CLI_WARN_IS_STDERR_SUCCESS', legacyCli1284.status === 0 && legacyCli1284.stderr.includes('DEPTH_MAP_BINDING_ABSENT: part "face"') && legacyCli1284.stderr.includes('2026-11-16'), `exit=${legacyCli1284.status}; ${legacyCli1284.stderr.trim()}`);
  const mapPath1284 = join(dir, 'raw.json'), receipt1284 = mapPath1284 + '.binding.json';
  const binding1284 = { spec: 'rig-parts-depth-map-binding/1', part: 'face', mapSha256: sha256(readFileSync(mapPath1284)), inputSha256: manifest.parts[0].inputSha256 };
  const legacyWarnings1284: string[] = [], legacy1284 = join(dir, 'binding-legacy');
  applyDepth({ ...args, out: legacy1284 }, line => legacyWarnings1284.push(line));
  say('DMP1284_ABSENT_BINDING_DATED_WARN_AND_LEGACY_BYTES', legacyWarnings1284.length === 1 &&
    legacyWarnings1284[0].startsWith('WARN  DEPTH_MAP_BINDING_ABSENT: part "face"') &&
    legacyWarnings1284[0].includes('2026-11-16') && legacyWarnings1284[0].includes('rig-parts depth-bind --map <numeric-map.json> --input <prepared.png> --part <name>') && JSON.stringify(files(legacy1284)) === JSON.stringify(files(out)), legacyWarnings1284.join(' | '));
  const writer1284 = spawnSync(process.execPath, [join(import.meta.dir, '../cli.ts'), 'depth-bind', '--map', mapPath1284,
    '--input', join(prepared, 'face.png'), '--part', 'face'], { encoding: 'utf8' });
  const written1284 = JSON.parse(readFileSync(receipt1284, 'utf8')) as unknown;
  say('DMP1284_WRITER_CLI_COMPUTES_BOTH_HASHES_AND_NAMES_LIMIT', writer1284.status === 0 &&
    JSON.stringify(written1284) === JSON.stringify(binding1284) && writer1284.stdout.includes('does not prove the map was inferred from this input'), writer1284.stdout.trim());
  const bindingDetails1284 = (fn: () => unknown): string => {
    try { fn(); return ''; } catch (e) {
      if (!(e instanceof PartsError)) throw e;
      return e.problems.map(p => `${p.code}: ${p.object} — ${p.detail}`).join(' | ');
    }
  };
  const savedReceipt1284 = readFileSync(receipt1284);
  const overwriteMessage1284 = bindingDetails1284(() => bindDepthMap({ map: mapPath1284, input: join(prepared, 'face.png'), part: 'face' }));
  say('DMP1284_WRITER_PRESERVES_EXISTING_RECEIPT', overwriteMessage1284.includes(`receipt ${JSON.stringify(receipt1284)} already exists (EEXIST)`) &&
    overwriteMessage1284.includes('required an absent receipt in a writable directory') && overwriteMessage1284.includes('rig-parts depth-bind --map') && readFileSync(receipt1284).equals(savedReceipt1284), overwriteMessage1284);
  const longMap1284 = join(dir, 'm'.repeat(240) + '.json'); writeFileSync(longMap1284, readFileSync(mapPath1284));
  const writeError1284 = bindingDetails1284(() => bindDepthMap({ map: longMap1284, input: join(prepared, 'face.png'), part: 'face' }));
  say('DMP1284_WRITER_OTHER_ERROR_NAMES_PATH_AND_CODE', writeError1284.includes(JSON.stringify(longMap1284 + '.binding.json')) &&
    writeError1284.includes('write failed (ENAMETOOLONG)') && writeError1284.includes('required an absent receipt'), writeError1284);
  const badPart1284 = bindingDetails1284(() => bindDepthMap({ map: mapPath1284, input: join(prepared, 'face.png'), part: '../bad' }));
  say('DMP1284_WRITER_BAD_PART_IS_BINDING_INPUT_REFUSAL', badPart1284.includes('DEPTH_MAP_BINDING: depth-bind --part') &&
    badPart1284.includes('found "../bad"; required a nonempty plain part filename') && badPart1284.includes('rig-parts depth-bind --map'), badPart1284);
  const invalidWriterMap1284 = join(dir, 'binding-invalid-map.json'); json(invalidWriterMap1284, {});
  say('DMP1284_WRITER_INVALID_MAP_EMITS_NOTHING', codes(() => bindDepthMap({ map: invalidWriterMap1284, input: join(prepared, 'face.png'), part: 'face' })).some(c => c.startsWith('DEPTH_MAP_FORMAT:')) && !existsSync(invalidWriterMap1284 + '.binding.json'), 'numeric map validation precedes receipt publication');
  const badPng1284 = join(dir, 'binding-invalid.png'); writeFileSync(badPng1284, 'not png');
  rmSync(receipt1284);
  let badPngRefused1284 = false;
  try { bindDepthMap({ map: mapPath1284, input: badPng1284, part: 'face' }); } catch { badPngRefused1284 = true; }
  say('DMP1284_WRITER_INVALID_INPUT_EMITS_NOTHING', badPngRefused1284 && !existsSync(receipt1284), 'prepared PNG validation precedes receipt publication');
  bindDepthMap({ map: mapPath1284, input: join(prepared, 'face.png'), part: 'face' });
  const bound1284 = join(dir, 'binding-match'), boundWarnings1284: string[] = [];
  applyDepth({ ...args, out: bound1284 }, line => boundWarnings1284.push(line));
  const boundCli1284 = cli1284(join(dir, 'bound-cli'));
  say('DMP1284_BOUND_CLI_NO_LEGACY_WARNING', boundCli1284.status === 0 && !boundCli1284.stderr.includes('DEPTH_MAP_BINDING_ABSENT'), `exit=${boundCli1284.status}; stderr=${boundCli1284.stderr.trim()}`);
  const fileHashes1284 = (path: string): Record<string, string> => Object.fromEntries(Object.entries(files(path)).map(([name, hex]) => [name, sha256(Buffer.from(hex, 'hex'))]));
  const before1284 = fileHashes1284(out), after1284 = fileHashes1284(bound1284);
  say('DMP1284_MATCHING_BINDING_IDENTICAL_OUTPUT_HASHES', boundWarnings1284.length === 0 && JSON.stringify(before1284) === JSON.stringify(after1284), JSON.stringify({ before: before1284, after: after1284 }));
  const failed1284 = join(dir, 'binding-refused');
  const refusal1284 = (binding: unknown): string => {
    json(receipt1284, binding);
    try { applyDepth({ ...args, out: failed1284 }); return ''; }
    catch (e) { if (!(e instanceof PartsError)) throw e; return e.problems.map(p => `${p.code}: ${p.object} — ${p.detail}`).join(' | '); }
  };
  const wrongMap1284 = { ...binding1284, mapSha256: '0'.repeat(64) }, wrongMapMessage1284 = refusal1284(wrongMap1284);
  say('DMP1284_WRONG_MAP_HASH_REFUSES_WITHOUT_OUTPUT', wrongMapMessage1284.includes('DEPTH_MAP_BINDING: part "face"') && wrongMapMessage1284.includes(`found ${wrongMap1284.mapSha256}; required ${binding1284.mapSha256}`) && !existsSync(failed1284), wrongMapMessage1284);
  const malformed1284: Array<[unknown, string]> = [
    [null, 'receipt found null; required an object'], [[], 'receipt found array; required an object'],
    [{ ...binding1284, extra: true }, 'receipt found unknown key "extra"; required only'],
    [{ ...binding1284, part: 'badge' }, 'receipt part found "badge"; required "face"'],
    [{ ...binding1284, inputSha256: 'bad' }, 'receipt inputSha256 found "bad"; required 64 lowercase hexadecimal digits'],
    [{ ...binding1284, mapSha256: null }, 'receipt mapSha256 found null; required 64 lowercase hexadecimal digits'],
    [{ ...binding1284, spec: 'wrong' }, 'receipt spec found "wrong"; required "rig-parts-depth-map-binding/1"'],
  ];
  const malformedMessages1284 = malformed1284.map(([value, expected]) => ({ message: refusal1284(value), expected }));
  say('DMP1284_MALFORMED_RECEIPTS_REFUSE_WITHOUT_OUTPUT', malformedMessages1284.every(({ message, expected }) => message.startsWith('DEPTH_MAP_BINDING:') && message.includes(expected) && message.includes('rig-parts depth-bind --map')) && !existsSync(failed1284), JSON.stringify(malformedMessages1284));
  writeFileSync(receipt1284, '{');
  say('DMP1284_INVALID_RECEIPT_JSON_REFUSES', bindingDetails1284(() => applyDepth({ ...args, out: failed1284 })).includes('receipt found unreadable or invalid JSON; required a readable JSON object') && !existsSync(failed1284), 'present invalid JSON never falls back to legacy');
  rmSync(receipt1284); symlinkSync(join(dir, 'missing-binding.json'), receipt1284);
  say('DMP1284_DANGLING_RECEIPT_REFUSES_NOT_LEGACY', bindingDetails1284(() => applyDepth({ ...args, out: failed1284 })).includes('receipt found a symlink or nonregular file; required a regular file') && !existsSync(failed1284), 'dangling receipt symlink is present malformed evidence');
  rmSync(receipt1284); mkdirSync(receipt1284);
  say('DMP1284_DIRECTORY_RECEIPT_REFUSES', bindingDetails1284(() => applyDepth({ ...args, out: failed1284 })).includes('receipt found a symlink or nonregular file; required a regular file') && !existsSync(failed1284), 'receipt must be a regular file');
  rmSync(receipt1284, { recursive: true });
  json(receipt1284, binding1284);
  const originalArt1284 = readFileSync(join(source, 'parts/face.png'));
  const changedArt1284 = readPng(join(source, 'parts/face.png'));
  changedArt1284.data[(2 * 4 + 2) * 4]++;
  writePng(join(source, 'parts/face.png'), changedArt1284);
  const changedPrepared1284 = join(dir, 'binding-changed-prepared');
  const changedManifest1284 = prepareDepth({ parts: source, config: configPath, out: changedPrepared1284 });
  let mismatch1284 = '';
  try { applyDepth({ ...args, manifest: join(changedPrepared1284, 'manifest.json'), out: failed1284 }); }
  catch (e) { if (!(e instanceof PartsError)) throw e; mismatch1284 = e.problems.map(p => `${p.code}: ${p.object} — ${p.detail}`).join(' | '); }
  say('DMP1284_CHANGED_SAME_SIZE_INPUT_OLD_MAP_REFUSES_BEFORE_EMIT',
    JSON.stringify(changedManifest1284.parts[0].inputSize) === JSON.stringify(manifest.parts[0].inputSize) &&
    changedManifest1284.parts[0].inputSha256 !== binding1284.inputSha256 && mismatch1284.includes('DEPTH_MAP_BINDING: part "face"') &&
    mismatch1284.includes(`found ${binding1284.inputSha256}; required ${changedManifest1284.parts[0].inputSha256}`) &&
    mismatch1284.includes('re-run depth for these inputs, then rig-parts depth-bind --map <numeric-map.json> --input <prepared.png> --part <name>') && !existsSync(failed1284), mismatch1284);
  writeFileSync(join(source, 'parts/face.png'), originalArt1284);
  // Restore both fixture inputs before existing planted map/manifest controls run.
  rmSync(receipt1284);
}

function runDepthApplyCli(input: Parameters<typeof applyDepth>[0]) {
  const { parts, manifest, config, rigConfig, out, groups } = input;
  const run = spawnSync(process.execPath, [join(import.meta.dir, '../cli.ts'), 'depth-apply', '--parts', parts,
    '--manifest', manifest, '--config', config, '--rig-config', rigConfig, '--out', out,
    ...(groups === undefined ? [] : ['--groups', groups.join(',')])], { encoding: 'utf8' });
  const stdout = run.stdout ?? '', outputExists = existsSync(out);
  return {
    status: run.status, outputExists,
    failures: stdout.split(/\r?\n/).filter(line => line.startsWith('  FAIL  ')),
    evidence: JSON.stringify({ exit: run.status, outputExists, stdout: stdout.trim(), stderr: run.stderr?.trim(), error: run.error?.message }),
  };
}

function clippedLine(part: string, detail: string): string {
  return failLine({ code: 'DEPTH_APPLY_CLIPPED', object: `part "${part}"`, detail });
}

function refusedDepthApply(run: ReturnType<typeof runDepthApplyCli>, expected: string[]): boolean {
  return run.status === 1 && !run.outputExists && JSON.stringify(run.failures) === JSON.stringify(expected);
}

function depthClipRows(out: string): [unknown, unknown][] {
  const path = join(out, 'depth-report.json');
  if (!existsSync(path)) return [];
  const { parts } = JSON.parse(readFileSync(path, 'utf8')) as { parts: Obj[] };
  return parts.map(row => [row.part, row.clipFraction]);
}

/** #1571: independent open-interval boundaries at the actual depth-apply CLI. */
function runDepthClippingChecks(dir: string, say: Say): void {
  const source = join(dir, 'source'); mkdirSync(join(source, 'parts'), { recursive: true });
  const art = newRaster(3, 1);
  art.data.set([200, 120, 80, 128, 200, 120, 80, 255, 200, 120, 80, 127]);
  const pf = rigParts(); pf.rig_size = [100, 100];
  const face = { ...pf.parts[0], name: 'face', from: 'full:face', x: 10, y: 10, w: 3, h: 1, opaque_px: 3 };
  pf.parts = [face, { ...face, name: 'badge', from: 'full:headwear', y: 12 }];
  writeParts(join(source, 'parts.json'), pf);
  for (const part of pf.parts) writePng(join(source, 'parts', `${part.name}.png`), art);
  const rigConfig = join(dir, 'rig-config.json');
  json(rigConfig, { key: 'fixture', assemble: { rig_scale: .5, plan: [['face', 'full', 'face'], ['badge', 'full', 'headwear']] },
    bones: [{ name: 'head', parent: 'root', at: [40, 40] }], meshes: {}, regions: { face: 'head', badge: 'head' },
    motion: { duration: 1, tracks: [] }, turn: { pivot: 30, roles: { face: 'surface', badge: 'unit' } } });
  // Alpha 127 excludes the outlier. Raw 0 and 10 have median 5 and p5..p95
  // spread 9, so relief 9 places the supported samples at median +/- 5.
  json(join(dir, 'raw.json'), { spec: 'rig-parts-map/1', width: 3, height: 1, channels: 1, data: [0, 10, 1000] });
  const part = { map: 'raw.json', source: 'depth', frame: 'part', group: 'head', relief: 9 };
  const run = (name: string, zScale: number, parts: Record<string, typeof part & { median: number }>) => {
    const config = join(dir, `${name}.json`), prepared = join(dir, `${name}-prepared`), out = join(dir, name);
    json(config, { spec: 'rig-parts-depth/1', prepare: { longSide: 3, paddingFraction: 0, padding: 0 },
      groups: { head: { near: 'white', zScale, pivot: 30 } }, parts, clear: [] });
    prepareDepth({ parts: source, config, out: prepared });
    return { ...runDepthApplyCli({ parts: source, manifest: join(prepared, 'manifest.json'), config, rigConfig, out }), out };
  };
  const twoParts = { face: { ...part, median: 10 }, badge: { ...part, median: 12 } };
  // The two maxima are 15 and 17. The next binary64 value above 17 is 17 + 2^-48.
  const requiredScale = 17.000000000000004;
  const highDetail = `clip=0.5 in group "head"; required zScale=${requiredScale} (group max z=17)`;
  const high = run('high', 14, twoParts);
  say('DMP38_HIGH_CLIPPED_PARTS_SHARE_THE_GROUP_MAXIMUM',
    refusedDepthApply(high, [clippedLine('face', highDetail), clippedLine('badge', highDetail)]), high.evidence);
  const equal = run('high-equal', 17, twoParts);
  say('DMP39_HIGH_EQUALITY_COUNTS_AS_CLIPPED', refusedDepthApply(equal, [clippedLine('badge', highDetail)]), equal.evidence);
  const repairedHigh = run('high-repaired', requiredScale, twoParts), highRows = depthClipRows(repairedHigh.out);
  say('DMP40_NEXT_ZSCALE_ABOVE_GROUP_MAXIMUM_CLEARS_CLIPPING',
    repairedHigh.status === 0 && JSON.stringify(highRows) === '[["face",0],["badge",0]]',
    `${repairedHigh.evidence}; report part/clip=${JSON.stringify(highRows)}`);

  // For Z = 0 and 10, the first median above 5 is 5 + 2^-50.
  const requiredMedian = 5.000000000000001;
  const lowDetail = `clip=0.5 in group "head"; required median=${requiredMedian} (rise 8.881784197001252e-16 rig px)`;
  const low = run('low', 20, { face: { ...part, median: 5 } });
  const repairedLow = run('low-repaired', 20, { face: { ...part, median: requiredMedian } });
  const lowRows = depthClipRows(repairedLow.out);
  say('DMP41_ZERO_COUNTS_AS_CLIPPED_AND_NEXT_MEDIAN_CLEARS_IT',
    refusedDepthApply(low, [clippedLine('face', lowDetail)]) &&
    repairedLow.status === 0 && JSON.stringify(lowRows) === '[["face",0]]',
    `${low.evidence}; repaired=${repairedLow.evidence}; report part/clip=${JSON.stringify(lowRows)}`);
  // Median 4 puts the samples at -1 and 9, outside the interval (0, 8).
  const both = run('both', 8, { face: { ...part, median: 4 } });
  const bothDetail = 'clip=1 in group "head"; required zScale=9.000000000000002 (group max z=9); ' +
    `required median=${requiredMedian} (rise 1.0000000000000009 rig px)`;
  say('DMP42_ONE_PART_REPORTS_BOTH_CLIPPING_DIRECTIONS',
    refusedDepthApply(both, [clippedLine('face', bothDetail)]), both.evidence);
  const overflow = run('max-float', Number.MAX_VALUE, { face: { ...part, median: Number.MAX_VALUE, relief: 0 } });
  say('DMP43_NO_FINITE_ZSCALE_EXCEEDS_MAX_FLOAT', refusedDepthApply(overflow, [clippedLine('face',
    'clip=1 in group "head"; no finite zScale exceeds group max z=1.7976931348623157e+308; revise median or relief')]), overflow.evidence);
}

export function runDepthMapChecks(dir: string, say: Say): void {
  mkdirSync(join(dir, 'source/parts'), { recursive: true });
  const art = newRaster(65, 65), data: number[] = [], normals: number[] = [];
  for (let y = 0; y < 65; y++) for (let x = 0; x < 65; x++) {
    const dx = x - 32, dy = y - 32, rr = dx * dx + dy * dy, z = Math.sqrt(Math.max(0, 30 * 30 - rr));
    art.data.set([200, 120, 80, rr <= 24 * 24 ? 255 : 0], (y * 65 + x) * 4);
    data.push(x + 2 * y); normals.push(dx / 30, dy / 30, z / 30);
  }
  const mask = alphaSupport(art), map: NumericMap = { spec: 'rig-parts-map/1', width: 65, height: 65, channels: 3, data: normals };
  const shape = (m: NumericMap) => {
    const result = integrateNormals(m, art, 'hemisphere'), recovered = floatBox(result.data, 33, 33, 65, 65), actual: number[] = [], oracle: number[] = [];
    // The integration grid samples original (2*x,2*y), not BOX output centres.
    // Compare the analytic shape on that declared grid; BOX is checked separately.
    for (let y = 0; y < 33; y++) for (let x = 0; x < 33; x++) if ((2 * x - 32) ** 2 + (2 * y - 32) ** 2 < 20 ** 2) { actual.push(result.data[y * 33 + x]); oracle.push(Math.sqrt(30 ** 2 - (2 * x - 32) ** 2 - (2 * y - 32) ** 2)); }
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const ma = mean(actual), mo = mean(oracle); let cov = 0, va = 0, vo = 0;
    for (let i = 0; i < actual.length; i++) { cov += (actual[i] - ma) * (oracle[i] - mo); va += (actual[i] - ma) ** 2; vo += (oracle[i] - mo) ** 2; }
    const correlation = cov / Math.sqrt(va * vo), scale = cov / va;
    const rmse = Math.sqrt(actual.reduce((s, a, i) => s + ((a - ma) * scale - (oracle[i] - mo)) ** 2, 0) / actual.length) / (Math.max(...oracle) - Math.min(...oracle));
    return { sign: result.sign, correlation, rmse, recovered };
  };
  const a = shape(map), b = shape({ ...map, data: normals.map((v, i) => i % 3 === 2 ? v : -v) });
  say('DMP01_HEMISPHERE_BOTH_SIGNS_INDEPENDENT_ORACLE', [a, b].every(r => r.correlation >= .99 && r.rmse <= .03) && a.sign === -b.sign && a.recovered.every((v, i) => Math.abs(v - b.recovered[i]) < 1e-7), JSON.stringify([a, b].map(({ recovered: _v, ...r }) => r)));
  const islands = newRaster(65, 65); islands.data.set(art.data);
  for (let y = 0; y < 65; y++) for (let x = 31; x <= 33; x++) islands.data[(y * 65 + x) * 4 + 3] = 0;
  say('DMP02_TWO_ISLANDS_REFUSED', codes(() => integrateNormals(map, islands, 'split')).some(c => c.startsWith('DEPTH_NORMAL_ISLANDS:')), 'strip splits disk into two four-connected components');
  const zero = { ...map, data: Array(normals.length).fill(0) as number[] };
  say('DMP03_ZERO_NORMAL_REFUSED', codes(() => integrateNormals(zero, art, 'zero')).some(c => c.startsWith('DEPTH_NORMAL_VECTOR:')), 'zero signed normal is not a front-facing default');
  const plane = { ...map, data: normals.map((_v, i) => i % 3 === 2 ? 1 : 0) };
  say('DMP04_UNRESOLVED_CONVEXITY_REFUSED', codes(() => integrateNormals(plane, art, 'plane')).some(c => c.startsWith('DEPTH_NORMAL_CONVEXITY:')), 'plane has no resolved convex interior');
  const line = newRaster(3, 1); line.data.set([0, 0, 0, 127, 0, 0, 0, 128, 0, 0, 0, 255]);
  const normalized = mapToSheet([9999, 0, 10], line, 50, 18, 'white', 100, 'ramp');
  say('DMP05_NORMALIZATION_ALPHA_THRESHOLD_AND_NEAREST_FILL', normalized.reading.rawMedian === 5 && normalized.reading.rawP5 === .5 && normalized.reading.rawP95 === 9.5 && normalized.sheet.data[0] === 102 && normalized.sheet.data[4] === 102 && normalized.sheet.data[8] === 153 && normalized.reading.levels === 2, JSON.stringify(normalized.reading));
  const black = mapToSheet([9999, 0, 10], line, 50, 18, 'black', 100, 'ramp');
  say('DMP06_NEAR_BLACK_INVERTS_AND_CLIPPING_IS_REPORTED', black.sheet.data[4] === 153 && black.sheet.data[8] === 102 && mapToSheet([0, 0, 10], line, 0, 180, 'white', 100, 'clip').reading.clipFraction === 1, 'world Z controls encoding; clipping counted only inside alpha>=128');
  say('DMP07_FLAT_NONZERO_RELIEF_REFUSED_AND_ZERO_ALLOWED', codes(() => mapToSheet(Array(data.length).fill(1), art, 50, 1, 'white', 100, 'flat')).some(c => c.startsWith('DEPTH_MAP_SPREAD:')) && mapToSheet(Array(data.length).fill(1), art, 50, 0, 'white', 100, 'flat').reading.levels === 1, 'no epsilon invents relief for a constant map');
  say('DMP08_FLOAT_BOX_HAND_COMPUTED', Array.from(floatBox([1, 3, 5, 7, 9, 11, 13, 15], 4, 2, 2, 1)).join(',') === '6,10', 'two 2x2 blocks average to 6 and 10');
  const invalidMaps = [{ ...map, data: [1] }, { ...map, width: 0 }, { ...map, channels: 2 }, { ...map, data: normals.map((v, i) => i === 0 ? NaN : v) }, { ...map, extra: true }];
  say('DMP09_NUMERIC_FORMAT_REFUSES_SHAPE_NONFINITE_AND_UNKNOWN', invalidMaps.every(m => codes(() => readNumericMap(m, 'bad')).some(c => c.startsWith('DEPTH_MAP_FORMAT:'))), 'five independent malformed numeric inputs');
  const source = join(dir, 'source'), pf = rigParts(); pf.rig_size = [100, 100]; pf.parts = [{ ...pf.parts[0], name: 'face', from: 'full:face', x: 10, y: 10, w: 65, h: 65, opaque_px: mask.reduce((s, v) => s + v, 0) }];
  writeParts(join(source, 'parts.json'), pf); writePng(join(source, 'parts/face.png'), art);
  const config = { key: 'fixture', assemble: { rig_scale: .5, plan: [['face', 'full', 'face']] }, bones: [{ name: 'head', parent: 'root', at: [40, 40] }], meshes: {}, regions: { face: 'head' }, motion: { duration: 1, tracks: [] }, turn: { pivot: 30, roles: { face: 'surface' } } };
  const rigConfig = join(dir, 'rig-config.json'); json(rigConfig, config);
  const recipe = { spec: 'rig-parts-depth/1', prepare: { longSide: 65, paddingFraction: .08, padding: 4 }, groups: { head: { near: 'white', zScale: 100, pivot: 30 } }, parts: { face: { map: 'raw.json', source: 'depth', frame: 'part', group: 'head', median: 50, relief: 10 } }, clear: [] };
  const configPath = join(dir, 'depth.json'); json(configPath, recipe); json(join(dir, 'raw.json'), { spec: 'rig-parts-map/1', width: 65, height: 65, channels: 1, data });
  for (const field of ['median', 'relief']) {
    const bad = structuredClone(recipe); delete (bad.parts.face as Record<string, unknown>)[field];
    say(`DMP10_MISSING_${field.toUpperCase()}_REFUSED`, codes(() => parseDepthRecipe(bad)).some(c => c === `DEPTH_RECIPE_NUMBER: parts.face.${field}`), `missing ${field} named at its field`);
  }
  for (const field of ['near', 'zScale', 'pivot']) {
    const bad = structuredClone(recipe); delete (bad.groups.head as Record<string, unknown>)[field];
    say(`DMP11_MISSING_${field.toUpperCase()}_REFUSED`, codes(() => parseDepthRecipe(bad)).some(c => c.endsWith(`groups.head.${field}`)), `missing ${field} is never inferred`);
  }
  const prepared = join(dir, 'prepared'), prepared2 = join(dir, 'prepared2'), out = join(dir, 'applied'), out2 = join(dir, 'applied2');
  const manifest = prepareDepth({ parts: source, config: configPath, out: prepared }); prepareDepth({ parts: source, config: configPath, out: prepared2 });
  say('DMP12_PREPARE_BINDS_GRAY_PAD_CROP_AND_HASH', manifest.parts[0].padding === 9 && manifest.parts[0].crop.join(',') === '10,10,65,65' && readPng(join(prepared, 'face.png')).data.slice(0, 4).join(',') === '128,128,128,255' && manifest.parts[0].inputSha256.length === 64 && JSON.stringify(files(prepared)) === JSON.stringify(files(prepared2)), JSON.stringify(manifest.parts[0]));
  const args = { parts: source, config: configPath, manifest: join(prepared, 'manifest.json'), rigConfig, out };
  const report = applyDepth(args); applyDepth({ ...args, out: out2 });
  runDepthBindingChecks(join(dir, 'binding'), say);
  const reread = readParts(join(out, 'parts.json')), rigInputs = readRigInputs(join(out, 'config.json'), out);
  say('DMP13_APPLY_DETERMINISM_AND_ACTUAL_RIG_READER', JSON.stringify(files(out)) === JSON.stringify(files(out2)) && reread.parts[0].depth?.near === 'white' && rigInputs.images.has('face_depth.png') && JSON.stringify((report.parts as unknown[]).length) === '1', 'two outputs byte-identical including reports; actual readRigInputs resolves generated part references');
  say('DMP14_SOURCE_BYTES_UNCHANGED', readFileSync(join(source, 'parts/face.png')).equals(readFileSync(join(out, 'parts/face.png'))) && readFileSync(rigConfig, 'utf8').trim() === JSON.stringify(config), 'art and original rig config unchanged');
  say('DMP15_NONEMPTY_OUTPUT_REFUSED', codes(() => applyDepth(args)).some(c => c.startsWith('DEPTH_OUTPUT_EMPTY:')), 'old output never overwritten');
  const stale = readFileSync(join(prepared, 'face.png')); writeFileSync(join(prepared, 'face.png'), 'changed');
  const blocked = join(dir, 'blocked');
  say('DMP16_STALE_INFERENCE_REFUSED_BEFORE_EMIT', codes(() => applyDepth({ ...args, out: blocked })).some(c => c.startsWith('DEPTH_INPUT_BINDING:')) && !existsSync(blocked), 'stale prepared input produces no output'); writeFileSync(join(prepared, 'face.png'), stale);
  const artBytes = readFileSync(join(source, 'parts/face.png')); const changed = readPng(join(source, 'parts/face.png')); changed.data[0]++; writePng(join(source, 'parts/face.png'), changed);
  say('DMP17_STALE_SOURCE_REFUSED', codes(() => applyDepth({ ...args, out: blocked })).some(c => c.startsWith('DEPTH_INPUT_BINDING:')) && !existsSync(blocked), 'one source byte changed; manifest must be prepared again'); writeFileSync(join(source, 'parts/face.png'), artBytes);
  const rawBytes = readFileSync(join(dir, 'raw.json')); json(join(dir, 'raw.json'), { spec: 'rig-parts-map/1', width: 1, height: 1, channels: 1, data: [0] });
  say('DMP18_REGISTERED_MAP_SIZE_REFUSED_BEFORE_EMIT', codes(() => applyDepth({ ...args, out: blocked })).some(c => c.startsWith('DEPTH_MAP_SIZE:')) && !existsSync(blocked), '1x1 map cannot silently stretch over a 65x65 part'); writeFileSync(join(dir, 'raw.json'), rawBytes);
  const missing = join(dir, 'missing.json');
  say('DMP19_MISSING_INPUT_AND_INVALID_JSON_REFUSED', codes(() => prepareDepth({ parts: source, config: missing, out: blocked })).some(c => c.startsWith('DEPTH_INPUT_PRESENT:')) && (writeFileSync(missing, 'not json'), codes(() => prepareDepth({ parts: source, config: missing, out: blocked }))).some(c => c.startsWith('DEPTH_INPUT_JSON:')), 'named file and JSON refusals');
  const unknown = structuredClone(recipe); unknown.parts = { absent: unknown.parts.face } as unknown as typeof recipe.parts; json(missing, unknown);
  say('DMP20_UNKNOWN_PART_REFUSED', codes(() => prepareDepth({ parts: source, config: missing, out: blocked })).some(c => c.startsWith('DEPTH_PART_RESOLVES:')), 'selection resolves assembled part names');
  const cli = join(import.meta.dir, '../cli.ts');
  const run = spawnSync(process.execPath, [cli, 'depth-apply', '--parts', source, '--config', configPath, '--manifest', args.manifest, '--rig-config', rigConfig, '--out', join(dir, 'cli-out')], { encoding: 'utf8' });
  const usage = spawnSync(process.execPath, [cli, 'depth-prepare', '--bogus', 'x'], { encoding: 'utf8' });
  say('DMP21_REAL_CLI_SUCCESS_AND_UNKNOWN_FLAG', run.status === 0 && run.stdout.includes('reliefRigPixels=10') && usage.status === 2 && usage.stdout.includes('--bogus'), `apply exit ${run.status}; usage exit ${usage.status}; ${run.stderr}`);
  const two = join(dir, 'two'); mkdirSync(join(two, 'parts'), { recursive: true });
  const twoParts = structuredClone(pf); twoParts.parts.push({ ...twoParts.parts[0], name: 'badge', from: 'full:headwear' });
  writeParts(join(two, 'parts.json'), twoParts); writePng(join(two, 'parts/face.png'), art); writePng(join(two, 'parts/badge.png'), art);
  const twoRecipe = structuredClone(recipe) as Record<string, unknown>;
  twoRecipe.parts = { ...recipe.parts, badge: { ...recipe.parts.face, map: 'absent-late.json' } };
  const twoPath = join(dir, 'two-recipe.json'); json(twoPath, twoRecipe);
  const twoConfig = structuredClone(config) as Record<string, unknown>;
  twoConfig.assemble = { rig_scale: .5, plan: [['face', 'full', 'face'], ['badge', 'full', 'headwear']] };
  twoConfig.regions = { face: 'head', badge: 'head' }; twoConfig.turn = { pivot: 30, roles: { face: 'surface', badge: 'unit' } };
  const twoConfigPath = join(dir, 'two-config.json'); json(twoConfigPath, twoConfig);
  const twoPrepared = join(dir, 'two-prepared'); prepareDepth({ parts: two, config: twoPath, out: twoPrepared });
  const lateArgs = { parts: two, config: twoPath, manifest: join(twoPrepared, 'manifest.json'), rigConfig: twoConfigPath, out: blocked };
  const lateCodes = codes(() => applyDepth(lateArgs));
  say('DMP22_MISSING_LATER_MAP_WRITES_NOTHING', lateCodes.some(c => c.startsWith('DEPTH_INPUT_PRESENT:')) && !existsSync(blocked), `first valid part computed, second map absent; no output directory or partial sheet: ${lateCodes.join('; ')}`);
  json(join(dir, 'absent-late.json'), { spec: 'rig-parts-map/1', width: 65, height: 65, channels: 1, data });
  const multi = applyDepth({ ...lateArgs, out: join(dir, 'multi-green') });
  say('DMP28_TWO_VALID_PARTS_ARE_THE_LATE_INPUT_POSITIVE_CONTROL', (multi.parts as unknown[]).length === 2, 'same fixture with both declared maps supplied applies both');
  twoConfig.turn = { pivot: 30, roles: { face: 'surface' } }; json(twoConfigPath, twoConfig);
  say('DMP23_UNREGISTERED_GROUP_REFUSED_BEFORE_EMIT', codes(() => applyDepth(lateArgs)).some(c => c.startsWith('DEPTH_GROUP_BINDING:')) && !existsSync(blocked), 'a declared recipe group cannot silently attach an unrelated part');
  const partBytes = readFileSync(join(source, 'parts.json')); const moved = structuredClone(pf); moved.parts[0].x++; writeParts(join(source, 'parts.json'), moved);
  say('DMP24_STALE_CROP_REFUSED', codes(() => applyDepth({ ...args, out: blocked })).some(c => c.startsWith('DEPTH_INPUT_BINDING:')) && !existsSync(blocked), 'same part names and PNG bytes, changed rig crop'); writeFileSync(join(source, 'parts.json'), partBytes);
  const recipeBytes = readFileSync(configPath), padRecipe = structuredClone(recipe); padRecipe.prepare.padding++; json(configPath, padRecipe);
  say('DMP25_STALE_PADDING_REFUSED', codes(() => applyDepth({ ...args, out: blocked })).some(c => c.startsWith('DEPTH_INPUT_BINDING:')) && !existsSync(blocked), 'same source, changed declared padding'); writeFileSync(configPath, recipeBytes);
  say('DMP26_NESTED_OUTPUT_REFUSED', codes(() => prepareDepth({ parts: source, config: configPath, out: join(source, 'nested') })).some(c => c.startsWith('DEPTH_OUTPUT_EMPTY:')) && !existsSync(join(source, 'nested')), 'output cannot modify even a subdirectory of the source');
  const empty = newRaster(1, 1), one = newRaster(1, 1); one.data[3] = 255;
  say('DMP27_EMPTY_SUPPORT_REFUSED_AND_BANKERS_TIES', codes(() => mapToSheet([0], empty, 0, 0, 'white', 255, 'empty')).some(c => c.startsWith('DEPTH_MAP_SUPPORT:')) && mapToSheet([0], one, 10.5, 0, 'white', 255, 'tie').sheet.data[0] === 10 && mapToSheet([0], one, 11.5, 0, 'white', 255, 'tie').sheet.data[0] === 12, '10.5 rounds to10, 11.5 to12; no alpha support is refused');
  const brokenAnimation = { ...config, motion: { ...config.motion, animations_from: 'missing-animation.json' } };
  const brokenConfig = join(dir, 'broken-animation-config.json'); json(brokenConfig, brokenAnimation);
  say('DMP29_EXTERNAL_RIG_INPUT_VALIDATED_BEFORE_EMIT', codes(() => applyDepth({ ...args, rigConfig: brokenConfig, out: blocked })).some(c => c.startsWith('CONFIG_FILE_PRESENT:')) && !existsSync(blocked), 'original config animation reader runs before any sheet/config output');
  const paddedRecipe = structuredClone(recipe); paddedRecipe.prepare.longSide = 130; paddedRecipe.parts.face.frame = 'input'; paddedRecipe.parts.face.map = 'padded-map.json'; paddedRecipe.groups.head.pivot = 31;
  const paddedConfig = join(dir, 'padded-recipe.json'); json(paddedConfig, paddedRecipe);
  const paddedPrepared = join(dir, 'padded-prepared'), paddedManifest = prepareDepth({ parts: source, config: paddedConfig, out: paddedPrepared }), row = paddedManifest.parts[0];
  const paddedData = Array.from({ length: row.inputSize[0] * row.inputSize[1] }, (_, i) => {
    const x = i % row.inputSize[0] - row.padding, y = Math.floor(i / row.inputSize[0]) - row.padding;
    return x < 0 || y < 0 || x >= 130 || y >= 130 ? -99999 : Math.floor(x / 2) + 2 * Math.floor(y / 2);
  });
  json(join(dir, 'padded-map.json'), { spec: 'rig-parts-map/1', width: row.inputSize[0], height: row.inputSize[1], channels: 1, data: paddedData });
  const paddedOut = join(dir, 'padded-out'); applyDepth({ ...args, config: paddedConfig, manifest: join(paddedPrepared, 'manifest.json'), out: paddedOut });
  const paddedRead = readRigInputs(join(paddedOut, 'config.json'), paddedOut);
  say('DMP30_PADDED_UPSCALED_REGISTRATION_AND_CHANGED_PIVOT', readFileSync(join(out, 'parts/face_depth.png')).equals(readFileSync(join(paddedOut, 'parts/face_depth.png'))) && paddedRead.cfg.turn?.pivot === 31 && config.turn.pivot === 30, '2x block-replicated raw ramp, hostile padding discarded, BOX recovers native bytes; declared pivot31 replaces original30 in actual rig reader');
  const builtInConfig = { ...config, generation: { checkpoint: 'fixture', loras: [], trigger: '', identity: 'fixture', sampler: { steps: 1, cfg: 1, sampler: 'fixture', scheduler: 'fixture' }, costume: 'fixture', negative_extra: '', style: 'fixture', negative_pose: 'fixture', latent: [64, 64], seed: 0, control: { skeleton: 'stand_clasp', strength: 1, end_percent: 1 } } };
  const builtInPath = join(dir, 'builtin-config.json'); json(builtInPath, builtInConfig);
  const builtInOut = join(dir, 'builtin-out'); applyDepth({ ...args, rigConfig: builtInPath, out: builtInOut });
  const builtInRead = readRigInputs(join(builtInOut, 'config.json'), builtInOut);
  say('DMP31_BUILTIN_CONTROL_SKELETON_IS_NOT_RELOCATED_AS_A_FILE', builtInRead.cfg.generation?.control?.skeleton === 'stand_clasp', 'actual config reader accepts the relocated output with the built-in name preserved');
  const requirementsPath = join(dir, 'limits.json'); json(requirementsPath, { spec: 'spine-parts-requirements/1', fps: 12, requirements: [] });
  const requirementsConfig = join(dir, 'requirements-config.json'); json(requirementsConfig, { ...config, requirements: 'limits.json' });
  const requirementsOut = join(dir, 'requirements-out'); applyDepth({ ...args, rigConfig: requirementsConfig, out: requirementsOut });
  let requirementsRead = false;
  const requirementsCodes = codes(() => { requirementsRead = readRigInputs(join(requirementsOut, 'config.json'), requirementsOut).cfg.requirements !== undefined; });
  const writtenRequirements = JSON.parse(readFileSync(join(requirementsOut, 'config.json'), 'utf8')) as { requirements: string };
  say('DMP32_RELATIVE_REQUIREMENTS_RELOCATED_THROUGH_OUTPUT_READER', requirementsRead && requirementsCodes.length === 0 && readFileSync(join(requirementsOut, writtenRequirements.requirements)).equals(readFileSync(requirementsPath)), JSON.stringify({ outputReader: requirementsRead, refusals: requirementsCodes, requirements: writtenRequirements.requirements }));
  const unitSource = join(dir, 'unit-source'); mkdirSync(join(unitSource, 'parts'), { recursive: true });
  const unitParts = structuredClone(pf);
  unitParts.parts[0].provenance = { unchanged_layer_px: unitParts.parts[0].opaque_px, hand_px: 0, automatic_px: 0, edits: [], automatic: [], depth: { kind: 'authored-unit', values: [{ group: 'head', value: 7 }] } };
  writeParts(join(unitSource, 'parts.json'), unitParts); writePng(join(unitSource, 'parts/face.png'), art);
  const unitPrepared = join(dir, 'unit-prepared'); prepareDepth({ parts: unitSource, config: configPath, out: unitPrepared });
  const unitOut = join(dir, 'unit-conflict-out'), unitCodes = codes(() => applyDepth({ ...args, parts: unitSource, manifest: join(unitPrepared, 'manifest.json'), out: unitOut }));
  const unitReaderCodes = existsSync(join(unitOut, 'parts.json')) ? codes(() => readParts(join(unitOut, 'parts.json'))) : [];
  say('DMP33_AUTHORED_UNIT_SELECTION_REFUSES_BEFORE_EMISSION', unitCodes.some(c => c.startsWith('DEPTH_AUTHORED_UNIT_CONFLICT:')) && !existsSync(unitOut), JSON.stringify({ refusals: unitCodes, outputExists: existsSync(unitOut), outputReaderRefusals: unitReaderCodes }));
  const normalRecipe = structuredClone(recipe); normalRecipe.parts.face.source = 'normals'; normalRecipe.parts.face.map = 'normal-map.json';
  const normalConfig = join(dir, 'normal-recipe.json'); json(normalConfig, normalRecipe); json(join(dir, 'normal-map.json'), map);
  const normalPrepared = join(dir, 'normal-prepared'); prepareDepth({ parts: source, config: normalConfig, out: normalPrepared });
  const normalOut = join(dir, 'normal-out'); applyDepth({ ...args, config: normalConfig, manifest: join(normalPrepared, 'manifest.json'), out: normalOut });
  const integrated = integrateNormals(map, art, 'disk-oracle'), seeds: number[] = [];
  for (let y = 0; y < 33; y++) for (let x = 0; x < 33; x++) if (art.data[((2 * y) * 65 + 2 * x) * 4 + 3] >= 128) seeds.push(y * 33 + x);
  const nearest = (x: number, y: number): number => {
    let best = Infinity, seed = -1;
    for (const i of seeds) { const d = (i % 33 - x) ** 2 + (Math.floor(i / 33) - y) ** 2; if (d < best) { best = d; seed = i; } }
    return seed;
  };
  // This BOX enlargement has exactly one tap at floor((native+.5)*33/65).
  const referenceValues = Float64Array.from({ length: 65 * 65 }, (_, i) => integrated.data[nearest(Math.floor((i % 65 + .5) * 33 / 65), Math.floor((Math.floor(i / 65) + .5) * 33 / 65))]);
  const referenceSheet = mapToSheet(referenceValues, art, 50, 10, 'white', 100, 'disk-oracle').sheet;
  const actualSheet = readPng(join(normalOut, 'parts/face_depth.png')), pixel = 11 * 65 + 21, expectedLevel = referenceSheet.data[pixel * 4], actualLevel = actualSheet.data[pixel * 4];
  const contaminatedTap = 5 * 33 + 10, expectedSeed = 6 * 33 + 10;
  say('DMP34_NORMAL_DISK_BOX_DOES_NOT_PULL_UNSUPPORTED_ZERO_INTO_PIXEL_21_11', art.data[pixel * 4 + 3] >= 128 && !seeds.includes(contaminatedTap) && nearest(10, 5) === expectedSeed && actualLevel === expectedLevel, JSON.stringify({ nativePixel: [21, 11], integrationTap: [10, 5], sourceTapSupported: false, nearestSupported: [10, 6], unsupportedHeight: integrated.data[contaminatedTap], expectedHeight: integrated.data[expectedSeed], actualLevel, expectedLevel }));
  const legacyValues = floatBox(integrated.data, 33, 33, 65, 65); let preserved = 0, equal = 0;
  for (let i = 0; i < 65 * 65; i++) {
    if (art.data[i * 4 + 3] < 128) continue;
    if (seeds.includes(Math.floor((Math.floor(i / 65) + .5) * 33 / 65) * 33 + Math.floor((i % 65 + .5) * 33 / 65))) { preserved++; if (legacyValues[i] === referenceValues[i]) equal++; }
  }
  say('DMP35_DISK_FLOAT_ORACLE_AND_INSIDE_SUPPORT_BOX_PRESERVATION', preserved > 0 && equal === preserved && Array.from(mask).every((v, i) => !v || actualSheet.data[i * 4] === referenceSheet.data[i * 4]), JSON.stringify({ fullySupportedBoxPixels: preserved, unchangedRawBoxValues: equal, normalizedSheetMatchesIndependentNearestSeedOracle: true }));
  const mixedSource = join(dir, 'mixed-unit-source'); mkdirSync(join(mixedSource, 'parts'), { recursive: true });
  const mixedParts = structuredClone(twoParts); mixedParts.parts[1].provenance = structuredClone(unitParts.parts[0].provenance);
  writeParts(join(mixedSource, 'parts.json'), mixedParts); writePng(join(mixedSource, 'parts/face.png'), art); writePng(join(mixedSource, 'parts/badge.png'), art);
  const mixedConfig = join(dir, 'mixed-unit-config.json'); json(mixedConfig, { ...config, assemble: { rig_scale: .5, plan: [['face', 'full', 'face'], ['badge', 'full', 'headwear']] }, regions: { face: 'head', badge: 'head' }, turn: { pivot: 30, roles: { face: 'surface', badge: 'unit' }, unitDepths: { badge: 7 } } });
  const mixedPrepared = join(dir, 'mixed-prepared'); prepareDepth({ parts: mixedSource, config: configPath, out: mixedPrepared });
  const mixedOut = join(dir, 'mixed-out'); applyDepth({ ...args, parts: mixedSource, manifest: join(mixedPrepared, 'manifest.json'), rigConfig: mixedConfig, out: mixedOut });
  const mixedRead = readRigInputs(join(mixedOut, 'config.json'), mixedOut), retainedUnit = mixedRead.parts.parts.find(p => p.name === 'badge');
  say('DMP36_UNSELECTED_AUTHORED_UNIT_REMAINS_ONE_REPRESENTATION', retainedUnit?.depth === undefined && JSON.stringify(retainedUnit?.provenance) === JSON.stringify(mixedParts.parts[1].provenance) && readFileSync(join(mixedOut, 'parts/badge.png')).equals(readFileSync(join(mixedSource, 'parts/badge.png'))), 'positive mixed input: face gets scalar depth; unselected badge keeps its authored-unit provenance/art and the actual reader accepts both');
  const absoluteConfig = join(dir, 'absolute-requirements-config.json'); json(absoluteConfig, { ...config, requirements: requirementsPath });
  const absoluteOut = join(dir, 'absolute-requirements-out'); applyDepth({ ...args, rigConfig: absoluteConfig, out: absoluteOut });
  say('DMP37_ABSOLUTE_REQUIREMENTS_REBASE_TO_THE_SAME_FILE', readRigInputs(join(absoluteOut, 'config.json'), absoluteOut).cfg.requirements !== undefined && readFileSync(join(absoluteOut, (JSON.parse(readFileSync(join(absoluteOut, 'config.json'), 'utf8')) as { requirements: string }).requirements)).equals(readFileSync(requirementsPath)), 'positive absolute input reuses the same real requirements reader and bytes');
  runDepthRelocationChecks(join(dir, 'relocation'), say);
  runDepthGroupSelectionChecks(join(dir, 'group-selection'), say);
  runDepthClippingChecks(join(dir, 'clipping'), say);
}

/** #1449: `depth-apply --groups` applies a recorded subset of one prepared recipe's groups. */
export function runDepthGroupSelectionChecks(dir: string, say: Say): void {
  const disk = (n: number): ReturnType<typeof newRaster> => {
    const r = newRaster(n, n), c = (n - 1) / 2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) r.data.set([200, 120, 80, (x - c) ** 2 + (y - c) ** 2 <= (c - 2) ** 2 ? 255 : 0], (y * n + x) * 4);
    return r;
  };
  // The fixture's maps carry no binding receipt; the legacy WARN is DMP1284's subject, not this one's.
  const apply = (input: Parameters<typeof applyDepth>[0]): Obj => applyDepth(input, () => {});
  const art = disk(32), ramp = Array.from({ length: 32 * 32 }, (_, i) => i % 32 + 2 * Math.floor(i / 32));
  const source = join(dir, 'source'); mkdirSync(join(source, 'parts'), { recursive: true });
  const pf = rigParts(); pf.rig_size = [100, 100];
  pf.parts = [{ ...pf.parts[0], name: 'face', from: 'full:face', x: 20, y: 6, w: 32, h: 32, opaque_px: alphaSupport(art).reduce((s, v) => s + v, 0) },
    { ...pf.parts[0], name: 'torso', from: 'full:topwear', x: 20, y: 44, w: 32, h: 32, opaque_px: alphaSupport(art).reduce((s, v) => s + v, 0) }];
  // The torso carries an assembled sheet, so a left-out part's earlier sheet is visible in the output.
  const priorSheet = newRaster(32, 32); for (let i = 0; i < 32 * 32; i++) priorSheet.data.set([128, 128, 128, 255], i * 4);
  pf.parts[1].depth = { image: 'torso_depth.png', near: 'white', zScale: 40, sources: [{ from: 'full:topwear', image: 'torso_prior.png', sha256: sha256(encodePngBytes(priorSheet)), crop: [0, 0, 32, 32], reading: depthReading(priorSheet, art, null) }] };
  writeParts(join(source, 'parts.json'), pf); writePng(join(source, 'parts/face.png'), art); writePng(join(source, 'parts/torso.png'), art); writePng(join(source, 'parts/torso_depth.png'), priorSheet);
  const bodyTurn = { pivot: 18, roles: { torso: 'surface' } };
  const base = { key: 'fixture', assemble: { rig_scale: .5, plan: [['torso', 'full', 'topwear'], ['face', 'full', 'face']] },
    bones: [{ name: 'hip', parent: 'root', at: [36, 90] }, { name: 'chest', parent: 'hip', at: [36, 60] }, { name: 'head', parent: 'chest', at: [36, 22] }],
    meshes: {}, regions: { face: 'head', torso: 'chest' }, motion: { duration: 1, tracks: [] } };
  const headConfig = join(dir, 'head-config.json'), bodyConfig = join(dir, 'body-config.json'), bodyOnlyConfig = join(dir, 'body-only-config.json');
  json(headConfig, { ...base, turn: { pivot: 30, roles: { face: 'surface' } } });
  json(bodyConfig, { ...base, turn: { pivot: 30, roles: { face: 'surface' }, body: bodyTurn } });
  json(bodyOnlyConfig, { ...base, turn: { body: bodyTurn } });

  const recipe = { spec: 'rig-parts-depth/1', prepare: { longSide: 32, paddingFraction: 0, padding: 0 },
    groups: { head: { near: 'white', zScale: 100, pivot: 30 }, body: { near: 'white', zScale: 40, pivot: 18 } },
    parts: { face: { map: 'face.json', source: 'depth', frame: 'part', group: 'head', median: 50, relief: 10 },
      torso: { map: 'torso.json', source: 'depth', frame: 'part', group: 'body', median: 20, relief: 6 } }, clear: [] };
  const recipePath = join(dir, 'depth.json'); json(recipePath, recipe);
  json(join(dir, 'face.json'), { spec: 'rig-parts-map/1', width: 32, height: 32, channels: 1, data: ramp });
  const prepared = join(dir, 'prepared'); prepareDepth({ parts: source, config: recipePath, out: prepared });
  const manifest = join(prepared, 'manifest.json'), manifestBytes = readFileSync(manifest);
  const args = { parts: source, manifest, config: recipePath, rigConfig: headConfig };
  const report = (out: string): Obj => JSON.parse(readFileSync(join(out, 'depth-report.json'), 'utf8')) as Obj;
  const rig = (out: string): { bones: string[]; animations: string[] } => {
    const read = readRigInputs(join(out, 'config.json'), out), built = buildRig(read.cfg, read.parts, read.images);
    return { bones: built.rig.bones.map(b => b.name), animations: Object.keys(built.motion.animations) };
  };
  // A refused run or a missing output fails the control by name; it never aborts the suite.
  const check = (name: string, fn: () => [boolean, string]): void => {
    let result: [boolean, string];
    try { result = fn(); } catch (e) { result = [false, `threw ${e instanceof PartsError ? e.problems.map(p => `${p.code}: ${p.object}`).join('; ') : String(e).split('\n')[0]}`]; }
    say(name, result[0], result[1]);
  };
  // The torso map does not exist yet: a head-only answer needs no body inference.
  const headOut = join(dir, 'head'), headOut2 = join(dir, 'head2');
  const headCodes = codes(() => { apply({ ...args, out: headOut, groups: ['head'] }); apply({ ...args, out: headOut2, groups: ['head'] }); });
  check('DGS01_HEAD_ONLY_APPLIES_THE_HEAD_PARTS_AND_DROPS_THE_LEFT_OUT_SHEET', () => {
    const headParts = readParts(join(headOut, 'parts.json')), rows = (report(headOut).parts as Obj[]).map(r => r.part);
    return [headCodes.length === 0 && existsSync(join(headOut, 'parts/face_depth.png')) && !existsSync(join(headOut, 'parts/torso_depth.png')) && !existsSync(join(dir, 'torso.json')) &&
      headParts.parts.find(p => p.name === 'face')?.depth?.image === 'face_depth.png' && headParts.parts.find(p => p.name === 'torso')?.depth === undefined && JSON.stringify(rows) === '["face"]',
    JSON.stringify({ refusals: headCodes, files: Object.keys(files(headOut)).sort(), rows, torsoDepth: headParts.parts.find(p => p.name === 'torso')?.depth ?? null })];
  });
  check('DGS02_HEAD_ONLY_RIG_BUILDS_NO_BODY_DIAL_AND_NO_BODY_TURN', () => {
    const headRig = rig(headOut);
    return [headRig.bones.includes('yaw_dial') && headRig.animations.includes('turn') && !headRig.bones.includes('body_yaw_dial') && !headRig.bones.includes('bodyshift') && !headRig.animations.includes('body_turn'), JSON.stringify(headRig)];
  });
  check('DGS03_HEAD_ONLY_RUNS_TWICE_TO_THE_SAME_BYTES', () => [headCodes.length === 0 && JSON.stringify(files(headOut)) === JSON.stringify(files(headOut2)), `${Object.keys(files(headOut)).length} files compared`]);
  const bodyNoTurnCodes = codes(() => apply({ ...args, out: join(dir, 'body-no-turn-body'), groups: ['body'] }));
  const noFlagCodes = codes(() => apply({ ...args, out: join(dir, 'no-flag-head-config') }));
  say('DGS04_TURN_BODY_IS_REQUIRED_ONLY_WHEN_THE_BODY_GROUP_APPLIES',
    noFlagCodes.join() === 'DEPTH_RECIPE: config.turn.body' && !existsSync(join(dir, 'no-flag-head-config')) &&
    bodyNoTurnCodes.join() === 'DEPTH_GROUP_LEFT_OUT: config.turn.roles,DEPTH_RECIPE: config.turn.body' && !existsSync(join(dir, 'body-no-turn-body')),
    `same head-only config: no --groups -> ${noFlagCodes.join('; ')}; --groups head -> green (DGS01); --groups body without config.turn.body -> ${bodyNoTurnCodes.join('; ')}`);
  json(join(dir, 'torso.json'), { spec: 'rig-parts-map/1', width: 32, height: 32, channels: 1, data: ramp.map(v => -v) });
  const fullOut = join(dir, 'full'), bothOut = join(dir, 'both');
  const fullCodes = codes(() => { apply({ ...args, rigConfig: bodyConfig, out: fullOut }); apply({ ...args, rigConfig: bodyConfig, out: bothOut, groups: ['body', 'head'] }); });
  const keys = (r: Obj): string => Object.keys(r).join(',');
  const legacyKeys = 'spec,partsSha256,recipeSha256,manifestSha256,rigConfigSha256,alpha,normalization,extension,cleared,parts';
  check('DGS05_FULL_APPLY_POSITIVE_CONTROL_BUILDS_THE_BODY_TURN_AND_WRITES_NO_SELECTION', () => {
    const fullRig = rig(fullOut);
    return [fullCodes.length === 0 && fullRig.bones.includes('body_yaw_dial') && fullRig.animations.includes('body_turn') && keys(report(fullOut)) === legacyKeys &&
      readParts(join(fullOut, 'parts.json')).parts.find(p => p.name === 'torso')?.depth?.sources[0].image === 'torso.json', JSON.stringify({ refusals: fullCodes, rig: fullRig, keys: keys(report(fullOut)) })];
  });
  const selectionKeys = legacyKeys.replace('cleared,parts', 'cleared,selection,parts');
  check('DGS06_REPORT_RECORDS_THE_SELECTION_AND_KEEPS_THE_RECIPE_AND_MANIFEST_BINDING', () => {
    const headRead = report(headOut), fullRead = report(fullOut), bothRead = report(bothOut);
    return [keys(headRead) === selectionKeys && JSON.stringify(headRead.selection) === '{"groups":["head"],"leftOut":["torso"]}' &&
      headRead.recipeSha256 === fullRead.recipeSha256 && headRead.recipeSha256 === sha256(pretty(parseDepthRecipe(recipe))) &&
      headRead.manifestSha256 === fullRead.manifestSha256 && headRead.manifestSha256 === sha256(manifestBytes) && headRead.partsSha256 === fullRead.partsSha256 &&
      readFileSync(manifest).equals(manifestBytes) && JSON.stringify(bothRead.selection) === '{"groups":["head","body"],"leftOut":[]}',
    JSON.stringify({ keys: keys(headRead), selection: headRead.selection, both: bothRead.selection })];
  });
  check('DGS07_EVERY_GROUP_NAMED_WRITES_THE_FULL_APPLY_BYTES_BUT_THE_REPORT', () => {
    const bothFiles = files(bothOut), fullFiles = files(fullOut), differ = Object.keys({ ...bothFiles, ...fullFiles }).filter(k => bothFiles[k] !== fullFiles[k]);
    return [JSON.stringify(differ) === '["depth-report.json"]', JSON.stringify(differ)];
  });
  const blocked = join(dir, 'blocked'), problems = (groups: string[], rigConfig = headConfig): string[] => {
    try { apply({ ...args, rigConfig, out: blocked, groups }); return []; }
    catch (e) { if (!(e instanceof PartsError)) throw e; return e.problems.map(p => `${p.code}: ${p.object} — ${p.detail}`); }
  };
  const has = 'the recipe\'s groups are "head", "body"';
  const listed = problems(['head', 'tail', 'head', 'head', '']);
  say('DGS08_UNKNOWN_REPEATED_AND_EMPTY_NAMES_REFUSED_TOGETHER_BEFORE_OUTPUT',
    JSON.stringify(listed) === JSON.stringify([
      `DEPTH_GROUP_SELECTION: depth-apply --groups — found "tail", which the recipe does not declare; required a group the recipe declares; ${has}`,
      `DEPTH_GROUP_SELECTION: depth-apply --groups — found "head" more than once; required each group named once; ${has}`,
      `DEPTH_GROUP_SELECTION: depth-apply --groups — found "", which the recipe does not declare; required a group the recipe declares; ${has}`]) && !existsSync(blocked),
    JSON.stringify(listed));
  const empty = problems([]);
  say('DGS09_EMPTY_LIST_REFUSED', JSON.stringify(empty) === JSON.stringify([`DEPTH_GROUP_SELECTION: depth-apply --groups — found an empty list; required one or more group names, comma-separated; ${has}`]) && !existsSync(blocked), JSON.stringify(empty));
  const legacyConfig = join(dir, 'legacy-head-config.json'); json(legacyConfig, { ...base, turn: { pivot: 30, depths: { face: 20, torso: 10 }, body: bodyTurn } });
  const leftBody = problems(['head'], bodyConfig), leftHead = problems(['body'], bodyConfig), leftLegacy = problems(['body'], legacyConfig);
  say('DGS10_A_LEFT_OUT_GROUP_DECLARED_TO_TURN_IS_REFUSED',
    JSON.stringify(leftBody) === JSON.stringify(['DEPTH_GROUP_LEFT_OUT: config.turn.body — declares the body turn, and depth-apply --groups head leaves the recipe\'s body group out; required no config.turn.body in the rig config when the body group is left out, or body named in --groups']) &&
    JSON.stringify(leftHead) === JSON.stringify(['DEPTH_GROUP_LEFT_OUT: config.turn.roles — declares the head turn, and depth-apply --groups body leaves the recipe\'s head group out; required no config.turn.roles in the rig config when the head group is left out, or head named in --groups']) &&
    JSON.stringify(leftLegacy) === JSON.stringify(['DEPTH_GROUP_LEFT_OUT: config.turn.depths — declares the head turn, and depth-apply --groups body leaves the recipe\'s head group out; required no config.turn.depths in the rig config when the head group is left out, or head named in --groups']) && !existsSync(blocked),
    JSON.stringify([...leftBody, ...leftHead, ...leftLegacy]));
  const bodyOnlyCodes = codes(() => apply({ ...args, rigConfig: bodyOnlyConfig, out: join(dir, 'body-only'), groups: ['body'] }));
  check('DGS11_BODY_ONLY_POSITIVE_CONTROL_APPLIES_THE_BODY_GROUP', () => [bodyOnlyCodes.length === 0 &&
    JSON.stringify(report(join(dir, 'body-only')).selection) === '{"groups":["body"],"leftOut":["face"]}' && !existsSync(join(dir, 'body-only/parts/face_depth.png')),
    JSON.stringify({ refusals: bodyOnlyCodes })]);
  const cli = join(import.meta.dir, '../cli.ts');
  const run = (out: string, groups: string) => spawnSync(process.execPath, [cli, 'depth-apply', '--parts', source, '--manifest', manifest, '--config', recipePath, '--rig-config', headConfig, '--out', out, '--groups', groups], { encoding: 'utf8' });
  const green = run(join(dir, 'cli-head'), 'head'), refused = run(join(dir, 'cli-empty'), '');
  check('DGS12_CLI_GROUPS_FLAG_APPLIES_AND_AN_EMPTY_VALUE_IS_REFUSED', () => [
    green.status === 0 && green.stdout.includes('depth-apply: applied groups head; left out torso, without a depth sheet') &&
    JSON.stringify(files(join(dir, 'cli-head'))) === JSON.stringify(files(headOut)) && refused.status === 1 && `${refused.stdout}${refused.stderr}`.includes('DEPTH_GROUP_SELECTION') && !existsSync(join(dir, 'cli-empty')),
    `head exit ${green.status}; empty exit ${refused.status}; ${(refused.stdout + refused.stderr).split('\n').find(l => l.includes('DEPTH_GROUP_SELECTION')) ?? 'no refusal line'}`]);

  // These surface regions have disjoint turn roles. Zero relief makes every
  // supported Z equal to its part's declared median.
  const clippingRecipe = structuredClone(recipe);
  clippingRecipe.parts.face = { ...clippingRecipe.parts.face, median: 110, relief: 0 };
  clippingRecipe.parts.torso = { ...clippingRecipe.parts.torso, median: 45, relief: 0 };
  const clippingPath = join(dir, 'depth-clipped.json'), clippingPrepared = join(dir, 'prepared-clipped');
  json(clippingPath, clippingRecipe); prepareDepth({ parts: source, config: clippingPath, out: clippingPrepared });
  const clippingArgs = { ...args, config: clippingPath, manifest: join(clippingPrepared, 'manifest.json') };
  const clipped = runDepthApplyCli({ ...clippingArgs, rigConfig: bodyConfig, out: join(dir, 'cli-clipped') });
  say('DGS13_CLIPPED_GROUPS_REPORT_INDEPENDENT_ZSCALES', refusedDepthApply(clipped, [
    clippedLine('face', 'clip=1 in group "head"; required zScale=110.00000000000001 (group max z=110)'),
    clippedLine('torso', 'clip=1 in group "body"; required zScale=45.00000000000001 (group max z=45)'),
  ]), clipped.evidence);

  clippingRecipe.groups.body.zScale = 45.00000000000001;
  const repairedPath = join(dir, 'depth-body-repaired.json'), repairedPrepared = join(dir, 'prepared-body-repaired');
  json(repairedPath, clippingRecipe); prepareDepth({ parts: source, config: repairedPath, out: repairedPrepared });
  const repairedOut = join(dir, 'cli-body-repaired');
  const repaired = runDepthApplyCli({ ...args, config: repairedPath, manifest: join(repairedPrepared, 'manifest.json'),
    rigConfig: bodyOnlyConfig, out: repairedOut, groups: ['body'] });
  const rows = depthClipRows(repairedOut);
  say('DGS14_LEFT_OUT_CLIPPED_GROUP_CANNOT_BLOCK_REPAIRED_SELECTION',
    repaired.status === 0 && JSON.stringify(rows) === '[["torso",0]]' && !existsSync(join(repairedOut, 'parts/face_depth.png')),
    `${repaired.evidence}; report part/clip=${JSON.stringify(rows)}`);
}

if (import.meta.main) {
  const [out, ...extra] = process.argv.slice(2);
  if (!out || extra.length || (existsSync(out) && readdirSync(out).length !== 0)) {
    console.error('Usage: bun tools/check_depthmaps.ts <fresh-output-directory>'); process.exit(64);
  }
  mkdirSync(out, { recursive: true });
  let failures = 0;
  runDepthRelocationChecks(resolve(out), (name, ok, detail) => {
    if (!ok) failures++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
  });
  process.exitCode = failures ? 1 : 0;
}
