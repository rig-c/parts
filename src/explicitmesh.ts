/** Immutable accepted-mesh transfer (issue #658, #734). No generator or topology repair runs here. */
import { createHash } from 'node:crypto';
import type { ExplicitMeshSpec } from './config.ts';
import type { Problem } from './errors.ts';
import { ART_ALPHA, artCoverage, isDust } from './mesh.ts';
import type { PartRecord } from './parts.ts';
import { alphaAbove, connectedComponents, pad } from './raster/index.ts';
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

export interface ExplicitIslandAttachment {
  slot: string;
  bone: string;
  before?: string;
  attachment: MeshAttachment;
}

/** Guard before constructing output; clone only named payload fields, retaining every supplied number. */
export function explicitAttachment(
  part: PartRecord,
  image: Raster,
  size: readonly number[],
  spec: ExplicitMeshSpec,
): { attachment: MeshAttachment; islandSlots: ExplicitIslandAttachment[]; report: ExplicitMeshReport } | Problem[] {
  const input = spec.explicit, problems: Problem[] = [];
  const hashes = { image_sha256: explicitImageHash(image), region_sha256: explicitRegionHash(size, part) };
  for (const [field, code] of [['image_sha256', 'RIG_EXPLICIT_IMAGE_HASH'], ['region_sha256', 'RIG_EXPLICIT_REGION_HASH']] as const) {
    if (input[field] !== hashes[field]) problems.push({ code, object: `config.meshes.${part.name}.explicit.${field}`, detail: `declares ${input[field]}; the current part has ${hashes[field]} — restore the accepted part image and region, or supply its matching accepted payload; nothing is written` });
  }
  if (problems.length > 0) return problems;
  const comp = connectedComponents(alphaAbove(image, ART_ALPHA), 4);
  const allIslands = comp.stats.slice(1).map((s) => s.area).sort((a, b) => b - a);
  const totalArt = allIslands.reduce((a, b) => a + b, 0);
  const islandAreas = allIslands.filter((n) => n === allIslands[0] || !isDust(n, totalArt));
  const actualCount = islandAreas.length;
  const areaList = islandAreas.map((px) => `${px} px`).join(', ') || '0 px';
  if (input.islands !== undefined) {
    const declaredSlots = input.islands.map((isl) => isl.slot);
    const declaredCount = declaredSlots.length;
    if (declaredCount < actualCount) {
      const missing = Array.from({ length: actualCount - declaredCount }, (_, k) => `"${part.name}__island${declaredCount + k + 1}"`).join(', ');
      return [{
        code: 'RIG_EXPLICIT_ISLAND_COUNT',
        object: `config.meshes.${part.name}.explicit.islands`,
        detail: `declares ${declaredCount} island slot(s) (${declaredSlots.map((s) => `"${s}"`).join(', ')}), but parts/${part.name}.png has ${actualCount} art island(s) (${areaList}); missing ${missing} — nothing is written`,
      }];
    }
    if (declaredCount > actualCount) {
      const extra = declaredSlots.slice(actualCount).map((s) => `"${s}"`).join(', ');
      return [{
        code: 'RIG_EXPLICIT_ISLAND_COUNT',
        object: `config.meshes.${part.name}.explicit.islands`,
        detail: `declares ${declaredCount} island slot(s) (${declaredSlots.map((s) => `"${s}"`).join(', ')}), but parts/${part.name}.png has ${actualCount} art island(s) (${areaList}); extra ${extra} — nothing is written`,
      }];
    }
  } else if (actualCount > 1) {
    const missing = Array.from({ length: actualCount - 1 }, (_, k) => `"${part.name}__island${k + 2}"`).join(', ');
    return [{
      code: 'RIG_EXPLICIT_ISLAND_COUNT',
      object: `config.meshes.${part.name}.explicit`,
      detail: `states 1 slot ("${part.name}"), but parts/${part.name}.png has ${actualCount} art island(s) (${areaList}); missing ${missing} — nothing is written`,
    }];
  }
  const padded = pad(image, PAD, PAD, PAD, PAD, [0, 0, 0, 0]);
  const defaultBone = typeof spec.segments[0] === 'string' ? spec.segments[0] : spec.segments[0][0];
  const entries = input.islands !== undefined
    ? input.islands.map((isl, idx) => ({
        slot: isl.slot,
        bone: isl.bone ?? defaultBone,
        ...(isl.before !== undefined ? { before: isl.before } : {}),
        uvs: isl.uvs,
        triangles: isl.triangles,
        hull: isl.hull,
        weights: isl.weights,
        withPath: idx > 0,
      }))
    : [{
        slot: part.name,
        bone: defaultBone,
        uvs: input.uvs ?? [],
        triangles: input.triangles ?? [],
        hull: input.hull ?? 0,
        weights: input.weights ?? [],
        withPath: false,
      }];
  const allVertices: Array<[number, number]> = [];
  const allTriangles: number[] = [];
  const allWeights: Array<Array<{ bone: string; x: number; y: number; weight: number }>> = [];
  let totalHull = 0;
  const islandSlots: ExplicitIslandAttachment[] = entries.map((e) => {
    const weights = e.weights.map((row) => row.map((w) => ({ bone: w.bone, x: w.x, y: w.y, weight: w.weight })));
    const vOffset = allVertices.length;
    for (let i = 0; i < e.uvs.length; i += 2) allVertices.push([e.uvs[i] * padded.width, e.uvs[i + 1] * padded.height]);
    for (const t of e.triangles) allTriangles.push(vOffset + t);
    allWeights.push(...weights);
    totalHull += e.hull;
    const attachment: MeshAttachment = {
      type: 'mesh',
      ...(e.withPath ? { path: part.name } : {}),
      image: `${part.name}.png`,
      width: padded.width,
      height: padded.height,
      uvs: [...e.uvs],
      triangles: [...e.triangles],
      hull: e.hull,
      weights,
    };
    return {
      slot: e.slot,
      bone: e.bone,
      ...(e.before !== undefined ? { before: e.before } : {}),
      attachment,
    };
  });
  return {
    attachment: islandSlots[0].attachment,
    islandSlots,
    report: {
      part: part.name,
      vertices: allWeights.length,
      triangles: allTriangles.length / 3,
      hull: totalHull,
      bones: [...new Set(allWeights.flatMap((row) => row.map((w) => w.bone)))].sort(),
      max_influences: allWeights.reduce((n, row) => Math.max(n, row.length), 0),
      mean_influences: pyRound(allWeights.reduce((n, row) => n + row.length, 0) / allWeights.length, 2),
      art_coverage: pyRound(artCoverage({ vertices: allVertices, triangles: allTriangles }, alphaAbove(padded, ART_ALPHA)), 5),
      mode: 'explicit',
      ...hashes,
    },
  };
}
