import { regionBone } from './config.ts';
/**
 * A structural comparison of two skeletons (issue #85).
 *
 * `propose --compare` (`compare()` in `src/propose.ts`) is a distance table:
 * per bone two `BoneEntry` lists share by name, the distance between their
 * origins. A changed parent, a changed tip and a renamed bone are invisible
 * to it, by its own definition. This module reads the rest — parents, tips,
 * lengths, directions, required bones and roles — through an explicit bone
 * map, and `rig-parts compare` prints it. `compare()` is not touched.
 *
 * ## The inputs, told apart by what they state
 *
 * - a **rig.json**: an object whose `spec` is `rigc-rig/1`, read by
 *   rig-c's own `parseRigSpec` (its refusal is quoted, not rewritten);
 * - a **config**: an object with a `key`, read by the full config loader;
 * - a **proposal**: an object with `bones` and no `key` or `spec`, as
 *   `propose` writes it, read by `parseProposalSections` (the loader's rules
 *   for bones, meshes, regions and motion, and for the constraints
 *   `propose --cloth` writes).
 *
 * Anything else is refused by name. A file's name is never read.
 *
 * ## One normal form, by stated rules
 *
 * Per bone: its name, its parent, its origin and — where it has one — its
 * tip, in one frame with x right and y down.
 *
 * - From a config or a proposal: the bones as written, in rig px, y down.
 *   A chain `c` is the links `c0 .. cn`; link k's tip is the next point, the
 *   last link's the chain's `tip`. A single bone's tip is its `tip`, when it
 *   states one. `root` is every rig's bone and no config's: it is in the form,
 *   with no position, because a config states none for it.
 * - From a rig.json: each bone's world position through rigc's exact frame
 *   transforms (`src/coords.ts`), and its tip the origin carried `length`
 *   along the bone's own x axis (`toWorld(frame, length, 0)`). A rig that
 *   states a stage (`skeleton.width` and `skeleton.height`, numbers) is brought
 *   into rig px through it: rigc defines the stage as the working area the art
 *   was painted in, with `x`/`y` its bottom-left corner in the world (default
 *   0, rigc's own default), so a world point is the rig pixel
 *   `(wx - stage.x, cropToSpineY(wy - stage.y, stage.height))` — the y flip
 *   through its one door. A rig with no stage stays in its world, y turned
 *   down through the same door at height 0.
 * - A bone whose tip is its origin has no tip: its tip, length and direction
 *   say SKIP with that reason, never 0. A rig bone with `from` takes its
 *   position from a cut manifest, which is not read here: it and everything
 *   under it have no position, said so.
 *
 * ## Frames: stated, never fitted
 *
 * Two sides in rig px are in one frame — unless both state a rig scale and
 * the two differ. A rig with no stage is in a frame nothing here relates to
 * rig px. Where the frames are not related the geometric rows — origin, tip,
 * the length difference, direction — say SKIP "frames not related"; parents,
 * required bones and roles still run. A bone map may declare the frame — a
 * scale and an offset the author wrote, `right = scale * left + offset` in the
 * two normal forms — and then that is the relation. Nothing is fitted.
 *
 * ## Pairing: equal names, or the map, never resemblance
 *
 * With no map a bone pairs with the bone of the same name on the other side.
 * A map (`spine-parts-bonemap/1`) that lists `pairs` is the whole pairing:
 * a bone in no pair is listed as unmapped by name.
 *
 * ## What fails
 *
 * A bone the map's `required` list names that is not present on both sides
 * through the pairing. Every other row is a figure: no bar on a distance, an
 * angle or a role count is set here.
 *
 * Pure but for reading the three files it is handed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { CompileError } from 'rig-c/src/errors.ts';
import { parseRigSpec, RIG_SPEC_VERSION, type RigBone as RigcBone, type RigSpec as RigcSpec, splitRigSkin } from 'rig-c/src/rig.ts';
import { type ConfigConstraint, CONSTRAINT_FOLLOWS, contourRegionsOf, parseConfig, parseProposalSections, type Point, ROOT_BONE, type SkeletonSections, weightsABone } from './config.ts';
import { computeExactFrameTransforms, cropToSpineY, normaliseDegrees, toWorld } from './coords.ts';
import { PartsError, type Problem, refuseIfAny } from './errors.ts';
import { edgeLength } from './length.ts';

// ---------------------------------------------------------------------------
// the normal form
// ---------------------------------------------------------------------------

export type SkeletonForm = 'config' | 'proposal' | 'rig';

/** The frame a side's normal form is in. `rule` says how it was reached, for the printout. */
export type SideFrame = { kind: 'rig-px'; rule: string; rigScale: number | null } | { kind: 'world'; rule: string };

export interface NormalBone {
  name: string;
  parent: string | null;
  /** x right, y down, in the side's frame; null when the file states no position, with why. */
  origin: Point | null;
  originWhy: string | null;
  /** Null when the bone has no tip — none stated, or length 0 — with why. */
  tip: Point | null;
  tipWhy: string | null;
}

export interface Skeleton {
  form: SkeletonForm;
  /** How the printout names the file's content: `config "demo"`, `proposal`, `rig.json "demo_painting"`. */
  label: string;
  frame: SideFrame;
  /** In the file's order, every parent before its children. */
  bones: NormalBone[];
  byName: Map<string, NormalBone>;
  roles: Map<string, RoleOf>;
}

// ---------------------------------------------------------------------------
// roles (exported: issue #86 reads the same derivation)
// ---------------------------------------------------------------------------

