/** Public rectangles only: the producer's JSON is copied verbatim into the real reader. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeTakeFallbackFixture, writeTakeFixture } from '../fixtures/take_layers.ts';
import { writeRun, C } from '../fixtures/assemble_fixture.ts';
import { SIDE, writeOccluderProposeFixture } from '../fixtures/occluder_chain.ts';
import { readRuns } from '../src/build.ts';
import { loadEarlyConfig } from '../src/config.ts';
import { applyTakenLayers } from '../src/takelayers.ts';
import { orderPlanForOccluders } from '../src/occluders.ts';
import { PartsError } from '../src/errors.ts';
import { readPng } from '../src/raster/png.ts';
import { type PlanProposal, proposeFields, proposePlan } from '../src/assemble.ts';

export function runTakePlanOrderChecks(dir: string, report: (name: string, pass: boolean, detail: string) => void): void {
  const say = (name: string, pass: boolean, detail: string): void => report(name, pass, detail.replaceAll('\n', ' | '));
  const cfg = writeTakeFallbackFixture(dir);
  const args = ['cli.ts', 'assemble', '--source', join(dir, 'painting.png'), '--full', join(dir, 'full'), '--head', join(dir, 'head'), '--config', join(dir, 'config.json')];
  const proposal = spawnSync(process.execPath, [...args, '--propose-plan'], { encoding: 'utf8' });
  writeFileSync(join(dir, 'propose.raw.log'), proposal.stdout + proposal.stderr);
  say('FALLBACK_PRODUCER_SUCCEEDS', proposal.status === 0, `exit ${proposal.status}; ${proposal.stderr}`);
  if (proposal.status !== 0) return;
  const p = JSON.parse(proposal.stdout) as PlanProposal;
  const tags = p.plan.map(row => row[2]);
  say('FALLBACK_ACCESSORY_AFTER_BODY_BEFORE_FACE', tags.indexOf('headwear') > tags.indexOf('handwear-r') && tags.indexOf('headwear') < tags.indexOf('face'), JSON.stringify(p.plan));
  say('HOLLOW_HEAD_FALLBACK_REPRODUCED', p.notes.some(n => n.includes('SEETHROUGH_HEAD_RUN_HOLLOW')) && ['face', 'front hair', 'headwear'].every(t => p.plan.some(([, run, tag]) => run === 'full' && tag === t)), p.notes.join(' | '));
  const assemble = cfg.assemble as Record<string, unknown>;
  assemble.plan = p.plan;
  assemble.extend_below_crop = p.extend_below_crop;
  writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg));
  const result = spawnSync(process.execPath, [...args, '--out', join(dir, 'out')], { encoding: 'utf8' });
  writeFileSync(join(dir, 'assemble.raw.log'), result.stdout + result.stderr);
  say('UNEDITED_PROPOSED_PLAN_ASSEMBLES', result.status === 0, `exit ${result.status}; ${result.stdout}${result.stderr}`);
  const image = join(dir, 'out', 'render', 'recomposite_rig.png');
  if (existsSync(image)) {
    const at = (path: string) => [...readPng(path).data.slice((9 * 64 + 9) * 4, (9 * 64 + 9) * 4 + 4)];
    const rgb = at(image);
    say('FRONT_HAIR_OVER_FACE_AT_OVERLAP', rgb.join(',') === '40,100,120,255' && tags.indexOf('front hair') > tags.indexOf('face'), `recomposite [9,9] RGBA ${rgb}; generated face RGB 100,60,40; overlap 24x12 = 288 source px`);
  } else say('FRONT_HAIR_OVER_FACE_AT_OVERLAP', false, 'no recomposite emitted');
  // The front-hair role remains a measured order even against the scalar order.
  const reverse = p.plan.map(row => [...row]);
  const faceAt = reverse.findIndex(row => row[2] === 'face'), hairAt = reverse.findIndex(row => row[2] === 'front hair');
  [reverse[faceAt], reverse[hairAt]] = [reverse[hairAt], reverse[faceAt]];
  assemble.plan = reverse;
  writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg));
  const reversed = spawnSync(process.execPath, [...args, '--out', join(dir, 'reversed')], { encoding: 'utf8' });
  writeFileSync(join(dir, 'reversed.raw.log'), reversed.stdout + reversed.stderr);
  const reversedText = reversed.stdout + reversed.stderr;
  say('OVERLAPPING_ROLE_REVERSAL_REFUSED', reversed.status === 1 && reversedText.includes('ASSEMBLE_TAKE_PLAN_ORDER: full plan parts "hair_front" / "face"') && reversedText.includes('two-run full-layer roles "front hair" / "face"') && reversedText.includes('overlap at 288 run px') && reversedText.includes('refused: 1 problem(s)') && !existsSync(join(dir, 'reversed')), `exit ${reversed.status}; ${reversedText}`);
  // Restore the producer JSON so a retained fixture remains reviewable.
  assemble.plan = p.plan;
  writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg));
  say('PROPOSAL_JSON_RETAINED', JSON.parse(readFileSync(join(dir, 'propose.raw.log'), 'utf8')).plan.length === p.plan.length, `${p.plan.length} generated rows`);

  const scalar = join(dir, 'support-controls'), sc = writeTakeFixture(scalar);
  (sc.seethrough as Record<string, unknown>).head_box = [0, 0, 64, 64];
  const sa = sc.assemble as Record<string, unknown>;
  sa.take = [{ run: 'full', run_dir: 'donor', st_input: 'painting.png', tags: ['bottomwear'] }];
  sa.plan = [['near_first', 'full', 'bottomwear'], ['far_later', 'full', 'topwear']];
  writeRun(join(scalar, 'full'), [{ name: 'topwear', depth: 0.7, rects: [{ x0: 8, y0: 8, x1: 40, y1: 24, colour: C }] }]);
  writeRun(join(scalar, 'donor'), [{ name: 'bottomwear', depth: 0.2, rects: [{ x0: 16, y0: 8, x1: 32, y1: 24, colour: [40, 100, 120] }] }]);
  writeFileSync(join(scalar, 'config.json'), JSON.stringify(sc));
  const loaded = loadEarlyConfig(join(scalar, 'config.json'), 'assemble');
  const runs = readRuns(join(scalar, 'full'), join(dir, 'head'));
  let disjointDiff = -1, overlapDiff = -1;
  // Clones are complete before measurement. Both retain the same overlapping bboxes.
  const checkSupport = (alpha: number | null): string => {
    const layer = runs.full.layers[0];
    const pixels = { ...layer.pixels, data: new Uint8ClampedArray(layer.pixels.data) };
    for (let y = 0; y < pixels.height; y++) for (let x = 8; x < 24; x++) pixels.data[(y * pixels.width + x) * 4 + 3] = 0;
    if (alpha !== null) pixels.data[(2 * pixels.width + 12) * 4 + 3] = alpha;
    // Independent source-over oracle on the donor rectangle, using its authored opaque RGB.
    let differing = 0;
    for (let y = 0; y < pixels.height; y++) for (let x = 8; x < 24; x++) {
      const q = (y * pixels.width + x) * 4, a = pixels.data[q + 3] / 255;
      if ([40, 100, 120].some((v, c) => Math.round(pixels.data[q + c] * a + v * (1 - a)) !== v)) differing++;
    }
    if (alpha === null) disjointDiff = differing;
    if (alpha === 9) overlapDiff = differing;
    const full = { ...runs.full, layers: [{ ...layer, pixels }] };
    try { applyTakenLayers({ ...runs, full }, readPng(join(scalar, 'painting.png')), loaded, join(scalar, 'config.json')); return ''; }
    catch (e) { if (e instanceof PartsError) return e.message; throw e; }
  };
  const disjoint = checkSupport(null), atEight = checkSupport(8), atNine = checkSupport(9);
  say('DISJOINT_SUPPORTS_ALLOW_SCALAR_REVERSAL', disjoint === '' && disjointDiff === 0, `256 bbox-intersection px, 0 support-intersection px; independent reversed-composite diff ${disjointDiff} px; refusal ${disjoint || 'none'}`);
  say('ALPHA_EIGHT_DOES_NOT_IMPOSE_ORDER', atEight === '', atEight || 'alpha 8 in the common cell: 0 support-intersection px');
  say('ONE_ALPHA_NINE_OVERLAP_REFUSES_SCALAR_REVERSAL', atNine.includes('ASSEMBLE_TAKE_PLAN_ORDER: full plan parts "near_first" / "far_later"') && atNine.includes('overlap at 1 run px') && atNine.includes('depths 0.2 / 0.7') && overlapDiff === 1, `${atNine}; independent reversed-composite diff ${overlapDiff} px`);
  loaded.assemble.plan!.reverse();
  const sorted = checkSupport(9);
  say('OVERLAPPING_SCALAR_ORDER_POSITIVE', sorted === '', sorted || 'same alpha-9 pixel and mixed sources, larger depth first: accepted');

  // Issue #1251 item 2 controls: occluder-split takes in `--propose-plan`, tag matching in `orderPlanForOccluders`, and unmatched-name notes.
  const occPropDir = join(dir, 'occluder-propose-split');
  const occInputs = writeOccluderProposeFixture(occPropDir);
  const splitProposeCfgPath = join(occPropDir, 'cfg-split-propose.json');
  writeFileSync(
    splitProposeCfgPath,
    JSON.stringify(
      {
        key: 'occ_split_propose',
        seethrough: { resolution: SIDE, steps: 30, seed: 42, offload: false, head_box: [0, 0, SIDE, SIDE] },
        assemble: {
          rig_scale: 1,
          occluders: [{ image: 'occluder.png', sha256: occInputs.occluderSha, under: ['legwear'], over: ['objects'], rgb_within: 20 }],
          take: [
            { run: 'full', run_dir: 'orig', st_input: 'painting.png', part: 'legwear', tag: 'legwear', occluder: 0 },
            { run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['objects'] },
          ],
        },
      },
      null,
      2,
    ),
  );
  const splitProposed = spawnSync(
    process.execPath,
    ['cli.ts', 'assemble', '--source', occInputs.painting, '--full', occInputs.plateRunDir, '--head', occInputs.plateRunDir, '--config', splitProposeCfgPath, '--propose-plan'],
    { encoding: 'utf8' },
  );
  const splitProposedOut = `${splitProposed.stdout}${splitProposed.stderr}`;
  const splitProposal = splitProposed.status === 0 ? (JSON.parse(splitProposed.stdout) as PlanProposal) : null;
  const splitPlanNames = splitProposal?.plan.map((r) => `${r[0]}:${r[1]}`) ?? [];
  const seededRegionCfgPath = join(occPropDir, 'cfg-seeded-region.json');
  writeFileSync(
    seededRegionCfgPath,
    JSON.stringify(
      {
        key: 'occ_seeded_region',
        seethrough: { resolution: SIDE, steps: 30, seed: 42, offload: false, head_box: [0, 0, SIDE, SIDE] },
        assemble: {
          rig_scale: 1,
          take: [{ run: 'full', run_dir: 'orig', st_input: 'painting.png', part: 'legwear', seed: [40, 40] }],
        },
      },
      null,
      2,
    ),
  );
  const seededRefused = spawnSync(
    process.execPath,
    ['cli.ts', 'assemble', '--source', occInputs.painting, '--full', occInputs.plateRunDir, '--head', occInputs.plateRunDir, '--config', seededRegionCfgPath, '--propose-plan'],
    { encoding: 'utf8' },
  );
  const seededRefusedOut = `${seededRefused.stdout}${seededRefused.stderr}`;
  say(
    'SPLIT_TAKE_PROPOSES_AND_SEEDED_REGION_REFUSED',
    splitProposed.status === 0 &&
      !splitProposedOut.includes('ASSEMBLE_REGION_TAKE_PLAN') &&
      splitPlanNames.join(',') === 'legwear:full,objects:full,face:head,eyewhite_r:head,eyewhite_l:head' &&
      splitProposal?.notes.some((n) => n.includes('split occluder[0] occluder.png') && n.includes('covered 2048 run px, visible 1792 run px')) === true &&
      seededRefused.status === 1 &&
      seededRefusedOut.includes('ASSEMBLE_REGION_TAKE_PLAN') &&
      seededRefusedOut.includes('config.assemble.take part "legwear" from "orig"') &&
      seededRefusedOut.includes('seeded region take (full, seed [40, 40])'),
    `split exit=${splitProposed.status} plan=[${splitPlanNames.join(', ')}]; seeded exit=${seededRefused.status} (${seededRefusedOut.trim()})`,
  );

  // Bar (b): Taken layers whose drafted names (`shoes` for `footwear`, `objects` for `fg_crate`, `legwear` for split `behind`)
  // differ from the config's `over` / `under` names; tag matching orders each `over` row after its `under` rows,
  // while a planted name-only matcher leaves them unordered (`shoes` and `objects` before `legwear`).
  const tagMatchCfgPath = join(occPropDir, 'cfg-tag-match.json');
  writeFileSync(
    tagMatchCfgPath,
    JSON.stringify(
      {
        key: 'occ_tag_match',
        seethrough: { resolution: SIDE, steps: 30, seed: 42, offload: false, head_box: [0, 0, SIDE, SIDE] },
        assemble: {
          rig_scale: 1,
          plan: [
            ['fg_crate', 'full', 'objects'],
            ['boots', 'full', 'footwear'],
            ['behind', 'full', 'legwear'],
            ['face', 'head', 'face'],
            ['eyewhite_r', 'head', 'eyewhite-r'],
            ['eyewhite_l', 'head', 'eyewhite-l'],
          ],
          occluders: [{ image: 'occluder.png', sha256: occInputs.occluderSha, under: ['behind'], over: ['fg_crate', 'boots'], rgb_within: 20 }],
          take: [
            { run: 'full', run_dir: 'orig', st_input: 'painting.png', part: 'behind', tag: 'legwear', occluder: 0 },
            { run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['objects', 'footwear'] },
          ],
        },
      },
      null,
      2,
    ),
  );
  const tagMatchEarly = loadEarlyConfig(tagMatchCfgPath, 'layers');
  const tagMatchSrc = readPng(occInputs.painting);
  const tagMatchRuns = applyTakenLayers(
    readRuns(occInputs.plateRunDir, occInputs.plateRunDir),
    tagMatchSrc,
    { ...tagMatchEarly, assemble: { ...tagMatchEarly.assemble, plan: undefined } },
    tagMatchCfgPath,
  );
  const tagMatchFields = proposeFields(tagMatchEarly, null);
  const tagMatchedProposal = proposePlan(tagMatchRuns.full, tagMatchRuns.head, { sourceW: SIDE, sourceH: SIDE, ...tagMatchFields });
  const tagMatchedOrder = tagMatchedProposal.plan.map((r) => `${r[0]}:${r[1]}`);
  // Planted name-only matcher: draft without occluders, then run `orderPlanForOccluders` with no `takenTags`.
  const unReorderedProposal = proposePlan(tagMatchRuns.full, tagMatchRuns.head, {
    sourceW: SIDE,
    sourceH: SIDE,
    ...tagMatchFields,
    occluderDeclarations: undefined,
    occluderTakenTags: undefined,
  });
  const plantedNameOnlyPlan = unReorderedProposal.plan.map((r) => [...r] as [string, string, string]);
  orderPlanForOccluders(plantedNameOnlyPlan, tagMatchEarly.assemble.occluders);
  const plantedNameOnlyOrder = plantedNameOnlyPlan.map((r) => `${r[0]}:${r[1]}`);
  say(
    'OCCLUDER_OVER_MATCHES_TAKEN_LAYER_TAG_AND_REORDERS',
    tagMatchedOrder.join(',') === 'behind:full,shoes:full,objects:full,face:head,eyewhite_r:head,eyewhite_l:head' &&
      tagMatchedProposal.notes.every((n) => !n.includes('matched no proposed row')) &&
      plantedNameOnlyOrder.join(',') === 'shoes:full,objects:full,behind:full,face:head,eyewhite_r:head,eyewhite_l:head' &&
      plantedNameOnlyOrder.indexOf('behind:full') > plantedNameOnlyOrder.indexOf('objects:full') &&
      plantedNameOnlyOrder.indexOf('behind:full') > plantedNameOnlyOrder.indexOf('shoes:full'),
    `tag-matched=[${tagMatchedOrder.join(', ')}]; planted name-only=[${plantedNameOnlyOrder.join(', ')}]`,
  );

  // Bar (c): An `over` name that matches nothing yields exactly one note naming it.
  const unmatchedOverCfgPath = join(occPropDir, 'cfg-unmatched-over.json');
  writeFileSync(
    unmatchedOverCfgPath,
    JSON.stringify(
      {
        key: 'occ_unmatched_over',
        seethrough: { resolution: SIDE, steps: 30, seed: 42, offload: false, head_box: [0, 0, SIDE, SIDE] },
        assemble: {
          rig_scale: 1,
          occluders: [{ image: 'occluder.png', sha256: occInputs.occluderSha, under: ['legwear'], over: ['objects', 'ghost_over'], rgb_within: 20 }],
          take: [{ run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['objects'] }],
        },
      },
      null,
      2,
    ),
  );
  const unmatchedCli = spawnSync(
    process.execPath,
    ['cli.ts', 'assemble', '--source', occInputs.painting, '--full', occInputs.plateRunDir, '--head', occInputs.plateRunDir, '--config', unmatchedOverCfgPath, '--propose-plan'],
    { encoding: 'utf8' },
  );
  const unmatchedProposal = unmatchedCli.status === 0 ? (JSON.parse(unmatchedCli.stdout) as PlanProposal) : null;
  const unmatchedNotes = unmatchedProposal?.notes.filter((n) => n.includes('matched no proposed row')) ?? [];
  const unmatchedOrder = unmatchedProposal?.plan.map((r) => `${r[0]}:${r[1]}`) ?? [];
  say(
    'OCCLUDER_UNMATCHED_OVER_EMITS_ONE_NAMED_NOTE',
    unmatchedCli.status === 0 &&
      unmatchedNotes.length === 1 &&
      unmatchedNotes[0] === 'occluders[0].over "ghost_over" matched no proposed row' &&
      unmatchedOrder.join(',') === 'legwear:full,objects:full,face:head,eyewhite_r:head,eyewhite_l:head',
    `exit=${unmatchedCli.status}; notes=${JSON.stringify(unmatchedNotes)}; order=[${unmatchedOrder.join(', ')}]`,
  );
}
