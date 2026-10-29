/**
 * The skinning envelope of an automatic part (issue #126 Q3–Q5, rig-c 2.31.0
 * `targets.skinning`, rigc#1294/#1295): what rig-c's `MQ_SKINNING_RESIDUAL`
 * reads, and, when the author sets `meshes.<part>.auto.motion.residual`, what
 * every removal, boundary run and post-pass of `reduceMesh` is held to. Its
 * own module rather than inside `src/autoamplitude.ts`: the amplitude is a
 * pair-wise θ per track and stops the whole rig on any constraint, while the
 * envelope is per bone, composed by rig-c's helper, and stops only the parts
 * whose chains a constraint drives. Both read the same idle.
 *
 * The contract (rig-c docs/MESH_REDUCTION.md §7, *Mechanism 1 — implemented,
 * the measurement half* and *the reducer half*) types it as
 *
 *     { reference, bones: [{ bone, linear, pivot, translation }] }
 *
 * and every entry comes from rig-c's `skinningEnvelopeBone({ referenceChain,
 * chain })` — rig-c's one definition of `linear` (Q3) — over ranges read off
 * the idle this package writes. Nothing is estimated here.
 *
 * ## The terms
 *
 * - **The reference** (issue #165) is the lowest common ancestor of the
 *   slot's bone — the bone the rig stage writes on the part's slot,
 *   `segments[0]`'s — and every bone the part's source weights bind: the
 *   deepest bone on every one of their ancestries ({@link lowestCommonAncestor},
 *   {@link slotEnvelope}). When every bound bone hangs below the slot's bone
 *   that is the slot's bone itself (Q4), and the derivation is the one this
 *   module made before #165, call for call. When a bound bone hangs in a
 *   sibling subtree (a skirt link beside the chest) the reference is the bone
 *   they share — read off the rig as written, never chosen.
 * - **The bones** are every bone the part's source weights bind, other than
 *   the reference, sorted — "every bone either mesh binds, other than
 *   `reference`, once each"; a reduced mesh binds no bone its source does not
 *   (survivors keep their shares, an insertion interpolates them). The slot's
 *   bone is one of them exactly when it is not the reference and the weights
 *   bind it; when they do not, it is not sent (rig-c refuses a bone the
 *   meshes do not bind, `SKINNING_BONE_UNKNOWN`).
 * - **The chains**: `referenceChain` is the rig's ancestry from the root down
 *   to the reference; `chain` from the reference's child down to the bone,
 *   parents first — read off the rig's bones as written, controls included.
 *   Against a common ancestor every bound bone has such a chain. The check
 *   stays in {@link deriveEnvelope}, which takes any reference: a bound bone
 *   that is not below the reference it is handed has no chain the helper
 *   composes, and the part's residual is not measurable, naming the bone
 *   (`ENVELOPE_BONE_NOT_BELOW_REFERENCE`). Inside one skeleton — one root —
 *   {@link slotEnvelope} never hands it such a reference, so the stop cannot
 *   fire there; it fires only on a bone list with two roots, which is not a
 *   skeleton, where no common ancestor exists and the slot's bone is kept as
 *   the reference so that every bone with no chain to it is named.
 * - **Each bone's range** (`BoneMotionRange`) from the idle's tracks that key
 *   it — its own track or a group's that names it: `rotate` the [min, max]
 *   of every key value and every Bézier control value (a cubic Bézier lies
 *   inside the hull of its control points; a named easing runs between its
 *   two key values, and both easings this package writes stay within
 *   [0, 1]), `scaleX` / `scaleY` the same over `scalex` / `scaley`, and
 *   `translate` the length of (max |translatex|, max |translatey|) — each a
 *   value Spine adds to (rotation, translation) or multiplies (scale) the
 *   setup by; an unkeyed property is [0, 0], [1, 1] or 0. `pivot` is the
 *   bone's setup joint in the part's drawing frame (crop px less the part's
 *   padded origin, y down). `setup` is the rig's as written: this package
 *   writes no bone scale or shear, so `{ 1, 1, 0, 0, 'normal' }` — with the
 *   bone's own `inherit` where config.bones declares one (issue #348), handed
 *   to rig-c as written, which refuses any mode but `normal` by name
 *   (`SKINNING_RANGE_UNSUPPORTED`): the residual is then not measurable.
 *   A shear key has no field in `BoneMotionRange`, so a bone keyed by one
 *   makes the residual not measurable (`ENVELOPE_SHEAR_KEYED`); a property
 *   the idle writes and none of the above names is refused the same way.
 * - **Constraints**: a bone a constraint drives — an ik's, a transform's or a
 *   path's `bones`, a physics constraint's `bone` — moves by what the
 *   constraint solves, not by a key. Its range is handed to rig-c with the
 *   constraint's kind as its `source`, and rig-c refuses it by name
 *   (`SKINNING_RANGE_UNSUPPORTED`): rig-c certifies only ranges declared by
 *   keys and exposes no physics range off a posed walk (Q3), so none is
 *   invented here. A slider drives the bones of an animation this module does
 *   not read, so a rig with a slider makes every part's residual not
 *   measurable (`ENVELOPE_SLIDER_UNREAD`).
 *
 * A part with any stop is **not measurable**: no `targets.skinning` is sent,
 * the veto is not applied, and the motion comparison accepts or refuses the
 * part alone, as it does without the field. Every stop is named — bone, code
 * and rig-c's own words where rig-c refused.
 *
 * Pure: no clock, no randomness, nothing read or written.
 */
