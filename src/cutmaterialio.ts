/** Optional source-bound assembly evidence, absent on undeclared builds. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { edgeLength } from './length.ts';
import { canonicalInward, CUT_MATERIAL_SOURCES, CUT_MATERIAL_SPEC, type MaterialSource, type Point } from './cutmaterial.ts';
import type { PartsFile } from './parts.ts';
import { refuseIfAny } from './errors.ts';
const sha=(data:Uint8Array|string):string=>createHash('sha256').update(data).digest('hex');
const hash=(path:string):string=>sha(readFileSync(path));
const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const point=(v:unknown):v is Point=>Array.isArray(v)&&v.length===2&&v.every(x=>typeof x==='number'&&Number.isFinite(x));
export function writeMaterialSources(partsPath:string,partsDir:string,parts:PartsFile,sources:readonly MaterialSource[]):void{
  const emitted=sources.filter(s=>parts.parts.some(p=>p.name===s.part));
  writeFileSync(join(dirname(partsPath),CUT_MATERIAL_SOURCES),JSON.stringify({
    spec:CUT_MATERIAL_SPEC,parts_sha256:hash(partsPath),
    images:parts.parts.map(p=>({part:p.name,sha256:hash(join(partsDir,`${p.name}.png`))})),
    sources_sha256:sha(JSON.stringify(emitted)),sources:emitted,
  },null,2)+'\n');
}
export function readMaterialSources(home:string,parts:PartsFile):MaterialSource[]{
  const path=join(home,CUT_MATERIAL_SOURCES);
  const fail=(detail:string):never=>{refuseIfAny([{code:'CHECK_CUT_MATERIAL_MEASURED',object:path,detail:`${detail}; rerun assemble --requirements <file> or build --requirements <file>; emitted siblings are not original source evidence`}]);throw new Error('unreachable');};
  if(!existsSync(path))return fail('original source-edge sidecar is unavailable');
  let raw:unknown;
  try{raw=JSON.parse(readFileSync(path,'utf8'));}catch{return fail('source-edge sidecar is not JSON');}
  if(!record(raw)||raw.spec!==CUT_MATERIAL_SPEC||!Array.isArray(raw.images)||!Array.isArray(raw.sources))return fail(`requires ${CUT_MATERIAL_SPEC}, images and sources`);
  if(Object.keys(raw).some(k=>!['spec','parts_sha256','images','sources_sha256','sources'].includes(k)))return fail('source sidecar has an unknown field');
  if(raw.parts_sha256!==hash(join(home,'parts.json')))return fail('source-edge sidecar does not bind these parts.json bytes');
  if(!digest(raw.sources_sha256)||raw.sources_sha256!==sha(JSON.stringify(raw.sources)))return fail('original source-edge payload digest differs; intervals/edges must not be removed or rewritten');
  if(raw.images.length!==parts.parts.length)return fail('image bindings do not cover every emitted base part');
  const seen=new Set<string>();
  for(const binding of raw.images){
    if(!record(binding)||typeof binding.part!=='string'||!digest(binding.sha256)||seen.has(binding.part)||!parts.parts.some(p=>p.name===binding.part))return fail('image bindings require each named base part exactly once and its SHA-256');
    if(Object.keys(binding).some(k=>!['part','sha256'].includes(k)))return fail('image binding has an unknown field');
    seen.add(binding.part);
    const file=join(home,'parts',`${binding.part}.png`);
    if(!existsSync(file)||hash(file)!==binding.sha256)return fail(`source-edge binding for part "${binding.part}" differs from its emitted PNG`);
  }
  const sources=new Set<string>();
  for(const s of raw.sources){
    if(!record(s)||typeof s.part!=='string'||sources.has(s.part)||!parts.parts.some(p=>p.name===s.part)||!Array.isArray(s.from)||s.from.length===0||!s.from.every(f=>typeof f==='string'&&f.length>0)||!Array.isArray(s.source_sha256)||s.source_sha256.length!==s.from.length||!s.source_sha256.every(digest)||!Array.isArray(s.edges))return fail('source readings require unique emitted parts, source labels/digests and edges');
    if(Object.keys(s).some(k=>!['part','from','source_sha256','edges'].includes(k)))return fail('source reading has an unknown field');
    sources.add(s.part);
    for(const edge of s.edges){
      if(!record(edge)||!point(edge.a)||!point(edge.b)||!point(edge.inward)||!Array.isArray(edge.opaque_t))return fail('edge readings require finite a, b, inward and bounded original opaque_t parameters');
      if(Object.keys(edge).some(k=>!['a','b','inward','opaque_t','opaque_intervals','opaque_length_px'].includes(k)))return fail('edge reading has an unknown field; absolute opaque endpoints are not this format');
      const a=edge.a,b=edge.b,n=edge.inward,length=edgeLength(b[0]-a[0],b[1]-a[1]);
      if(!Number.isFinite(length)||length===0||edgeLength(...n)===0)return fail('source edge or its inward direction has zero/unrepresentable length');
      const canonical=canonicalInward(a,b,n);
      if(n[0]!==canonical[0]||n[1]!==canonical[1])return fail('inward must be the canonical unit perpendicular to the actual edge; no oblique inward is supported');
      if(edge.opaque_t.length===0)return fail('listed source edges must have opaque intervals; an empty list may not hide an originally crossed edge');
      let previous=0,total=0;
      for(const span of edge.opaque_t){
        if(!point(span)||span[0]<0||span[1]>1||span[0]>=span[1]||span[0]<previous)return fail('opaque_t intervals must be ordered, nonoverlapping, positive, and inside [0,1] on this actual edge');
        previous=span[1];total+=(span[1]-span[0])*length;
      }
      if(edge.opaque_intervals!==edge.opaque_t.length||edge.opaque_length_px!==total)return fail('opaque interval count/length disagree with the original source-edge census');
    }
  }
  return raw.sources as unknown as MaterialSource[];
}
