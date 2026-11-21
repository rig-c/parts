import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROPOSE_PARTS, type ProposeFixturePart, writeProposeFixture } from '../fixtures/propose.ts';
import { BUST_LANDMARKS_PROVENANCE_SUFFIX, bustLandmarksFromAct, planBustLandmarks, stageBustLandmarks } from '../src/bustlandmarks.ts';
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
  // The row digest, computed here by its own inline copy of the rule (never the function under test): sha256 of
  // JSON.stringify of the edit with object keys sorted recursively and array order kept.
  const digest = (edit: unknown): string => {
    const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted)
      : typeof v === 'object' && v !== null ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as Record<string, unknown>)[k])])) : v;
    return createHash('sha256').update(JSON.stringify(sorted(edit))).digest('hex');
  };
  const row = (over: Record<string, unknown> = {}, bust: Record<string, unknown> = { apex_r: [75.5, 125], apex_l: [125.25, 125], cleavage: [100, 126.5] }) => {
    const edit = { slot: 'bodice', skin: 'default', attachment: 'bodice', basis: 'setup', source: { hash: hex('a'), frame: { width: 200, height: 300 } }, bust, ...over };
    return { edit, sha256: digest(edit) };
  };
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
    row_sha256: row().sha256,
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
  // Round 3: with no contour.bust, a shape that differs from the defaults is left pending in the record, not refused.
  const pendingIn = (name: string, actValue: unknown, fields: Record<string, unknown>): void => {
    const o = join(dir, 'out', `${name}.json`);
    let detail = '';
    try {
      const plan = bustLandmarksFromAct({ act: writeJson(`act-${name}.json`, actValue), parts: partsDir, config: noBustConfig, out: o });
      detail = JSON.stringify(plan.provenance.shape);
    } catch (error) { detail = `refused: ${error instanceof Error ? error.message : String(error)}`; }
    say(name, detail === JSON.stringify({ status: 'pending', fields }) && existsSync(o), `shape ${detail}`);
  };
  pendingIn('A_TUNED_ALPHA_WITHOUT_CONTOUR_BUST_IS_PENDING', act([row({}, { apex_r: [75, 125], apex_l: [125, 125], alpha: 0.3 })]), { alpha: 0.3 });
  pendingIn('A_TUNED_BONE_WITHOUT_CONTOUR_BUST_IS_PENDING', act([row({}, { apex_r: [75, 125], apex_l: [125, 125], bone_r: 'chest' })]), { bone_r: 'chest' });
  // Issue #1443: the shape refusals hold for an act at the config's own points; moved points leave the shape pending.
  const declaredPoints = { apex_r: [70, 120], apex_l: [130, 120], cleavage: [100, 121] };
  refused('SHAPE_ABSENT_AGAINST_A_DECLARED_ALPHA', act([row({}, declaredPoints)]), 'BUST_LANDMARKS_SHAPE', 'value.chestLandmarks[0].edit.bust.alpha', bustConfig);
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
  const many = writeJson('act-many.json', act([row({ attachment: 'other', source: { hash: hex('a'), frame: { width: 1, height: 1 } } }, { ...declaredPoints, alpha: 0.3, spacing: 7 })]));
  let codes: string[] = [];
  try { bustLandmarksFromAct({ act: many, parts: partsDir, config: bustConfig, out: join(dir, 'out', 'many.json') }); } catch (error) { if (error instanceof PartsError) codes = error.problems.map(p => p.code); }
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
  const line = 'rig-parts bust-landmarks --from-act <act.json> --parts <dir> --config <config.json> --out <landmarks.json> [--write-config]';
  say('THE_COMMAND_LINE_IS_IN_THE_USAGE_AND_ITS_OWN_HELP', help.status === 0 && help.stdout.includes(`  ${line}\n`) && own.status === 0 && own.stdout.startsWith(`  ${line}\n`),
    `--help exit ${help.status}, bust-landmarks --help exit ${own.status}; the line ${help.stdout.includes(line) ? 'is' : 'is not'} in the usage`);
  say('UNKNOWN_AND_MISSING_FLAGS_ARE_USAGE_ERRORS',
    unknown.status === 2 && unknown.stdout.includes('FAIL  USAGE: bust-landmarks does not take "--not-a-flag"; it takes --from-act, --parts, --config, --out, --write-config (see rig-parts guide USAGE)') &&
      missing.status === 2 && missing.stdout.includes('bust-landmarks needs --parts <value>'),
    `unknown exit ${unknown.status}: ${unknown.stdout.split('\n')[0].trim()}; missing exit ${missing.status}: ${missing.stdout.split('\n')[0].trim()}`);
  say('A_REFUSAL_EXITS_1_WITH_A_GUIDE_POINTER_AND_WRITES_NOTHING',
    cliRefusal.status === 1 && cliRefusal.stdout.includes('  FAIL  BUST_LANDMARKS_SLOT: value.chestLandmarks[0].edit.slot — ') && cliRefusal.stdout.includes('(see rig-parts guide BUST_LANDMARKS_SLOT)') &&
      !existsSync(join(dir, 'out', 'cli-refusal.json')),
    `exit ${cliRefusal.status}: ${cliRefusal.stdout.split('\n')[0].trim()}`);

  // Round 2 (issue #1382). New controls are numbered after the first 34 so those keep their numbers.
  // The row digest: an edited point with the digest left alone, an edited digest with the points left alone, and an
  // unedited row (accepted, its digest the inline copy's above).
  const digestOf = (problems: readonly { code: string; object: string; detail: string }[]): string => problems.map(p => `${p.code}: ${p.object} — ${p.detail}`).join(' | ');
  const pointEdited = row();
  pointEdited.edit = { ...pointEdited.edit, bust: { apex_r: [76.5, 125], apex_l: [125.25, 125], cleavage: [100, 126.5] } };
  refused('DIGEST_OF_AN_EDITED_POINT_IS_REFUSED', act([pointEdited]), 'BUST_LANDMARKS_ROW', 'value.chestLandmarks[0].sha256');
  refused('AN_EDITED_DIGEST_IS_REFUSED', act([{ ...row(), sha256: digest({ other: true }) }]), 'BUST_LANDMARKS_ROW', 'value.chestLandmarks[0].sha256');
  {
    // The refusal's detail states the rule and both digests.
    let problems: readonly { code: string; object: string; detail: string }[] = [];
    try { bustLandmarksFromAct({ act: join(dir, 'act-DIGEST_OF_AN_EDITED_POINT_IS_REFUSED.json'), parts: partsDir, config: noBustConfig, out: join(dir, 'out', 'digest-detail.json') }); }
    catch (error) { if (error instanceof PartsError) problems = error.problems; else throw error; }
    const hit = problems.find(p => p.object === 'value.chestLandmarks[0].sha256');
    const expected = `is "${row().sha256}"; "${digest(pointEdited.edit)}" is required, the digest of this row's edit by sha256 (lowercase hex) of JSON.stringify of the row's edit with object keys sorted recursively and array order kept (Review's request digest): the edit is not the one the digest names`;
    say('THE_DIGEST_REFUSAL_STATES_THE_RULE_AND_BOTH_DIGESTS', hit?.detail === expected, hit === undefined ? digestOf(problems) || 'no refusal' : hit.detail);
  }
  accepted('AN_UNEDITED_ROW_IS_ACCEPTED', act([row()]), noBustConfig);
  // Item 4: the actId check, the source.hash format check, the provenance half of the --out check.
  const noActId: Record<string, unknown> = act([row()]);
  delete noActId.actId;
  refused('ACT_WITHOUT_AN_ACT_ID', noActId, 'BUST_LANDMARKS_ACT', `${join(dir, 'act-ACT_WITHOUT_AN_ACT_ID.json')} actId`);
  refused('ROW_SOURCE_HASH_MALFORMED', act([row({ source: { hash: 'A'.repeat(64), frame: { width: 200, height: 300 } } })]), 'BUST_LANDMARKS_ROW', 'value.chestLandmarks[0].edit.source.hash');
  mkdirSync(join(dir, 'pv'), { recursive: true });
  const pvConfig = join(dir, 'pv', 'landmarks.json' + BUST_LANDMARKS_PROVENANCE_SUFFIX);
  writeFileSync(pvConfig, readFileSync(noBustConfig));
  refused('PROVENANCE_OVER_THE_CONFIG', act([row()]), 'BUST_LANDMARKS_OUT', `--out's provenance record`, pvConfig, join(dir, 'pv', 'landmarks.json'));
  symlinkSync(partsDir, join(dir, 'pv', 'inside.json' + BUST_LANDMARKS_PROVENANCE_SUFFIX), 'dir');
  refused('PROVENANCE_INSIDE_THE_PARTS_DIRECTORY', act([row()]), 'BUST_LANDMARKS_OUT', `--out's provenance record`, noBustConfig, join(dir, 'pv', 'inside.json'));
  // Item 5: an --out that is a hard link to an input, compared by device and inode.
  linkSync(noBustConfig, join(dir, 'out', 'hard.json'));
  refused('OUT_HARD_LINKED_TO_THE_CONFIG', act([row()]), 'BUST_LANDMARKS_OUT', '--out', noBustConfig, join(dir, 'out', 'hard.json'));
  // Item 6: a coordinate JSON cannot hold, and an act path that is a directory.
  const infinite = join(dir, 'act-infinite.json');
  writeFileSync(infinite, JSON.stringify(act([row()]), null, 2).replace('"apex_r": [\n              75.5,', '"apex_r": [\n              1e999,'));
  {
    let problems: readonly { code: string; object: string; detail: string }[] = [];
    try { bustLandmarksFromAct({ act: infinite, parts: partsDir, config: noBustConfig, out: join(dir, 'out', 'infinite.json') }); }
    catch (error) { if (error instanceof PartsError) problems = error.problems; else throw error; }
    const hit = problems.find(p => p.object === 'value.chestLandmarks[0].edit.bust.apex_r');
    say('A_COORDINATE_THAT_IS_NOT_FINITE_IS_NAMED', hit?.detail === 'is [Infinity,125], a coordinate that is not finite; a finite [x, y] point in rig px is required', hit === undefined ? digestOf(problems) || 'no refusal' : hit.detail);
  }
  {
    let problems: readonly { code: string; object: string; detail: string }[] = [];
    try { bustLandmarksFromAct({ act: join(dir, 'pv'), parts: partsDir, config: noBustConfig, out: join(dir, 'out', 'dir-act.json') }); }
    catch (error) { if (error instanceof PartsError) problems = error.problems; else throw error; }
    const hit = problems.find(p => p.code === 'BUST_LANDMARKS_ACT');
    say('AN_UNREADABLE_ACT_GIVES_THE_ERROR_CODE', hit?.detail === 'is not readable (EISDIR); a rig-review/act@9 JSON file is required', hit === undefined ? digestOf(problems) || 'no refusal' : hit.detail);
  }
  // Item 3: atomic outputs. A provenance path that is a directory: exit 1, the landmarks file not created.
  const pdir = join(dir, 'out', 'pdir.json');
  mkdirSync(pdir + BUST_LANDMARKS_PROVENANCE_SUFFIX);
  const dirRun = cli(...args(actPath, noBustConfig, pdir));
  say('A_PROVENANCE_PATH_THAT_IS_A_DIRECTORY_WRITES_NOTHING', dirRun.status === 1 && !existsSync(pdir) && dirRun.stdout.includes(`FAIL  BUST_LANDMARKS_OUT: --out's provenance record — is ${pdir + BUST_LANDMARKS_PROVENANCE_SUFFIX}, an existing directory`),
    `exit ${dirRun.status}; landmarks file ${existsSync(pdir) ? 'created' : 'not created'}: ${dirRun.stdout.split('\n')[0].trim()}`);
  // An earlier good pair, then a read-only provenance record and another act: exit 1, both old files byte-unchanged.
  const ro = join(dir, 'out', 'ro.json');
  const roFirst = cli(...args(actPath, noBustConfig, ro));
  const oldPair = [readFileSync(ro, 'utf8'), readFileSync(ro + BUST_LANDMARKS_PROVENANCE_SUFFIX, 'utf8')];
  chmodSync(ro + BUST_LANDMARKS_PROVENANCE_SUFFIX, 0o444);
  const roRun = cli(...args(noCleavage, noBustConfig, ro));
  const roKept = readFileSync(ro, 'utf8') === oldPair[0] && readFileSync(ro + BUST_LANDMARKS_PROVENANCE_SUFFIX, 'utf8') === oldPair[1];
  chmodSync(ro + BUST_LANDMARKS_PROVENANCE_SUFFIX, 0o644);
  say('A_READ_ONLY_PROVENANCE_KEEPS_THE_EARLIER_PAIR', roFirst.status === 0 && roRun.status === 1 && roKept && roRun.stdout.includes('an existing file that is not writable'),
    `first exit ${roFirst.status}, second exit ${roRun.status}; both earlier files byte-unchanged: ${roKept}: ${roRun.stdout.split('\n')[0].trim()}`);
  // A rename that fails after the first file is in place puts the first file back and leaves no temporary.
  const rb = join(dir, 'out', 'rollback.json');
  bustLandmarksFromAct({ act: actPath, parts: partsDir, config: noBustConfig, out: rb });
  const rbOld = [readFileSync(rb, 'utf8'), readFileSync(rb + BUST_LANDMARKS_PROVENANCE_SUFFIX, 'utf8')];
  let rbDetail = 'no refusal';
  try {
    stageBustLandmarks(planBustLandmarks({ act: noCleavage, parts: partsDir, config: noBustConfig, out: rb }), {
      replace: (from, to) => { if (to.endsWith(BUST_LANDMARKS_PROVENANCE_SUFFIX)) throw Object.assign(new Error('planted'), { code: 'EIO' }); renameSync(from, to); },
    }).commit();
  } catch (error) { rbDetail = error instanceof PartsError ? digestOf(error.problems) : String(error); }
  const leftovers = readdirSync(join(dir, 'out')).filter(n => n.endsWith('.rig-parts.tmp'));
  const rbKept = readFileSync(rb, 'utf8') === rbOld[0] && readFileSync(rb + BUST_LANDMARKS_PROVENANCE_SUFFIX, 'utf8') === rbOld[1];
  say('A_FAILED_SECOND_RENAME_PUTS_THE_FIRST_FILE_BACK', rbKept && leftovers.length === 0 && rbDetail.startsWith('BUST_LANDMARKS_OUT: '),
    `earlier pair byte-unchanged: ${rbKept}; temporaries left: ${leftovers.length === 0 ? 'none' : leftovers.join(', ')}; ${rbDetail}`);

  // --write-config: the act's five shape fields into the config's existing contour.bust.
  const points = { apex_r: [70, 120], apex_l: [130, 120], cleavage: [100, 121] };
  const flagged = (a: string, config: string, o: string) => cli(...args(a, config, o), '--write-config');
  const configCase = (name: string, bust: Record<string, unknown> | undefined, compact = false): string => {
    const path = join(dir, `config-${name}.json`);
    writeFileSync(path, compact ? JSON.stringify(configOf(bust)) + '\n' : JSON.stringify(configOf(bust), null, 2) + '\n');
    return path;
  };
  const bustOf = (path: string): unknown => (JSON.parse(readFileSync(path, 'utf8')) as { meshes: { bodice: { contour: { bust?: unknown } } } }).meshes.bodice.contour.bust;
  const alphaAct = writeJson('act-alpha.json', act([row({}, { ...points, alpha: 0.3 })]));
  {
    const config = configCase('flag-off', points);
    const before = readFileSync(config, 'utf8');
    const o = join(dir, 'out', 'flag-off.json');
    const run = cli(...args(alphaAct, config, o));
    say('WITHOUT_THE_FLAG_A_DIFFERENCE_IS_REFUSED_NAMING_THE_FLAG',
      run.status === 1 && run.stdout.includes('FAIL  BUST_LANDMARKS_SHAPE: value.chestLandmarks[0].edit.bust.alpha — is 0.3; meshes.bodice.contour.bust.alpha 0.22, the default, is required: the landmarks file carries no such field; run again with --write-config to take the act\'s value into the config; propose --write-config keeps the config\'s shape fields on the redraft (#1428)') &&
        readFileSync(config, 'utf8') === before && !existsSync(o),
      `exit ${run.status}: ${run.stdout.split('\n')[0].trim()}`);
  }
  {
    const config = configCase('flag-alpha', points);
    const o = join(dir, 'out', 'flag-alpha.json');
    const run = flagged(alphaAct, config, o);
    const bust = JSON.stringify(bustOf(config));
    const rest = JSON.parse(readFileSync(config, 'utf8')) as Record<string, unknown>;
    delete ((rest.meshes as Record<string, { contour: Record<string, unknown> }>).bodice.contour).bust;
    const expectedRest = configOf(points);
    delete ((expectedRest.meshes as Record<string, { contour: Record<string, unknown> }>).bodice.contour).bust;
    say('THE_FLAG_TAKES_ALPHA_INTO_THE_CONFIG_AND_WRITES_THE_FILE',
      run.status === 0 && bust === '{"apex_r":[70,120],"apex_l":[130,120],"cleavage":[100,121],"alpha":0.3}' && JSON.stringify(rest) === JSON.stringify(expectedRest) &&
        run.stderr === `config ${config}: added meshes.bodice.contour.bust.alpha\n` && existsSync(o) && existsSync(o + BUST_LANDMARKS_PROVENANCE_SUFFIX),
      `exit ${run.status}; contour.bust ${bust}; the rest unchanged: ${JSON.stringify(rest) === JSON.stringify(expectedRest)}; stderr ${JSON.stringify(run.stderr)}; landmarks written: ${existsSync(o)}`);
  }
  {
    const config = configCase('flag-remove', { ...points, alpha: 0.3 });
    const run = flagged(writeJson('act-no-alpha.json', act([row({}, points)])), config, join(dir, 'out', 'flag-remove.json'));
    const bust = JSON.stringify(bustOf(config));
    say('THE_FLAG_REMOVES_A_FIELD_THE_ACT_OMITS',
      run.status === 0 && bust === '{"apex_r":[70,120],"apex_l":[130,120],"cleavage":[100,121]}' && run.stderr === `config ${config}: removed meshes.bodice.contour.bust.alpha\n`,
      `exit ${run.status}; contour.bust ${bust}; stderr ${JSON.stringify(run.stderr)}`);
  }
  {
    const config = configCase('flag-five', points);
    const five = { alpha: 0.3, clearance: 3, spacing: 12, bone_r: 'chest', bone_l: 'chest' };
    const run = flagged(writeJson('act-five.json', act([row({}, { ...points, ...five })])), config, join(dir, 'out', 'flag-five.json'));
    const bust = JSON.stringify(bustOf(config));
    // Added in the shorthand's key order (the config writer's list, #1428), after the points.
    const lines = ['alpha', 'clearance', 'bone_r', 'bone_l', 'spacing'].map(k => `config ${config}: added meshes.bodice.contour.bust.${k}\n`).join('');
    say('THE_FLAG_WRITES_ALL_FIVE_FIELDS_AT_ONCE',
      run.status === 0 && bust === JSON.stringify({ ...points, alpha: 0.3, clearance: 3, bone_r: 'chest', bone_l: 'chest', spacing: 12 }) && run.stderr === lines,
      `exit ${run.status}; contour.bust ${bust}; stderr ${JSON.stringify(run.stderr)}${run.status === 0 ? '' : `; ${run.stdout.split('\n')[0].trim()}`}`);
  }
  {
    // A compact config, so any rewrite at all would show in its bytes; clearance spelled at its default, which the
    // act omits: the effective values agree, so nothing is touched.
    const config = configCase('flag-same', { ...points, alpha: 0.3, clearance: 3.8 }, true);
    const before = readFileSync(config, 'utf8');
    const same = writeJson('act-same.json', act([row({}, { ...points, alpha: 0.3 })]));
    const off = cli(...args(same, config, join(dir, 'out', 'same-off.json')));
    const offSame = readFileSync(config, 'utf8') === before;
    const on = flagged(same, config, join(dir, 'out', 'same-on.json'));
    const onSame = readFileSync(config, 'utf8') === before;
    say('NOTHING_DIFFERS_THE_CONFIG_KEEPS_ITS_BYTES_WITH_AND_WITHOUT_THE_FLAG',
      off.status === 0 && on.status === 0 && offSame && onSame && on.stderr === `config ${config}: unchanged\n`,
      `without exit ${off.status}, byte-identical ${offSame}; with exit ${on.status}, byte-identical ${onSame}; stderr ${JSON.stringify(on.stderr)}`);
  }
  {
    const config = configCase('flag-refused', points);
    const before = readFileSync(config, 'utf8');
    const o = join(dir, 'out', 'flag-refused.json');
    const run = flagged(writeJson('act-alpha-frame.json', act([row({ source: { hash: hex('a'), frame: { width: 200, height: 301 } } }, { ...points, alpha: 0.3 })])), config, o);
    say('A_REFUSAL_ELSEWHERE_WITH_THE_FLAG_LEAVES_THE_CONFIG',
      run.status === 1 && run.stdout.includes('FAIL  BUST_LANDMARKS_FRAME: ') && readFileSync(config, 'utf8') === before && !existsSync(o),
      `exit ${run.status}; config byte-identical ${readFileSync(config, 'utf8') === before}; landmarks ${existsSync(o) ? 'written' : 'not written'}: ${run.stdout.split('\n')[0].trim()}`);
  }
  {
    // With the flag and no contour.bust: the config is not written (the shape alone makes no contour.bust); the shape
    // is pending in the record instead, and the change line reads unchanged.
    const config = configCase('flag-no-bust', undefined);
    const before = readFileSync(config, 'utf8');
    const o = join(dir, 'out', 'flag-no-bust.json');
    const run = flagged(alphaAct, config, o);
    const record = existsSync(o + BUST_LANDMARKS_PROVENANCE_SUFFIX) ? (JSON.parse(readFileSync(o + BUST_LANDMARKS_PROVENANCE_SUFFIX, 'utf8')) as { shape?: unknown }).shape : undefined;
    say('THE_FLAG_WITHOUT_A_CONTOUR_BUST_LEAVES_THE_CONFIG_AND_RECORDS_THE_SHAPE_PENDING',
      run.status === 0 && readFileSync(config, 'utf8') === before && run.stderr === `config ${config}: unchanged\n` && JSON.stringify(record) === '{"status":"pending","fields":{"alpha":0.3}}',
      `exit ${run.status}; config byte-identical ${readFileSync(config, 'utf8') === before}; shape ${JSON.stringify(record)}; stderr ${JSON.stringify(run.stderr)}`);
  }

  // Round 3: the chain for a first correction with a tuned shape. bust-landmarks leaves the shape pending in the
  // record; propose --write-config --bust-landmarks writes it with the points and marks the record applied.
  const chainDir = join(dir, 'chain');
  mkdirSync(chainDir, { recursive: true });
  const tuned = writeJson('act-tuned.json', act([row({}, { apex_r: [75.5, 125], apex_l: [125.25, 125], cleavage: [100, 126.5], alpha: 0.3, clearance: 3 })]));
  const tunedSha = createHash('sha256').update(readFileSync(tuned)).digest('hex');
  const tunedRow = row({}, { apex_r: [75.5, 125], apex_l: [125.25, 125], cleavage: [100, 126.5], alpha: 0.3, clearance: 3 }).sha256;
  const record = (status: string): string => JSON.stringify({
    spec: 'rig-parts-bust-landmarks-provenance/1',
    act: { schema: 'rig-review/act@9', act_id: 'act-1382', file_sha256: tunedSha },
    row_sha256: tunedRow,
    slot: 'bodice',
    source: { hash: hex('a'), frame: { width: 200, height: 300 } },
    landmarks_sha256: landmarksSha,
    shape: { status, fields: { alpha: 0.3, clearance: 3 } },
  }, null, 2) + '\n';
  const chainConfig = join(chainDir, 'config.json');
  writeFileSync(chainConfig, readFileSync(noBustConfig));
  const chainOut = join(chainDir, 'landmarks.json');
  const chainRecord = chainOut + BUST_LANDMARKS_PROVENANCE_SUFFIX;
  const first3 = cli(...args(tuned, chainConfig, chainOut));
  const pendingLine = `bust-landmarks: pending shape for "bodice": alpha 0.3, clearance 3; the config declares no contour.bust yet, so ${chainRecord} carries it until propose writes it with the three points`;
  const nextLine = `wrote ${chainOut} and ${chainRecord}; next, to apply it: rig-parts propose … --write-config ${chainConfig} --bust-landmarks ${chainOut}`;
  const readOr = (p: string): string => existsSync(p) ? readFileSync(p, 'utf8') : '';
  say('THE_FIRST_COMMAND_RECORDS_A_PENDING_SHAPE_AND_PRINTS_THE_COMMAND_THAT_APPLIES_IT',
    first3.status === 0 && readOr(chainOut) === expectedText && readOr(chainRecord) === record('pending') && first3.stdout.includes(`${pendingLine}\n${nextLine}\n`),
    `exit ${first3.status}; landmarks ${readOr(chainOut) === expectedText ? 'exact' : 'differ'}; record ${readOr(chainRecord) === record('pending') ? 'exact' : JSON.stringify(readOr(chainRecord))}; ${first3.stdout.trim().split('\n').slice(1).join(' / ')}`);
  const proposeArgs = (o: string, ...more: string[]): string[] => ['propose', '--parts', partsDir, '--source', painting, '--out', o, ...more];
  const bustOfChain = (): string => JSON.stringify(bustOf(chainConfig));
  const appliedBust = '{"apex_r":[75.5,125],"apex_l":[125.25,125],"cleavage":[100,126.5],"alpha":0.3,"clearance":3}';
  const second = cli(...proposeArgs(join(chainDir, 'p1'), '--write-config', chainConfig, '--bust-landmarks', chainOut));
  const proposeLine = `propose: wrote the pending shape of act "act-1382" into meshes.bodice.contour.bust (alpha 0.3, clearance 3) with the three points; marked it applied in ${chainRecord}`;
  say('THE_SECOND_COMMAND_WRITES_POINTS_AND_SHAPE_AND_MARKS_THE_RECORD_APPLIED',
    second.status === 0 && bustOfChain() === appliedBust && readOr(chainRecord) === record('applied') && second.stdout.includes(`${proposeLine}\n`),
    `exit ${second.status}; contour.bust ${bustOfChain()}; record ${readOr(chainRecord) === record('applied') ? 'applied, exact' : JSON.stringify(readOr(chainRecord))}${second.status === 0 ? '' : `; ${second.stdout.split('\n')[0].trim()}`}`);
  const configAfter = readOr(chainConfig), recordAfter = readOr(chainRecord);
  const third = cli(...proposeArgs(join(chainDir, 'p2'), '--write-config', chainConfig, '--bust-landmarks', chainOut));
  say('AGAIN_THE_APPLIED_RECORD_CHANGES_NOTHING',
    third.status === 0 && readOr(chainConfig) === configAfter && readOr(chainRecord) === recordAfter && !third.stdout.includes('propose: wrote the pending shape') && third.stderr.includes(`config ${chainConfig}: unchanged`),
    `exit ${third.status}; config byte-identical ${readOr(chainConfig) === configAfter}; record byte-identical ${readOr(chainRecord) === recordAfter}; stderr ${JSON.stringify(third.stderr.trim())}`);
  // A hand edit of the shape after it was applied is kept by a later redraft.
  const edited = JSON.parse(configAfter) as { meshes: { bodice: { contour: { bust: Record<string, unknown> } } } };
  edited.meshes.bodice.contour.bust.alpha = 0.25;
  writeFileSync(chainConfig, JSON.stringify(edited, null, 2) + '\n');
  const fourth = cli(...proposeArgs(join(chainDir, 'p3'), '--write-config', chainConfig, '--bust-landmarks', chainOut));
  say('A_HAND_EDIT_AFTER_IT_WAS_APPLIED_IS_KEPT_ON_REDRAFT',
    fourth.status === 0 && bustOfChain() === appliedBust.replace('"alpha":0.3', '"alpha":0.25'),
    `exit ${fourth.status}; contour.bust ${bustOfChain()}`);
  // The paths that would lose or misapply the shape, each refused by name with nothing written.
  const pendingPair = (name: string): string => {
    const o = join(chainDir, `${name}.json`);
    writeFileSync(o, readFileSync(chainOut));
    writeFileSync(o + BUST_LANDMARKS_PROVENANCE_SUFFIX, record('pending'));
    return o;
  };
  const lostOut = pendingPair('lost');
  const lost = cli(...proposeArgs(join(chainDir, 'p-lost'), '--bust-landmarks', lostOut));
  say('A_PENDING_SHAPE_WITHOUT_WRITE_CONFIG_IS_REFUSED',
    lost.status === 1 && lost.stdout.startsWith(`  FAIL  PROPOSE_BUST_PENDING: --bust-landmarks — ${lostOut + BUST_LANDMARKS_PROVENANCE_SUFFIX} holds a pending shape (alpha 0.3, clearance 3) from act "act-1382", which only a config write keeps; give --write-config <config.json> so propose writes it into contour.bust with the three points, or it is lost — nothing was written`) &&
      !existsSync(join(chainDir, 'p-lost', 'proposal.json')),
    `exit ${lost.status}: ${lost.stdout.split('\n')[0].trim()}`);
  const driftOut = pendingPair('drift');
  writeFileSync(driftOut, readFileSync(driftOut, 'utf8').replace('75.5', '76.5'));
  const driftSha = createHash('sha256').update(readFileSync(driftOut)).digest('hex');
  const drift = cli(...proposeArgs(join(chainDir, 'p-drift'), '--bust-landmarks', driftOut));
  say('A_RECORD_WHOSE_DIGEST_IS_NOT_THE_FILE_IS_REFUSED_WITH_BOTH_DIGESTS',
    drift.status === 1 && drift.stdout.startsWith(`  FAIL  PROPOSE_BUST_SIDECAR_DIGEST: ${driftOut + BUST_LANDMARKS_PROVENANCE_SUFFIX} landmarks_sha256 — is "${landmarksSha}"; "${driftSha}" is required, the sha256 of ${driftOut}'s bytes: the landmarks file is not the one this record was written with`) &&
      !existsSync(join(chainDir, 'p-drift', 'proposal.json')),
    `exit ${drift.status}: ${drift.stdout.split('\n')[0].trim()}`);
  const otherOut = pendingPair('other-part');
  writeFileSync(otherOut + BUST_LANDMARKS_PROVENANCE_SUFFIX, record('pending').replace('"slot": "bodice"', '"slot": "skirt"'));
  // With --write-config, so the pending check passes and the part check is what refuses; the config stays as it was.
  const otherConfig = join(chainDir, 'other-config.json');
  writeFileSync(otherConfig, readFileSync(noBustConfig));
  const otherPart = cli(...proposeArgs(join(chainDir, 'p-other'), '--write-config', otherConfig, '--bust-landmarks', otherOut));
  say('A_RECORD_FOR_ANOTHER_PART_IS_REFUSED',
    otherPart.status === 1 && otherPart.stdout.startsWith(`  FAIL  PROPOSE_BUST_SIDECAR_PART: ${otherOut + BUST_LANDMARKS_PROVENANCE_SUFFIX} slot — is "skirt"; the chest carrier this draft makes ("bodice") is required: the record's points were placed on another part`) &&
      readFileSync(otherConfig, 'utf8') === readFileSync(noBustConfig, 'utf8') && readOr(otherOut + BUST_LANDMARKS_PROVENANCE_SUFFIX).includes('"status": "pending"'),
    `exit ${otherPart.status}: ${otherPart.stdout.split('\n')[0].trim()}`);
  const badOut = pendingPair('malformed');
  writeFileSync(badOut + BUST_LANDMARKS_PROVENANCE_SUFFIX, record('pending').replace('"status": "pending"', '"status": "later"'));
  const bad = cli(...proposeArgs(join(chainDir, 'p-bad'), '--bust-landmarks', badOut));
  say('A_MALFORMED_RECORD_IS_REFUSED',
    bad.status === 1 && bad.stdout.startsWith(`  FAIL  PROPOSE_BUST_SIDECAR: ${badOut + BUST_LANDMARKS_PROVENANCE_SUFFIX} shape — is {"status":"later","fields":{"alpha":0.3,"clearance":3}}; {status: "pending" or "applied", fields: one or more of alpha, clearance, bone_r, bone_l, spacing} is required`),
    `exit ${bad.status}: ${bad.stdout.split('\n')[0].trim()}`);
  // An all-default act: no shape key in the record, the round-2 bytes (the first control's expected record).
  say('AN_ALL_DEFAULT_ACT_RECORDS_NO_SHAPE', provenanceText === expectedProvenance && !provenanceText.includes('"shape"'), `record ${provenanceText === expectedProvenance ? 'exact, no shape key' : 'differs'}`);
  // No record beside the file: the hand-written path, its proposal byte-identical to the one drafted beside a record
  // with nothing pending, and its config write the three points alone.
  const handDir = join(dir, 'hand');
  mkdirSync(handDir, { recursive: true });
  const hand = join(handDir, 'landmarks.json');
  writeFileSync(hand, expectedText);
  const handConfig = join(handDir, 'config.json');
  writeFileSync(handConfig, readFileSync(noBustConfig));
  const handRun = cli(...proposeArgs(join(handDir, 'p'), '--write-config', handConfig, '--bust-landmarks', hand));
  const handProposal = readOr(join(handDir, 'p', 'proposal.json'));
  say('NO_RECORD_IS_THE_HAND_WRITTEN_PATH_UNCHANGED',
    handRun.status === 0 && handProposal !== '' && handProposal === readOr(proposalPath) && JSON.stringify(bustOf(handConfig)) === '{"apex_r":[75.5,125],"apex_l":[125.25,125],"cleavage":[100,126.5]}' && !handRun.stdout.includes('propose: wrote the pending shape'),
    `exit ${handRun.status}; proposal.json ${handProposal === readOr(proposalPath) ? 'byte-identical to the redraft beside a record with nothing pending' : 'differs'}; contour.bust ${JSON.stringify(bustOf(handConfig))}`);
}
