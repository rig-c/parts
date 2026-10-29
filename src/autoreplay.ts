/**
 * The automatic mode's acceptance loop with a replay (issue #126, rigc#1266
 * mechanism 2, rig-c 2.24.0): what the rig stage does with an `auto` part
 * whose full reduction is refused by the motion gate (`src/automotion.ts`).
 *
 * rig-c's `reduceMesh` reports `changes.acceptedAt`, one entry per accepted
 * operation — `{ step, kind, count, sourceVertices }`, `step` the attempt
 * number it was taken at and `kind` a refinement `insertion`, a single
 * `removal` or a `boundary-run` (from rig-c 2.25.0, rigc#1279; before it the
 * entries were the bare attempt numbers) — and takes `stopAfterAccepted: n`,
 * which returns byte for byte the mesh the same call held after its n-th
 * accepted operation, terminated `replayed-to-accepted-step` (the contract:
 * rig-c's docs/MESH_REDUCTION.md §2 and §7, *Mechanism 2 — implemented*).
 * Every step below is an operation, not a vertex: a boundary run removes two
 * or more vertices in one step. The choosing is this package's (mechanism 3,
 * agreed on issue #126 as Q8), and it is done this way:
 *
 * 1. **The domain.** N = `acceptedAt.length` operations; the first I of them
 *    are the refinement's insertions ({@link refinementSteps}: the entries up
 *    to the last of kind `insertion` — rig-c refines inside the declared
 *    regions, then removes). A step at or below I is the
 *    source, refined or not, and is never written as an automatic result —
 *    writing the source would silently defeat the mode, so a search that finds
 *    no removal step passing is refused, "no reduction passes the motion
 *    bound" ({@link noReductionProblem}). Step N is the full result, which the
 *    gate already refused. So only the removal steps I+1 .. N−1 are probed, and
 *    a replay inside the refinement — which rig-c returns unaccepted, a
 *    refinement step not being required to meet the targets — is never asked
 *    for.
 * 2. **The search** ({@link bisectAccepted}): a bisection on n over (I, N),
 *    lo = I taken as passing and hi = N as failing; each probe replays step
 *    n, holds it to the same acceptance as the full result ({@link
 *    replayVerdict}: the termination rig-c promised, every declared geometry
 *    row passing), compiles it and compares it with the source on the idle's
 *    **grid** frames only ({@link selectionSchedule}: the schedule walks no
 *    irr frame at all, so none can inform the choice). It keeps the largest n
 *    it saw pass. Validity along the order is not monotone (the contract's M3
 *    measured it), so the search finds *a* passing prefix by bisection, not
 *    necessarily the last, and the row says so ({@link REPLAY_RULE}). Its
 *    length is at most ⌈log₂(N − I)⌉ replays ({@link maxReplays}) — derived
 *    from the domain, not an author's number; no config knob exists.
 * 3. **The acceptance.** The chosen replay is written into the rig, which goes
 *    through rigc's gate again as written, and is compared with the source on
 *    the whole idle — grid and irr — with the grid frames declared
 *    `selection` and the irr frames held out ({@link splitSchedule};
 *    `heldOutClaim` true, by rig-c's walk). It is accepted only when rig-c's
 *    verdict is `accepted` on every frame, the held-out ones included;
 *    otherwise {@link heldOutProblem} names the selection value and the held-out
 *    value with the worst frame of each. Nothing is written otherwise.
 *
 * The probe — a replay, a build, a comparison — runs in the rig stage
 * (`src/build.ts`), the one place this package runs rigc. Pure: no clock, no
 * randomness, nothing read or written.
 */
import type { AcceptedOperation, MeasureRow, MeshQualityReport, MotionSchedule, ReducedMesh } from '@rig-c/core/mesh';
import { autoVerdict, terminationText } from './automesh.ts';
import { idleSchedule, localRow, motionRowText } from './automotion.ts';
import type { Problem } from './errors.ts';

