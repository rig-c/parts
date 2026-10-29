/**
 * `rig-parts remesh` (issue #495): re-fit ONE part's mesh of an existing, gated rig under a mesh entry the request
 * declares, and write a new package revision beside the input — every other byte of the input carried over, the
 * input never written. The producer side of a reviewer's mesh request (rig-c/review #45): a reviewer names a part and
 * the bounds, and this package builds the mesh through its own modes and gates, so no mesh byte originates in the
 * review tool.
 *
 * ## The request
 *
 * `--part <name>` and `--mesh <entry.json>`: the entry is what `config.json` would hold at `meshes.<name>` — a
 * lattice (`grid`), an outline (`contour`) or an automatic mesh (`auto`) with the same `r`, `segments`, `rule`,
 * `influences`… — and it is read by the config's own loader, spliced into the author's config, so every refusal it
 * can draw is the config's (`CONFIG_*` at `meshes.<name>`). The declared bounds are that entry's: for `auto` its
 * `sourceBounds`, `targets` (art fit, boundary deviation, smallest angle), `influences`, `budget`, `regions` and its
 * `motion` gate; for `contour` its tolerance, margin, spacing and `maxEdge`; for `grid` its spacing. There is no
 * second vocabulary for them, so there is no second loader.
 *
 * `--delta <mesh-edit.json>` (issue #526), in place of `--mesh`: rig-c/review's mesh edit, ops over the input's own
 * mesh, replayed by `src/remeshdelta.ts`. That path builds no config entry — steps 3 and 4 become the source checks
 * (the edit's counts and `source.hash`, the SHA-256 of the part's entry in rigc's model document over the input) and
 * the replay — and steps 5 to 8 are the same.
 *
 * ## The steps, each one a refusal by name
 *
 * 1. **The input** ({@link readTree}): `--rig` holds `rig.json`, `motion.json`, `mesh_report.json` and `images/`, as
 *    `rig` writes them; `rig.json` and `mesh_report.json` must be the bytes this package's writer prints for what they
 *    parse to (`REMESH_INPUT_WRITTEN`), since the revision is spliced as text. `--out` must not exist
 *    (`REMESH_OUT_FRESH`): a revision is a new folder, and it is never the input.
 * 2. **The target** ({@link targetProblems}): the part is a `mesh` attachment of the input rig and an entry of the
 *    config's `meshes` (`REMESH_TARGET_MESH`); no `linkedmesh` borrows its geometry and no animation keys a `deform`
 *    timeline on it (`REMESH_TARGET_CLOSED`) — either is bound to the vertex list the remesh replaces, so it is
 *    refused rather than left pointing into a mesh it no longer describes.
 * 3. **The baseline** ({@link baselineProblems}): the config as written is built through the rig stage, and that
 *    build must reproduce the input's target — its attachment, its image and its `mesh_report.json` row — and the
 *    input's bones; for an `auto` request, its motion too, since the auto mode's motion gate is measured on the
 *    config's idle (`REMESH_BASELINE_MISMATCH`, naming the first difference). Nothing else is compared: the parts the
 *    config does not reproduce are the accepted repairs a whole rebuild would lose (issue #495's "Why"), and they are
 *    carried over as bytes.
 * 4. **The candidate**: the config with the request spliced in at `meshes.<name>` is built through the rig stage —
 *    every mode's own checks and, for `auto`, its motion gate — and a refusal there is the request's
 *    (`REMESH_CANDIDATE_REFUSED`, quoting each problem, its measured figure with it). The candidate's bones, motion
 *    and target image must be the baseline's (`REMESH_REQUEST_HELD`): a request that adds a control bone or moves a
 *    key is no longer a remesh of one part.
 * 5. **The splice**: the input's `rig.json` with the candidate's attachment at `skins.default.<name>.<name>`, and
 *    its `mesh_report.json` with the candidate's row in the target's place; every other file is the input's bytes.
 * 6. **The preserve assertion** ({@link preservedProblems}): every file but those two byte-identical to the input's;
 *    `rig.json` byte-identical outside the target attachment's text; every other row of `mesh_report.json`
 *    identical (`REMESH_PRESERVED`, naming the file and the part that moved).
 * 7. **The gate and check**: the revision goes through rigc's build gate, as `rig` writes (`REMESH_RIGC_GREEN`), and
 *    through `check` beside the input; every bar the input measured is measured on the revision, and no bar the
 *    input met is failed by it (`REMESH_CHECK_HELD`). `check`'s scope is the revision's scope, and the provenance
 *    quotes check's own physics line ({@link checkScope}) rather than presenting a green check as more than it read.
 *    Under `--input-check <input-check.json>` (issue #617) the input's check is not run again: the record an earlier
 *    `--record-input-check` wrote is reused when every row binding it to what that check reads is this run's
 *    ({@link inputCheckBoundProblems}), and refused by name otherwise (`REMESH_INPUT_CHECK_FILE`,
 *    `REMESH_INPUT_CHECK_BOUND`) before anything is built.
 * 8. **The write**: `--out` receives the revision's files and {@link PROVENANCE_FILE} — spec {@link REMESH_SPEC}:
 *    the request, both versions, every input file's SHA-256, the target before and after, and both checks — with no
 *    path and no clock in it, so a second identical request writes the same bytes.
 *
 * Pure in the sense `src/` is held to: rigc runs as a process, but the process is injected, exactly as
 * `src/build.ts` takes it.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { checkStage, gateThroughRigc, type Log, RIGC_MODEL_DOCUMENT, rigStage } from './build.ts';
import { barsNotMet, type CheckReport, checkStatuses, type CheckStatus, checkSummaryLine, DEFAULT_PACK_SHAPE, DEFAULT_PAGE_EDGES, type PackShape, type PageEdges, rigcRanClause, type RigcRunner } from './check.ts';
import { loadConfigAndAnimations } from './config.ts';
import { PartsError, type Problem, problemLine, refuseIfAny } from './errors.ts';
import { jsonValueSpan, scratchConfig } from './meshdraft.ts';
import { type BoneTransform, computeExactFrameTransforms } from './coords.ts';
import { type PartsFile } from './parts.ts';
import { applyMeshEdit, type DeltaApplied, type DeltaPlant, deltaSourceProblems, type MeshEditDocument, readMeshEdit } from './remeshdelta.ts';
import { DEFAULT_IDLE_KEYS, type IdleKeys, type MeshAttachment, meshBoundBones, rigJsonText, type RigSpec } from './rig.ts';
import { readRequirements } from './requirements.ts';
import { pyRound } from './round.ts';
import { type RigSpec as RigcRigSpec } from '@rig-c/core/src/rig.ts';
import { expandStops } from '@rig-c/core/src/stop.ts';

/** The provenance file's spec. */
export const REMESH_SPEC = 'rig-parts-remesh/1';

/** The provenance file, at the revision's root beside `rig.json`. */
export const PROVENANCE_FILE = 'remesh.json';

/** The files `rig` writes that a revision must carry (`images/` is read as a folder). */
export const RIG_TREE_FILES = ['rig.json', 'motion.json', 'mesh_report.json'] as const;

/**
 * The scope sentence the provenance carries (rig-c/review #41's addendum): `check`'s own physics line, quoted, so a
 * green check is read with the scope check states for it — and nothing beyond what check states is claimed here.
 */
export function checkScope(physics: string | null): string {
  return physics === null ? 'check states no physics line: the rig declares no physics constraint, or has no idle' : `as check states it: ${physics}`;
}

export interface RemeshInput {
  /** The input revision: the directory `rig` wrote (`rig.json`, `motion.json`, `mesh_report.json`, `images/`). */
  rig: string;
  /** The config the input was built from. */
  config: string;
  /** The directory holding `parts.json` and `parts/` the input was built from. */
  parts: string;
  /** The part to remesh: its slot and its attachment, as the rig stage names both. */
  part: string;
  /** The request's mesh entry: a JSON file holding what `config.json` would hold at `meshes.<part>`. Exactly one of `mesh`, `delta`. */
  mesh?: string;
  /** The request as rig-c/review's mesh edit (`rig-review-mesh-edit/1`, issue #526): ops over the input's own mesh. Exactly one of `mesh`, `delta`. */
  delta?: string;
  /** The new revision's directory; it must not exist. */
  out: string;
  idleKeys?: IdleKeys;
  pageEdges?: PageEdges;
  packShape?: PackShape;
  requirements?: string;
  /** Issue #617: a {@link INPUT_CHECK_FILE} an earlier run wrote over this input; its check is reused when it is bound to this run's input. */
  inputCheck?: string;
  /** Issue #617: write {@link INPUT_CHECK_FILE} into `out` beside the provenance. Without it, and without `inputCheck`, nothing written moves. */
  recordInputCheck?: boolean;
}

