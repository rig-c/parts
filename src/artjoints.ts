/** Explicit art-joint measurements on a fixed skeleton (issue #880). */
import { refuseIfAny, type Problem } from './errors.ts';
import { cropToSpineY } from './coords.ts';
import { edgeLength } from './length.ts';

export interface ArtJoint {
  name: string;
  bone: string;
  /** Measured art point in stage pixels, x right and y down. */
  at: [number, number];
}
export interface FixedSkeleton {
  /** Where the independent art measurements came from; never interpreted. */
  source: string;
  joints: ArtJoint[];
  /** Maximum Euclidean distance in stage pixels. Absent means measurement only. */
  within_px?: number;
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const free = (k: string, v: unknown): boolean => (k.startsWith('x-') && k.length > 2) || ((k === 'note' || k.endsWith('_note')) && typeof v === 'string');

/** Validate without deriving any art point, bone correspondence or limit. */
export function fixedSkeletonProblems(value: unknown, at: string): Problem[] {
  const problems: Problem[] = [];
  const fail = (where: string, detail: string): void => { problems.push({ code: 'REQUIREMENTS_FIELD', object: where, detail }); };
  const keys = (v: Record<string, unknown>, allowed: string[], where: string): void => {
    for (const k of Object.keys(v)) if (!allowed.includes(k) && !free(k, v[k])) fail(`${where}.${k}`, `is unknown; fields are ${allowed.join(', ')}`);
  };
  if (!object(value)) return [{ code: 'REQUIREMENTS_FIELD', object: at, detail: 'requires {source, joints, within_px?}; omit fixed_skeleton for a rig without this declaration' }];
  keys(value, ['source', 'joints', 'within_px'], at);
  if (typeof value.source !== 'string' || value.source.trim() === '') fail(`${at}.source`, 'requires the provenance of the independent art-joint measurements as nonempty text');
  if ('within_px' in value && (!finite(value.within_px) || value.within_px < 0)) fail(`${at}.within_px`, `is ${JSON.stringify(value.within_px)}; a finite nonnegative stage-pixel limit is required, or omit it for a SKIP-class measurement`);
  if (!Array.isArray(value.joints) || value.joints.length === 0) fail(`${at}.joints`, 'requires a nonempty list of {name, bone, at: [x, y]} measured on the art in stage pixels (x right, y down)');
  else {
    const seen = new Set<string>();
    value.joints.forEach((joint, i) => {
      const where = `${at}.joints[${i}]`;
      if (!object(joint)) { fail(where, 'requires {name, bone, at: [x, y]}'); return; }
      keys(joint, ['name', 'bone', 'at'], where);
      for (const k of ['name', 'bone']) if (typeof joint[k] !== 'string' || joint[k].trim() === '') fail(`${where}.${k}`, 'requires a nonempty name');
      if (typeof joint.name === 'string') {
        if (seen.has(joint.name)) fail(`${where}.name`, `declares joint "${joint.name}" twice; each measured joint is declared once`);
        seen.add(joint.name);
      }
      if (!Array.isArray(joint.at) || joint.at.length !== 2 || !joint.at.every(finite)) fail(`${where}.at`, 'requires a finite [x, y] measured on the art in stage pixels (x right, y down)');
    });
  }
  return problems;
}

export const ART_JOINT_LINE = 'ART_JOINT_DISTANCE';
export interface ArtJointRow extends ArtJoint {
  /** Bone origin in the same stage-pixel space as at. */
  bone_at: [number, number];
  distance_px: number;
  status: 'PASS' | 'FAIL' | 'SKIP';
}
export interface ArtJointLine {
  status: 'PASS' | 'FAIL' | 'SKIP';
  instrument: 'rigc-geometry/1 setup.bones';
  source: string;
  within_px: number | null;
  joints: ArtJointRow[];
  reason?: string;
}

/** Compare independent art points to renderer setup origins, never animation frame zero. */
export function artJointLine(
  fixed: FixedSkeleton,
  stage: { x: number; y: number; height: number },
  setup: (bone: string) => { worldX: number; worldY: number },
  problems: Problem[],
): ArtJointLine {
  refuseIfAny(fixedSkeletonProblems(fixed, 'fixed_skeleton'));
  const limit = fixed.within_px;
  const joints = fixed.joints.map<ArtJointRow>(j => {
    const world = setup(j.bone);
    if (!Number.isFinite(world.worldX) || !Number.isFinite(world.worldY)) refuseIfAny([{ code: 'CHECK_ART_JOINT_MEASURED', object: `joint "${j.name}" (bone "${j.bone}")`, detail: 'has no finite renderer setup origin; a missing position is never a zero distance' }]);
    const boneAt: [number, number] = [world.worldX - stage.x, cropToSpineY(world.worldY - stage.y, stage.height)];
    const distance = edgeLength(j.at[0] - boneAt[0], j.at[1] - boneAt[1]);
    if (!Number.isFinite(distance)) refuseIfAny([{ code: 'CHECK_ART_JOINT_MEASURED', object: `joint "${j.name}" (bone "${j.bone}")`, detail: 'has no finite art-to-setup distance; finite stage-pixel coordinates are required' }]);
    const status = limit === undefined ? 'SKIP' : distance > limit ? 'FAIL' : 'PASS';
    if (status === 'FAIL') problems.push({ code: 'CHECK_ART_JOINT_DISTANCE', object: `joint "${j.name}" (bone "${j.bone}")`, detail: `art at [${j.at.join(', ')}] is ${distance} stage px from setup origin [${boneAt.join(', ')}]; distance <= declared fixed_skeleton.within_px ${limit} px is required — correct the art measurement/correspondence if wrong, or supply art aligned to the fixed skeleton; bones are not moved` });
    return { name: j.name, bone: j.bone, at: [...j.at] as [number, number], bone_at: boneAt, distance_px: distance, status };
  });
  return { status: limit === undefined ? 'SKIP' : joints.some(j => j.status === 'FAIL') ? 'FAIL' : 'PASS', instrument: 'rigc-geometry/1 setup.bones', source: fixed.source, within_px: limit ?? null, joints,
    ...(limit === undefined ? { reason: 'fixed_skeleton.within_px is absent; distances are measured, no limit is invented and no joint passes' } : {}) };
}

export function artJointLines(line: ArtJointLine): string[] {
  return [`${ART_JOINT_LINE}: ${line.status}${line.reason === undefined ? '' : ` — ${line.reason}`}; source ${JSON.stringify(line.source)}; ${line.instrument}`,
    ...line.joints.map(j => `${ART_JOINT_LINE}: joint "${j.name}" (bone "${j.bone}") ${j.status} — art [${j.at.join(', ')}], setup [${j.bone_at.join(', ')}], distance ${j.distance_px} px; ${line.within_px === null ? 'no declared limit (SKIP)' : `limit <= ${line.within_px} px`}`)];
}
