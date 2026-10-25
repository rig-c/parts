/**
 * The lattice mesh: one square grid over a part, every cell that holds an art
 * pixel kept as two triangles, so the mesh covers 100 % of the art by
 * construction.
 *
 * Ported from the reference implementation's `build_mesh` / `one_loop`. What
 * it does, in order:
 *
 * 1. **Cells.** A grid of `grid`-pixel squares over the (padded) part image;
 *    the last column and row are clipped to the image. A cell is kept when any
 *    pixel inside it has alpha above {@link ART_ALPHA}.
 * 2. **One loop.** rig-c refuses a mesh whose triangles' outline is not
 *    one closed loop, and a See-through layer is often two islands (a hairpin
 *    head and its tassel) or has a hole. So the kept cells are made one
 *    simply-connected region: holes filled (`scipy.ndimage.binary_fill_holes`,
 *    `fillHoles` here), every other 4-connected island bridged to the largest
 *    by a straight run of cells, and every diagonal pinch filled. The extra
 *    cells hold no art and draw nothing. The reference stopped after
 *    {@link ONE_LOOP_PASSES} passes and returned whatever it had; this port
 *    then CHECKS the outline and refuses a lattice that is still not one loop
 *    (`RIG_LATTICE_ONE_LOOP`), rather than hand rigc a mesh it would refuse
 *    with less to say about why.
 * 3. **Triangles.** Vertices are numbered in the order the kept cells first
 *    touch them (row-major cells, corners top-left, top-right, bottom-right,
 *    bottom-left); each cell is two triangles with the diagonal alternating by
 *    `(i + j) % 2` so the lattice has no preferred shear. Each triangle is
 *    built clockwise on screen (top-left, top-right, bottom-right), the
 *    reference's order, and written with its last two corners swapped
 *    ({@link counterClockwiseInSpineWorld}): the y flip to Spine's world does
 *    not turn a loop over, so a triangle clockwise on screen is clockwise in
 *    Spine world, and the winding rig-c reads a mesh in is
 *    counter-clockwise there (issue #126; rigc#1236). The swap is made after
 *    the boundary walk below, so no vertex index and no hull moves with it.
 * 4. **Boundary first.** Spine's `hull` is a count: the first `hull` vertices
 *    are the outline, in order. The outline is walked from the edges used by
 *    exactly one triangle, then every interior vertex follows in index order.
 * 5. **Coverage.** Every triangle is rasterised (`cv2.fillPoly`, `fillPoly`
 *    here) and the fraction of art pixels it covers is reported. By
 *    construction it is 1; it is measured anyway, because a claim that holds
 *    by construction is exactly the kind nobody re-reads.
 *
 * Every tie and every scan order above is the reference's, because each one
 * decides a vertex index, and a vertex index is what a weight is written
 * against.
 */
import { type Problem } from './errors.ts';
import { connectedComponents, fillHoles, fillPoly, type Mask, newMask } from './raster/index.ts';
import { rint } from './round.ts';

/** A pixel counts as art when its alpha is above this — the reference's `im[..., 3] > 8`. */
export const ART_ALPHA = 8;

/** How many hole-fill / bridge / pinch passes `oneLoop` makes before it stops — the reference's `range(50)`. */
export const ONE_LOOP_PASSES = 50;

export interface Lattice {
  /** Cells across and down. */
  nx: number;
  ny: number;
  /** Column and row edges in image pixels, `nx + 1` and `ny + 1` of them, the last clipped to the image. */
  xs: number[];
  ys: number[];
  /** `ny` rows of `nx` cells, 1 = kept. */
  cells: Mask;
}

