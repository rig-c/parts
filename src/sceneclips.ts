/** Scene-authored clips use final names and Core's motion parser and poser. */
import { bezierForChannel, f32 } from '@rig-c/core/compile';
import { CompileError } from '@rig-c/core/errors';
import { parseMotionSpec, type MotionSpec as CoreMotion } from '@rig-c/core/motion';
import { bezierPolyline, CORE_DOCUMENT_SPEC, CoreInputError, poseRawAnimation, readModel, type RawPose } from '@rig-c/core/core';
import { PartsError, refuseIfAny, type Problem } from './errors.ts';
import type { MotionSpec } from './motion.ts';
import type { RigSpec } from './rig.ts';

export type SceneAnimations = CoreMotion['animations'];

export interface SceneCameraSample {
  pan: [number, number];
  zoom: number;
}

export interface SceneCameraKey extends SceneCameraSample {
  t: number;
  ease?: string;
  curve?: number[] | 'stepped';
}

export interface SceneCamera {
  backdrop: string;
  tracks: Record<string, SceneCameraKey[]>;
}

export interface ResolvedSceneCameraTrack {
  /** Authored seconds, pan and zoom, with easings resolved to outgoing absolute curves. */
  keys: Omit<SceneCameraKey, 'ease'>[];
  duration: number;
  loop: boolean;
  /** Sample on the authored clock, including the unwrapped terminal time. */
  sample(time: number): SceneCameraSample;
}

export interface ResolvedSceneCamera {
  backdrop: string;
  tracks: ReadonlyMap<string, ResolvedSceneCameraTrack>;
}

const CAMERA_TRACK = 'SCENE_CAMERA_TRACK';
const CAMERA_LOOP = 'SCENE_CAMERA_LOOP_CLOSES';
const CAMERA_PAN_CURVE_LENGTH = 8;
const CAMERA_CURVE_LENGTH = CAMERA_PAN_CURVE_LENGTH + 4; // Four handles each for pan X, pan Y and reciprocal zoom.

const cameraRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const cameraNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const cameraFloat = (v: unknown): boolean => cameraNumber(v) && Number.isFinite(Math.fround(v));
const cameraTrackField = (name: string): string => `scene.camera.tracks[${JSON.stringify(name)}]`;

function cameraValue(v: unknown): string {
  if (typeof v === 'number') return String(v);
  const json = JSON.stringify(v);
  return json === undefined ? String(v) : json.length > 80 ? `${json.slice(0, 77)}...` : json;
}

function cameraUnknownFields(raw: Record<string, unknown>, allowed: readonly string[], object: string, problems: Problem[]): void {
  for (const field of Object.keys(raw)) if (!allowed.includes(field)) {
    problems.push({ code: CAMERA_TRACK, object: `${object}.${field}`, detail: `is not a camera field. Use ${allowed.join(', ')}` });
  }
}

function usableZoom(zoom: number): boolean {
  const span = 1 / zoom;
  return Number.isFinite(zoom) && zoom > 0 && Number.isFinite(span) && span > 0;
}

