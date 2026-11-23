/**
 * Finished single-character builds for the `scene` controls (issue #74),
 * generated on every run: the rig fixture (`fixtures/rig.ts`, a 40x40 canvas,
 * two parts, a `hem` chain and an `eye`) run through the rig stage's own
 * `buildRig`, written where `build --out` writes it — `parts.json`,
 * `rig/rig.json`, `rig/motion.json`, `rig/images/` — beside a
 * `check/check.json` that says the build's own check was green.
 *
 * ⭐ That check.json is written by hand: it stands for "this build's check
 * passed", which `compose` requires and does not re-run. The composed rig is
 * what the controls gate through rig-c and check; the characters' own
 * builds are not. No claim about appearance comes from these fixtures.
 *
 * Two characters:
 *
 * - `plain`: {@link rigConfig} under `--idle-keys ctl` — controls, no
 *   constraint, no invariants.
 * - `reach`: {@link constraintConfig} with a two-bone ik over `hem0`, `hem1`
 *   following the scene target `tgt` (a bone under `root`), under
 *   `--idle-keys direct` — so its rig carries `constraints`,
 *   `invariants.idleDrivesMeshes` and `invariants.detached`, every name kind
 *   compose has to prefix.
 */
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../src/config.ts';
import { type PartsFile, serializeParts } from '../src/parts.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
import { buildRig, type IdleKeys, type MeshAttachment, rigJsonText, type RigOutput } from '../src/rig.ts';
import { constraintConfig, rigConfig, rigImages, rigParts } from './rig.ts';
import { weightedSurfaceEarFixture } from './turn_surface.ts';
import { syntheticPolicy } from './automesh.ts';
import { withPolicyMotion } from './automotion.ts';

/** The ik the `reach` character carries: rigc's own shape, as `config.constraints` writes it. */
export const REACH_IK = { type: 'ik', name: 'reach', bones: ['hem0', 'hem1'], target: 'tgt' } as const;

export type SceneCharacterKind = 'plain' | 'reach';

/** The rig stage's output for one fixture character. */
export function sceneCharacterRig(kind: SceneCharacterKind): RigOutput {
  const raw = kind === 'plain' ? rigConfig() : constraintConfig([{ ...REACH_IK, bones: [...REACH_IK.bones] }]);
  const keys: IdleKeys = kind === 'plain' ? 'ctl' : 'direct';
  return buildRig(parseConfig(raw as Parameters<typeof parseConfig>[0]), rigParts(), rigImages(), undefined, keys);
}

export interface SceneBuildOptions {
  /** check/check.json's PASS and gate_spine_html_green; both true when absent. */
  pass?: boolean;
  /** Edit the rig before it is written (a planted fault). */
  rig?: (rig: Record<string, unknown>) => void;
  /** Edit the motion before it is written (a planted fault). */
  motion?: (motion: Record<string, unknown>) => void;
  /** parts.json's scale_rig_per_source; the fixture's 0.5 when absent. */
  rigScale?: number;
  /** Leave check/check.json out. */
  noCheck?: boolean;
  /** Fields written into check/check.json between gate_spine_html_green and PASS — a bar's figures, as check writes them (issue #203). */
  checkFields?: Record<string, unknown>;
}

/** Write one fixture character as `build --out` leaves it, under `dir`. Returns `dir`. */
export function writeSceneBuild(dir: string, kind: SceneCharacterKind, opts: SceneBuildOptions = {}): string {
  return writeSceneOutput(dir, sceneCharacterRig(kind), rigParts(), opts);
}

/** The rig command's real producer inputs; sampled grids or authored weighted surfaces. */
export function sceneTurnFixture(grid = false) {
  const f = weightedSurfaceEarFixture();
  f.config.constraints = [];
  // Keep the existing head track to state the idle duration, without an unrelated equal-phase parent track.
  const motion = f.config.motion as { tracks: Array<{ bone?: string }> };
  motion.tracks = motion.tracks.filter(track => track.bone === 'head');
  if (!grid) {
    (f.config.meshes as Record<string, unknown>).face = { grid: 8, r: 20, segments: [['head', [32, 36], [32, 12]]] };
    delete (f.config.regions as Record<string, unknown>).face;
  }
  return f;
}

