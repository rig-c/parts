/** Weighted surface controls: flat art, analytic ramps, and the mandatory Core gate. */
import { runTurnCoverageChecks } from './check_turn_coverage.ts';
import { runTurnUnitChecks } from './check_turn_units.ts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abuttingSurfaceFixture, mixedDepthSurfaceFixture, sleeveSurfaceFixture, weightedSurfaceEarFixture, weightedSurfaceFixture } from '../fixtures/turn_surface.ts';
import { explicitFixture, explicitIslandsFixture } from '../fixtures/explicitmesh.ts';
import { block, rigImages, rigParts } from '../fixtures/rig.ts';
import { parseConfig } from '../src/config.ts';
import { buildRig, type MeshAttachment, type RigOutput } from '../src/rig.ts';
import { rigOutputTexts } from '../src/build.ts';
import { computeWorldTransforms, setupToPaintingPoint, toWorld } from '../src/coords.ts';
import { depthReading } from '../src/depthsheets.ts';
import { writePng } from '../src/raster/png.ts';
import { PartsError } from '../src/errors.ts';
import { pyRound } from '../src/round.ts';
import type { Raster } from '../src/raster/types.ts';
import { evaluateDeformTransform, type DeformTransform } from '@rig-c/core/deformgen';

type Say = (name: string, ok: boolean, detail: string) => void;
type Deform = { slot: string; attachment: string; keys: Array<{ t: number; vertices?: number[] }> };
type Animation = { duration: number; deform: Deform[] };
const meshOf = (b: RigOutput, name: string): MeshAttachment => b.rig.skins.default[name][name] as MeshAttachment;
type SurfaceFixture = ReturnType<typeof weightedSurfaceFixture>;
/** The record assemble writes for a declared set (issue #962: rig refuses a declared set with no record): every covered base part redrawn under its own slot. */
function withAssembledSet(f: SurfaceFixture, set: { name: string; parts?: string[]; hides?: string[] }): SurfaceFixture {
  (f.config.assemble as Record<string, unknown>).alternates = [{ ...set, source: 'other.png', full: 'full', head: 'head' }];
  const covered = f.parts.parts.filter(p => (set.parts ?? f.parts.parts.map(q => q.name)).includes(p.name) && !(set.hides ?? []).includes(p.name));
  for (const p of covered) f.images.set(`${set.name}_${p.name}`, f.images.get(p.name) as Raster);
  f.parts.alternates = [{ name: set.name, ...(set.parts === undefined ? {} : { parts: set.parts }), ...(set.hides === undefined ? {} : { hides: set.hides }),
    slots: Object.fromEntries(covered.map(p => [p.name, `${set.name}_${p.name}`])), records: covered.map(p => ({ ...p, depth: undefined })), ghost_px: {},
    recomposite: { mean_abs: 0, within_limit: 0, within_share: 1, error_limit: 0, error_px: 0, covered_alpha: 8, uncovered_error_px: 0, hole_count: 0, holes_listed: 0, holes: [] } }];
  return f;
}
const codes = (f: () => unknown): string[] => { try { f(); return []; } catch (e) { if (e instanceof PartsError) return e.problems.map(p => p.code); throw e; } };

/** Analytic oracle: these sheets are level=60+25*part+x+y; art is an opaque rectangle. */
function displacementError(built: RigOutput, plant: 'none' | 'plate' | 'weight-twice' = 'none'): { max: number; pairs: number; span: number } {
  const fixture = weightedSurfaceFixture(), world = computeWorldTransforms(built.rig.bones);
  let max = 0, pairs = 0, span = Infinity;
  for (const [axis, animName, names, band] of [
    ['yaw', 'turn', ['hair_back', 'hair_front'], 15],
    ['pitch', 'tilt', ['hair_back', 'hair_front'], 12],
    ['yaw', 'body_turn', ['topwear'], 15],
  ] as const) {
    const anim = built.motion.animations[animName] as unknown as Animation;
    for (const name of names) {
      const partIndex = fixture.parts.parts.findIndex(p => p.name === name), p = fixture.parts.parts[partIndex], att = meshOf(built, name);
      const deform = anim.deform.find(d => d.slot === name)!;
      const primaryIndex = animName === 'body_turn' ? 2 : 0, primary = fixture.parts.parts[primaryIndex];
      const zRef = pyRound((60 + 25 * primaryIndex + (primary.w - 1) / 2 + (primary.h - 1) / 2) * 40 / 255, 4);
      for (const [keyIndex, deg] of [[0, -band], [4, band]] as const) {
        const run = deform.keys[keyIndex].vertices!;
        let at = 0, lo = Infinity, hi = -Infinity;
        for (const row of att.weights) {
          let wx = 0, wy = 0;
          for (const w of row) { const [x, y] = toWorld(world.get(w.bone)!, w.x, w.y); wx += x * w.weight; wy += y * w.weight; }
          const [cx, cy] = setupToPaintingPoint([wx, wy], [64, 64], [64, 64]);
          const level = 60 + 25 * partIndex + Math.max(0, Math.min(p.w - 1, cx - p.x - 0.5)) + Math.max(0, Math.min(p.h - 1, cy - p.y - 0.5));
          const d = -(20 + level * 40 / 255 - zRef) * Math.sin(deg * Math.PI / 180);
          lo = Math.min(lo, d); hi = Math.max(hi, d);
          for (const w of row) {
            const m = world.get(w.bone)!;
            let x = run[at++], y = run[at++];
            if (plant === 'weight-twice') { x *= w.weight; y *= w.weight; }
            const dx = plant === 'plate' ? -20 * Math.sin(deg * Math.PI / 180) : m.a * x + m.b * y;
            const dy = plant === 'plate' ? -20 * Math.sin(deg * Math.PI / 180) : m.c * x + m.d * y;
            max = Math.max(max, Math.abs((axis === 'yaw' ? dx : dy) - d));
            if (plant === 'none') max = Math.max(max, Math.abs(axis === 'yaw' ? dy : dx));
            pairs++;
          }
        }
        if (at !== run.length) return { max: Infinity, pairs, span: 0 };
        span = Math.min(span, hi - lo);
      }
    }
  }
  return { max, pairs, span };
}

