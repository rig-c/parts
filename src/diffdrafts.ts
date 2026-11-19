/** Draft-to-draft difference report between two assemble or build outputs (issue #1369). */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PartsError, type Problem } from './errors.ts';
import { partImageReference, readParts, type PartRecord, type PartsFile } from './parts.ts';
import { decodePngBytes } from './raster/png.ts';
import type { Raster } from './raster/types.ts';

export const DIFF_DRAFTS_SPEC = 'rig-parts-draft-diff/1';

export interface DiffDraftSideSummary {
  parts_sha256: string;
  part_count: number;
}

export interface DiffDraftBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiffDraftBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiffDraftPixels {
  changed_px: number;
  colour_px: number;
  alpha_px: number;
  bounds: DiffDraftBounds | null;
}

export interface DiffDraftPartSide {
  sha256: string;
  box: DiffDraftBox;
  index: number;
}

export type DiffDraftPartStatus = 'same' | 'changed' | 'added' | 'removed';

export interface DiffDraftPart {
  name: string;
  status: DiffDraftPartStatus;
  left?: DiffDraftPartSide;
  right?: DiffDraftPartSide;
  pixels_equal?: boolean;
  pixels?: DiffDraftPixels;
}

export interface DiffDraftsSummary {
  same: number;
  changed: number;
  added: number;
  removed: number;
}

export interface DiffDraftsReport {
  spec: typeof DIFF_DRAFTS_SPEC;
  left: DiffDraftSideSummary;
  right: DiffDraftSideSummary;
  canvas: { width: number; height: number };
  order: 'same' | 'changed';
  parts: DiffDraftPart[];
  composite: DiffDraftPixels;
  summary: DiffDraftsSummary;
}

export interface DiffDraftPartInput {
  record: Pick<PartRecord, 'name' | 'x' | 'y' | 'w' | 'h'>;
  sha256: string;
  image: Raster;
}

export interface DiffDraftSideInput {
  partsSha256: string;
  rigSize: readonly [number, number];
  parts: readonly DiffDraftPartInput[];
  recomposite: Raster;
}

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function physicalPath(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(physicalPath(parent), relative(parent, absolute));
}

