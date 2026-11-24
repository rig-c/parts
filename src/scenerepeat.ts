/** Periodic splicing for the imported character idle only. */
import { isDeepStrictEqual } from 'node:util';
import { PartsError } from './errors.ts';

interface Key {
  t: number;
  curve?: unknown;
  ease?: unknown;
}

interface Idle {
  duration: number;
  tracks: Array<{ property: string; bone?: string; group?: string; physics?: string; lag?: number; stagger?: number; keys: Key[] }>;
  deform?: Array<{ slot: string; attachment: string; keys: Key[] }>;
}

function refuse(object: string, detail: string): never {
  throw new PartsError([{ code: 'SCENE_REPEAT_KEY_SEAM', object, detail: `${detail}. The source channel must splice without changing its keyed motion or introducing a physics reset` }]);
}

/** A key's outgoing interpolation is separate from the state it supplies. */
function state({ t: _time, curve: _curve, ease: _ease, ...payload }: Key): unknown {
  // With no authored offset, an omitted or trailing zero deform run names setup coordinates.
  if ('vertices' in payload) {
    if (!Array.isArray(payload.vertices)) delete payload.vertices;
    else {
      const run = payload.vertices.slice();
      while (run.length > 0 && run[run.length - 1] === 0) run.pop();
      if (run.length === 0) delete payload.vertices;
      else payload.vertices = run;
    }
  }
  return payload;
}

function atOffset<K extends Key>(key: K, offset: number, time = key.t + offset): K {
  if (offset === 0) return key;
  const curve = key.curve;
  return { ...key, t: time, ...(Array.isArray(curve) ? {
    curve: curve.map((n: number, i) => i % 2 === 0 ? n + offset : n),
  } : {}) };
}

function repeatTimeline<K extends Key>(keys: K[], count: number, period: number, duration: number, object: string,
  clocks: ReadonlyArray<{ target: string; shift: number }>, property?: string): K[] {
  const first = keys[0], last = keys[keys.length - 1], before = keys[keys.length - 2];
  if (first === undefined) refuse(object, 'has no source keys');
  const startState = state(first), endState = state(last);
  let sharesKey = false;
  for (const { target, shift } of clocks) {
    const start = first.t + shift, end = last.t + shift;
    const clock = `${target} effective first/last key times ${start}/${end} s (lag/stagger ${shift} s, source period ${period} s)`;
    if (property === 'reset') {
      if (!(start > 0 && end < period)) refuse(object, `${clock}; a reset at or outside the boundary cannot be copied across the splice`);
      // A reset is an event, never a state key to coalesce. A float32 collision
      // at either end would move an interior event onto the splice.
      const offset = (count - 1) * period;
      if (Math.fround(offset + start) === Math.fround(offset) || Math.fround(offset + end) === Math.fround(offset + period)) {
        refuse(object, `${clock}; an interior reset reaches the boundary on the float32 clock of the last copy`);
      }
      continue;
    }
    if (start !== 0 || !(end <= period)) refuse(object, `${clock}; a splice needs an explicit start at 0 s and no keys past the source period`);
    if (!isDeepStrictEqual(startState, endState)) {
      refuse(object, `${clock}; the held end ${JSON.stringify(endState)} differs from the start ${JSON.stringify(startState)}`);
    }
    if (end !== period) continue; // The closed state holds through the gap to the next copy.
    sharesKey = true;
    if (before !== undefined && (property === 'inherit' || property === 'attachment' || before.curve === 'stepped' || before.ease === 'stepped') &&
        !isDeepStrictEqual(state(before), endState)) {
      refuse(object, `${clock}; the left limit ${JSON.stringify(state(before))} differs from the boundary key ${JSON.stringify(endState)}`);
    }
  }
  const stride = keys.length - (sharesKey ? 1 : 0);
  if (stride * count + (sharesKey ? 1 : 0) > 0xffffffff) refuse(object, `requires more keys than an array can hold for ${count} copies`);
  const out: K[] = [];
  for (let k = 0; k < count; k++) {
    // The shared key comes from the next copy so its outgoing easing survives.
    // The previous distinct key still carries its own arrival segment.
    const final = k === count - 1;
    const length = final ? keys.length : stride;
    for (let j = 0; j < length; j++) {
      // D + (N - 1) * D can differ from N * D in double arithmetic.
      const terminal = final && sharesKey && j === length - 1 ? duration - clocks[0].shift : undefined;
      out.push(atOffset(keys[j], k * period, terminal));
    }
  }
  return out;
}

export function repeatSceneKeys<T extends Idle>(idle: T, count: number, duration: number, groups: Readonly<Record<string, string[]>>, object: string): T {
  const period = idle.duration;
  if (!Number.isFinite(Math.fround(duration)) || Math.fround(period) === 0 || Math.fround((count - 1) * period) === Math.fround(duration)) {
    refuse(object, `the source period ${period} s cannot separate ${count} copies on the float32 playback clock at ${duration} s`);
  }
  return {
    ...idle,
    duration,
    tracks: idle.tracks.map((track, i) => {
      const where = `${object}.tracks[${i}]`;
      const targets = track.group === undefined ? [track.bone ?? track.physics ?? track.property] : Object.hasOwn(groups, track.group) ? groups[track.group] : [];
      if (targets.length === 0) refuse(where, `group ${JSON.stringify(track.group)} has no resolved members`);
      const clocks = targets.map((target, index) => ({ target: JSON.stringify(target), shift: (track.lag ?? 0) + (track.stagger ?? 0) * index }));
      return { ...track, keys: repeatTimeline(track.keys, count, period, duration, where, clocks, track.property) };
    }),
    ...(idle.deform === undefined ? {} : { deform: idle.deform.map((deform, i) => ({
      ...deform,
      keys: repeatTimeline(deform.keys, count, period, duration, `${object}.deform[${i}]`, [{ target: `${deform.slot}/${deform.attachment}`, shift: 0 }]),
    })) }),
  };
}
