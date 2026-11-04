/** Real assemble -> propose regression probe for #412; baseline mode is explicit. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { dressHipJoints, DRESS_RIG } from '../fixtures/cloth.ts';
import { namedCutParts, writeNamedCutFixture } from '../fixtures/named_cut_skirt.ts';
import { writeProposeFixture } from '../fixtures/propose.ts';
import type { ClothRecipes } from '../src/cloth.ts';
import { parseConfig } from '../src/config.ts';
import { buildRig, rigJsonText } from '../src/rig.ts';
import { withAnimations } from '../src/motion.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { attachmentPoses, packageRigc } from '../src/check.ts';
import { displacementOf } from '../src/requirements.ts';
import { cropToSpineY } from '../src/coords.ts';
import { PartsError, problemLine } from '../src/errors.ts';
import { readPng } from '../src/raster/png.ts';
import { checkProposal, DEFAULT_GRID_RULE, propose, readPartSet, serializeProposal, type Proposal, proposalAssemble, PROPOSAL_CONFIG_SECTIONS } from '../src/propose.ts';

/** The same controls run standalone and in the canonical propose suite. */
export function runNamedCutSkirtChecks(dir: string, report: (name: string, ok: boolean, detail: string) => void, baseline = false): void {
  mkdirSync(dir, { recursive: true });
  let sequence = 0;
  const passed = (detail: string): void => report(`NC${String(++sequence).padStart(2, '0')}`, true, detail);
  const recipe = (part?: string): ClothRecipes => ({ bottomwear: { chains: 2, links: 2, wind: [1, 4], gravity: [2, 8], ...(part === undefined ? {} : { part }) } });
  const draft = (out: string, part?: string, withRecipe = true): Proposal => {
    const set = readPartSet(out);
    const proposal = propose(set, dressHipJoints(), null, DEFAULT_GRID_RULE, withRecipe ? recipe(part) : null, true, { noBust: 'historical fixture: no bust landmarks recorded' });
    checkProposal(set, proposal);
    return proposal;
  };
  const refuse = (label: string, fn: () => unknown, code: string, detail: string): void => {
    let caught: PartsError | undefined;
    try { fn(); } catch (error) { if (!(error instanceof PartsError)) throw error; caught = error; }
    assert(caught, `${label}: expected ${code}`);
    assert.equal(caught.problems.length, 1, label);
    assert.equal(caught.problems[0].code, code, label);
    if (code === 'PROPOSE_CLOTH_PART') assert.equal(caught.problems[0].object, 'config.cloth."bottomwear".part');
    assert(caught.problems[0].detail.includes(detail), label);
    passed(`EXPECTED_REFUSAL ${label}: ${problemLine(caught.problems[0])}`);
  };
  const skirts = (p: Proposal) => p.bones.filter((b) => 'chain' in b && b.chain.startsWith('skirt'));
  const physics = (p: Proposal) => (p.constraints ?? []).filter((c) => c.type === 'physics');
  const save = (name: string, p: Proposal): void => writeFileSync(join(dir, name + '.proposal.json'), serializeProposal(p));
  const hash = (p: Proposal) => createHash('sha256').update(serializeProposal(p)).digest('hex');
  const full = writeNamedCutFixture(join(dir, 'full'), { cut: false });
  const canonical = join(dir, 'canonical');
  writeProposeFixture(canonical, namedCutParts(), DRESS_RIG);
  // Independent public proposal fixture has the same masks; actual assemble may
  // change colour/projection counts, neither is a reason to change a proposal.
  for (const part of [undefined, 'dress']) {
    const actual = draft(full.out, part, part !== undefined);
    const expected = draft(canonical, part, part !== undefined);
    assert.equal(serializeProposal(actual), serializeProposal(expected));
    passed(`PASS no-field/full-dress canonical byte baseline part=${part ?? '<absent>'} sha256=${hash(actual)}`);
    save(part === undefined ? 'no-field' : 'full-dress', actual);
  }
  const whole = draft(full.out, 'dress');
  assert.deepEqual(skirts(whole), [
    { chain: 'skirt0_', parent: 'hip', points: [[105, 184], [94, 252]], tip: [94, 286] },
    { chain: 'skirt1_', parent: 'hip', points: [[134, 184], [145, 252]], tip: [145, 286] },
  ]);
  assert.equal(physics(whole).length, 4);
  passed('PASS full-dress: exact two trees/four physics; checkProposal green');

  for (const hem of ['overlap', 'below'] as const) {
    const fixture = writeNamedCutFixture(join(dir, `full-${hem}`), { cut: false, hem });
    const p = draft(fixture.out, 'dress');
    save(`full-${hem}`, p);
    if (hem === 'overlap') {
      assert.equal(skirts(p).length, 2); assert.equal(physics(p).length, 4);
      assert.deepEqual(p.meshes.hem.segments, ['skirt0_1', 'skirt1_1']);
      assert(p.notes.some((n) => n.includes('2080 of its 2912 px lie over dress') && n.includes('skirt0_1 1040, skirt1_1 1040 px')));
    } else { assert.equal(skirts(p).length, 4); assert.equal(physics(p).length, 8); assert(!p.notes.some((n) => n.includes('lies on the trees'))); }
    passed(`PASS full-dress #416 ${hem}: ${skirts(p).length} trees/${physics(p).length} physics; ${JSON.stringify(p.meshes.hem.segments)}`);
  }

  refuse('full-recipe-no-part', () => draft(full.out), 'PROPOSE_CLOTH_DRAFTED', 'bottomwear');
  const pending: string[] = [];
  for (const draw of ['front', 'back'] as const) {
    const cut = writeNamedCutFixture(join(dir, `cut-${draw}`), { draw });
    const set = readPartSet(cut.out);
    const base = set.recs.find((r) => r.name === 'dress');
    const lower = set.recs.find((r) => r.name === 'skirt_piece');
    assert(base && lower);
    assert.deepEqual([base.x, base.y, base.w, base.h, base.opaque_px], [96, 100, 48, 70, 3360]);
    assert.deepEqual([lower.x, lower.y, lower.w, lower.h, lower.opaque_px], [68, 170, 104, 120, 9760]);
    assert.equal(lower.cut_from, 'dress'); assert.equal(lower.from, 'full:topwear');
    const pixels = (name: string): Set<number> => {
      const r = set.recs.find((p) => p.name === name); assert(r);
      const png = readPng(join(cut.out, 'parts', name + '.png'));
      const mask = new Set<number>();
      for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) if (png.data[(y * png.width + x) * 4 + 3] > 8) mask.add((r.y + y) * 240 + r.x + x);
      return mask;
    };
    const upperPixels = pixels('dress'); const lowerPixels = pixels('skirt_piece');
    assert.equal(upperPixels.size, 3360); assert.equal(lowerPixels.size, 9760);
    assert.equal([...upperPixels].filter((v) => lowerPixels.has(v)).length, 0);
    assert.equal(new Set([...upperPixels, ...lowerPixels]).size, 13120);
    passed(`PASS real-cut ${draw}: PNG alpha 13120 = 3360 + 9760, intersection 0; order=${set.recs.map((r) => r.name).join(',')}`);
    refuse(`typo-${draw}`, () => draft(cut.out, 'skirt_peice'), 'PROPOSE_CLOTH_PART', 'names "skirt_peice", which is no part');
    refuse(`wrong-role-${draw}`, () => draft(cut.out, 'face'), 'PROPOSE_CLOTH_PART', 'names "face", from head:face');
    save(`cut-${draw}-no-cloth`, draft(cut.out, undefined, false));
    refuse(`cut-no-part-${draw}`, () => draft(cut.out), 'PROPOSE_CLOTH_DRAFTED', 'bottomwear');
    if (baseline) {
      refuse(`valid-cut-${draw}`, () => draft(cut.out, 'skirt_piece'), 'PROPOSE_CLOTH_PART', 'names "skirt_piece", a piece an assemble.cuts entry took from dress');
      pending.push(`cut-${draw}`);
    } else {
      const p = draft(cut.out, 'skirt_piece');
      assert.deepEqual(skirts(p), skirts(whole)); assert.equal(physics(p).length, 4);
      assert(p.meshes.skirt_piece);
      assert.deepEqual(p.meshes.skirt_piece.segments.filter((s) => typeof s === 'string'), ['skirt0_', 'skirt1_']);
      assert(p.meshes.skirt_piece.segments.some((s) => typeof s !== 'string' && s[0] === 'hip'));
      assert(!JSON.stringify(p.meshes.skirt_piece.segments).includes('chest'));
      assert(JSON.stringify(p.meshes.dress ?? p.regions.dress).includes('chest'));
      assert(!JSON.stringify(p.meshes.dress ?? p.regions.dress).includes('skirt'));
      assert(!p.bones.some((b) => 'chain' in b && b.chain.startsWith('robe')));
      save(`cut-${draw}`, p);
      passed(`PASS named cut ${draw}: exact full-dress skirt trees; lower excludes chest; retained upper excludes skirt/robe`);
    }
  }
  for (const hem of ['overlap', 'below'] as const) {
    const fixture = writeNamedCutFixture(join(dir, `cut-${hem}`), { hem });
    if (baseline) {
      refuse(`valid-cut-${hem}`, () => draft(fixture.out, 'skirt_piece'), 'PROPOSE_CLOTH_PART', 'names "skirt_piece", a piece an assemble.cuts entry took from dress');
      pending.push(`cut-${hem}`);
    } else {
      const p = draft(fixture.out, 'skirt_piece');
      if (hem === 'overlap') {
        assert.deepEqual(skirts(p), skirts(whole)); assert.equal(physics(p).length, 4);
        assert.deepEqual(p.meshes.hem.segments, ['skirt0_1', 'skirt1_1']);
        assert(p.notes.some((n) => n.startsWith('hem (full:bottomwear): lies on the trees of skirt_piece') && n.includes('2080 of its 2912 px') && n.includes('skirt0_1 1040, skirt1_1 1040 px')));
      } else { assert.equal(skirts(p).length, 4); assert.equal(physics(p).length, 8); assert(!p.notes.some((n) => n.includes('lies on the trees'))); }
      save(`cut-${hem}`, p);
      passed(`PASS named cut #416 ${hem}: ${skirts(p).length} trees/${physics(p).length} physics`);
    }
  }
  if (!baseline) {
    const extra = writeNamedCutFixture(join(dir, 'cut-extra'), { extraCut: true });
    const p = draft(extra.out, 'skirt_piece');
    assert.deepEqual(skirts(p), skirts(whole));
    assert(p.regions.neck_piece && !p.meshes.neck_piece, 'an unnamed cut retains the existing nearest-trunk region fallback');
    assert(!p.bones.some((b) => 'chain' in b && b.chain.startsWith('robe')));
    refuse('too-short-cut', () => draft(extra.out, 'neck_piece'), 'PROPOSE_CLOTH_PART', 'names "neck_piece", whose box ends at y=110');
    refuse('wrong-role-cut', () => draft(extra.out, 'leg_piece'), 'PROPOSE_CLOTH_PART', 'names "leg_piece", from full:legwear');
    passed('extra unnamed cut: no automatic cloth/robe trees; short named cut refused');
    runNamedCutPoseChecks(dir, passed);
  }
  writeFileSync(join(dir, 'result.json'), JSON.stringify({ mode: baseline ? 'CURRENT_REFUSAL_BASELINE' : 'NAMED_CUT_ACCEPTANCE', pending, scope: baseline ? 'before-control: named cut refused' : 'real assemble/propose, production core gate and actual posed attachment geometry' }, null, 2) + '\n');
}

