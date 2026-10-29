/**
 * How many steps rig-c's skinning-residual veto refused in one reduction
 * (issue #126, rig-c 2.31.0, rigc#1295). rig-c's report does not carry the
 * count: `changes.acceptedAt` lists the operations taken, the termination the
 * last refusal, and `changes.retriangulation.refusedBy` the post-pass's. So
 * this tool re-runs the very input through `reduceMeshWith` — on `@rig-c/core/mesh`
 * by `export *` and documented there as *internal, not promised* — with an
 * attempt observer, and counts the removal-phase attempts whose refusal is
 * named `MQ_SKINNING_RESIDUAL`. `reduceMeshWith` over the input's own rasters
 * is `reduceMesh` for that input byte for byte (rig-c's own words); the tally
 * checks that here — the report's text and the mesh against `reduceMesh`'s —
 * and refuses to count when they differ, so a count never describes a
 * reduction other than the one the stage ran.
 *
 * A tool and a control's instrument, never the rig stage's: `src/` stays on
 * rig-c's promised surface, and the row says the count is not in rig-c's
 * report rather than carrying it.
 */
import { type AttemptRecord, type MeshReductionInput, reduceMesh, reduceMeshWith, writeMeshQualityReport } from '@rig-c/core/mesh';
import { artRastersOf, stepRastersOf } from '@rig-c/core/src/meshrasters.ts';

/** One reduction's vetoes: removal-phase attempts refused by the residual, by kind, and the post-pass's refusal when it names the residual. */
export interface VetoTally {
  removals: number;
  runs: number;
  /** Attempts the observer saw, refused or taken: the denominator. */
  attempts: number;
  /** `changes.retriangulation.refusedBy` when it names `MQ_SKINNING_RESIDUAL`, else null. */
  postPass: string | null;
  /** The first veto's attempt number and its refusal text, or null when none. */
  first: { step: number; refusal: string } | null;
}

/** The residual's name as rig-c writes a refusal by it (`MQ_SKINNING_RESIDUAL: <value> against <= <bound>`). */
export const VETO_PREFIX = 'MQ_SKINNING_RESIDUAL';

/**
 * The vetoes of `input`'s reduction, or the reason the count was refused (the observed run did not write what
 * `reduceMesh` writes for the same input, or rig-c refused the input).
 */
export function vetoTally(input: MeshReductionInput): VetoTally | { refused: string } {
  const tally: VetoTally = { removals: 0, runs: 0, attempts: 0, postPass: null, first: null };
  const observe = (a: AttemptRecord): void => {
    tally.attempts++;
    if (a.refusedBy === null || a.decidedByFloor) return;
    const why = a.refusedBy();
    if (!why.startsWith(VETO_PREFIX)) return;
    if (a.kind === 'boundary-run') tally.runs++;
    else tally.removals++;
    tally.first ??= { step: a.step, refusal: why };
  };
  try {
    const rasters = artRastersOf(input.art);
    const seen = reduceMeshWith(input, rasters, stepRastersOf(rasters), null, observe);
    const plain = reduceMesh(input);
    const a = writeMeshQualityReport(seen.report);
    const b = writeMeshQualityReport(plain.report);
    if (a !== b || JSON.stringify(seen.mesh) !== JSON.stringify(plain.mesh)) return { refused: 'the observed run wrote a report or mesh that reduceMesh does not write for the same input; no count is claimed' };
    const rt = seen.report.candidates[0]?.changes?.retriangulation;
    tally.postPass = rt !== undefined && rt.refusedBy !== null && rt.refusedBy.startsWith(VETO_PREFIX) ? rt.refusedBy : null;
    return tally;
  } catch (err) {
    return { refused: err instanceof Error ? err.message : String(err) };
  }
}
