import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, posix, resolve, win32 } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { PartsError, refuseIfAny, type Problem } from './errors.ts';
import { OPAQUE_ALPHA_ABOVE } from './layers.ts';
import { readBinaryMask } from './maskvalues.ts';
import { FIGURE_MASK_FILE, partImageReference, readPartsManifest, type PartsFile } from './parts.ts';
import { connectedComponents } from './raster/components.ts';
import { decodePngBytes } from './raster/png.ts';
import type { Raster } from './raster/types.ts';

const SPEC = 'rig-parts-plate-components/1';
const MANIFEST_FIELDS = ['spec', 'parts_dir', 'painting_sha256', 'figure_mask_sha256', 'parts_manifest_sha256', 'components'];

function sourceFailure(object: string, detail: string): never {
  throw new PartsError([{ code: 'PLATE_COMPONENT_SOURCE', object, detail }]);
}

function readSource<T>(object: string, want: string, read: () => T): T {
  try { return read(); }
  catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' | ');
    return sourceFailure(object, `${want} required (${message})`);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonObject(bytes: Uint8Array, path: string): Record<string, unknown> {
  const value: unknown = readSource(path, 'valid UTF-8 JSON', () =>
    JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)));
  if (!record(value)) sourceFailure(path, 'a JSON object is required');
  return value;
}

function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function checkDigest(object: string, actual: string, expected: unknown, field: string): void {
  if (actual !== expected) sourceFailure(object, `sha256 is ${actual}; ${field} requires ${JSON.stringify(expected)}`);
}

function relativePath(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !/[\\\0]/.test(value) &&
    !posix.isAbsolute(value) && win32.parse(value).root === '';
}

function assembleOutputs(stampPath: string, paintingSha: string): Map<string, string> {
  const stamp = jsonObject(readSource(stampPath, 'readable assemble run.json', () => readFileSync(stampPath)), stampPath);
  if (stamp.spec !== 'rig-run/1' || stamp.command !== 'assemble') {
    sourceFailure(stampPath, `spec is ${JSON.stringify(stamp.spec)}, command is ${JSON.stringify(stamp.command)}; rig-run/1 assemble is required`);
  }
  if (!Array.isArray(stamp.inputs) || !Array.isArray(stamp.outputs)) {
    sourceFailure(stampPath, 'assemble inputs and outputs arrays are required');
  }
  const inputs: unknown[] = stamp.inputs;
  const sources = inputs.filter((entry): entry is Record<string, unknown> => record(entry) && entry.role === 'source');
  if (sources.length !== 1) sourceFailure(stampPath, `found ${sources.length} inputs with role "source"; exactly one is required`);
  checkDigest(stampPath, paintingSha, sources[0].sha256, 'the assemble source input');

  const rows: unknown[] = stamp.outputs;
  const outputs = new Map<string, string>();
  for (const [i, entry] of rows.entries()) {
    if (!record(entry) || !relativePath(entry.path) || entry.path === '.' || entry.path === '..' || entry.path.startsWith('../') ||
        entry.path.endsWith('/') || posix.normalize(entry.path) !== entry.path || !digest(entry.sha256)) {
      sourceFailure(stampPath, `outputs[${i}] is ${JSON.stringify(entry)}; a canonical run-relative path and lowercase SHA-256 are required`);
    }
    if (outputs.has(entry.path)) sourceFailure(stampPath, `outputs repeats ${JSON.stringify(entry.path)}; exactly one entry per path is required`);
    outputs.set(entry.path, entry.sha256);
  }
  return outputs;
}

function decode(bytes: Uint8Array, path: string): Raster {
  return readSource(path, 'decodable PNG', () => decodePngBytes(bytes, path));
}

function checkGrid(object: string, actualW: number, actualH: number, width: number, height: number, frame: string): void {
  if (actualW !== width || actualH !== height) {
    sourceFailure(object, `is ${actualW}x${actualH}; ${frame} requires ${width}x${height}`);
  }
}

function readBoundParts(path: string, bytes: Uint8Array): PartsFile {
  const bound = jsonObject(bytes, path);
  // The shared validator reads by path and returns the parsed object unchanged.
  // Compare that validated value with the hashed snapshot before using any field.
  const checked = readSource(path, 'valid parts.json', () => readPartsManifest(path));
  if (!isDeepStrictEqual(checked, bound)) sourceFailure(path, 'changed between the stamped byte read and manifest validation; re-run assemble');
  return checked;
}

interface Component {
  id: string;
  indices: number[];
}

