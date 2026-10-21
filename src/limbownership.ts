/** Shared source-segment geometry for subset ownership; no inferred endpoints. */
import type { Limb } from './config.ts';
import { type BonePlace, limbPolyline, polylineDist2 } from './limbs.ts';

export interface SourceLimbTarget {
  segments: Limb['segments'];
  line: Array<[number, number]>;
  /** The last source segment has neither a supplied tip nor a following joint. */
  missingEndBone: string | null;
}

/** Issue #638's source selection: only consecutive segments taking this source. */
export function sourceLimbTarget(limb: Limb, source: string, places: ReadonlyMap<string, BonePlace>): SourceLimbTarget {
  const segments = limb.segments.filter((sg) => sg.from === source);
  if (segments.length === 0) return { segments, line: [], missingEndBone: null };
  const last = segments[segments.length - 1];
  const line = limbPolyline({ ...limb, segments }, places);
  if ((places.get(last.bone) as BonePlace).end === null) {
    const next = limb.segments[limb.segments.indexOf(last) + 1];
    if (next !== undefined) line.push((places.get(next.bone) as BonePlace).at);
  }
  return { segments, line, missingEndBone: line.length <= segments.length ? last.bone : null };
}

/** The nearest source segment and its part, with the same stable first-segment tie as #609. */
export function nearestTargetPart(target: SourceLimbTarget, x: number, y: number): { distance: number; part: string } {
  let distance = Infinity;
  let segment = 0;
  for (let k = 0; k + 1 < target.line.length; k++) {
    const d = polylineDist2([target.line[k], target.line[k + 1]], x, y);
    if (d < distance) {
      distance = d;
      segment = k;
    }
  }
  return { distance: Math.sqrt(distance), part: target.segments[segment].part };
}
