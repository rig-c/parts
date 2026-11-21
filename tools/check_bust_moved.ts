import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { clothRecipe } from '../fixtures/cloth.ts';
import { BUST_LANDMARKS_PROVENANCE_SUFFIX, bustPointsMoved } from '../src/bustlandmarks.ts';
import { bustRouteFixture } from './check_bust_shape.ts';

type Json = Record<string, unknown>;
type Mesh = { contour?: { bust?: Json } };

/**
 * Issue #1443: a second correction. The config already declares contour.bust at apex_r [24, 46], apex_l [40, 46],
 * cleavage [32, 47] (|apex - cleavage| = 8.06, D = 16: R = round(4.26) = 4, r = round(0.22 * 4) = 1 with the
 * defaults; with clearance 8, R = 0, which the rule refuses). An act that moves the points and tunes the shape leaves
 * the shape pending in the record, and propose writes the points and the shape in one staged write. On the
 * #1441 fixture (both routes); every expected value is computed here from the points:
 * - moved [20, 46] / [44, 46] / [32, 60], clearance 8: R = round(18.44 - 8) = 10, 20 < 24, r = 2 (fits);
 * - moved [22, 46] / [42, 46] / [32, 50], alpha 0.3: |apex - cleavage| = 10.77, R = 7, 14 < 20, r = 2 (fits);
 * - moved [20, 46] / [44, 46] / [32, 80], clearance 8: R = 28, 56 >= 24 (refused).
 */
