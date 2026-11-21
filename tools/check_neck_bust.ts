import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clothRecipe } from '../fixtures/cloth.ts';
import { writeNeckDraftFixture } from '../fixtures/neck_draft.ts';
import { BUST_LANDMARKS_PROVENANCE_SUFFIX } from '../src/bustlandmarks.ts';
import { assembleStage } from '../src/build.ts';
import { checkProposal, DEFAULT_GRID_RULE, PROPOSAL_CONFIG_SECTIONS, proposeWithBasis, readBustLandmarks, readPartSet } from '../src/propose.ts';
import { readConfigWriteTarget, stageConfigWrite } from './configwrite.ts';
import { proposeNeck } from './neck-propose.ts';

type Json = Record<string, unknown>;

/**
 * Issue #1436: the chest-only write on a sampled body-turn neck config. The fixture is the neck-draft blocks with the
 * topwear raised to cover the drafted chest bone (64x64 rig, chest at [32, 28]), drafted the way such a config is made:
 * `propose --write-config --no-bust` before `turn.body`, `turn.body` by hand, then the neck draft. The chest act rows
 * are written here by hand (apex_r [20, 46], apex_l [44, 46], cleavage [32, 47]); every expected value is from them.
 */
export function runNeckBustChecks(dir: string, say: (name: string, pass: boolean, detail: string) => void): void {
  const cliPath = join(import.meta.dir, '../cli.ts');
  const cli = (...args: string[]) => spawnSync(process.execPath, [cliPath, ...args], { cwd: dir, encoding: 'utf8' });
  const read = (p: string): string => existsSync(p) ? readFileSync(p, 'utf8') : '';
  const json = (p: string): Json => JSON.parse(readFileSync(p, 'utf8')) as Json;
  const write = (p: string, value: unknown): string => { writeFileSync(p, JSON.stringify(value, null, 2) + '\n'); return p; };
  const copy = (from: string, to: string): string => { writeFileSync(to, readFileSync(from)); return to; };
  const first = (r: { stdout: string }): string => r.stdout.split('\n')[0];

  // The chest-carrier fixture and the parts assembled from its authored config.
  const files = writeNeckDraftFixture(join(dir, 'fixture'), true, true);
  const assembleTo = (config: string, out: string, from: { source: string; fullDir: string; headDir: string } = files): string => {
    assembleStage({ source: from.source, full: from.fullDir, head: from.headDir, config, seam: 'near-white', project: 'core' },
      { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite.png'), errorMap: join(out, 'error.png') }, () => {});
    return out;
  };
  const oldParts = assembleTo(files.configPath, join(dir, 'old'));
  const authored = json(files.configPath) as { turn: { body: unknown } };
  const work = join(dir, 'chain');
  mkdirSync(work, { recursive: true });
  const config = join(work, 'config.json');
  const { body, ...turnWithoutBody } = authored.turn as Json;
  write(config, { ...authored, turn: turnWithoutBody });
  const firstDraft = cli('propose', '--parts', oldParts, '--source', files.source, '--out', join(work, 'first'), '--write-config', config, '--no-bust', 'first draft: points not placed yet');
  const withBody = json(config);
  (withBody.turn as Json).body = body;
  write(config, withBody);
  const preNeck = read(config);
  const neckRun = cli('propose', '--parts', oldParts, '--source', files.source, '--full', files.fullDir, '--head', files.headDir, '--out', join(work, 'neck'), '--write-config', config);
  const neckParts = join(work, 'neck', 'rig');
  const drafted = read(config);
  if (firstDraft.status !== 0 || neckRun.status !== 0) throw new Error(`neck-bust fixture: first draft exit ${firstDraft.status}, neck draft exit ${neckRun.status}: ${first(firstDraft)} ${first(neckRun)}`);

  // The act, by hand, with its row digest computed by an inline copy of the rule (never the function under test).
  const digest = (edit: unknown): string => {
    const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted)
      : typeof v === 'object' && v !== null ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as Json)[k])])) : v;
    return createHash('sha256').update(JSON.stringify(sorted(edit))).digest('hex');
  };
  const act = (bust: Json): Json => {
    const edit = { slot: 'shirt', skin: 'default', attachment: 'shirt', basis: 'setup', source: { hash: 'a'.repeat(64), frame: { width: 64, height: 64 } }, bust };
    return { schema: 'rig-review/act@9', actId: 'act-1436', jobId: 'job-1', askId: 'ask-1', publicationId: 'pub-1', kind: 'review-verdict', value: { stage: 'rig-review', verdict: 'changes-requested', comments: [], chestLandmarks: [{ edit, sha256: digest(edit) }] } };
  };
  const points = { apex_r: [20, 46], apex_l: [44, 46], cleavage: [32, 47] };
  const shapeAct = write(join(work, 'act-shape.json'), act({ ...points, alpha: 0.3 }));
  const landmarks = join(work, 'landmarks.json');
  const record = landmarks + BUST_LANDMARKS_PROVENANCE_SUFFIX;
  const commandOne = cli('bust-landmarks', '--from-act', shapeAct, '--parts', neckParts, '--config', config, '--out', landmarks, '--write-config');
  const pendingRecord = read(record);

  // The consumer's second command exactly: no --full, no --head.
  const commandTwo = (cfg: string, out: string, ...chest: string[]) => cli('propose', '--parts', neckParts, '--source', files.source, '--out', join(work, out), '--write-config', cfg, ...chest);
  const appliedBust = '{"apex_r":[20,46],"apex_l":[44,46],"cleavage":[32,47],"alpha":0.3}';
  const boobs = '[{"name":"boob_r","parent":"chest","at":[20,46]},{"name":"boob_l","parent":"chest","at":[44,46]}]';
  // Every entry but the bones list's two bust bones and the carrier's contour.bust, as JSON text.
  const rest = (text: string): string => {
    const c = JSON.parse(text) as Json & { bones: Json[]; meshes: Record<string, { contour?: Json }> };
    const meshes = structuredClone(c.meshes);
    if (meshes.shirt?.contour !== undefined) delete meshes.shirt.contour.bust;
    return JSON.stringify({ ...c, bones: c.bones.filter(b => b.name !== 'boob_r' && b.name !== 'boob_l'), meshes });
  };
  const bustBones = (text: string): string => JSON.stringify((JSON.parse(text) as { bones: Json[] }).bones.filter(b => b.name === 'boob_r' || b.name === 'boob_l'));
  const bustOf = (text: string): string => JSON.stringify((JSON.parse(text) as { meshes: Record<string, { contour?: { bust?: unknown } }> }).meshes.shirt.contour?.bust ?? null);
  const nextLine = `wrote ${landmarks} and ${record}; next, to apply it: rig-parts propose … --write-config ${config} --bust-landmarks ${landmarks}`;
  const two = commandTwo(config, 'p1', '--bust-landmarks', landmarks);
  const after = read(config);
  const chestLine = 'propose: chest-only write on the sampled body-turn neck config: meshes.shirt.contour.bust apex_r [20,46] apex_l [44,46] cleavage [32,47] (from the landmarks file); bones boob_r, boob_l under chest at the apices; every other entry as read';
  const draftedBones = (JSON.parse(drafted) as { bones: unknown[] }).bones;
  const afterBones = (JSON.parse(after) as { bones: unknown[] }).bones;
  say('NBL01_THE_TWO_COMMAND_CHAIN_WRITES_THE_CHEST_ALONE_AND_MARKS_THE_RECORD_APPLIED',
    commandOne.status === 0 && commandOne.stdout.includes(`${nextLine}\n`) && !nextLine.includes('--full') && !nextLine.includes('--head') && pendingRecord.includes('"status": "pending"') &&
      two.status === 0 && bustOf(after) === appliedBust && bustBones(after) === boobs && rest(after) === rest(drafted) &&
      JSON.stringify(afterBones.slice(0, draftedBones.length)) === JSON.stringify(draftedBones) &&
      read(record) === pendingRecord.replace('"status": "pending"', '"status": "applied"') && two.stdout.includes(`${chestLine}\n`),
    `bust-landmarks exit ${commandOne.status}; propose exit ${two.status}${two.status === 0 ? '' : `: ${first(two)}`}; contour.bust ${bustOf(after)}; bust bones ${bustBones(after)}; every other entry ${rest(after) === rest(drafted) ? 'identical to the neck draft' : 'MOVED'}; record ${read(record).includes('"status": "applied"') ? 'applied' : 'not applied'}`);

  const again = commandTwo(config, 'p2', '--bust-landmarks', landmarks);
  say('NBL02_AGAIN_CHANGES_NOTHING',
    again.status === 0 && read(config) === after && again.stderr.includes(`config ${config}: unchanged`),
    `exit ${again.status}; config byte-identical ${read(config) === after}; stderr ${JSON.stringify(again.stderr.trim())}`);

  const hand = write(join(work, 'hand.json'), points);
  const pointsOnly = commandTwo(config, 'p3', '--bust-landmarks', hand);
  say('NBL03_A_POINTS_ONLY_FILE_KEEPS_THE_DECLARED_SHAPE',
    pointsOnly.status === 0 && read(config) === after,
    `exit ${pointsOnly.status}; contour.bust ${bustOf(read(config))}`);

  const plain = join(work, 'plain.json');
  writeFileSync(plain, drafted);
  const noneToRemove = commandTwo(plain, 'p4', '--no-bust', 'rigid breastplate');
  say('NBL04_NO_BUST_WITH_NO_BUST_KEEPS_THE_BYTES',
    noneToRemove.status === 0 && read(plain) === drafted && noneToRemove.stderr.includes(`config ${plain}: unchanged`),
    `exit ${noneToRemove.status}${noneToRemove.status === 0 ? '' : `: ${first(noneToRemove)}`}; config byte-identical to the neck draft ${read(plain) === drafted}`);

  const removing = join(work, 'removing.json');
  writeFileSync(removing, after);
  const removed = commandTwo(removing, 'p5', '--no-bust', 'rigid breastplate');
  say('NBL05_NO_BUST_REMOVES_THE_BUST_AND_ITS_BONES',
    removed.status === 0 && read(removing) === drafted && removed.stdout.includes('propose: chest-only write on the sampled body-turn neck config: meshes.shirt.contour.bust and bones boob_r, boob_l removed where present (--no-bust: rigid breastplate); every other entry as read\n'),
    `exit ${removed.status}; config ${read(removing) === drafted ? 'back to the neck draft byte for byte' : 'differs from the neck draft'}`);

  // A sampled-neck config with no chest carrier: the neck-draft fixture as it stands, its topwear below the chest.
  const bare = writeNeckDraftFixture(join(dir, 'bare'), true, false);
  const bareParts = assembleTo(bare.configPath, join(dir, 'bare-old'), bare);
  const bareBefore = read(bare.configPath);
  const refusedOn = (cfg: string, parts: string, source: string, out: string, ...more: string[]) => {
    const r = cli('propose', '--parts', parts, '--source', source, '--out', join(work, out), '--write-config', cfg, ...more);
    return { r, wrote: existsSync(join(work, out)) };
  };
  const noCarrier = refusedOn(bare.configPath, bareParts, bare.source, 'p6', '--bust-landmarks', hand);
  const noCarrierNoBust = refusedOn(bare.configPath, bareParts, bare.source, 'p6b', '--no-bust', 'none');
  say('NBL06_NO_CHEST_CARRIER_IS_REFUSED_AS_THE_ORDINARY_ROUTE_WORDS_IT',
    noCarrier.r.status === 1 && first(noCarrier.r).startsWith('  FAIL  PROPOSE_BUST_INPUT: chest carrier — no topwear art covers chest at [32.0, 28.2]. A chest-holding topwear part is required for the declared bust input') &&
      noCarrierNoBust.r.status === 1 && first(noCarrierNoBust.r).startsWith('  FAIL  PROPOSE_BUST_INPUT: chest carrier — no topwear art covers chest at [32, 28]. A chest-holding topwear part is required for the declared bust input') &&
      read(bare.configPath) === bareBefore && !noCarrier.wrote && !noCarrierNoBust.wrote,
    `${first(noCarrier.r).trim()} | ${first(noCarrierNoBust.r).trim()}; config ${read(bare.configPath) === bareBefore ? 'unchanged' : 'CHANGED'}`);

  // The authored config: its chest carrier is a grid mesh, never drafted as a contour.
  const gridConfig = copy(files.configPath, join(work, 'grid.json'));
  const gridBefore = read(gridConfig);
  const grid = refusedOn(gridConfig, oldParts, files.source, 'p7', '--bust-landmarks', hand);
  say('NBL07_A_CARRIER_THAT_IS_NOT_A_CONTOUR_IS_REFUSED_WITH_THE_ORDER_THAT_MAKES_ONE',
    grid.r.status === 1 && first(grid.r).startsWith('  FAIL  PROPOSE_BUST_CARRIER_MESH: config.meshes.shirt — is a grid mesh; the chest-only write on a sampled body-turn neck config sets contour.bust on the chest carrier\'s contour mesh, which it does not draft. Produce one in this order: rig-parts propose … --write-config <config> --no-bust "<reason>" before turn.body is written, then write turn.body and draft the neck') &&
      read(gridConfig) === gridBefore && !grid.wrote,
    `${first(grid.r).trim()}; config ${read(gridConfig) === gridBefore ? 'unchanged' : 'CHANGED'}`);

  const both = join(work, 'both.json');
  writeFileSync(both, drafted);
  const withRuns = refusedOn(both, neckParts, files.source, 'p8', '--full', files.fullDir, '--head', files.headDir, '--bust-landmarks', hand);
  say('NBL08_THE_RUNS_WITH_CHEST_FLAGS_ARE_REFUSED_NAMING_THE_CHEST_ONLY_COMMAND',
    withRuns.r.status === 1 && first(withRuns.r).startsWith(`  FAIL  PROPOSE_NECK_MODE: --bust-landmarks, --full, --head — the neck draft (--full, --head) and the chest-only write (--bust-landmarks) are separate runs on a sampled body-turn neck config; write the chest with rig-parts propose --parts <dir> --source <painting.png> --out <dir> --write-config ${both} --bust-landmarks <landmarks.json>, without --full and --head, and draft the neck in its own run`) &&
      read(both) === drafted && !withRuns.wrote,
    `${first(withRuns.r).trim()}; config ${read(both) === drafted ? 'unchanged' : 'CHANGED'}`);

  // No cleavage in the file: derived from the config's own neck [32, 32] -> hip midline, not the draft's. With the hip
  // moved by hand to [34, 24], the midline meets y = 46 at x = 32 + 2 * (46 - 32) / -8 = 28.5; the draft's (neck
  // [32, 31] -> hip [32, 24]) would give x = 32.
  const tilted = (hip: number[], name: string): string => {
    const c = JSON.parse(drafted) as { bones: Json[] };
    c.bones.find(b => b.name === 'hip')!.at = hip;
    return write(join(work, name), c);
  };
  const noCleavage = write(join(work, 'no-cleavage.json'), { apex_r: [20, 46], apex_l: [44, 46] });
  const derivedConfig = tilted([34, 24], 'derived.json');
  const derived = commandTwo(derivedConfig, 'p9', '--bust-landmarks', noCleavage);
  const source = "derived at the apex segment crossing of the config's neck [32, 32] -> hip [34, 24] midline";
  const derivedNote = read(join(work, 'p9', 'proposal.json')).includes(`shirt: contour.bust from declared apex_r/apex_l. Cleavage ${source}. Bones boob_r/boob_l are parented to chest`);
  const crossless = tilted([24, 24], 'crossless.json');
  const crosslessBefore = read(crossless);
  const noCross = refusedOn(crossless, neckParts, files.source, 'p9b', '--bust-landmarks', noCleavage);
  say('NBL09_A_MISSING_CLEAVAGE_IS_DERIVED_FROM_THE_CONFIG_MIDLINE_AND_SAYS_SO',
    derived.status === 0 && bustOf(read(derivedConfig)) === '{"apex_r":[20,46],"apex_l":[44,46],"cleavage":[28.5,46]}' &&
      derived.stdout.includes(`cleavage [28.5,46] (${source})`) && derivedNote &&
      noCross.r.status === 1 && first(noCross.r).startsWith('  FAIL  PROPOSE_BUST_INPUT: landmarks.cleavage — the neck-to-hip midline [32.0, 32.0] -> [24.0, 24.0] has no unique crossing inside apex_r [20.0, 46.0] -> apex_l [44.0, 46.0]') &&
      read(crossless) === crosslessBefore && !noCross.wrote,
    `exit ${derived.status}${derived.status === 0 ? '' : `: ${first(derived)}`}; contour.bust ${bustOf(read(derivedConfig))}; proposal note ${derivedNote ? 'names the source' : 'missing'}; no crossing: ${first(noCross.r).trim()}`);

  const elsewhere = join(work, 'elsewhere.json');
  writeFileSync(elsewhere, readFileSync(landmarks));
  writeFileSync(elsewhere + BUST_LANDMARKS_PROVENANCE_SUFFIX, pendingRecord.replace('"slot": "shirt"', '"slot": "throat"'));
  const drift = join(work, 'drift.json');
  writeFileSync(drift, read(landmarks).replace('20', '21'));
  writeFileSync(drift + BUST_LANDMARKS_PROVENANCE_SUFFIX, pendingRecord);
  const recordConfig = join(work, 'record.json');
  writeFileSync(recordConfig, drafted);
  const otherPart = refusedOn(recordConfig, neckParts, files.source, 'p10', '--bust-landmarks', elsewhere);
  const drifted = refusedOn(recordConfig, neckParts, files.source, 'p10b', '--bust-landmarks', drift);
  say('NBL10_THE_RECORD_IS_CHECKED_AS_ON_THE_ORDINARY_ROUTE',
    otherPart.r.status === 1 && first(otherPart.r).startsWith(`  FAIL  PROPOSE_BUST_SIDECAR_PART: ${elsewhere + BUST_LANDMARKS_PROVENANCE_SUFFIX} slot — is "throat"; the chest carrier this draft makes ("shirt") is required`) &&
      drifted.r.status === 1 && first(drifted.r).startsWith(`  FAIL  PROPOSE_BUST_SIDECAR_DIGEST: ${drift + BUST_LANDMARKS_PROVENANCE_SUFFIX} landmarks_sha256`) &&
      read(recordConfig) === drafted && !otherPart.wrote && !drifted.wrote,
    `${first(otherPart.r).trim().slice(0, 120)} | ${first(drifted.r).trim().slice(0, 100)}`);

  // Without turn.body the ordinary route runs: the CLI's write is the ordinary proposal's, staged by direct call.
  const ordinary = (parts: string, cfg: string, bust: Parameters<typeof proposeWithBasis>[6]): void => {
    const P = readPartSet(parts);
    const prop = proposeWithBasis(P, undefined, null, DEFAULT_GRID_RULE, null, true, bust).proposal;
    checkProposal(P, prop);
    stageConfigWrite(readConfigWriteTarget(cfg), { kind: 'proposal', proposal: prop, sections: PROPOSAL_CONFIG_SECTIONS }).commit();
  };
  const unbodied = (text: string, name: string): string => {
    const c = JSON.parse(text) as { turn: Json };
    delete c.turn.body;
    return write(join(work, name), c);
  };
  const viaCli = unbodied(drafted, 'ordinary-cli.json'), direct = unbodied(drafted, 'ordinary-direct.json');
  const ordinaryRun = cli('propose', '--parts', neckParts, '--source', files.source, '--out', join(work, 'p11'), '--write-config', viaCli, '--bust-landmarks', hand);
  ordinary(neckParts, direct, { landmarks: readBustLandmarks(points) });
  const bareCli = unbodied(bareBefore, 'bare-cli.json'), bareDirect = unbodied(bareBefore, 'bare-direct.json');
  const bareRun = cli('propose', '--parts', bareParts, '--source', bare.source, '--out', join(work, 'p11b'), '--write-config', bareCli);
  ordinary(bareParts, bareDirect, {});
  say('NBL11_WITHOUT_TURN_BODY_THE_ORDINARY_ROUTE_WRITES_ITS_OWN_BYTES',
    ordinaryRun.status === 0 && read(viaCli) === read(direct) && read(viaCli).includes('"boob_r"') && bareRun.status === 0 && read(bareCli) === read(bareDirect) && read(bareCli) !== JSON.stringify(JSON.parse(bareBefore), null, 2) + '\n',
    `with --bust-landmarks: exit ${ordinaryRun.status}, byte-identical to the direct proposal write ${read(viaCli) === read(direct)}; without chest flags: exit ${bareRun.status}, byte-identical ${read(bareCli) === read(bareDirect)}`);

  // The neck route without chest flags: the CLI's write is proposeNeck's, called directly on the same config.
  const neckCli = join(work, 'neck-cli.json'), neckDirect = join(work, 'neck-direct.json');
  writeFileSync(neckCli, preNeck);
  writeFileSync(neckDirect, preNeck);
  const neckAgain = cli('propose', '--parts', oldParts, '--source', files.source, '--full', files.fullDir, '--head', files.headDir, '--out', join(work, 'p12'), '--write-config', neckCli);
  proposeNeck(readConfigWriteTarget(neckDirect), { source: files.source, full: files.fullDir, head: files.headDir, parts: oldParts, out: join(work, 'p12-direct') });
  say('NBL12_THE_NECK_ROUTE_WITHOUT_CHEST_FLAGS_WRITES_ITS_OWN_BYTES',
    neckAgain.status === 0 && read(neckCli) === read(neckDirect) && read(neckCli) === drafted &&
      read(join(work, 'p12', 'rig', 'parts.json')) === read(join(work, 'p12-direct', 'rig', 'parts.json')),
    `exit ${neckAgain.status}; config byte-identical to proposeNeck's ${read(neckCli) === read(neckDirect)} and to the chain's neck draft ${read(neckCli) === drafted}`);

  // The other modes of propose against the chest flags and a pending record (issue #1436's mode table).
  const pendingPair = (name: string): string => {
    const o = join(work, `${name}.json`);
    writeFileSync(o, readFileSync(landmarks));
    writeFileSync(o + BUST_LANDMARKS_PROVENANCE_SUFFIX, pendingRecord);
    return o;
  };
  const onlyMissingNeck = join(work, 'only-missing-neck.json');
  writeFileSync(onlyMissingNeck, drafted);
  const omNeck = refusedOn(onlyMissingNeck, neckParts, files.source, 'p13', '--bust-landmarks', pendingPair('om-neck'), '--only-missing');
  const omPlain = unbodied(drafted, 'only-missing-plain.json');
  const omPlainBefore = read(omPlain);
  const omOrdinary = refusedOn(omPlain, neckParts, files.source, 'p13b', '--bust-landmarks', pendingPair('om-plain'), '--only-missing');
  say('NBL13_ONLY_MISSING_WITH_A_PENDING_RECORD_IS_REFUSED_ON_EITHER_ROUTE',
    omNeck.r.status === 1 && first(omNeck.r).startsWith('  FAIL  PROPOSE_NECK_MODE: --only-missing — cannot replace an attached neck') && read(onlyMissingNeck) === drafted &&
      omOrdinary.r.status === 1 && first(omOrdinary.r).startsWith('  FAIL  PROPOSE_BUST_PENDING: --only-missing') && read(omPlain) === omPlainBefore && !omNeck.wrote && !omOrdinary.wrote,
    `${first(omNeck.r).trim().slice(0, 90)} | ${first(omOrdinary.r).trim().slice(0, 90)}`);

  const recipeFile = write(join(work, 'cloth.json'), { key: 'cloth', cloth: clothRecipe() });
  const clothOut = join(work, 'cloth-written.json');
  const cloth = cli('propose', '--parts', neckParts, '--source', files.source, '--out', join(work, 'p14'), '--cloth', recipeFile, '--write-config', clothOut, '--bust-landmarks', pendingPair('cloth-landmarks'));
  say('NBL14_CLOTH_WITH_A_PENDING_RECORD_IS_REFUSED',
    cloth.status === 1 && first(cloth).startsWith('  FAIL  PROPOSE_BUST_PENDING: --cloth') && !existsSync(clothOut) && !existsSync(join(work, 'p14')),
    first(cloth).trim().slice(0, 120));

  const headBox = cli('propose', '--head-box', '--full', files.fullDir, '--canvas', '64x64', '--write-config', config, '--bust-landmarks', landmarks);
  const fromConfig = cli('propose', '--parts', neckParts, '--source', files.source, '--out', join(work, 'p15'), '--from-config', config, '--no-bust', 'none');
  say('NBL15_HEAD_BOX_AND_FROM_CONFIG_REFUSE_THE_CHEST_FLAGS',
    headBox.status === 2 && first(headBox).startsWith('  FAIL  USAGE: --head-box takes --full, --canvas and optional --write-config only; got --bust-landmarks') &&
      fromConfig.status === 2 && first(fromConfig).startsWith('  FAIL  USAGE: --bust-landmarks and --no-bust draft a torso. --from-config reads authored meshes') && read(config) === after,
    `${first(headBox).trim().slice(0, 100)} | ${first(fromConfig).trim().slice(0, 100)}`);

  const lost = cli('propose', '--parts', neckParts, '--source', files.source, '--out', join(work, 'p16'), '--bust-landmarks', pendingPair('lost'));
  say('NBL16_A_PENDING_RECORD_WITHOUT_WRITE_CONFIG_ON_A_NECK_CONFIG_IS_REFUSED',
    lost.status === 1 && first(lost).startsWith('  FAIL  PROPOSE_BUST_PENDING: --bust-landmarks') && !existsSync(join(work, 'p16', 'proposal.json')),
    first(lost).trim().slice(0, 120));
}
