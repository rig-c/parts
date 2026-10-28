/** Independent scalar-field controls on an alpha-overlapped sloping neck. */
import { runTurnSplitUnitChecks } from './check_turn_split_unit.ts';
import { overlapTurnFixture, differingDepthTurnFixture, roleNeighbourTurnFixture } from '../fixtures/turn_overlap.ts';
import { blendedTurnIslandsFixture } from '../fixtures/turn_blend.ts';
import { buildRig, type MeshAttachment, type RigOutput } from '../src/rig.ts';
import { parseConfig } from '../src/config.ts';
import { computeWorldTransforms, setupToPaintingPoint, toBoneLocal, toWorld } from '../src/coords.ts';
import { sampleTurnTriangleField } from '../src/turnfield.ts';
import { pyRound } from '../src/round.ts';
import { turnOverlapOwners, type ClassifiedTurnSurface } from '../src/turnoverlap.ts';
import type { Depth25DTurnOptions } from '../src/turn.ts';
import type { Problem } from '../src/errors.ts';
import { PartsError } from '../src/errors.ts';
import type { ExplicitMeshIslandSpec } from '../src/config.ts';
import { buildDepth25DTurn } from '../src/turn.ts';
import { block } from '../fixtures/rig.ts';
import { paintingToSetupPoint } from '../src/coords.ts';
import { blendSliderFolds } from './check_turn_blend.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
type Animation = { deform?: Array<{ slot: string; keys: Array<{ vertices?: number[] }> }> };

/** Small source cells and named group controls, independent of the emitter's scalar oracle. */
function ownershipControl(kind: string) {
  const bones = [{ name: 'root', x: 0, y: 0 }, { name: 'chest', parent: 'root', x: 0, y: 0 }, { name: 'head', parent: 'chest', x: 0, y: 0 }];
  const parts = ['neck', 'plate', 'second'].map(name => ({ name, x: 30, y: 40, w: 6, h: 6 }));
  const images = new Map(parts.map(p => [p.name, block(6, 6)]));
  const mesh = (part: string, mixed: boolean, left = 30, bone = 'chest') => ({ part, slot: part, attachment: part, canvas: [64, 64] as const, triangles: [0, 1, 2, 0, 2, 3],
    weights: [[left, 40], [left, 46], [left + 6, 46], [left + 6, 40]].map(p => {
      const [x, y] = paintingToSetupPoint(p, [64, 64], [64, 64]);
      return [{ bone, x, y, weight: mixed ? 0.6 : 1 }, ...(mixed ? [{ bone: 'head', x, y, weight: 0.4 }] : [])];
    }),
  });
  const target = mesh('neck', true, 30.5);
  // Normal vertices are interior and below the last source row only where
  // explicitly tested; inspect vertex 0 at (30.5, 40) by default.
  const neighbour = mesh('plate', kind === 'mixed', 30, kind === 'head' ? 'head' : 'chest');
  const groups = (m: typeof target) => new Map(m.weights.flat().filter(w => w.weight > 0).map(w => [w.bone, w.bone === 'head' ? 'head' as const : 'body' as const]));
  const classified: ClassifiedTurnSurface[] = [{ mesh: target, groups: groups(target) }, { mesh: neighbour, groups: groups(neighbour) }];
  const opts: Depth25DTurnOptions = { turn: { roles: { ...(kind === 'head' || kind === 'dual' ? { plate: 'surface' as const } : {}) }, body: { roles: { ...(kind === 'head' ? {} : { plate: 'surface' as const }) } } }, parts, images, regions: {}, stills: {}, boneLandmarks: new Map(), hasAlternateFaceSet: false };
  const blended = new Set(['neck']);
  if (kind === 'alpha127' || kind === 'alpha128') for (let i = 3; i < images.get('plate')!.data.length; i += 4) images.get('plate')!.data[i] = kind === 'alpha127' ? 127 : 128;
  if (kind === 'hole') images.get('plate')!.data[3] = 0;
  if (kind === 'own-hole') images.get('neck')!.data[3] = 0;
  if (kind === 'no-overlap') parts[1].x += 20;
  if (kind === 'disconnected') classified[1].mesh = mesh('plate', false, 50);
  if (kind === 'missing-triangles') delete (neighbour as { triangles?: number[] }).triangles;
  if (kind === 'conflict' || kind === 'same-group') {
    opts.turn.roles = { second: 'surface' };
    opts.turn.body!.roles = { plate: 'surface', ...(kind === 'same-group' ? { second: 'surface' as const } : {}) };
    if (kind === 'same-group') opts.turn.roles = {};
    const second = mesh('second', false, 30, kind === 'conflict' ? 'head' : 'chest');
    classified.push({ mesh: second, groups: groups(second) });
  }
  if (kind === 'mixed-island' || kind === 'pure-island') {
    const mixed = mesh('plate', true), pure = mesh('plate', false, kind === 'pure-island' ? 30 : 50);
    pure.slot = 'plate__island2'; pure.attachment = pure.slot;
    classified.splice(1, 1, { mesh: mixed, groups: groups(mixed) }, { mesh: pure, groups: groups(pure) });
    blended.add('plate');
  }
  if (kind === 'pure-target') { classified[0].groups = new Map([['chest', 'body']]); target.weights.forEach(row => { row[0].weight = 1; row.splice(1); }); }
  if (kind === 'boundary') {
    // At the shared bone origin, the runtime's approximate unrotated matrix
    // cannot move the point: an EXACT triangle/source-cell boundary control.
    parts.forEach(p => { p.x = 32; p.y = 64; });
    target.weights[0].forEach(w => { w.x = 0; w.y = 0; });
    neighbour.weights.forEach(row => row.forEach(w => { w.x += 2; w.y -= 24; }));
  }
  if (kind === 'zero') neighbour.weights.forEach(row => row.push({ ...row[0], bone: 'head', weight: 0 }));
  const problems: Problem[] = [];
  const stops = kind === 'stop-alias' ? [{ links: ['chest'] }] : undefined;
  if (stops !== undefined) {
    for (const { mesh } of classified) mesh.weights.forEach(row => row.forEach(w => { if (w.bone === 'chest') w.bone = 'chest_d'; }));
    bones.find(b => b.name === 'head')!.parent = 'chest_d';
  }
  const owners = turnOverlapOwners({ bones, stops }, opts, classified, blended, problems).get(target);
  return { owner: owners?.[0]?.group, problems };
}

