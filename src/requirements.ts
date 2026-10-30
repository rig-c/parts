import { jointMaterialProblems, type JointMaterial } from './cutmaterial.ts';
import { fixedSkeletonProblems, type FixedSkeleton } from './artjoints.ts';
/**
 * What a scene requires of a rig's motion, declared in a file `check` is given
 * (`--requirements`, issue #93, increment 2 of #87) and measured from the
 * world transforms rig-c's `render --geometry` writes.
 *
 * ⭐ **The definitions are #87's, settled before this was written** (its
 * comment "Settled before implementation"); nothing here chooses a bar, a
 * default or a solver. Every bar is the author's, a missing one is refused by
 * name, and every pose is rig-c's.
 *
 * Four outcomes, never merged:
 *
 * | outcome | when | what it does |
 * | --- | --- | --- |
 * | not declared | the file states no requirement of that kind | the summary names the kind; not a pass, not a skip |
 * | refused | a bone, constraint, mesh or animation does not resolve, a field or bar is missing, a `follow` names a property its constraint does not drive, a `contact` is held against its own bone's same point or an `aim` against a point of its own bone (issue #540) | refused by name before anything is built ({@link readRequirements}, {@link resolveRequirements}) |
 * | not measurable | it reads and the rig builds, and the quantity is undefined in the frames | `NOT MEASURABLE — <why>`, with the figures; the run does not PASS |
 * | measured | otherwise | `PASS` or `FAIL` against the author's bar, with the figures and the worst frame |
 *
 * The five kinds and what each measures, per sampled frame of the named
 * animation at the file's `fps` (Spine world units are stage px: the stage
 * box maps to the world by a translation and the y flip alone, `src/coords.ts`):
 *
 * - `contact` — the distance between a bone's tip or origin and a target (a
 *   bone's tip or origin, or a stage point); the largest, against `within_px`.
 * - `follow` — #87's three-pose measurement ({@link followLine}).
 * - `aim` — the angle between a bone's axis and the line from its origin to
 *   a target; the largest, against `within_degrees`. The distance is not judged.
 * - `range` — the bone's world rotation less its parent's (the world's, for the
 *   root), less the same at the setup pose, as a signed shortest angle; the
 *   least and the greatest, against `[lo_degrees, hi_degrees]`.
 * - `stretch` — `TEXTURE_STRETCH`'s own per-mesh measure ({@link stretchFigures},
 *   imported, not rewritten): the mesh's worst max(ratio, 1/ratio) over the
 *   frames, against `within_ratio`.
 * - `seam` (issue #111) — the seam between two parts' art: the pairs of
 *   4-adjacent stage pixels where an art pixel of `part` meets an art pixel of
 *   `neighbour` that is not `part`'s ({@link seamPairs}, read off `parts.json`'s
 *   art at the setup pose), and per frame each pair's opening, the distance
 *   between the two sides' displacements from rest, each read off its
 *   attachment's rest and posed geometry ({@link seamLine}); the largest, its
 *   pair and its frame, against `within_px`.
 *
 * This module is pure: it reads the file, resolves it against the rig spec and
 * motion it is handed, writes the throwaway copies' specs as values, and
 * measures tracks it is handed. `src/check.ts` builds and renders the copies
 * through rig-c and reads their `geometry.json`.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { CompileError } from '@rig-c/core/src/errors.ts';
import { splitRigSkin, type RigSkin } from '@rig-c/core/src/rig.ts';
import { cropToSpineY } from './coords.ts';
import type { Problem } from './errors.ts';
import { refuseIfAny } from './errors.ts';
import { type BoneWorld, type GeometryPose, type MeshRest, stretchFigures, stretchSeverity } from './instruments.ts';
import { ART_ALPHA } from './mesh.ts';
import { alphaAbove, type Raster } from './raster/types.ts';
import { edgeLength } from './length.ts';

/** The file's `spec`. */
export const REQUIREMENTS_SPEC = 'spine-parts-requirements/1';

/** The five kinds, in the order the summary names them. */
export const REQUIREMENT_KINDS = ['contact', 'follow', 'aim', 'range', 'stretch', 'seam'] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

/** A line's status: the three outcomes a declared requirement can have once it is read. */
export type RequirementStatus = 'PASS' | 'FAIL' | 'NOT MEASURABLE';

/** Which point of a bone: its origin, or its tip (the origin plus `length` along the bone's x axis). */
export type BonePoint = 'origin' | 'tip';

/** What a contact or an aim is held against: a point of a bone, or a fixed stage point (stage px, y down). */
export type TargetRef = { bone: string; point: BonePoint } | { stage: [number, number] };

interface RequirementCommon {
  name: string;
  animation: string;
}

export interface ContactRequirement extends RequirementCommon {
  kind: 'contact';
  bone: string;
  point: BonePoint;
  target: TargetRef;
  within_px: number;
}

export interface FollowRequirement extends RequirementCommon {
  kind: 'follow';
  constraint: string;
  constraint_type: 'ik' | 'transform';
  bone: string;
  property: 'rotate' | 'translate';
  fraction: number;
  tolerance: number;
  /** In the property's unit: degrees for `rotate`, stage px for `translate`. */
  least_drive: number;
}

export interface AimRequirement extends RequirementCommon {
  kind: 'aim';
  bone: string;
  target: TargetRef;
  within_degrees: number;
}

export interface RangeRequirement extends RequirementCommon {
  kind: 'range';
  bone: string;
  lo_degrees: number;
  hi_degrees: number;
}

export interface StretchRequirement extends RequirementCommon {
  kind: 'stretch';
  slot: string;
  attachment: string;
  within_ratio: number;
}

/** Issue #111: the seam between two parts' art stays within `within_px` over the animation ({@link seamLine}). `part` and `neighbour` are part names, which are their slots' names. */
export interface SeamRequirement extends RequirementCommon {
  kind: 'seam';
  part: string;
  neighbour: string;
  within_px: number;
}

export type Requirement = ContactRequirement | FollowRequirement | AimRequirement | RangeRequirement | StretchRequirement | SeamRequirement;

/** One stage point of a scene target, at a time in seconds (null for a fixed point). */
export interface TargetPoint {
  t: number | null;
  x: number;
  y: number;
}

/** A scene target: a root-parented bone placed at a stage point, or at stage points at stated times, while one animation is measured. */
export interface SceneTarget {
  bone: string;
  animation: string;
  points: TargetPoint[];
}

export interface RequirementsFile {
  path: string;
  fps: number;
  targets: SceneTarget[];
  requirements: Requirement[];
  /**
   * Issue #231: the parts the scene's figure does not stand on, by name — each
   * a part `check` would otherwise read as a planted foot (a `footwear` part),
   * which the feet halves of `BREATH_VISIBLE` and `STILL_REGIONS_DARK` then
   * name as declared and do not hold still. Empty when the file does not
   * declare it: every footwear part is a planted foot, as before.
   */
  not_planted: string[];
  /**
   * Issue #231: the swinging parts (`handwear`, `bottomwear`) the scene does
   * not mean to swing — a piece cut off and left still — by name.
   * `TIP_OVER_ROOT` names each in its line and does not hold it to the bar.
   * Empty when not declared.
   */
  not_swinging: string[];
  /**
   * Issue #231: the swinging parts whose tip is up — a raised forearm, its
   * chain rising from the elbow — by name. `TIP_OVER_ROOT` reads their upper
   * half as the tip's, after checking that the chain carrying each does rise,
   * and names each in its line. Empty when not declared: every part hangs.
   */
  rises: string[];
  /**
   * Issue #245: the swinging parts whose tip is at rest — a hand lying on the
   * bed while the shoulder moves with the breath — by name. `TIP_OVER_ROOT`
   * holds each to the opposite relation, its tip half travelling no further
   * than its root half, and `CHAIN_LAG` holds the chain carrying each to
   * amplitudes that do not grow toward the tip; each line names them first.
   * Empty when not declared: every swinging part's tip swings.
   */
  rests: string[];
  /**
   * Issue #320: the folds the scene means — a slot whose mesh turns a triangle
   * over in an animation, the idle included (issue #333), on purpose (a sleeve
   * hidden behind the body as the arm crosses it), each by slot and animation
   * with the author's why.
   * `ANIMATIONS_DO_NOT_FOLD` names each such fold with its why and does not
   * hold it to the bar, and fails an entry whose slot does not fold in that
   * animation, as rig-c refuses an exemption that exempts nothing. Empty when
   * not declared: no fold in a named animation is meant.
   */
  may_fold: MayFold[];
  /** Issue #880: an explicit fixed-skeleton art comparison, absent on other rigs. */
  fixed_skeleton?: FixedSkeleton;
  /** Explicit source-support declarations (#888), absent otherwise. */
  cut_material?: JointMaterial[];
}

/** One declared fold (issue #320): a slot, a named animation, and why the fold is the art's. */
export interface MayFold {
  slot: string;
  animation: string;
  why: string;
}

/** What `check --requirements` and `build --requirements` name, said once for the help and the refusals. */
export const REQUIREMENTS_SENTENCE = `--requirements names a ${REQUIREMENTS_SPEC} file: the scene's declared requirements of the rig's motion (contact, follow, aim, range, stretch, seam), each with its animation and the author's own bar, measured from rig-c's render --geometry at the file's fps`;

// ---------------------------------------------------------------------------
// reading the file
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** An annotation (`note`, `*_note`, a string) or a project's record (`x-…`, any value): read by nothing, as in the config. */
function freeKey(key: string, value: unknown): boolean {
  if (key.length > 2 && key.startsWith('x-')) return true;
  return (key === 'note' || key.endsWith('_note')) && typeof value === 'string';
}

