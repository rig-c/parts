# Contributing

rig-parts is small and opinionated, and most of the opinions are written
down — [CLAUDE.md](CLAUDE.md) is the doctrine, and it is worth ten minutes before
a first patch.

## Issues are the ledger

Open an issue before a substantial change. Open questions live in issues rather
than a backlog file, so an issue is where a decision gets its reasons attached
and where the next reader finds them.

A good defect report names three things:

1. what you gave rig-parts — the command line, and the smallest input that
   reproduces it (a `layers.json` with one layer is usually enough; do not
   attach art you may not share);
2. what it printed, verbatim, including the rule name on every `FAIL` line;
3. what you expected instead.

⚠️ **A wrong output that came back green is the most valuable report there
is.** The tool exists to turn silent wrongness into a named failure, so "it
said green and the parts are wrong" is a bug here even when every check behaved
as written.

## Before you open a pull request

```bash
bun run typecheck    # tsc --noEmit, strict
bun run lint         # one rule: @typescript-eslint/no-explicit-any, as an error
bun run selftest:pre # always-include cross-cutting set; one worker
# Add a lane's targeted suites without replacing the always-include set:
bun run selftest:pre -- --only rig,propose
```

Run targeted checks plus `selftest:pre` on an ordinary slot of the remote job pool. The full-tree
verdict and the **full forms of every suite** belong to PR CI's sharded selftest.
The pre command uses these fixed minimum forms, with one worker at a time:

| Member | Fixed pre form |
| --- | --- |
| `assemble-examples` | pinned demo inputs, then AE02 on demo through the existing stage runner and replay |
| `tree` | the shared TY12 and TY16 cases only |
| `chain` | one demo build through check, then the shared CH04 and CH05 golden comparators; CH01 verifies that the producer succeeded |
| `run-tally` | declaration ownership across registered suites, RT14's positive/negative prefix rule, live accounting and the existing six GiB family-memory check |

Only demo's pinned inputs are required for these default forms
(`bun run fetch-examples` fetches the full public set). A missing required input,
SKIP, HOLE, empty member or unaccounted worker record cannot pass. Additional
`--only` suites run in full beside these minimum forms. There is no general
individual-case filter; the fixed profile reuses the full suites' case bodies,
worker transport and tally. CI retains all examples and all cases.

The selection comes from recorded failures, not assumed coverage:

