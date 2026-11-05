# Original validation sample

This is one original synthetic painting and See-through-shaped layer set, made
from flat colour blocks by `fixtures/validation.ts`. It is not public-example
art, a private corpus extract, or evidence of appearance fidelity.

`standard` supplies the base painting, full/head runs, declared requirements,
pose, keypoints and imported animation. The remaining configs derive specific
conditions: absent neck, a drawn gesture set, free/driven/mixed physics, a cloth
recipe, low-travel hem plus a moving sleeve, and a controls-only structure
profile. The travel view adds the second sleeve from the same block grammar.
Authoring and README snapshots retain actual proposer output with limbs and
cloth constraints. No handwritten polygons or cut artwork are used.

`expected/` is a port regression oracle, never reference-implementation parity.
Normal tests read it. Explicitly regenerate it on the ordinary remote pool with
`bun fixtures/regenerate_validation.ts`; regeneration uses the actual gated CLI
and records the producer durations. A changed expected file needs its measured
reason in the change's report.

Each selftest invocation owns its cache. Fixed worker units share one immutable
producer per head, complete input-byte digest and profile **within their CI
shard**. Other shards and invocations produce independently. Workflow builds and
planted refused producers join the same append-only timing stream. The fixed
limits remain 60 seconds per producer and 120 seconds summed per shard. Missing
inputs are a HOLE; failed, corrupt or over-budget producers are errors.

Feature controls preserve the original assertion names and diagnostics in
internal child records, replayed by chain under CH945. The focused chain run
includes those positives/defects, an actual one-byte rebuild, and the actual
selftest reporter with this directory absent. Full-tree coverage and the work
floor belong to PR CI.