/** What the row and the build line say the search is, in so many words. */
export const REPLAY_RULE =
  'bisection over acceptedAt by stopAfterAccepted (rigc#1266 mechanism 2): removal steps only, selected on the idle grid frames with the irr frames held out, accepted on the whole idle; it finds a passing prefix, not necessarily the last (validity along the order is not monotone)';

/** The idle's `grid` frame ids, in walk order, from the frames rig-c walked in `report` — never typed, never the irr ones. */
export function gridFrameIds(report: MeshQualityReport): string[] {
  return (report.candidates[0]?.motion?.schedule.walked ?? []).filter((f) => f.phase === 'grid').map((f) => f.id);
}

/** The search's schedule: {@link idleSchedule} walking the `grid` phase alone, every frame of it `selection`. */
export function selectionSchedule(grid: readonly string[]): MotionSchedule {
  const s = idleSchedule();
  return { ...s, phases: ['grid'], selection: [...grid] };
}

/** The final acceptance's schedule: {@link idleSchedule} whole — grid and irr — with the grid frames `selection`, so every irr frame is held out. */
export function splitSchedule(grid: readonly string[]): MotionSchedule {
  return { ...idleSchedule(), selection: [...grid] };
}

/**
 * I: the operations of `acceptedAt` that are the refinement's insertions — the
 * entries up to and including the last of kind `insertion`, found by `kind`
 * and not by a count of vertices (rigc#1279: an operation may remove several).
 * rig-c refines first and then removes, so they are a prefix; 0 when there is
 * none.
 */
export function refinementSteps(acceptedAt: readonly AcceptedOperation[]): number {
  for (let i = acceptedAt.length - 1; i >= 0; i--) if (acceptedAt[i].kind === 'insertion') return i + 1;
  return 0;
}

/** Two accepted operations are the same operation: the same attempt number, kind, count and source vertices in order. */
export function sameOperation(a: AcceptedOperation, b: AcceptedOperation): boolean {
  return a.step === b.step && a.kind === b.kind && a.count === b.count && a.sourceVertices.length === b.sourceVertices.length && a.sourceVertices.every((v, i) => v === b.sourceVertices[i]);
}

/** An operation in a phrase: `12 removal [7]`, `40 boundary-run x3 [3, 4, 5]`. */
export function operationText(o: AcceptedOperation | undefined): string {
  if (o === undefined) return 'none';
  return `${o.step} ${o.kind}${o.count === 1 ? '' : ` x${o.count}`}${o.sourceVertices.length === 0 ? '' : ` [${o.sourceVertices.join(', ')}]`}`;
}

/** The most replays a bisection over the removal steps (I, N) takes: ⌈log₂(N − I)⌉, 0 when there is no step strictly between. */
export function maxReplays(accepted: number, inserted: number): number {
  const span = accepted - inserted;
  return span <= 1 ? 0 : Math.ceil(Math.log2(span));
}

/** One probe of the search: the step replayed and what it read on the selection frames. */
export interface ReplayProbe {
  step: number;
  /** `pass`: accepted on selection; `fail`: compared and not accepted; `refused`: the replay or its build was refused before a comparison. */
  verdict: 'pass' | 'fail' | 'refused';
  /** The attachment-level `MQ_LOCAL_DEFORMATION` on the selection frames, or null when nothing was compared. */
  value: number | null;
  frame: string | null;
  /** Why a `refused` probe was refused; null otherwise. */
  reason: string | null;
}

/**
 * The bisection (module header, step 2): lo = `lo` taken as passing, hi = `hi`
 * as failing; while a step lies strictly between, probe the middle one
 * (rounded down) and move lo up to it when it passes, hi down to it when it does
 * not. Returns the largest step seen to pass — `lo` itself when none did — and
 * every probe in the order taken. Deterministic: the order depends only on
 * the answers.
 */
export function bisectAccepted<P extends ReplayProbe>(lo: number, hi: number, probe: (step: number) => P): { chosen: number; probes: P[] } {
  const probes: P[] = [];
  let a = lo;
  let b = hi;
  while (b - a > 1) {
    const mid = Math.floor((a + b) / 2);
    const p = probe(mid);
    probes.push(p);
    if (p.verdict === 'pass') a = mid;
    else b = mid;
  }
  return { chosen: a, probes };
}