export function runTurnSurfaceChecks(dir: string, say: Say): void {
  runTurnSharedReferenceChecks(say);
  runTurnMixedDepthChecks(say);
  runSleeveSurfaceChecks(say);
  runTurnUnitChecks(say);
  runTurnCoverageChecks(say);
  const f = weightedSurfaceFixture(), before = JSON.stringify(f.config), built = buildRig(parseConfig(f.config), f.parts, f.images);
  const old = weightedSurfaceFixture(false), plain = buildRig(parseConfig(old.config), old.parts, old.images);
  const sameMeshes = f.parts.parts.every(p => JSON.stringify(meshOf(built, p.name)) === JSON.stringify(meshOf(plain, p.name)));
  const plainBones = new Map(plain.rig.bones.map(b => [b.name, b]));
  const sameBones = built.rig.bones.filter(b => plainBones.has(b.name)).every(b => JSON.stringify(b) === JSON.stringify(plainBones.get(b.name)));
  say('WTS01_AUTHORED_TOPOLOGY_BINDINGS_AND_PHYSICS_PRESERVED', sameMeshes && sameBones && JSON.stringify(f.config) === before && JSON.stringify(built.motion.animations.idle) === JSON.stringify(plain.motion.animations.idle) && JSON.stringify(built.rig.constraints?.filter(c => c.type === 'physics')) === JSON.stringify(plain.rig.constraints), 'two back chains; head + bang chain; torso chain; complete attachment bytes, existing bones, idle and all physics constraints identical to the no-turn source');
  const reading = displacementError(built), plate = displacementError(built, 'plate'), twice = displacementError(built, 'weight-twice');
  say('WTS02_EVERY_VERTEX_OWN_DEPTH_IN_EVERY_INFLUENCE', reading.max < 0.000003 && reading.span > 0.5 && plate.max > 0.5 && twice.max > 0.5, `head yaw +/-15 pitch +/-12; body yaw +/-15; ${reading.pairs} influence pairs; max bind-to-world error ${reading.max}; smallest displacement span ${reading.span}; plate plant ${plate.max}; double-weight plant ${twice.max}`);
  say('WTS03_ZERO_TURN_IS_EXPLICIT_SETUP_DEFORM', ['turn', 'tilt', 'body_turn'].every(name => (built.motion.animations[name] as unknown as Animation).deform.every(d => JSON.stringify(d.keys[2]) === JSON.stringify({ t: (built.motion.animations[name] as unknown as Animation).duration / 2 }))), 'every weighted surface has the empty setup key at the neutral slider position');
  const out = join(dir, 'weighted-surface'); mkdirSync(join(out, 'images'), { recursive: true });
  for (const [name, text] of rigOutputTexts(built, null)) writeFileSync(join(out, name), text);
  for (const [name, image] of built.images) writePng(join(out, 'images', name), image);
  const gate = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve('@rig-c/core/cli')), 'build', '--rig', join(out, 'rig.json'), '--motion', join(out, 'motion.json'), '--out', join(out, 'built'), '--profile', 'rig-play'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  writeFileSync(join(out, 'gate.log'), gate.stdout + gate.stderr);
  const skeleton = gate.status === 0 ? JSON.parse(readFileSync(join(out, 'built/skeleton.json'), 'utf8')) as { animations: Record<string, { attachments?: Record<string, Record<string, Record<string, { deform: Array<{ vertices?: number[] }> }>>> }> } : null;
  say('WTS04_CORE_ROUNDTRIP_GATE_ACCEPTS_WEIGHTED_DEFORM', gate.status === 0 && skeleton?.animations.turn.attachments?.default?.hair_back?.hair_back?.deform.some(k => (k.vertices?.length ?? 0) > 72) === true, `Core exit ${gate.status}; weighted deform is longer than one pair per UV; ${gate.status === 0 ? 'mandatory rig-play gate accepted' : gate.stdout + gate.stderr}`);
  const missing = weightedSurfaceFixture(); delete missing.parts.parts[0].depth;
  say('WTS05_MISSING_WEIGHTED_SURFACE_DEPTH_REFUSED', codes(() => buildRig(parseConfig(missing.config), missing.parts, missing.images)).includes('RIG_TURN_SURFACE_DEPTH_REQUIRED'), 'weighted topology does not excuse a missing own depth sheet');
  const shared = weightedSurfaceFixture(); (shared.config.turn as { roles: Record<string, string> }).roles.hair_front = 'unit';
  (shared.config.meshes as Record<string, unknown>).hair_front = { grid: 8, r: 20, segments: ['back_l'] };
  say('WTS06_SHARED_MOVING_ROLE_FRAME_REFUSED', codes(() => buildRig(parseConfig(shared.config), shared.parts, shared.images)).includes('RIG_TURN_SURFACE_MESH_BINDINGS'), 'a unit role cannot reparent a shared surface chain and silently add a second translation');
  const headOnBody = weightedSurfaceFixture();
  (headOnBody.config.meshes as Record<string, unknown>).hair_back = { grid: 8, r: 20, segments: ['cloth'] };
  headOnBody.config.turn = { pivot: 20, roles: { hair_back: 'surface' }, body: { pivot: 20, roles: { topwear: 'unit', hair_front: 'surface' } } };
  const bodyOnHead = weightedSurfaceFixture();
  (bodyOnHead.config.meshes as Record<string, unknown>).topwear = { grid: 8, r: 20, segments: ['back_l'] };
  bodyOnHead.config.turn = { pivot: 20, roles: { hair_back: 'unit', hair_front: 'surface' }, body: { pivot: 20, roles: { topwear: 'surface' } } };
  const crossHeadConfig = parseConfig(headOnBody.config), crossBodyConfig = parseConfig(bodyOnHead.config);
  say('WTS11_CROSS_GROUP_UNIT_CARRIERS_REFUSED', [() => buildRig(crossHeadConfig, headOnBody.parts, headOnBody.images), () => buildRig(crossBodyConfig, bodyOnHead.parts, bodyOnHead.images)].every(f => codes(f).includes('RIG_TURN_SURFACE_MESH_BINDINGS')), 'both configs parse: head surface on a body unit chain and body surface on a head unit chain are reachable; both refuse the moved frame by name');
  const headOnBodyRear = weightedSurfaceFixture();
  (headOnBodyRear.config.meshes as Record<string, unknown>).hair_back = { grid: 8, r: 20, segments: ['cloth'] };
  headOnBodyRear.config.turn = { pivot: 20, roles: { hair_back: 'surface' }, body: { pivot: 20, roles: { topwear: 'rear', hair_front: 'surface' } } };
  const bodyOnHeadRear = weightedSurfaceFixture();
  (bodyOnHeadRear.config.meshes as Record<string, unknown>).topwear = { grid: 8, r: 20, segments: ['back_l'] };
  bodyOnHeadRear.config.turn = { pivot: 20, roles: { hair_back: 'rear', hair_front: 'surface' }, body: { pivot: 20, roles: { topwear: 'surface' } } };
  const crossHeadRearConfig = parseConfig(headOnBodyRear.config), crossBodyRearConfig = parseConfig(bodyOnHeadRear.config);
  say('WTS12_CROSS_GROUP_REAR_CARRIERS_REFUSED', [() => buildRig(crossHeadRearConfig, headOnBodyRear.parts, headOnBodyRear.images), () => buildRig(crossBodyRearConfig, bodyOnHeadRear.parts, bodyOnHeadRear.images)].every(f => codes(f).includes('RIG_TURN_SURFACE_MESH_BINDINGS')), 'both rear cross-group configs also parse; another group carrier cannot silently add its depth shift');
  const alternate = withAssembledSet(weightedSurfaceFixture(), { name: 'other', parts: ['hair_back'] });
  say('WTS10_UNREGISTERED_ALTERNATE_SURFACE_FRAME_REFUSED', codes(() => buildRig(parseConfig(alternate.config), alternate.parts, alternate.images)).includes('RIG_TURN_SURFACE_MESH_ATTACHMENT'), 'another drawing cannot silently reuse the base part depth and setup frame');
  const omitted = withAssembledSet(weightedSurfaceFixture(), { name: 'other' });
  say('WTS13_OMITTED_ALTERNATE_PARTS_COVERS_ALL_BASE_PARTS', codes(() => buildRig(parseConfig(omitted.config), omitted.parts, omitted.images)).includes('RIG_TURN_SURFACE_MESH_ATTACHMENT'), 'omitting parts means every base part, so a surface mesh still requires a registered alternate frame');
  const hidden = weightedSurfaceFixture();
  hidden.config.turn = { pivot: 20, roles: { hair_back: 'surface', hair_front: 'unit' } };
  withAssembledSet(hidden, { name: 'other', hides: ['hair_back'] });
  say('WTS14_OMITTED_PARTS_WITH_HIDDEN_SURFACE_IS_ACCEPTED', codes(() => buildRig(parseConfig(hidden.config), hidden.parts, hidden.images)).length === 0, 'omitted parts minus hides does not cover this surface; no frame is invented and no unrelated alternate is refused');
  const unrelated = weightedSurfaceFixture();
  unrelated.config.turn = { pivot: 20, roles: { hair_back: 'surface', hair_front: 'unit' } };
  withAssembledSet(unrelated, { name: 'other', parts: ['hair_front'] });
  say('WTS15_UNRELATED_ALTERNATE_SUBSET_IS_ACCEPTED', codes(() => buildRig(parseConfig(unrelated.config), unrelated.parts, unrelated.images)).length === 0, 'an explicit subset not covering the surface keeps the existing path');
  const earOrder = weightedSurfaceEarFixture(), earLate = weightedSurfaceEarFixture(true);
  const earBuild = buildRig(parseConfig(earOrder.config), earOrder.parts, earOrder.images);
  say('WTS16_EARS_BETWEEN_BACK_AND_FACE_SURFACES_ACCEPTED', earBuild.rig.slots.map(s => s.name).join(',') === 'hair_back,ear_r,ear_l,face,hair_front,topwear', 'back surface < ears < face surface < bang surface; actual rig slots retain that order');
  let lateProblems: PartsError | undefined;
  try { parseConfig(earLate.config); } catch (e) { if (e instanceof PartsError) lateProblems = e; else throw e; }
  say('WTS17_EAR_AFTER_FACE_STILL_REFUSED_BY_NAME', lateProblems?.problems.filter(p => p.code === 'CONFIG_TURN_EAR_DRAW_ORDER').length === 2 && lateProblems.problems.filter(p => p.code === 'CONFIG_TURN_EAR_DRAW_ORDER').every(p => p.detail.includes('surface part "face"') && !p.detail.includes('"hair_back"')), 'both ears after the face fail CONFIG_TURN_EAR_DRAW_ORDER; back and front surfaces do not own cheek occlusion');
  const fringe = (background: number) => {
    const f = weightedSurfaceFixture();
    for (const p of f.parts.parts) {
      const art = f.images.get(p.name)!, sheet = f.images.get(p.depth!.image)!;
      for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
        const i = (y * p.w + x) * 4;
        if (x === 0 || y === 0 || x === p.w - 1 || y === p.h - 1) { art.data[i + 3] = x === 0 ? 127 : 0; sheet.data.set([background, background, background, 255], i); }
      }
      p.opaque_px = (p.w - 2) * (p.h - 2) + p.h;
    }
    return buildRig(parseConfig(f.config), f.parts, f.images);
  };
  const dark = fringe(0), bright = fringe(255);
  // A constant shift cancels against zRef; the plant changes a sampled opaque seed.
  const seed = weightedSurfaceFixture(); seed.images.get('hair_back_depth.png')!.data.set([240, 240, 240, 255], (12 * 32 + 12) * 4);
  const changedSeed = buildRig(parseConfig(seed.config), seed.parts, seed.images);
  say('WTS09_TRANSPARENT_FRINGE_USES_OPAQUE_SILHOUETTE_EXTENSION', JSON.stringify(dark.motion) === JSON.stringify(bright.motion) && JSON.stringify(changedSeed.motion) !== JSON.stringify(built.motion), 'transparent and alpha127 border levels 0/255 give identical keys; an opaque seed change moves the sampled field');
  for (const islands of [false, true]) {
    const ex = islands ? explicitIslandsFixture() : explicitFixture();
    const parts = islands ? explicitIslandsFixture().parts : rigParts(), images = islands ? explicitIslandsFixture().images : rigImages();
    const p = parts.parts[0], scalar = block(p.w, p.h);
    // The block's RGB is replaced by one constant scalar; art stays unchanged.
    for (let i = 0; i < p.w * p.h; i++) scalar.data.set([120, 120, 120, 255], i * 4);
    p.depth = { image: 'cloth_depth.png', near: 'black', zScale: 40, sources: [{ from: p.from, image: 'scalar.png', sha256: '0'.repeat(64), crop: [p.x, p.y, p.x + p.w, p.y + p.h], reading: depthReading(scalar, images.get('cloth')!, null) }] };
    images.set(p.depth.image, scalar);
    (ex.config.bones as unknown[]).push({ name: 'head', parent: 'body', at: [20, 30] });
    ex.config.turn = { pivot: 20, grid: [40, 40], roles: { cloth: 'surface' } };
    const result = buildRig(parseConfig(ex.config), parts, images), deforms = (result.motion.animations.turn as unknown as Animation).deform;
    const payloads = islands ? ('islands' in ex.mesh.explicit ? ex.mesh.explicit.islands! : []) : [{ slot: 'cloth', ...ex.mesh.explicit }];
    say(islands ? 'WTS08_EXPLICIT_ISLANDS_KEEP_THEIR_OWN_BINDINGS' : 'WTS07_EXPLICIT_PAYLOAD_NOT_REGENERATED', payloads.every(payload => {
      const att = result.rig.skins.default[payload.slot][payload.slot] as MeshAttachment;
      return JSON.stringify(att.weights) === JSON.stringify(payload.weights) && JSON.stringify(att.uvs) === JSON.stringify(payload.uvs) && JSON.stringify(att.triangles) === JSON.stringify(payload.triangles) && att.hull === payload.hull && deforms.some(d => d.slot === payload.slot && d.attachment === payload.slot && d.keys[0].vertices?.length === 2 * att.weights.flat().length);
    }), `${payloads.length} explicit attachment(s); authored floats, hull, UVs, triangles, weight ordering unchanged; oversized turn.grid ignored for authored meshes`);
  }
}

