/**
 * Two chains on one lattice that the idle swings into each other (issue #314).
 *
 * A pair of chains a mesh's `segments` both name is a squeeze when their own
 * swing, every other bone held at the setup pose, closes (or opens) a lattice
 * edge between the art each one carries past the bar `check`'s
 * `TEXTURE_STRETCH` holds every edge to ({@link TEXTURE_STRETCH_CEILING}, on
 * max(ratio, 1/ratio)). Read here from what `propose` and `--from-config` hold —
 * the parts, the bones, the mesh's spec and the idle's chain tracks — so the
 * squeeze is named before anything is built.
 *
 * What is built is the rig stage's own lattice and weights, by the rig stage's
 * own functions: the part's image padded by {@link PAD}, its art (alpha above
 * {@link ART_ALPHA}, less what a declared `stray` leaves out) cut into the
 * lattice by `latticeMesh`, and each vertex weighted by `influences` under the
 * mesh's `r`, `exponent` and `influences`, rounded as the lattice rounds — so
 * the vertex and triangle numbers are the ones `rig.json` and `check` use. Only
 * the lattice mode under the distance rule is read; a contour or automatic mesh,
 * or `rule: "heat"`, is said not read, by name.
 *
 * Each chain's links are posed as the idle's sine states them —
 * `amps[i] * sin(2 pi (t / period - (phase + lag * i)))` degrees on link `i`,
 * `src/motion.ts` — turned down the chain (a link carries every link below it),
 * at the frames `check` renders: `t = f / IDLE_FPS` for every whole frame up to
 * the idle's duration. Every other bone stays where the setup pose has it, so a
 * figure is the pair's own: the head's roll or the breath carry both chains
 * alike and are not in it. A vertex moves as linear blend skinning moves it,
 * each weight times where that bone's motion takes the vertex. The edge ratios
 * are `check`'s own reader on these poses ({@link stretchFigures}).
 *
 * The pair is named when both swinging together pass the bar, with each
 * chain swung alone beside it — so the remedy "drop one chain" carries the
 * figure the other is left with, and a chain past the bar on its own reads as
 * that. With the two chains' amplitudes opposed link for link (every `amps[i]`
 * of one the other sign of the other's), the same reading is taken with the
 * second chain's signs turned, so the remedy "give both the same sign" carries
 * its own figure too. A remedy whose figure is past the bar is not offered.
 */
import { TEXTURE_STRETCH_CEILING } from './check.ts';
import type { BoneEntry, ConfigConstraint, MeshSpec, Motion, Point } from './config.ts';
import { stretchFigures, stretchSeverity, type StretchAt } from './instruments.ts';
import { edgeLength } from './length.ts';
import { ART_ALPHA, latticeMesh, latticeStray } from './mesh.ts';
import { IDLE_FPS, TIME_SLACK } from './motion.ts';
import { pad } from './raster/composite.ts';
import { alphaAbove, type Raster } from './raster/types.ts';
import { latticeShares, PAD, roundShares } from './rig.ts';
import { DISTANCE_EXPONENT, influences, meshLimits, type Segment } from './weights.ts';

/** One chain of the pair as the finding prints it: its name, its `amps` as written, and its tip. */
export interface SqueezeChain {
  chain: string;
  amps: number[];
  tip: Point;
}

/** The worst edge of one reading: where, its ratio, and max(ratio, 1/ratio). */
export interface SqueezeEdge {
  at: StretchAt;
  severity: number;
}

/** A pair named: both chains, the mesh, the worst edge with both swinging, and each alone (and turned, when opposed). */
export interface SqueezeFinding {
  mesh: string;
  a: SqueezeChain;
  b: SqueezeChain;
  /** The two tips' distance at the setup pose, rig px. */
  tipGap: number;
  both: SqueezeEdge;
  /** The two vertices of `both`'s edge, each with its two largest weights (bone, weight as rig.json writes it), and how many it has. */
  vertices: Array<{ vertex: number; weights: Array<{ bone: string; weight: number }>; of: number }>;
  /** The worst edge with the first chain swung alone, and with the second. */
  aloneA: number;
  aloneB: number;
  /** Both opposed link for link: the worst edge with the second chain's signs turned. Null when they are not opposed. */
  turned: number | null;
}

/**
 * Issue #403: two sibling branch tips forked from the same trunk link on a lattice mesh whose cell-boundary weights
 * pin adjacent vertices to different branch links (or whose fork gives the two branches unequal spring strength), so
 * the triangles where the two branches' cells meet are squeezed under the environment or a hip sway.
 */
