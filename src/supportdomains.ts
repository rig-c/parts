/** Optional source-bound independent assembly domains (#998). */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { SUPPORT_GRID_CODE, type SupportDomain, type SupportDomainReading } from './coincide.ts';
import { refuseIfAny } from './errors.ts';
import { partImageReference, type PartsFile } from './parts.ts';

export const SUPPORT_DOMAINS_FILE = 'part_support_domains.json';
const SPEC = 'rig-parts-support-domains/1';
const sha = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

/** Sorted flattened [start,length] runs retain the assembler's exact mask.
 * The reader decodes them; it never re-derives a second polygon rasteriser. */
function runs(data: Uint8Array): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let p = 0; p < data.length; p++) {
    if (data[p] === 0) continue;
    const start = p;
    while (p + 1 < data.length && data[p + 1] !== 0) p++;
    out.push([start, p - start + 1]);
  }
  return out;
}

/** Only a separate optional file is written. Existing parts and PNGs are read. */
export function writeSupportDomains(partsPath: string, partsDir: string, parts: PartsFile, domains: readonly SupportDomainReading[], declarations: string): void {
  const entries = parts.parts.map(part => {
    const domain = domains.find(d => d.part === part.name);
    if (domain !== undefined && 'mask' in domain) return { part: part.name, status: 'measured', provenance: domain.provenance, runs: runs(domain.mask.data) };
    const reason = domain !== undefined ? domain.reason : part.limb !== undefined
      ? `limb segment "${part.name}" has joint lines but no authored radial width; the art-derived cap radius is not an independent witness`
      : 'no authored spatial cut domain; config.regions is only a bone binding';
    return { part: part.name, status: 'unavailable', reason };
  });
  writeFileSync(join(dirname(partsPath), SUPPORT_DOMAINS_FILE), JSON.stringify({
    spec: SPEC, grid: parts.rig_size, declarations_sha256: sha(declarations), parts_sha256: sha(readFileSync(partsPath)),
    images: parts.parts.map(p => ({ part: p.name, sha256: sha(readFileSync(join(partsDir, basename(partImageReference(p).path)))) })),
    domains_sha256: sha(JSON.stringify(entries)), domains: entries,
  }, null, 2) + '\n');
}

/** Missing/stale evidence is unavailable. A dimension mismatch is a named
 * refusal because source and setup cells cannot be compared on different grids. */
export function readSupportDomains(partsPath: string, partsDir: string, parts: PartsFile): SupportDomainReading[] {
  const unavailable = (reason: string): SupportDomainReading[] => parts.parts.map(p => ({ part: p.name, reason }));
  const file = join(dirname(partsPath), SUPPORT_DOMAINS_FILE);
  if (!existsSync(file)) return unavailable('independent support sidecar is unavailable (legacy output)');
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { return unavailable('independent support sidecar is not readable JSON'); }
  if (!object(raw) || raw.spec !== SPEC || !Array.isArray(raw.grid) || raw.grid.length !== 2 || !raw.grid.every(v => Number.isSafeInteger(v) && v > 0)) return unavailable('independent support sidecar has no valid spec or native grid');
  const [width, height] = parts.rig_size;
  if (raw.grid[0] !== width || raw.grid[1] !== height) refuseIfAny([{ code: SUPPORT_GRID_CODE, object: SUPPORT_DOMAINS_FILE, detail: `declares ${raw.grid.join('x')}; parts.json requires ${width}x${height}` }]);
  if (!digest(raw.declarations_sha256) || raw.parts_sha256 !== sha(readFileSync(partsPath)) || !Array.isArray(raw.images) || raw.images.length !== parts.parts.length || !Array.isArray(raw.domains) || raw.domains.length !== parts.parts.length || raw.domains_sha256 !== sha(JSON.stringify(raw.domains))) return unavailable('independent support sidecar does not bind these parts or its domain payload');
  for (let i = 0; i < parts.parts.length; i++) {
    const binding: unknown = raw.images[i], part = parts.parts[i];
    if (!object(binding) || binding.part !== part.name || binding.sha256 !== sha(readFileSync(join(partsDir, basename(partImageReference(part).path))))) return unavailable(`independent support sidecar PNG binding differs for "${part.name}"`);
  }
  const domains: SupportDomainReading[] = [];
  for (let i = 0; i < parts.parts.length; i++) {
    const row: unknown = raw.domains[i];
    if (!object(row) || row.part !== parts.parts[i].name) return unavailable('independent support sidecar does not name every part in assembly order');
    if (row.status === 'unavailable' && typeof row.reason === 'string' && row.reason.length > 0) { domains.push({ part: row.part, reason: row.reason }); continue; }
    if (row.status !== 'measured' || !object(row.provenance) || row.provenance.kind !== 'cut-polygon' || typeof row.provenance.entry !== 'string' || !Array.isArray(row.runs)) return unavailable(`independent support domain for "${row.part}" lacks authored cut provenance or runs`);
    const data = new Uint8Array(width * height);
    let previous = 0;
    for (const run of row.runs) {
      if (!Array.isArray(run) || run.length !== 2 || !run.every(Number.isSafeInteger) || run[0] < previous || run[1] <= 0 || run[0] + run[1] > data.length) return unavailable(`independent support runs for "${row.part}" are invalid or overlap`);
      data.fill(1, run[0], run[0] + run[1]); previous = run[0] + run[1];
    }
    domains.push({ part: row.part, mask: { width, height, data }, provenance: row.provenance as unknown as SupportDomain['provenance'] });
  }
  return domains;
}
