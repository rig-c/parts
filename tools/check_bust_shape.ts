import { createHash } from 'node:crypto';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeNeckDraftFixture } from '../fixtures/neck_draft.ts';
import { assembleStage } from '../src/build.ts';
import { BUST_LANDMARKS_PROVENANCE_SUFFIX, effectiveBustShape } from '../src/bustlandmarks.ts';

type Json = Record<string, unknown>;
type Mesh = { contour?: { bust?: Json } };

/**
 * Issue #1441: the three bust points are checked with the effective shape (the config's declared shape fields on the
 * chest carrier, a pending record's over them, the defaults for the rest), on the ordinary route and on #1436's
 * chest-only route, and by `bust-landmarks` before it writes. The fixture is the neck-draft blocks with a chest
 * carrier (64x64 rig), drafted as #1436's controls draft it. Points apex_r [20, 46], apex_l [44, 46], cleavage
 * [32, 60]: |apex - cleavage| = sqrt(12^2 + 14^2) = 18.44, so with the default clearance 3.8 each R = round(14.64) = 15
 * and R_r + R_l = 30 >= D = 24 (refused), and with clearance 8 each R = round(10.44) = 10, 20 < 24, r = round(0.22 * 10)
 * = 2 (passes). Cleavage [32, 80] gives |apex - cleavage| = 36.06, R = 28 with clearance 8: refused with either shape.
 * A declared contour.bust holds other points, apex_r [16, 46], apex_l [48, 46], cleavage [32, 62] (|apex - cleavage| =
 * 22.63, D = 32), valid on their own with clearance 8 (R = 15) and with alpha 0.3, clearance 9 (R = 14, r = 4).
 */
/** The two configs #1441's and #1443's controls run on, with the helpers both use. */
export interface BustRouteFixture {
  cli: (...args: string[]) => SpawnSyncReturns<string>;
  read: (p: string) => string;
  write: (p: string, value: unknown) => string;
  first: (r: { stdout: string }) => string;
  /** The ordinary config (no turn.body) drafted with --no-bust, and the sampled-neck config, its neck drafted after. */
  ordinary: string;
  neck: string;
  /** The neck draft's parts, the painting and the directory every control writes into. */
  parts: string;
  source: string;
  /** The See-through runs the neck draft read. */
  fullDir: string;
  headDir: string;
  work: string;
  /** A rig-review/act@9 file with one chest row on "shirt" whose edit.bust is the given object. */
  act: (bust: Json) => string;
}