function readCameraKeys(raw: unknown, object: string, problems: Problem[]): SceneCameraKey[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push({ code: CAMERA_TRACK, object, detail: `is ${cameraValue(raw)}. A nonempty list of { t, pan, zoom } keys is required` });
    return [];
  }
  const keys: SceneCameraKey[] = [];
  let previous = -Infinity;
  for (const [i, key] of raw.entries()) {
    const at = `${object}[${i}]`;
    if (!cameraRecord(key)) {
      problems.push({ code: CAMERA_TRACK, object: at, detail: `is ${cameraValue(key)}. An object with t, pan and zoom is required` });
      continue;
    }
    const before = problems.length;
    cameraUnknownFields(key, ['t', 'pan', 'zoom', 'ease', 'curve'], at, problems);
    const { t, pan, zoom, ease, curve } = key;
    const validTime = cameraNumber(t) && (i === 0 ? t === 0 : t > previous && t > 0);
    if (!validTime) problems.push({ code: CAMERA_TRACK, object: `${at}.t`, detail: `is ${cameraValue(t)} s. ${i === 0
      ? 'The first key must be at exactly 0 s'
      : `Each subsequent key must be at a finite positive time strictly after the previous key (${previous} s)`}` });
    if (cameraNumber(t)) previous = t;

    const validPan = Array.isArray(pan) && pan.length === 2 && cameraNumber(pan[0]) && cameraNumber(pan[1]);
    if (!validPan) problems.push({ code: CAMERA_TRACK, object: `${at}.pan`, detail: `is ${cameraValue(pan)}. Two finite scene pixel offsets [x, y] are required` });
    const validZoom = cameraNumber(zoom) && usableZoom(zoom);
    if (!validZoom) problems.push({ code: CAMERA_TRACK, object: `${at}.zoom`, detail: `is ${cameraValue(zoom)}. Positive finite zoom and reciprocal zoom are required` });

    if (ease !== undefined && (typeof ease !== 'string' || ease.length === 0)) {
      problems.push({ code: CAMERA_TRACK, object: `${at}.ease`, detail: `is ${cameraValue(ease)}. Use a nonempty easing name or "stepped"` });
    }
    if (curve !== undefined && curve !== 'stepped' && !(Array.isArray(curve) && curve.length === CAMERA_CURVE_LENGTH && [...curve].every(cameraFloat))) {
      problems.push({ code: CAMERA_TRACK, object: `${at}.curve`, detail: `is ${cameraValue(curve)}. Use "stepped" or ${CAMERA_CURVE_LENGTH} finite numbers at float32 precision` });
    }
    if (ease !== undefined && curve !== undefined) {
      problems.push({ code: CAMERA_TRACK, object: at, detail: 'carries both ease and curve. Use one outgoing curve declaration' });
    } else if (i === raw.length - 1 && (curve !== undefined || ease !== undefined)) {
      problems.push({ code: CAMERA_TRACK, object: at, detail: 'carries an outgoing easing or curve. The terminal key has no following segment' });
    }
    if (problems.length === before && validTime && validPan && validZoom) {
      keys.push({ t, pan: [pan[0], pan[1]], zoom, ...(typeof ease === 'string' ? { ease } : {}),
        ...(curve === 'stepped' || Array.isArray(curve) ? { curve: Array.isArray(curve) ? [...curve] : curve } : {}) });
    }
  }
  return keys;
}

/** Read the declaration before the scene's composed take names and easings are available. */
export function readSceneCamera(raw: unknown): SceneCamera {
  if (!cameraRecord(raw)) {
    throw new PartsError([{ code: CAMERA_TRACK, object: 'scene.camera', detail: `is ${cameraValue(raw)}. A { backdrop, tracks } object is required` }]);
  }
  const problems: Problem[] = [];
  cameraUnknownFields(raw, ['backdrop', 'tracks'], 'scene.camera', problems);
  const backdrop = typeof raw.backdrop === 'string' ? raw.backdrop : '';
  if (backdrop.length === 0) problems.push({ code: 'SCENE_CAMERA_BACKDROP', object: 'scene.camera.backdrop', detail: `is ${cameraValue(raw.backdrop)}. Name the legacy plate or a declared plate` });
  const tracks: Array<[string, SceneCameraKey[]]> = [];
  if (cameraRecord(raw.tracks)) {
    for (const [name, keys] of Object.entries(raw.tracks)) tracks.push([name, readCameraKeys(keys, cameraTrackField(name), problems)]);
    if (tracks.length === 0) problems.push({ code: CAMERA_TRACK, object: 'scene.camera.tracks', detail: 'is empty. Name at least one composed take and its camera keys' });
  } else {
    problems.push({ code: CAMERA_TRACK, object: 'scene.camera.tracks', detail: `is ${cameraValue(raw.tracks)}. An object mapping take names to key lists is required` });
  }
  refuseIfAny(problems);
  return { backdrop, tracks: Object.fromEntries(tracks) };
}

const cameraChannels = (key: SceneCameraKey): [number, number, number] => [key.pan[0], key.pan[1], 1 / key.zoom];

/** Match the compiled bone timeline's stored time on the eased path. Off-grid
 * times use the lower adjacent float32 when nearest rounding would go up.
 */
function cameraStoredTime(time: number): number {
  const named = f32(time);
  const nearest = Math.fround(time);
  if (named === time || nearest <= time || !Number.isFinite(nearest)) return named;
  const bits = new DataView(new ArrayBuffer(4));
  bits.setFloat32(0, nearest);
  bits.setUint32(0, bits.getUint32(0) - 1);
  return f32(bits.getFloat32(0));
}

/** Lower three camera channels onto two independent root translations. Their
 * unrounded world coordinates are Core's evaluated channel values directly.
 * The document is synthetic and stays in memory. Its digest is a field the
 * parser requires, and the camera report binds the actual packed model separately.
 */
