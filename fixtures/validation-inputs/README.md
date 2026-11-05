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
planted refused producers join the same append-only timing stream. Each producer
has a 60-second limit. The stream total is reported without a limit. Shard records
carry sample/feature counts and seconds, and merge prints every recorded shard.
Missing inputs are a HOLE; failed, corrupt or individually over-budget producers
are errors.

Contract and authoring controls preserve original assertion names and diagnostics
in internal child records, replayed by chain under CH945. SKIP and HOLE diagnostics
remain visible, and WARN uses the existing INFO gutter. README, rider, mesh,
assemble, ground, reader and statistics controls retain their standalone owners.
The three retired chain README units keep their frozen registry positions.
This explicitly narrows #395 isolation to permit immutable build sharing between
units of one shard, keyed by source head and complete input-byte digest. The focused chain run
includes those positives/defects, an actual one-byte rebuild, and the actual
selftest reporter with this directory absent. Full-tree coverage and the work
floor belong to PR CI.
