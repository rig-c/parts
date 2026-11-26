/** Bounded signed-area projection for the additive fields of a declared turn band (#1582). */
import { toWorld, type BoneTransform } from './coords.ts';
import { pyRound } from './round.ts';

type Point = readonly [number, number];
type Triangle = readonly [number, number, number];
type Group = 'head' | 'body';

export type TurnBandTuple = Array<{ slider: string; value: number }>;

export interface CoupledTurnBandReport {
  region: string;
  slot?: string;
  attachment?: string;
  vertices_adjusted: number;
  largest_share_change: number;
  /** Baseline folds on the attachment that triggered the joint solve, shared by its region rows. */
  triggering_tuples: TurnBandTuple[];
  outcome: 'adjusted' | 'fallback';
}

interface TurnBandPose {
  tuple: TurnBandTuple;
  /** Authored posed positions and the derivative with respect to the effective band share. */
  baseline: Point[];
  slopes: Point[];
}

export interface TurnBandKey {
  t: number;
  vertices?: number[];
  transform?: unknown;
}

export interface TurnBandTrack {
  slot: string;
  attachment: string;
  keys: TurnBandKey[];
}

export interface TurnBandDial {
  slider: string;
  maxDeg: number;
  scale: number;
  group: Group;
  deform: readonly TurnBandTrack[];
}

interface BandMesh {
  part: string;
  slot: string;
  attachment: string;
  triangles?: readonly number[];
  weights: ReadonlyArray<ReadonlyArray<{ bone: string; x: number; y: number; weight: number }>>;
  overlapOwners?: ReadonlyArray<{ group: Group } | undefined>;
  contourBandVertices?: ReadonlyArray<number | undefined>;
}

const ZERO: Point = [0, 0];
const SHARE_ROUNDING_NOISE = 1e-8;

/** The generated numeric timelines are linear between keys and hold their last key. */
function sample(keys: readonly TurnBandKey[], time: number, size: number, changes?: ReadonlyMap<TurnBandKey, number[]>): readonly number[] | undefined {
  const next = keys.findIndex(key => Math.fround(key.t) > time);
  if (next === 0) return;
  const left = keys[next < 0 ? keys.length - 1 : next - 1];
  const right = keys[next];
  const leftValues = changes?.get(left) ?? left.vertices;
  if (right === undefined || time === Math.fround(left.t)) return leftValues?.map(Math.fround);
  const rightValues = changes?.get(right) ?? right.vertices;
  const t = (time - Math.fround(left.t)) / (Math.fround(right.t) - Math.fround(left.t));
  return Array.from({ length: size }, (_, i) => {
    const from = Math.fround(leftValues?.[i] ?? 0);
    return from + t * (Math.fround(rightValues?.[i] ?? 0) - from);
  });
}

/**
 * Read the already-emitted bind offsets. The surrounding producer admits only
 * static frames here, so posed positions are setup plus the summed deform.
 * Replace key values only after an attachment-wide solve succeeds.
 */