/** Read emitted bind-space offsets or Core's emitted grid transform plus carrier tracks. */
export function sharedReferenceReadings(group: 'head' | 'body', authored: boolean, eyes = false, build: typeof buildRig = buildRig) {
  const f = abuttingSurfaceFixture(group, authored, eyes), built = build(parseConfig(f.config), f.parts, f.images);
  const world = computeWorldTransforms(built.rig.bones);
  const reference = pyRound((eyes ? 56 : 70) * 40 / 255, 4);
  const readings = [];
  for (const [animName, band, axis] of group === 'head'
    ? [['turn', 15, 0], ['tilt', 12, 1]] as const : [['body_turn', 15, 0]] as const) {
    const anim = built.motion.animations[animName] as unknown as {
      tracks: Array<{ bone?: string; property: string; keys: Array<{ derive?: { depth?: number }; v?: number[] }> }>;
      deform: Array<{ slot: string; keys: Array<{ vertices?: number[]; transform?: DeformTransform }> }>;
    };
    for (const [ki, degrees] of [[0, -band], [4, band]] as const) {
      const sides: number[][] = [], errors: number[] = [];
      for (const [pi, p] of f.parts.parts.entries()) {
        const key = anim.deform.find(d => d.slot === p.name)!.keys[ki];
        const att = meshOf(built, p.name), values: number[] = [];
        // At y=28 the two source edges are levels 100 and 104. A shared anchor
        // cancels from their difference, leaving only that four-level step.
        const level = pi === 0 ? 100 : 104;
        const expected = -(20 + level * 40 / 255 - reference) * Math.sin(degrees * Math.PI / 180);
        if (authored) {
          let at = 0;
          for (const row of att.weights) {
            let wx = 0, wy = 0, dx = 0, dy = 0;
            for (const w of row) {
              const m = world.get(w.bone)!, [x, y] = toWorld(m, w.x, w.y);
              wx += x * w.weight; wy += y * w.weight;
              const vx = key.vertices![at++], vy = key.vertices![at++];
              dx += (m.a * vx + m.b * vy) * w.weight; dy += (m.c * vx + m.d * vy) * w.weight;
            }
            const [cx, cy] = setupToPaintingPoint([wx, wy], [64, 64], [64, 64]);
            if (Math.abs(cy - 28) < 0.000001 && cx >= p.x && cx <= p.x + p.w) values.push(axis === 0 ? dx : dy);
          }
        } else {
          const shift = anim.tracks.filter(t => t.bone === `${p.name}_surface` || t.bone === (group === 'head' ? 'faceshift' : 'bodyshift'))
            .reduce((sum, t) => sum - (t.keys[ki].derive?.depth ?? 0) * Math.sin(degrees * Math.PI / 180), 0);
          const generator = att.generator!;
          if (generator.kind !== 'grid' || generator.depth === undefined || key.transform === undefined) throw new Error('missing emitted depth grid');
          const scalar = new Map(built.images).get(generator.depth.image)!;
          // Actual emitted padded sheet at the adjacent opaque row, all columns.
          for (let x = 0; x < p.w; x++) {
            const y = pi === 0 ? p.h - 1 : 0;
            const v = scalar.data[((y + 4) * scalar.width + x + 4) * 4];
            const z = (generator.depth.near === 'white' ? v : 255 - v) * generator.depth.zScale / 255;
            values.push(evaluateDeformTransform(key.transform, [0, 0], n => n, 'abutting grid', [z]).offsets[axis] + shift);
          }
        }
        errors.push(...values.map(v => Math.abs(v - expected)));
        sides.push(values);
      }
      const jumps = sides[0].flatMap(a => sides[1].map(b => Math.abs(a - b)));
      const bound = 4 * 40 / 255 * Math.abs(Math.sin(degrees * Math.PI / 180));
      readings.push({ animName, degrees, samples: sides.map(s => s.length), dx: sides.map(s => s[0]),
        mean: jumps.reduce((a, b) => a + b, 0) / jumps.length, max: Math.max(...jumps), bound, error: Math.max(...errors) });
    }
  }
  return { built, readings };
}

