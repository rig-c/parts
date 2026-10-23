/**
 * Public generated controls for issue #671: a config proposed before 1.37.0, built on the current version, where the
 * #490 arm split makes `drape_r` and `hand_r` from the full run's merged arm layer. `rig` names the two parts and the
 * way out; `propose … --write-config <config> --only-missing` adds an entry for each part the config attaches by
 * neither section and leaves every other byte as read. Every expectation is read off the flat-block fixture
 * (`fixtures/arm_split_upgrade.ts`), whose module doc derives the parts and the bones `propose` drafts for them.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ARM_SPLIT_ADDED, ARM_SPLIT_HAND_TUNED, writeArmSplitFixture, type ArmSplitOptions } from '../fixtures/arm_split_upgrade.ts';
import { assembleStage, readRigInputs, rigStage } from '../src/build.ts';
import type { RigcRunner } from '../src/check.ts';
import { PartsError, type Problem } from '../src/errors.ts';
import { jsonValueSpan } from '../src/meshdraft.ts';
import { ARM_SPLIT_MIGRATION, buildRig } from '../src/rig.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
type Json = Record<string, unknown>;

const ROOT = resolve(import.meta.dir, '..');
/** The detail `rig` wrote for a part with neither entry before issue #671, which every other part keeps. */
const PLAIN_DETAIL = 'is in parts.json and has neither a config.meshes nor a config.regions entry; exactly one is required';

function problemsOf(run: () => unknown): Problem[] {
  try {
    run();
    return [];
  } catch (e) {
    if (e instanceof PartsError) return [...e.problems];
    throw e;
  }
}

function cli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [join(ROOT, 'cli.ts'), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** `assemble` of one fixture directory into `<dir>/out` (parts.json, parts/); returns that directory. */
function assembleInto(dir: string): string {
  const out = join(dir, 'out');
  assembleStage(
    { source: join(dir, 'painting.png'), full: join(dir, 'full'), head: join(dir, 'head'), config: join(dir, 'config.json'), seam: 'near-white', project: 'core' },
    { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, 'recomposite_error_rig.png') },
    () => {},
  );
  return out;
}

/** `rig` over an assembled directory into `<out>/rig`; the problems it refused with, none when green. */
function rigInto(dir: string, out: string, runner: RigcRunner): Problem[] {
  return problemsOf(() => rigStage({ config: join(dir, 'config.json'), parts: out, out: join(out, 'rig') }, runner, join(dir, 'scratch'), () => {}));
}

/** `propose --only-missing` over a fixture directory's own parts and config. */
function onlyMissing(dir: string, out: string): ReturnType<typeof cli> {
  return cli(['propose', '--parts', out, '--source', join(dir, 'painting.png'), '--out', join(dir, 'proposal'), '--write-config', join(dir, 'config.json'), '--only-missing']);
}

/**
 * The text of every `meshes` / `regions` entry of `text` (key through value, by section and part) and of every
 * `assemble.plan` row (by the row's own JSON, so a row keeps its key when rows are inserted before it).
 */
function entrySpans(text: string): Map<string, string> {
  const parsed = JSON.parse(text) as Json;
  const spans = new Map<string, string>();
  for (const section of ['meshes', 'regions']) {
    for (const part of Object.keys((parsed[section] ?? {}) as Json)) {
      const s = jsonValueSpan(text, [section, part]);
      spans.set(`${section}.${part}`, text.slice(s.key ?? s.start, s.end));
    }
  }
  ((parsed.assemble as Json).plan as unknown[]).forEach((row, i) => {
    const s = jsonValueSpan(text, ['assemble', 'plan', i]);
    spans.set(`assemble.plan ${JSON.stringify(row)}`, text.slice(s.start, s.end));
  });
  return spans;
}

/** The text of every top-level value but `meshes`, `regions` and `assemble`, and of every `assemble` value but `plan`, by key. */
function otherSections(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const parsed = JSON.parse(text) as Json;
  for (const key of Object.keys(parsed)) {
    if (key === 'meshes' || key === 'regions' || key === 'assemble') continue;
    const s = jsonValueSpan(text, [key]);
    out.set(key, text.slice(s.start, s.end));
  }
  for (const key of Object.keys(parsed.assemble as Json)) {
    if (key === 'plan') continue;
    const s = jsonValueSpan(text, ['assemble', key]);
    out.set(`assemble.${key}`, text.slice(s.start, s.end));
  }
  return out;
}

const OLD_ARM_ROW = '["sleeves","full","handwear-r"]';
const ADDED_ROWS = ['["drape_r","full","drape-r"]', '["hand_r","full","hand-r"]'] as const;