/** The grid over an image and which of its cells hold an art pixel. */
export function latticeCells(art: Mask, grid: number): Lattice {
  const { width: w, height: h } = art;
  const nx = Math.ceil(w / grid);
  const ny = Math.ceil(h / grid);
  const xs = Array.from({ length: nx + 1 }, (_, i) => Math.min(i * grid, w));
  const ys = Array.from({ length: ny + 1 }, (_, j) => Math.min(j * grid, h));
  const cells = newMask(nx, ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let any = 0;
      for (let y = ys[j]; y < ys[j + 1] && any === 0; y++) {
        for (let x = xs[i]; x < xs[i + 1]; x++) {
          if (art.data[y * w + x] !== 0) {
            any = 1;
            break;
          }
        }
      }
      cells.data[j * nx + i] = any;
    }
  }
  return { nx, ny, xs, ys, cells };
}

/** `np.linspace(0, 1, num)` element by element: `k * (1 / (num - 1))`, the last exactly 1. */
function linspace01(num: number): number[] {
  const step = 1 / (num - 1);
  return Array.from({ length: num }, (_, k) => (k === num - 1 ? 1 : k * step));
}

export interface OneLoopResult {
  cells: Mask;
  /** Passes made; a pass that changes nothing ends the loop. */
  passes: number;
  /** Whether the last pass changed nothing — false when the pass limit ran out first. */
  settled: boolean;
}

/**
 * The reference's `one_loop`: fill holes, bridge islands to the largest,
 * fill diagonal pinches, repeat until a pass changes nothing or `maxPasses`
 * run out.
 *
 * A bridge from island cell (j0, i0) to main cell (j1, i1) — the pair at the
 * least squared distance, first in row-major order of island then main —
 * sets, at every `t` of `linspace(0, 1, 2 * (|dj| + |di|) + 2)`, the cells
 * (round(j0 + dj t), i0), (j1, round(i0 + di t)) and (round(j0 + dj t),
 * round(i0 + di t)), with NumPy's half-to-even rounding. The first two are an
 * L-shaped 4-connected run, so the bridge always connects.
 */
export function oneLoop(start: Mask, maxPasses: number = ONE_LOOP_PASSES): OneLoopResult {
  const nx = start.width;
  const ny = start.height;
  let cells: Mask = { width: nx, height: ny, data: new Uint8Array(start.data) };
  for (let pass = 0; pass < maxPasses; pass++) {
    cells = fillHoles(cells);
    const comp = connectedComponents(cells, 4);
    const islands = comp.count - 1;
    if (islands > 1) {
      let main = 1;
      for (let k = 2; k < comp.count; k++) if (comp.stats[k].area > comp.stats[main].area) main = k;
      const members = (label: number): Array<[number, number]> => {
        const out: Array<[number, number]> = [];
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (comp.labels[j * nx + i] === label) out.push([j, i]);
        return out;
      };
      const mainCells = members(main);
      for (let k = 1; k < comp.count; k++) {
        if (k === main) continue;
        const other = members(k);
        let best = Infinity;
        let a = 0;
        let b = 0;
        for (let p = 0; p < other.length; p++) {
          for (let q = 0; q < mainCells.length; q++) {
            const dj = other[p][0] - mainCells[q][0];
            const di = other[p][1] - mainCells[q][1];
            const d = dj * dj + di * di;
            if (d < best) {
              best = d;
              a = p;
              b = q;
            }
          }
        }
        const [j0, i0] = other[a];
        const [j1, i1] = mainCells[b];
        const set = (j: number, i: number): void => {
          cells.data[j * nx + i] = 1;
        };
        for (const t of linspace01(2 * (Math.abs(j1 - j0) + Math.abs(i1 - i0)) + 2)) {
          set(rint(j0 + (j1 - j0) * t), i0);
          set(j1, rint(i0 + (i1 - i0) * t));
          set(rint(j0 + (j1 - j0) * t), rint(i0 + (i1 - i0) * t));
        }
      }
      continue;
    }
    const snap = new Uint8Array(cells.data);
    const at = (j: number, i: number): number => snap[j * nx + i];
    let pinch = false;
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        if (at(j, i) && at(j + 1, i + 1) && !at(j, i + 1) && !at(j + 1, i)) {
          cells.data[j * nx + i + 1] = 1;
          pinch = true;
        } else if (at(j, i + 1) && at(j + 1, i) && !at(j, i) && !at(j + 1, i + 1)) {
          cells.data[j * nx + i] = 1;
          pinch = true;
        }
      }
    }
    if (!pinch) return { cells, passes: pass + 1, settled: true };
  }
  return { cells, passes: maxPasses, settled: false };
}