/** The fields each kind declares, in the order they are read; every one is required. */
const KIND_FIELDS: Record<RequirementKind, readonly string[]> = {
  contact: ['bone', 'point', 'target', 'within_px'],
  follow: ['constraint', 'constraint_type', 'bone', 'property', 'fraction', 'tolerance', 'least_drive'],
  aim: ['bone', 'target', 'within_degrees'],
  range: ['bone', 'lo_degrees', 'hi_degrees'],
  stretch: ['slot', 'attachment', 'within_ratio'],
  seam: ['part', 'neighbour', 'within_px'],
};

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** The lists of parts a scene excepts from a bar that assumes a standing figure (issues #231, #245), in the order they are read. */
export const EXCEPTION_LISTS = ['not_planted', 'not_swinging', 'rises', 'rests'] as const;
type ExceptionList = (typeof EXCEPTION_LISTS)[number];

/** What each list's absence declares. */
const EXCEPTION_ABSENT: Record<ExceptionList, string> = {
  not_planted: 'every footwear part a planted foot',
  not_swinging: 'every handwear and bottomwear part one that swings',
  rises: 'every swinging part one that hangs',
  rests: 'every swinging part one whose tip swings further than its root',
};

/**
 * Read and shape-check a requirements file. Every problem is collected before
 * one refusal: the file, `spec`, `fps` (required, a positive number: no
 * default), `targets` (optional), `requirements` (required, possibly empty)
 * and `not_planted`, `not_swinging`, `rises` and `rests` (each optional,
 * issues #231 and #245: a non-empty list of distinct part names, no part both
 * in `not_swinging` and in `rises` or `rests`;
 * which parts they are is read against parts.json and the rig by `check`),
 * each entry's every field and bar by name, a key the format does not read,
 * a name used twice, and a `contact` against its own bone and point or an
 * `aim` at a point of its own bone (issue #540: each reads 0 by construction,
 * or no line at all). Resolving the names against the rig is
 * {@link resolveRequirements}'s.
 */
export function readRequirements(path: string): RequirementsFile {
  const at = resolve(path);
  const problems: Problem[] = [];
  const fileProblem = (detail: string): never => {
    refuseIfAny([{ code: 'REQUIREMENTS_FILE', object: at, detail }]);
    throw new Error('unreachable');
  };
  if (!existsSync(at) || !statSync(at).isFile()) return fileProblem(`no such file; ${REQUIREMENTS_SENTENCE}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(at, 'utf8'));
  } catch (err) {
    return fileProblem(`does not parse as JSON: ${(err as Error).message}`);
  }
  if (!isRecord(raw)) return fileProblem(`holds ${JSON.stringify(raw)?.slice(0, 40)}; an object is required`);
  const field = (object: string, detail: string): void => {
    problems.push({ code: 'REQUIREMENTS_FIELD', object, detail });
  };
  const selfTarget = (label: string, detail: string): void => {
    problems.push({ code: 'REQUIREMENTS_SELF_TARGET', object: `${label} field "target"`, detail });
  };
  if (raw.spec !== REQUIREMENTS_SPEC) field(`${at} field "spec"`, `is ${JSON.stringify(raw.spec)}; ${JSON.stringify(REQUIREMENTS_SPEC)} is required`);
  for (const k of Object.keys(raw)) if (!['spec', 'fps', 'targets', 'requirements', ...EXCEPTION_LISTS, 'may_fold', 'fixed_skeleton', 'cut_material'].includes(k) && !freeKey(k, raw[k])) field(`${at} field "${k}"`, 'is not a field this format reads (spec, fps, targets, requirements, not_planted, not_swinging, rises, rests, may_fold, fixed_skeleton, cut_material; note or *_note as a string; x-<name> as a record)');
  if ('cut_material' in raw) problems.push(...jointMaterialProblems(raw.cut_material, `${at} cut_material`));
  if ('fixed_skeleton' in raw) problems.push(...fixedSkeletonProblems(raw.fixed_skeleton, `${at} fixed_skeleton`));
  let fps = NaN;
  if (!(finite(raw.fps) && raw.fps > 0)) field(`${at} field "fps"`, `is ${JSON.stringify(raw.fps)}; a positive number of frames per second is required — every named animation is sampled at it, and there is no default`);
  else fps = raw.fps;

  const requirements: Requirement[] = [];
  if (!Array.isArray(raw.requirements)) field(`${at} field "requirements"`, `is ${JSON.stringify(raw.requirements)}; an array of requirements is required (an empty one declares none)`);
  else {
    const seen = new Set<string>();
    raw.requirements.forEach((r, i) => {
      const where = `requirements[${i}]`;
      if (!isRecord(r)) {
        field(where, `is ${JSON.stringify(r)?.slice(0, 40)}; an object is required`);
        return;
      }
      const name = typeof r.name === 'string' && NAME.test(r.name) ? r.name : null;
      const label = name === null ? where : `${where} "${name}"`;
      if (name === null) field(`${where} field "name"`, `is ${JSON.stringify(r.name)}; a name of letters, digits and underscores, starting with a letter, is required — it names the line`);
      else if (seen.has(name)) field(`${where} field "name"`, `"${name}" is used by an earlier requirement; each line is named once`);
      else seen.add(name);
      const kind = (REQUIREMENT_KINDS as readonly string[]).includes(r.kind as string) ? (r.kind as RequirementKind) : null;
      if (kind === null) field(`${label} field "kind"`, `is ${JSON.stringify(r.kind)}; one of ${REQUIREMENT_KINDS.join(', ')} is required`);
      if (typeof r.animation !== 'string' || r.animation.length === 0) field(`${label} field "animation"`, `is ${JSON.stringify(r.animation)}; the name of the animation it is measured over is required`);
      if (kind === null) return;
      const known = ['name', 'kind', 'animation', ...KIND_FIELDS[kind]];
      for (const k of Object.keys(r)) if (!known.includes(k) && !freeKey(k, r[k])) field(`${label} field "${k}"`, `is not a field a ${kind} requirement reads (${KIND_FIELDS[kind].join(', ')})`);
      const before = problems.length;
      const str = (k: string): string => {
        const v = r[k];
        if (typeof v !== 'string' || v.length === 0) field(`${label} field "${k}"`, `is ${JSON.stringify(v)}; a name is required`);
        return typeof v === 'string' ? v : '';
      };
      const bar = (k: string, rule: (v: number) => boolean, what: string): number => {
        const v = r[k];
        if (!finite(v) || !rule(v)) field(`${label} field "${k}"`, `is ${JSON.stringify(v)}; ${what} is required — the bar is the author's, and there is no default`);
        return finite(v) ? v : NaN;
      };
      const point = (k: string, v: unknown): BonePoint => {
        if (v !== 'origin' && v !== 'tip') field(`${label} field "${k}"`, `is ${JSON.stringify(v)}; "origin" or "tip" is required`);
        return v === 'tip' ? 'tip' : 'origin';
      };
      const target = (): TargetRef => {
        const t = r.target;
        if (isRecord(t) && 'stage' in t && !('bone' in t)) {
          const s = t.stage;
          if (!(Array.isArray(s) && s.length === 2 && s.every(finite)) || Object.keys(t).length !== 1) field(`${label} field "target"`, `is ${JSON.stringify(t)}; { "stage": [x, y] } in stage px (y down) is required for a stage point`);
          return { stage: Array.isArray(s) && s.length === 2 && s.every(finite) ? [s[0] as number, s[1] as number] : [NaN, NaN] };
        }
        if (isRecord(t) && typeof t.bone === 'string' && t.bone.length > 0 && Object.keys(t).every((k) => k === 'bone' || k === 'point')) return { bone: t.bone, point: point('target.point', t.point) };
        field(`${label} field "target"`, `is ${JSON.stringify(t)}; { "bone": <name>, "point": "origin" | "tip" } or { "stage": [x, y] } is required`);
        return { stage: [NaN, NaN] };
      };
      const common = { name: name ?? '', animation: typeof r.animation === 'string' ? r.animation : '' };
      let req: Requirement;
      if (kind === 'contact') {
        req = { ...common, kind, bone: str('bone'), point: point('point', r.point), target: target(), within_px: bar('within_px', (v) => v >= 0, 'a distance in stage px, 0 or more,') };
        // Issue #540: a point against itself is 0 apart on every frame; the bone's other point is a reading (its length).
        if ('bone' in req.target && req.bone.length > 0 && req.target.bone === req.bone && req.target.point === req.point) {
          const other = req.point === 'tip' ? 'origin' : 'tip';
          selfTarget(label, `contact of bone "${req.bone}" ${req.point} against bone "${req.target.bone}" ${req.target.point}, the same point: it measures 0 by construction, so a PASS says nothing — a different bone is required, or the bone's other point ("${other}")`);
        }
      } else if (kind === 'follow') {
        const type = r.constraint_type;
        if (type !== 'ik' && type !== 'transform') field(`${label} field "constraint_type"`, `is ${JSON.stringify(type)}; "ik" or "transform" is required — a constraint resolves by name AND type, as in rig-c`);
        const prop = r.property;
        if (prop !== 'rotate' && prop !== 'translate') field(`${label} field "property"`, `is ${JSON.stringify(prop)}; "rotate" or "translate" is required`);
        req = {
          ...common,
          kind,
          constraint: str('constraint'),
          constraint_type: type === 'transform' ? 'transform' : 'ik',
          bone: str('bone'),
          property: prop === 'translate' ? 'translate' : 'rotate',
          fraction: bar('fraction', () => true, 'a number, the fraction of the drive the bone takes,'),
          tolerance: bar('tolerance', (v) => v >= 0, 'a number 0 or more'),
          least_drive: bar('least_drive', (v) => v > 0, 'a number above 0 (degrees for rotate, stage px for translate): at 0 a frame where the constraint asks nothing would count'),
        };
      } else if (kind === 'aim') {
        req = { ...common, kind, bone: str('bone'), target: target(), within_degrees: bar('within_degrees', (v) => v >= 0 && v <= 180, 'an angle in degrees from 0 to 180') };
        // Issue #540: the aimed bone's own tip lies on its axis (0 degrees on every frame) and its own origin gives no line at all.
        if ('bone' in req.target && req.bone.length > 0 && req.target.bone === req.bone) {
          const why = req.target.point === 'tip' ? 'its tip lies on its own axis, so the angle measures 0 by construction and a PASS says nothing' : 'its origin is where the line starts, so there is no line to aim along on any frame and nothing is measured';
          selfTarget(label, `aim of bone "${req.bone}" axis against bone "${req.target.bone}" ${req.target.point}, a point of the aimed bone itself: ${why} — a different bone or a stage point is required`);
        }
      } else if (kind === 'range') {
        const lo = bar('lo_degrees', () => true, 'an angle in degrees');
        const hi = bar('hi_degrees', () => true, 'an angle in degrees');
        if (finite(lo) && finite(hi) && lo > hi) field(`${label} fields "lo_degrees", "hi_degrees"`, `are ${lo} and ${hi}; lo_degrees <= hi_degrees is required`);
        req = { ...common, kind, bone: str('bone'), lo_degrees: lo, hi_degrees: hi };
      } else if (kind === 'stretch') {
        req = { ...common, kind, slot: str('slot'), attachment: str('attachment'), within_ratio: bar('within_ratio', (v) => v >= 1, 'a ratio 1 or more (the figure is max(ratio, 1/ratio), never below 1)') };
      } else {
        const part = str('part');
        const neighbour = str('neighbour');
        if (part.length > 0 && part === neighbour) field(`${label} fields "part", "neighbour"`, `both name "${part}"; two different parts are required — a seam is where one part's art meets another's`);
        req = { ...common, kind, part, neighbour, within_px: bar('within_px', (v) => v >= 0, 'a distance in stage px, 0 or more,') };
      }
      if (problems.length === before && name !== null) requirements.push(req);
    });
  }

  const targets: SceneTarget[] = [];
  if (raw.targets !== undefined) {
    if (!Array.isArray(raw.targets)) field(`${at} field "targets"`, `is ${JSON.stringify(raw.targets)}; an array of scene targets is required when the field is given`);
    else {
      raw.targets.forEach((t, i) => {
        const where = `targets[${i}]`;
        if (!isRecord(t)) {
          field(where, `is ${JSON.stringify(t)?.slice(0, 40)}; an object is required`);
          return;
        }
        const before = problems.length;
        for (const k of Object.keys(t)) if (!['bone', 'animation', 'at', 'keys'].includes(k) && !freeKey(k, t[k])) field(`${where} field "${k}"`, 'is not a field a scene target reads (bone, animation, and at or keys)');
        if (typeof t.bone !== 'string' || t.bone.length === 0) field(`${where} field "bone"`, `is ${JSON.stringify(t.bone)}; the name of a bone whose parent is the root is required`);
        if (typeof t.animation !== 'string' || t.animation.length === 0) field(`${where} field "animation"`, `is ${JSON.stringify(t.animation)}; the animation it is placed for is required`);
        const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(finite);
        const points: TargetPoint[] = [];
        if (('at' in t) === ('keys' in t)) field(where, `has ${'at' in t ? 'both "at" and "keys"' : 'neither "at" nor "keys"'}; exactly one is required — "at": [x, y], a fixed stage point, or "keys": [{ "t": <s>, "at": [x, y] }, …]`);
        else if ('at' in t) {
          if (!pair(t.at)) field(`${where} field "at"`, `is ${JSON.stringify(t.at)}; [x, y] in stage px (y down) is required`);
          else points.push({ t: null, x: t.at[0], y: t.at[1] });
        } else if (!Array.isArray(t.keys) || t.keys.length === 0) field(`${where} field "keys"`, `is ${JSON.stringify(t.keys)}; at least one { "t": <s>, "at": [x, y] } is required`);
        else {
          t.keys.forEach((k, j) => {
            if (!isRecord(k) || !finite(k.t) || !pair(k.at) || Object.keys(k).length !== 2) {
              field(`${where} field "keys[${j}]"`, `is ${JSON.stringify(k)}; { "t": <seconds>, "at": [x, y] } is required`);
              return;
            }
            const prev = points[points.length - 1];
            if (prev !== undefined && !((k.t as number) > (prev.t as number))) field(`${where} field "keys[${j}].t"`, `is ${k.t}, not after the key before it (${prev.t}); times strictly increasing are required`);
            points.push({ t: k.t as number, x: k.at[0], y: k.at[1] });
          });
        }
        if (problems.length === before) targets.push({ bone: t.bone as string, animation: t.animation as string, points });
      });
    }
  }
  const lists = {} as Record<ExceptionList, string[]>;
  for (const key of EXCEPTION_LISTS) {
    const names: string[] = [];
    lists[key] = names;
    const v = raw[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.length === 0) {
      field(`${at} field "${key}"`, `is ${JSON.stringify(v)?.slice(0, 60)}; a non-empty list of part names is required when the field is given — leave it out to declare ${EXCEPTION_ABSENT[key]}`);
      continue;
    }
    v.forEach((n, i) => {
      if (typeof n !== 'string' || n.length === 0) field(`${at} field "${key}"[${i}]`, `is ${JSON.stringify(n)?.slice(0, 40)}; a part name is required`);
      else if (names.includes(n)) field(`${at} field "${key}"[${i}]`, `names "${n}" a second time; each part is declared once`);
      else names.push(n);
    });
  }
  lists.rises.forEach((n, i) => {
    if (lists.not_swinging.includes(n)) field(`${at} field "rises"[${i}]`, `names "${n}", which "not_swinging" names too; a part that does not swing has no tip to read up or down`);
  });
  // Issue #245: rests is a reading (the tip no further than the root) and not_swinging is none, so a part cannot be both.
  lists.rests.forEach((n, i) => {
    if (lists.not_swinging.includes(n)) field(`${at} field "rests"[${i}]`, `names "${n}", which "not_swinging" names too; a part declared not swinging is not measured, so there is no tip to hold at rest — leave it in one list`);
  });
  // Issue #320: may_fold, a non-empty list of { slot, animation, why }, each pair once; which slots and animations they are is read against the rig by resolveRequirements.
  const mayFold: MayFold[] = [];
  if (raw.may_fold !== undefined) {
    if (!Array.isArray(raw.may_fold) || raw.may_fold.length === 0) field(`${at} field "may_fold"`, `is ${JSON.stringify(raw.may_fold)?.slice(0, 60)}; a non-empty list of { "slot", "animation", "why" } is required when the field is given — leave it out to declare that no fold in a named animation is meant`);
    else {
      raw.may_fold.forEach((e, i) => {
        const where = `${at} field "may_fold"[${i}]`;
        if (!isRecord(e)) {
          field(where, `is ${JSON.stringify(e)?.slice(0, 40)}; { "slot": <name>, "animation": <name>, "why": <text> } is required`);
          return;
        }
        const before = problems.length;
        for (const k of Object.keys(e)) if (!['slot', 'animation', 'why'].includes(k) && !freeKey(k, e[k])) field(`${where} field "${k}"`, 'is not a field a may_fold entry reads (slot, animation, why)');
        for (const k of ['slot', 'animation', 'why'] as const) {
          if (typeof e[k] !== 'string' || (e[k] as string).trim().length === 0) field(`${where} field "${k}"`, `is ${JSON.stringify(e[k])}; ${k === 'why' ? 'the reason the fold is the art\'s, in words, is required — an exception without one is a silenced bar' : `a ${k} name is required`}`);
        }
        if (problems.length !== before) return;
        const entry: MayFold = { slot: e.slot as string, animation: e.animation as string, why: e.why as string };
        if (mayFold.some((m) => m.slot === entry.slot && m.animation === entry.animation)) field(where, `declares slot "${entry.slot}" in animation "${entry.animation}" a second time; each pair is declared once`);
        else mayFold.push(entry);
      });
    }
  }
  refuseIfAny(problems);
  return { path: at, fps, targets, requirements, not_planted: lists.not_planted, not_swinging: lists.not_swinging, rises: lists.rises, rests: lists.rests, may_fold: mayFold, ...(raw.fixed_skeleton === undefined ? {} : { fixed_skeleton: raw.fixed_skeleton as FixedSkeleton }), ...(raw.cut_material === undefined ? {} : { cut_material: raw.cut_material as JointMaterial[] }) };
}