/**
 * The acceptance of one replay (module header, steps 1–2): the termination the
 * contract promises for `stopAfterAccepted: step` — `replayed-to-accepted-step`
 * with `acceptedSteps` the step and `candidatesTried` the full run's
 * `acceptedAt[step − 1].step`, its own `acceptedAt` the full run's first `step`
 * operations, each the same operation ({@link sameOperation}) —
 * and then {@link autoVerdict}'s rule, the full result's: the candidate
 * `accepted` with every declared geometry row passing. A replay that breaks the
 * promise is `AUTO_MESH_TERMINATION` naming the step and the difference; one
 * that keeps it but does not meet the targets is `AUTO_MESH_ACCEPTED`, as the
 * full result would be.
 */
export function replayVerdict(
  object: string,
  step: number,
  acceptedAt: readonly AcceptedOperation[],
  result: { mesh: ReducedMesh | null; report: MeshQualityReport },
): { accepted: true; mesh: ReducedMesh; candidatesTried: number } | { accepted: false; problem: Problem } {
  const t = result.report.termination;
  const own = result.report.candidates[0]?.changes?.acceptedAt ?? null;
  const want = acceptedAt[step - 1]?.step;
  const broken =
    want === undefined
      ? `was asked for a step the full run never took (it accepted ${acceptedAt.length} operation(s))`
      : t === null || t.reason !== 'replayed-to-accepted-step'
      ? `ended ${terminationText(t)}`
      : t.acceptedSteps !== step
        ? `reports acceptedSteps ${t.acceptedSteps}`
        : t.candidatesTried !== want
          ? `reports candidatesTried ${t.candidatesTried} where the full run's acceptedAt[${step - 1}].step is ${want}`
          : own === null || own.length !== step || own.some((o, i) => !sameOperation(o, acceptedAt[i]))
            ? `reports acceptedAt of ${(own ?? []).length} operation(s) (first differing: ${operationText((own ?? []).find((o, i) => acceptedAt[i] === undefined || !sameOperation(o, acceptedAt[i])))}), not the full run's first ${step}`
            : null;
  if (broken !== null || want === undefined) {
    return {
      accepted: false,
      problem: {
        code: 'AUTO_MESH_TERMINATION',
        object,
        detail: `rig-c's reduceMesh with stopAfterAccepted ${step} ${broken}; the contract (rigc#1268) promises replayed-to-accepted-step with acceptedSteps ${step} and candidatesTried ${want ?? 'the full run\'s acceptedAt[n - 1].step'}, and a replay that breaks it is not a candidate`,
      },
    };
  }
  const v = autoVerdict(object, result);
  if (!v.accepted) return v;
  return { accepted: true, mesh: v.mesh, candidatesTried: want };
}

/** One role's reading of the attachment-level local-deformation row: value, state and worst frame, or null when that role walked no frame. */
export interface RoleReading {
  value: number | null;
  state: MeasureRow['state'];
  frame: string | null;
}

/** The local-deformation row's `selection` and `held-out` readings (rig-c's `byRole`). */
export function roleReadings(report: MeshQualityReport): { selection: RoleReading | null; held_out: RoleReading | null; bound: { op: '<=' | '>='; value: number } | null } {
  const r = localRow(report);
  const by = r?.motion?.byRole;
  const of = (x: { value: number | null; state: MeasureRow['state']; frame: string | null } | null | undefined): RoleReading | null => (x === null || x === undefined ? null : { value: x.value, state: x.state, frame: x.frame });
  return { selection: of(by?.selection), held_out: of(by?.heldOut), bound: r?.bound ?? null };
}

/** A role's reading in a phrase: `0.93 <= 1 at idle@grid@1`, the operator turned when it fails. */
export function readingText(r: RoleReading | null, bound: { op: '<=' | '>='; value: number } | null): string {
  if (r === null) return 'not walked';
  if (r.value === null || bound === null) return `${r.state}`;
  const op = r.state === 'pass' ? bound.op : bound.op === '<=' ? '>' : '<';
  return `${r.value} ${op} ${bound.value} at ${r.frame ?? 'every frame'}`;
}