export interface BranchSqueezeFinding {
  mesh: string;
  parent: string;
  a: string;
  b: string;
  tipGap: number;
  triangle: number;
  edge: [number, number];
  weightA: number;
  weightB: number;
  strengthA: number | null;
  strengthB: number | null;
  r: number;
  grid: number;
}

export interface SqueezeResult {
  findings: SqueezeFinding[];
  /** Pairs on one mesh this did not read, and why. */
  unread: string[];
  /** Every pair read: the mesh and the two chains. */
  read: Array<{ mesh: string; a: string; b: string }>;
}

type ChainTrackLike = { chain: string; amps: number[]; period: number; phase: number; lag: number };

/** Each frame's time, as `check` renders them: every whole frame at {@link IDLE_FPS} up to the idle's duration. */
function frameTimes(duration: number): number[] {
  const out: number[] = [];
  for (let f = 0; f / IDLE_FPS <= duration + TIME_SLACK; f++) out.push(f / IDLE_FPS);
  return out;
}

/**
 * A chain's posed links at time `t`: per link, its setup origin, its posed origin, and the turn it carries (degrees,
 * the sum of its own and every link above it). Positive is Spine's counter-clockwise (y up), which on the crop's y-down
 * page turns a vector (dx, dy) to (dx cos + dy sin, -dx sin + dy cos).
 */
function posedLinks(pts: readonly Point[], track: ChainTrackLike, sign: 1 | -1, t: number): Array<{ rest: Point; at: [number, number]; turn: number }> {
  const out: Array<{ rest: Point; at: [number, number]; turn: number }> = [];
  let at: [number, number] = [pts[0][0], pts[0][1]];
  let turn = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const amp = i < track.amps.length ? track.amps[i] : 0;
    turn += sign * amp * Math.sin(2 * Math.PI * (t / track.period - (track.phase + track.lag * i)));
    out.push({ rest: pts[i], at, turn });
    const rad = (turn * Math.PI) / 180;
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    at = [at[0] + dx * Math.cos(rad) + dy * Math.sin(rad), at[1] - dx * Math.sin(rad) + dy * Math.cos(rad)];
  }
  return out;
}

/** Where a bone's motion takes the point `v`: a link turns it about its origin and carries it to the link's posed origin. */
function moved(link: { rest: Point; at: [number, number]; turn: number }, v: readonly [number, number]): [number, number] {
  const rad = (link.turn * Math.PI) / 180;
  const dx = v[0] - link.rest[0];
  const dy = v[1] - link.rest[1];
  return [link.at[0] + dx * Math.cos(rad) + dy * Math.sin(rad), link.at[1] - dx * Math.sin(rad) + dy * Math.cos(rad)];
}

/**
 * Every pair of chains a lattice mesh's `segments` name, both keyed by a chain track, read as the module doc says.
 * `images` holds each part's PNG by name, its `box` its parts.json box (rig px).
 */