function cameraCoreSampler(keys: ResolvedSceneCameraTrack['keys'], times: number[], duration: number, object: string): ResolvedSceneCameraTrack['sample'] {
  const name = 'camera';
  const doc = readModel(JSON.stringify({
    spec: CORE_DOCUMENT_SPEC, referenceScale: 1, stage: null,
    bones: [{ name: 'pan' }, { name: 'span' }], slots: [], skins: [], constraints: [], events: [],
    animations: [{ name, duration, slots: [], constraints: { ik: [], transform: [], path: [], physics: [], slider: [] }, attachments: [], drawOrder: [], events: [],
      bones: [
        { name: 'pan', timelines: [{ name: 'translate', keys: keys.map((key, i) => ({
          time: times[i], x: f32(key.pan[0]), y: f32(key.pan[1]),
          curve: Array.isArray(key.curve) ? key.curve.slice(0, CAMERA_PAN_CURVE_LENGTH) : key.curve,
        })) }] },
        { name: 'span', timelines: [{ name: 'translatex', keys: keys.map((key, i) => ({
          time: times[i], value: f32(1 / key.zoom),
          curve: Array.isArray(key.curve) ? key.curve.slice(CAMERA_PAN_CURVE_LENGTH) : key.curve,
        })) }] },
      ] }],
    editorOrder: { skins: [], animations: [name] },
    images: [], pageGrids: [], droppedStates: [], absentParts: [], meshBones: [], meshes: [], physics: [], deformTransforms: [], trackDerivations: [], rig: {},
    pages: [], spine: { sha256: '0'.repeat(64) },
  }), object);
  return time => {
    try {
      const pose = poseRawAnimation(doc, name, time === 0 ? [] : [time]).at(-1);
      if (pose === undefined) throw new CoreInputError('Core returned no camera pose');
      const [pan, span] = pose.bones;
      return checkCameraSample([pan.worldX, pan.worldY], 1 / span.worldX, time, object);
    } catch (err) {
      if (!(err instanceof CoreInputError)) throw err;
      throw new PartsError([{ code: CAMERA_TRACK, object, detail: `cannot evaluate the eased camera at t=${time} s. ${err.message}` }]);
    }
  };
}

function checkCameraSample(pan: [number, number], zoom: number, time: number, object: string): SceneCameraSample {
  if (!pan.every(Number.isFinite) || !usableZoom(zoom)) {
    throw new PartsError([{ code: CAMERA_TRACK, object, detail: `evaluates at t=${time} s to pan [${pan.join(', ')}] and zoom ${zoom}. A finite pan and a finite positive window are required` }]);
  }
  return { pan, zoom };
}

function cameraLoopProblem(first: SceneCameraSample, last: SceneCameraSample, duration: number, object: string, phase: string): Problem | null {
  if (first.pan[0] === last.pan[0] && first.pan[1] === last.pan[1] && first.zoom === last.zoom) return null;
  return { code: CAMERA_LOOP, object, detail: `${phase} start at t=0 s has pan [${first.pan.join(', ')}] and zoom ${first.zoom}. End at t=${duration} s has pan [${last.pan.join(', ')}] and zoom ${last.zoom}. A looping camera requires exact equality` };
}