/** Build {@link BustRouteFixture} under `dir`: the neck-draft blocks with a chest carrier, drafted as #1436's controls draft it. */
export function bustRouteFixture(dir: string): BustRouteFixture {
  const cliPath = join(import.meta.dir, '../cli.ts');
  const cli = (...args: string[]) => spawnSync(process.execPath, [cliPath, ...args], { cwd: dir, encoding: 'utf8' });
  const read = (p: string): string => existsSync(p) ? readFileSync(p, 'utf8') : '';
  const write = (p: string, value: unknown): string => { writeFileSync(p, JSON.stringify(value, null, 2) + '\n'); return p; };
  const first = (r: { stdout: string }): string => r.stdout.split('\n').find(l => l.includes('FAIL  ')) ?? r.stdout.split('\n')[0];
  // The two configs: ordinary (no turn.body), drafted with --no-bust; sampled-neck, its neck drafted after.
  const files = writeNeckDraftFixture(join(dir, 'fixture'), true, true);
  const parts0 = join(dir, 'old');
  assembleStage({ source: files.source, full: files.fullDir, head: files.headDir, config: files.configPath, seam: 'near-white', project: 'core' },
    { partsJson: join(parts0, 'parts.json'), partsDir: join(parts0, 'parts'), recomposite: join(parts0, 'recomposite.png'), errorMap: join(parts0, 'error.png') }, () => {});
  const work = join(dir, 'work');
  mkdirSync(work, { recursive: true });
  const authored = JSON.parse(read(files.configPath)) as Json & { turn: Json };
  const { body, ...turn } = authored.turn;
  const config = write(join(work, 'config.json'), { ...authored, turn });
  const draft = cli('propose', '--parts', parts0, '--source', files.source, '--out', join(work, 'first'), '--write-config', config, '--no-bust', 'first draft');
  const ordinary = read(config);
  const withBody = JSON.parse(ordinary) as Json & { turn: Json };
  withBody.turn.body = body;
  write(config, withBody);
  const neckRun = cli('propose', '--parts', parts0, '--source', files.source, '--full', files.fullDir, '--head', files.headDir, '--out', join(work, 'neck'), '--write-config', config);
  if (draft.status !== 0 || neckRun.status !== 0) throw new Error(`bust-shape fixture: first draft exit ${draft.status}, neck draft exit ${neckRun.status}: ${first(draft)} ${first(neckRun)}`);
  const neck = read(config);
  const parts = join(work, 'neck', 'rig');
  let k = 0;

  const digest = (edit: unknown): string => {
    const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted)
      : typeof v === 'object' && v !== null ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as Json)[k])])) : v;
    return createHash('sha256').update(JSON.stringify(sorted(edit))).digest('hex');
  };
  const act = (bust: Json): string => {
    const edit = { slot: 'shirt', skin: 'default', attachment: 'shirt', basis: 'setup', source: { hash: 'a'.repeat(64), frame: { width: 64, height: 64 } }, bust };
    return write(join(work, `act-${++k}.json`), { schema: 'rig-review/act@9', actId: 'act-1441', jobId: 'job-1', askId: 'ask-1', publicationId: 'pub-1', kind: 'review-verdict', value: { stage: 'rig-review', verdict: 'changes-requested', comments: [], chestLandmarks: [{ edit, sha256: digest(edit) }] } });
  };
  return { cli, read, write, first, ordinary, neck, parts, source: files.source, fullDir: files.fullDir, headDir: files.headDir, work, act };
}