/**
 * Planted faults for the selftest (issue #495, bar 4) — never set by the CLI: `perturb` changes the first uv of the
 * named part's attachment in the revision after the splice, and `skipPreserve` takes the preserve assertion out, so
 * the selftest can show both that the assertion names the part and that its own independent reading does.
 */
export interface RemeshPlant {
  perturb?: string;
  skipPreserve?: boolean;
  /** Issue #526's mutants, handed to the delta's replay (`src/remeshdelta.ts`). */
  delta?: DeltaPlant;
  /** Issue #613's mutant: the setup frames read off `rig.json`'s bones as written, its `stops` not expanded. */
  unexpandedStops?: boolean;
  /** Issue #617's mutant: run just before check-input reads the input, after the first snapshot, to change a file under it. */
  beforeInputCheck?: () => void;
}

/** The versions the provenance names: this package's and the rigc that gated the revision (its `--version` line). */
export interface RemeshVersions {
  parts: string;
  rigc: string;
}

/** A tree of files, by path relative to its root (`/`-separated), sorted by code unit. */
export type FileTree = Map<string, Uint8Array>;

/** One file of a tree, as the provenance lists it. */
export interface HashRow {
  path: string;
  bytes: number;
  sha256: string;
}

/** The counts of one mesh attachment. */
export interface MeshCounts {
  vertices: number;
  triangles: number;
  hull: number;
}

/**
 * One side of the provenance's check block. The first five fields are what the hold ({@link checkHeldProblems})
 * reads; `line` and `status` (issue #541) are what `check` itself reports on the same tree — its last line, whole,
 * and every block's status as `check.json` records it — so a consumer need not run `check` a second time.
 */
export interface CheckSide {
  pass: boolean;
  measured: string[];
  not_met: string[];
  skipped: Array<{ bar: string; reason: string }>;
  physics: string | null;
  /** The last line `check` prints ({@link checkSummaryLine}), byte for byte. */
  line: string;
  /** Every block's status as `check.json` records it, in the file's order ({@link checkStatuses}). */
  status: Record<string, CheckStatus>;
}

/** `remesh.json` (spec {@link REMESH_SPEC}). */
export interface RemeshProvenance {
  spec: typeof REMESH_SPEC;
  request:
    | { part: string; mesh: unknown; mesh_sha256: string; idle_keys: IdleKeys; page_edges: PageEdges; pack_shape: PackShape }
    | { part: string; delta: MeshEditDocument; delta_sha256: string; ops: number; applied: Omit<DeltaApplied, 'ops'>; idle_keys: IdleKeys; page_edges: PageEdges; pack_shape: PackShape };
  versions: RemeshVersions;
  input: { rig: HashRow[]; config_sha256: string; parts_json_sha256: string; provenance?: ParentProvenance[] };
  baseline: { reproduced: string[]; not_compared: string };
  target: { before: MeshCounts; after: MeshCounts };
  preserved: { identical: string[]; spliced: string[] };
  revision: HashRow[];
  check: { input: CheckSide; revision: CheckSide; scope: string };
}

export interface RemeshResult {
  provenance: RemeshProvenance;
  written: string[];
}

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Every file under `root`, by `/`-separated relative path, in code-unit order. */
export function readTree(root: string): FileTree {
  const out: Array<[string, Uint8Array]> = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push([relative(root, p).split(sep).join('/'), new Uint8Array(readFileSync(p))]);
    }
  };
  walk(root);
  out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return new Map(out);
}

export function hashRows(tree: FileTree): HashRow[] {
  return [...tree].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) }));
}

/** A previous root record, recoverable byte for byte at its content-addressed path (issue #531). */
export interface ParentProvenance extends HashRow { source: 'remesh.json' | 'retune.json' }

/** Keep prior records before replacing the current root record; no rig, motion or hold input is changed. */
export function carryProvenance(input: FileTree, revision: FileTree, replacing: 'remesh.json' | 'retune.json'): { revision: FileTree; parents: ParentProvenance[] } {
  const next = new Map(revision), parents: ParentProvenance[] = [];
  for (const source of ['remesh.json', 'retune.json'] as const) {
    const bytes = input.get(source);
    if (bytes === undefined) continue;
    const digest = sha256(bytes), path = `provenance/${source.slice(0, -5)}-${digest}.json`;
    const existing = next.get(path);
    if (existing !== undefined && !bytesEqual(existing, bytes)) {
      throw new PartsError([{ code: replacing === 'remesh.json' ? 'REMESH_PRESERVED' : 'RETUNE_PRESERVED', object: path,
        detail: `already holds ${existing.length} bytes sha256 ${sha256(existing)}; preserving parent ${source} requires ${bytes.length} bytes sha256 ${digest} at that path, so nothing is written` }]);
    }
    next.set(path, bytes);
    parents.push({ source, path, bytes: bytes.length, sha256: digest });
  }
  next.delete(replacing); // The new root record cannot list a hash of itself.
  return { revision: new Map([...next].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)), parents };
}

const text = (b: Uint8Array): string => new TextDecoder().decode(b);
const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s);

/** The first leaf at which `a` and `b` differ, as `path: a vs b`, or null when they are equal as JSON. */
export function firstDifference(a: unknown, b: unknown, at = ''): string | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length || i >= b.length) return `${at}[${i}]: ${i >= a.length ? 'absent' : JSON.stringify(a[i])} vs ${i >= b.length ? 'absent' : JSON.stringify(b[i])}`;
      const d = firstDifference(a[i], b[i], `${at}[${i}]`);
      if (d !== null) return d;
    }
    return null;
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) {
      const p = at === '' ? k : `${at}.${k}`;
      if (!(k in a) || !(k in b)) return `${p}: ${k in a ? JSON.stringify(a[k]) : 'absent'} vs ${k in b ? JSON.stringify(b[k]) : 'absent'}`;
      const d = firstDifference(a[k], b[k], p);
      if (d !== null) return d;
    }
    return null;
  }
  return JSON.stringify(a) === JSON.stringify(b) ? null : `${at === '' ? 'the value' : at}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

/** The target's attachment in a rig, or undefined: the rig stage names a part's slot and attachment after the part. */
export function targetAttachment(rig: Json, part: string): unknown {
  const skins = rig.skins;
  if (!isRecord(skins) || !isRecord(skins.default) || !isRecord(skins.default[part])) return undefined;
  return (skins.default[part] as Json)[part];
}

export function meshCounts(att: unknown): MeshCounts {
  const a = att as { uvs: number[]; triangles: number[]; hull: number };
  return { vertices: a.uvs.length / 2, triangles: a.triangles.length / 3, hull: a.hull };
}

/**
 * Step 2: the part is a mesh of the rig and an entry of the config, and nothing in the rig is bound to its vertex
 * list — no `linkedmesh` borrowing it, no `deform` timeline on it. A physics constraint drives bones, which the remesh
 * does not change,, so it is not a closure here; what check reads of it is check's to state ({@link checkScope}).
 */
export function targetProblems(rig: Json, motion: Json, configMeshes: Readonly<Record<string, unknown>>, part: string): Problem[] {
  const out: Problem[] = [];
  const att = targetAttachment(rig, part);
  if (!isRecord(att) || att.type !== 'mesh') {
    out.push({ code: 'REMESH_TARGET_MESH', object: `rig.json skins.default.${part}.${part}`, detail: `is ${att === undefined ? 'absent' : isRecord(att) ? `a ${typeof att.type === 'string' ? att.type : 'region'} attachment` : 'not an attachment'}; a mesh attachment is required — only a mesh is remeshed` });
  }
  if (!(part in configMeshes)) {
    out.push({ code: 'REMESH_TARGET_MESH', object: `config meshes.${part}`, detail: `is absent (the config meshes ${Object.keys(configMeshes).join(', ') || 'nothing'}); the input's target must be a mesh the config states, so the baseline can reproduce it` });
  }
  const skins = isRecord(rig.skins) ? rig.skins : {};
  for (const [skin, slots] of Object.entries(skins)) {
    if (!isRecord(slots)) continue;
    for (const [slot, atts] of Object.entries(slots)) {
      if (!isRecord(atts)) continue;
      for (const [name, a] of Object.entries(atts)) {
        if (!isRecord(a) || a.source !== part || (a.type !== 'linkedmesh' && a.type !== 'mesh')) continue;
        const from = typeof a.slot === 'string' ? a.slot : slot;
        const fromSkin = typeof a.skin === 'string' ? a.skin : 'default';
        if (from === part && fromSkin === 'default') {
          out.push({ code: 'REMESH_TARGET_CLOSED', object: `rig.json skins.${skin}.${slot}.${name}`, detail: `is a linked mesh whose source is "${part}"; it borrows the vertex list the remesh replaces, so the request is refused rather than leaving it pointing into a mesh it no longer describes` });
        }
      }
    }
  }
  const animations = isRecord(motion.animations) ? motion.animations : {};
  for (const [anim, a] of Object.entries(animations)) {
    const deform = isRecord(a) && Array.isArray(a.deform) ? a.deform : [];
    deform.forEach((t: unknown, i: number) => {
      if (isRecord(t) && t.slot === part && t.attachment === part && (t.skin === undefined || t.skin === 'default')) {
        out.push({ code: 'REMESH_TARGET_CLOSED', object: `motion.json animations.${anim}.deform[${i}]`, detail: `keys a deform timeline on "${part}"; its vertices are indexed into the mesh the remesh replaces, so the request is refused rather than leaving the timeline indexing a different mesh` });
      }
    });
  }
  return out;
}

