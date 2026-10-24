/** Immutable accepted-mesh transfer (issue #658). No generator or topology repair runs here. */
import { createHash } from 'node:crypto';
import type { ExplicitMeshSpec } from './config.ts';
import type { Problem } from './errors.ts';
import { ART_ALPHA, artCoverage } from './mesh.ts';
import type { PartRecord } from './parts.ts';
import { alphaAbove, pad } from './raster/index.ts';
import type { Raster } from './raster/types.ts';
import { PAD, type MeshAttachment } from './rig.ts';
import { pyRound } from './round.ts';

/** SHA-256 over unpadded decoded RGBA, with its size bound by explicitRegionHash. */
export function explicitImageHash(image: Raster): string {
  return createHash('sha256').update(image.data).digest('hex');
}

/** The canvas and placed unpadded part rectangle, in the parts reader's field order. */
export function explicitRegionHash(size: readonly number[], part: Pick<PartRecord, 'x' | 'y' | 'w' | 'h'>): string {
  return createHash('sha256').update(JSON.stringify([size[0], size[1], part.x, part.y, part.w, part.h])).digest('hex');
}

export interface ExplicitMeshReport {
  part: string;
  vertices: number;
  triangles: number;
  hull: number;
  bones: string[];
  max_influences: number;
  mean_influences: number;
  art_coverage: number;
  mode: 'explicit';
  image_sha256: string;
  region_sha256: string;
}

/** Guard before constructing output; clone only named payload fields, retaining every supplied number. */
export function explicitAttachment(part: PartRecord, image: Raster, size: readonly number[], spec: ExplicitMeshSpec): { attachment: MeshAttachment; report: ExplicitMeshReport } | Problem[] {
  const input = spec.explicit, problems: Problem[] = [];
  const hashes = { image_sha256: explicitImageHash(image), region_sha256: explicitRegionHash(size, part) };
  for (const [field, code] of [['image_sha256', 'RIG_EXPLICIT_IMAGE_HASH'], ['region_sha256', 'RIG_EXPLICIT_REGION_HASH']] as const) {
    if (input[field] !== hashes[field]) problems.push({ code, object: `config.meshes.${part.name}.explicit.${field}`, detail: `declares ${input[field]}; the current part has ${hashes[field]} — restore the accepted part image and region, or supply its matching accepted payload; nothing is written` });
  }
  if (problems.length > 0) return problems;
  const padded = pad(image, PAD, PAD, PAD, PAD, [0, 0, 0, 0]);
  const weights = input.weights.map(row => row.map(w => ({ bone: w.bone, x: w.x, y: w.y, weight: w.weight })));
  const attachment: MeshAttachment = { type: 'mesh', image: `${part.name}.png`, width: padded.width, height: padded.height, uvs: [...input.uvs], triangles: [...input.triangles], hull: input.hull, weights };
  const vertices: Array<[number, number]> = [];
  for (let i = 0; i < input.uvs.length; i += 2) vertices.push([input.uvs[i] * padded.width, input.uvs[i + 1] * padded.height]);
  return { attachment, report: { part: part.name, vertices: weights.length, triangles: input.triangles.length / 3, hull: input.hull,
    bones: [...new Set(weights.flatMap(row => row.map(w => w.bone)))].sort(), max_influences: weights.reduce((n, row) => Math.max(n, row.length), 0),
    mean_influences: pyRound(weights.reduce((n, row) => n + row.length, 0) / weights.length, 2),
    art_coverage: pyRound(artCoverage({ vertices, triangles: input.triangles }, alphaAbove(padded, ART_ALPHA)), 5), mode: 'explicit', ...hashes } };
}
