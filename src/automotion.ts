/**
 * The motion gate of the automatic mesh mode (issue #126, item 3): a reduced
 * mesh is written only when it moves like the mesh it was reduced from, on the
 * rig's own idle, measured by rig-c's `compareMeshesInMotion`
 * (`rig-c/meshcompare`, 2.29.x) and held to the bounds the author wrote in
 * `meshes.<part>.auto.motion` (`AutoMotionSpec`, `src/config.ts`).
 *
 * ## What is compared
 *
 * - **The reference** is the rig with the part's unreduced, gated source mesh
 *   — the alpha >= 1 contour mesh `autoSource` returns, with the triangles and
 *   UVs `reduceMesh` was handed and its source weights, bound exactly as the
 *   reduced mesh is ({@link AutoMotionCase.reference}). **The candidate** is the
 *   rig the stage writes, with the reduced mesh. The two are one `RigSpec` with
 *   that one attachment swapped and nothing else; rig-c's allowlist
 *   (`COMPARE_INPUTS_DIFFER`) refuses anything else, and its refusal is carried
 *   here by code.
 * - Both go through rig-c's `build` under the same gate — the candidate
 *   packed, as the stage writes it, the reference compiled without packing
 *   (issue #135: the comparison allowlists atlas layout, and nothing reads a
 *   reference's pages) — and the comparison reads each build's
 *   `skeleton.model.json` as text. The builds run in the rig stage
 *   (`src/build.ts`), the one place this package runs rigc; this module is
 *   handed the two texts and stays pure.
 *
 * ## The schedule ({@link idleSchedule})
 *
 * The idle exactly as `check` renders it (`rigc render --animation idle --fps
 * IDLE_FPS`): the animation `idle` at {@link IDLE_FPS} fps over its whole
 * duration, physics reset at time 0 and stepped by `1 / IDLE_FPS` — the
 * render's step (rig-c's `render_core`) — with `warmupSteps: 0`, the only
 * value rig-c accepts (P10). Two phases: `grid`, the frames the render
 * draws, and `irr`, each frame interval's `IRR_OFFSET` past them, which the
 * render never selects. **Nothing here chooses a candidate by motion** — the
 * candidate is the one `reduceMesh` returned on geometry alone (item 2) — so
 * `selection` is empty and every frame is held out from selection by
 * construction. The one place a candidate is chosen by motion is the
 * acceptance loop (`src/autoreplay.ts`), which runs only after this gate
 * refused the full result: it chooses on the `grid` frames and declares them
 * `selection` in its final comparison, so its irr frames are the held-out ones.
 *
 * ## Stimulus ({@link motionStimulus})
 *
 * A comparison over frames that do not deform the part reads 0 and would pass
 * over nothing. Every bone the part binds moving by one affine map (a key on
 * an ancestor they share, or on the one bone a single-bone part binds) carries
 * every sample of both meshes to the same point — a barycentric combination
 * commutes with an affine map — so it is not a stimulus. The part is
 * stimulated when the idle keys, with changing values, a bone that is (or is
 * an ancestor of) some of the bound bones but not all of them; otherwise it is
 * refused `AUTO_MESH_NO_STIMULUS` before anything is compiled. Constraints are
 * not read: a part only a constraint would move is refused, never passed —
 * unless its author declares the motion (below).
 *
 * ## A declared stimulus ({@link stimulusAnimations}, issue #196)
 *
 * A part only a physics constraint moves (a tie, a strand, a hem) has no idle
 * key that deforms it. Its author may declare `meshes.<part>.auto.stimulus`:
 * `{ chain, degrees }`, or a list of them. Each declaration is two poses —
 * every link of the chain rotated by +degrees, and by −degrees, about its own
 * joint (a rotate key of that value on the link, which Spine adds to the setup
 * rotation; the links inherit, so the chain curls) — written as two one-key
 * animations of duration 0 into the motion of the builds the comparison reads
 * (the reference's and a candidate's built from the written rig with them
 * added; never into the motion the stage writes), and walked at the explicit
 * time 0: right after the physics reset, so the pose is the declared bend
 * itself and no physics step has moved it. Those frames are appended to every
 * schedule the gate and its acceptance loop walk; where a schedule declares a
 * selection (the search's), they are selection — read to choose — and
 * otherwise held out as every frame is. The idle is walked as before, so where
 * idle keys also deform the part both are measured. A declared link counts as
 * a stimulus by the rule above exactly as a keyed bone does; nothing is
 * derived from the constraint.
 *
 * ## Acceptance ({@link motionVerdict})
 *
 * `motionRequired: true`. The part is kept only when the candidate's
 * `accepted` is true (its geometry section and its motion section both
 * `pass`). Otherwise `AUTO_MESH_MOTION` names every gated row that did not
 * pass with its value, bound and worst frame; a refusal by rig-c of the
 * comparison's input — `COMPARE_REFERENCE_FAILS` included — is
 * `AUTO_MESH_MOTION_INPUT` carrying its code.
 *
 * Pure: no clock, no randomness, nothing read or written.
 */