/**
 * Each triple `[a, b, c]` written `[a, c, b]`: the same triangles over the same
 * vertices, wound the other way round. A triangle list built clockwise on
 * screen (positive area in crop pixels, y down) is clockwise in Spine world as
 * well — flipping y changes the sign of a signed area, but Spine's world is
 * drawn with y up, so the loop turns the same way on screen as there — and
 * rig-c reads every mesh as counter-clockwise in Spine world (its
 * `MQ_ORIENTATION`; rigc#1236 turned its own `contour` and `ring` generators
 * for the same reason). The lattice ({@link triangulate}) and the contour mesh
 * (`src/contour.ts`) both build clockwise on screen and write through this,
 * once, at their output; nothing downstream turns them again (issue #126).
 */
export function counterClockwiseInSpineWorld(triangles: readonly number[]): number[] {
  const out: number[] = [];
  for (let t = 0; t < triangles.length; t += 3) out.push(triangles[t], triangles[t + 2], triangles[t + 1]);
  return out;
}

export interface LatticeMesh {
  /** Vertex positions in image pixels, boundary first. */
  vertices: Array<[number, number]>;
  /** Three vertex indices per triangle, into `vertices`, each counter-clockwise in Spine world. */
  triangles: number[];
  /** The first `hull` vertices are the outline. */
  hull: number;
  /** Closed outlines the triangles make — 1 for a mesh rigc will take. */
  loops: number;
  /** Boundary vertices touched by more or fewer than two boundary edges — 0 for a mesh rigc will take. */
  pinchedVertices: number;
  cells: number;
  passes: number;
}

/**
 * Triangles over the kept cells, boundary vertices first. Returns the loop
 * count and the pinched-vertex count rather than refusing, so the caller names
 * the part in its refusal.
 */
export function triangulate(lattice: Lattice, cells: Mask, passes: number): LatticeMesh {
  const { nx, ny, xs, ys } = lattice;
  const vid = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
  const pts: Array<[number, number]> = [];
  const tri: number[] = [];
  let kept = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (cells.data[j * nx + i] === 0) continue;
      kept++;
      const c: number[] = [];
      for (const [jj, ii] of [
        [j, i],
        [j, i + 1],
        [j + 1, i + 1],
        [j + 1, i],
      ]) {
        const k = jj * (nx + 1) + ii;
        if (vid[k] < 0) {
          vid[k] = pts.length;
          pts.push([xs[ii], ys[jj]]);
        }
        c.push(vid[k]);
      }
      if ((i + j) % 2 === 0) tri.push(c[0], c[1], c[2], c[0], c[2], c[3]);
      else tri.push(c[0], c[1], c[3], c[1], c[2], c[3]);
    }
  }
  // Boundary edges: used by exactly one triangle, counted in first-seen order
  // (the reference's Counter), then adjacency in that same order.
  const edgeCount = new Map<string, { a: number; b: number; n: number }>();
  for (let t = 0; t < tri.length; t += 3) {
    for (const [p, q] of [
      [tri[t], tri[t + 1]],
      [tri[t + 1], tri[t + 2]],
      [tri[t + 2], tri[t]],
    ]) {
      const a = Math.min(p, q);
      const b = Math.max(p, q);
      const key = `${a},${b}`;
      const e = edgeCount.get(key);
      if (e === undefined) edgeCount.set(key, { a, b, n: 1 });
      else e.n++;
    }
  }
  const adj = new Map<number, number[]>();
  const link = (p: number, q: number): void => {
    const list = adj.get(p);
    if (list === undefined) adj.set(p, [q]);
    else list.push(q);
  };
  for (const { a, b, n } of edgeCount.values()) {
    if (n !== 1) continue;
    link(a, b);
    link(b, a);
  }
  const order: number[] = [];
  const seen = new Set<number>();
  let loops = 0;
  for (const s of adj.keys()) {
    if (seen.has(s)) continue;
    loops++;
    let cur = s;
    let prev = -1;
    while (!seen.has(cur)) {
      seen.add(cur);
      order.push(cur);
      const next = (adj.get(cur) ?? []).filter((v) => v !== prev && !seen.has(v));
      if (next.length === 0) break;
      prev = cur;
      cur = next[0];
    }
  }
  let pinchedVertices = 0;
  for (const list of adj.values()) if (list.length !== 2) pinchedVertices++;
  const hull = order.length;
  for (let v = 0; v < pts.length; v++) if (!seen.has(v)) order.push(v);
  const remap = new Int32Array(pts.length);
  order.forEach((v, i) => (remap[v] = i));
  return {
    vertices: order.map((v) => pts[v]),
    triangles: counterClockwiseInSpineWorld(tri.map((v) => remap[v])),
    hull,
    loops,
    pinchedVertices,
    cells: kept,
    passes,
  };
}