/** A rig build's files, read off the directory `rigStage` wrote. */
export interface Built {
  rig: Json;
  rigText: string;
  motionText: string;
  report: Json[];
  image: Uint8Array | null;
}

function readBuilt(dir: string, part: string): Built {
  const rigText = readFileSync(join(dir, 'rig.json'), 'utf8');
  const png = join(dir, 'images', `${part}.png`);
  return {
    rig: JSON.parse(rigText) as Json,
    rigText,
    motionText: readFileSync(join(dir, 'motion.json'), 'utf8'),
    report: JSON.parse(readFileSync(join(dir, 'mesh_report.json'), 'utf8')) as Json[],
    image: existsSync(png) ? new Uint8Array(readFileSync(png)) : null,
  };
}

const rowOf = (report: readonly Json[], part: string): Json | undefined => report.find((r) => r.part === part);
const bytesEqual = (a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean => a !== null && a !== undefined && b !== null && b !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Step 3: what the config as written reproduces of the input — the target's attachment, image and report row, the
 * bones, and (for an `auto` request, whose motion gate reads the config's idle) the motion. Each difference names
 * its first leaf.
 */
export function baselineProblems(input: { rig: Json; motionText: string; report: readonly Json[]; image: Uint8Array | undefined }, base: Built, part: string, auto: boolean): Problem[] {
  const out: Problem[] = [];
  const miss = (object: string, what: string): void => {
    out.push({ code: 'REMESH_BASELINE_MISMATCH', object, detail: `the config as written does not reproduce the input here (${what}); a target the producer cannot reproduce is not one it can re-fit with every other byte kept, so the input is refused rather than spliced` });
  };
  const att = firstDifference(targetAttachment(input.rig, part), targetAttachment(base.rig, part));
  if (att !== null) miss(`rig.json skins.default.${part}.${part}`, `input vs rebuilt: ${att}`);
  if (!bytesEqual(input.image, base.image)) miss(`images/${part}.png`, `input ${input.image === undefined ? 'absent' : `${input.image.length} bytes`} vs rebuilt ${base.image === null ? 'absent' : `${base.image.length} bytes`}${input.image !== undefined && base.image !== null ? ', not the same bytes' : ''}`);
  const row = firstDifference(rowOf(input.report, part), rowOf(base.report, part));
  if (row !== null) miss(`mesh_report.json row "${part}"`, `input vs rebuilt: ${row}`);
  const bones = firstDifference(input.rig.bones, base.rig.bones, 'bones');
  if (bones !== null) miss('rig.json bones', `input vs rebuilt: ${bones} — the target's weights bind to these bones`);
  if (auto && input.motionText !== base.motionText) miss('motion.json', `input vs rebuilt: ${firstDifference(JSON.parse(input.motionText), JSON.parse(base.motionText)) ?? 'the same value, different bytes'} — an auto request's motion gate is measured on the config's idle, which must be the input's`);
  return out;
}

/** Step 4's second half: what the request may not change beside the target's mesh. */
export function requestHeldProblems(base: Built, cand: Built, part: string): Problem[] {
  const out: Problem[] = [];
  const held = (object: string, what: string): void => {
    out.push({ code: 'REMESH_REQUEST_HELD', object, detail: `the request changes it (${what}); a remesh changes one part's mesh and nothing else, so the request is refused — state it as a config change and rebuild instead` });
  };
  const bones = firstDifference(base.rig.bones, cand.rig.bones, 'bones');
  if (bones !== null) held('rig.json bones', `rebuilt vs requested: ${bones}`);
  if (base.motionText !== cand.motionText) held('motion.json', `rebuilt vs requested: ${firstDifference(JSON.parse(base.motionText), JSON.parse(cand.motionText)) ?? 'the same value, different bytes'}`);
  if (!bytesEqual(base.image, cand.image)) held(`images/${part}.png`, 'the requested build draws the part from different bytes');
  return out;
}

/**
 * Step 5: the revision — the input tree with `rig.json`'s target attachment and `mesh_report.json`'s target row
 * replaced. Every other entry is the input's own bytes, by reference.
 */
export function splice(input: FileTree, part: string, attachment: unknown, row: Json): FileTree {
  const rig = JSON.parse(text(input.get('rig.json') as Uint8Array)) as { skins: { default: Record<string, Record<string, unknown>> } };
  rig.skins.default[part] = { ...rig.skins.default[part], [part]: attachment };
  const report = (JSON.parse(text(input.get('mesh_report.json') as Uint8Array)) as Json[]).map((r) => (r.part === part ? row : r));
  const out: FileTree = new Map(input);
  out.set('rig.json', bytesOf(rigJsonText(rig)));
  out.set('mesh_report.json', bytesOf(rigJsonText(report)));
  return out;
}

/** The selftest's plant: the first uv of `part`'s attachment in the revision nudged by 1/1024. */
export function perturbed(tree: FileTree, part: string): FileTree {
  const rig = JSON.parse(text(tree.get('rig.json') as Uint8Array)) as Json;
  const att = targetAttachment(rig, part) as { uvs: number[] } | undefined;
  if (att === undefined) throw new Error(`perturbed: the rig has no attachment "${part}"`);
  att.uvs[0] += 1 / 1024;
  return new Map(tree).set('rig.json', bytesOf(rigJsonText(rig)));
}

/**
 * Where a rig's text differs outside the target attachment, by attachment (`skins.<skin>.<slot>.<attachment>`) or by
 * top-level key, so a moved neighbour is named as the part it is.
 */
function movedOutside(a: Json, b: Json, part: string): Array<{ where: string; diff: string }> {
  const strip = (r: Json): Json => {
    const c = JSON.parse(JSON.stringify(r)) as Json;
    const def = (c.skins as Json | undefined)?.default as Record<string, Json> | undefined;
    if (def?.[part] !== undefined) delete def[part][part];
    return c;
  };
  const x = strip(a);
  const y = strip(b);
  const out: Array<{ where: string; diff: string }> = [];
  for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])]) {
    if (k !== 'skins') {
      const d = firstDifference(x[k], y[k], k);
      if (d !== null) out.push({ where: k, diff: d });
      continue;
    }
    const sx = isRecord(x.skins) ? x.skins : {};
    const sy = isRecord(y.skins) ? y.skins : {};
    for (const skin of [...new Set([...Object.keys(sx), ...Object.keys(sy)])]) {
      const px = isRecord(sx[skin]) ? (sx[skin] as Json) : {};
      const py = isRecord(sy[skin]) ? (sy[skin] as Json) : {};
      for (const slot of [...new Set([...Object.keys(px), ...Object.keys(py)])]) {
        const ax = isRecord(px[slot]) ? (px[slot] as Json) : {};
        const ay = isRecord(py[slot]) ? (py[slot] as Json) : {};
        for (const name of [...new Set([...Object.keys(ax), ...Object.keys(ay)])]) {
          const where = `skins.${skin}.${slot}.${name}`;
          const d = firstDifference(ax[name], ay[name], where);
          if (d !== null) out.push({ where, diff: d });
        }
      }
    }
  }
  return out;
}

/**
 * Step 6, the preserve assertion: every file of the input but `rig.json` and `mesh_report.json` byte-identical in the
 * revision and none added or dropped; `rig.json` byte-identical outside the target attachment's text, every moved
 * attachment named; every row of `mesh_report.json` but the target's identical, the moved part named.
 */