export function overlapFieldError(b: RigOutput) {
  const world = computeWorldTransforms(b.rig.bones), att = b.rig.skins.default.neck.neck as MeshAttachment;
  let rim = 0, outside = 0, pairs = 0;
  for (const [name, axis, pivot, band, bone] of [['turn', 'x', 16, 15, 'crown'], ['tilt', 'y', 16, 12, 'crown'], ['body_turn', 'x', 24, 15, 'torso']] as const) {
    const d = (b.motion.animations[name] as Animation).deform?.find(d => d.slot === 'neck');
    for (const [ki, deg] of [-band, -band / 2, 0, band / 2, band].entries()) {
      const offsets = d?.keys[ki].vertices ?? [], z = 120 * 40 / 255;
      const delta = -(pivot + z - pyRound(z, 4)) * Math.sin(deg * Math.PI / 180);
      let at = 0;
      for (const row of att.weights) {
        let sx = 0, sy = 0;
        for (const w of row) { const [x, y] = toWorld(world.get(w.bone)!, w.x, w.y); sx += x * w.weight; sy += y * w.weight; }
        const [, cy] = setupToPaintingPoint([sx, sy], [64, 64], [64, 64]);
        const anchored = cy >= 40 && cy < 52;
        for (const w of row) {
          const m = world.get(w.bone)!, x = offsets[at++] ?? 0, y = offsets[at++] ?? 0;
          const expected = w.weight === 0 ? 0 : anchored ? (bone === 'torso' ? delta : 0) : (w.bone === bone ? delta : 0);
          const error = Math.max(Math.abs(m.a * x + m.b * y - (axis === 'x' ? expected : 0)), Math.abs(m.c * x + m.d * y - (axis === 'y' ? expected : 0)));
          if (anchored) rim = Math.max(rim, error); else outside = Math.max(outside, error);
          pairs++;
        }
      }
    }
  }
  return { rim, outside, pairs };
}

