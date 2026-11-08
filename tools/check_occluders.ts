/**
 * Controls for declared occluders (issue #1230), on the generated inputs of
 * `fixtures/occluder_chain.ts`:
 *
 * - `runOccluderConfigChecks`: `config.assemble.occluders` at every config
 *   door, each planted refusal by its code;
 * - `runOccluderCopyChecks`: `ASSEMBLE_OCCLUDER_COLOUR_COPIED` fires on a
 *   planted copy with the planted count, stays silent without it, and the
 *   declaration moves no output byte;
 * - `runOccluderChainChecks`: the chain through `comfy plate --mode occluder`
 *   (run by the comfy harness against the fake ComfyUI): the plate's
 *   decomposition as `--full`, the real painting as `--source`, the occluder's
 *   layer taken from the painting's own decomposition — no assemble change —
 *   leaves no `ASSEMBLE_HIDDEN_EXTENT_ABSENT` cell, where the painting's own
 *   decomposition leaves the occluder's 2,048.
 *
 *   bun tools/check_occluders.ts <work dir>     the first two (no box needed)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleStage } from '../src/build.ts';
import { loadConfig, loadEarlyConfig, parseConfig, parseEarlyConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { OCCLUDER_COLOUR_COPIED } from '../src/occluders.ts';
import { sha256 } from '../src/plate.ts';
import { chainConfig, OCCLUDER, OCCLUDER_PX, PLANT, writeChainInputs, writePlateRun } from '../fixtures/occluder_chain.ts';

type Say = (name: string, pass: boolean, detail: string) => void;

function refusal(run: () => unknown): PartsError | null {
  try { run(); return null; } catch (error) {
    if (error instanceof PartsError) return error;
    throw error;
  }
}

const declaration = (sha: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ image: 'occluder.png', sha256: sha, under: ['behind'], rgb_within: 20, ...extra });

export function runOccluderConfigChecks(dir: string, say: Say): void {
  const home = join(dir, 'occluder-config');
  rmSync(home, { recursive: true, force: true });
  const { occluderSha } = writeChainInputs(home);
  const doors = [parseConfig, (raw: Record<string, unknown>) => parseEarlyConfig(raw, 'assemble'), (raw: Record<string, unknown>) => parseEarlyConfig(raw, 'layers')];
  const good = chainConfig({ occluders: [declaration(occluderSha)] });
  say('OC01_DECLARATION_READS_AT_EVERY_DOOR', doors.every((read) => JSON.stringify(read(good).assemble.occluders) === JSON.stringify([declaration(occluderSha)])), 'full, assemble and layers retain the declaration');
  const shaped = [
    { value: { occluders: true }, code: 'CONFIG_FIELD_TYPE' },
    { value: { occluders: [declaration(occluderSha, { extra: 1 })] }, code: 'CONFIG_KEY_KNOWN' },
    { value: { occluders: [{ image: 'occluder.png', sha256: occluderSha, under: ['behind'] }] }, code: 'CONFIG_FIELD_PRESENT' },
    { value: { occluders: [declaration('not-a-sha')] }, code: 'CONFIG_FIELD_TYPE' },
    { value: { occluders: [declaration(occluderSha, { under: [] })] }, code: 'CONFIG_FIELD_TYPE' },
    { value: { occluders: [declaration(occluderSha, { rgb_within: 256 })] }, code: 'CONFIG_FIELD_TYPE' },
  ];
  const shapeRows = shaped.map(({ value, code }) => doors.map((read) => refusal(() => read(chainConfig(value)))?.problems.some((p) => p.code === code) === true));
  say('OC02_SHAPE_PLANTS_ARE_REFUSED_AT_EVERY_DOOR', shapeRows.every((row) => row.every(Boolean)), shaped.map(({ code }, i) => `${code} ${shapeRows[i].join('/')}`).join('; '));
  const unknown = chainConfig({ occluders: [declaration(occluderSha, { under: ['absent'] })] });
  const named = doors.slice(0, 2).map((read) => refusal(() => read(unknown))?.problems.find((p) => p.code === 'CONFIG_NAME_RESOLVES' && p.object === 'config.assemble.occluders[0].under[0]'));
  say('OC03_AN_UNKNOWN_UNDER_PART_IS_REFUSED_AT_THE_PLAN_DOORS', named.every((p) => p !== undefined), named.map((p) => p?.detail ?? 'accepted').join(' | '));
  // File doors: the loaders that know the config's directory read the image and its sha256.
  const loaders = [(path: string) => loadConfig(path), (path: string) => loadEarlyConfig(path, 'assemble'), (path: string) => loadEarlyConfig(path, 'layers')];
  const file = (name: string, cfg: Record<string, unknown>): string => { const path = join(home, name); writeFileSync(path, JSON.stringify(cfg)); return path; };
  const okPath = file('ok.json', good);
  const badSha = file('bad-sha.json', chainConfig({ occluders: [declaration('0'.repeat(64))] }));
  const missing = file('missing.json', chainConfig({ occluders: [declaration(occluderSha, { image: 'absent.png' })] }));
  const accepted = loaders.map((load) => refusal(() => load(okPath)) === null);
  const shaCodes = loaders.map((load) => refusal(() => load(badSha))?.problems.find((p) => p.code === 'CONFIG_OCCLUDER_SHA256'));
  const missingCodes = loaders.map((load) => refusal(() => load(missing))?.problems.find((p) => p.code === 'CONFIG_FILE_PRESENT' && p.object === 'config.assemble.occluders[0].image'));
  say('OC04_A_BAD_SHA_AND_A_MISSING_FILE_ARE_REFUSED_BY_NAME_AT_EVERY_LOADER',
    accepted.every(Boolean) && shaCodes.every((p) => p?.detail.includes(occluderSha) === true) && missingCodes.every((p) => p !== undefined),
    `declared bytes accepted ${accepted.join('/')}; bad sha: ${shaCodes.map((p) => p?.code ?? 'accepted').join('/')}; missing file: ${missingCodes.map((p) => p?.code ?? 'accepted').join('/')}`);
}

function stage(home: string, full: string, cfg: Record<string, unknown>, out: string): { lines: string[]; error: PartsError | null } {
  writeFileSync(join(home, 'config.json'), JSON.stringify(cfg));
  const lines: string[] = [];
  const error = refusal(() => assembleStage({ config: join(home, 'config.json'), source: join(home, 'painting.png'), full, head: null, project: 'visible' },
    { partsJson: join(home, out, 'parts.json'), partsDir: join(home, out, 'parts'), recomposite: join(home, out, 'recomposite.png'), errorMap: join(home, out, 'error.png') }, (line) => lines.push(line)));
  return { lines, error };
}

const copied = (lines: readonly string[]): string[] => lines.filter((l) => l.includes(OCCLUDER_COLOUR_COPIED));

export function runOccluderCopyChecks(dir: string, say: Say): void {
  const planted = join(dir, 'occluder-copy-planted'), clean = join(dir, 'occluder-copy-clean');
  for (const d of [planted, clean]) rmSync(d, { recursive: true, force: true });
  const p = writeChainInputs(planted, PLANT), c = writeChainInputs(clean);
  const fired = stage(planted, join(planted, 'orig'), chainConfig({ occluders: [declaration(p.occluderSha)] }), 'out');
  const want = PLANT.exact + PLANT.within;
  const line = copied(fired.lines);
  say('OC05_A_PLANTED_COPY_FIRES_WITH_THE_PLANTED_COUNT',
    fired.error === null && line.length === 1 && line[0].startsWith(`WARN  ${OCCLUDER_COLOUR_COPIED}: config.assemble.occluders[0] part "behind" — ${want} rig px`) && line[0].includes(`first at ${OCCLUDER[0]},${OCCLUDER[1]}`),
    `${fired.error?.message ?? 'assembled'}; planted ${PLANT.exact} exact + ${PLANT.within} at 20 off + ${PLANT.beyond} at 21 off, want ${want}; ${line.join(' | ') || 'no WARN'}`);
  const silent = stage(clean, join(clean, 'orig'), chainConfig({ occluders: [declaration(c.occluderSha)] }), 'declared');
  say('OC06_WITHOUT_THE_PLANT_THE_FINDING_IS_SILENT', silent.error === null && copied(silent.lines).length === 0, `${silent.error?.message ?? 'assembled'}; ${copied(silent.lines).join(' | ') || 'no WARN'}`);
  const plain = stage(clean, join(clean, 'orig'), chainConfig({}), 'plain');
  const files = ['parts.json', 'recomposite.png', 'error.png', 'parts/behind.png', 'parts/front.png'];
  const same = files.filter((f) => existsSync(join(clean, 'plain', f)) && readFileSync(join(clean, 'plain', f)).equals(readFileSync(join(clean, 'declared', f))));
  say('OC07_THE_DECLARATION_MOVES_NO_OUTPUT_BYTE', plain.error === null && same.length === files.length, `${same.length}/${files.length} files byte-identical with and without config.assemble.occluders`);
}

/** `plateDir` is the harness's `comfy plate --mode occluder` output on the chain's painting and occluder (`<work>/occ-chain`). */
export function runOccluderChainChecks(work: string, plateDir: string, say: Say): void {
  const home = join(work, 'occ-chain');
  const receiptPath = join(plateDir, 'receipt.json');
  if (!existsSync(receiptPath)) { say('PB18_THE_CHAIN_THROUGH_THE_OCCLUDER_PLATE_LEAVES_NO_ABSENT_CELL', false, `no plate at ${plateDir}`); return; }
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as { occluder?: { sha256?: string }; painting?: { sha256?: string }; output?: { sha256?: string } };
  const plateBytes = new Uint8Array(readFileSync(join(plateDir, 'plate.png')));
  const occluderSha = sha256(new Uint8Array(readFileSync(join(home, 'occluder.png'))));
  rmSync(join(home, 'plate-run'), { recursive: true, force: true });
  const run = writePlateRun(home, plateBytes);
  const meta = JSON.parse(readFileSync(join(run, 'meta.json'), 'utf8')) as { image_sha256: string };
  const declared = { require_hidden_extent: [{ part: 'behind', occluder: 'front' }], occluders: [declaration(occluderSha)] };
  // Without the new source: the painting's own decomposition leaves the occluder's cells absent.
  const before = stage(home, join(home, 'orig'), chainConfig(declared), 'out-orig');
  const absent = before.error?.problems.find((p) => p.code === 'ASSEMBLE_HIDDEN_EXTENT_ABSENT');
  // Through it: the plate's run as --full, the occluder's layer taken from the painting's run (st_input = the painting).
  const take = [{ run: 'full', run_dir: 'orig', st_input: 'painting.png', tags: ['objects'] }];
  const after = stage(home, run, chainConfig({ ...declared, take }), 'out-plate');
  const parts = after.error === null ? JSON.parse(readFileSync(join(home, 'out-plate', 'parts.json'), 'utf8')) as { parts: Array<{ name: string; opaque_px: number; taken_layers?: Array<{ st_input: string; differing_px: number }> }> } : null;
  const behind = parts?.parts.find((x) => x.name === 'behind'), front = parts?.parts.find((x) => x.name === 'front');
  const bound = receipt.occluder?.sha256 === occluderSha && receipt.painting?.sha256 === sha256(new Uint8Array(readFileSync(join(home, 'painting.png')))) && receipt.output?.sha256 === meta.image_sha256;
  say('PB18_THE_CHAIN_THROUGH_THE_OCCLUDER_PLATE_LEAVES_NO_ABSENT_CELL',
    absent?.detail.includes(`${OCCLUDER_PX} enclosed-hole rig cells of ${OCCLUDER_PX}`) === true && after.error === null && copied(after.lines).length === 0 &&
      behind?.opaque_px === 96 * 96 && front?.taken_layers?.[0]?.st_input === 'painting.png' && front.taken_layers[0].differing_px === 0 && bound,
    `painting's run: ${absent === undefined ? 'no ABSENT refusal' : absent.detail.split(';')[0]}; plate's run: ${after.error?.message ?? `assembled, behind ${behind?.opaque_px} px, front taken from st_input ${front?.taken_layers?.[0]?.st_input} differing ${front?.taken_layers?.[0]?.differing_px}`}; copied WARN ${copied(after.lines).length}; receipt binds occluder, painting and the run's input ${bound}`);
}

if (import.meta.main) {
  const work = process.argv[2];
  if (work === undefined) {
    console.error('usage: bun tools/check_occluders.ts <work dir>');
    process.exit(2);
  }
  mkdirSync(work, { recursive: true });
  let bad = 0;
  const say: Say = (name, pass, detail) => {
    if (!pass) bad++;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
  };
  runOccluderConfigChecks(work, say);
  runOccluderCopyChecks(work, say);
  process.exit(bad === 0 ? 0 : 1);
}
