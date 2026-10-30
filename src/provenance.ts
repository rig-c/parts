/** Report-only last-writer accounting over final output pixels (#817). */
import { OPAQUE_ALPHA_ABOVE } from './layers.ts';
import type { PartRecord } from './parts.ts';
import type { AuthoredUnitDepth } from './authoredunit.ts';
import { crop, type Raster } from './raster/index.ts';

/** Negative IDs distinguish automatic writes from positive, config-indexed hand edits. */
export const AUTOMATIC_WRITERS = {
  sourceProjection: -1, extend: -2, growRim: -3, limbSplit: -4,
  limbCap: -5, limbHybrid: -6, limbFeather: -7, fringeRestore: -8,
  seamOverride: -9, armSplit: -10, headFaceUnderfill: -11, ghostCleanup: -12, unattributed: -13, paintingExtension: -14,
} as const;
export type AutomaticWriter = keyof typeof AUTOMATIC_WRITERS;
export interface PixelProvenance {
  /** Scalar transport omitted only for fully explicit unit consumers (#877). */
  depth?: AuthoredUnitDepth;
  unchanged_layer_px: number;
  hand_px: number;
  automatic_px: number;
  edits: Array<{ edit: string; px: number }>;
  automatic: Array<{ stage: AutomaticWriter; px: number }>;
}

/** RGBA equality on the same rig coordinate, including alpha. */
export function rgbaEqual(a: Uint8ClampedArray, ai: number, b: Uint8ClampedArray, bi: number): boolean {
  return a[ai] === b[bi] && a[ai + 1] === b[bi + 1] && a[ai + 2] === b[bi + 2] && a[ai + 3] === b[bi + 3];
}

/** An immutable crop of normalized raw samples that can equal an opaque output.
 * Outside this box raw alpha is <= 8, so it cannot equal final alpha > 8.
 * The crop copies RGBA; it must never alias a raster later projected in place. */