/** Resolve only declared tracks, against the final take and easing names. */
export function resolveSceneCamera(camera: SceneCamera, motion: MotionSpec): ResolvedSceneCamera {
  const problems: Problem[] = [];
  const tracks = new Map<string, ResolvedSceneCameraTrack>();
  for (const [name, authored] of Object.entries(camera.tracks)) {
    const object = cameraTrackField(name);
    const take = Object.hasOwn(motion.animations, name) ? motion.animations[name] : undefined;
    if (!cameraRecord(take) || !cameraNumber(take.duration) || take.duration < 0) {
      problems.push({ code: CAMERA_TRACK, object, detail: `requires a composed take named ${JSON.stringify(name)} with a finite nonnegative declared duration` });
      continue;
    }
    const { duration } = take;
    const loop = take.loop === true;
    const first = authored[0], last = authored.at(-1);
    if (last === undefined || last.t !== duration) {
      problems.push({ code: CAMERA_TRACK, object, detail: `ends at ${last === undefined ? 'no key' : `${last.t} s`}. Take ${JSON.stringify(name)} declares ${duration} s and the terminal key must match exactly` });
      continue;
    }
    const before = problems.length;
    if (loop) {
      const problem = cameraLoopProblem(first, last, duration, object, 'Authored');
      if (problem !== null) problems.push(problem);
    }

    const eased = authored.some(key => key.curve !== undefined || key.ease !== undefined);
    const times = authored.map(key => eased ? cameraStoredTime(key.t) : key.t);
    const keys = authored.map((key, i): ResolvedSceneCameraTrack['keys'][number] => {
      const at = `${object}[${i}]`;
      const normalized: ResolvedSceneCameraTrack['keys'][number] = { t: key.t, pan: [...key.pan], zoom: key.zoom };
      const from = cameraChannels(key);
      if (eased && (!Number.isFinite(times[i]) || (i > 0 && times[i] <= times[i - 1])
        || !from.every(cameraFloat) || Math.fround(from[2]) === 0)) {
        problems.push({ code: CAMERA_TRACK, object: at,
          detail: `at t=${key.t} s stores time ${times[i]} s and has channels [${from.join(', ')}]. ` +
            'Eased tracks require strictly increasing float32 times and finite float32 channels with a positive reciprocal zoom',
        });
      }
      if (key.curve === 'stepped' || key.ease === 'stepped') return { ...normalized, curve: 'stepped' };
      if (key.curve !== undefined) return { ...normalized, curve: key.curve.map(f32) };
      if (key.ease === undefined) return normalized;
      const handles = key.ease !== '' && Object.hasOwn(motion.easings, key.ease) ? motion.easings[key.ease] : undefined;
      if (!Array.isArray(handles) || handles.length !== 4 || ![...handles].every(cameraFloat)) {
        problems.push({ code: CAMERA_TRACK, object: `${at}.ease`, detail: `names ${JSON.stringify(key.ease)}. Declare that easing in the composed motion with four finite handles at float32 precision` });
        return normalized;
      }
      const to = cameraChannels(authored[i + 1]);
      if (from.every((v, c) => Math.fround(v) === Math.fround(to[c]))) return { ...normalized, curve: 'stepped' };
      const curve = from.flatMap((v, c) => bezierForChannel(handles, times[i], times[i + 1], v, to[c]));
      if (!curve.every(Number.isFinite)) {
        problems.push({ code: CAMERA_TRACK, object: `${at}.ease`, detail: `easing ${JSON.stringify(key.ease)} produces non-finite absolute handles at t=${key.t} s. Finite float32 handles are required` });
      }
      return { ...normalized, curve };
    });
    if (problems.length !== before) continue;

    let coreSample: ResolvedSceneCameraTrack['sample'] | undefined;
    let coreStart: SceneCameraSample | undefined, coreEnd: SceneCameraSample | undefined;
    if (eased) {
      try {
        coreSample = cameraCoreSampler(keys, times, duration, object);
        const storedEnd = Math.fround(times[times.length - 1]);
        coreStart = coreSample(0);
        coreEnd = coreSample(storedEnd);
        if (loop) {
          const problem = cameraLoopProblem(coreStart, coreEnd, storedEnd, object, 'Core-evaluated');
          if (problem !== null) problems.push(problem);
        }
      } catch (err) {
        if (err instanceof PartsError) problems.push(...err.problems);
        else if (err instanceof CoreInputError) problems.push({ code: CAMERA_TRACK, object, detail: err.message });
        else throw err;
        continue;
      }
    }
    const easedStart = keys[0].curve !== undefined;
    const easedEnd = keys.at(-2)?.curve !== undefined;
    const easedSeam = loop && (easedStart || easedEnd);
    tracks.set(name, {
      keys, duration, loop,
      sample(time) {
        if (!Number.isFinite(time) || time < 0 || time > duration) {
          throw new PartsError([{ code: CAMERA_TRACK, object, detail: `cannot sample t=${time} s. Authored time in [0, ${duration}] s is required` }]);
        }
        // At a curved loop seam use both unwrapped Core reads. The linear-only
        // seam uses both authored values, so the two ends share a precision.
        const endpoint = time === 0 && (easedSeam || easedStart) ? coreStart
          : time === duration && (easedSeam || easedEnd) ? coreEnd : undefined;
        if (endpoint !== undefined) return { pan: [...endpoint.pan], zoom: endpoint.zoom };
        let low = 0, high = keys.length - 1;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          if (keys[mid].t <= time) low = mid;
          else high = mid - 1;
        }
        const from = keys[low], to = keys[low + 1];
        if (from.curve !== undefined && coreSample !== undefined) return coreSample(time);
        if (from.t === time || to === undefined) return checkCameraSample([...from.pan], from.zoom, time, object);
        const phase = (time - from.t) / (to.t - from.t);
        const mix = (a: number, b: number): number => a + (b - a) * phase;
        return checkCameraSample([mix(from.pan[0], to.pan[0]), mix(from.pan[1], to.pan[1])], 1 / mix(1 / from.zoom, 1 / to.zoom), time, object);
      },
    });
  }
  refuseIfAny(problems);
  return { backdrop: camera.backdrop, tracks };
}

export interface ScenePlacementPivot {
  name: string;
  rootBinding?: string;
  field: string;
}

const PLACEMENT_TRANSLATIONS: readonly string[] = ['translate', 'translatex', 'translatey'];