/**
 * A bone's role, read off the spec and never off its name.
 *
 * - `target`: a constraint names it as the bone it follows — an ik
 *   constraint's `target`, a transform constraint's `source` (rigc: "4.2
 *   called this target") — in a rig spec's `constraints` or a config's.
 * - `deforms`: something drawn is bound to it — a mesh weight, a mesh segment
 *   (a config's `meshes.<part>.segments`, a chain naming each link), a region
 *   (a config's `regions`, a `motion.blink.still` piece; a rig's region
 *   attachment on a slot), or an unweighted mesh on a slot.
 * - `control`: binds nothing, and is keyed (a config's `motion`) or parents
 *   other bones.
 * - `unclassified`: what the spec does not settle, with why — a bone that
 *   binds nothing, is keyed by nothing and parents nothing; a rig bone that
 *   binds nothing and parents nothing (a rig.json carries no keys); any bone
 *   not otherwise classified in a rig carrying an attachment whose bones are
 *   not read here (a linked mesh, a generator mesh, raw-indexed weights).
 *
 * Precedence is the list's order: a target that is also bound is a target.
 */
export type BoneRole = 'target' | 'deforms' | 'control' | 'unclassified';

export const BONE_ROLES: readonly BoneRole[] = ['target', 'deforms', 'control', 'unclassified'];

export interface RoleOf {
  role: BoneRole;
  /** What in the spec made it so — or, for `unclassified`, what the spec leaves open. */
  why: string;
}

function push(m: Map<string, string[]>, key: string, what: string): void {
  const list = m.get(key);
  if (list === undefined) m.set(key, [what]);
  else if (!list.includes(what)) list.push(what);
}

function firstAnd(list: readonly string[]): string {
  return list.length === 1 ? list[0] : `${list[0]} (+${list.length - 1} more)`;
}

/**
 * The roles of a config's or a proposal's bones, `root` included. A config's
 * `constraints` (issue #92) are read as {@link rigRoles} reads a rig spec's:
 * the bone an ik follows (`target`) or a transform reads (`source`) is a
 * `target`, first in precedence. The loader has resolved every name; a
 * proposal carries no constraints.
 */
export function configRoles(s: SkeletonSections & { constraints?: readonly ConfigConstraint[] }): Map<string, RoleOf> {
  const names: string[] = [ROOT_BONE];
  const chains = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const e of s.bones) {
    if ('chain' in e) {
      const links = e.points.map((_, k) => `${e.chain}${k}`);
      chains.set(e.chain, links);
      links.forEach((l, k) => {
        names.push(l);
        push(children, k === 0 ? e.parent : links[k - 1], l);
      });
    } else {
      names.push(e.name);
      push(children, e.parent, e.name);
    }
  }
  const bound = new Map<string, string[]>();
  for (const [part, m] of Object.entries(s.meshes)) {
    if ('explicit' in m) {
      for (const row of m.explicit.weights) for (const w of row) push(bound, w.bone, `meshes.${part}.explicit.weights`);
      continue;
    }
    m.segments.forEach((sp, i) => {
      const at = `meshes.${part}.segments[${i}]`;
      if (typeof sp === 'string') for (const b of chains.get(sp) ?? [sp]) push(bound, b, at);
      else push(bound, sp[0], at);
    });
    // A contour mesh's region bone is weighted to, like a segment's (issue #84; including contour.bust, issue #475).
    if ('contour' in m) {
      const explicitCount = (m.contour.regions ?? []).length;
      contourRegionsOf(m.contour).forEach((rg, i) => push(bound, rg.bone, i < explicitCount ? `meshes.${part}.contour.regions[${i}]` : `meshes.${part}.contour.bust`));
    }
    if ('auto' in m) (m.auto.regions ?? []).forEach((rg, i) => {
        // A density-only region binds no bone (issue #155).
        if (weightsABone(rg)) push(bound, rg.bone, `meshes.${part}.auto.regions[${i}]`);
      });
  }
  for (const [part, bone] of Object.entries(s.regions)) push(bound, regionBone(bone), `regions.${part}`);
  for (const [part, st] of Object.entries(s.motion.blink?.still ?? {})) push(bound, st.bone, `motion.blink.still.${part}`);
  const keyed = new Map<string, string[]>();
  s.motion.tracks.forEach((t, i) => {
    if ('chain' in t) for (const l of chains.get(t.chain) ?? []) push(keyed, l, `motion.tracks[${i}]`);
    else push(keyed, t.bone, `motion.tracks[${i}]`);
  });
  s.motion.blink?.eyes.forEach((b, i) => push(keyed, b, `motion.blink.eyes[${i}]`));
  s.motion.blink?.brows?.forEach((b, i) => push(keyed, b, `motion.blink.brows[${i}]`));
  const targets = new Map<string, string[]>();
  for (const c of s.constraints ?? []) {
    const field = CONSTRAINT_FOLLOWS[c.type];
    const followed = field === undefined ? undefined : c[field];
    if (typeof followed !== 'string') continue;
    push(targets, followed, field === 'target' ? `the target of ik constraint "${c.name}"` : `the source of transform constraint "${c.name}" (4.2's target)`);
  }
  const out = new Map<string, RoleOf>();
  for (const n of names) {
    const t = targets.get(n);
    const b = bound.get(n);
    const k = keyed.get(n);
    const c = children.get(n);
    if (t !== undefined) out.set(n, { role: 'target', why: firstAnd(t) });
    else if (b !== undefined) out.set(n, { role: 'deforms', why: `bound by ${firstAnd(b)}` });
    else if (k !== undefined) out.set(n, { role: 'control', why: `binds nothing; keyed by ${firstAnd(k)}` });
    else if (c !== undefined) out.set(n, { role: 'control', why: `binds nothing; parents ${firstAnd(c)}` });
    else out.set(n, { role: 'unclassified', why: 'binds nothing, is keyed by nothing and parents nothing' });
  }
  return out;
}

