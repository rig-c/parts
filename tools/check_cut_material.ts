import { createHash } from 'node:crypto';
/** Public, hand-computable joint-material controls (#888). */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRequirements } from '../src/requirements.ts';
export function cutMaterialReaderRed(dir: string): void {
  const path = join(dir, 'cut-material.json');
  writeFileSync(path, JSON.stringify({ spec: 'spine-parts-requirements/1', fps: 12, requirements: [],
    cut_material: [{ part: 'hand', joint: 'wrist', at: [8,12], axis: [0,1], reach_px: 3, bend_degrees: [-30,30] }] }));
  readRequirements(path);
}
if (process.argv.includes('--reader-red')) cutMaterialReaderRed(process.argv[process.argv.length - 1]);

import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { writeHybridFixture } from '../fixtures/hybrid_limb.ts';
import { assembleStage, rigStage, checkStage } from '../src/build.ts';
import { readMaterialSources, writeMaterialSources } from '../src/cutmaterialio.ts';
import { spawnSync } from 'node:child_process';
import type { RigcRunner } from '../src/check.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { checkJointMaterial, materialRows, polygonMaterialEdges, bendDepth, jointMaterialProblems, type JointMaterial, materialSource } from '../src/cutmaterial.ts';
import { type Problem, PartsError } from '../src/errors.ts';
import type { PartRecord, PartsFile } from '../src/parts.ts';
import { prepareHybrid } from './check_hybrid_limb.ts';

