/**
 * The cloth and hair recipe (issue #364): what `propose --cloth` drafts for a
 * `bottomwear` part and for `back hair` and `front hair` when the config's
 * `cloth` block names that tag — dense trees hung from the attachment bone,
 * physics on every link, and no idle key on any of them.
 *
 * The purpose is the world, not the loop: cloth and hair move because the
 * body under them moves and because the consumer blows wind or turns gravity
 * (the owner's direction, 2026-10-13). So each link carries a declared
 * response — rig-c's physics `wind` and `gravity`, each a scalar multiplier of
 * the environment the consumer sets (spine-core's skeleton-level `windX/windY`
 * and `gravityX/gravityY`) — that grows from the root to the tip. The
 * direction is the consumer's, and nothing here writes one.
 *
 * ⭐ Strength does not fall along a chain. A tip reads soft because each
 * link turns on top of every link above it, so the motion accumulates down
 * the chain at one strength; only the edge branch is declared softer.
 *
 * The rules, each a function of the recipe and the part's art (AUTHORING §3,
 * *Recipe: cloth and hair that answer the world*):
 *
 * - **Trees.** `chains` trees hang across the piece: tree k owns the cell
 *   [k/N, (k+1)/N] of the art's width in every row (for `back hair`, of each
 *   side's art, either side of the eye axis), and its links sit at the cell's
 *   centre in the 24-row band at their row. With `split: {at, into}` the first
 *   `at` links are the tree's trunk, and the trunk's tip forks into `into`
 *   branches, each the centre of its share of the cell, down to the tip row.
 *   Without `split`, each tree is one chain.
 * - **Lengths.** Every path from root to tip has `links` links, and link j's
 *   length is the first's times q^j, q = `length_ratio`^(1/(links − 1)), the
 *   whole spanning the root row to the tip row: the links shorten toward the
 *   tip.
 * - **Stiffness.** A trunk link takes `strength.trunk`, a branch link
 *   `strength.branch`, and the **edge** — the outermost branch on each outer
 *   side of the piece (without `split`, the outermost tree) — `strength.edge`.
 *   Every spring is held to the step's stability bound ({@link springStable}).
 * - **Response.** Link j of a path of n links takes `wind` and `gravity` at
 *   t = j/(n − 1) of the way from the declared root value to the tip value (a
 *   single-link path takes the tip value: it is a dangling end).
 * - **Out of phase.** `alternate_damping`, when declared, is the damping of
 *   every odd tree; the even ones take `damping`.
 * - **Translate.** `translate`, when declared, is the `x` and `y` mix of a
 *   second physics constraint on the last link of every path, beside its
 *   rotation, with no wind or gravity response ({@link physics} says why).
 * - **Part** (`bottomwear` only, issue #402). `part` names a `topwear` part
 *   that takes the skirt's recipe as well: a skirt See-through returned inside
 *   `topwear` (a dress). Its trees hang from the hip over its art below the
 *   hip, by the skirt's own rule, in place of the robe chains the topwear rule
 *   drafts; its art above the hip stays on the chest. The proposer never picks
 *   such a part by itself: it names a candidate, and the author declares it.
 *   A `bottomwear` part lying on that part's tree links (a hem returned as a
 *   layer of its own) rides them, as a layer on a tail does ({@link tailOverlap}),
 *   and gets no trees of its own (issue #416): one skirt, one set of trees.
 * - **Swing** (`bottomwear` only). `swing.scales` declares one shared pendulum:
 *   a bone `<prefix>swing` under the attachment at the centre of the root row,
 *   one link long, with physics; each tree's first link takes the swing's
 *   rotation times its scale (a transform constraint, local source and target,
 *   additive) instead of a physics constraint of its own.
 *
 * Two numbers have defaults, {@link RECIPE_LENGTH_RATIO} and
 * {@link RECIPE_STRENGTH}: the recipe's own, chosen and measured on this
 * package's synthetic fixture (`fixtures/cloth.ts`); each says what was
 * measured. Every other number is the author's.
 *
 * Pure: no clock, no randomness; every value is a function of its inputs.
 */
import type { ConfigConstraint, Point } from './config.ts';
import { connectedComponents } from './raster/components.ts';
import { dilate } from './raster/morph.ts';
import { type Mask, newMask } from './raster/types.ts';
import { pyRound } from './round.ts';
import { segmentDistance } from './weights.ts';

/** The tags a `cloth` recipe may name: the parts the proposer drafts chains on that hang. */
export const CLOTH_TARGETS = ['bottomwear', 'back hair', 'front hair'] as const;
export type ClothTarget = (typeof CLOTH_TARGETS)[number];

/** The per-branch stiffness of a tree. */
export interface ClothStrength {
  trunk: number;
  branch: number;
  edge: number;
}

