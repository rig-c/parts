import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { type AssembleResult, FIGURE_MASK_FILE } from './assemble.ts';
import { ERROR_MAP_FILE } from './build.ts';
import { CUT_MATERIAL_SOURCES } from './cutmaterial.ts';
import { EDGE_RESIDUAL_FILE } from './edgeresidual.ts';
import { PartsError } from './errors.ts';
import { LAYOUT_FILE } from './limblayout.ts';
import { PAINTING_ALLOCATION_FILE } from './paintingedges.ts';
import { PAINTING_IN_RIG_FILE } from './parts.ts';
import { STAGE_MAP_FILE } from './provenance.ts';
import { rigJsonText, type RigOutput, SETS_FILE } from './rig.ts';
import { SOURCE_COVER_FILE } from './sourcecover.ts';
import { SUPPORT_DOMAINS_FILE } from './supportdomains.ts';

export const RUN_STAMP_SPEC = 'rig-run/1' as const;
export const RUN_STAMP_FILE = 'run.json' as const;

export type RunStampCommand = 'rig' | 'assemble';

export interface RunStampPackage {
  name: string;
  version: string;
}

export interface RunStampFileEntry {
  path: string;
  sha256: string;
}

export interface RunStamp {
  spec: typeof RUN_STAMP_SPEC;
  package: RunStampPackage;
  command: RunStampCommand;
  started_at: string;
  finished_at: string;
  config: RunStampFileEntry;
  outputs: RunStampFileEntry[];
}

export interface RunStampInput {
  pkg: RunStampPackage;
  command: RunStampCommand;
  startedAt: string;
  finishedAt: string;
  outDir: string;
  configPath: string;
  outputPaths: readonly string[];
}

