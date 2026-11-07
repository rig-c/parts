/** Assemble-output integrity and explicit unmeasured quality classes. No rig or renderer. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { failLine, PartsError, type Problem } from './errors.ts';
import { FIGURE_MASK_FILE, partImageReference, partsFileReferences, readParts, type PartsFile } from './parts.ts';
import { readPng } from './raster/png.ts';
import { RasterError } from './raster/types.ts';
import { NotAPngError } from '@rig-c/core/png';
import { SOURCE_COVER_SPEC, sourceCoverReport } from './sourcecover.ts';

export const PARTS_CHECK_SPEC = 'rig-parts-parts-check/1';
export const PARTS_CHECK_FILE = 'parts-check.json';

/** Closed diagnostic vocabulary for this spec, including reused metadata readers. */
export const PARTS_CHECK_CODES: readonly string[] = [
  'CONFIG_SET_FOCUS',
  'PARTS_ALT_BASE_ANCHOR',
  'PARTS_ALT_TIPS',
  'PARTS_ALT_TIPS_SOURCE',
  'PARTS_BOX_INSIDE_RIG',
  'PARTS_CHECK_INPUT_CHANGED',
  'PARTS_CHECK_INPUT_READ',
  'PARTS_CHECK_INTERNAL',
  'PARTS_CHECK_OUTPUT',
  'PARTS_CHECK_PNG_READ',
  'PARTS_CHECK_PUBLISH',
  'PARTS_CHECK_REPORT',
  'PARTS_COUNTS_ADD_UP',
  'PARTS_CUT_FROM_KNOWN',
  'PARTS_DEPTH_REFERENCE',
  'PARTS_FIELD_PRESENT',
  'PARTS_FIELD_TYPE',
  'PARTS_FILE_PRESENT',
  'PARTS_FROM_KNOWN',
  'PARTS_HOLES_LARGEST_FIRST',
  'PARTS_HOLE_PART_KNOWN',
  'PARTS_HYBRID_PAIR',
  'PARTS_INVENTED_EXPOSURE',
  'PARTS_INVENTED_MATERIAL',
  'PARTS_IS_JSON',
  'PARTS_KEY_KNOWN',
  'PARTS_MOTION_SEAM',
  'PARTS_NAME_UNIQUE',
  'PARTS_PAINTING_ALLOCATION',
  'PARTS_PAINTING_OPAQUE',
  'PARTS_PAINTING_PNG',
  'PARTS_PAINTING_PRESENT',
  'PARTS_PAINTING_SHA256',
  'PARTS_PAINTING_SIZE',
  'PARTS_PLATE_GHOST',
  'PARTS_PLATE_SMEAR',
  'PARTS_PLATE_STEPS',
  'PARTS_PLATE_STRUCTURE',
  'PARTS_SINGLE_RUN_PAD',
  'PARTS_SOURCE_COVER',
  'PARTS_TAKEN_LAYERS',
  'PARTS_UNPLANNED_SOURCE_COVER',
  'PROPOSE_PNG_MATCHES_BOX',
  'USAGE',
];

export const PARTS_QUALITY_HOLES = [
  ['PARTS_PLATE_GHOST', 'no adopted plate-ghost discriminator; assemble outputs do not bind a background plate or composed figure outline'],
  ['PARTS_PLATE_STRUCTURE', 'no adopted background-structure continuation measure or reference'],
  ['PARTS_PLATE_SMEAR', 'no adopted plate-smear discriminator'],
  ['PARTS_PLATE_STEPS', 'no adopted plate-fill continuity measure'],
  ['PARTS_INVENTED_MATERIAL', 'no validated producer-bound per-pixel painted-versus-invented record'],
  ['PARTS_INVENTED_EXPOSURE', 'invented-material identity and posed-frame observations are unavailable at the parts stage'],
] as const;

