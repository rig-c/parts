/** Public rectangle controls for #812; rendering is invoked only by the pool suite. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { neckDraftFixture, writeNeckDraftFixture, writeNeckDraftReviewFixture } from '../fixtures/neck_draft.ts';
import { MERGED_ARM_EXPECTED_SPLIT_PARTS, MERGED_ARM_KEY_SKELETON } from '../fixtures/assemble_fixture.ts';
import { assembleStage, readRigInputs, readRuns } from '../src/build.ts';
import { assemble, headGarmentOverlaps, headGarmentWarning, proposePlan, stageFields } from '../src/assemble.ts';
import { controlSkeletonOf, loadConfig, parseConfig } from '../src/config.ts';
import { draftIndependentNeck } from '../src/neckdraft.ts';
import { PartsError } from '../src/errors.ts';
import { encodePngBytes, readPng } from '../src/raster/png.ts';
import { proposeNeck } from './neck-propose.ts';
import { readConfigWriteTarget } from './configwrite.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
export function runNeckDraftChecks(dir: string, say: Say): void {
  const f = neckDraftFixture(), read = (x = f) => headGarmentOverlaps(x.full, x.head, x.geometry, x.plan);
  const rows = read();
  say('ND01_COLLAR_STRIP_WARN', rows.length === 1 && rows[0].px === 16 && JSON.stringify(rows[0].box) === '[24,38,32,40]' && headGarmentWarning(rows[0]).includes('throat') && headGarmentWarning(rows[0]).includes('topwear'), JSON.stringify(rows));
  say('ND02_NO_STRIP_CLEAR', read(neckDraftFixture(false)).length === 0, 'same registered source without the strip');
  const unplanned = neckDraftFixture(); unplanned.plan = unplanned.plan.filter(([, , tag]) => tag !== 'topwear');
  say('ND03_ONLY_PLANNED_GARMENT', read(unplanned).length === 0, 'unplanned full garment cannot warn');
  const renamed = neckDraftFixture(); renamed.plan[1][0] = 'independent_name';
  say('ND04_TAGS_NOT_PART_NAMES', read(renamed)[0]?.part === 'independent_name', 'source provenance names the candidate and garment');
  const edge = neckDraftFixture(false), pix = edge.head.layers[0].pixels.data;
  pix.set([30, 40, 50, 250], (38 * 64 + 24) * 4);
  say('ND05_ONE_OPAQUE_PIXEL', read(edge)[0]?.px === 1, 'any one opaque crop pixel is sufficient');
  pix[(38 * 64 + 24) * 4 + 3] = 249;
  say('ND06_ALPHA_BELOW_CORE_CLEAR', read(edge).length === 0, '249 is below the existing CORE_ALPHA=250');
  const off = neckDraftFixture(); off.geometry.headBox = [0, 0, 32, 32];
  say('ND07_OFF_CROP_CLEAR', read(off).length === 0, 'garment begins at source y38, outside crop y0..32');
  const plan = proposePlan(f.full, f.head, f.geometry, 1);
  say('ND08_PLAN_WARNING', plan.notes.some(n => n.includes('PLAN_HEAD_GARMENT_OVERLAP')), 'same warning function in assemble --propose-plan');
  const files = writeNeckDraftFixture(join(dir, 'actual'));
  const out = join(dir, 'old');
  assembleStage({ source: files.source, full: files.fullDir, head: files.headDir, config: files.configPath, seam: 'near-white', project: 'core' }, { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite.png'), errorMap: join(out, 'error.png') }, () => {});
  const previous = readRigInputs(files.configPath, out), runs = readRuns(files.fullDir, files.headDir);
  const input = { config: loadConfig(files.configPath), source: readPng(files.source), ...runs, base: resolve(dir, 'actual'), previous };
  const drafted = draftIndependentNeck(input), cfg = parseConfig(drafted.config), depth = cfg.turn!.body!.unitDepths!.throat;
  say('ND09_DERIVED_UNIT_DEPTH', depth === 2 && drafted.notes.some(n => n.includes('round4(body pivot 10 + neck world median 4 - first body surface "shirt" world median 12)')), drafted.notes.join('; '));
  say('ND10_RIGID_SIBLING', cfg.turn!.body!.roles.throat === 'unit' && cfg.turn!.roles!.throat === undefined && cfg.bones.some(b => 'name' in b && b.name === 'throat_part' && b.parent === 'chest') && cfg.meshes.throat.segments.length === 1, 'one rigid influence, sibling of anatomical neck under chest');
  const refuse = (mutate: (x: typeof input) => void, code: string) => { const x = structuredClone(input); mutate(x); try { draftIndependentNeck(x); return false; } catch (e) { return e instanceof PartsError && e.problems.some(p => p.code === code); } };
  say('ND11_MISSING_SOURCE_NAMED', refuse(x => { x.full.layers = x.full.layers.filter(l => l.name !== 'neck'); }, 'PROPOSE_NECK_FULL_SOURCE'), 'supply a clean full neck');
  say('ND12_MISSING_PIVOT_NAMED', refuse(x => { delete x.config.turn!.pivot; delete x.config.turn!.body!.pivot; }, 'PROPOSE_NECK_DEPTH_INPUT'), 'no legacy median conversion or guessed pivot');
  const noSheet = (x: typeof input) => {
    const n = x.full.layers.find(l => l.name === 'neck')!; delete n.depthSheet; delete n.depthHint;
  };
  say('ND18_MISSING_SCALAR_NAMED', refuse(x => { noSheet(x); delete x.previous.parts.parts.find(p => p.name === 'throat')!.depth; }, 'PROPOSE_NECK_DEPTH_INPUT'), 'missing full and previous registered sheets name the required scalar input');
  const fallback = structuredClone(input); noSheet(fallback);
  const fallbackDraft = draftIndependentNeck(fallback);
  say('ND19_PREVIOUS_REGISTERED_OVERLAP', fallbackDraft.config.turn!.body!.unitDepths!.throat === 2 && fallbackDraft.notes.some(n => n.includes('overlapping previous registered neck sheet')), 'only new opaque art overlapping the previous sheet contributes; same analytic median4');
  const underlap = structuredClone(input);
  for (let x = 28; x < 36; x++) underlap.full.layers.find(l => l.name === 'neck')!.pixels.data.set([220, 160, 100, 255], (38 * 64 + x) * 4);
  say('ND20_FULL_RUN_UNDERLAP_ALLOWED', draftIndependentNeck(underlap).config.turn!.body!.roles.throat === 'unit', 'normal full-run seam overlap is not a head-crop contamination classifier');
  say('ND22_BODY_REQUIRED', refuse(x => { delete x.config.turn!.body; }, 'PROPOSE_NECK_BODY_TURN'), 'body context must be authored');
  say('ND23_UNIQUE_PLAN_REQUIRED', refuse(x => { x.config.assemble.plan = x.config.assemble.plan.filter(([, , t]) => t !== 'neck'); }, 'PROPOSE_NECK_PLAN'), 'one source row, never an inferred part');
  say('ND24_CARRIER_REQUIRED', refuse(x => { x.config.bones = x.config.bones.filter(b => !('name' in b) || b.name !== 'head'); }, 'PROPOSE_NECK_CARRIER'), 'missing endpoint named');
  say('ND25_BONE_COLLISION', refuse(x => { x.config.bones.push({ name: 'throat_part', parent: 'hip', at: [1, 1] }); }, 'PROPOSE_NECK_BONE_UNIQUE'), 'unrelated authored bone is not replaced');
  say('ND26_NECK_CUT_NOT_DISCARDED', refuse(x => { x.config.assemble.cuts = [{ from: 'throat', into: 'piece', polygon: [[0, 0], [1, 0], [1, 1]], overlap: 0, draw: { before: 'portrait' } }]; }, 'PROPOSE_NECK_REASSEMBLY'), 'a neck cut needs a separate source/config step, never silently dropped');
  const rectangular = neckDraftFixture(); rectangular.geometry.sourceH = 128;
  say('ND27_NONSQUARE_REGISTRATION', read(rectangular).length === 0, 'full y38 maps to source y76 beyond head crop y64; declared pad/scale, not guessed dimensions');
  const dest = join(dir, 'proposal');
  const before = JSON.parse(readFileSync(files.configPath, 'utf8'));
  let missingRuns = false;
  try { proposeNeck(readConfigWriteTarget(files.configPath), { source: files.source, parts: out, out: dest }); } catch (e) { missingRuns = e instanceof PartsError && e.problems.some(p => p.code === 'PROPOSE_NECK_RUNS'); }
  say('ND28_RUNS_REQUIRED', missingRuns, 'both exact source runs must be read');
  const beforeCli = spawnSync(process.execPath, [resolve('cli.ts'), 'layers', files.headDir, '--full', files.fullDir, '--source', files.source, '--config', files.configPath], { encoding: 'utf8' });
  say('ND15_LAYERS_CLI', beforeCli.status === 0 && beforeCli.stdout.includes('PLAN_HEAD_GARMENT_OVERLAP') && beforeCli.stdout.includes('16 opaque crop px'), 'real CLI contextual warning');
  const incompatible = spawnSync(process.execPath, [resolve('cli.ts'), 'propose', '--parts', out, '--source', files.source, '--full', files.fullDir, '--head', files.headDir, '--out', dest, '--write-config', files.configPath, '--grid-rule', 'figure'], { encoding: 'utf8' });
  say('ND16_INCOMPATIBLE_MODE_NAMED', incompatible.status !== 0 && (incompatible.stdout + incompatible.stderr).includes('PROPOSE_NECK_MODE') && JSON.stringify(JSON.parse(readFileSync(files.configPath, 'utf8'))) === JSON.stringify(before), 'explicit grid option refused without config mutation');
  proposeNeck(readConfigWriteTarget(files.configPath), { source: files.source, full: files.fullDir, head: files.headDir, parts: out, out: dest });
  const after = JSON.parse(readFileSync(files.configPath, 'utf8')), loaded = readRigInputs(files.configPath, join(dest, 'rig'));
  say('ND13_REAL_CONFIG_AND_ART', after.assemble.plan.find((r: string[]) => r[0] === 'throat')[1] === 'full' && loaded.parts.parts.find(p => p.name === 'throat')?.from === 'full:neck' && loaded.images.get('throat')!.data.every((v, i) => i % 4 === 3 || v !== 30), 'actual configwrite, parts.json and source pixels; source strip ink absent');
  say('ND14_AUTHORED_TURN_PRESERVED', after.turn.body.pivot === before.turn.body.pivot && after.turn.body.counter === before.turn.body.counter && JSON.stringify(after.turn.body.grid) === JSON.stringify(before.turn.body.grid) && JSON.stringify(after.motion) === JSON.stringify(before.motion), 'whole-section config replacement retains authored body data and motion');
  const cli = spawnSync(process.execPath, [resolve('cli.ts'), 'layers', files.headDir, '--full', files.fullDir, '--source', files.source, '--config', files.configPath], { encoding: 'utf8' });
  let repeated = false;
  try { proposeNeck(readConfigWriteTarget(files.configPath), { source: files.source, full: files.fullDir, head: files.headDir, parts: out, out: dest }); } catch (e) { repeated = e instanceof PartsError && e.problems.some(p => p.code === 'PROPOSE_NECK_OUT_FRESH'); }
  say('ND21_OUTPUT_FRESH', repeated, 'existing draft rejected before overwriting its parts');
  say('ND17_LAYERS_FULL_SOURCE_CLEAR', cli.status === 0 && !cli.stdout.includes('PLAN_HEAD_GARMENT_OVERLAP'), 'real CLI parsed contextual layers flags and read source/config/runs');
  runNeckDraftReviewChecks(join(dir, 'review'), say);
}

/** Review regressions: real FILE-backed loader state and whole-map body depth fallback. No rendering. */
export function runNeckDraftReviewChecks(dir: string, say: Say): void {
  const files = writeNeckDraftReviewFixture(join(dir, 'file-pose')), out = join(dir, 'baseline');
  const baseline = assembleStage({ source: files.source, full: files.fullDir, head: files.headDir, config: files.configPath, seam: 'near-white', project: 'core' }, { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite.png'), errorMap: join(out, 'error.png') }, () => {});
  const config = loadConfig(files.configPath), source = readPng(files.source), runs = readRuns(files.fullDir, files.headDir);
  const points = JSON.stringify(MERGED_ARM_KEY_SKELETON);
  say('ND29_FILE_POSE_LOADED', JSON.stringify(controlSkeletonOf(config)) === points && JSON.stringify(stageFields(config).keySkeleton) === points, 'relative poses/control.json read through loadConfig, all points and latent preserved');
  const splitParts = (parts: typeof baseline.parts) => MERGED_ARM_EXPECTED_SPLIT_PARTS.every(([name, from, px]) => parts.parts.some(p => p.name === name && p.from === from && p.opaque_px === px));
  say('ND30_BASELINE_ACTUALLY_SPLITS', splitParts(baseline.parts), JSON.stringify(baseline.parts.parts.map(p => [p.name, p.from, p.opaque_px])));
  const { keySkeleton: _pose, ...withoutPose } = stageFields(config);
  const unsplit = assemble({ source, ...runs, ...withoutPose, depth: config.depth, depthBase: dirname(files.configPath), seamRule: 'near-white', projectRule: 'core' });
  say('ND31_NO_POSE_MUTANT_UNSPLIT', !splitParts(unsplit.parts) && unsplit.parts.parts.some(p => p.name === 'sleeves' && p.opaque_px === 508), 'removing keySkeleton leaves one 224+60+224=508px arm, proving this fixture is not a no-op');
  // Loaded state, not a second relative-file lookup, must survive the clone.
  rmSync(files.posePath);
  const drafted = draftIndependentNeck({ config, source, ...runs, base: dirname(files.configPath) });
  say('ND32_DRAFT_CONFIG_CARRIES_POSE', JSON.stringify(controlSkeletonOf(drafted.config)) === points && JSON.stringify(stageFields(drafted.config).keySkeleton) === points, 'returned config retains every resolved point after generated pose file removal');
  say('ND33_DRAFT_ACTUALLY_SPLITS', splitParts(drafted.assembled.parts), JSON.stringify(drafted.assembled.parts.parts.map(p => [p.name, p.from, p.opaque_px])));
  const changed: string[] = [];
  const nonNeck = baseline.images.filter(p => p.record.name !== 'throat');
  for (const old of nonNeck) {
    const next = drafted.assembled.images.find(p => p.record.name === old.record.name);
    if (next === undefined) { changed.push(`${old.record.name}:missing`); continue; }
    if (!Buffer.from(encodePngBytes(next.image)).equals(readFileSync(join(out, 'parts', `${old.record.name}.png`)))) changed.push(`${old.record.name}:art`);
    if (JSON.stringify(next.record) !== JSON.stringify(old.record)) changed.push(`${old.record.name}:record`);
    if (old.depthImage !== undefined && (next.depthImage === undefined || !Buffer.from(encodePngBytes(next.depthImage)).equals(readFileSync(join(out, 'parts', old.record.depth!.image))))) changed.push(`${old.record.name}:depth`);
  }
  for (const next of drafted.assembled.images) if (next.record.name !== 'throat' && !nonNeck.some(p => p.record.name === next.record.name)) changed.push(`${next.record.name}:extra`);
  say('ND34_NON_NECK_BYTES_IDENTICAL', changed.length === 0, `${nonNeck.length} non-neck art/depth PNGs and records compared to actual non-draft assemble; changed=${JSON.stringify(changed)}`);
  say('ND35_INPUT_POSE_UNCHANGED', JSON.stringify(controlSkeletonOf(config)) === points, 'draft does not consume or mutate loader state on the input');

  const depthFiles = writeNeckDraftFixture(join(dir, 'unit-depths'));
  const authored = JSON.parse(readFileSync(depthFiles.configPath, 'utf8'));
  authored.assemble.plan.push(['pin', 'full', 'face']); authored.regions.pin = 'chest';
  authored.turn.body.roles.pin = 'unit';
  authored.turn.unitDepths = { pin: -7.25, throat: 99, portrait: 6.5 };
  const draftDepths = (bodyMap?: Record<string, number>) => {
    const raw = structuredClone(authored);
    if (bodyMap !== undefined) raw.turn.body.unitDepths = bodyMap;
    writeFileSync(depthFiles.configPath, JSON.stringify(raw));
    const cfg = loadConfig(depthFiles.configPath), before = JSON.stringify(cfg);
    const effective = cfg.turn!.body!.unitDepths ?? cfg.turn!.unitDepths!;
    const result = draftIndependentNeck({ config: cfg, source: readPng(depthFiles.source), ...readRuns(depthFiles.fullDir, depthFiles.headDir), base: dirname(depthFiles.configPath) });
    return { cfg: result.config, effective, inputUnchanged: before === JSON.stringify(cfg) };
  };
  const fallback = draftDepths(), fallbackMap = fallback.cfg.turn!.body!.unitDepths!;
  say('ND36_BODY_FALLBACK_UNIT_DEPTH', JSON.stringify(fallbackMap.pin) === JSON.stringify(fallback.effective.pin) && fallbackMap.pin === -7.25, `other body unit pin: before=${fallback.effective.pin}, after=${fallbackMap.pin}`);
  say('ND37_EFFECTIVE_MAP_SNAPSHOT', fallbackMap.portrait === 6.5 && fallbackMap.throat === 2 && fallback.cfg.turn!.unitDepths!.throat === undefined && fallback.inputUnchanged, `previous effective entries retained, legacy neck removed only on clone; body=${JSON.stringify(fallbackMap)}`);
  const explicit = draftDepths({ pin: 3.25 }), explicitMap = explicit.cfg.turn!.body!.unitDepths!;
  say('ND38_BODY_WHOLE_MAP_OVERRIDE', explicitMap.pin === 3.25 && !Object.hasOwn(explicitMap, 'portrait') && explicitMap.throat === 2 && explicit.inputUnchanged, JSON.stringify(explicitMap));
  const empty = draftDepths({}), emptyMap = empty.cfg.turn!.body!.unitDepths!;
  say('ND39_EMPTY_BODY_MAP_OVERRIDE', Object.keys(emptyMap).length === 1 && emptyMap.throat === 2 && empty.inputUnchanged, 'authored empty body map suppresses every fallback entry, only newly derived neck is added');
}

import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { buildRig } from '../src/rig.ts';
import { compile } from '@rig-c/core/compile';
import { parseRigSpec } from '@rig-c/core/src/rig.ts';
import { parseMotionSpec } from '@rig-c/core/src/motion.ts';
import { createHash } from 'node:crypto';
import { newRaster } from '../src/raster/types.ts';
import { writePng } from '../src/raster/png.ts';

function command(args: string[], cwd = process.cwd()): void {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${args.join(' ')} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  if (import.meta.main) console.log(`COMMAND ${JSON.stringify(args)} EXIT ${r.status}\n${r.stdout}`);
}
export function prepareNeckDraftPacket(dir: string): { old: string; clean: string; config: string; original: string } {
  const f = writeNeckDraftFixture(dir), old = join(dir, 'old'), clean = join(dir, 'draft');
  const original = join(dir, 'original.json'); writeFileSync(original, readFileSync(f.configPath));
  assembleStage({ source: f.source, full: f.fullDir, head: f.headDir, config: f.configPath, seam: 'near-white', project: 'core' }, { partsJson: join(old, 'parts.json'), partsDir: join(old, 'parts'), recomposite: join(old, 'recomposite.png'), errorMap: join(old, 'error.png') }, () => {});
  // Use the actual CLI, including its dispatch and stage writer.
  command([resolve('cli.ts'), 'propose', '--parts', old, '--source', f.source, '--full', f.fullDir, '--head', f.headDir, '--out', clean, '--write-config', f.configPath]);
  for (const [config, parts] of [[original, old], [f.configPath, join(clean, 'rig')]]) {
    const r = readRigInputs(config, parts), built = buildRig(r.cfg, r.parts, r.images);
    parseRigSpec(built.rig, 'neck dry-run rig'); parseMotionSpec(built.motion, 'neck dry-run motion');
    const reader = join(parts, 'reader'); mkdirSync(join(reader, 'images'), { recursive: true });
    writeFileSync(join(reader, 'rig.json'), JSON.stringify(built.rig));
    writeFileSync(join(reader, 'motion.json'), JSON.stringify(built.motion));
    for (const [name, image] of built.images) writePng(join(reader, 'images', name), image);
    compile({ rigPath: join(reader, 'rig.json'), motionPath: join(reader, 'motion.json'), imagesDir: join(reader, 'images'), outDir: join(reader, 'compiled-not-emitted') });
    if (import.meta.main) console.log(`READER_GREEN ${config} ${parts} ${built.images.length} images`);
  }
  return { old, clean, config: f.configPath, original };
}
export function produceNeckDraftPacket(dir: string): void {
  const p = prepareNeckDraftPacket(dir);
  for (const [kind, config, parts] of [['old', p.original, p.old], ['clean', p.config, join(p.clean, 'rig')]]) {
    const rig = join(dir, `${kind}-rig`), candidate = join(dir, `${kind}-candidate`);
    command([resolve('cli.ts'), 'rig', '--config', config, '--parts', parts, '--out', rig]);
    command([resolve('node_modules/@rig-c/core/cli.ts'), 'build', '--rig', join(rig, 'rig.json'), '--motion', join(rig, 'motion.json'), '--out', candidate, '--profile', 'rig-play', '--pack']);
  }
}

/** Pool only. This reads real renderer PNGs, never substitutes a CPU raster oracle. */
export function runNeckDraftRenderChecks(dir: string, say: Say): void {
  produceNeckDraftPacket(dir);
  measureNeckDraftPacket(dir, say);
}

export function measureNeckDraftPacket(dir: string, say: Say): void {
  const renderCli = process.env.RIG_PARTS_EXTREMES_RIGC ?? resolve('node_modules/@rig-c/core/cli.ts');
  const help = spawnSync(process.execPath, [renderCli, 'render', '--help'], { encoding: 'utf8' });
  if (help.status !== 0) throw new Error(`render help refused: ${help.stderr}`);
  const hasExtremes = help.stdout.includes('--extremes');
  const extremeFlags = hasExtremes ? ['--extremes'] : [];
  const receipt: Record<string, unknown>[] = [];
  for (const kind of ['old', 'clean']) {
    const candidate = join(dir, `${kind}-candidate`);
    // Slot-only rendering attributes the diagnostic population to the neck, not the shirt.
    for (const anim of ['body_turn', 'turn', 'tilt']) {
      const out = join(dir, `${kind}-frames`, anim);
      command([renderCli, 'render', '--candidate', candidate, '--animation', anim, '--slot', 'throat', ...extremeFlags, '--viewport', '-40,-8,80,80', '--max', '80', '--out', out]);
      const set = join(out, anim), ex = (hasExtremes ? JSON.parse(readFileSync(join(set, 'extremes.json'), 'utf8')) : { status: 'EXPLICIT_KEYS', geometryPair: null, channels: [] }) as { status: string; geometryPair: { frames: Array<{ index: number }>; maxVertexDistance: number } | null; channels: Array<{ min: { index: number }; max: { index: number } }> };
      // Head turn/tilt leave the body unit stationary. Use channel extrema in that case,
      // while retaining geometry-pair extrema whenever the slot moves.
      const motion = JSON.parse(readFileSync(join(dir, `${kind}-rig`, 'motion.json'), 'utf8')) as { animations: Record<string, { tracks: Array<{ keys?: Array<{ t: number; derive?: { degrees: number } }> }> }> };
      const keyed = motion.animations[anim].tracks.flatMap(t => t.keys ?? []).filter(k => k.derive !== undefined);
      const minKey = keyed.reduce((a, b) => a.derive!.degrees <= b.derive!.degrees ? a : b);
      const maxKey = keyed.reduce((a, b) => a.derive!.degrees >= b.derive!.degrees ? a : b);
      const pair = [Math.round(minKey.t * 12), Math.round(maxKey.t * 12)];
      const a = readPng(join(set, `f${String(pair[0]).padStart(4, '0')}.png`)), b = readPng(join(set, `f${String(pair[1]).padStart(4, '0')}.png`));
      let inkDiff = 0, skinDiff = 0;
      const diff = newRaster(a.width, a.height);
      // Independent ROI is the fixture neck and collar in source pixels: x20..40,y20..44.
      // Pinned world grid x=-40..40,y=-8..72 at scale1, source origin at world(-32,64).
      for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
        const k = (y * a.width + x) * 4;
        for (let c = 0; c < 3; c++) diff.data[k + c] = Math.abs(a.data[k + c] - b.data[k + c]);
        diff.data[k + 3] = 255;
        const changed = [0, 1, 2].some(c => a.data[k + c] !== b.data[k + c]);
        // Exact palette witnesses avoid attributing skin or background change to collar line art.
        const ink = (p: typeof a) => p.data[k] === 30 && p.data[k + 1] === 40 && p.data[k + 2] === 50;
        const skin = (p: typeof a) => p.data[k] === 220 && p.data[k + 1] === 160 && p.data[k + 2] === 100;
        const inROI = x >= 28 && x < 48 && y >= 28 && y < 52;
        if (inROI && changed && (ink(a) || ink(b))) inkDiff++;
        if (inROI && changed && (skin(a) || skin(b))) skinDiff++;
      }
      writePng(join(set, 'neck-absdiff.png'), diff);
      const hashes = createHash('sha256');
      for (const file of readdirSync(set).filter(f => /^f\d+\.png$/.test(f)).sort()) hashes.update(readFileSync(join(set, file)));
      receipt.push({ kind, anim, pair, inkDiff, skinDiff, geometryDistance: ex.geometryPair?.maxVertexDistance ?? 0, framesSHA256: hashes.digest('hex') });
      say(`ND_RENDER_${kind.toUpperCase()}_${anim.toUpperCase()}`, kind === 'clean' ? inkDiff === 0 && (anim !== 'body_turn' || skinDiff > 0) : inkDiff > 0, `neck-only extreme ROI collar ink diff=${inkDiff}, skin diff=${skinDiff}, frames=${pair.join('/')}, geometry=${ex.status}`);
    }
    // Full figure native setup/min/max/diff sheets are the visual boundary control.
    command([renderCli, 'render', '--candidate', candidate, ...extremeFlags, '--geometry', '--viewport', '-40,-8,80,80', '--max', '80', '--out', join(dir, `${kind}-full`)]);
  }
  writeFileSync(join(dir, 'render-receipt.json'), JSON.stringify({ core: JSON.parse(readFileSync(join(dirname(renderCli), 'package.json'), 'utf8')).version, hasExtremes, method: 'own animation degree-key min/max, nearest sampled frame; geometry extrema retained separately when supported', viewport: [-40, -8, 80, 80], max: 80, rows: receipt }, null, 2) + '\n');
}

if (import.meta.main) {
  const [mode, dir] = process.argv.slice(2);
  if (dir === undefined) throw new Error('neck controls need mode and output directory');
  mkdirSync(dir, { recursive: true });
  const say: Say = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); if (!ok) process.exitCode = 1; };
  if (mode === '--readers') prepareNeckDraftPacket(dir);
  else if (mode === '--produce') produceNeckDraftPacket(dir);
  else if (mode === '--measure') measureNeckDraftPacket(dir, say);
  else if (mode === '--checks') runNeckDraftChecks(dir, say);
  else if (mode === '--review-checks') runNeckDraftReviewChecks(dir, say);
  else if (mode === '--render') runNeckDraftRenderChecks(dir, say);
  else throw new Error('unknown neck control mode');
}