| Member | Historical evidence it catches |
| --- | --- |
| `assemble-examples` | [PR #826](https://github.com/rig-c/parts/pull/826): five AE02 failures in its reported pre-PR pool full run after the targeted source/config checks were green. Its PR CI was green; this is a pool-run report, not a red Actions run. |
| `tree` | [CI run 40707470817, job 122905577299](https://github.com/rig-c/parts/actions/runs/40707470817/job/122905577299): TY12, a README wording change broke an anchored transition sentence. |
| `run-tally` | [CI run 39279030133, job 118152893112](https://github.com/rig-c/parts/actions/runs/39279030133/job/118152893112): RT05 named prefixes shared by different suites (AM, PR, CK, CH, SC, EX). RT14 holds the prefix rule itself. |
| `chain` | [CI run 38186999073](https://github.com/rig-c/parts/actions/runs/38186999073): CH04's `check.json` golden changed. [CI run 38168410487](https://github.com/rig-c/parts/actions/runs/38168410487): CH05's gate golden changed its bone count. The pre minimum is one demo build with CH04/CH05 check and gate comparators; the full chain on every example belongs to PR CI. |

The pre-check also inspects literal case reporters declared in `selftest.ts`,
following local helper calls from every registered suite, with the live tally's
prefix rule. This catches collisions in omitted suites without executing them.
It prints its declaration coverage; imported helpers and computed names remain
PR CI's live-tally responsibility. The existing `comfy` fallback
`CF00_THE_HARNESS_RAN` is exempt only with a literal `false` verdict: it reports
a crashed harness, never a successful case. No existing case is renamed.

`selftest:pre` returns 0 only for its fixed targeted forms and prints that scope
explicitly. `--summary-json <file>` writes `rig-parts-pre/1`, with the selected
forms, case counts, per-member wall time and `partial: true`; this is not a
full-suite summary. Worker exit 0 alone is never a verdict: the existing replay
reader and tally must account for the emitted case lines and returned failures.
Ordinary `selftest -- --only ...` is unchanged: 2 when green and 1 when red,
with PARTIAL output and no full-tree green summary.

`bun run selftest` needs no arguments and no assets. Without `--corpus`, and
without the public examples' inputs fetched (`bun run fetch-examples`, which
CI runs first), the corpus suite reports a HOLE rather than a result, and the
summary says so. With them fetched, every suite that reads them first holds
each file to its blob id at the commit `scripts/fetch-examples.sh` pins (the
`…900_THE_FETCHED_EXAMPLE_INPUTS_MATCH_THE_PINNED_TREE` case, issue #367), and
a stale or unrecorded input stops that suite on that one named FAIL; re-running
`bun run fetch-examples` replaces a stale file and names it.

The suites run concurrently, one worker process per suite, as many at once as
min(available cores, 2), the measured operating point for one 6 GiB slot
(`RIG_PARTS_SELFTEST_JOBS=<n>` sets the
number; the former `SPINE_PARTS_SELFTEST_JOBS` is read when it is not set). What the run prints is the same either way: each suite's lines, in
the suites' own order, one suite after another. The run's own sampled family
RSS peak must fit 6 GiB; above it is a failed run-tally control. A platform
without Linux `/proc` reports that measurement as SKIP, never PASS. Shard
records carry their own peak lines into the merge. The peak is sampled,
counts shared pages once per PID, and does not replace a kernel memory limit.

CI runs the same suites in three jobs (issue #395): each job runs one shard
(`bun selftest.ts --shard <name> --record <file>`), and the `test` job merges
the records (`bun selftest.ts --merge <dir>`) into what a whole run prints. A
shard's unit is a suite, or one public example of a suite that builds every
example (`SPLIT_SUITES` in `selftest.ts`). A new example adds a unit to each of
those suites, and the run tally (`RT09`) stays red until each one is placed in
`SHARDS`.

A fourth needs a network, because it installs packages:

```bash
bun run smoke        # pack, install into an empty directory, run from the install
```

Reach for it before pushing anything that touches `files` in `package.json`,
`bin/`, a runtime import that crosses a directory, or a dependency — the changes
a green checkout cannot see. Its four planted broken packages (a module, each
dependency, removed; the Spine runtime added) run beside the two green cases,
so a run that passes has watched the check fail four times.

## Development commands

```sh
bun install
bun run typecheck        # tsc --noEmit, strict
bun run lint             # one rule: no explicit any
bun run fetch-examples   # the public examples' paintings and layers, into examples/*/inputs (needs a network); each file held to its blob id at the pinned commit, a stale one replaced by name
bun run selftest         # every gate's controls; with the examples fetched, build on each of them against its expected/
bun run selftest -- --summary-json summary.json  # also write rig-selftest-summary/1 (per-suite PASS/FAIL/SKIP counts, holes, partial flag and exit)
bun run smoke            # pack, install into an empty directory, run from the install (needs a network)
```

`bun run selftest -- --summary-json <file>` writes a machine-readable summary (`spec: "rig-selftest-summary/1"`, `tool: "rig-parts"`) derived from the same `RunTally` that prints the console summary: `exit` (`0 | 1 | 2`), `partial` (`boolean`), `only` (`string[] | null`), `faults`, `totals` (`suites`, `ran`, `skipped_suites`, `controls`, `passed`, `failed`, `skipped`, `holes`), per-suite `suites` entries (`suite`, `ran`, `controls`, `passed`, `failed`, `skipped`, `status`, `reason`), `skips` (`{ suite, name, reason, hole }`), and `holes` (`{ suite, name, reason }`). See [AUTHORING §8](docs/AUTHORING.md#machine-readable-selftest-summary---summary-json-issue-725) for the full shape.

The generated `foot-ownership` suite can be run alone with
`bun run selftest -- --only foot-ownership` (exit 2 means a green partial run,
not a full-tree verdict). Issue #638's revised acceptance requires zero foreign-leg
components and reports historical own-cap components separately; it was changed
after measurement, and the historical case did not pass the original second-island
1% bar. Issue #637 additionally preserves assigned own-cap connections under covers:
the generated default is now one connected component, retaining the historical
own-cap pixels and their bridge. The controls require both historical measurements
and current connected ownership, with no foreign-leg pixels.
[AUTHORING's limb section](docs/AUTHORING.md#limbs-cut-at-their-joints-limbs-issue-349)
records the generated default-cap case and its preservation controls.

## The README loop, as the selftest runs it

The command-order controls exercise the hand-copy route of the README's loop block on each fetched
example from a config holding only what the first step reads (`RL01`). The optional
`--write-config` forms save the proposed fields; `RL01` does not exercise
that flag. On `demo` the
proposal pasted uncorrected stops at the last step, naming its `bottomwear` on
`CHECK_TIP_OVER_ROOT` — the correction its tracked config records there, the two outer
skirt chains moved (issue #227, [its README](examples/demo/README.md)); on `scarf`,
since issue #262, it builds green, and on `wind` too. `wind`'s config declares the cloth
recipe and its limbs, so the block runs on it again with that `cloth` block authored,
`--cloth config.json` on the drafting `propose` line and its tracked `keypoints.json` on both
`propose --parts` lines (`RL05`): it pastes `limbs` and `constraints` with the rest and gives
back the tracked config, section for section ([its README](examples/wind/README.md)).
On `demo`, which tracks the pose file it was painted on, the block runs again with
`--keypoints` on both `propose --parts` lines (`RL03`): the proposal then also drafts
`limbs`, the step's list carries them, and the run ends where `RL01` ends. The joints
are that pose file scaled to the painting, not read off it, so this shows what the
loop carries, not where the joints are. On `wind`, which tracks the joints read off its
painting (`keypoints.json`), `RL03` runs with those. The list as it stood before issue #375, four
sections, stops at `--from-config` naming every limb part (`RL04`).

## What a change has to clear

- **No `any`, no `as any`, in `src/` or `cli.ts`.**
- **A new check needs a planted failure.** A gate nobody has seen fail is not a
  gate: every check needs a case in `selftest.ts` that makes it fire, beside a
  positive control. A check with nothing to measure reports SKIP, never a pass.
- **Never invent a value.** A missing number is a refusal naming the field.
- **A raster op says what it reproduces.** A new op in `src/raster/` names the
  OpenCV / SciPy / PIL call whose semantics it matches and what it was measured
  against; a deviation goes in its doc comment.
- **Nothing from the private corpus.** No image, layer, manifest, config or
  character name from it — CLAUDE.md, *Where the private oracle lives*. The
  public examples under `examples/` are not it, and the same section says why.
- **English only**, in every tracked file.
- **Determinism is a contract.** Fixed key order, stable sorts, no clock, no
  randomness in `src/` outside `src/comfy/`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/) with a scope —
`feat(layers):`, `fix(raster):`, `check(selftest):`, `docs(readme):`. Subject and
body in English. No workflow or tool reads the commit subject to cut a release:
cutting a release is landing the version bump (`package.json` and `CHANGELOG.md`)
on `main` through a pull request with green `ci` and pushing a `vX.Y.Z` tag on
that `main` commit, which runs `.github/workflows/release.yml`. See
[RELEASING.md](RELEASING.md).

Keep one unit of work per commit.

## Licence

Contributions are accepted under the MIT licence in [LICENSE](LICENSE).
rig-parts depends on `@rig-c/core`; `spine-core` is this repository's development
dependency, for the round trip in the selftest and CI. [NOTICE.md](NOTICE.md) sets
out what that means.