export function runBustMovedChecks(dir: string, say: (name: string, pass: boolean, detail: string) => void): void {
  const { cli, read, write, first, ordinary, neck, parts, source, fullDir, headDir, work, act } = bustRouteFixture(dir);
  const bustOf = (cfg: string): string => JSON.stringify((JSON.parse(read(cfg)) as { meshes: Record<string, Mesh> }).meshes.shirt.contour?.bust ?? null);
  const declaredPoints = { apex_r: [24, 46], apex_l: [40, 46], cleavage: [32, 47] };
  let n = 0;
  const configOf = (base: string, shape: Json): string => {
    const c = JSON.parse(base) as { meshes: Record<string, Mesh>; bones: Json[] };
    c.meshes.shirt.contour = { ...c.meshes.shirt.contour, bust: { ...declaredPoints, ...shape } };
    c.bones = [...c.bones, { name: 'boob_r', parent: 'chest', at: [24, 46] }, { name: 'boob_l', parent: 'chest', at: [40, 46] }];
    return write(join(work, `moved-config-${++n}.json`), c);
  };
  const commandOne = (cfg: string, bust: Json, ...more: string[]) => {
    const out = join(work, `moved-landmarks-${++n}.json`);
    const before = read(cfg);
    const r = cli('bust-landmarks', '--from-act', act(bust), '--parts', parts, '--config', cfg, '--out', out, ...more);
    return { r, out, record: out + BUST_LANDMARKS_PROVENANCE_SUFFIX, kept: read(cfg) === before };
  };
  const commandTwo = (cfg: string, landmarks: string, ...more: string[]) =>
    cli('propose', '--parts', parts, '--source', source, '--out', join(work, `moved-out-${++n}`), '--write-config', cfg, '--bust-landmarks', landmarks, ...more);
  const shapeOf = (record: string): string => existsSync(record) ? JSON.stringify((JSON.parse(read(record)) as { shape?: unknown }).shape ?? null) : 'no record';
  const routes = [['ORDINARY', ordinary], ['NECK', neck]] as const;

  // (i) the points move and the shape changes: pending, then one staged write, then a rerun that changes nothing.
  const moved = { apex_r: [20, 46], apex_l: [44, 46], cleavage: [32, 60] };
  for (const [route, base] of routes) {
    const cfg = configOf(base, {});
    const one = commandOne(cfg, { ...moved, clearance: 8 }, '--write-config');
    const pendingLine = `bust-landmarks: pending shape for "shirt": clearance 8; the act moves the points of meshes.shirt.contour.bust, so the config is not written and ${one.record} carries it until propose writes it with the three points`;
    const nextLine = `wrote ${one.out} and ${one.record}; next, to apply it: rig-parts propose … --write-config ${cfg} --bust-landmarks ${one.out}`;
    const pendingShape = shapeOf(one.record);
    // The printed command as printed, the ellipsis filled with the run's --parts, --source and --out.
    const m = /; next, to apply it: rig-parts propose … --write-config (\S+) --bust-landmarks (\S+)$/.exec(one.r.stdout.split('\n').find(l => l.startsWith(`wrote ${one.out} `)) ?? '');
    const two = m === null ? null : commandTwo(m[1], m[2]);
    const after = read(cfg);
    const three = commandTwo(cfg, one.out);
    say(`BPM0${route === 'ORDINARY' ? 1 : 2}_${route}_MOVED_POINTS_AND_A_NEW_SHAPE_END_IN_THE_CONFIG_AND_THE_RECORD_APPLIED`,
      one.r.status === 0 && one.kept && one.r.stderr.includes(`config ${cfg}: unchanged`) && one.r.stdout.includes(`${pendingLine}\n${nextLine}\n`) &&
        pendingShape === '{"status":"pending","fields":{"clearance":8}}' &&
        two !== null && two.status === 0 && bustOf(cfg) === '{"apex_r":[20,46],"apex_l":[44,46],"cleavage":[32,60],"clearance":8}' &&
        shapeOf(one.record) === '{"status":"applied","fields":{"clearance":8}}' &&
        two.stdout.includes(`propose: wrote the pending shape of act "act-1441" into meshes.shirt.contour.bust (clearance 8) with the three points; marked it applied in ${one.record}\n`) &&
        three.status === 0 && read(cfg) === after,
      `command 1 exit ${one.r.status}${one.r.status === 0 ? '' : `: ${first(one.r).trim().slice(0, 160)}`}; config ${one.kept ? 'unchanged' : 'WRITTEN'}; record ${pendingShape}; command 2 exit ${two?.status ?? 'not run'}${two === null || two.status === 0 ? '' : `: ${first(two).trim().slice(0, 160)}`}; contour.bust ${bustOf(cfg)}; record ${shapeOf(one.record)}; rerun exit ${three.status}, config ${read(cfg) === after ? 'unchanged' : 'MOVED'}`);
  }

  // (ii) the shape changes at the config's own points: written directly, as before #1443.
  const direct = routes.map(([, base]) => {
    const cfg = configOf(base, {});
    const one = commandOne(cfg, { ...declaredPoints, alpha: 0.3 }, '--write-config');
    return { one, cfg, bust: bustOf(cfg), shape: shapeOf(one.record) };
  });
  say('BPM03_THE_SHAPE_ALONE_AT_THE_DECLARED_POINTS_IS_WRITTEN_DIRECTLY',
    direct.every(d => d.one.r.status === 0 && d.bust === '{"apex_r":[24,46],"apex_l":[40,46],"cleavage":[32,47],"alpha":0.3}' && d.shape === 'null' &&
      d.one.r.stderr === `config ${d.cfg}: added meshes.shirt.contour.bust.alpha\n` && !d.one.r.stdout.includes('pending shape')),
    direct.map(d => `exit ${d.one.r.status}; contour.bust ${d.bust}; record shape ${d.shape}; stderr ${JSON.stringify(d.one.r.stderr)}`).join(' | '));

  // (iii) the points move and the shape is the config's: no pending shape; command 2 moves the points, the shape kept.
  const pointsOnly = routes.map(([, base]) => {
    const cfg = configOf(base, { alpha: 0.3 });
    const one = commandOne(cfg, { apex_r: [22, 46], apex_l: [42, 46], cleavage: [32, 50], alpha: 0.3 }, '--write-config');
    const two = commandTwo(cfg, one.out);
    return { one, two, bust: bustOf(cfg), shape: shapeOf(one.record) };
  });
  say('BPM04_MOVED_POINTS_WITH_THE_DECLARED_SHAPE_KEEP_IT_AND_RECORD_NOTHING_PENDING',
    pointsOnly.every(p => p.one.r.status === 0 && p.one.kept && p.shape === 'null' && !p.one.r.stdout.includes('pending shape') &&
      p.two.status === 0 && p.bust === '{"apex_r":[22,46],"apex_l":[42,46],"cleavage":[32,50],"alpha":0.3}'),
    pointsOnly.map(p => `command 1 exit ${p.one.r.status}, record shape ${p.shape}; command 2 exit ${p.two.status}; contour.bust ${p.bust}`).join(' | '));

  // (iv) a shape that does not fit its own points: refused with the shape clause, nothing written.
  const misfit = routes.map(([, base]) => {
    const cfg = configOf(base, {});
    const one = commandOne(cfg, { apex_r: [20, 46], apex_l: [44, 46], cleavage: [32, 80], clearance: 8 }, '--write-config');
    return { one, line: first(one.r), wrote: existsSync(one.out) || existsSync(one.record) };
  });
  say('BPM05_A_SHAPE_THAT_DOES_NOT_FIT_ITS_OWN_POINTS_IS_REFUSED_NAMING_THE_SHAPE',
    misfit.every(x => x.one.r.status === 1 && x.one.kept && !x.wrote &&
      x.line.startsWith('  FAIL  CONFIG_BUST_CLEARANCE: value.chestLandmarks[0].edit.bust — is 8 (giving R_r = 28, R_l = 28, R_r + R_l = 56 px against apex distance D = 24 px') &&
      x.line.endsWith('; the shape checked: alpha 0.22 (the default), clearance 8 (the pending record) (see rig-parts guide CONFIG_BUST_CLEARANCE)')),
    misfit.map(x => `exit ${x.one.r.status}; config ${x.one.kept ? 'unchanged' : 'WRITTEN'}; files ${x.wrote ? 'WRITTEN' : 'none'}; …${x.line.slice(x.line.indexOf('; the shape checked'))}`).join(' | '));

  // Field by field: a declared field the act keeps (spacing 10), a pending field (clearance 8), and a declared field the
  // act leaves at its default (alpha 0.3 -> absent): that one is pending as the default's value, 0.22, and written so,
  // since the record holds values and the act's shape there is the default.
  const fields = routes.map(([, base]) => {
    const cfg = configOf(base, { alpha: 0.3, spacing: 10 });
    const one = commandOne(cfg, { ...moved, clearance: 8, spacing: 10 }, '--write-config');
    const pending = shapeOf(one.record);
    const two = commandTwo(cfg, one.out);
    return { one, two, pending, bust: bustOf(cfg) };
  });
  say('BPM06_A_PENDING_SHAPE_OVERRIDES_THE_DECLARED_ONE_FIELD_BY_FIELD',
    fields.every(f => f.one.r.status === 0 && f.one.kept && f.pending === '{"status":"pending","fields":{"alpha":0.22,"clearance":8}}' &&
      f.two.status === 0 && f.bust === '{"apex_r":[20,46],"apex_l":[44,46],"cleavage":[32,60],"alpha":0.22,"clearance":8,"spacing":10}'),
    fields.map(f => `record ${f.pending}; command 2 exit ${f.two.status}; contour.bust ${f.bust}`).join(' | '));

  // What "the points move" means: either apex in either coordinate, the cleavage, or a cleavage the act leaves out.
  const declared = { apex_r: [24, 46], apex_l: [40, 46], cleavage: [32, 47] };
  const rule = [
    !bustPointsMoved(declared, declared), bustPointsMoved({ ...declared, apex_r: [24, 45] }, declared), bustPointsMoved({ ...declared, apex_l: [41, 46] }, declared),
    bustPointsMoved({ ...declared, cleavage: [32, 47.5] }, declared), bustPointsMoved({ apex_r: [24, 46], apex_l: [40, 46] }, declared),
  ];
  const noCleavageCfg = configOf(ordinary, {});
  const noCleavage = commandOne(noCleavageCfg, { apex_r: [24, 46], apex_l: [40, 46], alpha: 0.3 }, '--write-config');
  const withoutFlag = commandOne(configOf(ordinary, {}), { ...moved, clearance: 8 });
  say('BPM07_POINTS_MOVE_BY_ANY_COORDINATE_OR_AN_ABSENT_CLEAVAGE_WITH_OR_WITHOUT_THE_FLAG',
    rule.every(Boolean) && noCleavage.r.status === 0 && noCleavage.kept && shapeOf(noCleavage.record) === '{"status":"pending","fields":{"alpha":0.3}}' &&
      withoutFlag.r.status === 0 && withoutFlag.kept && shapeOf(withoutFlag.record) === '{"status":"pending","fields":{"clearance":8}}',
    `rule ${rule.join(',')}; no cleavage: exit ${noCleavage.r.status}, record ${shapeOf(noCleavage.record)}; without --write-config: exit ${withoutFlag.r.status}, record ${shapeOf(withoutFlag.record)}`);

  // Every other mode of propose against a record this path made: each refused by name.
  const pendingOn = (base: string) => { const cfg = configOf(base, {}); return { cfg, one: commandOne(cfg, { ...moved, clearance: 8 }, '--write-config') }; };
  const modes = [
    ['no --write-config', (() => { const { one } = pendingOn(ordinary); return cli('propose', '--parts', parts, '--source', source, '--out', join(work, `mode-${++n}`), '--bust-landmarks', one.out); })(), 'PROPOSE_BUST_PENDING: --bust-landmarks'],
    ['--only-missing, ordinary', (() => { const { cfg, one } = pendingOn(ordinary); return commandTwo(cfg, one.out, '--only-missing'); })(), 'PROPOSE_BUST_PENDING: --only-missing'],
    ['--only-missing, neck', (() => { const { cfg, one } = pendingOn(neck); return commandTwo(cfg, one.out, '--only-missing'); })(), 'PROPOSE_NECK_MODE: --only-missing'],
    ['--full and --head, neck', (() => { const { cfg, one } = pendingOn(neck); return commandTwo(cfg, one.out, '--full', fullDir, '--head', headDir); })(), 'PROPOSE_NECK_MODE: --bust-landmarks, --full, --head'],
    ['--cloth', (() => {
      const { one } = pendingOn(ordinary);
      const recipe = write(join(work, `mode-cloth-${++n}.json`), { key: 'cloth', cloth: clothRecipe() });
      return cli('propose', '--parts', parts, '--source', source, '--out', join(work, `mode-${++n}`), '--cloth', recipe, '--write-config', join(work, `mode-cloth-out-${n}.json`), '--bust-landmarks', one.out);
    })(), 'PROPOSE_BUST_PENDING: --cloth'],
  ] as const;
  say('BPM08_EVERY_OTHER_PROPOSE_MODE_REFUSES_A_RECORD_THIS_PATH_MADE',
    modes.every(([, r, code]) => r.status === 1 && first(r).startsWith(`  FAIL  ${code}`)),
    modes.map(([what, r]) => `${what}: exit ${r.status} ${first(r).trim().slice(0, 70)}`).join(' | '));

  // #1444's review: --only-missing skips the carrier the config attaches, so the draft's points are not written and the
  // declared shape is not checked against them. Declared [8, 46] / [56, 46] / [32, 46], clearance 20: |apex - cleavage|
  // = 24, R = 4, r = 1 (valid). Draft [20, 46] / [44, 46] / [32, 46]: |apex - cleavage| = 12, with clearance 20 R = -8
  // (refused), with the default 3.8 R = 8, 16 < 24, r = 2 (the draft's own check passes).
  const skippedCfg = (() => {
    const c = JSON.parse(ordinary) as { meshes: Record<string, Mesh>; bones: Json[] };
    c.meshes.shirt.contour = { ...c.meshes.shirt.contour, bust: { apex_r: [8, 46], apex_l: [56, 46], cleavage: [32, 46], clearance: 20 } };
    c.bones = [...c.bones, { name: 'boob_r', parent: 'chest', at: [8, 46] }, { name: 'boob_l', parent: 'chest', at: [56, 46] }];
    return c;
  })();
  const draftPoints = write(join(work, `skipped-landmarks-${++n}.json`), { apex_r: [20, 46], apex_l: [44, 46], cleavage: [32, 46] });
  const onlyMissingCfg = write(join(work, `skipped-config-${++n}.json`), skippedCfg);
  const onlyBefore = read(onlyMissingCfg);
  const skipped = commandTwo(onlyMissingCfg, draftPoints, '--only-missing');
  const fullCfg = write(join(work, `skipped-config-${++n}.json`), skippedCfg);
  const fullBefore = read(fullCfg);
  const full = commandTwo(fullCfg, draftPoints);
  say('BPM09_ONLY_MISSING_CHECKS_A_SKIPPED_CARRIER_AS_DRAFTED',
    skipped.status === 0 && read(onlyMissingCfg) === onlyBefore &&
      full.status === 1 && read(fullCfg) === fullBefore && first(full).startsWith('  FAIL  CONFIG_BUST_CLEARANCE: config.meshes.shirt.contour.bust.clearance — is 20 (giving R_r = -8, R_l = -8') &&
      first(full).endsWith('; the shape checked: alpha 0.22 (the default), clearance 20 (the config) (see rig-parts guide CONFIG_BUST_CLEARANCE)'),
    `--only-missing exit ${skipped.status}${skipped.status === 0 ? '' : `: ${first(skipped).trim().slice(0, 160)}`}, config ${read(onlyMissingCfg) === onlyBefore ? 'byte-unchanged' : 'CHANGED'} | without it exit ${full.status}: ${first(full).trim().slice(0, 110)} …${first(full).slice(first(full).indexOf('; the shape checked'))}`);

}