export const bareJoint: JointMaterial = { part:'hand',joint:'wrist',at:[8,12],axis:[0,1],reach_px:3,bend_degrees:[-30,30] };
function rect(x0:number,y0:number,x1:number,y1:number):Raster {
  const r=newRaster(24,24);
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)r.data.set([90,120,150,255],(y*24+x)*4);
  return r;
}
function record(name:string,cut=false):PartRecord{return {name,from:'full:handwear-r',...(cut?{cut_from:'arm'}:{}),x:0,y:0,w:24,h:24,opaque_px:96,projected_core_px:0,source_px_taken:0,refused_drift_px:0,merged_px:0,seam_override_px:0};}
export function bareMaterialFixture(){
  const parts:PartsFile={rig_size:[24,24],scale_rig_per_source:1,parts:[record('arm'),record('hand',true)],ghost_px:{}};
  const sources=[materialSource('hand',['full:handwear-r'],polygonMaterialEdges([[4,12],[12,12],[12,24],[4,24]]),[{x:0,y:0,image:rect(4,0,12,24)}])];
  return {parts,sources,images:new Map([['arm',rect(4,0,12,12)],['hand',rect(4,12,12,24)]])};
}
export function prepareBareCut(dir:string,declared=true,edgeY=30,bend:[number,number]=[-30,30]){
  writeHybridFixture(dir,false);
  const config=join(dir,'config.json'),raw=JSON.parse(readFileSync(config,'utf8')) as Record<string,unknown>;
  delete raw.limbs;raw.regions={sleeve:'upper',hand:'lower'};
  (raw.assemble as Record<string,unknown>).cuts=[{from:'sleeve',into:'hand',polygon:[[0,edgeY],[64,edgeY],[64,64],[0,64]],overlap:3,draw:'front'}];
  writeFileSync(config,JSON.stringify(raw));
  const req:JointMaterial={part:'hand',joint:'wrist',at:[30,30],axis:[0,1],reach_px:3,bend_degrees:bend};
  const requirements=join(dir,'requirements.json');writeFileSync(requirements,JSON.stringify({spec:'spine-parts-requirements/1',fps:12,requirements:[],cut_material:[req]}));
  const out=join(dir,'assembled');
  const a=assembleStage({source:join(dir,'painting.png'),full:join(dir,'full'),head:join(dir,'head'),config,seam:'near-white',project:'core',...(declared?{requirements}:{})},{partsJson:join(out,'parts.json'),partsDir:join(out,'parts'),recomposite:join(out,'recomposite.png'),errorMap:join(out,'error.png')},()=>{});
  return {a,out,config,requirements,req};
}
export function prepareDiagonalCut(dir:string,tilted=false){
  const f=prepareBareCut(dir),cfg=JSON.parse(readFileSync(f.config,'utf8')) as {assemble:{cuts:Array<{polygon:unknown}>}};
  cfg.assemble.cuts[0].polygon=tilted?[[0,50],[60,10],[64,10],[64,64],[0,64]]:[[0,60],[60,0],[64,0],[64,64],[0,64]];writeFileSync(f.config,JSON.stringify(cfg));
  f.req.axis=tilted?[2,3]:[1,1];writeFileSync(f.requirements,JSON.stringify({spec:'spine-parts-requirements/1',fps:12,requirements:[],cut_material:[f.req]}));
  const a=assembleStage({config:f.config,source:join(dir,'painting.png'),full:join(dir,'full'),head:join(dir,'head'),requirements:f.requirements,seam:'near-white',project:'core'},
    {partsJson:join(f.out,'parts.json'),partsDir:join(f.out,'parts'),recomposite:join(f.out,'recomposite.png'),errorMap:join(f.out,'error.png')},()=>{});
  return {...f,a};
}
export function runCutMaterialChecks(dir:string,say:(name:string,pass:boolean,detail:string)=>void,rigc?:RigcRunner):void{
  mkdirSync(dir,{recursive:true});
  cutMaterialReaderRed(dir);
  say('JC00_REQUIREMENTS_READER_ACCEPTS_EXPLICIT_DECLARATION',true,'every field supplied; no defaults');
  const f=bareMaterialFixture(),problems:Problem[]=[];
  const read=checkJointMaterial([bareJoint],f.parts,n=>f.images.get(n)!,problems,f.sources);
  say('JC01_BARE_CUT_AT_JOINT_FAILS',read.status==='FAIL'&&problems.some(p=>p.code==='CHECK_CUT_JOINT_MATERIAL'&&p.detail.includes('material found 0')) ,JSON.stringify({read,problems}));
  const normal=rect(4,0,12,24);f.images.set('hand',normal);
  const positive:Problem[]=[];
  const edge={a:[4,12] as [number,number],b:[12,12] as [number,number],inward:[0,1] as [number,number]};
  const rows=materialRows('hand',bareJoint,[edge],[{x:0,y:0,image:normal}],[{x:0,y:0,image:normal}]);
  say('JC02_SOURCE_PAST_JOINT_GREEN',rows[0].status==='PASS'&&rows[0].found_px===12&&rows[0].required_px>0,JSON.stringify(rows));
  f.images.set('hand',rect(4,12,12,24));
  const zero=checkJointMaterial([{...bareJoint,bend_degrees:[0,0]}],f.parts,n=>f.images.get(n)!,positive,f.sources);
  say('JC03_ZERO_BEND_NEEDS_ZERO_MATERIAL',zero.status==='PASS'&&positive.length===0,JSON.stringify(zero));
  const skipped=checkJointMaterial(undefined,null,()=>normal,[]);
  say('JC04_UNDECLARED_IS_SKIP',skipped.status==='SKIP'&&skipped.rows.length===0,JSON.stringify(skipped));
  const fail=(fn:()=>unknown):boolean=>{try{fn();return false;}catch(e){return e instanceof PartsError&&e.problems.some(p=>p.code==='CHECK_CUT_MATERIAL_MEASURED');}};
  say('JC05_OUTSIDE_REACH_IS_UNMEASURABLE',fail(()=>checkJointMaterial([{...bareJoint,at:[20,20],reach_px:1}],f.parts,n=>f.images.get(n)!,[],f.sources)),'no nearby interface refuses');
  say('JC06_MISSING_PROVENANCE_REFUSES',fail(()=>checkJointMaterial([{...bareJoint,part:'arm'}],f.parts,n=>f.images.get(n)!,[],f.sources)),'no nearest-part inference');
  say('JC07_MISSING_FIELDS_AND_UNKNOWN_KEYS_REFUSE',jointMaterialProblems([{part:'hand',joint:'wrist',at:[8,12],axis:[0,0],reach_px:-1,bend_degrees:[30,-30],guess:1}],'cut_material').length===4,'zero axis, negative reach, inverted interval, unknown field');
  say('JC08_CONTINUOUS_BEND_READS_INTERIOR_EXTREMUM',bendDepth(4,[-180,180])===4&&bendDepth(-4,[-180,180])===4,'sin extrema at +/-90 degrees, not endpoints');
  const hole=rect(4,0,12,24);for(let x=4;x<12;x++)hole.data[(10*24+x)*4+3]=0;
  const h=materialRows('hand',bareJoint,[edge],[{x:0,y:0,image:normal}],[{x:0,y:0,image:hole}]);
  say('JC09_TRANSPARENT_HOLE_ENDS_SUPPORT',h[0].found_px===1,JSON.stringify(h));
  const poly:[[number,number],[number,number],[number,number],[number,number]]=[[4,12],[12,12],[12,24],[4,24]];
  const forward=materialRows('hand',undefined,polygonMaterialEdges(poly),[{x:0,y:0,image:normal}],[{x:0,y:0,image:f.images.get('hand')!}]);
  const reversed=materialRows('hand',undefined,polygonMaterialEdges([...poly].reverse()),[{x:0,y:0,image:normal}],[{x:0,y:0,image:f.images.get('hand')!}]);
  say('JC10_POLYGON_WINDING_AND_ORIGINAL_EDGE_LENGTH',forward.reduce((a,r)=>a+r.edge_length_px,0)===8&&reversed.reduce((a,r)=>a+r.edge_length_px,0)===8,'8 px crossed original opaque art, regardless of winding');
  const transparent=materialRows('hand',bareJoint,[edge],[{x:0,y:0,image:newRaster(24,24)}],[{x:0,y:0,image:normal}]);
  say('JC11_TRANSPARENT_SOURCE_NEVER_PASSES',transparent[0].status==='SKIP'&&transparent[0].edge_length_px===0,JSON.stringify(transparent));
  const equal=materialRows('hand',{...bareJoint,reach_px:3,bend_degrees:[-90,90]},[{a:[6.5,12],b:[7.5,12],inward:[0,1],opaque_t:[[0,1]]}],[{x:0,y:0,image:normal}],[{x:0,y:0,image:rect(4,11,12,24)}]);
  say('JC16_INTERVAL_ENDPOINT_NEEDS_MORE_THAN_MIDPOINT',equal[0].status==='FAIL','interval radii 0.5..1.5 exceed one row, although its midpoint radius 1 fits; no slack');
  const exact=materialRows('hand',{...bareJoint,bend_degrees:[-90,90]},[{a:[7,12],b:[8,12],inward:[0,1]}],[{x:0,y:0,image:normal}],[{x:0,y:0,image:rect(4,11,12,24)}]);
  say('JC23_ENTIRE_INTERVAL_EQUALITY_GREEN',exact[0].status==='PASS','entire interval radii 0..1 fit exactly one row, including the extreme');
  const diagonal=materialRows('hand',{...bareJoint,axis:[1,1]},[{a:[5,15],b:[11,9],inward:[1,1]}],[{x:0,y:0,image:normal}],[{x:0,y:0,image:normal}]);
  say('JC17_DIAGONAL_NORMAL_USES_PIXEL_CROSSING_ANGLES',diagonal[0].status==='PASS'&&diagonal[0].rays>0,JSON.stringify(diagonal));
  const oneSide=materialRows('hand',{...bareJoint,bend_degrees:[0,30]},[{a:[5,12],b:[6,12],inward:[0,1]}],[{x:0,y:0,image:normal}],[{x:0,y:0,image:f.images.get('hand')!}]);
  const otherSide=materialRows('hand',{...bareJoint,bend_degrees:[-30,0]},[{a:[5,12],b:[6,12],inward:[0,1]}],[{x:0,y:0,image:normal}],[{x:0,y:0,image:f.images.get('hand')!}]);
  say('JC18_ONE_SIDED_BEND_HAS_DECLARED_SIGN',oneSide[0].status==='PASS'&&otherSide[0].status==='FAIL','positive clockwise piece rotation requires inverse rotation; the two sides are distinct');
  const thin={...normal,data:normal.data.slice()};thin.data[(10*24+6)*4+3]=0;
  const between=materialRows('hand',{...bareJoint,bend_degrees:[-30,0]},[{a:[5,12],b:[6,12],inward:[0,1]}],[{x:0,y:0,image:normal}],[{x:0,y:0,image:thin}]);
  say('JC22_BETWEEN_RAY_HOLE_FAILS_WITHOUT_SAMPLING_TUNING',between[0].status==='FAIL','source radii 2..3; midpoint 2.5 misses cell (6,10), but radius 2.25 at -30 degrees enters it');
  const offset=materialRows('hand',{...bareJoint,bend_degrees:[180,180]},[{a:[7,14],b:[9,14],inward:[0,1]}],[{x:0,y:0,image:normal}],[{x:0,y:0,image:rect(4,14,12,24)}]);
  say('JC30_TRANSLATED_EDGE_USES_FULL_POINT_ROTATION',offset[0].status==='FAIL'&&offset[0].found_px===0&&offset[0].required_px===4,'edge y14 about joint y12 rotates to y10 at 180 degrees: exactly 4 px needed, independent of tangent coordinate');
  const rotatedOffset=materialRows('hand',{...bareJoint,at:[12,8],axis:[-1,0],bend_degrees:[180,180]},[{a:[10,7],b:[10,9],inward:[-1,0]}],[{x:0,y:0,image:rect(0,4,24,12)}],[{x:0,y:0,image:rect(0,4,10,12)}]);
  say('JC42_QUARTER_TURNED_OFFSET_HAS_SAME_MATERIAL',rotatedOffset[0].status==='FAIL'&&rotatedOffset[0].found_px===0&&rotatedOffset[0].required_px===4,'quarter-turn of the independent offset fixture: edge x10 about joint x12 maps to x14, exactly 4 px outside its piece');
  const angularHole={...normal,data:normal.data.slice()};angularHole.data[(12*24+10)*4+3]=0;
  const offsetEdge={a:[7,14] as [number,number],b:[9,14] as [number,number],inward:[0,1] as [number,number]};
  const angular=(bend:[number,number])=>materialRows('hand',{...bareJoint,bend_degrees:bend},[offsetEdge],[{x:0,y:0,image:normal}],[{x:0,y:0,image:angularHole}])[0];
  say('JC43_OFFSET_SWEEP_READS_INTERIOR_ANGLE_NOT_JUST_ENDPOINTS',angular([0,0]).status==='PASS'&&angular([180,180]).status==='PASS'&&angular([0,180]).status==='FAIL','offset endpoint rotations at 0/180 avoid cell (10,12), but source offset (-0.6,2) at 100 degrees enters that hole');
  const beforeJoint=materialRows('hand',{...bareJoint,bend_degrees:[180,180]},[{a:[7,10],b:[9,10],inward:[0,1]}],[{x:0,y:0,image:normal}],[{x:0,y:0,image:rect(4,10,12,24)}]);
  say('JC31_OPPOSITE_OFFSET_ROTATES_INTO_EXISTING_ART',beforeJoint[0].status==='PASS','edge y10 about joint y12 rotates to y14 inside its original opaque piece; no outward material is needed');
  const oblique=newRaster(24,24);for(let y=0;y<24;y++)for(let x=0;x<24;x++)if(x+y>=22)oblique.data.set([90,120,150,255],(y*24+x)*4);
  const ob=materialRows('hand',{...bareJoint,axis:[1,1],reach_px:4,bend_degrees:[180,180]},[{a:[7,15],b:[9,13],inward:[1,1]}],[{x:0,y:0,image:normal}],[{x:0,y:0,image:oblique}]);
  say('JC32_OBLIQUE_OFFSET_IS_NOT_PROJECTED_ONTO_JOINT',ob[0].status==='FAIL','source edge x+y=22 about joint sum 20 maps to sum 18 at a half-turn, outside the piece x+y>=22');
  const actual=prepareBareCut(join(dir,'actual-bare'));
  const actualProblems:Problem[]=[];
  const actualRead=checkJointMaterial([actual.req],actual.a.parts,n=>actual.a.images.find(p=>p.record.name===n)!.image,actualProblems,readMaterialSources(actual.out,actual.a.parts));
  say('JC19_ACTUAL_ASSEMBLE_CUT_WITH_OVERLAP_FAILS',actualRead.status==='FAIL'&&actualProblems.some(p=>p.code==='CHECK_CUT_JOINT_MATERIAL'),'original source intersections from actual assemble --requirements; overlap 3 never grows the cut piece');
  const mismatched=fail(()=>checkJointMaterial([{...actual.req,axis:[1,0]}],actual.a.parts,n=>actual.a.images.find(p=>p.record.name===n)!.image,[],actual.a.materialSources));
  say('JC33_MISMATCHED_CUT_AXIS_REFUSES',mismatched,'axis right matches no original opaque edge inward down within reach; no ignored declaration');
  const translated=prepareBareCut(join(dir,'actual-offset'),true,32,[180,180]),translatedProblems:Problem[]=[];
  const translatedLine=checkJointMaterial([translated.req],translated.a.parts,n=>translated.a.images.find(p=>p.record.name===n)!.image,translatedProblems,readMaterialSources(translated.out,translated.a.parts));
  say('JC34_ACTUAL_OFFSET_ASSEMBLE_USES_ORIGINAL_EDGE',translatedLine.status==='FAIL'&&translatedLine.rows.some(r=>r.required_px===4&&r.found_px===0),'actual polygon y32 about joint y30, overlap 3, half-turn maps to y28; 4 px required');
  const diagonalCut=prepareDiagonalCut(join(dir,'actual-diagonal')),diagonalSources=readMaterialSources(diagonalCut.out,diagonalCut.a.parts);
  for(const axis of [[1,1],[2,2]] as [number,number][]){
    const errors:Problem[]=[];const measured=checkJointMaterial([{...diagonalCut.req,axis}],diagonalCut.a.parts,n=>diagonalCut.a.images.find(p=>p.record.name===n)!.image,errors,diagonalSources);
    say(axis[0]===1?'JC44_ACTUAL_DIAGONAL_AXIS_IS_MEASURABLE':'JC45_SCALAR_MULTIPLE_DIAGONAL_AXIS_IS_MEASURABLE',measured.status==='FAIL'&&errors.some(p=>p.code==='CHECK_CUT_JOINT_MATERIAL'),'original edge direction (60,-60) dot axis is exactly zero; inward side positive; bare material must FAIL rather than become unavailable');
  }
  say('JC46_REVERSED_DIAGONAL_AXIS_REFUSES',fail(()=>checkJointMaterial([{...diagonalCut.req,axis:[-1,-1]}],diagonalCut.a.parts,n=>diagonalCut.a.images.find(p=>p.record.name===n)!.image,[],diagonalSources)),'perpendicular alone is insufficient: inward orientation must match');
  say('JC47_NONREPRESENTABLE_AXIS_REFUSES',jointMaterialProblems([{...bareJoint,axis:[1e308,1e308]}],'cut_material').length>0&&jointMaterialProblems([{...bareJoint,axis:[1e-300,1e-300]}],'cut_material').length>0,'overflowing/underflowing direction lengths never reach unit arithmetic or PASS');
  const tilted=prepareDiagonalCut(join(dir,'actual-tilted'),true),tiltedSources=readMaterialSources(tilted.out,tilted.a.parts);
  const tiltedAxes:Array<[number,number]>= [[2,3],[4,6],tiltedSources.find(s=>s.part==='hand')!.edges[0].inward];
  const tiltedMeasured=tiltedAxes.map(axis=>{const errors:Problem[]=[];return checkJointMaterial([{...tilted.req,axis}],tilted.a.parts,n=>tilted.a.images.find(p=>p.record.name===n)!.image,errors,tiltedSources).status==='FAIL'&&errors.some(p=>p.code==='CHECK_CUT_JOINT_MATERIAL');});
  say('JC48_TILTED_AUTHORED_AND_CAPTURED_AXES_MEASURE_EQUIVALENTLY',tiltedMeasured.every(Boolean),'actual edge (60,-40): [2,3], [4,6], and the sidecar canonical inward all resolve without re-normalized component equality');
  const sidecar=join(actual.out,'cut_material_sources.json'),originalSidecar=readFileSync(sidecar);
  const originalPng=readFileSync(join(actual.out,'parts','hand.png'));
  try{
    writeFileSync(join(actual.out,'parts','hand.png'),Buffer.concat([originalPng,Buffer.from([0])]));
    say('JC24_CHANGED_PNG_INVALIDATES_SOURCE_EVIDENCE',fail(()=>readMaterialSources(actual.out,actual.a.parts)),'whole emitted PNG hash, not only decoded alpha');
  }finally{writeFileSync(join(actual.out,'parts','hand.png'),originalPng);}
  try{
    const malformed=JSON.parse(originalSidecar.toString()) as {sources:Array<{edges:Array<{opaque_t?:unknown}>}>};delete malformed.sources[0].edges[0].opaque_t;
    writeFileSync(sidecar,JSON.stringify(malformed));
    say('JC25_MISSING_ORIGINAL_INTERVALS_REFUSE',fail(()=>readMaterialSources(actual.out,actual.a.parts)),'no inferred interval or successful zero');
  }finally{writeFileSync(sidecar,originalSidecar);}
  const semanticPlants:Array<[string,(edge:Record<string,unknown>,body:{sources:Array<{edges:Array<Record<string,unknown>>}>})=>void]>=[
    ['JC35_SIDECAR_OUT_OF_EDGE_PARAMETERS_REFUSE',e=>{e.opaque_t=[[-0.1,0.2]];}],
    ['JC36_SIDECAR_UNORDERED_INTERVALS_REFUSE',e=>{e.opaque_t=[[0.5,0.6],[0.1,0.2]];}],
    ['JC37_SIDECAR_OVERLAPPING_INTERVALS_REFUSE',e=>{e.opaque_t=[[0.1,0.5],[0.4,0.6]];}],
    ['JC38_SIDECAR_OBLIQUE_INWARD_REFUSES',e=>{e.inward=[1,1];}],
    ['JC39_SIDECAR_EMPTY_EDGE_CANNOT_HIDE_BESIDE_ANOTHER',(e,b)=>{b.sources[0].edges.push({...e});e.opaque_t=[];e.opaque_intervals=0;e.opaque_length_px=0;}],
    ['JC40_SIDECAR_OLD_OFF_LINE_ABSOLUTE_ENDPOINTS_REFUSE',e=>{e.opaque=[[[0,999],[64,999]]];}],
  ];
  for(const [name,plant] of semanticPlants)try{
    const body=JSON.parse(originalSidecar.toString()) as {sources_sha256:string;sources:Array<{edges:Array<Record<string,unknown>>}>};plant(body.sources[0].edges[0],body);
    // Recompute the transport checksum so this plants semantic reader failures.
    body.sources_sha256=createHash('sha256').update(JSON.stringify(body.sources)).digest('hex');writeFileSync(sidecar,JSON.stringify(body));
    say(name,fail(()=>readMaterialSources(actual.out,actual.a.parts)),'semantic refusal even with a matching payload digest');
  }finally{writeFileSync(sidecar,originalSidecar);}
  try{
    const body=JSON.parse(originalSidecar.toString()) as {sources:Array<{edges:unknown[]}>};body.sources[0].edges.splice(0,1);writeFileSync(sidecar,JSON.stringify(body));
    say('JC41_SIDECAR_REMOVED_EDGE_DIGEST_REFUSES',fail(()=>readMaterialSources(actual.out,actual.a.parts)),'whole source payload binding catches a removed edge');
  }finally{writeFileSync(sidecar,originalSidecar);}
  const undeclared=prepareBareCut(join(dir,'actual-undeclared'),false);
  say('JC26_UNDECLARED_ASSEMBLE_HAS_NO_NEW_BYTES',!existsSync(join(undeclared.out,'cut_material_sources.json'))&&readFileSync(join(actual.out,'parts.json')).equals(readFileSync(join(undeclared.out,'parts.json')))&&readFileSync(join(actual.out,'parts','hand.png')).equals(readFileSync(join(undeclared.out,'parts','hand.png'))),'opted and undeclared assemblies share existing parts/PNG bytes; undeclared emits no sidecar');
  const cliOut=join(dir,'cli-assembled');
  const cli=spawnSync('bun',['cli.ts','assemble','--config',actual.config,'--source',join(dir,'actual-bare','painting.png'),'--full',join(dir,'actual-bare','full'),'--head',join(dir,'actual-bare','head'),'--out',cliOut,'--requirements',actual.requirements],{encoding:'utf8'});
  say('JC29_ASSEMBLE_CLI_WRITES_DECLARED_SOURCE_EVIDENCE',cli.status===0&&existsSync(join(cliOut,'rig','cut_material_sources.json')),`exit ${cli.status}: new flag reaches source writer`);
  const missing=fail(()=>checkJointMaterial([bareJoint],f.parts,n=>f.images.get(n)!,[]));
  say('JC20_EMITTED_SIBLINGS_NEVER_INVENT_SOURCE',missing,'missing original source instrument refuses even with both siblings');
  if(rigc!==undefined){
    const rig=join(dir,'actual-rig');rigStage({config:actual.config,parts:actual.out,out:rig,idleKeys:'direct'},rigc,join(dir,'gate'),()=>{});
    const lines:string[]=[];
    const checked=checkStage({rig,parts:actual.out,out:join(dir,'actual-check'),requirements:actual.requirements,noExtremes:true},rigc,'fixture rigc',l=>lines.push(l));
    say('JC21_CHECK_REQUIREMENTS_EMITS_NAMED_BARE_FAILURE',!checked.figures.PASS&&checked.problems.some(p=>p.code==='CHECK_CUT_JOINT_MATERIAL')&&lines.some(l=>l.includes('CHECK_CUT_JOINT_MATERIAL')&&l.includes('material found 0')),lines.filter(l=>l.includes('CUT_JOINT_MATERIAL')).join(' | '));
  }
  for(const hybrid of [false,true]){
    const p=prepareHybrid(join(dir,hybrid?'hybrid':'cap'),hybrid);
    const req:JointMaterial={part:'distal',joint:'elbow',at:[30,30],axis:[0,1],reach_px:3,bend_degrees:[-30,30]};
    const errors:Problem[]=[];const line=checkJointMaterial([req],p.a.parts,n=>p.a.images.find(i=>i.record.name===n)!.image,errors,p.a.materialSources);
    say(hybrid?'JC13_EXISTING_HYBRID_GREEN':'JC12_EXISTING_CAP_GREEN',line.status==='PASS'&&errors.length===0,JSON.stringify(line));
    say(hybrid?'JC15_HYBRID_ASSEMBLE_REPORTS_SOURCE':'JC14_CAP_ASSEMBLE_REPORTS_SOURCE',p.a.cutMaterial.some(r=>r.part==='distal'&&r.edge_length_px>0&&r.status==='SKIP'),JSON.stringify(p.a.cutMaterial));
    if(rigc!==undefined){
      const requirements=join(dir,hybrid?'hybrid-requirements.json':'cap-requirements.json');
      writeFileSync(requirements,JSON.stringify({spec:'spine-parts-requirements/1',fps:12,requirements:[],cut_material:[req]}));
      writeMaterialSources(join(p.out,'parts.json'),join(p.out,'parts'),p.a.parts,p.a.materialSources);
      const rig=join(dir,hybrid?'hybrid-rig':'cap-rig');
      rigStage({config:join(dir,hybrid?'hybrid':'cap','config.json'),parts:p.out,out:rig,idleKeys:'direct'},rigc,join(dir,hybrid?'hybrid-gate':'cap-gate'),()=>{});
      const checked=checkStage({rig,parts:p.out,out:join(dir,hybrid?'hybrid-check':'cap-check'),requirements,noExtremes:true},rigc,'fixture rigc',()=>{});
      say(hybrid?'JC28_HYBRID_CHECK_REQUIREMENTS_GREEN':'JC27_CAP_CHECK_REQUIREMENTS_GREEN',checked.figures.PASS&&checked.figures.CUT_JOINT_MATERIAL?.status==='PASS'&&!checked.problems.some(p=>p.code==='CHECK_CUT_JOINT_MATERIAL'),JSON.stringify({material:checked.figures.CUT_JOINT_MATERIAL,other:checked.problems.map(p=>p.code)}));
    }
  }
}
if(process.argv.includes('--controls')){
  let bad=0;runCutMaterialChecks(process.argv[process.argv.length-1],(n,p,d)=>{console.log(`${p?'PASS':'FAIL'} ${n} ${d}`);if(!p)bad++;});process.exitCode=bad?1:0;
}
