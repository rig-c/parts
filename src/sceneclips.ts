/** Scene-authored clips use final names and Core's motion parser and poser. */
import { CompileError } from '@rig-c/core/errors';
import { parseMotionSpec, type MotionSpec as CoreMotion } from '@rig-c/core/motion';
import { bezierPolyline, CoreInputError, poseRawAnimation, readModel, type RawPose } from '@rig-c/core/core';
import { PartsError, refuseIfAny, type Problem } from './errors.ts';
import type { MotionSpec } from './motion.ts';
import type { RigSpec } from './rig.ts';

export type SceneAnimations = CoreMotion['animations'];

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
 * Physics is omitted only from this observation, as in check's keyed-loop bar;
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
        problems.push({ code: 'SCENE_ANIMATION_LOOP_CLOSES', object: `scene.animations.${name}`, detail: `${difference}; identical endpoint poses are required (physics left out: ${physics.join(', ') || 'none'})` });
      } else if (name === 'idle' && repeatedIdle) {
        const { difference } = storedIdleLoopDifference(modelText);
        if (difference !== null) problems.push({ code: 'SCENE_ANIMATION_LOOP_CLOSES', object: 'scene.animations.idle', detail: `${difference}; identical endpoint poses are required (physics left out: ${physics.join(', ') || 'none'})` });
      }
    }
    return problems;
  } catch (err) {
    if (!(err instanceof CoreInputError)) throw err;
    return [{ code: 'SCENE_ANIMATION_POSE_READABLE', object: 'scene.animations', detail: err.message }];
  }
}