export function chainSqueezes(
  spec: { bones: readonly BoneEntry[]; meshes: Readonly<Record<string, MeshSpec>>; motion?: Motion },
  parts: ReadonlyMap<string, { x: number; y: number; image: Raster }>,
): SqueezeResult {
  const findings: SqueezeFinding[] = [];
  const unread: string[] = [];
  const read: SqueezeResult['read'] = [];
  const motion = spec.motion;
  if (motion === undefined) return { findings, unread, read };
  const tracks = new Map<string, ChainTrackLike>();
  for (const t of motion.tracks) if ('chain' in t) tracks.set(t.chain, t);
  const chains = new Map<string, { points: Point[]; tip: Point; parent: string }>();
  for (const e of spec.bones) if ('chain' in e) chains.set(e.chain, { points: e.points, tip: e.tip, parent: e.parent });
  // Every bone's parent, chain links as <chain><i>, so a bone under a link is carried by it.
  const parent = new Map<string, string>();
  for (const e of spec.bones) {
    if ('chain' in e) e.points.forEach((_, i) => parent.set(`${e.chain}${i}`, i === 0 ? e.parent : `${e.chain}${i - 1}`));
    else parent.set(e.name, e.parent);
  }
  const linkOf = new Map<string, [string, number]>();
  for (const [c, e] of chains) e.points.forEach((_, i) => linkOf.set(`${c}${i}`, [c, i]));
  // The nearest link at or above a bone, among the chains in `moving`.
  const carrier = (bone: string, moving: ReadonlySet<string>): [string, number] | null => {
    const seen = new Set<string>();
    for (let b: string | undefined = bone; b !== undefined && !seen.has(b); b = parent.get(b)) {
      const l = linkOf.get(b);
      if (l !== undefined && moving.has(l[0])) return l;
      seen.add(b);
    }
    return null;
  };
  const times = frameTimes(motion.duration);

  for (const [mname, m] of Object.entries(spec.meshes)) {
    const keyed = m.segments.filter((s): s is string => typeof s === 'string' && chains.has(s) && tracks.has(s));
    if (keyed.length < 2) continue;
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < keyed.length; i++) for (let j = i + 1; j < keyed.length; j++) pairs.push([keyed[i], keyed[j]]);
    const names = pairs.map(([a, b]) => `${a} and ${b}`).join(', ');
    if ('contour' in m || 'auto' in m || 'influence' in m) {
      unread.push(`mesh ${JSON.stringify(mname)} (${names}) is a ${'contour' in m ? 'contour' : 'auto' in m ? 'automatic' : 'influence'} mesh; only a lattice is built here`);
      continue;
    }
    if (m.rule === 'heat') {
      unread.push(`mesh ${JSON.stringify(mname)} (${names}) is weighted by rule "heat"; only the distance rule is read here`);
      continue;
    }
    const part = parts.get(mname);
    if (part === undefined) continue;
    // The rig stage's segments: a chain is its links, each from its origin to the next link or the tip.
    const segs: Segment[] = [];
    let unresolved: string | null = null;
    for (const sp of m.segments) {
      if (typeof sp !== 'string') {
        segs.push({ bone: sp[0], a: [sp[1][0], sp[1][1]], b: [sp[2][0], sp[2][1]] });
        continue;
      }
      const c = chains.get(sp);
      if (c !== undefined) {
        const line = [...c.points, c.tip];
        c.points.forEach((q, i) => segs.push({ bone: `${sp}${i}`, a: [q[0], q[1]], b: [line[i + 1][0], line[i + 1][1]] }));
        continue;
      }
      const single = spec.bones.find((e) => 'name' in e && e.name === sp);
      if (single === undefined || !('name' in single) || single.tip === undefined) {
        unresolved = `its segment "${sp}" is not a chain or a single bone with a tip`;
        break;
      }
      segs.push({ bone: sp, a: [single.at[0], single.at[1]], b: [single.tip[0], single.tip[1]] });
    }
    if (unresolved !== null) {
      unread.push(`mesh ${JSON.stringify(mname)} (${names}): ${unresolved}, so it has no weights to read`);
      continue;
    }
    const img = pad(part.image, PAD, PAD, PAD, PAD, [0, 0, 0, 0]);
    const allArt = alphaAbove(img, ART_ALPHA);
    const art = m.stray === undefined ? allArt : latticeStray(allArt, m.stray).art;
    const lm = latticeMesh(mname, art, m.grid);
    if ('code' in lm) {
      unread.push(`mesh ${JSON.stringify(mname)} (${names}): its lattice is refused (${lm.code}), so there is no triangle to read`);
      continue;
    }
    const ox = part.x - PAD;
    const oy = part.y - PAD;
    const limits = meshLimits(m.influences);
    const rest: Array<[number, number]> = lm.vertices.map(([x, y]) => [x + ox, y + oy]);
    const weights = rest.map((p) => {
      const shares = influences(p, segs, m.r, limits, m.exponent ?? DISTANCE_EXPONENT);
      return shares.length === 0 ? [] : limits.floor === 'continuous' ? roundShares(shares) : latticeShares(shares);
    });
    const restFlat = rest.flatMap(([x, y]) => [x, y]);
    const worst = (moving: ReadonlyMap<string, 1 | -1>): SqueezeEdge | null => {
      const set = new Set(moving.keys());
      const frames = times.map((t, index) => {
        const posed = new Map<string, ReturnType<typeof posedLinks>>();
        for (const [c, sign] of moving) {
          const e = chains.get(c) as { points: Point[]; tip: Point };
          posed.set(c, posedLinks([...e.points, e.tip], tracks.get(c) as ChainTrackLike, sign, t));
        }
        const vertices: number[] = [];
        rest.forEach((v, vi) => {
          let x = 0;
          let y = 0;
          for (const { bone, weight } of weights[vi]) {
            const l = carrier(bone, set);
            const to = l === null ? v : moved((posed.get(l[0]) as ReturnType<typeof posedLinks>)[l[1]], v);
            x += weight * to[0];
            y += weight * to[1];
          }
          vertices.push(x, y);
        });
        return { index, attachments: [{ slot: mname, attachment: mname, vertices }] };
      });
      const [fig] = stretchFigures([{ slot: mname, attachment: mname, vertices: restFlat, triangles: lm.triangles }], frames);
      if (fig.max === null || fig.min === null) return null;
      const sMax = stretchSeverity(fig.max.ratio);
      const sMin = stretchSeverity(fig.min.ratio);
      return sMin > sMax ? { at: fig.min, severity: sMin } : { at: fig.max, severity: sMax };
    };
    for (const [a, b] of pairs) {
      read.push({ mesh: mname, a, b });
      const both = worst(new Map([[a, 1], [b, 1]]));
      if (both === null || both.severity <= TEXTURE_STRETCH_CEILING) continue;
      const aloneA = (worst(new Map([[a, 1]])) as SqueezeEdge).severity;
      const aloneB = (worst(new Map([[b, 1]])) as SqueezeEdge).severity;
      const ta = tracks.get(a) as ChainTrackLike;
      const tb = tracks.get(b) as ChainTrackLike;
      const opposed = ta.amps.length === tb.amps.length && ta.amps.every((v, i) => v * tb.amps[i] < 0);
      const ca = chains.get(a) as { tip: Point };
      const cb = chains.get(b) as { tip: Point };
      findings.push({
        mesh: mname,
        a: { chain: a, amps: [...ta.amps], tip: ca.tip },
        b: { chain: b, amps: [...tb.amps], tip: cb.tip },
        tipGap: edgeLength(ca.tip[0] - cb.tip[0], ca.tip[1] - cb.tip[1]),
        both,
        vertices: both.at.edge.map((vertex) => ({ vertex, weights: [...weights[vertex]].sort((p, q) => q.weight - p.weight).slice(0, 2), of: weights[vertex].length })),
        aloneA,
        aloneB,
        turned: opposed ? (worst(new Map<string, 1 | -1>([[a, 1], [b, -1]])) as SqueezeEdge).severity : null,
      });
    }
  }
  return { findings, unread, read };
}