export function preservedProblems(input: FileTree, revision: FileTree, part: string): Problem[] {
  const out: Problem[] = [];
  const moved = (object: string, detail: string): void => {
    out.push({ code: 'REMESH_PRESERVED', object, detail: `${detail}; a remesh carries every byte but the target's mesh over from the input, so nothing is written` });
  };
  for (const path of [...new Set([...input.keys(), ...revision.keys()])].sort()) {
    const a = input.get(path);
    const b = revision.get(path);
    if (a === undefined || b === undefined) {
      moved(path, a === undefined ? 'is in the revision and not in the input' : 'is in the input and not in the revision');
      continue;
    }
    if (path === 'rig.json') {
      const ta = text(a);
      const tb = text(b);
      const sa = jsonValueSpan(ta, ['skins', 'default', part, part]);
      const sb = jsonValueSpan(tb, ['skins', 'default', part, part]);
      if (ta.slice(0, sa.start) === tb.slice(0, sb.start) && ta.slice(sa.end) === tb.slice(sb.end)) continue;
      const where = movedOutside(JSON.parse(ta) as Json, JSON.parse(tb) as Json, part);
      if (where.length === 0) moved('rig.json', `differs from the input outside skins.default.${part}.${part} in its bytes, though not in its value`);
      for (const w of where) moved(`rig.json ${w.where}`, `differs from the input outside the target — input vs revision at ${w.diff}`);
      continue;
    }
    if (path === 'mesh_report.json') {
      const ra = JSON.parse(text(a)) as Json[];
      const rb = JSON.parse(text(b)) as Json[];
      const names = (r: Json[]): string => r.map((x) => String(x.part)).join(',');
      if (names(ra) !== names(rb)) {
        moved('mesh_report.json', `holds rows ${names(rb)} where the input holds ${names(ra)}`);
        continue;
      }
      ra.forEach((x, i) => {
        if (x.part === part) return;
        const d = firstDifference(x, rb[i]);
        if (d !== null) moved(`mesh_report.json row "${String(x.part)}"`, `differs from the input — input vs revision at ${d}`);
      });
      continue;
    }
    if (!bytesEqual(a, b)) moved(path, `is not the input's bytes (input ${a.length} bytes ${sha256(a).slice(0, 12)}…, revision ${b.length} bytes ${sha256(b).slice(0, 12)}…)`);
  }
  return out;
}

/** The codes the shared readings below refuse with, by the revising command that runs them (`remesh`, `retune`). */
export const REVISION_CODES = {
  remesh: { inputPresent: 'REMESH_INPUT_PRESENT', inputWritten: 'REMESH_INPUT_WRITTEN', checkHeld: 'REMESH_CHECK_HELD', inputCheckFile: 'REMESH_INPUT_CHECK_FILE', inputCheckBound: 'REMESH_INPUT_CHECK_BOUND', inputCheckMoved: 'REMESH_INPUT_CHECK_MOVED', rigcGreen: 'REMESH_RIGC_GREEN' },
  retune: { inputPresent: 'RETUNE_INPUT_PRESENT', inputWritten: 'RETUNE_INPUT_WRITTEN', checkHeld: 'RETUNE_CHECK_HELD', inputCheckFile: 'RETUNE_INPUT_CHECK_FILE', inputCheckBound: 'RETUNE_INPUT_CHECK_BOUND', inputCheckMoved: 'RETUNE_INPUT_CHECK_MOVED', rigcGreen: 'RETUNE_RIGC_GREEN' },
} as const;

// ---------------------------------------------------------------------------
// the recorded input check (issue #617)
// ---------------------------------------------------------------------------

/** The recorded input check's spec. */
export const INPUT_CHECK_SPEC = 'rig-parts-input-check/1';

/** The recorded input check, written into `--out` under `--record-input-check`, read by `--input-check`. */
export const INPUT_CHECK_FILE = 'input-check.json';

/**
 * Everything the input's `check` reads, as one record: the versions it ran under (this package's, and `rigc
 * --version`'s whole output — the entry line and the Spine runtime beside it decide which validator gates), the pack
 * mode and the requirements file it was given, and every file under the rig directory and the parts directory
 * (`parts.json` and every file under `parts/`) by SHA-256. The directories are named as resolved because `check`'s
 * own text can name them (a rig without an idle is skipped with `motion.json`'s path, `readCheckInputs`), so a check
 * of the same bytes elsewhere is not the same record.
 */
export interface InputCheckBinding {
  versions: { parts: string; rigc: string };
  options: { page_edges: PageEdges; pack_shape: PackShape; requirements: { path: string; sha256: string } | null };
  rig: { dir: string; files: HashRow[] };
  parts: { dir: string; files: HashRow[] };
}

/** {@link INPUT_CHECK_FILE} (spec {@link INPUT_CHECK_SPEC}): the binding, then the input's check side as the provenance carries it. */
export interface InputCheckRecord extends InputCheckBinding {
  spec: typeof INPUT_CHECK_SPEC;
  check: CheckSide;
}

/** `rigc --version`'s whole output, trimmed, or a refusal under `op`'s rigc code: the record binds the rigc that measured. */
export function rigcVersionText(rigc: RigcRunner, op: 'remesh' | 'retune'): string {
  const v = rigc(['--version']);
  const out = v.out.trim();
  if (v.status !== 0 || out === '') throw new PartsError([{ code: REVISION_CODES[op].rigcGreen, object: 'rigc --version', detail: `exited ${v.status}${rigcRanClause(v)}; the recorded input check binds the rigc that measured it, so its version is required` }]);
  return out;
}

/** The binding of this run's input: what the input's `check` would read now ({@link InputCheckBinding}). */
export function inputCheckBinding(rigAt: string, tree: FileTree, partsDir: string, requirements: string | undefined, pageEdges: PageEdges, packShape: PackShape, versions: { parts: string; rigc: string }): InputCheckBinding {
  const partsAt = resolve(partsDir);
  const partsTree: FileTree = new Map();
  const json = join(partsAt, 'parts.json');
  if (existsSync(json) && statSync(json).isFile()) partsTree.set('parts.json', new Uint8Array(readFileSync(json)));
  const pngs = join(partsAt, 'parts');
  if (existsSync(pngs) && statSync(pngs).isDirectory()) for (const [k, b] of readTree(pngs)) partsTree.set(`parts/${k}`, b);
  let req: { path: string; sha256: string } | null = null;
  if (requirements !== undefined) {
    readRequirements(requirements);
    const at = resolve(requirements);
    req = { path: at, sha256: sha256(new Uint8Array(readFileSync(at))) };
  }
  return {
    versions: { parts: versions.parts, rigc: versions.rigc },
    options: { page_edges: pageEdges, pack_shape: packShape, requirements: req },
    rig: { dir: resolve(rigAt), files: hashRows(tree) },
    parts: { dir: partsAt, files: hashRows(new Map([...partsTree].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))) },
  };
}

/** The number of SHA-256 rows a binding holds: every rig file, every parts file, and the requirements file when there is one. */
export function inputCheckHashes(b: InputCheckBinding): number {
  return b.rig.files.length + b.parts.files.length + (b.options.requirements === null ? 0 : 1);
}

/** {@link INPUT_CHECK_FILE}'s text: the binding and the side, in the spec's key order. */
export function inputCheckText(b: InputCheckBinding, side: CheckSide): string {
  const record: InputCheckRecord = { spec: INPUT_CHECK_SPEC, versions: b.versions, options: b.options, rig: b.rig, parts: b.parts, check: canonicalSide(side) };
  return rigJsonText(record);
}