function classify(path: string, labels: readonly unknown[], width: number, height: number, inside: Uint8Array, uncovered: Uint8Array): Component[] {
  const { labels: regions, stats } = connectedComponents({ width, height, data: uncovered }, 8);
  const indicesByLabel: number[][] = stats.map(() => []);
  for (let i = 0; i < regions.length; i++) {
    if (regions[i] !== 0) indicesByLabel[regions[i]].push(i);
  }
  const components = stats.slice(1).map(({ label, left, top, width, height, area }) => {
    const indices = indicesByLabel[label];
    // The row-major scan produces ascending indices. JSON is ASCII for this integer array.
    return { id: sha256(JSON.stringify(indices)), indices, box: [left, top, width, height], area };
  }).sort((a, b) => a.indices[0] - b.indices[0]);
  const known = new Set(components.map(component => component.id));
  const roles = new Map<string, 'background-prop' | 'figure-accessory'>();
  const seen = new Set<string>();
  const problems: Problem[] = [];
  const issue = (object: string, detail: string): void => { problems.push({ code: 'PLATE_COMPONENT_ROLE', object, detail }); };
  for (const [i, row] of labels.entries()) {
    const at = `${path} components[${i}]`;
    if (!record(row) || Object.keys(row).some(key => key !== 'id' && key !== 'role')) {
      sourceFailure(at, `is ${JSON.stringify(row)}; a component object with id and role fields is required`);
    }
    if (!digest(row.id) || !known.has(row.id)) {
      issue(at, `unknown component ID ${JSON.stringify(row.id) ?? 'absent'}; an inventoried SHA-256 ID is required`);
      continue;
    }
    if (seen.has(row.id)) {
      issue(at, `duplicate component ID ${row.id}; exactly one label is required`);
      roles.delete(row.id);
    } else if (row.role !== 'background-prop' && row.role !== 'figure-accessory') {
      issue(at, `component ${row.id} has role ${JSON.stringify(row.role) ?? 'absent'}; "background-prop" or "figure-accessory" is required`);
    } else {
      roles.set(row.id, row.role);
    }
    seen.add(row.id);
  }
  const missing = components.filter(component => !roles.has(component.id));
  for (const { id, box, area } of missing) {
    issue(path, `component ${id} needs one valid role; painting box [x,y,w,h] ${JSON.stringify(box)}, ${area} px`);
  }
  if (problems.length > 0) {
    for (const { id, box, area } of components) {
      if (roles.has(id)) issue(path, `component ${id}: painting box [x,y,w,h] ${JSON.stringify(box)}, ${area} px`);
    }
    issue(path, `assign one role per component in the manifest: "components": ${JSON.stringify(components.map(({ id }) => ({ id, role: '' })))}`);
  }
  refuseIfAny(problems);

  const props: Component[] = [];
  for (const { id, indices } of components) {
    if (roles.get(id) !== 'background-prop') continue;
    for (const i of indices) inside[i] = 0;
    props.push({ id, indices });
  }
  return props;
}