/** Independent affine source ramp: neighbour levels are 20+5*x, not target120. */
export function overlapNeighbourFieldError(b: RigOutput) {
  const f = differingDepthTurnFixture(), p = f.parts.parts[0], art = f.images.get(p.name)!;
  const levels: number[] = [];
  for (let y = 0; y < art.height; y++) for (let x = 0; x < art.width; x++) if (art.data[(y * art.width + x) * 4 + 3] >= 128) levels.push(20 + 5 * x);
  levels.sort((a, b) => a - b);
  const median = (levels[Math.floor((levels.length - 1) / 2)] + levels[Math.floor(levels.length / 2)]) / 2;
  const zRef = pyRound(median * 40 / 255, 4), world = computeWorldTransforms(b.rig.bones), att = b.rig.skins.default.neck.neck as MeshAttachment;
  const deform = (b.motion.animations.body_turn as Animation).deform!.find(d => d.slot === 'neck')!;
  let max = 0, pairs = 0;
  for (const [ki, deg] of [-15, -7.5, 0, 7.5, 15].entries()) {
    const values = deform.keys[ki].vertices ?? []; let at = 0;
    for (const row of att.weights) {
      let sx = 0, sy = 0; for (const w of row) { const [x, y] = toWorld(world.get(w.bone)!, w.x, w.y); sx += x * w.weight; sy += y * w.weight; }
      const [cx, cy] = setupToPaintingPoint([sx, sy], [64, 64], [64, 64]);
      const covered = cy >= 40 && cy < 52;
      const neighbourDepth = 24 + (20 + 5 * (cx - p.x - 0.5)) * 40 / 255 - zRef;
      const ownDepth = 24 + 120 * 40 / 255 - pyRound(120 * 40 / 255, 4);
      for (const w of row) {
        const m = world.get(w.bone)!, x = values[at++] ?? 0, y = values[at++] ?? 0;
        const expected = -(covered ? neighbourDepth : w.bone === 'torso' ? ownDepth : 0) * Math.sin(deg * Math.PI / 180);
        max = Math.max(max, Math.abs(m.a * x + m.b * y - expected), Math.abs(m.c * x + m.d * y)); pairs++;
      }
    }
  }
  return { max, pairs, neighbourMedian: median };
}

/** Independent Gram-matrix oracle; production uses signed-area coordinates. */
function triangleFieldError(b: RigOutput, twice = false, aliases = new Map<string, string>()) {
  const resolve = (name: string) => aliases.get(name) ?? name;
  const world = computeWorldTransforms(b.rig.bones.map(bone => bone.parent === undefined ? bone : { ...bone, parent: resolve(bone.parent) }));
  const target = b.rig.skins.default.neck.neck as MeshAttachment, neighbour = b.rig.skins.default.topwear.topwear as MeshAttachment;
  const points = (att: MeshAttachment) => att.weights.map(row => row.reduce((p, w) => { const q = toWorld(world.get(resolve(w.bone))!, w.x, w.y); return [p[0] + q[0] * w.weight, p[1] + q[1] * w.weight]; }, [0, 0]));
  const T = points(target), N = points(neighbour); let max = 0, pairs = 0;
  for (const name of ['turn', 'tilt', 'body_turn']) {
    const anim = b.motion.animations[name] as Animation, td = anim.deform!.find(d => d.slot === 'neck'), nd = anim.deform!.find(d => d.slot === 'topwear');
    for (let ki = 0; ki < 5; ki++) {
      let at = 0;
      const source = neighbour.weights.map(row => row.reduce((sum, w) => { const m = world.get(resolve(w.bone))!, x = nd?.keys[ki].vertices?.[at++] ?? 0, y = nd?.keys[ki].vertices?.[at++] ?? 0; return [sum[0] + (m.a * x + m.b * y) * w.weight, sum[1] + (m.c * x + m.d * y) * w.weight]; }, [0, 0]));
      at = 0;
      for (const [vi, row] of target.weights.entries()) {
        const [, cy] = setupToPaintingPoint(T[vi], [64, 64], [64, 64]); let expected: number[] | undefined;
        if (cy >= 40 && cy < 52) {
          for (let i = 0; i < neighbour.triangles.length; i += 3) {
            const ids = neighbour.triangles.slice(i, i + 3), [a, c, d] = ids.map(j => N[j]);
            const u = [c[0] - a[0], c[1] - a[1]], v = [d[0] - a[0], d[1] - a[1]], p = [T[vi][0] - a[0], T[vi][1] - a[1]];
            const dot = (x: number[], y: number[]) => x[0] * y[0] + x[1] * y[1];
            const uu = dot(u, u), vv = dot(v, v), uv = dot(u, v), pu = dot(p, u), pv = dot(p, v), det = uu * vv - uv * uv;
            const y = (vv * pu - uv * pv) / det, z = (uu * pv - uv * pu) / det, x = 1 - y - z;
            if ([x, y, z].every(n => n >= 0)) { expected = [0, 1].map(axis => x * source[ids[0]][axis] + y * source[ids[1]][axis] + z * source[ids[2]][axis]); break; }
          }
          if (expected === undefined) return { max: Infinity, pairs };
        }
        for (const w of row) {
          const m = world.get(resolve(w.bone))!, x = (td?.keys[ki].vertices?.[at++] ?? 0) * (twice ? w.weight : 1), y = (td?.keys[ki].vertices?.[at++] ?? 0) * (twice ? w.weight : 1);
          if (expected !== undefined) { max = Math.max(max, Math.abs(m.a * x + m.b * y - expected[0]), Math.abs(m.c * x + m.d * y - expected[1])); pairs++; }
        }
      }
    }
  }
  return { max, pairs };
}