// ---------------------------------------------------------------------------
// resolving against the rig
// ---------------------------------------------------------------------------

/** A file-system-safe animation name: it names a directory under `<out>/requirements/`. */
function safeDirName(n: string): boolean {
  return n.length > 0 && n !== '.' && n !== '..' && !/[/\\\0]/.test(n);
}

function bonesOf(rig: Record<string, unknown>): Array<Record<string, unknown>> {
  return (Array.isArray(rig.bones) ? rig.bones : []).filter(isRecord);
}

function constraintsOf(rig: Record<string, unknown>): Array<Record<string, unknown>> {
  return (Array.isArray(rig.constraints) ? rig.constraints : []).filter(isRecord);
}

function animationsOf(motion: Record<string, unknown>): Record<string, unknown> {
  return isRecord(motion.animations) ? motion.animations : {};
}

/** The `to` property names a transform constraint declares, over every `properties` entry. */
function transformDrives(c: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  if (isRecord(c.properties)) for (const p of Object.values(c.properties)) if (isRecord(p) && isRecord(p.to)) for (const k of Object.keys(p.to)) out.add(k);
  return out;
}

/** The property names a bone track moves the bone's translation by. */
const TRANSLATE_PROPERTIES = ['translate', 'translatex', 'translatey'];

/**
 * Resolve every name the file uses against the rig spec and its motion,
 * collecting every problem before one refusal — this runs before anything is
 * built. Refused, by name: an animation the motion does not declare (or whose
 * name cannot be a directory); a bone, a constraint of the declared type, a
 * slot or a mesh attachment the rig does not declare; a `follow` whose bone the
 * constraint does not constrain or whose property it does not drive (an `ik`
 * drives `rotate` only; a `transform` drives `rotate` when a `to` names
 * `rotate`, `translate` when one names `x` or `y`); a scene target whose bone
 * is the root or is not parented to it (a stage point is not a local offset
 * under a moving parent), whose root is not at rest at the origin or is keyed
 * in that animation, whose bone a group translates there, whose keys fall
 * outside the animation, that names a bone and animation twice, or that no
 * requirement measures.
 */
