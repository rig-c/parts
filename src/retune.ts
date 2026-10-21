/**
 * `rig-parts retune` (issue #527): splice the constraints and the idle a config states onto an existing, gated rig,
 * and write a new package revision beside the input — every other byte of the input carried over, the input never
 * written. The remesh (`src/remesh.ts`) of physics and motion: a reviewer's damping, wind, strength or
 * idle-track change reaches the rig without a whole rebuild, which would drop every repair the config does not
 * reproduce.
 *
 * ## The steps, each one a refusal by name
 *
 * 1. **The input** ({@link readTree}): `--rig` holds `rig.json`, `motion.json`, `mesh_report.json` and `images/`, as
 *    `rig` writes them; `rig.json` and `motion.json` must be the bytes this package's writer prints for what they
 *    parse to (`RETUNE_INPUT_WRITTEN`), since the revision is spliced as text. `--out` must not exist
 *    (`RETUNE_OUT_FRESH`).
 * 2. **The rebuild**: the config as written is built through the rig stage — one build, every check it owns — and a
 *    refusal there is quoted (`RETUNE_CONFIG_REFUSED`).
 * 3. **The hold** ({@link holdProblems}): the rebuild must state the input's `stops`, `bones` (names, parents,
 *    transforms, `inherit`), `slots`, `skeleton` and `images`, every image file, every `invariants` entry but
 *    `detached`, and every byte of `motion.json` but `animations.idle` (`RETUNE_REQUEST_HELD`, naming the first
 *    difference). A `stops` change rewires bones, slots and weights onto drawn links, so it is no retune. No
 *    attachment is compared: the input's meshes may be repairs the config does not reproduce, and they are carried
 *    over as bytes — so a `meshes` change in the config is never read into the revision (`remesh` is its producer).
 * 4. **The splice** ({@link spliceRevision}): the input's `rig.json` with `constraints` and `invariants.detached`
 *    (derived from the constraints, rig.ts's `detachedRules`) the rebuild's, and its `motion.json` with
 *    `animations.idle` the rebuild's; every other file is the input's bytes.
 * 5. **The preserve assertion** ({@link preservedProblems}): every file but those two byte-identical to the input's;
 *    `rig.json` identical outside `constraints` and `invariants.detached`, `motion.json` outside `animations.idle`
 *    (`RETUNE_PRESERVED`, naming the first path that moved).
 * 6. **The gate and check**: the revision goes through rigc's build gate (`RETUNE_RIGC_GREEN`) and through `check`
 *    beside the input; every bar the input measured is measured, none the input met is failed (`RETUNE_CHECK_HELD`).
 *    Under `--input-check` (issue #617) the input's check is the recorded one when the record is bound to this input
 *    (`src/remesh.ts` {@link inputCheckOf}), refused by name otherwise (`RETUNE_INPUT_CHECK_FILE`,
 *    `RETUNE_INPUT_CHECK_BOUND`) before the rebuild.
 * 7. **The write**: `--out` receives the revision's files and {@link RETUNE_FILE} — spec {@link RETUNE_SPEC} — with
 *    no path and no clock in it, so a second identical request writes the same bytes.
 *
 * Pure in the sense `src/` is held to: rigc runs as a process, but the process is injected, as `src/build.ts` takes it.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { checkStage, gateThroughRigc, type Log, rigStage } from './build.ts';
import { type CheckReport, DEFAULT_PACK_SHAPE, DEFAULT_PAGE_EDGES, type PackShape, type PageEdges, rigcRanClause, type RigcRunner } from './check.ts';
import { PartsError, type Problem, problemLine, refuseIfAny } from './errors.ts';
import { type CheckSide, checkHeldProblems, checkSide, checkScope, type FileTree, firstDifference, type HashRow, hashRows, INPUT_CHECK_FILE, type InputCheckBinding, inputCheckHashes, inputCheckOf, inputCheckReusedLine, inputCheckText, inputTreeProblems, perturbed, readTree, sha256 } from './remesh.ts';
import { DEFAULT_IDLE_KEYS, type IdleKeys, rigJsonText } from './rig.ts';

/** The provenance file's spec. */
export const RETUNE_SPEC = 'rig-parts-retune/1';