/**
 * The roles of a rig spec's bones. Every name a constraint, a slot or a
 * weight gives is resolved against the bones, and a miss is refused by name
 * (`STRUCTURE_NAME_RESOLVES`) — the one check made here; the rest of the
 * spec's validity is rigc's, at its build.
 */
export function rigRoles(rig: RigcSpec, where = 'rig.json'): Map<string, RoleOf> {
  const problems: Problem[] = [];
  const bones = new Set(rig.bones.map((b) => b.name));
  const resolve = (name: string, object: string): boolean => {
    if (bones.has(name)) return true;
    problems.push({ code: 'STRUCTURE_NAME_RESOLVES', object: `${where} ${object}`, detail: `names the bone "${name}", which the rig's bones do not declare` });
    return false;
  };
  const targets = new Map<string, string[]>();
  for (const c of rig.constraints ?? []) {
    if (c.type === 'ik' && resolve(c.target, `ik constraint "${c.name}".target`)) push(targets, c.target, `the target of ik constraint "${c.name}"`);
    if (c.type === 'transform' && resolve(c.source, `transform constraint "${c.name}".source`)) push(targets, c.source, `the source of transform constraint "${c.name}" (4.2's target)`);
  }
  const slotBone = new Map(rig.slots.map((s) => [s.name, s.bone]));
  const bound = new Map<string, string[]>();
  const unread: string[] = [];
  for (const [skin, entry] of Object.entries(rig.skins ?? {})) {
    for (const [slot, atts] of Object.entries(splitRigSkin(entry, `${where} skin "${skin}"`).attachments)) {
      const bone = slotBone.get(slot);
      if (bone === undefined) {
        problems.push({ code: 'STRUCTURE_NAME_RESOLVES', object: `${where} skin "${skin}" slot "${slot}"`, detail: `names the slot "${slot}", which the rig's slots do not declare` });
        continue;
      }
      for (const [name, att] of Object.entries(atts)) {
        const at = `skin "${skin}" slot "${slot}" attachment "${name}"`;
        if (att.type === undefined || att.type === 'region') push(bound, bone, `the region ${at}`);
        else if (att.type === 'mesh') {
          if (att.weights !== undefined) {
            att.weights.forEach((v, i) => v.forEach((w, j) => {
              if (resolve(w.bone, `${at}.weights[${i}][${j}].bone`)) push(bound, w.bone, `the weights of mesh ${at}`);
            }));
          } else if (att.generator !== undefined) unread.push(`the generator mesh ${at}`);
          else if (att.boneIndexing === 'raw') unread.push(`the raw-indexed mesh ${at}`);
          else push(bound, bone, `the unweighted mesh ${at}`);
        } else if (att.type === 'linkedmesh') unread.push(`the linked mesh ${at}`);
      }
    }
  }
  refuseIfAny(problems);
  const children = new Map<string, string[]>();
  for (const b of rig.bones) if (b.parent !== undefined) push(children, b.parent, b.name);
  const out = new Map<string, RoleOf>();
  for (const b of rig.bones) {
    const n = b.name;
    const t = targets.get(n);
    const d = bound.get(n);
    const c = children.get(n);
    if (t !== undefined) out.set(n, { role: 'target', why: firstAnd(t) });
    else if (d !== undefined) out.set(n, { role: 'deforms', why: `bound by ${firstAnd(d)}` });
    else if (unread.length > 0) out.set(n, { role: 'unclassified', why: `binds nothing read here, and the rig carries ${firstAnd(unread)}, whose bones are not read` });
    else if (c !== undefined) out.set(n, { role: 'control', why: `binds nothing; parents ${firstAnd(c)}` });
    else out.set(n, { role: 'unclassified', why: 'binds nothing and parents nothing; a rig.json carries no keys (they are in its motion spec), so whether it is keyed is not read' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// reading a skeleton
// ---------------------------------------------------------------------------

function same(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function configSkeleton(s: SkeletonSections & { constraints?: readonly ConfigConstraint[] }, form: 'config' | 'proposal', label: string, rigScale: number | null): Skeleton {
  const bones: NormalBone[] = [
    {
      name: ROOT_BONE,
      parent: null,
      origin: null,
      originWhy: `the ${form} states no position for "${ROOT_BONE}" (the rig stage stands it at the bottom centre of the parts' canvas, whose size the ${form} does not state)`,
      tip: null,
      tipWhy: `the ${form} states no position for "${ROOT_BONE}"`,
    },
  ];
  const add = (name: string, parent: string, origin: Point, tip: Point | undefined, none: string): void => {
    const o: Point = [origin[0], origin[1]];
    if (tip === undefined) bones.push({ name, parent, origin: o, originWhy: null, tip: null, tipWhy: none });
    else if (same(origin, tip)) bones.push({ name, parent, origin: o, originWhy: null, tip: null, tipWhy: `its tip is its origin, [${tip[0]}, ${tip[1]}]: length 0` });
    else bones.push({ name, parent, origin: o, originWhy: null, tip: [tip[0], tip[1]], tipWhy: null });
  };
  for (const e of s.bones) {
    if ('chain' in e) e.points.forEach((q, k) => add(`${e.chain}${k}`, k === 0 ? e.parent : `${e.chain}${k - 1}`, q, k + 1 < e.points.length ? e.points[k + 1] : e.tip, ''));
    else add(e.name, e.parent, e.at, e.tip, 'states no tip');
  }
  const rule = form === 'config' ? `rig px, y down, as the config writes them${rigScale === null ? '' : ` (rig_scale ${rigScale})`}` : 'rig px, y down, as the proposal writes them (a proposal states no rig_scale)';
  return { form, label, frame: { kind: 'rig-px', rule, rigScale }, bones, byName: new Map(bones.map((b) => [b.name, b])), roles: configRoles(s) };
}

interface Stage {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rigSkeleton(rig: RigcSpec, where: string): Skeleton {
  const roles = rigRoles(rig, where);
  const h = rig.skeleton;
  const stage: Stage | null = typeof h?.width === 'number' && typeof h.height === 'number' ? { x: h.x ?? 0, y: h.y ?? 0, width: h.width, height: h.height } : null;
  const frame: SideFrame =
    stage === null
      ? {
          kind: 'world',
          rule:
            h?.width === null
              ? 'its world, y turned down: the rig declares no stage (skeleton width and height null), so nothing relates it to rig px'
              : 'its world, y turned down: the rig states no stage (no skeleton.width and skeleton.height; rigc would take one from a cut manifest, which is not read here), so nothing relates it to rig px',
        }
      : {
          kind: 'rig-px',
          rule: `rig px, y down, through the stage (skeleton x ${stage.x}, y ${stage.y}, ${stage.width}x${stage.height}): x - (${stage.x}), cropToSpineY(y - (${stage.y}), ${stage.height})`,
          rigScale: null,
        };
  const toNormal = (wx: number, wy: number): Point => (stage === null ? [wx, cropToSpineY(wy, 0)] : [wx - stage.x, cropToSpineY(wy - stage.y, stage.height)]);
  const world = computeExactFrameTransforms(rig.bones);
  const unstated = new Map<string, string>();
  const bones: NormalBone[] = rig.bones.map((b: RigcBone) => {
    const parent = b.parent ?? null;
    const above = parent === null ? undefined : unstated.get(parent);
    const why = b.from !== undefined ? 'takes its position from a cut manifest (bone.from), which is not read here' : above !== undefined ? `sits under "${parent}", whose position is not stated here` : undefined;
    if (why !== undefined) {
      unstated.set(b.name, why);
      return { name: b.name, parent, origin: null, originWhy: why, tip: null, tipWhy: why };
    }
    const m = world.get(b.name);
    if (m === undefined) throw new Error(`structure: rigc's frame transforms hold no "${b.name}"`);
    const origin = toNormal(m.worldX, m.worldY);
    const length = b.length ?? 0;
    if (length === 0) {
      return { name: b.name, parent, origin, originWhy: null, tip: null, tipWhy: b.length === undefined ? 'states no length (rigc\'s default, 0)' : 'length 0' };
    }
    const [tx, ty] = toWorld(m, length, 0);
    const tip = toNormal(tx, ty);
    if (same(origin, tip)) return { name: b.name, parent, origin, originWhy: null, tip: null, tipWhy: `length ${length} carries its tip nowhere in the world (its frame is scaled to 0)` };
    return { name: b.name, parent, origin, originWhy: null, tip, tipWhy: null };
  });
  return { form: 'rig', label: `rig.json "${rig.name}"`, frame, bones, byName: new Map(bones.map((b) => [b.name, b])), roles };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * A parsed file as a skeleton, told apart by what it states (see the module
 * comment). `where` names the file in a refusal. Throws one `PartsError`
 * with every problem.
 */
export function readSkeleton(raw: unknown, where: string): Skeleton {
  if (!isObject(raw)) {
    throw new PartsError([{ code: 'STRUCTURE_FORM', object: where, detail: `is ${Array.isArray(raw) ? 'an array' : JSON.stringify(raw)}; a rig.json, a config or a proposal (a JSON object) is required` }]);
  }
  if ('spec' in raw) {
    if (raw.spec !== RIG_SPEC_VERSION) {
      throw new PartsError([{ code: 'STRUCTURE_FORM', object: `${where} spec`, detail: `is ${JSON.stringify(raw.spec)}; a skeleton file that states a spec is a rig.json, "${RIG_SPEC_VERSION}" (a config or a proposal states none)` }]);
    }
    let rig: RigcSpec;
    try {
      rig = parseRigSpec(raw, where);
    } catch (err) {
      if (err instanceof CompileError) throw new PartsError([{ code: 'STRUCTURE_RIG_SPEC', object: where, detail: `rig-c's rig spec reader refuses it: ${err.message}` }]);
      throw err;
    }
    return rigSkeleton(rig, where);
  }
  if ('key' in raw) {
    try {
      const cfg = parseConfig(raw);
      return configSkeleton(cfg, 'config', `config "${cfg.key}"`, cfg.assemble.rig_scale);
    } catch (err) {
      if (err instanceof PartsError) throw new PartsError(err.problems.map((p) => ({ ...p, object: `${where} ${p.object}` })));
      throw err;
    }
  }
  if ('bones' in raw) {
    try {
      return configSkeleton(parseProposalSections(raw), 'proposal', 'proposal', null);
    } catch (err) {
      if (err instanceof PartsError) throw new PartsError(err.problems.map((p) => ({ ...p, object: `${where} ${p.object}` })));
      throw err;
    }
  }
  throw new PartsError([
    { code: 'STRUCTURE_FORM', object: where, detail: `states none of "spec" (a rig.json), "key" (a config) or "bones" (a proposal); its keys are ${JSON.stringify(Object.keys(raw))}` },
  ]);
}

// ---------------------------------------------------------------------------
// the bone map
// ---------------------------------------------------------------------------

export const BONEMAP_SPEC = 'spine-parts-bonemap/1';

const BONEMAP_KEYS = ['spec', 'pairs', 'required', 'frame', 'note'] as const;

/** A frame the map's author declared: a left point lands at `scale * p + offset` in the right's normal form. */
export interface DeclaredFrame {
  scale: number;
  offset: Point;
}

export interface BoneMap {
  /** Null: no `pairs`, so bones pair by equal name. */
  pairs: Array<[string, string]> | null;
  /** Left names that must be present on both sides through the pairing. */
  required: string[];
  frame: DeclaredFrame | null;
}

/**
 * The map file. Every problem is collected and thrown once. Each pair's left
 * name must be a left bone and its right name a right bone (a name on the
 * other side only is named as such); each name pairs once. `required` names
 * left bones — one that is absent is the comparison's FAIL, not the map's
 * refusal. With a side that did not read (`null`), its names are not
 * resolved; the shape is still checked.
 */
export function parseBoneMap(raw: unknown, where: string, left: Skeleton | null, right: Skeleton | null): BoneMap {
  const problems: Problem[] = [];
  const fail = (object: string, detail: string, code = 'STRUCTURE_MAP_FIELD'): void => {
    problems.push({ code, object: `${where} ${object}`, detail });
  };
  if (!isObject(raw)) {
    fail('', `is ${JSON.stringify(raw)}; a JSON object with "spec": "${BONEMAP_SPEC}" is required`);
    throw new PartsError(problems);
  }
  for (const k of Object.keys(raw)) {
    if (!(BONEMAP_KEYS as readonly string[]).includes(k)) fail(k, `is not a field of a bone map; known: ${BONEMAP_KEYS.join(', ')}`, 'STRUCTURE_MAP_KEY_KNOWN');
  }
  if (raw.spec !== BONEMAP_SPEC) fail('spec', `is ${raw.spec === undefined ? 'absent' : JSON.stringify(raw.spec)}; "${BONEMAP_SPEC}" is required`);
  if ('note' in raw && typeof raw.note !== 'string') fail('note', `is ${JSON.stringify(raw.note)}; a string is required`);
  let pairs: Array<[string, string]> | null = null;
  if ('pairs' in raw) {
    if (!Array.isArray(raw.pairs)) fail('pairs', `is ${JSON.stringify(raw.pairs)}; an array of [left name, right name] is required`);
    else {
      pairs = [];
      const seen: [Map<string, number>, Map<string, number>] = [new Map(), new Map()];
      (raw.pairs as unknown[]).forEach((p, i) => {
        if (!(Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string')) {
          fail(`pairs[${i}]`, `is ${JSON.stringify(p)}; [left name, right name], two strings, is required`);
          return;
        }
        const pair: [string, string] = [p[0], p[1]];
        ([0, 1] as const).forEach((s) => {
          const side = s === 0 ? 'left' : 'right';
          const own = s === 0 ? left : right;
          const other = s === 0 ? right : left;
          const name = pair[s];
          if (own !== null && !own.byName.has(name)) {
            const there = other !== null && other.byName.has(name) ? `; it is a bone of the ${s === 0 ? 'right' : 'left'} side, and a pair is [left, right]` : '; it is not a bone of either side';
            fail(`pairs[${i}][${s}]`, `names "${name}", which is not a bone of the ${side} skeleton (${own.label})${there}`, 'STRUCTURE_MAP_RESOLVES');
          }
          const first = seen[s].get(name);
          if (first !== undefined) fail(`pairs[${i}][${s}]`, `names the ${side} bone "${name}", which pairs[${first}] already pairs; each bone pairs once`, 'STRUCTURE_MAP_ONE_TO_ONE');
          else seen[s].set(name, i);
        });
        pairs?.push(pair);
      });
    }
  }
  const required: string[] = [];
  if ('required' in raw) {
    if (!Array.isArray(raw.required)) fail('required', `is ${JSON.stringify(raw.required)}; an array of left bone names is required`);
    else {
      (raw.required as unknown[]).forEach((n, i) => {
        if (typeof n !== 'string' || n === '') fail(`required[${i}]`, `is ${JSON.stringify(n)}; a bone name is required`);
        else if (required.includes(n)) fail(`required[${i}]`, `names "${n}" a second time`);
        else required.push(n);
      });
    }
  }
  let frame: DeclaredFrame | null = null;
  if ('frame' in raw) {
    const f = raw.frame;
    if (!isObject(f)) fail('frame', `is ${JSON.stringify(f)}; {"scale": <number above 0>, "offset": [x, y]} is required`);
    else {
      for (const k of Object.keys(f)) if (k !== 'scale' && k !== 'offset') fail(`frame.${k}`, 'is not a field of a declared frame; known: scale, offset', 'STRUCTURE_MAP_KEY_KNOWN');
      const scaleOk = typeof f.scale === 'number' && Number.isFinite(f.scale) && f.scale > 0;
      if (!scaleOk) fail('frame.scale', `is ${f.scale === undefined ? 'absent' : JSON.stringify(f.scale)}; a number above 0, written by the map's author, is required — none is assumed`);
      const o = f.offset;
      const offsetOk = Array.isArray(o) && o.length === 2 && o.every((v) => typeof v === 'number' && Number.isFinite(v));
      if (!offsetOk) fail('frame.offset', `is ${o === undefined ? 'absent' : JSON.stringify(o)}; [x, y], two numbers written by the map's author, is required — none is assumed`);
      if (scaleOk && offsetOk) frame = { scale: f.scale as number, offset: [(o as number[])[0], (o as number[])[1]] };
    }
  }
  refuseIfAny(problems);
  return { pairs, required, frame };
}

// ---------------------------------------------------------------------------
// the comparison
// ---------------------------------------------------------------------------

export type FrameRelation = { kind: 'shared'; why: string } | { kind: 'declared'; scale: number; offset: Point; why: string } | { kind: 'none'; why: string };

export const FRAMES_NOT_RELATED = 'frames not related';

/** How two sides' frames are related: by the map's declaration, by both being rig px, or not at all. */
export function relateFrames(left: Skeleton, right: Skeleton, declared: DeclaredFrame | null): FrameRelation {
  if (declared !== null) {
    return { kind: 'declared', scale: declared.scale, offset: declared.offset, why: `declared by the map: right = ${declared.scale} * left + [${declared.offset[0]}, ${declared.offset[1]}]` };
  }
  const l = left.frame;
  const r = right.frame;
  if (l.kind === 'rig-px' && r.kind === 'rig-px') {
    if (l.rigScale !== null && r.rigScale !== null && l.rigScale !== r.rigScale) {
      return { kind: 'none', why: `${FRAMES_NOT_RELATED}: both are rig px, at rig_scale ${l.rigScale} and ${r.rigScale}, so their pixels are not one size, and the map declares no frame` };
    }
    return { kind: 'shared', why: 'related: both are rig px, y down' };
  }
  const which = l.kind === 'world' && r.kind === 'world' ? 'both sides are each in their own world' : `the ${l.kind === 'world' ? 'left' : 'right'} side is in its world, the other in rig px`;
  return { kind: 'none', why: `${FRAMES_NOT_RELATED}: ${which}, no rule the files state relates them, and the map declares no frame` };
}

/** A figure, or SKIP with why. */
export type Figure = { value: number } | { skip: string };

export type ParentVerdict =
  | { kind: 'roots' }
  | { kind: 'same'; left: string; right: string }
  /** The left parent pairs with the right bone's ancestor at `depth` (2 = grandparent); `between` are right bones in no pair. */
  | { kind: 'inserted-right'; left: string; right: string; depth: number; between: string[] }
  /** The right parent pairs with the left bone's ancestor at `depth`; `between` are left bones in no pair. */
  | { kind: 'inserted-left'; left: string; right: string; depth: number; between: string[] }
  /** `mapped` is the left parent through the pairing (null when it pairs with nothing); `right` the right parent. */
  | { kind: 'different'; left: string | null; mapped: string | null; right: string | null }
  | { kind: 'not-mapped'; left: string };

export interface PairRow {
  left: string;
  right: string;
  origin: Figure;
  parent: ParentVerdict;
  tip: Figure;
  /** Each side's length in its own units (null with no tip), and right minus left through the frame. */
  length: { left: number | null; right: number | null; difference: Figure };
  /** Right's direction minus left's, degrees in (-180, 180], positive clockwise as drawn (y down). */
  direction: Figure;
}

export interface RequiredMiss {
  bone: string;
  why: string;
}

export interface StructureComparison {
  left: Skeleton;
  right: Skeleton;
  relation: FrameRelation;
  pairing: 'name' | 'map';
  rows: PairRow[];
  unmappedLeft: string[];
  unmappedRight: string[];
  required: string[];
  missing: RequiredMiss[];
}

function sideReasons(l: string | null, r: string | null): string | null {
  const parts = [l === null ? null : `left: ${l}`, r === null ? null : `right: ${r}`].filter((s): s is string => s !== null);
  return parts.length === 0 ? null : parts.join('; ');
}

function parentVerdict(l: NormalBone, r: NormalBone, left: Skeleton, right: Skeleton, fwd: Map<string, string>, inv: Map<string, string>): ParentVerdict {
  const lp = l.parent;
  const rp = r.parent;
  if (lp === null && rp === null) return { kind: 'roots' };
  if (lp === null || rp === null) return { kind: 'different', left: lp, mapped: lp === null ? null : (fwd.get(lp) ?? null), right: rp };
  const m = fwd.get(lp);
  if (m === rp) return { kind: 'same', left: lp, right: rp };
  // A bone inserted between, on either side: walk up from the parent over
  // bones in no pair; the first paired ancestor must be the other's parent.
  const insertedUnder = (start: string, side: Skeleton, paired: Map<string, string>, want: string): { depth: number; between: string[] } | null => {
    const between: string[] = [];
    let at: string | null = start;
    while (at !== null && !paired.has(at)) {
      between.push(at);
      at = side.byName.get(at)?.parent ?? null;
    }
    return at === want && between.length > 0 ? { depth: between.length + 1, between } : null;
  };
  if (m !== undefined) {
    const ins = insertedUnder(rp, right, inv, m);
    if (ins !== null) return { kind: 'inserted-right', left: lp, right: m, ...ins };
  }
  const mi = inv.get(rp);
  if (mi !== undefined) {
    const ins = insertedUnder(lp, left, fwd, mi);
    if (ins !== null) return { kind: 'inserted-left', left: mi, right: rp, ...ins };
  }
  if (m === undefined) return { kind: 'not-mapped', left: lp };
  return { kind: 'different', left: lp, mapped: m, right: rp };
}

function direction(o: Point, t: Point): number {
  return (Math.atan2(t[1] - o[1], t[0] - o[0]) * 180) / Math.PI;
}

function pairRow(l: NormalBone, r: NormalBone, left: Skeleton, right: Skeleton, rel: FrameRelation, fwd: Map<string, string>, inv: Map<string, string>): PairRow {
  const scale = rel.kind === 'declared' ? rel.scale : 1;
  const offset: Point = rel.kind === 'declared' ? rel.offset : [0, 0];
  const carry = (p: Point): Point => [scale * p[0] + offset[0], scale * p[1] + offset[1]];
  const geometric = (lw: string | null, rw: string | null): string | null => {
    const sides = sideReasons(lw, rw);
    if (rel.kind === 'none') return sides === null ? FRAMES_NOT_RELATED : `${FRAMES_NOT_RELATED}; ${sides}`;
    return sides;
  };
  const originWhy = geometric(l.originWhy, r.originWhy);
  const origin: Figure = originWhy !== null || l.origin === null || r.origin === null ? { skip: originWhy ?? '' } : { value: edgeLength(carry(l.origin)[0] - r.origin[0], carry(l.origin)[1] - r.origin[1]) };
  const tipWhy = geometric(l.tipWhy, r.tipWhy);
  const lo = l.origin;
  const ro = r.origin;
  const lt = l.tip;
  const rt = r.tip;
  const both = lo !== null && ro !== null && lt !== null && rt !== null;
  const tip: Figure = tipWhy !== null || !both ? { skip: tipWhy ?? '' } : { value: edgeLength(carry(lt)[0] - rt[0], carry(lt)[1] - rt[1]) };
  const ll = lo !== null && lt !== null ? edgeLength(lt[0] - lo[0], lt[1] - lo[1]) : null;
  const rl = ro !== null && rt !== null ? edgeLength(rt[0] - ro[0], rt[1] - ro[1]) : null;
  const difference: Figure = tipWhy !== null || ll === null || rl === null ? { skip: tipWhy ?? '' } : { value: rl - scale * ll };
  const dir: Figure = tipWhy !== null || !both ? { skip: tipWhy ?? '' } : { value: normaliseDegrees(direction(ro, rt) - direction(lo, lt)) };
  return { left: l.name, right: r.name, origin, parent: parentVerdict(l, r, left, right, fwd, inv), tip, length: { left: ll, right: rl, difference }, direction: dir };
}

/** The comparison of two skeletons through a map (or equal names), every row a figure or a SKIP with why. */
export function compareStructure(left: Skeleton, right: Skeleton, map: BoneMap | null): StructureComparison {
  const relation = relateFrames(left, right, map?.frame ?? null);
  const pairs: Array<[string, string]> = map?.pairs ?? left.bones.filter((b) => right.byName.has(b.name)).map((b): [string, string] => [b.name, b.name]);
  const fwd = new Map(pairs);
  const inv = new Map(pairs.map(([a, b]) => [b, a]));
  // Rows in the left file's order, so a reader walks the left skeleton top down.
  const rows = left.bones
    .filter((b) => fwd.has(b.name))
    .map((b) => pairRow(b, right.byName.get(fwd.get(b.name) as string) as NormalBone, left, right, relation, fwd, inv));
  const required = map?.required ?? [];
  const missing: RequiredMiss[] = [];
  for (const n of required) {
    if (!left.byName.has(n)) missing.push({ bone: n, why: `is not a bone of the left skeleton (${left.label})` });
    else if (!fwd.has(n)) missing.push({ bone: n, why: map === null || map.pairs === null ?`is not a bone of the right skeleton (${right.label}), and with no pairs in the map only an equal name pairs` : 'is a bone of the left skeleton, and the map pairs it with nothing' });
    else if (!right.byName.has(fwd.get(n) as string)) missing.push({ bone: n, why: `pairs with "${fwd.get(n)}", which is not a bone of the right skeleton (${right.label})` });
  }
  return {
    left,
    right,
    relation,
    pairing: map === null || map.pairs === null ? 'name' : 'map',
    rows,
    unmappedLeft: left.bones.filter((b) => !fwd.has(b.name)).map((b) => b.name),
    unmappedRight: right.bones.filter((b) => !inv.has(b.name)).map((b) => b.name),
    required,
    missing,
  };
}

/** The roles a skeleton carries, counted, in `BONE_ROLES` order. */
export function roleCounts(s: Skeleton): Record<BoneRole, number> {
  const out: Record<BoneRole, number> = { target: 0, deforms: 0, control: 0, unclassified: 0 };
  for (const r of s.roles.values()) out[r.role]++;
  return out;
}

// ---------------------------------------------------------------------------
// the printout
// ---------------------------------------------------------------------------

/** Three places; a figure, not a rounding of a bar — every figure is printed and none is judged. */
function f3(v: number): string {
  return v.toFixed(3);
}

function signed(v: number): string {
  const s = v.toFixed(3);
  return s.startsWith('-') ? s : `+${s}`;
}

function figure(f: Figure, unit: string, sign = false): string {
  return 'value' in f ? `${sign ? signed(f.value) : f3(f.value)} ${unit}` : `SKIP (${f.skip})`;
}

function parentText(p: ParentVerdict): string {
  switch (p.kind) {
    case 'roots':
      return 'parent: both roots';
    case 'same':
      return p.left === p.right ? `parent same: ${p.left}` : `parent same: ${p.left} -> ${p.right}`;
    case 'inserted-right':
      return `parent ${p.left}${p.left === p.right ? '' : ` -> ${p.right}`} is the right's ancestor at depth ${p.depth}, ${p.between.join(', ')} between (in no pair)`;
    case 'inserted-left':
      return `parent ${p.right}${p.left === p.right ? '' : ` (left ${p.left})`} is the left's ancestor at depth ${p.depth}, ${p.between.join(', ')} between (in no pair)`;
    case 'different':
      return `parent DIFFERENT: left ${p.left ?? '(none: a root)'}${p.left !== null && p.mapped !== null && p.mapped !== p.left ? ` -> ${p.mapped}` : ''}, right ${p.right ?? '(none: a root)'}`;
    case 'not-mapped':
      return `parent NOT MAPPED: the left parent ${p.left} is in no pair`;
  }
}

function rowLine(r: PairRow): string {
  const name = r.left === r.right ? r.left : `${r.left} -> ${r.right}`;
  const cells = [`origin ${figure(r.origin, 'px')}`, parentText(r.parent)];
  const tipSkip = 'skip' in r.tip && 'skip' in r.direction && 'skip' in r.length.difference && r.length.left === null && r.length.right === null;
  if (tipSkip && 'skip' in r.tip) cells.push(`tip, length, direction SKIP (${r.tip.skip})`);
  else {
    cells.push(`tip ${figure(r.tip, 'px')}`);
    const ll = r.length.left === null ? '-' : f3(r.length.left);
    const rl = r.length.right === null ? '-' : f3(r.length.right);
    cells.push(`length ${ll} -> ${rl}, difference ${figure(r.length.difference, 'px', true)}`);
    cells.push(`direction ${figure(r.direction, 'deg', true)}`);
  }
  return `  ${name}: ${cells.join(' · ')}`;
}

function summary(label: string, rows: PairRow[], pick: (r: PairRow) => Figure, unit: string, abs: boolean): string {
  let n = 0;
  let skip = 0;
  let max = -1;
  let at = '';
  for (const r of rows) {
    const f = pick(r);
    if ('skip' in f) {
      skip++;
      continue;
    }
    n++;
    const v = abs ? Math.abs(f.value) : f.value;
    if (v > max) {
      max = v;
      at = r.left === r.right ? r.left : `${r.left} -> ${r.right}`;
    }
  }
  return `  ${label}: ${n} measured${n > 0 ? `, max ${abs ? '|difference| ' : ''}${f3(max)} ${unit} (${at})` : ''}, ${skip} SKIP`;
}

function roleLine(side: 'left' | 'right', s: Skeleton): string[] {
  const c = roleCounts(s);
  const out = [`  roles, ${side} (${s.label}): ${BONE_ROLES.map((r) => `${c[r]} ${r}`).join(', ')}`];
  for (const [n, r] of s.roles) if (r.role === 'unclassified') out.push(`    unclassified ${n}: ${r.why}`);
  return out;
}

/** The comparison as printed lines; the CLI adds the FAIL lines for missing required bones. */
export function structureLines(c: StructureComparison): string[] {
  const out: string[] = [];
  out.push(`  left: ${c.left.label}, ${c.left.bones.length} bone(s); ${c.left.frame.rule}`);
  out.push(`  right: ${c.right.label}, ${c.right.bones.length} bone(s); ${c.right.frame.rule}`);
  out.push(`  frames: ${c.relation.why}${c.relation.kind === 'none' ? '; origin, tip, the length difference and direction say SKIP, and parents, required bones and roles still run' : ''}`);
  out.push(c.pairing === 'name' ? `  pairing: by equal name, ${c.rows.length} pair(s); nothing pairs by resemblance` : `  pairing: by the map's pairs only, ${c.rows.length} pair(s); a bone in no pair is listed below`);
  for (const r of c.rows) out.push(rowLine(r));
  out.push(summary('origin', c.rows, (r) => r.origin, 'px', false));
  const k = (kind: ParentVerdict['kind']): number => c.rows.filter((r) => r.parent.kind === kind).length;
  out.push(
    `  parent: ${k('same')} same, ${k('inserted-right') + k('inserted-left')} with a bone between (in no pair), ${k('different')} DIFFERENT, ${k('not-mapped')} NOT MAPPED, ${k('roots')} both roots`,
  );
  out.push(summary('tip', c.rows, (r) => r.tip, 'px', false));
  out.push(summary('length', c.rows, (r) => r.length.difference, 'px', true));
  out.push(summary('direction', c.rows, (r) => r.direction, 'deg', true));
  out.push(`  unmapped on the left (${c.unmappedLeft.length}): ${c.unmappedLeft.join(', ') || '-'}`);
  out.push(`  unmapped on the right (${c.unmappedRight.length}): ${c.unmappedRight.join(', ') || '-'}`);
  out.push(
    c.required.length === 0
      ? '  required: none named (a map\'s "required" lists them)'
      : c.missing.length === 0
        ? `  required: ${c.required.length} named, every one present on both sides through the pairing`
        : `  required: ${c.required.length} named, ${c.missing.length} missing (FAIL lines below)`,
  );
  out.push(...roleLine('left', c.left), ...roleLine('right', c.right));
  const lc = roleCounts(c.left);
  const rc = roleCounts(c.right);
  const differ = lc.control !== rc.control || lc.target !== rc.target;
  out.push(`  controls: left ${lc.control}, right ${rc.control}; targets: left ${lc.target}, right ${rc.target} — ${differ ? 'the counts differ; reported, not failed' : 'the counts agree'}`);
  return out;
}

/** The FAIL problems of a comparison: one per required bone missing. */
export function requiredProblems(c: StructureComparison, mapWhere: string): Problem[] {
  return c.missing.map((m) => ({ code: 'STRUCTURE_REQUIRED_PRESENT', object: `bone "${m.bone}"`, detail: `is required by ${mapWhere}, and ${m.why}; it must be present on both sides through the pairing` }));
}

// ---------------------------------------------------------------------------
// the files
// ---------------------------------------------------------------------------

function readJson(path: string, problems: Problem[]): unknown {
  if (!existsSync(path)) {
    problems.push({ code: 'STRUCTURE_FILE_PRESENT', object: path, detail: 'no such file' });
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    problems.push({ code: 'STRUCTURE_FILE_IS_JSON', object: path, detail: `does not parse as JSON: ${(err as Error).message}` });
    return undefined;
  }
}

/**
 * Read the two skeletons and the map, collecting every problem across the
 * three files, and compare. Throws one `PartsError` naming them all.
 */
export function loadComparison(leftPath: string, rightPath: string, mapPath: string | null): StructureComparison {
  const problems: Problem[] = [];
  const side = (path: string): Skeleton | null => {
    const before = problems.length;
    const raw = readJson(path, problems);
    if (problems.length > before) return null;
    try {
      return readSkeleton(raw, path);
    } catch (err) {
      if (err instanceof PartsError) {
        problems.push(...err.problems);
        return null;
      }
      throw err;
    }
  };
  const left = side(leftPath);
  const right = side(rightPath);
  let map: BoneMap | null = null;
  if (mapPath !== null) {
    const before = problems.length;
    const raw = readJson(mapPath, problems);
    if (problems.length === before) {
      try {
        map = parseBoneMap(raw, mapPath, left, right);
      } catch (err) {
        if (err instanceof PartsError) problems.push(...err.problems);
        else throw err;
      }
    }
  }
  refuseIfAny(problems);
  return compareStructure(left as Skeleton, right as Skeleton, map);
}