/** The probes in one phrase: `step 12 pass 0.4 at …, step 18 fail 1.2 at …`. */
export function probesText(probes: readonly ReplayProbe[]): string {
  if (probes.length === 0) return 'no step lies strictly between the source and the full result';
  return probes.map((p) => `step ${p.step} ${p.verdict}${p.value === null ? '' : ` ${p.value} at ${p.frame ?? 'every frame'}`}${p.reason === null ? '' : ` (${p.reason})`}`).join(', ');
}

/**
 * The refusal when the search keeps no removal step (module header, step 1):
 * the source is not written as an automatic result. Names the full result's
 * reading, the domain and every probe.
 */
export function noReductionProblem(object: string, full: string, accepted: number, inserted: number, probes: readonly ReplayProbe[]): Problem {
  return {
    code: 'AUTO_MESH_MOTION',
    object,
    detail:
      `no reduction passes the motion bound: the full result (accepted step ${accepted} of ${accepted}) ${full}; a bisection over the removal steps ${inserted + 1}..${accepted - 1} by stopAfterAccepted, ` +
      `selected on the idle grid frames with the irr frames held out, kept none (${probesText(probes)}); the source${inserted > 0 ? `, refined or not (steps 0..${inserted}),` : ' (step 0)'} is not an automatic result, and nothing is built in its place — raise the motion bound, protect the vertices that carry the motion (protect.weightJump), or put the part in contour mode`,
  };
}

/** The refusal of a chosen replay that the whole idle does not accept: the selection and held-out values, the worst frame of each, and every failing row. */
export function heldOutProblem(object: string, step: number, accepted: number, report: MeshQualityReport, failing: string): Problem {
  const r = roleReadings(report);
  return {
    code: 'AUTO_MESH_MOTION',
    object,
    detail:
      `the replay to accepted step ${step} of ${accepted}, chosen on the idle grid frames, is not accepted on the whole idle: selection ${readingText(r.selection, r.bound)}; held out ${readingText(r.held_out, r.bound)} (${failing}); ` +
      'a candidate chosen on some frames must pass on the frames it was not chosen by, and nothing is built in its place',
  };
}

/**
 * The final acceptance of a chosen replay (module header, step 3): null when
 * rig-c accepts it on the whole schedule — every frame, the held-out ones
 * included — else {@link heldOutProblem} with every gated row that did not pass.
 */
export function finalVerdict(object: string, step: number, accepted: number, report: MeshQualityReport): Problem | null {
  const c = report.candidates[0];
  if (c !== undefined && c.accepted) return null;
  const failing = [...(c?.geometry?.rows ?? []), ...(c?.motion?.rows ?? [])].filter((r) => r.bound !== null && r.state !== 'pass');
  return heldOutProblem(object, step, accepted, report, failing.length > 0 ? failing.map(motionRowText).join('; ') : 'a required motion row was not measured');
}

/** What `mesh_report.json`'s row carries about a search that chose a replay (`replay`, before `deformation`). */
export interface ReplayRow {
  rule: string;
  /** The full run's `acceptedAt` length: N operations. */
  accepted_steps: number;
  /** The refinement's insertions among them: I (operations 1..I, {@link refinementSteps}). */
  refinement_steps: number;
  /** The operation written: I < n < N. */
  chosen_step: number;
  /** `reduceMesh` calls with `stopAfterAccepted`: one per probe. */
  replays: number;
  /** ⌈log₂(N − I)⌉ ({@link maxReplays}). */
  max_replays: number;
  /** The candidates tried across the replays (each replay's `candidatesTried` — `acceptedAt[n − 1].step` — summed); the full run's own is the `quality_report`'s. */
  candidates_tried: number;
  /** The full result's reading on the whole idle, as the gate refused it. */
  full: RoleReading | null;
  probes: ReplayProbe[];
  /** The chosen replay on the whole idle, per role, from the final comparison. */
  selection: RoleReading | null;
  held_out: RoleReading | null;
}