function sha256OnDisk(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function relativeToOutRoot(outDir: string, targetPath: string): string {
  const realOut = realpathSync(resolve(outDir));
  const realTarget = realpathSync(resolve(targetPath));
  return relative(realOut, realTarget).split(sep).join('/');
}

function sortCodeUnits(paths: readonly string[]): string[] {
  return [...new Set(paths.filter((p) => p !== RUN_STAMP_FILE))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Remove `<outDir>/run.json` before a stage starts so a refused run never leaves a stale stamp behind. */
export function clearRunStamp(outDir: string): void {
  rmSync(join(outDir, RUN_STAMP_FILE), { force: true });
}

/**
 * Read package `name` and `version` from `package.json`, refusing with `RUN_STAMP_PACKAGE`
 * when the file is missing, invalid JSON, or lacks a non-empty string `name` or `version`.
 */
export function readPackageIdentity(pkgPath: string): RunStampPackage {
  if (!existsSync(pkgPath)) {
    throw new PartsError([{ code: 'RUN_STAMP_PACKAGE', object: pkgPath, detail: 'no such file; a package.json with non-empty string "name" and "version" is required to write run.json' }]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    throw new PartsError([{ code: 'RUN_STAMP_PACKAGE', object: pkgPath, detail: `${(err as Error).message}; valid JSON with non-empty string "name" and "version" is required to write run.json` }]);
  }
  const obj = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  const name = obj !== null && typeof obj.name === 'string' ? obj.name.trim() : '';
  const version = obj !== null && typeof obj.version === 'string' ? obj.version.trim() : '';
  if (name === '' || version === '') {
    const missing = [...(name === '' ? ['name'] : []), ...(version === '' ? ['version'] : [])].join(' and ');
    throw new PartsError([{ code: 'RUN_STAMP_PACKAGE', object: pkgPath, detail: `missing non-empty string ${missing}; both "name" and "version" are required to write run.json` }]);
  }
  return { name, version };
}

/** The exact relative output paths `rigStage` writes under `--out`, derived from its returned `RigOutput`. */
export function rigOutputFiles(rig: RigOutput): string[] {
  return sortCodeUnits([
    'rig.json',
    'motion.json',
    'mesh_report.json',
    ...(rig.depthReferences === undefined ? [] : ['depth_sheets.json']),
    ...(rig.sets === undefined ? [] : [SETS_FILE]),
    ...(rig.layout === undefined ? [] : [LAYOUT_FILE]),
    ...rig.images.map(([file]) => `images/${file}`),
  ]);
}

function writtenAllocationReports(outDir: string): string[] {
  const allocationPath = join(outDir, 'rig', PAINTING_ALLOCATION_FILE);
  if (!existsSync(allocationPath)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(allocationPath, 'utf8'));
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'written_reports' in parsed &&
      Array.isArray(parsed.written_reports)
    ) {
      return parsed.written_reports
        .filter((f): f is string => typeof f === 'string' && f.startsWith('painting_allocation.') && f.endsWith('.json') && basename(f) === f)
        .map((f) => `rig/${f}`);
    }
  } catch {
    return [];
  }
  return [];
}

/** The exact relative output paths `assembleStage` writes under `--out`, derived from its returned `AssembleResult`. */
export function assembleOutputFiles(outDir: string, result: AssembleResult): string[] {
  return sortCodeUnits([
    'rig/parts.json',
    `rig/${PAINTING_IN_RIG_FILE}`,
    `rig/${SOURCE_COVER_FILE}`,
    `rig/${SUPPORT_DOMAINS_FILE}`,
    ...(result.stageMap === undefined ? [] : [`rig/${STAGE_MAP_FILE}`]),
    ...(result.edgeResiduals === undefined ? [] : [`rig/${EDGE_RESIDUAL_FILE}`]),
    ...(result.paintingEdges?.allocation === undefined ? [] : [`rig/${PAINTING_ALLOCATION_FILE}`, ...writtenAllocationReports(outDir)]),
    ...(existsSync(join(outDir, 'rig', CUT_MATERIAL_SOURCES)) ? [`rig/${CUT_MATERIAL_SOURCES}`] : []),
    ...result.parts.parts.flatMap((p) => [`rig/parts/${p.name}.png`, ...(p.depth === undefined ? [] : [`rig/parts/${p.depth.image}`])]),
    ...(result.parts.alternates ?? []).flatMap((alt) =>
      alt.records.flatMap((p) => [`rig/parts/${alt.name}_${p.name}.png`, ...(p.depth === undefined ? [] : [`rig/parts/${p.depth.image}`])]),
    ),
    'render/recomposite_rig.png',
    `render/${ERROR_MAP_FILE}`,
    ...(result.figure === null ? [] : [`render/${FIGURE_MASK_FILE}`, `rig/${FIGURE_MASK_FILE}`]),
  ]);
}

/**
 * Build a `rig-run/1` run stamp from the files actually written by the stage under `outDir`
 * and the config file on disk, using the caller-supplied package metadata and
 * UTC ISO-8601 timestamps. Pure with respect to the clock: no time is read here.
 */
export function buildRunStamp(input: RunStampInput): RunStamp {
  const relPaths = sortCodeUnits(input.outputPaths);
  const outputs: RunStampFileEntry[] = relPaths.map((rel) => ({
    path: rel,
    sha256: sha256OnDisk(join(input.outDir, ...rel.split('/'))),
  }));
  return {
    spec: RUN_STAMP_SPEC,
    package: {
      name: input.pkg.name,
      version: input.pkg.version,
    },
    command: input.command,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    config: {
      path: relativeToOutRoot(input.outDir, input.configPath),
      sha256: sha256OnDisk(input.configPath),
    },
    outputs,
  };
}

/**
 * Format and write `<outDir>/run.json` (`spec: "rig-run/1"`). Called by the CLI
 * only after the command's gate and output writes have succeeded.
 */
export function writeRunStamp(input: RunStampInput): RunStamp {
  const stamp = buildRunStamp(input);
  writeFileSync(join(input.outDir, RUN_STAMP_FILE), rigJsonText(stamp));
  return stamp;
}