function placementTrackProblems(clips: SceneAnimations, pivots: readonly ScenePlacementPivot[]): Problem[] {
  if (pivots.length === 0) return [];
  const problems: Problem[] = [];
  const targets = new Map<string, ScenePlacementPivot>();
  const unused = new Set(pivots);
  for (const pivot of pivots) {
    targets.set(pivot.name, pivot);
    if (pivot.rootBinding !== undefined) targets.set(pivot.rootBinding, pivot);
  }
  for (const [name, clip] of Object.entries(clips)) for (const [i, track] of clip.tracks.entries()) {
    if (track.bone === undefined) continue;
    const pivot = targets.get(track.bone);
    if (pivot === undefined) continue;
    const onPivot = track.bone === pivot.name;
    if (!onPivot || !PLACEMENT_TRANSLATIONS.includes(track.property)) {
      problems.push({
        code: 'SCENE_PIVOT_TRACK', object: `scene.animations.${name}.tracks[${i}]`,
        detail: `keys ${JSON.stringify(track.bone)} with ${JSON.stringify(track.property)}. ${onPivot
          ? `Its scene motion must use ${PLACEMENT_TRANSLATIONS.join(', ')} in final scene units`
          : `The root binding must stay unkeyed. Key translation on ${JSON.stringify(pivot.name)}`}`,
      });
      unused.delete(pivot); // The track refusal already explains how to key this pivot.
    } else if (track.keys.length > 0) {
      unused.delete(pivot); // Core validates the key values, times, curves and target shape.
    }
  }
  for (const pivot of unused) problems.push({
    code: 'SCENE_PIVOT_UNUSED', object: pivot.field,
    detail: `adds bone ${JSON.stringify(pivot.name)} with no scene translation key. Key it with ${PLACEMENT_TRANSLATIONS.join(', ')} in scene.animations or omit the opt-in`,
  });
  return problems;
}

/** Core owns shape, required numbers, key times and all target families. */
export function readSceneAnimations(raw: unknown, where: string): SceneAnimations {
  try {
    return parseMotionSpec({ spec: 'rigc-motion/1', archetype: 'scene', cut: 'scene', easings: {}, groups: {}, animations: raw }, where).animations;
  } catch (err) {
    if (!(err instanceof CompileError) || err.code === undefined) throw err;
    throw new PartsError([{ code: err.code, object: 'scene.animations', detail: err.message }]);
  }
}

/** Core slider source properties and the bone timeline channels that feed them. */
function sliderInputChannel(source: unknown, property: string): number | null {
  switch (source) {
    case 'rotate': return property === 'rotate' ? 0 : null;
    case 'x': return property === 'translatex' || property === 'translate' ? 0 : null;
    case 'y': return property === 'translatey' ? 0 : property === 'translate' ? 1 : null;
    case 'scaleX': return property === 'scalex' || property === 'scale' ? 0 : null;
    case 'scaleY': return property === 'scaley' ? 0 : property === 'scale' ? 1 : null;
    case 'shearY': return property === 'sheary' ? 0 : property === 'shear' ? 1 : null;
    default: return null; // Core names unsupported slider source properties at its gate.
  }
}