import { type AcceptedOperation, MeshReductionError, type AlphaMask, type ArtFitBounds, type MeasureRow, type MeshQualityReport, type MotionAmplitude, type MotionBounds, type MotionSchedule, writeMeshQualityReport } from 'rig-c/mesh';
import { compareMeshesInMotion, comparePreparedMotion, prepareMotionReference, type MotionComparisonInput, type MotionReferenceInput, type PreparedMotionReference } from 'rig-c/meshcompare';
import type { AutoMotionSpec } from './config.ts';
import type { Problem } from './errors.ts';
import { IDLE_FPS, type MotionSpec, type MotionTrack } from './motion.ts';
import type { AutoMeshReport, MeshAttachment, RigBone } from './rig.ts';

/** The animation the motion gate walks: the idle, the one animation the rig stage writes and `check` renders. */
export const MOTION_ANIMATION = 'idle';

/** The reference's and the candidate's ids in the comparison's report. */
export const REFERENCE_ID = 'source';
export const CANDIDATE_ID = 'reduced';

/** The `why` written into `invariants.deformMayFold` for a part whose `motion.deformMayFold` is true. */
export const DEFORM_MAY_FOLD_WHY = 'rig-parts: the author set meshes.<part>.auto.motion.deformMayFold, so the motion gate lists this slot\'s folds rather than refusing them';

/**
 * The schedule of the motion gate: the idle as `check` renders it (module
 * header). `warmupSteps` is the literal 0 — no other value is ever sent.
 */
export function idleSchedule(): MotionSchedule {
  return {
    frames: [{ animation: MOTION_ANIMATION, fps: IDLE_FPS }],
    phases: ['grid', 'irr'],
    physics: { mode: 'step', dt: 1 / IDLE_FPS, warmupSteps: 0 },
    selection: [],
  };
}

/** Everything the rig stage needs to run one automatic part's motion gate, built by `buildRig` beside the part's attachment. */
export interface AutoMotionCase {
  part: string;
  /** `config.meshes.<part>.auto`, the object every refusal names. */
  object: string;
  /** The author's bounds; absent only on a spec built in code past the loader, which the stage refuses by name. */
  motion: AutoMotionSpec | undefined;
  /** The unreduced source as the rig writes a mesh: the reference's attachment. */
  reference: MeshAttachment;
  /** The padded part image's alpha, the art both builds are measured against. */
  mask: AlphaMask;
  /** What the source and the result were each held to by `reduceMesh`: the reference's and the candidate's art fit here. */
  sourceBounds: ArtFitBounds;
  artFit: ArtFitBounds;
  minArtSamples: number;
  /** Each declared region as rig-c held density on it, part-local px, with its art sample floor. */
  regions: Array<{ name: string; polygon: Array<[number, number]>; minArtSamples: number }>;
  /** The bones the reference's weights bind, sorted. */
  boundBones: string[];
  /** The chains the mesh's segments name, in their order: what a declared stimulus may bend (issue #196). */
  segmentChains: string[];
  /** The author's `auto.stimulus`, each chain's links resolved, as a list; null when none was declared. */
  stimulus: StimulusPose[] | null;
  /**
   * The motion amplitude the reduction was handed (`src/autoamplitude.ts`), handed to the comparison too (rig-c
   * 2.29.0, rigc#1291), or null when its derivation stopped — then the comparison's input carries no such key.
   */
  amplitude: MotionAmplitude | null;
  /** What the acceptance loop replays when the full result fails the gate (`src/autoreplay.ts`). */
  search: AutoSearch;
}

