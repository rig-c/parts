/** Assembly-only controls for #637. No rig compiler, renderer or example build runs here. */
import { runCapOwnershipChecks } from './check_cap_ownership.ts';
import { runSubsetCapChecks } from './check_subset_cap.ts';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assemble, stageFields } from '../src/assemble.ts';
import { assembleStage, type AssembleStageInput, readRuns } from '../src/build.ts';
import { loadConfig } from '../src/config.ts';
import { readParts } from '../src/parts.ts';
import { readPng, writePng } from '../src/raster/png.ts';
import { newMask } from '../src/raster/types.ts';
import { C, NAVY, type RunLayerSpec, writeRun } from '../fixtures/assemble_fixture.ts';
import { writeSubsetCoverFixture } from '../fixtures/subset_cover.ts';

type Say = (name: string, pass: boolean, detail: string) => void;

export function runSubsetCoverChecks(dir: string, say: Say): void {
  const run = (d: string, name: string, extra: Partial<AssembleStageInput> = {}): string => {
    const out = join(d, name);
    const log: string[] = [];
    assembleStage(
      { source: join(d, 'painting.png'), full: join(d, 'full'), head: join(d, 'head'), config: join(d, 'config.json'), seam: 'near-white', project: 'core', ...extra },
      { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, 'recomposite_error_rig.png') },
      (l) => log.push(l),
    );
    writeFileSync(join(out, 'raw.log'), `${log.join('\n')}\n`);
    return out;
  };
  const files = (d: string): string[] => ['parts.json', 'recomposite_rig.png', 'recomposite_error_rig.png', ...readdirSync(join(d, 'parts')).sort().map((f) => `parts/${f}`)];
  const same = (a: string, b: string, fs = files(a)): boolean => fs.every((f) => readFileSync(join(a, f)).equals(readFileSync(join(b, f))));
  const held = (out: string, set: boolean): { px: number; own: number; cover: number; y: number; end: number } => {
    const pf = readParts(join(out, 'parts.json'));
    const rec = (set ? pf.alternates?.[0].records : pf.parts)?.find((r) => r.name === 'thigh');
    if (rec === undefined) throw new Error('synthetic thigh missing');
    const img = readPng(join(out, 'parts', `${set ? 'step_' : ''}thigh.png`));
    let px = 0, own = 0, cover = 0;
    for (let y = 10; y < 22; y++) for (let x = 22; x < 30; x++) {
      if (y >= 15 + x - 22 || x < rec.x || y < rec.y || x >= rec.x + rec.w || y >= rec.y + rec.h) continue;
      const p = ((y - rec.y) * img.width + x - rec.x) * 4;
      if (img.data[p + 3] <= 8) continue;
      px++;
      if (C.every((c, i) => img.data[p + i] === c)) own++;
      if (NAVY.every((c, i) => img.data[p + i] === c)) cover++;
    }
    return { px, own, cover, y: rec.y, end: rec.y + rec.h };
  };
  const d = join(dir, 'covered');
  writeSubsetCoverFixture(d);
  const green = run(d, 'layer');
  const base = held(green, false), step = held(green, true);
  say('UC00_COVERED_SUBSET_LIMB_KEEPS_ITS_OWN_68_PIXELS_TO_THE_BASE_JOINT_LINE',
    step.px === 68 && step.own === 68 && step.cover === 0 && step.y === base.y && step.y === 10 && step.end === base.end && step.end === 30,
    `base ${JSON.stringify(base)}; step ${JSON.stringify(step)}; by hand covered 5+6+...+12 = 68, knee y=30`);
  const mutant = run(d, 'painting', { setCover: 'painting' });
  const cut = held(mutant, true);
  say('UC01_PAINTING_MUTANT_REPRODUCES_THE_DIAGONAL_CUT', cut.px === 0 && cut.y === 15 && step.px === 68,
    `painting mutant ${JSON.stringify(cut)}; fixed ${JSON.stringify(step)}`);
  const seam = held(run(d, 'painting-no-exclusion', { setCover: 'painting', setExclusion: 'none' }), true);
  say('UC02_DISABLING_EXCLUSION_ALONE_STILL_PAINTS_COVER_COLOUR_ON_THE_LIMB',
    seam.px === 68 && seam.cover > 0 && step.cover === 0,
    `painting without exclusion ${JSON.stringify(seam)}; fixed cover-colour px ${step.cover}`);
  const baseFiles = files(green).filter((f) => !f.includes('step_') && f !== 'parts.json');
  const baseRecordsSame = JSON.stringify(readParts(join(green, 'parts.json')).parts) === JSON.stringify(readParts(join(mutant, 'parts.json')).parts);
  say('UC03_BASE_PARTS_ARE_BYTE_IDENTICAL_TO_THE_PAINTING_MUTANT', same(green, mutant, baseFiles) && baseRecordsSame,
    `${baseFiles.length} base files byte-identical ${same(green, mutant, baseFiles)}; base records identical ${baseRecordsSame}`);
  const n = join(dir, 'no-cover'); writeSubsetCoverFixture(n, false);
  const ng = run(n, 'layer'), nm = run(n, 'painting', { setCover: 'painting' });
  say('UC04_SETS_WITHOUT_A_COVER_ARE_BYTE_IDENTICAL', same(ng, nm), `${files(ng).length} files byte-identical ${same(ng, nm)}`);
  const again = run(d, 'again');
  say('UC05_REPEATING_THE_SAME_INPUT_WRITES_THE_SAME_BYTES', same(green, again), `${files(green).length} files byte-identical ${same(green, again)}`);
  const c = join(dir, 'carried-cover'); writeSubsetCoverFixture(c, true, true);
  const cg = run(c, 'layer'), cm = run(c, 'painting', { setCover: 'painting' });
  say('UC06_A_CARRIED_COVER_KEEPS_THE_EXISTING_OWN_LAYER_BYTES', held(cg, true).own === 68 && same(cg, cm),
    `carried cover ${JSON.stringify(held(cg, true))}; ${files(cg).length} files byte-identical ${same(cg, cm)}`);
  const limb: RunLayerSpec = { name: 'legwear', depth: 0.6, rects: [{ x0: 22, y0: 10, x1: 30, y1: 50, colour: C }] };
  const absent = join(dir, 'absent-cover'); writeSubsetCoverFixture(absent); writeRun(join(absent, 'step'), [limb]);
  const ag = run(absent, 'layer'), am = run(absent, 'painting', { setCover: 'painting' });
  say('UC07_A_BASE_FOOTPRINT_WITHOUT_A_SET_COVER_STILL_EXCLUDES', held(ag, true).px === 0 && same(ag, am),
    `no set cover ${JSON.stringify(held(ag, true))}; bytes unchanged ${same(ag, am)}`);
  const behind = join(dir, 'cover-behind'); writeSubsetCoverFixture(behind);
  writeRun(join(behind, 'step'), [{ name: 'bottomwear', depth: 0.8, rects: [{ x0: 22, y0: 8, x1: 30, y1: 22, colour: NAVY }] }, limb]);
  const bg = run(behind, 'layer'), bm = run(behind, 'painting', { setCover: 'painting' });
  say('UC08_A_LAYER_BEHIND_THE_LIMB_IS_NOT_A_COVER', held(bg, true).px === 0 && same(bg, bm),
    `behind layer ${JSON.stringify(held(bg, true))}; bytes unchanged ${same(bg, bm)}`);
  const missing = join(dir, 'missing-limb-art'); writeSubsetCoverFixture(missing);
  writeRun(join(missing, 'step'), [{ ...limb, rects: [{ ...limb.rects[0], y0: 22 }] }, { name: 'bottomwear', depth: 0.4, rects: [{ x0: 22, y0: 8, x1: 30, y1: 22, colour: NAVY }] }]);
  const mg = run(missing, 'layer'), mm = run(missing, 'painting', { setCover: 'painting' });
  say('UC09_NO_LIMB_PIXEL_IS_INVENTED_WHEN_ITS_LAYER_LACKS_THE_ART', held(mg, true).px === 0 && held(mg, true).y === 22 && same(mg, mm),
    `missing own art ${JSON.stringify(held(mg, true))}; bytes unchanged ${same(mg, mm)}`);

  // #609's one-island branch: right shin crosses a standing left leg. The source
  // carries both limbs, but the subset carries only the right one. No build runs.
  const crossing = join(dir, 'crossing'); writeSubsetCoverFixture(crossing);
  writeRun(join(crossing, 'step'), [{ ...limb, rects: [
    { x0: 22, y0: 10, x1: 30, y1: 34, colour: C },
    { x0: 30, y0: 26, x1: 46, y1: 34, colour: C },
    { x0: 34, y0: 10, x1: 42, y1: 50, colour: C },
  ] }, { name: 'bottomwear', depth: 0.4, rects: [{ x0: 22, y0: 10, x1: 30, y1: 15, colour: NAVY }] }]);
  const fields = stageFields(loadConfig(join(crossing, 'config.json')));
  const runs = readRuns(join(crossing, 'step'), join(crossing, 'head'));
  const other = { segments: [{ part: 'other_thigh', from: 'legs', bone: 'leg_l0' }, { part: 'other_shin', from: 'legs', bone: 'leg_l1', joint: 'knee' }] };
  const split = assemble({ ...fields, ...runs, source: readPng(join(crossing, 'painting.png')), plan: [['legs', 'full', 'legwear']], projectRule: 'core', seamRule: 'near-white', limbUnderCover: true,
    bones: [{ name: 'hip', parent: 'root', at: [26, 10] }, { chain: 'leg_r', parent: 'hip', points: [[26, 10], [26, 30]], tip: [46, 30] }, { chain: 'leg_l', parent: 'hip', points: [[38, 10], [38, 30]], tip: [38, 50] }],
    limbIslands: ['legs'], otherLimbs: { limbs: { leg_l: other }, unposed: { leg_l: [] }, baseArt: { leg_l: newMask(64, 64) }, drawOrder: ['other_thigh', 'other_shin', 'thigh', 'shin'], pose: 'skeleton' },
  });
  const thigh = split.images.find((q) => q.record.name === 'thigh');
  const shin = split.images.find((q) => q.record.name === 'shin');
  let lost = 0, under = 0;
  for (const q of split.images) for (let y = 0; y < q.image.height; y++) for (let x = 0; x < q.image.width; x++) {
    const rx = q.record.x + x, ry = q.record.y + y, p = (y * q.image.width + x) * 4;
    if (q.image.data[p + 3] <= 8) continue;
    if (rx >= 34 && rx < 42 && ry >= 34 && ry < 50) lost++;
    if (q === thigh && rx >= 22 && rx < 30 && ry >= 10 && ry < 15 && C.every((c, i) => q.image.data[p + i] === c)) under++;
  }
  say('UC10_COVER_PRESERVATION_COMPOSES_WITH_THE_609_ONE_ISLAND_SPLIT', split.splits.length === 2 && lost === 0 && under === 40 && shin !== undefined,
    `split rows ${split.splits.length}, other standing shin pixels ${lost}, own root pixels ${under} (8x5 by hand)`);
  // The hidden pixels must remain in the source/visibility ledger as occluded art.
  const partial = readParts(join(green, 'parts.json')).alternates?.[0].records.find((q) => q.name === 'thigh');
  say('UC11_HIDDEN_PIXELS_ARE_OCCLUDED_AND_NEVER_COUNTED_AS_PAINTING_PROJECTION',
    partial?.opaque_px === 160 && partial.occluded_px === 68 && partial.visible_px === 92 && (partial.source_px_taken ?? Infinity) <= 92,
    `record ${JSON.stringify(partial)}; covered source pixels are counted as occluded`);
  const visible = run(d, 'visible', { project: 'visible', seam: 'silhouette' });
  say('UC12_BOTH_PUBLIC_PROJECTION_AND_SEAM_RULES_PRESERVE_THE_OWN_LAYER', held(visible, true).own === 68 && held(visible, true).cover === 0,
    `visible/silhouette ${JSON.stringify(held(visible, true))}; core/near-white ${JSON.stringify(step)}; own thigh PNG equal ${readFileSync(join(visible, 'parts/step_thigh.png')).equals(readFileSync(join(green, 'parts/step_thigh.png')))}`);
  const fringe = join(dir, 'cover-fringe'); writeSubsetCoverFixture(fringe);
  const png = join(fringe, 'step', 'parts', 'bottomwear.png');
  const coverImage = readPng(png);
  for (let p = 0; p < coverImage.width * coverImage.height; p++) if (coverImage.data[p * 4 + 3] > 0) coverImage.data[p * 4 + 3] = 128;
  writePng(png, coverImage);
  const fg = run(fringe, 'layer');
  const fm = run(fringe, 'painting', { setCover: 'painting', setExclusion: 'none' });
  say('UC13_A_COVER_BELOW_CORE_ALPHA_STILL_PRESERVES_OWN_LAYER_PIXELS',
    held(fg, true).own === 68 && held(fm, true).own < 68,
    `cover alpha 128: fixed ${JSON.stringify(held(fg, true))}; painting/no-exclusion ${JSON.stringify(held(fm, true))}`);

  runSubsetCapChecks(join(dir, 'caps'), say);
  runCapOwnershipChecks(join(dir, 'cap-ownership'), say);
}