export function runBustShapeChecks(dir: string, say: (name: string, pass: boolean, detail: string) => void): void {
  const { cli, read, write, first, ordinary, neck, parts, source, work, act } = bustRouteFixture(dir);
  const bustOf = (cfg: string): string => JSON.stringify((JSON.parse(read(cfg)) as { meshes: Record<string, Mesh> }).meshes.shirt.contour?.bust ?? null);
  const files = { source };

  // A config of either route with a declared contour.bust (other points, the given shape fields), or none.
  let n = 0;
  const configOf = (base: string, shape: Json | null): string => {
    const c = JSON.parse(base) as { meshes: Record<string, Mesh>; bones: Json[] };
    if (shape !== null) {
      c.meshes.shirt.contour = { ...c.meshes.shirt.contour, bust: { apex_r: [16, 46], apex_l: [48, 46], cleavage: [32, 62], ...shape } };
      c.bones = [...c.bones, { name: 'boob_r', parent: 'chest', at: [16, 46] }, { name: 'boob_l', parent: 'chest', at: [48, 46] }];
    }
    return write(join(work, `config-${++n}.json`), c);
  };
  // A landmarks file, and a record beside it holding a pending shape when one is given (its digest the file's own).
  const landmarksOf = (points: Json, pending: Json | null): string => {
    const file = write(join(work, `landmarks-${++n}.json`), points);
    if (pending !== null) {
      write(file + BUST_LANDMARKS_PROVENANCE_SUFFIX, {
        spec: 'rig-parts-bust-landmarks-provenance/1',
        act: { schema: 'rig-review/act@9', act_id: 'act-1441', file_sha256: 'a'.repeat(64) },
        row_sha256: 'b'.repeat(64), slot: 'shirt', source: { hash: 'c'.repeat(64), frame: { width: 64, height: 64 } },
        landmarks_sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
        shape: { status: 'pending', fields: pending },
      });
    }
    return file;
  };
  const propose = (cfg: string, landmarks: string) => cli('propose', '--parts', parts, '--source', files.source, '--out', join(work, `out-${++n}`), '--write-config', cfg, '--bust-landmarks', landmarks);
  const fits = { apex_r: [20, 46], apex_l: [44, 46], cleavage: [32, 60] };
  const neither = { apex_r: [20, 46], apex_l: [44, 46], cleavage: [32, 80] };
  const passes = (label: string, base: string, declared: Json | null, pending: Json | null): void => {
    const cfg = configOf(base, declared);
    const file = landmarksOf(fits, pending);
    const r = propose(cfg, file);
    const record = read(file + BUST_LANDMARKS_PROVENANCE_SUFFIX);
    const want = '{"apex_r":[20,46],"apex_l":[44,46],"cleavage":[32,60],"clearance":8}';
    say(label, r.status === 0 && bustOf(cfg) === want && (pending === null || record.includes('"status": "applied"')),
      `exit ${r.status}${r.status === 0 ? '' : `: ${first(r).trim().slice(0, 160)}`}; contour.bust ${bustOf(cfg)}${pending === null ? '' : `; record ${record.includes('"status": "applied"') ? 'applied' : 'not applied'}`}`);
  };
  passes('BES01_ORDINARY_ROUTE_POINTS_VALID_ONLY_WITH_THE_DECLARED_SHAPE_ARE_WRITTEN', ordinary, { clearance: 8 }, null);
  passes('BES02_ORDINARY_ROUTE_POINTS_VALID_ONLY_WITH_THE_PENDING_SHAPE_ARE_WRITTEN', ordinary, null, { clearance: 8 });
  passes('BES03_CHEST_ONLY_ROUTE_POINTS_VALID_ONLY_WITH_THE_DECLARED_SHAPE_ARE_WRITTEN', neck, { clearance: 8 }, null);
  passes('BES04_CHEST_ONLY_ROUTE_POINTS_VALID_ONLY_WITH_THE_PENDING_SHAPE_ARE_WRITTEN', neck, null, { clearance: 8 });

  // Points no shape fits: refused on both routes, the refusal naming the values used and their sources.
  const refusal = (base: string, declared: Json | null, pending: Json | null, points: Json = neither) => {
    const cfg = configOf(base, declared);
    const before = read(cfg);
    const r = propose(cfg, landmarksOf(points, pending));
    return { r, line: first(r), kept: read(cfg) === before };
  };
  const clause = (alpha: string, clearance: string): string => `; the shape checked: ${alpha}, ${clearance} (see rig-parts guide CONFIG_BUST_CLEARANCE)`;
  const head = '  FAIL  CONFIG_BUST_CLEARANCE: config.meshes.shirt.contour.bust.clearance — is 8 (giving R_r = 28, R_l = 28, R_r + R_l = 56 px against apex distance D = 24 px';
  const refused = [
    refusal(ordinary, { clearance: 8 }, null), refusal(ordinary, null, { clearance: 8 }),
    refusal(neck, { clearance: 8 }, null), refusal(neck, null, { clearance: 8 }),
  ];
  const sources = ['the config', 'the pending record', 'the config', 'the pending record'];
  say('BES05_POINTS_INVALID_WITH_EITHER_SHAPE_ARE_REFUSED_NAMING_THE_SHAPE',
    refused.every((x, i) => x.r.status === 1 && x.kept && x.line.startsWith(head) && x.line.endsWith(clause('alpha 0.22 (the default)', `clearance 8 (${sources[i]})`))),
    refused.map(x => `exit ${x.r.status}: …${x.line.slice(x.line.indexOf('; the shape checked'))}`).join(' | '));

  // One field pending, one declared, one default: the rule, then the clause of a refusal.
  const shape = effectiveBustShape({ alpha: 0.3, clearance: 9 }, { clearance: 8 });
  const mixed = refusal(ordinary, { alpha: 0.3, clearance: 9 }, { clearance: 8 });
  say('BES06_A_PENDING_FIELD_OVERRIDES_A_DECLARED_ONE_FIELD_BY_FIELD',
    shape.alpha.value === 0.3 && shape.alpha.source === 'the config' && shape.clearance.value === 8 && shape.clearance.source === 'the pending record' &&
      shape.spacing.value === 14 && shape.spacing.source === 'the default' && shape.bone_r.source === 'the default' &&
      mixed.r.status === 1 && mixed.line.endsWith(clause('alpha 0.3 (the config)', 'clearance 8 (the pending record)')),
    `alpha ${String(shape.alpha.value)} (${shape.alpha.source}), clearance ${String(shape.clearance.value)} (${shape.clearance.source}), spacing ${String(shape.spacing.value)} (${shape.spacing.source}); refusal …${mixed.line.slice(mixed.line.indexOf('; the shape checked'))}`);

  // No declared shape and no record: the refusal is the loader's own, with no clause (the text before #1441).
  const plainLine = '  FAIL  CONFIG_BUST_CLEARANCE: config.meshes.shirt.contour.bust.clearance — is 3.8 (giving R_r = 15, R_l = 15, R_r + R_l = 30 px against apex distance D = 24 px, r_r = 3, band_r = 12, r_l = 3, band_l = 12); a clearance > 0 with R_r + R_l < D and positive core radii and non-negative bands is required; the first passing clearance in 0.01 px steps is 6.94 px for these landmarks and alpha; set clearance to that value (see rig-parts guide CONFIG_BUST_CLEARANCE)';
  const plain = [refusal(ordinary, null, null, fits), refusal(neck, null, null, fits)];
  say('BES07_NO_SHAPE_AND_NO_RECORD_KEEPS_THE_REFUSAL_TEXT',
    plain.every(x => x.r.status === 1 && x.kept && x.line === plainLine && !x.r.stdout.includes('the shape checked')),
    plain.map(x => `exit ${x.r.status}; ${x.line === plainLine ? 'text as before' : x.line.trim().slice(0, 140)}`).join(' | '));

  // bust-landmarks refuses the points propose would refuse, and writes the ones it would take.
  const landmarks = (cfg: string, bust: Json) => {
    const out = join(work, `bl-${++n}.json`);
    const r = cli('bust-landmarks', '--from-act', act(bust), '--parts', parts, '--config', cfg, '--out', out);
    return { r, wrote: existsSync(out), line: first(r) };
  };
  const plainCfg = configOf(neck, null);
  const noShape = landmarks(plainCfg, fits);
  const pendingTaken = landmarks(plainCfg, { ...fits, clearance: 8 });
  const declaredTaken = landmarks(configOf(ordinary, { clearance: 8 }), { ...fits, clearance: 8 });
  say('BES08_BUST_LANDMARKS_REFUSES_WHAT_PROPOSE_REFUSES',
    noShape.r.status === 1 && !noShape.wrote && noShape.line.startsWith('  FAIL  CONFIG_BUST_CLEARANCE: value.chestLandmarks[0].edit.bust — is 3.8 (giving R_r = 15, R_l = 15') &&
      noShape.line.endsWith(clause('alpha 0.22 (the default)', 'clearance 3.8 (the default)')) &&
      pendingTaken.r.status === 0 && pendingTaken.wrote && declaredTaken.r.status === 0 && declaredTaken.wrote,
    `no shape: exit ${noShape.r.status}, …${noShape.line.slice(noShape.line.indexOf('; the shape checked'))}; pending clearance 8: exit ${pendingTaken.r.status}; declared clearance 8: exit ${declaredTaken.r.status}${declaredTaken.r.status === 0 ? '' : `: ${declaredTaken.line.trim().slice(0, 200)}`}`);
}