/** One replayed step as the rig would write it: its attachment and its row, and the candidates its replay tried. */
export interface ReplayCandidate {
  attachment: MeshAttachment;
  row: AutoMeshReport;
  candidatesTried: number;
}

/** The full run's accepted operations and a replay to any of them (`stopAfterAccepted`, rig-c 2.24.0; counted in operations from 2.25.0), each held to the full result's acceptance. */
export interface AutoSearch {
  /** The full run's `changes.acceptedAt`, one entry per accepted operation: N = its length. */
  acceptedAt: AcceptedOperation[];
  /** The refinement's insertions, the first I accepted operations (`refinementSteps`, found by `kind`). */
  inserted: number;
  /** The step replayed and accepted on geometry, or the problem that refuses it. Pure. */
  replay: (step: number) => ReplayCandidate | Problem;
}

/** One declared bend (issue #196): the chain, its links root first, and the degrees each link turns, both signs measured. */
export interface StimulusPose {
  chain: string;
  degrees: number;
  links: string[];
}

/** The two animations one declared bend is walked as: the chain bent by +degrees, then by −degrees. */
export function stimulusAnimationNames(s: StimulusPose): [string, string] {
  return [`stimulus ${s.chain} +${s.degrees}`, `stimulus ${s.chain} -${s.degrees}`];
}

/** What every stimulus animation says of itself in `motion.json`'s note field. */
export const STIMULUS_NOTE = 'rig-parts: a declared stimulus (meshes.<part>.auto.stimulus) — every link of the chain turned by the declared degrees about its joint, walked at time 0 by the motion gate only; never written';

/**
 * The animations of every declared bend, by name: each one key at time 0 on
 * every link of the chain, `rotate` by +degrees or −degrees, duration 0. Only
 * the comparison's builds carry them ({@link stimulusMotion}).
 */
export function stimulusAnimations(stimulus: readonly StimulusPose[]): Record<string, { duration: number; note: string; tracks: MotionTrack[] }> {
  const out: Record<string, { duration: number; note: string; tracks: MotionTrack[] }> = {};
  for (const s of stimulus) {
    const [plus, minus] = stimulusAnimationNames(s);
    for (const [name, v] of [[plus, s.degrees], [minus, -s.degrees]] as const) {
      out[name] = { duration: 0, note: STIMULUS_NOTE, tracks: s.links.map((bone) => ({ bone, property: 'rotate', keys: [{ t: 0, v: [v] }] })) };
    }
  }
  return out;
}

/**
 * The motion a comparison build reads for one part: the motion as written
 * (`motion.json`'s parsed object) with that part's stimulus animations added
 * after every animation it already has. A name already taken is refused by
 * name — an animation of the author's is never replaced. With no stimulus,
 * the motion as given.
 */
export function stimulusMotion(c: AutoMotionCase, written: Record<string, unknown>): { motion: Record<string, unknown> } | { problem: Problem } {
  if (c.stimulus === null) return { motion: written };
  const animations = (written.animations ?? {}) as Record<string, unknown>;
  const added = stimulusAnimations(c.stimulus);
  const taken = Object.keys(added).filter((n) => n in animations);
  if (taken.length > 0) {
    return {
      problem: {
      code: 'AUTO_MESH_MOTION_INPUT',
      object: `${c.object}.stimulus`,
      detail: `walks the animation(s) ${taken.map((n) => `"${n}"`).join(', ')}, and the motion already has an animation of that name; a stimulus is added beside the motion's animations and never replaces one — rename the animation in config.motion.animations_from`,
      },
    };
  }
  return { motion: { ...written, animations: { ...animations, ...added } } };
}

