/** Public generated endpoint controls; no anatomical inference or private inputs. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFootOwnershipFixture, type FootLayout } from '../fixtures/foot_ownership.ts';
import { writeSubsetCapFixture } from '../fixtures/subset_cover.ts';
import { assembleConfig, flatPainting, HEAD_LAYERS, writeAssembleFixture, C, writeRun } from '../fixtures/assemble_fixture.ts';
import { assembleStage, build, gateThroughRigc, readRigInputs, rigOutputTexts, rigStage, type AssembleStageInput } from '../src/build.ts';
import type { RigcRunner } from '../src/check.ts';
import { loadConfig, parseConfig, parseEarlyConfig, type CharacterConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { bonePlaces, inDisc, jointLine, pastJoint } from '../src/limbs.ts';
import { readParts, serializeParts, type PartRecord } from '../src/parts.ts';
import { encodePngBytes, readPng } from '../src/raster/png.ts';
import { buildRig, rigJsonText } from '../src/rig.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
type Tips = Record<string, [number, number]>;
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const save = (p: string, v: unknown): void => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
const hash = (v: string | Uint8Array): string => createHash('sha256').update(v).digest('hex');
function refused(f: () => unknown): string {
  try { f(); return ''; } catch (e) { if (e instanceof PartsError) return e.message; throw e; }
}
function withTips(c: CharacterConfig, tips: unknown): unknown {
  const raw = structuredClone(c) as unknown as { assemble: { alternates: Record<string, unknown>[] } };
  raw.assemble.alternates[0].tips = tips; return raw;
}
function distance(a: readonly number[], b: readonly number[], x: number, y: number): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));
  return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);
}
export function runAlternateTipsChecks(dir: string, say: Say, runner: RigcRunner): void {
  const make = (name: string, layout: FootLayout = 'connected'): { d: string; cfg: CharacterConfig } => {
    const d = join(dir,name);writeFootOwnershipFixture(d,layout);return { d, cfg: loadConfig(join(d,'config.json')) };
  };
  const persist = (d: string, cfg: CharacterConfig): void => save(join(d,'config.json'),cfg);
  const run = (d: string, name: string, extra: Partial<AssembleStageInput> = {}): string => {
    const out=join(d,name), logs: string[]=[];
    assembleStage({source:join(d,'painting.png'),full:join(d,'full'),head:join(d,'head'),config:join(d,'config.json'),seam:'near-white',project:'core',...extra},
      {partsJson:join(out,'parts.json'),partsDir:join(out,'parts'),recomposite:join(out,'recomposite_rig.png'),errorMap:join(out,'recomposite_error_rig.png')},s=>logs.push(s));
    save(join(out,'log.json'),logs);return out;
  };
  const readRaw = (raw: unknown) => { const p = join(dir, 'generated-reader.json'); save(p, raw); return readParts(p); };
  const green=make('schema'), tips: Tips={foot_r:[108,60],foot_l:[92,100]};
  green.cfg.assemble.alternates![0].tips=tips;
  const schema=refused(()=>parseConfig(green.cfg)), early=refused(()=>parseEarlyConfig(green.cfg,'assemble'));
  say('FULL_AND_EARLY_ACCEPT_DECLARED_BOTH_SIDE_ENDPOINTS',schema===''&&early==='',schema+early);
  const noLimb=structuredClone(green.cfg);delete noLimb.limbs;for(const a of noLimb.assemble.alternates!)delete a.parts;
  say('EARLY_WITHOUT_LIMBS_STILL_VALIDATES_DECLARED_BONES',refused(()=>parseEarlyConfig(noLimb,'assemble'))===''&&refused(()=>parseEarlyConfig(withTips(noLimb,{absent:[1,2]}),'assemble')).includes('CONFIG_NAME_RESOLVES'),'tips trigger the bones reader independently of limbs');
  const noBones=structuredClone(noLimb) as unknown as Record<string,unknown>;delete noBones.bones;
  say('EARLY_MISSING_BONES_REFUSED',refused(()=>parseEarlyConfig(noBones,'assemble')).includes('CONFIG_FIELD_PRESENT'),'config.bones is required when alternate tips name bones');
  for(const [label,value] of [['UNKNOWN',{absent:[1,2]}],['CHAIN_SHORTHAND',{leg_r:[1,2]}],['IMPLICIT_ROOT',{root:[1,2]}],['EMPTY',{}],['ARRAY',[]],['NULL',null],['SHORT',{foot_r:[1]}],['LONG',{foot_r:[1,2,3]}],['STRING',{foot_r:['1',2]}],['INFINITE',{foot_r:[Infinity,2]}],['NAN',{foot_r:[NaN,2]}]] as const){
    const raw=withTips(green.cfg,value), full=refused(()=>parseConfig(raw)), e=refused(()=>parseEarlyConfig(raw,'assemble'));
    say(`BOTH_DOORS_REFUSE_${label}`,full.includes('config.assemble.alternates[0].tips')&&e.includes('config.assemble.alternates[0].tips'),full+'; '+e);
  }
  const outside=withTips(green.cfg,{foot_r:[-2,90]});
  say('FINITE_OUTSIDE_POINT_IS_NOT_CLIPPED_OR_GUESSED',refused(()=>parseConfig(outside))==='', 'finite endpoints are evidence, not a new inside-canvas bar');
  green.cfg.assemble.alternates![0].tips={leg_r0:[26,35],...tips};
  say('EXPANDED_LINK_ACCEPTED',refused(()=>parseConfig(green.cfg))==='', 'leg_r0 is an actual expanded bone; no suffix inference');
  const chain=bonePlaces(green.cfg.bones), overlay=bonePlaces(green.cfg.bones,{leg_r0:[19,24]});
  say('CHAIN_TIP_DOES_NOT_MOVE_NEXT_ORIGIN',equal(overlay.get('leg_r0')?.end,[19,24])&&equal(chain.get('leg_r1')?.at,overlay.get('leg_r1')?.at),'effective endpoint changes independently of the following joint');
  const bonesBefore=JSON.stringify(green.cfg.bones);let tipProblems: PartsError['problems']=[];
  try { bonePlaces(green.cfg.bones,{absent:[1,2],foot_r:[Infinity,2]}); }
  catch(e){if(!(e instanceof PartsError))throw e;tipProblems=e.problems;}
  say('DIRECT_ENDPOINT_HELPER_REFUSES_UNKNOWN_BONE',equal(tipProblems.map(p=>[p.code,p.object]),[['ASSEMBLE_ALT_TIP_NAME','alternate tips.absent'],['ASSEMBLE_ALT_TIP_POINT','alternate tips.foot_r']])&&JSON.stringify(green.cfg.bones)===bonesBefore,
    JSON.stringify(tipProblems));
  say('DIRECT_ENDPOINT_HELPER_REFUSES_NONFINITE_POINT',refused(()=>bonePlaces(green.cfg.bones,{foot_r:[Infinity,2]})).includes('ASSEMBLE_ALT_TIP_POINT'),'direct callers also require finite normalized endpoints');
  const bad=withTips(green.cfg,{absent:[1,2]});save(join(green.d,'config.json'),bad);
  const noEmit=refused(()=>run(green.d,'refused'));
  say('UNKNOWN_CONFIG_TIP_BEFORE_ANY_OWNED_OUTPUT',noEmit.includes('CONFIG_NAME_RESOLVES')&&!existsSync(join(green.d,'refused')),noEmit);

  for(const layout of ['islands','connected'] as const){
    const f=make(layout,layout), original=run(f.d,'original');
    for(const a of f.cfg.assemble.alternates!) a.tips={foot_l:[92,100],foot_r:[108,60]};
    persist(f.d,f.cfg);const out=run(f.d,'declared'),pf=readParts(join(out,'parts.json'));
    say(`${layout.toUpperCase()}_ENDPOINT_OVERLAY_AFTER_POSE_PRESERVES_CORRECT_PNGS`,readdirSync(join(original,'parts')).every(n=>readFileSync(join(original,'parts',n)).equals(readFileSync(join(out,'parts',n)))),'matching endpoints reproduce the original posed-global endpoint pixels');
    let owned=true, ledger=true;const rows: unknown[]=[];
    for(const side of ['r','l']){
      const alt=pf.alternates!.find(a=>a.name===`step_${side}`)!,p=alt.records.find(p=>p.name===`foot_${side}`)!;
      const img=readPng(join(out,'parts',`step_${side}_foot_${side}.png`));let foreign=0,live=0;
      for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++)if(img.data[(y*img.width+x)*4+3]>8){
        live++;const xx=p.x+x+.5,yy=p.y+y+.5,r=distance([46,30],[54,30],xx,yy),l=distance([38,50],[46,50],xx,yy);
        if((Math.abs(r-l)<=.5?'l':r<l?'r':'l')!==side)foreign++;
      }
      owned&&=live>0&&foreign===0;
      const cap=p.limb!.cap!,line=side==='r'?jointLine([26,30],[46,30],[54,30]):jointLine([38,30],[38,50],[46,50]);
      if(line===null)throw Error('generated cap line missing');let capPixels=0;
      for(let y=cap.box[1];y<cap.box[1]+cap.box[3];y++)for(let x=cap.box[0];x<cap.box[0]+cap.box[2];x++){
        if(x<p.x||y<p.y||x>=p.x+p.w||y>=p.y+p.h)continue;
        if(inDisc(cap.at,cap.radius,x,y)&&!pastJoint(line,x,y)&&img.data[((y-p.y)*img.width+x-p.x)*4+3]>0)capPixels++;
      }
      const counted=cap.layer_px+(cap.upper_px??0)+(cap.image_px??0);ledger&&=capPixels===counted;
      rows.push({side,live,foreign,capPixels,counted});
    }
    say(`${layout.toUpperCase()}_BOTH_SHOES_HAVE_ZERO_FOREIGN_PIXELS`,owned,JSON.stringify(rows));
    say(`${layout.toUpperCase()}_CAP_LEDGER_MATCHES_PNG`,ledger,JSON.stringify(rows));
    const serialized=serializeParts(pf);
    say(`${layout.toUpperCase()}_NORMALIZED_RECORD_KEYS_ARE_STABLE_AND_READABLE`,pf.alternates!.every(a=>equal(Object.keys(a.tips!),['foot_l','foot_r'])&&equal(a.tips!.foot_r,[54,30]))&&serializeParts(readRaw(JSON.parse(serialized)))===serialized,'parts records carry rig-crop endpoints, not raw config fallback');
    for(const b of f.cfg.bones)if('name'in b&&b.name.startsWith('foot_'))delete b.tip;
    persist(f.d,f.cfg);const noGlobal=run(f.d,'no-global');
    say(`${layout.toUpperCase()}_EXPLICIT_ENDPOINT_WITHOUT_GLOBAL_TIP`,readParts(join(noGlobal,'parts.json')).alternates!.every(a=>a.tips!==undefined),'tip overlay must run in this assignment door, not only be recorded');
    for(const a of f.cfg.assemble.alternates!)delete a.tips;
    persist(f.d,f.cfg);const ignored=refused(()=>run(f.d,'ignored-tips-mutant'));
    say(`${layout.toUpperCase()}_MISSING_ENDPOINT_MUTANT_REFUSED`,ignored.includes('ASSEMBLE_ALT_LIMB_POSE')&&!existsSync(join(f.d,'ignored-tips-mutant')),ignored);

  }

  // Reuse the public #637 adversarial cap geometry with explicit set endpoints.
  for(const mode of ['near','far','islands'] as const){
    const d=join(dir,'cap-'+mode);writeSubsetCapFixture(d);const cfg=loadConfig(join(d,'config.json'));
    cfg.assemble.alternates=cfg.assemble.alternates!.slice(0,1);
    const pose=JSON.parse(readFileSync(join(d,'pose.json'),'utf8')) as {points:Record<string,number[]>};
    const otherY=mode==='far'?50:34;pose.points.l_ankle=[38,otherY];save(join(d,'pose.json'),pose);
    if(mode==='islands')writeRun(join(d,'step'),[
      {name:'legwear',depth:.6,rects:[[22,10,30,34],[30,26,46,34],[34,10,42,50]].map(([x0,y0,x1,y1])=>({x0,y0,x1,y1,colour:C}))},
      {name:'footwear',depth:.4,rects:[[44,28,56,34],[36,48,48,54]].map(([x0,y0,x1,y1])=>({x0,y0,x1,y1,colour:C}))}]);
    cfg.assemble.alternates[0].tips={foot_r:[108,60],foot_l:[92,otherY*2]};persist(d,cfg);
    const out=run(d,'target'),mutant=run(d,'source',{setCapOwnership:'source'}),pf=readParts(join(out,'parts.json'));
    const p=pf.alternates![0].records.find(p=>p.name==='foot_r')!,m=readParts(join(mutant,'parts.json')).alternates![0].records.find(p=>p.name==='foot_r')!;
    const image=readPng(join(out,'parts','step_r_foot_r.png')),mi=readPng(join(mutant,'parts','step_r_foot_r.png'));
    const alpha=(rec:PartRecord,img:ReturnType<typeof readPng>,x:number,y:number):number=>x<rec.x||y<rec.y||x>=rec.x+rec.w||y>=rec.y+rec.h?0:img.data[((y-rec.y)*img.width+x-rec.x)*4+3];
    let before=0,after=0;const cap=m.limb!.cap!;
    for(let y=cap.box[1];y<cap.box[1]+cap.box[3];y++)for(let x=cap.box[0];x<cap.box[0]+cap.box[2];x++){
      // Public independent ankle-to-toe distance witness, strictly outside tie band.
      if(distance([46,30],[54,30],x+.5,y+.5)-distance([38,otherY],[46,otherY],x+.5,y+.5)<=.5)continue;
      // The island door deliberately keeps its assigned source island. This
      // witness is for copied cap art, not a new distance override of source art.
      if(mode==='islands'&&((x>=44&&x<56&&y>=28&&y<34)||(x>=36&&x<48&&y>=48&&y<54)))continue;
      if(alpha(m,mi,x,y)>0)before++;if(alpha(p,image,x,y)>0)after++;
    }
    say(`CAP_${mode.toUpperCase()}_ACTUAL_MUTANT_HAS_FOREIGN_PIXELS`,before>0&&after===0,JSON.stringify({before,after}));
    if(mode==='far'){
      const held=(box:number[]):number=>{let n=0;for(let y=box[1];y<box[3];y++)for(let x=box[0];x<box[2];x++)if(alpha(p,image,x,y)>8)n++;return n;};
      say('EXPLICIT_ENDPOINTS_KEEP_BRIDGE64_AND_END16',held([34,26,42,34])===64&&held([32,26,34,34])===16,JSON.stringify({bridge:held([34,26,42,34]),end:held([32,26,34,34])}));
    }
  }

  const missing=make('missing');for(const b of missing.cfg.bones)if('name'in b&&b.name.startsWith('foot_'))delete b.tip;
  persist(missing.d,missing.cfg);const absent=refused(()=>run(missing.d,'absent'));
  say('SAME_SHARED_SHOES_WITHOUT_SUPPLIED_END_REFUSED',absent.includes('ASSEMBLE_ALT_LIMB_POSE')&&!existsSync(join(missing.d,'absent')),absent);
  for(const a of missing.cfg.assemble.alternates!)a.tips=tips;
  persist(missing.d,missing.cfg);const supplied=run(missing.d,'supplied');
  say('EXPLICIT_TIPS_SUPPLY_MISSING_TERMINAL_ENDS',readParts(join(supplied,'parts.json')).alternates!.every(a=>a.records.some(p=>p.name.startsWith('foot_'))),'same public shoes; origins remain supplied by existing skeleton');
  delete missing.cfg.assemble.alternates![0].skeleton;missing.cfg.assemble.alternates![0].drawn={leg_r0:-90,leg_r1:0};persist(missing.d,missing.cfg);
  const unposed=refused(()=>run(missing.d,'unposed'));
  say('TIP_ALONE_NEVER_MARKS_OTHER_ORIGIN_POSED',unposed.includes('ASSEMBLE_ALT_LIMB_POSE')&&!existsSync(join(missing.d,'unposed')),unposed);

  const scaledDir=join(dir,'scaled');mkdirSync(scaledDir,{recursive:true});
  const scaledCfg=assembleConfig({rigScale:.73,plan:[['shoes','full','footwear']],extend:[]});
  (scaledCfg.assemble as Record<string,unknown>).alternates=[{name:'step',source:'painting.png',full:'full',head:'head',tips:{anchor:[108,60]}}];
  writeAssembleFixture(scaledDir,scaledCfg,flatPainting(124,128),{full:[{name:'footwear',depth:.4,rects:[{x0:24,y0:28,x1:48,y1:54,colour:C}]}],head:HEAD_LAYERS});
  const scaledOut=run(scaledDir,'output'),scaledParts=readParts(join(scaledOut,'parts.json'));
  say('RECTANGULAR_NONINTEGRAL_SCALE_USES_ACTUAL_RASTER_RATIO_ONCE',equal(scaledParts.rig_size,[93,90])&&equal(scaledParts.alternates![0].tips!.anchor,[108*(93/128),60*(90/124)]),JSON.stringify(scaledParts.alternates![0].tips));

  const scaledInput=readRigInputs(join(scaledDir,'config.json'),scaledOut);
  say('RECTANGULAR_CONFIG_MATCHES_USING_RECORDED_SOURCE_SIZE',refused(()=>buildRig(scaledInput.cfg,scaledInput.parts,scaledInput.images))==='', '93/128 and 90/124, not nominal .73');
  const nominal=structuredClone(scaledInput.parts);nominal.alternates![0].tips!.anchor=[108*.73,60*.73];
  say('NOMINAL_SCALE_NORMALIZATION_MUTANT_REFUSED',refused(()=>buildRig(scaledInput.cfg,nominal,scaledInput.images)).includes('RIG_ALT_TIPS_MATCH_CONFIG'),'nominal scale cannot reconstruct the accepted nonintegral raster ratios');

  const f=make('rig');f.cfg.motion={duration:1,tracks:[{bone:'hip',prop:'rotate',amp:0,period:1,phase:0}]};persist(f.d,f.cfg);const original=run(f.d,'plain');for(const a of f.cfg.assemble.alternates!)a.tips=tips;persist(f.d,f.cfg);const out=run(f.d,'parts-with-tips');
  const input=readRigInputs(join(f.d,'config.json'),out),r=buildRig(input.cfg,input.parts,input.images),text=rigOutputTexts(r,null);
  const gate=gateThroughRigc(r.images.map(([n,img])=>[n,encodePngBytes(img)] as const),text,runner,join(f.d,'core-gate'),null);
  say('NORMALIZED_PARTS_TO_RIG_ACTUAL_CORE_GATE',gate.length>0&&gate.every(g=>g.status===0),JSON.stringify(gate.map(g=>({status:g.status,lines:g.lines}))));
  const stage=rigStage({config:join(f.d,'config.json'),parts:out,out:join(f.d,'standalone')},runner,join(f.d,'scratch'),()=>{});
  say('STANDALONE_AND_MEMORY_RIG_BYTES_MATCH',rigJsonText(stage.rig)===rigJsonText(r.rig)&&!Object.hasOwn(r.sets!.sets.step_r,'tips')&&!Object.hasOwn(r.rig,'tips'),'recorded endpoints consumed locally; no unconsumed sets/core fields');
  const stale=refused(()=>rigStage({config:join(f.d,'config.json'),parts:original,out:join(f.d,'stale-output')},runner,join(f.d,'stale-scratch'),()=>{}));
  say('CONFIG_TIPS_WITHOUT_RECORDED_PROVENANCE_REFUSED',stale.includes('RIG_ALT_TIPS_RECORDED')&&!existsSync(join(f.d,'stale-output')),stale);
  const badParts=structuredClone(input.parts);badParts.alternates![0].tips={absent:[1,2]};
  const noDeclaredTips=structuredClone(input.cfg);delete noDeclaredTips.assemble.alternates;
  say('RECORDED_UNKNOWN_BONE_REFUSED_BY_RIG',refused(()=>buildRig(noDeclaredTips,badParts,input.images)).includes('RIG_NAME_RESOLVES'),'parts reader cannot know config bone names; rig must resolve them');
  const directBad=structuredClone(input.parts);directBad.alternates![0].tips!.foot_r=[NaN,2];
  say('DIRECT_RIG_NONFINITE_RECORD_REFUSED',refused(()=>buildRig(noDeclaredTips,directBad,input.images)).includes('RIG_ALT_TIP_POINT'),'direct builder checks pairs even without a serialized reader');
  for(const [i,value] of [null,{},[],{foot_r:[1]},{foot_r:[NaN,2]}].entries()){
    const raw=JSON.parse(serializeParts(input.parts)) as {alternates:Record<string,unknown>[]};raw.alternates[0].tips=value;
    say('RECORDED_INVALID_POINT_'+String(i),refused(()=>readRaw(raw)).includes('PARTS_ALT_TIPS'),'malformed normalized provenance refused before rig emission');
  }
  // A build orchestration plant stops at check after the real rig gate. It is
  // not a full build/check PASS; it proves propagation through the actual path.
  let checkCalls=0;
  const built=build({config:join(f.d,'config.json'),source:join(f.d,'painting.png'),full:join(f.d,'full'),head:join(f.d,'head'),out:join(f.d,'one-process'),seam:'near-white',project:'core',loop:false,pageEdges:'free'},
    {rig:runner,check:()=>{checkCalls++;return {status:1,out:'PLANTED_CHECK_STOP'};},checkBin:'generated-check-stop',scratch:join(f.d,'build-scratch')},()=>{});
  say('BUILD_PATH_REACHES_CHECK_AFTER_REAL_RIG_GATE',built.stoppedAt==='check'&&checkCalls>0&&readFileSync(join(f.d,'one-process','rig','rig.json'),'utf8')===rigJsonText(r.rig),'actual build assembly and core-gated rig match standalone; intentional check refusal, no full check claim');
  const changedRaw=structuredClone(input.cfg);changedRaw.assemble.alternates![0].tips={foot_r:[2,2]};
  say('CONFIGURED_AND_RECORDED_KEY_MISMATCH_REFUSED',refused(()=>buildRig(changedRaw,input.parts,input.images)).includes('RIG_ALT_TIPS_MATCH_CONFIG'),'a config edit cannot silently use stale recorded endpoints');
  const changedValue=structuredClone(input.cfg);changedValue.assemble.alternates![0].tips!.foot_r=[2,2];
  say('CONFIGURED_AND_RECORDED_VALUE_MISMATCH_REFUSED',refused(()=>buildRig(changedValue,input.parts,input.images)).includes('RIG_ALT_TIPS_MATCH_CONFIG'),'comparison normalizes using recorded actual source dimensions');
  const wrongUnits=structuredClone(input.parts);wrongUnits.alternates![0].tips!.foot_r=[108,60];
  say('TAMPERED_SOURCE_UNITS_IN_RIG_RECORD_REFUSED',refused(()=>buildRig(input.cfg,wrongUnits,input.images)).includes('RIG_ALT_TIPS_MATCH_CONFIG'),'source pair is not a rig pair; structural consistency only');
  const missingSize=structuredClone(input.parts);delete missingSize.alternates![0].tips_source_size;
  say('MISSING_SOURCE_SIZE_REFUSED_BY_READER_AND_RIG',refused(()=>readRaw(missingSize)).includes('PARTS_ALT_TIPS_SOURCE')&&refused(()=>buildRig(input.cfg,missingSize,input.images)).includes('RIG_ALT_TIPS_SOURCE')&&refused(()=>buildRig(noDeclaredTips,missingSize,input.images)).includes('RIG_ALT_TIPS_SOURCE'),'reassemble rather than reconstruct original size from nominal scale');
  for(const [i,value] of [null,[0,128],[128.5,128],[64,64],[128],[128,Infinity]].entries()){
    const raw=JSON.parse(serializeParts(input.parts)) as {alternates:Record<string,unknown>[]};raw.alternates[0].tips_source_size=value;
    say('INVALID_SOURCE_SIZE_'+i,refused(()=>readRaw(raw)).includes('PARTS_ALT_TIPS_SOURCE'),'positive integer source dimensions must produce accepted rig_size at nominal scale');
  }
  const noEmitPath=join(f.d,'mismatch-output');save(join(out,'parts.json'),wrongUnits);
  const mismatch=refused(()=>rigStage({config:join(f.d,'config.json'),parts:out,out:noEmitPath},runner,join(f.d,'mismatch-scratch'),()=>{}));
  say('UNIT_MISMATCH_BEFORE_RIG_OWNED_EMISSION',mismatch.includes('RIG_ALT_TIPS_MATCH_CONFIG')&&!existsSync(noEmitPath),mismatch);save(join(out,'parts.json'),input.parts);

  // A separate loader-valid non-limb mesh gives both endpoints influence. The
  // limb meshes above intentionally bind each part to one bone, so changing a
  // weighting segment there is not a meaningful endpoint-consumption mutant.
  const md=join(dir,'mesh-endpoint'),mc=assembleConfig({plan:[['panel','full','legwear']],extend:[]});
  mc.bones=[{name:'a',parent:'root',at:[20,20],tip:[20,50]},{name:'b',parent:'root',at:[40,20],tip:[40,50]}];
  mc.regions={};mc.meshes={panel:{grid:4,r:40,segments:['a','b']}};mc.motion={duration:1,tracks:[{bone:'a',prop:'rotate',amp:0,period:1,phase:0}]};
  (mc.assemble as Record<string,unknown>).alternates=[{name:'step',source:'painting.png',full:'full',head:'head',drawn:{a:-90,b:-90},tips:{a:[70,80]}}];
  writeAssembleFixture(md,mc,flatPainting(),{full:[{name:'legwear',depth:.6,rects:[{x0:24,y0:28,x1:40,y1:44,colour:C}]}],head:HEAD_LAYERS});
  const mo=run(md,'output'),mi=readRigInputs(join(md,'config.json'),mo),meshA=buildRig(mi.cfg,mi.parts,mi.images);
  const changed=structuredClone(mi.parts),meshCfg=structuredClone(mi.cfg);delete meshCfg.assemble.alternates;
  changed.alternates![0].tips!.a=[15,40];const meshB=buildRig(meshCfg,changed,mi.images);
  say('RIG_NAMED_MESH_CONSUMES_RECORDED_ENDPOINT',hash(rigJsonText(meshA.rig.skins.default.panel.step_panel))!==hash(rigJsonText(meshB.rig.skins.default.panel.step_panel)),'loader-valid two-bone mesh; changed recorded endpoint with unchanged origins, rotations and pixels');
  meshCfg.meshes.panel={grid:4,r:40,segments:[['a',[20,20],[20,50]],['b',[40,20],[40,50]]]};
  const tupleA=buildRig(meshCfg,mi.parts,mi.images),tupleB=buildRig(meshCfg,changed,mi.images);
  say('EXPLICIT_MESH_COORDINATE_TUPLE_PRIORITY_UNCHANGED',equal(tupleA.rig,tupleB.rig),'endpoint overlay cannot rewrite independent authored coordinate tuples');

  // A short old endpoint misses this alternate's rows. Its explicit endpoint
  // reaches them; selection must therefore read the overlaid endpoint first.
  const orderDir=join(dir,'endpoint-selection'),orderCfg=structuredClone(mc);
  orderCfg.bones=[{name:'a',parent:'root',at:[20,20],tip:[20,24]},{name:'b',parent:'root',at:[40,20],tip:[40,50]}];
  writeAssembleFixture(orderDir,orderCfg,flatPainting(),{full:[{name:'legwear',depth:.6,rects:[{x0:24,y0:28,x1:40,y1:44,colour:C}]}],head:HEAD_LAYERS});
  const orderOut=run(orderDir,'output'),orderInput=readRigInputs(join(orderDir,'config.json'),orderOut);
  const ordered=buildRig(orderInput.cfg,orderInput.parts,orderInput.images);
  const referenceCfg=structuredClone(orderInput.cfg);
  referenceCfg.meshes.panel.segments=[['a',[20,20],[35,40]],'b'];
  const referenceValid=refused(()=>parseConfig(referenceCfg));
  const reference=buildRig(referenceCfg,orderInput.parts,orderInput.images);
  const attachment=(r:ReturnType<typeof buildRig>,name='step_panel')=>{
    const a=r.rig.skins.default.panel[name];
    if(!('type' in a)||a.type!=='mesh')throw Error('generated two-bone mesh required');
    return a;
  };
  const boneNames=(r:ReturnType<typeof buildRig>,name='step_panel'):string[]=>[...new Set(attachment(r,name).weights.flatMap(v=>v.map(e=>e.bone)))].sort();
  say('FINAL_ENDPOINT_SELECTION_EQUALS_INDEPENDENT_COORDINATE_REFERENCE',referenceValid===''&&equal(orderInput.parts.alternates![0].tips!.a,[35,40])&&equal(boneNames(ordered,'panel'),['a','b'])&&equal(boneNames(ordered),['a','b'])&&equal(attachment(ordered),attachment(reference)),
    JSON.stringify({normalizedTip:orderInput.parts.alternates![0].tips!.a,actual:boneNames(ordered),reference:boneNames(reference),actualSha:hash(rigJsonText(attachment(ordered))),referenceSha:hash(rigJsonText(attachment(reference)))}));
  const ignoredCfg=structuredClone(orderInput.cfg),ignoredParts=structuredClone(orderInput.parts);
  for(const a of ignoredCfg.assemble.alternates!)delete a.tips;
  for(const a of ignoredParts.alternates!){delete a.tips;delete a.tips_source_size;}
  const ignored=buildRig(ignoredCfg,ignoredParts,orderInput.images);
  say('IGNORED_ENDPOINT_MUTANT_LOSES_THE_NEWLY_REACHING_BONE',equal(boneNames(ignored),['b'])&&!equal(attachment(ordered),attachment(ignored)),
    JSON.stringify({actual:boneNames(ordered),ignored:boneNames(ignored),actualSha:hash(rigJsonText(attachment(ordered))),ignoredSha:hash(rigJsonText(attachment(ignored)))}));
  const orderGates=gateThroughRigc(ordered.images.map(([n,img])=>[n,encodePngBytes(img)] as const),rigOutputTexts(ordered,null),runner,join(orderDir,'core-gate'),null);
  say('ENDPOINT_SELECTION_REGRESSION_ACTUAL_CORE_GATE',orderGates.length>0&&orderGates.every(g=>g.status===0),JSON.stringify(orderGates.map(g=>({status:g.status,lines:g.lines}))));

  // The first tuple has no base weights and is filtered out. The remaining
  // named a must retain its original entry; tuple b must ignore its own tip.
  const mixedDir=join(dir,'mixed-entries'),mixedCfg=structuredClone(orderInput.cfg);
  mixedCfg.bones.push({name:'c',parent:'root',at:[10000,10000],tip:[10000,10020]});
  mixedCfg.meshes.panel.segments=[['c',[10000,10000],[10000,10020]],'a',['b',[40,20],[40,50]]];
  mixedCfg.assemble.alternates![0].tips={a:[70,80],b:[0,0]};
  writeAssembleFixture(mixedDir,mixedCfg as unknown as Record<string,unknown>,flatPainting(),{full:[{name:'legwear',depth:.6,rects:[{x0:24,y0:28,x1:40,y1:44,colour:C}]}],head:HEAD_LAYERS});
  const mixedOut=run(mixedDir,'output'),mixedInput=readRigInputs(join(mixedDir,'config.json'),mixedOut);
  const mixed=buildRig(mixedInput.cfg,mixedInput.parts,mixedInput.images);
  say('FILTERED_MIXED_ENTRIES_RETAIN_ORIGINAL_TUPLE_NAMED_ASSOCIATION',equal(boneNames(mixed,'panel'),['a','b'])&&equal(boneNames(mixed),['a','b'])&&equal(attachment(mixed),attachment(reference)),
    JSON.stringify({base:boneNames(mixed,'panel'),alternate:boneNames(mixed),expected:boneNames(reference),firstTupleFiltered:!boneNames(mixed,'panel').includes('c'),tupleBRecordedTip:mixedInput.parts.alternates![0].tips!.b}));
  const unknownMixed=structuredClone(mixedInput.cfg);unknownMixed.meshes.panel.segments[1]='absent';
  save(join(mixedDir,'config.json'),unknownMixed);let unknownGateCalls=0;const unknownOut=join(mixedDir,'unknown-output');
  const unknownError=refused(()=>rigStage({config:join(mixedDir,'config.json'),parts:mixedOut,out:unknownOut},()=>{unknownGateCalls++;return {status:1,out:'UNEXPECTED_GATE_CALL'};},join(mixedDir,'unknown-scratch'),()=>{}));
  say('MIXED_UNKNOWN_SEGMENT_REFUSED_BEFORE_GATE_OR_OWNED_OUTPUT',unknownError.includes('CONFIG_NAME_RESOLVES')&&unknownError.includes('config.meshes.panel.segments[1]')&&unknownGateCalls===0&&!existsSync(unknownOut),unknownError);
  save(join(mixedDir,'config.json'),mixedInput.cfg);

  // Removing tips from an existing config set must invalidate its old record.
  // Removing the entire config entry instead leaves the supported record-only path.
  const removedTipsCfg=structuredClone(orderInput.cfg);
  delete removedTipsCfg.assemble.alternates![0].tips;
  persist(orderDir,removedTipsCfg);
  const removedLoaded=readRigInputs(join(orderDir,'config.json'),orderOut);
  const staleDirect=refused(()=>buildRig(removedLoaded.cfg,removedLoaded.parts,removedLoaded.images));
  let deletedGateCalls=0;const deletedOut=join(orderDir,'deleted-tips-output');
  const deletedError=refused(()=>rigStage({config:join(orderDir,'config.json'),parts:orderOut,out:deletedOut},()=>{deletedGateCalls++;return {status:1,out:'UNEXPECTED_GATE_CALL'};},join(orderDir,'deleted-tips-scratch'),()=>{}));
  say('DELETED_CONFIG_TIPS_REFUSED_BEFORE_GATE_OR_OWNED_OUTPUT',staleDirect.includes('RIG_ALT_TIPS_MATCH_CONFIG')&&deletedError.includes('RIG_ALT_TIPS_MATCH_CONFIG')&&deletedError.includes('step')&&deletedError.includes('re-run assemble')&&deletedGateCalls===0&&!existsSync(deletedOut),
    JSON.stringify({error:deletedError,gateCalls:deletedGateCalls,outputExists:existsSync(deletedOut),staleBones:boneNames(ordered)}));
  const reassembledOut=run(orderDir,'reassembled-without-tips');
  let reassembledCalls=0;const reassembledExits:number[]=[];
  const reassembled=rigStage({config:join(orderDir,'config.json'),parts:reassembledOut,out:join(orderDir,'reassembled-rig')},args=>{reassembledCalls++;const result=runner(args);reassembledExits.push(result.status);return result;},join(orderDir,'reassembled-scratch'),()=>{});
  const reassembledParts=readParts(join(reassembledOut,'parts.json'));
  say('REASSEMBLY_AFTER_TIP_DELETION_REMOVES_OVERRIDE',reassembledCalls>0&&reassembledExits.every(n=>n===0)&&equal(boneNames(reassembled),['b'])&&equal(boneNames(ordered),['a','b'])&&equal(attachment(reassembled),attachment(ignored))&&reassembledParts.alternates![0].tips===undefined&&reassembledParts.alternates![0].tips_source_size===undefined,
    JSON.stringify({stale:boneNames(ordered),reassembled:boneNames(reassembled),gateCalls:reassembledCalls,gateExits:reassembledExits,staleSha:hash(rigJsonText(attachment(ordered))),freshSha:hash(rigJsonText(attachment(reassembled)))}));
  const recordOnlyCfg=structuredClone(orderInput.cfg);delete recordOnlyCfg.assemble.alternates;
  persist(orderDir,recordOnlyCfg);
  let recordOnlyCalls=0;const recordOnlyExits:number[]=[];
  const recordOnly=rigStage({config:join(orderDir,'config.json'),parts:orderOut,out:join(orderDir,'record-only-rig')},args=>{recordOnlyCalls++;const result=runner(args);recordOnlyExits.push(result.status);return result;},join(orderDir,'record-only-scratch'),()=>{});
  say('ENTIRE_CONFIG_SET_ABSENT_ACCEPTS_VALIDATED_RECORD_ONLY_TIPS',loadConfig(join(orderDir,'config.json')).assemble.alternates===undefined&&recordOnlyCalls>0&&recordOnlyExits.every(n=>n===0)&&equal(attachment(recordOnly),attachment(ordered)),
    JSON.stringify({bones:boneNames(recordOnly),gateCalls:recordOnlyCalls,gateExits:recordOnlyExits,attachmentSha:hash(rigJsonText(attachment(recordOnly)))}));
  const extraOut=run(orderDir,'cli-extra-parts',{alts:[{name:'extra',source:join(orderDir,'painting.png'),full:join(orderDir,'full'),head:join(orderDir,'head')}]});
  let extraCalls=0;const extraExits:number[]=[];
  const extra=rigStage({config:join(orderDir,'config.json'),parts:extraOut,out:join(orderDir,'cli-extra-rig')},args=>{extraCalls++;const result=runner(args);extraExits.push(result.status);return result;},join(orderDir,'cli-extra-scratch'),()=>{});
  const extraParts=readParts(join(extraOut,'parts.json'));
  say('CLI_EXTRA_WITHOUT_CONFIG_SET_REMAINS_SUPPORTED',extraCalls>0&&extraExits.every(n=>n===0)&&extraParts.alternates?.length===1&&extraParts.alternates[0].name==='extra'&&extraParts.alternates[0].tips===undefined&&extraParts.alternates[0].tips_source_size===undefined&&attachment(extra,'extra_panel').weights.length>0,
    JSON.stringify({setNames:extraParts.alternates?.map(a=>a.name),gateCalls:extraCalls,gateExits:extraExits,bones:boneNames(extra,'extra_panel')}));
  persist(orderDir,orderInput.cfg);
}