/**
 * The text `--only-missing` writes, by hand. On the pre-1.37 plan (one line, no drape or hand row) the drape row goes
 * in just before the arm row and the hand row just after it, each beside its neighbours on that line (the plan's
 * indices 5 and 7 after the inserts). Then the splice appends each added member after the last member of `regions`,
 * on a line of its own at the section's indent plus two, in the proposal's order (its trunk rule reads the parts in
 * parts.json order: drape_r, then hand_r). A plan that already names the rows gains none.
 */
function expectedMigrated(original: string): string {
  const planned = original.includes(ADDED_ROWS[0]) ? original : original.replace(OLD_ARM_ROW, `${ADDED_ROWS[0]},${OLD_ARM_ROW},${ADDED_ROWS[1]}`);
  const last = `"sleeves": "${ARM_SPLIT_HAND_TUNED.sleevesRegion}" },`;
  const added = ARM_SPLIT_ADDED.map(([part, bone]) => `\n    "${part}": "${bone}"`).join(',');
  return planned.replace(last, `"sleeves": "${ARM_SPLIT_HAND_TUNED.sleevesRegion}",${added} },`);
}

/** Whether `after` is `before` with exactly the added rows and entries: every old row, entry and section's text as read. */
function spliceFigures(before: string, after: string): { exact: boolean; keptEntries: number; changedEntries: string[]; changedSections: string[]; added: string[] } {
  const b = entrySpans(before);
  const a = entrySpans(after);
  const changedEntries = [...b].filter(([k, v]) => a.get(k) !== v).map(([k]) => k);
  const ob = otherSections(before);
  const oa = otherSections(after);
  const changedSections = [...ob].filter(([k, v]) => oa.get(k) !== v).map(([k]) => k).concat([...oa.keys()].filter((k) => !ob.has(k)));
  const added = [...a.keys()].filter((k) => !b.has(k));
  return { exact: after === expectedMigrated(before), keptEntries: b.size - changedEntries.length, changedEntries, changedSections, added };
}

const entryPaths = ARM_SPLIT_ADDED.map(([part]) => `regions.${part}`);
/** The added keys `spliceFigures` reports, in its order: the two entries, then the two plan rows (when the plan lacked them). */
const addedKeys = (rows: boolean): string[] => [...entryPaths, ...(rows ? ADDED_ROWS.map((r) => `assemble.plan ${r}`) : [])];
/** The stderr lines, by hand: each plan row at its index after the inserts (drape 5, hand 7), then each entry. */
const addedLines = (path: string, rows: boolean): string[] => [
  ...(rows ? [`config ${path}: added assemble.plan[5] ${ADDED_ROWS[0]}`, `config ${path}: added assemble.plan[7] ${ADDED_ROWS[1]}`] : []),
  ...entryPaths.map((p) => `config ${path}: added ${p}`),
];