/** The frame id rig-c gives an explicit time 0 of `animation` (`<animation>@explicit@0`, `planSchedule` in rig-c/meshcompare). */
export function explicitFrameId(animation: string): string {
  return `${animation}@explicit@0`;
}

/**
 * `schedule` with the declared bends walked after it: each stimulus animation
 * at time 0. Where the schedule declares a selection (the acceptance loop's),
 * their frames join it — they are read to choose; otherwise every frame stays
 * held out. With no stimulus, the schedule as given.
 */
export function withStimulus(schedule: MotionSchedule, stimulus: readonly StimulusPose[] | null): MotionSchedule {
  if (stimulus === null) return schedule;
  const names = stimulus.flatMap((s) => stimulusAnimationNames(s));
  return {
    ...schedule,
    frames: [...schedule.frames, ...names.map((animation) => ({ animation, times: [0] }))],
    selection: schedule.selection.length === 0 ? schedule.selection : [...schedule.selection, ...names.map(explicitFrameId)],
  };
}

/** The bones the idle keys with changing values: each track's bone, and every member of a group a track keys. */
export function movingKeyedBones(motion: MotionSpec): string[] {
  const out = new Set<string>();
  for (const t of motion.animations.idle.tracks) {
    const first = JSON.stringify(t.keys[0]?.v ?? null);
    if (t.keys.every((k) => JSON.stringify(k.v) === first)) continue;
    if (t.bone !== undefined) out.add(t.bone);
    if (t.group !== undefined) for (const b of motion.groups[t.group] ?? []) out.add(b);
  }
  return [...out].sort();
}

/**
 * Whether the idle can deform a part bound to `bound` (module header,
 * *Stimulus*): the keyed bones that do, or none. A keyed bone deforms the part
 * when it is, or is an ancestor of, at least one bound bone and not all of
 * them: then those bones move by its key and the others do not. A key that
 * reaches every bound bone (their shared ancestor, the one bone of a
 * single-bone part, or a bound bone every other one hangs from) moves them all
 * by one affine map, which carries both meshes' samples alike. `declared` is
 * the links a declared stimulus turns (issue #196), read by the same rule as
 * a moving key; `keyed` is returned as the idle's own.
 */
export function motionStimulus(bones: readonly RigBone[], motion: MotionSpec, bound: readonly string[], declared: readonly string[] = []): { by: string[]; keyed: string[] } {
  const parent = new Map(bones.map((b) => [b.name, b.parent ?? null]));
  const keyed = movingKeyedBones(motion);
  const movers = [...new Set([...keyed, ...declared])].sort();
  const under = (bone: string, k: string): boolean => {
    for (let b: string | null = bone; b !== null; b = parent.get(b) ?? null) if (b === k) return true;
    return false;
  };
  const by = movers.filter((k) => {
    const reached = bound.filter((b) => under(b, k)).length;
    return reached > 0 && reached < bound.length;
  });
  return { by, keyed };
}

/**
 * The refusal of a part neither the idle nor a declared stimulus can deform:
 * which bones had no motion against each other, and the field that declares
 * one (issue #196). `keyed` is the idle's moving keys ({@link motionStimulus}'s
 * `keyed`); the declared links are read off the case.
 */