/** One target's recipe, as `config.cloth.<tag>` declares it (`chains` may be omitted on `"back hair"`, where it is derived from the visible hair masses below the root row, issue #445). */
export interface ClothRecipe {
  chains?: number;
  links: number;
  split?: { at: number; into: number; hold_tip?: boolean };
  length_ratio?: number;
  strength?: ClothStrength;
  damping?: number;
  alternate_damping?: number;
  /** `[root, tip]`: the wind response of a path's first link and of its last. */
  wind: [number, number];
  /** `[root, tip]`: the gravity response of a path's first link and of its last. */
  gravity: [number, number];
  translate?: number;
  swing?: { scales: number[] };
  /** `bottomwear` only when a string (a `topwear` part or its cut skirt piece, issue #402); on any target when a list of parts the recipe's trees run through from root to tip (issue #437; the single-part form is the one-element list). */
  part?: string | string[];
  /** A list of parts the recipe's trees run through in order from root to tip, one chain across the union and each link weighted to the part whose pixels it crosses (issue #437; the single-part form is the one-element list). */
  parts?: string[];
  /**
   * Issue #518: draft the parts this recipe meshes in the influence mode (`meshes.<part>.influence`, issue #378) rather
   * than on a lattice: `across`, `max` and `shape` as declared (no default — the reading that fixed the radius did not
   * vary them), `cell` the lattice cell the part would have had, and `radius` as declared or, absent, drafted as
   * {@link INFLUENCE_RADIUS_CELLS} cells past the part's farthest lattice vertex from its nearest link.
   */
  influence?: { across: boolean; max: number; shape: 'linear' | 'smooth'; radius?: number };
}

/**
 * 📐 Issue #518: the drafted influence radius is the part's farthest lattice vertex from its nearest link (the figure
 * `RIG_INFLUENCE_REACH` holds the radius above) plus this many of the part's lattice cells. Measured in #513 on the
 * cloth fixture and the public `wind` example (8 covered parts, `render --folds` with the physics on under wind
 * +1 -> -1 -> calm and a hip sway of 8 and 30 degrees, max 6, across, smooth): farthest + 2 to + 6 cells read 0
 * folded frames on every part, + 2 at the window's edge on one front-hair part, and a fold returned at 8-11 cells on
 * another. That reading counted folds only. Read against `check` as well (the rig as built under the same wind
 * schedule, the three covered `wind` parts at the same number of cells), + 4 is the ceiling: `wind` `bottomwear`'s
 * `CHECK_TIP_OVER_ROOT` ratio is 1.898 on the lattice, 1.801 at + 2 cells, 1.590 at + 3 and 1.471 at + 4, under the
 * floor 1.4725, and 1.351 at + 6 (#513, rig-parts 1.52.0, rigc 2.60.0; the lattice, + 3 and + 4 read again on
 * rig-parts 1.54.0, rigc 2.60.0 with the same figures, #599). The window that holds both is + 2 to + 3 cells, and 3 is
 * its upper edge: one cell inside the fold edge, one under the check ceiling. [Hypothesis until a third subject: each
 * edge rests on one part.] Past the floor alone the mesh folds more than its lattice, and a larger radius is not safer.
 */
export const INFLUENCE_RADIUS_CELLS = 3;

export type ClothRecipes = Partial<Record<ClothTarget, ClothRecipe>>;

/**
 * 📐 The fallback tree count when `draftTrees` is called without `chains` or
 * `masses` (issues #390, #445, #461). When `chains` is omitted on
 * `config.cloth."back hair"`, `propose` derives the count per side from the
 * visible hair masses ({@link backHairMasses}, {@link backHairMassTrees}):
 * connected components of the back-hair part's alpha below the root row (merged
 * when they touch within one grid cell), with `max(1, floor(w / (4 * grid)) + 1)`
 * trees per mass across its root-row width `w`, rooted at that mass's own top
 * row and inside its columns.
 */
export const RECIPE_BACK_HAIR_CHAINS = 2;

/**
 * 📐 The default ratio of a path's last link to its first: 0.5, the recipe's
 * own. Measured on the cloth fixture (fixtures/cloth.ts, rig-c 2.47.1, the
 * selftest's CK420 build): see AUTHORING §3, *Recipe: cloth and hair*, which
 * holds the figures. Links halve from root to tip, whatever their count.
 */
export const RECIPE_LENGTH_RATIO = 0.5;

/**
 * 📐 The default stiffness: trunk and branch 100 — rig-c's own default
 * `strength`, so the trunk and the main branches are as stiff as an
 * undeclared spring — and the edge 50, half of it: the edge is the one part
 * declared softer. The recipe's own, measured on the cloth fixture
 * (AUTHORING §3, *Recipe: cloth and hair*). Each is below the stability bound
 * at every damping in [0, 1] ({@link springStable}: 100/3600 against at
 * least 2).
 */
export const RECIPE_STRENGTH: Readonly<ClothStrength> = { trunk: 100, branch: 100, edge: 50 };

/** rig-c's default physics `damping` (its `RigPhysicsConstraint` doc: "Defaults: 0.5 / 100 / 0.85 / 1 / 0 / 0 / 1"), which a recipe without `damping` runs at. */
export const RIGC_DEFAULT_DAMPING = 0.85;

/** rig-c's default physics `fps` (`step = 1/fps`) and `mass` (`massInverse = 1/mass`), neither of which a recipe sets. */
export const RIGC_DEFAULT_FPS = 60;
export const RIGC_DEFAULT_MASS = 1;