/** The fraction of art pixels the triangles cover, rasterised as `cv2.fillPoly` would. */
export function artCoverage(mesh: Pick<LatticeMesh, 'vertices' | 'triangles'>, art: Mask): number {
  const ras = newMask(art.width, art.height);
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const corner = (k: number): [number, number] => {
      const [x, y] = mesh.vertices[mesh.triangles[t + k]];
      return [rint(x), rint(y)];
    };
    fillPoly(ras, [corner(0), corner(1), corner(2)]);
  }
  let artPx = 0;
  let covered = 0;
  for (let i = 0; i < art.data.length; i++) {
    if (art.data[i] === 0) continue;
    artPx++;
    if (ras.data[i] !== 0) covered++;
  }
  return artPx === 0 ? 0 : covered / artPx;
}

/**
 * The whole lattice step for one part: cells, one loop, triangles. Refusals
 * name the part: a part with no art pixel has no cell to keep, and a lattice
 * still not one closed outline after the passes is refused rather than handed on.
 */
export function latticeMesh(part: string, art: Mask, grid: number, maxPasses: number = ONE_LOOP_PASSES): LatticeMesh | Problem {
  return latticeMeshRows(part, art, grid, [], maxPasses);
}

/** Refine the original kept cells at supplied image rows; no new mask/bridge decision or omitted cell. */
export function latticeMeshRows(part: string, art: Mask, grid: number, rows: readonly number[], maxPasses: number = ONE_LOOP_PASSES): LatticeMesh | Problem {
  if (rows.some((y) => !Number.isFinite(y))) return { code: 'RIG_LATTICE_STATION', object: `mesh "${part}"`, detail: `station rows [${rows.join(', ')}] include a non-finite coordinate; supplied finite image rows are required` };
  const lattice = latticeCells(art, grid);
  let any = false;
  for (let i = 0; i < lattice.cells.data.length && !any; i++) any = lattice.cells.data[i] !== 0;
  if (!any) {
    return {
      code: 'RIG_PART_HAS_ART',
      object: `mesh "${part}"`,
      detail: `its ${art.width}x${art.height} image has no pixel with alpha above ${ART_ALPHA}, so the lattice keeps no cell; a mesh needs at least one art pixel`,
    };
  }
  const loop = oneLoop(lattice.cells, maxPasses);
  let refined = lattice;
  let kept = loop.cells;
  const extra = rows.filter((y) => y > 0 && y < art.height && !lattice.ys.includes(y));
  if (extra.length > 0) {
    const ys = [...new Set([...lattice.ys, ...extra])].sort((a, b) => a - b);
    kept = newMask(lattice.nx, ys.length - 1);
    let originalRow = 0;
    for (let j = 0; j < ys.length - 1; j++) {
      while (originalRow + 1 < lattice.ny && ys[j] >= lattice.ys[originalRow + 1]) originalRow++;
      kept.data.set(loop.cells.data.subarray(originalRow * lattice.nx, (originalRow + 1) * lattice.nx), j * lattice.nx);
    }
    refined = { ...lattice, ys, ny: ys.length - 1, cells: kept };
  }
  const mesh = triangulate(refined, kept, loop.passes);
  if (mesh.loops !== 1 || mesh.pinchedVertices !== 0) {
    return {
      code: 'RIG_LATTICE_ONE_LOOP',
      object: `mesh "${part}"`,
      detail:
        `after ${loop.passes} pass(es) of hole-fill, island-join and pinch-fill (${loop.settled ? 'settled' : `the limit of ${maxPasses} ran out`}) ` +
        `its ${lattice.nx}x${lattice.ny} lattice at grid ${grid} has ${mesh.loops} outline loop(s) and ${mesh.pinchedVertices} pinched boundary vertex(es); ` +
        'exactly one closed loop and none pinched are required (rig-c refuses any other outline)',
    };
  }
  return mesh;
}