export interface ValueBaseline { readonly image: Raster; readonly x: number; readonly y: number }
export function compactValueBaseline(raw: Raster): ValueBaseline {
  let x0 = raw.width, y0 = raw.height, x1 = -1, y1 = -1;
  for (let y = 0; y < raw.height; y++) for (let x = 0; x < raw.width; x++) {
    if (raw.data[(y * raw.width + x) * 4 + 3] <= OPAQUE_ALPHA_ABOVE) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return x1 < 0 ? { image: crop(raw, 0, 0, 0, 0), x: 0, y: 0 }
    : { image: crop(raw, x0, y0, x1 - x0 + 1, y1 - y0 + 1), x: x0, y: y0 };
}

/** Value equality with the raw normalized See-through baseline wins first.
 * Otherwise the last stage that CHANGED RGBA wins; buffer copies inherit IDs.
 * A null baseline is explicit for authored layers/painting patches. */
export function pixelProvenance(image: Raster, x: number, y: number, width: number, writers: Int32Array | null, edits: readonly string[], patchId = 0, baseline: Raster | ValueBaseline | null = null): PixelProvenance {
  const out: PixelProvenance = { unchanged_layer_px: 0, hand_px: 0, automatic_px: 0, edits: [], automatic: [] };
  const counts = new Map<number, number>();
  const reference = baseline === null ? null : 'image' in baseline ? baseline.image : baseline;
  const bx = baseline !== null && 'image' in baseline ? baseline.x : 0;
  const by = baseline !== null && 'image' in baseline ? baseline.y : 0;
  for (let j = 0; j < image.height; j++) for (let i = 0; i < image.width; i++) {
    if (image.data[(j * image.width + i) * 4 + 3] <= OPAQUE_ALPHA_ABOVE) continue;
    const q = (y + j) * width + x + i;
    const u = x + i - bx, v = y + j - by;
    const same = reference !== null && u >= 0 && v >= 0 && u < reference.width && v < reference.height &&
      rgbaEqual(image.data, (j * image.width + i) * 4, reference.data, (v * reference.width + u) * 4);
    const previous = writers?.[q] ?? patchId;
    // Unknown lineage is reported explicitly, never invented as unchanged.
    const id = same ? 0 : previous === 0 ? AUTOMATIC_WRITERS.unattributed : previous;
    if (id > 0) out.hand_px++;
    else if (id < 0) out.automatic_px++;
    else out.unchanged_layer_px++;
    if (id !== 0) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  out.edits = edits.flatMap((edit, i) => counts.has(i + 1) ? [{ edit, px: counts.get(i + 1) as number }] : []);
  out.automatic = (Object.keys(AUTOMATIC_WRITERS) as AutomaticWriter[]).flatMap(stage => counts.has(AUTOMATIC_WRITERS[stage]) ? [{ stage, px: counts.get(AUTOMATIC_WRITERS[stage]) as number }] : []);
  return out;
}

/** The reader and selftests share this arithmetic check; no hand-edit gate. */
export function provenanceAddsUp(p: PixelProvenance, opaque: number): boolean {
  return p.unchanged_layer_px + p.hand_px + p.automatic_px === opaque &&
    p.edits.reduce((n, e) => n + e.px, 0) === p.hand_px && p.automatic.reduce((n, e) => n + e.px, 0) === p.automatic_px;
}

export function provenanceLines(parts: readonly PartRecord[]): string[] {
  const lines: string[] = [];
  let opaque = 0, unchanged = 0, automatic = 0, hand = 0;
  const edits = new Map<string, number>(), stages = new Map<string, number>();
  const detail = (e: ReadonlyMap<string, number>): string => [...e].map(([name, px]) => `${name} ${px}`).join(', ') || 'none';
  for (const p of parts) {
    if (p.painting_extension_px !== undefined) lines.push(`  painting extension: part "${p.name}" gained ${p.painting_extension_px} opaque painting samples; source RGB copied exactly in rig space; ownership count independent of final raw-value equality`);
    const v = p.provenance;
    if (v === undefined) continue;
    opaque += p.opaque_px; unchanged += v.unchanged_layer_px; automatic += v.automatic_px; hand += v.hand_px;
    for (const e of v.edits) edits.set(e.edit, (edits.get(e.edit) ?? 0) + e.px);
    for (const e of v.automatic) stages.set(e.stage, (stages.get(e.stage) ?? 0) + e.px);
    lines.push(`  provenance: part "${p.name}" (${p.from}) opaque ${p.opaque_px} = unchanged layer ${v.unchanged_layer_px} + hand ${v.hand_px} + automatic ${v.automatic_px}; edits ${detail(new Map(v.edits.map(e => [e.edit, e.px])))}; stages ${detail(new Map(v.automatic.map(e => [e.stage, e.px])))}${v.depth === undefined ? '' : `; depth authored-unit ${v.depth.values.map(d => `${d.group}/${d.bone ?? p.name}=${d.value}`).join(', ')}`}`);
  }
  lines.push(`  provenance total: opaque ${opaque} = unchanged layer ${unchanged} + hand ${hand} + automatic ${automatic}; edits ${detail(edits)}; stages ${detail(stages)}; output pixels, including copies in separate parts; value equality first; last value-changing stage wins`);
  return lines;
}

/** Structural cut census, independent of the value partition. Counts are from
 * the original parent partition before limb/fringe/seam processing. */
export interface CutOwnership {
  edit: string;
  from: string;
  into: string;
  moved_in_opaque_px: number;
  retained_band_opaque_px: number;
  cleared_opaque_px: number;
  under_filled_px: number;
  under_filled_opaque_px: number;
  net_cleared_opaque_px: number;
}
export function ownershipLines(rows: readonly CutOwnership[]): string[] {
  return rows.map(r => `  ownership: ${r.edit} "${r.from}" -> "${r.into}" moved in ${r.moved_in_opaque_px} opaque px; retained band ${r.retained_band_opaque_px}; gross cleared ${r.cleared_opaque_px} before refill; under filled ${r.under_filled_px} px (${r.under_filled_opaque_px} opaque); net cleared ${r.net_cleared_opaque_px}; independent of RGBA equality`);
}