export function noStimulusProblem(c: AutoMotionCase, keyed: readonly string[]): Problem {
  const declared = c.stimulus === null ? '' : ` and the declared stimulus turns [${c.stimulus.flatMap((s) => s.links).join(', ')}]`;
  const chains = c.segmentChains.length > 0 ? `a chain its segments name: ${c.segmentChains.join(', ')}` : 'its segments name no chain, so name one there first';
  return {
    code: 'AUTO_MESH_NO_STIMULUS',
    object: c.object,
    detail:
      `the part binds [${c.boundBones.join(', ')}] and the idle keys [${keyed.join(', ') || 'nothing'}] with changing values${declared}; none of those moves some bound bones against the others, so the bones [${c.boundBones.join(', ')}] have no motion against each other, no frame deforms the part and a comparison would read 0 over nothing — ` +
      `missing stimulus is not a PASS. Declare ${c.object}.stimulus ({ "chain", "degrees" }: ${chains}; degrees the largest bend the physics is expected to reach), put the part in contour or grid mode, or key a bone it binds (a chain link it is weighted to)`,
  };
}

/** The comparison's whole input for one part: the two documents, the art, the author's bounds and {@link idleSchedule}. */
export function motionInput(c: AutoMotionCase, motion: AutoMotionSpec, reference: string, candidate: string, schedule: MotionSchedule = idleSchedule()): MotionComparisonInput {
  const bounds: MotionBounds = {
    maxLocalDeformation: motion.maxLocalDeformation,
    ...(motion.maxStretch === undefined ? {} : { maxStretch: motion.maxStretch }),
    ...(motion.minStretch === undefined ? {} : { minStretch: motion.minStretch }),
  };
  return {
    reference: { id: REFERENCE_ID, model: reference },
    candidates: [{ id: CANDIDATE_ID, model: candidate }],
    attachments: [
      {
        attachment: { skin: null, slot: c.part, attachment: c.part },
        art: { mask: c.mask, threshold: 1, frame: { space: 'part-local-drawing-px-y-down', width: c.mask.width, height: c.mask.height, pageScale: 1, conversion: 'texels = px * pageScale' } },
        finalThreshold: 1,
        minArtSamples: c.minArtSamples,
        regions: c.regions.map((r) => ({ name: r.name, polygon: r.polygon.map(([x, y]) => [x, y] as [number, number]), minArtSamples: r.minArtSamples })),
      },
    ],
    referenceArtFit: c.sourceBounds,
    candidateArtFit: c.artFit,
    schedule,
    bounds,
    motionRequired: true,
    perFrame: false,
    // rig-c 2.29.0: read by the setup measurement of each build only — MQ_DEFORM_LOAD measured there, no verdict moved.
    ...(c.amplitude === null ? {} : { motionAmplitude: c.amplitude }),
  };
}

/** One comparison: rig-c's report, or its refusal of the input carried by code. */
export function runComparison(object: string, input: MotionComparisonInput): MeshQualityReport | Problem {
  try {
    return compareMeshesInMotion(input);
  } catch (err) {
    if (!(err instanceof MeshReductionError)) throw err;
    return { code: 'AUTO_MESH_MOTION_INPUT', object, detail: `rig-c's compareMeshesInMotion refused the comparison's input (${err.code}): ${err.message}; nothing is built in the part's place` };
  }
}

/** Bind the exact reference-side input for the sequential replay candidates. */
export function prepareComparison(object: string, input: MotionReferenceInput): PreparedMotionReference | Problem {
  try {
    return prepareMotionReference(input);
  } catch (err) {
    if (!(err instanceof MeshReductionError)) throw err;
    return { code: 'AUTO_MESH_MOTION_INPUT', object, detail: `rig-c's compareMeshesInMotion refused the comparison's input (${err.code}): ${err.message}; nothing is built in the part's place` };
  }
}

/** Compare a fresh gated candidate under the prepared reference and its bound schedule/art/options. */
export function runPreparedComparison(object: string, handle: PreparedMotionReference, input: MotionComparisonInput): MeshQualityReport | Problem {
  try {
    return comparePreparedMotion(handle, input);
  } catch (err) {
    if (!(err instanceof MeshReductionError)) throw err;
    return { code: 'AUTO_MESH_MOTION_INPUT', object, detail: `rig-c's compareMeshesInMotion refused the comparison's input (${err.code}): ${err.message}; nothing is built in the part's place` };
  }
}

