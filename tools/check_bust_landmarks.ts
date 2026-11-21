import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROPOSE_PARTS, type ProposeFixturePart, writeProposeFixture } from '../fixtures/propose.ts';
import { BUST_LANDMARKS_PROVENANCE_SUFFIX, bustLandmarksFromAct } from '../src/bustlandmarks.ts';
import { PartsError } from '../src/errors.ts';
import { propose, readBustLandmarks, readPartSet } from '../src/propose.ts';

/**
 * Issue #1382: `rig-parts bust-landmarks` on a synthetic act built here by hand, over the propose fixture with one
 * chest-holding topwear part (`bodice`, 50,100 100x45 on the 200x300 rig). The flow is the one AUTHORING §3 gives:
 * a first draft with `--no-bust`, the person's points in a chest-landmarks act, the landmarks file written from it,
 * and the redraft through `propose --bust-landmarks`. Every expected value is written below from the fixture.
 */
export function runBustLandmarkChecks(dir: string, say: (name: string, pass: boolean, detail: string) => void): void {
  const cliPath = join(import.meta.dir, '../cli.ts');
  const cli = (...args: string[]) => spawnSync(process.execPath, [cliPath, ...args], { cwd: dir, encoding: 'utf8' });
  const partsDir = join(dir, 'parts-dir');
  const bodice: ProposeFixturePart = { name: 'bodice', from: 'full:topwear', x: 50, y: 100, w: 100, h: 45, colour: [60, 80, 100] };
  const fixtureParts = [...PROPOSE_PARTS, bodice];
  const painting = writeProposeFixture(partsDir, fixtureParts);
  const draft = propose(readPartSet(partsDir), undefined, null, undefined, null, true, { noBust: 'first draft: points not placed yet' });
  const configOf = (bust?: Record<string, unknown>): Record<string, unknown> => {
    const meshes = JSON.parse(JSON.stringify(draft.meshes)) as Record<string, { contour?: Record<string, unknown> }>;
    if (bust !== undefined && meshes.bodice.contour !== undefined) meshes.bodice.contour.bust = bust;
    return {
      key: 'fixture',
      assemble: { rig_scale: 1, plan: fixtureParts.map((p) => [p.name, ...p.from.split(':')]) },
      bones: bust === undefined ? draft.bones : [...draft.bones, { name: 'boob_r', parent: 'chest', at: [75.5, 125] }, { name: 'boob_l', parent: 'chest', at: [125.25, 125] }],
      meshes,
      regions: draft.regions,
      motion: draft.motion,
    };
  };
  const writeJson = (name: string, value: unknown): string => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
    return path;
  };
  // The first draft's config: the chest carrier is a contour with no contour.bust (made with --no-bust).
  const noBustConfig = writeJson('config-no-bust.json', configOf());
  // A config that already declares a bust with a non-default alpha.
  const bustConfig = writeJson('config-bust.json', configOf({ apex_r: [70, 120], apex_l: [130, 120], cleavage: [100, 121], alpha: 0.3 }));
  const hex = (c: string): string => c.repeat(64);
  const row = (over: Record<string, unknown> = {}, bust: Record<string, unknown> = { apex_r: [75.5, 125], apex_l: [125.25, 125], cleavage: [100, 126.5] }) => ({
    edit: { slot: 'bodice', skin: 'default', attachment: 'bodice', basis: 'setup', source: { hash: hex('a'), frame: { width: 200, height: 300 } }, bust, ...over },
    sha256: hex('c'),
  });
  const act = (rows: unknown[], schema = 'rig-review/act@9') => ({
    schema, actId: 'act-1382', jobId: 'job-1', askId: 'ask-1', publicationId: 'pub-1', kind: 'review-verdict',
    value: { stage: 'rig-review', verdict: 'changes-requested', comments: [], chestLandmarks: rows },
  });
  const actPath = writeJson('act.json', act([row()]));
  const actSha = createHash('sha256').update(readFileSync(actPath)).digest('hex');
  const out = join(dir, 'out', 'landmarks.json');
  mkdirSync(join(dir, 'out'), { recursive: true });
  const args = (a: string, config: string, o: string): string[] => ['bust-landmarks', '--from-act', a, '--parts', partsDir, '--config', config, '--out', o];

  // The file propose --bust-landmarks reads, in its key order, and the record beside it.
  const expectedText = '{\n  "apex_r": [\n    75.5,\n    125\n  ],\n  "apex_l": [\n    125.25,\n    125\n  ],\n  "cleavage": [\n    100,\n    126.5\n  ]\n}\n';
  const landmarksSha = createHash('sha256').update(expectedText).digest('hex');
  const expectedProvenance = JSON.stringify({
    spec: 'rig-parts-bust-landmarks-provenance/1',
    act: { schema: 'rig-review/act@9', act_id: 'act-1382', file_sha256: actSha },
    row_sha256: hex('c'),
    slot: 'bodice',
    source: { hash: hex('a'), frame: { width: 200, height: 300 } },
    landmarks_sha256: landmarksSha,
  }, null, 2) + '\n';
  const first = cli(...args(actPath, noBustConfig, out));
  const text = existsSync(out) ? readFileSync(out, 'utf8') : '';
  const provenanceText = existsSync(out + BUST_LANDMARKS_PROVENANCE_SUFFIX) ? readFileSync(out + BUST_LANDMARKS_PROVENANCE_SUFFIX, 'utf8') : '';
  let read = '';
  try { read = JSON.stringify(readBustLandmarks(JSON.parse(text))); } catch (error) { read = `refused: ${error instanceof Error ? error.message : String(error)}`; }
  say('THE_ACT_ROW_WRITES_THE_FILE_PROPOSE_READS_WITH_ITS_RECORD',
    first.status === 0 && text === expectedText && read === '{"apex_r":[75.5,125],"apex_l":[125.25,125],"cleavage":[100,126.5]}' && provenanceText === expectedProvenance,
    `exit ${first.status}; landmarks ${text === expectedText ? 'exact' : JSON.stringify(text)}; propose's reader -> ${read}; record ${provenanceText === expectedProvenance ? 'exact' : JSON.stringify(provenanceText)}`);

  // propose itself, unchanged, takes the written file and drafts contour.bust from the exact three points.
  const redraft = cli('propose', '--parts', partsDir, '--source', painting, '--out', join(dir, 'redraft'), '--bust-landmarks', out);
  const proposalPath = join(dir, 'redraft', 'proposal.json');
  const drafted = existsSync(proposalPath) ? JSON.stringify((JSON.parse(readFileSync(proposalPath, 'utf8')) as { meshes: { bodice: { contour: { bust?: unknown } } } }).meshes.bodice.contour.bust) : 'no proposal';
  say('PROPOSE_REDRAFTS_THE_CHEST_FROM_THE_WRITTEN_FILE',
    redraft.status === 0 && drafted === '{"apex_r":[75.5,125],"apex_l":[125.25,125],"cleavage":[100,126.5]}',
    `propose --bust-landmarks exit ${redraft.status}; meshes.bodice.contour.bust ${drafted}`);

  // Determinism: a second run, to the same path and to another, writes the same bytes.
  const again = cli(...args(actPath, noBustConfig, out));
  const other = join(dir, 'out', 'again.json');
  const elsewhere = cli(...args(actPath, noBustConfig, other));
  const same = (p: string) => existsSync(p) && readFileSync(p, 'utf8') === expectedText && readFileSync(p + BUST_LANDMARKS_PROVENANCE_SUFFIX, 'utf8') === expectedProvenance;
  say('TWO_RUNS_WRITE_THE_SAME_BYTES', again.status === 0 && elsewhere.status === 0 && same(out) && same(other),
    `rerun exit ${again.status}, other path exit ${elsewhere.status}; both pairs equal the first run's bytes: ${same(out) && same(other)}`);

  // An act whose row has no cleavage: the file has none, and propose derives it.
  const noCleavage = writeJson('act-no-cleavage.json', act([row({}, { apex_r: [75, 125], apex_l: [125, 125] })]));
  const noCleavageOut = join(dir, 'out', 'no-cleavage.json');
  const nc = cli(...args(noCleavage, noBustConfig, noCleavageOut));
  const ncText = existsSync(noCleavageOut) ? readFileSync(noCleavageOut, 'utf8') : '';
  say('A_ROW_WITHOUT_CLEAVAGE_WRITES_NONE', nc.status === 0 && ncText === '{\n  "apex_r": [\n    75,\n    125\n  ],\n  "apex_l": [\n    125,\n    125\n  ]\n}\n',
    `exit ${nc.status}; ${JSON.stringify(ncText)}`);

  // Refusals, each beside the positive control above: the rule, the object, nothing written.
  const refused = (name: string, actValue: unknown, code: string, object: string, config = noBustConfig, outPath?: string): void => {
    const a = typeof actValue === 'string' ? actValue : writeJson(`act-${name}.json`, actValue);
    const o = outPath ?? join(dir, 'out', `${name}.json`);
    let problems: readonly { code: string; object: string; detail: string }[] = [];
    try { bustLandmarksFromAct({ act: a, parts: partsDir, config, out: o }); } catch (error) { if (error instanceof PartsError) problems = error.problems; else throw error; }
    const hit = problems.find(p => p.code === code && p.object === object);
    const wrote = outPath === undefined && (existsSync(o) || existsSync(o + BUST_LANDMARKS_PROVENANCE_SUFFIX));
    say(name, hit !== undefined && !wrote, `${hit === undefined ? `no ${code} on ${object}; got ${problems.map(p => `${p.code}: ${p.object} — ${p.detail}`).join(' | ') || 'no refusal'}` : `${code}: ${hit.object} — ${hit.detail}`}${wrote ? '; an output was written' : ''}`);
  };
  const broken = join(dir, 'act-broken.json');
  writeFileSync(broken, '{"schema": "rig-review/act@9",');
  refused('ACT_NOT_JSON', broken, 'BUST_LANDMARKS_ACT', broken);
  refused('ACT_UNREADABLE', join(dir, 'no-such-act.json'), 'BUST_LANDMARKS_ACT', join(dir, 'no-such-act.json'));
  refused('ACT_OTHER_SCHEMA', act([row()], 'rig-review/act@8'), 'BUST_LANDMARKS_ACT', `${join(dir, 'act-ACT_OTHER_SCHEMA.json')} schema`);
  refused('ACT_NO_CHEST_ROW', act([]), 'BUST_LANDMARKS_ACT', `${join(dir, 'act-ACT_NO_CHEST_ROW.json')} value.chestLandmarks`);
  refused('ROW_POINT_NOT_TWO_NUMBERS', act([row({}, { apex_r: [75, '125'], apex_l: [125, 125] })]), 'BUST_LANDMARKS_ROW', 'value.chestLandmarks[0].edit.bust.apex_r');
  refused('ROW_APEX_MISSING', act([row({}, { apex_r: [75, 125] })]), 'BUST_LANDMARKS_ROW', 'value.chestLandmarks[0].edit.bust.apex_l');
  refused('ROW_BASIS_NOT_SETUP', act([row({ basis: 'posed' })]), 'BUST_LANDMARKS_ROW', 'value.chestLandmarks[0].edit.basis');
  refused('ROW_SHA256_MALFORMED', act([{ ...row(), sha256: 'C'.repeat(64) }]), 'BUST_LANDMARKS_ROW', 'value.chestLandmarks[0].sha256');
  refused('ROW_SOURCE_WITHOUT_FRAME', act([row({ source: { hash: hex('a') } })]), 'BUST_LANDMARKS_ROW', 'value.chestLandmarks[0].edit.source.frame');
  refused('ROW_UNKNOWN_BUST_FIELD', act([row({}, { apex_r: [75, 125], apex_l: [125, 125], radius: 9 })]), 'BUST_LANDMARKS_ROW', 'value.chestLandmarks[0].edit.bust.radius');
  refused('SLOT_UNKNOWN', act([row({ slot: 'cape', attachment: 'cape' })]), 'BUST_LANDMARKS_SLOT', 'value.chestLandmarks[0].edit.slot');
  refused('SLOT_NOT_A_CONTOUR_MESH', act([row({ slot: 'skirt', attachment: 'skirt' })]), 'BUST_LANDMARKS_SLOT', 'value.chestLandmarks[0].edit.slot');
  refused('SLOT_ISLAND_ATTACHMENT', act([row({ attachment: 'bodice_island_1' })]), 'BUST_LANDMARKS_SLOT', 'value.chestLandmarks[0].edit.attachment');
  refused('SLOT_OTHER_SKIN', act([row({ skin: 'alt' })]), 'BUST_LANDMARKS_SLOT', 'value.chestLandmarks[0].edit.skin');
  refused('TWO_ROWS_FOR_ONE_PART', act([row(), row({ skin: 'alt' })]), 'BUST_LANDMARKS_PART_ROWS', 'slot "bodice"');
  refused('ROWS_FOR_TWO_PARTS', act([row(), row({ slot: 'skirt', attachment: 'skirt' })]), 'BUST_LANDMARKS_ROWS', 'value.chestLandmarks');
  refused('FRAME_NOT_RIG_SIZE', act([row({ source: { hash: hex('a'), frame: { width: 200, height: 301 } } })]), 'BUST_LANDMARKS_FRAME', 'value.chestLandmarks[0].edit.source.frame');
  // Shape fields: against the defaults when the config has no contour.bust, against the config's own when it has one.
  refused('SHAPE_ALPHA_AGAINST_THE_DEFAULT', act([row({}, { apex_r: [75, 125], apex_l: [125, 125], alpha: 0.3 })]), 'BUST_LANDMARKS_SHAPE', 'value.chestLandmarks[0].edit.bust.alpha');
  refused('SHAPE_BONE_AGAINST_THE_DEFAULT', act([row({}, { apex_r: [75, 125], apex_l: [125, 125], bone_r: 'chest' })]), 'BUST_LANDMARKS_SHAPE', 'value.chestLandmarks[0].edit.bust.bone_r');
  refused('SHAPE_ABSENT_AGAINST_A_DECLARED_ALPHA', act([row()]), 'BUST_LANDMARKS_SHAPE', 'value.chestLandmarks[0].edit.bust.alpha', bustConfig);
  const accepted = (name: string, actValue: unknown, config: string): void => {
    const a = writeJson(`act-${name}.json`, actValue);
    const o = join(dir, 'out', `${name}.json`);
    let detail = 'accepted';
    try { bustLandmarksFromAct({ act: a, parts: partsDir, config, out: o }); } catch (error) { detail = error instanceof Error ? error.message : String(error); }
    say(name, detail === 'accepted' && existsSync(o), detail);
  };
  accepted('SHAPE_DEFAULTS_SPELLED_OUT_MATCH_A_CONFIG_WITHOUT_BUST',
    act([row({}, { apex_r: [75, 125], apex_l: [125, 125], alpha: 0.22, clearance: 3.8, spacing: 14, bone_r: 'boob_r', bone_l: 'boob_l' })]), noBustConfig);
  accepted('SHAPE_EQUAL_TO_A_DECLARED_ALPHA', act([row({}, { apex_r: [75.5, 125], apex_l: [125.25, 125], cleavage: [100, 126.5], alpha: 0.3 })]), bustConfig);
  refused('OUT_INSIDE_THE_PARTS_DIRECTORY', act([row()]), 'BUST_LANDMARKS_OUT', '--out', noBustConfig, join(partsDir, 'landmarks.json'));
  refused('OUT_OVER_THE_ACT', actPath, 'BUST_LANDMARKS_OUT', '--out', noBustConfig, actPath);
  refused('OUT_OVER_THE_CONFIG', act([row()]), 'BUST_LANDMARKS_OUT', '--out', noBustConfig, noBustConfig);
  // Every problem is collected and thrown once.
  const many = writeJson('act-many.json', act([row({ attachment: 'other', source: { hash: hex('a'), frame: { width: 1, height: 1 } } }, { apex_r: [75, 125], apex_l: [125, 125], spacing: 7 })]));
  let codes: string[] = [];
  try { bustLandmarksFromAct({ act: many, parts: partsDir, config: noBustConfig, out: join(dir, 'out', 'many.json') }); } catch (error) { if (error instanceof PartsError) codes = error.problems.map(p => p.code); }
  say('EVERY_PROBLEM_IN_ONE_REFUSAL', codes.join(',') === 'BUST_LANDMARKS_FRAME,BUST_LANDMARKS_SLOT,BUST_LANDMARKS_SHAPE', codes.join(',') || 'no refusal');
  const actBefore = readFileSync(actPath, 'utf8'), configBefore = readFileSync(noBustConfig, 'utf8');
  say('INPUTS_KEEP_THEIR_BYTES', actBefore === JSON.stringify(act([row()]), null, 2) + '\n' && configBefore === JSON.stringify(configOf(), null, 2) + '\n',
    'the act and the config read back as written after every run above');

  // The command line: in the usage, its own --help, unknown flags through TAKES, a refusal's exit code.
  const help = cli('--help');
  const own = cli('bust-landmarks', '--help');
  const unknown = cli('bust-landmarks', '--not-a-flag', 'x');
  const missing = cli('bust-landmarks', '--from-act', actPath);
  const cliRefusal = cli(...args(writeJson('act-cli-refusal.json', act([row({ slot: 'cape', attachment: 'cape' })])), noBustConfig, join(dir, 'out', 'cli-refusal.json')));
  const line = 'rig-parts bust-landmarks --from-act <act.json> --parts <dir> --config <config.json> --out <landmarks.json>';
  say('THE_COMMAND_LINE_IS_IN_THE_USAGE_AND_ITS_OWN_HELP', help.status === 0 && help.stdout.includes(`  ${line}\n`) && own.status === 0 && own.stdout.startsWith(`  ${line}\n`),
    `--help exit ${help.status}, bust-landmarks --help exit ${own.status}; the line ${help.stdout.includes(line) ? 'is' : 'is not'} in the usage`);
  say('UNKNOWN_AND_MISSING_FLAGS_ARE_USAGE_ERRORS',
    unknown.status === 2 && unknown.stdout.includes('FAIL  USAGE: bust-landmarks does not take "--not-a-flag"; it takes --from-act, --parts, --config, --out (see rig-parts guide USAGE)') &&
      missing.status === 2 && missing.stdout.includes('bust-landmarks needs --parts <value>'),
    `unknown exit ${unknown.status}: ${unknown.stdout.split('\n')[0].trim()}; missing exit ${missing.status}: ${missing.stdout.split('\n')[0].trim()}`);
  say('A_REFUSAL_EXITS_1_WITH_A_GUIDE_POINTER_AND_WRITES_NOTHING',
    cliRefusal.status === 1 && cliRefusal.stdout.includes('  FAIL  BUST_LANDMARKS_SLOT: value.chestLandmarks[0].edit.slot — ') && cliRefusal.stdout.includes('(see rig-parts guide BUST_LANDMARKS_SLOT)') &&
      !existsSync(join(dir, 'out', 'cli-refusal.json')),
    `exit ${cliRefusal.status}: ${cliRefusal.stdout.split('\n')[0].trim()}`);
}