export function runArmSplitUpgradeChecks(dir: string, say: Say, runner: RigcRunner): void {
  mkdirSync(dir, { recursive: true });
  const lines: Array<[string, boolean, string]> = [];
  const record: Say = (name, pass, detail) => {
    lines.push([name, pass, detail]);
  };
  const fixture = (name: string, opts: ArmSplitOptions = {}): { at: string; text: string } => {
    const at = join(dir, name);
    return { at, text: writeArmSplitFixture(at, opts) };
  };

  // ---- AU01: the pre-1.37 config stops at rig, naming the two parts and the way out -----------------------------------
  const old = fixture('pre-1.37');
  const oldOut = assembleInto(old.at);
  const oldParts = (JSON.parse(readFileSync(join(oldOut, 'parts.json'), 'utf8')) as { parts: Array<{ name: string; from: string }> }).parts.map((p) => `${p.name}<${p.from}`);
  const refused = rigInto(old.at, oldOut, runner);
  const attached = refused.filter((p) => p.code === 'RIG_PART_ATTACHED');
  const hinted = attached.filter((p) => p.detail.startsWith(PLAIN_DETAIL) && p.detail.includes(ARM_SPLIT_MIGRATION) && p.detail.includes('--only-missing'));
  // Planted: a part the split does not make, with its entry taken away, keeps the detail rig wrote before #671.
  const inputs = readRigInputs(join(old.at, 'config.json'), oldOut);
  delete (inputs.cfg.regions as Record<string, string>).face;
  (inputs.cfg.regions as Record<string, string>).drape_r = 'hip';
  (inputs.cfg.regions as Record<string, string>).hand_r = 'chest';
  const plain = problemsOf(() => buildRig(inputs.cfg, inputs.parts, inputs.images)).filter((p) => p.code === 'RIG_PART_ATTACHED');
  record(
    'AU01_A_PRE_1_37_CONFIG_STOPS_AT_RIG_NAMING_THE_SPLIT_PARTS_THE_MIGRATION_ENTRY_AND_ONLY_MISSING',
    refused.length === 2 && JSON.stringify(attached.map((p) => p.object)) === JSON.stringify(ARM_SPLIT_ADDED.map(([part]) => `part "${part}"`)) && hinted.length === 2 &&
      plain.length === 1 && plain[0].object === 'part "face"' && plain[0].detail === PLAIN_DETAIL,
    `parts.json ${oldParts.join(', ')}; rig refused ${refused.map((p) => `${p.code} ${p.object}`).join(', ') || 'nothing'} (by hand: RIG_PART_ATTACHED part "drape_r", part "hand_r"), ${hinted.length} of them naming ${ARM_SPLIT_MIGRATION} and --only-missing; planted face without its entry -> ${plain.map((p) => `${p.object}: "${p.detail}"`).join('; ') || 'not refused'} (the plain detail required)`,
  );

  // ---- AU02/AU03/AU10: --only-missing on the pre-1.37 config, then the build ---------------------------------------
  const oldConfig = join(old.at, 'config.json');
  const oldParts0 = readFileSync(join(oldOut, 'parts.json'), 'utf8');
  const oldRun = onlyMissing(old.at, oldOut);
  const oldAfter = readFileSync(oldConfig, 'utf8');
  const oldFig = spliceFigures(old.text, oldAfter);
  const oldLines = oldRun.stderr.split('\n').filter((l) => l.startsWith('config '));
  record(
    'AU02_ONLY_MISSING_ADDS_EXACTLY_THE_DRAPE_AND_HAND_PLAN_ROWS_AND_ENTRIES_TO_A_PRE_1_37_CONFIG_AND_KEEPS_EVERY_OTHER_BYTE',
    oldRun.status === 0 && oldFig.exact && oldFig.changedEntries.length === 0 && oldFig.changedSections.length === 0 && JSON.stringify(oldFig.added) === JSON.stringify(addedKeys(true)) &&
      JSON.stringify(oldLines) === JSON.stringify(addedLines(oldConfig, true)),
    `exit ${oldRun.status}${oldRun.status === 0 ? '' : ` (${oldRun.stdout.split('\n').filter((l) => l.includes('FAIL')).map((l) => l.trim()).join(' | ')})`}; text as by hand ${oldFig.exact}; ${oldFig.keptEntries} plan rows and entries kept as read, changed ${JSON.stringify(oldFig.changedEntries)}; other sections changed ${JSON.stringify(oldFig.changedSections)}; added ${JSON.stringify(oldFig.added)} (by hand ${JSON.stringify(addedKeys(true))}); stderr ${JSON.stringify(oldLines)}`,
  );
  const oldRebuilt = oldRun.status === 0 ? assembleInto(old.at) : null;
  const oldMigrated = oldRebuilt === null ? null : rigInto(old.at, oldRebuilt, runner);
  record(
    'AU03_THE_MIGRATED_PRE_1_37_CONFIG_BUILDS_GREEN',
    oldMigrated !== null && oldMigrated.length === 0,
    oldMigrated === null ? 'not built: AU02 wrote no migrated config' : `assemble -> rig ${oldMigrated.length === 0 ? 'green' : `refused ${oldMigrated.map((p) => `${p.code} ${p.object}`).join(', ')}`} (check not run: the fixture's idle is static, so check's motion bars — breath, tip over root — have nothing to read and fail by design)`,
  );
  const oldParts1 = oldRebuilt === null ? null : readFileSync(join(oldRebuilt, 'parts.json'), 'utf8');
  record(
    'AU10_ASSEMBLE_MAKES_THE_SAME_PARTS_JSON_BEFORE_AND_AFTER_THE_PLAN_ROWS_ARE_WRITTEN',
    oldParts1 !== null && oldParts1 === oldParts0,
    oldParts1 === null ? 'not assembled: AU02 wrote no migrated config' : `parts.json ${oldParts0.length} B before (the rewrite's plan) and ${oldParts1.length} B after (the written plan): ${oldParts1 === oldParts0 ? 'byte-identical' : 'DIFFERENT'} — mergedArmSplitPlan leaves a plan that already names drape-r and hand-r as written`,
  );

  // ---- AU04: nothing missing -> no byte, no mtime ----------------------------------------------------------------------
  const settledText = readFileSync(oldConfig, 'utf8');
  const settledStat = statSync(oldConfig);
  const again = onlyMissing(old.at, oldRebuilt ?? oldOut);
  const againLines = again.stderr.split('\n').filter((l) => l.startsWith('config '));
  record(
    'AU04_NOTHING_MISSING_CHANGES_NO_BYTE_AND_NO_MTIME',
    oldRun.status === 0 && again.status === 0 && readFileSync(oldConfig, 'utf8') === settledText && statSync(oldConfig).mtimeMs === settledStat.mtimeMs && JSON.stringify(againLines) === JSON.stringify([`config ${oldConfig}: unchanged`]),
    `the migrated pre-1.37 config, a second run: exit ${again.status}; bytes equal ${readFileSync(oldConfig, 'utf8') === settledText}; mtime ${statSync(oldConfig).mtimeMs === settledStat.mtimeMs ? 'unchanged' : 'moved'}; stderr ${JSON.stringify(againLines)}`,
  );

  // ---- AU05: a missing part whose proposed bone the config does not declare ----------------------------------------
  const nohip = fixture('no-hip', { hip: false });
  const nohipOut = assembleInto(nohip.at);
  const nohipStat = statSync(join(nohip.at, 'config.json'));
  const nohipRun = onlyMissing(nohip.at, nohipOut);
  const fails = nohipRun.stdout.split('\n').filter((l) => l.trim().startsWith('FAIL'));
  const untouched = readFileSync(join(nohip.at, 'config.json'), 'utf8') === nohip.text && statSync(join(nohip.at, 'config.json')).mtimeMs === nohipStat.mtimeMs;
  record(
    'AU05_A_MISSING_PART_ON_A_BONE_THE_CONFIG_LACKS_IS_REFUSED_BY_NAME_AND_NOTHING_IS_WRITTEN',
    nohipRun.status === 1 && fails.length === 1 && fails[0].includes('CONFIG_NAME_RESOLVES: config.regions.drape_r') && fails[0].includes('"hip"') && fails[0].includes('"drape_r"') && untouched,
    `the pre-1.37 config without hip: exit ${nohipRun.status}; ${fails.map((l) => l.trim()).join(' | ') || 'no FAIL line'} (by hand: config.regions.drape_r naming "hip", the one bone missing); config bytes and mtime untouched ${untouched}, the plan rows not written either`,
  );

  // ---- AU06: the switch outside its mode ------------------------------------------------------------------------------
  const cfg = join(nohip.at, 'config.json');
  const base = ['--source', join(nohip.at, 'painting.png'), '--out', join(dir, 'unused')];
  const usages: Array<[string, string[]]> = [
    ['with --head-box', ['propose', '--head-box', '--full', join(nohip.at, 'full'), '--canvas', '128x128', '--write-config', cfg, '--only-missing']],
    ['without --parts', ['propose', ...base, '--write-config', cfg, '--only-missing']],
    ['without --write-config', ['propose', '--parts', nohipOut, ...base, '--only-missing']],
    ['with --cloth', ['propose', '--parts', nohipOut, ...base, '--cloth', cfg, '--write-config', join(dir, 'fresh.json'), '--only-missing']],
    ['with --from-config', ['propose', '--parts', nohipOut, ...base, '--from-config', cfg, '--only-missing']],
    ['given twice', ['propose', '--parts', nohipOut, ...base, '--write-config', cfg, '--only-missing', '--only-missing']],
  ];
  const usageResults = usages.map(([what, args]) => {
    const r = cli(args);
    return { what, ok: r.status === 2 && r.stdout.includes('--only-missing'), line: r.stdout.split('\n').find((l) => l.includes('USAGE')) ?? r.stdout.split('\n')[0] };
  });
  record(
    'AU06_ONLY_MISSING_OUTSIDE_PROPOSE_PARTS_WRITE_CONFIG_IS_A_USAGE_ERROR',
    usageResults.every((u) => u.ok) && readFileSync(cfg, 'utf8') === nohip.text,
    usageResults.map((u) => `${u.what}: ${u.ok ? 'exit 2' : 'NOT refused as usage'} (${u.line.trim()})`).join('; '),
  );

  // ---- AU07: planted — the whole-section write does not keep the author's values ------------------------------------------
  // On the twin whose plan names the drape and hand: on the pre-1.37 plan the whole-section write is refused by the
  // loader (its regions name drape_r and hand_r, which that plan does not make), so nothing would be read.
  const whole = fixture('whole-section', { splitPlan: true });
  const wholeOut = assembleInto(whole.at);
  const wholeRun = cli(['propose', '--parts', wholeOut, '--source', join(whole.at, 'painting.png'), '--out', join(whole.at, 'proposal'), '--write-config', join(whole.at, 'config.json')]);
  const wholeText = readFileSync(join(whole.at, 'config.json'), 'utf8');
  const wholeCfg = JSON.parse(wholeText) as { meshes: Json; regions: Record<string, string> };
  const wholeFig = spliceFigures(whole.text, wholeText);
  const wholeGrid = (wholeCfg.meshes.topwear as { grid?: number } | undefined)?.grid;
  record(
    'AU07_PLANTED_A_WHOLE_SECTION_WRITE_DOES_NOT_KEEP_THE_HAND_TUNED_VALUES',
    wholeRun.status === 0 && wholeCfg.regions.sleeves !== ARM_SPLIT_HAND_TUNED.sleevesRegion && wholeGrid !== ARM_SPLIT_HAND_TUNED.topwearGrid && !wholeFig.exact && wholeFig.changedEntries.length > 0,
    `split-plan twin: exit ${wholeRun.status}; regions.sleeves "${wholeCfg.regions.sleeves}" (the author's "${ARM_SPLIT_HAND_TUNED.sleevesRegion}"), meshes.topwear grid ${wholeGrid ?? 'absent'} (the author's ${ARM_SPLIT_HAND_TUNED.topwearGrid}); entries whose text moved ${JSON.stringify(wholeFig.changedEntries)} — so AU02 and AU08 read a write that could have lost them`,
  );

  // ---- AU08/AU09: the twin whose plan already names the drape and hand rows gains entries only -------------------------
  const twin = fixture('split-plan', { splitPlan: true });
  const twinOut = assembleInto(twin.at);
  const twinParts = readFileSync(join(twinOut, 'parts.json'), 'utf8');
  const twinRun = onlyMissing(twin.at, twinOut);
  const twinAfter = readFileSync(join(twin.at, 'config.json'), 'utf8');
  const twinFig = spliceFigures(twin.text, twinAfter);
  const twinLines = twinRun.stderr.split('\n').filter((l) => l.startsWith('config '));
  record(
    'AU08_WHERE_THE_PLAN_NAMES_THE_ROWS_ONLY_MISSING_ADDS_THE_ENTRIES_ALONE_AND_KEEPS_EVERY_OTHER_BYTE',
    twinRun.status === 0 && twinFig.exact && twinFig.changedEntries.length === 0 && twinFig.changedSections.length === 0 && JSON.stringify(twinFig.added) === JSON.stringify(addedKeys(false)) &&
      JSON.stringify(twinLines) === JSON.stringify(addedLines(join(twin.at, 'config.json'), false)) &&
      (JSON.parse(twinAfter) as { meshes: { topwear: { grid: number } } }).meshes.topwear.grid === ARM_SPLIT_HAND_TUNED.topwearGrid,
    `exit ${twinRun.status}; text as by hand ${twinFig.exact}; ${twinFig.keptEntries} plan rows and entries kept as read (meshes.topwear grid ${ARM_SPLIT_HAND_TUNED.topwearGrid}, regions.sleeves "${ARM_SPLIT_HAND_TUNED.sleevesRegion}" among them), changed ${JSON.stringify(twinFig.changedEntries)}; other sections changed ${JSON.stringify(twinFig.changedSections)}; added ${JSON.stringify(twinFig.added)} (no plan row); stderr ${JSON.stringify(twinLines)}`,
  );
  const twinRebuilt = assembleInto(twin.at);
  const twinRig = rigInto(twin.at, twinRebuilt, runner);
  record(
    'AU09_THE_MIGRATED_SPLIT_PLAN_CONFIG_BUILDS_GREEN',
    twinRig.length === 0 && readFileSync(join(twinRebuilt, 'parts.json'), 'utf8') === twinParts && twinParts === oldParts0,
    `assemble -> rig ${twinRig.length === 0 ? 'green' : `refused ${twinRig.map((p) => `${p.code} ${p.object}`).join(', ')}`}; parts.json the same bytes as before the write ${readFileSync(join(twinRebuilt, 'parts.json'), 'utf8') === twinParts} and as the pre-1.37 config's ${twinParts === oldParts0} (check not run: the fixture's idle is static)`,
  );

  // The cases are measured in the order their inputs need and printed by number.
  for (const [name, pass, detail] of [...lines].sort((a, b) => a[0].localeCompare(b[0]))) say(name, pass, detail);
}