export function runTurnSharedReferenceChecks(say: Say, build: typeof buildRig = buildRig): void {
  for (const group of ['body', 'head'] as const) for (const authored of [false, true]) {
    const cases = group === 'head' ? [false, true] : [false];
    const readings = cases.flatMap(eyes => sharedReferenceReadings(group, authored, eyes, build).readings.map(r => ({ eyes, ...r })));
    // Authored offsets round each bind vector to six decimals. Two identity
    // bindings differ by at most two half-units of that decimal grid.
    const tolerance = 2 * 0.5 * 10 ** -6;
    say(`WTS${group === 'body' ? (authored ? '19' : '18') : (authored ? '21' : '20')}_SHARED_REFERENCE_${group.toUpperCase()}_${authored ? 'AUTHORED' : 'GRID'}`,
      readings.every(r => r.samples.every(n => n > 0) && r.max <= r.bound + tolerance && r.error <= tolerance),
      JSON.stringify(readings));
  }
}

/** Read the emitted head field, including grid carrier translations or every
 * authored influence in its setup frame. Bounds use the encoded fixture's
 * depth interval and the declared pivot, not a tuned travel threshold.
 */
export function mixedDepthReadings(authored: boolean, inFront = false, reparameterized = false, build: typeof buildRig = buildRig) {
  const f = mixedDepthSurfaceFixture(authored, inFront, reparameterized), built = build(parseConfig(f.config), f.parts, f.images);
  const world = computeWorldTransforms(built.rig.bones), face = f.parts.parts[0], levels: number[] = [];
  const faceSheet = f.images.get(face.depth!.image)!;
  for (let i = 0; i < face.w * face.h; i++) levels.push(faceSheet.data[i * 4]);
  levels.sort((a, b) => a - b);
  const zScale = face.depth!.zScale, pivot = zScale / 2;
  const zRef = pyRound((levels[(levels.length - 1) >> 1] + levels[levels.length >> 1]) / 2 * zScale / 255, 4);
  const readings = [];
  for (const [animName, band, axis] of [['turn', 15, 0], ['tilt', 12, 1]] as const) {
    const anim = built.motion.animations[animName] as unknown as {
      tracks: Array<{ bone?: string; keys: Array<{ derive?: { depth?: number } }> }>;
      deform: Array<{ slot: string; keys: Array<{ vertices?: number[]; transform?: DeformTransform }> }>;
    };
    for (const [ki, degrees] of [[0, -band], [4, band]] as const) {
      const sine = Math.sin(degrees * Math.PI / 180), parts = [];
      for (const p of f.parts.parts) {
        const sheet = f.images.get(p.depth!.image)!, key = anim.deform.find(d => d.slot === p.name)!.keys[ki];
        const att = meshOf(built, p.name), values: number[] = [], encoded: number[] = [];
        for (let i = 0; i < p.w * p.h; i++) encoded.push(sheet.data[i * 4] * zScale / 255);
        let error = 0;
        if (authored) {
          let at = 0;
          for (const row of att.weights) {
            let wx = 0, wy = 0, dx = 0, dy = 0;
            for (const w of row) {
              const m = world.get(w.bone)!, [x, y] = toWorld(m, w.x, w.y);
              wx += x * w.weight; wy += y * w.weight;
              const vx = key.vertices![at++], vy = key.vertices![at++];
              dx += (m.a * vx + m.b * vy) * w.weight; dy += (m.c * vx + m.d * vy) * w.weight;
            }
            const [cx, cy] = setupToPaintingPoint([wx, wy], [64, 64], [64, 64]);
            // Independent bilinear sample of the unpadded opaque rectangle.
            const fx = cx - p.x - 0.5, fy = cy - p.y - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
            const zAt = (x: number, y: number) => encoded[Math.max(0, Math.min(p.h - 1, y)) * p.w + Math.max(0, Math.min(p.w - 1, x))];
            const z = (1 - ay) * ((1 - ax) * zAt(ix, iy) + ax * zAt(ix + 1, iy)) + ay * ((1 - ax) * zAt(ix, iy + 1) + ax * zAt(ix + 1, iy + 1));
            const actual = axis === 0 ? dx : dy;
            values.push(actual); error = Math.max(error, Math.abs(actual + (pivot + z - zRef) * sine));
          }
        } else {
          const shift = anim.tracks.filter(t => t.bone === `${p.name}_surface` || t.bone === 'faceshift').reduce((sum, t) => sum - (t.keys[ki].derive?.depth ?? 0) * sine, 0);
          const generator = att.generator!;
          if (generator.kind !== 'grid' || generator.depth === undefined || key.transform === undefined) throw new Error('missing emitted mixed-source depth grid');
          const emitted = new Map(built.images).get(generator.depth.image)!;
          // All original opaque scalar texels in Core's emitted padded image.
          const px = (emitted.width - p.w) / 2, py = (emitted.height - p.h) / 2;
          for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
            const z = emitted.data[((y + py) * emitted.width + x + px) * 4] * generator.depth.zScale / 255;
            const actual = evaluateDeformTransform(key.transform, [0, 0], n => n, 'mixed-source grid', [z]).offsets[axis] + shift;
            values.push(actual); error = Math.max(error, Math.abs(actual + (pivot + encoded[y * p.w + x] - zRef) * sine));
          }
        }
        const minZ = Math.min(...encoded), maxZ = Math.max(...encoded);
        const bound = Math.max(Math.abs(pivot + minZ - zRef), Math.abs(pivot + maxZ - zRef)) * Math.abs(sine);
        parts.push({ part: p.name, samples: values.length, minZ, maxZ, minTravel: Math.min(...values.map(Math.abs)), maxTravel: Math.max(...values.map(Math.abs)), meanTravel: values.reduce((s, v) => s + Math.abs(v), 0) / values.length, signed: [Math.min(...values), Math.max(...values)], bound, error });
      }
      const [front, back] = parts;
      readings.push({ animName, degrees, parts, behind: back.maxZ < front.minZ, outruns: back.maxTravel > front.maxTravel });
    }
  }
  return { built, declarations: f.declarations, zScale, zRef, readings };
}