/**
 * Issue #403: sibling branch chains forked from the same trunk link on a lattice mesh under the distance rule.
 * When `m.r < m.grid` concentrates a cell-boundary edge's weights on each branch's tip link (above 0.85), or when
 * physics constraints give two sibling branches of one fork unequal `strength` (such as `edge` 50 beside `branch` 100),
 * the triangles where the two branches' cells meet squeeze under the environment or a hip sway. Returns one finding per
 * unheld sibling pair on a fork; quiet on an unbranched mesh or when `split.hold_tip: true` holds the fork.
 */
export function branchSqueezes(
  spec: { bones: readonly BoneEntry[]; meshes: Readonly<Record<string, MeshSpec>>; constraints?: readonly ConfigConstraint[] },
  parts: ReadonlyMap<string, { x: number; y: number; image: Raster }>,
): BranchSqueezeFinding[] {
  const out: BranchSqueezeFinding[] = [];
  const chains = new Map<string, { points: Point[]; tip: Point; parent: string }>();
  for (const e of spec.bones) if ('chain' in e) chains.set(e.chain, { points: e.points, tip: e.tip, parent: e.parent });
  const linkOf = new Set<string>();
  for (const [c, e] of chains) e.points.forEach((_, i) => linkOf.add(`${c}${i}`));
  const strengthOf = new Map<string, number>();
  for (const c of spec.constraints ?? []) {
    if (c.type === 'physics' && typeof c.bone === 'string' && c.rotate !== undefined && typeof c.strength === 'number') {
      strengthOf.set(c.bone, c.strength);
    }
  }

  for (const [mname, m] of Object.entries(spec.meshes)) {
    if ('contour' in m || 'auto' in m || 'influence' in m || m.rule === 'heat' || m.r >= m.grid) continue;
    const byFork = new Map<string, string[]>();
    for (const sp of m.segments) {
      if (typeof sp !== 'string') continue;
      const c = chains.get(sp);
      if (c === undefined || !linkOf.has(c.parent)) continue;
      const list = byFork.get(c.parent) ?? [];
      list.push(sp);
      byFork.set(c.parent, list);
    }
    const forks = [...byFork.entries()].filter(([, list]) => list.length >= 2);
    if (forks.length === 0) continue;
    const part = parts.get(mname);
    if (part === undefined) continue;
    const segs: Segment[] = [];
    let unresolved = false;
    for (const sp of m.segments) {
      if (typeof sp !== 'string') {
        segs.push({ bone: sp[0], a: [sp[1][0], sp[1][1]], b: [sp[2][0], sp[2][1]] });
        continue;
      }
      const c = chains.get(sp);
      if (c !== undefined) {
        const line = [...c.points, c.tip];
        c.points.forEach((q, i) => segs.push({ bone: `${sp}${i}`, a: [q[0], q[1]], b: [line[i + 1][0], line[i + 1][1]] }));
        continue;
      }
      const single = spec.bones.find((e) => 'name' in e && e.name === sp);
      if (single === undefined || !('name' in single) || single.tip === undefined) {
        unresolved = true;
        break;
      }
      segs.push({ bone: sp, a: [single.at[0], single.at[1]], b: [single.tip[0], single.tip[1]] });
    }
    if (unresolved) continue;
    const img = pad(part.image, PAD, PAD, PAD, PAD, [0, 0, 0, 0]);
    const allArt = alphaAbove(img, ART_ALPHA);
    const art = m.stray === undefined ? allArt : latticeStray(allArt, m.stray).art;
    const lm = latticeMesh(mname, art, m.grid);
    if ('code' in lm) continue;
    const ox = part.x - PAD;
    const oy = part.y - PAD;
    const limits = meshLimits(m.influences);
    const rest: Array<[number, number]> = lm.vertices.map(([x, y]) => [x + ox, y + oy]);
    const weights = rest.map((p) => {
      const shares = influences(p, segs, m.r, limits, m.exponent ?? DISTANCE_EXPONENT);
      return shares.length === 0 ? [] : limits.floor === 'continuous' ? roundShares(shares) : latticeShares(shares);
    });
    const topOf = (vi: number): { bone: string; weight: number } | null => {
      const w = weights[vi];
      if (w.length === 0) return null;
      return [...w].sort((p, q) => q.weight - p.weight)[0];
    };
    for (const [parent, siblings] of forks) {
      for (let i = 0; i + 1 < siblings.length; i++) {
        const aChain = siblings[i];
        const bChain = siblings[i + 1];
        const ca = chains.get(aChain) as { points: Point[]; tip: Point };
        const cb = chains.get(bChain) as { points: Point[]; tip: Point };
        const aLast = `${aChain}${ca.points.length - 1}`;
        const bLast = `${bChain}${cb.points.length - 1}`;
        let best: { triangle: number; edge: [number, number]; weightA: number; weightB: number; y: number } | null = null;
        for (let t = 0; t + 2 < lm.triangles.length; t += 3) {
          const tri = [lm.triangles[t], lm.triangles[t + 1], lm.triangles[t + 2]];
          const triIdx = t / 3;
          const meanY = (rest[tri[0]][1] + rest[tri[1]][1] + rest[tri[2]][1]) / 3;
          for (const [u, v] of [
            [tri[0], tri[1]],
            [tri[1], tri[2]],
            [tri[2], tri[0]],
          ] as const) {
            const tu = topOf(u);
            const tv = topOf(v);
            if (tu === null || tv === null) continue;
            const match =
              tu.bone === aLast && tv.bone === bLast
                ? { edge: [u, v] as [number, number], weightA: tu.weight, weightB: tv.weight }
                : tu.bone === bLast && tv.bone === aLast
                  ? { edge: [v, u] as [number, number], weightA: tv.weight, weightB: tu.weight }
                  : null;
            if (match === null) continue;
            const peak = Math.max(match.weightA, match.weightB);
            const bestPeak = best === null ? -1 : Math.max(best.weightA, best.weightB);
            if (best === null || peak > bestPeak || (peak === bestPeak && meanY > best.y)) {
              best = { triangle: triIdx, edge: match.edge, weightA: match.weightA, weightB: match.weightB, y: meanY };
            }
          }
        }
        if (best === null) continue;
        const strengthA = strengthOf.get(aLast) ?? null;
        const strengthB = strengthOf.get(bLast) ?? null;
        const unequalStrength = strengthA !== null && strengthB !== null && strengthA !== strengthB;
        const narrowReach = m.r < m.grid && Math.max(best.weightA, best.weightB) > 0.85;
        if (!unequalStrength && !narrowReach) continue;
        out.push({
          mesh: mname,
          parent,
          a: aLast,
          b: bLast,
          tipGap: edgeLength(ca.tip[0] - cb.tip[0], ca.tip[1] - cb.tip[1]),
          triangle: best.triangle,
          edge: best.edge,
          weightA: best.weightA,
          weightB: best.weightB,
          strengthA,
          strengthB,
          r: m.r,
          grid: m.grid,
        });
      }
    }
  }
  return out;
}
