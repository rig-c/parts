/** Exact absent-mode byte comparison against a pristine baseline tree supplied by the caller. */
import { cpSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeHybridFixture } from '../fixtures/hybrid_limb.ts';
import { hashRows, readTree } from '../src/remesh.ts';
import { processRigcRunner } from './build-process.ts';
const root=resolve(process.argv[2] ?? 'scratch/hybrid-identity');
const baseline=resolve(process.argv[3] ?? root);
const worker=process.argv[4] === '--worker';
if(worker) {
 const producer=await import(pathToFileURL(join(baseline,'src/build.ts')).href) as typeof import('../src/build.ts');
 const input=join(root,'input'),out=join(root,'work');
 mkdirSync(out,{recursive:true});
 producer.assembleStage({source:join(input,'painting.png'),full:join(input,'full'),head:join(input,'head'),config:join(input,'config.json'),seam:'near-white',project:'core'},
 {partsJson:join(out,'parts.json'),partsDir:join(out,'parts'),recomposite:join(out,'recomposite.png'),errorMap:join(out,'error.png')},()=>{});
 const rigc=processRigcRunner(resolve('node_modules/.bin/rigc'));
 producer.rigStage({config:join(input,'config.json'),parts:out,out:join(out,'rig'),idleKeys:'direct'},rigc,join(root,'gate'),()=>{});
 for(const args of [
  ['build','--rig',join(out,'rig/rig.json'),'--motion',join(out,'rig/motion.json'),'--out',join(out,'build'),'--profile','rig-play'],
  ['render','--candidate',join(out,'build'),'--fps','1','--max','64','--geometry','--folds','--out',join(out,'render')],
 ]) { const r=rigc(args); if(r.status!==0)throw new Error(r.out); }
} else {
 mkdirSync(root,{recursive:true});
 // The archive is created from the card's origin pin by the coordinator, not from a mutable local checkout.
 const extracted=join(root,'baseline');mkdirSync(extracted,{recursive:true});
 const tar=spawnSync('tar',['-xf',baseline,'-C',extracted],{encoding:'utf8'});if(tar.status!==0)throw new Error(tar.stderr);
 symlinkSync(resolve('node_modules'),join(extracted,'node_modules'),'dir');
 writeHybridFixture(join(root,'input'),false);
 const run=(repo:string,side:string)=>{
  const r=spawnSync(process.execPath,[import.meta.path,root,repo,'--worker'],{encoding:'utf8',maxBuffer:1<<24});
  writeFileSync(join(root,`${side}.log`),r.stdout+r.stderr);if(r.status!==0)throw new Error(`${side} exit ${r.status}: ${r.stderr}`);
  renameSync(join(root,'work'),join(root,side));
 };
 run(extracted,'before');run(resolve('.'),'after');
 const before=readTree(join(root,'before')),after=readTree(join(root,'after'));
 const a=hashRows(before),b=hashRows(after),same=JSON.stringify(a)===JSON.stringify(b);
 writeFileSync(join(root,'identity.json'),JSON.stringify({same,before:a,after:b},null,2)+'\n');
 console.log(`IDENTITY ${same?'PASS':'FAIL'}: ${a.length} baseline files, ${b.length} candidate files; exact paths, bytes and SHA-256`);
 if(!same) {
  const rows=new Map(a.map(r=>[r.path,r]));console.log(b.filter(r=>JSON.stringify(rows.get(r.path))!==JSON.stringify(r)));
  process.exitCode=1;
 }
 rmSync(extracted,{recursive:true,force:true});
}
