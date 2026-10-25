#!/usr/bin/env bun
/** Issue #160: current-toolchain reading. Bars are fixed in issuecomment-6394715413. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AlphaMask, type MeshReductionInput, type NamedLine, type ReducedMesh, validateLines } from 'rig-c/mesh';
import { autoSource, autoReductionInput, runReduction, autoVerdict, terminationText } from '../src/automesh.ts';
import { fillHoles, newMask } from '../src/raster/index.ts';
import { type ContourMesh } from '../src/contour.ts';
import { blinkFixture, blinkRing, edgeDisplacement, artCentres, fixtureEnvelope, islandOutlines, motionAgainstSource, onRings, picture, ringEdges, ringSource, type Build, type FixtureCase, type WeightedMesh } from './feature_contour_survey.ts';

/** Trace only enclosed transparent components, independently of the declared rectangle. */
export function alphaRings(mask: AlphaMask): Array<Array<[number, number]>> {
  const art = newMask(mask.width, mask.height);
  for (let i = 0; i < art.data.length; i++) art.data[i] = mask.alpha[i] > 0 ? 1 : 0;
  const filled = fillHoles(art);
  const holes = newMask(mask.width, mask.height);
  for (let i = 0; i < holes.data.length; i++) holes.data[i] = filled.data[i] && !art.data[i] ? 1 : 0;
  return islandOutlines(holes).map((r) => {
    if ('refused' in r) throw new Error(`ALPHA_HOLE_TRACE: ${r.refused}`);
    return r.outline;
  });
}

/** Remove collinear intermediate corners and fix start/direction for byte comparison. */
export function canonicalRing(r: readonly (readonly [number, number])[]): Array<[number, number]> {
  const corners = r.filter((b, i) => {
    const a = r[(i + r.length - 1) % r.length];
    const c = r[(i + 1) % r.length];
    return (b[0] - a[0]) * (c[1] - b[1]) !== (b[1] - a[1]) * (c[0] - b[0]);
  }).map(([x, y]): [number, number] => [x, y]);
  if (corners.length < 3) throw new Error('FEATURE_RING: at least three non-collinear corners required');
  const area = corners.reduce((s, a, i) => { const b = corners[(i + 1) % corners.length]; return s + a[0] * b[1] - a[1] * b[0]; }, 0);
  if (area < 0) corners.reverse();
  let first = 0;
  corners.forEach((p, i) => { if (p[1] < corners[first][1] || (p[1] === corners[first][1] && p[0] < corners[first][0])) first = i; });
  return [...corners.slice(first), ...corners.slice(0, first)];
}

/** Accuracy and coverage are distinct: a missing sample can never pass as zero error. */
export function accuracy(edge: { max: number; uncarried: number } | null): boolean {
  return edge !== null && Number.isFinite(edge.max) && edge.max <= 1 && edge.uncarried === 0;
}

/** Instrument controls have normal, defect, and edge cases independent of the reading. */
export function refreshControls(): Array<{ name: string; pass: boolean }> {
  const c = blinkFixture();
  const traced = alphaRings(c.mask).map(canonicalRing);
  const mesh: WeightedMesh = {
    points: [[0, 0], [8, 0], [8, 8], [0, 8]], triangles: [0, 1, 2, 0, 2, 3],
    weights: [[{ bone: 'lid', weight: 1 }], [{ bone: 'lid', weight: 1 }], [{ bone: 'root', weight: 1 }], [{ bone: 'root', weight: 1 }]],
  };
  const samples: Array<[number, number]> = [[2, 3], [6, 8]];
  const affine = edgeDisplacement(mesh, 'lid', samples, (p) => 1 - p[1] / 8, [0, 5]);
  const defect = edgeDisplacement(mesh, 'lid', samples, (p) => p[1] <= 3 ? 1 : (8 - p[1]) / 5, [0, 5]);
  const outside = edgeDisplacement(mesh, 'lid', [[9, 9]], () => 1, [0, 5]);
  const zero = edgeDisplacement(mesh, 'lid', samples, () => 1, [0, 0]);
  const solid = { ...c.mask, alpha: new Uint8Array(c.mask.alpha.length).fill(255) };
  const notch = { ...c.mask, alpha: c.mask.alpha.slice() };
  for (let x = 0; x < 20; x++) notch.alpha[19 * notch.width + x] = 0;
  return [
    { name: 'affine normal zero and kink defect 1.875 px', pass: affine.max <= 1e-9 && affine.uncarried === 0 && defect.max === 1.875 && !accuracy(defect) },
    { name: 'uncarried edge rejected and zero translation zero', pass: outside.uncarried === 1 && !accuracy(outside) && zero.max === 0 && accuracy(zero) },
    { name: 'declared and independently traced hole coincide; reversed ring canonicalizes', pass: JSON.stringify(traced) === JSON.stringify([canonicalRing(blinkRing())]) && JSON.stringify(canonicalRing(blinkRing().reverse())) === JSON.stringify(traced[0]) },
    { name: 'solid and open notch have no interior hole', pass: alphaRings(solid).length === 0 && alphaRings(notch).length === 0 },
    { name: 'misplaced line differs while evaluation edge stays fixed', pass: canonicalRing(blinkRing()).every((p, i) => p[1] + 3 === misplaced(c).rings[0][i][1]) && JSON.stringify(misplaced(c).edge) === JSON.stringify(c.edge) },
  ];
}