/**
 * The stability of one physics spring at its step (A23's inequality). Per step
 * spine-core does `v += -strength·x·step·massInverse; x += v·step; v *=
 * d`, d = damping^(60·step). In (x, v·step) that is the matrix
 * [[1 − k, 1], [−d·k, d]], k = strength·massInverse·step², with trace
 * 1 − k + d and determinant d; both eigenvalues lie inside the unit circle
 * exactly when 0 < k < 2(1 + d) (and d < 1; at d = 1 the spring rings without
 * decay but does not grow). Returns k, the bound and whether k is below it.
 */
export function springStable(strength: number, damping: number, fps = RIGC_DEFAULT_FPS, mass = RIGC_DEFAULT_MASS): { k: number; bound: number; ok: boolean } {
  const step = 1 / fps;
  const k = (strength / mass) * step * step;
  const bound = 2 * (1 + damping ** (60 * step));
  return { k, bound, ok: k > 0 && k < bound };
}

/** The decimals a drafted physics number is written to: enough for a ramp of a few links, short enough to read. */
export const CLOTH_DECIMALS = 6;

/** What a link is in its tree, which sets its stiffness. */
export type LinkRole = 'trunk' | 'branch' | 'edge';

/** One drafted chain of a tree. */
export interface TreeChain {
  chain: string;
  parent: string;
  points: Point[];
  tip: Point;
  /** One rule per point, then the tip's: what each was read off. */
  why: string[];
  tipWhy: string;
  /** Which tree (0-based, across the piece or its side) this chain belongs to. */
  tree: number;
  /** The role of each link. */
  roles: LinkRole[];
  /** Each link's depth from its tree's root (0 = the root link). */
  depths: number[];
  /** Whether each link is the last of its path. */
  last: boolean[];
}

/** Which outer sides of the piece are edges: both (a skirt, a lock), or one side of the eye axis (back hair). */
export type EdgeSides = 'both' | 'r' | 'l';

/** Issue #445, #461: one visible hair mass's own frame for a tree rooted at that mass's top row. */
export interface TreeMassInput {
  rootY: number;
  tipY: number;
  xAt: (y: number, frac: number) => number | null;
  fallbackX: (frac: number) => number;
  frame: string;
  /** Issue #461: tree index within this mass (0-based, default 0) and total trees in this mass (default 1). */
  treeInMass?: number;
  treesInMass?: number;
}

export interface TreeColumnTip {
  tipY: number;
  xAt?: (y: number, frac: number) => number | null;
}

export interface TreeInput {
  /** The chains' name prefix: tree k's trunk is `<prefix><k>_`, its branches `<prefix><k><a|b|…>_`. */
  prefix: string;
  parent: string;
  /** The root row (the first link's origin) and the tip row (the last link's tip), rig px, y down. */
  rootY: number;
  tipY: number;
  /** The art's x at row y, `frac` of the way across the cell's frame (0 = the frame's left edge), or null when the band holds no art there. */
  xAt: (y: number, frac: number) => number | null;
  /** Where a link falls when its band holds no art. */
  fallbackX: (frac: number) => number;
  /** What the cell's frame is, for the rules: "skirt's art", "the r side of back's art". */
  frame: string;
  edges: EdgeSides;
  /** Issue #445: when present, one entry per drafted back-hair tree; tree k sits inside `masses[k]` rather than cell [k/n, (k+1)/n] of the whole side. */
  masses?: readonly TreeMassInput[];
  /**
   * Issue #438: when present, resolves the tip row (and an optional `xAt` bounded to that column's cloth rows) for
   * column `k` (`0 <= k < n`) and share `frac` (`0 <= frac <= 1`), or returns `null` when column `k` holds no cloth
   * below `rootY` (skipping tree `k`).
   */
  columnTip?: (k: number, frac: number) => TreeColumnTip | null;
}

