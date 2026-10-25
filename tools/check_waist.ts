/** Generated literal-hem controls. Real consumer motion is a separate, source-bound gate. */
import { mock } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { waistFixture } from '../fixtures/waist.ts';
import { rigConfig, rigParts, rigImages } from '../fixtures/rig.ts';
import { packageRigc } from '../src/check.ts';
import { parseConfig } from '../src/config.ts';
import { ART_ALPHA, latticeMesh, latticeMeshRows } from '../src/mesh.ts';
import { readPng, encodePngBytes } from '../src/raster/png.ts';
import { newMask, alphaAbove } from '../src/raster/types.ts';
import { buildRig, rigJsonText, type RigOutput, type MeshAttachment } from '../src/rig.ts';
import * as waistModule from '../src/waist.ts';
import { waistBand, waistInfluences, waistPairs, type WaistPair } from '../src/waist.ts';
import { waistMappingOf, waistMoments, nativePoint, preserveWaistRest, refineWaistMesh, remapWaistDeforms, type WaistMapping } from '../src/waistmesh.ts';
import { withAnimations } from '../src/motion.ts';
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
  say('WB00_ALPHA8_9_ACTUAL_ROWS', !('code' in band8) && !('code' in band9) && band8.hem === 2 && band9.hem === 4, 'alpha8 does not extend painted hem; alpha9 does');
  const mapping = waistMappingOf(a);
  if (mapping === undefined) throw new Error('WAIST_MAPPING_REQUIRED');
  // Every triangle touching the open last painted row must have H-only support;
  // an affine field is H-only over the WHOLE pixel when all its supporting nodes are.
  let hemTriangles = 0;
  for (let t = 0; t < a.triangles.length; t += 3) {
    const ids = a.triangles.slice(t, t+3), ys = ids.map((i) => mapping.positions[i][1]);
    if (Math.max(...ys) > 27 && Math.min(...ys) < 28) { hemTriangles++; if (!ids.every((i) => onlyH(a,i))) throw new Error('PAINTED_PIXEL_NOT_RIGID'); }
  }
  say('WB01_WHOLE_PAINTED_PIXEL', hemTriangles > 0, `${hemTriangles} triangles cover row[27,28], every contributing node H1`);
  const identity = new Map([['pivot', { a:1,b:0,c:0,d:1,worldX:0,worldY:0,worldRotation:0 }], ['carrier', { a:0,b:-1,c:1,d:0,worldX:30,worldY:10,worldRotation:90 }]]);
  const momentsMesh: MeshAttachment = { type:'mesh',image:'flat.png',width:10,height:10,uvs:[0,0,1,0],triangles:[],hull:2,weights:[[{bone:'pivot',x:0,y:0,weight:.25},{bone:'carrier',x:10,y:0,weight:.75}],[{bone:'pivot',x:20,y:0,weight:.75},{bone:'carrier',x:30,y:0,weight:.25}]] };
  const m = waistMoments(momentsMesh,{indices:[0,1],barycentric:[.5,.5]});
  say('WB02_STORED_PER_BONE_MOMENTS', equal(m,[{bone:'pivot',weight:.5,x:15,y:0},{bone:'carrier',weight:.5,x:15,y:0}]) && equal(nativePoint(m,identity),[22.5,12.5]), 'hand-derived .5/.5 moments, source-bound test pose carrier90deg+translation');
  const wrongMoments = m.map((w) => ({...w,x:10}));
  say('WB03_EQUAL_WEIGHTS_WRONG_MOMENTS_NEGATIVE', !equal(nativePoint(m,identity),nativePoint(wrongMoments,identity)), 'same weights with rebound nominal positions are a different affine map');
  say('WB04_MOMENTS_NOT_RECAPPED', m.length === 2 && waistMoments(momentsMesh,{indices:[0],barycentric:[1]}).length === 2, 'interpolated support retained; no second cap/floor');
  say('WB05_NATIVE_REST_UV_DECOMPOSITION', Number.isFinite(mapping.maxRestResidual) && Number.isFinite(mapping.maxUvStorageResidual) && mapping.source.length === a.weights.length && mapping.source.every((s) => s.indices.length === 3 && s.barycentric.length === 3), JSON.stringify({maxRestResidual:mapping.maxRestResidual,maxUvStorageResidual:mapping.maxUvStorageResidual}));
  const extraTop = structuredClone(f.parts.parts[0]); extraTop.name = 'second_panel';
  const shared = waistPairs([...f.parts.parts,extraTop],{...cfg,meshes:{...cfg.meshes,second_panel:cfg.meshes.panel}},new Map([['panel',segments],['second_panel',segments]]),bones);
  say('WB06_MULTI_TOP_AMBIGUITY', shared.pairs.size === 0 && shared.problems.some((p) => p.code === 'RIG_WAIST_PAIR'), 'one bottom does not choose the first of two explicit drivers');
  const dOld: MeshAttachment = { type:'mesh',image:'flat.png',width:10,height:10,uvs:[0,0,1,0],triangles:[],hull:2,weights:[[{bone:'pivot',x:0,y:0,weight:1}],[{bone:'pivot',x:10,y:0,weight:1}]] };
  const dNew: MeshAttachment = {...dOld,uvs:[0,0,.5,0,1,0],weights:[dOld.weights[0],[{bone:'pivot',x:5,y:0,weight:1}],dOld.weights[1]]};
  const dMap: WaistMapping = {old:dOld,current:dNew,positions:[[0,0],[5,0],[10,0]],source:[{indices:[0],barycentric:[1]},{indices:[0,1],barycentric:[.5,.5]},{indices:[1],barycentric:[1]}],maxRestResidual:0,maxUvStorageResidual:0};
  const target = new Map([['default/panel/panel',dMap]]);
  const remap = (key: Record<string,unknown>) => { const motion = {animations:{test:{deform:[{slot:'panel',attachment:'panel',keys:[key]}]}}}; remapWaistDeforms(motion,target); return (motion.animations.test.deform[0].keys[0]); };
  const odd = remap({t:0,offset:1,vertices:[2,4,6]});
  say('WB07_DEFORM_ODD_OFFSET_SPARSE', equal(odd.vertices,[0,2,2,4,4,6]) && !('offset' in odd), 'old[0,2,4,6] -> new[0,2,2,4,4,6], one pair per influence');
  say('WB08_DEFORM_FROM_VERTEX_ODD_LENGTH', equal(remap({t:0,fromVertex:1,vertices:[4]}).vertices,[0,0,2,0,4,0]), 'one scalar run is legal and does not shift the next y');
  say('WB09_DEFORM_NULL_SETUP', remap({t:0,vertices:null}).vertices === null, 'null remains the actual setup encoding');
  const refused = (run:()=>unknown,code:string):boolean => { try {run();return false;}catch(e){return e instanceof Error && e.message.includes(code);} };
  say('WB10_DEFORM_LENGTH_PLANTED', refused(()=>remap({t:0,offset:3,vertices:[1,2]}),'RIG_WAIST_DEFORM_RUN'), 'old four-number array cannot fit start3+length2');
  say('WB11_DEFORM_MODEL_TARGETED_REFUSAL', refused(()=>remap({t:0,transform:{kind:'bend'}}),'RIG_WAIST_DEFORM_MODEL'), 'no unproved nonlinear model resampling');
  const lost = structuredClone(dMap); lost.old.weights[0][0].bone = 'carrier';
  const lostMotion = {animations:{test:{deform:[{slot:'panel',attachment:'panel',keys:[{t:0,vertices:[1,0]}]}]}}};
  say('WB12_DEFORM_LOST_SUPPORT_REFUSAL', refused(()=>remapWaistDeforms(lostMotion,new Map([['default/panel/panel',lost]])),'RIG_WAIST_DEFORM_SUPPORT'), 'a C-local delta cannot be carried by H under arbitrary bone motion');
  const unrelated = {animations:{test:{deform:[{slot:'face',attachment:'face',keys:[{t:0,transform:{kind:'bend'}}]}]}}}, unrelatedBefore = structuredClone(unrelated);
  remapWaistDeforms(unrelated,target);
  say('WB13_UNRELATED_FACE_UNTOUCHED',equal(unrelated,unrelatedBefore),'target identity includes skin/slot/attachment; unrelated model never refused');
  const inputKey = {t:0,offset:1,vertices:[2,4,6]}, savedKey = structuredClone(inputKey); remap(inputKey);
  say('WB14_EXTERNAL_INPUT_NOT_MUTATED',equal(inputKey,savedKey),'repeated merge starts with the original sparse array');
  const external = {test:{deform:[{slot:'panel',attachment:'panel',keys:[{t:0,vertices:[0]}]}]}};
  const merged = withAnimations(current.motion,external);
  say('WB15_ACTUAL_WITH_ANIMATIONS_HOOK', 'animations' in merged && !equal(merged.animations,external) && equal(external.test.deform[0].keys[0].vertices,[0]), 'real builder hook consumes old topology while preserving caller input');
  const bottom = current.rig.skins.default.belt.belt;
  say('WB16_BOTTOM_COHERENT_WHOLE_IMAGE', 'type' in bottom && bottom.width === 32 && bottom.height === 20 && bottom.uvs.length === 2*bottom.weights.length && bottom.triangles.every((i)=>i>=0&&i<bottom.weights.length) && bottom.weights.some((w)=>w.some((e)=>e.bone==='carrier')), 'whole padded32x20 image, explicit upper support transferred');
  const stillCfg = structuredClone(f.config); (stillCfg.motion as Record<string,unknown>).blink = {t:.2,eyes:['pivot'],squash:.12,still:{belt:{row:36,bone:'carrier'}}};
  const stillImages = new Map(f.images); const splitBelt = structuredClone(f.images.get('belt')!); for(let x=0;x<splitBelt.width;x++) splitBelt.data[(6*splitBelt.width+x)*4+3]=0; stillImages.set('belt',splitBelt);
  const still = buildRig(parseConfig(stillCfg),f.parts,stillImages), oldStill = withoutWaist(()=>buildRig(parseConfig(stillCfg),f.parts,stillImages));
  say('WB17_STILL_PIECE_PRESERVED',equal(still.rig.skins.default.belt_still,oldStill.rig.skins.default.belt_still)&&equal(still.images.filter(([n])=>n==='belt_still.png').map(([,p])=>[...p.data]),oldStill.images.filter(([n])=>n==='belt_still.png').map(([,p])=>[...p.data]))&&'type' in still.rig.skins.default.belt.belt,'existing clear-row split retains the separate still attachment and all its source pixels');
  const stopCfg = structuredClone(f.config); stopCfg.bones = [{chain:'stem',parent:'root',points:[[32,48],[32,44]],tip:[32,40]},{name:'carrier',parent:'stem1',at:[32,24]}]; stopCfg.regions={belt:'stem1'}; (stopCfg.meshes as Record<string,{segments:unknown[]}>).panel.segments=[['carrier',[32,8],[32,36]],['stem1',[32,36],[32,50]]]; stopCfg.stops=[{chain:'stem',links:['stem1'],against:'root',at:[32,44],inward:0,outward:30}];
  stopCfg.constraints=[{name:'stem_swing',type:'physics',bone:'stem1',rotate:1,inertia:.5,strength:40,damping:.85,wind:0,gravity:0,mass:1,mix:1}];
  const stopped = buildRig(parseConfig(stopCfg),f.parts,f.images), stoppedBottom=stopped.rig.skins.default.belt.belt;
  say('WB18_STOPS_WHOLE_FIELD_REBOUND','type' in stoppedBottom&&stopped.rig.stops!==undefined&&stoppedBottom.weights.some(ws=>ws.some(w=>w.bone==='stem1_d'))&&stoppedBottom.weights.flat().every(w=>w.bone==='stem1_d'||stopped.rig.bones.some(b=>b.name===w.bone)),'actual declared stop rebinds both meshes; rigc creates its declared stem1_d copy');
  const restLm = {vertices:[[0,0],[10,0],[0,10]] as Array<[number,number]>,triangles:[0,2,1],hull:3,loops:1,pinchedVertices:0,cells:1,passes:1};
  const restOld:MeshAttachment={type:'mesh',image:'flat.png',width:10,height:10,uvs:[0,0,1,0,0,.999999],triangles:restLm.triangles,hull:3,weights:restLm.vertices.map(([x,y])=>[{bone:'pivot',x,y,weight:.2},{bone:'carrier',x,y,weight:.8}])};
  const restSplit=refineWaistMesh(restLm,[3]), restNew:MeshAttachment={...restOld,uvs:restSplit.vertices.flatMap(([x,y])=>[x/10,y/10]),triangles:restSplit.triangles,hull:restSplit.hull,weights:restSplit.vertices.map(([x,y])=>[{bone:'pivot',x,y,weight:1}])};
  const restMap=preserveWaistRest(restOld,restLm,restNew,restSplit,identity,-1);
  const uvByOld=restMap.source.flatMap(s=>[0,1].map(k=>s.indices.reduce((sum,i,j)=>sum+s.barycentric[j]*restOld.uvs[2*i+k],0)));
  say('WB19_OLD_UV_FIELD_INTERPOLATED',equal(restNew.uvs,uvByOld),'each new UV is the old triangle field, including its authored decimal boundary');
  say('WB20_INDEPENDENT_UV_NEGATIVE',!equal(restNew.uvs,restSplit.vertices.flatMap(([x,y])=>[x/10,y/10])),'independently rounded image-normalized station is a different texture map');
  say('WB21_INVERSE_NATIVE_REST_QUANTIZED',restMap.maxRestResidual>0&&restMap.maxUvStorageResidual>0&&restNew.weights.every(ws=>ws.length===1&&ws[0].bone==='pivot'&&ws[0].weight===1),'non-f32 .2/.8 weights and two declared frames expose storage residual; H1 retained');
  say('WB22_NOMINAL_FRAME_NEGATIVE',restNew.weights.some((ws,i)=>ws[0].x!==restSplit.vertices[i][0]||ws[0].y!==restSplit.vertices[i][1]),'binding nominal source coordinates misses the old stored native-rest field');
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
  say('WH22_SETUP_RENDER_RGBA_ZERO', before.width === 64 && before.height === 64 && equal([...before.data], [...after.data]), 'actual compiled + packed runtime render on the same64x64 viewport');
  for(const [label,value] of [['alternate',alt],['turn',turned],['still',still],['stops',stopped]] as const) render(label,value);
  const invalid = structuredClone(current.rig), bad = invalid.skins.default.panel.panel as MeshAttachment; bad.uvs.pop();
  writeFileSync(join(dir, 'invalid-uv.json'), rigJsonText(invalid));
  run('planted_uv_gate_negative', ['build', '--rig', join(dir, 'invalid-uv.json'), '--motion', join(dir, 'current/motion.json'), '--out', join(dir, 'invalid-build'), '--profile', 'rig-play', '--pack'], false);
}

if (import.meta.main) {
  const dir = process.argv[2]; if (!dir) throw new Error('OUTPUT_DIRECTORY_REQUIRED');
  let pass = 0, fail = 0; const cases: Array<{ name: string; pass: boolean; detail: string }> = [];
  try { runWaistChecks(dir, (name, ok, detail) => { cases.push({ name, pass: ok, detail }); if (ok) pass++; else fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`); }); }
  finally { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'cases.json'), JSON.stringify({ pass, fail, cases }, null, 2) + '\n'); }
  process.exit(fail ? 1 : 0);
}
