/** Analytic fields and coverage fixtures independent of private data. */
import { join } from 'node:path';
import { constrainDepthMesh, depthWeights, depthUV, locateDepthUV, refineDepthMesh, DepthLeastSquares, depthRational as Q, type DepthFraction, type DepthSample, type DepthUV } from '../src/depthmesh.ts';
import { coverageConstraints, depthAlpha, type CoverageSurface } from '../src/depthcoverage.ts';
import { depthRefuse, readDepthInput, sampleDepth, type DepthField } from '../src/depthinput.ts';
import { applyDepthSurface, projectDepth, depthRoundingReserve } from '../src/depthsurface.ts';
import type { DeformMeshAttachment } from '../src/turn.ts';
import { depthMotion, depthRefusal, depthRig, writeDepthFixture, type DepthSay } from './check_depthsurface.ts';
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-8;
const quad = (): DeformMeshAttachment => ({ type: 'mesh', image: 'public.png', width: 4, height: 4, hull: 4, uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 0, 2, 3], weights: [[0, 0], [4, 0], [4, 4], [0, 4]].map(([x, y]) => [{ bone: 'root', x, y, weight: 1 }]) });
const grid = (f: (uv: DepthUV) => number): DepthSample[] => Array.from({ length: 64 }, (_, i) => { const uv: DepthUV = [(i % 8 + 0.5) / 8, (Math.floor(i / 8) + 0.5) / 8]; return { uv, z: f(uv) }; });
/** Frozen product-then-Euclid reference, independent of algebraic fast paths. */
function referenceFraction(n: bigint, d: bigint): DepthFraction {
  if (d === 0n) return depthRefuse('RIG_DEPTH_MESH_TOPOLOGY', 'partition construction', 'zero exact divisor');
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n, b = d; while (b) { const r = a % b; a = b; b = r; }
  return { n: n / a, d: d / a };
}
function referenceNumber(a: DepthFraction): number {
  const head = (n: bigint): { n: bigint; e: number } => { const bits = (n < 0n ? -n : n).toString(2).length, e = Math.max(0, bits - 53); return { n: n < 0n ? -((-n) >> BigInt(e)) : n >> BigInt(e), e }; };
  const x = head(a.n), y = head(a.d); return Number(x.n) / Number(y.n) * 2 ** (x.e - y.e);
}
function runRationalControls(say: DepthSay): void {
  const reference = {
    add: (a: DepthFraction, b: DepthFraction): DepthFraction => referenceFraction(a.n * b.d + b.n * a.d, a.d * b.d),
    sub: (a: DepthFraction, b: DepthFraction): DepthFraction => referenceFraction(a.n * b.d - b.n * a.d, a.d * b.d),
    mul: (a: DepthFraction, b: DepthFraction): DepthFraction => referenceFraction(a.n * b.n, a.d * b.d),
    div: (a: DepthFraction, b: DepthFraction): DepthFraction => referenceFraction(a.n * b.d, a.d * b.n),
  };
  const same = (a: DepthFraction, b: DepthFraction): boolean => a.n === b.n && a.d === b.d && a.d > 0n && Q.key([a, a]) === `${b.n}/${b.d},${b.n}/${b.d}` && Object.is(Q.number(a), referenceNumber(b));
  let operations = 0, refusals = 0;
  const capture = (f: () => DepthFraction): DepthFraction | string => { try { return f(); } catch (e) { if (!(e instanceof Error)) throw e; return `${e.name}:${e.message}`; } };
  const pairs = (operands: DepthFraction[]): void => {
    for (const a of operands) for (const b of operands) for (const op of ['add', 'sub', 'mul', 'div'] as const) {
      const expected = capture(() => reference[op](a, b)), actual = capture(() => Q[op](a, b)); operations++;
      if (typeof expected === 'string') { if (expected !== actual) throw Error(`Exact refusal differs for ${op}`); refusals++; }
      else if (typeof actual === 'string' || !same(actual, expected)) throw Error(`Canonical fraction/key/Float64 differs for ${op}: ${a.n}/${a.d}, ${b.n}/${b.d}`);
    }
  };
  const grid: DepthFraction[] = [];
  // Unreduced and signed operands exercise more than the internal positive-D API.
  for (let n = -8; n <= 8; n++) for (let d = -8; d <= 8; d++) if (d !== 0) grid.push({ n: BigInt(n), d: BigInt(d) });
  pairs(grid);
  say('EXACT_RATIONAL_GRID', operations === grid.length ** 2 * 4 && refusals > 0, `${operations} product-reference comparisons over exhaustive numerators[-8,8], denominators[-8,8] except0; reduced n/d, positiveD, canonical0, key and Object.is Float64 identical; ${refusals} signed divide-by-zero refusals identical`);
  const wide: DepthFraction[] = [{ n: 0n, d: 1n }, { n: 1n, d: 0n }, { n: -1n, d: 0n }, { n: 0n, d: 0n }];
  for (const power of [53, 127, 257, 521, 1074, 1100]) for (const sign of [-1n, 1n]) { const v = 1n << BigInt(power); wide.push({ n: sign * (v - 1n), d: v }, { n: sign * v, d: v - 1n }, { n: sign * (v + 1n) * 15n, d: (v - 1n) * 21n }, { n: sign, d: v }, { n: sign * v, d: 1n }); }
  const before = operations; pairs(wide);
  say('EXACT_RATIONAL_WIDE_AND_ERRORS', operations - before === wide.length ** 2 * 4, `${operations - before} wide integer/power2/cross-cancellation/signed-zero/invalid-divisor comparisons; head53 conversion including underflow and signed0 preserved`);
  say('EXACT_RATIONAL_CORRUPTION_PLANTS', !same({ n: 10n, d: 12n }, { n: 5n, d: 6n }) && !same({ n: -5n, d: -6n }, { n: 5n, d: 6n }) && !same({ n: 0n, d: 2n }, { n: 0n, d: 1n }) && !same({ n: 5n, d: 6n }, { n: -5n, d: 6n }), 'equal-valued unreduced/negative-D/noncanonical-zero and wrong-sign plants are RED under the exact comparator');
}
/** Independent invariants over each actual insertion, not producer leaf data. */
function auditSubdivision(seed: DeformMeshAttachment, mesh: Readonly<DeformMeshAttachment>): void {
  const xy = (i: number): DepthUV => [mesh.uvs[2 * i], mesh.uvs[2 * i + 1]], determinant = (a: DepthUV, b: DepthUV, c: DepthUV): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const seedArea = (ids: readonly number[]): number => determinant(...ids.map(i => depthUV(seed, i)) as [DepthUV, DepthUV, DepthUV]);
  const sign = Math.sign(seedArea(seed.triangles.slice(0, 3))), edges = new Map<string, { a: number; b: number; count: number; direction: number }>(); let area = 0;
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const ids = mesh.triangles.slice(t, t + 3), d = determinant(...ids.map(xy) as [DepthUV, DepthUV, DepthUV]); if (!(d * sign > 0)) throw Error('Independent orientation invariant failed'); area += d;
    for (let k = 0; k < 3; k++) { const a = ids[k], b = ids[(k + 1) % 3], key = [Math.min(a, b), Math.max(a, b)].join(','); let e = edges.get(key); if (!e) { e = { a, b, count: 0, direction: 0 }; edges.set(key, e); } e.count++; e.direction += a < b ? 1 : -1; }
  }
  let originalArea = 0; for (let t = 0; t < seed.triangles.length; t += 3) originalArea += seedArea(seed.triangles.slice(t, t + 3));
  if (Math.abs(area - originalArea) > 1e-12 || mesh.weights.length - edges.size + mesh.triangles.length / 3 !== 1 || [...edges.values()].some(e => e.count > 2 || (e.count === 2 && e.direction !== 0))) throw Error('Independent area/adjacency/Euler invariant failed');
  const boundary = [...edges.values()].filter(e => e.count === 1), next = new Map(boundary.map(e => [e.a, e.b])); let at = 0, visited = 0;
  do { const to = next.get(at); if (to === undefined || visited++ > boundary.length) throw Error('Independent hull invariant failed'); at = to; } while (at !== 0);
  if (visited !== boundary.length) throw Error('Independent multiple hull loops');
  // Every original edge survives as a complete chain, including shared edges.
  for (let t = 0; t < seed.triangles.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = depthUV(seed, seed.triangles[t + k]), b = depthUV(seed, seed.triangles[t + (k + 1) % 3]), length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const on = (p: DepthUV): boolean => determinant(a, b, p) === 0 && (p[0] - a[0]) * (p[0] - b[0]) + (p[1] - a[1]) * (p[1] - b[1]) <= 0;
    const retained = [...edges.values()].filter(e => on(xy(e.a)) && on(xy(e.b))).reduce((sum, e) => sum + Math.hypot(xy(e.a)[0] - xy(e.b)[0], xy(e.a)[1] - xy(e.b)[1]), 0);
    if (Math.abs(retained - length) > 1e-12) throw Error('Independent seed-edge chain lost');
  }
}
function runInsertionControls(say: DepthSay): void {
  let checks = 0;
  const observe = (seed: DeformMeshAttachment) => (mesh: Readonly<DeformMeshAttachment>): void => { auditSubdivision(seed, mesh); checks++; };
  for (const delta of [0, 1 / 2 ** 26, -1 / 2 ** 26, 1 / 2 ** 45, -1 / 2 ** 45]) {
    const uv: DepthUV = [1 / 2, 1 / 2 + delta], seed = quad(), peak = (p: DepthUV): number => p[0] === uv[0] && p[1] === uv[1] ? 1 : 0;
    const result = refineDepthMesh(seed, [{ uv, z: 1 }], peak, 8, observe(seed));
    if (result.mesh.weights.length !== 5 || result.mesh.triangles.length !== 12 || result.max !== 0) throw Error('Independent off-edge insertion failed');
  }
  say('TOPOLOGY_NEAR_EDGE', true, 'unit diagonal and signed rational offsets2^-26/2^-45: each actual insertion preserves edge chains, area, orientation and <=2 incidence; old tolerance plant is RED');
  const nearVertex: DepthUV = [1 / 2 ** 40, 2 / 2 ** 40], seed = quad(), nearPeak = (p: DepthUV): number => p[0] === nearVertex[0] && p[1] === nearVertex[1] ? 1 : 0;
  const vertex = refineDepthMesh(seed, [{ uv: nearVertex, z: 1 }], nearPeak, 8, observe(seed));
  say('TOPOLOGY_NO_SNAPPING', vertex.mesh.weights.length === 5 && vertex.max === 0, 'a distinct rational point within the former coincidence epsilon is inserted without moving UVs');
  const edge: DepthUV = [1 / 2, 0], hull = refineDepthMesh(seed, [{ uv: edge, z: 1 }], p => p[0] === edge[0] && p[1] === edge[1] ? 1 : 0, 8, observe(seed));
  auditSubdivision(seed, hull.mesh);
  say('TOPOLOGY_BOUNDARY_SPLIT', hull.mesh.hull === 5 && hull.mesh.triangles.length === 9 && hull.mesh.uvs.slice(0, hull.mesh.hull * 2).filter((_, i) => i % 2 === 0).length === 5, 'exact boundary insertion retains one closed hull prefix and all old boundary segments');
  let runs = 0, maxWeightError = 0;
  const frames: Record<string, number[]> = { a: [2, 1 / 2, -1, 3, 4, 5], b: [-1, 2, 1 / 4, 1 / 2, -3, 7] };
  const pose = (row: DeformMeshAttachment['weights'][number]): number[] => row.reduce((v, p) => { const f = frames[p.bone]; return [v[0] + p.weight * (f[0] * p.x + f[1] * p.y + f[4]), v[1] + p.weight * (f[2] * p.x + f[3] * p.y + f[5])]; }, [0, 0]);
  for (const reverse of [false, true]) for (const power of [2, 3, 4]) for (const cap of [4, 16, 64]) {
    const seed = quad(); seed.weights = seed.weights.map((row, i) => [{ ...row[0], bone: 'a', weight: (i + 1) / 4 }, { bone: 'b', x: row[0].x / 2, y: row[0].y / 2, weight: 1 - (i + 1) / 4 }]); if (reverse) seed.triangles = [0, 2, 1, 0, 3, 2];
    const side = 2 ** power, field = (p: DepthUV): number => p[0] ** 2 + 2 * p[1] ** 2 + p[0] * p[1];
    const samples = Array.from({ length: side * side }, (_, i) => { const uv: DepthUV = [(i % side + 1 / 2) / side, (Math.floor(i / side) + 1 / 2) / side]; return { uv, z: field(uv) }; });
    const inspect = (mesh: Readonly<DeformMeshAttachment>): void => {
      auditSubdivision(seed, mesh); checks++;
      for (let i = 0; i < mesh.weights.length; i++) { const [u, v] = [mesh.uvs[i * 2], mesh.uvs[i * 2 + 1]], ids = v <= u ? [0, 1, 2] : [0, 2, 3], w = v <= u ? [1 - u, u - v, v] : [1 - v, u, v - u], expected = [0, 1].map(k => ids.reduce((sum, id, j) => sum + pose(seed.weights[id])[k] * w[j], 0)), actual = pose(mesh.weights[i]); maxWeightError = Math.max(maxWeightError, ...actual.map((x, k) => Math.abs(x - expected[k]))); }
    };
    const result = refineDepthMesh(seed, samples, field, cap, inspect); inspect(result.mesh); const repeat = refineDepthMesh(seed, samples, field, cap);
    if (JSON.stringify(result) !== JSON.stringify(repeat) || result.samples !== samples.length || result.mesh.triangles.length / 3 > cap) throw Error('Independent grid determinism/count/cap failed'); runs++;
  }
  say('TOPOLOGY_GRID_INVARIANTS', runs === 18 && checks > 100 && maxWeightError < 1e-12, `${runs} exhaustive dyadic grids/caps/windings, ${checks} seed/insertion/final audits; manifold adjacency, orientation, hull, signed area, every seed-edge chain; affine weight error ${maxWeightError}; deterministic repeats`);
  const invalid = quad(); invalid.triangles.push(0, 1, 3);
  say('TOPOLOGY_INVALID_SEED', depthRefusal(() => refineDepthMesh(invalid, [], () => 0, 16)).includes('RIG_DEPTH_MESH_TOPOLOGY'), 'invalid seed is refused, never repaired by dropping triangles');
}
function runRejectionCacheControl(say: DepthSay): void {
  let otherReads=0,attempts=0,otherAtSecond=-1;
  const samples:DepthSample[]=[{uv:[0.75,0.25],z:3},{uv:[0.875,0.125],z:2},{uv:[0.25,0.75],get z(){otherReads++;return 1;}}];
  const reject=(mesh:DeformMeshAttachment):string|null=>{if(mesh.weights.length===4)return null;attempts++;if(attempts===2)otherAtSecond=otherReads;return 'independent optional rejection';};
  const query=(p:DepthUV):number=>p[0]===0.75&&p[1]===0.25?3:p[0]===0.875&&p[1]===0.125?2:p[0]===0.25&&p[1]===0.75?1:0;
  const result=refineDepthMesh(quad(),samples,query,16,undefined,reject);
  say('REJECTION_CACHE_OWNERSHIP',attempts===3&&otherAtSecond===1&&otherReads===3&&result.mesh.weights.length===4&&result.rejectedSplits.length===3&&near(result.rms,Math.sqrt(14/3))&&result.max===3,'two rejected samples in one source triangle do not reread the other triangle; source getters return fixed values, residual/RMS/rejection order unchanged, no field or tolerance change');
}
function runFieldControls(say: DepthSay): void {
  const same = new DepthLeastSquares(1); same.add({ ids: [0], values: [1] }, 0, 1); same.add({ ids: [0], values: [1] }, 2, 3); const joint = same.solve([]);
  say('COUPLED_AREA_LS', near(joint.values[0], 1.5) && near(joint.report.objective, 0.75), 'eliminated protected equality: source areas1,3 and targets0,2 give the hand optimum1.5; no owner copy or part coefficient');
  const limited = new DepthLeastSquares(2); limited.add({ ids: [0], values: [1] }, 0, 1); limited.add({ ids: [1], values: [1] }, 4, 1);
  const fit = limited.solve([{ ids: [0, 1], values: [-1, 1], upper: 2, object: 'independent gradient' }]);
  say('CONSTRAINED_LS_OPTIMUM', Math.abs(fit.values[0] - 1) < 1e-6 && Math.abs(fit.values[1] - 3) < 1e-6 && fit.report.primal < 1e-8, 'equal-area targets0,4 with difference<=2 give unique optimum1,3, not a constant or gain shrink');
  const endpoints=():DepthLeastSquares=>{const q=new DepthLeastSquares(2);q.add({ids:[0,1],values:[0.75,0.25]},0,1);q.add({ids:[0,1],values:[0.25,0.75]},1,1);return q;};
  const free=endpoints().solve([]),boxed=endpoints().solve([{ids:[0],values:[1],upper:1,object:'a<=1'},{ids:[0],values:[-1],upper:1,object:'a>=-1'},{ids:[1],values:[1],upper:1,object:'b<=1'},{ids:[1],values:[-1],upper:1,object:'b>=-1'}]);
  say('DECLARED_RANGE_IN_QP',near(free.values[0],-0.5)&&near(free.values[1],1.5)&&Math.abs(boxed.values[0]+0.2)<1e-6&&Math.abs(boxed.values[1]-1)<1e-6&&Math.abs(boxed.report.objective-0.05)<1e-7,'hand line samples(t=.25,z=0),(.75,1): free endpoints(-.5,1.5)overshoot; fixed symmetric[-1,1]QP gives unique(-.2,1),objective.05, not posthocclipping(-.5,1)');
  const impossible = new DepthLeastSquares(1); impossible.add({ ids: [0], values: [1] }, 0, 1);
  say('SOLVER_CONTRADICTION_PLANT', depthRefusal(() => impossible.solve([{ ids: [0], values: [1], upper: 0, object: 'x<=0' }, { ids: [0], values: [-1], upper: -1, object: 'x>=1' }])).includes('RIG_DEPTH_FIELD_SOLVE'), 'analytic inconsistent halfspaces cannot silently return a constant fallback');
  const seed = quad(); seed.weights.forEach(ws => { ws[0].x += 1000; ws[0].y += 1000; });
  const bad: DepthUV = [0.5, 0.5 + 2 ** -26], good: DepthUV = [0.25, 0.75], query = (p: DepthUV): number => p[0] === bad[0] && p[1] === bad[1] ? 2 : p[0] === good[0] && p[1] === good[1] ? 1 : 0;
  const eligible = (mesh: DeformMeshAttachment, children: readonly number[][]): string | null => { const p = mesh.weights.map(row => [Math.fround(row[0].x), Math.fround(row[0].y)]); for (const [a, b, c] of children) if (!((p[b][0] - p[a][0]) * (p[c][1] - p[a][1]) - (p[b][1] - p[a][1]) * (p[c][0] - p[a][0]) > 0)) return 'neutral Float32 child collapses'; return null; };
  const result = refineDepthMesh(seed, [{ uv: bad, z: 2 }, { uv: good, z: 1 }], query, 16, undefined, eligible);
  say('UNADMITTED_PRECISION_ELIGIBILITY', result.rejectedSplits.length > 0 && result.mesh.weights.length === 5 && result.max > 0 && result.mesh.uvs.some((v, i) => i % 2 === 0 && v === good[0] && result.mesh.uvs[i + 1] === good[1]), 'translated1000frame: largest-error near-edge child unrepresentable, recorded; next eligible point inserted; rejected source error retained');
  const thinSeed=quad(),thin:DepthUV=[0.5,0.5001],regular:DepthUV=[0.25,0.75],source=(p:DepthUV):number=>p[0]===thin[0]&&p[1]===thin[1]?2:p[0]===regular[0]&&p[1]===regular[1]?1:0;
  const certified=(mesh:DeformMeshAttachment,children:readonly number[][]):string|null=>{const points=mesh.weights.map(w=>[Math.fround(w[0].x),Math.fround(w[0].y)]as DepthUV);for(const ids of children){const reserve=depthRoundingReserve(ids.map(i=>points[i]),0.0001,Math.sin(Math.PI/12),Math.sin(Math.PI/15));if(!(reserve<1))return `positive neutral child fails export-rounding reserve ${reserve}`;}return null;};
  const certificate=refineDepthMesh(thinSeed,[{uv:thin,z:2},{uv:regular,z:1}],source,16,undefined,certified);
  say('POSITIVE_UNCERTIFIABLE_OPTIONAL_CHILD',certificate.rejectedSplits.some(r=>r.uv[0]===thin[0]&&r.uv[1]===thin[1]&&r.reason.includes('export-rounding'))&&certificate.mesh.weights.length===5&&certificate.max>0,'hand four-unit square: near-diagonal child remains positive atFloat32 but four-decimal rounding reserve exceeds1; rejected/logged, next eligible point inserted and source residual retained');
  const invalid = structuredClone(seed); invalid.weights[2][0] = { ...invalid.weights[1][0] };
  say('INVALID_EXPORT_SEED_PLANT', depthRefusal(() => refineDepthMesh(invalid, [], () => 0, 16, undefined, eligible)).includes('RIG_DEPTH_MESH_PRECISION'), 'original invalid seed is refused; eligibility never drops admitted triangles');
}
export function runDepthMeshChecks(dir: string, say: DepthSay): void {
  runRationalControls(say);
  runInsertionControls(say);
  runRejectionCacheControl(say);
  runFieldControls(say);
  const plane = (uv: DepthUV): number => 2 + 3 * uv[0] - 4 * uv[1], seed = quad(), planar = refineDepthMesh(seed, grid(plane), plane, 128);
  say('LINEAR_GRADIENT', planar.mesh.weights.length === 4 && planar.max < 1e-10, 'a steep linear gradient is already exact; no uniform-grid density is invented');
  const peak = (uv: DepthUV): number => near(uv[0], 0.5) && near(uv[1], 0.5) ? 1 : 0, hill = refineDepthMesh(seed, [{ uv: [0.5, 0.5], z: 1 }], peak, 4);
  say('CURVATURE_SPLIT', hill.mesh.weights.length === 5 && hill.mesh.triangles.length / 3 === 4 && hill.max === 0 && hill.mesh.hull === 4, 'analytic centre peak splits BOTH triangles sharing the seed diagonal; original hull retained');
  const hit = locateDepthUV(hill.mesh, [0.5, 0.5]); if (!hit) throw Error('analytic hill point absent'); const vertexZ = hill.mesh.weights.map((_, i) => peak(depthUV(hill.mesh, i))), represented = hit.ids.reduce((s, id, j) => s + vertexZ[id] * hit.w[j], 0);
  say('COARSE_PLANT', represented === 1 && !near(seed.weights.reduce((s, _, i) => s + peak(depthUV(seed, i)), 0), represented), 'new field retains peak1; old seed-corner-only interpolation0 is explicitly RED');
  const curved = (uv: DepthUV): number => uv[0] * (1 - uv[0]) * uv[1] * (1 - uv[1]), a = refineDepthMesh(seed, grid(curved), curved, 16), b = refineDepthMesh(seed, grid(curved), curved, 16);
  say('BUDGET_AND_TIES', a.exhausted && a.mesh.triangles.length / 3 <= 16 && a.max > 0 && JSON.stringify(a) === JSON.stringify(b), 'fixed cap stops with reported nonzero residual; deterministic row/triangle ties; no escalation');
  say('MANDATORY_BUDGET', depthRefusal(() => constrainDepthMesh(seed, [[[0, 0], [1, 0], [1, 1]], [[0, 0], [1, 1], [0, 1]]], 1)).includes('RIG_DEPTH_MESH_BUDGET'), 'a seed/constraint set above cap is a named refusal');
  const cut = constrainDepthMesh(seed, [[[0, 0], [1, 0], [1, 1]], [[0, 0], [1, 1], [0.5, 1]], [[0, 0], [0.5, 1], [0, 1]]], 8);
  say('CONFORMING_HULL', cut.hull === 5 && cut.triangles.length / 3 === 3 && cut.weights.length === 5, 'boundary insertion joins the hull prefix; no dangling T junction or dropped UV cell');
  const weighted = quad(); weighted.weights[0] = [{ bone: 'a', x: 0, y: 0, weight: 1 }]; weighted.weights[1] = [{ bone: 'a', x: 4, y: 0, weight: 0.25 }, { bone: 'b', x: 2, y: 3, weight: 0.75 }]; weighted.weights[2] = [{ bone: 'b', x: -1, y: 5, weight: 1 }];
  const w = [0.2, 0.3, 0.5], interpolated = depthWeights(weighted, [0, 1, 2], w), frames = { a: [2, 0.5, -1, 3, 4, 5], b: [-1, 2, 0.25, 0.5, -3, 7] };
  const world = (row: typeof interpolated): number[] => row.reduce((sum, p) => { const f = frames[p.bone as keyof typeof frames]; return [sum[0] + p.weight * (f[0] * p.x + f[1] * p.y + f[4]), sum[1] + p.weight * (f[2] * p.x + f[3] * p.y + f[5])]; }, [0, 0]);
  const expected = [0, 1].map(k => [0, 1, 2].reduce((s, id, j) => s + world(weighted.weights[id])[k] * w[j], 0)), actual = world(interpolated);
  say('WEIGHT_AFFINE', actual.every((v, i) => near(v, expected[i])) && near(interpolated.reduce((s, p) => s + p.weight, 0), 1), 'premultiplied transfer equals barycentric skinning through independent reflected/scaled/sheared affine frames');
  const field: DepthField = { width: 4, height: 4, valid: [0, 6, 9, 15], mask: Uint8Array.from({ length: 16 }, (_, i) => [0, 6, 9, 15].includes(i) ? 1 : 0), values: Float64Array.from({ length: 16 }, (_, i) => i / 15), reference: 0 };
  let matches = 0, maxNearest = 0;
  for (let y = -1; y <= 5; y += 0.25) for (let x = -1; x <= 5; x += 0.25) { let best = -1, dist = Infinity; for (const i of field.valid) { const d = (i % 4 - x) ** 2 + (Math.floor(i / 4) - y) ** 2; if (d < dist) { best = i; dist = d; } } const got = sampleDepth(field, (x + 0.5) / 4, (y + 0.5) / 4, { kind: 'nearest-core', maxDistance: 20 }); if (got.continued > 0) { maxNearest = Math.max(maxNearest, Math.abs(got.value - field.values[best]), Math.abs(got.continued - Math.sqrt(dist))); matches++; } }
  say('SEARCH_CONFORMANCE', matches > 600 && maxNearest === 0 && sampleDepth(field, 0.5, 0.5, { kind: 'nearest-core', maxDistance: 20 }).value === 6 / 15, 'static spatial index matches exhaustive row-first nearest search, including exact ties');
  const image = { width: 4, height: 4, data: new Uint8ClampedArray(64).fill(255) }, subject: CoverageSurface = { mesh: seed, points: [[0, 0], [4, 0], [4, 4], [0, 4]], z: [0, 0, 0, 0], image }, coverer: CoverageSurface = { mesh: quad(), points: [[1, 0], [3, 0], [3, 2], [1, 2]], z: [2, 2, 2, 2], image };
  const cells = coverageConstraints(subject, coverer, 128), constrained = constrainDepthMesh(seed, cells.cells, 128, cells.exact);
  say('COVERAGE_CELLS', cells.protectedTexels === 4 && cells.carriedCells > 0 && constrained.triangles.length / 3 > 2 && cells.value([0.375, 0.125]) === 2 && cells.value([0.125, 0.875]) === null, 'four source-owned protected texels; overlap constraints, no neutral-visible material point relabelled protected');
  let coExposed = 0, wrongExposed = 0;
  for (const x of [1.5, 2.5]) for (const y of [0.5, 1.5]) { const p = projectDepth(x, y, cells.value([x / 4, y / 4]) ?? 0, 90, 0); if (p[0] < 3 || p[0] > 5) coExposed++; if (x < 3 || x > 5) wrongExposed++; }
  say('COVERAGE_TRANSPORT_PLANT', coExposed === 0 && wrongExposed === 4, 'same original material points stay covered under shared Z; cover-only displacement exposes all four and is RED');
  const islandPixels = new Uint8ClampedArray(64); islandPixels.set([255, 255, 255, 255], (1 * 4 + 1) * 4);
  const islandImage = { width: 4, height: 4, data: islandPixels }, islandCover: CoverageSurface = { ...subject, z: [2, 2, 2, 2], image: islandImage }, beforeIsland = JSON.stringify(subject);
  const strictIsland = depthRefusal(() => coverageConstraints(subject, islandCover, 128));
  say('ALPHA_STRICT_UNFINISHED', strictIsland.includes('RIG_DEPTH_COVERAGE_ALPHA_UNSUPPORTED'), 'mixed-alpha strict mode remains a named refusal; no implicit pilot');
  const island = coverageConstraints(subject, islandCover, 128, false, { mode: 'mixed-alpha-final-coverer', label: 'EYE-CHECK PILOT, not shippable' }), islandMesh = constrainDepthMesh(seed, island.cells, 2048, island.exact), islandCount = islandMesh.triangles.length / 3;
  say('ALPHA_ISLAND_VALUES', island.protectedAt([0.375, 0.375]) && island.value([0.375, 0.375]) === 2 && island.value([0.875, 0.875]) === 2 && island.fallbacks.length > 0 && JSON.stringify(subject) === beforeIsland, 'EXPLICIT EYE-CHECK PILOT only: mixed cell follows final coverer field including padding; every fallback is reported, no shippable alpha ownership claim');
  say('ALPHA_STITCHED_BUDGET', islandCount <= 2048 && depthRefusal(() => constrainDepthMesh(seed, island.cells, islandCount - 1, island.exact)).includes('RIG_DEPTH_MESH_BUDGET'), `actual conforming island constraints use ${islandCount} triangles; cap atN passes andN-1 fires real producer budget`);
  const low = { ...image, data: new Uint8ClampedArray(64).fill(127) }, high = { ...image, data: new Uint8ClampedArray(64).fill(128) };
  say('ALPHA_BOUNDARY', depthAlpha(low, [0.5, 0.5]) * 255 < 128 && depthAlpha(high, [0.5, 0.5]) * 255 >= 128, 'unretuned 127/128 threshold with the actual bilinear sampler');
  writeDepthFixture(dir); const input = readDepthInput(join(dir, 'depth.json')); input.manifest.coverage.overlaps = [{ subject: 'panel', coverer: 'anchor' }]; const rig = depthRig(); const anchor = rig.skins.default.anchor.anchor; if ('type' in anchor) throw Error('public region absent'); anchor.x = 0;
  const motion = depthMotion(), report = applyDepthSurface(rig, motion, input, { yaw: 15, pitch: 12 });
  say('COVERAGE_ENTRY', report.coverage[0].protectedTexels === 64 && motion.animations.turn.deform?.length === 2 && motion.animations.tilt.deform?.length === 2 && report.regions.every(r => r.emittedZ.every(z => near(z, 128 / 255))), 'actual joint producer entry: equal source areas and protected equality fit both final fields to128/255; no frozen-owner/raw-copy law');
  const split = report.regions.find(r => r.part === 'panel');
  say('RAW_REPORT_SPLIT', split?.rawSourceCore.samples === 64 && split.rawContinuedBoundary.samples === 0 && split.rawContinuedBoundary.rms === null && split.rawNeutralVisible.samples === 0 && split.rawNeutralProtected.samples === 64 && split.rawCarried.samples === 64 && near(split.rawNeutralProtected.rms ?? -1, 128 / 255), 'coupled-fit source error remains reported:64core/protected/carried, no visible/continued; empty sets null, RAWprotectederror128/255');
  const order = readDepthInput(join(dir, 'depth.json')); order.manifest.coverage.overlaps = [{ subject: 'anchor', coverer: 'panel' }];
  say('ORDER_PLANT', depthRefusal(() => applyDepthSurface(depthRig(), depthMotion(), order, { yaw: 15, pitch: 12 })).includes('RIG_DEPTH_COVERAGE'), 'an earlier draw cannot be a covering owner');
  const ambiguous = readDepthInput(join(dir, 'depth.json')); ambiguous.manifest.coverage.overlaps = [{ subject: 'panel', coverer: 'anchor' }, { subject: 'panel', coverer: 'anchor' }];
  say('OWNERSHIP_PLANT', depthRefusal(() => applyDepthSurface(depthRig(), depthMotion(), ambiguous, { yaw: 15, pitch: 12 })).includes('RIG_DEPTH_COVERAGE'), 'duplicate/ambiguous covering owners refuse, no guessed blend');
}
