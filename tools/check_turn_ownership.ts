/** Reference is the existing linear sampler, not the new sparse ownership table. */
import { rasterTurnTriangleOwnership, turnTriangleCoordinates, type TurnTriangleQuery } from '../src/turnfield.ts';

type Say = (name: string, ok: boolean, detail: string) => void;
export function runTurnOwnershipChecks(say: Say): void {
  const queries: TurnTriangleQuery[] = [];
  for (let y = -5; y <= 5; y += 0.25) for (let x = -5; x <= 5; x += 0.25) queries.push({ x, y, point: [x, y] });
  queries.push({ x: 20, y: 20, point: [4 + Number.EPSILON * 4, 0] }, { x: 21, y: 20, point: [4 - Number.EPSILON * 4, 0] });
  const cases: Array<{ name: string; points: number[][]; triangles: number[] }> = [
    { name: 'normal and shared edge', points: [[0, 0], [4, 0], [4, 4], [0, 4]], triangles: [0, 1, 2, 0, 2, 3] },
    { name: 'overlapping triangles first wins', points: [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0], [4, 0], [4, 4]], triangles: [0, 1, 2, 4, 5, 6, 0, 2, 3] },
    { name: 'degenerate before valid', points: [[0, 0], [1, 1], [2, 2], [0, 0], [4, 0], [4, 4]], triangles: [0, 1, 2, 3, 4, 5] },
    { name: 'missing corner and outside', points: [[0, 0], [4, 0], [4, 4]], triangles: [0, 1, 99, 0, 1, 2] },
    { name: 'negative grid clockwise', points: [[-4, -4], [-4, 0], [0, 0], [0, -4]], triangles: [0, 1, 2, 0, 2, 3] },
    { name: 'thin nondegenerate', points: [[-4, -1], [4, -1], [4, -1 + Number.EPSILON * 8]], triangles: [0, 1, 2] },
  ];
  const identical = (a: ReturnType<typeof turnTriangleCoordinates>, b: ReturnType<typeof turnTriangleCoordinates>) => a === null || b === null ? a === b : a.ids.every((v, i) => Object.is(v, b.ids[i])) && a.weights.every((v, i) => Object.is(v, b.weights[i]));
  for (const [i, fixture] of cases.entries()) {
    const table = rasterTurnTriangleOwnership(fixture.points, fixture.triangles, queries);
    const mismatches = queries.filter(q => !identical(table.at(q.x, q.y), turnTriangleCoordinates(fixture.points, fixture.triangles, q.point[0], q.point[1])));
    say(`TCO0${i + 1}_SPARSE_OWNERSHIP_MATCHES_REFERENCE`, mismatches.length === 0, `${fixture.name}: ${queries.length} cells; exact ids and Object.is weights; mismatches ${mismatches.length}`);
  }
  const square = cases[0], shared = rasterTurnTriangleOwnership(square.points, square.triangles, [{ x: 2, y: 2, point: [2, 2] }]).at(2, 2);
  say('TCO07_ANALYTIC_SHARED_EDGE_FIRST_TRIANGLE', JSON.stringify(shared) === JSON.stringify({ ids: [0, 1, 2], weights: [0.5, 0, 0.5] }), 'hand-computable diagonal midpoint chooses triangle0 with weights1/2,0,1/2; no epsilon or edge reassignment');
  let reads = 0;
  const points = new Proxy(square.points, { get(t, p, r) { reads++; return Reflect.get(t, p, r); } });
  const triangles = new Proxy(square.triangles, { get(t, p, r) { reads++; return Reflect.get(t, p, r); } });
  const small = queries.filter(q => q.x >= 0 && q.x <= 4 && q.y >= 0 && q.y <= 4), table = rasterTurnTriangleOwnership(points, triangles, small);
  reads = 0; for (let repeat = 0; repeat < 8; repeat++) for (const q of small) table.at(q.x, q.y);
  const cached = reads; reads = 0; for (const q of small) turnTriangleCoordinates(points, triangles, q.point[0], q.point[1]);
  say('TCO08_QUERIES_NEVER_RESCAN_SOURCE_GEOMETRY', cached === 0 && reads > 0, `after construction ${small.length * 8} cached queries read source0 times; planted linear path reads ${reads}`);
  const empty = rasterTurnTriangleOwnership(square.points, square.triangles, []);
  say('TCO09_ONLY_REQUESTED_CELLS_ARE_AVAILABLE', empty.at(1, 1) === null && table.at(1000000, -1000000) === null, 'empty and unrequested far cells are absent; no canvas/world-size allocation or inferred query support');
}