// ---------------------------------------------------------------------------
// The multi-interval selection (issue #148), opt-in: `meshes.<part>.auto.motion.selection`.
// ---------------------------------------------------------------------------

/** What the row and the build line say the multi-interval search is, in so many words. */
export const MULTI_INTERVAL_RULE =
  'multi-interval selection over acceptedAt by stopAfterAccepted (issue #148): removal steps only; the bisection first, whole, then the midpoint (rounded down) of the longest untested run of removal steps, the lower run on a tie, each step replayed at most once, up to maxProbes replays in all; ' +
  'every probe selected on the idle grid frames; the fewest vertices among the tested steps that passed, the lower step on a tie; accepted on the whole idle with the irr frames held out, and no second candidate taken on a held-out failure; the best among tested candidates, not the last, the minimal or a complete walk';

/** One probe of the multi-interval search: {@link ReplayProbe} with the replay's own vertex count, null when the replay was refused before a mesh. */
export interface CountedProbe extends ReplayProbe {
  vertices: number | null;
}

/** How the multi-interval search ended. */
export type MultiIntervalTermination =
  /** Every removal step strictly between the source and the full result was replayed: the tested set is the whole domain. */
  | 'every-removal-step-tested'
  /** `maxProbes` replays were made and some removal step was never replayed: the tested set is partial. */
  | 'budget-exhausted'
  /** The probe order proposed a step already tested or outside the domain; it was not replayed, and the search stopped there. */
  | 'order-proposed-a-tested-step'
  /** The search was refused (a replay that broke rig-c's promise, a red build, a refused comparison input): it stopped there and the part is refused. */
  | 'refused';

/**
 * The untested runs of removal steps: the maximal runs of consecutive steps
 * strictly between `lo` and `hi` that are not in `tested`, as `[first, last]`
 * in ascending order.
 */
export function untestedIntervals(lo: number, hi: number, tested: ReadonlySet<number>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start: number | null = null;
  for (let s = lo + 1; s < hi; s++) {
    if (!tested.has(s)) {
      if (start === null) start = s;
      continue;
    }
    if (start !== null) out.push([start, s - 1]);
    start = null;
  }
  if (start !== null) out.push([start, hi - 1]);
  return out;
}

/**
 * The next step the multi-interval order proposes after the bisection: the
 * midpoint, rounded down, of the longest untested run ({@link
 * untestedIntervals}), the lower run when two are equally long; null when
 * every removal step has been tested. Depends only on the tested set.
 */
export function nextIntervalProbe(lo: number, hi: number, tested: ReadonlySet<number>): number | null {
  let best: [number, number] | null = null;
  for (const run of untestedIntervals(lo, hi, tested)) if (best === null || run[1] - run[0] > best[1] - best[0]) best = run;
  return best === null ? null : Math.floor((best[0] + best[1]) / 2);
}

/**
 * The passing intervals observed: walking the tested steps in ascending
 * order, each maximal run of tested steps that passed with no tested step
 * that did not pass between them, as `[first, last]`. An untested step inside
 * a run is not claimed to pass — it was not replayed.
 */
export function passingIntervals(probes: readonly ReplayProbe[]): Array<[number, number]> {
  const sorted = [...probes].sort((a, b) => a.step - b.step);
  const out: Array<[number, number]> = [];
  let run: [number, number] | null = null;
  for (const p of sorted) {
    if (p.verdict === 'pass') {
      if (run === null) run = [p.step, p.step];
      else run[1] = p.step;
      continue;
    }
    if (run !== null) out.push(run);
    run = null;
  }
  if (run !== null) out.push(run);
  return out;
}

/**
 * The selection rule: among the tested probes that passed with a vertex
 * count, the fewest vertices, then the lower step. Null when none passed.
 * The count is the replay's own, never one derived from the step number: an
 * operation may remove several vertices (a boundary run), and one may insert.
 */