export function runTurnMixedDepthChecks(say: Say): void {
  // A world offset is rounded to six decimals once per authored influence.
  const tolerance = 0.5 * 10 ** -6;
  for (const authored of [false, true]) {
    const base = mixedDepthReadings(authored), affine = mixedDepthReadings(authored, false, true), plant = mixedDepthReadings(authored, true);
    let maxLevelDelta = 0;
    const sameImages = base.built.images.length === affine.built.images.length && base.built.images.every(([name, image], i) => {
      const [otherName, other] = affine.built.images[i];
      if (name !== otherName || image.width !== other.width || image.height !== other.height) return false;
      for (let j = 0; j < image.data.length; j++) maxLevelDelta = Math.max(maxLevelDelta, Math.abs(image.data[j] - other.data[j]));
      return true;
    });
    // Floating arithmetic at an even rounding tie can change one encoded
    // level. Propagate that measured quantum and the changed shared anchor.
    const affineBounds = base.readings.map((r, i) => {
      const bound = (maxLevelDelta * base.zScale / 255 + Math.abs(base.zRef - affine.zRef)) * Math.abs(Math.sin(r.degrees * Math.PI / 180)) + 2 * tolerance;
      const delta = Math.max(...r.parts.flatMap((p, pi) => [Math.abs(p.meanTravel - affine.readings[i].parts[pi].meanTravel), ...p.signed.map((v, j) => Math.abs(v - affine.readings[i].parts[pi].signed[j]))]));
      return { bound, delta };
    });
    const sameUnits = sameImages && maxLevelDelta <= 1 && affineBounds.every(r => r.delta <= r.bound);
    const withinBounds = base.readings.every(r => r.behind && !r.outruns && r.parts.every(p => p.samples > 0 && p.maxTravel <= p.bound + tolerance && p.error <= tolerance));
    const caughtPlant = plant.readings.every(r => !r.behind && r.outruns);
    say(`WTS${authored ? '23' : '22'}_MIXED_SOURCE_HEAD_${authored ? 'AUTHORED' : 'GRID'}`, withinBounds && sameUnits && caughtPlant,
      JSON.stringify({ declarations: base.declarations, zRef: base.zRef, maxLevelDelta, affineBounds, readings: base.readings, frontDeclarationPlant: plant.readings }));
  }
}

