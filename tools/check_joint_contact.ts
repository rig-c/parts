/** Material-contact controls: synthetic rectangles with a hand-derived quarter-turn. */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Plate } from '@rig-c/core/plate';
import { seamsOf } from '@rig-c/core/seam';
import type { Piece, AttachmentRest } from '@rig-c/core/render-shared';
import { readMotionSeams, motionSeamLine, motionSeamPairs, barsNotMet } from '../src/check.ts';
import { motionSeamLines } from '../src/build.ts';
import type { PartsFile } from '../src/parts.ts';

type Reporter = (name: string, ok: boolean, detail: string) => void;
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const rect = (slot: string, x: number, y: number, w: number, h: number): Piece => ({
  kind: 'region', slot, page: slot, world: [x,y,x,y+h,x+w,y+h,x+w,y],
  uvs: [0,1,0,0,1,0,1,1], tint: [1,1,1,1],
});
export function runJointContactChecks(home: string, say: Reporter): void {
  const parent = new Plate(6,12); parent.rect(0,0,6,12,[40,140,220,255]);
  const setup = [rect('parent',-6,-4,6,12),rect('limb',-2,-12,4,16)];
  const turn = (p: Piece): Piece => ({...p,world:p.world.flatMap((v,i,a) => i%2 ? [] : [-a[i+1],v])});
  const rest: AttachmentRest[] = setup.map(p => ({slot:p.slot,attachment:p.slot,kind:'region',vertices:p.world,triangles:[0,1,2,2,3,0]}));
  const pair = {pair:'parent|limb',a:'parent',b:'limb',declared:['synthetic elbow'],joints:['elbow']};
  const raw = (removed: boolean) => {
    const limb = new Plate(4,16); limb.rect(0,removed ? 6 : 0,4,removed ? 10 : 16,[240,120,40,255]);
    const pieces = [setup[0],turn(setup[1])];
    return seamsOf([{a:'parent',b:'limb'}],rest,[0,1].map(index => ({index,time:index/12,pieces,
      attachments:pieces.map(p => ({slot:p.slot,attachment:p.slot,vertices:p.world,color:p.tint}))})),new Map([['parent',parent],['limb',limb]]))[0];
  };
  const read = (p: unknown, joints: string[] = ['elbow']) => {
    mkdirSync(join(home,'swing'),{recursive:true});
    writeFileSync(join(home,'frames.json'),JSON.stringify({spec:'rigc-frames/1',sets:[{animation:'swing',dir:'swing',fps:12,sampled:2,written:2,stride:1,duration:1/12}]}));
    writeFileSync(join(home,'swing','seam.json'),JSON.stringify({spec:'rigc-seam/1',animation:'swing',fps:12,pairs:[p]}));
    return readMotionSeams(home,['swing'],12,[{...pair,joints}])[0];
  };
  const contact = (v: unknown): Record<string,unknown> => record(v) && record(v.joint_contact) ? v.joint_contact : {};
  const separated = raw(true), intact = raw(false);
  const cut = read(separated), whole = read(intact), unnamed = read(intact,[]);
  say('JCT01_REMOVED_MATERIAL_IS_SEPARATED',contact(cut).separated===2 && contact(cut).joined===0 && contact(cut).unavailable===0,JSON.stringify(contact(cut)));
  say('JCT02_INTACT_SWUNG_MATERIAL_IS_JOINED',contact(whole).joined===2 && contact(whole).separated===0 && contact(whole).unavailable===0,JSON.stringify(contact(whole)));
  say('JCT03_NO_NAMED_JOINT_IS_UNAVAILABLE',contact(unnamed).joined===0 && contact(unnamed).unavailable===2 && JSON.stringify(contact(unnamed).reasons).includes('no declared named joint'),JSON.stringify(contact(unnamed)));
  const mixed = read({...intact,jointContact:{frames:[{index:0,time:0,status:'joined',reason:null},{index:1,time:1/12,status:'unavailable',reason:'no setup band'}]}});
  say('JCT04_UNAVAILABLE_REASON_AND_FRAME_ARE_RETAINED',contact(mixed).joined===1 && contact(mixed).unavailable===1 && JSON.stringify(contact(mixed).reasons)===JSON.stringify([{reason:'no setup band',frames:[1]}]),JSON.stringify(contact(mixed)));
  const missing = {...intact} as Record<string,unknown>; delete missing.jointContact;
  const absent = read(missing);
  say('JCT05_MISSING_CORE_OBSERVATION_IS_UNAVAILABLE',contact(absent).unavailable===2 && JSON.stringify(contact(absent).reasons).includes('no jointContact.frames'),JSON.stringify(contact(absent)));
  const project = (v: unknown): string => { const row = {...v as Record<string,unknown>}; delete row.joint_contact; return JSON.stringify(row); };
  const natural = read(intact), changed = read({...intact,jointContact:{frames:[0,1].map(index => ({index,time:index/12,status:'separated',reason:null}))}});
  const figure = (row: typeof natural) => ({gate_spine_html_green:true,SEAM_OVER_MOTION:motionSeamLine([pair],['swing'],12,[row])});
  say('JCT06_CONTACT_CANNOT_CHANGE_RAW_ROWS_OR_VERDICTS',project(natural)===project(changed) && JSON.stringify(barsNotMet(figure(natural)))===JSON.stringify(barsNotMet(figure(changed))),JSON.stringify({natural,changed}));
  const invalid = [
    [{index:0,time:0,status:'unavailable',reason:null},{index:1,time:1/12,status:'joined',reason:null}],
    [{index:0,time:0,status:'joined',reason:null},{index:0,time:0,status:'separated',reason:null}],
    [{index:0,time:0,status:'joined',reason:null}],
    [{index:0,time:0,status:'joined',reason:null},{index:1,time:-1,status:'joined',reason:null}],
  ];
  const refused = invalid.map(frames => {try {read({...intact,jointContact:{frames}});return false;}catch(e){return String(e).includes('FRAMES_SIDECAR');}});
  say('JCT07_MALFORMED_CONTACT_REFUSES_BY_NAME',refused.every(Boolean),JSON.stringify(refused));
  const line = motionSeamLine([pair],['swing'],12,[cut]);
  const text = motionSeamLines(line).join('\n');
  say('JCT08_OUTPUT_NAMES_PAIR_JOINT_ANIMATION_AND_COUNTS',text.includes('JOINT_CONTACT') && text.includes('parent|limb') && text.includes('elbow') && text.includes('swing') && text.includes('separated 2') && text.includes('joined 0') && text.includes('unavailable 0'),text);
  say('JCT09_NO_PAIRS_IS_NAMED_SKIP',motionSeamLines(motionSeamLine([],['swing'],12,[],'no declared pairs')).some(l => l.includes('JOINT_CONTACT: SKIP') && l.includes('no declared pairs')),'No observations must not look like a clean joint.');
  const parts = {rig_size:[16,16],scale_rig_per_source:1,ghost_px:{},parts:[
    {name:'parent',limb:{name:'arm',segment:0,of:'arm',bone:'upper'}},
    {name:'limb',limb:{name:'arm',segment:1,of:'arm',bone:'lower',joint:'elbow'}},
  ]} as unknown as PartsFile;
  const selected = motionSeamPairs(parts,[{name:'same',part:'limb',neighbour:'parent'}]);
  say('JCT10_EXISTING_PAIR_SELECTION_RETAINS_NAMED_JOINT',selected.length===1 && JSON.stringify((selected[0] as unknown as Record<string,unknown>).joints)==='["elbow"]',JSON.stringify(selected));
  const rootParts = {...parts,parts:[{name:'parent',from:'full:topwear'},{name:'limb',from:'full:handwear-r',limb:{name:'arm',segment:0,of:'arm',bone:'branch'}}]} as unknown as PartsFile;
  const rootRig={bones:[{name:'root'},{name:'carrier',parent:'root'},{name:'branch',parent:'carrier'}],slots:[{name:'parent',bone:'carrier',attachment:'art'},{name:'limb',bone:'branch',attachment:'art'}],skins:{default:{parent:{art:{}},limb:{art:{}}}}};
  const rootPairs=motionSeamPairs(rootParts,[{name:'reversed root',part:'limb',neighbour:'parent'}],rootRig,candidates=>candidates.map(p=>({pair:p.pair,drawn:1,banded:1,status:'read'})));
  say('JCT12_PROVEN_ROOT_RETAINS_BONE_THROUGH_REVERSED_DEDUP',rootPairs.length===1 && JSON.stringify(rootPairs[0].joints)==='["branch"]',JSON.stringify(rootPairs));
  const limbPage=new Plate(4,16);limbPage.rect(0,0,4,16,[240,120,40,255]);
  const shifted=[setup[0],rect('limb',20,-12,4,16)];
  const restApart: AttachmentRest[]=shifted.map(p=>({slot:p.slot,attachment:p.slot,kind:'region',vertices:p.world,triangles:[0,1,2,2,3,0]}));
  const noBand=seamsOf([{a:'parent',b:'limb'}],restApart,[0,1].map(index=>({index,time:index/12,pieces:setup,attachments:setup.map(p=>({slot:p.slot,attachment:p.slot,vertices:p.world,color:p.tint}))})),new Map([['parent',parent],['limb',limbPage]]))[0];
  const unavailable=read(noBand);
  say('JCT13_CORE_NO_SETUP_BAND_REASON_IS_UNAVAILABLE',contact(unavailable).unavailable===2 && contact(unavailable).joined===0 && JSON.stringify(contact(unavailable).reasons).includes('no shared half-opacity cell'),JSON.stringify(contact(unavailable)));
  const docs=readFileSync(join(import.meta.dir,'..','docs','AUTHORING.md'),'utf8');
  say('JCT11_AUTHORING_DOCUMENTS_REPORT_ONLY_FIELD',docs.includes('`joint_contact`') && docs.includes('`joined`') && docs.includes('`separated`') && docs.includes('`unavailable`'), 'The field, states and limitations must be documented.');
}