/** The provenance file, at the revision's root beside `rig.json`. */
export const RETUNE_FILE = 'retune.json';

/** The two files the splice rewrites; every other file of the input is carried over as bytes. */
export const RETUNE_SPLICED = ['rig.json', 'motion.json'] as const;

/** What the hold compares between the input and the rebuild (step 3), as the provenance lists it. */
export const RETUNE_HELD = ['rig.json stops', 'rig.json bones', 'rig.json slots', 'rig.json skeleton', 'rig.json images', 'rig.json invariants but detached', 'images/', 'motion.json but animations.idle'] as const;

/** The provenance's sentence for what the hold does not compare. */
export const RETUNE_NOT_COMPARED =
  'every attachment and every mesh_report.json row: carried over from the input as bytes, whether or not the config reproduces it; a meshes change in the config is never read into the revision (remesh is the producer of a mesh)';

export interface RetuneInput {
  /** The input revision: the directory `rig` wrote (`rig.json`, `motion.json`, `mesh_report.json`, `images/`). */
  rig: string;
  /** The config whose constraints and idle the revision takes; every other field must reproduce the input. */
  config: string;
  /** The directory holding `parts.json` and `parts/` the input was built from. */
  parts: string;
  /** The new revision's directory; it must not exist. */
  out: string;
  idleKeys?: IdleKeys;
  pageEdges?: PageEdges;
  packShape?: PackShape;
  requirements?: string;
  /** Issue #617: a recorded input check (`input-check.json`, as `remesh` writes it) reused when it is bound to this run's input. */
  inputCheck?: string;
  /** Issue #617: write `input-check.json` into `out` beside the provenance. Without it, and without `inputCheck`, nothing written moves. */
  recordInputCheck?: boolean;
}

/**
 * Planted faults for the selftest (issue #527) — never set by the CLI: `perturb` changes the first uv of the named
 * part's attachment in the revision after the splice, `skipPreserve` takes the preserve assertion out and `skipHold`
 * the hold, so the selftest can show what each one stops and what stops the revision without it.
 */
export interface RetunePlant {
  perturb?: string;
  skipPreserve?: boolean;
  skipHold?: boolean;
}

/** One constraint the request changed: its name and type, and each field whose value moved, in the rebuild's order. */
export interface ConstraintChange {
  name: string;
  type: string;
  fields: string[];
}

/** `retune.json` (spec {@link RETUNE_SPEC}). */
export interface RetuneProvenance {
  spec: typeof RETUNE_SPEC;
  request: { idle_keys: IdleKeys; page_edges: PageEdges; pack_shape: PackShape };
  versions: { parts: string; rigc: string };
  input: { rig: HashRow[]; config_sha256: string; parts_json_sha256: string };
  held: { compared: string[]; not_compared: string };
  changed: { constraints: ConstraintChange[]; added: string[]; removed: string[]; idle: { tracks_changed: number; duration: [number, number] } };
  preserved: { identical: string[]; spliced: string[] };
  revision: HashRow[];
  check: { input: CheckSide; revision: CheckSide; scope: string };
}

export interface RetuneResult {
  provenance: RetuneProvenance;
  written: string[];
}

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);
const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s);
const bytesEqual = (a: Uint8Array | undefined, b: Uint8Array | undefined): boolean => a !== undefined && b !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);

/** A rig's files as the hold and the splice read them: `rig.json` and `motion.json` parsed, `images/` by file. */
export interface RigFiles {
  rig: Json;
  motion: Json;
  images: Map<string, Uint8Array>;
}