/** Measure emitted body keys; own-median readings emulate only the old anchor shift. */
export function sleeveSurfaceReadings(authored: boolean, build: typeof buildRig = buildRig) {
  const f = sleeveSurfaceFixture(authored), built = build(parseConfig(f.config), f.parts, f.images);
  const world = computeWorldTransforms(built.rig.bones);
  const medians = [74, 134, 198].map(v => pyRound(v * 40 / 255, 4));
  const anim = built.motion.animations.body_turn as unknown as {
    tracks: Array<{ bone?: string; keys: Array<{ derive?: { depth?: number } }> }>;
    deform: Array<{ slot: string; keys: Array<{ vertices?: number[]; transform?: DeformTransform }> }>;
  };
  const readings = [];
  for (const [ki, degrees] of [[0, -15], [4, 15]] as const) {
    const sine = Math.sin(degrees * Math.PI / 180);
    const surfaces = f.parts.parts.map((p, pi) => {
      const key = anim.deform.find(d => d.slot === p.name)!.keys[ki], att = meshOf(built, p.name);
      const samples: Array<{ y: number; dx: number }> = [];
      if (authored) {
        let at = 0;
        for (const row of att.weights) {
          let wx = 0, wy = 0, dx = 0;
          for (const w of row) {
            const m = world.get(w.bone)!, [x, y] = toWorld(m, w.x, w.y);
            wx += x * w.weight; wy += y * w.weight;
            const vx = key.vertices![at++], vy = key.vertices![at++];
            dx += (m.a * vx + m.b * vy) * w.weight;
          }
          const [, y] = setupToPaintingPoint([wx, wy], [64, 64], [64, 64]);
          samples.push({ y, dx });
        }
      } else {
        const shift = anim.tracks.filter(t => t.bone === `${p.name}_surface` || t.bone === 'bodyshift')
          .reduce((sum, t) => sum - (t.keys[ki].derive?.depth ?? 0) * sine, 0);
        const generator = att.generator!;
        if (generator.kind !== 'grid' || generator.depth === undefined || key.transform === undefined) throw new Error('missing emitted depth grid');
        const scalar = new Map(built.images).get(generator.depth.image)!;
        for (let y = 0; y < p.h; y++) {
          const level = scalar.data[((y + 4) * scalar.width + 4) * 4];
          const z = level * generator.depth.zScale / 255;
          samples.push({ y: p.y + (y === p.h - 1 ? p.h : y), dx: evaluateDeformTransform(key.transform, [0, 0], n => n, 'body ramp', [z]).offsets[0] + shift });
        }
      }
      const edge = (y: number) => samples.filter(s => Math.abs(s.y - y) < 1e-6).map(s => s.dx);
      const ownShift = (medians[pi] - medians[0]) * sine;
      const values = samples.map(s => s.dx);
      return { part: p.name, samples: samples.length, meanDx: values.reduce((a, b) => a + b, 0) / values.length,
        ownMedianMeanDx: values.reduce((a, b) => a + b, 0) / values.length + ownShift,
        top: edge(p.y), bottom: edge(p.y + p.h), ownShift };
    });
    const seams = surfaces.slice(0, -1).map((a, i) => {
      const b = surfaces[i + 1], jumps = a.bottom.flatMap(x => b.top.map(y => Math.abs(x - y)));
      const own = a.bottom.flatMap(x => b.top.map(y => Math.abs(x + a.ownShift - y - b.ownShift)));
      return { pair: [a.part, b.part], samples: jumps.length, sharedMax: Math.max(...jumps), ownMedianMax: Math.max(...own) };
    });
    readings.push({ degrees, surfaces, seams });
  }
  return { built, readings };
}

