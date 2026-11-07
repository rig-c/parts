/** Direct source-projection cover, observed before projection changes RGB.
 * Counts belong to effective run layers, before cuts, merges and edge writes.
 */
import type { Extend, PlanEntry, Run } from './config.ts';
import { CORE_ALPHA, OPAQUE_ALPHA_ABOVE, type LayerSet } from './layers.ts';
import type { Mask, Raster } from './raster/types.ts';
import type { TakenLayerSource } from './takesource.ts';

export const SOURCE_COVER_FILE = 'source_cover.json';
export const SOURCE_COVER_SPEC = 'rig-parts-source-cover/1';

export interface SourceCoverLayer {
  source: string;
  run: Run;
  layer: string;
  depth_median: number | null;
  draw_order: number;
  plan_rank: number;
  planned_parts: string[];
  extend_parts: string[];
  /** Null for a generated layer with no same-name input entry. */
  input_layer: string | null;
  prepared: boolean;
  taken_layers: readonly TakenLayerSource[];
}

export interface SourceCoverPart {
  part: string;
  /** Parent source-plan reading attributed to a derived alternate part. */
  source_of?: string;
  source: string;
  support_px: number;
  /** Original own support held by keep, excluded from scalar-owner rows. */
  held_under_cover_px: number;
  covered_by: Array<{
    source: string;
    planned: boolean;
    pixels: { count: number; spans: Array<[number, number, number]> };
  }>;
}

export interface SourceCoverReading {
  sources: SourceCoverLayer[];
  parts: SourceCoverPart[];
}

export interface SourceCoverSet extends SourceCoverReading {
  set: string | null;
  painting_sha256: string;
  grid: [number, number];
  inputs: Array<{
    run: Run;
    file: string;
    sha256: string;
    layers: Array<{ layer: string; image: string | null }>;
  }>;
  inherited_parts: Array<{ part: string; set: null }>;
  hidden_parts: string[];
  output_assets: Array<{ part: string; image: string | null }>;
}

export function sourceCoverReport(sets: SourceCoverSet[]) {
  return {
    spec: SOURCE_COVER_SPEC,
    stage: 'source-projection-input',
    predicate: {
      own_alpha_above: OPAQUE_ALPHA_ABOVE,
      owner_alpha_at_least: CORE_ALPHA,
      front: 'plan rank when both layers are planned; run draw order otherwise',
      held_under_cover: 'keep support excluded from covered_by',
      coordinates: 'native rig [y, left, right-exclusive]',
    },
    sets,
  };
}

/** Reads the already-computed owner. Never changes a raster, mask or owner. */
export function sourceCoverRun(
  run: Run, set: LayerSet, original: LayerSet, images: readonly Raster[],
  ranks: readonly number[], plan: readonly PlanEntry[], extend: readonly Extend[],
  owners: ArrayLike<number>, inFront: (owner: number, layer: number) => boolean,
  keep: ReadonlyArray<Mask | null> | null,
): SourceCoverReading {
  const sources: SourceCoverLayer[] = set.layers.map((layer, i) => {
    const input = original.layers.find(candidate => candidate.name === layer.name);
    return {
      source: `${run}:${layer.name}`, run, layer: layer.name,
      depth_median: layer.depth, draw_order: layer.drawOrder, plan_rank: ranks[i],
      planned_parts: plan.filter(([, r, tag]) => r === run && tag === layer.name).map(([part]) => part),
      extend_parts: extend.filter(entry => entry.run === run && entry.tag === layer.name).map(entry => entry.part),
      input_layer: input?.name ?? null,
      prepared: input === undefined || input.left !== layer.left || input.top !== layer.top ||
        input.pixels.width !== layer.pixels.width || input.pixels.height !== layer.pixels.height ||
        input.pixels.data.length !== layer.pixels.data.length ||
        (input.pixels.data !== layer.pixels.data && !input.pixels.data.every((value, pixel) => value === layer.pixels.data[pixel])),
      taken_layers: layer.takenLayers ?? [],
    };
  });
  const parts: SourceCoverPart[] = plan.filter(([, r]) => r === run).map(([part, , tag]) => {
    const layer = set.layers.findIndex(candidate => candidate.name === tag);
    const image = images[layer];
    const cover = new Map<number, SourceCoverPart['covered_by'][number]['pixels']>();
    let support = 0;
    let held = 0;
    for (let p = 0; p < owners.length; p++) {
      if (image.data[p * 4 + 3] <= OPAQUE_ALPHA_ABOVE) continue;
      support++;
      if (keep?.[layer]?.data[p] === 1) { held++; continue; }
      const owner = owners[p];
      if (owner < 0 || owner === layer || !inFront(owner, layer)) continue;
      let pixels = cover.get(owner);
      if (pixels === undefined) {
        pixels = { count: 0, spans: [] };
        cover.set(owner, pixels);
      }
      pixels.count++;
      const x = p % image.width;
      const y = Math.floor(p / image.width);
      const last = pixels.spans[pixels.spans.length - 1];
      if (last !== undefined && last[0] === y && last[2] === x) last[2]++;
      else pixels.spans.push([y, x, x + 1]);
    }
    return {
      part, source: `${run}:${tag}`, support_px: support, held_under_cover_px: held,
      covered_by: [...cover].sort(([a], [b]) => a - b).map(([owner, pixels]) => ({
        source: sources[owner].source, planned: ranks[owner] >= 0, pixels,
      })),
    };
  });
  return { sources, parts };
}