export function misplaced(c: FixtureCase): FixtureCase {
  const rings = c.rings.map((r) => r.map(([x, y]): [number, number] => [x, y + 3]));
  return { ...c, rings, anchors: rings.flat() };
}

function reductionInput(c: FixtureCase, made: ContourMesh, named: boolean) {
  const weights = made.vertices.map((p) => {
    const w = c.field(p);
    return w <= 0 ? [{ bone: 'root', weight: 1 }] : w >= 1 ? [{ bone: 'lid', weight: 1 }] : [{ bone: 'lid', weight: w }, { bone: 'root', weight: 1 - w }];
  });
  const indices = onRings(made.vertices, c.rings);
  const edges = ringEdges(made.triangles, indices);
  const lines: NamedLine[] = indices.map((vertices, i) => ({ name: `opening${i}`, vertices, closed: true, maxDeviation: 1 }));
  // |grad w| = 1/6 and |T| = 6: 1 px line deviation gives at most 1 px displacement.
  const base = autoReductionInput({ part: 'blink', mask: c.mask, ox: 0, oy: 0, spec: c.policy(c.spacing), source: made, weights, boneOrder: ['root', 'lid'] });
  const input: MeshReductionInput = { ...base, ...(named ? { lines } : {}), targets: { ...base.targets, skinning: { envelope: fixtureEnvelope(c), maxResidual: 1 } } };
  return { input, weights, indices, edges };
}

function build(c: FixtureCase, label: string, made: ContourMesh, named: boolean): Build {
  const { input, weights, indices, edges } = reductionInput(c, made, named);
  const sourceMesh = { points: made.vertices, triangles: made.triangles, weights };
  const ran = runReduction(`refresh ${label}`, input);
  const common: Build = {
    label, what: label, source: { hull: made.hull, interior: made.vertices.length - made.hull },
    ring: named ? { vertices: indices.flat().length, edges: edges.present.length, of: edges.of, protectedVertices: 0 } : null,
    result: null, termination: 'not reduced', verdict: 'refused', sourceEdge: edgeDisplacement(sourceMesh, c.lid, c.edge, c.field, c.T).max,
    edge: null, motion: null, residual: 'not measured', sourceMesh, mesh: null, wallMs: 0, problem: null,
  };
  if ('code' in ran) return { ...common, problem: `${ran.code}: ${ran.detail}` };
  const verdict = autoVerdict(`refresh ${label}`, ran);
  const residual = (ran.report.candidates[0]?.geometry?.rows ?? []).find((r) => r.code === 'MQ_SKINNING_RESIDUAL' && r.object.region === null);
  const mesh: ReducedMesh | null = ran.mesh;
  return { ...common, verdict: verdict.accepted ? 'accepted' : `refused ${verdict.problem.code}`, termination: terminationText(ran.report.termination),
    residual: residual === undefined ? 'no row' : `${residual.value} / ${residual.bound?.value} (${residual.state})`,
    mesh, result: mesh === null ? null : { hull: mesh.counts.boundaryVertices, interior: mesh.counts.interiorVertices, triangles: mesh.counts.triangles },
    edge: mesh === null ? null : edgeDisplacement(mesh, c.lid, c.edge, c.field, c.T),
    motion: mesh === null ? null : motionAgainstSource(mesh, sourceMesh, c.lid, artCentres(c.mask), c.T),
  };
}

function source(c: FixtureCase, named: boolean, spacing: number): ContourMesh {
  const made = named ? ringSource(c, spacing) : autoSource('blink', c.mask, c.policy(c.spacing));
  if (Array.isArray(made)) throw new Error(made.map((p) => `${p.code}: ${p.detail}`).join('\n'));
  return made;
}