import { type BoneMotionRange, type EnvelopeBoneRanges, MeshReductionError, type MeshQualityReport, type MeshReductionInput, type SkinningEnvelope, type SkinningEnvelopeBone, skinningEnvelopeBone } from '@rig-c/core/mesh';
import type { ConfigConstraint } from './config.ts';
import type { MotionKey, MotionSpec } from './motion.ts';
import { edgeLength } from './length.ts';

/** What the derivation reads off the rig besides the part: the bones (name, parent), each bone's setup joint in crop px, the idle as written, the constraints. */
export interface EnvelopeBasis {
  bones: ReadonlyArray<{ name: string; parent?: string; inherit?: string }>;
  joints: ReadonlyMap<string, readonly [number, number]>;
  motion: MotionSpec;
  constraints: readonly ConfigConstraint[];
}

/** One stop: the bone (or constraint) it names, the code, and the sentence — rig-c's own for a refusal of its helper. */
export interface EnvelopeStop {
  bone: string;
  code: string;
  detail: string;
}

/** The envelope to send, or every stop that leaves the part's residual not measurable. */
export type EnvelopeDerivation = { envelope: SkinningEnvelope } | { stops: EnvelopeStop[] };

/** Where a range comes from: the bone's keys, or the kind of the constraint that drives it — which rig-c refuses by name. */
type RangeSource = 'keys' | 'ik' | 'transform' | 'path' | 'physics';

/**
 * A `BoneMotionRange` whose `source` may name a constraint kind, and whose `setup.inherit` may name a declared mode
 * (issue #348): rig-c reads both at run time and certifies `'keys'` and `'normal'` alone.
 */
type DeclaredRange = Omit<BoneMotionRange, 'source' | 'setup'> & { source: RangeSource; setup: Omit<BoneMotionRange['setup'], 'inherit'> & { inherit: string } };

/**
 * rig-c's helper over ranges whose `source` may be a constraint kind. rig-c's type admits only the one value it
 * certifies; it reads the field at run time and refuses any other by name (`SKINNING_RANGE_UNSUPPORTED`), which is the
 * refusal this package wants carried rather than re-implemented — so the wider value is handed through as data.
 */
function envelopeEntry(ranges: { referenceChain: DeclaredRange[]; chain: DeclaredRange[] }): SkinningEnvelopeBone {
  return skinningEnvelopeBone(ranges as unknown as EnvelopeBoneRanges);
}

/** The bones a constraint drives, by kind (rig-c's shapes, `CONSTRAINT_BONE_FIELDS` in `src/config.ts`): a slider's are an animation's, read as null. */
export function constraintDriven(c: ConfigConstraint): string[] | null {
  if (c.type === 'slider') return null;
  if (c.type === 'physics') return typeof c.bone === 'string' ? [c.bone] : [];
  return Array.isArray(c.bones) ? c.bones.filter((b): b is string => typeof b === 'string') : [];
}

