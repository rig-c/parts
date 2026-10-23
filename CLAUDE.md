# CLAUDE.md

Guidance for AI-assisted sessions working on this repository. `AGENTS.md` is a
link to this file.

## What this is

`@rig-c/parts` (this repository, `rig-c/parts`; the command is `rig-parts`)
takes one anime character painting and its
[See-through](https://github.com/shitagaki-lab/see-through) layer decomposition
and produces Spine-ready parts — `parts/*.png`, `parts.json` (per-part
provenance and measurements), and `rig.json` / `motion.json` in
[rig-c](https://github.com/rig-c/core)'s spec — then calls rig-c to
compile, gate, render and check. It is a port of a working reference
implementation that lives in a private repository (see *Where the private
oracle lives*). Every command the CLI registers is implemented — layers,
sheet, propose, compare, assemble, rig, check, loop, inputs, comfy (the optional
ComfyUI adapter), compose, and `build`, which runs assemble, rig and check in
one process (`src/build.ts`); the list of commands not yet implemented (`LATER`
in `cli.ts`) is empty. From 1.0.0 the package follows semantic versioning:
what it holds stable, and what it does not, is `docs/STABILITY.md` (held to `cli.ts` and the
config loader by `TY13`/`TY14`), and what changed for an author coming from
0.16.0 is `docs/MIGRATION.md`.

## The doctrine: a tool for AI, not for people

An agent building a character rig from a painting cannot see the painting, the
layers or the result. A pipeline that only reports "done" lets it report
success on a broken rig and be sincere about it. rig-parts exists, like
rig-c under it, to convert that silence into named failures.

- **The messages are the UI.** A refusal names the rule, the object, the value
  found and the value required: `LAYERS_PNG_MATCHES_BBOX: layer "face" —
  parts/face.png is 25x12; the manifest box is 26x12`. "invalid layer" is not a
  message this repository writes. Readers collect every problem and throw once,
  so one run names everything that is wrong.
- **Everything resolves by name, and a miss is refused by name.** A bone's
  parent, a mesh's segment bones, a region's bone, a plan part's tag, an
  `extend_below_crop` part, a track's bone or chain. Parents come before
  children, as Spine requires.
- **Never invent a value.** No defaults guessed from the art, no "reasonable"
  fallbacks for a missing field, no silent mapping of an unknown tag to a
  nearby one. A missing number is a refusal naming the field. Where the
  reference implementation silently truncated or guessed (amplitudes zipped
  against chain links, a sine period that does not divide the idle, a
  non-square head box scaled by its width), the loader refuses.
- **Emit only after green.** A stage writes its outputs only when every check
  it owns has passed, and the rig stages write only after rig-c's round
  trip has passed. A wrong file on disk outlives the console that warned about
  it.
- 🔒 **rig-c's gate is not optional here either.** rig-parts does not
  emit Spine data itself; it hands a rig spec to rig-c, whose `build`
  validates before it writes. Which validator runs is rigc's launcher's
  choice, by whether `@esotericsoftware/spine-core` resolves beside it: the
  spine-core round trip where it does, rigc's own validator over the compiled
  model document where it does not, and the report's last lines say which
  ran. In this repository and its CI the runtime is a development
  dependency, so the round trip runs here; an install of `@rig-c/parts` carries
  no Spine runtime and runs rigc's own gate, and `check.json` records which
  gated the build. `build`'s gate is the one gate: rigc runs it once over the
  compile and once over the packed pages on disk, under `rig-play` (rig-c's renderer
  profile, named `spine-html` before rig-c 2.50.0; `CK20` holds every call this package
  makes to the name rigc keeps), which holds every rule `spine` measures (selftest `CH09`), so no stage runs a
  second `rigc validate`. There must never be a path in this package that
  produces skeleton data without that gate, nor a flag or environment escape
  that skips it, and nothing here re-implements what rigc validates.
- **Determinism is a contract.** The same inputs write the same bytes: fixed
  key order in every JSON written, stable sorts, no clock, no randomness, no
  locale-sensitive formatting. `src/` is pure except `src/comfy/` (below).
- **A gate nobody has seen fail is not a gate.** Every check in `selftest.ts`
  has a planted input that must make it fire, next to the positive control that
  must not. A suite with nothing to read reports **SKIP** and a HOLE line,
  never a pass.
- **No `any`, no `as any`, in `src/` or `cli.ts`.** `bun run lint` enforces it,
  and `TY01` checks that any exemption in `selftest.ts` sits between an
  `eslint-disable`/`eslint-enable` pair (there is none today).
- **Numbers carry their source.** A figure in a comment or a document is
  measured (and says against what — "bit-exact against cv2 4.13 over N
  samples") or it is not written. An unmeasured doubt is not written either.
- **The scene belongs to the consumer.** What the rig can do — its sway, its
  breath, its blink — is ours; when it does it, and with what else on screen,
  is not.

### The same lens governs how the repository is worked

Questions that look like preferences — which reading, which name, which
threshold — are settled by what is derivable and measurable, not by asking a
person. What survives that lens is short: direction, licence posture, what the
spend is worth, and text that speaks as the owner. "I cannot tell" is not a
reason to escalate; it means an instrument is missing, and the answer is a
check or a card. A task brief is checked against the tree before it is trusted,
and a report says what in the brief was contradicted.

The reader to write for is an agent with no memory of the conversation that
produced the work: a decision not written into the tree did not happen. Commit
messages and pull requests carry the argument — the claim, its measurement, and
the alternative rejected with the reason.

## Where the private oracle lives and what may not cross

The port is verified against the reference implementation and its corpus — real
paintings, their See-through runs, the parts and configs the reference produced
— which live in a **private** repository and **never enter this tree**.

- ⛔ No painting, layer PNG, part PNG, `layers.json`, `parts.json`, `config.json`
  or rig from that corpus is copied here, in whole or in part, including as a
  fixture or a test expectation.
- ⛔ No character name from that corpus appears in any file. The one place the
  names are written is the marked block in `selftest.ts`, which exists so `TY04`
  can refuse them everywhere else.
- ⛔ No LAN address (`TY03`), no Korean text (`TY02`): the repository is English
  only, and a host is the user's, supplied at run time.
- ✅ The corpus is **read** with `bun run selftest -- --corpus <dir>` (or
  `RIG_PARTS_CORPUS=<dir>`; the former `SPINE_PARTS_CORPUS` is read when it is
  not set), which reads every `layers.json` and `parts.json` under it and writes
  nothing. A named corpus that does not exist exits 2; no
  corpus is a SKIP and a HOLE, never a pass.
- ✅ Measurements taken against it may be quoted as figures ("18 of 18 layer
  sets read green"), never as content.
- The fixtures that DO live here (`fixtures/synthetic.ts`) are flat colour
  blocks with hand-computable counts, and no claim about appearance is made
  from them.
- ✅ **The public examples are not that corpus.** `examples/<key>/` holds
  characters generated to be published — a public checkpoint, no identity
  LoRA, no private character text; the generation record and the licence are
  in the [rig-c/examples](https://github.com/rig-c/examples)
  repository. Their config, proposal, contact sheets and the reference's
  outputs (`expected/`) are tracked here — for `scarf`, which no reference
  ever ran, `expected/` is this port's own build at the commit that added
  it, so its chain suite holds the tree to itself; the painting and the See-through
  layers are fetched by `bun run fetch-examples`, at the commit that script
  pins, into the gitignored `examples/*/inputs`. The rules above are about
  where a file came from, not what it is called: a `config.json` or
  `parts.json` belongs here exactly when its character was made public on
  purpose, and the forbidden-name scan (`TY04`) covers `examples/` like every
  other tracked file.

## Conventions

- Bun + TypeScript, ESM, `.ts` extensions in relative imports, `strict: true`.
- `src/` is pure: no clock, no randomness, no network, no child processes.
  **One** directory is the exception, `src/comfy/`, reserved for the optional
  ComfyUI adapter; `TY06` scans every other file under `src/`.
- **The y flip has one door.** Parts and configs are in crop pixels, y down,
  origin top-left; Spine's world is y up. The conversion is rig-c's
  (`rig-c/src/transform.ts`), re-exported by `src/coords.ts`, and `TY07`
  refuses any other importer. Do not open-code `height - y` anywhere.
- **rig-c's deep paths are an interface.** rig-c's `exports` map
  carries `./*.ts`, so `rig-c/tools/plate.ts` (PNG codec),
  `rig-c/src/png.ts`, `rig-c/tools/font5x7.ts` and
  `rig-c/src/transform.ts` are imported by path. The mesh functions come
  through the named entry `rig-c/mesh` (from 2.16.0): the outline
  functions `src/contour.ts` reuses, every one on the entry's promised list,
  and `reduceMesh` with its `mesh-quality-report/1` types (2.19.0), which
  `src/automesh.ts` calls, and `skinningEnvelopeBone` (2.30.0), which
  `src/autoenvelope.ts` calls. `f32` comes through the named entry
  `rig-c/compile` (2.40.0): the float32 rigc stores a bone's numbers as,
  which `src/rig.ts` poses the face bones through to measure the
  `invariants.axes` tolerance. `reduceMeshWith` and `rig-c/src/meshrasters.ts`
  are rig-c internals; only `tools/veto_tally.ts` reads them, to count the
  residual's vetoes, and it checks its run against `reduceMesh`'s bytes
  before it counts. A rig-c release that moves them, or narrows
  the map, breaks this package by name, and `bun run smoke` is where that
  shows first.
- **Raster ops state which call they stand in for.** Each function in
  `src/raster/` names the OpenCV / SciPy / PIL call whose semantics it
  reproduces and what was measured against it; a known deviation is written in
  the doc comment, not hidden.
- **Do not name a function `declare`.** Bun strips a statement `declare(...)`
  as a TypeScript ambient declaration while tsc accepts it as a call; `TY08`
  holds the tree to it.
- A new runtime import that crosses a directory must be inside `files` in
  `package.json`. `npm pack --dry-run` lists what ships; no document keeps that
  list by hand.
- Conventional Commits, English subject and body. Pushing, tagging and cutting
  a release are the sub-commander's call, delegated by the owner; the
  publishing credentials and npm trusted publishing stay the owner's.

## Working with the command post

This repository is commanded by one session at a time, and a command post (HQ)
issues its work. The protocol between them lived in chat and eroded every time
a session rotated — the reader rule above, measured on ourselves. So it is here.

- **One issue = one PR.** The issue is the order: decision, bars, what is out of
  scope. A message that changes an order is copied to the issue.
- **A feature PR is opened and reported, and merged only after HQ's sign.** A
  `release:` PR from release-please merges and cuts only after HQ's explicit
  "LGTM #NNN" naming the PR and its current head, quoted in the cut report;
  the sub-commander approves the release PR's awaiting CI run on that exact
  head only. A release PR is never armed: release-please rewrites its head on
  every push to main. Merge it manually with `--match-head-commit` naming the
  head signed by HQ. AI review runs at most once per PR, at HQ's request.
- **Never push to an armed PR** — one with auto-merge armed. Disable auto-merge
  first, push, and report the new head. HQ re-arms a **FEATURE PR** only;
  a release PR is never armed. A merge of main into the branch counts as a push.
- **A pull request that changes a shipped file is never titled `docs:`** —
  release-please hides that type, and the `ships` job in `ci.yml` refuses the
  landing. Use `fix:` or `feat:`.
- **The report**, sent when an issue lands or stops: ① the PR and its merge SHA
  ② a verification table — command, exit code, figures ③ every claim in the
  issue that was contradicted, with the measurement ④ what was rejected, with
  the reason ⑤ `STOP` and what blocks, when blocked.
- 🚨 **Figures and names in a report or a document come from
  `git diff origin/main...HEAD` and the run's own output, read in the same turn
  as the report** — never from the session's memory of the work. Compaction
  keeps an early scratch figure at the same weight as the final code, and that
  is the measured way a report comes to describe a branch that does not exist.
- **Artefacts for HQ go to the absolute path the card names, in the private
  workspace — never under a public tree.** `git status -s` runs before every
  report, and any tracked file touched is named in it.
- **No private names on a public surface** — issues, PRs, commits, code and
  docs carry no private corpus, character, game or consumer-project name and no
  local path. A card handed down for this repository is written to that line
  too.
- **A prose cap in a card applies to prose, not to tables.** A table is the
  measurement; cutting rows to meet a word count deletes evidence.

## Verification — run these before you call a unit finished

| Command | Checks |
| --- | --- |
| `bun run typecheck` | `tsc --noEmit` over the paths `tsconfig.json`'s `include` names |
| `bun run lint` | one rule: `@typescript-eslint/no-explicit-any` as an error |
| `bun run selftest` | every suite's positive and negative controls on generated fixtures, and the tree rules; `-- --corpus <dir>`, or fetched `examples/*/inputs` (`bun run fetch-examples`), adds the read-only corpus suite |
| `bun run selftest -- --only <suite>[,<suite>…]` | one squad's own suite while iterating — a partial run exits 2 when green (1 when red), prints `SKIP` for every suite it did not run and never the summary; the full run is the only verdict on the tree. Any other word on the command line is refused by name, exit 2, before a suite starts |
| `bun run smoke` | the **package** rather than the tree: pack, install into an empty directory, run `--version`, the installed `rigc --version` (the core entry), `layers` (wrapper and PSD), `sheet` and `check` on a generated rig from the install, with four planted broken packages that must go red. Needs a network |

## The selftest and its fixtures

`bun run selftest` is self-contained: no arguments, no art, no network, no
private repository. The rules that hold it together:

- **The run counts itself off the lines it prints.** Every suite is wrapped by
  `RunTally.of`; its figure is the number of `PASS`/`FAIL` case lines it
  printed, its own positive control included. Nothing is typed into the summary
  — `TY09` refuses a digit in the summary's text and a constant only the summary
  reads.
- **The floor is per suite.** A suite that ran and printed no case, a suite
  opening more or fewer than one section, a case line outside every suite, an
  unknown gutter word, a returned failure count that disagrees with the printed
  FAIL lines — each is a fault, and a run with a fault exits **2**. `RT01`–`RT05`
  plant each one.
- **Suites run in workers, and are printed and counted in order.** Each suite
  runs in a process of its own (`selftest.ts --suite-worker <key>`), several at
  once; the parent replays each one's lines through the same tally, in the
  `SUITES` order, so the case lines are a sequential run's. A suite therefore
  shares nothing with another at run time — no module state, no file outside
  its own temp directory. A worker that cannot account for its suite is that
  suite's `SUITE_CRASHED` FAIL (`RT06`); the suites tallied are held to
  `SUITES`, every one once and in order (`RT08`). Only `run-tally` runs in the
  parent, last, because it reads the live tally.
- **CI runs the suites in shards and merges them.** A suite that builds every
  public example (`SPLIT_SUITES`) splits into one unit per example and a
  closing unit; whole, it prints those blocks in the same order. CI's three
  shard jobs run the units `SHARDS` assigns (`--shard`), and the `test` job
  replays their records (`--merge`) through the same tally, so the merged
  stdout is a whole run's. Every unit is in exactly one shard (`RT09`), every
  unit is recorded exactly once (`RT10`), and a split suite's units replay end
  to end in order (`RT11`). A unit shares nothing with another unit either:
  one that needs another example's build builds it.
- **An absent input is a HOLE.** The corpus suite with neither a named corpus
  nor any fetched `examples/*/inputs` opens its section, prints `SKIP` and a HOLE line, counts as not run, and the summary
  names it.
- **No expectation is a number measured off private data.** Every expected
  value in a control is computed by hand from the fixture or from a definition
  (the Lanczos control evaluates the filter in float64); figures measured
  against the private corpus or against cv2/PIL appear only in `origin:` prose.
- **The tree population is read off the disk**, not off git: every file outside
  `.git` and `.gitignore`, so the rules hold before the first commit as well as
  after. `TY00` holds that walk to the tree, and refuses `.gitignore` syntax its
  small matcher does not implement.