/** {@link RigFiles} off a tree read by {@link readTree}. */
export function rigFiles(tree: FileTree): RigFiles {
  const images = new Map<string, Uint8Array>();
  for (const [k, b] of tree) if (k.startsWith('images/')) images.set(k, b);
  return { rig: JSON.parse(text(tree.get('rig.json') as Uint8Array)) as Json, motion: JSON.parse(text(tree.get('motion.json') as Uint8Array)) as Json, images };
}

/** `invariants` without `detached`, or undefined when nothing else is in it. */
function invariantsBut(inv: unknown): Json | undefined {
  if (!isRecord(inv)) return undefined;
  const rest: Json = {};
  for (const [k, v] of Object.entries(inv)) if (k !== 'detached') rest[k] = v;
  return Object.keys(rest).length === 0 ? undefined : rest;
}

/** `rig.json` without `constraints` and `invariants.detached` — what the preserve assertion holds byte for byte. */
export function rigOutsideRetune(rig: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(rig)) {
    if (k === 'constraints') continue;
    if (k === 'invariants') {
      const rest = invariantsBut(v);
      if (rest !== undefined) out[k] = rest;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** `motion.json` without `animations.idle` — what the hold and the preserve assertion hold byte for byte. */
export function motionOutsideIdle(motion: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(motion)) {
    if (k !== 'animations' || !isRecord(v)) {
      out[k] = v;
      continue;
    }
    out[k] = Object.fromEntries(Object.entries(v).filter(([name]) => name !== 'idle'));
  }
  return out;
}

/**
 * Step 3: what the rebuild must state as the input does. `stops` first, so a stops change is named as one rather than
 * as the bones it rewires. Each difference names its first leaf; every one is collected.
 */
export function holdProblems(input: RigFiles, rebuilt: RigFiles): Problem[] {
  const out: Problem[] = [];
  const held = (object: string, what: string, why: string): void => {
    out.push({ code: 'RETUNE_REQUEST_HELD', object, detail: `the config changes it (${what}); ${why}, so nothing is written — make it a rebuild with rig --config` });
  };
  const top = 'a retune replaces constraints and the idle and holds every other byte of the input';
  const stops = firstDifference(input.rig.stops, rebuilt.rig.stops, 'stops');
  if (stops !== null) held('rig.json stops', `input vs rebuilt: ${stops}`, 'a stops change rewires bones, slots and weights onto drawn links (<link>_d), which a retune holds');
  for (const key of ['bones', 'slots', 'skeleton', 'images']) {
    const d = firstDifference(input.rig[key], rebuilt.rig[key], key);
    if (d !== null) held(`rig.json ${key}`, `input vs rebuilt: ${d}`, key === 'bones' ? `${top}; a moved, renamed, added or re-inherited bone (a <bone>_ctl among them) moves every weight bound to it` : top);
  }
  const inv = firstDifference(invariantsBut(input.rig.invariants), invariantsBut(rebuilt.rig.invariants), 'invariants');
  if (inv !== null) held('rig.json invariants', `input vs rebuilt: ${inv}`, `${top}; only invariants.detached derives from the constraints`);
  for (const path of [...new Set([...input.images.keys(), ...rebuilt.images.keys()])].sort()) {
    const a = input.images.get(path);
    const b = rebuilt.images.get(path);
    if (bytesEqual(a, b)) continue;
    held(path, a === undefined ? 'the rebuild writes it and the input has none' : b === undefined ? 'the input has it and the rebuild writes none' : `input ${a.length} bytes ${sha256(a).slice(0, 12)}… vs rebuilt ${b.length} bytes ${sha256(b).slice(0, 12)}…`, top);
  }
  const mi = motionOutsideIdle(input.motion);
  const mr = motionOutsideIdle(rebuilt.motion);
  if (rigJsonText(mi) !== rigJsonText(mr)) {
    held('motion.json', `input vs rebuilt outside animations.idle: ${firstDifference(mi, mr) ?? 'the same value, different bytes'}`, `${top}; spec, archetype, cut, easings, groups and every animation but idle (animations_from, the face deform) are held`);
  }
  return out;
}

/**
 * Step 4: the revision — the input tree with `rig.json`'s `constraints` and `invariants.detached` and `motion.json`'s
 * `animations.idle` the rebuild's, each key in the place the rig stage writes it. Every other entry is the input's
 * own bytes, by reference.
 */
export function spliceRevision(input: FileTree, rebuilt: RigFiles): FileTree {
  const inRig = JSON.parse(text(input.get('rig.json') as Uint8Array)) as Json;
  const inMotion = JSON.parse(text(input.get('motion.json') as Uint8Array)) as Json;
  const detached = isRecord(rebuilt.rig.invariants) ? rebuilt.rig.invariants.detached : undefined;
  const invariantsOf = (inv: unknown): Json | undefined => {
    // The rig stage writes `detached` after `idleDrivesMeshes` and before `deformMayFold` and `axes` (src/rig.ts).
    const rest = invariantsBut(inv) ?? {};
    const out: Json = {};
    if ('idleDrivesMeshes' in rest) out.idleDrivesMeshes = rest.idleDrivesMeshes;
    if (detached !== undefined) out.detached = detached;
    for (const [k, v] of Object.entries(rest)) if (k !== 'idleDrivesMeshes') out[k] = v;
    return Object.keys(out).length === 0 ? undefined : out;
  };
  const rig: Json = {};
  const put = (k: string, v: unknown): void => {
    if (v !== undefined) rig[k] = v;
  };
  for (const [k, v] of Object.entries(inRig)) {
    if (k === 'constraints') put(k, rebuilt.rig.constraints);
    else if (k === 'invariants') put(k, invariantsOf(v));
    else rig[k] = v;
    if (k === 'skins' && !('constraints' in inRig)) put('constraints', rebuilt.rig.constraints);
  }
  if (!('invariants' in inRig)) put('invariants', invariantsOf(undefined));
  const animations = inMotion.animations as Json;
  const motion: Json = { ...inMotion, animations: Object.fromEntries(Object.entries(animations).map(([k, v]) => [k, k === 'idle' ? (rebuilt.motion.animations as Json).idle : v])) };
  const out: FileTree = new Map(input);
  out.set('rig.json', bytesOf(rigJsonText(rig)));
  out.set('motion.json', bytesOf(rigJsonText(motion)));
  return out;
}

/** Where two values differ by top-level key, or by attachment under `skins`, so a moved part is named as the part it is. */
function movedPaths(a: Json, b: Json): Array<{ where: string; diff: string }> {
  const out: Array<{ where: string; diff: string }> = [];
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
    if (k !== 'skins' || !isRecord(a.skins) || !isRecord(b.skins)) {
      const d = firstDifference(a[k], b[k], k);
      if (d !== null) out.push({ where: k, diff: d });
      continue;
    }
    const sa = a.skins;
    const sb = b.skins;
    for (const skin of [...new Set([...Object.keys(sa), ...Object.keys(sb)])]) {
      const pa = isRecord(sa[skin]) ? (sa[skin] as Json) : {};
      const pb = isRecord(sb[skin]) ? (sb[skin] as Json) : {};
      for (const slot of [...new Set([...Object.keys(pa), ...Object.keys(pb)])]) {
        const xa = isRecord(pa[slot]) ? (pa[slot] as Json) : {};
        const xb = isRecord(pb[slot]) ? (pb[slot] as Json) : {};
        for (const name of [...new Set([...Object.keys(xa), ...Object.keys(xb)])]) {
          const where = `skins.${skin}.${slot}.${name}`;
          const d = firstDifference(xa[name], xb[name], where);
          if (d !== null) out.push({ where, diff: d });
        }
      }
    }
  }
  return out;
}