/**
 * Dust (issue #265, Stage B's rule; moved here from `src/meshdraft.ts` by issue #303, so the rig stage's heat refusal
 * and `mesh-draft` read one line): an extra 4-connected island of the art of at most this many art px …
 */
export const DUST_MAX_PX = 4;

/** … and at most this share of the part's art px. */
export const DUST_MAX_SHARE = 0.001;

/** Whether an island of `area` art px is dust in a part of `artPixels` art px ({@link DUST_MAX_PX}, {@link DUST_MAX_SHARE}). */
export function isDust(area: number, artPixels: number): boolean {
  return area <= DUST_MAX_PX && area <= DUST_MAX_SHARE * artPixels;
}

/** What a declared `meshes.<part>.stray` left out of a lattice's art (issue #303). */
export interface LatticeStray {
  /** The art the lattice is built over: `art` itself when nothing was left out. */
  art: Mask;
  /** Islands left out, and their art px. */
  islands: number;
  pixels: number;
  /** The art px of the part before anything was left out. */
  artPixels: number;
  /** The area of the largest island; an island this large is never left out. */
  largest: number;
}

/**
 * The lattice's `stray` (issue #303), the contour mode's field with the same meaning — the largest island, in art
 * pixels, that may be left out of the mesh — read over the same islands: the 4-connected islands of the art (alpha
 * above {@link ART_ALPHA}). Every island of `stray` art px or fewer is cleared from the art the lattice and its heat
 * silhouette are built over, except an island as large as the largest, which is never left out (two equal largest
 * pieces both stay: leaving one would be a choice the declaration does not make). Unlike the contour mode, an island
 * above the figure is not refused: the lattice bridges every island it keeps (step 2 above), so it is meshed as it
 * always was. The part's image is not touched; `artCoverage` is read over all the art, the islands left out included.
 */
export function latticeStray(art: Mask, stray: number): LatticeStray {
  const comp = connectedComponents(art, 4);
  let largest = 0;
  let artPixels = 0;
  for (let l = 1; l < comp.count; l++) {
    largest = Math.max(largest, comp.stats[l].area);
    artPixels += comp.stats[l].area;
  }
  const out = new Uint8Array(comp.count);
  let islands = 0;
  let pixels = 0;
  for (let l = 1; l < comp.count; l++) {
    const a = comp.stats[l].area;
    if (a <= stray && a < largest) {
      out[l] = 1;
      islands++;
      pixels += a;
    }
  }
  if (islands === 0) return { art, islands, pixels, artPixels, largest };
  const data = new Uint8Array(art.data);
  for (let i = 0; i < data.length; i++) if (out[comp.labels[i]] === 1) data[i] = 0;
  return { art: { width: art.width, height: art.height, data }, islands, pixels, artPixels, largest };
}