/** Exact producer layout, including already-suffixed depth PNG names. */
export function writeSceneProducerInput(dir: string, fixture: { config: Record<string, unknown>; parts: PartsFile; images: ReturnType<typeof rigImages> }): { config: string; parts: string } {
  const parts = join(dir, 'parts-in');
  mkdirSync(join(parts, 'parts'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), rigJsonText(fixture.config));
  writeFileSync(join(parts, 'parts.json'), serializeParts(fixture.parts));
  for (const [name, image] of fixture.images) writeFileSync(join(parts, 'parts', name.endsWith('.png') ? name : `${name}.png`), encodePngBytes(image));
  return { config: join(dir, 'config.json'), parts };
}

/** A one-level mesh driver and a region, with a neutral one-second source idle (issue #1498). */
function placementPivotFixture() {
  const config: Record<string, unknown> = {
    ...rigConfig(),
    assemble: { rig_scale: 0.5, plan: [['cloth', 'full', 'author:block'], ['eye', 'head', 'face']] },
    bones: [{ name: 'hip', parent: 'root', at: [20, 30] }, { name: 'eye', parent: 'root', at: [17, 28] }],
    meshes: { cloth: { grid: 8, r: 8, segments: [['hip', [14, 14], [30, 14]]] } },
    regions: { eye: 'eye' },
    motion: { duration: 1, tracks: [{ bone: 'eye', prop: 'rotate', amp: 0, period: 1, phase: 0 }] },
  };
  const parts = rigParts();
  parts.parts[0].from = 'full:author:block';
  return { config, parts, images: rigImages() };
}

export function writePlacementPivotProducerInput(dir: string): { config: string; parts: string } {
  return writeSceneProducerInput(dir, placementPivotFixture());
}

/** Plant both root-binding families at their original setup coordinates and add a stationary plate. */
export function writePlacementPivotRootBuild(dir: string, platePath: string): void {
  const f = placementPivotFixture();
  writeSceneOutput(dir, buildRig(parseConfig(f.config), f.parts, f.images), f.parts, { rig: raw => {
    const rig = raw as unknown as RigOutput['rig'];
    rig.slots.find(slot => slot.name === 'eye')!.bone = 'root';
    // The eye centre (18, 27) on the source 40x40 canvas is (-2, 13) in root's frame.
    rig.skins.default.eye.eye = { image: 'eye.png', x: -2, y: 13 };
    const weights = (rig.skins.default.cloth.cloth as MeshAttachment).weights;
    // Hip translates (0, 10) with zero rotation. Keep the first vertex at the same world point.
    const [bind] = weights[0];
    if (weights[0].length !== 1 || bind.bone !== 'hip') throw new Error('placement fixture needs a single hip bind on its first vertex');
    weights[0] = [{ ...bind, bone: 'root', y: bind.y + 10 }];
  } });
  const plate = newRaster(8, 8);
  plate.data.set([72, 112, 164, 255], 4 * (4 * plate.width + 4));
  writeFileSync(platePath, encodePngBytes(plate));
}

/** The existing automatic cloth policy with its explicit fold declaration, through buildRig. */
export function sceneFoldProducerFixture() {
  const config = rigConfig();
  const cloth = (config.meshes as Record<string, { grid: number; r: number; segments: string[] }>).cloth;
  const auto = withPolicyMotion(syntheticPolicy(cloth.grid / 2));
  auto.motion = { ...auto.motion!, deformMayFold: true };
  config.meshes = { cloth: { auto, r: cloth.r, segments: cloth.segments } };
  (config.bones as Array<{ name?: string; inherit?: string }>).find(b => b.name === 'body')!.inherit = 'normal';
  return { config, parts: rigParts(), images: rigImages() };
}