/** Append timelines without changing existing idle payloads or character physics. */
export function mergeSceneAnimations(rig: RigSpec, motion: MotionSpec, clips: SceneAnimations, pivots: readonly ScenePlacementPivot[] = []): void {
  const problems = placementTrackProblems(clips, pivots);
  const animations = motion.animations as unknown as SceneAnimations;
  for (const [name, clip] of Object.entries(clips)) {
    const existing = Object.hasOwn(animations, name) ? animations[name] : undefined;
    if (existing !== undefined && name !== 'idle') {
      problems.push({ code: 'SCENE_ANIMATION_NAME_FREE', object: `scene.animations.${name}`, detail: `already names an imported animation; only idle may be extended` });
      continue;
    }
    if (existing !== undefined && clip.duration !== existing.duration) {
      problems.push({ code: 'SCENE_DURATION_AGREES', object: `scene.animations.${name}.duration`, detail: `is ${clip.duration}; composed idle declares ${existing.duration}; equal durations are required, without retiming` });
      continue;
    }
    // Bounds belong to the actual final slider, never to a guessed dial-name list.
    // `from` is the declared bottom and `max` the editor's declared top (Core's RigSliderConstraint).
    for (const track of clip.tracks) {
      if (track.group !== undefined && (!Object.hasOwn(motion.groups, track.group) || !Array.isArray(motion.groups[track.group]))) {
        problems.push({ code: 'CE_COMPILE_ANIMATION_GROUP_UNKNOWN', object: `scene.animations.${name}`,
          detail: `animation "${name}": unknown group "${track.group}"; an own declared group is required` });
        continue;
      }
      const targets = track.bone === undefined ? (track.group === undefined ? [] : motion.groups[track.group]) : [track.bone];
      for (const bone of targets) for (const slider of rig.constraints ?? []) {
        if (slider.type !== 'slider' || slider.bone !== bone) continue;
        const channel = sliderInputChannel(slider.property, track.property);
        if (channel === null) continue;
        const from = slider.from, max = slider.max;
        if (typeof from !== 'number' || !Number.isFinite(from) || typeof max !== 'number' || !Number.isFinite(max) || from > max) {
          problems.push({ code: 'SCENE_DIAL_RANGE_DECLARED', object: `scene.animations.${name} bone "${bone}" slider "${String(slider.name)}"`, detail: `has no readable declared range: from ${String(from)}, max ${String(max)}; declare both bounds before keying this dial` });
          continue;
        }
        for (const key of track.keys) {
          if (key.derive !== undefined) {
            problems.push({ code: 'SCENE_DIAL_KEY_DECLARED', object: `scene.animations.${name} bone "${bone}" slider "${String(slider.name)}" key t=${key.t}`,
              detail: `uses derive on the slider's ${String(slider.property)} input; declare an explicit numeric v in [${from}, ${max}] so its own bounds can be checked` });
            continue;
          }
          const value = key.v !== null && typeof key.v === 'object' && !Array.isArray(key.v) ? key.v[bone] : key.v;
          if (!Array.isArray(value)) continue; // Core refuses missing/malformed values; derived slider inputs were refused above.
          const v = value[channel];
          if (typeof v === 'number' && (v < from || v > max)) problems.push({
            code: 'SCENE_DIAL_KEY_RANGE', object: `scene.animations.${name} bone "${bone}" slider "${String(slider.name)}" key t=${key.t}`,
            detail: `value ${v} is outside declared range [${from}, ${max}]`,
          });
        }
      }
    }
    if (existing === undefined) Object.defineProperty(animations, name, { value: structuredClone(clip), enumerable: true, configurable: true, writable: true });
    else {
      // Core rejects overlapping property claims after expansion, including group/bone collisions.
      // Keep the existing idle metadata; every timeline collection is appended in producer order.
      for (const field of ['tracks', 'deform', 'ik', 'transform', 'sequence', 'events', 'drawOrder'] as const) {
        const added = clip[field];
        if (added !== undefined) Object.assign(existing, { [field]: [...(existing[field] ?? []), ...structuredClone(added)] });
      }
    }
  }
  refuseIfAny(problems);
}

/** Add character context to Core's existing unknown-bone sentence, without changing its code. */
export function sceneBoneContext(line: string, ids: readonly string[]): string {
  const bone = /keys unknown bone "([^"]+)"/.exec(line)?.[1];
  const id = bone === undefined ? undefined : ids.find(id => bone.startsWith(`${id}:`));
  return id === undefined ? line : `${line}; character "${id}" declares no bone "${bone}"`;
}

/** Time and fired events are not pose state. Geometry includes alpha, deforms and invisible bones. */
export function scenePoseState(pose: RawPose): string {
  return JSON.stringify({ bones: pose.bones, slots: pose.slots, drawOrder: pose.drawOrder, drawn: pose.drawn, clips: pose.clips, clipped: pose.clipped });
}

interface PoseDifference {
  path: Array<string | number>;
  start: unknown;
  end: unknown;
}

/** Walk the same JSON values the closure gate compares, in producer field/array order.
 * No rounding or epsilon: the existing numeric tolerance is exactly zero.
 */
function firstPoseDifference(start: unknown, end: unknown, path: Array<string | number> = []): PoseDifference | null {
  if (JSON.stringify(start) === JSON.stringify(end)) return null;
  if (Array.isArray(start) && Array.isArray(end)) {
    for (let i = 0; i < Math.max(start.length, end.length); i++) {
      const difference = firstPoseDifference(start[i], end[i], [...path, i]);
      if (difference !== null) return difference;
    }
  } else if (start !== null && end !== null && typeof start === 'object' && typeof end === 'object') {
    const a = start as Record<string, unknown>, b = end as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const difference = firstPoseDifference(a[key], b[key], [...path, key]);
      if (difference !== null) return difference;
    }
  }
  return { path, start, end };
}