export function fewestVertices(probes: readonly CountedProbe[]): CountedProbe | null {
  let best: CountedProbe | null = null;
  for (const p of probes) {
    if (p.verdict !== 'pass' || p.vertices === null) continue;
    if (best === null || best.vertices === null || p.vertices < best.vertices || (p.vertices === best.vertices && p.step < best.step)) best = p;
  }
  return best;
}

/**
 * The multi-interval search (issue #148) over the removal steps strictly
 * between `lo` (the source, refined or not — taken as passing and never
 * chosen) and `hi` (the full result, which the gate refused): the bisection
 * ({@link bisectAccepted}) first, whole, so its result is always among the
 * tested; then, while fewer than `maxProbes` distinct steps have been
 * replayed, the step `order` proposes ({@link nextIntervalProbe}). `probe` is
 * called once per distinct step: a proposal of a tested step (or one outside
 * the domain) is not replayed, not counted, and ends the search
 * (`order-proposed-a-tested-step` — the shipped order never proposes one).
 * `halted()` true — the caller's search was refused — ends it too
 * (`refused`); a replay refused on geometry alone (`AUTO_MESH_ACCEPTED`) is a
 * probe that did not pass, as in the bisection. Returns the probes in the order taken,
 * the bisection's own result, the chosen probe ({@link fewestVertices}) and
 * how it ended. Deterministic: the order depends only on the answers.
 *
 * The caller holds `maxProbes` at or above the bisection's worst length
 * ({@link maxReplays}, refused otherwise by {@link budgetProblem}), so the
 * bisection always completes inside the budget.
 */
export function multiIntervalSearch(
  lo: number,
  hi: number,
  maxProbes: number,
  probe: (step: number) => CountedProbe,
  halted: () => boolean = () => false,
  order: (lo: number, hi: number, tested: ReadonlySet<number>) => number | null = nextIntervalProbe,
): { probes: CountedProbe[]; bisection: number; chosen: CountedProbe | null; termination: MultiIntervalTermination } {
  const probes: CountedProbe[] = [];
  const tested = new Set<number>();
  const ask = (step: number): CountedProbe => {
    const p = probe(step);
    probes.push(p);
    tested.add(step);
    return p;
  };
  const bis = bisectAccepted(lo, hi, ask);
  let termination: MultiIntervalTermination | null = null;
  // Each turn either replays a new step of the domain or ends the search, so hi − lo turns always suffice; the cap
  // makes that a fact of the loop rather than of the order handed in.
  for (let turn = 0; termination === null; turn++) {
    const s = halted() ? null : order(lo, hi, tested);
    if (halted()) termination = 'refused';
    else if (s === null) termination = 'every-removal-step-tested';
    else if (tested.has(s) || s <= lo || s >= hi || turn > hi - lo) termination = 'order-proposed-a-tested-step';
    else if (tested.size >= maxProbes) termination = 'budget-exhausted';
    else ask(s);
  }
  return { probes, bisection: bis.chosen, chosen: fewestVertices(probes), termination };
}

/** The refusal of a budget below the bisection it must contain: the bisection over (I, N) may take ⌈log₂(N − I)⌉ replays. */
export function budgetProblem(object: string, maxProbes: number, accepted: number, inserted: number): Problem {
  const need = maxReplays(accepted, inserted);
  return {
    code: 'AUTO_MESH_SELECTION_BUDGET',
    object: `${object}.motion.selection.maxProbes`,
    detail:
      `is ${maxProbes}; the multi-interval selection runs the bisection over the removal steps ${inserted + 1}..${accepted - 1} of ${accepted} accepted step(s) whole first, which may take ${need} replay(s) (⌈log₂(N − I)⌉ with N ${accepted}, I ${inserted}), so ${need} or more is required — ` +
      "the budget is the author's and is never raised here; raise it, or leave selection out for the bisection alone",
  };
}

