/** Target ownership of generated source-transparent caps, before preservation. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assemble, stageFields } from '../src/assemble.ts';
import { assembleStage, readRuns, type AssembleStageInput } from '../src/build.ts';
import { loadConfig, parseEarlyConfig, type Limb } from '../src/config.ts';
import { readParts } from '../src/parts.ts';
import { readPng } from '../src/raster/png.ts';
import { newMask } from '../src/raster/types.ts';
import { bonePlaces, inDisc, jointLine, pastJoint, polylineDist2, skeletonLimbJoints, placeBoneEntriesForSkeleton } from '../src/limbs.ts';
import { sourceLimbTarget } from '../src/limbownership.ts';
import { C, writeRun } from '../fixtures/assemble_fixture.ts';
import { writeSubsetCapFixture, writeSubsetCoverFixture } from '../fixtures/subset_cover.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
type Mode = 'near' | 'far' | 'islands' | 'islands-covered' | 'band-front' | 'band-behind';
type JsonConfig = { assemble: { alternates: { parts: string[] }[] }; limbs: Record<string, Limb>; bones: { name?: string; tip?: number[] }[] };

export function runCapOwnershipChecks(dir: string, say: Say): void {
  const fixture = (mode: Mode): string => {
    const d = join(dir, mode); writeSubsetCapFixture(d);
    const cfg = JSON.parse(readFileSync(join(d, 'config.json'), 'utf8')) as JsonConfig;
    cfg.assemble.alternates = cfg.assemble.alternates.slice(0, 1);
    if (mode === 'band-behind') cfg.limbs = { leg_l: cfg.limbs.leg_l, leg_r: cfg.limbs.leg_r };
    writeFileSync(join(d, 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
    const pose = JSON.parse(readFileSync(join(d, 'pose.json'), 'utf8')) as { points: Record<string, number[]> };
    if (mode !== 'far') pose.points.l_ankle = [38, mode.startsWith('band-') ? 36 : 34];
    writeFileSync(join(d, 'pose.json'), JSON.stringify(pose, null, 2) + '\n');
    if (mode.startsWith('islands') || mode.startsWith('band-')) writeRun(join(d, 'step'), [
      { name: 'legwear', depth: 0.6, rects: [{ x0: 22, y0: 10, x1: 30, y1: 34, colour: C }, { x0: 30, y0: 26, x1: 46, y1: 34, colour: C }, { x0: 34, y0: 10, x1: 42, y1: 50, colour: C }] },
      { name: 'footwear', depth: 0.4, rects: [{ x0: 44, y0: 28, x1: 56, y1: 34, colour: C }, { x0: 36, y0: 48, x1: 48, y1: 54, colour: C }] },
    ]);
    if (mode === 'islands-covered') writeRun(join(d, 'full'), [
      { name: 'legwear', depth: 0.6, rects: [{ x0: 22, y0: 10, x1: 30, y1: 50, colour: C }, { x0: 34, y0: 10, x1: 44, y1: 50, colour: C }] },
      { name: 'footwear', depth: 0.4, rects: [{ x0: 24, y0: 48, x1: 48, y1: 54, colour: C }] },
    ]);
    loadConfig(join(d, 'config.json')); parseEarlyConfig(cfg, 'assemble');
    return d;
  };
  const run = (d: string, name: string, extra: Partial<AssembleStageInput> = {}): string => {
    const out = join(d, name), logs: string[] = [];
    assembleStage({ source: join(d, 'painting.png'), full: join(d, 'full'), head: join(d, 'head'), config: join(d, 'config.json'), seam: 'near-white', project: 'core', ...extra },
      { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, 'recomposite_error_rig.png') }, (l) => logs.push(l));
    writeFileSync(join(out, 'raw.log'), logs.join('\n') + '\n'); return out;
  };
  const piece = (out: string, name = 'foot_r', base = false) => {
    const pf = readParts(join(out, 'parts.json'));
    const rec = (base ? pf.parts : pf.alternates?.[0].records)?.find((p) => p.name === name);
    if (rec === undefined) throw Error(`missing generated ${name}`);
    return { rec, image: readPng(join(out, 'parts', `${base ? '' : 'step_r_'}${name}.png`)) };
  };
  const alpha = (p: ReturnType<typeof piece>, x: number, y: number): number => x < p.rec.x || y < p.rec.y || x >= p.rec.x + p.rec.w || y >= p.rec.y + p.rec.h ? 0 : p.image.data[((y - p.rec.y) * p.image.width + x - p.rec.x) * 4 + 3];
  const held = (p: ReturnType<typeof piece>, box: number[]): number => { let n = 0; for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) if (alpha(p, x, y) > 8) n++; return n; };
  const rows = (['near', 'far', 'islands', 'islands-covered'] as const).map((mode) => {
    const d = fixture(mode), fixed = run(d, 'target'), mutant = run(d, 'unassigned', { setCapOwnership: 'source' });
    const g = piece(fixed), m = piece(mutant), cap = m.rec.limb?.cap;
    if (cap === undefined) throw Error('generated cap missing');
    const lower = readPng(join(d, 'step', 'parts', 'footwear.png'));
    const otherY = mode === 'far' ? 50 : 34;
    const ownFull: [number, number][] = [[26, 10], [26, 30], [46, 30], [54, 30]];
    const otherFull: [number, number][] = [[38, 10], [38, 30], [38, otherY], [46, otherY]];
    let before = 0, after = 0;
    for (let y = cap.box[1]; y < cap.box[1] + cap.box[3]; y++) for (let x = cap.box[0]; x < cap.box[0] + cap.box[2]; x++) {
      const lx = x - 36, ly = y - 28;
      const src = lx < 0 || ly < 0 || lx >= lower.width || ly >= lower.height ? 0 : lower.data[(ly * lower.width + lx) * 4 + 3];
      if (src !== 0 || alpha(m, x, y) === 0) continue;
      const fullMargin = Math.sqrt(polylineDist2(ownFull, x + .5, y + .5)) - Math.sqrt(polylineDist2(otherFull, x + .5, y + .5));
      const footMargin = Math.sqrt(polylineDist2([[46, 30], [54, 30]], x + .5, y + .5)) - Math.sqrt(polylineDist2([[38, otherY], [46, otherY]], x + .5, y + .5));
      if (fullMargin <= .5 || footMargin <= .5) continue;
      const covered = ['foot_l', 'shin_l', 'thigh_l'].some((n) => alpha(piece(mutant, n, true), x, y) > 8);
      if (mode !== 'islands' && !covered) continue;
      before++; if (alpha(g, x, y) > 0) after++;
    }
    return { mode, d, fixed, mutant, g, m, before, after };
  });
  for (const [i, row] of rows.entries()) {
    const expected = [95, 19, 1, 1][i];
    say(`UC${26 + i}_TARGET_CAP_OWNERSHIP_${row.mode.toUpperCase().replaceAll('-', '_')}_KILLS_THE_UNASSIGNED_MUTANT`, row.before === expected && row.after === 0,
      `${row.mode}: unassigned foreign ${row.before}/${expected}; target foreign ${row.after}; both config doors accepted`);
  }
  const far = rows[1];
  say('UC30_TARGET_OWNERSHIP_RETAINS_THE_VALID_BRIDGE_64_AND_END_16', held(far.g, [34, 26, 42, 34]) === 64 && held(far.g, [32, 26, 34, 34]) === 16,
    `bridge ${held(far.g, [34, 26, 42, 34])}/64; end ${held(far.g, [32, 26, 34, 34])}/16`);
  const allBaseSame = rows.every((r) => {
    const a = readParts(join(r.fixed, 'parts.json')), b = readParts(join(r.mutant, 'parts.json'));
    return JSON.stringify(a.parts) === JSON.stringify(b.parts) && a.parts.every((p) => readFileSync(join(r.fixed, 'parts', `${p.name}.png`)).equals(readFileSync(join(r.mutant, 'parts', `${p.name}.png`))));
  });
  say('UC31_CAP_ASSIGNMENT_LEAVES_BASE_BYTES_AND_SOURCE_ISLAND_SELECTION_UNCHANGED', allBaseSame && rows.slice(2).every((r) => {
    const lines = (p: string): string => readFileSync(join(p, 'raw.log'), 'utf8').split('\n').filter((l) => l.includes('foot_r: shoes holds 2 islands')).join('\n');
    return lines(r.fixed) !== '' && lines(r.fixed) === lines(r.mutant);
  }), `base records/PNGs in ${rows.length} cases; source island selection logs in both island cases`);
  let ledger = true, subset = true;
  for (const r of rows) {
    const cap = r.g.rec.limb?.cap, line = jointLine([26, 30], [46, 30], [54, 30]);
    if (cap === undefined || line === null) throw Error('generated cap geometry missing');
    let capPixels = 0;
    for (let y = cap.box[1]; y < cap.box[1] + cap.box[3]; y++) for (let x = cap.box[0]; x < cap.box[0] + cap.box[2]; x++) {
      if (inDisc(cap.at, cap.radius, x, y) && !pastJoint(line, x, y) && alpha(r.g, x, y) > 0) capPixels++;
    }
    ledger &&= capPixels === cap.layer_px + (cap.image_px ?? 0) + (cap.upper_px ?? 0);
    for (let y = r.g.rec.y; y < r.g.rec.y + r.g.rec.h; y++) for (let x = r.g.rec.x; x < r.g.rec.x + r.g.rec.w; x++) if (alpha(r.g, x, y) > 0 && alpha(r.m, x, y) === 0) subset = false;
  }
  // A direct caller need not enable cover protection to receive coherent cap counts.
  const df = stageFields(loadConfig(join(far.d, 'config.json'))), all = df.limbs as Record<string, Limb>;
  const pose = JSON.parse(readFileSync(join(far.d, 'pose.json'), 'utf8')) as { points: Parameters<typeof skeletonLimbJoints>[0] };
  const joints = skeletonLimbJoints(pose.points), placed = placeBoneEntriesForSkeleton(df.bones ?? [], new Set(joints.map(([b]) => b)), joints, {});
  const directCounted = assemble({ ...df, ...readRuns(join(far.d, 'step'), join(far.d, 'head')), source: readPng(join(far.d, 'painting.png')), bones: placed, limbs: { leg_r: all.leg_r }, seamRule: 'near-white', projectRule: 'core', limbIslands: ['legs', 'shoes'],
    otherLimbs: { limbs: { leg_l: all.leg_l }, unposed: { leg_l: [] }, baseArt: {}, drawOrder: ['foot_r', 'shin_r', 'thigh_r', 'foot_l', 'shin_l', 'thigh_l'], pose: 'skeleton' } });
  const dp = directCounted.images.find((p) => p.record.name === 'foot_r');
  if (dp?.record.limb?.cap === undefined) throw Error('direct cap missing');
  const dc = dp.record.limb.cap, dl = jointLine([26, 30], [46, 30], [54, 30]);
  if (dl === null) throw Error('direct cap line missing');
  let directPixels = 0;
  for (let y = dc.box[1]; y < dc.box[1] + dc.box[3]; y++) for (let x = dc.box[0]; x < dc.box[0] + dc.box[2]; x++) {
    if (inDisc(dc.at, dc.radius, x, y) && !pastJoint(dl, x, y) && alpha({ rec: dp.record, image: dp.image }, x, y) > 0) directPixels++;
  }
  const directKept = dc.layer_px + (dc.upper_px ?? 0) + (dc.image_px ?? 0);
  ledger &&= directPixels === directKept && directKept + (dc.excluded_px ?? 0) === 244;
  // Same-source caps have no live source-transparent candidates. Source-art
  // assignment still removes cap pixels, so an empty capSplits is not a recount gate.
  const zd = join(dir, 'source-art-cap'); writeSubsetCoverFixture(zd, false);
  const zc = JSON.parse(readFileSync(join(zd, 'config.json'), 'utf8')) as { bones: object[]; limbs: Record<string, Limb>; regions: Record<string, string> };
  zc.bones.push({ chain: 'leg_l', parent: 'hip', points: [[38, 10], [38, 30]], tip: [38, 50] });
  zc.limbs.leg_l = { segments: [{ part: 'thigh_l', from: 'legs', bone: 'leg_l0' }, { part: 'shin_l', from: 'legs', bone: 'leg_l1', joint: 'knee' }] };
  zc.regions.thigh_l = 'leg_l0'; zc.regions.shin_l = 'leg_l1';
  writeFileSync(join(zd, 'config.json'), JSON.stringify(zc, null, 2) + '\n');
  writeRun(join(zd, 'step'), [{ name: 'legwear', depth: 0.6, rects: [[22, 10, 30, 50], [34, 10, 42, 50], [30, 26, 34, 34]].map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1, colour: C })) }]);
  const zf = stageFields(loadConfig(join(zd, 'config.json'))), zl = zf.limbs as Record<string, Limb>;
  const zi = { ...zf, ...readRuns(join(zd, 'step'), join(zd, 'head')), source: readPng(join(zd, 'painting.png')), limbs: { leg_r: zl.leg_r }, limbIslands: ['legs'], seamRule: 'near-white' as const, projectRule: 'core' as const,
    otherLimbs: { limbs: { leg_l: zl.leg_l }, unposed: { leg_l: [] }, baseArt: {}, drawOrder: ['shin', 'thigh', 'shin_l', 'thigh_l'], pose: 'none' as const } };
  const zr = [assemble(zi), assemble({ ...zi, capOwnership: 'target' }), assemble({ ...zi, capOwnership: 'source' }), assemble({ ...zi, capOwnership: 'source', limbUnderCover: true })];
  const zline = jointLine([26, 10], [26, 30], [26, 50]);
  if (zline === null) throw Error('source-art cap line missing');
  const zs = zr.map((a) => {
    const p = a.images.find((q) => q.record.name === 'shin'), cap = p?.record.limb?.cap;
    if (p === undefined || cap === undefined) throw Error('source-art cap missing');
    let live = 0, transparent = 0, original = 0;
    for (let y = cap.box[1]; y < cap.box[1] + cap.box[3]; y++) for (let x = cap.box[0]; x < cap.box[0] + cap.box[2]; x++) {
      if (!inDisc(cap.at, cap.radius, x, y) || pastJoint(zline, x, y)) continue;
      const source = (x >= 22 && x < 30 && y >= 10 && y < 50) || (x >= 34 && x < 42 && y >= 10 && y < 50) || (x >= 30 && x < 34 && y >= 26 && y < 34);
      if (source) original++;
      if (alpha({ rec: p.record, image: p.image }, x, y) > 0) { live++; if (!source) transparent++; }
    }
    return { live, transparent, original, kept: cap.layer_px + (cap.upper_px ?? 0) + (cap.image_px ?? 0), removed: cap.excluded_px ?? 0, image: p.image };
  });
  const samePixels = zs.every((q) => Buffer.from(q.image.data).equals(Buffer.from(zs[0].image.data)));
  // Foreign source-cap pixels: x=34 at y=25; x=32..34 at y=26;
  // x=32..35 at y=27..29. The disc and source rectangles give 1+3+3*4.
  const sourceCapRemoved = 1 + 3 + 3 * 4;
  const zeroCandidates = zr.every((q) => q.capSplits.length === 0) && zs.every((q) => q.transparent === 0 && q.live === q.original - sourceCapRemoved) && samePixels;
  ledger &&= zeroCandidates && [0, 1, 3].every((i) => zs[i].kept === zs[i].live && zs[i].kept + zs[i].removed === zs[i].original)
    && zs[2].kept === zs[2].original && zs[2].kept !== zs[2].live && zs[2].removed === 0;
  say('UC32_TARGET_CAP_RECORDS_COUNT_THE_ACTUAL_PNG', ledger, `${rows.length} stage caps plus direct PNG/record ${directPixels}/${directKept}, removed ${dc.excluded_px ?? 0}; zero transparent candidates/capSplits ${zeroCandidates}, source-art PNG/record default ${zs[0].live}/${zs[0].kept}, explicit target ${zs[1].live}/${zs[1].kept}, legacy ${zs[2].live}/${zs[2].kept}, protected source ${zs[3].live}/${zs[3].kept}; removed ${zs[0].removed}/${sourceCapRemoved}, pixels identical ${samePixels}`);
  say('UC33_CAP_ASSIGNMENT_NEVER_RESURRECTS_AN_ALREADY_CLEARED_PIXEL', subset, `${rows.length} assigned foot pixel sets are subsets of their unassigned mutants`);
  const front = run(fixture('band-front'), 'target'), behind = run(fixture('band-behind'), 'target');
  say('UC34_CAP_OVERLAP_BAND_USES_THE_EXISTING_DRAW_ORDER', alpha(piece(front), 43, 32) === 0 && alpha(piece(behind), 43, 32) > 0,
    `point 43,32; other later alpha ${alpha(piece(front), 43, 32)}; own later alpha ${alpha(piece(behind), 43, 32)}; supplied feet y=30/36`);
  const missing = join(dir, 'missing-end'); writeSubsetCapFixture(missing);
  const cfg = JSON.parse(readFileSync(join(missing, 'config.json'), 'utf8')) as JsonConfig;
  cfg.assemble.alternates = cfg.assemble.alternates.slice(0, 1); delete cfg.bones.find((b) => b.name === 'foot_r')?.tip;
  writeFileSync(join(missing, 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
  let refusal = ''; try { run(missing, 'out'); } catch (e) { refusal = String(e); }
  say('UC35_CAP_TARGET_WITHOUT_A_SUPPLIED_ENDPOINT_IS_REFUSED_BY_NAME', refusal.includes('ASSEMBLE_ALT_LIMB_POSE') && (refusal.includes('no supplied end') || refusal.includes('no tip')) && refusal.includes('foot_r'), refusal);

  // The island door can be exercised without a posed other limb in a direct validated-data call.
  const f = stageFields(loadConfig(join(rows[2].d, 'config.json'))), limbs = f.limbs as Record<string, Limb>;
  const bones = (f.bones ?? []).map((b) => 'chain' in b && b.chain === 'leg_r' ? { ...b, tip: [46, 30] as [number, number] } : 'chain' in b && b.chain === 'leg_l' ? { ...b, tip: [38, 34] as [number, number] } : 'name' in b && b.name === 'foot_r' ? { ...b, at: [46, 30] as [number, number], tip: [54, 30] as [number, number] } : 'name' in b && b.name === 'foot_l' ? { ...b, at: [38, 34] as [number, number], tip: [46, 34] as [number, number] } : b);
  const direct = (overlap: boolean) => {
    const art = newMask(64, 64); if (overlap) art.data[32 * 64 + 43] = 1;
    return assemble({ ...f, ...readRuns(join(rows[2].d, 'step'), join(rows[2].d, 'head')), source: readPng(join(rows[2].d, 'painting.png')), bones, limbs: { leg_r: limbs.leg_r }, seamRule: 'near-white', projectRule: 'core', limbUnderCover: true, limbIslands: ['shoes'],
      otherLimbs: { limbs: { leg_l: limbs.leg_l }, unposed: { leg_l: ['foot_l'] }, baseArt: { leg_l: art }, drawOrder: ['foot_r', 'shin_r', 'thigh_r', 'foot_l', 'shin_l', 'thigh_l'], pose: 'none' } });
  };
  let unposed = ''; try { direct(true); } catch (e) { unposed = String(e); }
  say('UC36_UNPOSED_OTHER_LIMB_OVER_CAP_ART_REQUIRES_A_NAMED_POSE', unposed.includes('ASSEMBLE_ALT_LIMB_POSE') && unposed.includes('source-transparent cap') && unposed.includes('foot_l'), unposed);
  const compatible = direct(false);
  say('UC37_UNPOSED_OTHER_WITHOUT_BASE_ART_OVERLAP_RETAINS_THE_EXISTING_PATH', compatible.capSplits.length === 0 && compatible.images.some((p) => p.record.name === 'foot_r'), `no fabricated other endpoint; cap assignment rows ${compatible.capSplits.length}`);
  const places = bonePlaces(bones), foot = sourceLimbTarget(limbs.leg_r, 'shoes', places);
  say('UC38_SOURCE_TARGET_USES_ONLY_ITS_SOURCE_SEGMENTS_AND_SUPPLIED_TIP', JSON.stringify(foot.line) === JSON.stringify([[46, 30], [54, 30]]) && foot.segments.length === 1 && foot.missingEndBone === null, JSON.stringify(foot));
}