/** The rows the n links of a path start at, then its tip's: lengths in the ratio q^j, from root row to tip row. */
export function linkRows(rootY: number, tipY: number, links: number, ratio: number): number[] {
  const q = links === 1 ? 1 : ratio ** (1 / (links - 1));
  const w: number[] = [];
  for (let j = 0; j < links; j++) w.push(q ** j);
  const total = w.reduce((a, b) => a + b, 0);
  const rows = [rootY];
  let acc = 0;
  for (let j = 0; j < links; j++) {
    acc += w[j];
    rows.push(j === links - 1 ? tipY : rootY + ((tipY - rootY) * acc) / total);
  }
  return rows;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** The trees of one piece, in tree order, each trunk before its branches. */
export function draftTrees(input: TreeInput, r: ClothRecipe): TreeChain[] {
  const n = input.masses !== undefined ? input.masses.length : (r.chains ?? RECIPE_BACK_HAIR_CHAINS);
  const ratio = r.length_ratio ?? RECIPE_LENGTH_RATIO;
  const baseRows = linkRows(input.rootY, input.tipY, r.links, ratio);
  const at = r.split === undefined ? r.links : r.split.at;
  const into = r.split === undefined ? 1 : r.split.into;
  const out: TreeChain[] = [];
  const activeTrees: number[] = [];
  const trunkCols = new Map<number, TreeColumnTip | null>();
  for (let k = 0; k < n; k++) {
    if (input.masses === undefined && input.columnTip !== undefined) {
      const col = input.columnTip(k, (k + 0.5) / n);
      trunkCols.set(k, col);
      if (col === null) continue;
    }
    activeTrees.push(k);
  }
  const firstTree = activeTrees.length > 0 ? activeTrees[0] : 0;
  const lastTree = activeTrees.length > 0 ? activeTrees[activeTrees.length - 1] : n - 1;
  const outerSide = (k: number, b: number): boolean => {
    const left = k === firstTree && b === 0;
    const right = k === lastTree && b === into - 1;
    return input.edges === 'both' ? left || right : input.edges === 'r' ? left : right;
  };
  for (const k of activeTrees) {
    const mass = input.masses?.[k];
    const tInMass = mass?.treeInMass ?? 0;
    const nInMass = mass?.treesInMass ?? 1;
    const fc = mass === undefined ? (k + 0.5) / n : (tInMass + 0.5) / nInMass;
    const trunkCol = trunkCols.get(k) ?? null;
    const branchCols: Array<TreeColumnTip | null> = [];
    if (into > 1 && mass === undefined && input.columnTip !== undefined) {
      for (let b = 0; b < into; b++) {
        branchCols.push(input.columnTip(k, (k + (b + 0.5) / into) / n));
      }
    }
    const trunkTipY =
      mass !== undefined
        ? mass.tipY
        : trunkCol === null
          ? input.tipY
          : branchCols.length > 0
            ? Math.min(trunkCol.tipY, ...branchCols.map((bc) => bc?.tipY ?? trunkCol.tipY))
            : trunkCol.tipY;
    const rows = mass !== undefined ? linkRows(mass.rootY, mass.tipY, r.links, ratio) : trunkTipY === input.tipY ? baseRows : linkRows(input.rootY, trunkTipY, r.links, ratio);
    const frame = mass === undefined ? input.frame : mass.frame;
    const xWith = (col: TreeColumnTip | null, y: number, f: number): number =>
      mass !== undefined ? (mass.xAt(y, f) ?? mass.fallbackX(f)) : ((col?.xAt ?? input.xAt)(y, f) ?? input.fallbackX(f));
    const ptWith = (col: TreeColumnTip | null, y: number, f: number): Point => [pyRound(xWith(col, y, f), 0), pyRound(y, 0)];
    const rowRuleFor = (pathRows: readonly number[], j: number): string =>
      `link ${j}'s row: ${j === 0 ? 'the root row' : `the root row + ${pyRound((pathRows[j] - pathRows[0]) / (pathRows[r.links] - pathRows[0]), 4)} of the span to the tip row`} (lengths in the ratio ${pyRound(ratio, 6)} last to first)`;
    const trunkLinks = Math.min(at, r.links);
    const trunkEdge = into === 1 && outerSide(k, 0);
    const trunk: TreeChain = {
      chain: `${input.prefix}${k}_`,
      parent: input.parent,
      points: [],
      tip: ptWith(trunkCol, rows[trunkLinks], fc),
      why: [],
      tipWhy: `${trunkLinks === r.links ? 'the tip row' : `link ${trunkLinks}'s row, the fork`}, ${pyRound(fc, 6)} of the way across ${frame} (tree ${k} of ${n}, the centre of its cell)`,
      tree: k,
      roles: [],
      depths: [],
      last: [],
    };
    for (let j = 0; j < trunkLinks; j++) {
      trunk.points.push(ptWith(trunkCol, rows[j], fc));
      trunk.why.push(`${rowRuleFor(rows, j)}, ${pyRound(fc, 6)} of the way across ${frame} in the 24-row band there (tree ${k} of ${n}, the centre of its cell)`);
      trunk.roles.push(into === 1 ? (trunkEdge ? 'edge' : 'trunk') : 'trunk');
      trunk.depths.push(j);
      trunk.last.push(into === 1 && j === trunkLinks - 1);
    }
    out.push(trunk);
    if (into === 1) continue;
    for (let b = 0; b < into; b++) {
      const fb = mass === undefined ? (k + (b + 0.5) / into) / n : (tInMass + (b + 0.5) / into) / nInMass;
      const bCol = branchCols[b] ?? trunkCol;
      const bTipY = bCol?.tipY ?? trunkTipY;
      const bRows = bTipY === trunkTipY ? rows : linkRows(input.rootY, bTipY, r.links, ratio);
      const ch: TreeChain = {
        chain: `${input.prefix}${k}${LETTERS[b]}_`,
        parent: `${trunk.chain}${trunkLinks - 1}`,
        points: [],
        tip: ptWith(bCol, bRows[r.links], fb),
        why: [],
        tipWhy: `the tip row, ${pyRound(fb, 6)} of the way across ${frame} (branch ${b} of ${into} of tree ${k}, the centre of its share of the cell)`,
        tree: k,
        roles: [],
        depths: [],
        last: [],
      };
      const edge = r.split?.hold_tip === true && r.strength === undefined ? false : outerSide(k, b);
      for (let j = trunkLinks; j < r.links; j++) {
        ch.points.push(j === trunkLinks ? trunk.tip : ptWith(bCol, bRows[j], fb));
        ch.why.push(j === trunkLinks ? `the fork: the trunk ${trunk.chain}'s tip` : `${rowRuleFor(bRows, j)}, ${pyRound(fb, 6)} of the way across ${frame} in the 24-row band there (branch ${b} of ${into} of tree ${k})`);
        ch.roles.push(edge ? 'edge' : 'branch');
        ch.depths.push(j);
        ch.last.push(j === r.links - 1);
      }
      out.push(ch);
    }
  }
  return out;
}

/** The value t of the way from a `[root, tip]` pair's root to its tip, to {@link CLOTH_DECIMALS}. */
function ramp(pair: readonly [number, number], t: number): number {
  return pyRound(pair[0] + t * (pair[1] - pair[0]), CLOTH_DECIMALS);
}

/** Where link `depth` of a path of `links` links sits on the root-to-tip ramp. */
export function rampAt(depth: number, links: number): number {
  return links === 1 ? 1 : depth / (links - 1);
}

/** The physics constraint name of a bone. */
export function physicsName(bone: string): string {
  return `${bone}_physics`;
}

/** The translate constraint name of a bone (a dangling end's flutter). */
export function translateName(bone: string): string {
  return `${bone}_translate`;
}

/**
 * A link's physics, its fields in a fixed order: the rotation with the link's
 * wind and gravity response, and — on the last link of a path, when the recipe
 * declares `translate` — a second constraint moving x and y by that mix, with
 * the same stiffness and damping and no response at all.
 *
 * ⭐ Why the flutter carries no response: spine-core scales a translate
 * spring's wind and gravity by the skeleton's reference scale (100 by
 * default) and a rotation's by the link's length over it, so one response on
 * both components pushes the end ~100/length times further sideways than it
 * turns it. Measured on the cloth fixture (fixtures/cloth.ts, its recipe, the
 * recipe's default strength, rig-c 2.47.1's render under spine-core's default
 * environment), check's TEXTURE_STRETCH severity (ceiling 1.927) with the
 * translate mix at 0.2 / 0.5 / 1: split so, 1.382 / 1.388 / 1.398; with the
 * link's response on the translate too, 1.65 / 3.233 / 3.814.
 */
function physics(bone: string, r: ClothRecipe, role: LinkRole, t: number, tree: number, last: boolean): ConfigConstraint[] {
  const s = r.strength ?? RECIPE_STRENGTH;
  const damping = tree % 2 === 1 && r.alternate_damping !== undefined ? r.alternate_damping : r.damping;
  const c: ConfigConstraint = { type: 'physics', name: physicsName(bone), bone, rotate: 1, strength: s[role] };
  if (damping !== undefined) c.damping = damping;
  c.wind = ramp(r.wind, t);
  c.gravity = ramp(r.gravity, t);
  if (!last || r.translate === undefined) return [c];
  const tr: ConfigConstraint = { type: 'physics', name: translateName(bone), bone, x: r.translate, y: r.translate, strength: s[role] };
  if (damping !== undefined) tr.damping = damping;
  return [c, tr];
}

/** The swing bone's name for a prefix. */
export function swingName(prefix: string): string {
  return `${prefix}_swing`;
}

/**
 * The constraints of a piece's trees: with a swing, the swing's physics and
 * one transform per tree first, then a physics constraint per link in bone
 * order — a parent's before its child's, so each spring reads its parent's
 * settled pose. `swingRest` is the swing's setup rotation in its parent's
 * frame, Spine degrees (y up), which the transform subtracts so the trees take
 * only the swing's motion.
 */
export function treeConstraints(trees: readonly TreeChain[], r: ClothRecipe, swing: { bone: string; rest: number } | null): ConfigConstraint[] {
  const out: ConfigConstraint[] = [];
  if (swing !== null && r.swing !== undefined) {
    out.push(...physics(swing.bone, r, 'trunk', 0, 0, false));
    const scales = r.swing.scales;
    for (const t of trees) {
      if (t.depths[0] !== 0) continue;
      out.push({
        type: 'transform',
        name: `${swing.bone}_${t.tree}`,
        source: swing.bone,
        bones: [`${t.chain}0`],
        localSource: true,
        localTarget: true,
        additive: true,
        properties: { rotate: { offset: swing.rest, to: { rotate: { scale: scales[t.tree] } } } },
        mixRotate: 1,
      });
    }
  }
  for (const t of trees) {
    t.points.forEach((_, i) => {
      if (swing !== null && t.depths[i] === 0) return;
      out.push(...physics(`${t.chain}${i}`, r, t.roles[i], rampAt(t.depths[i], r.links), t.tree, t.last[i]));
    });
  }
  return out;
}

/**
 * The physics of a chain the recipe does not shape (the fringe's columns,
 * whose two links the fringe rule places): every link a trunk link of a
 * one-tree path, an outer column's links the edge's, on the recipe's ramp
 * over the chain's own links.
 */
export function chainConstraints(chain: string, links: number, tree: number, edge: boolean, r: ClothRecipe): ConfigConstraint[] {
  const out: ConfigConstraint[] = [];
  for (let i = 0; i < links; i++) out.push(...physics(`${chain}${i}`, r, edge ? 'edge' : 'trunk', rampAt(i, links), tree, i === links - 1));
  return out;
}

/**
 * The one note a piece drafted by the recipe gets. `via` is the part's own
 * `from` when the recipe reached it by `part` rather than by its tag
 * (issue #402); absent, the note is the one written before the field existed.
 */
export function clothNote(part: string, tag: ClothTarget, trees: readonly TreeChain[], r: ClothRecipe, constraints: number, extra: string, via?: string): string {
  const defaults: string[] = [];
  if (r.length_ratio === undefined) defaults.push(`length_ratio ${RECIPE_LENGTH_RATIO}`);
  if (r.strength === undefined) defaults.push(`strength ${RECIPE_STRENGTH.trunk}/${RECIPE_STRENGTH.branch}/${RECIPE_STRENGTH.edge}`);
  const shape = r.split === undefined ? `${r.links} link(s) each` : `a ${r.split.at}-link trunk forking into ${r.split.into} branches${r.split.hold_tip === true ? ' (tip held)' : ''}, ${r.links} links root to tip`;
  return (
    `${part} (${via === undefined ? tag : `${via}, which config.cloth."${tag}".part names`}): config.cloth."${tag}" -> ${r.chains} tree(s)${extra}, ${shape} (${trees.map((t) => t.chain).join(', ')}); ` +
    `${constraints} constraint(s), physics on every link, wind ${r.wind[0]} -> ${r.wind[1]} and gravity ${r.gravity[0]} -> ${r.gravity[1]} root to tip (multipliers of the consumer's environment; no direction is drafted), no idle key` +
    (defaults.length === 0 ? '' : `; the recipe's own defaults, measured on its synthetic fixture (AUTHORING §3): ${defaults.join(', ')}`)
  );
}

/**
 * Issue #391: a part wrapped round a tail the recipe drafted rides that tail's links. One span of the tail: a segment
 * of the back hair's mesh as the recipe drafts it — the head's fixed segment, or one tree link from its origin to the
 * next link (the last to the chain's tip), named by the link's bone.
 */
export interface TailSpan {
  bone: string;
  a: Point;
  b: Point;
  /** Whether the span is a tree link (false: the head's fixed segment). */
  link: boolean;
}

/** A tail the recipe drafted: the back hair part, its opaque mask on the rig canvas, and its mesh's spans in segment order. */
export interface Tail {
  part: string;
  mask: Mask;
  spans: TailSpan[];
}

/** Where a part's opaque pixels lie against a drafted tail. */
export interface TailOverlap {
  /** Per span, in the tail's order: the part's pixels over the tail's art whose nearest span it is. */
  counts: number[];
  /** The part's pixels over the tail's art (the sum of `counts`). */
  over: number;
  /** The part's opaque pixels in all. */
  total: number;
}

/**
 * Which span of the tail each of the part's pixels over the tail's art belongs to: every pixel where both masks are
 * set is given to the span nearest it — the distance the weights read (`segmentDistance`, `src/weights.ts`), so a
 * span here is the art the tail's own weights give mostly to that bone — the first in the tail's order on a tie. No
 * threshold: a span the part touches by one pixel is one the part overlaps, and the counts are said in the note.
 * Pure; the part's mask and the tail's are on the same canvas.
 */
export function tailOverlap(tail: Tail, part: Mask, box: { x: number; y: number; w: number; h: number }): TailOverlap {
  const counts = tail.spans.map(() => 0);
  let over = 0;
  let total = 0;
  const W = part.width;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const i = y * W + x;
      if (part.data[i] === 0) continue;
      total++;
      if (tail.mask.data[i] === 0) continue;
      over++;
      let best = 0;
      let bd = Infinity;
      tail.spans.forEach((s, k) => {
        const d = segmentDistance([x, y], s.a, s.b);
        if (d < bd) {
          bd = d;
          best = k;
        }
      });
      counts[best]++;
    }
  }
  return { counts, over, total };
}