/** Name geometry-only differences too, including invisible slots and clipping. */
function poseDifferenceDetail(start: RawPose, end: RawPose): string {
  const difference = firstPoseDifference(JSON.parse(scenePoseState(start)), JSON.parse(scenePoseState(end)));
  if (difference === null) return 'endpoint sample clocks differ';
  const [family, index, ...fields] = difference.path;
  const i = typeof index === 'number' ? index : -1;
  let object = 'pose', channel = difference.path.map(String).join('.');
  if (family === 'bones') {
    object = `bone ${JSON.stringify(start.bones[i]?.name ?? end.bones[i]?.name)}`;
    channel = fields.map(String).join('.') || 'presence';
  } else if (family === 'slots') {
    object = `slot ${JSON.stringify(start.slots[i]?.[0] ?? end.slots[i]?.[0])}`;
    const [field, ...rest] = fields;
    const channels = ['name', 'attachment', 'r', 'g', 'b', 'a', 'dark', 'path', 'blend'];
    channel = [typeof field === 'number' ? channels[field] : 'presence', ...rest].join('.');
  } else if (family === 'drawOrder') {
    object = `slot ${JSON.stringify(start.drawOrder[i] ?? end.drawOrder[i])}`;
    channel = `drawOrder[${i}]`;
  } else if (family === 'drawn' || family === 'clips' || family === 'clipped') {
    const a = start[family][i], b = end[family][i];
    const slot = (row: typeof a) => row === undefined ? undefined : Array.isArray(row) ? row[0] : row.slot;
    object = `slot ${JSON.stringify(slot(a) ?? slot(b))}`;
    channel = `${family}.${fields.map(String).join('.') || 'presence'}`;
  }
  const value = (v: unknown) => v === undefined ? 'absent' : JSON.stringify(v);
  return `${object} channel ${channel}: start ${value(difference.start)} at t=0; end ${value(difference.end)} at t=${end.trackTime}; tolerance 0 (exact equality)`;
}

/** A throwaway keyed-pose view; simulation is retained in the emitted document. */
export function sceneKeyedModel(modelText: string) {
  const raw = JSON.parse(modelText) as Record<string, unknown>;
  // Remove simulation only from the read view, retaining all non-physics constraints and timelines.
  const constraints = raw.constraints as Array<{ kind: string; name: string }>;
  const physics = constraints.filter(c => c.kind === 'physics').map(c => c.name);
  raw.constraints = constraints.filter(c => c.kind !== 'physics');
  for (const skin of raw.skins as Array<{ constraints?: Record<string, unknown> }>) if (skin.constraints !== undefined) skin.constraints = { ...skin.constraints, physics: [] };
  for (const animation of Object.values(raw.animations as Record<string, { constraints: Record<string, unknown> }>)) animation.constraints = { ...animation.constraints, physics: [] };
  const doc = readModel(JSON.stringify(raw), 'composed scene model');
  return { doc, physics };
}

/** Check at the runtime's stored end, which need not equal the declared double.
 * Keep that clock on the observation view even if a removed physics key set it.
 */
function storedIdleLoopDifference(modelText: string): { difference: string | null; duration: number } {
  const full = readModel(modelText, 'gated idle model');
  const idle = full.animations.find(a => a.name === 'idle');
  const { doc } = sceneKeyedModel(modelText);
  const keyed = doc.animations.find(a => a.name === 'idle');
  if (idle === undefined || keyed === undefined) return { difference: 'gated model has no idle', duration: 0 };
  const { duration, declared } = idle.timelines;
  const clock = `declared duration ${declared} s, stored end ${duration} s`;
  if (!(duration > 0)) return { difference: `idle has no positive playback period (${clock})`, duration };
  keyed.timelines.duration = duration;
  const [start, end] = poseRawAnimation(doc, 'idle', [duration]);
  if (start?.animationTime !== 0 || end?.trackTime !== duration || end.animationTime !== duration) {
    return { difference: `non-wrapping sample phases are ${start?.animationTime} s and ${end?.animationTime} s (${clock})`, duration };
  }
  return { difference: scenePoseState(start) === scenePoseState(end) ? null : `${poseDifferenceDetail(start, end)} (${clock})`, duration };
}

interface StoredCurveKey { time: number; curve?: number[] | 'stepped' }
interface StoredTrackTarget { name: string; timelines: Array<{ name: string; keys: StoredCurveKey[] }> }

/** At a splice, Core's sampled Bezier must reach the closing key from the left.
 * Check the stored polyline, including curves generated from named easings.
 */