function main(): void {
  const controls = refreshControls();
  for (const c of controls) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}`);
  if (controls.some((c) => !c.pass)) process.exit(1);
  if (process.argv[2] === '--controls') return;
  const out = process.argv[2];
  if (!out || process.argv.length !== 3) throw new Error('usage: feature_contour_refresh.ts --controls | <output-directory>');
  if (out !== '--dry-run') mkdirSync(out, { recursive: true });
  const c = blinkFixture();
  const traced = { ...c, rings: alphaRings(c.mask).map(canonicalRing) };
  const trials: Array<{ spacing: number; complete: boolean; edges: Array<{ present: number; of: number }> }> = [];
  let ringSpacing = 8 / 64;
  for (let k = 0; k <= 6; k++) {
    const spacing = 8 / 2 ** k;
    const edges = [c, misplaced(c)].map((variant) => {
      const made = source(variant, true, spacing);
      const e = ringEdges(made.triangles, onRings(made.vertices, variant.rings));
      return { present: e.present.length, of: e.of };
    });
    const complete = edges.every((e) => e.of > 0 && e.present === e.of);
    trials.push({ spacing, complete, edges });
    if (complete) { ringSpacing = spacing; break; }
  }
  const cases = [
    { c, label: 'lattice-8', named: false },
    { c: { ...c, spacing: 4 }, label: 'lattice-4', named: false },
    { c, label: 'declared-line', named: true },
    { c: traced, label: 'alpha-hole', named: true },
    { c: misplaced(c), label: 'misplaced-3px', named: true },
  ];
  if (out === '--dry-run') {
    for (const v of cases) {
      const made = source(v.c, v.named, ringSpacing);
      const { input } = reductionInput(v.c, made, v.named);
      if (v.named) {
        validateLines(v.label, 'lines', input.lines, input.source);
        console.log(`READ ${v.label}: line admitted`);
      }
      console.log(`READ ${v.label}: source and reduction input read`);
    }
    return;
  }
  const raw = cases.map((v) => { const made = source(v.c, v.named, ringSpacing); return { ...v, made, build: build(v.c, v.label, made, v.named) }; });
  const [lattice, half, declared, alpha, plant] = raw.map((r) => r.build);
  const count = (b: Build): number => b.result === null ? Infinity : b.result.hull + b.result.interior;
  const accepted = (b: Build): boolean => b.verdict === 'accepted' && accuracy(b.edge);
  const pair = [lattice, half].filter((b) => b.verdict === 'accepted' && b.edge !== null && b.edge.uncarried === 0 && count(declared) <= count(b) && declared.edge !== null && b.edge !== null && declared.edge.max < b.edge.max);
  const meshesEqual = JSON.stringify(declared.mesh) === JSON.stringify(alpha.mesh) && declared.mesh !== null;
  const plantLoses = plant.edge !== null && declared.edge !== null && plant.verdict === 'accepted' && declared.verdict === 'accepted' && count(plant) === count(declared) && plant.edge.uncarried === 0 && plant.edge.max > declared.edge.max;
  const justified = accepted(declared) && accepted(alpha) && pair.length > 0 && meshesEqual && plantLoses;
  const serial = raw.map(({ label, made, build: b }) => ({ label, sourceVertices: made.vertices.length, ring: b.ring, sourceEdge: b.sourceEdge, vertices: Number.isFinite(count(b)) ? count(b) : null, triangles: b.result?.triangles ?? null, edge: b.edge, motion: b.motion, residual: b.residual, verdict: b.verdict, termination: b.termination, problem: b.problem }));
  const result = { spec: 'feature-contour-refresh/1', ringSpacing, trials, controls, rings: { declared: c.rings, alpha: traced.rings, misplaced: cases[4].c.rings }, builds: serial, meshesEqual, plantLoses, pairs: pair.map((b) => b.label), outcome: justified ? 'supports a separately reviewed opt-in proposal' : 'inconclusive; no mechanism justified' };
  writeFileSync(join(out, 'reading.json'), JSON.stringify(result, null, 2) + '\n');
  // Each row uses the fixed true edge; even the misplaced source is evaluated against it.
  picture(raw.map(({ c: variant, build: b }) => ({ c: { ...variant, name: b.label }, builds: [{ ...b, mesh: b.mesh ?? b.sourceMesh }], scale: 4 }))).writePng(join(out, 'feature-contour-refresh.png'));
  console.log(JSON.stringify(result, null, 2));
}
if (import.meta.main) main();