/** Every value a track's curve can reach: each key's values and each Bézier control value (module header). */
function trackValues(keys: readonly MotionKey[]): number[] {
  const out: number[] = [];
  for (const k of keys) {
    out.push(...k.v);
    if (k.curve !== undefined) out.push(k.curve[1], k.curve[3]);
  }
  return out;
}

const SETUP: BoneMotionRange['setup'] = { scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, inherit: 'normal' };

/** The bone's declared inherit mode as the rig writes it (issue #348), or nothing, so {@link SETUP}'s `normal` stands. */
function inheritOf(basis: EnvelopeBasis, bone: string): { inherit: string } | Record<string, never> {
  const mode = basis.bones.find((b) => b.name === bone)?.inherit;
  return mode === undefined ? {} : { inherit: mode };
}

/** One bone's declared range off the idle, or the stop that names why it has none. */
export function boneRange(basis: EnvelopeBasis, bone: string, origin: readonly [number, number], driven: ReadonlyMap<string, RangeSource>): DeclaredRange | EnvelopeStop {
  const joint = basis.joints.get(bone);
  if (joint === undefined) return { bone, code: 'ENVELOPE_JOINT_UNKNOWN', detail: `the rig declares no setup joint for "${bone}"` };
  let rotate: [number, number] = [0, 0];
  let scaleX: [number, number] = [1, 1];
  let scaleY: [number, number] = [1, 1];
  let tx = 0;
  let ty = 0;
  for (const t of basis.motion.animations.idle.tracks) {
    const keyed = t.bone !== undefined ? t.bone === bone : (basis.motion.groups[t.group ?? ''] ?? []).includes(bone);
    if (!keyed) continue;
    const vs = trackValues(t.keys);
    const span: [number, number] = vs.length === 0 ? [0, 0] : [Math.min(...vs), Math.max(...vs)];
    const most = Math.max(0, ...vs.map((v) => Math.abs(v)));
    if (t.property === 'rotate') rotate = span;
    else if (t.property === 'scalex') scaleX = span;
    else if (t.property === 'scaley') scaleY = span;
    else if (t.property === 'translatex') tx = most;
    else if (t.property === 'translatey') ty = most;
    else if (t.property === 'shearx' || t.property === 'sheary') {
      return { bone, code: 'ENVELOPE_SHEAR_KEYED', detail: `the idle keys ${t.property} on "${bone}"; rig-c's BoneMotionRange declares rotation, scale and translation only, so the bone's motion has no declared range and none is invented` };
    } else {
      return { bone, code: 'ENVELOPE_PROPERTY_UNREAD', detail: `the idle keys "${t.property}" on "${bone}", a property this derivation reads no range from` };
    }
  }
  return {
    bone,
    source: driven.get(bone) ?? 'keys',
    pivot: [joint[0] - origin[0], joint[1] - origin[1]],
    rotate,
    scaleX,
    scaleY,
    translate: edgeLength(tx, ty),
    setup: { ...SETUP, ...inheritOf(basis, bone) },
  };
}

/**
 * The envelope of one part against a given `reference` (module header; the rig stage hands it the common ancestor,
 * {@link slotEnvelope}), `bound` the bones its source weights bind, `origin` the part's padded origin in crop px (the
 * drawing frame's (0, 0)). Every bone is tried, so one derivation names every stop; a bound bone not below `reference`
 * is one (`ENVELOPE_BONE_NOT_BELOW_REFERENCE`).
 */
