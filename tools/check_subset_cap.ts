/** Assembly-only source/cap preservation controls. All inputs are generated rectangles. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleStage, readRuns, type AssembleStageInput } from '../src/build.ts';
import { readParts, type PartRecord } from '../src/parts.ts';
import { readPng } from '../src/raster/png.ts';
import { connectedComponents } from '../src/raster/components.ts';
import { newMask, newRaster, type Raster } from '../src/raster/types.ts';
import { assemble, stageFields } from '../src/assemble.ts';
import { loadConfig } from '../src/config.ts';
import { C, NAVY, writeRun } from '../fixtures/assemble_fixture.ts';
import { inDisc, jointLine, pastJoint } from '../src/limbs.ts';
import { writeSubsetCapFixture } from '../fixtures/subset_cover.ts';

type Say = (name: string, pass: boolean, detail: string) => void;
export function runSubsetCapChecks(dir: string, say: Say): void {
  writeSubsetCapFixture(dir);
  const run = (name: string, extra: Partial<AssembleStageInput> = {}): string => {
    const out = join(dir, name), logs: string[] = [];
    assembleStage({source:join(dir,'painting.png'),full:join(dir,'full'),head:join(dir,'head'),config:join(dir,'config.json'),project:'core',seam:'near-white',...extra},
      {partsJson:join(out,'parts.json'),partsDir:join(out,'parts'),recomposite:join(out,'recomposite_rig.png'),errorMap:join(out,'recomposite_error_rig.png')},l=>logs.push(l));
    writeFileSync(join(out,'raw.log'),logs.join('\n')+'\n');return out;
  };
  const piece = (out: string, set: string, name: string): { rec: PartRecord; im: Raster } => {
    const rec=readParts(join(out,'parts.json')).alternates?.find(a=>a.name===set)?.records.find(p=>p.name===name);
    if(rec===undefined)throw Error(`missing generated ${set}/${name}`);
    return {rec,im:readPng(join(out,'parts',`${set}_${name}.png`))};
  };
  const px = (p: ReturnType<typeof piece>, x: number, y: number): number => x<p.rec.x||y<p.rec.y||x>=p.rec.x+p.rec.w||y>=p.rec.y+p.rec.h?0:p.im.data[((y-p.rec.y)*p.im.width+x-p.rec.x)*4+3];
  const areas = (p: ReturnType<typeof piece>): number[] => {const m=newMask(p.im.width,p.im.height);for(let i=0;i<m.data.length;i++)m.data[i]=p.im.data[i*4+3]>8?1:0;return connectedComponents(m,8).stats.slice(1).map(s=>s.area).sort((a,b)=>b-a);};
  const countBox = (p: ReturnType<typeof piece>, box: number[]): number => {let n=0;for(let y=box[1];y<box[3];y++)for(let x=box[0];x<box[2];x++)if(px(p,x,y)>8)n++;return n;};
  const green=run('owned'),mutant=run('unprotected',{setCover:'painting'}),none=run('no-exclusion',{setExclusion:'none'});
  const g=piece(green,'step_r','foot_r'),m=piece(mutant,'step_r','foot_r');
  const bridge=[34,26,42,34], fragment=[32,26,34,34];
  say('UC14_AN_OWN_UPPER_CAP_KEEPS_ITS_CONNECTION_THROUGH_BASE_FOOTPRINTS',areas(g).length===1&&countBox(g,bridge)===8*8&&countBox(g,fragment)===2*8,
    `owned areas ${JSON.stringify(areas(g))}; bridge ${countBox(g,bridge)}/64; valid cap end ${countBox(g,fragment)}/16`);
  say('UC15_THE_UNPROTECTED_MUTANT_CUTS_THE_ACTUAL_BRIDGE_AND_LEAVES_THE_VALID_CAP_END',areas(m).length===2&&areas(m)[1]===16&&countBox(m,bridge)===0&&countBox(m,fragment)===16,
    `mutant areas ${JSON.stringify(areas(m))}; bridge ${countBox(m,bridge)}; end ${countBox(m,fragment)}`);
  // Count cap pixels from geometry and PNG alpha, independently of the record's figures.
  const cap=g.rec.limb?.cap,line=jointLine([26,30],[46,30],[54,30]);let capPixels=0;
  if(cap!==undefined&&line!==null)for(let y=cap.box[1];y<cap.box[1]+cap.box[3];y++)for(let x=cap.box[0];x<cap.box[0]+cap.box[2];x++)if(inDisc(cap.at,cap.radius,x,y)&&!pastJoint(line,x,y)&&px(g,x,y)>0)capPixels++;
  const recorded=(cap?.layer_px??0)+(cap?.image_px??0)+(cap?.upper_px??0)+(cap?.lower_px??0)+(cap?.lower_kept_px??0);
  say('UC16_CAP_PROVENANCE_COUNTS_MATCH_THE_ASSIGNED_PNG',cap!==undefined&&capPixels===recorded&&recorded+(cap.excluded_px??0)===32+212&&cap.upper_px===188,
    `cap PNG ${capPixels}; record kept ${recorded}; removed ${cap?.excluded_px??0}; original layer 32 + upper 212; ${JSON.stringify(cap)}`);
  const pf=readParts(join(green,'parts.json'));
  const ledger=(pf.alternates??[]).flatMap(a=>a.records).every(p=>(p.visible_px??0)+(p.occluded_px??0)===p.opaque_px&&(p.source_px_taken??0)<=p.opaque_px);
  say('UC17_VISIBILITY_AND_SOURCE_LEDGERS_STILL_ADD_UP',ledger,`${(pf.alternates??[]).flatMap(a=>a.records).length} generated set records checked`);
  const files=(o:string):string[]=>['parts.json','recomposite_rig.png','recomposite_error_rig.png',...readdirSync(join(o,'parts')).sort().map(f=>`parts/${f}`)];
  const equal=(a:string,b:string,fs=files(a)):boolean=>fs.every(f=>readFileSync(join(a,f)).equals(readFileSync(join(b,f))));
  const baseFiles=files(green).filter(f=>!f.includes('step_')&&f!=='parts.json');
  say('UC18_BASE_PARTS_AND_RECORDS_ARE_UNCHANGED',equal(green,mutant,baseFiles)&&JSON.stringify(pf.parts)===JSON.stringify(readParts(join(mutant,'parts.json')).parts),`${baseFiles.length} base files and base records compared`);
  const leftFiles=files(green).filter(f=>f.includes('step_l_'));
  say('UC19_THE_OTHER_SIDE_KEEPS_ITS_PIXEL_BYTES',equal(green,mutant,leftFiles),`${leftFiles.length} other-side PNGs compared; cap accounting may remove stale ownership counts`);
  const n=piece(none,'step_r','foot_r');
  say('UC20_EXCLUSION_RETAINS_THE_OWN_CAP_WITHOUT_REASSIGNING_PIXELS',g.im.data.every((v,i)=>v===n.im.data[i])&&g.rec.x===n.rec.x&&g.rec.y===n.rec.y,
    `protected foot opaque ${g.rec.opaque_px}; exclusion disabled ${n.rec.opaque_px}; no new ownership`);
  const shin=piece(green,'step_r','shin_r'),shinNone=piece(none,'step_r','shin_r');
  say('UC21_NONCAP_SOURCE_PIXELS_STILL_OBEY_BASE_EXCLUSION',shin.rec.opaque_px<shinNone.rec.opaque_px&&readFileSync(join(green,'raw.log'),'utf8').includes('shin_r: 22 px under shin_l excluded'),
    `shin kept ${shin.rec.opaque_px}; no exclusion ${shinNone.rec.opaque_px}; exclusion remains active`);
  const repeated=run('again');
  say('UC22_SOURCE_CAP_ASSEMBLY_REPEATS_BYTE_FOR_BYTE',equal(green,repeated),`${files(green).length} output files compared`);
  // A source-alpha-zero pixel copied by the measured cap, not a colour/area deletion.
  const lower=readPng(join(dir,'step','parts','footwear.png'));let own=0;
  for(let y=26;y<34;y++)for(let x=32;x<42;x++){
    const lx=x-36,ly=y-28;const sourceA=lx<0||ly<0||lx>=lower.width||ly>=lower.height?0:lower.data[(ly*lower.width+lx)*4+3];
    if(sourceA===0&&px(g,x,y)>8)own++;
  }
  say('UC23_SOURCE_TRANSPARENT_CAP_ART_IS_PRESERVED_WITH_ITS_BRIDGE',own===10*8,`source-transparent connected cap block ${own}/80 (10x8)`);

  // An authored cap image has provenance even where the lower source is transparent.
  // Unlike an upper copy, it needs an actual front layer to escape a base exclusion.
  const imageDir=join(dir,'image-cap');writeSubsetCapFixture(imageDir);
  const sourceRects=[{name:'legwear',depth:0.6,rects:[{x0:22,y0:10,x1:30,y1:34,colour:C},{x0:30,y0:26,x1:46,y1:34,colour:C},{x0:34,y0:10,x1:42,y1:50,colour:C}]},
    {name:'footwear',depth:0.4,rects:[{x0:44,y0:28,x1:56,y1:34,colour:C},{x0:44,y0:34,x1:46,y1:50,colour:C},{x0:36,y0:48,x1:48,y1:54,colour:C}]}];
  const fields=stageFields(loadConfig(join(imageDir,'config.json')));
  if(fields.limbs===undefined||fields.bones===undefined)throw Error('missing generated limb fields');
  const limbs={leg_r:{...fields.limbs.leg_r,segments:fields.limbs.leg_r.segments.map((sg,i)=>i===2?{...sg,cap:'authored.png'}:sg)}};
  const bones=fields.bones.map(b=>'chain' in b&&b.chain==='leg_r'?{...b,tip:[46,30] as [number,number]}:'name' in b&&b.name==='foot_r'?{...b,at:[46,30] as [number,number],tip:[54,30] as [number,number]}:b);
  const image=newRaster(28,28);for(let p=0;p<28*28;p++)image.data.set([...C,255],p*4);
  const exclusion=newMask(64,64);for(let y=26;y<34;y++)for(let x=32;x<42;x++)exclusion.data[y*64+x]=1;
  const imageRun=(cover:boolean,protectedArt:boolean):ReturnType<typeof assemble>=>{
    writeRun(join(imageDir,'step'),[...sourceRects,...(cover?[{name:'objects',depth:0.2,rects:[{x0:32,y0:26,x1:42,y1:34,colour:NAVY}]}]:[])]);
    return assemble({...fields,...readRuns(join(imageDir,'step'),join(imageDir,'head')),source:readPng(join(imageDir,'painting.png')),limbs,bones,
      projectRule:'core',seamRule:'near-white',limbUnderCover:protectedArt,caps:new Map([['leg_r/2',image]]),exclude:[{part:'foot_r',under:'base-cover',mask:exclusion}]});
  };
  const ig=imageRun(true,true),ib=imageRun(true,false),inc=imageRun(false,true);
  const wrap=(r:ReturnType<typeof assemble>):ReturnType<typeof piece>=>{const p=r.images.find(p=>p.record.name==='foot_r');if(!p)throw Error('authored cap absent');return {rec:p.record,im:p.image};};
  const imageKept=countBox(wrap(ig),[32,26,42,34]),imageLost=countBox(wrap(ib),[32,26,42,34]);
  say('UC24_AUTHORED_CAP_PROVENANCE_UNDER_AN_ACTUAL_COVER_IS_PRESERVED',imageKept===80&&imageLost===0,
    `authored cap under cover: kept ${imageKept}/80; unprotected mutant ${imageLost}`);
  say('UC25_A_CAP_IMAGE_WITHOUT_AN_ACTUAL_COVER_STILL_OBEYS_EXCLUSION',countBox(wrap(inc),[32,26,42,34])===0&&inc.excluded[0].px===80,
    `no front layer: kept ${countBox(wrap(inc),[32,26,42,34])}; excluded ${inc.excluded[0].px}/80`);
}