/** The refusal when the multi-interval search keeps no removal step: the source is not written, as under the bisection. */
export function noMultiReductionProblem(
  object: string,
  full: string,
  accepted: number,
  inserted: number,
  maxProbes: number,
  termination: MultiIntervalTermination,
  probes: readonly ReplayProbe[],
): Problem {
  return {
    code: 'AUTO_MESH_MOTION',
    object,
    detail:
      `no reduction passes the motion bound among the tested candidates: the full result (accepted step ${accepted} of ${accepted}) ${full}; a multi-interval selection over the removal steps ${inserted + 1}..${accepted - 1} by stopAfterAccepted (maxProbes ${maxProbes}, ended ${termination}), ` +
      `selected on the idle grid frames with the irr frames held out, kept none (${probesText(probes)}); a step never replayed is not claimed to fail; the source${inserted > 0 ? `, refined or not (steps 0..${inserted}),` : ' (step 0)'} is not an automatic result, and nothing is built in its place — raise maxProbes, raise the motion bound, protect the vertices that carry the motion (protect.weightJump), or put the part in contour mode`,
  };
}

/**
 * Schedule-role contamination (issue #148, item 4): every frame a probe's
 * comparison walked must be one the final comparison declares `selection`,
 * and no frame the final holds out may have been read by a probe. Null when
 * that holds; otherwise the problem names the frames and withdraws the
 * held-out claim — the candidate is refused, never re-chosen.
 */
export function rolesProblem(object: string, step: number, probeFrames: readonly string[], finalReport: MeshQualityReport): Problem | null {
  const walked = finalReport.candidates[0]?.motion?.schedule.walked ?? [];
  const heldOut = new Set(walked.filter((f) => f.role === 'held-out').map((f) => f.id));
  const selection = new Set(walked.filter((f) => f.role === 'selection').map((f) => f.id));
  const read = [...new Set(probeFrames)].sort();
  const leaked = read.filter((id) => heldOut.has(id));
  const stray = read.filter((id) => !selection.has(id) && !heldOut.has(id));
  if (leaked.length === 0 && stray.length === 0) return null;
  const named = [leaked.length > 0 ? `the held-out frame(s) [${leaked.join(', ')}]` : '', stray.length > 0 ? `frame(s) the final comparison does not declare selection [${stray.join(', ')}]` : ''].filter((x) => x !== '').join(' and ');
  return {
    code: 'AUTO_MESH_SELECTION_ROLES',
    object,
    detail: `the replay to accepted step ${step} was chosen by probes that read ${named}; a frame read to choose is selection, so the held-out claim is withdrawn, the candidate is not accepted on it, and nothing is built in its place`,
  };
}

/** What `mesh_report.json`'s row carries about a multi-interval search that chose a replay (`replay`, before `deformation`). */
export interface MultiIntervalRow {
  rule: string;
  policy: 'multi-interval';
  max_probes: number;
  /** The full run's `acceptedAt` length: N operations. */
  accepted_steps: number;
  /** The refinement's insertions among them: I. */
  refinement_steps: number;
  /** The operation written: I < n < N. */
  chosen_step: number;
  /** The bisection's own result inside the search (I when it kept none). */
  bisection_step: number;
  /** `reduceMesh` calls with `stopAfterAccepted`: one per distinct probe, at most `max_probes`. */
  replays: number;
  /** The candidates tried across the replays (each replay's `candidatesTried` summed). */
  candidates_tried: number;
  termination: MultiIntervalTermination;
  /** The tested removal steps, ascending. */
  tested: number[];
  /** Maximal runs of tested passing steps with no tested failure between ({@link passingIntervals}). */
  passing_intervals: Array<[number, number]>;
  /** Maximal runs of removal steps never replayed ({@link untestedIntervals}); empty only when every step was tested. */
  untested_intervals: Array<[number, number]>;
  /** The chosen replay's counts, read off its mesh. */
  chosen: { vertices: number; boundary: number; interior: number; triangles: number; bindings: number };
  /** The full result's reading on the whole idle, as the gate refused it. */
  full: RoleReading | null;
  probes: CountedProbe[];
  /** Which frames played which role: every probe read the grid frames alone (selection); the irr frames were read once, by the final comparison (held out). */
  roles: { selection: 'grid'; held_out: 'irr'; probe_frames: number };
  /** The chosen replay on the whole idle, per role, from the final comparison. */
  selection: RoleReading | null;
  held_out: RoleReading | null;
}
