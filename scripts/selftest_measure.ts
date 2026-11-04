import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

export type Phase = 'input' | 'fixture' | 'producer' | 'assertion';
export interface PhaseSpan { phase: Phase; label: string; began: number; ended: number }
export interface PhaseRecord {
  elapsedMs: number;
  spans: PhaseSpan[];
  exclusiveMs: Record<Phase | 'unclassified', number>;
  coverage: Record<Phase, 'MEASURED' | 'UNMEASURED'>;
}

/** Later-started spans own overlaps, including nested calls. Every interval has one owner. */
export function phaseRecord(spans: readonly PhaseSpan[], elapsedMs: number): PhaseRecord {
  const exclusiveMs = { input: 0, fixture: 0, producer: 0, assertion: 0, unclassified: 0 };
  const events = spans.flatMap((s, order) => s.ended === s.began ? [] : [{ at: s.began, order, begin: true }, { at: s.ended, order, begin: false }])
    .sort((a, b) => a.at - b.at || Number(a.begin) - Number(b.begin));
  const open = new Set<number>();
  let previous = 0;
  for (const event of [...events, { at: elapsedMs, order: -1, begin: false }]) {
    let owner: number | null = null;
    for (const index of open) if (owner === null || spans[index].began > spans[owner].began ||
      (spans[index].began === spans[owner].began && index > owner)) owner = index;
    exclusiveMs[owner === null ? 'unclassified' : spans[owner].phase] += event.at - previous;
    if (event.begin) open.add(event.order);
    else open.delete(event.order);
    previous = event.at;
  }
  const coverage = Object.fromEntries((['input', 'fixture', 'producer', 'assertion'] as const)
    .map(p => [p, spans.some(s => s.phase === p) ? 'MEASURED' : 'UNMEASURED'])) as PhaseRecord['coverage'];
  return { elapsedMs, spans: [...spans], exclusiveMs, coverage };
}

let active: { start: number; spans: PhaseSpan[] } | null = null;
export function beginPhases(): void { active = { start: performance.now(), spans: [] }; }
export function finishPhases(): PhaseRecord | null {
  const run = active;
  active = null;
  return run === null ? null : phaseRecord(run.spans, performance.now() - run.start);
}

/** Synchronous boundaries only. Work outside these hooks remains explicitly unclassified. */
export function measurePhase<T>(phase: Phase, label: string, work: () => T): T {
  const run = active;
  if (run === null) return work();
  const span: PhaseSpan = { phase, label, began: performance.now() - run.start, ended: 0 };
  run.spans.push(span);
  try { return work(); }
  finally { span.ended = performance.now() - run.start; }
}

export interface RssRow { pid: number; parent: number; start: string; bytes: number }

/** Live observer identities in the supervising process, excluded from its workload peak. */
export const observerPids = new Map<number, string>();

/** Retain reparented descendants only while PID and kernel start time still agree. */
export function familyRows(rows: readonly RssRow[], known: Map<number, string>): RssRow[] {
  const family = new Map<number, string>();
  for (const row of rows) if (known.get(row.pid) === row.start) family.set(row.pid, row.start);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) if (!family.has(row.pid) && family.has(row.parent)) {
      family.set(row.pid, row.start);
      grew = true;
    }
  }
  known.clear();
  for (const [pid, start] of family) known.set(pid, start);
  return rows.filter(row => family.has(row.pid));
}

function identity(text: string): readonly [number, string] {
  const fields = text.slice(text.lastIndexOf(')') + 2).split(/\s+/);
  return [Number(fields[1]), fields[19]];
}

export interface FamilyPeak {
  status: 'MEASURED' | 'UNMEASURED';
  method: 'linux-proc-status-summed-rss';
  intervalMs: number;
  samples: number;
  unreadable: number;
  bytes: number | null;
  holders: RssRow[];
}

export function unmeasuredFamily(): FamilyPeak {
  return { status: 'UNMEASURED', method: 'linux-proc-status-summed-rss', intervalMs: 200,
    samples: 0, unreadable: 0, bytes: null, holders: [] };
}