export function resolveRequirements(file: RequirementsFile, rig: Record<string, unknown>, motion: Record<string, unknown>, rootBone: string): void {
  const problems: Problem[] = [];
  const unresolved = (object: string, detail: string): void => {
    problems.push({ code: 'REQUIREMENTS_RESOLVES', object, detail });
  };
  const bones = bonesOf(rig);
  const boneNames = bones.map((b) => b.name).filter((n): n is string => typeof n === 'string');
  const anims = animationsOf(motion);
  const animNames = Object.keys(anims);
  const listed = (xs: readonly string[]): string => (xs.length === 0 ? 'none' : xs.map((x) => `"${x}"`).join(', '));
  const animation = (object: string, a: string): boolean => {
    if (!(a in anims) || !isRecord(anims[a])) {
      unresolved(object, `names animation "${a}", which motion.json does not declare; it declares ${listed(animNames)}`);
      return false;
    }
    if (!safeDirName(a)) {
      unresolved(object, `names animation ${JSON.stringify(a)}, whose name cannot name the directory its frames are written into (no "/", "\\", ".", "..")`);
      return false;
    }
    return true;
  };
  const bone = (object: string, b: string): boolean => {
    if (boneNames.includes(b)) return true;
    unresolved(object, `names bone "${b}", which rig.json does not declare; it declares ${listed(boneNames)}`);
    return false;
  };
  const target = (object: string, t: TargetRef): void => {
    if ('bone' in t) bone(`${object} target`, t.bone);
  };
  for (const j of file.fixed_skeleton?.joints ?? []) bone(`fixed_skeleton joint "${j.name}"`, j.bone);
  for (const r of file.requirements) {
    const object = `requirement "${r.name}" (${r.kind})`;
    animation(object, r.animation);
    if (r.kind === 'contact') {
      bone(object, r.bone);
      target(object, r.target);
    } else if (r.kind === 'aim') {
      bone(object, r.bone);
      target(object, r.target);
    } else if (r.kind === 'range') bone(object, r.bone);
    else if (r.kind === 'seam') {
      const slots = (Array.isArray(rig.slots) ? rig.slots : []).filter(isRecord).map((s) => s.name);
      for (const [field, name] of [['part', r.part], ['neighbour', r.neighbour]] as const) {
        if (!slots.includes(name)) unresolved(object, `names ${field} "${name}", which rig.json declares no slot for; a part is drawn by the slot of its name`);
      }
    } else if (r.kind === 'follow') {
      bone(object, r.bone);
      const c = constraintsOf(rig).find((x) => x.name === r.constraint && x.type === r.constraint_type);
      if (c === undefined) {
        const declared = constraintsOf(rig)
          .filter((x) => x.type === 'ik' || x.type === 'transform')
          .map((x) => `${String(x.type)} "${String(x.name)}"`);
        unresolved(object, `names ${r.constraint_type} constraint "${r.constraint}", which rig.json does not declare; it declares ${declared.length === 0 ? 'no ik or transform constraint' : declared.join(', ')}`);
        continue;
      }
      const constrained = (Array.isArray(c.bones) ? c.bones : []).filter((b): b is string => typeof b === 'string');
      if (!constrained.includes(r.bone)) {
        problems.push({ code: 'REQUIREMENTS_CONSTRAINT_DRIVES', object, detail: `names bone "${r.bone}", which ${r.constraint_type} constraint "${r.constraint}" does not constrain (its bones: ${listed(constrained)}); a follow measures what the constraint asks of one of its own bones` });
      }
      if (r.constraint_type === 'ik' && r.property !== 'rotate') {
        problems.push({ code: 'REQUIREMENTS_CONSTRAINT_DRIVES', object, detail: `names property "${r.property}" of ik constraint "${r.constraint}"; an ik drives rotate only` });
      }
      if (r.constraint_type === 'transform') {
        const drives = transformDrives(c);
        const ok = r.property === 'rotate' ? drives.has('rotate') : drives.has('x') || drives.has('y');
        if (!ok) {
          problems.push({
            code: 'REQUIREMENTS_CONSTRAINT_DRIVES',
            object,
            detail: `names property "${r.property}" of transform constraint "${r.constraint}", whose properties drive ${listed([...drives].sort())}; ${r.property === 'rotate' ? 'a "to" naming rotate' : 'a "to" naming x or y'} is required — a mix is read only for a property the constraint drives`,
          });
        }
      }
    } else {
      const slots = (Array.isArray(rig.slots) ? rig.slots : []).filter(isRecord).map((s) => s.name);
      if (!slots.includes(r.slot)) {
        unresolved(object, `names slot "${r.slot}", which rig.json does not declare`);
        continue;
      }
      const meshes = meshAttachmentsOf(rig, r.slot);
      if (typeof meshes === 'string') problems.push({ code: 'REQUIREMENTS_RESOLVES', object, detail: meshes });
      else if (!meshes.includes(r.attachment)) unresolved(object, `names mesh attachment "${r.attachment}" on slot "${r.slot}", which no skin in rig.json declares; its mesh attachments are ${listed(meshes)}`);
    }
  }

  // Issues #320, #333: each declared fold names a slot that holds a mesh and an animation motion.json declares — the idle
  // included, since ANIMATIONS_DO_NOT_FOLD reads every animation.
  file.may_fold.forEach((m, i) => {
    const object = `may_fold[${i}] (slot "${m.slot}", animation "${m.animation}")`;
    if (!(m.animation in anims)) unresolved(object, `names animation "${m.animation}", which motion.json does not declare; it declares ${listed(animNames)}`);
    const slots = (Array.isArray(rig.slots) ? rig.slots : []).filter(isRecord).map((s) => s.name);
    if (!slots.includes(m.slot)) {
      unresolved(object, `names slot "${m.slot}", which rig.json does not declare`);
      return;
    }
    const meshes = meshAttachmentsOf(rig, m.slot);
    if (typeof meshes === 'string') problems.push({ code: 'REQUIREMENTS_RESOLVES', object, detail: meshes });
    else if (meshes.length === 0) problems.push({ code: 'REQUIREMENTS_MAY_FOLD', object, detail: `names slot "${m.slot}", which no skin in rig.json gives a mesh attachment; a region is one quad and cannot fold, so declaring it excepts nothing` });
  });

  const root = bones.find((b) => b.name === rootBone);
  const measured = new Set(file.requirements.map((r) => r.animation));
  const placed = new Set<string>();
  file.targets.forEach((t, i) => {
    const object = `targets[${i}] (bone "${t.bone}", animation "${t.animation}")`;
    const okBone = bone(object, t.bone);
    const okAnim = animation(object, t.animation);
    const key = `${t.bone}\u0000${t.animation}`;
    if (placed.has(key)) problems.push({ code: 'REQUIREMENTS_TARGET', object, detail: 'places the same bone for the same animation as an earlier target; one placement per bone and animation is required' });
    placed.add(key);
    if (okAnim && !measured.has(t.animation)) problems.push({ code: 'REQUIREMENTS_TARGET', object, detail: `no requirement is measured over animation "${t.animation}", so the placement would move nothing that is read` });
    if (!okBone) return;
    const b = bones.find((x) => x.name === t.bone) as Record<string, unknown>;
    if (t.bone === rootBone) problems.push({ code: 'REQUIREMENTS_TARGET_PARENT', object, detail: `is the root; a scene target is a bone whose parent is the root "${rootBone}"` });
    else if (b.parent !== rootBone) {
      problems.push({ code: 'REQUIREMENTS_TARGET_PARENT', object, detail: `has parent ${JSON.stringify(b.parent)}; the root "${rootBone}" is required — a stage point is not a local offset under a moving parent` });
    }
    const rest: Record<string, number> = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 };
    const off = root === undefined ? [] : Object.keys(rest).filter((k) => k in root && root[k] !== rest[k]);
    if (off.length > 0) {
      problems.push({ code: 'REQUIREMENTS_TARGET_PARENT', object, detail: `the root "${rootBone}" is not at rest at the origin (${off.map((k) => `${k} ${JSON.stringify(root?.[k])}`).join(', ')}); a stage point is placed as a root-local position only under a root at rest` });
    }
    if (!okAnim) return;
    const a = anims[t.animation] as Record<string, unknown>;
    const tracks = (Array.isArray(a.tracks) ? a.tracks : []).filter(isRecord);
    if (tracks.some((tr) => tr.bone === rootBone)) problems.push({ code: 'REQUIREMENTS_TARGET_PARENT', object, detail: `animation "${t.animation}" keys the root "${rootBone}"; a stage point is placed as a root-local position only under a root the animation does not move` });
    const groups = isRecord(motion.groups) ? motion.groups : {};
    for (const tr of tracks) {
      if (typeof tr.group !== 'string' || !TRANSLATE_PROPERTIES.includes(String(tr.property))) continue;
      const members = groups[tr.group];
      if (Array.isArray(members) && members.includes(t.bone)) {
        problems.push({ code: 'REQUIREMENTS_TARGET', object, detail: `animation "${t.animation}" moves it by group "${tr.group}" ${String(tr.property)}; a placed target's translation is the scene's, so a group track over it is required not to key it` });
      }
    }
    const duration = a.duration;
    for (const p of t.points) {
      if (p.t !== null && finite(duration) && (p.t < 0 || p.t > duration)) problems.push({ code: 'REQUIREMENTS_TARGET', object, detail: `has a key at t = ${p.t}s; animation "${t.animation}" runs from 0 to ${duration}s, and a key inside it is required` });
    }
  });
  refuseIfAny(problems);
}