/**
 * Issue #437: how many interior pixel steps along `span` (`a -> b`, sampled at
 * `(s + 0.5) / ceil(|b - a|)` for `s = 0 .. ceil(|b - a|) - 1`) land on an
 * opaque pixel of `mask`. Consecutive vertical links `[y0, y1]`, `[y1, y2]`
 * sample half-open row intervals `[y0, y1)`, `[y1, y2)` with no shared boundary
 * pixel at the joint `y1`, so a link strictly on one side of a horizontal seam
 * takes 0 pixels on the other part.
 */
export function spanCrosses(span: Pick<TailSpan, 'a' | 'b'>, mask: Mask): number {
  const [x0, y0] = span.a;
  const [x1, y1] = span.b;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy)));
  let count = 0;
  for (let s = 0; s < steps; s++) {
    const t = (s + 0.5) / steps;
    const x = Math.floor(x0 + t * dx);
    const y = Math.floor(y0 + t * dy);
    if (x >= 0 && x < mask.width && y >= 0 && y < mask.height && mask.data[y * mask.width + x] !== 0) count++;
  }
  return count;
}

/**
 * Issue #445: one visible hair mass on a side (`r`: `x < axis`, `l`: `x >= axis`)
 * of the back-hair part's alpha below the root row.
 */