/**
 * Step 5, the preserve assertion: every file but `rig.json` and `motion.json` byte-identical in the revision and none
 * added or dropped; `rig.json` identical outside `constraints` and `invariants.detached`, `motion.json` outside
 * `animations.idle`, each moved path named.
 */
export function preservedProblems(input: FileTree, revision: FileTree): Problem[] {
  const out: Problem[] = [];
  const moved = (object: string, detail: string): void => {
    out.push({ code: 'RETUNE_PRESERVED', object, detail: `${detail}; a retune carries every byte but the constraints and the idle over from the input, so nothing is written` });
  };
  const outside: Record<string, { strip: (v: Json) => Json; what: string }> = {
    'rig.json': { strip: rigOutsideRetune, what: 'constraints and invariants.detached' },
    'motion.json': { strip: motionOutsideIdle, what: 'animations.idle' },
  };
  for (const path of [...new Set([...input.keys(), ...revision.keys()])].sort()) {
    const a = input.get(path);
    const b = revision.get(path);
    if (a === undefined || b === undefined) {
      moved(path, a === undefined ? 'is in the revision and not in the input' : 'is in the input and not in the revision');
      continue;
    }
    const o = outside[path];
    if (o === undefined) {
      if (!bytesEqual(a, b)) moved(path, `is not the input's bytes (input ${a.length} bytes ${sha256(a).slice(0, 12)}…, revision ${b.length} bytes ${sha256(b).slice(0, 12)}…)`);
      continue;
    }
    const x = o.strip(JSON.parse(text(a)) as Json);
    const y = o.strip(JSON.parse(text(b)) as Json);
    if (rigJsonText(x) === rigJsonText(y)) continue;
    const where = movedPaths(x, y);
    if (where.length === 0) moved(path, `differs from the input outside ${o.what} in its bytes, though not in its value`);
    for (const w of where) moved(`${path} ${w.where}`, `differs from the input outside ${o.what} — input vs revision at ${w.diff}`);
  }
  return out;
}