/** A check side with its keys in the provenance's order, so a side read back writes the bytes a measured one does. */
function canonicalSide(s: CheckSide): CheckSide {
  return { pass: s.pass, measured: [...s.measured], not_met: [...s.not_met], skipped: s.skipped.map((x) => ({ bar: x.bar, reason: x.reason })), physics: s.physics, line: s.line, status: { ...s.status } };
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isRows = (v: unknown): v is HashRow[] => Array.isArray(v) && v.every((r) => isRecord(r) && typeof r.path === 'string' && typeof r.bytes === 'number' && typeof r.sha256 === 'string');

/**
 * Read {@link INPUT_CHECK_FILE} and hold it to its spec's shape; every field that is not of it is named in one
 * refusal under `op`'s file code. Nothing in it is trusted past its shape: its binding is {@link inputCheckBoundProblems}'s.
 */
export function readInputCheck(path: string, op: 'remesh' | 'retune'): InputCheckRecord {
  const code = REVISION_CODES[op].inputCheckFile;
  const fail = (object: string, detail: string): Problem => ({ code, object, detail });
  if (!existsSync(path) || !statSync(path).isFile()) throw new PartsError([fail(path, `no such file; --input-check takes the ${INPUT_CHECK_FILE} an earlier ${op} --record-input-check wrote over the same input`)]);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new PartsError([fail(path, `does not parse as JSON: ${(err as Error).message}`)]);
  }
  if (!isRecord(raw)) throw new PartsError([fail(path, `holds ${JSON.stringify(raw)?.slice(0, 40)}; one ${INPUT_CHECK_SPEC} object is required`)]);
  if (raw.spec !== INPUT_CHECK_SPEC) throw new PartsError([fail(`${path} field "spec"`, `is ${JSON.stringify(raw.spec) ?? 'absent'}; "${INPUT_CHECK_SPEC}" is required`)]);
  const out: Problem[] = [];
  const field = (name: string, ok: boolean, want: string): void => {
    if (!ok) out.push(fail(`${path} field "${name}"`, `is not ${want}`));
  };
  const v = raw.versions;
  field('versions', isRecord(v) && typeof v.parts === 'string' && typeof v.rigc === 'string', '{ parts, rigc } as strings');
  const o = raw.options;
  const req = isRecord(o) ? o.requirements : undefined;
  field('options', isRecord(o) && typeof o.page_edges === 'string' && typeof o.pack_shape === 'string' && (req === null || (isRecord(req) && typeof req.path === 'string' && typeof req.sha256 === 'string')), '{ page_edges, pack_shape, requirements: null or { path, sha256 } }');
  for (const k of ['rig', 'parts'] as const) {
    const t = raw[k];
    field(k, isRecord(t) && typeof t.dir === 'string' && isRows(t.files), '{ dir, files: [{ path, bytes, sha256 }] }');
  }
  const c = raw.check;
  const ok =
    isRecord(c) &&
    typeof c.pass === 'boolean' &&
    isStrings(c.measured) &&
    isStrings(c.not_met) &&
    Array.isArray(c.skipped) &&
    c.skipped.every((x) => isRecord(x) && typeof x.bar === 'string' && typeof x.reason === 'string') &&
    (c.physics === null || typeof c.physics === 'string') &&
    typeof c.line === 'string' &&
    isRecord(c.status) &&
    Object.values(c.status).every((x) => typeof x === 'string');
  field('check', ok, 'a check side { pass, measured, not_met, skipped, physics, line, status } as remesh.json carries one');
  refuseIfAny(out);
  return raw as unknown as InputCheckRecord;
}

/**
 * The binding (issue #617): every row of the record against this run's — each version, each option, each directory,
 * and each file by path, size and SHA-256, a row on one side only included. Each difference is one problem naming
 * the record's row, the value it holds and the value this run's input requires; none means the record's check was
 * measured on exactly what this run's check would read.
 */
export function inputCheckBoundProblems(recorded: InputCheckBinding, now: InputCheckBinding, path: string, op: 'remesh' | 'retune'): Problem[] {
  const code = REVISION_CODES[op].inputCheckBound;
  const out: Problem[] = [];
  const moved = (row: string, found: unknown, required: unknown, why: string): void => {
    out.push({ code, object: `${path} ${row}`, detail: `is ${JSON.stringify(found)}; this run's input requires ${JSON.stringify(required)} — ${why}, so the recorded check is not this input's and nothing was written` });
  };
  if (recorded.versions.parts !== now.versions.parts) moved('versions.parts', recorded.versions.parts, now.versions.parts, 'the check was measured by another version of this package');
  if (recorded.versions.rigc !== now.versions.rigc) moved('versions.rigc', recorded.versions.rigc, now.versions.rigc, 'the check was measured under another rigc');
  if (recorded.options.page_edges !== now.options.page_edges) moved('options.page_edges', recorded.options.page_edges, now.options.page_edges, 'the check packed its pages another way');
  if (recorded.options.pack_shape !== now.options.pack_shape) moved('options.pack_shape', recorded.options.pack_shape, now.options.pack_shape, 'the check packed its pages another way');
  const ra = recorded.options.requirements;
  const rb = now.options.requirements;
  if (ra === null || rb === null) {
    if (ra !== rb) moved('options.requirements', ra, rb, 'the check measured another set of declared requirements');
  } else {
    if (ra.path !== rb.path) moved('options.requirements.path', ra.path, rb.path, 'the check read its requirements from another file');
    if (ra.sha256 !== rb.sha256) moved('options.requirements.sha256', ra.sha256, rb.sha256, 'the check read other requirements bytes');
  }
  for (const k of ['rig', 'parts'] as const) {
    if (recorded[k].dir !== now[k].dir) moved(`${k}.dir`, recorded[k].dir, now[k].dir, `the check read another ${k} directory`);
    const a = new Map(recorded[k].files.map((r) => [r.path, r]));
    const b = new Map(now[k].files.map((r) => [r.path, r]));
    for (const p of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const x = a.get(p);
      const y = b.get(p);
      const row = `${k}.files "${p}"`;
      if (x === undefined) moved(row, 'absent', y?.sha256, `the input holds ${p} (${y?.bytes} bytes), which the check did not read`);
      else if (y === undefined) moved(row, x.sha256, 'absent', `the check read ${p}, which the input no longer holds`);
      else if (x.sha256 !== y.sha256 || x.bytes !== y.bytes) moved(row, `${x.bytes} bytes sha256 ${x.sha256}`, `${y.bytes} bytes sha256 ${y.sha256}`, `the input's ${p} is not the bytes the check read`);
    }
  }
  return out;
}

/** The line a reused input check prints in place of check-input's lines. */
export function inputCheckReusedLine(path: string, b: InputCheckBinding): string {
  const req = b.options.requirements === null ? 0 : 1;
  return `  check-input: not run — ${path} (${INPUT_CHECK_SPEC}) is bound to this input by ${inputCheckHashes(b)} sha256 row(s) (rig ${b.rig.files.length}, parts ${b.parts.files.length}, requirements ${req}), parts ${b.versions.parts}, rigc ${b.versions.rigc.split('\n')[0]}, page edges ${b.options.page_edges}, pack shape ${b.options.pack_shape}; the input's check side is the recorded one`;
}

/**
 * Steps 1's reading of `--input-check` and `--record-input-check` for both revising commands: the binding of this
 * run's input when either is asked for (one `rigc --version`), and the recorded side when the record is bound to it.
 * Neither asked for, nothing is read and null is returned for both.
 */
export function inputCheckOf(
  req: { inputCheck?: string; recordInputCheck?: boolean; requirements?: string; parts: string },
  rigAt: string,
  tree: FileTree,
  pageEdges: PageEdges,
  packShape: PackShape,
  partsVersion: string,
  rigc: RigcRunner,
  op: 'remesh' | 'retune',
): { binding: InputCheckBinding | null; reused: CheckSide | null } {
  if (req.inputCheck === undefined && req.recordInputCheck !== true) return { binding: null, reused: null };
  const recorded = req.inputCheck === undefined ? null : readInputCheck(req.inputCheck, op);
  const binding = inputCheckBinding(rigAt, tree, req.parts, req.requirements, pageEdges, packShape, { parts: partsVersion, rigc: rigcVersionText(rigc, op) });
  if (recorded === null) return { binding, reused: null };
  refuseIfAny(inputCheckBoundProblems(recorded, binding, req.inputCheck as string, op));
  return { binding, reused: canonicalSide(recorded.check) };
}

/**
 * The second snapshot (issue #617): the input as the record's first snapshot read it, hashed again by
 * {@link inputCheckBinding} right after check-input has read it. The two snapshots bracket the check, so a record is
 * written only when the bytes the check measured are the bytes its rows name; a file that moved in between is named
 * with both digests under `op`'s moved code.
 */
export function inputCheckMovedProblems(first: InputCheckBinding, req: { requirements?: string; parts: string }, rigAt: string, op: 'remesh' | 'retune'): Problem[] {
  const code = REVISION_CODES[op].inputCheckMoved;
  const second = inputCheckBinding(rigAt, readTree(rigAt), req.parts, req.requirements, first.options.page_edges, first.options.pack_shape, first.versions);
  const out: Problem[] = [];
  const row = (r: HashRow | undefined): string => (r === undefined ? 'absent' : `${r.bytes} bytes sha256 ${r.sha256}`);
  const moved = (object: string, before: string, after: string): void => {
    out.push({ code, object, detail: `was ${before} when the input was first hashed and is ${after} after check-input read it; the check may have measured bytes the record's rows do not name, so neither the record nor the revision is written` });
  };
  const ra = first.options.requirements;
  const rb = second.options.requirements;
  if (ra !== null && rb !== null && ra.sha256 !== rb.sha256) moved(ra.path, `sha256 ${ra.sha256}`, `sha256 ${rb.sha256}`);
  for (const k of ['rig', 'parts'] as const) {
    const a = new Map(first[k].files.map((r) => [r.path, r]));
    const b = new Map(second[k].files.map((r) => [r.path, r]));
    for (const p of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const x = a.get(p);
      const y = b.get(p);
      if (x === undefined || y === undefined || x.sha256 !== y.sha256 || x.bytes !== y.bytes) moved(join(first[k].dir, p), row(x), row(y));
    }
  }
  return out;
}