export function runSleeveSurfaceChecks(say: Say, build: typeof buildRig = buildRig): void {
  for (const authored of [false, true]) {
    const { readings } = sleeveSurfaceReadings(authored, build);
    // Each authored offset rounds to six places: a seam subtracts two offsets.
    const tolerance = 2 * 0.5 * 10 ** -6;
    const sine = Math.sin(15 * Math.PI / 180);
    say(`WTS${authored ? '25' : '24'}_SLEEVE_SHARED_REFERENCE_${authored ? 'AUTHORED' : 'GRID'}`,
      readings.every(r => r.surfaces.every((s, i) => {
        const z = [74, 134, 198][i] * 40 / 255, reference = pyRound(74 * 40 / 255, 4);
        const expected = -(20 + z - reference) * Math.sin(r.degrees * Math.PI / 180);
        return s.samples > 0 && s.top.length > 0 && s.bottom.length > 0 && Math.abs(s.meanDx - expected) <= tolerance;
      }) &&
        r.seams.every(s => s.samples > 0) &&
        Math.abs(r.seams[0].sharedMax - 60 * 40 / 255 * sine) <= tolerance &&
        r.seams[0].sharedMax > r.seams[0].ownMedianMax &&
        Math.abs(r.seams[1].sharedMax - 4 * 40 / 255 * sine) <= tolerance &&
        r.seams[1].sharedMax < r.seams[1].ownMedianMax), JSON.stringify(readings));
  }
}