/** Weighted head/body surfaces and unit ears, with no physics or sampled-grid generator. */
export function writeTurnSceneBuild(dir: string, opts: SceneBuildOptions = {}): string {
  const f = sceneTurnFixture();
  return writeSceneOutput(dir, buildRig(parseConfig(f.config), f.parts, f.images), f.parts, opts);
}

function writeSceneOutput(dir: string, out: RigOutput, parts: PartsFile, opts: SceneBuildOptions): string {
  const rig = JSON.parse(rigJsonText(out.rig)) as Record<string, unknown>;
  const motion = JSON.parse(rigJsonText(out.motion)) as Record<string, unknown>;
  opts.rig?.(rig);
  opts.motion?.(motion);
  mkdirSync(join(dir, 'rig', 'images'), { recursive: true });
  for (const [file, img] of out.images) writeFileSync(join(dir, 'rig', 'images', file), encodePngBytes(img));
  writeFileSync(join(dir, 'rig', 'rig.json'), rigJsonText(rig));
  writeFileSync(join(dir, 'rig', 'motion.json'), rigJsonText(motion));
  writeFileSync(join(dir, 'parts.json'), serializeParts({ ...parts, scale_rig_per_source: opts.rigScale ?? parts.scale_rig_per_source }));
  if (opts.noCheck !== true) {
    mkdirSync(join(dir, 'check'), { recursive: true });
    const green = opts.pass ?? true;
    writeFileSync(join(dir, 'check', 'check.json'), `${JSON.stringify({ gate_spine_html_green: green, ...opts.checkFields, PASS: green }, null, 1)}\n`);
  }
  return dir;
}

/** A flat, opaque PNG of `w` x `h` in one colour: the generated plate (provenance `generated`). */
export function writeFlatPlate(path: string, w: number, h: number, rgb: readonly [number, number, number]): void {
  const r = newRaster(w, h);
  for (let i = 0; i < w * h; i++) r.data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  writeFileSync(path, encodePngBytes(r));
}

/** A scene file's text: `spine-parts-scene/1` with the fields given, in the order the spec lists them. */
export function sceneText(body: Record<string, unknown>): string {
  return `${JSON.stringify({ spec: 'spine-parts-scene/1', ...body }, null, 1)}\n`;
}

/** A clipped scene and its undeclared twin, with synthetic inputs and the same placement. */
export function writeCanvasClipSceneFixture(dir: string, size: 'small' | 'exact'): { source: string; legacy: string } {
  const id = 'figure';
  const build = join(dir, id);
  const offset = size === 'small' ? [-12, -12] : [-88, -99];
  const body = {
    canvas: size === 'small' ? { width: 12, height: 14 } : { width: 1744, height: 981 },
    characters: [{ id, build: id, offset, scale: 1 }],
    order: [id],
  };
  let layers: Record<string, unknown> = {};
  if (size === 'small') {
    // The cloth mesh spans the tiny stage and trips rigc's full-frame mesh gate.
    // Use the same native part boxes and images as regions for a placement control.
    const config = rigConfig();
    config.meshes = {};
    config.regions = { cloth: 'body', eye: 'eye' };
    const parts = rigParts();
    writeSceneOutput(build, buildRig(parseConfig(config), parts, rigImages(), undefined, 'ctl'), parts, {});
  } else {
    const width = 1920;
    const height = 1080;
    // A one-second idle gives the checker fewer frames while keeping both travel extremes on its sample grid.
    const duration = 1;
    const parts = rigParts();
    parts.rig_size = [width, height];
    Object.assign(parts.parts.find(p => p.name === 'eye')!, { x: 0, y: 0, w: width, h: height, opaque_px: width * height });
    const image = newRaster(width, height);
    for (let y = 0; y < height; y++) {
      const green = y < height / 2 ? 96 : 130;
      const left = [184, green, 62, 255], right = [220, green, 62, 255];
      for (let x = 0; x < width; x++) image.data.set(x < width / 2 ? left : right, (y * width + x) * 4);
    }
    const images = rigImages();
    images.set('eye', image);
    const config = rigConfig();
    config.motion = { duration, tracks: [] };
    writeSceneOutput(build, buildRig(parseConfig(config), parts, images), parts, {});
    writeFlatPlate(join(dir, 'backdrop.png'), width, height, [72, 112, 164]);
    const travel = (bone: string, amplitude: number) => ({
      bone, property: 'translate',
      keys: [0, -amplitude, 0, amplitude, 0].map((x, i) => ({ t: i * duration / 4, v: [x, 0] })),
    });
    body.order.unshift('backdrop');
    layers = {
      plates: [{ name: 'backdrop', image: 'backdrop.png', provenance: 'generated', at: offset, opaque_backdrop: true }],
      animations: { idle: { duration, loop: true, tracks: [travel('backdrop', 24), travel('figure:body', 48)] } },
    };
  }
  const source = join(dir, 'canvas-clip.json');
  const legacy = join(dir, 'canvas-clip-undeclared.json');
  writeFileSync(source, sceneText({ ...body, ...layers, characters: [{ ...body.characters[0], canvas_clip: true }] }));
  writeFileSync(legacy, sceneText({ ...body, ...layers }));
  return { source, legacy };
}