function sourceCurveSeamProblems(modelText: string, duration: number, object: string): Problem[] {
  const { animations } = JSON.parse(modelText) as { animations: Array<{
    name: string;
    bones: StoredTrackTarget[];
    slots: StoredTrackTarget[];
    constraints: { physics: StoredTrackTarget[] };
    attachments: Array<{ name: string; slots: Array<{ name: string; attachments: Array<{ name: string; deform?: StoredCurveKey[] }> }> }>;
  }> };
  const idle = animations.find(a => a.name === 'idle');
  if (idle === undefined) return [];
  const problems: Problem[] = [];
  const check = (keys: StoredCurveKey[], timeline: string, deform = false): void => {
    const before = keys.at(-2), end = keys.at(-1);
    if (end === undefined || Math.fround(end.time) !== duration || !Array.isArray(before?.curve)) return;
    const curve = before.curve;
    for (let i = 0; i < curve.length; i += 4) {
      // Only the time axis is needed. Core's deform polyline uses the stored
      // float for the leading key time; bone and physics curves use its name.
      const points = bezierPolyline(deform ? Math.fround(before.time) : before.time, 0, curve[i], 0, curve[i + 2], 0, end.time, 0);
      const overlap = points.find((n, j) => j % 2 === 0 && n >= duration);
      if (overlap === undefined) continue;
      problems.push({ code: 'SCENE_REPEAT_KEY_SEAM', object: `${object}.${timeline}`,
        detail: `Bezier channel ${i / 4} has a stored time sample ${overlap} s at or past the closing key ${duration} s. The source channel must splice without changing its keyed motion` });
      break;
    }
  };
  for (const [family, targets] of [['bone', idle.bones], ['slot', idle.slots], ['physics', idle.constraints.physics]] as const) {
    for (const target of targets) for (const track of target.timelines) check(track.keys, `${family} ${JSON.stringify(target.name)} ${track.name}`);
  }
  for (const skin of idle.attachments) for (const slot of skin.slots) for (const attachment of slot.attachments) {
    if (attachment.deform !== undefined) check(attachment.deform, `deform ${skin.name}/${slot.name}/${attachment.name}`, true);
  }
  return problems;
}

export function sceneRepeatSourceLoopProblems(modelText: string, object: string): Problem[] {
  let difference: string | null;
  try {
    const result = storedIdleLoopDifference(modelText);
    difference = result.difference;
    if (difference === null) return sourceCurveSeamProblems(modelText, result.duration, object);
  }
  catch (err) {
    if (!(err instanceof CoreInputError)) throw err;
    difference = err.message;
  }
  return [{
    code: 'SCENE_REPEAT_SOURCE_LOOP_CLOSES', object,
    detail: `${difference}; repeating requires a closed source idle`,
  }];
}

/** Measure the actual gated poses at both endpoints, without wrapping duration to zero.
 * Physics is omitted from this posed-value check, and physics-on frames are not measured here;
 * the gated/emitted motion and physics constraints are never edited.
 */
export function sceneClipLoopProblems(modelText: string, clips: SceneAnimations, repeatedIdle = false): Problem[] {
  try {
    const { doc, physics } = sceneKeyedModel(modelText);
    const problems: Problem[] = [];
    for (const [name, clip] of Object.entries(clips)) {
      const poses = poseRawAnimation(doc, name, [clip.duration]);
      if (poses.length !== 2 || poses[0].animationTime !== 0 || poses[1].trackTime !== clip.duration || scenePoseState(poses[0]) !== scenePoseState(poses[1])) {
        const difference = poses.length !== 2
          ? `pose sample count ${poses.length}; required 2 at t=0 and t=${clip.duration}`
          : poses[0].animationTime !== 0 || poses[1].trackTime !== clip.duration
            ? `pose sample clocks start ${poses[0].animationTime}, end ${poses[1].trackTime}; required 0 and ${clip.duration}; tolerance 0 (exact equality)`
            : poseDifferenceDetail(poses[0], poses[1]);
        problems.push({ code: 'SCENE_ANIMATION_LOOP_CLOSES', object: `scene.animations.${name}`, detail: `${difference}; identical posed endpoint values with physics omitted are required (physics omitted: ${physics.join(', ') || 'none'}; physics-on frames not measured)` });
      } else if (name === 'idle' && repeatedIdle) {
        const { difference } = storedIdleLoopDifference(modelText);
        if (difference !== null) problems.push({ code: 'SCENE_ANIMATION_LOOP_CLOSES', object: 'scene.animations.idle', detail: `${difference}; identical posed endpoint values with physics omitted are required (physics omitted: ${physics.join(', ') || 'none'}; physics-on frames not measured)` });
      }
    }
    return problems;
  } catch (err) {
    if (!(err instanceof CoreInputError)) throw err;
    return [{ code: 'SCENE_ANIMATION_POSE_READABLE', object: 'scene.animations', detail: err.message }];
  }
}
