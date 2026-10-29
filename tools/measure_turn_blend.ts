/** Reproducible synthetic seam receipt. Rendering is an explicit Nova-only invocation. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readModel, poseRawAnimation, poseRawSetup } from '@rig-c/core/core';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blendedTurnFixture, blendedTurnIslandsFixture, singleGroupTurnFixture } from '../fixtures/turn_blend.ts';
import { parseConfig } from '../src/config.ts';
import { buildRig } from '../src/rig.ts';
import { rigOutputTexts } from '../src/build.ts';
import { writePng } from '../src/raster/png.ts';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('bun tools/measure_turn_blend.ts --out <private-directory> [--render]'); process.exit(0);
}
const at = args.indexOf('--out'), out = at < 0 ? undefined : args[at + 1];
if (!out || args.some((a,i) => i !== at && i !== at + 1 && a !== '--render')) throw new Error('supply --out <private-directory> [--render]');
const cli = fileURLToPath(import.meta.resolve('@rig-c/core/cli'));
function run(argv: string[], log: string): void {
  const r = spawnSync(process.execPath, [cli, ...argv], {encoding:'utf8',maxBuffer:1<<26});
  writeFileSync(log,r.stdout+r.stderr); console.log(JSON.stringify({command:[process.execPath,cli,...argv],exit:r.status,log}));
  if(r.status !== 0) throw new Error(readFileSync(log,'utf8'));
}
const homes = new Map<string,string>();
for(const mode of ['none','surface','no-turn','islands','zero-head','zero-body'] as const) {
  const f=mode === 'islands' ? blendedTurnIslandsFixture() : mode === 'zero-head' ? singleGroupTurnFixture('head','head',true) : mode === 'zero-body' ? singleGroupTurnFixture('body','body',true) : blendedTurnFixture(mode === 'no-turn' ? 'none' : mode);
  if(mode === 'zero-head') delete (f.config.turn as {body?:unknown}).body;
  if(mode === 'zero-body') delete (f.config.turn as {roles?:unknown}).roles;
  if(mode === 'no-turn') delete f.config.turn;
  const b=buildRig(parseConfig(f.config),f.parts,f.images), home=resolve(out,mode);
  homes.set(mode,home);
  mkdirSync(join(home,'images'),{recursive:true});
  for(const [name,text] of rigOutputTexts(b,null)) writeFileSync(join(home,name),text);
  for(const [name,image] of b.images) writePng(join(home,'images',name),image);
  run(['build','--rig',join(home,'rig.json'),'--motion',join(home,'motion.json'),'--out',join(home,'built'),'--profile','rig-play'],join(home,'gate.log'));
  if(!args.includes('--render') || (mode !== 'none' && mode !== 'surface')) continue;
  for(const animation of ['body_turn','turn','tilt']) {
    run(['render','--candidate',join(home,'built'),'--animation',animation,'--fps','20','--max','128','--geometry','--folds','--seam','neck:topwear,neck:face','--out',join(home,'render')],join(home,animation+'.log'));
    const seam=JSON.parse(readFileSync(join(home,'render',animation+'@20fps','seam.json'),'utf8')) as {pairs:Array<{a:string;b:string;status:string;drawn:number;banded:number;gap:{frames:Array<{index:number;px:number}>};ghost:{frames:Array<{index:number;px:number}>}}>} ;
    for(const pair of seam.pairs) console.log(JSON.stringify({mode,animation,pair:pair.a+':'+pair.b,status:pair.status,drawn:pair.drawn,banded:pair.banded,frames:Array.from({length:pair.drawn},(_,index)=>({index,gap:pair.gap.frames.find(f=>f.index===index)?.px??0,ghost:pair.ghost.frames.find(f=>f.index===index)?.px??0}))}));
    const folder=join(home,'render',animation+'@20fps');
    const folds=JSON.parse(readFileSync(join(folder,'folds.json'),'utf8')) as {meshes:Array<{frames:unknown[];folded:number[];setup:{degenerate:unknown[];inverted:unknown[]}}>};
    const sha=createHash('sha256'),pngs=readdirSync(folder).filter(n=>/^f[0-9]+\.png$/.test(n)).sort();
    for(const png of pngs) sha.update(readFileSync(join(folder,png)));
    console.log(JSON.stringify({mode,animation,foldedFrames:folds.meshes.reduce((s,m)=>s+m.frames.length,0),foldedTriangles:folds.meshes.reduce((s,m)=>s+m.folded.length,0),setupFaults:folds.meshes.reduce((s,m)=>s+m.setup.degenerate.length+m.setup.inverted.length,0),pngs:pngs.length,framesSha256:sha.digest('hex'),seamSha256:createHash('sha256').update(readFileSync(join(folder,'seam.json'))).digest('hex')}));
  }
}

const poses=(mode:string)=>poseRawAnimation(readModel(readFileSync(join(homes.get(mode)!,'built/skeleton.model.json'),'utf8')),'idle',[0,...Array<number>(40).fill(0.05)]);
const source=poses('no-turn'),turned=poses('surface'); let physicsError=0;
for(let i=0;i<source.length;i++) {
  const a=source[i].drawn.find(d=>d.slot==='neck')!.vertices,b=turned[i].drawn.find(d=>d.slot==='neck')!.vertices;
  if(a.length!==b.length) throw new Error('neutral topology differs');
  for(let j=0;j<a.length;j++) physicsError=Math.max(physicsError,Math.abs(a[j]-b[j]));
}
console.log(JSON.stringify({physics:'zero-turn idle neck, physics active',frames:source.length,maxVertexError:physicsError}));
if(physicsError>0.000003) throw new Error('zero-turn physics changed');

// The compiled runtime must also keep each disconnected sibling on its own group.
const islandDoc=readModel(readFileSync(join(homes.get('islands')!,'built/skeleton.model.json'),'utf8'));
const islandSetup=poseRawSetup(islandDoc);
for(const [animation,slot,inactive] of [
  ['body_turn','neck__island2',true],['turn','neck__island3',true],['tilt','neck__island3',true],
  ['turn','neck__island2',false],['body_turn','neck__island3',false],
] as const) {
  const rest=islandSetup.drawn.find(d=>d.slot===slot)!.vertices;
  const frames=poseRawAnimation(islandDoc,animation,[0,...Array<number>(40).fill(0.05)]);
  let max=0;
  for(const frame of frames) { const posed=frame.drawn.find(d=>d.slot===slot)!.vertices; for(let i=0;i<rest.length;i++)max=Math.max(max,Math.abs(rest[i]-posed[i])); }
  console.log(JSON.stringify({compiledIslands:true,animation,slot,inactive,frames:frames.length,maxVertexTravel:max}));
  if(inactive ? max>0.000003 : max<1) throw new Error('compiled island group mask disagrees with the authored binding');
}