export function deriveEnvelope(basis: EnvelopeBasis, reference: string, bound: readonly string[], origin: readonly [number, number]): EnvelopeDerivation {
  const stops: EnvelopeStop[] = [];
  const parent = new Map(basis.bones.map((b) => [b.name, b.parent ?? null]));
  const driven = new Map<string, RangeSource>();
  for (const c of basis.constraints) {
    const kind = c.type;
    if (kind === 'slider') {
      stops.push({ bone: `constraint "${c.name}"`, code: 'ENVELOPE_SLIDER_UNREAD', detail: `a slider drives the bones of the animation it names, which this derivation does not read; no bone's range is certain while it runs` });
      continue;
    }
    for (const b of constraintDriven(c) ?? []) if (!driven.has(b)) driven.set(b, kind);
  }
  const ancestry = (bone: string): string[] => {
    const up: string[] = [];
    for (let b: string | null = bone; b !== null; b = parent.get(b) ?? null) up.push(b);
    return up.reverse();
  };
  const ranges = new Map<string, DeclaredRange | EnvelopeStop>();
  const rangeOf = (b: string): DeclaredRange | EnvelopeStop => {
    const got = ranges.get(b) ?? boneRange(basis, b, origin, driven);
    ranges.set(b, got);
    return got;
  };
  const isStop = (r: DeclaredRange | EnvelopeStop): r is EnvelopeStop => 'code' in r;
  if (!parent.has(reference)) stops.push({ bone: reference, code: 'ENVELOPE_BONE_UNKNOWN', detail: `the slot's bone "${reference}" is not a bone of the rig` });
  const referenceChain = parent.has(reference) ? ancestry(reference) : [];
  const entries: SkinningEnvelopeBone[] = [];
  for (const bone of [...new Set(bound)].filter((b) => b !== reference).sort()) {
    if (!parent.has(bone)) {
      stops.push({ bone, code: 'ENVELOPE_BONE_UNKNOWN', detail: `the part's weights bind "${bone}", which is not a bone of the rig` });
      continue;
    }
    const up = ancestry(bone);
    const at = up.indexOf(reference);
    if (at < 0) {
      stops.push({ bone, code: 'ENVELOPE_BONE_NOT_BELOW_REFERENCE', detail: `the part's weights bind "${bone}", which does not hang below the slot's bone "${reference}" (its ancestry: ${up.join(' > ')}); rig-c's skinningEnvelopeBone composes a chain from the reference's child down to the bone, and no other composition is derived here` });
      continue;
    }
    const chainNames = up.slice(at + 1);
    const refRanges = referenceChain.map(rangeOf);
    const chainRanges = chainNames.map(rangeOf);
    const own = [...refRanges, ...chainRanges].filter(isStop);
    if (own.length > 0) {
      for (const s of own) if (!stops.some((x) => x.bone === s.bone && x.code === s.code)) stops.push(s);
      continue;
    }
    try {
      entries.push(envelopeEntry({ referenceChain: refRanges.filter((r): r is DeclaredRange => !isStop(r)), chain: chainRanges.filter((r): r is DeclaredRange => !isStop(r)) }));
    } catch (err) {
      if (!(err instanceof MeshReductionError)) throw err;
      stops.push({ bone, code: err.code, detail: err.message });
    }
  }
  if (stops.length > 0) return { stops };
  return { envelope: { reference, bones: entries } };
}

/** A bone as the reference's derivation reads it: a name and its parent. */
export interface TreeBone {
  name: string;
  parent?: string | null;
}

/** The bone's ancestry from its root down to the bone, or null when the list does not hold it (or its parents loop). */
export function ancestry(bones: readonly TreeBone[], name: string): string[] | null {
  const parent = new Map(bones.map((b) => [b.name, b.parent ?? null]));
  if (!parent.has(name)) return null;
  const up: string[] = [];
  const seen = new Set<string>();
  for (let b: string | null = name; b !== null; b = parent.get(b) ?? null) {
    if (seen.has(b)) return null;
    seen.add(b);
    up.push(b);
  }
  return up.reverse();
}

/**
 * The lowest common ancestor of the slot's bone and every bound bone the list holds (issue #165): the deepest bone on
 * every one of their ancestries. In one skeleton every ancestry starts at the one root, so it always exists; a list
 * with two roots (a degenerate input, not a skeleton) has none, and the bone that shares no ancestor with the slot's
 * bone is named under `ENVELOPE_BONE_NOT_BELOW_REFERENCE`, the stop {@link deriveEnvelope} gives a bone with no chain
 * to the reference. A bound bone the list does not hold is left to {@link deriveEnvelope}, which names it; an unknown
 * slot's bone stops by its name. Measured first in Stage A (`tools/auto_envelope_survey.ts`, which reads this one).
 */
