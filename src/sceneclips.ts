/** Scene-authored clips use final names and Core's motion parser and poser. */
import { CompileError } from '@rig-c/core/errors';
import { parseMotionSpec, type MotionSpec as CoreMotion } from '@rig-c/core/motion';
import { CoreInputError, poseRawAnimation, readModel, type RawPose } from '@rig-c/core/core';
import { PartsError, refuseIfAny, type Problem } from './errors.ts';
import type { MotionSpec } from './motion.ts';
import type { RigSpec } from './rig.ts';

export type SceneAnimations = CoreMotion['animations'];

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
export function mergeSceneAnimations(rig: RigSpec, motion: MotionSpec, clips: SceneAnimations): void {
  const problems: Problem[] = [];
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

/** Measure the actual gated poses at both endpoints, without wrapping duration to zero.
 * Physics is omitted only from this observation, as in check's keyed-loop bar;
 * the gated/emitted motion and physics constraints are never edited.
 */
export function sceneClipLoopProblems(modelText: string, clips: SceneAnimations): Problem[] {
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
      }
    }
    return problems;
  } catch (err) {
    if (!(err instanceof CoreInputError)) throw err;
    return [{ code: 'SCENE_ANIMATION_POSE_READABLE', object: 'scene.animations', detail: err.message }];
  }
}