/** A real turn producer with a declared custom body dial and retained physics/deform idle payload. */
export function writeSceneClipBuild(dir: string, bodySlider?: string): string {
  const f = sceneTurnFixture();
  if (bodySlider !== undefined) ((f.config.turn as { body: Record<string, unknown> }).body).slider = bodySlider;
  f.config.constraints = [{ type: 'physics', name: 'cloth_physics', bone: 'cloth0', rotate: 1, inertia: 1, strength: 30, damping: 0.8, mass: 1, wind: 0, gravity: 0, mix: 1 }];
  const out = buildRig(parseConfig(f.config), f.parts, f.images);
  return writeSceneOutput(dir, out, f.parts, { motion: motion => {
    const animations = motion.animations as Record<string, { duration: number; deform?: Array<{ slot: string; attachment: string; keys: Array<Record<string, unknown>> }> }>;
    const deform = animations.turn.deform?.[0];
    const offsets = deform?.keys.find(key => Array.isArray(key.vertices) && key.vertices.some(v => v !== 0));
    const reset = deform?.keys.find(key => key.vertices === undefined && key.transform === undefined);
    if (deform === undefined || offsets === undefined || reset === undefined) throw new Error('scene clip fixture requires authored weighted turn offsets and a neutral reset');
    // Weighted turn meshes carry bind-space offsets, not attachment depth maps.
    // Retain the producer's payloads in a closed idle: reset, authored offsets, reset.
    animations.idle.deform = [{ ...deform, keys: [
      { ...structuredClone(reset), t: 0 },
      { ...structuredClone(offsets), t: animations.idle.duration / 2 },
      { ...structuredClone(reset), t: animations.idle.duration },
    ] }];
  } });
}

/** Authored schedules in final scene units: plate left/right/left and generated dials together. */
export function sceneClip(duration: number, bodyDial = 'a:body_yaw_dial') {
  return { duration, loop: true, tracks: [
    { bone: 'plate', property: 'translate' as const, keys: [{ t: 0, v: [-3, 0] }, { t: duration / 2, v: [3, 0] }, { t: duration, v: [-3, 0] }] },
    { bone: 'a:yaw_dial', property: 'rotate' as const, keys: [{ t: 0, v: [-4] }, { t: duration / 2, v: [4] }, { t: duration, v: [-4] }] },
    { bone: bodyDial, property: 'rotate' as const, keys: [{ t: 0, v: [-2] }, { t: duration / 2, v: [2] }, { t: duration, v: [-2] }] },
  ] };
}

/** Every emitted path under one fixed output root, for byte parity observations. */
export function sceneOutputFiles(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(join(dir, prefix), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .flatMap(e => e.isDirectory() ? sceneOutputFiles(dir, join(prefix, e.name)) : [join(prefix, e.name)]);
}