/** What the request changed, for the provenance: constraints by name and field, and the idle's tracks and duration. */
export function changedOf(input: RigFiles, rebuilt: RigFiles): RetuneProvenance['changed'] {
  const list = (r: Json): Json[] => (Array.isArray(r.constraints) ? (r.constraints as unknown[]).filter(isRecord) : []);
  const before = new Map(list(input.rig).map((c) => [String(c.name), c]));
  const after = list(rebuilt.rig);
  const afterNames = new Set(after.map((c) => String(c.name)));
  const constraints: ConstraintChange[] = [];
  for (const c of after) {
    const was = before.get(String(c.name));
    if (was === undefined) continue;
    const keys = [...new Set([...Object.keys(c), ...Object.keys(was)])];
    const fields = keys.filter((k) => JSON.stringify(c[k]) !== JSON.stringify(was[k]));
    if (fields.length > 0) constraints.push({ name: String(c.name), type: String(c.type), fields });
  }
  const idleOf = (m: Json): { duration: number; tracks: unknown[] } => (m.animations as Json).idle as { duration: number; tracks: unknown[] };
  const ia = idleOf(input.motion);
  const ib = idleOf(rebuilt.motion);
  let tracks = 0;
  for (let i = 0; i < Math.max(ia.tracks.length, ib.tracks.length); i++) if (JSON.stringify(ia.tracks[i]) !== JSON.stringify(ib.tracks[i])) tracks++;
  return {
    constraints,
    added: after.map((c) => String(c.name)).filter((n) => !before.has(n)),
    removed: [...before.keys()].filter((n) => !afterNames.has(n)),
    idle: { tracks_changed: tracks, duration: [ia.duration, ib.duration] },
  };
}

/**
 * The stage: steps 1–7 of the module header. Writes `input.out` only when every step is green; refuses with every
 * problem of the first step that found one.
 */
