# Interface stability

This page states what **1.0.0 holds stable**, and what it does not. Every item is
read off the tree: the command and flag lists below are held to
`cli.ts`, and the config field list to the loader in `src/config.ts`, by the
selftest's `TY13` and `TY14` (the `tree` suite), so neither list can drift from the
code without a red run. What changed for an author coming from 0.16.0 is
[MIGRATION.md](MIGRATION.md).

## What "stable" means here

From 1.0.0 the package follows semantic versioning over the items on this page. A
stable item is not removed, renamed, or given another meaning inside a major
version; a new command, flag, optional config field, report key or refusal may
arrive in a minor version, because a reader written against the old surface still
reads it. A refusal may be retired in a minor version when what it refused becomes
accepted (0.13.0 retired two ik refusals that way, when rig-c's parser took them
over).

The list was frozen for review at the release candidate 1.0.0-rc.1, and 1.0.0 was
promoted from it after the owner's acceptance of the production evidence (issue #126,
item 7; `docs/evidence/production-trial.md` in the repository). Every interface
change between the two is additive, and [MIGRATION.md](MIGRATION.md)'s *Since
1.0.0-rc.1* names each one, with the build bytes that moved.

Bytes are a separate promise, and a narrower one: **one version of this package
with one installed rig-c writes the same bytes for the same inputs** (*Determinism*
below). A build's bytes are not promised across versions. A later version may move
them, and when it does, the change that moves them declares which bytes and why (the
winding change of #133 is the example: [MIGRATION.md](MIGRATION.md)).

## Provider-map input identity

Issue #1284 adds optional parts-owned `<map>.binding.json` receipts, spec
`rig-parts-depth-map-binding/1`, with exactly `spec`, `part`, `mapSha256` and
`inputSha256`. The SHA-256 values are lowercase 64-digit hexadecimal hashes of
the numeric map file and its consumed prepared inference PNG. A present receipt
must match the selected part, current map bytes and manifest `inputSha256`;
otherwise `DEPTH_MAP_BINDING` refuses before any output write. A malformed present
receipt also refuses; symlinked receipts (including dangling links) are refused.
The depth recipe and prepare manifest are unchanged.

Compatibility policy dated **2026-11-16**: an absent receipt retains the shipped
map behavior, output bytes and success exit, adding one stderr WARN named
`DEPTH_MAP_BINDING_ABSENT` per selected map. Absence does not establish provenance.
This follows the stable-item meaning promise above: existing maps remain accepted
inside the major version. A matching receipt changes no output bytes or report
keys. Preparing fresh inputs does not create or update a map receipt. Call `depth-bind` when inference produces the map: it computes both hashes and
exclusively writes the receipt beside the map, refusing to overwrite evidence.
It binds the files at invocation and cannot prove that inference used that input.
See
[Per-part provider maps](AUTHORING.md#per-part-provider-maps-897).

## Parts-stage integrity report

`rig-parts check-parts --parts <assembled-dir> --out <disjoint-report-dir>
[--json]` writes `parts-check.json`, spec `rig-parts-parts-check/1`.
Exit 0 records input integrity. Plate ghost, plate structure, plate smear,
stepped fill and invented-material exposure always report HOLEs.
`PARTS_INVENTED_MATERIAL` reports a measurement for each primary or alternate
part with a validated `source_visibility` block from assembly. The measurement
describes visibility within the producing See-through run. Painted-versus-
invented material remains unknown. When only some parts have a measurement,
the report keeps those rows and emits one material HOLE whose reason gives the
count and names every unmeasured part and its primary or alternate set.
When every part has a measurement, there is no material HOLE. When neither
the primary set nor any alternate has a measurement, the existing material
HOLE remains and both the JSON report and command output keep their legacy bytes.
`PARTS_DRAW_ORDER_INVERTED` reports one measurement for each recorded pair of
overlapping parts, from the carrying part's `source_overlaps`. It counts the
pixels where the record shows the part drawn behind and hides the part drawn in
front. It is never a pass, and a part set with no record has no such row.
The optional `native_samples` block in an overlap row and its corresponding
`check-parts` measurement has `overlap_px` then `inverted_px`, in native
full-run samples (issue #1477). It covers directly attributable material at a
non-unit registration scale. It does not enter the output-pixel partition or
change `source_layers`. See the
[sample coverage rules](AUTHORING.md#draw-order-inversions-source_overlaps-issue-1474).

The top-level key order is `spec`, `stage`, `inputs`, `parts`, `refusals`,
`reported`, `holes`, `exit_code`. `stage` is `parts`. `inputs` is sorted by
relative POSIX path. Each row has `path`, `status`, `sha256`, in that order.
Status is `read`, `missing`, `unreadable` or optional `absent`; SHA-256 is null
unless the file was read. The inventory binds regular files under `--parts`,
including primary and alternate PNGs, declared depth images, `parts.json`,
`painting_in_rig.png` and present source-cover/allocation reports. Missing
required references are explicit inventory rows. Symlinks and special files
are refused. Inputs are hashed again before atomic publication.

Base and alternate `scene.figure_mask` are declared but not consumed, read,
hashed or bound by this command. Standalone `assemble` on a scene painting writes
the figure's mask `figure_rig.png` beside `parts.json` (issue #1177). The plate is outside this
command's inputs. `painting_in_rig` is written beside `parts.json` in both
standalone assemble and build layouts and is consumed and hash-checked.

`parts` preserves primary names, alternate records, the source-cover inventory
and allocation reports. Embedded object keys are sorted, and producer array
order is retained. `refusals` rows have `code`, `object`, `found`, `required`,
`detail`; reused metadata-reader diagnostics retain their code and detail with
null structured values when the reader supplies none. A refused input produces
a report and exit 1. `PARTS_UNPLANNED_SOURCE_COVER` rows in `reported` have
`code`, `set`, `part`, `source`, `count`, `spans`. Unplanned direct cover is
reported without a refusal. `PARTS_INVENTED_MATERIAL` rows follow the cover
rows, with primary parts first and alternate records in manifest order.
They have `code`, `set`, `part`, `occluded_px`, `undecided_px` in that order.
`set` is null for a primary part and the set name for an alternate.
`undecided_px` gives counts for `partial-top`, `depth-tie`, and
`mixed-source-states` in that order. `PARTS_DRAW_ORDER_INVERTED` rows follow
the material rows in the same set order, with each part's overlaps in draw
order. They have `code`, `set`, `part`, `front`, `source_layers`,
`overlap_px`, `inverted_px`, `agreeing_px`, `unordered_px`, `undecided_px`,
`unrecorded_px` in that order. `part` is drawn behind `front` in that set's
draw order: `parts.json` order for the primary set, and for an alternate the
base order with each front-slot part after its slot's target. `holes` rows have
`code`, `object`, `reason`, `line`. Absent source cover or allocation adds its
own HOLE; malformed present reports are refused. A HOLE carries no measured zero.

Bad arguments (exit 2), overlapping output, changing inputs, internal exceptions
and publication failures (exit 1) produce no new report. After parsing `--out`
and checking overlap, the command removes exactly `parts-check.json` and
`parts-check.json.tmp` there before reading inputs. Failed input reads cannot
leave an earlier success report. Bad arguments that prevent resolving `--out`
cannot remove a prior report. The CLI resolves an existing `--parts` root to its
real path before reading, including a symlinked root. Consumers bind the report
and current input hashes and read its `exit_code`. A sibling temporary file is
exclusively created, cleaned up after a failed write, then renamed into place.
Identical inputs produce identical report bytes on repeat
runs and under output roots with different parents.

The diagnostic code vocabulary below is closed for `rig-parts-parts-check/1`,
including reused reader and invocation codes. Adding a code requires a new spec
version. The generated controls derive literals from `src/parts.ts`,
`src/takesource.ts`, `src/depthsheets.ts`, `src/setfocus.ts` and `src/partscheck.ts`,
compare this list with the command's allowlist, and plant an undeclared code.

<!-- parts-check:codes -->
- `CONFIG_SET_FOCUS`
- `PARTS_ALT_BASE_ANCHOR`
- `PARTS_ALT_TIPS`
- `PARTS_ALT_TIPS_SOURCE`
- `PARTS_BOX_INSIDE_RIG`
- `PARTS_CHECK_INPUT_CHANGED`
- `PARTS_CHECK_INPUT_READ`
- `PARTS_CHECK_INTERNAL`
- `PARTS_CHECK_OUTPUT`
- `PARTS_CHECK_PNG_READ`
- `PARTS_CHECK_PUBLISH`
- `PARTS_CHECK_REPORT`
- `PARTS_COUNTS_ADD_UP`
- `PARTS_CUT_FROM_KNOWN`
- `PARTS_DEPTH_REFERENCE`
- `PARTS_DRAW_ORDER_INVERTED`
- `PARTS_FIELD_PRESENT`
- `PARTS_FIELD_TYPE`
- `PARTS_FILE_PRESENT`
- `PARTS_FROM_KNOWN`
- `PARTS_HOLES_LARGEST_FIRST`
- `PARTS_HOLE_PART_KNOWN`
- `PARTS_HYBRID_PAIR`
- `PARTS_INVENTED_EXPOSURE`
- `PARTS_INVENTED_MATERIAL`
- `PARTS_IS_JSON`
- `PARTS_KEY_KNOWN`
- `PARTS_MOTION_SEAM`
- `PARTS_NAME_UNIQUE`
- `PARTS_PAINTING_ALLOCATION`
- `PARTS_PAINTING_OPAQUE`
- `PARTS_PAINTING_PNG`
- `PARTS_PAINTING_PRESENT`
- `PARTS_PAINTING_SHA256`
- `PARTS_PAINTING_SIZE`
- `PARTS_PLATE_GHOST`
- `PARTS_PLATE_SMEAR`
- `PARTS_PLATE_STEPS`
- `PARTS_PLATE_STRUCTURE`
- `PARTS_SINGLE_RUN_PAD`
- `PARTS_SOURCE_COVER`
- `PARTS_TAKEN_LAYERS`
- `PARTS_UNPLANNED_SOURCE_COVER`
- `PROPOSE_PNG_MATCHES_BOX`
- `USAGE`
<!-- /parts-check:codes -->

## Programmatic mesh edit acts

`@rig-c/parts/src/remesh-api.ts` is a public Bun/TypeScript import path for
`applyMeshEditAct(input: ApplyMeshEditActInput): RemeshResult` (issue #1159).
`applyMeshEditAct` is the sole runtime export from this entry. The two
type-only exports are `ApplyMeshEditActInput` and `RemeshResult`. Other
`src/` paths and names outside the interfaces documented on this page are
unpromised.

### ApplyMeshEditActInput

| Field | Type | Meaning |
| --- | --- | --- |
| `rig` | `string` | Path to the current rig revision directory, with `rig.json`, `motion.json`, `mesh_report.json` and `images/`. |
| `config` | `string` | Path to the config used to build the input rig. |
| `parts` | `string` | Path to the assembled directory containing `parts.json` and `parts/` used for the input rig. |
| `part` | `string` | Target part name. The slot and attachment both use this name in the default skin. |
| `out` | `string` | Destination for a new revision. When applying a new edit, the directory must not exist and must be outside `rig`. |
| `edit` | Object with the fields below | One in-memory value from the finalized act's `value.meshEdits[].edit`. |
| `actId` | `string` | Finalized act's identity. It must contain a non-whitespace character. |
| `actSourceHash` | `string` | Finalized act's `source.sourceHash`, as 64 lowercase hex digits. |
| `payloadSha256` | `string` | The selected mesh edit's `sha256`, as 64 lowercase hex digits. It must match the digest of the canonical `edit` payload. |

Use `ApplyMeshEditActInput['edit']` to annotate an edit value.

| Edit field | Type | Meaning |
| --- | --- | --- |
| `slot`, `skin`, `attachment` | `string` each | Non-empty names identifying the edited attachment in the model. |
| `basis` | `"setup"` | The undeformed setup pose. |
| `source.vertexCount`, `source.triangleCount`, `source.hullLength` | `number` each | Non-negative safe-integer counts from the source attachment. |
| `source.hash` | `string` | Lowercase SHA-256 of the UTF-8 `JSON.stringify` of the parsed attachment entry in the input's gated `skeleton.model.json`, with stored key order. |
| `source.frame` | `{ width: number; height: number }` | Positive finite dimensions of the rig canvas in crop pixels. |
| `source.positions` | `[number, number][]` | Dense array of unrounded setup positions in vertex order, one per source vertex, in crop pixels (x right, y down). |
| `ops` | `MeshEditOp[]` | Ordered list of 1 to 300 operations. |

Each operation is one of the following shapes. Vertex indices are non-negative
safe integers and coordinate pairs are finite. `from` is unrounded, while
`to` and `at` are recorded to 0.01 px.

```ts
type MeshEditOp =
  | { op: 'move'; v: number; from: [number, number]; to: [number, number] }
  | { op: 'add'; at: [number, number]; onEdge?: [number, number] }
  | { op: 'remove'; v: number }
  | { op: 'edge'; a: number; b: number }
  | { op: 'unedge'; a: number; b: number };
```

The payload digest is SHA-256 over the UTF-8 bytes of compact JSON. Sort
object keys at every level by UTF-16 code units and preserve array order.
Serialize strings with JSON escaping and numbers with ECMAScript number
formatting. The signed edit domain excludes integer-like keys, negative zero
and non-finite numbers. [Signed mesh-edit contract](https://github.com/rig-c/review/issues/952#issuecomment-7001413869)

### RemeshResult

| Field | Type | Meaning |
| --- | --- | --- |
| `provenance` | `RemeshProvenance` | The `rig-parts-remesh/1` record of the revision, as stored in `remesh.json`. |
| `written` | `string[]` | Paths written by the call, relative to the new revision directory, including `remesh.json`. An exact replay returns `[]`. |

The API uses the [remesh revision record](#files-this-package-writes)
with the following `request` variant.

| Request field | Type | Meaning |
| --- | --- | --- |
| `part` | `string` | Target part. |
| `edit` | `ApplyMeshEditActInput['edit']` | Mesh edit value supplied by the caller. |
| `act_id`, `act_source_hash`, `payload_sha256` | `string` each | Act identity, act source hash and canonical payload digest. |
| `ops` | `number` | Number of operations replayed. |
| `applied` | `{ moved: number; added: number; removed: number; constrained: number }` | Counts of moves, additions, removals and edit constraints still present after replay. |
| `idle_keys` | `"ctl" \| "direct"` | Idle key routing used for the build. |
| `page_edges` | `"pot" \| "free"` | Page edge mode used by the gate. |
| `pack_shape` | `"rect" \| "polygon"` | Packing shape used by the gate. |

### Refusals

Named refusals throw a `PartsError`. Its read-only `problems` array contains
`{ code: string; object: string; detail: string }` entries. The entries name
the rule, affected object and details of the refusal. The error message joins
the rendered entries with newlines. Each entry renders as
`<code>: <object> — <detail>`. Consumers branch on `code` and `object` and
display `detail`, which carries the found and required values.

The remesh stage's existing refusal catalog covers
[`REMESH_OUT_FRESH`](AUTHORING.md#REMESH_OUT_FRESH),
[`REMESH_INPUT_PRESENT`](AUTHORING.md#REMESH_INPUT_PRESENT),
[`REMESH_INPUT_WRITTEN`](AUTHORING.md#REMESH_INPUT_WRITTEN),
[`REMESH_TARGET_MESH`](AUTHORING.md#REMESH_TARGET_MESH),
[`REMESH_TARGET_CLOSED`](AUTHORING.md#REMESH_TARGET_CLOSED),
[`REMESH_RIGC_GREEN`](AUTHORING.md#REMESH_RIGC_GREEN),
[`REMESH_PRESERVED`](AUTHORING.md#REMESH_PRESERVED) and
[`REMESH_CHECK_HELD`](AUTHORING.md#REMESH_CHECK_HELD).
Setup frame evaluation uses [`REMESH_BONE_ORDER`](AUTHORING.md#REMESH_BONE_ORDER)
and [`REMESH_BONES_POSED`](AUTHORING.md#REMESH_BONES_POSED).

| Code | Object | Found and required values |
| --- | --- | --- |
| [`REMESH_DELTA_ACT`](AUTHORING.md#REMESH_DELTA_ACT) | `actId` or `actSourceHash` | The requirement is a non-empty finalized act ID or a finalized act source hash of 64 lowercase hex digits, respectively. |
| [`REMESH_DELTA_ACT`](AUTHORING.md#REMESH_DELTA_ACT) | Path to the matching provenance record | A binding conflict reports the recorded and received act source hashes and payload digests. A recorded edit that fails validation or hashes differently names the act, part and required digest. |
| [`REMESH_DELTA_ACT`](AUTHORING.md#REMESH_DELTA_ACT) | Path to the unbound provenance record | Identifies the recorded act and part and reports that its revision hashes do not bind the current rig files. |
| [`REMESH_DELTA_ACT_SUPERSEDED`](AUTHORING.md#REMESH_DELTA_ACT_SUPERSEDED) | Path to the provenance record that binds the current revision | Names the act, part and earlier provenance path. Replaying that edit requires the earlier revision as input. |
| [`REMESH_DELTA_DIGEST`](AUTHORING.md#REMESH_DELTA_DIGEST) | `payloadSha256` | The required format is 64 lowercase hex digits. A digest mismatch reports the supplied and recomputed digests. |
| [`REMESH_DELTA_JSON`](AUTHORING.md#REMESH_DELTA_JSON) | Edit, attachment identity, `source`, `source.frame`, or `source.positions` and its first malformed position | The edit must have the declared object and field shapes. Field mismatches identify the offending keys or values and the required shape. An invalid edit container or position array reports the required container. |
| [`REMESH_DELTA_BASIS`](AUTHORING.md#REMESH_DELTA_BASIS) | `edit basis` | The supplied basis and required `"setup"`. |
| [`REMESH_DELTA_OPS`](AUTHORING.md#REMESH_DELTA_OPS) | `edit ops` | The supplied value or length and the required dense array of 1 to 300 operations. A sparse array reports the density requirement. |
| [`REMESH_DELTA_OP`](AUTHORING.md#REMESH_DELTA_OP) | `edit ops[i]` | The offending operation and the required shape or replay condition. Replay stops at the first operation that cannot apply. A move names its recorded `from` and live position when the two differ by more than the 0.001 px tolerance. |
| [`REMESH_DELTA_SOURCE`](AUTHORING.md#REMESH_DELTA_SOURCE) | `edit slot`, `edit attachment`, `edit skin` or one of the `edit source` count fields | The recorded identity or count and the required part, default skin or input attachment count. |
| [`REMESH_DELTA_SOURCE`](AUTHORING.md#REMESH_DELTA_SOURCE) | `edit source.hash` or `edit source.frame` | For a hash mismatch, the recorded and input model attachment hash prefixes, or a notice that the attachment entry is absent. For a frame mismatch, the recorded dimensions and both required frames from the rig and the parts manifest. |
| [`REMESH_DELTA_SOURCE`](AUTHORING.md#REMESH_DELTA_SOURCE) | `edit source.positions` or `edit source.positions[i]` | The recorded position count and declared vertex count, or the first mismatching vertex with its recorded and required coordinates. The tolerance is 0.001 px on each coordinate. |
| [`REMESH_DELTA_TOPOLOGY`](AUTHORING.md#REMESH_DELTA_TOPOLOGY) | Input triangle or replayed attachment | The observed topology and the required winding, outline or Delaunay condition. |
| [`CHECK_RIGC_PRESENT`](AUTHORING.md#CHECK_RIGC_PRESENT) | `` the rig-c CLI `rigc` `` | No `rigc` was found in the ancestor `node_modules/.bin` directories or on `PATH`. Applying a new edit requires the rig-c CLI. |

### Replay

Parts identifies an edit by `(actId, part)`. The default skin and the part's
slot and attachment names fix the target identity. The act source hash and
payload digest bind that key.

- **Exact replay.** When the current provenance matches the key, binds the
  current rig files by hash, and holds the same source hash and payload digest,
  the API returns its stored provenance and `written: []`. The recorded and
  submitted edits must validate and hash to that digest. The call leaves the
  current revision byte for byte as it was and creates no output directory.
- **Binding conflict.** A known key with a changed `actSourceHash` or
  `payloadSha256` refuses `REMESH_DELTA_ACT` even if the key was recorded on
  an earlier revision. A record whose stored edit is invalid or fails its
  digest also refuses `REMESH_DELTA_ACT`. If the supplied digest agrees with
  the record but the submitted edit hashes differently, the refusal is
  `REMESH_DELTA_DIGEST`.
- **Superseded revision.** The same key, act source hash and validated edit
  digest in a hash-bound ancestor refuse `REMESH_DELTA_ACT_SUPERSEDED`. The
  refusal's `object` is the path to the record that binds the current revision.
- **Unbound record.** A matching root record whose hashes fail to bind the
  current tree refuses `REMESH_DELTA_ACT` when no root record binds it.
- **New key.** The API validates the canonical payload digest and the source
  attachment, counts, frame and positions against the input. It refuses stale
  source evidence before any edit operation or output write. After a valid
  edit passes the remesh gate, it writes a fresh revision with the act binding
  in `remesh.json`.

The CLI's `--delta` flag remains supported as the legacy file-based path.
[Apply a mesh edit act in Bun](AUTHORING.md#apply-a-mesh-edit-act-in-bun)

## Programmatic config file references

`@rig-c/parts/src/config.ts` exports `configFileReferences(raw: unknown):
ConfigFileReference[]` and the `ConfigFileReference` type (issue #1134).
Each reference has `at: string` (a dotted config field), `value: string`
(the declared path), and `set(value: string): void`, which changes that field
on the supplied object. Enumeration itself does not mutate, validate, read files,
or resolve paths. Empty and non-string values are omitted; invalid fields remain
for the loader to diagnose. Built-in control skeleton names are excluded.
Declared references are `requirements`, `motion.animations_from`, non-built-in
`generation.control.skeleton`, each `assemble.occluders[i].image` and optional
`plate`, then each `assemble.edited_parts.receipts[i].file` (issue #1281).
An edited receipt's `value` is `posix.join(dir, file)`, relative to the config;
there is no `edited_parts.dir` reference. Its `set(next)` takes a config-relative
path and derives `file` from normalized POSIX segments without resolving either
operand against the process cwd. If the target is representable under the current
`dir`, that directory and every sibling receipt remain byte-for-byte unchanged.
Otherwise, `dir` becomes its normalized lexical common prefix with the target
(`.` for an empty prefix), and sibling files are rewritten to preserve their
original config-relative targets. Setters read the live directory, including
after another setter from the same enumeration rebases it. Invalid directories
and invalid sibling fields remain for the existing loader diagnostics.
Absolute targets, including Windows absolute forms, remain absolute in `file`
and are refused by the existing `CONFIG_FIELD_TYPE` check at the next load.
When relocating a config, resolve each source value, then pass its path relative
to the destination config directory for edited receipts. Other setters retain
their existing path contract. Enumeration follows the loader and assemble reader
declarations; it adds no file reads or validation. Existing deep package paths
remain available.

The same subpath exports `checkFileReferences(raw: unknown, configFile: string,
requirements?: RequirementsFile): CheckFileReference[]` and the
`CheckFileReference` type (issue #1138). `requirements` is the value returned by
`readRequirements` from `@rig-c/parts/src/requirements.ts`. The result lists every
file `check` reads from a config and its requirements. Each row has `at: string`
(the dotted field) and `value: string` (the path relative to the config's
directory). Rows come in this order: the `configFileReferences` rows, then
`requirements.setup_painting.figure_mask.path` and
`requirements.setup_painting.backdrop.path` when they are declared. Setup images
resolve through the same code the check's readers use. Enumeration neither reads
files nor changes its inputs. Inputs that resolve from the rig or parts directory
(seam and `cut_material` part images, `cut_material_sources.json`) are not listed,
because the caller already carries that directory with the check.

## Assembly config reading

New assemble and build manifests carry an optional top-level `assembly_config`
object shaped as `{ sha256, fields: [{ name, sha256 }] }`. Its lowercase
SHA-256 digests describe the effective assembly config inputs, in deterministic
field-name order. Entries name the individual inputs, such as
`assemble.rig_scale`. Field names use dot-separated lowercase keys. From this
version the manifest reader also accepts one indexed form,
`assemble.take[i].meta` (split donor metadata, `i` zero-based), and refuses
every other indexed name. A later version may accept more indexed names. A
reader refuses a name it does not accept with `PARTS_FIELD_TYPE`, so a
consumer upgrades Parts before it reads manifests written by a newer one.
Earlier readers refuse `assemble.take[i].meta`, so release Parts first, then
upgrade and release Review, then update both pins in Create before those
consumers read split-take manifests written by this release.
The aggregate binds the ordered field names and digests.
Declared assembly files are resolved relative to their declaring config or
requirements file and hashed by content. Equivalent path spellings give the
same reading. A built-in control skeleton is identified by its name and latent
size. A missing declared input produces a named refusal.
The `assemble.seam` and `assemble.project` entries hash the effective rules,
resolved in order from the CLI override, the config value and the default.
`build` carries its effective rules to the in-process rig and check stages.
Standalone validation derives its reading from the caller's config. That
config must resolve to the rules used at assembly time, including any values
originally selected by `--seam` or `--project`.
Legacy manifests without `assembly_config` remain accepted. A consumer that
checks a recorded digest against a config refuses a mismatch as
`ASSEMBLY_CONFIG_STALE`, names the changed fields and directs the author to
re-run assemble.

An occluder-split take binds the donor's `meta.json` bytes at
`assemble.take[i].meta`, where `i` is the zero-based take index. When only
these new fields are missing from an older stamp, the stale refusal says
that the stamp predates the binding and asks for one re-assemble with the
same config.

A config with a region take (an `assemble.take` entry with `seed`) and a
`config.requirements` file that declares `setup_painting.rgb_tolerance` binds
that tolerance at `requirements.setup_painting.rgb_tolerance`. Under
`ground: "busy"` with `project: "visible"`, the `requirements.setup_painting`
field already binds the tolerance, so this field is not written there. A
config with no region take, or no declared tolerance, keeps its reading. A
stamp that lacks only this field is refused as `ASSEMBLY_CONFIG_STALE`, and
the refusal says that the stamp predates the binding and asks for one
re-assemble with the same config. The reading reads only `config.requirements`.

`assemble` and `build` refuse a `--requirements` file that `config.requirements`
does not name whenever its content reaches assembly: the config has a region
take (`setup_painting.rgb_tolerance`), or under `ground: "busy"` with
`project: "visible"` the file declares `setup_painting.figure_mask`. With no
`config.requirements` the refusal is `ASSEMBLE_REQUIREMENTS_UNDECLARED`; a
declaration naming another file is `BUILD_REQUIREMENTS_CONFLICT`, whose detail
then names the field that reaches assembly. "Names" is the rule
`BUILD_REQUIREMENTS_CONFLICT` already holds: the same file once resolved (the
flag against the working directory, the declaration against the config's
directory), or a file of the same bytes. A `--requirements` file whose content
reaches no assembly input is accepted as before and moves no byte. Where a
region take or a busy-visible figure mask reads requirements, `assemble` reads
them as `build` does: from `config.requirements`, with `--requirements`
optional and, when given, naming the same file. "The same file" here and in
both refusals means the same resolved file, or a file with the same bytes. So
every requirements value that changes what assemble takes or masks is in the
reading. A flag-only `cut_material` still decides whether
`cut_material_sources.json` is written, and a flag-only `pinholes.required`
still decides a refusal; neither changes the parts or the stamp.

Release order for the tolerance binding: a reader on Parts 2.48.0 or earlier
refuses a stamp this release writes for a config with a region take and a
declared tolerance outside busy-visible, with a false `ASSEMBLY_CONFIG_STALE`
at `config.requirements.setup_painting.rgb_tolerance`. So release Parts, then
Review, then Create, before those consumers read such stamps.

A stamp that predates both later bindings is refused with one sentence naming
both: `the recorded stamp predates split-take donor metadata and region-take
setup_painting.rgb_tolerance bindings. Re-run assemble once with the same
config`.

The stable named subpath `@rig-c/parts/assembly-reading` exports
`assemblyConfigReading(configPath: string, parts: PartsFile): AssemblyConfigRecord`
and `assemblyConfigChanges(configPath: string, parts: PartsFile): string[]`.
Use a manifest read with `readParts` from `@rig-c/parts/src/parts.ts` as
`parts`. The first function computes the current reading using the assemble
config loader. The second compares it with `parts.assembly_config` and returns
the sorted field names whose presence or digest changed. It returns an empty
array for matching or legacy manifests. See the workflow in
[Keeping assembled parts current](AUTHORING.md#keeping-assembled-parts-current).

## Programmatic parts file references

`@rig-c/parts/src/parts.ts` exports `partsFileReferences(dir: string):
PartsFileReference[]` and the `PartsFileReference` type. `dir` holds the assemble
output's `parts.json`. Each row has `path: string`, relative to that directory,
and `role: 'part' | 'alternate' | 'depth' | 'painting' | 'figure_mask' | 'source_state_map'`. The paths use `/`.
The complete output-reference fields and their roles are below.

| Field | Relative path | Role |
| --- | --- | --- |
| `parts[].name` | `parts/<name>.png` | `part` |
| `alternates[].name` with `records[].name` | `parts/<set>_<name>.png` | `alternate` |
| Base or alternate record `depth.image` | `parts/<depth.image>` | `depth` |
| Base or alternate record `source_state_map.image` | `parts/<source_state_map.image>` | `source_state_map` |
| `painting_in_rig.path` | Exactly `painting_in_rig.png` | `painting` |
| Base or alternate `scene.figure_mask` | Exactly `figure_rig.png` | `figure_mask` |

Painting and figure masks sit beside the manifest. Shared base/alternate scene
references collapse to one row. Depth source provenance filenames and
`taken_layers` donor directories/input names are historical identity receipts
and are omitted. There is no separate attachment field.
Rows are sorted by path, then role, in UTF-16 code-unit order, with duplicate path/role pairs
collapsed. A path with several roles retains each role. Every PNG that
parts.json references is listed. A listed file missing on disk is the consumer's
refusal. Unreferenced extras are outside the identity. Historical source
provenance is retained in the manifest and is outside the output-file identity. The function reads and validates
only the manifest, using the production readers' path resolvers. A missing manifest
refuses with `PARTS_FILE_PRESENT`, malformed JSON with `PARTS_IS_JSON`, and
invalid fields with the same named rules as `readParts`. It never opens,
hashes or decodes PNGs and preserves the manifest reader's named refusals.
Legacy manifests may omit alternates, depth and painting declarations.

## Cloth targets data export

The stable named export `./cloth-targets.json` (`@rig-c/parts/cloth-targets.json`)
ships the cloth-recipe target tags as a data-only JSON file (issue #1433):

```json
{
  "schema": "rig-parts/cloth-targets@1",
  "targets": [
    "bottomwear",
    "back hair",
    "front hair",
    "handwear-r",
    "handwear-l"
  ]
}
```

The object carries fixed key order (`schema`, then `targets`), two-space
indentation, and one trailing newline. `targets` lists the tags in
`CLOTH_TARGETS`' order, held equal to `src/cloth.ts` by a tree control
(`bun tools/check_cloth_targets.ts --write` regenerates the file). Consumers
read or resolve the file by its package exports key
(`@rig-c/parts/cloth-targets.json`), not by its internal path inside the
package. Adding a tag to `targets` is a minor change; removing or renaming a
tag, or changing `schema`, is a major change.

## Commands and flags

Exit codes are part of the interface: **0** the command did what it says, **1** it
refused its input (every reason a `FAIL` line), **2** a usage error or a command
this version does not implement. No command is unimplemented at 1.0.0 (`LATER`
in `cli.ts` is empty). A refusal line has the shape
`  FAIL  <RULE>: <object> — <value found>; <value required> (see rig-parts guide <RULE>)`:
the rule name is a stable identifier, the pointer at the end is fixed text, and the
detail between them is prose that may be reworded. Existing named or child core
guide pointers in relayed compile-error text are preserved verbatim. Only a bare
core compile-error line receives `(see rigc guide §5.1)` inside the enclosing
rig-parts refusal; no core error code is invented. A command
also answers to the alias `spine-parts` as long as the install keeps it
([MIGRATION.md](MIGRATION.md)). `-h`, `help` and `-v` are the short forms of
`--help` and `--version`. Every command (and `comfy` with each of its
subcommands) also answers `--help` and `-h` by printing its own usage section
and exiting 0 (issue #1360); on `layers` and `painting`, a file literally named
`-h` is reached as `./-h`. The flags' meanings are `rig-parts --help`'s; their
defaults are the help's too, and none is guessed from the art.

Issue #1358 extends `CHECK_TIP_OVER_ROOT` remedy prose without changing its
rule code, thresholds, measurements or verdicts. Existing remedy branches remain.
For a breathing carrier inside one keyed chain, it warns that rebinding to the
hang bone can pass TIP while failing `STRESS_OFF_CHAIN`. It may name an already
bound carrier under the immediate next keyed link, or suggest moving the keyed
translate to the hang bone or an ancestor. These are options to measure on the
authored rig, not guaranteed fixes. Every TIP remedy calls for re-checking
`STRESS_OFF_CHAIN`; no new report fields or built rig bytes are introduced.

The check diagnostic vocabulary adds the following refusal (issue #1308):

- `CHECK_CARRIER_NOT_EXCITED` — the measured root-to-carrier chain, including
  the carrier, is static during idle. Its check output row adds `carrier_chain`
  (a string array in root-to-carrier order) and `measured_driver: "none"`. A
  declared requirement for this cloth to move remains FAIL; it is not relaxed
  to WARNING.

Carrier excitation is measured from idle transforms, including inherited and
physics-driven movement, rather than an authored-key scan. Below-floor
`UNMEASURED` diagnostics retain actual root and tip travel in rig px, the
unchanged 0.5 rig px floor, and the additive `measured_driver` field: the nearest
world-moving bone on the root-to-carrier chain (including the carrier),
`"none"` when the chain is measured still, or `"unavailable"` for missing or
unusable geometry. Unknown movement does not establish a static chain. The
nearest moving bone is an observation, not causal attribution to authored keys.
The helper reads world-origin span and both affine columns rounded to three
decimal places, without changing public thresholds.
The reading stays `UNMEASURED` under the existing SKIP and mixed-line verdict
policy; it does not automatically make the generic check FAIL. A separately
declared requirement for measurable movement is not satisfied by that reading.
Drive the carrier, or remove the requirement for this cloth to move on idle
when still cloth is intended. These diagnostics change no threshold or gate
and do not certify visibility. See the
[carrier excitation diagnostics](AUTHORING.md#CHECK_CARRIER_NOT_EXCITED).

<!-- stable:commands -->
| command | flags |
| --- | --- |
| `edited-part` | `--config`, `--part`, `--file`, `--from`, exactly one of `--editor` or `--producer`; optional `--parts` (`parts.json`), `--rig-config`, `--help` (`-h`) |
| `external-receipt` | `--kind` (mask), `--file`, `--painting`, `--producer`, `--out`; or `--verify`; or `--help` (`-h`) |
| `diff-components` | `--stack`, `--painting`, `--parts`, `--floor`; optional `--threshold`, `--figure`, `--owners`, `--help` (`-h`); exactly one of `--out`, `--verify` (issues #1005, #1291; exhaustive native error inventory, `rig-parts-diff-components/1` by default and `rig-parts-diff-components/2` with `--owners`, and byte-bound reader for both) |
| `diff-drafts` | `--left`, `--right`, `--out`; optional `--help` (`-h`) (issue #1369; draft-to-draft assemble comparison, `rig-parts-draft-diff/1`) |
| `depth-place` | `--parts`, `--config`, `--rig-config`, `--out`; optional `--check-turn`, `--help` (`-h`) (issue #1570) |
| `depth-prepare` | `--parts`, `--config`, `--out`; optional `--help` (`-h`) (issue #897; separate numeric-depth recipe) |
| `depth-map` | `--array`, `--input`, `--kind` (`depth` or `normals`), `--part`, `--out`; optional `--padding` (`LEFT,TOP,RIGHT,BOTTOM`), `--help` (`-h`) (issue #1573; NumPy array to input-frame numeric map) |
| `depth-bind` | `--map`, `--input`, `--part`; optional `--help` (`-h`) (issue #1284; exclusive receipt creation from current file bytes) |
| `depth-apply` | `--parts`, `--manifest`, `--config`, `--rig-config`, `--out`; optional `--groups` (a comma-separated list of the recipe's groups to apply, issue #1449), `--help` (`-h`) (issue #897; original character config is read-only) |
| `layers` | one positional path: a wrapper directory, a `layers.json` or a `.psd` (a file literally named `-h` is reached as `./-h`); with it, optional `--export` (a directory to write the wrapper form into, issue #359); or `--template` with `--canvas` and no path; or a positional head run with `--full`, `--source`, `--config` together for `PLAN_HEAD_GARMENT_OVERLAP` (issue #826); or `--help` (`-h`) |
| `sheet` | `--source`, `--layers` (repeatable), `--out`; optional `--cell`, `--cols`, `--help` (`-h`) |
| `inputs` | `--source`, `--config`, `--out`; optional `--help` (`-h`) |
| `comfy` | `paint`: `--config`, `--out`; optional `--seeds`, `--seed0`, `--host`, `--wait`, `--timeout`, `--poll`, `--help` (`-h`) |
| `comfy` | `matte`: `--painting`, `--out`, `--node` (`BiRefNetRMBG`), `--model` (`BiRefNet-HR-matting`), `--checkpoint-sha256` (declared, required); optional `--resolution`, `--threshold`, `--host`, `--wait`, `--timeout`, `--poll`, `--help` (`-h`) (issue #1204) |
| `comfy` | `plate`: `--mode` (`background`, `foreground` or `occluder`), `--painting`, `--mask-from` (`seethrough:<dir>`, `figure-mask:<dir>`, `matte:<dir>` or `classified:<manifest.json>`; not with `occluder`), `--out`; with `--mode occluder`, `--occluder` (an RGBA PNG on the painting's grid, required) and optional `--holes` (issue #1230), and the background flags below; with `--mode background` also `--checkpoint-sha256` (required) and optional `--graph` (`lama` or `core`), `--model` (required with `core`), `--seed`, `--grow`, `--steps`, `--cfg`, `--prompt`, `--negative` (the last four with `core` only), `--host`, `--wait`, `--timeout`, `--poll`, `--help` (`-h`) (issue #1183, additive) |
| `comfy` | `seethrough`: `--image`, `--out`; optional `--resolution`, `--steps`, `--seed`, `--prefix`, `--offload`, `--no-offload`, `--lama`, `--nf4`, `--host`, `--wait`, `--timeout`, `--poll`, `--config` (See-through settings and optional depth block), `--depth-run` (`full` or `head`, required with the block), `--help` (`-h`) |
| `assemble` | `--propose-plan` with `--source`, `--full`, `--config`, optional `--head`, `--write-config` (must name `--config` itself, issue #356); or `--source`, `--full`, `--config`, `--out`, optional `--head` (without it, one run: issue #359), `--seam` (near-white, silhouette), `--project` (core, visible), `--alt` (repeatable `<name>=<source>:<full>[:<head>]`, issue #454), `--requirements` (source-bound cut-material evidence only when the file declares `cut_material`, issue #888); or `--emit-fill-masks` (a directory) with `--source`, `--full`, `--config`, optional `--head` (each cut's hidden-band mask on the painting grid, issue #1230); or `--help` (`-h`) |
| `head-crop-preflight` | `--full`, `--canvas`, `--head-box` (JSON coordinate array); optional `--help` (`-h`); read-only advice before the head run, original alpha > 8 samples (issue #1082) |
| `propose` | `--head-box` with `--full`, `--canvas`; optional `--no-back-hair`, `--write-config` (existing config, issue #356), `--help` (`-h`) |
| `propose` | `--parts`, `--source`, `--out`; optional `--compare` or `--from-config` (one of them), `--keypoints`, `--person` and `--wrist-snap` (each with `--keypoints`), `--full`, `--head` (the turn control's depths; not with `--from-config`), `--grid-rule` (`figure` or `part`, the drafted lattice's spacing; not with `--from-config`), `--cloth` (a config whose `cloth` block is the recipe, issue #364; not with `--from-config`), `--write-config` (existing config for an ordinary proposal, issue #356; a new file with `--cloth`, issue #537; not with `--from-config` — additive: without it nothing `propose` writes changes), `--from` (the config the recipe is changed from, only with `--write-config`, issue #571 — additive: without it nothing `--write-config` writes changes), `--only-missing` (only with `--parts` and `--write-config`, not with `--cloth` or `--from-config`, issue #671 — additive: without it nothing `--write-config` writes changes)  `--bust-landmarks` (rig-pixel apex_r/apex_l and optional cleavage; a `<file>.provenance.json` beside it is read and checked, and its pending shape needs `--write-config`, issue #1382), or `--no-bust` (non-blank omission reason), one required when drafting a chest-holding torso, both incompatible with `--from-config`; on a sampled body-turn neck config, either with `--write-config` and without `--full` / `--head` writes the chest alone (issue #1436), `--help` (`-h`) |
| `propose` | `--parts`, `--source`, `--out`, `--full`, `--head`, `--write-config` together: the [neck draft](AUTHORING.md#a-neck-that-moves-on-its-own) for an existing config with `turn.body` and one neck plan row; reassembles under `<out>/rig`, preserves the sampled turn and drafts a rigid neck unit (issue #826) |
| `bust-landmarks` | `--from-act`, `--parts`, `--config`, `--out`; optional `--write-config` (takes the act's `alpha`, `clearance`, `spacing`, `bone_r` and `bone_l` into the config's existing `meshes.<part>.contour.bust` when the act's three points are the declared ones, a field the act omits removed; the config is untouched when none differs, and when the act moves the points, whose shape is then pending in the record (issue #1443) — additive: without it nothing the command writes changes), `--help` (`-h`) (issue #1382; one `rig-review/act@9` chest row, or the one row of a `rig-review/act@10` chest-landmarks carrier (issue #1539), to the landmarks file `propose` reads, with `<out>.provenance.json` beside it) |
| `compare` | `--left`, `--right`; optional `--map`, `--help` (`-h`) |
| `rig` | `--config`, `--parts`, `--out`; optional `--idle-keys` (ctl, direct), `--page-edges` (pot, free), `--pack-shape` (rect, polygon), `--page-size`, `--help` (`-h`) |
| `check-parts` | `--parts`, `--out`; optional `--json`, `--help` (`-h`) |
| `check` | `--rig`, `--out`; optional `--parts`, `--source`, `--page-edges`, `--pack-shape`, `--page-size`, `--requirements`, `--seam-pairs`, `--keep-stills`, `--no-extremes` (issue #829), `--set` or `--all-sets` (issue #454), `--environment` (issue #538, additive), `--wind-band` (issue #590, additive), paired `--loop-seam-bar` and `--loop-seam-cap` (issue #1590), `--json` (issue #904), `--help` (`-h`) |
| `loop` | `--frames`, `--out`; optional `--palette`, `--help` (`-h`) |
| `build` | `--config`, `--source`, `--full`, `--out`; optional `--head` (as for `assemble`), `--seam`, `--project`, `--page-edges`, `--pack-shape`, `--page-size`, `--loop`, `--lead-in`, `--requirements`, `--idle-keys`, `--seam-pairs`, `--keep-stills`, `--no-extremes` (issue #829), `--alt` (as for `assemble`, issue #454), `--set` or `--all-sets` (as for `check`, issue #454), `--environment` (as for `check`, issue #538, additive), `--wind-band` (as for `check`, issue #590, additive), `--help` (`-h`) |
| `compose` | `--scene`, `--out`; optional `--requirements`, `--accept`, `--page-size`, paired `--loop-seam-bar` and `--loop-seam-cap` (issue #1590), `--output-profile` (`preview`) and `--no-extremes` (issue #1610), `--help` (`-h`) |
| `mesh-draft` | `--config`, `--parts`, `--out`; optional `--requirements`, `--idle-keys` (ctl, direct), `--page-edges` (pot, free), `--pack-shape` (rect, polygon), `--page-size`, `--more-triangles`, `--help` (`-h`) |
| `mesh-stats` | `--config`, `--parts`; optional `--help` (`-h`) (issue #566, additive: prints, writes nothing) |
| `remesh` | `--rig`, `--config`, `--parts`, `--part`, `--out`, and one of `--mesh` or `--delta` (issue #526); optional `--requirements`, `--idle-keys` (ctl, direct), `--page-edges` (pot, free), `--pack-shape` (rect, polygon), `--page-size`, `--record-input-check` and `--input-check` (issue #617, additive: without them nothing `remesh` prints or writes changes), `--help` (`-h`) |
| `retune` | `--rig`, `--config`, `--parts`, `--out`; optional `--requirements`, `--idle-keys` (ctl, direct), `--page-edges` (pot, free), `--pack-shape` (rect, polygon), `--page-size`, `--record-input-check` and `--input-check` (as for `remesh`, issue #617, additive), `--help` (`-h`) |
| `painting` | one positional path, the painting (a file literally named `-h` is reached as `./-h`); `--keypoints`; optional `--person`, `--form` (`standee` or `illustration`, issue #931), `--help` (`-h`) |
| `guide` | one positional argument: a rule name, `§<n>`, `§<n>.<m>` or `§<n>.<m>.<k>`; or `--help` (`-h`) |
| (none) | `--version`, `--help` |
<!-- /stable:commands -->

`TY13` holds the first column to the commands `cli.ts` dispatches, the set of
flags in the table to the flags `cli.ts` spells, and each command's listed flags
to its parser's `TAKES` row in both directions. Repeated proposal modes share one
command's flag union; `comfy paint` and `comfy seethrough` are checked separately.
Required combinations within a mode remain the CLI's; the `cli` suite's controls
read them from the help.

`bust-landmarks` (issue #1382) arrives in a minor version and is stable like every
command in the table. This page does not separate provisional commands. The
promise covers its command line and flags, and its refusal codes:
`BUST_LANDMARKS_ACT`, `BUST_LANDMARKS_ROW`, `BUST_LANDMARKS_SLOT`,
`BUST_LANDMARKS_PART_ROWS`, `BUST_LANDMARKS_ROWS`, `BUST_LANDMARKS_FRAME`,
`BUST_LANDMARKS_SHAPE` and `BUST_LANDMARKS_OUT`, and `CONFIG_BUST_CLEARANCE` for points the
shape `propose` will check them with does not fit (issue #1441). It also covers the landmarks
file it writes, which holds the three keys `propose` reads, in rig px. And it
covers the provenance record: its spec id `rig-parts-bust-landmarks-provenance/1`,
its keys and their order: `spec`, `act` (`schema`, `act_id`, `file_sha256`),
`row_sha256`, `slot`, `source` (`hash`, `frame`), `landmarks_sha256`, and, only
when the act's shape differs from the config's after defaults and the config
declared no `contour.bust` or the act moves its points (issue #1443), `shape` (`status`, `pending` or `applied`, and `fields`, in the
shorthand's key order). `propose --bust-landmarks` reads that record when it
sits beside the landmarks file, writes a pending shape with `--write-config` and
marks it applied, and refuses by name `PROPOSE_BUST_SIDECAR`,
`PROPOSE_BUST_SIDECAR_DIGEST`, `PROPOSE_BUST_SIDECAR_PART` and
`PROPOSE_BUST_PENDING`; with no record beside the file it reads the file as
before. On a sampled body-turn neck config (`turn.body` and a plan part tagged
`neck`, issue #1436), `--bust-landmarks` or `--no-bust` with `--write-config` and
without `--full` and `--head` is the chest-only write: it writes the chest
carrier's `contour.bust` and the `boob_r` / `boob_l` bones and no other entry,
derives a missing cleavage from the config's own `neck` and `hip` bones, and
says which source the cleavage came from. A carrier that is not a contour mesh
is refused by name, `PROPOSE_BUST_CARRIER_MESH`; the chest flags with `--full` or
`--head` stay `PROPOSE_NECK_MODE`. The row digest rule (the sha256 of the row's `edit` with object keys sorted recursively, recomputed and refused on a mismatch) is a copy of review's request digest. The act's grammar is review's. This package reads
`rig-review/act@9`, and from issue #1539 the `chest-landmarks` carrier of a
`rig-review/act@10` comment-only act, and refuses another act version by name
until a later minor version reads it. A record written from an act@10 carries
`act.carrier_file` under the same spec `rig-parts-bust-landmarks-provenance/1`;
a record from an act@9 is byte-unchanged.

The [command reference](AUTHORING.md#command-reference) describes each mode;
[writing proposed config fields](AUTHORING.md#writing-proposed-config-fields)
records the existing-file and fresh-file destinations and byte-preservation rules.

`assemble --project visible` adds optional `edge_residuals.json` beside
`parts.json` (issue #999), a report-only front/back residual candidate sidecar.
Its observations add no acceptance bar to the existing outputs.

## The config contract

`src/config.ts` is the schema and the loader, and
[AUTHORING §3](AUTHORING.md#3-configjson-field-by-field) explains every field. The
rules that make the contract:

- **Every key is known or refused** (`CONFIG_KEY_KNOWN`), a required key that is
  missing is refused by name (`CONFIG_FIELD_PRESENT`), and nothing is defaulted
  from the art. A field absent where absence means "none" (a contour's `stray`, an
  automatic mesh's `minAngle`) is written as that in the report, never filled in.
- **Two open doors, and nothing reads behind them**: `note` and any key ending in
  `_note` hold a string anywhere an object is; any key beginning `x-` with a name
  after it holds any JSON value in the same places. They are not open in `meshes`,
  `regions` or `motion.blink.still`, whose keys are part names.
- **Coordinates** in `bones`, `meshes` and `motion` are rig pixels, y down, origin
  top-left. Explicit mesh UVs are normalized padded-image coordinates, and its weights are bone-local Spine pixels, already y up.
- **A mesh has exactly one mode**: `grid` (the lattice, what `propose` writes),
  `contour` (the traced outline with declared interior points), `influence` (core's lattice and pull), `explicit` (a hash-bound accepted payload) or `auto` (the
  automatic mode: the contour mesh at alpha 1 and above reduced by rig-c's
  `reduceMesh` under declared bounds, written only when its motion against the
  unreduced source passes the author's bounds). Two, or none, is
  `CONFIG_MESH_MODE`. The top-level default does not change: `propose` writes
  `grid`, and a config that names no `auto` builds as it did before the mode
  existed.
- **`constraints`** are rig-c's own rig-spec constraints (`RigConstraint` in
  rig-c's `src/rig.ts`), handed to rigc as written; this loader checks their
  `type`, their `name` and that every bone they name resolves.
- **`turn`** (issue #251) adds a control bone `turn` under `root` that nothing
  keys, and carries each part in `depths` by `(pivot − depth) / (pivot − nearest
  depth)` of its x. Without the field no byte of any output moves.
  A declared head turn (`depths` or `roles`) reports `RIG_TURN_HEAD_ROLL`
  when the absolute setup eye-line roll exceeds the limit displayed as
  18.485385 degrees
  (issue #903). This empirical limit is the midpoint of the measured public
  control maximum, 4.864514 degrees, and `three-quarter`,
  32.106256 degrees (the comparison uses the unrounded midpoint). The warning
  names the face/eye parts, the eye
  bones, signed roll and limit. It is report-only: no refusal, field, pose or
  emitted-byte change. No head turn, a body-only turn, or an unreadable eye
  line adds no warning; unreadable retains the existing face-axis reason.
  See [Head roll before a declared turn](AUTHORING.md#head-roll-before-a-declared-turn)
  for the measurement scope and its limits.
- **`scene`** (issue #242) declares the painting a scene — the figure and what
  is round it — and takes no field: `{}`. With it `assemble` reads the
  recomposite inside the figure (the union of the full run's layers at alpha
  above 8), writes the figure as `figure_rig.png` beside the recomposite (and,
  when standalone `assemble` puts `parts.json` in another directory, beside
  `parts.json` too, issue #1177) and a `scene` block in `parts.json`, and `check` leaves the painting's border rows
  and columns out of the seam. Without the field no byte of any output moves.

The fields, object by object (a bold path is where the object sits; `<part>` is a
part name, `[i]` an entry of a list):

<!-- stable:config -->
- **config** — required by the full loader, in front of rig and build: `key`, `assemble`, `bones`, `meshes`, `regions`, `motion`; optional: `generation`, `seethrough`, `limbs`, `constraints`, `stops`, `turn`, `scene`, `cloth`, `proposed_rig_scale`, `requirements` (issue #556, additive: a path beside the config that build reads in place of its requirements flag, whose behaviour is unchanged), `motion_seams`, `depth`, `waist`
- **generation** — required: `checkpoint`, `loras`, `trigger`, `identity`, `sampler`, `costume`, `negative_extra`, `style`, `negative_pose`, `latent`, `seed`; optional: `pose`, `control`
- **generation.loras[i]** — required: `name`, `strength`; optional: `strength_clip`
- **generation.sampler** — required: `steps`, `cfg`, `sampler`, `scheduler`
- **generation.control** — required: `skeleton`, `strength`, `end_percent`; optional: `model`
- **generation.control.skeleton**, the pose file it names when it is no built-in — required: `width`, `height`, `points`
- **seethrough** — required: `resolution`, `steps`, `seed`, `offload`; optional: `head_box`, `arm_split`
- **seethrough.arm_split** — required: `order`, and one of `x` or `line` (issue #439)
- **assemble** — required: `rig_scale`, `plan` (from plain `assemble` on); optional: `seam`, `project`, `ground`, `extend_below_crop`, `patches`, `cuts`, `alternates`, `head_face_underfill`, `yield_refused`, `stage_map`, `keep_under_occluders`, `require_hidden_extent`, `extend_painting`, `edge_splits`, `take`, `editor_receipts`, `edited_parts`, `occluders`. The yield setting accepts a boolean or a nonempty list of final yielding output part names. The list is bound to the assembly config reading.
- **assemble.edge_splits[i]** — required: `over`, `under`, `band`
- **assemble.require_hidden_extent[i]** — required: `part`, `occluder`
- **assemble.occluders[i]** — required: `image`, `sha256`, `under`, `rgb_within`; optional: `over`, `plate`, `part`, `grow`, `guard` (issues #1230, #1237, #1241, #1246, #1251, #1259)
- **assemble.alternates[i]** — required: `name`; optional: `source`, `full`, `head`, `parts`, `hides`, `head_box`, `cuts`, `skeleton`, `anchor`, `base_anchor`, `drawn`, `tips`, `front`, `layers`, `focus` (issues #454, #465, #543, #652, #664, #666, #719, #780). `focus` is an authored finite `[x, y]` in painting pixels, within its canvas (edges included), refused as CONFIG_SET_FOCUS before assemble output when invalid; only when present, `parts.json` records it with focus_source_size and `sets.json` emits it in setup-world coordinates through the actual rig resize and `src/coords.ts`. Absent focus emits no field or inferred value; changing/removing it requires reassembly
- **assemble.extend_below_crop[i]** — required: `part`, `run`, `tag`; optional: `edges` (left, right, top, bottom; explicit edges require a head-run part and the full-run layer of the same tag)
- **assemble.extend_painting[i]** — required: `part`, `band`, `max_distance`; optional: `min_held_alpha`, `order` (issues #848, #854, #855; explicit final layer-derived part, half-open rig band and positive four-neighbour path bound; base painting only). The optional integer floor 1–255 admits exact original alpha-over coverage strictly below it; absent or 1 blocks every nonzero holder. Only selected target samples below the floor may take painting RGBA; target samples at/above the floor and every non-target holder remain exact. By default overlapping reachable claims refuse. With `order` on every entry (unique nonnegative safe integers), lower values claim first and their gains block later candidates and paths; array order never breaks ties or supplies missing precedence
- **assemble.take[i]** — required: `run`, `run_dir`, `st_input`; optional: `tags`, `part`, `tag`, `occluder`, `seed`, `reference`, `crop` (issues #866, #973, #1000, #1031, #1242). Whole-layer entries require `tags`; region entries require `part` and `seed`; occluder-split entries require `part`, `tag` and `occluder`. An absent `reference` preserves the shipped `source: true` predicate and emits one named implicit-reference warning; only an explicitly declared painting reference makes the mask invariant to changes in `--source`
- **assemble.take[i].crop** — required when present: `box`, `resample` (issue #973, additive, whole-layer entries only). `box` is an inside nonempty integer source-painting `[left, top, right, bottom]` with exclusive right/bottom. `resample: "bilinear"` is required explicitly. Donor input must match the square-padded crop under taken support plus its margin. Unit scale and integer translation copy RGBA exactly; other maps use the declared premultiplied float32 affine filter. Absent, the shipped geometry predicate and refusal message remain unchanged. Region entries reject this field
- **assemble.take[i].reference** — required: `sha256`; optional: `source`, `painting` (issue #1031). Exactly one of `source: true` or a config-relative `painting` PNG is required. The reference governs colour only and geometry follows `--source`. A region take requires an opaque `--source` because its donor must match the run input and the inputs command refuses see-through paintings, so flatten the plate first.
- **assemble.editor_receipts** — required: `receipts`; optional: `required` (issue #946, additive), `trace_parts` (issue #947, additive)
- **assemble.editor_receipts.receipts[i]** — required: `file`, `sha256`, `from_sha256`, `editor` (issue #946)
- **assemble.edited_parts** — required: `dir`, `receipts` (issue #1278; directory relative to the config)
- **assemble.edited_parts.receipts[i]** — required: `part`, `file`, `sha256`, `from_sha256`; exactly one of `editor` or `producer` (issue #1278; file relative to the edited-parts directory)
- **assemble.patches[i]** — required: `name`, `box`, `alpha`, `draw`
- **assemble.patches[i].draw**, when an object — required: `before`
- **assemble.cuts[i]** — required: `from`, `into`, `polygon`, `draw`, `overlap`; optional: `under`, `under_fill` (issue #1230: `under` is a path string or an object)
- **assemble.cuts[i].under**, when an object — required: `plate` (issue #1230, additive)
- **assemble.cuts[i].draw**, when an object — required: `before`
- **limbs.&lt;limb&gt;** — required: `segments`; optional: `split`, `layout`, `front` (issues #349, #446, #647, #664)
- **limbs.&lt;limb&gt;.front** — required: `parts` (own segment parts, issue #664), `after` (a produced part)
- **limbs.&lt;limb&gt;.layout** — exactly one of `before`, `after`; optional: `parts` (own consecutive segment-part references, issue #647)
- **limbs.&lt;limb&gt;.layout.before**, **limbs.&lt;limb&gt;.layout.after** — exactly one typed target: `limb` or `part`
- **limbs.&lt;limb&gt;.segments[i]** — required: `part`, `from`, `bone`; required below a joint (i > 0): `joint`; optional below a joint: `range`, `cap`, `edge`, `cap_shape`, `cut_band`, `hybrid`
- **limbs.&lt;limb&gt;.segments[i].hybrid** — required: `part`; optional: `width` (issue #399; lower segments only, replaces cut-cap options, one source and two adjacent rigid carriers)
- **bones[i]**, a single bone — required: `name`, `parent`, `at`; optional: `tip`, `inherit`
- **bones[i]**, a chain — required: `chain`, `parent`, `points`, `tip`; optional: `link_inherit`
- **stops[i]** — required: `chain`, `against`, `at`, `inward`, `outward`; optional: `links`, `lower` (issue #404)
- **stops[i].lower** — required: `inward`, `outward`
- **meshes.&lt;part&gt;** — exactly one of `grid`, `contour`, `auto`, `influence`, `explicit`; required in every mode: `segments`, and `r` in generated modes other than `influence`; `explicit` refuses generation fields and uses direct bone names in `segments`, the first the slot bone; optional in every mode: `exponent`, `rule`, `gather` (issue #680, false only: preserve an exclusive non-segment rider's authored draw position without changing its binding; absent, output bytes unchanged); optional with `contour` or `auto`: `ribs`; optional with `grid` or `contour`: `influences` (issue #284; beside `auto` it is refused, CONFIG_INFLUENCES_MODE); optional with a distance lattice, distance contour or influence mesh: `fixed_above`; optional with `grid`: `stray` (issue #303; beside `contour` or `auto` it is refused, CONFIG_STRAY_MODE)
- **meshes.&lt;part&gt;.explicit** — required: `image_sha256`, `region_sha256`, and either `uvs`, `triangles`, `hull`, `weights` (single-slot, issue #658) or `islands` (at least two island entries, issue #734); direct payload numbers are transferred without normalization; weights require `bone`, `x`, `y`, `weight`. Image SHA-256 is over decoded unpadded RGBA bytes; region SHA-256 is over JSON.stringify([rig width, rig height, part x, part y, part w, part h]). Both must match before output, and when `islands` is declared its entry count must match the part's non-dust 4-connected art island count. All weighted and island slot bones must occur in segments; declared stopped links may use their emitted `<link>_d` names. Other unknown names remain refused. Alternate artwork for this part is refused; use a generated mesh for it.
- **meshes.&lt;part&gt;.explicit.islands[i]** — required: `slot` (`<part>` at index 0, `<part>__island<i+1>` at index i >= 1), `uvs`, `triangles`, `hull`, `weights`; optional: `bone` (defaults to `segments[0]`), `before` (index i >= 1 only: the base part slot in `rig.json` to splice `<part>__island<i+1>` immediately before; absent, immediately after the part's previous island slot)
- **meshes.&lt;part&gt;.influence** — required: `cell`, `radius`, `across`, `max`, `shape` (issue #378); optional: `hold_tip` (issue #615, the value true only); beside it `r`, `exponent`, `rule`, `influences`, `stray` and `ribs` are refused by name
- **meshes.&lt;part&gt;.influences** — optional, at least one: `maxInfluences` (a whole number, 1 or more, or null for no cap), `floor` ("cut" or "continuous")
- **meshes.&lt;part&gt;.ribs.&lt;chain&gt;** — required: `stations`
- **meshes.&lt;part&gt;.contour** — required: `tolerance`, `margin`, `spacing`; optional: `maxEdge`, `budget`, `stray`, `bridges`, `regions`, `bust`
- **meshes.&lt;part&gt;.contour.regions[i]** — required: `name`, `shape`, `bone`, `spacing`, `band`, and `cx`, `cy`, `r` for a circle or `points` for a polygon; optional: `cover`, `falloff`
- **meshes.&lt;part&gt;.contour.bust** — required: `apex_r`, `apex_l`, `cleavage`; optional: `alpha`, `clearance`, `bone_r`, `bone_l`, `spacing` (issue #475)
- **meshes.&lt;part&gt;.auto** — required: `source`, `sourceBounds`, `targets`, `influences`, `budget`, `minArtSamples`, `motion`; optional: `protect`, `regions`, the three Stage B opt-ins `boundaryRuns`, `retriangulate`, `removalOrder`, and `stimulus`
- **meshes.&lt;part&gt;.auto.source** — required: `tolerance`, `margin`, `spacing`; optional: `stray`
- **meshes.&lt;part&gt;.auto.sourceBounds** and **meshes.&lt;part&gt;.auto.targets.artFit** — required: `minCoverage`, `maxOvershoot`, `maxUndercut` (each of the last two a number or null, the bound declared absent)
- **meshes.&lt;part&gt;.fixed_above** — optional on a distance lattice, distance contour or influence mesh; required when present: `row`, `bones` (non-empty list of fixed segment bone names)
- **meshes.&lt;part&gt;.auto.targets** — required: `artFit`, `maxBoundaryDeviation`; optional: `minAngle`
- **meshes.&lt;part&gt;.auto.influences** — required: `maxInfluences`, `minWeight`
- **meshes.&lt;part&gt;.auto.budget** — required: `maxCandidates`
- **meshes.&lt;part&gt;.auto.motion** — required: `maxLocalDeformation`; optional: `maxStretch`, `minStretch`, `deformMayFold`, `gradation`, `selection`, `residual`
- **meshes.&lt;part&gt;.auto.motion.selection** — required: `policy`, `maxProbes`
- **meshes.&lt;part&gt;.auto.motion.residual** — required: `maxResidual`
- **meshes.&lt;part&gt;.auto.protect** — optional: `hull`, `vertices`, `edges`, `regionBoundaries`, `weightJump`, `influences`
- **meshes.&lt;part&gt;.auto.regions[i]** — required: `name`, `shape`, `maxEdgeLength`, `transition`, `grade`, `minArtSamples`, and `cx`, `cy`, `r` for a circle or `points` for a polygon; optional: `bone`, `band` (both or neither; with neither the region is density only)
- **meshes.&lt;part&gt;.auto.boundaryRuns** — required: `maxVertices`
- **meshes.&lt;part&gt;.auto.stimulus**, or each entry of it when a list — required: `chain`, `degrees`
- **cloth.&lt;tag&gt;**, the tag bottomwear, back hair, front hair, handwear-r or handwear-l (issue #364; read by propose --cloth only) — required: `chains` (optional on `back hair`, issue #390), `links`, `wind`, `gravity`; optional: `split`, `length_ratio`, `extent` (one bottomwear or sleeve carrier), `strength`, `damping`, `alternate_damping`, `translate`, `swing` (on bottomwear only), `part` (a string on bottomwear, required as one name on handwear-r and handwear-l, or a list in root-to-tip order on bottomwear and hair recipes), `parts` (a list in root-to-tip order on bottomwear and hair recipes)
- **cloth.&lt;tag&gt;.split** — required: `at`, `into`; optional: `hold_tip`
- **cloth.&lt;tag&gt;.strength** — required: `trunk`, `branch`, `edge`
- **cloth.&lt;tag&gt;.swing** — required: `scales`
- **regions.&lt;part&gt;** — a bone name, or `{bone, gather?}` with the same required bone name and optional `gather: false` (issue #680); absent, normal gathering and historical bytes are unchanged. An opt-out requires an exclusive non-segment limb rider ([named refusal](AUTHORING.md#RIG_GATHER_RIDER))
- **motion** — required: `duration`, `tracks`; optional: `blink`, `animations_from`
- **motion.tracks[i]**, a single track — required: `bone`, `prop`, `amp`, `period`, `phase`; optional: `base`
- **motion.tracks[i]**, a chain track — required: `chain`, `amps`, `period`, `phase`, `lag`
- **motion.blink** — required: `t`, `eyes`, `squash`; optional: `brows`, `brow_drop`, `still`, `more`
- **motion.blink.still.&lt;part&gt;** — required: `row`, `bone`
- **motion.animations_from**, the file it names — required: `spec`, `animations`
- **turn** — required: `pivot`, `depths` (or `roles` / `body`, issues #763, #787); optional: `deform`, `band`, `radius`, `surface`, `head`, `roles`, `counter`, `grid`, `unitDepths`, `boundaryDepths`, `body`
- **turn.boundaryDepths.&lt;part&gt;**, when an object — required: `neighbour`, `band` (issue #1342)
- **turn.body.boundaryDepths.&lt;part&gt;**, when an object — required: `neighbour`, `band` (issue #1342)
- **turn.depths.&lt;part&gt;** — a See-through depth
- **turn.roles.&lt;part&gt;** — `"surface"`, `"unit"` or `"rear"` (issue #763)
- **turn.unitDepths.&lt;part&gt;** — a calibrated world depth in rig pixels (issue #763)
- **turn.body**, when an object — required: `roles`, `pivot` (when `turn.pivot` is absent); optional: `bone`, `slider`, `counter`, `grid`, `unitDepths`, `boundaryDepths` (issue #787)
- **turn.body.roles.&lt;part&gt;** — `"surface"`, `"unit"` or `"rear"` (issue #787)
- **turn.body.unitDepths.&lt;part&gt;** — a calibrated world depth in rig pixels; body yaw uses `-(pivot + z - zRef) * sin(a)` ([Unit depth precedence](AUTHORING.md#unit-depth-precedence))
- **turn.deform.&lt;key&gt;** — a per-degree fraction or coupling share (FACE_DEFORM_FRACTIONS, issue #436)
- **turn.band**, when an object — optional: `yaw`, `pitch` (issue #472)
- **turn.surface**, when an object — optional: `radius` (issue #479)
- **turn.head**, when an object — optional: `pivot`, `radius` (issues #478, #479)
- **scene** — no field (`{}`; a record or an annotation only)
- **proposal.json**, the file propose writes — `bones`, `meshes`, `regions`, `limbs` under `--keypoints` where an arm or a leg is drafted from its joints (issue #349), `stops` when supplied, `motion` under the rules above, `turn` with `--full`/`--head`, `proposed_rig_scale` (issue #354), and `notes`
- **depth** — optional: `zScale`, `full`, `head` (#773)
- **depth.full**, **depth.head** — optional: `layers`, `atlas` (one fallback route)
- **depth.full.layers.&lt;layer&gt;**, **depth.head.layers.&lt;layer&gt;**, **depth.full.atlas**, **depth.head.atlas** — required: `image`, `near`, `zScale`
- **waist** — required: `top`, `bottom`, `upper`, `lower`, `bone`, `constraint` (#650; absent keeps the ordinary bindings and graph)
<!-- /stable:config -->

`motion.blink.more` is an optional, authored non-empty array of finite additional
start times in seconds, strictly increasing and each greater than scalar
`motion.blink.t` (`CONFIG_BLINK_MORE_TIMES`). It repeats the same blink shape,
timing and groups; every complete window must be strictly inside the idle
(`RIG_BLINK_INSIDE_IDLE`) and windows cannot overlap (`RIG_BLINK_WINDOWS_DISJOINT`).
When absent, output bytes are unchanged; `propose` drafts scalar `t` only.

`assemble.seam` accepts `near-white` or `silhouette` (issue #905). CLI
`--seam` overrides config, then the existing `near-white` default applies.
Invalid values refuse as `CONFIG_FIELD_TYPE` at `config.assemble.seam`;
an absent field preserves existing output bytes.

`assemble.project` accepts `core` or `visible` (issue #953). CLI
`--project` overrides config, then the existing `core` default applies.
Invalid values refuse as `CONFIG_FIELD_TYPE` at `config.assemble.project`;
an absent field preserves existing output bytes. The bytes `visible` writes
are not promised across versions (issue #953 resolves its edges from the
painting).

`assemble.ground` accepts `plain` or `busy` (issue #996). Invalid values refuse
as `CONFIG_FIELD_TYPE` at `config.assemble.ground`; an absent field and `plain`
preserve existing output bytes. It is read by `visible` only, whose bytes are
not promised. The `ASSEMBLE_GROUND_PLAIN` warning prints under `visible` only, is a
report line and never changes output.

`TY14` holds the set of field names in backticks above to the set of names the
loader's object checks spell (every `c.object(…)` in `src/config.ts`, with the lists
they name), in both directions, and refuses an object check whose key list it cannot
read. It holds the names, not their nesting or which are required: the `config`
suite's controls hold those, refusal by refusal.

The values a field takes (`retriangulate` is "delaunay", `removalOrder`
"deformation-load", `selection.policy` "multi-interval"; the units and ranges of
every number) are AUTHORING §3's tables, and the loader refuses any other by name.

Optional turn boundary-depth declarations (issue #1342) resolve existing part
names and project band samples onto the original neighbour sheet. Bands may be
the target itself or contained boundary-reaching parts, including existing
painting patches. Shared anchors, calibration, prepared maps and setup geometry
are unchanged; omission preserves existing output bytes. Projection ties use
the arithmetic mean and the inner band edge is a hard switch, without blending.
See [boundary authoring](AUTHORING.md#declared-boundary-depths-1342).

## Files this package writes

### Diagnostic path segments

Issue #1362 changes name-derived diagnostic paths written by `check`, including
the check inside `build` and `compose`. The one mapping is
`diagnosticSegment` in `src/outputpaths.ts`: read original UTF-16 code units
left to right. An ASCII unit in `[A-Za-z0-9_@+.-]` stays literal; every
other unit becomes `~` followed by exactly four lowercase hexadecimal digits.
Unicode units (including each surrogate), punctuation outside that alphabet
and `~` itself are escaped. Uppercase ASCII letters stay literal. No normalization or case conversion
is applied. A left-to-right decoder copies each literal and consumes exactly
four hex digits after each `~`, recovering the original code units; escape-like
input names therefore cannot collide with an escaped name.

Two positional/whole-name hazards override literal units. Escape the final dot
if present, which also covers `.` and `..`. After that unit encoding, if the
emitted basename before its first dot matches `con`, `prn`, `aux`, `nul`,
`com1` through `com9`, or `lpt1` through `lpt9` without regard to ASCII case,
escape its first unit. Thus `idle`
stays `idle`, `a:turn` becomes `a~003aturn`, `..` becomes `.~002e`, `tail.`
becomes `tail~002e`, `con.txt` becomes `~0063on.txt`, and `con.` needs only
`con~002e`. Trailing spaces are already escaped as unsafe units. Distinct
names have distinct case-sensitive mapped segments; all emitted units are ASCII,
so Unicode normalization does not change them. Windows punctuation, C0 controls,
device basenames and trailing dots/spaces cannot occur in the mapped segment.

ASCII-case aliases are refused rather than renamed: `Idle` and `idle` each map
literally, but cannot be siblings. `diagnosticSiblings` checks the entire sibling
scope before its writes, using the mapped folders' ASCII lowercase spellings.
A collision raises `DIAGNOSTIC_PATH_SEGMENT` naming both original inputs,
both folder spellings and their shared case-folded folder. Scopes are extremes
animations, retained render sets (a preflight on the animation names before
any render), selected alternate-set folders, and each of
`requirements/as-declared`, `requirements/released` and `requirements/full`.
Check preflights all known scopes before creating or clearing its output;
requirement measurement also preflights before cleanup, and retained copies
validate every set before creating a destination. The retained reference-world
publisher validates all worlds before staging them. Safe uppercase names such as
`VANE_HALF` and `RIDER_HALF` keep their existing paths.

An empty original name, or a resulting segment longer than 255 ASCII characters
including a fixed filename/rate suffix, is refused as `DIAGNOSTIC_PATH_SEGMENT`,
naming the original input and the required bound. No truncation or hashing is
applied. The suffix is appended after unit mapping and included in that length
check; it does not change the name's encoding.

`extremes/<segment>/` uses the original animation name. Retained render sets
are named by rig-c's render, not by this package (issue #1367): from
rig-c/core#1744 on, `rigc render` writes each frame-set folder with this same
mapping plus `@<fps>fps` outside the protocol 12 fps, and records it under
`frames.json`'s `sets[].dir`. The retained copy takes every `sets[].dir` as it
is and copies `frames.json` byte for byte; it maps no name a second time. A
`sets[].dir` that is absent, not a string, empty, absolute, a dot segment,
holds a path separator or a unit outside `[A-Za-z0-9_@+.~-]`, ends in `.`, is
a Windows device basename, or is longer than 255 characters is refused as
`FRAMES_SIDECAR` naming the set and the value, as are two recorded folders
that share an ASCII-case-folded spelling; every set is validated before a
destination is created. A render from a core before rig-c/core#1744 records
an unsafe animation name raw, so its copy is refused rather than renamed. The
original animation fields, including `extremes.json`, and the public
`<id>:<name>` animation names stay unchanged. Readers follow `sets[].dir`
rather than reconstructing a folder from `animation`. Fixed root sidecar names
and bytes are copied verbatim.

The same mapping applies to alternate-set folders in `setup_still/`,
`setup_still_auto/` and `seam/`, the complete ranked seam-picture filename stem,
and animation/requirement folders in `requirements/{as-declared,released,full}`.
The retained seam reference worlds under `seam_motion/{default,still}` use
the mapped render indexes. Loop output filenames are fixed; fold, loop,
stress, sweep and wind-band render scratch is removed rather than published.
Source part/image references retain their separate asset contracts.

The mapping lives in this package's retention step. Core's `frameSetDir`
still writes original names in staging before that step; this layout fix
does not certify native Windows rendering or repair staging collisions on a
filesystem that already aliases two original names.

`depth-bind` writes `<map>.binding.json` beside the numeric map, spec
`rig-parts-depth-map-binding/1`, with `spec`, `part`, `mapSha256`, `inputSha256`
in that order. Hashes are computed from current map and input PNG bytes.
Exclusive creation refuses an existing receipt and preserves it unchanged.


### Source cover report

`assemble` and the assemble stage of `build` always write `source_cover.json`
beside `parts.json`, with spec `rig-parts-source-cover/1`. `stage`, `predicate`
and `sets` declare projection-input cover. Each set includes its painting hash,
rig grid, hash-bound inputs, effective source inventory, evaluated part rows,
inherited primary references, hidden parts and output asset mappings. Cover
rows carry owning source identity, planned membership and native pixel counts
and spans. A derived alternate row's optional `source_of` names its parent
source-plan reading before partitioning. Held-under-cover support is separate.
Empty readings remain explicit.
The report measures direct cover before projection and downstream processing.
The field semantics are documented in AUTHORING's source projection cover entry.

### Plate receipt

`comfy plate` (issue #1183) writes `receipt.json` beside `plate.png` and
`mask.png`, spec `rig-parts-plate-receipt/1`. The keys, order and meaning are
fixed for each mode and source variant documented below. Incompatible changes
require a new spec version. Paths are relative to the receipt's directory.

| key | meaning |
| --- | --- |
| `spec` | `"rig-parts-plate-receipt/1"` |
| `mode` | `"background"`, `"foreground"` or `"occluder"` (issue #1230, additive) |
| `painting` | `{ path, sha256 }` of the painting read |
| `occluder` | present only when `mode` is `"occluder"` (issue #1230, additive), right after `painting`: `{ path, sha256 }` of the `--occluder` RGBA image the mask was read from |
| `mask` | `{ source, from, path, sha256 }`: `source` is `"seethrough"`, `"figure-mask"`, `"matte"`, `"classified"` or `"occluder"`, `from` the source directory (the declaration file for `"classified"` or the occluder image for `"occluder"`), `path` the mask actually used (`mask.png`, opaque white inside) |
| `mask_classification` | classified sources only (issue #1267, additive): `{manifest_sha256, prop_clips: [{id, clipped_px}]}`. `manifest_sha256` hashes the exact declaration bytes. Each `background-prop` has an entry counting its pixels clipped after background mask growth. Foreground records zero clips for each prop |
| `model` | `{ name, checkpoint_sha256, checkpoint_sha256_from }`, or null for `foreground`. `checkpoint_sha256` is the `--checkpoint-sha256` value, lower-cased; `checkpoint_sha256_from` is `"declared"`: the box reports no hash, so this field is **declared, not measured** |
| `params` | every parameter of the run, the seed included, in a fixed order per graph: `lama` — `seed`, `grow_px`, `mask_alpha_above`; `core` — `seed`, `grow_px`, `steps`, `cfg` (`--cfg`, default `6`), `sampler`, `scheduler`, `denoise`, `prompt`, `negative`, `mask_alpha_above`; `foreground` — `mask_alpha_above`; `occluder` — the `lama` or `core` list with `holes` (`--holes`) before `mask_alpha_above`, which is `0` |
| `graph` | `"rig-parts/plate-background-lama/1"`, `"rig-parts/plate-background-core/1"`, or the fixed local id `"rig-parts/plate-foreground/1"` |
| `gpu` | the device `/system_stats` names (the same seed gives other pixels on another GPU), or null for `foreground` |
| `grid_transform` | present only when `mode` is `"background"` or `"occluder"`, `graph` is `"rig-parts/plate-background-core/1"`, and the painting's width or height is not a multiple of 8 (issue #1209, additive): `{ source: [width, height], padded: [ceil(width/8)*8, ceil(height/8)*8], pad: [0, 0], pad_fill: "edge-replicate", mask_pad_fill: "zero", inverse: "crop" }` in that key order. Omitted for on-grid `core`, `lama`, and `foreground` |
| `output` | `{ path, sha256 }` of `plate.png` |

Existing mask sources retain their defaults and receipt bytes.

The receipt is read back against the bytes on disk before `<out>` is published;
a hash that is not its file's refuses the run. `verifyPlateReceipt` also
re-derives `grid_transform` from the decoded painting, `mode` and `graph`, and
refuses a missing, unexpected, malformed or mismatched transform as
`PLATE_RECEIPT_GRID_TRANSFORM`. For off-grid `--graph core` paintings, the
uploaded painting is padded on the right and bottom by replicating its edge
pixels (`pad_fill: "edge-replicate"`), the uploaded grown mask is padded with
zero (`mask_pad_fill: "zero"`, kept as context outside the hole), the box's
output is required at `padded` dimensions (`COMFY_PLATE_SIZE` otherwise) and
cropped at `[0, 0]` back to `source` before pasting inside the native mask, so
pixels outside the hole equal the painting byte for byte. On-grid `core`
paintings retain their original upload bytes and graph. Existing mask sources
still write the 9-key receipt for on-grid `core`. Because
every painting grid is covered by this transform, `PLATE_CORE_GRID` is retired.

### Classified plate mask source

`--mask-from classified:<manifest.json>` is additive for background and
foreground plates (issue #1267). The declaration has these fields.

| field | meaning |
| --- | --- |
| `spec` | `"rig-parts-plate-components/1"` |
| `parts_dir` | directory containing `parts.json` and its scene's `figure_rig.png`, relative to the directory containing the declaration |
| `painting_sha256` | SHA-256 of the exact `--painting` bytes, bound to the source input of the completed `rig-run/1` assemble stamp |
| `figure_mask_sha256` | SHA-256 of `figure_rig.png`, bound to the stamp's output |
| `parts_manifest_sha256` | SHA-256 of `parts.json`, bound to the stamp's output |
| `components` | `[{id, role}]` with exactly one entry per current component ID and role exactly `"background-prop"` or `"figure-accessory"` |

Every emitted part PNG must also match the assemble stamp's output hash.
On the native painting grid, using the existing pixel-centre map, components
are the 8-connected regions of the scene mask minus the union of emitted part
pixels with alpha greater than 8, with no minimum size. An ID is the SHA-256
of the UTF-8 compact JSON array of the component's pixel indices sorted in
row-major order. Empty declarations with components to classify and declarations
missing IDs report the IDs, boxes and counts and a paste-ready `components`
array with blank roles. Source failures use `PLATE_COMPONENT_SOURCE` and role
assignment failures use `PLATE_COMPONENT_ROLE`. See
[Classified plate mask](AUTHORING.md#classified-plate-mask).

### Matte source receipt

`comfy matte` writes `model-mask.png` (the exact downloaded grayscale model
output), `mask.png` (opaque binary mask on the painting grid) and `receipt.json`,
spec `rig-parts-matte-receipt/1`. Node and model are explicit flags. The supported
pair is `BiRefNetRMBG` / `BiRefNet-HR-matting`. The model file must also appear in
`/models/RMBG` before any upload. Queue submission appends behind existing jobs.
The node has blur and offset zero, inversion and foreground refinement disabled.

The ordered receipt keys are `spec`, `painting`, `model`, `params`, `graph`,
`gpu`, `input_transform`, `input_sha256`, `raw_output`, `output`. `painting`
records its relative path and the SHA-256 of the source file bytes. `model`
records node, name, `checkpoint_sha256` and `checkpoint_sha256_from: "declared"`.
`params` records every node option, resolution, threshold and
`mask_rule: "red-above-threshold"`. `graph` records
`id: "rig-parts/matte-BiRefNetRMBG/1"`, the submitted API graph and its SHA-256
(over UTF-8 `JSON.stringify(api)`). `gpu` is the device the server names.
`raw_output` and `output` each record a fixed relative path, SHA-256, width and
height. Paths to output masks cannot redirect the reader to another file.

For a non-square painting, `input_transform` uses the #1197 shape documented
below. Its `pad_fill` describes the model's input after `LoadImage` IMAGE
separates alpha from RGB. The matte graph feeds that IMAGE output to the model.
`input_sha256` binds the prepared PNG upload. Square paintings retain their
original upload bytes and record a null transform. Resolution defaults to 1024
and applies to the non-square prepared square. It must be a multiple of 8 in
[64,2048]. The threshold defaults to 10 and must be an integer in [0,254].
Each grayscale byte strictly above the threshold becomes foreground. The recorded
nearest-pixel-centre inverse maps that classification to the painting grid.

`--mask-from matte:<dir>` binds the supplied painting's exact bytes, both mask
file hashes, the prepared input, the complete graph, and the final mask's exact
reproduction from the raw mask and recorded parameters. Missing or legacy
receipts, another painting, tampering, inconsistent geometry and empty masks
are named refusals before any plate output or network request. A matte source is
available to both plate modes. Staged output is read back before publication.

### Head-crop preflight stdout

`head-crop-preflight` writes one JSON object followed by a newline on success,
with `spec: "rig-parts/head-crop-preflight/1"`. Its fields are

| field | meaning |
| --- | --- |
| `head_box` | supplied `[left, top, right, bottom]` in painting coordinates |
| `source_canvas` | supplied painting `{ w, h }` |
| `run_canvas` | full-run `{ w, h }` |
| `drawn_alpha_above` | exclusive alpha threshold, `8` |
| `pixel_grid` | `"full-run"`, the native sample grid |
| `registration` | `{ scale_source_per_run, pad_left, pad_top }`, mapping run sample centres into painting coordinates |
| `layers` | rows in full-run layer order, including zero-hit tags |
| `layers[].tag` | full-run layer name |
| `layers[].drawn_px` | native samples above the alpha threshold |
| `layers[].sides` | `{ top_px, left_px, right_px }`, samples beyond those crop edges |
| `layers[].bottom_px` | samples beyond the bottom, separate for `extend_below_crop` |

Corner samples count on both edges. Counts remain native samples before ghost
cleanup. A positive count reports clipping and unknown input is not a negative.
Each hit tag gets one `HEAD_CROP_PREFLIGHT` advice line on stderr. Valid clipping
exits zero. Malformed geometry or a box outside the painting is refused before
JSON is emitted. This command writes no files.


`assemble` and `build` declare `painting_in_rig` in parts.json as
`{ path: "painting_in_rig.png", sha256, resample: "lanczos3-rgb-opaque" }`.
The sibling PNG is the exact rig-resolution raster assemble used: source RGB
forced opaque before PIL-exact Lanczos3 resizing to `rig_size`. Package readers
verify its file hash, dimensions and opaque alpha. Legacy manifests may omit it.
Readers released through 2.17.0 refuse this new top-level key as
`PARTS_KEY_KNOWN`; use a reader that supports the declaration.
Adding the declaration makes earlier revision and depth receipts stale under
their existing whole-file parts.json identity contract; regenerate them.
Check's setup-painting comparison still flattens over its backdrop at source
resolution before resizing; it can differ for non-opaque paintings.


### Painting reference writer

`@rig-c/parts/src/painting-reference.ts` exports
`writePaintingReference({ manifest, source, config })`. Each input is a
`{ path, sha256 }` seal with an explicit expected lowercase SHA-256. The manifest
is the existing `parts.json`. The writer checks the recorded positive safe-integer
`rig_size` and scale against the sealed source/config through the existing frame
helpers, then calls `sourceInRig` and the existing PNG codec. It writes no parts,
meshes, measurements or manifest changes.

The two added files are `painting_in_rig.png` and `painting_in_rig.json` beside
that manifest. The JSON has exactly these keys in order:

```json
{
  "schema": "rig-parts-painting-reference/1",
  "manifest_sha256": "<sha256 of exact parts.json bytes>",
  "path": "painting_in_rig.png",
  "sha256": "<sha256 of exact PNG bytes>",
  "resample": "lanczos3-rgb-opaque",
  "rig_size": [1920, 1080]
}
```

`rig_size` is the recorded `[W,H]` tuple, with positive safe integers. `path` is a
literal portable relative path from the sidecar directory, which is the loaded
manifest directory. `parsePaintingReference(value)` validates the six-key grammar.
Consumer admission validates manifest SHA, package containment, PNG hash, RGBA8,
opaque alpha and exact dimensions. The consumer selects an inline
`parts.json.painting_in_rig` declaration first and uses this adjacent fallback
only when the inline key is absent. Existing manifest image roles are unchanged.

This is a public Bun/TypeScript API subpath. The package ships `src` and has no
`exports` map restricting it. A consumer with a package containing this module
can invoke the normal producer writer directly:

```ts
import { writePaintingReference } from '@rig-c/parts/src/painting-reference.ts';

const receipt = writePaintingReference({
  manifest: { path: 'accepted/parts.json', sha256: expectedManifestHash },
  source: { path: 'inputs/painting.png', sha256: expectedSourceHash },
  config: { path: 'accepted/config.json', sha256: expectedConfigHash },
});
```

Run the consumer with Bun and retain `receipt` outside the inspected package.
An approved source consumption must resolve this updated source package. An
older installed package that lacks the module requires that source consumption
or a release carrying the module. The API does not register a project record.

The writer validates all input seals and destination collisions before staging.
Run mode comes from the manifest's `ghost_px` census: assemble records every
full/head layer, including zero ghost counts, and only single-run assembly omits
the head census. A full census is required. A resolution-square single run has
no `single_run_pad`; that absence does not imply two runs. A non-square single
run requires its recorded pad, whose `file_size` and `side` must match the sealed
source/config. Head-run census still requires a head box, even with an all-full
plan. Contradictory run, part, plan or padding evidence refuses under
`PARTS_PAINTING_REFERENCE_FRAME` before writing. The writer derives no missing
run-mode field from an image guess.
It publishes complete files with no-replace links, PNG first and sidecar last.
The sidecar is the declaration commit point. A partial I/O failure can leave a
complete unreferenced PNG. An exact retry verifies it and finishes the declaration.
Concurrent exact writers return the same seals. Conflicting destination bytes,
symlinks and moved inputs refuse. The caller keeps independent input writers
frozen during the operation. Only this invocation's staging directory is removed.

The returned `rig-parts-painting-reference-write/1` receipt carries the three
input seals and both output seals. Retain it with the execution/source receipt
outside the inspected package. It describes this derivation from sealed inputs.
All original manifest, texture, depth and revision bytes retain their identities.
The accepted-file inventory gains the two declared additions. No producer
execution in historical evidence is inferred from a current export.

| Refusal | Meaning and remedy |
| --- | --- |
| `PARTS_PAINTING_REFERENCE_INPUT` | A named input is unreadable, unsealed, a symlink or invalid JSON/PNG; restore the explicit frozen regular input. |
| `PARTS_PAINTING_REFERENCE_HASH` | A named input differs from its expected SHA-256; restore its sealed bytes. |
| `PARTS_PAINTING_REFERENCE_FRAME` | The manifest frame differs from sealed source/config geometry; supply the original source/config and recorded frame. |
| `PARTS_PAINTING_REFERENCE_SCHEMA` | The named declaration breaks its six-key grammar; restore the producer sidecar. |
| `PARTS_PAINTING_REFERENCE_OUTPUT` | A named output conflicts or is unreadable; preserve its bytes and resolve the collision. |
| `PARTS_PAINTING_REFERENCE_WRITE` | Publication failed; preserve existing files and retry with the same sealed inputs. |

| file | written by | what is stable |
| --- | --- | --- |
| `stage-map.json` | `assemble`, `build`, under `assemble.stage_map: true` | `rig-parts-stage-map/1`, cropped last-writer and pre-seam RLE maps with writer dictionaries and excluded counts. See [Per-pixel stage map](AUTHORING.md#per-pixel-stage-map). |
| `parts.json`, `parts/<name>.png` | `assemble`, `build` | one record per part: `from` (`<run>:<tag>` with a See-through v3 tag, `<run>:author:<label>` for a layer the author made — issue #256, read by no role rule — or `painting:<name>` for a patch), `cut_from` on a cut's piece only (the plan part it was cut from, issue #230), `limb` on a limb segment's part only (issue #349: `name`, `segment`, `of`, `bone`, and below a joint `joint`, `range` when the config segment declares one (issue #360), and `cap` — `at`, `width`, `radius`, `box`, `layer_px`, `image_px` with a cap image, `image_layer` after it when that image was a hidden-art layer — issue #359, `<run>:<layer>:hidden` — `missing_px`, `short_px` (`left`, `right`) after it only when `missing_px` is above 0 (issue #557, additive), `excluded_px` after them only on a subset set's limb part whose cap the set exclusion took a pixel of (issue #603, additive: each pixel taken out of the count it was in, so the cap's counts are the written PNG's), then `shape` and `upper_px` under the segment's `cap_shape` — `upper_px` without the shape only when the upper segment gave a pixel (issue #557, additive) — and after them `lower_px`, `lower_kept_px` and `lower_missing_px` under `cap_shape: "ball"` (issue #579, additive), and `edge`, `feather_radius` and `feathered_px` under its `edge`, and `cut_band`, `cut_offset`, `cut_at`, `cut_crossed`, `joint_crossed`, `band_px` and `stroke_luma_max` (when the band has a split) under its `cut_band`, issue #360), the box `x`, `y`, `w`, `h` (rig px), the pixel counts `src/parts.ts` documents (`opaque_px`, `visible_px`, `occluded_px`, `projected_core_px`, `source_px_taken`, `visible_not_projected_px`, `refused_drift_px`, `merged_px` — on a subset set's limb part counted after the set exclusion, issue #603 — `seam_override_px`, and `fringe_pushed_back` when not empty); per-part `taken_layers` (with optional `transport`, issue #973, and optional `split` — `occluder`, `image`, `sha256`, `covered_px`, `visible_px` — on a split take, additive, issue #1242) and `provenance` (`unchanged_layer_px`, `hand_px`, `automatic_px`, `edits`, `automatic`, additive, issue #823); optional top-level [`assembly_config`](#assembly-config-reading), `motion_seams`, `occluder_plates` (one record per `assemble.occluders` entry declaring `plate` — `receipt`, `receipt_sha256`, `occluder_sha256`, `painting_sha256`, `output_sha256`, `mask_sha256`, additive, issue #1237), `occluder_grow` (one record per `assemble.occluders` entry with `grow > 0` — `occluder`, `image`, `grow`, `covered_px_before`, `covered_px_after`, additive, issue #1251), `occluder_guard` (one record per `assemble.occluders` entry with `guard > 0` — `occluder`, `image`, `guard`, `guarded_px_before`, `guarded_px_after`, additive, issue #1259), `alternates` and `cut_ownership` (one row per cut, independent of RGBA equality, issue #823, with optional `under_plate` — `receipt`, `receipt_sha256`, `occluder_sha256`, `painting_sha256`, `output_sha256`, `mask_sha256` — on a `{plate}` under, additive, issue #1230); `rig_size`, `scale_rig_per_source`, `ghost_px`, `recomposite`, and `scene` (`figure_alpha_above`, `figure_px`, `figure_mask`) under `config.scene` only, with the figure's mask `figure_rig.png` beside the recomposite (issue #242), and the same bytes beside `parts.json` when the two directories differ (issue #1177); `single_run_pad` (`file_size`, `side`, `left`, `top`) last, only for one run whose file is not the `seethrough.resolution` square (issue #366) |
| `rig/rig.json`, `rig/motion.json`, `rig/images/` | `rig`, `build`, `compose` | rig-c's rig spec and motion spec, `spec` `rigc-rig/1` and `rigc-motion/1`: the format is rig-c's, and this package writes only what rig-c's parser accepts; a bone carries `inherit` only where config.bones declares one, rig-c's mode name as written (issue #348) |
| `rig/mesh_report.json` | `rig`, `build` | one row per mesh: `part`, `vertices`, `triangles`, `hull`, `bones` (the sorted names the attachment's weights bind in the written `rig.json`, in every mode — since 1.49.1 (issue #536) a rig with `turn` or `stops` names the twins and `<link>_d` bones there, where the row named the segment bones they replace: a fix of a wrong name, not a format change; a rig with neither writes the bytes it wrote), `max_influences`, `mean_influences`, `art_coverage`, then `grid` (a lattice); or `mode` "explicit" with `image_sha256` and `region_sha256` (the verified guards; counts and coverage are measured from the supplied mesh, no legacy generator report is adopted); `mode` "contour" with `params`, `contour`, `regions` (`params.maxEdge` and `contour.outlineCut` only when the mesh declares `contour.maxEdge`; `params.bridges` and `contour.bridges` — `islands`, `units`, `joins`, and `faint` only when an island was left out as faint — only when it declares `contour.bridges`); or `mode` "influence" with `influence` (as declared), `reach` (`farthest`, `at`, `nearest`, `capped`, `widest`) and `lattice` (rig-c's `SegmentsLatticeReport`: `cols`, `rows`, `artCells`, `keptCells`, `passes`, `islands`) (issue #378); or `mode` "auto" with `settings`, `source`, `result`, `residuals`, `worst_residual`, `worst_region`, `motion_amplitude`, `termination`, `weights`, `regions`, `deformation`, `quality_report` (rig-c's `mesh-quality-report/1` document whole), `motion_report`, and, only when they apply, `stray_cleared` (after `source`, when `source.stray` is declared), `skinning_residual` and `replay` (`AutoMeshReport` in `src/rig.ts`); in every mode, `exponent` when the mesh declares one (after `grid`, or after `mode`); `influences`, as declared, when a lattice or contour mesh declares it (after `exponent`, or where `exponent` would be); `stray` and `stray_cleared` when a lattice mesh declares `stray` (after `influences`, or where `influences` would be); `ribs` when a contour or auto mesh declares them (after `exponent`, or after `mode`), and then `contour.ribs` (`source.contour.ribs` in the automatic mode) |
| `check/check.json` and the rest of `check/` | `check`, `build`, `compose` | [Check verdict spec](#check-report-rig-parts-check1) followed by the reference's fields in its order (`gate_spine_html_green`, `rigc_entry`, `pack_mode` (with `page_size` under `--page-size` only, issue #1273, additive), `environment` after it under `--environment` only (issues #538, #1554, additive: `path` relative to `check`'s `--out`, `sha256`, `steps`), `loop_max_diff`, the seam figures — `seam_mean`, `seam_px_over_40`, `seam_px_over_80` and, from issue #216, `seam_frame_scale`, the frame scale the bar divides the count by), `loop_physics` after `loop_max_diff` when the rig declares a physics constraint, `seam_border` after the seam figures when `parts.json` declares a scene (issue #242), `seam_pairs` after the seam figures when the seam bar fails or `--seam-pairs` asks (each row's picture under `check/seam/`; `--keep-stills` leaves the setup-pose still and its `frames.json` under `check/setup_still/`), then the judgement lines (`BREATH_VISIBLE`, `BLINK_NO_HOLE`, `CHAIN_LAG`, `TIP_OVER_ROOT`, `STILL_REGIONS_DARK`, `TEXTURE_STRETCH`), `ANIMATIONS_DO_NOT_FOLD` after them when `motion.json` holds an animation, the idle included — on every rig with an idle since issue #333 (issues #320, #363: `status`, `animations`, `fps`, `physics_left_out`, `folding` — each `animation`, `slot`, `attachment`, `frames`, `worst_frame`, `worst_triangles`, `triangles`, `physics_on`, `physics_off`, `physics_constraints`, `declared`, `line` — `folding_undeclared`, `declared_not_folding`, `bar`), `FEET_STAY_LEVEL` after it when a `footwear` part rides a bone that hangs from another and `motion.json` holds an animation (issue #348: `status`, `reason` on a SKIP only, `animations`, `fps`, `physics_left_out`, `bar_degrees`, `bar`, `feet` — each `part`, `bone`, `hangs_from`, `status`, `frames_posed`, `worst`), `LIMB_ONE_BONE` after it (and after `STRESS_OFF_CHAIN` where that is written) when `parts.json` holds a limb segment's part (issue #349: `status`, `parts` — each `part`, `limb`, `bone`, `status`, `others`), `SEAM_OVER_RANGE` after it when a limb record carries a `range` (issue #360: `status`, `frame_scale`, `physics_left_out`, `bar` — `mean`, `rig_px_over_40`, `level` — and `joints`, each `part`, `limb`, `segment`, `joint`, `bone`, `range`, `at`, `radius`, `under_px`, `status`, `poses` — each `degrees`, `status`, `mean`, `px_over_40`, `px_over_80`, `rig_px_over_40`, and `step_px` (`left`, `right`) only on a joint whose cap record carries `short_px` (issue #557, additive) — and `unread` on a joint not read), `SEAM_OVER_MOTION` after it when `parts.json` holds a limb segment or `--requirements` a `seam` (issue #493 retains existing pair warnings; issue #686 gates proven body-root pairs only, on gapOpen plus UNDER-owned ghost: `status` — `WARN`, `CLEAR`, `SKIP` or `FAIL` — `reason` on a SKIP only, `fps`, `floor`, `pairs` — each `pair`, `a`, `b`, `declared`, optional `root` (`limb`, `bone`, `parent`) on a proven body-root pair, and `unread` on a pair not read — `animations`, `warnings`, `rows` — each `pair`, `animation`, `status`, `drawn`, `banded`, `opens`, `px`, `max_px`, `under_floor`, and only on new-root rows stock `gapOpen` plus UNDER-owned `ghostA`/`ghostB` cells selected by resolved per-frame draw order gate their summed count against the unchanged strict one-cell floor on the original raw kind boxes (their union when both kinds contribute), never narrowed partition boxes, while `gapCovered` and OVER-owned ghost cells are excluded (issue #711); `cells` retains partition counts, UNDER owner and counted total, `worst` retains frame/count/cell/box, and `roots` retains status, mode `gap-open+under-ghost`, ghost_owner `resolved-draw-order`, pairs, failed, reason and optional unmeasured bindings; eligible candidates whose valid setup bands are all zero retain a named unmeasured root and SKIP bar, including when no pair is selected; measured root FAIL wins over SKIP, while measured PASS plus an unmeasured root remains SKIP; every eligible body drawing with stock setup `banded > 0` is selected, including both when a parent is shared; issue #708 resolves a body slot on its exact generated turn child to the same named carrier only after unique identity-bone/control/per-part-transform proof, without changing pair identity, setup selection or the direct-carrier path; setup-only observation preserves the authored motion and default drawing, root-free inputs add no setup compile/render, and no animation remains SKIP rather than a measured zero; existing internal pair warnings and their exits are unchanged; issue #941 adds optional `required` only under the requirements file's `seam_over_motion.required: true` — `status` (`PASS` or `FAIL`), `mode` `gap-open`, `bar_px` 0, `pairs` (each `pair`, `class` — `body-root`, `internal-joint` or `explicit` — `frames`, `background_frames`, `max_px`) and `failed` — and with it the key is written even when no pair is declared; issue #591 adds optional `worlds` on physics rigs with readable declared pairs and animations: `default` and `still`, each `wind`, `gravity`, `status` (`REPORTED` or `SKIP`), `reason` on SKIP, `dir` only when rendered (relative to check.json: `seam_motion/default` or `seam_motion/still`, the complete retained render with frames.json and each animation's raw seam.json), and `rows` — pair, animation, status, drawn, banded, `gap` and `ghost`, each `max_px` and `worst` only; worst carries `index`, `px`, `cell`, `box`. Per-frame hits stay in the raw sidecars. These raw reference readings add no bar or warning and leave the custom environment reading unchanged), `CLOTH_SETTLES` after it when the rig declares a physics constraint and has an idle (issue #501, a warning and not a bar: `status` — `WARN` or `CLEAR` — `fps`, `frames`, `duration`, `floor_rig_px_per_s`, `floor`, `levers`, `warnings`, `rows` — each `tip`, `root`, `links`, `point`, `settles_at`, `max_rig_px_per_s`, `min_rig_px_per_s`), `PHYSICS_CONTRIBUTES` after it when the rig declares a physics constraint and has an idle and parts (issue #1320, report-only, no bar and no threshold: `status` — `WARN` when a part under physics reads exactly 0, else `CLEAR`; a named `SKIP` writes no key — `off` (what "physics off" means: the same compiled build posed with the poser's physics off, not the spec with its constraints left out), `points`, `world`, `poser`, `fps`, `frames`, `warnings`, `rows` — each `part`, `constraints`, `external_force`, then `vertices`, `frames_read`, `max_rig_px`, `p95_rig_px`, `mean_rig_px`, `max_of_diagonal`, `moves`, or `unmeasured` with its reason), `RECOMPOSITE_HOLES` (its first figure `declared_scene` when `parts.json` declares a scene), `SETUP_POSE_VS_SOURCE`, `WIND_BAND` after it under `--wind-band` only (issues #590, #1554, additive: `status` `"REPORTED"`, `spec` `"rig-parts-wind-band/1"`, `path` relative to `check`'s `--out`, `sha256`, `steady_wind_only` `true`, `gravity` `[0, 1]`, `min`, `max`, `step`, `steps`, `fps`, `animations`, `max_gap`, `max_ghost`, `holds_from`, `holds_to`, `pairs_holding_all`, and `pairs` — each `pair`, `a`, `b`, `holds_all`, `holds_from`, `holds_to`, `first_break_below`, `first_break_above`, `worst_gap`, `worst_ghost`, `steps`), `skipped` (written when `seam` has no `parts.json`, or when `loop` has no `idle` or omitted physics constraints on a closed physics-off idle, issue #1590), `config` under `build` only (issue #607, additive: `path` as `--config` was typed, `sha256` of the bytes the build read; `check` and `compose` read no config and write none), a `requirements` block under `--requirements` (or `build`'s `config.requirements`) — `file` first from issues #556 and #1554, additive: `path` relative to `check`'s `--out`, `sha256`, `keys` — and `PASS`; `check/build/skeleton.json`, `.atlas` and `.png` are the packed artifact rig-c writes, and `check/build-report.json` (`<out>/build-report.json` under standalone `check`) is rig-c's own `build-report/1` (`--report`) for that primary packed compile, written verbatim by `rigc` beside `check/build/` (and listed in `check/build/run.json`'s `outputs[]` as `../build-report.json`) on a failing compile as on a green one (issue #1394; `rig` keeps no compile report because its gate and `--lead-in` compiles are throwaway scratch runs whose outputs are deleted). Missing stock partitions or resolved owner are named refusals, never zero. No whole-box exemption or consumer compositor remains; internal warnings and reference raw readings are unchanged. |
| `part_support_domains.json` | `assemble`, `build` | optional `rig-parts-support-domains/1` independent cut masks and unavailable reasons, with per-domain config-entry provenance and parts/PNG/payload digests; additive beside parts.json, whose bytes and PNGs are unchanged. Legacy output may omit it. `PART_SUPPORT_REPORT` reads pairs in the assembly placement frame and Unowned in actual setup, never as an acceptance gate. |
| `layers.json`, `<index>_<name>.png` | `layers --export` | the wrapper form `layers` reads (issue #359): `width`, `height`, then `layers` — each `name`, `filename`, `left`, `top`, `right`, `bottom`, `depth_median` (the input's own; `null` for a PSD, the manifest's order then being the draw order) — drawn layers in draw order, then the hidden-art layers; a PNG's name is its index and its layer's name, and the manifest, not the file name, says which layer it is |
| the template `.psd` | `layers --template` | one empty layer per name `templateLayerNames` (`src/layers.ts`) holds, bottom first; the same canvas writes the same bytes |
| `proposal.json`, `render/landmarks*.png` | `propose` | the config's four rig sections, `constraints` with `--cloth` (issue #364: a physics constraint per tree link named `<bone>_physics`, a dangling end's `<bone>_translate`, and a skirt swing's transforms `<swing>_<tree>`), `turn` with `--full`/`--head`, `proposed_rig_scale` (issue #354), and `notes` |
| `basis.json` | `propose` | spec `spine-parts-basis/1` |
| an existing config named by `--write-config` | `propose --head-box`, `assemble --propose-plan`, ordinary `propose`, sampled-turn neck draft (`propose … --full --head --write-config`, issue #826) | issue #356, additive: `assemble --propose-plan` must update `--config` itself; only the selected proposed fields are replaced by whole-value text splices, preserving untouched bytes; absent optional proposal sections and other fields remain; the stage loader validates before atomic replacement, relative paths keep their base, an unchanged update preserves bytes and mtime, and stderr lists changes; no multi-artifact transaction is promised; with `--only-missing` (issue #671) only a `meshes.<part>` or `regions.<part>` entry for a proposed part the config attaches by neither is added, and an `assemble.plan` row for such a part the 1.37.0 arm split makes that the plan does not name, every existing row and entry and every other byte as read |
| a new `--write-config` file | `propose --cloth … --write-config` | complete checked splice text published without overwrite; an intervening creator is refused, while cleanup failure after publication may leave the complete new file present; intentional partial configs retain their existing contract; the `--cloth` config read, byte for byte, but for the entries the recipe drafts (issue #537), measured against the same parts drafted without it: `meshes.<part>` and `regions.<part>` for each part the recipe moves, and `bones`, `constraints` and `motion.tracks` entry by entry by name (issue #552) — an entry the recipe drafts replaced or inserted, one it replaces removed, every other entry kept with its bytes and its place, and a hand edit to an entry the recipe owns refused by name (`PROPOSE_WRITE_CONFIG_CONFLICT`) rather than dropped; a section the input lacks is inserted; with `--from <previous config>` (issue #571) an entry equal to the previous recipe's draft is the recipe's as well |
| `config.json`, `mesh_draft.json` | `mesh-draft` | `config.json` is the config read, byte for byte, but for each drafted part's `meshes` entry; `mesh_draft.json` is spec `rig-parts-mesh-draft/1`: `rules`, `lattice_check`, `draft_check`, `figure_overdraw`, and per lattice part `part`, `mode`, `lattice`, `candidate` (with `bridges` — `units`, `joins` of `span` and `area_px2`, `area_px2`, `overdraw`, and `faint` only when an island was left out as faint — only when the candidate is a bridged one, issue #326), `delta` (under `--more-triangles` only), `readings`, `gate` (each line's `reading`, `pass`, `text`, `margin`), `note`; and `not_compared` (issue #307), only when the config holds an `auto`, `contour`, `influence` or `explicit` entry: per such entry, in config order, `part`, `mode` and `note` — the part was neither drafted nor compared, and a config of lattices alone writes no such key |
| `rig.json`, `motion.json`, `mesh_report.json`, `images/`, `remesh.json` | `remesh` | the input revision's files, `rig.json` and `mesh_report.json` with the part's attachment and row replaced (under `--delta` the row is the input's with its counts, `bones` and influences recomputed and `mode` "delta"), every other file byte for byte; `remesh.json` is spec `rig-parts-remesh/1`: `request` (`part`, `mesh`, `mesh_sha256`, `idle_keys`, `page_edges`, `pack_shape`; under `--delta`, issue #526: `part`, `delta` — the mesh edit as read — `delta_sha256`, `ops`, `applied` — `moved`, `added`, `removed`, `constrained` — `idle_keys`, `page_edges`, `pack_shape`), `versions` (`parts`, `rigc`), `input` (`rig` — `path`, `bytes`, `sha256` per file — `config_sha256`, `parts_json_sha256`), `baseline` (`reproduced`, `not_compared`; under `--delta` `reproduced` holds one sentence: no config is built, the input is the baseline), `target` (`before`, `after`: `vertices`, `triangles`, `hull`), `preserved` (`identical`, `spliced`), `revision` (per file as `input.rig`), `check` (`input`, `revision`: `pass`, `measured`, `not_met`, `skipped`, `physics`, then `line` and `status` — issue #541, additive, the spec stays `rig-parts-remesh/1`: `line` is the last line `check` prints on that tree, byte for byte, and `status` every block's status as that tree's `check.json` records it, by name in the file's order — `gate`, `loop` and `seam` read from their figures, every other block its own `status`, a block the file does not write absent; `scope`) |
| `rig.json`, `motion.json`, `mesh_report.json`, `images/`, `retune.json` | `retune` | the input revision's files, `rig.json` with `constraints` and `invariants.detached` replaced and `motion.json` with `animations.idle` replaced by the config's build, every other file byte for byte; `retune.json` is spec `rig-parts-retune/1`: `request` (`idle_keys`, `page_edges`, `pack_shape`), `versions` (`parts`, `rigc`), `input` (`rig` — `path`, `bytes`, `sha256` per file — `config_sha256`, `parts_json_sha256`), `held` (`compared`, `not_compared`), `changed` (`constraints` — each `name`, `type`, `fields` — `added`, `removed`, `idle`: `tracks_changed`, `duration` as before and after), `preserved` (`identical`, `spliced`), `revision` (per file as `input.rig`), `check` (`input`, `revision`: `pass`, `measured`, `not_met`, `skipped`, `physics`, then `line` and `status` — issue #541, additive, the spec stays `rig-parts-retune/1`: `line` is the last line `check` prints on that tree, byte for byte, and `status` every block's status as that tree's `check.json` records it, by name in the file's order — `gate`, `loop` and `seam` read from their figures, every other block its own `status`, a block the file does not write absent; `scope`) |
| `input-check.json` | `remesh --record-input-check`, `retune --record-input-check` | spec `rig-parts-input-check/1` (issue #617, additive): `versions` (`parts`, `rigc` — `rigc --version`'s whole output), `options` (`page_edges`, `pack_shape`, `page_size` when `--page-size` is given, `requirements` — null, or `path` as resolved and `sha256`), `rig` and `parts` (`dir` as resolved, `files` — `path`, `bytes`, `sha256` per file: every file under `--rig`; `parts.json` and every file under `parts/`), `check` (the input's check side as `remesh.json` carries it); `--input-check` reads it back, and either command's serves the other |
| composed turn producer inputs | `compose` | issue #1344 intentionally admits previously refused yaw/pitch derive maps, turn deform offsets/transforms, depth-grid generator images, bone inherit modes and producer mesh/fold invariants; every embedded reference is resolved and prefixed except the shared default skin. Mesh-slot ceilings sum and per-mesh triangle ceilings take the maximum, using actual counts only for unbudgeted members. Weighted lengths scale; image-sized depth grids at scale other than 1 are refused by `SCENE_SCALE_EXACT`. Other nested constructs remain refused. Previously passing scene payloads are byte-identical; the existing `check/check.json` requirement is retained, so `rig` plus `rigc build` alone is not a checked character. |
| named scene plates | `compose` | issue #1345 adds optional `plates[]`: required `name`, `image`, `provenance`, `at: [x, y]`; optional `note`, `editor_receipts`, `opaque_backdrop`. `at` is two finite integers for the image top-left in canvas pixels, y down from the top-left origin; negatives/outside allowed, no scale, native image size including oversize. Each bone/slot/attachment uses its declared name, bone under root at `(0,0)`; attachment centre is `stage.x + at[0] + width/2`, `cropToSpineY(at[1] + height/2, canvas.height)`. Each layer's token is required exactly once in draw order, with duplicate/missing/unknown/collision refusals. Names cannot collide with root, legacy plate, shared idle, character ids or prefixed bones/slots/animations; a plate name already refused by `SCENE_PLATE_NAME_FREE` or `SCENE_PLATE_NAME_UNIQUE` does not also draw a cascaded `SCENE_ORDER_COMPLETE` (issue #1350). Only that layer's explicit `opaque_backdrop: true` exempts it from compose alpha checks; an opaque declared backdrop must additionally meet width >= canvas.width AND height >= canvas.height (the rig stage), matching core 3.8.0 A19 size inference; otherwise SCENE_PLATE_BACKDROP_SIZE refuses before emission (placement coverage of the stage is the scene author's, not checked by the tool). Transparent layers have no size floor. rigc A19 remains enabled. Named images use `scene-plate.<index>.png` (atlas region `scene-plate.<index>`, by declaration index) with collision checks. The `[compose]` header line names composed `plates[]` in declaration order (`<N> named plate(s): <name>, ...`) when `plates[]` is non-empty and prints `no plate` only when neither `plate` nor `plates[]` is present (issue #1350). The additive report `plates` array records declaration, native size and PNG hash; absent declaration retains legacy output bytes and fixed first-plate behavior. |
| scene named animations | `compose` | issue #1346 adds optional `scene.animations`, a name-to-rigc-MotionAnimation map resolved against final scene bones/groups/easings. A scene-authored key on `root` moves the whole scene, including plates and characters. Imported character animations, including `idle`, are refused with `SCENE_ROOT_SHARED` if they key `root` directly or through a group. New names add clips at their own declared durations; `idle` appends timelines while retaining existing character tracks, deforms, metadata and physics. Without `idle_repeats`, idle duration mismatch is `SCENE_DURATION_AGREES`. Issue #1511 adds `characters[].idle_repeats`, a safe integer of at least two requiring an explicit scene idle. Its declared duration equals each source period times its count exactly, with an omitted count playing once. Each repeated source must close at its non-wrapping stored end. Character keys and absolute Bezier time handles repeat on the source clock, with one equivalent key at a shared endpoint and continuous physics across it. Scene timelines append once, prefixed side clips keep their durations, and the gated composed idle also closes at its stored end. `scene.json` retains each source `idle_duration`, adds `idle_repeats` only on opted-in rows, and gives the scene period as top-level `idle_duration`. `compose-run.json` keeps its schema. Imported non-idle names remain reserved. Core owns missing fields, unknown bones/references, duplicate property tracks and bad times. Unknown prefixed bones also name the character ID. Generated names `<id>:yaw_dial`, `<id>:pitch_dial`, and `<id>:<turn.body.slider>` (default `<id>:body_yaw_dial`) are stable; renaming them requires a major version. A dial exists only when generated by its character. Rotation keys use that slider's declared `[from, max]` bounds; out-of-range values are `SCENE_DIAL_KEY_RANGE`, unreadable bounds `SCENE_DIAL_RANGE_DECLARED`, never guessed. Slider-input keys require explicit numeric values; derive inputs are refused as `SCENE_DIAL_KEY_DECLARED`, including derive alongside a raw value. Bounds apply to the matching scalar or paired translate/scale/shear input channel; inherited group names are refused with `CE_COMPILE_ANIMATION_GROUP_UNKNOWN`. Each declared clip's gated posed endpoint values at 0 and duration with physics omitted must agree before emission (`SCENE_ANIMATION_LOOP_CLOSES`); physics-on frames are not measured by this check. Absent declaration retains stable output bytes at the same paths. Core `check/build/run.json` records fresh `started_at` and `finished_at` clocks; comparisons report these raw differences separately and require all other receipt fields and output bytes to match. |
| scene loop refusal detail | `compose` | Issue #1358 enriches `SCENE_ANIMATION_LOOP_CLOSES` with the first differing bone or slot, channel, start/end values and numeric tolerance 0 (exact equality), and issue #1590 states in the detail that it checks posed endpoint values with physics omitted and does not measure physics-on frames. The existing exact JSON endpoint comparison is unchanged: bones, slots, draw order, drawn geometry, clipping polygons and clipped geometry remain covered. Selection follows that family order, then producer row and field order; geometry-only differences name the slot and geometry channel. Physics is omitted from this posed-value comparison, and the refusal code, acceptance, emitted rig/motion and built scene bytes are unchanged. |
| scene canvas framing | `compose` | Issue #1491 adds optional `characters[].canvas_clip` to `spine-parts-scene/1`. Literal `true` requires finite placed bounds, overflow past a canvas edge and an intersection with positive width and height. The respective refusals are `SCENE_CHARACTER_CLIP_BOUNDS`, `SCENE_CHARACTER_CLIP_UNUSED` and `SCENE_CHARACTER_CLIP_EMPTY`. Other explicit values are `SCENE_FIELD_TYPE`. Omitting the key retains the exact containment rule, output bytes and console text. The opted-in character row in `scene.json` adds `canvas_clip: true` and `clipped_bounds` after the original `bounds`. Both boxes are canvas pixels, y down, with exclusive right and bottom edges. The console appends the clipped box only for those rows. The rig-c gate and packed build retain the full art and geometry. For a scene with any opt-in, compose check renders use the stage viewport unless the render specifies its own. Preview size caps and sampling stay in effect. Native-size renders and consumer playback use the authored stage rectangle as described in [Canvas framing for intentional overflow](AUTHORING.md#canvas-framing-for-intentional-overflow-issue-1491). |
| scene placement pivot | `compose` | Issue #1498 adds optional literal `true` at `characters[].placement_pivot` in `spine-parts-scene/1`. It emits the identity `<id>:placement` under `root` and requires a scene-authored `translate`, `translatex` or `translatey` key in final scene pixels. The existing placement math stays on the original first-level bones, root regions and root weights. Source root bindings use the unkeyed identity `<id>:root` child when needed. `SCENE_FIELD_TYPE` refuses other explicit values, `SCENE_PIVOT_NAME_FREE` a source bone collision, `SCENE_PIVOT_DECLARED` an unresolved pivot targeted directly or through a bone group without an opt-in, `SCENE_PIVOT_UNUSED` an unused declaration and `SCENE_PIVOT_TRACK` a forbidden property or carrier key. `SCENE_PLATE_NAME_FREE` still governs named plate collisions. Core's unknown-bone refusal, rig gate, scene clip timing and endpoint closure still apply. `scene.json` adds `placement_pivot` with the generated name after the bounds fields and counts the generated bones for that character. `compose-run.json` binds the declaration through `scene.sha256` with its existing shape and key order. Omitting the declaration preserves default output bytes at the same paths, subject to the existing Core receipt clocks. |
| `compose-run.json` | `compose` | spec `rig-compose-run/1` (issue #1348), separate from `rig-run/1`; a stable contract as of 2.44.0. Written at the `--out` root only after the gate and check are green and no accepted failing character remains. Fixed keys in order: `spec`, `scene` (`path`, `sha256`), `characters` (each `id`, `build`, `files`, each file `path`, `sha256`, then optional `placement`), `plate` (`path`, `sha256`, or null), `plates` (each `name`, `path`, `sha256`), then optional `output_profile` (`"preview"` or `"no-extremes"`, issue #1610). Scene and plate paths are the supplied and declared paths; character file paths are build-relative. Characters sort by `id`, files by `path`, named plates by `name`, in code-unit order. Each character's files are exactly `check/check.json`, `parts.json`, `rig/rig.json`, `rig/motion.json` and each distinct image the default skin names under `rig/images/`, including a generator's depth image. Every `sha256` is of the raw file bytes compose consumed before the gate. Only a character with `canvas_clip: true` has `placement`, with `canvas_clip: true`, `bounds` and `clipped_bounds` in that order from the scene report. Identical inputs at identical supplied paths with the same output profile give identical record bytes. The receipt inventories the listed inputs and selected profile, without clocks. Compose owns the name: a file of that name at the `--out` root is deleted at the start of every compose, before stage validation, so a refused rerun leaves none. |
| compose output profiles | `compose` | Issue #1610 adds `--no-extremes` to omit only the extremes diagnostic renders, and `--output-profile preview` to also omit `check/idle_frames/`, `check/contact.png` and `check/motion_heat.png`. Preview takes precedence when both flags are given. Preview uses the stock idle render and existing readers. Before preview success, Parts removes the idle render directory, including Core's temporary contact sheet, skips copying the sheet to the check root, and skips generating heat. Each omission has a diagnostic `SKIP` line naming its selected flag. The gate, camera binding and check requirements still apply. Success prints `compose: PREVIEW — checks met; …` or `compose: NO EXTREMES — checks met; …`, respectively, and writes `output_profile` as `"preview"` or `"no-extremes"`. Default compose keeps its existing file bytes (with the nested Core receipt clock comparison described above), output paths and `compose: PASS — …` line. `COMPOSE_PREVIEW_REQUIRED_CHECK` refuses a valid loop seam pair in preview with `found=preview, required=default or no-extremes`, because the `loop_seam` record in `check.json` binds the paths and hashes of first and wrap PNGs that must remain under `check/idle_frames/`. Compose clears its owned outputs before this refusal. See [Compose output profiles](AUTHORING.md#compose-output-profiles-issue-1610). |
| the scene report | `compose` | spec `spine-parts-scene-report/1`; the plate block carries `sha256` of the plate PNG's bytes after `size` (issue #1183, additive under *What "stable" means here*: a new report key in a minor version, so the spec stays `/1`); `pack_mode` records `page_size` only when `--page-size <px>` is given (issue #1352, additive; without `--page-size`, rigc's default 2048 px page and padding 2 on each side bound any plate or region side to at most 2044 px before `CE_ATLAS_REGION_EXCEEDS_PAGE`) |
| keyed scene camera | `compose` | optional `camera` in `spine-parts-scene/1` (issue #1596). A camera scene writes `spine-parts-scene-report/2` at the existing `scene.json` path with its keyed camera, sampled coverage and framing verdict, and packed model SHA-256. Report /1 and the existing output inventory and bytes are preserved for scenes without a camera, subject to the existing Core receipt clocks. The camera path uses Core animation easing and the posed backdrop at each sampled frame. Rig, motion and stock check outputs retain their existing semantics. The compose input receipt stays `rig-compose-run/1`. See [Keyed scene camera](AUTHORING.md#keyed-scene-camera-issue-1596) |
| `idle.png`, `idle-indexed.png`, `idle.gif` | `loop`, `build --loop` | APNG and GIF encodings of the rendered idle |
| `run.json` | `rig`, `assemble` | spec `rig-run/1` (issue #1165, additive): `spec`, `package` (`name`, `version`), `command` (`"rig"` or `"assemble"`), `started_at` and `finished_at` (UTC ISO-8601 millisecond timestamps ending in `Z`, read in the CLI layer), `config` (`path` relative to `--out`, `sha256` of the config file on disk), `inputs` on `assemble` (issues #1316, #1554, additive: one `{role, path, sha256}` entry for each of `--source`, `--full` and `--head` that was given, in that order, with `path` relative to `--out` by the per-platform link rule — naming `<dir>/layers.json` when given a directory — and `sha256` of the file `path` names), and `outputs` (`path` relative to `--out`, `sha256` of each written output file on disk, sorted by `path` in code-unit order and excluding `run.json` itself); written only after the command's gate is green |
| the difference inventory (`--out`) | `diff-components` | spec `rig-parts-diff-components/1` by default (issue #1005: `stack`, `painting`, `definition`, `error_px`, `uncovered_error_px`, `components` — each `id`, `px`, `box`, `coverage`, `uncovered_px`, `borders` — and `below_floor`, byte-identical to 2.38.1), and spec `rig-parts-diff-components/2` under `--owners` (issue #1291: adds `owners` — each `{part, px}`, the topmost `parts.json` part above `COVERED_ALPHA` per covered pixel, back to front — before `borders` on every component); `--verify` verifies both `/1` and `/2` reports (with `--owners`, `/2` is required), while a `/1`-only reader (`readDiffComponents(text, input, [DIFF_COMPONENTS_SPEC])`) refuses `/2` by name |
| the draft comparison (`--out`) | `diff-drafts` | spec `rig-parts-draft-diff/1` (issue #1369), a stable contract as of 2.45.0: fixed keys in order `spec`, `left` and `right` (each `parts_sha256`, `part_count`, `composite_sha256`), `canvas` (`width`, `height`), `order` (`"same"` or `"changed"`), `parts` (one entry per part name in the union of both sides, sorted by `name` in code-unit order: `name`, `status`, then `left` and `right` on the sides that hold the part, each `sha256`, `box`, `index`, then `pixels_equal` and `pixels` on `changed` only), `composite` and `summary`; no clock and no file paths. The command records no threshold and judges nothing; it exits 0 whenever the report is written. [Draft-to-draft assemble comparison](AUTHORING.md#draft-to-draft-assemble-comparison-issue-1369) defines each field. |
| the external mask receipt (`--out`) | `external-receipt` | spec `rig-parts-external-receipt/1` (issue #1368), a stable contract as of 2.45.0: keys in write order `spec`, `kind` (`"mask"`), `file` and `painting` (each `path` relative to the receipt directory, then `sha256` of the file bytes), `grid` (`width`, `height` of the decoded painting) and `producer` (`tool`, optional `model`, then exactly one of `checkpoint_sha256`, `graph_sha256`, `script_sha256`); UTF-8 JSON, two-space indentation, trailing newline. `--verify` reads it back and writes nothing. The producer is the caller's declaration, not a proof of which tool made the mask. [External mask receipt](AUTHORING.md#external-mask-receipt) defines each field. |

Issue #705 pins setup-seam acceptance to one source-relative scale1 union U of the authored stage and all actual drawn base/checked-set still vertices. U is snapped relative to the source origin, including odd-width half phase.
The existing seam fields and pair pictures use that grid; source/blink and
motion-root frames are unchanged. `sets.<name>` gates its affected numerator
on the same fixed base source-cell denominator A. Non-scenes count the whole U numerator; scenes retain original border and outside-authored exclusions. Padding never enlarges A. Base failure OR any affected-set
failure remains overall failure, with mean 1.0, levels 40/80 and aggregate 50
unchanged. Added `seam_scope` identifies `source-grid/base` or
`source-grid/affected-set`, `denominator_px`, canonical `whole`, diagnostic
`auto_frame_raw` (unrounded mean, display mean, support, counts, scale, viewport),
effect/inheritance reasons, semantic drawing changes and named unavailability,
`domain.states` state/frame/piece/bounds/pose identity, and each raw pair's
whole/affected/inherited counts and reasons. `whole_pairs`
keeps complete canonical raw pair data (boxes/cut metadata included), omitting
`picture` unless its image exists. Semantic signatures preserve original source
attachment UVs/topology/weights, own image content and world vertices/colour,
not atlas pages/UVs or global piece ordinals. Unknown/no-art support stays conservative.
Renderer metadata and exact raster reads use the promised `@rig-c/core/render-shared` entry (from rig-c 2.69.0). It registers no Spine runtime; where that runtime resolves from rig-c's own package root, the existing `@rig-c/core/render` entry registers the official Spine side explicitly. An install without Spine keeps rig-c's own candidate chooser and gate; candidate or loader failures never select a guessed fallback.

An unavailable, nonfinite, unrepresentable or oversized union, or nonempty official pinned.outside, refuses `CHECK_SEAM_DOMAIN`. Geometry margins outside the authored canvas are included in U, not treated as opaque-clip evidence. State-by-state geometry reads retain bounds/identities rather than all decoded pages or poses. `--keep-stills` keeps
canonical frames in `setup_still/` and fitted diagnostics in `setup_still_auto/`.
There is one extra seam render per checked state and no extra compile/gate.

Issue #716 adds `seam_scope.population` on a measured base or checked set,
without changing that metric or its consumers. Before RGB error is read, each
included comparison sample is attributed by the existing alpha-above0,
top-two-of-2x2 reference rule. `basis` names that rule; `pair_count` and `pairs`
name only genuine observed two-part footprints in source draw order.
`single_art` and `no_reference_art` remain separate buckets. Each row's
`whole_sample_px` equals `scope_sample_px + inherited_sample_px`; base scope
equals whole, and a set uses the unchanged semantic effect mask. The sum of
whole buckets equals `measured_sample_px`, not the mean denominator A. Scenes
retain their existing exclusions. A zero-error comparison can have named pair
support; no genuine pair is explicit, while an unmeasured seam retains SKIP
and no population. This is reference support, not joint or physical-gap
measurement. Existing sparse error rows, boxes, pictures, flags, thresholds,
verdicts, gates and CLI consumer counts are unchanged; no zero-error picture is
created and no new bar or refusal is added.


Skeleton alternate registration accepts an optional `anchor` mapping of one or
two body-18 keypoints to declared base-bone origins (issue #543). One pair holds
scale at 1; two determine scale and offset. The registration bars and painting
pixels are unchanged, and omitting the field retains torso registration.

Painting generation metadata includes `upscale: {model, then}` (issue #698),
read from the same `UPSCALE_MODEL` and `UPSCALE_THEN` constants as the graph.
This adds provenance; it does not change model selection.

See-through run metadata (`meta.json`, written by `comfy seethrough`) includes
`image_sha256` (the SHA-256 of the original `--image` PNG bytes) and `layers`
(each written layer PNG's `{path, sha256}`, `path` relative to the run
directory) (issue #1188, additive under *What "stable" means here*). `comfy
plate` with `--mask-from seethrough:<dir>` binds every layer file read and
`--painting` against those hashes and refuses a legacy `meta.json` that lacks
them.

When the wrapper supplies readable writer depth for every drawn layer, the
adapter also emits a [visibility record](AUTHORING.md#see-through-layer-visibility)
for the run's own layers (issue #1469). Its metadata adds the uploaded PNG and
submitted graph hashes. Geometry depth remains separately opt-in. Runs without
optional writer depth still publish art with a named warning in the console
and in `meta.json` as `visibility_warning`.

Non-square inputs are prepared by parts before upload (issues #1197, #1205).
Their additive `input_transform` records `source: [width,height]`,
`padded: [side,side]`, `pad: [left,top]` in padded pixels, `scale` (target
side divided by padded side), `resample: "parts-lanczos3-rgba"`,
`pad_fill: "rgba-zero"` (`"rgb-black-opaque"` for a graph that reads `LoadImage`
IMAGE only, and on 2.27.2 `seethrough` records, which readers continue to accept),
`target: [resolution,resolution]` and `inverse: "nearest-pixel-centres"`.
The enclosing `image_sha256` is the single source-image hash. Preparation
zero-fills the square, places the source at floor-centred offsets, and runs
parts' RGBA Lanczos3 resampler. The wrapper receives the configured square.
In `workflows/seethrough.json`, `LoadImage`'s `IMAGE` (output 0) and `MASK`
(output 1) rejoin through ComfyUI's core `JoinImageWithAlpha` node before
`SeeThrough_GenerateLayers`, so the 4-channel RGBA image reaches the model
with `alpha = 0` on the padded area and `page_alpha` masks layer alpha to zero
outside the source rectangle, matching the wrapper's internal pad semantics.
Square inputs keep the existing upload bytes, omit `input_transform`, and for
opaque square inputs (whether RGBA or RGB-only PNG) reach the model with the
same `alpha = 255` tensor as before; a square input that itself carries
transparent pixels now has that transparency forwarded to the model instead of
dropped at `LoadImage`.
For each source pixel `(x,y)`, the inverse samples the layer union at
`floor((x+left+0.5)*scale), floor((y+top+0.5)*scale)`.
Exactness holds for representable masks, and detail below the See-through
grid's resolution is not recovered. Missing records on another grid and
invalid records refuse `PLATE_MASK_GRID`, while mismatched source bytes
refuse `PLATE_MASK_PAINTING`. Existing runs are never backfilled.

Revision ancestry is additive (issue #531): a previous root `remesh.json` or
`retune.json` is preserved at `provenance/<command>-<sha256>.json`, and optional
`input.provenance` rows name its source, path, bytes and SHA-256. The chain survives
same-command and mixed-command revisions without changing their rig splice or
hold. `revision` rows name actual output bytes, including a new `input-check.json`
when recorded, and exclude the new root provenance itself. A first revision has
no parent rows. Hashes and names are deterministic.

Files authors write for this package, each with a spec id the reader holds:
`spine-parts-requirements/1` (`check --requirements`), `spine-parts-scene/1`
(`compose --scene`), `spine-parts-keypoints/1` (`propose --keypoints`),
`spine-parts-bonemap/1` (`compare --map`), `rig-parts-wind-band/1` (`check --wind-band`, `build --wind-band`, issue #590, additive); and one another tool writes, read as that tool defines it: rig-c/review's `rig-review-mesh-edit/1` (`remesh --delta`). The spec ids of files that existed before the rename keep the package's former
name on purpose: they name a file format, not the tool, and a file written before
the rename still reads. They do not change at 1.0.

### Check report (`rig-parts-check/1`)

Spec `rig-parts-check/1` (issues #1372, #1378) is a stable contract as of
2.45.0, the first version that writes it.

A completed report starts with `spec: "rig-parts-check/1"`, `bar_outcomes`,
and `build: { "model_sha256": "<64 lowercase hex>" }` — the SHA-256 of the
exact bytes of the primary `check/build/skeleton.model.json` the check read
(auxiliary `_loop`, `_still` and `_behind_seams_turn` builds are not hashed).
The model file carries paths relative to the rig's images, so the same rig
checked into another folder records another hash; the key identifies a build
output, not rig content. The check only records; a consumer holding the report
and the build can detect a report that does not belong to it by hashing the
model file. Existing keys retain their relative order after `build`, with
`PASS` last.
`check --json` emits the same report as the file. The bar map has every id
in the order below. Its values are `{"status":"PASS"}`, `{"status":"FAIL"}`,
or `{"status":"SKIP","reason":"<stable reason>"}`. The `reason` field appears
only on SKIP. Read the existing blocks for detailed measurements and diagnostics.

`check` and `compose` accept `--loop-seam-bar <channel-delta,pixels>` and
`--loop-seam-cap <loops>` as a pair (issue #1590). The channel delta is a whole
number from 0 to 255, and the pixel limit and cap are nonnegative safe integers.
The pair requires a positive idle period and is incompatible with `--environment`.
Core selects the first take meeting the RGBA bar from warm-up 0 through the cap,
at the viewport used for the shipped idle, including the canvas viewport when
compose applies it. Without physics Core tries 0 only. Compose supports the
pair with default diagnostics or `--no-extremes`. With `--output-profile preview`,
`COMPOSE_PREVIEW_REQUIRED_CHECK` refuses the pair before the gate.

The optional `loop_seam` follows `loop_max_diff` and any `loop_physics` in the
report. It contains Core's exact `rigc-loop-seam/1` object with `status: "met"`.
Parts verifies its schema, render identity, declared bar and
cap, and the SHA-256 of its first and wrap PNGs in `idle_frames/`. The object
retains Core's per-take `series` and the selected take's pixel figures. A met
seam omits `skipped.loop`. `bar_outcomes.loop` is `PASS` when the declared seam
bar is met and the keyed check closes. The report retains the keyed
`loop_max_diff` and any `loop_physics` readings, and `CHECK_LOOP_CLOSES` can
still fail the overall check. On an unmet bar Parts relays the full
`LOOP_SEAM_BAR_UNMET` line and leaves no `check.json`, including
when reusing the output directory. Without the pair the report has no `loop_seam`
and the existing loop outcomes and idle outputs apply.

The existing boolean `PASS` is the overall outcome. For a completed
`rig-parts check`, true corresponds to exit 0 and false to exit 1. It is
false exactly when a bar is FAIL or a declared requirement is FAIL or
NOT MEASURABLE. Each entry in `requirements.lines` identifies the requirement
by its object key, the unique authored requirement name, and carries its
verdict in the entry's `status` field. Input, execution and publication
refusals can exit without a completed report.

Reports keep their existing statuses and have no bar-map entries. A WARN
is never a bar outcome, so a consumer that refuses on FAIL does not
refuse on a WARN, matching the exit code. The outer `SEAM_OVER_MOTION.status`
remains a diagnostic and the bar uses the precedence below. The outer
precedence (issue #1592) is body-root `FAIL`, full `SKIP` (no reading or an
explicit skip reason), `WARN`, partial `SKIP`, then `CLEAR`. Partial `SKIP`
carries a `reason` when some declared pair/animation readings are measured,
others are unmeasured, and there is no warning. A `WARN` has no outer `reason`
key even with incomplete coverage. To determine coverage for any outer status,
read each `rows[]` entry's `pair`, `animation`, rigc `status` and `banded`.
`read` with `banded > 0` is measured. A pair with `pairs[].unread` is
unmeasured for every entry in `animations`. The console names these
pairs and the unmeasured render rows. [Motion seam coverage](AUTHORING.md#motion-seam-coverage).

| Bar id | Measurement | SKIP reasons in precedence order |
| --- | --- | --- |
| `gate` | Packed rig-play gate | Never |
| `loop` | With the declared seam bar, Core's verified met reading on the shipped idle. Without the bar, first vs final idle-frame pixel difference on the shipped frames when the rig declares no physics constraint. When `loop_physics` is non-empty, the keyed `loop_max_diff` holds the physics-off reading. Without a declared bar a nonzero reading is `FAIL` and a zero reading is `SKIP` with `physics-omitted` and `skipped.loop` (issue #1590). | `no-idle`, `physics-omitted` (without a declared bar) |
| `seam` | Setup against the composited parts on the canonical grid. Counts the base alone by default, the base and the named alternate with `--set`, or the base and every declared alternate with `--all-sets`. Fails if the base or any counted alternate fails its existing seam rule. | `no-parts` |
| `BREATH_VISIBLE` | Idle breath signal on eligible torso or planted-foot regions | `no-idle`, `no-parts`, `no-eligible-region`, `no-reading` (eligible region outside frame) |
| `BLINK_NO_HOLE` | Closed-eye coverage vs open eye and idle | `no-idle`, `no-parts`, `no-eye-parts`, `no-blink-track`, `no-reading` (incompatible grids or eye outside frame) |
| `CHAIN_LAG` | Phase lag for comparable idle parent and child rotation tracks | `no-idle`, `no-comparable-tracks` |
| `TIP_OVER_ROOT` | Hem or sleeve tip excursion relative to root | `no-idle`, `no-parts`, `no-swing-parts`, `no-reading` (all eligible parts unread) |
| `STILL_REGIONS_DARK` | Face and planted foot movement in idle | `no-idle`, `no-parts`, `no-eligible-region`, `no-reading` (missing geometry or neither region readable) |
| `TEXTURE_STRETCH` | Idle change to skinned triangle edges, including rejected zero-length rest edges even when no stretch ratio is available | `no-idle`, `no-reading` (missing geometry), `no-meshes`, `no-visible-meshes` |
| `ANIMATIONS_DO_NOT_FOLD` | Undeclared folds across authored animations and unmatched fold exceptions | `no-animation` |
| `FEET_STAY_LEVEL` | Relative rotation of hanging footwear while drawn | `no-animation`, `no-parts`, `no-hanging-footwear`, `no-posed-footwear` |
| `STRESS_OFF_CHAIN` | Skinned handwear stress in authored chain test poses | `no-idle`, `no-parts`, `no-handwear`, `no-readable-binding` |
| `LIMB_ONE_BONE` | Each declared limb piece's slot and weights resolve to its single segment bone | `no-parts`, `no-limb-segments` |
| `SEAM_OVER_RANGE` | Joint seams at poses across the declared range | `no-parts`, `no-joint-range` |
| `ART_JOINT_DISTANCE` | Setup joint distance from fixed art-derived declarations | `undeclared`, `no-limit` |
| `CUT_JOINT_MATERIAL` | Declared joint cut-material support and crossing evidence | `undeclared` |
| `SETUP_MATCHES_PAINTING` | Native-grid source vs rendered setup under authored regional mismatch limits | `undeclared`, `no-limit` (at least one region lacks a limit and none fail) |
| `BOUNDARY_COLOUR_STEP` | Authored allowance for excess colour step between parts in idle | `undeclared` |
| `BEHIND_PART_SEAMS` | Authored thresholds for standing at setup and motion-opened rear seam cells, including `motion_opened` at requested turn poses | `undeclared`, `no-complete-threshold-reading` (including no eligible pairs or an incomplete non-failing reading) |
| `SEAM_OVER_MOTION` | Body-root gap plus under-owned ghost floor and required zero-background seam readings | `no-root-gate`, `no-animation`, `no-complete-root-reading` (root evidence unmeasured) |

| SEAM_OVER_MOTION precedence | Declared outcome |
| --- | --- |
| Root FAIL or required FAIL | FAIL |
| Otherwise required PASS | PASS |
| No required block, root PASS | PASS |
| No required block, root SKIP | SKIP with `no-animation` or `no-complete-root-reading` |
| Neither root nor required gate present | SKIP with `no-root-gate` |

Version-aware consumers read the declared outcomes on the known spec.
Compose reads `bar_outcomes` on a report that declares this spec (issue
#1373); on a report without it, and in the remesh/retune input-check
readers, the historical interpretation is kept, including for reports
written before this version.

### Run stamp (`run.json`, spec `rig-run/1`)

The CLI commands `rig` and `assemble` (when writing `--out`) write `<out>/run.json`
after all stage gates pass and all other output files are on disk:

```json
{
  "spec": "rig-run/1",
  "package": { "name": "@rig-c/parts", "version": "<package.json version>" },
  "command": "rig",
  "started_at": "2026-11-07T00:00:00.000Z",
  "finished_at": "2026-11-07T00:00:01.000Z",
  "config": { "path": "../config.json", "sha256": "<hex>" },
  "outputs": [
    { "path": "images/cloth.png", "sha256": "<hex>" },
    { "path": "mesh_report.json", "sha256": "<hex>" },
    { "path": "motion.json", "sha256": "<hex>" },
    { "path": "rig.json", "sha256": "<hex>" }
  ]
}
```

Key order is fixed as shown; `outputs` is sorted by `/`-separated `path` in UTF-16
code-unit order. Every `path` in `config` and `outputs` is relative to the `--out`
directory (`../`-prefixed when `--config` sits outside `--out`; never an absolute or
home path). On `assemble`, `inputs` sits between `config` and `outputs` (issue #1316,
additive): one `{ "role", "path", "sha256" }` entry (keys in that order) for each of
`--source`, `--full` and `--head` that was given, in the fixed order `source`, `full`,
`head` (an input not given is absent from the list, never `null` or guessed), with
`/`-separated `path` relative to `--out` by the `rig-run/2` link rule (naming
`<dir>/layers.json` when the input is a directory, issue #1554) and `sha256` of the file
`path` names on disk; `rig` writes no `inputs` key. Every `sha256` is computed from the bytes on disk after writing. A refused
run writes no `run.json`. By default, `started_at` and `finished_at` record wall-clock
time read in `cli.ts` (`src/` remains pure). With that default, `run.json` is outside
the byte-for-byte
determinism comparisons (`RG03`, `RG19`, `AS07`); for the same input at the same
relative `--config` layout, two `run.json` files differ only in `started_at` and
`finished_at`.

Set `SOURCE_DATE_EPOCH` to opt into a fixed clock: both timestamps equal that
instant in UTC ISO format, without adding a stamp field. The value must match
`^(0|[1-9][0-9]*)$` and be at most 253402300799 seconds
(9999-12-31T23:59:59Z), preserving the four-digit-year ISO form.
253402300800 and above are refused. Empty, negative,
fractional, non-numeric, noncanonical and out-of-range values refuse
`RUN_STAMP_EPOCH`, naming the variable, found value and requirement before any
output is written or an existing stamp is removed. Unset preserves the existing
wall-clock path and stamp format. Fixed clocks make stamps byte-identical for
identical inputs and the same relative config layout.

`outputs` lists exactly the files the stage wrote in this run, derived from what the
stage returns, not from a walk of `--out`: a stray or earlier file under `--out` is
neither hashed nor listed. Before the stage starts, the command removes an earlier
`<out>/run.json`, so a run the stage refuses, into a reused `--out`, leaves no stamp
(a usage error, exit 2, stops before that and touches nothing under `--out`). A
`package.json` without a non-empty `name` and `version` refuses `RUN_STAMP_PACKAGE`
and writes no stamp. `build` and the in-process stages write no `run.json`.

`rig-run/1` is stable: its keys, their order and their meaning do not change within
the spec. A key added, removed or redefined is a new spec version.

### Run record (`check-run.json` and `build-run.json`, spec `rig-run/2`)

`check` writes `<out>/check-run.json` whenever the run completed its check report,
green or not (issue #1541). `build` originally wrote `<out>/build-run.json` in this
format. Its current contract is [the build run record](#build-run-record-build-runjson-spec-rig-run3). The names
cannot be a `run.json`: `rig` and `assemble` write `rig-run/1` as `run.json`, and
rigc writes its own `run.json` in a packed build directory (`check/build/`). Neither
file is in `check.json`, and no byte comparison this package makes reads them.

```json
{
  "spec": "rig-run/2",
  "package": { "name": "@rig-c/parts", "version": "<package.json version>" },
  "command": "build",
  "started_at": "2026-11-25T00:00:00.000Z",
  "finished_at": "2026-11-25T00:00:01.000Z",
  "config": { "path": "../config.json", "sha256": "<hex>" },
  "outputs": [
    { "path": "check/check.json", "sha256": "<hex>" }
  ],
  "argv": ["build", "--config", "../config.json", "--source", "../painting.png", "--full", "../layers/full", "--out", "."]
}
```

Key order is fixed as shown: `spec`, `package`, `command`, `started_at`,
`finished_at`, `config` (`build` only; `check` reads no config), `outputs`, `argv`.
`package` and the two times (`SOURCE_DATE_EPOCH` included) are as in `rig-run/1`.
`config` is the config's `sha256` and its path relative to `--out`, using the
same directory spelling rule as `argv` below. A config given through a link is
recorded by the link's name.
`outputs` lists every file under the paths the run cleared and wrote —
for `check`, the report files its `wrote` line names and the directories it names
(`build/`, `idle_frames/`, …); for `build`, the paths it clears before it starts —
sorted by `/`-separated `path` in UTF-16 code-unit order, each with the `sha256` of
its bytes. A run record is not listed: `run.json` (rigc's carries its own clock) and
any `-run.json`. Two runs of the same inputs from the same layout differ only in
`started_at` and `finished_at`.

`argv` is the command to re-run, then the options as given — not the defaults the
run used — in the order of the command's flag table (`check --help` lists it):
valued flags first, a repeated `--alt` in the order given, then the switches
present. Each path and `--out` are taken from the working directory. On POSIX,
the `--out` directory and the path's directory are resolved through their links.
On Windows, both directories keep their supplied spelling. The path keeps its
own name and is written relative to `--out` with `/` separators. `--out` itself
is `.`. A path on another Windows drive is written as given. These arguments
reproduce the check when run from the `--out` directory with the same package
version. A switch's default is not written, so a later
version that changed it would replay differently; that is why the version is in
`package`. The record is written after the report, in place, and is never a reason to refuse
the check; a run killed while writing it can leave a partial record, and no other
file.

`rig-run/2` is stable on the same terms as `rig-run/1`. The `check` record retains
the same format and bytes for the same files, invocation, version and times.

### Build run record (`build-run.json`, spec `rig-run/3`)

`build` writes `<out>/build-run.json` when its check report completes, including a
report with failing bars. Issue #1556 advances `spec` to `rig-run/3` and adds
`inputs` between `config` and `outputs`. The fixed key order is `spec`, `package`,
`command`, `started_at`, `finished_at`, `config`, `inputs`, `outputs`, `argv`.
The other fields and the write timing follow the `rig-run/2` build contract above.

This example shows a build with full and head layer directories and one alternate tuple.
The version and digests are illustrative, and the output list is abbreviated.

```json
{
  "spec": "rig-run/3",
  "package": { "name": "@rig-c/parts", "version": "2.57.0" },
  "command": "build",
  "started_at": "2026-11-25T00:00:00.000Z",
  "finished_at": "2026-11-25T00:00:01.000Z",
  "config": {
    "path": "../config.json",
    "sha256": "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
  },
  "inputs": [
    {
      "role": "source",
      "path": "../painting.png",
      "sha256": "112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00"
    },
    {
      "role": "full",
      "path": "../layers/full/layers.json",
      "sha256": "2233445566778899aabbccddeeff00112233445566778899aabbccddeeff0011"
    },
    {
      "role": "head",
      "path": "../layers/head/layers.json",
      "sha256": "33445566778899aabbccddeeff00112233445566778899aabbccddeeff001122"
    },
    {
      "role": "alt[0].source",
      "path": "../side/painting.png",
      "sha256": "445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233"
    },
    {
      "role": "alt[0].full",
      "path": "../side/full/layers.json",
      "sha256": "5566778899aabbccddeeff00112233445566778899aabbccddeeff0011223344"
    },
    {
      "role": "alt[0].head",
      "path": "../side/head/layers.json",
      "sha256": "66778899aabbccddeeff00112233445566778899aabbccddeeff001122334455"
    }
  ],
  "outputs": [
    {
      "path": "check/check.json",
      "sha256": "778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566"
    }
  ],
  "argv": [
    "build", "--config", "../config.json", "--source", "../painting.png",
    "--full", "../layers/full", "--head", "../layers/head", "--out", ".",
    "--alt", "side=../side/painting.png:../side/full:../side/head"
  ]
}
```

Each entry has keys `role`, `path`, `sha256` in that order. The array follows this
order regardless of where each flag appears in `argv`.

| Order | Role | CLI input | File hashed |
| --- | --- | --- | --- |
| 1 | `source` | `--source` | Painting PNG |
| 2 | `full` | `--full` | `<dir>/layers.json` for a directory, or the supplied manifest or PSD |
| 3 | `head` | `--head` | `<dir>/layers.json` for a directory, or the supplied manifest or PSD |
| 4 | `requirements` | `--requirements` | Requirements JSON |
| 5 | `environment` | `--environment` | Environment schedule JSON |
| 6 | `wind-band` | `--wind-band` | Wind-band spec JSON |
| For each `--alt` in CLI order, first | `alt[i].source` | Tuple source | Alternate painting PNG |
| For each `--alt` in CLI order, second | `alt[i].full` | Tuple full | `<dir>/layers.json` for a directory, or the supplied manifest or PSD |
| For each `--alt` in CLI order, third | `alt[i].head` | Tuple head | `<dir>/layers.json` for a directory, or the supplied manifest or PSD |

`i` is zero-based and counts the `--alt` occurrences. Entries for optional flags
or tuple members appear only when supplied. The array inventories CLI file
inputs. References declared only inside the config and files referenced by a
layer manifest are outside this inventory. `config` binds `--config` separately,
and `--out` is the output root.

The run-record writer reads and hashes the raw bytes on disk of the file named by
`path` after the check report completes. Keep input files and link targets unchanged
from the start of the build until it exits so these digests describe the bytes the
stages read.

Each path uses the shared `--out` link rule. On POSIX the output directory and
the file's parent directory resolve through links, and the final filename is kept,
including when that filename is a link. On Windows the path is rebased as spelled. Relative
paths use `/` separators. A file on another Windows drive is recorded by its
file path as given, with `layers.json` appended when the argument names a directory.
The paths are relative to the build's `--out` root.

## Environment

The installed package reads two environment variables and no other: `PATH`, where
the launcher finds Bun and the CLI finds the `rigc` its own `node_modules` holds,
and `COMFY_HOST`, which `comfy paint` and `comfy seethrough` read when `--host` is
not given (it has no default). `RIG_PARTS_CORPUS` and `RIG_PARTS_SELFTEST_JOBS`,
with their former `SPINE_PARTS_` names read when they are not set, are the
selftest's, a development interface of this repository: the selftest does not ship
in the package.

## rig-c

`dependencies` takes `@rig-c/core` `3.11.0` exactly. Core 3.11.0 supplies the idle
render's `--loop-seam-bar` and `--loop-seam-cap` support. Bun 1.4 or later
is the declared floor (`engines.bun` `>=1.4.0`; older 1.4 releases are not tested in
CI, which runs `latest`, and compatibility with an older 1.4 release is handled when
reported as an issue). What this package relies on in rig-c, every import
read off `src/` and `cli.ts`:

- the named entries its `exports` map carries (from `@rig-c/core` 3.0.0 `./*.ts` deep
  file paths are gone, and `TY39` refuses any in the tree):
  `@rig-c/core/mesh` (the outline functions, `measureAuthoredMeshFit`, `reduceMesh`,
  `skinningEnvelopeBone`, `writeMeshQualityReport` and their types),
  `@rig-c/core/meshcompare` (`compareMeshesInMotion`, `comparePreparedMotion`,
  `prepareMotionReference`), `@rig-c/core/compile` (`f32`), `@rig-c/core/core`
  (`RUNTIME_PI`), `@rig-c/core/deformgen` (`evaluateDeformTransform`),
  `@rig-c/core/environment` (`ENVIRONMENT_SPEC`, `EnvironmentError`,
  `environmentResponse`, `readEnvironmentSchedule`), `@rig-c/core/errors`
  (`CompileError`), `@rig-c/core/font5x7` (`GLYPH_H`, `drawText`),
  `@rig-c/core/passthrough` (`DRAWN_ALPHA`), `@rig-c/core/plate` (the PNG codec),
  `@rig-c/core/png` (`assertPng`), `@rig-c/core/render` (`GeometryFile`,
  `GeometryFrame`), `@rig-c/core/render-shared` (`Viewport`), `@rig-c/core/rig`
  (`parseRigSpec`, `RIG_SPEC_VERSION`, the constraint keys and types),
  `@rig-c/core/stop` (`expandStops`) and `@rig-c/core/transform` (the y flip and
  frame transforms, through `src/coords.ts` only);
- the `rigc` command: `build` and `render`, and `--version`, whose `entry:` line
  says which validator gated a build (`check.json`'s `rigc_entry`).

A rig-c release that moves any of these breaks this package by name, and the
install smoke is where that shows first. No Spine runtime is a dependency: an
install is gated by rigc's own validator, and `@esotericsoftware/spine-core` is a
development dependency of this repository only.

### Generated turn winding

Core 3.10.0 adds `A53_DECLARED_SLIDER_COMBINATIONS_KEEP_WINDING` to both
validators. Parts emits `invariants.deformSliderCombinations` from generated
turn mappings, using each slider's actual name, including any retained name
when Parts rewrites a reused slider's mapping. Head 2.5D roles generate yaw
and pitch and declare all four endpoint pairs. With body yaw also generated,
the declaration contains all eight endpoint triples and twelve endpoint pairs
with the third dial at explicit neutral `0`, for twenty tuples. Every tuple
includes all applicable names and values. With fewer than two generated dials,
including body yaw alone, Parts omits the invariant and A53 reports SKIP.
Legacy authored sliders alone do not create this invariant.

The mandatory Core gate can refuse a previously accepted rig before emission.
Core's assertion total increases by one, and a rig with no combination
declaration gains one skipped assertion. The existing A39 checks still cover
individual dials.

## What is not stable

- **The evidence documents** under `docs/evidence/`: their layout, columns and
  figures are a measurement record of one tree on one rig-c, regenerated when the
  tools or rig-c move.
- **The tools** under `tools/` (the matrix, the surveys, the comparisons) and their
  command lines, and the scripts under `scripts/`.
- **The selftest**: its control names, counts and line wording.
- **Console prose** beyond the shapes above: the detail after a rule name, the
  wording of a note, the order of informational lines.
- **The examples' `expected/` outputs**: they are this repository's regression
  record and move with any change that declares a byte move.
- **Bytes across versions**, as stated at the top.

## Bounded time, and what the checks cost

The automatic mode's search is bounded by counts the author declares or the call
derives, never by a clock (`src/` reads none): rig-c's `reduceMesh` tries at most
`budget.maxCandidates` steps, the acceptance loop replays at most ⌈log₂(N − I)⌉
removal steps (N the call's accepted operations, I the refinement's), and the
multi-interval selection at most `motion.selection.maxProbes`, each replay one
unpacked gated build and one motion comparison. Wall time is therefore a property of
the input and the machine. Measured: the evidence tools run every cell under a
600 s cap and a whole matrix under 2,700 s (`docs/evidence/auto-mesh-matrix.md`,
*re-running*); one `reduceMesh` call on the public parts took 0.7 s to 10.7 s at
rig-c 2.23.0 (the same document's quiet timing table, a remote WSL runner, pool,
load under 2); at rig-c 2.31.0 the whole rig stage of one automatic part, motion
gate and acceptance loop included, took 1.1 s to 61.6 s on the eight parts the
surveys switch, reference-demo `bottomwear` the slowest at 12 gated builds, with a run-to-run
spread of ±15 % on that part (pull request #152's paired exclusive timing, remote
20-core runner; the surveys print wall time to standard error, not into the
documents). On CI (`ubuntu-latest`), the last two green runs on `main` took 4 min
54 s and 8 min 28 s for the full selftest (842 controls over 45 suites at
`22b2c5a`, with the public examples fetched; the job's limit is 20 minutes) and
42 s and 41 s for the install smoke (6 cases; limit 10 minutes), at `8be4cd1` and
`22b2c5a` respectively. None of these figures is a promise: they are what the named
runs measured.

The following measurement used the unreleased [core#1595](https://github.com/rig-c/core/issues/1595)
prepared-reference implementation, packaged locally with `rig-c` metadata version
`2.70.0` (tarball SHA-256 `dac8c10631e9c0fbd30b9361155b26cba5526ece618c623e87e8dd20cc3dd92c`).
Its grid-selection replays bind one exact reference and schedule, then compare each
fresh gated candidate.
The number of candidate probes, gated builds and packed-page checks is
unchanged; a changed bound or reference input is refused. In one exclusive remote-pool
WSL ABBA invocation, using the same rig-c tarball in both arms and two runs per
arm, the strict switched `bottomwear` input derived from public `reference-demo` took 56.00–56.28 s
with one-shot comparison and 50.55–51.40 s with preparation included; the similarly switched public
`reference-sample` input took 18.96–20.41 s and 16.39–18.71 s respectively.
The paired differences were 4.59–5.74 s and 1.70–2.57 s. These are observed
wall times for those inputs, not an execution limit or a machine-wide idle
measurement; load outside the remote job pool was not measured. The prior count
bounds remain the termination guarantee.

## Determinism

The same inputs, with the same version of this package and the same installed
rig-c, write the same bytes: fixed key order in every JSON written, stable sorts, no
clock, no randomness and no locale-sensitive formatting. `src/` is pure outside
`src/comfy/` (`TY06` refuses a clock, randomness or network call anywhere else under
`src/`). The selftest holds it by running the same thing twice and comparing the bytes:
`PN01` (the PNG codec), `PT01` (`parts.json` round trip), `AS07` (`assemble`
from the CLI), `SK04` (the skeleton), `RG03` (two lattice builds), `CW20` and
`CT20` (a contour rig and a contour mesh), `AM24` (an automatic mesh), `MO11`,
`MO27`, `MO44`, `MO50`, `MO63` and `MO74` (the motion gate, the acceptance
loop's replay, every Stage B opt-in, a gradation, the multi-interval selection's
policy path and the residual veto), `CK02`, `CK33` and `CK79` (`check`, its
stretch geometry, and `check --requirements`), `DG13` (`basis.json`), `LP08`
(the indexed APNG) and `ST26` (the `compare` printout). The `chain` suite builds
the synthetic validation variants and holds `parts.json` (`CH02`), `rig.json`,
`motion.json` and `mesh_report.json` (`CH03`), `check.json` whole (`CH04`) and the
gate file (`CH05`) to their tracked `expected/`, with the tolerances `CH07` plants
against. The public examples' `expected/` files are this package's own snapshots:
`tools/regenerate_examples.ts` writes them on Linux, and CI rebuilds the fetched
examples and compares the files whole with its `--check` (issue #1439).

### Contour band weights (issue #1578)

With the default falloff, a region listed in `contour.regions` applies
`4g²(1 − g)` to its nominal linear share `g` for `0 < g < 0.5`. An upgrade can
change written weights and downstream output bytes. Geometric support and
overlap refusals use the original `g`. The inner half of the band, zero-width
bands, influence limits and rounding keep their prior behavior. A declared
contour region accepts `falloff: "linear"` to recover its previous weights
byte for byte. Other values are `CONFIG_FIELD_TYPE`. The circles derived
from `contour.bust` and automatic mesh regions keep the prior linear ramp.
An automatic region or a `contour.bust` block rejects `falloff` as
`CONFIG_KEY_KNOWN`.

### Opt-in hybrid provenance (issue #399)

A lower rigid limb piece may carry `limb.hybrid` instead of `limb.cap`:
`{part, upper, width, radius, at, axis}`. Its generated mesh carries
`limb.band`: `{upper, width, radius, at, axis}`. `width` is the finite positive
effective full band width in rig pixels. Both records carry the finite
source-derived `measured_width` in rig pixels, including zero or negative
measurements when an explicit width lets assembly succeed. Readers accept
pairs without this optional field and require both records to agree on it
when present. For the base and each alternate carrying the band, the assembly
reading uses the config's explicit width when supplied and the recorded
`measured_width` otherwise. The pair also
agrees on source, joint, lower carrier and geometry. The lower rigid piece
alone carries `range`. The existing `LIMB_ONE_BONE` line checks ordinary
segments as before. The band requires exactly its two adjacent carriers.
`SEAM_OVER_RANGE` uses the stored radius and existing rest-art comparison.

## Explicit motion seam observations (issue #750)

`motion_seams: [{part, neighbour}]` is optional in proposal/config/parts.json.
Absent leaves the existing declaration path unchanged. Readers refuse unknown
parts, self-pairs, unordered duplicates, malformed entries and unknown entry
fields by name. Empty declares no additional pair. Proposal turn/copy/write and
assemble preserve it; check never infers a removed declaration. A declared pair
uses the existing non-root WARN floor and unchanged exits, unless independently
selected by the existing proven body-root FAIL contract.

All played non-root WARN rows may add `worst` and `pose_at_worst`, including
existing limb rows. Worst is the maximum above-floor raw hit, earliest frame
on a tie, gap before ghost on a remaining tie. Pose evidence binds the same
seam geometry's actual setup, frame index, animation, viewport and raw time.
It records carrier-path world axes, parent-relative setup-axis deltas modulo
360, unchanged static ranges and explicit unavailable comparison reasons;
frame0 and source key endpoints are not setup or measured pose substitutes.
No angle bar or new threshold is added. Missing/mismatched data refuses.
Without a declaration only optional WARN evidence changes existing check bytes.
For the declared no-chest control at identical paths, the exact byte projection
of an existing seam container excludes only its selection, rows, derived status
and reason. The historical optional-container bar required exactly seven keys,
`CLEAR` and zero warnings across every animation. Its measured raw exit 1 stays
red: the added greeting keys only the head, but the original idle also keys the
chest and reports an above-floor opening at frames 8–12. The source type also
permits informational `worlds`; neither finding changes the product contract.

[HQ's post-verdict restatement](https://github.com/rig-c/parts/issues/750#issuecomment-6398631279)
corrects that premise. When the baseline omits `SEAM_OVER_MOTION` entirely, audit
the new container against the complete `MotionSeamLine` source type, including
its required and optional fields and referenced types, rather than a hand-kept
key list. Independently verify fps 12, the exact source floor, compiled animation
roster, generated selection and every row against the raw readings. All added
greeting rows must be readable and clean. Any WARN must name an animation that
actually keys a joint on the pair's carrier ancestry, witnessed by the original
authored motion, compiled tracks and actual drawing carriers. The original idle
WARN remains reported with the unchanged floor and exit behavior. Only after
those audits may lossless removal of the new container establish exact equality
of every outside byte. An existing baseline container keeps the narrower field
exclusions above. The original red and the separate post-verdict re-evaluation
are retained together; no input, animation selector or threshold is changed.

The WARN pose reader also requires the published stock coordinate header and
the required source bone/parent roster. It binds the complete geometry frame
cohort to the actual PNG frame set through `readFrameSet` and `boneTrackOf`,
including unselected frames, before reading the worst pose. Identical static
ranges on a bone deduplicate; conflicting ranges are explicitly ambiguous,
never described as no declared range.


## Optional depth sheets (#773)

A wrapper `depth_filename` is a legacy hint. Without explicit `config.depth`,
no depth file is read, validated, fetched or emitted, even when files or
in-memory sheets exist; art/order and legacy output stay unchanged. With the
block, a drawn layer source must be opaque grayscale on its exact grid.
Reader/export APIs take explicit config/run/base context; raw export defaults
to art only. Comfy CLI adds `--config` and `--depth-run full|head`; the block
requires a named run and a named run requires the block. Active download and
source errors remain refusals, never missing-file fallback.
Assembly's optional part `depth` reference holds `image`, `near`, `zScale` and
`sources` (each original `from`, `image`, `sha256`, `crop`, and `reading` with
`orderingMedian`, `sheetMedian`, `relation`). These fields are omitted without
active binding. Persisted authored part references remain active for standalone
rig reading regardless of config opt-in. `rig` adds padded measurement PNGs and the `rig-parts-depth-sheets/1`
`depth_sheets.json` companion only with references (each output `part`, actual
padded `size`, and `depth`; a still split names both slices). Passive references
add these companions without changing weighted geometry. Active `"surface"`
roles in `turn.roles` and `turn.body.roles` consume registered sheets:
region surfaces emit Core grid generators with `generator.depth`; authored
weighted surfaces keep their topology and bindings and emit sampled per-influence
inverse-bind deform offsets in motion, without adding a Core attachment depth
field. Head yaw/pitch and independent body yaw use their existing turn groups.
Blended surfaces retain the documented per-group masks and setup-overlap
neighbour field rules in [AUTHORING](AUTHORING.md#per-layer-depth-sheets-773).
`RIG_TURN_BODY_UNCOVERED` is a report-only warning for a shown torso part
without a body role that has opaque setup-triangle overlap with a moved body
surface and different emitted endpoint displacement. It names the part, surface,
times, vectors and relative travel. Head/neck bindings, transparent/excluded
alpha, explicit/inherited body roles and identical inherited motion are excluded as
described in [AUTHORING](AUTHORING.md#missing-body-turn-coverage). It assigns
no role or depth and changes no emitted file bytes.
The unit-depth precedence and its primary-surface sampling are documented in
[AUTHORING](AUTHORING.md#unit-depth-precedence).
The separate ordering scalar is unchanged. No-image outputs retain legacy bytes.

### Declared setup-painting regions

| Optional field | Additive contract |
| --- | --- |
| `setup_painting.figure_mask` | Verified source-grid alpha support restricts region counts and opts busy-ground visible assembly into bounded hole and interior-translucency restoration; omission preserves the shipped domain and output bytes. |

The optional `setup_painting.figure_mask` (issue #974, additive) declares a
`path` and byte `sha256` for independent figure alpha support on the original
painting grid. Paths resolve relative to requirements. Alpha above zero is
sampled at nearest source pixel centres onto the stage, with empty support
refused. Region limits count only inside that support. Outside-mask uncovered
mismatches have their own unbarred stage-wide row. The verified declaration is
recorded in the report. Omitting it preserves existing output bytes and the
shipped domain predicate. Assemble reads the same requirements declaration through
the explicit requirements flag or config.requirements. Busy-ground visible
restoration requires pre-step and assembled four-neighbour support, prefers the
frontmost pre-step holder, then nearest pre-step owner with frontmost ties.
Keep, feather, locked and moving-pair boundaries remain excluded. Plain-ground
assembly keeps its existing path.
Busy-ground visible assembly validates config.requirements and its flag correspondence, refusing malformed requirements or unverifiable figure masks before writing.

The optional `setup_painting` key in `spine-parts-requirements/1` adds a
`SETUP_MATCHES_PAINTING` measurement when declared. It requires authored
`rgb_tolerance` and named native-stage boxes. Each optional `max_pixels` is
that whole region's limit; omission is SKIP, never PASS. With neither
`figure_mask` nor `backdrop` declared, a region whose `(uncovered)` slot row is
more than half its `pixel_count` adds one console line,
`SETUP_PAINTING_MOSTLY_UNCOVERED` (issue #1421, a warning and not a bar), and
the summary line names it; no exit code, problem or `check.json` byte moves.
The optional boolean
`setup_painting.required` (issue #943, additive) is the author's declaration
that the check may not SKIP: with `true`, an absent `rgb_tolerance`, `regions`
or region `max_pixels` is refused by name as `SETUP_PAINTING_REQUIRED_LIMIT`
when the file is read, before anything is built, and no limit is derived; a
fully limited declaration measures, prints and writes the same bytes as
without the field. Absent or `false`, every reading in this section is
unchanged. `build` hands its `--source` painting to its check when, and only
when, the requirements file it reads declares `setup_painting` (issue #978),
so the declaration reads the verdict `check --source` reads on the same output;
a build whose requirements do not declare it, or that reads none, writes the
bytes it wrote before. The optional `pinholes` key (issue #944, additive) declares
`assemble`'s pinhole bar: with `{"required": true}`, `assemble` (and `build`'s
assemble) refuses every pinhole of the base set's flat parts stack by name as
`ASSEMBLE_PINHOLES` before anything is written — the bar is 0 and takes no
value. Absent or `false`, nothing is measured, the console's
`ASSEMBLE_PINHOLES: SKIP` line says so, and no exit code, file or other line
moves. The optional `seam_over_motion` key (issue #941, additive)
declares `check`'s background bar: with `{"required": true}`, every declared
`SEAM_OVER_MOTION` pair — body-root, internal-joint and explicit — is refused
by name as `CHECK_SEAM_OVER_MOTION_REQUIRED` on any frame of any animation (12
fps, every frame) with rigc `gapOpen` cells above 0, and a line or pair that
measured nothing is refused too; `check.json`'s `SEAM_OVER_MOTION` gains
`required`. The bar is 0 and takes no value. Absent or `false`, nothing is read
and no exit code, line or byte moves; the existing warnings and the body-root
bar are unchanged.
The optional `boundary_colour` key (issue #942, additive) declares `check`'s
`BOUNDARY_COLOUR_STEP` bar: with `{"max_step_excess": <0-255>}` (an authored
integer; no default exists), `check` measures every part boundary of the setup
and every idle frame against the rig's own pieces, writes the
`BOUNDARY_COLOUR_STEP` block to `check.json`, and refuses each part pair over
the allowance as `CHECK_BOUNDARY_COLOUR_STEP`, or a reading it cannot take as
`CHECK_BOUNDARY_COLOUR_UNMEASURED`. Absent, nothing is measured or written,
the console's `BOUNDARY_COLOUR_STEP: SKIP` line says so, and no exit code,
file or other line moves. With `--source` but
no declaration, the console, `check.json` and the report's skipped-bar list now
say SKIP with the reason and the `--requirements` declaration remedy; exit
codes stay unchanged. No metric, region or limit is invented. Without source
and without the key, the line stays absent. Declared output bytes and renderer
calls remain unchanged. `check --json` prints the completed `check.json` bytes
to stdout and keeps the ordinary check's exit code; early input refusals and
usage errors keep their existing named text and exits. `build --json` is refused
with a `check --json` remedy; build keeps its multi-stage text report. Other requirement fields
remain independent. The [authoring contract](AUTHORING.md#setup-against-the-painting)
defines white compositing, the figure domain, strict RGB comparison, top
contributor attribution and named measurement refusals. The check observes the
actual renderer setup at scale 1; it neither fits the art nor duplicates core
validation. Only this declared check composites source RGBA over white at its
original resolution **before** existing Lanczos3 stage resampling. Setup RGBA
is composited on the native stage grid. Source readers preserve alpha; the
global RGB-only source helper and checks without this declaration are unchanged.

The optional `source_exposure` key (issue #1473, additive) declares a limit for
`check`'s `SOURCE_EXPOSURE` line: `{"max_px": <a nonnegative integer>}`, the
most stage pixels of one recorded-hidden or undecided state one part may show
in one frame. No default exists. Declared, a row over it is
`CHECK_SOURCE_EXPOSURE` and a reading that cannot be taken is
`CHECK_SOURCE_EXPOSURE_UNMEASURED`; the line is PASS or FAIL. Undeclared, the
line is written only when some part carries a `source_state_map`, and then it
is `REPORTED`, never a pass, and moves no exit code. A rig with no map and no
declaration writes no `SOURCE_EXPOSURE` key in `check.json` and prints no line,
so its bytes do not change. `SOURCE_EXPOSURE` is not one of `bar_outcomes`'
bars, so `bar_outcomes` does not change either. The `check.json` block holds
`status`, `instrument`, `reading`, `max_px`, `alternates`, `parts`, `texels`,
`frames`, `animations`, `rows` (`part`, `state`, `px`, `frame`, `animation`,
`index`, `time`, `row_scope`, `row_kind`, `row_subjects`) and `unmeasured`
(`slot`, `part`, `attachment`, `frame`, `reason`, then the same row fields), in
that order, then `reason` when no part was read. `texels` is keyed by part
name, in `parts.json` order, each value the part's texel count per state.

`parts.json` records with `source_visibility` gain an optional
`source_state_map` (issue #1473, additive), `{ "image", "sha256" }`: the
per-texel state map `assemble` writes in `parts/`, bound by the SHA-256 of its
bytes. A record without `source_visibility` cannot carry one
(`PARTS_FIELD_TYPE`). `check` refuses a map that is missing, changed, malformed
or disagrees with its part or its counts, before anything is built
(`PARTS_SOURCE_STATE_MAP_PRESENT`, `_SHA256`, `_FORMAT`, `_COUNTS`). The map's
codes are listed in the
[authoring guide](AUTHORING.md#see-through-layer-visibility).

The optional `motion_seams` key in `spine-parts-requirements/1` (issue #1269,
additive) is a bar-free array of `{part, neighbour}` declarations. Check reads
its union with the manifest's motion seams and existing `seam` requirements,
retaining every declaration source and counting unordered pairs once across
sources. Each list uses the shared motion-seam validator: malformed entries,
self-pairs and duplicate or reversed pairs within a list are `REQUIREMENTS_FIELD`;
names absent from the rig or parts manifest are `REQUIREMENTS_RESOLVES`, and a
nonempty declaration without parts is `REQUIREMENTS_SEAM`. The checker never
writes `parts.json`. Empty lists add no coverage; zero pairs retain the existing
required-gate failure bytes. Existing `seam` requirements and `within_px`
measurements are unchanged. Config declarations retain their assemble-to-parts
route. See [Background over every frame](AUTHORING.md#background-over-every-frame-issue-941).

The optional `behind_seams` key in `spine-parts-requirements/1` (issue #1314,
additive) declares the required `BEHIND_PART_SEAMS` check, independently of the
existing requirement kinds and without a new CLI flag. Its optional fields are
`threshold`, `allowance`, `pairs` and `turn`; pair entries require distinct nonempty
`part` and `neighbour` names and may override `threshold` and `allowance`.
Names must resolve to known parts and an already selected pair; duplicate
pairs, including reversed pairs, are invalid. Shape errors use `REQUIREMENTS_FIELD`.
An authored threshold T is an integer from 0 through 255; omission has no
default, and a pair without either a rig or pair T reports SKIP and a HOLE,
never PASS. Allowance is a nonnegative safe integer, defaulting to 0 by the
explicit design ruling, with optional per-pair override for both halves.

Declared readings independently measure motion-opened rear visibility on every
idle frame and standing contrasting rear visibility at setup (against the
parts' flat recomposite at their painted positions, issue #1408) on core's
official seam grid. There is no WARN mode, one-cell floor, rest mask or
subtraction of setup-visible cells. At setup, `standing` compares the full setup
render (`rasters.full`) with the parts' flat recomposite (`flatComposite` of
`parts.json` and `parts/*.png` over white in `rig.json` slot order, rendered
onto the pair's native seam grid), both flattened source-over white
(`[255, 255, 255]`), by max-channel distance: a bracketed rear-visible cell is
raw (`raw_px`) when `d[0] > 0`, `d[1] > 0` and `dRecomposite > 0`, and counts
(`px`) when `d[0] > T`, `d[1] > T` and `dRecomposite > T` (a cell outside the
recomposite's canvas has `dRecomposite = Infinity`). Setup standing catches a
part that the rig places away from where it was painted; it does not measure
fidelity to the `--source` painting (which is `SETUP_MATCHES_PAINTING`'s and the
`RECOMPOSITE_HOLES` / `parts.json` `recomposite` record's job), and `--source`
is not required for `behind_seams`. A recomposite whose size differs from the
stage is refused by name and never resampled; and through `check` the loader
refuses the same mismatch earlier, as `CHECK_RIG_STAGE_IS_THE_CANVAS`. On a
corridor whose endpoint owner is ambiguous (`0` or `3`) at setup, cells within T
of the recomposite (`dRecomposite <= T`) are left out of the unread population,
without adding their endpoints to `boundary_cells` (`support`); elsewhere they
stay geometric (`geometric_px` and `samples`) but cannot count. An ambiguous
endpoint makes a corridor unread only when at least one of its cells differs
from the recomposite by more than T (`dRecomposite > T`), and `allowance` never
clears an unread cell. Without `--parts` (`parts.json` and `parts/*.png`), setup
standing is `SKIP` with
`reason: "no --parts manifest was supplied; setup standing compares the setup render with the parts' flat recomposite"`,
adds a `setup` `unmeasured[]` row, and with an authored T emits
`CHECK_BEHIND_PART_SEAMS_UNMEASURED`. On idle frames, `standing` is never
measured: `frames[].standing` and `pairs[].standing` carry `status: "SKIP"` with
`reason: "not applicable: motion_opened reads the pair"` when `motion_opened`
reads that frame (or pair), or
`reason: "idle standing is not measured: idle frames have no recomposite oracle, and the pair's idle reading is motion_opened"`
when `motion_opened` cannot read that frame (or pair). `pairs[].standing` is
the idle summary only; setup status is at `pairs[].setup.standing` (never folded
into `pairs[].standing`), and `BehindSeamsStanding`, `BehindSeamsReading` and
`BehindSeamsTurnPair['standing']` carry an optional `reason` string when
`status` is `"SKIP"`. `BEHIND_PART_SEAMS`
keeps `setup`, `motion_opened` and `standing` separate, names the selected pair
and provenance, per-frame `behind_slots`, grid and sampled/read/unmeasured
counts, and reports per-frame hits, worst counts, temporal spans and spatial
runs. Exceeding the allowance uses `CHECK_BEHIND_PART_SEAMS`
(`object: "pair \"<A>|<B>\" setup standing"` at setup); a mandatory unread
population uses `CHECK_BEHIND_PART_SEAMS_UNMEASURED`. Missing behind slots,
`--parts` manifest for setup standing's recomposite, idle, setup, motion
support, boundary population or verified render evidence is a HOLE, not a zero
PASS. Existing render/sidecar refusals remain refusals. The standing
bracketed-run definition does not certify curved or diagonal openings.

Per-cell samples are a bounded diagnostic sample; the counts are the
measurement (issues #1403, #1406). Each measured `samples[]` list (setup standing, idle
`motion_opened` on every idle frame, and turn `motion_opened` on every turn
pose; idle and turn `standing` are never measured and their `samples[]` are
always `[]`) and each `unread_corridors[].cells` list holds at most 64 rows.
A list that measured more holds 64 and gains `samples_omitted` (or
`cells_omitted` on an unread corridor), the number of
rows left out; a list of 64 or fewer has no such field and is written as before.
Standing keeps its 64 worst rows: counted first, then the larger of the two
distances' minimum, then the earlier measured row. Motion-opened rows and
unread-corridor cells carry no
distance and keep rows floor(j · n / 64), j = 0 … 63, of the n measured. Kept
rows stay in measured order. Every count (`cell_count`, `unread_cells`), `px`, `box`, hit, span, run and status
is computed from all cells.

Issue #1323 adds `behind_seams.turn: true` as an explicit opt-in. It references
existing emitted turn slider ranges, never a second range declaration. Without
this key no turn rows are written and existing `check.json` bytes are unchanged.
With it, `BEHIND_PART_SEAMS.turn` records named independent reset poses: each
dial's declared `from` and `max` with other dials at setup, then every full
min/max corner, deduplicated in that order. It records planned and observed dial locals and observed slider mapped times, per-pair
`frames`, `sampled_poses`, `read_poses`, `unmeasured_poses`, `motion_opened`
status and maximum count, and the `standing` summary (`status: "SKIP"`,
`reason`, `max_px: 0`). There are no temporal
spans: pose indices are sample identities, and time is 0 for every reset.
Turn uses its own setup, rest geometry and transported stock seam evidence;
idle stock and idle counts are unchanged. The same thresholds, allowances and
rear-set rules apply to `motion_opened` on turn poses. Because a turn pose is
an independent `t=0` pose and the parts' flat recomposite is not transported to
it, turn `standing` is never measured (issue #1412), mirroring idle: on each
turn pose, `turn.pairs[].frames[].standing` carries `status: "SKIP"` with zero
counts, `box: null`, `samples: []`, no `unread_cells` or `unread_corridors`, and
its per-pose `reason` (`"not applicable: motion_opened reads the pair"` when
`motion_opened` reads the pair on that pose, or
`"turn standing is not measured: turn poses have no recomposite oracle, and the pair's turn reading is motion_opened"`
when `motion_opened` cannot read the pair on that pose), and the pair summary
`turn.pairs[].standing` is `{ status: "SKIP", reason, max_px: 0 }` (carrying the
motion-read reason when `turn.pairs[].motion_opened.status !== "SKIP"`, or the
turn no-oracle reason when it is `"SKIP"`). Where `motion_opened` cannot read
the pair on a turn pose, its existing named `HOLE` in `turn.unmeasured[]` stays
in place, and with an authored effective T emits
`CHECK_BEHIND_PART_SEAMS_UNMEASURED`. No declared dial persists turn SKIP and a named HOLE;
an effective authored T makes that missing required reading a
`CHECK_BEHIND_PART_SEAMS_UNMEASURED` failure. Legacy `turn.x` has no declared
finite range and is explicitly unread, never given a guessed range. The
official facade supplies geometry from one throwaway gated build that appends
one duration-0 pose animation per selected endpoint/corner, retaining setup,
sliders, original animations, profile and pack flags. Timeline properties are
`rotate` / `translatex` / `translatey`, with offsets from setup. Actual local
channels (after constraints) must match planned locals at float32 precision;
slider mapped times are also retained. Actual poser, atlas text, decoded pages
and setup geometry must match the accepted build, or turn is a named HOLE.
Build refusal also leaves unrelated readings available, with scratch cleanup
in all cases. The original skeleton SHA-256 is recorded once in turn limitations.
Without opt-in there is no scratch copy or extra build. Missing effective T for
one pair is optional SKIP even when another pair has a required override.
An unavailable poser or source is a HOLE. Other animations, between-sample turns and alternate
skins remain unmeasured.

Issue #1409 reads `motion_opened` on a contact-only pair: one with no setup
overlap band (no cell drawn at 128/255 or more by both members at setup) whose
stock transported support is otherwise complete. Such a pair's idle and turn
readings may change from unmeasured (`SKIP` with a `HOLE`) to `PASS` or `FAIL`.
The reading carries a setup contact edge (a cell drawn only by A beside a cell
drawn only by B) to the frame through both members' meshes and counts the swept
cells, drawn by neither member there, that either map carries back onto that
member's setup material. Pairs with a band never enter this reading and their
`check.json` bytes are unchanged, `limitations` included. New optional fields,
each present only on a pair read this way:

| Field | Stable meaning |
| --- | --- |
| `pairs[].motion_support`, `pairs[].frames[].motion_support`, `turn.pairs[].motion_support`, `turn.pairs[].frames[].motion_support` | `"setup-contact"`: the motion reading came from transported setup contact edges, not an overlap band. |
| `pairs[].frames[].motion_opened.lower_bound_cells`, `turn.pairs[].frames[].motion_opened.lower_bound_cells` | Present only when positive: swept cells that pass the hidden/full/rear tests but that neither member's map carries back onto setup material. They are not counted, so this row's count is a lower bound. |
| `pairs[].motion_opened.lower_bound_frames`, `turn.pairs[].motion_opened.lower_bound_poses` | Present only when positive: the number of frame or pose rows that carry `lower_bound_cells`. |

A line with at least one such pair appends one clause to `limitations`, and a
turn block with one appends it to `turn.limitations`. Two limits hold. A count on a row with `lower_bound_cells` is a lower bound: a
member that separates from its partner by about its own width or more sweeps
cells that no map carries back. A member that draws more than one fragment at
setup or on a frame is not read: that frame is a named `HOLE` in
`unmeasured[]` (`CHECK_BEHIND_PART_SEAMS_UNMEASURED` with an authored T), and so
is a frame where a clip cuts either member at setup or on that frame, because a
clipped drawing is not its attachment's and cannot be carried through it. A
pair whose members overlap only below 128/255 and share no contact edge keeps a
named `HOLE` that says so; a pair with neither band nor contact keeps the
existing `HOLE` text.

Issue #1325 adds the following optional evidence fields to
`BEHIND_PART_SEAMS.pairs[].setup.standing` (idle `frames[].standing` and turn
`turn.pairs[].frames[].standing` are never measured). Paths in
the table are relative to that standing record.

| Field | Stable meaning |
| --- | --- |
| `unread_cells` | Distinct native cells in this frame's unread corridors (at setup, leaving out cells within T of the parts' recomposite); cross-axis intersections count once. This is an unread population, not a contrast count. |
| `unread_corridors` | Nonempty array of ambiguous-endpoint runs (at setup, those with at least one cell where `dRecomposite > T`), horizontal rows before vertical columns, each in native scan order. |
| `unread_corridors[].axis` | `horizontal` or `vertical`. |
| `unread_corridors[].endpoints` | Two `[grid_x, grid_y, world_x, world_y, owner]` tuples in left/right or top/bottom order. Grid indices are zero-based, x right and y down; world coordinates are cell centres, y up. Owner codes are 0 for neither A/B reaching half alpha, 1 for A only, 2 for B only and 3 for both; no owner is inferred. |
| `unread_corridors[].cells` | Interior world-centre `[x, y]` tuples in run order, excluding endpoints, capped at 64 evenly spaced entries (`floor(j · cell_count / 64)`, `j = 0 … 63`, when `cell_count > 64`; all `cell_count` entries when `cell_count <= 64`). On a corridor whose endpoint owner is ambiguous (`0` or `3`) at setup, cells within T of the parts' recomposite (`dRecomposite <= T`) are left out of the unread population; the remaining interior cells are reported without a rear-colour or endpoint-contrast filter; intersections may repeat across corridors. |
| `unread_corridors[].cell_count` | The corridor's full count of unread interior cells (at setup, leaving out cells within T of the recomposite), equal to `cells.length + (cells_omitted ?? 0)`. |
| `unread_corridors[].cells_omitted` | Optional positive integer, present only when `cell_count > 64`: the unread interior cells left out of `cells` (`cell_count - cells.length`). |
| `unread_corridors[].row_scope` | `pair`. |
| `unread_corridors[].row_kind` | `evidence`. |
| `unread_corridors[].row_subjects` | The two selected part names in producer A/B order. |

Both fields are omitted when no ambiguous corridor is found, preserving the
bytes of fully read frames; no zero or empty-array placeholders are added.
`motion_opened` gains no field. Missing optional unread-corridor evidence does
not certify other unavailable readings or numeric colour underflow as read.
A corridor with an ambiguous endpoint owner (and, at setup, at least one cell
with `dRecomposite > T`) remains unread without choosing an A/B owner. Readable
corridors retain their measured cells: a standing count above allowance remains
FAIL even with unread corridors, while unread corridors without a measured
excess leave standing SKIP. Required unread evidence still makes the combined
line FAIL. Idle `read_frames` counts idle frames where `motion_opened` is read,
and turn `read_poses` counts turn poses where `motion_opened` is read (without
a `turn.unmeasured[]` row for that pose; idle and turn `standing` are never
measured); poses where `motion_opened` is unavailable remain in
`unmeasured_poses`. Setup is reported separately at
`pairs[].setup`.
A boundary-colour PASS does not prove seam closure. Without `behind_seams`,
existing configurations remain optional and their checks retain their behavior;
no behind-part PASS is claimed. See [Behind-part seams](AUTHORING.md#behind-part-seams-issue-1314).

The optional `cut_material` block in `--requirements` declares a part, joint,
independent stage-pixel centre, inward axis, reach and continuous bend interval.
`assemble --requirements` and `build --requirements` write source-edge evidence
only for that explicit block; `check --requirements` refuses unavailable or
stale evidence rather than reconstructing original art from emitted siblings.
Without the block the API reading is SKIP; CLI stdout and emitted bytes remain unchanged.
See [Source before scissors](AUTHORING.md#source-before-scissors).

### Scene plate editor receipts

`scene.plate.editor_receipts` (issue #966, additive) is optional and uses the
assemble receipt ledger shape, including `required` and `trace_parts`.
Receipt file paths resolve against the scene file. Declared receipts are
verified even without `required`; when required, the plate needs a verified
receipt matching its bytes. Receipt refusals occur before compose writes new
artifacts. As before, compose creates `--out` and clears its owned outputs,
including an earlier `rig/` and `scene.json`, before input validation, so a
refused re-run can remove earlier artifacts. Omitting the field preserves
exit codes and `scene.json` bytes. The existing required
`provenance` field is preserved. It declares pixel origin, while the receipt
verifies file identity and records the author's edit declaration.

### Editor receipts

The optional `assemble.editor_receipts` block (issue #946, additive) records
images edited in an image editor. Absent, no file is read and every output is
byte-identical. Declared, every receipt's `file` must exist and hash to its
`sha256` (`ASSEMBLE_EDITOR_RECEIPT_FILE`, `ASSEMBLE_EDITOR_RECEIPT_SHA256`);
`from_sha256` and `editor` are the author's declaration, held to form and to
`from_sha256` differing from `sha256` (`CONFIG_EDITOR_RECEIPT`). The optional
boolean `required` is the author's declaration that no edited image may go
without one: with `true`, every author-made layer, hidden-art layer, cut
`under` and limb `cap` the build reads needs a receipt matching its bytes
(`ASSEMBLE_EDITOR_RECEIPT_MISSING`), refused before anything is assembled.
Absent or `false`, nothing is demanded; a build whose receipts all verify
writes the same bytes as without the block. No input accepted before the block
existed changes its exit code: the refusals fire only on a block that input
could not have held. The optional boolean `trace_parts` (issue #947, additive)
is the author's declaration that every part's pixels trace to a layer of the
split or to a receipted image: with `true`, receipts are demanded as under
`required`, and every shape the config draws through a part (a cut's
`polygon`, `seethrough.arm_split`, a limb's `split.line`, a patch's `box`, a
painting extension's `band`) is refused (`ASSEMBLE_PART_SOURCE`) before
anything is assembled. Absent or `false`, nothing more is demanded and no byte
moves.

### Edited rig-space parts

The [external mask receipt](AUTHORING.md#external-mask-receipt) is
`rig-parts-external-receipt/1`. Its producer declaration is also accepted
by `edited-part --producer`. Edited-part receipts with an `editor` string
remain readable and keep their output bytes for identical inputs.

`edited-part` (issue #1328) records `sha256` and `from_sha256` from the
supplied PNG bytes, plus the supplied `producer` or nonblank `editor`. It replaces the
named part's receipt in place or appends one, preserving every other row and
unrelated config byte. It validates `--config` through the assemble loader
and optional `--rig-config` through the full loader. Each must already declare
`assemble.edited_parts`. With `--parts`, the manifest's assembly config digest
is checked against `--config` before writing. Without it, the command prints
that no assembly config check ran. Paths are recorded
relative to each config's edited-parts directory. There is no config discovery
or reassembly: a wrong same-size `--from` is recorded successfully, then the
existing build baseline verifier refuses it with `ASSEMBLE_EDITED_PART_BASELINE`.
Writer validation refusals leave both configs unchanged. All configs stage
before the shared batch commits, restoring earlier originals on a later commit
failure. The command prints shared config-change lines on stderr and a receipt
line on stdout naming the part, both hashes and the author declaration. Repeated
identical receipts preserve bytes and report `unchanged`.

The optional `assemble.edited_parts` block (issue #1278, additive) replaces
existing base-plan parts with verified rig-pixel PNG files after all automatic
passes and final restoration. It preserves boxes, names, draw order and
original `from` identities. The encoded edited file bytes are emitted intact;
recomposite and final accounting consume its decoded pixels. Both the edited
file hash and the current normal assembled part's `from_sha256` are verified.
The block does not change author-layer projection or editor receipt semantics.
Alternate sets retain their own declared art; inherited base assets use the
edited base image. No new flag bypasses rig-c or existing check bars.

Receipt association is additive `provenance.edited_part` metadata: the complete
receipt and `dir`, `edit: "edited_parts[i]"`, `changed_px`,
`changed_counted_px`, `changed_excluded_px` and `removed_opaque_px`, then,
when `removed_opaque_px` is above 0, `removed_opaque_regions` (issue #1383,
additive): one `{box: [x, y, w, h], px}` per 8-connected region of removed
positions, in part pixels, sorted by `y`, `x`, `h`, `w`, `px`, whose `px` sum
to `removed_opaque_px`. An edit that removes nothing, and a build without the
block, writes the same bytes as before. A manifest without the field reads as
before; a reader that predates it refuses a manifest that carries it
(`PARTS_FIELD_TYPE`).
The four counts describe exact baseline-to-edited RGBA differences;
`hand_px` keeps its existing final-alpha-above-8 partition meaning.
The receipt covers the whole file, including unchanged and transparent
positions; stage-map entries retain that association separately from writer
runs. The strict parts reader rejects malformed associations and inconsistent
counts. [AUTHORING](AUTHORING.md#edited-rig-space-parts-assembleedited_parts-issue-1278)
defines paths, counts and the base-only scope.

An unknown part, missing file, edited hash mismatch, stale baseline hash,
dimension mismatch or duplicate part is refused by its dedicated
`ASSEMBLE_EDITED_PART_*` code before any output write. A non-decodable PNG is
also refused before writes. A preexisting successful output remains unchanged.
The [refusal table](https://github.com/rig-c/parts/blob/main/docs/CHECKS.md#edited-rig-space-parts)
names each code. Without the block, existing outputs and metadata stay
byte-identical; an empty receipt list applies no replacement.

## Provider-map depth stages (#897)

`depth-place` (#1570) accepts an optional `place` block on `rig-parts-depth/1`.
The command requires the block, a body turn, and an absent or empty output
directory. It emits `recipe.json`, `config.json` and `depth-place-report.json`
(`rig-parts-depth-place-report/1`).
Placement uses the declared polarity and a positive, explicit scale in rig
pixels per model unit. It writes body placement medians and world rig `z` for
body units, preserves declared reliefs and `zScale`, and resolves the body pivot
to an offset from the reference depth. See the
[placement contract](AUTHORING.md#place-body-depth-from-a-whole-painting-map-1570).
With `--check-turn`, preparation, application and the real rig gate run in
scratch space and the report adds `turnCheck`. It records any named check
refusal. Successful placement emits its three files and exits `0` in either
check outcome.

The opt-in `depth-prepare` and `depth-apply` commands accept the separate
`rig-parts-depth/1` recipe and finite floating-point `rig-parts-map/1` JSON.
Prepared provenance is `rig-parts-depth-inputs/1`; application writes
`rig-parts-depth-report/1`, standard part depth references and a relocated
character config. Their schemas, frames, alpha threshold, normalization,
encoding, convexity sign and refusal remedies are in
[AUTHORING](AUTHORING.md#per-part-provider-maps-897). No existing build path
calls these stages; no-config builds retain their existing behavior and bytes.
Group numbers and unit depths are explicit; no provider or absolute scale is
inferred. `depth-apply --groups` (#1449) applies a subset of the recipe's
groups against the same manifest and records it in the report's `selection`
field (`groups`, `leftOut`), written after `cleared` and before `parts`; the
field is absent without the flag, so those reports keep their bytes, and
`recipeSha256` and `manifestSha256` are unchanged by a selection. A new depth stage never replaces Core's rig gate.
`relief` is an explicit rig-pixel value, not an implicit width multiplier.
Part-width and head-referenced calibrations are authored recipe choices;
changing a calibration requires preparing its recipe again. Compare the same
provider maps and preserve their provenance. The additive `DEPTH_APPLY_CLIPPED`
refusal applies before any output write, including for previously accepted
clipped recipes, regardless of map binding receipt presence. Every original
part pixel with alpha >= 128 must satisfy
`0 < z < zScale` before encoding. The clip fraction divides the number of
supported pixels at or beyond either boundary by the total supported pixel
count.

For upper clipping the refusal gives the smallest binary64 group `zScale`
strictly above the maximum original supported depth in the group. For each
part with lower clipping it gives the minimum authored median (the next
binary64 value above the maximum negated relief offset over that part's
support) and its difference from the previous authored median. When both
boundaries clip, the refusal includes both remedies. If a required value has
no finite binary64 representation, the refusal directs the author to revise
the calibration. A median adjustment may require recomputing the group scale.

`rig-parts-depth-report/1` keeps its existing keys. Each successful row names
the part, declared relief, group `zScale` and a zero `clipFraction` over the
original alpha >= 128 support. Shape quality is assessed separately.

`depth-map` (issue #1573) is an additive minor-version command. It accepts
C-order NumPy `.npy` 1.0, 2.0, and 3.0 arrays with little-endian `float32` or
`float64` data. Depth accepts `(H, W)` or `(H, W, 1)`. Normals accept
`(H, W, 3)` with signed XYZ components in image axes (X right, Y down).
Declared array-edge padding is cropped before mean pooling with independent
positive integral X and Y factors derived from the prepared PNG dimensions.
Pooled normals are normalized to unit length. The command refuses retained
nonfinite samples, retained zero normals, and pooled zero normals by pixel.
`--out` must name a new file in an existing writable directory. The command
writes only the `rig-parts-map/1` JSON at the PNG dimensions and prints the
next `depth-bind` command with its arguments quoted for a POSIX shell.
Hand-authored `rig-parts-map/1` maps continue through
the same bind and apply stages. See [Convert a NumPy array](DEPTH.md#convert-a-numpy-array).

The requirements file's `fps` becomes optional when no declared measurement
reads that rate (issue #965, additive for readers). Measurements in
`requirements` still require a positive `fps`, with no default. Declarations
whose instruments use their own rate keep that rate.
The output `check.json` omits `requirements.fps` when the file supplies no `fps`.

### Crop donor transport receipts (issue #973)

Whole-layer `parts[].taken_layers[]` optionally adds `transport` when its config
entry declares `crop`. The ordered fields are `crop`, `donor_canvas`,
`target_canvas`, `scale`, `translate`, `filter`, `input_rgba_sha256`,
`before_rgba_sha256` and `after_rgba_sha256`. Hashes bind whole-canvas row-major
straight RGBA before and after transport, and the donor input reconstructed from
the declared crop. `filter: "exact"` requires unit scale and integer translation.
Other maps carry `"bilinear"`. The strict reader refuses incomplete or malformed
transport records. Absent, the existing receipt fields and bytes are unchanged.
The output hash describes transport before downstream assembly, independently of
final part geometry. Existing no-take inputs emit no transport metadata.

### Region take source compatibility (issue #1054)

A see-through `--source` with an opaque explicit painting reference was accepted
when donor geometry followed the reference and is now refused with
`INPUTS_PAINTING_OPAQUE` before the donor is read. The reference remains a colour
binding. The donor continues to be bound to the opaque PNG accepted by `inputs`.


The check document's Parts row objects additionally carry `row_scope` (`part`,
`pair`, `rig`), `row_kind` (`finding`, `evidence`), and `row_subjects` (one part,
two parts, or an empty list respectively). These are additive; legacy `scope`,
`kind`, measurements, statuses and exit decisions are unchanged. There is no
top-level check spec/version tag to bump. See [Consumer check rows](AUTHORING.md#consumer-check-rows-issue-1089)
for the producer-derived family table and the boundary between rows and summaries.
The entries of `loop_seam.series` retain Core's native fields.