/** The mesh attachment names a slot holds in any skin, through rig-c's own skin reader; a string (the refusal's detail) when a skin does not read. */
function meshAttachmentsOf(rig: Record<string, unknown>, slot: string): string[] | string {
  const out = new Set<string>();
  const skins = isRecord(rig.skins) ? rig.skins : {};
  for (const [name, skin] of Object.entries(skins)) {
    let atts: Record<string, Record<string, unknown>>;
    try {
      atts = splitRigSkin(skin as RigSkin, `rig.json skin "${name}"`).attachments as Record<string, Record<string, unknown>>;
    } catch (err) {
      if (err instanceof CompileError) return `rig-c's skin reader refuses rig.json skin "${name}": ${err.message}`;
      throw err;
    }
    const held = atts[slot];
    if (!isRecord(held)) continue;
    for (const [att, v] of Object.entries(held)) if (isRecord(v) && v.type === 'mesh') out.add(att);
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// the throwaway copies
// ---------------------------------------------------------------------------

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** A stage point (stage px, y down) as a Spine world point, through the stage box and the one y door. */
export function stageToWorld(p: readonly [number, number], stage: { x: number; y: number; height: number }): [number, number] {
  return [stage.x + p[0], stage.y + cropToSpineY(p[1], stage.height)];
}

/**
 * The rig spec and motion with each scene target of `animation` written in:
 * the bone's setup position is its first point (a root at rest at the origin,
 * which {@link resolveRequirements} holds, makes a root-local position the
 * world point), every track of that animation that keys its translation
 * directly is dropped, and, for timed points, one `translate` track keys every
 * point relative to the first — linear between keys, and outside them the
 * first point (the setup) before and the last after. The inputs are not
 * altered.
 */
export function placeTargets(rig: Record<string, unknown>, motion: Record<string, unknown>, targets: readonly SceneTarget[], animation: string, stage: { x: number; y: number; height: number }): { rig: Record<string, unknown>; motion: Record<string, unknown> } {
  const r = clone(rig);
  const m = clone(motion);
  const mine = targets.filter((t) => t.animation === animation);
  if (mine.length === 0) return { rig: r, motion: m };
  const a = animationsOf(m)[animation] as Record<string, unknown>;
  let tracks = (Array.isArray(a.tracks) ? a.tracks : []).filter(isRecord);
  for (const t of mine) {
    const [x0, y0] = stageToWorld([t.points[0].x, t.points[0].y], stage);
    const b = bonesOf(r).find((x) => x.name === t.bone) as Record<string, unknown>;
    b.x = x0;
    b.y = y0;
    tracks = tracks.filter((tr) => !(tr.bone === t.bone && TRANSLATE_PROPERTIES.includes(String(tr.property))));
    if (t.points[0].t !== null) {
      tracks.push({
        bone: t.bone,
        property: 'translate',
        keys: t.points.map((p) => {
          const [x, y] = stageToWorld([p.x, p.y], stage);
          return { t: p.t, v: [x - x0, y - y0] };
        }),
      });
    }
  }
  a.tracks = tracks;
  return { rig: r, motion: m };
}

/** The mix fields of a follow's property and the curve channel each sits in: an ik's `mix` (channel 0); a transform's `mixRotate` (0), or `mixX` and `mixY` (1, 2). */
export function mixFields(f: Pick<FollowRequirement, 'constraint_type' | 'property'>): Array<{ field: string; channel: number }> {
  if (f.constraint_type === 'ik') return [{ field: 'mix', channel: 0 }];
  return f.property === 'rotate'
    ? [{ field: 'mixRotate', channel: 0 }]
    : [
        { field: 'mixX', channel: 1 },
        { field: 'mixY', channel: 2 },
      ];
}

/**
 * #87's released (`value` 0) or full (`value` 1) copy of a follow's rig and
 * motion: the constraint's mix for that property forced to `value` in the rig
 * spec, and every key of that mix in the animation replaced by `value`, its
 * curve channel's two value numbers with it — a timeline that holds `value`
 * throughout, which is what removing the keys under a setup mix of `value`
 * poses, while every other field those keys state (softness, bend, the other
 * mixes) stays as written, so the copy differs from the rig in that one mix
 * only. Other animations are not touched. The full copy also drops the
 * constraint from `invariants.consumerDrivenMix` if the rig declares it there:
 * at 1 it rests live, and rig-c refuses a declaration that exempts nothing.
 */
export function forceMix(rig: Record<string, unknown>, motion: Record<string, unknown>, f: FollowRequirement, value: 0 | 1): { rig: Record<string, unknown>; motion: Record<string, unknown> } {
  const r = clone(rig);
  const m = clone(motion);
  const fields = mixFields(f);
  const c = constraintsOf(r).find((x) => x.name === f.constraint && x.type === f.constraint_type) as Record<string, unknown>;
  for (const { field } of fields) c[field] = value;
  const a = animationsOf(m)[f.animation];
  if (isRecord(a)) {
    const group = f.constraint_type === 'ik' ? a.ik : a.transform;
    for (const track of (Array.isArray(group) ? group : []).filter(isRecord)) {
      if (track.constraint !== f.constraint) continue;
      for (const key of (Array.isArray(track.keys) ? track.keys : []).filter(isRecord)) {
        for (const { field, channel } of fields) {
          key[field] = value;
          if (Array.isArray(key.curve)) {
            if (4 * channel + 3 < key.curve.length) {
              key.curve[4 * channel + 1] = value;
              key.curve[4 * channel + 3] = value;
            }
          }
        }
      }
    }
  }
  if (value === 1 && isRecord(r.invariants) && Array.isArray(r.invariants.consumerDrivenMix)) {
    const kept = r.invariants.consumerDrivenMix.filter((e) => !(isRecord(e) && e.constraint === f.constraint && e.type === f.constraint_type));
    if (kept.length === 0) delete r.invariants.consumerDrivenMix;
    else r.invariants.consumerDrivenMix = kept;
  }
  return { rig: r, motion: m };
}

/** Why the released copy declares its constraint consumer-driven, written into the copy's `invariants.consumerDrivenMix`. */
export function releasedWhy(f: FollowRequirement): string {
  return `rig-parts check --requirements: the released pose of follow requirement "${f.name}" forces this mix to 0 on a throwaway copy; the rig under test is not altered`;
}

/**
 * The released copy with its constraint declared consumer-driven — rig-c's
 * door for a constraint muted throughout (`A47`/`A48`), which the released pose
 * is by construction. Used only when rigc's gate refused the released copy for
 * that constraint alone ({@link mutedOnly}).
 */
export function declareConsumerDriven(rig: Record<string, unknown>, f: FollowRequirement): Record<string, unknown> {
  const r = clone(rig);
  const inv = isRecord(r.invariants) ? r.invariants : {};
  const list = Array.isArray(inv.consumerDrivenMix) ? inv.consumerDrivenMix : [];
  r.invariants = { ...inv, consumerDrivenMix: [...list, { constraint: f.constraint, type: f.constraint_type, why: releasedWhy(f) }] };
  return r;
}

/** rig-c's rule a muted-throughout constraint of each type fails, and the words its line names the constraint with. */
export function mutedLine(f: Pick<FollowRequirement, 'constraint' | 'constraint_type'>): { rule: string; names: string } {
  return f.constraint_type === 'ik'
    ? { rule: 'A47_IK_CONSTRAINT_NOT_MUTED_THROUGHOUT', names: `ik constraint "${f.constraint}" has mix` }
    : { rule: 'A48_TRANSFORM_CONSTRAINT_NOT_MUTED_THROUGHOUT', names: `transform constraint "${f.constraint}" drives` };
}

/** Whether a red build's FAIL lines are all, and only, the muted-throughout refusal of the follow's own constraint. */
export function mutedOnly(failLines: readonly string[], f: Pick<FollowRequirement, 'constraint' | 'constraint_type'>): boolean {
  const { rule, names } = mutedLine(f);
  return failLines.length > 0 && failLines.every((l) => l.includes(`${rule}: ${names}`));
}

// ---------------------------------------------------------------------------
// measuring
// ---------------------------------------------------------------------------

/** One posed render of an animation: each frame's index and time, and a bone's world transform by name (setup and per frame). */
export interface Poses {
  /** What it is, for the lines: "as declared", "released", "full". */
  label: string;
  indices: number[];
  times: number[];
  bone: (name: string) => { setup: BoneWorld; frames: BoneWorld[] };
}

/** What a measure reads beside the poses: each bone's `length` and parent from the rig spec, and the stage box. */
export interface RigFacts {
  lengths: Map<string, number>;
  parents: Map<string, string | null>;
  stage: { x: number; y: number; height: number };
}

/** The bone facts a measure reads, off a rig spec: `length` (absent is 0, as Spine reads it) and `parent`. */
export function rigFacts(rig: Record<string, unknown>, stage: { x: number; y: number; height: number }): RigFacts {
  const lengths = new Map<string, number>();
  const parents = new Map<string, string | null>();
  for (const b of bonesOf(rig)) {
    if (typeof b.name !== 'string') continue;
    lengths.set(b.name, finite(b.length) ? b.length : 0);
    parents.set(b.name, typeof b.parent === 'string' ? b.parent : null);
  }
  return { lengths, parents, stage };
}

/** One requirement's line: its kind, animation and status, then its figures (and, NOT MEASURABLE, the reason first). */
export type RequirementLine = { kind: RequirementKind; animation: string; status: RequirementStatus; [figure: string]: unknown };

const DEG = 180 / Math.PI;

/** Six decimals: what a line prints and check.json holds. The comparison with the bar reads the unrounded figure. */
export function round6(x: number): number {
  const r = Math.round(x * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

/** `a − b` in degrees as the signed shortest angle, in (−180, 180]. */
export function shortestDegrees(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** A bone's world rotation, `atan2(c, a)`, in degrees. */
export function worldRotation(w: BoneWorld): number {
  return Math.atan2(w.c, w.a) * DEG;
}

function frameText(p: Poses, i: number): string {
  return `frame ${p.indices[i]} (t = ${round6(p.times[i])}s)`;
}

function pointOf(w: BoneWorld, point: BonePoint, length: number): [number, number] {
  return point === 'origin' ? [w.worldX, w.worldY] : [w.worldX + w.a * length, w.worldY + w.c * length];
}

function targetText(t: TargetRef): string {
  return 'bone' in t ? `bone "${t.bone}" ${t.point}` : `stage point ${t.stage[0]},${t.stage[1]}`;
}

/** Where a target is on frame `i`, or the reason it has no point (a tip on a bone of length 0). */
function targetAt(t: TargetRef, p: Poses, facts: RigFacts): ((i: number) => [number, number]) | string {
  if ('stage' in t) {
    const w = stageToWorld(t.stage, facts.stage);
    return () => w;
  }
  const len = facts.lengths.get(t.bone) ?? 0;
  if (t.point === 'tip' && len === 0) return `the target is the tip of bone "${t.bone}", whose length is 0, so it has no tip`;
  const track = p.bone(t.bone);
  return (i) => pointOf(track.frames[i], t.point, len);
}

function notMeasurable(kind: RequirementKind, animation: string, reason: string, figures: Record<string, unknown> = {}): RequirementLine {
  return { kind, animation, status: 'NOT MEASURABLE', reason, ...figures };
}

/** `contact`: the largest distance between the bone's point and the target over the frames, and its frame. */
export function contactLine(r: ContactRequirement, p: Poses, facts: RigFacts): RequirementLine {
  const len = facts.lengths.get(r.bone) ?? 0;
  if (r.point === 'tip' && len === 0) return notMeasurable('contact', r.animation, `bone "${r.bone}" has length 0, so it has no tip`, { length: 0 });
  const at = targetAt(r.target, p, facts);
  if (typeof at === 'string') return notMeasurable('contact', r.animation, at);
  const track = p.bone(r.bone);
  let worst = -1;
  let wi = 0;
  for (let i = 0; i < p.times.length; i++) {
    const a = pointOf(track.frames[i], r.point, len);
    const b = at(i);
    const d = edgeLength(a[0] - b[0], a[1] - b[1]);
    if (d > worst) {
      worst = d;
      wi = i;
    }
  }
  return {
    kind: 'contact',
    animation: r.animation,
    status: worst <= r.within_px ? 'PASS' : 'FAIL',
    of: `bone "${r.bone}" ${r.point}`,
    against: targetText(r.target),
    frames: p.times.length,
    largest_px: round6(worst),
    at: frameText(p, wi),
    within_px: r.within_px,
  };
}

/** `aim`: the angle between the bone's axis and the line from its origin to the target, the largest over the frames that have a line. */
export function aimLine(r: AimRequirement, p: Poses, facts: RigFacts): RequirementLine {
  const len = facts.lengths.get(r.bone) ?? 0;
  if (len === 0) return notMeasurable('aim', r.animation, `bone "${r.bone}" has length 0, so it has no axis to aim`, { length: 0 });
  const at = targetAt(r.target, p, facts);
  if (typeof at === 'string') return notMeasurable('aim', r.animation, at);
  const track = p.bone(r.bone);
  let worst = -1;
  let wi = 0;
  const unmeasured: number[] = [];
  for (let i = 0; i < p.times.length; i++) {
    const w = track.frames[i];
    const b = at(i);
    const lx = b[0] - w.worldX;
    const ly = b[1] - w.worldY;
    if ((lx === 0 && ly === 0) || (w.a === 0 && w.c === 0)) {
      unmeasured.push(p.indices[i]);
      continue;
    }
    const angle = Math.atan2(Math.abs(w.a * ly - w.c * lx), w.a * lx + w.c * ly) * DEG;
    if (angle > worst) {
      worst = angle;
      wi = i;
    }
  }
  if (worst < 0) return notMeasurable('aim', r.animation, `on every one of the ${p.times.length} frame(s) the target sits on the bone's origin (or the bone has no axis), so there is no line to aim along`, { frames: p.times.length });
  return {
    kind: 'aim',
    animation: r.animation,
    status: worst <= r.within_degrees ? 'PASS' : 'FAIL',
    of: `bone "${r.bone}" axis`,
    against: targetText(r.target),
    frames: p.times.length - unmeasured.length,
    frames_not_measurable: unmeasured,
    largest_degrees: round6(worst),
    at: frameText(p, wi),
    within_degrees: r.within_degrees,
  };
}

/** `range`: the bone's rotation relative to its parent (the world, for the root) less the same at the setup pose, signed shortest, the least and the greatest. */
export function rangeLine(r: RangeRequirement, p: Poses, facts: RigFacts): RequirementLine {
  const parent = facts.parents.get(r.bone) ?? null;
  const track = p.bone(r.bone);
  const ptrack = parent === null ? null : p.bone(parent);
  const rel = (w: BoneWorld, pw: BoneWorld | null): number => (pw === null ? worldRotation(w) : shortestDegrees(worldRotation(w), worldRotation(pw)));
  const setup = rel(track.setup, ptrack?.setup ?? null);
  let lo = Infinity;
  let hi = -Infinity;
  let li = 0;
  let hiI = 0;
  for (let i = 0; i < p.times.length; i++) {
    const v = shortestDegrees(rel(track.frames[i], ptrack?.frames[i] ?? null), setup);
    if (v < lo) {
      lo = v;
      li = i;
    }
    if (v > hi) {
      hi = v;
      hiI = i;
    }
  }
  return {
    kind: 'range',
    animation: r.animation,
    status: lo >= r.lo_degrees && hi <= r.hi_degrees ? 'PASS' : 'FAIL',
    of: `bone "${r.bone}" relative to ${parent === null ? 'the world' : `its parent "${parent}"`}, from its setup pose`,
    frames: p.times.length,
    least_degrees: round6(lo),
    least_at: frameText(p, li),
    greatest_degrees: round6(hi),
    greatest_at: frameText(p, hiI),
    range_degrees: [r.lo_degrees, r.hi_degrees],
  };
}

/**
 * `follow`, #87's definition to the letter. `declared`, `released` and `full`
 * are the same frames posed three ways (the rig as written; the constraint's
 * mix for the property forced to 0, its keys removed; forced to 1, keys
 * removed). For `translate` A is the bone's world origin; for `rotate`,
 * `atan2(c, a)` in degrees, every difference a signed shortest angle. Per
 * frame the drive is d = A1 − A0; a frame counts when |d| ≥ `least_drive`;
 * F = Σ⟨A − A0, d⟩ / Σ|d|² over the frames that count; PASS when
 * |F − fraction| ≤ tolerance. The line carries the frames that counted, the
 * largest drive and its frame, the largest residual |A − A0 − F·d| and its
 * frame, and, for rotate, a note when the largest drive exceeds 90°. NOT
 * MEASURABLE when no frame reaches the least drive, printing the largest drive
 * there was.
 */
export function followLine(r: FollowRequirement, declared: Poses, released: Poses, full: Poses): RequirementLine {
  const A = declared.bone(r.bone).frames;
  const A0 = released.bone(r.bone).frames;
  const A1 = full.bone(r.bone).frames;
  const rotate = r.property === 'rotate';
  const diff = (x: BoneWorld, y: BoneWorld): number[] => (rotate ? [shortestDegrees(worldRotation(x), worldRotation(y))] : [x.worldX - y.worldX, x.worldY - y.worldY]);
  const dot = (u: number[], v: number[]): number => u.reduce((s, x, i) => s + x * v[i], 0);
  const n = declared.times.length;
  const drive: number[][] = [];
  const took: number[][] = [];
  let maxDrive = -1;
  let maxDriveAt = 0;
  for (let i = 0; i < n; i++) {
    const d = diff(A1[i], A0[i]);
    drive.push(d);
    took.push(diff(A[i], A0[i]));
    const m = Math.sqrt(dot(d, d));
    if (m > maxDrive) {
      maxDrive = m;
      maxDriveAt = i;
    }
  }
  const counted = drive.map((d, i) => (Math.sqrt(dot(d, d)) >= r.least_drive ? i : -1)).filter((i) => i >= 0);
  const unit = rotate ? 'degrees' : 'px';
  const what = { of: `bone "${r.bone}" ${r.property} under ${r.constraint_type} constraint "${r.constraint}"`, frames: n };
  const driveFig = { [`largest_drive_${unit}`]: round6(maxDrive), largest_drive_at: frameText(declared, maxDriveAt) };
  const note = rotate && maxDrive > 90 ? { note: `the largest drive exceeds 90 degrees: every difference is the signed shortest angle, so a drive beyond 180 degrees is not told from its complement` } : {};
  if (counted.length === 0) {
    return notMeasurable('follow', r.animation, `no frame's drive reaches the least drive ${r.least_drive} ${unit}: the constraint never asks the bone for that much`, { ...what, ...driveFig, [`least_drive_${unit}`]: r.least_drive, ...note });
  }
  let num = 0;
  let den = 0;
  for (const i of counted) {
    num += dot(took[i], drive[i]);
    den += dot(drive[i], drive[i]);
  }
  const F = num / den;
  let maxRes = -1;
  let maxResAt = counted[0];
  for (const i of counted) {
    const e = took[i].map((x, k) => x - F * drive[i][k]);
    const res = Math.sqrt(dot(e, e));
    if (res > maxRes) {
      maxRes = res;
      maxResAt = i;
    }
  }
  return {
    kind: 'follow',
    animation: r.animation,
    status: Math.abs(F - r.fraction) <= r.tolerance ? 'PASS' : 'FAIL',
    ...what,
    frames_counted: counted.length,
    fraction_measured: round6(F),
    fraction: r.fraction,
    tolerance: r.tolerance,
    [`least_drive_${unit}`]: r.least_drive,
    ...driveFig,
    [`largest_residual_${unit}`]: round6(maxRes),
    largest_residual_at: frameText(declared, maxResAt),
    ...note,
  };
}

/**
 * `stretch`: `TEXTURE_STRETCH`'s per-mesh figure for one mesh over the named animation's frames — its worst
 * max(ratio, 1/ratio) and where. With `heldBy`, the line also carries `held_by` (issue #321): what the worst edge's two
 * vertices hang on. `check` passes `edgeBonesText` (`src/check.ts`), the function `CHECK_TEXTURE_STRETCH` names them
 * with since #314, so the two lines cannot drift; it is handed in rather than imported because `src/check.ts` imports
 * this module.
 */
export function stretchRequirementLine(r: StretchRequirement, meshes: readonly MeshRest[], frames: readonly GeometryPose[], p: Poses, heldBy?: (edge: readonly number[]) => string): RequirementLine {
  const mesh = meshes.find((m) => m.slot === r.slot && m.attachment === r.attachment);
  if (mesh === undefined) return notMeasurable('stretch', r.animation, `geometry.json's rest pose holds no mesh "${r.attachment}" on slot "${r.slot}", so no frame shows it`);
  const [m] = stretchFigures([mesh], frames);
  if (m.degenerate.length > 0) {
    return notMeasurable('stretch', r.animation, `${m.degenerate.length} rest edge(s) of length 0, the first triangle ${m.degenerate[0].triangle} edge ${m.degenerate[0].edge.join('-')}: no ratio can be read off an edge with no rest length`, { triangles: m.triangles });
  }
  if (m.max === null || m.min === null) return notMeasurable('stretch', r.animation, `none of the ${p.times.length} frame(s) shows mesh "${r.attachment}" on slot "${r.slot}"`, { triangles: m.triangles });
  const sMax = stretchSeverity(m.max.ratio);
  const sMin = stretchSeverity(m.min.ratio);
  const at = sMin > sMax ? m.min : m.max;
  const severity = Math.max(sMax, sMin);
  const fi = p.indices.indexOf(at.frame);
  return {
    kind: 'stretch',
    animation: r.animation,
    status: severity <= r.within_ratio ? 'PASS' : 'FAIL',
    of: `mesh "${r.attachment}" on slot "${r.slot}"`,
    frames: m.frames,
    triangles: m.triangles,
    severity: round6(severity),
    worst: `triangle ${at.triangle} (vertices ${at.vertices.join(' ')}), edge ${at.edge.join('-')}, ratio ${round6(at.ratio)}`,
    ...(heldBy === undefined ? {} : { held_by: heldBy(at.edge) }),
    at: fi < 0 ? `frame ${at.frame}` : frameText(p, fi),
    max_ratio: round6(m.max.ratio),
    min_ratio: round6(m.min.ratio),
    within_ratio: r.within_ratio,
  };
}

// ---------------------------------------------------------------------------
// the seam between two parts (issue #111)
// ---------------------------------------------------------------------------

/** A part's art on the stage: its box's top-left in stage px and, per pixel of the box, 1 where its alpha is above {@link ART_ALPHA}. */
export interface PlacedArt {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;
}

/** The art of a part image placed at `x, y`: alpha above {@link ART_ALPHA}, the threshold every mesh is built from (`src/mesh.ts`). */
export function placedArt(x: number, y: number, img: Raster): PlacedArt {
  const m = alphaAbove(img, ART_ALPHA);
  return { x, y, width: m.width, height: m.height, data: m.data };
}

function artAt(m: PlacedArt, sx: number, sy: number): boolean {
  const x = sx - m.x;
  const y = sy - m.y;
  return x >= 0 && y >= 0 && x < m.width && y < m.height && m.data[y * m.width + x] === 1;
}

/** One seam pair: `[ax, ay, bx, by]`, stage px — a an art pixel of the part, b of the neighbour. */
export type SeamPair = readonly [number, number, number, number];

/**
 * The seam between `part` and `neighbour` at the setup pose: every pair
 * (a, b) of 4-adjacent stage pixels with a an art pixel of `part` and b an art
 * pixel of `neighbour` that is not an art pixel of `part`. Where the two
 * overlap, the pixels both hold are not a seam: the part covers them. Order:
 * a row-major over the part's box, then right, down, left, up. This is the
 * definition `tools/real_compare.ts` measured #109's seam with (`seamPairs`).
 */
export function seamPairs(part: PlacedArt, neighbour: PlacedArt): SeamPair[] {
  const out: SeamPair[] = [];
  const steps: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  for (let y = 0; y < part.height; y++) {
    for (let x = 0; x < part.width; x++) {
      if (part.data[y * part.width + x] !== 1) continue;
      const ax = part.x + x;
      const ay = part.y + y;
      for (const [dx, dy] of steps) {
        if (artAt(neighbour, ax + dx, ay + dy) && !artAt(part, ax + dx, ay + dy)) out.push([ax, ay, ax + dx, ay + dy]);
      }
    }
  }
  return out;
}

/**
 * The seam pairs of every `seam` requirement, keyed by its name, or one
 * refusal naming every problem, before anything is built. The pairs are read
 * off `parts.json`'s art, so with no `parts.json` there is no seam to read
 * (`REQUIREMENTS_SEAM`, quoting why there is none); a part `parts.json` does not
 * list is unresolved (`REQUIREMENTS_RESOLVES`); and two parts whose art does
 * not meet at the setup pose share no seam (`REQUIREMENTS_SEAM`). `art` is
 * asked only for parts `parts.json` lists.
 */
export function resolveSeams(file: RequirementsFile, partNames: readonly string[] | null, noParts: string | null, art: (part: string) => PlacedArt): Map<string, SeamPair[]> {
  const problems: Problem[] = [];
  const out = new Map<string, SeamPair[]>();
  const cache = new Map<string, PlacedArt>();
  const artOf = (n: string): PlacedArt => {
    const hit = cache.get(n);
    if (hit !== undefined) return hit;
    const a = art(n);
    cache.set(n, a);
    return a;
  };
  for (const r of file.requirements) {
    if (r.kind !== 'seam') continue;
    const object = `requirement "${r.name}" (seam)`;
    if (partNames === null) {
      problems.push({ code: 'REQUIREMENTS_SEAM', object, detail: `a seam's pixels are read off parts.json's art at the setup pose, and none was read: ${noParts ?? 'no parts.json'}` });
      continue;
    }
    const missing = [r.part, r.neighbour].filter((n) => !partNames.includes(n));
    for (const n of missing) problems.push({ code: 'REQUIREMENTS_RESOLVES', object, detail: `names part "${n}", which parts.json does not list; it lists ${partNames.map((x) => `"${x}"`).join(', ') || 'none'}` });
    if (missing.length > 0) continue;
    const pairs = seamPairs(artOf(r.part), artOf(r.neighbour));
    if (pairs.length === 0) {
      problems.push({
        code: 'REQUIREMENTS_SEAM',
        object,
        detail: `no art pixel of "${r.part}" is 4-adjacent to an art pixel of "${r.neighbour}" that is not "${r.part}"'s (alpha above ${ART_ALPHA}, at the setup pose): the two parts share no seam to hold`,
      });
      continue;
    }
    out.set(r.name, pairs);
  }
  refuseIfAny(problems);
  return out;
}

/** One attachment on one frame: its rest vertices (the setup pose's bones, no deform), its posed vertices (world, y up) and its triangles — what `rigc-geometry/1` writes for a region (two triangles) and a mesh alike. */
export interface PosedAttachment {
  rest: readonly number[];
  posed: readonly number[];
  triangles: readonly number[];
}

/**
 * A displacement reader for one attachment: a world point's displacement from
 * rest — the rest triangle holding it (the first in triangle order where two
 * share an edge) and the same barycentric mix of that triangle's posed
 * vertices, less the point — or null when no rest triangle holds it.
 */
export function displacementOf(a: PosedAttachment): (w: readonly [number, number]) => [number, number] | null {
  const cell = 8;
  const buckets = new Map<string, number[]>();
  const X = (i: number): number => a.rest[2 * i];
  const Y = (i: number): number => a.rest[2 * i + 1];
  for (let t = 0; t < a.triangles.length / 3; t++) {
    const ix = [a.triangles[3 * t], a.triangles[3 * t + 1], a.triangles[3 * t + 2]];
    const [i0, i1] = [Math.floor(Math.min(...ix.map(X)) / cell), Math.floor(Math.max(...ix.map(X)) / cell)];
    const [j0, j1] = [Math.floor(Math.min(...ix.map(Y)) / cell), Math.floor(Math.max(...ix.map(Y)) / cell)];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const list = buckets.get(`${i},${j}`);
        if (list === undefined) buckets.set(`${i},${j}`, [t]);
        else list.push(t);
      }
    }
  }
  // (v - u) x (w - u): twice the signed area of u, v, w.
  const cross = (ux: number, uy: number, vx: number, vy: number, wx: number, wy: number): number => (vx - ux) * (wy - uy) - (vy - uy) * (wx - ux);
  return (w) => {
    for (const t of buckets.get(`${Math.floor(w[0] / cell)},${Math.floor(w[1] / cell)}`) ?? []) {
      const [p, q, r] = [a.triangles[3 * t], a.triangles[3 * t + 1], a.triangles[3 * t + 2]];
      const area = cross(X(p), Y(p), X(q), Y(q), X(r), Y(r));
      const lp = cross(X(q), Y(q), X(r), Y(r), w[0], w[1]) / area;
      const lq = cross(X(r), Y(r), X(p), Y(p), w[0], w[1]) / area;
      const lr = cross(X(p), Y(p), X(q), Y(q), w[0], w[1]) / area;
      if (lp >= 0 && lq >= 0 && lr >= 0) {
        const x = lp * a.posed[2 * p] + lq * a.posed[2 * q] + lr * a.posed[2 * r];
        const y = lp * a.posed[2 * p + 1] + lq * a.posed[2 * q + 1] + lr * a.posed[2 * r + 1];
        return [x - w[0], y - w[1]];
      }
    }
    return null;
  };
}

/** One frame of a seam: the attachment the part's slot and the neighbour's slot show on it, or null where the slot shows none. */
export interface SeamFrame {
  part: PosedAttachment | null;
  neighbour: PosedAttachment | null;
}

/**
 * `seam` (issue #111): per frame, each seam pair's opening — the distance
 * between the part's displacement at a's centre and the neighbour's at b's
 * centre ({@link displacementOf}), stage px: how far the two sides of the seam
 * moved apart or across — and the largest over every pair and frame, with its
 * pair and its frame. A pair is not read on a frame where either side's pixel
 * lies outside its attachment's rest geometry or its slot shows nothing
 * (counted, never read as 0); a frame on which no pair reads is not
 * measurable, and with none left the requirement is. The opening is an upper
 * bound on any gap: what shows there depends on what is drawn under the seam.
 * Stage pixel centres go to the world through the stage box and the one y door
 * ({@link stageToWorld}).
 */
export function seamLine(r: SeamRequirement, pairs: readonly SeamPair[], frames: readonly SeamFrame[], p: Poses, stage: { x: number; y: number; height: number }): RequirementLine {
  const wa = pairs.map(([ax, ay]) => stageToWorld([ax + 0.5, ay + 0.5], stage));
  const wb = pairs.map(([, , bx, by]) => stageToWorld([bx + 0.5, by + 0.5], stage));
  let worst = -1;
  let wi = 0;
  let wp = 0;
  let unread = 0;
  const unmeasured: number[] = [];
  for (let i = 0; i < p.times.length; i++) {
    const f = frames[i];
    const dP = f.part === null ? null : displacementOf(f.part);
    const dN = f.neighbour === null ? null : displacementOf(f.neighbour);
    let read = 0;
    for (let k = 0; k < pairs.length; k++) {
      const da = dP === null ? null : dP(wa[k]);
      const db = da === null || dN === null ? null : dN(wb[k]);
      if (da === null || db === null) {
        unread++;
        continue;
      }
      read++;
      const o = edgeLength(da[0] - db[0], da[1] - db[1]);
      if (o > worst) {
        worst = o;
        wi = i;
        wp = k;
      }
    }
    if (read === 0) unmeasured.push(p.indices[i]);
  }
  const of = `the seam between part "${r.part}" and part "${r.neighbour}"`;
  if (worst < 0) {
    return notMeasurable('seam', r.animation, `on every one of the ${p.times.length} frame(s) no seam pair reads: each pair's pixel lies outside its attachment's rest geometry, or its slot shows nothing`, { of, pairs: pairs.length, frames: p.times.length });
  }
  const [ax, ay, bx, by] = pairs[wp];
  return {
    kind: 'seam',
    animation: r.animation,
    status: worst <= r.within_px ? 'PASS' : 'FAIL',
    of,
    pairs: pairs.length,
    frames: p.times.length - unmeasured.length,
    frames_not_measurable: unmeasured,
    pair_frames_unread: unread,
    largest_px: round6(worst),
    at: frameText(p, wi),
    pair: `"${r.part}" pixel ${ax},${ay} against "${r.neighbour}" pixel ${bx},${by}`,
    within_px: r.within_px,
  };
}

/** The bar a line was held to, as its FAIL detail states it. */
function barText(r: Requirement): string {
  if (r.kind === 'contact' || r.kind === 'seam') return `<= ${r.within_px} px is required`;
  if (r.kind === 'aim') return `<= ${r.within_degrees} degrees is required`;
  if (r.kind === 'range') return `[${r.lo_degrees}, ${r.hi_degrees}] degrees is required`;
  if (r.kind === 'stretch') return `<= ${r.within_ratio} is required`;
  return `${r.fraction} ± ${r.tolerance} is required`;
}

/** The figures a FAIL detail quotes, before its bar. */
function failText(r: Requirement, l: RequirementLine): string {
  if (r.kind === 'contact') return `largest distance ${String(l.largest_px)} px at ${String(l.at)}, between ${String(l.of)} and ${String(l.against)}`;
  if (r.kind === 'aim') return `largest angle ${String(l.largest_degrees)} degrees at ${String(l.at)}, between ${String(l.of)} and the line to ${String(l.against)}`;
  if (r.kind === 'range') return `least ${String(l.least_degrees)} degrees at ${String(l.least_at)}, greatest ${String(l.greatest_degrees)} at ${String(l.greatest_at)}`;
  if (r.kind === 'stretch') return `max(ratio, 1/ratio) ${String(l.severity)} at ${String(l.at)}, ${String(l.worst)}${typeof l.held_by === 'string' ? `; ${l.held_by}` : ''}`;
  if (r.kind === 'seam') return `largest opening ${String(l.largest_px)} px at ${String(l.at)}, ${String(l.pair)}`;
  return `measured fraction ${String(l.fraction_measured)} over ${String(l.frames_counted)} frame(s) that reach the least drive`;
}

/** The problem a FAIL or a NOT MEASURABLE line puts in the report; null for PASS. */
export function requirementProblem(r: Requirement, l: RequirementLine): Problem | null {
  const object = `requirement "${r.name}" (${r.kind}, animation "${r.animation}")`;
  if (l.status === 'PASS') return null;
  if (l.status === 'NOT MEASURABLE') return { code: 'CHECK_REQUIREMENT_MEASURABLE', object, detail: `NOT MEASURABLE — ${String(l.reason)}; a declared requirement that was not measured is not green` };
  return { code: 'CHECK_REQUIREMENT_MET', object, detail: `${failText(r, l)}; ${barText(r)}` };
}

/** The summary: how many were declared, measured (PASS, FAIL) and not measurable, and the kinds the file did not declare. */
export interface RequirementsSummary {
  declared: number;
  measured: number;
  pass: number;
  fail: number;
  not_measurable: number;
  not_declared: RequirementKind[];
}

export function requirementsSummary(file: RequirementsFile, lines: ReadonlyMap<string, RequirementLine>): RequirementsSummary {
  const all = [...lines.values()];
  const pass = all.filter((l) => l.status === 'PASS').length;
  const fail = all.filter((l) => l.status === 'FAIL').length;
  const declaredKinds = new Set(file.requirements.map((r) => r.kind));
  return { declared: file.requirements.length, measured: pass + fail, pass, fail, not_measurable: all.length - pass - fail, not_declared: REQUIREMENT_KINDS.filter((k) => !declaredKinds.has(k)) };
}

/** The summary as the console prints it. */
export function summaryText(s: RequirementsSummary): string {
  return `requirements: ${s.declared} declared — ${s.measured} measured (${s.pass} PASS, ${s.fail} FAIL), ${s.not_measurable} NOT MEASURABLE; not declared: ${s.not_declared.length === 0 ? 'none' : s.not_declared.join(', ')}`;
}