export function lowestCommonAncestor(bones: readonly TreeBone[], slot: string, bound: readonly string[]): { reference: string } | { stop: EnvelopeStop } {
  const own = ancestry(bones, slot);
  if (own === null) return { stop: { bone: slot, code: 'ENVELOPE_BONE_UNKNOWN', detail: `the slot's bone "${slot}" is not a bone of the rig` } };
  let common = own;
  for (const b of [...new Set(bound)].sort()) {
    const up = ancestry(bones, b);
    if (up === null) continue;
    let k = 0;
    while (k < common.length && k < up.length && common[k] === up[k]) k++;
    if (k === 0) {
      return {
        stop: {
          bone: b,
          code: 'ENVELOPE_BONE_NOT_BELOW_REFERENCE',
          detail: `the part's weights bind "${b}", which shares no ancestor with the slot's bone "${slot}" (its ancestry: ${up.join(' > ')}; the slot's: ${own.join(' > ')}); one skeleton has one root, so this bone list is not one skeleton and no reference is derived`,
        },
      };
    }
    common = common.slice(0, k);
  }
  return { reference: common[common.length - 1] };
}

/** The envelope of one part as the rig stage derives it: the reference it was derived against, and the derivation. */
export interface SlotEnvelope {
  reference: string;
  derivation: EnvelopeDerivation;
}

/**
 * The envelope of one part (module header, issue #165): `slot` the slot's bone, `bound` the bones its source weights
 * bind, `origin` the part's padded origin in crop px. The reference is {@link lowestCommonAncestor}; the bound bones
 * are handed to {@link deriveEnvelope} as they are, so the slot's bone enters with its own range exactly when the
 * weights bind it and it is not the reference, and is not sent otherwise. When the reference is the slot's bone this
 * is `deriveEnvelope(basis, slot, bound, origin)`, the call made before #165. Where no common ancestor exists — an
 * unknown slot's bone, or a bone list with two roots, neither a skeleton the rig stage writes — the slot's bone is
 * kept as the reference and {@link deriveEnvelope} names every bone with no chain to it: no reference is invented.
 */
export function slotEnvelope(basis: EnvelopeBasis, slot: string, bound: readonly string[], origin: readonly [number, number]): SlotEnvelope {
  const lca = lowestCommonAncestor(basis.bones, slot, bound);
  const reference = 'reference' in lca ? lca.reference : slot;
  return { reference, derivation: deriveEnvelope(basis, reference, bound, origin) };
}

/** The reduction input with `targets.skinning` on it — the envelope and the author's bound — or unchanged when nothing is sent. */
export function withSkinning(input: MeshReductionInput, d: EnvelopeDerivation | null, maxResidual: number | undefined): MeshReductionInput {
  if (d === null || maxResidual === undefined || !('envelope' in d)) return input;
  return { ...input, targets: { ...input.targets, skinning: { envelope: d.envelope, maxResidual } } };
}

const RULE_TAIL =
  'a pose-free bound on how far the candidate draws a UV from where the source draws it, under that envelope only — it certifies no orientation, stretch or squash, and it is not the motion verdict: the motion comparison still runs and decides; ' +
  "rig-c's report does not count the steps the veto refused (tools/veto_tally.ts counts them)";

/** What the row and the build line say the residual is, in so many words — on a part whose reference is the slot's bone. */
export const RESIDUAL_RULE =
  "MQ_SKINNING_RESIDUAL (rig-c 2.31.0, rigc#1295): every removal, boundary run and post-pass of the reduction is held to it against the original source, under the envelope derived from the idle with the slot's bone as reference; " +
  RULE_TAIL;

/** The same, on a part whose reference is not the slot's bone (issue #165): the row's `reference` names the ancestor. */
export const RESIDUAL_RULE_COMMON_ANCESTOR =
  "MQ_SKINNING_RESIDUAL (rig-c 2.31.0, rigc#1295): every removal, boundary run and post-pass of the reduction is held to it against the original source, under the envelope derived from the idle with the lowest common ancestor of the slot's bone and every bound bone as reference (issue #165), the slot's bone sent as a bone when the weights bind it; " +
  RULE_TAIL;