/** One side of the check block, read off a check report. */
export function checkSide(r: CheckReport): CheckSide {
  return {
    pass: r.figures.PASS === true,
    measured: [...r.bars.measured],
    not_met: barsNotMet(r.figures as unknown as Record<string, unknown>),
    skipped: r.bars.skipped.map((s) => ({ bar: s.bar, reason: s.reason })),
    physics: r.loopPhysics,
    line: checkSummaryLine(r),
    status: checkStatuses(r.figures),
  };
}

/**
 * Step 7: every bar the input measured is measured on the revision, and no bar the input met is failed by it. `op`
 * names the revising command (`retune` reuses this reading under its own code, `RETUNE_CHECK_HELD`).
 */
export function checkHeldProblems(input: CheckSide, revision: CheckSide, problems: readonly Problem[], op: 'remesh' | 'retune' = 'remesh'): Problem[] {
  const code = REVISION_CODES[op].checkHeld;
  const out: Problem[] = [];
  for (const bar of input.measured) {
    if (!revision.measured.includes(bar)) {
      const why = revision.skipped.find((s) => s.bar === bar)?.reason ?? 'not measured';
      out.push({ code, object: `check bar ${bar}`, detail: `measured on the input and not on the revision (${why}); the revision is held to every bar the input was` });
    }
  }
  for (const bar of revision.not_met) {
    if (input.not_met.includes(bar)) continue;
    const quoted = problems.filter((p) => p.code.includes(bar) || p.object.includes(bar)).map(problemLine);
    out.push({ code, object: `check bar ${bar}`, detail: `met on the input and not on the revision${quoted.length > 0 ? `: ${quoted.join(' | ')}` : ''}; a ${op} may not fail a bar its input meets` });
  }
  return out;
}

/** The request's mesh entry, read as JSON; its fields are the config loader's to judge. */
export function readMeshRequest(path: string): { entry: Json; bytes: Uint8Array } {
  if (!existsSync(path)) throw new PartsError([{ code: 'REMESH_MESH_JSON', object: path, detail: 'no such file; the request\'s mesh entry (what config.json would hold at meshes.<part>) is required' }]);
  const bytes = new Uint8Array(readFileSync(path));
  let entry: unknown;
  try {
    entry = JSON.parse(text(bytes));
  } catch (err) {
    throw new PartsError([{ code: 'REMESH_MESH_JSON', object: path, detail: `does not parse as JSON: ${(err as Error).message}` }]);
  }
  if (!isRecord(entry)) throw new PartsError([{ code: 'REMESH_MESH_JSON', object: path, detail: `is ${Array.isArray(entry) ? 'an array' : JSON.stringify(entry)}; an object — one meshes.<part> entry — is required` }]);
  return { entry, bytes };
}

/** The request as rig-c/review's mesh edit (issue #526), read and held to its shape (`src/remeshdelta.ts`). */
export function readDeltaRequest(path: string): { doc: MeshEditDocument; bytes: Uint8Array } {
  if (!existsSync(path)) throw new PartsError([{ code: 'REMESH_DELTA_JSON', object: path, detail: 'no such file; the request\'s mesh edit (rig-c/review\'s rig-review-mesh-edit/1 document) is required' }]);
  const bytes = new Uint8Array(readFileSync(path));
  const { doc, problems } = readMeshEdit(text(bytes), path);
  refuseIfAny(problems);
  return { doc: doc as MeshEditDocument, bytes };
}

/**
 * The hash rig-c/review binds a mesh edit to (`source.hash`): SHA-256 of `JSON.stringify` of the attachment's entry in
 * rigc's model document (`skins[name "default"].attachments.<part>.<part>`), or null when the document holds none.
 */
export function modelAttachmentHash(modelText: string, part: string): string | null {
  const model = JSON.parse(modelText) as { skins?: unknown };
  const skin = Array.isArray(model.skins) ? (model.skins as unknown[]).find((s) => isRecord(s) && s.name === 'default') : undefined;
  const atts = isRecord(skin) && isRecord(skin.attachments) ? skin.attachments : undefined;
  const slot = atts !== undefined && isRecord(atts[part]) ? (atts[part] as Json) : undefined;
  const entry = slot?.[part];
  return entry === undefined ? null : createHash('sha256').update(JSON.stringify(entry)).digest('hex');
}

/**
 * The setup frames a delta's crop px are read through (issue #613): the input's bones as rigc's rig reader reads them.
 * That reader expands `stops` before it resolves a single parent (rig-c's `expandStops`, `src/stop.ts`), and the
 * expansion generates a drawn link `<link>_d` per stopped link that `rig` hangs the next link, and every slot and
 * weight on the link, from — so a rig with stops names parents its own `bones` array does not declare, and evaluating
 * that array as written throws in rig-c's `evaluate`. Here the expansion is rig-c's own call, as `check` makes it for
 * the loop (`withoutPhysics`); a rig without `stops` is the array as written, the same object, so its frames and
 * every byte read through them are what they were. Nothing is reordered: rigc refuses a parent declared after its
 * child (`CE_RIG_BONE_PARENT_ORDER`), so a parent this walk finds after its child, or nowhere, is refused by name
 * (`REMESH_BONE_ORDER`) rather than sorted into an order rigc would not load; and any other throw from the
 * expansion or the evaluation is named with rig-c's own sentence (`REMESH_BONES_POSED`). On the delta path both sit
 * behind rigc's gate over the input, which refuses either first, so reaching one means rigc and its library read the
 * same bones apart. `unexpanded` is the mutant: the bones as written.
 */
export function deltaFrames(rig: Json, where: string, unexpanded = false): Map<string, BoneTransform> | Problem[] {
  let bones: RigSpec['bones'];
  try {
    bones = (unexpanded || !Array.isArray(rig.stops) ? (rig as unknown as RigSpec) : (expandStops(rig as unknown as RigcRigSpec, where) as unknown as RigSpec)).bones;
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    return [{ code: 'REMESH_BONES_POSED', object: `${where} stops`, detail: `rig-c's expansion refuses them: ${err.message}; the delta's crop px are read through the setup frames of the bones the expansion lays out, so nothing was written` }];
  }
  const at = new Map<string, number>();
  for (const [i, b] of bones.entries()) if (!at.has(b.name)) at.set(b.name, i);
  const out: Problem[] = [];
  const seen = new Set<string>();
  for (const [i, b] of bones.entries()) {
    const parent = b.parent;
    if (parent !== undefined && parent !== '' && !seen.has(parent)) {
      const later = at.get(parent);
      out.push({
        code: 'REMESH_BONE_ORDER',
        object: `${where} bones[${i}] "${b.name}"`,
        detail: `names parent "${parent}", which ${later === undefined ? `no bone declares${Array.isArray(rig.stops) && !unexpanded ? ' after rig-c expands the rig\'s stops' : ''}` : `is declared after it, at bones[${later}]`}; a parent declared before its child is required, as rigc's rig reader resolves it (CE_RIG_BONE_PARENT_ORDER), and nothing was written`,
      });
    }
    seen.add(b.name);
  }
  if (out.length > 0) return out;
  try {
    return computeExactFrameTransforms(bones);
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    return [{ code: 'REMESH_BONES_POSED', object: `${where} bones`, detail: `rig-c cannot pose them at the setup pose: ${err.message}; the delta's crop px are read through those frames, so nothing was written` }];
  }
}

/**
 * Step 1's tree rules: the files `rig` writes are present, and the ones the splice rewrites (`spliced`) are this
 * writer's bytes. `op` names the revising command, whose codes these are (`retune` splices `rig.json` and `motion.json`).
 */
export function inputTreeProblems(tree: FileTree, root: string, op: 'remesh' | 'retune' = 'remesh', spliced: readonly string[] = ['rig.json', 'mesh_report.json']): Problem[] {
  const present = REVISION_CODES[op].inputPresent;
  const writtenCode = REVISION_CODES[op].inputWritten;
  const out: Problem[] = [];
  for (const f of RIG_TREE_FILES) {
    if (!tree.has(f)) out.push({ code: present, object: `${root}/${f}`, detail: 'is absent; the input revision is the directory rig writes — rig.json, motion.json, mesh_report.json and images/' });
  }
  if (![...tree.keys()].some((k) => k.startsWith('images/'))) out.push({ code: present, object: `${root}/images/`, detail: 'holds no image; the input revision is the directory rig writes' });
  for (const f of spliced) {
    const b = tree.get(f);
    if (b === undefined) continue;
    let value: unknown;
    try {
      value = JSON.parse(text(b));
    } catch (err) {
      out.push({ code: writtenCode, object: `${root}/${f}`, detail: `does not parse as JSON: ${(err as Error).message}` });
      continue;
    }
    if (rigJsonText(value) !== text(b)) out.push({ code: writtenCode, object: `${root}/${f}`, detail: 'is not the text this package\'s writer prints for its value; the revision is spliced as text, so an input reformatted by hand cannot be carried over byte for byte' });
  }
  return out;
}