export function retuneStage(input: RetuneInput, rigc: RigcRunner, checkBin: string, versions: { parts: string; rigc: string }, scratch: string, log: Log, plant: RetunePlant = {}): RetuneResult {
  const idleKeys = input.idleKeys ?? DEFAULT_IDLE_KEYS;
  const pageEdges = input.pageEdges ?? DEFAULT_PAGE_EDGES;
  const packShape = input.packShape ?? DEFAULT_PACK_SHAPE;
  // 1. The input and the out.
  const outAt = resolve(input.out);
  const rigAt = resolve(input.rig);
  if (existsSync(outAt)) throw new PartsError([{ code: 'RETUNE_OUT_FRESH', object: input.out, detail: 'exists; a revision is written into a new directory, never over the input or an earlier revision' }]);
  if (!existsSync(rigAt) || !statSync(rigAt).isDirectory()) throw new PartsError([{ code: 'RETUNE_INPUT_PRESENT', object: input.rig, detail: 'is not a directory; the input revision is the directory rig writes' }]);
  if (outAt.startsWith(`${rigAt}${sep}`)) throw new PartsError([{ code: 'RETUNE_OUT_FRESH', object: input.out, detail: `is inside the input ${input.rig}; a revision is written beside the input, never into it` }]);
  const tree = readTree(rigAt);
  refuseIfAny(inputTreeProblems(tree, input.rig, 'retune', RETUNE_SPLICED));
  const recorded = inputCheckOf(input, rigAt, tree, pageEdges, packShape, versions.parts, rigc, 'retune');
  const inFiles = rigFiles(tree);
  // 2. The rebuild.
  log(`rig-parts retune: ${input.rig}, ${tree.size} file(s); the rebuild is the config as written`);
  const rebuiltAt = join(scratch, 'rebuild', 'rig');
  try {
    rigStage({ config: input.config, parts: input.parts, out: rebuiltAt, idleKeys, pageEdges, packShape }, rigc, join(scratch, 'rebuild', 'gate'), (l) => log(`[rebuild:rig] ${l}`));
  } catch (err) {
    if (!(err instanceof PartsError)) throw err;
    throw new PartsError(err.problems.map((p) => ({ code: 'RETUNE_CONFIG_REFUSED', object: `${input.config} as written`, detail: `the rig stage refuses it, nothing is written: ${problemLine(p)}` })));
  }
  const rebuilt = rigFiles(readTree(rebuiltAt));
  // 3. The hold.
  if (plant.skipHold !== true) refuseIfAny(holdProblems(inFiles, rebuilt));
  log(`  held: ${RETUNE_HELD.join(', ')} — the rebuild states each as the input does; no attachment is compared`);
  const changed = changedOf(inFiles, rebuilt);
  // 4–5. The splice and the preserve assertion.
  let revision = spliceRevision(tree, rebuilt);
  if (plant.perturb !== undefined) revision = perturbed(revision, plant.perturb);
  if (plant.skipPreserve !== true) refuseIfAny(preservedProblems(tree, revision));
  const spliced: string[] = [...RETUNE_SPLICED];
  const identical = [...tree.keys()].filter((k) => !spliced.includes(k));
  for (const c of changed.constraints) log(`  constraint ${c.name} (${c.type}): ${c.fields.join(', ')} changed`);
  if (changed.added.length > 0) log(`  constraints added: ${changed.added.join(', ')}`);
  if (changed.removed.length > 0) log(`  constraints removed: ${changed.removed.join(', ')}`);
  log(`  idle: ${changed.idle.tracks_changed} track(s) changed, duration ${changed.idle.duration[0]} -> ${changed.idle.duration[1]}`);
  log(`  preserved: ${identical.length} file(s) byte-identical to the input; rig.json identical outside constraints and invariants.detached; motion.json identical outside animations.idle`);
  // 6. The gate and check.
  const pngs = [...revision].filter(([k]) => k.startsWith('images/')).map(([k, b]) => [k.slice('images/'.length), b] as const);
  const texts = [...revision].filter(([k]) => !k.startsWith('images/')).map(([k, b]) => [k, text(b)] as const);
  const gate = gateThroughRigc(pngs, texts, rigc, join(scratch, 'gate'), { pageEdges, packShape });
  for (const g of gate) {
    log(`  rigc ${g.label}, the revision: exit ${g.status}`);
    for (const l of g.lines) log(`    ${l.trim()}`);
  }
  refuseIfAny(gate.filter((g) => g.status !== 0).map((g) => ({ code: 'RETUNE_RIGC_GREEN', object: `rigc ${g.label} over the revision`, detail: `exited ${g.status}${g.lines.length > 0 ? `: ${g.lines.map((l) => l.trim()).join(' | ')}` : ''}${rigcRanClause(g)}; exit 0 is required before anything is written, and nothing was` })));
  const staged = join(scratch, 'revision');
  for (const [k, b] of revision) {
    mkdirSync(dirname(join(staged, k)), { recursive: true });
    writeFileSync(join(staged, k), b);
  }
  const checkOf = (rig: string, name: string): CheckReport =>
    checkStage({ rig, parts: input.parts, out: join(scratch, name), pageEdges, packShape, ...(input.requirements === undefined ? {} : { requirements: input.requirements }) }, rigc, checkBin, (l) => log(`[${name}] ${l}`));
  if (recorded.reused !== null) log(inputCheckReusedLine(input.inputCheck as string, recorded.binding as InputCheckBinding));
  const inSide: CheckSide = recorded.reused ?? checkSide(checkOf(rigAt, 'check-input'));
  const revCheck = checkOf(staged, 'check-revision');
  const sides = { input: inSide, revision: checkSide(revCheck) };
  refuseIfAny(checkHeldProblems(sides.input, sides.revision, revCheck.problems, 'retune'));
  const scope = checkScope(sides.revision.physics);
  log(`  check: input ${sides.input.pass ? 'PASS' : `FAIL (${sides.input.not_met.join(', ')})`}, revision ${sides.revision.pass ? 'PASS' : `FAIL (${sides.revision.not_met.join(', ')})`}, the same ${sides.revision.measured.length} bar(s) measured; ${scope}`);
  // 7. The write.
  const provenance: RetuneProvenance = {
    spec: RETUNE_SPEC,
    request: { idle_keys: idleKeys, page_edges: pageEdges, pack_shape: packShape },
    versions,
    input: { rig: hashRows(tree), config_sha256: sha256(new Uint8Array(readFileSync(input.config))), parts_json_sha256: sha256(new Uint8Array(readFileSync(join(input.parts, 'parts.json')))) },
    held: { compared: [...RETUNE_HELD], not_compared: RETUNE_NOT_COMPARED },
    changed,
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
  writeFileSync(join(outAt, RETUNE_FILE), rigJsonText(provenance));
  written.push(RETUNE_FILE);
  if (input.recordInputCheck === true) {
    writeFileSync(join(outAt, INPUT_CHECK_FILE), inputCheckText(recorded.binding as InputCheckBinding, sides.input));
    written.push(INPUT_CHECK_FILE);
    log(`  recorded: the input's check in ${INPUT_CHECK_FILE}, bound by ${inputCheckHashes(recorded.binding as InputCheckBinding)} sha256 row(s); pass it as --input-check to a later remesh or retune of ${input.rig}`);
  }
  log('  file                                     sha256 (input)     sha256 (revision)');
  const inHash = new Map(hashRows(tree).map((r) => [r.path, r.sha256]));
  for (const r of provenance.revision) log(`  ${r.path.padEnd(40)} ${(inHash.get(r.path) ?? 'absent').slice(0, 16)}   ${r.sha256.slice(0, 16)}${inHash.get(r.path) === r.sha256 ? '' : '  (spliced)'}`);
  log(`rig-parts retune: wrote ${written.length} file(s) under ${input.out}, the provenance in ${RETUNE_FILE}`);
  rmSync(staged, { recursive: true, force: true });
  return { provenance, written };
}
