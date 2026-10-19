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
import { checkStage, gateThroughRigc, type Log, rigStage } from './build.ts';
import { barsNotMet, type CheckReport, DEFAULT_PACK_SHAPE, DEFAULT_PAGE_EDGES, type PackShape, type PageEdges, rigcRanClause, type RigcRunner } from './check.ts';
import { loadConfigAndAnimations } from './config.ts';
import { PartsError, type Problem, problemLine, refuseIfAny } from './errors.ts';
import { jsonValueSpan, scratchConfig } from './meshdraft.ts';
import { DEFAULT_IDLE_KEYS, type IdleKeys, rigJsonText } from './rig.ts';

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
  /** The request's mesh entry: a JSON file holding what `config.json` would hold at `meshes.<part>`. */
  mesh: string;
  /** The new revision's directory; it must not exist. */
  out: string;
  idleKeys?: IdleKeys;
  pageEdges?: PageEdges;
  packShape?: PackShape;
  requirements?: string;
}

/**
 * Planted faults for the selftest (issue #495, bar 4) — never set by the CLI: `perturb` changes the first uv of the
 * named part's attachment in the revision after the splice, and `skipPreserve` takes the preserve assertion out, so
 * the selftest can show both that the assertion names the part and that its own independent reading does.
 */
export interface RemeshPlant {
  perturb?: string;
  skipPreserve?: boolean;
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

/** One side of the provenance's check block. */
export interface CheckSide {
  pass: boolean;
  measured: string[];
  not_met: string[];
  skipped: Array<{ bar: string; reason: string }>;
  physics: string | null;
}

/** `remesh.json` (spec {@link REMESH_SPEC}). */
export interface RemeshProvenance {
  spec: typeof REMESH_SPEC;
  request: { part: string; mesh: unknown; mesh_sha256: string; idle_keys: IdleKeys; page_edges: PageEdges; pack_shape: PackShape };
  versions: RemeshVersions;
  input: { rig: HashRow[]; config_sha256: string; parts_json_sha256: string };
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
    out.push({ code: 'REMESH_TARGET_MESH', object: `rig.json skins.default.${part}.${part}`, detail: `is ${att === undefined ? 'absent' : isRecord(att) ? `a ${String(att.type)} attachment` : 'not an attachment'}; a mesh attachment is required — only a mesh is remeshed` });
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

/** One side of the check block, read off a check report. */
export function checkSide(r: CheckReport): CheckSide {
  return {
    pass: r.figures.PASS === true,
    measured: [...r.bars.measured],
    not_met: barsNotMet(r.figures as unknown as Record<string, unknown>),
    skipped: r.bars.skipped.map((s) => ({ bar: s.bar, reason: s.reason })),
    physics: r.loopPhysics,
  };
}

/** Step 7: every bar the input measured is measured on the revision, and no bar the input met is failed by it. */
export function checkHeldProblems(input: CheckSide, revision: CheckSide, problems: readonly Problem[]): Problem[] {
  const out: Problem[] = [];
  for (const bar of input.measured) {
    if (!revision.measured.includes(bar)) {
      const why = revision.skipped.find((s) => s.bar === bar)?.reason ?? 'not measured';
      out.push({ code: 'REMESH_CHECK_HELD', object: `check bar ${bar}`, detail: `measured on the input and not on the revision (${why}); the revision is held to every bar the input was` });
    }
  }
  for (const bar of revision.not_met) {
    if (input.not_met.includes(bar)) continue;
    const quoted = problems.filter((p) => p.code.includes(bar) || p.object.includes(bar)).map(problemLine);
    out.push({ code: 'REMESH_CHECK_HELD', object: `check bar ${bar}`, detail: `met on the input and not on the revision${quoted.length > 0 ? `: ${quoted.join(' | ')}` : ''}; a remesh may not fail a bar its input meets` });
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

/** Step 1's tree rules: the files `rig` writes are present, and the two the splice rewrites are this writer's bytes. */
export function inputTreeProblems(tree: FileTree, root: string): Problem[] {
  const out: Problem[] = [];
  for (const f of RIG_TREE_FILES) {
    if (!tree.has(f)) out.push({ code: 'REMESH_INPUT_PRESENT', object: `${root}/${f}`, detail: 'is absent; the input revision is the directory rig writes — rig.json, motion.json, mesh_report.json and images/' });
  }
  if (![...tree.keys()].some((k) => k.startsWith('images/'))) out.push({ code: 'REMESH_INPUT_PRESENT', object: `${root}/images/`, detail: 'holds no image; the input revision is the directory rig writes' });
  for (const f of ['rig.json', 'mesh_report.json']) {
    const b = tree.get(f);
    if (b === undefined) continue;
    let value: unknown;
    try {
      value = JSON.parse(text(b));
    } catch (err) {
      out.push({ code: 'REMESH_INPUT_WRITTEN', object: `${root}/${f}`, detail: `does not parse as JSON: ${(err as Error).message}` });
      continue;
    }
    if (rigJsonText(value) !== text(b)) out.push({ code: 'REMESH_INPUT_WRITTEN', object: `${root}/${f}`, detail: 'is not the text this package\'s writer prints for its value; the revision is spliced as text, so an input reformatted by hand cannot be carried over byte for byte' });
  }
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
  const request = readMeshRequest(input.mesh);
  const configText = readFileSync(input.config, 'utf8');
  const { config: cfg } = loadConfigAndAnimations(input.config);
  const inRig = JSON.parse(text(tree.get('rig.json') as Uint8Array)) as Json;
  const inMotionText = text(tree.get('motion.json') as Uint8Array);
  const inReport = JSON.parse(text(tree.get('mesh_report.json') as Uint8Array)) as Json[];
  // 2. The target.
  refuseIfAny(targetProblems(inRig, JSON.parse(inMotionText) as Json, cfg.meshes, part));
  // The request is the config's to judge: spliced in and loaded, before anything is built.
  const candConfig = scratchConfig(input.config, configText, join(scratch, 'candidate'), new Map([[part, request.entry]]));
  loadConfigAndAnimations(candConfig);
  const auto = 'auto' in request.entry;
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
    throw new PartsError(err.problems.map((p) => ({ code: 'REMESH_CANDIDATE_REFUSED', object: `the request's meshes.${part} (${input.mesh})`, detail: `the producer refuses it, nothing is written: ${problemLine(p)}` })));
  }
  refuseIfAny(requestHeldProblems(base, cand, part));
  const candRow = rowOf(cand.report, part);
  if (candRow === undefined) throw new Error(`remesh: the candidate build wrote no mesh_report row for "${part}"`);
  const before = meshCounts(targetAttachment(inRig, part));
  const after = meshCounts(targetAttachment(cand.rig, part));
  // 5–6. The splice and the preserve assertion.
  let revision = splice(tree, part, targetAttachment(cand.rig, part), candRow);
  if (plant.perturb !== undefined) revision = perturbed(revision, plant.perturb);
  if (plant.skipPreserve !== true) refuseIfAny(preservedProblems(tree, revision, part));
  const spliced = ['rig.json', 'mesh_report.json'];
  const identical = [...tree.keys()].filter((k) => !spliced.includes(k));
  log(`  ${part}: v=${before.vertices} t=${before.triangles} hull=${before.hull} -> v=${after.vertices} t=${after.triangles} hull=${after.hull}`);
  log(`  preserved: ${identical.length} file(s) byte-identical to the input; rig.json identical outside skins.default.${part}.${part}; mesh_report.json identical but the "${part}" row`);
  // 7. The gate and check.
  const pngs = [...revision].filter(([k]) => k.startsWith('images/')).map(([k, b]) => [k.slice('images/'.length), b] as const);
  const texts = [...revision].filter(([k]) => !k.startsWith('images/')).map(([k, b]) => [k, text(b)] as const);
  const gate = gateThroughRigc(pngs, texts, rigc, join(scratch, 'gate'), { pageEdges, packShape });
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
  const inCheck = checkOf(rigAt, 'check-input');
  const revCheck = checkOf(staged, 'check-revision');
  const sides = { input: checkSide(inCheck), revision: checkSide(revCheck) };
  refuseIfAny(checkHeldProblems(sides.input, sides.revision, revCheck.problems));
  const scope = checkScope(sides.revision.physics);
  log(`  check: input ${sides.input.pass ? 'PASS' : `FAIL (${sides.input.not_met.join(', ')})`}, revision ${sides.revision.pass ? 'PASS' : `FAIL (${sides.revision.not_met.join(', ')})`}, the same ${sides.revision.measured.length} bar(s) measured; ${scope}`);
  // 8. The write.
  const provenance: RemeshProvenance = {
    spec: REMESH_SPEC,
    request: { part, mesh: request.entry, mesh_sha256: sha256(request.bytes), idle_keys: idleKeys, page_edges: pageEdges, pack_shape: packShape },
    versions,
    input: { rig: hashRows(tree), config_sha256: sha256(bytesOf(configText)), parts_json_sha256: sha256(new Uint8Array(readFileSync(join(input.parts, 'parts.json')))) },
    baseline: {
      reproduced: [`skins.default.${part}.${part}`, `images/${part}.png`, `mesh_report.json row "${part}"`, 'bones', ...(auto ? ['motion.json'] : [])],
      not_compared: 'every other attachment, image and report row: carried over from the input as bytes, whether or not the config reproduces it',
    },
    target: { before, after },
    preserved: { identical, spliced },
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
  log('  file                                     sha256 (input)     sha256 (revision)');
  const inHash = new Map(hashRows(tree).map((r) => [r.path, r.sha256]));
  for (const r of provenance.revision) log(`  ${r.path.padEnd(40)} ${(inHash.get(r.path) ?? 'absent').slice(0, 16)}   ${r.sha256.slice(0, 16)}${inHash.get(r.path) === r.sha256 ? '' : '  (spliced)'}`);
  log(`rig-parts remesh: wrote ${written.length} file(s) under ${input.out}, the provenance in ${PROVENANCE_FILE}`);
  rmSync(staged, { recursive: true, force: true });
  return { provenance, written };
}
