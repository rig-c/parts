/** Stopped weighted surfaces: setup alias resolution must not change emitted names. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stoppedSurfaceFixture } from '../fixtures/turn_surface_stops.ts';
import { weightedSurfaceFixture } from '../fixtures/turn_surface.ts';
import { parseConfig } from '../src/config.ts';
import { buildRig, type MeshAttachment, type RigOutput } from '../src/rig.ts';
import { rigOutputTexts } from '../src/build.ts';
import { buildDepth25DTurn } from '../src/turn.ts';
import { PartsError } from '../src/errors.ts';
import { writePng } from '../src/raster/png.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
type Animation = { deform?: Array<{ slot: string; keys: Array<{ vertices?: number[] }> }> };
const mesh = (b: RigOutput, part: string): MeshAttachment => b.rig.skins.default[part][part] as MeshAttachment;
const fields = (b: RigOutput) => ['turn', 'tilt', 'body_turn'].map(name => (b.motion.animations[name] as Animation).deform);
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

export function runTurnSurfaceStopChecks(dir: string, say: Say): void {
  const original = weightedSurfaceFixture(), plain = buildRig(parseConfig(original.config), original.parts, original.images);
  let complete: RigOutput | undefined;
  for (const mode of ['all', 'first', 'tip'] as const) {
    const f = stoppedSurfaceFixture(mode), input = JSON.stringify(f.config);
    const built = buildRig(parseConfig(f.config), f.parts, f.images);
    if (mode === 'all') complete = built;
    const noTurn = stoppedSurfaceFixture(mode, false), source = buildRig(parseConfig(noTurn.config), noTurn.parts, noTurn.images);
    const aliases = new Set(built.rig.stops!.flatMap(s => s.links.map(link => `${link}_d`)));
    const emitted = f.parts.parts.flatMap(p => mesh(built, p.name).weights.flat().map(w => w.bone));
    const deforms = fields(built), values = deforms.flatMap(ds => ds?.flatMap(d => d.keys.flatMap(k => k.vertices ?? [])) ?? []);
    const preserved = JSON.stringify(built.rig.bones.filter(b => source.rig.bones.some(s => s.name === b.name))) === JSON.stringify(source.rig.bones)
      && f.parts.parts.every(p => JSON.stringify(mesh(built, p.name)) === JSON.stringify(mesh(source, p.name)))
      && JSON.stringify(built.rig.stops) === JSON.stringify(source.rig.stops)
      && JSON.stringify(f.config) === input;
    const expected = [['turn', ['hair_back', 'hair_front']], ['tilt', ['hair_back', 'hair_front']], ['body_turn', ['topwear']]] as const;
    const active = expected.every(([name, parts]) => parts.every(part => (built.motion.animations[name] as Animation).deform?.some(d => d.slot === part && d.keys.some(k => k.vertices?.some(v => v !== 0)))));
    say(`STS01_${mode.toUpperCase()}_STOPS_PRESERVE_SETUP_FIELDS_AND_BINDINGS`, preserved && active && [...aliases].every(a => emitted.includes(a)) && !built.rig.bones.some(b => aliases.has(b.name)) && hash(deforms) === hash(fields(plain)),
      `${aliases.size} declared aliases retained; ${values.filter(v => v !== 0).length}/${values.length} nonzero offsets; same no-stop deform sha256 ${hash(deforms)}; stops, existing bones and attachment bytes equal no-turn stopped source: ${preserved}`);
  }

  // A stopped head/body blend must classify each emitted alias in its own subtree.
  const mixed = stoppedSurfaceFixture();
  (mixed.config.meshes as Record<string, unknown>).topwear = { grid: 8, r: 20, segments: ['bang', 'cloth'] };
  const mixedPlain = structuredClone(mixed.config); delete mixedPlain.stops;
  const mixedBuild = buildRig(parseConfig(mixed.config), mixed.parts, mixed.images);
  const mixedSource = buildRig(parseConfig(mixedPlain), mixed.parts, mixed.images);
  const mixedFields = (b: RigOutput) => fields(b).map(ds => ds?.filter(d => d.slot === 'topwear'));
  say('STS05_BLENDED_STOP_ALIASES_KEEP_HEAD_BODY_GROUPS', hash(mixedFields(mixedBuild)) === hash(mixedFields(mixedSource)) && mixedFields(mixedBuild).every(ds => ds?.some(d => d.keys.some(k => k.vertices?.some(v => v !== 0)))),
    `stopped head/body blend retains all three active fields; no-stop deform sha256 ${hash(mixedFields(mixedBuild))}`);

  const f = stoppedSurfaceFixture(), cfg = parseConfig(f.config), built = complete!;
  // Direct producer input plants bypass the config reader, which already refuses unknown bones.
  for (const missing of ['missing_binding', 'head_d']) {
    const mutant = structuredClone(built);
    mesh(mutant, 'hair_back').weights[0][0].bone = missing;
    let error: PartsError | undefined;
    try {
      buildDepth25DTurn(mutant.rig, mutant.motion, {
        turn: cfg.turn!, parts: f.parts.parts, images: f.images, regions: cfg.regions,
        stills: {}, boneLandmarks: new Map(), hasAlternateFaceSet: false,
        surfaceMeshes: f.parts.parts.map(p => ({ part: p.name, slot: p.name, attachment: p.name, weights: mesh(mutant, p.name).weights, canvas: f.parts.rig_size })),
      });
    } catch (e) { if (e instanceof PartsError) error = e; else throw e; }
    const named = error?.problems.find(p => p.code === 'RIG_TURN_SURFACE_MESH_BINDINGS' && p.object === 'surface mesh "hair_back/hair_back" vertex 0' && p.detail.includes(`names missing bone "${missing}"`));
    say(`STS02_${missing.toUpperCase()}_STILL_REFUSED`, named !== undefined, named === undefined ? 'missing named refusal' : `${named.code}: ${named.object} — ${named.detail}`);
  }

  // Shared carrier guards must walk through a resolved alias as well.
  const shared = structuredClone(built);
  shared.rig.bones.find(b => b.name === 'back_l0')!.parent = 'faceshift';
  let carrier: PartsError | undefined;
  try {
    buildDepth25DTurn(shared.rig, shared.motion, {
      turn: cfg.turn!, parts: f.parts.parts, images: f.images, regions: cfg.regions,
      stills: {}, boneLandmarks: new Map(), hasAlternateFaceSet: false,
      surfaceMeshes: [{ part: 'hair_back', slot: 'hair_back', attachment: 'hair_back', weights: mesh(shared, 'hair_back').weights, canvas: f.parts.rig_size }],
    });
  } catch (e) { if (e instanceof PartsError) carrier = e; else throw e; }
  say('STS03_STOP_ALIAS_DOES_NOT_HIDE_SHARED_TURN_CARRIER', carrier?.problems.some(p => p.code === 'RIG_TURN_SURFACE_MESH_BINDINGS' && p.detail.includes('through turn carrier "faceshift"')) === true, 'resolved setup ancestry still refuses a frame moved by a different role');

  const out = join(dir, 'stopped-surface'); mkdirSync(join(out, 'images'), { recursive: true });
  for (const [name, text] of rigOutputTexts(built, null)) writeFileSync(join(out, name), text);
  for (const [name, image] of built.images) writePng(join(out, 'images', name), image);
  const gate = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve('@rig-c/core/cli')), 'build', '--rig', join(out, 'rig.json'), '--motion', join(out, 'motion.json'), '--out', join(out, 'built'), '--profile', 'rig-play'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  writeFileSync(join(out, 'gate.log'), gate.stdout + gate.stderr);
  const skeleton = gate.status === 0 ? JSON.parse(readFileSync(join(out, 'built/skeleton.json'), 'utf8')) as { bones: Array<{ name: string }>; animations: Record<string, { attachments?: Record<string, Record<string, Record<string, { deform?: Array<{ vertices?: number[] }> }>>> }> } : null;
  const aliases = built.rig.stops!.flatMap(s => s.links.map(link => `${link}_d`));
  const coreKeys = skeleton?.animations.turn.attachments?.default?.hair_back?.hair_back?.deform;
  say('STS04_CORE_GATE_EMITS_STOP_BONES_AND_NONZERO_DEPTH_DEFORM', gate.status === 0 && aliases.every(a => skeleton?.bones.some(b => b.name === a)) && coreKeys?.some(k => k.vertices?.some(v => v !== 0)) === true,
    `Core exit ${gate.status}; ${aliases.length} stop draw bones; rig sha256 ${hash(built.rig)}; motion sha256 ${hash(built.motion)}; ${gate.status === 0 ? 'mandatory rig-play roundtrip accepted' : gate.stdout + gate.stderr}`);
}