export interface BackHairMass {
  side: 'r' | 'l';
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  area: number;
  mask: Mask;
}

/**
 * Issue #445: the visible hair masses on one side of the eye axis (`r`: `x < axis`,
 * `l`: `x >= axis`) — 8-connected components of the back-hair part's alpha below
 * the root row (`y > y0`, after any undivided crown rows above `shoulderLine` that
 * bridge continuously across `axis`, with row `y0` attached when a component touches
 * `y0` at `y0 + 1`), merged when an above-shoulder crown/nape remnant sits beside a
 * hanging tail on that side or when two components touch within one grid cell
 * (`grid` px), sorted left-to-right by `minX`.
 */
export function backHairMasses(mask: Mask, side: 'r' | 'l', axis: number, y0: number, shoulderLine: number, grid: number): BackHairMass[] {
  const W = mask.width;
  const H = mask.height;
  const onSide = (x: number): boolean => (side === 'r' ? x < axis : x >= axis);
  const axL = Math.max(0, Math.floor(axis) - 1);
  const axR = Math.min(W - 1, Math.floor(axis));
  let yStart = Math.max(0, y0 + 1);
  const shoulderRow = Math.min(H, Math.floor(shoulderLine));
  while (yStart < shoulderRow && mask.data[yStart * W + axL] !== 0 && mask.data[yStart * W + axR] !== 0) {
    yStart++;
  }
  const hasAnyFrom = (yFrom: number): boolean => {
    for (let y = yFrom; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (onSide(x) && mask.data[y * W + x] !== 0) return true;
      }
    }
    return false;
  };
  if (!hasAnyFrom(yStart)) yStart = Math.max(0, y0 + 1);
  const sub = newMask(W, H);
  for (let y = yStart; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (onSide(x) && mask.data[y * W + x] !== 0) sub.data[y * W + x] = 1;
    }
  }
  const cc = connectedComponents(sub, 8);
  const comps: Array<{ minX: number; maxX: number; minY: number; maxY: number; area: number; mask: Mask }> = [];
  for (let i = 1; i < cc.count; i++) {
    const st = cc.stats[i];
    const m = newMask(W, H);
    let minX = st.left;
    let maxX = st.left + st.width - 1;
    let minY = st.top;
    const maxY = st.top + st.height - 1;
    let area = st.area;
    for (let y = st.top; y <= maxY; y++) {
      for (let x = st.left; x <= maxX; x++) {
        if (cc.labels[y * W + x] === i) m.data[y * W + x] = 1;
      }
    }
    if (yStart === y0 + 1 && minY === y0 + 1 && y0 >= 0 && y0 < H) {
      let touched = false;
      for (let x = 0; x < W; x++) {
        if (!onSide(x) || mask.data[y0 * W + x] === 0) continue;
        if (
          m.data[(y0 + 1) * W + x] !== 0 ||
          (x > 0 && m.data[(y0 + 1) * W + (x - 1)] !== 0) ||
          (x + 1 < W && m.data[(y0 + 1) * W + (x + 1)] !== 0)
        ) {
          m.data[y0 * W + x] = 1;
          touched = true;
        }
      }
      if (touched) {
        for (let x = 1; x < W; x++) {
          if (onSide(x) && mask.data[y0 * W + x] !== 0 && m.data[y0 * W + (x - 1)] !== 0) m.data[y0 * W + x] = 1;
        }
        for (let x = W - 2; x >= 0; x--) {
          if (onSide(x) && mask.data[y0 * W + x] !== 0 && m.data[y0 * W + (x + 1)] !== 0) m.data[y0 * W + x] = 1;
        }
        minY = y0;
        for (let x = 0; x < W; x++) {
          if (m.data[y0 * W + x] !== 0) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            area++;
          }
        }
      }
    }
    comps.push({ minX, maxX, minY, maxY, area, mask: m });
  }
  if (comps.length === 0) return [];
  const par = comps.map((_, i) => i);
  const find = ( idx: number): number => {
    let cur = idx;
    while (par[cur] !== cur) {
      par[cur] = par[par[cur]];
      cur = par[cur];
    }
    return cur;
  };
  const unite = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) par[rb] = ra;
  };
  const dilatedCache = new Map<number, Mask>();
  const dilatedOf = (idx: number): Mask => {
    let d = dilatedCache.get(idx);
    if (d === undefined) {
      d = dilate(comps[idx].mask, Math.max(1, 2 * grid + 1));
      dilatedCache.set(idx, d);
    }
    return d;
  };
  const touchesWithinGrid = (ia: number, ib: number): boolean => {
    const a = comps[ia];
    const b = comps[ib];
    if (a.maxX + grid < b.minX || b.maxX + grid < a.minX || a.maxY + grid < b.minY || b.maxY + grid < a.minY) return false;
    const da = dilatedOf(ia);
    for (let y = b.minY; y <= b.maxY; y++) {
      for (let x = b.minX; x <= b.maxX; x++) {
        if (b.mask.data[y * W + x] !== 0 && da.data[y * W + x] !== 0) return true;
      }
    }
    return false;
  };
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      if (find(i) !== find(j) && touchesWithinGrid(i, j)) unite(i, j);
    }
  }
  const groups = new Map<number, typeof comps>();
  for (let i = 0; i < comps.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    (groups.get(r) as typeof comps).push(comps[i]);
  }
  const merged: BackHairMass[] = [];
  for (const list of groups.values()) {
    const m = newMask(W, H);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let area = 0;
    for (const c of list) {
      minX = Math.min(minX, c.minX);
      maxX = Math.max(maxX, c.maxX);
      minY = Math.min(minY, c.minY);
      maxY = Math.max(maxY, c.maxY);
      area += c.area;
      for (let y = c.minY; y <= c.maxY; y++) {
        for (let x = c.minX; x <= c.maxX; x++) {
          if (c.mask.data[y * W + x] !== 0) m.data[y * W + x] = 1;
        }
      }
    }
    merged.push({ side, minX, maxX, minY, maxY, area, mask: m });
  }
  const hanging = merged.filter((c) => c.maxY + 1 >= shoulderLine);
  const out = hanging.length > 0 ? hanging : merged;
  for (const h of out) {
    if (h.minY <= y0) {
      for (let y = Math.max(0, y0 - 12); y < h.minY; y++) {
        for (let x = h.minX; x <= h.maxX; x++) {
          if (onSide(x) && mask.data[y * W + x] !== 0) h.mask.data[y * W + x] = 1;
        }
      }
    }
  }
  if (hanging.length === 1 && hanging[0].minY <= y0) {
    const h = hanging[0];
    const upper = merged.filter((c) => c.maxY + 1 < shoulderLine);
    if (upper.length > 0) {
      const a = Math.max(0, y0 - 12);
      const b = Math.min(H, Math.max(0, y0 + 12));
      let uMinX = h.minX;
      let uMaxX = h.maxX;
      for (let yy = a; yy < b; yy++) {
        for (let x = 0; x < W; x++) {
          if (onSide(x) && mask.data[yy * W + x] !== 0) {
            uMinX = Math.min(uMinX, x);
            uMaxX = Math.max(uMaxX, x);
          }
        }
      }
      const rootMid = pyRound(uMinX + 0.5 * (uMaxX - uMinX), 0);
      if (rootMid >= h.minX && rootMid <= h.maxX) {
        for (const u of upper) {
          for (let y = u.minY; y <= u.maxY; y++) {
            for (let x = u.minX; x <= u.maxX; x++) {
              if (u.mask.data[y * W + x] !== 0) h.mask.data[y * W + x] = 1;
            }
          }
        }
        for (let y = Math.max(0, y0 - 12); y < y0; y++) {
          for (let x = 0; x < W; x++) {
            if (onSide(x) && mask.data[y * W + x] !== 0) h.mask.data[y * W + x] = 1;
          }
        }
      }
    }
  }
  out.sort((a, b) => a.minX - b.minX);
  return out;
}

