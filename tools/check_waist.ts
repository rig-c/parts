import 'rig-c/render';
import { TextureAtlas } from '@esotericsoftware/spine-core';
import { loadCandidate, throughPoser, sampleSetupPose } from 'rig-c/render-shared';
import { readModel, documentPageLookup, meshPageUvs } from 'rig-c/core';
/** Generated literal-hem controls. Real consumer motion is a separate, source-bound gate. */
import { mock } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { waistFixture, waistFrontFixture, waistPivotFixture, waistSharedCopyFixture } from '../fixtures/waist.ts';
import { rigConfig, rigParts, rigImages } from '../fixtures/rig.ts';
import { packageRigc } from '../src/check.ts';
import { parseConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { ART_ALPHA, latticeMesh, latticeMeshRows } from '../src/mesh.ts';
import { readPng, encodePngBytes } from '../src/raster/png.ts';
import { newMask, alphaAbove } from '../src/raster/types.ts';
import { buildRig as buildDeclaredRig, buildWaistPairSource as buildRig, withWaistPivot, withWaistSharedCopy, rigJsonText, type RigOutput, type MeshAttachment } from '../src/rig.ts';
import * as waistModule from '../src/waist.ts';
import { waistBand, waistInfluences, waistPairs, type WaistPair } from '../src/waist.ts';
import { waistMappingOf, waistMoments, nativePoint, preserveWaistRest, refineWaistMesh, remapWaistDeforms, storedWaistHem, type StoredWaistAtlas, type WaistMapping } from '../src/waistmesh.ts';
import { withAnimations } from '../src/motion.ts';
import { waistBottomLayoutOf, waistPivotOf, waistPivotProfile, type WaistPivotRequest } from '../src/waistmesh.ts';
import { waistCopyOf, waistCopyCoverage, nativeWaistCopyCoverage, waistCopyStorageViolations } from '../src/waistmesh.ts';
import { DEFAULT_LIMITS, influences, type Segment } from '../src/weights.ts';

const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const bytes = (r: RigOutput): unknown => ({ ...r, images: r.images.map(([n, p]) => [n, p.width, p.height, [...p.data]]) });
const mesh = (r: RigOutput, attachment = 'panel'): MeshAttachment => {
  const a = r.rig.skins.default.panel[attachment];
  if (!('type' in a)) throw new Error('GENERATED_MESH_REQUIRED');
  return a;
};
const xy = (a: MeshAttachment, i: number): [number, number] => [Math.round(a.uvs[2 * i] * a.width * 1e5) / 1e5, Math.round(a.uvs[2 * i + 1] * a.height * 1e5) / 1e5];
const atRow = (a: MeshAttachment, y: number): number[] => a.weights.flatMap((_, i) => Math.abs(xy(a, i)[1] - y) < 0.0001 ? [i] : []);
const onlyH = (a: MeshAttachment, i: number): boolean => a.weights[i].length === 1 && a.weights[i][0].bone === 'pivot' && a.weights[i][0].weight === 1;
const literal = (a: MeshAttachment, hem: number): boolean => atRow(a, hem).length > 0 && a.weights.every((_, i) => xy(a, i)[1] < hem - 0.0001 || onlyH(a, i));
const hAt = (a: MeshAttachment, p: [number,number]): number | null => {
  const cross = (x:readonly number[],y:readonly number[],z:readonly number[]) => (y[0]-x[0])*(z[1]-x[1])-(y[1]-x[1])*(z[0]-x[0]);
  for(let t=0;t<a.triangles.length;t+=3){const ids=a.triangles.slice(t,t+3),[x,y,z]=ids.map(i=>xy(a,i)),area=cross(x,y,z),bs=[cross(y,z,p)/area,cross(z,x,p)/area,cross(x,y,p)/area];if(bs.every(n=>n>=0))return ids.reduce((sum,i,k)=>sum+bs[k]*a.weights[i].filter(w=>w.bone==='pivot').reduce((s,w)=>s+w.weight,0),0);}
  return null;
};

/** Scoped dependency fault, restored even when its caller throws; no product escape. */
function withoutWaist<T>(run: () => T): T {
  const native = { ...waistModule };
  mock.module(import.meta.resolve('../src/waist.ts'), () => ({ ...native, waistPairs: () => ({ pairs: new Map(), problems: [] }) }));
  try { return run(); } finally { mock.module(import.meta.resolve('../src/waist.ts'), () => native); }
}

/** Read the native runtime's page UV array over the actual gated model/pages. */
export function readNativeWaistHem(home: string, slot: string, attachment: string, lower: string, art: ReturnType<typeof newMask>) {
  const skeleton = join(home, 'skeleton.json'), atlasPath = join(home, 'skeleton.atlas');
  const doc = readModel(readFileSync(join(home, 'skeleton.model.json'), 'utf8'));
  if (doc.pages === null || doc.pages.length === 0 || doc.pages.some((p) => !Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width < 1 || p.height < 1 || p.width > 2048 || p.height > 2048 || (p.scale !== null && p.scale !== 1))) throw new Error('RIG_WAIST_STORED_METADATA: nonempty integral unscaled pages <=2048 required');
  const record = doc.skins.find((s) => s.name === 'default')?.attachments[slot]?.[attachment];
  const geometry = record?.geometry;
  if (record === undefined || geometry?.kind !== 'mesh' || !geometry.vertices.weighted) throw new Error('RIG_WAIST_STORED_UV: weighted compiled mesh required');
  const candidate = loadCandidate({ skeletonText: readFileSync(skeleton, 'utf8'), atlasText: readFileSync(atlasPath, 'utf8'), atlasDir: home, label: home }, { skeleton, atlas: atlasPath }, 'spine');
  const native = throughPoser(candidate.choice, (poser) => sampleSetupPose(poser, { skin: 'default', unclipped: true, texture: true }));
  if (native.poser !== 'spine' || native.value.length !== 1) throw new Error('RIG_WAIST_STORED_UV: one native setup read required');
  const pieces = native.value[0].pieces.filter((p) => p.slot === slot);
  const piece = pieces[0];
  if (pieces.length !== 1 || piece.kind !== 'mesh' || piece.texture === undefined || piece.source !== undefined || !equal(Array.from(piece.triangles), geometry.triangles)) throw new Error('RIG_WAIST_STORED_UV: one complete native mesh and its actual texture identity required');
  // Core's shownRow resolves record.path ?? (record.name ?? placeholder).
  // The native texture key is name#index, while documentPageLookup reads the name.
  const modelPath = record.path ?? record.name ?? attachment;
  const found = documentPageLookup(doc.pages)(modelPath);
  const declared = doc.pages.flatMap((page) => page.regions.map((region) => ({ page: page.name, name: region.name, index: region.index })));
  if (found === null) throw new Error(`RIG_WAIST_STORED_METADATA: found ${JSON.stringify({ modelPath, nativeKey: piece.texture.region, nativePage: piece.page, declared })}; required compiled attachment path on a declared page`);
  const expectedKey = `${found.region.name.trim()}#${found.region.index}`;
  const atlas = new TextureAtlas(readFileSync(atlasPath, 'utf8'));
  const nativeRegions = atlas.regions.filter((region) => `${region.name.trim()}#${region.index}` === piece.texture!.region);
  const region = nativeRegions[0];
  if (piece.texture.region !== expectedKey || piece.page !== found.page.name || nativeRegions.length !== 1 || region.page.name !== found.page.name) throw new Error(`RIG_WAIST_STORED_METADATA: found ${JSON.stringify({ key: piece.texture.region, page: piece.page, regions: nativeRegions.map((r) => ({ name: r.name, index: r.index, page: r.page.name })) })}; required ${JSON.stringify({ modelPath, key: expectedKey, page: found.page.name })}`);
  const fields = ['x', 'y', 'width', 'height', 'offsetX', 'offsetY', 'originalWidth', 'originalHeight', 'degrees', 'index'] as const;
  for (const field of fields) if (region[field] !== found.region[field]) throw new Error(`RIG_WAIST_STORED_METADATA: ${field} found ${region[field]}; required ${found.region[field]} from compiled page region`);
  if (region.page.width !== found.page.width || region.page.height !== found.page.height) throw new Error(`RIG_WAIST_STORED_METADATA: page size found ${region.page.width}x${region.page.height}; required ${found.page.width}x${found.page.height}`);
  const onlyLower = geometry.vertices.bindings.map((ws) => ws.length === 1 && ws[0].bone === lower && Math.fround(ws[0].weight) === 1);
  const metadata: StoredWaistAtlas = { ...found.region, pageWidth: found.page.width, pageHeight: found.page.height, scale: doc.pages.find((p) => p.name === found.page.name)?.scale };
  const pageUvs = Array.from(piece.uvs);
  const reading = storedWaistHem(pageUvs, Array.from(piece.triangles), onlyLower, art, metadata);
  return { ...reading, poser: native.poser, identity: { modelPath, nativeKey: piece.texture.region, expectedKey, page: piece.page }, metadata, pageUvs, onlyLower, triangles: Array.from(piece.triangles) };
}

export function runWaistChecks(dir: string, say: (name: string, pass: boolean, detail: string) => void): void {
  mkdirSync(dir, { recursive: true });
  const f = waistFixture(), cfg = parseConfig(f.config), build = () => buildRig(cfg, f.parts, f.images);
  const current = build(), original = withoutWaist(build), a = mesh(current), old = mesh(original);
  const pair: WaistPair = { top: 'panel', bottom: 'belt', lower: 'pivot', upper: 'carrier' };
  const segments: Segment[] = [{ bone: 'carrier', a: [32, 8], b: [32, 36] }, { bone: 'pivot', a: [32, 36], b: [32, 50] }];
  const art = newMask(24, 32); for (let y = 4; y < 28; y++) for (let x = 4; x < 20; x++) art.data[y * 24 + x] = 1;
  const band = waistBand(pair, art, 20); if ('code' in band) throw new Error(band.code);
  say('WH00_LITERAL_STATION', band.hem === 27 && literal(a, 27), JSON.stringify({ anchor: band.anchor, hem: band.hem, rows: [...new Set(a.weights.map((_, i) => xy(a, i)[1]))] }));
  say('WH01_ORIGINAL_RADIAL_NEGATIVE', !literal(old, 27), 'unmodified distance lattice has no painted-hem station');
  const padded = structuredClone(old), lastBoundary = Math.max(...padded.weights.map((_, i) => xy(padded, i)[1])); let mutations = 0;
  padded.weights.forEach((w, i) => { if (xy(padded, i)[1] === lastBoundary) { padded.weights[i] = [{ ...w[0], bone: 'pivot', weight: 1 }]; mutations++; } });
  const plantedHem = hAt(padded,[12.5,27.5]);
  say('WH02_PADDED_ROW_NEGATIVE', mutations > 0 && !equal(padded.weights, old.weights) && plantedHem !== null && plantedHem < 1 && !literal(padded, 27), `actually changed ${mutations} original vertices at last kept row${lastBoundary}; painted-pixel Hshare=${plantedHem}; original row32 mutant changed none`);
  say('WH03_UPPER_WEIGHTS_UNCHANGED', old.weights.every((w, i) => {
    const p = xy(old, i); if (p[1] > 20) return true;
    const j = a.weights.findIndex((_, k) => equal(xy(a, k), p)); return j >= 0 && equal(w, a.weights[j]);
  }), 'every original vertex at/above the supplied upper anchor retains all bindings');
  say('WH04_COHERENT_BINDING', a.uvs.length === a.weights.length * 2 && a.triangles.every((i) => Number.isInteger(i) && i >= 0 && i < a.weights.length) && a.weights.every((w) => w.length > 0 && Math.abs(w.reduce((s, e) => s + e.weight, 0) - 1) < 1e-12), `${a.weights.length} vertices, ${a.triangles.length / 3} triangles, hull ${a.hull}`);
  const otherRig = (r:RigOutput) => ({...r.rig,skins:{default:Object.fromEntries(Object.entries(r.rig.skins.default).filter(([n])=>n!=='panel'&&n!=='belt'))}});
  say('WH05_IMAGES_MOTION_OTHER_OUTPUT_UNCHANGED', equal(bytes({ ...current, rig: original.rig, meshReport: original.meshReport }), bytes(original))&&equal(otherRig(current),otherRig(original)), 'only paired attachments and their measured mesh reports change');
  const ordinary = latticeMesh('panel', art, 10), same = latticeMeshRows('panel', art, 10, []), split = latticeMeshRows('panel', art, 10, [20, 27]);
  say('WH06_EMPTY_STATIONS_EXACT', equal(ordinary, same), 'empty refinement reproduces every lattice byte');
  say('WH07_REFINED_ONE_LOOP', !('code' in split) && split.loops === 1 && split.pinchedVertices === 0, 'subdivision preserves the selected cell union');
  say('WH08_NONFINITE_STATION_REFUSED', 'code' in latticeMeshRows('panel', art, 10, [NaN]), 'RIG_LATTICE_STATION');
  say('WH09_ANCHOR_BELOW_HEM_REFUSED', 'code' in waistBand(pair, art, 27), 'RIG_WAIST_HEIGHT, not a guessed gradient');
  say('WH10_EMPTY_ART_REFUSED', 'code' in waistBand(pair, newMask(24, 32), 20), 'RIG_WAIST_HEIGHT');
  say('WH10_PLATEAU_COLLAPSE_REFUSED', 'code' in waistBand(pair, art, 26), 'anchor at hem-1 leaves no gradient interval; no offset search or fallback');
  say('WH10_SOURCE_TEXEL_PLATEAU', band.plateau === band.hem - 1 && band.anchor < band.plateau, 'one source texel is a geometry construction, never an RGBA tolerance');
  const broken = waistInfluences([32, 31], 27, band, segments.slice(0, 1), 1, DEFAULT_LIMITS, 2);
  say('WH11_MISSING_BINDING_REFUSED', 'code' in broken && broken.code === 'RIG_WAIST_BINDING', 'no nearest-name fallback');
  for (const floor of ['cut', 'continuous'] as const) for (const maxInfluences of [1, 2, Number.MAX_SAFE_INTEGER]) {
    const limits = { minWeight: .03, floor, maxInfluences };
    const upper = waistInfluences([32, 24], 20, band, segments, 1, limits, 2), hem = waistInfluences([32, 31], 27, band, segments, 1, limits, 2);
    say(`WH12_${floor}_${maxInfluences}_AUTHOR_LIMITS`, equal(upper, influences([32, 24], segments, 1, limits, 2)) && !('code' in hem) && equal(hem, [{ bone: 'pivot', weight: 1 }]), 'author cap/floor applied once; upper call identical and hem H=1');
  }
  const bones = new Map([['pivot', { parent: 'root' }], ['carrier', { parent: 'pivot' }], ['root', { parent: null }]]);
  const selected = waistPairs(f.parts.parts, cfg, new Map([['panel', segments]]), bones);
  say('WH13_EXPLICIT_GENERIC_IDENTITIES', selected.problems.length === 0 && equal(selected.pairs.get('panel'), pair), 'provenance, rigid binding and declared ancestry only');
  const objectRegion = waistPairs(f.parts.parts,{...cfg,regions:{...cfg.regions,belt:{bone:'pivot',gather:false}}},new Map([['panel',segments]]),bones);
  say('WH13_REGION_OBJECT_BINDING', objectRegion.problems.length === 0 && equal(objectRegion.pairs.get('panel'),pair), 'current explicit RegionSpec object uses its declared bone; gather remains untouched');
  const extra = structuredClone(f.parts.parts[1]); extra.name = 'second_belt';
  const ambiguous = waistPairs([...f.parts.parts, extra], { ...cfg, regions: { ...cfg.regions, second_belt: 'pivot' } }, new Map([['panel', segments]]), bones);
  say('WH14_AMBIGUOUS_PAIR_REFUSED', ambiguous.problems.some((p) => p.code === 'RIG_WAIST_PAIR') && ambiguous.pairs.size === 0, 'two eligible partners are not selected by source order');
  for (const label of ['no_top_tag', 'no_bottom_tag', 'unrelated_ancestry', 'third_binding', 'heat'] as const) {
    const raw = structuredClone(f.config), parts = structuredClone(f.parts);
    if (label === 'no_top_tag') parts.parts[0].from = 'full:handwear';
    if (label === 'no_bottom_tag') parts.parts[1].from = 'full:handwear';
    if (label === 'unrelated_ancestry') (raw.bones as Array<{ parent: string }>)[1].parent = 'root';
    if (label === 'third_binding') { (raw.bones as unknown[]).push({ name: 'third', parent: 'root', at: [40, 32] }); (raw.meshes as Record<string, { segments: unknown[] }>).panel.segments.push(['third', [40, 20], [40, 40]]); }
    if (label === 'heat') {
      const m = (raw.meshes as Record<string, { rule: string; segments: unknown[] }>).panel;
      m.rule = 'heat'; m.segments = [['carrier', [28, 8], [28, 31]], ['pivot', [36, 8], [36, 31]]];
    }
    const c = parseConfig(raw), run = () => buildRig(c, parts, f.images);
    say(`WH15_${label}_WHOLE_OUTPUT_BYTES`, equal(bytes(run()), bytes(withoutWaist(run))), 'no eligible pair: every output field and image byte equals the dependency fault');
  }
  const noPair = () => buildRig(parseConfig(rigConfig()), rigParts(), rigImages());
  say('WH16_EXISTING_NO_PAIR_ALL_BYTES', equal(bytes(noPair()), bytes(withoutWaist(noPair))), 'existing public rig fixture, complete output');
  const saved = waistModule.waistPairs, planted = new Error('PLANTED_SCOPE_THROW'); let caught: unknown;
  try { withoutWaist(() => { throw planted; }); } catch (e) { caught = e; }
  say('WH17_FAULT_RESTORED', caught === planted && waistModule.waistPairs === saved && literal(mesh(build()), 27), 'try/finally restores the native function and effect');
  const altParts = structuredClone(f.parts);
  altParts.alternates = [{ name: 'alternate', slots: { panel: 'alternate_panel' }, records: [structuredClone(f.parts.parts[0])], ghost_px: {}, recomposite: { mean_abs: 0, within_limit: 0, within_share: 0, error_limit: 0, error_px: 0, covered_alpha: 0, uncovered_error_px: 0, hole_count: 0, holes_listed: 0, holes: [] } }];
  const alt = buildRig(cfg, altParts, new Map([...f.images, ['alternate_panel', f.images.get('panel')!]]));
  say('WH18_ALTERNATE_LITERAL_HEM', literal(mesh(alt, 'alternate_panel'), 27) && alt.sets?.sets.alternate.slots.panel === 'alternate_panel', 'alternate uses its own art and posed anchor');
  const frontFixture = waistFrontFixture(), frontCfg = parseConfig(frontFixture.config);
  const front = buildRig(frontCfg,frontFixture.parts,frontFixture.images), frontSet = front.sets?.sets.front;
  const frontTop = front.rig.skins.default.panel_front?.front_panel, frontBottom = front.rig.skins.default.belt_front?.front_belt;
  say('WF00_PAIRED_FRONT_SLOT_NATIVE_IDENTITIES',frontTop !== undefined && 'type' in frontTop && frontBottom !== undefined && 'type' in frontBottom && frontSet?.slots.panel_front === 'front_panel' && frontSet.slots.belt_front === 'front_belt' && frontSet.hides?.includes('panel') === true && frontSet.hides.includes('belt') && frontBottom.weights.some(ws=>ws.some(w=>w.bone==='stem1')),'selected top field and bottom conversion use their actual front slots; original base slots remain hidden');
  const noFrontPair = structuredClone(frontFixture.parts); noFrontPair.parts[0].from = 'full:handwear-r';
  const noFrontRun = () => buildRig(frontCfg,noFrontPair,frontFixture.images);
  say('WF01_NO_PAIR_FRONT_ALL_BYTES',equal(bytes(noFrontRun()),bytes(withoutWaist(noFrontRun))),'no eligible top tag preserves every front-slot rig/motion/report/image byte');
  const turnCfg = parseConfig({ ...f.config, turn: { pivot: .8, depths: { panel: .2, belt: .8 } } });
  const turned = buildRig(turnCfg, f.parts, f.images), ta = mesh(turned);
  say('WH19_TURN_REBOUND_COHERENT', turned.turn !== null && ta.weights.length === a.weights.length && ta.uvs.length === a.uvs.length && equal(ta.triangles, a.triangles), 'turn rebinds the refined complete attachment');
  writeFileSync(join(dir, 'current.output.json'), rigJsonText(bytes(current)));
  writeFileSync(join(dir, 'original.output.json'), rigJsonText(bytes(original)));
  writeFileSync(join(dir, 'turn.output.json'), rigJsonText(bytes(turned)));
  writeFileSync(join(dir, 'alternate.output.json'), rigJsonText(bytes(alt)));
  // The selected alpha criterion is the existing lattice's strict threshold, not a new tolerance.
  say('WH20_ALPHA_CONTRACT', ART_ALPHA === 8 && band.hem === 27, 'the opaque fixture has exactly24 rows; its padded last art row is4+24-1');
  const alpha = {width:3,height:5,data:new Uint8ClampedArray(3*5*4)}; alpha.data[(2*3+1)*4+3]=255; alpha.data[(4*3+1)*4+3]=8;
  const band8 = waistBand(pair, alphaAbove(alpha,ART_ALPHA), 0); alpha.data[(4*3+1)*4+3] = 9;
  const band9 = waistBand(pair, alphaAbove(alpha,ART_ALPHA), 0);
  say('WBR00_ALPHA8_9_ACTUAL_ROWS', !('code' in band8) && !('code' in band9) && band8.hem === 2 && band9.hem === 4, 'alpha8 does not extend painted hem; alpha9 does');
  const mapping = waistMappingOf(a);
  if (mapping === undefined) throw new Error('WAIST_MAPPING_REQUIRED');
  // Every triangle touching the open last painted row must have H-only support;
  // an affine field is H-only over the WHOLE pixel when all its supporting nodes are.
  let hemTriangles = 0;
  for (let t = 0; t < a.triangles.length; t += 3) {
    const ids = a.triangles.slice(t, t+3), ys = ids.map((i) => mapping.positions[i][1]);
    if (Math.max(...ys) > 27 && Math.min(...ys) < 28) { hemTriangles++; if (!ids.every((i) => onlyH(a,i))) throw new Error('PAINTED_PIXEL_NOT_RIGID'); }
  }
  say('WBR01_NOMINAL_PAINTED_PIXEL_ONLY', hemTriangles > 0, `${hemTriangles} nominal source triangles cover row[27,28]; actual stored-UV whole-pixel certification is separate`);
  // Real page-UV storage on a non-dyadic page; these are generated flat blocks.
  const page = { name: 'generated.png', width: 997, height: 991 };
  const region = { x: 13, y: 17, width: 24, height: 32, offsetX: 0, offsetY: 0, originalWidth: 24, originalHeight: 32, degrees: 0 };
  const metadata: StoredWaistAtlas = { ...region, pageWidth: page.width, pageHeight: page.height, scale: null };
  const nativeUvs = meshPageUvs(region, page, a.uvs);
  const stored = storedWaistHem(nativeUvs, a.triangles, a.weights.map((_, i) => onlyH(a, i)), art, metadata);
  const originalUvs = meshPageUvs(region, page, old.uvs);
  const originalStored = storedWaistHem(originalUvs, old.triangles, old.weights.map((_, i) => onlyH(old, i)), art, metadata);
  const rightmost = (uvs: readonly number[]) => Math.max(...uvs.filter((_, i) => i % 2 === 0));
  // The unchanged baseline has this same non-covering stored footprint. A
  // coverage-positive expectation was wrong; C-only support is a separate read.
  say('WS00_STORED_PAGE_UV_COVERAGE_NEGATIVE', !stored.pass && !originalStored.pass && stored.uncovered.length > 0 && equal(stored.uncovered, originalStored.uncovered) && rightmost(nativeUvs) === rightmost(originalUvs), JSON.stringify({ current: stored, original: originalStored, sameStoredRightEdge: rightmost(nativeUvs) }));
  say('WS00_STORED_PAGE_UV_ZERO_C', stored.mixed.length === 0 && stored.pixels === 16 && stored.hem === 27, 'zero C support does not certify the independently refused whole-cell coverage');
  const quadUvs = meshPageUvs(region, page, [0,26/32,1,26/32,1,1,0,1]), diagonal = [0,1,2,0,2,3];
  const whole = storedWaistHem(quadUvs, diagonal, [true,true,true,true], art, metadata);
  say('WS01_DIAGONAL_ENDPOINT_LAST_COLUMN', whole.pass && whole.pixels === 16, 'both triangles jointly cover every closed last-row pixel, including the last painted column');
  const hole = storedWaistHem(quadUvs, diagonal.slice(0,3), [true,true,true,true], art, metadata);
  say('WS02_MISSING_DIAGONAL_COVERAGE_NEGATIVE', !hole.pass && hole.uncovered.length > 0, JSON.stringify(hole));
  const duplicate = storedWaistHem(quadUvs, [...diagonal,...diagonal], [true,true,true,true], art, metadata);
  say('WS03_OVERLAP_CANNOT_CANCEL_HOLE', !duplicate.pass && duplicate.uncovered.length > 0, 'overlapping positive-area intersections are refused, never credited twice');
  const oldRows = [0,20/32,1,20/32,0,27/32,1,27/32,0,1,1,1];
  const sliverUvs = meshPageUvs(region,page,oldRows), sliverTriangles = [0,1,3,0,3,2,2,3,5,2,5,4];
  const step = new DataView(new ArrayBuffer(4)); step.setFloat32(0,(region.y+27)/page.height); step.setUint32(0,step.getUint32(0)+1);
  sliverUvs[5] = step.getFloat32(0); sliverUvs[7] = step.getFloat32(0);
  const sliver = storedWaistHem(sliverUvs,sliverTriangles,[false,false,true,true,true,true],art,metadata);
  say('WS04_POSITIVE_NATIVE_ULP_SLIVER_NEGATIVE', !sliver.pass && sliver.mixed.length === 16, 'nominal H1 row27 is unchanged; one actual stored page-UV step below it exposes positive C support inside every painted cell');
  const rejects = (run:()=>unknown,code:string):boolean => { try {run();return false;}catch(e){return e instanceof Error && e.message.includes(code);} };
  for (const [label,meta] of [['oversize',{...metadata,pageWidth:2049}],['scaled',{...metadata,scale:.5}],['fractional',{...metadata,x:13.5}],['unstated_scale',{...metadata,scale:undefined}]] as const) {
    say(`WS05_${label}_METADATA_REFUSED`,rejects(()=>storedWaistHem(nativeUvs,a.triangles,a.weights.map((_,i)=>onlyH(a,i)),art,meta),'RIG_WAIST_STORED_METADATA'),'no tolerance or default for a missing precondition');
  }
  say('WS06_EMPTY_READ_REFUSED',rejects(()=>storedWaistHem(nativeUvs,a.triangles,a.weights.map((_,i)=>onlyH(a,i)),newMask(24,32),metadata),'RIG_WAIST_STORED_EMPTY'),'no painted row cannot become a pass');
  const identity = new Map([['pivot', { a:1,b:0,c:0,d:1,worldX:0,worldY:0,worldRotation:0 }], ['carrier', { a:0,b:-1,c:1,d:0,worldX:30,worldY:10,worldRotation:90 }]]);
  const momentsMesh: MeshAttachment = { type:'mesh',image:'flat.png',width:10,height:10,uvs:[0,0,1,0],triangles:[],hull:2,weights:[[{bone:'pivot',x:0,y:0,weight:.25},{bone:'carrier',x:10,y:0,weight:.75}],[{bone:'pivot',x:20,y:0,weight:.75},{bone:'carrier',x:30,y:0,weight:.25}]] };
  const m = waistMoments(momentsMesh,{indices:[0,1],barycentric:[.5,.5]});
  say('WBR02_STORED_PER_BONE_MOMENTS', equal(m,[{bone:'pivot',weight:.5,x:15,y:0},{bone:'carrier',weight:.5,x:15,y:0}]) && equal(nativePoint(m,identity),[22.5,12.5]), 'hand-derived .5/.5 moments, source-bound test pose carrier90deg+translation');
  const wrongMoments = m.map((w) => ({...w,x:10}));
  say('WBR03_EQUAL_WEIGHTS_WRONG_MOMENTS_NEGATIVE', !equal(nativePoint(m,identity),nativePoint(wrongMoments,identity)), 'same weights with rebound nominal positions are a different affine map');
  say('WBR04_MOMENTS_NOT_RECAPPED', m.length === 2 && waistMoments(momentsMesh,{indices:[0],barycentric:[1]}).length === 2, 'interpolated support retained; no second cap/floor');
  say('WBR05_NATIVE_REST_UV_DECOMPOSITION', Number.isFinite(mapping.maxRestResidual) && Number.isFinite(mapping.maxUvStorageResidual) && mapping.source.length === a.weights.length && mapping.source.every((s) => s.indices.length === 3 && s.barycentric.length === 3), JSON.stringify({maxRestResidual:mapping.maxRestResidual,maxUvStorageResidual:mapping.maxUvStorageResidual}));
  const extraTop = structuredClone(f.parts.parts[0]); extraTop.name = 'second_panel';
  const shared = waistPairs([...f.parts.parts,extraTop],{...cfg,meshes:{...cfg.meshes,second_panel:cfg.meshes.panel}},new Map([['panel',segments],['second_panel',segments]]),bones);
  say('WBR06_MULTI_TOP_AMBIGUITY', shared.pairs.size === 0 && shared.problems.some((p) => p.code === 'RIG_WAIST_PAIR'), 'one bottom does not choose the first of two explicit drivers');
  const dOld: MeshAttachment = { type:'mesh',image:'flat.png',width:10,height:10,uvs:[0,0,1,0],triangles:[],hull:2,weights:[[{bone:'pivot',x:0,y:0,weight:1}],[{bone:'pivot',x:10,y:0,weight:1}]] };
  const dNew: MeshAttachment = {...dOld,uvs:[0,0,.5,0,1,0],weights:[dOld.weights[0],[{bone:'pivot',x:5,y:0,weight:1}],dOld.weights[1]]};
  const dMap: WaistMapping = {old:dOld,current:dNew,positions:[[0,0],[5,0],[10,0]],source:[{indices:[0],barycentric:[1]},{indices:[0,1],barycentric:[.5,.5]},{indices:[1],barycentric:[1]}],maxRestResidual:0,maxUvStorageResidual:0};
  const target = new Map([['default/panel/panel',dMap]]);
  const remap = (key: Record<string,unknown>) => { const motion = {animations:{test:{deform:[{slot:'panel',attachment:'panel',keys:[key]}]}}}; remapWaistDeforms(motion,target); return (motion.animations.test.deform[0].keys[0]); };
  const odd = remap({t:0,offset:1,vertices:[2,4,6]});
  say('WBR07_DEFORM_ODD_OFFSET_SPARSE', equal(odd.vertices,[0,2,2,4,4,6]) && !('offset' in odd), 'old[0,2,4,6] -> new[0,2,2,4,4,6], one pair per influence');
  say('WBR08_DEFORM_FROM_VERTEX_ODD_LENGTH', equal(remap({t:0,fromVertex:1,vertices:[4]}).vertices,[0,0,2,0,4,0]), 'one scalar run is legal and does not shift the next y');
  say('WBR09_DEFORM_NULL_SETUP', remap({t:0,vertices:null}).vertices === null, 'null remains the actual setup encoding');
  const refused = (run:()=>unknown,code:string):boolean => { try {run();return false;}catch(e){return e instanceof Error && e.message.includes(code);} };
  say('WBR10_DEFORM_LENGTH_PLANTED', refused(()=>remap({t:0,offset:3,vertices:[1,2]}),'RIG_WAIST_DEFORM_RUN'), 'old four-number array cannot fit start3+length2');
  say('WBR11_DEFORM_MODEL_TARGETED_REFUSAL', refused(()=>remap({t:0,transform:{kind:'bend'}}),'RIG_WAIST_DEFORM_MODEL'), 'no unproved nonlinear model resampling');
  const regionTimeline = {test:{deform:[{slot:'belt',attachment:'belt',keys:[{t:0,vertices:[1,0]}]}]}};
  say('WBR11_DEFORM_ORIGINAL_REGION_REFUSAL', refused(()=>withAnimations(current.motion,regionTimeline),'RIG_WAIST_DEFORM_REGION'), 'actual builder hook refuses a numeric timeline on the original rigid bottom region');
  const lost = structuredClone(dMap); lost.old.weights[0][0].bone = 'carrier';
  const lostMotion = {animations:{test:{deform:[{slot:'panel',attachment:'panel',keys:[{t:0,vertices:[1,0]}]}]}}};
  say('WBR12_DEFORM_LOST_SUPPORT_REFUSAL', refused(()=>remapWaistDeforms(lostMotion,new Map([['default/panel/panel',lost]])),'RIG_WAIST_DEFORM_SUPPORT'), 'a C-local delta cannot be carried by H under arbitrary bone motion');
  const unrelated = {animations:{test:{deform:[{slot:'face',attachment:'face',keys:[{t:0,transform:{kind:'bend'}}]}]}}}, unrelatedBefore = structuredClone(unrelated);
  remapWaistDeforms(unrelated,target);
  say('WBR13_UNRELATED_FACE_UNTOUCHED',equal(unrelated,unrelatedBefore),'target identity includes skin/slot/attachment; unrelated model never refused');
  const inputKey = {t:0,offset:1,vertices:[2,4,6]}, savedKey = structuredClone(inputKey); remap(inputKey);
  say('WBR14_EXTERNAL_INPUT_NOT_MUTATED',equal(inputKey,savedKey),'repeated merge starts with the original sparse array');
  const external = {test:{deform:[{slot:'panel',attachment:'panel',keys:[{t:0,vertices:[0]}]}]}};
  const merged = withAnimations(current.motion,external);
  say('WBR15_ACTUAL_WITH_ANIMATIONS_HOOK', 'animations' in merged && !equal(merged.animations,external) && equal(external.test.deform[0].keys[0].vertices,[0]), 'real builder hook consumes old topology while preserving caller input');
  const bottom = current.rig.skins.default.belt.belt;
  say('WBR16_BOTTOM_COHERENT_WHOLE_IMAGE', 'type' in bottom && bottom.width === 32 && bottom.height === 20 && bottom.uvs.length === 2*bottom.weights.length && bottom.triangles.every((i)=>i>=0&&i<bottom.weights.length) && bottom.weights.some((w)=>w.some((e)=>e.bone==='carrier')), 'whole padded32x20 image, explicit upper support transferred');
  const stillCfg = structuredClone(f.config); (stillCfg.motion as Record<string,unknown>).blink = {t:.2,eyes:['pivot'],squash:.12,still:{belt:{row:36,bone:'carrier'}}};
  const stillImages = new Map(f.images); const splitBelt = structuredClone(f.images.get('belt')!); for(let x=0;x<splitBelt.width;x++) splitBelt.data[(6*splitBelt.width+x)*4+3]=0; stillImages.set('belt',splitBelt);
  const still = buildRig(parseConfig(stillCfg),f.parts,stillImages), oldStill = withoutWaist(()=>buildRig(parseConfig(stillCfg),f.parts,stillImages));
  say('WBR17_STILL_PIECE_PRESERVED',equal(still.rig.skins.default.belt_still,oldStill.rig.skins.default.belt_still)&&equal(still.images.filter(([n])=>n==='belt_still.png').map(([,p])=>[...p.data]),oldStill.images.filter(([n])=>n==='belt_still.png').map(([,p])=>[...p.data]))&&'type' in still.rig.skins.default.belt.belt,'existing clear-row split retains the separate still attachment and all its source pixels');
  const stopCfg = structuredClone(f.config); stopCfg.bones = [{chain:'stem',parent:'root',points:[[32,48],[32,44]],tip:[32,40]},{name:'carrier',parent:'stem1',at:[32,24]}]; stopCfg.regions={belt:'stem1'}; (stopCfg.meshes as Record<string,{segments:unknown[]}>).panel.segments=[['carrier',[32,8],[32,36]],['stem1',[32,36],[32,50]]]; stopCfg.stops=[{chain:'stem',links:['stem1'],against:'root',at:[32,44],inward:0,outward:30}];
  stopCfg.waist={top:'panel',bottom:'belt',upper:'carrier',lower:'stem1',bone:'belt_waist',constraint:'belt_rotation'};
  stopCfg.constraints=[{name:'stem_swing',type:'physics',bone:'stem1',rotate:1,inertia:.5,strength:40,damping:.85,wind:0,gravity:0,mass:1,mix:1}];
  const stopped = buildRig(parseConfig(stopCfg),f.parts,f.images), stoppedBottom=stopped.rig.skins.default.belt.belt;
  say('WBR18_STOPS_WHOLE_FIELD_REBOUND','type' in stoppedBottom&&stopped.rig.stops!==undefined&&stoppedBottom.weights.some(ws=>ws.some(w=>w.bone==='stem1_d'))&&stoppedBottom.weights.flat().every(w=>w.bone==='stem1_d'||stopped.rig.bones.some(b=>b.name===w.bone)),'actual declared stop rebinds both meshes; rigc creates its declared stem1_d copy');
  const stoppedTimeline = {test:{deform:[{slot:'panel',attachment:'panel',keys:[{t:0,vertices:[1,0]}]}]}};
  const specificRefusal = (run: () => unknown, code: string, object: string): boolean => {
    try { run(); return false; } catch (error) { return error instanceof PartsError && error.problems.length === 1 && error.problems[0].code === code && error.problems[0].object === object; }
  };
  say('WBR18_SHARED_COPY_DEFORM_PRECEDES_REMAP', specificRefusal(() => withAnimations(stopped.motion, stoppedTimeline), 'RIG_WAIST_COPY_DEFORM', 'shared waist copy'), 'the declared shared-copy hook rejects the nonzero top run before remap; this does not claim the later rebind gate was reached');
  say('WBR18_PUBLIC_STOP_REFUSAL', specificRefusal(() => buildDeclaredRig(parseConfig(stopCfg), f.parts, f.images), 'RIG_WAIST_PIVOT_FRAME', 'waist candidate'), 'the complete accepted construction refuses this constrained/stopped graph before pivot emission');
  const rebindMap = structuredClone(dMap), rebindName = 'default/panel/panel';
  const beforeRebind = new Map([[rebindName, JSON.stringify(rebindMap.current.weights)]]);
  const rebindRun = () => ({ animations: { test: { deform: [{ slot: 'panel', attachment: 'panel', keys: [{ t: 0, vertices: [1, 0] }] }] } } });
  const unchangedBinding = rebindRun();
  remapWaistDeforms(unchangedBinding, new Map([[rebindName, rebindMap]]), new Set(), beforeRebind);
  say('WBR18_REBIND_UNCHANGED_POSITIVE', equal(unchangedBinding.animations.test.deform[0].keys[0].vertices, [1, 0, .5, 0, 0, 0]), 'the same nonzero sparse run maps through unchanged binding frames');
  rebindMap.current.weights[1][0].bone = 'carrier';
  say('WBR18_PLANTED_REBIND_REFUSAL', specificRefusal(() => remapWaistDeforms(rebindRun(), new Map([[rebindName, rebindMap]]), new Set(), beforeRebind), 'RIG_WAIST_DEFORM_REBIND', 'animation "test" deform default/panel/panel t=0'), 'only the stored binding changed; the direct rebind gate must name its own refusal before lost-support remapping');
  const restLm = {vertices:[[0,0],[10,0],[0,10]] as Array<[number,number]>,triangles:[0,2,1],hull:3,loops:1,pinchedVertices:0,cells:1,passes:1};
  const restOld:MeshAttachment={type:'mesh',image:'flat.png',width:10,height:10,uvs:[0,0,1,0,0,.999999],triangles:restLm.triangles,hull:3,weights:restLm.vertices.map(([x,y])=>[{bone:'pivot',x,y,weight:.2},{bone:'carrier',x,y,weight:.8}])};
  const restSplit=refineWaistMesh(restLm,[3]), restNew:MeshAttachment={...restOld,uvs:restSplit.vertices.flatMap(([x,y])=>[x/10,y/10]),triangles:restSplit.triangles,hull:restSplit.hull,weights:restSplit.vertices.map(([x,y])=>[{bone:'pivot',x,y,weight:1}])};
  const restMap=preserveWaistRest(restOld,restLm,restNew,restSplit,identity,-1);
  const uvByOld=restMap.source.flatMap(s=>[0,1].map(k=>s.indices.reduce((sum,i,j)=>sum+s.barycentric[j]*restOld.uvs[2*i+k],0)));
  say('WBR19_OLD_UV_FIELD_INTERPOLATED',equal(restNew.uvs,uvByOld),'each new UV is the old triangle field, including its authored decimal boundary');
  say('WBR20_INDEPENDENT_UV_NEGATIVE',!equal(restNew.uvs,restSplit.vertices.flatMap(([x,y])=>[x/10,y/10])),'independently rounded image-normalized station is a different texture map');
  say('WBR21_INVERSE_NATIVE_REST_QUANTIZED',restMap.maxRestResidual>0&&restMap.maxUvStorageResidual>0&&restNew.weights.every(ws=>ws.length===1&&ws[0].bone==='pivot'&&ws[0].weight===1),'non-f32 .2/.8 weights and two declared frames expose storage residual; H1 retained');
  say('WBR22_NOMINAL_FRAME_NEGATIVE',restNew.weights.some((ws,i)=>ws[0].x!==restSplit.vertices[i][0]||ws[0].y!==restSplit.vertices[i][1]),'binding nominal source coordinates misses the old stored native-rest field');
  writeFileSync(join(dir,'geometry-residuals.json'),JSON.stringify({maxRestResidual:mapping.maxRestResidual,maxUvStorageResidual:mapping.maxUvStorageResidual,vertices:a.weights.length,triangles:a.triangles.length/3},null,2)+'\n');
  const rigc = packageRigc(resolve(import.meta.dir, '..'));
  const run = (name: string, args: string[], positive = true): void => {
    const p = spawnSync(rigc, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
    writeFileSync(join(dir, `${name}.log`), JSON.stringify({ command: [rigc, ...args], exit: p.status, signal: p.signal }) + '\n' + p.stdout + p.stderr);
    say(`WH21_${name}`, positive ? p.status === 0 : p.status !== 0 && p.status !== null, `actual rigc exit ${p.status}`);
    if (positive && p.status !== 0) throw new Error(`RIGC_POSITIVE_FAILED: ${name}`);
  };
  const render = (label: string, r: RigOutput): string => {
    const home = join(dir, label); mkdirSync(join(home, 'images'), { recursive: true });
    for (const [n, img] of r.images) writeFileSync(join(home, 'images', n), encodePngBytes(img));
    writeFileSync(join(home, 'rig.json'), rigJsonText(r.rig)); writeFileSync(join(home, 'motion.json'), rigJsonText(r.motion));
    run(`${label}_packed_gate`, ['build', '--rig', join(home, 'rig.json'), '--motion', join(home, 'motion.json'), '--out', join(home, 'build'), '--profile', 'rig-play', '--pack']);
    run(`${label}_render`, ['render', '--candidate', join(home, 'build'), '--animation', 'idle', '--fps', '1', '--max', '64', '--viewport', '-32,0,64,64', '--geometry', '--out', join(home, 'render')]);
    const frames = JSON.parse(readFileSync(join(home, 'render', 'frames.json'), 'utf8')) as { sets: Array<{ dir: string }> };
    return join(home, 'render', frames.sets[0].dir, 'f0000.png');
  };
  const before = readPng(render('original', original)), after = readPng(render('current', current));
  let differingPixels = 0, differingChannels = 0, maxChannelDifference = 0;
  for (let i = 0; i < before.data.length; i += 4) {
    let changed = false;
    for (let k = 0; k < 4; k++) { const delta = Math.abs(before.data[i+k]-after.data[i+k]); maxChannelDifference = Math.max(maxChannelDifference,delta); if (delta !== 0) { changed=true; differingChannels++; } }
    if (changed) differingPixels++;
  }
  say('WH22_SETUP_RENDER_RGBA_MAX1', before.width === after.width && before.height === after.height && before.width === 64 && before.height === 64 && maxChannelDifference <= 1, JSON.stringify({differingPixels,differingChannels,maxChannelDifference}));
  const actualStored = readNativeWaistHem(join(dir,'current','build'),'panel','panel','pivot',art);
  writeFileSync(join(dir,'native-stored-hem.json'),JSON.stringify(actualStored,null,2)+'\n');
  // Report the actual packed coverage result without predicting a new atlas's
  // rounding. The fixed WS00 footprint remains the coverage-negative control.
  say('WS07_ACTUAL_COMPILED_PACKED_ZERO_C', actualStored.poser === 'spine' && actualStored.mixed.length === 0 && actualStored.pixels === 16, JSON.stringify({ weightsZeroC: actualStored.mixed.length === 0, fullCellCoverage: actualStored.uncovered.length === 0, wholePixelPass: actualStored.pass, uncovered: actualStored.uncovered, identity: actualStored.identity, metadata: actualStored.metadata }));
  // The same hand-derived whole-image quad as the normal instrument geometry,
  // compiled and packed with the original drawing. No lattice/atlas search.
  const wholeQuad = structuredClone(original), positiveQuad = mesh(wholeQuad);
  positiveQuad.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  positiveQuad.triangles = [0, 2, 1, 0, 3, 2]; positiveQuad.hull = 4;
  positiveQuad.weights = [[0, 0], [positiveQuad.width, 0], [positiveQuad.width, -positiveQuad.height], [0, -positiveQuad.height]].map(([x, y]) => [{ bone: pair.lower, x, y, weight: 1 }]);
  render('whole-quad', wholeQuad);
  const packedQuad = readNativeWaistHem(join(dir, 'whole-quad', 'build'), 'panel', 'panel', pair.lower, art);
  writeFileSync(join(dir, 'native-whole-quad-hem.json'), JSON.stringify(packedQuad, null, 2) + '\n');
  say('WS08_ACTUAL_COMPILED_PACKED_WHOLE_QUAD_POSITIVE', packedQuad.pass && packedQuad.poser === 'spine' && packedQuad.pixels === 16, JSON.stringify(packedQuad));
  for(const [label,value] of [['alternate',alt],['turn',turned],['still',still],['stops',stopped]] as const) render(label,value);
  render('front',front);
  const invalid = structuredClone(current.rig), bad = invalid.skins.default.panel.panel as MeshAttachment; bad.uvs.pop();
  writeFileSync(join(dir, 'invalid-uv.json'), rigJsonText(invalid));
  run('planted_uv_gate_negative', ['build', '--rig', join(dir, 'invalid-uv.json'), '--motion', join(dir, 'current/motion.json'), '--out', join(dir, 'invalid-build'), '--profile', 'rig-play', '--pack'], false);
  runWaistPivotChecks(dir, say);
}

if (import.meta.main) {
  const dir = process.argv[2]; if (!dir) throw new Error('OUTPUT_DIRECTORY_REQUIRED');
  let pass = 0, fail = 0; const cases: Array<{ name: string; pass: boolean; detail: string }> = [];
  try { runWaistChecks(dir, (name, ok, detail) => { cases.push({ name, pass: ok, detail }); if (ok) pass++; else fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`); }); }
  finally { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'cases.json'), JSON.stringify({ pass, fail, cases }, null, 2) + '\n'); }
  process.exit(fail ? 1 : 0);
}

export interface WaistPivotNativeReceipt {
  command: string[];
  rawExit: number | null;
  signal: string | null;
  launchError: string | null;
  stdout: string;
  stderr: string;
  stdoutSHA256: string;
  stderrSHA256: string;
}

/** Only the missing-property refusal for this planted control is an expected negative. */
export function waistPivotMissingPropertyRefusal(receipt: WaistPivotNativeReceipt): boolean {
  const lines = (receipt.stdout + '\n' + receipt.stderr).split(/\r?\n/);
  const failures = lines.filter((line) => /^\s*FAIL\s/.test(line)).map((line) => line.trim());
  const targetVerdicts = lines.filter((line) => /^\s*(?:PASS|FAIL|SKIP)\s+A48_TRANSFORM_CONSTRAINT_NOT_MUTED_THROUGHOUT(?::|$)/.test(line));
  const expected = 'FAIL  A48_TRANSFORM_CONSTRAINT_NOT_MUTED_THROUGHOUT: transform constraint "belt_rotation" drives no property — its `properties` name no `to` — so no mix it carries is ever read and it moves nothing; declare the property it should drive (see rigc guide A48_TRANSFORM_CONSTRAINT_NOT_MUTED_THROUGHOUT)';
  return receipt.rawExit === 1 && receipt.signal === null && receipt.launchError === null &&
    failures.length === 1 && failures[0] === expected && targetVerdicts.length === 1 &&
    receipt.stderr.trim() === 'rigc: 1 assertion(s) failed — nothing written' &&
    createHash('sha256').update(receipt.stdout).digest('hex') === receipt.stdoutSHA256 &&
    createHash('sha256').update(receipt.stderr).digest('hex') === receipt.stderrSHA256;
}

/** Generated positive and planted-negative controls for the explicit pivot stage. Nova only. */
export function runWaistPivotChecks(dir: string, say: (name: string, pass: boolean, detail: string) => void): void {
  const f = waistPivotFixture(), base = buildRig(parseConfig(f.config), f.parts, f.images), before = JSON.stringify(base.rig);
  const request: WaistPivotRequest = { top: 'panel', bottom: 'belt', upper: 'carrier', lower: 'pivot', bone: 'belt_waist', constraint: 'belt_rotation', topOrigin: [20, 4], bottomOrigin: [16, 26], canvas: [64, 64] };
  const output = withWaistPivot(base, request), bottom = output.rig.skins.default.belt.belt as MeshAttachment, pivot = waistPivotOf(bottom);
  if (pivot === undefined) throw Error('PIVOT_RESULT_REQUIRED');
  say('WP00_SOURCE_STATIONS', equal(pivot.profile.centre, [32,30]) && pivot.profile.lower === 40 && pivot.profile.hem === 51 && pivot.profile.columns.length === 16, JSON.stringify(pivot.profile));
  say('WP01_TOP_ALL_BYTES_EXACT', equal(output.rig.skins.default.panel, base.rig.skins.default.panel), 'entire original top binding/topology/UV/art reference exact');
  say('WP02_ORIGINAL_BONES_AND_OTHER_ATTACHMENTS_EXACT', equal(output.rig.bones.slice(0,-1),base.rig.bones) && Object.entries(base.rig.skins.default).every(([n,v])=>n==='belt'||equal(v,output.rig.skins.default[n])), 'one appended bone; original limb bones and bindings untouched');
  say('WP03_NO_INPUT_OR_ART_MOTION_MUTATION', JSON.stringify(base.rig) === before && output.images === base.images && output.motion === base.motion, 'same original image bytes and motion object; no baked keys or motion adapter');
  say('WP04_UPPER_BAND_W_ONE', bottom.weights.every((ws,i)=>pivot.layout.vertices[i][1]+26>40||equal(ws.map(w=>[w.bone,w.weight]),[['belt_waist',1]])), 'every support node at or above derived lower station is the single waist frame');
  say('WP05_HEM_H_ONE', bottom.weights.every((ws,i)=>pivot.layout.vertices[i][1]+26<51||equal(ws.map(w=>[w.bone,w.weight]),[['pivot',1]])), 'whole last painted row has H-only support after exact station subdivision');
  say('WP06_BLEND_COHERENT', bottom.weights.some(ws=>ws.length===2) && bottom.weights.every(ws=>Math.abs(ws.reduce((n,w)=>n+w.weight,0)-1)<1e-12) && Number.isFinite(pivot.mapping.maxRestResidual), 'fixed source-span interpolation, no cap/floor/fit search');
  const old = base.rig.skins.default.belt.belt as MeshAttachment;
  say('WP07_ORIGINAL_UV_FIELD', pivot.mapping.source.every((m,i)=>[0,1].every(k=>bottom.uvs[2*i+k]===m.indices.reduce((n,v,j)=>n+m.barycentric[j]*old.uvs[2*v+k],0))), 'subdivision retains original source-triangle UV correspondence');
  const rejected = (run:()=>unknown, name:string):boolean=>{try{run();return false;}catch(e){return String(e).includes(name);}};
  say('WP08_COLLISION_REFUSAL', rejected(()=>withWaistPivot(base,{...request,bone:'carrier'}),'RIG_WAIST_PIVOT_NAME'), 'existing graph names are not overwritten or renamed');
  const empty = newMask(1,1);
  say('WP09_EMPTY_SOURCE_REFUSAL', rejected(()=>waistPivotProfile(empty,empty,[0,0],[0,0]),'RIG_WAIST_PIVOT_SOURCE'), 'no source row or dimensions guessed');
  const flat = newMask(4,8);flat.data.fill(1);
  say('WP10_NO_FLARE_REFUSAL', rejected(()=>waistPivotProfile(flat,flat,[0,0],[0,0]),'RIG_WAIST_PIVOT_SOURCE'), 'no bilateral source expansion, no fallback lower station');
  const changedFrame = { ...base, rig: { ...base.rig, bones: base.rig.bones.map(b=>b.name==='pivot'?{...b,rotation:15}:b) } };
  say('WP11_UNPROVED_REST_FRAME_REFUSAL', rejected(()=>withWaistPivot(changedFrame,request),'RIG_WAIST_PIVOT_FRAME'), 'turned source frames require a different proved inverse; no hidden graph rewrite');
  const tinyTurn = { ...base, rig: { ...base.rig, bones: base.rig.bones.map(b=>b.name==='pivot'?{...b,rotation:1e-8}:b) } };
  say('WP11_NONZERO_AUTHORED_TURN_NO_EPSILON', rejected(()=>withWaistPivot(tinyTurn,request),'RIG_WAIST_PIVOT_FRAME'), 'even an authored1e-8degree turn remains ineligible; exact authored measurement is not an epsilon on runtime matrices');
  say('WP12_SUBDIVISION_SOURCE_LAYOUT', waistBottomLayoutOf(bottom)===pivot.layout && pivot.mapping.source.length===bottom.weights.length && bottom.triangles.every(i=>i>=0&&i<bottom.weights.length), 'whole mesh/UV/hull correspondence, never removed triangles');
  const probe = { duration:1, tracks:[{bone:'pivot',property:'rotate',keys:[{t:0,v:[15]},{t:1,v:[-15]}]},{bone:'carrier',property:'rotate',keys:[{t:0,v:[-15]},{t:1,v:[15]}]}] };
  const runNative = (label:string, value:RigOutput, missingProperty = false) => {
    const home=join(dir,label);mkdirSync(join(home,'images'),{recursive:true});
    for(const [name,image]of value.images)writeFileSync(join(home,'images',name),encodePngBytes(image));
    writeFileSync(join(home,'rig.json'),rigJsonText(value.rig));writeFileSync(join(home,'motion.json'),rigJsonText(withAnimations(value.motion,{probe})));
    const command=[packageRigc(resolve(import.meta.dir,'..')),'build','--rig',join(home,'rig.json'),'--motion',join(home,'motion.json'),'--out',join(home,'build'),'--profile','rig-play','--pack'];
    const done=spawnSync(command[0],command.slice(1),{encoding:'utf8',maxBuffer:1<<24});
    const stdout=done.stdout??'',stderr=done.stderr??'';
    const receipt:WaistPivotNativeReceipt={command,rawExit:done.status,signal:done.signal,launchError:done.error===undefined?null:String(done.error),stdout,stderr,stdoutSHA256:createHash('sha256').update(stdout).digest('hex'),stderrSHA256:createHash('sha256').update(stderr).digest('hex')};
    writeFileSync(join(home,'native.stdout.log'),stdout);writeFileSync(join(home,'native.stderr.log'),stderr);writeFileSync(join(home,'native-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
    writeFileSync(join(home,'native.log'),JSON.stringify(receipt)+'\n'+stdout+stderr);
    // The suite deletes its temporary tree in finally: carry full output through
    // both the case detail and every error, including a later native pose failure.
    try {
    if(missingProperty){if(!waistPivotMissingPropertyRefusal(receipt))throw Error('UNEXPECTED_MISSING_PROPERTY_REFUSAL');return{rows:[],receipt};}
    if(done.status!==0||done.signal!==null||done.error!==undefined)throw Error('NATIVE_POSITIVE_BUILD_FAILED');
    const skeleton=join(home,'build/skeleton.json'),atlas=join(home,'build/skeleton.atlas'),candidate=loadCandidate({skeletonText:readFileSync(skeleton,'utf8'),atlasText:readFileSync(atlas,'utf8'),atlasDir:join(home,'build'),label},{skeleton,atlas},'spine');
    const read=throughPoser(candidate.choice,p=>{const rows:Array<{frame:number;delta:number;offset:number}>=[];p.animation('probe','default',1,1,(frame,pose)=>{const bs=pose.bones(),W=bs.find(b=>b.name==='belt_waist'),H=bs.find(b=>b.name==='pivot'),U=bs.find(b=>b.name==='carrier');if(!W||!H||!U)throw Error('NATIVE_CONTROL_BONES');rows.push({frame,delta:W.rotationX-H.rotationX,offset:Math.hypot(W.worldX-U.worldX,W.worldY-U.worldY)});});return rows;});
    if(read.poser!=='spine'||read.value.length!==2)throw Error('NATIVE_CONTROL_SCHEDULE');writeFileSync(join(home,'native-reading.json'),JSON.stringify(read.value,null,2)+'\n');return{rows:read.value,receipt};
    }catch(error){throw Error('PIVOT_NATIVE_CONTROL_RED '+label+' '+JSON.stringify({cause:String(error),...receipt}));}
  };
  const positive=runNative('pivot-positive',output);
  say('WP13_ACTUAL_ROTATION_AND_TRANSLATION', positive.rows.every(r=>Math.abs(r.delta)<1e-4&&Math.abs(r.offset-6)<1e-4), JSON.stringify(positive));
  const dead:RigOutput={...output,rig:{...output.rig,constraints:output.rig.constraints?.map(c=>{const out={...c};delete out.properties;return out;})}};
  const negative=runNative('pivot-missing-property',dead,true);
  say('WP14_MISSING_PROPERTY_NATIVE_NEGATIVE', waistPivotMissingPropertyRefusal(negative.receipt), JSON.stringify(negative.receipt));
  runWaistSharedCopyChecks(dir,say,runNative);
}

/** The actual native UV triangles, not nominal inserted support points. */
export function readNativeWaistCopy(home:string,slot:string,bone:string,profile:ReturnType<typeof waistPivotProfile>,origin:readonly[number,number],size:readonly[number,number]) {
  const skeleton=join(home,'skeleton.json'),atlas=join(home,'skeleton.atlas'),document=readModel(readFileSync(join(home,'skeleton.model.json'),'utf8'));
  const stored=document.skins.find(s=>s.name==='default')?.attachments[slot]?.[slot]?.geometry;
  if(stored?.kind!=='mesh'||!stored.vertices.weighted)throw Error('RIG_WAIST_COPY_COVERAGE: original weighted copy mesh required');
  const asset=loadCandidate({skeletonText:readFileSync(skeleton,'utf8'),atlasText:readFileSync(atlas,'utf8'),atlasDir:home,label:'shared copy native coverage'},{skeleton,atlas},'spine');
  const result=throughPoser(asset.choice,p=>sampleSetupPose(p,{skin:'default',unclipped:false,texture:true}));
  const pieces=result.value[0]?.pieces.filter(p=>p.slot===slot),piece=pieces?.[0];
  if(result.poser!=='spine'||pieces?.length!==1||piece?.kind!=='mesh'||!piece.texture||piece.source!==undefined||!equal(Array.from(piece.triangles),stored.triangles))throw Error('RIG_WAIST_COPY_COVERAGE: exact native source UV/triangle correspondence unavailable');
  const only=stored.vertices.bindings.map(ws=>ws.length===1&&ws[0].bone===bone&&Math.fround(ws[0].weight)===1);
  // Native art UVs are the original drawing's normalized UVs. The model's
  // attachment dimensions supply its untrimmed source size, not atlas pixels.
  const proof=nativeWaistCopyCoverage(Array.from(piece.texture.artUvs),Array.from(piece.triangles),only,size[0],size[1],profile,origin);
  return{...proof,poser:result.poser,nativeSourceUVs:Array.from(piece.texture.artUvs),nativeTriangles:Array.from(piece.triangles),onlyWaist:only,sourceSize:size,page:piece.page,textureRegion:piece.texture.region};
}

function runWaistSharedCopyChecks(dir:string,say:(name:string,pass:boolean,detail:string)=>void,runNative:(label:string,value:RigOutput)=>{rows:Array<{frame:number;delta:number;offset:number}>;receipt:WaistPivotNativeReceipt}) {
  const f=waistSharedCopyFixture(),base=buildRig(parseConfig(f.config),f.parts,f.images),request:WaistPivotRequest={top:'panel',bottom:'belt',upper:'carrier',lower:'pivot',bone:'belt_waist',constraint:'belt_rotation',topOrigin:[20,4],bottomOrigin:[16,26],canvas:[64,64]},W=withWaistPivot(base,request),before=JSON.stringify(W.rig),final=withWaistSharedCopy(W,request),top=final.rig.skins.default.panel.panel as MeshAttachment,old=W.rig.skins.default.panel.panel as MeshAttachment,copy=waistCopyOf(top);
  if(!copy)throw Error('SHARED_COPY_RESULT_REQUIRED');
  const upper=copy.oldToNew.flatMap((n,i)=>old.uvs[2*i+1]*old.height+4<=copy.anchor?[equal(old.weights[i],top.weights[n])&&equal(old.uvs.slice(2*i,2*i+2),top.uvs.slice(2*n,2*n+2))]:[]);
  say('WC00_ORIGINAL_UPPER_FIELD_EXACT',upper.length>0&&upper.every(Boolean)&&copy.upperTriangles.length>0,JSON.stringify({anchor:copy.anchor,upperVertices:upper.length,upperTriangles:copy.upperTriangles.length}));
  say('WC01_BOTTOM_GRAPH_ART_MOTION_EXACT',final.rig.skins.default.belt===W.rig.skins.default.belt&&final.rig.bones===W.rig.bones&&final.rig.constraints===W.rig.constraints&&final.images===W.images&&final.motion===W.motion&&JSON.stringify(W.rig)===before,'same supplied objects and input bytes; top-only output');
  const only=top.weights.map(ws=>ws.length===1&&ws[0].bone==='belt_waist'&&ws[0].weight===1),coverage=waistCopyCoverage(copy.layout.vertices,top.triangles,only,copy.profile,request.topOrigin);
  say('WC02_WHOLE_COPY_TRIANGLE_COVERAGE',coverage.mixedTriangles.length===0&&new Set(copy.profile.topRows).size===2,JSON.stringify({triangles:top.triangles.length/3,coverage,steppedSourceRows:[...new Set(copy.profile.topRows)]}));
  const planted={columns:[0,1,2,3],topRows:[2,2,2,2],centre:[2,2] as [number,number],lower:3,hem:4},triangle:[[number,number],[number,number],[number,number]]=[[0,0],[4,0],[0,4]];
  say('WC03_CROSSING_TRIANGLE_NEGATIVE',equal(waistCopyCoverage(triangle,[0,1,2],[false,false,true],planted,[0,0]).mixedTriangles,[0]),'the sole below-edge vertex is W1, but mixed triangle interior crosses belowC; point-only checks miss it');
  say('WC04_RIGID_TRIANGLE_POSITIVE',waistCopyCoverage(triangle,[0,1,2],[true,true,true],planted,[0,0]).mixedTriangles.length===0,'same full triangle under single W support passes');
  say('WC05_SETUP_AND_UV_CORRESPONDENCE',copy.mapping.maxRestResidual<1e-4&&copy.mapping.source.every((m,i)=>[0,1].every(k=>Math.abs(top.uvs[2*i+k]-m.indices.reduce((n,v,j)=>n+m.barycentric[j]*old.uvs[2*v+k],0))<1e-14)),JSON.stringify({restResidual:copy.mapping.maxRestResidual,sourceVertices:copy.mapping.source.length}));
  const bad={...W,motion:{...W.motion,animations:{...W.motion.animations,planted:{duration:1,tracks:[],deform:[{skin:'default',slot:'panel',attachment:'panel',keys:[{t:0,vertices:[1]}]}]}}}};
  let refused=false;try{withWaistSharedCopy(bad,request);}catch(e){refused=String(e).includes('RIG_WAIST_COPY_DEFORM');}
  say('WC06_NONZERO_DEFORM_REFUSAL',refused,'a nonzero original per-bone deform cannot silently become a W-local offset');
  const belowOriginalC=waistCopyCoverage(copy.layout.vertices,top.triangles,only.map(()=>false),copy.profile,request.topOrigin).mixedTriangles;
  const supportTriangle=belowOriginalC.find(t=>top.triangles.slice(3*t,3*t+3).every(i=>only[i]));
  if(supportTriangle===undefined)throw Error('SHARED_COPY_NEGATIVE_REQUIRES_POSITIVE_AREA_W_TRIANGLE_BELOW_ORIGINAL_C');
  const negative=structuredClone(final.rig),mutant=negative.skins.default.panel.panel as MeshAttachment,copyNode=top.triangles[3*supportTriangle];mutant.weights[copyNode]=[{...mutant.weights[copyNode][0],bone:'carrier'}];
  say('WC07_REMOVED_W_SUPPORT_NEGATIVE',waistCopyCoverage(copy.layout.vertices,top.triangles,mutant.weights.map(ws=>ws.length===1&&ws[0].bone==='belt_waist'&&ws[0].weight===1),copy.profile,request.topOrigin).mixedTriangles.length>0,'one actual rigid support replaced by another frame must invalidate whole-area coverage');
  const native=runNative('shared-copy-positive',final),stored=readNativeWaistCopy(join(dir,'shared-copy-positive/build'),'panel','belt_waist',copy.profile,request.topOrigin,[top.width,top.height]);
  say('WC08_ACTUAL_NATIVE_COPY_AND_ROTATION',stored.mixedTriangles.length===0&&native.rows.every(r=>Math.abs(r.delta)<1e-4&&Math.abs(r.offset-6)<1e-4),JSON.stringify({native,coverage:stored}));
  say('WC09_STORAGE_BOUND_POSITIVE',waistCopyStorageViolations([[0,0],[4,4]],[0,0,1,1],4,4).length===0,'exact source corners satisfy the same-float32 storage bound');
  say('WC10_STORAGE_BOUND_NEGATIVE',equal(waistCopyStorageViolations([[0,0]],[0.25,0],4,4),[0]),'a deliberately shifted source UV is outside the rounding contract and must be refused');
}
