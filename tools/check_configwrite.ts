#!/usr/bin/env bun
/** #356 pure merge + real filesystem/CLI controls; run with Bun, never bundled. */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual as same } from 'node:util';
import { configWriteFixture, configWriteProposal } from '../fixtures/configwrite.ts';
import { CLOTH_PARTS, CLOTH_RIG, clothRecipe } from '../fixtures/cloth.ts';
import { PROPOSE_PARTS, writeProposeFixture } from '../fixtures/propose.ts';
import { writeWrapperFixture } from '../fixtures/synthetic.ts';
import { block } from '../fixtures/rig.ts';
import { mergeConfigProposal, type ConfigObject, type ConfigWritePatch } from '../src/configwrite.ts';
import { parseConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { PROPOSAL_CONFIG_SECTIONS } from '../src/propose.ts';
import { KEYPOINT_NAMES } from '../src/skeleton.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { configWriteLines, readConfigWriteTarget, stageConfigWrite } from './configwrite.ts';

const ROOT = resolve(import.meta.dir, '..');
/** Run the existing controls explicitly; the caller owns this directory and reporting. */
export function runConfigWriteChecks(dir: string, report: (name: string, ok: boolean, detail: string) => void, installedBin: string | null = null): number {
  if (installedBin !== null && !existsSync(installedBin)) throw new Error('--installed-bin must name the actual installed launcher');
  mkdirSync(dir, { recursive: true });
  let failed = 0;
  function check(name: string, ok: boolean, detail: string): void {
    report(name, ok, detail);
    if (!ok) failed++;
  }
  function rejected(fn: () => unknown, code: string, path?: string): boolean {
    try { fn(); return false; }
    catch (e) { return e instanceof PartsError && e.problems.some(p => p.code === code && (path === undefined || p.object.includes(path))); }
  }
  function freeze(value: unknown): void {
    if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  function save(path: string, value: unknown): void { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
  function read(path: string): ConfigObject { return JSON.parse(readFileSync(path, 'utf8')) as ConfigObject; }
  function cli(args: string[], cwd = ROOT): { status: number | null; stdout: string; stderr: string } {
    const r = installedBin === null ? spawnSync(process.execPath, [join(ROOT, 'cli.ts'), ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 26 }) : spawnSync(installedBin, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }
  function temporaryCount(): number { return readdirSync(dir, { recursive: true }).filter(n => n.includes('.rig-parts-')).length; }
  const initial = configWriteFixture();
  const baseline = structuredClone(initial);
  freeze(initial);
  const headPatch: ConfigWritePatch = { kind: 'head-box', head_box: [4, 4, 20, 20] };
  const head = mergeConfigProposal(initial, headPatch);
  const expectedHead = structuredClone(baseline);
  (expectedHead.seethrough as Record<string, unknown>).head_box = [4, 4, 20, 20];
  check('CW_HEAD', same(head.config, expectedHead) && same(head.changes, [{ path: 'seethrough.head_box', kind: 'replaced' }]), 'only the nested head box changes; authored siblings stay');
  const planPatch: ConfigWritePatch = { kind: 'assemble-plan', plan: [['changed', 'full', 'topwear']], extend_below_crop: [] };
  const planInput = structuredClone(baseline);
  (planInput.assemble as Record<string, unknown>).extend_below_crop = [{ part: 'old', run: 'head', tag: 'face' }];
  const plan = mergeConfigProposal(planInput, planPatch);
  const expectedPlan = structuredClone(planInput);
  Object.assign(expectedPlan.assemble as object, { plan: [['changed', 'full', 'topwear']], extend_below_crop: [] });
  check('CW_PLAN', same(plan.config, expectedPlan) && same(plan.changes.map(c => c.path), ['assemble.plan', 'assemble.extend_below_crop']), 'plan and extension replaced as whole fields, including clearing extension');
  const proposal = configWriteProposal();
  const inputMotion = structuredClone(baseline);
  (inputMotion.motion as Record<string, unknown>).animations_from = './anims/authored.json';
  const applied = mergeConfigProposal(inputMotion, { kind: 'proposal', proposal, sections: PROPOSAL_CONFIG_SECTIONS });
  const expectedProposal = structuredClone(inputMotion);
  // Independent fixture expectation: these five fields are present; optional constraints are absent and retained.
  expectedProposal.bones = structuredClone(proposal.bones);
  expectedProposal.meshes = structuredClone(proposal.meshes);
  expectedProposal.regions = structuredClone(proposal.regions);
  expectedProposal.motion = structuredClone(proposal.motion);
  expectedProposal.proposed_rig_scale = 0.5;
  check('CW_PROPOSAL', same(applied.config, expectedProposal) && !('notes' in applied.config) && applied.changes.some(c => c.path === 'motion.animations_from' && c.kind === 'removed'), 'whole-section replacement removes unproposed motion subfields; optional absent sections kept; notes excluded; scale saved');
  check('CW_NOOP', mergeConfigProposal(head.config, headPatch).changes.length === 0, 'identical patch has no semantic changes');
  const reordered = mergeConfigProposal(initial, { kind: 'head-box', head_box: [0, 0, 8, 8] });
  check('CW_PURE', same(initial, baseline) && reordered.changes.length === 0 && applied.config.constraints !== inputMotion.constraints, 'frozen source untouched; output owns a separate JSON copy');
  check('CW_ROOT', rejected(() => mergeConfigProposal([], headPatch), 'CONFIG_FIELD_TYPE', 'config'), 'non-object destination refused');
  for (const section of ['seethrough', 'assemble']) check(`CW_PARENT_${section}`, rejected(() => mergeConfigProposal({ [section]: null }, section === 'seethrough' ? headPatch : planPatch), 'CONFIG_FIELD_TYPE', section), 'wrong parent refused instead of replaced');
  check('CW_NONJSON', rejected(() => mergeConfigProposal({ x: undefined }, headPatch), 'CONFIG_FIELD_TYPE', 'config.x'), 'undefined is not silently dropped');
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  check('CW_CYCLE', rejected(() => mergeConfigProposal(cycle, headPatch), 'CONFIG_FIELD_TYPE', 'config.self'), 'cycle is named');
  check('CW_SCALE', rejected(() => parseConfig({ ...applied.config, assemble: { ...(applied.config.assemble as ConfigObject), rig_scale: 0.25 } }), 'CONFIG_PROPOSED_RIG_SCALE'), 'existing full validator owns incompatible scale; merge does not erase its record');
  const unknownBone = structuredClone(proposal); unknownBone.regions.eye = 'missing';
  const badCoverage = mergeConfigProposal(initial, { kind: 'proposal', proposal: unknownBone, sections: PROPOSAL_CONFIG_SECTIONS });
  check('CW_VALIDATOR', rejected(() => parseConfig(badCoverage.config), 'CONFIG_NAME_RESOLVES'), 'merge does not invent a bone to make invalid proposal pass');

  const targetPath = join(dir, 'config.json'); save(targetPath, configWriteFixture());
  chmodSync(targetPath, 0o640);
  const snap = readConfigWriteTarget(targetPath), staged = stageConfigWrite(snap, headPatch);
  check('CW_STAGED', readFileSync(targetPath, 'utf8') === snap.original, 'stage validation leaves destination untouched');
  staged.commit(); staged.cancel();
  check('CW_COMMIT', same(read(targetPath), expectedHead) && (statSync(targetPath).mode & 0o777) === 0o640 && temporaryCount() === 0, 'commit saves complete merged config, preserves mode and cleans owned temp');
  const noOpSnap = readConfigWriteTarget(targetPath), beforeStat = statSync(targetPath), noOp = stageConfigWrite(noOpSnap, headPatch);
  noOp.commit();
  check('CW_FILE_NOOP', statSync(targetPath).mtimeMs === beforeStat.mtimeMs && readFileSync(targetPath, 'utf8') === noOpSnap.original && noOp.changes.length === 0 && configWriteLines(noOpSnap, noOp.changes)[0].endsWith('unchanged'), 'second run keeps exact bytes and mtime');
  const concurrent = stageConfigWrite(readConfigWriteTarget(targetPath), { kind: 'head-box', head_box: [2, 2, 18, 18] });
  const latest = `${readFileSync(targetPath, 'utf8')} `; writeFileSync(targetPath, latest);
  check('CW_RACE', rejected(() => concurrent.commit(), 'CONFIG_WRITE_CHANGED') && readFileSync(targetPath, 'utf8') === latest && temporaryCount() === 0, 'concurrent content preserved rather than overwritten');
  const badSnap = readConfigWriteTarget(targetPath);
  check('CW_ATOMIC_REFUSAL', rejected(() => stageConfigWrite(badSnap, { kind: 'head-box', head_box: [0, 0, 8, 9] }), 'CONFIG_HEAD_BOX_SQUARE') && readFileSync(targetPath, 'utf8') === latest && temporaryCount() === 0, 'existing stage validator rejects nonsquare box; no target/temp residue');
  const renamePath = join(dir, 'rename.json'); save(renamePath, configWriteFixture());
  const renameBefore = readFileSync(renamePath, 'utf8');
  const renameFailed = stageConfigWrite(readConfigWriteTarget(renamePath), headPatch, { replace: () => { throw new Error('injected replace failure'); } });
  check('CW_RENAME_FAILURE', rejected(() => renameFailed.commit(), 'CONFIG_WRITE_FAILED') && readFileSync(renamePath, 'utf8') === renameBefore && temporaryCount() === 0, 'replace-operation failure keeps original and removes only staged file');
  const deniedDir = join(dir, 'cleanup-denied'); mkdirSync(deniedDir);
  const deniedPath = join(deniedDir, 'config.json'); save(deniedPath, configWriteFixture());
  const deniedBefore = readFileSync(deniedPath, 'utf8');
  const denied = stageConfigWrite(readConfigWriteTarget(deniedPath), headPatch, { replace: () => { throw new Error('primary replacement failure'); }, remove: () => { throw new Error('injected cleanup failure'); } });
  let both: PartsError | null = null;
  try { denied.commit(); } catch (error) { if (error instanceof PartsError) both = error; else throw error; }
  const stranded = readdirSync(deniedDir).filter(n => n.includes('.rig-parts-'));
  check('CW_CLEANUP_FAILURE', both !== null && both.problems.some(p => p.detail.includes('primary replacement failure')) && both.problems.some(p => p.object.includes('.rig-parts-') && p.detail.includes('removing the staged config failed')) && readFileSync(deniedPath, 'utf8') === deniedBefore && stranded.length === 1, 'explicit replace/remove failure injection retains primary and exact-temp cleanup errors; independent of runner privilege');
  for (const name of stranded) rmSync(join(deniedDir, name));
  denied.cancel();
  const abortPath = join(dir, 'abort.json'); save(abortPath, configWriteFixture());
  const abortBefore = readFileSync(abortPath, 'utf8');
  const aborted = stageConfigWrite(readConfigWriteTarget(abortPath), headPatch, { remove: () => { throw new Error('injected abort cleanup failure'); } });
  let abortError: PartsError | null = null;
  try { aborted.abort(new Error('artifact emission failed')); } catch (error) { if (error instanceof PartsError) abortError = error; else throw error; }
  check('CW_ARTIFACT_CLEANUP_FAILURE', abortError !== null && abortError.problems.some(p => p.detail.includes('artifact emission failed')) && abortError.problems.some(p => p.detail.includes('injected abort cleanup failure')) && readFileSync(abortPath, 'utf8') === abortBefore, 'CLI-shared abort combines artifact and cleanup failures as named problems');
  for (const name of readdirSync(dir).filter(n => n.includes('.rig-parts-'))) rmSync(join(dir, name));
  aborted.cancel();
  const longPath = join(dir, `${'x'.repeat(240)}.json`); save(longPath, configWriteFixture());
  const longBefore = readFileSync(longPath, 'utf8');
  check('CW_TEMP_FAILURE', rejected(() => stageConfigWrite(readConfigWriteTarget(longPath), headPatch), 'CONFIG_WRITE_FAILED') && readFileSync(longPath, 'utf8') === longBefore && temporaryCount() === 0, 'actual filesystem rejects overlong sibling temporary name; original stays unchanged');
  const relative = join(dir, 'relative'); mkdirSync(join(relative, 'animations'), { recursive: true });
  const animationPath = join(relative, 'animations/extra.json'); save(animationPath, { spec: 'rigc-motion/1', animations: { probe: { duration: 1, tracks: [] } } });
  const relativePath = join(relative, 'config.json'); save(relativePath, configWriteFixture());
  const relativeProposal = configWriteProposal(); Object.assign(relativeProposal.motion, { animations_from: 'animations/extra.json' });
  const relativeStage = stageConfigWrite(readConfigWriteTarget(relativePath), { kind: 'proposal', proposal: relativeProposal, sections: PROPOSAL_CONFIG_SECTIONS });
  relativeStage.commit();
  check('CW_ANIMATION_BESIDE', (read(relativePath).motion as ConfigObject).animations_from === 'animations/extra.json', 'actual full loader resolves animations beside staged destination, not package cwd');
  rmSync(animationPath);
  const relativeBefore = readFileSync(relativePath, 'utf8');
  check('CW_ANIMATION_MISSING', rejected(() => stageConfigWrite(readConfigWriteTarget(relativePath), { kind: 'proposal', proposal: relativeProposal, sections: PROPOSAL_CONFIG_SECTIONS }), 'CONFIG_FILE_PRESENT') && readFileSync(relativePath, 'utf8') === relativeBefore && temporaryCount() === 0, 'same missing beside-config file is refused by actual full loader without replacement');
  const malformed = join(dir, 'malformed.json'); writeFileSync(malformed, '{');
  check('CW_JSON', rejected(() => readConfigWriteTarget(malformed), 'CONFIG_IS_JSON'), 'malformed destination named');
  const duplicate = join(dir, 'duplicate.json'); writeFileSync(duplicate, '{"key":"one","key":"two"}');
  check('CW_DUPLICATE', rejected(() => readConfigWriteTarget(duplicate), 'CONFIG_KEY_UNIQUE'), 'ambiguous duplicate keys refused before rewriting');
  const sym = join(dir, 'symlink.json'); symlinkSync(targetPath, sym);
  check('CW_SYMLINK', rejected(() => readConfigWriteTarget(sym), 'CONFIG_FIELD_TYPE') && lstatSync(sym).isSymbolicLink(), 'symlink remains intact');

  // Actual CLI entry points, driven by independently generated synthetic inputs.
  const layers = join(dir, 'layers'); writeWrapperFixture(layers);
  // The writer CLI fixture uses a square layer canvas; all existing rectangles fit.
  const layerManifest = read(join(layers, 'layers.json')); layerManifest.height = 64; save(join(layers, 'layers.json'), layerManifest);
  const early = { key: 'early', seethrough: { resolution: 64, steps: 1, seed: 0, offload: false }, assemble: { rig_scale: 0.5 }, 'x-kept': { path: '../painting.png' } };
  const headFile = join(dir, 'head.json'); save(headFile, early);
  const headArgs = ['propose', '--head-box', '--full', layers, '--canvas', '64x64'];
  const plainHead = cli(headArgs), savedHead = cli([...headArgs, '--write-config', headFile]);
  if (plainHead.status !== 0 || savedHead.status !== 0) throw new Error(`head-box CLI: ${JSON.stringify({ plainHead, savedHead })}`);
  const last = JSON.parse(plainHead.stdout.trim().split('\n').at(-1) as string) as { head_box: number[] };
  check('CW_CLI_HEAD', plainHead.status === 0 && savedHead.status === 0 && savedHead.stdout === plainHead.stdout && same((read(headFile).seethrough as ConfigObject).head_box, last.head_box) && !('head_box' in read(headFile)), `actual head-box CLI stdout unchanged, nested field saved: ${savedHead.stderr}`);
  const poseDir = join(dir, 'pose-target'); mkdirSync(join(poseDir, 'poses'), { recursive: true });
  const posePath = join(poseDir, 'poses/body.json');
  save(posePath, { width: 64, height: 64, points: Object.fromEntries(KEYPOINT_NAMES.map(k => [k, [32, 32]])) });
  const poseTarget = join(poseDir, 'config.json');
  save(poseTarget, { ...early, generation: { checkpoint: 'fixture.safetensors', loras: [], trigger: '', identity: 'synthetic', sampler: { steps: 1, cfg: 1, sampler: 'euler', scheduler: 'normal' }, costume: 'synthetic', negative_extra: '', pose: 'standing', style: 'synthetic', negative_pose: 'synthetic negative', latent: [64, 64], seed: 0, control: { skeleton: 'poses/body.json', strength: 1, end_percent: 1 } } });
  const otherCwd = join(dir, 'unrelated-cwd'); mkdirSync(otherCwd);
  const beside = cli([...headArgs, '--write-config', poseTarget], otherCwd);
  const besideBefore = readFileSync(poseTarget, 'utf8');
  rmSync(posePath);
  const besideMissing = cli([...headArgs, '--write-config', poseTarget], otherCwd);
  check('CW_CLI_POSE_BESIDE', beside.status === 0 && besideMissing.status === 1 && besideMissing.stdout.includes('CONFIG_FILE_PRESENT') && readFileSync(poseTarget, 'utf8') === besideBefore && temporaryCount() === 0, `actual different-cwd CLI validates beside-config pose: ${besideMissing.stdout}`);
  const painting = join(dir, 'painting.png'); writeFileSync(painting, encodePngBytes(block(64, 64)));
  const planFile = join(dir, 'plan.json'); save(planFile, { ...early, seethrough: { ...early.seethrough, head_box: last.head_box } });
  const planArgs = ['assemble', '--propose-plan', '--source', painting, '--full', layers, '--head', layers, '--config', planFile];
  const plainPlan = cli(planArgs), savedPlan = cli([...planArgs, '--write-config', planFile]);
  const parsedPlan = JSON.parse(plainPlan.stdout) as { plan: unknown; extend_below_crop: unknown };
  check('CW_CLI_PLAN', plainPlan.status === 0 && savedPlan.status === 0 && savedPlan.stdout === plainPlan.stdout && same((read(planFile).assemble as ConfigObject).plan, parsedPlan.plan) && same((read(planFile).assemble as ConfigObject).extend_below_crop, parsedPlan.extend_below_crop), `actual plan CLI saves both fields: ${savedPlan.stderr}`);
  const parts = join(dir, 'parts'); const source = writeProposeFixture(parts);
  const proposalFile = join(dir, 'proposal-config.json');
  const base = { key: 'proposed', assemble: { rig_scale: 1, plan: PROPOSE_PARTS.map(p => [p.name, ...p.from.split(':')]) }, 'x-kept': { path: '../kept.png' } };
  save(proposalFile, base);
  const proposalOut = join(dir, 'out');
  const proposeArgs = ['propose', '--parts', parts, '--source', source, '--out', proposalOut];
  const plainProposal = cli(proposeArgs), savedProposal = cli([...proposeArgs, '--write-config', proposalFile]);
  const emitted = read(join(proposalOut, 'proposal.json'));
  const config = read(proposalFile);
  check('CW_CLI_PROPOSAL', plainProposal.status === 0 && savedProposal.status === 0 && plainProposal.stdout === savedProposal.stdout && config.proposed_rig_scale === 1 && same(config.bones, emitted.bones) && same(config['x-kept'], base['x-kept']) && !('notes' in config), `actual proposal CLI saves generated sections and scale: ${savedProposal.stderr}`);
  const unchangedBytes = readFileSync(proposalFile, 'utf8'), unchangedStat = statSync(proposalFile);
  const again = cli([...proposeArgs, '--write-config', proposalFile]);
  check('CW_CLI_IDEMPOTENT', again.status === 0 && again.stderr.includes('unchanged') && readFileSync(proposalFile, 'utf8') === unchangedBytes && statSync(proposalFile).mtimeMs === unchangedStat.mtimeMs, 'actual repeat does not rewrite config');
  const beforeCompare = read(proposalFile);
  const changedBone = (beforeCompare.bones as ConfigObject[]).find(b => 'name' in b);
  if (changedBone === undefined) throw new Error('fixture proposal has no named bone');
  (changedBone.at as number[])[0] += 10;
  save(proposalFile, beforeCompare);
  const compared = cli([...proposeArgs, '--compare', proposalFile, '--write-config', proposalFile]);
  const basis = read(join(proposalOut, 'basis.json')) as unknown as { bones: Array<{ bone: string; config: { origin_px: number; status: string } | null }> };
  const delta = basis.bones.find(b => b.bone === changedBone.name)?.config;
  check('CW_COMPARE_BEFORE', compared.status === 0 && delta?.origin_px === 10 && delta.status === 'differs' && same(read(proposalFile).bones, emitted.bones), 'basis comparison records the original 10px delta before config replacement');
  for (const artifact of ['proposal.json', 'basis.json', 'render/landmarks.png', 'render/landmarks_head.png']) {
    const collisionOut = join(dir, `collision-${artifact.replaceAll('/', '-')}`);
    const collisionTarget = join(collisionOut, artifact);
    mkdirSync(resolve(collisionTarget, '..'), { recursive: true }); save(collisionTarget, base);
    const original = readFileSync(collisionTarget, 'utf8');
    const call = cli(['propose', '--parts', parts, '--source', source, '--out', collisionOut, '--write-config', collisionTarget]);
    check(`CW_COLLISION_${artifact}`, call.status === 1 && call.stdout.includes('CONFIG_WRITE_TARGET') && readFileSync(collisionTarget, 'utf8') === original, 'owned artifact cannot overwrite its destination config before refusal');
  }
  const realOut = join(dir, 'alias-out'), aliasOut = join(dir, 'alias-parent');
  mkdirSync(realOut); symlinkSync(realOut, aliasOut);
  const aliasTarget = join(realOut, 'proposal.json'); save(aliasTarget, base);
  const aliasBefore = readFileSync(aliasTarget, 'utf8');
  const aliased = cli(['propose', '--parts', parts, '--source', source, '--out', aliasOut, '--write-config', aliasTarget]);
  check('CW_COLLISION_ALIAS', aliased.status === 1 && aliased.stdout.includes('CONFIG_WRITE_TARGET') && readFileSync(aliasTarget, 'utf8') === aliasBefore, 'symlinked output parent cannot hide collision');
  const hardOut = join(dir, 'hard-out'); mkdirSync(hardOut);
  const hardTarget = join(dir, 'hard-config.json'); save(hardTarget, base); linkSync(hardTarget, join(hardOut, 'basis.json'));
  const hardBefore = readFileSync(hardTarget, 'utf8');
  const hard = cli(['propose', '--parts', parts, '--source', source, '--out', hardOut, '--write-config', hardTarget]);
  check('CW_COLLISION_HARDLINK', hard.status === 1 && hard.stdout.includes('CONFIG_WRITE_TARGET') && readFileSync(hardTarget, 'utf8') === hardBefore, 'inode alias cannot hide collision');

  const artifactOut = join(dir, 'artifact-write-fails'); mkdirSync(join(artifactOut, 'render/landmarks.png'), { recursive: true });
  const artifactConfig = join(dir, 'artifact-config.json'); save(artifactConfig, base);
  const artifactBefore = readFileSync(artifactConfig, 'utf8');
  const artifactFailure = cli(['propose', '--parts', parts, '--source', source, '--out', artifactOut, '--write-config', artifactConfig]);
  check('CW_CLI_ARTIFACT_FAILURE', artifactFailure.status === 1 && artifactFailure.stdout.includes('CONFIG_WRITE_FAILED') && !artifactFailure.stdout.includes('wrote proposal.json') && readFileSync(artifactConfig, 'utf8') === artifactBefore && temporaryCount() === 0, 'real output directory/file collision is formatted, original config preserved and staged temp cleaned');
  const mismatched = join(dir, 'scale.json'); save(mismatched, { ...base, assemble: { ...base.assemble, rig_scale: 0.5 } });
  const mismatchedBefore = readFileSync(mismatched, 'utf8');
  const scaleRefusal = cli([...proposeArgs, '--write-config', mismatched]);
  check('CW_CLI_SCALE', scaleRefusal.status === 1 && scaleRefusal.stdout.includes('CONFIG_PROPOSED_RIG_SCALE') && readFileSync(mismatched, 'utf8') === mismatchedBefore, 'actual draft scale mismatch refuses before replacing target');
  check('CW_USAGE_FROM', cli([...proposeArgs, '--from-config', proposalFile, '--write-config', proposalFile]).status === 2, 'writer refused for lint-only --from-config');
  check('CW_USAGE_ASSEMBLE', cli(['assemble', '--source', painting, '--full', layers, '--config', planFile, '--write-config', planFile, '--out', join(dir, 'unused')]).status === 2, 'plain assemble cannot write config');
  check('CW_USAGE_OTHER', cli([...planArgs, '--write-config', headFile]).status === 2, 'plan cannot transplant into another config');
  check('CW_USAGE_VALUE', cli([...headArgs, '--write-config']).status === 2, 'missing destination is usage error');
  const missing = join(dir, 'missing.json');
  check('CW_MISSING', rejected(() => readConfigWriteTarget(missing), 'CONFIG_FILE_PRESENT') && !existsSync(missing), 'missing destination is not implicitly created');
  // Existing and fresh modes share the writer, but retain different ownership
  // and validation. These checks compare unowned bytes, not a re-serialization.
  const bytePath = join(dir, 'byte-config.json');
  const byteBefore = JSON.stringify(configWriteFixture()).replace('"head_box":[0,0,8,8]', '"head_box" : [ 0, 0, 8, 8 ]');
  writeFileSync(bytePath, byteBefore);
  const byteValue = '[ 0, 0, 8, 8 ]', byteAt = byteBefore.indexOf(byteValue);
  const byteStage = stageConfigWrite(readConfigWriteTarget(bytePath), headPatch);
  byteStage.commit();
  const byteAfter = readFileSync(bytePath, 'utf8');
  check('CW_SPLICE_UNOWNED_BYTES', byteAt >= 0 && byteAfter.startsWith(byteBefore.slice(0, byteAt)) && byteAfter.endsWith(byteBefore.slice(byteAt + byteValue.length)) && same((read(bytePath).seethrough as ConfigObject).head_box, [4, 4, 20, 20]), 'same splice engine replaces the owned head_box value while every surrounding byte stays as authored');
  const equalOwnedPath = join(dir, 'equal-owned.json');
  const equalOwnedBefore = JSON.stringify(configWriteFixture()); writeFileSync(equalOwnedPath, equalOwnedBefore);
  const equalOwned = stageConfigWrite(readConfigWriteTarget(equalOwnedPath), { kind: 'proposal', proposal: configWriteProposal(), sections: PROPOSAL_CONFIG_SECTIONS });
  equalOwned.commit();
  const equalOwnedAfter = readFileSync(equalOwnedPath, 'utf8');
  check('CW_SPLICE_EQUAL_OWNED_BYTES', equalOwnedAfter !== equalOwnedBefore && equalOwnedAfter.includes('"bones":' + JSON.stringify(configWriteFixture().bones)) && equalOwnedAfter.includes('"meshes":' + JSON.stringify(configWriteFixture().meshes)) && equalOwnedAfter.includes('"regions":' + JSON.stringify(configWriteFixture().regions)), 'a changed motion/scale does not reserialize the semantically unchanged owned bones, meshes or regions');
  const freshPath = join(dir, 'fresh-parent', 'config.json');
  const freshText = '{ "key" : "partial", "x-record" : [ 1, 2 ] }\n';
  const freshStage = stageConfigWrite({ kind: 'fresh', path: freshPath, text: freshText });
  check('CW_FRESH_STAGED', !existsSync(freshPath) && temporaryCount() === 1, 'shared writer stages a partial cloth config without publishing or requiring rig sections');
  freshStage.commit(); freshStage.cancel();
  check('CW_FRESH_PUBLISH', readFileSync(freshPath, 'utf8') === freshText && temporaryCount() === 0, 'fresh mode publishes the checked text byte for byte and cleans its sibling temp');
  const freshRacePath = join(dir, 'fresh-race.json');
  const freshRace = stageConfigWrite({ kind: 'fresh', path: freshRacePath, text: freshText });
  writeFileSync(freshRacePath, 'concurrent creator');
  check('CW_FRESH_CHANGED', rejected(() => freshRace.commit(), 'PROPOSE_WRITE_CONFIG_FRESH') && readFileSync(freshRacePath, 'utf8') === 'concurrent creator' && temporaryCount() === 0, 'fresh mode rechecks its destination at commit and preserves an intervening creator');
  const freshAtomicPath = join(dir, 'fresh-atomic.json');
  const freshAtomic = stageConfigWrite({ kind: 'fresh', path: freshAtomicPath, text: freshText }, undefined, { publish: (from, to) => { writeFileSync(to, 'after the final check'); linkSync(from, to); } });
  check('CW_FRESH_ATOMIC', rejected(() => freshAtomic.commit(), 'PROPOSE_WRITE_CONFIG_FRESH') && readFileSync(freshAtomicPath, 'utf8') === 'after the final check' && temporaryCount() === 0, 'same-directory publish cannot replace a file created after the final absence check');
  const freshAbortPath = join(dir, 'fresh-abort.json');
  const freshAbort = stageConfigWrite({ kind: 'fresh', path: freshAbortPath, text: freshText });
  check('CW_FRESH_ABORT', rejected(() => freshAbort.abort(new Error('artifact emission failed')), 'CONFIG_WRITE_FAILED') && !existsSync(freshAbortPath) && temporaryCount() === 0, 'shared artifact abort leaves the fresh destination absent and removes its owned temp');
  const freshFailDir = join(dir, 'fresh-cleanup-failure'); mkdirSync(freshFailDir);
  const freshFailPath = join(freshFailDir, 'config.json');
  const freshFail = stageConfigWrite({ kind: 'fresh', path: freshFailPath, text: freshText }, undefined, { publish: () => { throw new Error('fresh publish failure'); }, remove: () => { throw new Error('fresh cleanup failure'); } });
  let freshErrors: PartsError | null = null;
  try { freshFail.commit(); } catch (error) { if (error instanceof PartsError) freshErrors = error; else throw error; }
  check('CW_FRESH_CLEANUP_FAILURE', freshErrors !== null && freshErrors.problems.some(p => p.detail.includes('fresh publish failure')) && freshErrors.problems.some(p => p.detail.includes('fresh cleanup failure') && p.object.includes('.rig-parts-')) && !existsSync(freshFailPath), 'shared fresh writer retains publication and cleanup errors together, with the exact staged path');
  for (const name of readdirSync(freshFailDir)) rmSync(join(freshFailDir, name));
  freshFail.cancel();
  // A single config follows the documented writer steps, not three isolated
  // merge calls: the saved head box feeds inputs/plan, and that plan feeds rig parts.
  const sequenceConfig = join(dir, 'sequence-config.json'); save(sequenceConfig, early);
  const sequenceWork = join(dir, 'sequence-work');
  const sequenceCalls = [
    cli([...headArgs, '--write-config', sequenceConfig]),
    cli(['inputs', '--source', painting, '--config', sequenceConfig, '--out', join(dir, 'sequence-inputs')]),
    cli(['assemble', '--propose-plan', '--source', painting, '--full', layers, '--head', layers, '--config', sequenceConfig, '--write-config', sequenceConfig]),
    cli(['assemble', '--source', painting, '--full', layers, '--head', layers, '--config', sequenceConfig, '--out', sequenceWork]),
    cli(['propose', '--parts', join(sequenceWork, 'rig'), '--source', painting, '--out', sequenceWork, '--write-config', sequenceConfig]),
  ];
  const sequence = read(sequenceConfig);
  const sequenceProposalPath = join(sequenceWork, 'proposal.json');
  const sequenceProposal = existsSync(sequenceProposalPath) ? read(sequenceProposalPath) : null;
  check('CW_CLI_STEP_SEQUENCE', sequenceCalls.every(r => r.status === 0) && sequenceProposal !== null &&
    PROPOSAL_CONFIG_SECTIONS.every(k => sequenceProposal[k] === undefined || same(sequence[k], sequenceProposal[k])) &&
    existsSync(join(dir, 'sequence-inputs', 'st_input_head.png')) && same(sequence['x-kept'], early['x-kept']) &&
    same((sequence.seethrough as ConfigObject).head_box, last.head_box) && typeof parseConfig(sequence).key === 'string',
    'head-box -> inputs -> plan -> assemble -> proposal on one existing config: ' + sequenceCalls.map((r, i) => i + ': exit ' + r.status + (r.status === 0 ? '' : ' ' + r.stdout + r.stderr)).join(' | '));
  // The cloth mode retains its partial-config splice and fresh-file contract.
  const clothParts = join(dir, 'cloth-parts');
  const clothPainting = writeProposeFixture(clothParts, CLOTH_PARTS, CLOTH_RIG);
  const clothInput = join(dir, 'cloth-partial.json');
  const clothText = JSON.stringify({ key: 'cloth', cloth: clothRecipe(), 'x-kept': 'authored' }, null, 3) + '\n';
  writeFileSync(clothInput, clothText);
  const clothBase = ['propose', '--parts', clothParts, '--source', clothPainting, '--cloth', clothInput];
  const clothOutput = join(dir, 'cloth-written.json');
  const clothRun = cli([...clothBase, '--out', join(dir, 'cloth-out'), '--write-config', clothOutput]);
  const clothWritten = existsSync(clothOutput) ? read(clothOutput) : null;
  check('CW_CLOTH_PARTIAL', clothRun.status === 0 && clothWritten !== null && clothWritten['x-kept'] === 'authored' && !('assemble' in clothWritten) && readFileSync(clothInput, 'utf8') === clothText, 'cloth still splices a partial config without the in-place full loader');
  const clothBefore = clothWritten === null ? '' : readFileSync(clothOutput, 'utf8');
  const clothExists = cli([...clothBase, '--out', join(dir, 'cloth-refused'), '--write-config', clothOutput]);
  check('CW_CLOTH_FRESH', clothExists.status === 1 && clothExists.stdout.includes('PROPOSE_WRITE_CONFIG_FRESH') && readFileSync(clothOutput, 'utf8') === clothBefore && !existsSync(join(dir, 'cloth-refused')), 'cloth never replaces an existing output');
  for (const artifact of ['proposal.json', 'basis.json', 'render/landmarks.png', 'render/landmarks_head.png']) {
    const output = join(dir, 'cloth-collision-' + artifact.replaceAll('/', '-'));
    const target = join(output, artifact);
    const collision = cli([...clothBase, '--out', output, '--write-config', target]);
    check('CW_CLOTH_COLLISION_' + artifact, collision.status === 1 && collision.stdout.includes('PROPOSE_WRITE_CONFIG_FRESH') && !existsSync(output), 'cloth refuses each owned artifact before creating any output');
  }
  const clothReal = join(dir, 'cloth-real'), clothAlias = join(dir, 'cloth-alias');
  mkdirSync(clothReal); symlinkSync(clothReal, clothAlias);
  const clothAliased = cli([...clothBase, '--out', clothAlias, '--write-config', join(clothReal, 'render', 'landmarks.png')]);
  check('CW_CLOTH_ALIAS', clothAliased.status === 1 && clothAliased.stdout.includes('PROPOSE_WRITE_CONFIG_FRESH') && readdirSync(clothReal).length === 0, 'cloth output parent aliases cannot hide a collision on a not-yet-existing artifact');
  const clothHardOut = join(dir, 'cloth-hard'); mkdirSync(join(clothHardOut, 'render'), { recursive: true });
  const clothHardTarget = join(dir, 'cloth-hard-config.json'); save(clothHardTarget, { key: 'existing' });
  linkSync(clothHardTarget, join(clothHardOut, 'render', 'landmarks.png'));
  const clothHardBefore = readFileSync(clothHardTarget, 'utf8');
  const clothHard = cli([...clothBase, '--out', clothHardOut, '--write-config', clothHardTarget]);
  check('CW_CLOTH_HARDLINK', clothHard.status === 1 && clothHard.stdout.includes('PROPOSE_WRITE_CONFIG_FRESH') && readFileSync(clothHardTarget, 'utf8') === clothHardBefore, 'existing inode aliases remain refused by the cloth fresh-file rule');
  check('CW_CLEAN', temporaryCount() === 0, 'no owned staging files left after positives/refusals');
  return failed;
}

if (import.meta.main) {
  const installed = process.argv.indexOf('--installed-bin');
  const installedBin = installed < 0 ? null : process.argv[installed + 1];
  if (installedBin === undefined || (installedBin !== null && !existsSync(installedBin))) throw new Error('--installed-bin must name the actual installed launcher');
  const keep = process.argv.indexOf('--keep');
  const dir = keep < 0 ? mkdtempSync(join(tmpdir(), 'parts-configwrite-')) : resolve(process.argv[keep + 1]);
  let failed = 0;
  try {
    failed = runConfigWriteChecks(dir, (name, ok, detail) => {
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
      if (!ok) failed++;
    }, installedBin);
  } catch (error) { failed++; console.error(error); }
  finally { if (keep < 0) rmSync(dir, { recursive: true, force: true }); }
  console.log(`CONFIGWRITE ${failed === 0 ? 'PASS' : 'FAIL'}: ${failed} failure(s)`);
  process.exitCode = failed === 0 ? 0 : 1;
}
