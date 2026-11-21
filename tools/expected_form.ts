/**
 * The form of the expected files (issue #1439): the machine-class sidecar, the
 * key-order digest it records, and the whole-file comparison the regeneration
 * tool's --check and the tree suite's EXP controls share. Pure: no clock, no
 * file system, no process.
 */
import { createHash } from 'node:crypto';

/** The sidecar beside every expected check.json. */
export const MACHINE_CLASS_FILE = 'machine-class.txt';
export const MACHINE_CLASS_NOTE =
  'Written on Linux by tools/regenerate_examples.ts: seam_scope.domain.states[].pose_sha256 and the last place of seam_scope.domain.states[].bounds in check.json are the Linux values (measured to differ on macOS); build.model_sha256 was measured equal on Linux and macOS;';
const KEY_ORDER_RE = / check\.json key order sha256 ([0-9a-f]{64})$/;

/**
 * The check.json fields measured to differ by machine class (issue #1439): the same tree's posed-setup
 * digest differs between macOS and Linux on every example, and a bound by 1 ulp on two validation variants.
 * `build.model_sha256` is not one: the five examples' and the standard variant's model digests are equal on
 * both, so it is compared exactly everywhere.
 */
const MACHINE_CLASS_PATHS: ReadonlyArray<{ re: RegExp; numeric: boolean }> = [
  { re: /^seam_scope\.domain\.states\[\d+\]\.pose_sha256$/, numeric: false },
  { re: /^seam_scope\.domain\.states\[\d+\]\.bounds\.(?:minX|minY|maxX|maxY)$/, numeric: true },
];
/** The last place of a bound: measured 1 ulp at 61 (about 7e-15); a real move is whole pixels. */
export const BOUNDS_LAST_PLACE = 1e-9;

export const show = (v: unknown): string => { const s = v === undefined ? 'absent' : JSON.stringify(v); return s.length > 120 ? `${s.slice(0, 117)}...` : s; };

/** Every object key path in document order, array indices included. */
export function keyPaths(value: unknown, at = '', into: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v, i) => keyPaths(v, `${at}[${i}]`, into));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { const p = at === '' ? k : `${at}.${k}`; into.push(p); keyPaths(v, p, into); }
  }
  return into;
}
export function keyOrderDigest(json: string): string {
  return createHash('sha256').update(JSON.stringify(keyPaths(JSON.parse(json)))).digest('hex');
}
export function machineClassLine(checkJson: string): string {
  return `${MACHINE_CLASS_NOTE} check.json key order sha256 ${keyOrderDigest(checkJson)}\n`;
}
/** The key-order digest a sidecar records, or null when the line is not the note. */
export function recordedKeyOrder(sidecar: string): string | null {
  const lines = sidecar.split('\n');
  if (lines.length !== 2 || lines[1] !== '' || !lines[0].startsWith(MACHINE_CLASS_NOTE)) return null;
  return KEY_ORDER_RE.exec(lines[0])?.[1] ?? null;
}
/** The first key path where two documents' key orders part, or null when they agree. */
export function firstKeyOutOfOrder(found: string, writer: string): string | null {
  const a = keyPaths(JSON.parse(found)), b = keyPaths(JSON.parse(writer));
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] ?? `(end; the writer has ${b[i]})`;
  return null;
}

export function machineClass(path: string, a: unknown, b: unknown): boolean {
  const m = MACHINE_CLASS_PATHS.find((p) => p.re.test(path));
  if (m === undefined) return false;
  if (!m.numeric) return typeof a === 'string' && typeof b === 'string';
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= BOUNDS_LAST_PLACE;
}


/** Leaf differences between two parsed documents: [path, expected, built]. Key order is reported as a difference too. */
function leafDiffs(a: unknown, b: unknown, at = '', into: Array<[string, unknown, unknown]> = []): Array<[string, unknown, unknown]> {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) into.push([`${at} (length)`, a.length, b.length]);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length || i >= b.length) into.push([`${at}[${i}]`, a[i], b[i]]); else leafDiffs(a[i], b[i], `${at}[${i}]`, into);
    }
    return into;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
    const ka = Object.keys(ra), kb = Object.keys(rb);
    const sa = ka.filter((k) => k in rb), sb = kb.filter((k) => k in ra);
    if (sa.join('\0') !== sb.join('\0')) into.push([`${at === '' ? '(top)' : at} (key order)`, sa, sb]);
    for (const k of ka) leafDiffs(ra[k], rb[k], at === '' ? k : `${at}.${k}`, into);
    for (const k of kb) if (!(k in ra)) into.push([at === '' ? k : `${at}.${k}`, undefined, rb[k]]);
    return into;
  }
  if (a !== b) into.push([at, a, b]);
  return into;
}

function setPath(doc: unknown, path: string, value: unknown): void {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = doc as Record<string, unknown>;
  for (const p of parts.slice(0, -1)) cur = cur[p] as Record<string, unknown>;
  cur[parts[parts.length - 1]] = value;
}

/**
 * One expected file against its build. `faults` fail the check; `machine` are
 * machine-class differences, reported and not failed off Linux.
 */
export function compareExpected(file: string, expected: string | Uint8Array, built: string | Uint8Array, platform: string,
  json: boolean, serialize?: (value: unknown) => string): { faults: string[]; machine: string[] } {
  const eb = typeof expected === 'string' ? Buffer.from(expected) : Buffer.from(expected);
  const bb = typeof built === 'string' ? Buffer.from(built) : Buffer.from(built);
  if (eb.equals(bb)) return { faults: [], machine: [] };
  if (!json) {
    if (file.endsWith('.txt')) {
      const a = eb.toString('utf8').split('\n'), b = bb.toString('utf8').split('\n');
      const i = a.findIndex((l, n) => l !== b[n]);
      const at = i < 0 ? a.length : i;
      return { faults: [`EXPECTED_IS_THE_BUILD: ${file} — line ${at + 1}: expected ${show(a[at])}, built ${show(b[at])}`], machine: [] };
    }
    return { faults: [`EXPECTED_IS_THE_BUILD: ${file} — bytes differ: ${eb.length} B expected, ${bb.length} B built`], machine: [] };
  }
  const ea = JSON.parse(eb.toString('utf8')) as unknown, ba = JSON.parse(bb.toString('utf8')) as unknown;
  const diffs = leafDiffs(ea, ba);
  const machine: string[] = [], faults: string[] = [];
  for (const [path, a, b] of diffs) {
    if (file.endsWith('check.json') && platform !== 'linux' && machineClass(path, a, b)) {
      machine.push(`MACHINE_CLASS: ${file} — ${path} differs by machine class: held to Linux (expected ${show(a)}, built ${show(b)} on ${platform})`);
    } else faults.push(`EXPECTED_IS_THE_BUILD: ${file} — ${path}: expected ${show(a)}, built ${show(b)}`);
  }
  if (faults.length === 0) {
    // Same values apart from machine class: the bytes must then be the writer's, with the Linux values put back.
    const held = structuredClone(ba);
    for (const [path, a] of diffs) setPath(held, path, a);
    const again = serialize === undefined ? null : serialize(held);
    if (again !== eb.toString('utf8')) {
      const a = eb.toString('utf8').split('\n'), b = (again ?? bb.toString('utf8')).split('\n');
      const i = a.findIndex((l, n) => l !== b[n]);
      faults.push(`EXPECTED_IS_THE_BUILD: ${file} — same values, other bytes than the writer's: line ${i + 1}: expected ${show(a[i])}, written ${show(b[i])}`);
    }
  }
  return { faults, machine };
}