/**
 * 📐 The horizontal influence reach of one back-hair tree in mesh grid cells: 4
 * (2 grid cells on each side of the trunk, issue #461).
 *
 * Under the segment weight rule `w = 1 / (d + r)^2` (`src/weights.ts`) with
 * `partGrid`'s falloff `r ≈ 0.42 * grid` and cutoff `MIN_WEIGHT = 0.03`, a
 * tree's weight relative to `d = 0` (`(r / (d + r))^2`) drops to `MIN_WEIGHT`
 * at `d = (1 / sqrt(0.03) - 1) * r = 4.7735 * 0.42 * grid = 2.0049 * grid ≈ 2 * grid`
 * on each side of the trunk — a horizontal span of `4 * grid` per tree. Beyond
 * that span a single tree leaves outer columns weighted to the static `head`
 * segment while adjacent columns move with the tree, stretching the triangles
 * across the boundary.
 */
export const BACK_HAIR_TREE_REACH_CELLS = 4;

/**
 * Opaque pixel count of a visible hair mass `m` along its own root row `m.minY`
 * (issue #461).
 */
export function backHairMassRootWidth(m: BackHairMass): number {
  const W = m.mask.width;
  const H = m.mask.height;
  if (m.minY < 0 || m.minY >= H) return 0;
  let w = 0;
  for (let x = m.minX; x <= m.maxX; x++) {
    if (m.mask.data[m.minY * W + x] !== 0) w++;
  }
  return w > 0 ? w : m.maxX - m.minX + 1;
}

/**
 * Number of trees placed inside one visible hair mass `m` on a `grid` px mesh
 * (issue #461): `max(1, floor(w / (4 * grid)) + 1)` where `w` is the mass's
 * root-row opaque width ({@link backHairMassRootWidth}).
 *
 * A narrow mass (`w < 4 * grid`) gets 1 tree; a wide undivided tail spanning
 * `4 * grid <= w < 8 * grid` gets 2 trees; `8 * grid <= w < 12 * grid` gets 3.
 */
export function backHairMassTrees(m: BackHairMass, grid: number): number {
  const step = Math.max(1, BACK_HAIR_TREE_REACH_CELLS * grid);
  const w = backHairMassRootWidth(m);
  return Math.max(1, Math.floor(w / step) + 1);
}