/** A gated row in one phrase: code, region, state, value against its bound, the worst frame. */
export function motionRowText(r: MeasureRow): string {
  const region = r.object.region === null ? '' : ` [region "${r.object.region}"]`;
  const at = r.worst?.frame?.id;
  if (r.state === 'pass' || r.state === 'fail' || r.state === 'undeclared') {
    return `${r.code}${region} ${r.state} ${r.value}${r.bound === null ? ' (no bound)' : ` against ${r.bound.op} ${r.bound.value}`}${at === undefined ? '' : ` at ${at}`}`;
  }
  return `${r.code}${region} ${r.state}: ${r.reason ?? ''}`;
}

/**
 * Where a row of a comparison was read at its worst, in the words a reader can act on (issue #280), with its
 * preposition: a declared stimulus by its animation's name (`at stimulus tail_l -10`, the frame rig-c ids
 * `stimulus tail_l -10@explicit@0`), an idle frame as `at idle frame <id>`, a geometry row — read on the mesh, at
 * no frame — as `in its geometry`, and a motion row that names no frame as `on the idle`.
 */
export function readingPlace(r: MeasureRow, stimulus: readonly StimulusPose[] | null, geometry: boolean): { text: string; stimulus: boolean } {
  const id = r.worst?.frame?.id;
  if (id === undefined) return { text: geometry ? 'in its geometry' : 'on the idle', stimulus: false };
  const name = (stimulus ?? []).flatMap((st) => stimulusAnimationNames(st)).find((n) => explicitFrameId(n) === id);
  return name === undefined ? { text: `at idle frame ${id}`, stimulus: false } : { text: `at ${name}`, stimulus: true };
}

/**
 * Issue #280: the source compared with itself failed, so no replayed step can pass — the one sentence that says
 * so (`the unreduced source itself fails <where> (<row> <value> against <bound>), so …`): where (a declared stimulus by name, or the idle frame), each failing row and its value against its bound,
 * and the remedy, which is the source's (its spacing or outline), or the stimulus's when the failure is read at
 * one. A row the source fails against itself is an absolute reading (`MQ_INVERSION` counts the source's own
 * flipped triangles), which is why no reduction of it can pass. Null when the comparison has no failing row.
 */
export function sourceSelfFailure(self: MeshQualityReport, stimulus: readonly StimulusPose[] | null): { where: string; sentence: string } | null {
  const rows = failingRows(self);
  if (rows.length === 0) return null;
  const geometryRows = new Set(self.candidates[0]?.geometry?.rows ?? []);
  const places = rows.map((r) => readingPlace(r, stimulus, geometryRows.has(r)));
  const distinct = [...new Set(places.map((p) => p.text))];
  const where = distinct.join(', ');
  // One place: the rows say only their values; several: each row says its own.
  const read = rows
    .map((r, i) => {
      const at = distinct.length > 1 ? ` ${places[i].text}` : '';
      return r.state === 'fail' || r.state === 'pass' || r.state === 'undeclared' ? `${r.code} ${r.value}${r.bound === null ? '' : ` against ${r.bound.op} ${r.bound.value}`}${at}` : `${r.code} ${r.state}${at}: ${r.reason ?? ''}`;
    })
    .join('; ');
  const atStimulus = places.some((p) => p.stimulus);
  return {
    where,
    sentence: `the unreduced source itself fails ${where} (${read}), so no replayed step can pass — change the source (its spacing or its outline)${atStimulus ? ' or lower the stimulus' : ''}`,
  };
}

/** The candidate's rows with a declared bound that did not pass, geometry then motion. */
export function failingRows(report: MeshQualityReport): MeasureRow[] {
  const c = report.candidates[0];
  const rows = [...(c?.geometry?.rows ?? []), ...(c?.motion?.rows ?? [])];
  return rows.filter((r) => r.bound !== null && r.state !== 'pass');
}