export function coupleTurnBand(
  mesh: BandMesh,
  bands: ReadonlyArray<{ name: string; bone: string }>,
  bandGroup: Group,
  groups: ReadonlyMap<string, Group>,
  frames: ReadonlyMap<string, BoneTransform>,
  dials: readonly TurnBandDial[],
  combinations: ReadonlyArray<{ inputs: TurnBandTuple }>,
): CoupledTurnBandReport[] {
  const { weights, triangles } = mesh;
  if (triangles === undefined || triangles.length === 0 || triangles.length % 3 !== 0 ||
      triangles.some(i => !Number.isInteger(i) || i < 0 || i >= weights.length)) return [];
  const rows: Array<{ region: number; share: number } | undefined> = [];
  const points: Point[] = [];
  const offsets: number[] = [];
  let size = 0;
  for (const [i, row] of weights.entries()) {
    offsets.push(size);
    let x = 0, y = 0, head = 0, body = 0;
    const otherBones = new Set<string>();
    for (const w of row) {
      const frame = frames.get(w.bone);
      if (frame === undefined) return [];
      const [wx, wy] = toWorld(frame, w.x, w.y);
      x += wx * w.weight;
      y += wy * w.weight;
      size += 2;
      if (w.weight === 0) continue;
      const group = groups.get(w.bone);
      if (group === undefined || w.weight < 0 || !Number.isFinite(w.weight)) return [];
      if (group === 'head') head += w.weight;
      else body += w.weight;
      if (group === bandGroup) otherBones.add(w.bone);
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    points.push([x, y]);
    if (mesh.overlapOwners?.[i] !== undefined || otherBones.size !== 1 ||
        !(head > 0 && head < 1 && body > 0 && body < 1) || Math.abs(head + body - 1) > SHARE_ROUNDING_NOISE) continue;
    let region = mesh.contourBandVertices?.[i];
    if (mesh.contourBandVertices === undefined) {
      // A direct producer caller may only have named bindings. An ambiguous
      // binding carries no region identity in that case.
      const matching = bands.flatMap((band, index) => otherBones.has(band.bone) ? [index] : []);
      if (matching.length === 1) region = matching[0];
    }
    if (region !== undefined && bands[region] !== undefined && otherBones.has(bands[region].bone)) {
      rows[i] = { region, share: bandGroup === 'head' ? head : body };
    }
  }
  if (!rows.some(Boolean)) return [];

  const sources = new Map<string, { dial: TurnBandDial; keys: readonly TurnBandKey[] }>();
  const edits: Array<{ group: Group; key: TurnBandKey }> = [];
  for (const dial of dials) {
    const tracks = dial.deform.filter(d => d.slot === mesh.slot && d.attachment === mesh.attachment);
    if (tracks.length > 1 || sources.has(dial.slider)) return [];
    const keys = tracks[0]?.keys ?? [];
    if (keys.some((key, i) => !Number.isFinite(Math.fround(key.t)) ||
      (i > 0 && Math.fround(key.t) <= Math.fround(keys[i - 1].t)) || key.transform !== undefined ||
      (key.vertices !== undefined && (key.vertices.length !== size || !key.vertices.every(value => Number.isFinite(Math.fround(value))))))) return [];
    sources.set(dial.slider, { dial, keys });
    for (const key of keys) if (key.vertices !== undefined) edits.push({ group: dial.group, key });
  }
  if (!edits.some(({ group }) => group === 'head') || !edits.some(({ group }) => group === 'body')) return [];
  // Only the band's own group keys define its effective share. Overlap-owned
  // or otherwise cross-written bindings stay fixed in the area model.
  for (const [i, row] of rows.entries()) {
    if (row === undefined) continue;
    if (weights[i].some((w, j) => {
      if (w.weight === 0) return false;
      const at = offsets[i] + 2 * j;
      return edits.some(({ group, key }) => group !== groups.get(w.bone) &&
        (key.vertices![at] !== 0 || key.vertices![at + 1] !== 0));
    })) rows[i] = undefined;
  }
  if (!rows.some(Boolean)) return [];

  const posesAt = (changes?: ReadonlyMap<TurnBandKey, number[]>): TurnBandPose[] => combinations.map(({ inputs }) => {
    const fields: Array<{ group: Group; vertices: readonly number[] }> = [];
    for (const { slider, value } of inputs) {
      const { dial, keys } = sources.get(slider)!;
      const time = Math.max(0, (value - Math.fround(-dial.maxDeg)) * Math.fround(dial.scale));
      const vertices = keys.length === 0 ? undefined : sample(keys, time, size, changes);
      if (vertices !== undefined) fields.push({ group: dial.group, vertices });
    }
    const slopes: Point[] = [];
    const baseline = points.map(([x, y], i): Point => {
      let dx = 0, dy = 0, hx = 0, hy = 0, bx = 0, by = 0;
      for (const { group, vertices } of fields) {
        let fx = 0, fy = 0;
        for (const [j, w] of weights[i].entries()) {
          const frame = frames.get(w.bone)!;
          const at = offsets[i] + 2 * j;
          fx += (frame.a * vertices[at] + frame.b * vertices[at + 1]) * w.weight;
          fy += (frame.c * vertices[at] + frame.d * vertices[at + 1]) * w.weight;
        }
        dx += fx;
        dy += fy;
        if (group === 'head') { hx += fx; hy += fy; }
        else { bx += fx; by += fy; }
      }
      const row = rows[i];
      if (row === undefined) slopes.push(ZERO);
      else {
        const g = row.share;
        slopes.push(bandGroup === 'head'
          ? [hx / g - bx / (1 - g), hy / g - by / (1 - g)]
          : [bx / g - hx / (1 - g), by / g - hy / (1 - g)]);
      }
      return [x + dx, y + dy];
    });
    return { tuple: inputs, baseline, slopes };
  });

  if (combinations.some(({ inputs }) => inputs.some(({ slider }) => !sources.has(slider)))) return [];
  const result = solveTurnBand(points, triangles, points.map((_, i) => rows[i]?.share ?? 0), posesAt());
  if (result === undefined) return [];
  const counts = bands.map(() => ({ vertices: 0, largest: 0 }));
  const changes = new Map<TurnBandKey, number[]>();
  if (result.shares !== undefined) for (const [i, row] of rows.entries()) {
    if (row === undefined) continue;
    const share = result.shares[i];
    if (share === row.share) continue;
    let changed = false;
    for (const [j, w] of weights[i].entries()) {
      const group = groups.get(w.bone);
      if (w.weight <= 0 || group === undefined) continue;
      const multiplier = group === bandGroup ? share / row.share : (1 - share) / (1 - row.share);
      for (const edit of edits) {
        if (edit.group !== group) continue;
        const original = edit.key.vertices!;
        const at = offsets[i] + 2 * j;
        const x = pyRound(original[at] * multiplier, 6), y = pyRound(original[at + 1] * multiplier, 6);
        if (x === original[at] && y === original[at + 1]) continue;
        let values = changes.get(edit.key);
        if (values === undefined) changes.set(edit.key, values = original.slice());
        values[at] = x;
        values[at + 1] = y;
        changed = true;
      }
    }
    if (changed) {
      const count = counts[row.region];
      count.vertices++;
      count.largest = Math.max(count.largest, Math.abs(share - row.share));
    }
  }
  // Six-place emitted offsets, followed by Core's float32 storage, must
  // keep the same area bounds before we commit the candidate.
  const adjusted = changes.size > 0 && result.accepts?.(posesAt(changes)) === true;
  if (adjusted) for (const [key, values] of changes) key.vertices = values;
  const identity = mesh.slot === mesh.part && mesh.attachment === mesh.part
    ? {} : { slot: mesh.slot, attachment: mesh.attachment };
  return bands.flatMap(({ name }, i): CoupledTurnBandReport[] => {
    const { vertices, largest } = counts[i];
    if (adjusted ? vertices === 0 : !rows.some(row => row?.region === i)) return [];
    return [{
      region: name,
      ...identity,
      vertices_adjusted: adjusted ? vertices : 0,
      largest_share_change: adjusted ? largest : 0,
      triggering_tuples: result.triggeringTuples,
      outcome: adjusted ? 'adjusted' : 'fallback',
    }];
  });
}

// Doubled areas, including Core's relative and float32 area bands.
const RELATIVE_AREA_BAND = 1e-6;
const FLOAT32_AREA_NOISE = 8 * 2 ** -24;
const MIN_AREA_FRACTION = 0.02;
const MIN_BAND_MULTIPLE = 2;
const PROJECTION_HEADROOM = 1.05;
const MAX_SWEEPS = 128;
const STEP_ATTEMPTS = 12;

interface Face {
  ids: Triangle;
  clearedArea: number;
  incident: boolean;
}

function subtract([ax, ay]: Point, [bx, by]: Point): Point {
  return [ax - bx, ay - by];
}

function cross([ax, ay]: Point, [bx, by]: Point): number {
  return ax * by - ay * bx;
}

function doubledArea(a: Point, b: Point, c: Point): number {
  return cross(subtract(b, a), subtract(c, a));
}

function signedArea(world: readonly Point[], { ids: [a, b, c], clearedArea }: Face): number {
  return Math.sign(clearedArea) * doubledArea(world[a], world[b], world[c]);
}

function roundedPose(points: readonly Point[], clearedBand: number) {
  let magnitude = 0;
  const world = points.map(([x, y]): Point => {
    const point = [Math.fround(x), Math.fround(y)] as const;
    magnitude = Math.max(magnitude, Math.abs(point[0]), Math.abs(point[1]));
    return point;
  });
  return { world, band: Math.max(clearedBand, FLOAT32_AREA_NOISE * magnitude ** 2) };
}

function move([x, y]: Point, [dx, dy]: Point, delta: number): Point {
  return [x + dx * delta, y + dy * delta];
}

function margin(face: Face, band: number): number {
  return Math.max(MIN_AREA_FRACTION * Math.abs(face.clearedArea), MIN_BAND_MULTIPLE * band);
}

function availableGradient(component: number, share: number): number {
  return (component < 0 && share === 0) || (component > 0 && share === 1) ? 0 : component;
}

function clampShare(share: number): number {
  return Math.max(0, Math.min(1, share));
}

function projectFace(
  { ids: [a, b, c], clearedArea }: Face,
  target: number,
  { baseline, slopes }: TurnBandPose,
  original: readonly number[],
  shares: number[],
): boolean {
  const sign = Math.sign(clearedArea);
  const sa = slopes[a], sb = slopes[b], sc = slopes[c];
  const ga = shares[a], gb = shares[b], gc = shares[c];
  const pa = move(baseline[a], sa, ga - original[a]);
  const pb = move(baseline[b], sb, gb - original[b]);
  const pc = move(baseline[c], sc, gc - original[c]);
  const area = sign * doubledArea(pa, pb, pc);
  if (area >= target) return false;

  // The derivative is the cross product of the vertex slope and its oriented opposite edge.
  const da = availableGradient(sign * cross(sa, subtract(pb, pc)), ga);
  const db = availableGradient(sign * cross(sb, subtract(pc, pa)), gb);
  const dc = availableGradient(sign * cross(sc, subtract(pa, pb)), gc);
  const normSquared = da * da + db * db + dc * dc;
  if (!(normSquared > 0)) return false;
  const nominalStep = (target - area) / normSquared;
  if (!Number.isFinite(nominalStep)) return false;

  // The true area along the gradient is quadratic. Use the first improving
  // step from a fixed dyadic schedule with the same target throughout.
  for (let attempt = 0; attempt < STEP_ATTEMPTS; attempt++) {
    const step = nominalStep * 2 ** -attempt;
    const nextA = clampShare(ga + step * da);
    const nextB = clampShare(gb + step * db);
    const nextC = clampShare(gc + step * dc);
    const candidate = sign * doubledArea(
      move(baseline[a], sa, nextA - original[a]),
      move(baseline[b], sb, nextB - original[b]),
      move(baseline[c], sc, nextC - original[c]),
    );
    if (candidate > area) {
      shares[a] = nextA;
      shares[b] = nextB;
      shares[c] = nextC;
      return true;
    }
  }
  return false;
}

/** Zero shares mark fixed vertices. A triggered solve without shares retains the original keys. */
function solveTurnBand(
  points: readonly Point[],
  triangles: readonly number[],
  original: readonly number[],
  poses: readonly TurnBandPose[],
): { triggeringTuples: TurnBandTuple[]; shares?: number[]; accepts?: (candidate: readonly TurnBandPose[]) => boolean } | undefined {
  const cleared = roundedPose(points, 0);
  const faces: Face[] = [];
  let largestArea = 0;
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const ids: Triangle = [triangles[i], triangles[i + 1], triangles[i + 2]];
    const [a, b, c] = ids;
    const clearedArea = doubledArea(cleared.world[a], cleared.world[b], cleared.world[c]);
    largestArea = Math.max(largestArea, Math.abs(clearedArea));
    faces.push({ ids, clearedArea, incident: ids.some(id => original[id] > 0) });
  }
  const clearedBand = Math.max(largestArea * RELATIVE_AREA_BAND, cleared.band);
  const readable = faces.filter(face => Math.abs(face.clearedArea) > clearedBand);
  if (readable.length === 0) return;
  const incident = readable.filter(face => face.incident);
  const baselines = poses.map(pose => ({ pose, ...roundedPose(pose.baseline, clearedBand) }));
  if (baselines.some(({ band }) => !Number.isFinite(band))) return;
  const triggeringTuples = baselines.filter(({ world, band }) => readable.some(face =>
    Math.abs(face.clearedArea) > band && signedArea(world, face) < -band,
  )).map(({ pose }) => pose.tuple);
  if (triggeringTuples.length === 0) return;
  const fallback = { triggeringTuples };
  if (baselines.some(({ world, band }) => readable.some(face =>
    !face.incident && Math.abs(face.clearedArea) > band && signedArea(world, face) <= 0,
  ))) return fallback;

  const shares = original.slice();
  const poseAtShares = ({ baseline, slopes }: TurnBandPose) =>
    roundedPose(baseline.map((point, i) => move(point, slopes[i], shares[i] - original[i])), clearedBand);
  const acceptsPose = ({ world, band }: ReturnType<typeof roundedPose>, baselineBand: number): boolean => {
    if (!Number.isFinite(band)) return false;
    const witnessBand = Math.min(baselineBand, band);
    return readable.every(face => {
      if (Math.abs(face.clearedArea) <= witnessBand) return true;
      const area = signedArea(world, face);
      return face.incident ? area >= margin(face, band) : area > 0;
    });
  };
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let moved = false;
    for (const { pose, band: baselineBand } of baselines) {
      const { band } = poseAtShares(pose);
      if (!Number.isFinite(band)) return fallback;
      // Keep every face that was readable at baseline in the solve.
      const witnessBand = Math.min(baselineBand, band);
      for (const face of incident) {
        if (Math.abs(face.clearedArea) <= witnessBand) continue;
        if (projectFace(face, PROJECTION_HEADROOM * margin(face, band), pose, original, shares)) moved = true;
      }
    }
    if (baselines.every(({ pose, band }) => acceptsPose(poseAtShares(pose), band))) return {
      triggeringTuples,
      shares,
      accepts: candidate => baselines.every(({ band }, i) => acceptsPose(roundedPose(candidate[i].baseline, clearedBand), band)),
    };
    if (!moved) break;
  }
  return fallback;
}
