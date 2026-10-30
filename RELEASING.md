# Releasing

After the first publish, the cut is one click: merge the release pull request.
Everything either side of that click is
[`.github/workflows/release.yml`](.github/workflows/release.yml), and no npm
credential exists on any machine — the publish authenticates over OIDC (npm
trusted publishing). The first publish is the exception, and it is done by hand;
see *The first publish*.

## The loop

Every push to `main` runs `release.yml`, which hands the new commits to
[release-please](https://github.com/googleapis/release-please-action):

- **Nothing releasable since the last tag** → nothing happens. Types
  release-please hides (`docs`, `test`, `ci`, `build`, `chore`, `refactor`,
  `style`) do not open a release pull request on their own. **Visibility is what
  makes a type releasable**, which is why `release-please-config.json` writes
  the whole `changelog-sections` list out: the default node list plus `check` →
  *Instrument*, so instrument work on shipped sources gets its own changelog
  line. Overriding the array replaces the default, so dropping a row hides that
  type.
- **Something releasable** → it opens or updates a pull request titled
  `release: vX.Y.Z` with three generated changes: the `package.json` version,
  `CHANGELOG.md`, and `.release-please-manifest.json`. `feat` bumps the minor;
  `fix`, `perf` and `check` bump the patch; a breaking marker bumps the minor
  while the package is pre-1.0 (`bump-minor-pre-major`). To force a version,
  put `Release-As: X.Y.Z` in a commit footer.
- **That pull request is merged** → the merge is a push to `main`, so the
  workflow runs again: release-please tags `vX.Y.Z`, cuts the GitHub release,
  and the same run publishes.
  A version with a hyphen (`1.0.0-rc.1`) is a prerelease: prereleases go out under the `rc` dist-tag; promotion to `latest` is the owner's, by `npm dist-tag add`, never automatic (every publish step in `release.yml` reads the version and passes `--tag rc` only then, `AL07`).

Squash-merge the release pull request, so the commit on `main` keeps its
`release: vX.Y.Z` subject.

⚠️ **A shipped file can change under a hidden type.** The package is an
allowlist (`files`) plus what npm always adds — `package.json`, `README.md`,
`LICENSE` — so a `docs:` edit to the README changes what `npm install` hands
somebody while release-please is told to ignore it. The `ships` job in
[`ci.yml`](.github/workflows/ci.yml) compares what a pull request changed
against what `npm pack --dry-run` packs at both ends and refuses that landing;
its remedy is a visible type or a `Release-As:` footer in a commit message.
**The list of packed files is not written here**: ask `npm pack --dry-run`.

## One-time setup (owner, GitHub)

**Settings → Actions → General → Workflow permissions → tick "Allow GitHub
Actions to create and approve pull requests."** While it is off release-please
cannot open the release pull request at all. The repository lives in the `rig-c`
organisation, whose own Actions settings can hold the box unticked for every
repository in it; a transfer into the organisation is where it went off last.

`release-please-config.json` needs a `bootstrap-sha` — the commit release-please
stops reading history at on its first run — set once, to the commit that
introduces these files. It is deliberately absent from the file as first
written, because that commit does not exist until the file is committed; the
owner adds it in the commit after.

## The first publish, by hand

npm trusted publishing is configured on a package's settings page, and the page
does not exist until the package does. So the first version under a name goes up
by hand, from the tagged tree, and every version after it is the workflow's. That
was 0.1.0 under the package's first name and 1.0.0-rc.1 under `rig-parts`; under
`@rig-c/parts` it is the first version cut after the move to the scope (#222), with
that version's tag in place of `v0.1.0` below. A scoped name publishes only into a
scope that exists and that the publishing account belongs to, so the `rig-c`
organisation on npmjs.com comes first:

```sh
npm login                        # once per machine; `npm whoami` to check
git checkout v0.1.0              # the tagged tree
bun install --frozen-lockfile
npm publish                      # runs prepublishOnly, then asks for the OTP
```

`prepublishOnly` runs `bun run typecheck && bun run lint && bun run selftest`
before npm packs anything, so a tree that fails its own gates cannot be
published by the workflow or by hand. `publishConfig.access` already says
`public`. The aliases go out after it, from the same tree, as tarballs (*Three
names, one tree* below):

```sh
npm publish "$(bun scripts/alias_tarball.ts pack --name rig-parts --out ../alias)"
npm publish "$(bun scripts/alias_tarball.ts pack --name spine-parts --out ../alias)"
```

Confirm with `bun run smoke -- --source registry --version 0.1.0 --case clean
--alias rig-parts --alias spine-parts`.

A prerelease published by hand takes `--tag rc` on every `npm publish` command,
as the workflow's do; without it npm 12 refuses the publish and npm 10 puts the
prerelease on `latest`.

### Three names, one tree

Every version is published under three names: `@rig-c/parts`, the `name` in
`package.json`; `rig-parts`, its name from 1.0.0-rc.1 to 1.5.3;
and the alias `spine-parts`, the name the package shipped under up to 0.16.0.
The two aliases are kept so an install or a dependant that names one keeps
receiving every release. All three carry the same files; the one difference is
the `name` line of `package.json`.

- **Each alias is published from a tarball, after the tagged-tree gate, in the same
  job.** `release.yml` has one step per alias, *Publish the alias rig-parts* and
  the next, and each runs
  [`scripts/alias_tarball.ts`](scripts/alias_tarball.ts)` pack`, which packs the
  gated checkout into the runner's temp
  directory, rewrites the one `"name"` line of the extracted `package.json`,
  packs it again, and prints the path only after `compare` reads it as the
  package's files byte for byte but for that line. `npm publish <that tarball>`
  publishes it. The checkout is never modified.
- **No lifecycle script runs on an alias, by design.** `npm publish <tarball>`
  runs none, so `prepublishOnly` gates the canonical publish; recovery runs the
  same gates explicitly when that name is skipped.
  Another gated publish would need the package renamed in the checkout, and the
  gate would then pass a modified tree rather than the tagged commit; each alias
  is that commit's files, which is what the gate's verdict is about.
- **The names are written once for a program to read**: `ALIASES` in
  `scripts/alias_tarball.ts`. The selftest's `AL01` holds `release.yml`'s pack
  steps and both confirmation calls to it — one step per alias, every alias
  confirmed — and each alias publish to run after the gated one in the same
  job, from the tarball its pack step printed.

#### The alias stays until its retirement questions have written answers

Each alias is kept for as long as links from outside this repository point at
it — the npm page, forum threads, articles, badges other READMEs copied. It
**never gets its own version**: every version goes out under every name from
the one gated tree, and no version goes out under the alias alone. Retiring it — deprecating it,
un-publishing it, or letting the name fall behind the package's version line —
is not a release step and not a convention; it is a separate card, which opens
only after three things are written down:

1. **npm history** — what is lost when the alias stops: download history, the
   package page, the provenance links of every version published under it.
2. **External links** — an inventory of what points at the alias name, and
   where each one resolves after the rename and after a retirement (GitHub
   redirects the repository URL; nothing but the alias covers the npm page).
3. **What the alias says** — one sentence in the README naming the package's
   current name (*Requirements*; the alias carries the same README). No
   `npm deprecate`: a banner on every install is a retirement wearing an
   alias's name.

The same policy holds for every package of the toolchain: `@rig-c/core` with
`rig-c` kept as an alias (the earlier unscoped rename was at 2.20.4; its former name is spelled only in `CHANGELOG.md`, `TY11`),
`@rig-c/parts` with `rig-parts` and the alias `spine-parts` beside it, and
`spine-html` → `rig-play` (npm `@rig-c/play`).

Confirm a cut by hand: `npm view @rig-c/parts version`, `npm view rig-parts version`
and `npm view spine-parts version`
print the same version (they read `latest`; a prerelease shows under `rc` in `npm view @rig-c/parts dist-tags` and each alias's own), and the smoke's `--alias` flags compare each alias's tarball with the package's as the
registry serves them.

### The registry side (owner, npmjs.com), after the first publish

One trusted-publisher form per name — npmjs.com → **@rig-c/parts** → **Settings** →
**Trusted Publisher** → *GitHub Actions*, and the same under `rig-parts` and under
the alias `spine-parts` — all three pinned to the same workflow, with the same fields:

- Organization or user: `rig-c`
- Repository: `parts`
- Workflow filename: `release.yml`
- Environment name: *blank* (the workflow declares none)
- Allowed actions: `npm publish`

The fields are case-sensitive and npm does not validate them on save, so a typo
surfaces only as a failed publish. Then **Settings → Publishing access →
Require two-factor authentication and disallow tokens**: trusted publishing
presents no token, so it costs the automation nothing, and it closes the
unattended path.

A form is matched against the repository name and the workflow filename the
run's OIDC token carries, so a form saved before the repository was renamed or
moved names the old repository; read every form after a move. Provenance names
the repository too: `repository.url` in `package.json` has to be the repository
the workflow runs in. Until a name's form matches, its publish is refused, and
because the alias steps run after the package's publish, a refused package
publish stops the cut before the aliases.

Two properties of that configuration are load-bearing in the workflow:

- Every publish step must live in **`release.yml`**. Renaming the file, or moving
  any publish into another workflow, breaks that name's trusted publisher until
  its form is updated to match.
- It must run on a **GitHub-hosted runner**. npm does not support trusted
  publishing from self-hosted runners.

`publishConfig.provenance` is deliberately not set: provenance can only be
attested from a run holding an OIDC token, so setting it would fail the manual
publish. The workflow passes `--provenance` on the command line instead.

## Cutting a release

1. Land the work on `main` with conventional-commit subjects.
2. Wait for the `release` run to open or update the `release: vX.Y.Z` pull
   request, and read its diff — the version and the changelog are the review.
3. **Approve its `ci` run.** A `pull_request` run started by `GITHUB_TOKEN`
   lands in `action_required`, so the required check reads as blocked until a
   human approves it (**Approve and run** in the Actions tab, or `gh api -X POST
   repos/rig-c/parts/actions/runs/<id>/approve`). A `workflow_dispatch`
   run on the same commit does not satisfy a required check: it is matched by
   the run that reported it, not by the SHA.
4. **Merge it.** That is the cut.
5. Watch the second `release` run: it tags, releases, publishes under all three
   names, and then confirms the published package installs and runs and that each
   alias carries its files, waiting up to 15 minutes for `@rig-c/parts` and up
   to 15 minutes per alias for both packument and tarball (on `1.60.2`, workflow
   run `40021159671`, `@rig-c/parts@1.60.2` was served after `3m 09s` at
   `21:07:48Z` and `rig-parts@1.60.2`'s packument answered `2m 26s` later at
   `21:10:14Z` — `2m 08s` into the alias poll, registry `time` `21:09:40.809Z` vs
   `21:07:33.120Z` — while its tarball was still propagating behind the
   packument).

## Republishing a cut whose publish failed

a release-please failure after the tag leaves a version unpublished; the next cut carries it, or the tag is republished by dispatch.

It happens when the run that merged the release pull request gets as far as
the tag and the GitHub release and then stops before the publish lands: once
when release-please itself failed on a transient GitHub API error while
updating the next pull request, after cutting the release; once, on another
package of the toolchain, when `npm publish --provenance` failed on a transient
signing-service error. Re-running that run cannot recover either: release-please
no longer reports `release_created` for a tag it has already cut, so every step
after it is skipped and the registry keeps serving the previous version. A
publish by hand would lose provenance, and the trusted publisher names
`release.yml`.

A push re-run can cut a tag at a newer commit than its `GITHUB_SHA`. Before
publishing, the workflow resolves the full tag ref through the commits API,
requires a full commit SHA, and compares it with `GITHUB_SHA`. A mismatch
refuses `PROVENANCE_SHA_MISMATCH`, names both SHAs, and leaves the tag cut.
A normal matching push checks out the verified SHA. A dispatch likewise
requires `GITHUB_REF` to equal `refs/tags/<tag>` (`RELEASE_DISPATCH_REF`),
resolves that explicit tag ref to a full commit SHA, and requires the run SHA
to match before any registry plan or publish. Both paths check out the verified
SHA; a run/tag mismatch is refused, and checkout does not resolve the mutable
tag again.

The tag is published by a dispatch of the same workflow at the tag ref, so
provenance names the tag commit:

```sh
gh workflow run release.yml --ref vX.Y.Z -f tag=vX.Y.Z
```

The `release` job then skips release-please — a dispatch never cuts a tag or a
release — and its *Resolve the tag to publish* step checks the tag; every step
after it is the push path's own (checkout of the tag, the gate in
`prepublishOnly`, publishing only registry-missing names, the registry
confirmation), run under the same condition, from the same file. The resolve
step refuses, each as one `::error::` line naming its rule:

| refusal | when |
| --- | --- |
| `RELEASE_DISPATCH_INPUT` | the dispatch gave both `tag` and `version`, or neither |
| `RELEASE_DISPATCH_REF` | the workflow run ref is not exactly `refs/tags/<tag>`; `main`, another tag and a same-named branch cannot publish the input tag |
| `RELEASE_TAG_UNRESOLVED` | the explicit tag ref cannot be resolved to a full commit SHA |
| `PROVENANCE_SHA_MISMATCH` | the run SHA differs from the resolved tag commit; the tag remains cut |
| `RELEASE_TAG_FORM` | the tag is not `vX.Y.Z` (or `vX.Y.Z-<prerelease>`) |
| `RELEASE_TAG_UNRELEASED` | the tag has no GitHub release: only a tag release-please cut is published |
| `RELEASE_ALREADY_PUBLISHED` | the registry already serves that version under all three names; nothing is missing |
| `RELEASE_REGISTRY_QUERY` | a registry lookup fails without a structured npm `E404`, returns malformed data, or serves a different version than requested |
| `RELEASE_TAG_BELOW_LATEST` | the version is below the registry's `latest` for `@rig-c/parts` (a prerelease is below its release) |

**Two inputs, one per dispatch.** `tag` publishes a cut tag; `version` re-runs
a confirmation (*Whether the tarball runs*). Both are optional, because GitHub
refuses a dispatch that omits a required input; an omitted string input reads
as empty. The `confirm` job runs only on a dispatch with `version` and no `tag`;
any other dispatch runs the `release` job, where the resolve step publishes a
`tag` alone and refuses the rest.

**Half-published.** A failure between publish steps can leave a version up
under some names and missing under others. The tag resolver queries the exact
version under all three names and records a snapshot publish flag for each; it refuses
`RELEASE_ALREADY_PUBLISHED` only when every name serves it. Each publish step
skips a name served in that snapshot before packing or publishing, so a missing alias can
be recovered without republishing `@rig-c/parts`. With no names served, all
three publish as on a fresh cut. This is a resolver-time snapshot, not a
concurrent external publisher guarantee. The final confirmation still checks
all three.

Only a failed registry query carrying npm's structured `E404` means absent.
Transport and authentication failures, malformed responses and a successful
query returning another version refuse `RELEASE_REGISTRY_QUERY`; they never
become permission to publish. The `latest` lookup uses the same rule. When the
canonical name is skipped, its step explicitly runs `bun run typecheck && bun
run lint && bun run selftest` on the tagged checkout before any missing alias
is packed: skipping `npm publish` must not skip its `prepublishOnly` gates.

**The workflow is at the tag.** Dispatch uses the `release.yml` stored at the
selected tag, not the current file on `main`. Partial recovery is available
only for tags containing this registry plan and skip logic. The immutable
`v1.84.0` workflow still refuses once `@rig-c/parts` is served, so it cannot
recover its missing alias under this contract. Landing this change does not
repair that old tag. Do not move a tag or dispatch `main` to backfill it; an
older workflow needs a separate authorized recovery route, or the next cut.

**Below latest.** `npm publish` refuses to put `latest` on a version lower than
the highest one published unless a `--tag` is given (read in the publish
command of npm 12.2.0, the version `npm@latest` installs at this writing), and
the publish steps pass `--tag` only for a prerelease. So once a later version
is cut, the dispatch refuses the older tag by name, `RELEASE_TAG_BELOW_LATEST`,
naming the tag and the `latest` served, before anything is checked out or
published; it is never attempted silently. Such a version goes out, if at all,
under a dist-tag, with a `--tag` variant of this dispatch, which is a
follow-up and not in this workflow. The comparison is semver order computed in
`node` (a prerelease below its release), not `sort -V`, which sorts
`1.0.0-rc.1` after `1.0.0`.

## Whether the tarball runs

What the package *holds* and whether it *works* are two facts. **The gate is
the `installs` job in `ci.yml`**, on every pull request and push to `main`, and
the *Gate parts output through `@rig-c/play`* step (`bun run smoke -- --case clean`)
in `release.yml` before `npm publish`: it
runs `bun run smoke` ([`scripts/install_smoke.ts`](scripts/install_smoke.ts)),
which packs a tarball from the branch, installs it into an empty directory,
generates a fixture with the INSTALLED package's own codec and PSD writer, and
runs `--version`, the installed `rigc --version` (which must name the core
entry), `layers` on a wrapper directory and on a PSD, `sheet`, `check` on a
generated two-part rig from the install, and `build --all-sets` loaded through a
fresh install of `@rig-c/play` (`--play-version <ver>`, default `latest`,
`SMOKE_PLAY_LOADS_THE_BUILD`, issue #741). Four packages are broken on purpose —
`src/layers.ts` out of the pack, `@rig-c/core` out of `dependencies`, `ag-psd`
out of `dependencies`, `@esotericsoftware/spine-core` added to `dependencies` —
each patched into an extraction of the tarball, never the checkout; a plant case
is green only when the smoke went red at the step it names, naming what went
missing. A correct package installed at a path with spaces and non-ASCII in it
must pass too.

⚖️ **The registry half is a confirmation, not the gate**: the last step of
`release.yml` runs the same script with `--source registry --alias rig-parts
--alias spine-parts` after every publish. It is not the gate because its own firing cannot be
observed without publishing something broken. Each `--alias` waits up to its own
`--wait` (15 minutes, for both packument and tarball) for the same version under
that alias and holds its unpacked files to the package's with
`scripts/alias_tarball.ts compare`, rather than installing it a second time,
reporting which package it is waiting for and for how long. Its exits:

| exit | what it means | what to do |
| --- | --- | --- |
| `0` | the published package installs and runs, and every alias carries its files | nothing |
| `1` | the registry served it and a case went red on it, or an alias differs beyond its name | read the named fault; the cut needs a follow-up |
| `2` | no case ran | a broken invocation, not a verdict |
| `3` | the registry did not serve `@rig-c/parts` inside `--wait` — the confirmation was NOT taken | re-run it: Actions → release → Run workflow, with the version |
| `4` | `@rig-c/parts` installed and passed, and an alias was still not served inside its own `--wait` (`WAIT`, naming the alias and its wait) | re-run it once the registry serves the alias: Actions → release → Run workflow, with the version |

A dispatch with `version` runs the `confirm` job only, so a re-run cannot
publish or re-cut anything; release-please, which makes the tag and the
release, runs only on a push (`gh workflow run release.yml -f version=X.Y.Z`).
