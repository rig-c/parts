/** Explicit regeneration only. Normal selftests read tracked expectations. */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeValidationSample, prepareValidationCloth } from './validation.ts';
import { VALIDATION_VARIANTS, validationBuild, validationConfigName, validationFiles, validationHead } from './validation_cache.ts';
import { choosePerson, loadKeypoints, toRigJoints } from '../src/keypoints.ts';
import { loadClothConfig } from '../src/config.ts';
import { propose, readPartSet, serializeProposal } from '../src/propose.ts';

export const VALIDATION_NO_BUST = 'synthetic fixture has no bust landmarks';

export async function regenerateValidation(root: string, output: string): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'rig-parts-validation-regenerate-'));
  const previousCache = process.env.RIG_PARTS_VALIDATION_CACHE;
  process.env.RIG_PARTS_VALIDATION_CACHE = join(scratch, 'cache');
  let complete = false;
  try {
    writeValidationSample(output);
    const assembled = join(scratch, 'assembled');
    const r = spawnSync(process.execPath, [join(root, 'cli.ts'), 'assemble', '--config', join(output, 'config.json'),
      '--source', join(output, 'inputs', 'painting.png'), '--full', join(output, 'inputs', 'layers', 'full'),
      '--head', join(output, 'inputs', 'layers', 'head'), '--out', assembled], { cwd: root, encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) throw new Error('validation regeneration assemble refused: ' + r.stdout + r.stderr);
    for (const variant of VALIDATION_VARIANTS) {
      if (variant === 'standard') continue;
      const at = join(scratch, variant);
      writeValidationSample(at, variant);
      if (variant === 'travel') cpSync(join(at, 'inputs'), join(output, 'inputs', 'travel'), { recursive: true });
      if (variant === 'cloth' || variant === 'physics-mixed') prepareValidationCloth(at, join(assembled, 'rig'), variant === 'physics-mixed');
      cpSync(join(at, 'config.json'), join(output, validationConfigName(variant)));
    }
    writeFileSync(join(output, 'breeze.json'), JSON.stringify({ spec: 'rigc-environment/1',
      steps: Array.from({ length: 9 }, (_, i) => ({ t: i / 2, wind: [i % 2 === 0 ? 2 : -2, 0] })),
    }, null, 2) + '\n');
    // The writer controls need a config whose sections are the actual proposal,
    // including two limb declarations and three independently authored recipes.
    const travel = join(output, 'inputs', 'travel');
    const posedParts = join(scratch, 'posed-parts');
    const assembledPose = spawnSync(process.execPath, [join(root, 'cli.ts'), 'assemble', '--config', join(output, 'config.travel.json'),
      '--source', join(travel, 'painting.png'), '--full', join(travel, 'layers', 'full'), '--head', join(travel, 'layers', 'head'), '--out', posedParts],
    { cwd: root, encoding: 'utf8', timeout: 60000 });
    if (assembledPose.status !== 0) throw new Error('validation authoring assemble refused: ' + assembledPose.stdout + assembledPose.stderr);
    const P = readPartSet(join(posedParts, 'rig'));
    const kp = loadKeypoints(join(output, 'keypoints.json'));
    const joints = toRigJoints(kp, choosePerson(kp, undefined, 'validation'), P.W, P.H);
    const recipe = { bottomwear: { chains: 2, links: 3, wind: [1, 2] as [number, number], gravity: [1, 2] as [number, number] },
      'back hair': { chains: 1, links: 2, wind: [1, 2] as [number, number], gravity: [1, 2] as [number, number] },
      'front hair': { chains: 1, links: 2, wind: [1, 2] as [number, number], gravity: [1, 2] as [number, number] } };
    const authored = propose(P, joints, null, undefined, recipe, true, { noBust: VALIDATION_NO_BUST });
    const authoring = JSON.parse(readFileSync(join(output, 'config.travel.json'), 'utf8')) as Record<string, unknown>;
    const sections = authored as unknown as Record<string, unknown>;
    for (const name of ['bones', 'meshes', 'regions', 'limbs', 'motion', 'constraints']) {
      if (sections[name] === undefined) delete authoring[name]; else authoring[name] = sections[name];
    }
    authoring.cloth = recipe;
    writeFileSync(join(output, 'config.authoring.json'), JSON.stringify(authoring, null, 2) + '\n');
    mkdirSync(join(output, 'expected', 'authoring'), { recursive: true });
    writeFileSync(join(output, 'expected', 'authoring', 'proposal.json'), serializeProposal(authored));
    // Derive README snapshots from the README's own commands and paste list.
    // These runs stop before build; the selftest runs the actual final build.
    const { readmeLoopLines, readmePasteSections, runReadmeLoop, sampleView } = await import('../selftest.ts');
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    const lines = readmeLoopLines(readme), paste = readmePasteSections(readme);
    if (typeof lines === 'string' || typeof paste === 'string') throw new Error('validation README sequence is unreadable');
    const buildAt = lines.findIndex(line => line.startsWith('rig-parts build '));
    if (buildAt < 0) throw new Error('validation README has no final build');
    const view = sampleView(join(scratch, 'loop-view'), 'travel', output);
    const { chains: _explicitChains, ...massRecipe } = recipe['back hair'];
    const loopRecipe = { ...recipe, 'back hair': massRecipe };
    for (const [name, keypoints, cloth] of [
      ['loop-plain', null, null], ['loop-posed', join(output, 'keypoints.json'), null], ['loop-cloth', join(output, 'keypoints.json'), loopRecipe],
    ] as const) {
      const work = join(scratch, name);
      const result = runReadmeLoop(lines.slice(0, buildAt), view, work, paste, keypoints, cloth);
      if (result.refused !== null || result.proposal === null) throw new Error(`validation ${name} draft refused: ${JSON.stringify(result.refused)}`);
      cpSync(join(work, 'config.json'), join(output, `config.${name}.json`));
      mkdirSync(join(output, 'expected', name), { recursive: true });
      writeFileSync(join(output, 'expected', name, 'proposal.json'), JSON.stringify(result.proposal, null, 2) + '\n');
    }
    const head = validationHead(root);
    for (const variant of VALIDATION_VARIANTS) {
      const build = validationBuild(root, join(scratch, 'cache'), head, variant, output);
      if (build === null) throw new Error('validation regeneration inputs are incomplete');
      const expected = join(output, 'expected', variant);
      mkdirSync(expected, { recursive: true });
      for (const [source, name] of [['painting_in_rig.png', 'painting_in_rig.png'], ['parts.json', 'parts.json'], ['rig/rig.json', 'rig.json'],
        ['rig/motion.json', 'motion.json'], ['rig/mesh_report.json', 'mesh_report.json'],
        ['check/gate_spine-html.txt', 'gate_spine-html.txt']] as const) cpSync(join(build.out, source), join(expected, name));
      if (variant === 'gesture') cpSync(join(build.out, 'rig', 'sets.json'), join(expected, 'sets.json'));
      const check = JSON.parse(readFileSync(join(build.out, 'check', 'check.json'), 'utf8')) as { config: { path: string } };
      check.config.path = `fixtures/validation-inputs/${validationConfigName(variant)}`;
      writeFileSync(join(expected, 'check.json'), JSON.stringify(check, null, 2) + '\n');
      const P = readPartSet(build.out);
      const kp = loadKeypoints(join(output, 'keypoints.json'));
      const joints = toRigJoints(kp, choosePerson(kp, undefined, join(output, 'keypoints.json')), P.W, P.H);
      const cloth = loadClothConfig(join(output, validationConfigName(variant))).cloth;
      for (const grid of ['figure', 'part'] as const) {
        const proposal = propose(P, joints, null, grid, cloth, true, { noBust: VALIDATION_NO_BUST });
        writeFileSync(join(expected, grid === 'figure' ? 'proposal.json' : 'proposal.part.json'), serializeProposal(proposal));
      }
    }
    console.log(`validation sample regenerated at ${relative(root, output)}`);
    complete = true;
  } finally {
    if (previousCache === undefined) delete process.env.RIG_PARTS_VALIDATION_CACHE; else process.env.RIG_PARTS_VALIDATION_CACHE = previousCache;
    if (complete) rmSync(scratch, { recursive: true, force: true });
    else {
      const evidence = process.env.RIG_PARTS_VALIDATION_EVIDENCE;
      if (evidence !== undefined) {
        mkdirSync(evidence, { recursive: true });
        const target = mkdtempSync(join(evidence, 'regeneration-'));
        for (const file of validationFiles(scratch)) if (/(?:producer\.log|build\.log|green\.json|build-times\.jsonl|STOP\.json)$/.test(file)) {
          mkdirSync(join(target, file, '..'), { recursive: true }); cpSync(join(scratch, file), join(target, file));
        }
        console.error(`validation regeneration RED receipts retained at ${target}`);
      }
      console.error(`validation regeneration scratch retained at ${scratch}`);
    }
  }
}

if (import.meta.main) {
  if (process.argv.length > 3) throw new Error('usage: bun fixtures/regenerate_validation.ts [output-directory]');
  await regenerateValidation(resolve(import.meta.dir, '..'), resolve(process.argv[2] ?? join(import.meta.dir, 'validation-inputs')));
}
