/**
 * A ComfyUI HTTP client: the six calls the adapter makes, each refusing by
 * name.
 *
 * `src/comfy/` is the one directory under `src/` allowed a network and a clock
 * (CLAUDE.md, *Conventions*): driving a GPU box is a network call with a
 * wall-clock wait. What is decided — the words, the graph, the check of a
 * graph against the box — is pure and lives in `src/graphs.ts`; this file only
 * carries it.
 *
 * 🔒 **The host is the user's, given at run time, and nothing else.** It comes
 * from `--host` or `COMFY_HOST`; with neither, `resolveHost` refuses. There is
 * no default address anywhere in this package, and the host is never written
 * into an output file.
 *
 * Every failure is a `PartsError` whose problem names the call, the value found
 * and the value required: a box that does not answer, a job still pending in the
 * queue past the wait, a `/prompt` the box rejected (with its own
 * `node_errors`), a job that does not reach `/history` within the timeout, a
 * job that ended in error, a history entry with no outputs.
 */
import { PartsError } from '../errors.ts';

export function refuse(code: string, object: string, detail: string): never {
  throw new PartsError([{ code, object, detail }]);
}

/** The host from `--host`, else `COMFY_HOST`; refused when neither is set. A trailing slash is dropped. */
export function resolveHost(flag: string | undefined, env: string | undefined): string {
  const host = flag ?? (env !== undefined && env !== '' ? env : undefined);
  if (host === undefined) {
    refuse('COMFY_HOST_GIVEN', 'the ComfyUI host', 'is absent: neither --host nor COMFY_HOST is set; a URL such as http://<address>:8188 is required, and there is no default');
  }
  if (!/^https?:\/\/[^/\s]+/.test(host)) {
    refuse('COMFY_HOST_GIVEN', 'the ComfyUI host', `is ${JSON.stringify(host)}; an http:// or https:// URL is required`);
  }
  return host.replace(/\/+$/, '');
}

export const OBJECT_INFO_REQUEST_FACTOR = 4;

export interface ClientTiming {
  /** Seconds between two polls of /queue or /history. */
  poll: number;
  /** Seconds one plain request may take. */
  request: number;
  /** Seconds GET /object_info may take (default: 4x `request`, bounded by `wait` when given). */
  objectInfo?: number;
  /** Seconds the run allows before a queued job starts (`--wait`), used to bound `/object_info`. */
  wait?: number;
  /** Milliseconds per nominal second (default: 1000); tests may inject a smaller unit to scale waits down. */
  unitMs?: number;
}

export interface OutputImage {
  filename: string;
  subfolder: string;
  type: string;
}

export interface HistoryEntry {
  outputs: Record<string, { images?: OutputImage[] }>;
  status: { status_str?: string; completed?: boolean; messages?: unknown[] } | null;
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

function isTimeoutRefusal(err: unknown): boolean {
  return (
    err instanceof PartsError &&
    err.problems.length === 1 &&
    err.problems[0].code === 'COMFY_REACHABLE' &&
    err.problems[0].detail.startsWith('did not answer within ')
  );
}

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function brief(text: string, n = 600): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
}

export class ComfyClient {
  constructor(
    readonly host: string,
    readonly timing: ClientTiming,
  ) {}

  private get unitMs(): number {
    return this.timing.unitMs ?? 1000;
  }

  private nowSeconds(): number {
    return Date.now() / this.unitMs;
  }

