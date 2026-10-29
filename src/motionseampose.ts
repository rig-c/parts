/** Posed-axis evidence from one stock seam render, never sampled source keys. */
import type { GeometryFile, GeometryFrame } from '@rig-c/core/render';
import type { FrameSet } from './check.ts';
import { PartsError } from './errors.ts';

// Stock rig-c 2.69 geometry header, also exported by rig-c/render. render-shared
// does not expose its constants; avoid loading the optional Spine side for a header read.
export const SEAM_GEOMETRY_COORDINATES = 'spine world, y up, world units';
const SEAM_GEOMETRY_SPEC: GeometryFile['spec'] = 'rigc-geometry/1';

export interface SeamMatrix {
  a: number; b: number; c: number; d: number;
  worldX: number; worldY: number;
}
export interface SeamJointPose {
  bone: string;
  parent: string | null;
  world_x_axis_degrees: number | null;
  parent_relative_setup_axis_delta_degrees_mod360: number | null;
  static_range: [number, number] | null;
  comparison: 'axis-modulo-360' | 'unavailable';
  reason?: string;
}
export interface SeamPoseAtWorst {
  index: number;
  time: number;
  joints: SeamJointPose[];
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (detail: string): never => { throw new PartsError([{ code: 'CHECK_GEOMETRY_FILE', object: 'motion seam pose', detail }]); };
const wrap = (degrees: number): number => ((degrees + 180) % 360 + 360) % 360 - 180;
const angle = (a: number, c: number): number => Math.atan2(c, a) * 180 / Math.PI;
const inverseProduct = (p: SeamMatrix, c: SeamMatrix): SeamMatrix | null => {
  const det = p.a * p.d - p.b * p.c;
  if (det === 0 || !Number.isFinite(det)) return null;
  const a = (p.d * c.a - p.b * c.c) / det, b = (p.d * c.b - p.b * c.d) / det;
  const x = (-p.c * c.a + p.a * c.c) / det, d = (-p.c * c.b + p.a * c.d) / det;
  return { a, b, c: x, d, worldX: 0, worldY: 0 };
};
const regular = (m: SeamMatrix): boolean => {
  const x2 = m.a * m.a + m.c * m.c, y2 = m.b * m.b + m.d * m.d;
  // Floating-point arithmetic slack only, relative to the two axis lengths.
  return x2 > 0 && y2 > 0 && m.a * m.d - m.b * m.c > 0 &&
    Math.abs(m.a * m.b + m.c * m.d) <= 64 * Number.EPSILON * Math.sqrt(x2 * y2);
};

/** World axes remain evidence even when local-range equivalence is unavailable. */
export function seamJointPose(bone: string, parent: string | null, inherit: string, setup: SeamMatrix, posed: SeamMatrix,
  parentSetup: SeamMatrix | null, parentPosed: SeamMatrix | null, range: [number, number] | null, rangeReason?: string): SeamJointPose {
  const out: SeamJointPose = { bone, parent, world_x_axis_degrees: posed.a === 0 && posed.c === 0 ? null : angle(posed.a, posed.c),
    parent_relative_setup_axis_delta_degrees_mod360: null, static_range: range, comparison: 'unavailable' };
  if (inherit !== 'normal') return { ...out, reason: `inherit ${inherit}: parent-relative local-range comparison unavailable` };
  if (parent === null || parentSetup === null || parentPosed === null) return { ...out, reason: 'no parent frame for a local-range comparison' };
  const rest = inverseProduct(parentSetup, setup), frame = inverseProduct(parentPosed, posed);
  if (rest === null || frame === null || !regular(rest) || !regular(frame) || !regular(parentSetup) || !regular(parentPosed)) return { ...out, reason: 'singular, reflected, sheared or degenerate axes: local-range comparison unavailable' };
  const delta = wrap(angle(frame.a, frame.c) - angle(rest.a, rest.c));
  out.parent_relative_setup_axis_delta_degrees_mod360 = delta;
  if (range === null) return { ...out, reason: rangeReason ?? 'no declared static range; relative axis delta is modulo 360' };
  if (range[0] <= -180 || range[1] >= 180 || Math.abs(delta) === 180) return { ...out, reason: 'ambiguous winding against static range; relative axis delta is modulo 360' };
  // This is explicitly an axis comparison modulo 360, never an unwrapped local key or a new gate.
  return { ...out, comparison: 'axis-modulo-360', reason: 'normal unsheared axes; modulo 360 only, winding not certified' };
}

/** Identical declarations share one range; conflicting declarations remain explicitly ambiguous. */
export function seamStaticRange(ranges: readonly [number, number][]): { range: [number, number] | null; rangeReason?: string } {
  const unique = [...new Map(ranges.map(range => [JSON.stringify(range), range])).values()];
  return unique.length <= 1 ? { range: unique[0] ?? null }
    : { range: null, rangeReason: `ambiguous declared static ranges ${unique.map(range => JSON.stringify(range)).join(', ')}; no local-range comparison` };
}

export type SeamFrameCohort = Pick<FrameSet, 'animation' | 'fps' | 'viewport'> & { frames: readonly Pick<GeometryFrame, 'index'>[] };
export interface SeamPoseJoint {
  bone: string;
  parent: string | null;
  inherit: string;
  range: [number, number] | null;
  rangeReason?: string;
}

/** Bind stock coordinates, source parent identities and the complete real PNG frame cohort. */
export function seamPoseFrame(geometry: unknown, animation: string, index: number, time: number, cohort: SeamFrameCohort,
  joints: readonly SeamPoseJoint[]): SeamPoseAtWorst {
  if (!record(geometry) || geometry.spec !== SEAM_GEOMETRY_SPEC || geometry.animation !== animation || cohort.animation !== animation ||
    geometry.fps !== cohort.fps || !record(geometry.viewport) || !Array.isArray(geometry.frames) || !record(geometry.setup)) return fail('same-animation stock geometry with matching fps, viewport, setup and frames required');
  if (geometry.coordinates !== SEAM_GEOMETRY_COORDINATES) return fail(`coordinates must be ${JSON.stringify(SEAM_GEOMETRY_COORDINATES)}; found ${JSON.stringify(geometry.coordinates)}`);
  const viewport = cohort.viewport;
  for (const key of ['x', 'y', 'width', 'height', 'scale', 'pixelWidth', 'pixelHeight'] as const) {
    if (typeof viewport[key] !== 'number' || !Number.isFinite(viewport[key]) || geometry.viewport[key] !== viewport[key]) return fail(`viewport ${key} differs from frames.json or is not finite`);
  }
  const roster = Array.isArray(geometry.bones) ? geometry.bones.filter(record) : [];
  if (!Array.isArray(geometry.bones) || roster.length !== geometry.bones.length || roster.some(b => typeof b.name !== 'string' || (b.parent !== null && typeof b.parent !== 'string')) ||
    new Set(roster.map(b => b.name)).size !== roster.length) return fail('bone/parent roster requires unique names and explicit string/null parents');
  const declared = new Map<string, GeometryFile['bones'][number]>(roster.map(b => [String(b.name), { name: String(b.name), parent: b.parent as string | null }]));
  for (const b of declared.values()) if (b.parent !== null && !declared.has(b.parent)) return fail(`bone/parent roster: parent "${b.parent}" of "${b.name}" is missing`);
  for (const j of joints) {
    if (!declared.has(j.bone) || declared.get(j.bone)?.parent !== j.parent || (j.parent !== null && !declared.has(j.parent))) return fail(`bone/parent roster for "${j.bone}" disagrees with source parent ${JSON.stringify(j.parent)}`);
  }
  const frames = geometry.frames.filter(record);
  if (frames.length !== geometry.frames.length || frames.some(f => !Number.isSafeInteger(f.index) || Number(f.index) < 0 || typeof f.time !== 'number' || !Number.isFinite(f.time) || f.time < 0) || new Set(frames.map(f => f.index)).size !== frames.length) return fail('frame cohort requires unique integer indices and finite actual times');
  if (frames.length !== cohort.frames.length || frames.some((f, i) => f.index !== cohort.frames[i].index)) return fail('frame cohort differs from the actual PNG frame set (including unselected frames)');
  const frame = frames.find(f => f.index === index);
  if (!Number.isSafeInteger(index) || !Number.isFinite(time) || frame === undefined || frame.time !== time) return fail(`frame ${index}: raw seam and geometry frame/time differ`);
  const matrix = (rows: unknown, name: string): SeamMatrix => {
    const matches = Array.isArray(rows) ? rows.filter(r => record(r) && r.name === name) : [];
    const row = matches[0];
    if (matches.length !== 1 || !record(row) || ['a','b','c','d','worldX','worldY'].some(k => typeof row[k] !== 'number' || !Number.isFinite(row[k]))) return fail(`bone "${name}": one matrix with six finite numbers required`);
    return { a: Number(row.a), b: Number(row.b), c: Number(row.c), d: Number(row.d), worldX: Number(row.worldX), worldY: Number(row.worldY) };
  };
  const required = new Set(joints.flatMap(j => j.parent === null ? [j.bone] : [j.bone, j.parent]));
  for (const name of required) {
    matrix(geometry.setup.bones, name);
    for (const f of frames) matrix(f.bones, name);
  }
  const setupBones = geometry.setup.bones;
  return { index, time, joints: joints.map(j => seamJointPose(j.bone, j.parent, j.inherit, matrix(setupBones, j.bone), matrix(frame.bones, j.bone),
    j.parent === null ? null : matrix(setupBones, j.parent), j.parent === null ? null : matrix(frame.bones, j.parent), j.range, j.rangeReason)) };
}