/** Measure actual published-core geometry, independently of the proposed segment names. */
function runNamedCutPoseChecks(out: string, passed: (detail: string) => void): void {
  const root = resolve(import.meta.dir, '..');
  function scenario(label: string, cut: boolean, degrees: number) {
    const dir = join(out, label); mkdirSync(dir, { recursive: true });
    const fixture = writeNamedCutFixture(join(dir, 'input'), { cut });
    const set = readPartSet(fixture.out);
    const proposal = propose(set, dressHipJoints(), null, DEFAULT_GRID_RULE, {
      bottomwear: { chains: 2, links: 2, wind: [1, 4], gravity: [2, 8], part: cut ? 'skirt_piece' : 'dress' },
    }, true, { noBust: 'historical fixture: no bust landmarks recorded' });
    checkProposal(set, proposal);
    const sections = Object.fromEntries(PROPOSAL_CONFIG_SECTIONS.filter((k) => proposal[k] !== undefined).map((k) => [k, proposal[k]]));
    const cfg = parseConfig({ key: 'named-cut-poser', assemble: proposalAssemble(set), ...sections });
    const rig = buildRig(cfg, fixture.result.parts, set.images);
    const tree = proposal.bones.find((b) => 'chain' in b && b.chain.startsWith('skirt'));
    assert(tree && 'chain' in tree);
    const last = tree.chain + (tree.points.length - 1);
    const driver = (name: string) => rig.rig.bones.some((b) => b.name === name + '_ctl') ? name + '_ctl' : name;
    const chest = driver('chest'), skirt = driver(last);
    mkdirSync(join(dir, 'images'), { recursive: true });
    for (const [name, image] of rig.images) writeFileSync(join(dir, 'images', name), encodePngBytes(image));
    writeFileSync(join(dir, 'rig.json'), rigJsonText(rig.rig));
    writeFileSync(join(dir, 'proposal.json'), serializeProposal(proposal));
    const stimulus = (bone: string, value: number) => ({ duration: 0, tracks: [{ bone, property: 'rotate', keys: [{ t: 0, v: [value] }] }] });
    const animations = { rest_probe: stimulus(chest, 0), chest_probe: stimulus(chest, degrees), skirt_probe: stimulus(skirt, degrees) };
    writeFileSync(join(dir, 'motion.json'), rigJsonText(withAnimations(rig.motion, animations)));
    function run(args: string[], log: string): void {
      const cmd = packageRigc(root);
      const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
      writeFileSync(join(dir, log + '.stdout'), result.stdout ?? '');
      writeFileSync(join(dir, log + '.stderr'), result.stderr ?? '');
      assert.equal(result.status, 0, `${label}/${log}: production gate/renderer: ${result.stdout}\n${result.stderr}`);
    }
    run(['build', '--rig', join(dir, 'rig.json'), '--motion', join(dir, 'motion.json'), '--out', join(dir, 'build'), '--profile', 'rig-play', '--pack'], 'build');
    const poses = new Map<string, ReturnType<typeof attachmentPoses>[number]>();
    for (const animation of Object.keys(animations)) {
      const render = join(dir, animation);
      run(['render', '--candidate', join(dir, 'build'), '--animation', animation, '--fps', '1', '--max', '240', '--geometry', '--out', render], animation);
      const index = JSON.parse(readFileSync(join(render, 'frames.json'), 'utf8')) as { sets: Array<{ animation: string; dir: string; written: number }> };
      const frame = index.sets.find((f) => f.animation === animation); assert(frame && frame.written > 0);
      const path = join(render, frame.dir, 'geometry.json');
      const geometry = JSON.parse(readFileSync(path, 'utf8')) as { frames: Array<{ time: number }> };
      assert.equal(geometry.frames[0].time, 0);
      poses.set(animation, attachmentPoses(path, frame.written)[0]);
    }
    const rows = ['upper', 'lower'].map((band) => {
      const part = cut && band === 'lower' ? 'skirt_piece' : 'dress';
      const rest = poses.get('rest_probe')?.get(part); assert(rest && rest.triangles.length > 0);
      const used = [...new Set(rest.triangles)];
      const indices = used.filter((i) => {
        if (cut) return true; // Every drawn vertex of each separate attachment is measured.
        const y = cropToSpineY(rest.rest[2 * i + 1], DRESS_RIG.h);
        return band === 'upper' ? y >= 100 && y < 160 : y >= 250 && y < 290;
      });
      assert(indices.length > 0, `${part}/${band}: nonempty drawn geometry required`);
      // Every opaque source pixel must lie in the actual rest triangles: an empty,
      // displaced or partial attachment cannot pass by choosing a convenient subset.
      const record = set.recs.find((p) => p.name === part); assert(record);
      const image = set.images.get(part); assert(image);
      const at = displacementOf(rest);
      let art = 0, covered = 0;
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        if (image.data[(y * image.width + x) * 4 + 3] <= 8) continue;
        art++;
        if (at([record.x + x + 0.5 - DRESS_RIG.w / 2, cropToSpineY(record.y + y + 0.5, DRESS_RIG.h)]) !== null) covered++;
      }
      assert(art > 0); assert.equal(covered, art, `${part}: every opaque pixel covered by real triangles`);
      const displacement = (animation: string): number => {
        const target = poses.get(animation)?.get(part); assert(target);
        assert.deepEqual(target.rest, rest.rest); assert.deepEqual(target.triangles, rest.triangles);
        return Math.max(...indices.map((i) => Math.hypot(target.posed[2 * i] - rest.posed[2 * i], target.posed[2 * i + 1] - rest.posed[2 * i + 1])));
      };
      return { band, part, vertices: indices.length, triangles: rest.triangles.length / 3, art, covered, chest: displacement('chest_probe'), skirt: displacement('skirt_probe') };
    });
    const upper = rows[0], lower = rows[1];
    const separates = upper.chest > 0 && upper.skirt === 0 && lower.skirt > 0 && lower.chest === 0;
    const measurement = { label, cut, degrees, chest, skirt, rows, separates };
    writeFileSync(join(dir, 'measurement.json'), JSON.stringify(measurement, null, 2) + '\n');
    return measurement;
  }
  const whole = scenario('pose-full-dress', false, 15);
  assert(whole.separates, 'existing full-dress control separates its upper/lower art');
  passed(`actual full-dress positive: ${JSON.stringify(whole)}`);
  const cut = scenario('pose-named-cut', true, 15);
  assert(cut.separates, 'named-cut attachments must separate chest and skirt responses');
  passed(`actual named-cut positive: ${JSON.stringify(cut)}`);
  const zero = scenario('pose-no-op-negative', true, 0);
  assert(!zero.separates && zero.rows.every((r) => r.chest === 0 && r.skirt === 0), 'real zero-stimulus build must fail separation');
  passed(`actual no-op negative: ${JSON.stringify(zero)}`);
}

if (import.meta.main) {
  const at = process.argv.indexOf('--out');
  const dir = at < 0 ? mkdtempSync(join(tmpdir(), 'parts-named-cut-')) : resolve(process.argv[at + 1]);
  try {
    runNamedCutSkirtChecks(dir, (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); }, process.argv.includes('--expect-current-refusal'));
  } finally {
    if (at < 0) rmSync(dir, { recursive: true, force: true });
  }
}