  private sleepSeconds(s: number): Promise<void> {
    return s <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, s * this.unitMs));
  }

  /**
   * Seconds `GET /object_info` may take: `timing.objectInfo` when set, else
   * four times `timing.request` (120 s at the 30 s default, since a real box's
   * multi-megabyte `/object_info` takes 24.5–36.5 s), bounded by `--wait`.
   */
  objectInfoSeconds(wait?: number): number {
    const cap = this.timing.objectInfo ?? this.timing.request * OBJECT_INFO_REQUEST_FACTOR;
    const bound = wait ?? this.timing.wait;
    return bound === undefined ? cap : Math.min(cap, bound);
  }

  private async call(method: 'GET' | 'POST', path: string, body?: string | FormData, headers?: Record<string, string>, seconds = this.timing.request): Promise<Response> {
    const label = Number(seconds.toFixed(1));
    try {
      return await fetch(`${this.host}${path}`, { method, body, headers, signal: AbortSignal.timeout(Math.max(1, seconds * this.unitMs)) });
    } catch (err) {
      const e = err as Error;
      const what = isTimeoutError(e) ? `did not answer within ${label} s` : `could not be reached (${e.message})`;
      return refuse('COMFY_REACHABLE', `${method} ${this.host}${path}`, `${what}; a running ComfyUI at this host is required`);
    }
  }

  private async readText(res: Response, method: 'GET' | 'POST', path: string, seconds: number): Promise<string> {
    try {
      return await res.text();
    } catch (err) {
      const e = err as Error;
      const label = Number(seconds.toFixed(1));
      const what = isTimeoutError(e) ? `did not answer within ${label} s` : `could not be reached (${e.message})`;
      return refuse('COMFY_REACHABLE', `${method} ${this.host}${path}`, `${what}; a running ComfyUI at this host is required`);
    }
  }

  private async json(method: 'GET' | 'POST', path: string, body?: string | FormData, headers?: Record<string, string>, seconds = this.timing.request): Promise<unknown> {
    const res = await this.call(method, path, body, headers, seconds);
    const text = await this.readText(res, method, path, seconds);
    if (!res.ok) refuse('COMFY_REQUEST_OK', `${method} ${this.host}${path}`, `answered HTTP ${res.status}: ${brief(text)}; HTTP 200 is required`);
    try {
      return JSON.parse(text);
    } catch {
      return refuse('COMFY_REQUEST_OK', `${method} ${this.host}${path}`, `answered HTTP ${res.status} with a body that is not JSON: ${brief(text, 200)}`);
    }
  }

  /** `GET /system_stats`, or a refusal naming the host. */
  async systemStats(seconds = this.timing.request): Promise<Record<string, unknown>> {
    const s = asObject(await this.json('GET', '/system_stats', undefined, undefined, seconds));
    if (s === null) refuse('COMFY_REQUEST_OK', `GET ${this.host}/system_stats`, 'answered with something that is not an object');
    return s;
  }

  /** Listed model files, not the node selector's advertised vocabulary. */
  async modelFiles(folder: string): Promise<string[]> {
    const files = await this.json('GET', `/models/${encodeURIComponent(folder)}`);
    if (!Array.isArray(files) || !files.every((f): f is string => typeof f === 'string')) {
      refuse('MATTE_MODEL_INSTALLED', folder, 'the model listing is not an array of file names; installed weights must be established before upload');
    }
    return files;
  }

  /** Free VRAM per device in GB (two decimals), keyed by the device name's first word; empty when the box does not say. */
  async vramFree(seconds = this.timing.request): Promise<Record<string, number>> {
    const s = await this.systemStats(seconds);
    const out: Record<string, number> = {};
    const devices = Array.isArray(s.devices) ? s.devices : [];
    for (const d of devices) {
      const o = asObject(d);
      if (o === null || typeof o.name !== 'string' || typeof o.vram_free !== 'number') continue;
      out[o.name.split(' ')[0]] = Math.round((o.vram_free / 1024 ** 3) * 100) / 100;
    }
    return out;
  }

  private async vramFreeBestEffort(seconds = this.timing.request): Promise<Record<string, number>> {
    try {
      return await this.vramFree(seconds);
    } catch (err) {
      if (isTimeoutRefusal(err)) return {};
      throw err;
    }
  }

  /**
   * Where a queued prompt stands: `running` when the box is running it,
   * `pending` with its 1-based place among the pending jobs (and how many are
   * ahead of it, running included), or `absent` when the queue no longer lists
   * it (finished, or never queued).
   */
  async queuePlace(id: string, seconds = this.timing.request): Promise<{ state: 'running' } | { state: 'pending'; place: number; pending: number; ahead: number } | { state: 'absent' }> {
    const q = asObject(await this.json('GET', '/queue', undefined, undefined, seconds));
    if (q === null || !Array.isArray(q.queue_running) || !Array.isArray(q.queue_pending)) {
      refuse('COMFY_REQUEST_OK', `GET ${this.host}/queue`, 'answered without queue_running and queue_pending arrays');
    }
    const idOf = (e: unknown): unknown => (Array.isArray(e) ? e[1] : undefined);
    const running = q.queue_running as unknown[];
    if (running.some((e) => idOf(e) === id)) return { state: 'running' };
    // ComfyUI orders pending jobs by their queue number (the entry's first element), not by list position.
    const pending = [...(q.queue_pending as unknown[])].sort((a, b) => Number(Array.isArray(a) ? a[0] : 0) - Number(Array.isArray(b) ? b[0] : 0));
    const at = pending.findIndex((e) => idOf(e) === id);
    if (at < 0) return { state: 'absent' };
    return { state: 'pending', place: at + 1, pending: pending.length, ahead: running.length + at };
  }

  /**
   * Wait for a prompt queued behind other jobs (it was appended, never put in
   * front, and nothing here reorders or cancels anyone's job): at most `wait`
   * seconds while it is still pending, then at most `timeout` seconds once the
   * box is running it. A timed-out `/queue` poll is retried while time remains
   * in the active bound. A wait past either bound is refused naming `prompt <id>`
   * and its place in the queue; the job is left on the box.
   */
  async waitBehind(id: string, wait: number, timeout: number, say: (line: string) => void): Promise<{ entry: HistoryEntry; vramLow: Record<string, number>; elapsed: number }> {
    const t0 = this.nowSeconds();
    let started: number | null = null;
    let lastPlace = -1;
    let lastPending: { place: number; pending: number; ahead: number } | null = null;
    let pollTimeouts = 0;
    // The minimum free VRAM while this job runs: sampled on every running poll,
    // then merged with what `waitHistory` reads, so it is not a post-run reading.
    const vramLow: Record<string, number> = {};
    for (;;) {
      const phaseStart = started ?? t0;
      const phaseBound = started === null ? wait : timeout;
      const remaining = phaseBound - (this.nowSeconds() - phaseStart);
      const pollCap = this.timing.request * 2 ** pollTimeouts;
      const reqSeconds = remaining > 0 ? Math.min(pollCap, remaining) : Math.min(this.timing.request, Math.max(0.001, phaseBound));
      let place: Awaited<ReturnType<ComfyClient['queuePlace']>>;
      try {
        place = await this.queuePlace(id, reqSeconds);
        pollTimeouts = 0;
      } catch (err) {
        if (!isTimeoutRefusal(err)) throw err;
        pollTimeouts++;
        const now = this.nowSeconds();
        if (started !== null) {
          const runningFor = now - started;
          if (runningFor >= timeout) {
            refuse('COMFY_HISTORY_WITHIN', `prompt ${id}`, `was still running ${runningFor.toFixed(1)} s after it started; it is required within --timeout ${timeout} s (the job was left on the box, not cancelled)`);
          }
          await this.sleepSeconds(Math.min(this.timing.poll, Math.max(0, timeout - runningFor)));
          continue;
        }
        const waited = now - t0;
        if (waited >= wait) {
          const where =
            lastPending !== null
              ? `, at place ${lastPending.place} of ${lastPending.pending} pending with ${lastPending.ahead} job(s) ahead of it`
              : ` (GET ${this.host}/queue timed out while waiting)`;
          refuse(
            'COMFY_QUEUE_BEHIND',
            `prompt ${id}`,
            `was still pending after ${waited.toFixed(1)} s${where}; it is required to start within --wait ${wait} s — the job was left in its place on the box, not moved and not cancelled, and no one else's job was touched`,
          );
        }
        await this.sleepSeconds(Math.min(this.timing.poll, Math.max(0, wait - waited)));
        continue;
      }
      if (place.state === 'absent') {
        const spentRunning = started === null ? 0 : this.nowSeconds() - started;
        const historyBudget = Math.max(timeout - spentRunning, Math.min(this.timing.request, timeout), this.timing.poll * 2);
        const done = await this.waitHistory(id, historyBudget, timeout);
        for (const [k, v] of Object.entries(done.vramLow)) if (!(k in vramLow) || v < vramLow[k]) vramLow[k] = v;
        return { entry: done.entry, vramLow, elapsed: this.nowSeconds() - t0 };
      }
      const now = this.nowSeconds();
      if (place.state === 'running') {
        for (const [k, v] of Object.entries(await this.vramFreeBestEffort())) if (!(k in vramLow) || v < vramLow[k]) vramLow[k] = v;
        if (started === null) {
          started = now;
          say(`  prompt ${id} is running`);
        }
        if (now - started >= timeout) {
          refuse('COMFY_HISTORY_WITHIN', `prompt ${id}`, `was still running ${(now - started).toFixed(1)} s after it started; it is required within --timeout ${timeout} s (the job was left on the box, not cancelled)`);
        }
        await this.sleepSeconds(Math.min(this.timing.poll, Math.max(0, timeout - (this.nowSeconds() - started))));
      } else {
        lastPending = place;
        if (place.place !== lastPlace) say(`  prompt ${id} queued behind ${place.ahead} job(s) (pending place ${place.place} of ${place.pending})`);
        lastPlace = place.place;
        const waited = now - t0;
        if (waited >= wait) {
          refuse(
            'COMFY_QUEUE_BEHIND',
            `prompt ${id}`,
            `was still pending after ${waited.toFixed(1)} s, at place ${place.place} of ${place.pending} pending with ${place.ahead} job(s) ahead of it; it is required to start within --wait ${wait} s — the job was left in its place on the box, not moved and not cancelled, and no one else's job was touched`,
          );
        }
        await this.sleepSeconds(Math.min(this.timing.poll, Math.max(0, wait - (this.nowSeconds() - t0))));
      }
    }
  }

  /** `GET /object_info`: every node class the box has, with its inputs. */
  async objectInfo(wait?: number): Promise<Record<string, unknown>> {
    const o = asObject(await this.json('GET', '/object_info', undefined, undefined, this.objectInfoSeconds(wait)));
    if (o === null) refuse('COMFY_REQUEST_OK', `GET ${this.host}/object_info`, 'answered with something that is not an object of node classes');
    return o;
  }

  /** `POST /upload/image` into the box's input directory, overwriting; returns the name LoadImage takes. */
  async uploadImage(bytes: Uint8Array, name: string): Promise<string> {
    const form = new FormData();
    form.append('image', new Blob([bytes], { type: 'image/png' }), name);
    form.append('overwrite', 'true');
    form.append('type', 'input');
    form.append('subfolder', '');
    const res = asObject(await this.json('POST', '/upload/image', form));
    if (res === null || typeof res.name !== 'string') refuse('COMFY_REQUEST_OK', `POST ${this.host}/upload/image`, 'answered without the uploaded file\'s name');
    return typeof res.subfolder === 'string' && res.subfolder !== '' ? `${res.subfolder}/${res.name}` : res.name;
  }

  /** `POST /prompt`; returns the prompt id. A rejection is refused with the box's own error text. */
  async submit(graph: unknown, clientId: string): Promise<string> {
    const res = await this.call('POST', '/prompt', JSON.stringify({ prompt: graph, client_id: clientId }), { 'Content-Type': 'application/json' });
    const text = await this.readText(res, 'POST', '/prompt', this.timing.request);
    if (!res.ok) refuse('COMFY_PROMPT_ACCEPTED', `POST ${this.host}/prompt`, `rejected the graph with HTTP ${res.status}: ${brief(text, 1500)}`);
    let id: unknown;
    try {
      id = asObject(JSON.parse(text))?.prompt_id;
    } catch {
      id = undefined;
    }
    if (typeof id !== 'string') refuse('COMFY_PROMPT_ACCEPTED', `POST ${this.host}/prompt`, `answered without a prompt_id: ${brief(text, 300)}`);
    return id;
  }

  /**
   * Poll `/history/<id>` until the job is there, for at most `timeout`
   * seconds, and check the box is still answering between polls. A timed-out
   * poll is retried while time remains in `timeout`. Returns the entry and the
   * lowest free VRAM seen per device. An entry whose status is an error is
   * refused with the box's messages; so is an entry with no outputs at all,
   * because a finished job that saved nothing is not a result.
   */
  async waitHistory(id: string, timeout: number, reportedTimeout = timeout): Promise<{ entry: HistoryEntry; vramLow: Record<string, number>; elapsed: number }> {
    const t0 = this.nowSeconds();
    const vramLow: Record<string, number> = {};
    let pollTimeouts = 0;
    for (;;) {
      const remaining = timeout - (this.nowSeconds() - t0);
      const pollCap = this.timing.request * 2 ** pollTimeouts;
      const reqSeconds = remaining > 0 ? Math.min(pollCap, remaining) : Math.min(this.timing.request, Math.max(0.001, timeout));
      for (const [k, v] of Object.entries(await this.vramFreeBestEffort(reqSeconds))) if (!(k in vramLow) || v < vramLow[k]) vramLow[k] = v;
      let h: Record<string, unknown> | null;
      try {
        h = asObject(await this.json('GET', `/history/${encodeURIComponent(id)}`, undefined, undefined, reqSeconds));
        pollTimeouts = 0;
      } catch (err) {
        if (!isTimeoutRefusal(err)) throw err;
        pollTimeouts++;
        const waited = this.nowSeconds() - t0;
        if (waited >= timeout) {
          refuse('COMFY_HISTORY_WITHIN', `prompt ${id}`, `was not in /history after ${waited.toFixed(1)} s; it is required within --timeout ${reportedTimeout} s (the job was left on the box, not cancelled)`);
        }
        await this.sleepSeconds(Math.min(this.timing.poll, Math.max(0, timeout - waited)));
        continue;
      }
      const raw = h === null ? null : asObject(h[id]);
      if (raw !== null) {
        const entry: HistoryEntry = {
          outputs: (asObject(raw.outputs) ?? {}) as HistoryEntry['outputs'],
          status: asObject(raw.status) as HistoryEntry['status'],
        };
        const elapsed = this.nowSeconds() - t0;
        if (entry.status?.status_str === 'error') {
          refuse('COMFY_RUN_OK', `prompt ${id}`, `ended with status "error": ${brief(JSON.stringify(entry.status.messages ?? []), 2000)}`);
        }
        if (Object.keys(entry.outputs).length === 0) {
          refuse(
            'COMFY_HISTORY_OUTPUTS',
            `prompt ${id}`,
            `reached /history with status ${JSON.stringify(entry.status?.status_str ?? null)} and no outputs; a finished job lists what its save nodes wrote, and one that lists nothing is not a result`,
          );
        }
        return { entry, vramLow, elapsed };
      }
      const waited = this.nowSeconds() - t0;
      if (waited >= timeout) {
        refuse('COMFY_HISTORY_WITHIN', `prompt ${id}`, `was not in /history after ${waited.toFixed(1)} s; it is required within --timeout ${reportedTimeout} s (the job was left on the box, not cancelled)`);
      }
      await this.sleepSeconds(Math.min(this.timing.poll, Math.max(0, timeout - waited)));
    }
  }

  /** `GET /view` of one file in the box's output (or input) directory. */
  async view(filename: string, subfolder = '', type = 'output'): Promise<Uint8Array> {
    const q = new URLSearchParams({ filename, subfolder, type }).toString();
    const res = await this.call('GET', `/view?${q}`, undefined, undefined, Math.max(this.timing.request, 180));
    if (!res.ok) {
      refuse('COMFY_VIEW_PRESENT', `${type}/${subfolder === '' ? '' : `${subfolder}/`}${filename}`, `answered HTTP ${res.status} on /view; the file the job reported is required`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}

/** The images a history entry lists, in node-id order then list order. */
export function historyImages(entry: HistoryEntry): OutputImage[] {
  const out: OutputImage[] = [];
  for (const id of Object.keys(entry.outputs).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))) {
    for (const im of entry.outputs[id]?.images ?? []) {
      if (typeof im?.filename === 'string') out.push({ filename: im.filename, subfolder: typeof im.subfolder === 'string' ? im.subfolder : '', type: typeof im.type === 'string' ? im.type : 'output' });
    }
  }
  return out;
}
