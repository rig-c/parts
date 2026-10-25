/** Reproducible #399 acceptance on public synthetic pixels; heavyweight mode runs on the farm. */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseRigSpec } from 'rig-c/src/rig.ts';
import { parseMotionSpec } from 'rig-c/src/motion.ts';
import { loadCandidate, type GeometryFile } from 'rig-c/src/render_shared.ts';
import type { SeamFile } from 'rig-c/src/seam.ts';
import type { FoldsFile } from 'rig-c/src/folds.ts';
import { Plate } from 'rig-c/tools/plate.ts';
import { prepareHybrid } from './check_hybrid_limb.ts';
import { processRigcRunner } from './build-process.ts';
import { readFrameSet, sweepAngles, sweepAnimationName, sweepCopy, sweepJoints, sweepLine, sweepUnderlay, type FrameSet } from '../src/check.ts';
import { gateThroughRigc, rigOutputTexts } from '../src/build.ts';
import { paintingToSetupPoint, computeExactFrameTransforms, toBoneLocal } from '../src/coords.ts';
import { encodePngBytes, writePng } from '../src/raster/png.ts';
import { rigJsonText, type MeshAttachment } from '../src/rig.ts';

const root = resolve(process.argv[2] ?? 'scratch/hybrid-acceptance');
const mode = process.argv[3] ?? '--prepare';
mkdirSync(root, { recursive: true });
const rigc = processRigcRunner(resolve('node_modules/.bin/rigc'));
const commands: Array<{ args: string[]; status: number }> = [];
function run(args: string[]): void {
 const result = rigc(args); commands.push({ args, status: result.status });
 writeFileSync(join(root, `command-${commands.length}.log`), result.out);
 if (result.status !== 0) throw new Error(`rigc ${args[0]} exit ${result.status}: ${result.out}`);
}
const sheet = new Plate(640, 510); sheet.rect(0, 0, 640, 510, [245,245,245,255]);
const rows: Array<{name:string;range:ReturnType<typeof sweepLine>;folds:FoldsFile[];seams:SeamFile[];whole_sleeve_reported:unknown;leaks:unknown}> = [];
const setsOf = (dir: string): Map<string, FrameSet> => {
 const f = JSON.parse(readFileSync(join(dir,'frames.json'),'utf8')) as { sets: Array<{ animation: string; dir: string }> };
 return new Map(f.sets.map((s) => [s.animation, readFrameSet(join(dir,s.dir))]));
};
for (const [i, name] of ['cut', 'hybrid', 'one-bone'].entries()) {
 const dir = join(root, name), p = prepareHybrid(dir, name !== 'cut');
 if (name === 'one-bone') {
  // Bind to the upper bone in that bone's frame, preserving setup geometry.
  for (const track of p.r.motion.animations.idle.tracks) if ('bone' in track && track.bone === 'lower') track.bone = 'upper';
  const mesh = p.r.rig.skins.default.joint_band.joint_band as MeshAttachment;
  const world = computeExactFrameTransforms(p.r.rig.bones), upper = world.get('upper');
  if (!upper) throw new Error('upper transform absent');
  const part = p.parsed.parts.find((x) => x.name === 'joint_band'); if (!part) throw new Error('band absent');
  mesh.weights = mesh.uvs.reduce<Array<Array<{bone:string;x:number;y:number;weight:number}>>>((all, _, k) => {
   if (k % 2) return all;
   const point = paintingToSetupPoint([mesh.uvs[k]*mesh.width + part.x-4,mesh.uvs[k+1]*mesh.height + part.y-4],p.parsed.rig_size,p.parsed.rig_size);
   const [x,y] = toBoneLocal(upper,point[0],point[1]); all.push([{bone:'upper',x,y,weight:1}]); return all;
  },[]);
 }
 const joints = sweepJoints(p.parsed);
 const under = joints.map((j) => sweepUnderlay(p.parsed, n => p.images.get(n)!,j));
 const copy = sweepCopy({...p.r.rig},{...p.r.motion},joints,under,()=>p.r.rig.slots.map(s=>s.name),{x:-32,y:0,width:64,height:64},64);
 copy.motion = { ...copy.motion, animations: { ...p.r.motion.animations, ...(copy.motion.animations as Record<string, unknown>),
  'full range': {duration:1,tracks:[{bone:'lower',property:'rotate',keys:[{t:0,v:[-30]},{t:1,v:[30]}]}]},
 } };
 const images = [...p.r.images.map(([n,r]) => [n,encodePngBytes(r)] as const), ...copy.images.map(([n,r]) => [n,encodePngBytes(r)] as const)];
 const raw = join(dir,'sweep');mkdirSync(join(raw,'images'),{recursive:true});
 for (const [n,b] of images) writeFileSync(join(raw,'images',n),b);
 // Source specs are portable; the gate's own scratch supplies their images directory.
 const texts: Array<[string,string]> = [['rig.json',rigJsonText({...copy.rig,images:'images'})],['motion.json',rigJsonText(copy.motion)]];
 for (const [n,t] of texts) writeFileSync(join(raw,n),t);
 parseRigSpec(JSON.parse(texts[0][1]),join(raw,'rig.json'));parseMotionSpec(JSON.parse(texts[1][1]),join(raw,'motion.json'));
 for (const [n] of images) readFileSync(join(raw,'images',n));
 console.log(`PREPARE ${name}: actual parts/config/rig/motion/image readers green`);
 if (mode === '--prepare') continue;
 const build=join(raw,'build');
 const gates=gateThroughRigc(images,texts,rigc,join(dir,'gate'),null,b=>cpSync(b,build,{recursive:true}));
 if (gates.some(g=>g.status!==0)) throw new Error(JSON.stringify(gates));
 const skeleton=join(build,'skeleton.json'),atlas=join(build,'skeleton.atlas');
 const candidate=loadCandidate({skeletonText:readFileSync(skeleton,'utf8'),atlasText:readFileSync(atlas,'utf8'),atlasDir:build,label:name},{skeleton,atlas},'core');
 if(!candidate.choice.core) throw new Error(candidate.choice.why);
 candidate.choice.core.setup(undefined);
 console.log(`BOOTSTRAP ${name}: gate and actual core poser reader green`);
 if (mode === '--bootstrap') continue;
 if (mode !== '--measure') throw new Error('expected --prepare, --bootstrap or --measure');
 // Explicit common viewport; --hide cannot be combined with --folds.
 const render=join(raw,'render'), bare=join(raw,'bare');
 run(['render','--candidate',build,'--fps','60','--max','256','--viewport','-32,0,64,64','--folds','--geometry','--seam',name==='cut'?'proximal:distal':'proximal:joint_band,joint_band:distal','--out',render]);
 run(['render','--candidate',build,'--fps','60','--max','256','--viewport','-32,0,64,64','--hide',copy.slots.join(','),'--out',bare]);
 const underSets=setsOf(render),bareSets=setsOf(bare);
 const reading=sweepLine(joints,under.map(u=>u.px),joints.map(()=>null),a=>({under:underSets.get(a)!,bare:bareSets.get(a)!}),0,[]);
 const folds: FoldsFile[]=[];
 for (const set of underSets.values()) {
  const f=JSON.parse(readFileSync(join(set.dir,'folds.json'),'utf8')) as FoldsFile;folds.push(f);
 }
 const setup=bareSets.get(sweepAnimationName('distal',0))!;
 const difference=sweepAngles([-30,30]).map(a=>{
  const posed=bareSets.get(sweepAnimationName('distal',a))!;
  let changed=0,uncovered=0;
  // Whole setup sleeve support, including its drape; a reported static-reference
  // difference, not a tear detector (ordinary intended motion also changes it).
  for(let px=0;px<setup.frames[0].image.width*setup.frames[0].image.height;px++) {
   const at=px*4; const s=setup.frames[0].image.data, b=posed.frames[0].image.data;
   const own=Math.max(...[0,1,2].map(c=>Math.abs(s[at+c]-setup.background[c])))>40;
   if(!own) continue;
   if(Math.max(...[0,1,2,3].map(c=>Math.abs(s[at+c]-b[at+c])))>40) changed++;
   if(Math.max(...[0,1,2].map(c=>Math.abs(b[at+c]-posed.background[c])))<=40) uncovered++;
  }
  return {degrees:a,changed_pixels:changed,setup_support_uncovered_pixels:uncovered,scale:posed.viewport.scale};
 });
 const leaks=sweepAngles([-30,30]).map(a=>{
  const key=sweepAnimationName('distal',a),u=underSets.get(key)!,b=bareSets.get(key)!;
  const pixels:number[][]=[];
  for(let y=0;y<u.frames[0].image.height;y++)for(let x=0;x<u.frames[0].image.width;x++) {
   const k=(y*u.frames[0].image.width+x)*4;
   if(Math.max(...[0,1,2,3].map(c=>Math.abs(u.frames[0].image.data[k+c]-b.frames[0].image.data[k+c])))>40) pixels.push([x/4,(256-y)/4]);
  }
  return {degrees:a,world_pixels:pixels};
 });
 const seams=[...underSets.values()].map(s=>JSON.parse(readFileSync(join(s.dir,'seam.json'),'utf8')) as SeamFile);
 rows.push({name,range:reading,folds,seams,whole_sleeve_reported: difference,leaks});
 for (const [col,angle] of [0,-30,30].entries()) {
  const f=bareSets.get(sweepAnimationName('distal',angle))!.frames[0].image;
  const x0=80+i*185,y0=30+col*155;
  sheet.text(`${name} ${angle}`,x0,y0,1,[0,0,0,255]);
  // A full-scale frame in a compact cell; no inferred picture or re-drawn limb.
  for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++) {
   const q=(y*f.width+x)*4; sheet.set(x0+Math.floor(x/2),y0+12+Math.floor(y/2),[f.data[q],f.data[q+1],f.data[q+2],f.data[q+3]]);
  }
  const drawn=underSets.get(sweepAnimationName('distal',angle))!;
  const geo=JSON.parse(readFileSync(join(drawn.dir,'geometry.json'),'utf8')) as GeometryFile;
  const fold=JSON.parse(readFileSync(join(drawn.dir,'folds.json'),'utf8')) as FoldsFile;
  let folded=0;
  for(const rest of geo.rest.filter(a=>a.kind==='mesh')) {
   const posed=geo.frames[0].attachments.find(a=>a.slot===rest.slot && a.attachment===rest.attachment); if(!posed) throw new Error('posed mesh absent');
   const flipped=new Set(fold.meshes.find(m=>m.slot===rest.slot)?.frames.find(f=>f.index===geo.frames[0].index)?.triangles ?? []);folded+=flipped.size;
   for(let t=0;t<rest.triangles.length;t+=3) for(let e=0;e<3;e++) {
    const a=rest.triangles[t+e]*2,b=rest.triangles[t+(e+1)%3]*2,v=posed.vertices,vp=drawn.viewport;
    const px=(k:number)=>x0+(v[k]-vp.x)*vp.scale/2;
    const py=(k:number)=>y0+12+(vp.y+vp.height-v[k+1])*vp.scale/2;
    sheet.line(px(a),py(a),px(b),py(b),0,flipped.has(t/3)?[255,0,0,220]:[0,120,70,100]);
   }
  }
  sheet.text(`folds ${folded}`,x0,y0+142,1,[0,0,0,255]);
 }
}
writeFileSync(join(root,'commands.json'),JSON.stringify(commands,null,2)+'\n');
if(mode==='--measure') {
 writePng(join(root,'sheet.png'),{width:sheet.width,height:sheet.height,data:new Uint8ClampedArray(sheet.data)});
 writeFileSync(join(root,'measurements.json'),JSON.stringify(rows,null,2)+'\n');
 console.log(JSON.stringify(rows.map((r) => { const x=r as {name:string;range:unknown};return {name:x.name,range:x.range}; }))); 
 const receipt=createHash('sha256');
 const walk=(d:string):void=>{for(const e of readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1)){const f=join(d,e.name);if(e.isDirectory())walk(f);else if(/^f[0-9]+\.png$/.test(e.name))receipt.update(readFileSync(f));}};
 walk(root);writeFileSync(join(root,'frames-receipt.json'),JSON.stringify({sha256:receipt.digest('hex'),commands,viewport:[-32,0,64,64],max:256},null,2)+'\n');
 // The sheet and receipt are retained; raw frames are reproducible receipts.
 for(const n of ['cut','hybrid','one-bone'])for(const side of ['render','bare'])rmSync(join(root,n,'sweep',side),{recursive:true,force:true});
 const hybrid=rows.find(r=>r.name==='hybrid'),plant=rows.find(r=>r.name==='one-bone');
 if(!hybrid || !plant) throw new Error('acceptance controls absent');
 const endpoint=(row:typeof hybrid,a:number)=>row.seams.find(s=>s.animation===sweepAnimationName('distal',a));
 const clean=(row:typeof hybrid,a:number)=>{
  const s=endpoint(row,a);return s?.pairs.length===2 && s.pairs.every(p=>p.status==='read' && p.banded>0 && p.gap.frames.length===0 && p.gapOpen.frames.length===0 && p.ghost.frames.length===0);
 };
 const seamPass=[-30,30].every(a=>clean(hybrid,a));
 const plantRed=[-30,30].every(a=>!clean(plant,a) && endpoint(plant,a)?.pairs.some(p=>p.gap.frames.some(f=>f.px>0)));
 const sweep=hybrid.folds.find(f=>f.animation==='full range');
 const foldPass=sweep?.meshes.length===1 && hybrid.folds.every(f=>f.meshes.every(m=>m.folded.length===0 && m.setup.degenerate.length===0 && m.setup.inverted.length===0));
 writeFileSync(join(root,'verdict.json'),JSON.stringify({seamPass,plantRed,foldPass,range:[-30,30],fps:60,samples:61},null,2)+'\n');
 console.log(`ACCEPTANCE seam=${seamPass} plant=${plantRed} folds=${foldPass}; range [-30,30], 61 samples at 60 fps`);
 if(!seamPass || !plantRed || !foldPass) process.exitCode=1;

}