/** The written mesh's `MQ_SKINNING_RESIDUAL` as its own measurement reports it. */
export interface ResidualReading {
  state: string;
  value: number | null;
  bound: { op: '<=' | '>='; value: number } | null;
  /** The worst sample (its UV or art pixel) and the value's two sums there; null when the row has no worst sample. */
  worst: { uv?: [number, number]; pixel?: [number, number]; covariance: number | null; lever: number | null } | null;
  /** Samples carried by both meshes. */
  samples: number | null;
  reason: string | null;
}

/** `mesh_report.json`'s `skinning_residual`: written only on a part whose author set `motion.residual`. */
export interface ResidualRow {
  rule: string;
  /** The author's bound, drawing px. */
  max_residual: number;
  /** Whether `targets.skinning` was sent — the veto applied. False exactly when the envelope stopped. */
  sent: boolean;
  /** The bone the envelope was derived against: the slot's bone, or the lowest common ancestor of it and every bound bone (issue #165). */
  reference: string;
  /** The envelope sent, per bone `linear` (dimensionless), `pivot` and `translation` (drawing px); null when nothing was sent. */
  envelope: SkinningEnvelopeBone[] | null;
  /** Why the residual is not measurable for this part, each naming its bone and code; empty when sent. */
  stops: EnvelopeStop[];
  /** The written mesh's reading; null when nothing was sent. */
  measured: ResidualReading | null;
}

/**
 * The row for one written mesh: the derivation, and the residual row of the report that mesh came with. `slot` is the
 * slot's bone when the caller knows it: a `reference` other than it is the common ancestor, and the row's `rule` says
 * so; left out, or equal, the rule is the slot's-bone rule the row has always carried.
 */
export function residualRow(maxResidual: number, reference: string, d: EnvelopeDerivation, report: MeshQualityReport, slot?: string): ResidualRow {
  const rule = slot === undefined || slot === reference ? RESIDUAL_RULE : RESIDUAL_RULE_COMMON_ANCESTOR;
  if (!('envelope' in d)) return { rule, max_residual: maxResidual, sent: false, reference, envelope: null, stops: d.stops, measured: null };
  const r = (report.candidates[0]?.geometry?.rows ?? []).find((x) => x.code === 'MQ_SKINNING_RESIDUAL' && x.object.region === null);
  const at = r?.worst?.at;
  const sk = r?.skinning;
  const measured: ResidualReading =
    r === undefined
      ? { state: 'absent', value: null, bound: null, worst: null, samples: null, reason: 'the measurement of the written mesh carries no MQ_SKINNING_RESIDUAL row' }
      : {
          state: r.state,
          value: r.value,
          bound: r.bound,
          worst: at === undefined ? null : { ...(at.uv === undefined ? {} : { uv: at.uv }), ...(at.pixel === undefined ? {} : { pixel: at.pixel }), covariance: sk?.worst?.covariance ?? null, lever: sk?.worst?.lever ?? null },
          samples: sk?.samples.measured ?? null,
          reason: r.reason,
        };
  return {
    rule,
    max_residual: maxResidual,
    sent: true,
    reference,
    envelope: d.envelope.bones.map((b) => ({ bone: b.bone, linear: b.linear, pivot: [b.pivot[0], b.pivot[1]], translation: b.translation })),
    stops: [],
    measured,
  };
}

/**
 * The build line's clause: empty without `motion.residual`, so a config that leaves it out prints the line it always
 * printed. Otherwise `; residual <value> <= <bound> (a pose-free bound, not the motion verdict)`, or, when nothing was
 * sent, `; residual not measurable: <bone> <code>, … (veto not applied; the motion comparison decides)`.
 */
export function residualClause(row: ResidualRow | undefined): string {
  if (row === undefined) return '';
  if (!row.sent) return `; residual not measurable: ${row.stops.map((s) => `${s.bone} ${s.code}`).join(', ')} (veto not applied; the motion comparison decides)`;
  const m = row.measured;
  const reading = m === null || m.value === null || m.bound === null ? (m?.state ?? 'absent') : `${m.value} ${m.state === 'fail' ? '>' : m.bound.op} ${m.bound.value}`;
  return `; residual ${reading} (a pose-free bound, not the motion verdict)`;
}