export interface PartsCheckInput {
  path: string;
  status: 'read' | 'missing' | 'unreadable' | 'absent';
  sha256: string | null;
}
interface Refusal extends Problem { found: unknown; required: unknown }
interface Hole { code: string; object: string; reason: string; line: string }
interface CoverRow { code: string; set: string | null; part: string; source: string; count: number; spans: unknown[] }
export interface PartsCheckReport {
  spec: typeof PARTS_CHECK_SPEC;
  stage: 'parts';
  inputs: PartsCheckInput[];
  parts: { primary: string[]; alternates: unknown[]; source_cover: unknown; painting_allocation: unknown[] };
  refusals: Refusal[];
  reported: CoverRow[];
  holes: Hole[];
  exit_code: number;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function count(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(v => typeof v === 'string'); }
function hash(value: unknown): boolean { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function unique(value: unknown[]): boolean { return new Set(value).size === value.length; }
function grid(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(v => count(v) && v > 0);
}
function pixels(value: unknown, size: [number, number]): boolean {
  if (!object(value) || !count(value.count) || !Array.isArray(value.spans)) return false;
  let total = 0;
  let previousY = -1;
  let previousRight = -1;
  for (const span of value.spans) {
    if (!Array.isArray(span) || span.length !== 3 || !span.every(count)) return false;
    const [y, left, right] = span as number[];
    if (y >= size[1] || right > size[0] || left >= right || y < previousY || (y === previousY && left < previousRight)) return false;
    previousY = y;
    previousRight = right;
    total += right - left;
  }
  return total === value.count;
}

/** Preserve array order, but make embedded producer objects independent of JSON key order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function physical(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(physical(parent), relative(parent, absolute));
}
function within(parent: string, path: string): boolean {
  const rel = relative(parent, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
function fatal(code: string, object: string, detail: string): never {
  throw new PartsError([{ code, object, detail }]);
}
function ioError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' && /^E[A-Z]+$/.test(error.code);
}

/** No source writes. A disjoint output root is required even for a refused input. */
export function checkPartsStage(input: string, output: string, log: (line: string) => void = console.log): PartsCheckReport {
  const home = resolve(input);
  const out = resolve(output);
  const realHome = physical(home);
  const realOut = physical(out);
  if (within(realHome, realOut) || within(realOut, realHome)) {
    fatal('PARTS_CHECK_OUTPUT', '--out', 'overlaps --parts; a disjoint report directory is required');
  }
  const destination = join(out, PARTS_CHECK_FILE);
  const temporary = `${destination}.tmp`;
  try {
    rmSync(destination, { force: true });
    rmSync(temporary, { force: true });
  } catch {
    fatal('PARTS_CHECK_PUBLISH', '--out', 'could not remove the previous report or its temporary file before reading inputs');
  }
  const clean = (value: string): string => value.replaceAll(home, '.').replaceAll(realHome, '.');
  const refusals: Refusal[] = [];
  const refuse = (code: string, at: string, found: unknown, required: unknown, detail: string): void => {
    if (!PARTS_CHECK_CODES.includes(code)) fatal('PARTS_CHECK_INTERNAL', 'check-parts', 'reader emitted a code outside the signed spec');
    refusals.push({ code, object: clean(at), found, required, detail: clean(detail) });
  };
  const readerError = (error: unknown): void => {
    if (!(error instanceof PartsError)) throw error;
    for (const problem of error.problems) refuse(problem.code, problem.object, null, null, problem.detail);
  };
  const requiredPaths = new Set(['parts.json']);
  const optionalPaths = new Set(['source_cover.json', 'painting_allocation.json']);
  const ignoredPaths = new Set<string>();
  let initialManifestHash: string | undefined;
  // Only metadata is read here. Figure masks have a layout-dependent location (#1177).
  try {
    const manifestPath = join(home, 'parts.json');
    if (lstatSync(manifestPath).isFile()) {
      const bytes = readFileSync(manifestPath);
      initialManifestHash = createHash('sha256').update(bytes).digest('hex');
      const raw: unknown = JSON.parse(bytes.toString('utf8'));
      if (object(raw)) {
        const scenes = [raw.scene, ...(Array.isArray(raw.alternates) ? raw.alternates.filter(object).map(set => set.scene) : [])];
        for (const scene of scenes) if (object(scene) && scene.figure_mask === FIGURE_MASK_FILE) {
          ignoredPaths.add(FIGURE_MASK_FILE);
        }
      }
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && !ioError(error)) throw error;
    // The regular metadata reader below owns the named refusal.
  }
  const inventory = (reportErrors: boolean): PartsCheckInput[] => {
    const rows = new Map<string, PartsCheckInput>();
    const visit = (name: string): void => {
      if (ignoredPaths.has(name)) return;
      const path = join(home, name);
      try {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
          rows.set(name, { path: name, status: 'unreadable', sha256: null });
          if (reportErrors) refuse('PARTS_CHECK_INPUT_READ', name, 'non-regular input', 'regular file or directory', 'input links and special files require a regular-file scratch copy');
        } else if (stat.isDirectory()) {
          for (const entry of readdirSync(path).sort()) visit(name === '.' ? entry : `${name}/${entry}`);
        } else {
          rows.set(name, { path: name, status: 'read', sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
        }
      } catch (error) {
        if (!ioError(error)) throw error;
        const missing = 'code' in error && error.code === 'ENOENT';
        rows.set(name, { path: name, status: missing ? 'missing' : 'unreadable', sha256: null });
        if (reportErrors) refuse('PARTS_CHECK_INPUT_READ', name, clean(error.message), 'readable regular input', 'input inventory could not read this object');
      }
    };
    visit('.');
    for (const name of [...requiredPaths, ...optionalPaths]) if (!rows.has(name)) {
      rows.set(name, { path: name, status: optionalPaths.has(name) ? 'absent' : 'missing', sha256: null });
    }
    return [...rows.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  };
  // Inventory first, then discover references through the existing metadata reader.
  const before = inventory(true);
  if (initialManifestHash !== undefined && before.find(row => row.path === 'parts.json')?.sha256 !== initialManifestHash) {
    fatal('PARTS_CHECK_INPUT_CHANGED', 'parts.json', 'manifest changed while reading references; no report was published');
  }
  let file: PartsFile | undefined;
  let references: ReturnType<typeof partsFileReferences> = [];
  try {
    references = partsFileReferences(home).filter(reference => reference.role !== 'figure_mask');
    for (const reference of references) requiredPaths.add(reference.path);
    const unsafe = references.filter(reference => !within(realHome, physical(join(home, reference.path))));
    for (const reference of unsafe) refuse('PARTS_CHECK_INPUT_READ', reference.path, 'reference outside --parts', 'input inside --parts', 'copy declared assets into the assemble directory');
    if (unsafe.length === 0 && !before.some(row => row.status === 'unreadable')) file = readParts(join(home, 'parts.json'));
  } catch (error) {
    if (ioError(error)) refuse('PARTS_CHECK_INPUT_READ', 'parts.json', clean(error.message), 'readable input', 'the manifest or its declared painting could not be read');
    else readerError(error);
  }
  // Add missing declared references to the initial inventory, without re-reading bytes.
  for (const name of requiredPaths) if (!before.some(row => row.path === name)) before.push({ path: name, status: 'missing', sha256: null });
  before.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const holes: Hole[] = [];
  const hole = (code: string, at: string, reason: string): void => { holes.push({ code, object: at, reason, line: `${code}: HOLE — ${reason}` }); };
  for (const [code, reason] of PARTS_QUALITY_HOLES) hole(code, 'parts', reason);
  if (file !== undefined) {
    const partRows = [
      ...file.parts.map(part => ({ part, path: partImageReference(part).path })),
      ...(file.alternates ?? []).flatMap(set => set.records.map(part => ({ part, path: partImageReference(part, set.name).path }))),
    ];
    for (const { part, path } of partRows) {
      try {
        const image = readPng(join(home, path));
        if (image.width !== part.w || image.height !== part.h) {
          refuse('PROPOSE_PNG_MATCHES_BOX', `part "${part.name}"`, [image.width, image.height], [part.w, part.h], `${path} is ${image.width}x${image.height}; parts.json requires ${part.w}x${part.h}`);
        }
      } catch (error) {
        if (!ioError(error) && !(error instanceof RasterError) && !(error instanceof NotAPngError)) throw error;
        refuse('PARTS_CHECK_PNG_READ', `part "${part.name}"`, clean(error.message), 'decodable PNG', `${path} is not a readable PNG`);
      }
    }
    for (const reference of references.filter(row => row.role !== 'part' && row.role !== 'alternate' && row.role !== 'painting')) {
      try { readPng(join(home, reference.path)); }
      catch (error) {
        if (!ioError(error) && !(error instanceof RasterError) && !(error instanceof NotAPngError)) throw error;
        refuse('PARTS_CHECK_PNG_READ', reference.path, clean(error.message), 'decodable PNG', 'declared auxiliary PNG is not readable');
      }
    }
  }
  const readReport = (name: string, spec: string): Record<string, unknown> | null => {
    const row = before.find(entry => entry.path === name);
    if (row?.status === 'absent') return null;
    if (row?.status === 'unreadable') {
      refuse('PARTS_CHECK_REPORT', name, 'unreadable input', spec, 'present report must be a readable regular file');
      return null;
    }
    try {
      const value: unknown = JSON.parse(readFileSync(join(home, name), 'utf8'));
      if (!object(value) || value.spec !== spec) {
        refuse('PARTS_CHECK_REPORT', name, object(value) ? value.spec ?? null : value, spec, 'report requires its declared producer spec');
        return null;
      }
      return value;
    } catch (error) {
      if (!(error instanceof SyntaxError) && !ioError(error)) throw error;
      refuse('PARTS_CHECK_REPORT', name, clean(error.message), spec, 'present report must be readable JSON');
      return null;
    }
  };
  const cover = readReport('source_cover.json', SOURCE_COVER_SPEC);
  const reported: CoverRow[] = [];
  if (before.find(row => row.path === 'source_cover.json')?.status === 'absent') {
    hole('PARTS_SOURCE_COVER', 'source_cover.json', 'source_cover.json is absent; direct unplanned source cover is unavailable');
  }
  if (cover !== null) {
    const valid = cover.stage === 'source-projection-input' &&
      JSON.stringify(canonical(cover.predicate)) === JSON.stringify(canonical(sourceCoverReport([]).predicate)) &&
      Array.isArray(cover.sets) && cover.sets.length > 0;
    if (!valid) refuse('PARTS_CHECK_REPORT', 'source_cover.json', canonical(cover), 'source-projection-input predicate and nonempty sets', 'source cover header is malformed');
    else for (const set of cover.sets as unknown[]) {
      if (!object(set) || !(set.set === null || typeof set.set === 'string') || !grid(set.grid) ||
          !Array.isArray(set.sources) || !Array.isArray(set.parts) || !Array.isArray(set.inputs) ||
          !strings(set.hidden_parts) || !Array.isArray(set.inherited_parts) || !Array.isArray(set.output_assets)) {
        refuse('PARTS_CHECK_REPORT', 'source_cover.json set', canonical(set), 'complete source-cover set', 'set membership or grid is malformed');
        continue;
      }
      const validSources = set.sources.every(source => object(source) && typeof source.source === 'string' &&
        (source.run === 'full' || source.run === 'head') && typeof source.layer === 'string' &&
        source.source === `${source.run}:${source.layer}` && (source.depth_median === null || typeof source.depth_median === 'number') &&
        count(source.draw_order) && Number.isSafeInteger(source.plan_rank) && Number(source.plan_rank) >= -1 &&
        strings(source.planned_parts) && strings(source.extend_parts) && (source.input_layer === null || typeof source.input_layer === 'string') &&
        typeof source.prepared === 'boolean' && Array.isArray(source.taken_layers));
      const validInputs = hash(set.painting_sha256) && set.inputs.every(row => object(row) &&
        (row.run === 'full' || row.run === 'head') && typeof row.file === 'string' && hash(row.sha256) &&
        Array.isArray(row.layers) && row.layers.every(layer => object(layer) && typeof layer.layer === 'string' &&
          (layer.image === null || typeof layer.image === 'string')));
      const validAssets = set.output_assets.every(row => object(row) && typeof row.part === 'string' &&
        (row.image === null || typeof row.image === 'string')) && set.inherited_parts.every(row => object(row) && typeof row.part === 'string' && row.set === null);
      const sources = new Set(set.sources.filter(object).map(source => source.source));
      const expectedSets = [null, ...(file?.alternates ?? []).map(alternate => alternate.name)];
      if (!validSources || sources.size !== set.sources.length || !validInputs || !validAssets ||
          (file !== undefined && (!expectedSets.includes(set.set as string | null) || JSON.stringify(set.grid) !== JSON.stringify(file.rig_size)))) {
        refuse('PARTS_CHECK_REPORT', 'source_cover.json set', canonical(set), 'unique complete source identities, inputs, assets and matching rig grid', 'source-cover bindings are malformed');
        continue;
      }
      if (!unique(set.parts.filter(object).map(part => part.part))) {
        refuse('PARTS_CHECK_REPORT', 'source_cover.json set', set.parts.filter(object).map(part => part.part), 'unique part membership', 'source-cover part names repeat');
      }
      if (file !== undefined && set.set === null && JSON.stringify(canonical(set.output_assets)) !==
          JSON.stringify(canonical(file.parts.map(part => ({ part: part.name, image: `${part.name}.png` }))))) {
        refuse('PARTS_CHECK_REPORT', 'source_cover.json output_assets', canonical(set.output_assets), file.parts.map(part => part.name), 'primary asset membership disagrees with parts.json');
      }
      for (const part of set.parts) {
        if (!object(part) || typeof part.part !== 'string' || !sources.has(part.source) || !count(part.support_px) ||
            !count(part.held_under_cover_px) || part.held_under_cover_px > part.support_px || !Array.isArray(part.covered_by)) {
          refuse('PARTS_CHECK_REPORT', 'source_cover.json part', canonical(part), 'named part with source and support counts', 'part membership is malformed');
          continue;
        }
        let covered = 0;
        for (const owner of part.covered_by) {
          const identity = object(owner) ? set.sources.filter(object).find(source => source.source === owner.source) : undefined;
          if (!object(owner) || typeof owner.source !== 'string' || !sources.has(owner.source) || typeof owner.planned !== 'boolean' ||
              owner.planned !== (Number(identity?.plan_rank) >= 0) || !pixels(owner.pixels, set.grid)) {
            refuse('PARTS_CHECK_REPORT', `part "${part.part}"`, canonical(owner), 'known owner, boolean planned, counted in-grid spans', 'source-cover owner is malformed');
          } else if (!owner.planned && object(owner.pixels)) {
            covered += owner.pixels.count as number;
            reported.push({ code: 'PARTS_UNPLANNED_SOURCE_COVER', set: set.set as string | null, part: part.part,
              source: owner.source, count: owner.pixels.count as number, spans: owner.pixels.spans as unknown[] });
          } else if (object(owner.pixels)) {
            covered += owner.pixels.count as number;
          }
        }
        if (covered + part.held_under_cover_px > part.support_px) {
          refuse('PARTS_CHECK_REPORT', `part "${part.part}"`, covered + part.held_under_cover_px, part.support_px, 'covered and held support exceeds own support');
        }
      }
    }
    if (Array.isArray(cover.sets) && file !== undefined) {
      const sets = cover.sets.filter(object).map(set => set.set);
      const expected = [null, ...(file.alternates ?? []).map(set => set.name)];
      if (!unique(sets) || JSON.stringify(sets) !== JSON.stringify(expected)) {
        refuse('PARTS_CHECK_REPORT', 'source_cover.json', sets, expected, 'source-cover sets must match assembled set order and membership');
      }
    }
  }
  const allocation = readReport('painting_allocation.json', 'rig-parts-painting-allocation/1');
  const allocations: unknown[] = [];
  if (before.find(row => row.path === 'painting_allocation.json')?.status === 'absent') {
    hole('PARTS_PAINTING_ALLOCATION', 'painting_allocation.json', 'painting_allocation.json is absent; painting-edge transfer membership is unavailable');
  }
  const validateAllocation = (name: string, value: Record<string, unknown>): void => {
    if (value.code !== 'PAINTING_EDGE_COVERAGE_TRANSFER' || value.stage !== 'paintingEdges after piece guarding and restoration' ||
      typeof value.supplier !== 'string' || !object(value.refused) || !Object.values(value.refused).every(count) ||
      !Array.isArray(value.lineage) || !count(value.fallbackHeld) || !grid(value.grid) ||
      (file !== undefined && JSON.stringify(value.grid) !== JSON.stringify(file.rig_size)) ||
      !Array.isArray(value.coverageTransfers) || value.coverageTransfers.some(row =>
      !object(row) || typeof row.front !== 'string' || typeof row.receiver !== 'string' || typeof row.owner !== 'string' || !pixels(row.pixels, value.grid as [number, number]))) {
      refuse('PARTS_CHECK_REPORT', name, canonical(value), 'grid and named coverageTransfers with counted spans', 'allocation membership is malformed');
    } else allocations.push({ path: name, report: canonical(value) });
  };
  if (allocation !== null) {
    validateAllocation('painting_allocation.json', allocation);
    if (!strings(allocation.written_reports) || !unique(allocation.written_reports) || allocation.written_reports.some(name =>
      !/^painting_allocation\.[^/\\]+\.json$/.test(name) || (file !== undefined && !(file.alternates ?? []).some(set => name === `painting_allocation.${encodeURIComponent(set.name)}.json`)))) {
      refuse('PARTS_CHECK_REPORT', 'painting_allocation.json', allocation.written_reports ?? null, 'written_reports containing sibling allocation filenames', 'alternate report inventory is malformed');
    } else for (const name of allocation.written_reports) {
      requiredPaths.add(name);
      if (!before.some(row => row.path === name)) before.push({ path: name, status: 'missing', sha256: null });
      const value = readReport(name, 'rig-parts-painting-allocation/1');
      if (value !== null) {
        if (typeof value.set !== 'string' || name !== `painting_allocation.${encodeURIComponent(value.set)}.json`) {
          refuse('PARTS_CHECK_REPORT', name, value.set ?? null, 'matching alternate-set identity', 'alternate report set disagrees with its inventory filename');
        }
        validateAllocation(name, value);
      }
    }
  }
  before.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const report: PartsCheckReport = {
    spec: PARTS_CHECK_SPEC, stage: 'parts', inputs: before,
    parts: { primary: file?.parts.map(part => part.name) ?? [], alternates: canonical(file?.alternates ?? []) as unknown[],
      source_cover: canonical(cover), painting_allocation: allocations },
    refusals, reported, holes, exit_code: refusals.length === 0 ? 0 : 1,
  };
  if (JSON.stringify(before) !== JSON.stringify(inventory(false))) {
    fatal('PARTS_CHECK_INPUT_CHANGED', '--parts', 'input inventory changed during the read; no report was published');
  }
  let created = false;
  try {
    mkdirSync(out, { recursive: true });
    created = true;
    writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    if (JSON.stringify(before) !== JSON.stringify(inventory(false))) {
      fatal('PARTS_CHECK_INPUT_CHANGED', '--parts', 'input inventory changed before publication; no report was published');
    }
    renameSync(temporary, destination);
  } catch (error) {
    if (created && existsSync(temporary)) rmSync(temporary);
    if (error instanceof PartsError) throw error;
    fatal('PARTS_CHECK_PUBLISH', '--out', `could not publish ${PARTS_CHECK_FILE}; ${error instanceof Error ? error.message.replaceAll(out, '--out') : String(error)}`);
  }
  for (const refusal of refusals) log(failLine(refusal));
  for (const row of reported) log(`${row.code}: REPORTED part "${row.part}" — ${row.source}, ${row.count} px`);
  for (const row of holes) log(row.line);
  return report;
}