/** Read the primary painting's scene mask, withholding explicitly labeled background props. */
export function readClassifiedPlateMask(manifestPath: string, width: number, height: number, paintingBytes: Uint8Array | undefined): {
  width: number;
  height: number;
  inside: Uint8Array;
  classification: { manifest_sha256: string; props: Component[] };
} {
  const declarationBytes = readSource(manifestPath, 'readable component manifest', () => readFileSync(manifestPath));
  const declaration = jsonObject(declarationBytes, manifestPath);
  const extra = Object.keys(declaration).filter(key => !MANIFEST_FIELDS.includes(key));
  const missing = MANIFEST_FIELDS.filter(key => !Object.hasOwn(declaration, key));
  if (extra.length > 0 || missing.length > 0) {
    sourceFailure(manifestPath, `unknown fields ${JSON.stringify(extra)}, missing fields ${JSON.stringify(missing)}; requires ${MANIFEST_FIELDS.join(', ')}`);
  }
  if (declaration.spec !== SPEC) sourceFailure(manifestPath, `spec is ${JSON.stringify(declaration.spec)}; ${SPEC} is required`);
  if (!relativePath(declaration.parts_dir)) {
    sourceFailure(manifestPath, `parts_dir is ${JSON.stringify(declaration.parts_dir)}; a directory path relative to the manifest is required`);
  }
  for (const key of ['painting_sha256', 'figure_mask_sha256', 'parts_manifest_sha256']) {
    if (!digest(declaration[key])) sourceFailure(manifestPath, `${key} is ${JSON.stringify(declaration[key])}; a lowercase SHA-256 is required`);
  }
  if (!Array.isArray(declaration.components)) sourceFailure(manifestPath, 'components must be an array of {id, role} objects');
  if (paintingBytes === undefined) sourceFailure(manifestPath, 'painting bytes are absent; the original assemble source PNG is required');
  const painting = Uint8Array.from(paintingBytes);
  const paintingSha = sha256(painting);
  checkDigest(manifestPath, paintingSha, declaration.painting_sha256, 'painting_sha256');
  const native = decode(painting, 'source painting');
  checkGrid('source painting', native.width, native.height, width, height, 'the requested painting grid');

  const requestedDir = resolve(dirname(manifestPath), declaration.parts_dir);
  const partsDir = readSource(requestedDir, 'accessible parts_dir', () => realpathSync(requestedDir));
  const stampPath = join(dirname(partsDir), 'run.json');
  const outputs = assembleOutputs(stampPath, paintingSha);
  const stamped = (key: string, manifestSha?: unknown, field?: string): Uint8Array => {
    const path = join(partsDir, key);
    const stampKey = `${basename(partsDir)}/${key}`;
    if (!outputs.has(stampKey)) sourceFailure(stampPath, `outputs is missing ${JSON.stringify(stampKey)}; exactly one entry is required`);
    const bytes = readSource(path, 'readable assemble output', () => readFileSync(path));
    const actual = sha256(bytes);
    checkDigest(path, actual, outputs.get(stampKey), `the assemble output ${JSON.stringify(stampKey)}`);
    if (field !== undefined) checkDigest(path, actual, manifestSha, field);
    return bytes;
  };

  const partsPath = join(partsDir, 'parts.json');
  const parts = readBoundParts(partsPath, stamped('parts.json', declaration.parts_manifest_sha256, 'parts_manifest_sha256'));
  const [W, H] = parts.rig_size;
  const scale = parts.scale_rig_per_source;
  checkGrid(partsPath, W, H, Math.trunc(width * scale), Math.trunc(height * scale), `painting grid ${width}x${height} at scale ${scale}`);
  // Assemble removes the single-run margins while warping layers onto rig_size.
  if (parts.single_run_pad !== undefined) {
    checkGrid(`${partsPath} single_run_pad.file_size`, ...parts.single_run_pad.file_size, width, height, 'the native painting grid');
  }
  const scene = parts.scene;
  if (scene === undefined) sourceFailure(partsPath, `missing scene.figure_mask; assemble with config.scene to emit ${FIGURE_MASK_FILE}`);
  if (scene.figure_alpha_above !== OPAQUE_ALPHA_ABOVE) {
    sourceFailure(partsPath, `scene.figure_alpha_above is ${scene.figure_alpha_above}; ${OPAQUE_ALPHA_ABOVE} is required`);
  }
  const figurePath = join(partsDir, FIGURE_MASK_FILE);
  const figure = decode(stamped(FIGURE_MASK_FILE, declaration.figure_mask_sha256, 'figure_mask_sha256'), figurePath);
  checkGrid(figurePath, figure.width, figure.height, W, H, 'parts.json rig_size');
  const rigInside = readBinaryMask(figure, detail => sourceFailure(figurePath, detail));
  const figurePx = rigInside.reduce((sum, cell) => sum + cell, 0);
  if (figurePx !== scene.figure_px) sourceFailure(figurePath, `has ${figurePx} white px; parts.json scene.figure_px requires ${scene.figure_px}`);

  const coverage = new Uint8Array(W * H);
  for (const part of parts.parts) {
    const { x, y, w, h } = part;
    const { path: key } = partImageReference(part);
    const path = join(partsDir, key);
    const image = decode(stamped(key), path);
    checkGrid(path, image.width, image.height, w, h, 'the part box in parts.json');
    for (let row = 0; row < h; row++) {
      const ry = y + row;
      if (ry < 0 || ry >= H) continue;
      for (let col = 0; col < w; col++) {
        const rx = x + col;
        if (rx < 0 || rx >= W) continue;
        if (image.data[(row * w + col) * 4 + 3] > OPAQUE_ALPHA_ABOVE) coverage[ry * W + rx] = 1;
      }
    }
  }
  for (const alternate of parts.alternates ?? []) {
    for (const part of alternate.records) {
      const { path } = partImageReference(part, alternate.name);
      const image = decode(stamped(path), join(partsDir, path));
      checkGrid(path, image.width, image.height, part.w, part.h, 'the alternate part box in parts.json');
    }
  }

  const inside = new Uint8Array(width * height);
  const uncovered = new Uint8Array(inside.length);
  // Same inverse pixel-centre map as assemble.cutFillMask. Both masks sample
  // the same rig pixel, using actual dimensions after scale truncation.
  const rigX = Array.from({ length: width }, (_, x) => Math.min(W - 1, Math.floor((x + 0.5) * W / width)));
  for (let y = 0; y < height; y++) {
    const rigRow = Math.min(H - 1, Math.floor((y + 0.5) * H / height)) * W;
    for (let x = 0; x < width; x++) {
      const src = y * width + x;
      const rig = rigRow + rigX[x];
      inside[src] = rigInside[rig];
      if (inside[src] === 1 && coverage[rig] === 0) uncovered[src] = 1;
    }
  }
  if (!inside.includes(1)) sourceFailure(figurePath, 'holds no figure pixel on the native painting grid; a nonempty scene figure is required');
  const props = classify(manifestPath, declaration.components, width, height, inside, uncovered);
  return { width, height, inside, classification: { manifest_sha256: sha256(declarationBytes), props } };
}