/** A tree's images as the gate takes them (name under `images/`, bytes). */
const pngsOf = (tree: FileTree): Array<readonly [string, Uint8Array]> => [...tree].filter(([k]) => k.startsWith('images/')).map(([k, b]) => [k.slice('images/'.length), b] as const);
/** A tree's other files as text. */
const textsOf = (tree: FileTree): Array<readonly [string, string]> => [...tree].filter(([k]) => !k.startsWith('images/')).map(([k, b]) => [k, text(b)] as const);

/**
 * The delta's `mesh_report.json` row (issue #526): the input's row, key for key, with `vertices`, `triangles`, `hull`,
 * `bones` (the sorted set the new weights name, `meshBoundBones` — the reading every rig row takes), `max_influences` and `mean_influences` recomputed from the new
 * attachment and `mode` "delta" (in place, or last when the row had none). Every other key is the input's and
 * describes the mesh the delta was drawn over.
 */
export function deltaRow(row: Json, att: MeshAttachment): Json {
  const n = att.uvs.length / 2;
  const entries = att.weights.reduce((s, w) => s + w.length, 0);
  const fresh: Json = {
    vertices: n,
    triangles: att.triangles.length / 3,
    hull: att.hull,
    bones: meshBoundBones(att),
    max_influences: Math.max(...att.weights.map((w) => w.length)),
    mean_influences: pyRound(entries / n, 2),
    mode: 'delta',
  };
  const out: Json = {};
  for (const [k, v] of Object.entries(row)) out[k] = k in fresh ? fresh[k] : v;
  if (!('mode' in out)) out.mode = 'delta';
  return out;
}

/**
 * The stage: steps 1–8 of the module header. Writes `input.out` only when every step is green; refuses with every
 * problem of the first step that found one.
 */