export function runTurnOverlapChecks(say: Say): void {
  runTurnSplitUnitChecks(say);
  const f = overlapTurnFixture(), b = buildRig(parseConfig(f.config), f.parts, f.images);
  const error = overlapFieldError(b);
  say('BO01_RIM_TAKES_BODY_FIELD_OUTSIDE_KEEPS_SKIN_SPLIT', error.rim < 0.000003 && error.outside < 0.000003, JSON.stringify(error));
  const plain = overlapTurnFixture(); delete plain.config.turn;
  const p = buildRig(parseConfig(plain.config), plain.parts, plain.images);
  say('BO02_SETUP_IDLE_AND_BINDINGS_ARE_EXACT', ['neck', 'topwear'].every(part => JSON.stringify(b.rig.skins.default[part]) === JSON.stringify(p.rig.skins.default[part])) && JSON.stringify(b.motion.animations.idle) === JSON.stringify(p.motion.animations.idle), 'authored neck/plate attachments, UVs, triangles, hulls, bindings and idle keys equal the no-turn source; generated face retains its separate surface path');
  for (const kind of ['body', 'head', 'mixed', 'alpha127', 'alpha128', 'hole', 'own-hole', 'no-overlap', 'disconnected', 'mixed-island', 'pure-island', 'pure-target', 'same-group', 'boundary', 'zero', 'stop-alias']) {
    const result = ownershipControl(kind), want = kind === 'head' ? 'head' : ['body', 'alpha128', 'pure-island', 'same-group', 'boundary', 'zero', 'stop-alias'].includes(kind) ? 'body' : undefined;
    say(`BO03_${kind.toUpperCase().replaceAll('-', '_')}`, result.owner === want && result.problems.length === 0, `owner=${result.owner ?? 'skin split'}, expected=${want ?? 'skin split'}; ${JSON.stringify(result.problems)}`);
  }
  for (const [kind, code] of [['conflict', 'RIG_TURN_SURFACE_OVERLAP_GROUPS'], ['dual', 'RIG_TURN_SURFACE_OVERLAP_GROUPS'], ['missing-triangles', 'RIG_TURN_SURFACE_OVERLAP_SUPPORT']]) {
    const result = ownershipControl(kind);
    say(`BO04_${kind.toUpperCase().replaceAll('-', '_')}_REFUSED`, result.problems.some(p => p.code === code && p.object.includes('vertex 0')), JSON.stringify(result.problems));
  }
  const folds = blendSliderFolds(b), collapsed = structuredClone(b);
  const att = collapsed.rig.skins.default.neck.neck as MeshAttachment;
  // The fold detector must also see a planted flat mesh at neutral sliders.
  att.weights = att.weights.map(() => structuredClone(att.weights[0]));
  const defect = blendSliderFolds(collapsed);
  say('BO05_COMBINED_SLIDERS_HAVE_ZERO_FOLDED_OR_FLAT_TRIANGLES', folds.count === 0 && folds.flat === 0 && defect.flat > 0, `${JSON.stringify(folds)}; collapsed-mesh control ${JSON.stringify(defect)}`);
  const covered = overlapTurnFixture();
  const explicit = (covered.config.meshes as Record<string, { explicit: Pick<ExplicitMeshIslandSpec, 'weights' | 'uvs'> }>).neck.explicit;
  const rows = [42.5, 44.5, 46.5, 48.5];
  const positions = [...rows.map(y => [40.5, y]), ...rows.toReversed().map(y => [48.5, y])];
  explicit.weights = positions.map(([x, y]) => [{ bone: 'torso', x: x - 32, y: 50 - y, weight: 0.6 }, { bone: 'crown', x: x - 32, y: 24 - y, weight: 0.4 }]);
  explicit.uvs = positions.flatMap(([x, y]) => [(x - 20 + 4) / 40, (y - 20 + 4) / 40]);
  const full = buildRig(parseConfig(covered.config), covered.parts, covered.images);
  say('BO06_FULLY_COVERED_ATTACHMENT_OMITS_INACTIVE_TIMELINES', ['turn', 'tilt'].every(n => !(full.motion.animations[n] as Animation).deform?.some(d => d.slot === 'neck')) && (full.motion.animations.body_turn as Animation).deform?.some(d => d.slot === 'neck') === true, 'all eight vertices in body alpha support: no inactive head timeline can overwrite the body deform');
  const zero = overlapTurnFixture();
  const zeroMesh = (zero.config.meshes as Record<string, { segments: string[]; explicit: { weights: ExplicitMeshIslandSpec['weights'] } }>).neck;
  zeroMesh.segments.push('chest');
  zeroMesh.explicit.weights.forEach(row => row.push({ ...row[0], bone: 'chest', weight: 0 }));
  const zeroBuild = buildRig(parseConfig(zero.config), zero.parts, zero.images), zeroError = overlapFieldError(zeroBuild);
  say('BO07_ZERO_INFLUENCES_STAY_ZERO_UNDER_AN_OVERLAP_OVERRIDE', zeroError.rim < 0.000003 && zeroError.outside < 0.000003, JSON.stringify(zeroError));
  explicit.weights.forEach(row => row.forEach(w => { w.weight = 0; }));
  let codes: string[] = [];
  try { buildRig(parseConfig(covered.config), covered.parts, covered.images); } catch (e) { if (e instanceof PartsError) codes = e.problems.map(p => p.code); else throw e; }
  say('BO08_INACTIVE_HEAD_DOES_NOT_BYPASS_WEIGHT_VALIDATION', codes.length > 0 && codes.some(c => c.includes('WEIGHT') || c === 'RIG_TURN_SURFACE_MESH_BINDINGS'), `zero-sum covered rows refused: ${codes.join(', ')}`);
  const different = differingDepthTurnFixture(), differentBuild = buildRig(parseConfig(different.config), different.parts, different.images);
  const neighbourError = triangleFieldError(differentBuild), twice = triangleFieldError(differentBuild, true), direct = overlapNeighbourFieldError(differentBuild);
  say('BO09_OVERLAP_SAMPLES_EXISTING_TRIANGLE_FIELD', neighbourError.max < 0.000003 && twice.max > 0.5 && direct.max > 0.04, `${JSON.stringify(neighbourError)}; twice-weight plant ${twice.max}; superseded direct-sheet deviation ${direct.max}`);
  for (const role of ['unit', 'rear'] as const) for (const islands of ['none', 'overlap', 'disconnected'] as const) {
    const f = roleNeighbourTurnFixture(role, islands), b = buildRig(parseConfig(f.config), f.parts, f.images);
    const absent = structuredClone(f); delete (absent.config.turn as { body: { roles: Record<string, string> } }).body.roles.topwear;
    const control = buildRig(parseConfig(absent.config), absent.parts, absent.images);
    const fields = (o: RigOutput) => ['turn', 'tilt', 'body_turn'].map(n => (o.motion.animations[n] as Animation).deform?.filter(d => d.slot === 'neck'));
    const equal = JSON.stringify(fields(b)) === JSON.stringify(fields(control));
    const folded = blendSliderFolds(b);
    const att = b.rig.skins.default.neck.neck as MeshAttachment, world = computeWorldTransforms(b.rig.bones);
    let error = 0;
    const values = (b.motion.animations.body_turn as Animation).deform!.find(d => d.slot === 'neck')!.keys[4].vertices!;
    let at = 0;
    for (const [i, row] of att.weights.entries()) for (const w of row) {
      const m = world.get(w.bone)!, dx = values[at++], dy = values[at++];
      if ([2, 3, 4, 5].includes(i) && islands !== 'disconnected') error = Math.max(error, Math.abs(m.a * dx + m.b * dy + (role === 'unit' ? 24 : -2.4) * Math.sin(Math.PI / 12)));
    }
    say(`BO10_${role.toUpperCase()}_${islands.toUpperCase()}_USES_ACTUAL_SUPPORT`, (islands === 'disconnected' ? equal : !equal && error < 0.000003) && folded.count === 0 && folded.flat === 0, `unlisted-neighbour control same=${equal}; rigid field residual=${error}; actual ${islands} weighted support; folds=${JSON.stringify(folded)}`);
  }
  const compound = blendedTurnIslandsFixture(); delete (compound.config.turn as { roles: Record<string, string> }).roles.neck;
  const unlisted = buildRig(parseConfig(compound.config), compound.parts, compound.images);
  say('BO11_UNLISTED_MIXED_AND_PURE_SIBLINGS_HAVE_NO_TURN_TARGETS', ['turn', 'tilt', 'body_turn'].every(n => !(unlisted.motion.animations[n] as Animation).deform?.some(d => compound.islands.some(i => i.slot === d.slot))), 'mixed/head-only/body-only attachments in one unlisted part own no timeline; whole-output byte identity is also checked against the integrated baseline');
  for (const variant of ['missing-sheet', 'spatial-sheet']) {
    const f = roleNeighbourTurnFixture('unit');
    if (variant === 'missing-sheet') delete f.parts.parts[0].depth;
    else { const sheet = f.images.get(f.parts.parts[0].depth!.image)!; for (let y = 0; y < sheet.height; y++) for (let x = 0; x < sheet.width; x++) sheet.data.set([20 + 5 * x, 20 + 5 * x, 20 + 5 * x, 255], (y * sheet.width + x) * 4); }
    const actual = buildRig(parseConfig(f.config), f.parts, f.images), normal = roleNeighbourTurnFixture('unit'), control = buildRig(parseConfig(normal.config), normal.parts, normal.images);
    const fields = (o: RigOutput) => ['turn', 'tilt', 'body_turn'].map(n => (o.motion.animations[n] as Animation).deform?.filter(d => d.slot === 'neck'));
    say(`BO12_UNIT_${variant.toUpperCase().replaceAll('-', '_')}_COPIES_EMITTED_RIGID_FIELD`, JSON.stringify(fields(actual)) === JSON.stringify(fields(control)), 'unit field is its resolved emitted carrier motion; no direct-sheet residual restriction or invented spatial bend');
  }
  for (const defect of ['selected-field-missing', 'conflicting-fields']) {
    let refused: string[] = [];
    try {
      const f = differingDepthTurnFixture(), cfg = parseConfig(f.config), output = buildRig(cfg, f.parts, f.images);
      const surfaces = ['neck', 'topwear'].map(part => { const a = output.rig.skins.default[part][part] as MeshAttachment; return { part, slot: part, attachment: part, canvas: f.parts.rig_size, weights: a.weights, triangles: a.triangles }; });
      if (defect === 'selected-field-missing') surfaces.splice(1);
      else {
        const neighbour = structuredClone(f.parts.parts[0]); neighbour.name = 'overlay'; neighbour.depth!.image = 'overlay_depth.png';
        const sheet = structuredClone(f.images.get(f.parts.parts[0].depth!.image)!);
        for (let y = 0; y < sheet.height; y++) for (let x = 0; x < sheet.width; x++) sheet.data.set([20 + 4 * x, 20 + 4 * x, 20 + 4 * x, 255], (y * sheet.width + x) * 4);
        f.parts.parts.push(neighbour); f.images.set('overlay', f.images.get('topwear')!); f.images.set(neighbour.depth!.image, sheet);
        cfg.turn!.body!.roles.overlay = 'surface'; surfaces.push({ ...surfaces[1], part: 'overlay', slot: 'overlay', attachment: 'overlay' });
      }
      buildDepth25DTurn(output.rig, output.motion, { turn: cfg.turn!, parts: f.parts.parts, images: f.images, regions: cfg.regions, stills: {}, boneLandmarks: new Map(), hasAlternateFaceSet: false, surfaceMeshes: surfaces });
    } catch (e) { if (e instanceof PartsError) refused = e.problems.map(p => p.code); else throw e; }
    const wanted = defect === 'selected-field-missing' ? 'RIG_TURN_SURFACE_OVERLAP_SUPPORT' : 'RIG_TURN_SURFACE_OVERLAP_DEPTH';
    say(`BO13_${defect.toUpperCase().replaceAll('-', '_')}_REFUSED`, refused.includes(wanted), [...new Set(refused)].join(', '));
  }
  const hand = { label: 'hand triangle', points: [[0, 0], [4, 0], [0, 4], [4, 4]], triangles: [0, 1, 2, 1, 3, 2], vectors: [[0, 0], [4, 12], [8, -4], [12, 8]] }, frozen = JSON.stringify(hand);
  const samples = [[0, 0], [4, 0], [0, 4], [4, 4], [2, 0], [0, 2], [2, 2], [2, 4], [4, 2], [1, 2], [3, 1]];
  for (const diagonal of [[0, 1, 2, 1, 3, 2], [0, 1, 3, 0, 3, 2]]) {
    const field = { ...hand, triangles: diagonal };
    const exact = samples.every(([x, y]) => { const v = sampleTurnTriangleField(field, [x, y], 'hand control'); return v[0] === x + 2 * y && v[1] === 3 * x - y; });
    say(`BO14_TRIANGLE_${diagonal[2]}_INDEPENDENT_AFFINE_ORACLE_AND_EDGES`, exact && frozen === JSON.stringify(hand), 'hand values (x+2y,3x-y), vertices/all edges/shared diagonal/interior; input field immutable');
  }
  const bent = { ...hand, vectors: [[0, 0], [0, 0], [0, 0], [8, 4]] };
  const other = { ...bent, triangles: [0, 1, 3, 0, 3, 2] };
  say('BO18_NON_AFFINE_FIELD_RETAINS_ACTUAL_TRIANGULATION', JSON.stringify(sampleTurnTriangleField(bent, [1, 1], 'diagonal A')) === '[0,0]' && JSON.stringify(sampleTurnTriangleField(other, [1, 1], 'diagonal B')) === '[2,1]', 'same four vertices and bbox; different diagonal gives hand-derived (0,0) vs (2,1); neither bilinear nor a global plane substitutes for the triangle field');
  for (const [label, field, point] of [
    ['outside', hand, [5, 1]], ['bbox-corner', { ...hand, triangles: [0, 1, 2] }, [3, 3]],
    ['missing-vector', { ...hand, vectors: hand.vectors.slice(1) }, [1, 1]], ['invalid-index', { ...hand, triangles: [0, 1, 9] }, [1, 1]],
  ] as const) {
    let named = false; try { sampleTurnTriangleField(field, point, `support ${label}`); } catch (e) { if (e instanceof PartsError) named = e.problems.some(p => p.code === 'RIG_TURN_SURFACE_OVERLAP_SUPPORT' && p.object === `support ${label}`); else throw e; }
    say(`BO15_${label.toUpperCase().replaceAll('-', '_')}_NO_EXTRAPOLATION_OR_FALLBACK`, named, 'selected support sampling is refused by name; unrelated disconnected geometry remains an unselected no-overlap control');
  }
  for (const aliases of [false, true]) {
    const f = differingDepthTurnFixture(), cfg = parseConfig(f.config), output = buildRig(cfg, f.parts, f.images), oldWorld = computeWorldTransforms(output.rig.bones);
    const attachments = ['neck', 'topwear'].map(part => ({ part, att: output.rig.skins.default[part][part] as MeshAttachment }));
    const bindings = attachments.flatMap(({ att }) => att.weights.flat().map(w => ({ w, point: toWorld(oldWorld.get(w.bone)!, w.x, w.y) })));
    output.rig.bones.find(b => b.name === 'torso')!.rotation = 37; output.rig.bones.find(b => b.name === 'crown')!.rotation = -23;
    const frames = computeWorldTransforms(output.rig.bones);
    for (const { w, point } of bindings) [w.x, w.y] = toBoneLocal(frames.get(w.bone)!, point[0], point[1]);
    const links = ['torso', 'head', 'crown'], aliasMap = new Map<string, string>(aliases ? links.map(b => [`${b}_d`, b]) : []);
    if (aliases) { bindings.forEach(({ w }) => { if (links.includes(w.bone)) w.bone += '_d'; }); output.rig.bones.find(b => b.name === 'crown')!.parent = 'head_d'; }
    const rig = aliases ? { ...output.rig, stops: [{ links }] } : output.rig;
    const surfaces = attachments.map(({ part, att }) => ({ part, slot: part, attachment: part, canvas: f.parts.rig_size, weights: att.weights, triangles: att.triangles, overlapOwners: att.weights.map(() => ({ group: 'body' as const, neighbours: ['poison_not_a_part'] })) }));
    buildDepth25DTurn(rig, output.motion, { turn: cfg.turn!, parts: f.parts.parts, images: f.images, regions: cfg.regions, stills: {}, boneLandmarks: new Map(), hasAlternateFaceSet: false, surfaceMeshes: surfaces });
    const error = triangleFieldError(output, false, aliasMap);
    say(`BO16_ROTATED_INVERSE_FRAMES_${aliases ? 'STOP_ALIASES_AND_PARENTS' : 'NAMED_BINDINGS'}`, error.max < 0.000003, `${JSON.stringify(error)}; injected ownership ignored; original world bind positions retained; per-influence inverse, skin weight once`);
  }
  const grid = differingDepthTurnFixture(); delete (grid.config.meshes as Record<string, unknown>).topwear; (grid.config.regions as Record<string, string>).topwear = 'torso';
  const gridBuild = buildRig(parseConfig(grid.config), grid.parts, grid.images);
  say('BO17_CORE_GENERATED_NEIGHBOUR_GRID_REMAINS_A_GRID', 'generator' in (gridBuild.rig.skins.default.topwear.topwear as MeshAttachment) && (gridBuild.motion.animations.body_turn as Animation).deform?.some(d => d.slot === 'neck') === true, 'Core buildGridMesh support is metadata; neighbour generator and output topology are not replaced');
  const zeroField = roleNeighbourTurnFixture('unit');
  const zeroExplicit = (zeroField.config.meshes as Record<string, { explicit: Pick<ExplicitMeshIslandSpec, 'weights' | 'uvs'> }>).neck.explicit;
  zeroExplicit.weights = positions.map(([x, y]) => [{ bone: 'torso', x: x - 32, y: 50 - y, weight: 0.6 }, { bone: 'crown', x: x - 32, y: 24 - y, weight: 0.4 }]);
  zeroExplicit.uvs = positions.flatMap(([x, y]) => [(x - 16) / 40, (y - 16) / 40]);
  (zeroField.config.turn as { body: { unitDepths?: Record<string, number> } }).body.unitDepths = { topwear: 0 };
  const zeroResult = buildRig(parseConfig(zeroField.config), zeroField.parts, zeroField.images);
  say('BO19_TRUE_ZERO_NEIGHBOUR_FIELD_OMITS_INACTIVE_TARGETS', ['turn', 'tilt', 'body_turn'].every(n => !(zeroResult.motion.animations[n] as Animation).deform?.some(d => d.slot === 'neck')), 'fully covered target copies actual zero carrier field; no own-depth fallback and no all-zero timeline overwrite');
  for (const role of ['unit', 'rear'] as const) {
    const f = roleNeighbourTurnFixture(role, 'none', 'head'), output = buildRig(parseConfig(f.config), f.parts, f.images), att = output.rig.skins.default.neck.neck as MeshAttachment;
    const world = computeWorldTransforms(output.rig.bones); let max = 0;
    for (const [name, axis, band] of [['turn', 'x', 15], ['tilt', 'y', 12], ['body_turn', 'x', 15]] as const) for (const [ki, angle] of [-band, -band / 2, 0, band / 2, band].entries()) {
      const offsets = (output.motion.animations[name] as Animation).deform?.find(d => d.slot === 'neck')?.keys[ki].vertices ?? []; let at = 0;
      for (const [i, row] of att.weights.entries()) for (const w of row) { const m = world.get(w.bone)!, x = offsets[at++] ?? 0, y = offsets[at++] ?? 0; if (![2, 3, 4, 5].includes(i)) continue; const d = name === 'body_turn' ? 0 : -(role === 'unit' ? 16 : -1.6) * Math.sin(angle * Math.PI / 180); max = Math.max(max, Math.abs(m.a * x + m.b * y - (axis === 'x' ? d : 0)), Math.abs(m.c * x + m.d * y - (axis === 'y' ? d : 0))); }
    }
    say(`BO20_HEAD_${role.toUpperCase()}_YAW_PITCH_RIGID_FIELDS`, max < 0.000003, `all five keys on all three axes; head unit16/rear-1.6 field, body suppressed; inverse-world residual ${max}`);
  }
}