function withinPath(parent: string, target: string): boolean {
  const rel = relative(parent, target);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

function pathExistsOrLink(path: string): boolean {
  if (existsSync(path)) return true;
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** True when the two decoded part crops have identical dimensions and identical RGBA bytes at every position. */
export function cropPixelsEqual(a: Raster, b: Raster): boolean {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

/** Compare two rasters in rig-pixel space over the union of their boxes; positions outside a box count as RGBA 0,0,0,0. */
export function compareRigPixels(leftBox: DiffDraftBox, leftImage: Raster, rightBox: DiffDraftBox, rightImage: Raster): DiffDraftPixels {
  const x0 = Math.min(leftBox.x, rightBox.x);
  const y0 = Math.min(leftBox.y, rightBox.y);
  const x1 = Math.max(leftBox.x + leftBox.w, rightBox.x + rightBox.w);
  const y1 = Math.max(leftBox.y + leftBox.h, rightBox.y + rightBox.h);
  let changedPx = 0;
  let colourPx = 0;
  let alphaPx = 0;
  let minX = x1;
  let minY = y1;
  let maxX = x0 - 1;
  let maxY = y0 - 1;
  for (let y = y0; y < y1; y++) {
    const inLeftY = y >= leftBox.y && y < leftBox.y + leftBox.h;
    const inRightY = y >= rightBox.y && y < rightBox.y + rightBox.h;
    for (let x = x0; x < x1; x++) {
      let lR = 0, lG = 0, lB = 0, lA = 0;
      if (inLeftY && x >= leftBox.x && x < leftBox.x + leftBox.w) {
        const li = ((y - leftBox.y) * leftBox.w + (x - leftBox.x)) * 4;
        lR = leftImage.data[li];
        lG = leftImage.data[li + 1];
        lB = leftImage.data[li + 2];
        lA = leftImage.data[li + 3];
      }
      let rR = 0, rG = 0, rB = 0, rA = 0;
      if (inRightY && x >= rightBox.x && x < rightBox.x + rightBox.w) {
        const ri = ((y - rightBox.y) * rightBox.w + (x - rightBox.x)) * 4;
        rR = rightImage.data[ri];
        rG = rightImage.data[ri + 1];
        rB = rightImage.data[ri + 2];
        rA = rightImage.data[ri + 3];
      }
      const colourDiff = lR !== rR || lG !== rG || lB !== rB;
      const alphaDiff = lA !== rA;
      if (colourDiff) colourPx++;
      if (alphaDiff) alphaPx++;
      if (colourDiff || alphaDiff) {
        changedPx++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return {
    changed_px: changedPx,
    colour_px: colourPx,
    alpha_px: alphaPx,
    bounds: changedPx === 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  };
}

function validateSideInput(side: DiffDraftSideInput, label: 'left' | 'right', problems: Problem[]): void {
  const [W, H] = side.rigSize;
  if (!Number.isSafeInteger(W) || !Number.isSafeInteger(H) || W < 1 || H < 1) {
    problems.push({
      code: 'DIFF_DRAFTS_INPUT',
      object: `${label}.rig_size`,
      detail: `is ${JSON.stringify(side.rigSize)}; a pair of positive integer canvas dimensions [width, height] is required`,
    });
    return;
  }
  if (!/^[a-f0-9]{64}$/.test(side.partsSha256)) {
    problems.push({
      code: 'DIFF_DRAFTS_INPUT',
      object: `${label}.parts_sha256`,
      detail: `is ${JSON.stringify(side.partsSha256)}; 64 lowercase hex characters are required`,
    });
  }
  if (side.recomposite.width !== W || side.recomposite.height !== H || side.recomposite.data.length < W * H * 4) {
    problems.push({
      code: 'DIFF_DRAFTS_INPUT',
      object: `${label} recomposite_rig.png`,
      detail: `is ${side.recomposite.width}x${side.recomposite.height} with ${side.recomposite.data.length} RGBA bytes; ${W}x${H} matching rig_size is required`,
    });
  }
  const seen = new Set<string>();
  for (const entry of side.parts) {
    const p = entry.record;
    const dup = seen.has(p.name);
    if (
      !p.name ||
      dup ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      ![p.x, p.y, p.w, p.h].every(Number.isSafeInteger) ||
      p.x < 0 ||
      p.y < 0 ||
      p.w < 1 ||
      p.h < 1 ||
      p.x + p.w > W ||
      p.y + p.h > H ||
      entry.image.width !== p.w ||
      entry.image.height !== p.h ||
      entry.image.data.length < p.w * p.h * 4
    ) {
      problems.push({
        code: 'DIFF_DRAFTS_INPUT',
        object: `${label} part "${p.name}"`,
        detail: `box ${p.x},${p.y} ${p.w}x${p.h}, image ${entry.image.width}x${entry.image.height} with ${entry.image.data.length} RGBA bytes, sha256 ${JSON.stringify(entry.sha256)}, duplicate name ${dup}; a unique nonempty name, 64-hex sha256 and an in-canvas matching box on ${W}x${H} are required`,
      });
    }
    seen.add(p.name);
  }
}

/** Pure measurement over two already-read assemble outputs. */
export function measureDiffDrafts(left: DiffDraftSideInput, right: DiffDraftSideInput): DiffDraftsReport {
  const problems: Problem[] = [];
  validateSideInput(left, 'left', problems);
  validateSideInput(right, 'right', problems);
  if (
    Number.isSafeInteger(left.rigSize[0]) &&
    Number.isSafeInteger(left.rigSize[1]) &&
    Number.isSafeInteger(right.rigSize[0]) &&
    Number.isSafeInteger(right.rigSize[1]) &&
    (left.rigSize[0] !== right.rigSize[0] || left.rigSize[1] !== right.rigSize[1])
  ) {
    problems.push({
      code: 'DIFF_DRAFTS_CANVAS',
      object: 'canvas',
      detail: `left is ${left.rigSize[0]}x${left.rigSize[1]} and right is ${right.rigSize[0]}x${right.rigSize[1]}; identical rig_size dimensions are required because the two outputs are not drafts of one rig`,
    });
  }
  if (problems.length > 0) throw new PartsError(problems);

  const [W, H] = left.rigSize;
  const order: 'same' | 'changed' =
    left.parts.length === right.parts.length && left.parts.every((p, i) => p.record.name === right.parts[i].record.name)
      ? 'same'
      : 'changed';

  const leftByName = new Map<string, { entry: DiffDraftPartInput; side: DiffDraftPartSide }>();
  left.parts.forEach((entry, index) => {
    const { x, y, w, h } = entry.record;
    leftByName.set(entry.record.name, { entry, side: { sha256: entry.sha256, box: { x, y, w, h }, index } });
  });

  const rightByName = new Map<string, { entry: DiffDraftPartInput; side: DiffDraftPartSide }>();
  right.parts.forEach((entry, index) => {
    const { x, y, w, h } = entry.record;
    rightByName.set(entry.record.name, { entry, side: { sha256: entry.sha256, box: { x, y, w, h }, index } });
  });

  const names = [...new Set([...leftByName.keys(), ...rightByName.keys()])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const summary: DiffDraftsSummary = { same: 0, changed: 0, added: 0, removed: 0 };
  const parts: DiffDraftPart[] = [];

  for (const name of names) {
    const l = leftByName.get(name);
    const r = rightByName.get(name);
    if (l === undefined && r !== undefined) {
      summary.added++;
      parts.push({ name, status: 'added', right: r.side });
      continue;
    }
    if (l !== undefined && r === undefined) {
      summary.removed++;
      parts.push({ name, status: 'removed', left: l.side });
      continue;
    }
    const leftSide = l!.side;
    const rightSide = r!.side;
    const sameBox =
      leftSide.box.x === rightSide.box.x &&
      leftSide.box.y === rightSide.box.y &&
      leftSide.box.w === rightSide.box.w &&
      leftSide.box.h === rightSide.box.h;
    if (leftSide.sha256 === rightSide.sha256 && sameBox) {
      summary.same++;
      parts.push({ name, status: 'same', left: leftSide, right: rightSide });
    } else {
      summary.changed++;
      parts.push({
        name,
        status: 'changed',
        left: leftSide,
        right: rightSide,
        pixels_equal: cropPixelsEqual(l!.entry.image, r!.entry.image),
        pixels: compareRigPixels(leftSide.box, l!.entry.image, rightSide.box, r!.entry.image),
      });
    }
  }

  const canvasBox: DiffDraftBox = { x: 0, y: 0, w: W, h: H };
  const composite = compareRigPixels(canvasBox, left.recomposite, canvasBox, right.recomposite);

  return {
    spec: DIFF_DRAFTS_SPEC,
    left: { parts_sha256: left.partsSha256, part_count: left.parts.length },
    right: { parts_sha256: right.partsSha256, part_count: right.parts.length },
    canvas: { width: W, height: H },
    order,
    parts,
    composite,
    summary,
  };
}

export function serializeDiffDrafts(report: DiffDraftsReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

interface ResolvedDraftLayout {
  partsJsonPath: string;
  partsBaseDir: string;
  recompositePath: string;
  recompositeLabel: string;
}

function resolveDraftLayout(dir: string, flag: '--left' | '--right', problems: Problem[]): ResolvedDraftLayout | null {
  if (!isDirectory(dir)) {
    problems.push({
      code: 'DIFF_DRAFTS_INPUT',
      object: flag,
      detail: `${dir} is not a directory; an assemble or build output directory holding parts.json or rig/parts.json is required`,
    });
    return null;
  }
  const buildManifest = join(dir, 'parts.json');
  const assembleManifest = join(dir, 'rig', 'parts.json');
  const hasBuild = isRegularFile(buildManifest);
  const hasAssemble = isRegularFile(assembleManifest);
  if (!hasBuild && !hasAssemble) {
    problems.push({
      code: 'DIFF_DRAFTS_INPUT',
      object: flag,
      detail: `${dir} holds neither parts.json (build layout) nor rig/parts.json (assemble layout); an assemble or build output directory is required`,
    });
    return null;
  }
  if (hasBuild && hasAssemble) {
    problems.push({
      code: 'DIFF_DRAFTS_INPUT',
      object: flag,
      detail: `${dir} holds both parts.json and rig/parts.json; a single assemble or build output layout is required`,
    });
    return null;
  }
  return hasBuild
    ? {
        partsJsonPath: buildManifest,
        partsBaseDir: dir,
        recompositePath: join(dir, 'recomposite_rig.png'),
        recompositeLabel: 'recomposite_rig.png',
      }
    : {
        partsJsonPath: assembleManifest,
        partsBaseDir: join(dir, 'rig'),
        recompositePath: join(dir, 'render', 'recomposite_rig.png'),
        recompositeLabel: 'render/recomposite_rig.png',
      };
}

function readSideDirectory(dir: string, flag: '--left' | '--right', problems: Problem[]): { partsFile: PartsFile | null; input: DiffDraftSideInput | null } {
  const layout = resolveDraftLayout(dir, flag, problems);
  if (layout === null) return { partsFile: null, input: null };

  let partsBytes: Uint8Array | null = null;
  try {
    partsBytes = new Uint8Array(readFileSync(layout.partsJsonPath));
  } catch (err) {
    problems.push({
      code: 'DIFF_DRAFTS_INPUT',
      object: `${flag} parts.json`,
      detail: `cannot read ${layout.partsJsonPath}: ${JSON.stringify(err instanceof Error ? err.message : err)}; readable parts.json bytes are required`,
    });
  }

  let partsFile: PartsFile | null = null;
  try {
    partsFile = readParts(layout.partsJsonPath);
  } catch (err) {
    if (err instanceof PartsError) problems.push(...err.problems);
    else {
      problems.push({
        code: 'DIFF_DRAFTS_INPUT',
        object: `${flag} parts.json`,
        detail: `cannot parse ${layout.partsJsonPath}: ${JSON.stringify(err instanceof Error ? err.message : err)}; a valid parts.json is required`,
      });
    }
  }

  let recomposite: Raster | null = null;
  if (!isRegularFile(layout.recompositePath)) {
    problems.push({
      code: 'DIFF_DRAFTS_INPUT',
      object: `${flag} ${layout.recompositeLabel}`,
      detail: `${layout.recompositePath} is missing; ${layout.recompositeLabel} from the assemble or build output is required`,
    });
  } else {
    try {
      const bytes = new Uint8Array(readFileSync(layout.recompositePath));
      recomposite = decodePngBytes(bytes, layout.recompositePath);
    } catch (err) {
      problems.push({
        code: 'DIFF_DRAFTS_INPUT',
        object: `${flag} ${layout.recompositeLabel}`,
        detail: `cannot decode PNG ${layout.recompositePath}: ${JSON.stringify(err instanceof Error ? err.message : err)}; valid PNG bytes are required`,
      });
    }
  }

  if (partsFile !== null && recomposite !== null) {
    const [W, H] = partsFile.rig_size;
    if (recomposite.width !== W || recomposite.height !== H) {
      problems.push({
        code: 'DIFF_DRAFTS_INPUT',
        object: `${flag} ${layout.recompositeLabel}`,
        detail: `is ${recomposite.width}x${recomposite.height}; parts.json rig_size ${W}x${H} is required`,
      });
    }
  }

  const partInputs: DiffDraftPartInput[] = [];
  if (partsFile !== null) {
    for (const record of partsFile.parts) {
      const rel = partImageReference(record).path;
      const fullPath = join(layout.partsBaseDir, rel);
      if (!isRegularFile(fullPath)) {
        problems.push({
          code: 'DIFF_DRAFTS_INPUT',
          object: `${flag} part "${record.name}"`,
          detail: `${fullPath} is missing; ${rel} matching parts.json is required`,
        });
        continue;
      }
      try {
        const bytes = new Uint8Array(readFileSync(fullPath));
        const image = decodePngBytes(bytes, fullPath);
        if (image.width !== record.w || image.height !== record.h) {
          problems.push({
            code: 'DIFF_DRAFTS_INPUT',
            object: `${flag} part "${record.name}"`,
            detail: `${rel} is ${image.width}x${image.height}; parts.json box ${record.w}x${record.h} is required`,
          });
          continue;
        }
        partInputs.push({ record, sha256: sha256Hex(bytes), image });
      } catch (err) {
        problems.push({
          code: 'DIFF_DRAFTS_INPUT',
          object: `${flag} part "${record.name}"`,
          detail: `cannot decode PNG ${fullPath}: ${JSON.stringify(err instanceof Error ? err.message : err)}; valid PNG bytes are required`,
        });
      }
    }
  }

  if (partsBytes === null || partsFile === null || recomposite === null || partInputs.length !== partsFile.parts.length) {
    return { partsFile, input: null };
  }

  return {
    partsFile,
    input: {
      partsSha256: sha256Hex(partsBytes),
      rigSize: partsFile.rig_size,
      parts: partInputs,
      recomposite,
    },
  };
}

/** CLI adapter: read two assemble or build outputs, refuse any invalid input or output collision once, and write rig-parts-draft-diff/1. */
export function diffDraftsCommand(args: string[]): DiffDraftsReport {
  const allowed = ['--left', '--right', '--out'];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!allowed.includes(key) || flags.has(key) || value === undefined || value.startsWith('--')) {
      throw new PartsError([{ code: 'DIFF_DRAFTS_INPUT', object: 'arguments', detail: `requires unique ${allowed.join(', ')} flags with values; found ${key}` }]);
    }
    if (value.trim().length === 0) {
      throw new PartsError([{ code: 'DIFF_DRAFTS_INPUT', object: key, detail: `is ${JSON.stringify(value)}; a nonempty path is required` }]);
    }
    flags.set(key, value);
  }
  const missing: Problem[] = [];
  for (const key of allowed) {
    if (!flags.has(key)) missing.push({ code: 'DIFF_DRAFTS_INPUT', object: key, detail: 'is missing; an explicit path is required' });
  }
  if (missing.length > 0) throw new PartsError(missing);

  const leftDir = flags.get('--left')!;
  const rightDir = flags.get('--right')!;
  const outPath = flags.get('--out')!;

  const problems: Problem[] = [];
  if (pathExistsOrLink(outPath)) {
    problems.push({
      code: 'DIFF_DRAFTS_OUT',
      object: '--out',
      detail: `${outPath} already exists; a fresh output file path that does not exist is required`,
    });
  }
  const realOut = physicalPath(outPath);
  const realLeft = physicalPath(leftDir);
  const realRight = physicalPath(rightDir);
  if (withinPath(realLeft, realOut)) {
    problems.push({
      code: 'DIFF_DRAFTS_OUT',
      object: '--out',
      detail: `${outPath} is inside --left (${leftDir}); an output file path outside both input directories is required`,
    });
  }
  if (withinPath(realRight, realOut)) {
    problems.push({
      code: 'DIFF_DRAFTS_OUT',
      object: '--out',
      detail: `${outPath} is inside --right (${rightDir}); an output file path outside both input directories is required`,
    });
  }

  const leftLoaded = readSideDirectory(leftDir, '--left', problems);
  const rightLoaded = readSideDirectory(rightDir, '--right', problems);

  if (leftLoaded.partsFile !== null && rightLoaded.partsFile !== null) {
    const [lW, lH] = leftLoaded.partsFile.rig_size;
    const [rW, rH] = rightLoaded.partsFile.rig_size;
    if (lW !== rW || lH !== rH) {
      problems.push({
        code: 'DIFF_DRAFTS_CANVAS',
        object: 'canvas',
        detail: `left is ${lW}x${lH} and right is ${rW}x${rH}; identical rig_size dimensions are required because the two outputs are not drafts of one rig`,
      });
    }
  }

  if (problems.length > 0) throw new PartsError(problems);

  const report = measureDiffDrafts(leftLoaded.input!, rightLoaded.input!);
  try {
    writeFileSync(outPath, serializeDiffDrafts(report), { flag: 'wx' });
  } catch (err) {
    throw new PartsError([
      {
        code: 'DIFF_DRAFTS_OUT',
        object: '--out',
        detail: `cannot write ${outPath}: ${JSON.stringify(err instanceof Error ? err.message : err)}; a fresh writable output file path is required`,
      },
    ]);
  }
  return report;
}
