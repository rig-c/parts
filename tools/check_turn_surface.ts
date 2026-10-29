/** Weighted surface controls: flat art, analytic ramps, and the mandatory Core gate. */
import { runTurnUnitChecks } from './check_turn_units.ts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { weightedSurfaceEarFixture, weightedSurfaceFixture } from '../fixtures/turn_surface.ts';
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

type Say = (name: string, ok: boolean, detail: string) => void;
type Deform = { slot: string; attachment: string; keys: Array<{ t: number; vertices?: number[] }> };
type Animation = { duration: number; deform: Deform[] };
const meshOf = (b: RigOutput, name: string): MeshAttachment => b.rig.skins.default[name][name] as MeshAttachment;
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
      const zRef = pyRound((60 + 25 * partIndex + (p.w - 1) / 2 + (p.h - 1) / 2) * 40 / 255, 4);
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
  runTurnUnitChecks(say);
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
  const gate = spawnSync(process.execPath, [resolve('node_modules/@rig-c/core/cli.ts'), 'build', '--rig', join(out, 'rig.json'), '--motion', join(out, 'motion.json'), '--out', join(out, 'built'), '--profile', 'rig-play'], { encoding: 'utf8', maxBuffer: 1 << 26 });
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
  const alternate = weightedSurfaceFixture();
  (alternate.config.assemble as Record<string, unknown>).alternates = [{ name: 'other', source: 'other.png', full: 'full', head: 'head', parts: ['hair_back'] }];
  say('WTS10_UNREGISTERED_ALTERNATE_SURFACE_FRAME_REFUSED', codes(() => buildRig(parseConfig(alternate.config), alternate.parts, alternate.images)).includes('RIG_TURN_SURFACE_MESH_ATTACHMENT'), 'another drawing cannot silently reuse the base part depth and setup frame');
  const omitted = weightedSurfaceFixture();
  (omitted.config.assemble as Record<string, unknown>).alternates = [{ name: 'other', source: 'other.png', full: 'full', head: 'head' }];
  say('WTS13_OMITTED_ALTERNATE_PARTS_COVERS_ALL_BASE_PARTS', codes(() => buildRig(parseConfig(omitted.config), omitted.parts, omitted.images)).includes('RIG_TURN_SURFACE_MESH_ATTACHMENT'), 'omitting parts means every base part, so a surface mesh still requires a registered alternate frame');
  const hidden = weightedSurfaceFixture();
  hidden.config.turn = { pivot: 20, roles: { hair_back: 'surface', hair_front: 'unit' } };
  (hidden.config.assemble as Record<string, unknown>).alternates = [{ name: 'other', source: 'other.png', full: 'full', head: 'head', hides: ['hair_back'] }];
  say('WTS14_OMITTED_PARTS_WITH_HIDDEN_SURFACE_IS_ACCEPTED', codes(() => buildRig(parseConfig(hidden.config), hidden.parts, hidden.images)).length === 0, 'omitted parts minus hides does not cover this surface; no frame is invented and no unrelated alternate is refused');
  const unrelated = weightedSurfaceFixture();
  unrelated.config.turn = { pivot: 20, roles: { hair_back: 'surface', hair_front: 'unit' } };
  (unrelated.config.assemble as Record<string, unknown>).alternates = [{ name: 'other', source: 'other.png', full: 'full', head: 'head', parts: ['hair_front'] }];
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