/** The verdict: null when the candidate is accepted, else the problem that refuses the part. */
export function motionVerdict(object: string, report: MeshQualityReport): Problem | null {
  const c = report.candidates[0];
  if (c !== undefined && c.accepted) return null;
  const failing = failingRows(report);
  const verdicts = `geometry ${c?.geometry?.verdict ?? 'absent'}, motion ${c?.motion?.verdict ?? 'absent'}`;
  return {
    code: 'AUTO_MESH_MOTION',
    object,
    detail:
      `the reduced mesh against its unreduced source on the idle (${verdicts}) is not accepted: ${failing.length > 0 ? failing.map(motionRowText).join('; ') : 'a required motion row was not measured'}; ` +
      'every declared bound passing in motion is required (motionRequired), and nothing is built in its place',
  };
}

/** One motion row as `mesh_report.json` carries it. */
export interface MotionResidual {
  code: string;
  region: string | null;
  state: MeasureRow['state'];
  value: number | null;
  bound: { op: '<=' | '>='; value: number } | null;
  unit: MeasureRow['unit'];
  worst_frame: string | null;
  samples: number | null;
  art_samples: number | null;
}

/** What replaces `deformation: "unmeasured…"` once the comparison has run and accepted the part. */
export interface MotionDeformation {
  verdict: 'pass' | 'fail' | 'not-measured';
  bounds: { maxLocalDeformation: number; maxStretch: number | null; minStretch: number | null; deformMayFold: boolean };
  rows: MotionResidual[];
  schedule: {
    animation: string;
    fps: number;
    phases: Array<'grid' | 'irr'>;
    physics: MotionSchedule['physics'];
    frames: { grid: number; irr: number };
    held_out: boolean;
    selection: string[];
  };
}

export function motionDeformation(motion: AutoMotionSpec, report: MeshQualityReport): MotionDeformation {
  const c = report.candidates[0];
  const section = c?.motion ?? null;
  const rows: MotionResidual[] = (section?.rows ?? []).map((r) => ({
    code: r.code,
    region: r.object.region,
    state: r.state,
    value: r.value,
    bound: r.bound,
    unit: r.unit,
    worst_frame: r.worst?.frame?.id ?? null,
    samples: r.sampling?.count ?? null,
    art_samples: r.art?.samples ?? null,
  }));
  const walked = section?.schedule.walked ?? [];
  const s = idleSchedule();
  return {
    verdict: section?.verdict ?? 'not-measured',
    bounds: { maxLocalDeformation: motion.maxLocalDeformation, maxStretch: motion.maxStretch ?? null, minStretch: motion.minStretch ?? null, deformMayFold: motion.deformMayFold ?? false },
    rows,
    schedule: {
      animation: MOTION_ANIMATION,
      fps: IDLE_FPS,
      phases: [...s.phases],
      physics: s.physics,
      frames: { grid: walked.filter((f) => f.phase === 'grid').length, irr: walked.filter((f) => f.phase === 'irr').length },
      held_out: section?.schedule.heldOutClaim ?? false,
      selection: [...(section?.schedule.selection ?? [])],
    },
  };
}

/** The attachment-level local-deformation row, the one the build line prints. */
export function localRow(report: MeshQualityReport): MeasureRow | null {
  return report.candidates[0]?.motion?.rows.find((r) => r.code === 'MQ_LOCAL_DEFORMATION' && r.object.region === null) ?? null;
}

/** The build line's motion clause: `motion <value> <= <bound> at <frame>`. */
export function motionClause(report: MeshQualityReport): string {
  const r = localRow(report);
  if (r === null) return 'motion: no local-deformation row';
  if (r.value === null || r.bound === null) return `motion ${r.state}: ${r.reason ?? ''}`;
  const at = r.worst?.frame?.id ?? 'every frame (0 points at nothing)';
  return `motion ${r.value} ${r.state === 'pass' ? r.bound.op : r.bound.op === '<=' ? '>' : '<'} ${r.bound.value} at ${at}`;
}

/** The comparison's whole document, as rig-c writes it, parsed so it can sit inside `mesh_report.json`. */
export function motionDocument(report: MeshQualityReport): unknown {
  return JSON.parse(writeMeshQualityReport(report));
}
