/** Generated controls for #947: under trace_parts, every part's pixels trace to a layer of the split or to an editor receipt. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RECEIPT_AUTHOR_FILE, writeEditorReceiptFixture } from '../fixtures/editor_receipts.ts';
import { assembleStage } from '../src/build.ts';
import { type AssembleConfig, parseConfig, parseEarlyConfig } from '../src/config.ts';
import { fileSha256 } from '../src/editreceipt.ts';
import { PartsError } from '../src/errors.ts';
import { untracedPartSources } from '../src/partsource.ts';

type Say = (name: string, pass: boolean, detail: string) => void;

const FROM = 'a'.repeat(64);
const REQUIRED = "config.assemble.editor_receipts.trace_parts is true, so every part's pixels must trace to a layer of the See-through split or to an image with an editor receipt";

export function runPartSourceChecks(dir: string, say: Say, validationConfig?: string): void {
  const run = (d: string, out = 'out') => assembleStage({ source: join(d, 'painting.png'), full: join(d, 'full'), head: null, config: join(d, 'config.json'), seam: 'near-white', project: 'core' },
    { partsJson: join(d, out, 'parts.json'), partsDir: join(d, out, 'parts'), recomposite: join(d, out, 'recomposite.png'), errorMap: join(d, out, 'error.png') }, () => {});
  const message = (action: () => unknown): string => { try { action(); return ''; } catch (e) { if (e instanceof PartsError) return e.message; throw e; } };
  const codes = (action: () => unknown): string[] => { try { action(); return []; } catch (e) { if (e instanceof PartsError) return e.problems.map(p => `${p.code} ${p.object}`); throw e; } };
  const save = (d: string, cfg: Record<string, unknown>): void => writeFileSync(join(d, 'config.json'), JSON.stringify(cfg));
  const asm = (cfg: Record<string, unknown>): Record<string, unknown> => cfg.assemble as Record<string, unknown>;
  const fresh = (name: string, options: { author?: boolean } = {}) => { const d = join(dir, name); const cfg = writeEditorReceiptFixture(d, options); return { d, cfg, sha: options.author === false ? '' : fileSha256(join(d, RECEIPT_AUTHOR_FILE)) }; };
  const receipt = (sha: string) => ({ file: RECEIPT_AUTHOR_FILE, sha256: sha, from_sha256: FROM, editor: 'an image editor' });
  const traced = (cfg: Record<string, unknown>, receipts: unknown[]): Record<string, unknown> => { asm(cfg).editor_receipts = { trace_parts: true, receipts }; return cfg; };
  // The planted defect: a piece carved out of the body's layer by a hand-drawn polygon (fixture body = topwear [8, 32, 56, 56]).
  const SLEEVE = { from: 'body', into: 'sleeve', polygon: [[8, 32], [24, 32], [24, 56], [8, 56]], draw: 'front', overlap: 0 };
  const carve = (cfg: Record<string, unknown>): Record<string, unknown> => { asm(cfg).cuts = [SLEEVE]; (cfg.regions as Record<string, unknown>).sleeve = 'anchor'; return cfg; };

  // The gap, measured: today the carved piece assembles green, recorded as from the body's layer.
  const gap = fresh('undeclared-cut'); save(gap.d, carve(gap.cfg));
  let gapDetail = '';
  try {
    run(gap.d);
    const parts = (JSON.parse(readFileSync(join(gap.d, 'out', 'parts.json'), 'utf8')) as { parts: Array<{ name: string; from: string; cut_from?: string }> }).parts;
    const piece = parts.find(p => p.name === 'sleeve');
    gapDetail = piece === undefined ? 'no sleeve part' : `sleeve from ${piece.from}, cut_from ${String(piece.cut_from)}`;
    say('UNDECLARED_CARVED_PIECE_ASSEMBLES', piece?.from === 'full:topwear' && piece.cut_from === 'body', `no trace_parts: the polygon carve assembles as before — ${gapDetail}`);
  } catch (e) { say('UNDECLARED_CARVED_PIECE_ASSEMBLES', false, e instanceof Error ? e.message : String(e)); }

  // Positive control: split layers and a receipted author layer under trace_parts assemble to the undeclared bytes.
  const plain = fresh('undeclared'); run(plain.d);
  const good = fresh('positive'); save(good.d, traced(good.cfg, [receipt(good.sha)]));
  const goodMessage = message(() => run(good.d));
  const same = goodMessage === '' && readFileSync(join(good.d, 'out', 'parts.json')).equals(readFileSync(join(plain.d, 'out', 'parts.json')));
  say('SPLIT_AND_RECEIPTED_PARTS_PASS_BYTE_IDENTICAL', same, goodMessage || `parts.json equals the undeclared build's: ${same}`);

  // Planted: the carved piece under trace_parts, refused by name with the shape found; nothing written.
  const cut = fresh('cut'); save(cut.d, traced(carve(cut.cfg), [receipt(cut.sha)]));
  const cutMessage = message(() => run(cut.d));
  say('POLYGON_CARVE_REFUSED', cutMessage === `ASSEMBLE_PART_SOURCE: part "sleeve" (config.assemble.cuts[0]) — its pixels are carved out of part "body" by a hand-drawn 4-point polygon; ${REQUIRED} — paint the piece as an author layer (author:<label>) in an image editor and record its receipt in config.assemble.editor_receipts, or take it whole from a layer of the split — never carve it by a shape drawn in the config` && !existsSync(join(cut.d, 'out')), cutMessage || 'accepted');

  // Planted: a patch's box of the painting, a painting extension's band.
  const patch = fresh('patch'); const pc = traced(patch.cfg, [receipt(patch.sha)]);
  asm(pc).patches = [{ name: 'hem', box: [8, 8, 24, 24], alpha: 'box', draw: 'back' }]; (pc.regions as Record<string, unknown>).hem = 'anchor'; save(patch.d, pc);
  const patchMessage = message(() => run(patch.d));
  say('PAINTING_BOX_REFUSED', patchMessage.startsWith(`ASSEMBLE_PART_SOURCE: part "hem" (config.assemble.patches[0]) — its pixels are the painting's inside a hand-drawn box [8, 8, 24, 24] (alpha "box"), which no layer of the split holds; ${REQUIRED}`) && !existsSync(join(patch.d, 'out')), patchMessage || 'accepted');
  const ext = fresh('extend'); const ec = traced(ext.cfg, [receipt(ext.sha)]);
  asm(ec).extend_painting = [{ part: 'body', band: [0, 0, 64, 64], max_distance: 2 }]; save(ext.d, ec);
  const extMessage = message(() => run(ext.d));
  say('PAINTING_BAND_REFUSED', extMessage.startsWith(`ASSEMBLE_PART_SOURCE: part "body" (config.assemble.extend_painting[0]) — it gains the painting's pixels inside a hand-drawn band [0, 0, 64, 64], which no layer of the split holds there; ${REQUIRED}`), extMessage || 'accepted');

  // Planted: the arm split's drawn column; parts.json would record both halves as See-through layers, so only the config shows it.
  const arm = fresh('arm-split'); const ac = traced(arm.cfg, [receipt(arm.sha)]);
  (ac.seethrough as Record<string, unknown>).arm_split = { x: 32, order: ['handwear-r', 'handwear-l'] }; save(arm.d, ac);
  const armCodes = codes(() => run(arm.d));
  say('ARM_SPLIT_COLUMN_REFUSED', armCodes.length === 1 && armCodes[0] === 'ASSEMBLE_PART_SOURCE parts full:handwear-r and full:handwear-l (config.seethrough.arm_split)' && message(() => run(arm.d)).includes('along a hand-drawn column x = 32'), JSON.stringify(armCodes));

  // Planted: under trace_parts an author layer with no receipt is refused as under required, naming trace_parts as the demand.
  const bare = fresh('author-bare'); save(bare.d, traced(bare.cfg, []));
  const bareMessage = message(() => run(bare.d));
  say('UNRECEIPTED_AUTHOR_LAYER_REFUSED', bareMessage.startsWith('ASSEMBLE_EDITOR_RECEIPT_MISSING: full:author:hand — ') && bareMessage.includes(`(sha256 ${bare.sha}) carries no editor receipt; config.assemble.editor_receipts.trace_parts is true`), bareMessage || 'accepted');

  // Every refusal at once, in the config's order, so one run names everything.
  const all = fresh('all'); const allc = traced(carve(all.cfg), []);
  asm(allc).patches = [{ name: 'hem', box: [8, 8, 24, 24], alpha: 'silhouette', draw: 'back' }]; (allc.regions as Record<string, unknown>).hem = 'anchor'; save(all.d, allc);
  const allCodes = codes(() => run(all.d));
  say('EVERY_REFUSAL_NAMED_IN_ONE_RUN', JSON.stringify(allCodes) === JSON.stringify(['ASSEMBLE_EDITOR_RECEIPT_MISSING full:author:hand', 'ASSEMBLE_PART_SOURCE part "sleeve" (config.assemble.cuts[0])', 'ASSEMBLE_PART_SOURCE part "hem" (config.assemble.patches[0])']), JSON.stringify(allCodes));

  // The shapes reached only through sections this fixture does not assemble: an alternate set's own cut and a limb's split line; a limb cut at its joint and an edge-traced split are not refused.
  const shape = (extra: Record<string, unknown>): Record<string, unknown> => ({ seethrough: {}, assemble: { editor_receipts: { trace_parts: true, receipts: [] }, plan: [] }, ...extra });
  const altCodes = untracedPartSources(shape({ assemble: { editor_receipts: { trace_parts: true, receipts: [] }, plan: [], alternates: [{ name: 'raised', cuts: [SLEEVE] }] } }) as unknown as AssembleConfig).map(p => `${p.code} ${p.object}`);
  say('ALTERNATE_SET_CARVE_REFUSED', JSON.stringify(altCodes) === JSON.stringify(['ASSEMBLE_PART_SOURCE part "sleeve" (config.assemble.alternates[0].cuts[0], alternate set "raised")']), JSON.stringify(altCodes));
  const limb = (split: unknown) => ({ arm_r: { segments: [{ part: 'upper_r' }, { part: 'lower_r' }], ...(split === undefined ? {} : { split }) } });
  const lineCodes = untracedPartSources(shape({ limbs: limb({ line: [[1, 2], [3, 4], [5, 6]] }) }) as unknown as AssembleConfig);
  const keep = [undefined, { edge: 'painting' }].map(s => untracedPartSources(shape({ limbs: limb(s) }) as unknown as AssembleConfig).length);
  say('LIMB_SPLIT_LINE_REFUSED_JOINT_AND_EDGE_KEPT', lineCodes.length === 1 && `${lineCodes[0].code} ${lineCodes[0].object}` === 'ASSEMBLE_PART_SOURCE limb "arm_r" parts "upper_r", "lower_r" (config.limbs.arm_r.split.line)' && lineCodes[0].detail.startsWith('their pixels are split from the crossing limb\'s along a hand-drawn 3-point line') && keep.every(n => n === 0),
    `line -> ${lineCodes.map(p => p.object).join(' | ')}; joint-only / edge "painting" -> ${keep.join(' / ')} refusal(s)`);
  const off = untracedPartSources({ seethrough: {}, assemble: { editor_receipts: { receipts: [] }, plan: [], cuts: [SLEEVE] } } as unknown as AssembleConfig).length;
  say('UNDECLARED_REFUSES_NOTHING', off === 0, `a cut with trace_parts absent -> ${off} refusal(s)`);

  if (validationConfig !== undefined) {
    const raw = JSON.parse(readFileSync(validationConfig, 'utf8')) as Record<string, unknown>;
    traced(raw, []);
    const clean = untracedPartSources(raw as unknown as AssembleConfig);
    asm(raw).patches = [{ name: 'unreceipted', box: [0, 0, 1, 1], alpha: 'box', draw: 'back' }];
    const planted = untracedPartSources(raw as unknown as AssembleConfig);
    say('PUBLIC_EXAMPLES_TRACE_BUT_SCARF_PATCHES', clean.length === 0 && planted.length === 1 &&
      planted[0].code === 'ASSEMBLE_PART_SOURCE' && planted[0].object === 'part "unreceipted" (config.assemble.patches[0])',
      `validation sample trace: ${clean.length} refusal(s); planted patch: ${planted.map(p => `${p.code} ${p.object}`).join('; ')}`);
  } else {
    // The public examples under trace_parts, read from their configs (no inputs needed: the shapes are config-only):
    // every example but scarf holds no drawn shape; scarf's patches are named, one per patch.
    const examples = readdirSync('examples', { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(join('examples', e.name, 'config.json'))).map(e => e.name).sort();
    const rows = examples.map(name => {
      const raw = JSON.parse(readFileSync(join('examples', name, 'config.json'), 'utf8')) as Record<string, unknown>;
      const patches = ((raw.assemble as Record<string, unknown>).patches as Array<{ name: string }> | undefined) ?? [];
      traced(raw, []);
      const objects = untracedPartSources(raw as unknown as AssembleConfig).map(p => p.object);
      return { name, objects, want: patches.map((p, i) => `part "${p.name}" (config.assemble.patches[${i}])`) };
    });
    const scarf = rows.find(r => r.name === 'scarf');
    say('PUBLIC_EXAMPLES_TRACE_BUT_SCARF_PATCHES', rows.length >= 2 && scarf !== undefined && scarf.want.length > 0 && rows.every(r => JSON.stringify(r.objects) === JSON.stringify(r.want)) && rows.filter(r => r.name !== 'scarf').every(r => r.objects.length === 0),
      rows.map(r => `${r.name} ${r.objects.length}`).join(', '));

  }

  // The loader: trace_parts is a boolean at every door.
  const base = JSON.parse(readFileSync(join(good.d, 'config.json'), 'utf8')) as Record<string, unknown>;
  const bad = JSON.parse(JSON.stringify(base)) as Record<string, unknown>; (asm(bad).editor_receipts as Record<string, unknown>).trace_parts = 'yes';
  const doors = [() => parseEarlyConfig(bad as never, 'assemble'), () => parseEarlyConfig(bad as never, 'layers'), () => parseConfig(bad as never)];
  const hits = doors.map(door => codes(door).includes('CONFIG_FIELD_TYPE config.assemble.editor_receipts.trace_parts'));
  const accepted = [() => parseEarlyConfig(base as never, 'assemble'), () => parseEarlyConfig(base as never, 'layers'), () => parseConfig(base as never)].every(door => codes(door).length === 0);
  say('LOADER_TRACE_PARTS_BOOLEAN', hits.every(Boolean) && accepted, `CONFIG_FIELD_TYPE config.assemble.editor_receipts.trace_parts at assemble/layers/full doors: ${hits.join('/')}; trace_parts true accepted at every door: ${accepted}`);

  // The command line: exit 1 and the refusal line, nothing written.
  const cli = spawnSync(process.execPath, ['cli.ts', 'assemble', '--source', join(cut.d, 'painting.png'), '--full', join(cut.d, 'full'), '--config', join(cut.d, 'config.json'), '--out', join(cut.d, 'cli')], { encoding: 'utf8' });
  say('CLI_EXIT_1_NAMES_THE_PART', cli.status === 1 && `${cli.stdout}${cli.stderr}`.includes('ASSEMBLE_PART_SOURCE: part "sleeve" (config.assemble.cuts[0])') && !existsSync(join(cut.d, 'cli')), `exit ${cli.status}: ${`${cli.stdout}${cli.stderr}`.trim().split('\n')[0]}`);
}