/** Refuse corrupt measurement payloads rather than letting missing fields look like observations. */
export function measurementPayloadValid(family: FamilyPeak, phases: PhaseRecord | { status: 'UNMEASURED' }): boolean {
  if (typeof family !== 'object' || family === null || family.method !== 'linux-proc-status-summed-rss' ||
    family.intervalMs !== 200 || !Number.isSafeInteger(family.samples) || family.samples < 0 ||
    !Number.isSafeInteger(family.unreadable) || family.unreadable < 0 || !Array.isArray(family.holders)) return false;
  if (family.status === 'UNMEASURED') {
    if (family.bytes !== null || family.samples !== 0 || family.holders.length !== 0) return false;
  } else {
    if (family.status !== 'MEASURED' || family.samples === 0 || !Number.isSafeInteger(family.bytes) ||
      (family.bytes ?? 0) <= 0 || family.holders.length === 0) return false;
    if (!family.holders.every(h => typeof h === 'object' && h !== null && Number.isSafeInteger(h.pid) && h.pid > 0 &&
      Number.isSafeInteger(h.parent) && h.parent >= 0 && typeof h.start === 'string' && /^\d+$/.test(h.start) &&
      Number.isSafeInteger(h.bytes) && h.bytes >= 0)) return false;
    if (new Set(family.holders.map(h => h.pid)).size !== family.holders.length ||
      family.holders.reduce((sum, h) => sum + h.bytes, 0) !== family.bytes) return false;
  }
  if (typeof phases !== 'object' || phases === null) return false;
  if ('status' in phases) return phases.status === 'UNMEASURED';
  if (!Number.isFinite(phases.elapsedMs) || phases.elapsedMs < 0 || !Array.isArray(phases.spans)) return false;
  if (!phases.spans.every(s => typeof s === 'object' && s !== null &&
    ['input', 'fixture', 'producer', 'assertion'].includes(s.phase) && typeof s.label === 'string' &&
    Number.isFinite(s.began) && Number.isFinite(s.ended) && s.began >= 0 && s.ended >= s.began && s.ended <= phases.elapsedMs)) return false;
  const expected = phaseRecord(phases.spans, phases.elapsedMs);
  return (['input', 'fixture', 'producer', 'assertion', 'unclassified'] as const)
    .every(p => phases.exclusiveMs?.[p] === expected.exclusiveMs[p]) &&
    (['input', 'fixture', 'producer', 'assertion'] as const).every(p => phases.coverage?.[p] === expected.coverage[p]);
}

/** An independent observer keeps sampling while a worker blocks in synchronous producer calls. */
export function observeFamily(pid: number, path: string): () => Promise<FamilyPeak> {
  if (process.platform !== 'linux') return async () => unmeasuredFamily();
  rmSync(path, { force: true });
  rmSync(path + '.stop', { force: true });
  let start: string;
  try { [, start] = identity(readFileSync(`/proc/${pid}/stat`, 'utf8')); }
  catch { return async () => unmeasuredFamily(); }
  const child = spawn(process.execPath, [import.meta.path, String(pid), start, path], { stdio: 'ignore' });
  let observerStart: string | undefined;
  try {
    if (child.pid !== undefined) {
      [, observerStart] = identity(readFileSync(`/proc/${child.pid}/stat`, 'utf8'));
      observerPids.set(child.pid, observerStart);
    }
  } catch { /* An observer that already exited cannot contribute to a later sample. */ }
  const closed = new Promise<void>(resolve => {
    const finish = (): void => {
      if (child.pid !== undefined && observerPids.get(child.pid) === observerStart) observerPids.delete(child.pid);
      resolve();
    };
    child.once('error', finish);
    child.once('close', finish);
  });
  return async () => {
    try { writeFileSync(path + '.stop', ''); }
    catch (error) {
      child.kill();
      await closed;
      throw error;
    }
    await closed;
    try { return JSON.parse(readFileSync(path, 'utf8')) as FamilyPeak; }
    catch { return unmeasuredFamily(); }
  };
}

async function observerMain(): Promise<void> {
  const [, , root, start, path] = process.argv;
  const known = new Map<number, string>([[Number(root), start]]);
  const peak = unmeasuredFamily();
  // The stop file is checked after sampling, so even short units get an honest coverage result.
  while (true) {
    const rows: RssRow[] = [];
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const [parent, began] = identity(readFileSync(`/proc/${entry}/stat`, 'utf8'));
        const rss = /^VmRSS:\s+(\d+)\s+kB$/m.exec(readFileSync(`/proc/${entry}/status`, 'utf8'));
        if (rss !== null) rows.push({ pid: Number(entry), parent, start: began, bytes: Number(rss[1]) * 1024 });
      } catch { peak.unreadable++; }
    }
    const family = familyRows(rows, known);
    if (family.length > 0) {
      peak.status = 'MEASURED';
      peak.samples++;
      const bytes = family.reduce((sum, row) => sum + row.bytes, 0);
      if (bytes > (peak.bytes ?? 0)) { peak.bytes = bytes; peak.holders = family; }
    }
    if (existsSync(path + '.stop') || known.size === 0) break;
    await Bun.sleep(peak.intervalMs);
  }
  writeFileSync(path, JSON.stringify(peak));
}

/** Real grandchild allocation, held across several samples, paired with an untouched allocation-free child. */
async function allocationControl(dir: string): Promise<void> {
  const records: FamilyPeak[] = [];
  for (const mib of [0, 96]) {
    const program = `const hold = Buffer.alloc(${mib} * 1024 ** 2, 173); setTimeout(() => { console.log(hold.length); }, 1000);`;
    const rootProgram = `const c = Bun.spawn([process.execPath, '-e', ${JSON.stringify(program)}], {stdout:'ignore'}); await c.exited;`;
    const root = spawn(process.execPath, ['-e', rootProgram], { stdio: 'ignore' });
    const finish = observeFamily(root.pid!, dir + '/' + mib);
    await new Promise<void>(resolve => root.once('close', () => resolve()));
    records.push(await finish());
  }
  console.log(JSON.stringify(records));
}

if (import.meta.main) {
  if (process.argv[2] === '--allocation-control') await allocationControl(process.argv[3]);
  else await observerMain();
}
