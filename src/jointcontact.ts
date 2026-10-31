/** Report core's material connectivity; no count here participates in a bar. */
import { PartsError } from './errors.ts';

export interface JointContactReading {
  status: 'REPORTED' | 'SKIP';
  joints: string[];
  joined?: number;
  separated?: number;
  unavailable?: number;
  reasons: Array<{ reason: string; frames?: number[] }>;
  reason?: string;
}
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Count only producer observations; an absent observation or joint name is explicitly unavailable. */
export function jointContactReading(raw: unknown, joints: readonly string[], sampled: unknown, object: string): JointContactReading {
  const names = [...new Set(joints)];
  const fail = (detail: string): never => { throw new PartsError([{ code: 'FRAMES_SIDECAR', object, detail: 'jointContact: ' + detail }]); };
  const knownCount = typeof sampled === 'number' && Number.isSafeInteger(sampled) && sampled >= 0 ? sampled : undefined;
  if (raw === undefined) {
    const reason = names.length === 0 ? 'pair has no declared named joint' : 'core seam reading has no jointContact.frames';
    return knownCount === undefined || knownCount === 0
      ? { status: 'SKIP', joints: names, reasons: [], reason: knownCount === 0 ? 'no sampled frames' : 'sample count unavailable: ' + reason }
      : { status: 'REPORTED', joints: names, joined: 0, separated: 0, unavailable: knownCount, reasons: [{ reason }] };
  }
  if (!record(raw) || !Array.isArray(raw.frames)) return fail('requires { frames: [...] }');
  if (knownCount !== undefined && raw.frames.length !== knownCount) return fail('has ' + raw.frames.length + ' frame(s); frames.json records ' + knownCount);
  const frames: Array<{ index: number; time: number; status: 'joined' | 'separated' | 'unavailable'; reason: string | null }> = [];
  for (const f of raw.frames) {
    if (!record(f) || typeof f.index !== 'number' || !Number.isSafeInteger(f.index) || f.index < 0 ||
        typeof f.time !== 'number' || !Number.isFinite(f.time) || f.time < 0 ||
        (f.status !== 'joined' && f.status !== 'separated' && f.status !== 'unavailable') ||
        (f.status === 'unavailable' ? typeof f.reason !== 'string' || f.reason.trim() === '' : f.reason !== null)) return fail('requires nonnegative index/time, joined/separated with null reason, or unavailable with a nonempty reason');
    const previous = frames.at(-1);
    if (previous !== undefined && (f.index <= previous.index || f.time <= previous.time)) return fail('frame indices and times must increase strictly');
    frames.push({ index: f.index, time: f.time, status: f.status, reason: f.reason as string | null });
  }
  if (frames.length === 0) return { status: 'SKIP', joints: names, reasons: [], reason: 'no sampled frames' };
  const out: JointContactReading = { status: 'REPORTED', joints: names, joined: 0, separated: 0, unavailable: 0, reasons: [] };
  for (const f of frames) {
    const status = names.length === 0 ? 'unavailable' : f.status;
    const reason = names.length === 0 ? 'pair has no declared named joint' : f.reason;
    if (status === 'joined') out.joined = (out.joined ?? 0) + 1;
    else if (status === 'separated') out.separated = (out.separated ?? 0) + 1;
    else {
      out.unavailable = (out.unavailable ?? 0) + 1;
      const why = reason as string;
      let hit = out.reasons.find(r => r.reason === why);
      if (hit === undefined) { hit = { reason: why, frames: [] }; out.reasons.push(hit); }
      hit.frames?.push(f.index);
    }
  }
  return out;
}