export function remeshStage(input: RemeshInput, rigc: RigcRunner, checkBin: string, versions: RemeshVersions, scratch: string, log: Log, plant: RemeshPlant = {}): RemeshResult {
  const part = input.part;
  const idleKeys = input.idleKeys ?? DEFAULT_IDLE_KEYS;
  const pageEdges = input.pageEdges ?? DEFAULT_PAGE_EDGES;
  const packShape = input.packShape ?? DEFAULT_PACK_SHAPE;
  // 1. The input, the out and the request.
  const outAt = resolve(input.out);
  const rigAt = resolve(input.rig);
  if (existsSync(outAt)) throw new PartsError([{ code: 'REMESH_OUT_FRESH', object: input.out, detail: 'exists; a revision is written into a new directory, never over the input or an earlier revision' }]);
  if (!existsSync(rigAt) || !statSync(rigAt).isDirectory()) throw new PartsError([{ code: 'REMESH_INPUT_PRESENT', object: input.rig, detail: 'is not a directory; the input revision is the directory rig writes' }]);
  if (outAt.startsWith(`${rigAt}${sep}`)) throw new PartsError([{ code: 'REMESH_OUT_FRESH', object: input.out, detail: `is inside the input ${input.rig}; a revision is written beside the input, never into it` }]);
  const tree = readTree(rigAt);
  refuseIfAny(inputTreeProblems(tree, input.rig));
  if ((input.mesh === undefined) === (input.delta === undefined)) throw new Error('remeshStage: exactly one of mesh, delta is required');
  const recorded = inputCheckOf(input, rigAt, tree, pageEdges, packShape, versions.parts, rigc, 'remesh');
  const meshReq = input.mesh === undefined ? null : readMeshRequest(input.mesh);
  const deltaReq = input.delta === undefined ? null : readDeltaRequest(input.delta);
  const configText = readFileSync(input.config, 'utf8');
  const { config: cfg } = loadConfigAndAnimations(input.config);
  const inRig = JSON.parse(text(tree.get('rig.json') as Uint8Array)) as Json;
  const inMotionText = text(tree.get('motion.json') as Uint8Array);
  const inReport = JSON.parse(text(tree.get('mesh_report.json') as Uint8Array)) as Json[];
  // 2. The target.
  refuseIfAny(targetProblems(inRig, JSON.parse(inMotionText) as Json, cfg.meshes, part));
  const before = meshCounts(targetAttachment(inRig, part));
  let candAtt: unknown;
  let candRow: Json;
  let reproduced: string[];
  let deltaRequest: RemeshProvenance['request'] | null = null;
  if (meshReq !== null) {
    const meshPath = input.mesh as string;
    // The request is the config's to judge: spliced in and loaded, before anything is built.
    const candConfig = scratchConfig(input.config, configText, join(scratch, 'candidate'), new Map([[part, meshReq.entry]]));
    loadConfigAndAnimations(candConfig);
    const auto = 'auto' in meshReq.entry;
    const build = (name: string, config: string): Built => {
      const out = join(scratch, name, 'rig');
      rigStage({ config, parts: input.parts, out, idleKeys, pageEdges, packShape }, rigc, join(scratch, name, 'gate'), (l) => log(`[${name}:rig] ${l}`));
      return readBuilt(out, part);
    };
    // 3. The baseline.
    log(`rig-parts remesh: ${part} of ${input.rig}, ${tree.size} file(s); the baseline is the config as written`);
    let base: Built;
    try {
      base = build('baseline', scratchConfig(input.config, configText, join(scratch, 'baseline'), new Map()));
    } catch (err) {
      if (!(err instanceof PartsError)) throw err;
      throw new PartsError(err.problems.map((p) => ({ code: 'REMESH_BASELINE_MISMATCH', object: `${input.config} as written`, detail: `does not build, so it cannot reproduce the input: ${problemLine(p)}` })));
    }
    refuseIfAny(baselineProblems({ rig: inRig, motionText: inMotionText, report: inReport, image: tree.get(`images/${part}.png`) }, base, part, auto));
    log(`  baseline: the config as written reproduces the input's ${part} (attachment, image, report row) and its bones${auto ? ' and motion' : ''}`);
    // 4. The candidate.
    let cand: Built;
    try {
      cand = build('candidate', candConfig);
    } catch (err) {
      if (!(err instanceof PartsError)) throw err;
      throw new PartsError(err.problems.map((p) => ({ code: 'REMESH_CANDIDATE_REFUSED', object: `the request's meshes.${part} (${meshPath})`, detail: `the producer refuses it, nothing is written: ${problemLine(p)}` })));
    }
    refuseIfAny(requestHeldProblems(base, cand, part));
    const row = rowOf(cand.report, part);
    if (row === undefined) throw new Error(`remesh: the candidate build wrote no mesh_report row for "${part}"`);
    candAtt = targetAttachment(cand.rig, part);
    candRow = row;
    reproduced = [`skins.default.${part}.${part}`, `images/${part}.png`, `mesh_report.json row "${part}"`, 'bones', ...(auto ? ['motion.json'] : [])];
  } else {
    // 3–4 on the delta path (issue #526): no config entry to build, so the baseline is the input itself, held to the
    // delta by its source counts and its source.hash, and the candidate is the delta replayed over the input's mesh.
    const deltaPath = input.delta as string;
    const { doc, bytes } = deltaReq as { doc: MeshEditDocument; bytes: Uint8Array };
    const inAtt = targetAttachment(inRig, part) as MeshAttachment;
    refuseIfAny(deltaSourceProblems(doc, part, inAtt, deltaPath));
    log(`rig-parts remesh: ${part} of ${input.rig}, ${tree.size} file(s); the request is a mesh edit of ${doc.ops.length} op(s), the baseline is the input itself`);
    let model = null as string | null;
    const inGate = gateThroughRigc(pngsOf(tree), textsOf(tree), rigc, join(scratch, 'gate-input'), { pageEdges, packShape }, (dir) => {
      const p = join(dir, RIGC_MODEL_DOCUMENT);
      model = existsSync(p) ? readFileSync(p, 'utf8') : null;
    });
    refuseIfAny(inGate.filter((g) => g.status !== 0).map((g) => ({ code: 'REMESH_RIGC_GREEN', object: `rigc ${g.label} over the input`, detail: `exited ${g.status}${g.lines.length > 0 ? `: ${g.lines.map((l) => l.trim()).join(' | ')}` : ''}${rigcRanClause(g)}; the delta's source.hash is read off the input's own build, and nothing was written` })));
    if (model === null) throw new PartsError([{ code: 'REMESH_DELTA_SOURCE', object: `rigc's build over the input`, detail: `wrote no ${RIGC_MODEL_DOCUMENT}, so the delta's source.hash cannot be verified; nothing was written` }]);
    const hash = modelAttachmentHash(model, part);
    if (hash !== doc.source.hash) {
      throw new PartsError([{ code: 'REMESH_DELTA_SOURCE', object: `${deltaPath} source.hash`, detail: `is ${doc.source.hash.slice(0, 16)}…; the input's ${part} in its ${RIGC_MODEL_DOCUMENT} hashes to ${hash === null ? 'nothing (no such entry)' : `${hash.slice(0, 16)}…`} — the delta was drawn over another mesh` }]);
    }
    log(`  source: ${part}'s entry in the input's ${RIGC_MODEL_DOCUMENT} hashes to ${hash.slice(0, 16)}…, the delta's source.hash; counts v=${before.vertices} t=${before.triangles} hull=${before.hull} as it states`);
    const partsFile = JSON.parse(readFileSync(join(input.parts, 'parts.json'), 'utf8')) as PartsFile;
    const rec = partsFile.parts.find((p) => p.name === part);
    if (rec === undefined) throw new PartsError([{ code: 'REMESH_DELTA_SOURCE', object: `${input.parts}/parts.json`, detail: `names no part "${part}"; its box is where rig placed the image, which the delta's crop px are read against` }]);
    const world = deltaFrames(inRig, `${input.rig}/rig.json`, plant.unexpandedStops === true);
    if (Array.isArray(world)) throw new PartsError(world);
    const r = applyMeshEdit({ part, attachment: inAtt, box: [rec.x, rec.y], rigSize: [partsFile.rig_size[0], partsFile.rig_size[1]], world }, doc, deltaPath, plant.delta);
    if (Array.isArray(r)) throw new PartsError(r);
    const row = rowOf(inReport, part);
    if (row === undefined) throw new PartsError([{ code: 'REMESH_DELTA_SOURCE', object: `${input.rig}/mesh_report.json`, detail: `holds no row "${part}"; the delta's row is the input's with its counts recomputed` }]);
    candAtt = r.attachment;
    candRow = deltaRow(row, r.attachment);
    const { ops, ...applied } = r.applied;
    log(`  delta: ${ops} op(s) — moved ${applied.moved}, added ${applied.added}, removed ${applied.removed}, constrained ${applied.constrained}; ${r.untouched.length} source vertex(es) untouched; interior edges not locally Delaunay ${r.delaunay.before} -> ${r.delaunay.after}`);
    reproduced = ['none built: the delta path builds no config entry, so the baseline is the input itself, held to the delta by source.vertexCount, source.triangleCount, source.hullLength and source.hash'];
    deltaRequest = { part, delta: doc, delta_sha256: sha256(bytes), ops, applied, idle_keys: idleKeys, page_edges: pageEdges, pack_shape: packShape };
  }
  const after = meshCounts(candAtt);
  // 5–6. The splice and the preserve assertion.
  let revision = splice(tree, part, candAtt, candRow);
  if (plant.perturb !== undefined) revision = perturbed(revision, plant.perturb);
  if (plant.skipPreserve !== true) refuseIfAny(preservedProblems(tree, revision, part));
  const spliced = ['rig.json', 'mesh_report.json'];
  const identical = [...tree.keys()].filter((k) => !spliced.includes(k));
  log(`  ${part}: v=${before.vertices} t=${before.triangles} hull=${before.hull} -> v=${after.vertices} t=${after.triangles} hull=${after.hull}`);
  log(`  preserved: ${identical.filter((p) => p !== PROVENANCE_FILE && !(input.recordInputCheck === true && p === INPUT_CHECK_FILE)).length} file(s) byte-identical to the input; rig.json identical outside skins.default.${part}.${part}; mesh_report.json identical but the "${part}" row`);
  // 7. The gate and check.
  const gate = gateThroughRigc(pngsOf(revision), textsOf(revision), rigc, join(scratch, 'gate'), { pageEdges, packShape });
  for (const g of gate) {
    log(`  rigc ${g.label}, the revision: exit ${g.status}`);
    for (const l of g.lines) log(`    ${l.trim()}`);
  }
  refuseIfAny(gate.filter((g) => g.status !== 0).map((g) => ({ code: 'REMESH_RIGC_GREEN', object: `rigc ${g.label} over the revision`, detail: `exited ${g.status}${g.lines.length > 0 ? `: ${g.lines.map((l) => l.trim()).join(' | ')}` : ''}${rigcRanClause(g)}; exit 0 is required before anything is written, and nothing was` })));
  const staged = join(scratch, 'revision');
  for (const [k, b] of revision) {
    mkdirSync(dirname(join(staged, k)), { recursive: true });
    writeFileSync(join(staged, k), b);
  }
  const checkOf = (rig: string, name: string): CheckReport =>
    checkStage({ rig, parts: input.parts, out: join(scratch, name), pageEdges, packShape, ...(input.requirements === undefined ? {} : { requirements: input.requirements }) }, rigc, checkBin, (l) => log(`[${name}] ${l}`));
  if (recorded.reused !== null) log(inputCheckReusedLine(input.inputCheck as string, recorded.binding as InputCheckBinding));
  let inSide: CheckSide;
  if (recorded.reused !== null) inSide = recorded.reused;
  else {
    plant.beforeInputCheck?.();
    inSide = checkSide(checkOf(rigAt, 'check-input'));
    if (recorded.binding !== null) refuseIfAny(inputCheckMovedProblems(recorded.binding, input, rigAt, 'remesh'));
  }
  const revCheck = checkOf(staged, 'check-revision');
  const sides = { input: inSide, revision: checkSide(revCheck) };
  refuseIfAny(checkHeldProblems(sides.input, sides.revision, revCheck.problems));
  const scope = checkScope(sides.revision.physics);
  log(`  check: input ${sides.input.pass ? 'PASS' : `FAIL (${sides.input.not_met.join(', ')})`}, revision ${sides.revision.pass ? 'PASS' : `FAIL (${sides.revision.not_met.join(', ')})`}, the same ${sides.revision.measured.length} bar(s) measured; ${scope}`);
  // 8. The write. Previous root records are metadata, preserved separately after the rig hold.
  const lineage = carryProvenance(tree, revision, PROVENANCE_FILE);
  revision = lineage.revision;
  if (input.recordInputCheck === true) revision.set(INPUT_CHECK_FILE, new TextEncoder().encode(inputCheckText(recorded.binding as InputCheckBinding, sides.input)));
  revision = new Map([...revision].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const provenance: RemeshProvenance = {
    spec: REMESH_SPEC,
    request: deltaRequest ?? { part, mesh: (meshReq as { entry: Json }).entry, mesh_sha256: sha256((meshReq as { bytes: Uint8Array }).bytes), idle_keys: idleKeys, page_edges: pageEdges, pack_shape: packShape },
    versions,
    input: { rig: hashRows(tree), config_sha256: sha256(bytesOf(configText)), parts_json_sha256: sha256(new Uint8Array(readFileSync(join(input.parts, 'parts.json')))), ...(lineage.parents.length === 0 ? {} : { provenance: lineage.parents }) },
    baseline: {
      reproduced,
      not_compared: 'every other attachment, image and report row: carried over from the input as bytes, whether or not the config reproduces it',
    },
    target: { before, after },
    preserved: { identical: identical.filter((p) => p !== PROVENANCE_FILE && !(input.recordInputCheck === true && p === INPUT_CHECK_FILE)), spliced },
    revision: hashRows(revision),
    check: { ...sides, scope },
  };
  const written: string[] = [];
  mkdirSync(outAt, { recursive: true });
  for (const [k, b] of revision) {
    mkdirSync(dirname(join(outAt, k)), { recursive: true });
    writeFileSync(join(outAt, k), b);
    written.push(k);
  }
  writeFileSync(join(outAt, PROVENANCE_FILE), rigJsonText(provenance));
  written.push(PROVENANCE_FILE);
  if (input.recordInputCheck === true) {
    log(`  recorded: the input's check in ${INPUT_CHECK_FILE}, bound by ${inputCheckHashes(recorded.binding as InputCheckBinding)} sha256 row(s); pass it as --input-check to a later remesh or retune of ${input.rig}`);
  }
  log('  file                                     sha256 (input)     sha256 (revision)');
  const inHash = new Map(hashRows(tree).map((r) => [r.path, r.sha256]));
  for (const r of provenance.revision) log(`  ${r.path.padEnd(40)} ${(inHash.get(r.path) ?? 'absent').slice(0, 16)}   ${r.sha256.slice(0, 16)}${inHash.get(r.path) === r.sha256 ? '' : '  (spliced)'}`);
  log(`rig-parts remesh: wrote ${written.length} file(s) under ${input.out}, the provenance in ${PROVENANCE_FILE}`);
  rmSync(staged, { recursive: true, force: true });
  return { provenance, written };
}
